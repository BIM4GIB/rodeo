// Checks round bodies rebuilt from their meridians (model3d meridianFaces), as an existing tree's
// canopy is saved: edges only, four or more meridians from pole to pole and rings round them. Run from web/:
//   npx tsx src/core/meridian.check.ts
// A sphere of six meridians with a ring round its middle is swept whole: every corner on it, its area
// a sphere's, its faces facing out; one drawn the other way round the same; an egg's height kept; and a
// box, two meridians, and meridians that don't share their poles left to the other ways of finding faces.

import { meridianFaces, type Wire } from "./model3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** A wire of `meridians` from the south pole to the north, each `steps` long, round a body `rx` wide and `rz` high, with a ring round its middle. */
function roundWire(meridians: number, steps: number, rx: number, rz: number, reversed = false): Wire {
  const pts: number[] = [0, 0, -rz, 0, 0, rz];
  const lines: Uint32Array[] = [];
  const middle: number[] = [];
  for (let k = 0; k < meridians; k++) {
    const turn = (2 * Math.PI * k) / meridians;
    const run = [0];
    for (let i = 1; i < steps; i++) {
      const phi = (Math.PI * i) / steps;
      run.push(pts.length / 3);
      if (2 * i === steps) middle.push(pts.length / 3);
      pts.push(rx * Math.sin(phi) * Math.cos(turn), rx * Math.sin(phi) * Math.sin(turn), -rz * Math.cos(phi));
    }
    run.push(1);
    lines.push(Uint32Array.from(reversed ? run.reverse() : run));
  }
  const ring = Uint32Array.from([...middle, middle[0]]);
  const edges: number[] = [];
  for (const r of [...lines, ring]) for (let i = 1; i < r.length; i++) edges.push(r[i - 1], r[i]);
  return { pts: Float64Array.from(pts), edges: Uint32Array.from(edges), curves: [], lines: [...lines, ring] };
}

interface Swept {
  ok: boolean;
  triangles: number;
  /** the corners' furthest from the sphere of `r`, as a share of it */
  off: number;
  area: number;
  /** triangles facing in */
  inward: number;
  zMin: number;
  zMax: number;
}

function sweep(w: Wire, r: number): Swept {
  const out: number[] = [];
  const ok = meridianFaces(w, out);
  let off = 0;
  let area = 0;
  let inward = 0;
  let [zMin, zMax] = [Infinity, -Infinity];
  for (let i = 0; i + 8 < out.length; i += 9) {
    const [a, b, c] = [0, 3, 6].map((k) => [out[i + k], out[i + k + 1], out[i + k + 2]]);
    for (const p of [a, b, c]) {
      off = Math.max(off, Math.abs(Math.hypot(p[0], p[1], p[2]) - r) / r);
      zMin = Math.min(zMin, p[2]);
      zMax = Math.max(zMax, p[2]);
    }
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    area += Math.hypot(n[0], n[1], n[2]) / 2;
    const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2] < 0) inward++;
  }
  return { ok, triangles: out.length / 9, off, area, inward, zMin, zMax };
}

const R = 1000;
const sphere = sweep(roundWire(6, 8, R, R), R);
check(sphere.ok && sphere.triangles > 100, `a sphere of six meridians is swept round (${sphere.triangles} triangles)`);
check(sphere.off < 0.03, `every corner is on the sphere (furthest ${(sphere.off * 100).toFixed(2)}% off)`);
check(Math.abs(sphere.area / (4 * Math.PI * R * R) - 1) < 0.03, `its area is a sphere's (${((sphere.area / (4 * Math.PI * R * R)) * 100).toFixed(1)}%)`);
check(sphere.inward === 0, "every face faces out");

const back = sweep(roundWire(6, 8, R, R, true), R);
check(back.ok && back.inward === 0 && Math.abs(back.area - sphere.area) < 1, "meridians drawn north to south make the same surface");

const egg = sweep(roundWire(4, 6, 600, 1500), 1000);
check(egg.ok && Math.abs(egg.zMin + 1500) < 1 && Math.abs(egg.zMax - 1500) < 1, `an egg of four meridians keeps its height (${egg.zMin.toFixed(0)} to ${egg.zMax.toFixed(0)})`);

// a box: twelve straight edges, no meridians
const box: Wire = {
  pts: Float64Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  edges: Uint32Array.from([0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7]),
  curves: [],
  lines: [],
};
const boxOut: number[] = [];
check(!meridianFaces(box, boxOut) && boxOut.length === 0, "a box isn't swept, and nothing is added");

const two = roundWire(2, 8, R, R);
check(!meridianFaces(two, []), "two meridians aren't enough");

const apart = roundWire(4, 8, R, R);
// one meridian ends somewhere else
const last = apart.lines[3];
const moved = Uint32Array.from([...last.slice(0, -1), last[last.length - 2]]);
const lines = [...apart.lines.slice(0, 3), moved, apart.lines[4]];
check(!meridianFaces({ ...apart, lines }, []), "meridians that don't share both poles aren't swept");

const extra: Wire = { ...roundWire(4, 8, R, R) };
// from the first meridian's first step to the second's: on neither, nor on the ring
extra.edges = Uint32Array.from([...extra.edges, 2, 9]);
check(!meridianFaces(extra, []), "an edge on no meridian or ring stops it");

console.log(failures ? `${failures} failed` : "all passed");
if (failures) process.exit(1);
