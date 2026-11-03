// Trims the OpenStreetMap features to the chosen area. Overpass answers with every way that
// touches the box, whole: a river or a long road can run on for kilometres past it. Areas
// (water, green space) and lines are cut at the box's edge; buildings stay whole, since half a
// building is no use as context; trees, facilities and labels outside it are dropped.

import type { Pt } from "../../core/index.ts";
import type { SiteFeature, SiteGeom } from "./model.ts";

export interface Rect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

function inside(r: Rect, p: Pt): boolean {
  return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

/** A polygon cut to the rectangle (Sutherland–Hodgman), or null when nothing of it is inside. */
export function clipPolygon(points: readonly Pt[], r: Rect): Pt[] | null {
  type Edge = { in: (p: Pt) => boolean; cut: (a: Pt, b: Pt) => Pt };
  const atX = (x: number) => (a: Pt, b: Pt): Pt => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });
  const atY = (y: number) => (a: Pt, b: Pt): Pt => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
  const edges: Edge[] = [
    { in: (p) => p.x >= r.x0, cut: atX(r.x0) },
    { in: (p) => p.x <= r.x1, cut: atX(r.x1) },
    { in: (p) => p.y >= r.y0, cut: atY(r.y0) },
    { in: (p) => p.y <= r.y1, cut: atY(r.y1) },
  ];
  let out: Pt[] = [...points];
  for (const e of edges) {
    const src = out;
    out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length];
      const b = src[i];
      if (e.in(b)) {
        if (!e.in(a)) out.push(e.cut(a, b));
        out.push(b);
      } else if (e.in(a)) {
        out.push(e.cut(a, b));
      }
    }
    if (out.length === 0) return null;
  }
  return out.length >= 3 ? out : null;
}

/** The parts of a line inside the rectangle (Liang–Barsky per segment), each as its own line. */
export function clipPolyline(points: readonly Pt[], r: Rect): Pt[][] {
  const pieces: Pt[][] = [];
  let current: Pt[] = [];
  const close = (): void => {
    if (current.length >= 2) pieces.push(current);
    current = [];
  };
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    let hit = true;
    for (const [p, q] of [
      [-dx, a.x - r.x0],
      [dx, r.x1 - a.x],
      [-dy, a.y - r.y0],
      [dy, r.y1 - a.y],
    ] as const) {
      if (p === 0) {
        if (q < 0) hit = false;
      } else {
        const t = q / p;
        if (p < 0) t0 = Math.max(t0, t);
        else t1 = Math.min(t1, t);
      }
    }
    if (!hit || t0 > t1) {
      close();
      continue;
    }
    const from = t0 === 0 ? a : { x: a.x + t0 * dx, y: a.y + t0 * dy };
    const to = t1 === 1 ? b : { x: a.x + t1 * dx, y: a.y + t1 * dy };
    if (current.length === 0) current.push(from);
    current.push(to);
    // the line leaves the rectangle here: the next part inside is a new piece
    if (t1 < 1) close();
  }
  close();
  return pieces;
}

function clipGeom(geom: SiteGeom, r: Rect): SiteGeom[] {
  switch (geom.kind) {
    case "polygon": {
      const points = clipPolygon(geom.points, r);
      return points ? [{ kind: "polygon", points }] : [];
    }
    case "polyline": {
      const pts = geom.closed && geom.points.length > 0 ? [...geom.points, geom.points[0]] : geom.points;
      // a loop that stays inside keeps its closed form
      if (pts.every((p) => inside(r, p))) return [geom];
      return clipPolyline(pts, r).map((points) => ({ kind: "polyline", points }));
    }
    case "circle":
    case "label":
      return inside(r, geom.at) ? [geom] : [];
  }
}

/** The features cut to the rectangle (world millimetres). */
export function clipFeatures(features: readonly SiteFeature[], r: Rect): SiteFeature[] {
  const out: SiteFeature[] = [];
  for (const f of features) {
    if (f.cat === "buildings") {
      out.push(f);
      continue;
    }
    for (const geom of clipGeom(f.geom, r)) out.push({ ...f, geom });
  }
  return out;
}
