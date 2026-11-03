// Space Planning's adjacency objects, drawn from the spaces in the drawing and kept up with them: Space Link, a
// line between two spaces as heavy as their relationship is strong; Adjacency Score, the sum of links' lengths
// × strengths; Adjacency Matrix, the spaces with their links' strengths in a diamond grid; Stacking Diagram, the
// spaces floor by floor as wide as their areas. Each keeps a fingerprint of what it was drawn from, and after
// each edit the ones whose spaces or links have changed are drawn again in the same undo step. A link whose
// space has gone goes with it.

import type { Attributes, EditSession, PluginFieldSpec, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import { adjacencyScore, clampStrength, fingerprint, linkEnds, linkWeight, matrixDrawing, stackDrawing, type DiagramText, type MatrixCell, type StackRow } from "./adjacencyShapes.ts";
import { attempt, setEditGroup, turnAbout } from "./commands.ts";
import { followEdits, registerPluginDrivers, type PluginDriver, type PluginWidget } from "./ext.ts";
import { pointInPolygon } from "./geom.ts";
import { spaceOf } from "./planShapes.ts";
import { layerScaleOf, SPACE_FORMAT, spacesOn, recordFormat } from "./spaces.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { formatArea, parseLength } from "./units.ts";

export const SPACE_LINK = "Space Link";
export const ADJACENCY_MATRIX = "Adjacency Matrix";
export const ADJACENCY_SCORE = "Adjacency Score";
export const STACKING_DIAGRAM = "Stacking Diagram";
const NAMES: readonly string[] = [SPACE_LINK, ADJACENCY_MATRIX, ADJACENCY_SCORE, STACKING_DIAGRAM];

const PLUGIN = 86;
const BOOL = 2;
const NUMBER = 3;
const TEXT = 4;
const V_CENTRE = 3;
/** a stacking diagram's outlines and department lines, and its lines within a department, mils */
const HEAVY_MILS = 20;
const THIN_MILS = 4;

const FIELD = {
  strength: "Strength",
  from: "From Space",
  to: "To Space",
  fromId: "From Id",
  toId: "To Id",
  height: "Height Scale",
  width: "Width Scale",
  gap: "Gap Scale",
  totals: "Show Totals",
  size: "Text Size",
  rotation: "Rotation",
  drawn: "Drawn From",
} as const;

/** what the tools place next */
export const adjacencySettings = {
  strength: 5,
  heightScale: 1,
  widthScale: 1,
  gapScale: 1,
  showTotals: true,
  textSize: 2.5,
};

type Fill = Pick<Attributes, "fillPattern" | "fillFore" | "fillBack" | "fillOpacity">;

export interface SpaceNode {
  readonly id: string;
  readonly name: string;
  readonly department: string;
  /** a space's Matrix Order: those without one follow those with, in the drawing's order */
  readonly order: number;
  readonly area: number;
  readonly at: Pt;
  readonly ring: readonly Pt[];
  readonly layerId: string;
  readonly fill: Fill;
}

/** The spaces on the drawing's design layers. */
export function spaceNodes(doc: VwxDocument): SpaceNode[] {
  const out: SpaceNode[] = [];
  for (const layer of doc.layers()) {
    if (layer.kind !== "design") continue;
    for (const sp of spacesOn(layer.id)) {
      const figures = spaceOf(sp.ring);
      if (!figures) continue;
      const fields = doc.records(sp.obj.id).find((r) => r.name === SPACE_FORMAT)?.fields ?? [];
      const value = (name: string): RecordValue | undefined => fields.find((f) => f.name === name)?.value;
      const given = String(value("Space Name") ?? "").trim();
      const a = sp.boundary.attrs;
      out.push({
        id: sp.obj.id,
        name: given && given !== "Space" ? given : (sp.obj.name ?? "Space"),
        department: String(value("Department") ?? "").trim(),
        order: Number(value("Matrix Order")) || 0,
        area: figures.area,
        at: figures.labelAt,
        ring: figures.outline,
        layerId: layer.id,
        fill: a ? { fillPattern: a.fillPattern, fillFore: a.fillFore, fillBack: a.fillBack, fillOpacity: a.fillOpacity } : { fillPattern: 0, fillFore: 0, fillBack: 0, fillOpacity: 100 },
      });
    }
  }
  return out;
}

let memo: { session: EditSession; nodes: readonly SpaceNode[] } | null = null;
const watched = new WeakSet<EditSession>();

/** The drawing's spaces, read once per change: the Space Link tool asks as the pointer moves. */
function liveNodes(session: EditSession): readonly SpaceNode[] {
  if (memo?.session === session) return memo.nodes;
  if (!watched.has(session)) {
    watched.add(session);
    session.onChange(() => {
      if (memo?.session === session) memo = null;
    });
  }
  const nodes = spaceNodes(session.doc);
  memo = { session, nodes };
  return nodes;
}

/** The space at a point: on the active layer before any other, and the smallest of those there. */
export function spaceAt(p: Pt): SpaceNode | null {
  const session = store.session;
  if (!session) return null;
  const here = liveNodes(session).filter((n) => pointInPolygon(p, n.ring));
  const rank = (n: SpaceNode): number => (n.layerId === store.activeLayerId ? 0 : 1);
  return here.sort((a, b) => rank(a) - rank(b) || a.area - b.area)[0] ?? null;
}

interface Diagram {
  readonly id: string;
  readonly layerId: string;
  readonly plugin: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
}

/** One of ours: Vectorworks' own objects of these names keep to themselves, whatever they hold. */
function diagramOf(doc: VwxDocument, id: string, layerId: string): Diagram | null {
  const rec = doc.records(id).find((r) => r.parametric && NAMES.includes(r.name) && r.fields.some((f) => f.name === FIELD.drawn));
  return rec ? { id, layerId, plugin: rec.name, format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value } : null;
}

function diagramsIn(doc: VwxDocument): Diagram[] {
  if (!NAMES.some((name) => doc.hasPluginFormat(name))) return [];
  const out: Diagram[] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const d = diagramOf(doc, o.id, layer.id);
      if (d) out.push(d);
    }
  }
  return out;
}

interface Link {
  readonly id: string;
  readonly a: SpaceNode;
  readonly b: SpaceNode;
  readonly strength: number;
}

/** What the diagrams are drawn from. */
interface Plan {
  readonly nodes: readonly SpaceNode[];
  readonly links: readonly Link[];
  /** links missing a space */
  readonly broken: readonly string[];
}

function planOf(doc: VwxDocument, diagrams: readonly Diagram[]): Plan {
  const nodes = spaceNodes(doc);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links: Link[] = [];
  const broken: string[] = [];
  for (const d of diagrams) {
    if (d.plugin !== SPACE_LINK) continue;
    const a = byId.get(String(d.value(FIELD.fromId) ?? ""));
    const b = byId.get(String(d.value(FIELD.toId) ?? ""));
    if (a && b) links.push({ id: d.id, a, b, strength: clampStrength(Number(d.value(FIELD.strength))) });
    else broken.push(d.id);
  }
  return { nodes, links, broken };
}

const scaleOf = (d: Diagram, field: string): number => {
  const n = Number(d.value(field));
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const textHeightOf = (d: Diagram): number => (Number(d.value(FIELD.size)) > 0 ? Number(d.value(FIELD.size)) : adjacencySettings.textSize) * layerScaleOf(d.layerId);

const units = (s: EditSession): string | undefined => s.doc.info.units;

function matrixOf(plan: Plan): { names: string[]; cells: MatrixCell[] } {
  const rank = (n: SpaceNode): number => n.order || Number.POSITIVE_INFINITY;
  const ordered = plan.nodes.map((n, i) => ({ n, i })).sort((a, b) => (rank(a.n) === rank(b.n) ? a.i - b.i : rank(a.n) - rank(b.n))).map((x) => x.n);
  const row = new Map(ordered.map((n, i) => [n.id, i]));
  const cells = plan.links.map((l): MatrixCell => {
    const i = row.get(l.a.id) ?? 0;
    const j = row.get(l.b.id) ?? 0;
    return { i: Math.min(i, j), j: Math.max(i, j), strength: l.strength };
  });
  return { names: ordered.map((n) => n.name), cells };
}

function stackRowsOf(doc: VwxDocument, plan: Plan): StackRow<Fill>[] {
  const out: StackRow<Fill>[] = [];
  for (const layer of doc.layers()) {
    const here = plan.nodes.filter((n) => n.layerId === layer.id);
    if (here.length) out.push({ name: layer.name, elevation: layer.elevation ?? 0, spaces: here.map((n) => ({ name: n.name, department: n.department, area: n.area, fill: n.fill })) });
  }
  return out;
}

function scoreText(s: EditSession, plan: Plan): string {
  const unit = parseLength("1", units(s)) || 1;
  const score = adjacencyScore(plan.links.map((l) => ({ length: Math.hypot(l.b.at.x - l.a.at.x, l.b.at.y - l.a.at.y) / unit, strength: l.strength })));
  return `Score: ${Math.round(score)}`;
}

const stackOptions = (s: EditSession, d: Diagram) => ({
  textHeight: textHeightOf(d),
  heightScale: scaleOf(d, FIELD.height),
  widthScale: scaleOf(d, FIELD.width),
  gapScale: scaleOf(d, FIELD.gap),
  showTotals: d.value(FIELD.totals) === true,
  areaText: (area: number) => formatArea(area, units(s)),
});

/** A fingerprint of everything a diagram is drawn from. */
function drawnFrom(s: EditSession, d: Diagram, plan: Plan): string {
  if (d.plugin === SPACE_LINK) {
    const link = plan.links.find((l) => l.id === d.id);
    // moved or turned by itself it goes back between its spaces
    return fingerprint(link ? [link.a.ring, link.b.ring, link.a.at, link.b.at, link.a.name, link.b.name, link.strength, s.doc.object(d.id)?.insertion, s.pluginAngle(d.id)] : null);
  }
  if (d.plugin === ADJACENCY_SCORE) return fingerprint([scoreText(s, plan), textHeightOf(d)]);
  if (d.plugin === ADJACENCY_MATRIX) return fingerprint([matrixOf(plan), textHeightOf(d), scaleOf(d, FIELD.height), scaleOf(d, FIELD.width)]);
  const o = stackOptions(s, d);
  return fingerprint([stackRowsOf(s.doc, plan), o.textHeight, o.heightScale, o.widthScale, o.gapScale, o.showTotals, units(s)]);
}

/** Puts what `build` adds in as the object's drawing, in its own frame. */
function drawInto(s: EditSession, d: Diagram, build: (add: (shape: Parameters<EditSession["addObject"]>[1], attrs?: Partial<Attributes>) => void) => void): void {
  const classIndex = s.doc.object(d.id)?.classIndex ?? store.activeClassIndex;
  const ids: string[] = [];
  build((shape, attrs) => void ids.push(s.addObject(d.layerId, shape, classIndex, attrs)));
  s.setPluginDrawing(d.id, ids);
}

/** Lines and outlines in the active pen: left to itself a new object takes the look of one like it. */
const pen = (mils: number): Partial<Attributes> => ({ ...store.drawAttrs, fillPattern: 0, lineStyle: 2, lineWeight: mils });
const NO_FILL = { fillPattern: 0 };

function textParts(texts: readonly DiagramText[]): Parameters<EditSession["addObject"]>[1][] {
  return texts.map((t) => ({ kind: "text", at: t.at, text: t.text, height: t.height, hAlign: t.hAlign, vAlign: V_CENTRE, angle: 0 }) as Parameters<EditSession["addObject"]>[1]);
}

function drawLink(s: EditSession, d: Diagram, plan: Plan): void {
  const link = plan.links.find((l) => l.id === d.id);
  const obj = s.doc.object(d.id);
  if (!link || !obj) return;
  // it stands at the first space's centre
  const at = obj.insertion;
  if (at && (at.x !== link.a.at.x || at.y !== link.a.at.y)) s.moveObjects([d.id], link.a.at.x - at.x, link.a.at.y - at.y);
  const turn = (-s.pluginAngle(d.id) * Math.PI) / 180;
  const local = (p: Pt): Pt => {
    const x = p.x - link.a.at.x;
    const y = p.y - link.a.at.y;
    return { x: x * Math.cos(turn) - y * Math.sin(turn), y: x * Math.sin(turn) + y * Math.cos(turn) };
  };
  const [p, q] = linkEnds(link.a.at, link.a.ring, link.b.at, link.b.ring);
  drawInto(s, d, (add) => add({ kind: "line", a: local(p), b: local(q) }, pen(linkWeight(link.strength))));
  s.setRecordField(d.id, d.format, FIELD.from, link.a.name);
  s.setRecordField(d.id, d.format, FIELD.to, link.b.name);
}

function drawMatrix(s: EditSession, d: Diagram, plan: Plan): void {
  const { names, cells } = matrixOf(plan);
  const height = textHeightOf(d);
  const m = matrixDrawing(names, cells, height, scaleOf(d, FIELD.height), scaleOf(d, FIELD.width));
  drawInto(s, d, (add) => {
    for (const box of m.boxes) add({ kind: "polygon", points: [...box], closed: true }, pen(THIN_MILS));
    for (const [a, b] of m.lines) add({ kind: "line", a, b }, pen(THIN_MILS));
    for (const t of textParts(m.texts)) add(t, NO_FILL);
    if (!names.length) add({ kind: "text", at: { x: 0, y: 0 }, text: "Adjacency Matrix: no spaces yet", height, hAlign: 1, vAlign: V_CENTRE, angle: 0 } as Parameters<EditSession["addObject"]>[1], NO_FILL);
  });
}

function drawScore(s: EditSession, d: Diagram, plan: Plan): void {
  drawInto(s, d, (add) => add({ kind: "text", at: { x: 0, y: 0 }, text: scoreText(s, plan), height: textHeightOf(d), hAlign: 1, vAlign: V_CENTRE, angle: 0 } as Parameters<EditSession["addObject"]>[1], NO_FILL));
}

function drawStack(s: EditSession, d: Diagram, plan: Plan): void {
  const rows = stackRowsOf(s.doc, plan);
  const o = stackOptions(s, d);
  const drawing = stackDrawing(rows, o);
  drawInto(s, d, (add) => {
    for (const seg of drawing.segments) add({ kind: "polygon", points: [...seg.points], closed: true }, { ...store.drawAttrs, ...seg.fill, lineStyle: 0 });
    for (const [a, b] of drawing.thin) add({ kind: "line", a, b }, pen(THIN_MILS));
    for (const [a, b] of drawing.heavy) add({ kind: "line", a, b }, pen(HEAVY_MILS));
    for (const outline of drawing.outlines) add({ kind: "polygon", points: [...outline], closed: true }, pen(HEAVY_MILS));
    for (const t of textParts(drawing.texts)) add(t, NO_FILL);
    if (!rows.length) add({ kind: "text", at: { x: 0, y: 0 }, text: "Stacking Diagram: no spaces yet", height: o.textHeight, hAlign: 1, vAlign: V_CENTRE, angle: 0 } as Parameters<EditSession["addObject"]>[1], NO_FILL);
  });
}

function draw(s: EditSession, d: Diagram, plan: Plan): void {
  if (d.plugin === SPACE_LINK) drawLink(s, d, plan);
  else if (d.plugin === ADJACENCY_MATRIX) drawMatrix(s, d, plan);
  else if (d.plugin === ADJACENCY_SCORE) drawScore(s, d, plan);
  else drawStack(s, d, plan);
  s.setRecordField(d.id, d.format, FIELD.drawn, drawnFrom(s, d, plan));
}

const drawLive = (s: EditSession, id: string): void => {
  const layerId = s.doc.object(id)?.layerId;
  const d = layerId ? diagramOf(s.doc, id, layerId) : null;
  if (!d) throw new Error("That isn't one of the space planning objects.");
  draw(s, d, planOf(s.doc, diagramsIn(s.doc)));
};

const hasRotation = (d: Diagram): boolean => d.plugin !== SPACE_LINK;
const turned = (s: EditSession, d: Diagram): boolean => hasRotation(d) && Math.abs(Number(d.value(FIELD.rotation)) - s.pluginAngle(d.id)) > 1e-6;

/** Draws again the diagrams whose spaces or links have changed, and takes away links that have lost a space. */
function keepDiagrams(s: EditSession): void {
  const diagrams = diagramsIn(s.doc);
  if (!diagrams.length) return;
  const plan = planOf(s.doc, diagrams);
  const live = diagrams.filter((d) => !plan.broken.includes(d.id));
  const stale = live.filter((d) => String(d.value(FIELD.drawn) ?? "") !== drawnFrom(s, d, plan));
  const rotated = live.filter((d) => turned(s, d));
  if (!stale.length && !rotated.length && !plan.broken.length) return;
  s.followOn(() => {
    if (plan.broken.length) s.deleteObjects([...plan.broken]);
    for (const d of stale) draw(s, d, plan);
    for (const d of rotated) s.setRecordField(d.id, d.format, FIELD.rotation, s.pluginAngle(d.id));
  });
}
followEdits(keepDiagrams);

const specsOf = (plugin: string): PluginFieldSpec[] => {
  const p = adjacencySettings;
  const size: PluginFieldSpec = { name: FIELD.size, type: NUMBER, value: p.textSize };
  const rotation: PluginFieldSpec = { name: FIELD.rotation, type: NUMBER, value: 0 };
  const drawn: PluginFieldSpec = { name: FIELD.drawn, type: TEXT, value: "" };
  if (plugin === SPACE_LINK) {
    return [
      { name: FIELD.strength, type: NUMBER, value: p.strength },
      { name: FIELD.from, type: TEXT, value: "" },
      { name: FIELD.to, type: TEXT, value: "" },
      { name: FIELD.fromId, type: TEXT, value: "" },
      { name: FIELD.toId, type: TEXT, value: "" },
      drawn,
    ];
  }
  if (plugin === ADJACENCY_SCORE) return [rotation, size, drawn];
  const scales: PluginFieldSpec[] = [
    rotation,
    { name: FIELD.height, type: NUMBER, value: p.heightScale },
    { name: FIELD.width, type: NUMBER, value: p.widthScale },
  ];
  if (plugin === ADJACENCY_MATRIX) return [...scales, size, drawn];
  return [...scales, { name: FIELD.gap, type: NUMBER, value: p.gapScale }, { name: FIELD.totals, type: BOOL, value: p.showTotals }, size, drawn];
};

function addObject(s: EditSession, plugin: string, layerId: string, at: Pt, angle: number, values: Readonly<Record<string, RecordValue>> = {}): string {
  const specs = specsOf(plugin).map((f) => (f.name in values ? { ...f, value: values[f.name] } : f));
  return s.addPluginObject(layerId, plugin, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, angle, store.activeClassIndex);
}

/** Adds a matrix, score or stacking diagram at `at`, drawn from the drawing's spaces, as part of a batch; its id. */
export function addDiagram(s: EditSession, plugin: string, layerId: string, at: Pt, angle: number, textSize = adjacencySettings.textSize): string {
  recordFormat(s);
  const id = addObject(s, plugin, layerId, at, angle, { [FIELD.size]: textSize });
  s.setRecordField(id, s.doc.records(id).find((r) => r.parametric)?.format ?? 0, FIELD.rotation, s.pluginAngle(id));
  drawLive(s, id);
  return id;
}

/** How far a matrix on this layer would reach, for the drawing's spaces. */
export function matrixWidth(s: EditSession, layerId: string, textSize: number): number {
  const { names, cells } = matrixOf(planOf(s.doc, diagramsIn(s.doc)));
  return matrixDrawing(names, cells, textSize * layerScaleOf(layerId), adjacencySettings.heightScale, adjacencySettings.widthScale).width;
}

/** Adds a link between two spaces, as part of a batch; its id. */
export function addLink(s: EditSession, from: string, to: string, strength: number): string {
  if (from === to) throw new Error("A space can't be linked to itself.");
  const doc = s.doc;
  const diagrams = diagramsIn(doc);
  const pair = new Set([from, to]);
  if (diagrams.some((d) => d.plugin === SPACE_LINK && pair.has(String(d.value(FIELD.fromId))) && pair.has(String(d.value(FIELD.toId))))) throw new Error("Those two spaces are already linked.");
  const space = doc.object(from);
  const at = spaceNodes(doc).find((n) => n.id === from)?.at;
  if (!space || !at) throw new Error("That isn't a space.");
  recordFormat(s);
  const id = addObject(s, SPACE_LINK, space.layerId, at, 0, { [FIELD.strength]: clampStrength(strength), [FIELD.fromId]: from, [FIELD.toId]: to });
  drawLive(s, id);
  return id;
}

/** The Space Link tool's last click. */
export function linkSpaces(from: string, to: string): void {
  const r = attempt("Space Link", (s) => s.batch(() => addLink(s, from, to, adjacencySettings.strength)));
  if (r) setEditGroup(null, [r.value]);
}

/** The Adjacency Matrix, Adjacency Score and Stacking Diagram tools' last click. */
export function placeDiagram(plugin: string, layerId: string, at: Pt, angle: number): void {
  const r = attempt(plugin, (s) => s.batch(() => addDiagram(s, plugin, layerId, at, angle)));
  if (r) setEditGroup(null, [r.value]);
}

/** Turns an object about where it stands, to this angle in degrees. */
function turnTo(s: EditSession, id: string, degrees: number): void {
  const at = s.doc.object(id)?.insertion;
  if (at) s.transformObjects([id], turnAbout(at, degrees - s.pluginAngle(id)));
}

function edit(id: string, plugin: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt(`Edit ${plugin}`, (s) =>
    s.batch(() => {
      const layerId = s.doc.object(id)?.layerId;
      const d = layerId ? diagramOf(s.doc, id, layerId) : null;
      if (!d) throw new Error("That isn't one of the space planning objects.");
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, d.format, field, field === FIELD.strength ? clampStrength(Number(value)) : value);
      if (FIELD.rotation in values) turnTo(s, id, Number(values[FIELD.rotation]) || 0);
      drawLive(s, id);
    }),
  );
}

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const TEXT_LABEL: Readonly<Record<string, string>> = {
  [FIELD.strength]: "Strength (1 to 18)",
  [FIELD.rotation]: "Rotation (degrees)",
  [FIELD.size]: "Text Size (mm on paper)",
};

function driverOf(plugin: string, widgets: readonly PluginWidget[], readOnly: readonly string[] = []): PluginDriver {
  return {
    name: plugin,
    shape: "point",
    builtIn: true,
    label: (field) => TEXT_LABEL[field],
    readOnly: (field) => readOnly.includes(field),
    choices: () => undefined,
    place(layerId, at, angle) {
      if (plugin === SPACE_LINK) toast("Use the Space Link tool: click one space, then the other.", "info");
      else placeDiagram(plugin, layerId, at, angle);
    },
    edit: (id, values) => edit(id, plugin, values),
    async reset(id) {
      const s = store.session;
      if (!s) return "No drawing is open.";
      try {
        s.batch(() => drawLive(s, id));
        return null;
      } catch (err) {
        return errorMessage(err);
      }
    },
    layout: () => widgets,
    widgetStates: () => {},
    press: () => {},
  };
}

registerPluginDrivers(() => [
  driverOf(SPACE_LINK, [param(1, FIELD.strength), param(2, FIELD.from), param(3, FIELD.to)], [FIELD.from, FIELD.to]),
  driverOf(ADJACENCY_MATRIX, [param(1, FIELD.rotation), param(2, FIELD.height), param(3, FIELD.width), param(4, FIELD.size)]),
  driverOf(ADJACENCY_SCORE, [param(1, FIELD.rotation), param(2, FIELD.size)]),
  driverOf(STACKING_DIAGRAM, [param(1, FIELD.rotation), param(2, FIELD.height), param(3, FIELD.width), param(4, FIELD.gap), param(5, FIELD.totals), param(6, FIELD.size)]),
]);
