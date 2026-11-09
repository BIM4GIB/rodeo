// What Rodeo draws in 3D for a Landmark object it draws again: a tree's or plant's canopy and trunk, a
// hardscape's slab, a landscape area's bed. Faces as addMeshes takes them (flat x, y, z triples, mm), kept
// apart from the page so they run in a check.

import type { Pt } from "../../core/index.ts";

/** steps round a canopy or trunk, and up a canopy */
const ROUND = 16;
const UP = 8;

/**
 * An ellipsoid's faces: `rx` and `ry` across (turned `turn` radians), from `z0` up to `z1`, round `at`.
 * Empty when it has no size.
 */
export function canopyFaces(at: Pt, rx: number, ry: number, turn: number, z0: number, z1: number): number[][] {
  if (!(rx > 0) || !(ry > 0) || !(z1 > z0)) return [];
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const rz = (z1 - z0) / 2;
  const mid = z0 + rz;
  const point = (i: number, j: number): number[] => {
    const phi = (Math.PI * j) / UP;
    const theta = (2 * Math.PI * i) / ROUND;
    const x = rx * Math.sin(phi) * Math.cos(theta);
    const y = ry * Math.sin(phi) * Math.sin(theta);
    return [at.x + x * c - y * s, at.y + x * s + y * c, mid - rz * Math.cos(phi)];
  };
  const faces: number[][] = [];
  for (let j = 0; j < UP; j++) {
    for (let i = 0; i < ROUND; i++) {
      const [a, b, d, e] = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
      // the poles' rings close on a point: triangles there
      if (j === 0) faces.push([...a, ...d, ...e]);
      else if (j === UP - 1) faces.push([...a, ...b, ...d]);
      else faces.push([...a, ...b, ...d, ...e]);
    }
  }
  return faces;
}

/** A round post's faces: radius `r` at `at`, from `z0` up to `z1`, its ends closed. Empty when it has no size. */
export function trunkFaces(at: Pt, r: number, z0: number, z1: number): number[][] {
  if (!(r > 0) || !(z1 > z0)) return [];
  const ring = Array.from({ length: ROUND }, (_, i) => ({ x: at.x + r * Math.cos((2 * Math.PI * i) / ROUND), y: at.y + r * Math.sin((2 * Math.PI * i) / ROUND) }));
  return prismFaces(ring, z0, z1);
}

/** A flat-topped slab's faces: `ring` (either way round) from `z0` up to `z1`, top, bottom and sides. */
export function prismFaces(ring: readonly Pt[], z0: number, z1: number): number[][] {
  if (ring.length < 3 || !(z1 > z0)) return [];
  const up = signedArea(ring) > 0 ? ring : [...ring].reverse();
  const top = up.flatMap((p) => [p.x, p.y, z1]);
  const bottom = [...up].reverse().flatMap((p) => [p.x, p.y, z0]);
  const sides = up.map((p, i) => {
    const q = up[(i + 1) % up.length];
    return [p.x, p.y, z0, q.x, q.y, z0, q.x, q.y, z1, p.x, p.y, z1];
  });
  return [top, bottom, ...sides];
}

/** A flat face over `ring` at `z`, facing up. */
export function bedFace(ring: readonly Pt[], z: number): number[][] {
  if (ring.length < 3) return [];
  const up = signedArea(ring) > 0 ? ring : [...ring].reverse();
  return [up.flatMap((p) => [p.x, p.y, z])];
}

/** the area inside a ring, positive when it runs anticlockwise */
export function signedArea(ring: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** the length round a ring */
export function perimeter(ring: readonly Pt[]): number {
  let n = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    n += Math.hypot(q.x - p.x, q.y - p.y);
  }
  return n;
}
