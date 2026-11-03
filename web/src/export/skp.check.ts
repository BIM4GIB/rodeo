// Checks the SketchUp writer under Node. Run from web/:
//   npx tsx src/export/skp.check.ts
// A blank drawing takes a painted cube symbol placed plain, named, mirrored, scaled, turned inside
// another symbol, on its own on the layer, and in a class that is hidden; a textured tile symbol
// with its own UV map, placed plain and mirrored; a see-through face, an open 3D polygon and a 3D
// locus; an extruded box, a textured extruded cylinder, a profile swept round into two cones and a
// drum, and a wall with a window cut out of it. Written as SketchUp and read back by Rodeo's own
// SketchUp reader (import/skp.ts), the symbols are components, defined once and placed as they
// were; classes are tags, the hidden one hidden; colours, opacity, the texture's image and size
// and each textured corner's (u, v) are as the drawing has them; the faces cover what the 3D view
// shows. A mesh's faces stay its faces; triangles in one plane are joined into faces, the window's
// wall face keeping its hole; and read by openskp itself, the edges between the strips of a curved
// surface are soft and smooth, and those where its surfaces meet at an angle are not. With SKP_DIR
// set to a folder of .skp files, each is brought in as File > Import SketchUp does, written out
// again and read back, its faces covering what they did.

import { parseSkp as readModel, type Definition } from "openskp";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { blankDrawing } from "../core/blank.ts";
import { openVwx, type MeshNode } from "../core/index.ts";
import type { MeshTree, MeshTreeNode } from "../import/mesh.ts";
import { parseSkp } from "../import/skp.ts";
import { exportSkp } from "./skp.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;
const IN = 25.4;

/** a face's normal times its area (Newell's) */
function newell(f: readonly number[]): [number, number, number] {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < f.length; i += 3) {
    const j = (i + 3) % f.length;
    x += (f[i + 1] - f[j + 1]) * (f[i + 2] + f[j + 2]);
    y += (f[i + 2] - f[j + 2]) * (f[i] + f[j]);
    z += (f[i] - f[j]) * (f[i + 1] + f[j + 1]);
  }
  return [x / 2, y / 2, z / 2];
}
const area = (f: readonly number[]): number => Math.hypot(...newell(f));

/** A PNG of `w` × `h` pixels in two greys, with alpha or without. */
function png(w: number, h: number, alpha: boolean): Uint8Array {
  const crc = (b: Uint8Array): number => {
    let c = ~0;
    for (const x of b) {
      c ^= x;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Uint8Array): Buffer => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    out.set(data, 8);
    out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const size = alpha ? 4 : 3;
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0);
  head.writeUInt32BE(h, 4);
  head[8] = 8;
  head[9] = alpha ? 6 : 2;
  const raw = Buffer.alloc((1 + w * size) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill(x % 2 ? 200 : 60, y * (1 + w * size) + 1 + x * size, y * (1 + w * size) + 1 + (x + 1) * size);
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))]));
}

// ---- the drawing ---------------------------------------------------------------------------------

const s = openVwx(blankDrawing("mm"), "blank.vwx");
const layer = s.doc.layers()[0].id;
const none = s.doc.classes().find((c) => c.name === "None")!.index;
const furniture = s.createClass("Furniture");
const walls = s.createClass("Walls");
const off = s.createClass("Off");
s.setClassVisibility(off, "hidden");
const [red, glass, sand] = s.addColors(["#ff0000", "#6496ff", "#c8a064"]);
const paint = (c: number, opacity = 100) => ({ fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: opacity });
const image = png(4, 2, false);
// 400 mm across, so 200 up
const brick = s.addImageTexture("Brick", { image, mime: "image/png", width: 4, height: 2, size: 400, color: [130, 130, 130], previews: { large: png(256, 256, true), small: png(64, 64, true) } });

// a 100 mm cube, its faces quadrilaterals wound to face out
const c = (x: number, y: number, z: number): number[] => [100 * x, 100 * y, 100 * z];
const cube = [
  [...c(0, 0, 0), ...c(0, 1, 0), ...c(1, 1, 0), ...c(1, 0, 0)],
  [...c(0, 0, 1), ...c(1, 0, 1), ...c(1, 1, 1), ...c(0, 1, 1)],
  [...c(0, 0, 0), ...c(1, 0, 0), ...c(1, 0, 1), ...c(0, 0, 1)],
  [...c(1, 0, 0), ...c(1, 1, 0), ...c(1, 1, 1), ...c(1, 0, 1)],
  [...c(1, 1, 0), ...c(0, 1, 0), ...c(0, 1, 1), ...c(1, 1, 1)],
  [...c(0, 1, 0), ...c(0, 0, 0), ...c(0, 0, 1), ...c(0, 1, 1)],
];
const at = (x: number, y: number, z: number, m = [1, 0, 0, 0, 1, 0, 0, 0, 1]): number[] => [...m, x, y, z];
const mirror = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
const twice = [2, 0, 0, 0, 2, 0, 0, 0, 2];
const turn = [0, 1, 0, -1, 0, 0, 0, 0, 1];
// a tile laid on its image by its own map: the image once across 300 mm, twice up 150 mm, a quarter in
const tileUvs = [0.25, 0, 1.25, 0, 1.25, 2, 0.25, 2];
const made = s.addMeshModel(
  layer,
  {
    symbols: [
      { name: "Cube", content: { parts: [cube], attrs: [paint(red)] } },
      { name: "Tile", content: { parts: [[[0, 0, 0, 300, 0, 0, 300, 150, 0, 0, 150, 0]]], textures: [brick], uvs: [[tileUvs]] } },
      { name: "Pair", content: { instances: [{ symbol: 0, matrix: at(0, 0, 0) }, { symbol: 0, matrix: at(200, 0, 0), name: "Right", classIndex: walls }] } },
      { name: "Stand", content: { groups: [{ name: "Leg", classIndex: walls, parts: [[[0, 0, 0, 50, 0, 0, 50, 0, 500, 0, 0, 500]]] }] } },
    ],
    top: {
      instances: [
        { symbol: 0, matrix: at(1000, 0, 0), name: "Box", classIndex: furniture },
        { symbol: 0, matrix: at(2000, 0, 0, mirror) },
        { symbol: 0, matrix: at(3000, 0, 0, twice) },
        { symbol: 0, matrix: at(4000, 0, 0), classIndex: off },
        { symbol: 2, matrix: at(0, 1000, 0, turn) },
        { symbol: 1, matrix: at(0, 3000, 0) },
        { symbol: 1, matrix: at(1000, 3000, 0, mirror) },
        { symbol: 3, matrix: at(0, 5000, 0) },
      ],
      // a group in it, and an unnamed one in that
      groups: [
        {
          name: "Shelf",
          classIndex: furniture,
          parts: [[[0, -4000, 0, 400, -4000, 0, 400, -3600, 0, 0, -3600, 0]]],
          groups: [{ name: "", parts: [[[0, -4000, 200, 400, -4000, 200, 400, -3600, 200, 0, -3600, 200]]], instances: [{ symbol: 0, matrix: at(600, -4000, 0) }] }],
        },
      ],
      parts: [[[0, -1000, 0, 500, -1000, 0, 500, -1000, 500, 0, -1000, 500]]],
      attrs: [paint(glass, 40)],
      lines: [{ points: [0, -2000, 0, 300, -2000, 0, 300, -2300, 100], closed: false }],
      loci: [{ at: [10, 20, 30] }],
    },
  },
  none,
);
const cubeSymbol = made.symbols[0];
// a cube on its own on the layer, as a symbol is placed in plan
s.insertSymbol(layer, cubeSymbol, { x: 5000, y: 0 }, furniture);

// an extruded box; a cylinder in Walls, textured, its image projected; a triangle swept round into
// two cones and a drum; a wall with a window cut out of it
const [box] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 0, y0: 6000, x1: 1000, y1: 7000 }, none, paint(sand))], 2000);
const [drum] = s.extrudeObjects([s.addObject(layer, { kind: "arc", center: { x: 3000, y: 6500 }, radius: 500, startAngle: 0, sweepAngle: 360 }, walls)], 1000);
// part 3 is the whole object
s.setObjectTexture(drum, 3, { texture: brick });
const [spun] = s.sweepObjects([s.addObject(layer, { kind: "polygon", points: [{ x: 6000, y: 500 }, { x: 6500, y: 0 }, { x: 6500, y: 1000 }], closed: true })], 360, 15);
const [wall] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 0, y0: 9000, x1: 4000, y1: 9300 })], 2500);
const [hole] = s.extrudeObjects([s.addObject(layer, { kind: "rect", x0: 1500, y0: 8900, x1: 2500, y1: 9400 })], 1200);
s.moveObjects3D([hole], 0, 0, 900);
const cut = s.combineSolids([wall, hole], true);
check(!!box && !!drum && !!spun && !!cut, "the drawing made");

// ---- written and read back -----------------------------------------------------------------------

const design = new Set(s.doc.layers().filter((l) => l.kind === "design").map((l) => l.id));
const out = exportSkp(s.doc, design);
const file = parseSkp(out.bytes);
check(!!file.tree && file.frame?.mm === IN && file.frame.yUp === false, "a SketchUp file Rodeo's reader takes, in inches and z up");
const tree: MeshTree = file.tree!;
const names = tree.symbols.map((x) => x.name).sort();
check(names.join() === "Cube,Pair,Stand,Tile" && out.components === 4, `a component per symbol placed, each defined once (${names.join()})`);
const named = (name: string) => tree.symbols.findIndex((x) => x.name === name);
check(named("Cube") < named("Pair"), "a component defined before one that places it");
const cubeParts = tree.symbols[named("Cube")].content.parts;
check(cubeParts.length === 1 && cubeParts[0].faces.length === 6 && cubeParts[0].faces.every((f) => f.length === 12), "the cube's six faces kept as its quadrilaterals");
check(!!cubeParts[0].color && near(cubeParts[0].color.r, 1) && near(cubeParts[0].color.g, 0) && near(cubeParts[0].color.b, 0), `painted its red (${JSON.stringify(cubeParts[0].color)})`);
check(near(cubeParts[0].faces.reduce((n, f) => n + area(f), 0) * IN * IN, 6e4, 1e-6), "and 100 mm a side");

/** A face as placed: corners, (u, v) at each, and the groups and instances it is in, from the top. */
interface Placed {
  corners: number[];
  uvs?: number[];
  path: string[];
  tag?: string;
  color?: { r: number; g: number; b: number };
  opacity?: number;
  textured: boolean;
}

/** Every face placed through the instances above it, in mm, with the tag it shows on. */
function unfold(t: MeshTree): Placed[] {
  const placed: Placed[] = [];
  const walk = (n: MeshTreeNode, m: readonly number[], path: string[], tag: string | undefined): void => {
    const flip = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]) < 0;
    for (const p of n.parts) {
      p.faces.forEach((f, k) => {
        const q: number[] = [];
        for (let i = 0; i < f.length; i += 3) q.push(...[0, 1, 2].map((j) => (f[i] * m[j] + f[i + 1] * m[3 + j] + f[i + 2] * m[6 + j] + m[9 + j]) * IN));
        const uv = p.uvs?.[k];
        const corners: number[] = [];
        const uvs: number[] = [];
        for (let i = 0; i < q.length / 3; i++) {
          const r = flip ? q.length / 3 - 1 - i : i;
          corners.push(q[3 * r], q[3 * r + 1], q[3 * r + 2]);
          if (uv) uvs.push(uv[2 * r], uv[2 * r + 1]);
        }
        const shows = p.tag ?? tag;
        placed.push({ corners, ...(uv ? { uvs } : {}), path, ...(shows ? { tag: shows } : {}), ...(p.color ? { color: p.color } : {}), ...(p.opacity !== undefined ? { opacity: p.opacity } : {}), textured: p.texture !== undefined });
      });
    }
    for (const g of n.groups) walk(g, m, [...path, g.name], g.tag ?? tag);
    for (const i of n.instances) {
      const k = i.matrix;
      const c2 = [0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((j) => k[3 * r] * m[j] + k[3 * r + 1] * m[3 + j] + k[3 * r + 2] * m[6 + j] + (r === 3 ? m[9 + j] : 0)));
      walk(t.symbols[i.symbol].content, c2, [...path, i.name || t.symbols[i.symbol].name], i.tag ?? tag);
    }
  };
  walk(t.top, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], [], undefined);
  return placed;
}
const placed = unfold(tree);

// the faces cover what the 3D view shows
const shown = s.doc.model3d().reduce((n, m) => {
  for (let i = 0; i + 8 < m.triangles.length; i += 9) n += area([...m.triangles.subarray(i, i + 9)]);
  return n;
}, 0);
const written = placed.reduce((n, p) => n + area(p.corners), 0);
check(near(written, shown, 1e-4 * shown), `the faces cover the 3D view's (${written.toFixed(0)} and ${shown.toFixed(0)} mm²)`);

// where the cube is placed
const top = tree.top;
const group = top.groups[0];
check(top.groups.length === 5 && out.groups === 5, `a group for each top-level object but the symbol placed on its own (${top.groups.map((g) => g.name).join(", ")})`);
const cubesIn = (n: MeshTreeNode): number => n.instances.filter((i) => i.symbol === named("Cube")).length;
check(cubesIn(group) === 4 && cubesIn(tree.symbols[named("Pair")].content) === 2 && cubesIn(top) === 1, `the cube placed four times in the group, twice in Pair and once on its own (${cubesIn(group)}, ${cubesIn(tree.symbols[named("Pair")].content)}, ${cubesIn(top)})`);
const boxAt = (under: string, tag?: string): { min: number[]; max: number[] } => {
  // in it at any depth
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of placed.filter((q) => q.path.includes(under) && (tag === undefined || q.tag === tag)))
    for (let i = 0; i < p.corners.length; i++) {
      min[i % 3] = Math.min(min[i % 3], p.corners[i]);
      max[i % 3] = Math.max(max[i % 3], p.corners[i]);
    }
  return { min, max };
};
const spans = (b: { min: number[]; max: number[] }, min: number[], max: number[]): boolean => [0, 1, 2].every((i) => near(b.min[i], min[i], 1e-6) && near(b.max[i], max[i], 1e-6));
const inGroup = group.instances.map((i) => ({ i, m: i.matrix.map((v, k) => (k >= 9 ? v * IN : v)) }));
const where = (x: number) => inGroup.find(({ m }) => near(m[9], x, 1e-6));
check(where(1000)?.i.name === "Box" && where(1000)?.i.tag === "Furniture", "a named cube keeps its name and its class's tag");
check(!!where(2000) && near(where(2000)!.m[0], -1) && near(where(2000)!.m[4], 1), "a mirrored cube placed mirrored");
check(!!where(3000) && near(where(3000)!.m[0], 2) && near(where(3000)!.m[8], 2), "a scaled one scaled");
check(where(4000)?.i.tag === "Off" && (file.hiddenTags ?? []).join() === "Off", `one in a hidden class on its tag, and the tag hidden (${file.hiddenTags})`);
const pair = group.instances.find((i) => i.symbol === named("Pair"));
check(!!pair && near(pair.matrix[1], 1) && near(pair.matrix[3], -1), "the symbol of two cubes placed turned");
check(
  tree.symbols[named("Pair")].content.instances.map((i) => `${i.name ?? ""}/${i.tag ?? ""}`).join() === "/,Right/Walls",
  "a cube inside it on its class's tag and keeping its name, the other untagged and unnamed",
);
check(spans(boxAt("Pair"), [-100, 1000, 0], [0, 1300, 100]), `and its cubes placed through it (${JSON.stringify(boxAt("Pair"))})`);
const alone = top.instances[0];
check(!!alone && alone.symbol === named("Cube") && alone.tag === "Furniture" && near(alone.matrix[9] * IN, 5000, 1e-6), "the cube placed on its own an instance on the model, on its class's tag");

// groups inside groups and symbols
const shelf = group.groups.find((g) => g.name === "Shelf");
const under = shelf?.groups[0];
check(
  group.groups.length === 1 && !!shelf && shelf.tag === "Furniture" && shelf.parts.length === 1 && shelf.groups.length === 1 && !!under && under.name === "" && under.parts.length === 1 && cubesIn(under) === 1,
  `a group in the group a group in it, keeping its name and its class's tag, and the unnamed group in that unnamed with its face and cube (${JSON.stringify(group.groups.map((g) => [g.name, g.tag, g.parts.length, g.groups.map((k) => [k.name, k.parts.length, k.instances.length])]))})`,
);
const leg = tree.symbols[named("Stand")]?.content.groups[0];
check(!!leg && leg.name === "Leg" && leg.tag === "Walls" && leg.parts.length === 1 && group.instances.some((i) => i.symbol === named("Stand")), "a group in a symbol a group in its component, on its class's tag");

// the see-through face, the line and the point
const glassFace = placed.find((p) => p.opacity !== undefined);
check(!!glassFace && near(glassFace.opacity!, 0.4) && near(glassFace.color!.r, 100 / 255) && near(glassFace.color!.b, 1), `the see-through face 40% opaque, in its colour (${JSON.stringify(glassFace && [glassFace.opacity, glassFace.color])})`);
const line = group.lines?.[0];
check(group.lines?.length === 1 && !!line && line.points.length === 9 && near(line.points[8] * IN, 100, 1e-6), "the open 3D polygon a line of its three points");
check(top.points?.length === 1 && [10, 20, 30].every((v, i) => near(top.points![0].at[i] * IN, v, 1e-6)), `the 3D locus a guide point where it was (${JSON.stringify(top.points)})`);

// textures
const tex = file.textures ?? [];
// (the drawing keeps the image padded to an even length)
const kept = s.doc.resources().find((r) => r.index === brick)!.image!;
check(
  tex.length === 1 && tex[0].name === "Brick" && tex[0].mime === "image/png" && Buffer.from(tex[0].image).equals(Buffer.from(kept)) && near(tex[0].size * IN, 400, 1e-6),
  `the texture's image as the drawing keeps it, 400 mm across (${JSON.stringify(tex.map((t) => [t.name, t.mime, t.size * IN, t.image.length]))})`,
);
// each textured corner where the 3D view puts it on the image
const views = s.doc.model3d().filter((m) => m.texture === brick);
const viewUv = (p: readonly number[]): number[] | null => {
  for (const m of views) {
    for (let i = 0; i + 2 < m.triangles.length; i += 3) {
      if (!near(m.triangles[i], p[0], 1e-2) || !near(m.triangles[i + 1], p[1], 1e-2) || !near(m.triangles[i + 2], p[2], 1e-2)) continue;
      const j = (i / 3) * 2;
      if (m.uvs) return [m.uvs[j], m.uvs[j + 1]];
    }
  }
  return null;
};
const tiles = placed.filter((p) => p.path.includes("Tile"));
let right = 0;
let corners = 0;
for (const f of tiles) {
  for (let k = 0; k < f.corners.length / 3; k++) {
    corners++;
    const want = viewUv(f.corners.slice(3 * k, 3 * k + 3));
    if (want && f.uvs && near(f.uvs[2 * k], want[0], 1e-6) && near(f.uvs[2 * k + 1], want[1], 1e-6)) right++;
  }
}
check(tiles.length === 2 && corners === 8 && right === corners, `each tile corner's (u, v) the tile's own map gives it, the mirrored one's too (${right} of ${corners})`);
// the drum's image projected along each face's main axis, 400 mm a repeat, as the 3D view projects it
const drumFaces = placed.filter((p) => p.textured && !p.path.includes("Tile"));
let projected = 0;
let drumCorners = 0;
for (const f of drumFaces) {
  const n = newell(f.corners).map(Math.abs);
  const [iu, iv] = n[0] >= n[1] && n[0] >= n[2] ? [1, 2] : n[1] >= n[2] ? [0, 2] : [0, 1];
  for (let k = 0; k < f.corners.length / 3; k++) {
    drumCorners++;
    if (f.uvs && near(f.uvs[2 * k], f.corners[3 * k + iu] / 400, 1e-6) && near(f.uvs[2 * k + 1], f.corners[3 * k + iv] / 400, 1e-6)) projected++;
  }
}
check(drumFaces.length > 2 && projected === drumCorners, `the textured cylinder's image projected along each face's main axis (${projected} of ${drumCorners} corners)`);
check(drumFaces.every((p) => p.tag === "Walls"), "and the cylinder's group on its class's tag");

// ---- faces and edges, as openskp reads them ------------------------------------------------------

const model = readModel(out.bytes.slice().buffer);
const groupNamed = (name: string): Definition | undefined => [...model.definitions.values()].find((d) => d.isGroup && d.name === name);
const extrudes = [...model.definitions.values()].filter((d) => d.isGroup && /^Extrude/.test(d.name));
const boxDef = extrudes.find((d) => d.faces.length === 6);
check(!!boxDef && boxDef.faces.every((f) => f.loops.length === 1 && f.loops[0].length === 4) && boxDef.edges.every((e) => !e.soft && !e.smooth), "the extruded box's triangles joined into its six faces, its edges hard");
const holed = [...model.definitions.values()].filter((d) => d.isGroup).flatMap((d) => d.faces).filter((f) => f.loops.length === 2);
check(holed.length >= 2, `the wall's faces with the window in them keep it as a hole (${holed.length})`);
const spunDef = groupNamed("Sweep");
const softEdges = spunDef?.edges.filter((e) => e.soft && e.smooth).length ?? 0;
check(
  !!spunDef && spunDef.faces.length === 72 && spunDef.edges.length === 120 && softEdges === 72,
  `the swept triangle: 24 strips in each of its two cones and drum, the 72 edges between strips soft and smooth, the 48 where cones and drum meet hard (${spunDef?.faces.length} faces, ${softEdges} of ${spunDef?.edges.length} edges soft)`,
);
const drumDef = extrudes.find((d) => d.faces.some((f) => f.loops[0].length > 8));
const drumSoft = drumDef?.edges.filter((e) => e.soft).length ?? 0;
const sides = (drumDef?.faces.length ?? 0) - 2;
check(!!drumDef && sides > 8 && drumSoft === sides, `the cylinder's ${sides} sides soft between themselves, hard round its two ends (${drumSoft} soft)`);

// ---- SketchUp's own files, brought in and written out again ------------------------------------

const dir = process.env.SKP_DIR;
if (dir) {
  const files = readdirSync(dir)
    .filter((f) => /\.skp$/i.test(f))
    .sort();
  let rewritten = 0;
  for (const name of files) {
    let first: MeshTree | undefined;
    try {
      first = parseSkp(new Uint8Array(readFileSync(join(dir, name)))).tree;
    } catch {
      continue;
    }
    if (!first) continue;
    // into a blank drawing as File > Import SketchUp puts it, tags as classes
    const t = openVwx(blankDrawing("mm"), "blank.vwx");
    const on = t.doc.layers()[0].id;
    const plain = t.doc.classes().find((c) => c.name === "None")!.index;
    const classes = new Map<string, number>();
    const classOf = (tag: string | undefined): number | undefined => (tag ? (classes.get(tag) ?? classes.set(tag, t.createClass(tag)).get(tag)) : undefined);
    const node = (n: MeshTreeNode): MeshNode => ({
      parts: n.parts.map((q) => q.faces.map((f) => f.map((v) => v * IN))),
      classes: n.parts.map((q) => classOf(q.tag) ?? plain),
      lines: (n.lines ?? []).map((q) => ({ points: q.points.map((v) => v * IN), closed: q.closed, classIndex: classOf(q.tag) ?? plain })),
      loci: [],
      groups: n.groups.map((g) => ({ ...node(g), name: g.name, ...(g.tag ? { classIndex: classOf(g.tag) } : {}) })),
      instances: n.instances.map((i) => ({ symbol: i.symbol, matrix: i.matrix.map((v, k) => (k >= 9 ? v * IN : v)), ...(i.name ? { name: i.name } : {}), ...(i.tag ? { classIndex: classOf(i.tag) } : {}) })),
    });
    try {
      t.addMeshModel(on, { symbols: first.symbols.map((x) => ({ name: x.name, content: node(x.content) })), top: node(first.top) }, plain);
    } catch {
      continue; // nothing in it to bring in
    }
    let again: MeshTree | undefined;
    try {
      again = parseSkp(exportSkp(t.doc, new Set([on])).bytes).tree;
    } catch (err) {
      check(false, `${name}: written out again (${(err as Error).message})`);
      continue;
    }
    rewritten++;
    const before = unfold(first).reduce((n, p) => n + area(p.corners), 0);
    const after = again ? unfold(again).reduce((n, p) => n + area(p.corners), 0) : 0;
    check(near(after, before, 1e-4 * Math.max(1, before)), `${name}: written out again, the faces cover what they did (${(before / 1e6).toPrecision(6)} and ${(after / 1e6).toPrecision(6)} m²)`);
    // its groups' and instances' names still there, and its components named as the drawing's
    // symbols (which share one set of names with its classes)
    const namesIn = (x: MeshTree | undefined): Set<string> => {
      const out = new Set<string>();
      const walk = (n: MeshTreeNode): void => {
        n.groups.forEach((g) => (g.name && out.add(g.name), walk(g)));
        n.instances.forEach((i) => i.name && out.add(i.name));
      };
      if (x) [x.top, ...x.symbols.map((k) => k.content)].forEach(walk);
      return out;
    };
    const lost = [...namesIn(first)].filter((k) => !namesIn(again).has(k));
    const symbols = new Set(t.doc.symbolDefs().map((d) => d.name));
    check(
      !lost.length && again?.symbols.length === first.symbols.length && again.symbols.every((k) => symbols.has(k.name)),
      `${name}: its ${first.symbols.length} components, named as the drawing's symbols, and its groups' and instances' names kept (${lost.length ? `lost ${lost.join(", ")}` : `${namesIn(first).size} names`})`,
    );
  }
  console.log(`     ${rewritten} of ${files.length} written out again`);
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
