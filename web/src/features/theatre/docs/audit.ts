// The show audit: a preflight of a show's drawing, as findings to act on. Each finding is one plain sentence
// naming the instrument by its unit and position, with its severity, its area and the drawing's objects it
// is about (so a window can select them). Patch, focus, rigging, scenery, venue and data rules; each is noted
// where it is checked. Pure: lengths in mm, angles in degrees, weights in kg; the caller may give the words
// for lengths. It leaves out what a drawing can't tell it: walk paths, cable runs, the ratings of hoists, and
// the real body of an instrument (a square of BODY_HALF_MM either side of its hanging point stands in).

import type { Pt } from "../../../core/index.ts";
import type { Fixture } from "../fixture.ts";
import type { Lineset, PositionInfo, ShopPiece, VenueInfo } from "../showTypes.ts";
import { toStage, type StageFrame } from "../stage.ts";
import { beamOf } from "./beam.ts";

export type Severity = "error" | "warning" | "note";
export type Area = "Patch" | "Focus" | "Rigging" | "Scenery" | "Venue" | "Data";

export interface Finding {
  readonly severity: Severity;
  readonly area: Area;
  readonly text: string;
  /** the drawing's objects it is about, to select */
  readonly ids: string[];
  /** where it is in the drawing, to centre on when there are no objects */
  readonly at?: Pt;
}

/** a piece of scenery placed in the drawing: its bounds in plan, mm (scenes.data) */
export interface ScenicPiece {
  readonly id: string;
  readonly name: string;
  readonly x0: number;
  readonly y0: number;
  readonly w: number;
  readonly h: number;
}

export interface AuditInput {
  readonly fixtures: readonly Fixture[];
  readonly frame: StageFrame;
  /** whether the stage origin has been set, rather than standing in */
  readonly hasStageFrame: boolean;
  readonly linesets: readonly Lineset[];
  readonly positions: readonly PositionInfo[];
  readonly venue: VenueInfo | null;
  readonly shop: readonly ShopPiece[];
  readonly pieces: readonly ScenicPiece[];
  /** a length as the drawing shows it; metres by default */
  readonly format?: (mm: number) => string;
}

/** a focused beam under this, above the horizontal, is flat: long shadows and glare in the front rows */
const FLAT_THROW_DEG = 30;
/** a lens under this, where people walk, is a hazard */
const LOW_LENS_MM = 2000;
/** a platform this high or higher needs a guard rail */
const GUARD_RAIL_MM = 760;
/** A flat's thickness, as the shop's data has none, mm. */
const FLAT_THICK_MM = 100;
const UNIVERSE_CHANNELS = 512;
/** an instrument's body, half its size either side of its hanging point, in plan */
const BODY_HALF_MM = 250;

const metres = (mm: number): string => `${(mm / 1000).toFixed(2)} m`;
const kg = (v: number): string => `${Math.round(v * 10) / 10} kg`;
const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const weightOf = (list: readonly Fixture[]): number => list.reduce((t, f) => t + f.weightKg, 0);

/** An instrument by its unit and position: "Unit 3 @ 1st Electric"; with neither, its type and channel. */
export function nameOf(f: Pick<Fixture, "unit" | "position" | "label" | "channel">): string {
  const unit = f.unit.trim();
  const position = f.position.trim();
  if (!unit && !position) return f.channel.trim() ? `${f.label} on channel ${f.channel.trim()}` : f.label;
  const head = unit ? `Unit ${unit}` : f.label;
  return position ? `${head} @ ${position}` : head;
}

/** The corners of a box in plan, from its bottom left, width and height. */
function boxCorners(x0: number, y0: number, w: number, h: number): Pt[] {
  return [
    { x: x0, y: y0 },
    { x: x0 + w, y: y0 },
    { x: x0 + w, y: y0 + h },
    { x: x0, y: y0 + h },
  ];
}

/** Every finding in the show, in the order of the areas: Patch, Focus, Rigging, Scenery, Venue and Data. */
export function auditShow(input: AuditInput): Finding[] {
  const out: Finding[] = [];
  const fx = input.fixtures;
  const { frame, venue } = input;
  const fmt = input.format ?? metres;
  const add = (severity: Severity, area: Area, text: string, ids: readonly string[] = [], at?: Pt): void => {
    out.push({ severity, area, text, ids: [...ids], ...(at ? { at } : {}) });
  };
  const who = (f: Fixture): string => nameOf(f);

  // Patch. A patched instrument takes `footprint` channels from its address in its universe; 0 is not patched.
  const patched = fx.filter((f) => f.universe > 0 && f.address > 0);
  const endOf = (f: Fixture): number => f.address + Math.max(f.footprint, 1) - 1;
  for (const f of patched) {
    if (endOf(f) > UNIVERSE_CHANNELS) {
      add("error", "Patch", `${who(f)} is patched at ${f.universe}/${f.address} with ${f.footprint} channels, so it runs past channel ${UNIVERSE_CHANNELS} of universe ${f.universe}. Start it lower, or move it to another universe.`, [f.id], f.at);
    }
  }
  // two ranges overlap when neither ends before the other starts; sorted by address, a later one that starts past this one's end never does
  const sorted = [...patched].sort((a, b) => a.universe - b.universe || a.address - b.address);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j]!;
      if (b.universe !== a.universe || b.address > endOf(a)) break;
      const lo = b.address;
      const hi = Math.min(endOf(a), endOf(b));
      const span = hi > lo ? `${a.universe}/${lo} to ${a.universe}/${hi}` : `${a.universe}/${lo}`;
      add("error", "Patch", `${who(a)} and ${who(b)} overlap on DMX ${span}: both would take those channels.`, [a.id, b.id], a.at);
    }
  }
  for (const f of fx) {
    if (!f.channel.trim()) add("warning", "Patch", `${who(f)} has no channel number, so it is not on the channel list or the magic sheet.`, [f.id], f.at);
  }
  // a channel's lights of more than one colour: the colour each is given, as written
  const byChannel = new Map<string, Fixture[]>();
  for (const f of fx) {
    const ch = f.channel.trim();
    if (ch) byChannel.set(ch, [...(byChannel.get(ch) ?? []), f]);
  }
  for (const [ch, list] of byChannel) {
    const colours = new Map<string, string>();
    for (const f of list) if (f.color.trim()) colours.set(f.color.trim().toUpperCase(), f.color.trim());
    if (colours.size > 1) add("note", "Patch", `Channel ${ch} drives lights of different colours: ${[...colours.values()].join(" and ")}.`, list.map((f) => f.id), list[0]!.at);
  }

  // Focus. The beam from the lens to the focus: its angle, and whether the focus is above the lens.
  for (const f of fx) {
    if (!f.focus) {
      add("warning", "Focus", `${who(f)} is not focused yet.`, [f.id], f.at);
      continue;
    }
    const beam = beamOf(f);
    if (!beam) continue;
    if (beam.elevationDeg < 0) {
      add("error", "Focus", `${who(f)} is focused ${fmt(f.focus.z - f.heightMm)} above its lens, so its beam points up. Lower the focus, or the lens.`, [f.id], f.at);
    } else if (beam.elevationDeg < FLAT_THROW_DEG) {
      add("warning", "Focus", `${who(f)} throws at ${Math.round(beam.elevationDeg)}° above the horizontal, under ${FLAT_THROW_DEG}°: long shadows and glare in the front rows. Hang it higher, or closer to what it lights.`, [f.id], f.at);
    }
  }
  if (venue && venue.stageWidthMm > 0) {
    const half = venue.stageWidthMm / 2;
    for (const f of fx) {
      if (!f.focus) continue;
      const s = toStage(frame, f.focus);
      if (Math.abs(s.across) > half) {
        add("note", "Focus", `${who(f)} is focused ${fmt(Math.abs(s.across))} ${s.across > 0 ? "SL" : "SR"} of the centre line, outside the ${fmt(venue.stageWidthMm)} stage.`, [f.id], f.at);
      }
    }
  }

  // Rigging. Loads are the instruments on a lineset (by Position) plus what else hangs on it, against its capacity.
  for (const ls of input.linesets) {
    if (!(ls.capacityKg > 0)) continue;
    const on = fx.filter((f) => sameName(f.position, ls.name));
    const inst = weightOf(on);
    const load = inst + ls.weightKg;
    if (load > ls.capacityKg) {
      const other = ls.weightKg > 0 ? `, plus ${kg(ls.weightKg)} of other gear` : "";
      add("error", "Rigging", `Lineset ${ls.name} is loaded to ${kg(load)}, over its ${kg(ls.capacityKg)} capacity: ${on.length} lights at ${kg(inst)}${other}.`, on.map((f) => f.id), on[0]?.at);
    }
  }
  for (const p of input.positions) {
    if (!(p.capacityKg > 0)) continue;
    const on = fx.filter((f) => sameName(f.position, p.name));
    const load = weightOf(on);
    if (load > p.capacityKg) add("error", "Rigging", `Position ${p.name} carries ${kg(load)} of lights, over its ${kg(p.capacityKg)} rating.`, on.map((f) => f.id), on[0]?.at);
  }
  for (const f of fx) {
    if (!f.position.trim()) add("note", "Rigging", `${who(f)} has no hanging position, so its load is not checked.`, [f.id], f.at);
  }
  if (venue && venue.gridHeightMm > 0) {
    for (const f of fx) {
      if (f.heightMm > venue.gridHeightMm) add("error", "Rigging", `${who(f)} hangs with its lens at ${fmt(f.heightMm)}, above the grid at ${fmt(venue.gridHeightMm)}.`, [f.id], f.at);
    }
  }
  // where people walk: on the stage when a venue is set (its width, and from its apron to its back wall), anywhere otherwise
  const onStage = (f: Fixture): boolean => {
    if (!venue) return true;
    const s = toStage(frame, f.at);
    return Math.abs(s.across) <= venue.stageWidthMm / 2 && s.up >= -venue.apronMm && s.up <= venue.stageDepthMm;
  };
  for (const f of fx) {
    if (f.heightMm < LOW_LENS_MM && onStage(f)) add("warning", "Rigging", `${who(f)} hangs with its lens at ${fmt(f.heightMm)}, under 2 m, where people walk.`, [f.id], f.at);
  }

  // Scenery. A platform's stand (its height above the floor) is its third side; a flat has no third side in the shop's data.
  for (const p of input.shop) {
    if (p.kind === "platform" && p.standMm >= GUARD_RAIL_MM) {
      add("warning", "Scenery", `Platform ${p.name} stands ${fmt(p.standMm)} off the floor. A guard rail is normally needed at ${fmt(GUARD_RAIL_MM)} and over.`);
    }
  }
  // Going through the door: a piece is carried lengthwise, so its longest side is free and its other two must
  // fit the door's two sides, the smaller to the smaller. The shop keeps no thickness for a flat, so it has FLAT_THICK_MM.
  if (venue && venue.doorWidthMm > 0 && venue.doorHeightMm > 0) {
    const DW = venue.doorWidthMm;
    const DH = venue.doorHeightMm;
    const doorSmall = Math.min(DW, DH);
    const doorBig = Math.max(DW, DH);
    for (const p of input.shop) {
      const sides = p.kind === "flat" ? [p.widthMm, p.heightMm] : [p.widthMm, p.heightMm, p.standMm];
      const [least = 0, middle = 0] = [...(p.kind === "flat" ? [...sides, FLAT_THICK_MM] : sides)].sort((a, b) => a - b);
      const over = [least > doorSmall ? least : 0, middle > doorBig ? middle : 0].filter((v) => v > 0);
      if (over.length === 0) continue;
      const dims = sides.map(fmt).join(" × ");
      const kind = p.kind === "flat" ? "Flat" : "Platform";
      add("error", "Scenery", `${kind} ${p.name} (${dims}) won't go through the ${fmt(DW)} × ${fmt(DH)} door. Split it across its ${over.map(fmt).join(" and ")} ${over.length > 1 ? "sides" : "side"}.`);
    }
  }

  // Venue. The stage origin, the venue, and the fire curtain (the iron) across the plan.
  if (!input.hasStageFrame) add("note", "Venue", "The stage origin isn't set, so the stage measures from the drawing's origin. Set it with Set Stage Origin.");
  if (!venue) add("note", "Venue", "No venue is set, so the checks on the stage, the grid and the door are skipped. Set one with New Venue….");
  if (venue) {
    const crosses = (corners: readonly Pt[]): boolean => {
      const ups = corners.map((p) => toStage(frame, p).up);
      return Math.min(...ups) < venue.ironUpMm && venue.ironUpMm < Math.max(...ups);
    };
    for (const f of fx) {
      const b = BODY_HALF_MM;
      if (crosses(boxCorners(f.at.x - b, f.at.y - b, 2 * b, 2 * b))) {
        add("error", "Venue", `${who(f)} stands across the iron line in plan, where the fire curtain would land on it. Move it clear.`, [f.id], f.at);
      }
    }
    for (const p of input.pieces) {
      if (crosses(boxCorners(p.x0, p.y0, p.w, p.h))) {
        add("error", "Venue", `${p.name || "A scenic piece"} crosses the iron line in plan. Move it clear of the fire curtain.`, [p.id], { x: p.x0 + p.w / 2, y: p.y0 + p.h / 2 });
      }
    }
  }

  // Data. A Vectorworks device is read, but Rodeo can't redraw it or read its focus.
  const imported = fx.filter((f) => !f.native);
  if (imported.length) {
    add("note", "Data", `${imported.length} ${imported.length === 1 ? "light" : "lights"} imported from Vectorworks can't be redrawn by Rodeo, and their focus isn't read, so they show as not focused.`, imported.map((f) => f.id), imported[0]!.at);
  }
  return out;
}
