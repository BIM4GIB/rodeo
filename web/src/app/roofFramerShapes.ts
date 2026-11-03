// Roof Framer's sums (roofFramer.ts draws them): a roof framed from its 3D faces. Vectorworks frames
// a roof object from its own settings; a roof in Rodeo, read from a file or made by Create Roof, is
// known by its faces, so the slopes are found there: the faces looking up and sloping are grouped by
// plane, each with the plane under it that looks down (the roof's underside, when it has one).
// Rafters run down each slope, spaced along its eave; ridges, hips and valleys lie where two slopes
// meet; purlins run level across the slopes; plates lie along the eaves under the rafters. Plain
// data in and out: points in mm, heights above the roof's layer.

import type { Pt } from "../core/index.ts";
import { sweep, type Point3, type Solid } from "./solids3d.ts";

export type RoofMemberKind = "rafter" | "ridge" | "hip" | "valley" | "purlin" | "plate";
/** the roof's face a member's top meets: the top of the roof, or its underside */
export type Surface = "top" | "bottom";
export type RidgeElevation = "flushTop" | "notched" | "flushBottom" | "aff" | "hipTop";

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface RoofFramerSpec {
  readonly rafters: (Size & { readonly minSpacing: number; readonly maxSpacing: number; readonly surface: Surface; readonly match: boolean }) | null;
  readonly ridges: (Size & { readonly elevation: RidgeElevation; readonly notch: number; readonly aff: number }) | null;
  readonly hips: (Size & { readonly surface: Surface }) | null;
  readonly purlins:
    | (Size & {
        /** the lowest purlin's bottom, above the floor (or above the rafters' lower end, with fromLowerEnd) */
        readonly first: number;
        /** the highest purlin's top, down from the roof's top */
        readonly last: number;
        readonly by: "count" | "distance";
        readonly count: number;
        readonly distance: number;
        readonly position: Surface;
        readonly fromLowerEnd: boolean;
        readonly rotate: boolean;
        /** how far a level purlin is let up into the rafters */
        readonly inset: number;
      })
    | null;
  readonly plates: (Size & { readonly inset: number; readonly notched: boolean; readonly notch: number }) | null;
}

export interface RoofMember {
  readonly kind: RoofMemberKind;
  /** its top's middle line, end to end */
  readonly line: [Point3, Point3];
  /** the way its section's height points, from its bottom to its top */
  readonly up: Point3;
  readonly width: number;
  readonly height: number;
  /** what it covers in plan */
  readonly outline: Pt[];
  readonly solid: Solid;
  /** along its top */
  readonly length: number;
}

interface Plane {
  /** unit normal, looking out of the roof */
  readonly n: Point3;
  /** n · p for every point p on it */
  readonly d: number;
}

interface Edge {
  readonly a: Point3;
  readonly b: Point3;
  /** the middle of the triangle it bounds */
  readonly inside: Point3;
}

interface Face {
  readonly plane: Plane;
  readonly tris: (readonly [Point3, Point3, Point3])[];
  /** the underside under it, or null when the roof has none there */
  bottom: Plane | null;
  /** downhill in plan, unit */
  readonly down: Pt;
  /** along the eave in plan, unit: down turned a quarter clockwise */
  readonly along: Pt;
  /** its triangles' edges no other of its triangles shares */
  readonly edges: Edge[];
}

interface Line {
  readonly kind: "ridge" | "hip" | "valley";
  readonly a: Point3;
  readonly b: Point3;
  readonly faces: readonly [Face, Face];
}

const EPS = 1e-9;
/** how far a point may be off a plane or line and still be on it, mm */
const ON = 1;
/** faces less steep than this (about 3°) are flat, and steeper than about 85° are walls */
const MIN_SLOPE_NZ = 0.0872;
const MAX_SLOPE_NZ = 0.9986;
const SAME_NORMAL = 0.99995;
const Z: Point3 = [0, 0, 1];

const sub = (a: Point3, b: Point3): Point3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Point3, b: Point3): Point3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Point3, k: number): Point3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Point3, b: Point3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Point3, b: Point3): Point3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: Point3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Point3): Point3 => scale(a, 1 / (norm(a) || 1));
const plan = (p: Point3): Pt => ({ x: p[0], y: p[1] });
const dot2 = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const cross2 = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const at2 = (o: Pt, v: Pt, t: number): Pt => ({ x: o.x + v.x * t, y: o.y + v.y * t });

/** The height of `plane` over the plan point `p`. */
const zOn = (plane: Plane, p: Pt): number => (plane.d - plane.n[0] * p.x - plane.n[1] * p.y) / plane.n[2];

/** How much higher a plane's underside is measured plumb: its thickness over the cosine of its pitch. */
const plumbOf = (face: Face): number => (face.bottom ? (face.plane.d + face.bottom.d) / face.plane.n[2] : 0);

/** The height a member's reference face has over `p` on `face`. */
const zAt = (face: Face, surface: Surface, p: Pt): number => zOn(face.plane, p) - (surface === "bottom" ? plumbOf(face) : 0);

const keyOf = (p: Point3): string => `${Math.round(p[0] * 10)},${Math.round(p[1] * 10)},${Math.round(p[2] * 10)}`;

/** The roof's slopes: its triangles looking up at a slope, grouped by plane, each with its underside. */
export function roofFaces(triangles: ArrayLike<number>): Face[] {
  const tops: Face[] = [];
  const unders: { plane: Plane; centres: Pt[] }[] = [];
  for (let i = 0; i + 8 < triangles.length; i += 9) {
    const a: Point3 = [triangles[i], triangles[i + 1], triangles[i + 2]];
    const b: Point3 = [triangles[i + 3], triangles[i + 4], triangles[i + 5]];
    const c: Point3 = [triangles[i + 6], triangles[i + 7], triangles[i + 8]];
    const raw = cross(sub(b, a), sub(c, a));
    if (norm(raw) < 1e-3) continue;
    const n = unit(raw);
    const d = dot(n, a);
    if (n[2] > MIN_SLOPE_NZ && n[2] < MAX_SLOPE_NZ) {
      let face = tops.find((f) => dot(f.plane.n, n) > SAME_NORMAL && Math.abs(f.plane.d - d) < ON);
      if (!face) {
        const down = unit([n[0], n[1], 0]);
        face = { plane: { n, d }, tris: [], bottom: null, down: { x: down[0], y: down[1] }, along: { x: down[1], y: -down[0] }, edges: [] };
        tops.push(face);
      }
      face.tris.push([a, b, c]);
    } else if (n[2] < -MIN_SLOPE_NZ) {
      const centre = plan(scale(add(add(a, b), c), 1 / 3));
      const under = unders.find((u) => dot(u.plane.n, n) > SAME_NORMAL && Math.abs(u.plane.d - d) < ON);
      if (under) under.centres.push(centre);
      else unders.push({ plane: { n, d }, centres: [centre] });
    }
  }
  for (const f of tops) {
    // the nearest plane looking the other way under it, with something of it under this face
    let best: { plane: Plane; t: number } | null = null;
    for (const u of unders) {
      if (dot(u.plane.n, f.plane.n) > -SAME_NORMAL) continue;
      const t = f.plane.d + u.plane.d;
      if (t <= ON / 10 || (best && t >= best.t)) continue;
      if (u.centres.some((c) => f.tris.some((tri) => insideTriangle(c, tri)))) best = { plane: u.plane, t };
    }
    f.bottom = best?.plane ?? null;
    const count = new Map<string, number>();
    const sides: Edge[] = [];
    for (const tri of f.tris) {
      const inside = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
      for (let k = 0; k < 3; k++) {
        const e = { a: tri[k], b: tri[(k + 1) % 3], inside };
        const key = [keyOf(e.a), keyOf(e.b)].sort().join(" ");
        count.set(key, (count.get(key) ?? 0) + 1);
        sides.push(e);
      }
    }
    f.edges.push(...sides.filter((e) => count.get([keyOf(e.a), keyOf(e.b)].sort().join(" ")) === 1));
  }
  return tops;
}

function insideTriangle(p: Pt, tri: readonly [Point3, Point3, Point3]): boolean {
  const [a, b, c] = tri.map(plan);
  const s1 = cross2({ x: b.x - a.x, y: b.y - a.y }, { x: p.x - a.x, y: p.y - a.y });
  const s2 = cross2({ x: c.x - b.x, y: c.y - b.y }, { x: p.x - b.x, y: p.y - b.y });
  const s3 = cross2({ x: a.x - c.x, y: a.y - c.y }, { x: p.x - c.x, y: p.y - c.y });
  return (s1 >= -EPS && s2 >= -EPS && s3 >= -EPS) || (s1 <= EPS && s2 <= EPS && s3 <= EPS);
}

/** Where the plan line o + t·v crosses `face`, as stretches of t, joined where they touch. */
function clip(face: Face, o: Pt, v: Pt): [number, number][] {
  const spans: [number, number][] = [];
  for (const tri of face.tris) {
    const pts = tri.map(plan);
    // the triangles look up, so they wind anticlockwise in plan
    let t0 = -Infinity;
    let t1 = Infinity;
    for (let k = 0; k < 3 && t0 <= t1; k++) {
      const p = pts[k];
      const e = { x: pts[(k + 1) % 3].x - p.x, y: pts[(k + 1) % 3].y - p.y };
      const c = cross2(e, { x: o.x - p.x, y: o.y - p.y });
      const m = cross2(e, v);
      if (Math.abs(m) < EPS) {
        if (c < -EPS) t0 = Infinity;
        continue;
      }
      const t = -c / m;
      if (m > 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
    if (t1 - t0 > EPS) spans.push([t0, t1]);
  }
  spans.sort((p, q) => p[0] - q[0]);
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 0.5) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

/** The face's reach along its eave, between its two farthest points that way. */
function reach(face: Face): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const tri of face.tris) {
    for (const p of tri) {
      const s = dot2(face.along, plan(p));
      lo = Math.min(lo, s);
      hi = Math.max(hi, s);
    }
  }
  return [lo, hi];
}

/**
 * Where members `width` wide go between `lo` and `hi`: one at each end, inside it, and the fewest
 * between that are no more than `max` apart, evenly; when even spacing would bring them closer than
 * `min`, `min` apart from the first end with the last at the other end.
 */
export function rafterPlaces(lo: number, hi: number, width: number, min: number, max: number): number[] {
  const first = lo + width / 2;
  const span = hi - lo - width;
  if (span <= 0) return [(lo + hi) / 2];
  const gaps = Math.max(1, Math.ceil(span / max - 1e-9));
  const even = span / gaps;
  if (even >= min - 1e-6) return Array.from({ length: gaps + 1 }, (_, i) => first + i * even);
  const out: number[] = [];
  for (let s = first; s <= first + span - min * 0.01; s += min) out.push(s);
  out.push(first + span);
  return out;
}

/** A box member: its top's middle line from `a` to `b`, `up` from its bottom to its top. */
function member(kind: RoofMemberKind, a: Point3, b: Point3, up: Point3, size: Size): RoofMember | null {
  const length = norm(sub(b, a));
  if (length < 1) return null;
  const w = size.width / 2;
  const solid = sweep([a, b], [{ x: -w, y: 0 }, { x: w, y: 0 }, { x: w, y: size.height }, { x: -w, y: size.height }], false, up);
  const side = unit(cross(unit(sub(b, a)), up));
  const corners = [a, b].flatMap((p) => [add(p, scale(side, w)), add(p, scale(side, -w))]).flatMap((p) => [p, sub(p, scale(up, size.height))]);
  return { kind, line: [a, b], up, width: size.width, height: size.height, outline: hull(corners.map(plan)), solid, length };
}

/** The convex hull of `pts`, anticlockwise. */
function hull(pts: Pt[]): Pt[] {
  const s = [...pts].sort((p, q) => p.x - q.x || p.y - q.y);
  const turn = (o: Pt, a: Pt, b: Pt): number => cross2({ x: a.x - o.x, y: a.y - o.y }, { x: b.x - o.x, y: b.y - o.y });
  const half = (list: Pt[]): Pt[] => {
    const out: Pt[] = [];
    for (const p of list) {
      while (out.length >= 2 && turn(out[out.length - 2], out[out.length - 1], p) <= 1e-9) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(s), ...half([...s].reverse())];
}

/** Where two slopes meet: ridges (level, the slopes falling away), hips (sloping, falling away) and valleys (rising away). */
export function roofLines(faces: readonly Face[]): Line[] {
  const lines: Line[] = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      const [A, B] = [faces[i], faces[j]];
      const dir = cross(A.plane.n, B.plane.n);
      if (norm(dir) < 1e-6) continue;
      const u = unit(dir);
      const onBoth = (f: Face, other: Face): Edge[] => f.edges.filter((e) => Math.abs(dot(other.plane.n, e.a) - other.plane.d) < ON && Math.abs(dot(other.plane.n, e.b) - other.plane.d) < ON);
      const ea = onBoth(A, B);
      const eb = onBoth(B, A);
      if (!ea.length || !eb.length) continue;
      const spans = (es: Edge[]): [number, number][] => {
        const out: [number, number][] = [];
        for (const [s, t] of es.map((e): [number, number] => [dot(u, e.a), dot(u, e.b)]).map(([s, t]): [number, number] => [Math.min(s, t), Math.max(s, t)]).sort((p, q) => p[0] - q[0])) {
          const last = out[out.length - 1];
          if (last && s <= last[1] + ON) last[1] = Math.max(last[1], t);
          else out.push([s, t]);
        }
        return out;
      };
      const ref = ea[0].a;
      const s0 = dot(u, ref);
      const point = (s: number): Point3 => add(ref, scale(u, s - s0));
      for (const [a0, a1] of spans(ea)) {
        for (const [b0, b1] of spans(eb)) {
          const s = Math.max(a0, b0);
          const t = Math.min(a1, b1);
          if (t - s < ON * 10) continue;
          const a = point(s);
          const b = point(t);
          const mid = scale(add(a, b), 0.5);
          // which way each slope goes from the line: down for both is a ridge or hip, up for both a valley
          const l = { x: u[0], y: u[1] };
          const ll = Math.hypot(l.x, l.y) || 1;
          const falls = [A, B].map((f) => {
            const es = f === A ? ea : eb;
            const m = (s + t) / 2;
            const e = es.find((x) => Math.min(dot(u, x.a), dot(u, x.b)) - ON <= m && m <= Math.max(dot(u, x.a), dot(u, x.b)) + ON) ?? es[0];
            const w = { x: e.inside[0] - mid[0], y: e.inside[1] - mid[1] };
            const k = dot2(w, l) / (ll * ll);
            const into = { x: w.x - k * l.x, y: w.y - k * l.y };
            return dot2(into, f.down) > 0;
          });
          if (falls[0] !== falls[1]) continue;
          const level = Math.abs(b[2] - a[2]) < ON;
          const kind = !falls[0] ? "valley" : level ? "ridge" : "hip";
          lines.push({ kind, a: a[2] <= b[2] ? a : b, b: a[2] <= b[2] ? b : a, faces: [A, B] });
        }
      }
    }
  }
  return lines;
}

/** How far a member running along `dir` in plan stops short of a line member `width` wide meeting it at `p`. */
function shortOf(p: Pt, dir: Pt, lines: readonly Line[], widths: (l: Line) => number): number {
  let back = 0;
  for (const l of lines) {
    const a = plan(l.a);
    const b = plan(l.b);
    const ab = { x: b.x - a.x, y: b.y - a.y };
    const len = Math.hypot(ab.x, ab.y);
    if (len < EPS) continue;
    const off = Math.abs(cross2(ab, { x: p.x - a.x, y: p.y - a.y })) / len;
    const t = dot2(ab, { x: p.x - a.x, y: p.y - a.y }) / (len * len);
    if (off > ON * 2 || t < -0.01 || t > 1.01) continue;
    const sin = Math.abs(cross2(ab, dir)) / len;
    if (sin > 0.05) back = Math.max(back, widths(l) / 2 / sin);
  }
  return back;
}

/** The roof's framing members, from its triangles (9 numbers each, heights above its layer), or why there are none. */
export function frameRoof(triangles: ArrayLike<number>, spec: RoofFramerSpec): RoofMember[] | string {
  const faces = roofFaces(triangles);
  if (!faces.length) return "nothing selected has sloping faces in 3D";
  const out: RoofMember[] = [];
  const push = (m: RoofMember | null): void => {
    if (m) out.push(m);
  };
  const allLines = roofLines(faces);
  const lineWidth = (l: Line): number => (l.kind === "ridge" ? (spec.ridges?.width ?? 0) : (spec.hips?.width ?? 0));
  const framedLines = allLines.filter((l) => (l.kind === "ridge" ? !!spec.ridges : !!spec.hips));
  const roofTop = Math.max(...faces.flatMap((f) => f.tris.flatMap((t) => t.map((p) => p[2]))));

  const r = spec.rafters;
  if (r) {
    // with Match, slopes whose eaves run the same way share one set of places, so rafters meet across ridges
    const axisOf = (f: Face): string => {
      const a = f.along.x > 1e-6 || (Math.abs(f.along.x) <= 1e-6 && f.along.y > 0) ? f.along : { x: -f.along.x, y: -f.along.y };
      return `${a.x.toFixed(4)},${a.y.toFixed(4)}`;
    };
    const shared = new Map<string, number[]>();
    if (r.match) {
      const groups = new Map<string, Face[]>();
      for (const f of faces) groups.set(axisOf(f), [...(groups.get(axisOf(f)) ?? []), f]);
      for (const [key, fs] of groups) {
        const [ax, ay] = key.split(",").map(Number);
        const pts = fs.flatMap((f) => f.tris.flatMap((t) => t.map((p) => p[0] * ax + p[1] * ay)));
        shared.set(key, rafterPlaces(Math.min(...pts), Math.max(...pts), r.width, r.minSpacing, r.maxSpacing));
      }
    }
    for (const f of faces) {
      const [lo, hi] = reach(f);
      const key = axisOf(f);
      const flip = f.along.x > 1e-6 || (Math.abs(f.along.x) <= 1e-6 && f.along.y > 0) ? 1 : -1;
      const places = r.match ? (shared.get(key) ?? []).map((s) => s * flip).filter((s) => s >= lo - EPS && s <= hi + EPS) : rafterPlaces(lo, hi, r.width, r.minSpacing, r.maxSpacing);
      for (const s of places) {
        const o = { x: f.along.x * s, y: f.along.y * s };
        for (const [t0, t1] of clip(f, o, f.down)) {
          // stop short of the ridges, hips and valleys framed where the rafter meets one
          const p0 = at2(o, f.down, t0 + shortOf(at2(o, f.down, t0), f.down, framedLines, lineWidth));
          const p1 = at2(o, f.down, t1 - shortOf(at2(o, f.down, t1), f.down, framedLines, lineWidth));
          push(member("rafter", [p0.x, p0.y, zAt(f, r.surface, p0)], [p1.x, p1.y, zAt(f, r.surface, p1)], f.plane.n, r));
        }
      }
    }
  }

  // the top of a rafter and the plumb depth of its cut, where it meets a line
  const rafterTop = (l: Line, p: Point3): number => p[2] - (r?.surface === "bottom" ? (plumbOf(l.faces[0]) + plumbOf(l.faces[1])) / 2 : 0);
  const rafterPlumb = (l: Line): number => (r ? (r.height / l.faces[0].plane.n[2] + r.height / l.faces[1].plane.n[2]) / 2 : 0);
  const hipDrop = (l: Line): number => (spec.hips?.surface === "bottom" ? (plumbOf(l.faces[0]) + plumbOf(l.faces[1])) / 2 : 0);

  const g = spec.ridges;
  if (g) {
    for (const l of allLines.filter((x) => x.kind === "ridge")) {
      let top: number;
      if (g.elevation === "aff") top = g.aff + g.height;
      else if (g.elevation === "flushBottom") top = rafterTop(l, l.a) - rafterPlumb(l) + g.height;
      else if (g.elevation === "notched") top = rafterTop(l, l.a) - rafterPlumb(l) + g.notch;
      else if (g.elevation === "hipTop") {
        const hips = allLines.filter((x) => x.kind === "hip" && [l.a, l.b].some((p) => norm(sub(x.b, p)) < ON * 10));
        top = hips.length ? Math.max(...hips.map((x) => x.b[2] - hipDrop(x))) : l.a[2];
      } else top = rafterTop(l, l.a);
      push(member("ridge", [l.a[0], l.a[1], top], [l.b[0], l.b[1], top], Z, g));
    }
  }

  const hv = spec.hips;
  if (hv) {
    for (const l of allLines.filter((x) => x.kind !== "ridge")) {
      const drop = hipDrop(l);
      const dir = unit(sub(l.b, l.a));
      const up = unit(sub(Z, scale(dir, dir[2])));
      push(member(l.kind, [l.a[0], l.a[1], l.a[2] - drop], [l.b[0], l.b[1], l.b[2] - drop], up, hv));
    }
  }

  const pu = spec.purlins;
  if (pu) {
    for (const f of faces) {
      const zs = f.tris.flatMap((t) => t.map((p) => p[2]));
      const base = pu.fromLowerEnd ? Math.min(...zs) : 0;
      const lowest = base + pu.first;
      const highest = roofTop - pu.last - pu.height;
      if (highest < lowest - EPS) continue;
      const levels =
        pu.by === "count"
          ? Array.from({ length: Math.max(1, pu.count) }, (_, i) => (pu.count > 1 ? lowest + (i * (highest - lowest)) / (pu.count - 1) : lowest))
          : Array.from({ length: Math.floor((highest - lowest) / pu.distance + 1e-9) + 1 }, (_, i) => lowest + i * pu.distance);
      const slope = Math.hypot(f.plane.n[0], f.plane.n[1]) / f.plane.n[2];
      const origin = plan(f.tris[0][0]);
      for (const bottom of levels) {
        // where the reference face is as high as the purlin's top, a level line across the slope
        const top = bottom + pu.height;
        const o = at2(origin, f.down, (zAt(f, pu.position, origin) - top) / slope);
        const lift = pu.position === "bottom" && !pu.rotate ? pu.inset : 0;
        for (const [t0, t1] of clip(f, o, f.along)) {
          const a = at2(o, f.along, t0);
          const b = at2(o, f.along, t1);
          push(member("purlin", [a.x, a.y, top + lift], [b.x, b.y, top + lift], pu.rotate ? f.plane.n : Z, pu));
        }
      }
    }
  }

  const pl = spec.plates;
  if (pl) {
    if (pl.notched && r && pl.notch > r.height / 3 + EPS) return "the plates' notch can't be more than a third of the rafters' height";
    for (const f of faces) {
      // the eave: the face's lowest level edges, running along it
      const low = Math.min(...f.edges.flatMap((e) => [e.a[2], e.b[2]]));
      const eave = f.edges.filter((e) => Math.abs(e.a[2] - low) < ON && Math.abs(e.b[2] - low) < ON && Math.abs(dot2(f.along, plan(unit(sub(e.b, e.a))))) > 0.99);
      if (!eave.length) continue;
      const u = Math.max(...eave.flatMap((e) => [dot2(f.down, plan(e.a)), dot2(f.down, plan(e.b))]));
      const outer = u - pl.inset;
      const o = { x: f.down.x * (outer - pl.width / 2), y: f.down.y * (outer - pl.width / 2) };
      const face = { x: f.down.x * outer, y: f.down.y * outer };
      const under = r ? zAt(f, r.surface, face) - r.height / f.plane.n[2] : zAt(f, "bottom", face);
      const top = under + (pl.notched ? pl.notch : 0);
      const [lo, hi] = reach(f);
      for (const [t0, t1] of clip(f, o, f.along)) {
        // run on to the corner where the plate ends at a hip rather than at the face's end
        const s0 = t0 - (t0 > lo + ON ? pl.width / 2 : 0);
        const s1 = t1 + (t1 < hi - ON ? pl.width / 2 : 0);
        const a = at2(o, f.along, s0);
        const b = at2(o, f.along, s1);
        push(member("plate", [a.x, a.y, top], [b.x, b.y, top], Z, pl));
      }
    }
  }
  return out.length ? out : "the settings frame nothing here";
}

/** Members counted by kind, section and length (to the mm). */
export function roofTakeOff(members: readonly RoofMember[]): { kind: RoofMemberKind; width: number; height: number; length: number; count: number }[] {
  const rows = new Map<string, { kind: RoofMemberKind; width: number; height: number; length: number; count: number }>();
  for (const m of members) {
    const length = Math.round(m.length);
    const key = `${m.kind} ${m.width} ${m.height} ${length}`;
    const row = rows.get(key);
    if (row) row.count++;
    else rows.set(key, { kind: m.kind, width: m.width, height: m.height, length, count: 1 });
  }
  const order: RoofMemberKind[] = ["rafter", "ridge", "hip", "valley", "purlin", "plate"];
  return [...rows.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || b.length - a.length);
}
