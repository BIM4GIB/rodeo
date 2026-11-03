// Cloud renders from Render Image: the job is packed (pack.ts) and sent to the server, which makes
// it on a GPU (server/src/render.ts, cloudrender/worker.py) and charges the user's credit for the
// time. Its progress shows in the progress window, or after Keep working in File › Export › Cloud
// Renders…, and its pictures open in the render viewer.

import { h } from "../../app/dom.ts";
import type { Viz3D } from "../../app/heliodon.ts";
import { note, reportFailure } from "../../app/reports.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { View3D } from "../../app/view3d.ts";
import { ApiError, refreshUser, renders } from "../../platform/api.ts";
import type { RenderJob } from "../../platform/protocol.ts";
import { creditTerms, formatCredit, openCreditDialog } from "../account/credit.ts";
import { footButton, openModal, type Modal } from "../account/dialog.ts";
import { formatDate } from "../account/format.ts";
import { packJob, type PackShot } from "./pack.ts";
import { showProgress, type ProgressBox } from "./progress.ts";
import type { RenderSettings } from "./settings.ts";
import { formatSeconds, type StillPlan } from "./still.ts";
import { showRenderResult, type RenderResult } from "./viewer.ts";

/** What Render Image hands over for a cloud render. */
export interface CloudSpec {
  /** the drawing's name, for the list of renders */
  readonly name: string;
  readonly still: StillPlan;
  readonly settings: RenderSettings;
  readonly viz: Viz3D;
  readonly shots: readonly PackShot[];
}

const POLL_MS = 1500;
/** polls that may fail in a row (the network dropping for a moment) before the window gives up */
const POLL_FAILURES = 20;
const LIST_POLL_MS = 3000;
const WHERE_TO_FIND = "File › Export › Cloud Renders… shows it.";

function isRunning(job: RenderJob): boolean {
  return job.state === "running" || job.state === "starting";
}

/** Sends the job and follows it in the progress window; the pictures open in the viewer when made. */
export async function runCloudJob(view: View3D, spec: CloudSpec): Promise<void> {
  let asked: "finish" | "cancel" | null = null;
  let jobId: string | null = null;
  let watching = true;
  const tell = (mode: "finish" | "cancel"): void => {
    asked = mode;
    if (jobId) renders.stop(jobId, mode).catch((err: unknown) => toast(`Cloud render: ${errorMessage(err)}`));
  };
  const box = showProgress({
    finishable: true,
    onFinish: () => tell("finish"),
    onCancel: () => tell("cancel"),
    onKeepWorking: () => {
      watching = false;
      toast(`The render goes on in the cloud. ${WHERE_TO_FIND}`, "info");
    },
  });
  let job: RenderJob;
  try {
    box.label("Packing the model…");
    box.bar(null);
    const pack = await packJob(view, spec.still, spec.settings, spec.viz, spec.shots);
    if (asked === "cancel") return box.close();
    box.label(`Sending the model (${formatSize(pack.size)})…`);
    note(`cloud render: sending ${formatSize(pack.size)}, ${spec.still.width}×${spec.still.height}, ${spec.still.samples} samples`);
    job = await renders.start(
      { name: spec.name, width: spec.still.width, height: spec.still.height, samples: spec.still.samples, shots: spec.shots.length, minutes: spec.still.minutes },
      pack,
      (sent, total) => {
        if (total <= 8 * 1024 * 1024) return;
        box.label(`Sending the model (${formatSize(sent)} of ${formatSize(total)})…`);
        box.bar(sent / total);
      },
    );
    jobId = job.id;
    // Finish now or Cancel while the model was on its way
    if (asked) job = await renders.stop(job.id, asked);
    job = await follow(job, (j) => watching && showJob(box, j));
  } catch (err) {
    box.close();
    refused(err);
    return;
  }
  box.close();
  await settled(job, watching);
}

/** Polls the job until it ends, showing it as it goes; resolves with it ended. */
async function follow(job: RenderJob, show: (job: RenderJob) => void): Promise<RenderJob> {
  let failures = 0;
  show(job);
  while (isRunning(job)) {
    await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
    try {
      job = await renders.get(job.id);
      failures = 0;
    } catch (err) {
      if (++failures >= POLL_FAILURES) throw err;
      continue;
    }
    show(job);
  }
  return job;
}

let lastPreview: string | null = null;

/** A running job in the progress window: what it is doing, how far along, and its picture so far. */
function showJob(box: ProgressBox, job: RenderJob): void {
  const p = job.progress;
  box.label(job.state === "starting" || !p ? "Starting a GPU in the cloud…" : `Cloud GPU · ${p.label}`);
  box.bar(p?.fraction ?? null);
  const preview = p?.preview ?? null;
  if (preview && preview !== lastPreview) {
    lastPreview = preview;
    fetch(preview)
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b))
      .then((bitmap) => box.picture(bitmap))
      .catch(() => {
        // the picture so far is a nicety: the next one may decode
      });
  }
}

/** An ended job: its pictures in the viewer (or word of them), or why there are none. */
async function settled(job: RenderJob, watching: boolean): Promise<void> {
  void refreshUser().catch(() => {});
  const cost = costLine(job);
  if (job.state === "done") {
    if (!watching) {
      toast(`The cloud render of ${job.name} is ready${cost}. ${WHERE_TO_FIND}`, "info");
      return;
    }
    try {
      showRenderResult(await picturesOf(job));
      if (cost) toast(`Rendered in the cloud in ${formatSeconds(job.seconds ?? 0)}${cost}.`, "info");
    } catch (err) {
      toast(`The cloud render's pictures could not be fetched: ${errorMessage(err)}. ${WHERE_TO_FIND}`);
      reportFailure("cloud-render", err, { step: "fetching the pictures", job: job.id });
    }
  } else if (job.state === "cancelled") {
    toast(`Cloud render cancelled${cost}.`, "info");
  } else {
    toast(job.error ?? "The cloud render failed.");
    reportFailure("cloud-render", new Error(job.error ?? "The cloud render failed"), {
      job: job.id,
      size: `${job.width}×${job.height}`,
      samples: job.samples,
      seconds: job.seconds ?? null,
    });
  }
}

/** " · £0.04": what the job took from the credit, when it took anything. */
function costLine(job: RenderJob): string {
  const t = creditTerms();
  return job.charged !== null && job.charged > 0 && t ? ` · ${formatCredit(job.charged, t.currency)}` : "";
}

async function picturesOf(job: RenderJob): Promise<RenderResult[]> {
  return Promise.all(
    job.pictures.map(async (p, n) => ({
      blob: await renders.picture(job.id, n),
      width: job.width,
      height: job.height,
      name: p.name,
      engine: "Path traced" as const,
      samples: p.samples,
      seconds: p.seconds,
    })),
  );
}

/** Why the server would not start the job, with the way on where there is one. */
function refused(err: unknown): void {
  if (err instanceof ApiError && err.code === "credit") {
    toast(err.message);
    openCreditDialog();
    return;
  }
  toast(`Cloud render: ${errorMessage(err)}`);
  if (!(err instanceof ApiError && ["auth", "busy", "too_large"].includes(err.code ?? ""))) reportFailure("cloud-render", err, { step: "starting the job" });
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** File › Export › Cloud Renders…: the user's renders of the last days, each opened, stopped or removed here. */
export function openCloudRenders(): void {
  const list = h("div", { cls: "cloud-renders" }, h("p", { cls: "acct-lead", text: "Loading…" }));
  let timer = 0;
  let modal: Modal | null = null;
  const refresh = async (): Promise<void> => {
    window.clearTimeout(timer);
    let jobs: RenderJob[];
    try {
      jobs = await renders.list();
    } catch (err) {
      modal?.error(errorMessage(err));
      return;
    }
    modal?.error(null);
    list.replaceChildren(...(jobs.length ? jobs.map((j) => jobRow(j, refresh)) : [h("p", { cls: "acct-lead", text: "No cloud renders in the last few days." })]));
    if (jobs.some(isRunning)) timer = window.setTimeout(() => void refresh(), LIST_POLL_MS);
  };
  modal = openModal({
    title: "Cloud Renders",
    cls: "cloud-renders-dialog",
    body: [list],
    actions: [footButton("Close", false, () => modal?.close())],
    onClose: () => window.clearTimeout(timer),
  });
  void refresh();
}

function jobRow(job: RenderJob, refresh: () => Promise<void>): HTMLElement {
  const act = (label: string, run: () => Promise<unknown>): HTMLButtonElement =>
    footButton(label, false, () => {
      run()
        .then(() => refresh())
        .catch((err: unknown) => toast(`Cloud render: ${errorMessage(err)}`));
    });
  const buttons: HTMLButtonElement[] = [];
  if (job.state === "done") {
    const open = act("Open", async () => showRenderResult(await picturesOf(job)));
    open.classList.add("primary");
    buttons.push(open);
  }
  if (isRunning(job)) {
    if (!job.stop) buttons.push(act("Finish now", () => renders.stop(job.id, "finish")));
    if (job.stop !== "cancel") buttons.push(act("Cancel", () => renders.stop(job.id, "cancel")));
  } else {
    buttons.push(act("Remove", () => renders.remove(job.id)));
  }
  const size = `${job.width} × ${job.height} · ${job.samples} samples${job.shots > 1 ? ` · ${job.shots} cameras` : ""}`;
  return h(
    "div",
    { cls: "cloud-render-row" },
    job.progress?.preview ? h("img", { cls: "cloud-render-thumb", attrs: { src: job.progress.preview, alt: "" } }) : null,
    h(
      "div",
      { cls: "cloud-render-text" },
      h("p", { cls: "cloud-render-name", text: job.name }),
      h("p", { cls: "cloud-render-meta", text: `${formatDate(job.createdAt)} · ${size}` }),
      h("p", { cls: "cloud-render-state", text: stateLine(job) }),
    ),
    h("div", { cls: "cloud-render-actions" }, ...buttons),
  );
}

function stateLine(job: RenderJob): string {
  const cost = costLine(job);
  switch (job.state) {
    case "starting":
      return "Sending…";
    case "running":
      if (job.stop === "cancel") return "Cancelling…";
      if (job.stop === "finish") return "Finishing…";
      return job.progress?.label || "Starting a GPU…";
    case "done":
      return `Done in ${formatSeconds(job.seconds ?? 0)}${cost}`;
    case "cancelled":
      return `Cancelled${cost}`;
    default:
      return job.error ?? "Failed";
  }
}
