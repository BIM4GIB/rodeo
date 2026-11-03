// Node check of the STEP export. Run from web/: npx tsx src/export/step.check.ts

import assert from "node:assert/strict";
import type { Model3D } from "./scene3d.ts";
import { exportStep } from "./step.ts";

type V3 = [number, number, number];

/** A box's 12 triangles, counter-clockwise from outside. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, skip: number[] = []): number[] {
  const c = (i: number): V3 => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const quads = [
    [0, 2, 3, 1],
    [4, 5, 7, 6],
    [0, 1, 5, 4],
    [2, 6, 7, 3],
    [0, 4, 6, 2],
    [1, 3, 7, 5],
  ];
  return quads.filter((_, i) => !skip.includes(i)).flatMap(([a, b, d, e]) => [...c(a), ...c(b), ...c(d), ...c(a), ...c(d), ...c(e)]);
}

const model = (objects: { name: string; pieces: { color: string; triangles: number[] }[] }[], layer = "Design Layer-1"): Model3D => ({
  layers: [
    {
      id: "L",
      name: layer,
      elevation: 0,
      objects: objects.map((o, i) => ({ id: `o${i}`, name: o.name, className: "None", pieces: o.pieces.map((p) => ({ color: p.color, opacity: 1, triangles: new Float32Array(p.triangles) })) })),
    },
  ],
});

/** The arguments of a STEP entity's text, split at its top-level commas. */
function args(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of body) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

const ARITY: Record<string, number> = {
  APPLICATION_CONTEXT: 1,
  APPLICATION_PROTOCOL_DEFINITION: 4,
  PRODUCT_CONTEXT: 3,
  PRODUCT: 4,
  PRODUCT_RELATED_PRODUCT_CATEGORY: 3,
  PRODUCT_DEFINITION_FORMATION: 3,
  PRODUCT_DEFINITION_CONTEXT: 3,
  PRODUCT_DEFINITION: 4,
  PRODUCT_DEFINITION_SHAPE: 3,
  UNCERTAINTY_MEASURE_WITH_UNIT: 4,
  CARTESIAN_POINT: 2,
  DIRECTION: 2,
  AXIS2_PLACEMENT_3D: 4,
  SHAPE_REPRESENTATION: 3,
  SHAPE_DEFINITION_REPRESENTATION: 2,
  COLOUR_RGB: 4,
  FILL_AREA_STYLE_COLOUR: 2,
  FILL_AREA_STYLE: 2,
  SURFACE_STYLE_FILL_AREA: 1,
  SURFACE_SIDE_STYLE: 2,
  SURFACE_STYLE_USAGE: 2,
  PRESENTATION_STYLE_ASSIGNMENT: 1,
  VERTEX_POINT: 2,
  VECTOR: 3,
  LINE: 3,
  EDGE_CURVE: 5,
  ORIENTED_EDGE: 5,
  EDGE_LOOP: 2,
  FACE_OUTER_BOUND: 3,
  PLANE: 2,
  ADVANCED_FACE: 4,
  CLOSED_SHELL: 2,
  OPEN_SHELL: 2,
  MANIFOLD_SOLID_BREP: 2,
  SHELL_BASED_SURFACE_MODEL: 2,
  STYLED_ITEM: 3,
  PRESENTATION_LAYER_ASSIGNMENT: 3,
  SHAPE_REPRESENTATION_RELATIONSHIP: 4,
  ADVANCED_BREP_SHAPE_REPRESENTATION: 3,
  MANIFOLD_SURFACE_SHAPE_REPRESENTATION: 3,
  MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION: 3,
};

interface Entity {
  readonly type: string;
  readonly args: string[];
}

/** The file's entities by number, checked: numbered in order, of known types and arities, every reference to one there. */
function read(text: string): Map<number, Entity> {
  assert.ok(text.startsWith("ISO-10303-21;\nHEADER;"));
  assert.ok(text.includes("FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));"));
  assert.ok(text.trimEnd().endsWith("END-ISO-10303-21;"));
  const data = text.slice(text.indexOf("DATA;\n") + 6, text.lastIndexOf("ENDSEC;"));
  const out = new Map<number, Entity>();
  for (const line of data.trim().split("\n")) {
    const m = /^#(\d+)=(.*);$/.exec(line);
    assert.ok(m, line);
    const n = Number(m[1]);
    assert.equal(n, out.size + 1, "numbered in order");
    const body = m[2];
    const simple = /^([A-Z_0-9]+)\((.*)\)$/.exec(body);
    if (simple && !body.startsWith("(")) {
      const a = args(simple[2]);
      assert.ok(simple[1] in ARITY, `unknown ${simple[1]}`);
      assert.equal(a.length, ARITY[simple[1]], line);
      out.set(n, { type: simple[1], args: a });
    } else out.set(n, { type: "COMPLEX", args: [body] });
  }
  for (const [n, e] of out) for (const r of e.args.join(",").matchAll(/#(\d+)/g)) assert.ok(out.has(Number(r[1])), `#${n} refers to #${r[1]}`);
  return out;
}

const refs = (s: string): number[] => [...s.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
const nums = (s: string): number[] => s.replace(/[()]/g, "").split(",").map(Number);
const ofType = (es: Map<number, Entity>, type: string): [number, Entity][] => [...es].filter(([, e]) => e.type === type);
const pointOf = (es: Map<number, Entity>, vertex: number): V3 => nums(es.get(refs(es.get(vertex)!.args[1])[0])!.args[1]) as V3;

/** Checks a closed shell: its loops run on, each edge twice opposite ways, V − E + F = 2, its faces' normals out from `centre`. */
function checkSolid(es: Map<number, Entity>, shell: number, centre: V3): { v: number; e: number; f: number } {
  const faces = refs(es.get(shell)!.args[1]);
  const uses = new Map<number, string[]>();
  const vertices = new Set<number>();
  for (const f of faces) {
    const face = es.get(f)!;
    assert.equal(face.type, "ADVANCED_FACE");
    const loop = es.get(refs(es.get(refs(face.args[1])[0])!.args[1])[0])!;
    const ends = refs(loop.args[1]).map((o) => {
      const oe = es.get(o)!;
      const ec = es.get(refs(oe.args[3])[0])!;
      const forward = oe.args[4] === ".T.";
      uses.set(refs(oe.args[3])[0], [...(uses.get(refs(oe.args[3])[0]) ?? []), oe.args[4]]);
      const [a, b] = [refs(ec.args[1])[0], refs(ec.args[2])[0]];
      vertices.add(a).add(b);
      return forward ? [a, b] : [b, a];
    });
    ends.forEach(([, end], i) => assert.equal(end, ends[(i + 1) % ends.length][0], "the loop runs on"));
    // the plane's normal points away from the middle
    const axes = es.get(refs(es.get(refs(face.args[2])[0])!.args[1])[0])!;
    const normal = nums(es.get(refs(axes.args[2])[0])!.args[1]);
    const at = pointOf(es, ends[0][0]);
    const outward = normal.reduce((s, c, k) => s + c * (at[k] - centre[k]), 0);
    assert.ok(outward > 0, "the normal runs out");
  }
  for (const [, u] of uses) assert.deepEqual(u.sort(), [".F.", ".T."], "each edge once each way");
  const v = vertices.size;
  const e = uses.size;
  const f = faces.length;
  assert.equal(v - e + f, 2, "Euler");
  return { v, e, f };
}

// a cube: one solid of six faces, 8 vertices and 12 edges
{
  const r = exportStep(model([{ name: "Cube", pieces: [{ color: "#ff0000", triangles: box(0, 0, 0, 1000, 1000, 1000) }] }]), false, "Test.vwx", new Date("2026-11-03T12:00:00Z"));
  assert.deepEqual([r.solids, r.surfaces, r.faces], [1, 0, 6]);
  const es = read(r.text);
  assert.ok(r.text.includes("FILE_NAME('Test.stp','2026-11-03T12:00:00'"));
  assert.ok(r.text.includes("(LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.))"));
  const [[, brep]] = ofType(es, "MANIFOLD_SOLID_BREP");
  assert.equal(brep.args[0], "'Cube'");
  assert.deepEqual(checkSolid(es, refs(brep.args[1])[0], [500, 500, 500]), { v: 8, e: 12, f: 6 });
  assert.equal(ofType(es, "ADVANCED_BREP_SHAPE_REPRESENTATION").length, 1);
  assert.equal(ofType(es, "MANIFOLD_SURFACE_SHAPE_REPRESENTATION").length, 0);
  assert.deepEqual(ofType(es, "COLOUR_RGB").map(([, e]) => e.args.slice(1)), [["1.", "0.", "0."]]);
  assert.equal(ofType(es, "STYLED_ITEM").length, 1);
  const [[, layer]] = ofType(es, "PRESENTATION_LAYER_ASSIGNMENT");
  assert.equal(layer.args[0], "'Design Layer-1'");
  // a corner's point
  assert.ok(ofType(es, "CARTESIAN_POINT").some(([, e]) => e.args[1] === "(1000.,1000.,1000.)"));
}

// trimmed surfaces: a cube as six bodies of one face each
{
  const r = exportStep(model([{ name: "Cube", pieces: [{ color: "#808080", triangles: box(0, 0, 0, 1000, 1000, 1000) }] }]), true, "Test.vwx");
  assert.deepEqual([r.solids, r.surfaces, r.faces], [0, 6, 6]);
  const es = read(r.text);
  assert.equal(ofType(es, "OPEN_SHELL").length, 6);
  assert.equal(ofType(es, "EDGE_CURVE").length, 24, "no edge shared between bodies");
  assert.equal(ofType(es, "MANIFOLD_SURFACE_SHAPE_REPRESENTATION").length, 1);
}

// an open box (no top) is a surface model; two boxes apart in one object are two solids
{
  const r = exportStep(
    model([
      { name: "Tray", pieces: [{ color: "#00ff00", triangles: box(0, 0, 0, 500, 500, 200, [1]) }] },
      { name: "Pair", pieces: [{ color: "#0000ff", triangles: [...box(0, 0, 0, 100, 100, 100), ...box(300, 0, 0, 400, 100, 100)] }] },
    ]),
    false,
    "Test.vwx",
  );
  assert.deepEqual([r.solids, r.surfaces, r.faces], [2, 1, 17]);
  const es = read(r.text);
  const breps = ofType(es, "MANIFOLD_SOLID_BREP");
  assert.deepEqual(
    breps.map(([, e]) => e.args[0]),
    ["'Pair'", "'Pair'"],
  );
  checkSolid(es, refs(breps[0][1].args[1])[0], [50, 50, 50]);
  checkSolid(es, refs(breps[1][1].args[1])[0], [350, 50, 50]);
  assert.equal(ofType(es, "SHELL_BASED_SURFACE_MODEL")[0][1].args[0], "'Tray'");
  assert.equal(ofType(es, "PRESENTATION_LAYER_ASSIGNMENT")[0][1].args[2].match(/#/g)?.length, 3);
}

// a box whose top is another colour: still one solid, its top styled on its own
{
  const r = exportStep(
    model([
      {
        name: "Lid é",
        pieces: [
          { color: "#ff0000", triangles: box(0, 0, 0, 1000, 1000, 1000, [1]) },
          { color: "#0000ff", triangles: box(0, 0, 0, 1000, 1000, 1000, [0, 2, 3, 4, 5]) },
        ],
      },
    ]),
    false,
    "Test.vwx",
  );
  assert.deepEqual([r.solids, r.surfaces, r.faces], [1, 0, 6]);
  const es = read(r.text);
  const [[, brep]] = ofType(es, "MANIFOLD_SOLID_BREP");
  assert.equal(brep.args[0], "'Lid \\X2\\00E9\\X0\\'");
  checkSolid(es, refs(brep.args[1])[0], [500, 500, 500]);
  const styledItems = ofType(es, "STYLED_ITEM").map(([, e]) => es.get(refs(e.args[2])[0])!.type);
  assert.deepEqual(styledItems, ["MANIFOLD_SOLID_BREP", "ADVANCED_FACE"]);
  assert.equal(ofType(es, "COLOUR_RGB").length, 2);
}

// a box with its bottom wound as its top (as an extrude's caps come) and one inside out: turned to close, facing out
{
  const flipped = (tris: number[]): number[] => {
    const out = [...tris];
    for (let i = 0; i < out.length; i += 9) for (let k = 0; k < 3; k++) [out[i + 3 + k], out[i + 6 + k]] = [out[i + 6 + k], out[i + 3 + k]];
    return out;
  };
  const capUp = [...flipped(box(0, 0, 0, 1000, 1000, 1000, [1, 2, 3, 4, 5])), ...box(0, 0, 0, 1000, 1000, 1000, [0])];
  const r = exportStep(
    model([
      { name: "Caps", pieces: [{ color: "#ff0000", triangles: capUp }] },
      { name: "Inside out", pieces: [{ color: "#ff0000", triangles: flipped(box(2000, 0, 0, 3000, 1000, 1000)) }] },
    ]),
    false,
    "Test.vwx",
  );
  assert.deepEqual([r.solids, r.surfaces], [2, 0]);
  const es = read(r.text);
  const breps = ofType(es, "MANIFOLD_SOLID_BREP");
  checkSolid(es, refs(breps[0][1].args[1])[0], [500, 500, 500]);
  checkSolid(es, refs(breps[1][1].args[1])[0], [2500, 500, 500]);
}

// a lone triangle, and nothing at all
{
  const r = exportStep(model([{ name: "Tri", pieces: [{ color: "#000000", triangles: [0, 0, 0, 100, 0, 0, 0, 100, 0] }] }]), false, "Test.vwx");
  assert.deepEqual([r.solids, r.surfaces, r.faces], [0, 1, 1]);
  read(r.text);
  const none = exportStep({ layers: [] }, false, "Empty.vwx");
  assert.deepEqual([none.solids, none.surfaces, none.faces], [0, 0, 0]);
  read(none.text);
}

console.log("step: all passed");
