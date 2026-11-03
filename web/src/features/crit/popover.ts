// The one popover of crit mode: a comment thread, or the composer for a new pin
// or redline. It sits over the drawing, beside its anchor (a pin's point on
// screen), and follows the anchor as the view moves.

import { h } from "../../app/dom.ts";
import type { Pt } from "../../core/index.ts";

export type PopoverKind = "thread" | "pin" | "redline";

let el: HTMLElement | null = null;
let kind: PopoverKind | null = null;
let anchorAt: (() => Pt | null) | null = null;
let onHide: (() => void) | null = null;

/** The drawing's frame (the canvas and its overlays sit in it). */
export function drawingFrame(): HTMLElement | null {
  return document.getElementById("canvas-wrap");
}

export function popoverKind(): PopoverKind | null {
  return kind;
}

/**
 * Shows `body` as the popover, beside the point `at` returns (screen px in the drawing's frame, null
 * when the anchor is not visible). `hidden` runs when it closes, however it closes.
 */
export function showPopover(body: HTMLElement, pop: PopoverKind, at: () => Pt | null, hidden?: () => void): void {
  closePopover();
  const frame = drawingFrame();
  if (!frame) return;
  const label = pop === "thread" ? "Comment thread" : pop === "pin" ? "New comment" : "New redline";
  const node = h("div", { cls: `crit-pop ${pop}`, attrs: { role: "dialog", "aria-label": label } }, body);
  // keys typed in the popover are for it, not for the editor's shortcuts
  node.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      closePopover();
    }
  });
  frame.append(node);
  el = node;
  kind = pop;
  anchorAt = at;
  onHide = hidden ?? null;
  repositionPopover();
}

/** Closes the popover (and runs its onHide). */
export function closePopover(): void {
  const node = el;
  const hide = onHide;
  el = null;
  kind = null;
  anchorAt = null;
  onHide = null;
  node?.remove();
  hide?.();
}

/** Puts the popover beside its anchor, kept inside the drawing; called on every redraw. */
export function repositionPopover(): void {
  if (!el || !anchorAt) return;
  const frame = drawingFrame();
  const at = anchorAt();
  if (!frame || !at) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const gap = 14;
  const margin = 8;
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const maxX = Math.max(margin, frame.clientWidth - w - margin);
  const maxY = Math.max(margin, frame.clientHeight - hgt - margin);
  let x = at.x + gap;
  if (x > maxX) x = at.x - gap - w;
  const y = at.y - 12;
  el.style.left = `${Math.round(Math.min(Math.max(x, margin), maxX))}px`;
  el.style.top = `${Math.round(Math.min(Math.max(y, margin), maxY))}px`;
}
