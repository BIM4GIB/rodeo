// Render's queue: the pictures Render makes, one job after another, while the editor stays free. Each
// job is a card in a tray at the window's bottom right: its picture so far (then the finished one), its
// shot and size, a bar and a line of progress, and Finish now or Cancel while it runs, Open or a
// dismiss once it ends. The jobs run through makePictures (finalRender.ts); when the queue's last job
// is done its pictures open in the render viewer (viewer.ts). While a job runs, the live Path Traced
// view stops (bridge.ts). This module loads with the first render, not with the editor.

import { h } from "../../../app/dom.ts";
import { appContext, registerLeaveGuard } from "../../../app/ext.ts";
import { reportFailure } from "../../../app/reports.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { setRenderBusy } from "../bridge.ts";
import { EngineRefusal } from "../engines.ts";
import { makePictures, planDetails, type Plan } from "../finalRender.ts";
import { formatSeconds, type Job, type StillBox } from "../still.ts";
import { showRenderResult, type RenderResult } from "../viewer.ts";
import { QUALITY } from "./output.ts";
import { onStudio, studioOn } from "./state.ts";
import { button, icon } from "./ui.ts";
import "./queue.css";

type Status = "waiting" | "running" | "done" | "failed" | "cancelled";

/** One job of the queue: its plan, its pictures so far, and its card in the tray. */
interface Entry {
  readonly id: number;
  readonly plan: Plan;
  /** the shot's name on the card: "Current view", a camera's, or "3 shots" */
  readonly name: string;
  /** "3840 × 2160 · Photoreal · Good" */
  readonly meta: string;
  /** Finish now works on it: a path-traced picture of its own */
  readonly finishable: boolean;
  /** Cancel and Finish now, as makePictures reads them */
  readonly control: Job;
  /** where its progress shows: the card */
  readonly box: StillBox;
  /** the pictures made so far, in order */
  readonly results: RenderResult[];
  status: Status;
  /** the line of progress, or what went wrong */
  text: string;
  /** the bar's fill from 0 to 1, or null while the work has no measure */
  fraction: number | null;
  /** when the job began (performance.now()), 0 while it waits */
  started: number;
  /** where its pictures begin in the session's list, once it has some */
  first: number;
  /** how many of its pictures the thumbnail has shown (its last one) */
  shown: number;
  finishing: boolean;
  stopping: boolean;
  /** the buttons as last built: they are rebuilt only when this changes, so a click lands */
  actionKey: string;
  readonly el: HTMLElement;
  readonly thumb: HTMLCanvasElement;
  readonly art: HTMLElement;
  readonly bar: HTMLElement;
  readonly fill: HTMLElement;
  readonly line: HTMLElement;
  readonly actions: HTMLElement;
}

/** The tray and the parts of it that change. */
interface Tray {
  readonly el: HTMLElement;
  readonly list: HTMLElement;
  readonly count: HTMLElement;
  readonly fold: HTMLButtonElement;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

/** A thumbnail is drawn this wide at most: twice its column's width in pixels, so it stays sharp on a Retina screen. */
const THUMB_WIDTH = 208;
/** the tray's gap to the window's edges and the palettes beside it */
const TRAY_EDGE = 16;

const queue: Entry[] = [];
/** every picture made this session, in order (sessionResults; the viewer's list) */
const session: RenderResult[] = [];
let nextId = 1;
let working = false;
let tray: Tray | null = null;
let folded = false;

// a render still running (or waiting) keeps the drawing in front: the editor says so when asked to leave it
registerLeaveGuard(() => (queue.some((e) => e.status === "running" || e.status === "waiting") ? "A render is still running." : null));

/** Adds a render to the queue; it starts at once when nothing else is being made. */
export function enqueue(plan: Plan): void {
  queue.push(newEntry(plan));
  tray ??= buildTray();
  // a new render shows its card
  setFolded(false);
  paint();
  if (!working) void run();
}

/** Every picture made this session, in order (the viewer shows them all). */
export function sessionResults(): readonly RenderResult[] {
  return session;
}

// ---- the jobs ----------------------------------------------------------------

function newEntry(plan: Plan): Entry {
  const thumb = h("canvas", { cls: "rs-queue-thumb", attrs: { "aria-hidden": "true" } });
  thumb.hidden = true;
  const art = h("div", { cls: "rs-queue-art", attrs: { "aria-hidden": "true" } }, icon("render", 24));
  const fill = h("span");
  const bar = h("div", { cls: "rs-queue-bar", attrs: { "aria-hidden": "true" } }, fill);
  const line = h("p", { cls: "rs-queue-line" });
  const actions = h("div", { cls: "rs-queue-actions" });
  const name = shotName(plan);
  const meta = metaOf(plan);
  const el = h(
    "article",
    { cls: "rs-queue-card" },
    art,
    thumb,
    h("div", { cls: "rs-queue-body" }, h("p", { cls: "rs-queue-name", text: name, attrs: plan.shots.length === 1 && plan.shots[0]?.camera ? { translate: "no" } : {} }), h("p", { cls: "rs-queue-meta", text: meta }), bar, line, actions),
  );
  const e: Entry = {
    id: nextId++,
    plan,
    name,
    meta,
    finishable: plan.engine === "pathtraced" && (!plan.via || plan.via.engine.takes === "picture"),
    control: { cancelled: false, finishNow: false },
    box: {
      label: (text) => onText(e, text),
      bar: (fraction) => onBar(e, fraction),
      picture: (source) => onPicture(e, source),
    },
    results: [],
    status: "waiting",
    text: "Waiting",
    fraction: null,
    started: 0,
    first: 0,
    shown: 0,
    finishing: false,
    stopping: false,
    actionKey: "",
    el,
    thumb,
    art,
    bar,
    fill,
    line,
    actions,
  };
  return e;
}

/** "Current view", a camera's name, or "3 shots". */
function shotName(plan: Plan): string {
  return plan.shots.length > 1 ? `${plan.shots.length} shots` : (plan.shots[0]?.label ?? "Current view");
}

/** "3840 × 2160 · Photoreal · Good": the size, then the engine (an extra engine's short name). */
function metaOf(plan: Plan): string {
  const size = `${plan.width} × ${plan.height}`;
  const engine = plan.via ? plan.via.engine.short : plan.engine === "pathtraced" ? `Photoreal · ${QUALITY[plan.prefs.quality].short}` : "Fast";
  return `${size} · ${engine}`;
}

/** Runs the waiting jobs in turn until none waits; the live Path Traced view stops meanwhile. */
async function run(): Promise<void> {
  working = true;
  setRenderBusy(true);
  try {
    for (let next = waiting(); next; next = waiting()) await runJob(next);
  } finally {
    working = false;
    setRenderBusy(false);
  }
}

function waiting(): Entry | undefined {
  return queue.find((e) => e.status === "waiting");
}

async function runJob(e: Entry): Promise<void> {
  e.status = "running";
  e.started = performance.now();
  e.text = "Preparing…";
  e.fraction = null;
  paint();
  let failure: { readonly err: unknown } | null = null;
  try {
    await makePictures(e.plan, e.control, e.box, e.results);
  } catch (err) {
    failure = { err };
  }
  end(e, failure);
}

/**
 * A job has ended. Cancel discards it and its card goes. Otherwise the pictures it made are kept for
 * the session, and a failed job says why; a done one, when it is the queue's last, opens its pictures
 * in the viewer (unless the viewer is already open).
 */
function end(e: Entry, failure: { readonly err: unknown } | null): void {
  if (e.control.cancelled) {
    e.status = "cancelled";
    removeEntry(e);
    return;
  }
  const made = e.results.length;
  if (made > 0) {
    e.first = session.length;
    session.push(...e.results);
    // the last picture is not announced by the progress line, so the card takes it here
    showLatest(e);
  }
  if (failure) {
    e.status = "failed";
    if (failure.err instanceof EngineRefusal) {
      e.text = failure.err.message;
      toast(failure.err.message);
    } else {
      e.text = errorMessage(failure.err);
      toast(`Render failed: ${e.text}`);
      reportFailure("render", failure.err, { ...planDetails(e.plan), made });
    }
  } else if (made === 0) {
    e.status = "failed";
    e.text = "No picture was made";
  } else {
    e.status = "done";
    e.fraction = 1;
    e.text = doneText(e);
  }
  paint();
  if (e.status === "done" && !waiting() && !document.querySelector(".render-viewer-backdrop")) {
    // the pictures show in the viewer, so the tray folds to its head and leaves the view clear
    setFolded(true);
    showRenderResult(session, e.first);
  }
}

/** "Done · 42 s", or "3 pictures · 1 min 5 s". */
function doneText(e: Entry): string {
  const seconds = (performance.now() - e.started) / 1000;
  const took = seconds < 1 ? "under 1 s" : formatSeconds(seconds);
  return e.results.length > 1 ? `${e.results.length} pictures · ${took}` : `Done · ${took}`;
}

/** Cancel: a waiting job goes at once, a running one stops after its next step and leaves no card. */
function cancel(e: Entry): void {
  if (e.status === "waiting") {
    removeEntry(e);
    return;
  }
  if (e.status !== "running") return;
  e.control.cancelled = true;
  e.stopping = true;
  e.text = "Stopping…";
  paintEntry(e);
}

/** Finish now: the picture in hand is kept and the job stops after it. */
function finishNow(e: Entry): void {
  if (e.status !== "running" || e.finishing) return;
  e.control.finishNow = true;
  e.finishing = true;
  e.text = "Finishing this picture…";
  paintEntry(e);
}

/** Takes a card and its job out of the queue; the pictures it made stay in the session. */
function removeEntry(e: Entry): void {
  const i = queue.indexOf(e);
  if (i >= 0) queue.splice(i, 1);
  e.el.remove();
  paint();
}

/** Clear: the cards of the jobs that have ended go. */
function clearEnded(): void {
  for (const e of [...queue]) if (e.status === "done" || e.status === "failed") removeEntry(e);
}

// ---- what a job reports --------------------------------------------------------

/** The progress line: the picture's samples and time, or the shot it is on. */
function onText(e: Entry, text: string): void {
  if (e.status !== "running") return;
  e.text = e.stopping ? "Stopping…" : e.finishing ? "Finishing this picture…" : text;
  showLatest(e);
  paintEntry(e);
}

function onBar(e: Entry, fraction: number | null): void {
  if (e.status !== "running") return;
  e.fraction = fraction;
  paintEntry(e);
}

/** The picture so far, drawn into the card's thumbnail as it is (a picture with no sample in it yet is left for the next). */
function onPicture(e: Entry, source: HTMLCanvasElement): void {
  if (e.status !== "running" || blankFrame(source)) return;
  const size = thumbSize(source.width, source.height);
  drawInto(e.thumb, size, (ctx) => ctx.drawImage(source, 0, 0, size.width, size.height));
  showThumb(e);
}

/** The thumbnail shows the last picture the job made, once it has made one it has not shown. */
function showLatest(e: Entry): void {
  const last = e.results.length;
  if (last === 0 || e.shown === last) return;
  e.shown = last;
  void drawResult(e, e.results[last - 1]);
}

/** Whether a picture so far is all but black: the path tracer has no sample in it yet, as its first frame shows. */
function blankFrame(source: HTMLCanvasElement): boolean {
  const probe = document.createElement("canvas");
  probe.width = 16;
  probe.height = 16;
  const ctx = probe.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  ctx.drawImage(source, 0, 0, 16, 16);
  const { data } = ctx.getImageData(0, 0, 16, 16);
  for (let i = 0; i < data.length; i += 4) if (data[i] > 2 || data[i + 1] > 2 || data[i + 2] > 2) return false;
  return true;
}

/** A finished picture, decoded at thumbnail size (the full picture is not kept in memory for the card). */
async function drawResult(e: Entry, r: RenderResult): Promise<void> {
  try {
    const size = r.width > 0 && r.height > 0 ? thumbSize(r.width, r.height) : null;
    const bitmap = await createImageBitmap(r.blob, size ? { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "medium" } : undefined);
    const fit = thumbSize(bitmap.width, bitmap.height);
    drawInto(e.thumb, fit, (ctx) => ctx.drawImage(bitmap, 0, 0, fit.width, fit.height));
    bitmap.close();
    showThumb(e);
  } catch {
    // a picture this browser can't decode: the card keeps what it had
  }
}

function showThumb(e: Entry): void {
  e.thumb.hidden = false;
  e.art.hidden = true;
}

/** A picture's thumbnail size: at most THUMB_WIDTH wide, its shape kept. */
function thumbSize(width: number, height: number): Size {
  const scale = Math.min(1, THUMB_WIDTH / Math.max(1, width));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Sizes the canvas to `size` (only when it differs: setting the size clears it) and draws into it. */
function drawInto(canvas: HTMLCanvasElement, size: Size, draw: (ctx: CanvasRenderingContext2D) => void): void {
  if (canvas.width !== size.width || canvas.height !== size.height) {
    canvas.width = size.width;
    canvas.height = size.height;
  }
  const ctx = canvas.getContext("2d");
  if (ctx) draw(ctx);
}

// ---- the tray -----------------------------------------------------------------

/** The tray, made on the first render: a solid panel at the window's bottom right, kept clear of the palettes. */
function buildTray(): Tray {
  const count = h("span", { cls: "rs-queue-count" });
  const list = h("div", { cls: "rs-queue-list" });
  const clear = button("Clear", clearEnded, { small: true, title: "Remove the renders that have ended" });
  const fold = button("Minimise", () => setFolded(!folded), { small: true, iconOnly: true, icon: "caret" });
  fold.classList.add("rs-queue-fold");
  fold.setAttribute("aria-expanded", "true");
  const el = h(
    "section",
    { cls: "rs-queue", attrs: { role: "region", "aria-label": "Renders" } },
    h(
      "div",
      { cls: "rs-queue-head" },
      h("span", { cls: "rs-queue-title", text: "Renders" }),
      count,
      h("span", { cls: "rs-queue-spacer" }),
      clear,
      fold,
    ),
    list,
  );
  el.hidden = true;
  document.body.append(el);
  place(el);
  window.addEventListener("resize", () => place(el));
  appContext()?.palettes.onChange(() => place(el));
  // the HUD comes on a frame after Studio does
  onStudio(() => requestAnimationFrame(() => place(el)));
  return { el, list, count, fold };
}

/** Puts the tray beside the palettes at the window's right, above any shelf at its foot and, in Render Studio, above the HUD's bar (its shutter stays in reach). */
function place(el: HTMLElement): void {
  const insets = appContext()?.palettes.insets();
  el.style.right = `${(insets?.right ?? 0) + TRAY_EDGE}px`;
  const bar = studioOn() ? document.querySelector(".rs-hud-bar")?.getBoundingClientRect() : undefined;
  const above = bar && bar.height > 0 ? window.innerHeight - bar.top + 8 : (insets?.bottom ?? 0) + TRAY_EDGE;
  el.style.bottom = `${Math.round(above)}px`;
}

function setFolded(on: boolean): void {
  folded = on;
  if (!tray) return;
  tray.el.classList.toggle("is-folded", on);
  tray.list.hidden = on;
  tray.fold.setAttribute("aria-expanded", String(!on));
  tray.fold.setAttribute("aria-label", on ? "Show the renders" : "Minimise");
  tray.fold.title = on ? "Show the renders" : "Minimise";
}

/** The tray as the queue stands: the running render first, then the waiting ones, then the ended ones, newest first. */
function paint(): void {
  if (!tray) return;
  const rank = (e: Entry): number => (e.status === "running" || e.status === "cancelled" ? 0 : e.status === "waiting" ? 1 : 2);
  const order = [...queue].sort((a, b) => rank(a) - rank(b) || (rank(a) === 2 ? b.id - a.id : a.id - b.id));
  tray.list.replaceChildren(...order.map((e) => e.el));
  for (const e of queue) paintEntry(e);
  tray.count.textContent = String(queue.length);
  tray.el.hidden = queue.length === 0;
}

/** One card as its job stands: its state, line, bar and buttons. */
function paintEntry(e: Entry): void {
  e.el.dataset.status = e.status;
  e.line.textContent = e.text;
  e.bar.hidden = e.status === "failed" || e.status === "cancelled";
  e.bar.classList.toggle("is-indeterminate", e.status === "running" && e.fraction === null);
  const value = e.status === "done" ? 1 : e.status === "running" ? (e.fraction ?? 0) : 0;
  e.fill.style.setProperty("--progress", `${Math.round(value * 100)}%`);
  const key = `${e.status}|${e.finishing}|${e.stopping}`;
  if (key !== e.actionKey) {
    e.actionKey = key;
    e.actions.replaceChildren(...actionsOf(e));
  }
}

/** The buttons a card shows for its state. */
function actionsOf(e: Entry): HTMLElement[] {
  const dismiss = (): HTMLButtonElement => {
    const b = button("Dismiss", () => removeEntry(e), { small: true, iconOnly: true, icon: "close" });
    b.classList.add("rs-queue-dismiss");
    return b;
  };
  switch (e.status) {
    case "waiting":
      return [button("Cancel", () => cancel(e), { small: true, title: "Take this render out of the queue" })];
    case "running": {
      const out: HTMLElement[] = [];
      if (e.finishable) {
        const finish = button("Finish now", () => finishNow(e), { small: true, title: "Keep the picture so far and stop" });
        finish.disabled = e.finishing || e.stopping;
        out.push(finish);
      }
      const stop = button("Cancel", () => cancel(e), { small: true, title: "Discard this render" });
      stop.disabled = e.stopping;
      out.push(stop);
      return out;
    }
    case "done":
      return [button("Open", () => showRenderResult(session, e.first), { small: true, primary: true, title: "Open the pictures in the viewer" }), dismiss()];
    case "failed":
      return [dismiss()];
    default:
      return [];
  }
}
