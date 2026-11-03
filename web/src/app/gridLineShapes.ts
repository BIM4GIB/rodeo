// What Dims/Notes' Grid Line tool (tools/markers.ts) draws, as plain geometry: a straight or
// cornered grid line with a bubble holding its label past either end or both, a shoulder between,
// the label after it as Vectorworks increments one, and a copy of a grid line moved across, turned
// about its centre or offset for the next in a sequence. Kept apart from the tools so it runs
// without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";
import { CHAR_WIDTH, type MarkerDrawing } from "./markerShapes.ts";

export type BubbleEnds = "start" | "end" | "both" | "none";

/** How a grid line looks, in drawing units. */
export interface GridLineLook {
  readonly label: string;
  /** the bubble's radius */
  readonly r: number;
  readonly shoulderStart: number;
  readonly shoulderEnd: number;
  readonly bubbles: BubbleEnds;
}

/** a bubble's label height against its radius, for a short label */
const LABEL_SHARE = 0.6;
/** a long label shrinks to fit this share of the bubble's width */
const LABEL_FIT = 0.8;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });

/** The unit direction from `a` to `b`, or null when they meet. */
function unit(a: Pt, b: Pt): Pt | null {
  const d = dist(a, b);
  return d > 0 ? { x: (b.x - a.x) / d, y: (b.y - a.y) / d } : null;
}

/** The way out of the path past its `end`: from the nearest other point toward the end. */
function outward(path: readonly Pt[], end: "start" | "end"): Pt | null {
  const pts = end === "start" ? path : [...path].reverse();
  for (let i = 1; i < pts.length; i++) {
    const u = unit(pts[i], pts[0]);
    if (u) return u;
  }
  return null;
}

/**
 * A grid line along `path` (two points for a straight one, more for corners), with a bubble past
 * the ends `look.bubbles` names, each on a shoulder running on in the line's direction, the label
 * centred in it. Null when the path has no length or the bubble no size.
 */
export function gridLine(path: readonly Pt[], look: GridLineLook): MarkerDrawing | null {
  if (path.length < 2 || !(look.r > 0) || !outward(path, "start")) return null;
  const d: MarkerDrawing = { outlines: [], lines: [[...path]], circles: [], filled: [], texts: [] };
  const ends: ("start" | "end")[] = look.bubbles === "both" ? ["start", "end"] : look.bubbles === "none" ? [] : [look.bubbles];
  const height = Math.min(LABEL_SHARE * look.r, (2 * LABEL_FIT * look.r) / (CHAR_WIDTH * Math.max(1, look.label.length)));
  for (const end of ends) {
    const at = end === "start" ? path[0] : path[path.length - 1];
    const u = outward(path, end)!;
    const shoulder = Math.max(0, end === "start" ? look.shoulderStart : look.shoulderEnd);
    if (shoulder > 0) d.lines.push([at, add(at, u, shoulder)]);
    const c = add(at, u, shoulder + look.r);
    d.circles.push({ center: c, radius: look.r });
    if (look.label) d.texts.push({ at: c, text: look.label, height, justify: "centre" });
  }
  return d;
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";
const isUpper = (c: string | undefined): boolean => c !== undefined && c >= "A" && c <= "Z";
const isLower = (c: string | undefined): boolean => c !== undefined && c >= "a" && c <= "z";

/** A run of digits, any points between them kept in place, one more: 1.9 → 2.0, 3.09 → 3.10, 99 → 100. */
function nextNumber(block: string): string {
  const out = block.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === ".") continue;
    if (out[i] !== "9") {
      out[i] = String(Number(out[i]) + 1);
      return out.join("");
    }
    out[i] = "0";
  }
  return `1${out.join("")}`;
}

/**
 * A run of letters of one case, one more: a doubled or tripled letter steps to the next doubled
 * or tripled one and the last to one more of the first (Z → AA, ZZ → AAA, as Vectorworks does);
 * mixed letters step the last, carrying (AZ → BA).
 */
function nextLetters(block: string): string {
  const first = isUpper(block[0]) ? "A" : "a";
  const last = isUpper(block[0]) ? "Z" : "z";
  const step = (c: string): string => String.fromCharCode(c.charCodeAt(0) + 1);
  if ([...block].every((c) => c === block[0])) return block[0] === last ? first.repeat(block.length + 1) : step(block[0]).repeat(block.length);
  const out = block.split("");
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] !== last) {
      out[i] = step(out[i]);
      return out.join("");
    }
    out[i] = first;
  }
  return first + out.join("");
}

/** The label after `label`: only its rightmost run of digits or of letters of one case steps on. */
function increment(label: string): string {
  let end = label.length;
  while (end > 0 && !isDigit(label[end - 1]) && !isUpper(label[end - 1]) && !isLower(label[end - 1])) end--;
  if (end === 0) return `${label}1`;
  let start = end - 1;
  if (isDigit(label[start])) {
    // a point between digits belongs to the number (A1.9 → A2.0); after a letter it doesn't (01c.9 → 01c.10)
    while (start > 0 && (isDigit(label[start - 1]) || (label[start - 1] === "." && isDigit(label[start - 2])))) start--;
    return label.slice(0, start) + nextNumber(label.slice(start, end)) + label.slice(end);
  }
  const same = isUpper(label[start]) ? isUpper : isLower;
  while (start > 0 && same(label[start - 1])) start--;
  return label.slice(0, start) + nextLetters(label.slice(start, end)) + label.slice(end);
}

/**
 * The next grid line's label, as Vectorworks increments one, stepping past any label holding a
 * character of `skip` (for letters such as I and O; digits can't be skipped).
 */
export function nextGridLabel(label: string, skip = ""): string {
  const avoid = [...skip].filter((c) => !isDigit(c) && c.trim());
  let next = increment(label);
  for (let i = 0; i < 1000 && avoid.some((c) => next.includes(c) && !label.includes(c)); i++) next = increment(next);
  return next;
}

/** The point on the line through `a` and `b` nearest `p`. */
function along(a: Pt, b: Pt, p: Pt): Pt {
  const u = unit(a, b);
  if (!u) return a;
  const t = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
  return add(a, u, t);
}

/**
 * A radial grid line about `centre`: from `start` along the ray from the centre through it to
 * where `to` falls on that line (through the centre and past it, if `to` lies behind). Null when
 * the start is on the centre or the line has no length.
 */
export function radialPath(centre: Pt, start: Pt, to: Pt): Pt[] | null {
  if (!unit(centre, start)) return null;
  const end = along(centre, start, to);
  return dist(start, end) > 0 ? [start, end] : null;
}

/** `path` offset `by` to its left (negative: its right), each corner where its offset sides meet. */
export function offsetPath(path: readonly Pt[], by: number): Pt[] | null {
  const pts = path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 0);
  if (pts.length < 2) return null;
  const sides = pts.slice(1).map((b, i) => {
    const u = unit(pts[i], b)!;
    const n = { x: -u.y, y: u.x };
    return { a: add(pts[i], n, by), b: add(b, n, by), u };
  });
  const out: Pt[] = [sides[0].a];
  for (let i = 1; i < sides.length; i++) {
    const s = sides[i - 1];
    const t = sides[i];
    const cross = s.u.x * t.u.y - s.u.y * t.u.x;
    if (Math.abs(cross) < 1e-9) {
      out.push(t.a);
      continue;
    }
    // where the offset sides' lines meet
    const k = ((t.a.x - s.a.x) * t.u.y - (t.a.y - s.a.y) * t.u.x) / cross;
    out.push(add(s.a, s.u, k));
  }
  out.push(sides[sides.length - 1].b);
  return out;
}

/** How far `p` lies to the left of `path` (negative: to its right), from the nearest of its sides. */
export function sideOf(path: readonly Pt[], p: Pt): number {
  let best = Infinity;
  let signed = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const u = unit(a, path[i]);
    if (!u) continue;
    const len = dist(a, path[i]);
    const t = Math.max(0, Math.min(len, (p.x - a.x) * u.x + (p.y - a.y) * u.y));
    const q = add(a, u, t);
    const d = dist(p, q);
    if (d < best) {
      best = d;
      signed = u.x * (p.y - a.y) - u.y * (p.x - a.x);
    }
  }
  return signed;
}

/** `path` turned `angle` radians about `centre`. */
export function turnedPath(path: readonly Pt[], centre: Pt, angle: number): Pt[] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return path.map((p) => ({ x: centre.x + (p.x - centre.x) * c - (p.y - centre.y) * s, y: centre.y + (p.x - centre.x) * s + (p.y - centre.y) * c }));
}
