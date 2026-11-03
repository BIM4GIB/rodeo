// Shafts: segments end to end along an axis, each straight, tapered or threaded, seen from the side.
// A straight or tapered segment's ends may be chamfered or flared (bevelled), or filleted or
// radiused (rounded); a straight one may carry a keyway (parallel or Woodruff, facing the viewer,
// up, down or away), a groove (round, rectangular or V) and wrench flats (one or two). A threaded
// segment's thread is drawn simplified (ASME's dashed or ISO's solid root lines), schematic or
// detailed, its ends plain or chamfered, a relief groove at one end for a bearing lock nut's thread.
// Centre drills (DIN 332 form A, or B with its protecting cone) show as hidden lines at the ends.
// Pure geometry in mm: the shaft's left end on the origin, its axis along +x.

import type { Pt } from "../core/index.ts";
import { slotOutline, type HoleDrawing } from "./machineShapes.ts";
import { clipX, roundVertex } from "./wormShapes.ts";

export const MAX_SEGMENTS = 50;
/** most thread turns a detailed segment draws */
const MAX_TURNS = 2000;
/** points across a chamfered thread's end, and along a round groove or Woodruff keyseat */
const CAP_STEPS = 16;
const ARC_STEPS = 16;

export type SegmentType = "straight" | "tapered" | "threaded";
export type EndStyle = "plain" | "chamfer" | "flare" | "fillet" | "radius";
export type ThreadDisplay = "asme" | "iso" | "schematic" | "detailed";
export type MeasureFrom = "left" | "right";

export interface SegmentEnd {
  readonly diameter: number;
  readonly style: EndStyle;
  /** along the axis */
  readonly chamferLength: number;
  /** degrees from the axis */
  readonly chamferAngle: number;
  readonly filletRadius: number;
}

/** A thread's form: flats as shares of the pitch, the included angle in degrees. */
export interface ThreadForm {
  readonly outside: number;
  readonly pitch: number;
  readonly angle: number;
  readonly flatTop: number;
  readonly flatBottom: number;
  readonly starts: number;
  readonly leftHand: boolean;
  /** an undercut to the root, two pitches wide, at one end */
  readonly relief: "none" | "left" | "right";
}

export interface ShaftKeyway {
  readonly from: MeasureFrom;
  readonly distance: number;
  readonly position: "front" | "top" | "bottom" | "back";
  readonly width: number;
  /** into the shaft */
  readonly depth: number;
  /** a parallel keyway's length; a Woodruff keyseat's is the cutter's chord */
  readonly length: number;
  /** a Woodruff keyseat's cutter diameter, or null for a parallel keyway */
  readonly cutter: number | null;
}

export interface ShaftGroove {
  readonly from: MeasureFrom;
  readonly distance: number;
  readonly type: "round" | "rectangular" | "v";
  readonly width: number;
  readonly depth: number;
}

export interface ShaftFlats {
  readonly from: MeasureFrom;
  readonly distance: number;
  readonly type: "single" | "double";
  readonly length: number;
  readonly across: number;
}

export interface ShaftSegment {
  readonly type: SegmentType;
  readonly length: number;
  /** a straight segment's diameter is its left end's; a threaded one's is its thread's */
  readonly left: SegmentEnd;
  readonly right: SegmentEnd;
  readonly thread: ThreadForm | null;
  readonly keyway: ShaftKeyway | null;
  readonly groove: ShaftGroove | null;
  readonly flats: ShaftFlats | null;
}

/** DIN 332 centre drills: the pilot's diameter, form A's 60° countersink and form B's 120° protecting cone, mm. */
export const CENTRE_DRILLS: readonly { readonly pilot: number; readonly countersink: number; readonly bell: number }[] = [
  [1, 2.12, 3.15],
  [1.6, 3.35, 5],
  [2, 4.25, 6.3],
  [2.5, 5.3, 8],
  [3.15, 6.7, 10],
  [4, 8.5, 12.5],
  [5, 10.6, 16],
  [6.3, 13.2, 18],
  [8, 17, 22.4],
  [10, 21.2, 28],
].map(([pilot, countersink, bell]) => ({ pilot, countersink, bell }));

export interface CentreDrill {
  readonly style: "plain" | "bell";
  /** an index into CENTRE_DRILLS */
  readonly size: number;
  readonly ends: "left" | "right" | "both";
}

export interface Shaft {
  readonly segments: readonly ShaftSegment[];
  readonly threads: ThreadDisplay;
  readonly centreDrill: CentreDrill | null;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A segment's radius at its left and right ends. */
function endRadii(s: ShaftSegment): { left: number; right: number } {
  if (s.type === "threaded" && s.thread) return { left: s.thread.outside / 2, right: s.thread.outside / 2 };
  return { left: s.left.diameter / 2, right: (s.type === "tapered" ? s.right.diameter : s.left.diameter) / 2 };
}

/** A thread's depth from crest to root. */
export function threadDepth(t: ThreadForm): number {
  return (t.pitch * (1 - t.flatTop - t.flatBottom)) / (2 * Math.tan(rad(t.angle) / 2));
}

/** Where a feature measured `distance` from a segment's end starts along the shaft, for a feature `length` long. */
function featureStart(x0: number, x1: number, from: MeasureFrom, distance: number, length: number): number {
  return from === "left" ? x0 + distance : x1 - distance - length;
}

/** A Woodruff keyseat's chord at the shaft's surface. */
function woodruffChord(cutter: number, depth: number): number {
  const r = cutter / 2;
  return 2 * Math.sqrt(Math.max(0, r * r - (r - depth) ** 2));
}

/** A keyway's length along the shaft. */
function keywayLength(k: ShaftKeyway): number {
  return k.cutter === null ? k.length : woodruffChord(k.cutter, k.depth);
}

/** Why segment `s` (number `n`) can't be drawn, or null. */
function segmentProblem(s: ShaftSegment, n: number): string | null {
  const at = `segment ${n}`;
  if (!(s.length > 0)) return `${at} needs a length`;
  if (s.type === "threaded") {
    const t = s.thread;
    if (!t) return `${at} needs a thread`;
    if (!(t.outside > 0 && t.pitch > 0)) return `${at}'s thread needs a diameter and a pitch`;
    if (!(t.angle > 0 && t.angle < 180)) return `${at}'s thread angle must be between 0° and 180°`;
    if (!(t.flatTop >= 0 && t.flatBottom >= 0 && t.flatTop + t.flatBottom < 1)) return `${at}'s thread flats must leave room for its flanks`;
    if (!(Number.isInteger(t.starts) && t.starts >= 1 && t.starts <= 8)) return `${at}'s thread has 1 to 8 starts`;
    if (!(threadDepth(t) < t.outside / 2)) return `${at}'s thread is deeper than its radius`;
    if (s.length / t.pitch > MAX_TURNS) return `${at}'s thread has more than ${MAX_TURNS} turns`;
    if (t.relief !== "none" && !(2 * t.pitch < s.length)) return `${at}'s thread relief is longer than the segment`;
  } else {
    if (!(s.left.diameter > 0 && (s.type === "straight" || s.right.diameter > 0))) return `${at} needs its diameters`;
  }
  const radii = endRadii(s);
  for (const [name, end, r] of [["left", s.left, radii.left], ["right", s.right, radii.right]] as const) {
    if (end.style === "chamfer" || end.style === "flare") {
      if (!(end.chamferLength > 0 && end.chamferLength < s.length)) return `${at}'s ${name} chamfer must be shorter than the segment`;
      if (!(end.chamferAngle > 0 && end.chamferAngle < 90)) return `${at}'s ${name} chamfer angle must be between 0° and 90°`;
      if (end.style === "chamfer" && !(end.chamferLength * Math.tan(rad(end.chamferAngle)) < r)) return `${at}'s ${name} chamfer cuts past the axis`;
    }
    if ((end.style === "fillet" || end.style === "radius") && !(end.filletRadius > 0)) return `${at}'s ${name} fillet radius must be more than 0`;
  }
  const r = Math.min(radii.left, radii.right);
  if (s.keyway) {
    const k = s.keyway;
    if (s.type !== "straight") return `${at}: only a straight segment takes a keyway`;
    if (!(k.width > 0 && k.depth > 0 && k.depth < r && k.width < 2 * r)) return `${at}'s keyway must be narrower and shallower than the shaft`;
    if (k.cutter !== null && !(k.cutter > k.depth)) return `${at}'s Woodruff cutter must be wider than its keyseat is deep`;
    if (k.cutter === null && !(k.length > k.width)) return `${at}'s keyway must be longer than it is wide`;
    const start = featureStart(0, s.length, k.from, k.distance, keywayLength(k));
    if (!(k.distance >= 0 && start >= -1e-9 && start + keywayLength(k) <= s.length + 1e-9)) return `${at}'s keyway runs past the segment's end`;
  }
  if (s.groove) {
    const g = s.groove;
    if (s.type !== "straight") return `${at}: only a straight segment takes a groove`;
    if (!(g.width > 0 && g.depth > 0 && g.depth < r)) return `${at}'s groove must be shallower than the shaft`;
    if (g.type === "round" && !(g.depth <= g.width / 2)) return `${at}'s round groove can be at most half its width deep`;
    const start = featureStart(0, s.length, g.from, g.distance, g.width);
    if (!(g.distance >= 0 && start >= -1e-9 && start + g.width <= s.length + 1e-9)) return `${at}'s groove runs past the segment's end`;
  }
  if (s.flats) {
    const f = s.flats;
    if (s.type !== "straight") return `${at}: only a straight segment takes wrench flats`;
    const h = f.type === "double" ? f.across / 2 : f.across - r;
    if (!(f.length > 0 && h > 0 && h < r)) return `${at}'s width across flats must cut the shaft without passing its ${f.type === "double" ? "axis" : "middle"}`;
    const start = featureStart(0, s.length, f.from, f.distance, f.length);
    if (!(f.distance >= 0 && start >= -1e-9 && start + f.length <= s.length + 1e-9)) return `${at}'s wrench flats run past the segment's end`;
  }
  return null;
}

/** Why `shaft` can't be drawn, or null when it can. */
export function shaftProblem(shaft: Shaft): string | null {
  if (shaft.segments.length < 1) return "a shaft needs a segment";
  if (shaft.segments.length > MAX_SEGMENTS) return `a shaft has at most ${MAX_SEGMENTS} segments`;
  for (const [i, s] of shaft.segments.entries()) {
    const problem = segmentProblem(s, i + 1);
    if (problem) return problem;
  }
  const c = shaft.centreDrill;
  if (c) {
    const size = CENTRE_DRILLS[c.size];
    if (!size) return "choose a centre drill size";
    const across = c.style === "bell" ? size.bell : size.countersink;
    const ends = [...(c.ends !== "right" ? [endRadii(shaft.segments[0]).left] : []), ...(c.ends !== "left" ? [endRadii(shaft.segments.at(-1)!).right] : [])];
    if (ends.some((r) => !(across < 2 * r * 0.8))) return `a ${round2(across)} mm centre drill is too wide for the shaft's end`;
  }
  return null;
}

/** The shaft's overall length. */
export function shaftLength(shaft: Shaft): number {
  return shaft.segments.reduce((sum, s) => sum + s.length, 0);
}

/** A threaded segment's edge above (`bottom` false) or below the axis as heights, from x0 to x1: the teeth (or crests) capped by its end chamfers, its relief cut to the root. */
function threadEdge(s: ShaftSegment, t: ThreadForm, x0: number, display: ThreadDisplay, bottom: boolean): Pt[] {
  const x1 = x0 + s.length;
  const R = t.outside / 2;
  const h = threadDepth(t);
  const root = R - h;
  const relief = 2 * t.pitch;
  const a = t.relief === "left" ? x0 + relief : x0;
  const b = t.relief === "right" ? x1 - relief : x1;
  const lead = t.starts * t.pitch;
  const offset = a + (bottom ? lead / 2 : 0);
  const flank = h * Math.tan(rad(t.angle) / 2);
  const crest = (t.flatTop * t.pitch) / 2;
  const tooth = (x: number): number => {
    if (display !== "detailed") return R;
    const u = Math.abs(((((x - offset) % t.pitch) + 1.5 * t.pitch) % t.pitch) - t.pitch / 2);
    if (u <= crest) return R;
    if (u >= crest + flank) return root;
    return R - ((u - crest) / flank) * h;
  };
  const cap = (x: number): number => {
    let y = Infinity;
    if (s.left.style === "chamfer" && t.relief !== "left") y = Math.min(y, R - s.left.chamferLength * Math.tan(rad(s.left.chamferAngle)) + (x - a) * Math.tan(rad(s.left.chamferAngle)));
    if (s.right.style === "chamfer" && t.relief !== "right") y = Math.min(y, R - s.right.chamferLength * Math.tan(rad(s.right.chamferAngle)) + (b - x) * Math.tan(rad(s.right.chamferAngle)));
    return y;
  };
  const xs = new Set<number>([a, b]);
  if (display === "detailed") {
    for (let k = Math.floor((a - offset) / t.pitch) - 1; offset + k * t.pitch < b + t.pitch; k++) {
      const c = offset + k * t.pitch;
      for (const d of [crest, crest + flank]) for (const x of [c - d, c + d]) if (x > a && x < b) xs.add(x);
    }
  }
  for (const [from, len] of [[a, s.left.style === "chamfer" ? s.left.chamferLength : 0], [b - (s.right.style === "chamfer" ? s.right.chamferLength : 0), s.right.style === "chamfer" ? s.right.chamferLength : 0]] as const) {
    for (let k = 0; k <= CAP_STEPS && len > 0; k++) xs.add(from + (len * k) / CAP_STEPS);
  }
  const pts = [...xs].sort((p, q) => p - q).map((x) => ({ x, y: Math.max(root, Math.min(tooth(x), cap(x))) }));
  if (t.relief === "left") pts.unshift({ x: x0, y: root }, { x: a, y: root });
  if (t.relief === "right") pts.push({ x: b, y: root }, { x: x1, y: root });
  return pts;
}

/** A straight or tapered segment's edge as heights from x0 to x1, a groove and (on its side) a keyway cut in. */
function plainEdge(s: ShaftSegment, x0: number, side: "top" | "bottom"): Pt[] {
  const x1 = x0 + s.length;
  const { left, right } = endRadii(s);
  const pts: Pt[] = [{ x: x0, y: left }];
  const cuts: Pt[][] = [];
  if (s.groove) {
    const g = s.groove;
    const a = featureStart(x0, x1, g.from, g.distance, g.width);
    if (g.type === "rectangular") cuts.push([{ x: a, y: left }, { x: a, y: left - g.depth }, { x: a + g.width, y: left - g.depth }, { x: a + g.width, y: left }]);
    else if (g.type === "v") cuts.push([{ x: a, y: left }, { x: a + g.width / 2, y: left - g.depth }, { x: a + g.width, y: left }]);
    else {
      // a circular arc of the groove's width as its chord and its depth as its height
      const radius = (g.width ** 2 / 4 + g.depth ** 2) / (2 * g.depth);
      const cy = left - g.depth + radius;
      const half = Math.asin(Math.min(1, g.width / 2 / radius));
      cuts.push(Array.from({ length: ARC_STEPS + 1 }, (_, k) => {
        const ang = -Math.PI / 2 - half + (2 * half * k) / ARC_STEPS;
        return { x: a + g.width / 2 + radius * Math.cos(ang), y: cy + radius * Math.sin(ang) };
      }));
    }
  }
  const k = s.keyway;
  if (k && k.position === side) {
    const len = keywayLength(k);
    const a = featureStart(x0, x1, k.from, k.distance, len);
    if (k.cutter === null) cuts.push([{ x: a, y: left }, { x: a, y: left - k.depth }, { x: a + len, y: left - k.depth }, { x: a + len, y: left }]);
    else {
      const rc = k.cutter / 2;
      const cy = left - k.depth + rc;
      const half = Math.asin(Math.min(1, len / 2 / rc));
      cuts.push(Array.from({ length: ARC_STEPS + 1 }, (_, n) => {
        const ang = -Math.PI / 2 - half + (2 * half * n) / ARC_STEPS;
        return { x: a + len / 2 + rc * Math.cos(ang), y: cy + rc * Math.sin(ang) };
      }));
    }
  }
  cuts.sort((p, q) => p[0].x - q[0].x);
  for (const cut of cuts) pts.push(...cut);
  pts.push({ x: x1, y: right });
  return pts;
}

/** `pts` with its `i`th corner bevelled: `along` back along the side toward `toward` (-1 the point before, 1 after), `across` along the other side. */
function bevelVertex(pts: Pt[], i: number, toward: -1 | 1, along: number, across: number): Pt[] {
  const v = pts[i];
  const p = pts[i + toward];
  const q = pts[i - toward];
  if (!p || !q) return pts;
  // the side toward `p` is walked to the x `along` from the corner, the other side `across`
  const dx = p.x - v.x;
  const t = Math.min(0.99, Math.abs(dx) > 1e-9 ? along / Math.abs(dx) : 0);
  const a = { x: v.x + dx * t, y: v.y + (p.y - v.y) * t };
  const lq = Math.hypot(q.x - v.x, q.y - v.y);
  const u = Math.min(0.99, lq > 1e-9 ? across / lq : 0);
  const b = { x: v.x + (q.x - v.x) * u, y: v.y + (q.y - v.y) * u };
  const replaced = toward < 0 ? [a, b] : [b, a];
  return [...pts.slice(0, i), ...replaced, ...pts.slice(i + 1)];
}

/** The shaft's edge above the axis (or, `bottom`, its heights below), from the left end's centre to the right end's, its ends' corners finished; and the x of each bevel's start. */
function shaftEdge(shaft: Shaft, bottom: boolean): { pts: Pt[]; bevels: Pt[] } {
  const pts: Pt[] = [{ x: 0, y: 0 }];
  // each straight or tapered segment's two corners: index into pts, which way its own side runs, and its end
  const corners: { i: number; toward: -1 | 1; end: SegmentEnd }[] = [];
  let x0 = 0;
  for (const s of shaft.segments) {
    const edge = s.type === "threaded" && s.thread ? threadEdge(s, s.thread, x0, shaft.threads, bottom) : plainEdge(s, x0, bottom ? "bottom" : "top");
    if (s.type !== "threaded") corners.push({ i: pts.length, toward: 1, end: s.left });
    pts.push(...edge);
    if (s.type !== "threaded") corners.push({ i: pts.length - 1, toward: -1, end: s.right });
    x0 += s.length;
  }
  pts.push({ x: x0, y: 0 });
  const bevels: Pt[] = [];
  let out = pts;
  for (const c of [...corners].reverse()) {
    const v = out[c.i];
    const q = out[c.i - c.toward];
    // a corner level with the next segment's isn't one
    if (Math.abs(q.x - v.x) > 1e-9 || Math.abs(q.y - v.y) < 1e-9) continue;
    if (c.end.style === "chamfer" || c.end.style === "flare") {
      const across = c.end.chamferLength * Math.tan(rad(c.end.chamferAngle));
      out = bevelVertex(out, c.i, c.toward, c.end.chamferLength, across);
      bevels.push(out[c.toward < 0 ? c.i : c.i + 1]);
    } else if (c.end.style === "fillet" || c.end.style === "radius") out = roundVertex(out, c.i, c.end.filletRadius);
  }
  return { pts: out, bevels };
}

/** Each line in `lines` cut into dashes is drawn by the caller; these are the shaft's hidden edges. */
function centreDrillLines(shaft: Shaft, length: number): Pt[][] {
  const c = shaft.centreDrill;
  if (!c) return [];
  const size = CENTRE_DRILLS[c.size];
  const lines: Pt[][] = [];
  const cone = (from: number, to: number, slope: number): number => (to - from) / 2 / Math.tan(rad(slope));
  for (const [x, dir] of [[0, 1], [length, -1]] as const) {
    if ((dir > 0 && c.ends === "right") || (dir < 0 && c.ends === "left")) continue;
    // from the end inward: the bell's 120° cone, the 60° countersink, the pilot, its 118° point
    const steps: { r: number; at: number }[] = [];
    let along = 0;
    if (c.style === "bell") {
      steps.push({ r: size.bell / 2, at: 0 });
      along += cone(size.countersink, size.bell, 60);
    }
    steps.push({ r: size.countersink / 2, at: along });
    along += cone(size.pilot, size.countersink, 30);
    steps.push({ r: size.pilot / 2, at: along });
    along += size.pilot;
    steps.push({ r: size.pilot / 2, at: along });
    along += cone(0, size.pilot, 59);
    steps.push({ r: 0, at: along });
    for (const sign of [1, -1]) lines.push(steps.map((p) => ({ x: x + dir * p.at, y: sign * p.r })));
    // the countersink's and pilot's ends across
    for (const p of steps.slice(1, -1)) lines.push([{ x: x + dir * p.at, y: -p.r }, { x: x + dir * p.at, y: p.r }]);
  }
  return lines;
}

/**
 * The shaft from the side, its left end on the origin and its axis along +x: its outline, the
 * lines across where segments meet and bevels start, each thread's lines, keyways facing the
 * viewer, the flat faces of wrench flats; hidden edges (centre drills, keyways facing away, ASME
 * root lines) in `hidden`; with `beyond`, the axis reaching that far past each end.
 */
export function shaftDrawing(shaft: Shaft, beyond: number | null): HoleDrawing & { hidden: Pt[][] } {
  const length = shaftLength(shaft);
  const top = shaftEdge(shaft, false);
  const below = shaftEdge(shaft, true);
  const d = { outlines: [] as Pt[][], lines: [] as Pt[][], circles: [] as HoleDrawing["circles"], arcs: [] as HoleDrawing["arcs"], hidden: [] as Pt[][] };
  d.outlines.push([...top.pts.slice(1, -1), ...below.pts.slice(1, -1).reverse().map((p) => ({ x: p.x, y: -p.y }))]);
  // a line across at a bevel's start, as tall as the shaft there
  for (const p of top.bevels) d.lines.push([{ x: p.x, y: -p.y }, { x: p.x, y: p.y }]);
  const heightAt = (pts: readonly Pt[], x: number): number => Math.max(0, ...pts.filter((p) => Math.abs(p.x - x) < 1e-9).map((p) => p.y));
  let x0 = 0;
  shaft.segments.forEach((s, i) => {
    const x1 = x0 + s.length;
    const next = shaft.segments[i + 1];
    if (next) {
      const step = endRadii(s).right !== endRadii(next).left || s.type !== next.type || s.right.style !== "plain" || next.left.style !== "plain";
      if (step) d.lines.push([{ x: x1, y: -heightAt(below.pts, x1) }, { x: x1, y: heightAt(top.pts, x1) }]);
    }
    const r = Math.min(endRadii(s).left, endRadii(s).right);
    if (s.type === "threaded" && s.thread) threadLines(d, s, s.thread, x0, shaft.threads);
    const k = s.keyway;
    if (k) {
      const len = keywayLength(k);
      const a = featureStart(x0, x1, k.from, k.distance, len);
      if (k.position === "front" || k.position === "back") {
        const face = k.cutter === null ? slotOutline({ x: a, y: 0 }, { x: a + len, y: 0 }, k.width) : [{ x: a, y: -k.width / 2 }, { x: a + len, y: -k.width / 2 }, { x: a + len, y: k.width / 2 }, { x: a, y: k.width / 2 }];
        if (face) {
          if (k.position === "front") d.outlines.push(face);
          else d.hidden.push([...face, face[0]]);
        }
      } else {
        // the keyseat's near wall meets the shaft along a line
        const sign = k.position === "top" ? 1 : -1;
        const wall = Math.sqrt(r * r - (k.width / 2) ** 2);
        if (wall > r - k.depth) {
          const across = k.cutter === null ? [a, a + len] : woodruffSpan(k, r, wall, a);
          d.lines.push([{ x: across[0], y: sign * wall }, { x: across[1], y: sign * wall }]);
        }
      }
    }
    const g = s.groove;
    if (g) {
      const a = featureStart(x0, x1, g.from, g.distance, g.width);
      for (const x of [a, a + g.width]) d.lines.push([{ x, y: -r }, { x, y: r }]);
      if (g.type === "v") d.lines.push([{ x: a + g.width / 2, y: -(r - g.depth) }, { x: a + g.width / 2, y: r - g.depth }]);
    }
    const f = s.flats;
    if (f) {
      const a = featureStart(x0, x1, f.from, f.distance, f.length);
      const h = f.type === "double" ? f.across / 2 : f.across - r;
      const c = Math.sqrt(r * r - h * h);
      d.outlines.push([{ x: a, y: -c }, { x: a + f.length, y: -c }, { x: a + f.length, y: c }, { x: a, y: c }]);
    }
    x0 = x1;
  });
  d.hidden.push(...centreDrillLines(shaft, length));
  if (beyond !== null) d.lines.push([{ x: -beyond, y: 0 }, { x: length + beyond, y: 0 }]);
  return d;
}

/** Where a Woodruff keyseat's arc stands above `wall` (its near wall's line): the x span. */
function woodruffSpan(k: ShaftKeyway, r: number, wall: number, a: number): [number, number] {
  const rc = k.cutter! / 2;
  const cy = r - k.depth + rc;
  const half = Math.sqrt(Math.max(0, rc * rc - (cy - wall) ** 2));
  const mid = a + keywayLength(k) / 2;
  return [mid - half, mid + half];
}

/** A threaded segment's lines in `display`: root lines (ASME's hidden), crest and root lines across, or crests and roots wound round the near side. */
function threadLines(d: HoleDrawing & { hidden: Pt[][] }, s: ShaftSegment, t: ThreadForm, x0: number, display: ThreadDisplay): void {
  const R = t.outside / 2;
  const root = R - threadDepth(t);
  const relief = 2 * t.pitch;
  const a = x0 + (t.relief === "left" ? relief : 0);
  const b = x0 + s.length - (t.relief === "right" ? relief : 0);
  if (t.relief === "left") d.lines.push([{ x: a, y: -R }, { x: a, y: R }]);
  if (t.relief === "right") d.lines.push([{ x: b, y: -R }, { x: b, y: R }]);
  // where a chamfered end's cone meets the crests
  const lo = a + (s.left.style === "chamfer" && t.relief !== "left" ? s.left.chamferLength : 0);
  const hi = b - (s.right.style === "chamfer" && t.relief !== "right" ? s.right.chamferLength : 0);
  if (display !== "detailed") for (const x of [lo, hi]) if (x !== a && x !== b) d.lines.push([{ x, y: -R }, { x, y: R }]);
  if (display === "asme" || display === "iso") {
    for (const sign of [1, -1]) (display === "asme" ? d.hidden : d.lines).push([{ x: a, y: sign * root }, { x: b, y: sign * root }]);
    return;
  }
  const lead = t.starts * t.pitch;
  if (display === "schematic") {
    // a crest line each pitch across the outside, a root line between across the root
    for (let x = a + t.pitch / 2, n = 0; x < b; x += t.pitch / 2, n++) {
      const h = n % 2 === 0 ? root : R;
      if (h === root || (x > lo && x < hi)) d.lines.push([{ x, y: -h }, { x, y: h }]);
    }
    return;
  }
  const slant = t.leftHand ? -lead / 2 : lead / 2;
  for (let c = a - Math.ceil(lead / t.pitch + 1) * t.pitch; c < b + lead; c += t.pitch) {
    for (const [x, h] of [[c, R], [c + t.pitch / 2, root]] as const) d.lines.push(...clipX([{ x, y: h }, { x: x + slant, y: -h }], lo, hi));
  }
}

/** A standard thread size: its name, major diameter and pitch, mm. */
export interface ThreadSize {
  readonly name: string;
  readonly diameter: number;
  readonly pitch: number;
}

const unified = (name: string, inches: number, tpi: number): ThreadSize => ({ name, diameter: inches * 25.4, pitch: 25.4 / tpi });
const NUMBERED: Record<string, number> = { "#4": 0.112, "#5": 0.125, "#6": 0.138, "#8": 0.164, "#10": 0.19, "#12": 0.216 };
const fraction = (s: string): number => {
  if (s in NUMBERED) return NUMBERED[s];
  const [whole, frac] = s.includes("-") ? s.split("-") : s.includes("/") ? ["0", s] : [s, "0/1"];
  const [n, d] = frac.split("/").map(Number);
  return Number(whole) + n / d;
};

/** Unified inch screw threads (ASME B1.1), coarse (UNC) and fine (UNF). */
export const INCH_THREADS: readonly ThreadSize[] = [
  ...(
    [
      ["#4", 40], ["#5", 40], ["#6", 32], ["#8", 32], ["#10", 24], ["#12", 24], ["1/4", 20], ["5/16", 18], ["3/8", 16], ["7/16", 14], ["1/2", 13], ["9/16", 12], ["5/8", 11], ["3/4", 10], ["7/8", 9],
      ["1", 8], ["1-1/8", 7], ["1-1/4", 7], ["1-3/8", 6], ["1-1/2", 6], ["1-3/4", 5], ["2", 4.5],
    ] as const
  ).map(([size, tpi]) => unified(`${size}-${tpi} UNC`, fraction(size), tpi)),
  ...(
    [
      ["#4", 48], ["#6", 40], ["#8", 36], ["#10", 32], ["#12", 28], ["1/4", 28], ["5/16", 24], ["3/8", 24], ["7/16", 20], ["1/2", 20], ["9/16", 18], ["5/8", 18], ["3/4", 16], ["7/8", 14],
      ["1", 12], ["1-1/8", 12], ["1-1/4", 12], ["1-3/8", 12], ["1-1/2", 12],
    ] as const
  ).map(([size, tpi]) => unified(`${size}-${tpi} UNF`, fraction(size), tpi)),
];

/** ISO metric screw threads (ISO 261), coarse and fine. */
export const METRIC_THREADS: readonly ThreadSize[] = (
  [
    [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [8, 1], [10, 1.5], [10, 1.25], [10, 1], [12, 1.75], [12, 1.5], [12, 1.25], [14, 2], [14, 1.5], [16, 2], [16, 1.5], [18, 2.5], [18, 1.5],
    [20, 2.5], [20, 1.5], [22, 2.5], [22, 1.5], [24, 3], [24, 2], [27, 3], [27, 2], [30, 3.5], [30, 2], [33, 3.5], [33, 2], [36, 4], [36, 3], [42, 4.5], [42, 3], [48, 5], [48, 3],
  ] as const
).map(([d, p]) => ({ name: `M${d} × ${p}`, diameter: d, pitch: p }));
