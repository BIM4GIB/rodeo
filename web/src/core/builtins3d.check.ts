// Checks the built-in 3D polygon, mesh and extrude under Node. Run from web/:
//   npx tsx src/core/builtins3d.check.ts [drawing.vwx ...]
// A drawing with no 3D polygon, mesh or extrude of its own (the blank drawing, and any drawings
// named) takes a mesh box through addMeshes, its copy through Convert to 3D Polygons, two 3D
// lines through add3DPolygons, an extrude, a wall with a window cut out of it (Subtract Solids)
// and a sweep, saves, reopens and shows them all in 3D where they were put. Nothing is drawn.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import type { EditSession } from "./types.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** a 2 m × 1 m × 3 m box's six faces, x, y, z triples round each, lifted `z0` */
function box(z0: number): number[][] {
  const c = (x: number, y: number, z: number): number[] => [x * 2000, y * 1000, z0 + z * 3000];
  return [
    [...c(0, 0, 0), ...c(0, 1, 0), ...c(1, 1, 0), ...c(1, 0, 0)],
    [...c(0, 0, 1), ...c(1, 0, 1), ...c(1, 1, 1), ...c(0, 1, 1)],
    [...c(0, 0, 0), ...c(1, 0, 0), ...c(1, 0, 1), ...c(0, 0, 1)],
    [...c(1, 0, 0), ...c(1, 1, 0), ...c(1, 1, 1), ...c(1, 0, 1)],
    [...c(1, 1, 0), ...c(0, 1, 0), ...c(0, 1, 1), ...c(1, 1, 1)],
    [...c(0, 1, 0), ...c(0, 0, 0), ...c(0, 0, 1), ...c(0, 1, 1)],
  ];
}

/** the low and high corners of what model3d draws for an object (a group's parts come as several meshes) */
function extent(s: EditSession, id: string): { lo: number[]; hi: number[]; triangles: number } | null {
  const ms = s.doc.model3d().filter((x) => x.objectId === id);
  if (!ms.length) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  for (const m of ms) {
    // open 3D polygons draw edges only
    for (const v of [m.triangles, m.edges]) {
      for (let i = 0; i < v.length; i++) {
        lo[i % 3] = Math.min(lo[i % 3], v[i]);
        hi[i % 3] = Math.max(hi[i % 3], v[i]);
      }
    }
    triangles += m.triangles.length / 9;
  }
  return { lo, hi, triangles };
}

const near = (a: readonly number[], b: readonly number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);

function run(label: string, bytes: Uint8Array): void {
  const s = openVwx(bytes, `${label}.vwx`);
  const layer = s.createLayer("Built-in 3D check", "design", 50);
  const elevation = s.doc.layers().find((l) => l.id === layer)!.elevation ?? 0;
  check(s.canAddMeshes(), `${label}: can add meshes`);

  const [mesh] = s.addMeshes(layer, [box(elevation + 500)]);
  // a copy of the box as 3D polygons, one per face, moved clear of it
  const [copy] = s.addMeshes(layer, [box(elevation + 500)]);
  s.moveObjects3D([copy], 5000, 0, 0);
  const polys = s.convertTo3DPolygons([copy]);
  check(!!mesh && polys.length > 0, `${label}: mesh and 3D polygons made`);
  // an upright edge and a level one meeting at its top, as 3D lines
  const wire = s.add3DPolygons(layer, [
    { points: [9000, 0, 0, 9000, 0, 2500], closed: false },
    { points: [9000, 0, 2500, 11000, 0, 2500], closed: false },
  ]);

  // a box, and a wall with a window hole taken out of it, both extrudes; a ring swept round
  const [block] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 0, y0: 6000, x1: 1000, y1: 7000 })], 2000);
  const [wall] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 0, y0: 3000, x1: 4000, y1: 3300 })], 2500);
  const [hole] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 1500, y0: 2900, x1: 2500, y1: 3400 })], 1200);
  s.moveObjects3D([hole], 0, 0, 900);
  const cut = s.combineSolids([wall, hole], true);
  const [ring] = s.sweepObjects([s.addObject(layer, { kind: "rect", x0: 6000, y0: 0, x1: 6500, y1: 1000 })], 360, 15);

  const again = openVwx(s.doc.toBytes(), `${label}-saved.vwx`);
  const m = extent(again, mesh);
  check(!!m && near(m.lo, [0, 0, elevation + 500]) && near(m.hi, [2000, 1000, elevation + 3500]), `${label}: the mesh box reopens where it was put`);
  check(!!m && m.triangles === 12, `${label}: the mesh shows its six faces (12 triangles, ${m?.triangles})`);
  const faces = polys.map((id) => extent(again, id)).filter((x) => x !== null);
  const lo = [0, 1, 2].map((k) => Math.min(...faces.map((f) => f.lo[k])));
  const hi = [0, 1, 2].map((k) => Math.max(...faces.map((f) => f.hi[k])));
  check(faces.length === polys.length, `${label}: the converted 3D polygons show in 3D`);
  check(near(lo, [5000, 0, elevation + 500]) && near(hi, [7000, 1000, elevation + 3500]), `${label}: the 3D polygons reopen where the box was moved`);
  check(again.doc.object(mesh)?.layerId === layer, `${label}: the mesh is on its layer`);
  const w = extent(again, wire);
  check(!!w && near(w.lo, [9000, 0, elevation]) && near(w.hi, [11000, 0, elevation + 2500]), `${label}: the 3D lines reopen where they were put`);
  check(again.doc.object(wire)?.kind === "group", `${label}: the 3D lines are grouped`);
  const b = extent(again, block);
  check(!!b && near(b.lo, [0, 6000, elevation]) && near(b.hi, [1000, 7000, elevation + 2000]) && b.triangles === 12, `${label}: the extrude reopens as a 1 × 1 × 2 m box (${b?.triangles} triangles)`);
  const c = extent(again, cut);
  check(!!c && near(c.lo, [0, 3000, elevation]) && near(c.hi, [4000, 3300, elevation + 2500]), `${label}: the wall with its window cut reopens where it was`);
  check(!!c && c.triangles > 12, `${label}: the window hole shows in 3D (${c?.triangles} triangles)`);
  const r = extent(again, ring);
  check(!!r && r.triangles > 0 && Math.abs(r.hi[2] - r.lo[2] - 1000) < 1e-3, `${label}: the sweep reopens and shows in 3D (${r?.triangles} triangles)`);
}

/** A drawing's first symbol: made, placed twice, saved, reopened, undone. */
function symbols(label: string, bytes: Uint8Array): void {
  const s = openVwx(bytes, "x.vwx");
  const layer = s.doc.layers()[0].id;
  const rect = s.addObject(layer, { kind: "rect", x0: 1000, y0: 2000, x1: 1400, y1: 2200 });
  const defsBefore = s.doc.symbolDefs().length;
  const inst = s.createSymbol([rect], "First", { x: 1000, y: 2000 });
  check(s.doc.symbolDefs().length === defsBefore + 1, `${label}: the symbol is listed`);
  const index = s.doc.symbolDefs().find((d) => d.name === "First")!.index;
  const placed = s.doc.object(inst);
  check(placed?.symbol === index && placed.insertion?.x === 1000 && placed.insertion.y === 2000, `${label}: the objects became an instance at the insertion point`);
  check(!s.doc.object(rect), `${label}: the rectangle went into it`);
  const box = s.doc.symbolDefs().find((d) => d.index === index)!.bbox;
  check(!!box && box.x0 === 0 && box.x1 === 400 && box.y1 === 200, `${label}: the definition holds it round its insertion point`);
  const second = s.insertSymbol(layer, index, { x: 5000, y: 6000 });
  check(s.doc.object(second)?.insertion?.x === 5000, `${label}: another goes where it's put`);
  const again = openVwx(s.doc.toBytes(), "x.vwx");
  check(again.doc.symbolDefs().some((d) => d.name === "First"), `${label}: it reopens`);
  const shown = again.doc.objects(layer).filter((o) => o.symbol !== undefined);
  check(shown.length === 2 && shown.some((o) => o.insertion?.x === 5000), `${label}: both instances reopen`);
  const made = again.createSymbol([again.addObject(layer, { kind: "rect", x0: 0, y0: 0, x1: 10, y1: 10 })], "Second");
  check(again.doc.symbolDefs().length === defsBefore + 2 && again.doc.object(made)?.symbol !== undefined, `${label}: a second definition goes beside it`);
  // one undo takes the first symbol back whole, library and all
  const fresh = openVwx(bytes, "x.vwx");
  const r = fresh.addObject(layer, { kind: "rect", x0: 1000, y0: 2000, x1: 1400, y1: 2200 });
  fresh.createSymbol([r], "First");
  fresh.undo();
  check(fresh.doc.symbolDefs().length === defsBefore && !!fresh.doc.object(r), `${label}: one undo takes it back`);
}

run("blank", blankDrawing("mm"));
symbols("blank", blankDrawing("mm"));
symbols("blank in feet", blankDrawing("ftin"));
for (const file of process.argv.slice(2)) run(basename(file, ".vwx"), new Uint8Array(readFileSync(file)));

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
