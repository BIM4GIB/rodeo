// The Grade tool's object: a line between two elevations, showing its slope, length and elevations. It can take its
// heights from a site model or act on one as a modifier, and grades that share an end share its elevation and move
// together, as a network. It's a plug-in with its origin at its first point, turned towards the second; it has
// Rodeo's own name, so Vectorworks' Grade objects in a drawing are left alone. Heights are above its layer.

import type { Attributes, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { afterSiteUpdate, appContext, followEdits, registerModifierSource, registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import { closestOn, criticalGrades, endsAt, GRADE_DEFINITIONS, GRADE_PARAMETERS, gradeFigures, networkOf, secondParameters, slopeLabel, solveGrade, type GradeChecks, type GradeDefinition, type GradeLine, type GradeParameter } from "./gradeShapes.ts";
import { showDialog } from "./menubar.ts";
import { colorSwatch } from "./panels/colorPicker.ts";
import { symbolDefsOf } from "./panels/resources.ts";
import { modelsIn, nearColour, selectedTop, terrainOf } from "./siteModel.ts";
import type { SiteModifier } from "./siteModelShapes.ts";
import { layerScaleOf } from "./spaces.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { formatLength, formatLengthValue, parseLength } from "./units.ts";

export const GRADE = "Rodeo Grade";

const PLUGIN = 86;
const LOCUS3D = 9;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  e1: "Elevation 1",
  e2: "Elevation 2",
  length: "Projected Length",
  surface: "Surface Length",
  change: "Elevation Change",
  grade: "Grade",
  marker: "Elevation Marker",
  markerScale: "Marker Scale",
  showSlope: "Show Slope Value",
  showProjected: "Show Projected Length Value",
  projectedPrefix: "Projected Length Prefix",
  showSurface: "Show Surface Length Value",
  surfacePrefix: "Surface Length Prefix",
  below: "Show Length Values Below Arrow",
  showElevation: "Show Elevation Value",
  drawLine: "Draw Line",
  textPoints: "Text Size",
  mode: "Grade Object Mode",
  apply: "Apply To",
  /** kept out of Object Info */
  detached: "Detached from Network",
  critical: "Critical",
  ends: "Last Ends",
  global: "Global Settings",
} as const;

const MODES = ["Use grade object heights", "Use heights from site model", "Change site model (use grade as pad modifier)"] as const;
const APPLY = ["Proposed site model", "Existing site model"] as const;
const BUILT_IN_MARKER = "Circle and Cross";
const END_MARKERS = ["Arrow", "Dot", "Slash", "None"] as const;

/** The grade indicators' look and the analysis: one set for the whole file, kept on each grade. */
export interface GradeGlobals {
  /** page mm */
  arrowLength: number;
  arrowOffset: number;
  definition: GradeDefinition;
  precision: number;
  /** thousandths of an inch */
  arrowMils: number;
  arrowColour: number | null;
  arrowMarker: (typeof END_MARKERS)[number];
  arrowOpacity: number;
  preserve: boolean;
  highlight: boolean;
  highlightColour: number | null;
  selectCritical: boolean;
  checkSlope: boolean;
  slopeMin: number;
  slopeMax: number;
  checkElevation: boolean;
  elevationMin: number;
  elevationMax: number;
  intersections: boolean;
}

const DEFAULT_GLOBALS: GradeGlobals = {
  arrowLength: 12,
  arrowOffset: 2,
  definition: "Percent",
  precision: 2,
  arrowMils: 5,
  arrowColour: null,
  arrowMarker: "Arrow",
  arrowOpacity: 100,
  preserve: true,
  highlight: true,
  highlightColour: null,
  selectCritical: false,
  checkSlope: false,
  slopeMin: 0,
  slopeMax: 100,
  checkElevation: false,
  elevationMin: 0,
  elevationMax: 30480,
  intersections: false,
};

/** What a new grade starts with, and the last elevation for a new one with nothing else to go by. */
const lastAsked = {
  first: "Elevation 1" as GradeParameter,
  second: "Elevation 2" as GradeParameter,
  e1: 0,
  e2: 0,
  marker: BUILT_IN_MARKER,
  markerScale: 1,
  showSlope: true,
  showProjected: false,
  projectedPrefix: "",
  showSurface: false,
  surfacePrefix: "",
  below: false,
  showElevation: true,
  drawLine: true,
  textPoints: 8,
  mode: MODES[0] as string,
  apply: APPLY[0] as string,
};

export type GradeLook = Omit<typeof lastAsked, "first" | "second" | "e1" | "e2">;

const lookValues = (k: GradeLook): Record<string, RecordValue> => ({
  [FIELD.marker]: k.marker,
  [FIELD.markerScale]: k.markerScale,
  [FIELD.showSlope]: k.showSlope,
  [FIELD.showProjected]: k.showProjected,
  [FIELD.projectedPrefix]: k.projectedPrefix,
  [FIELD.showSurface]: k.showSurface,
  [FIELD.surfacePrefix]: k.surfacePrefix,
  [FIELD.below]: k.below,
  [FIELD.showElevation]: k.showElevation,
  [FIELD.drawLine]: k.drawLine,
  [FIELD.textPoints]: k.textPoints,
  [FIELD.mode]: k.mode,
  [FIELD.apply]: k.apply,
});

interface Grade {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

function gradeOf(doc: VwxDocument, id: string, layerId: string): Grade | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === GRADE);
  return rec ? { id, layerId, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

function gradesIn(doc: VwxDocument): Grade[] {
  if (!doc.hasPluginFormat(GRADE)) return [];
  const out: Grade[] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const g = gradeOf(doc, o.id, layer.id);
      if (g) out.push(g);
    }
  }
  return out;
}

const gradeById = (doc: VwxDocument, id: string): Grade | null => {
  const layerId = doc.object(id)?.layerId;
  return layerId ? gradeOf(doc, id, layerId) : null;
};

const num = (g: Grade, field: string): number => Number(g.value(field)) || 0;

/** Where a grade's two ends are. */
function endsOf(s: EditSession, g: Grade): { a: Pt; b: Pt } | null {
  const at = s.doc.object(g.id)?.insertion;
  if (!at) return null;
  const turn = (s.pluginAngle(g.id) * Math.PI) / 180;
  const length = num(g, FIELD.length);
  return { a: { x: at.x, y: at.y }, b: { x: at.x + Math.cos(turn) * length, y: at.y + Math.sin(turn) * length } };
}

function linesOf(s: EditSession, grades: readonly Grade[]): GradeLine[] {
  const out: GradeLine[] = [];
  for (const g of grades) {
    const ends = endsOf(s, g);
    if (ends) out.push({ id: g.id, ...ends, e1: num(g, FIELD.e1), e2: num(g, FIELD.e2), detached: g.value(FIELD.detached) === true });
  }
  return out;
}

function globalsOf(doc: VwxDocument): GradeGlobals {
  for (const g of gradesIn(doc)) {
    const text = String(g.value(FIELD.global) ?? "");
    if (text) {
      try {
        return { ...DEFAULT_GLOBALS, ...(JSON.parse(text) as Partial<GradeGlobals>) };
      } catch {
        // an unreadable copy: the next one, or the defaults
      }
    }
  }
  return { ...DEFAULT_GLOBALS };
}

let pendingGlobals: GradeGlobals | null = null;

const endsText = (ends: { a: Pt; b: Pt }): string => [ends.a.x, ends.a.y, ends.b.x, ends.b.y].map((v) => Math.round(v * 10) / 10).join(" ");

type Look = Partial<Attributes>;

const TEXT_GAP = 0.8;

function drawing(s: EditSession, g: Grade, globals: GradeGlobals): { shapes: NewShape[]; looks: Look[]; symbols: { index: number; at: Pt }[] } {
  const units = s.doc.info.units;
  const scale = layerScaleOf(g.layerId);
  const length = num(g, FIELD.length);
  const [e1, e2] = [num(g, FIELD.e1), num(g, FIELD.e2)];
  const f = gradeFigures(e1, e2, length);
  const colour = nearColour(s.doc);
  const black = colour("#000000");
  const critical = g.value(FIELD.critical) === true && globals.highlight;
  const stroke = critical ? (globals.highlightColour ?? colour("#e0332d")) : black;
  const arrowColour = critical ? stroke : (globals.arrowColour ?? black);
  const pen = (c: number, mils: number, opacity = 100): Look => ({ ...store.drawAttrs, fillPattern: 0, lineStyle: 2, lineWeight: mils, penFore: c, lineOpacity: opacity } as Look);
  const fill = (c: number, opacity = 100): Look => ({ ...store.drawAttrs, fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: opacity, lineStyle: 0 });
  const shapes: NewShape[] = [];
  const looks: Look[] = [];
  const symbols: { index: number; at: Pt }[] = [];
  const add = (shape: NewShape, look: Look): void => {
    shapes.push(shape);
    looks.push(look);
  };
  // reads the right way up, however it's turned
  const turned = Math.cos((s.pluginAngle(g.id) * Math.PI) / 180) < 0;
  const up = turned ? -1 : 1;
  const angle = turned ? 180 : 0;
  const textHeight = (num(g, FIELD.textPoints) || 8) * (25.4 / 72) * scale;
  const text = (at: Pt, value: string, vAlign: number): void => add({ kind: "text", at, text: value, height: textHeight, hAlign: 2, vAlign, angle } as NewShape, { fillPattern: 0, penFore: stroke });
  if (g.value(FIELD.drawLine) === true) add({ kind: "line", a: { x: 0, y: 0 }, b: { x: length, y: 0 } } as NewShape, pen(stroke, 5));
  const r = 1.5 * scale * (num(g, FIELD.markerScale) || 1);
  const markerName = String(g.value(FIELD.marker) ?? BUILT_IN_MARKER);
  const symbol = markerName === BUILT_IN_MARKER ? undefined : symbolDefsOf(s.doc).find((d) => d.name === markerName);
  for (const x of [0, length]) {
    if (symbol) symbols.push({ index: symbol.index, at: { x, y: 0 } });
    else {
      add({ kind: "arc", center: { x, y: 0 }, radius: r, startAngle: 0, sweepAngle: 360 } as NewShape, pen(stroke, 3));
      add({ kind: "line", a: { x: x - r, y: 0 }, b: { x: x + r, y: 0 } } as NewShape, pen(stroke, 3));
      add({ kind: "line", a: { x, y: -r }, b: { x, y: r } } as NewShape, pen(stroke, 3));
    }
  }
  const above = (over: number): number => up * (r + textHeight * over);
  if (g.value(FIELD.showElevation) === true) {
    text({ x: 0, y: above(TEXT_GAP) }, formatLength(e1, units), 3);
    text({ x: length, y: above(TEXT_GAP) }, formatLength(e2, units), 3);
  }
  if (g.value(FIELD.showSlope) === true) text({ x: length / 2, y: up * textHeight * TEXT_GAP }, slopeLabel(f.slope, globals.definition, globals.precision), 3);
  const lengths = [g.value(FIELD.showProjected) === true ? `${g.value(FIELD.projectedPrefix) ?? ""}${formatLength(length, units)}` : "", g.value(FIELD.showSurface) === true ? `${g.value(FIELD.surfacePrefix) ?? ""}${formatLength(f.surface, units)}` : ""].filter(Boolean);
  // the arrow points downhill, under the line
  const arrowY = -up * Math.max(globals.arrowOffset, 0.1) * scale;
  if (lengths.length || g.value(FIELD.showSlope) === true) {
    const half = (Math.min(globals.arrowLength * scale, length) || globals.arrowLength * scale) / 2;
    const down = f.change <= 0 ? 1 : -1;
    const [from, to] = [length / 2 - down * half, length / 2 + down * half];
    const size = 1.2 * scale;
    const look = pen(arrowColour, globals.arrowMils, globals.arrowOpacity);
    add({ kind: "line", a: { x: from, y: arrowY }, b: { x: to, y: arrowY } } as NewShape, look);
    if (globals.arrowMarker === "Arrow") add({ kind: "polygon", points: [{ x: to, y: arrowY }, { x: to - down * size * 1.6, y: arrowY + size * 0.5 }, { x: to - down * size * 1.6, y: arrowY - size * 0.5 }], closed: true }, fill(arrowColour, globals.arrowOpacity));
    else if (globals.arrowMarker === "Dot") add({ kind: "arc", center: { x: to, y: arrowY }, radius: size * 0.4, startAngle: 0, sweepAngle: 360 } as NewShape, fill(arrowColour, globals.arrowOpacity));
    else if (globals.arrowMarker === "Slash") add({ kind: "line", a: { x: to - size * 0.5, y: arrowY - size * 0.5 }, b: { x: to + size * 0.5, y: arrowY + size * 0.5 } } as NewShape, look);
  }
  if (lengths.length) {
    const label = lengths.join("/");
    const place = g.value(FIELD.below) === true ? arrowY - up * textHeight * TEXT_GAP : arrowY + up * textHeight * TEXT_GAP;
    text({ x: length / 2, y: place }, label, 3);
  }
  return { shapes, looks, symbols };
}

/** The figures Object Info shows, from the elevations and the length. */
function setFigures(s: EditSession, g: Grade, globals: GradeGlobals): void {
  const units = s.doc.info.units;
  const f = gradeFigures(num(g, FIELD.e1), num(g, FIELD.e2), num(g, FIELD.length));
  const set = (field: string, value: RecordValue): void => s.setRecordField(g.id, g.format, field, value);
  set(FIELD.surface, formatLength(f.surface, units));
  set(FIELD.change, formatLength(f.change, units));
  set(FIELD.grade, `${slopeLabel(f.slope, globals.definition, globals.precision)} ${f.change === 0 ? "" : f.change < 0 ? "down" : "up"}`.trim());
}

function redraw(s: EditSession, id: string): void {
  const g = gradeById(s.doc, id);
  if (!g) return;
  const globals = pendingGlobals ?? globalsOf(s.doc);
  setFigures(s, g, globals);
  const live = gradeById(s.doc, id) as Grade;
  const d = drawing(s, live, globals);
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  const ids = d.shapes.length ? s.addObjects(g.layerId, d.shapes, classIndex, d.looks) : [];
  for (const m of d.symbols) ids.push(s.insertSymbol(g.layerId, m.index, m.at, classIndex));
  s.setPluginDrawing(id, ids);
  const ends = endsOf(s, live);
  if (ends) s.setRecordField(id, g.format, FIELD.ends, endsText(ends));
}

const specsOf = (values: Readonly<Record<string, RecordValue>>): PluginFieldSpec[] => {
  const types: Record<string, number> = {
    [FIELD.e1]: DIMENSION,
    [FIELD.e2]: DIMENSION,
    [FIELD.length]: DIMENSION,
    [FIELD.surface]: TEXT,
    [FIELD.change]: TEXT,
    [FIELD.grade]: TEXT,
    [FIELD.marker]: TEXT,
    [FIELD.markerScale]: NUMBER,
    [FIELD.showSlope]: BOOL,
    [FIELD.showProjected]: BOOL,
    [FIELD.projectedPrefix]: TEXT,
    [FIELD.showSurface]: BOOL,
    [FIELD.surfacePrefix]: TEXT,
    [FIELD.below]: BOOL,
    [FIELD.showElevation]: BOOL,
    [FIELD.drawLine]: BOOL,
    [FIELD.textPoints]: NUMBER,
    [FIELD.mode]: POPUP,
    [FIELD.apply]: POPUP,
    [FIELD.detached]: BOOL,
    [FIELD.critical]: BOOL,
    [FIELD.ends]: TEXT,
    [FIELD.global]: TEXT,
  };
  return Object.entries(types).map(([name, type]) => ({ name, type, value: values[name] ?? (type === BOOL ? false : type === NUMBER || type === DIMENSION ? 0 : "") }));
};

/** The elevations of a grade's ends where a site model is under them. */
function fromSite(s: EditSession, g: Grade): { e1: number; e2: number } | null {
  const ends = endsOf(s, g);
  if (!ends) return null;
  const existing = g.value(FIELD.apply) === APPLY[1];
  for (const m of modelsIn(s.doc)) {
    const t = terrainOf(m);
    const at = existing ? t.existingAt : t.proposedAt;
    const [e1, e2] = [at(ends.a.x, ends.a.y), at(ends.b.x, ends.b.y)];
    if (e1 !== null && e2 !== null) return { e1, e2 };
  }
  return null;
}

/** Sets a grade's elevations and those of the ends it shares; the ids drawn again. */
function setElevations(s: EditSession, id: string, e1: number | null, e2: number | null, changed: Set<string>): void {
  const g = gradeById(s.doc, id);
  if (!g) return;
  if (e1 !== null) s.setRecordField(id, g.format, FIELD.e1, e1);
  if (e2 !== null) s.setRecordField(id, g.format, FIELD.e2, e2);
  changed.add(id);
  if (g.value(FIELD.detached) === true) return;
  const lines = linesOf(s, gradesIn(s.doc));
  const line = lines.find((l) => l.id === id);
  if (!line) return;
  for (const [at, value] of [[line.a, e1], [line.b, e2]] as const) {
    if (value === null) continue;
    for (const end of endsAt(lines, at, id)) {
      const other = gradeById(s.doc, end.id);
      if (!other) continue;
      s.setRecordField(end.id, other.format, end.end === 1 ? FIELD.e1 : FIELD.e2, value);
      changed.add(end.id);
    }
  }
}

/** Marks the grades that fail the analysis, and draws those that changed; the critical ones. */
function analyse(s: EditSession, globals: GradeGlobals, also: ReadonlySet<string> = new Set()): string[] {
  const grades = gradesIn(s.doc);
  const checks: GradeChecks = {
    slope: globals.checkSlope ? { min: globals.slopeMin, max: globals.slopeMax } : null,
    elevation: globals.checkElevation ? { min: globals.elevationMin, max: globals.elevationMax } : null,
    intersections: globals.intersections,
  };
  const critical = criticalGrades(linesOf(s, grades), checks);
  const again = new Set(also);
  for (const g of grades) {
    if ((g.value(FIELD.critical) === true) !== critical.has(g.id)) {
      s.setRecordField(g.id, g.format, FIELD.critical, critical.has(g.id));
      again.add(g.id);
    }
  }
  for (const id of again) redraw(s, id);
  return [...critical];
}

function applyGlobals(s: EditSession, globals: GradeGlobals): string[] {
  const text = JSON.stringify(globals);
  pendingGlobals = globals;
  try {
    const grades = gradesIn(s.doc);
    for (const g of grades) s.setRecordField(g.id, g.format, FIELD.global, text);
    return analyse(s, globals, new Set(grades.map((g) => g.id)));
  } finally {
    pendingGlobals = null;
  }
}

/** Update mode: joined ends brought together, the site's heights taken up, the analysis run and all drawn again. */
export function updateGrades(): void {
  const r = attempt("Update Grades", (s) =>
    s.batch(() => {
      const changed = new Set<string>();
      for (const g of gradesIn(s.doc)) {
        changed.add(g.id);
        if (g.value(FIELD.mode) === MODES[1]) {
          const site = fromSite(s, g);
          if (site) setElevations(s, g.id, site.e1, site.e2, changed);
        }
      }
      // where joined ends disagree, the first grade's stands
      const lines = linesOf(s, gradesIn(s.doc));
      const done = new Set<string>();
      for (const line of lines) {
        if (line.detached) continue;
        for (const [at, value, end] of [[line.a, line.e1, 1], [line.b, line.e2, 2]] as const) {
          if (done.has(`${line.id}:${end}`)) continue;
          for (const other of endsAt(lines, at, line.id)) {
            const g = gradeById(s.doc, other.id);
            if (!g) continue;
            done.add(`${other.id}:${other.end}`);
            s.setRecordField(other.id, g.format, other.end === 1 ? FIELD.e1 : FIELD.e2, value);
          }
        }
      }
      const globals = globalsOf(s.doc);
      const critical = analyse(s, globals, changed);
      return { count: changed.size, critical, select: globals.selectCritical };
    }),
  );
  if (!r) return;
  if (r.value.select) setSelection(r.value.critical);
  appContext()?.requestDraw();
  toast(r.value.critical.length ? `${r.value.count} grade objects updated; ${r.value.critical.length} critical.` : `${r.value.count} grade objects updated.`, "info");
}

afterSiteUpdate((s) => {
  const changed = new Set<string>();
  for (const g of gradesIn(s.doc)) {
    if (g.value(FIELD.mode) !== MODES[1]) continue;
    const site = fromSite(s, g);
    if (site && (Math.abs(site.e1 - num(g, FIELD.e1)) > 0.5 || Math.abs(site.e2 - num(g, FIELD.e2)) > 0.5)) setElevations(s, g.id, site.e1, site.e2, changed);
  }
  for (const id of changed) redraw(s, id);
});

// a grade changing the site is a line of known heights in its modifiers
registerModifierSource((doc, modelLayer, scope): SiteModifier[] => {
  const out: SiteModifier[] = [];
  for (const g of gradesIn(doc)) {
    if (g.value(FIELD.mode) !== MODES[2]) continue;
    if (scope === "Same Layer as Site Model only" && g.layerId !== modelLayer) continue;
    if (scope === "Visible Layers Only" && doc.layers().find((l) => l.id === g.layerId)?.visibility !== "visible") continue;
    const line = lineFromRecord(g);
    if (line) out.push({ kind: "line", ring: [line.a, line.b], elevation: num(g, FIELD.e1), end: num(g, FIELD.e2), slope: 0, slopeAngle: 0, existing: g.value(FIELD.apply) === APPLY[1] });
  }
  return out;
});

/** A grade's ends as its record last saw them; no session is at hand when a model reads its modifiers. */
function lineFromRecord(g: Grade): { a: Pt; b: Pt } | null {
  const v = String(g.value(FIELD.ends) ?? "").split(" ").map(Number);
  if (v.length !== 4 || v.some((n) => !Number.isFinite(n))) return null;
  return { a: { x: v[0], y: v[1] }, b: { x: v[2], y: v[3] } };
}

/** Grades moved: the rest of each one's network comes along. */
function keepNetworks(s: EditSession): void {
  const grades = gradesIn(s.doc);
  if (!grades.length) return;
  const moved: { id: string; dx: number; dy: number }[] = [];
  const lines: GradeLine[] = [];
  for (const g of grades) {
    const ends = endsOf(s, g);
    if (!ends) continue;
    const was = String(g.value(FIELD.ends) ?? "").split(" ").map(Number);
    if (was.length !== 4) continue;
    lines.push({ id: g.id, a: { x: was[0], y: was[1] }, b: { x: was[2], y: was[3] }, e1: 0, e2: 0, detached: g.value(FIELD.detached) === true });
    const now = endsText(ends).split(" ").map(Number);
    if (now.every((v, i) => Math.abs(v - was[i]) <= 0.2)) continue;
    // turned or stretched, only its record catches up
    const same = Math.abs(now[2] - now[0] - (was[2] - was[0])) <= 0.2 && Math.abs(now[3] - now[1] - (was[3] - was[1])) <= 0.2;
    moved.push({ id: g.id, dx: same ? now[0] - was[0] : 0, dy: same ? now[1] - was[1] : 0 });
  }
  if (!moved.length) return;
  s.followOn(() => {
    const along = new Set(moved.map((m) => m.id));
    for (const m of moved) {
      if (m.dx === 0 && m.dy === 0) continue;
      for (const other of networkOf(lines, m.id)) {
        if (along.has(other.id)) continue;
        along.add(other.id);
        s.moveObjects([other.id], m.dx, m.dy);
      }
    }
    for (const id of along) {
      const g = gradeById(s.doc, id);
      const ends = g ? endsOf(s, g) : null;
      if (g && ends) s.setRecordField(id, g.format, FIELD.ends, endsText(ends));
    }
  });
}
followEdits(keepNetworks);

function edit(id: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt("Edit Grade", (s) =>
    s.batch(() => {
      const g = gradeById(s.doc, id);
      if (!g) throw new Error("That isn't a grade object.");
      const changed = new Set<string>([id]);
      const globals = globalsOf(s.doc);
      const lines = linesOf(s, gradesIn(s.doc));
      const line = lines.find((l) => l.id === id);
      const newLength = FIELD.length in values ? Number(values[FIELD.length]) : null;
      if (newLength !== null && !(newLength > 0)) throw new Error("A grade's length has to be over zero.");
      const newE1 = FIELD.e1 in values && Number(values[FIELD.e1]) !== num(g, FIELD.e1) ? Number(values[FIELD.e1]) : null;
      const newE2 = FIELD.e2 in values && Number(values[FIELD.e2]) !== num(g, FIELD.e2) ? Number(values[FIELD.e2]) : null;
      for (const [field, value] of Object.entries(values)) {
        if (field !== FIELD.e1 && field !== FIELD.e2) s.setRecordField(id, g.format, field, value);
      }
      if (newLength !== null && line && globals.preserve && newLength !== num(g, FIELD.length)) {
        // the far end moves: if it isn't joined, the slope stays and its elevation follows
        const joined = endsAt(lines, line.b, id).length > 0;
        const old = num(g, FIELD.length);
        if (!joined && old > 0 && newE2 === null) s.setRecordField(id, g.format, FIELD.e2, num(g, FIELD.e1) + ((num(g, FIELD.e2) - num(g, FIELD.e1)) * newLength) / old);
      }
      if (newE1 !== null || newE2 !== null) setElevations(s, id, newE1, newE2, changed);
      analyse(s, globals, changed);
    }),
  );
}

const BUTTON = { settings: 1, detach: 2 } as const;
const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });

const WIDGETS: readonly PluginWidget[] = [
  { id: BUTTON.settings, kind: "button", label: "Settings", level: 0 },
  param(10, FIELD.e1),
  param(11, FIELD.e2),
  param(12, FIELD.length),
  param(13, FIELD.surface),
  param(14, FIELD.change),
  param(15, FIELD.grade),
  { id: 16, kind: "divider", label: "Graphics", level: 0 },
  param(17, FIELD.markerScale),
  param(18, FIELD.showSlope),
  param(19, FIELD.showProjected),
  param(20, FIELD.showSurface),
  param(21, FIELD.below),
  param(22, FIELD.showElevation),
  param(23, FIELD.drawLine),
  param(24, FIELD.textPoints),
  { id: 25, kind: "divider", label: "Site Model", level: 0 },
  param(26, FIELD.mode),
  param(27, FIELD.apply),
  { id: BUTTON.detach, kind: "button", label: "Detach from Grade Network", level: 0 },
];

const POPUPS: Record<string, readonly string[]> = { [FIELD.mode]: MODES, [FIELD.apply]: APPLY };

const driver: PluginDriver = {
  name: GRADE,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: (field) => field === FIELD.surface || field === FIELD.change || field === FIELD.grade,
  choices: (field) => POPUPS[field]?.map((value) => ({ value, label: value })),
  place: () => toast("Use Site Planning's Grade tool: click the two ends.", "info"),
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
    const g = store.session ? gradeById(store.session.doc, id) : null;
    if (!g) return;
    const site = g.value(FIELD.mode) === MODES[1];
    const state = (enabled: boolean, visible = true): { enabled: boolean; visible: boolean } => ({ enabled, visible });
    apply(new Map([[10, state(!site)], [11, state(!site)], [27, state(true, g.value(FIELD.mode) !== MODES[0])]]));
  },
  press(id, widget) {
    if (widget === BUTTON.settings) void openSettings(id);
    else if (widget === BUTTON.detach) detach(id);
  },
  open: (id) => void openSettings(id),
};
registerPluginDrivers(() => [driver]);

function detach(id: string): void {
  attempt("Detach from Grade Network", (s) =>
    s.batch(() => {
      const g = gradeById(s.doc, id);
      if (g) s.setRecordField(id, g.format, FIELD.detached, g.value(FIELD.detached) !== true);
    }),
  );
  const g = store.session ? gradeById(store.session.doc, id) : null;
  toast(g?.value(FIELD.detached) === true ? "Detached: this grade no longer shares elevations or moves with those it touches. Click again to join it back." : "Joined back to the grades it touches.", "info");
}

const select = (options: readonly string[], value: string, label: string): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map((o) => h("option", { text: o, attrs: { value: o } })));
  el.value = value;
  return el;
};
const input = (value: string, label: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { "aria-label": label } });
const row = (label: string, el: HTMLElement, unit = ""): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, ...(unit ? [h("span", { cls: "menu-dialog-unit", text: unit })] : []));
const check = (label: string, checked: boolean): { row: HTMLElement; input: HTMLInputElement } => {
  const el = h("input", { attrs: { type: "checkbox", "aria-label": label } });
  el.checked = checked;
  return { row: h("label", { cls: "menu-dialog-check" }, el, label), input: el };
};
const heading = (text: string): HTMLElement => h("p", { cls: "menu-dialog-heading", text });

function swatch(doc: VwxDocument, label: string, initial: number): { readonly el: HTMLElement; get(): number } {
  let colour = initial;
  const el = h("span", {});
  const draw = (): void => el.replaceChildren(colorSwatch({ doc, value: colour, label, onPick: (index) => ((colour = index), draw()) }));
  draw();
  return { el, get: () => colour };
}

const isHeight = (p: GradeParameter): boolean => p === "Elevation 1" || p === "Elevation 2" || p === "Elevation Change";

interface Asked {
  e1: number;
  e2: number;
  first: GradeParameter;
  second: GradeParameter;
  look: GradeLook;
  globals: GradeGlobals;
}

/** The Grade Settings dialog: this grade's figures and look, and the settings all grades share. */
async function settingsDialog(doc: VwxDocument, start: { e1: number; e2: number; length: number; look: GradeLook; first: GradeParameter; second: GradeParameter }, globalOnly = false): Promise<Asked | null> {
  const units = doc.info.units;
  const was = globalsOf(doc);
  const colour = nearColour(doc);
  const valueOf = (p: GradeParameter): string => {
    const { e1, e2, length } = start;
    const change = e2 - e1;
    const rise = length > 0 ? change / length : 0;
    if (p === "Elevation 1") return formatLengthValue(e1, units);
    if (p === "Elevation 2") return formatLengthValue(e2, units);
    if (p === "Elevation Change") return formatLengthValue(change, units);
    if (p === "Downward Grade in %") return String(Math.round(-rise * 1e5) / 1e3);
    if (p === "Upward Grade in %") return String(Math.round(rise * 1e5) / 1e3);
    if (p === "Downward Ratio (rise/run)") return String(Math.round(-rise * 1e5) / 1e5);
    return String(Math.round(rise * 1e5) / 1e5);
  };
  const firstSel = select(GRADE_PARAMETERS, start.first, "Parameter 1");
  const firstVal = input(valueOf(start.first), "Parameter 1 value");
  const secondSel = select(secondParameters(start.first), start.second, "Parameter 2");
  const secondVal = input(valueOf(start.second), "Parameter 2 value");
  const display = h("p", { cls: "muted", text: "" });
  const read = (p: GradeParameter, text: string): number | null => {
    if (isHeight(p)) return parseLength(text, units);
    const n = Number(text);
    return text.trim() !== "" && Number.isFinite(n) ? n : null;
  };
  const solved = (): { e1: number; e2: number } | null => {
    const [a, b] = [read(firstSel.value as GradeParameter, firstVal.value), read(secondSel.value as GradeParameter, secondVal.value)];
    return a === null || b === null ? null : solveGrade(firstSel.value as GradeParameter, a, secondSel.value as GradeParameter, b, start.length);
  };
  const refresh = (): void => {
    const r = solved();
    if (!r) {
      display.textContent = "";
      return;
    }
    const f = gradeFigures(r.e1, r.e2, start.length);
    display.textContent = `Elevation 1 ${formatLength(r.e1, units)}, Elevation 2 ${formatLength(r.e2, units)}. Grade ${slopeLabel(f.slope, "Percent", 2)} ${f.change < 0 ? "down" : f.change > 0 ? "up" : ""}, projected length ${formatLength(start.length, units)}, surface length ${formatLength(f.surface, units)}.`;
  };
  firstSel.addEventListener("change", () => {
    const options = secondParameters(firstSel.value as GradeParameter);
    const keep = options.includes(secondSel.value as GradeParameter) ? secondSel.value : options[0];
    secondSel.replaceChildren(...options.map((o) => h("option", { text: o, attrs: { value: o } })));
    secondSel.value = keep;
    firstVal.value = valueOf(firstSel.value as GradeParameter);
    secondVal.value = valueOf(keep as GradeParameter);
    refresh();
  });
  secondSel.addEventListener("change", () => {
    secondVal.value = valueOf(secondSel.value as GradeParameter);
    refresh();
  });
  firstVal.addEventListener("input", refresh);
  secondVal.addEventListener("input", refresh);
  refresh();
  const k = start.look;
  const symbols = symbolDefsOf(doc).map((d) => d.name);
  const marker = select([BUILT_IN_MARKER, ...symbols], k.marker, "Elevation marker symbol");
  const markerScale = input(String(k.markerScale), "Scale");
  const showSlope = check("Show slope value", k.showSlope);
  const showProjected = check("Show projected length value", k.showProjected);
  const projectedPrefix = input(k.projectedPrefix, "Projected length prefix");
  const showSurface = check("Show surface length value", k.showSurface);
  const surfacePrefix = input(k.surfacePrefix, "Surface length prefix");
  const below = check("Show length value(s) below arrow", k.below);
  const showElevation = check("Show elevation value", k.showElevation);
  const drawLine = check("Draw line", k.drawLine);
  const textPoints = input(String(k.textPoints), "Text size");
  const mode = select(MODES, k.mode, "Grade Object Mode");
  const apply = select(APPLY, k.apply, "Apply To");
  const arrowLength = input(String(was.arrowLength), "Arrow Line Length");
  const arrowOffset = input(String(was.arrowOffset), "Arrow Offset");
  const definition = select(GRADE_DEFINITIONS, was.definition, "Grade Definition");
  const precision = input(String(was.precision), "Precision");
  const arrowMils = input(String(was.arrowMils), "Pen thickness");
  const arrowColour = swatch(doc, "Arrow colour", was.arrowColour ?? colour("#000000"));
  const arrowMarker = select(END_MARKERS, was.arrowMarker, "End Marker");
  const arrowOpacity = input(String(was.arrowOpacity), "Opacity");
  const preserve = check("Preserve grade if one point is not connected", was.preserve);
  const highlight = check("Highlight critical objects", was.highlight);
  const highlightColour = swatch(doc, "Highlight colour", was.highlightColour ?? colour("#e0332d"));
  const selectCritical = check("Select critical objects", was.selectCritical);
  const checkSlope = check("Grade out of range (%)", was.checkSlope);
  const slopeMin = input(String(was.slopeMin), "Lowest grade");
  const slopeMax = input(String(was.slopeMax), "Highest grade");
  const checkElevation = check("Elevations out of range", was.checkElevation);
  const elevationMin = input(formatLengthValue(was.elevationMin, units), "Lowest elevation");
  const elevationMax = input(formatLengthValue(was.elevationMax, units), "Highest elevation");
  const intersections = check("Show intersections", was.intersections);
  const objectBody = globalOnly
    ? []
    : [
        heading("General"),
        row("Parameter 1", firstSel),
        row("Value", firstVal),
        row("Parameter 2", secondSel),
        row("Value", secondVal),
        display,
        heading("Graphics"),
        row("Elevation marker symbol", marker),
        row("Scale", markerScale),
        showSlope.row,
        showProjected.row,
        row("Prefix", projectedPrefix),
        showSurface.row,
        row("Prefix", surfacePrefix),
        below.row,
        showElevation.row,
        drawLine.row,
        row("Text size", textPoints, "pt"),
        heading("Site Model"),
        row("Grade Object Mode", mode),
        row("Apply To", apply),
      ];
  const fig = (el: HTMLInputElement, min: number, max: number): number | null => {
    const v = Number(el.value);
    return el.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max ? v : null;
  };
  return showDialog<Asked>({
    title: "Grade Settings",
    okLabel: "OK",
    cls: "site-section-dialog",
    body: [
      ...objectBody,
      heading("Global Settings: Display"),
      row("Arrow Line Length", arrowLength, "page mm"),
      row("Arrow Offset", arrowOffset, "page mm"),
      row("Grade Definition", definition),
      row("Precision", precision),
      heading("Directional Indicator"),
      row("Pen thickness", arrowMils, "mils"),
      h("div", { cls: "site-colour-row" }, h("span", { text: "Color" }), arrowColour.el),
      row("End Marker", arrowMarker),
      row("Opacity", arrowOpacity, "%"),
      heading("Reshape Setting"),
      preserve.row,
      heading("Analyze Grade Objects"),
      h("div", { cls: "site-colour-row" }, highlight.row, highlightColour.el),
      selectCritical.row,
      checkSlope.row,
      row("From", slopeMin, "%"),
      row("To", slopeMax, "%"),
      checkElevation.row,
      row("From", elevationMin),
      row("To", elevationMax),
      intersections.row,
    ],
    check: () => {
      const r = globalOnly ? { e1: start.e1, e2: start.e2 } : solved();
      if (!r) return { error: "Those two parameters don't give the two elevations: type a value for each.", focus: firstVal };
      const scale = fig(markerScale, 0.01, 100);
      if (!globalOnly && scale === null) return { error: "Type a marker scale from 0.01 to 100.", focus: markerScale };
      const pts = fig(textPoints, 1, 500);
      if (!globalOnly && pts === null) return { error: "Type a text size of 1 point or more.", focus: textPoints };
      const al = fig(arrowLength, 0.1, 1000);
      if (al === null) return { error: "Type an arrow length over zero.", focus: arrowLength };
      const ao = fig(arrowOffset, 0, 1000);
      if (ao === null) return { error: "Type an arrow offset of zero or more.", focus: arrowOffset };
      const pr = fig(precision, 0, 6);
      if (pr === null || !Number.isInteger(pr)) return { error: "Type a precision of 0 to 6 places.", focus: precision };
      const am = fig(arrowMils, 1, 500);
      if (am === null) return { error: "Type a pen thickness of 1 or more.", focus: arrowMils };
      const op = fig(arrowOpacity, 0, 100);
      if (op === null) return { error: "Type an opacity from 0 to 100.", focus: arrowOpacity };
      const [s0, s1] = [fig(slopeMin, 0, 1e6), fig(slopeMax, 0, 1e6)];
      if (s0 === null || s1 === null || s1 < s0) return { error: "Type a grade range from low to high.", focus: slopeMin };
      const [e0, e1] = [parseLength(elevationMin.value, units), parseLength(elevationMax.value, units)];
      if (e0 === null || e1 === null || e1 < e0) return { error: "Type an elevation range from low to high.", focus: elevationMin };
      return {
        value: {
          e1: r.e1,
          e2: r.e2,
          first: firstSel.value as GradeParameter,
          second: secondSel.value as GradeParameter,
          look: {
            marker: marker.value,
            markerScale: scale ?? k.markerScale,
            showSlope: showSlope.input.checked,
            showProjected: showProjected.input.checked,
            projectedPrefix: projectedPrefix.value,
            showSurface: showSurface.input.checked,
            surfacePrefix: surfacePrefix.value,
            below: below.input.checked,
            showElevation: showElevation.input.checked,
            drawLine: drawLine.input.checked,
            textPoints: pts ?? k.textPoints,
            mode: mode.value,
            apply: apply.value,
          },
          globals: {
            arrowLength: al,
            arrowOffset: ao,
            definition: definition.value as GradeDefinition,
            precision: pr,
            arrowMils: am,
            arrowColour: arrowColour.get(),
            arrowMarker: arrowMarker.value as GradeGlobals["arrowMarker"],
            arrowOpacity: op,
            preserve: preserve.input.checked,
            highlight: highlight.input.checked,
            highlightColour: highlightColour.get(),
            selectCritical: selectCritical.input.checked,
            checkSlope: checkSlope.input.checked,
            slopeMin: s0,
            slopeMax: s1,
            checkElevation: checkElevation.input.checked,
            elevationMin: e0,
            elevationMax: e1,
            intersections: intersections.input.checked,
          },
        },
      };
    },
  });
}

const lookOf = (g: Grade): GradeLook => ({
  marker: String(g.value(FIELD.marker) ?? BUILT_IN_MARKER),
  markerScale: num(g, FIELD.markerScale) || 1,
  showSlope: g.value(FIELD.showSlope) === true,
  showProjected: g.value(FIELD.showProjected) === true,
  projectedPrefix: String(g.value(FIELD.projectedPrefix) ?? ""),
  showSurface: g.value(FIELD.showSurface) === true,
  surfacePrefix: String(g.value(FIELD.surfacePrefix) ?? ""),
  below: g.value(FIELD.below) === true,
  showElevation: g.value(FIELD.showElevation) === true,
  drawLine: g.value(FIELD.drawLine) === true,
  textPoints: num(g, FIELD.textPoints) || 8,
  mode: String(g.value(FIELD.mode) ?? MODES[0]),
  apply: String(g.value(FIELD.apply) ?? APPLY[0]),
});

function afterSettings(selectThem: boolean, critical: readonly string[]): void {
  if (selectThem) setSelection([...critical]);
  appContext()?.requestDraw();
}

async function openSettings(id: string): Promise<void> {
  const session = store.session;
  const g = session ? gradeById(session.doc, id) : null;
  if (!session || !g) return;
  const asked = await settingsDialog(session.doc, { e1: num(g, FIELD.e1), e2: num(g, FIELD.e2), length: num(g, FIELD.length), look: lookOf(g), first: "Elevation 1", second: "Elevation 2" });
  if (!asked || store.session !== session) return;
  const r = attempt("Grade Settings", (s) =>
    s.batch(() => {
      const live = gradeById(s.doc, id);
      if (!live) throw new Error("That grade object has gone.");
      for (const [field, value] of Object.entries(lookValues(asked.look))) s.setRecordField(id, live.format, field, value);
      const changed = new Set<string>([id]);
      const site = asked.look.mode === MODES[1] ? fromSite(s, live) : null;
      setElevations(s, id, site?.e1 ?? asked.e1, site?.e2 ?? asked.e2, changed);
      const critical = applyGlobals(s, asked.globals);
      for (const other of changed) redraw(s, other);
      return critical;
    }),
  );
  if (r) afterSettings(asked.globals.selectCritical, r.value);
}

/** The tool's Preferences: the global settings alone. */
export async function gradePreferences(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const asked = await settingsDialog(session.doc, { e1: lastAsked.e1, e2: lastAsked.e2, length: 1000, look: lastAsked, first: "Elevation 1", second: "Elevation 2" }, true);
  if (!asked || store.session !== session) return;
  const r = attempt("Grade Settings", (s) => s.batch(() => (gradesIn(s.doc).length ? applyGlobals(s, asked.globals) : (rememberedGlobals = asked.globals, []))));
  if (r) afterSettings(asked.globals.selectCritical, r.value);
}

/** Settings given before any grade exists to keep them. */
let rememberedGlobals: GradeGlobals | null = null;

/** What's under a point to take its height from: a grade's end or line, a 3D locus or stake, then a site model. */
function heightUnder(s: EditSession, p: Pt, reach: number, apply: string): number | null {
  for (const line of linesOf(s, gradesIn(s.doc))) {
    const near = closestOn(p, line.a, line.b);
    if (near.off <= reach) return line.e1 + (line.e2 - line.e1) * near.t;
  }
  for (const layer of s.doc.layers()) {
    for (const o of s.doc.objects(layer.id)) {
      if (o.type !== LOCUS3D) continue;
      const q = s.curvePoints(o.id)?.points[0];
      if (q && Math.hypot(q[0] - p.x, q[1] - p.y) <= reach) return q[2] - (layer.elevation ?? 0);
    }
  }
  for (const m of modelsIn(s.doc)) {
    const t = terrainOf(m);
    const z = (apply === APPLY[1] ? t.existingAt : t.proposedAt)(p.x, p.y);
    if (z !== null) return z;
  }
  return null;
}

/** Splits a grade where a new end lands partway along it. */
function splitAt(s: EditSession, line: GradeLine, t: number): void {
  const g = gradeById(s.doc, line.id);
  if (!g) return;
  const whole = num(g, FIELD.length);
  const at = { x: line.a.x + (line.b.x - line.a.x) * t, y: line.a.y + (line.b.y - line.a.y) * t };
  const mid = line.e1 + (line.e2 - line.e1) * t;
  const values: Record<string, RecordValue> = {};
  for (const name of Object.values(FIELD)) values[name] = g.value(name) as RecordValue;
  values[FIELD.e1] = mid;
  values[FIELD.e2] = line.e2;
  values[FIELD.length] = whole * (1 - t);
  const specs = specsOf(values);
  const turn = s.pluginAngle(line.id);
  const other = s.addPluginObject(g.layerId, GRADE, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, turn, s.doc.object(line.id)?.classIndex ?? store.activeClassIndex);
  s.setRecordField(line.id, g.format, FIELD.length, whole * t);
  s.setRecordField(line.id, g.format, FIELD.e2, mid);
  redraw(s, line.id);
  redraw(s, other);
}

/** The Grade tool's two clicks: the settings, then the object. */
export async function placeGrade(layerId: string, a: Pt, b: Pt): Promise<void> {
  const session = store.session;
  if (!session) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(length > 0)) return;
  const reach = 6 / (appContext()?.view.scale ?? 1);
  const e1 = heightUnder(session, a, reach, lastAsked.apply) ?? lastAsked.e2;
  const e2 = heightUnder(session, b, reach, lastAsked.apply) ?? lastAsked.e2;
  const asked = await settingsDialog(session.doc, { e1, e2, length, look: lastAsked, first: lastAsked.first, second: lastAsked.second });
  if (!asked || store.session !== session) return;
  Object.assign(lastAsked, asked.look, { first: asked.first, second: asked.second, e1: asked.e1, e2: asked.e2 });
  const r = attempt("Grade", (s) =>
    s.batch(() => {
      // a new end partway along a grade splits that grade, and they share the elevation there
      const before = linesOf(s, gradesIn(s.doc));
      for (const p of [a, b]) {
        for (const line of before) {
          if (line.detached) continue;
          const near = closestOn(p, line.a, line.b);
          const len = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
          if (near.off <= reach && near.t * len > reach && (1 - near.t) * len > reach) {
            splitAt(s, line, near.t);
            break;
          }
        }
      }
      const globals = rememberedGlobals ?? asked.globals;
      const values: Record<string, RecordValue> = { ...lookValues(asked.look), [FIELD.e1]: asked.e1, [FIELD.e2]: asked.e2, [FIELD.length]: length, [FIELD.global]: JSON.stringify(globals) };
      const specs = specsOf(values);
      const turn = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      const id = s.addPluginObject(layerId, GRADE, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), a, turn, store.activeClassIndex);
      const g = gradeById(s.doc, id) as Grade;
      const changed = new Set<string>([id]);
      const site = asked.look.mode === MODES[1] ? fromSite(s, g) : null;
      setElevations(s, id, site?.e1 ?? asked.e1, site?.e2 ?? asked.e2, changed);
      redraw(s, id);
      const critical = applyGlobals(s, asked.globals);
      for (const other of changed) redraw(s, other);
      return { id, critical };
    }),
  );
  rememberedGlobals = null;
  if (!r) return;
  setSelection(asked.globals.selectCritical && r.value.critical.length ? r.value.critical : [r.value.id]);
  appContext()?.requestDraw();
}

/** Edit Elevation mode: a click at the end of a grade. */
export async function editElevationAt(p: Pt, reach: number): Promise<boolean> {
  const session = store.session;
  if (!session) return false;
  const units = session.doc.info.units;
  const lines = linesOf(session, gradesIn(session.doc));
  let hit: { line: GradeLine; end: 1 | 2 } | null = null;
  let best = reach;
  for (const line of lines) {
    for (const [at, end] of [[line.a, 1], [line.b, 2]] as const) {
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d <= best) {
        best = d;
        hit = { line, end };
      }
    }
  }
  if (!hit) return false;
  const chosen = hit;
  const way = select(["Elevation at Selected End Marker", "Offset Selected Grade Objects", "Offset All Grade Objects"], "Elevation at Selected End Marker", "Change");
  const value = input(formatLengthValue(chosen.end === 1 ? chosen.line.e1 : chosen.line.e2, units), "Elevation or offset");
  way.addEventListener("change", () => {
    value.value = way.value === "Elevation at Selected End Marker" ? formatLengthValue(chosen.end === 1 ? chosen.line.e1 : chosen.line.e2, units) : formatLengthValue(0, units);
  });
  const asked = await showDialog<{ way: string; value: number }>({
    title: "Edit Elevation",
    okLabel: "OK",
    body: [row("Change", way), row("Value", value)],
    check: () => {
      const v = parseLength(value.value, units);
      return v === null ? { error: "Type a length.", focus: value } : { value: { way: way.value, value: v } };
    },
  });
  if (!asked || store.session !== session) return true;
  attempt("Edit Elevation", (s) =>
    s.batch(() => {
      const changed = new Set<string>();
      if (asked.way === "Elevation at Selected End Marker") setElevations(s, chosen.line.id, chosen.end === 1 ? asked.value : null, chosen.end === 2 ? asked.value : null, changed);
      else {
        const grades = gradesIn(s.doc).filter((g) => asked.way === "Offset All Grade Objects" || store.selection.has(g.id) || g.id === chosen.line.id);
        for (const g of grades) {
          s.setRecordField(g.id, g.format, FIELD.e1, num(g, FIELD.e1) + asked.value);
          s.setRecordField(g.id, g.format, FIELD.e2, num(g, FIELD.e2) + asked.value);
          changed.add(g.id);
        }
      }
      analyse(s, globalsOf(s.doc), changed);
    }),
  );
  appContext()?.requestDraw();
  return true;
}

const selectedGrades = (doc: VwxDocument): ObjectInfo[] => selectedTop(doc).filter((o) => gradeOf(doc, o.id, o.layerId));

export const canMakeGradeLoci = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && !!store.activeLayerId && doc.hasPluginFormat(GRADE) && selectedGrades(doc).length > 0;
};

/** AEC > Terrain > Create 3D Loci at Grade Points. */
export function gradeLociCommand(): void {
  const doc = store.session?.doc;
  const layerId = store.activeLayerId;
  if (!doc || !layerId) return;
  const picked = selectedGrades(doc);
  if (!picked.length) {
    toast("Select one or more grade objects first.", "error");
    return;
  }
  const r = attempt("Create 3D Loci at Grade Points", (s) =>
    s.batch(() => {
      const levelOf = (id: string): number => s.doc.layers().find((l) => l.id === id)?.elevation ?? 0;
      const here = levelOf(layerId);
      const points: number[][] = [];
      for (const o of picked) {
        const g = gradeOf(s.doc, o.id, o.layerId);
        const ends = g ? endsOf(s, g) : null;
        if (!g || !ends) continue;
        const lift = levelOf(o.layerId) - here;
        for (const [at, z] of [[ends.a, num(g, FIELD.e1)], [ends.b, num(g, FIELD.e2)]] as const) {
          if (!points.some((q) => Math.hypot(q[0] - at.x, q[1] - at.y) <= 1)) points.push([at.x, at.y, z + lift]);
        }
      }
      return s.add3DLoci(layerId, points, store.activeClassIndex);
    }),
  );
  if (!r) return;
  setSelection(r.value);
  appContext()?.requestDraw();
  toast(`${r.value.length} 3D loci placed at the grade points.`, "info");
}
