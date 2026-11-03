// Spotlight's Hanging Position: a plug-in object naming a place where loads hang, holding its geometry (a
// group of what was converted, or an instance of a symbol) and a label. The first object in its drawing is
// always the geometry, the rest are the label. Devices belong to it by their Position field holding its name,
// so renaming it renames theirs, Load Check and the paperwork read it, and Auto Number numbers them. Moving it
// doesn't carry its devices along: Select Lighting Devices picks them to move together. Vectorworks also tilts
// it (Roll and Hanging Angle), attaches other loads, and counts the structure in its Total Hung Weight.

import { attempt, setEditGroup } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { isDerivedId } from "../../../app/scene.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import type { BBox, EditSession, ObjectInfo, PluginFieldSpec, Pt, RecordValue } from "../../../core/index.ts";
import { placeKey } from "../docs/equipmentKey.ts";
import type { Fixture } from "../fixture.ts";
import { fixtures, writeFixtures } from "../instrument.ts";
import { freeName, hungWeight, NUMBER_DIRECTIONS, numberOrder, unitNumbers, within, type NumberDirection } from "./numbering.ts";
import { ATTACH_MM, boxOf, FIELD, HANGING_POSITION, hangingPositions } from "./positions.ts";

const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

/** the label's height on paper, mm */
const LABEL_MM = 3.5;
const EMBEDDED = "";
/** text alignment about its point: centred, on its baseline */
const CENTRE = 2;
const BASELINE = 4;

interface Numbering {
  readonly location: string;
  readonly show: boolean;
  readonly start: number;
  readonly step: number;
  readonly direction: NumberDirection;
}

const DEFAULTS: Numbering = { location: "", show: true, start: 1, step: 1, direction: "Left to Right" };

interface Placed {
  readonly name: string;
  readonly trim: number;
  readonly symbol: string;
  readonly label: Pt;
}

const fields = (p: Placed, n: Numbering): PluginFieldSpec[] => [
  { name: FIELD.name, type: TEXT, value: p.name },
  { name: FIELD.location, type: TEXT, value: n.location },
  { name: FIELD.show, type: BOOL, value: n.show },
  { name: FIELD.trim, type: DIMENSION, value: p.trim },
  { name: FIELD.start, type: NUMBER, value: n.start },
  { name: FIELD.step, type: NUMBER, value: n.step },
  { name: FIELD.direction, type: POPUP, value: n.direction },
  { name: FIELD.symbol, type: POPUP, value: p.symbol },
  { name: FIELD.labelX, type: DIMENSION, value: p.label.x },
  { name: FIELD.labelY, type: DIMENSION, value: p.label.y },
  { name: FIELD.weight, type: TEXT, value: "0 kg" },
];

function recordOf(s: EditSession, id: string): { format: number; value(field: string): RecordValue | undefined } {
  const rec = s.doc.records(id).find((r) => r.parametric && r.name === HANGING_POSITION);
  if (!rec) throw new Error("That isn't a hanging position.");
  return { format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value };
}

const devicesOn = (name: string): readonly Fixture[] => fixtures().filter((f) => f.position.trim() === name);
const layerBase = (s: EditSession, layerId: string): number => s.doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
const layerScale = (s: EditSession, layerId: string): number => s.doc.layers().find((l) => l.id === layerId)?.scale || 1;

/** The lowest point of what `ids` show in 3D, or null when they're only 2D. */
function lowest(s: EditSession, ids: readonly string[]): number | null {
  let low: number | null = null;
  for (const id of ids) {
    const t = s.faceTriangles(id);
    for (let i = 2; i < t.length; i += 3) if (low === null || t[i] < low) low = t[i];
  }
  return low;
}

/** Sets the record's weight and draws the label again, keeping the geometry, or putting `geometry` in its place. */
function drawInto(s: EditSession, id: string, geometry?: string): void {
  const obj = s.doc.object(id);
  if (!obj) throw new Error("That isn't a hanging position.");
  const format = recordOf(s, id).format;
  const name = String(recordOf(s, id).value(FIELD.name) ?? "").trim();
  s.setRecordField(id, format, FIELD.weight, hungWeight(devicesOn(name)));
  const rec = recordOf(s, id);
  const ids = geometry ? [geometry] : [];
  if (rec.value(FIELD.show) !== false && name) {
    const at = { x: Number(rec.value(FIELD.labelX)) || 0, y: Number(rec.value(FIELD.labelY)) || 0 };
    const height = LABEL_MM * layerScale(s, obj.layerId);
    ids.push(s.addObject(obj.layerId, { kind: "text", at, text: name, height, hAlign: CENTRE, vAlign: BASELINE, angle: 0 }, obj.classIndex, { fillPattern: 0 }));
  }
  s.setPluginDrawing(id, ids, geometry ? 0 : 1);
}

/** Draws hanging positions `ids` again, their weights from the devices on them and their labels, in the session's open batch. */
export function redrawPositions(s: EditSession, ids: readonly string[]): void {
  for (const id of ids) drawInto(s, id);
}

/** Where a label goes for geometry at `box` in the object's frame: above its middle. */
function labelFor(s: EditSession, layerId: string, box: BBox | null): Pt {
  const gap = LABEL_MM * layerScale(s, layerId);
  return box ? { x: (box.x0 + box.x1) / 2, y: box.y1 + gap } : { x: 0, y: gap };
}

/** An instance of the symbol in the object's frame, ready to go into its drawing: a plug-in's drawing is lifted by the layer's elevation when shown. */
function instanceIn(s: EditSession, layerId: string, index: number, classIndex: number): string {
  const instance = s.insertSymbol(layerId, index, { x: 0, y: 0 }, classIndex);
  s.moveObjects3D([instance], 0, 0, -layerBase(s, layerId));
  return instance;
}

/** Places a position showing symbol `index` at `at`, turned `angle` degrees, and selects it. */
export function placePosition(layerId: string, at: Pt, angle: number, name: string, index: number): void {
  const r = attempt(HANGING_POSITION, (s) =>
    s.batch(() => {
      const def = s.doc.symbolDefs().find((d) => d.index === index);
      if (!def) throw new Error("That symbol isn't in this drawing any more.");
      const instance = instanceIn(s, layerId, index, store.activeClassIndex);
      const low = lowest(s, [instance]);
      const specs = fields({ name, trim: low === null ? 0 : low + layerBase(s, layerId), symbol: def.name, label: labelFor(s, layerId, def.bbox ?? null) }, DEFAULTS);
      const id = s.addPluginObject(layerId, HANGING_POSITION, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
      drawInto(s, id, instance);
      return id;
    }),
  );
  if (r) setEditGroup(null, [r.value]);
}

/** Lines for geometry that has no 2D of its own, so it shows in Top/Plan: a mesh's rim, or else its box. */
function planLinesFor(s: EditSession, layerId: string, objects: readonly ObjectInfo[]): string[] {
  const all = s.doc.objects(layerId);
  const byId = new Map(all.map((o) => [o.id, o]));
  const topOf = (o: ObjectInfo): ObjectInfo => {
    let at = o;
    while (at.parentId !== null && byId.has(at.parentId)) at = byId.get(at.parentId)!;
    return at;
  };
  const chosen = new Set(objects.map((o) => o.id));
  const parts = all.filter((o) => chosen.has(topOf(o).id));
  const drawn = new Set(parts.filter((o) => o.shape).map((o) => topOf(o).id));
  const made: string[] = [];
  const line = (a: Pt, b: Pt, o: ObjectInfo): void => void made.push(s.addObject(layerId, { kind: "line", a, b }, o.classIndex, { fillPattern: 0 }));
  for (const o of objects) {
    if (drawn.has(o.id)) continue;
    const rims = parts.filter((c) => topOf(c).id === o.id && c.planLines?.length);
    for (const c of rims) for (let i = 0; i + 1 < c.planLines!.length; i += 2) line(c.planLines![i], c.planLines![i + 1], o);
    const box = boxOf(o);
    if (rims.length || !box) continue;
    const corners = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
    corners.forEach((c, i) => line(c, corners[(i + 1) % 4], o));
  }
  return made;
}

/** What a position's Edit Position Geometry leaves, to come back when its geometry is converted again. */
let released: { geometry: string; name: string; numbering: Numbering } | null = null;

/** Turns `objects` into one hanging position, its name given to loose devices in its box and to `attach`; its id. */
function convertSet(layerId: string, objects: readonly ObjectInfo[], name: string, asSymbol: boolean, numbering: Numbering, attach: readonly Fixture[]): string | null {
  const r = attempt("Convert to Hanging Position", (s) =>
    s.batch(() => {
      const boxes = objects.map(boxOf).filter((b): b is BBox => b !== null);
      if (!boxes.length) throw new Error("There's nothing drawn to make a position from.");
      const box = { x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)), x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)) };
      const at = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      const ids = objects.map((o) => o.id);
      const low = lowest(s, ids);
      const parts = [...ids, ...planLinesFor(s, layerId, objects)];
      const taken = new Set(s.doc.symbolDefs().map((d) => d.name));
      const symbol = asSymbol ? freeName(`${name}-Sym`, taken) : EMBEDDED;
      const geometry = asSymbol ? s.createSymbol(parts, symbol, at) : parts.length > 1 ? s.groupObjects(parts) : parts[0];
      s.moveObjects3D([geometry], -at.x, -at.y, -layerBase(s, layerId));
      const label = labelFor(s, layerId, { x0: box.x0 - at.x, y0: box.y0 - at.y, x1: box.x1 - at.x, y1: box.y1 - at.y });
      const specs = fields({ name, trim: low ?? 0, symbol, label }, numbering);
      const id = s.addPluginObject(layerId, HANGING_POSITION, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, objects[0].classIndex);
      const loose = fixtures().filter((f) => !f.position.trim() && within(f.at, box, ATTACH_MM));
      const going = [...new Set([...attach, ...loose])];
      writeFixtures(s, going.map((f) => ({ id: f.id, edit: { position: name, ...(low === null ? {} : { heightMm: low }) } })));
      drawInto(s, id, geometry);
      return id;
    }),
  );
  return r ? r.value : null;
}

const row = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);

/** Asks for a position's name. */
export function askName(initial: string): Promise<string | null> {
  const input = h("input", { cls: "menu-dialog-input", attrs: { "aria-label": FIELD.name } });
  input.value = initial;
  return showDialog<string>({
    title: "Enter Hanging Position Name",
    okLabel: "OK",
    body: [row(FIELD.name, input)],
    check: () => (input.value.trim() ? { value: input.value.trim() } : { error: "A hanging position needs a name.", focus: input }),
  });
}

/** Asks for a name, and whether the geometry becomes a symbol. */
function askConvert(initial: string, canSymbol: boolean): Promise<{ name: string; asSymbol: boolean } | null> {
  const input = h("input", { cls: "menu-dialog-input", attrs: { "aria-label": FIELD.name } });
  input.value = initial;
  const keep = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Geometry" } });
  keep.append(h("option", { text: "Use Geometry", attrs: { value: "geometry" } }));
  if (canSymbol) keep.append(h("option", { text: "Create Symbol", attrs: { value: "symbol" } }));
  return showDialog<{ name: string; asSymbol: boolean }>({
    title: "Convert to Hanging Position",
    okLabel: "OK",
    body: [row(FIELD.name, input), row("Geometry", keep), h("p", { cls: "muted", text: "Use Geometry keeps it inside the position. Create Symbol makes a symbol named with -Sym after the position's name, for the Hanging Position tool to place again." })],
    check: () => (input.value.trim() ? { value: { name: input.value.trim(), asSymbol: keep.value === "symbol" } } : { error: "A hanging position needs a name.", focus: input }),
  });
}

/** Stage > Lighting > Convert to Hanging Position. */
export async function convertToHangingPosition(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return;
  if (store.editGroupId) {
    toast("Leave the group you're editing first: a hanging position goes at the top level of a layer.", "info");
    return;
  }
  const picked = s.doc.objects(layerId).filter((o) => store.selection.has(o.id) && o.parentId === null && !isDerivedId(o.id));
  const devices = new Map(fixtures().map((f) => [f.id, f]));
  const positions = new Set(hangingPositions().map((p) => p.id));
  const geometry = picked.filter((o) => !devices.has(o.id) && !positions.has(o.id));
  if (!geometry.length) {
    toast("Select what to convert first: lighting pipes, trusses or any 2D, 3D or hybrid objects.", "info");
    return;
  }
  const attach = picked.flatMap((o) => devices.get(o.id) ?? []);
  let sets: (readonly ObjectInfo[])[] = [geometry];
  if (geometry.length > 1) {
    const how = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Create" } });
    how.append(h("option", { text: "A single hanging position from all selected objects", attrs: { value: "one" } }), h("option", { text: "A hanging position for each selected object", attrs: { value: "each" } }));
    const v = await showDialog<string>({ title: "Convert to Hanging Position", okLabel: "OK", body: [row("Create", how)], check: () => ({ value: how.value }) });
    if (!v) return;
    if (v === "each") sets = geometry.map((o) => [o]);
  }
  const made: string[] = [];
  for (const set of sets) {
    const back = released && set.length === 1 && set[0].id === released.geometry ? released : null;
    const v = await askConvert(back?.name ?? "", s.canCreateSymbols());
    if (!v || store.session !== s) break;
    const id = convertSet(layerId, set, v.name, v.asSymbol, back?.numbering ?? DEFAULTS, sets.length === 1 ? attach : []);
    if (id) made.push(id);
    if (back) released = null;
  }
  if (made.length) setEditGroup(null, made);
}

/** Numbers the devices on a position by its settings, within a batch; how many. */
function numberDevices(s: EditSession, name: string, start: number, step: number, direction: NumberDirection): number {
  const order = numberOrder(devicesOn(name), direction, appContext()?.view.rotation ?? 0);
  const numbers = unitNumbers(start, step, order.length);
  writeFixtures(s, order.map((f, i) => ({ id: f.id, edit: { unit: numbers[i] } })));
  return order.length;
}

/** Auto Number Positions: the selected positions, or all of them, each by its own settings. */
export function autoNumberPositions(): void {
  const all = hangingPositions();
  const chosen = all.filter((p) => store.selection.has(p.id));
  const going = chosen.length ? chosen : all;
  if (!going.length) {
    toast("There are no hanging positions in this drawing yet.", "info");
    return;
  }
  const r = attempt("Auto Number Positions", (s) => s.batch(() => going.reduce((sum, p) => sum + numberDevices(s, p.name, p.start, p.step, p.direction), 0)));
  if (r) toast(`Numbered ${r.value} lighting device${r.value === 1 ? "" : "s"} on ${going.length} position${going.length === 1 ? "" : "s"}.`, "info");
}

function edit(id: string, label: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt(label, (s) =>
    s.batch(() => {
      const old = recordOf(s, id);
      const [oldName, oldTrim, oldSymbol] = [String(old.value(FIELD.name) ?? "").trim(), Number(old.value(FIELD.trim)) || 0, String(old.value(FIELD.symbol) ?? "")];
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, old.format, field, value);
      const now = recordOf(s, id);
      const name = String(now.value(FIELD.name) ?? "").trim();
      if (!name) throw new Error("A hanging position needs a name.");
      const obj = s.doc.object(id);
      if (!obj) throw new Error("That isn't a hanging position.");
      const trim = Number(now.value(FIELD.trim)) || 0;
      if (name !== oldName || trim !== oldTrim) {
        // what the devices hang at: a position with no height yet gives them its own
        if (trim !== oldTrim) s.moveObjects3D([id], 0, 0, trim - oldTrim);
        writeFixtures(s, devicesOn(oldName).map((f) => ({ id: f.id, edit: { position: name, ...(trim === oldTrim ? {} : { heightMm: oldTrim > 0 ? f.heightMm + trim - oldTrim : trim }) } })));
      }
      const symbol = String(now.value(FIELD.symbol) ?? "");
      if (symbol === oldSymbol) {
        drawInto(s, id);
        return;
      }
      const def = s.doc.symbolDefs().find((d) => d.name === symbol);
      if (!def) throw new Error("A position showing a symbol keeps a symbol: choose another one.");
      drawInto(s, id, instanceIn(s, obj.layerId, def.index, obj.classIndex));
      const low = lowest(s, [id]);
      if (low !== null) s.setRecordField(id, now.format, FIELD.trim, low);
    }),
  );
}

/** Edit Position Geometry: puts an embedded position's geometry back on the layer, selected, to edit and convert again. */
function releaseGeometry(id: string): void {
  const s = store.session;
  if (!s) return;
  const rec = recordOf(s, id);
  const name = String(rec.value(FIELD.name) ?? "");
  if (rec.value(FIELD.symbol)) {
    toast("This position shows a symbol: edit the symbol, and every position showing it follows.", "info");
    return;
  }
  const numbering: Numbering = {
    location: String(rec.value(FIELD.location) ?? ""),
    show: rec.value(FIELD.show) !== false,
    start: Number(rec.value(FIELD.start)) || 0,
    step: Number(rec.value(FIELD.step)),
    direction: NUMBER_DIRECTIONS.find((d) => d === rec.value(FIELD.direction)) ?? DEFAULTS.direction,
  };
  const r = attempt("Edit Position Geometry", (s2) =>
    s2.batch(() => {
      const [group] = s2.convertToGroups([id]);
      const [geometry, ...label] = s2.ungroupObjects([group]);
      if (label.length) s2.deleteObjects(label);
      return geometry;
    }),
  );
  if (!r) return;
  released = { geometry: r.value, name, numbering };
  setEditGroup(null, [r.value]);
  toast(`Edit the geometry, then use Convert to Hanging Position to make "${name}" again. Its devices keep its name.`, "info");
}

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const SUMMARY = 20;
const AUTO = 21;
const GEOMETRY = 22;
const SELECT = 23;
const REFRESH = 24;
const WIDGETS: readonly PluginWidget[] = [
  param(1, FIELD.name),
  param(2, FIELD.location),
  param(3, FIELD.show),
  param(4, FIELD.trim),
  { id: SUMMARY, kind: "button", label: "Insert Position Summary", level: 0 },
  param(5, FIELD.start),
  param(6, FIELD.step),
  param(7, FIELD.direction),
  { id: AUTO, kind: "button", label: "Auto Number", level: 0 },
  param(8, FIELD.symbol),
  { id: GEOMETRY, kind: "button", label: "Edit Position Geometry", level: 0 },
  param(9, FIELD.labelX),
  param(10, FIELD.labelY),
  param(11, FIELD.weight),
  { id: SELECT, kind: "button", label: "Select Lighting Devices", level: 0 },
  { id: REFRESH, kind: "button", label: "Refresh", level: 0 },
];

function press(id: string, widget: number): void {
  const s = store.session;
  const obj = s?.doc.object(id);
  if (!s || !obj) return;
  const rec = recordOf(s, id);
  const name = String(rec.value(FIELD.name) ?? "").trim();
  if (widget === SUMMARY) {
    const box = boxOf(obj);
    const gap = 10 * layerScale(s, obj.layerId);
    placeKey(obj.layerId, box ? { x: box.x1 + gap, y: box.y1 } : obj.insertion ?? { x: 0, y: 0 }, 0, name);
  } else if (widget === AUTO) {
    const direction = NUMBER_DIRECTIONS.find((d) => d === rec.value(FIELD.direction)) ?? DEFAULTS.direction;
    const done = attempt("Auto Number", (s2) => s2.batch(() => numberDevices(s2, name, Number(rec.value(FIELD.start)) || 0, Number(rec.value(FIELD.step)), direction)));
    if (done) toast(done.value ? `Numbered ${done.value} lighting device${done.value === 1 ? "" : "s"}.` : `No lighting devices hang on "${name}" yet.`, "info");
  } else if (widget === GEOMETRY) {
    releaseGeometry(id);
  } else if (widget === SELECT) {
    const ids = devicesOn(name).map((f) => f.id);
    if (ids.length) setEditGroup(null, ids);
    else toast(`No lighting devices hang on "${name}" yet.`, "info");
  } else if (widget === REFRESH) {
    edit(id, "Refresh", {});
  }
}

const driver: PluginDriver = {
  name: HANGING_POSITION,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === FIELD.weight,
  choices(field) {
    if (field === FIELD.direction) return NUMBER_DIRECTIONS.map((value) => ({ value, label: value }));
    if (field !== FIELD.symbol) return undefined;
    const names = (store.session?.doc.symbolDefs() ?? []).map((d) => d.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [{ value: EMBEDDED, label: "Embedded geometry" }, ...names.map((value) => ({ value, label: value }))];
  },
  place: () => appContext()?.controller.setTool("hangingposition"),
  edit: (id, values) => edit(id, "Edit Hanging Position", values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawInto(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates: () => {},
  press,
};
registerPluginDrivers(() => [driver]);
