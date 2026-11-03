// The sums behind ConnectCAD's Create Rack Elevation and Create Equipment Detail View
// (rackElevation.ts): which of the racks picked stand in a row together (side by side and facing the
// same way), and a row's front or rear drawn flat as someone standing before it sees it: x across to
// their right, z up from the floor. A rack's frame comes from its size (rackShapes.ts), cut just
// inside its face as a section would be, so doors, side panels and an enclosure's back don't hide
// what's mounted; what's mounted comes as rectangles on that face (equipmentItem.ts), as does a piece
// of equipment on its own for its detail view, at a scale it fits. Kept apart so it runs without the
// page.

import type { BBox, Pt } from "../../../core/index.ts";
import { RACK_UNIT } from "../../../app/rackRulerShapes.ts";
import { CHAR_WIDTH } from "../../../app/markerShapes.ts";
import { gapBetween, SIDE_BY_SIDE } from "./cableLengthShapes.ts";
import { mountHeight, rackOverall, type Mounting, type RackSize } from "./rackShapes.ts";

/** A rack picked: its object, its outline on the drawing, where its front's middle stands and which way it faces (degrees). */
export interface PickedRack {
  readonly id: string;
  readonly ring: readonly Pt[];
  readonly at: Pt;
  readonly angle: number;
}

/** A rack in a row: its object, and how far its middle is along the row from the first's, mm (to the right seen from the front). */
export interface RowPlace {
  readonly id: string;
  readonly offset: number;
}

const turnOf = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/**
 * The racks picked in rows: those standing side by side (within `near` of each other, through others
 * picked) and facing the same way go together, left to right seen from the front; the rows in the
 * order their first rack was picked.
 */
export function rackRows(racks: readonly PickedRack[], near = SIDE_BY_SIDE): RowPlace[][] {
  const row = racks.map((_, i) => i);
  const top = (i: number): number => (row[i] === i ? i : (row[i] = top(row[i])));
  for (let i = 0; i < racks.length; i++) {
    for (let j = i + 1; j < racks.length; j++) {
      if (Math.abs(turnOf(racks[i].angle - racks[j].angle)) < 1 && gapBetween(racks[i].ring, racks[j].ring) <= near) row[top(j)] = top(i);
    }
  }
  const rows = new Map<number, PickedRack[]>();
  racks.forEach((r, i) => rows.set(top(i), [...(rows.get(top(i)) ?? []), r]));
  return [...rows.values()].map((rs) => {
    const turn = (rs[0].angle * Math.PI) / 180;
    const along = (p: Pt): number => (p.x - rs[0].at.x) * Math.cos(turn) + (p.y - rs[0].at.y) * Math.sin(turn);
    return rs.map((r) => ({ id: r.id, offset: along(r.at) })).sort((a, b) => a.offset - b.offset);
  });
}

/** What's mounted on a face, as seen from the front of the rack: across it (x from the rack's middle, to the right seen from the front) and up from the floor. */
export interface FacePiece {
  /** an equipment item, a rack frame, modular equipment in a frame's slots, a frame's slot or power supply, a racked piece's ear, or an adapter slot */
  readonly kind: "item" | "frame" | "module" | "slot" | "psu" | "ear" | "adapter";
  readonly name: string;
  /** an adapter slot showing nothing: crossed lines */
  readonly cross?: boolean;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

/** A rack in a row as drawn: its Rack ID, size, whether its rails are drawn, where it is along the row and what's mounted on the side shown. */
export interface RowRack {
  readonly rackId: string;
  readonly size: RackSize;
  readonly rails: boolean;
  readonly offset: number;
  readonly pieces: readonly FacePiece[];
}

export type ElevationPart = "frame" | "rail" | "item" | "frame-item" | "module" | "slot" | "psu" | "ear" | "adapter";

export interface ElevationRect {
  readonly part: ElevationPart;
  readonly x0: number;
  readonly z0: number;
  readonly x1: number;
  readonly z1: number;
  /** with its diagonals drawn */
  readonly cross?: boolean;
}

export interface ElevationText {
  readonly at: Pt;
  readonly text: string;
  readonly height: number;
}

/** One rack's drawing in a row's elevation: its frame, what's mounted, and the writing (names, rack unit numbers, its Rack ID below). */
export interface RackElevation {
  readonly rects: ElevationRect[];
  readonly texts: ElevationText[];
}

/** a rail's width across the rack, as rackShapes draws it, mm */
const RAIL_WIDTH = 20;
/** writing against the room it has: at most this share of a rectangle's height, and of its width */
const TALL = 0.6;
const WIDE = 0.9;
/** the Rack ID below the rack, against the names' writing, and its gap */
const TITLE = 1.25;
const TITLE_GAP = 0.75;
const PIECE_ORDER: Readonly<Record<FacePiece["kind"], number>> = { frame: 0, item: 1, ear: 2, psu: 3, slot: 4, module: 5, adapter: 6 };
const PART: Readonly<Record<FacePiece["kind"], ElevationPart>> = { frame: "frame-item", item: "item", ear: "ear", psu: "psu", slot: "slot", module: "module", adapter: "adapter" };

/** Writing `text` across a box: as high as `most`, but no higher than fits it. */
function fitted(text: string, x0: number, z0: number, x1: number, z1: number, most: number): ElevationText | null {
  if (!text) return null;
  const height = Math.min(most, TALL * (z1 - z0), (WIDE * (x1 - x0)) / (text.length * CHAR_WIDTH));
  return height > 0 ? { at: { x: (x0 + x1) / 2, y: (z0 + z1) / 2 }, text, height } : null;
}

/** Pieces drawn, `placed` putting each in the view, the frames first and adapter slots last, each named (as high as `text` at most) but a slot, an ear and a frame, whose name would cover its slots, their modules carrying their own; an adapter slot showing nothing crossed. */
function mounted(pieces: readonly FacePiece[], placed: (part: ElevationPart, x0: number, z0: number, x1: number, z1: number) => ElevationRect, text: number): RackElevation {
  const rects: ElevationRect[] = [];
  const texts: ElevationText[] = [];
  for (const p of [...pieces].sort((a, b) => PIECE_ORDER[a.kind] - PIECE_ORDER[b.kind])) {
    const q = placed(PART[p.kind], p.x0, p.z0, p.x1, p.z1);
    rects.push(p.cross ? { ...q, cross: true } : q);
    const t = p.kind === "slot" || p.kind === "frame" || p.kind === "ear" ? null : fitted(p.name, q.x0, q.z0, q.x1, q.z1, text);
    if (t) texts.push(t);
  }
  return { rects, texts };
}

/** A rack's frame as seen face on, cut just inside its face: across from its middle (symmetric), up from the floor. */
function frameFace(k: RackSize, rails: boolean, side: Mounting): ElevationRect[] {
  const { height: H, width: W } = rackOverall(k);
  const w = W / 2;
  const o = k.opening / 2;
  const rect = (part: ElevationPart, x0: number, z0: number, x1: number, z1: number): ElevationRect => ({ part, x0, z0, x1, z1 });
  if (k.style === "Console") {
    // seen from behind, its back; from the front, its base, cladding and top round the sloping face
    if (side === "Rear") return [rect("frame", -w, 0, w, H)];
    const zFace = k.base + mountHeight(k) * Math.cos((k.slope * Math.PI) / 180);
    return [rect("frame", -w, 0, w, k.base), rect("frame", -w, k.base, -o, zFace), rect("frame", o, k.base, w, zFace), rect("frame", -w, zFace, w, H)];
  }
  const z0 = k.base;
  const z1 = H - k.top;
  const out = [rect("frame", -w, 0, w, z0), rect("frame", -w, z1, w, H), rect("frame", -w, z0, -o, z1), rect("frame", o, z0, w, z1)];
  if (rails && k.style !== "Enclosure") out.push(rect("rail", -o, z0, -o + RAIL_WIDTH, z1), rect("rail", o - RAIL_WIDTH, z0, o, z1));
  return out;
}

/**
 * A row's front or rear as seen from that side, its racks left to right as they stand there: each
 * rack's frame, the fronts of what's mounted on that side with their names (as `mounted` draws
 * them), rack unit numbers up the left post or rail (not an enclosure's or a console's), and its
 * Rack ID below. Seen from the rear, the row runs the other way, and so does each rack.
 */
export function rackElevation(row: readonly RowRack[], side: Mounting, text: number): { racks: RackElevation[]; box: BBox } {
  const flip = side === "Rear" ? -1 : 1;
  const drawn = row.map((r): RackElevation & { reach: BBox } => {
    const across = (x: number): number => flip * (r.offset + x);
    const placed = (part: ElevationPart, x0: number, z0: number, x1: number, z1: number): ElevationRect => {
      const [a, b] = [across(x0), across(x1)];
      return { part, x0: Math.min(a, b), z0, x1: Math.max(a, b), z1 };
    };
    const inside = mounted(r.pieces, placed, text);
    const rects = [...frameFace(r.size, r.rails, side).map((f) => placed(f.part, f.x0, f.z0, f.x1, f.z1)), ...inside.rects];
    const texts = inside.texts;
    const k = r.size;
    const { height: H, width: W } = rackOverall(k);
    if (k.style === "Rack (4-post)" || k.style === "Rack (2-post)") {
      // up the post (and rail) on the left as seen, each unit's number in its middle
      const left = -flip;
      const inner = r.rails ? k.opening / 2 - RAIL_WIDTH : k.opening / 2;
      const [x0, x1] = [across((left * W) / 2), across(left * inner)].sort((a, b) => a - b);
      for (let u = 1; u <= k.units; u++) {
        const z = k.base + (u - 1) * RACK_UNIT;
        const t = fitted(String(u), x0, z, x1, z + RACK_UNIT, text);
        if (t) texts.push(t);
      }
    }
    const mid = across(0);
    if (r.rackId) texts.push({ at: { x: mid, y: -TITLE_GAP * TITLE * text - (TITLE * text) / 2 }, text: r.rackId, height: TITLE * text });
    const reach: BBox = {
      x0: Math.min(...rects.map((q) => q.x0), mid - W / 2),
      x1: Math.max(...rects.map((q) => q.x1), mid + W / 2),
      y0: r.rackId ? -(1 + TITLE_GAP) * TITLE * text : 0,
      y1: Math.max(H, ...rects.map((q) => q.z1)),
    };
    return { rects, texts, reach };
  });
  const box = drawn.reduce<BBox | null>((b, { reach: q }) => (b ? { x0: Math.min(b.x0, q.x0), y0: Math.min(b.y0, q.y0), x1: Math.max(b.x1, q.x1), y1: Math.max(b.y1, q.y1) } : q), null);
  return { racks: drawn.map(({ rects, texts }) => ({ rects, texts })), box: box ?? { x0: 0, y0: 0, x1: 0, y1: 0 } };
}

/**
 * An equipment item or rack frame face on, for its detail view: its pieces from that side (as
 * `mounted` draws them), and its name below.
 */
export function equipmentDetail(name: string, pieces: readonly FacePiece[], text: number): { racks: RackElevation[]; box: BBox } {
  const drawn = mounted(pieces, (part, x0, z0, x1, z1) => ({ part, x0, z0, x1, z1 }), text);
  const x0 = Math.min(0, ...drawn.rects.map((q) => q.x0));
  const x1 = Math.max(0, ...drawn.rects.map((q) => q.x1));
  if (name) drawn.texts.push({ at: { x: (x0 + x1) / 2, y: -TITLE_GAP * TITLE * text - (TITLE * text) / 2 }, text: name, height: TITLE * text });
  return { racks: [drawn], box: { x0, x1, y0: name ? -(1 + TITLE_GAP) * TITLE * text : 0, y1: Math.max(0, ...drawn.rects.map((q) => q.z1)) } };
}

/** the scales a detail view may take, and the most it may be on paper across and up, mm */
const DETAIL_SCALES = [1, 2, 5, 10, 20, 25, 50];
const DETAIL_ACROSS = 150;
const DETAIL_UP = 100;

/** The largest standard scale a piece `width` × `height` fits a detail view at. */
export const detailScale = (width: number, height: number): number => DETAIL_SCALES.find((s) => width / s <= DETAIL_ACROSS && height / s <= DETAIL_UP) ?? DETAIL_SCALES[DETAIL_SCALES.length - 1];

/** The views' names: `name` with /F or /R, and a number after it when one's already taken. */
export function viewNames(name: string, sides: readonly Mounting[], taken: ReadonlySet<string>): string[] {
  const named = (base: string): string[] => sides.map((s) => `${base}/${s === "Front" ? "F" : "R"}`);
  for (let n = 1; ; n++) {
    const names = named(n === 1 ? name : `${name} ${n}`);
    if (names.every((v) => !taken.has(v))) return names;
  }
}
