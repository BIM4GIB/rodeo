// Touch and Apple Pencil on the 2D drawing. The tool controller hands every canvas
// pointer event to this gate first (ToolController.setPointerGate); what the gate
// takes never reaches the tool.
//
// - A pen draws as a mouse does (pencil.ts). Once a pen has been seen, a finger pans
//   instead of drawing ("Pencil Draws Only").
// - One finger works as the mouse does. Held still for 500 ms it opens the context
//   menu where it is, and the tool's gesture is dropped.
// - Two fingers pinch-zoom and pan about their midpoint and never reach the tool.
//   Two or three fingers tapped together are Undo and Redo.
// - Palm rejection: a contact over 30 px while a pen is down is ignored. A finger
//   that would draw while a pen is down is ignored too, so it cannot start a second
//   gesture beside the pen's.

import { redo, undo } from "../../app/commands.ts";
import type { AppContext } from "../../app/ext.ts";
import type { ToolController } from "../../app/tools.ts";
import { store } from "../../app/state.ts";
import { fingerPans, notePen } from "./pencil.ts";

/** a finger moving this far (CSS px) is a drag: no hold, no tap */
const MOVE_PX = 10;
/** a finger held this long without moving opens the context menu */
const HOLD_MS = 500;
/** a two- or three-finger tap is undone or redone when every finger lifts within this */
const TAP_MS = 500;
/** a contact this big (CSS px) while a pen is down is a palm */
const PALM_PX = 30;

type Phase = "down" | "move" | "up" | "cancel";
/** idle: no finger; tool: one finger drives the tool; pan: one finger pans; held: a held finger opened the menu; multi: two or more fingers */
type Mode = "idle" | "tool" | "pan" | "held" | "multi";

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** A finger on the canvas: where it is now, and where it landed (canvas CSS px). */
interface Contact {
  x: number;
  y: number;
  readonly x0: number;
  readonly y0: number;
}

function centroid(cs: readonly Contact[]): Pt {
  let x = 0;
  let y = 0;
  for (const c of cs) {
    x += c.x;
    y += c.y;
  }
  return { x: x / cs.length, y: y / cs.length };
}

/** The mean distance of the contacts from their centre: its ratio between two moments is the pinch's zoom. Zero for one. */
function spread(cs: readonly Contact[], centre: Pt): number {
  if (cs.length < 2) return 0;
  let sum = 0;
  for (const c of cs) sum += Math.hypot(c.x - centre.x, c.y - centre.y);
  return sum / cs.length;
}

class Gestures {
  private readonly contacts = new Map<number, Contact>();
  /** pointers this gesture does not use: palms, and fingers that arrive while a pen draws */
  private readonly ignored = new Set<number>();
  private readonly pens = new Set<number>();
  private mode: Mode = "idle";
  /** the last position a panning finger was at */
  private anchor: Pt = { x: 0, y: 0 };
  /** the pinch's last midpoint and spread */
  private mid: Pt = { x: 0, y: 0 };
  private apart = 0;
  private maxContacts = 0;
  private startedAt = 0;
  private moved = false;
  private holdTimer = 0;

  constructor(
    private readonly ctx: AppContext,
    private readonly controller: ToolController,
  ) {}

  handle(e: PointerEvent, phase: Phase): boolean {
    if (e.pointerType === "pen") {
      this.pen(e, phase);
      return false;
    }
    if (e.pointerType !== "touch") return false;
    if (phase === "down") return this.down(e);
    if (phase === "move") return this.move(e);
    return this.up(e, phase === "cancel");
  }

  private pen(e: PointerEvent, phase: Phase): void {
    if (phase === "down") {
      notePen();
      this.pens.add(e.pointerId);
      // a pen that goes down while a finger drives the tool takes the tool over
      if (this.mode === "tool") {
        this.controller.abortPointer();
        this.ignoreContacts();
      }
    } else if (phase !== "move") {
      this.pens.delete(e.pointerId);
    }
  }

  private down(e: PointerEvent): boolean {
    const id = e.pointerId;
    const p = this.local(e);
    if (this.pens.size > 0 && (e.width > PALM_PX || e.height > PALM_PX)) {
      this.ignored.add(id);
      return true;
    }
    if (this.contacts.size === 0) {
      const pans = fingerPans();
      if (!pans && this.pens.size > 0) {
        this.ignored.add(id);
        return true;
      }
      this.maxContacts = 1;
      this.moved = false;
      this.startedAt = performance.now();
      this.contacts.set(id, { x: p.x, y: p.y, x0: p.x, y0: p.y });
      this.mode = pans ? "pan" : "tool";
      this.anchor = p;
      this.capture(e);
      this.startHold(e);
      // the tool gets the finger's press unless the finger pans
      return pans;
    }
    // a second finger: the pinch takes over from whatever the first one started
    if (this.mode === "tool") this.controller.abortPointer();
    this.clearHold();
    this.contacts.set(id, { x: p.x, y: p.y, x0: p.x, y0: p.y });
    this.maxContacts = Math.max(this.maxContacts, this.contacts.size);
    this.mode = "multi";
    this.rebase();
    this.capture(e);
    return true;
  }

  private move(e: PointerEvent): boolean {
    const id = e.pointerId;
    if (this.ignored.has(id)) return true;
    const c = this.contacts.get(id);
    if (!c) return false;
    const p = this.local(e);
    c.x = p.x;
    c.y = p.y;
    if (!this.moved && Math.hypot(p.x - c.x0, p.y - c.y0) > MOVE_PX) {
      this.moved = true;
      this.clearHold();
    }
    switch (this.mode) {
      case "tool":
        return false;
      case "pan":
        this.ctx.view.pan(p.x - this.anchor.x, p.y - this.anchor.y);
        this.anchor = p;
        this.redraw();
        return true;
      case "multi":
        this.pinch();
        return true;
      default:
        return true; // held: the menu is open, the finger does nothing more
    }
  }

  private up(e: PointerEvent, cancelled: boolean): boolean {
    const id = e.pointerId;
    if (this.ignored.has(id)) {
      this.ignored.delete(id);
      return true;
    }
    if (!this.contacts.has(id)) return false;
    const was = this.mode;
    this.contacts.delete(id);
    if (this.contacts.size > 0) {
      // the fingers left carry on; a pinch continues as a pan of what is left
      if (was === "multi") this.rebase();
      return true;
    }
    this.clearHold();
    const tap = was === "multi" && !cancelled && !this.moved && performance.now() - this.startedAt < TAP_MS;
    this.mode = "idle";
    if (tap && this.maxContacts === 2) undo();
    else if (tap && this.maxContacts === 3) redo();
    if (was === "tool") {
      if (cancelled) {
        this.controller.abortPointer();
        return true;
      }
      return false; // the tool's up
    }
    return true;
  }

  /** Two or more fingers: zoom about the old midpoint by the change in spread, then pan by the midpoint's move. */
  private pinch(): void {
    const cs = [...this.contacts.values()];
    const mid = centroid(cs);
    const apart = spread(cs, mid);
    if (this.apart > 0 && apart > 0) this.ctx.view.zoomAt(this.mid.x, this.mid.y, apart / this.apart);
    this.ctx.view.pan(mid.x - this.mid.x, mid.y - this.mid.y);
    this.mid = mid;
    this.apart = apart;
    this.redraw();
  }

  /** Starts the pinch's measures again from the fingers down now. */
  private rebase(): void {
    const cs = [...this.contacts.values()];
    this.mid = centroid(cs);
    this.apart = spread(cs, this.mid);
  }

  /** A pen took the drawing: the fingers on the canvas are ignored until they lift. */
  private ignoreContacts(): void {
    for (const id of this.contacts.keys()) this.ignored.add(id);
    this.contacts.clear();
    this.clearHold();
    this.mode = "idle";
  }

  /** A finger held still opens the context menu where it is (the canvas listens for contextmenu, app.ts). */
  private startHold(e: PointerEvent): void {
    this.clearHold();
    const { clientX, clientY } = e;
    this.holdTimer = window.setTimeout(() => {
      this.holdTimer = 0;
      if (this.contacts.size !== 1 || (this.mode !== "tool" && this.mode !== "pan")) return;
      if (this.mode === "tool") this.controller.abortPointer();
      this.mode = "held";
      this.ctx.canvas.dispatchEvent(new MouseEvent("contextmenu", { clientX, clientY, bubbles: true, cancelable: true }));
    }, HOLD_MS);
  }

  private clearHold(): void {
    if (this.holdTimer === 0) return;
    window.clearTimeout(this.holdTimer);
    this.holdTimer = 0;
  }

  private redraw(): void {
    this.ctx.requestDraw();
    store.emit("view");
  }

  private local(e: PointerEvent): Pt {
    const r = this.ctx.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private capture(e: PointerEvent): void {
    try {
      this.ctx.canvas.setPointerCapture(e.pointerId);
    } catch {
      // the pointer has already ended: nothing to capture
    }
  }
}

/** Puts the touch and pen gestures in front of the 2D drawing's pointer events. */
export function installGestures(ctx: AppContext): void {
  const gestures = new Gestures(ctx, ctx.controller);
  ctx.controller.setPointerGate((e, phase) => gestures.handle(e, phase));
  // the browser cancels a touch it takes over (a system gesture): the same as a lift
  ctx.canvas.addEventListener("pointercancel", (e) => {
    gestures.handle(e, "cancel");
  });
}
