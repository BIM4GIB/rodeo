// Helical springs seen from the side, their axis running right from the origin: compression
// springs of round wire with any of four kinds of end, conical ones, and die springs of rectangular
// wire. Each half coil is drawn as a straight band of the wire from the top of the coil to its
// bottom (in front) or back (behind), as 2D drafting draws springs. The display shows the front
// coils, the rear coils or both (the front over the rear), solid; a section (the wire cut on the
// axis's plane, and the coils behind); or the spring simplified as ISO 2162-1 draws it, a zigzag
// along the wire's axis. Coils hidden behind others are cut away where they're hidden, not just
// covered. Extension springs the same, close wound with a loop or hook at each end, and seen down
// their axis; Belleville springs, stacked in a section through their axis or seen down it. Pure
// geometry in mm.

import type { Pt } from "../core/index.ts";

export type SpringEnds = "plain" | "plainground" | "squared" | "squaredground";
export type SpringDisplay = "front" | "rear" | "both" | "section" | "simple";

/** most coils a spring may have */
export const MAX_COILS = 400;
/** points round each rounded end of a round wire's band */
const CAP_STEPS = 8;

/** The wire: round, `width` across; or rectangular, `width` along the axis and `height` across it. */
export type Wire = { readonly kind: "round"; readonly width: number } | { readonly kind: "rect"; readonly width: number; readonly height: number };

export interface Coils {
  readonly wire: Wire;
  /** total coils, and the wire centre's distance along the axis by coils from the first end (piecewise straight between these points) */
  readonly total: number;
  readonly along: readonly { readonly u: number; readonly s: number }[];
  /** the coils' mean radius at the first end and the last */
  readonly r0: number;
  readonly r1: number;
  /** the working length, and whether the ends are ground flat at 0 and at it */
  readonly length: number;
  readonly ground: boolean;
  readonly leftHand: boolean;
  /** coils left out between these (in coils), the wire's centre drawn along the top and bottom across the gap */
  readonly gap?: { readonly from: number; readonly to: number };
}

/** What a spring draws: plain lines, bands filled in the paper's colour (in order, later over earlier), and wire cuts filled in the pen's. */
export interface SpringDrawing {
  readonly lines: Pt[][];
  readonly solid: Pt[][];
  readonly cuts: Pt[][];
}

/** Total and active coils, and the solid height, of a round-wire compression spring with `ends`, from its active coils. */
export function compressionCoils(ends: SpringEnds, active: number, wire: number): { total: number; solid: number } {
  const total = ends === "plain" ? active : ends === "plainground" ? active + 1 : active + 2;
  const ground = ends === "plainground" || ends === "squaredground";
  return { total, solid: wire * (ground ? total : total + 1) };
}

/** A round-wire compression spring's active coils from its solid height. */
export function activeFromSolid(ends: SpringEnds, solid: number, wire: number): number {
  const ground = ends === "plainground" || ends === "squaredground";
  const total = ground ? solid / wire : solid / wire - 1;
  return ends === "plain" ? total : ends === "plainground" ? total - 1 : total - 2;
}

/**
 * Where the wire's centre runs along the axis, coil by coil, for `active` coils of `ends` in
 * `length`, the wire `along` wide in that direction: closed end coils touch, active ones share
 * what's left. Null when the coils would touch or overlap.
 */
export function coilPath(ends: SpringEnds, active: number, along: number, length: number): { total: number; along: { u: number; s: number }[]; ground: boolean } | null {
  const w = along;
  const ground = ends === "plainground" || ends === "squaredground";
  if (ends === "plain") {
    const p = (length - w) / active;
    return p > w ? { total: active, along: [{ u: 0, s: w / 2 }, { u: active, s: length - w / 2 }], ground } : null;
  }
  if (ends === "plainground") {
    const total = active + 1;
    const p = length / total;
    return p > w ? { total, along: [{ u: 0, s: 0 }, { u: total, s: length }], ground } : null;
  }
  const total = active + 2;
  const start = ends === "squared" ? w / 2 : 0;
  const p = (length - 2 * start - 2 * w) / active;
  if (!(p > w)) return null;
  return {
    total,
    along: [
      { u: 0, s: start },
      { u: 1, s: start + w },
      { u: total - 1, s: length - start - w },
      { u: total, s: length - start },
    ],
    ground,
  };
}

/** The wire centre's distance along the axis at `u` coils. */
export function axial(c: Coils, u: number): number {
  const a = c.along;
  for (let i = 1; i < a.length; i++) {
    if (u <= a[i].u || i === a.length - 1) {
      const t = (u - a[i - 1].u) / (a[i].u - a[i - 1].u);
      return a[i - 1].s + t * (a[i].s - a[i - 1].s);
    }
  }
  return a[0].s;
}

/** The wire centre at `u` coils, the coil's top at whole coils, its bottom halfway; and the radius it's at. */
function node(c: Coils, u: number): { p: Pt; r: number } {
  const r = c.r0 + ((c.r1 - c.r0) * u) / c.total;
  return { p: { x: axial(c, u), y: r * Math.cos(2 * Math.PI * u) }, r };
}

/** A round wire's band from `a` to `b`, `half` wide each side, its ends rounded. */
function capsule(a: Pt, b: Pt, half: number): Pt[] {
  const t = Math.atan2(b.y - a.y, b.x - a.x);
  const pts: Pt[] = [];
  for (let i = 0; i <= CAP_STEPS; i++) {
    const g = t - Math.PI / 2 + (Math.PI * i) / CAP_STEPS;
    pts.push({ x: b.x + half * Math.cos(g), y: b.y + half * Math.sin(g) });
  }
  for (let i = 0; i <= CAP_STEPS; i++) {
    const g = t + Math.PI / 2 + (Math.PI * i) / CAP_STEPS;
    pts.push({ x: a.x + half * Math.cos(g), y: a.y + half * Math.sin(g) });
  }
  return pts;
}

/** A rectangular wire's band from `a` to `b`: its axial width either side, its height outward from each end's side of the axis. */
function strip(a: Pt, b: Pt, w: number, h: number): Pt[] {
  const out = (p: Pt): number => (p.y >= 0 ? h / 2 : -h / 2);
  return [
    { x: a.x - w / 2, y: a.y + out(a) },
    { x: a.x + w / 2, y: a.y + out(a) },
    { x: b.x + w / 2, y: b.y + out(b) },
    { x: b.x - w / 2, y: b.y + out(b) },
  ];
}

/** `pts` (convex) cut to `lo` ≤ x ≤ `hi`. */
function clipX(pts: readonly Pt[], lo: number, hi: number): Pt[] {
  const cut = (poly: readonly Pt[], keep: (p: Pt) => boolean, at: number): Pt[] => {
    const out: Pt[] = [];
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length];
      if (keep(p)) out.push(p);
      if (keep(p) !== keep(q)) {
        const t = (at - p.x) / (q.x - p.x);
        out.push({ x: at, y: p.y + t * (q.y - p.y) });
      }
    });
    return out;
  };
  return cut(cut(pts, (p) => p.x >= lo, lo), (p) => p.x <= hi, hi);
}

/** Whether `p` is inside convex `poly` by more than `margin` (so an outline on its edge isn't hidden by it). */
function insideConvex(p: Pt, poly: readonly Pt[], margin: number): boolean {
  let area = 0;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  });
  const sign = Math.sign(area);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-12) continue;
    if ((sign * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))) / len <= margin) return false;
  }
  return true;
}

/** The parts of `poly`'s outline outside every (convex) one of `hiders`, as open lines, found `step` at a time. */
function visibleOutline(poly: readonly Pt[], hiders: readonly (readonly Pt[])[], step: number): Pt[][] {
  const runs: Pt[][] = [];
  let run: Pt[] | null = null;
  const pieces: [Pt, Pt][] = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = 0; k < n; k++) {
      const at = (t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      pieces.push([at(k / n), at((k + 1) / n)]);
    }
  });
  for (const [a, b] of pieces) {
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (hiders.some((h) => insideConvex(mid, h, step / 2))) {
      run = null;
      continue;
    }
    if (!run) {
      run = [a];
      runs.push(run);
    }
    run.push(b);
  }
  // a run that reaches round to where the outline started joins the first
  if (runs.length > 1) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    const end = last[last.length - 1];
    if (Math.hypot(end.x - first[0].x, end.y - first[0].y) < 1e-9) {
      runs.pop();
      runs[0] = [...last, ...first.slice(1)];
    }
  }
  return runs;
}

/**
 * A spring from the side in `display`, its axis drawn reaching `beyond` past its ends. Coils
 * behind others or behind the wire's cuts are drawn as the parts of their outlines that show.
 */
export function springDrawing(c: Coils, display: SpringDisplay, beyond: number | null): SpringDrawing {
  const d: SpringDrawing = { lines: [], solid: [], cuts: [] };
  const flip = (p: Pt): Pt => (c.leftHand ? { x: p.x, y: -p.y } : p);
  const halves = Math.floor(c.total * 2 + 1e-9);
  const us = Array.from({ length: halves + 1 }, (_, k) => k / 2);
  if (c.total - us[us.length - 1] > 1e-6) us.push(c.total);
  const nodes = us.map((u) => node(c, u));
  const gap = c.gap;
  /** whether the half coil ending at node `i` is left out */
  const skipped = (i: number): boolean => gap !== undefined && us[i - 1] >= gap.from - 1e-9 && us[i] <= gap.to + 1e-9;
  const band = (a: Pt, b: Pt): Pt[] => {
    const shape = c.wire.kind === "round" ? capsule(a, b, c.wire.width / 2) : strip(a, b, c.wire.width, c.wire.height);
    return (c.ground ? clipX(shape, 0, c.length) : shape).map(flip);
  };
  if (display === "simple") {
    let run: Pt[] = [flip(nodes[0].p)];
    for (let i = 1; i < nodes.length; i++) {
      if (skipped(i)) {
        if (run.length > 1) d.lines.push(run);
        run = [flip(nodes[i].p)];
      } else run.push(flip(nodes[i].p));
    }
    if (run.length > 1) d.lines.push(run);
  } else {
    const front: Pt[][] = [];
    const rear: Pt[][] = [];
    for (let i = 1; i < nodes.length; i++) {
      if (skipped(i)) continue;
      // the half coil from a top to a bottom passes in front, from a bottom to a top behind
      const inFront = Math.floor(us[i - 1] * 2 + 1e-9) % 2 === 0;
      (inFront ? front : rear).push(band(nodes[i - 1].p, nodes[i].p));
    }
    const step = c.wire.width / 12;
    if (display === "front") d.solid.push(...front);
    else if (display === "rear") d.solid.push(...rear);
    else if (display === "both") {
      d.solid.push(...front);
      for (const r of rear) d.lines.push(...visibleOutline(r, front, step));
    } else {
      // the wire cut where it crosses the axis's plane: at each coil's top and bottom
      for (let k = 0; k <= halves; k++) {
        if (gap && us[k] > gap.from + 1e-9 && us[k] < gap.to - 1e-9) continue;
        const { x, y } = nodes[k].p;
        const cut =
          c.wire.kind === "round"
            ? Array.from({ length: 4 * CAP_STEPS }, (_, i) => ({ x: x + (c.wire.width / 2) * Math.cos((Math.PI * i) / (2 * CAP_STEPS)), y: y + (c.wire.width / 2) * Math.sin((Math.PI * i) / (2 * CAP_STEPS)) }))
            : [
                { x: x - c.wire.width / 2, y: y - c.wire.height / 2 },
                { x: x + c.wire.width / 2, y: y - c.wire.height / 2 },
                { x: x + c.wire.width / 2, y: y + c.wire.height / 2 },
                { x: x - c.wire.width / 2, y: y + c.wire.height / 2 },
              ];
        const kept = c.ground ? clipX(cut, 0, c.length) : cut;
        if (kept.length >= 3) d.cuts.push(kept.map(flip));
      }
      for (const r of rear) d.lines.push(...visibleOutline(r, d.cuts, step));
    }
  }
  if (gap) {
    const a = node(c, gap.from);
    const b = node(c, gap.to);
    for (const sign of [1, -1]) d.lines.push([flip({ x: a.p.x, y: sign * a.r }), flip({ x: b.p.x, y: sign * b.r })]);
  }
  if (beyond !== null) d.lines.push([{ x: -beyond, y: 0 }, { x: c.length + beyond, y: 0 }]);
  return d;
}

/** Why coils can't be drawn, or null when they can: the wire must fit inside the coils' radius, and there must be some coils but not too many. */
export function coilsProblem(c: { wire: Wire; r0: number; r1: number; total: number }): string | null {
  const across = c.wire.kind === "round" ? c.wire.width : c.wire.height;
  if (!(Math.min(c.r0, c.r1) > across / 2)) return "the wire is too thick for the spring's diameter";
  if (!(c.total > 0 && c.total <= MAX_COILS)) return `a spring has more than no coils and at most ${MAX_COILS}`;
  return null;
}

/** points round an extension spring's loop, and along each arc of its end view */
const LOOP_STEPS = 48;

export type HookStyle = "loop" | "hook";
/** how an extension spring's loops are seen: face on, in the drawing's plane, or edgewise */
export type HookView = "facing" | "edgewise";

export interface ExtensionSpring {
  readonly outside: number;
  readonly wire: number;
  /** lengths over the hooks, unloaded and in use */
  readonly free: number;
  readonly length: number;
  /** from the coils' end to the loop's outside */
  readonly hook: number;
  readonly style: HookStyle;
  readonly view: HookView;
  readonly allCoils: boolean;
  readonly leftHand: boolean;
}

/** An extension spring's coils: close wound at its free length between its hooks. */
export function extensionCoils(e: ExtensionSpring): number {
  return (e.free - 2 * e.hook) / e.wire - 1;
}

/** Why `e` can't be drawn, or null when it can. */
export function extensionProblem(e: ExtensionSpring): string | null {
  if (!(e.outside > 2 * e.wire)) return "the wire is too thick for the spring's diameter";
  if (!(e.hook > 2 * e.wire)) return "the hook length must be more than twice the wire's diameter";
  const coils = extensionCoils(e);
  if (!(coils >= 1)) return "the free length leaves no room for coils between the hooks";
  if (coils > MAX_COILS) return `a spring has at most ${MAX_COILS} coils`;
  if (!(e.length >= e.free - 1e-9)) return "an extension spring's working length can't be shorter than its free length";
  return null;
}

/** A ring of wire round `centre` at radius `r`, `wire` thick (only its centre line when 0), open across `gap` (radians) when a hook. */
function ring(centre: Pt, r: number, wire: number, gap: readonly [number, number] | null): Pt[][] {
  const arc = (radius: number, from: number, to: number): Pt[] =>
    Array.from({ length: LOOP_STEPS + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / LOOP_STEPS;
      return { x: centre.x + radius * Math.cos(t), y: centre.y + radius * Math.sin(t) };
    });
  const outer = r + wire / 2;
  const inner = r - wire / 2;
  if (wire === 0) return [gap ? arc(r, gap[1], gap[0] + 2 * Math.PI) : arc(r, 0, 2 * Math.PI)];
  if (!gap) return [arc(outer, 0, 2 * Math.PI), arc(inner, 0, 2 * Math.PI)];
  const [a, b] = gap;
  const o = arc(outer, b, a + 2 * Math.PI);
  const i = arc(inner, b, a + 2 * Math.PI);
  // the wire's cut ends across the opening
  return [o, i, [o[0], i[0]], [o[o.length - 1], i[i.length - 1]]];
}

/**
 * An extension spring from the side, its axis running right from the outside of one hook to the
 * outside of the other: its coils (all, or three at each end with lines along the coils' top and
 * bottom across the gap) and at each end a loop the hook length across, touching the last coil,
 * seen face on (a ring, or a hook open on its outer side) or edgewise (a straight piece of wire).
 * Simplified, a loop is its wire's centre line.
 */
export function extensionFront(e: ExtensionSpring, display: SpringDisplay, beyond: number | null): SpringDrawing {
  const coils = extensionCoils(e);
  const s0 = e.hook + e.wire / 2;
  const s1 = e.length - e.hook - e.wire / 2;
  const r = (e.outside - e.wire) / 2;
  const c: Coils = {
    wire: { kind: "round", width: e.wire },
    total: coils,
    along: [
      { u: 0, s: s0 },
      { u: coils, s: s1 },
    ],
    r0: r,
    r1: r,
    length: e.length,
    ground: false,
    leftHand: e.leftHand,
    gap: !e.allCoils && coils > 8 ? { from: 3, to: Math.floor(coils) - 3 } : undefined,
  };
  const d = springDrawing(c, display, beyond);
  const simple = display === "simple";
  // the loop's wire centre: its radius, and how far its centre is from the spring's end
  const loop = (e.hook - e.wire) / 2;
  const from = e.hook / 2;
  for (const side of [-1, 1]) {
    const centre = { x: side < 0 ? from : e.length - from, y: 0 };
    if (e.view === "edgewise") {
      const a = { x: centre.x - loop, y: 0 };
      const b = { x: centre.x + loop, y: 0 };
      if (simple) d.lines.push([a, b]);
      else d.solid.push(capsule(a, b, e.wire / 2));
      continue;
    }
    // a hook opens on its outer side, above the axis
    const gap: [number, number] | null = e.style === "hook" ? (side > 0 ? [Math.PI / 12, (5 * Math.PI) / 12] : [(7 * Math.PI) / 12, (11 * Math.PI) / 12]) : null;
    d.lines.push(...ring(centre, loop, simple ? 0 : e.wire, gap));
  }
  return d;
}

/**
 * An extension spring seen down its axis: the coils' ring, the near loop across it edgewise (the
 * ring hidden behind it), and the far loop, at right angles if asked, seen through the bore.
 */
export function extensionEnd(outside: number, wire: number, rightAngles: boolean, beyond: number | null): SpringDrawing {
  const d: SpringDrawing = { lines: [], solid: [], cuts: [] };
  const ro = outside / 2;
  const ri = ro - wire;
  const w = wire / 2;
  const arc = (r: number, from: number, to: number): Pt[] =>
    Array.from({ length: LOOP_STEPS + 1 }, (_, i) => {
      const t = from + ((to - from) * i) / LOOP_STEPS;
      return { x: r * Math.cos(t), y: r * Math.sin(t) };
    });
  for (const r of [ro, ri]) {
    const skip = Math.asin(Math.min(1, w / r));
    d.lines.push(arc(r, -Math.PI / 2 + skip, Math.PI / 2 - skip), arc(r, Math.PI / 2 + skip, (3 * Math.PI) / 2 - skip));
  }
  d.solid.push([
    { x: -w, y: -ro },
    { x: w, y: -ro },
    { x: w, y: ro },
    { x: -w, y: ro },
  ]);
  if (rightAngles) {
    const reach = Math.sqrt(ri * ri - w * w);
    for (const side of [-1, 1]) for (const y of [-w, w]) d.lines.push([{ x: side * w, y }, { x: side * reach, y }]);
  }
  if (beyond !== null) d.lines.push([{ x: -ro - beyond, y: 0 }, { x: ro + beyond, y: 0 }], [{ x: 0, y: -ro - beyond }, { x: 0, y: ro + beyond }]);
  return d;
}

export type BellevilleStack = "nested" | "alternate";

export interface Belleville {
  readonly inside: number;
  readonly outside: number;
  readonly thickness: number;
  /** the cone's rise, its free height less its thickness */
  readonly rise: number;
  readonly count: number;
  readonly stack: BellevilleStack;
  readonly down: number;
  readonly up: number;
  readonly firstUp: boolean;
}

export const MAX_DISCS = 100;

/** Why `b` can't be drawn, or null when it can. */
export function bellevilleProblem(b: Belleville): string | null {
  if (!(b.outside > b.inside)) return "the outside diameter must be more than the inside one";
  if (!(b.thickness < (b.outside - b.inside) / 2)) return "the spring is thicker than its ring is wide";
  if (!(b.rise > 0)) return "the height must be more than the thickness";
  if (!(Number.isInteger(b.count) && b.count >= 1 && b.count <= MAX_DISCS)) return `a stack has 1 to ${MAX_DISCS} springs`;
  if (b.stack === "alternate" && !(Number.isInteger(b.down) && Number.isInteger(b.up) && b.down >= 1 && b.up >= 1)) return "alternate groups have at least one spring each way";
  return null;
}

/** Each disc's start along the axis and whether it faces up (its inside edge to the right), in order. */
export function bellevilleDiscs(b: Belleville): { x: number; up: boolean }[] {
  const out: { x: number; up: boolean }[] = [];
  const free = b.rise + b.thickness;
  let up = b.firstUp;
  let start = 0;
  let inGroup = 0;
  for (let i = 0; i < b.count; i++) {
    const size = b.stack === "nested" ? b.count : up ? b.up : b.down;
    if (inGroup === size) {
      // the next group faces the other way, touching this one's last disc edge to edge
      start += free + (inGroup - 1) * b.thickness;
      up = !up;
      inGroup = 0;
    }
    out.push({ x: start + inGroup * b.thickness, up });
    inGroup++;
  }
  return out;
}

/** A stack of Belleville springs cut through its axis, which runs right from the first's outer face: each disc's section above and below the axis. */
export function bellevilleSide(b: Belleville, beyond: number | null): SpringDrawing {
  const d: SpringDrawing = { lines: [], solid: [], cuts: [] };
  const ri = b.inside / 2;
  const ro = b.outside / 2;
  const t = b.thickness;
  const discs = bellevilleDiscs(b);
  for (const { x, up } of discs) {
    const outer = up ? x : x + b.rise;
    const inner = up ? x + b.rise : x;
    for (const sign of [1, -1]) {
      d.solid.push([
        { x: outer, y: sign * ro },
        { x: outer + t, y: sign * ro },
        { x: inner + t, y: sign * ri },
        { x: inner, y: sign * ri },
      ]);
    }
  }
  if (beyond !== null) {
    const end = discs[discs.length - 1].x + b.rise + t;
    d.lines.push([{ x: -beyond, y: 0 }, { x: end + beyond, y: 0 }]);
  }
  return d;
}

/** A Belleville spring seen down its axis: its outside and inside circles, with centre lines. */
export function bellevilleFront(b: Belleville, beyond: number | null): SpringDrawing {
  const d: SpringDrawing = { lines: [], solid: [], cuts: [] };
  const circle = (r: number): Pt[] => Array.from({ length: LOOP_STEPS * 2 + 1 }, (_, i) => ({ x: r * Math.cos((Math.PI * i) / LOOP_STEPS), y: r * Math.sin((Math.PI * i) / LOOP_STEPS) }));
  d.lines.push(circle(b.outside / 2), circle(b.inside / 2));
  if (beyond !== null) {
    const reach = b.outside / 2 + beyond;
    d.lines.push([{ x: -reach, y: 0 }, { x: reach, y: 0 }], [{ x: 0, y: -reach }, { x: 0, y: reach }]);
  }
  return d;
}
