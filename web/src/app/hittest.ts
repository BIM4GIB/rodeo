// Hit testing in screen-space tolerance. Only pickable objects are hit (their
// class is drawn and editable under the class options, see scene.isClassPickable);
// callers map the hit to the object they select with scene.unitOf().

import type { BBox, ObjectInfo, Pt } from "../core/index.ts";
import type { Scene } from "./scene.ts";
import type { View } from "./view.ts";
import {
  bboxInside,
  bboxIntersects,
  bboxOfPoints,
  distToPolyline,
  ellipsePoints,
  pointInPolygon,
  segmentTouchesBBox,
} from "./geom.ts";
import { prefs } from "./prefs.ts";
import { LIGHT_RING_PX } from "./renderer.ts";
import { isClosedShape, outlineOf, type Geom } from "./shapes.ts";

/** How near the pointer (CSS px) an object must be to be clicked: half the selection box (Preferences > Interactive). */
export function pickPx(): number {
  return prefs().selectBoxPx / 2;
}

const ARC_STEPS = 96;

/**
 * Topmost drawable object under a screen point, or null. Layers are searched
 * in the given order, each from its top object down; `accept` filters candidates.
 */
export function pickObject(
  scene: Scene,
  view: View,
  screen: Pt,
  layerIds: readonly string[],
  accept?: (obj: ObjectInfo) => boolean,
  /** any visible class, not only those the class options let a click select (Force Select) */
  anyClass = false,
): ObjectInfo | null {
  for (const layerId of layerIds) {
    const hit = pickInLayer(scene, view, screen, layerId, accept, anyClass);
    if (hit) return hit;
  }
  return null;
}

function pickInLayer(
  scene: Scene,
  view: View,
  screen: Pt,
  layerId: string,
  accept: ((obj: ObjectInfo) => boolean) | undefined,
  anyClass: boolean,
): ObjectInfo | null {
  const p = view.toWorld(screen.x, screen.y);
  const tol = pickPx() / view.scale;
  const objects = scene.index(layerId).objects;
  for (let i = objects.length - 1; i >= 0; i--) {
    if (hitsObject(scene, view, objects[i], p, tol, accept, anyClass)) return objects[i];
  }
  return null;
}

/** Every drawable object under a screen point that a click could pick, topmost first, the layers in the order given. */
export function pickAllObjects(scene: Scene, view: View, screen: Pt, layerIds: readonly string[], accept?: (obj: ObjectInfo) => boolean): ObjectInfo[] {
  const p = view.toWorld(screen.x, screen.y);
  const tol = pickPx() / view.scale;
  const out: ObjectInfo[] = [];
  for (const layerId of layerIds) {
    const objects = scene.index(layerId).objects;
    for (let i = objects.length - 1; i >= 0; i--) if (hitsObject(scene, view, objects[i], p, tol, accept, false)) out.push(objects[i]);
  }
  return out;
}

/** Whether a click at world point `p`, `tol` away at most, hits `obj`. */
function hitsObject(scene: Scene, view: View, obj: ObjectInfo, p: Pt, tol: number, accept: ((obj: ObjectInfo) => boolean) | undefined, anyClass: boolean): boolean {
  if ((!obj.shape && !obj.planLines) || !(anyClass ? scene.isClassVisible(obj.classIndex) : scene.isClassPickable(obj.classIndex)) || scene.isHidden(obj)) return false;
  if (accept && !accept(obj)) return false;
  // a viewport's contents are cropped to its box, so nothing outside the box is hit
  if (obj.clip && outside(p, obj.clip, tol)) return false;
  if (!obj.shape) return onPlanLines(obj.planLines ?? [], p, tol);
  const geom = scene.geometry(obj);
  if (!geom) return false;
  // a light object's mark is drawn round its point, a fixed size on screen
  const reach = obj.shape.kind === "light" ? tol + LIGHT_RING_PX / view.scale : tol;
  const b = geom.bbox;
  if (b && outside(p, b, reach)) return false;
  return hitsShape(obj, geom, p, reach);
}

/** Whether `p` is within `tol` of the lines Top/Plan draws of a mesh, in pairs of points. */
function onPlanLines(lines: readonly Pt[], p: Pt, tol: number): boolean {
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const [a, b] = [lines[i], lines[i + 1]];
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(a.x + t * dx - p.x, a.y + t * dy - p.y) <= tol) return true;
  }
  return false;
}

/**
 * The plan viewport (or design-layer viewport) whose box holds a screen point, topmost first, or
 * null. The layers a viewport shows are drawn live rather than being objects of its layer, so a
 * click on them picks the viewport.
 */
export function pickViewport(scene: Scene, view: View, screen: Pt, layerIds: readonly string[]): ObjectInfo | null {
  const p = view.toWorld(screen.x, screen.y);
  for (const layerId of layerIds) {
    const views = scene.viewports(layerId);
    for (let i = views.length - 1; i >= 0; i--) {
      if (outside(p, views[i].clip, 0)) continue;
      const obj = scene.document?.object(views[i].id);
      if (obj && scene.isClassPickable(obj.classIndex)) return obj;
    }
  }
  return null;
}

/** True when p is farther than tol outside the box. */
function outside(p: Pt, b: BBox, tol: number): boolean {
  return p.x < b.x0 - tol || p.x > b.x1 + tol || p.y < b.y0 - tol || p.y > b.y1 + tol;
}

function hitsShape(obj: ObjectInfo, geom: Geom, p: Pt, tol: number): boolean {
  const shape = geom.source;
  if (shape.kind === "text" || shape.kind === "image") {
    const b = geom.bbox;
    return !!b && p.x >= b.x0 - tol && p.x <= b.x1 + tol && p.y >= b.y0 - tol && p.y <= b.y1 + tol;
  }
  if (shape.kind === "locus" || shape.kind === "light") {
    const q = shape.points[0];
    return !!q && Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  }
  let pts: readonly Pt[];
  if (shape.kind === "arc") {
    const c = shape.center;
    if (!c || shape.rx === undefined) return false;
    pts = ellipsePoints(c, shape.rx, shape.ry ?? shape.rx, shape.startAngle ?? 0, shape.sweepAngle ?? 360, ARC_STEPS);
  } else {
    pts = shape.points;
  }
  const closed = isClosedShape(shape);
  if (distToPolyline(p, pts, closed) <= tol) return true;
  const filled = obj.attrs !== null && obj.attrs.fillPattern !== 0;
  return closed && filled && pts.length > 2 && pointInPolygon(p, pts);
}

/**
 * Selectable ids of `layerId` (top-level, or the children of group `scope`)
 * whose bounds are inside (window) or touch (crossing) `rect`. Objects of classes
 * that cannot be picked under the class options are skipped (TopEntry.visible).
 */
export function topIdsInRect(
  scene: Scene,
  layerId: string,
  rect: BBox,
  crossing: boolean,
  scope: string | null = null,
): string[] {
  const out: string[] = [];
  // entry bounds are already cropped to the viewports their objects sit in (see scene.topLevelEntries)
  for (const e of scene.topLevelEntries(layerId, scope)) {
    if (!e.visible || !e.bbox) continue;
    const hit = crossing ? bboxIntersects(e.bbox, rect) : bboxInside(e.bbox, rect);
    if (hit) out.push(e.id);
  }
  return out;
}

/**
 * As topIdsInRect, for a closed polygon drawn by the Selection tool's Polygon and
 * Lasso modes: bounds wholly inside it (window), or touching it (crossing).
 */
export function topIdsInPolygon(
  scene: Scene,
  layerId: string,
  poly: readonly Pt[],
  crossing: boolean,
  scope: string | null = null,
): string[] {
  const out: string[] = [];
  const around = bboxOfPoints(poly);
  if (!around || poly.length < 3) return out;
  for (const e of scene.topLevelEntries(layerId, scope)) {
    if (!e.visible || !e.bbox || !bboxIntersects(e.bbox, around)) continue;
    const hit = crossing ? bboxTouchesPolygon(e.bbox, poly) : bboxInPolygon(e.bbox, poly);
    if (hit) out.push(e.id);
  }
  return out;
}

/**
 * As topIdsInRect, for a box along the screen in a rotated plan: `box` lies in the frame `frame`
 * takes a drawing point to, and each object is judged by its own outline there, as its bounds along
 * the drawing's axes would stick out of a box drawn snugly round it.
 */
export function topIdsInFrame(
  scene: Scene,
  layerId: string,
  box: BBox,
  frame: (p: Pt) => Pt,
  crossing: boolean,
  scope: string | null = null,
): string[] {
  const out: string[] = [];
  for (const e of scene.topLevelEntries(layerId, scope)) {
    if (!e.visible || !e.bbox) continue;
    const b = boundsInFrame(scene, layerId, e.id, frame);
    if (b && (crossing ? bboxIntersects(b, box) : bboxInside(b, box))) out.push(e.id);
  }
  return out;
}

/** The bounds of an object and everything inside it, along the frame `frame` takes a drawing point to. */
export function boundsInFrame(scene: Scene, layerId: string, id: string, frame: (p: Pt) => Pt): BBox | null {
  const top = scene.document?.object(id);
  if (!top) return null;
  const idx = scene.index(layerId);
  const pts: Pt[] = [];
  const stack: ObjectInfo[] = [top];
  for (let o = stack.pop(); o !== undefined; o = stack.pop()) {
    if (o.shape) pts.push(...outlineOf(o.shape, scene.geometry(o)?.bbox ?? null));
    if (o.bounds) pts.push(...corners(o.bounds));
    const kids = idx.children.get(o.id);
    // one at a time: an imported drawing's group can hold too many for a spread
    if (kids) for (const k of kids) stack.push(k);
  }
  return bboxOfPoints(pts.map(frame));
}

function corners(b: BBox): Pt[] {
  return [
    { x: b.x0, y: b.y0 },
    { x: b.x1, y: b.y0 },
    { x: b.x1, y: b.y1 },
    { x: b.x0, y: b.y1 },
  ];
}

/** Whether an edge of the closed polygon `poly` touches `box`. */
function edgeTouches(box: BBox, poly: readonly Pt[]): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentTouchesBBox(poly[j], poly[i], box)) return true;
  }
  return false;
}

/** All of `box` inside `poly`: its corners are, and no edge of a concave polygon cuts in. */
function bboxInPolygon(box: BBox, poly: readonly Pt[]): boolean {
  return corners(box).every((c) => pointInPolygon(c, poly)) && !edgeTouches(box, poly);
}

/** `box` and `poly` overlap: an edge touches the box, or the polygon holds it whole. */
function bboxTouchesPolygon(box: BBox, poly: readonly Pt[]): boolean {
  return edgeTouches(box, poly) || pointInPolygon({ x: box.x0, y: box.y0 }, poly);
}
