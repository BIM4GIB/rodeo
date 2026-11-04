// Buildings and gardens as 3D parts, for the agent's build tool. The agent (an LLM) sends a list
// of element specs as JSON: runs of walls with their openings, windows and doors with their
// fittings, floors, roofs, chimneys, steps, ground surfaces, hedges, fences, trees and plain
// solids. Each element is checked, given defaults and turned into parts. A part is an upright
// prism (a plan outline between two heights) wherever the piece is one, so it stays editable as
// an extrude, and otherwise a closed mesh of flat convex faces (roof slopes, gable ends, braces,
// canopies, cones). Everything is low-poly on purpose: a house with twenty windows, a roof,
// chimneys and a garden comes to a few thousand faces.
//
// World millimetres, plan x right and y up, z up from the layer (z = 0 is the ground floor level
// the agent chooses); angles in degrees counter-clockwise from +x.

import earcut from "earcut";
import { cleanMesh, outward, subtractMeshes, unionMeshes } from "../../core/csg.ts";
import type { Pt } from "../../core/types.ts";

// ---- the contract ------------------------------------------------------------------------

export interface BuildPart {
  /** what it is, e.g. "Walls", "Floors", "Roof", "Windows", "Glazing", "Doors", "Chimneys", "Steps", "Garden", "Planting", "Fences"; the parent makes a class per category */
  category: string;
  /** the object's name as the user will see it, e.g. "Wall 3", "Window 2 frame" */
  name: string;
  /** parts sharing a group key become one group object (one per window, door, tree, chimney...); omit for loose parts */
  group?: string;
  /** "#rrggbb" */
  color: string;
  /** 0..100, default 100 (glass about 35) */
  opacity?: number;
  shape:
    /** an upright prism: a simple polygon in plan (counter-clockwise, no repeated last point, at least 3 corners) from z0 up to z1 (z1 > z0); the parent makes these extrudes */
    | { kind: "prism"; outline: Pt[]; z0: number; z1: number }
    /** anything else: convex planar faces, each x, y, z triples round the face, counter-clockwise seen from outside, 3 to 10 corners; the parent makes these meshes */
    | { kind: "mesh"; faces: number[][] };
}

type Shape = BuildPart["shape"];

/** Fields every element takes. Points may also be given as [x, y]. */
export interface BuildCommon {
  /** the object's name; parts of a many-part element are named after it ("Front door frame"); default numbered ("Window 3") */
  name?: string;
  /** overrides the category, and so the class, of every part */
  category?: string;
  /** the element's main colour, "#rrggbb" */
  color?: string;
  /** puts every part in this group instead of the element's own */
  group?: string;
}

/** Glazing and fittings of a window, standalone or in a wall opening. */
export interface WindowOptions {
  /** casement: side-hung (default); sash: two vertically sliding sashes; fixed: glass in the frame; tilt: tilt-and-turn */
  style?: "casement" | "sash" | "fixed" | "tilt";
  /** glazing bars per sash as [columns, rows]: [3, 2] on a sash window is six-over-six; default [1, 1], sash [3, 2] */
  panes?: [number, number];
  /** casements (or fixed lights) side by side, split by mullions; default 1 up to 900 wide, 2 up to 1800, else 3 */
  leaves?: number;
  /** outer frame member width, default 60 */
  frame?: number;
  /** outer frame depth through the wall, default 70 (sash 120) */
  frameDepth?: number;
  /** how far the frame is set in from the wall's outer face, default 100 */
  reveal?: number;
  /** frame colour, default "#f4f4f0" */
  color?: string;
  /** default "#a9c7d6" */
  glassColor?: string;
  /** default 35 */
  glassOpacity?: number;
  /** a projecting sill under the opening outside, default "stone" ("#d8d2c4") */
  sillBoard?: boolean | "stone" | "timber";
  /** handles on the inner side (sash lifts and a fastener on sash windows), default true but not on fixed windows */
  handles?: boolean;
  /** a visible lintel over the head on the outer face, default none */
  lintel?: boolean | "stone" | "timber";
  /** handles, default "#b9b9b4" */
  metalColor?: string;
}

/** Leaf, frame and ironmongery of a door, standalone or in a wall opening. */
export interface DoorOptions {
  /** panel: four raised panels each face (default); plank or ledged: boards with ledges and braces inside; glazed: upper glazing with bars; french or double: a pair of glazed leaves; stable: split top and bottom */
  style?: "panel" | "plank" | "ledged" | "glazed" | "french" | "double" | "stable";
  /** glazing bars per glazed leaf as [columns, rows], default [2, 3] (french [2, 4]) */
  panes?: [number, number];
  /** frame member width, default 60 */
  frame?: number;
  /** frame depth through the wall, default 100 */
  frameDepth?: number;
  /** how far the frame is set in from the wall's outer face, default 100 */
  reveal?: number;
  /** default 45 */
  leafThickness?: number;
  /** the leaf colour: default dark green, oak for boarded doors, white for french doors */
  color?: string;
  /** default "#f4f4f0" */
  frameColor?: string;
  glassColor?: string;
  glassOpacity?: number;
  /** ironmongery, default "#26282a" */
  metalColor?: string;
  /** the hinge side seen from outside, default "left" */
  hinge?: "left" | "right";
  /** lever handles both sides, default true */
  handle?: boolean;
  letterbox?: boolean;
  knocker?: boolean;
  /** a stone step outside under the threshold: true (150 high) or its height */
  step?: boolean | number;
  lintel?: boolean | "stone" | "timber";
}

/** An opening in a run of walls. Give `segment` and `at`, or a `point` near the wall. */
export interface WallOpening extends Omit<WindowOptions, "style" | "color" | "panes">, Omit<DoorOptions, "style" | "color" | "panes" | "lintel"> {
  /** default "window"; an "opening" is just the hole */
  type?: "window" | "door" | "opening";
  /** the path segment, from 0 (segment i runs from path[i] to path[i + 1]); default the one nearest `point` */
  segment?: number;
  /** distance along the segment from its start to the opening's middle */
  at?: number;
  /** a plan point near the wall, instead of segment and at */
  point?: Pt;
  /** default 1000 (doors 900) */
  width?: number;
  /** default 1200 (doors 2100) */
  height?: number;
  /** height of the opening's bottom above the wall's base, default 900 (doors 0) */
  sill?: number;
  /** the window's or door's name */
  name?: string;
  style?: WindowOptions["style"] | DoorOptions["style"];
  color?: string;
  panes?: [number, number];
}

/** Runs of walls along a centre line, mitred at corners, cut cleanly round their openings. */
export interface WallsSpec extends BuildCommon {
  kind: "walls";
  path: Pt[];
  closed?: boolean;
  /** default 300 */
  thickness?: number;
  /** default 2500 */
  height?: number;
  /** z of the bottom, default 0 */
  base?: number;
  /** which side of an open path is outside, seen going along it, default "right"; a closed path knows */
  outside?: "left" | "right";
  openings?: WallOpening[];
}

/** Where a standalone window or door sits: `at` and `facing`, `at` and `angle`, or `a` and `b`. */
export interface Placement {
  /** the opening's middle on the wall line */
  at?: Pt;
  /** the direction the window or door faces out */
  facing?: number;
  /** the wall's direction, outside on its right (instead of facing) */
  angle?: number;
  /** the two sides of the opening on the wall line, outside on the right going from a to b */
  a?: Pt;
  b?: Pt;
  /** whether at, a and b are on the wall's outer face (default) or its centre line */
  line?: "outer" | "centre";
  /** default 300 */
  wallThickness?: number;
  /** z of the floor, default 0 */
  base?: number;
  width?: number;
  height?: number;
  sill?: number;
}

export interface WindowSpec extends BuildCommon, Placement, Omit<WindowOptions, "color"> {
  kind: "window";
}

export interface DoorSpec extends BuildCommon, Placement, Omit<DoorOptions, "color"> {
  kind: "door";
}

export interface SlabSpec extends BuildCommon {
  kind: "slab" | "floor";
  outline: Pt[];
  /** z of the top, default 0 */
  top?: number;
  /** default 200 */
  thickness?: number;
}

/** A dormer on a roof slope, with its window. */
export interface DormerSpec extends Omit<WindowOptions, "color" | "style"> {
  /** the middle of the dormer's front, on or up the slope from the eaves wall line */
  at: Pt;
  /** the window's width, default 900 */
  width?: number;
  /** the window's height, default 900 */
  height?: number;
  /** gable (default), flat, or eyebrow (a low hipped front) */
  style?: "gable" | "flat" | "eyebrow";
  /** the window's style, default casement */
  windowStyle?: WindowOptions["style"];
  /** the window frame's colour */
  windowColor?: string;
  name?: string;
}

export interface RoofSpec extends BuildCommon {
  kind: "roof";
  /** the footprint at eaves level, usually the walls' centre lines */
  outline: Pt[];
  /** z where the roof's underside crosses the outline (the wall top), default 2500 */
  eaves?: number;
  style?: "gable" | "hip" | "half-hip" | "mono" | "flat" | "mansard";
  /** degrees, 5 to 75; default 40 (thatch 50, mansard's upper slopes 25) */
  pitch?: number;
  /** the ridge along the long (default) or short axis, or the axis nearest an angle */
  ridge?: "long" | "short" | number;
  /** plan overhang past the walls' outer face at eaves, default 300 (thatch 400, flat 0) */
  overhang?: number;
  /** plan overhang past the walls' outer face at gable ends, default 200 (thatch 50) */
  verge?: number;
  /** measured square to the slope, default 200 (thatch 400) */
  thickness?: number;
  material?: "tile" | "slate" | "thatch" | "metal" | "felt";
  /** fill the gable ends above the eaves with wall, default true */
  gableWalls?: boolean;
  /** default 300 */
  wallThickness?: number;
  /** whether the outline is the walls' centre line (default) or their outer face */
  wallLine?: "centre" | "outer";
  wallColor?: string;
  /** mono: the direction the roof rises toward, default 90 */
  rises?: number;
  /** mono: the high side as an outline edge index (edge i runs from outline[i] to outline[i + 1]) */
  high?: number;
  /** flat: parapet height above the roof */
  parapet?: number;
  /** mansard: pitch of the lower slopes, default 70 */
  lowerPitch?: number;
  /** mansard: how far the lower slopes rise, default 1800 */
  lowerHeight?: number;
  /** gable, hip and half-hip roofs over a rectangle */
  dormers?: DormerSpec[];
}

export interface ChimneySpec extends BuildCommon {
  kind: "chimney";
  /** the stack's middle in plan; or give its outline */
  at?: Pt;
  /** [width, depth], default [600, 450] */
  size?: [number, number];
  angle?: number;
  outline?: Pt[];
  /** default 0 */
  base?: number;
  /** z of the stack's top */
  top: number;
  /** an oversailing course at the top, default true */
  cap?: boolean;
  /** 0 to 4, default 1 */
  pots?: number;
  potColor?: string;
}

export interface StepsSpec extends BuildCommon {
  kind: "steps";
  /** the front middle of the bottom step */
  at: Pt;
  /** the direction the flight rises toward, default 90 */
  angle?: number;
  /** default 1000 */
  width?: number;
  /** default 3 */
  count?: number;
  /** default 170 */
  rise?: number;
  /** default 280 */
  going?: number;
  /** z of the bottom, default 0 */
  base?: number;
  /** depth of a landing at the top, default 0 */
  landing?: number;
}

export type SurfaceKind = "lawn" | "paving" | "patio" | "path" | "driveway" | "gravel" | "planting" | "water" | "decking" | "ground";

/** A ground surface over an outline, or along a centre line `path` `width` wide. */
export interface SurfaceSpec extends BuildCommon {
  kind: SurfaceKind;
  outline?: Pt[];
  path?: Pt[];
  /** default 1000 (driveway 3000) */
  width?: number;
  /** z of the surface, staggered by kind so one laid on another shows: ground -30, lawn 0, planting 5, gravel and water 10, path 15, paving, patio and driveway 20, decking 150 */
  top?: number;
  thickness?: number;
  /** kerbs round the edge: true or { width 100, height 50, color } */
  edging?: boolean | { width?: number; height?: number; color?: string };
}

export interface HedgeSpec extends BuildCommon {
  kind: "hedge";
  path: Pt[];
  closed?: boolean;
  /** default 600 */
  width?: number;
  /** default 1500 */
  height?: number;
  base?: number;
}

export interface FenceSpec extends BuildCommon {
  kind: "fence";
  path: Pt[];
  closed?: boolean;
  /** default 1800 (picket 1000, post-and-rail 1200) */
  height?: number;
  style?: "panel" | "picket" | "post-and-rail" | "close-board";
  /** default 1800 */
  postSpacing?: number;
  base?: number;
}

export interface TreeSpec extends BuildCommon {
  kind: "tree";
  at: Pt;
  /** default 6000 (fruit 3500, conifer 8000) */
  height?: number;
  /** canopy diameter, default 4000 (fruit 3000, conifer 3500) */
  spread?: number;
  type?: "deciduous" | "conifer" | "fruit";
  base?: number;
  trunkColor?: string;
}

export interface ShrubSpec extends BuildCommon {
  kind: "shrub" | "bush";
  at: Pt;
  /** diameter, or [diameter, height]; default 1200 */
  size?: number | [number, number];
  base?: number;
}

export interface BoxSpec extends BuildCommon {
  kind: "box";
  /** the middle in plan */
  at: Pt;
  /** [x, y, z] */
  size: [number, number, number];
  base?: number;
  angle?: number;
}

export interface PrismSpec extends BuildCommon {
  kind: "prism";
  outline: Pt[];
  base?: number;
  top: number;
}

export interface CylinderSpec extends BuildCommon {
  kind: "cylinder";
  at: Pt;
  radius: number;
  base?: number;
  top: number;
  /** default 16 */
  sides?: number;
}

export interface SphereSpec extends BuildCommon {
  kind: "sphere";
  at: Pt;
  /** z of the middle */
  z: number;
  radius: number;
}

export interface ConeSpec extends BuildCommon {
  kind: "cone";
  at: Pt;
  radius: number;
  base?: number;
  /** z of the apex (or of the top face, with topRadius) */
  top: number;
  topRadius?: number;
  sides?: number;
}

/** A shape of a part: a box, or a profile in a plane run between two levels square to it. */
export type PartShape =
  | { box: [number, number, number, number, number, number] }
  | ({ plane?: "xy" | "xz" | "yz"; from: number; to: number } & ({ outline: [number, number][] } | { rect: [number, number, number, number]; round?: number } | { circle: [number, number, number]; sides?: number }));

/** A product's part (a bracket, a housing, a gear): one closed solid of shapes added, with others cut away. */
export interface PartSpec extends BuildCommon {
  kind: "part";
  add: PartShape[];
  cut?: PartShape[];
}

/** One element of the build tool's list, by kind. Aliases: wall for walls, floor for slab, bush for shrub, stairs for steps. */
export type BuildSpec =
  | WallsSpec
  | WindowSpec
  | DoorSpec
  | SlabSpec
  | RoofSpec
  | ChimneySpec
  | StepsSpec
  | SurfaceSpec
  | HedgeSpec
  | FenceSpec
  | TreeSpec
  | ShrubSpec
  | BoxSpec
  | PrismSpec
  | CylinderSpec
  | SphereSpec
  | ConeSpec
  | PartSpec;

/** A compact reference of every kind, its fields, units and defaults, for the tool's description shown to the LLM. */
export const BUILD_REFERENCE = `Elements are {kind, ...fields}. Millimetres; plan x right, y up; z up from this layer (0 = ground floor level); angles in degrees counter-clockwise from +x. Points {x,y}. Every element takes name, category (its class), color "#rrggbb", group. Errors and notes count elements and openings from 1; segment and edge indices are from 0.
walls: path (centre line), closed false, thickness 300, height 2500, base 0, color, outside "right"|"left" (open paths only), openings [{type window|door|opening, segment + at (along it to the middle) or point (near the wall), width 1000 (door 900), height 1200 (door 2100), sill 900 (door 0), name, + window or door fields}]. Mitred corners; each opening gets piers, a piece under the sill, one over the head, and its window or door.
window (for an existing wall): at + facing (direction it faces out), or a + b (its sides on the wall line, outside on the right of a→b); line "outer"|"centre", wallThickness 300, base 0, width 1000, height 1200, sill 900; style casement|sash|fixed|tilt, panes [cols,rows] per sash (sash default [3,2] = 6-over-6), leaves (casements side by side), frame 60, frameDepth 70 (sash 120), reveal 100, color "#f4f4f0", glassColor, glassOpacity 35, sillBoard true|"stone"|"timber"|false, handles true, lintel false|"stone"|"timber".
door: placed like a window (width 900, height 2100, sill 0); style panel|plank|ledged|glazed|french|double|stable, panes, frame 60, frameDepth 100, reveal 100, leafThickness 45, color (leaf), frameColor, hinge "left"|"right" (seen from outside), handle true, letterbox, knocker, step (true or a height: a stone step outside), lintel.
slab|floor: outline, top 0, thickness 200.
roof: outline (wall line at eaves level, normally the walls' centre lines), eaves 2500 (z of the underside on that line), style gable|hip|half-hip|mono|flat|mansard, pitch 40 (5-75; thatch 50; mansard upper 25), ridge "long"|"short"|angle, overhang 300 past the wall face (thatch 400, flat 0), verge 200 (thatch 50), thickness 200 square to the slope (thatch 400), material tile|slate|thatch|metal|felt (thatch: bevelled eaves, ridge block), gableWalls true, wallThickness 300, wallLine "centre"|"outer", wallColor; mono: rises (direction, default 90) or high (edge index); flat: parapet (height); mansard: lowerPitch 70, lowerHeight 1800; dormers [{at (front middle, on the eaves line or up the slope), width 900, height 900, style gable|flat|eyebrow, windowStyle, windowColor, + window fields}] on rectangles. Rectangles are exact; L, T and U outlines get intersecting roofs, other convex ones a hipped roof, anything else a flat one.
chimney: at + size [600,450] + angle, or outline; base 0, top (needed), color, cap true, pots 1 (0-4), potColor.
steps: at (front middle of the bottom step), angle (direction it rises toward), width 1000, count 3, rise 170, going 280, base 0, landing 0.
lawn|paving|patio|path|driveway|gravel|planting|water|decking|ground: outline, or path + width 1000 (driveway 3000); top staggered so one laid on another shows (ground -30, lawn 0, planting 5, gravel and water 10, path 15, paving, patio and driveway 20, decking 150), thickness, edging (true or {width 100, height 50, color}).
hedge: path, closed, width 600, height 1500, base 0.
fence: path, closed, style panel|picket|post-and-rail|close-board, height 1800 (picket 1000, post-and-rail 1200), postSpacing 1800, base 0.
tree: at, type deciduous|conifer|fruit, height 6000, spread 4000, base 0, color, trunkColor. shrub|bush: at, size 1200 or [diameter, height], base 0.
box: at (middle), size [x,y,z], base 0, angle 0. prism: outline, base 0, top. cylinder: at, radius, base 0, top, sides 16. sphere: at, z, radius. cone: at, radius, base 0, top (apex), topRadius 0, sides 16.
part (products, machines, anything 3D printed or machined): one closed solid (a mesh, which exports to STL watertight) made of add shapes joined, with cut shapes taken away (holes, slots, pockets, recesses, bores). add (needed) and cut are lists of shapes: {box: [x0,y0,z0,x1,y1,z1]}, or a profile in a plane extruded square to it: {plane "xy"|"xz"|"yz" (default xy), from, to (along z for xy, y for xz, x for yz), and outline [[u,v],...] | rect [u0,v0,u1,v1] + round (corner radius) | circle [u,v,radius] + sides 32}, u and v being the plane's own axes (xy: x,y; xz: x,z; yz: y,z): a shaft along x is a circle in yz. Cuts run a little past the faces they open. One part per element, in class Parts unless category says; give each its name and color.`;

// ---- small geometry ------------------------------------------------------------------------

type V3 = [number, number, number];
type Json = Readonly<Record<string, unknown>>;

const P = (x: number, y: number): Pt => ({ x, y });
const add = (a: Pt, b: Pt): Pt => P(a.x + b.x, a.y + b.y);
const sub = (a: Pt, b: Pt): Pt => P(a.x - b.x, a.y - b.y);
const mul = (a: Pt, k: number): Pt => P(a.x * k, a.y * k);
const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const len = (a: Pt): number => Math.hypot(a.x, a.y);
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Pt): Pt => mul(a, 1 / (len(a) || 1));
/** a quarter turn counter-clockwise: the left-hand normal of a direction */
const left = (a: Pt): Pt => P(-a.y, a.x);
const rad = (deg: number): number => (deg * Math.PI) / 180;
const toward = (deg: number): Pt => P(Math.cos(rad(deg)), Math.sin(rad(deg)));
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const r3 = (v: number): number => Math.round(v * 1000) / 1000 || 0;
const fmt = (v: number): string => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
const det3 = (a: V3, b: V3, c: V3): number =>
  a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);

function signedArea(poly: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

const ccwLoop = (poly: readonly Pt[]): Pt[] => (signedArea(poly) < 0 ? [...poly].reverse() : [...poly]);

/** The loop without repeated corners (a closing repeat included) or corners within `tol` of a straight line. */
function tidy(poly: readonly Pt[], tol = 0.5): Pt[] {
  let pts = poly.filter((p, i) => dist(p, poly[(i + 1) % poly.length]) > tol);
  for (let changed = true; changed && pts.length > 3; ) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      const ac = dist(a, c);
      const off = ac > 0 ? Math.abs(cross(sub(c, a), sub(b, a))) / ac : dist(a, b);
      if (off <= tol || dist(a, c) < tol) {
        pts = pts.filter((_, j) => j !== i);
        changed = true;
        i--;
      }
    }
  }
  return pts.length >= 3 ? pts.filter((p, i) => dist(p, pts[(i + 1) % pts.length]) > tol) : pts;
}

function segmentsMeet(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const eps = 1e-9 * Math.max(1, dist(a, b) * dist(c, d));
  const d1 = cross(sub(b, a), sub(c, a));
  const d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c));
  const d4 = cross(sub(d, c), sub(b, c));
  if (((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) && ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))) return true;
  const within = (p: Pt, q: Pt, r: Pt): boolean => Math.min(p.x, q.x) - 1e-9 <= r.x && r.x <= Math.max(p.x, q.x) + 1e-9 && Math.min(p.y, q.y) - 1e-9 <= r.y && r.y <= Math.max(p.y, q.y) + 1e-9;
  return (
    (Math.abs(d1) <= eps && within(a, b, c)) ||
    (Math.abs(d2) <= eps && within(a, b, d)) ||
    (Math.abs(d3) <= eps && within(c, d, a)) ||
    (Math.abs(d4) <= eps && within(c, d, b))
  );
}

/** Whether no two edges of the loop cross or touch, other than neighbours at their shared corner. */
function isSimple(poly: readonly Pt[]): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsMeet(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return false;
    }
  }
  return true;
}

function isConvex(poly: readonly Pt[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const c = poly[(i + 2) % n];
    if (cross(sub(b, a), sub(c, b)) < -1e-6 * dist(a, b) * dist(b, c)) return false;
  }
  return true;
}

/** The part of a convex loop where a·x + b·y + c ≤ 0. */
function clip(poly: readonly Pt[], a: number, b: number, c: number): Pt[] {
  const k = Math.hypot(a, b);
  if (k < 1e-12) return c > 0 ? [] : [...poly];
  const f = (p: Pt): number => {
    const v = (a * p.x + b * p.y + c) / k;
    return Math.abs(v) < 1e-7 ? 0 : v;
  };
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const fp = f(p);
    const fq = f(q);
    if (fp <= 0) out.push(p);
    if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) {
      const t = fp / (fp - fq);
      out.push(P(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t));
    }
  }
  return out;
}

/** A convex loop less a convex hole (where every half-plane a·x + b·y + c ≤ 0 holds), as convex pieces. */
function subtract(poly: readonly Pt[], hole: readonly (readonly [number, number, number])[]): Pt[][] {
  const out: Pt[][] = [];
  let rest: Pt[] = [...poly];
  for (const [a, b, c] of hole) {
    const outside = clip(rest, -a, -b, -c);
    if (outside.length >= 3 && Math.abs(signedArea(outside)) > 1) out.push(outside);
    rest = clip(rest, a, b, c);
    if (rest.length < 3) break;
  }
  return out;
}

/** Where the line through p along d meets the line through q along e (null when parallel). */
function meet(p: Pt, d: Pt, q: Pt, e: Pt): Pt | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  return add(p, mul(d, cross(sub(q, p), e) / den));
}

/** A counter-clockwise loop with edge i moved out by dists[i] (in by a negative one), mitred; null if that folds it. */
function offsetLoop(poly: readonly Pt[], dists: readonly number[]): Pt[] | null {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const d = unit(sub(poly[(i + 1) % n], p));
    return { p: add(p, mul(P(d.y, -d.x), dists[i])), d };
  });
  const out = lines.map((b, k) => {
    const a = lines[(k + n - 1) % n];
    return meet(a.p, a.d, b.p, b.d) ?? b.p;
  });
  for (let i = 0; i < n; i++) if (dot(sub(out[(i + 1) % n], out[i]), lines[i].d) <= 0) return null;
  return isSimple(out) && signedArea(out) > 0 ? out : null;
}

/** A polyline moved `d` to its left (right when negative), mitred at its corners. */
function offsetLine(path: readonly Pt[], d: number): Pt[] {
  const n = path.length;
  const dirs = path.slice(0, -1).map((p, i) => unit(sub(path[i + 1], p)));
  return path.map((p, i) => {
    if (i === 0) return add(p, mul(left(dirs[0]), d));
    if (i === n - 1) return add(p, mul(left(dirs[n - 2]), d));
    const a = dirs[i - 1];
    const b = dirs[i];
    const m = dot(a, b) > -0.95 ? meet(add(p, mul(left(a), d)), a, add(p, mul(left(b), d)), b) : null;
    return m ?? add(p, mul(left(b), d));
  });
}

function pointInLoop(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A rectangle w along `angle` by d across, centred on c, counter-clockwise. */
function rectAround(c: Pt, w: number, d: number, angle: number): Pt[] {
  const u = toward(angle);
  const v = left(u);
  const at = (s: number, t: number): Pt => add(c, add(mul(u, s), mul(v, t)));
  return [at(-w / 2, -d / 2), at(w / 2, -d / 2), at(w / 2, d / 2), at(-w / 2, d / 2)];
}

/** A regular polygon round c, counter-clockwise. */
function circle(c: Pt, r: number, n: number, phase = 0): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const a = phase + (2 * Math.PI * i) / n;
    return P(c.x + r * Math.cos(a), c.y + r * Math.sin(a));
  });
}

// ---- parts ----------------------------------------------------------------------------------

/** An upright prism, or null when the outline or the height comes to nothing. */
function prismOf(outline: readonly Pt[], z0: number, z1: number): Shape | null {
  const o = tidy(outline, 0.01);
  if (o.length < 3 || !(z1 - z0 > 0.05) || Math.abs(signedArea(o)) < 0.5) return null;
  return { kind: "prism", outline: ccwLoop(o).map((p) => P(r3(p.x), r3(p.y))), z0: r3(z0), z1: r3(z1) };
}

const same3 = (a: V3, b: V3): boolean => Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7 && Math.abs(a[2] - b[2]) < 1e-7;

/** A face of more than ten corners as a fan of faces of ten or fewer, sharing its first corner. */
function fan(face: readonly V3[]): V3[][] {
  if (face.length <= 10) return [[...face]];
  const out: V3[][] = [];
  for (let i = 1; i < face.length - 1; i += 8) out.push([face[0], ...face.slice(i, Math.min(i + 9, face.length))]);
  return out;
}

/**
 * A closed mesh from faces that are consistently wound (all outward or all inward): repeated
 * corners are dropped, faces that vanish with them go, long faces are fanned, and the whole is
 * turned outward if its volume comes out negative.
 */
function meshOf(faces: readonly (readonly V3[])[]): Shape | null {
  const loops: V3[][] = [];
  for (const f of faces) {
    const g = f.filter((p, i) => !same3(p, f[(i + 1) % f.length]));
    if (g.length >= 3) loops.push(...fan(g));
  }
  if (loops.length < 4) return null;
  let vol = 0;
  for (const g of loops) for (let i = 1; i + 1 < g.length; i++) vol += det3(g[0], g[i], g[i + 1]);
  if (Math.abs(vol) < 1e-3) return null;
  if (vol < 0) for (const g of loops) g.reverse();
  return { kind: "mesh", faces: loops.map((g) => g.flatMap((p) => [r3(p[0]), r3(p[1]), r3(p[2])])) };
}

/** The faces of a solid between two loops whose corners correspond, wound alike (a prismoid). */
function loft(a: readonly V3[], b: readonly V3[]): V3[][] {
  const n = a.length;
  const faces: V3[][] = [[...a].reverse(), [...b]];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([a[i], a[j], b[j], b[i]]);
  }
  return faces;
}

/**
 * A window's or door's own axes: s along the wall, to the right seen from outside, with 0 at the
 * opening's middle; n out of the wall's outer face (0 on it, negative into the wall); z up from
 * the frame's height.
 */
interface Frame {
  o: Pt;
  s: Pt;
  n: Pt;
  z: number;
}
const fpt = (f: Frame, s: number, n: number): Pt => add(f.o, add(mul(f.s, s), mul(f.n, n)));
const fv3 = (f: Frame, s: number, n: number, z: number): V3 => {
  const p = fpt(f, s, n);
  return [p.x, p.y, f.z + z];
};
/** A box in a frame, as an upright prism. */
function fbox(f: Frame, s0: number, s1: number, n0: number, n1: number, z0: number, z1: number): Shape | null {
  return prismOf([fpt(f, s0, n0), fpt(f, s1, n0), fpt(f, s1, n1), fpt(f, s0, n1)], f.z + Math.min(z0, z1), f.z + Math.max(z0, z1));
}
/** A convex profile in a frame's s-z plane run across from n0 to n1. */
function fprofile(f: Frame, prof: readonly (readonly [number, number])[], n0: number, n1: number): Shape | null {
  return meshOf(loft(prof.map(([s, z]) => fv3(f, s, n0, z)), prof.map(([s, z]) => fv3(f, s, n1, z))));
}

// ---- reading the agent's JSON -------------------------------------------------------------------

const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Checked access to one element's (or one opening's) fields; every error names where it is and the field. */
interface Reader {
  readonly where: string;
  has(key: string): boolean;
  fail(message: string): never;
  /** a number within [lo, hi], `def` when absent (undefined: the field is needed) */
  num(key: string, def: number | undefined, lo: number, hi: number, unit?: string): number;
  int(key: string, def: number, lo: number, hi: number): number;
  bool(key: string, def: boolean): boolean;
  pick<T extends string>(key: string, options: readonly T[], def: T): T;
  /** false, or one of the options (true meaning the first) */
  flag<T extends string>(key: string, options: readonly T[], def: false | T): false | T;
  color(key: string, def: string): string;
  text(key: string): string | undefined;
  pt(key: string): Pt;
  pts(key: string, min: number): Pt[];
  /** a number for every component, or a list of them */
  size(key: string, def: readonly number[], lo: number, hi: number): number[];
  panes(key: string, def: [number, number]): [number, number];
  list(key: string): Json[];
  raw(key: string): unknown;
  unused(): string[];
}

function reader(o: Json, where: string): Reader {
  const used = new Set<string>(["kind"]);
  const fail = (message: string): never => {
    throw new Error(`${where}: ${message}`);
  };
  const raw = (key: string): unknown => {
    used.add(key);
    return o[key] ?? undefined;
  };
  const point = (v: unknown, what: string): Pt => {
    if (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])) return P(v[0], v[1]);
    if (isObj(v) && isNum(v.x) && isNum(v.y)) return P(v.x, v.y);
    return fail(`${what} must be a point {x, y} in millimetres`);
  };
  return {
    where,
    has: (key) => o[key] !== undefined && o[key] !== null,
    fail,
    raw,
    num(key, def, lo, hi, unit = "") {
      const v = raw(key);
      if (v === undefined || v === null) return def === undefined ? fail(`${key} is needed (a number${unit === "°" ? " of degrees" : unit ? " of millimetres" : ""})`) : def;
      if (!isNum(v)) return fail(`${key} must be a number`);
      if (v < lo || v > hi) return fail(`${key} must be between ${fmt(lo)} and ${fmt(hi)}${unit}`);
      return v;
    },
    int(key, def, lo, hi) {
      const v = raw(key);
      if (v === undefined || v === null) return def;
      if (!isNum(v) || !Number.isInteger(v)) return fail(`${key} must be a whole number`);
      if (v < lo || v > hi) return fail(`${key} must be between ${lo} and ${hi}`);
      return v;
    },
    bool(key, def) {
      const v = raw(key);
      if (v === undefined || v === null) return def;
      if (typeof v !== "boolean") return fail(`${key} must be true or false`);
      return v;
    },
    pick(key, options, def) {
      const v = raw(key);
      if (v === undefined || v === null) return def;
      const hit = typeof v === "string" ? options.find((x) => x === v.toLowerCase()) : undefined;
      return hit ?? fail(`${key} must be one of ${options.join(", ")}`);
    },
    flag(key, options, def) {
      const v = raw(key);
      if (v === undefined || v === null) return def;
      if (v === false) return false;
      if (v === true) return options[0];
      const hit = typeof v === "string" ? options.find((x) => x === v.toLowerCase()) : undefined;
      return hit ?? fail(`${key} must be true, false or one of ${options.join(", ")}`);
    },
    color(key, def) {
      const v = raw(key);
      if (v === undefined || v === null) return def;
      if (typeof v !== "string" || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return fail(`${key} must be a colour "#rrggbb"`);
      const h = v.toLowerCase();
      return h.length === 4 ? `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}` : h;
    },
    text(key) {
      const v = raw(key);
      if (v === undefined || v === null) return undefined;
      if (typeof v !== "string" || !v.trim()) return fail(`${key} must be a non-empty string`);
      return v.trim();
    },
    pt(key) {
      const v = raw(key);
      if (v === undefined || v === null) return fail(`${key} is needed (a point {x, y})`);
      return point(v, key);
    },
    pts(key, min) {
      const v = raw(key);
      if (v === undefined || v === null) return fail(`${key} is needed (a list of at least ${min} points {x, y})`);
      if (!Array.isArray(v)) return fail(`${key} must be a list of points {x, y}`);
      const out = v.map((p, i) => point(p, `${key}[${i}]`));
      if (out.length < min) return fail(`${key} needs at least ${min} points`);
      return out;
    },
    size(key, def, lo, hi) {
      const v = raw(key);
      if (v === undefined || v === null) return [...def];
      const list = isNum(v) ? def.map(() => v) : Array.isArray(v) && v.length === def.length && v.every(isNum) ? (v as number[]) : null;
      if (!list) return fail(`${key} must be a number or a list of ${def.length} numbers`);
      if (list.some((x) => x < lo || x > hi)) return fail(`${key} must be between ${fmt(lo)} and ${fmt(hi)} mm`);
      return list;
    },
    panes(key, def) {
      const v = raw(key);
      if (v === undefined || v === null) return def;
      let pair: unknown[] | null = Array.isArray(v) ? v : null;
      if (typeof v === "string") pair = v.split(/[x×*]/i).map((s) => Number(s.trim()));
      if (isObj(v)) pair = [v.cols ?? v.columns, v.rows];
      if (!pair || pair.length !== 2 || !pair.every((x) => isNum(x) && Number.isInteger(x) && x >= 1 && x <= 12)) {
        return fail(`${key} must be [columns, rows], whole numbers from 1 to 12`);
      }
      return [pair[0] as number, pair[1] as number];
    },
    list(key) {
      const v = raw(key);
      if (v === undefined || v === null) return [];
      if (!Array.isArray(v) || !v.every(isObj)) return fail(`${key} must be a list of objects`);
      return v;
    },
    unused: () => Object.keys(o).filter((k) => !used.has(k) && o[k] !== undefined),
  };
}

interface Ctx {
  parts: BuildPart[];
  notes: string[];
  counts: Map<string, number>;
  groups: Set<string>;
}

/** Where one element's parts go, with its name, category and group applied. */
interface Out {
  readonly where: string;
  /** the name the agent gave the element, if any */
  readonly name: string | undefined;
  /** the element's own name: the agent's, or the next of `base` ("Window 3") */
  own(base: string): string;
  /** the next of `base`, for things inside an element (the windows in a run of walls) */
  next(base: string): string;
  /** a group key for the things named `label`, unique in the build unless the agent gave one */
  group(label: string): string;
  add(category: string, name: string, color: string, shape: Shape | null, group?: string, opacity?: number): void;
  note(text: string): void;
}

function output(ctx: Ctx, r: Reader): Out {
  const name = r.text("name");
  const category = r.text("category");
  const shared = r.text("group");
  if (shared) ctx.groups.add(shared);
  const keys = new Map<string, string>();
  const next = (base: string): string => {
    const n = (ctx.counts.get(base) ?? 0) + 1;
    ctx.counts.set(base, n);
    return `${base} ${n}`;
  };
  return {
    where: r.where,
    name,
    own: (base) => name ?? next(base),
    next,
    group(label) {
      if (shared) return shared;
      let key = keys.get(label);
      if (!key) {
        key = label;
        for (let i = 2; ctx.groups.has(key); i++) key = `${label} (${i})`;
        ctx.groups.add(key);
        keys.set(label, key);
      }
      return key;
    },
    add(cat, partName, color, shape, group, opacity) {
      if (!shape) return;
      const part: BuildPart = { category: category ?? cat, name: partName, color, shape };
      const g = shared ?? group;
      if (g) part.group = g;
      if (opacity !== undefined && opacity < 100) part.opacity = Math.round(opacity);
      ctx.parts.push(part);
    },
    note: (text) => ctx.notes.push(`${r.where}: ${text}`),
  };
}

// ---- colours ---------------------------------------------------------------------------------

const WALL_COLOR = "#e9e4d8";
const FRAME_COLOR = "#f4f4f0";
const GLASS_COLOR = "#a9c7d6";
const STONE = "#d8d2c4";
const TIMBER = "#6b4a2f";
const OAK = "#8a6a48";
const MATERIALS = ["tile", "slate", "thatch", "metal", "felt"] as const;
type Material = (typeof MATERIALS)[number];
const ROOF_COLORS: Record<Material, string> = { tile: "#8c4a32", slate: "#4a4f55", thatch: "#b38f55", metal: "#6d7479", felt: "#2f3133" };

// ---- walls ---------------------------------------------------------------------------------

/** One straight run of a wall: its centre line, and where its faces start and end along it (mitres make them differ). */
interface Run {
  a: Pt;
  u: Pt;
  len: number;
  l0: number;
  l1: number;
  r0: number;
  r1: number;
}

/** The runs along a centre line, mitred where they meet; very sharp corners are squared off instead. */
function wallRuns(path: readonly Pt[], closed: boolean, t: number): { runs: Run[]; squared: number } {
  const m = path.length;
  const n = closed ? m : m - 1;
  const runs: Run[] = [];
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % m];
    const L = dist(a, b);
    runs.push({ a, u: unit(sub(b, a)), len: L, l0: 0, l1: L, r0: 0, r1: L });
  }
  let squared = 0;
  for (let k = closed ? 0 : 1; k < (closed ? m : m - 1); k++) {
    const p = runs[(k + n - 1) % n];
    const q = runs[k];
    const c = dot(p.u, q.u);
    if (c > 1 - 1e-9) continue;
    if (c < -0.966) {
      squared++;
      continue;
    }
    for (const side of [1, -1]) {
      const pm = add(p.a, mul(left(p.u), (side * t) / 2));
      const qm = add(q.a, mul(left(q.u), (side * t) / 2));
      const x = meet(pm, p.u, qm, q.u);
      if (!x) continue;
      const sp = dot(sub(x, p.a), p.u);
      const sq = dot(sub(x, q.a), q.u);
      if (side > 0) {
        p.l1 = sp;
        q.l0 = sq;
      } else {
        p.r1 = sp;
        q.r0 = sq;
      }
    }
  }
  return { runs, squared };
}

/** A run's footprint between two distances along its centre line (either may be infinite). */
function runPiece(r: Run, t: number, c0: number, c1: number): Pt[] {
  const n = left(r.u);
  const at = (s: number, side: number): Pt => add(add(r.a, mul(r.u, s)), mul(n, (side * t) / 2));
  let quad = [at(r.r0, -1), at(r.r1, -1), at(r.l1, 1), at(r.l0, 1)];
  if (Number.isFinite(c0)) quad = clip(quad, -r.u.x, -r.u.y, dot(r.a, r.u) + c0);
  if (Number.isFinite(c1)) quad = clip(quad, r.u.x, r.u.y, -dot(r.a, r.u) - c1);
  return quad;
}

/** The straight part of a run, clear of the corners at its ends. */
const clearOf = (r: Run): [number, number] => [Math.max(r.l0, r.r0, 0), Math.min(r.l1, r.r1, r.len)];

/** A path's points with repeats dropped; a last point back on the first closes it. */
function pathOf(r: Reader, key: string, closedDef: boolean): { path: Pt[]; closed: boolean } {
  const raw = r.pts(key, 2);
  let closed = r.bool("closed", closedDef);
  let path = raw.filter((p, i) => i === 0 || dist(p, raw[i - 1]) > 0.5);
  if (path.length > 2 && dist(path[0], path[path.length - 1]) <= 0.5) {
    path = path.slice(0, -1);
    closed = true;
  }
  if (path.length < 2 || (closed && path.length < 3)) r.fail(`${key} needs at least ${closed ? 3 : 2} distinct points`);
  return { path, closed };
}

interface Placed {
  k: number;
  q: Reader;
  type: "window" | "door" | "opening";
  seg: number;
  s0: number;
  s1: number;
  w: number;
  h: number;
  sill: number;
}

function buildWalls(r: Reader, out: Out): void {
  const { path, closed } = pathOf(r, "path", false);
  const t = r.num("thickness", 300, 20, 3000, " mm");
  const height = r.num("height", 2500, 50, 100_000, " mm");
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const color = r.color("color", WALL_COLOR);
  // +1: outside is on the left of the path's direction, -1: on its right
  const outSide = closed ? (signedArea(path) > 0 ? -1 : 1) : r.pick("outside", ["right", "left"] as const, "right") === "right" ? -1 : 1;
  const { runs, squared } = wallRuns(path, closed, t);
  if (squared) out.note(`${squared} very sharp corner${squared === 1 ? " was" : "s were"} squared off rather than mitred`);

  const placed: Placed[] = r.list("openings").map((o, k) => {
    const q = reader(o, `${r.where}, opening ${k + 1}`);
    const type = q.pick("type", ["window", "door", "opening"] as const, "window");
    const w = q.num("width", type === "window" ? 1000 : 900, 100, 50_000, " mm");
    const h = q.num("height", type === "window" ? 1200 : 2100, 100, 50_000, " mm");
    const sill = q.num("sill", type === "window" ? 900 : 0, 0, 50_000, " mm");
    if (sill + h > height + 0.5) q.fail(`sill + height (${fmt(sill + h)}) is above the wall's height of ${fmt(height)}`);
    let seg: number;
    let at: number;
    if (q.has("point")) {
      const p = q.pt("point");
      const nearest = (): number => {
        let best = 0;
        let bestD = Infinity;
        runs.forEach((run, i) => {
          const s = clamp(dot(sub(p, run.a), run.u), 0, run.len);
          const d = dist(p, add(run.a, mul(run.u, s)));
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        });
        return best;
      };
      seg = q.has("segment") ? q.int("segment", 0, 0, runs.length - 1) : nearest();
      at = clamp(dot(sub(p, runs[seg].a), runs[seg].u), 0, runs[seg].len);
    } else if (q.has("at")) {
      if (!q.has("segment") && runs.length > 1) q.fail("give segment (from 0) with at, or a point near the wall");
      seg = q.int("segment", 0, 0, runs.length - 1);
      at = q.num("at", undefined, -1e6, 1e6, " mm");
    } else {
      return q.fail("needs at (with segment) or point, to place it on the wall");
    }
    const run = runs[seg];
    const [c0, c1] = clearOf(run);
    if (w > c1 - c0 + 0.5) {
      q.fail(`the ${type} is ${fmt(w)} wide, wider than the ${fmt(Math.max(0, c1 - c0))} of straight wall on segment ${seg} between its corners`);
    }
    let s0 = at - w / 2;
    if (s0 < c0 - 0.5 || s0 + w > c1 + 0.5) {
      const moved = clamp(s0, c0, c1 - w);
      out.note(`opening ${k + 1} ran past the end of segment ${seg} or into its corner, so it was moved ${fmt(Math.abs(moved - s0))} along it (its middle is now at ${fmt(moved + w / 2)})`);
      s0 = moved;
    }
    return { k, q, type, seg, s0, s1: s0 + w, w, h, sill };
  });

  runs.forEach((run, i) => {
    const list = placed.filter((p) => p.seg === i).sort((a, b) => a.s0 - b.s0);
    for (let j = 1; j < list.length; j++) {
      const p = list[j - 1];
      const q = list[j];
      if (q.s0 < p.s1 - 0.5) {
        r.fail(`openings ${p.k + 1} and ${q.k + 1} overlap on segment ${i} (${fmt(p.s0)} to ${fmt(p.s1)} and ${fmt(q.s0)} to ${fmt(q.s1)} along it)`);
      }
    }
    const name = out.name ? (runs.length === 1 ? out.name : `${out.name} ${i + 1}`) : out.next("Wall");
    if (!list.length) {
      out.add("Walls", name, color, prismOf(runPiece(run, t, -Infinity, Infinity), base, base + height));
      return;
    }
    const g = out.group(name);
    const [c0, c1] = clearOf(run);
    let from = -Infinity;
    let pier = 0;
    list.forEach((p, j) => {
      out.add("Walls", `${name} pier ${++pier}`, color, prismOf(runPiece(run, t, from, p.s0), base, base + height), g);
      const column = runPiece(run, t, p.s0, p.s1);
      const label = p.type === "opening" ? `opening ${p.k + 1}` : (p.q.text("name") ?? out.next(p.type === "door" ? "Door" : "Window"));
      if (p.sill > 0.5) out.add("Walls", `${name} below ${label}`, color, prismOf(column, base, base + p.sill), g);
      if (p.sill + p.h < height - 0.5) out.add("Walls", `${name} above ${label}`, color, prismOf(column, base + p.sill + p.h, base + height), g);
      if (p.type !== "opening") {
        const nOut = mul(left(run.u), outSide);
        const f: Frame = { o: add(add(run.a, mul(run.u, (p.s0 + p.s1) / 2)), mul(nOut, t / 2)), s: left(nOut), n: nOut, z: base + p.sill };
        const before = j > 0 ? list[j - 1].s1 : c0;
        const after = j + 1 < list.length ? list[j + 1].s0 : c1;
        const hole: Hole = { f, w: p.w, h: p.h, t, horn: Math.max(0, Math.min(p.s0 - before, after - p.s1)), above: height - p.sill - p.h, label };
        (p.type === "door" ? doorIn : windowIn)(p.q, hole, out);
      }
      from = p.s1;
    });
    out.add("Walls", `${name} pier ${++pier}`, color, prismOf(runPiece(run, t, from, Infinity), base, base + height), g);
  });
  for (const p of placed) {
    const extra = p.q.unused();
    if (extra.length) out.note(`opening ${p.k + 1}: ignored ${extra.join(", ")}, which ${extra.length === 1 ? "doesn't" : "don't"} apply here`);
  }
}

// ---- windows and doors ---------------------------------------------------------------------------

/** An opening for a window or door to fill. */
interface Hole {
  f: Frame;
  w: number;
  h: number;
  /** the wall's thickness */
  t: number;
  /** how far sills and lintels may run past the sides of the opening */
  horn: number;
  /** wall above the head, for a lintel */
  above: number;
  label: string;
}

const WINDOW_STYLES = ["casement", "sash", "fixed", "tilt"] as const;
const DOOR_STYLES = ["panel", "plank", "ledged", "glazed", "french", "double", "stable"] as const;

/** Frame width, depth and set-back fitted to the wall; a note only when the agent asked for what didn't fit. */
function fitFrame(q: Reader, out: Out, hole: Hole, defDepth: number, minDepth: number): { F: number; D: number; R: number } {
  let F = q.num("frame", 60, 15, 400, " mm");
  let D = Math.max(minDepth, q.num("frameDepth", defDepth, 15, 1000, " mm"));
  let R = q.num("reveal", 100, 0, 2000, " mm");
  const maxF = Math.min(hole.w, hole.h) / 5;
  if (F > maxF) {
    if (q.has("frame")) out.note(`${hole.label}: the frame was narrowed to ${fmt(maxF)} to leave room for the glass`);
    F = maxF;
  }
  if (D > hole.t) D = hole.t;
  if (R + D > hole.t) {
    const fit = Math.max(0, hole.t - D);
    if (q.has("reveal")) out.note(`${hole.label}: the reveal was cut to ${fmt(fit)} to fit the ${fmt(hole.t)} wall`);
    R = fit;
  }
  return { F, D, R };
}

/** Glazing bars over a pane: cols × rows panes, bars 20 wide. */
function bars(f: Frame, sa: number, sb: number, za: number, zb: number, n0: number, n1: number, cols: number, rows: number): Shape[] {
  const out: (Shape | null)[] = [];
  for (let i = 1; i < cols; i++) {
    const s = sa + ((sb - sa) * i) / cols;
    out.push(fbox(f, s - 10, s + 10, n0, n1, za, zb));
  }
  for (let j = 1; j < rows; j++) {
    const z = za + ((zb - za) * j) / rows;
    out.push(fbox(f, sa, sb, n0, n1, z - 10, z + 10));
  }
  return out.filter((s): s is Shape => !!s);
}

function windowIn(q: Reader, hole: Hole, out: Out): void {
  const { f, w, h, label } = hole;
  const style = q.pick("style", WINDOW_STYLES, "casement");
  const color = q.color("color", FRAME_COLOR);
  const glass = q.color("glassColor", GLASS_COLOR);
  const opacity = q.num("glassOpacity", 35, 0, 100);
  const metal = q.color("metalColor", "#b9b9b4");
  const [cols, rows] = q.panes("panes", style === "sash" ? [3, 2] : [1, 1]);
  let leaves = style === "sash" ? 1 : q.int("leaves", w <= 900 ? 1 : w <= 1800 ? 2 : 3, 1, 8);
  const sill = q.flag("sillBoard", ["stone", "timber"] as const, "stone");
  const handles = q.bool("handles", style !== "fixed");
  const lintel = q.flag("lintel", ["stone", "timber"] as const, false);
  const { F, D, R } = fitFrame(q, out, hole, style === "sash" ? 120 : 70, style === "sash" ? 60 : 30);
  const g = out.group(label);
  const part = (name: string, c: string, shape: Shape | null, category = "Windows", op?: number): void => out.add(category, `${label} ${name}`, c, shape, g, op);
  const nF0 = -R - D;
  const nF1 = -R;

  part("frame", color, fbox(f, -w / 2, w / 2, nF0, nF1, h - F, h));
  part("frame", color, fbox(f, -w / 2, w / 2, nF0, nF1, 0, F));
  part("frame", color, fbox(f, -w / 2, -w / 2 + F, nF0, nF1, F, h - F));
  part("frame", color, fbox(f, w / 2 - F, w / 2, nF0, nF1, F, h - F));
  const z0 = F;
  const z1 = h - F;
  const inner = w - 2 * F;
  if ((inner - (leaves - 1) * F) / leaves < 200) {
    const fit = Math.max(1, Math.floor((inner + F) / (200 + F)));
    if (q.has("leaves")) out.note(`${label}: ${leaves} leaves don't fit ${fmt(w)}, so it has ${fit}`);
    leaves = fit;
  }
  const lw = (inner - (leaves - 1) * F) / leaves;
  const lights: [number, number][] = [];
  for (let i = 0; i < leaves; i++) {
    const sa = -w / 2 + F + i * (lw + F);
    lights.push([sa, sa + lw]);
    if (i + 1 < leaves) part("mullion", color, fbox(f, sa + lw, sa + lw + F, nF0, nF1, z0, z1));
  }
  const SF = Math.max(25, Math.min(Math.round(F * 0.75), lw / 5));

  /** A sash: its frame of members, a pane of glass and the glazing bars. */
  const sash = (sa: number, sb: number, za: number, zb: number, n0: number, n1: number, top: number, bottom: number): void => {
    part("sash", color, fbox(f, sa, sb, n0, n1, zb - top, zb));
    part("sash", color, fbox(f, sa, sb, n0, n1, za, za + bottom));
    part("sash", color, fbox(f, sa, sa + SF, n0, n1, za + bottom, zb - top));
    part("sash", color, fbox(f, sb - SF, sb, n0, n1, za + bottom, zb - top));
    const nm = (n0 + n1) / 2;
    part("glass", glass, fbox(f, sa + SF, sb - SF, nm - 3, nm + 3, za + bottom, zb - top), "Glazing", opacity);
    for (const b of bars(f, sa + SF, sb - SF, za + bottom, zb - top, n0 + 6, n1 - 6, cols, rows)) part("glazing bar", color, b);
  };
  /** A lever on the inner face of a sash at s, its handle pointing down. */
  const lever = (s: number, z: number, face: number): void => {
    part("handle", metal, fbox(f, s - 14, s + 14, face - 10, face, z - 35, z + 35));
    part("handle", metal, fbox(f, s - 10, s + 10, face - 38, face - 10, z - 90, z + 10));
  };

  if (style === "fixed") {
    for (const [sa, sb] of lights) {
      const nm = (nF0 + nF1) / 2;
      part("glass", glass, fbox(f, sa, sb, nm - 3, nm + 3, z0, z1), "Glazing", opacity);
      for (const b of bars(f, sa, sb, z0, z1, nm - 15, nm + 15, cols, rows)) part("glazing bar", color, b);
    }
  } else if (style === "sash") {
    const SD = Math.max(20, (D - 25) / 2);
    const nU1 = -R - 8;
    const nU0 = nU1 - SD;
    const nL1 = nU0 - 5;
    const nL0 = nL1 - SD;
    const [sa, sb] = lights[0];
    const zm = (z0 + z1) / 2;
    const MR = 40;
    sash(sa, sb, zm - MR / 2, z1, nU0, nU1, SF, MR);
    sash(sa, sb, z0, zm + MR / 2, nL0, nL1, MR, Math.max(SF, 70));
    if (handles) {
      part("fastener", metal, fbox(f, -35, 35, nL0 + 5, nU0 + 15, zm + MR / 2, zm + MR / 2 + 15));
      for (const side of [-1, 1]) {
        const s = (side * (sb - sa)) / 4;
        part("sash lift", metal, fbox(f, s - 25, s + 25, nL0 - 22, nL0, z0 + 20, z0 + 55));
      }
    }
  } else {
    const SD = Math.max(20, D - 20);
    const nS1 = -R - 8;
    const nS0 = nS1 - SD;
    lights.forEach(([sa, sb], i) => {
      sash(sa, sb, z0, z1, nS0, nS1, SF, SF);
      // the first leaf is hung on its left, the last (when there are more) on its right; any between are fixed
      const hs = i === 0 ? sb - SF / 2 : i === leaves - 1 ? sa + SF / 2 : NaN;
      if (handles && Number.isFinite(hs)) lever(hs, z0 + Math.min((z1 - z0) / 2, 700), nS0);
    });
  }

  if (sill) {
    const horn = Math.min(hole.horn, sill === "stone" ? 50 : 25);
    part("sill", sill === "stone" ? STONE : color, fbox(f, -w / 2 - horn, w / 2 + horn, nF1, 45, sill === "stone" ? -60 : -25, 15));
  }
  if (lintel && hole.above >= 50) {
    const horn = Math.min(hole.horn, 150);
    part("lintel", lintel === "stone" ? STONE : TIMBER, fbox(f, -w / 2 - horn, w / 2 + horn, -Math.min(hole.t, 150), 10, h, h + Math.min(150, hole.above)));
  }
}

function doorIn(q: Reader, hole: Hole, out: Out): void {
  const { f, w, h, label } = hole;
  const style = q.pick("style", DOOR_STYLES, "panel");
  const boarded = style === "plank" || style === "ledged" || style === "stable";
  const pair = style === "french" || style === "double";
  const leafColor = q.color("color", pair ? FRAME_COLOR : boarded ? OAK : "#2f4a3a");
  const frameColor = q.color("frameColor", FRAME_COLOR);
  const glass = q.color("glassColor", GLASS_COLOR);
  const opacity = q.num("glassOpacity", 35, 0, 100);
  const metal = q.color("metalColor", "#26282a");
  const LT = q.num("leafThickness", 45, 20, 150, " mm");
  const [cols, rows] = q.panes("panes", pair ? [2, 4] : [2, 3]);
  const hinge = q.pick("hinge", ["left", "right"] as const, "left");
  const handle = q.bool("handle", true);
  const letterbox = q.bool("letterbox", false);
  const knocker = q.bool("knocker", false);
  const stepRaw = q.raw("step");
  const step = stepRaw === true ? 150 : stepRaw === undefined || stepRaw === null || stepRaw === false ? 0 : isNum(stepRaw) && stepRaw >= 0 && stepRaw <= 1000 ? stepRaw : q.fail("step must be true, false or a height from 0 to 1000 mm");
  const lintel = q.flag("lintel", ["stone", "timber"] as const, false);
  const { F, D, R } = fitFrame(q, out, hole, 100, Math.min(hole.t, LT + 25));
  const g = out.group(label);
  const part = (name: string, c: string, shape: Shape | null, category = "Doors", op?: number): void => out.add(category, `${label} ${name}`, c, shape, g, op);
  const nF0 = -R - D;
  const nF1 = -R;

  part("frame", frameColor, fbox(f, -w / 2, w / 2, nF0, nF1, h - F, h));
  part("frame", frameColor, fbox(f, -w / 2, -w / 2 + F, nF0, nF1, 0, h - F));
  part("frame", frameColor, fbox(f, w / 2 - F, w / 2, nF0, nF1, 0, h - F));
  part("threshold", OAK, fbox(f, -w / 2 + F, w / 2 - F, nF0, nF1, 0, 15));

  const L0 = -w / 2 + F + 3;
  const L1 = w / 2 - F - 3;
  const Z0 = 18;
  const Z1 = h - F - 3;
  const nL1 = Math.max(nF0 + LT, -R - 12);
  const nL0 = nL1 - LT;
  const leaves: [number, number][] = pair ? [[L0, -2], [2, L1]] : [[L0, L1]];
  const lh = Z1 - Z0;

  /** Raised panels, 10 proud, on both faces. */
  const panel = (sa: number, sb: number, za: number, zb: number): void => {
    part("panel", leafColor, fbox(f, sa, sb, nL1, nL1 + 10, za, zb));
    part("panel", leafColor, fbox(f, sa, sb, nL0 - 10, nL0, za, zb));
  };
  /** Vertical boards outside, ledges and braces inside, from za to zb. */
  const boards = (sa: number, sb: number, za: number, zb: number): void => {
    const bt = Math.min(25, LT * 0.55);
    const nB = nL1 - bt;
    const k = Math.max(3, Math.round((sb - sa) / 140));
    const bw = (sb - sa - (k - 1) * 4) / k;
    for (let i = 0; i < k; i++) part("board", leafColor, fbox(f, sa + i * (bw + 4), sa + i * (bw + 4) + bw, nB, nL1, za, zb));
    const ledges = zb - za > 1500 ? [za + 150, (za + zb) / 2 - 75, zb - 300] : [za + 120, zb - 270];
    for (const z of ledges) part("ledge", leafColor, fbox(f, sa + 30, sb - 30, nL0, nB, z, z + 150));
    const hs = hinge === "left" ? sa + 60 : sb - 60;
    const ls = hinge === "left" ? sb - 60 : sa + 60;
    for (let i = 0; i + 1 < ledges.length; i++) {
      const lo = ledges[i] + 150;
      const hi = ledges[i + 1];
      if (hi - lo < 300) continue;
      part("brace", leafColor, fprofile(f, [[hs, lo], [ls, hi - 130], [ls, hi], [hs, lo + 130]], nL0, nB));
    }
  };
  /** A glazed leaf: solid below lowTop, stiles and a top rail round the glass above. */
  const glazed = (sa: number, sb: number, lowTop: number): void => {
    const st = Math.min(110, (sb - sa) * 0.18);
    const tr = 110;
    part("leaf", leafColor, fbox(f, sa, sb, nL0, nL1, Z0, lowTop));
    if (lowTop - Z0 > 350) panel(sa + st, sb - st, Z0 + 150, lowTop - 90);
    part("leaf", leafColor, fbox(f, sa, sa + st, nL0, nL1, lowTop, Z1 - tr));
    part("leaf", leafColor, fbox(f, sb - st, sb, nL0, nL1, lowTop, Z1 - tr));
    part("leaf", leafColor, fbox(f, sa, sb, nL0, nL1, Z1 - tr, Z1));
    const nm = (nL0 + nL1) / 2;
    part("glass", glass, fbox(f, sa + st, sb - st, nm - 3, nm + 3, lowTop, Z1 - tr), "Glazing", opacity);
    for (const b of bars(f, sa + st, sb - st, lowTop, Z1 - tr, nL0 + 6, nL1 - 6, cols, rows)) part("glazing bar", leafColor, b);
  };

  let lockZ = Z0 + Math.min(1000, lh * 0.5);
  if (style === "panel") {
    const [sa, sb] = leaves[0];
    part("leaf", leafColor, fbox(f, sa, sb, nL0, nL1, Z0, Z1));
    const lw = sb - sa;
    const st = Math.min(120, lw * 0.15);
    const mu = 100;
    const lock = Z0 + lh * 0.42;
    const nc = lw > 500 ? 2 : 1;
    const pw = (lw - 2 * st - (nc - 1) * mu) / nc;
    for (let c = 0; c < nc; c++) {
      const s = sa + st + c * (pw + mu);
      panel(s, s + pw, Z0 + 220, lock - 80);
      panel(s, s + pw, lock + 80, Z1 - 120);
    }
    lockZ = lock;
  } else if (style === "plank" || style === "ledged") {
    boards(leaves[0][0], leaves[0][1], Z0, Z1);
  } else if (style === "stable") {
    const split = Z0 + Math.min(1050, lh * 0.5);
    boards(L0, L1, Z0, split - 3);
    boards(L0, L1, split + 3, Z1);
    part("drip", leafColor, fbox(f, L0, L1, nL1, nL1 + 35, split - 45, split - 3));
    lockZ = split - 250;
  } else if (style === "glazed") {
    glazed(L0, L1, Z0 + lh * 0.42);
  } else {
    for (const [sa, sb] of leaves) glazed(sa, sb, Z0 + Math.min(450, lh * 0.25));
  }

  if (handle) {
    const spots = pair ? [-2 - 70, 2 + 70] : [hinge === "left" ? L1 - 70 : L0 + 70];
    for (const s of spots) {
      const toHinge = pair ? (s < 0 ? -1 : 1) : hinge === "left" ? -1 : 1;
      const zh = pair ? Z0 + Math.min(1000, lh * 0.5) : style === "panel" ? lockZ : Math.min(lockZ, Z0 + 1000);
      for (const [face, dir] of [[nL1, 1], [nL0, -1]] as const) {
        const n = (a: number, b: number): [number, number] => [face + dir * a, face + dir * b];
        part("handle", metal, fbox(f, s - 20, s + 20, ...n(0, 8), zh - 90, zh + 90));
        part("handle", metal, fbox(f, s - 9, s + 9, ...n(8, 55), zh - 9, zh + 9));
        part("handle", metal, fbox(f, Math.min(s, s + toHinge * 110), Math.max(s, s + toHinge * 110), ...n(45, 65), zh - 11, zh + 11));
      }
    }
  }
  const mid = pair ? 0 : (L0 + L1) / 2;
  if (letterbox) {
    if (pair) out.note(`${label}: a pair of glazed doors has no letterbox`);
    else {
      const zl = style === "panel" ? lockZ : style === "glazed" ? Z0 + lh * 0.3 : Z0 + 780;
      part("letterbox", metal, fbox(f, mid - 150, mid + 150, nL1, nL1 + 8, zl - 35, zl + 35));
    }
  }
  if (knocker && !pair && Z1 > 1650) part("knocker", metal, fbox(f, mid - 40, mid + 40, nL1, nL1 + 25, 1380, 1540));
  if (step > 0) out.add("Steps", `${label} step`, STONE, fbox(f, -w / 2 - 150, w / 2 + 150, nF1, 350, -step, 0), g);
  if (lintel && hole.above >= 50) {
    const horn = Math.min(hole.horn, 150);
    part("lintel", lintel === "stone" ? STONE : TIMBER, fbox(f, -w / 2 - horn, w / 2 + horn, -Math.min(hole.t, 150), 10, h, h + Math.min(150, hole.above)));
  }
}

/** A standalone window or door: placed by at and facing (or angle), or by a and b. */
function buildOpening(r: Reader, out: Out, door: boolean): void {
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const t = r.num("wallThickness", 300, 20, 3000, " mm");
  const line = r.pick("line", ["outer", "centre", "center"] as const, "outer");
  const h = r.num("height", door ? 2100 : 1200, 100, 50_000, " mm");
  const sill = r.num("sill", door ? 0 : 900, 0, 50_000, " mm");
  let mid: Pt;
  let nOut: Pt;
  let w: number;
  if (r.has("a") || r.has("b")) {
    const a = r.pt("a");
    const b = r.pt("b");
    if (dist(a, b) < 100) r.fail("a and b must be at least 100 apart");
    const d = unit(sub(b, a));
    nOut = P(d.y, -d.x);
    if (r.has("facing") && dot(toward(r.num("facing", 0, -360, 360, "°")), nOut) < 0) nOut = mul(nOut, -1);
    mid = mul(add(a, b), 0.5);
    w = r.num("width", dist(a, b), 100, 50_000, " mm");
  } else if (r.has("at")) {
    mid = r.pt("at");
    if (r.has("facing")) nOut = toward(r.num("facing", 0, -360, 360, "°"));
    else if (r.has("angle")) {
      const d = toward(r.num("angle", 0, -360, 360, "°"));
      nOut = P(d.y, -d.x);
    } else return r.fail("needs facing (the direction it faces out) with at");
    w = r.num("width", door ? 900 : 1000, 100, 50_000, " mm");
  } else {
    return r.fail("needs at and facing, or a and b, to place it");
  }
  if (line !== "outer") mid = add(mid, mul(nOut, t / 2));
  const label = out.own(door ? "Door" : "Window");
  const hole: Hole = { f: { o: mid, s: left(nOut), n: nOut, z: base + sill }, w, h, t, horn: 150, above: 150, label };
  (door ? doorIn : windowIn)(r, hole, out);
}

// ---- roofs --------------------------------------------------------------------------------------

/** A roof plane by its underside, z = gx·x + gy·y + c; its pitch sets how thick it stands plumb. */
interface Plane {
  gx: number;
  gy: number;
  c: number;
  pitch: number;
}
const under = (p: Plane, q: Pt): number => p.gx * q.x + p.gy * q.y + p.c;

/** The underside rising inward from edge i of a counter-clockwise loop: `base` on the edge's line (or `inset` inside it), then tan(pitch) per millimetre. */
function edgePlane(poly: readonly Pt[], i: number, base: number, pitch: number, inset = 0): Plane {
  const a = poly[i];
  const nIn = left(unit(sub(poly[(i + 1) % poly.length], a)));
  const k = Math.tan(rad(pitch));
  return { gx: k * nIn.x, gy: k * nIn.y, c: base - k * (dot(a, nIn) + inset), pitch };
}

interface RoofLook {
  eaves: number;
  thickness: number;
  color: string;
  thatch: boolean;
  /** what runs along level ridges */
  ridge: "block" | "tiles" | "none";
  /** a thatch ridge block's size, 1 on a house */
  ridgeScale: number;
  fillThickness: number;
  fillLine: "centre" | "outer";
  fillColor: string;
}

/** A hole cut from one plane's slope, for a dormer: where every half-plane a·x + b·y + c ≤ 0 holds. */
interface Cut {
  plane: number;
  hole: [number, number, number][];
}

type AddPart = (category: string, name: string, color: string, shape: Shape | null) => void;

/**
 * A pitched roof over a convex counter-clockwise loop: edge i's eaves (or verge) stand out
 * over[i] past it, and fill[i] fills the end under it with wall. The roof surface is the lowest
 * of the planes everywhere, so each plane covers the convex region where it is lowest; that is a
 * hipped roof's straight skeleton on a convex outline, a gable where an edge has no plane, and a
 * mansard where edges have two. Each region becomes a slab of the roof's thickness with plumb
 * edges (bevelled at the outer edges for thatch), so neighbours meet exactly along hips and ridges.
 */
function pitchedRoof(poly: readonly Pt[], over: readonly number[], fill: readonly boolean[], planes: readonly Plane[], look: RoofLook, cuts: readonly Cut[], put: AddPart): void {
  const expanded = offsetLoop(poly, over) ?? [...poly];
  const T = planes.map((p) => look.thickness / Math.cos(rad(p.pitch)));
  const top = (i: number, q: Pt): number => under(planes[i], q) + T[i];
  // thatch is bevelled at the outer edges, but never so far in that the wall's top, which stands
  // above the slope's underside at the wall's outer face, shows through near the eaves
  const face = look.fillLine === "centre" ? look.fillThickness / 2 : 0;
  const bevel = (i: number, p: Pt, q: Pt): number => {
    const e = expanded.findIndex((a, k) => {
      const d = unit(sub(expanded[(k + 1) % expanded.length], a));
      return Math.abs(cross(d, sub(p, a))) < 0.5 && Math.abs(cross(d, sub(q, a))) < 0.5;
    });
    if (e < 0) return 0;
    const clear = (T[i] * Math.max(0, over[e] - face)) / (face * Math.tan(rad(planes[i].pitch)) + 50);
    return Math.min(look.thickness * 0.9, 450, clear);
  };
  const tops: { plane: number; loop: V3[] }[] = [];
  let slope = 0;
  planes.forEach((pl, i) => {
    let region: Pt[] = [...expanded];
    for (let j = 0; j < planes.length && region.length >= 3; j++) {
      if (j === i) continue;
      const a = pl.gx - planes[j].gx;
      const b = pl.gy - planes[j].gy;
      const c = pl.c + T[i] - planes[j].c - T[j];
      if (Math.hypot(a, b) < 1e-9) {
        if (c > 1e-6 || (Math.abs(c) <= 1e-6 && j < i)) region = [];
        continue;
      }
      region = clip(region, a, b, c);
    }
    let pieces = region.length >= 3 ? [region] : [];
    for (const cut of cuts) if (cut.plane === i) pieces = pieces.flatMap((p) => subtract(p, cut.hole));
    for (const raw of pieces) {
      const piece = tidy(raw, 0.01);
      if (piece.length < 3 || Math.abs(signedArea(piece)) < 1000) continue;
      const loop = ccwLoop(piece);
      const upper = look.thatch ? (bevelled(loop, (p, q) => bevel(i, p, q)) ?? loop) : loop;
      const bottom = loop.map((q): V3 => [q.x, q.y, under(pl, q)]);
      const topLoop = upper.map((q): V3 => [q.x, q.y, top(i, q)]);
      put("Roof", `slope ${++slope}`, look.color, meshOf(loft(bottom, topLoop)));
      tops.push({ plane: i, loop: topLoop });
    }
  });

  // level ridges, where two planes falling away from each other meet
  if (look.ridge !== "none") {
    for (const { plane: i, loop } of tops) {
      for (let j = 0; j < planes.length; j++) {
        if (j <= i || planes[i].gx * planes[j].gx + planes[i].gy * planes[j].gy >= 0) continue;
        for (let k = 0; k < loop.length; k++) {
          const p = loop[k];
          const q = loop[(k + 1) % loop.length];
          const on = (v: V3): boolean => Math.abs(v[2] - top(j, P(v[0], v[1]))) < 0.5;
          if (Math.abs(p[2] - q[2]) > 0.5 || Math.hypot(q[0] - p[0], q[1] - p[1]) < 150 || !on(p) || !on(q)) continue;
          const block = look.ridge === "block";
          const z = look.ridgeScale;
          put("Roof", "ridge", shade(look.color, block ? 0.86 : 0.8), block ? ridgePiece(p, q, planes[i].pitch, 450 * z, 150 * z, 220 * z) : ridgePiece(p, q, planes[i].pitch, 150, 35, 95));
        }
      }
    }
  }

  // gable ends filled with wall up to the underside
  const n = poly.length;
  for (let e = 0; e < n; e++) {
    if (!fill[e]) continue;
    const a = poly[e];
    const L = dist(a, poly[(e + 1) % n]);
    const u = unit(sub(poly[(e + 1) % n], a));
    const nOut = P(u.y, -u.x);
    const [n0, n1] = look.fillLine === "centre" ? [-look.fillThickness / 2, look.fillThickness / 2] : [-look.fillThickness, 0];
    // the profile under every plane along the fill's outer face, in (s along the edge, z)
    const face = add(a, mul(nOut, n1));
    let prof: Pt[] = [P(0, look.eaves), P(L, look.eaves), P(L, look.eaves + 1e5), P(0, look.eaves + 1e5)];
    for (const pl of planes) prof = clip(prof, -(pl.gx * u.x + pl.gy * u.y), 1, -under(pl, face));
    prof = tidy(prof, 0.5);
    if (prof.length < 3 || Math.abs(signedArea(prof)) < 1e4 || Math.max(...prof.map((p) => p.y)) > look.eaves + 9e4) continue;
    const at = (s: number, nn: number, z: number): V3 => {
      const p = add(add(a, mul(u, s)), mul(nOut, nn));
      return [p.x, p.y, z];
    };
    const zTop = Math.max(...prof.map((p) => p.y));
    const flatTop = prof.length === 4 && prof.every((p) => (Math.abs(p.y - look.eaves) < 0.5 || Math.abs(p.y - zTop) < 0.5) && (Math.abs(p.x) < 0.5 || Math.abs(p.x - L) < 0.5));
    const shape = flatTop
      ? prismOf([at(0, n0, 0), at(L, n0, 0), at(L, n1, 0), at(0, n1, 0)].map((v) => P(v[0], v[1])), look.eaves, zTop)
      : meshOf(loft(prof.map((p) => at(p.x, n0, p.y)), prof.map((p) => at(p.x, n1, p.y))));
    put("Walls", "gable wall", look.fillColor, shape);
  }
}

/** A convex loop with each edge pq moved in by by(p, q); null if that folds it. */
function bevelled(poly: readonly Pt[], by: (p: Pt, q: Pt) => number): Pt[] | null {
  const n = poly.length;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % n];
    const d = unit(sub(q, p));
    return { p: add(p, mul(left(d), by(p, q))), d };
  });
  const out = lines.map((b, k) => {
    const a = lines[(k + n - 1) % n];
    return meet(a.p, a.d, b.p, b.d) ?? b.p;
  });
  for (let i = 0; i < n; i++) if (dot(sub(out[(i + 1) % n], out[i]), lines[i].d) < 1) return null;
  return out;
}

/**
 * A ridge block or ridge tiles from p to q, astride the ridge r to either side: its edges stand t
 * proud of the slopes and its top h above the ridge, and it reaches down into the slopes below.
 */
function ridgePiece(p: V3, q: V3, pitch: number, r: number, t: number, h: number): Shape | null {
  const d = unit(P(q[0] - p[0], q[1] - p[1]));
  const w = left(d);
  const k = Math.tan(rad(pitch));
  const top = Math.max(h, t - r * k + 20);
  const prof: [number, number][] = [[-r, -r * k - 10], [r, -r * k - 10], [r, t - r * k], [r * 0.35, top], [-r * 0.35, top], [-r, t - r * k]];
  const at = (o: V3, [x, z]: [number, number]): V3 => [o[0] + w.x * x, o[1] + w.y * x, o[2] + z];
  return meshOf(loft(prof.map((c) => at(p, c)), prof.map((c) => at(q, c))));
}

/** A colour darkened (k < 1) or lightened. */
function shade(hex: string, k: number): string {
  const c = [1, 3, 5].map((i) => clamp(Math.round(parseInt(hex.slice(i, i + 2), 16) * k), 0, 255));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** An axis-aligned box in a roof's own axes: a along u, b along v. */
interface Box {
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

/**
 * An outline whose edges all run along two square directions, cut into a few rectangles (the
 * largest first) in axes along its longest edge; null for anything else or too many pieces.
 */
function orthoBoxes(poly: readonly Pt[]): { o: Pt; u: Pt; v: Pt; boxes: Box[]; squared: number } | null {
  const n = poly.length;
  let longest = 0;
  for (let i = 1; i < n; i++) if (dist(poly[i], poly[(i + 1) % n]) > dist(poly[longest], poly[(longest + 1) % n])) longest = i;
  const u = unit(sub(poly[(longest + 1) % n], poly[longest]));
  const v = left(u);
  const o = poly[longest];
  const loc = poly.map((p) => P(dot(sub(p, o), u), dot(sub(p, o), v)));
  for (let i = 0; i < n; i++) {
    const d = sub(loc[(i + 1) % n], loc[i]);
    if (Math.min(Math.abs(d.x), Math.abs(d.y)) > Math.max(2, len(d) * 0.0035)) return null;
  }
  const levels = (vals: number[]): number[] => {
    const out: number[] = [];
    for (const x of [...vals].sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > 1) out.push(x);
    return out;
  };
  const xs = levels(loc.map((p) => p.x));
  const ys = levels(loc.map((p) => p.y));
  const snap = (vals: number[], x: number): number => vals.reduce((best, y) => (Math.abs(y - x) < Math.abs(best - x) ? y : best), vals[0]);
  const sl = loc.map((p) => P(snap(xs, p.x), snap(ys, p.y)));
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1 || nx * ny > 400) return null;
  const free = Array.from({ length: nx }, (_, i) => Array.from({ length: ny }, (_, j) => pointInLoop(P((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2), sl)));
  const boxes: Box[] = [];
  for (;;) {
    let best: [number, number, number, number] | null = null;
    let bestArea = 0;
    for (let i0 = 0; i0 < nx; i0++) {
      for (let j0 = 0; j0 < ny; j0++) {
        if (!free[i0][j0]) continue;
        let top = ny;
        for (let i1 = i0; i1 < nx && free[i1][j0]; i1++) {
          let j1 = j0;
          while (j1 + 1 < top && free[i1][j1 + 1]) j1++;
          top = j1 + 1;
          const area = (xs[i1 + 1] - xs[i0]) * (ys[top] - ys[j0]);
          if (area > bestArea) {
            bestArea = area;
            best = [i0, i1, j0, top - 1];
          }
        }
      }
    }
    if (!best) break;
    const [i0, i1, j0, j1] = best;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) free[i][j] = false;
    boxes.push({ a0: xs[i0], a1: xs[i1 + 1], b0: ys[j0], b1: ys[j1 + 1] });
    if (boxes.length > 6) return null;
  }
  const squared = Math.max(...loc.map((p, i) => dist(p, sl[i])));
  return boxes.length ? { o, u, v, boxes, squared } : null;
}

const ROOF_STYLES = ["gable", "hip", "half-hip", "mono", "flat", "mansard"] as const;
type RoofStyle = (typeof ROOF_STYLES)[number];

function buildRoof(r: Reader, out: Out): void {
  const raw = r.pts("outline", 3);
  let poly = tidy(raw);
  if (poly.length < 3) r.fail("outline needs at least 3 distinct corners");
  const cw = signedArea(poly) < 0;
  poly = ccwLoop(poly);
  if (!isSimple(poly)) r.fail("outline crosses itself");
  let style: RoofStyle = r.pick("style", ROOF_STYLES, "gable");
  const material = r.pick("material", MATERIALS, style === "flat" ? "felt" : "tile");
  const thatch = material === "thatch";
  const eaves = r.num("eaves", 2500, -100_000, 100_000, " mm");
  const pitch = r.num("pitch", style === "mansard" ? 25 : thatch ? 50 : 40, 5, 75, "°");
  const thickness = r.num("thickness", thatch ? 400 : 200, 20, 2000, " mm");
  const overhang = r.num("overhang", style === "flat" ? 0 : thatch ? 400 : 300, 0, 5000, " mm");
  const verge = r.num("verge", thatch ? 50 : 200, 0, 5000, " mm");
  const color = r.color("color", ROOF_COLORS[material]);
  const gableWalls = r.bool("gableWalls", true);
  const wallThickness = r.num("wallThickness", 300, 20, 3000, " mm");
  const wallLine = r.pick("wallLine", ["centre", "center", "outer"] as const, "centre") === "outer" ? "outer" : "centre";
  const wallColor = r.color("wallColor", WALL_COLOR);
  // overhangs are measured past the walls' outer face, half a wall out from a centre-line outline
  const face = wallLine === "centre" ? wallThickness / 2 : 0;
  const eaveOver = overhang + face;
  const vergeOver = verge + face;
  const label = out.own("Roof");
  const g = out.group(label);
  const put: AddPart = (category, name, c, shape) => out.add(category, `${label} ${name}`, c, shape, g);
  const look: RoofLook = {
    eaves,
    thickness,
    color,
    thatch,
    ridge: thatch ? "block" : material === "tile" || material === "slate" ? "tiles" : "none",
    ridgeScale: 1,
    fillThickness: wallThickness,
    fillLine: wallLine,
    fillColor: wallColor,
  };

  const ortho = style === "flat" ? null : orthoBoxes(poly);
  if (style !== "flat" && !ortho && !isConvex(poly)) {
    out.note("the outline is neither a rectangle, an L, T or U of rectangles nor convex, so it was given a flat roof; split it into rectangles for a pitched one");
    style = "flat";
  }
  if (style === "flat") {
    const parapet = r.num("parapet", 0, 0, 5000, " mm");
    let slab: Pt[] = poly;
    if (parapet <= 0 && eaveOver > 0) {
      const grown = offsetLoop(poly, poly.map(() => eaveOver));
      if (grown) slab = grown;
      else out.note("the overhang would fold the outline, so the roof stops at it");
    }
    put("Roof", "slab", color, prismOf(slab, eaves, eaves + thickness));
    if (parapet > 0) {
      const line = wallLine === "outer" ? offsetLoop(poly, poly.map(() => -wallThickness / 2)) : poly;
      if (!line) out.note("the parapet doesn't fit inside the outline");
      else {
        const { runs } = wallRuns(line, true, wallThickness);
        runs.forEach((run) => put("Walls", "parapet", wallColor, prismOf(runPiece(run, wallThickness, -Infinity, Infinity), eaves, eaves + thickness + parapet)));
      }
    }
    return;
  }

  const ridgeRaw = r.raw("ridge");
  if (ridgeRaw !== undefined && ridgeRaw !== null && ridgeRaw !== "long" && ridgeRaw !== "short" && !isNum(ridgeRaw)) r.fail('ridge must be "long", "short" or an angle');
  const lowerPitch = style === "mansard" ? r.num("lowerPitch", 70, 30, 85, "°") : 70;
  const lowerHeight = style === "mansard" ? r.num("lowerHeight", 1800, 200, 20_000, " mm") : 0;
  const k = Math.tan(rad(pitch));

  /** The planes of edge i at an eave (two for a mansard). */
  const eavePlanes = (loop: readonly Pt[], i: number): Plane[] =>
    style === "mansard"
      ? [edgePlane(loop, i, eaves, lowerPitch), edgePlane(loop, i, eaves + lowerHeight, pitch, lowerHeight / Math.tan(rad(lowerPitch)))]
      : [edgePlane(loop, i, eaves, pitch)];

  /** A lean-to over a rectangle (its high side snapped to an edge) or over any convex outline. */
  const monoRoof = (free: boolean): void => {
    let dir: Pt;
    if (r.has("high")) {
      const i = r.int("high", 0, 0, raw.length - 1);
      const d = unit(sub(raw[(i + 1) % raw.length], raw[i]));
      dir = cw ? left(d) : P(d.y, -d.x);
    } else dir = toward(r.num("rises", 90, -360, 360, "°"));
    const n = poly.length;
    const outward = poly.map((p, i) => {
      const d = unit(sub(poly[(i + 1) % n], p));
      return P(d.y, -d.x);
    });
    let plane: Plane;
    let over: number[];
    if (!free) {
      // the high side is the edge facing most nearly the way it rises; it rises from the opposite one
      let hi = 0;
      for (let i = 1; i < n; i++) if (dot(outward[i], dir) > dot(outward[hi], dir)) hi = i;
      const lo = (hi + 2) % n;
      plane = edgePlane(poly, lo, eaves, pitch);
      over = poly.map((_, i) => (i === hi || i === lo ? eaveOver : vergeOver));
    } else {
      const low = Math.min(...poly.map((p) => dot(p, dir)));
      plane = { gx: k * dir.x, gy: k * dir.y, c: eaves - k * low, pitch };
      over = outward.map((nn) => (Math.abs(dot(nn, dir)) < 0.7 ? vergeOver : eaveOver));
      out.note("the outline isn't a rectangle; the lean-to rises across it from its lowest corner");
    }
    pitchedRoof(poly, over, poly.map(() => gableWalls), [plane], look, [], put);
  };

  const dormers = r.list("dormers");
  const dormerless = (): void => {
    if (dormers.length) out.note("dormers are only built on gable, hip and half-hip roofs over rectangles, so they were left out");
  };
  if (style === "mono") {
    if (!ortho || ortho.boxes.length === 1) {
      monoRoof(!ortho);
      dormerless();
      return;
    }
    out.note("a mono-pitch roof needs a rectangular or convex outline, so it was given gables");
    style = "gable";
  }
  if (!ortho) {
    // convex, but not a rectangle
    if (style === "gable" || style === "half-hip") out.note("the outline isn't a rectangle, so it was given a hipped roof over it");
    pitchedRoof(poly, poly.map(() => eaveOver), poly.map(() => false), poly.flatMap((_, i) => eavePlanes(poly, i)), look, [], put);
    dormerless();
    return;
  }

  const { o, u, v, boxes, squared } = ortho;
  if (squared > 5) out.note(`the outline's corners were squared up, moving them by up to ${fmt(squared)}`);
  const W = (a: number, b: number): Pt => add(o, add(mul(u, a), mul(v, b)));
  const spanOf = (b: Box, alongA: boolean): number => (alongA ? b.b1 - b.b0 : b.a1 - b.a0);
  // the main block: the widest span, then the largest
  const order = boxes.map((_, i) => i).sort((i, j) => {
    const si = Math.min(boxes[i].a1 - boxes[i].a0, boxes[i].b1 - boxes[i].b0);
    const sj = Math.min(boxes[j].a1 - boxes[j].a0, boxes[j].b1 - boxes[j].b0);
    return sj - si || (boxes[j].a1 - boxes[j].a0) * (boxes[j].b1 - boxes[j].b0) - (boxes[i].a1 - boxes[i].a0) * (boxes[i].b1 - boxes[i].b0);
  });
  interface Plan {
    box: Box;
    alongA: boolean;
    /** edges (0 bottom, 1 right, 2 top, 3 left) buried in a neighbouring roof */
    buried: Set<number>;
    /** eave edges that butt against a neighbour, so stand out not at all */
    flush: Set<number>;
  }
  const plans = new Map<number, Plan>();
  const queue: number[] = [];
  const startMain = (m: number): void => {
    const b = boxes[m];
    const wa = b.a1 - b.a0;
    const wb = b.b1 - b.b0;
    let alongA = wa >= wb;
    if (ridgeRaw === "short") alongA = !alongA;
    if (isNum(ridgeRaw)) {
      const d = toward(ridgeRaw);
      alongA = Math.abs(dot(d, u)) >= Math.abs(dot(d, v));
    }
    plans.set(m, { box: { ...b }, alongA, buried: new Set(), flush: new Set() });
    queue.push(m);
  };
  for (const m of order) {
    if (plans.has(m)) continue;
    startMain(m);
    while (queue.length) {
      const pi = queue.shift() as number;
      const parent = plans.get(pi) as Plan;
      const pb = boxes[pi];
      boxes.forEach((cb, ci) => {
        if (plans.has(ci)) return;
        // which side of the child touches the parent, and how far they share it
        const overlapA = Math.min(pb.a1, cb.a1) - Math.max(pb.a0, cb.a0);
        const overlapB = Math.min(pb.b1, cb.b1) - Math.max(pb.b0, cb.b0);
        let side = -1;
        if (Math.abs(pb.b1 - cb.b0) < 1 && overlapA > 1) side = 0;
        else if (Math.abs(pb.b0 - cb.b1) < 1 && overlapA > 1) side = 2;
        else if (Math.abs(pb.a1 - cb.a0) < 1 && overlapB > 1) side = 3;
        else if (Math.abs(pb.a0 - cb.a1) < 1 && overlapB > 1) side = 1;
        if (side < 0) return;
        const sideAlongA = side === 0 || side === 2;
        const width = sideAlongA ? cb.a1 - cb.a0 : cb.b1 - cb.b0;
        const parentSpan = spanOf(parent.box, parent.alongA);
        const box = { ...cb };
        const plan: Plan = { box, alongA: !sideAlongA, buried: new Set(), flush: new Set() };
        if (width <= parentSpan + 1) {
          // its ridge runs into the parent's roof and is buried there, half its span in
          const into = Math.min(width / 2, sideAlongA ? pb.b1 - pb.b0 : pb.a1 - pb.a0);
          if (side === 0) box.b0 -= into;
          if (side === 2) box.b1 += into;
          if (side === 3) box.a0 -= into;
          if (side === 1) box.a1 += into;
          plan.buried.add(side);
        } else {
          // wider than the parent's span: a roof alongside it, meeting it in a valley
          plan.alongA = sideAlongA;
          plan.flush.add(side);
        }
        plans.set(ci, plan);
        queue.push(ci);
      });
    }
  }
  if (boxes.length > 1) out.note(`the outline was split into ${boxes.length} rectangles, roofed as intersecting ${style === "hip" ? "hipped " : style === "mansard" ? "mansard " : ""}roofs`);

  if (boxes.length > 1 || !(style === "gable" || style === "hip" || style === "half-hip")) dormerless();
  for (const plan of plans.values()) {
    const b = plan.box;
    const loop = [W(b.a0, b.b0), W(b.a1, b.b0), W(b.a1, b.b1), W(b.a0, b.b1)];
    const eaveEdges = plan.alongA ? [0, 2] : [1, 3];
    const span = spanOf(b, plan.alongA);
    const over: number[] = [];
    const fill: boolean[] = [];
    const planes: Plane[] = [];
    const eavePlane = new Map<number, number>();
    for (let e = 0; e < 4; e++) {
      if (plan.buried.has(e)) {
        over.push(0);
        fill.push(false);
      } else if (eaveEdges.includes(e)) {
        over.push(plan.flush.has(e) ? 0 : eaveOver);
        fill.push(false);
        eavePlane.set(e, planes.length);
        planes.push(...eavePlanes(loop, e));
      } else if (style === "gable") {
        over.push(vergeOver);
        fill.push(gableWalls);
      } else if (style === "half-hip") {
        over.push(vergeOver);
        fill.push(gableWalls);
        planes.push(edgePlane(loop, e, eaves + 0.6 * k * (span / 2), pitch));
      } else {
        over.push(eaveOver);
        fill.push(false);
        planes.push(...eavePlanes(loop, e));
      }
    }
    const cuts: Cut[] = [];
    if (boxes.length === 1 && (style === "gable" || style === "hip" || style === "half-hip")) {
      dormers.forEach((d, di) => {
        const q = reader(d, `${r.where}, dormer ${di + 1}`);
        cuts.push(dormer(q, out, loop, eaveEdges, eavePlane, { style, pitch, span, eaves, face, look }));
        const extra = q.unused();
        if (extra.length) out.note(`dormer ${di + 1}: ignored ${extra.join(", ")}, which ${extra.length === 1 ? "doesn't" : "don't"} apply here`);
      });
    }
    pitchedRoof(loop, over, fill, planes, look, cuts, put);
  }

}

/**
 * A dormer on one eave's slope: a front wall with its window, cheeks down to the slope, and a
 * small roof whose back is buried in the main one. Returns the hole to cut from the main slope.
 */
function dormer(
  q: Reader,
  out: Out,
  loop: readonly Pt[],
  eaveEdges: readonly number[],
  eavePlane: ReadonlyMap<number, number>,
  roof: { style: RoofStyle; pitch: number; span: number; eaves: number; face: number; look: RoofLook },
): Cut {
  const at = q.pt("at");
  const w = q.num("width", 900, 300, 5000, " mm");
  const h = q.num("height", 900, 300, 4000, " mm");
  const style = q.pick("style", ["gable", "flat", "eyebrow"] as const, "gable");
  // the eave whose wall line is nearest
  let e = eaveEdges[0];
  let best = Infinity;
  for (const i of eaveEdges) {
    const a = loop[i];
    const u = unit(sub(loop[(i + 1) % 4], a));
    const s = clamp(dot(sub(at, a), u), 0, dist(a, loop[(i + 1) % 4]));
    const d = dist(at, add(a, mul(u, s)));
    if (d < best) {
      best = d;
      e = i;
    }
  }
  const a = loop[e];
  const L = dist(a, loop[(e + 1) % 4]);
  const u = unit(sub(loop[(e + 1) % 4], a));
  const nIn = left(u);
  const sc = dot(sub(at, a), u);
  // up the slope, or (from within a few millimetres of the eaves line, or outside it) flush with the wall's outer face
  const up = dot(sub(at, a), nIn);
  const d0 = up > 5 ? up : -roof.face;
  const k = Math.tan(rad(roof.pitch));
  const ct = 150;
  const W = w + 2 * ct;
  const Tm = roof.look.thickness / Math.cos(rad(roof.pitch));
  const zF = roof.eaves + k * Math.max(0, d0);
  // up the slope the sill clears the roof left in front; at the eaves the roof is cut away
  const zs = zF + (d0 > 0 ? Tm + 100 : 250);
  const zh = zs + h;
  const Ed = zh + 200;
  const dB = (Ed - roof.eaves) / k;
  if ((style === "flat" ? dB + 100 : dB + W / 2) > roof.span / 2 - 100) {
    q.fail(`is too tall for the roof: its eaves would be at z=${fmt(Ed)} and its ${style === "flat" ? "roof" : "ridge"} would reach past the main ridge; make it lower${style === "flat" ? "" : " or narrower"}, or nearer the eaves`);
  }
  const margin = roof.style === "hip" ? dB + W / 2 + 100 : 200;
  if (sc - W / 2 < margin || sc + W / 2 > L - margin) {
    q.fail(`doesn't fit on the slope: it is ${fmt(W)} wide with its cheeks, and its middle must be between ${fmt(margin + W / 2)} and ${fmt(L - margin - W / 2)} along the ${fmt(L)} eaves (it is at ${fmt(sc)})`);
  }
  const label = q.text("name") ?? out.next("Dormer");
  const g = out.group(label);
  const wallColor = roof.look.fillColor;
  const nOut = mul(nIn, -1);
  const f: Frame = { o: add(a, add(mul(u, sc), mul(nIn, d0))), s: u, n: nOut, z: zF };
  const wall = (s0: number, s1: number, z0: number, z1: number): void => out.add("Walls", `${label} wall`, wallColor, fbox(f, s0, s1, -ct, 0, z0 - zF, z1 - zF), g);
  wall(-W / 2, -w / 2, zF, Ed);
  wall(w / 2, W / 2, zF, Ed);
  wall(-w / 2, w / 2, zF, zs);
  wall(-w / 2, w / 2, zh, Ed);
  // cheeks: triangles from the front back to where the slope's underside reaches the dormer's eaves
  for (const [s0, s1] of [[-W / 2, -W / 2 + ct], [W / 2 - ct, W / 2]]) {
    const prof: [number, number][] = [[0, zF], [-(dB - d0), Ed], [0, Ed]];
    const side = (s: number): V3[] => prof.map(([n, z]) => {
      const p = fpt(f, s, n);
      return [p.x, p.y, z];
    });
    out.add("Walls", `${label} cheek`, wallColor, meshOf(loft(side(s0), side(s1))), g);
  }
  const winLabel = out.next("Window");
  // the window's own style and colour, as the dormer's style and colour are its own
  const wq: Reader = {
    ...q,
    color: (key, def) => q.color(key === "color" ? "windowColor" : key, def),
    pick: (key, options, def) => q.pick(key === "style" ? "windowStyle" : key, options, def),
  };
  windowIn(wq, { f: { ...f, z: zs }, w, h, t: ct, horn: ct, above: Ed - zh, label: winLabel }, out);

  const W3 = (s: number, d: number): Pt => add(a, add(mul(u, sc + s), mul(nIn, d)));
  const put: AddPart = (category, name, c, shape) => out.add(category, `${label} ${name}`, c, shape, g);
  if (style === "flat") {
    put("Roof", "roof", roof.look.color, prismOf([W3(-W / 2 - 100, d0 - 100), W3(W / 2 + 100, d0 - 100), W3(W / 2 + 100, dB + 100), W3(-W / 2 - 100, dB + 100)], Ed, Ed + 150));
  } else {
    const box = [W3(-W / 2, d0), W3(W / 2, d0), W3(W / 2, dB + W / 2), W3(-W / 2, dB + W / 2)];
    const dp: Plane[] = [edgePlane(box, 1, Ed, roof.pitch), edgePlane(box, 3, Ed, roof.pitch)];
    if (style === "eyebrow") dp.push(edgePlane(box, 0, Ed, roof.pitch));
    const look: RoofLook = { ...roof.look, eaves: Ed, fillLine: "outer", fillThickness: ct, ridgeScale: 0.5 };
    pitchedRoof(box, [100, 100, 0, 100], [style === "gable", false, false, false], dp, look, [], put);
  }
  const ua = dot(u, a);
  const na = dot(nIn, a);
  const back = style === "flat" ? Math.max(d0 + 100, (Ed + 150 - roof.eaves - Tm) / k) : dB;
  const hole: [number, number, number][] = [
    [-u.x, -u.y, ua + sc - W / 2],
    [u.x, u.y, -ua - sc - W / 2],
    [nIn.x, nIn.y, -na - back],
  ];
  if (d0 > 0) hole.push([-nIn.x, -nIn.y, na + d0]);
  return { plane: eavePlane.get(e) ?? 0, hole };
}

// ---- floors, chimneys, steps ----------------------------------------------------------------

function polygonOf(r: Reader, key: string): Pt[] {
  const poly = tidy(r.pts(key, 3));
  if (poly.length < 3) r.fail(`${key} needs at least 3 distinct corners`);
  if (!isSimple(poly)) r.fail(`${key} crosses itself`);
  return ccwLoop(poly);
}

function buildSlab(r: Reader, out: Out, floor: boolean): void {
  const outline = polygonOf(r, "outline");
  const top = r.num("top", 0, -100_000, 100_000, " mm");
  const thickness = r.num("thickness", 200, 1, 10_000, " mm");
  const color = r.color("color", "#cfc8bb");
  out.add("Floors", out.own(floor ? "Floor" : "Slab"), color, prismOf(outline, top - thickness, top));
}

function buildChimney(r: Reader, out: Out): void {
  let outline: Pt[];
  if (r.has("outline")) outline = polygonOf(r, "outline");
  else {
    const at = r.pt("at");
    const [w, d] = r.size("size", [600, 450], 100, 10_000);
    outline = rectAround(at, w, d, r.num("angle", 0, -360, 360, "°"));
  }
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const top = r.num("top", undefined, -100_000, 100_000, " mm");
  if (top < base + 200) r.fail("top must be at least 200 above base");
  const color = r.color("color", "#9a5a42");
  const cap = r.bool("cap", true);
  let pots = r.int("pots", 1, 0, 4);
  const potColor = r.color("potColor", "#b0643c");
  const label = out.own("Chimney");
  const g = out.group(label);
  out.add("Chimneys", `${label} stack`, color, prismOf(outline, base, top), g);
  if (cap) {
    const band = offsetLoop(outline, outline.map(() => 50));
    if (band) out.add("Chimneys", `${label} cap`, color, prismOf(band, top - 150, top), g);
  }
  if (pots) {
    // along the stack's longest side
    let longest = 0;
    outline.forEach((p, i) => {
      if (dist(p, outline[(i + 1) % outline.length]) > dist(outline[longest], outline[(longest + 1) % outline.length])) longest = i;
    });
    const u = unit(sub(outline[(longest + 1) % outline.length], outline[longest]));
    const v = left(u);
    const su = outline.map((p) => dot(p, u));
    const sv = outline.map((p) => dot(p, v));
    const lu = Math.max(...su) - Math.min(...su);
    const fit = Math.max(1, Math.floor(lu / 280));
    if (pots > fit) {
      out.note(`only ${fit} pot${fit === 1 ? "" : "s"} fit on the stack`);
      pots = fit;
    }
    const mu = (Math.max(...su) + Math.min(...su)) / 2;
    const mv = (Math.max(...sv) + Math.min(...sv)) / 2;
    const step = Math.min(lu / pots, 330);
    for (let i = 0; i < pots; i++) {
      const c = add(mul(u, mu + (i - (pots - 1) / 2) * step), mul(v, mv));
      out.add("Chimneys", `${label} pot`, potColor, prismOf(circle(c, 105, 12), top, top + 450), g);
      out.add("Chimneys", `${label} pot`, potColor, prismOf(circle(c, 125, 12), top + 400, top + 470), g);
    }
  }
}

function buildSteps(r: Reader, out: Out): void {
  const at = r.pt("at");
  const angle = r.num("angle", 90, -360, 360, "°");
  const width = r.num("width", 1000, 100, 50_000, " mm");
  const count = r.int("count", 3, 1, 60);
  const rise = r.num("rise", 170, 10, 1000, " mm");
  const going = r.num("going", 280, 50, 3000, " mm");
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const landing = r.num("landing", 0, 0, 20_000, " mm");
  const color = r.color("color", "#bdb5a6");
  const label = out.own("Steps");
  const g = out.group(label);
  const d = toward(angle);
  const f: Frame = { o: at, s: P(d.y, -d.x), n: d, z: base };
  for (let i = 0; i < count; i++) {
    const deep = i === count - 1 && landing > 0 ? landing : going;
    out.add("Steps", `${label} step ${i + 1}`, color, fbox(f, -width / 2, width / 2, i * going, i * going + deep, 0, (i + 1) * rise), g);
  }
}

// ---- the garden -------------------------------------------------------------------------------

const SURFACES: Record<SurfaceKind, { color: string; top: number; thickness: number; category: string; label: string; opacity?: number }> = {
  ground: { color: "#8c9a64", top: -30, thickness: 200, category: "Garden", label: "Ground" },
  lawn: { color: "#6f9a3c", top: 0, thickness: 30, category: "Garden", label: "Lawn" },
  planting: { color: "#5b4633", top: 5, thickness: 30, category: "Planting", label: "Planting bed" },
  water: { color: "#4f7f99", top: 10, thickness: 30, category: "Garden", label: "Water", opacity: 70 },
  gravel: { color: "#c9bfa6", top: 10, thickness: 50, category: "Paving", label: "Gravel" },
  path: { color: "#b9ab92", top: 15, thickness: 50, category: "Paving", label: "Path" },
  paving: { color: "#a8957d", top: 20, thickness: 60, category: "Paving", label: "Paving" },
  patio: { color: "#bdb5a6", top: 20, thickness: 60, category: "Paving", label: "Patio" },
  driveway: { color: "#3d3d3f", top: 20, thickness: 100, category: "Paving", label: "Driveway" },
  decking: { color: "#8a6a48", top: 150, thickness: 150, category: "Paving", label: "Decking" },
};

function buildSurface(r: Reader, out: Out, kind: SurfaceKind): void {
  const def = SURFACES[kind];
  const top = r.num("top", def.top, -100_000, 100_000, " mm");
  const thickness = r.num("thickness", def.thickness, 1, 10_000, " mm");
  const color = r.color("color", def.color);
  let outline: Pt[];
  let sides: Pt[][] = [];
  if (r.has("outline")) {
    outline = polygonOf(r, "outline");
  } else if (r.has("path")) {
    const { path } = pathOf(r, "path", false);
    const width = r.num("width", kind === "driveway" ? 3000 : 1000, 100, 100_000, " mm");
    const lft = offsetLine(path, width / 2);
    const rgt = offsetLine(path, -width / 2);
    outline = [...rgt, ...[...lft].reverse()];
    if (!isSimple(outline)) r.fail("path turns too tightly for its width, or crosses itself");
    outline = ccwLoop(outline);
    sides = [lft, rgt];
  } else {
    return r.fail("needs an outline, or a path and a width");
  }
  const edgingRaw = r.raw("edging");
  const label = out.own(def.label);
  if (edgingRaw === undefined || edgingRaw === null || edgingRaw === false) {
    out.add(def.category, label, color, prismOf(outline, top - thickness, top), undefined, def.opacity);
    return;
  }
  let ew = 100;
  let eh = 50;
  let ec = "#9a948a";
  if (isObj(edgingRaw)) {
    const e = reader(edgingRaw, `${r.where}, edging`);
    ew = e.num("width", 100, 20, 2000, " mm");
    eh = e.num("height", 50, 0, 2000, " mm");
    ec = e.color("color", ec);
  } else if (edgingRaw !== true) r.fail("edging must be true, false or {width, height, color}");
  const g = out.group(label);
  out.add(def.category, label, color, prismOf(outline, top - thickness, top), g, def.opacity);
  const lines = sides.length ? sides.map((s) => ({ path: s, closed: false })) : [{ path: outline, closed: true }];
  for (const { path, closed } of lines) {
    const { runs } = wallRuns(path, closed, ew);
    for (const run of runs) out.add(def.category, `${label} edging`, ec, prismOf(runPiece(run, ew, -Infinity, Infinity), top - thickness, top + eh), g);
  }
}

function buildHedge(r: Reader, out: Out): void {
  const { path, closed } = pathOf(r, "path", false);
  const width = r.num("width", 600, 50, 10_000, " mm");
  const height = r.num("height", 1500, 50, 20_000, " mm");
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const color = r.color("color", "#3f6b2e");
  const label = out.own("Hedge");
  const { runs } = wallRuns(path, closed, width);
  const g = runs.length > 1 ? out.group(label) : undefined;
  for (const run of runs) out.add("Planting", label, color, prismOf(runPiece(run, width, -Infinity, Infinity), base, base + height), g);
}

function buildFence(r: Reader, out: Out): void {
  const { path, closed } = pathOf(r, "path", false);
  const style = r.pick("style", ["panel", "picket", "post-and-rail", "close-board"] as const, "panel");
  const height = r.num("height", style === "picket" ? 1000 : style === "post-and-rail" ? 1200 : 1800, 300, 5000, " mm");
  const spacing = r.num("postSpacing", 1800, 300, 10_000, " mm");
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const color = r.color("color", style === "picket" ? "#ecebe6" : "#7d5f40");
  const label = out.own("Fence");
  const g = out.group(label);
  const part = (name: string, shape: Shape | null, c = color): void => out.add("Fences", `${label} ${name}`, c, shape, g);
  const m = path.length;
  const n = closed ? m : m - 1;
  const postTop = height + (style === "post-and-rail" ? 0 : 75);
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % m];
    const L = dist(a, b);
    const u = unit(sub(b, a));
    const f: Frame = { o: a, s: u, n: left(u), z: base };
    const bays = Math.max(1, Math.ceil(L / spacing - 1e-9));
    const posts = Array.from({ length: bays + 1 }, (_, k) => (L * k) / bays);
    posts.forEach((s, k) => {
      // each corner's post comes once, with the run leaving it
      if (k === bays && (closed || i < n - 1)) return;
      part("post", fbox(f, s - 50, s + 50, -50, 50, 0, postTop));
    });
    for (let k = 0; k < bays; k++) {
      const s0 = posts[k] + 50;
      const s1 = posts[k + 1] - 50;
      if (s1 - s0 < 50) continue;
      if (style === "panel" || style === "close-board") {
        part("gravel board", fbox(f, s0, s1, -12, 12, 0, 150));
        part(style === "panel" ? "panel" : "boards", fbox(f, s0, s1, -15, 15, 150, height - (style === "close-board" ? 30 : 0)));
        if (style === "close-board") {
          part("capping", fbox(f, s0 - 50, s1 + 50, -35, 35, height - 30, height));
          for (const z of [350, height - 420]) part("arris rail", fbox(f, s0, s1, -60, -15, z, z + 70));
        }
      } else if (style === "picket") {
        for (const z of [250, height - 300]) part("rail", fbox(f, s0 - 50, s1 + 50, -40, -15, z, z + 70));
        const pw = 75;
        const gap = 55;
        const count = Math.max(1, Math.floor((s1 - s0 + gap) / (pw + gap)));
        const start = (s0 + s1) / 2 - (count * pw + (count - 1) * gap) / 2;
        for (let j = 0; j < count; j++) {
          const p0 = start + j * (pw + gap);
          const p1 = p0 + pw;
          part("picket", fprofile(f, [[p0, 40], [p1, 40], [p1, height - 60], [(p0 + p1) / 2, height], [p0, height - 60]], -15, 5));
        }
      } else {
        for (const t of [0.3, 0.6, 0.9]) {
          const z = height * t;
          part("rail", fbox(f, s0 - 50, s1 + 50, 50, 90, z - 45, z + 45));
        }
      }
    }
  }
  if (!closed) {
    const a = path[m - 2];
    const b = path[m - 1];
    const u = unit(sub(b, a));
    part("post", fbox({ o: b, s: u, n: left(u), z: base }, -50, 50, -50, 50, 0, postTop));
  }
}

// ---- trees and solids ---------------------------------------------------------------------------

/** A repeatable random sequence in [0, 1) for a place, so a tree looks the same every time it's built. */
function seeded(x: number, y: number, salt = 0): () => number {
  let s = (Math.imul(Math.round(x) | 0, 73856093) ^ Math.imul(Math.round(y) | 0, 19349663) ^ Math.imul(salt + 1, 83492791)) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const GOLD = (1 + Math.sqrt(5)) / 2;
const ICO_V: V3[] = (
  [
    [-1, GOLD, 0],
    [1, GOLD, 0],
    [-1, -GOLD, 0],
    [1, -GOLD, 0],
    [0, -1, GOLD],
    [0, 1, GOLD],
    [0, -1, -GOLD],
    [0, 1, -GOLD],
    [GOLD, 0, -1],
    [GOLD, 0, 1],
    [-GOLD, 0, -1],
    [-GOLD, 0, 1],
  ] as V3[]
).map((v) => {
  const k = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / k, v[1] / k, v[2] / k];
});
const ICO_F = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** A lumpy low-poly ball: an icosahedron with radii r, each corner pushed in or out by up to `rough`. */
function blob(c: V3, r: V3, rand: () => number, rough: number): Shape | null {
  const verts = ICO_V.map((v): V3 => {
    const k = 1 + (rand() * 2 - 1) * rough;
    return [c[0] + v[0] * r[0] * k, c[1] + v[1] * r[1] * k, c[2] + v[2] * r[2] * k];
  });
  return meshOf(ICO_F.map((f) => f.map((i) => verts[i])));
}

/** A sphere as an icosahedron split once: 80 faces. */
function sphere(c: V3, r: number): Shape | null {
  const faces: V3[][] = [];
  const at = (v: V3): V3 => [c[0] + v[0] * r, c[1] + v[1] * r, c[2] + v[2] * r];
  const midway = (a: V3, b: V3): V3 => {
    const m: V3 = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    const k = Math.hypot(m[0], m[1], m[2]);
    return [m[0] / k, m[1] / k, m[2] / k];
  };
  for (const [i, j, k] of ICO_F) {
    const [a, b, d] = [ICO_V[i], ICO_V[j], ICO_V[k]];
    const ab = midway(a, b);
    const bd = midway(b, d);
    const da = midway(d, a);
    faces.push([a, ab, da], [b, bd, ab], [d, da, bd], [ab, bd, da]);
  }
  return meshOf(faces.map((f) => f.map(at)));
}

/** A cone, or a frustum when r1 > 0, on n sides. */
function cone(c: Pt, r0: number, r1: number, z0: number, z1: number, n: number, phase = 0): Shape | null {
  const ring = (r: number, z: number): V3[] => circle(c, r, n, phase).map((p): V3 => [p.x, p.y, z]);
  const bottom = ring(r0, z0);
  if (r1 > 0) return meshOf(loft(bottom, ring(r1, z1)));
  const apex: V3 = [c.x, c.y, z1];
  return meshOf([[...bottom].reverse(), ...bottom.map((p, i) => [p, bottom[(i + 1) % n], apex])]);
}

function octahedron(c: V3, r: number): Shape | null {
  const v: V3[] = [[r, 0, 0], [0, r, 0], [-r, 0, 0], [0, -r, 0]].map((p): V3 => [c[0] + p[0], c[1] + p[1], c[2]]);
  const up: V3 = [c[0], c[1], c[2] + r];
  const down: V3 = [c[0], c[1], c[2] - r];
  return meshOf(v.flatMap((p, i) => [[p, v[(i + 1) % 4], up], [v[(i + 1) % 4], p, down]]));
}

function buildTree(r: Reader, out: Out): void {
  const at = r.pt("at");
  const type = r.pick("type", ["deciduous", "conifer", "fruit"] as const, "deciduous");
  const H = r.num("height", type === "fruit" ? 3500 : type === "conifer" ? 8000 : 6000, 500, 60_000, " mm");
  const spread = r.num("spread", type === "fruit" ? 3000 : type === "conifer" ? 3500 : 4000, 300, 60_000, " mm");
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const color = r.color("color", type === "conifer" ? "#2f5a3a" : type === "fruit" ? "#5f8a3a" : "#4f7a3a");
  const trunkColor = r.color("trunkColor", "#6b4f3a");
  const label = out.own("Tree");
  const g = out.group(label);
  const rand = seeded(at.x, at.y);
  const trunkR = clamp(H / 45, 50, 500);
  const rh = spread / 2;
  if (type === "conifer") {
    out.add("Planting", `${label} trunk`, trunkColor, prismOf(circle(at, trunkR, 8), base, base + H * 0.3), g);
    for (let k = 0; k < 3; k++) {
      const z0 = base + H * (0.15 + 0.22 * k);
      const z1 = k === 2 ? base + H : base + H * (0.55 + 0.2 * k);
      out.add("Planting", `${label} foliage`, shade(color, 1 + 0.06 * k), cone(at, rh * (1 - 0.27 * k), 0, z0, z1, 8, rand() * Math.PI), g);
    }
    return;
  }
  const fruit = type === "fruit";
  out.add("Planting", `${label} trunk`, trunkColor, prismOf(circle(at, trunkR, 8), base, base + H * (fruit ? 0.5 : 0.58)), g);
  const rv = H * (fruit ? 0.3 : 0.31);
  const cz = base + H - rv;
  const turn = rand() * Math.PI * 2;
  const off = (dx: number, dy: number): [number, number] => [at.x + dx * Math.cos(turn) - dy * Math.sin(turn), at.y + dx * Math.sin(turn) + dy * Math.cos(turn)];
  const blobs: [number, number, number, number][] = fruit
    ? [[0, 0, 0, 0.92], [0.3, -0.2, 0.12, 0.6]]
    : [[0, 0, 0, 0.82], [0.32, 0.12, -0.12, 0.62], [-0.28, -0.22, 0.14, 0.6], [-0.1, 0.34, 0.05, 0.55]];
  blobs.forEach(([dx, dy, dz, s], i) => {
    const [x, y] = off(dx * rh, dy * rh);
    out.add("Planting", `${label} canopy`, shade(color, 1 + (i % 2 ? 0.08 : -0.02)), blob([x, y, cz + dz * rv], [rh * s, rh * s, rv * s], rand, 0.14), g);
  });
  if (fruit) {
    for (let i = 0; i < 6; i++) {
      const a = turn + (i * Math.PI * 2) / 6 + rand() * 0.4;
      const [x, y] = off(Math.cos(a) * rh * 0.82, Math.sin(a) * rh * 0.82);
      out.add("Planting", `${label} fruit`, "#c0392b", octahedron([x, y, cz - rv * 0.25 + rand() * rv * 0.3], 60), g);
    }
  }
}

function buildShrub(r: Reader, out: Out): void {
  const at = r.pt("at");
  const raw = r.raw("size");
  const [d, h] = isNum(raw) ? [raw, raw * 0.8] : r.size("size", [1200, 960], 100, 20_000);
  const base = r.num("base", 0, -100_000, 100_000, " mm");
  const color = r.color("color", "#557a3a");
  out.add("Planting", out.own("Shrub"), color, blob([at.x, at.y, base + h * 0.47], [d / 2, d / 2, h / 2], seeded(at.x, at.y, 7), 0.12));
}

function buildSolid(r: Reader, out: Out, kind: "box" | "prism" | "cylinder" | "sphere" | "cone"): void {
  const name = out.own(kind[0].toUpperCase() + kind.slice(1));
  const color = r.color("color", "#bfbfbf");
  const base = kind === "sphere" ? 0 : r.num("base", 0, -1e6, 1e6, " mm");
  const topOf = (): number => {
    const top = r.num("top", undefined, -1e6, 1e6, " mm");
    if (top <= base) r.fail("top must be above base");
    return top;
  };
  let shape: Shape | null;
  if (kind === "box") {
    const at = r.pt("at");
    const [x, y, z] = r.size("size", [1000, 1000, 1000], 1, 1e6);
    shape = prismOf(rectAround(at, x, y, r.num("angle", 0, -360, 360, "°")), base, base + z);
  } else if (kind === "prism") {
    shape = prismOf(polygonOf(r, "outline"), base, topOf());
  } else if (kind === "sphere") {
    const at = r.pt("at");
    shape = sphere([at.x, at.y, r.num("z", undefined, -1e6, 1e6, " mm")], r.num("radius", undefined, 1, 1e6, " mm"));
  } else {
    const at = r.pt("at");
    const radius = r.num("radius", undefined, 1, 1e6, " mm");
    const top = topOf();
    const sides = r.int("sides", 16, 3, 64);
    shape = kind === "cylinder" ? prismOf(circle(at, radius, sides), base, top) : cone(at, radius, r.num("topRadius", 0, 0, 1e6, " mm"), base, top, sides);
  }
  out.add("Objects", name, color, shape);
}

// ---- products ------------------------------------------------------------------------------------
// A product's part, as a mechanical modeller makes one: blocks and profiles drawn in a plane and
// extruded square to it, added together, with others cut away (holes, slots, pockets, recesses).
// The result is one closed mesh, so it checks closed and exports to STL watertight.

/** most triangles a part's shapes may have between them, for the cutting to stay quick */
const PART_TRIANGLES = 30_000;
const PLANES = ["xy", "xz", "yz"] as const;

/** A loop's triangles extruded from w0 to w1 along the plane's third axis, x y z each corner. */
function partPrism(loop: readonly Pt[], plane: (typeof PLANES)[number], w0: number, w1: number): number[] {
  const place = (u: number, v: number, w: number): number[] => (plane === "xy" ? [u, v, w] : plane === "xz" ? [u, w, v] : [w, u, v]);
  const out: number[] = [];
  const flat = loop.flatMap((p) => [p.x, p.y]);
  const caps = earcut(flat);
  for (let i = 0; i + 2 < caps.length; i += 3) {
    const [a, b, c] = [loop[caps[i]], loop[caps[i + 1]], loop[caps[i + 2]]];
    out.push(...place(a.x, a.y, w1), ...place(b.x, b.y, w1), ...place(c.x, c.y, w1));
    out.push(...place(a.x, a.y, w0), ...place(c.x, c.y, w0), ...place(b.x, b.y, w0));
  }
  for (let i = 0; i < loop.length; i++) {
    const [a, b] = [loop[i], loop[(i + 1) % loop.length]];
    out.push(...place(a.x, a.y, w0), ...place(b.x, b.y, w0), ...place(b.x, b.y, w1));
    out.push(...place(a.x, a.y, w0), ...place(b.x, b.y, w1), ...place(a.x, a.y, w1));
  }
  // the cut reads each mesh's own winding (outward), so a plane that mirrors needs no care here
  return out;
}

/** A rectangle with its corners rounded by `round` (8 steps a corner), counter-clockwise. */
function roundedRect(u0: number, v0: number, u1: number, v1: number, round: number): Pt[] {
  const r = Math.min(round, (u1 - u0) / 2, (v1 - v0) / 2);
  if (!(r > 0.01)) return [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  const out: Pt[] = [];
  const corners: [number, number, number][] = [
    [u1 - r, v0 + r, -90],
    [u1 - r, v1 - r, 0],
    [u0 + r, v1 - r, 90],
    [u0 + r, v0 + r, 180],
  ];
  for (const [cu, cv, a0] of corners) for (let k = 0; k <= 8; k++) out.push(P(cu + r * Math.cos(rad(a0 + (90 * k) / 8)), cv + r * Math.sin(rad(a0 + (90 * k) / 8))));
  return tidy(out, 0.001);
}

/** One of a part's shapes as triangles, or an error naming it. */
function partShape(r: Reader, list: string, i: number, s: Json): number[] {
  const fail = (m: string): never => r.fail(`${list} ${i + 1}: ${m}`);
  const nums = (v: unknown, n: number, what: string): number[] => (Array.isArray(v) && v.length === n && v.every(isNum) ? (v as number[]) : fail(`${what} must be ${n} numbers`));
  const known = new Set(["box", "plane", "from", "to", "outline", "rect", "round", "circle", "sides"]);
  const extra = Object.keys(s).filter((k) => !known.has(k));
  if (extra.length) fail(`unknown field${extra.length === 1 ? "" : "s"} ${extra.join(", ")}`);
  if (s.box !== undefined) {
    const [a, b, c, d, e, f] = nums(s.box, 6, "box ([x0, y0, z0, x1, y1, z1])");
    const [x0, x1, y0, y1, z0, z1] = [Math.min(a, d), Math.max(a, d), Math.min(b, e), Math.max(b, e), Math.min(c, f), Math.max(c, f)];
    if (!(x1 - x0 > 0.01 && y1 - y0 > 0.01 && z1 - z0 > 0.01)) fail("box has no size");
    return partPrism([P(x0, y0), P(x1, y0), P(x1, y1), P(x0, y1)], "xy", z0, z1);
  }
  const plane = (s.plane ?? "xy") as (typeof PLANES)[number];
  if (!PLANES.includes(plane)) fail(`plane is one of ${PLANES.join(", ")}`);
  if (!isNum(s.from) || !isNum(s.to)) fail(`from and to are needed: where it runs along ${plane === "xy" ? "z" : plane === "xz" ? "y" : "x"}`);
  const [w0, w1] = [Math.min(s.from as number, s.to as number), Math.max(s.from as number, s.to as number)];
  if (!(w1 - w0 > 0.01)) fail("from and to must differ");
  let loop: Pt[];
  if (s.outline !== undefined) {
    const pts = Array.isArray(s.outline) ? s.outline.map((p) => (Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]) ? P(p[0], p[1]) : isObj(p) && isNum(p.x) && isNum(p.y) ? P(p.x, p.y) : null)) : [];
    if (pts.length < 3 || pts.some((p) => !p)) fail("outline must be at least 3 points [u, v]");
    loop = tidy(pts as Pt[], 0.001);
    if (loop.length < 3) fail("outline needs at least 3 distinct corners");
    if (!isSimple(loop)) fail("outline crosses itself");
  } else if (s.rect !== undefined) {
    const [a, b, c, d] = nums(s.rect, 4, "rect ([u0, v0, u1, v1])");
    if (s.round !== undefined && (!isNum(s.round) || s.round < 0)) fail("round must be a radius");
    loop = roundedRect(Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d), (s.round as number | undefined) ?? 0);
  } else if (s.circle !== undefined) {
    const [u, v, radius] = nums(s.circle, 3, "circle ([u, v, radius])");
    if (!(radius > 0)) fail("circle's radius must be more than 0");
    const sides = s.sides === undefined ? 32 : isNum(s.sides) && Number.isInteger(s.sides) && s.sides >= 3 && s.sides <= 128 ? s.sides : fail("sides must be a whole number from 3 to 128");
    loop = circle(P(u, v), radius, sides);
  } else return fail("give a box, or an outline, rect or circle with a plane, from and to");
  if (Math.abs(signedArea(loop)) < 0.01) fail("it has no area");
  return partPrism(ccwLoop(loop), plane, w0, w1);
}

function buildPart(r: Reader, out: Out): void {
  const name = out.own("Part");
  const color = r.color("color", "#d9d9d9");
  const adds = r.list("add");
  if (!adds.length) r.fail("add is needed: the shapes the part is made of");
  const cuts = r.list("cut");
  const add = adds.map((s, i) => partShape(r, "add", i, s));
  const cut = cuts.map((s, i) => partShape(r, "cut", i, s));
  const total = [...add, ...cut].reduce((n, t) => n + t.length / 9, 0);
  if (total > PART_TRIANGLES) r.fail(`its shapes have ${Math.round(total)} triangles between them, more than ${PART_TRIANGLES} can be cut: use fewer sides on circles, or split it into parts`);
  const body = add.length > 1 ? unionMeshes(add, PART_TRIANGLES)?.triangles : Float64Array.from(add[0]);
  const solid = body && cut.length ? subtractMeshes(body, cut, PART_TRIANGLES)?.triangles : body;
  if (!solid || solid.length < 36) r.fail("nothing is left once the cuts are taken away");
  // specks under a hundredth of a millimetre go: they print as nothing and read as faults
  const tris = outward(cleanMesh(solid, 0.01), 1e-6);
  const faces: V3[][] = [];
  for (let i = 0; i + 8 < tris.length; i += 9) faces.push([[tris[i], tris[i + 1], tris[i + 2]], [tris[i + 3], tris[i + 4], tris[i + 5]], [tris[i + 6], tris[i + 7], tris[i + 8]]]);
  out.add("Parts", name, color, meshOf(faces));
}

// ---- the build ---------------------------------------------------------------------------------

const BUILDERS: Record<string, (r: Reader, out: Out) => void> = {
  walls: buildWalls,
  window: (r, out) => buildOpening(r, out, false),
  door: (r, out) => buildOpening(r, out, true),
  slab: (r, out) => buildSlab(r, out, false),
  floor: (r, out) => buildSlab(r, out, true),
  roof: buildRoof,
  chimney: buildChimney,
  steps: buildSteps,
  hedge: buildHedge,
  fence: buildFence,
  tree: buildTree,
  shrub: buildShrub,
  ...Object.fromEntries((Object.keys(SURFACES) as SurfaceKind[]).map((k) => [k, (r: Reader, out: Out) => buildSurface(r, out, k)])),
  ...Object.fromEntries((["box", "prism", "cylinder", "sphere", "cone"] as const).map((k) => [k, (r: Reader, out: Out) => buildSolid(r, out, k)])),
  part: buildPart,
};
const ALIASES: Record<string, string> = { wall: "walls", bush: "shrub", stairs: "steps", stair: "steps" };

/** Throws an Error naming the element (by index and kind) and the field for bad input. */
export function buildParts(specs: readonly unknown[]): { parts: BuildPart[]; notes: string[] } {
  if (!Array.isArray(specs)) throw new Error("the elements must be a list");
  const ctx: Ctx = { parts: [], notes: [], counts: new Map(), groups: new Set() };
  specs.forEach((spec, i) => {
    const kindRaw = isObj(spec) ? spec.kind : undefined;
    if (!isObj(spec) || typeof kindRaw !== "string") throw new Error(`element ${i + 1}: must be an object with a kind (one of ${Object.keys(BUILDERS).join(", ")})`);
    const kind = ALIASES[kindRaw.toLowerCase()] ?? kindRaw.toLowerCase();
    const where = `element ${i + 1} (${kindRaw})`;
    const make = BUILDERS[kind];
    if (!make) throw new Error(`${where}: unknown kind "${kindRaw}"; the kinds are ${Object.keys(BUILDERS).join(", ")}`);
    const r = reader(spec, where);
    make(r, output(ctx, r));
    const extra = r.unused();
    if (extra.length) ctx.notes.push(`${where}: ignored ${extra.join(", ")}, which ${extra.length === 1 ? "doesn't" : "don't"} apply here`);
  });
  return { parts: ctx.parts, notes: ctx.notes };
}
