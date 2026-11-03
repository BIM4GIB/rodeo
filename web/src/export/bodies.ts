// The 3D exchange writers' bodies (export/step.ts, export/iges.ts): an object's shaded triangles merged
// back into its flat faces (core/faces3d.ts), their corners welded into numbered vertices, the faces
// that join along an edge one body, each body's faces turned to agree and face out. A body whose
// faces close round it (every edge run once each way) is a solid. Plain data in and out.

import { facesOf } from "../core/faces3d.ts";

/** points this close (mm) are one vertex, as faces3d welds them */
const WELD = 1e-4;

export type V3 = [number, number, number];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const len = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

/** A face: its corners as vertex numbers in order round it (counter-clockwise seen from outside), and its colour. */
export interface Face {
  readonly v: number[];
  readonly color: string;
}

/** The faces' bodies: those joined along an edge, together. */
function bodies(faces: readonly Face[]): Face[][] {
  const up = faces.map((_, i) => i);
  const find = (i: number): number => {
    while (up[i] !== i) i = up[i] = up[up[i]];
    return i;
  };
  const byEdge = new Map<string, number>();
  faces.forEach((f, i) => {
    for (let k = 0; k < f.v.length; k++) {
      const a = f.v[k];
      const b = f.v[(k + 1) % f.v.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const other = byEdge.get(key);
      if (other === undefined) byEdge.set(key, i);
      else up[find(i)] = find(other);
    }
  });
  const groups = new Map<number, Face[]>();
  faces.forEach((f, i) => {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(f);
    else groups.set(root, [f]);
  });
  return [...groups.values()];
}

/**
 * A body's faces turned to agree: each edge two faces share run opposite ways by them (the 3D view
 * draws both sides, so a cap can come wound as its opposite one), then all of them turned to face out
 * (a closed body's volume positive) or, open, the way most of them came. As they came when an edge
 * has more than two faces or they can't agree (a Möbius strip).
 */
function orient(faces: readonly Face[], pts: readonly V3[]): Face[] {
  const onEdge = new Map<string, number[]>();
  faces.forEach((f, i) => {
    for (let k = 0; k < f.v.length; k++) {
      const a = f.v[k];
      const b = f.v[(k + 1) % f.v.length];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      onEdge.set(key, [...(onEdge.get(key) ?? []), i]);
    }
  });
  if ([...onEdge.values()].some((l) => l.length > 2)) return [...faces];
  /** whether face i runs a to b */
  const runs = (i: number, a: number, b: number): boolean => {
    const v = faces[i].v;
    const k = v.indexOf(a);
    return v[(k + 1) % v.length] === b;
  };
  const flip: (boolean | undefined)[] = faces.map(() => undefined);
  for (let start = 0; start < faces.length; start++) {
    if (flip[start] !== undefined) continue;
    flip[start] = false;
    const queue = [start];
    while (queue.length) {
      const i = queue.pop()!;
      const v = faces[i].v;
      for (let k = 0; k < v.length; k++) {
        const a = v[k];
        const b = v[(k + 1) % v.length];
        const other = onEdge.get(a < b ? `${a},${b}` : `${b},${a}`)!.find((j) => j !== i);
        if (other === undefined) continue;
        // as turned, i runs a to b exactly when it isn't flipped; other must then run b to a
        const want = runs(other, a, b) !== flip[i];
        if (flip[other] === undefined) {
          flip[other] = want;
          queue.push(other);
        } else if (flip[other] !== want) return [...faces];
      }
    }
  }
  let turned = faces.map((f, i) => (flip[i] ? { ...f, v: [...f.v].reverse() } : f));
  let outward: boolean;
  if (closes(turned)) {
    let volume = 0;
    for (const f of turned) {
      const p = pts[f.v[0]];
      for (let k = 1; k + 1 < f.v.length; k++) {
        const q = pts[f.v[k]];
        const r = pts[f.v[k + 1]];
        volume += p[0] * (q[1] * r[2] - q[2] * r[1]) + p[1] * (q[2] * r[0] - q[0] * r[2]) + p[2] * (q[0] * r[1] - q[1] * r[0]);
      }
    }
    outward = volume >= 0;
  } else outward = flip.filter(Boolean).length * 2 <= faces.length;
  if (!outward) turned = turned.map((f) => ({ ...f, v: [...f.v].reverse() }));
  return turned;
}

/** True when every edge of `faces` is run once each way: they close round a solid. */
export function closes(faces: readonly Face[]): boolean {
  const runs = new Map<string, number>();
  for (const f of faces) {
    for (let k = 0; k < f.v.length; k++) {
      const key = `${f.v[k]},${f.v[(k + 1) % f.v.length]}`;
      runs.set(key, (runs.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of runs) {
    const [a, b] = key.split(",");
    if (n !== 1 || runs.get(`${b},${a}`) !== 1) return false;
  }
  return true;
}

/** An object's pieces as its vertices and its bodies, each body's faces turned to agree and face out. */
export function objectBodies(pieces: readonly { readonly color: string; readonly triangles: ArrayLike<number> }[]): { pts: V3[]; bodies: Face[][] } {
  const pts: V3[] = [];
  const byKey = new Map<string, number>();
  const vertex = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x / WELD)},${Math.round(y / WELD)},${Math.round(z / WELD)}`;
    let n = byKey.get(key);
    if (n === undefined) {
      n = pts.length;
      pts.push([x, y, z]);
      byKey.set(key, n);
    }
    return n;
  };
  const faces: Face[] = [];
  for (const piece of pieces) {
    for (const f of facesOf(piece.triangles)) {
      const v: number[] = [];
      for (let i = 0; i + 2 < f.length; i += 3) {
        const n = vertex(f[i], f[i + 1], f[i + 2]);
        if (v[v.length - 1] !== n) v.push(n);
      }
      while (v.length > 1 && v[0] === v[v.length - 1]) v.pop();
      if (v.length >= 3) faces.push({ v, color: piece.color });
    }
  }
  return { pts, bodies: faces.length ? bodies(faces).map((b) => orient(b, pts)) : [] };
}

/** A face's plane: its unit normal (out of its front, as its corners run round it) and a unit x along its first edge; null when its corners lie on a line. */
export function facePlane(f: Face, pts: readonly V3[]): { n: V3; x: V3 } | null {
  // Newell's normal, which runs out of the face's front
  const n: V3 = [0, 0, 0];
  for (let k = 0; k < f.v.length; k++) {
    const p = pts[f.v[k]];
    const q = pts[f.v[(k + 1) % f.v.length]];
    n[0] += (p[1] - q[1]) * (p[2] + q[2]);
    n[1] += (p[2] - q[2]) * (p[0] + q[0]);
    n[2] += (p[0] - q[0]) * (p[1] + q[1]);
  }
  const nl = len(n);
  const first = sub(pts[f.v[1]], pts[f.v[0]]);
  // the plane's x along the first edge, made square to its normal
  const along = first[0] * n[0] + first[1] * n[1] + first[2] * n[2];
  const x: V3 = [first[0] - (along * n[0]) / (nl * nl), first[1] - (along * n[1]) / (nl * nl), first[2] - (along * n[2]) / (nl * nl)];
  const xl = len(x);
  if (!(nl > 1e-9) || !(xl > 1e-9)) return null;
  return { n: [n[0] / nl, n[1] / nl, n[2] / nl], x: [x[0] / xl, x[1] / xl, x[2] / xl] };
}
