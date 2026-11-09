// Site Planning's Massing Model: a building shell for context, from an outline. It's a plug-in with Rodeo's own name,
// placed at its first corner: its corners move with Reshape, it draws its roof or footprint in plan with a label, and in
// 3D its walls, floors and roof. It can modify a site model, as a pad under it and grade limits round it.

import type { EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { registerModifierSource, registerPluginDrivers, registerSurfaceSender, type PluginDriver, type PluginWidget } from "./ext.ts";
import { floorUsages, grossArea, limitsRing, massing, shadowRings } from "./massingShapes.ts";
import { showDialog } from "./menubar.ts";
import type { EaveProfile } from "./roofShapes.ts";
import { nearColour, pen, surfaceHeightAt, uniqueName, type Look } from "./siteModel.ts";
import type { SiteModifier } from "./siteModelShapes.ts";
import { layerScaleOf } from "./spaces.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs, type PrefField } from "./toolPrefs.ts";
import { formatArea } from "./units.ts";

export const MASSING_MODEL = "Rodeo Massing Model";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

export const FIELD = {
  name: "Building Name",
  show: "Show in Plan",
  label: "Label",
  base: "Base Elevation",
  height: "Height",
  floors: "Floor Count",
  usage: "Floor Usage Data",
  wallClass: "Wall Class",
  overhang: "Roof Overhang",
  thickness: "Roof Thickness",
  roofClass: "Roof Class",
  pitched: "Pitched Roof",
  eave: "Eave Style",
  slope: "Roof Slope",
  drawFloors: "Draw Floors",
  slab: "Slab Thickness",
  shadow: "Display Shadow in Plan View",
  site: "Use Site Modifiers",
  limits: "Use Grade Limits",
  limitsOff: "Grade Limits Off.",
  gross: "Gross Area",
  labelX: "Label X",
  labelY: "Label Y",
  /** kept out of Object Info */
  path: "Path Points",
} as const;

const SHOWS = ["Roof", "Footprint"] as const;
const LABELS = ["None", "Name", "Gross Area", "Name and Gross Area"] as const;
const EAVES: readonly (readonly [string, EaveProfile])[] = [
  ["Square", "square"],
  ["Vertical", "vertical"],
  ["Horizontal", "horizontal"],
];
const OWN_CLASS = "<Massing Model Class>";

const POPUPS: Readonly<Record<string, readonly string[]>> = {
  [FIELD.show]: SHOWS,
  [FIELD.label]: LABELS,
  [FIELD.eave]: EAVES.map(([name]) => name),
};

/** how thick the walls of the shell are, mm: only a section shows them */
const WALL_THICKNESS = 200;
const COLOUR = { wall: "#d9d4c8", floor: "#bdb8ac", roof: "#8e8a83", back: "#ffffff", line: "#000000", shadow: "#9a9a9a" } as const;
const EAVE_MILS = 14;
const WALL_MILS = 7;
const RIDGE_MILS = 4;
/** a label's height on paper, mm */
const LABEL_MM = 2.5;
/** how far a shadow falls for its height */
const SHADOW_REACH = 0.35;

export interface MassingSettings {
  name: string;
  show: string;
  label: string;
  height: number;
  floors: number;
  overhang: number;
  thickness: number;
  pitched: boolean;
  eave: string;
  slope: number;
  drawFloors: boolean;
  slab: number;
  shadow: boolean;
  site: boolean;
  limits: boolean;
  limitsOff: number;
}

export const newMassingSettings = (): MassingSettings => ({
  name: "Building",
  show: SHOWS[0],
  label: LABELS[3],
  height: 9000,
  floors: 3,
  overhang: 300,
  thickness: 200,
  pitched: true,
  eave: EAVES[0][0],
  slope: 30,
  drawFloors: true,
  slab: 200,
  shadow: false,
  site: false,
  limits: true,
  limitsOff: 3000,
});

/** The settings dialog, for the tool and a double-click. */
export async function massingDialog(start: MassingSettings): Promise<MassingSettings | null> {
  const choice = (key: string, value: string, options: readonly string[]): PrefField => ({ kind: "choice", key, label: key, value, options: options.map((o) => ({ value: o, label: o })) });
  const v = await toolPrefs(
    "Massing Model",
    [
      { kind: "text", key: FIELD.name, label: "Name", value: start.name },
      choice(FIELD.show, start.show, SHOWS),
      choice(FIELD.label, start.label, LABELS),
      { kind: "length", key: FIELD.height, label: FIELD.height, value: start.height },
      { kind: "number", key: FIELD.floors, label: FIELD.floors, value: start.floors, min: 1, max: 200, integer: true },
      { kind: "heading", key: "", label: "Roof" },
      { kind: "check", key: FIELD.pitched, label: FIELD.pitched, value: start.pitched },
      choice(FIELD.eave, start.eave, POPUPS[FIELD.eave]),
      { kind: "number", key: FIELD.slope, label: FIELD.slope, value: start.slope, min: 1, max: 80, unit: "°" },
      { kind: "length", key: FIELD.overhang, label: FIELD.overhang, value: start.overhang, zero: true },
      { kind: "length", key: FIELD.thickness, label: FIELD.thickness, value: start.thickness },
      { kind: "heading", key: "", label: "Floors" },
      { kind: "check", key: FIELD.drawFloors, label: FIELD.drawFloors, value: start.drawFloors },
      { kind: "length", key: FIELD.slab, label: FIELD.slab, value: start.slab },
      { kind: "heading", key: "", label: "Site" },
      { kind: "check", key: FIELD.shadow, label: FIELD.shadow, value: start.shadow },
      { kind: "check", key: FIELD.site, label: FIELD.site, value: start.site },
      { kind: "check", key: FIELD.limits, label: FIELD.limits, value: start.limits },
      { kind: "length", key: FIELD.limitsOff, label: FIELD.limitsOff, value: start.limitsOff },
    ],
    "Height is to the eaves. With Use Site Modifiers it makes a pad under itself and grade limits round it; update the site model to see them.",
  );
  if (!v) return null;
  return {
    name: v.choice(FIELD.name),
    show: v.choice(FIELD.show),
    label: v.choice(FIELD.label),
    height: v.num(FIELD.height),
    floors: v.num(FIELD.floors),
    overhang: v.num(FIELD.overhang),
    thickness: v.num(FIELD.thickness),
    pitched: v.flag(FIELD.pitched),
    eave: v.choice(FIELD.eave),
    slope: v.num(FIELD.slope),
    drawFloors: v.flag(FIELD.drawFloors),
    slab: v.num(FIELD.slab),
    shadow: v.flag(FIELD.shadow),
    site: v.flag(FIELD.site),
    limits: v.flag(FIELD.limits),
    limitsOff: v.num(FIELD.limitsOff),
  };
}

/** What a massing model is drawn from: Rodeo's own, or Vectorworks Landmark's read as one (features/landmark). */
export interface Building {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  /** a parameter, by Rodeo's name for it (FIELD) */
  value(field: string): RecordValue | undefined;
  /** its outline in its own frame, when it isn't kept in Path Points */
  readonly corners?: readonly Pt[];
  /** keeps its gross area (mm², all floors), when it isn't kept as Gross Area's text */
  gross?(s: EditSession, area: number): void;
}

function buildingOf(doc: VwxDocument, id: string): Building | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === MASSING_MODEL && r.fields.some((f) => f.name === FIELD.path));
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const numberOf = (b: Building, field: string): number => Number(b.value(field)) || 0;

const cornersOf = (b: Building): Pt[] => {
  if (b.corners) return [...b.corners];
  try {
    return JSON.parse(String(b.value(FIELD.path) || "[]")) as Pt[];
  } catch {
    return [];
  }
};

function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

const classNamed = (doc: VwxDocument, name: string): number | null => (name === OWN_CLASS ? null : (doc.classes().find((c) => c.name === name)?.index ?? null));

/** Draws a massing model again from its parameters, in place of what it showed. */
export function redraw(s: EditSession, b: Building): void {
  const doc = s.doc;
  const corners = cornersOf(b);
  const object = doc.object(b.id);
  const layer = doc.layers().find((l) => l.id === b.layerId);
  const shell = massing({
    outline: corners,
    // the layer's elevation is added as they're made, and a plug-in object's drawing is lifted by it again when shown
    base: numberOf(b, FIELD.base) - (layer?.elevation ?? 0),
    height: numberOf(b, FIELD.height),
    floors: numberOf(b, FIELD.floors),
    pitched: b.value(FIELD.pitched) === true,
    eave: EAVES.find(([name]) => name === b.value(FIELD.eave))?.[1] ?? "square",
    slope: numberOf(b, FIELD.slope),
    overhang: numberOf(b, FIELD.overhang),
    roofThickness: numberOf(b, FIELD.thickness),
    drawFloors: b.value(FIELD.drawFloors) === true,
    slabThickness: numberOf(b, FIELD.slab),
    wallThickness: WALL_THICKNESS,
  });
  if (!shell) throw new Error("A massing model takes an outline of three corners or more, and a height.");
  const colour = nearColour(doc);
  const classIndex = object?.classIndex ?? store.activeClassIndex;
  const scale = layerScaleOf(b.layerId);
  const back = colour(COLOUR.back);
  const covered: Look = { ...pen(colour(COLOUR.line), EAVE_MILS), fillPattern: 1, fillFore: back, fillBack: back, fillOpacity: 100 };
  const shapes: NewShape[] = [];
  const looks: Look[] = [];
  const add = (shape: NewShape, look: Look): void => {
    shapes.push(shape);
    looks.push(look);
  };
  const roofShown = b.value(FIELD.show) !== "Footprint";
  const plan = roofShown ? shell.eaves : corners;
  if (b.value(FIELD.shadow) === true) {
    const by = numberOf(b, FIELD.height) * SHADOW_REACH;
    const grey = colour(COLOUR.shadow);
    for (const ring of shadowRings(plan, -by, -by)) add({ kind: "polygon", points: ring, closed: true }, { ...store.drawAttrs, fillPattern: 1, fillFore: grey, fillBack: grey, fillOpacity: 100, lineStyle: 0 });
  }
  add({ kind: "polygon", points: [...plan], closed: true }, covered);
  if (roofShown) {
    add({ kind: "polygon", points: [...corners], closed: true }, { ...pen(colour(COLOUR.line), WALL_MILS), fillPattern: 0 });
    for (const [p, q] of shell.lines) add({ kind: "line", a: p, b: q } as NewShape, pen(colour(COLOUR.line), RIDGE_MILS));
  }
  const area = formatArea(grossArea(corners, numberOf(b, FIELD.floors)), doc.info.units);
  const name = String(b.value(FIELD.name) ?? "");
  const label = String(b.value(FIELD.label));
  const lines = [...(label === "Name" || label === "Name and Gross Area" ? [name] : []), ...(label === "Gross Area" || label === "Name and Gross Area" ? [`Area: ${area}`] : [])].filter(Boolean);
  if (lines.length) add({ kind: "text", at: { x: numberOf(b, FIELD.labelX), y: numberOf(b, FIELD.labelY) }, text: lines.join("\r"), height: LABEL_MM * scale, hAlign: 2, vAlign: 5 } as NewShape, { fillPattern: 0 });
  if (b.gross) b.gross(s, grossArea(corners, numberOf(b, FIELD.floors)));
  else s.setRecordField(b.id, b.format, FIELD.gross, area);
  const ids = s.addObjects(b.layerId, shapes, classIndex, looks);
  // each kind of part in the class chosen for it, or looking as a shell does
  const solidIn = (faces: number[][], css: string, chosen: RecordValue | undefined): void => {
    if (!faces.length) return;
    const cls = classNamed(doc, String(chosen ?? OWN_CLASS));
    const fill = colour(css);
    const [id] = s.addMeshes(b.layerId, [faces], cls ?? classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: 100, lineStyle: 0 });
    if (cls !== null) for (const group of ["fill", "lineStyle", "penColor", "lineWeight", "opacity"] as const) s.setAttributesByClass([id], group, true);
    ids.push(id);
  };
  solidIn(shell.walls, COLOUR.wall, b.value(FIELD.wallClass));
  solidIn(shell.floors, COLOUR.floor, b.value(FIELD.wallClass));
  solidIn(shell.roof, COLOUR.roof, b.value(FIELD.roofClass));
  s.setPluginDrawing(b.id, ids);
}

const clean = (corners: readonly Pt[]): Pt[] => {
  const out: Pt[] = [];
  for (const p of corners) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) <= 1) out.pop();
  return out;
};

/** A new massing model on a layer, as part of a batch: on the ground at its middle, if a site model is under it. */
export function addMassingModel(s: EditSession, layerId: string, outline: readonly Pt[], k: MassingSettings): string {
  const corners = clean(outline);
  if (corners.length < 3) throw new Error("A massing model takes an outline of three corners or more.");
  const at = corners[0];
  const local = corners.map((p) => ({ x: p.x - at.x, y: p.y - at.y }));
  const box = { x0: Math.min(...local.map((p) => p.x)), x1: Math.max(...local.map((p) => p.x)), y1: Math.max(...local.map((p) => p.y)) };
  const middle = { x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length, y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length };
  const specs: PluginFieldSpec[] = [
    { name: FIELD.name, type: TEXT, value: k.name },
    { name: FIELD.show, type: POPUP, value: k.show },
    { name: FIELD.label, type: POPUP, value: k.label },
    { name: FIELD.base, type: DIMENSION, value: surfaceHeightAt(s.doc, middle) ?? 0 },
    { name: FIELD.height, type: DIMENSION, value: k.height },
    { name: FIELD.floors, type: NUMBER, value: k.floors },
    { name: FIELD.usage, type: TEXT, value: "" },
    { name: FIELD.wallClass, type: POPUP, value: OWN_CLASS },
    { name: FIELD.overhang, type: DIMENSION, value: k.overhang },
    { name: FIELD.thickness, type: DIMENSION, value: k.thickness },
    { name: FIELD.roofClass, type: POPUP, value: OWN_CLASS },
    { name: FIELD.pitched, type: BOOL, value: k.pitched },
    { name: FIELD.eave, type: POPUP, value: k.eave },
    { name: FIELD.slope, type: NUMBER, value: k.slope },
    { name: FIELD.drawFloors, type: BOOL, value: k.drawFloors },
    { name: FIELD.slab, type: DIMENSION, value: k.slab },
    { name: FIELD.shadow, type: BOOL, value: k.shadow },
    { name: FIELD.site, type: BOOL, value: k.site },
    { name: FIELD.limits, type: BOOL, value: k.limits },
    { name: FIELD.limitsOff, type: DIMENSION, value: k.limitsOff },
    { name: FIELD.gross, type: TEXT, value: "" },
    { name: FIELD.labelX, type: DIMENSION, value: (box.x0 + box.x1) / 2 },
    { name: FIELD.labelY, type: DIMENSION, value: box.y1 + k.overhang + 2 * layerScaleOf(layerId) },
    { name: FIELD.path, type: TEXT, value: JSON.stringify(local) },
  ];
  const id = s.addPluginObject(layerId, MASSING_MODEL, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
  s.setObjectName(id, uniqueName(s.doc, k.name || "Massing Model", id));
  const b = buildingOf(s.doc, id);
  if (!b) throw new Error("The massing model couldn't be made.");
  redraw(s, b);
  return id;
}

/** The tool's outline as a massing model, selected. */
export function placeMassingModel(layerId: string, outline: readonly Pt[], k: MassingSettings): void {
  const r = attempt("Massing Model", (s) => s.batch(() => addMassingModel(s, layerId, outline, k)));
  if (r) setSelection([r.value]);
}

function write(s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void {
  const b = buildingOf(s.doc, id);
  if (!b) throw new Error("That isn't a massing model.");
  for (const [field, value] of Object.entries(values)) {
    let kept = value;
    if (field === FIELD.floors) kept = Math.max(1, Math.round(Number(value) || 1));
    if (field === FIELD.slope) kept = Math.max(1, Math.min(80, Number(value) || 1));
    if (field === FIELD.height && !(Number(value) > 0)) throw new Error("A massing model needs a height.");
    s.setRecordField(id, b.format, field, kept);
  }
  const live = buildingOf(s.doc, id);
  if (live) redraw(s, live);
}

async function openSettings(id: string): Promise<void> {
  const session = store.session;
  const b = session ? buildingOf(session.doc, id) : null;
  if (!session || !b) return;
  const k = await massingDialog({
    name: String(b.value(FIELD.name) ?? ""),
    show: String(b.value(FIELD.show)),
    label: String(b.value(FIELD.label)),
    height: numberOf(b, FIELD.height),
    floors: numberOf(b, FIELD.floors),
    overhang: numberOf(b, FIELD.overhang),
    thickness: numberOf(b, FIELD.thickness),
    pitched: b.value(FIELD.pitched) === true,
    eave: String(b.value(FIELD.eave)),
    slope: numberOf(b, FIELD.slope),
    drawFloors: b.value(FIELD.drawFloors) === true,
    slab: numberOf(b, FIELD.slab),
    shadow: b.value(FIELD.shadow) === true,
    site: b.value(FIELD.site) === true,
    limits: b.value(FIELD.limits) === true,
    limitsOff: numberOf(b, FIELD.limitsOff),
  });
  if (!k || store.session !== session) return;
  attempt("Massing Model", (s) =>
    s.batch(() => {
      write(s, id, {
        [FIELD.name]: k.name,
        [FIELD.show]: k.show,
        [FIELD.label]: k.label,
        [FIELD.height]: k.height,
        [FIELD.floors]: k.floors,
        [FIELD.overhang]: k.overhang,
        [FIELD.thickness]: k.thickness,
        [FIELD.pitched]: k.pitched,
        [FIELD.eave]: k.eave,
        [FIELD.slope]: k.slope,
        [FIELD.drawFloors]: k.drawFloors,
        [FIELD.slab]: k.slab,
        [FIELD.shadow]: k.shadow,
        [FIELD.site]: k.site,
        [FIELD.limits]: k.limits,
        [FIELD.limitsOff]: k.limitsOff,
      });
      if (k.name) s.setObjectName(id, uniqueName(s.doc, k.name, id));
    }),
  );
}

async function floorUsageDialog(id: string): Promise<void> {
  const session = store.session;
  const b = session ? buildingOf(session.doc, id) : null;
  if (!session || !b) return;
  const usages = floorUsages(String(b.value(FIELD.usage) ?? ""), numberOf(b, FIELD.floors));
  const inputs = usages.map((value, i) => h("input", { cls: "menu-dialog-input", value, attrs: { "aria-label": `Floor ${i + 1}` } }));
  const rows = inputs.map((input, i) => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: `Floor ${i + 1}` }), input));
  const v = await showDialog<string>({
    title: "Floor Usage Data",
    okLabel: "OK",
    body: rows,
    check: () => {
      const bad = inputs.find((input) => input.value.includes(";"));
      if (bad) return { error: "Usage data can't hold a semi-colon.", focus: bad };
      return { value: inputs.map((input) => input.value.trim() || "Unspecified").join(";") };
    },
  });
  if (v === null || store.session !== session) return;
  attempt("Floor Usage Data", (s) => s.batch(() => write(s, id, { [FIELD.usage]: v })));
}

function sendToGround(id: string): void {
  const session = store.session;
  const o = session?.doc.object(id);
  const b = session ? buildingOf(session.doc, id) : null;
  if (!session || !o || !b) return;
  const corners = cornersOf(b).map(placeOf(o).toWorld);
  const middle = { x: corners.reduce((sum, p) => sum + p.x, 0) / corners.length, y: corners.reduce((sum, p) => sum + p.y, 0) / corners.length };
  const z = surfaceHeightAt(session.doc, middle);
  if (z === null) {
    toast("There's no site model under it.", "error");
    return;
  }
  attempt("Send to Surface", (s) => s.batch(() => write(s, id, { [FIELD.base]: z })));
}

// the menu's Send to Surface goes by its middle, as its own button does
registerSurfaceSender((s, o, height) => {
  const b = o.type === PLUGIN ? buildingOf(s.doc, o.id) : null;
  if (!b) return false;
  const corners = cornersOf(b).map(placeOf(o).toWorld);
  const z = height(corners.reduce((sum, p) => sum + p.x, 0) / corners.length, corners.reduce((sum, p) => sum + p.y, 0) / corners.length);
  if (z === null) throw new Error("It isn't over a site model.");
  write(s, o.id, { [FIELD.base]: z });
  return true;
});

// a site model reads them as it's updated
registerModifierSource((doc, modelLayer, scope): SiteModifier[] => {
  if (!doc.hasPluginFormat(MASSING_MODEL)) return [];
  const out: SiteModifier[] = [];
  for (const layer of doc.layers()) {
    if (scope === "Same Layer as Site Model only" && layer.id !== modelLayer) continue;
    if (scope === "Visible Layers Only" && layer.visibility !== "visible") continue;
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const b = buildingOf(doc, o.id);
      if (!b || b.value(FIELD.site) !== true) continue;
      const { toWorld } = placeOf(o);
      const corners = cornersOf(b);
      const ring = corners.map(toWorld);
      out.push({ kind: "pad", ring, elevation: numberOf(b, FIELD.base), slope: 0, slopeAngle: 0 });
      if (b.value(FIELD.limits) === true) {
        out.push({ kind: "limits", ring: limitsRing(ring, numberOf(b, FIELD.limitsOff)), elevation: 0, slope: 0, slopeAngle: 0 });
      }
    }
  }
  return out;
});

const BUTTON = { settings: 1, usage: 2, ground: 3 } as const;

const WIDGETS: readonly PluginWidget[] = (() => {
  const param = (id: number, field: string, label = ""): PluginWidget => ({ id, kind: "param", field, label, level: 0 });
  return [
    { id: BUTTON.settings, kind: "button", label: "Massing Model Settings", level: 0 },
    param(10, FIELD.name, "Name"),
    param(11, FIELD.show),
    param(12, FIELD.label),
    param(13, FIELD.labelX),
    param(14, FIELD.labelY),
    param(15, FIELD.base),
    { id: BUTTON.ground, kind: "button", label: "Send to Surface", level: 0 },
    param(16, FIELD.height),
    param(17, FIELD.floors),
    { id: BUTTON.usage, kind: "button", label: "Floor Usage Data", level: 0 },
    param(18, FIELD.wallClass),
    { id: 19, kind: "divider", label: "Roof", level: 0 },
    param(20, FIELD.pitched),
    param(21, FIELD.eave),
    param(22, FIELD.slope),
    param(23, FIELD.overhang),
    param(24, FIELD.thickness),
    param(25, FIELD.roofClass),
    { id: 26, kind: "divider", label: "Floors", level: 0 },
    param(27, FIELD.drawFloors),
    param(28, FIELD.slab),
    param(29, FIELD.gross),
    { id: 30, kind: "divider", label: "Site", level: 0 },
    param(31, FIELD.shadow),
    param(32, FIELD.site),
    param(33, FIELD.limits),
    param(34, FIELD.limitsOff),
  ];
})();

const driver: PluginDriver = {
  name: MASSING_MODEL,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === FIELD.gross,
  choices(field) {
    if (field === FIELD.wallClass || field === FIELD.roofClass) {
      const classes = store.session?.doc.classes().map((c) => c.name) ?? [];
      return [OWN_CLASS, ...classes].map((value) => ({ value, label: value }));
    }
    return POPUPS[field]?.map((value) => ({ value, label: value }));
  },
  place: () => toast("Draw it with the Massing Model tool in Site Planning.", "info"),
  edit(id, values) {
    attempt("Edit Massing Model", (s) => s.batch(() => write(s, id, values)));
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const b = buildingOf(s.doc, id);
        if (b) redraw(s, b);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const b = store.session ? buildingOf(store.session.doc, id) : null;
    if (!b) return;
    const shows = (widget: number, visible: boolean): [number, { enabled: boolean; visible: boolean }] => [widget, { enabled: true, visible }];
    const pitched = b.value(FIELD.pitched) === true;
    const site = b.value(FIELD.site) === true;
    apply(new Map([shows(21, pitched), shows(22, pitched), shows(28, b.value(FIELD.drawFloors) === true), shows(33, site), shows(34, site && b.value(FIELD.limits) === true)]));
  },
  open: (id) => void openSettings(id),
  press(id, widget) {
    if (widget === BUTTON.settings) void openSettings(id);
    else if (widget === BUTTON.usage) void floorUsageDialog(id);
    else if (widget === BUTTON.ground) sendToGround(id);
  },
  path(id) {
    const s = store.session;
    const b = s ? buildingOf(s.doc, id) : null;
    const o = s?.doc.object(id);
    return b && o ? { points: cornersOf(b).map(placeOf(o).toWorld), closed: true } : null;
  },
  setPath(s, id, corners) {
    const o = s.doc.object(id);
    if (!o) return;
    const local = clean(corners).map(placeOf(o).toLocal);
    if (local.length < 3) throw new Error("A massing model takes an outline of three corners or more.");
    write(s, id, { [FIELD.path]: JSON.stringify(local) });
  },
};
registerPluginDrivers(() => [driver]);
