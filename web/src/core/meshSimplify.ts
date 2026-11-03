// Modify > Simplify Mesh on the records: a mesh (40) rebuilt with fewer triangles (decimate.ts) in
// its place, keeping its own record (id, name, class, attributes and where it sits) and its aux
// records (data records, texture). Its vertices and faces are written afresh: each face a
// triangle, drawn as the face it was cut from (its class and attributes), without a face's own
// aux records. Faces drawn alike are simplified as one part, and where parts meet keeps its
// place. A mesh mapped by UV (a TeMe dictionary, FORMAT.md §7.1) keeps its map: every vertex left
// is one it had, with its own normal and (u, v), seams in the map moving only along themselves;
// each face's two values are those of the face it was cut from, and the vertex count the map notes
// (key 6's first value) is the new one. Its other values, two numbers of key 6 Rodeo doesn't know
// among them, stay as they were.

import { ATTR_END, BY_CLASS } from "./attrs.ts";
import { f64, i32, setF64, setI32, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";
import { simplifyMesh } from "./decimate.ts";
import { writeBBox } from "./encode.ts";
import { NEXT_MARK, Rec, newGuid } from "./records.ts";

const MESH_FACE = 41;
const AUX = 76;
const MESH_COUNT = 0xd0;
const MESH_VERTS = 0xd4;
const MESH_VERT_SIZE = 28;
/** the 4 bytes after each vertex's point, as every vertex of most of the demos' meshes has them */
const MESH_VERT_FLAGS = [0, 1, 0, 0];
const FACE_COUNT = 0xcc;
const FACE_CORNERS = 0xce;
/** 1 in most faces Vectorworks saves, whose plan and 3D boxes are then both left empty */
const FACE_UNBOXED = 0x8d;

// TDMD dictionaries: u16 count at +0x5a, u32 end at +0x5c, then (u16 key, u32 offset) from +0x60
const TDMD_TAG = 0x50;
const TDMD_KIND = 0x56;
const TDMD_COUNT = 0x5a;
const TDMD_END = 0x5c;
const TDMD_BASE = 0x60;
const TD_I32 = 8;
const TD_F64 = 6;
const SIZE: Record<number, number> = { [TD_I32]: 4, [TD_F64]: 8, 1: 1 };
/** a UV map's keys: a normal and a (u, v) per vertex, two values per face, the vertex count first of three */
const K_NORMAL = 1;
const K_UV = 2;
const K_FACE = 3;
const K_COUNTS = 6;

interface Entry {
  readonly key: number;
  readonly type: number;
  readonly count: number;
  /** where the first value starts */
  readonly at: number;
}

interface UvMap {
  readonly rec: Rec;
  readonly entries: readonly Entry[];
  readonly normals: Entry;
  readonly uvs: Entry;
  readonly perFace: Entry | null;
}

/** A mesh's vertices and its faces, as Simplify Mesh reads them; null when it can't be read whole. */
interface MeshRead {
  readonly points: Float64Array;
  readonly faces: readonly Rec[];
  /** each face's corners, vertex numbers from 0 */
  readonly corners: readonly number[][];
  readonly map: UvMap | null;
}

function entriesOf(d: Uint8Array): Entry[] | null {
  if (d.length < TDMD_BASE) return null;
  const out: Entry[] = [];
  for (let i = 0, n = u16(d, TDMD_COUNT); i < n; i++) {
    if (TDMD_BASE + 6 * i + 6 > d.length) return null;
    const at = TDMD_BASE + u32(d, TDMD_BASE + 6 * i + 2);
    if (at + 6 > d.length) return null;
    const type = u16(d, at);
    const count = u32(d, at + 2);
    if (!(type in SIZE) || at + 6 + SIZE[type] * count > d.length) return null;
    out.push({ key: u16(d, TDMD_BASE + 6 * i), type, count, at: at + 6 });
  }
  return out;
}

const kindOf = (d: Uint8Array): string => String.fromCharCode(...d.subarray(TDMD_TAG, TDMD_TAG + 4), ...d.subarray(TDMD_KIND, TDMD_KIND + 4));

function readMesh(r: Rec): MeshRead | "unread" | "uv" {
  const d = r.data;
  if (d.length < MESH_VERTS) return "unread";
  const n = u32(d, MESH_COUNT);
  if (MESH_VERTS + MESH_VERT_SIZE * n !== d.length) return "unread";
  const points = new Float64Array(3 * n);
  for (let v = 0; v < n; v++) for (let k = 0; k < 3; k++) points[3 * v + k] = f64(d, MESH_VERTS + MESH_VERT_SIZE * v + 8 * k);
  const faces = r.children.filter((c) => c.type === MESH_FACE);
  const corners: number[][] = [];
  for (const f of faces) {
    const k = f.data.length >= FACE_CORNERS ? u16(f.data, FACE_COUNT) : 0;
    if (FACE_CORNERS + 4 * k > f.data.length) return "unread";
    const vs: number[] = [];
    for (let i = 0; i < k; i++) {
      const v = u32(f.data, FACE_CORNERS + 4 * i) - 1;
      if (v < 0 || v >= n) return "unread";
      vs.push(v);
    }
    corners.push(vs);
  }
  let map: UvMap | null = null;
  const tdmd = r.children.find((c) => c.type === AUX && kindOf(c.data) === "TDMDeMeT");
  if (tdmd) {
    const entries = entriesOf(tdmd.data);
    const get = (key: number): Entry | null => entries?.find((e) => e.key === key) ?? null;
    const normals = get(K_NORMAL);
    const uvs = get(K_UV);
    const perFace = get(K_FACE);
    const counts = get(K_COUNTS);
    const fits =
      normals?.type === TD_F64 && normals.count === 3 * n &&
      uvs?.type === TD_F64 && uvs.count === 2 * n &&
      (!perFace || (perFace.type === TD_I32 && perFace.count === 2 * faces.length)) &&
      (!counts || (counts.type === TD_F64 && counts.count >= 1 && f64(tdmd.data, counts.at) === n));
    if (!entries || !normals || !uvs || !fits) return "uv";
    map = { rec: tdmd, entries, normals, uvs, perFace };
  }
  return { points, faces, corners, map };
}

/** How many triangles a mesh is drawn with: a face of k corners is k − 2. */
export function meshTriangleCount(r: Rec): number {
  let n = 0;
  for (const c of r.children) if (c.type === MESH_FACE && c.data.length >= FACE_CORNERS) n += Math.max(0, u16(c.data, FACE_COUNT) - 2);
  return n;
}

/** What Simplify Mesh makes of a mesh. */
export type MeshOutcome =
  | { readonly recs: Uint8Array[]; readonly before: number; readonly after: number }
  /** nothing to take away: as many triangles as it had */
  | { readonly same: number }
  /** a mesh Rodeo can't read whole, or whose UV map isn't as it knows them */
  | { readonly skipped: "unread" | "uv"; readonly triangles: number };

/**
 * Mesh `r` with about `keep` (0–1) of its triangles: its records afresh (the mesh and all it holds,
 * to take the place of its own), or why it stays. With `count`, only the numbers are worked out.
 */
export function simplifiedMesh(r: Rec, keep: number, count = false): MeshOutcome {
  const read = readMesh(r);
  if (typeof read === "string") return { skipped: read, triangles: meshTriangleCount(r) };
  const { points, faces, corners, map } = read;
  const n = points.length / 3;
  const mapData = map?.rec.data;
  // faces drawn alike are one part
  const looks = new Map<string, number>();
  const lookFace: number[] = [];
  const triangles: number[] = [];
  const parts: number[] = [];
  faces.forEach((f, i) => {
    const d = f.data;
    let key = `${u32(d, 0x20)}/${u16(d, BY_CLASS)}/${d.subarray(0x50, ATTR_END).join(",")}`;
    if (map?.perFace) key += `/${i32(mapData!, map.perFace.at + 8 * i)},${i32(mapData!, map.perFace.at + 8 * i + 4)}`;
    let part = looks.get(key);
    if (part === undefined) {
      part = lookFace.length;
      looks.set(key, part);
      lookFace.push(i);
    }
    // faces are convex: a fan from the first corner
    const vs = corners[i];
    for (let k = 1; k + 1 < vs.length; k++) {
      triangles.push(vs[0], vs[k], vs[k + 1]);
      parts.push(part);
    }
  });
  const before = parts.length;
  let carried: { values: Float64Array; size: number } | undefined;
  if (map && mapData) {
    // (u, v), then the normal: vertices at one place are one only with the same values
    const values = new Float64Array(5 * n);
    for (let v = 0; v < n; v++) {
      values[5 * v] = f64(mapData, map.uvs.at + 16 * v);
      values[5 * v + 1] = f64(mapData, map.uvs.at + 16 * v + 8);
      for (let k = 0; k < 3; k++) values[5 * v + 2 + k] = f64(mapData, map.normals.at + 24 * v + 8 * k);
    }
    carried = { values, size: 5 };
  }
  const s = simplifyMesh({ points, triangles, parts, ...(carried ? { carried } : {}) }, keep);
  const after = s.parts.length;
  if (after >= before || !after) return { same: before };
  if (count) return { recs: [], before, after };

  const m = s.points.length / 3;
  const head = new Uint8Array(MESH_VERTS + MESH_VERT_SIZE * m);
  head.set(r.data.subarray(0, MESH_VERTS));
  setU64(head, 0, BigInt(head.length));
  setU32(head, MESH_COUNT, m);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < m; v++) {
    for (let k = 0; k < 3; k++) {
      const x = s.points[3 * v + k];
      setF64(head, MESH_VERTS + MESH_VERT_SIZE * v + 8 * k, x);
      lo[k] = Math.min(lo[k], x);
      hi[k] = Math.max(hi[k], x);
    }
    head.set(MESH_VERT_FLAGS, MESH_VERTS + MESH_VERT_SIZE * v + 24);
  }
  writeBBox(head, { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] });
  [...hi, ...lo].forEach((v, i) => setF64(head, 0x9c + 8 * i, v));

  const newFaces = s.parts.map((part, t) => {
    const like = faces[lookFace[part]].data;
    const d = new Uint8Array(FACE_CORNERS + 4 * 3);
    d.set(like.subarray(0, FACE_CORNERS));
    setU64(d, 0, BigInt(d.length));
    setU64(d, 0x08, NEXT_MARK);
    setU64(d, 0x10, 0n);
    if (d.subarray(0x38, 0x48).some((b) => b !== 0)) new Rec(d).guid = newGuid();
    d[FACE_UNBOXED] = 1;
    [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE].forEach((v, i) => setF64(d, 0x68 + 8 * i, v));
    [-1, -1, -1, 1, 1, 1].forEach((v, i) => setF64(d, 0x9c + 8 * i, v * Number.MAX_VALUE));
    setU16(d, FACE_COUNT, 3);
    for (let k = 0; k < 3; k++) setU32(d, FACE_CORNERS + 4 * k, s.triangles[3 * t + k] + 1);
    return d;
  });

  const out: Uint8Array[] = [head];
  let placed = false;
  for (const c of r.children) {
    if (c.type === MESH_FACE) {
      if (!placed) out.push(...newFaces);
      placed = true;
      continue;
    }
    if (map && c === map.rec) {
      out.push(rewrittenMap(map, s.carried, m, s.parts.map((part) => lookFace[part])));
      continue;
    }
    for (const x of c.walk()) out.push(x.data.slice());
  }
  return { recs: out, before, after };
}

/** The UV map for the simplified mesh: `carried` (u, v, normal) per vertex, and each new face's values those of face `from`. */
function rewrittenMap(map: UvMap, carried: readonly number[], vertices: number, from: readonly number[]): Uint8Array {
  const old = map.rec.data;
  const values = map.entries.map((e): Uint8Array => {
    const raw = old.subarray(e.at - 6, e.at + SIZE[e.type] * e.count);
    let count = e.count;
    let fill: ((b: Uint8Array) => void) | null = null;
    if (e === map.normals) {
      count = 3 * vertices;
      fill = (b) => {
        for (let v = 0; v < vertices; v++) {
          const [x, y, z] = [carried[5 * v + 2], carried[5 * v + 3], carried[5 * v + 4]];
          const len = Math.hypot(x, y, z) || 1;
          [x, y, z].forEach((c, k) => setF64(b, 6 + 24 * v + 8 * k, c / len));
        }
      };
    } else if (e === map.uvs) {
      count = 2 * vertices;
      fill = (b) => {
        for (let v = 0; v < vertices; v++) for (let k = 0; k < 2; k++) setF64(b, 6 + 16 * v + 8 * k, carried[5 * v + k]);
      };
    } else if (e === map.perFace) {
      count = 2 * from.length;
      fill = (b) => from.forEach((f, i) => [0, 1].forEach((k) => setI32(b, 6 + 8 * i + 4 * k, i32(old, e.at + 8 * f + 4 * k))));
    } else if (e.key === K_COUNTS) {
      const b = raw.slice();
      setF64(b, 6, vertices);
      return b;
    }
    if (!fill) return raw.slice();
    const b = new Uint8Array(6 + SIZE[e.type] * count);
    setU16(b, 0, e.type);
    setU32(b, 2, count);
    fill(b);
    return b;
  });
  // the directory has a spare zero entry after the last; the values end 6 zero bytes before the record does
  const dir = 6 * (values.length + 1);
  const length = TDMD_BASE + dir + values.reduce((n, b) => n + b.length, 0) + 6;
  const d = new Uint8Array(length);
  d.set(old.subarray(0, TDMD_BASE));
  setU64(d, 0, BigInt(length));
  setU16(d, TDMD_COUNT, values.length);
  let off = dir;
  values.forEach((b, i) => {
    setU16(d, TDMD_BASE + 6 * i, map.entries[i].key);
    setU32(d, TDMD_BASE + 6 * i + 2, off);
    d.set(b, TDMD_BASE + off);
    off += b.length;
  });
  setU32(d, TDMD_END, off);
  return d;
}
