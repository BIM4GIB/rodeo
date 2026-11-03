// Modify commands that reshape geometry. Compose joins the selected lines, open
// polylines, open polygons and arcs whose ends meet into one polyline, or into a
// closed polygon when the chain closes; arcs are sampled into points. Decompose
// breaks rectangles, polygons and polylines into their edges as separate lines.
// Convert to Polygons turns rectangles, polylines and arcs (circles and ellipses
// too) into polygons, Convert to Lines turns them and polygons into the lines of
// their outlines (arcs sampled), and Poly Smoothing makes every vertex of the selected
// polygons and polylines a corner, a bezier or cubic control point, an arc or a radius vertex. Each command replaces the objects with replaceObjects, so
// the results take the place, class and attributes of the bottom-most object they
// came from; the whole command is one undo step and the results are selected.
// Only the top-level objects of the edit scope (the active layer, or the group
// being edited) are used, never symbol contents.

import type { BBox, HelixOptions, NewShape, ObjectInfo, Pt, Shape, VertexKind } from "../core/index.ts";
import { MAX_CSG_TRIANGLES, outward, unionMeshes } from "../core/csg.ts";
import { attempt, setSelection } from "./commands.ts";
import { bboxOfPoints, dist, ellipsePoints, unionBBox } from "./geom.ts";
import { radiusVertices } from "./radiusPolyline.ts";
import { isClosedMesh } from "./solidOps.ts";
import { isDerivedId } from "./scene.ts";
import { arcRadii, isClosedShape, isFullArc, shapeBBox } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** Points per full turn when an arc, circle or ellipse is sampled into points. */
const SAMPLES_PER_TURN = 96;
/** Points closer than this (document units) are the same point. */
const SAME_POINT = 1e-9;
/** Chaining tolerance as a fraction of the diagonal of the pieces' bounds. */
const CHAIN_TOL = 1e-7;

/** An open run of points for chaining, tagged with the key (object id) it came from. */
export interface Run<K> {
  readonly key: K;
  readonly pts: readonly Pt[];
  readonly closed: boolean;
}

/** A chain of runs: their keys in chain order, the joined points, and whether the ends meet. */
export interface Chain<K> {
  readonly keys: K[];
  /** the points; a closed chain does not repeat its first point at the end */
  readonly pts: Pt[];
  readonly closed: boolean;
}

function near(a: Pt, b: Pt, tol: number): boolean {
  return dist(a, b) <= tol;
}

function isOpen<K>(run: Run<K>): boolean {
  return !run.closed && run.pts.length >= 2;
}

/** True when the chain's ends meet and it has at least three distinct points. */
function meets(pts: readonly Pt[], tol: number): boolean {
  return pts.length >= 4 && near(pts[0], pts[pts.length - 1], tol);
}

/**
 * The points of a chain with `run` joined on at one end (run reversed when that
 * is where they meet), or null when no end of the chain meets either end of the run.
 */
function joinPts(pts: readonly Pt[], run: readonly Pt[], tol: number): { pts: Pt[]; atEnd: boolean } | null {
  const head = pts[0];
  const tail = pts[pts.length - 1];
  const first = run[0];
  const last = run[run.length - 1];
  if (near(tail, first, tol)) return { pts: [...pts, ...run.slice(1)], atEnd: true };
  if (near(tail, last, tol)) return { pts: [...pts, ...run.slice(0, -1).reverse()], atEnd: true };
  if (near(head, last, tol)) return { pts: [...run.slice(0, -1), ...pts], atEnd: false };
  if (near(head, first, tol)) return { pts: [...run.slice(1).reverse(), ...pts], atEnd: false };
  return null;
}

/** The first unused open run that meets either end of the chain, or null. */
function findJoin<K>(
  runs: readonly Run<K>[],
  used: readonly boolean[],
  pts: readonly Pt[],
  tol: number,
): { index: number; pts: Pt[]; atEnd: boolean } | null {
  for (let j = 0; j < runs.length; j++) {
    if (used[j] || !isOpen(runs[j])) continue;
    const joined = joinPts(pts, runs[j].pts, tol);
    if (joined) return { index: j, ...joined };
  }
  return null;
}

/**
 * Joins open runs whose ends meet within `tol` into chains. Runs may be
 * reversed to join. A chain starts at the first unused run and grows at either
 * end with the first unused run that meets it, until nothing meets either end
 * or its ends meet, which closes it. Closed runs are never chained, and a run
 * that meets no other is left out.
 */
export function chainSegments<K>(runs: readonly Run<K>[], tol: number): Chain<K>[] {
  const used: boolean[] = runs.map(() => false);
  const chains: Chain<K>[] = [];
  for (let i = 0; i < runs.length; i++) {
    if (used[i] || !isOpen(runs[i])) continue;
    used[i] = true;
    const keys: K[] = [runs[i].key];
    let pts: Pt[] = [...runs[i].pts];
    while (!meets(pts, tol)) {
      const join = findJoin(runs, used, pts, tol);
      if (!join) break;
      used[join.index] = true;
      pts = join.pts;
      if (join.atEnd) keys.push(runs[join.index].key);
      else keys.unshift(runs[join.index].key);
    }
    if (keys.length < 2) continue;
    const closed = meets(pts, tol);
    if (closed) pts.pop();
    chains.push({ keys, pts, closed });
  }
  return chains;
}

/** Chaining tolerance for a set of runs: a fixed fraction of the diagonal of their bounds. */
function chainTolerance<K>(runs: readonly Run<K>[]): number {
  let box: BBox | null = null;
  for (const r of runs) box = unionBBox(box, bboxOfPoints(r.pts));
  const diag = box ? Math.hypot(box.x1 - box.x0, box.y1 - box.y0) : 0;
  return Math.max(diag * CHAIN_TOL, SAME_POINT);
}

/**
 * Points along an arc, circle or ellipse, SAMPLES_PER_TURN per full turn. A full
 * turn does not repeat its first point at the end. Null when the arc has no radius or sweep.
 */
export function sampleArc(shape: Shape): Pt[] | null {
  const c = shape.center;
  const r = arcRadii(shape);
  const sweep = shape.sweepAngle ?? 360;
  if (!c || !r || !(r.rx > 0 && r.ry > 0) || !(Math.abs(sweep) > 0)) return null;
  const start = shape.startAngle ?? 0;
  if (isFullArc(shape)) {
    const pts = ellipsePoints(c, r.rx, r.ry, start, 360, SAMPLES_PER_TURN);
    pts.pop();
    return pts;
  }
  const steps = Math.max(2, Math.ceil((SAMPLES_PER_TURN * Math.abs(sweep)) / 360));
  return ellipsePoints(c, r.rx, r.ry, start, sweep, steps);
}

/** The edges of a rectangle, polygon or polyline as separate lines; null for other shapes. */
export function edgeLines(shape: Shape): NewShape[] | null {
  if (shape.kind !== "rect" && shape.kind !== "polygon" && shape.kind !== "polyline") return null;
  const pts = shape.points;
  const closed = shape.kind === "rect" || shape.closed;
  const count = closed ? pts.length : pts.length - 1;
  const out: NewShape[] = [];
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (dist(a, b) > SAME_POINT) out.push({ kind: "line", a, b });
  }
  return out;
}

/** The polygon a rectangle, polyline or arc becomes (closed when the source is closed); null for other shapes. */
export function polygonOf(shape: Shape): NewShape | null {
  switch (shape.kind) {
    case "rect":
      return { kind: "polygon", points: shape.points.slice(), closed: true };
    case "polyline":
      return shape.points.length >= 2 ? { kind: "polygon", points: shape.points.slice(), closed: shape.closed } : null;
    case "arc": {
      const pts = sampleArc(shape);
      return pts ? { kind: "polygon", points: pts, closed: isFullArc(shape) } : null;
    }
    default:
      return null;
  }
}

/** The run an object adds to a chain: a line, an open polyline or polygon, or a partial arc. Null for anything else. */
function openRun(o: ObjectInfo): Run<string> | null {
  const shape = o.shape;
  if (!shape) return null;
  if (shape.kind === "line") return { key: o.id, pts: shape.points, closed: false };
  if (shape.kind === "polyline" || shape.kind === "polygon") {
    return isClosedShape(shape) ? null : { key: o.id, pts: shape.points, closed: false };
  }
  if (shape.kind === "arc" && !isFullArc(shape)) {
    const pts = sampleArc(shape);
    return pts ? { key: o.id, pts, closed: false } : null;
  }
  return null;
}

/** The selected objects with geometry on the edit scope, in stacking order; symbol contents are left out. */
export function selectedObjects(): ObjectInfo[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && o.shape !== null && o.parentId === scope && !isDerivedId(o.id));
}

// ---- Select Connected Objects ---------------------------------------------

/** The objects on the edit scope that can meet others end to end (lines, open polylines and polygons, partial arcs), with their runs. */
function scopeRuns(): Run<string>[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return [];
  const scope = store.editGroupId;
  const runs: Run<string>[] = [];
  for (const o of s.doc.objects(layerId)) {
    if (o.parentId !== scope || isDerivedId(o.id)) continue;
    const run = openRun(o);
    if (run && run.pts.length >= 2) runs.push(run);
  }
  return runs;
}

/** True when the selection holds a line, open polyline or polygon, or partial arc to start from. */
export function canSelectConnected(): boolean {
  return selectedObjects().some((o) => openRun(o) !== null);
}

/**
 * Edit > Select Connected Objects: adds to the selection every line, open polyline or polygon and
 * partial arc on the layer (or in the group being edited) that meets a selected one end to end,
 * and those that meet them, and so on.
 */
export function selectConnectedObjects(): void {
  const runs = scopeRuns();
  const tol = chainTolerance(runs);
  // ends hashed in cells a tolerance wide, so each is compared only with those around it
  const cell = tol * 4;
  const key = (p: Pt, dx = 0, dy = 0): string => `${Math.floor(p.x / cell) + dx},${Math.floor(p.y / cell) + dy}`;
  const ends = new Map<string, { id: string; p: Pt }[]>();
  const endsOf = (r: Run<string>): Pt[] => [r.pts[0], r.pts[r.pts.length - 1]];
  for (const r of runs) {
    for (const p of endsOf(r)) {
      const k = key(p);
      ends.set(k, [...(ends.get(k) ?? []), { id: r.key, p }]);
    }
  }
  const byId = new Map(runs.map((r) => [r.key, r]));
  const reached = new Set<string>();
  const queue = selectedObjects()
    .map((o) => o.id)
    .filter((id) => byId.has(id));
  for (const id of queue) reached.add(id);
  while (queue.length) {
    const r = byId.get(queue.pop()!)!;
    for (const p of endsOf(r)) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const e of ends.get(key(p, dx, dy)) ?? []) {
            if (reached.has(e.id) || !near(p, e.p, tol)) continue;
            reached.add(e.id);
            queue.push(e.id);
          }
        }
      }
    }
  }
  const added = [...reached].filter((id) => !store.selection.has(id));
  if (added.length === 0) {
    toast("Nothing else meets the selection end to end.", "info");
    return;
  }
  setSelection([...store.selection, ...added]);
}

// ---- Compose --------------------------------------------------------------

/** The chains the selection makes; none when fewer than two pieces meet. */
function composeChains(): Chain<string>[] {
  const runs: Run<string>[] = [];
  for (const o of selectedObjects()) {
    const run = openRun(o);
    if (run) runs.push(run);
  }
  return runs.length < 2 ? [] : chainSegments(runs, chainTolerance(runs));
}

/** The polyline or polygon a chain becomes. */
function chainShape(c: Chain<string>): NewShape {
  return c.closed
    ? { kind: "polygon", points: c.pts, closed: true }
    : { kind: "polyline", points: c.pts, closed: false };
}

export function canCompose(): boolean {
  return composeChains().length > 0;
}

/** Joins the selected pieces that meet end to end; each chain becomes a polyline, or a polygon when it closes. */
export function composeSelection(): void {
  const chains = composeChains();
  if (chains.length === 0) {
    toast("Compose needs lines, open polylines or arcs whose ends meet.", "info");
    return;
  }
  const r = attempt("Compose", (s) =>
    s.batch(() => chains.flatMap((c) => s.replaceObjects(c.keys, [chainShape(c)]))),
  );
  if (r) setSelection(r.value);
}

// ---- Decompose ------------------------------------------------------------

interface Job<T> {
  readonly id: string;
  readonly result: T;
}

/** Each selected rectangle, polygon or polyline with the lines of its edges. */
function decomposeJobs(): Job<NewShape[]>[] {
  const jobs: Job<NewShape[]>[] = [];
  for (const o of selectedObjects()) {
    const lines = o.shape ? edgeLines(o.shape) : null;
    if (lines && lines.length > 0) jobs.push({ id: o.id, result: lines });
  }
  return jobs;
}

export function canDecompose(): boolean {
  return decomposeJobs().length > 0;
}

/** Replaces each selected rectangle, polygon or polyline by its edges as separate lines. */
export function decomposeSelection(): void {
  const jobs = decomposeJobs();
  if (jobs.length === 0) {
    toast("Decompose works on rectangles, polygons and polylines.", "info");
    return;
  }
  const r = attempt("Decompose", (s) => s.batch(() => jobs.flatMap((j) => s.replaceObjects([j.id], j.result))));
  if (r) setSelection(r.value);
}

// ---- Convert to Polygons --------------------------------------------------

/** Each selected rectangle, polyline, arc, circle or ellipse with the polygon it becomes. */
function convertJobs(): Job<NewShape>[] {
  const jobs: Job<NewShape>[] = [];
  for (const o of selectedObjects()) {
    const poly = o.shape ? polygonOf(o.shape) : null;
    if (poly) jobs.push({ id: o.id, result: poly });
  }
  return jobs;
}

export function canConvertToPolygons(): boolean {
  return convertJobs().length > 0;
}

/** Replaces each selected rectangle, polyline, arc, circle or ellipse by a polygon (arcs are sampled). */
export function convertToPolygonsSelection(): void {
  const jobs = convertJobs();
  if (jobs.length === 0) {
    toast("Convert to Polygons works on rectangles, polylines, arcs, circles and ellipses.", "info");
    return;
  }
  const r = attempt("Convert to Polygons", (s) =>
    s.batch(() => jobs.flatMap((j) => s.replaceObjects([j.id], [j.result]))),
  );
  if (r) setSelection(r.value);
}

/**
 * Modify > Convert > Convert Copy to …: each object stays as it is and a copy of it, just above it,
 * becomes what it converts to, in one undo step; the converted copies are selected.
 */
function convertCopies(label: string, jobs: readonly { id: string; result: NewShape[] }[]): void {
  const r = attempt(label, (s) =>
    s.batch(() =>
      jobs.flatMap((j) => {
        const [copy] = s.duplicateObjects([j.id], 0, 0);
        return s.replaceObjects([copy], j.result);
      }),
    ),
  );
  if (r) setSelection(r.value);
}

/** Leaves each selected rectangle, polyline, arc, circle or ellipse and makes a polygon of a copy. */
export function convertCopyToPolygonsSelection(): void {
  const jobs = convertJobs();
  if (jobs.length === 0) {
    toast("Convert Copy to Polygons works on rectangles, polylines, arcs, circles and ellipses.", "info");
    return;
  }
  convertCopies("Convert Copy to Polygons", jobs.map((j) => ({ id: j.id, result: [j.result] })));
}

// ---- Convert to Polylines -------------------------------------------------

const RECT = 3;
const POLYGON = 5;
const ARC = 6;
const ROUND_RECT = 13;

/** Radii this close (a share of the larger) are one radius: the corner or arc is circular. */
const SAME_RADIUS = 1e-9;

function circular(rx: number, ry: number): boolean {
  return Number.isFinite(rx) && Number.isFinite(ry) && Math.abs(rx - ry) <= SAME_RADIUS * Math.max(rx, ry, 1);
}

/**
 * The polyline `o` becomes, tracing it exactly: a rectangle's or polygon's corners; a rounded
 * rectangle's corners with arc vertices of its radius; a circle as arc vertices at the corners of
 * its square; an arc from end to end through its middle. Null for anything else, ellipses and
 * elliptical corners among them, which a polyline's circular arcs can't trace.
 */
export function polylineOf(o: ObjectInfo): NewShape | null {
  const shape = o.shape;
  if (!shape) return null;
  if (o.type === RECT || (o.type === POLYGON && shape.points.length >= 2)) {
    return { kind: "polyline", points: shape.points.slice(), closed: o.type === RECT || shape.closed };
  }
  if (o.type === ROUND_RECT) {
    const rr = shape.roundRect;
    if (!rr || !circular(rr.rx, rr.ry)) return null;
    if (!(rr.rx > 0)) return { kind: "polyline", points: rr.corners.slice(), closed: true };
    return { kind: "polyline", points: rr.corners.slice(), closed: true, vertices: rr.corners.map(() => "arc"), radii: rr.corners.map(() => rr.rx) };
  }
  if (o.type !== ARC) return null;
  const r = arcRadii(shape);
  const c = shape.center;
  if (!r || !c || !circular(r.rx, r.ry) || !(r.rx > 0)) return null;
  const at = (deg: number): Pt => ({ x: c.x + r.rx * Math.cos((deg * Math.PI) / 180), y: c.y + r.rx * Math.sin((deg * Math.PI) / 180) });
  if (isFullArc(shape)) {
    const corners = [
      { x: c.x + r.rx, y: c.y - r.rx },
      { x: c.x + r.rx, y: c.y + r.rx },
      { x: c.x - r.rx, y: c.y + r.rx },
      { x: c.x - r.rx, y: c.y - r.rx },
    ];
    return { kind: "polyline", points: corners, closed: true, vertices: corners.map(() => "arc"), radii: corners.map(() => r.rx) };
  }
  const start = shape.startAngle ?? 0;
  const sweep = shape.sweepAngle ?? 0;
  if (!(Math.abs(sweep) > 0)) return null;
  return { kind: "polyline", points: [at(start), at(start + sweep / 2), at(start + sweep)], closed: false, vertices: ["corner", "through", "corner"] };
}

/** Each selected rectangle, rounded rectangle, polygon, circle or arc with the polyline it becomes. */
function polylineJobs(): Job<NewShape>[] {
  const jobs: Job<NewShape>[] = [];
  for (const o of selectedObjects()) {
    const poly = polylineOf(o);
    if (poly) jobs.push({ id: o.id, result: poly });
  }
  return jobs;
}

export function canConvertToPolylines(): boolean {
  return polylineJobs().length > 0;
}

/** Modify > Convert > Convert to Polylines: replaces each selected object a polyline traces exactly by that polyline, its vertices editable. */
export function convertToPolylinesSelection(): void {
  const selected = selectedObjects().length;
  const jobs = polylineJobs();
  if (jobs.length === 0) {
    toast("Convert to Polylines works on rectangles, polygons, circles, circular arcs and rounded rectangles with round corners.", "info");
    return;
  }
  if (!store.session?.canAdd("polyline")) {
    toast("This drawing has no polyline to copy a new one's settings from.", "info");
    return;
  }
  const r = attempt("Convert to Polylines", (s) => s.batch(() => jobs.flatMap((j) => s.replaceObjects([j.id], [j.result]))));
  if (!r) return;
  setSelection(r.value);
  const left = selected - jobs.length;
  if (left > 0) toast(`${left} selected object${left === 1 ? "" : "s"} left as ${left === 1 ? "it was" : "they were"}: no polyline traces ${left === 1 ? "it" : "them"} exactly.`, "info");
}

// ---- Convert to Lines -----------------------------------------------------

/** The lines an outline becomes: a rectangle's, polygon's or polyline's edges, or an arc's samples joined. */
function outlineLines(shape: Shape): NewShape[] | null {
  if (shape.kind !== "arc") return edgeLines(shape);
  const pts = sampleArc(shape);
  return pts ? edgeLines({ ...shape, kind: "polygon", points: pts, closed: isFullArc(shape) }) : null;
}

/** Each selected rectangle, polygon, polyline, arc, circle or ellipse with the lines it becomes. */
function lineJobs(): Job<NewShape[]>[] {
  const jobs: Job<NewShape[]>[] = [];
  for (const o of selectedObjects()) {
    const lines = o.shape ? outlineLines(o.shape) : null;
    if (lines && lines.length > 0) jobs.push({ id: o.id, result: lines });
  }
  return jobs;
}

// ---- Convert to Group -----------------------------------------------------

/** a plug-in object's record type */
const PLUGIN = 86;

/** The selected symbol instances and plug-in objects, at the level being edited. */
function selectedConvertible(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && (o.kind === "symbol" || o.type === PLUGIN) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canConvertToGroup(): boolean {
  return selectedConvertible().length > 0;
}

/** Replaces each selected symbol instance or plug-in object by a group of copies of its contents (a plug-in's drawing), placed as it placed them. */
export function convertToGroupSelection(): void {
  const ids = selectedConvertible();
  if (ids.length === 0) {
    toast("Convert to Group works on symbols and plug-in objects.", "info");
    return;
  }
  const r = attempt("Convert to Group", (s) => s.batch(() => s.convertToGroups(ids)));
  if (r) setSelection(r.value);
}

// ---- Convert to 3D Polygons -------------------------------------------------

/** Objects that can show 3D faces: symbols, extrudes, sweeps, multiple extrudes, meshes, walls, slabs, solids and plug-ins. */
const SHOWS_3D: ReadonlySet<number> = new Set([15, 24, 34, 38, 40, 68, 71, 84, 86, 113]);

/** The selected objects that may show 3D faces, at the level being edited. */
function selected3D(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && SHOWS_3D.has(o.type) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canConvertTo3DPolygons(): boolean {
  return selected3D().length > 0;
}

/** Replaces each selected 3D object by a group of 3D polygons, one per flat face it shows. */
export function convertTo3DPolygonsSelection(): void {
  const ids = selected3D();
  if (ids.length === 0) {
    toast("Convert to 3D Polygons works on 3D objects, symbols and plug-in objects.", "info");
    return;
  }
  const r = attempt("Convert to 3D Polygons", (s) => s.convertTo3DPolygons(ids));
  if (r) setSelection(r.value);
}

// ---- Convert to Mesh -----------------------------------------------------------

/** The selected objects Convert to Mesh takes: those that may show 3D faces, and 3D polygons, but not meshes. */
function selectedMeshable(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && (SHOWS_3D.has(o.type) || o.type === 25) && o.type !== 40 && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canConvertToMesh(): boolean {
  return selectedMeshable().length > 0;
}

/** Replaces each selected 3D object by a mesh of the flat faces it shows. */
export function convertToMeshSelection(): void {
  const ids = selectedMeshable();
  if (ids.length === 0) {
    toast("Convert to Mesh works on 3D objects, symbols and plug-in objects.", "info");
    return;
  }
  const r = attempt("Convert to Mesh", (s) => s.convertToMeshes(ids));
  if (r) setSelection(r.value);
}

// ---- Model > Create Contours -----------------------------------------------------

/** The selected objects Create Contours cuts: those that may show 3D faces, and 3D polygons. */
export function selectedCuttable(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && (SHOWS_3D.has(o.type) || o.type === 25) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canCreateContours(): boolean {
  return selectedCuttable().length > 0;
}

/** Cuts each selected 3D object with planes square to `axis`, from `start` every `interval` (mm), and selects the contours. */
export function contourSelection(axis: 0 | 1 | 2, start: number, interval: number): void {
  const ids = selectedCuttable();
  if (ids.length === 0) {
    toast("Create Contours works on 3D objects, symbols and plug-in objects.", "info");
    return;
  }
  const r = attempt("Create Contours", (s) => s.createContours(ids, axis, start, interval));
  if (r) setSelection(r.value);
}

// ---- Model > Extrude ---------------------------------------------------------

/** Shapes Model > Extrude takes as profiles: rectangles, rounded rectangles, polygons, polylines, and whole circles and ellipses. */
const EXTRUDABLE: ReadonlySet<number> = new Set([3, 5, 6, 13, 21]);
/** Extrudes, sweeps, multiple extrudes and solids. */
export const SOLID_OPERANDS: ReadonlySet<number> = new Set([24, 34, 38, 84]);

/** The selected shapes that can be extruded, at the level being edited. */
function selectedExtrudable(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && EXTRUDABLE.has(o.type) && o.shape && (o.type !== 6 || isFullArc(o.shape)) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canExtrude(): boolean {
  return selectedExtrudable().length > 0;
}

/** Replaces each selected closed shape by an extrude `height` (mm) tall holding it as its profile. */
export function extrudeSelection(height: number): void {
  const ids = selectedExtrudable();
  if (ids.length === 0) {
    toast("Extrude works on rectangles, polygons, polylines, circles and ellipses.", "info");
    return;
  }
  const r = attempt("Extrude", (s) => s.extrudeObjects(ids, height));
  if (r) setSelection(r.value);
}

/** Lines, arcs, rectangles, polygons, polylines, circles, ellipses and 3D polygons: what Extrude Along Path sweeps along. */
const PATHS: ReadonlySet<number> = new Set([2, 3, 5, 6, 13, 21, 25]);

/** One of the two objects Extrude Along Path takes, with whether it can be the profile and whether it can be the path. */
export interface SweepPart {
  readonly id: string;
  readonly typeName: string;
  /** its box's diagonal (mm) */
  readonly size: number;
  readonly profile: boolean;
  readonly path: boolean;
  /** closed in plan, so likelier the profile */
  readonly closed: boolean;
}

/** The two selected objects, at the level being edited, when one can be the profile and the other the path; else null. */
export function selectedProfileAndPath(): [SweepPart, SweepPart] | null {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size !== 2) return null;
  const scope = store.editGroupId;
  const parts = s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && o.parentId === scope && !isDerivedId(o.id))
    .map(
      (o): SweepPart => ({
        id: o.id,
        typeName: o.typeName,
        size: sizeOf(o.bounds ?? (o.shape ? shapeBBox(o.shape) : null)),
        profile: EXTRUDABLE.has(o.type) && !!o.shape && (o.type !== 6 || isFullArc(o.shape)),
        path: PATHS.has(o.type),
        closed: !!o.shape && isClosedShape(o.shape),
      }),
    );
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  return (a.profile && b.path) || (b.profile && a.path) ? [a, b] : null;
}

function sizeOf(b: BBox | null): number {
  return b ? Math.hypot(b.x1 - b.x0, b.y1 - b.y0) : 0;
}

export function canExtrudeAlongPath(): boolean {
  return selectedProfileAndPath() !== null;
}

/** Replaces the selected profile and path by a mesh of the profile swept along the path. */
export function extrudeAlongPathSelection(profileId: string, pathId: string, scale: number, lockPlane: boolean): void {
  const r = attempt("Extrude Along Path", (s) => s.extrudeAlongPath(profileId, pathId, scale, lockPlane));
  if (r) setSelection([r.value]);
}

/** The selected objects a helix-spiral can coil round, at the level being edited. */
function selectedPaths(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && PATHS.has(o.type) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canCreateHelixSpiral(): boolean {
  return selectedPaths().length > 0;
}

/** Replaces each selected path by a 3D polygon coiling round it. */
export function createHelixSpiralSelection(o: HelixOptions): void {
  const ids = selectedPaths();
  if (ids.length === 0) {
    toast("Create Helix-Spiral works on lines, arcs, rectangles, polygons, polylines, circles, ellipses and 3D polygons.", "info");
    return;
  }
  const r = attempt("Create Helix-Spiral", (s) => s.createHelixSpiral(ids, o));
  if (r) setSelection(r.value);
}

/** What Section Solids cuts: extrudes, sweeps, multiple extrudes, solids and meshes. */
const SECTIONABLE: ReadonlySet<number> = new Set([...SOLID_OPERANDS, 40]);

/** One of the two objects Section Solids takes, with whether it can be cut and whether it can cut. */
export interface SectionPart {
  readonly id: string;
  readonly typeName: string;
  readonly base: boolean;
  readonly cutter: boolean;
}

/**
 * The two selected objects, at the level being edited and backmost first, when one can be cut (a
 * solid or mesh) and the other cut it (a 3D polygon, solid or mesh); else null.
 */
export function selectedSolidAndCutter(): [SectionPart, SectionPart] | null {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size !== 2) return null;
  const scope = store.editGroupId;
  const parts = s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && o.parentId === scope && !isDerivedId(o.id))
    .map((o): SectionPart => ({ id: o.id, typeName: o.typeName, base: SECTIONABLE.has(o.type), cutter: o.type === 25 || SECTIONABLE.has(o.type) }));
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  return (a.base && b.cutter) || (b.base && a.cutter) ? [a, b] : null;
}

export function canSectionSolids(): boolean {
  return selectedSolidAndCutter() !== null;
}

/** Replaces the selected solid by a mesh of what is left of it once `cutterId` cuts it. */
export function sectionSolidSelection(baseId: string, cutterId: string, reverse: boolean, retain: boolean): void {
  const r = attempt("Section Solids", (s) => s.sectionSolid(baseId, cutterId, reverse, retain));
  if (r) setSelection([r.value]);
}

/** Replaces each selected closed shape by a mesh `height` (mm) tall whose sides lean in by `taper` degrees. */
export function taperedExtrudeSelection(height: number, taper: number): void {
  const ids = selectedExtrudable();
  if (ids.length === 0) {
    toast("Tapered Extrude works on rectangles, polygons, polylines, circles and ellipses.", "info");
    return;
  }
  const r = attempt("Tapered Extrude", (s) => s.taperedExtrudeObjects(ids, height, taper));
  if (r) setSelection(r.value);
}

/** Replaces each selected closed shape by a sweep turning it `arc` degrees about its left edge, in `segment`-degree steps. */
export function sweepSelection(arc: number, segment: number): void {
  const ids = selectedExtrudable();
  if (ids.length === 0) {
    toast("Sweep works on rectangles, polygons, polylines, circles and ellipses.", "info");
    return;
  }
  const r = attempt("Sweep", (s) => s.sweepObjects(ids, arc, segment));
  if (r) setSelection(r.value);
}

/** The selected objects Add Solids, Subtract Solids and Intersect Solids take: extrudes, multiple extrudes, sweeps and solids. */
function selectedSolids(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && SOLID_OPERANDS.has(o.type) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canCombineSolids(): boolean {
  return selectedSolids().length > 1;
}

/** The selected objects Add Solids takes: those above, and meshes, which come out as one mesh. */
function selectedAddable(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && (SOLID_OPERANDS.has(o.type) || o.type === 40) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

export function canAddSolids(): boolean {
  return selectedAddable().length > 1;
}

/**
 * Add Solids with a mesh among them: one mesh of them all in the backmost's place, its volume if each is
 * closed, and if any is open, as a planar cap is, their faces together.
 */
function addWithMeshes(ids: readonly string[]): void {
  const r = attempt("Add Solids", (s) =>
    s.batch(() => {
      const parts = ids.map((id) => s.solidTriangles(id));
      const added = parts.every(isClosedMesh) ? unionMeshes(parts)?.triangles : joinedFaces(parts);
      if (!added) throw new Error(`these objects have more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces between them, too many to add`);
      const id = s.replaceSolid(ids[0], added);
      s.deleteObjects(ids.slice(1));
      return id;
    }),
  );
  if (r) setSelection([r.value]);
}

/** Faces of open meshes as one, turned the way the whole they make faces. */
function joinedFaces(parts: readonly Float64Array[]): Float64Array {
  const all = new Float64Array(parts.reduce((n, t) => n + t.length, 0));
  parts.reduce((at, t) => (all.set(t, at), at + t.length), 0);
  return outward(all, 1e-3);
}

/** Replaces the selected solids by one solid adding them, or taking the others from the backmost. */
export function combineSolidsSelection(subtract: boolean): void {
  if (!subtract) {
    const addable = selectedAddable();
    if (addable.length > selectedSolids().length) {
      if (addable.length > 1) addWithMeshes(addable);
      else toast("Add Solids works on two or more extrudes, multiple extrudes, sweeps, solids and meshes.", "info");
      return;
    }
  }
  const ids = selectedSolids();
  const what = subtract ? "Subtract Solids" : "Add Solids";
  if (ids.length < 2) {
    toast(`${what} works on two or more extrudes, multiple extrudes, sweeps and solids.`, "info");
    return;
  }
  const r = attempt(what, (s) => s.combineSolids(ids, subtract));
  if (r) setSelection([r.value]);
}

/** Replaces the selected solids by a mesh of the volume they all share. */
export function intersectSolidsSelection(): void {
  const ids = selectedSolids();
  if (ids.length < 2) {
    toast("Intersect Solids works on two or more extrudes, multiple extrudes, sweeps and solids.", "info");
    return;
  }
  const r = attempt("Intersect Solids", (s) => s.intersectSolids(ids));
  if (r) setSelection([r.value]);
}

export function canMultiExtrude(): boolean {
  return selectedExtrudable().length > 1;
}

/** Replaces the selected closed shapes by one multiple extrude `height` (mm) tall through them, the backmost at the bottom. */
export function multiExtrudeSelection(height: number): void {
  const ids = selectedExtrudable();
  if (ids.length < 2) {
    toast("Multiple Extrude works on two or more rectangles, polygons, polylines, circles and ellipses.", "info");
    return;
  }
  const r = attempt("Multiple Extrude", (s) => s.multiExtrudeObjects(ids, height));
  if (r) setSelection([r.value]);
}

export function canConvertToLines(): boolean {
  return lineJobs().length > 0;
}

/** Replaces each selected rectangle, polygon, polyline, arc, circle or ellipse by the lines of its outline. */
export function convertToLinesSelection(): void {
  const jobs = lineJobs();
  if (jobs.length === 0) {
    toast("Convert to Lines works on rectangles, polygons, polylines, arcs, circles and ellipses.", "info");
    return;
  }
  const r = attempt("Convert to Lines", (s) => s.batch(() => jobs.flatMap((j) => s.replaceObjects([j.id], j.result))));
  if (r) setSelection(r.value);
}

/** Leaves each selected rectangle, polygon, polyline, arc, circle or ellipse and makes the lines of its outline from a copy. */
export function convertCopyToLinesSelection(): void {
  const jobs = lineJobs();
  if (jobs.length === 0) {
    toast("Convert Copy to Lines works on rectangles, polygons, polylines, arcs, circles and ellipses.", "info");
    return;
  }
  convertCopies("Convert Copy to Lines", jobs);
}

// ---- Smoothing ------------------------------------------------------------

/** What Modify > Poly Smoothing makes every vertex (radius: Arc Smoothing's curves as radius vertices). */
export type Smoothing = "corner" | "bezier" | "cubic" | "arc" | "radius";

/** A polygon's or polyline's own vertices (a polyline's before its curves are flattened) and kinds; null for other shapes. */
function controlVertices(shape: Shape): { pts: Pt[]; kinds: VertexKind[] } | null {
  if (shape.kind === "polygon" && shape.points.length >= 3) {
    return { pts: shape.points.slice(), kinds: shape.points.map(() => "corner") };
  }
  if (shape.kind !== "polyline") return null;
  const verts = shape.vertices ?? shape.points.map((p) => ({ p, kind: "corner" as const }));
  return verts.length >= 3 ? { pts: verts.map((v) => v.p), kinds: verts.map((v) => v.kind) } : null;
}

/** The vertices that can bend: all of a closed outline's, the inner ones of an open one's. */
function bendable(n: number, closed: boolean): number[] {
  return Array.from({ length: n }, (_, i) => i).filter((i) => closed || (i > 0 && i < n - 1));
}

/** Each selected polygon or polyline that is not already smoothed so, with the polyline it becomes. */
function smoothingJobs(kind: Smoothing): Job<NewShape>[] {
  const jobs: Job<NewShape>[] = [];
  for (const o of selectedObjects()) {
    const v = o.shape ? controlVertices(o.shape) : null;
    if (!v || !o.shape) continue;
    const closed = o.shape.closed;
    const inner = bendable(v.pts.length, closed);
    if (kind === "radius") {
      // already so when its curves are all radius vertices
      if (inner.some((i) => v.kinds[i] === "through") && inner.every((i) => v.kinds[i] === "through" || v.kinds[i] === "corner")) continue;
      const result = radiusVertices(v.pts.map((p) => ({ p, kind: "arc" as const })), closed);
      if (result) jobs.push({ id: o.id, result });
      continue;
    }
    if (inner.every((i) => v.kinds[i] === kind)) continue;
    jobs.push({ id: o.id, result: { kind: "polyline", points: v.pts, closed, vertices: v.pts.map(() => kind) } });
  }
  return jobs;
}

/** True when some selected polygon or polyline can be smoothed. */
export function canSmooth(): boolean {
  return selectedObjects().some((o) => o.shape !== null && controlVertices(o.shape) !== null);
}

/** True when every selected polygon and polyline already has every bendable vertex of this kind. */
export function isSmoothed(kind: Smoothing): boolean {
  const shapes = selectedObjects().flatMap((o) => (o.shape && controlVertices(o.shape) ? [o.shape] : []));
  return shapes.length > 0 && smoothingJobs(kind).length === 0;
}

const SMOOTHING_LABEL: Readonly<Record<Smoothing, string>> = {
  corner: "No Smoothing",
  bezier: "Bezier Spline Smoothing",
  cubic: "Cubic Spline Smoothing",
  arc: "Arc Smoothing",
  radius: "Radius Smoothing",
};

/** Modify > Poly Smoothing: makes every vertex of the selected polygons and polylines `kind`, as polylines, in one step. */
export function smoothSelection(kind: Smoothing): void {
  if (!canSmooth()) {
    toast("Smoothing works on polygons and polylines.", "info");
    return;
  }
  const jobs = smoothingJobs(kind);
  if (jobs.length === 0) return;
  const r = attempt(SMOOTHING_LABEL[kind], (s) => s.batch(() => jobs.flatMap((j) => s.replaceObjects([j.id], [j.result]))));
  if (r) setSelection([...new Set([...store.selection, ...r.value])]);
}
