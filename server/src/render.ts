// Cloud renders: Render Image's jobs, made on a GPU at Modal (cloudrender/worker.py). The editor
// uploads a job it packed (web/src/features/render/pack.ts). The server holds from the user's
// credit what the job's time limit could cost, which caps the limit at what they can pay, sends the
// job to the worker and polls it, keeps the pictures for RENDER_KEEP_DAYS, and charges the seconds
// it ran (never more than it held). See docs/PLATFORM.md, "Cloud renders".

import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import type { Hono } from "hono";
import type { NewRenderJob, RenderJob, RenderPicture, RenderState, RenderTerms } from "../../web/src/platform/protocol.ts";
import { requireUser, type UserRow } from "./auth.ts";
import { config, type RenderConfig } from "./config.ts";
import { chargeUsage, freeCredit, MICRO, priceOf } from "./credit.ts";
import { all, get, run, tx } from "./db.ts";
import { readJson } from "./http.ts";
import { receiveUpload } from "./uploads.ts";
import { DAY, fail, fileStream, inMs, newId, nowIso } from "./util.ts";

/** how often running jobs are asked how they are getting on */
const POLL_MS = 2000;
/** the shortest job worth starting, seconds: Chrome's start and the scene's build come first */
const MIN_SECONDS = 90;
/** seconds a job gets beyond its pictures' own limits: the start, the build, sending the pictures */
const OVERHEAD_SECONDS = 120;
/** seconds past its limit after which a job the worker hasn't finished is stopped */
const STUCK_SECONDS = 900;
/** a job still starting after this long (the server stopped mid-upload) is dropped */
const STARTING_MS = 60 * 60_000;
const MAX_SIDE = 8192;
const MAX_SAMPLES = 1 << 16;
const MAX_SHOTS = 50;

interface JobRow {
  id: string;
  user_id: string;
  call_id: string | null;
  state: RenderState;
  name: string;
  width: number;
  height: number;
  samples: number;
  shots: number;
  gpu: string;
  limit_seconds: number;
  hold: number;
  progress: string | null;
  stop: "finish" | "cancel" | null;
  seconds: number | null;
  charged: number | null;
  error: string | null;
  pictures: string | null;
  created_at: string;
  finished_at: string | null;
}

/** What the worker says of a job (GET {RENDER_URL}/jobs/{call}). */
type WorkerStatus =
  | { state: "running"; progress: { label?: string; fraction?: number | null; preview?: string | null } | null }
  | { state: "failed"; error: string }
  | { state: "done"; seconds: number; images: { name: string; mime: string; samples: number | null; seconds: number; bytes: number }[] };

/** What the editor is told of cloud renders (GET /api/config). */
export function renderTerms(): RenderTerms | null {
  const r = config.render;
  if (!r) return null;
  const c = config.credit;
  const usdPerMinute = r.usdPerHour / 60;
  return {
    gpu: r.gpu,
    perMinute: c ? usdPerMinute * c.usdRate * c.markup : null,
    plusPerMinute: c ? usdPerMinute * c.usdRate * c.plusMarkup : null,
    maxMinutes: r.maxMinutes,
  };
}

function renderConfig(): RenderConfig {
  const r = config.render;
  if (!r) fail(404, "Cloud renders aren't set up on this server", "not_found");
  return r;
}

/** A second of the GPU as the user pays for it, millionths of the credit (0: renders are free here). */
function perSecond(user: UserRow, r: RenderConfig): number {
  const c = config.credit;
  return c ? priceOf(user, c, r.usdPerHour / 3600) : 0;
}

function picturesDir(jobId: string): string {
  return join(config.dataDir, "renders", jobId);
}

function picturePath(jobId: string, n: number, mime: string): string {
  return join(picturesDir(jobId), `${n}.${mime === "image/jpeg" ? "jpg" : "png"}`);
}

function jobOut(row: JobRow): RenderJob {
  const progress = row.progress ? (JSON.parse(row.progress) as { label?: string; fraction?: number | null; preview?: string | null }) : null;
  return {
    id: row.id,
    state: row.state,
    name: row.name,
    width: row.width,
    height: row.height,
    samples: row.samples,
    shots: row.shots,
    gpu: row.gpu,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    limitSeconds: row.limit_seconds,
    progress: progress && (row.state === "running" || row.state === "starting") ? { label: progress.label ?? "", fraction: progress.fraction ?? null, preview: progress.preview ?? null } : null,
    stop: row.stop,
    seconds: row.seconds,
    charged: row.charged === null ? null : row.charged / MICRO,
    error: row.error,
    pictures: row.pictures ? (JSON.parse(row.pictures) as RenderPicture[]) : [],
  };
}

function ownJob(user: UserRow, id: string): JobRow {
  const row = get<JobRow>("SELECT * FROM render_jobs WHERE id = ? AND user_id = ?", id, user.id);
  if (!row) fail(404, "No such render", "not_found");
  return row;
}

/** The job's X-Render-Job header, checked. */
function newJobOf(header: string | undefined): NewRenderJob {
  let raw: Record<string, unknown> = {};
  try {
    raw = JSON.parse(decodeURIComponent(header ?? "")) as Record<string, unknown>;
  } catch {
    fail(400, "The render job has no description");
  }
  const whole = (v: unknown, min: number, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : null);
  const width = whole(raw.width, 16, MAX_SIDE);
  const height = whole(raw.height, 16, MAX_SIDE);
  const samples = whole(raw.samples, 1, MAX_SAMPLES);
  const shots = whole(raw.shots, 1, MAX_SHOTS);
  const minutes = typeof raw.minutes === "number" && raw.minutes >= 0 && raw.minutes <= 600 ? raw.minutes : null;
  if (width === null || height === null || samples === null || shots === null || minutes === null) fail(400, "The render job's size, samples or time limit is out of range");
  const name = typeof raw.name === "string" ? raw.name.trim().slice(0, 200) : "";
  return { name: name || "Untitled", width, height, samples, shots, minutes };
}

/** A call to the worker's endpoint, failing with a 502 the editor can show. */
async function worker(path: string, init: RequestInit = {}): Promise<Response> {
  const r = renderConfig();
  let res: Response;
  try {
    res = await fetch(r.url + path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${r.secret}` }, redirect: "follow" });
  } catch (e) {
    console.error("[render] the worker could not be reached", e);
    fail(502, "The render service could not be reached. Try again in a minute.", "render_down");
  }
  if (!res.ok) {
    console.error(`[render] ${init.method ?? "GET"} ${path}: ${res.status} ${await res.text().catch(() => "")}`);
    fail(502, "The render service turned the job down. Try again in a minute.", "render_down");
  }
  return res;
}

export function registerRender(app: Hono): void {
  app.post("/api/render/jobs", async (c) => {
    const user = requireUser(c);
    const r = renderConfig();
    const spec = newJobOf(c.req.header("x-render-job"));
    const busy = get<{ n: number }>("SELECT COUNT(*) AS n FROM render_jobs WHERE user_id = ? AND state IN ('starting', 'running')", user.id)?.n ?? 0;
    if (busy >= r.perUser) fail(429, `You have ${busy} cloud ${busy === 1 ? "render" : "renders"} running: wait for one to finish.`, "busy");

    // the job may run as long as its pictures' limits and the server allow, and the credit pays for
    const price = perSecond(user, r);
    const wanted = spec.minutes > 0 ? spec.minutes * 60 * spec.shots + OVERHEAD_SECONDS : r.maxMinutes * 60;
    let limit = Math.min(wanted, r.maxMinutes * 60);
    if (price > 0) {
      const free = freeCredit(user.id);
      const affordable = Math.floor(free / price);
      if (affordable < MIN_SECONDS) {
        fail(402, free <= 0 ? "You're out of credit. Top up to render in the cloud." : "There isn't enough credit for a cloud render. Top up to carry on.", "credit");
      }
      limit = Math.min(limit, affordable);
    }
    const id = newId();
    // the row holds the credit from now, so a second job started meanwhile sees it
    run(
      "INSERT INTO render_jobs (id, user_id, state, name, width, height, samples, shots, gpu, limit_seconds, hold, created_at) VALUES (?, ?, 'starting', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      user.id,
      spec.name,
      spec.width,
      spec.height,
      spec.samples,
      spec.shots,
      r.gpu,
      limit,
      Math.ceil(limit * price),
      nowIso(),
    );
    let tmp: string | null = null;
    try {
      const received = await receiveUpload(c.req.raw, user.id, config.maxUploadBytes, "The render job");
      tmp = received.tmp;
      const res = await worker(`/jobs?gpu=${encodeURIComponent(r.gpu)}&limit=${limit}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: fileStream(tmp),
        duplex: "half",
      } as RequestInit);
      const { call } = (await res.json()) as { call: string };
      run("UPDATE render_jobs SET call_id = ?, state = 'running' WHERE id = ?", call, id);
    } catch (e) {
      run("DELETE FROM render_jobs WHERE id = ?", id);
      throw e;
    } finally {
      if (tmp) await rm(tmp, { force: true });
    }
    return c.json({ job: jobOut(get<JobRow>("SELECT * FROM render_jobs WHERE id = ?", id)!) });
  });

  app.get("/api/render/jobs", (c) => {
    const user = requireUser(c);
    const rows = all<JobRow>("SELECT * FROM render_jobs WHERE user_id = ? AND state != 'starting' ORDER BY created_at DESC LIMIT 50", user.id);
    return c.json({ jobs: rows.map(jobOut) });
  });

  app.get("/api/render/jobs/:id", (c) => {
    const user = requireUser(c);
    return c.json({ job: jobOut(ownJob(user, c.req.param("id"))) });
  });

  // Finish now keeps the picture in hand; Cancel discards it (the time it ran is still charged)
  app.post("/api/render/jobs/:id/stop", async (c) => {
    const user = requireUser(c);
    const row = ownJob(user, c.req.param("id"));
    const mode = (await readJson(c)).mode;
    if (mode !== "finish" && mode !== "cancel") fail(400, "Stop with finish or cancel");
    if (row.state !== "running" || !row.call_id) return c.json({ job: jobOut(row) });
    // cancel outranks finish
    if (row.stop !== "cancel") run("UPDATE render_jobs SET stop = ? WHERE id = ?", mode, row.id);
    await worker(`/jobs/${encodeURIComponent(row.call_id)}/stop?mode=${mode}`, { method: "POST" });
    return c.json({ job: jobOut(ownJob(user, row.id)) });
  });

  app.get("/api/render/jobs/:id/pictures/:n", (c) => {
    const user = requireUser(c);
    const row = ownJob(user, c.req.param("id"));
    const n = Number(c.req.param("n"));
    const pictures = row.pictures ? (JSON.parse(row.pictures) as RenderPicture[]) : [];
    const picture = Number.isInteger(n) ? pictures[n] : undefined;
    if (!picture) fail(404, "No such picture", "not_found");
    return new Response(fileStream(picturePath(row.id, n, picture.mime)), {
      headers: { "Content-Type": picture.mime, "Content-Length": String(picture.bytes), "Cache-Control": "private, max-age=86400" },
    });
  });

  app.delete("/api/render/jobs/:id", async (c) => {
    const user = requireUser(c);
    const row = ownJob(user, c.req.param("id"));
    if (row.state === "running" || row.state === "starting") fail(409, "Stop the render before removing it", "busy");
    run("DELETE FROM render_jobs WHERE id = ?", row.id);
    await rm(picturesDir(row.id), { recursive: true, force: true });
    return c.json({ ok: true });
  });

  if (config.render) startPolling();
}

/** Asks the worker after each running job every POLL_MS, one round at a time. */
function startPolling(): void {
  let polling = false;
  const tick = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    try {
      for (const row of all<JobRow>("SELECT * FROM render_jobs WHERE state = 'running'")) {
        await pollJob(row).catch((e: unknown) => console.error(`[render] job ${row.id}:`, e));
      }
    } finally {
      polling = false;
    }
  };
  setInterval(() => void tick(), POLL_MS).unref();
}

async function pollJob(row: JobRow): Promise<void> {
  if (!row.call_id) return;
  const call = encodeURIComponent(row.call_id);
  const status = (await (await worker(`/jobs/${call}`)).json()) as WorkerStatus;
  if (status.state === "running") {
    // none before the page reports, and none for a moment after the worker clears it on finishing: the last is kept
    if (status.progress) run("UPDATE render_jobs SET progress = ? WHERE id = ? AND state = 'running'", JSON.stringify(status.progress), row.id);
    const age = (Date.now() - Date.parse(row.created_at)) / 1000;
    if (age > row.limit_seconds + STUCK_SECONDS) {
      await worker(`/jobs/${call}/stop?mode=kill`, { method: "POST" });
      finish(row, "failed", { error: "The render stopped answering, so it was stopped. Nothing was charged." });
    }
    return;
  }
  if (status.state === "failed") {
    console.error(`[render] job ${row.id} failed: ${status.error}`);
    finish(row, "failed", { error: "The render failed on the server. Nothing was charged." });
    return;
  }
  // the pictures come down before the job is closed: a restart meanwhile fetches them again
  await mkdir(picturesDir(row.id), { recursive: true });
  const pictures: RenderPicture[] = [];
  for (const [n, im] of status.images.entries()) {
    const res = await worker(`/jobs/${call}/images/${n}`);
    if (!res.body) throw new Error(`picture ${n} came without a body`);
    await pipeline(Readable.fromWeb(res.body as unknown as NodeWebReadableStream), createWriteStream(picturePath(row.id, n, im.mime)));
    pictures.push({ name: im.name, mime: im.mime, samples: im.samples, seconds: im.seconds, bytes: im.bytes });
  }
  const state: RenderState = pictures.length > 0 ? "done" : row.stop === "cancel" ? "cancelled" : "failed";
  finish(row, state, {
    seconds: status.seconds,
    pictures,
    error: state === "failed" ? "The render made no picture." : null,
  });
}

/**
 * Closes a running job, once: what it ran is charged (for its seconds and the container's start,
 * never more than it held; nothing when it failed) in the same step.
 */
function finish(row: JobRow, state: RenderState, out: { seconds?: number; pictures?: RenderPicture[]; error?: string | null }): void {
  const r = config.render;
  const c = config.credit;
  try {
    closeJob(row, state, out, r, c);
  } catch (e) {
    // closed by another round meanwhile: its charge stands, this one's was rolled back
    if (!(e instanceof AlreadyClosed)) throw e;
  }
}

class AlreadyClosed extends Error {}

function closeJob(
  row: JobRow,
  state: RenderState,
  out: { seconds?: number; pictures?: RenderPicture[]; error?: string | null },
  r: RenderConfig | null,
  c: typeof config.credit,
): void {
  tx(() => {
    const user = get<UserRow>("SELECT * FROM users WHERE id = ?", row.user_id);
    let charged: number | null = null;
    if (r && c && user && state !== "failed" && out.seconds !== undefined) {
      const seconds = Math.min(out.seconds + r.startupSeconds, row.limit_seconds);
      charged = chargeUsage(user, c, (seconds * r.usdPerHour) / 3600, { ref: row.id, model: `render ${row.gpu}` }).charged * MICRO;
    }
    const changed = run(
      "UPDATE render_jobs SET state = ?, finished_at = ?, seconds = ?, charged = ?, error = ?, pictures = ?, progress = NULL WHERE id = ? AND state = 'running'",
      state,
      nowIso(),
      out.seconds ?? null,
      charged === null ? null : Math.round(charged),
      out.error ?? null,
      JSON.stringify(out.pictures ?? []),
      row.id,
    );
    if (changed === 0) throw new AlreadyClosed();
  });
}

/** Drops finished jobs older than RENDER_KEEP_DAYS with their pictures, and jobs stuck starting (housekeeping). */
export async function sweepRenders(): Promise<void> {
  const r = config.render;
  const keepMs = (r?.keepDays ?? 7) * DAY;
  const old = all<{ id: string }>(
    "SELECT id FROM render_jobs WHERE (state NOT IN ('starting', 'running') AND created_at <= ?) OR (state = 'starting' AND created_at <= ?)",
    inMs(-keepMs),
    inMs(-STARTING_MS),
  );
  for (const { id } of old) {
    run("DELETE FROM render_jobs WHERE id = ?", id);
    await rm(picturesDir(id), { recursive: true, force: true });
  }
}
