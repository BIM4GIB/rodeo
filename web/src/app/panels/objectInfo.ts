// The Object Info palette and the Attributes palette. Object Info's Shape tab
// has three states: nothing selected (the active layer and class), one object
// (class, layer, geometry, text, a symbol instance's definition, a viewport's,
// a light's, a wall's or a slab's settings, a linear dimension's points, offset
// and value, a Heliodon's sun and its plug-in parameters; a
// polygon's or polyline's vertices one by one, as Vectorworks' Reshape by
// numbers), several objects (shared class and layer, move by dx/dy). Its Data
// tab lists the records attached to the object, and its Render tab the
// object's texture parts: the texture on each (none, the class's or one of the
// drawing's) and its offset, scale and rotation. Attributes shows the
// selection's pen and fill, its line markers and drop shadow, or, with nothing
// selected, the attributes new objects are drawn with.
import type {
  Affine,
  Attributes,
  BBox,
  ByClassGroup,
  DropShadow,
  EditSession,
  HeliodonSun,
  LayerInfo,
  Light3D,
  LightChange,
  LinearDimensionInfo,
  LineMarker,
  LineMarkers,
  NewShape,
  ObjectInfo,
  ObjectRecord,
  Pt,
  RecordField,
  RecordValue,
  ResourceKind,
  Shape,
  TextStyle,
  TexturePartChange,
  VertexKind,
  Vec3,
  SlabInfo,
  ViewportInfo,
  Visibility,
  VwxDocument,
  WallInfo,
} from "../../core/index.ts";
import { TEXT_STYLE_BY_CLASS } from "../../core/index.ts";
import { isLightingDevice } from "../../core/lightingDevice.ts";
import { attempt, moveObjects, setActiveClass, setSelection } from "../commands.ts";
import { dimensionValue, measureShape } from "../dimension.ts";
import { showTab, tabbed } from "../dock.ts";
import { h } from "../dom.ts";
import { pluginDriver, type PluginDriver, type PluginWidget } from "../ext.ts";
import { bboxOfPoints, clamp } from "../geom.ts";
import { MONTHS, dayOfYear, hourLabel, readHour } from "../heliodon.ts";
import { TAB_ICON } from "../icons.ts";
import { canAimLight, setLightToView, setViewToLight } from "../lightView.ts";
import { openContextMenu } from "../menu.ts";
import { isDerivedId } from "../scene.ts";
import { layerInfo, setViz, store } from "../state.ts";
import { H_ALIGN, MM_PER_PT, V_ALIGN, followClassStyle, followStyle, fontChoices, fontOf, textStyles } from "../textMenu.ts";
import { textureRows } from "../textureMapping.ts";
import { formatArea, formatLength, parseLength } from "../units.ts";
import { markerList, markerText, mils, sameMarker, thicknessList } from "../optionLists.ts";
import { closeColorPicker, colorSwatch } from "./colorPicker.ts";
import { groupByFolder, symbolDefsOf } from "./resources.ts";
import { foldAll, foldingSection } from "./sections.ts";

const MIXED = "— mixed —";
/** select value for "From template"; "" is reserved for MIXED */
const TEMPLATE = "template";
const FROM_TEMPLATE = "From template";
const NO_PEN_STYLE = 0;
const SOLID_STYLE = 2;
const NO_FILL = 0;
const SOLID_FILL = 1;
/** Attributes.lineWeight is in mils (1/1000 inch) */
const MM_PER_MIL = 0.0254;
/** the texture part id of the whole object */
const OVERALL_PART = 3;
/** Resource kinds the Fill style select offers, stored as the negative of their index */
const FILL_KINDS: readonly ResourceKind[] = ["hatch", "tile", "gradient"];

export function mountObjectInfo(root: HTMLElement): void {
  const shape = h("div", { cls: "panel-body" });
  const data = h("div", { cls: "panel-body" });
  const render = h("div", { cls: "panel-body" });
  root.replaceChildren(
    tabbed("oip", [
      { id: "shape", label: "Shape", title: "Shape and parameters", icon: TAB_ICON.shape, body: shape },
      { id: "data", label: "Data", title: "Records", icon: TAB_ICON.data, body: data },
      { id: "render", label: "Render", title: "Textures", icon: TAB_ICON.render, body: render },
    ]),
  );
  const paint = (): void => {
    closeColorPicker();
    const c = content();
    shape.replaceChildren(c.shape);
    data.replaceChildren(c.data);
    render.replaceChildren(c.render);
  };
  store.on(["session", "selection", "class", "layer", "attrs"], paint);
  paint();
}

export function mountAttributes(root: HTMLElement): void {
  const paint = (): void => {
    closeColorPicker();
    root.replaceChildren(attributesContent());
  };
  store.on(["session", "selection", "attrs"], paint);
  paint();
}

function selectedObjects(doc: VwxDocument): ObjectInfo[] {
  const objs: ObjectInfo[] = [];
  for (const id of store.selection) {
    const o = doc.object(id);
    if (o) objs.push(o);
  }
  return objs;
}

function content(): { shape: HTMLElement; data: HTMLElement; render: HTMLElement } {
  const s = store.session;
  if (s !== keptSession) {
    kept.clear();
    keptSession = s;
  }
  if (!s) return { shape: note("No drawing open"), data: note("No drawing open"), render: note("No drawing open") };
  const doc = s.doc;
  const objs = selectedObjects(doc);
  if (objs.length === 0) return { shape: emptyPanel(doc), data: note("Nothing selected"), render: note("Nothing selected") };
  if (objs.length === 1) return singlePanel(doc, objs[0]);
  return { shape: multiPanel(doc, objs), data: note("Select one object"), render: note("Select one object") };
}

function attributesContent(): HTMLElement {
  const s = store.session;
  if (!s) return note("No drawing open");
  const doc = s.doc;
  const objs = selectedObjects(doc);
  if (objs.length === 0) return h("div", { cls: "info" }, newObjectSection(doc));
  const attrs = attributeSection(doc, objs);
  if (!attrs) return h("div", { cls: "info" }, note("No pen or fill"));
  return h("div", { cls: "info" }, attrs, effectsSection(doc, objs));
}

// ---- small builders -------------------------------------------------------

const fmt = (v: number): string => String(Math.round(v * 1e6) / 1e6);

function note(text: string): HTMLElement {
  return h("div", { cls: "note", text });
}

const LOCUS3D = 9;

function section(title: string, ...children: Node[]): HTMLElement {
  return foldingSection("objectInfo", title, ...children);
}

function field(label: string, control: Node): HTMLElement {
  return h("label", { cls: "field" }, h("span", { cls: "field-label", text: label }), control);
}

function grid(...fields: HTMLElement[]): HTMLElement {
  return h("div", { cls: "grid" }, ...fields);
}

/** Spans both grid columns. */
function wide(el: HTMLElement): HTMLElement {
  el.classList.add("wide");
  return el;
}

/** Number input that commits on change (Enter or blur). `null` shows "mixed". */
function numberInput(value: number | null, onChange: (v: number) => void): HTMLInputElement {
  const input = h("input", {
    cls: "num",
    value: value === null ? "" : fmt(value),
    placeholder: value === null ? "mixed" : "",
    attrs: { type: "number", step: "any" },
  });
  input.addEventListener("change", () => {
    const v = input.value.trim() === "" ? NaN : Number(input.value);
    if (!Number.isFinite(v)) {
      input.value = value === null ? "" : fmt(value);
      return;
    }
    onChange(v);
  });
  return input;
}

/**
 * Length input in the document's units: shows the length with its unit (feet and inches with their
 * marks), and takes typed lengths (see parseLength). Commits on change (Enter or blur); text that is
 * not a length is put back.
 */
function lengthInput(mm: number, onChange: (mm: number) => void): HTMLInputElement {
  const units = store.session?.doc.info.units;
  const input = h("input", {
    cls: "num",
    value: formatLength(mm, units),
    attrs: { type: "text", inputmode: "decimal" },
  });
  input.addEventListener("change", () => {
    const v = parseLength(input.value, units);
    if (v === null) {
      input.value = formatLength(mm, units);
      return;
    }
    onChange(v);
  });
  return input;
}

function selectInput(
  options: readonly { value: string; label: string; disabled?: boolean }[],
  current: string,
  onChange: (v: string) => void,
): HTMLSelectElement {
  const sel = h(
    "select",
    { cls: "select" },
    ...options.map((o) => h("option", { text: o.label, disabled: o.disabled, attrs: { value: o.value } })),
  );
  sel.value = current;
  sel.addEventListener("change", () => {
    if (sel.value !== "") onChange(sel.value);
  });
  return sel;
}

/** The value shared by every item, or null when they differ. */
function shared<T>(values: readonly T[]): T | null {
  if (values.length === 0) return null;
  const first = values[0];
  return values.every((v) => v === first) ? first : null;
}

function classOptions(doc: VwxDocument): { value: string; label: string }[] {
  return doc.classes().map((c) => ({ value: String(c.index), label: c.name }));
}

function layerLabel(l: LayerInfo): string {
  return l.kind === "design" ? `${l.name} (1:${l.scale})` : `Sheet ${l.name}`;
}

function classField(doc: VwxDocument, objs: readonly ObjectInfo[]): HTMLElement {
  const ids = objs.map((o) => o.id);
  const current = shared(objs.map((o) => o.classIndex));
  const options = classOptions(doc);
  if (current === null) options.unshift({ value: "", label: MIXED });
  const control = selectInput(options, current === null ? "" : String(current), (v) =>
    attempt("Set class", (s) => s.setObjectClass(ids, Number(v))),
  );
  return field("Class", control);
}

/** The object's own name, unique in the document; emptied, it has none. Symbol contents are read-only. */
function nameField(o: ObjectInfo): HTMLElement {
  const input = committedText(o.name ?? "", (v) => attempt("Name", (s) => s.setObjectName(o.id, v)) !== null);
  input.placeholder = "None";
  input.disabled = isDerivedId(o.id);
  input.setAttribute("aria-label", "Name");
  return field("Name", input);
}

function layerField(doc: VwxDocument, objs: readonly ObjectInfo[]): HTMLElement {
  const ids = objs.map((o) => o.id);
  const current = shared(objs.map((o) => o.layerId));
  // a viewport's annotations are in the sheet's coordinates times its scale: they stay in it
  const open = store.symbolEdit;
  if (open?.viewport && current === open.layer.id) return field("Layer", h("span", { cls: "value", text: `Annotations of ${open.layer.name}` }));
  const options = doc.layers().map((l) => ({ value: l.id, label: layerLabel(l) }));
  if (current === null) options.unshift({ value: "", label: MIXED });
  const control = selectInput(options, current ?? "", (v) =>
    attempt("Move to layer", (s) => s.setObjectLayer(ids, v)),
  );
  return field("Layer", control);
}

/** "Move by dx / dy" row. Values are applied with the Move button. */
function moveRow(ids: string[]): HTMLElement {
  let dx = 0;
  let dy = 0;
  const ix = lengthInput(0, (v) => {
    dx = v;
  });
  const iy = lengthInput(0, (v) => {
    dy = v;
  });
  const btn = h("button", { cls: "btn small", text: "Move", title: "Move by dx, dy" });
  btn.addEventListener("click", () => moveObjects(ids, dx, dy));
  return section("Move", grid(field("dx", ix), field("dy", iy)), h("div", { cls: "row-end" }, btn));
}

// ---- panels ---------------------------------------------------------------

function emptyPanel(doc: VwxDocument): HTMLElement {
  const layer = layerInfo(store.activeLayerId);
  const open = store.symbolEdit;
  const layerText = layer ? (layer === open?.layer ? `${open.viewport ? "Annotations of" : "Symbol"} ${layer.name}` : layerLabel(layer)) : "None";
  return h(
    "div",
    { cls: "info" },
    note("Nothing selected"),
    section(
      "Active",
      field("Layer", h("span", { cls: "value", text: layerText })),
      field(
        "Class",
        selectInput(classOptions(doc), String(store.activeClassIndex), (v) => setActiveClass(Number(v))),
      ),
    ),
  );
}

/** A type name as the palette shows it: "3d-polygon" as "3D polygon". */
const shownType = (typeName: string): string => typeName.replace(/-/g, " ").replace(/\b3d\b/g, "3D");

function singlePanel(doc: VwxDocument, o: ObjectInfo): { shape: HTMLElement; data: HTMLElement; render: HTMLElement } {
  // a plug-in object goes by its plug-in's name (Lighting Device, Door), as Vectorworks shows it
  const plugin = o.typeName === "plug-in-object" ? doc.records(o.id).find((r) => r.parametric)?.name : undefined;
  const head = (): HTMLElement =>
    h(
      "div",
      { cls: "info-head" },
      h("strong", { text: plugin || shownType(o.typeName) || o.kind }),
      // the kind only when the type name says something else
      plugin ? h("span", { cls: "muted", text: "plug-in object" }) : o.typeName && o.typeName !== o.kind ? h("span", { cls: "muted", text: o.kind }) : null,
    );
  const shape = h("div", { cls: "info" }, head(), section("Object", classField(doc, [o]), layerField(doc, [o]), nameField(o)));
  if (o.kind === "symbol") shape.append(symbolSection(doc, o));
  const geo = geometrySection(o);
  if (geo) shape.append(geo);
  const measure = measurementSection(doc, o);
  if (measure) shape.append(measure);
  const dim = store.session?.linearDimension(o.id);
  if (dim) shape.append(dimensionSection(doc, o.id, dim));
  const vp = doc.viewport(o.id);
  if (vp) shape.append(viewportSection(doc, o.id, vp));
  // a light object, or a lighting device's own light
  const light = doc.lights3d().find((l) => l.id === o.id) ?? doc.lights3d().find((l) => l.device && l.objectId === o.id);
  if (light) shape.append(lightSection(o.id, light));
  const wall = doc.wall(o.id);
  if (wall) shape.append(wallSection(doc, o.id, wall));
  const slab = doc.slab(o.id);
  if (slab) shape.append(slabSection(doc, slab));
  const sun = doc.heliodon(o.id);
  if (sun) shape.append(sunSection(o.id, sun));
  // a plug-in's parameters belong on Shape, as in Vectorworks; attached records on Data
  const records = doc.records(o.id);
  const primary = records.find((r) => r.parametric);
  if (primary) shape.append(recordPanel(doc, o.id, primary, true));
  const others = records.filter((r) => r !== primary);
  const data = h("div", { cls: "info" }, head());
  if (others.length) for (const rec of others) data.append(recordPanel(doc, o.id, rec, false));
  else data.append(note("No records"));
  const attach = attachRecordField(doc, o.id, others);
  if (attach) data.append(attach);
  return { shape, data, render: renderPanel(doc, o, head()) };
}

/**
 * A wall, as Vectorworks' Object Info shows it: its style and thickness, its height (its bottom and
 * top above the layer), its length and the ends of its control line. The ends, the length (from
 * the start) and the heights set it, its drawing, its 3D and the doors and windows set in it
 * carried along (EditSession.setWallLine and setWallHeights); what it can't carry it refuses,
 * saying why. The style offers the drawing's walls a new one can copy, one per style and
 * thickness (EditSession.setWallStyle), which gives the wall that style and thickness in its
 * place; the thickness follows the style.
 */
function wallSection(doc: VwxDocument, id: string, w: WallInfo): HTMLElement {
  const units = doc.info.units;
  const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
  const line = (label: string, start: Pt, end: Pt): boolean => tryEdit(label, (s) => s.setWallLine(id, start, end));
  const heights = (bottom: number, top: number): boolean => tryEdit("Wall Height", (s) => s.setWallHeights(id, bottom, top));
  const stretch = (v: number): boolean => {
    const k = v / length;
    return line("Wall Length", w.start, { x: w.start.x + (w.end.x - w.start.x) * k, y: w.start.y + (w.end.y - w.start.y) * k });
  };
  return section(
    "Wall",
    grid(
      field("Style", wallStyleSelect(id, w, units)),
      field("Thickness", readOnly(formatLength(w.thickness, units))),
      field("Height", committedLength(w.top - w.bottom, (v) => heights(w.bottom, w.bottom + v))),
      field("Length", committedLength(length, stretch)),
      field("Bottom", committedLength(w.bottom, (v) => heights(v, v + w.top - w.bottom))),
      field("Top", committedLength(w.top, (v) => heights(w.bottom, v))),
      field("Start X", committedLength(w.start.x, (v) => line("Move Wall End", { x: v, y: w.start.y }, w.end))),
      field("Start Y", committedLength(w.start.y, (v) => line("Move Wall End", { x: w.start.x, y: v }, w.end))),
      field("End X", committedLength(w.end.x, (v) => line("Move Wall End", w.start, { x: v, y: w.end.y }))),
      field("End Y", committedLength(w.end.y, (v) => line("Move Wall End", w.start, { x: w.end.x, y: v }))),
    ),
  );
}

/**
 * The styles a wall can take: one per style and thickness the drawing has a wall to copy in,
 * the wall's own chosen (or shown apart when there is none to copy, as when it holds a door).
 */
function wallStyleSelect(id: string, w: WallInfo, units: string | undefined): HTMLSelectElement {
  const kinds = store.session?.wallTemplates() ?? [];
  const label = (style: string | null, thickness: number): string => `${style ?? "Unstyled"} · ${formatLength(thickness, units)}`;
  const own = kinds.find((k) => k.style === w.style && Math.abs(k.thickness - w.thickness) <= 1e-6);
  const select = h(
    "select",
    { cls: "select", attrs: { "aria-label": "Wall style" } },
    ...(own ? [] : [h("option", { text: label(w.style, w.thickness), disabled: true, attrs: { value: "" } })]),
    ...kinds.map((k) => h("option", { text: label(k.style, k.thickness), attrs: { value: k.id } })),
  );
  select.value = own?.id ?? "";
  select.addEventListener("change", () => {
    if (!select.value || select.value === own?.id) return;
    const r = attempt("Wall Style", (s) => s.setWallStyle(id, select.value));
    if (r) setSelection([r.value]);
    else select.value = own?.id ?? "";
  });
  return select;
}

/** A slab or roof face: its style and thickness, read only. */
function slabSection(doc: VwxDocument, sl: SlabInfo): HTMLElement {
  return section(
    "Slab",
    grid(...(sl.style ? [field("Style", readOnly(sl.style))] : []), field("Thickness", readOnly(formatLength(sl.thickness, doc.info.units)))),
  );
}

/** a dimension whose value reads as its length to within this (mm) shows its measurement */
const MEASURED_MM = 2;

/**
 * A linear dimension: the length it measures, the points it measures, the way its dimension line
 * runs and how far that lies from the first point, and the value it shows. Moving a point or
 * turning it measures again, and the value follows unless it was set to say something else.
 */
function dimensionSection(doc: VwxDocument, id: string, dim: LinearDimensionInfo): HTMLElement {
  const units = doc.info.units;
  // the value says the length (as this drawing writes lengths, to within its rounding), not words of its own
  const shown = parseLength(dim.value, units);
  const measured = shown !== null && Math.abs(shown - dim.length) < MEASURED_MM;
  const set = (label: string, change: Partial<Pick<LinearDimensionInfo, "a" | "b" | "u" | "offset" | "value">>): boolean => {
    const a = change.a ?? dim.a;
    const b = change.b ?? dim.b;
    const u = change.u ?? dim.u;
    const length = Math.abs((b.x - a.x) * u.x + (b.y - a.y) * u.y);
    const value = change.value ?? (measured ? dimensionValue(length, units) : undefined);
    return tryEdit(label, (s) => s.setLinearDimension(id, { ...change, value }));
  };
  const angle = Math.round(((Math.atan2(dim.u.y, dim.u.x) * 180) / Math.PI) * 100) / 100;
  const turn = (deg: number): boolean => {
    const rad = (deg * Math.PI) / 180;
    return set("Turn Dimension", { u: { x: Math.cos(rad), y: Math.sin(rad) } });
  };
  return section(
    "Dimension",
    grid(
      field("Length", readOnly(formatLength(dim.length, units))),
      field("Angle °", committedNumber(angle, turn)),
      field("Start X", committedLength(dim.a.x, (v) => set("Move Dimension Point", { a: { x: v, y: dim.a.y } }))),
      field("Start Y", committedLength(dim.a.y, (v) => set("Move Dimension Point", { a: { x: dim.a.x, y: v } }))),
      field("End X", committedLength(dim.b.x, (v) => set("Move Dimension Point", { b: { x: v, y: dim.b.y } }))),
      field("End Y", committedLength(dim.b.y, (v) => set("Move Dimension Point", { b: { x: dim.b.x, y: v } }))),
      field("Offset", committedLength(dim.offset, (v) => set("Dimension Offset", { offset: v }))),
      field("Value", committedText(dim.value, (v) => set("Dimension Value", { value: v }))),
    ),
  );
}

const MONTH_CHOICES: readonly Choice[] = MONTHS.map((m, i) => ({ value: String(i + 1), label: m }));

/**
 * A Heliodon's sun: the latitude (south negative), the date and the solar time it is set to, and
 * where that puts the sun and when it rises and sets (by the Heliodon's clock: its longitude, time
 * zone and daylight saving). A change works out what the Heliodon shows again and turns its lights;
 * "Light the 3D view" puts the 3D view's sun there.
 */
function sunSection(id: string, sun: HeliodonSun): HTMLElement {
  const set = (change: Partial<Pick<HeliodonSun, "latitude" | "month" | "day" | "hour">>): boolean =>
    tryEdit("Set Sun", (s) => s.setHeliodonSun(id, { latitude: sun.latitude, month: sun.month, day: sun.day, hour: sun.hour, ...change }));
  const round = (deg: number): number => Math.round(deg * 100) / 100;
  const time = committedText(hourLabel(sun.hour), (v) => {
    const hour = readHour(v);
    return hour !== null && set({ hour });
  });
  const view = h("button", { cls: "btn small", text: "Light the 3D view", title: "Put the 3D view's sun where this Heliodon's is" });
  view.addEventListener("click", () =>
    setViz({ sun: "heliodon", latitude: sun.latitude, dayOfYear: dayOfYear(sun.month, sun.day), hour: sun.hour, north: 0 }),
  );
  return section(
    "Sun",
    grid(
      field("Latitude °", committedNumber(round(sun.latitude), (v) => set({ latitude: v }))),
      field("Solar time", time),
      field("Month", committedSelect(MONTH_CHOICES, String(sun.month), (v) => set({ month: Number(v) }))),
      field("Day", committedNumber(sun.day, (v) => set({ day: v }))),
      field("Longitude °", committedNumber(round(sun.longitude), (v) => tryEdit("Set Longitude", (s) => s.setHeliodonPlace(id, { longitude: v })))),
      field("Time zone", readOnly(/GMT\s*[+-]\d{1,2}:\d{2}/.exec(sun.zone)?.[0] ?? (sun.zone || "None"))),
      field("Altitude °", readOnly(String(round(sun.altitude)))),
      field("Azimuth °", readOnly(String(round(sun.azimuth)))),
      field("Sunrise", readOnly(sun.sunrise)),
      field("Sunset", readOnly(sun.sunset)),
    ),
    h(
      "label",
      { cls: "class-style-item" },
      checkBox(sun.daylightSaving, (v) => tryEdit("Set Daylight Saving", (s) => s.setHeliodonPlace(id, { daylightSaving: v }))),
      "Daylight saving",
    ),
    h("div", { cls: "row-end" }, view),
  );
}

const LIGHT_KINDS: readonly Choice[] = [
  { value: "directional", label: "Directional" },
  { value: "point", label: "Point" },
  { value: "spot", label: "Spot" },
];

/**
 * A light object, as Vectorworks' Object Info shows it: whether it is on, its kind, brightness and
 * colour, where it is (on its layer, or in its symbol) and where it shines, and a spot's spread and
 * beam. One a plug-in places is redrawn from the plug-in's parameters.
 */
function lightSection(id: string, l: Light3D): HTMLElement {
  if (l.placedBy === "plugin" && !l.device) return section("Light", note("A plug-in places this light, and redraws it from its parameters."));
  const set = (label: string, change: LightChange): boolean => tryEdit(label, (s) => s.setLight(id, change));
  const degrees = (rad: number): number => Math.round(((rad * 180) / Math.PI) * 10) / 10;
  const radians = (deg: number): number => (deg * Math.PI) / 180;
  const colour = h("input", { cls: "info-colour", value: l.color, attrs: { type: "color", "aria-label": "Light colour" } });
  colour.addEventListener("change", () => {
    if (!set("Light Colour", { color: colour.value })) colour.value = l.color;
  });
  const [x, y, z] = l.own.position;
  const brightness = field("Brightness %", committedNumber(Math.round(l.brightness * 1000) / 10, (v) => set("Light Brightness", { brightness: v / 100 })));
  // a lighting device's light stays a spot at its lens: it is aimed, not moved
  const fields = l.device
    ? [brightness, field("Colour", colour)]
    : [
        field("Kind", committedSelect(LIGHT_KINDS, l.kind, (v) => set("Light Kind", { kind: v as Light3D["kind"] }))),
        brightness,
        field("Colour", colour),
        field("X", committedLength(x, (v) => set("Move Light", { position: [v, y, z] }))),
        field("Y", committedLength(y, (v) => set("Move Light", { position: [x, v, z] }))),
        field("Z", committedLength(z, (v) => set("Move Light", { position: [x, y, v] }))),
      ];
  if (l.kind !== "point") {
    // a spot by where it points: pan clockwise from the drawing's north, tilt down from level. A
    // directional light by where it comes from, as the Heliodon's sun: azimuth, and elevation above the
    // horizon. A lighting device's is in the drawing (its own Pan and Tilt parameters are the fixture's)
    const [dx, dy, dz] = l.device ? l.direction : l.own.direction;
    const spot = l.kind === "spot";
    const bearing = (((Math.atan2(spot ? dx : -dx, spot ? dy : -dy) * 180) / Math.PI + 360) % 360) || 0;
    const fall = (Math.atan2(-dz, Math.hypot(dx, dy)) * 180) / Math.PI;
    const aim = (b: number, f: number): Vec3 => {
      const [sb, cb, sf, cf] = [Math.sin(radians(b)), Math.cos(radians(b)), Math.sin(radians(f)), Math.cos(radians(f))];
      return spot ? [cf * sb, cf * cb, -sf] : [-cf * sb, -cf * cb, -sf];
    };
    const round = (deg: number): number => Math.round(deg * 10) / 10;
    fields.push(
      field(l.device ? "Bearing °" : spot ? "Pan °" : "Azimuth °", committedNumber(round(bearing), (v) => set("Aim Light", { direction: aim(v, fall) }))),
      field(l.device ? "Down °" : spot ? "Tilt °" : "Elevation °", committedNumber(round(fall), (v) => Math.abs(v) <= 90 && set("Aim Light", { direction: aim(bearing, v) }))),
    );
  }
  if (l.kind === "spot") {
    fields.push(
      field(l.device ? "Field °" : "Spread °", committedNumber(degrees(l.spread), (v) => set("Spot Spread", { spread: radians(v) }))),
      field("Beam °", committedNumber(degrees(l.beam), (v) => set("Spot Beam", { beam: radians(v) }))),
    );
  }
  const on = h("label", { cls: "class-style-item" }, checkBox(l.on, (v) => set(v ? "Turn Light On" : "Turn Light Off", { on: v })), "On");
  if (l.kind === "point") return section("Light", on, grid(...fields));
  const about = l.device ? [note("The fixture's light in the 3D view and renders. Bearing is clockwise from the drawing's north; down is below level.")] : [];
  // a directional or spot light aimed the way the view looks, or the view turned the way it shines
  const toView = h("button", { cls: "btn small", text: "Set Light to View", attrs: { type: "button", title: "Aim the light the way the view looks" } });
  toView.addEventListener("click", () => setLightToView(id));
  toView.disabled = !canAimLight(id);
  const toLight = h("button", { cls: "btn small", text: "Set View to Light", attrs: { type: "button", title: "Turn the 3D view to look the way the light shines" } });
  toLight.addEventListener("click", () => void setViewToLight(id));
  return section("Light", on, grid(...fields), h("div", { cls: "row-end" }, toView, toLight), ...about);
}

/**
 * The Render tab: each texture part of the object (the whole object, and by number the further
 * parts walls, slabs, solids and some plug-ins hold) with the texture on it and its offset, scale
 * and rotation. An object without parts yet takes a texture on the whole of it.
 */
function renderPanel(doc: VwxDocument, o: ObjectInfo, head: HTMLElement): HTMLElement {
  const out = h("div", { cls: "info" }, head);
  const parts = doc.objectTextures(o.id);
  if (parts === null) {
    out.append(note("This object takes no texture"));
    return out;
  }
  const textures = doc
    .resources()
    .filter((r) => r.kind === "texture")
    .sort((a, b) => a.name.localeCompare(b.name));
  const ofClass = doc.classes().find((c) => c.index === o.classIndex)?.texture ?? 0;
  const classLabel = ofClass > 0 ? `Class texture (${textures.find((t) => t.index === ofClass)?.name ?? `#${ofClass}`})` : "Class texture (none)";
  const options = (current: number): Choice[] => [
    { value: "-1", label: "None" },
    { value: "0", label: classLabel },
    ...textures.map((t) => ({ value: String(t.index), label: t.name })),
    ...(current > 0 && !textures.some((t) => t.index === current) ? [{ value: String(current), label: `Texture #${current}` }] : []),
  ];
  const set = (part: number, label: string, change: TexturePartChange): boolean => tryEdit(label, (s) => s.setObjectTexture(o.id, part, change));
  if (!parts.length) {
    out.append(section("Overall", grid(wide(field("Texture", committedSelect(options(-1), "-1", (v) => set(OVERALL_PART, "Texture", { texture: Number(v) })))))));
    return out;
  }
  for (const p of parts) {
    const part = section(
      p.part === OVERALL_PART ? "Overall" : `Part ${p.part}`,
      grid(
        wide(field("Texture", committedSelect(options(p.texture), String(p.texture), (v) => set(p.part, "Texture", { texture: Number(v) })))),
        field("Offset U", committedLength(p.offsetU, (v) => set(p.part, "Texture offset", { offsetU: v }))),
        field("Offset V", committedLength(p.offsetV, (v) => set(p.part, "Texture offset", { offsetV: v }))),
        field("Scale U", committedNumber(p.scaleU, (v) => v !== 0 && set(p.part, "Texture scale", { scaleU: v }))),
        field("Scale V", committedNumber(p.scaleV, (v) => v !== 0 && set(p.part, "Texture scale", { scaleV: v }))),
        field("Rotation", committedNumber(p.rotation, (v) => set(p.part, "Texture rotation", { rotation: v }))),
      ),
    );
    // as Vectorworks' texture list: the part's texture commands, then folding every part
    part.querySelector<HTMLElement>(":scope > h3")?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const rows = textureRows(o.id, p.part);
      openContextMenu(
        [...rows, ...(rows.length ? ["-" as const] : []), { label: "Expand All", run: () => foldAll(part, false) }, { label: "Collapse All", run: () => foldAll(part, true) }],
        e.clientX,
        e.clientY,
      );
    });
    out.append(part);
  }
  return out;
}

function multiPanel(doc: VwxDocument, objs: readonly ObjectInfo[]): HTMLElement {
  const counts = new Map<string, number>();
  for (const o of objs) counts.set(o.typeName, (counts.get(o.typeName) ?? 0) + 1);
  const summary = [...counts].map(([name, n]) => `${n} ${shownType(name)}`).join(", ");
  return h(
    "div",
    { cls: "info" },
    h("div", { cls: "info-head" }, h("strong", { text: `${objs.length} objects` }), h("span", { cls: "muted", text: summary })),
    section("Selection", classField(doc, objs), layerField(doc, objs)),
    moveRow(objs.map((o) => o.id)),
  );
}

// ---- symbol ---------------------------------------------------------------

/**
 * A symbol instance: the definition it shows and a select to replace it with
 * another.
 */
function symbolSection(doc: VwxDocument, o: ObjectInfo): HTMLElement {
  const defs = symbolDefsOf(doc);
  const current = o.symbol ?? null;
  const name = defs.find((d) => d.index === current)?.name;
  const options: HTMLElement[] = [h("option", { text: "Choose a symbol…", disabled: true, attrs: { value: "" } })];
  for (const [folder, items] of groupByFolder(defs)) {
    const choices = items.map((d) => h("option", { text: d.name, attrs: { value: String(d.index) } }));
    if (folder === "") options.push(...choices);
    else options.push(h("optgroup", { attrs: { label: folder } }, ...choices));
  }
  const select = h("select", { cls: "select", attrs: { "aria-label": "Replace symbol" } }, ...options);
  select.value = current === null ? "" : String(current);
  select.addEventListener("change", () => {
    const index = Number(select.value);
    if (select.value === "" || index === current) return;
    attempt("Replace symbol", (s) => s.replaceSymbol([o.id], index));
  });
  return section(
    "Symbol",
    field("Definition", h("span", { cls: "value", text: name ?? "Not identified" })),
    field("Replace with", select),
  );
}

// ---- geometry -------------------------------------------------------------

function geometrySection(o: ObjectInfo): HTMLElement | null {
  const shape = o.shape;
  if (!shape) return null;
  const id = o.id;
  const apply = (label: string, next: NewShape): void => {
    attempt(label, (s) => s.setGeometry(id, next));
  };
  switch (shape.kind) {
    case "line":
      return lineSection(shape, apply);
    case "rect":
      return rectSection(id, shape, apply);
    case "arc":
      return arcSection(shape, apply);
    case "polygon":
    case "polyline":
      return vertexSection(id, shape, apply);
    case "text":
      return textSection(o, shape);
    case "image":
      return imageSection(id, shape);
    case "locus":
      return o.type === LOCUS3D ? locus3dSection(o) : locusSection(shape, apply);
    default:
      return null;
  }
}

// ---- vertices -------------------------------------------------------------

/** the vertex Object Info last showed, so it stays shown while the palette is rebuilt after an edit */
let shownVertex: { readonly id: string; readonly index: number } | null = null;

/** The right-click menu's Select Vertex in Object Info Palette: the vertex `index` of `id` shown on the Shape tab. */
export function showVertexInObjectInfo(id: string, index: number): void {
  shownVertex = { id, index };
  showTab("oip", "shape");
  store.emit("selection");
}

const VERTEX_KINDS: readonly { value: VertexKind; label: string }[] = [
  { value: "corner", label: "Corner" },
  { value: "bezier", label: "Bezier" },
  { value: "cubic", label: "Cubic" },
  { value: "arc", label: "Arc" },
  { value: "through", label: "Point on Arc" },
];

interface EditVertex {
  readonly p: Pt;
  readonly kind: VertexKind;
  readonly radius: number;
}

/**
 * A polygon's or polyline's vertices, one at a time (◀ ▶ step through them): its position, a
 * polyline vertex's kind and an arc vertex's radius, adding a vertex after it, deleting it, and
 * whether the outline is closed. A polyline's own vertices are edited, not its drawn curve.
 */
function vertexSection(id: string, shape: Shape, apply: (label: string, next: NewShape) => void): HTMLElement | null {
  const poly = shape.kind === "polyline";
  const verts: EditVertex[] =
    poly && shape.vertices
      ? shape.vertices.map((v) => ({ ...v }))
      : shape.points.map((p) => ({ p, kind: "corner" as const, radius: 0 }));
  const n = verts.length;
  if (n < 2) return null;
  const closed = shape.closed;
  const minimum = closed ? 3 : 2;
  let index = shownVertex?.id === id ? Math.min(shownVertex.index, n - 1) : 0;
  const write = (label: string, next: readonly EditVertex[], nextClosed = closed): void => {
    const points = next.map((v) => v.p);
    apply(
      label,
      poly
        ? { kind: "polyline", points, closed: nextClosed, vertices: next.map((v) => v.kind), radii: next.map((v) => v.radius) }
        : { kind: "polygon", points, closed: nextClosed },
    );
  };
  const replace = (label: string, i: number, v: Partial<EditVertex>): void =>
    write(label, verts.map((w, k) => (k === i ? { ...w, ...v } : w)));

  const body = h("div", { cls: "vertex-body" });
  const render = (): void => {
    shownVertex = { id, index };
    store.editVertex = shownVertex;
    store.emit("view");
    const v = verts[index];
    const step = (by: number, label: string, glyph: string): HTMLButtonElement => {
      const b = h("button", { cls: "btn small vertex-step", text: glyph, attrs: { type: "button", "aria-label": label, title: label } });
      b.addEventListener("click", () => {
        index = (index + by + n) % n;
        render();
      });
      return b;
    };
    const fields: HTMLElement[] = [
      field("x", lengthInput(v.p.x, (x) => replace("Move vertex", index, { p: { x, y: v.p.y } }))),
      field("y", lengthInput(v.p.y, (y) => replace("Move vertex", index, { p: { x: v.p.x, y } }))),
    ];
    if (poly) {
      fields.push(field("Type", selectInput(VERTEX_KINDS, v.kind, (k) => replace("Vertex type", index, { kind: k as VertexKind, radius: 0 }))));
      if (v.kind === "arc") {
        // 0 rounds the corner as much as fits
        fields.push(field("Radius", lengthInput(v.radius, (r) => replace("Vertex radius", index, { radius: Math.max(0, r) }))));
      }
    }
    const add = h("button", { cls: "btn small", text: "Add", attrs: { type: "button", title: "Add a vertex half way to the next" } });
    add.addEventListener("click", () => {
      // half way to the next vertex; after an open outline's last, half way back from it
      const last = !closed && index === n - 1;
      const at = last ? index - 1 : index;
      const a = verts[at].p;
      const b = verts[(at + 1) % n].p;
      const mid: EditVertex = { p: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, kind: "corner", radius: 0 };
      shownVertex = { id, index: at + 1 };
      write("Add vertex", [...verts.slice(0, at + 1), mid, ...verts.slice(at + 1)]);
    });
    const del = h("button", { cls: "btn small", text: "Delete", attrs: { type: "button", title: "Delete this vertex" } });
    del.disabled = n <= minimum;
    del.addEventListener("click", () => {
      shownVertex = { id, index: Math.max(0, index - 1) };
      write("Delete vertex", verts.filter((_, k) => k !== index));
    });
    const closedBox = h("input", { attrs: { type: "checkbox", "aria-label": "Closed" } });
    closedBox.checked = closed;
    closedBox.disabled = !closed && n < 3;
    closedBox.addEventListener("change", () => write(closedBox.checked ? "Close outline" : "Open outline", verts, closedBox.checked));
    body.replaceChildren(
      h(
        "div",
        { cls: "vertex-nav" },
        step(-1, "Previous vertex", "◀"),
        h("span", { cls: "value", text: `Vertex ${index + 1} of ${n}` }),
        step(1, "Next vertex", "▶"),
      ),
      grid(...fields),
      h(
        "div",
        { cls: "vertex-actions" },
        h("label", { cls: "class-style-item" }, closedBox, "Closed"),
        h("span", { cls: "vertex-buttons" }, add, del),
      ),
    );
  };
  render();
  return section("Geometry", body, moveRow([id]));
}

function lineSection(shape: Shape, apply: (label: string, next: NewShape) => void): HTMLElement | null {
  if (shape.points.length < 2) return null;
  const a = shape.points[0];
  const b = shape.points[1];
  return section(
    "Geometry",
    grid(
      field("x1", lengthInput(a.x, (v) => apply("Edit line", { kind: "line", a: { x: v, y: a.y }, b }))),
      field("y1", lengthInput(a.y, (v) => apply("Edit line", { kind: "line", a: { x: a.x, y: v }, b }))),
      field("x2", lengthInput(b.x, (v) => apply("Edit line", { kind: "line", a, b: { x: v, y: b.y } }))),
      field("y2", lengthInput(b.y, (v) => apply("Edit line", { kind: "line", a, b: { x: b.x, y: v } }))),
    ),
  );
}

/** A 3D locus's X, Y and Z, its Z above the layer as a new one's is. */
function locus3dSection(o: ObjectInfo): HTMLElement | null {
  const s = store.session;
  const q = s?.curvePoints(o.id)?.points[0];
  if (!s || !q) return null;
  const base = s.doc.layers().find((l) => l.id === o.layerId)?.elevation ?? 0;
  const move = (dx: number, dy: number, dz: number): boolean => tryEdit("Edit 3D locus", (e) => e.moveObjects3D([o.id], dx, dy, dz));
  return section(
    "Geometry",
    grid(
      field("x", committedLength(q[0], (v) => move(v - q[0], 0, 0))),
      field("y", committedLength(q[1], (v) => move(0, v - q[1], 0))),
      field("z", committedLength(q[2] - base, (v) => move(0, 0, v + base - q[2]))),
    ),
  );
}

function locusSection(shape: Shape, apply: (label: string, next: NewShape) => void): HTMLElement | null {
  const p = shape.points[0];
  if (!p) return null;
  return section(
    "Geometry",
    grid(
      field("x", lengthInput(p.x, (v) => apply("Edit locus", { kind: "locus", at: { x: v, y: p.y } }))),
      field("y", lengthInput(p.y, (v) => apply("Edit locus", { kind: "locus", at: { x: p.x, y: v } }))),
    ),
  );
}

function rectSection(id: string, shape: Shape, apply: (label: string, next: NewShape) => void): HTMLElement | null {
  const bb = shape.bbox ?? bboxOfPoints(shape.points);
  const [p0, p1, , p3] = shape.points;
  if (!bb || !p0 || !p1 || !p3) return null;
  // the frame: corners run counter-clockwise from the rectangle's own origin
  const w = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const hgt = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  const angle = (Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180) / Math.PI;
  const turned = Math.abs(angle) > 1e-9;
  const centre = { x: (bb.x0 + bb.x1) / 2, y: (bb.y0 + bb.y1) / 2 };
  const set = (x0: number, y0: number, x1: number, y1: number): void =>
    apply("Edit rectangle", { kind: "rect", x0, y0, x1, y1 });
  const transform = (label: string, m: Affine): void => {
    attempt(label, (s) => s.transformObjects([id], m));
  };
  // turned rectangles are resized along their own axes, keeping the origin corner
  const stretch = (axis: Pt, k: number): Affine => {
    const t = k - 1;
    const a = 1 + t * axis.x * axis.x;
    const b = t * axis.x * axis.y;
    const d = 1 + t * axis.y * axis.y;
    return { a, b, c: b, d, e: p0.x - (a * p0.x + b * p0.y), f: p0.y - (b * p0.x + d * p0.y) };
  };
  const u = { x: (p1.x - p0.x) / w, y: (p1.y - p0.y) / w };
  const v = { x: (p3.x - p0.x) / hgt, y: (p3.y - p0.y) / hgt };
  const positive = (fn: (v: number) => void) => (v: number) => {
    if (v > 0) fn(v);
  };
  return section(
    "Geometry",
    grid(
      field("x", lengthInput(bb.x0, (x) => moveObjects([id], x - bb.x0, 0))),
      field("y", lengthInput(bb.y0, (y) => moveObjects([id], 0, y - bb.y0))),
      field(
        "width",
        lengthInput(
          w,
          positive((x) => (turned ? transform("Edit rectangle", stretch(u, x / w)) : set(bb.x0, bb.y0, bb.x0 + x, bb.y1))),
        ),
      ),
      field(
        "height",
        lengthInput(
          hgt,
          positive((y) => (turned ? transform("Edit rectangle", stretch(v, y / hgt)) : set(bb.x0, bb.y0, bb.x1, bb.y0 + y))),
        ),
      ),
      field("rotation °", numberInput(angle, (deg) => transform("Rotate rectangle", rotationAbout(centre, deg - angle)))),
    ),
  );
}

/** Counter-clockwise rotation by `deg` about `c`. */
function rotationAbout(c: Pt, deg: number): Affine {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: c.x - cos * c.x + sin * c.y, f: c.y - sin * c.x - cos * c.y };
}

function arcSection(shape: Shape, apply: (label: string, next: NewShape) => void): HTMLElement | null {
  const c = shape.center;
  const r = shape.rx;
  if (!c || r === undefined) return null;
  const ry = shape.ry ?? r;
  const startAngle = shape.startAngle ?? 0;
  const sweepAngle = shape.sweepAngle ?? 360;
  // an ellipse or elliptical arc has an x and a y radius and keeps radiusY on every edit; a circle keeps its one radius
  const elliptic = ry !== r;
  const set = (center: Pt, radius: number, radiusY: number): void => {
    const next: NewShape = elliptic
      ? { kind: "arc", center, radius, radiusY, startAngle, sweepAngle }
      : { kind: "arc", center, radius, startAngle, sweepAngle };
    apply(elliptic ? "Edit ellipse" : "Edit arc", next);
  };
  const radii = elliptic
    ? [
        field(
          "radius x",
          lengthInput(r, (v) => {
            if (v > 0) set(c, v, ry);
          }),
        ),
        field(
          "radius y",
          lengthInput(ry, (v) => {
            if (v > 0) set(c, r, v);
          }),
        ),
      ]
    : [
        field(
          "radius",
          lengthInput(r, (v) => {
            if (v > 0) set(c, v, v);
          }),
        ),
      ];
  return section(
    "Geometry",
    grid(
      field("centre x", lengthInput(c.x, (v) => set({ x: v, y: c.y }, r, ry))),
      field("centre y", lengthInput(c.y, (v) => set({ x: c.x, y: v }, r, ry))),
      ...radii,
    ),
  );
}

/**
 * Measurements of a single object, read-only: length of a line or open chain,
 * area and perimeter of a closed shape, length and radius of an arc. Shown in
 * the document's units.
 */
function measurementSection(doc: VwxDocument, o: ObjectInfo): HTMLElement | null {
  const m = o.shape ? measureShape(o.shape) : null;
  if (!m) return null;
  const units = doc.info.units;
  const row = (label: string, text: string): HTMLElement => field(label, h("span", { cls: "value", text }));
  const rows: HTMLElement[] = [];
  switch (m.kind) {
    case "length":
      rows.push(row("Length", formatLength(m.length, units)));
      break;
    case "closed":
      rows.push(row("Area", formatArea(m.area, units)), row("Perimeter", formatLength(m.perimeter, units)));
      break;
    case "arc":
      rows.push(row("Arc length", formatLength(m.length, units)));
      // an elliptical arc has two radii, so it shows none
      if (m.radius !== null) rows.push(row("Radius", formatLength(m.radius, units)));
      break;
  }
  return section("Measurements", grid(...rows));
}

function textSection(o: ObjectInfo, shape: Shape): HTMLElement {
  const id = o.id;
  const original = shape.text ?? "";
  const content = h("textarea", {
    cls: "text-content",
    value: original,
    attrs: { rows: "3", "aria-label": "Text content" },
  });
  content.addEventListener("change", () => {
    if (content.value !== original) attempt("Edit text", (s) => s.setText(id, content.value));
  });
  content.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) content.blur();
  });
  const style = (label: string, next: TextStyle): void => {
    attempt(label, (s) => s.setTextStyle([id], next));
  };
  const scale = layerInfo(o.layerId)?.scale || 1;
  const size = shape.textSize;
  const at = shape.anchor;
  const angle = Math.round((shape.textAngle ?? 0) * 1e4) / 1e4;
  const font = fontOf(o);
  const { own, common } = fontChoices();
  const fonts = [
    ...(font ? [] : [{ value: "", label: "Unknown font", disabled: true }]),
    ...[...own, ...common].map((f) => ({ value: f, label: f })),
  ];
  const styles = textStyles();
  const byClass = followClassStyle(o);
  const styleOptions = [
    { value: "0", label: "Unstyled" },
    ...(byClass || shape.textStyle === TEXT_STYLE_BY_CLASS ? [{ value: String(TEXT_STYLE_BY_CLASS), label: "Class text style", disabled: !byClass }] : []),
    ...(shape.textStyle && shape.textStyle !== TEXT_STYLE_BY_CLASS && !styles.some((r) => r.index === shape.textStyle)
      ? [{ value: String(shape.textStyle), label: "Unknown style", disabled: true }]
      : []),
    ...styles.map((r) => ({ value: String(r.index), label: r.name })),
  ];
  const flag = (label: string, on: boolean, next: (v: boolean) => TextStyle): HTMLElement =>
    infoRow(label, checkBox(on, (v) => attempt(`${label} text`, (s) => s.setTextStyle([id], next(v))) !== null));
  return section(
    "Text",
    field("Content", content),
    ...(size
      ? [
          ...(styles.length > 0 || shape.textStyle || byClass
            ? [
                wide(
                  field(
                    "Text style",
                    selectInput(styleOptions, String(shape.textStyle ?? 0), (v) =>
                      style("Text style", (Number(v) === TEXT_STYLE_BY_CLASS && byClass) || followStyle(styles.find((r) => r.index === Number(v)) ?? null, o.layerId)),
                    ),
                  ),
                ),
              ]
            : []),
          wide(field("Font", selectInput(fonts, font ?? "", (v) => style("Text font", { font: v })))),
          grid(
            flag("Bold", !!shape.bold, (bold) => ({ bold })),
            flag("Italic", !!shape.italic, (italic) => ({ italic })),
          ),
          flag("Underline", !!shape.underline, (underline) => ({ underline })),
          grid(
            field(
              "size pt",
              numberInput(size / (MM_PER_PT * scale), (v) => {
                if (v > 0) style("Text size", { size: v * MM_PER_PT * scale });
              }),
            ),
            field("rotation °", numberInput(angle, (v) => style("Rotate text", { angle: v }))),
          ),
          grid(
            field("Align", selectInput(H_ALIGN, String(shape.hAlign ?? 1), (v) => style("Justify text", { hAlign: Number(v) }))),
            field("Vertical", selectInput(V_ALIGN, String(shape.vAlign ?? 1), (v) => style("Align text", { vAlign: Number(v) }))),
          ),
        ]
      : []),
    ...(at
      ? [
          grid(
            field("x", lengthInput(at.x, (v) => moveObjects([id], v - at.x, 0))),
            field("y", lengthInput(at.y, (v) => moveObjects([id], 0, v - at.y))),
          ),
        ]
      : []),
  );
}

function imageSection(id: string, shape: Shape): HTMLElement {
  const bb = shape.bbox;
  return section(
    "Image",
    field("Type", h("span", { cls: "value", text: shape.imageMime ?? "unknown" })),
    ...(bb
      ? [
          grid(
            field("x", lengthInput(bb.x0, (v) => moveObjects([id], v - bb.x0, 0))),
            field("y", lengthInput(bb.y1, (v) => moveObjects([id], 0, v - bb.y1))),
          ),
        ]
      : []),
    ...(shape.image || shape.heldImage ? [imageEffectsButton(id)] : []),
  );
}

/** Image Effects…: the dialog for the selected images, this one among them. */
function imageEffectsButton(id: string): HTMLElement {
  const btn = h("button", { cls: "btn small", text: "Image Effects…", attrs: { type: "button", title: "Exposure, contrast, colour, blur and more, worked into the picture" } });
  btn.addEventListener("click", () => void import("../imageEffects.ts").then((m) => m.editImageEffectsDialog(id)));
  return h("div", { cls: "row-end" }, btn);
}

// ---- viewports and records ------------------------------------------------

interface Choice {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A list with more rows than this (not counting internal fields) gets a filter box. */
const FILTER_MIN = 15;
const VISIBILITY: readonly Choice[] = [
  { value: "visible", label: "Visible" },
  { value: "grayed", label: "Grayed" },
  { value: "hidden", label: "Hidden" },
];

/**
 * UI state kept across repaints, per object: which folds are open and what the filter and internal-field
 * boxes hold. Every edit repaints the panel, so without this a fold would close after each change.
 */
interface Kept {
  open?: boolean;
  filter?: string;
  internal?: boolean;
}
const kept = new Map<string, Kept>();
/** The session `kept` belongs to: a different file starts with no saved state. */
let keptSession: EditSession | null = null;

function keptState(key: string): Kept {
  let state = kept.get(key);
  if (!state) {
    state = {};
    kept.set(key, state);
  }
  return state;
}

/** A row of a list: its name (what the filter matches), its element, and whether it is an internal field. */
interface ListRow {
  name: string;
  el: HTMLElement;
  internal: boolean;
}

/** What a record's field controls need: the object and format to edit, and the names a class or layer can take. */
interface RecordCtx {
  doc: VwxDocument;
  id: string;
  format: number;
  classNames: string[];
  layerNames: string[];
  /** the installed plug-in that draws the object, for its parameters' record */
  driver?: PluginDriver;
}

/** Runs an edit through attempt(). False when it failed; attempt() has shown the reason. */
function tryEdit(label: string, fn: (s: EditSession) => void): boolean {
  return attempt(label, fn) !== null;
}

/** A number input that goes back to `value` when `commit` refuses the new one (a bad value, or a failed edit). */
function committedNumber(value: number, commit: (v: number) => boolean): HTMLInputElement {
  const input = numberInput(value, (v) => {
    if (!commit(v)) input.value = fmt(value);
  });
  return input;
}

/** A length input that goes back to `mm` when `commit` refuses the new one. */
function committedLength(mm: number, commit: (mm: number) => boolean): HTMLInputElement {
  const input = lengthInput(mm, (v) => {
    if (!commit(v)) input.value = formatLength(mm, store.session?.doc.info.units);
  });
  return input;
}

/** A text input that commits on change and goes back to `value` when `commit` refuses. */
function committedText(value: string, commit: (v: string) => boolean): HTMLInputElement {
  const input = h("input", { cls: "info-text", value, attrs: { type: "text" } });
  input.addEventListener("change", () => {
    if (input.value !== value && !commit(input.value)) input.value = value;
  });
  return input;
}

/** A select that goes back to `current` when `commit` refuses the new choice. */
function committedSelect(
  options: readonly Choice[],
  current: string,
  commit: (v: string) => boolean,
): HTMLSelectElement {
  const sel = selectInput(options, current, (v) => {
    if (!commit(v)) sel.value = current;
  });
  return sel;
}

/** A select of names. The current value is listed even when it is not one of them. */
function nameSelect(names: readonly string[], current: string, commit: (v: string) => boolean): HTMLSelectElement {
  const all = names.includes(current) ? names : [current, ...names];
  return committedSelect(
    all.map((n) => ({ value: n, label: n })),
    current,
    commit,
  );
}

function visibilitySelect(current: Visibility, commit: (v: Visibility) => boolean): HTMLSelectElement {
  return committedSelect(VISIBILITY, current, (v) => commit(v as Visibility));
}

function checkBox(checked: boolean, commit: (v: boolean) => boolean): HTMLInputElement {
  const box = h("input", { attrs: { type: "checkbox" }, checked });
  box.addEventListener("change", () => {
    if (!commit(box.checked)) box.checked = checked;
  });
  return box;
}

function readOnly(text: string): HTMLElement {
  return h("span", { cls: "value", text });
}

/** A compact row: the name on the left, its control on the right. */
function infoRow(name: string, control: Node): HTMLElement {
  return h("label", { cls: "info-row" }, h("span", { cls: "info-name", text: name, title: name }), control);
}

/** "Layers (4 of 42 visible)", plus how many rows a filter leaves when it hides some. */
function countText(title: string, visible: number, total: number, listed: number): string {
  const filtered = listed === total ? "" : `, ${listed} listed`;
  return `${title} (${visible} of ${total} visible${filtered})`;
}

/**
 * Rows under a filter box and a "Show internal fields" box (when `internal` is set). Typing hides the rows
 * whose names lack the text, and internal rows stay hidden until their box is ticked. Rows are shown and
 * hidden, never rebuilt. `report` gets the number of rows still shown after each change.
 */
function filterableList(
  rows: readonly ListRow[],
  saved: Kept,
  opts: { internal?: boolean; report?: (shown: number) => void } = {},
): Node[] {
  const filter = h("input", {
    cls: "search info-filter",
    value: saved.filter ?? "",
    attrs: { type: "search", placeholder: "Filter by name", "aria-label": "Filter by name" },
  });
  const box = opts.internal ? h("input", { attrs: { type: "checkbox" }, checked: saved.internal === true }) : null;
  const apply = (): void => {
    const q = filter.value.trim().toLowerCase();
    const internal = box?.checked === true;
    let shown = 0;
    for (const r of rows) {
      const on = (internal || !r.internal) && r.name.toLowerCase().includes(q);
      r.el.hidden = !on;
      if (on) shown++;
    }
    saved.filter = filter.value;
    if (box) saved.internal = box.checked;
    opts.report?.(shown);
  };
  filter.addEventListener("input", apply);
  box?.addEventListener("change", apply);
  apply();
  const out: Node[] = [];
  if (rows.filter((r) => !r.internal).length > FILTER_MIN) out.push(filter);
  if (box) out.push(h("label", { cls: "info-check" }, box, h("span", { text: "Show internal fields" })));
  out.push(...rows.map((r) => r.el));
  return out;
}

/**
 * A collapsible block under `summary`, open state kept across repaints. `fill` runs the first time the block
 * is open, so a record's rows are only built once they are shown.
 */
function fold(key: string, summary: HTMLElement, fill: () => Node[]): HTMLElement {
  const saved = keptState(key);
  const body = h("div", { cls: "info-fold-body" });
  let filled = false;
  const fillOnce = (): void => {
    if (filled) return;
    filled = true;
    body.append(...fill());
  };
  const details = h("details", { cls: "info-fold" }, summary, body);
  details.open = saved.open === true;
  details.addEventListener("toggle", () => {
    saved.open = details.open;
    if (details.open) fillOnce();
  });
  if (details.open) fillOnce();
  return details;
}

function visibleCount(entries: readonly { visibility: Visibility }[]): number {
  return entries.filter((e) => e.visibility !== "hidden").length;
}

/**
 * A sheet viewport: its scale, its crop box on the sheet, and how it shows each design layer and class.
 * Edits go through the viewport setters; a value the core refuses goes back to what it was.
 */
function viewportSection(doc: VwxDocument, id: string, vp: ViewportInfo): HTMLElement {
  const box = vp.box;
  const edge = (label: string, mm: number, next: (v: number) => BBox): HTMLElement =>
    field(label, committedLength(mm, (v) => tryEdit("Set viewport box", (s) => s.setViewportBox(id, next(v)))));
  const scale = committedNumber(vp.scale, (v) => tryEdit("Set viewport scale", (s) => s.setViewportScale(id, v)));

  const layerRows: ListRow[] = vp.layers.map((l) => ({
    name: l.name,
    el: infoRow(
      l.name,
      visibilitySelect(l.visibility, (v) => tryEdit("Set layer visibility", (s) => s.setViewportLayer(id, l.id, v))),
    ),
    internal: false,
  }));
  const layerSummary = h("summary");
  const layerNodes = filterableList(layerRows, keptState(`${id}/layers`), {
    report: (shown) => {
      layerSummary.textContent = countText("Layers", visibleCount(vp.layers), layerRows.length, shown);
    },
  });

  // a viewport lists only the classes it overrides; the rest of the document's classes can be added
  const names = new Map(doc.classes().map((c): [number, string] => [c.index, c.name]));
  const classRows: ListRow[] = vp.classes.map((c) => {
    const name = names.get(c.index) ?? `Class #${c.index}`;
    return {
      name,
      el: infoRow(
        name,
        visibilitySelect(c.visibility, (v) => tryEdit("Set class visibility", (s) => s.setViewportClass(id, c.index, v))),
      ),
      internal: false,
    };
  });
  const classSummary = h("summary");
  const classNodes = filterableList(classRows, keptState(`${id}/classes`), {
    report: (shown) => {
      classSummary.textContent = countText("Classes", visibleCount(vp.classes), classRows.length, shown);
    },
  });
  const listed = new Set(vp.classes.map((c) => c.index));
  const unlisted = classOptions(doc).filter((o) => !listed.has(Number(o.value)));
  const add: Node[] =
    unlisted.length === 0
      ? []
      : [
          field(
            "Add override",
            committedSelect(
              [{ value: "", label: "Choose a class…", disabled: true }, ...unlisted],
              "",
              (v) => tryEdit("Add class override", (s) => s.setViewportClass(id, Number(v), "visible")),
            ),
          ),
        ];

  return section(
    "Viewport",
    ...(vp.plan
      ? []
      : [
          note(
            "The drawing is the copy saved in the file, so layer and class changes show once Vectorworks updates the viewport.",
          ),
        ]),
    field("Scale", h("span", { cls: "scale-field" }, h("span", { text: "1:" }), scale)),
    grid(
      edge("Left", box.x0, (v) => ({ ...box, x0: v })),
      edge("Bottom", box.y0, (v) => ({ ...box, y0: v })),
      edge("Right", box.x1, (v) => ({ ...box, x1: v })),
      edge("Top", box.y1, (v) => ({ ...box, y1: v })),
    ),
    fold(`${id}/layers`, layerSummary, () => layerNodes),
    fold(`${id}/classes`, classSummary, () => [...classNodes, ...add]),
  );
}

/**
 * A record of an object (a plug-in's parameters, or an attached record) as a section. The first parametric
 * record stays open; the others fold away under their title.
 */
function recordPanel(doc: VwxDocument, id: string, rec: ObjectRecord, primary: boolean): HTMLElement {
  const key = `${id}/${rec.format}`;
  const title = rec.parametric ? `Parameters: ${rec.name}` : `Record: ${rec.name}`;
  const body = (): Node[] => recordBody(doc, id, rec, keptState(key));
  if (primary) return section(title, ...body());
  return h("section", { cls: "info-section" }, fold(key, h("summary", { text: title }), body));
}

/** Data > Attach: a choice of the document's data record formats the object has no record of yet; null when there are none. */
function attachRecordField(doc: VwxDocument, id: string, attached: readonly ObjectRecord[]): HTMLElement | null {
  const formats = doc.recordFormats().filter((f) => !attached.some((r) => r.format === f.format));
  if (!formats.length) return null;
  const select = h(
    "select",
    { cls: "select", attrs: { "aria-label": "Attach a record" } },
    h("option", { text: "Attach a record…", disabled: true, attrs: { value: "", selected: "" } }),
    ...formats.map((f) => h("option", { text: f.name, attrs: { value: String(f.format) } })),
  );
  select.addEventListener("change", () => {
    const format = Number(select.value);
    select.value = "";
    attempt("Attach Record", (s) => s.attachRecord([id], format));
  });
  return section("Attach", select);
}

/**
 * A record's contents. An installed plug-in's parameters are drawn again when its own layout is known
 * (its script sets it up the first time one is shown).
 */
function recordBody(doc: VwxDocument, id: string, rec: ObjectRecord, saved: Kept): Node[] {
  const driver = rec.parametric ? pluginDriver(rec.name) : undefined;
  if (!driver && rec.parametric && isLightingDevice(rec.name)) return deviceRows(doc, id, rec, saved);
  if (!driver) return recordRows(doc, id, rec, saved);
  const wrap = h("div");
  const fill = (): Node[] =>
    recordRows(doc, id, rec, saved, driver, () => {
      if (wrap.isConnected) wrap.replaceChildren(...fill());
    });
  wrap.append(...fill());
  return [wrap];
}

/**
 * A note for plug-in parameters, then the filter, the internal box and one row per field, or the rows of
 * the plug-in's own layout. `relayout` runs once that layout is known.
 */
function recordRows(doc: VwxDocument, id: string, rec: ObjectRecord, saved: Kept, driver?: PluginDriver, relayout: () => void = () => {}): Node[] {
  const ctx: RecordCtx = {
    doc,
    id,
    format: rec.format,
    classNames: doc.classes().map((c) => c.name),
    layerNames: doc.layers().filter((l) => l.kind === "design").map((l) => l.name),
    driver,
  };
  const layout = driver?.layout(relayout, rec);
  const rows = layout ? layoutRows(ctx, rec, layout) : rec.fields.map((f) => fieldRow(ctx, f));
  const out: Node[] = [];
  if (rec.parametric) {
    out.push(
      note(
        ctx.driver?.note ??
          (ctx.driver?.builtIn
          ? "Drawn by Rodeo: a change draws it again"
          : ctx.driver
            ? "Drawn by the installed plug-in: a change draws it again"
            : "Shown as saved; Vectorworks rebuilds it on reset"),
      ),
    );
  }
  out.push(...filterableList(rows, saved, { internal: rows.some((r) => r.internal) }));
  if (!rec.parametric) {
    const detach = h("button", { cls: "btn small", text: "Detach", title: `Take the ${rec.name} record off this object`, attrs: { type: "button" } });
    detach.addEventListener("click", () => attempt("Detach Record", (s) => s.detachRecord([id], rec.format)));
    out.push(h("div", { cls: "row-end" }, detach));
  }
  return out;
}

/**
 * A Spotlight lighting device's parameters as a lighting designer reads them, a group at a time; its light
 * (on, brightness, colour, field and beam) is the Light section's. Every one of its parameters (some 150)
 * is still there, folded away under All Parameters.
 */
const DEVICE_GROUPS: readonly { readonly title: string; readonly fields: readonly string[] }[] = [
  { title: "Instrument", fields: ["Inst Type", "Device Type", "Fixture Mode", "Position", "Unit Number", "Purpose", "Channel", "Color", "Template", "Template2", "Focus"] },
  { title: "Patch", fields: ["Universe", "DMX Address", "Num Channels", "Dimmer", "Circuit Number", "Circuit Name", "Breaker ID"] },
  { title: "Load", fields: ["Wattage", "Voltage", "Weight"] },
  { title: "Aim and Beam", fields: ["Pan", "Tilt", "Lit Fog", "Draw Beam", "Show Beam at", "Draw Beam as Solid", "Throw Distance"] },
];

/** what Spotlight's Object Info calls the parameters whose names say less */
const DEVICE_LABELS: Readonly<Record<string, string>> = { "inst type": "Instrument Type", color: "Colour (gel)", template: "Gobo 1", template2: "Gobo 2", "num channels": "Channels" };

function deviceRows(doc: VwxDocument, id: string, rec: ObjectRecord, saved: Kept): Node[] {
  const ctx: RecordCtx = { doc, id, format: rec.format, classNames: doc.classes().map((c) => c.name), layerNames: doc.layers().filter((l) => l.kind === "design").map((l) => l.name) };
  const byName = new Map(rec.fields.map((f): [string, RecordField] => [f.name.toLowerCase(), f]));
  const out: Node[] = [note("A Spotlight lighting device: its light shows in the 3D view and renders, and these parameters change it. Its drawing stays as Vectorworks saved it.")];
  for (const group of DEVICE_GROUPS) {
    const rows = group.fields.flatMap((name) => {
      const f = byName.get(name.toLowerCase());
      return f ? [fieldRow(ctx, f, DEVICE_LABELS[name.toLowerCase()]).el] : [];
    });
    if (rows.length) out.push(h("div", { cls: "info-divider", text: group.title }), ...rows);
  }
  const all = (): Node[] => filterableList(rec.fields.map((f) => fieldRow(ctx, f)), saved, { internal: rec.fields.some((f) => f.name.startsWith("__")) });
  out.push(fold(`${id}/${rec.format}/all`, h("summary", { text: `All Parameters (${rec.fields.length})` }), all));
  return out;
}

/**
 * A plug-in's own layout of its parameters: its widgets in its order and indents, then its internal fields.
 * Parameters it leaves out aren't shown, as in Vectorworks. The widgets it greys or hides follow what its
 * script says for the object's values.
 */
function layoutRows(ctx: RecordCtx, rec: ObjectRecord, layout: readonly PluginWidget[]): ListRow[] {
  const byName = new Map(rec.fields.map((f): [string, RecordField] => [f.name.toLowerCase(), f]));
  const rows: ListRow[] = [];
  const els = new Map<number, HTMLElement[]>();
  for (const w of layout) {
    const row = widgetRow(ctx, w, byName);
    if (!row) continue;
    if (w.level > 0) row.el.style.setProperty("--indent", String(w.level));
    rows.push(row);
    els.set(w.id, [...(els.get(w.id) ?? []), row.el]);
  }
  const listed = new Set(layout.map((w) => w.field?.toLowerCase()));
  for (const f of rec.fields) if (f.name.startsWith("__") && !listed.has(f.name.toLowerCase())) rows.push(fieldRow(ctx, f));
  ctx.driver?.widgetStates(ctx.id, (states) => {
    for (const [id, list] of els) {
      const st = states.get(id);
      for (const el of list) {
        el.classList.toggle("info-off", st?.visible === false);
        el.classList.toggle("info-greyed", st?.enabled === false);
        for (const c of el.querySelectorAll<HTMLInputElement>("input, select, button")) c.disabled = st?.enabled === false;
      }
    }
  });
  return rows;
}

/** A widget of a plug-in's layout as a row; null for a parameter the object hasn't, or an empty line of text. */
function widgetRow(ctx: RecordCtx, w: PluginWidget, byName: ReadonlyMap<string, RecordField>): ListRow | null {
  switch (w.kind) {
    case "param": {
      const f = w.field === undefined ? undefined : byName.get(w.field.toLowerCase());
      return f ? fieldRow(ctx, f, w.label || undefined) : null;
    }
    case "button": {
      const button = h("button", { cls: "btn small", text: w.label || "Button", attrs: { type: "button" } });
      button.addEventListener("click", () => ctx.driver?.press(ctx.id, w.id));
      return { name: w.label, el: h("div", { cls: "info-widget" }, button), internal: false };
    }
    case "divider":
      return { name: w.label, el: h("div", { cls: "info-divider", text: w.label }), internal: false };
    case "text":
      return w.label ? { name: w.label, el: h("div", { cls: "info-widget muted", text: w.label }), internal: false } : null;
  }
}

/** One record field as a row, under `label` or its display name when its plug-in is installed. Fields named "__..." are internal. */
function fieldRow(ctx: RecordCtx, f: RecordField, label = ctx.driver?.label(f.name) ?? f.name): ListRow {
  return {
    name: label,
    el: infoRow(f.kind === "angle" ? `${label} °` : label, fieldControl(ctx, f)),
    internal: f.name.startsWith("__"),
  };
}

/** The control for a field, by its kind. Every edit goes through setRecordField, or to the installed plug-in that draws the object. */
function fieldControl(ctx: RecordCtx, f: RecordField): HTMLElement {
  const { doc, id, format, driver } = ctx;
  const edit = (value: RecordValue): boolean => {
    if (!driver) return tryEdit(`Set ${f.name}`, (s) => s.setRecordField(id, format, f.name, value));
    driver.edit(id, { [f.name]: value });
    return true;
  };
  // a length worked out is shown in the drawing's units
  if (driver?.readOnly(f.name)) return readOnly(f.kind === "dimension" && Number.isFinite(Number(f.value)) ? formatLength(Number(f.value), doc.info.units) : String(f.value));
  const choices = driver?.choices(f.name);
  if (choices?.length) {
    const current = String(f.value);
    const all = choices.some((c) => c.value === current) ? choices : [{ value: current, label: current }, ...choices];
    return committedSelect(all, current, edit);
  }
  const n = Number(f.value);
  switch (f.kind) {
    case "boolean":
      return checkBox(f.value === true, edit);
    case "dimension":
      return committedLength(n, edit);
    case "number":
    case "angle":
      return committedNumber(n, edit);
    case "integer":
    case "color":
      // whole numbers only; anything else goes back to the old value
      return committedNumber(n, (v) => Number.isInteger(v) && edit(v));
    case "area":
      return readOnly(formatArea(n, doc.info.units));
    case "volume":
      return readOnly(fmt(n));
    case "text":
    case "choice":
      return committedText(String(f.value), edit);
    case "class":
      return nameSelect(ctx.classNames, String(f.value), edit);
    case "layer":
      return nameSelect(ctx.layerNames, String(f.value), edit);
    case "other":
      return readOnly("—");
  }
}

// ---- attributes -----------------------------------------------------------

type AttrKey ="lineStyle" | "lineWeight" | "penFore" | "penOpacity" | "fillPattern" | "fillBack" | "fillOpacity";
type AttrPatch = Partial<Record<AttrKey, number | undefined>>;

const ATTR_KEYS: readonly AttrKey[] = [
  "lineStyle",
  "lineWeight",
  "penFore",
  "penOpacity",
  "fillPattern",
  "fillBack",
  "fillOpacity",
];

/**
 * Where the attribute controls read and write: the selected objects, or the
 * attributes new objects are drawn with (store.drawAttrs).
 */
interface AttrTarget {
  /** true for the new-object defaults, where a field can go back to "From template" */
  readonly canClear: boolean;
  /**
   * The value across the targets: a number, null when they differ, undefined
   * when unset. `norm` maps each raw value first (e.g. every positive line style is Solid).
   */
  get(key: AttrKey, norm?: (v: number) => number): number | null | undefined;
  /** Applies a change. An undefined value clears the attribute (defaults only). */
  set(label: string, patch: AttrPatch): void;
  /** The selection only: whether a group comes from the class (null when it differs), and switching it. */
  readonly byClass?: {
    get(group: ByClassGroup): boolean | null;
    set(group: ByClassGroup, on: boolean): void;
  };
}

function attributeSection(doc: VwxDocument, objs: readonly ObjectInfo[]): HTMLElement | null {
  const ids: string[] = [];
  const attrs: Attributes[] = [];
  const byClass: (readonly ByClassGroup[])[] = [];
  for (const o of objs) {
    if (o.attrs) {
      ids.push(o.id);
      attrs.push(o.attrs);
      byClass.push(o.byClass ?? []);
    }
  }
  if (attrs.length === 0) return null;
  return foldingSection("attributes", "Selection", attributeControls(doc, selectionTarget(ids, attrs, byClass)));
}

/** Attributes for new objects. Fields left at "From template" copy the template object. */
function newObjectSection(doc: VwxDocument): HTMLElement {
  const reset = h("button", {
    cls: "btn small",
    text: "Reset",
    title: "Clear the attributes for new objects",
    disabled: Object.keys(store.drawAttrs).length === 0 && Object.keys(store.drawEffects).length === 0,
  });
  reset.addEventListener("click", () => {
    store.drawAttrs = {};
    store.drawEffects = {};
    store.emit("attrs");
  });
  return foldingSection(
    "attributes",
    "New objects",
    h("p", { cls: "muted attr-hint", text: "From template copies the template object" }),
    attributeControls(doc, defaultsTarget()),
    newEffectsControls(doc),
    h("div", { cls: "row-end" }, reset),
  );
}

function selectionTarget(ids: string[], attrs: readonly Attributes[], byClass: readonly (readonly ByClassGroup[])[]): AttrTarget {
  return {
    canClear: false,
    byClass: {
      get: (group) => shared(byClass.map((groups) => groups.includes(group))),
      set: (group, on) => attempt(on ? "Use class style" : "Stop using class style", (s) => s.setAttributesByClass(ids, group, on)),
    },
    get: (key, norm) => shared(attrs.map((a) => (norm ? norm(a[key]) : a[key]))),
    set: (label, patch) => {
      const clean: Partial<Attributes> = {};
      for (const key of ATTR_KEYS) {
        const v = patch[key];
        if (v !== undefined) clean[key] = v;
      }
      if (Object.keys(clean).length > 0) attempt(label, (s) => s.setAttributes(ids, clean));
    },
  };
}

function defaultsTarget(): AttrTarget {
  return {
    canClear: true,
    get: (key, norm) => {
      const v = store.drawAttrs[key];
      return v === undefined ? undefined : norm ? norm(v) : v;
    },
    set: (_label, patch) => {
      const next: Partial<Attributes> = { ...store.drawAttrs };
      for (const key of ATTR_KEYS) {
        if (!(key in patch)) continue;
        const v = patch[key];
        if (v === undefined) delete next[key];
        else next[key] = v;
      }
      store.drawAttrs = next;
      store.emit("attrs");
    },
  };
}

/** The controls shared by the selection and the new-object defaults. */
function attributeControls(doc: VwxDocument, t: AttrTarget): HTMLElement {
  const fields = [
    weightField(t),
    lineStyleField(doc, t),
    wide(colorField(doc, t, "penFore", "Pen colour")),
    wide(opacityField(t, "penOpacity", "Pen opacity")),
    fillStyleField(doc, t),
    colorField(doc, t, "fillBack", "Fill colour"),
    wide(opacityField(t, "fillOpacity", "Fill opacity")),
  ];
  if (t.byClass) fields.push(wide(classStyleField(t.byClass)));
  return grid(...fields);
}

/**
 * The attribute controls over a class's attributes, as Tools > Organization… edits them: `values`
 * changes in place as the controls do.
 */
export function classAttributeControls(doc: VwxDocument, values: Attributes): HTMLElement {
  const host = h("div", { cls: "class-attrs" });
  const target: AttrTarget = {
    canClear: false,
    get: (key, norm) => (norm ? norm(values[key]) : values[key]),
    set: (_label, patch) => {
      for (const key of ATTR_KEYS) {
        const v = patch[key];
        if (v !== undefined) values[key] = v;
      }
      host.replaceChildren(attributeControls(doc, target));
    },
  };
  host.append(attributeControls(doc, target));
  return host;
}

const CLASS_STYLE_GROUPS: readonly { group: ByClassGroup; label: string }[] = [
  { group: "lineWeight", label: "Weight" },
  { group: "lineStyle", label: "Line style" },
  { group: "penColor", label: "Pen colour" },
  { group: "fill", label: "Fill" },
  { group: "opacity", label: "Opacity" },
];

/**
 * Vectorworks' Class Style: the attributes the objects take from their class. Ticking one shows
 * the class's value above; unticking keeps that value as the objects' own.
 */
function classStyleField(b: NonNullable<AttrTarget["byClass"]>): HTMLElement {
  const items = CLASS_STYLE_GROUPS.map(({ group, label }) => {
    const v = b.get(group);
    const box = h("input", { attrs: { type: "checkbox" }, checked: v === true });
    box.indeterminate = v === null;
    box.addEventListener("change", () => b.set(group, box.checked));
    return h("label", { cls: "class-style-item" }, box, h("span", { text: label }));
  });
  return h("div", { cls: "field" }, h("span", { cls: "field-label", text: "From class" }), h("div", { cls: "class-style" }, ...items));
}

// ---- line markers and drop shadow ----------------------------------------

/** the types that carry line markers: lines, polygons, arcs and polylines */
const MARKED_TYPES: ReadonlySet<number> = new Set([2, 5, 6, 21]);
const MM_PER_INCH = 25.4;
const NO_MARKER = "none";
/** a marker the marker list doesn't have: its value in the menu starts so */
const OTHER_MARKER = "other:";

/** A shadow switched on where there was none: black at 75 %, falling below right. */
function newShadow(doc: VwxDocument): DropShadow {
  const black = doc.colors().find((c) => c.css === "#000000")?.index ?? 0;
  return { blur: 0.05, offset: 0.05, angle: 315, color: black, opacity: 75 };
}

/** The selection's line markers (lines, arcs, polygons and polylines) and drop shadow. */
function effectsSection(doc: VwxDocument, objs: readonly ObjectInfo[]): HTMLElement {
  const drawn = objs.filter((o) => o.attrs);
  const marked = drawn.filter((o) => MARKED_TYPES.has(o.type));
  const fields: HTMLElement[] = [];
  if (marked.length > 0) fields.push(...markerFields(selectionMarkers(marked)));
  fields.push(...shadowFields(doc, drawn));
  return section(marked.length > 0 ? "Markers and shadow" : "Shadow", grid(...fields));
}

/** Markers and drop shadow for new objects: markers go on lines, polygons, polylines and arcs. */
function newEffectsControls(doc: VwxDocument): HTMLElement {
  const fx = store.drawEffects;
  const change = (next: typeof fx): void => {
    store.drawEffects = next;
    store.emit("attrs");
  };
  const box = h("input", { attrs: { type: "checkbox", "aria-label": "Drop shadow for new objects" }, checked: fx.shadow !== undefined });
  box.addEventListener("change", () => {
    const { shadow: _old, ...rest } = fx;
    change(box.checked ? { ...rest, shadow: newShadow(doc) } : rest);
  });
  const shadow = wide(
    h("div", { cls: "field" }, h("span", { cls: "field-label", text: "Drop shadow" }), h("label", { cls: "class-style-item" }, box, h("span", { text: "Casts a shadow" }))),
  );
  const markers: MarkerTarget = {
    markers: [fx],
    setMarker: (end, marker) => {
      const { [end]: _old, ...rest } = fx;
      change(marker ? { ...rest, [end]: marker } : rest);
    },
    update: (_label, fn) => change({ ...fx, ...(fx.start ? { start: fn(fx.start) } : {}), ...(fx.end ? { end: fn(fx.end) } : {}) }),
  };
  return grid(...markerFields(markers), shadow);
}

/**
 * Where the marker controls read and write: the selected objects' markers, or the markers new
 * objects are drawn with (store.drawEffects).
 */
interface MarkerTarget {
  /** each target's markers */
  readonly markers: readonly (LineMarkers | undefined)[];
  /** Gives one end `marker` (none for null), where it doesn't have that marker already. */
  setMarker(end: "start" | "end", marker: LineMarker | null, label: string): void;
  /** Changes every marker shown. */
  update(label: string, fn: (m: LineMarker) => LineMarker): void;
}

function selectionMarkers(objs: readonly ObjectInfo[]): MarkerTarget {
  return {
    markers: objs.map((o) => o.markers),
    setMarker: (end, marker, label) => {
      // objects that have that marker there already keep it as it is
      const ids = objs
        .filter((o) => {
          const now = o.markers?.[end];
          return marker ? !now || !sameMarker(now, marker) : !!now;
        })
        .map((o) => o.id);
      attempt(label, (s) => s.setLineMarkers(ids, { [end]: marker }));
    },
    update: (label, fn) =>
      attempt(label, (s) =>
        s.batch(() => {
          for (const o of objs) {
            const start = o.markers?.start && fn(o.markers.start);
            const end = o.markers?.end && fn(o.markers.end);
            if (start || end) s.setLineMarkers([o.id], { ...(start ? { start } : {}), ...(end ? { end } : {}) });
          }
        }),
      ),
  };
}

/** Start and end markers; while there are any, their size, and their angle while any is an arrow or slash. */
function markerFields(t: MarkerTarget): HTMLElement[] {
  const all = t.markers.flatMap((m) => [m?.start, m?.end]).filter((m) => m !== undefined);
  const fields = [markerField(t, "start", "Start marker"), markerField(t, "end", "End marker")];
  if (all.length > 0) fields.push(markerSizeField(t, all));
  if (all.some((m) => m.style !== "dot")) fields.push(markerAngleField(t, all));
  return fields;
}

/**
 * The marker at one end: None or one of Tools > Options > Edit Marker List's markers. A marker the
 * list doesn't have is shown by its style, size and angle.
 */
function markerField(t: MarkerTarget, end: "start" | "end", label: string): HTMLElement {
  const list = markerList();
  const key = (m: LineMarker | undefined): string => {
    if (!m) return NO_MARKER;
    const i = list.findIndex((n) => sameMarker(n.marker, m));
    return i >= 0 ? `m${i}` : `${OTHER_MARKER}${markerText(m)}`;
  };
  const v = shared(t.markers.map((m) => key(m?.[end])));
  const options = [
    ...(v === null ? [{ value: "", label: MIXED }] : []),
    { value: NO_MARKER, label: "None" },
    ...list.map((n, i) => ({ value: `m${i}`, label: n.name })),
    ...(v?.startsWith(OTHER_MARKER) ? [{ value: v, label: v.slice(OTHER_MARKER.length) }] : []),
  ];
  return field(
    label,
    selectInput(options, v ?? "", (sel) => {
      if (sel.startsWith(OTHER_MARKER)) return;
      t.setMarker(end, sel === NO_MARKER ? null : list[Number(sel.slice(1))].marker, `Set ${label.toLowerCase()}`);
    }),
  );
}

/** The size of every marker shown, in millimetres on paper (to the thousandth: the file keeps
 *  sizes in 1/16384 inch, so 6 mm comes back as 5.999634). */
function markerSizeField(t: MarkerTarget, all: readonly LineMarker[]): HTMLElement {
  const v = shared(all.map((m) => m.size));
  const input = numberInput(v === null ? null : Math.round(v * MM_PER_INCH * 1000) / 1000, (mm) => {
    const size = clamp(mm, 0.01, 99) / MM_PER_INCH;
    t.update("Set marker size", (m) => ({ ...m, size, width: m.style === "dot" ? size : 0 }));
  });
  input.min = "0.01";
  return field("Marker size (mm)", input);
}

/** The angle of every arrow (each side's to the line, 1–89°) and slash (its turn from the line, 0–180°). */
function markerAngleField(t: MarkerTarget, all: readonly LineMarker[]): HTMLElement {
  const v = shared(all.filter((m) => m.style !== "dot").map((m) => m.angle));
  const input = numberInput(v, (deg) =>
    t.update("Set marker angle", (m) =>
      m.style === "dot" ? m : { ...m, angle: m.style === "arrow" ? clamp(deg, 1, 89) : clamp(deg, 0, 180) },
    ),
  );
  input.min = "0";
  input.max = "180";
  return field("Marker angle (°)", input);
}

/** Drop shadow on or off; while every object casts one, its offset, angle, blur, colour and opacity. */
function shadowFields(doc: VwxDocument, objs: readonly ObjectInfo[]): HTMLElement[] {
  const on = shared(objs.map((o) => o.shadow !== undefined));
  const box = h("input", { attrs: { type: "checkbox", "aria-label": "Drop shadow" }, checked: on === true });
  box.indeterminate = on === null;
  box.addEventListener("change", () => {
    if (box.checked) {
      // objects that cast one already keep theirs
      const ids = objs.filter((o) => !o.shadow).map((o) => o.id);
      attempt("Add drop shadow", (s) => s.setDropShadow(ids, newShadow(doc)));
    } else {
      attempt("Remove drop shadow", (s) => s.setDropShadow(objs.map((o) => o.id), null));
    }
  });
  const toggle = wide(
    h("div", { cls: "field" }, h("span", { cls: "field-label", text: "Drop shadow" }), h("label", { cls: "class-style-item" }, box, h("span", { text: "Casts a shadow" }))),
  );
  if (on !== true) return [toggle];
  const shadows = objs.map((o) => o.shadow!);
  const change = (label: string, patch: Partial<DropShadow>): void => {
    attempt(label, (s) =>
      s.batch(() => {
        for (const o of objs) s.setDropShadow([o.id], { ...o.shadow!, ...patch });
      }),
    );
  };
  const length = (key: "offset" | "blur", label: string): HTMLElement => {
    const v = shared(shadows.map((sh) => sh[key]));
    const input = numberInput(v === null ? null : v * MM_PER_INCH, (mm) =>
      change(`Set shadow ${label.toLowerCase()}`, { [key]: Math.max(0, mm) / MM_PER_INCH }),
    );
    input.min = "0";
    return field(`${label} (mm)`, input);
  };
  const angle = shared(shadows.map((sh) => sh.angle));
  const opacity = shared(shadows.map((sh) => sh.opacity));
  const opacityInput = numberInput(opacity, (v) => change("Set shadow opacity", { opacity: clamp(v, 0, 100) }));
  opacityInput.min = "0";
  opacityInput.max = "100";
  return [
    toggle,
    length("offset", "Offset"),
    field("Angle (°)", numberInput(angle, (v) => change("Set shadow angle", { angle: v }))),
    length("blur", "Blur"),
    field("Opacity (%)", opacityInput),
    wide(
      field(
        "Shadow colour",
        colorSwatch({
          doc,
          label: "Shadow colour",
          value: shared(shadows.map((sh) => sh.color)),
          onPick: (index) => change("Set shadow colour", { color: index }),
        }),
      ),
    ),
  ];
}

/** Select value for an attribute: its number, "" when mixed, TEMPLATE when unset. */
function selectValue(v: number | null | undefined): string {
  return v === null ? "" : v === undefined ? TEMPLATE : String(v);
}

/** Leading options for mixed values and for "From template". */
function placeholders(t: AttrTarget, v: number | null | undefined): { value: string; label: string }[] {
  if (v === null) return [{ value: "", label: MIXED }];
  if (t.canClear) return [{ value: TEMPLATE, label: FROM_TEMPLATE }];
  return [];
}

/** Line weight: Tools > Options > Line Thickness's paper weights in mm; the stored value is in mils. */
function weightField(t: AttrTarget): HTMLElement {
  const v = t.get("lineWeight");
  const weights = thicknessList().map((mm) => ({ mils: mils(mm), label: `${mm.toFixed(2)} mm` }));
  if (typeof v === "number" && !weights.some((w) => w.mils === v)) {
    // a weight the list does not have stays visible
    // weight 0 draws no outline (see drawsPen)
    weights.push({ mils: v, label: v === 0 ? "None (0)" : `${(v * MM_PER_MIL).toFixed(2)} mm` });
    weights.sort((a, b) => a.mils - b.mils);
  }
  const options = [...placeholders(t, v), ...weights.map((w) => ({ value: String(w.mils), label: w.label }))];
  const control = selectInput(options, selectValue(v), (sel) => {
    if (sel === TEMPLATE) t.set("Set line weight", { lineWeight: undefined });
    else t.set("Set line weight", { lineWeight: Number(sel) });
  });
  return field("Line weight", control);
}

/** Line type select: None, Solid, then the document's line types in order. */
function lineStyleField(doc: VwxDocument, t: AttrTarget): HTMLElement {
  // 0 is the pen None; any other non-negative value shows as Solid.
  const v = t.get("lineStyle", (s) => (s < 0 || s === NO_PEN_STYLE ? s : SOLID_STYLE));
  const types = doc.lineTypes();
  const options: { value: string; label: string; disabled?: boolean }[] = [
    ...placeholders(t, v),
    { value: String(NO_PEN_STYLE), label: "None" },
    { value: String(SOLID_STYLE), label: "Solid" },
    ...types.map((lt) => ({ value: String(lt.style), label: lt.name })),
  ];
  if (typeof v === "number" && v < 0 && !types.some((lt) => lt.style === v)) {
    // A style the document does not define: keep it visible rather than showing nothing.
    options.push({ value: String(v), label: `Line type #${-v}`, disabled: true });
  }
  const control = selectInput(options, selectValue(v), (sel) => {
    if (sel === TEMPLATE) t.set("Set line style", { lineStyle: undefined });
    else t.set("Set line style", { lineStyle: Number(sel) });
  });
  return field("Line style", control);
}

/**
 * Fill style: None, Solid, then the document's hatches, tiles and gradients by name. A resource is
 * stored as the negative of its index. A pattern the document does not define stays visible as a
 * disabled "Pattern n".
 */
function fillStyleField(doc: VwxDocument, t: AttrTarget): HTMLElement {
  const v = t.get("fillPattern");
  const resources = doc
    .resources()
    .filter((r) => r.index > 0 && FILL_KINDS.includes(r.kind))
    .sort((a, b) => a.name.localeCompare(b.name));
  const options: { value: string; label: string; disabled?: boolean }[] = [
    ...placeholders(t, v),
    { value: String(NO_FILL), label: "None" },
    { value: String(SOLID_FILL), label: "Solid" },
    ...resources.map((r) => ({ value: String(-r.index), label: r.name })),
  ];
  if (typeof v === "number" && v !== NO_FILL && v !== SOLID_FILL && !resources.some((r) => -r.index === v)) {
    options.push({ value: String(v), label: `Pattern ${v}`, disabled: true });
  }
  const control = selectInput(options, selectValue(v), (sel) => {
    if (sel === TEMPLATE) t.set("Set fill style", { fillPattern: undefined });
    else t.set("Set fill style", { fillPattern: Number(sel) });
  });
  return field("Fill style", control);
}

/** Pen colour is the pen foreground; a solid fill paints the fill background colour. */
function colorField(doc: VwxDocument, t: AttrTarget, key: "penFore" | "fillBack", label: string): HTMLElement {
  const change = (v: number | undefined): void => {
    const patch: AttrPatch = {};
    patch[key] = v;
    t.set(`Set ${label.toLowerCase()}`, patch);
  };
  return field(
    label,
    colorSwatch({
      doc,
      label,
      value: t.get(key),
      onPick: (index) => change(index),
      onClear: t.canClear ? () => change(undefined) : undefined,
    }),
  );
}

/** Opacity 0..100: a slider with a number readout. Dragging previews; release commits. */
function opacityField(t: AttrTarget, key: "penOpacity" | "fillOpacity", label: string): HTMLElement {
  const slider = h("input", {
    cls: "attr-range",
    attrs: { type: "range", min: "0", max: "100", step: "1", "aria-label": label },
  });
  const readout = h("input", {
    cls: "num attr-num",
    attrs: { type: "number", min: "0", max: "100", step: "1", "aria-label": `${label} value` },
  });
  const show = (v: number | null | undefined): void => {
    slider.value = String(typeof v === "number" ? v : 100);
    readout.value = typeof v === "number" ? fmt(v) : "";
    readout.placeholder = v === null ? MIXED : v === undefined ? FROM_TEMPLATE : "";
  };
  const v = t.get(key);
  show(v);
  const commit = (value: number | undefined): void => {
    const patch: AttrPatch = {};
    patch[key] = value;
    t.set(`Set ${label.toLowerCase()}`, patch);
    show(value);
  };
  slider.addEventListener("input", () => {
    readout.value = slider.value;
  });
  slider.addEventListener("change", () => commit(Number(slider.value)));
  readout.addEventListener("change", () => {
    const raw = readout.value.trim();
    if (raw === "") {
      if (t.canClear) commit(undefined);
      else show(v);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) commit(clamp(n, 0, 100));
    else show(v);
  });
  return field(label, h("div", { cls: "attr-opacity" }, slider, readout));
}
