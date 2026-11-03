// The object context menu's Convert Arc to Radius Polyline: a polyline's arc (fillet) vertices
// made radius vertices, which lie on the curve, so it is reshaped by dragging a point of it. Each
// fillet as drawn (filletArcs) becomes a corner where it leaves the edge before, a radius vertex
// half way round it and a corner where it meets the edge after; arcs meeting on one circle become
// one radius vertex where they meet, as Vectorworks' example shows. The curve stays as it was. The
// polyline keeps its place, class and attributes, in one undo step. Modify > Poly Smoothing >
// Radius Smoothing is Arc Smoothing made so (compose.ts).

import { type FilletArc, filletArcs, type NewShape, type Pt, type VertexKind } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { store } from "./state.ts";

interface Item {
  p: Pt;
  kind: VertexKind;
  radius: number;
  /** a radius vertex's arc, from the vertex before it to the one after */
  arc?: FilletArc;
}

const near = (a: Pt, b: Pt, tol: number): boolean => Math.hypot(a.x - b.x, a.y - b.y) <= tol;

/** Two arcs on one circle, turning the same way. */
function sameCircle(a: FilletArc, b: FilletArc): boolean {
  const tol = 1e-7 * Math.max(a.r, b.r);
  return near(a.centre, b.centre, tol) && Math.abs(a.r - b.r) <= tol && Math.sign(a.sweep) === Math.sign(b.sweep);
}

/** The polyline these vertices make with its fillets as radius vertices, or null when none is drawn. */
export function radiusVertices(vertices: readonly { p: Pt; kind: VertexKind; radius?: number }[], closed: boolean): NewShape | null {
  const arcs = filletArcs(vertices, closed);
  if (!arcs.some(Boolean)) return null;
  const xs = vertices.map((v) => v.p.x);
  const ys = vertices.map((v) => v.p.y);
  const tol = 1e-9 * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const items: Item[] = [];
  // a vertex where the last one is stands for both, as the one that isn't a corner
  const push = (it: Item): void => {
    const last = items[items.length - 1];
    if (last && near(last.p, it.p, tol)) {
      if (it.kind !== "corner") items[items.length - 1] = it;
      return;
    }
    items.push(it);
  };
  vertices.forEach((v, i) => {
    const f = arcs[i];
    // an arc vertex that isn't drawn bent is a corner
    if (!f) return push({ p: v.p, kind: v.kind === "arc" ? "corner" : v.kind, radius: v.kind === "arc" ? 0 : (v.radius ?? 0) });
    const mid = Math.atan2(f.from.y - f.centre.y, f.from.x - f.centre.x) + f.sweep / 2;
    push({ p: f.from, kind: "corner", radius: 0 });
    push({ p: { x: f.centre.x + f.r * Math.cos(mid), y: f.centre.y + f.r * Math.sin(mid) }, kind: "through", radius: f.r, arc: f });
    push({ p: f.to, kind: "corner", radius: 0 });
  });
  if (closed && items.length > 1 && near(items[items.length - 1].p, items[0].p, tol)) {
    const last = items.pop()!;
    if (last.kind !== "corner") items[0] = last;
  }
  // where two arcs on one circle meet: what is left of a whole turn when they are joined
  const joint = (k: number): boolean => {
    const n = items.length;
    const a = items[(k - 1 + n) % n].arc;
    const b = items[(k + 1) % n].arc;
    return items[k].kind === "corner" && !!a && !!b && sameCircle(a, b);
  };
  // a closed polyline starts at a corner that isn't such a joint, so each joint is inside the list
  if (closed) {
    const start = items.findIndex((it, k) => it.kind === "corner" && !joint(k));
    if (start > 0) items.push(...items.splice(0, start));
  }
  for (let k = 1; k + 1 < items.length; ) {
    const a = items[k - 1].arc;
    const b = items[k + 1].arc;
    if (joint(k) && a && b && Math.abs(a.sweep + b.sweep) < 2 * Math.PI - 1e-6) {
      const arc = { ...a, to: b.to, sweep: a.sweep + b.sweep };
      items.splice(k - 1, 3, { p: items[k].p, kind: "through", radius: a.r, arc });
    } else {
      k++;
    }
  }
  return {
    kind: "polyline",
    points: items.map((it) => it.p),
    closed,
    vertices: items.map((it) => it.kind),
    radii: items.map((it) => it.radius),
  };
}

/** The radius polyline the polyline `id` becomes, or null when it isn't one with an arc vertex drawn. */
function converted(id: string): NewShape | null {
  const s = store.session?.doc.object(id)?.shape;
  if (s?.kind !== "polyline" || !s.vertices?.some((v) => v.kind === "arc")) return null;
  return radiusVertices(s.vertices, s.closed);
}

export function canConvertArc(id: string): boolean {
  return converted(id) !== null;
}

/** Convert Arc to Radius Polyline: the polyline `id` with its arc vertices made radius vertices, selected. */
export function convertArcToRadiusPolyline(id: string): void {
  const shape = converted(id);
  if (!shape) return;
  const r = attempt("Convert Arc to Radius Polyline", (session) => session.replaceObjects([id], [shape]));
  if (r) setSelection(r.value);
}
