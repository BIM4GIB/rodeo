// The quick bar for touch screens (coarse pointers only): Undo, Redo, Esc, Delete
// and Shift and Option latches, so a drawing can be edited without a keyboard. It
// floats at the drawing's right edge, or on a phone in a row over the Mode bar
// (touch.css). A latch stays on until it is tapped again; the tool controller ORs it
// into the pointer events the tools get (ToolController.setLatch).

import { redo, undo } from "../../app/commands.ts";
import type { AppContext } from "../../app/ext.ts";
import { h } from "../../app/dom.ts";
import { UI_ICON } from "../../app/icons.ts";
import { store } from "../../app/state.ts";

function blurField(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) el.blur();
}

/** Sends a key to the window's key handlers, as a keyboard would (shortcuts.ts, then the tools). */
function press(key: string): void {
  blurField();
  window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function button(text: string, title: string, label: string, extra: { html?: string; latch?: boolean } = {}): HTMLButtonElement {
  return h("button", {
    cls: extra.html ? "touch-qb-btn" : "touch-qb-btn touch-qb-text",
    text: extra.html ? undefined : text,
    html: extra.html,
    title,
    attrs: { type: "button", "aria-label": label, ...(extra.latch ? { "aria-pressed": "false" } : {}) },
  });
}

/** Mounts the quick bar over the drawing (the stage), and keeps its undo and redo enabled as the document allows. */
export function mountQuickBar(ctx: AppContext): void {
  const stage = document.getElementById("stage");
  if (!stage) return;

  const undoBtn = button("", "Undo", "Undo", { html: UI_ICON.undo });
  const redoBtn = button("", "Redo", "Redo", { html: UI_ICON.redo });
  const escBtn = button("Esc", "Escape: cancel the tool, clear the selection", "Escape");
  const delBtn = button("Del", "Delete the selected objects", "Delete");
  const shiftBtn = button("⇧", "Shift latch: constrains the next drawing gestures until tapped again", "Shift latch", { latch: true });
  const optBtn = button("⌥", "Option latch: the next gestures act as Option is held, until tapped again", "Option latch", { latch: true });

  undoBtn.addEventListener("click", () => undo());
  redoBtn.addEventListener("click", () => redo());
  escBtn.addEventListener("click", () => press("Escape"));
  delBtn.addEventListener("click", () => press("Delete"));

  let shift = false;
  let alt = false;
  shiftBtn.addEventListener("click", () => {
    shift = !shift;
    shiftBtn.setAttribute("aria-pressed", String(shift));
    ctx.controller.setLatch({ shift });
  });
  optBtn.addEventListener("click", () => {
    alt = !alt;
    optBtn.setAttribute("aria-pressed", String(alt));
    ctx.controller.setLatch({ alt });
  });

  const sep = (): HTMLElement => h("div", { cls: "touch-qb-sep", attrs: { "aria-hidden": "true" } });
  const bar = h(
    "div",
    { cls: "touch-quickbar", attrs: { role: "toolbar", "aria-label": "Quick keys" } },
    undoBtn,
    redoBtn,
    sep(),
    escBtn,
    delBtn,
    sep(),
    shiftBtn,
    optBtn,
  );
  stage.append(bar);

  const sync = (): void => {
    undoBtn.disabled = !store.session?.canUndo();
    redoBtn.disabled = !store.session?.canRedo();
  };
  store.on(["session", "file"], sync);
  sync();
}
