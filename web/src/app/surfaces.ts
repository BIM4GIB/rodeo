// Modify > Surfaces: Add Surface, Clip Surface and Intersect Surface, the boolean commands for
// closed shapes (polygons, rectangles, closed polylines, circles and ellipses). A closed shape is
// read as its outline (a circle or ellipse as 96 points a turn) and polygon-clipping does the
// boolean. Our polygons have no holes, so a result with holes comes back as one outline with the
// holes joined in (see joinHoles). Selected objects that are not closed shapes are left alone.

import polygonClipping, { type MultiPolygon, type Pair, type Polygon } from "polygon-clipping";
import type { EditSession, NewShape, ObjectInfo, Pt, Shape, VwxDocument } from "../core/index.ts";
import { attempt, setEditGroup, setSelection } from "./commands.ts";
import { dist, ellipsePoints } from "./geom.ts";
import { arcRadii, isClosedShape } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** Points per full turn when a circle or ellipse becomes an outline. */
const TURN_STEPS = 96;
/** Coordinates and cross products closer to zero than this are zero. */
const EPS = 1e-7;
const NO_OVERLAP = "The objects don't overlap";

// ---- outlines -------------------------------------------------------------------

/**
 * The outline of a closed shape as polygon points, without a repeated closing point. A full
 * circle or ellipse is sampled at TURN_STEPS points. Null for open shapes and for outlines
 * with fewer than three distinct points.
 */
export function closedOutline(shape: Shape): Pt[] | null {
  if (!isClosedShape(shape)) return null;
  let pts: Pt[];
  if (shape.kind === "arc") {
    const radii = arcRadii(shape);
    if (!radii || !shape.center) return null;
    // the sample at the end of the turn repeats the first one
    pts = ellipsePoints(shape.center, radii.rx, radii.ry, shape.startAngle ?? 0, 360, TURN_STEPS).slice(0, -1);
  } else {
    pts = shape.points;
  }
  const ring = dropRepeats(pts);
  return ring.length >= 3 ? ring : null;
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

/** Copies of the points without repeats in a row, and without a last point that repeats the first. */
function dropRepeats(pts: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || !samePoint(last, p)) out.push({ x: p.x, y: p.y });
  }
  while (out.length > 1 && samePoint(out[0], out[out.length - 1])) out.pop();
  return out;
}

// ---- booleans -------------------------------------------------------------------

function region(outline: readonly Pt[]): Polygon {
  return [outline.map((p): Pair => [p.x, p.y])];
}

/** The area covered by any of the outlines. */
export function unionOf(outlines: readonly Pt[][]): MultiPolygon {
  if (outlines.length === 0) return [];
  const [first, ...rest] = outlines.map(region);
  return polygonClipping.union(first, ...rest);
}

/** The area covered by all of the outlines. */
export function intersectionOf(outlines: readonly Pt[][]): MultiPolygon {
  if (outlines.length === 0) return [];
  const [first, ...rest] = outlines.map(region);
  return polygonClipping.intersection(first, ...rest);
}

/** The area of `subject` that `cutter` does not cover. */
export function differenceOf(subject: readonly Pt[], cutter: readonly Pt[]): MultiPolygon {
  return polygonClipping.difference(region(subject), region(cutter));
}

/**
 * Object shapes for a boolean result: one closed polygon per outer ring, with its holes joined
 * in (see joinHoles). An empty result gives no shapes.
 */
export function resultShapes(result: MultiPolygon): NewShape[] {
  const out: NewShape[] = [];
  for (const rings of result) {
    // polygon-clipping repeats the first point at the end of each ring
    const [outer, ...holes] = rings.map((r) => dropRepeats(r.map(([x, y]): Pt => ({ x, y }))));
    if (!outer || outer.length < 3) continue;
    out.push({ kind: "polygon", points: joinHoles(outer, holes.filter((h) => h.length >= 3)), closed: true });
  }
  return out;
}

/**
 * Joins holes into their outer ring, so that one ring fills correctly. Each hole is bridged from
 * its leftmost vertex M to a visible vertex P of the ring: the ring runs to P, then M, once round
 * the hole, back to M, and on from P again. The bridge is walked both ways, so it has no width or
 * area. Holes are joined one at a time, rightmost first.
 */
export function joinHoles(outer: readonly Pt[], holes: readonly Pt[][]): Pt[] {
  let ring: Pt[] = outer.map((p) => ({ x: p.x, y: p.y }));
  const pending = holes.filter((h) => h.length >= 3).sort((a, b) => maxX(b) - maxX(a));
  for (const hole of pending) {
    const m = leftmost(hole);
    const at = bridgeFrom(ring, hole, hole[m]);
    const loop = [...hole.slice(m), ...hole.slice(0, m), hole[m]];
    ring = [...ring.slice(0, at + 1), ...loop, ring[at], ...ring.slice(at + 1)];
  }
  return ring;
}

function maxX(pts: readonly Pt[]): number {
  return Math.max(...pts.map((p) => p.x));
}

function leftmost(pts: readonly Pt[]): number {
  let best = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[best].x) best = i;
  return best;
}

/**
 * Index of the ring vertex the hole's bridge goes to: the nearest one that the segment from `m`
 * reaches without crossing an edge of the ring or of the hole.
 */
function bridgeFrom(ring: readonly Pt[], hole: readonly Pt[], m: Pt): number {
  const edges = [...edgesOf(ring), ...edgesOf(hole)];
  const order = ring.map((_, i) => i).sort((i, j) => dist(ring[i], m) - dist(ring[j], m));
  for (const i of order) {
    const p = ring[i];
    const clear = edges.every(
      ([a, b]) => samePoint(a, p) || samePoint(b, p) || samePoint(a, m) || samePoint(b, m) || !meets(m, p, a, b),
    );
    if (clear) return i;
  }
  return order[0];
}

function edgesOf(pts: readonly Pt[]): [Pt, Pt][] {
  return pts.map((p, i): [Pt, Pt] => [p, pts[(i + 1) % pts.length]]);
}

/** True when segments ab and cd meet, touching included. */
function meets(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = sideOf(c, d, a);
  const d2 = sideOf(c, d, b);
  const d3 = sideOf(a, b, c);
  const d4 = sideOf(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (
    (d1 === 0 && within(c, d, a)) ||
    (d2 === 0 && within(c, d, b)) ||
    (d3 === 0 && within(a, b, c)) ||
    (d4 === 0 && within(a, b, d))
  );
}

/** Which side of the line from a to b the point p is on: 1 left, -1 right, 0 on it. */
function sideOf(a: Pt, b: Pt, p: Pt): number {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross > EPS ? 1 : cross < -EPS ? -1 : 0;
}

/** True when p lies in the box of segment ab. For a point known to be on the segment's line, that is on the segment. */
function within(a: Pt, b: Pt, p: Pt): boolean {
  return (
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS
  );
}

// ---- selection ------------------------------------------------------------------

/** A selected closed shape: its object, its outline and its place in the layer's stacking order. */
interface Closed {
  readonly id: string;
  readonly obj: ObjectInfo;
  readonly outline: Pt[];
  /** draw order on the layer; a larger number is higher in the stack */
  readonly order: number;
}

/** The selected objects that are closed shapes, bottom-most first. */
function closedSelection(): Closed[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return [];
  const doc = s.doc;
  // siblings keep their relative order in the layer's draw order, which is the stacking order
  const drawOrder = new Map(doc.objects(layerId).map((o, i): [string, number] => [o.id, i]));
  const out: Closed[] = [];
  for (const id of store.selection) {
    const obj = doc.object(id);
    const outline = obj?.shape ? closedOutline(obj.shape) : null;
    if (obj && outline) out.push({ id, obj, outline, order: drawOrder.get(id) ?? 0 });
  }
  return out.sort((a, b) => a.order - b.order);
}

/**
 * Whether at least `n` selected objects are closed shapes, for the menu. It checks the shapes
 * without building their outlines and stops at `n`, so it stays cheap on big selections.
 */
export function hasClosedSelection(n: number): boolean {
  const doc = store.session?.doc;
  if (!doc) return false;
  let count = 0;
  for (const id of store.selection) {
    const shape = doc.object(id)?.shape;
    if (shape && isClosable(shape)) count++;
    if (count >= n) return true;
  }
  return false;
}

/** Closed, with the points or radii an outline needs; the same test closedOutline makes, minus the sampling. */
function isClosable(shape: Shape): boolean {
  if (!isClosedShape(shape)) return false;
  return shape.kind === "arc" ? arcRadii(shape) !== null && shape.center !== undefined : shape.points.length >= 3;
}

/** An object other than a closed shape that Clip Surface cuts (a roof face): whether it took the cut. */
export interface ClipTarget {
  is(doc: VwxDocument, id: string): boolean;
  cut(s: EditSession, id: string, cutter: readonly Pt[]): boolean;
}

const clipTargets: ClipTarget[] = [];

export function registerClipTarget(target: ClipTarget): void {
  clipTargets.push(target);
}

const clipTargetOf = (doc: VwxDocument, id: string): ClipTarget | undefined => clipTargets.find((t) => t.is(doc, id));

/** Clip Surface takes two closed shapes, or one and an object it cuts. */
export function canClipSurface(): boolean {
  if (hasClosedSelection(2)) return true;
  const doc = store.session?.doc;
  if (!doc || !hasClosedSelection(1)) return false;
  for (const id of store.selection) if (clipTargetOf(doc, id)) return true;
  return false;
}

// ---- commands -------------------------------------------------------------------

/**
 * Add Surface: the union of the selected closed shapes replaces them. The result takes the place,
 * class and attributes of the bottom-most one; separate pieces become separate objects.
 */
export function addSurface(): void {
  const items = closedSelection();
  if (items.length < 2) return;
  const shapes = resultShapes(unionOf(items.map((i) => i.outline)));
  if (shapes.length === 0) {
    toast("Those shapes have no area to join.", "info");
    return;
  }
  const r = attempt("Add Surface", (s) => s.replaceObjects(items.map((i) => i.id), shapes));
  if (r) setSelection(r.value);
}

/**
 * Clip Surface: the top-most selected closed shape cuts every other selected one. Each cut object
 * becomes what is left of it, or is deleted when nothing is left. The cutting shape stays.
 */
export function clipSurface(): void {
  const items = closedSelection();
  const doc = store.session?.doc;
  const others = doc ? [...store.selection].filter((id) => !items.some((i) => i.id === id) && clipTargetOf(doc, id)) : [];
  if (items.length < 1 || items.length + others.length < 2) return;
  const cutter = items[items.length - 1];
  const r = attempt("Clip Surface", (s) =>
    s.batch(() => {
      const kept = [cutter.id];
      let cut = false;
      for (const id of others) {
        if (clipTargetOf(s.doc, id)?.cut(s, id, cutter.outline)) cut = true;
        kept.push(id);
      }
      for (const item of items.slice(0, -1)) {
        if (intersectionOf([item.outline, cutter.outline]).length === 0) {
          kept.push(item.id);
          continue;
        }
        cut = true;
        const shapes = resultShapes(differenceOf(item.outline, cutter.outline));
        if (shapes.length === 0) s.deleteObjects([item.id]);
        else kept.push(...s.replaceObjects([item.id], shapes));
      }
      return { kept, cut };
    }),
  );
  if (!r) return;
  if (!r.value.cut) toast(NO_OVERLAP, "info");
  setSelection(r.value.kept);
}

/**
 * Intersect Surface: the overlap of the selected closed shapes becomes new objects on top of the
 * layer, with the class and attributes of the top-most one. The originals stay.
 */
export function intersectSurface(): void {
  const items = closedSelection();
  const layerId = store.activeLayerId;
  if (items.length < 2 || !layerId) return;
  const shapes = resultShapes(intersectionOf(items.map((i) => i.outline)));
  if (shapes.length === 0) {
    toast(NO_OVERLAP, "info");
    return;
  }
  const top = items[items.length - 1].obj;
  const r = attempt("Intersect Surface", (s) =>
    s.batch(() => shapes.map((shape) => s.addObject(layerId, shape, top.classIndex, top.attrs ?? undefined))),
  );
  // new objects go on the layer, not into the group being edited (as addAndSelect does)
  if (r) setEditGroup(null, r.value);
}
