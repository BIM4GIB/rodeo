// ConnectCAD's Legend: a key to the signals of the circuits on a schematic layer, each a sample of
// its circuit line in its colour, its name and how many circuits carry it, under a title; a plug-in
// object ('Rodeo ConnectCAD Legend') placed by the Legend tool (a click, then a click for its
// rotation). It keeps the rows it was drawn with; Refresh Legend in its Object Info reads the layer
// again. legendShapes.ts has the sums.

import type { Attributes, EditSession, NewShape, PluginFieldSpec, Pt, RecordValue } from "../../../core/index.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { layerScaleOf } from "../../../app/spaces.ts";
import { store } from "../../../app/state.ts";
import { errorMessage } from "../../../app/toast.ts";
import { LEGEND_TEXT_MM, LEGEND_TITLE_MM, legendLayout, legendRows, type LegendRow } from "./legendShapes.ts";
import { circuitsIn } from "./schematic.ts";

export const LEGEND = "Rodeo ConnectCAD Legend";

const PLUGIN = 86;
const BOOL = 2;
const TEXT = 4;
/** a circuit's line, mils, as schematic.ts draws them */
const CIRCUIT_MILS = 7;

const FIELD = {
  title: "Title",
  count: "Show Count",
  rows: "Signals",
} as const;

export const legendSettings = { title: "Signal Legend", count: true };

interface LegendRec {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function legendOf(s: EditSession, id: string): LegendRec | null {
  const obj = s.doc.object(id);
  const rec = obj?.type === PLUGIN ? s.doc.records(id).find((r) => r.parametric && r.name === LEGEND) : undefined;
  return obj && rec ? { id, layerId: obj.layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const str = (v: RecordValue | undefined): string => (v === undefined ? "" : String(v));

function rowsOf(text: string): LegendRow[] {
  try {
    const raw: unknown = JSON.parse(text || "[]");
    return Array.isArray(raw) ? raw.filter((r): r is LegendRow => !!r && typeof r === "object" && typeof (r as LegendRow).signal === "string") : [];
  } catch {
    return [];
  }
}

/** The legend rows of the circuits on a layer now. */
const rowsOn = (s: EditSession, layerId: string): LegendRow[] => legendRows(circuitsIn(s, layerId).map((c) => str(c.value("Signal"))));

/** The size a new legend on a layer would be, for the tool's preview. */
export function legendSize(layerId: string): { width: number; height: number } {
  const s = store.session;
  const rows = s ? rowsOn(s, layerId) : [];
  return legendLayout(legendSettings.title, rows, legendSettings.count, layerScaleOf(layerId));
}

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
const text = (at: Pt, value: string, height: number, hAlign: number): NewShape => ({ kind: "text", at, text: value, height, hAlign, vAlign: 3, angle: 0 }) as NewShape;

/** Draws legend `id` from the rows it keeps, in the session's open batch. */
function drawLegend(s: EditSession, id: string): void {
  const l = legendOf(s, id);
  if (!l) throw new Error("That isn't a ConnectCAD legend.");
  const match = colorMatcher();
  const ink = (hex: string): number => match(hexToRgb(hex));
  const black = ink("#1f2328");
  const scale = layerScaleOf(l.layerId);
  const rows = rowsOf(str(l.value(FIELD.rows)));
  const showCount = l.value(FIELD.count) !== false;
  const title = str(l.value(FIELD.title));
  const lay = legendLayout(title, rows, showCount, scale);
  const shapes: NewShape[] = [];
  const looks: Partial<Attributes>[] = [];
  const add = (shape: NewShape, look: Partial<Attributes>): void => {
    shapes.push(shape);
    looks.push(look);
  };
  const line: Partial<Attributes> = { penFore: black, fillPattern: 0 };
  add(
    {
      kind: "polygon",
      points: [
        { x: 0, y: 0 },
        { x: lay.width, y: 0 },
        { x: lay.width, y: -lay.height },
        { x: 0, y: -lay.height },
      ],
      closed: true,
    },
    { penFore: black, fillPattern: 1, fillFore: ink("#ffffff"), fillBack: ink("#ffffff"), fillOpacity: 100, lineWeight: 10 },
  );
  if (title) add(text(lay.title, title, LEGEND_TITLE_MM * scale, 2), line);
  rows.forEach((r, i) => {
    const at = lay.rows[i];
    add({ kind: "polyline", points: [at.from, at.to], closed: false } as NewShape, { ...store.drawAttrs, penFore: ink(r.ink), fillPattern: 0, lineStyle: 2, lineWeight: CIRCUIT_MILS });
    add(text(at.name, r.signal, LEGEND_TEXT_MM * scale, 1), line);
    if (showCount) add(text(at.count, String(r.count), LEGEND_TEXT_MM * scale, 3), line);
  });
  if (!rows.length) add(text(lay.blank, "No circuits", LEGEND_TEXT_MM * scale, 2), line);
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  s.setPluginDrawing(id, s.addObjects(l.layerId, shapes, classIndex, looks));
}

/** The Legend tool's clicks: a legend of the layer's circuits, its top left at `at`, turned `angle` degrees. */
export function placeLegend(layerId: string, at: Pt, angle: number): void {
  const r = attempt("Legend", (s) =>
    s.batch(() => {
      const specs: PluginFieldSpec[] = [
        { name: FIELD.title, type: TEXT, value: legendSettings.title },
        { name: FIELD.count, type: BOOL, value: legendSettings.count },
        { name: FIELD.rows, type: TEXT, value: JSON.stringify(rowsOn(s, layerId)) },
      ];
      const id = s.addPluginObject(layerId, LEGEND, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
      drawLegend(s, id);
      return id;
    }),
  );
  if (r) setEditGroup(null, [r.value]);
}

function editLegend(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Legend", (s) =>
    s.batch(() => {
      const l = legendOf(s, id);
      if (!l) throw new Error("That isn't a ConnectCAD legend.");
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, l.format, field, value);
      drawLegend(s, id);
    }),
  );
}

/** Refresh Legend: the rows read again from the circuits on the legend's layer. */
function refreshLegend(id: string): void {
  attempt("Refresh Legend", (s) =>
    s.batch(() => {
      const l = legendOf(s, id);
      if (!l) throw new Error("That isn't a ConnectCAD legend.");
      s.setRecordField(id, l.format, FIELD.rows, JSON.stringify(rowsOn(s, l.layerId)));
      drawLegend(s, id);
    }),
  );
}

const REFRESH = 30;
const LAYOUT: readonly PluginWidget[] = [
  { id: 1, kind: "param", field: FIELD.title, label: "", level: 0 },
  { id: 2, kind: "param", field: FIELD.count, label: "", level: 0 },
  { id: REFRESH, kind: "button", label: "Refresh Legend", level: 0 },
];

const driver: PluginDriver = {
  name: LEGEND,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === FIELD.rows,
  choices: () => undefined,
  place: (layerId, at, angle) => placeLegend(layerId, at, angle),
  edit: (id, values) => editLegend(id, values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawLegend(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => LAYOUT,
  widgetStates: () => {},
  press(id, widget) {
    if (widget === REFRESH) refreshLegend(id);
  },
};

registerPluginDrivers(() => [driver]);
