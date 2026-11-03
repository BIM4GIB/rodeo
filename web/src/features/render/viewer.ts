// File > Export > Render Image…: the finished pictures in a window over the editor. Each is fitted to
// the window; a click shows it at 100 % with the window scrolling there. Several pictures switch from
// a strip of thumbnails or with the arrow keys. Save downloads the one shown; Copy puts a PNG on the
// clipboard. The renderers stay out of this file: it only shows what the job made.

import { h } from "../../app/dom.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
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
  readonly engine: "Realistic" | "Path traced";
  /** samples taken; null for Realistic */
  readonly samples: number | null;
  /** how long it took to make, in seconds */
  readonly seconds: number;
}

const THUMB_HEIGHT = 56;
const FIT_TITLE = "Click to fit the window";
const ACTUAL_TITLE = "Click to show at 100 %";

/**
 * The pictures in a window over the editor. Esc, Close or a click outside the panel returns to the
 * drawing, and the picture URLs are revoked then.
 */
export function showRenderResult(results: readonly RenderResult[]): void {
  if (results.length === 0) return;
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const urls = results.map((r) => URL.createObjectURL(r.blob));
  const canCopy = typeof ClipboardItem !== "undefined" && typeof navigator.clipboard?.write === "function";
  let current = 0;

  const title = h("h2", { cls: "render-viewer-title" });
  const picture = h("img", { cls: "render-viewer-picture", attrs: { alt: "" } });
  const stage = h("div", { cls: "render-viewer-stage" }, picture);
  const thumbs = results.map((r, i) =>
    h("button", {
      cls: "render-viewer-thumb",
      attrs: { type: "button", "aria-label": `Picture ${i + 1}: ${r.name}`, "aria-current": "false" },
    }),
  );
  const strip = h("div", { cls: "render-viewer-strip" }, ...thumbs);
  strip.hidden = results.length < 2;
  const info = h("p", { cls: "render-viewer-info" });
  const status = h("p", { cls: "render-viewer-status", attrs: { role: "status" } });
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
      h("div", { cls: "render-viewer-actions" }, copy, save, close),
    ),
  );
  const backdrop = h("div", { cls: "render-viewer-backdrop" }, panel);

  const finish = (): void => {
    backdrop.remove();
    for (const url of urls) URL.revokeObjectURL(url);
    returnFocus?.focus();
  };

  const show = (i: number): void => {
    current = i;
    const r = results[i];
    picture.src = urls[i];
    picture.alt = `Render: ${r.name}`;
    picture.title = ACTUAL_TITLE;
    stage.classList.remove("is-actual");
    title.textContent = results.length > 1 ? `Render · ${r.name} (${i + 1} of ${results.length})` : `Render · ${r.name}`;
    info.textContent = describe(r);
    status.textContent = "";
    copy.hidden = !canCopy || r.blob.type !== "image/png";
    thumbs.forEach((t, j) => t.setAttribute("aria-current", j === i ? "true" : "false"));
    thumbs[i].scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  picture.addEventListener("click", () => {
    const actual = stage.classList.toggle("is-actual");
    picture.title = actual ? FIT_TITLE : ACTUAL_TITLE;
    if (actual) {
      // start the scroll at the middle of the picture
      stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
      stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
    }
  });
  copy.addEventListener("click", () => {
    void navigator.clipboard.write([new ClipboardItem({ "image/png": results[current].blob })]).then(
      () => {
        status.textContent = "Copied to the clipboard.";
      },
      (err: unknown) => {
        status.textContent = `Couldn't copy the picture: ${errorMessage(err)}`;
      },
    );
  });
  save.addEventListener("click", () => {
    const r = results[current];
    const ext = r.blob.type === "image/jpeg" ? "jpg" : "png";
    downloadBlob(`${baseName()}-${slug(r.name)}.${ext}`, r.blob);
  });
  close.addEventListener("click", finish);
  thumbs.forEach((t, i) => t.addEventListener("click", () => show(i)));

  // every key stays inside the window, so the editor's shortcuts do not run under it
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    } else if (results.length > 1 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      show((current + (e.key === "ArrowRight" ? 1 : results.length - 1)) % results.length);
    } else {
      cycleFocus(e, panel);
    }
  });
  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) finish();
  });

  document.body.append(backdrop);
  for (const [i, t] of thumbs.entries()) void fillThumb(t, results[i]);
  show(0);
  panel.focus();
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
  const parts = [`${r.width} × ${r.height}`, r.engine];
  if (r.samples !== null) parts.push(`${r.samples} ${r.samples === 1 ? "sample" : "samples"}`);
  parts.push(formatSeconds(r.seconds));
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
