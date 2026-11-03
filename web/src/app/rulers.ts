// View > Rulers: rulers along the top and left of the drawing, as Vectorworks shows them, marked in
// the document's units at the zoom: feet and inches in feet (5') or inches (6", 1/4"), the other
// units as plain numbers in the unit. A mark on each follows the pointer. Drawn over the canvas's
// edges each frame (an overlay, so exports leave them out), not in 3D; the bars over the drawing
// move clear of them while they show. Kept per browser.

import { niceStep } from "./geom.ts";
import { appContext } from "./ext.ts";
import { ACCENT } from "./renderer.ts";
import { store } from "./state.ts";
import type { Painter } from "./tools.ts";
import { formatLengthValue, lengthSuffix, millimetresPerUnit } from "./units.ts";

const KEY = "openvwx.rulers";
/** a ruler's breadth, CSS px (styles.css moves the bars by as much) */
const SIZE = 16;
/** labelled ticks at least this far apart, CSS px */
const LABEL_PX = 64;
/** small ticks at least this far apart */
const TICK_PX = 6;
const MM_PER_INCH = 25.4;
/** steps of an architectural ruler, in inches: sixteenths to a thousand feet */
const INCH_STEPS = [1 / 16, 1 / 8, 1 / 4, 1 / 2, 1, 2, 3, 6, 12, 24, 60, 120, 240, 600, 1200, 2400, 6000, 12000];

let shown = load();
let stage: HTMLElement | null = null;
let redraw: () => void = () => {};

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** True while the rulers show. */
export function rulersShown(): boolean {
  return shown;
}

/** View > Rulers: shows or hides them. */
export function toggleRulers(): void {
  shown = !shown;
  try {
    localStorage.setItem(KEY, shown ? "1" : "0");
  } catch {
    // kept for this visit only
  }
  stage?.classList.toggle("rulers", shown);
  redraw();
}

/** Puts the rulers' class on `stageEl` (the bars follow it) and redraws with `requestDraw` on a change. */
export function installRulers(stageEl: HTMLElement, requestDraw: () => void): void {
  stage = stageEl;
  redraw = requestDraw;
  stageEl.classList.toggle("rulers", shown);
}

/** The ruler's steps in mm for the document's units: labelled steps and the ticks between, largest first. */
function steps(units: string | undefined, scale: number): { major: number; minor: number } {
  const architectural = lengthSuffix(units) === "";
  let major: number;
  let candidates: number[];
  if (architectural) {
    candidates = INCH_STEPS.map((s) => s * MM_PER_INCH);
    major = candidates.find((s) => s * scale >= LABEL_PX) ?? candidates[candidates.length - 1];
  } else {
    const unit = millimetresPerUnit(units);
    major = niceStep(scale * unit, LABEL_PX) * unit;
    candidates = [];
    for (let s = major; s * scale >= TICK_PX / 10; s /= 10) candidates.push(s, s / 2, s / 5);
  }
  // the finest step that divides the labelled one evenly and still leaves room
  let minor = major;
  for (const s of candidates) {
    const n = major / s;
    if (s < minor && s * scale >= TICK_PX && Math.abs(n - Math.round(n)) < 1e-6) minor = s;
  }
  return { major, minor };
}

/** A labelled tick's text: feet or inches for feet and inches, else the number in the unit. */
function label(mm: number, units: string | undefined): string {
  if (lengthSuffix(units) === "") {
    const feet = mm / (12 * MM_PER_INCH);
    if (Math.abs(feet - Math.round(feet)) < 1e-6 && Math.round(feet) !== 0) return `${Math.round(feet)}'`;
    return formatLengthValue(mm, "Inches");
  }
  const v = mm / millimetresPerUnit(units);
  return String(Number(v.toPrecision(10)));
}

/** The CSS colour `name`, or `fallback`. */
function cssColor(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Draws the rulers over the top and left edges of the drawing (an overlay of the 2D view). */
export function drawRulers(p: Painter): void {
  if (!shown || !store.session || store.view3d) return;
  const { ctx, width: W, height: H, scale } = p;
  const units = store.session.doc.info.units;
  const { major, minor } = steps(units, scale);
  // a rotated plan's rulers measure its own coordinates, from its pivot along the screen, in blue
  const view = appContext()?.view;
  const rotated = view !== undefined && view.rotation !== 0;
  const origin = p.toScreen(rotated ? view.pivot : { x: 0, y: 0 });
  const ink = rotated ? ACCENT : cssColor("--text-soft", "#888");
  ctx.fillStyle = cssColor("--chrome", "#1d1d1d");
  ctx.fillRect(0, 0, W, SIZE);
  ctx.fillRect(0, 0, SIZE, H);
  ctx.strokeStyle = cssColor("--chrome-border", "#2e2e2e");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(SIZE, SIZE - 0.5);
  ctx.lineTo(W, SIZE - 0.5);
  ctx.moveTo(SIZE - 0.5, SIZE);
  ctx.lineTo(SIZE - 0.5, H);
  ctx.stroke();
  ctx.font = `9px ${cssColor("--font", "sans-serif")}`;
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.textBaseline = "top";
  const ticks = new Path2D();
  // along x: world x grows to the right
  const x0 = Math.ceil(-origin.x / scale / minor);
  const x1 = Math.floor((W - origin.x) / scale / minor);
  for (let k = x0; k <= x1; k++) {
    const sx = Math.round(origin.x + k * minor * scale) + 0.5;
    if (sx < SIZE) continue;
    const at = k * minor;
    const labelled = Math.abs(at / major - Math.round(at / major)) < 1e-6;
    ticks.moveTo(sx, labelled ? 2 : SIZE - (Math.abs((2 * at) / major - Math.round((2 * at) / major)) < 1e-6 ? 7 : 4));
    ticks.lineTo(sx, SIZE);
    if (labelled) ctx.fillText(label(at, units), sx + 3, 2);
  }
  // along y: world y grows upward, the labels read up the ruler
  const y0 = Math.ceil((origin.y - H) / scale / minor);
  const y1 = Math.floor(origin.y / scale / minor);
  for (let k = y0; k <= y1; k++) {
    const sy = Math.round(origin.y - k * minor * scale) + 0.5;
    if (sy < SIZE) continue;
    const at = k * minor;
    const labelled = Math.abs(at / major - Math.round(at / major)) < 1e-6;
    ticks.moveTo(labelled ? 2 : SIZE - (Math.abs((2 * at) / major - Math.round((2 * at) / major)) < 1e-6 ? 7 : 4), sy);
    ticks.lineTo(SIZE, sy);
    if (!labelled) continue;
    ctx.save();
    ctx.translate(2, sy - 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(label(at, units), 0, 0);
    ctx.restore();
  }
  ctx.stroke(ticks);
  // the pointer
  const c = store.cursor;
  if (!c) return;
  const s = p.toScreen(c);
  ctx.strokeStyle = ACCENT;
  ctx.beginPath();
  if (s.x >= SIZE && s.x <= W) {
    ctx.moveTo(Math.round(s.x) + 0.5, 0);
    ctx.lineTo(Math.round(s.x) + 0.5, SIZE);
  }
  if (s.y >= SIZE && s.y <= H) {
    ctx.moveTo(0, Math.round(s.y) + 0.5);
    ctx.lineTo(SIZE, Math.round(s.y) + 0.5);
  }
  ctx.stroke();
}
