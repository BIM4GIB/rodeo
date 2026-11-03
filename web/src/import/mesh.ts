// OBJ, glTF, 3DS and STL import, the reading side (no DOM). parseObj reads OBJ text, parseGltf a .glb or
// a .gltf whose buffers are inside it, parse3ds a 3D Studio file and parseStl an STL file into
// parts: named lists of flat faces, each a run of x, y, z triples in the file's own units and axes,
// with a colour where the file gives one (an OBJ vertex colour, a glTF material's base colour, a
// 3DS material's diffuse colour). OBJ parts follow its `o` and `g` lines; glTF parts are the meshes
// its scene's nodes place, through their transforms; 3DS parts are its objects, split by material;
// STL parts are its ASCII solids. Lines, points and compressed geometry are left out and counted.
// It reads what export/model3d.ts, export/threeds.ts and export/stl.ts write.

import type { NewShape } from "../core/types.ts";

/** Most faces one file may bring in. */
export const MAX_FACES = 250_000;

export interface MeshPart {
  name: string;
  /** each face's corners, x, y, z triples, in the file's units and axes */
  faces: number[][];
  /** 0..1 channels */
  color?: { r: number; g: number; b: number };
  /** what holds it in the file (an IFC building storey), to group it with the rest held there */
  group?: string;
  /** the tag it is on in the file (a SketchUp tag), the class it comes in */
  tag?: string;
  /** 0..1, where the file's material is see-through */
  opacity?: number;
  /** the texture its faces show, an index into MeshFile.textures, placed on each face by `uvs` */
  texture?: number;
  /** with `texture`: for each face, (u, v) at each corner, as fractions of the image across and up from its lower left */
  uvs?: number[][];
  /** a glTF part's node's own extras, as the file gives them (rvt-rs puts its element's index there) */
  extras?: unknown;
}

/** An image textured parts show. */
export interface MeshTexture {
  /** the file's name for it (its material's) */
  name: string;
  image: Uint8Array;
  mime: "image/png" | "image/jpeg";
  /** how wide it is in the model, in the file's units */
  size: number;
  /**
   * recoloured to this colour (0..255 channels), as SketchUp colorizes a material's texture: by
   * the difference between it and the image's average colour in hue, lightness and saturation
   * ("shift"), or with every pixel taking its hue and saturation ("tint")
   */
  colorize?: { color: [number, number, number]; by: "shift" | "tint" };
}

export interface MeshFile {
  parts: MeshPart[];
  /** what was left out, by kind (singular), with how many */
  skipped: Record<string, number>;
  /**
   * the units and up axis the file says it is in (millimetres per unit, and y up or z up), so the
   * import need not ask; left out when the file does not say (OBJ, 3DS, STL, PLY)
   */
  frame?: { mm: number; yUp: boolean };
  /**
   * 2D objects (a Rhino file's curves and text) in millimetres, flat in plan, each with what holds it as a
   * part's `group`. `points` sizes a text in points on paper instead (a Rhino text dot, which has no size in
   * the model), so the layer it comes in on scales it as it does its own text; its `height` is then the 1:1 size.
   */
  shapes?: { shape: NewShape; group?: string; color?: { r: number; g: number; b: number }; points?: number }[];
  /**
   * the model as a tree whose repeated parts are symbols (a SketchUp file's components), in the
   * file's units, z up; its `parts` are then empty
   */
  tree?: MeshTree;
  /** the images its parts' `texture` index */
  textures?: MeshTexture[];
  /** the tags the file hides, whose classes come in hidden */
  hiddenTags?: string[];
}

/** What one container holds in a MeshTree: its own faces, by tag and colour, its groups and the symbols it places. */
export interface MeshTreeNode {
  parts: MeshPart[];
  groups: MeshTreeGroup[];
  instances: MeshTreeInstance[];
  /** lines no face uses (a SketchUp file's loose edges and guides), each through its points, x, y, z triples */
  lines?: MeshLine[];
  /** points (a SketchUp file's guide points), each x, y, z */
  points?: { at: number[]; tag?: string }[];
  /** 2D objects (a Rhino file's curves and text), as MeshFile.shapes has them: in millimetres, whatever the tree's units */
  shapes?: NonNullable<MeshFile["shapes"]>;
}

export interface MeshLine {
  points: number[];
  closed: boolean;
  /** the tag it is on, the class it comes in */
  tag?: string;
}

export interface MeshTreeGroup extends MeshTreeNode {
  name: string;
  /** the tag it is on, the class it comes in */
  tag?: string;
}

export interface MeshTreeInstance {
  /** index into MeshTree.symbols */
  symbol: number;
  /** the images of the x, y and z axes, then where the symbol's origin goes, in the file's units */
  matrix: number[];
  name?: string;
  tag?: string;
}

/** A model whose repeated parts are symbols, each placing only ones before it. */
export interface MeshTree {
  symbols: { name: string; content: MeshTreeNode }[];
  top: MeshTreeNode;
}

/** How many faces a tree holds, each symbol's once. */
export function treeFaces(tree: MeshTree): number {
  const count = (n: MeshTreeNode): number => n.parts.reduce((k, p) => k + p.faces.length, 0) + n.groups.reduce((k, g) => k + count(g), 0);
  return tree.symbols.reduce((k, s) => k + count(s.content), count(tree.top));
}

/** How many lines, points and 2D objects a tree holds, each symbol's once. */
export function treeLines(tree: MeshTree): { lines: number; points: number; shapes: number } {
  const out = { lines: 0, points: 0, shapes: 0 };
  const count = (n: MeshTreeNode): void => {
    out.lines += n.lines?.length ?? 0;
    out.points += n.points?.length ?? 0;
    out.shapes += n.shapes?.length ?? 0;
    n.groups.forEach(count);
  };
  tree.symbols.forEach((s) => count(s.content));
  count(tree.top);
  return out;
}

/**
 * A tree's parts as a file without symbols gives them: each placed through the instances holding it
 * (its corners in reverse where a placement mirrors), and grouped by the top-level group holding it.
 */
export function unfoldTree(tree: MeshTree): MeshPart[] {
  const out: MeshPart[] = [];
  const walk = (n: MeshTreeNode, m: readonly number[] | null, group: string | undefined, depth: number): void => {
    const flip = m !== null && det3(m) < 0;
    for (const p of n.parts) {
      const faces = m ? p.faces.map((f) => placeCorners(f, m, flip)) : p.faces;
      out.push({ ...p, faces, ...(group !== undefined ? { group } : {}) });
    }
    for (const g of n.groups) walk(g, m, group ?? g.name, depth);
    for (const i of n.instances) {
      const s = tree.symbols[i.symbol];
      if (s && depth < tree.symbols.length) walk(s.content, m ? compose(m, i.matrix) : i.matrix, group, depth + 1);
    }
  };
  walk(tree.top, null, undefined, 0);
  return out;
}

/**
 * A tree's top level from what a reader found there, each item with what holds it in the file (`group`, as a
 * part's): a group for each holder, in the order they come, when there are two or more, else the items
 * themselves; items with no holder stay at the top.
 */
export function treeTop(parts: MeshPart[], instances: (MeshTreeInstance & { group?: string })[], shapes: NonNullable<MeshFile["shapes"]> = []): MeshTreeNode {
  const keys = new Set([...parts, ...instances, ...shapes].map((x) => x.group ?? ""));
  if (keys.size < 2) return { parts, groups: [], instances, ...(shapes.length ? { shapes } : {}) };
  const held = <T extends { group?: string }>(list: T[], name: string): T[] => list.filter((x) => (x.group ?? "") === name);
  const groups = [...keys]
    .filter((name) => name !== "")
    .map((name): MeshTreeGroup => {
      const mine = held(shapes, name);
      return { name, parts: held(parts, name), groups: [], instances: held(instances, name), ...(mine.length ? { shapes: mine } : {}) };
    });
  const loose = held(shapes, "");
  return { parts: held(parts, ""), groups, instances: held(instances, ""), ...(loose.length ? { shapes: loose } : {}) };
}

/** The determinant of a placement's axes (12 numbers: the images of x, y and z, then the offset). */
export function det3(m: readonly number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** a after b, both placements of 12 numbers: p -> a(b(p)). */
function compose(a: readonly number[], b: readonly number[]): number[] {
  const m = new Array<number>(12);
  for (let r = 0; r < 4; r++) {
    const [x, y, z] = [b[3 * r], b[3 * r + 1], b[3 * r + 2]];
    for (let k = 0; k < 3; k++) m[3 * r + k] = x * a[k] + y * a[3 + k] + z * a[6 + k] + (r === 3 ? a[9 + k] : 0);
  }
  return m;
}

/** A face's corners placed, in reverse order when `flip`. */
function placeCorners(f: readonly number[], m: readonly number[], flip: boolean): number[] {
  const n = f.length / 3;
  const out = new Array<number>(f.length);
  for (let i = 0; i < n; i++) {
    const j = 3 * (flip ? n - 1 - i : i);
    const [x, y, z] = [f[j], f[j + 1], f[j + 2]];
    out[3 * i] = x * m[0] + y * m[3] + z * m[6] + m[9];
    out[3 * i + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
    out[3 * i + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
  }
  return out;
}

/**
 * A row-major 4 × 4 (applied to column vectors, as Rhino, Collada and FBX keep them) as a tree
 * instance's 12 numbers: its columns, the images of x, y and z, then where the origin goes.
 */
export function placementOf(m: readonly number[]): number[] {
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10], m[3], m[7], m[11]];
}

/** The kinds `skipped` names whose plural isn't the kind with an "s" on the end. */
const PLURALS: Record<string, string> = {
  "curve or surface": "curves and surfaces",
  "surface without a render mesh": "surfaces without a render mesh",
  "texture image not in PNG or JPEG": "texture images not in PNG or JPEG",
  "texture image the browser couldn't open": "texture images the browser couldn't open",
  "endless guide line": "endless guide lines",
  "3D locus": "3D loci",
};

/** "3 lines", "1 curve or surface": a count of a kind `skipped` names. */
export function countOf(kind: string, n: number): string {
  return `${n.toLocaleString("en")} ${n === 1 ? kind : (PLURALS[kind] ?? `${kind}s`)}`;
}

/** The error a file with more than MAX_FACES faces is refused with. */
export function tooMany(): Error {
  return new Error(`it has more than ${MAX_FACES.toLocaleString("en")} faces, more than can come in at once`);
}

/** OBJ text: `v` vertices and `f` faces, a part for each `o` or `g` that has faces, coloured as its first corner when vertices carry colours. */
export function parseObj(text: string): MeshFile {
  const verts: number[] = [];
  // each vertex's colour, where its line gives one
  const colours: ({ r: number; g: number; b: number } | undefined)[] = [];
  const parts: MeshPart[] = [];
  const skipped: Record<string, number> = {};
  let part: MeshPart | null = null;
  let name = "";
  let faces = 0;
  const skip = (kind: string): void => {
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  };
  // a backslash at a line's end joins it to the next
  const lines = text.replace(/\\\r?\n/g, " ").split(/\r?\n|\r/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line[0] === "#") continue;
    const words = line.split(/\s+/);
    const head = words[0];
    if (head === "v") {
      const [x, y, z, r, g, b] = words.slice(1, 7).map(Number);
      verts.push(x, y, z);
      colours.push(words.length >= 7 && [r, g, b].every(Number.isFinite) ? { r: clamp01(r), g: clamp01(g), b: clamp01(b) } : undefined);
    } else if (head === "o" || head === "g") {
      name = words.slice(1).join(" ");
      part = null;
    } else if (head === "f") {
      const corners: number[] = [];
      let first = -1;
      let ok = true;
      for (const w of words.slice(1)) {
        const i = parseInt(w, 10);
        // 1-based, or back from the latest vertex when negative
        const at = i > 0 ? i - 1 : i < 0 ? verts.length / 3 + i : -1;
        if (!(at >= 0 && at < verts.length / 3)) {
          ok = false;
          break;
        }
        if (first < 0) first = at;
        corners.push(verts[3 * at], verts[3 * at + 1], verts[3 * at + 2]);
      }
      if (!ok || corners.length < 9 || !corners.every(Number.isFinite)) {
        skip("bad face");
        continue;
      }
      if (++faces > MAX_FACES) throw tooMany();
      if (!part) {
        const color = colours[first];
        part = { name, faces: [], ...(color ? { color } : {}) };
        parts.push(part);
      }
      part.faces.push(corners);
    } else if (head === "l") skip("line");
    else if (head === "p") skip("point");
    else if (head === "curv" || head === "surf") skip("curve or surface");
  }
  return { parts: mergeNamesakes(parts), skipped };
}

/** Parts of one name (a `g` line repeated for the same group) as one. */
function mergeNamesakes(parts: MeshPart[]): MeshPart[] {
  const byName = new Map<string, MeshPart>();
  const out: MeshPart[] = [];
  for (const p of parts) {
    const same = byName.get(p.name);
    if (same) same.faces.push(...p.faces);
    else {
      byName.set(p.name, p);
      out.push(p);
    }
  }
  return out;
}

// ---- glTF ------------------------------------------------------------------------

interface Gltf {
  asset?: { version?: string };
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[];
  extensionsRequired?: string[];
}

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  extras?: unknown;
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  mode?: number;
  material?: number;
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  sparse?: unknown;
}

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const COMPONENT_BYTES: Readonly<Record<number, number>> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TRIANGLES = 4;
const TRIANGLE_STRIP = 5;
const TRIANGLE_FAN = 6;
/** deepest node nesting followed */
const MAX_DEPTH = 64;

/** A .glb, or a .gltf whose buffers are data: URIs; more than `maxFaces` faces is refused. */
export function parseGltf(bytes: Uint8Array, maxFaces = MAX_FACES): MeshFile {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json: Gltf;
  let bin: Uint8Array | null = null;
  if (bytes.length >= 12 && dv.getUint32(0, true) === GLB_MAGIC) {
    if (dv.getUint32(4, true) !== 2) throw new Error("it is a glTF 1 file; only glTF 2 is read");
    let at = 12;
    let text: string | null = null;
    while (at + 8 <= bytes.length) {
      const length = dv.getUint32(at, true);
      const type = dv.getUint32(at + 4, true);
      const body = bytes.subarray(at + 8, at + 8 + length);
      if (type === CHUNK_JSON && text === null) text = new TextDecoder().decode(body);
      else if (type === CHUNK_BIN && !bin) bin = body;
      at += 8 + length;
    }
    if (text === null) throw new Error("the file has no glTF description");
    json = readJson(text);
  } else {
    json = readJson(new TextDecoder().decode(bytes));
  }
  if (!json || typeof json !== "object" || !json.asset) throw new Error("it isn't a glTF file");
  if (json.asset.version && !json.asset.version.startsWith("2")) throw new Error(`it is a glTF ${json.asset.version} file; only glTF 2 is read`);
  const needs = (json.extensionsRequired ?? []).filter((e) => e !== "KHR_materials_unlit" && e !== "KHR_texture_transform");
  if (needs.length) throw new Error(`it needs ${needs.join(", ")} (compressed or extended geometry), which isn't read yet`);

  const buffers = (json.buffers ?? []).map((b, i): Uint8Array => {
    if (b.uri === undefined) {
      if (i === 0 && bin) return bin;
      throw new Error("a buffer is missing");
    }
    const m = /^data:[^,]*;base64,(.*)$/s.exec(b.uri);
    if (!m) throw new Error("its geometry is in a separate file; export it as a single .glb");
    const s = atob(m[1]);
    const out = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k);
    return out;
  });

  /** an accessor's values as numbers, `size` per element */
  const read = (index: number, size: number): number[] | null => {
    const a = json.accessors?.[index];
    if (!a || a.sparse || a.bufferView === undefined) return null;
    const view = json.bufferViews?.[a.bufferView];
    const buf = view && buffers[view.buffer];
    const width = COMPONENT_BYTES[a.componentType];
    if (!view || !buf || !width) return null;
    const stride = view.byteStride || width * size;
    const base = buf.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const end = base - buf.byteOffset + stride * Math.max(0, a.count - 1) + width * size;
    if (end > buf.length) throw new Error("an accessor runs past its buffer");
    const d = new DataView(buf.buffer);
    const out = new Array<number>(a.count * size);
    for (let i = 0; i < a.count; i++) {
      for (let k = 0; k < size; k++) {
        const at = base + i * stride + k * width;
        out[i * size + k] =
          a.componentType === FLOAT
            ? d.getFloat32(at, true)
            : a.componentType === 5125
              ? d.getUint32(at, true)
              : a.componentType === 5123
                ? d.getUint16(at, true)
                : a.componentType === 5121
                  ? d.getUint8(at)
                  : a.componentType === 5122
                    ? d.getInt16(at, true)
                    : d.getInt8(at);
      }
    }
    return out;
  };

  const parts: MeshPart[] = [];
  const skipped: Record<string, number> = {};
  const skip = (kind: string): void => {
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  };
  let faces = 0;

  const place = (node: GltfNode, parent: number[], depth: number): void => {
    if (depth > MAX_DEPTH) return;
    const m = multiply(parent, localMatrix(node));
    const mesh = node.mesh !== undefined ? json.meshes?.[node.mesh] : undefined;
    if (mesh) {
      // a mirroring transform turns the faces over, so their corners go the other way round
      const flip = determinant(m) < 0;
      const byColour = new Map<string, MeshPart>();
      for (const prim of mesh.primitives ?? []) {
        const mode = prim.mode ?? TRIANGLES;
        if (mode !== TRIANGLES && mode !== TRIANGLE_STRIP && mode !== TRIANGLE_FAN) {
          skip(mode <= 0 ? "point primitive" : "line primitive");
          continue;
        }
        const pos = prim.attributes.POSITION;
        const acc = pos === undefined ? undefined : json.accessors?.[pos];
        if (!acc || acc.type !== "VEC3" || acc.componentType !== FLOAT) {
          skip("unreadable primitive");
          continue;
        }
        const p = read(pos, 3);
        if (!p) {
          skip("unreadable primitive");
          continue;
        }
        const idx = prim.indices !== undefined ? read(prim.indices, 1) : Array.from({ length: p.length / 3 }, (_, i) => i);
        if (!idx) {
          skip("unreadable primitive");
          continue;
        }
        const tris: number[] = [];
        if (mode === TRIANGLES) for (let i = 0; i + 2 < idx.length; i += 3) tris.push(idx[i], idx[i + 1], idx[i + 2]);
        else if (mode === TRIANGLE_STRIP) for (let i = 0; i + 2 < idx.length; i++) tris.push(...(i % 2 ? [idx[i + 1], idx[i], idx[i + 2]] : [idx[i], idx[i + 1], idx[i + 2]]));
        else for (let i = 1; i + 1 < idx.length; i++) tris.push(idx[0], idx[i], idx[i + 1]);
        const factor = prim.material !== undefined ? json.materials?.[prim.material]?.pbrMetallicRoughness?.baseColorFactor : undefined;
        const color = factor && factor.length >= 3 ? { r: clamp01(factor[0]), g: clamp01(factor[1]), b: clamp01(factor[2]) } : undefined;
        const key = color ? `${color.r},${color.g},${color.b}` : "";
        let part = byColour.get(key);
        if (!part) {
          part = { name: node.name || mesh.name || "", faces: [], ...(color ? { color } : {}), ...(node.extras !== undefined ? { extras: node.extras } : {}) };
          byColour.set(key, part);
        }
        const corner = (i: number): number[] => {
          const [x, y, z] = [p[3 * i], p[3 * i + 1], p[3 * i + 2]];
          return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]];
        };
        for (let t = 0; t + 2 < tris.length; t += 3) {
          const [a, b, c] = flip ? [tris[t], tris[t + 2], tris[t + 1]] : [tris[t], tris[t + 1], tris[t + 2]];
          if (a === b || b === c || a === c || Math.max(a, b, c) >= p.length / 3) continue;
          if (++faces > maxFaces) throw tooMany();
          part.faces.push([...corner(a), ...corner(b), ...corner(c)]);
        }
      }
      for (const part of byColour.values()) if (part.faces.length) parts.push(part);
    }
    for (const c of node.children ?? []) {
      const child = json.nodes?.[c];
      if (child) place(child, m, depth + 1);
    }
  };

  const scene = json.scenes?.[json.scene ?? 0];
  // the scene's root nodes, or, with no scene, every node no other node holds
  const held = new Set((json.nodes ?? []).flatMap((n) => n.children ?? []));
  const roots = scene?.nodes ?? (json.nodes ?? []).map((_, i) => i).filter((i) => !held.has(i));
  for (const i of roots) {
    const node = json.nodes?.[i];
    if (node) place(node, IDENTITY, 0);
  }
  return { parts, skipped };
}

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function readJson(text: string): Gltf {
  try {
    return JSON.parse(text) as Gltf;
  } catch {
    throw new Error("it isn't a glTF file");
  }
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** A node's own transform, column-major as glTF keeps it. */
function localMatrix(n: GltfNode): number[] {
  if (n.matrix?.length === 16 && n.matrix.every(Number.isFinite)) return n.matrix;
  const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

/** a · b, both column-major 4 × 4 */
function multiply(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[4 * c + r] = a[r] * b[4 * c] + a[4 + r] * b[4 * c + 1] + a[8 + r] * b[4 * c + 2] + a[12 + r] * b[4 * c + 3];
  return out;
}

/** the determinant of the 3 × 3 part */
function determinant(m: number[]): number {
  return m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);
}

// ---- 3DS ----------------------------------------------------------------------------

const MAIN = 0x4d4d;
const EDITOR = 0x3d3d;
const MATERIAL = 0xafff;
const MAT_NAME = 0xa000;
const MAT_DIFFUSE = 0xa020;
const COLOR_F = 0x0010;
const COLOR_24 = 0x0011;
const COLOR_24_GAMMA = 0x0012;
const COLOR_F_GAMMA = 0x0013;
const OBJECT = 0x4000;
const TRIMESH = 0x4100;
const VERTICES = 0x4110;
const FACES = 0x4120;
const FACE_MATERIAL = 0x4130;

/** A 3D Studio file: each object's triangle mesh (its vertices are already placed), a part per material it uses. */
export function parse3ds(bytes: Uint8Array): MeshFile {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6 || dv.getUint16(0, true) !== MAIN) throw new Error("it isn't a 3DS file");
  /** the chunks from `start` to `end`: id, where the body starts and where the chunk ends */
  const chunks = (start: number, end: number): { id: number; body: number; end: number }[] => {
    const out: { id: number; body: number; end: number }[] = [];
    let at = start;
    while (at + 6 <= end) {
      const id = dv.getUint16(at, true);
      const length = dv.getUint32(at + 2, true);
      if (length < 6 || at + length > end) break;
      out.push({ id, body: at + 6, end: at + length });
      at += length;
    }
    return out;
  };
  const cstring = (at: number, end: number): { text: string; next: number } => {
    let z = at;
    while (z < end && bytes[z] !== 0) z++;
    return { text: new TextDecoder("latin1").decode(bytes.subarray(at, z)), next: Math.min(z + 1, end) };
  };
  const top = chunks(0, Math.min(bytes.length, dv.getUint32(2, true)))[0];
  if (!top) throw new Error("it isn't a 3DS file");
  const editor = chunks(top.body, top.end).find((c) => c.id === EDITOR);
  const parts: MeshPart[] = [];
  const skipped: Record<string, number> = {};
  if (!editor) return { parts, skipped };

  const colours = new Map<string, { r: number; g: number; b: number }>();
  const inEditor = chunks(editor.body, editor.end);
  for (const m of inEditor.filter((c) => c.id === MATERIAL)) {
    let name = "";
    let colour: { r: number; g: number; b: number } | undefined;
    for (const c of chunks(m.body, m.end)) {
      if (c.id === MAT_NAME) name = cstring(c.body, c.end).text;
      else if (c.id === MAT_DIFFUSE) {
        for (const v of chunks(c.body, c.end)) {
          if ((v.id === COLOR_24 || v.id === COLOR_24_GAMMA) && v.end - v.body >= 3 && !colour) colour = { r: bytes[v.body] / 255, g: bytes[v.body + 1] / 255, b: bytes[v.body + 2] / 255 };
          else if ((v.id === COLOR_F || v.id === COLOR_F_GAMMA) && v.end - v.body >= 12 && !colour) {
            colour = { r: clamp01(dv.getFloat32(v.body, true)), g: clamp01(dv.getFloat32(v.body + 4, true)), b: clamp01(dv.getFloat32(v.body + 8, true)) };
          }
        }
      }
    }
    if (colour) colours.set(name, colour);
  }

  let faces = 0;
  for (const o of inEditor.filter((c) => c.id === OBJECT)) {
    const { text: name, next } = cstring(o.body, o.end);
    for (const mesh of chunks(next, o.end).filter((c) => c.id === TRIMESH)) {
      const inMesh = chunks(mesh.body, mesh.end);
      const vc = inMesh.find((c) => c.id === VERTICES);
      const fc = inMesh.find((c) => c.id === FACES);
      if (!vc || !fc || vc.end - vc.body < 2 || fc.end - fc.body < 2) continue;
      const nv = Math.min(dv.getUint16(vc.body, true), Math.floor((vc.end - vc.body - 2) / 12));
      const p = new Float64Array(3 * nv);
      for (let i = 0; i < 3 * nv; i++) p[i] = dv.getFloat32(vc.body + 2 + 4 * i, true);
      const nf = Math.min(dv.getUint16(fc.body, true), Math.floor((fc.end - fc.body - 2) / 8));
      // each face's material, where a material group names it
      const material = new Array<string | undefined>(nf);
      for (const g of chunks(fc.body + 2 + 8 * nf, fc.end).filter((c) => c.id === FACE_MATERIAL)) {
        const { text, next: at } = cstring(g.body, g.end);
        if (at + 2 > g.end) continue;
        const n = Math.min(dv.getUint16(at, true), Math.floor((g.end - at - 2) / 2));
        for (let k = 0; k < n; k++) {
          const f = dv.getUint16(at + 2 + 2 * k, true);
          if (f < nf) material[f] = text;
        }
      }
      const byMaterial = new Map<string, MeshPart>();
      for (let f = 0; f < nf; f++) {
        const at = fc.body + 2 + 8 * f;
        const [a, b, c] = [dv.getUint16(at, true), dv.getUint16(at + 2, true), dv.getUint16(at + 4, true)];
        if (a >= nv || b >= nv || c >= nv || a === b || b === c || a === c) {
          skipped["bad face"] = (skipped["bad face"] ?? 0) + 1;
          continue;
        }
        if (++faces > MAX_FACES) throw tooMany();
        const key = material[f] ?? "";
        let part = byMaterial.get(key);
        if (!part) {
          const color = colours.get(key);
          part = { name, faces: [], ...(color ? { color } : {}) };
          byMaterial.set(key, part);
        }
        part.faces.push([p[3 * a], p[3 * a + 1], p[3 * a + 2], p[3 * b], p[3 * b + 1], p[3 * b + 2], p[3 * c], p[3 * c + 1], p[3 * c + 2]]);
      }
      parts.push(...byMaterial.values());
    }
  }
  return { parts, skipped };
}

/** True when a face's corners are all apart. */
function apart(f: readonly number[]): boolean {
  const n = f.length / 3;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (f[3 * i] === f[3 * j] && f[3 * i + 1] === f[3 * j + 1] && f[3 * i + 2] === f[3 * j + 2]) return false;
    }
  }
  return true;
}

/**
 * An STL file, binary or ASCII: its triangles (an ASCII loop of more corners as one face), a part
 * per ASCII solid, the whole of a binary file one part, named after `name`. STL has no units or
 * colours; corners that meet make a "bad face", left out.
 */
export function parseStl(bytes: Uint8Array, name: string): MeshFile {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 84 ? dv.getUint32(80, true) : -1;
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 512)));
  const ascii = /^\s*solid\b/i.test(head) && /\bfacet\b|\bendsolid\b/i.test(new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.length, 4096))));
  // binary when the count fits the length (some binary writers begin their header "solid" too)
  const binary = count >= 0 && 84 + 50 * count === bytes.length ? true : ascii ? false : count >= 0 && 84 + 50 * count <= bytes.length;
  const skipped: Record<string, number> = {};
  const bad = (): void => void (skipped["bad face"] = (skipped["bad face"] ?? 0) + 1);
  if (binary) {
    if (count > MAX_FACES) throw tooMany();
    const part: MeshPart = { name, faces: [] };
    for (let f = 0, at = 84 + 12; f < count; f++, at += 50) {
      const face = new Array<number>(9);
      for (let k = 0; k < 9; k++) face[k] = dv.getFloat32(at + 4 * k, true);
      if (face.every(Number.isFinite) && apart(face)) part.faces.push(face);
      else bad();
    }
    return { parts: part.faces.length ? [part] : [], skipped };
  }
  if (!ascii) throw new Error("it isn't an STL file");
  const parts: MeshPart[] = [];
  let part: MeshPart | null = null;
  let loop: number[] | null = null;
  let faces = 0;
  for (const raw of new TextDecoder().decode(bytes).split(/\r?\n|\r/)) {
    const line = raw.trim();
    const word = line.slice(0, line.search(/\s|$/)).toLowerCase();
    if (word === "solid") {
      part = { name: line.slice(5).trim() || name, faces: [] };
      parts.push(part);
    } else if (word === "outer") loop = [];
    else if (word === "vertex" && loop) {
      const v = line.slice(6).trim().split(/\s+/).map(Number);
      if (v.length >= 3) loop.push(v[0], v[1], v[2]);
    } else if (word === "endloop" && loop) {
      if (!part) {
        part = { name, faces: [] };
        parts.push(part);
      }
      if (loop.length >= 9 && loop.every(Number.isFinite) && apart(loop)) {
        if (++faces > MAX_FACES) throw tooMany();
        part.faces.push(loop);
      } else bad();
      loop = null;
    } else if (word === "endsolid") part = null;
  }
  return { parts: parts.filter((p) => p.faces.length > 0), skipped };
}
