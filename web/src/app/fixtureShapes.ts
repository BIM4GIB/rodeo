// What Furniture/Fixtures' Countertop and Spotlight's Focus Point tools (tools/fixtures.ts) draw in
// Top/Plan, as plain geometry in the drawing's coordinates: a countertop's backsplash line inside
// the edges it stands on, and a focus point's octagon with its name. Kept apart from the tools so
// it runs without the page.

import type { Pt } from "../core/index.ts";
import { intersectLines, offsetPolyline, pointInPolygon, signedArea, unitVector } from "./geom.ts";
import type { MarkerDrawing } from "./markerShapes.ts";

const at = (x: number, y: number): Pt => ({ x, y });

/** Why a countertop's outline can't be drawn, or null when it can. */
export function countertopProblem(outline: readonly Pt[]): string | null {
  if (outline.length < 3) return "Click at least three corners round the countertop.";
  return Math.abs(signedArea(outline)) > 0 ? null : "Click corners that enclose an area for the countertop.";
}

/**
 * The backsplash `thickness` deep inside the first `edges` edges of `outline` (the edge from its
 * first corner on, and those after it): its inner line, meeting the edges either side of it; the
 * whole way round when every edge has one. A message when it doesn't fit inside.
 */
export function backsplashLine(outline: readonly Pt[], edges: number, thickness: number): Pt[] | string {
  const n = outline.length;
  const k = Math.min(Math.floor(edges), n);
  if (k <= 0 || !(thickness > 0)) return [];
  // inside lies to the left of a counter-clockwise outline's edges
  const inward = signedArea(outline) > 0 ? thickness : -thickness;
  if (k === n) {
    const ring = offsetPolyline(outline, true, inward);
    return ring && signedArea(ring) * signedArea(outline) > 0 ? [...ring, ring[0]] : "The backsplash is deeper than the countertop.";
  }
  const chain = outline.slice(0, k + 1);
  const inner = offsetPolyline(chain, false, inward);
  if (!inner) return "The backsplash is deeper than the countertop.";
  // its ends meet the edges either side of the chain: the last edge before it and the one after it
  const before = { a: outline[n - 1], b: outline[0] };
  const afterA = outline[k % n];
  const afterB = outline[(k + 1) % n];
  const first = intersectLines(inner[0], unitVector(inner[0], inner[1]), before.a, unitVector(before.a, before.b));
  const last = intersectLines(inner[inner.length - 1], unitVector(inner[inner.length - 2], inner[inner.length - 1]), afterA, unitVector(afterA, afterB));
  if (!first || !last) return "The backsplash is deeper than the countertop.";
  const line = [first, ...inner.slice(1, -1), last];
  // it fits when each stretch runs as its edge does, its ends meet the edges beside it, and its corners lie inside
  const along = (p: Pt, q: Pt, a: Pt, b: Pt): boolean => (q.x - p.x) * (b.x - a.x) + (q.y - p.y) * (b.y - a.y) > 0;
  const on = (p: Pt, a: Pt, b: Pt): boolean => {
    const t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / ((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    return t >= -1e-9 && t <= 1 + 1e-9;
  };
  const fits =
    line.every((q, i) => i === 0 || along(line[i - 1], q, chain[i - 1], chain[i])) &&
    on(first, before.a, before.b) &&
    on(last, afterA, afterB) &&
    line.slice(1, -1).every((q) => pointInPolygon(q, outline));
  return fits ? line : "The backsplash is deeper than the countertop.";
}

/** points round a focus point's octagon */
const OCTAGON = 8;

/**
 * A focus point `size` across on the origin: an octagon (a flat side up), or nothing for a locus
 * (the tool adds that); its name to its right, `textSize` high, when not blank.
 */
export function focusPoint(size: number, octagon: boolean, name: string, textSize: number): MarkerDrawing {
  const r = size / 2 / Math.cos(Math.PI / OCTAGON);
  const outlines = octagon ? [Array.from({ length: OCTAGON }, (_, i) => at(r * Math.cos(((2 * i + 1) * Math.PI) / OCTAGON), r * Math.sin(((2 * i + 1) * Math.PI) / OCTAGON)))] : [];
  const reach = octagon ? size / 2 : 0;
  const texts = name.trim() ? [{ at: at(reach + textSize * 0.5, 0), text: name.trim(), height: textSize, justify: "left" as const }] : [];
  return { outlines, lines: [], circles: [], filled: [], texts };
}
