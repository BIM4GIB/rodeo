// Render Image's progress window over the editor: a picture so far, a line of progress, a bar,
// Finish now and Cancel, and for a cloud render Keep working, which closes it while the job goes on.

import { h } from "../../app/dom.ts";
import type { StillBox } from "./still.ts";
import { cycleFocus } from "./viewer.ts";

/** The progress window's controls. */
export interface ProgressBox extends StillBox {
  picture(source: HTMLCanvasElement | ImageBitmap): void;
  /** the next job of a batch starts: Finish now works again */
  next(): void;
  close(): void;
}

export interface ProgressSpec {
  /** the window's title, Render Image unless given */
  readonly title?: string;
  /** Finish now is offered (a path-traced picture) */
  readonly finishable: boolean;
  readonly onFinish: () => void;
  readonly onCancel: () => void;
  /** offers Keep working, which closes the window */
  readonly onKeepWorking?: () => void;
}

const THUMB_WIDTH = 320;

export function showProgress(spec: ProgressSpec): ProgressBox {
  const caption = h("p", { cls: "render-progress-label", text: "Preparing…", attrs: { role: "status" } });
  const progressBar = h("progress", { cls: "render-bar", attrs: { max: "1", "aria-label": "Progress" } });
  const thumb = h("canvas", { cls: "render-progress-thumb", attrs: { "aria-hidden": "true" } });
  thumb.hidden = true;
  const finish = h("button", { cls: "btn", text: "Finish now", attrs: { type: "button" } });
  finish.hidden = !spec.finishable;
  const cancel = h("button", { cls: "btn", text: "Cancel", attrs: { type: "button" } });
  const keep = h("button", { cls: "btn", text: "Keep working", attrs: { type: "button" } });
  keep.hidden = !spec.onKeepWorking;
  finish.addEventListener("click", () => {
    spec.onFinish();
    finish.disabled = true;
    caption.textContent = "Finishing this picture…";
  });
  cancel.addEventListener("click", () => {
    spec.onCancel();
    cancel.disabled = true;
    finish.disabled = true;
    caption.textContent = "Stopping…";
  });
  const panel = h(
    "div",
    { cls: "menu-dialog render-progress", attrs: { role: "dialog", "aria-modal": "true", "aria-label": spec.title ?? "Render Image", tabindex: "-1" } },
    h("h2", { cls: "menu-dialog-title", text: spec.title ?? "Render Image" }),
    thumb,
    caption,
    progressBar,
    h("div", { cls: "menu-dialog-actions" }, keep, finish, cancel),
  );
  const backdrop = h("div", { cls: "menu-dialog-backdrop" }, panel);
  keep.addEventListener("click", () => {
    backdrop.remove();
    spec.onKeepWorking?.();
  });
  // every key stays inside the window, so the editor's shortcuts do not run while it renders
  backdrop.addEventListener("keydown", (e) => {
    e.stopPropagation();
    cycleFocus(e, panel);
  });
  document.body.append(backdrop);
  panel.focus();
  return {
    label(text) {
      caption.textContent = text;
    },
    bar(fraction) {
      if (fraction === null) progressBar.removeAttribute("value");
      else progressBar.value = Math.min(1, Math.max(0, fraction));
    },
    picture(source) {
      const scale = Math.min(1, THUMB_WIDTH / source.width);
      const w = Math.max(1, Math.round(source.width * scale));
      const hgt = Math.max(1, Math.round(source.height * scale));
      if (thumb.width !== w || thumb.height !== hgt) {
        thumb.width = w;
        thumb.height = hgt;
      }
      thumb.hidden = false;
      thumb.getContext("2d")?.drawImage(source, 0, 0, w, hgt);
    },
    next() {
      finish.disabled = false;
    },
    close() {
      backdrop.remove();
    },
  };
}
