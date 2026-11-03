// What the Site Planning and Building Shell plan tools draw (tools/site.ts), as plain geometry:
// a hardscape's border and paving joints, a row of parking stalls, a property line's bearings, a
// column, a pilaster and a straight stair in plan. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { steelOutline, type Drawing } from "./detailShapes.ts";
import { dist, offsetPolyline, signedArea } from "./geom.ts";

/** Text centred on `at`, its baseline turned `angle` degrees. */
export interface PlacedText {
  readonly at: Pt;
  readonly text: string;
  readonly height: number;
  readonly angle: number;
}

/** most joint lines a hardscape or ceiling grid draws */
export const MAX_JOINTS = 4000;
/** most stalls one parking row draws */
export const MAX_STALLS = 200;

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;

/** `pts` anticlockwise; null without area. */
function anticlockwise(pts: readonly Pt[]): Pt[] | null {
  const area = signedArea(pts);
  if (!(Math.abs(area) > 1e-9)) return null;
  return area > 0 ? [...pts] : [...pts].reverse();
}

/**
 * The pieces of the line through `p` along the unit `d` that lie inside the polygon `poly`, in
 * order along `d`. A vertex on the line counts once, by which side its edges' ends lie.
 */
export function clipLine(p: Pt, d: Pt, poly: readonly Pt[]): [Pt, Pt][] {
  const ts: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = cross(d, { x: a.x - p.x, y: a.y - p.y });
    const sb = cross(d, { x: b.x - p.x, y: b.y - p.y });
    if (sa > 0 === sb > 0) continue;
    const s = sa / (sa - sb);
    const at = { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
    ts.push(dot({ x: at.x - p.x, y: at.y - p.y }, d));
  }
  ts.sort((x, y) => x - y);
  const out: [Pt, Pt][] = [];
  for (let i = 0; i + 1 < ts.length; i += 2) {
    if (ts[i + 1] - ts[i] > 1e-9) out.push([add(p, d, ts[i]), add(p, d, ts[i + 1])]);
  }
  return out;
}

/**
 * A square grid of joints `spacing` apart, its lines turned `angle` radians and laid from the
 * drawing's origin (so neighbouring areas line up), clipped to `poly`. Null when it would draw
 * more than MAX_JOINTS lines.
 */
export function pavingJoints(poly: readonly Pt[], spacing: number, angle: number): [Pt, Pt][] | null {
  return gridLines(poly, spacing, spacing, angle, { x: 0, y: 0 });
}

/**
 * A grid of tiles `width` along the direction `angle` radians and `length` square to it, its lines
 * through `origin`, clipped to `poly`: the lines between the tiles, none on the outline itself.
 * Null when it would draw more than MAX_JOINTS lines.
 */
export function gridLines(poly: readonly Pt[], width: number, length: number, angle: number, origin: Pt): [Pt, Pt][] | null {
  if (!(width > 0) || !(length > 0) || poly.length < 3) return [];
  const u = { x: Math.cos(angle), y: Math.sin(angle) };
  const v = { x: -u.y, y: u.x };
  const out: [Pt, Pt][] = [];
  // lines along `along`, at multiples of `spacing` across it from the origin
  for (const [along, across, spacing] of [
    [u, v, length],
    [v, u, width],
  ] as const) {
    const o = dot(origin, across);
    // strictly between the outline's extremes: a joint on an edge square to it would only double it
    const offs = poly.map((q) => dot(q, across) - o);
    const lo = Math.floor(Math.min(...offs) / spacing + 1e-9) + 1;
    const hi = Math.ceil(Math.max(...offs) / spacing - 1e-9) - 1;
    if (hi - lo + 1 > MAX_JOINTS) return null;
    for (let k = lo; k <= hi; k++) {
      const at = o + k * spacing;
      out.push(...clipLine({ x: across.x * at, y: across.y * at }, along, poly));
      if (out.length > MAX_JOINTS) return null;
    }
  }
  return out;
}

/**
 * A hardscape from its outline: the outline anticlockwise, a border `border` wide inside it (none
 * at 0), and paving joints `spacing` apart at `angle` radians inside the border (none at 0).
 * Null when the outline has no area, the border closes it up, or the joints are too many.
 */
export function hardscape(
  corners: readonly Pt[],
  border: number,
  spacing: number,
  angle: number,
): { outline: Pt[]; inner: Pt[] | null; joints: [Pt, Pt][]; area: number } | null {
  const outline = anticlockwise(corners);
  if (!outline) return null;
  // the left of an anticlockwise outline's edges is inside it
  const inner = border > 0 ? offsetPolyline(outline, true, border) : null;
  if (border > 0 && (!inner || signedArea(inner) <= 0)) return null;
  const joints = pavingJoints(inner ?? outline, spacing, angle);
  if (!joints) return null;
  return { outline, inner, joints, area: Math.abs(signedArea(outline)) };
}

/**
 * A row of parking stalls along the curb from `a` to `b`, to its left: dividers `width` apart
 * square to the stalls, at `degrees` to the curb (90, 60 or 45) and reaching `depth` from it, and
 * the head line along their far ends. Null for no stall or more than MAX_STALLS.
 */
export function parkingRow(a: Pt, b: Pt, width: number, depth: number, degrees: number): { lines: Pt[][]; stalls: number } | null {
  const len = dist(a, b);
  if (!(len > 0) || !(width > 0) || !(depth > 0)) return null;
  const theta = (degrees * Math.PI) / 180;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  // a stall's width along the curb, and its divider's direction and length
  const pitch = width / Math.sin(theta);
  const along = add({ x: u.x * Math.cos(theta), y: u.y * Math.cos(theta) }, n, Math.sin(theta));
  const reach = depth / Math.sin(theta);
  const stalls = Math.floor(len / pitch + 1e-9);
  if (stalls < 1 || stalls > MAX_STALLS) return null;
  const lines: Pt[][] = [];
  for (let k = 0; k <= stalls; k++) {
    const foot = add(a, u, k * pitch);
    lines.push([foot, add(foot, along, reach)]);
  }
  lines.push([lines[0][1], lines[stalls][1]]);
  return { lines, stalls };
}

/** A surveyor's bearing of the line from `a` to `b` (north up the y axis): "N 45°30'15\" E". */
export function bearing(a: Pt, b: Pt): string {
  // the azimuth, clockwise from north, in whole seconds
  let az = Math.round(((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI) * 3600);
  az = ((az % 1296000) + 1296000) % 1296000;
  const q = az <= 324000 ? ["N", az, "E"] : az <= 648000 ? ["S", 648000 - az, "E"] : az <= 972000 ? ["S", az - 648000, "W"] : ["N", 1296000 - az, "W"];
  const secs = q[1] as number;
  const d = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const two = (x: number): string => String(x).padStart(2, "0");
  return `${q[0]} ${d}°${two(m)}'${two(s)}" ${q[2]}`;
}

/**
 * A property line's labels: each edge's bearing and `length(edge)` on one line, centred beside the
 * edge outside the outline and turned to read along it, the right way up.
 */
export function propertyLabels(corners: readonly Pt[], height: number, length: (mm: number) => string): { outline: Pt[]; labels: PlacedText[] } | null {
  const outline = anticlockwise(corners);
  if (!outline) return null;
  const labels = outline.map((a, i): PlacedText => {
    const b = outline[(i + 1) % outline.length];
    const len = dist(a, b);
    // the right of an anticlockwise outline's edge is outside it
    const out = { x: (b.y - a.y) / len, y: -(b.x - a.x) / len };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    // text running leftwards turns over, and its bearing is read the way it runs
    const flipped = raw > 90 + 1e-9 || raw <= -90 + 1e-9;
    const angle = flipped ? raw + (raw > 0 ? -180 : 180) : raw;
    const text = `${flipped ? bearing(b, a) : bearing(a, b)}  ${length(len)}`;
    return { at: add(mid, out, height * 0.9), text, height, angle };
  });
  return { outline, labels };
}

/** A column in plan about the origin: a `width` by `depth` rectangle with its diagonals, or a circle `width` across with two crossed diameters. Null for no size. */
export function columnPlan(round: boolean, width: number, depth: number): Drawing | null {
  if (!(width > 0) || (!round && !(depth > 0))) return null;
  if (round) {
    const r = width / 2;
    const k = r * Math.SQRT1_2;
    return {
      outlines: [],
      circles: [{ center: { x: 0, y: 0 }, radius: r }],
      lines: [
        [{ x: -k, y: -k }, { x: k, y: k }],
        [{ x: -k, y: k }, { x: k, y: -k }],
      ],
    };
  }
  const w = width / 2;
  const d = depth / 2;
  return {
    outlines: [[{ x: -w, y: -d }, { x: w, y: -d }, { x: w, y: d }, { x: -w, y: d }]],
    circles: [],
    lines: [
      [{ x: -w, y: -d }, { x: w, y: d }],
      [{ x: -w, y: d }, { x: w, y: -d }],
    ],
  };
}

export type PilasterUse = "arch" | "struct" | "both";
export type PilasterStruct = "concrete" | "wood" | "steel";

/**
 * A pilaster's plan, mm. Its insertion point lies on the wall's face, centred on the shaft, which
 * stands out from the face toward -y. The structural part and the centre marks sit `structOffset`
 * from the insertion point (+y out from the wall), turned by `structRotation` radians.
 */
export interface Pilaster {
  readonly use: PilasterUse;
  readonly shaftOval: boolean;
  readonly shaftWidth: number;
  readonly shaftDepth: number;
  /** a rectangular shaft's front corners */
  readonly shaftRadius: number;
  /** the base's and capital's outlines round the shaft; null without them */
  readonly base: { readonly width: number; readonly depth: number } | null;
  readonly capital: { readonly width: number; readonly depth: number } | null;
  readonly structType: PilasterStruct;
  /** concrete or wood: oval rather than rectangular */
  readonly structOval: boolean;
  readonly structWidth: number;
  readonly structDepth: number;
  readonly structOffset: Pt;
  readonly structRotation: number;
  /** cut back round the structural part, with both parts */
  readonly clearance: number;
  /** the centre marks' size; 0 for none */
  readonly centerMark: number;
}

/** points along a pilaster's half oval, a rounded corner's quarter */
const HALF_OVAL_STEPS = 32;
const CORNER_STEPS = 8;
/** a steel structural part's web and flange as shares of its depth, as a wide flange has them */
const STEEL_WEB = 0.035;
const STEEL_FLANGE = 0.05;

/** A shaft, base or capital `width` wide standing `depth` out from the wall's face, from the face round to the face. */
function pilasterFront(oval: boolean, width: number, depth: number, radius: number): Pt[] {
  const w = width / 2;
  if (oval) {
    return Array.from({ length: HALF_OVAL_STEPS + 1 }, (_, k) => {
      const t = Math.PI + (Math.PI * k) / HALF_OVAL_STEPS;
      return { x: w * Math.cos(t), y: depth * Math.sin(t) };
    });
  }
  const r = Math.max(0, Math.min(radius, w, depth));
  if (!(r > 0)) return [{ x: -w, y: 0 }, { x: -w, y: -depth }, { x: w, y: -depth }, { x: w, y: 0 }];
  const arc = (c: Pt, from: number): Pt[] =>
    Array.from({ length: CORNER_STEPS + 1 }, (_, k) => {
      const t = from + (Math.PI / 2) * (k / CORNER_STEPS);
      return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
    });
  return [{ x: -w, y: 0 }, ...arc({ x: -w + r, y: -depth + r }, Math.PI), ...arc({ x: w - r, y: -depth + r }, 1.5 * Math.PI), { x: w, y: 0 }];
}

/** The structural part's outline about the origin, before it's offset and turned. */
function pilasterStruct(p: Pilaster, grow: number): Pt[] | null {
  const w = p.structWidth / 2 + grow;
  const d = p.structDepth / 2 + grow;
  if (!(p.structWidth > 0 && p.structDepth > 0)) return null;
  if (p.structType === "steel" && grow === 0) {
    return steelOutline("w", { depth: p.structDepth, width: p.structWidth, web: p.structDepth * STEEL_WEB, flange: p.structDepth * STEEL_FLANGE });
  }
  if (p.structType !== "steel" && p.structOval) {
    return Array.from({ length: HALF_OVAL_STEPS * 2 }, (_, k) => {
      const t = (Math.PI * k) / HALF_OVAL_STEPS;
      return { x: w * Math.cos(t), y: d * Math.sin(t) };
    });
  }
  return [{ x: -w, y: -d }, { x: w, y: -d }, { x: w, y: d }, { x: -w, y: d }];
}

/**
 * A pilaster in plan about its insertion point: the base's and capital's outlines (lines from the
 * wall's face round to it) under the shaft, the shaft closed along the face, the clearance cut
 * round the structural part, the structural part, and the centre marks' cross. Null when a size
 * in use isn't more than 0.
 */
export function pilasterPlan(p: Pilaster): Drawing | null {
  const arch = p.use !== "struct";
  const struct = p.use !== "arch";
  if (arch && !(p.shaftWidth > 0 && p.shaftDepth > 0)) return null;
  const outlines: Pt[][] = [];
  const lines: Pt[][] = [];
  const at = (pts: readonly Pt[]): Pt[] => {
    const c = Math.cos(p.structRotation);
    const s = Math.sin(p.structRotation);
    // +y out from the wall is -y in the plan's frame
    return pts.map((q) => ({ x: p.structOffset.x + q.x * c - q.y * s, y: -p.structOffset.y + q.x * s + q.y * c }));
  };
  if (arch) {
    for (const part of [p.base, p.capital]) {
      if (part && part.width > 0 && part.depth > 0) lines.push(pilasterFront(p.shaftOval, part.width, part.depth, 0));
    }
    outlines.push(pilasterFront(p.shaftOval, p.shaftWidth, p.shaftDepth, p.shaftRadius));
  }
  if (struct) {
    const part = pilasterStruct(p, 0);
    if (!part) return null;
    if (arch && p.clearance > 0) outlines.push(at(pilasterStruct(p, p.clearance)!));
    outlines.push(at(part));
  }
  if (p.centerMark > 0) {
    const k = p.centerMark / 2;
    lines.push(at([{ x: -k, y: 0 }, { x: k, y: 0 }]), at([{ x: 0, y: -k }, { x: 0, y: k }]));
  }
  return { outlines, lines, circles: [] };
}

/**
 * A straight stair in plan from its foot `a` to its head `b`, `width` wide: its outline, a nosing
 * line at each tread as near `going` deep as divides the run, the walk line up its middle ending
 * in an arrow, the break line where the plan cuts it (halfway), and "UP" `textHeight` high just
 * before its foot. Null for fewer than two treads.
 */
export function straightStair(a: Pt, b: Pt, width: number, going: number, textHeight: number): { drawing: Drawing; treads: number; up: PlacedText } | null {
  const len = dist(a, b);
  if (!(len > 0) || !(width > 0) || !(going > 0)) return null;
  const treads = Math.round(len / going);
  if (treads < 2) return null;
  const g = len / treads;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: -u.y, y: u.x };
  const at = (s: number, t: number): Pt => add(add(a, u, s), n, t);
  const half = width / 2;
  const lines: Pt[][] = [];
  for (let k = 1; k < treads; k++) lines.push([at(k * g, -half), at(k * g, half)]);
  // the walk line, from the first tread's middle to just short of the head, and its arrow
  const tip = at(len - g / 2, 0);
  const head = Math.min(g, width / 4);
  lines.push([at(g / 2, 0), tip]);
  lines.push([at(len - g / 2 - head, head * 0.5), tip, at(len - g / 2 - head, -head * 0.5)]);
  // the break line: a diagonal across the run with a kink at its middle
  const mid = len / 2;
  const diag = (f: number): Pt => at(mid + (f - 0.5) * 0.6 * width, (0.5 - f) * width);
  const kick = 0.1 * width;
  lines.push([diag(0), diag(0.44), add(diag(0.47), u, kick), add(diag(0.53), u, -kick), diag(0.56), diag(1)]);
  const outline = [at(0, -half), at(len, -half), at(len, half), at(0, half)];
  return {
    drawing: { outlines: [outline], lines, circles: [] },
    treads,
    // level on the sheet, whichever way the stair runs
    up: { at: at(-textHeight * 1.2, 0), text: "UP", height: textHeight, angle: 0 },
  };
}
