// Spotlight's Photometer and Photometric Grid: plug-in objects that show the light falling at a point,
// or at points spaced over a plane that can tilt, from every lighting instrument in the drawing, in
// footcandles or lux by the drawing's units. Each reading is worked out when the object is drawn, by
// photometry.ts's model at the levels being looked at, so Refresh (or moving and editing it) brings it up
// to date, as in Vectorworks. Threshold Settings colours each reading by where it falls.

import { attempt, setEditGroup } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { registerPluginDrivers, type PluginDriver, type PluginWidget, type PluginWidgetStates } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { DEFAULT_THRESHOLDS, gridNormal, gridPoints, gridProblem, illumText, illumUnit, inDrawing, offsetOfTilt, readingParts, thresholdColour, tiltOfOffset, type PhotoGridSpec, type PhotoThresholds } from "../../../app/photometerShapes.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { formatLength } from "../../../app/units.ts";
import type { EditSession, PluginFieldSpec, Pt, RecordValue } from "../../../core/index.ts";
import { fixtures } from "../instrument.ts";
import { levelOf } from "../levels.ts";
import { luxOn } from "./photometry.ts";

export const PHOTOMETER = "Photometer";
export const PHOTO_GRID = "Photometric Grid";

const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  elevation: "Elevation",
  textSize: "Text Size",
  showElevation: "Show Elevation",
  showZero: "Show Zero",
  useThresholds: "Use Threshold Settings",
  lower: "Lower Threshold",
  upper: "Upper Threshold",
  zero: "Color for Zero",
  below: "Color Below Lower",
  between: "Color Between",
  above: "Color Above Upper",
  reading: "Reading",
  spacingX: "Grid Spacing X",
  spacingY: "Grid Spacing Y",
  widthX: "Grid Width X",
  widthY: "Grid Width Y",
  slope: "Slope Based On",
  tiltX: "Tilt Angle X",
  tiltY: "Tilt Angle Y",
  offsetX: "Height Offset X",
  offsetY: "Height Offset Y",
} as const;

const ANGLE = "Angle";
const DISTANCE = "Distance";

/** what the tools place next, and what Create Similar Object places */
export const photoSettings = {
  elevation: 0,
  textSize: 2.5,
  showElevation: false,
  showZero: false,
  useThresholds: true,
};

export const gridSettings = {
  spacingX: 1000,
  spacingY: 1000,
  byDistance: false,
  tiltX: 0,
  tiltY: 0,
  offsetX: 0,
  offsetY: 0,
};

const commonFields = (): PluginFieldSpec[] => [
  { name: FIELD.elevation, type: DIMENSION, value: photoSettings.elevation },
  { name: FIELD.textSize, type: NUMBER, value: photoSettings.textSize },
  { name: FIELD.showElevation, type: BOOL, value: photoSettings.showElevation },
  { name: FIELD.showZero, type: BOOL, value: photoSettings.showZero },
  { name: FIELD.useThresholds, type: BOOL, value: photoSettings.useThresholds },
  { name: FIELD.lower, type: NUMBER, value: DEFAULT_THRESHOLDS.lower },
  { name: FIELD.upper, type: NUMBER, value: DEFAULT_THRESHOLDS.upper },
  { name: FIELD.zero, type: TEXT, value: DEFAULT_THRESHOLDS.zero },
  { name: FIELD.below, type: TEXT, value: DEFAULT_THRESHOLDS.below },
  { name: FIELD.between, type: TEXT, value: DEFAULT_THRESHOLDS.between },
  { name: FIELD.above, type: TEXT, value: DEFAULT_THRESHOLDS.above },
];

const meterFields = (): PluginFieldSpec[] => [...commonFields(), { name: FIELD.reading, type: TEXT, value: "" }];

const gridFields = (widthX: number, widthY: number): PluginFieldSpec[] => {
  const g = gridSettings;
  const tiltX = g.byDistance ? tiltOfOffset(g.offsetX, widthX) : g.tiltX;
  const tiltY = g.byDistance ? tiltOfOffset(g.offsetY, widthY) : g.tiltY;
  return [
    ...commonFields(),
    { name: FIELD.spacingX, type: DIMENSION, value: g.spacingX },
    { name: FIELD.spacingY, type: DIMENSION, value: g.spacingY },
    { name: FIELD.widthX, type: DIMENSION, value: widthX },
    { name: FIELD.widthY, type: DIMENSION, value: widthY },
    { name: FIELD.slope, type: POPUP, value: g.byDistance ? DISTANCE : ANGLE },
    { name: FIELD.tiltX, type: NUMBER, value: tiltX },
    { name: FIELD.tiltY, type: NUMBER, value: tiltY },
    { name: FIELD.offsetX, type: DIMENSION, value: offsetOfTilt(tiltX, widthX) },
    { name: FIELD.offsetY, type: DIMENSION, value: offsetOfTilt(tiltY, widthY) },
  ];
};

const valuesOf = (specs: readonly PluginFieldSpec[]): Record<string, RecordValue> => Object.fromEntries(specs.map((f) => [f.name, f.value]));

function recordOf(s: EditSession, id: string): { format: number; name: string; value(field: string): RecordValue | undefined } {
  const rec = s.doc.records(id).find((r) => r.parametric && (r.name === PHOTOMETER || r.name === PHOTO_GRID));
  if (!rec) throw new Error("That isn't a photometer.");
  return { format: rec.format, name: rec.name, value: (field) => rec.fields.find((f) => f.name === field)?.value };
}

const num = (v: RecordValue | undefined): number => (typeof v === "number" ? v : Number(v) || 0);

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 } : { r: 0, g: 0, b: 0 };
}

/** Draws photometer or grid `id` from its parameters and the instruments now, in the session's open batch. */
function drawInto(s: EditSession, id: string): void {
  const obj = s.doc.object(id);
  const rec = recordOf(s, id);
  if (!obj) throw new Error("That isn't a photometer.");
  const grid = rec.name === PHOTO_GRID;
  const units = s.doc.info.units;
  const unit = illumUnit(units);
  const at = obj.insertion ?? { x: 0, y: 0 };
  const angle = s.pluginAngle(id);
  const scale = s.doc.layers().find((l) => l.id === obj.layerId)?.scale || 1;
  const height = (num(rec.value(FIELD.textSize)) || 2.5) * scale;
  const thresholds: PhotoThresholds | null =
    rec.value(FIELD.useThresholds) === true
      ? {
          lower: num(rec.value(FIELD.lower)),
          upper: num(rec.value(FIELD.upper)),
          zero: String(rec.value(FIELD.zero) ?? DEFAULT_THRESHOLDS.zero),
          below: String(rec.value(FIELD.below) ?? DEFAULT_THRESHOLDS.below),
          between: String(rec.value(FIELD.between) ?? DEFAULT_THRESHOLDS.between),
          above: String(rec.value(FIELD.above) ?? DEFAULT_THRESHOLDS.above),
        }
      : null;
  const spec: PhotoGridSpec = {
    widthX: num(rec.value(FIELD.widthX)),
    widthY: num(rec.value(FIELD.widthY)),
    spacingX: num(rec.value(FIELD.spacingX)),
    spacingY: num(rec.value(FIELD.spacingY)),
    elevation: num(rec.value(FIELD.elevation)),
    tiltX: num(rec.value(FIELD.tiltX)),
    tiltY: num(rec.value(FIELD.tiltY)),
  };
  if (grid) {
    const problem = gridProblem(spec);
    if (problem) throw new Error(problem);
  }
  const points = grid ? gridPoints(spec) : [{ x: 0, y: 0, z: spec.elevation }];
  const normal = grid ? gridNormal(spec.tiltX, spec.tiltY, angle) : { x: 0, y: 0, z: 1 };
  const list = fixtures();
  const showElevation = rec.value(FIELD.showElevation) === true;
  const showZero = rec.value(FIELD.showZero) === true;
  const match = colorMatcher();
  const ink = new Map<string, number>();
  const inkOf = (hex: string): number => {
    let c = ink.get(hex);
    if (c === undefined) ink.set(hex, (c = match(hexToRgb(hex))));
    return c;
  };
  const ids: string[] = [];
  let reading = "";
  for (const p of points) {
    const q = inDrawing(at, angle, p);
    const lux = luxOn(list, levelOf, { x: q.x, y: q.y, z: p.z }, normal);
    const text = illumText(lux, unit);
    if (!grid) reading = text;
    // a grid's unlit points are their dots alone, as Vectorworks draws them
    const lines = lux > 0.005 || !grid ? [text] : [];
    if (showElevation && (showZero || Math.abs(p.z) > 0.5)) lines.push(formatLength(p.z, units));
    const c = inkOf(thresholds ? thresholdColour(lux, unit, thresholds) : "#000000");
    for (const shape of readingParts(p.x, p.y, height, lines)) {
      ids.push(s.addObject(obj.layerId, shape, obj.classIndex, shape.kind === "text" ? { penFore: c, fillPattern: 0 } : { penFore: c, fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100 }));
    }
  }
  // drawn in its own frame on its layer, then moved into it
  s.setPluginDrawing(id, ids);
  if (!grid) s.setRecordField(id, rec.format, FIELD.reading, reading);
}

/** Places a photometer at `at`, turned `angle`, and selects it. */
export function placePhotometer(layerId: string, at: Pt, angle: number): void {
  const r = attempt(PHOTOMETER, (s) =>
    s.batch(() => {
      const specs = meterFields();
      const id = s.addPluginObject(layerId, PHOTOMETER, specs, valuesOf(specs), at, angle, store.activeClassIndex);
      drawInto(s, id);
      return id;
    }),
  );
  if (r) setEditGroup(null, [r.value]);
}

/** Places a grid about `center`, turned `angle`, and selects it. */
export function placePhotoGrid(layerId: string, center: Pt, angle: number, widthX: number, widthY: number): void {
  const r = attempt(PHOTO_GRID, (s) =>
    s.batch(() => {
      const specs = gridFields(widthX, widthY);
      const id = s.addPluginObject(layerId, PHOTO_GRID, specs, valuesOf(specs), center, angle, store.activeClassIndex);
      drawInto(s, id);
      return id;
    }),
  );
  if (r) setEditGroup(null, [r.value]);
}

/** The tilt and height offsets that go together, after an edit of whichever the grid goes by. */
function settleSlope(s: EditSession, id: string): void {
  const rec = recordOf(s, id);
  if (rec.name !== PHOTO_GRID) return;
  const widthX = num(rec.value(FIELD.widthX));
  const widthY = num(rec.value(FIELD.widthY));
  if (rec.value(FIELD.slope) === DISTANCE) {
    s.setRecordField(id, rec.format, FIELD.tiltX, tiltOfOffset(num(rec.value(FIELD.offsetX)), widthX));
    s.setRecordField(id, rec.format, FIELD.tiltY, tiltOfOffset(num(rec.value(FIELD.offsetY)), widthY));
  } else {
    s.setRecordField(id, rec.format, FIELD.offsetX, offsetOfTilt(num(rec.value(FIELD.tiltX)), widthX));
    s.setRecordField(id, rec.format, FIELD.offsetY, offsetOfTilt(num(rec.value(FIELD.tiltY)), widthY));
  }
}

function edit(id: string, label: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt(label, (s) =>
    s.batch(() => {
      const rec = recordOf(s, id);
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
      settleSlope(s, id);
      drawInto(s, id);
    }),
  );
}

/** The Threshold Settings dialog, for the object `id`. */
async function thresholdSettings(id: string): Promise<void> {
  const s = store.session;
  if (!s) return;
  const rec = recordOf(s, id);
  const unit = illumUnit(s.doc.info.units) === "fc" ? "FC" : "lx";
  const field = (label: string, el: HTMLElement, after = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, after ? h("span", { cls: "menu-dialog-unit", text: after }) : null);
  const colour = (name: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value: String(rec.value(name) ?? "#000000"), attrs: { type: "color", "aria-label": name, style: "width: 64px; padding: 2px" } });
  const number = (name: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value: String(num(rec.value(name))), attrs: { type: "text", inputmode: "decimal", "aria-label": name } });
  const zero = colour(FIELD.zero);
  const below = colour(FIELD.below);
  const lower = number(FIELD.lower);
  const between = colour(FIELD.between);
  const upper = number(FIELD.upper);
  const above = colour(FIELD.above);
  const v = await showDialog<Record<string, RecordValue>>({
    title: "Threshold Settings",
    okLabel: "OK",
    body: [
      field("Color Shown for Zero Value", zero),
      field("Color Shown Below Lower Threshold", below),
      field("Lower Threshold", lower, unit),
      field("Color Shown Between Thresholds", between),
      field("Upper Threshold", upper, unit),
      field("Color Shown Above Upper Threshold", above),
    ],
    check: () => {
      const lo = Number(lower.value);
      if (!Number.isFinite(lo) || lo < 0 || lower.value.trim() === "") return { error: "Lower Threshold: enter a number, 0 or more.", focus: lower };
      const up = Number(upper.value);
      if (!Number.isFinite(up) || upper.value.trim() === "" || up < lo) return { error: "Upper Threshold: enter a number no less than the lower one.", focus: upper };
      return { value: { [FIELD.lower]: lo, [FIELD.upper]: up, [FIELD.zero]: zero.value, [FIELD.below]: below.value, [FIELD.between]: between.value, [FIELD.above]: above.value } };
    },
  });
  if (v && store.session === s) edit(id, "Threshold Settings", v);
}

const LABELS: Readonly<Record<string, string>> = {
  [FIELD.textSize]: "Text Size (mm on paper)",
  [FIELD.tiltX]: "Tilt Angle X (°)",
  [FIELD.tiltY]: "Tilt Angle Y (°)",
};

const param = (id: number, field: string, level = 0): PluginWidget => ({ id, kind: "param", field, label: "", level });
const THRESHOLDS = 20;
const REFRESH = 21;
const TILT_X = 12;
const TILT_Y = 13;
const OFFSET_X = 14;
const OFFSET_Y = 15;
const COMMON: readonly PluginWidget[] = [param(1, FIELD.elevation), param(2, FIELD.textSize), param(3, FIELD.showElevation), param(4, FIELD.showZero), param(5, FIELD.useThresholds), { id: THRESHOLDS, kind: "button", label: "Threshold Settings…", level: 0 }];
const METER: readonly PluginWidget[] = [param(6, FIELD.reading), ...COMMON, { id: REFRESH, kind: "button", label: "Refresh", level: 0 }];
const GRID: readonly PluginWidget[] = [
  ...COMMON,
  param(7, FIELD.spacingX),
  param(8, FIELD.spacingY),
  param(9, FIELD.widthX),
  param(10, FIELD.widthY),
  param(11, FIELD.slope),
  param(TILT_X, FIELD.tiltX, 1),
  param(TILT_Y, FIELD.tiltY, 1),
  param(OFFSET_X, FIELD.offsetX, 1),
  param(OFFSET_Y, FIELD.offsetY, 1),
  { id: REFRESH, kind: "button", label: "Refresh", level: 0 },
];

function press(id: string, widget: number): void {
  if (widget === THRESHOLDS) void thresholdSettings(id).catch((err: unknown) => toast(errorMessage(err)));
  else if (widget === REFRESH) edit(id, "Refresh", {});
}

const driverOf = (name: string, label: string, layout: readonly PluginWidget[], place: PluginDriver["place"]): PluginDriver => ({
  name,
  shape: "point",
  builtIn: true,
  label: (field) => LABELS[field],
  readOnly: (field) => field === FIELD.reading,
  choices: (field) => (field === FIELD.slope ? [ANGLE, DISTANCE].map((value) => ({ value, label: value })) : undefined),
  place,
  edit: (id, values) => edit(id, `Edit ${label}`, values),
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
  layout: () => layout,
  widgetStates(id, apply) {
    const s = store.session;
    if (!s || name !== PHOTO_GRID) return;
    const byDistance = recordOf(s, id).value(FIELD.slope) === DISTANCE;
    const states: PluginWidgetStates = new Map([
      [TILT_X, { enabled: !byDistance, visible: true }],
      [TILT_Y, { enabled: !byDistance, visible: true }],
      [OFFSET_X, { enabled: byDistance, visible: true }],
      [OFFSET_Y, { enabled: byDistance, visible: true }],
    ]);
    apply(states);
  },
  press,
});

registerPluginDrivers(() => [
  driverOf(PHOTOMETER, "Photometer", METER, (layerId, at, angle) => placePhotometer(layerId, at, angle)),
  driverOf(PHOTO_GRID, "Photometric Grid", GRID, (layerId, at, angle, size) => placePhotoGrid(layerId, at, angle, size?.width || 6000, size?.height || 4000)),
]);
