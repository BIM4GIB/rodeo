// Associative dimensions, as Vectorworks makes them with Associate dimensions on (its default): a
// linear dimension the Dimension tool places from one object's vertex to another's (or the same
// one's) keeps which vertices they are, and when an edit moves them the dimension follows, its line
// as far from them as before, its value measured again unless it says something of its own. The
// top-most object with a vertex there is the one taken (Vectorworks' Auto associate). Moving or
// reshaping the dimension by itself, or deleting a vertex's object, breaks the link, as Vectorworks
// does for an angular one; Disassociate on the dimension's right-click menu breaks it too.
// Vectorworks ties them with coincident constraints, both ways (moving the dimension moves the
// object); Rodeo keeps the link in a record of its own and follows one way. Dimension objects and
// dimensions drawn as plain pieces both follow, the pieces drawn again; chains and baselines don't.

import type { BBox, EditSession, Pt, VwxDocument } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { dimensionValue, frameLayout, linearDrawing, normalOf, type DimensionAxis, type DimensionDrawing, type DimensionFrame } from "./dimension.ts";
import { followEdits } from "./ext.ts";
import { store } from "./state.ts";
import { addDimensionDrawings } from "./tools/dimension.ts";
import { toast } from "./toast.ts";
import { parseLength } from "./units.ts";

const FORMAT = "Rodeo Associated Dimension";
const F_FROM = "From";
const F_TO = "To";
const F_AXIS = "Axis";
const F_OFFSET = "Offset";
const F_MEASURED = "Measured";
const F_BOX = "Box";
const FIELDS = [F_FROM, F_TO, F_AXIS, F_OFFSET, F_MEASURED, F_BOX];
/** how near a vertex must be to a dimension's point to be the one it measures, and how far one may move unnoticed (mm) */
const NEAR = 1e-3;
/** Vectorworks' dimension object */
const DIMENSION = 63;
/** a value that reads as its length to within this (mm) shows its measurement, as Object Info has it */
const MEASURED_MM = 2;

/** A vertex of an object: its id and where in its shape's points it is. */
interface Vertex {
  readonly id: string;
  readonly index: number;
}

/** What an associated dimension keeps: the vertices it measures, its kind and offset, and where it last was. */
interface Link {
  readonly from: Vertex;
  readonly to: Vertex;
  readonly axis: DimensionAxis;
  /** how far its line lies from the first point, along normalOf */
  readonly offset: number;
  /** the points it measured when it last followed */
  readonly measured: readonly [Pt, Pt];
  /** a dimension drawn as pieces: their box then; null for a dimension object */
  readonly box: BBox | null;
}

const same = (p: Pt, q: Pt): boolean => Math.abs(p.x - q.x) <= NEAR && Math.abs(p.y - q.y) <= NEAR;
const sameBox = (a: BBox, b: BBox): boolean => same({ x: a.x0, y: a.y0 }, { x: b.x0, y: b.y0 }) && same({ x: a.x1, y: a.y1 }, { x: b.x1, y: b.y1 });
const num = (v: number): string => String(Math.round(v * 1e6) / 1e6);
const nums = (v: unknown): number[] => String(v ?? "").split(/\s+/).filter(Boolean).map(Number);

/** The point of a vertex as its object stands now, or null when the object or the vertex is gone. */
function vertexAt(doc: VwxDocument, v: Vertex): Pt | null {
  const pts = doc.object(v.id)?.shape?.points;
  return pts && v.index < pts.length ? pts[v.index] : null;
}

/** The top-most object on `layerId` with a vertex at `p`: not `not` or what it holds, nor a dimension's lines. */
function vertexNear(doc: VwxDocument, layerId: string, p: Pt, not: string): Vertex | null {
  const all = doc.objects(layerId);
  for (let i = all.length - 1; i >= 0; i--) {
    const o = all[i];
    if (o.id === not || o.parentId === not) continue;
    if (o.parentId && doc.object(o.parentId)?.type === DIMENSION) continue;
    const s = o.shape;
    if (!s || s.kind === "text" || !s.points?.length) continue;
    const index = s.points.findIndex((q) => same(p, q));
    if (index >= 0) return { id: o.id, index };
  }
  return null;
}

/** The box of what the group `id` holds. */
function piecesBox(doc: VwxDocument, layerId: string, id: string): BBox | null {
  let box: BBox | null = null;
  for (const o of doc.objects(layerId)) {
    const b = o.parentId === id ? o.shape?.bbox : null;
    if (b) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : { ...b };
  }
  return box;
}

function formatOf(doc: VwxDocument): number | null {
  return doc.recordFormats().find((f) => f.name === FORMAT)?.format ?? null;
}

/** The link the dimension `id` keeps, or null when it has none (or a damaged one). */
function readLink(doc: VwxDocument, id: string): Link | null {
  const rec = doc.records(id).find((r) => !r.parametric && r.name === FORMAT);
  if (!rec) return null;
  const field = (name: string): unknown => rec.fields.find((f) => f.name === name)?.value;
  const vertex = (name: string): Vertex | null => {
    const [vid, index] = String(field(name) ?? "").split(/\s+/);
    const n = Number(index);
    return vid && Number.isInteger(n) && n >= 0 ? { id: vid, index: n } : null;
  };
  const from = vertex(F_FROM);
  const to = vertex(F_TO);
  const axis = String(field(F_AXIS) ?? "");
  const offset = Number(field(F_OFFSET));
  const m = nums(field(F_MEASURED));
  const b = nums(field(F_BOX));
  if (!from || !to || !["horizontal", "vertical", "aligned"].includes(axis) || !Number.isFinite(offset) || m.length !== 4 || m.some(Number.isNaN)) return null;
  return {
    from,
    to,
    axis: axis as DimensionAxis,
    offset,
    measured: [
      { x: m[0], y: m[1] },
      { x: m[2], y: m[3] },
    ],
    box: b.length === 4 && !b.some(Number.isNaN) ? { x0: b[0], y0: b[1], x1: b[2], y1: b[3] } : null,
  };
}

function writeLink(s: EditSession, id: string, link: Link): void {
  const format = formatOf(s.doc) ?? s.createRecordFormat(FORMAT, FIELDS.map((name) => ({ name, kind: "text" as const, value: "" })));
  if (!s.doc.records(id).some((r) => !r.parametric && r.name === FORMAT)) s.attachRecord([id], format);
  const [a, b] = link.measured;
  const box = link.box;
  const values: Record<string, string> = {
    [F_FROM]: `${link.from.id} ${link.from.index}`,
    [F_TO]: `${link.to.id} ${link.to.index}`,
    [F_AXIS]: link.axis,
    [F_OFFSET]: num(link.offset),
    [F_MEASURED]: [a.x, a.y, b.x, b.y].map(num).join(" "),
    [F_BOX]: box ? [box.x0, box.y0, box.x1, box.y1].map(num).join(" ") : "",
  };
  for (const [name, value] of Object.entries(values)) s.setRecordField(id, format, name, value);
}

/** The dimensions of each open drawing known to hold a link (some may have lost it since): read once, then added to as they're made. */
const linked = new WeakMap<EditSession, Set<string>>();

function linkedIn(s: EditSession): Set<string> {
  let ids = linked.get(s);
  if (ids) return ids;
  ids = new Set();
  linked.set(s, ids);
  if (formatOf(s.doc) !== null)
    for (const layer of s.doc.layers())
      for (const o of s.doc.objects(layer.id)) if (o.kind !== "text" && readLink(s.doc, o.id)) ids.add(o.id);
  return ids;
}

/**
 * Links the dimension `id` the Dimension tool has just made on `layerId` from `drawing` to the
 * vertices at its two points, when objects there have them; in the caller's batch.
 */
export function associateDimension(s: EditSession, id: string, layerId: string, drawing: DimensionDrawing): void {
  const linear = drawing.linear;
  if (!linear) return;
  const from = vertexNear(s.doc, layerId, linear.a, id);
  const to = from && vertexNear(s.doc, layerId, linear.b, id);
  if (!from || !to) return;
  const axis = linear.axis ?? "aligned";
  const n = normalOf({ axis, u: linear.u });
  const offset = (linear.at.x - linear.a.x) * n.x + (linear.at.y - linear.a.y) * n.y;
  const native = s.linearDimension(id) !== null;
  writeLink(s, id, { from, to, axis, offset, measured: [linear.a, linear.b], box: native ? null : piecesBox(s.doc, layerId, id) });
  linkedIn(s).add(id);
}

/** True when the dimension `id` follows objects, so its right-click menu offers Disassociate. */
export function isAssociated(id: string | null): id is string {
  const doc = store.session?.doc;
  return !!id && !!doc && formatOf(doc) !== null && readLink(doc, id) !== null;
}

/** Disassociate: the dimension `id` stops following its objects, staying as it is. */
export function disassociate(id: string): void {
  const format = store.session && formatOf(store.session.doc);
  if (format === null || format === undefined) return;
  if (attempt("Disassociate", (s) => s.detachRecord([id], format))) toast("The dimension no longer follows its objects.", "info");
}

/** What follows makes of one dimension: nothing, a note of where it is now, a new drawing, or its link broken. */
type Step = { kind: "note"; link: Link } | { kind: "follow"; a: Pt; b: Pt } | { kind: "break" } | null;

function stepFor(s: EditSession, id: string, layerId: string, link: Link): Step {
  const a = vertexAt(s.doc, link.from);
  const b = vertexAt(s.doc, link.to);
  if (!a || !b) return { kind: "break" };
  const objectMoved = !same(a, link.measured[0]) || !same(b, link.measured[1]);
  const dim = s.linearDimension(id);
  const box = dim ? null : piecesBox(s.doc, layerId, id);
  // a dimension object Rodeo can't read is known by its pieces' box, which only shows once the edit that made it is done
  if (!dim && !link.box) return objectMoved ? { kind: "follow", a, b } : box ? { kind: "note", link: { ...link, box } } : null;
  // the dimension moved: a dimension object's points, or the pieces' box
  const dimMoved = dim ? !same(dim.a, link.measured[0]) || !same(dim.b, link.measured[1]) : !!link.box && (!box || !sameBox(box, link.box));
  if (!objectMoved) return dimMoved ? { kind: "break" } : null;
  if (!dimMoved) return { kind: "follow", a, b };
  // both moved: together (selected and moved as one), or the object reshaped as well
  if (dim) return same(dim.a, a) && same(dim.b, b) ? { kind: "note", link: { ...link, measured: [a, b] } } : { kind: "follow", a, b };
  const d = { x: a.x - link.measured[0].x, y: a.y - link.measured[0].y };
  const together = same({ x: b.x - link.measured[1].x, y: b.y - link.measured[1].y }, d) && box && link.box && same({ x: box.x0 - link.box.x0, y: box.y0 - link.box.y0 }, d);
  return together ? { kind: "note", link: { ...link, measured: [a, b], box } } : { kind: "follow", a, b };
}

/** The way a dimension object of `axis` runs from `a` to `b` (one level or upright turned about when b lies behind a, as the object needs b further along); null when they don't span it. */
function frameFor(axis: DimensionAxis, a: Pt, b: Pt, u0: Pt): DimensionFrame | null {
  if (axis === "aligned") {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return len > NEAR ? { axis, u: { x: (b.x - a.x) / len, y: (b.y - a.y) / len } } : null;
  }
  const along = (b.x - a.x) * u0.x + (b.y - a.y) * u0.y;
  if (Math.abs(along) <= NEAR) return null;
  return { axis, u: along > 0 ? u0 : { x: -u0.x, y: -u0.y } };
}

/** Moves the dimension `id` onto its vertices now at `a` and `b`; the id it has after (pieces are drawn anew). */
function follow(s: EditSession, id: string, layerId: string, link: Link, a: Pt, b: Pt): string {
  const units = s.doc.info.units;
  const dim = s.linearDimension(id);
  if (dim) {
    const f = frameFor(link.axis, a, b, link.axis === "horizontal" ? { x: 1, y: 0 } : link.axis === "vertical" ? { x: 0, y: 1 } : dim.u);
    if (!f) return id;
    const shown = parseLength(dim.value, units);
    const measured = shown !== null && Math.abs(shown - dim.length) < MEASURED_MM;
    const length = Math.abs((b.x - a.x) * f.u.x + (b.y - a.y) * f.u.y);
    // the object's offset is to the left of its direction: a level or upright one turned about keeps its line on the same side
    const turned = link.axis !== "aligned" && dim.u.x * f.u.x + dim.u.y * f.u.y < 0;
    s.setLinearDimension(id, { a, b, u: f.u, offset: turned ? -dim.offset : dim.offset, value: measured ? dimensionValue(length, units) : undefined });
    writeLink(s, id, { ...link, measured: [a, b] });
    return id;
  }
  // drawn as pieces: a level or upright one runs along x or y whichever way its points lie, as the tool draws it
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const u = link.axis === "aligned" ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : link.axis === "vertical" ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const along = (b.x - a.x) * u.x + (b.y - a.y) * u.y;
  const layer = s.doc.layers().find((l) => l.id === layerId);
  if (!(len > NEAR) || !(Math.abs(along) > NEAR) || !layer) return id;
  const frame: DimensionFrame = { axis: link.axis, u };
  const n = normalOf(frame);
  const layout = frameLayout(a, b, { x: a.x + n.x * link.offset, y: a.y + n.y * link.offset }, frame, layer.scale > 0 ? layer.scale : 1);
  if (!layout) return id;
  const classIndex = s.doc.object(id)?.classIndex ?? store.activeClassIndex;
  s.deleteObjects([id]);
  const next = addDimensionDrawings(s, layerId, [linearDrawing(layout, dimensionValue(layout.length, units))], classIndex);
  writeLink(s, next, { ...link, measured: [a, b], box: s.linearDimension(next) ? null : piecesBox(s.doc, layerId, next) });
  return next;
}

/** After each edit: dimensions whose vertices moved follow them; those moved by themselves, or whose objects went, let go. */
function keepFollowing(s: EditSession): void {
  const format = formatOf(s.doc);
  if (format === null) return;
  const ids = linkedIn(s);
  const steps: { id: string; layerId: string; link: Link; step: NonNullable<Step> }[] = [];
  for (const id of ids) {
    const o = s.doc.object(id);
    const link = o && readLink(s.doc, id);
    if (!o || !link) continue;
    const step = stepFor(s, id, o.layerId, link);
    if (step) steps.push({ id, layerId: o.layerId, link, step });
  }
  if (!steps.length) return;
  const renamed = new Map<string, string>();
  s.followOn(() => {
    for (const { id, layerId, link, step } of steps) {
      if (step.kind === "break") s.detachRecord([id], format);
      else if (step.kind === "note") writeLink(s, id, step.link);
      else {
        const next = follow(s, id, layerId, link, step.a, step.b);
        if (next !== id) renamed.set(id, next);
      }
    }
  });
  for (const to of renamed.values()) ids.add(to);
  // pieces drawn anew: their box, now that they show
  const boxes = [...renamed.values()].flatMap((id) => {
    const o = s.doc.object(id);
    const link = o && !s.linearDimension(id) && readLink(s.doc, id);
    const box = link && !link.box && piecesBox(s.doc, o.layerId, id);
    return link && box ? [{ id, link: { ...link, box } }] : [];
  });
  if (boxes.length) s.followOn(() => boxes.forEach(({ id, link }) => writeLink(s, id, link)));
  // a dimension drawn anew stays selected
  if ([...renamed.keys()].some((id) => store.selection.has(id))) setSelection([...store.selection].map((id) => renamed.get(id) ?? id));
}
followEdits(keepFollowing);
