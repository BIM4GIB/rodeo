// A drawing's 3D model with symbols, for the checks of the writers and readers that carry them
// (import/{rhino,collada,fbx}.check.ts, core/blank.check.ts): a Chair holding a Seat and two Legs
// (a symbol of its own), placed twice, turned and mirrored, beside a Table. checkSymbolTrip says
// whether a file read back holds one Chair placed twice where it was. Only the checks import it.

import { bakeSymbol, type Model3D, type ModelPiece } from "../export/scene3d.ts";
import { unfoldTree, type MeshFile, type MeshTree, type MeshTreeInstance, type MeshTreeNode } from "./mesh.ts";

type V3 = [number, number, number];

/** the Chairs' placements: a quarter turn lifted 300, and a mirror in x */
export const TURNED = [0, 1, 0, -1, 0, 0, 0, 0, 1, 2000, 1000, 300];
export const MIRRORED = [-1, 0, 0, 0, 1, 0, 0, 0, 1, 5000, 0, 0];
/** the Legs' placements in the Chair */
export const LEGS = [
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
  [1, 0, 0, 0, 1, 0, 0, 0, 1, 460, 460, 0],
];
export const SEAT = "#d62828";
export const WOOD = "#8b5a2b";
/** a Chair's volume: its seat and two legs (mm³) */
const CHAIR_VOLUME = 500 * 500 * 50 + 2 * 40 * 40 * 400;

/** A box's twelve triangles, counter-clockwise seen from outside. */
export function boxTriangles(lo: V3, hi: V3): Float32Array {
  const c = (i: number): V3 => [i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]];
  const quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
  return Float32Array.from(quads.flatMap(([a, b, d, e]) => [a, b, d, a, d, e].flatMap(c)));
}

const box = (lo: V3, hi: V3, color: string): ModelPiece => ({ color, opacity: 1, triangles: boxTriangles(lo, hi) });

export const SYMBOL_MODEL: Model3D = {
  symbols: [
    { name: "Leg", objects: [{ id: "post", name: "Post", className: "None", pieces: [box([0, 0, 0], [40, 40, 400], WOOD)] }] },
    {
      name: "Chair",
      objects: [
        { id: "seat", name: "Seat", className: "None", pieces: [box([0, 0, 400], [500, 500, 450], SEAT)] },
        { id: "leg-1", name: "Leg", className: "None", pieces: [], instance: { symbol: 0, matrix: LEGS[0] } },
        { id: "leg-2", name: "Leg", className: "None", pieces: [], instance: { symbol: 0, matrix: LEGS[1] } },
      ],
    },
  ],
  layers: [
    {
      id: "ground",
      name: "Ground",
      elevation: 0,
      objects: [
        { id: "chair-1", name: "Chair", className: "None", pieces: [], instance: { symbol: 1, matrix: TURNED } },
        { id: "chair-2", name: "Window chair", className: "None", pieces: [], instance: { symbol: 1, matrix: MIRRORED } },
        { id: "table", name: "Table", className: "None", pieces: [box([3000, 0, 0], [4000, 800, 750], "#cccccc")] },
      ],
    },
  ],
};

const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;

/** A placement's offset scaled from the file's units to mm. */
const inMm = (m: readonly number[], mm: number): number[] => m.map((v, k) => (k >= 9 ? v * mm : v));

const sameMatrix = (a: readonly number[], b: readonly number[]): boolean => a.length === 12 && a.every((v, k) => near(v, b[k], k >= 9 ? 0.01 : 1e-6));

/** Every instance in a node and its groups. */
function instancesIn(n: MeshTreeNode): MeshTreeInstance[] {
  return [...n.instances, ...n.groups.flatMap(instancesIn)];
}

/** The smallest box round some faces (flat x, y, z lists), scaled by `mm`. */
function boundsOf(faces: readonly (readonly number[])[], mm: number): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const f of faces)
    for (let i = 0; i < f.length; i++) {
      lo[i % 3] = Math.min(lo[i % 3], f[i] * mm);
      hi[i % 3] = Math.max(hi[i % 3], f[i] * mm);
    }
  return [lo, hi];
}

/** The volume faces close (flat x, y, z lists, fanned), scaled by `mm`: positive when they face out. */
function volumeOf(faces: readonly (readonly number[])[], mm: number): number {
  let v = 0;
  for (const f of faces) {
    const p = (i: number): V3 => [f[3 * i] * mm, f[3 * i + 1] * mm, f[3 * i + 2] * mm];
    for (let i = 1; i + 1 < f.length / 3; i++) {
      const [a, b, c] = [p(0), p(i), p(i + 1)];
      v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
  }
  return v / 6;
}

/** Where a symbol of SYMBOL_MODEL is placed by `matrix`, as a box round its triangles. */
function bakedBounds(symbol: number, matrix: readonly number[]): [V3, V3] {
  const pieces = bakeSymbol(SYMBOL_MODEL, symbol, matrix);
  const faces = pieces.flatMap((p) => Array.from({ length: p.triangles.length / 9 }, (_, i) => Array.from(p.triangles.subarray(9 * i, 9 * i + 9))));
  return boundsOf(faces, 1);
}

const sameBox = (a: [V3, V3], b: [V3, V3]): boolean => a.every((v, i) => v.every((x, k) => near(x, b[i][k], 0.05)));

/**
 * Checks SYMBOL_MODEL written to a file and read back (`file`), as `label`: a z-up tree with one
 * Chair placed twice, turned and mirrored, the mirrored one keeping its name; the Chair holding a
 * Seat and two Legs, which place a Leg symbol of their own; each Chair where it was, its faces
 * facing out; the Table beside them; the seat's colour.
 */
export function checkSymbolTrip(label: string, file: MeshFile, check: (ok: boolean, what: string) => void): void {
  const tree: MeshTree | undefined = file.tree;
  const mm = file.frame?.mm ?? 1;
  check(!!tree && file.parts.length === 0 && file.frame?.yUp === false, `${label}: read back as a z-up tree`);
  if (!tree) return;
  const named = (name: string): number[] => tree.symbols.flatMap((s, k) => (s.name === name ? [k] : []));
  const chairs = named("Chair");
  check(chairs.length === 1, `${label}: one Chair definition (${tree.symbols.map((s) => s.name)})`);
  const chair = chairs[0];
  const placed = instancesIn(tree.top).filter((i) => i.symbol === chair);
  check(placed.length === 2, `${label}: the Chair placed twice (${placed.length})`);
  const turned = placed.find((i) => sameMatrix(inMm(i.matrix, mm), TURNED));
  const mirrored = placed.find((i) => sameMatrix(inMm(i.matrix, mm), MIRRORED));
  check(!!turned && !!mirrored, `${label}: one turned and lifted, one mirrored, where they were (${placed.map((i) => inMm(i.matrix, mm).map((v) => +v.toFixed(3)).join(" ")).join(" | ")})`);
  check(turned?.name === undefined && mirrored?.name === "Window chair", `${label}: the mirrored one keeps its name, the other only repeats its symbol's (${placed.map((i) => i.name)})`);

  const content = tree.symbols[chair]?.content;
  const legs = named("Leg");
  const legPlaced = content ? instancesIn(content).filter((i) => i.symbol === legs[0]) : [];
  check(legs.length === 1 && legs[0] < chair, `${label}: one Leg definition, before the Chair (${legs})`);
  check(
    legPlaced.length === 2 && LEGS.every((m) => legPlaced.some((i) => sameMatrix(inMm(i.matrix, mm), m))),
    `${label}: the Chair places the Leg twice, where its legs were`,
  );
  const seat = content?.parts.find((p) => p.color && near(p.color.r, 0xd6 / 255, 1e-3) && near(p.color.g, 0x28 / 255, 1e-3) && near(p.color.b, 0x28 / 255, 1e-3));
  check(!!seat && sameBox(boundsOf(seat.faces, mm), [[0, 0, 400], [500, 500, 450]]), `${label}: the Chair holds its Seat, in its own frame, coloured exactly`);

  for (const [i, m, what] of [[turned, TURNED, "turned"], [mirrored, MIRRORED, "mirrored"]] as const) {
    if (!i) continue;
    const faces = unfoldTree({ symbols: tree.symbols, top: { parts: [], groups: [], instances: [i] } }).flatMap((p) => p.faces);
    check(sameBox(boundsOf(faces, mm), bakedBounds(1, m)), `${label}: the ${what} Chair stands where it did`);
    const v = volumeOf(faces, mm);
    check(near(v, CHAIR_VOLUME, CHAIR_VOLUME * 1e-4), `${label}: the ${what} Chair's faces face out (volume ${Math.round(v)} of ${CHAIR_VOLUME})`);
  }
  const loose = unfoldTree({ symbols: tree.symbols, top: { ...tree.top, instances: [], groups: tree.top.groups.map((g) => ({ ...g, instances: [] })) } });
  check(loose.length === 1 && sameBox(boundsOf(loose[0].faces, mm), [[3000, 0, 0], [4000, 800, 750]]), `${label}: the Table beside them, not a symbol (${loose.map((p) => `${p.name} ${p.faces.length} ${boundsOf(p.faces, mm).flat().map((v) => Math.round(v))}`)})`);
}
