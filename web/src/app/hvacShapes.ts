// What MEP's HVAC tools draw and model (tools/hvac.ts), as plain geometry: the plan and the solid of
// each duct fitting. A drawing's in the object's own coordinates: a run starts at the origin heading
// along +x; a part you place on its centre (a riser, a diffuser) is centred there. Solids stand at
// their own heights, z being above the layer. Kept apart from the tools so it runs without the page.

import type { Pt } from "../core/index.ts";
import { circleOutline, loft, prism, sweep, tube, type Point3, type Solid } from "./solids3d.ts";

export type DuctShape = "rect" | "round";

/** A duct's section: a round one's diameter is its `width`. */
export interface DuctSection {
  readonly shape: DuctShape;
  readonly width: number;
  readonly height: number;
}

export interface HvacDrawing {
  readonly outlines: Pt[][];
  readonly lines: Pt[][];
  readonly circles: { readonly center: Pt; readonly radius: number }[];
}

const UP: Point3 = [0, 0, 1];
/** facets round a round duct */
const ROUND_SIDES = 24;
/** degrees to a facet of an elbow */
const ELBOW_STEP = 5;
const empty = (): { outlines: Pt[][]; lines: Pt[][]; circles: { center: Pt; radius: number }[] } => ({ outlines: [], lines: [], circles: [] });
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
/** a section's height up and down: a round one's its diameter */
export const sectionHigh = (s: DuctSection): number => (s.shape === "round" ? s.width : s.height);

export function sectionProblem(s: DuctSection): string | null {
  if (!(s.width > 0)) return s.shape === "round" ? "it needs a diameter" : "it needs a width";
  if (s.shape === "rect" && !(s.height > 0)) return "it needs a height";
  return null;
}

/** The section round its centre, anticlockwise, x across the duct and y up it. */
function sectionOutline(s: DuctSection): Pt[] {
  if (s.shape === "round") return circleOutline({ x: 0, y: 0 }, s.width / 2, ROUND_SIDES);
  return box(-s.width / 2, -s.height / 2, s.width / 2, s.height / 2);
}

/** A section along a level path, staying upright. */
const run = (path: readonly Pt[], s: DuctSection, z: number): Solid => sweep(path.map((p): Point3 => [p.x, p.y, z]), sectionOutline(s), false, UP);

// ---- straight --------------------------------------------------------------------------------

export function straightDuct(length: number, s: DuctSection): HvacDrawing {
  return { ...empty(), outlines: [box(0, -s.width / 2, length, s.width / 2)] };
}

export function straightDuctSolid(length: number, s: DuctSection, z: number): Solid {
  return run([{ x: 0, y: 0 }, { x: length, y: 0 }], s, z);
}

// ---- elbow -----------------------------------------------------------------------------------

export interface Elbow {
  readonly section: DuctSection;
  /** the bend's inside radius */
  readonly inner: number;
  /** degrees it turns */
  readonly angle: number;
  /** turning to the right, the way it runs; else to the left */
  readonly right: boolean;
}

export function elbowProblem(e: Elbow): string | null {
  if (!(e.inner >= 0)) return "its inner radius can't be less than 0";
  if (!(e.angle > 0 && e.angle <= 180)) return "its angle must be more than 0° and at most 180°";
  return sectionProblem(e.section);
}

/** Points round the bend at `radius` from its centre, from where it starts to where it ends. */
function elbowArc(e: Elbow, radius: number): Pt[] {
  const R = e.inner + e.section.width / 2;
  const sign = e.right ? -1 : 1;
  const turn = (e.angle * Math.PI) / 180;
  const n = Math.max(2, Math.ceil(e.angle / ELBOW_STEP));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (turn * i) / n;
    return { x: radius * Math.sin(a), y: sign * (R - radius * Math.cos(a)) };
  });
}

export function elbow(e: Elbow): HvacDrawing {
  const w = e.section.width;
  return { ...empty(), outlines: [[...elbowArc(e, e.inner + w), ...elbowArc(e, e.inner).reverse()]] };
}

export function elbowSolid(e: Elbow, z: number): Solid {
  return run(elbowArc(e, e.inner + e.section.width / 2), e.section, z);
}

// ---- riser -----------------------------------------------------------------------------------

export type RiserSymbol = "cross" | "diagonal";

export function verticalDuct(s: DuctSection, symbol: RiserSymbol): HvacDrawing {
  const d = empty();
  if (s.shape === "round") {
    const r = s.width / 2;
    const k = r * Math.SQRT1_2;
    d.circles.push({ center: { x: 0, y: 0 }, radius: r });
    d.lines.push([{ x: -k, y: -k }, { x: k, y: k }]);
    if (symbol === "cross") d.lines.push([{ x: -k, y: k }, { x: k, y: -k }]);
    return d;
  }
  const [W, H] = [s.width / 2, s.height / 2];
  d.outlines.push(box(-W, -H, W, H));
  d.lines.push([{ x: -W, y: -H }, { x: W, y: H }]);
  if (symbol === "cross") d.lines.push([{ x: -W, y: H }, { x: W, y: -H }]);
  return d;
}

/** A riser's plan section extruded from `z0` up by `rise`: its `height` is the plan's depth then. */
export function verticalDuctSolid(s: DuctSection, z0: number, rise: number): Solid {
  return prism([sectionOutline(s)], z0, z0 + rise);
}

// ---- flex ------------------------------------------------------------------------------------

/** samples between a flex duct's clicks */
const FLEX_SAMPLES = 10;

/** A smooth curve through the clicks (Catmull-Rom), ending at its ends. */
export function flexPath(points: readonly Pt[]): Pt[] {
  if (points.length < 3) return [...points];
  const at = (i: number): Pt => points[Math.max(0, Math.min(points.length - 1, i))];
  const out: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < FLEX_SAMPLES; k++) {
      const t = k / FLEX_SAMPLES;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** The flex's two sides and, across it, its wire's hoops `pitch` apart. */
export function flexDuct(path: readonly Pt[], diameter: number, pitch: number): HvacDrawing {
  const r = diameter / 2;
  const normal = (i: number): Pt => {
    const a = path[Math.max(0, i - 1)];
    const b = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  };
  const side = (k: number): Pt[] => path.map((p, i) => ({ x: p.x + k * r * normal(i).x, y: p.y + k * r * normal(i).y }));
  const d = empty();
  d.outlines.push([...side(1), ...side(-1).reverse()]);
  let run = 0;
  let next = pitch;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1], path[i]];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    while (len > 0 && next <= run + len) {
      const t = (next - run) / len;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
      d.lines.push([{ x: q.x + r * n.x, y: q.y + r * n.y }, { x: q.x - r * n.x, y: q.y - r * n.y }]);
      next += pitch;
    }
    run += len;
  }
  return d;
}

export function flexDuctSolid(path: readonly Pt[], diameter: number, z: number): Solid {
  return tube(path.map((p): Point3 => [p.x, p.y, z]), diameter / 2, false, 16);
}

// ---- transition ------------------------------------------------------------------------------

export type TransitionAlign = "centre" | "left" | "right";

export interface Transition {
  readonly from: DuctSection;
  readonly to: DuctSection;
  readonly length: number;
  /** centred, or one side flat: to the left of the run or the right */
  readonly align: TransitionAlign;
}

export function transitionProblem(t: Transition): string | null {
  if (!(t.length > 0)) return "it needs a length";
  return sectionProblem(t.from) ?? sectionProblem(t.to);
}

/** how far the far end's centre stands to the left of the near end's */
function transitionShift(t: Transition): number {
  const flat = (t.from.width - t.to.width) / 2;
  return t.align === "left" ? flat : t.align === "right" ? -flat : 0;
}

export function transition(t: Transition): HvacDrawing {
  const y = transitionShift(t);
  const [a, b] = [t.from.width / 2, t.to.width / 2];
  return { ...empty(), outlines: [[{ x: 0, y: -a }, { x: t.length, y: y - b }, { x: t.length, y: y + b }, { x: 0, y: a }]] };
}

/** `n` points round a section (a multiple of 4), anticlockwise from its upper corner on +x or the same way round a circle, so two can be joined. */
function sectionRing(s: DuctSection, n: number): Pt[] {
  if (s.shape === "round") return Array.from({ length: n }, (_, i) => { const a = (i * 2 * Math.PI) / n + Math.PI / 4; return { x: (s.width / 2) * Math.cos(a), y: (s.width / 2) * Math.sin(a) }; });
  const [W, H] = [s.width / 2, s.height / 2];
  const corners = [{ x: W, y: H }, { x: -W, y: H }, { x: -W, y: -H }, { x: W, y: -H }];
  const side = n / 4;
  return corners.flatMap((c, k) => {
    const q = corners[(k + 1) % 4];
    return Array.from({ length: side }, (_, j) => ({ x: c.x + ((q.x - c.x) * j) / side, y: c.y + ((q.y - c.y) * j) / side }));
  });
}

export function transitionSolid(t: Transition, z: number): Solid {
  const n = t.from.shape === "rect" && t.to.shape === "rect" ? 4 : 48;
  const y = transitionShift(t);
  // a ring across the run, its x to the left of it, its y up
  const ring = (s: DuctSection, x: number, shift: number): Point3[] => sectionRing(s, n).map((p): Point3 => [x, shift + p.x, z + p.y]);
  return loft([ring(t.from, 0, 0), ring(t.to, t.length, y)]);
}

// ---- splitter --------------------------------------------------------------------------------

export interface Splitter {
  readonly width: number;
  readonly height: number;
  /** the main run's length up to the fork */
  readonly lead: number;
  /** each branch's width: the one on the left of the run, then the right */
  readonly left: number;
  readonly right: number;
  readonly branch: number;
  /** degrees each branch leans off the run: 90 makes a tee */
  readonly angle: number;
}

export function splitterProblem(s: Splitter): string | null {
  if (!(s.width > 0 && s.height > 0)) return "it needs a width and a height";
  if (!(s.left > 0 && s.right > 0)) return "each branch needs a width";
  if (!(s.lead >= 0 && s.branch > 0)) return "its branches need a length";
  if (!(s.angle >= 15 && s.angle <= 90)) return "its branch angle must be from 15° to 90°";
  // the inner sides have to meet past the fork and before the branches end
  const a = (s.angle * Math.PI) / 180;
  const reach = s.lead + s.branch * Math.cos(a) + Math.min(s.left, s.right) * Math.sin(a);
  const x = crotch(s).x;
  if (s.angle < 90 && (x <= s.lead || x >= reach)) return "its branches are too wide for their angle";
  return null;
}

/** Where the two branches' inner sides meet, or for a tee where the wall across it starts. */
function crotch(s: Splitter): Pt {
  const a = (s.angle * Math.PI) / 180;
  const [c, q] = [Math.cos(a), Math.sin(a)];
  const W = s.width / 2;
  // each inner side is the outer one moved across the branch, inwards
  const left = { x: s.lead + s.left * q, y: W - s.left * c };
  const right = { x: s.lead + s.right * q, y: -W + s.right * c };
  if (Math.abs(c) < 1e-6) return { x: Math.max(left.x, right.x), y: 0 };
  // left + t (c, q) meets right + u (c, -q)
  const u = (right.y - left.y) / (2 * q) - (right.x - left.x) / (2 * c);
  return { x: right.x + u * c, y: right.y - u * q };
}

export function splitter(s: Splitter): HvacDrawing {
  const a = (s.angle * Math.PI) / 180;
  const [c, q] = [Math.cos(a), Math.sin(a)];
  const W = s.width / 2;
  const outerL = { x: s.lead + s.branch * c, y: W + s.branch * q };
  const outerR = { x: s.lead + s.branch * c, y: -W - s.branch * q };
  const innerL = { x: outerL.x + s.left * q, y: outerL.y - s.left * c };
  const innerR = { x: outerR.x + s.right * q, y: outerR.y + s.right * c };
  const tee = Math.abs(c) < 1e-6;
  // a tee's far wall steps where its branches differ
  const fork = tee ? [{ x: innerL.x, y: 0 }, { x: innerR.x, y: 0 }] : [crotch(s)];
  return {
    ...empty(),
    outlines: [[{ x: 0, y: -W }, { x: s.lead, y: -W }, outerR, innerR, ...[...fork].reverse(), innerL, outerL, { x: s.lead, y: W }, { x: 0, y: W }]],
  };
}

export function splitterSolid(s: Splitter, z: number): Solid {
  return prism([splitter(s).outlines[0]], z - s.height / 2, z + s.height / 2);
}

// ---- damper ----------------------------------------------------------------------------------

export function damper(s: DuctSection, length: number): HvacDrawing {
  const d = empty();
  const W = s.width / 2;
  const m = length / 2;
  const k = Math.min(m, W) * 0.8;
  d.outlines.push(box(0, -W, length, W));
  // its blade across the duct, on its pivot, and the pivot's handle outside
  d.lines.push([{ x: m - k, y: -k }, { x: m + k, y: k }], [{ x: m, y: W }, { x: m, y: W + handle(s, length) }]);
  d.circles.push({ center: { x: m, y: 0 }, radius: pivot(s, length) }, { center: { x: m, y: W + handle(s, length) }, radius: pivot(s, length) });
  return d;
}

const pivot = (s: DuctSection, length: number): number => Math.min(s.width, length) * 0.05;
const handle = (s: DuctSection, length: number): number => Math.min(s.width, length) * 0.3;

export function damperSolid(s: DuctSection, length: number, z: number): Solid {
  const m = length / 2;
  const W = s.width / 2;
  const r = pivot(s, length);
  return [...straightDuctSolid(length, s, z), ...tube([[m, W, z], [m, W + handle(s, length), z]], r, false, 12)];
}

// ---- diffuser --------------------------------------------------------------------------------

export interface Diffuser {
  readonly shape: DuctShape;
  /** its face across */
  readonly face: number;
  /** its neck across */
  readonly neck: number;
  /** from its face up to the top of its neck */
  readonly height: number;
}

export function diffuserProblem(d: Diffuser): string | null {
  if (!(d.face > 0 && d.neck > 0 && d.height > 0)) return "it needs a face, a neck and a height";
  if (d.neck > d.face) return "its neck can't be wider than its face";
  return null;
}

/** Seen from below: its face, and its cones or louvres stepping in to the neck. */
export function diffuser(u: Diffuser): HvacDrawing {
  const d = empty();
  const steps = [u.face / 2, (u.face + u.neck) / 4 + u.neck / 8, u.neck / 2];
  if (u.shape === "round") {
    for (const r of steps) d.circles.push({ center: { x: 0, y: 0 }, radius: r });
    return d;
  }
  d.outlines.push(box(-steps[0], -steps[0], steps[0], steps[0]));
  for (const r of steps.slice(1)) d.lines.push([...box(-r, -r, r, r), { x: -r, y: -r }]);
  const [R, r] = [steps[0], steps[2]];
  for (const [a, b] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) d.lines.push([{ x: a * r, y: b * r }, { x: a * R, y: b * R }]);
  return d;
}

/** Hanging from `z0`, its face's underside on the ceiling. */
export function diffuserSolid(u: Diffuser, z0: number): Solid {
  const n = u.shape === "round" ? 48 : 4;
  const plate = Math.min(25, u.height / 5);
  const cone = z0 + u.height * 0.6;
  const ring = (across: number, z: number): Point3[] => sectionRing({ shape: u.shape, width: across, height: across }, n).map((p): Point3 => [p.x, p.y, z]);
  return [...loft([ring(u.face, z0), ring(u.face, z0 + plate)]), ...loft([ring(u.face * 0.92, z0 + plate), ring(u.neck, cone)]), ...loft([ring(u.neck, cone), ring(u.neck, z0 + u.height)])];
}

// ---- outlet ----------------------------------------------------------------------------------

export interface Outlet {
  readonly width: number;
  readonly height: number;
  /** from its face back into the wall or duct */
  readonly depth: number;
}

export function outletProblem(o: Outlet): string | null {
  return o.width > 0 && o.height > 0 && o.depth > 0 ? null : "it needs a width, a height and a depth";
}

/** The grille edge on, its face along x on the click and the air's arrow leaving it, towards −y. */
export function outlet(o: Outlet): HvacDrawing {
  const d = empty();
  const W = o.width / 2;
  const reach = o.width * 0.4;
  const head = reach * 0.25;
  d.outlines.push(box(-W, 0, W, o.depth));
  d.lines.push([{ x: 0, y: 0 }, { x: 0, y: -reach }], [{ x: -head, y: -reach + head }, { x: 0, y: -reach }, { x: head, y: -reach + head }]);
  return d;
}

/** a bar of the grille every so far up it */
const LOUVRE_PITCH = 40;

/** Its middle at `z`: a plate back into the wall, with louvre bars across its face. */
export function outletSolid(o: Outlet, z: number): Solid {
  const W = o.width / 2;
  const [z0, z1] = [z - o.height / 2, z + o.height / 2];
  const bars = Math.min(16, Math.max(2, Math.floor(o.height / LOUVRE_PITCH)));
  const thick = Math.min(o.height / (2 * bars), 10);
  const out = Math.min(o.depth / 2, 15);
  return [
    ...prism([box(-W, 0, W, o.depth)], z0, z1),
    ...Array.from({ length: bars }, (_, i) => {
      const at = z0 + ((i + 0.5) * o.height) / bars;
      return prism([box(-W, -out, W, 0)], at - thick / 2, at + thick / 2);
    }).flat(),
  ];
}
