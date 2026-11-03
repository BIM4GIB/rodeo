// The Site Modifiers tool's Pathway and Boundary paths. A pathway is a centre line with a width; a boundary is a closed
// outline, its centre line worked out from it (sitePathShapes.ts). One longitudinal profile sets the heights along the
// centre line and any number of transverse profiles change them across it; a site model takes the result as source
// points when it's updated. It's a plug-in with Rodeo's own name, placed at its first point: Reshape moves its corners,
// and the profiles are edited as tables of figures, where Vectorworks has a profile editing mode.

import "./sitePath.css";
import type { Attributes, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { registerModifierSource, registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import { slopeLabel } from "./gradeShapes.ts";
import { showDialog } from "./menubar.ts";
import { placeAtNextClick } from "./placeAt.ts";
import { modelsIn, modifierClass, nearColour, pen, surfaceHeightAt, terrainOf, updateSiteModels } from "./siteModel.ts";
import type { Pt3, SiteModifier } from "./siteModelShapes.ts";
import {
  boundarySections,
  fittedProfile,
  gridFaces,
  halves,
  pathGrid,
  pathOutline,
  pathwaySections,
  profileBreaks,
  profileHeight,
  realigned,
  scaledCrosses,
  scaledProfile,
  sectionAt,
  sectionSpacing,
  sectionsLength,
  stationOf,
  type CrossPoint,
  type CrossProfile,
  type ProfilePoint,
  type Section,
} from "./sitePathShapes.ts";
import { layerScaleOf } from "./spaces.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { formatLength, formatLengthValue, parseLength } from "./units.ts";

export const PATH_MODIFIER = "Rodeo Path Modifier";

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  config: "Configuration",
  apply: "Apply To",
  width: "Width",
  show3d: "Show the surface in 3D",
  start: "Start Elevation",
  end: "End Elevation",
  slope: "Slope",
  showLine: "Show profile line",
  showNames: "Show profile names",
  showSlopes: "Show slopes",
  arrow: "Arrow indicates downward",
  showElevation: "Show vertex elevation",
  textPoints: "Text Size",
  profile: "Profile",
  /** kept out of Object Info */
  path: "Path Points",
  long: "Longitudinal Data",
  cross: "Transverse Data",
  index: "Selected Profile Index",
} as const;

export type PathConfiguration = "Pathway" | "Boundary";
const CONFIGURATIONS: readonly PathConfiguration[] = ["Pathway", "Boundary"];
const APPLY = ["Proposed site model", "Existing site model"] as const;
const COLOUR = "#1f8f96";
const HIGHLIGHT = "#d0432f";

type Look = Partial<Attributes>;

interface PathObject {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function pathOf(doc: VwxDocument, id: string, layerId: string): PathObject | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === PATH_MODIFIER);
  return rec ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

const pathById = (doc: VwxDocument, id: string): PathObject | null => {
  const layerId = doc.object(id)?.layerId;
  return layerId ? pathOf(doc, id, layerId) : null;
};

const data = <T,>(p: PathObject, field: string): T[] => {
  try {
    const parsed: unknown = JSON.parse(String(p.value(field) || "[]"));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
};

const cornersOf = (p: PathObject): Pt[] => data<Pt>(p, FIELD.path);
const profileOf = (p: PathObject): ProfilePoint[] => data<ProfilePoint>(p, FIELD.long);
const crossesOf = (p: PathObject): CrossProfile[] => data<CrossProfile>(p, FIELD.cross);

function sectionsFrom(config: unknown, corners: readonly Pt[], width: number): Section[] {
  return config === "Boundary" ? boundarySections(corners) : pathwaySections(corners, width);
}

const sectionsOf = (p: PathObject): Section[] => sectionsFrom(p.value(FIELD.config), cornersOf(p), Number(p.value(FIELD.width)) || 0);

/** From the plug-in's own frame to the drawing, as it's placed now. */
function placeOf(o: ObjectInfo): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt } {
  const at = o.insertion ?? { x: 0, y: 0 };
  const turn = ((o.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
  };
}

const tenth = (v: number): number => Math.round(v * 10) / 10;

// a site model reads them as it's updated
registerModifierSource((doc, modelLayer, scope): SiteModifier[] => {
  if (!doc.hasPluginFormat(PATH_MODIFIER)) return [];
  const out: SiteModifier[] = [];
  for (const layer of doc.layers()) {
    if (scope === "Same Layer as Site Model only" && layer.id !== modelLayer) continue;
    if (scope === "Visible Layers Only" && layer.visibility !== "visible") continue;
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const p = pathOf(doc, o.id, layer.id);
      if (!p) continue;
      const sections = sectionsOf(p);
      if (sections.length < 2) continue;
      const { toWorld } = placeOf(o);
      const samples = pathGrid(sections, profileOf(p), crossesOf(p)).flat().map((q): Pt3 => {
        const w = toWorld({ x: q[0], y: q[1] });
        return [tenth(w.x), tenth(w.y), tenth(q[2])];
      });
      out.push({
        kind: "path",
        ring: pathOutline(sections).map(toWorld).map((q) => ({ x: tenth(q.x), y: tenth(q.y) })),
        elevation: 0,
        slope: 0,
        slopeAngle: 0,
        samples,
        ...(p.value(FIELD.apply) === APPLY[1] ? { existing: true } : {}),
      });
    }
  }
  return out;
});

/** The plug-in's plan drawing, in its own frame. */
function plan(s: EditSession, p: PathObject): { shapes: NewShape[]; looks: Look[] } {
  const units = s.doc.info.units;
  const sections = sectionsOf(p);
  const profile = profileOf(p);
  const crosses = crossesOf(p);
  const colour = nearColour(s.doc);
  const main = colour(COLOUR);
  const textPoints = Number(p.value(FIELD.textPoints)) || 8;
  const textHeight = textPoints * (25.4 / 72) * layerScaleOf(p.layerId);
  const turned = s.pluginAngle(p.id);
  const shapes: NewShape[] = [];
  const looks: Look[] = [];
  const add = (shape: NewShape, look: Look): void => {
    shapes.push(shape);
    looks.push(look);
  };
  const upright = (deg: number): number => {
    const world = (((deg + turned + 180) % 360) + 360) % 360 - 180;
    return world > 90 || world <= -90 ? deg + 180 : deg;
  };
  const text = (at: Pt, value: string, angle: number, colourIndex = main): void => add({ kind: "text", at, text: value, height: textHeight, hAlign: 2, vAlign: 3, angle: upright(angle) } as NewShape, { fillPattern: 0, penFore: colourIndex });
  const directionAt = (at: number): { x: number; y: number } => {
    const [a, b] = [sectionAt(sections, Math.max(0, at - 1)).c, sectionAt(sections, Math.min(sectionsLength(sections), at + 1)).c];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  };
  add({ kind: "polygon", points: pathOutline(sections), closed: true } as NewShape, pen(main, 7));
  if (p.value(FIELD.showLine) === true) {
    const dashed = s.doc.lineTypes().find((x) => x.dashes.length > 0)?.style;
    add({ kind: "polygon", points: sections.map((x) => x.c), closed: false } as NewShape, pen(main, 5, dashed ?? 2));
    const labelled = profileBreaks(profile, textHeight * 8);
    for (let i = 0; i < labelled.length; i++) {
      const point = labelled[i];
      const here = sectionAt(sections, point.at);
      const d = directionAt(point.at);
      const angle = (Math.atan2(d.y, d.x) * 180) / Math.PI;
      const up = textHeight * 0.9;
      if (p.value(FIELD.showElevation) === true) text({ x: here.c.x - d.y * up, y: here.c.y + d.x * up }, formatLength(point.z, units), angle);
      const next = labelled[i + 1];
      if (!next || next.at <= point.at) continue;
      const midAt = (point.at + next.at) / 2;
      const mid = sectionAt(sections, midAt);
      const m = directionAt(midAt);
      const midAngle = (Math.atan2(m.y, m.x) * 180) / Math.PI;
      if (p.value(FIELD.showSlopes) === true) text({ x: mid.c.x - m.y * up, y: mid.c.y + m.x * up }, slopeLabel(Math.abs(next.z - point.z) / (next.at - point.at), "Percent", 2), midAngle);
      if (p.value(FIELD.showSlopes) === true && p.value(FIELD.arrow) === true && next.z !== point.z) {
        // along the line, its head at the low end
        const way = next.z < point.z ? 1 : -1;
        const half = textHeight * 1.5;
        const [from, to] = [{ x: mid.c.x - m.x * way * half + m.y * up, y: mid.c.y - m.y * way * half - m.x * up }, { x: mid.c.x + m.x * way * half + m.y * up, y: mid.c.y + m.y * way * half - m.x * up }];
        const head = textHeight * 0.6;
        add({ kind: "line", a: from, b: to } as NewShape, pen(main, 5));
        add({ kind: "polygon", points: [to, { x: to.x - m.x * way * head - m.y * head * 0.4, y: to.y - m.y * way * head + m.x * head * 0.4 }, { x: to.x - m.x * way * head + m.y * head * 0.4, y: to.y - m.y * way * head - m.x * head * 0.4 }], closed: true } as NewShape, { ...store.drawAttrs, fillPattern: 1, fillFore: main, fillBack: main, fillOpacity: 100, lineStyle: 0 });
      }
    }
  }
  const selected = Number(p.value(FIELD.index)) || 0;
  crosses.forEach((c, i) => {
    const here = sectionAt(sections, c.at);
    const look = i === selected ? colour(HIGHLIGHT) : main;
    add({ kind: "line", a: here.left, b: here.right } as NewShape, pen(look, i === selected ? 10 : 5));
    const [dx, dy] = [here.left.x - here.right.x, here.left.y - here.right.y];
    const len = Math.hypot(dx, dy) || 1;
    const [ux, uy] = [dx / len, dy / len];
    const angle = (Math.atan2(uy, ux) * 180) / Math.PI;
    if (p.value(FIELD.showNames) === true) text({ x: here.left.x + ux * textHeight, y: here.left.y + uy * textHeight }, c.name, angle, look);
    const sorted = [...c.points].sort((a, b) => a.off - b.off);
    const z = profileHeight(profile, c.at);
    if (p.value(FIELD.showElevation) === true) {
      for (const q of sorted) text({ x: here.c.x + ux * q.off - uy * textHeight * 0.9, y: here.c.y + uy * q.off + ux * textHeight * 0.9 }, formatLength(z + q.rise, units), angle, look);
    }
    if (p.value(FIELD.showSlopes) === true) {
      for (let k = 0; k + 1 < sorted.length; k++) {
        const [a, b] = [sorted[k], sorted[k + 1]];
        if (b.off <= a.off) continue;
        const off = (a.off + b.off) / 2;
        text({ x: here.c.x + ux * off + uy * textHeight * 0.9, y: here.c.y + uy * off - ux * textHeight * 0.9 }, slopeLabel(Math.abs(b.rise - a.rise) / (b.off - a.off), "Percent", 2), angle, look);
      }
    }
  });
  return { shapes, looks };
}

/** Start, End and Slope as the profile has them, and the chosen profile's name. */
function setFigures(s: EditSession, p: PathObject): void {
  const profile = profileOf(p);
  const crosses = crossesOf(p);
  const length = sectionsLength(sectionsOf(p));
  const set = (field: string, value: RecordValue): void => s.setRecordField(p.id, p.format, field, value);
  const [first, last] = [profile[0], profile[profile.length - 1]];
  if (first && last) {
    set(FIELD.start, first.z);
    set(FIELD.end, last.z);
    set(FIELD.slope, length > 0 ? Math.round(((last.z - first.z) / length) * 100000) / 1000 : 0);
  }
  const index = Math.min(crosses.length - 1, Math.max(0, Number(p.value(FIELD.index)) || 0));
  set(FIELD.index, Math.max(0, index));
  set(FIELD.profile, crosses.length ? `${crosses[index].name} (${index + 1} of ${crosses.length})` : "None");
}

function redraw(s: EditSession, id: string): void {
  const first = pathById(s.doc, id);
  if (!first) return;
  setFigures(s, first);
  const p = pathById(s.doc, id) as PathObject;
  const sections = sectionsOf(p);
  if (sections.length < 2) return;
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  const d = plan(s, p);
  const ids = d.shapes.length ? s.addObjects(p.layerId, d.shapes, classIndex, d.looks) : [];
  if (p.value(FIELD.show3d) === true) {
    // the layer's elevation is added as it's made, and a plug-in's drawing is lifted by it again when shown
    // and a little over the ground, which it would otherwise fight with
    const lift = Math.max(sectionsLength(sections) / 500, 10) - (s.doc.layers().find((l) => l.id === p.layerId)?.elevation ?? 0);
    const main = nearColour(s.doc)(COLOUR);
    ids.push(...s.addMeshes(p.layerId, [gridFaces(pathGrid(sections, profileOf(p), crossesOf(p)), lift)], classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: main, fillBack: main, fillOpacity: 100, lineStyle: 0 }));
  }
  s.setPluginDrawing(id, ids);
}

const specsOf = (values: Readonly<Record<string, RecordValue>>): PluginFieldSpec[] => {
  const types: Record<string, number> = {
    [FIELD.config]: POPUP,
    [FIELD.apply]: POPUP,
    [FIELD.width]: DIMENSION,
    [FIELD.show3d]: BOOL,
    [FIELD.start]: DIMENSION,
    [FIELD.end]: DIMENSION,
    [FIELD.slope]: NUMBER,
    [FIELD.showLine]: BOOL,
    [FIELD.showNames]: BOOL,
    [FIELD.showSlopes]: BOOL,
    [FIELD.arrow]: BOOL,
    [FIELD.showElevation]: BOOL,
    [FIELD.textPoints]: NUMBER,
    [FIELD.profile]: TEXT,
    [FIELD.path]: TEXT,
    [FIELD.long]: TEXT,
    [FIELD.cross]: TEXT,
    [FIELD.index]: NUMBER,
  };
  return Object.entries(types).map(([name, type]) => ({ name, type, value: values[name] ?? (type === BOOL ? false : type === NUMBER || type === DIMENSION ? 0 : "") }));
};

export interface PathSettings {
  readonly width: number;
  readonly applyExisting: boolean;
  /** when there's no site model under it */
  readonly elevation: number;
}

/** A new path modifier from its corners, as part of a batch. */
export function addPathModifier(s: EditSession, layerId: string, corners: readonly Pt[], config: PathConfiguration, k: PathSettings): string {
  const at = corners[0];
  const local = corners.map((q) => ({ x: q.x - at.x, y: q.y - at.y }));
  const sections = sectionsFrom(config, local, k.width);
  if (sections.length < 2 || sectionsLength(sections) <= 0) throw new Error("That path has no length.");
  const world = (q: Pt): Pt => ({ x: q.x + at.x, y: q.y + at.y });
  const [first, last] = [sections[0], sections[sections.length - 1]];
  const profile: ProfilePoint[] = [
    { at: 0, z: surfaceHeightAt(s.doc, world(first.c)) ?? k.elevation },
    { at: last.at, z: surfaceHeightAt(s.doc, world(last.c)) ?? k.elevation },
  ];
  const values: Record<string, RecordValue> = {
    [FIELD.config]: config,
    [FIELD.apply]: k.applyExisting ? APPLY[1] : APPLY[0],
    [FIELD.width]: config === "Pathway" ? k.width : 0,
    [FIELD.showLine]: true,
    [FIELD.showNames]: true,
    [FIELD.showSlopes]: true,
    [FIELD.arrow]: true,
    [FIELD.showElevation]: true,
    [FIELD.textPoints]: 8,
    [FIELD.path]: JSON.stringify(local),
    [FIELD.long]: JSON.stringify(profile),
    [FIELD.cross]: "[]",
    [FIELD.profile]: "None",
  };
  const specs = specsOf(values);
  const id = s.addPluginObject(layerId, PATH_MODIFIER, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, modifierClass(s));
  redraw(s, id);
  return id;
}

/** Sets the plug-in's data and draws it again. */
function write(s: EditSession, p: PathObject, fields: Readonly<Record<string, RecordValue>>): void {
  for (const [field, value] of Object.entries(fields)) s.setRecordField(p.id, p.format, field, value);
  redraw(s, p.id);
}

function edit(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Path Modifier", (s) =>
    s.batch(() => {
      const p = pathById(s.doc, id);
      if (!p) throw new Error("That isn't a path modifier.");
      const heights = FIELD.start in values || FIELD.end in values || FIELD.slope in values;
      for (const [field, value] of Object.entries(values)) {
        if (field !== FIELD.start && field !== FIELD.end && field !== FIELD.slope && field !== FIELD.width) s.setRecordField(id, p.format, field, value);
      }
      if (FIELD.width in values) {
        const width = Number(values[FIELD.width]);
        if (!(width > 0)) throw new Error("A path's width has to be over zero.");
        const was = Number(p.value(FIELD.width)) || width;
        s.setRecordField(id, p.format, FIELD.width, width);
        // its transverse profiles keep their shape across it
        const crosses = crossesOf(p).map((c) => ({ ...c, points: c.points.map((q) => ({ off: (q.off * width) / was, rise: q.rise })) }));
        s.setRecordField(id, p.format, FIELD.cross, JSON.stringify(crosses));
      }
      if (heights) {
        const profile = profileOf(p);
        const length = sectionsLength(sectionsOf(p));
        const start = FIELD.start in values ? Number(values[FIELD.start]) : profile[0].z;
        let end = FIELD.end in values ? Number(values[FIELD.end]) : profile[profile.length - 1].z;
        if (FIELD.slope in values) end = start + (Number(values[FIELD.slope]) / 100) * length;
        const last = profile.length - 1;
        s.setRecordField(id, p.format, FIELD.long, JSON.stringify(profile.map((q, i) => (i === 0 ? { at: q.at, z: start } : i === last ? { at: q.at, z: end } : q))));
      }
      redraw(s, id);
    }),
  );
}

// ---- the tables ---------------------------------------------------------------------

interface TableOptions {
  readonly title: string;
  readonly columns: readonly [string, string];
  readonly note: string;
  readonly rows: readonly (readonly [string, string])[];
  /** the first and last rows' first figures stay as they are */
  readonly lockEnds: boolean;
  readonly fewest: number;
  /** a name for the table */
  readonly name?: string;
  /** the rows as they are, or null while one doesn't read */
  plot?(rows: readonly (readonly [string, string])[]): readonly (readonly [number, number])[] | null;
  check(rows: readonly (readonly [string, string])[]): { readonly error: string } | null;
}

/** Draws a table's figures as a little profile. */
function drawPlot(canvas: HTMLCanvasElement, points: readonly (readonly [number, number])[] | null): void {
  const g = canvas.getContext("2d");
  if (!g) return;
  const ratio = globalThis.devicePixelRatio || 1;
  const [w, hi] = [canvas.clientWidth || 360, canvas.clientHeight || 90];
  canvas.width = w * ratio;
  canvas.height = hi * ratio;
  g.scale(ratio, ratio);
  g.clearRect(0, 0, w, hi);
  if (!points || points.length < 2) return;
  const xs = points.map((q) => q[0]);
  const ys = points.map((q) => q[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const px = (x: number): number => 10 + ((x - x0) / (x1 - x0 || 1)) * (w - 20);
  const py = (y: number): number => hi - 10 - ((y - y0) / (y1 - y0 || 1)) * (hi - 20);
  const line = getComputedStyle(canvas).color;
  g.strokeStyle = line;
  g.fillStyle = line;
  g.lineWidth = 1.5;
  g.beginPath();
  points.forEach((q, i) => (i === 0 ? g.moveTo(px(q[0]), py(q[1])) : g.lineTo(px(q[0]), py(q[1]))));
  g.stroke();
  for (const q of points) {
    g.beginPath();
    g.arc(px(q[0]), py(q[1]), 2.5, 0, Math.PI * 2);
    g.fill();
  }
}

async function tableDialog(o: TableOptions): Promise<{ rows: [string, string][]; name: string } | null> {
  const name = h("input", { cls: "menu-dialog-input", value: o.name ?? "", attrs: { "aria-label": "Name" } });
  const tbody = h("tbody");
  const canvas = h("canvas", { cls: "site-path-plot" });
  const rowsNow = (): [string, string][] =>
    [...tbody.querySelectorAll("tr")].map((tr) => {
      const [a, b] = [...tr.querySelectorAll("input")];
      return [a.value, b.value];
    });
  const redrawPlot = (): void => drawPlot(canvas, o.plot?.(rowsNow()) ?? null);
  const addRow = (values: readonly [string, string], locked: boolean, before?: Element | null): void => {
    const first = h("input", { cls: "menu-dialog-input", value: values[0], attrs: { "aria-label": o.columns[0] } });
    first.disabled = locked;
    const second = h("input", { cls: "menu-dialog-input", value: values[1], attrs: { "aria-label": o.columns[1] } });
    const remove = h("button", { cls: "btn small", text: "×", attrs: { type: "button", "aria-label": "Remove" } });
    remove.disabled = locked;
    const tr = h("tr", {}, h("td", {}, first), h("td", {}, second), h("td", {}, remove));
    remove.addEventListener("click", () => {
      if (tbody.children.length <= o.fewest) return;
      tr.remove();
      redrawPlot();
    });
    tbody.insertBefore(tr, before ?? null);
  };
  o.rows.forEach((r, i) => addRow(r, o.lockEnds && (i === 0 || i === o.rows.length - 1)));
  tbody.addEventListener("input", redrawPlot);
  const add = h("button", { cls: "btn small", text: "Add Row", attrs: { type: "button" } });
  add.addEventListener("click", () => {
    addRow(["", ""], false, o.lockEnds ? tbody.lastElementChild : null);
    (tbody.querySelectorAll("tr")[tbody.children.length - (o.lockEnds ? 2 : 1)].querySelector("input") as HTMLInputElement).focus();
  });
  const body: HTMLElement[] = [];
  if (o.name !== undefined) body.push(h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), name));
  if (o.plot) body.push(canvas);
  body.push(
    h("div", { cls: "site-path-scroll" }, h("table", { cls: "site-path-table" }, h("thead", {}, h("tr", {}, h("th", { text: o.columns[0] }), h("th", { text: o.columns[1] }), h("th"))), tbody)),
    add,
    h("p", { cls: "muted", text: o.note }),
  );
  queueMicrotask(redrawPlot);
  setTimeout(redrawPlot, 60);
  return showDialog<{ rows: [string, string][]; name: string }>({
    title: o.title,
    okLabel: "OK",
    cls: "site-path-dialog",
    body,
    check: () => {
      const rows = rowsNow();
      const bad = o.check(rows);
      if (bad) return { error: bad.error };
      if (o.name !== undefined && !name.value.trim()) return { error: "Give it a name.", focus: name };
      return { value: { rows, name: name.value.trim() } };
    },
  });
}

const within = (v: number | null, lo: number, hi: number): boolean => v !== null && v >= lo - 0.01 && v <= hi + 0.01;

/** Edit Profile on the longitudinal profile. */
async function editLongitudinal(id: string): Promise<void> {
  const s = store.session;
  const p = s ? pathById(s.doc, id) : null;
  if (!s || !p) return;
  const units = s.doc.info.units;
  const length = sectionsLength(sectionsOf(p));
  const read = (rows: readonly (readonly [string, string])[]): ProfilePoint[] | null => {
    const out: ProfilePoint[] = [];
    for (const [at, z] of rows) {
      const [a, b] = [parseLength(at, units), parseLength(z, units)];
      if (a === null || b === null || !within(a, 0, length)) return null;
      out.push({ at: a, z: b });
    }
    return out.sort((a, b) => a.at - b.at);
  };
  const r = await tableDialog({
    title: "Longitudinal Profile",
    columns: ["Distance", "Elevation"],
    note: `The path is ${formatLength(length, units)} long. Heights go straight from one row to the next.`,
    rows: profileOf(p).map((q) => [formatLengthValue(q.at, units), formatLengthValue(q.z, units)]),
    lockEnds: true,
    fewest: 2,
    plot: (rows) => read(rows)?.map((q) => [q.at, q.z]) ?? null,
    check: (rows) => (read(rows) ? null : { error: `Each row takes a distance from 0 to ${formatLength(length, units)} and an elevation.` }),
  });
  if (!r) return;
  const profile = read(r.rows) as ProfilePoint[];
  attempt("Edit Profile", (session) => session.batch(() => write(session, pathById(session.doc, id) as PathObject, { [FIELD.long]: JSON.stringify(profile) })));
}

/** Edit Profile on the chosen transverse profile. */
async function editCross(id: string): Promise<void> {
  const s = store.session;
  const p = s ? pathById(s.doc, id) : null;
  if (!s || !p) return;
  const crosses = crossesOf(p);
  const index = Number(p.value(FIELD.index)) || 0;
  const cross = crosses[index];
  if (!cross) {
    toast("Add a profile first: Add Profile, then click on the path.", "info");
    return;
  }
  const units = s.doc.info.units;
  const half = halves(sectionAt(sectionsOf(p), cross.at));
  const read = (rows: readonly (readonly [string, string])[]): CrossPoint[] | null => {
    const out: CrossPoint[] = [];
    for (const [off, rise] of rows) {
      const [a, b] = [parseLength(off, units), parseLength(rise, units)];
      if (a === null || b === null || !within(a, -half.right, half.left)) return null;
      out.push({ off: a, rise: b });
    }
    return out.sort((a, b) => b.off - a.off);
  };
  const r = await tableDialog({
    title: "Transverse Profile",
    name: cross.name,
    columns: ["Offset", "Height change"],
    note: `Across the path at ${formatLength(cross.at, units)}: from ${formatLength(half.left, units)} to its left to ${formatLength(-half.right, units)} to its right. Height changes are from the longitudinal profile, and shade from one transverse profile to the next.`,
    rows: [...cross.points].sort((a, b) => b.off - a.off).map((q) => [formatLengthValue(q.off, units), formatLengthValue(q.rise, units)]),
    lockEnds: true,
    fewest: 2,
    plot: (rows) => read(rows)?.map((q) => [-q.off, q.rise]) ?? null,
    check: (rows) => (read(rows) ? null : { error: `Each row takes an offset from ${formatLength(-half.right, units)} to ${formatLength(half.left, units)} and a height change.` }),
  });
  if (!r) return;
  const points = read(r.rows) as CrossPoint[];
  attempt("Edit Profile", (session) => {
    session.batch(() => {
      const live = pathById(session.doc, id) as PathObject;
      write(session, live, { [FIELD.cross]: JSON.stringify(crossesOf(live).map((c, i) => (i === index ? { ...c, name: r.name, points } : c))) });
    });
  });
}

/** Edit Path Points: the corners as figures. */
async function editCorners(id: string): Promise<void> {
  const s = store.session;
  const p = s ? pathById(s.doc, id) : null;
  const o = s?.doc.object(id);
  if (!s || !p || !o) return;
  const units = s.doc.info.units;
  const place = placeOf(o);
  const read = (rows: readonly (readonly [string, string])[]): Pt[] | null => {
    const out: Pt[] = [];
    for (const [x, y] of rows) {
      const [a, b] = [parseLength(x, units), parseLength(y, units)];
      if (a === null || b === null) return null;
      out.push({ x: a, y: b });
    }
    return out;
  };
  const r = await tableDialog({
    title: "Path Points",
    columns: ["X", "Y"],
    note: "Its corners, in order. Reshape moves them on the drawing too.",
    rows: cornersOf(p).map(place.toWorld).map((q) => [formatLengthValue(q.x, units), formatLengthValue(q.y, units)]),
    lockEnds: false,
    fewest: p.value(FIELD.config) === "Boundary" ? 3 : 2,
    check: (rows) => (read(rows) ? null : { error: "Each row takes an X and a Y." }),
  });
  if (!r) return;
  const corners = read(r.rows) as Pt[];
  attempt("Edit Path Points", (session) => session.batch(() => setCorners(session, id, corners)));
}

/** New corners, in the drawing, stretching what's along the path to its new length. */
function setCorners(s: EditSession, id: string, corners: readonly Pt[]): void {
  const p = pathById(s.doc, id);
  const o = s.doc.object(id);
  if (!p || !o) return;
  const { toLocal } = placeOf(o);
  const local = corners.map(toLocal);
  const was = sectionsLength(sectionsOf(p));
  const now = sectionsLength(sectionsFrom(p.value(FIELD.config), local, Number(p.value(FIELD.width)) || 0));
  if (!(now > 0)) throw new Error("That path has no length.");
  const by = was > 0 ? now / was : 1;
  write(s, p, { [FIELD.path]: JSON.stringify(local), [FIELD.long]: JSON.stringify(scaledProfile(profileOf(p), by)), [FIELD.cross]: JSON.stringify(scaledCrosses(crossesOf(p), by)) });
}

function realign(id: string): void {
  attempt("Realign Elevations", (s) =>
    s.batch(() => {
      const p = pathById(s.doc, id);
      if (p) write(s, p, { [FIELD.long]: JSON.stringify(realigned(profileOf(p))) });
    }),
  );
}

/** Fit to Surface: the longitudinal profile on the first site model under it. */
function fit(id: string): void {
  attempt("Fit to Surface", (s) =>
    s.batch(() => {
      const p = pathById(s.doc, id);
      const o = s.doc.object(id);
      if (!p || !o) return;
      const { toWorld } = placeOf(o);
      const sections = sectionsOf(p);
      const length = sectionsLength(sections);
      const spacing = Math.max(sectionSpacing(sections), length / 40);
      for (const m of modelsIn(s.doc)) {
        const t = terrainOf(m);
        const profile = fittedProfile(sections, (x, y) => {
          const w = toWorld({ x, y });
          return t.existingAt(w.x, w.y);
        }, spacing);
        if (profile.length < 2) continue;
        // what's off the model holds the nearest height
        const whole = [...(profile[0].at > 0 ? [{ at: 0, z: profile[0].z }] : []), ...profile, ...(profile[profile.length - 1].at < length ? [{ at: length, z: profile[profile.length - 1].z }] : [])];
        write(s, p, { [FIELD.long]: JSON.stringify(whole) });
        return;
      }
      throw new Error("The path isn't over a site model.");
    }),
  );
}

function step(id: string, by: number): void {
  attempt("Choose Profile", (s) =>
    s.batch(() => {
      const p = pathById(s.doc, id);
      if (!p) return;
      const count = crossesOf(p).length;
      if (count) write(s, p, { [FIELD.index]: ((Number(p.value(FIELD.index)) || 0) + by + count) % count });
    }),
  );
}

function addProfile(id: string): void {
  placeAtNextClick({
    what: "Profile",
    place(at) {
      attempt("Add Profile", (s) =>
        s.batch(() => {
          const p = pathById(s.doc, id);
          const o = s.doc.object(id);
          if (!p || !o) return;
          const sections = sectionsOf(p);
          const station = stationOf(sections, placeOf(o).toLocal(at));
          const half = halves(sectionAt(sections, station));
          const crosses = crossesOf(p);
          const used = new Set(crosses.map((c) => c.name));
          let n = crosses.length + 1;
          while (used.has(`Profile ${n}`)) n++;
          const next: CrossProfile = { name: `Profile ${n}`, at: station, points: [{ off: half.left, rise: 0 }, { off: 0, rise: 0 }, { off: -half.right, rise: 0 }] };
          const all = [...crosses, next].sort((a, b) => a.at - b.at);
          write(s, p, { [FIELD.cross]: JSON.stringify(all), [FIELD.index]: all.indexOf(next) });
        }),
      );
    },
  });
}

function removeProfile(id: string): void {
  attempt("Delete Profile", (s) =>
    s.batch(() => {
      const p = pathById(s.doc, id);
      if (!p) return;
      const index = Number(p.value(FIELD.index)) || 0;
      write(s, p, { [FIELD.cross]: JSON.stringify(crossesOf(p).filter((_, i) => i !== index)) });
    }),
  );
}

// ---- Object Info --------------------------------------------------------------------

const BUTTON = { update: 1, editLong: 2, realign: 3, fit: 4, previous: 5, next: 6, add: 7, editCross: 8, remove: 9, corners: 10 } as const;
const WIDTH_WIDGET = 12;
const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const button = (id: number, label: string): PluginWidget => ({ id, kind: "button", label, level: 0 });

const WIDGETS: readonly PluginWidget[] = [
  param(11, FIELD.config),
  param(WIDTH_WIDGET, FIELD.width),
  param(13, FIELD.apply),
  param(14, FIELD.show3d),
  button(BUTTON.update, "Update Site Model"),
  { id: 15, kind: "divider", label: "Longitudinal Profile", level: 0 },
  button(BUTTON.editLong, "Edit Profile"),
  param(16, FIELD.start),
  param(17, FIELD.end),
  param(18, FIELD.slope),
  button(BUTTON.realign, "Realign Elevations"),
  button(BUTTON.fit, "Fit to Surface"),
  { id: 19, kind: "divider", label: "Transverse Profiles", level: 0 },
  param(20, FIELD.profile),
  button(BUTTON.previous, "Previous Profile"),
  button(BUTTON.next, "Next Profile"),
  button(BUTTON.add, "Add Profile"),
  button(BUTTON.editCross, "Edit Selected Profile"),
  button(BUTTON.remove, "Delete Profile"),
  { id: 21, kind: "divider", label: "Display", level: 0 },
  param(22, FIELD.showLine),
  param(23, FIELD.showNames),
  param(24, FIELD.showSlopes),
  param(25, FIELD.arrow),
  param(26, FIELD.showElevation),
  param(27, FIELD.textPoints),
  { id: 28, kind: "divider", label: "Path", level: 0 },
  button(BUTTON.corners, "Edit Path Points"),
];

const POPUPS: Readonly<Record<string, readonly string[]>> = { [FIELD.config]: CONFIGURATIONS, [FIELD.apply]: APPLY };

const driver: PluginDriver = {
  name: PATH_MODIFIER,
  shape: "point",
  builtIn: true,
  label: (field) => (field === FIELD.slope ? "Slope (%)" : undefined),
  readOnly: (field) => field === FIELD.config || field === FIELD.profile,
  choices: (field) => POPUPS[field]?.map((value) => ({ value, label: value })),
  place: () => toast("Use Site Planning's Site Modifiers tool: Pathway Path or Boundary Path.", "info"),
  edit,
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => redraw(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates(id, apply) {
    const p = store.session ? pathById(store.session.doc, id) : null;
    if (p) apply(new Map([[WIDTH_WIDGET, { enabled: true, visible: p.value(FIELD.config) !== "Boundary" }]]));
  },
  press(id, widget) {
    if (widget === BUTTON.update) updateSiteModels();
    else if (widget === BUTTON.editLong) void editLongitudinal(id);
    else if (widget === BUTTON.realign) realign(id);
    else if (widget === BUTTON.fit) fit(id);
    else if (widget === BUTTON.previous) step(id, -1);
    else if (widget === BUTTON.next) step(id, 1);
    else if (widget === BUTTON.add) addProfile(id);
    else if (widget === BUTTON.editCross) void editCross(id);
    else if (widget === BUTTON.remove) removeProfile(id);
    else if (widget === BUTTON.corners) void editCorners(id);
  },
  open: (id) => void editLongitudinal(id),
  path(id) {
    const s = store.session;
    const p = s ? pathById(s.doc, id) : null;
    const o = s?.doc.object(id);
    if (!p || !o) return null;
    return { points: cornersOf(p).map(placeOf(o).toWorld), closed: p.value(FIELD.config) === "Boundary" };
  },
  setPath: setCorners,
};
registerPluginDrivers(() => [driver]);
