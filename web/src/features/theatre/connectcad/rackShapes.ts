// The sums behind ConnectCAD's Equipment Rack 3D (equipmentRack.ts): a rack's overall size from its
// mounting area and frame, what editing an overall size does to the rest (Vectorworks keeps the
// mounting area in whole rack units and lets the base, the posts or the opening make up the
// difference), and what it draws: its outline in plan and its parts in 3D. A rack stands with its
// front along local y = 0, centred on x = 0, running back to y = its overall depth. Kept apart so it
// runs without the page.

import type { Pt } from "../../../core/index.ts";
import { RACK_UNIT } from "../../../app/rackRulerShapes.ts";
import { prism, type Solid } from "../../../app/solids3d.ts";

export const RACK_STYLES = ["Rack (4-post)", "Rack (2-post)", "Console", "Enclosure"] as const;
export type RackStyle = (typeof RACK_STYLES)[number];

/** the standard openings, by the width of what fits them, mm */
export const RACK_OPENINGS: readonly { readonly label: string; readonly width: number }[] = [
  { label: '10"', width: 254 },
  { label: '19"', width: 482.6 },
  { label: '23"', width: 584.2 },
  { label: '24"', width: 609.6 },
];
export const CUSTOM_OPENING = "Custom";

/** the thinnest post (or a console's cladding) narrowing a rack leaves, mm */
export const MIN_POST = 10;

/** What a rack is made of, as kept; its overall size follows (rackOverall). */
export interface RackSize {
  readonly style: RackStyle;
  /** the mounting area's height in rack units (not an enclosure's) */
  readonly units: number;
  /** an enclosure's overall height, mm */
  readonly enclosureHeight: number;
  /** the opening's width, mm */
  readonly opening: number;
  /** Depth: between the front and rear rails, or a 2-post rack's or console's footprint */
  readonly depth: number;
  readonly postWidth: number;
  readonly postDepth: number;
  readonly top: number;
  readonly base: number;
  /** a console's mounting face, degrees back from upright */
  readonly slope: number;
  /** a console's cladding */
  readonly panel: number;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;
/** a size worked out, to a millionth of a millimetre */
const tidy = (mm: number): number => Math.round(mm * 1e6) / 1e6;

/** The mounting area's height, mm. */
export const mountHeight = (k: RackSize): number => (k.style === "Enclosure" ? Math.max(0, k.enclosureHeight - k.top - k.base) : k.units * RACK_UNIT);

/** what a rack's frame adds to its opening on each side */
const side = (k: RackSize): number => (k.style === "Console" ? k.panel : k.postWidth);
/** what it adds to its depth, front and back */
const ends = (k: RackSize): number => (k.style === "Rack (4-post)" ? 2 * k.postDepth : k.style === "Enclosure" ? k.postDepth : 0);

/** A rack's overall height, width and depth. */
export function rackOverall(k: RackSize): { height: number; width: number; depth: number } {
  const height = k.style === "Enclosure" ? k.enclosureHeight : k.style === "Console" ? k.base + mountHeight(k) * Math.cos(rad(k.slope)) + k.top : k.base + mountHeight(k) + k.top;
  return { height, width: k.opening + 2 * side(k), depth: k.depth + ends(k) };
}

/** The opening a width asks for: a standard one's label, or Custom. */
export const openingLabel = (width: number): string => RACK_OPENINGS.find((o) => Math.abs(o.width - width) < 0.01)?.label ?? CUSTOM_OPENING;

export type OverallField = "height" | "width" | "depth";

/**
 * What a rack becomes when one of its overall sizes is set: a new height keeps the mounting area in
 * whole units, the base making up the rest (an enclosure just takes it); a new width changes the posts
 * (a console's cladding), and when they'd be thinner than MIN_POST, the opening drops to the largest
 * standard one that leaves room for them, else to whatever does; a new depth changes Depth.
 */
export function overallSet(k: RackSize, field: OverallField, value: number): RackSize {
  if (!(value > 0)) throw new Error("A rack's size has to be more than 0.");
  if (field === "depth") {
    const depth = tidy(value - ends(k));
    if (depth <= 0) throw new Error("That's too shallow for the rack's posts.");
    return { ...k, depth };
  }
  if (field === "width") {
    let opening = k.opening;
    if ((value - opening) / 2 < MIN_POST) {
      const fits = RACK_OPENINGS.filter((o) => (value - o.width) / 2 >= MIN_POST);
      opening = fits.length ? fits[fits.length - 1].width : tidy(value - 2 * MIN_POST);
      if (opening <= 0) throw new Error("That's too narrow for a rack.");
    }
    const post = tidy((value - opening) / 2);
    return k.style === "Console" ? { ...k, opening, panel: post } : { ...k, opening, postWidth: post };
  }
  if (k.style === "Enclosure") {
    if (value <= k.top + k.base) throw new Error("That's no taller than the enclosure's top and base.");
    return { ...k, enclosureHeight: value };
  }
  const unit = k.style === "Console" ? RACK_UNIT * Math.cos(rad(k.slope)) : RACK_UNIT;
  const units = Math.floor((value - k.top - k.base) / unit + 1e-9);
  if (units < 1) throw new Error("That leaves no room for a rack unit between the rack's top and base.");
  return { ...k, units, base: tidy(value - k.top - units * unit) };
}

/** What of a rack is drawn in 3D besides its frame. */
export interface RackOptions {
  readonly rails: boolean;
  readonly sidePanels: boolean;
  readonly frontDoor: boolean;
  readonly rearDoor: boolean;
}

export type RackPart = "frame" | "panel" | "rail" | "door";

export interface RackDrawing {
  /** in plan: its outline, posts (filled), other lines, its front (drawn heavier) and where its Rack ID goes */
  readonly outline: Pt[];
  readonly posts: Pt[][];
  readonly lines: [Pt, Pt][];
  readonly front: [Pt, Pt];
  readonly label: Pt;
  /** in 3D */
  readonly solids: { readonly part: RackPart; readonly faces: Solid }[];
}

/** a rail's width across the rack and its thickness, a door's and a side panel's thickness, mm */
const RAIL_WIDTH = 20;
const RAIL_THICK = 3;
const DOOR_THICK = 15;
const PANEL_THICK = 10;

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];
const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid => prism([rect(x0, y0, x1, y1)], z0, z1);
/** faces drawn with (y, z, x) for their (x, y, z), turned the right way */
const fromSide = (faces: Solid): Solid => faces.map((f) => f.flatMap((_, i) => (i % 3 === 0 ? [f[i + 2], f[i], f[i + 1]] : [])));
/** a box and its mirror across x = 0 */
const pair = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Solid => [...box(x0, x1, y0, y1, z0, z1), ...box(-x1, -x0, y0, y1, z0, z1)];

/** What a rack draws, as its style and options ask (covers and doors not on a 2-post rack, nor rails on a console). */
export function rackDrawing(k: RackSize, options: RackOptions): RackDrawing {
  const { height: H, width: W, depth: D } = rackOverall(k);
  const w = W / 2;
  const o = k.opening / 2;
  const outline = rect(-w, 0, w, D);
  const front: [Pt, Pt] = [
    { x: -w, y: 0 },
    { x: w, y: 0 },
  ];
  const label = { x: 0, y: D / 2 };
  const solids: { part: RackPart; faces: Solid }[] = [];
  const add = (part: RackPart, faces: Solid): void => {
    if (faces.length) solids.push({ part, faces });
  };
  const z0 = k.base;
  const z1 = H - k.top;
  if (k.style === "Rack (4-post)") {
    const pd = k.postDepth;
    add("frame", [...box(-w, w, 0, D, 0, k.base), ...box(-w, w, 0, D, z1, H), ...pair(o, w, 0, pd, z0, z1), ...pair(o, w, D - pd, D, z0, z1)]);
    if (options.rails) add("rail", [...pair(o - RAIL_WIDTH, o, pd, pd + RAIL_THICK, z0, z1), ...pair(o - RAIL_WIDTH, o, D - pd - RAIL_THICK, D - pd, z0, z1)]);
    if (options.sidePanels) add("panel", pair(w - PANEL_THICK, w, pd, D - pd, z0, z1));
    if (options.frontDoor) add("door", box(-o, o, 0, DOOR_THICK, z0, z1));
    if (options.rearDoor) add("door", box(-o, o, D - DOOR_THICK, D, z0, z1));
    return { outline, posts: [rect(o, 0, w, pd), rect(-w, 0, -o, pd), rect(o, D - pd, w, D), rect(-w, D - pd, -o, D)], lines: [], front, label, solids };
  }
  if (k.style === "Rack (2-post)") {
    const y0 = D / 2 - k.postDepth / 2;
    const y1 = D / 2 + k.postDepth / 2;
    add("frame", [...box(-w, w, 0, D, 0, k.base), ...pair(o, w, y0, y1, z0, z1), ...box(-w, w, y0, y1, z1, H)]);
    if (options.rails) add("rail", pair(o - RAIL_WIDTH, o, y0 - RAIL_THICK, y0, z0, z1));
    return { outline, posts: [rect(o, y0, w, y1), rect(-w, y0, -o, y1)], lines: [], front, label, solids };
  }
  if (k.style === "Console") {
    const s = rad(k.slope);
    const m = mountHeight(k);
    const yTop = m * Math.sin(s);
    const zFace = k.base + m * Math.cos(s);
    // its side profile (y, z) carried across its width
    const profile = [
      { x: 0, y: 0 },
      { x: D, y: 0 },
      { x: D, y: H },
      { x: yTop, y: H },
      { x: yTop, y: zFace },
      { x: 0, y: k.base },
    ];
    add("panel", fromSide(prism([profile], -w, w)));
    return { outline, posts: [], lines: [[{ x: -w, y: yTop }, { x: w, y: yTop }]], front, label, solids };
  }
  // an enclosure: walls the posts' width thick, a back the posts' depth, open at the front but for its door
  const t = k.postWidth;
  add("panel", [...box(-w, w, 0, D, 0, k.base), ...box(-w, w, 0, D, z1, H), ...pair(w - t, w, 0, D, z0, z1), ...box(-w + t, w - t, D - k.postDepth, D, z0, z1)]);
  if (options.frontDoor) add("door", box(-w + t, w - t, 0, DOOR_THICK, z0, z1));
  const back = D - k.postDepth;
  const inside: [Pt, Pt][] = [
    [{ x: -w + t, y: 0 }, { x: -w + t, y: back }],
    [{ x: -w + t, y: back }, { x: w - t, y: back }],
    [{ x: w - t, y: back }, { x: w - t, y: 0 }],
  ];
  return { outline, posts: [], lines: inside, front, label, solids };
}

export const MOUNTINGS = ["Front", "Rear"] as const;
export type Mounting = (typeof MOUNTINGS)[number];

/**
 * Where equipment mounts in a rack, in the rack's frame: the face its front goes against (y, and z
 * at the face's foot), how far the face leans back (a console's, degrees), whether equipment there
 * faces the back (turned round), its units and the opening's width, and the rack's overall height,
 * where what doesn't fit sits on top.
 */
export interface MountFace {
  readonly y: number;
  readonly z: number;
  readonly slope: number;
  readonly rear: boolean;
  readonly units: number;
  readonly width: number;
  readonly top: number;
}

/** A rack's front or rear mounting face (a console has only its front; an enclosure's front is behind its door). */
export function mountFace(k: RackSize, mounting: Mounting): MountFace {
  const { height, depth } = rackOverall(k);
  const units = k.style === "Enclosure" ? Math.floor(mountHeight(k) / RACK_UNIT + 1e-9) : k.units;
  const face = (y: number, rear: boolean, slope = 0): MountFace => ({ y, z: k.base, slope, rear, units, width: k.opening, top: height });
  const rear = mounting === "Rear" && k.style !== "Console";
  if (k.style === "Rack (4-post)") return rear ? face(depth - k.postDepth, true) : face(k.postDepth, false);
  if (k.style === "Rack (2-post)") return rear ? face(depth / 2 + k.postDepth / 2, true) : face(depth / 2 - k.postDepth / 2, false);
  if (k.style === "Enclosure") return rear ? face(depth - k.postDepth, true) : face(DOOR_THICK, false);
  return face(0, false, k.slope);
}

/** Where unit `u` (1 at the bottom) starts on a mount face, in the rack's frame; past its units, or below 1, on the rack's top. */
export function unitAt(f: MountFace, u: number): { y: number; z: number; slope: number } {
  if (u < 1 || u > f.units) return { y: f.y, z: f.top, slope: 0 };
  const s = rad(f.slope);
  const up = (u - 1) * RACK_UNIT;
  return { y: f.y + (f.rear ? -1 : 1) * up * Math.sin(s), z: f.z + up * Math.cos(s), slope: f.slope };
}

/** The highest unit a piece `units` tall fits from with none of `taken` in the way (each from its unit up so many); past the rack's units (on top) when it's full. */
export function firstFreeUnit(rackUnits: number, taken: readonly { readonly u: number; readonly units: number }[], units: number): number {
  const need = Math.max(1, Math.ceil(units));
  const busy = (u: number): boolean => taken.some((t) => t.u >= 1 && u >= t.u && u < t.u + Math.max(1, Math.ceil(t.units)));
  for (let u = rackUnits - need + 1; u >= 1; u--) {
    let free = true;
    for (let k = u; k < u + need; k++) if (busy(k)) free = false;
    if (free) return u;
  }
  return rackUnits + 1;
}

/** where equipment's front panel stands out from the face, and how far in from it the body is narrowed for the rails, mm */
export const FACE_PLATE = 3;
export const EAR = 25;

/** Faces leaned back `slope` degrees about the x axis, their tops going back (+y). */
const leanBack = (faces: Solid, slope: number): Solid => {
  const s = rad(slope);
  return faces.map((f) => f.flatMap((v, i) => (i % 3 === 0 ? [v, f[i + 1] * Math.cos(s) + f[i + 2] * Math.sin(s), -f[i + 1] * Math.sin(s) + f[i + 2] * Math.cos(s)] : [])));
};

/** The outline from above of what's `width` wide over parts' faces. */
const outlineOf = (width: number, parts: readonly Solid[]): Pt[] => {
  const ys = parts.flat().flatMap((f) => f.filter((_, i) => i % 3 === 1));
  return rect(-width / 2, Math.min(...ys), width / 2, Math.max(...ys));
};

/**
 * Equipment as a box (or a front panel and, narrowed by `ear` each side for a rack's rails, a body
 * behind it) in its own frame: front along y = 0 at the face, up z, leaning back `slope` degrees;
 * and its outline from above. A module in a frame's slot has a panel and no ears.
 */
export function equipmentSolid(width: number, height: number, depth: number, racked: boolean, slope: number, ear = EAR): { panel: Solid; body: Solid; outline: Pt[] } {
  const w = width / 2;
  const eared = racked && w > ear;
  const panel = eared ? leanBack(box(-w, w, -FACE_PLATE, 0, 0, height), slope) : [];
  const body = leanBack(eared ? box(-(w - ear), w - ear, 0, depth, 0, height) : box(-w, w, 0, depth, 0, height), slope);
  return { panel, body, outline: outlineOf(width, [panel, body]) };
}

/** how far an adapter slot stands proud of its face, so it shows, mm */
const SLOT_PROUD = 1;

/**
 * Adapter slots on equipment's front (its panel's face with `panel`) or rear (its body's back, `depth`
 * behind), in its own frame as equipmentSolid has it: each across from the middle (to the right seen
 * from its side) and up from the foot, standing proud of the face, leaning back `slope` degrees.
 */
export function slotsSolid(slots: readonly { readonly rect: FaceRect; readonly rear: boolean }[], depth: number, panel: boolean, slope: number): Solid {
  const face = panel ? -FACE_PLATE : 0;
  return leanBack(
    slots.flatMap(({ rect: r, rear }) => (rear ? box(-r.x1, -r.x0, depth, depth + SLOT_PROUD, r.z0, r.z1) : box(r.x0, r.x1, face - SLOT_PROUD, face, r.z0, r.z1))),
    slope,
  );
}

export const FRAME_TYPES = ["Frame", "Tray"] as const;
export type FrameType = (typeof FRAME_TYPES)[number];
export const PSU_SIDES = ["Left", "Right"] as const;
export type PsuSide = (typeof PSU_SIDES)[number];
export const SLOT_DIRECTIONS = ["Horizontal", "Vertical"] as const;
export type SlotDirection = (typeof SLOT_DIRECTIONS)[number];

/** a rack frame's walls, a tray's back lip as a share of its height, and its door, mm */
export const FRAME_WALL = 2;
const TRAY_LIP = 0.25;
const FRAME_DOOR = 2;
/** between a door and the fronts behind it */
const DOOR_GAP = 1;
/** round a power supply in its place, so side-by-side ones show apart */
const PSU_GAP = 1;

/** A slot's or a power supply's rectangle on a frame's front: across (x, from its middle) and up (z, from its foot). */
export interface FaceRect {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/**
 * A rack frame's front: `across` × `up` slots in what its ears, walls and power supplies leave,
 * numbered left to right from the top row; and its power supplies, each `psuSize` % of a slot's
 * width, side by side at their side, the frame's full height inside.
 */
export function frameFront(width: number, height: number, across: number, up: number, psus: number, psuSide: PsuSide, psuSize: number): { slots: FaceRect[]; psus: FaceRect[] } {
  const x0 = -width / 2 + EAR + FRAME_WALL;
  const x1 = width / 2 - EAR - FRAME_WALL;
  const z0 = FRAME_WALL;
  const z1 = height - FRAME_WALL;
  const share = psuSize / 100;
  const slotWidth = (x1 - x0) / (across + psus * share);
  const psuWidth = slotWidth * share;
  const supplies = Array.from({ length: psus }, (_, k): FaceRect => (psuSide === "Left" ? { x0: x0 + k * psuWidth, x1: x0 + (k + 1) * psuWidth, z0, z1 } : { x0: x1 - (k + 1) * psuWidth, x1: x1 - k * psuWidth, z0, z1 }));
  const left = psuSide === "Left" ? x0 + psus * psuWidth : x0;
  const slotHeight = (z1 - z0) / up;
  const slots: FaceRect[] = [];
  for (let r = 0; r < up; r++) for (let c = 0; c < across; c++) slots.push({ x0: left + c * slotWidth, x1: left + (c + 1) * slotWidth, z0: z1 - (r + 1) * slotHeight, z1: z1 - r * slotHeight });
  return { slots, psus: supplies };
}

/** The slots a piece `count` slots big takes from slot `start` (numbered from 1), along a row or down a column; null when it runs off the frame. */
export function slotRun(across: number, up: number, start: number, count: number, direction: SlotDirection): number[] | null {
  if (!(start >= 1 && start <= across * up)) return null;
  const n = Math.max(1, Math.round(count));
  const row = Math.floor((start - 1) / across);
  const column = (start - 1) % across;
  if (direction === "Horizontal") return column + n <= across ? Array.from({ length: n }, (_, k) => start + k) : null;
  return row + n <= up ? Array.from({ length: n }, (_, k) => start + k * across) : null;
}

/** The rectangle a run of slots covers. */
export function runRect(slots: readonly FaceRect[], run: readonly number[]): FaceRect {
  const rects = run.map((n) => slots[n - 1]);
  return { x0: Math.min(...rects.map((r) => r.x0)), x1: Math.max(...rects.map((r) => r.x1)), z0: Math.min(...rects.map((r) => r.z0)), z1: Math.max(...rects.map((r) => r.z1)) };
}

/** The first slot a piece `count` slots big fits from with none of `taken` in its way; 0 when it fits nowhere. */
export function firstFreeSlot(across: number, up: number, taken: ReadonlySet<number>, count: number, direction: SlotDirection): number {
  for (let start = 1; start <= across * up; start++) {
    const run = slotRun(across, up, start, count, direction);
    if (run && run.every((n) => !taken.has(n))) return start;
  }
  return 0;
}

/**
 * A rack frame in its own frame (as equipmentSolid): a frame's walls, top, bottom and back, or a
 * tray's bottom and back lip, between ears at its front; its power supplies' boxes; and a door
 * across its front when asked for; leaning back `slope` degrees.
 */
export function frameSolid(type: FrameType, width: number, height: number, depth: number, psus: readonly FaceRect[], door: boolean, slope: number): { body: Solid; ears: Solid; psu: Solid; door: Solid; outline: Pt[] } {
  const w = width / 2;
  const inner = w - EAR;
  const t = FRAME_WALL;
  const body =
    type === "Tray"
      ? [...box(-inner, inner, 0, depth, 0, t), ...box(-inner, inner, depth - t, depth, t, Math.max(2 * t, height * TRAY_LIP))]
      : [...pair(inner - t, inner, 0, depth, 0, height), ...box(-inner + t, inner - t, 0, depth, 0, t), ...box(-inner + t, inner - t, 0, depth, height - t, height), ...box(-inner + t, inner - t, depth - t, depth, t, height - t)];
  const ears = pair(inner, w, -FACE_PLATE, 0, 0, height);
  const psu = psus.flatMap((p) => box(p.x0 + PSU_GAP, p.x1 - PSU_GAP, -FACE_PLATE, depth / 2, p.z0 + PSU_GAP, p.z1 - PSU_GAP));
  const front = door ? box(-inner, inner, -FACE_PLATE - DOOR_GAP - FRAME_DOOR, -FACE_PLATE - DOOR_GAP, 0, height) : [];
  const parts = { body: leanBack(body, slope), ears: leanBack(ears, slope), psu: leanBack(psu, slope), door: leanBack(front, slope) };
  return { ...parts, outline: outlineOf(width, [parts.body, parts.ears, parts.door]) };
}
