// ConnectCAD's Equipment Item and Rack Frame: a piece of equipment on the layout, stand-alone or in an
// equipment rack, placed by the Equipment Item tool, and a frame in a rack that modular equipment goes
// into by slots, placed by the Rack Frame tool. Plug-in objects ('Rodeo Equipment Item', 'Rodeo Rack
// Frame'): in plan an outline, heavier front and name, in 3D a box (in a rack, a front panel with a
// narrower body behind it for the rails), or a frame's walls or a tray, its power supplies and door.
// In a rack one faces the way the rack's front or rear does at its Rack U, as wide as the rack's
// opening or half of it, and moves with the rack; dragged off a rack it stands alone, and dragged onto
// one (or placed on one) it goes in at the first free unit from the top, modular equipment into the
// first free slots of a frame there. With Link device name, the schematic's devices of its name take
// its make and model, physical and location data, and are renamed with it. Equipment keeps its adapter
// slots (adapterSlots.ts), drawn on its front or rear in 3D and in its detail and rack elevation views.

import type { EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../../core/index.ts";
import { attempt, setActiveLayer, setSelection, turnAbout } from "../../../app/commands.ts";
import { followEdits, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { RACK_UNIT } from "../../../app/rackRulerShapes.ts";
import { layerScaleOf } from "../../../app/spaces.ts";
import { formatLength } from "../../../app/units.ts";
import { store } from "../../../app/state.ts";
import { errorMessage } from "../../../app/toast.ts";
import type { Solid } from "../../../app/solids3d.ts";
import { readSlots, slotLabel, slotRect, slotsText, type AdapterSlot } from "./adapterSlotShapes.ts";
import type { RackEntry } from "./ccadReports.ts";
import type { FacePiece } from "./rackElevationShapes.ts";
import { nextName } from "./ccadShapes.ts";
import { rackNamed, rackPlace, racked, rackUnder } from "./equipmentRack.ts";
import { roomIdAt } from "./layoutRoom.ts";
import { EAR, equipmentSolid, firstFreeSlot, firstFreeUnit, FRAME_TYPES, frameFront, frameSolid, mountFace, MOUNTINGS, PSU_SIDES, runRect, SLOT_DIRECTIONS, slotRun, slotsSolid, unitAt, type FaceRect, type FrameType, type Mounting, type PsuSide, type SlotDirection } from "./rackShapes.ts";
import { devicesNamed, devicesOn, equipmentFor, renameDevice, setDeviceData, slotSocket, socketNamesOf } from "./schematic.ts";

export const EQUIPMENT_ITEM = "Rodeo Equipment Item";
export const RACK_FRAME = "Rodeo Rack Frame";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  name: "Name",
  link: "Link device name",
  make: "Make",
  model: "Model",
  height: "Height",
  width: "Width",
  depth: "Depth",
  power: "Power (W)",
  autoBtu: "Auto BTU calculation",
  btu: "BTU",
  weight: "Weight (kg)",
  ru: "Height RU",
  rackWidth: "Rack Width",
  mounting: "Mounting",
  mountDepth: "Mounting Depth",
  showText: "Show text",
  align: "Text Align",
  room: "Room",
  rack: "Rack",
  rackU: "Rack U",
  /** the drop point it's cabled from, by name: not a rack's or a frame's */
  drop: "Drop Point",
  /** where it was last drawn, so a drag can be told from its rack moving: not shown */
  placed: "Placed",
  // modular equipment's
  modular: "Modular",
  slots: "Number of Slots",
  slot: "Slot",
  // a rack frame's
  frameType: "Type",
  across: "Slots H",
  up: "Slots V",
  direction: "Slot Direction",
  psus: "Power Supplies",
  psuSide: "PSU Location",
  psuSize: "PSU Size",
  door: "Front Door",
  /** an item's adapter slots (adapterSlotShapes.ts): not shown */
  adapterSlots: "Adapter Slots",
} as const;

export const RACK_WIDTHS = ["Full", "Half", "Non-rack"] as const;
export type RackWidth = (typeof RACK_WIDTHS)[number];
const ALIGNS = ["Left", "Center", "Right"] as const;
/** watts to BTU an hour, as Vectorworks reckons it */
const BTU_PER_WATT = 3.41;
const READ_ONLY: ReadonlySet<string> = new Set([FIELD.room]);

/** what the tool makes equipment with: the Preferences, asked the first time it's used in a drawing */
export const itemSettings = {
  name: "EQ1",
  link: true,
  make: "",
  model: "",
  height: RACK_UNIT,
  width: 482.6,
  depth: 400,
  power: 0,
  weight: 0,
  ru: 1,
  rackWidth: "Full" as RackWidth,
  mounting: "Front" as Mounting,
  mountDepth: 0,
  showText: true,
  modular: false,
  slots: 1,
};

/** what the Rack Frame tool makes a frame with: its Preferences, asked the first time it's used in a drawing */
export const frameSettings = {
  name: "FRAME1",
  link: true,
  make: "",
  model: "",
  type: "Frame" as FrameType,
  mounting: "Front" as Mounting,
  ru: 3,
  depth: 300,
  power: 0,
  weight: 0,
  across: 4,
  up: 1,
  direction: "Horizontal" as SlotDirection,
  psus: 0,
  psuSide: "Left" as PsuSide,
  psuSize: 25,
  door: false,
};

const BODY = "#404040";
/** a racked piece's front panel, light so it shows against the rack's frame */
const PANEL = "#c0c0c0";
const PSU = "#808080";
const ADAPTER_SLOT = "#1f1f1f";
/** a frame's door's opacity, so its modules show through */
const DOOR_OPACITY = 45;
const OUTLINE_MILS = 7;
const FRONT_MILS = 14;
/** the name's height on paper, mm */
const LABEL_MM = 2;
/** round a module in its slots, so neighbours show apart, mm */
const SLOT_GAP = 1.5;

interface Item {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  readonly frame: boolean;
  value(field: string): RecordValue | undefined;
}

function itemOf(doc: VwxDocument, id: string): Item | null {
  const rec = doc.object(id)?.type === PLUGIN ? doc.records(id).find((r) => r.parametric && (r.name === EQUIPMENT_ITEM || r.name === RACK_FRAME)) : undefined;
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, frame: rec.name === RACK_FRAME, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

/** The drawing's equipment items and rack frames. */
export function itemsIn(doc: VwxDocument): Item[] {
  if (!doc.hasPluginFormat(EQUIPMENT_ITEM) && !doc.hasPluginFormat(RACK_FRAME)) return [];
  return doc.layers().flatMap((l) => doc.objects(l.id).flatMap((o) => (o.type === PLUGIN ? [itemOf(doc, o.id)].filter((i): i is Item => !!i) : [])));
}

const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));
const numOf = (v: RecordValue | undefined): number => Number(v) || 0;
const round = (n: number): number => Math.round(n * 100) / 100;
const turnOf = (deg: number): number => ((((deg + 180) % 360) + 360) % 360) - 180;

/** An item's fields as they'll be: those about to be written over what it has. */
type Values = (field: string) => RecordValue | undefined;
const withChanges = (i: Item, changes: Readonly<Record<string, RecordValue>>): Values => (field) => (field in changes ? changes[field] : i.value(field));

/** Where an item stands: its insertion (its front's middle) and angle, and how its drawing sits. */
interface Placement {
  readonly at: Pt;
  readonly angle: number;
  readonly z: number;
  readonly slope: number;
  readonly width: number;
  /** how tall it's drawn: its Height, or the slots it takes in a frame */
  readonly height: number;
  /** with a front panel and ears for a rack's rails */
  readonly eared: boolean;
  /** in a frame's slots: a front panel and no ears */
  readonly module: boolean;
  /** the rack it's in, by object */
  readonly rack: string;
  readonly room: string;
}

const poseOf = (o: ObjectInfo): { at: Pt; angle: number } => ({ at: o.insertion ?? { x: 0, y: 0 }, angle: o.turned ?? 0 });
const toWorld = (at: Pt, angle: number, q: Pt): Pt => {
  const t = (angle * Math.PI) / 180;
  return { x: at.x + q.x * Math.cos(t) - q.y * Math.sin(t), y: at.y + q.x * Math.sin(t) + q.y * Math.cos(t) };
};
const samePose = (a: { at: Pt; angle: number }, b: { at: Pt; angle: number }): boolean => Math.hypot(a.at.x - b.at.x, a.at.y - b.at.y) < 0.01 && Math.abs(turnOf(a.angle - b.angle)) < 0.001;

/** What a placement is kept as, to tell next time whether it moved. */
const placedKey = (p: Placement): string => JSON.stringify({ x: round(p.at.x), y: round(p.at.y), a: round(turnOf(p.angle)), z: round(p.z), s: round(p.slope), w: round(p.width), h: round(p.height), r: p.rack });
function placedOf(i: Item): { at: Pt; angle: number; rack: string } | null {
  try {
    const k = JSON.parse(str(i.value(FIELD.placed))) as { x: number; y: number; a: number; r: string };
    return { at: { x: k.x, y: k.y }, angle: k.a, rack: k.r ?? "" };
  } catch {
    return null;
  }
}

const mountingOf = (v: Values): Mounting => MOUNTINGS.find((m) => m === v(FIELD.mounting)) ?? "Front";
const rackWidthOf = (v: Values): RackWidth => RACK_WIDTHS.find((w) => w === v(FIELD.rackWidth)) ?? "Full";

const valuesOf = (i: Item): Values => (f) => i.value(f);
const whole = (v: RecordValue | undefined, least = 1): number => Math.max(least, Math.round(numOf(v)));

/** The frame in a rack (by Rack ID) on a side whose units take in unit `u`. */
function frameAt(doc: VwxDocument, rackId: string, mounting: Mounting, u: number): Item | null {
  if (!rackId || u < 1) return null;
  return itemsIn(doc).find((f) => f.frame && str(f.value(FIELD.rack)).trim() === rackId && mountingOf(valuesOf(f)) === mounting && u >= Math.round(numOf(f.value(FIELD.rackU))) && u < Math.round(numOf(f.value(FIELD.rackU))) + whole(f.value(FIELD.ru))) ?? null;
}

/** The frame modular equipment with values `v` is in: by its Rack, Rack U and side, with a Slot. */
const frameOf = (doc: VwxDocument, v: Values): Item | null => (v(FIELD.modular) === true && Math.round(numOf(v(FIELD.slot))) >= 1 ? frameAt(doc, str(v(FIELD.rack)).trim(), mountingOf(v), Math.round(numOf(v(FIELD.rackU)))) : null);

/** A frame's slots across and up, the way runs of them go, and its front's slots and power supplies. */
function slotsOf(f: Item, width: number): { across: number; up: number; direction: SlotDirection; front: ReturnType<typeof frameFront> } {
  const across = whole(f.value(FIELD.across));
  const up = whole(f.value(FIELD.up));
  const psuSide = PSU_SIDES.find((p) => p === f.value(FIELD.psuSide)) ?? "Left";
  return {
    across,
    up,
    direction: SLOT_DIRECTIONS.find((d) => d === f.value(FIELD.direction)) ?? "Horizontal",
    front: frameFront(width, numOf(f.value(FIELD.height)), across, up, whole(f.value(FIELD.psus), 0), psuSide, numOf(f.value(FIELD.psuSize)) || 25),
  };
}

/** The slots a module `count` slots big at slot `slot` takes in a frame, or null when they run off it. */
function runIn(f: Item, slot: number, count: number): number[] | null {
  const { across, up, direction } = slotsOf(f, 0);
  return slotRun(across, up, slot, count, direction);
}
const runOf = (f: Item, m: Values): number[] | null => runIn(f, Math.round(numOf(m(FIELD.slot))), whole(m(FIELD.slots)));

/** A frame's modules. */
const modulesIn = (doc: VwxDocument, f: Item): Item[] => itemsIn(doc).filter((m) => !m.frame && frameOf(doc, valuesOf(m))?.id === f.id);

/** The slots a frame's modules take, but `except`'s. */
function slotsTaken(doc: VwxDocument, f: Item, except: string): Set<number> {
  const taken = new Set<number>();
  for (const m of modulesIn(doc, f)) if (m.id !== except) for (const n of runOf(f, valuesOf(m)) ?? []) taken.add(n);
  return taken;
}

/** The first frame in a rack (its object) on a side, from the top, with room for a module `count` slots big: its unit and the slot. */
function freeSlot(doc: VwxDocument, rack: string, mounting: Mounting, count: number, except: string): { u: number; slot: number } | null {
  const rackId = rackPlace(doc, rack)?.rackId;
  if (!rackId) return null;
  const frames = itemsIn(doc)
    .filter((f) => f.frame && str(f.value(FIELD.rack)).trim() === rackId && mountingOf(valuesOf(f)) === mounting && Math.round(numOf(f.value(FIELD.rackU))) >= 1)
    .sort((a, b) => numOf(b.value(FIELD.rackU)) - numOf(a.value(FIELD.rackU)));
  for (const f of frames) {
    const { across, up, direction } = slotsOf(f, 0);
    const slot = firstFreeSlot(across, up, slotsTaken(doc, f, except), count, direction);
    if (slot) return { u: Math.round(numOf(f.value(FIELD.rackU))), slot };
  }
  return null;
}

/** The units taken in a rack on one side by the other items and frames there (not the modules in frames). */
function takenIn(doc: VwxDocument, rackId: string, mounting: Mounting, except: string): { u: number; units: number; half: boolean; id: string }[] {
  return itemsIn(doc)
    .filter((o) => o.id !== except && str(o.value(FIELD.rack)).trim() === rackId && mountingOf((f) => o.value(f)) === mounting && !frameOf(doc, valuesOf(o)))
    .map((o) => ({ u: Math.round(numOf(o.value(FIELD.rackU))), units: Math.max(1, Math.round(numOf(o.value(FIELD.ru)))), half: o.value(FIELD.rackWidth) === "Half", id: o.id }));
}

/** The unit an item `units` tall goes in at in a rack: the highest free one, a half-width one sharing a unit with one other half-width one. */
function freeUnit(doc: VwxDocument, rack: string, mounting: Mounting, units: number, half: boolean, except: string): number {
  const place = rackPlace(doc, rack);
  if (!place) return 0;
  const taken = takenIn(doc, place.rackId, mounting, except);
  const alone = (t: (typeof taken)[number]): boolean => t.half && taken.filter((o) => o.half && o.u === t.u).length === 1;
  return firstFreeUnit(mountFace(place.size, mounting).units, half ? taken.filter((t) => !alone(t)) : taken, units);
}

/** Whether units `u` up are free on a side of a rack for an item. */
function freeAt(doc: VwxDocument, rackId: string, mounting: Mounting, u: number, units: number, half: boolean, except: string): boolean {
  const taken = takenIn(doc, rackId, mounting, except).filter((t) => t.u >= 1 && t.u < u + units && u < t.u + t.units);
  return taken.length === 0 || (half && taken.length === 1 && taken[0].half && taken[0].u === u);
}

/** Where an item with values `v` goes in rack `rack` (its object), or stands alone at its own pose. */
function placementOf(doc: VwxDocument, id: string, v: Values, rack: string | null): Placement {
  const o = doc.object(id);
  const pose = o ? poseOf(o) : { at: { x: 0, y: 0 }, angle: 0 };
  const width = numOf(v(FIELD.width));
  const height = numOf(v(FIELD.height));
  const place = rack ? rackPlace(doc, rack) : null;
  if (!place) {
    const middle = toWorld(pose.at, pose.angle, { x: 0, y: numOf(v(FIELD.depth)) / 2 });
    return { ...pose, z: 0, slope: 0, width, height, eared: false, module: false, rack: "", room: roomIdAt(doc, middle) };
  }
  // modular equipment in a frame: in the slots it takes on the frame's front, leaning with it
  const frame = frameOf(doc, v);
  if (frame && frame.id !== id) {
    const fp = placementOf(doc, frame.id, valuesOf(frame), rack);
    const { front } = slotsOf(frame, fp.width);
    const run = runOf(frame, v);
    if (run) {
      const r = runRect(front.slots, run);
      const s = (fp.slope * Math.PI) / 180;
      const foot = r.z0 + SLOT_GAP;
      const at = toWorld(fp.at, fp.angle, { x: (r.x0 + r.x1) / 2, y: foot * Math.sin(s) });
      return { at, angle: fp.angle, z: fp.z + foot * Math.cos(s), slope: fp.slope, width: r.x1 - r.x0 - 2 * SLOT_GAP, height: r.z1 - r.z0 - 2 * SLOT_GAP, eared: true, module: true, rack: fp.rack, room: fp.room };
    }
  }
  const mounting = mountingOf(v);
  const face = mountFace(place.size, mounting);
  const kind = rackWidthOf(v);
  const u = Math.round(numOf(v(FIELD.rackU)));
  // below the rack when it has no unit in it, its top a unit under the floor and a unit lower for each below 0
  const unit = u >= 1 ? unitAt(face, u) : { y: face.y, z: (u - 1) * RACK_UNIT - height, slope: 0 };
  const s = (unit.slope * Math.PI) / 180;
  const deep = numOf(v(FIELD.mountDepth));
  const turn = face.rear ? -1 : 1;
  // a half-width item goes left, or right when another half-width one is on its left at its unit
  let x = 0;
  if (kind === "Half") {
    const halves = takenIn(doc, place.rackId, mounting, "").filter((t) => t.half && t.u === u);
    x = (halves.findIndex((t) => t.id === id) % 2 === 1 ? 1 : -1) * turn * (face.width / 4);
  }
  const at = place.toWorld({ x, y: unit.y + turn * deep * Math.cos(s) });
  return {
    at,
    angle: turnOf(place.angle + (face.rear ? 180 : 0)),
    z: unit.z - deep * Math.sin(s),
    slope: unit.slope,
    width: kind === "Full" ? face.width : kind === "Half" ? face.width / 2 : width,
    height,
    eared: kind !== "Non-rack",
    module: false,
    rack: place.id,
    room: place.room,
  };
}

/** The values a linked device takes from an item. */
function deviceValues(v: Values, p: Placement): Record<string, RecordValue> {
  const u = Math.round(numOf(v(FIELD.rackU)));
  return {
    Manufacturer: str(v(FIELD.make)),
    Description: str(v(FIELD.model)),
    Height: numOf(v(FIELD.height)),
    Width: numOf(v(FIELD.width)),
    Depth: numOf(v(FIELD.depth)),
    "Power (W)": numOf(v(FIELD.power)),
    "Auto BTU calculation": v(FIELD.autoBtu) !== false,
    BTU: numOf(v(FIELD.btu)),
    "Weight (kg)": numOf(v(FIELD.weight)),
    "Height RU": numOf(v(FIELD.ru)),
    "Rack Width": rackWidthOf(v),
    Room: p.room,
    Rack: str(v(FIELD.rack)).trim(),
    "Rack U": p.rack && u >= 1 ? String(u) : "",
  };
}

/** What an item takes from a device of its name when it's linked to it: its make and model, and its physical data when it has any (with `all`, its rack width and units whatever its size). */
function fromDevice(s: EditSession, name: string, all = false): Record<string, RecordValue> {
  const d = devicesNamed(s, name)[0];
  if (!d) return {};
  const pulled: Record<string, RecordValue> = { [FIELD.make]: str(d.rec.value("Manufacturer")), [FIELD.model]: str(d.rec.value("Description")) };
  if (all) {
    const width = RACK_WIDTHS.find((w) => w === d.rec.value(FIELD.rackWidth));
    if (width) pulled[FIELD.rackWidth] = width;
    const units = Math.round(numOf(d.rec.value(FIELD.ru)));
    if (units >= 1) Object.assign(pulled, { [FIELD.ru]: units, [FIELD.height]: units * RACK_UNIT });
  }
  const size = ["Height", "Width", "Depth"].map((f) => numOf(d.rec.value(f)));
  if (size.some((n) => n > 0)) {
    pulled[FIELD.height] = size[0];
    pulled[FIELD.width] = size[1];
    pulled[FIELD.depth] = size[2];
    for (const f of [FIELD.power, FIELD.autoBtu, FIELD.btu, FIELD.weight, FIELD.ru, FIELD.rackWidth]) {
      const value = d.rec.value(f);
      if (value !== undefined) pulled[f] = f === FIELD.ru ? Math.max(1, Math.round(numOf(value))) : value;
    }
  }
  return pulled;
}

/** What an item should be now: the fields to write, where it goes, and whether it, or a device of its name, is out of date. */
interface Plan {
  readonly changes: Record<string, RecordValue>;
  readonly place: Placement;
  readonly stale: boolean;
}

/**
 * Works out an item: in the rack its Rack names (followed when that rack's ID changed under it), or
 * standing alone. With `dragged`, an item moved since it was drawn goes into the rack under it (back
 * to its own unit when it's the same rack and that's free, the first free one otherwise) or out of
 * its rack when it's over none.
 */
function planFor(s: EditSession, i: Item, given: Readonly<Record<string, RecordValue>>, dragged: boolean): Plan {
  const doc = s.doc;
  const o = doc.object(i.id);
  const changes: Record<string, RecordValue> = { ...given };
  let v = withChanges(i, changes);
  const before = placedOf(i);
  const pose = o ? poseOf(o) : null;
  let rack = rackNamed(doc, str(v(FIELD.rack)).trim());
  if (!rack && str(v(FIELD.rack)).trim() && before?.rack) {
    const renamed = rackPlace(doc, before.rack);
    if (renamed?.rackId) {
      rack = before.rack;
      changes[FIELD.rack] = renamed.rackId;
    }
  }
  if (dragged && pose && before && !samePose(pose, before)) {
    const middle = toWorld(pose.at, pose.angle, { x: 0, y: numOf(v(FIELD.depth)) / 2 });
    const under = rackUnder(doc, middle);
    const mounting = mountingOf(v);
    const units = Math.max(1, Math.round(numOf(v(FIELD.ru))));
    const half = rackWidthOf(v) === "Half";
    const frame = frameOf(doc, v);
    const modular = !i.frame && v(FIELD.modular) === true;
    if (!under) {
      if (rack) Object.assign(changes, { [FIELD.rack]: "", [FIELD.rackU]: 0, ...(modular ? { [FIELD.slot]: 0 } : {}) });
      rack = null;
    } else if (modular && frame && under === rack && (runOf(frame, v) ?? []).every((n) => !slotsTaken(doc, frame, i.id).has(n))) {
      // back into its own slots
    } else {
      const id = rackPlace(doc, under)?.rackId ?? "";
      const slot = modular ? freeSlot(doc, under, mounting, whole(v(FIELD.slots)), i.id) : null;
      const u = Math.round(numOf(v(FIELD.rackU)));
      const keep = !slot && !frame && under === rack && u >= 1 && freeAt(doc, id, mounting, u, units, half, i.id);
      Object.assign(changes, { [FIELD.rack]: id, [FIELD.rackU]: slot ? slot.u : keep ? u : freeUnit(doc, under, mounting, units, half, i.id), ...(modular ? { [FIELD.slot]: slot?.slot ?? 0 } : {}) });
      rack = under;
    }
  }
  v = withChanges(i, changes);
  const place = placementOf(doc, i.id, v, rack);
  if (place.rack && (place.module || rackWidthOf(v) !== "Non-rack")) changes[FIELD.width] = round(place.width);
  changes[FIELD.room] = place.room;
  for (const [field, value] of Object.entries(changes)) if (i.value(field) === value && !(field in given)) delete changes[field];
  v = withChanges(i, changes);
  const moved = !pose || !samePose(pose, place) || str(i.value(FIELD.placed)) !== placedKey(place);
  const name = str(v(FIELD.name)).trim();
  const devices = v(FIELD.link) === true && name ? devicesNamed(s, name) : [];
  const want = deviceValues(v, place);
  const behind = devices.some((d) => Object.entries(want).some(([f, value]) => d.rec.value(f) !== value));
  return { changes, place, stale: Object.keys(changes).length > 0 || moved || behind };
}

const lifted = (faces: Solid, dz: number): Solid => faces.map((f) => f.map((q, k) => (k % 3 === 2 ? q + dz : q)));

/** Writes a plan into an item, moves it to where it goes, draws it and brings the devices of its name up to date, in the session's open batch. */
function apply(s: EditSession, id: string, plan: Plan): void {
  const i = itemOf(s.doc, id);
  const o = s.doc.object(id);
  if (!i || !o) return;
  // a frame's modules, found where it was, go where it goes
  const modules = i.frame ? modulesIn(s.doc, i) : [];
  const wasU = i.value(FIELD.rackU);
  for (const [field, value] of Object.entries(plan.changes)) if (i.value(field) !== value) s.setRecordField(id, i.format, field, value);
  const pose = poseOf(o);
  const p = plan.place;
  const turn = turnOf(p.angle - pose.angle);
  if (Math.abs(turn) > 1e-6) s.transformObjects([id], turnAbout(pose.at, turn));
  const dx = p.at.x - pose.at.x;
  const dy = p.at.y - pose.at.y;
  if (Math.hypot(dx, dy) > 1e-6) s.moveObjects([id], dx, dy);
  drawItem(s, itemOf(s.doc, id)!, p);
  const v: Values = (f) => itemOf(s.doc, id)?.value(f);
  const name = str(v(FIELD.name)).trim();
  if (v(FIELD.link) === true && name) for (const d of devicesNamed(s, name)) setDeviceData(s, d.rec.id, deviceValues(v, p));
  carry(s, id, modules, wasU);
}

/** Takes a frame's modules (found where it was, at Rack U `wasU`) to where it is now and redraws them; out of a rack, a frame holds none, so they stay where they are, on their own. */
function carry(s: EditSession, frameId: string, modules: readonly Item[], wasU: RecordValue | undefined): void {
  const f = itemOf(s.doc, frameId);
  if (!f) return;
  const rackId = str(f.value(FIELD.rack)).trim();
  const shift = Math.round(numOf(f.value(FIELD.rackU))) - Math.round(numOf(wasU));
  for (const { id } of modules) {
    const m = itemOf(s.doc, id);
    if (!m) continue;
    const at: Record<string, RecordValue> = rackNamed(s.doc, rackId) ? { [FIELD.rack]: rackId, [FIELD.rackU]: Math.round(numOf(m.value(FIELD.rackU))) + shift, [FIELD.mounting]: mountingOf(valuesOf(f)) } : { [FIELD.rack]: "", [FIELD.rackU]: 0, [FIELD.slot]: 0 };
    apply(s, id, planFor(s, m, Object.fromEntries(Object.entries(at).filter(([field, value]) => m.value(field) !== value)), false));
  }
}

/** Draws an item where it's placed, keeping where that is, in the session's open batch. */
function drawItem(s: EditSession, i: Item, p: Placement): void {
  const depth = numOf(i.value(FIELD.depth));
  const type = FRAME_TYPES.find((t) => t === i.value(FIELD.frameType)) ?? "Frame";
  // a frame's walls or tray, its ears, power supplies and door; or a piece's body and front panel
  const parts = i.frame ? frameSolid(type, p.width, p.height, depth, slotsOf(i, p.width).front.psus, i.value(FIELD.door) === true, p.slope) : null;
  const piece = parts ? null : equipmentSolid(p.width, p.height, depth, p.eared, p.slope, p.module ? 0 : EAR);
  const outline = parts?.outline ?? piece!.outline;
  const meshes: [Solid, string, number][] = parts
    ? [
        [parts.body, BODY, 100],
        [parts.ears, PANEL, 100],
        [parts.psu, PSU, 100],
        [parts.door, BODY, DOOR_OPACITY],
      ]
    : [
        [piece!.body, BODY, 100],
        [piece!.panel, PANEL, 100],
        [slotsSolid(slotsIn(i).map((k) => ({ rect: slotRect(k), rear: k.side === "Rear" })), depth, piece!.panel.length > 0, p.slope), ADAPTER_SLOT, 100],
      ];
  const match = colorMatcher();
  const ink = (hex: string): number => match({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
  const black = ink("#000000");
  const white = ink("#ffffff");
  const scale = layerScaleOf(i.layerId);
  const classIndex = s.doc.object(i.id)?.classIndex ?? store.activeClassIndex;
  const front = Math.min(...outline.map((q) => q.y));
  const back = Math.max(...outline.map((q) => q.y));
  const w = p.width / 2;
  const shapes: NewShape[] = [
    { kind: "polygon", points: outline, closed: true } as NewShape,
    { kind: "line", a: { x: -w, y: front }, b: { x: w, y: front } } as NewShape,
  ];
  // racked, it's an outline over its rack's, which keeps its Rack ID showing, and the rack is what's named
  const looks: object[] = [
    p.rack ? { penFore: black, lineWeight: OUTLINE_MILS, fillPattern: 0 } : { penFore: black, lineWeight: OUTLINE_MILS, fillPattern: 1, fillFore: white, fillBack: white, fillOpacity: 100 },
    { penFore: black, lineWeight: FRONT_MILS },
  ];
  const name = str(i.value(FIELD.name)).trim();
  if (name && i.value(FIELD.showText) !== false && !p.rack) {
    const align = ALIGNS.indexOf(ALIGNS.find((a) => a === i.value(FIELD.align)) ?? "Center");
    const inset = Math.min(w / 4, 2 * scale);
    shapes.push({ kind: "text", at: { x: [-w + inset, 0, w - inset][align], y: (front + back) / 2 }, text: name, height: LABEL_MM * scale, hAlign: align + 1, vAlign: 3, angle: 0 } as NewShape);
    looks.push({ penFore: black, fillPattern: 0 });
  }
  const ids = s.addObjects(i.layerId, shapes, classIndex, looks);
  // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
  const elevation = s.doc.layers().find((l) => l.id === i.layerId)?.elevation ?? 0;
  for (const [faces, hex, opacity] of meshes) {
    if (!faces.length) continue;
    const fill = ink(hex);
    ids.push(...s.addMeshes(i.layerId, [lifted(faces, p.z - elevation)], classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: opacity, lineStyle: 0 }));
  }
  s.setPluginDrawing(i.id, ids);
  if (i.value(FIELD.placed) !== placedKey(p)) s.setRecordField(i.id, i.format, FIELD.placed, placedKey(p));
}

/** The drawing's equipment's names. */
export const itemNames = (doc: VwxDocument): Set<string> => new Set(itemsIn(doc).map((i) => str(i.value(FIELD.name)).trim()));

/** A new item's fields: the tool's settings with its name. */
function itemSpecs(name: string): PluginFieldSpec[] {
  const k = itemSettings;
  return [
    { name: FIELD.name, type: TEXT, value: name },
    { name: FIELD.link, type: BOOL, value: k.link },
    { name: FIELD.make, type: TEXT, value: k.make },
    { name: FIELD.model, type: TEXT, value: k.model },
    { name: FIELD.height, type: DIMENSION, value: k.height },
    { name: FIELD.width, type: DIMENSION, value: k.width },
    { name: FIELD.depth, type: DIMENSION, value: k.depth },
    { name: FIELD.power, type: NUMBER, value: k.power },
    { name: FIELD.autoBtu, type: BOOL, value: true },
    { name: FIELD.btu, type: NUMBER, value: round(k.power * BTU_PER_WATT) },
    { name: FIELD.weight, type: NUMBER, value: k.weight },
    { name: FIELD.ru, type: NUMBER, value: k.ru },
    { name: FIELD.rackWidth, type: POPUP, value: k.rackWidth },
    { name: FIELD.mounting, type: POPUP, value: k.mounting },
    { name: FIELD.mountDepth, type: DIMENSION, value: k.mountDepth },
    { name: FIELD.showText, type: BOOL, value: k.showText },
    { name: FIELD.align, type: POPUP, value: "Center" },
    { name: FIELD.room, type: TEXT, value: "" },
    { name: FIELD.rack, type: TEXT, value: "" },
    { name: FIELD.rackU, type: NUMBER, value: 0 },
    { name: FIELD.placed, type: TEXT, value: "" },
    { name: FIELD.modular, type: BOOL, value: k.modular },
    { name: FIELD.slots, type: NUMBER, value: k.slots },
    { name: FIELD.slot, type: NUMBER, value: 0 },
    { name: FIELD.drop, type: POPUP, value: "" },
    { name: FIELD.adapterSlots, type: TEXT, value: "" },
  ];
}

/** A new frame's fields: the Rack Frame tool's settings with its name, and what equipment's machinery reads (a frame is full width, its units tall). */
function frameSpecs(name: string): PluginFieldSpec[] {
  const k = frameSettings;
  return [
    { name: FIELD.name, type: TEXT, value: name },
    { name: FIELD.link, type: BOOL, value: k.link },
    { name: FIELD.make, type: TEXT, value: k.make },
    { name: FIELD.model, type: TEXT, value: k.model },
    { name: FIELD.frameType, type: POPUP, value: k.type },
    { name: FIELD.mounting, type: POPUP, value: k.mounting },
    { name: FIELD.ru, type: NUMBER, value: k.ru },
    { name: FIELD.height, type: DIMENSION, value: k.ru * RACK_UNIT },
    { name: FIELD.width, type: DIMENSION, value: 482.6 },
    { name: FIELD.depth, type: DIMENSION, value: k.depth },
    { name: FIELD.power, type: NUMBER, value: k.power },
    { name: FIELD.autoBtu, type: BOOL, value: true },
    { name: FIELD.btu, type: NUMBER, value: round(k.power * BTU_PER_WATT) },
    { name: FIELD.weight, type: NUMBER, value: k.weight },
    { name: FIELD.across, type: NUMBER, value: k.across },
    { name: FIELD.up, type: NUMBER, value: k.up },
    { name: FIELD.direction, type: POPUP, value: k.direction },
    { name: FIELD.psus, type: NUMBER, value: k.psus },
    { name: FIELD.psuSide, type: POPUP, value: k.psuSide },
    { name: FIELD.psuSize, type: NUMBER, value: k.psuSize },
    { name: FIELD.door, type: BOOL, value: k.door },
    { name: FIELD.rackWidth, type: POPUP, value: "Full" },
    { name: FIELD.mountDepth, type: DIMENSION, value: 0 },
    { name: FIELD.showText, type: BOOL, value: true },
    { name: FIELD.align, type: POPUP, value: "Center" },
    { name: FIELD.room, type: TEXT, value: "" },
    { name: FIELD.rack, type: TEXT, value: "" },
    { name: FIELD.rackU, type: NUMBER, value: 0 },
    { name: FIELD.placed, type: TEXT, value: "" },
  ];
}

function newItem(s: EditSession, layerId: string, name: string, at: Pt, angle: number, frame = false): Item {
  const specs = frame ? frameSpecs(name) : itemSpecs(name);
  const made = s.addPluginObject(layerId, frame ? RACK_FRAME : EQUIPMENT_ITEM, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
  const i = itemOf(s.doc, made);
  if (!i) throw new Error("The equipment couldn't be made.");
  return i;
}

/** New equipment on a layer, as part of a batch: in rack `rack` (its object) at its first free unit, or standing alone with its front's middle at `at`; its name numbered on when other equipment has it. */
export function addEquipmentItem(s: EditSession, layerId: string, at: Pt, rack: string | null): string {
  const k = itemSettings;
  const wanted = k.name.trim();
  const name = wanted ? nextName(wanted, itemNames(s.doc)) : "";
  const i = newItem(s, layerId, name, at, 0);
  const made = i.id;
  const given: Record<string, RecordValue> = k.link && name ? fromDevice(s, name) : {};
  const place = rack ? rackPlace(s.doc, rack) : null;
  if (place) {
    const v = withChanges(i, given);
    // modular equipment goes in the first frame with room, from the top
    const slot = v(FIELD.modular) === true ? freeSlot(s.doc, rack!, mountingOf(v), whole(v(FIELD.slots)), made) : null;
    Object.assign(given, { [FIELD.rack]: place.rackId, [FIELD.rackU]: slot ? slot.u : freeUnit(s.doc, rack!, mountingOf(v), whole(v(FIELD.ru)), rackWidthOf(v) === "Half", made), ...(slot ? { [FIELD.slot]: slot.slot } : {}) });
  }
  apply(s, made, planFor(s, i, given, false));
  return made;
}

/** A new rack frame on a layer, as part of a batch: in rack `rack` (its object) at its first free unit, or standing alone with its front's middle at `at`; its name numbered on. */
export function addRackFrame(s: EditSession, layerId: string, at: Pt, rack: string | null): string {
  const k = frameSettings;
  const wanted = k.name.trim();
  const name = wanted ? nextName(wanted, itemNames(s.doc)) : "";
  const i = newItem(s, layerId, name, at, 0, true);
  const given: Record<string, RecordValue> = k.link && name ? fromDevice(s, name) : {};
  delete given[FIELD.width];
  delete given[FIELD.rackWidth];
  const place = rack ? rackPlace(s.doc, rack) : null;
  if (place) Object.assign(given, { [FIELD.rack]: place.rackId, [FIELD.rackU]: freeUnit(s.doc, rack!, k.mounting, k.ru, false, i.id) });
  apply(s, i.id, planFor(s, i, given, false));
  return i.id;
}

/** The Rack Frame tool's click: a frame in the rack under it or on its own, selected. */
export function placeRackFrame(layerId: string, at: Pt): void {
  const r = attempt("Rack Frame", (s) => s.batch(() => addRackFrame(s, layerId, at, rackUnder(s.doc, at))));
  if (r) setSelection([r.value]);
}

/** What equipment made for the devices of a name would be: its size, units and rack width. */
export function equipmentSize(s: EditSession, name: string): { width: number; depth: number; units: number; rackWidth: RackWidth } {
  const k = itemSettings;
  const pulled = fromDevice(s, name, true);
  return {
    width: numOf(pulled[FIELD.width]) || k.width,
    depth: numOf(pulled[FIELD.depth]) || k.depth,
    units: Math.max(1, Math.round(numOf(pulled[FIELD.ru]) || k.ru)),
    rackWidth: RACK_WIDTHS.find((w) => w === pulled[FIELD.rackWidth]) ?? k.rackWidth,
  };
}

/**
 * Equipment for the devices of a name, as part of a batch (Create Equipment): named after them and
 * linked, with their make, model, rack width and physical data; in rack `rack` (its object) at unit
 * `u`, or standing with its front's middle at `at`, turned `angle`, keeping the name of a rack the
 * drawing hasn't (`missing`).
 */
export function addEquipmentFor(s: EditSession, layerId: string, name: string, at: Pt, angle: number, rack: string | null, u: number, missing = ""): string {
  const i = newItem(s, layerId, name, at, angle);
  const place = rack ? rackPlace(s.doc, rack) : null;
  const given: Record<string, RecordValue> = { [FIELD.link]: true, ...fromDevice(s, name, true), [FIELD.rack]: place?.rackId ?? missing, ...(place ? { [FIELD.rackU]: u } : {}) };
  apply(s, i.id, planFor(s, i, given, false));
  return i.id;
}

/** What's in a rack (its object), for its contents worksheet: its Rack ID, its units and the equipment, frames and modules in it. */
export function rackContents(doc: VwxDocument, rack: string): { rackId: string; units: number; entries: RackEntry[] } | null {
  const place = rackPlace(doc, rack);
  if (!place) return null;
  const entries = itemsIn(doc)
    .filter((i) => place.rackId && str(i.value(FIELD.rack)).trim() === place.rackId)
    .map((i): RackEntry => {
      const v = valuesOf(i);
      const frame = i.frame ? null : frameOf(doc, v);
      const run = frame ? runOf(frame, v) : null;
      // a module is where its frame is
      const at = frame && run ? frame : i;
      return {
        name: str(v(FIELD.name)).trim(),
        make: str(v(FIELD.make)),
        model: str(v(FIELD.model)),
        kind: i.frame ? "frame" : run ? "module" : "item",
        u: Math.round(numOf(at.value(FIELD.rackU))),
        ru: whole(at.value(FIELD.ru)),
        mounting: mountingOf(v),
        slots: run ?? [],
        rackWidth: run ? "" : rackWidthOf(v),
        depth: formatLength(numOf(v(FIELD.depth)), doc.info.units),
        power: numOf(v(FIELD.power)),
        btu: numOf(v(FIELD.btu)),
        weight: numOf(v(FIELD.weight)),
      };
    });
  return { rackId: place.rackId, units: mountFace(place.size, "Front").units, entries };
}

/** An item's adapter slots as kept; a frame has none. */
const slotsIn = (i: Item): AdapterSlot[] => (i.frame ? [] : readSlots(str(i.value(FIELD.adapterSlots))));

/** An item's adapter slots on one side as pieces, `place` putting each where it's seen, showing the adapter on the socket each stands for in the devices of its name, if it's linked to them. */
function slotPieces(s: EditSession, i: Item, side: Mounting, place: (r: FaceRect) => FaceRect): FacePiece[] {
  const device = i.value(FIELD.link) === true ? str(i.value(FIELD.name)).trim() : "";
  return slotsIn(i)
    .filter((k) => k.side === side)
    .map((k) => {
      const shown = slotLabel(k, device ? slotSocket(s, device, k.name)?.adapter : undefined);
      return { kind: "adapter", name: shown.text, ...(shown.cross ? { cross: true } : {}), ...place(slotRect(k)) };
    });
}

/** How an item's faces are drawn: how wide and tall, and the room on its front or rear for adapter slots (not its ears; its body behind them), across from its middle and up from its foot. */
function faceOf(doc: VwxDocument, i: Item): { name: string; p: Placement; kind: FacePiece["kind"]; ears: boolean; room: FaceRect } {
  const v = valuesOf(i);
  const p = placementOf(doc, i.id, v, rackNamed(doc, str(v(FIELD.rack)).trim()));
  const w = p.width / 2;
  const ears = p.eared && !p.module && w > EAR;
  const inner = ears ? w - EAR : w;
  return { name: str(v(FIELD.name)).trim(), p, kind: i.frame ? "frame" : p.module ? "module" : "item", ears, room: { x0: -inner, x1: inner, z0: 0, z1: p.height } };
}

/**
 * An equipment item or rack frame face on, for its detail view: its name and, from the front, its
 * panel and the ears it's racked by, a frame's slots, power supplies and modules; from the rear, its
 * body (narrower by its ears); an item's adapter slots on that side. Across from its middle (to the
 * right seen from that side), up from its foot; null for none.
 */
export function equipmentFaces(s: EditSession, id: string, side: Mounting): { name: string; pieces: FacePiece[] } | null {
  const doc = s.doc;
  const i = itemOf(doc, id);
  if (!i) return null;
  const { name, p, kind, ears, room } = faceOf(doc, i);
  const w = p.width / 2;
  const same = (r: FaceRect): FaceRect => r;
  if (side === "Rear") return { name, pieces: [{ kind, name, ...room }, ...slotPieces(s, i, side, same)] };
  const pieces: FacePiece[] = [{ kind, name, x0: -w, x1: w, z0: 0, z1: p.height }];
  if (ears) pieces.push({ kind: "ear", name: "", x0: -w, x1: -w + EAR, z0: 0, z1: p.height }, { kind: "ear", name: "", x0: w - EAR, x1: w, z0: 0, z1: p.height });
  if (!i.frame) return { name, pieces: [...pieces, ...slotPieces(s, i, side, same)] };
  const { front } = slotsOf(i, p.width);
  const rect = (kind: FacePiece["kind"], label: string, r: FaceRect, gap = 0): FacePiece => ({ kind, name: label, x0: r.x0 + gap, x1: r.x1 - gap, z0: r.z0 + gap, z1: r.z1 - gap });
  pieces.push(...front.slots.map((r) => rect("slot", "", r)), ...front.psus.map((r) => rect("psu", "PSU", r)));
  for (const m of modulesIn(doc, i)) {
    const run = runOf(i, valuesOf(m));
    if (run) pieces.push(rect("module", str(m.value(FIELD.name)).trim(), runRect(front.slots, run), SLOT_GAP));
  }
  return { name, pieces };
}

/**
 * What's mounted on one side of a rack (its object), for its elevation: the front of each item, frame
 * and module there, an item's adapter slots on its front, and a frame's slots and power supplies,
 * across the rack (from its middle, to the right seen from its front) and up from the floor, a
 * console's sloping fronts as high as they look from in front; equipment with no Rack U, below the
 * rack, left out.
 */
export function rackFronts(s: EditSession, rack: string, mounting: Mounting): FacePiece[] {
  const doc = s.doc;
  const place = rackPlace(doc, rack);
  if (!place?.rackId || rackNamed(doc, place.rackId) !== rack) return [];
  const o = place.toWorld({ x: 0, y: 0 });
  const e = place.toWorld({ x: 1, y: 0 });
  const across = (p: Pt): number => (p.x - o.x) * (e.x - o.x) + (p.y - o.y) * (e.y - o.y);
  // a rear-mounted frame faces the back, its slots running the other way across the rack
  const turn = mounting === "Rear" ? -1 : 1;
  const out: FacePiece[] = [];
  for (const i of itemsIn(doc)) {
    const v = valuesOf(i);
    if (str(v(FIELD.rack)).trim() !== place.rackId || mountingOf(v) !== mounting) continue;
    const frame = i.frame ? null : frameOf(doc, v);
    if (Math.round(numOf((frame ?? i).value(FIELD.rackU))) < 1) continue;
    const p = placementOf(doc, i.id, v, rack);
    const lean = Math.cos((p.slope * Math.PI) / 180);
    const x = across(p.at);
    const name = str(v(FIELD.name)).trim();
    out.push({ kind: i.frame ? "frame" : p.module ? "module" : "item", name, x0: x - p.width / 2, x1: x + p.width / 2, z0: p.z, z1: p.z + p.height * lean });
    // across the rack, turned for what faces the back, up from the floor as it looks from in front
    const onRack = (r: FaceRect): FaceRect => {
      const [a, b] = [x + turn * r.x0, x + turn * r.x1];
      return { x0: Math.min(a, b), x1: Math.max(a, b), z0: p.z + r.z0 * lean, z1: p.z + r.z1 * lean };
    };
    if (!i.frame) {
      out.push(...slotPieces(s, i, "Front", onRack));
      continue;
    }
    const { front } = slotsOf(i, p.width);
    const piece = (kind: "slot" | "psu", r: FaceRect): FacePiece => ({ kind, name: kind === "psu" ? "PSU" : "", ...onRack(r) });
    out.push(...front.slots.map((r) => piece("slot", r)), ...front.psus.map((r) => piece("psu", r)));
  }
  return out;
}

/** An equipment item's side as the Adapter Slot tool sees it (adapterSlots.ts). */
export interface SlotFace {
  readonly name: string;
  /** the item's face drawn, as its detail view has it */
  readonly pieces: readonly FacePiece[];
  /** the room on it for slots: not its ears */
  readonly room: FaceRect;
  /** its adapter slots, both sides */
  readonly slots: readonly AdapterSlot[];
  /** the sockets of the devices it's linked to, by name; none when it isn't linked */
  readonly sockets: readonly string[];
  readonly linked: boolean;
}

/** An equipment item's side for the Adapter Slot tool; null for a rack frame or what isn't equipment. */
export function slotFace(s: EditSession, id: string, side: Mounting): SlotFace | null {
  const i = itemOf(s.doc, id);
  if (!i || i.frame) return null;
  const { name, room } = faceOf(s.doc, i);
  const linked = i.value(FIELD.link) === true && devicesNamed(s, name).length > 0;
  return { name, pieces: equipmentFaces(s, id, side)?.pieces.filter((p) => p.kind !== "adapter") ?? [], room, slots: slotsIn(i), sockets: linked ? socketNamesOf(s, name) : [], linked };
}

/** What a slot shows on an item, for the Adapter Slot tool: the adapter on the socket it stands for in the item's linked devices, its Adapter Type, or crossed lines; and whether it stands for a socket. */
export function slotShown(s: EditSession, id: string, k: AdapterSlot): { text: string; cross: boolean; linked: boolean } {
  const i = itemOf(s.doc, id);
  const device = i && i.value(FIELD.link) === true ? str(i.value(FIELD.name)).trim() : "";
  const socket = device ? slotSocket(s, device, k.name) : undefined;
  return { ...slotLabel(k, socket?.adapter), linked: socket !== undefined };
}

/** An item's adapter slots set, and the item drawn again, as part of a batch. */
export function setAdapterSlots(s: EditSession, id: string, slots: readonly AdapterSlot[]): void {
  const i = itemOf(s.doc, id);
  if (!i || i.frame) throw new Error("Adapter slots go in equipment items.");
  // equipment placed before the field was there gains it
  if (i.value(FIELD.adapterSlots) === undefined) s.growPluginFields(EQUIPMENT_ITEM, itemSpecs(""));
  s.setRecordField(id, i.format, FIELD.adapterSlots, slotsText(slots));
  const now = itemOf(s.doc, id)!;
  apply(s, id, planFor(s, now, {}, false));
}

/** The equipment whose outline in plan takes in `p` (its outline too): an item before a rack frame it's in, the smallest when several do (modular equipment in its frame); null for none. */
export function equipmentAt(doc: VwxDocument, p: Pt): { id: string; frame: boolean; ring: Pt[] } | null {
  let best: { id: string; frame: boolean; ring: Pt[]; area: number } | null = null;
  for (const i of itemsIn(doc)) {
    const v = valuesOf(i);
    const at = placementOf(doc, i.id, v, rackNamed(doc, str(v(FIELD.rack)).trim()));
    // in its own frame: across from its front's middle, back into its depth (and a little in front)
    const t = (-at.angle * Math.PI) / 180;
    const [dx, dy] = [p.x - at.at.x, p.y - at.at.y];
    const q = { x: dx * Math.cos(t) - dy * Math.sin(t), y: dx * Math.sin(t) + dy * Math.cos(t) };
    const depth = numOf(v(FIELD.depth));
    if (Math.abs(q.x) > at.width / 2 || q.y < -EAR || q.y > depth) continue;
    const area = at.width * depth;
    // equipment before a frame it's in, then the smallest
    const w = at.width / 2;
    const ring = [{ x: -w, y: 0 }, { x: w, y: 0 }, { x: w, y: depth }, { x: -w, y: depth }].map((c) => toWorld(at.at, at.angle, c));
    if (!best || (best.frame && !i.frame) || (best.frame === i.frame && area < best.area)) best = { id: i.id, frame: i.frame, ring, area };
  }
  return best && { id: best.id, frame: best.frame, ring: best.ring };
}

/** The Adapter Slot editor, opened on an item from its Object Info palette (set by adapterSlots.ts, which reads equipment, so this way round). */
export const adapterSlotEditor = { open: (_id: string): void => {} };

/**
 * Where the drawing's equipment is, by name, for cable lengths: each item and frame of a name, the
 * rack it's in (by object; "" for none) and its middle's height above the floor (none for equipment
 * below a rack), mm.
 */
export function equipmentSpots(doc: VwxDocument): Map<string, EquipmentSpot[]> {
  const out = new Map<string, EquipmentSpot[]>();
  for (const i of itemsIn(doc)) {
    const v = valuesOf(i);
    const name = str(v(FIELD.name)).trim();
    if (!name) continue;
    const rack = rackNamed(doc, str(v(FIELD.rack)).trim());
    const p = placementOf(doc, i.id, v, rack);
    const [w, d] = [p.width / 2, numOf(v(FIELD.depth))];
    const ring = [{ x: -w, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: -w, y: d }].map((q) => toWorld(p.at, p.angle, q));
    out.set(name, [...(out.get(name) ?? []), { id: i.id, rack: p.rack, height: Math.max(0, p.z + p.height / 2), ring, drop: p.rack || i.frame ? "" : str(v(FIELD.drop)).trim() }]);
  }
  return out;
}

/** Where an equipment item or frame is, for cable lengths: the rack it's in (by object; "" for none), its middle's height above the floor, its outline in plan, and the drop point it's cabled from (by name; "" for none). */
export interface EquipmentSpot {
  readonly id: string;
  readonly rack: string;
  readonly height: number;
  readonly ring: readonly Pt[];
  readonly drop: string;
}

/**
 * Equipment's drop points: the drawing's drop points' names (set by cableRoute.ts, which reads
 * equipment, so this way round), how many items name one, the items following a renamed one, and
 * the Drop Point field given to the drawing's equipment.
 */
export const dropPoints = {
  names: (_doc: VwxDocument): string[] => [],
  connected: (doc: VwxDocument, name: string): number => itemsIn(doc).filter((i) => !i.frame && str(i.value(FIELD.drop)).trim() === name).length,
  /** as part of a batch */
  rename(s: EditSession, from: string, to: string): void {
    for (const i of itemsIn(s.doc)) if (!i.frame && str(i.value(FIELD.drop)).trim() === from) s.setRecordField(i.id, i.format, FIELD.drop, to);
  },
  /** as part of a batch: equipment placed before the field was there gains it */
  grow: (s: EditSession): void => s.growPluginFields(EQUIPMENT_ITEM, itemSpecs("")),
};

/** Whether units `u` up are free on the front of the rack whose Rack ID is `rackId`, for equipment that wide and tall. */
export const unitsFree = (doc: VwxDocument, rackId: string, u: number, units: number, rackWidth: RackWidth): boolean => freeAt(doc, rackId, "Front", u, units, rackWidth === "Half", "");

/** The unit the next equipment stacked below a rack takes: under what's there already. */
export function belowRack(doc: VwxDocument, rackId: string): number {
  const below = itemsIn(doc).filter((i) => str(i.value(FIELD.rack)).trim() === rackId && Math.round(numOf(i.value(FIELD.rackU))) <= 0);
  return Math.min(0, ...below.map((i) => Math.round(numOf(i.value(FIELD.rackU))) - Math.max(1, Math.round(numOf(i.value(FIELD.ru))))));
}

/** The tool's click: equipment in the rack under it or on its own, selected. */
export function placeEquipmentItem(layerId: string, at: Pt): void {
  const r = attempt("Equipment Item", (s) => s.batch(() => addEquipmentItem(s, layerId, at, rackUnder(s.doc, at))));
  if (r) setSelection([r.value]);
}

/** Where the Equipment Item tool (or with `frame`, the Rack Frame tool) would put what it makes for a click at `p`: its outline on the drawing. */
export function itemPreview(doc: VwxDocument, p: Pt, frame = false): Pt[] {
  const k = frame ? { ...frameSettings, width: 482.6, rackWidth: "Full" as RackWidth } : itemSettings;
  const rack = rackUnder(doc, p);
  const place = rack ? rackPlace(doc, rack) : null;
  let at = p;
  let angle = 0;
  let width = k.width;
  if (place) {
    const face = mountFace(place.size, k.mounting);
    const u = freeUnit(doc, rack!, k.mounting, k.ru, k.rackWidth === "Half", "");
    at = place.toWorld({ x: 0, y: unitAt(face, u).y });
    angle = place.angle + (face.rear ? 180 : 0);
    if (k.rackWidth !== "Non-rack") width = k.rackWidth === "Full" ? face.width : face.width / 2;
  }
  const w = width / 2;
  return [
    { x: -w, y: 0 },
    { x: w, y: 0 },
    { x: w, y: k.depth },
    { x: -w, y: k.depth },
  ].map((q) => toWorld(at, angle, q));
}

const POSITIVE: ReadonlySet<string> = new Set([FIELD.height, FIELD.width, FIELD.depth]);
const NOT_NEGATIVE: ReadonlySet<string> = new Set([FIELD.power, FIELD.btu, FIELD.weight, FIELD.mountDepth]);

/** What setting one of an item's fields writes. */
function keptFor(s: EditSession, i: Item, field: string, value: RecordValue): Record<string, RecordValue> {
  const n = Number(value);
  if (POSITIVE.has(field) && !(n > 0)) throw new Error(`${field} has to be more than 0.`);
  if (NOT_NEGATIVE.has(field) && !(n >= 0)) throw new Error(`${field} can't be below 0.`);
  const autoBtu = (power: number): Record<string, RecordValue> => (i.value(FIELD.autoBtu) !== false ? { [FIELD.btu]: round(power * BTU_PER_WATT) } : {});
  switch (field) {
    case FIELD.ru:
      if (!(Math.round(n) >= 1)) throw new Error("Height RU is a whole number of rack units, 1 or more.");
      // racked equipment is as tall as its units
      return { [field]: Math.round(n), ...(i.value(FIELD.rackWidth) !== "Non-rack" ? { [FIELD.height]: Math.round(n) * RACK_UNIT } : {}) };
    case FIELD.height:
      return { [field]: n, ...(i.value(FIELD.rackWidth) !== "Non-rack" ? { [FIELD.ru]: Math.max(1, Math.ceil(n / RACK_UNIT - 1e-6)) } : {}) };
    case FIELD.power:
      return { [field]: n, ...autoBtu(n) };
    case FIELD.autoBtu:
      return { [field]: value, ...(value !== false ? { [FIELD.btu]: round(numOf(i.value(FIELD.power)) * BTU_PER_WATT) } : {}) };
    case FIELD.rackU:
      if (!Number.isFinite(n)) throw new Error("Rack U is a whole number of units, 0 or less for below the rack.");
      return moduleFits(s, i, { [field]: Math.round(n) });
    case FIELD.rack: {
      const id = String(value).trim();
      const rack = rackNamed(s.doc, id);
      if (!rack || id === str(i.value(FIELD.rack)).trim()) return { [field]: id };
      // into another rack at its first free unit, modular equipment into its first frame with room
      const v: Values = (f) => i.value(f);
      const slot = !i.frame && v(FIELD.modular) === true ? freeSlot(s.doc, rack, mountingOf(v), whole(v(FIELD.slots)), i.id) : null;
      if (slot) return { [field]: id, [FIELD.rackU]: slot.u, [FIELD.slot]: slot.slot };
      return { [field]: id, [FIELD.rackU]: freeUnit(s.doc, rack, mountingOf(v), whole(v(FIELD.ru)), rackWidthOf(v) === "Half", i.id), ...(v(FIELD.modular) === true ? { [FIELD.slot]: 0 } : {}) };
    }
    case FIELD.modular: {
      if (i.frame) return { [field]: value };
      const v = withChanges(i, { [field]: value });
      const rack = rackNamed(s.doc, str(v(FIELD.rack)).trim());
      if (!rack) return { [field]: value, [FIELD.slot]: 0 };
      // in a rack, modular equipment goes into its first frame with room; plain, it takes a unit of its own
      if (value === true) {
        const slot = freeSlot(s.doc, rack, mountingOf(v), whole(v(FIELD.slots)), i.id);
        return slot ? { [field]: true, [FIELD.rackU]: slot.u, [FIELD.slot]: slot.slot } : { [field]: true };
      }
      return { [field]: false, [FIELD.slot]: 0, [FIELD.rackU]: freeUnit(s.doc, rack, mountingOf(v), whole(v(FIELD.ru)), rackWidthOf(v) === "Half", i.id) };
    }
    case FIELD.slots:
      if (!(Math.round(n) >= 1)) throw new Error("Number of Slots is a whole number, 1 or more.");
      return moduleFits(s, i, { [field]: Math.round(n) });
    case FIELD.slot:
      if (!(Math.round(n) >= 0)) throw new Error("Slot is a whole number, from 1 in a frame.");
      return moduleFits(s, i, { [field]: Math.round(n) });
    case FIELD.across:
    case FIELD.up:
      if (!(Math.round(n) >= 1)) throw new Error(`${field} is a whole number of slots, 1 or more.`);
      return modulesFit(s, i, { [field]: Math.round(n) });
    case FIELD.direction:
      return modulesFit(s, i, { [field]: value });
    case FIELD.psus:
      if (!(Math.round(n) >= 0 && Math.round(n) <= 8)) throw new Error("Power Supplies is a whole number from 0 to 8.");
      return { [field]: Math.round(n) };
    case FIELD.psuSize:
      if (!(n >= 1 && n <= 100)) throw new Error("PSU Size is a percentage of a slot's width, 1 to 100.");
      return { [field]: n };
    case FIELD.name: {
      const name = String(value).trim();
      const old = str(i.value(FIELD.name)).trim();
      if (i.value(FIELD.link) !== true || name === old) return { [field]: name };
      // the devices of its name are renamed with it; with none, it takes on those of its new name
      const devices = devicesNamed(s, old);
      for (const d of devices) renameDevice(s, d.rec.id, name, d.tag === old ? name : d.tag);
      return { [field]: name, ...(devices.length ? {} : fromDevice(s, name)) };
    }
    case FIELD.link:
      return { [field]: value, ...(value === true ? fromDevice(s, str(i.value(FIELD.name)).trim()) : {}) };
    case FIELD.drop: {
      const name = String(value).trim();
      if (name && !dropPoints.names(s.doc).includes(name)) throw new Error(`No drop point is named ${name}.`);
      return { [field]: name };
    }
  }
  return { [field]: value };
}

/** Module `i`'s fields as `changes` would make them, refused when that runs it off its frame's slots or onto another module's. */
function moduleFits(s: EditSession, i: Item, changes: Record<string, RecordValue>): Record<string, RecordValue> {
  const v = withChanges(i, changes);
  const frame = i.frame ? null : frameOf(s.doc, v);
  if (!frame) return changes;
  const run = runOf(frame, v);
  const name = str(frame.value(FIELD.name)).trim() || "its frame";
  if (!run) throw new Error(`${whole(v(FIELD.slots))} slot${whole(v(FIELD.slots)) === 1 ? "" : "s"} from slot ${Math.round(numOf(v(FIELD.slot)))} run off ${name}'s ${whole(frame.value(FIELD.across))} × ${whole(frame.value(FIELD.up))}.`);
  const taken = slotsTaken(s.doc, frame, i.id);
  if (run.some((n) => taken.has(n))) throw new Error(`Another module has some of those slots in ${name}.`);
  return changes;
}

/** Frame `f`'s fields as `changes` would make them, refused when a module in it would lose its slots. */
function modulesFit(s: EditSession, f: Item, changes: Record<string, RecordValue>): Record<string, RecordValue> {
  const next: Item = { ...f, value: withChanges(f, changes) };
  const taken = new Set<number>();
  for (const m of modulesIn(s.doc, f)) {
    const run = runOf(next, valuesOf(m));
    if (!run || run.some((n) => taken.has(n))) throw new Error(`${str(m.value(FIELD.name)).trim() || "A module"} would lose its slots; move it first.`);
    for (const n of run) taken.add(n);
  }
  return changes;
}

function write(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  // a frame's modules, found before its location changes
  const first = itemOf(s.doc, id);
  const modules = first?.frame ? modulesIn(s.doc, first) : [];
  const where = (i: Item): string => [FIELD.rack, FIELD.rackU, FIELD.mounting].map((f) => str(i.value(f))).join("|");
  const was = first ? where(first) : "";
  for (const [field, value] of Object.entries(values)) {
    const i = itemOf(s.doc, id);
    if (!i) throw new Error("That isn't equipment.");
    for (const [f, v] of Object.entries(keptFor(s, i, field, value))) if (i.value(f) !== v) s.setRecordField(id, i.format, f, v);
  }
  const i = itemOf(s.doc, id)!;
  apply(s, id, planFor(s, i, {}, false));
  if (first && where(i) !== was) carry(s, id, modules, first.value(FIELD.rackU));
}

// a device equipment stands for has the data the equipment keeps on it greyed
equipmentFor.linked = (s, name) => !!name && itemsIn(s.doc).some((i) => i.value(FIELD.link) === true && str(i.value(FIELD.name)).trim() === name);

// what's racked counts equipment, and the devices in the rack no equipment stands for
racked.in = (s, rackId) => {
  const items = itemsIn(s.doc);
  const linked = new Set(items.filter((i) => i.value(FIELD.link) === true).map((i) => str(i.value(FIELD.name)).trim()));
  return [
    ...items.filter((i) => str(i.value(FIELD.rack)).trim() === rackId).map((i) => ({ power: numOf(i.value(FIELD.power)), weight: numOf(i.value(FIELD.weight)) })),
    ...devicesOn(s)
      .filter((d) => str(d.rec.value("Rack")).trim() === rackId && !linked.has(d.name))
      .map((d) => ({ power: numOf(d.rec.value("Power (W)")), weight: numOf(d.rec.value("Weight (kg)")) })),
  ];
};

// equipment follows its rack, goes into or out of racks it's dragged onto or off, and keeps its devices up to date
followEdits((s) => {
  const stale = itemsIn(s.doc).filter((i) => planFor(s, i, {}, true).stale);
  if (stale.length)
    s.followOn(() => {
      for (const { id } of stale) {
        const i = itemOf(s.doc, id);
        if (i) apply(s, id, planFor(s, i, {}, true));
      }
    });
});

const SHOW_DEVICES = 30;
const ADAPTER_SLOTS = 36;
const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "divider", label: "General", level: 0 },
  param(2, FIELD.name),
  param(3, FIELD.link),
  { id: 4, kind: "divider", label: "Manufacturer", level: 0 },
  param(5, FIELD.make),
  param(6, FIELD.model),
  { id: 7, kind: "divider", label: "Physical", level: 0 },
  param(8, FIELD.height),
  param(9, FIELD.width),
  param(10, FIELD.depth),
  param(11, FIELD.power),
  param(12, FIELD.autoBtu),
  param(13, FIELD.btu),
  param(14, FIELD.weight),
  param(15, FIELD.ru),
  param(16, FIELD.rackWidth),
  param(17, FIELD.mounting),
  param(18, FIELD.mountDepth),
  { id: 31, kind: "divider", label: "Configuration", level: 0 },
  param(32, FIELD.modular),
  param(33, FIELD.slots),
  { id: 19, kind: "divider", label: "Display", level: 0 },
  param(20, FIELD.showText),
  param(21, FIELD.align),
  { id: 22, kind: "divider", label: "Location", level: 0 },
  param(23, FIELD.room),
  param(24, FIELD.rack),
  param(25, FIELD.rackU),
  param(34, FIELD.slot),
  param(35, FIELD.drop),
  { id: SHOW_DEVICES, kind: "button", label: "Show Schematic Device(s)", level: 0 },
  { id: ADAPTER_SLOTS, kind: "button", label: "Adapter Slots…", level: 0 },
];

const FRAME_WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "divider", label: "General", level: 0 },
  param(2, FIELD.name),
  param(3, FIELD.link),
  { id: 4, kind: "divider", label: "Manufacturer", level: 0 },
  param(5, FIELD.make),
  param(6, FIELD.model),
  { id: 7, kind: "divider", label: "Physical", level: 0 },
  param(8, FIELD.frameType),
  param(9, FIELD.mounting),
  param(10, FIELD.ru),
  param(11, FIELD.depth),
  param(12, FIELD.power),
  param(13, FIELD.autoBtu),
  param(14, FIELD.btu),
  param(15, FIELD.weight),
  { id: 16, kind: "divider", label: "Configuration", level: 0 },
  param(17, FIELD.across),
  param(18, FIELD.up),
  param(19, FIELD.direction),
  { id: 20, kind: "divider", label: "Options", level: 0 },
  param(21, FIELD.psus),
  param(22, FIELD.psuSide),
  param(23, FIELD.psuSize),
  param(24, FIELD.door),
  { id: 25, kind: "divider", label: "Location", level: 0 },
  param(26, FIELD.room),
  param(27, FIELD.rack),
  param(28, FIELD.rackU),
  { id: SHOW_DEVICES, kind: "button", label: "Show Schematic Device(s)", level: 0 },
];

/** Selects the devices of an item's name and goes to the layer of the first. */
function showDevices(id: string): void {
  const s = store.session;
  const i = s ? itemOf(s.doc, id) : null;
  if (!s || !i) return;
  const devices = devicesNamed(s, str(i.value(FIELD.name)).trim());
  if (!devices.length) return;
  setActiveLayer(devices[0].rec.layerId);
  setSelection(devices.filter((d) => d.rec.layerId === devices[0].rec.layerId).map((d) => d.rec.id));
}

const driver: PluginDriver = {
  name: EQUIPMENT_ITEM,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => READ_ONLY.has(field),
  choices(field) {
    if (field === FIELD.drop) {
      const names = store.session ? dropPoints.names(store.session.doc) : [];
      return [{ value: "", label: "None" }, ...[...new Set(names)].sort((a, b) => a.length - b.length || a.localeCompare(b)).map((value) => ({ value, label: value }))];
    }
    const list = field === FIELD.rackWidth ? RACK_WIDTHS : field === FIELD.mounting ? MOUNTINGS : field === FIELD.align ? ALIGNS : field === FIELD.frameType ? FRAME_TYPES : field === FIELD.direction ? SLOT_DIRECTIONS : field === FIELD.psuSide ? PSU_SIDES : null;
    return list?.map((value) => ({ value, label: value }));
  },
  place: (layerId, at) => placeEquipmentItem(layerId, at),
  edit(id, values) {
    attempt(store.session && itemOf(store.session.doc, id)?.frame ? "Edit Rack Frame" : "Edit Equipment Item", (s) => s.batch(() => write(s, id, values)));
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const i = itemOf(s.doc, id);
        if (i) apply(s, id, planFor(s, i, {}, false));
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, set) {
    const s = store.session;
    const i = s ? itemOf(s.doc, id) : null;
    if (!s || !i) return;
    const name = str(i.value(FIELD.name)).trim();
    const linked = i.value(FIELD.link) === true && devicesNamed(s, name).length > 0;
    const modular = i.value(FIELD.modular) === true;
    const psus = whole(i.value(FIELD.psus), 0) > 0;
    set(
      new Map(
        i.frame
          ? [
              [14, { enabled: i.value(FIELD.autoBtu) === false, visible: true }],
              [22, { enabled: psus, visible: true }],
              [23, { enabled: psus, visible: true }],
              [SHOW_DEVICES, { enabled: linked, visible: true }],
            ]
          : [
              [13, { enabled: i.value(FIELD.autoBtu) === false, visible: true }],
              [21, { enabled: i.value(FIELD.showText) !== false, visible: true }],
              [33, { enabled: modular, visible: true }],
              [34, { enabled: modular, visible: true }],
              // racked equipment is cabled through its rack
              [35, { enabled: !rackNamed(s.doc, str(i.value(FIELD.rack)).trim()), visible: true }],
              [SHOW_DEVICES, { enabled: linked, visible: true }],
            ],
      ),
    );
  },
  press(id, widget) {
    if (widget === SHOW_DEVICES) showDevices(id);
    else if (widget === ADAPTER_SLOTS) adapterSlotEditor.open(id);
  },
};

// a rack frame shares equipment's machinery, with its own fields and tool
const frameDriver: PluginDriver = { ...driver, name: RACK_FRAME, place: (layerId, at) => placeRackFrame(layerId, at), layout: () => FRAME_WIDGETS };

registerPluginDrivers(() => [driver, frameDriver]);
