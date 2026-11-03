// AEC > Terrain's commands that work on a site model and its modifiers: Create Grade Limits from Planar Pad, Create
// Planar Pad from Grade Limits, Site Model Section and Create Site Model Volume List, and View's Show or Hide Site
// Modifiers. The sums are in siteGrading.ts, the model in siteModel.ts.

import type { EditSession, NewSheetCell, NewShape, ObjectInfo, Pt, VwxDocument } from "../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { downloadBlob } from "./fileio.ts";
import { pointInPolygon } from "./geom.ts";
import { showDialog } from "./menubar.ts";
import { colorSwatch } from "./panels/colorPicker.ts";
import { balancedPad, limitsAround, pointAtStation, readSlope, sectionProfile, sectionStations, SLOPE_METHODS, slopeText, stationsOf, triangleFigures, type SlopeMethod, type TriangleFigures } from "./siteGrading.ts";
import { datumOf, MODIFIER_CLASS, modifierObject, modifierOf, modelsIn, nearColour, pen, selectedTop, terrainOf, uniqueName, type Look, type Model, type Terrain } from "./siteModel.ts";
import "./siteCommands.css";
import { boxOf, modifierStep, niceInterval, type HeightAt } from "./siteModelShapes.ts";
import { layerScaleOf } from "./spaces.ts";
import { store } from "./state.ts";
import { closedOutline } from "./surfaces.ts";
import { errorMessage, toast } from "./toast.ts";
import { formatArea, formatLength, formatLengthValue, formatVolume, parseLength } from "./units.ts";
import { editWorksheet } from "./worksheetEditor.ts";

const FOOT = 304.8;
const LIMIT_SLOPES = "Grade Limits Slopes";
const SIDE_SLOPES = "Side Slopes";
const POINT = 25.4 / 72;
const MAX_SHEET_ROWS = 5000;
const MAX_GROUP_TRIANGLES = 2000;
/** A triangle moved by less than this on average, mm, counts as unmodified. */
const UNMODIFIED = 1;

const select = (options: readonly string[], value: string, label: string): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map((o) => h("option", { text: o, attrs: { value: o } })));
  el.value = value;
  return el;
};

const textInput = (value: string, label: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { "aria-label": label } });

const row = (label: string, el: HTMLElement, unit = ""): HTMLElement =>
  h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, ...(unit ? [h("span", { cls: "menu-dialog-unit", text: unit })] : []));

const checkbox = (label: string, checked: boolean): { row: HTMLElement; input: HTMLInputElement } => {
  const input = h("input", { attrs: { type: "checkbox", "aria-label": label } });
  input.checked = checked;
  return { row: h("label", { cls: "menu-dialog-check" }, input, label), input };
};

const heading = (text: string): HTMLElement => h("p", { cls: "menu-dialog-heading", text });

const shown = (el: HTMLElement, visible: boolean): void => {
  el.style.display = visible ? "" : "none";
};

/** A colour the dialog holds, as a swatch that changes it. */
function swatch(doc: VwxDocument, label: string, initial: number): { readonly el: HTMLElement; get(): number } {
  let colour = initial;
  const el = h("span", {});
  const draw = (): void => el.replaceChildren(colorSwatch({ doc, value: colour, label, onPick: (index) => ((colour = index), draw()) }));
  draw();
  return { el, get: () => colour };
}

const selectedOfKind = (doc: VwxDocument, kind: "pad" | "limits"): ObjectInfo[] => selectedTop(doc).filter((o) => modifierOf(doc, o)?.kind === kind);

/** The first model whose surface these points are all on. */
function modelUnder(doc: VwxDocument, points: readonly Pt[]): { model: Model; terrain: Terrain } | null {
  for (const model of modelsIn(doc)) {
    const terrain = terrainOf(model);
    if (points.every((p) => terrain.existingAt(p.x, p.y) !== null)) return { model, terrain };
  }
  return null;
}

/** What's in the drawing for a model's surface, for a pad: a centre on it is enough, as the limits may run off it. */
const padCentre = (ring: readonly Pt[]): Pt => ({ x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length, y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length });

export const canMakeLimits = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && selectedOfKind(doc, "pad").length > 0;
};

const limitsAsked: { control: string; offset: number; method: SlopeMethod; slope: number; midpoints: boolean; increment: number } = {
  control: "Batter Slope",
  offset: 10 * FOOT,
  method: "Percent",
  slope: 1 / 3,
  midpoints: true,
  increment: 5 * FOOT,
};

/** AEC > Terrain > Create Grade Limits from Planar Pad. */
export async function gradeLimitsFromPadDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const pads = selectedOfKind(session.doc, "pad");
  if (!pads.length) {
    toast("Select one or more planar pads first.", "error");
    return;
  }
  const units = session.doc.info.units;
  const was = limitsAsked;
  const control = select(["Distance", "Batter Slope"], was.control, "Grade Limits Offset Control");
  const offset = textInput(formatLengthValue(was.offset, units), "Max. Offset");
  const method = select(SLOPE_METHODS, was.method, "Slope Definition");
  const slope = textInput(slopeText(was.slope, was.method), "Max. Slope");
  const midpoints = checkbox("Use Midpoints", was.midpoints);
  const increment = textInput(formatLengthValue(was.increment, units), "Test Increment");
  const least = 12 * 25.4;
  const batterRows = [row("Slope Definition", method), row("Max. Slope", slope), midpoints.row, row("Test Increment", increment)];
  const offsetRow = row("Max. Offset", offset);
  const offsetLabel = offsetRow.querySelector(".menu-dialog-label") as HTMLElement;
  const refresh = (): void => {
    const batter = control.value === "Batter Slope";
    batterRows.forEach((el) => shown(el, batter));
    shown(batterRows[3], batter && midpoints.input.checked);
    offsetLabel.textContent = batter ? "Max. Offset" : "Offset";
  };
  control.addEventListener("change", refresh);
  midpoints.input.addEventListener("change", refresh);
  let shownMethod = was.method;
  method.addEventListener("change", () => {
    const value = readSlope(slope.value, shownMethod);
    shownMethod = method.value as SlopeMethod;
    if (value !== null) slope.value = slopeText(value, shownMethod);
  });
  refresh();
  const asked = await showDialog<typeof limitsAsked>({
    title: "Create Grade Limits from Planar Pad",
    okLabel: "OK",
    body: [row("Grade Limits Offset Control", control), offsetRow, ...batterRows],
    check: () => {
      const d = parseLength(offset.value, units);
      if (d === null || !(d > 0)) return { error: "Type a distance over zero.", focus: offset };
      const s = readSlope(slope.value, method.value as SlopeMethod);
      const batter = control.value === "Batter Slope";
      if (batter && s === null) return { error: "Type a slope over zero, and under 90° if it's in degrees.", focus: slope };
      const i = parseLength(increment.value, units);
      if (batter && midpoints.input.checked && (i === null || i < least)) return { error: `The Test Increment can't be under ${formatLength(least, units)}.`, focus: increment };
      return { value: { control: control.value, offset: d, method: method.value as SlopeMethod, slope: s ?? was.slope, midpoints: midpoints.input.checked, increment: i ?? was.increment } };
    },
  });
  if (!asked || store.session !== session) return;
  Object.assign(limitsAsked, asked);
  const batter = asked.control === "Batter Slope";
  const r = attempt("Create Grade Limits from Planar Pad", (s) =>
    s.batch(() => {
      const made: string[] = [];
      for (const o of pads) {
        const pad = modifierOf(s.doc, o);
        if (!pad) continue;
        const under = modelUnder(s.doc, [padCentre(pad.ring)]);
        if (batter && !under) throw new Error(`${o.name ?? "A pad"} isn't on a site model, so there's no ground for its slope to meet`);
        const ring = limitsAround(pad, under?.terrain.existingAt ?? (() => null), { offset: asked.offset, slope: batter ? asked.slope : null, increment: asked.midpoints ? asked.increment : null });
        if (!ring) throw new Error(`the limits around ${o.name ?? "a pad"} would cross themselves: try a smaller offset`);
        made.push(modifierObject(s, o.layerId, ring, { kind: "limits", elevation: 0, useSurface: false, slope: 0, direction: 0 }));
      }
      return made;
    }),
  );
  if (!r) return;
  setSelection(r.value);
  appContext()?.requestDraw();
  toast("Update the site model to take the grade limits in: its Update button in Object Info, or AEC > Terrain > Update Site Model.", "info");
}

export const canMakePad = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && selectedOfKind(doc, "limits").length > 0;
};

/** The slopes kept with a limit, one per side, or null with none (or not for this many sides). */
function keptSlopes(doc: VwxDocument, id: string, sides: number): number[] | null {
  const text = doc.records(id).find((r) => r.name === LIMIT_SLOPES)?.fields.find((f) => f.name === SIDE_SLOPES)?.value;
  const list = String(text ?? "").split(/\s+/).filter(Boolean).map(Number);
  return list.length === sides && list.every((v) => v > 0) ? list : null;
}

function keepSlopes(s: EditSession, id: string, slopes: readonly number[]): void {
  const format = s.doc.recordFormats().find((f) => f.name === LIMIT_SLOPES)?.format ?? s.createRecordFormat(LIMIT_SLOPES, [{ name: SIDE_SLOPES, kind: "text", value: "" }]);
  if (!s.doc.records(id).some((r) => r.name === LIMIT_SLOPES)) s.attachRecord([id], format);
  s.setRecordField(id, format, SIDE_SLOPES, slopes.map((v) => Math.round(v * 1e5) / 1e5).join(" "));
}

/** A small drawing of a ring with one side picked out, for choosing a side. */
function sideDrawing(ring: readonly Pt[], side: number, canvas: HTMLCanvasElement): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const [w, h] = [canvas.width, canvas.height];
  g.clearRect(0, 0, w, h);
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const k = Math.min((w - 16) / (x1 - x0 || 1), (h - 16) / (y1 - y0 || 1));
  const at = (p: Pt): [number, number] => [w / 2 + (p.x - (x0 + x1) / 2) * k, h / 2 - (p.y - (y0 + y1) / 2) * k];
  g.lineWidth = 1;
  g.strokeStyle = getComputedStyle(canvas).color || "#888";
  g.beginPath();
  ring.forEach((p, i) => (i ? g.lineTo(...at(p)) : g.moveTo(...at(p))));
  g.closePath();
  g.stroke();
  g.lineWidth = 3;
  g.strokeStyle = "#e0533d";
  g.beginPath();
  g.moveTo(...at(ring[side]));
  g.lineTo(...at(ring[(side + 1) % ring.length]));
  g.stroke();
}

const padAsked: { method: SlopeMethod; slope: number } = { method: "Percent", slope: 1 / 3 };

/** AEC > Terrain > Create Planar Pad from Grade Limits. */
export async function padFromGradeLimitsDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const limits = selectedOfKind(session.doc, "limits");
  if (!limits.length) {
    toast("Select one or more closed grade limits first.", "error");
    return;
  }
  const one = limits.length === 1;
  const ring = one ? (modifierOf(session.doc, limits[0])?.ring ?? []) : [];
  const kept = one ? keptSlopes(session.doc, limits[0].id, ring.length) : null;
  const uniform = !kept || kept.every((v) => v === kept[0]);
  const slopes = kept ? [...kept] : ring.map(() => padAsked.slope);
  let method = padAsked.method;
  let side = 0;
  const mode = select(["Uniform", "Per side"], uniform ? "Uniform" : "Per side", "Batter Slope");
  const display = select(SLOPE_METHODS, method, "Data display method");
  const value = textInput(slopeText(kept ? kept[0] : padAsked.slope, method), "Slope");
  const canvas = h("canvas", { cls: "site-side-drawing", attrs: { width: "220", height: "130", "aria-label": "The side chosen" } });
  const sideLabel = h("span", { cls: "menu-dialog-label", text: "" });
  const previous = h("button", { cls: "btn small", text: "Prev", attrs: { type: "button" } });
  const next = h("button", { cls: "btn small", text: "Next", attrs: { type: "button" } });
  const chooser = h("div", { cls: "menu-dialog-field" }, sideLabel, previous, next);
  const refresh = (): void => {
    const per = mode.value === "Per side";
    shown(chooser, per);
    shown(canvas, per);
    if (!per) return;
    sideLabel.textContent = `Side ${side + 1} of ${ring.length}`;
    value.value = slopeText(slopes[side], method);
    sideDrawing(ring, side, canvas);
  };
  /** Takes in what's typed; false when it isn't a slope. */
  const take = (): boolean => {
    const v = readSlope(value.value, method);
    if (v === null) return false;
    if (mode.value === "Per side") slopes[side] = v;
    else slopes.fill(v);
    return true;
  };
  const step = (by: number): void => {
    if (!take()) return;
    side = (side + by + ring.length) % ring.length;
    refresh();
  };
  previous.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  mode.addEventListener("change", () => {
    refresh();
  });
  display.addEventListener("change", () => {
    const v = readSlope(value.value, method);
    method = display.value as SlopeMethod;
    if (v !== null) value.value = slopeText(v, method);
  });
  const asked = await showDialog<{ slopes: number[]; uniform: number; method: SlopeMethod }>({
    title: "Create Planar Pad from Grade Limits",
    okLabel: "OK",
    body: [
      ...(one ? [row("Batter Slope", mode), chooser, canvas] : [h("p", { cls: "muted", text: `With ${limits.length} grade limits selected, the batter slope is the same on every side. Select one to set its sides apart.` })]),
      row("Slope", value),
      row("Data display method", display),
      h("p", { cls: "muted", text: "The pad goes at the height that balances cut and fill inside the limits. A slope too low leaves no room for it." }),
    ],
    check: () => {
      if (!take()) return { error: "Type a slope over zero, and under 90° if it's in degrees.", focus: value };
      return { value: { slopes: [...slopes], uniform: readSlope(value.value, method) as number, method } };
    },
  });
  if (!asked || store.session !== session) return;
  padAsked.method = asked.method;
  padAsked.slope = asked.uniform;
  const figures: { cut: number; fill: number }[] = [];
  const r = attempt("Create Planar Pad from Grade Limits", (s) =>
    s.batch(() => {
      const made: string[] = [];
      for (const o of limits) {
        const limit = modifierOf(s.doc, o);
        if (!limit) continue;
        const under = modelUnder(s.doc, limit.ring);
        if (!under) throw new Error(`${o.name ?? "A grade limit"} has to be all inside a site model`);
        const sides = one ? asked.slopes : limit.ring.map(() => asked.uniform);
        const pad = balancedPad(limit.ring, under.terrain.existingAt, sides, modifierStep(under.terrain.existing));
        if (pad === "outside") throw new Error(`${o.name ?? "A grade limit"} has to be all inside a site model`);
        if (pad === "too low") throw new Error(`the batter slope is too low for ${o.name ?? "that grade limit"}: it leaves no room for a pad that balances cut and fill, so make it steeper`);
        keepSlopes(s, o.id, sides);
        made.push(modifierObject(s, o.layerId, pad.ring, { kind: "pad", elevation: pad.elevation, useSurface: false, slope: 0, direction: 0 }));
        figures.push(pad);
      }
      return made;
    }),
  );
  if (!r) return;
  setSelection(r.value);
  appContext()?.requestDraw();
  const units = session.doc.info.units;
  const [cut, fill] = [figures.reduce((sum, f) => sum + f.cut, 0), figures.reduce((sum, f) => sum + f.fill, 0)];
  toast(`Planar pad made: about ${formatVolume(cut, units)} of cut and ${formatVolume(fill, units)} of fill. Update the site model to take it in.`, "info");
}

export const canMakeSection = (): boolean => {
  const doc = store.session?.doc;
  if (!doc || !modelsIn(doc).length) return false;
  const picked = selectedTop(doc);
  return picked.length === 1 && !!picked[0].shape && picked[0].type !== 86;
};

interface SectionAsked {
  layerId: string;
  grid: boolean;
  gridColour: number;
  existing: boolean;
  existingColour: number;
  proposed: boolean;
  proposedColour: number;
  corners: boolean;
  atInterval: boolean;
  interval: number;
  scale: number;
  magnify: number;
  marginY: number;
  marginX: number;
  legend: boolean;
  legendPoints: number;
  elevations: boolean;
  elevationPoints: number;
  profileMils: number;
  stationMils: number;
}

/** What a line of plan has for a section: its points in order. */
function sectionLine(s: EditSession, o: ObjectInfo): Pt[] | null {
  const curve = s.curvePoints(o.id);
  if (!curve || curve.points.length < 2) return null;
  const line = curve.points.map((p): Pt => ({ x: p[0], y: p[1] }));
  if (curve.closed) line.push(line[0]);
  return line;
}

/** The section as parts on a layer, below the site; the id of their group. */
function drawSection(s: EditSession, a: SectionAsked, line: readonly Pt[], t: Terrain, classIndex: number): string {
  const units = s.doc.info.units;
  const paper = layerScaleOf(a.layerId);
  const kx = paper / a.scale;
  const ky = kx * a.magnify;
  const [mx, my] = [a.marginX * paper, a.marginY * paper];
  const existing = a.existing ? sectionProfile(line, t.existingAt) : [];
  const proposed = a.proposed ? sectionProfile(line, t.proposedAt) : [];
  const heights = [...existing, ...proposed].map((p) => p.z).filter((z): z is number => z !== null);
  if (!heights.length) throw new Error("that line has none of the site model's surface under it");
  const total = stationsOf(line).at(-1) as number;
  const unit = parseLength("1", units) || 1000;
  const interval = niceInterval(Math.max(...heights) - Math.min(...heights) || unit, unit);
  const zLow = Math.floor(Math.min(...heights) / interval) * interval;
  const zHigh = Math.max(Math.ceil(Math.max(...heights) / interval) * interval, zLow + interval);
  const box = boxOf(t.existing);
  const [wide, tall] = [total * kx + mx * 2, (zHigh - zLow) * ky + my * 2];
  const legendHeight = a.legendPoints * POINT * paper;
  const small = a.elevationPoints * POINT * paper;
  const gap = Math.max(box.y1 - box.y0, tall) * 0.08 + small * 2;
  const x0 = box.x0;
  const y0 = box.y0 - gap - tall;
  const xOf = (station: number): number => x0 + mx + station * kx;
  const yOf = (z: number): number => y0 + my + (z - zLow) * ky;
  const shapes: NewShape[] = [];
  const looks: Look[] = [];
  const add = (shape: NewShape, look: Look): void => {
    shapes.push(shape);
    looks.push(look);
  };
  const thin = (colour: number): Look => pen(colour, a.stationMils);
  const text = (at: Pt, value: string, height: number, colour: number, hAlign: number, vAlign: number, angle = 0): void =>
    add({ kind: "text", at, text: value, height, hAlign, vAlign, angle } as NewShape, { fillPattern: 0, penFore: colour });
  const black = nearColour(s.doc)("#000000");
  const stations = sectionStations(line, a.corners, a.atInterval ? a.interval : null);
  const frame: Pt[] = [{ x: x0, y: y0 }, { x: x0 + wide, y: y0 }, { x: x0 + wide, y: y0 + tall }, { x: x0, y: y0 + tall }];
  add({ kind: "polygon", points: frame, closed: true }, pen(black, a.stationMils));
  if (a.grid) {
    for (let z = zLow; z <= zHigh + 1e-6; z += interval) add({ kind: "line", a: { x: x0, y: yOf(z) }, b: { x: x0 + wide, y: yOf(z) } } as NewShape, thin(a.gridColour));
    for (const d of stations) add({ kind: "line", a: { x: xOf(d), y: y0 }, b: { x: xOf(d), y: y0 + tall } } as NewShape, thin(a.gridColour));
  }
  for (let z = zLow; z <= zHigh + 1e-6; z += interval) text({ x: x0 - small / 2, y: yOf(z) }, formatLength(z, units), small, black, 3, 3);
  // upright, unless each has the room to lie flat
  const labels = stations.map((d) => formatLength(d, units));
  const room = Math.min(...stations.slice(1).map((d, i) => (d - stations[i]) * kx), wide);
  const flat = Math.max(...labels.map((l) => l.length)) * small * 0.62 < room * 0.9;
  stations.forEach((d, i) => (flat ? text({ x: xOf(d), y: y0 - small / 2 }, labels[i], small, black, 2, 1) : text({ x: xOf(d), y: y0 - small / 2 }, labels[i], small, black, 3, 3, 90)));
  const curve = (profile: readonly { station: number; z: number | null }[], colour: number): void => {
    let run: Pt[] = [];
    const flush = (): void => {
      if (run.length > 1) add({ kind: "polygon", points: run, closed: false }, pen(colour, a.profileMils));
      run = [];
    };
    for (const p of profile) {
      if (p.z === null) flush();
      else run.push({ x: xOf(p.station), y: yOf(p.z) });
    }
    flush();
  };
  if (a.existing) curve(existing, a.existingColour);
  if (a.proposed) curve(proposed, a.proposedColour);
  if (a.elevations) {
    const write = (at: HeightAt, colour: number, side: number): void => {
      for (const d of stations) {
        const p = pointAtStation(line, d);
        const z = at(p.x, p.y);
        if (z !== null) text({ x: xOf(d) + (side * small) / 2, y: yOf(z) + small / 2 }, formatLength(z, units), small, colour, 1, 3, 90);
      }
    };
    if (a.existing) write(t.existingAt, a.existingColour, -1);
    if (a.proposed) write(t.proposedAt, a.proposedColour, 1);
  }
  if (a.legend) {
    const rows: [string, number][] = [];
    if (a.existing) rows.push(["Existing Site Profile", a.existingColour]);
    if (a.proposed) rows.push(["Proposed Site Profile", a.proposedColour]);
    rows.forEach(([value, colour], i) => text({ x: x0, y: y0 + tall + legendHeight * (0.5 + 1.4 * (rows.length - 1 - i)) }, value, legendHeight, colour, 1, 5));
  }
  const ids = s.addObjects(a.layerId, shapes, classIndex, looks);
  const group = s.groupObjects(ids);
  s.setObjectName(group, uniqueName(s.doc, "Site Model Section", group));
  return group;
}

const sectionAsked: Partial<SectionAsked> = {};

/** AEC > Terrain > Site Model Section. */
export async function siteModelSectionDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = session.doc;
  const picked = selectedTop(doc)[0];
  const line = picked ? sectionLine(session, picked) : null;
  if (!picked || !line) {
    toast("Select a 2D polygon or polyline along the section first.", "error");
    return;
  }
  const under = modelUnder(doc, line);
  if (!under) {
    toast("Every vertex of the line has to be on a site model's surface.", "error");
    return;
  }
  const units = doc.info.units;
  const colour = nearColour(doc);
  const was = sectionAsked;
  const layers = doc.layers().filter((l) => l.kind === "design");
  const layer = select(layers.map((l) => l.name), layers.find((l) => l.id === store.activeLayerId)?.name ?? layers[0].name, "Create section on layer");
  const total = stationsOf(line).at(-1) as number;
  const scaleNow = layerScaleOf(store.activeLayerId ?? under.model.layerId);
  const grid = checkbox("Draw Background Grid", was.grid ?? true);
  const gridColour = swatch(doc, "Grid colour", was.gridColour ?? colour("#c0c0c0"));
  const existing = checkbox("Draw Existing Site Profile", was.existing ?? true);
  const existingColour = swatch(doc, "Existing profile colour", was.existingColour ?? colour("#8a5a36"));
  const proposed = checkbox("Draw Proposed Site Profile", was.proposed ?? true);
  const proposedColour = swatch(doc, "Proposed profile colour", was.proposedColour ?? colour("#2e8b3d"));
  const corners = checkbox("Draw points at polygon vertices", was.corners ?? true);
  const atInterval = checkbox("Draw points at interval", was.atInterval ?? true);
  const interval = textInput(formatLengthValue(niceInterval(total, parseLength("1", units) || 1000), units), "Interval");
  const scale = textInput(String(scaleNow), "Display Scale Factor");
  const magnify = textInput(String(was.magnify ?? 1), "Vertical Magnification Factor");
  const marginY = textInput(formatLengthValue(was.marginY ?? 12.7, units), "Vertical Margin");
  const marginX = textInput(formatLengthValue(was.marginX ?? 12.7, units), "Horizontal Margin");
  const legend = checkbox("Draw Legend Text", was.legend ?? true);
  const legendPoints = textInput(String(was.legendPoints ?? 12), "Legend point size");
  const elevations = checkbox("Draw Elevations", was.elevations ?? true);
  const elevationPoints = textInput(String(was.elevationPoints ?? 8), "Elevation point size");
  const profileMils = textInput(String(was.profileMils ?? 14), "Profile Line Weight");
  const stationMils = textInput(String(was.stationMils ?? 2), "Station Line Weight");
  const colourRow = (c: { row: HTMLElement }, s: { el: HTMLElement }): HTMLElement => h("div", { cls: "site-colour-row" }, c.row, s.el);
  const number = (el: HTMLInputElement, min: number): number | null => {
    const v = Number(el.value);
    return el.value.trim() !== "" && Number.isFinite(v) && v >= min ? v : null;
  };
  const asked = await showDialog<SectionAsked>({
    title: "Create Site Model Section",
    okLabel: "OK",
    cls: "site-section-dialog",
    body: [
      row("Create section on layer", layer),
      colourRow(grid, gridColour),
      colourRow(existing, existingColour),
      colourRow(proposed, proposedColour),
      heading("Station Points"),
      corners.row,
      atInterval.row,
      row("Interval", interval),
      heading("Formatting"),
      row("Display Scale Factor", scale, "1:"),
      row("Vertical Magnification Factor", magnify),
      row("Vertical Margin", marginY, "on paper"),
      row("Horizontal Margin", marginX, "on paper"),
      legend.row,
      row("Legend point size", legendPoints),
      elevations.row,
      row("Elevation point size", elevationPoints),
      row("Profile Line Weight", profileMils, "mils"),
      row("Station Line Weight", stationMils, "mils"),
      h("p", { cls: "muted", text: "If the site model changes, make the section again." }),
    ],
    check: () => {
      if (!existing.input.checked && !proposed.input.checked) return { error: "Choose a profile to draw." };
      const every = parseLength(interval.value, units);
      if (atInterval.input.checked && (every === null || every <= 0)) return { error: "Type an interval over zero.", focus: interval };
      if (atInterval.input.checked && (every as number) < total / 2000) return { error: "That interval makes too many stations for this line.", focus: interval };
      const sc = number(scale, 1e-6);
      if (sc === null || sc === 0) return { error: "Type a scale factor over zero.", focus: scale };
      const mag = number(magnify, 1e-6);
      if (mag === null) return { error: "Type a magnification over zero.", focus: magnify };
      const my = parseLength(marginY.value, units);
      if (my === null || my < 0) return { error: "Type a margin of zero or more.", focus: marginY };
      const mx = parseLength(marginX.value, units);
      if (mx === null || mx < 0) return { error: "Type a margin of zero or more.", focus: marginX };
      const lp = number(legendPoints, 1);
      if (lp === null) return { error: "Type a point size of 1 or more.", focus: legendPoints };
      const ep = number(elevationPoints, 1);
      if (ep === null) return { error: "Type a point size of 1 or more.", focus: elevationPoints };
      const pm = number(profileMils, 1);
      if (pm === null) return { error: "Type a line weight of 1 or more.", focus: profileMils };
      const sm = number(stationMils, 1);
      if (sm === null) return { error: "Type a line weight of 1 or more.", focus: stationMils };
      return {
        value: {
          layerId: layers.find((l) => l.name === layer.value)?.id ?? layers[0].id,
          grid: grid.input.checked,
          gridColour: gridColour.get(),
          existing: existing.input.checked,
          existingColour: existingColour.get(),
          proposed: proposed.input.checked,
          proposedColour: proposedColour.get(),
          corners: corners.input.checked,
          atInterval: atInterval.input.checked,
          interval: every ?? 0,
          scale: sc,
          magnify: mag,
          marginY: my,
          marginX: mx,
          legend: legend.input.checked,
          legendPoints: lp,
          elevations: elevations.input.checked,
          elevationPoints: ep,
          profileMils: pm,
          stationMils: sm,
        },
      };
    },
  });
  if (!asked || store.session !== session) return;
  Object.assign(sectionAsked, asked);
  const r = attempt("Site Model Section", (s) => s.batch(() => drawSection(s, asked, line, under.terrain, store.activeClassIndex)));
  if (!r) return;
  if (asked.layerId !== store.activeLayerId) setActiveLayer(asked.layerId);
  setSelection([r.value]);
  const A = appContext();
  if (A) {
    zoomToSelection(A.scene, A.view);
    A.requestDraw();
  }
}

export const canListVolumes = (): boolean => {
  const doc = store.session?.doc;
  if (!doc) return false;
  const models = modelsIn(doc);
  return models.filter((m) => store.selection.has(m.id)).length === 1;
};

type ColumnKind = "index" | "area" | "volume";

interface Column {
  readonly label: string;
  readonly kind: ColumnKind;
  of(r: TriangleFigures): number;
}

const COLUMNS: readonly Column[] = [
  { label: "Triangle Index", kind: "index", of: (r) => r.index },
  { label: "Existing Surface Area", kind: "area", of: (r) => r.existingArea },
  { label: "Proposed Surface Area", kind: "area", of: (r) => r.proposedArea },
  { label: "Projected Area", kind: "area", of: (r) => r.projected },
  { label: "Existing Volume", kind: "volume", of: (r) => r.existingVolume },
  { label: "Proposed Volume", kind: "volume", of: (r) => r.proposedVolume },
  { label: "Cut Volume", kind: "volume", of: (r) => r.cut },
  { label: "Fill Volume", kind: "volume", of: (r) => r.fill },
  { label: "Net Cut & Fill Volume", kind: "volume", of: (r) => r.fill - r.cut },
  { label: "Total Cut & Fill Volume", kind: "volume", of: (r) => r.fill + r.cut },
];

/** A list's figure as it reads, with its unit in the heading's place: "12.3 m²" comes apart into 12.3 and "m²". */
function asNumber(c: Column, value: number, units: string | undefined): { number: number; unit: string } {
  if (c.kind === "index") return { number: value, unit: "" };
  const unit = (c.kind === "area" ? formatArea(1e12, units) : formatVolume(1e15, units)).replace(/^[^ ]+ /, "");
  const per = c.kind === "area" ? 1e12 / Number(formatArea(1e12, units).split(" ")[0].replace(/,/g, "")) : 1e15 / Number(formatVolume(1e15, units).split(" ")[0].replace(/,/g, ""));
  return { number: Math.round((value / per) * 1000) / 1000, unit };
}

interface VolumeAsked {
  columns: Column[];
  limits: string[];
  outside: boolean;
  unmodified: boolean;
  textFile: boolean;
  group: boolean;
  sheet: boolean;
}

const volumeAsked: Partial<Pick<VolumeAsked, "unmodified" | "textFile" | "group" | "sheet">> & { labels?: readonly string[] } = {};

/** AEC > Terrain > Create Site Model Volume List. */
export async function siteVolumeListDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = session.doc;
  const model = modelsIn(doc).filter((m) => store.selection.has(m.id));
  if (model.length !== 1) {
    toast("Select one site model first.", "error");
    return;
  }
  const units = doc.info.units;
  const limits = doc.layers().filter((l) => l.kind === "design").flatMap((l) => doc.objects(l.id).filter((o) => modifierOf(doc, o)?.kind === "limits"));
  const canSheet = doc.resources().some((r) => r.kind === "worksheet");
  const columnBoxes = COLUMNS.map((c) => ({ c, box: checkbox(c.label, volumeAsked.labels?.includes(c.label) ?? true) }));
  const outside = checkbox("Outside Grade Limits", true);
  const A = appContext();
  const limitBoxes = limits.map((o, i) => {
    const box = checkbox(`Grade Limits Modifier ${i + 1}${o.name ? ` (${o.name})` : ""}`, true);
    const show = h("button", { cls: "btn small", text: "Show Modifier", attrs: { type: "button" } });
    show.addEventListener("click", () => {
      setSelection([o.id]);
      if (A) {
        zoomToSelection(A.scene, A.view);
        A.requestDraw();
      }
    });
    return { o, box, row: h("div", { cls: "site-colour-row" }, box.row, show) };
  });
  const unmodified = checkbox("Show Data for Unmodified Site Model Surface", volumeAsked.unmodified ?? true);
  const textFile = checkbox("Create Text File", volumeAsked.textFile ?? !canSheet);
  const group = checkbox("Create Triangle Group", volumeAsked.group ?? false);
  const sheet = checkbox("Create Worksheet", canSheet && (volumeAsked.sheet ?? true));
  sheet.input.disabled = !canSheet;
  const asked = await showDialog<VolumeAsked>({
    title: "Create Site Model Volume List",
    okLabel: "OK",
    cls: "site-section-dialog",
    body: [
      heading("Columns"),
      ...columnBoxes.map((b) => b.box.row),
      heading("Grade Limits Modifiers"),
      outside.row,
      ...limitBoxes.map((b) => b.row),
      heading("Options"),
      unmodified.row,
      textFile.row,
      group.row,
      sheet.row,
      ...(canSheet ? [] : [h("p", { cls: "muted", text: "This drawing has no worksheet to take a new one's settings from, so it can't make one. The text file opens in a spreadsheet." })]),
    ],
    check: () => {
      const columns = columnBoxes.filter((b) => b.box.input.checked).map((b) => b.c);
      if (!columns.length) return { error: "Choose a column to list." };
      if (!textFile.input.checked && !group.input.checked && !sheet.input.checked) return { error: "Choose how to make the list: a text file, a triangle group or a worksheet." };
      if (!outside.input.checked && !limitBoxes.some((b) => b.box.input.checked)) return { error: "Choose where to list: outside the grade limits, or inside one." };
      return {
        value: {
          columns,
          limits: limitBoxes.filter((b) => b.box.input.checked).map((b) => b.o.id),
          outside: outside.input.checked,
          unmodified: unmodified.input.checked,
          textFile: textFile.input.checked,
          group: group.input.checked,
          sheet: sheet.input.checked,
        },
      };
    },
  });
  if (!asked || store.session !== session) return;
  Object.assign(volumeAsked, { unmodified: asked.unmodified, textFile: asked.textFile, group: asked.group, sheet: asked.sheet, labels: asked.columns.map((c) => c.label) });
  setSelection([model[0].id]);
  try {
    const t = terrainOf(model[0]);
    const rings = limits.map((o) => ({ id: o.id, ring: closedOutline(o.shape as NonNullable<ObjectInfo["shape"]>) ?? [] }));
    const wanted = new Set(asked.limits);
    const rows = triangleFigures(t.proposed, t.existingAt, datumOf(model[0])).filter((r) => {
      if (!asked.unmodified && r.cut + r.fill < r.projected * UNMODIFIED) return false;
      const inside = rings.find((l) => pointInPolygon(r.centre, l.ring));
      return inside ? wanted.has(inside.id) : asked.outside;
    });
    if (!rows.length) {
      toast("No triangles of the site model are in what you chose.", "error");
      return;
    }
    makeVolumeList(rows, asked, model[0], units);
  } catch (err) {
    toast(`Create Site Model Volume List failed: ${errorMessage(err)}`, "error");
  }
}

function makeVolumeList(rows: readonly TriangleFigures[], asked: VolumeAsked, model: Model, units: string | undefined): void {
  const heads = asked.columns.map((c) => {
    const { unit } = asNumber(c, 0, units);
    return unit ? `${c.label} (${unit})` : c.label;
  });
  const totals = asked.columns.map((c) => (c.kind === "index" ? null : rows.reduce((sum, r) => sum + c.of(r), 0)));
  const figures = (values: readonly (number | null)[]): (number | null)[] => values.map((v, i) => (v === null ? null : asNumber(asked.columns[i], v, units).number));
  if (asked.textFile) {
    const lines = [heads.join("\t"), ...rows.map((r) => figures(asked.columns.map((c) => c.of(r))).join("\t")), ["Total", ...figures(totals).slice(1)].join("\t")];
    downloadBlob("Site Model Volume List.txt", new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/plain" }));
  }
  if (asked.sheet) {
    if (rows.length > MAX_SHEET_ROWS) toast(`That's ${rows.length} triangles, more than a worksheet is made with here (${MAX_SHEET_ROWS}): the text file takes any number.`, "error");
    else {
      const doc = store.session?.doc;
      const was = doc?.resources().find((r) => r.kind === "worksheet" && r.name === "Volume List");
      const made = attempt("Create Site Model Volume List", (s) =>
        s.batch(() => {
          if (was) s.deleteWorksheet(was.index);
          const cells: (NewSheetCell | null)[][] = [
            heads.map((value): NewSheetCell => ({ value, bold: true, align: "center" })),
            ...rows.map((r) => figures(asked.columns.map((c) => c.of(r))).map((value): NewSheetCell | null => (value === null ? null : { value }))),
            figures(totals).map((value, i): NewSheetCell | null => (value === null ? (i === 0 ? { value: "Total", bold: true } : null) : { value, bold: true })),
          ];
          return s.createWorksheet({ name: "Volume List", widths: heads.map(() => 100), rowHeight: 14, rows: cells });
        }),
      );
      if (made) void editWorksheet(made.value);
    }
  }
  if (asked.group) {
    if (rows.length > MAX_GROUP_TRIANGLES) toast(`That's ${rows.length} triangles, more than a triangle group is made with here (${MAX_GROUP_TRIANGLES}): narrow the list or use the text file.`, "error");
    else {
      const made = attempt("Create Site Model Volume List", (s) =>
        s.batch(() => {
          const height = 2 * layerScaleOf(model.layerId);
          const shapes: NewShape[] = [];
          const looks: Look[] = [];
          const line = pen(nearColour(s.doc)("#808080"), 2);
          for (const r of rows) {
            shapes.push({ kind: "polygon", points: r.corners.map((p): Pt => ({ x: p[0], y: p[1] })), closed: true });
            looks.push(line);
            const text = asked.columns
              .map((c, i) => {
                const { number, unit } = asNumber(c, c.of(r), units);
                return c.kind === "index" ? `#${number}` : `${heads[i].replace(/ \(.*$/, "")}: ${number} ${unit}`;
              })
              .join("\r");
            shapes.push({ kind: "text", at: r.centre, text, height, hAlign: 2, vAlign: 3 } as NewShape);
            looks.push({ fillPattern: 0 });
          }
          const ids = s.addObjects(model.layerId, shapes, s.doc.object(model.id)?.classIndex ?? store.activeClassIndex, looks);
          const pairs = rows.map((_, i) => [ids[i * 2], ids[i * 2 + 1]]);
          const group = s.groupObjects(s.groupEach(pairs));
          s.setObjectName(group, uniqueName(s.doc, "Site Model Volume List", group));
          return group;
        }),
      );
      if (made) setSelection([made.value]);
    }
  }
  appContext()?.requestDraw();
  const net = rows.reduce((sum, r) => sum + r.fill - r.cut, 0);
  const cut = rows.reduce((sum, r) => sum + r.cut, 0);
  const fill = rows.reduce((sum, r) => sum + r.fill, 0);
  toast(`${rows.length} triangles: ${formatVolume(cut, units)} of cut, ${formatVolume(fill, units)} of fill, ${formatVolume(Math.abs(net), units)} net ${net > 0 ? "fill" : "cut"}.`, "info");
}

const modifiersClass = (doc: VwxDocument) => doc.classes().find((c) => c.name === MODIFIER_CLASS);

export const hasSiteModifiers = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && !!modifiersClass(doc);
};

export const siteModifiersShown = (): boolean => {
  const doc = store.session?.doc;
  const c = doc ? modifiersClass(doc) : null;
  return !!c && c.visibility === "visible";
};

/** View > Show or Hide Site Modifiers: their class, on or off; what they've done to the proposed surface stays. */
export function toggleSiteModifiers(): void {
  const doc = store.session?.doc;
  const c = doc ? modifiersClass(doc) : null;
  if (!c) return;
  const hiding = c.visibility === "visible";
  attempt(hiding ? "Hide Site Modifiers" : "Show Site Modifiers", (s) => s.setClassVisibility(c.index, hiding ? "hidden" : "visible"));
  if (hiding && doc) setSelection([...store.selection].filter((id) => doc.object(id)?.classIndex !== c.index));
  appContext()?.requestDraw();
}
