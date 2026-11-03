// What Irrigation's tools draw (tools/irrigation.ts) in Top/Plan, as plain geometry in the
// drawing's coordinates: an outlet's symbol with its coverage (its throw radius over its spray
// arc), one at a point or many along or across a clicked path; a pipe along its path; a drip
// area's rows of drip line; and the default symbols a valve, point of connection, controller and
// system component show, sized on paper (the tool scales them), with their labels. Kept apart from
// the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist, distToPolyline, pointInPolygon } from "./geom.ts";
import type { MarkerDrawing, MarkerText } from "./markerShapes.ts";

export type OutletType = "spray" | "rotor" | "emitter";
export type SymbolRotation = "none" | "coverage";
export type SpacingMode = "overlap" | "fixed" | "fitDistance" | "fitOverlap" | "count";
export type PipeKind = "main" | "lateral" | "drip";

/** most outlets placed at once, so a slip of the units can't hang the page */
export const MAX_OUTLETS = 5000;
/** points round a full circle */
const CIRCLE_STEPS = 48;

const at = (x: number, y: number): Pt => ({ x, y });

type Draft = { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[]; filled: Pt[][]; texts: MarkerText[] };
const empty = (): Draft => ({ outlines: [], lines: [], circles: [], filled: [], texts: [] });

export interface Outlet {
  readonly type: OutletType;
  /** the throw radius, or an emitter's spacing, mm */
  readonly radius: number;
  /** the spray arc, degrees */
  readonly arc: number;
  readonly coverage: boolean;
  readonly rotation: SymbolRotation;
}

/** An outlet placed: where it is and which way its spray arc's middle points, radians. */
export interface OutletAt {
  readonly at: Pt;
  readonly dir: number;
}

/** Why outlets can't be drawn, or null. */
export function outletProblem(o: Outlet): string | null {
  if (!(o.radius > 0)) return "Set a Radius over 0.";
  if (o.type !== "emitter" && !(o.arc > 0 && o.arc <= 360)) return "Set an Arc over 0° and up to 360°.";
  return null;
}

/**
 * Outlets drawn: each one's symbol `size` across (a spray's square, a rotor's circle, an
 * emitter's dot), turned a corner toward its coverage when the symbol rotates that way; and,
 * shown, the coverage itself, a circle of the throw radius or a wedge over the spray arc (an
 * emitter has none: its radius is its spacing).
 */
export function outlets(list: readonly OutletAt[], o: Outlet, size: number): MarkerDrawing {
  const d = empty();
  const full = o.arc >= 360;
  for (const { at: c, dir } of list) {
    const h = size / 2;
    if (o.type === "spray") {
      const turn = o.rotation === "coverage" && !full ? dir - Math.PI / 4 : 0;
      d.outlines.push([0, 1, 2, 3].map((i) => at(c.x + h * Math.SQRT2 * Math.cos(turn + Math.PI / 4 + (i * Math.PI) / 2), c.y + h * Math.SQRT2 * Math.sin(turn + Math.PI / 4 + (i * Math.PI) / 2))));
    } else if (o.type === "rotor") d.circles.push({ center: c, radius: h });
    else d.filled.push(Array.from({ length: 12 }, (_, i) => at(c.x + (h / 2) * Math.cos((i * Math.PI) / 6), c.y + (h / 2) * Math.sin((i * Math.PI) / 6))));
    if (!o.coverage || o.type === "emitter") continue;
    if (full) d.circles.push({ center: c, radius: o.radius });
    else {
      const half = (o.arc * Math.PI) / 360;
      const steps = Math.max(2, Math.ceil((o.arc / 360) * CIRCLE_STEPS));
      const rim = Array.from({ length: steps + 1 }, (_, i) => {
        const a = dir - half + (2 * half * i) / steps;
        return at(c.x + o.radius * Math.cos(a), c.y + o.radius * Math.sin(a));
      });
      d.outlines.push([c, ...rim]);
    }
  }
  return d;
}

export interface Spacing {
  readonly mode: SpacingMode;
  /** the overlap %, the distance, or the count */
  readonly value: number;
  /** along the spray direction, mm */
  readonly offset: number;
}

/** The spacing an overlap % of the throw radius gives: 100% puts each outlet's throw at the next one (head to head). */
const overlapSpacing = (radius: number, pct: number): number => radius * (2 - pct / 100);

/** Why outlets can't be spaced this way, or null. */
export function spacingProblem(s: Spacing, radius: number): string | null {
  if (s.mode === "count") return s.value >= 1 && Number.isInteger(s.value) ? null : "Set a whole Value of 1 or more outlets.";
  if (s.mode === "fixed" || s.mode === "fitDistance") return s.value > 0 ? null : "Set a Value (the distance) over 0.";
  return overlapSpacing(radius, s.value) > 0 ? null : "Set a Value (the overlap) under 200%.";
}

/** Where along a run `length` long outlets go: from its start every spacing, or spread evenly from end to end. */
function stations(length: number, s: Spacing, radius: number): number[] | string {
  let gaps: number;
  if (s.mode === "overlap" || s.mode === "fixed") {
    const step = s.mode === "fixed" ? s.value : overlapSpacing(radius, s.value);
    if (length / step > MAX_OUTLETS) return "Too many outlets to place: set a wider spacing.";
    return Array.from({ length: Math.floor(length / step + 1e-9) + 1 }, (_, i) => i * step);
  }
  if (s.mode === "count") {
    if (s.value === 1) return [length / 2];
    gaps = s.value - 1;
  } else if (s.mode === "fitDistance") gaps = Math.max(1, Math.floor(length / s.value + 1e-9));
  else gaps = Math.max(1, Math.ceil(length / overlapSpacing(radius, s.value) - 1e-9));
  if (gaps + 1 > MAX_OUTLETS) return "Too many outlets to place: set a wider spacing.";
  return Array.from({ length: gaps + 1 }, (_, i) => (length * i) / gaps);
}

/**
 * Outlets along a clicked path, spaced along its whole length by the spacing, each spraying to
 * the path's left (the side a left-to-right path has above it), moved that way by the offset.
 */
export function outletsAlong(path: readonly Pt[], o: Outlet, s: Spacing): OutletAt[] | string {
  const problem = outletProblem(o) ?? spacingProblem(s, o.radius);
  if (problem) return problem;
  const lens = path.slice(1).map((p, i) => dist(path[i], p));
  const total = lens.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return "Click a longer path.";
  const at0 = stations(total, s, o.radius);
  if (typeof at0 === "string") return at0;
  return at0.map((station) => {
    let left = station;
    let i = 0;
    while (i < lens.length - 1 && left > lens[i]) left -= lens[i++];
    const a = path[i];
    const b = path[i + 1];
    const u = lens[i] > 0 ? at((b.x - a.x) / lens[i], (b.y - a.y) / lens[i]) : at(1, 0);
    const k = lens[i] > 0 ? Math.min(left, lens[i]) : 0;
    const dir = Math.atan2(u.x, -u.y);
    return { at: at(a.x + u.x * k - u.y * s.offset, a.y + u.y * k + u.x * s.offset), dir };
  });
}

/**
 * Outlets filling the area a clicked path outlines, in rows from its lower left: square
 * (rectangular) or each row shifted half a spacing and the rows closer (triangular). Overlap
 * and Fixed space them so; the fitting modes and By Count spread them evenly across the
 * area's width (By Count: so many to a row) and its height. Only those inside or on its
 * outline are kept, sprayed up the drawing.
 */
export function outletsArray(outline: readonly Pt[], o: Outlet, s: Spacing, triangular: boolean): OutletAt[] | string {
  const problem = outletProblem(o) ?? spacingProblem(s, o.radius);
  if (problem) return problem;
  if (outline.length < 3) return "Click at least three corners round the area.";
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  if (!(w > 0 && h > 0)) return "Click corners round an area.";
  const row = triangular ? Math.sqrt(3) / 2 : 1;
  let sx: number;
  let sy: number;
  if (s.mode === "overlap" || s.mode === "fixed") {
    sx = s.mode === "fixed" ? s.value : overlapSpacing(o.radius, s.value);
    sy = sx * row;
  } else {
    const n = s.mode === "count" ? Math.max(1, s.value - 1) : s.mode === "fitDistance" ? Math.max(1, Math.floor(w / s.value + 1e-9)) : Math.max(1, Math.ceil(w / overlapSpacing(o.radius, s.value) - 1e-9));
    sx = w / n;
    sy = h / Math.max(1, Math.round(h / (sx * row)));
  }
  if (((w / sx + 2) * (h / sy + 2)) > MAX_OUTLETS * 4) return "Too many outlets to place: set a wider spacing.";
  const tol = Math.min(sx, sy) * 1e-6;
  const list: OutletAt[] = [];
  for (let j = 0; y0 + j * sy <= y0 + h + tol; j++) {
    const shift = triangular && j % 2 === 1 ? sx / 2 : 0;
    for (let i = 0; x0 + shift + i * sx <= x0 + w + tol; i++) {
      const p = at(x0 + shift + i * sx, y0 + j * sy);
      if (pointInPolygon(p, outline) || distToPolyline(p, outline, true) <= tol * 1e3) list.push({ at: p, dir: Math.PI / 2 });
      if (list.length > MAX_OUTLETS) return "Too many outlets to place: set a wider spacing.";
    }
  }
  return list.length ? list : "No outlets fit inside the area at this spacing.";
}

export interface IrrigationPipe {
  readonly kind: PipeKind;
  readonly flowDirection: boolean;
  /** a nominal diameter to label it with, shown when not blank */
  readonly diameter: string;
}

/**
 * A pipe along a clicked path; with Show Flow Direction an arrowhead at its middle pointing on
 * from its start; its nominal diameter labelled beside its middle, `size` high.
 */
export function irrigationPipe(path: readonly Pt[], p: IrrigationPipe, size: number): MarkerDrawing | string {
  if (path.length < 2) return "Click at least two points for the pipe.";
  const lens = path.slice(1).map((q, i) => dist(path[i], q));
  const total = lens.reduce((a, b) => a + b, 0);
  if (!(total > 0)) return "Click points apart for the pipe.";
  const d = empty();
  d.lines.push([...path]);
  let left = total / 2;
  let i = 0;
  while (i < lens.length - 1 && left > lens[i]) left -= lens[i++];
  const u = lens[i] > 0 ? at((path[i + 1].x - path[i].x) / lens[i], (path[i + 1].y - path[i].y) / lens[i]) : at(1, 0);
  const mid = at(path[i].x + u.x * left, path[i].y + u.y * left);
  if (p.flowDirection) {
    const h = size;
    d.filled.push([at(mid.x + u.x * h, mid.y + u.y * h), at(mid.x - u.x * h - u.y * h * 0.5, mid.y - u.y * h + u.x * h * 0.5), at(mid.x - u.x * h + u.y * h * 0.5, mid.y - u.y * h - u.x * h * 0.5)]);
  }
  if (p.diameter.trim()) {
    // above the pipe, reading along it (left to right or upward)
    let angle = (Math.atan2(u.y, u.x) * 180) / Math.PI;
    if (angle > 90) angle -= 180;
    else if (angle <= -90) angle += 180;
    const up = at(-Math.sin((angle * Math.PI) / 180), Math.cos((angle * Math.PI) / 180));
    const along = at(Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180));
    const c = at(mid.x + up.x * size * 0.9 + along.x * size * 2, mid.y + up.y * size * 0.9 + along.y * size * 2);
    d.texts.push({ at: c, text: p.diameter.trim(), height: size, justify: "left", angle });
  }
  return d;
}

/** a symbol's label height and gap against its size */
const LABEL_SHARE = 0.6;
const LABEL_GAP = 0.3;

/** `text` above `size`'s symbol centred on the origin, when not blank. */
function labelAbove(into: Draft, text: string, size: number): void {
  if (text.trim()) into.texts.push({ at: at(0, size / 2 + size * LABEL_GAP + (size * LABEL_SHARE) / 2), text: text.trim(), height: size * LABEL_SHARE, justify: "centre" });
}

/** A valve's symbol `size` across on the origin: a circle in quarters, the upper left and lower right filled, on a stub of pipe; its label above. */
export function valve(size: number, label: string): MarkerDrawing {
  const d = empty();
  const r = size / 2;
  d.circles.push({ center: at(0, 0), radius: r });
  d.lines.push([at(-1.6 * r, 0), at(1.6 * r, 0)], [at(0, -r), at(0, r)]);
  const quarter = (from: number): Pt[] => [at(0, 0), ...Array.from({ length: 7 }, (_, i) => at(r * Math.cos(((from + 15 * i) * Math.PI) / 180), r * Math.sin(((from + 15 * i) * Math.PI) / 180)))];
  d.filled.push(quarter(90), quarter(270));
  labelAbove(d, label, size);
  return d;
}

/** A point of connection's symbol `size` across on the origin: a union, two flanges across a stub of pipe; its label above. */
export function pointOfConnection(size: number, label: string): MarkerDrawing {
  const d = empty();
  const h = size / 2;
  d.lines.push([at(-h, 0), at(h, 0)]);
  for (const x of [-h / 4, h / 4]) d.outlines.push([at(x - h / 10, -h * 0.7), at(x + h / 10, -h * 0.7), at(x + h / 10, h * 0.7), at(x - h / 10, h * 0.7)]);
  labelAbove(d, label, size);
  return d;
}

/** A controller's symbol `size` across on the origin: two solid triangles meeting point to point; its label above. */
export function controller(size: number, label: string): MarkerDrawing {
  const d = empty();
  const h = size / 2;
  d.filled.push([at(-h, h), at(h, h), at(0, 0)], [at(0, 0), at(h, -h), at(-h, -h)]);
  labelAbove(d, label, size);
  return d;
}

/** most drip rows in an area, so a slip of the units can't hang the page */
const MAX_ROWS = 2000;

/**
 * The rows of drip line filling the area `outline` encloses, as Show Drip Lines draws it: parallel
 * lines `spacing` apart running along its first edge, as many as fit across it a spacing apart
 * (at least one), centred across it, each cut where it crosses the outline.
 */
export function dripRows(outline: readonly Pt[], spacing: number): Pt[][] | string {
  if (outline.length < 3) return "Click at least three corners round the drip area.";
  if (!(spacing > 0)) return "Set a Row Spacing over 0.";
  const o = outline[0];
  const len = dist(o, outline[1]);
  if (!(len > 0)) return "Click the drip area's first two corners apart.";
  const u = at((outline[1].x - o.x) / len, (outline[1].y - o.y) / len);
  const n = at(-u.y, u.x);
  const along = (p: Pt) => (p.x - o.x) * u.x + (p.y - o.y) * u.y;
  const vs = outline.map((p) => (p.x - o.x) * n.x + (p.y - o.y) * n.y);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  if (!(hi - lo > 0)) return "Click corners round an area.";
  if ((hi - lo) / spacing > MAX_ROWS) return "Too many drip rows: set a wider Row Spacing.";
  const point = (t: number, v: number) => at(o.x + u.x * t + n.x * v, o.y + u.y * t + n.y * v);
  const rows: Pt[][] = [];
  const count = Math.max(1, Math.floor((hi - lo) / spacing + 1e-9));
  for (let r = 0; r < count; r++) {
    const v = lo + (hi - lo - (count - 1) * spacing) / 2 + r * spacing;
    // where the row's line crosses the outline, paired in order
    const ts: number[] = [];
    for (let i = 0; i < outline.length; i++) {
      const k = (i + 1) % outline.length;
      if (vs[i] <= v === vs[k] <= v) continue;
      const f = (v - vs[i]) / (vs[k] - vs[i]);
      ts.push(along(outline[i]) + (along(outline[k]) - along(outline[i])) * f);
    }
    ts.sort((a, b) => a - b);
    for (let i = 0; i + 1 < ts.length; i += 2) if (ts[i + 1] > ts[i]) rows.push([point(ts[i], v), point(ts[i + 1], v)]);
  }
  return rows.length ? rows : "No drip rows fit inside the area at this spacing.";
}

/** Why an outline can't be a zone, or null. */
export function zoneProblem(outline: readonly Pt[]): string | null {
  return outline.length < 3 ? "Click at least three corners round the zone." : null;
}

/** The Zone ID after `id`: its last number counted on (keeping its width), else its last letter, else unchanged. */
export function nextZoneId(id: string): string {
  const num = /^(.*?)(\d+)$/.exec(id);
  if (num) return num[1] + String(Number(num[2]) + 1).padStart(num[2].length, "0");
  const letter = /^(.*?)([A-Ya-y])$/.exec(id);
  if (letter) return letter[1] + String.fromCharCode(letter[2].charCodeAt(0) + 1);
  return id;
}
