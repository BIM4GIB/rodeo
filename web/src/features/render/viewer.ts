// File > Export > Render Image…: the finished pictures in a window over the editor. Each is fitted to
// the window; a click shows it at 100 % with the window scrolling there. Several pictures switch from
// a strip of thumbnails or with the arrow keys. Save downloads the one shown; Copy puts a PNG on the
// clipboard. The renderers stay out of this file: it only shows what the job made.

import { h } from "../../app/dom.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
import { openCreditDialog } from "../account/credit.ts";
import { AI_ENGINE, AiFailure, aiTerms, aiVariations, paintAll, readyToPaint } from "./ai.ts";
import { optionValues, type OptionValues } from "./engines.ts";
import { engineFields, type EngineFields } from "./engineFields.ts";
import { formatSeconds } from "./still.ts";
import "./finalRender.css";

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
const FIT_TITLE = "Click to fit the window";
const ACTUAL_TITLE = "Click to show at 100 %";
const RESTYLE_KEY = "openvwx.restyle.v1";

/**
 * The pictures in a window over the editor. Esc, Close or a click outside the panel returns to the
 * drawing, and the picture URLs are revoked then. A picture an engine made from another can be
 * compared with it, a wipe following the pointer; Restyle with AI paints the one shown (or the
 * picture it was made from) again, the new ones joining the strip.
 */
export function showRenderResult(results: readonly RenderResult[]): void {
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
  let wipe = 0.5;

  const title = h("h2", { cls: "render-viewer-title" });
  const picture = h("img", { cls: "render-viewer-picture", attrs: { alt: "" } });
  // the picture an engine started from, over the one it made, cut off at the wipe
  const before = h("img", { cls: "render-viewer-before", attrs: { alt: "", "aria-hidden": "true" }, hidden: true });
  const divider = h(
    "div",
    { cls: "render-viewer-divider", attrs: { "aria-hidden": "true" }, hidden: true },
    h("span", { cls: "render-viewer-tag", text: "Before" }),
    h("span", { cls: "render-viewer-tag is-after", text: "After" }),
  );
  const stage = h("div", { cls: "render-viewer-stage" }, picture, before, divider);
  const thumbs: HTMLButtonElement[] = [];
  const strip = h("div", { cls: "render-viewer-strip" });
  const info = h("p", { cls: "render-viewer-info" });
  const status = h("p", { cls: "render-viewer-status", attrs: { role: "status" } });
  const compare = h("button", { cls: "btn", text: "Compare", title: "Wipe between this picture and the one it was made from", attrs: { type: "button", "aria-pressed": "false" } });
  const restyle = h("button", { cls: "btn", text: "Restyle with AI…", title: "Paint this picture again in another style", attrs: { type: "button" } });
  const copy = h("button", { cls: "btn", text: "Copy", attrs: { type: "button" } });
  const save = h("button", { cls: "btn primary", text: "Save", attrs: { type: "button" } });
  const close = h("button", { cls: "btn", text: "Close", attrs: { type: "button" } });
  const panel = h(
    "div",
    { cls: "render-viewer", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Render", tabindex: "-1" } },
    title,
    stage,
    strip,
    h(
      "div",
      { cls: "render-viewer-foot" },
      h("div", { cls: "render-viewer-text" }, info, status),
      h("div", { cls: "render-viewer-actions" }, compare, restyle, copy, save, close),
    ),
  );
  const backdrop = h("div", { cls: "render-viewer-backdrop" }, panel);

  const finish = (): void => {
    painting.abort();
    resize.disconnect();
    backdrop.remove();
    for (const url of [...urls, ...beforeUrls.values()]) URL.revokeObjectURL(url);
    returnFocus?.focus();
  };

  /** Lays the earlier picture and the wipe over the picture shown, where it is drawn now. */
  const place = (): void => {
    before.hidden = divider.hidden = !comparing;
    if (!comparing) return;
    for (const el of [before, divider]) {
      el.style.left = `${picture.offsetLeft}px`;
      el.style.top = `${picture.offsetTop}px`;
      el.style.width = `${picture.offsetWidth}px`;
      el.style.height = `${picture.offsetHeight}px`;
    }
    before.style.clipPath = `inset(0 ${(1 - wipe) * 100}% 0 0)`;
    divider.style.setProperty("--wipe", `${wipe * 100}%`);
  };
  const resize = new ResizeObserver(place);
  resize.observe(stage);
  picture.addEventListener("load", place);

  const setComparing = (on: boolean): void => {
    const r = list[current];
    comparing = on && r.before !== undefined;
    compare.setAttribute("aria-pressed", String(comparing));
    stage.classList.toggle("is-compare", comparing);
    if (comparing && r.before) {
      stage.classList.remove("is-actual");
      let url = beforeUrls.get(r.before);
      if (!url) {
        url = URL.createObjectURL(r.before);
        beforeUrls.set(r.before, url);
      }
      before.src = url;
      wipe = 0.5;
    }
    place();
  };

  const show = (i: number): void => {
    current = i;
    const r = list[i];
    picture.src = urls[i];
    picture.alt = `Render: ${r.name}`;
    picture.title = ACTUAL_TITLE;
    stage.classList.remove("is-actual");
    title.textContent = list.length > 1 ? `Render · ${r.name} (${i + 1} of ${list.length})` : `Render · ${r.name}`;
    info.textContent = describe(r);
    if (!restyle.disabled) status.textContent = "";
    compare.hidden = r.before === undefined;
    restyle.hidden = aiTerms() === null;
    copy.hidden = !canCopy || r.blob.type !== "image/png";
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

  picture.addEventListener("click", () => {
    if (comparing) return;
    const actual = stage.classList.toggle("is-actual");
    picture.title = actual ? FIT_TITLE : ACTUAL_TITLE;
    if (actual) {
      // start the scroll at the middle of the picture
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    }
  });
  // the wipe follows the pointer across the picture
  stage.addEventListener("pointermove", (e) => {
    if (!comparing || picture.offsetWidth === 0) return;
    const box = picture.getBoundingClientRect();
    wipe = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    place();
  });
  compare.addEventListener("click", () => setComparing(!comparing));
  restyle.addEventListener("click", () => void restyleShown());
  copy.addEventListener("click", () => {
    void navigator.clipboard.write([new ClipboardItem({ "image/png": list[current].blob })]).then(
      () => {
        status.textContent = "Copied to the clipboard.";
      },
      (err: unknown) => {
        status.textContent = `Couldn't copy the picture: ${errorMessage(err)}`;
      },
    );
  });
  save.addEventListener("click", () => {
    const r = list[current];
    const ext = r.blob.type === "image/jpeg" ? "jpg" : r.blob.type === "image/webp" ? "webp" : "png";
    downloadBlob(`${baseName()}-${slug(r.note ? `${r.name} ${r.note}` : r.name)}.${ext}`, r.blob);
  });
  close.addEventListener("click", finish);

  /** Restyle with AI: asks the style, paints the picture shown (or the one it was made from), and shows what came back. */
  async function restyleShown(): Promise<void> {
    const r = list[current];
    const values = await askRestyle();
    panel.focus();
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

  // every key stays inside the window, so the editor's shortcuts do not run under it
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    } else if (list.length > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      show((current + (e.key === "ArrowRight" ? 1 : list.length - 1)) % list.length);
    } else {
      cycleFocus(e, panel);
    }
  });
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) finish();
  });

  document.body.append(backdrop);
  add(results);
  show(0);
  panel.focus();
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
 * Other keys are left alone.
 */
export function cycleFocus(e: KeyboardEvent, box: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = [...box.querySelectorAll<HTMLElement>("button:not(:disabled):not([hidden])")];
  if (items.length === 0) return;
  e.preventDefault();
  const at = items.indexOf(document.activeElement as HTMLElement);
  const last = items.length - 1;
  const next = e.shiftKey ? (at <= 0 ? last : at - 1) : at < 0 || at === last ? 0 : at + 1;
  items[next].focus();
}

function describe(r: RenderResult): string {
  const parts = [`${r.width} × ${r.height}`, r.note ? `${r.engine} · ${r.note}` : r.engine];
  if (r.samples !== null) parts.push(`${r.samples} ${r.samples === 1 ? "sample" : "samples"}`);
  // a painting of the live view says no time: it was made while the view rested
  if (r.seconds > 0) parts.push(formatSeconds(r.seconds));
  return parts.join(" · ");
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
