// ConnectCAD's Equipment Rack 3D: a rack, console or enclosure for equipment, placed by the Equipment
// Rack 3D tool (a click for its front's middle, a click for which way it faces). A plug-in object
// ('Rodeo Equipment Rack') standing on its layer: in plan its outline, posts and heavier front with
// its Rack ID, and in 3D its frame and the rails, side panels and doors asked for. Editing an overall
// size changes what makes it up, as rackShapes.ts works out. Its Room ID is the layout room it stands
// in, and its power and total weight count the equipment and devices whose Rack is its Rack ID; both
// are kept up as the drawing changes.

import type { EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { followEdits, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { layerScaleOf } from "../../../app/spaces.ts";
import { store } from "../../../app/state.ts";
import { errorMessage } from "../../../app/toast.ts";
import type { Solid } from "../../../app/solids3d.ts";
import type { RackFoot } from "./cableLengthShapes.ts";
import { nextName } from "./ccadShapes.ts";
import { roomIdAt } from "./layoutRoom.ts";
import { insideRing } from "./layoutShapes.ts";
import { CUSTOM_OPENING, openingLabel, overallSet, RACK_OPENINGS, RACK_STYLES, rackDrawing, rackOverall, type OverallField, type RackPart, type RackSize, type RackStyle } from "./rackShapes.ts";
import { devicesOn } from "./schematic.ts";

export const EQUIPMENT_RACK = "Rodeo Equipment Rack";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  id: "Rack ID",
  make: "Make",
  model: "Model",
  opening: "Rack Opening",
  custom: "Custom Opening",
  units: "Height",
  depth: "Depth",
  style: "Rack Style",
  slope: "Console Slope",
  panel: "Panel Thickness",
  height: "Height (overall)",
  width: "Width (overall)",
  overallDepth: "Depth (overall)",
  postWidth: "Post Width",
  postDepth: "Post Depth",
  top: "Top Thickness",
  base: "Base Height",
  power: "Power Consumption (W)",
  rackWeight: "Weight of Rack (kg)",
  weight: "Total Weight (kg)",
  rails: "Draw Rails",
  sidePanels: "Draw Side Panels",
  frontDoor: "Draw Front Door",
  rearDoor: "Draw Rear Door",
  room: "Room ID",
} as const;

const OVERALL: Readonly<Record<string, OverallField>> = { [FIELD.height]: "height", [FIELD.width]: "width", [FIELD.overallDepth]: "depth" };
const READ_ONLY: ReadonlySet<string> = new Set([FIELD.power, FIELD.weight, FIELD.room]);

/** what the tool makes a rack with: the Preferences, asked the first time it's used in a drawing */
export const rackSettings = {
  id: "RACK1",
  make: "",
  model: "",
  opening: '19"',
  units: 42,
  depth: 800,
  style: "Rack (4-post)" as RackStyle,
  rackWeight: 100,
  rails: true,
  sidePanels: true,
  frontDoor: false,
  rearDoor: false,
};

const openingWidth = (label: string, custom: number): number => RACK_OPENINGS.find((o) => o.label === label)?.width ?? custom;

/** a new rack's frame, mm: posts to make a 19" rack 600 wide, its top, base and a console's slope and cladding */
const NEW_FRAME = { postWidth: 58.7, postDepth: 50, top: 50, base: 100, slope: 20, panel: 25, enclosureHeight: 2000 };

/** The size of the rack the tool would make now, for its preview. */
export const newRackSize = (): RackSize => ({ ...NEW_FRAME, style: rackSettings.style, units: rackSettings.units, opening: openingWidth(rackSettings.opening, 482.6), depth: rackSettings.depth });

/** greys a drawing's palette has, so they don't come out tinted */
const COLOUR: Readonly<Record<RackPart, string>> = { frame: "#333333", panel: "#808080", rail: "#c0c0c0", door: "#404040" };
/** a door's opacity, so what's in the rack shows through */
const DOOR_OPACITY = 45;
const OUTLINE_MILS = 7;
const FRONT_MILS = 20;
/** the Rack ID's height on paper, mm */
const LABEL_MM = 2.5;

interface Rack {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function rackOf(doc: VwxDocument, id: string): Rack | null {
  const rec = doc.object(id)?.type === PLUGIN ? doc.records(id).find((r) => r.parametric && r.name === EQUIPMENT_RACK) : undefined;
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const num = (r: Rack, field: string): number => Number(r.value(field)) || 0;
const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));


function sizeOf(r: Rack): RackSize {
  const style = RACK_STYLES.find((st) => st === r.value(FIELD.style)) ?? "Rack (4-post)";
  return {
    style,
    units: Math.max(1, Math.round(num(r, FIELD.units))),
    enclosureHeight: num(r, FIELD.height),
    opening: openingWidth(str(r.value(FIELD.opening)), num(r, FIELD.custom)),
    depth: num(r, FIELD.depth),
    postWidth: num(r, FIELD.postWidth),
    postDepth: num(r, FIELD.postDepth),
    top: num(r, FIELD.top),
    base: num(r, FIELD.base),
    slope: num(r, FIELD.slope),
    panel: num(r, FIELD.panel),
  };
}

/** A rack's kept values from its size: the overall ones are written as it's drawn. */
function sizeFields(k: RackSize): Record<string, RecordValue> {
  const label = openingLabel(k.opening);
  return {
    [FIELD.units]: k.units,
    ...(k.style === "Enclosure" ? { [FIELD.height]: k.enclosureHeight } : {}),
    [FIELD.opening]: label,
    ...(label === CUSTOM_OPENING ? { [FIELD.custom]: k.opening } : {}),
    [FIELD.depth]: k.depth,
    [FIELD.postWidth]: k.postWidth,
    [FIELD.panel]: k.panel,
    [FIELD.base]: k.base,
  };
}

function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return { toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }) };
}

/** What's racked in a rack by its Rack ID, for its totals: the devices assigned to it, until equipmentItem.ts says equipment items too. */
export const racked = {
  in: (s: EditSession, rackId: string): { power: number; weight: number }[] =>
    devicesOn(s)
      .filter((d) => str(d.rec.value("Rack")).trim() === rackId)
      .map((d) => ({ power: Number(d.rec.value("Power (W)")) || 0, weight: Number(d.rec.value("Weight (kg)")) || 0 })),
};

/** What a rack holds of the drawing: the layout room it stands in, and the power and weight of what's racked in it with its own. */
function heldBy(s: EditSession, r: Rack): Record<string, RecordValue> {
  const o = s.doc.object(r.id);
  const middle = o ? placeOf(o).toWorld({ x: 0, y: rackOverall(sizeOf(r)).depth / 2 }) : null;
  const id = str(r.value(FIELD.id)).trim();
  const inside = id ? racked.in(s, id) : [];
  const sum = (field: "power" | "weight"): number => Math.round(inside.reduce((t, d) => t + d[field], 0) * 100) / 100;
  return {
    [FIELD.room]: middle ? roomIdAt(s.doc, middle) : "",
    [FIELD.power]: sum("power"),
    [FIELD.weight]: Math.round((num(r, FIELD.rackWeight) + sum("weight")) * 100) / 100,
  };
}

const lifted = (faces: Solid, dz: number): Solid => faces.map((f) => f.map((v, i) => (i % 3 === 2 ? v + dz : v)));

/** Draws rack `r`, its overall sizes and what it holds written first, in the session's open batch. */
function drawRack(s: EditSession, r: Rack): void {
  const k = sizeOf(r);
  const all = rackOverall(k);
  const write = (values: Record<string, RecordValue>): void => {
    for (const [field, value] of Object.entries(values)) if (r.value(field) !== value) s.setRecordField(r.id, r.format, field, value);
  };
  write({ [FIELD.height]: all.height, [FIELD.width]: all.width, [FIELD.overallDepth]: all.depth, ...heldBy(s, r) });
  const drawing = rackDrawing(k, { rails: r.value(FIELD.rails) === true, sidePanels: r.value(FIELD.sidePanels) === true, frontDoor: r.value(FIELD.frontDoor) === true, rearDoor: r.value(FIELD.rearDoor) === true });
  const match = colorMatcher();
  const ink = (hex: string): number => match({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
  const black = ink("#000000");
  const white = ink("#ffffff");
  const grey = ink(COLOUR.frame);
  const scale = layerScaleOf(r.layerId);
  const classIndex = s.doc.object(r.id)?.classIndex ?? store.activeClassIndex;
  const shapes: NewShape[] = [];
  const looks: object[] = [];
  const add = (shape: NewShape, look: object): void => {
    shapes.push(shape);
    looks.push(look);
  };
  add({ kind: "polygon", points: drawing.outline, closed: true } as NewShape, { penFore: black, lineWeight: OUTLINE_MILS, fillPattern: 1, fillFore: white, fillBack: white, fillOpacity: 100 });
  for (const post of drawing.posts) add({ kind: "polygon", points: post, closed: true } as NewShape, { penFore: black, lineWeight: OUTLINE_MILS, fillPattern: 1, fillFore: grey, fillBack: grey, fillOpacity: 100 });
  for (const [a, b] of drawing.lines) add({ kind: "line", a, b } as NewShape, { penFore: black, lineWeight: OUTLINE_MILS });
  add({ kind: "line", a: drawing.front[0], b: drawing.front[1] } as NewShape, { penFore: black, lineWeight: FRONT_MILS });
  const name = str(r.value(FIELD.id)).trim();
  if (name) add({ kind: "text", at: drawing.label, text: name, height: LABEL_MM * scale, hAlign: 2, vAlign: 3, angle: 0 } as NewShape, { penFore: black, fillPattern: 0 });
  const ids = s.addObjects(r.layerId, shapes, classIndex, looks);
  // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
  const elevation = s.doc.layers().find((l) => l.id === r.layerId)?.elevation ?? 0;
  for (const { part, faces } of drawing.solids) {
    const fill = ink(COLOUR[part]);
    const [mesh] = s.addMeshes(r.layerId, [lifted(faces, -elevation)], classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: part === "door" ? DOOR_OPACITY : 100, lineStyle: 0 });
    ids.push(mesh);
  }
  s.setPluginDrawing(r.id, ids);
}

/** A new rack on a layer, as part of a batch: its front's middle at `at`, facing `angle` degrees round from the drawing's -y; its Rack ID numbered on when another rack has it. */
export function addEquipmentRack(s: EditSession, layerId: string, at: Pt, angle: number): string {
  const k = rackSettings;
  const wanted = k.id.trim();
  const id = wanted ? nextName(wanted, new Set(racksIn(s.doc).map((r) => str(r.value(FIELD.id)).trim()))) : "";
  const opening = openingWidth(k.opening, 482.6);
  const specs: PluginFieldSpec[] = [
    { name: FIELD.id, type: TEXT, value: id },
    { name: FIELD.make, type: TEXT, value: k.make },
    { name: FIELD.model, type: TEXT, value: k.model },
    { name: FIELD.opening, type: POPUP, value: openingLabel(opening) },
    { name: FIELD.custom, type: DIMENSION, value: opening },
    { name: FIELD.units, type: NUMBER, value: k.units },
    { name: FIELD.depth, type: DIMENSION, value: k.depth },
    { name: FIELD.style, type: POPUP, value: k.style },
    { name: FIELD.slope, type: NUMBER, value: NEW_FRAME.slope },
    { name: FIELD.panel, type: DIMENSION, value: NEW_FRAME.panel },
    { name: FIELD.height, type: DIMENSION, value: NEW_FRAME.enclosureHeight },
    { name: FIELD.width, type: DIMENSION, value: 0 },
    { name: FIELD.overallDepth, type: DIMENSION, value: 0 },
    { name: FIELD.postWidth, type: DIMENSION, value: NEW_FRAME.postWidth },
    { name: FIELD.postDepth, type: DIMENSION, value: NEW_FRAME.postDepth },
    { name: FIELD.top, type: DIMENSION, value: NEW_FRAME.top },
    { name: FIELD.base, type: DIMENSION, value: NEW_FRAME.base },
    { name: FIELD.power, type: NUMBER, value: 0 },
    { name: FIELD.rackWeight, type: NUMBER, value: k.rackWeight },
    { name: FIELD.weight, type: NUMBER, value: 0 },
    { name: FIELD.rails, type: BOOL, value: k.rails },
    { name: FIELD.sidePanels, type: BOOL, value: k.sidePanels },
    { name: FIELD.frontDoor, type: BOOL, value: k.frontDoor },
    { name: FIELD.rearDoor, type: BOOL, value: k.rearDoor },
    { name: FIELD.room, type: TEXT, value: "" },
  ];
  const made = s.addPluginObject(layerId, EQUIPMENT_RACK, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
  const r = rackOf(s.doc, made);
  if (!r) throw new Error("The rack couldn't be made.");
  drawRack(s, r);
  return made;
}

/** The tool's clicks: a rack, selected. */
export function placeEquipmentRack(layerId: string, at: Pt, angle: number): void {
  const r = attempt("Equipment Rack 3D", (s) => s.batch(() => addEquipmentRack(s, layerId, at, angle)));
  if (r) setSelection([r.value]);
}

/** Where a rack stands and what it is, for equipment in it: its size, its frame on the drawing, its angle and Room ID; null for no rack. */
export function rackPlace(doc: VwxDocument, id: string): { readonly id: string; readonly rackId: string; readonly size: RackSize; readonly toWorld: (q: Pt) => Pt; readonly angle: number; readonly room: string } | null {
  const r = rackOf(doc, id);
  const o = doc.object(id);
  return r && o ? { id, rackId: str(r.value(FIELD.id)).trim(), size: sizeOf(r), toWorld: placeOf(o).toWorld, angle: o.turned ?? 0, room: str(r.value(FIELD.room)) } : null;
}

/** A rack as its elevation draws it: its Rack ID, size and whether its rails are drawn, its layer, outline, front's middle and angle; null for no rack. */
export function rackView(doc: VwxDocument, id: string): { readonly id: string; readonly rackId: string; readonly size: RackSize; readonly rails: boolean; readonly layerId: string; readonly ring: readonly Pt[]; readonly at: Pt; readonly angle: number } | null {
  const r = rackOf(doc, id);
  const place = rackPlace(doc, id);
  const foot = footOf(doc, id);
  const o = doc.object(id);
  return r && place && foot && o ? { id, rackId: place.rackId, size: place.size, rails: r.value(FIELD.rails) === true, layerId: o.layerId, ring: foot.ring, at: place.toWorld({ x: 0, y: 0 }), angle: place.angle } : null;
}

/** The first rack whose Rack ID is `rackId`. */
export const rackNamed = (doc: VwxDocument, rackId: string): string | null => (rackId ? (racksIn(doc).find((r) => str(r.value(FIELD.id)).trim() === rackId)?.id ?? null) : null);

/** A rack's outline on the drawing and its middle, by its object. */
function footOf(doc: VwxDocument, id: string): RackFoot | null {
  const place = rackPlace(doc, id);
  if (!place) return null;
  const { width, depth } = rackOverall(place.size);
  const ring = [{ x: -width / 2, y: 0 }, { x: width / 2, y: 0 }, { x: width / 2, y: depth }, { x: -width / 2, y: depth }].map(place.toWorld);
  return { id, ring, middle: place.toWorld({ x: 0, y: depth / 2 }) };
}

/** The rack whose outline `p` is inside, the last drawn first. */
export function rackUnder(doc: VwxDocument, p: Pt): string | null {
  for (const r of [...racksIn(doc)].reverse()) {
    const foot = footOf(doc, r.id);
    if (foot && insideRing(p, foot.ring)) return r.id;
  }
  return null;
}

/** The drawing's racks' outlines and middles, for which stand side by side. */
export const rackFeet = (doc: VwxDocument): RackFoot[] => racksIn(doc).flatMap((r) => [footOf(doc, r.id)].filter((f): f is RackFoot => !!f));

/** The drawing's racks. */
export function racksIn(doc: VwxDocument): Rack[] {
  if (!doc.hasPluginFormat(EQUIPMENT_RACK)) return [];
  return doc.layers().flatMap((l) => doc.objects(l.id).flatMap((o) => (o.type === PLUGIN ? [rackOf(doc, o.id)].filter((r): r is Rack => !!r) : [])));
}

const POSITIVE: ReadonlySet<string> = new Set([FIELD.depth, FIELD.custom, FIELD.postWidth, FIELD.postDepth, FIELD.panel]);
const NOT_NEGATIVE: ReadonlySet<string> = new Set([FIELD.top, FIELD.base, FIELD.rackWeight]);

/** What setting one of a rack's fields writes: an overall size changes what makes it up. */
function keptFor(r: Rack, field: string, value: RecordValue): Record<string, RecordValue> {
  const overall = OVERALL[field];
  if (overall) return sizeFields(overallSet(sizeOf(r), overall, Number(value)));
  const n = Number(value);
  if (field === FIELD.units) {
    if (!(Math.round(n) >= 1)) throw new Error("A rack's Height is a whole number of rack units, 1 or more.");
    return { [field]: Math.round(n) };
  }
  if (field === FIELD.opening && value === CUSTOM_OPENING) return { [field]: value, [FIELD.custom]: sizeOf(r).opening };
  if (field === FIELD.slope && !(n >= 0 && n < 90)) throw new Error("A console's slope is from 0° up to 90°.");
  if (POSITIVE.has(field) && !(n > 0)) throw new Error(`${field} has to be more than 0.`);
  if (NOT_NEGATIVE.has(field) && !(n >= 0)) throw new Error(`${field} can't be below 0.`);
  return { [field]: field === FIELD.id ? String(value).trim() : value };
}

function write(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  for (const [field, value] of Object.entries(values)) {
    const r = rackOf(s.doc, id);
    if (!r) throw new Error("That isn't an equipment rack.");
    for (const [f, v] of Object.entries(keptFor(r, field, value))) s.setRecordField(id, r.format, f, v);
  }
  drawRack(s, rackOf(s.doc, id)!);
}

// a rack's Room ID and totals follow the rooms and devices as they change
followEdits((s) => {
  const stale = racksIn(s.doc).filter((r) => Object.entries(heldBy(s, r)).some(([field, value]) => r.value(field) !== value));
  if (stale.length)
    s.followOn(() => {
      for (const r of stale) for (const [field, value] of Object.entries(heldBy(s, r))) s.setRecordField(r.id, r.format, field, value);
    });
});

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "divider", label: "General", level: 0 },
  param(2, FIELD.id),
  param(3, FIELD.make),
  param(4, FIELD.model),
  { id: 5, kind: "divider", label: "Configuration", level: 0 },
  param(6, FIELD.opening),
  param(7, FIELD.custom),
  param(8, FIELD.units),
  param(9, FIELD.depth),
  param(10, FIELD.style),
  param(11, FIELD.slope),
  param(12, FIELD.panel),
  { id: 13, kind: "divider", label: "Physical", level: 0 },
  param(14, FIELD.height),
  param(15, FIELD.width),
  param(16, FIELD.overallDepth),
  param(17, FIELD.postWidth),
  param(18, FIELD.postDepth),
  param(19, FIELD.top),
  param(20, FIELD.base),
  param(21, FIELD.power),
  param(22, FIELD.rackWeight),
  param(23, FIELD.weight),
  { id: 24, kind: "divider", label: "Options", level: 0 },
  param(25, FIELD.rails),
  param(26, FIELD.sidePanels),
  param(27, FIELD.frontDoor),
  param(28, FIELD.rearDoor),
  { id: 29, kind: "divider", label: "Location", level: 0 },
  param(30, FIELD.room),
];

const driver: PluginDriver = {
  name: EQUIPMENT_RACK,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => READ_ONLY.has(field),
  choices(field) {
    if (field === FIELD.style) return RACK_STYLES.map((value) => ({ value, label: value }));
    if (field === FIELD.opening) return [...RACK_OPENINGS.map((o) => o.label), CUSTOM_OPENING].map((value) => ({ value, label: value }));
    return undefined;
  },
  place: (layerId, at, angle) => placeEquipmentRack(layerId, at, angle),
  edit(id, values) {
    attempt("Edit Equipment Rack", (s) => s.batch(() => write(s, id, values)));
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const r = rackOf(s.doc, id);
        if (r) drawRack(s, r);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const r = store.session ? rackOf(store.session.doc, id) : null;
    if (!r) return;
    const style = str(r.value(FIELD.style));
    const posts = style === "Rack (4-post)" || style === "Rack (2-post)" || style === "Enclosure";
    const shows = (visible: boolean): { enabled: boolean; visible: boolean } => ({ enabled: true, visible });
    const covers = { enabled: style !== "Rack (2-post)" && style !== "Console", visible: true };
    apply(
      new Map([
        [7, shows(r.value(FIELD.opening) === CUSTOM_OPENING)],
        [8, shows(style !== "Enclosure")],
        [11, shows(style === "Console")],
        [12, shows(style === "Console")],
        [17, shows(posts)],
        [18, shows(posts)],
        [19, shows(style !== "Rack (2-post)")],
        [25, { enabled: style !== "Console" && style !== "Enclosure", visible: true }],
        [26, { enabled: style === "Rack (4-post)", visible: true }],
        [27, covers],
        [28, { enabled: style === "Rack (4-post)", visible: true }],
      ]),
    );
  },
  press: () => {},
};

registerPluginDrivers(() => [driver]);
