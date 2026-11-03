// Checks the SketchUp reader under Node. Run from web/:
//   npx tsx src/import/skp.check.ts
// A model written here with openskp's writer (SketchUp 2013-2020's format) reads back as symbols
// and groups: a component made a symbol once however often it is placed, again for each paint an
// instance gives its unpainted faces, its instances placed painted, tagged, mirrored, scaled and
// nested under a turned one; a group's own name, a face with a hole cut into triangles that face
// its way, a see-through material, loose faces on the model, a face painted only on its back
// taking its back's paint; edges no face uses joined into lines (a loop open, back to its start, as
// it is no face), guide lines and points tagged
// Guides, an image a group of its textured face, an instance on a hidden tag read and the tag
// named hidden; hidden instances, texts, endless guide lines, dimensions and section planes left
// out and counted. Unfolded, every face lands where SketchUp shows it. Put into a blank drawing,
// the symbols are made, the instances placed in their tags' classes, the lines made 3D polygons
// and the points 3D loci, and the 3D view shows the same faces. Bytes that aren't SketchUp are refused. With SKP_DIR set to a folder of .skp files
// (SketchUp's own public test models, say, from github.com/SketchUp/testup-2), each is read or
// refused with a reason, and the faces read, unfolded, cover the same area as openskp's own
// triangles of the file where nothing was left out as hidden.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { buildScene, create, type Matrix3x3 } from "openskp";
import { blankDrawing } from "../core/blank.ts";
import { openVwx, type MeshNode } from "../core/index.ts";
import type { MeshFile, MeshPart, MeshTree, MeshTreeNode } from "./mesh.ts";
import { parseSkp } from "./skp.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) < tol;

/** a face's area and its normal times that area (Newell's) */
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
const areaOf = (parts: readonly MeshPart[]): number => parts.reduce((n, p) => n + p.faces.reduce((m, f) => m + area(f), 0), 0);

/** the box round a set of parts' corners */
function box3(parts: readonly MeshPart[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts)
    for (const f of p.faces)
      for (let i = 0; i < f.length; i++) {
        min[i % 3] = Math.min(min[i % 3], f[i]);
        max[i % 3] = Math.max(max[i % 3], f[i]);
      }
  return { min, max };
}
const boxIs = (parts: readonly MeshPart[], min: number[], max: number[]): boolean => {
  const b = box3(parts);
  return [0, 1, 2].every((i) => near(b.min[i], min[i]) && near(b.max[i], max[i]));
};

/** every face of a closed solid faces out of its middle */
function facesOut(parts: readonly MeshPart[]): boolean {
  const b = box3(parts);
  const mid = [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2);
  return parts.every((p) =>
    p.faces.every((f) => {
      const n = newell(f);
      const c = [0, 1, 2].map((k) => f.filter((_, i) => i % 3 === k).reduce((s, v) => s + v, 0) / (f.length / 3));
      return n[0] * (c[0] - mid[0]) + n[1] * (c[1] - mid[1]) + n[2] * (c[2] - mid[2]) > 0;
    }),
  );
}

// ---- a model written by openskp's writer -------------------------------------------------------

const skp = create();
const blue = skp.addMaterial("Blue", [0, 0, 255]);
const red = skp.addMaterial("Red", [255, 0, 0]);
const glass = skp.addMaterial("Glass", [100, 150, 255], 0.4);
const walls = skp.addLayer("Walls");
const off = skp.addLayer("Off", { hidden: true });
// a 10-inch cube, its faces wound to face out, unpainted so a placement's paint shows on it
const cube = skp.addComponentDefinition("Cube", (d) => {
  const c = (x: number, y: number, z: number): [number, number, number] => [10 * x, 10 * y, 10 * z];
  d.addFace([c(0, 0, 0), c(0, 1, 0), c(1, 1, 0), c(1, 0, 0)]);
  d.addFace([c(0, 0, 1), c(1, 0, 1), c(1, 1, 1), c(0, 1, 1)]);
  d.addFace([c(0, 0, 0), c(1, 0, 0), c(1, 0, 1), c(0, 0, 1)]);
  d.addFace([c(1, 0, 0), c(1, 1, 0), c(1, 1, 1), c(1, 0, 1)]);
  d.addFace([c(1, 1, 0), c(0, 1, 0), c(0, 1, 1), c(1, 1, 1)]);
  d.addFace([c(0, 1, 0), c(0, 0, 0), c(0, 0, 1), c(0, 1, 1)]);
});
// two cubes, one tagged Walls, inside a component placed turned a quarter about z
const pair = skp.addComponentDefinition("Pair", (d) => {
  d.addInstance(cube, { translation: [0, 0, 0] });
  d.addInstance(cube, { translation: [20, 0, 0], layer: walls });
});
skp.addGroup(
  (d) =>
    d.addFace(
      [
        [0, 0, 0],
        [20, 0, 0],
        [20, 20, 0],
        [0, 20, 0],
      ],
      {
        material: red,
        holes: [
          [
            [5, 5, 0],
            [15, 5, 0],
            [15, 15, 0],
            [5, 15, 0],
          ],
        ],
      },
    ),
  { name: "Plate", translation: [0, 0, -50] },
);
const turn: Matrix3x3 = [0, 1, 0, -1, 0, 0, 0, 0, 1];
const mirror: Matrix3x3 = [-1, 0, 0, 0, 1, 0, 0, 0, 1];
const twice: Matrix3x3 = [2, 0, 0, 0, 2, 0, 0, 0, 2];
skp.addInstance(cube, { name: "Box", translation: [100, 0, 0], material: blue, layer: walls });
skp.addInstance(cube, { name: "Box", translation: [200, 0, 0], matrix3x3: mirror });
skp.addInstance(cube, { translation: [300, 0, 0], matrix3x3: twice });
skp.addInstance(cube, { name: "Gone", translation: [400, 0, 0], hidden: true });
skp.addInstance(cube, { name: "Off", translation: [500, 0, 0], layer: off });
skp.addInstance(pair, { translation: [0, 100, 0], matrix3x3: turn });
skp.addFace(
  [
    [0, -100, 0],
    [30, -100, 0],
    [30, -100, 30],
  ],
  { material: glass },
);
// painted only on its back, as a face drawn the wrong way round often is
skp.addFace(
  [
    [0, -150, 0],
    [30, -150, 0],
    [30, -150, 30],
  ],
  { backMaterial: red },
);
// edges no face uses: an open run of two, and a closed square of four
skp.addPolyline([
  [0, -200, 0],
  [10, -200, 0],
  [10, -210, 0],
]);
skp.addPolyline(
  [
    [0, -300, 0],
    [10, -300, 0],
    [10, -310, 0],
    [0, -310, 0],
  ],
  { closed: true },
);
skp.addText("note", [0, 0, 0]);
skp.addConstructionLine([0, 0, 0], { direction: [1, 0, 0] });
skp.addConstructionLine([0, 0, 0], { point2: [0, 0, 40] });
skp.addConstructionPoint([1, 2, 3]);
skp.addDimension([0, 0, 0], [10, 0, 0]);
skp.addSectionPlane([0, 0, 5], [0, 0, 1]);

/** A face as placed: its corners and what it came in under at the top of the model. */
interface Placed extends MeshPart {
  /** the top-level instance's or group's name, "" for the loose faces, repeats numbered "Box 2" */
  label: string;
}

/** The tree unfolded: every part placed through the instances above it, with the tag it shows on. */
function unfold(tree: MeshTree): Placed[] {
  const out: Placed[] = [];
  const seen = new Map<string, number>();
  const label = (name: string): string => {
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return n === 1 ? name : `${name} ${n}`;
  };
  const walk = (n: MeshTreeNode, m: readonly number[], at: string, tag: string | undefined): void => {
    const flip = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]) < 0;
    for (const p of n.parts) {
      const faces = p.faces.map((f) => {
        const q: number[] = [];
        for (let i = 0; i < f.length; i += 3) q.push(...[0, 1, 2].map((k) => f[i] * m[k] + f[i + 1] * m[3 + k] + f[i + 2] * m[6 + k] + m[9 + k]));
        if (!flip) return q;
        const r: number[] = [];
        for (let i = q.length - 3; i >= 0; i -= 3) r.push(q[i], q[i + 1], q[i + 2]);
        return r;
      });
      const shows = p.tag ?? tag;
      out.push({ ...p, faces, label: at, ...(shows ? { tag: shows } : {}) });
    }
    for (const g of n.groups) walk(g, m, at || label(g.name || "Group"), g.tag ?? tag);
    for (const i of n.instances) {
      const k = i.matrix;
      // m after the instance's matrix
      const c = [0, 1, 2, 3].flatMap((r) => [0, 1, 2].map((j) => k[3 * r] * m[j] + k[3 * r + 1] * m[3 + j] + k[3 * r + 2] * m[6 + j] + (r === 3 ? m[9 + j] : 0)));
      walk(tree.symbols[i.symbol].content, c, at || label(i.name || tree.symbols[i.symbol].name), i.tag ?? tag);
    }
  };
  walk(tree.top, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], "", undefined);
  return out;
}

const read: MeshFile = parseSkp(skp.toBytes());
check(read.frame?.mm === 25.4 && read.frame.yUp === false, "in inches and z up, as SketchUp keeps every model");
check(read.parts.length === 0 && !!read.tree, "as a tree of symbols and groups");
const tree = read.tree!;
const names = tree.symbols.map((x) => x.name).sort();
check(names.join() === "Cube,Cube (Blue),Pair", `a symbol per component, and another for the paint one instance gives it (${names.join()})`);
const named = (name: string) => tree.symbols.findIndex((x) => x.name === name);
const top = tree.top;
check(
  top.instances.map((i) => tree.symbols[i.symbol].name).join() === "Cube (Blue),Cube,Cube,Cube,Pair",
  `the top-level components placed, the one on a hidden tag too, the hidden one not (${top.instances.map((i) => tree.symbols[i.symbol].name).join()})`,
);
check(top.instances[3].tag === "Off" && read.hiddenTags?.join() === "Off", `the one on a hidden tag keeps it, and the file names the tag hidden (${read.hiddenTags})`);
check(top.instances[0].name === "Box" && top.instances[0].tag === "Walls", "an instance keeps its name and its tag");
check(top.instances[2].name === undefined, `one named only as its component has no name of its own (${JSON.stringify(top.instances.map((i) => i.name))})`);
const pairContent = tree.symbols[named("Pair")].content;
check(
  pairContent.instances.length === 2 && pairContent.instances.every((i) => i.symbol === named("Cube")) && pairContent.instances.filter((i) => i.tag === "Walls").length === 1,
  "a component inside a component placed as the plain symbol, its own tag kept",
);
check(named("Cube") < named("Pair"), "a symbol made before any that place it");
const cubeParts = tree.symbols[named("Cube")].content.parts;
check(cubeParts.length === 1 && cubeParts[0].faces.length === 6 && !cubeParts[0].color && !cubeParts[0].tag, "the symbol's own faces once, unpainted and untagged");
check(top.groups.map((g) => g.name).join() === "Plate", "a group placed as a group of its own contents");
check(
  top.lines?.length === 3 && top.lines.every((l) => !l.tag || l.tag === "Guides"),
  `the edges no face uses joined into two lines, and the bounded guide line a third (${JSON.stringify(top.lines?.map((l) => [l.points.length / 3, l.closed, l.tag]))})`,
);
{
  const [run, square, guide] = top.lines ?? [];
  check(
    !!run && !run.closed && run.points.length === 9 && !!square && !square.closed && square.points.length === 15 && square.points.slice(0, 3).join() === square.points.slice(12).join(),
    "an open run of two edges, and a square of four running back to its start, open so it shows no face",
  );
  check(!!guide && guide.tag === "Guides" && near(guide.points[5], 40), "the guide line from its start to its end, tagged Guides");
  check(top.points?.length === 1 && top.points[0].tag === "Guides" && top.points[0].at.join() === "1,2,3", `the guide point where it was put, tagged Guides (${JSON.stringify(top.points)})`);
}

const placed = unfold(tree);
const byGroup = (g: string): Placed[] => placed.filter((p) => p.label === g);
const groups = [...new Set(placed.map((p) => p.label))];
check(groups.join() === ",Plate,Box,Box 2,Cube,Off,Pair", `unfolded: each shown top-level instance and group, the loose faces in none (${groups.join()})`);

const a = byGroup("Box");
check(a.length === 1 && a[0].faces.length === 6 && a[0].faces.every((f) => f.length === 12), "the cube's six faces whole, as quadrilaterals");
check(boxIs(a, [100, 0, 0], [110, 10, 10]), "placed by its translation");
check(!!a[0].color && near(a[0].color.b, 1) && near(a[0].color.r, 0) && a[0].name === "Blue", "unpainted faces take the instance's paint");
check(a[0].tag === "Walls", "and its tag");
check(facesOut(a), "its faces face out");

const m = byGroup("Box 2");
check(boxIs(m, [190, 0, 0], [200, 10, 10]), "a mirrored instance placed mirrored");
check(facesOut(m), "its faces turned back to face out");
check(m.every((p) => !p.color && !p.tag), "unpainted and untagged: no colour and no tag");

check(boxIs(byGroup("Cube"), [300, 0, 0], [320, 20, 20]), "a scaled instance scaled");

const p = byGroup("Pair");
check(p.length === 2 && p.some((q) => q.tag === "Walls") && p.some((q) => !q.tag), "a nested instance's tag splits its faces from its untagged sibling's");
// turned a quarter clockwise: (x, y) to (y, 100 − x)
check(boxIs(p, [0, 70, 0], [10, 100, 10]), "nested instances placed through the turned one above them");
check(facesOut(p.filter((q) => q.tag === "Walls")) && facesOut(p.filter((q) => !q.tag)), "and still face out");

const plate = byGroup("Plate");
check(plate.length === 1 && plate[0].faces.every((f) => f.length === 9), "a face with a hole cut into triangles");
check(near(areaOf(plate), 300), "covering the face less its hole");
check(
  plate[0].faces.every((f) => newell(f)[2] > 0),
  "each facing the face's way",
);
check(!!plate[0].color && near(plate[0].color.r, 1) && plate[0].faces.every((f) => near(f[2], -50)), "red, where the group was placed");

const loose = byGroup("");
check(loose.length === 2 && loose.every((q) => q.faces.length === 1) && near(loose[0].opacity ?? 1, 0.4), "the loose faces, the first see-through as its material");
check(!!loose[1].color && near(loose[1].color.r, 1) && loose[1].name === "Red", "a face painted only on its back takes its back's paint");

const sk = read.skipped;
check(sk["hidden face"] === 6, `the hidden instance's faces left out (${sk["hidden face"]})`);
check(
  sk.text === 1 && sk["endless guide line"] === 1 && sk.dimension === 1 && sk["section plane"] === 1 && !sk.line && !sk.guide && !sk.image,
  `a text, an endless guide line, a dimension and a section plane counted once, nothing else (${JSON.stringify(sk)})`,
);

// into a blank drawing, as File > Import SketchUp puts it: symbols made, instances in their tags' classes
{
  const session = openVwx(blankDrawing("mm"), "blank.vwx");
  const layer = session.doc.layers()[0].id;
  const none = session.doc.classes().find((c) => c.name === "None")!.index;
  const wallsClass = session.createClass("Walls");
  const guidesClass = session.createClass("Guides");
  const classOf = (tag: string | undefined): number => (tag === "Walls" ? wallsClass : tag === "Guides" ? guidesClass : none);
  const node = (n: MeshTreeNode): MeshNode => ({
    parts: n.parts.map((q) => q.faces.map((f) => f.map((v) => v * 25.4))),
    classes: n.parts.map((q) => classOf(q.tag)),
    lines: (n.lines ?? []).map((q) => ({ points: q.points.map((v) => v * 25.4), closed: q.closed, classIndex: classOf(q.tag) })),
    loci: (n.points ?? []).map((q) => ({ at: q.at.map((v) => v * 25.4), classIndex: classOf(q.tag) })),
    groups: n.groups.map((g) => ({ ...node(g), name: g.name, classIndex: classOf(g.tag) })),
    instances: n.instances.map((i) => ({ symbol: i.symbol, matrix: i.matrix.map((v, k) => (k >= 9 ? v * 25.4 : v)), name: i.name, classIndex: classOf(i.tag) })),
  });
  const made = session.addMeshModel(layer, { symbols: tree.symbols.map((x) => ({ name: x.name, content: node(x.content) })), top: node(tree.top) }, none);
  const defs = session.doc.symbolDefs().map((d) => d.name).sort();
  check(made.symbols.length === 3 && defs.join() === "Cube,Cube (Blue),Pair", `three symbol definitions made (${defs.join()})`);
  check(made.instances === 7 && made.meshes === 5, `seven instances placed (five on the layer, two in Pair) and five meshes made: one in each Cube symbol, the Plate's and the two loose faces' (${made.instances}, ${made.meshes})`);
  check(made.lines === 3 && made.loci === 1, `three 3D polygons and a 3D locus made (${made.lines}, ${made.loci})`);
  for (const [when, doc] of [
    ["made", session.doc],
    ["saved and reopened", openVwx(session.doc.toBytes(), "again.vwx").doc],
  ] as const) {
    const held = doc.objects(layer).filter((o) => o.parentId === made.id);
    check(
      held.map((o) => o.typeName).sort().join() === "3d-locus,3d-polygon,3d-polygon,3d-polygon,group,mesh,mesh,symbol,symbol,symbol,symbol,symbol",
      `${when}: the top group holds the five instances, the Plate group, the two loose faces, the three lines and the locus (${held.map((o) => o.typeName).sort().join()})`,
    );
    const polys = held.filter((o) => o.typeName === "3d-polygon");
    check(polys.filter((o) => o.classIndex === guidesClass).length === 1 && held.find((o) => o.typeName === "3d-locus")?.classIndex === guidesClass, `${when}: the guide line and point in the Guides class`);
  }
  const held = session.doc.objects(layer).filter((o) => o.parentId === made.id);
  const box = held.find((o) => o.kind === "symbol" && o.name === "Box");
  check(!!box && box.classIndex === wallsClass, "the tagged instance in its tag's class, by its name");
  // the 3D view: the same faces, in millimetres, where the unfolded tree has them
  const tris = session.doc.model3d().flatMap((m3) => {
    const out: number[][] = [];
    for (let i = 0; i + 8 < m3.triangles.length; i += 9) out.push([...m3.triangles.subarray(i, i + 9)]);
    return out;
  });
  const shown = tris.reduce((n, t) => n + area(t), 0);
  const want = areaOf(placed) * 25.4 ** 2;
  check(near(shown, want, 1e-3 * want), `the 3D view shows the unfolded faces' area (${shown.toFixed(0)} and ${want.toFixed(0)} mm²)`);
  const lo = [0, 1, 2].map((k) => Math.min(...tris.flatMap((t) => [t[k], t[k + 3], t[k + 6]])));
  const hi = [0, 1, 2].map((k) => Math.max(...tris.flatMap((t) => [t[k], t[k + 3], t[k + 6]])));
  const b = box3(placed);
  check([0, 1, 2].every((k) => near(lo[k], b.min[k] * 25.4, 1e-3) && near(hi[k], b.max[k] * 25.4, 1e-3)), `and spans the same box (${lo.map((v) => v.toFixed(1))} to ${hi.map((v) => v.toFixed(1))})`);
  // each cube's twelve triangles face out, the mirrored one's too
  const cubes = session.doc.model3d().filter((m3) => m3.triangles.length === 12 * 9);
  check(
    cubes.length === 6 && cubes.every((m3) => facesOut([{ name: "", faces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((t) => [...m3.triangles.subarray(9 * t, 9 * t + 9)]) }])),
    `each placed cube's triangles in 3D face out, the mirrored one's too (${cubes.length}: ${cubes.map((m3) => `${m3.triangles[0].toFixed(0)}:${facesOut([{ name: "", faces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((t) => [...m3.triangles.subarray(9 * t, 9 * t + 9)]) }])}`).join(" ")})`,
  );
}

// ---- textures ------------------------------------------------------------------------------

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

{
  // a brick image that SketchUp tiles every 16 inches across and 8 up
  const image = png(4, 2, false);
  const t = create();
  const brick = t.addTextureMaterial("Brick", image, "brick.png", 8, 16);
  t.addGroup((d) => d.addFace([[0, 0, 0], [32, 0, 0], [32, 16, 0], [0, 16, 0]], { material: brick }), { name: "Floor" });
  // pinned: one image across 10 inches along y, two up 20 inches, in a group mirrored in x
  const pins: [[number, number, number], [number, number]][] = [
    [[0, 0, 0], [0, 0]],
    [[0, 10, 0], [1, 0]],
    [[0, 0, 20], [0, 2]],
  ];
  t.addGroup((d) => d.addFace([[0, 0, 0], [0, 10, 0], [0, 10, 20], [0, 0, 20]], { material: brick, frontUv: pins }), { name: "Wall", translation: [5, -50, 0], matrix3x3: mirror });
  const tile = t.addComponentDefinition("Tile", (d) => d.addFace([[0, 0, 0], [16, 0, 0], [16, 8, 0], [0, 8, 0]], { material: brick }));
  t.addInstance(tile, { translation: [100, 0, 0] });
  t.addInstance(tile, { translation: [200, 0, 0], matrix3x3: mirror });
  const file = parseSkp(t.toBytes());
  const tex = file.textures ?? [];
  check(tex.length === 1 && tex[0].name === "Brick" && tex[0].mime === "image/png" && tex[0].size === 16 && tex[0].image.length === image.length, `the textured material's image read once, 16 inches across (${JSON.stringify(tex.map((x) => [x.name, x.mime, x.size]))})`);
  // (u, v) where SketchUp puts the image: a plain one by the face's plane at the tile size, a
  // pinned one by its pins (over the tile size, as SketchUp keeps them); in inches, in the face's own frame
  const wall = (y: number, z: number): number[] => [y / 160, z / 80];
  const plain = (x: number, y: number): number[] => [x / 16, y / 8];
  const parts = [...file.tree!.top.groups.flatMap((g) => g.parts.map((p) => ({ p, at: g.name }))), ...file.tree!.symbols.flatMap((x) => x.content.parts.map((p) => ({ p, at: x.name })))];
  const uvsRight = parts.every(({ p, at }) =>
    p.texture === 0 &&
    p.uvs?.length === p.faces.length &&
    p.faces.every((f, i) => {
      for (let k = 0; k < f.length / 3; k++) {
        // the wall's group is placed: x mirrored about its own 0 and moved 5, y moved -50
        const want = at === "Wall" ? wall(f[3 * k + 1] + 50, f[3 * k + 2]) : plain(f[3 * k], f[3 * k + 1]);
        if (!near(p.uvs![i][2 * k], want[0]) || !near(p.uvs![i][2 * k + 1], want[1])) return false;
      }
      return true;
    }),
  );
  check(parts.length === 3 && uvsRight, `each corner's (u, v) as SketchUp places the image, a mirrored group's corners keeping theirs (${parts.map(({ p, at }) => `${at}: ${JSON.stringify(p.uvs)}`).join("; ")})`);

  // into a blank drawing: the image a texture, each textured mesh mapped by UV, kept when saved
  const session = openVwx(blankDrawing("mm"), "blank.vwx");
  const layer = session.doc.layers()[0].id;
  const texture = session.addImageTexture("Brick", { image, mime: "image/png", width: 4, height: 2, size: 16 * 25.4, color: [130, 130, 130], previews: { large: png(256, 256, true), small: png(64, 64, true) } });
  const info = session.doc.resources().find((r) => r.index === texture);
  check(info?.kind === "texture" && near(info.imageSize ?? 0, 16 * 25.4) && info.imagePixels?.width === 4 && info.imageMime === "image/png", `a blank drawing takes the image as a texture (${JSON.stringify(info && [info.kind, info.imageSize, info.imagePixels])})`);
  const node = (n: MeshTreeNode): MeshNode => ({
    parts: n.parts.map((q) => q.faces.map((f) => f.map((v) => v * 25.4))),
    textures: n.parts.map((q) => (q.texture === 0 ? texture : undefined)),
    uvs: n.parts.map((q) => q.uvs),
    groups: n.groups.map((g) => ({ ...node(g), name: g.name })),
    instances: n.instances.map((i) => ({ symbol: i.symbol, matrix: i.matrix.map((v, k) => (k >= 9 ? v * 25.4 : v)) })),
  });
  session.addMeshModel(layer, { symbols: file.tree!.symbols.map((x) => ({ name: x.name, content: node(x.content) })), top: node(file.tree!.top) });
  for (const [when, doc] of [
    ["made", session.doc],
    ["saved and reopened", openVwx(session.doc.toBytes(), "again.vwx").doc],
  ] as const) {
    const shown = doc.model3d().filter((m3) => m3.texture === texture && m3.uvs?.length === (m3.triangles.length / 9) * 6);
    // each corner shown: (u, v) as its place in the model says, the mirrored tile's too
    let corners = 0;
    let right = 0;
    for (const m3 of shown) {
      for (let c = 0; c < m3.triangles.length / 3; c++) {
        const [x, y, z] = [0, 1, 2].map((k) => m3.triangles[3 * c + k] / 25.4);
        const want = near(x, 5, 1e-3) ? wall(y + 50, z) : x > 150 ? plain(200 - x, y) : x > 50 ? plain(x - 100, y) : plain(x, y);
        corners++;
        if (near(m3.uvs![2 * c], want[0], 1e-5) && near(m3.uvs![2 * c + 1], want[1], 1e-5)) right++;
      }
    }
    check(shown.length === 4 && corners === 24 && right === corners, `${when}: the 3D view shows the texture on the floor, the wall and both tiles, each corner where SketchUp has it (${shown.length} meshes, ${right} of ${corners} corners)`);
    const tiles = shown.filter((m3) => near(m3.triangles[2], 0) && m3.triangles[0] / 25.4 > 50);
    check(tiles.length === 2 && tiles.every((m3) => [0, 9].every((t) => newell([...m3.triangles.subarray(t, t + 9)])[2] > 0)), `both tiles face up, the mirrored one too (${tiles.length})`);
  }
}

{
  // an image: a 48 by 24 inch picture, standing at y = 300
  const picture = png(4, 2, false);
  const t = create();
  t.addImage(picture, 48, 24, { translation: [0, 300, 0], rotation: { axis: [1, 0, 0], angleRadians: Math.PI / 2 } });
  const file = parseSkp(t.toBytes());
  const [image] = file.tree!.top.groups;
  const face = image?.parts[0]?.faces[0] ?? [];
  const b = box3(image?.parts ?? []);
  check(
    file.tree!.top.groups.length === 1 && image.parts.length === 1 && image.parts[0].faces.length === 1 && image.parts[0].texture === 0 && file.textures?.[0]?.image.length === picture.length,
    `an image comes in as a group of its one face, showing its picture (${image?.parts.map((q) => [q.faces.length, q.texture])})`,
  );
  check(
    near(area(face), 48 * 24) && near(b.min[1], b.max[1]) && near(Math.abs(b.min[1] - 300), 1 / 25.4) && near(b.max[2], 24),
    `the picture 48 by 24 inches, standing where it was put, lifted a millimetre off its plane (${b.min} to ${b.max})`,
  );
  // its corners at the picture's corners: (0, 0) at its foot's start, (1, 1) at its top's end
  const uv = image?.parts[0].uvs?.[0] ?? [];
  const right = face.length === 12 && uv.length === 8 && [0, 1, 2, 3].every((k) => near(uv[2 * k], face[3 * k] / 48, 1e-6) && near(uv[2 * k + 1], face[3 * k + 2] / 24, 1e-6));
  check(right, `its corners at the picture's corners (${uv.map((v) => v.toFixed(3))})`);
  check(!Object.keys(file.skipped).length, `nothing left out (${JSON.stringify(file.skipped)})`);
}

for (const [bytes, what] of [
  [new TextEncoder().encode("not a SketchUp file"), "text"],
  [new Uint8Array(0), "nothing"],
] as const) {
  let message = "";
  try {
    parseSkp(bytes);
  } catch (err) {
    message = (err as Error).message;
  }
  check(message === "it isn't a SketchUp file", `${what} refused as not SketchUp (${message})`);
}

// ---- SketchUp's own files ------------------------------------------------------------------

const dir = process.env.SKP_DIR;
if (dir) {
  const files = readdirSync(dir)
    .filter((f) => /\.skp$/i.test(f))
    .sort();
  let read = 0;
  for (const name of files) {
    const bytes = new Uint8Array(readFileSync(join(dir, name)));
    const version = /\{[\d.]+\}/.exec(new TextDecoder("utf-16le").decode(bytes.subarray(0, 96)))?.[0] ?? "";
    let model: MeshFile;
    try {
      model = parseSkp(bytes);
    } catch (err) {
      console.log(`     ${name} ${version}: refused, ${(err as Error).message}`);
      continue;
    }
    read++;
    const all = model.tree ? unfold(model.tree) : [];
    const own = all.reduce((n, q) => n + q.faces.length, 0);
    const kinds = Object.entries(model.skipped).map(([k, n]) => `${n} ${k}`);
    console.log(
      `     ${name} ${version}: ${model.tree?.symbols.length ?? 0} symbols; ${own} faces placed in ${new Set(all.map((q) => q.label)).size} top-level groups and instances; left out ${kinds.join(", ") || "nothing"}`,
    );
    check(all.every((q) => q.faces.every((f) => f.length >= 9 && f.length % 3 === 0 && f.every(Number.isFinite))), `${name}: every face has three corners or more, all finite`);
    if (model.skipped["hidden face"] || model.skipped.image) continue;
    // openskp's own triangles, each face once, in square metres
    const scene = buildScene(bytes.slice().buffer, { frontSideOnly: true });
    let theirs = 0;
    for (const prim of scene.glbPrimitives) {
      const at = (i: number): number[] => [prim.positions[3 * i], prim.positions[3 * i + 1], prim.positions[3 * i + 2]];
      for (let t = 0; t < prim.indices.length; t += 3) theirs += area([...at(prim.indices[t]), ...at(prim.indices[t + 1]), ...at(prim.indices[t + 2])]);
    }
    const ours = areaOf(all) * 0.0254 ** 2;
    check(near(ours, theirs, 1e-4 * Math.max(1, theirs)), `${name}: the faces cover openskp's triangles' area (${ours.toPrecision(6)} and ${theirs.toPrecision(6)} m²)`);
  }
  console.log(`     ${read} of ${files.length} read`);
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
