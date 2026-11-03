// The on-screen keyboard on a touch screen (or a narrow window): a field being typed in
// stays above it. The keyboard takes the bottom of window.visualViewport, so what is left
// above it is where a field must stay; a drawing's or a panel's own edges cut it further.
//
// - The drawing's text editor (TextEditor, app/tools/text.ts) sits over the drawing, so the
//   drawing pans until the line the caret is on is in that part. The caret's line is found
//   from the text before the caret, since a textarea reports no caret position.
// - Any other field (a number or text box in a palette or dialog) is scrolled within the
//   panel that scrolls it, by as much as the keyboard hides it. scrollIntoView would not do:
//   it measures the layout viewport, which a keyboard leaves as it is on a phone.
// - A field at the foot of its panel cannot scroll any further, so the sheet or dialog that
//   holds it is lifted (a translate) until the field is clear. The lift goes with the keyboard.
//
// A desktop with a wide window is unchanged.

import { onReady, type AppContext } from "../../app/ext.ts";
import { COARSE } from "./layout.ts";

/** the gap (CSS px) kept between a field and the keyboard's top edge */
const MARGIN_PX = 12;
/** input types a keyboard does not type into */
const NO_KEYBOARD = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"]);

/** The overlays lifted to clear the keyboard, each with its lift in CSS px (negative is up). */
const lifted = new Map<HTMLElement, number>();

/** A finger is the primary pointer, or the window is narrower than the touch layout's (layout.ts). */
function touchUi(): boolean {
  return COARSE || matchMedia("(max-width: 899px)").matches;
}

/** Whether the keyboard is up: the visual viewport is shorter than the layout viewport. */
function keyboardUp(): boolean {
  const vv = window.visualViewport;
  return !!vv && vv.height < window.innerHeight - 1;
}

/**
 * The part of the screen the keyboard leaves visible, in layout-viewport CSS px (its top and
 * bottom edges), cut back to a clipping box's edges when one is given.
 */
function visibleBand(box?: DOMRect): { top: number; bottom: number } {
  const vv = window.visualViewport;
  const top = vv ? vv.offsetTop : 0;
  const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight;
  return box ? { top: Math.max(top, box.top), bottom: Math.min(bottom, box.bottom) } : { top, bottom };
}

/** How far a box must move to sit inside the band, with the margin: negative up, positive down, 0 when it already does (or no band is left). */
function shiftInto(top: number, bottom: number, band: { top: number; bottom: number }): number {
  if (band.bottom <= band.top) return 0;
  if (bottom > band.bottom - MARGIN_PX) return band.bottom - MARGIN_PX - bottom;
  if (top < band.top + MARGIN_PX) return band.top + MARGIN_PX - top;
  return 0;
}

/** The text tool's editor: the one textarea with this class (app/tools/text.ts). */
function isTextEditor(el: HTMLElement): el is HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement && el.classList.contains("text-editor");
}

/** A field a keyboard types into. */
function isField(el: Element | null): el is HTMLElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !NO_KEYBOARD.has(el.type);
  return el instanceof HTMLElement && el.isContentEditable;
}

/** The nearest ancestor that scrolls its content (a palette's or dialog's body), or null. */
function scrollingPanel(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const overflow = getComputedStyle(p).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** The nearest ancestor placed over the page (a phone's sheet, a dialog), or null. */
function overlayOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const position = getComputedStyle(p).position;
    if (position === "fixed" || position === "absolute") return p;
  }
  return null;
}

/** Lifts the overlay holding a field by `by` more CSS px. */
function lift(el: HTMLElement, by: number): void {
  const root = overlayOf(el);
  if (!root || !by) return;
  const total = (lifted.get(root) ?? 0) + by;
  root.style.translate = `0px ${total}px`;
  lifted.set(root, total);
}

/** Lets down every lifted overlay that does not hold `el` (all of them for null). */
function unlift(el: HTMLElement | null): void {
  for (const root of [...lifted.keys()]) {
    if (el && root.contains(el)) continue;
    root.style.translate = "";
    lifted.delete(root);
  }
}

/** Keeps the drawing's caret line in the visible part by panning the drawing (the editor follows it on redraw). */
function revealCaret(ctx: AppContext, el: HTMLTextAreaElement): void {
  const cs = getComputedStyle(el);
  const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
  const line = el.value.slice(0, el.selectionEnd).split("\n").length - 1;
  const r = el.getBoundingClientRect();
  const top = r.top + el.clientTop + parseFloat(cs.paddingTop) + line * lineHeight;
  // the editor is clipped to the drawing, so the drawing's part of the screen is the band
  const shift = shiftInto(top, top + lineHeight, visibleBand((el.parentElement ?? el).getBoundingClientRect()));
  if (!shift) return;
  // a positive pan moves the drawing down, so the caret goes up with a negative one
  ctx.view.pan(0, shift);
  ctx.requestDraw();
}

/** Keeps a field in the visible part: scrolled within its panel, then lifted with its overlay where the panel cannot scroll. */
function revealField(el: HTMLElement): void {
  const panel = scrollingPanel(el);
  if (panel) {
    const r = el.getBoundingClientRect();
    const shift = shiftInto(r.top, r.bottom, visibleBand(panel.getBoundingClientRect()));
    if (shift) panel.scrollBy({ top: -shift });
  }
  if (!keyboardUp()) return;
  const r = el.getBoundingClientRect();
  lift(el, shiftInto(r.top, r.bottom, visibleBand()));
}

function update(ctx: AppContext): void {
  const el = document.activeElement;
  const field = touchUi() && el instanceof HTMLElement && isField(el) ? el : null;
  unlift(field && keyboardUp() ? field : null);
  if (!field) return;
  if (isTextEditor(field)) revealCaret(ctx, field);
  else revealField(field);
}

onReady((ctx) => {
  const again = (): void => update(ctx);
  // the keyboard shrinks the visual viewport: that is when a focused field may be hidden
  window.visualViewport?.addEventListener("resize", again);
  window.visualViewport?.addEventListener("scroll", again);
  window.addEventListener("resize", again);
  // focus brings the keyboard, and typing or arrowing moves the caret along; leaving a field lets the lifts down
  document.addEventListener("focusin", again);
  document.addEventListener("focusout", () => setTimeout(again));
  document.addEventListener("input", again);
  document.addEventListener("keyup", again);
  // a sheet that grows or shrinks (dock.css eases its height) moves its fields without any of the above
  document.addEventListener("transitionend", again);
});
