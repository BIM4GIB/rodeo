// File > Export > Render Image…: the finished pictures in a full-window lightbox over the editor. The
// picture is fitted and centred; the wheel zooms about the pointer (ctrl+wheel pinches), a drag pans
// it when it is larger than the window, and a double-click toggles Fit and 100 %. Compare wipes
// between a picture and the one an engine started from. A strip of thumbnails, the arrows and the
// keys switch pictures; the info panel says what each is. Save downloads the one shown; Copy puts a
// PNG on the clipboard; Restyle with AI paints it again. The renderers stay out of this file: it only
// shows what the job made. Dark in both themes (studio/viewer.css).

import { h } from "../../app/dom.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
import { openCreditDialog } from "../account/credit.ts";
import { AI_ENGINE, AiFailure, aiTerms, aiVariations, paintAll, readyToPaint } from "./ai.ts";
import { optionValues, type OptionValues } from "./engines.ts";
import { engineFields, type EngineFields } from "./engineFields.ts";
import "./finalRender.css";
import { formatSeconds } from "./still.ts";
import { button } from "./studio/ui.ts";
import "./studio/viewer.css";

/** A finished picture, as the render job hands it over. */
export interface RenderResult {
  readonly blob: Blob;
  /** the picture's size, in pixels */
  readonly width: number;
  readonly height: number;
  /** what it shows: "Current view" or a camera's name */
  readonly name: string;
  /** "Realistic", "Path traced", or an engine's short name ("AI") */
  readonly engine: string;
  /** what the engine says of it ("Golden hour") */
  readonly note?: string;
  /** the picture an engine started from, to compare */
  readonly before?: Blob;
  /** samples taken; null for Realistic */
  readonly samples: number | null;
  /** how long it took to make, in seconds */
  readonly seconds: number;
}

const THUMB_HEIGHT = 56;
const RESTYLE_KEY = "openvwx.restyle.v1";
/** the zoom range, as a multiple of the picture's own size */
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
/** one step of the + and − buttons and keys */
const ZOOM_STEP = 1.25;
/** the gap a fitted picture keeps from the stage's edges, in px */
const FIT_GAP = 24;
/** from this window width the info panel is shown by default */
const WIDE = 900;
/** the wipe's handle: two arrows, pointing either way */
const GRIP = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 8L5.5 12l4 4M14.5 8l4 4-4 4"/></svg>';

/**
 * The pictures in a full-window lightbox over the editor, the one at `start` (an index) shown first.
 * Esc or Close returns to the drawing, and the picture URLs are revoked then. A picture an engine made
 * from another can be compared with it; Restyle with AI paints the one shown (or the picture it was
 * made from) again, the new ones joining the strip.
 */
export function showRenderResult(results: readonly RenderResult[], start = 0): void {
  if (results.length === 0) return;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const list: RenderResult[] = [];
  const urls: string[] = [];
  const beforeUrls = new Map<Blob, string>();
  const canCopy = typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";
  // stops a painting under way when the window closes
  const painting = new AbortController();
  let current = 0;
  let comparing = false;
  /** the wipe between the two pictures: 0 is all before, 1 all after */
  let wipe = 0.5;
  /** the picture's own size, once it has loaded */
  let natural = { w: 0, h: 0 };
  /** the picture's size on screen, as a multiple of its own */
  let zoom = 1;
  /** where the picture's top-left corner sits in the stage, in px */
  let x = 0;
  let y = 0;
  /** true while the picture is fitted: a resize of the window fits it again */
  let fitted = true;
  let infoOn = window.innerWidth >= WIDE;
  /** the pointer panning the picture, and where it began */
  let pan: { id: number; x: number; y: number; ox: number; oy: number } | null = null;
  /** the pointer dragging the wipe's handle */
  let wipeId: number | null = null;

  // ---- the picture and its compare layers -------------------------------------------
  const picture = h("img", { cls: "render-viewer-picture", attrs: { alt: "", draggable: "false" } });
  // the picture an engine started from, over the one it made, cut off at the wipe
  const before = h("img", { cls: "render-viewer-before", attrs: { alt: "", "aria-hidden": "true", draggable: "false" }, hidden: true });
  const handle = h("div", {
    cls: "render-viewer-handle",
    html: GRIP,
    attrs: { role: "slider", tabindex: "0", "aria-label": "Compare position", "aria-valuemin": "0", "aria-valuemax": "100" },
  });
  const divider = h("div", { cls: "render-viewer-divider", hidden: true }, handle);
  const tags = h(
    "div",
    { cls: "render-viewer-tags", hidden: true },
    h("span", { cls: "render-viewer-tag", text: "Before" }),
    h("span", { cls: "render-viewer-tag is-after", text: "After" }),
  );
  const prev = button("Previous picture", () => step(-1), { icon: "chevron", iconOnly: true });
  prev.classList.add("render-viewer-nav", "render-viewer-prev");
  const next = button("Next picture", () => step(1), { icon: "chevron", iconOnly: true });
  next.classList.add("render-viewer-nav", "render-viewer-next");
  const status = h("p", { cls: "render-viewer-status", attrs: { role: "status" } });
  const stage = h("div", { cls: "render-viewer-stage" }, picture, before, tags, divider, prev, next, status);

  // ---- the top bar -------------------------------------------------------------------
  const title = h("h2", { cls: "render-viewer-title" });
  const sub = h("p", { cls: "render-viewer-sub" });
  const fitBtn = button("Fit", () => fitView());
  const actualBtn = button("100 %", () => setZoom(1));
  const zoomOut = named(button("−", () => setZoom(zoom / ZOOM_STEP)), "Zoom out");
  const readout = h("span", { cls: "render-viewer-readout" });
  const zoomIn = named(button("+", () => setZoom(zoom * ZOOM_STEP)), "Zoom in");
  const zoomBox = h("div", { cls: "render-viewer-zoom", attrs: { role: "group", "aria-label": "Zoom" } }, fitBtn, actualBtn, zoomOut, readout, zoomIn);
  const compare = named(button("Compare", () => setComparing(!comparing), { icon: "compare", title: "Wipe between this picture and the one it was made from" }), "Compare");
  compare.setAttribute("aria-pressed", "false");
  const restyle = named(button("Restyle with AI…", () => void restyleShown(), { icon: "sparkle", title: "Paint this picture again in another style" }), "Restyle with AI…");
  const copy = named(button("Copy", () => copyShown(), { icon: "copy" }), "Copy");
  const save = named(button("Save", () => saveShown(), { icon: "download", primary: true }), "Save");
  const info = named(button("Info", () => setInfo(!infoOn)), "Info");
  info.classList.add("render-viewer-keep");
  info.setAttribute("aria-pressed", String(infoOn));
  const closeBtn = button("Close", () => finish(), { icon: "close", iconOnly: true });
  const actions = h("div", { cls: "render-viewer-actions" }, compare, restyle, copy, save, info, closeBtn);
  const bar = h("header", { cls: "render-viewer-top" }, h("div", { cls: "render-viewer-id" }, title, sub), zoomBox, actions);

  // ---- the strip and the facts -------------------------------------------------------
  const thumbs: HTMLButtonElement[] = [];
  const strip = h("div", { cls: "render-viewer-strip" });
  const facts = h("dl", { cls: "render-viewer-facts" });
  const infoPanel = h("aside", { cls: "render-viewer-info-panel", attrs: { "aria-label": "Info" } }, facts);

  const win = h(
    "div",
    { cls: infoOn ? "render-viewer-backdrop is-info" : "render-viewer-backdrop", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Render", tabindex: "-1" } },
    bar,
    stage,
    strip,
    infoPanel,
  );

  // ---- the view: zoom, pan, fit ----------------------------------------------------------

  /** The stage's size in px. */
  const stageSize = (): { sw: number; sh: number } => ({ sw: stage.clientWidth, sh: stage.clientHeight });

  /** The zoom that fits the picture in the stage, never above 100 %. */
  const fitZoom = (): number => {
    if (natural.w === 0) return 1;
    const { sw, sh } = stageSize();
    return Math.max(MIN_ZOOM, Math.min(1, (sw - 2 * FIT_GAP) / natural.w, (sh - 2 * FIT_GAP) / natural.h));
  };

  /** A picture smaller than the stage is kept centred; a larger one cannot pull its edges in from the stage's. */
  const clampPan = (): void => {
    const { sw, sh } = stageSize();
    const w = natural.w * zoom;
    const hgt = natural.h * zoom;
    x = w <= sw ? (sw - w) / 2 : Math.min(0, Math.max(sw - w, x));
    y = hgt <= sh ? (sh - hgt) / 2 : Math.min(0, Math.max(sh - hgt, y));
  };

  /** Puts the zoom, the pan, the wipe and the readout on screen. */
  const apply = (): void => {
    const { sw, sh } = stageSize();
    // both pictures take the same transform, so they zoom and pan together
    const t = `translate(${x}px, ${y}px) scale(${zoom})`;
    picture.style.transform = t;
    before.style.transform = t;
    readout.textContent = `${Math.round(zoom * 100)} %`;
    stage.classList.toggle("is-pannable", natural.w * zoom > sw || natural.h * zoom > sh);
    before.style.clipPath = `inset(0 ${(1 - wipe) * 100}% 0 0)`;
    divider.style.left = `${x + wipe * natural.w * zoom}px`;
    handle.setAttribute("aria-valuenow", String(Math.round(wipe * 100)));
  };

  /** Zooms to `z` (a multiple of the picture's size), keeping the point `at` (in the stage) where it is, or the middle. */
  const setZoom = (z: number, at?: { x: number; y: number }): void => {
    if (natural.w === 0) return;
    const { sw, sh } = stageSize();
    const px = at?.x ?? sw / 2;
    const py = at?.y ?? sh / 2;
    const target = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
    // the picture's point under the pointer stays under it
    x = px - ((px - x) / zoom) * target;
    y = py - ((py - y) / zoom) * target;
    zoom = target;
    fitted = false;
    clampPan();
    apply();
  };

  /** Fits the picture in the stage and centres it. */
  const fitView = (): void => {
    fitted = true;
    zoom = fitZoom();
    x = 0;
    y = 0;
    clampPan();
    apply();
  };

  /** Moves the wipe, 0 to 1. */
  const setWipe = (v: number): void => {
    wipe = Math.min(1, Math.max(0, v));
    apply();
  };

  /** Compares the picture shown with the one it was made from (when it has one), or stops comparing. */
  const setComparing = (on: boolean): void => {
    const r = list[current];
    comparing = on && r.before !== undefined;
    compare.setAttribute("aria-pressed", String(comparing));
    before.hidden = tags.hidden = divider.hidden = !comparing;
    if (comparing && r.before) {
      let url = beforeUrls.get(r.before);
      if (!url) {
        url = URL.createObjectURL(r.before);
        beforeUrls.set(r.before, url);
      }
      if (before.getAttribute("src") !== url) before.src = url;
    }
    apply();
  };

  /** Shows or hides the info panel. */
  const setInfo = (on: boolean): void => {
    infoOn = on;
    win.classList.toggle("is-info", on);
    info.setAttribute("aria-pressed", String(on));
  };

  /** The facts about the picture shown. */
  const showFacts = (): void => {
    const r = list[current];
    const w = r.width || picture.naturalWidth;
    const hgt = r.height || picture.naturalHeight;
    const fact = (label: string, value: string, sub?: string): HTMLElement =>
      h("div", {}, h("dt", { text: label }), h("dd", {}, value, sub ? h("span", { cls: "render-viewer-fact-sub", text: sub }) : null));
    facts.replaceChildren(
      fact("Name", r.name),
      fact("Size", `${w} × ${hgt} px`, megapixels(w, hgt)),
      fact("Engine", r.note ? `${r.engine} · ${r.note}` : r.engine),
      fact("Samples", r.samples === null ? "—" : `${r.samples} ${r.samples === 1 ? "sample" : "samples"}`),
      // a painting of the live view says no time: it was made while the view rested
      fact("Time", r.seconds > 0 ? formatSeconds(r.seconds) : "—"),
      fact("File", `${kindOf(r.blob.type)} · ${bytesText(r.blob.size)}`),
    );
  };

  /** Shows picture `i`, fitted: its name, facts and thumbnail; the compare wipe stays if it has a before. */
  const show = (i: number): void => {
    current = i;
    const r = list[i];
    fitted = true;
    picture.src = urls[i];
    picture.alt = `Render: ${r.name}`;
    title.textContent = r.name;
    sub.textContent = `${r.note ? `${r.engine} · ${r.note}` : r.engine}${list.length > 1 ? ` · ${i + 1} of ${list.length}` : ""}`;
    showFacts();
    if (!restyle.disabled) status.textContent = "";
    compare.hidden = r.before === undefined;
    restyle.hidden = aiTerms() === null;
    copy.hidden = !canCopy || r.blob.type !== "image/png";
    prev.hidden = next.hidden = list.length < 2;
    thumbs.forEach((t, j) => t.setAttribute("aria-current", j === i ? "true" : "false"));
    thumbs[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    setComparing(comparing);
  };

  /** Adds pictures to the window, each with its thumbnail. */
  const add = (more: readonly RenderResult[]): void => {
    for (const r of more) {
      const i = list.length;
      list.push(r);
      urls.push(URL.createObjectURL(r.blob));
      const t = h("button", {
        cls: "render-viewer-thumb",
        attrs: { type: "button", "aria-label": `Picture ${i + 1}: ${r.name}${r.note ? `, ${r.note}` : ""}`, "aria-current": "false" },
      });
      t.addEventListener("click", () => show(thumbs.indexOf(t)));
      thumbs.push(t);
      strip.append(t);
      void fillThumb(t, r);
    }
    strip.hidden = list.length < 2;
  };

  /** The picture `by` places away from the one shown, round the ends. */
  const step = (by: number): void => {
    if (list.length > 1) show((current + by + list.length) % list.length);
  };

  /** Puts the picture shown on the clipboard as a PNG. */
  const copyShown = (): void => {
    const r = list[current];
    if (!canCopy || r.blob.type !== "image/png") return;
    void navigator.clipboard.write([new ClipboardItem({ "image/png": r.blob })]).then(
      () => {
        status.textContent = "Copied to the clipboard.";
      },
      (err: unknown) => {
        status.textContent = `Couldn't copy the picture: ${errorMessage(err)}`;
      },
    );
  };

  /** Downloads the picture shown. */
  const saveShown = (): void => {
    const r = list[current];
    const ext = r.blob.type === "image/jpeg" ? "jpg" : r.blob.type === "image/webp" ? "webp" : "png";
    downloadBlob(`${baseName()}-${slug(r.note ? `${r.name} ${r.note}` : r.name)}.${ext}`, r.blob);
  };

  /** Restyle with AI: asks the style, paints the picture shown (or the one it was made from), and shows what came back. */
  async function restyleShown(): Promise<void> {
    const r = list[current];
    const values = await askRestyle();
    win.focus();
    if (!values) return;
    if (!(await readyToPaint(aiVariations(values)))) return;
    const source = r.before ?? r.blob;
    const started = performance.now();
    restyle.disabled = true;
    try {
      const outputs = await paintAll(source, values, painting.signal, (i, n) => {
        status.textContent = n > 1 ? `Painting variation ${i + 1} of ${n}…` : "Painting…";
      });
      if (painting.signal.aborted || outputs.length === 0) return;
      const made: RenderResult[] = [];
      for (const o of outputs) made.push({ ...(await sizeOf(o.blob)), blob: o.blob, name: r.name, engine: AI_ENGINE.short, samples: null, seconds: (performance.now() - started) / 1000, before: source, ...(o.note ? { note: o.note } : {}) });
      const first = list.length;
      add(made);
      status.textContent = "";
      show(first);
    } catch (err) {
      if (painting.signal.aborted) return;
      status.textContent = err instanceof AiFailure ? err.message : `Couldn't paint the picture: ${errorMessage(err)}`;
      if (err instanceof AiFailure && err.kind === "credit") openCreditDialog();
    } finally {
      restyle.disabled = false;
    }
  }

  /** Closes the window: a painting under way stops, the URLs are revoked, focus goes back. */
  const finish = (): void => {
    painting.abort();
    resize.disconnect();
    win.remove();
    for (const url of [...urls, ...beforeUrls.values()]) URL.revokeObjectURL(url);
    returnFocus?.focus();
  };

  // ---- wiring -------------------------------------------------------------------------

  // the picture's own size is known once it has loaded: then it is fitted
  picture.addEventListener("load", () => {
    natural = { w: picture.naturalWidth, h: picture.naturalHeight };
    for (const el of [picture, before]) {
      el.style.width = `${natural.w}px`;
      el.style.height = `${natural.h}px`;
    }
    if (list[current].width === 0) showFacts();
    fitView();
  });

  // a fitted picture follows the stage's size; a zoomed one keeps its zoom and stays in the stage
  const resize = new ResizeObserver(() => {
    if (fitted) {
      fitView();
    } else {
      clampPan();
      apply();
    }
  });
  resize.observe(stage);

  /** Whether a pointer on `target` is on a control or the wipe's handle, not on the picture. */
  const onChrome = (target: EventTarget | null): boolean => target instanceof Element && target.closest("button, .render-viewer-handle") !== null;

  // the wheel zooms about the pointer; ctrl+wheel is a trackpad's pinch, with smaller steps
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      if (natural.w === 0) return;
      const r = stage.getBoundingClientRect();
      // a line is about 16 px; big steps are cut short
      const dy = Math.max(-200, Math.min(200, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
      setZoom(zoom * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015)), { x: e.clientX - r.left, y: e.clientY - r.top });
    },
    { passive: false },
  );

  // a double-click shows 100 % at the point, or fits again
  stage.addEventListener("dblclick", (e) => {
    if (natural.w === 0 || onChrome(e.target)) return;
    if (Math.abs(zoom - fitZoom()) < 0.01) {
      const r = stage.getBoundingClientRect();
      setZoom(1, { x: e.clientX - r.left, y: e.clientY - r.top });
    } else {
      fitView();
    }
  });

  // a drag pans the picture (it moves only when it is larger than the stage)
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || onChrome(e.target)) return;
    pan = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: x, oy: y };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pan || pan.id !== e.pointerId) return;
    x = pan.ox + e.clientX - pan.x;
    y = pan.oy + e.clientY - pan.y;
    clampPan();
    apply();
  });
  const endPan = (e: PointerEvent): void => {
    if (!pan || pan.id !== e.pointerId) return;
    pan = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", endPan);
  stage.addEventListener("pointercancel", endPan);

  // the handle drags the wipe along the picture
  handle.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    e.preventDefault();
    wipeId = e.pointerId;
    handle.setPointerCapture(e.pointerId);
    handle.focus();
  });
  handle.addEventListener("pointermove", (e) => {
    const r = picture.getBoundingClientRect();
    if (wipeId !== e.pointerId || r.width === 0) return;
    setWipe((e.clientX - r.left) / r.width);
  });
  const endWipe = (e: PointerEvent): void => {
    if (wipeId === e.pointerId) wipeId = null;
  };
  handle.addEventListener("pointerup", endWipe);
  handle.addEventListener("pointercancel", endWipe);

  // every key stays inside the window, so the editor's shortcuts do not run under it
  win.addEventListener("keydown", (e) => {
    e.stopPropagation();
    const key = e.key;
    const arrow = key === "ArrowLeft" || key === "ArrowRight";
    if (arrow && e.target === handle) {
      e.preventDefault();
      setWipe(wipe + (key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 0.1 : 0.02));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      // Copy and Save; the browser's own shortcuts (reload, find) keep working
      if (key.toLowerCase() === "c") {
        e.preventDefault();
        copyShown();
      } else if (key.toLowerCase() === "s") {
        e.preventDefault();
        saveShown();
      }
      return;
    }
    if (key === "Escape") {
      e.preventDefault();
      finish();
    } else if (arrow && list.length > 1) {
      e.preventDefault();
      step(key === "ArrowRight" ? 1 : -1);
    } else if (key.toLowerCase() === "f") {
      fitView();
    } else if (key === "1") {
      setZoom(1);
    } else if (key === "+" || key === "=") {
      setZoom(zoom * ZOOM_STEP);
    } else if (key === "-" || key === "_") {
      setZoom(zoom / ZOOM_STEP);
    } else if (key.toLowerCase() === "c" && list[current].before) {
      setComparing(!comparing);
    } else {
      cycleFocus(e, win);
    }
  });

  document.body.append(win);
  add(results);
  show(Math.min(list.length - 1, Math.max(0, Math.floor(start))));
  win.focus();
}

/** Gives a button its accessible name, `label`: for one whose text a narrow window hides, so only its icon shows. */
function named(b: HTMLButtonElement, label: string): HTMLButtonElement {
  b.setAttribute("aria-label", label);
  // a tooltip too, unless the button has its own
  if (!b.title) b.title = label;
  return b;
}

/** Restyle with AI's dialog: the AI engine's fields, as last chosen; null when cancelled. */
async function askRestyle(): Promise<OptionValues | null> {
  let kept: unknown = null;
  try {
    kept = JSON.parse(localStorage.getItem(RESTYLE_KEY) ?? "null");
  } catch {
    // storage blocked or not JSON: the fields' first values
  }
  const note = h("p", { cls: "render-hint render-engine-note" });
  let fields: EngineFields | null = null;
  const refresh = (): void => {
    note.textContent = fields ? (AI_ENGINE.describe?.(fields.values(), 1) ?? "") : "";
  };
  fields = engineFields(AI_ENGINE, optionValues(AI_ENGINE, kept), refresh);
  refresh();
  const shown = fields;
  const values = await showDialog<OptionValues>({
    title: "Restyle with AI",
    okLabel: "Paint",
    cls: "render-dialog",
    body: [...shown.rows, note],
    check: () => ({ value: shown.values() }),
  });
  if (values) {
    try {
      localStorage.setItem(RESTYLE_KEY, JSON.stringify(values));
    } catch {
      // private windows and full storage: the choices last this session
    }
  }
  return values;
}

/** A picture's size in pixels, read from the picture itself (0 × 0 when this browser can't decode it). */
async function sizeOf(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Keeps Tab inside `box`: the next control in it, or the previous one with Shift, wrapping round.
 * Other keys are left alone. Only controls that are showing count.
 */
export function cycleFocus(e: KeyboardEvent, box: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = [...box.querySelectorAll<HTMLElement>('button:not(:disabled), [role="slider"]')].filter((el) => el.getClientRects().length > 0);
  if (items.length === 0) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next = e.shiftKey ? (at <= 0 ? last : at - 1) : at < 0 || at === last ? 0 : at + 1;
  items[next].focus();
}

/** A picture's file type as its name: PNG, JPEG or WebP. */
function kindOf(type: string): string {
  return type === "image/jpeg" ? "JPEG" : type === "image/webp" ? "WebP" : "PNG";
}

/** A file's size as KB or MB. */
function bytesText(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A picture's pixels as megapixels: two places under one, one above. */
function megapixels(w: number, hgt: number): string {
  const mp = (w * hgt) / 1e6;
  return `${mp < 1 ? mp.toFixed(2) : mp.toFixed(1)} MP`;
}

/** The open drawing's name without .vwx: the start of each saved picture's file name. */
function baseName(): string {
  return store.fileName.replace(/\.vwx$/i, "") || "render";
}

/** A camera's name as a file name part: lower case, words joined by dashes. */
function slug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "render";
}

/** Draws a picture's thumbnail into its button; the button keeps its label if the browser cannot decode it. */
async function fillThumb(button: HTMLElement, r: RenderResult): Promise<void> {
  const width = Math.max(1, Math.round((THUMB_HEIGHT * r.width) / r.height));
  try {
    // decoded at thumbnail size, so the full picture is not kept in memory for each button
    const bitmap = await createImageBitmap(r.blob, { resizeWidth: width, resizeHeight: THUMB_HEIGHT, resizeQuality: "medium" });
    const canvas = h("canvas", { attrs: { width: String(width), height: String(THUMB_HEIGHT) } });
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
    bitmap.close();
    button.append(canvas);
  } catch {
    // the button keeps its label
  }
}
