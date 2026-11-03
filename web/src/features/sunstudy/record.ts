// File > Export Sun Study…: records the day at the study's date, from 08:00 to 18:00 every 30
// minutes by default (all editable), as an animated GIF or a video (MP4 or WebM, whichever the
// browser records). Each frame sets the solar time through the Visualization settings, renders the
// 3D view and draws it into a canvas at most 960 px wide, with the date and time in a corner. The
// settings are put back afterwards, and Cancel stops between frames. gifenc and MediaRecorder are
// used only here, and gifenc loads when a GIF is made.

import { downloadBlob } from "../../app/fileio.ts";
import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { dayLabel, hourLabel } from "../../app/heliodon.ts";
import { showDialog } from "../../app/menubar.ts";
import { setViz, store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { View3D } from "../../app/view3d.ts";
import { pausePlayback } from "./bar.ts";
import { monthDay } from "./sun.ts";
import "./sunstudy.css";

const MAX_WIDTH = 960;
const MAX_FRAMES = 300;
const VIDEO_TYPES = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];

interface Options {
  /** the first and last solar times, in minutes after midnight */
  readonly fromMin: number;
  readonly toMin: number;
  readonly stepMin: number;
  readonly video: boolean;
  /** how long each frame stays on screen */
  readonly seconds: number;
}

/** File > Export Sun Study…: asks the times and the format, then records the day and downloads it. */
export async function recordSunStudy(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const options = await askOptions(canRecordVideo());
  if (!options) return;
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view || !store.session) return;

  pausePlayback();
  const day = store.viz3d.dayOfYear;
  const hours = frameHours(options);
  const restore = store.viz3d;
  const job = { cancelled: false };
  const progress = showProgress(hours.length, () => {
    job.cancelled = true;
  });
  const out = document.createElement("canvas");
  const frameAt = (i: number): void => renderFrame(view, out, day, hours[i]);
  try {
    setViz({ sun: "heliodon", shadows: true });
    const base = store.fileName.replace(/\.vwx$/i, "");
    const name = `${base}-sun-${monthDay(day)}`;
    if (options.video) {
      const blob = await recordVideo(out, hours.length, frameAt, options.seconds, job, progress.update);
      if (blob && !job.cancelled) downloadBlob(`${name}.${blob.type.includes("mp4") ? "mp4" : "webm"}`, blob);
    } else {
      const bytes = await encodeGif(out, hours.length, frameAt, options.seconds, job, progress.update);
      if (bytes && !job.cancelled) downloadBlob(`${name}.gif`, new Blob([new Uint8Array(bytes)], { type: "image/gif" }));
    }
  } catch (err) {
    toast(`The Sun Study export failed: ${errorMessage(err)}`);
  } finally {
    setViz(restore);
    progress.close();
  }
}

/** Sets the solar time, renders the 3D view and draws it, with the date and time, into `out`. */
function renderFrame(view: View3D, out: HTMLCanvasElement, day: number, hour: number): void {
  setViz({ hour });
  view.renderNow();
  drawFrame(out, view.domElement, `${dayLabel(day)}  ${hourLabel(hour)} solar`);
}

/** Copies the 3D view into `out` at most MAX_WIDTH wide (even sizes), with the label in its top-left corner. */
function drawFrame(out: HTMLCanvasElement, src: HTMLCanvasElement, label: string): void {
  const w = evenSize(Math.min(MAX_WIDTH, src.width));
  const height = evenSize(Math.round((src.height * w) / src.width));
  if (out.width !== w) out.width = w;
  out.height = height;
  // the frames are read back for the GIF, so the context is kept in software
  const ctx = out.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("the browser cannot draw the frames");
  ctx.drawImage(src, 0, 0, w, height);
  const size = Math.max(12, Math.round(w / 48));
  const pad = Math.round(size * 0.6);
  ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
  ctx.fillRect(pad / 2, pad / 2, ctx.measureText(label).width + pad, size + pad);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, pad, pad);
}

function evenSize(n: number): number {
  return Math.max(2, n - (n % 2));
}

/** The frame times in solar hours, from the first to the last at the step. */
function frameHours(options: Options): number[] {
  const out: number[] = [];
  for (let m = options.fromMin; m <= options.toMin; m += options.stepMin) out.push(m / 60);
  return out;
}

async function encodeGif(
  out: HTMLCanvasElement,
  count: number,
  frameAt: (i: number) => void,
  seconds: number,
  job: { cancelled: boolean },
  update: (done: number) => void,
): Promise<Uint8Array | null> {
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const gif = GIFEncoder();
  const delay = Math.round(seconds * 1000);
  for (let i = 0; i < count; i++) {
    if (job.cancelled) return null;
    frameAt(i);
    const ctx = out.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("the browser cannot read the frames");
    const { data, width, height } = ctx.getImageData(0, 0, out.width, out.height);
    const palette = quantize(data, 256);
    gif.writeFrame(applyPalette(data, palette), width, height, { palette, delay, repeat: 0 });
    update(i + 1);
    await nextTask();
  }
  gif.finish();
  return gif.bytes();
}

/** Records the frames as a video: each frame is shown for `seconds`. */
async function recordVideo(
  out: HTMLCanvasElement,
  count: number,
  frameAt: (i: number) => void,
  seconds: number,
  job: { cancelled: boolean },
  update: (done: number) => void,
): Promise<Blob | null> {
  const mime = pickVideoMime();
  if (!mime) throw new Error("this browser cannot record video");
  // with requestFrame, each frame is captured as it is drawn; otherwise the canvas is captured as it changes
  const manual = typeof CanvasCaptureMediaStreamTrack !== "undefined" && "requestFrame" in CanvasCaptureMediaStreamTrack.prototype;
  const stream = out.captureStream(manual ? 0 : 30);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.addEventListener("dataavailable", (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  });
  const stopped = new Promise<void>((resolve) => recorder.addEventListener("stop", () => resolve(), { once: true }));
  recorder.start();
  const hold = Math.round(seconds * 1000);
  try {
    for (let i = 0; i < count && !job.cancelled; i++) {
      frameAt(i);
      if (manual) track.requestFrame();
      update(i + 1);
      await sleep(hold);
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    await stopped;
    for (const t of stream.getTracks()) t.stop();
  }
  if (job.cancelled) return null;
  return new Blob(chunks, { type: recorder.mimeType || mime });
}

function canRecordVideo(): boolean {
  return pickVideoMime() !== null;
}

function pickVideoMime(): string | null {
  if (typeof MediaRecorder === "undefined" || typeof HTMLCanvasElement.prototype.captureStream !== "function") return null;
  return VIDEO_TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Minutes after midnight of a "HH:MM" time, or null when it is not one. */
function minutesOf(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  return hh < 24 && mm < 60 ? hh * 60 + mm : null;
}

function frameCount(fromMin: number, toMin: number, stepMin: number): number {
  return Math.floor((toMin - fromMin) / stepMin) + 1;
}

/** The dialog: the times, the step, the seconds per frame and the format. Resolves with the options, or null. */
function askOptions(canVideo: boolean): Promise<Options | null> {
  const from = h("input", { cls: "menu-dialog-input sunstudy-time", value: "08:00", attrs: { type: "time", step: "900", "aria-label": "From" } });
  const to = h("input", { cls: "menu-dialog-input sunstudy-time", value: "18:00", attrs: { type: "time", step: "900", "aria-label": "To" } });
  const every = h("input", {
    cls: "menu-dialog-input sunstudy-num",
    value: "30",
    attrs: { type: "number", min: "5", max: "240", step: "5", "aria-label": "Every (minutes)" },
  });
  const seconds = h("input", {
    cls: "menu-dialog-input sunstudy-num",
    value: "0.5",
    attrs: { type: "number", min: "0.1", max: "5", step: "0.1", "aria-label": "Seconds per frame" },
  });
  const format = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Format" } },
    h("option", { text: "Animated GIF", value: "gif" }),
    h("option", { text: "Video (MP4 or WebM)", value: "video" }),
  );
  const videoOption = format.options[1];
  videoOption.disabled = !canVideo;
  const count = h("p", { cls: "sunstudy-hint" });

  const update = (): void => {
    const a = minutesOf(from.value);
    const b = minutesOf(to.value);
    const step = Number(every.value);
    if (a === null || b === null || b <= a || !Number.isInteger(step) || step < 5) {
      count.textContent = "";
      return;
    }
    const n = frameCount(a, b, step);
    count.textContent = `${n} ${n === 1 ? "frame" : "frames"} of the sun at ${hourLabel(a / 60)} to ${hourLabel(b / 60)}.`;
  };
  for (const el of [from, to, every, seconds]) el.addEventListener("input", update);
  format.addEventListener("change", update);
  update();

  const field = (label: string, control: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);

  return showDialog<Options>({
    title: "Export Sun Study",
    okLabel: "Export",
    cls: "sunstudy-dialog",
    body: [
      h("p", { cls: "sunstudy-hint", text: "Records the day at the date and place of the Sun Study, as the sun moves between these times." }),
      field("From (solar time)", from),
      field("To (solar time)", to),
      field("Every (minutes)", every),
      field("Seconds per frame", seconds),
      field("Format", format),
      count,
    ],
    check: () => {
      const fromMin = minutesOf(from.value);
      const toMin = minutesOf(to.value);
      if (fromMin === null || toMin === null) return { error: "Enter the times as hours and minutes.", focus: fromMin === null ? from : to };
      if (toMin <= fromMin) return { error: "The end time must be after the start time.", focus: to };
      const stepMin = Number(every.value);
      if (!Number.isInteger(stepMin) || stepMin < 5 || stepMin > 240) return { error: "Every: a whole number of minutes from 5 to 240.", focus: every };
      const secs = Number(seconds.value);
      if (!(secs >= 0.1 && secs <= 5)) return { error: "Seconds per frame: a number from 0.1 to 5.", focus: seconds };
      const n = frameCount(fromMin, toMin, stepMin);
      if (n > MAX_FRAMES) return { error: `At most ${MAX_FRAMES} frames: use a longer step.`, focus: every };
      return { value: { fromMin, toMin, stepMin, video: format.value === "video", seconds: secs } };
    },
  });
}

/** The progress box over the window, with Cancel. */
function showProgress(total: number, onCancel: () => void): { update(done: number): void; close(): void } {
  const label = h("p", { cls: "sunstudy-progress-label", text: `Recording frame 0 of ${total}…` });
  const bar = h("progress", { cls: "sunstudy-bar", attrs: { max: String(total), value: "0" } });
  const cancel = h("button", { cls: "btn", text: "Cancel", attrs: { type: "button" } });
  cancel.addEventListener("click", () => {
    cancel.disabled = true;
    label.textContent = "Stopping…";
    onCancel();
  });
  const backdrop = h(
    "div",
    { cls: "menu-dialog-backdrop" },
    h(
      "div",
      { cls: "menu-dialog sunstudy-progress", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Exporting the Sun Study" } },
      h("h2", { cls: "menu-dialog-title", text: "Export Sun Study" }),
      label,
      bar,
      h("div", { cls: "menu-dialog-actions" }, cancel),
    ),
  );
  document.body.append(backdrop);
  return {
    update(done: number): void {
      label.textContent = `Recording frame ${done} of ${total}…`;
      bar.value = done;
    },
    close(): void {
      backdrop.remove();
    },
  };
}
