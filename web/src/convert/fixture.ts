// A small drawing for the converter's checks, built in code so that no sample file is needed: a
// Ground layer with a rectangle, a line in a class, a circle, a text and a 3D box, and a hidden layer
// above it holding a second box. The checks read it back through every writer.

import { blankDrawing } from "../core/blank.ts";
import { openVwx } from "../core/index.ts";
import type { HeadlessDrawing } from "./types.ts";

/** The fixture drawing as a .vwx file's bytes. */
export function fixtureVwx(): Uint8Array {
  const s = openVwx(blankDrawing("mm"), "fixture.vwx");
  const ground = s.doc.layers()[0].id;
  s.renameLayer(ground, "Ground");
  const walls = s.createClass("Walls");
  const red = s.addColors(["#cc3333"])[0];
  const look = { fillPattern: 1, fillFore: red, fillBack: red };

  s.addObject(ground, { kind: "rect", x0: 0, y0: 0, x1: 2000, y1: 1000 });
  s.addObject(ground, { kind: "line", a: { x: 0, y: 1500 }, b: { x: 2000, y: 1500 } }, walls);
  s.addObject(ground, { kind: "arc", center: { x: 3000, y: 500 }, radius: 400, startAngle: 0, sweepAngle: 360 });
  s.addObject(ground, { kind: "text", at: { x: 0, y: -600 }, text: "Rodeo", height: 250 });
  s.addMeshes(ground, [box(0, 0, 0, 1000, 2000, 3000)], walls, look);

  const upper = s.createLayer("Upper", "design", 100);
  s.addMeshes(upper, [box(5000, 0, 0, 5500, 500, 500)], undefined, look);
  s.setLayerVisibility(upper, "hidden");
  return s.doc.toBytes();
}

/** The fixture drawing read back, as readAny would give it. */
export function fixtureDrawing(): HeadlessDrawing {
  return { session: openVwx(fixtureVwx(), "fixture.vwx"), name: "fixture.vwx", from: "vwx", skipped: {}, notes: [] };
}

/** A box's 12 triangles, each as three corners of x, y, z, counter-clockwise seen from outside. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): number[][] {
  const quads = [
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], // top
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], // bottom
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], // y0 side
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], // y1 side
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], // x0 side
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], // x1 side
  ];
  return quads.flatMap(([a, b, c, d]) => [[...a, ...b, ...c], [...a, ...c, ...d]]);
}
