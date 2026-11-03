// Spotlight's Equipment Summary Key: a plug-in object listing the lighting devices and other equipment in
// the drawing with their counts, and if asked the gels, gobos and circuits in use. Object Info has its
// title, filter and parts, Items and Elements… chooses what's listed, and Refresh, or moving or editing it,
// counts again. Vectorworks takes its list from an inventory of symbols, and shows each one's image; here the
// items are the lighting types, the plug-in objects and the symbols in use, and a device has a generic outline.

import { attempt, setEditGroup } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { keyDrawing, keyRows, type KeyCorner, type KeyOptions } from "../../../app/equipmentKeyShapes.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { lightingDevice } from "../../../app/lightingDeviceShapes.ts";
import { showDialog } from "../../../app/menubar.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { placedDrawing } from "../../../app/tools/circulation.ts";
import { markerParts } from "../../../app/tools/markers.ts";
import { formatLength } from "../../../app/units.ts";
import type { EditSession, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../../../core/index.ts";
import { colorOf } from "../gels.ts";
import { INSTRUMENT } from "../fixture.ts";
import { fixtures } from "../instrument.ts";
import { SHOW_DATA } from "../show.ts";

export const EQUIPMENT_KEY = "Equipment Summary Key";

const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const POPUP = 8;

const FIELD = {
  title: "Key Title",
  position: "Position Filter",
  headers: "Column Headers",
  total: "Total",
  colors: "Color Summary",
  gobos: "Gobo Summary",
  circuits: "Circuit Summary",
  height: "Position Height",
  swatch: "Show Swatch",
  border: "Show Border",
  size: "Text Size",
  corner: "Insertion Point",
  leftOut: "Items Left Out",
  symbols: "Symbols Listed",
} as const;

const ALL_POSITIONS = "All Positions";
const CORNERS: readonly (readonly [KeyCorner, string])[] = [
  ["tl", "Top Left"],
  ["bl", "Bottom Left"],
  ["tr", "Top Right"],
  ["br", "Bottom Right"],
];
/** Rodeo's own notes and readings, which aren't equipment */
/** plug-in objects that aren't equipment, the drawing's show data among them */
const NOT_EQUIPMENT = new Set(["Photometer", "Photometric Grid", "Hyperlink", EQUIPMENT_KEY, SHOW_DATA]);

/** what the tool places next, and what Create Similar Object places */
export const keySettings = {
  title: "Equipment Summary",
  headers: true,
  total: true,
  colors: false,
  gobos: false,
  circuits: false,
  height: false,
  swatch: true,
  border: true,
  size: 2.5,
  corner: "tl" as KeyCorner,
};

const cornerName = (c: KeyCorner): string => CORNERS.find(([k]) => k === c)?.[1] ?? "Top Left";

const fields = (): PluginFieldSpec[] => [
  { name: FIELD.title, type: TEXT, value: keySettings.title },
  { name: FIELD.position, type: POPUP, value: ALL_POSITIONS },
  { name: FIELD.headers, type: BOOL, value: keySettings.headers },
  { name: FIELD.total, type: BOOL, value: keySettings.total },
  { name: FIELD.colors, type: BOOL, value: keySettings.colors },
  { name: FIELD.gobos, type: BOOL, value: keySettings.gobos },
  { name: FIELD.circuits, type: BOOL, value: keySettings.circuits },
  { name: FIELD.height, type: BOOL, value: keySettings.height },
  { name: FIELD.swatch, type: BOOL, value: keySettings.swatch },
  { name: FIELD.border, type: BOOL, value: keySettings.border },
  { name: FIELD.size, type: NUMBER, value: keySettings.size },
  { name: FIELD.corner, type: POPUP, value: cornerName(keySettings.corner) },
  { name: FIELD.leftOut, type: TEXT, value: "" },
  { name: FIELD.symbols, type: TEXT, value: "" },
];

const namesOf = (v: RecordValue | undefined): string[] => String(v ?? "").split("\n").filter(Boolean);

function recordOf(s: EditSession, id: string): { format: number; value(field: string): RecordValue | undefined } {
  const rec = s.doc.records(id).find((r) => r.parametric && r.name === EQUIPMENT_KEY);
  if (!rec) throw new Error("That isn't an equipment summary key.");
  return { format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value };
}

/** The plug-in objects and symbols placed on the design layers, not counting lighting devices, by name. */
export function usedEquipment(doc: VwxDocument): { plugins: Map<string, number>; symbols: Map<string, number> } {
  const plugins = new Map<string, number>();
  const symbols = new Map<string, number>();
  const symbolNames = new Map(doc.symbolDefs().map((d) => [d.index, d.name]));
  const devices = new Set(fixtures().map((f) => f.id));
  for (const layer of doc.layers()) {
    if (layer.kind === "sheet") continue;
    for (const o of doc.objects(layer.id)) {
      if (o.parentId !== null || devices.has(o.id)) continue;
      if (o.symbol !== undefined) {
        const name = symbolNames.get(o.symbol);
        if (name) symbols.set(name, (symbols.get(name) ?? 0) + 1);
      } else if (o.insertion) {
        const name = doc.records(o.id).find((r) => r.parametric)?.name;
        if (name && !NOT_EQUIPMENT.has(name) && name !== INSTRUMENT) plugins.set(name, (plugins.get(name) ?? 0) + 1);
      }
    }
  }
  return { plugins, symbols };
}

function drawInto(s: EditSession, id: string): void {
  const obj = s.doc.object(id);
  const rec = recordOf(s, id);
  if (!obj) throw new Error("That isn't an equipment summary key.");
  const flag = (field: string): boolean => rec.value(field) === true;
  const filter = String(rec.value(FIELD.position) ?? "");
  const options: KeyOptions = {
    title: String(rec.value(FIELD.title) ?? ""),
    position: filter === ALL_POSITIONS ? "" : filter,
    columnHeaders: flag(FIELD.headers),
    total: flag(FIELD.total),
    colors: flag(FIELD.colors),
    gobos: flag(FIELD.gobos),
    circuits: flag(FIELD.circuits),
    positionHeight: flag(FIELD.height),
    leftOut: new Set(namesOf(rec.value(FIELD.leftOut))),
  };
  const { plugins, symbols } = usedEquipment(s.doc);
  const listed = new Set(namesOf(rec.value(FIELD.symbols)));
  const others = [...plugins, ...[...symbols].filter(([name]) => listed.has(name))];
  const units = s.doc.info.units;
  const rows = keyRows(fixtures(), others, options, (mm) => formatLength(mm, units));
  const scale = s.doc.layers().find((l) => l.id === obj.layerId)?.scale || 1;
  const textHeight = (Number(rec.value(FIELD.size)) || 2.5) * scale;
  const corner = CORNERS.find(([, label]) => label === rec.value(FIELD.corner))?.[0] ?? "tl";
  const d = keyDrawing(rows, textHeight, corner, flag(FIELD.swatch), flag(FIELD.border));
  const match = colorMatcher();
  const ids: string[] = [];
  const add = (shape: Parameters<EditSession["addObject"]>[1], attrs: Parameters<EditSession["addObject"]>[3]): void => void ids.push(s.addObject(obj.layerId, shape, obj.classIndex, attrs));
  if (d.border) add({ kind: "polygon", points: [...d.border], closed: true }, { fillPattern: 1, fillFore: match({ r: 1, g: 1, b: 1 }), fillBack: match({ r: 1, g: 1, b: 1 }), fillOpacity: 100 });
  for (const [a, b] of d.lines) add({ kind: "line", a, b }, undefined);
  for (const g of d.glyphs) {
    // a device's outline, sized by what it measures at full size
    const full = lightingDevice(g.glyph, 1, { channel: "", unit: "", color: "", purpose: "" }, 1, 0);
    const xs = full.outlines.flat().map((p) => p.x);
    const ys = full.outlines.flat().map((p) => p.y);
    const k = g.size / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
    const small = lightingDevice(g.glyph, k, { channel: "", unit: "", color: "", purpose: "" }, 1, 0);
    const middle: Pt = { x: g.at.x - (k * (Math.max(...xs) + Math.min(...xs))) / 2, y: g.at.y - (k * (Math.max(...ys) + Math.min(...ys))) / 2 };
    for (const part of markerParts(placedDrawing(small, middle, 0))) {
      const shape = "shape" in part ? part.shape : part;
      add(shape, "shape" in part && part.attrs ? part.attrs : { fillPattern: 0 });
    }
  }
  for (const w of d.swatches) {
    const c = colorOf(w.name);
    const ink = match({ r: c.r, g: c.g, b: c.b });
    add({ kind: "polygon", points: [...w.points], closed: true }, { fillPattern: 1, fillFore: ink, fillBack: ink, fillOpacity: 100 });
  }
  for (const t of d.texts) add({ kind: "text", at: t.at, text: t.text, height: t.height, hAlign: t.hAlign, vAlign: 3, angle: 0 }, { fillPattern: 0 });
  if (!ids.length) throw new Error("There's nothing to list: turn on a title, or add equipment.");
  // drawn in its own frame on its layer, then moved into it
  s.setPluginDrawing(id, ids);
}

/** Places a key at `at`, listing one position's equipment if it's given, and selects it. */
export function placeKey(layerId: string, at: Pt, angle = 0, position?: string): void {
  const r = attempt(EQUIPMENT_KEY, (s) =>
    s.batch(() => {
      const specs = fields().map((f) => (position && f.name === FIELD.position ? { ...f, value: position } : f));
      const id = s.addPluginObject(layerId, EQUIPMENT_KEY, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
      drawInto(s, id);
      return id;
    }),
  );
  if (r) setEditGroup(null, [r.value]);
}

function edit(id: string, label: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt(label, (s) =>
    s.batch(() => {
      const rec = recordOf(s, id);
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
      drawInto(s, id);
    }),
  );
}

/** Items and Elements…: what the key lists, each thing used in the drawing with a tick. */
async function chooseItems(id: string): Promise<void> {
  const s = store.session;
  if (!s) return;
  const rec = recordOf(s, id);
  const leftOut = new Set(namesOf(rec.value(FIELD.leftOut)));
  const listed = new Set(namesOf(rec.value(FIELD.symbols)));
  const { plugins, symbols } = usedEquipment(s.doc);
  const lights = new Map<string, number>();
  for (const f of fixtures()) lights.set(f.label, (lights.get(f.label) ?? 0) + 1);
  const checks: { name: string; symbol: boolean; box: HTMLInputElement }[] = [];
  const section = (title: string, items: ReadonlyMap<string, number>, symbol: boolean): HTMLElement[] => {
    if (!items.size) return [];
    return [
      h("p", { cls: "muted", text: title }),
      ...[...items].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })).map(([name, count]) => {
        const box = h("input", { attrs: { type: "checkbox" } });
        box.checked = symbol ? listed.has(name) : !leftOut.has(name);
        checks.push({ name, symbol, box });
        return h("label", { cls: "menu-dialog-check" }, box, `${name} (${count})`);
      }),
    ];
  };
  const list = [...section("Lighting devices", lights, false), ...section("Plug-in objects", plugins, false), ...section("Symbols", symbols, true)];
  if (!list.length) {
    toast("There's no equipment in this drawing yet.", "info");
    return;
  }
  const v = await showDialog<{ leftOut: string; symbols: string }>({
    title: "Items and Elements to Display",
    okLabel: "OK",
    body: [h("div", { attrs: { style: "max-height: 320px; overflow: auto; display: grid; gap: 4px" } }, ...list)],
    check: () => ({
      value: {
        leftOut: checks.filter((c) => !c.symbol && !c.box.checked).map((c) => c.name).join("\n"),
        symbols: checks.filter((c) => c.symbol && c.box.checked).map((c) => c.name).join("\n"),
      },
    }),
  });
  if (v && store.session === s) edit(id, "Items and Elements", { [FIELD.leftOut]: v.leftOut, [FIELD.symbols]: v.symbols });
}

const LABELS: Readonly<Record<string, string>> = {
  [FIELD.size]: "Text Size (mm on paper)",
};

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const ITEMS = 20;
const REFRESH = 21;
const WIDGETS: readonly PluginWidget[] = [
  param(1, FIELD.title),
  param(2, FIELD.position),
  param(3, FIELD.corner),
  { id: ITEMS, kind: "button", label: "Items and Elements…", level: 0 },
  param(4, FIELD.headers),
  param(5, FIELD.total),
  param(6, FIELD.colors),
  param(7, FIELD.swatch),
  param(8, FIELD.gobos),
  param(9, FIELD.circuits),
  param(10, FIELD.height),
  param(11, FIELD.border),
  param(12, FIELD.size),
  { id: REFRESH, kind: "button", label: "Refresh", level: 0 },
];

const driver: PluginDriver = {
  name: EQUIPMENT_KEY,
  shape: "point",
  builtIn: true,
  label: (field) => LABELS[field],
  readOnly: () => false,
  choices(field) {
    if (field === FIELD.corner) return CORNERS.map(([, label]) => ({ value: label, label }));
    if (field !== FIELD.position) return undefined;
    const positions = [...new Set(fixtures().map((f) => f.position.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return [ALL_POSITIONS, ...positions].map((value) => ({ value, label: value }));
  },
  place: (layerId, at, angle) => placeKey(layerId, at, angle),
  edit: (id, values) => edit(id, "Edit Equipment Summary Key", values),
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
  press(id, widget) {
    if (widget === ITEMS) void chooseItems(id).catch((err: unknown) => toast(errorMessage(err)));
    else if (widget === REFRESH) edit(id, "Refresh", {});
  },
};
registerPluginDrivers(() => [driver]);
