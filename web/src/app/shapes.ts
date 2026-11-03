// Per-shape derived data: Path2D in world coordinates, bounds, grip handles
// and snap points. Built once per shape object and cached by scene.ts.

import type { BBox, NewShape, Pt, Shape, VertexKind } from "../core/index.ts";
import { bboxOfPoints, degToRad, dist, ellipsePoints } from "./geom.ts";

export interface Geom {
  /** the shape this geometry was built from (identity-checked by the cache) */
  readonly source: Shape;
  /** outline for line/rect/polygon/polyline/arc, what fills and selection use; null for text and images */
  readonly path: Path2D | null;
  /** the outline as drawn: `path` without the edges a polyline hides */
  readonly stroke: Path2D | null;
  readonly bbox: BBox | null;
  /** reshape grips in world coordinates (see reshape()) */
  readonly handles: readonly Pt[];
  /** polygon/polyline edge midpoints: dragging one inserts a vertex (see insertVertex()) */
  readonly edges: readonly Pt[];
}

export function arcRadii(shape: Shape): { rx: number; ry: number } | null {
  if (shape.rx === undefined) return null;
  return { rx: shape.rx, ry: shape.ry ?? shape.rx };
}

export function isFullArc(shape: Shape): boolean {
  return Math.abs(shape.sweepAngle ?? 360) >= 360;
}

/** Shapes whose interior can be filled and that count as closed for hit tests. */
export function isClosedShape(shape: Shape): boolean {
  if (shape.kind === "arc") return isFullArc(shape);
  return shape.kind === "rect" || shape.closed;
}

/**
 * Shapes that paint their fill: closed ones, and open polygons and polylines, which Vectorworks
 * fills as if their ends were joined (the joining edge has no pen). A plug-in's outline often is one.
 */
export function fillsShape(shape: Shape): boolean {
  return isClosedShape(shape) || ((shape.kind === "polygon" || shape.kind === "polyline") && shape.points.length > 2);
}

export function shapeBBox(shape: Shape): BBox | null {
  if (shape.bbox) return shape.bbox;
  if (shape.kind === "arc") {
    const r = arcRadii(shape);
    const c = shape.center;
    if (!r || !c) return null;
    return { x0: c.x - r.rx, y0: c.y - r.ry, x1: c.x + r.rx, y1: c.y + r.ry };
  }
  return bboxOfPoints(shape.points);
}

function buildPath(shape: Shape): Path2D | null {
  if (shape.kind === "arc") {
    const c = shape.center;
    const r = arcRadii(shape);
    if (!c || !r) return null;
    const path = new Path2D();
    const sweep = shape.sweepAngle ?? 360;
    if (Math.abs(sweep) >= 360) {
      path.ellipse(c.x, c.y, r.rx, r.ry, 0, 0, Math.PI * 2, false);
    } else {
      const start = degToRad(shape.startAngle ?? 0);
      path.ellipse(c.x, c.y, r.rx, r.ry, 0, start, start + degToRad(sweep), sweep < 0);
    }
    return path;
  }
  if (shape.kind === "line" || shape.kind === "rect" || shape.kind === "polygon" || shape.kind === "polyline") {
    const pts = shape.points;
    if (pts.length < 2) return null;
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
    if (isClosedShape(shape)) path.closePath();
    return path;
  }
  return null;
}

/** The edges of a polyline that are not hidden, as separate runs. */
function visibleEdges(pts: readonly Pt[], hidden: readonly number[], closed: boolean): Path2D {
  const skip = new Set(hidden);
  const path = new Path2D();
  const n = pts.length;
  const segs = closed ? n : n - 1;
  let open = false;
  for (let i = 0; i < segs; i++) {
    if (skip.has(i)) {
      open = false;
      continue;
    }
    const b = pts[(i + 1) % n];
    if (!open) path.moveTo(pts[i].x, pts[i].y);
    path.lineTo(b.x, b.y);
    open = true;
  }
  return path;
}

interface ControlVertex {
  readonly p: Pt;
  readonly kind: VertexKind;
  readonly radius: number;
}

/** A polygon's or polyline's own vertices: a polyline's as stored (its curves unflattened), a polygon's corners. */
function controlsOf(shape: Shape): ControlVertex[] {
  if (shape.kind === "polyline" && shape.vertices) return shape.vertices.slice();
  return shape.points.map((p) => ({ p, kind: "corner", radius: 0 }));
}

/** Polygon or polyline geometry with these vertices, kinds and radii kept. */
function withControls(shape: Shape, verts: readonly ControlVertex[]): NewShape {
  if (shape.kind !== "polyline") return { kind: "polygon", points: verts.map((v) => v.p), closed: shape.closed };
  return polylineOf(verts, shape.closed);
}

function polylineOf(verts: readonly ControlVertex[], closed: boolean): NewShape {
  return { kind: "polyline", points: verts.map((v) => v.p), closed, vertices: verts.map((v) => v.kind), radii: verts.map((v) => v.radius) };
}

/** Reshape grips: every one can be dragged with reshape(). Text, images and
 *  rotated rectangles have none (they are moved, not reshaped). A polyline's
 *  grips are its own vertices, not points along its curves. */
function handlesOf(shape: Shape): Pt[] {
  switch (shape.kind) {
    case "line":
    case "polygon":
      return shape.points.slice();
    case "polyline":
      return controlsOf(shape).map((v) => v.p);
    case "rect":
      return isAxisAligned(shape.points) ? shape.points.slice() : [];
    case "arc": {
      // centre, plus a radius grip at mid-sweep (angle 0 on a full circle); an
      // ellipse has a grip on each axis instead
      const c = shape.center;
      const r = arcRadii(shape);
      if (!c || !r) return [];
      if (r.rx !== r.ry) return [c, { x: c.x + r.rx, y: c.y }, { x: c.x, y: c.y + r.ry }];
      const a = degToRad(isFullArc(shape) ? 0 : (shape.startAngle ?? 0) + (shape.sweepAngle ?? 0) / 2);
      return [c, { x: c.x + r.rx * Math.cos(a), y: c.y + r.rx * Math.sin(a) }];
    }
    default:
      return [];
  }
}

/** Midpoint of each polygon/polyline edge, edge i running from point i to i + 1. */
function edgesOf(shape: Shape): Pt[] {
  if (shape.kind !== "polygon" && shape.kind !== "polyline") return [];
  const pts = controlsOf(shape).map((v) => v.p);
  const n = shape.closed ? pts.length : pts.length - 1;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

/**
 * Geometry with a new vertex `to` on edge `edge` (an index into Geom.edges), of `kind`: a
 * polygon given a curved one becomes a polyline.
 */
export function insertVertex(shape: Shape, edge: number, to: Pt, kind: VertexKind = "corner"): NewShape | null {
  if (shape.kind !== "polygon" && shape.kind !== "polyline") return null;
  if (edge < 0 || edge >= edgesOf(shape).length) return null;
  const verts = controlsOf(shape);
  verts.splice(edge + 1, 0, { p: to, kind, radius: 0 });
  return kind === "corner" ? withControls(shape, verts) : polylineOf(verts, shape.closed);
}

/** Geometry without vertex `index`, or null when too few would be left. */
export function deleteVertex(shape: Shape, index: number): NewShape | null {
  if (index < 0 || index >= handlesOf(shape).length) return null;
  return deleteVertices(shape, new Set([index]));
}

/** Geometry without the vertices `indices`, or null when too few would be left. */
export function deleteVertices(shape: Shape, indices: ReadonlySet<number>): NewShape | null {
  if (shape.kind !== "polygon" && shape.kind !== "polyline") return null;
  const verts = controlsOf(shape).filter((_, i) => !indices.has(i));
  if (verts.length < (shape.closed ? 3 : 2)) return null;
  return withControls(shape, verts);
}

/** Polyline geometry with vertex `index` made `kind`, an arc's radius left to fit: a polygon becomes a polyline. */
export function setVertexKind(shape: Shape, index: number, kind: VertexKind): NewShape | null {
  if (shape.kind !== "polygon" && shape.kind !== "polyline") return null;
  const verts = controlsOf(shape);
  if (index < 0 || index >= verts.length) return null;
  verts[index] = { ...verts[index], kind, radius: 0 };
  return polylineOf(verts, shape.closed);
}

/** Geometry with the vertices `indices` (entries of Geom.handles) moved by `d`: lines, polygons and polylines. */
export function moveVertices(shape: Shape, indices: ReadonlySet<number>, d: Pt): NewShape | null {
  const at = (p: Pt, i: number): Pt => (indices.has(i) ? { x: p.x + d.x, y: p.y + d.y } : p);
  if (shape.kind === "line") {
    const [a, b] = shape.points;
    return a && b ? { kind: "line", a: at(a, 0), b: at(b, 1) } : null;
  }
  if (shape.kind !== "polygon" && shape.kind !== "polyline") return null;
  return withControls(shape, controlsOf(shape).map((v, i) => ({ ...v, p: at(v.p, i) })));
}

function isAxisAligned(pts: readonly Pt[]): boolean {
  if (pts.length !== 4) return false;
  const b = bboxOfPoints(pts);
  if (!b) return false;
  const eps = 1e-9 * Math.max(1, b.x1 - b.x0, b.y1 - b.y0);
  const same = (u: number, v: number) => Math.abs(u - v) <= eps;
  const [p0, p1, p2, p3] = pts;
  const a = same(p0.y, p1.y) && same(p1.x, p2.x) && same(p2.y, p3.y) && same(p3.x, p0.x);
  const b2 = same(p0.x, p1.x) && same(p1.y, p2.y) && same(p2.x, p3.x) && same(p3.y, p0.y);
  return a || b2;
}

/**
 * Geometry after dragging grip `index` of `shape` (an entry of Geom.handles)
 * to `to`, or null when that grip can't reshape the shape: text, images and
 * rotated rectangles are moved, not reshaped.
 */
export function reshape(shape: Shape, index: number, to: Pt): NewShape | null {
  switch (shape.kind) {
    case "line": {
      const [a, b] = shape.points;
      if (!a || !b || index > 1) return null;
      return index === 0 ? { kind: "line", a: to, b } : { kind: "line", a, b: to };
    }
    case "polygon":
    case "polyline": {
      const verts = controlsOf(shape);
      if (index >= verts.length) return null;
      verts[index] = { ...verts[index], p: to };
      return withControls(shape, verts);
    }
    case "rect": {
      if (!isAxisAligned(shape.points)) return null;
      const opp = shape.points[(index + 2) % 4];
      if (!opp || to.x === opp.x || to.y === opp.y) return null;
      return {
        kind: "rect",
        x0: Math.min(opp.x, to.x),
        y0: Math.min(opp.y, to.y),
        x1: Math.max(opp.x, to.x),
        y1: Math.max(opp.y, to.y),
      };
    }
    case "arc": {
      const c = shape.center;
      const r = arcRadii(shape);
      if (!c || !r) return null;
      const startAngle = shape.startAngle ?? 0;
      const sweepAngle = shape.sweepAngle ?? 360;
      if (r.rx !== r.ry) {
        // grips: centre, then the x and y axis ends
        const rx = index === 1 ? Math.abs(to.x - c.x) : r.rx;
        const ry = index === 2 ? Math.abs(to.y - c.y) : r.ry;
        if (index > 2 || !(rx > 0 && ry > 0)) return null;
        return { kind: "arc", center: index === 0 ? to : c, radius: rx, radiusY: ry, startAngle, sweepAngle };
      }
      if (index === 0) return { kind: "arc", center: to, radius: r.rx, startAngle, sweepAngle };
      const radius = dist(c, to);
      return radius > 0 ? { kind: "arc", center: c, radius, startAngle, sweepAngle } : null;
    }
    default:
      return null;
  }
}

export function buildGeom(shape: Shape): Geom {
  const bbox = shapeBBox(shape);
  const path = buildPath(shape);
  const stroke = shape.hidden ? visibleEdges(shape.points, shape.hidden, isClosedShape(shape)) : path;
  return { source: shape, path, stroke, bbox, handles: handlesOf(shape), edges: edgesOf(shape) };
}

/** Text lines split on CR, LF or CRLF. */
export function textLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

const OUTLINE_STEPS = 96;

/** The points a shape's outline runs through; a turned text's are those of the box inside its bounds. */
export function outlineOf(shape: Shape, bbox: BBox | null): Pt[] {
  if (shape.kind === "arc" && shape.center && shape.rx !== undefined) {
    return ellipsePoints(shape.center, shape.rx, shape.ry ?? shape.rx, shape.startAngle ?? 0, shape.sweepAngle ?? 360, OUTLINE_STEPS);
  }
  if (shape.points.length > 0) return shape.points;
  if (!bbox) return [];
  const corners = (): Pt[] => [
    { x: bbox.x0, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y0 },
    { x: bbox.x1, y: bbox.y1 },
    { x: bbox.x0, y: bbox.y1 },
  ];
  const a = ((shape.textAngle ?? 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  // at 45° the bounds don't say the box's shape, so the bounds stand for it
  if (shape.kind !== "text" || a === 0 || Math.abs(c - s) < 0.01) return corners();
  const W = bbox.x1 - bbox.x0;
  const H = bbox.y1 - bbox.y0;
  const w = (W * c - H * s) / (c * c - s * s);
  const h = (H * c - W * s) / (c * c - s * s);
  const mid = { x: (bbox.x0 + bbox.x1) / 2, y: (bbox.y0 + bbox.y1) / 2 };
  const u = { x: (Math.cos(a) * w) / 2, y: (Math.sin(a) * w) / 2 };
  const v = { x: (-Math.sin(a) * h) / 2, y: (Math.cos(a) * h) / 2 };
  return [
    { x: mid.x - u.x - v.x, y: mid.y - u.y - v.y },
    { x: mid.x + u.x - v.x, y: mid.y + u.y - v.y },
    { x: mid.x + u.x + v.x, y: mid.y + u.y + v.y },
    { x: mid.x - u.x + v.x, y: mid.y - u.y + v.y },
  ];
}

/** Points that snap candidates are drawn from: vertices, segment midpoints, arc centre and ends. */
export function snapPointsOf(shape: Shape): Pt[] {
  const out: Pt[] = [];
  if (shape.kind === "text" || shape.kind === "image") return out;
  if (shape.kind === "arc") {
    const c = shape.center;
    const r = arcRadii(shape);
    if (!c || !r) return out;
    out.push(c);
    if (!isFullArc(shape)) {
      const start = degToRad(shape.startAngle ?? 0);
      const end = start + degToRad(shape.sweepAngle ?? 0);
      out.push({ x: c.x + r.rx * Math.cos(start), y: c.y + r.ry * Math.sin(start) });
      out.push({ x: c.x + r.rx * Math.cos(end), y: c.y + r.ry * Math.sin(end) });
    }
    return out;
  }
  const pts = shape.points;
  for (const p of pts) out.push(p);
  const closed = isClosedShape(shape);
  const segCount = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}
