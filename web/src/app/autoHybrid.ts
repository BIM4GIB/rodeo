// AEC > Create Auto Hybrid: the selected 3D objects held in a plug-in object that shows them as they
// are in 3D and, in Top/Plan, a plan worked out from them (autoHybridShapes.ts): the cut where a level
// plane at its Cut Plane Elevation goes through them, and the edges below and above it, each in the
// class, fill and pen its 2D Appearance sets. Object Info changes the cut plane's elevation and opens
// 2D Appearance; Modify > Edit Auto Hybrid (or a double-click) opens its 3D objects as a group, and
// leaving that group makes the auto hybrid again with its plan drawn afresh.

import type { Attributes, ByClassGroup, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue } from "../core/index.ts";
import { keyhole, nested, hybridPlan, type HybridPlan } from "./autoHybridShapes.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs, type PrefField } from "./toolPrefs.ts";
import { millimetresPerUnit } from "./units.ts";

export const AUTO_HYBRID = "Rodeo Auto Hybrid";

const TEXT = 4;
const DIMENSION = 7;
const WALL = 68;

const FIELD = {
  cut: "Cut Plane Elevation",
  /** the 2D Appearance settings, as JSON */
  look: "2D Appearance",
} as const;

type FillChoice = "none" | "contained" | "class";
type PenChoice = "contained" | "class";

/** A tab's class, fill and pen: its class's name, or "" for the 3D objects' own classes. */
interface Look {
  readonly cls: string;
  readonly fill: FillChoice;
  readonly pen: PenChoice;
}

interface Appearance {
  readonly showCut: boolean;
  readonly cut: Look;
  readonly below: boolean;
  /** how far below the cut, or null for all of it */
  readonly belowDepth: number | null;
  readonly belowLook: Look;
  readonly dashed: boolean;
  /** the dash's line style, or 0 for the drawing's first dashed line */
  readonly dashStyle: number;
  readonly above: boolean;
  readonly aboveHeight: number | null;
  readonly aboveLook: Look;
  readonly aboveHidden: boolean;
  readonly rcp: boolean;
  readonly smoothing: number;
}

const CONTAINED: Look = { cls: "", fill: "contained", pen: "contained" };
const LINES: Look = { cls: "", fill: "none", pen: "contained" };
const FIRST: Appearance = { showCut: true, cut: CONTAINED, below: true, belowDepth: null, belowLook: LINES, dashed: false, dashStyle: 0, above: false, aboveHeight: null, aboveLook: LINES, aboveHidden: false, rcp: false, smoothing: 20 };
const SAVED = "rodeo.autoHybridDefaults";

/** what the next auto hybrid takes: Save Current Settings as Defaults keeps it for later visits too */
let next: { appearance: Appearance; cut: number | null } | null = null;

function defaults(): { appearance: Appearance; cut: number } {
  if (!next) {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVED) ?? "null") as { appearance: Appearance; cut: number } | null;
      if (saved?.appearance) next = { appearance: { ...FIRST, ...saved.appearance }, cut: Number.isFinite(saved.cut) ? saved.cut : null };
    } catch {
      // storage can't be read: the first settings
    }
  }
  const perUnit = millimetresPerUnit(store.session?.doc.info.units);
  // 4' in inches and feet, else 1200
  const cut = next?.cut ?? (perUnit === 25.4 || perUnit === 304.8 ? 1219.2 : 1200);
  return { appearance: next?.appearance ?? FIRST, cut };
}

const fields = (cut: number, look: Appearance): PluginFieldSpec[] => [
  { name: FIELD.cut, type: DIMENSION, value: cut },
  { name: FIELD.look, type: TEXT, value: JSON.stringify(look) },
];

function recordOf(s: EditSession, id: string): { format: number; cut: number; look: Appearance } {
  const rec = s.doc.records(id).find((r) => r.parametric && r.name === AUTO_HYBRID);
  if (!rec) throw new Error("That isn't an auto hybrid.");
  const value = (field: string): RecordValue | undefined => rec.fields.find((f) => f.name === field)?.value;
  let look = FIRST;
  try {
    look = { ...FIRST, ...(JSON.parse(String(value(FIELD.look) ?? "null")) as Partial<Appearance> | null) };
  } catch {
    // a 2D Appearance that can't be read: the first settings
  }
  return { format: rec.format, cut: Number(value(FIELD.cut)) || 0, look };
}

const FILLS: readonly { value: FillChoice; label: string }[] = [
  { value: "none", label: "None" },
  { value: "contained", label: "Use 2D Attributes of Contained Object(s)" },
  { value: "class", label: "Use Class 2D Attributes" },
];
const PENS: readonly { value: PenChoice; label: string }[] = [
  { value: "contained", label: "Use 2D Attributes of Contained Object(s)" },
  { value: "class", label: "Use Class 2D Attributes" },
];

/** The 2D Appearance dialog over `look` and the cut's elevation; null when cancelled. */
async function askAppearance(title: string, look: Appearance, cut: number): Promise<{ look: Appearance; cut: number } | null> {
  const s = store.session;
  if (!s) return null;
  const classes = [{ value: "", label: "<Contained Object Class(es)>" }, ...s.doc.classes().map((c) => ({ value: c.name, label: c.name }))];
  const dashes = s.doc.lineTypes().filter((t) => t.dashes.length > 0);
  const lookFields = (key: string, l: Look, fill: boolean): PrefField[] => [
    { kind: "choice", key: `${key}Class`, label: "Class", value: classes.some((c) => c.value === l.cls) ? l.cls : "", options: classes, wide: true },
    ...(fill ? [{ kind: "choice", key: `${key}Fill`, label: "Fill", value: l.fill, options: FILLS, wide: true } as PrefField] : []),
    { kind: "choice", key: `${key}Pen`, label: "Pen", value: l.pen, options: PENS, wide: true },
  ];
  const range = (key: string, label: string, reach: number | null): PrefField[] => [
    { kind: "choice", key: `${key}Range`, label: "Range", value: reach === null ? "infinite" : "finite", options: [{ value: "infinite", label: "Infinite" }, { value: "finite", label: `Finite ${label}` }] },
    { kind: "length", key: `${key}Reach`, label, value: reach ?? 1000 },
  ];
  const v = await toolPrefs(
    title,
    [
      { kind: "heading", key: "cutHead", label: "Cut Plane" },
      { kind: "length", key: "cut", label: "Elevation", value: cut, signed: true },
      { kind: "check", key: "showCut", label: "Display Cut Plane", value: look.showCut },
      ...lookFields("cut", look.cut, true),
      { kind: "heading", key: "belowHead", label: "Below Cut Plane" },
      { kind: "check", key: "below", label: "Display Extents Below Cut Plane", value: look.below },
      ...range("below", "Depth", look.belowDepth),
      ...lookFields("below", look.belowLook, false),
      { kind: "check", key: "dashed", label: "Dashed Hidden Line", value: look.dashed },
      ...(dashes.length ? [{ kind: "choice", key: "dashStyle", label: "Dash Style", value: String(dashes.some((t) => t.style === look.dashStyle) ? look.dashStyle : dashes[0].style), options: dashes.map((t) => ({ value: String(t.style), label: t.name })), wide: true } as PrefField] : []),
      { kind: "heading", key: "aboveHead", label: "Above Cut Plane" },
      { kind: "check", key: "above", label: "Display Extents Above Cut Plane", value: look.above },
      ...range("above", "Height", look.aboveHeight),
      ...lookFields("above", look.aboveLook, false),
      { kind: "check", key: "aboveHidden", label: "Include Hidden Lines", value: look.aboveHidden },
      { kind: "heading", key: "allHead", label: "All" },
      { kind: "check", key: "rcp", label: "Show as Reflected Ceiling Plan", value: look.rcp },
      { kind: "number", key: "smoothing", label: "Smoothing Angle", value: look.smoothing, min: 0, max: 90, unit: "°" },
      { kind: "check", key: "save", label: "Save Current Settings as Defaults", value: false },
    ],
    "The cut plane's elevation is above the layer. Faces that meet within the smoothing angle show no edge between them.",
  );
  if (!v) return null;
  const lookOf = (key: string, fill: boolean): Look => ({ cls: v.choice(`${key}Class`), fill: fill ? (v.choice(`${key}Fill`) as FillChoice) : "none", pen: v.choice(`${key}Pen`) as PenChoice });
  const out: Appearance = {
    showCut: v.flag("showCut"),
    cut: lookOf("cut", true),
    below: v.flag("below"),
    belowDepth: v.choice("belowRange") === "finite" ? v.num("belowReach") : null,
    belowLook: lookOf("below", false),
    dashed: v.flag("dashed"),
    dashStyle: dashes.length ? Number(v.choice("dashStyle")) : 0,
    above: v.flag("above"),
    aboveHeight: v.choice("aboveRange") === "finite" ? v.num("aboveReach") : null,
    aboveLook: lookOf("above", false),
    aboveHidden: v.flag("aboveHidden"),
    rcp: v.flag("rcp"),
    smoothing: v.num("smoothing"),
  };
  next = { appearance: out, cut: v.num("cut") };
  if (v.flag("save"))
    try {
      localStorage.setItem(SAVED, JSON.stringify(next));
    } catch {
      // not kept past this visit
    }
  return { look: out, cut: v.num("cut") };
}

const PEN_GROUPS: readonly ByClassGroup[] = ["lineStyle", "penColor", "lineWeight"];

/** A tab's attributes for a part drawn from object `o`: its class, the attributes it's given, and those it takes from the class. */
function lookFor(s: EditSession, o: ObjectInfo, l: Look, fill: boolean): { classIndex: number; attrs: Partial<Attributes>; byClass: ByClassGroup[] } {
  const named = l.cls ? s.doc.classes().find((c) => c.name === l.cls)?.index : undefined;
  const base = o.attrs ?? store.drawAttrs;
  const attrs: Partial<Attributes> = { ...store.drawAttrs };
  const byClass: ByClassGroup[] = [];
  if (l.pen === "class") byClass.push(...PEN_GROUPS);
  else Object.assign(attrs, { lineStyle: base.lineStyle, lineWeight: base.lineWeight, penFore: base.penFore, penBack: base.penBack, penOpacity: base.penOpacity });
  if (!fill || l.fill === "none") attrs.fillPattern = 0;
  else if (l.fill === "class") byClass.push("fill");
  else Object.assign(attrs, { fillPattern: base.fillPattern, fillFore: base.fillFore, fillBack: base.fillBack, fillOpacity: base.fillOpacity });
  return { classIndex: named ?? o.classIndex, attrs, byClass };
}

/** most plan lines one auto hybrid draws, past which it's refused rather than making the drawing slow */
const MOST_PARTS = 20000;

/** The plan of auto hybrid `id` drawn again from its 3D objects, keeping them: the plug-in's first object. `undashed` when hidden lines were asked for and the drawing has no dashed line to draw them in. */
function drawPlan(s: EditSession, id: string): { parts: number; undashed: boolean } {
  const plug = s.doc.object(id);
  if (!plug?.insertion) throw new Error("That isn't an auto hybrid.");
  const { cut, look } = recordOf(s, id);
  // with a plan, Top/Plan (and so the drawing's list of objects) leaves its 3D objects out: the old plan goes first
  s.setPluginDrawing(id, [], 1);
  const all = s.doc.objects(plug.layerId);
  const group = all.find((o) => o.parentId === id && o.kind === "group");
  if (!group) throw new Error("This auto hybrid has lost its 3D objects.");
  const contents = all.filter((o) => o.parentId === group.id);
  const base = s.doc.layers().find((l) => l.id === plug.layerId)?.elevation ?? 0;
  const plans: HybridPlan[] = hybridPlan(
    contents.map((o) => s.faceTriangles(o.id)),
    { cut: base + cut, below: look.below ? (look.belowDepth ?? Infinity) : null, above: look.above ? (look.aboveHeight ?? Infinity) : null, smoothing: look.smoothing, up: look.rcp },
  );
  // the model's plan in the plug-in's own frame: its insertion point at the origin, unturned
  const turn = (-s.pluginAngle(id) * Math.PI) / 180;
  const at = plug.insertion;
  const local = (p: Pt): Pt => {
    const [dx, dy] = [p.x - at.x, p.y - at.y];
    return { x: dx * Math.cos(turn) - dy * Math.sin(turn), y: dx * Math.sin(turn) + dy * Math.cos(turn) };
  };
  const dash = look.dashStyle || s.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;
  const shapes: { shape: NewShape; o: ObjectInfo; l: Look; fill: boolean; over?: Partial<Attributes> }[] = [];
  const line = (points: Pt[]): NewShape => ({ kind: "polygon", points: points.map(local), closed: false });
  contents.forEach((o, i) => {
    const plan = plans[i];
    if (look.showCut) {
      for (const { outer, holes } of nested(plan.rings)) {
        const ring = (r: Pt[]): NewShape => ({ kind: "polygon", points: r.map(local), closed: true });
        if (!holes.length) shapes.push({ shape: ring(outer), o, l: look.cut, fill: true });
        else {
          // filled as one outline round the holes, pen-less so its bridges don't show, with the rings drawn over it
          if (look.cut.fill !== "none") shapes.push({ shape: ring(keyhole(outer, holes)), o, l: look.cut, fill: true, over: { lineStyle: 0 } });
          for (const r of [outer, ...holes]) shapes.push({ shape: ring(r), o, l: look.cut, fill: false });
        }
      }
      for (const run of plan.open) shapes.push({ shape: line(run), o, l: look.cut, fill: false });
    }
    for (const run of plan.below) shapes.push({ shape: line(run), o, l: look.belowLook, fill: false });
    // drawn solid they'd pass for edges in sight
    if (look.dashed && dash !== undefined) for (const run of plan.belowHidden) shapes.push({ shape: line(run), o, l: look.belowLook, fill: false, over: { lineStyle: dash } });
    for (const run of [...plan.above, ...(look.aboveHidden ? plan.aboveHidden : [])]) shapes.push({ shape: line(run), o, l: look.aboveLook, fill: false });
  });
  if (shapes.length > MOST_PARTS) throw new Error(`its plan would take ${shapes.length} lines; turn up the Smoothing Angle or show less above and below`);
  const ids = shapes.map(({ shape, o, l, fill, over }) => {
    const { classIndex, attrs, byClass } = lookFor(s, o, l, fill);
    const added = s.addObject(plug.layerId, shape, classIndex, { ...attrs, ...over });
    const groups = over?.lineStyle === undefined ? byClass : byClass.filter((g) => g !== "lineStyle");
    for (const g of groups) s.setAttributesByClass([added], g, true);
    return added;
  });
  s.setPluginDrawing(id, ids, 1);
  return { parts: ids.length, undashed: look.dashed && dash === undefined };
}

/** The selected objects an auto hybrid can hold: those at the top of the active layer that show something in 3D, walls and their doors and windows aside. */
function selected3D(s: EditSession): ObjectInfo[] {
  const layer = store.activeLayerId;
  if (!layer || store.editGroupId) return [];
  return s.doc.objects(layer).filter((o) => store.selection.has(o.id) && !o.parentId && !isDerivedId(o.id) && o.type !== WALL && s.faceTriangles(o.id).length > 0);
}

export const canCreateAutoHybrid = (): boolean => {
  const s = store.session;
  return !!s && store.selection.size > 0 && !store.editGroupId;
};

/** Makes an auto hybrid of `group` (a group at the top of the layer) with these settings, as part of an undo step; its id. */
function makeHybrid(s: EditSession, layer: string, group: string, cut: number, look: Appearance, classIndex: number): { id: string; undashed: boolean } {
  const specs = fields(cut, look);
  const id = s.addPluginObject(layer, AUTO_HYBRID, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), { x: 0, y: 0 }, 0, classIndex);
  s.setPluginDrawing(id, [group]);
  return { id, undashed: drawPlan(s, id).undashed };
}

const NO_DASH = "This drawing has no dashed line type, so its hidden lines are left out.";

/** AEC > Create Auto Hybrid: the 2D Appearance asked, then the selected 3D objects made an auto hybrid. */
export async function createAutoHybrid(): Promise<void> {
  const s = store.session;
  const layer = store.activeLayerId;
  if (!s || !layer) return;
  if (store.editGroupId) {
    toast("Leave the group first: an auto hybrid is made of objects at the top of a layer.", "info");
    return;
  }
  const picked = selected3D(s);
  if (!picked.length) {
    toast("Select the 3D objects to make an auto hybrid of: extrudes, sweeps, meshes, solids, 3D polygons, 3D symbols or plug-in objects.", "info");
    return;
  }
  const first = defaults();
  const asked = await askAppearance("Create Auto Hybrid", first.appearance, first.cut);
  if (!asked || store.session !== s) return;
  const made = attempt("Create Auto Hybrid", (e) =>
    e.batch(() => {
      return makeHybrid(e, layer, e.groupObjects(picked.map((o) => o.id)), asked.cut, asked.look, store.activeClassIndex);
    }),
  );
  if (!made) return;
  const left = store.selection.size - picked.length;
  const skipped = left > 0 ? ` ${left} selected without 3D faces, or walls, ${left === 1 ? "was" : "were"} left out.` : "";
  setEditGroup(null, [made.value.id]);
  toast(`Made an auto hybrid of ${picked.length} object${picked.length === 1 ? "" : "s"}. Top/Plan shows its plan; 3D views show the objects.${skipped}${made.value.undashed ? ` ${NO_DASH}` : ""}`, "info");
}

export const isAutoHybrid = (id: string): boolean => !!store.session?.doc.records(id).some((r) => r.parametric && r.name === AUTO_HYBRID);

/** The one selected auto hybrid, or null. */
export function selectedAutoHybrid(): string | null {
  if (store.selection.size !== 1) return null;
  const [id] = store.selection;
  return isAutoHybrid(id) ? id : null;
}

/** an auto hybrid opened for editing: its 3D objects' group, and what makes it again on leaving */
let editing: { group: string; layer: string; cut: number; look: Appearance; classIndex: number } | null = null;

/** Modify > Edit Auto Hybrid: its 3D objects opened as a group; leaving the group makes it again. */
export function editAutoHybrid(id = selectedAutoHybrid()): void {
  const s = store.session;
  const plug = id ? s?.doc.object(id) : null;
  if (!s || !id || !plug) return;
  const opened = attempt("Edit Auto Hybrid", (e) =>
    e.batch(() => {
      const { cut, look } = recordOf(e, id);
      const [outer] = e.convertToGroups([id]);
      const parts = e.doc.objects(plug.layerId).filter((o) => o.parentId === outer);
      const group = parts.find((o) => o.kind === "group");
      if (!group) throw new Error("This auto hybrid has lost its 3D objects.");
      const plan = parts.filter((o) => o.id !== group.id).map((o) => o.id);
      if (plan.length) e.deleteObjects(plan);
      e.ungroupObjects([outer]);
      return { group: group.id, layer: plug.layerId, cut, look, classIndex: plug.classIndex };
    }),
  );
  if (!opened) return;
  editing = opened.value;
  setEditGroup(opened.value.group);
  toast("Editing the auto hybrid's 3D objects: Exit Group draws its plan again.", "info");
}

/** Leaving the group an auto hybrid was opened as makes the auto hybrid again. */
function rejoin(): void {
  const was = editing;
  if (!was || store.editGroupId === was.group) return;
  editing = null;
  const s = store.session;
  const group = s?.doc.object(was.group);
  // undone, or deleted, or emptied: nothing to make it of
  if (!s || !group || group.parentId || s.faceTriangles(was.group).length === 0) return;
  const made = attempt("Edit Auto Hybrid", (e) => e.batch(() => makeHybrid(e, was.layer, was.group, was.cut, was.look, was.classIndex)));
  if (made) setEditGroup(null, [made.value.id]);
}
store.on("selection", rejoin);

/** Object Info's 2D Appearance button: the dialog over this one's settings, then its plan drawn again. */
async function appearanceOf(id: string): Promise<void> {
  const s = store.session;
  if (!s) return;
  const { cut, look } = recordOf(s, id);
  const asked = await askAppearance("2D Appearance", look, cut);
  if (!asked || store.session !== s) return;
  edit(id, "2D Appearance", { [FIELD.cut]: asked.cut, [FIELD.look]: JSON.stringify(asked.look) });
}

function edit(id: string, label: string, values: Readonly<Record<string, RecordValue>>): void {
  const done = attempt(label, (s) =>
    s.batch(() => {
      const { format } = recordOf(s, id);
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, format, field, value);
      return drawPlan(s, id);
    }),
  );
  if (done?.value.undashed) toast(NO_DASH, "info");
}

const APPEARANCE = 10;
const WIDGETS: readonly PluginWidget[] = [
  { id: 1, kind: "param", field: FIELD.cut, label: "", level: 0 },
  { id: APPEARANCE, kind: "button", label: "2D Appearance…", level: 0 },
];

const driver: PluginDriver = {
  name: AUTO_HYBRID,
  shape: "point",
  builtIn: true,
  label: (field) => (field === FIELD.cut ? "Cut Plane Elevation" : undefined),
  readOnly: () => false,
  choices: () => undefined,
  place: () => toast("Select 3D objects, then AEC > Create Auto Hybrid.", "info"),
  edit: (id, values) => edit(id, "Edit Auto Hybrid", values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawPlan(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates: () => {},
  press(id, widget) {
    if (widget === APPEARANCE) void appearanceOf(id);
  },
  open: (id) => editAutoHybrid(id),
};
registerPluginDrivers(() => [driver]);
