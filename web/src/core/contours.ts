// Contours of 3D objects, for Model > Create Contours: where a plane square to one axis cuts an
// object's triangles, the cut segments joined end to end into chains, closed where they meet
// themselves. A corner lying on the plane is taken as just past it, so a plane through a flat face
// only touches it and draws nothing there. Cut segments are joined where their ends meet, to a
// hundred-thousandth of a millimetre: across the edges triangles share, and where a corner of one
// lies on another's edge (as cut solids' triangles often do).

/** crossings this close (mm) are one */
const WELD = 1e-5;
/** points along a chain closer than this (mm) are one point */
const SAME = 1e-6;
/** a point is dropped when the chain turns there by less than this (sine of the angle) */
const STRAIGHT = 1e-9;

export type Axis = 0 | 1 | 2;

export interface Contour {
  /** x, y, z triples along it */
  points: number[];
  closed: boolean;
}

/** The chains where the plane `axis` = `at` cuts `tris` (9 numbers a triangle). */
export function contourAt(tris: ArrayLike<number>, axis: Axis, at: number): Contour[] {
  const crossing = new Map<string, number[]>();
  const links = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      const l = links.get(from);
      if (l) l.push(to);
      else links.set(from, [to]);
    }
  };
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const past = [0, 1, 2].map((k) => tris[t + 3 * k + axis] >= at);
    const cut: string[] = [];
    for (const [a, b] of [
      [0, 1],
      [1, 2],
      [2, 0],
    ]) {
      if (past[a] === past[b]) continue;
      // from the edge's end short of the plane, so both triangles on an edge find the same point
      const [ia, ib] = past[a] ? [t + 3 * b, t + 3 * a] : [t + 3 * a, t + 3 * b];
      const f = (at - tris[ia + axis]) / (tris[ib + axis] - tris[ia + axis]);
      const pt = [0, 1, 2].map((k) => (k === axis ? at : tris[ia + k] + f * (tris[ib + k] - tris[ia + k])));
      const name = pt.map((v) => Math.round(v / WELD)).join(",");
      if (!crossing.has(name)) crossing.set(name, pt);
      cut.push(name);
    }
    if (cut.length === 2 && cut[0] !== cut[1]) link(cut[0], cut[1]);
  }
  const step = (from: string): string | undefined => {
    const to = links.get(from)?.pop();
    if (to === undefined) return undefined;
    const back = links.get(to)!;
    back.splice(back.lastIndexOf(from), 1);
    return to;
  };
  const walk = (start: string): string[] => {
    const chain = [start];
    for (let to = step(start); to !== undefined; to = chain.at(-1) === start && chain.length > 1 ? undefined : step(to)) chain.push(to);
    return chain;
  };
  const out: Contour[] = [];
  const emit = (chain: string[]): void => {
    const closed = chain.length > 3 && chain[0] === chain.at(-1);
    const pts = tidy((closed ? chain.slice(0, -1) : chain).map((n) => crossing.get(n)!), closed);
    if (pts.length >= (closed ? 3 : 2)) out.push({ points: pts.flat(), closed });
  };
  // chains with loose ends first, from those ends, then the loops left
  for (const [n, l] of links) if (l.length % 2 === 1) emit(walk(n));
  for (const [n, l] of links) while (l.length) emit(walk(n));
  return out;
}

/** A chain's points without repeats or points where it runs straight on. */
function tidy(pts: number[][], closed: boolean): number[][] {
  const out: number[][] = [];
  for (const p of pts) if (!out.length || dist(out.at(-1)!, p) > SAME) out.push(p);
  if (closed && out.length > 1 && dist(out[0], out.at(-1)!) <= SAME) out.pop();
  if (out.length < 3) return out;
  // one pass, each point against the last one kept and the next
  const kept = [out[0]];
  for (let i = 1; i < out.length - 1; i++) if (!straight(kept.at(-1)!, out[i], out[i + 1])) kept.push(out[i]);
  kept.push(out.at(-1)!);
  if (closed) {
    // round the join: the last point, then the first
    if (kept.length > 3 && straight(kept.at(-2)!, kept.at(-1)!, kept[0])) kept.pop();
    if (kept.length > 3 && straight(kept.at(-1)!, kept[0], kept[1])) kept.shift();
  }
  return kept;
}

function dist(a: number[], b: number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** True when b lies on the way from a to c. */
function straight(a: number[], b: number[], c: number[]): boolean {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lu = Math.hypot(...u);
  const lv = Math.hypot(...v);
  if (!(lu > 0 && lv > 0)) return true;
  const cross = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
  return cross <= STRAIGHT * lu * lv && u[0] * v[0] + u[1] * v[1] + u[2] * v[2] > 0;
}
