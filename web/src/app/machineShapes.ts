// What the Detailing tool set's machine components draw (tools/machine.ts), as plain geometry: a
// drilled hole (through or blind with its drill point, plain, counterbored or countersunk) and a
// tapped hole, each seen from the top or cut through its axis from the side; a slot; a pattern of
// holes in rows and columns or round a bolt circle; an external screw thread from the side; and a
// shaft or bore cut across with its keyway. Threads are drawn as ISO 6410 shows them: a tapped
// hole from the top as the tap drill's circle and three quarters of the thread's, open at the upper
// right; cut through, the thread's lines beside the tap drill's to the thread's depth, closed across
// there; a screw from the side as its outline with the thread's root lines, closed across at the
// thread's end. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { dist } from "./geom.ts";

/** A hole's or slot's lines, circles and arcs (angles in degrees, anticlockwise from +x). */
export interface HoleDrawing {
  /** closed outlines */
  readonly outlines: Pt[][];
  /** open lines */
  readonly lines: Pt[][];
  readonly circles: { readonly center: Pt; readonly radius: number }[];
  readonly arcs: { readonly center: Pt; readonly radius: number; readonly start: number; readonly sweep: number }[];
}

/** How a hole is seen: from the top, down its axis, or cut through its axis from the side. */
export type HoleView = "top" | "side";
/** How a drilled hole's mouth is cut. */
export type HoleStyle = "plain" | "counterbored" | "countersunk";

/** A drilled hole's sizes, mm. */
export interface DrilledHole {
  readonly diameter: number;
  readonly depth: number;
  /** blind holes end in a drill point; through holes run out of the far face */
  readonly blind: boolean;
  /** the drill point's included angle, degrees */
  readonly pointAngle: number;
  readonly style: HoleStyle;
  /** the counterbore's or countersink's diameter */
  readonly mouthDiameter: number;
  readonly counterboreDepth: number;
  /** the countersink's included angle, degrees */
  readonly countersinkAngle: number;
}

/** A tapped hole's sizes, mm: the thread's (major) diameter, its tap drill's, and how deep each runs. */
export interface TappedHole {
  readonly diameter: number;
  readonly tapDrill: number;
  readonly threadDepth: number;
  readonly drillDepth: number;
  readonly blind: boolean;
  readonly pointAngle: number;
}

const empty = (): { outlines: Pt[][]; lines: Pt[][]; circles: HoleDrawing["circles"]; arcs: HoleDrawing["arcs"] } => ({ outlines: [], lines: [], circles: [], arcs: [] });

/** How far a drill point of `angle` degrees runs past its hole's depth. */
const pointRun = (radius: number, angle: number): number => radius / Math.tan(((angle / 2) * Math.PI) / 180);

/**
 * A hole's walls cut through its axis, the axis down -y from its mouth at the origin: `left` the
 * left wall from the mouth down (x ≤ 0), mirrored for the right. A blind hole's walls meet in its
 * drill point as one line; a through hole's are two.
 */
function walls(left: Pt[], blind: boolean, radius: number, depth: number, pointAngle: number): Pt[][] {
  const right = left.map((p) => ({ x: -p.x, y: p.y }));
  if (!blind) return [left, right];
  return [[...left, { x: 0, y: -depth - pointRun(radius, pointAngle) }, ...right.reverse()]];
}

/** A drilled hole centred at the origin (from the top) or its mouth there, its axis down -y (cut). Null when its sizes don't make one. */
export function drilledHole(h: DrilledHole, view: HoleView): HoleDrawing | null {
  const r = h.diameter / 2;
  const R = h.mouthDiameter / 2;
  const mouth = h.style !== "plain";
  if (!(r > 0 && h.depth > 0 && h.pointAngle > 0 && h.pointAngle < 180)) return null;
  if (mouth && !(R > r)) return null;
  const sink = h.style === "countersunk" ? pointRun(R - r, h.countersinkAngle) : h.style === "counterbored" ? h.counterboreDepth : 0;
  if (h.style === "countersunk" && !(h.countersinkAngle > 0 && h.countersinkAngle < 180)) return null;
  if (mouth && !(sink > 0 && sink < h.depth)) return null;
  const d = empty();
  if (view === "top") {
    d.circles.push({ center: { x: 0, y: 0 }, radius: r });
    if (mouth) d.circles.push({ center: { x: 0, y: 0 }, radius: R });
    return d;
  }
  const left =
    h.style === "counterbored"
      ? [{ x: -R, y: 0 }, { x: -R, y: -sink }, { x: -r, y: -sink }, { x: -r, y: -h.depth }]
      : h.style === "countersunk"
        ? [{ x: -R, y: 0 }, { x: -r, y: -sink }, { x: -r, y: -h.depth }]
        : [{ x: -r, y: 0 }, { x: -r, y: -h.depth }];
  d.lines.push(...walls(left, h.blind, r, h.depth, h.pointAngle));
  return d;
}

/** A tapped hole as `drilledHole` places one. Null when its sizes don't make one (the thread deeper than the tap drill, say). */
export function tappedHole(h: TappedHole, view: HoleView): HoleDrawing | null {
  const r = h.tapDrill / 2;
  const R = h.diameter / 2;
  if (!(r > 0 && R > r && h.threadDepth > 0 && h.drillDepth >= h.threadDepth && h.pointAngle > 0 && h.pointAngle < 180)) return null;
  const d = empty();
  if (view === "top") {
    d.circles.push({ center: { x: 0, y: 0 }, radius: r });
    d.arcs.push({ center: { x: 0, y: 0 }, radius: R, start: 90, sweep: 270 });
    return d;
  }
  d.lines.push(...walls([{ x: -r, y: 0 }, { x: -r, y: -h.drillDepth }], h.blind, r, h.drillDepth, h.pointAngle));
  d.lines.push([{ x: -R, y: 0 }, { x: -R, y: -h.threadDepth }], [{ x: R, y: 0 }, { x: R, y: -h.threadDepth }]);
  // the thread's end, unless it runs out of a through hole's far face
  if (h.blind || h.threadDepth < h.drillDepth) d.lines.push([{ x: -R, y: -h.threadDepth }, { x: R, y: -h.threadDepth }]);
  return d;
}

/** How deep a hole's drawing reaches down its axis: past its depth by its drill point when blind. */
export function holeReach(radius: number, depth: number, blind: boolean, pointAngle: number): number {
  return depth + (blind ? pointRun(radius, pointAngle) : 0);
}

/** points along each of a slot's rounded ends */
const SLOT_END_STEPS = 16;

/**
 * A slot from `a` to `b` (its ends), `width` wide: its outline, the ends half-round. Null when it
 * is no longer than it is wide.
 */
export function slotOutline(a: Pt, b: Pt, width: number): Pt[] | null {
  const len = dist(a, b);
  const r = width / 2;
  if (!(r > 0 && len > width)) return null;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const at = (s: number, t: number): Pt => ({ x: a.x + u.x * s - u.y * t, y: a.y + u.y * s + u.x * t });
  const pts: Pt[] = [];
  for (const [c, from] of [
    [len - r, -90],
    [r, 90],
  ] as const) {
    for (let k = 0; k <= SLOT_END_STEPS; k++) {
      const ang = ((from + (180 * k) / SLOT_END_STEPS) * Math.PI) / 180;
      pts.push(at(c + r * Math.cos(ang), r * Math.sin(ang)));
    }
  }
  return pts;
}

/** A hole pattern's arrangement: rows and columns, or evenly round a bolt circle. */
export type PatternKind = "rectangular" | "circle";
/** A hole pattern's holes: round, tapped, or slotted along the pattern's rows. */
export type PatternHole = "round" | "tapped" | "slotted";

/** A hole pattern, mm. */
export interface HolePattern {
  readonly kind: PatternKind;
  readonly rows: number;
  readonly columns: number;
  readonly rowSpacing: number;
  readonly columnSpacing: number;
  readonly count: number;
  readonly circleDiameter: number;
  readonly hole: PatternHole;
  /** a round hole's diameter, or a tapped one's thread */
  readonly diameter: number;
  readonly tapDrill: number;
  readonly slotWidth: number;
  readonly slotLength: number;
  /** a counterbore's or countersink's diameter (a slot's width), or null for none */
  readonly mouth: number | null;
}

/** most holes one pattern draws, so a slip in Preferences can't fill the drawing */
export const MAX_PATTERN_HOLES = 400;

/** The holes' centres about the pattern's centre at the origin: a bolt circle's first at the top, the rest anticlockwise. */
function patternCentres(p: HolePattern): Pt[] | null {
  if (p.kind === "circle") {
    if (!(Number.isInteger(p.count) && p.count >= 1 && p.count <= MAX_PATTERN_HOLES && p.circleDiameter > 0)) return null;
    const r = p.circleDiameter / 2;
    return Array.from({ length: p.count }, (_, k) => {
      const a = Math.PI / 2 + (2 * Math.PI * k) / p.count;
      return { x: r * Math.cos(a), y: r * Math.sin(a) };
    });
  }
  const { rows, columns } = p;
  if (!(Number.isInteger(rows) && Number.isInteger(columns) && rows >= 1 && columns >= 1 && rows * columns <= MAX_PATTERN_HOLES)) return null;
  if ((rows > 1 && !(p.rowSpacing > 0)) || (columns > 1 && !(p.columnSpacing > 0))) return null;
  const out: Pt[] = [];
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) out.push({ x: (j - (columns - 1) / 2) * p.columnSpacing, y: (i - (rows - 1) / 2) * p.rowSpacing });
  }
  return out;
}

/**
 * A hole pattern centred at the origin, seen from the top, and (with `beyond`) its centre lines:
 * a line along each row and column, or the bolt circle with a line out from its centre across each
 * hole, reaching `beyond` past the holes. Null when the pattern's sizes don't make one.
 */
export function holePattern(p: HolePattern, beyond: number | null): HoleDrawing | null {
  const centres = patternCentres(p);
  if (!centres) return null;
  const slotted = p.hole === "slotted";
  const size = slotted ? p.slotWidth : p.diameter;
  if (!(size > 0) || (slotted && !(p.slotLength > p.slotWidth)) || (p.hole === "tapped" && !(p.tapDrill > 0 && p.tapDrill < p.diameter))) return null;
  if (p.mouth !== null && !(p.mouth > size)) return null;
  const d = empty();
  // how far a hole reaches from its centre, along the rows and across them
  const along = slotted ? (p.slotLength + (p.mouth === null ? 0 : p.mouth - p.slotWidth)) / 2 : (p.mouth ?? size) / 2;
  const across = (p.mouth ?? size) / 2;
  for (const c of centres) {
    if (slotted) {
      const half = p.slotLength / 2;
      d.outlines.push(slotOutline({ x: c.x - half, y: c.y }, { x: c.x + half, y: c.y }, p.slotWidth)!);
      if (p.mouth !== null) d.outlines.push(slotOutline({ x: c.x - along, y: c.y }, { x: c.x + along, y: c.y }, p.mouth)!);
      continue;
    }
    if (p.hole === "tapped") {
      d.circles.push({ center: c, radius: p.tapDrill / 2 });
      d.arcs.push({ center: c, radius: p.diameter / 2, start: 90, sweep: 270 });
    } else d.circles.push({ center: c, radius: p.diameter / 2 });
    if (p.mouth !== null) d.circles.push({ center: c, radius: p.mouth / 2 });
  }
  if (beyond === null) return d;
  if (p.kind === "circle") {
    const r = p.circleDiameter / 2;
    d.circles.push({ center: { x: 0, y: 0 }, radius: r });
    const reach = Math.max(along, across) + beyond;
    for (const c of centres) {
      const u = { x: c.x / r, y: c.y / r };
      d.lines.push([
        { x: c.x - u.x * reach, y: c.y - u.y * reach },
        { x: c.x + u.x * reach, y: c.y + u.y * reach },
      ]);
    }
    return d;
  }
  const xs = [...new Set(centres.map((c) => c.x))];
  const ys = [...new Set(centres.map((c) => c.y))];
  const x0 = Math.min(...xs) - along - beyond;
  const x1 = Math.max(...xs) + along + beyond;
  const y0 = Math.min(...ys) - across - beyond;
  const y1 = Math.max(...ys) + across + beyond;
  for (const y of ys) d.lines.push([{ x: x0, y }, { x: x1, y }]);
  for (const x of xs) d.lines.push([{ x, y: y0 }, { x, y: y1 }]);
  return d;
}

/** How a screw thread is drawn from the side: its root lines (ISO 6410), a line at each crest and root, or its profile. */
export type ThreadStyle = "simplified" | "schematic" | "detailed";

/** An external screw thread, mm: its (major) diameter, its whole length and its thread's, from its end. */
export interface ScrewThread {
  readonly diameter: number;
  readonly length: number;
  readonly threadLength: number;
  readonly pitch: number;
  readonly style: ThreadStyle;
  /** the plain shank past the thread at the thread's pitch diameter (rolled threads), else its full diameter */
  readonly shankAtPitch: boolean;
  /** the end chamfered at 45° down to the thread's root */
  readonly chamfered: boolean;
}

/** most crests a thread draws */
export const MAX_THREAD_TURNS = 2000;

/**
 * An external screw thread from the side: its end at the origin, its axis along +x; the outline,
 * the style's thread lines, the line across where the thread ends, and (with `beyond`) the axis
 * reaching that far past each end. ISO metric proportions: the root 1.2269 pitches and the pitch
 * diameter 0.6495 pitches inside the major diameter. Null when the sizes don't make one.
 */
export function screwThread(t: ScrewThread, beyond: number | null): HoleDrawing | null {
  const R = t.diameter / 2;
  const root = R - (1.226869 * t.pitch) / 2;
  const pitchR = R - (0.649519 * t.pitch) / 2;
  const L = t.length;
  const Lt = t.threadLength;
  const c = t.chamfered ? R - root : 0;
  if (!(R > 0 && t.pitch > 0 && root > 0 && Lt > c && L >= Lt && Lt / t.pitch <= MAX_THREAD_TURNS)) return null;
  const shank = t.shankAtPitch ? pitchR : R;
  // the thread's edge along one side (sign -1 below the axis, 1 above), from the end to the thread's end
  const edge = (sign: number): Pt[] => {
    if (t.style !== "detailed") return [{ x: c, y: sign * R }, { x: Lt, y: sign * R }];
    const pts: Pt[] = [];
    // the far side's crests fall half a pitch along from the near side's
    for (let k = 0; c + (k * t.pitch) / 2 <= Lt; k++) pts.push({ x: c + (k * t.pitch) / 2, y: sign * ((k + (sign > 0 ? 1 : 0)) % 2 === 0 ? R : root) });
    const last = pts.at(-1)!;
    if (last.x < Lt || last.y !== sign * R) pts.push({ x: Lt, y: sign * R });
    return pts;
  };
  const shankEdge = (sign: number): Pt[] => (L === Lt ? [] : shank === R ? [{ x: L, y: sign * R }] : [{ x: Lt, y: sign * shank }, { x: L, y: sign * shank }]);
  const below = [...(c > 0 ? [{ x: 0, y: -root }] : []), ...edge(-1), ...shankEdge(-1)];
  const above = [...(c > 0 ? [{ x: 0, y: root }] : []), ...edge(1), ...shankEdge(1)];
  const d = empty();
  d.outlines.push([...below, ...above.reverse()]);
  if (t.style === "simplified") d.lines.push([{ x: 0, y: -root }, { x: Lt, y: -root }], [{ x: 0, y: root }, { x: Lt, y: root }]);
  if (t.style === "schematic") {
    for (let k = 0; c + (k * t.pitch) / 2 < Lt; k++) {
      const x = c + (k * t.pitch) / 2;
      // crests across the major diameter, roots between them across the minor
      const h = k % 2 === 0 ? R : root;
      if (k > 0 || c > 0) d.lines.push([{ x, y: -h }, { x, y: h }]);
    }
  }
  if (Lt < L) d.lines.push([{ x: Lt, y: -R }, { x: Lt, y: R }]);
  if (beyond !== null) d.lines.push([{ x: -beyond, y: 0 }, { x: L + beyond, y: 0 }]);
  return d;
}

/** points along a keyway's circle */
const KEYWAY_STEPS = 64;

/**
 * A shaft (or, with `hub`, a bore) cut across, `diameter` round and centred at the origin, with a
 * keyway `width` wide at the top: cut `depth` into the shaft, or out of the bore, both measured from
 * the circle on the keyway's middle; and (with `beyond`) centre lines across it reaching that far
 * past the circle. Null when the keyway doesn't fit.
 */
export function keyway(diameter: number, width: number, depth: number, hub: boolean, beyond: number | null): HoleDrawing | null {
  const R = diameter / 2;
  const b = width / 2;
  if (!(R > 0 && b > 0 && b < R && depth > 0)) return null;
  // where the keyway's sides meet the circle
  const corner = Math.sqrt(R * R - b * b);
  const floor = hub ? R + depth : R - depth;
  if (!hub && !(floor < corner && floor > -R)) return null;
  const a = Math.atan2(corner, b);
  const pts: Pt[] = [];
  // round the circle anticlockwise from the keyway's left side to its right
  for (let k = 0; k <= KEYWAY_STEPS; k++) {
    const t = Math.PI - a + ((Math.PI + 2 * a) * k) / KEYWAY_STEPS;
    pts.push({ x: R * Math.cos(t), y: R * Math.sin(t) });
  }
  pts.push({ x: b, y: floor }, { x: -b, y: floor });
  const d = empty();
  d.outlines.push(pts);
  if (beyond !== null) {
    const reach = Math.max(R, hub ? floor : R) + beyond;
    d.lines.push([{ x: -R - beyond, y: 0 }, { x: R + beyond, y: 0 }], [{ x: 0, y: -R - beyond }, { x: 0, y: reach }]);
  }
  return d;
}
