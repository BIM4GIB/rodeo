// STEP and IGES import, the reading side (no DOM). readStep and readIges read a file through occt-import-js
// (import/occt.ts) into a tree that follows the file's assembly: each assembly node holding parts is a group
// named after it, and each leaf shape a part named after it. A shape's triangles are split by the colour of
// their faces where the file colours them (a face it leaves uncoloured takes the shape's colour, else none),
// so a face keeps its colour. Triangles stray at most 0.1% of the shape's average bounding box from its
// surface and turn at most 14 degrees from it, so curves come out round; a model that would come out in
// more triangles than an import holds is triangulated coarser, to fit. occt gives millimetres whatever the
// file's units; STEP and IGES are z up, so the frame says so and nothing is asked. It reads what
// export/step.ts and export/iges.ts write.

import { MAX_FACES, tooMany, type MeshFile, type MeshPart, type MeshTreeGroup, type MeshTreeNode } from "./mesh.ts";
import type { Occt, OcctMesh, OcctNode, OcctParams, OcctResult } from "./occt.ts";

/** How far a triangle may stray from its surface, as a fraction of the shape's average bounding box. */
const DEFLECTION = 0.001;
/** The most a triangle may turn from its surface, in radians (about 14 degrees). */
const ANGULAR = 0.25;

/** The coarsest a model is triangulated to fit MAX_FACES: 2% of a shape's size and 45 degrees. */
const COARSEST = 0.02;

/** The settings for triangles straying at most `deflection` of a shape's size from it. */
const settings = (deflection: number): OcctParams => ({
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: deflection,
  angularDeflection: Math.min(0.8, (ANGULAR * deflection) / DEFLECTION),
});

/** A STEP file's shapes as a tree of parts, in millimetres, z up. Throws with a plain reason when none can be read. */
export function readStep(bytes: Uint8Array, occt: Occt): MeshFile {
  return fromOcct((p) => occt.ReadStepFile(bytes, p), "STEP");
}

/** An IGES file's shapes as a tree of parts, as readStep reads a STEP file's. */
export function readIges(bytes: Uint8Array, occt: Occt): MeshFile {
  return fromOcct((p) => occt.ReadIgesFile(bytes, p), "IGES");
}

/** The state of one read: the file's meshes, the faces kept so far (for MAX_FACES) and what was left out. */
interface Walk {
  readonly meshes: readonly OcctMesh[];
  faces: number;
  readonly skipped: Record<string, number>;
}

type Rgb = NonNullable<MeshPart["color"]>;

/**
 * occt's result as a tree of parts. occt throws, rather than saying so, on bytes it can't read: that is
 * the same refusal. A model that comes out in more triangles than an import holds is read again coarser,
 * about as much coarser as it is over (triangles grow as the deflection shrinks), down to COARSEST.
 */
function fromOcct(read: (p: OcctParams) => OcctResult, format: string): MeshFile {
  const refusal = new Error(`no shapes could be read from this ${format} file`);
  let r: OcctResult;
  try {
    r = read(settings(DEFLECTION));
    for (let deflection = DEFLECTION, n = triangles(r); n > MAX_FACES && deflection < COARSEST; n = triangles(r)) {
      deflection = Math.min(COARSEST, (deflection * n * 1.3) / MAX_FACES);
      r = read(settings(deflection));
    }
  } catch {
    throw refusal;
  }
  if (!r.success || r.meshes.length === 0) throw refusal;
  const walk: Walk = { meshes: r.meshes, faces: 0, skipped: {} };
  const top: MeshTreeNode = { parts: [], groups: [], instances: [] };
  collect(r.root, top, walk);
  return { parts: [], skipped: walk.skipped, frame: { mm: 1, yUp: false }, tree: { symbols: [], top } };
}

/**
 * A node's meshes as parts of `into`, and the nodes under it: a node with nodes under it is a group, a leaf's
 * meshes go in the node holding it, as an assembly's single parts do.
 */
function collect(node: OcctNode, into: MeshTreeNode, walk: Walk): void {
  for (const i of node.meshes) {
    const mesh = walk.meshes[i];
    if (mesh) into.parts.push(...partsOf(mesh, node.name || mesh.name, walk));
  }
  for (const child of node.children) {
    if (child.children.length === 0) {
      collect(child, into, walk);
      continue;
    }
    const group: MeshTreeGroup = { name: child.name, parts: [], groups: [], instances: [] };
    collect(child, group, walk);
    if (holdsParts(group)) into.groups.push(group);
  }
}

/** How many triangles a read gave. */
function triangles(r: OcctResult): number {
  return r.success ? r.meshes.reduce((n, m) => n + Math.floor(m.index.array.length / 3), 0) : 0;
}

/** Whether a container holds a part, its own or in a group under it. */
function holdsParts(node: MeshTreeNode): boolean {
  return node.parts.length > 0 || node.groups.some(holdsParts);
}

/** A mesh's triangles, one part per colour its faces have, each named as the shape is. */
function partsOf(mesh: OcctMesh, name: string, walk: Walk): MeshPart[] {
  const pos = mesh.attributes.position.array;
  const idx = mesh.index.array;
  const triangles = Math.floor(idx.length / 3);
  const vertices = Math.floor(pos.length / 3);
  const shape = mesh.color ? rgb(mesh.color) : undefined;
  // each triangle's colour: its brep face's where the file gives it one, else the shape's
  const colour = new Array<Rgb | undefined>(triangles).fill(shape);
  for (const face of mesh.brep_faces) {
    if (!face.color) continue;
    const c = rgb(face.color);
    for (let t = Math.max(0, face.first); t <= Math.min(face.last, triangles - 1); t++) colour[t] = c;
  }
  const parts = new Map<string, MeshPart>();
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [idx[3 * t], idx[3 * t + 1], idx[3 * t + 2]];
    if (a === b || b === c || a === c || !(a < vertices && b < vertices && c < vertices)) {
      walk.skipped["bad face"] = (walk.skipped["bad face"] ?? 0) + 1;
      continue;
    }
    if (++walk.faces > MAX_FACES) throw tooMany();
    const k = colour[t];
    const key = k ? `${k.r},${k.g},${k.b}` : "";
    let part = parts.get(key);
    if (!part) {
      part = { name, faces: [], ...(k ? { color: k } : {}) };
      parts.set(key, part);
    }
    part.faces.push([...corner(pos, a), ...corner(pos, b), ...corner(pos, c)]);
  }
  return [...parts.values()];
}

/** The x, y, z of a vertex. */
function corner(pos: readonly number[], i: number): number[] {
  return [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
}

/** occt's 0..1 colour triple as a colour, each channel kept to 0..1. */
function rgb(c: readonly [number, number, number]): Rgb {
  const clamp = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
  return { r: clamp(c[0]), g: clamp(c[1]), b: clamp(c[2]) };
}
