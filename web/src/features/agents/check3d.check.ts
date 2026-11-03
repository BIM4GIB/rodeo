// Checks the closed-solid check under Node. Run from web/:
//   npx tsx src/features/agents/check3d.check.ts
// A box is closed; with its top taken off it has one hole the size of the top; with a face turned
// inside out it is still closed (winding isn't read); with its top cut into triangles that meet a side's edge part way
// along (a T junction) it is still closed; with its corners a fraction of a millimetre apart it is
// still closed; two boxes sharing a face overlap there. A box cut into 40 × 40 squares a side
// (19,200 triangles) checks in well under a second.

import { closureOf } from "./check3d.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type V = [number, number, number];

/** a quad as two triangles, corners counter-clockwise seen from outside */
const quad = (a: V, b: V, c: V, d: V): number[] => [...a, ...b, ...c, ...a, ...c, ...d];

/** a box's six faces, each cut into n × n squares, outward */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, n = 1, skipTop = false): number[] {
  const out: number[] = [];
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
  // each face: its corner, two sides, and the order that faces outward
  const faces: [V, V, V][] = [
    [[x0, y0, z0], [0, y1 - y0, 0], [x1 - x0, 0, 0]], // bottom, seen from below
    [[x0, y0, z1], [x1 - x0, 0, 0], [0, y1 - y0, 0]], // top
    [[x0, y0, z0], [x1 - x0, 0, 0], [0, 0, z1 - z0]], // front (y0)
    [[x0, y1, z0], [0, 0, z1 - z0], [x1 - x0, 0, 0]], // back (y1)
    [[x0, y0, z0], [0, 0, z1 - z0], [0, y1 - y0, 0]], // left (x0)
    [[x1, y0, z0], [0, y1 - y0, 0], [0, 0, z1 - z0]], // right (x1)
  ];
  faces.forEach(([o, u, v], f) => {
    if (skipTop && f === 1) return;
    const at = (i: number, j: number): V => [0, 1, 2].map((k) => o[k] + lerp(0, u[k], i / n) + lerp(0, v[k], j / n)) as V;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out.push(...quad(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)));
  });
  return out;
}

{
  const c = closureOf(box(0, 0, 0, 1000, 2000, 3000));
  check(c.triangles === 12 && c.open === 0 && c.overlaps === 0 && c.holes.length === 0, `a box is closed (${c.edges} edges)`);
}
{
  const c = closureOf(box(0, 0, 0, 1000, 2000, 3000, 1, true));
  const h = c.holes[0];
  check(c.open === 4 && c.holes.length === 1 && h.edges === 4, `a box without its top has one hole of four edges (${c.open} open, ${c.holes.length} holes)`);
  check(!!h && h.rim.length === 24 && h.across === 2000 && h.at[0] === 500 && h.at[1] === 1000 && h.at[2] === 3000, `the hole is the top: 2,000 across at its middle, its rim four edges (${JSON.stringify({ ...h, rim: h?.rim.length })})`);
}
{
  const t = box(0, 0, 0, 1000, 1000, 1000);
  // the first triangle turned round: its second and third corners swapped
  const turned = [...t.slice(0, 3), ...t.slice(6, 9), ...t.slice(3, 6), ...t.slice(9)];
  const c = closureOf(turned);
  check(c.open === 0 && c.overlaps === 0, `a triangle turned inside out still closes the box (${c.open} open)`);
}
{
  // the top cut at the middle of its front edge: three triangles, two of them meeting the
  // front face's single top edge part way along
  const t = box(0, 0, 0, 1000, 1000, 1000, 1, true);
  const m: V = [500, 0, 1000];
  t.push(...[0, 0, 1000], ...m, ...[0, 1000, 1000]);
  t.push(...m, ...[1000, 0, 1000], ...[1000, 1000, 1000]);
  t.push(...m, ...[1000, 1000, 1000], ...[0, 1000, 1000]);
  const c = closureOf(t);
  check(c.open === 0 && c.overlaps === 0, `faces meeting an edge part way along close it (${c.open} open)`);
}
{
  // every copy of every corner nudged by up to 0.1 mm each way
  let seed = 7;
  const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.2;
  const c = closureOf(box(0, 0, 0, 1000, 1000, 1000, 3).map((v) => v + rnd()));
  check(c.open === 0 && c.overlaps === 0, `corners a fraction of a millimetre apart are welded (${c.open} open, ${c.overlaps} overlapping)`);
}
{
  const c = closureOf([...box(0, 0, 0, 1000, 1000, 1000), ...box(0, 0, 1000, 1000, 1000, 2000)]);
  check(c.overlaps > 0 && c.open === 0, `two boxes sharing a face overlap there (${c.overlaps} overlapping edges)`);
}
{
  const t = box(0, 0, 0, 4000, 4000, 4000, 40);
  const t0 = performance.now();
  const c = closureOf(t);
  const ms = performance.now() - t0;
  check(c.triangles === 19200 && c.open === 0, `a box of 19,200 triangles is closed`);
  check(ms < 1000, `and is checked in under a second (${ms.toFixed(0)} ms)`);
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
