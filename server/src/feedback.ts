// Bug reports and feature requests: anyone can send one (POST /api/feedback, signed in or not,
// rate limited by address); admins read them in the editor (Help > Feedback Inbox…), mark them
// done and delete them. With SMTP set up, each report is also emailed to ADMIN_EMAILS, with
// Reply-To set to the sender's address when they gave one.
//
// A report can carry diagnostics (the browser, GPU, what the editor said just before) and, when
// the sender leaves them on, a screenshot and the file it is about. Those follow the report: its
// answer gives a token good for an hour, the screenshot goes in one PUT and the file in parts
// (PUT /api/feedback/:id/file?offset=n, as uploads.ts takes drawings), so a large drawing gets
// past Cloudflare's 100 MB a request without the sender having to sign in. Attachments are kept
// for 90 days, and all of them together at most FEEDBACK_FILES_MAX; past that a report goes
// without its file. Admins, or a script with REPORTS_TOKEN (server/scripts/feedback.ts), fetch
// them from /api/admin/feedback/:id/screenshot and /file.

import { createWriteStream } from "node:fs";
import { rm, truncate } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import type { Context, Hono } from "hono";
import {
  FEEDBACK_CONTEXT_KEYS,
  type Feedback,
  type FeedbackContext,
  type FeedbackDiagnostics,
  type FeedbackKind,
  type FeedbackSent,
  type ReportValue,
} from "../../web/src/platform/protocol.ts";
import { allowed, clientIp, currentUser, isAdmin, normalizeEmail, requireUser } from "./auth.ts";
import { blobPath, blobSize, commitBlob, headBytes, receiveBody } from "./blobs.ts";
import { config } from "./config.ts";
import { all, get, run } from "./db.ts";
import { readJson } from "./http.ts";
import { sendMail } from "./mail.ts";
import { cleanBody, cleanLine, DAY, fail, fileStream, formatBytes, HOUR, inMs, MB, newId, newToken, nowIso, safeEqual } from "./util.ts";

const KINDS: readonly FeedbackKind[] = ["bug", "idea", "other"];
const KIND_LABEL: Record<FeedbackKind, string> = { bug: "Bug report", idea: "Feature request", other: "Feedback" };
const MAX_MESSAGE = 4000;
/** the inbox shows at most this many reports */
const LISTED = 500;
const MAX_SCREENSHOT = 8 * MB;
/** the largest part of a file taken in one request: under what Cloudflare lets through */
const MAX_PART = 64 * MB;
/** screenshots and files are deleted this long after the report came */
const KEEP_ATTACHMENTS = 90 * DAY;
/** how long after its last part an attachment may still arrive */
const PENDING_FOR = HOUR;

const SELECT = `SELECT f.id, f.kind, f.message, f.email, f.context_json, f.diagnostics_json, f.status, f.created_at,
  f.screenshot_blob, f.file_blob, f.file_name, f.file_size, f.file_received, u.name AS user_name
  FROM feedback f LEFT JOIN users u ON u.id = f.user_id`;

interface FeedbackRow {
  id: string;
  kind: string;
  message: string;
  email: string | null;
  context_json: string;
  diagnostics_json: string | null;
  status: string;
  created_at: string;
  screenshot_blob: string | null;
  file_blob: string | null;
  file_name: string | null;
  file_size: number | null;
  file_received: number;
  user_name: string | null;
}

/** What may still arrive for a report just sent, and the token that lets it. */
interface Pending {
  readonly token: string;
  touched: number;
  screenshot: boolean;
  file: { readonly tmp: string; readonly total: number; size: number; busy: boolean } | null;
}

const pending = new Map<string, Pending>();

function parseKind(v: unknown): FeedbackKind {
  if (!KINDS.includes(v as FeedbackKind)) fail(400, "kind must be bug, idea or other");
  return v as FeedbackKind;
}

/** The known details only, each one line and short. */
function parseContext(v: unknown): FeedbackContext {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return {};
  const raw = v as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const key of FEEDBACK_CONTEXT_KEYS) {
    const value = cleanLine(raw[key], 300);
    if (value) out[key] = value;
  }
  return out;
}

/** A flat record of short values: at most 40 of them, each key a word. */
function parseValues(v: unknown): Record<string, ReportValue> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: Record<string, ReportValue> = {};
  for (const [key, value] of Object.entries(v).slice(0, 40)) {
    if (!/^[A-Za-z0-9_]{1,40}$/.test(key)) continue;
    if (typeof value === "string") out[key] = cleanLine(value, 300);
    else if ((typeof value === "number" && Number.isFinite(value)) || typeof value === "boolean" || value === null) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseDiagnostics(v: unknown): FeedbackDiagnostics | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const raw = v as Record<string, unknown>;
  const trail = Array.isArray(raw.trail) ? raw.trail.slice(-60).map((t) => cleanLine(t, 400)).filter(Boolean) : [];
  const out: FeedbackDiagnostics = {
    env: parseValues(raw.env),
    workspace: parseValues(raw.workspace),
    ...(trail.length > 0 ? { trail } : {}),
  };
  return out.env || out.workspace || out.trail ? out : null;
}

/** A file's name as it can be kept and offered for download: no folders, no control characters. */
function cleanFileName(v: unknown): string {
  const name = cleanLine(v, 200).replace(/[\\/:*?"<>|]+/g, "-");
  return name || "file";
}

function feedbackOut(r: FeedbackRow): Feedback {
  const diagnostics = r.diagnostics_json ? (JSON.parse(r.diagnostics_json) as FeedbackDiagnostics) : null;
  return {
    id: r.id,
    kind: KINDS.includes(r.kind as FeedbackKind) ? (r.kind as FeedbackKind) : "other",
    message: r.message,
    email: r.email,
    context: JSON.parse(r.context_json) as FeedbackContext,
    ...(diagnostics ? { diagnostics } : {}),
    userName: r.user_name,
    status: r.status === "done" ? "done" : "new",
    createdAt: r.created_at,
    screenshot: r.screenshot_blob !== null,
    file: r.file_name !== null ? { name: r.file_name, size: r.file_size ?? 0, received: r.file_blob ? (r.file_size ?? 0) : r.file_received } : null,
  };
}

/** Emails a new report to the admins; a failure is logged, since the report is already saved. */
function notifyAdmins(
  kind: FeedbackKind,
  message: string,
  email: string | null,
  from: string | null,
  context: FeedbackContext,
  diagnostics: FeedbackDiagnostics | null,
  attached: string[],
): void {
  if (!config.smtpUrl || config.admins.size === 0) return;
  const firstLine = message.split("\n", 1)[0] ?? "";
  const subject = `Rodeo ${KIND_LABEL[kind].toLowerCase()}: ${firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine}`;
  const details = Object.entries(context).map(([k, v]) => `${k}: ${v}`);
  const env = Object.entries(diagnostics?.env ?? {}).map(([k, v]) => `${k}: ${String(v)}`);
  const trail = diagnostics?.trail?.slice(-15) ?? [];
  const text = [
    message,
    "",
    "—",
    `From: ${from ?? "someone not signed in"}${email ? ` <${email}>` : ""}`,
    ...details,
    ...(attached.length > 0 ? ["", `Sent with ${attached.join(" and ")} (arriving now).`] : []),
    ...(env.length > 0 ? ["", ...env] : []),
    ...(trail.length > 0 ? ["", "Just before:", ...trail.map((t) => `  ${t}`)] : []),
    "",
    `Every report is in the editor under Help > Feedback Inbox… (${config.publicUrl}).`,
  ].join("\n");
  for (const to of config.admins) {
    sendMail(to, subject, text, email ?? undefined).catch((err: unknown) => console.error(`[feedback] could not email ${to}:`, err));
  }
}

/** An admin signed in, or a script with REPORTS_TOKEN. */
function requireReader(c: Context): void {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token && config.reportsToken && safeEqual(token, config.reportsToken)) return;
  if (!isAdmin(requireUser(c))) fail(403, "Only admins can read feedback", "forbidden");
}

/** The report's attachments still to come, for the sender holding its token. */
function ownPending(c: Context): { id: string; p: Pending } {
  const id = c.req.param("id") ?? "";
  const p = pending.get(id);
  const token = c.req.header("x-feedback-token") ?? "";
  if (!p || !token || !safeEqual(token, p.token)) fail(404, "That report no longer takes attachments", "not_found");
  p.touched = Date.now();
  return { id, p };
}

/** What files sent with reports take now, kept and on their way. */
function filesStored(): number {
  const kept = get<{ n: number }>("SELECT COALESCE(SUM(file_size), 0) AS n FROM feedback WHERE file_blob IS NOT NULL")?.n ?? 0;
  let coming = 0;
  for (const p of pending.values()) coming += p.file?.total ?? 0;
  return kept + coming;
}

/** Why a report can't bring a file of `size` bytes, or null when it can. */
function fileRefusal(size: number): string | null {
  if (size > config.maxUploadBytes) return `The file is larger than the ${formatBytes(config.maxUploadBytes)} a report can bring`;
  if (filesStored() + size > config.feedbackFilesMax) return "We can't take more files with reports just now";
  return null;
}

async function dropPending(id: string): Promise<void> {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  if (p.file) await rm(p.file.tmp, { force: true });
}

async function removeBlobs(...ids: (string | null)[]): Promise<void> {
  for (const id of ids) if (id) await rm(blobPath(id), { force: true });
}

/** Drops attachments that stopped arriving, and those of reports older than 90 days (housekeeping). */
export async function sweepFeedback(): Promise<void> {
  const stale = Date.now() - PENDING_FOR;
  for (const [id, p] of pending) if (!p.file?.busy && p.touched < stale) await dropPending(id);
  const old = all<{ id: string; screenshot_blob: string | null; file_blob: string | null }>(
    "SELECT id, screenshot_blob, file_blob FROM feedback WHERE created_at <= ? AND (screenshot_blob IS NOT NULL OR file_blob IS NOT NULL)",
    inMs(-KEEP_ATTACHMENTS),
  );
  for (const r of old) {
    run("UPDATE feedback SET screenshot_blob = NULL, file_blob = NULL WHERE id = ?", r.id);
    await removeBlobs(r.screenshot_blob, r.file_blob);
  }
}

/** The kind of picture a screenshot is, from its first bytes; null when it is neither. */
function pictureType(head: Buffer): string | null {
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.subarray(0, 4).toString("latin1") === "\x89PNG") return "image/png";
  return null;
}

export function registerFeedback(app: Hono): void {
  app.post("/api/feedback", async (c) => {
    const body = await readJson(c, 160 * 1024);
    const user = currentUser(c);
    if (!allowed(`feedback:${clientIp(c)}`, 10, HOUR) || (user && !allowed(`feedback-user:${user.id}`, 10, HOUR))) {
      fail(429, "That's a lot of reports in an hour. Try again later.", "rate_limited");
    }
    // a field people never see, which form-filling bots do: their report is dropped quietly
    if (cleanLine(body.website, 10)) return c.json({ ok: true }, 201);
    const kind = parseKind(body.kind);
    const message = cleanBody(body.message, MAX_MESSAGE).replace(/\n{3,}/g, "\n\n");
    if (message.length < 3) fail(400, "Write a few words about it first");
    let email: string | null = null;
    if (body.email !== undefined && body.email !== null && body.email !== "") {
      email = normalizeEmail(body.email);
      if (!email) fail(400, "Enter a valid email address, or leave it empty");
    }
    const context = parseContext(body.context);
    const diagnostics = parseDiagnostics(body.diagnostics);

    const attach = typeof body.attach === "object" && body.attach !== null ? (body.attach as Record<string, unknown>) : {};
    const screenshot = attach.screenshot === true;
    const fileIn = typeof attach.file === "object" && attach.file !== null ? (attach.file as Record<string, unknown>) : null;
    const fileSize = Number(fileIn?.size);
    const wantsFile = fileIn !== null && Number.isSafeInteger(fileSize) && fileSize > 0;
    const fileRefused = wantsFile ? fileRefusal(fileSize) : null;
    const file = wantsFile && !fileRefused ? { name: cleanFileName(fileIn.name), size: fileSize } : null;

    const id = newId();
    run(
      `INSERT INTO feedback (id, kind, message, email, user_id, context_json, diagnostics_json, status, created_at, file_name, file_size)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
      id,
      kind,
      message,
      email,
      user?.id ?? null,
      JSON.stringify(context),
      diagnostics ? JSON.stringify(diagnostics) : null,
      nowIso(),
      file?.name ?? null,
      file?.size ?? null,
    );
    let token: string | null = null;
    if (screenshot || file) {
      token = newToken();
      pending.set(id, {
        token,
        touched: Date.now(),
        screenshot,
        file: file && { tmp: join(config.tmpDir, `feedback-${id}`), total: file.size, size: 0, busy: false },
      });
    }
    const attached = [...(screenshot ? ["a screenshot"] : []), ...(file ? [`${file.name} (${formatBytes(file.size)})`] : [])];
    notifyAdmins(kind, message, email, user?.name ?? null, context, diagnostics, attached);
    const sent: FeedbackSent & { ok: true } = { ok: true, id, token, fileRefused };
    return c.json(sent, 201);
  });

  app.put("/api/feedback/:id/screenshot", async (c) => {
    const { id, p } = ownPending(c);
    if (!p.screenshot) fail(409, "This report's screenshot has arrived already", "conflict");
    const got = await receiveBody(c.req.raw, MAX_SCREENSHOT, "The screenshot");
    if (!pictureType(await headBytes(got.tmp, 8))) {
      await rm(got.tmp, { force: true });
      fail(400, "The screenshot must be a JPEG or PNG");
    }
    const blob = await commitBlob(got);
    p.screenshot = false;
    run("UPDATE feedback SET screenshot_blob = ? WHERE id = ?", blob, id);
    if (!p.file) pending.delete(id);
    return c.json({ ok: true });
  });

  app.get("/api/feedback/:id/file", (c) => {
    const { p } = ownPending(c);
    if (!p.file) fail(404, "This report takes no file", "not_found");
    return c.json({ size: p.file.size, total: p.file.total });
  });

  app.put("/api/feedback/:id/file", async (c) => {
    const { id, p } = ownPending(c);
    const f = p.file;
    if (!f) fail(404, "This report takes no file", "not_found");
    const offset = Number(c.req.query("offset"));
    if (f.busy) fail(409, "A part of this file is arriving already", "conflict");
    if (offset !== f.size) fail(409, `The next part starts at byte ${f.size}`, "offset");
    if (!c.req.raw.body) fail(400, "Nothing was uploaded");
    f.busy = true;
    let got = 0;
    try {
      await pipeline(
        Readable.fromWeb(c.req.raw.body as unknown as NodeWebReadableStream),
        async function* (source) {
          for await (const chunk of source) {
            got += chunk.byteLength;
            if (got > MAX_PART) fail(413, `A part is larger than ${formatBytes(MAX_PART)}`, "too_large");
            if (f.size + got > f.total) fail(400, "The file is longer than it was said to be");
            yield chunk;
          }
        },
        createWriteStream(f.tmp, { flags: "a" }),
      );
      f.size += got;
    } catch (e) {
      // what arrived of this part goes, so it can be sent again from the same offset
      await truncate(f.tmp, f.size).catch(() => undefined);
      throw e;
    } finally {
      f.busy = false;
      p.touched = Date.now();
    }
    if (f.size < f.total) {
      run("UPDATE feedback SET file_received = ? WHERE id = ?", f.size, id);
      return c.json({ size: f.size, total: f.total });
    }
    const blob = await commitBlob({ tmp: f.tmp });
    p.file = null;
    run("UPDATE feedback SET file_blob = ?, file_received = ? WHERE id = ?", blob, f.size, id);
    if (!p.screenshot) pending.delete(id);
    return c.json({ size: f.size, total: f.total });
  });

  app.get("/api/admin/feedback", (c) => {
    requireReader(c);
    const rows = all<FeedbackRow>(`${SELECT} ORDER BY f.created_at DESC LIMIT ?`, LISTED);
    return c.json({ feedback: rows.map(feedbackOut) });
  });

  app.get("/api/admin/feedback/:id/screenshot", async (c) => {
    requireReader(c);
    const row = get<{ screenshot_blob: string | null }>("SELECT screenshot_blob FROM feedback WHERE id = ?", c.req.param("id"));
    const size = row?.screenshot_blob ? await blobSize(row.screenshot_blob) : null;
    if (!row?.screenshot_blob || size === null) fail(404, "No screenshot", "not_found");
    const path = blobPath(row.screenshot_blob);
    c.header("Content-Type", pictureType(await headBytes(path, 8)) ?? "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header("Cache-Control", "private, max-age=3600");
    return c.body(fileStream(path));
  });

  app.get("/api/admin/feedback/:id/file", async (c) => {
    requireReader(c);
    const row = get<{ file_blob: string | null; file_name: string | null }>("SELECT file_blob, file_name FROM feedback WHERE id = ?", c.req.param("id"));
    const size = row?.file_blob ? await blobSize(row.file_blob) : null;
    if (!row?.file_blob || size === null) fail(404, "No file, or it has not all arrived", "not_found");
    const name = row.file_name ?? "file";
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    c.header("Cache-Control", "private, no-store");
    return c.body(fileStream(blobPath(row.file_blob)));
  });

  app.patch("/api/admin/feedback/:id", async (c) => {
    requireReader(c);
    const body = await readJson(c);
    if (body.status !== "new" && body.status !== "done") fail(400, "status must be new or done");
    const id = c.req.param("id");
    run("UPDATE feedback SET status = ? WHERE id = ?", body.status, id);
    const row = get<FeedbackRow>(`${SELECT} WHERE f.id = ?`, id);
    if (!row) fail(404, "Report not found", "not_found");
    return c.json({ feedback: feedbackOut(row) });
  });

  app.delete("/api/admin/feedback/:id", async (c) => {
    requireReader(c);
    const id = c.req.param("id");
    const row = get<{ screenshot_blob: string | null; file_blob: string | null }>("SELECT screenshot_blob, file_blob FROM feedback WHERE id = ?", id);
    if (!row || run("DELETE FROM feedback WHERE id = ?", id) === 0) fail(404, "Report not found", "not_found");
    await dropPending(id);
    await removeBlobs(row.screenshot_blob, row.file_blob);
    return c.json({ ok: true });
  });
}
