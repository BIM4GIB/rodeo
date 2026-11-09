// Keys and pointers for voice commands. Holding the voice key (Space, or the right Option or Alt
// key) starts talking after a quarter of a second; Escape, Enter and Backspace act on the voice
// while it works; a click or drag on the drawing while the user speaks drops a pin or pans. These
// are window capture listeners, so they see each event before the editor does, and they stop an
// event only where the plan's key table says so. Space is never stopped: the editor still sets
// Space-pan on it, so a press and drag with Space held pans as it always has.

import type { AppContext } from "../../app/ext.ts";
import { voiceSettings } from "./settings.ts";

/** How long Space must stay down before it means talking: a quick tap stays a Space-pan tap. */
const HOLD_MS = 250;
/** How far a press may move and still be a click, in CSS px. */
const CLICK_PX = 4;
/** How long a press may last and still be a click, in ms. */
const CLICK_MS = 600;

/** What the voice controller does for the keys and pointers that reach it. */
export interface GestureHandlers {
  /** the voice can take a key press now (on, a drawing open, not busy) */
  ready(): boolean;
  /** what the voice is doing, for Escape, Enter and Backspace */
  state(): "idle" | "intro" | "listening" | "busy" | "outcome";
  /** start listening in hold mode (the key is down), at the pointer's last client point or null */
  start(anchor: { x: number; y: number } | null): void;
  /** the hold key came up, or Enter: send */
  send(): void;
  /** Escape while listening or on the intro card */
  cancel(): void;
  /** Escape while the agent works */
  stop(): void;
  /** Escape or the voice key while the card shows */
  dismiss(): void;
  /** a click on the 2D drawing while listening, at its client point */
  click2d(at: { x: number; y: number }): void;
  /** a drag began on the 2D or 3D drawing while listening */
  dragged(): void;
  /** Backspace or Delete while listening */
  unpin(): void;
}

/** Where the voice key is: up, waiting to see whether it is a tap, down and talking, or a press that became a pan. */
type Hold = "idle" | "armed" | "held" | "panning";

/** A press on the drawing that may become a click: where and when it went down, and whether it has moved. */
interface Press {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly t: number;
  readonly onCanvas: boolean;
  moved: boolean;
}

// Copied from app/shortcuts.ts (isTextEntry, isControl): keep them the same, so Space means the
// same thing to the editor and to the voice.

/** True when `t` is a text field, where Space types a space. */
function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

/** True when `t` is a button-like control, which Space presses. */
function isControl(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest("button, select, summary, [role=button], [role=option]") !== null;
}

/** True when a dialog is open: its keys are its own. */
function dialogOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') !== null;
}

/** Listens for the voice key, Escape, Enter, Backspace and the drawing's clicks and drags. Returns the function that stops listening. */
export function installGesture(ctx: AppContext, h: GestureHandlers): () => void {
  let hold: Hold = "idle";
  let timer = 0;
  let press: Press | null = null;
  /** the pointer's last position over the editor, where the bubble opens */
  let last: { x: number; y: number } | null = null;

  /** Keeps an event from the editor and from the other listeners. */
  const swallow = (e: Event): void => {
    e.preventDefault();
    e.stopImmediatePropagation();
  };

  /** Whether the voice key may start talking now: the voice is ready, focus is not in a field or on a button, and no dialog is open. */
  const mayStart = (e: KeyboardEvent): boolean => {
    const st = h.state();
    if (st === "listening" || st === "intro" || st === "busy") return false;
    return h.ready() && !isTextEntry(e.target) && !isControl(e.target) && !dialogOpen();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    const key = voiceSettings().key;
    if (e.code === "Space" && key === "Space") {
      // a repeat is the same press; with a modifier Space is a shortcut, not talk
      if (e.repeat || hold !== "idle") return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (!mayStart(e)) return;
      if (h.state() === "outcome") h.dismiss();
      hold = "armed";
      timer = window.setTimeout(() => {
        timer = 0;
        if (hold !== "armed") return;
        hold = "held";
        h.start(last);
      }, HOLD_MS);
      return;
    }
    if (e.code === "AltRight" && key === "AltRight") {
      // the key repeats while held: keep every repeat to ourselves, so Option never types a character
      if (hold === "held") {
        swallow(e);
        return;
      }
      if (e.repeat || hold !== "idle" || !mayStart(e)) return;
      swallow(e);
      if (h.state() === "outcome") h.dismiss();
      hold = "held";
      h.start(last);
      return;
    }
    if (e.key === "Escape") {
      if (hold === "armed") {
        window.clearTimeout(timer);
        timer = 0;
        hold = "idle";
        swallow(e);
        return;
      }
      const st = h.state();
      if (st === "listening" || st === "intro") {
        swallow(e);
        h.cancel();
      } else if (st === "busy") {
        swallow(e);
        h.stop();
      } else if (st === "outcome") {
        // not swallowed: the editor clears the selection as usual
        h.dismiss();
      }
      return;
    }
    if (h.state() === "listening" && !isTextEntry(e.target)) {
      if (e.key === "Enter") {
        swallow(e);
        h.send();
        return;
      }
      if (e.key === "Backspace" || e.key === "Delete") {
        swallow(e);
        h.unpin();
      }
    }
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    const voiceKey = e.code === "Space" ? "Space" : e.code === "AltRight" ? "AltRight" : null;
    // the other voice key is none of ours: only the key that is set can start or end talk
    if (voiceKey === null || voiceKey !== voiceSettings().key) return;
    const was = hold;
    hold = "idle";
    window.clearTimeout(timer);
    timer = 0;
    if (was === "held") {
      if (voiceKey === "AltRight") swallow(e);
      h.send();
    }
  };

  const onDown = (e: PointerEvent): void => {
    const onCanvas = e.target === ctx.canvas;
    const onView3d = !onCanvas && e.target instanceof Element && e.target.closest(".view3d-canvas") !== null;
    if (!onCanvas && !onView3d) return;
    // a press on the drawing while the key is only down is a pan (2D) or an orbit (3D), as it always was
    if (hold === "armed" && e.button === 0) {
      window.clearTimeout(timer);
      timer = 0;
      hold = "panning";
      return;
    }
    if (e.button === 0 && h.state() === "listening") {
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp, onCanvas, moved: false };
    }
  };

  const onMove = (e: PointerEvent): void => {
    const stage = document.getElementById("stage");
    if (stage && e.target instanceof Node && stage.contains(e.target)) last = { x: e.clientX, y: e.clientY };
    const p = press;
    if (!p || e.pointerId !== p.id || p.moved) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > CLICK_PX) {
      p.moved = true;
      h.dragged();
    }
  };

  const onUp = (e: PointerEvent): void => {
    const p = press;
    if (!p || e.pointerId !== p.id) return;
    press = null;
    const still = Math.hypot(e.clientX - p.x, e.clientY - p.y) <= CLICK_PX;
    if (p.onCanvas && !p.moved && still && e.timeStamp - p.t <= CLICK_MS && h.state() === "listening") {
      h.click2d({ x: p.x, y: p.y });
    }
  };

  const onCancel = (e: PointerEvent): void => {
    if (press && e.pointerId === press.id) press = null;
  };

  /** The window lost focus or was hidden: nothing stays held, and a listening is abandoned. */
  const lost = (): void => {
    window.clearTimeout(timer);
    timer = 0;
    press = null;
    hold = "idle";
    if (h.state() === "listening") h.cancel();
  };

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") lost();
  };

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("pointerdown", onDown, true);
  window.addEventListener("pointermove", onMove, { capture: true, passive: true });
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onCancel, true);
  // not a capture listener: a field losing focus fires blur too, and only the window's own blur is wanted
  window.addEventListener("blur", lost);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    window.removeEventListener("pointercancel", onCancel, true);
    window.removeEventListener("blur", lost);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
