// A site model snapshot, from a model's Object Info: another way of showing the same ground at the same time. It keeps
// its own copy of the model's values, so it stays as it was when the model is changed or deleted, until it's unfrozen,
// and it draws itself from that copy. With coloured elevations or slopes in plan it has a legend.

import type { EditSession, NewShape, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { afterSiteUpdate, registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import { copiedModel, drawnParts, legendOf, modelsIn, modelValues, nearColour, SHOWN_FIELDS, solid, uniqueName } from "./siteModel.ts";
import { layerScaleOf } from "./spaces.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

export const SNAPSHOT = "Rodeo Site Model Snapshot";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;

const FIELD = {
  from: "Site Model",
  frozen: "Frozen",
  copy: "Model Values",
  opacity: "Opacity",
  legend: "Show Legend",
  title: "Title Text",
  reverse: "Reverse Order of Legend",
  x: "Legend X",
  y: "Legend Y",
} as const;

/** a legend's text height on paper, mm */
const LEGEND_MM = 2.5;

interface Snapshot {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function snapshotOf(doc: VwxDocument, id: string): Snapshot | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === SNAPSHOT);
  const layerId = doc.object(id)?.layerId;
  return rec && layerId ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const copyOf = (snap: Snapshot) => copiedModel(JSON.parse(String(snap.value(FIELD.copy) || "{}")) as Record<string, RecordValue>, snap.layerId);

/** The legend's parts, where the snapshot says. */
function legendParts(s: EditSession, snap: Snapshot, classIndex: number): string[] {
  if (snap.value(FIELD.legend) !== true) return [];
  const legend = legendOf(copyOf(snap), s.doc.info.units);
  if (!legend) return [];
  const colour = nearColour(s.doc);
  const height = LEGEND_MM * layerScaleOf(snap.layerId);
  const step = height * 1.8;
  const x = Number(snap.value(FIELD.x)) || 0;
  let y = Number(snap.value(FIELD.y)) || 0;
  const rows = snap.value(FIELD.reverse) === true ? [...legend.rows].reverse() : legend.rows;
  const shapes: NewShape[] = [];
  const looks = [];
  const title = String(snap.value(FIELD.title) ?? "");
  if (title) {
    shapes.push({ kind: "text", at: { x, y }, text: title, height: height * 1.2, hAlign: 1, vAlign: 3 } as NewShape);
    looks.push({ fillPattern: 0 });
    y -= step * 1.2;
  }
  for (const row of rows) {
    shapes.push({ kind: "rect", x0: x, y0: y - height * 0.7, x1: x + height * 3, y1: y + height * 0.7 } as NewShape);
    looks.push(solid(colour(row.colour)));
    shapes.push({ kind: "text", at: { x: x + height * 3.6, y }, text: row.text, height, hAlign: 1, vAlign: 3 } as NewShape);
    looks.push({ fillPattern: 0 });
    y -= step;
  }
  return s.addObjects(snap.layerId, shapes, classIndex, looks);
}

/** Draws a snapshot again from what it keeps. */
function redraw(s: EditSession, snap: Snapshot): void {
  const classIndex = s.doc.object(snap.id)?.classIndex ?? store.activeClassIndex;
  const ids = [...drawnParts(s, copyOf(snap), classIndex), ...legendParts(s, snap, classIndex)];
  const opacity = Number(snap.value(FIELD.opacity));
  if (ids.length && opacity < 100) s.setAttributes(ids, { fillOpacity: opacity, penOpacity: opacity });
  s.setPluginDrawing(snap.id, ids);
}

/** Takes the model's values as they are now, and what it shows of them. */
function recopy(s: EditSession, snap: Snapshot, values: Readonly<Record<string, RecordValue>>): void {
  s.setRecordField(snap.id, snap.format, FIELD.copy, JSON.stringify(values));
  for (const field of SHOWN_FIELDS) s.setRecordField(snap.id, snap.format, field, String(values[field] ?? ""));
}

const live = (s: EditSession, id: string): Snapshot | null => snapshotOf(s.doc, id);

/** Create a Snapshot: over the model, on the active layer, frozen. */
export function createSnapshot(modelId: string): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const r = attempt("Create a Snapshot", (s) =>
    s.batch(() => {
      const model = modelsIn(s.doc).find((m) => m.id === modelId);
      if (!model) throw new Error("That site model has gone.");
      const values = modelValues(s.doc, model);
      const copy = copiedModel(values, layerId);
      const legend = legendOf(copy, s.doc.info.units);
      const gap = 10 * layerScaleOf(layerId);
      const specs: PluginFieldSpec[] = [
        { name: FIELD.from, type: TEXT, value: modelId },
        { name: FIELD.frozen, type: BOOL, value: true },
        { name: FIELD.copy, type: TEXT, value: JSON.stringify(values) },
        { name: FIELD.opacity, type: NUMBER, value: 100 },
        { name: FIELD.legend, type: BOOL, value: true },
        { name: FIELD.title, type: TEXT, value: legend?.title ?? "" },
        { name: FIELD.reverse, type: BOOL, value: false },
        { name: FIELD.x, type: DIMENSION, value: (legend?.corner.x ?? 0) + gap },
        { name: FIELD.y, type: DIMENSION, value: legend?.corner.y ?? 0 },
        ...SHOWN_FIELDS.map((name): PluginFieldSpec => ({ name, type: TEXT, value: String(values[name] ?? "") })),
      ];
      const id = s.addPluginObject(layerId, SNAPSHOT, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), { x: 0, y: 0 } as Pt, 0, store.activeClassIndex);
      const snap = live(s, id);
      if (!snap) throw new Error("The snapshot couldn't be made.");
      s.setObjectName(id, uniqueName(s.doc, `${s.doc.object(modelId)?.name ?? "Site Model"} Snapshot`, id));
      redraw(s, snap);
      return id;
    }),
  );
  if (!r) return;
  setSelection([r.value]);
  toast("Snapshot made, over the site model. It stays as it is until you click Unfreeze.", "info");
}

function setFrozen(id: string, frozen: boolean): void {
  attempt(frozen ? "Freeze Snapshot" : "Unfreeze Snapshot", (s) =>
    s.batch(() => {
      const snap = live(s, id);
      if (!snap) return;
      if (!frozen) {
        const model = modelsIn(s.doc).find((m) => m.id === String(snap.value(FIELD.from)));
        if (!model) throw new Error("the site model it came from has gone");
        recopy(s, snap, modelValues(s.doc, model));
        s.setRecordField(id, snap.format, FIELD.frozen, false);
        const now = live(s, id);
        if (now) redraw(s, now);
        return;
      }
      s.setRecordField(id, snap.format, FIELD.frozen, true);
    }),
  );
}

const snapshotsIn = (doc: VwxDocument): Snapshot[] => {
  if (!doc.hasPluginFormat(SNAPSHOT)) return [];
  const out: Snapshot[] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      const snap = o.type === PLUGIN ? snapshotOf(doc, o.id) : null;
      if (snap) out.push(snap);
    }
  }
  return out;
};

// those not frozen follow their model
afterSiteUpdate((s) => {
  const snaps = snapshotsIn(s.doc).filter((snap) => snap.value(FIELD.frozen) !== true);
  if (!snaps.length) return;
  const models = modelsIn(s.doc);
  for (const snap of snaps) {
    const model = models.find((m) => m.id === String(snap.value(FIELD.from)));
    if (!model) continue;
    recopy(s, snap, modelValues(s.doc, model));
    const now = live(s, snap.id);
    if (now) redraw(s, now);
  }
});

const BUTTON = { freeze: 1, unfreeze: 2 } as const;
const LEGEND_WIDGETS = [12, 13, 14, 15, 16];

const driver: PluginDriver = {
  name: SNAPSHOT,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === FIELD.from || SHOWN_FIELDS.includes(field),
  choices: () => undefined,
  place: () => toast("Select a site model and click Create a Snapshot in Object Info.", "info"),
  edit(id, values) {
    attempt("Edit Snapshot", (s) =>
      s.batch(() => {
        const snap = live(s, id);
        if (!snap) throw new Error("That isn't a site model snapshot.");
        for (const [field, value] of Object.entries(values)) s.setRecordField(id, snap.format, field, field === FIELD.opacity ? Math.max(0, Math.min(100, Number(value) || 0)) : value);
        const now = live(s, id);
        if (now) redraw(s, now);
      }),
    );
  },
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => {
        const snap = live(s, id);
        if (snap) redraw(s, snap);
      });
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => {
    const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
    return [
      { id: BUTTON.freeze, kind: "button", label: "Freeze", level: 0 },
      { id: BUTTON.unfreeze, kind: "button", label: "Unfreeze", level: 0 },
      param(10, FIELD.opacity),
      { id: 11, kind: "divider", label: "Legend", level: 0 },
      param(12, FIELD.legend),
      param(13, FIELD.title),
      param(14, FIELD.reverse),
      param(15, FIELD.x),
      param(16, FIELD.y),
      { id: 17, kind: "divider", label: "Site Model", level: 0 },
      ...SHOWN_FIELDS.map((field, i) => param(20 + i, field)),
    ];
  },
  widgetStates(id, apply) {
    const doc = store.session?.doc;
    const snap = doc ? snapshotOf(doc, id) : null;
    if (!snap || !doc) return;
    const frozen = snap.value(FIELD.frozen) === true;
    const hasLegend = legendOf(copyOf(snap), doc.info.units) !== null;
    apply(
      new Map<number, { enabled: boolean; visible: boolean }>([
        [BUTTON.freeze, { enabled: true, visible: !frozen }],
        [BUTTON.unfreeze, { enabled: true, visible: frozen }],
        [11, { enabled: true, visible: hasLegend }],
        ...LEGEND_WIDGETS.map((w): [number, { enabled: boolean; visible: boolean }] => [w, { enabled: true, visible: hasLegend }]),
      ]),
    );
  },
  press(id, widget) {
    if (widget === BUTTON.freeze) setFrozen(id, true);
    else if (widget === BUTTON.unfreeze) setFrozen(id, false);
  },
};
registerPluginDrivers(() => [driver]);
