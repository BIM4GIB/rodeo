// Rolling bearings: ball, roller, needle, tapered roller and thrust bearings seen down their axis
// (front) or cut through it (side, the axis running left to right), in detail or simplified as
// ISO 8826-1 draws them (the outline with a free-standing upright cross). A bearing is sized by its
// bore, outside diameter and widths; its rings, rolling elements, grooves and ribs are proportioned
// from them. And KM bearing lock nuts, with their tab washers. Pure geometry in mm, centred on the
// origin.

import type { Pt } from "../core/index.ts";
import { empty } from "./gearShapes.ts";
import type { HoleDrawing } from "./machineShapes.ts";

export type BearingView = "front" | "side";
export type BallType = "single-radial" | "single-angular" | "double-radial" | "double-angular";
export type RollerType = "single-separable" | "single" | "single-self" | "double" | "double-self";
export type NeedleType = "machined" | "drawn";

/** most rows of needles */
export const MAX_NEEDLE_ROWS = 4;
/** points along a groove, a barrel roller's side or a spherical raceway */
const ARC_STEPS = 16;
/** a contact line's angle from the radial, degrees */
const CONTACT_ANGLE = 40;

interface BearingSizes {
  /** the bore, mm */
  readonly inside: number;
  readonly outside: number;
  readonly width: number;
  /** drawn in detail, or simplified to its outline and an upright cross */
  readonly detail: boolean;
}

export interface BallBearing extends BearingSizes {
  readonly kind: "ball";
  readonly type: BallType;
}

export interface RollerBearing extends BearingSizes {
  readonly kind: "roller";
  readonly type: RollerType;
}

export interface NeedleBearing extends BearingSizes {
  readonly kind: "needle";
  readonly type: NeedleType;
  readonly rows: number;
  /** without it the needles run on the shaft, the inside diameter */
  readonly innerRing: boolean;
}

export type Bearing = BallBearing | RollerBearing | NeedleBearing;

/** Why `b` can't be drawn, or null when it can. */
export function bearingProblem(b: Bearing): string | null {
  if (!(b.inside > 0 && b.width > 0)) return "it needs an inside diameter and a width";
  if (!(b.outside >= b.inside + 1)) return "the outside diameter must be at least 1 mm more than the inside one";
  if (b.kind === "needle" && !(Number.isInteger(b.rows) && b.rows >= 1 && b.rows <= MAX_NEEDLE_ROWS)) return `a needle bearing has 1 to ${MAX_NEEDLE_ROWS} rows`;
  if (b.kind === "needle" && !(layout(b).len > 0)) return "the bearing is too narrow for its needles";
  if (b.kind === "roller" && (b.type === "single-self" || b.type === "double-self")) {
    const s = layout(b);
    const sphere = s.rp + s.rb;
    // the outer ring's sphere must still be above the pitch circle at the sides
    if (!(sphere * sphere - (b.width / 2) ** 2 > s.rp * s.rp)) return "a self-aligning bearing that wide needs a larger diameter";
  }
  return null;
}

/** A bearing's section sizes: its radii, chamfer, rolling elements' pitch radius and radius, and the elements' centres along the axis and length. */
interface Layout {
  readonly ro: number;
  readonly ri: number;
  readonly half: number;
  readonly chamfer: number;
  readonly rp: number;
  readonly rb: number;
  readonly xs: readonly number[];
  readonly len: number;
  /** clearance between a roller's end and a rib */
  readonly gap: number;
}

function layout(b: Bearing): Layout {
  const ro = b.outside / 2;
  const ri = b.inside / 2;
  const h = ro - ri;
  const half = b.width / 2;
  const chamfer = Math.min(0.06 * h, 0.06 * b.width);
  const gap = 0.04 * b.width;
  if (b.kind === "ball") {
    const double = b.type === "double-radial" || b.type === "double-angular";
    const rb = double ? Math.min(0.25 * h, 0.21 * b.width) : Math.min(0.3 * h, 0.4 * b.width);
    return { ro, ri, half, chamfer, rp: (ro + ri) / 2, rb, xs: double ? [-half / 2, half / 2] : [0], len: 2 * rb, gap };
  }
  if (b.kind === "roller") {
    const double = b.type === "double" || b.type === "double-self";
    const rb = double ? 0.22 * h : 0.25 * h;
    return { ro, ri, half, chamfer, rp: (ro + ri) / 2, rb, xs: double ? [-half / 2, half / 2] : [0], len: double ? 0.36 * b.width : 0.6 * b.width, gap };
  }
  // needles: an inner ring and the needles take fixed shares of the section, the outer ring (or a
  // drawn cup's thin shell, the needles closer to the outside) the rest
  const drawn = b.type === "drawn";
  const shell = drawn ? 0.2 * h : 0;
  const rb = (b.innerRing ? (drawn ? 0.35 : 0.3) : drawn ? 0.45 : 0.4) * h * 0.5;
  const rp = drawn ? ro - shell - rb : ri + (b.innerRing ? 0.3 * h : 0) + rb;
  const end = drawn ? shell : 0.1 * b.width;
  const n = b.rows;
  const len = (b.width - 2 * end - (n + 1) * gap) / n;
  const xs = Array.from({ length: n }, (_, i) => -half + end + gap + len / 2 + i * (len + gap));
  return { ro, ri, half, chamfer, rp, rb, xs, len, gap };
}

/** A ring's section above the axis from `left` to `right`: its face (left to right), then at the right side out to `edge` (the outside diameter's radius or the bore's) and back, the corners there chamfered by `c`. */
function band(face: Pt[], left: number, right: number, edge: number, c: number): Pt[] {
  const back = edge > face[0].y ? -c : c;
  return [...face, { x: right, y: edge + back }, { x: right - c, y: edge }, { x: left + c, y: edge }, { x: left, y: edge + back }];
}

/** The outer ring's section above the axis: its face, then up to the outside diameter. */
function outerRing(face: Pt[], s: Layout): Pt[] {
  return band(face, -s.half, s.half, s.ro, s.chamfer);
}

/** The inner ring's section above the axis: its face, then down to the bore. */
function innerRing(face: Pt[], s: Layout): Pt[] {
  return band(face, -s.half, s.half, s.ri, s.chamfer);
}

/**
 * A ring's face over the balls (`sign` 1, the outer ring) or under them (-1, the inner): level
 * at each side of each ball where `levels` says (how far from the pitch radius it meets the ball,
 * left and right), round the ball's groove between.
 */
function ballFace(s: Layout, sign: 1 | -1, levels: readonly (readonly [number, number])[]): Pt[] {
  const pts: Pt[] = [{ x: -s.half, y: s.rp + sign * levels[0][0] }];
  s.xs.forEach((cx, i) => {
    const [l, r] = levels[i];
    const a0 = Math.atan2(sign * l, -Math.sqrt(s.rb * s.rb - l * l));
    const a1 = Math.atan2(sign * r, Math.sqrt(s.rb * s.rb - r * r));
    for (let k = 0; k <= ARC_STEPS; k++) {
      const a = a0 + ((a1 - a0) * k) / ARC_STEPS;
      pts.push({ x: cx + s.rb * Math.cos(a), y: s.rp + s.rb * Math.sin(a) });
    }
  });
  pts.push({ x: s.half, y: s.rp + sign * levels[levels.length - 1][1] });
  return pts;
}

/**
 * A ring's face over cylindrical rollers (`sign` 1) or under them (-1): on the raceway along each
 * roller, and in each space beside one (before the first, between, after the last) up to a rib
 * where `ribs` says so.
 */
function rollerFace(s: Layout, sign: 1 | -1, ribs: readonly boolean[], rib: number): Pt[] {
  const race = s.rp + sign * s.rb;
  const ribbed = s.rp + sign * (s.rb - rib);
  const level = (i: number): number => (ribs[i] ? ribbed : race);
  const pts: Pt[] = [{ x: -s.half, y: level(0) }];
  s.xs.forEach((cx, i) => {
    const left = cx - s.len / 2 - s.gap;
    const right = cx + s.len / 2 + s.gap;
    pts.push({ x: left, y: level(i) }, { x: left, y: race }, { x: right, y: race }, { x: right, y: level(i + 1) });
  });
  pts.push({ x: s.half, y: level(s.xs.length) });
  return pts;
}

/** A cylindrical roller (or needle) cut along its axis: its length by its diameter, the corners chamfered. */
function cylinder(cx: number, cy: number, len: number, r: number): Pt[] {
  const c = Math.min(0.15 * r, 0.1 * len);
  const l = len / 2;
  return [
    { x: cx - l + c, y: cy - r },
    { x: cx + l - c, y: cy - r },
    { x: cx + l, y: cy - r + c },
    { x: cx + l, y: cy + r - c },
    { x: cx + l - c, y: cy + r },
    { x: cx - l + c, y: cy + r },
    { x: cx - l, y: cy + r - c },
    { x: cx - l, y: cy - r + c },
  ];
}

/**
 * A self-aligning bearing's barrel roller cut along its axis, which is tilted `tilt` radians from
 * the bearing's (its centre on the circle of the rollers' centres): its outer side on the outer
 * ring's sphere about the origin, its inner side the same curve turned over. Returns the outline
 * and its inner side (left to right) for the inner ring's groove.
 */
function barrel(s: Layout, tilt: number): { outline: Pt[]; under: Pt[] } {
  const sphere = s.rp + s.rb;
  const reach = sphere - s.rb;
  const centre = { x: reach * Math.sin(tilt), y: reach * Math.cos(tilt) };
  const along = { x: Math.cos(tilt), y: -Math.sin(tilt) };
  const out = { x: Math.sin(tilt), y: Math.cos(tilt) };
  const at = (u: number, v: number): Pt => ({ x: centre.x + u * along.x + v * out.x, y: centre.y + u * along.y + v * out.y });
  const over: Pt[] = [];
  const under: Pt[] = [];
  for (let k = 0; k <= ARC_STEPS; k++) {
    const u = -s.len / 2 + (s.len * k) / ARC_STEPS;
    const v = Math.sqrt(sphere * sphere - u * u) - reach;
    over.push(at(u, v));
    under.push(at(u, -v));
  }
  return { outline: [...under, ...over.reverse()], under };
}

/** The outer ring's face on a self-aligning bearing: the sphere about the origin through the rollers' outer sides. */
function sphereFace(s: Layout): Pt[] {
  const sphere = s.rp + s.rb;
  return Array.from({ length: ARC_STEPS * 2 + 1 }, (_, k) => {
    const x = -s.half + (2 * s.half * k) / (ARC_STEPS * 2);
    return { x, y: Math.sqrt(sphere * sphere - x * x) };
  });
}

/** The inner ring's face under barrel rollers: round each roller's inner side, a rib at each side of the ring (none between two rows, whose ends nearly meet). */
function barrelFace(s: Layout, unders: readonly Pt[][], rib: number, slope: number): Pt[] {
  const gap = s.gap + rib * slope;
  const first = unders[0][0];
  const lastUnder = unders[unders.length - 1];
  const last = lastUnder[lastUnder.length - 1];
  return [
    { x: -s.half, y: first.y + rib },
    { x: first.x - gap, y: first.y + rib },
    { x: first.x - gap, y: first.y },
    ...unders.flat(),
    { x: last.x + gap, y: last.y },
    { x: last.x + gap, y: last.y + rib },
    { x: s.half, y: last.y + rib },
  ];
}

/** The section above the axis: the rings' outlines and the rolling elements, with any contact lines. */
function upperSection(b: Bearing): { rings: Pt[][]; rollers: Pt[][]; balls: { center: Pt; radius: number }[]; lines: Pt[][]; outerMin: number; innerMax: number } {
  const s = layout(b);
  const rings: Pt[][] = [];
  const rollers: Pt[][] = [];
  const balls: { center: Pt; radius: number }[] = [];
  const lines: Pt[][] = [];
  let outerFace: Pt[];
  let innerFace: Pt[] | null;
  if (b.kind === "ball") {
    // how far from the balls' centres the rings' faces meet them: a deep groove's shoulders, an
    // angular bearing's holding shoulder (deeper) and its relieved one (barely past the ball's top)
    const deep = 0.6 * s.rb;
    const held = 0.45 * s.rb;
    const relieved = 0.9 * s.rb;
    const contact = (cx: number, lean: number): void => {
      const a = (lean * CONTACT_ANGLE * Math.PI) / 180;
      const r = 1.5 * s.rb;
      lines.push([{ x: cx - r * Math.sin(a), y: s.rp + r * Math.cos(a) }, { x: cx + r * Math.sin(a), y: s.rp - r * Math.cos(a) }]);
    };
    let outer: [number, number][];
    let inner: [number, number][];
    if (b.type === "single-radial") {
      outer = [[deep, deep]];
      inner = [[deep, deep]];
    } else if (b.type === "double-radial") {
      outer = [[deep, deep], [deep, deep]];
      inner = [[deep, deep], [deep, deep]];
    } else if (b.type === "single-angular") {
      // the outer ring holds the ball from the upper left, the inner from the lower right
      outer = [[held, relieved]];
      inner = [[relieved, held]];
      contact(0, 1);
    } else {
      // back to back: each row's outer contact towards the middle, its inner towards its side
      outer = [[relieved, held], [held, relieved]];
      inner = [[held, relieved], [relieved, held]];
      contact(s.xs[0], -1);
      contact(s.xs[1], 1);
    }
    outerFace = ballFace(s, 1, outer);
    innerFace = ballFace(s, -1, inner);
    for (const cx of s.xs) balls.push({ center: { x: cx, y: s.rp }, radius: s.rb });
  } else if (b.kind === "roller" && (b.type === "single-self" || b.type === "double-self")) {
    const rib = 0.4 * s.rb;
    const reach = s.rp;
    const tilts = b.type === "single-self" ? [0] : [-Math.asin(s.half / 2 / reach), Math.asin(s.half / 2 / reach)];
    const barrels = tilts.map((t) => barrel(s, t));
    for (const r of barrels) rollers.push(r.outline);
    outerFace = sphereFace(s);
    innerFace = barrelFace(
      s,
      barrels.map((r) => r.under),
      rib,
      Math.tan(Math.abs(tilts[0])),
    );
  } else if (b.kind === "roller") {
    const rib = 0.4 * s.rb;
    // separable (NU): the outer ring ribbed, the inner plain so it comes away; single row: both
    // ribbed; double row (NNU): the outer ring ribbed at its sides and between the rows
    const outerRibs = b.type === "double" ? [true, true, true] : [true, true];
    const innerRibs = b.type === "single" ? [true, true] : b.type === "double" ? [false, false, false] : [false, false];
    outerFace = rollerFace(s, 1, outerRibs, rib);
    innerFace = rollerFace(s, -1, innerRibs, rib);
    for (const cx of s.xs) rollers.push(cylinder(cx, s.rp, s.len, s.rb));
  } else {
    const top = s.rp + s.rb;
    if (b.type === "drawn") {
      // a thin drawn shell, its lips turned down past the needles' ends to their axis
      const t = s.ro - top;
      rings.push([
        { x: -s.half, y: s.rp },
        { x: -s.half, y: s.ro },
        { x: s.half, y: s.ro },
        { x: s.half, y: s.rp },
        { x: s.half - t, y: s.rp },
        { x: s.half - t, y: top },
        { x: -s.half + t, y: top },
        { x: -s.half + t, y: s.rp },
      ]);
      outerFace = [];
    } else {
      const ribTo = top - 0.6 * s.rb;
      const end = 0.1 * b.width;
      outerFace = [
        { x: -s.half, y: ribTo },
        { x: -s.half + end, y: ribTo },
        { x: -s.half + end, y: top },
        { x: s.half - end, y: top },
        { x: s.half - end, y: ribTo },
        { x: s.half, y: ribTo },
      ];
    }
    innerFace = b.innerRing
      ? [
          { x: -s.half, y: s.rp - s.rb },
          { x: s.half, y: s.rp - s.rb },
        ]
      : null;
    for (const cx of s.xs) rollers.push(cylinder(cx, s.rp, s.len, s.rb));
  }
  if (outerFace.length) rings.push(outerRing(outerFace, s));
  if (innerFace) rings.push(innerRing(innerFace, s));
  const outerMin = outerFace.length ? Math.min(...outerFace.map((p) => p.y)) : s.rp + s.rb;
  const innerMax = innerFace ? Math.max(...innerFace.map((p) => p.y)) : s.ri;
  return { rings, rollers, balls, lines, outerMin, innerMax };
}

const flip = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: p.x, y: -p.y }));

/**
 * A bearing cut through its axis, which runs left to right: above and below it the rings and
 * rolling elements in section, or simplified (ISO 8826-1) to the section's outline with an
 * upright cross; with `beyond`, the axis reaching that far past the sides.
 */
export function bearingSide(b: Bearing, beyond: number | null): HoleDrawing {
  const d = empty();
  const s = layout(b);
  if (b.detail) {
    const up = upperSection(b);
    bothHalves(d, [...up.rings, ...up.rollers], up.lines, up.balls);
  } else simplifiedSide(d, -s.half, s.half, s.ri, s.ro);
  if (beyond !== null) d.lines.push([{ x: -s.half - beyond, y: 0 }, { x: s.half + beyond, y: 0 }]);
  return d;
}

/** How many rolling elements go round: as many as fit with the space a cage takes between them. */
function elementCount(b: Bearing, s: Layout): number {
  const spacing = b.kind === "ball" ? 1.3 : b.kind === "roller" ? 1.25 : 1.12;
  return Math.max(3, Math.min(400, Math.floor((2 * Math.PI * s.rp) / (2 * s.rb * spacing))));
}

/**
 * A bearing seen down its axis: its outside and bore, with detail the chamfers' and the rings'
 * edges and the rolling elements between the rings (each a circle, only where it shows between
 * them), the first at the top; with `beyond`, centre lines that far past the outside.
 */
export function bearingFront(b: Bearing, beyond: number | null): HoleDrawing {
  const d = empty();
  const s = layout(b);
  const centre = { x: 0, y: 0 };
  d.circles.push({ center: centre, radius: s.ro }, { center: centre, radius: s.ri });
  if (b.detail) {
    const up = upperSection(b);
    const drawn = b.kind === "needle" && b.type === "drawn";
    if (!drawn) d.circles.push({ center: centre, radius: s.ro - s.chamfer });
    if (b.kind !== "needle" || b.innerRing) d.circles.push({ center: centre, radius: s.ri + s.chamfer });
    const outerEdge = drawn ? s.rp : up.outerMin;
    const innerEdge = up.innerMax;
    d.circles.push({ center: centre, radius: outerEdge });
    if (innerEdge > s.ri) d.circles.push({ center: centre, radius: innerEdge });
    elementRing(d, s.rp, s.rb, outerEdge, innerEdge, elementCount(b, s));
  }
  frontCentre(d, s.ro, beyond);
  return d;
}

/** `n` rolling elements round the pitch radius `rp`, each a circle of radius `rb`, drawn only where they show between the rings' edges `outerEdge` and `innerEdge`; the first at the top. */
function elementRing(d: ReturnType<typeof empty>, rp: number, rb: number, outerEdge: number, innerEdge: number, n: number): void {
  // a point at angle t round an element's circle is inside the outer edge while cos(t - its
  // angle) is under that edge's bound, and outside the inner edge while it is over the inner's
  const span = (edge: number): number => Math.acos(Math.max(-1, Math.min(1, (edge * edge - rp * rp - rb * rb) / (2 * rp * rb))));
  const from = span(outerEdge);
  const to = span(innerEdge);
  const deg = (r: number): number => (r * 180) / Math.PI;
  for (let i = 0; i < n; i++) {
    const at = Math.PI / 2 + (2 * Math.PI * i) / n;
    const c = { x: rp * Math.cos(at), y: rp * Math.sin(at) };
    if (from <= 0 && to >= Math.PI) {
      d.circles.push({ center: c, radius: rb });
      continue;
    }
    if (to <= from) continue;
    d.arcs.push({ center: c, radius: rb, start: deg(at + from), sweep: deg(to - from) });
    d.arcs.push({ center: c, radius: rb, start: deg(at - to), sweep: deg(to - from) });
  }
}

/** Centre lines across a front view, `beyond` past the outside radius `ro`. */
function frontCentre(d: ReturnType<typeof empty>, ro: number, beyond: number | null): void {
  if (beyond === null) return;
  const r = ro + beyond;
  d.lines.push([{ x: -r, y: 0 }, { x: r, y: 0 }], [{ x: 0, y: -r }, { x: 0, y: r }]);
}

/** ISO 8826-1's simplified bearing cut through its axis: above and below it, the section's outline from `left` to `right` with a free-standing upright cross. */
function simplifiedSide(d: ReturnType<typeof empty>, left: number, right: number, ri: number, ro: number): void {
  const arm = 0.25 * Math.min(right - left, ro - ri);
  const middle = (left + right) / 2;
  for (const sign of [1, -1]) {
    const mid = (sign * (ro + ri)) / 2;
    d.outlines.push([
      { x: left, y: sign * ri },
      { x: right, y: sign * ri },
      { x: right, y: sign * ro },
      { x: left, y: sign * ro },
    ]);
    d.lines.push([{ x: middle - arm, y: mid }, { x: middle + arm, y: mid }], [{ x: middle, y: mid - arm }, { x: middle, y: mid + arm }]);
  }
}

/** The section above the axis drawn above and below it in `d`: its outlines and lines mirrored, its circles too. */
function bothHalves(d: ReturnType<typeof empty>, outlines: readonly Pt[][], lines: readonly Pt[][], circles: readonly { center: Pt; radius: number }[]): void {
  for (const sign of [1, -1]) {
    const way = (pts: readonly Pt[]): Pt[] => (sign > 0 ? [...pts] : flip(pts));
    for (const o of outlines) d.outlines.push(way(o));
    for (const l of lines) d.lines.push(way(l));
    for (const c of circles) d.circles.push({ center: { x: c.center.x, y: sign * c.center.y }, radius: c.radius });
  }
}

/** A small rectangle, for a retainer's (cage's) side ring cut through. */
function box(x0: number, x1: number, y0: number, y1: number): Pt[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

const mirrorX = (pts: readonly Pt[]): Pt[] => pts.map((p) => ({ x: -p.x, y: p.y })).reverse();
const shiftX = (pts: readonly Pt[], dx: number): Pt[] => pts.map((p) => ({ x: p.x + dx, y: p.y }));

// ---- tapered roller bearings ----

export type TaperedType = "single" | "double";

export interface TaperedBearing {
  readonly type: TaperedType;
  /** the bore, mm */
  readonly inside: number;
  readonly outside: number;
  /** the inner ring's (cone's) width; each one's in a double row */
  readonly innerWidth: number;
  /** the outer ring's (cup's) width; the whole double ring's in a double row */
  readonly outerWidth: number;
  /** between a double row's two inner rings */
  readonly space: number;
  /** how far a single row's inner ring stands out past the outer ring at the rollers' large ends */
  readonly projection: number;
  readonly retainers: boolean;
  readonly detail: boolean;
}

/** One row of tapered rollers, their large ends to the right: where its cup's raceway and its cone run along the axis. */
interface TaperRow {
  readonly cupL: number;
  readonly cupR: number;
  readonly coneL: number;
  readonly coneR: number;
}

interface TaperLayout {
  readonly ro: number;
  readonly ri: number;
  readonly h: number;
  readonly chamfer: number;
  /** the cup's raceway's slope, and how fast a roller narrows towards its small end (per mm) */
  readonly slope: number;
  readonly taper: number;
  /** the cup's thickness at the raceway's wide end; a roller's large end diameter; the space at its ends */
  readonly cupWall: number;
  readonly large: number;
  readonly gap: number;
  /** the right-hand row (the left one, in a double row, its mirror image) */
  readonly row: TaperRow;
  /** the whole bearing's left and right sides, and the cup's, before centring */
  readonly left: number;
  readonly right: number;
  readonly cup: readonly [number, number];
}

function taperLayout(t: TaperedBearing): TaperLayout {
  const ro = t.outside / 2;
  const ri = t.inside / 2;
  const h = ro - ri;
  const B = t.innerWidth;
  const C = t.outerWidth;
  // a single row: the cone's back face at 0, the cup's wide end the projection short of it; a
  // double row: the cones back to back about 0 (their fronts the space apart), the cup across both
  const double = t.type === "double";
  const run = double ? 0.45 * C : C;
  const row: TaperRow = double
    ? { cupL: C / 2 - run, cupR: C / 2, coneL: t.space / 2, coneR: t.space / 2 + B }
    : { cupL: -t.projection - C, cupR: -t.projection, coneL: -B, coneR: 0 };
  const slope = Math.min(Math.tan((14 * Math.PI) / 180), (0.3 * h) / run);
  const left = double ? -Math.max(row.coneR, C / 2) : Math.min(row.coneL, row.cupL);
  const right = double ? Math.max(row.coneR, C / 2) : 0;
  return {
    ro,
    ri,
    h,
    chamfer: Math.min(0.05 * h, 0.05 * Math.min(B, C)),
    slope,
    taper: 0.3 * slope,
    cupWall: 0.2 * h,
    large: 0.36 * h,
    gap: 0.05 * run,
    row,
    left,
    right,
    cup: double ? [-C / 2, C / 2] : [row.cupL, row.cupR],
  };
}

/** A row's parts above the axis: the cup's raceway (left to right), the roller, the cone's face (left to right), the retainer's side rings; and for the front view the rollers' large ends' pitch radius, the cone's large rib's top and the cup's edge. */
function taperRow(t: TaperLayout, r: TaperRow) {
  const run = r.cupR - r.cupL;
  const yCup = (x: number): number => t.ro - t.cupWall - (r.cupR - x) * t.slope;
  const len = 0.62 * run;
  const x2 = r.cupR - 0.1 * run;
  const x1 = x2 - len;
  const yCone = (x: number): number => yCup(x) - (t.large - (x2 - x) * t.taper);
  const a = x1 - t.gap;
  const b = x2 + t.gap;
  const smallRib = yCone(a) + 0.2 * t.large;
  const largeRib = yCone(b) + 0.45 * t.large;
  const mid = (yCup(x1) + yCone(x1)) / 2;
  return {
    raceway: [
      { x: r.cupL, y: yCup(r.cupL) },
      { x: r.cupR, y: yCup(r.cupR) },
    ],
    roller: [
      { x: x1, y: yCone(x1) },
      { x: x2, y: yCone(x2) },
      { x: x2, y: yCup(x2) },
      { x: x1, y: yCup(x1) },
    ],
    coneFace: [
      { x: r.coneL, y: smallRib },
      { x: a, y: smallRib },
      { x: a, y: yCone(a) },
      { x: b, y: yCone(b) },
      { x: b, y: largeRib },
      { x: r.coneR, y: largeRib },
    ],
    retainers: [
      box(x1 - 0.32 * t.large, x1 - 0.08 * t.large, mid - 0.08 * t.large, mid + 0.12 * t.large),
      box(x2 + 0.08 * t.large, x2 + 0.32 * t.large, yCone(x2) + 0.58 * t.large, yCone(x2) + 0.78 * t.large),
    ],
    fits: r.coneL < a && r.coneR > b && yCone(a) > t.ri + 0.08 * t.h && largeRib < yCup(r.cupR) - 0.05 * t.h,
    pitch: yCone(x2) + t.large / 2,
    largeRib,
    cupEdge: yCup(r.cupR),
  };
}

/** Why `t` can't be drawn, or null when it can. */
export function taperedProblem(t: TaperedBearing): string | null {
  if (!(t.inside > 0 && t.innerWidth > 0 && t.outerWidth > 0)) return "it needs an inside diameter and both rings' widths";
  if (!(t.outside >= t.inside + 2)) return "the outside diameter must be at least 2 mm more than the inside one";
  if (!(t.projection >= 0 && t.space >= 0)) return "the projection and the space between rows can't be negative";
  const l = taperLayout(t);
  if (!taperRow(l, l.row).fits) return "the rings' widths don't leave room for the rollers and the inner ring's ribs: widen the inner ring or narrow the outer";
  return null;
}

/**
 * A tapered roller bearing cut through its axis, which runs left to right, the rollers' large ends
 * to the right (in a double row, outwards): the cup, rollers and cone above and below the axis
 * (and with `retainers` the cage's side rings), or simplified (ISO 8826-1); centred on the
 * bearing's width. With `beyond`, the axis reaching that far past the sides.
 */
export function taperedSide(t: TaperedBearing, beyond: number | null): HoleDrawing {
  const d = empty();
  const l = taperLayout(t);
  const dx = -(l.left + l.right) / 2;
  if (!t.detail) simplifiedSide(d, l.left + dx, l.right + dx, l.ri, l.ro);
  else {
    const r = taperRow(l, l.row);
    const outlines: Pt[][] = [];
    const cone = band(r.coneFace, l.row.coneL, l.row.coneR, l.ri, l.chamfer);
    const parts = [r.roller, ...(t.retainers ? r.retainers : [])];
    if (t.type === "double") {
      outlines.push(band([...mirrorX(r.raceway), ...r.raceway], l.cup[0], l.cup[1], l.ro, l.chamfer), cone, mirrorX(cone));
      for (const p of parts) outlines.push(p, mirrorX(p));
    } else {
      outlines.push(band(r.raceway, l.cup[0], l.cup[1], l.ro, l.chamfer), cone, ...parts);
    }
    bothHalves(
      d,
      outlines.map((o) => shiftX(o, dx)),
      [],
      [],
    );
  }
  if (beyond !== null) d.lines.push([{ x: l.left + dx - beyond, y: 0 }, { x: l.right + dx + beyond, y: 0 }]);
  return d;
}

/** A tapered roller bearing seen down its axis from the rollers' large ends: the outside and bore, with detail the chamfers, the cup's edge, the cone's large rib and the rollers' large ends between. */
export function taperedFront(t: TaperedBearing, beyond: number | null): HoleDrawing {
  const d = empty();
  const l = taperLayout(t);
  const centre = { x: 0, y: 0 };
  d.circles.push({ center: centre, radius: l.ro }, { center: centre, radius: l.ri });
  if (t.detail) {
    const r = taperRow(l, l.row);
    d.circles.push(
      { center: centre, radius: l.ro - l.chamfer },
      { center: centre, radius: l.ri + l.chamfer },
      { center: centre, radius: r.cupEdge },
      { center: centre, radius: r.largeRib },
    );
    const n = Math.max(3, Math.min(400, Math.floor((2 * Math.PI * r.pitch) / (l.large * 1.25))));
    elementRing(d, r.pitch, l.large / 2, r.cupEdge, r.largeRib, n);
  }
  frontCentre(d, l.ro, beyond);
  return d;
}

// ---- thrust bearings ----

export type ThrustType = "single-ball" | "double-ball" | "roller";
export type RacewayStyle = "grooved" | "flat";

export interface ThrustBearing {
  readonly type: ThrustType;
  readonly raceway: RacewayStyle;
  /** the bore, mm */
  readonly inside: number;
  readonly outside: number;
  /** along the axis */
  readonly thickness: number;
  readonly retainers: boolean;
  readonly detail: boolean;
}

interface ThrustLayout {
  readonly ro: number;
  readonly ri: number;
  readonly half: number;
  /** how far each washer stops short of the other's diameter */
  readonly clear: number;
  readonly chamfer: number;
  readonly rp: number;
  /** a ball's radius, or half a roller's diameter; a roller's length */
  readonly rb: number;
  readonly len: number;
  /** how far from an element's centre a washer's face is */
  readonly face: number;
  /** the rows' centres along the axis */
  readonly xs: readonly number[];
}

function thrustLayout(t: ThrustBearing): ThrustLayout {
  const ro = t.outside / 2;
  const ri = t.inside / 2;
  const h = ro - ri;
  const T = t.thickness;
  const grooved = t.raceway === "grooved";
  const base = { ro, ri, half: T / 2, clear: 0.04 * h, rp: (ro + ri) / 2 };
  if (t.type === "roller") {
    const rb = Math.min(0.22 * T, 0.4 * h);
    return { ...base, chamfer: Math.min(0.05 * h, 0.1 * (T / 2 - rb)), rb, len: 0.6 * h, face: rb, xs: [0] };
  }
  if (t.type === "single-ball") {
    const rb = Math.min(0.28 * h, (grooved ? 0.3 : 0.22) * T);
    const face = grooved ? 0.6 * rb : rb;
    return { ...base, chamfer: Math.min(0.05 * h, 0.1 * (T / 2 - face)), rb, len: 2 * rb, face, xs: [0] };
  }
  // two rows either side of a central shaft washer, the housing washers outside them
  const rb = Math.min(0.28 * h, (grooved ? 0.17 : 0.13) * T);
  const face = grooved ? 0.6 * rb : rb;
  const centre = 0.36 * (T - 4 * face);
  const x = centre / 2 + face;
  return { ...base, chamfer: Math.min(0.05 * h, 0.1 * centre), rb, len: 2 * rb, face, xs: [-x, x] };
}

/** Why `t` can't be drawn, or null when it can. */
export function thrustProblem(t: ThrustBearing): string | null {
  if (!(t.inside > 0 && t.thickness > 0)) return "it needs an inside diameter and a thickness";
  if (!(t.outside >= t.inside + 2)) return "the outside diameter must be at least 2 mm more than the inside one";
  return null;
}

/**
 * A washer's face from the top (`r1`) down to `r0`, facing along +x towards the element centred at
 * `bx` on the pitch radius (or, with `toward` -1, along -x): flat, or grooved round a ball, or
 * with lips beside a roller's ends.
 */
function washerFace(l: ThrustLayout, t: ThrustBearing, bx: number, toward: 1 | -1, r0: number, r1: number): Pt[] {
  // work facing +x towards a ball at +|bx| then mirror
  const cx = toward * bx;
  const fx = cx - l.face;
  let pts: Pt[];
  if (t.type === "roller") {
    const reach = l.len / 2 + 0.03 * (l.ro - l.ri);
    const lip = t.raceway === "grooved" ? cx - 0.7 * l.rb : fx;
    pts = [
      { x: lip, y: r1 },
      { x: lip, y: l.rp + reach },
      { x: fx, y: l.rp + reach },
      { x: fx, y: l.rp - reach },
      { x: lip, y: l.rp - reach },
      { x: lip, y: r0 },
    ];
  } else if (t.raceway === "flat") {
    pts = [
      { x: fx, y: r1 },
      { x: fx, y: r0 },
    ];
  } else {
    const a0 = Math.acos(-l.face / l.rb);
    pts = [{ x: fx, y: r1 }];
    for (let k = 0; k <= ARC_STEPS; k++) {
      const a = a0 + ((2 * Math.PI - 2 * a0) * k) / ARC_STEPS;
      pts.push({ x: cx + l.rb * Math.cos(a), y: l.rp + l.rb * Math.sin(a) });
    }
    pts.push({ x: fx, y: r0 });
  }
  return toward > 0 ? pts : pts.map((p) => ({ x: -p.x, y: p.y }));
}

/** A thrust bearing's washers, balls or rollers and retainers above the axis. */
function thrustSection(t: ThrustBearing, l: ThrustLayout): { outlines: Pt[][]; circles: { center: Pt; radius: number }[] } {
  const outlines: Pt[][] = [];
  const circles: { center: Pt; radius: number }[] = [];
  const c = l.chamfer;
  const shaft: [number, number] = [l.ri, l.ro - l.clear];
  const housing: [number, number] = [l.ri + l.clear, l.ro];
  // an outer washer: its back at the bearing's side, its face towards the nearest row
  const outer = (side: 1 | -1, [r0, r1]: [number, number], bx: number): Pt[] => {
    const back = side * l.half;
    const face = washerFace(l, t, bx, side > 0 ? -1 : 1, r0, r1);
    return [{ x: back, y: r0 + c }, { x: back, y: r1 - c }, { x: back - side * c, y: r1 }, ...face, { x: back - side * c, y: r0 }];
  };
  if (t.type === "double-ball") {
    const [left, right] = l.xs;
    outlines.push(outer(-1, housing, left), outer(1, housing, right));
    // the central shaft washer, between the rows: its right face down, its left face back up
    outlines.push([...washerFace(l, t, right, 1, shaft[0], shaft[1]), ...washerFace(l, t, left, -1, shaft[0], shaft[1]).reverse()]);
  } else {
    outlines.push(outer(-1, shaft, 0), outer(1, housing, 0));
  }
  for (const bx of l.xs) {
    if (t.type === "roller") {
      outlines.push(cylinder(l.rp, bx, l.len, l.rb).map((p) => ({ x: p.y, y: p.x })));
    } else circles.push({ center: { x: bx, y: l.rp }, radius: l.rb });
    if (t.retainers) {
      const w = 0.3 * l.rb;
      const out = l.len / 2 + 0.08 * l.rb;
      const deep = 0.22 * l.rb;
      outlines.push(box(bx - w, bx + w, l.rp + out, l.rp + out + deep), box(bx - w, bx + w, l.rp - out - deep, l.rp - out));
    }
  }
  return { outlines, circles };
}

/**
 * A thrust bearing cut through its axis, which runs left to right: its washers either side of the
 * balls or rollers (the shaft washer on the left, or between a double bearing's rows), above and
 * below the axis, or simplified (ISO 8826-1). With `beyond`, the axis reaching that far past it.
 */
export function thrustSide(t: ThrustBearing, beyond: number | null): HoleDrawing {
  const d = empty();
  const l = thrustLayout(t);
  if (!t.detail) simplifiedSide(d, -l.half, l.half, l.ri, l.ro);
  else {
    const s = thrustSection(t, l);
    bothHalves(d, s.outlines, [], s.circles);
  }
  if (beyond !== null) d.lines.push([{ x: -l.half - beyond, y: 0 }, { x: l.half + beyond, y: 0 }]);
  return d;
}

/** A thrust bearing seen down its axis from the housing washer: the outside and bore, with detail the housing washer's chamfer and bore, the shaft washer's bore inside it. */
export function thrustFront(t: ThrustBearing, beyond: number | null): HoleDrawing {
  const d = empty();
  const l = thrustLayout(t);
  const centre = { x: 0, y: 0 };
  d.circles.push({ center: centre, radius: l.ro }, { center: centre, radius: l.ri });
  if (t.detail) d.circles.push({ center: centre, radius: l.ro - l.chamfer }, { center: centre, radius: l.ri + l.clear });
  frontCentre(d, l.ro, beyond);
  return d;
}

// ---- bearing lock nuts ----

/** A KM lock nut's sizes (DIN 981), mm, with its MB tab washer's outside diameter (DIN 5406). */
export interface LockNutSize {
  readonly id: string;
  /** the thread's nominal diameter and pitch */
  readonly thread: number;
  readonly pitch: number;
  readonly outside: number;
  /** the chamfered face's diameter */
  readonly face: number;
  readonly width: number;
  /** the four slots' width and depth */
  readonly slot: number;
  readonly slotDepth: number;
  readonly washer: number;
}

const km = (n: number, thread: number, pitch: number, outside: number, face: number, width: number, slot: number, slotDepth: number, washer: number): LockNutSize => ({
  id: `KM${n}`,
  thread,
  pitch,
  outside,
  face,
  width,
  slot,
  slotDepth,
  washer,
});

/** KM 0 to KM 20, from catalogue tables. */
export const LOCK_NUTS: readonly LockNutSize[] = [
  km(0, 10, 0.75, 18, 13.5, 4, 3, 2, 21),
  km(1, 12, 1, 22, 17, 4, 3, 2, 25),
  km(2, 15, 1, 25, 21, 5, 4, 2, 28),
  km(3, 17, 1, 28, 24, 5, 4, 2, 32),
  km(4, 20, 1, 32, 26, 6, 4, 2, 36),
  km(5, 25, 1.5, 38, 32, 7, 5, 2, 42),
  km(6, 30, 1.5, 45, 38, 7, 5, 2, 49),
  km(7, 35, 1.5, 52, 44, 8, 5, 2, 57),
  km(8, 40, 1.5, 58, 50, 9, 6, 2.5, 62),
  km(9, 45, 1.5, 65, 56, 10, 6, 2.5, 69),
  km(10, 50, 1.5, 70, 61, 11, 6, 2.5, 74),
  km(11, 55, 2, 75, 67, 11, 7, 3, 81),
  km(12, 60, 2, 80, 73, 11, 7, 3, 86),
  km(13, 65, 2, 85, 79, 12, 7, 3, 92),
  km(14, 70, 2, 92, 85, 12, 8, 3.5, 98),
  km(15, 75, 2, 98, 90, 13, 8, 3.5, 104),
  km(16, 80, 2, 105, 95, 15, 8, 3.5, 112),
  km(17, 85, 2, 110, 102, 16, 8, 3.5, 119),
  km(18, 90, 2, 120, 108, 16, 10, 4, 126),
  km(19, 95, 2, 125, 113, 17, 10, 4, 133),
  km(20, 100, 2, 130, 120, 18, 10, 4, 142),
];

/** the thread's minor diameter, an ISO metric internal thread's */
const minorOf = (n: LockNutSize): number => n.thread - 1.0825 * n.pitch;

/**
 * A lock nut seen down its axis from its chamfered face: its outline with four slots (at the top,
 * bottom and sides), the face's circle, the thread as ISO 6410 shows a tapped hole (the minor
 * diameter's circle, three quarters of the major's); with `washer`, the tab washer's outer tabs
 * standing out round it. With `beyond`, centre lines that far past the outside.
 */
export function lockNutFront(n: LockNutSize, washer: boolean, beyond: number | null): HoleDrawing {
  const d = empty();
  const centre = { x: 0, y: 0 };
  const R = n.outside / 2;
  const half = n.slot / 2;
  const into = Math.sqrt(R * R - half * half);
  const edge = Math.asin(half / R);
  const outline: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const at = (k * Math.PI) / 2;
    const u = { x: Math.cos(at), y: Math.sin(at) };
    const v = { x: -u.y, y: u.x };
    const p = (along: number, across: number): Pt => ({ x: along * u.x + across * v.x, y: along * u.y + across * v.y });
    // the slot: in down its clockwise side, across its bottom, out up the other
    outline.push(p(into, -half), p(R - n.slotDepth, -half), p(R - n.slotDepth, half), p(into, half));
    for (let i = 0; i <= ARC_STEPS; i++) {
      const a = at + edge + ((Math.PI / 2 - 2 * edge) * i) / ARC_STEPS;
      outline.push({ x: R * Math.cos(a), y: R * Math.sin(a) });
    }
  }
  d.outlines.push(outline);
  d.circles.push({ center: centre, radius: n.face / 2 }, { center: centre, radius: minorOf(n) / 2 });
  d.arcs.push({ center: centre, radius: n.thread / 2, start: 90, sweep: 270 });
  if (washer) {
    // outer tabs about as wide as the slots, as many as fit with a gap of most of a tab between
    const Rw = n.washer / 2;
    const tabs = Math.max(8, Math.round((2 * Math.PI * Rw) / (1.8 * n.slot)));
    const a = half / Rw;
    for (let k = 0; k < tabs; k++) {
      const at = Math.PI / 4 + (2 * Math.PI * k) / tabs;
      const ray = (t: number): Pt[] => [
        { x: R * Math.cos(t), y: R * Math.sin(t) },
        { x: Rw * Math.cos(t), y: Rw * Math.sin(t) },
      ];
      d.lines.push(ray(at - a), ray(at + a));
      d.arcs.push({ center: centre, radius: Rw, start: ((at - a) * 180) / Math.PI, sweep: (2 * a * 180) / Math.PI });
    }
  }
  frontCentre(d, washer ? n.washer / 2 : R, beyond);
  return d;
}

/**
 * A lock nut cut through its axis, which runs left to right, its chamfered face on the left: above
 * and below the axis its section from the thread's minor diameter out, the thread's major diameter
 * a line across it (ISO 6410), and the bottom of the slot the cut passes through. With `beyond`,
 * the axis reaching that far past it.
 */
export function lockNutSide(n: LockNutSize, beyond: number | null): HoleDrawing {
  const d = empty();
  const half = n.width / 2;
  const R = n.outside / 2;
  const chamfer = Math.min((R - n.face / 2) * Math.tan(Math.PI / 6), n.width / 2);
  const section: Pt[] = [
    { x: -half, y: minorOf(n) / 2 },
    { x: half, y: minorOf(n) / 2 },
    { x: half, y: R },
    { x: -half + chamfer, y: R },
    { x: -half, y: n.face / 2 },
  ];
  const lines: Pt[][] = [
    [
      { x: -half, y: n.thread / 2 },
      { x: half, y: n.thread / 2 },
    ],
    [
      // from where the slot's bottom meets the chamfer (or the face, below it)
      { x: -half + chamfer * Math.max(0, (R - n.slotDepth - n.face / 2) / (R - n.face / 2)), y: R - n.slotDepth },
      { x: half, y: R - n.slotDepth },
    ],
  ];
  bothHalves(d, [section], lines, []);
  if (beyond !== null) d.lines.push([{ x: -half - beyond, y: 0 }, { x: half + beyond, y: 0 }]);
  return d;
}
