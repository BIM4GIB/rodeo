// The 3D model as a 3D Studio (.3ds) file, for older renderers and 3D packages that read nothing
// newer. 3DS is a tree of chunks, each a u16 id and a u32 length (its own six bytes included),
// little-endian. Each object becomes a triangle mesh in metres, z up as 3DS keeps it; one too big
// for the format's 65535 vertices is split across several. Names are cut to the 10 characters
// 3DS allows, so objects are numbered; each colour and opacity is a material.

import type { Mesh3D, VwxDocument } from "../core/types.ts";

const M_PER_MM = 0.001;
/** the most vertices (and faces) one 3DS mesh holds */
const MAX_VERTS = 65535;

const MAIN = 0x4d4d;
const VERSION = 0x0002;
const EDITOR = 0x3d3d;
const MESH_VERSION = 0x3d3e;
const MASTER_SCALE = 0x0100;
const MATERIAL = 0xafff;
const MAT_NAME = 0xa000;
const MAT_AMBIENT = 0xa010;
const MAT_DIFFUSE = 0xa020;
const MAT_TRANSPARENCY = 0xa050;
const COLOR_24 = 0x0011;
const PERCENT_INT = 0x0030;
const OBJECT = 0x4000;
const TRIMESH = 0x4100;
const VERTICES = 0x4110;
const FACES = 0x4120;
const FACE_MATERIAL = 0x4130;
const LOCAL_AXES = 0x4160;
/** all three edges of a face drawn */
const FACE_EDGES = 0x0007;

/** A chunk under construction: its body's bytes, written as parts. */
class Chunk {
  private readonly parts: Uint8Array[] = [];
  private size = 0;

  constructor(readonly id: number) {}

  bytes(b: Uint8Array): this {
    this.parts.push(b);
    this.size += b.length;
    return this;
  }

  u16(...v: number[]): this {
    return this.u16s(v);
  }

  u16s(v: readonly number[]): this {
    const b = new Uint8Array(2 * v.length);
    const dv = new DataView(b.buffer);
    v.forEach((n, i) => dv.setUint16(2 * i, n, true));
    return this.bytes(b);
  }

  u32(v: number): this {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, true);
    return this.bytes(b);
  }

  f32(...v: number[]): this {
    return this.f32s(v);
  }

  f32s(v: readonly number[]): this {
    const b = new Uint8Array(4 * v.length);
    const dv = new DataView(b.buffer);
    v.forEach((n, i) => dv.setFloat32(4 * i, n, true));
    return this.bytes(b);
  }

  /** A NUL-terminated name, ASCII only. */
  name(s: string): this {
    return this.bytes(new Uint8Array([...s].map((c) => (c.charCodeAt(0) < 128 ? c.charCodeAt(0) : 63)).concat(0)));
  }

  child(c: Chunk): this {
    return this.bytes(c.build());
  }

  build(): Uint8Array {
    const out = new Uint8Array(6 + this.size);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, this.id, true);
    dv.setUint32(2, out.length, true);
    let at = 6;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** One mesh's triangles as shared vertices and faces, in parts of at most MAX_VERTS vertices. */
function parts(m: Mesh3D): { verts: number[]; faces: number[] }[] {
  const out: { verts: number[]; faces: number[] }[] = [];
  let cur = { verts: [] as number[], faces: [] as number[] };
  let index = new Map<string, number>();
  const t = m.triangles;
  for (let i = 0; i < t.length; i += 9) {
    // start a new part when this face could take the vertex count past the limit
    if (index.size + 3 > MAX_VERTS || cur.faces.length / 3 + 1 > MAX_VERTS) {
      out.push(cur);
      cur = { verts: [], faces: [] };
      index = new Map();
    }
    const corner: number[] = [];
    for (let k = 0; k < 9; k += 3) {
      const x = t[i + k] * M_PER_MM;
      const y = t[i + k + 1] * M_PER_MM;
      const z = t[i + k + 2] * M_PER_MM;
      const key = `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
      let n = index.get(key);
      if (n === undefined) {
        n = index.size;
        index.set(key, n);
        cur.verts.push(x, y, z);
      }
      corner.push(n);
    }
    if (corner[0] !== corner[1] && corner[1] !== corner[2] && corner[0] !== corner[2]) cur.faces.push(...corner);
  }
  if (cur.faces.length) out.push(cur);
  return out.filter((p) => p.faces.length > 0);
}

/** The .3ds file of the meshes on `layerIds`. */
export function export3ds(doc: VwxDocument, layerIds: ReadonlySet<string>): Uint8Array {
  const editor = new Chunk(EDITOR).child(new Chunk(MESH_VERSION).u32(3)).child(new Chunk(MASTER_SCALE).f32(1));
  const materials = new Map<string, string>();
  const meshes = doc.model3d().filter((m) => layerIds.has(m.layerId) && m.triangles.length >= 9);
  for (const m of meshes) {
    const key = `${m.color}/${m.opacity}`;
    if (materials.has(key)) continue;
    const name = `MAT${materials.size + 1}`;
    materials.set(key, name);
    const n = parseInt(m.color.replace("#", "").slice(0, 6), 16) || 0;
    const rgb = (): Chunk => new Chunk(COLOR_24).bytes(new Uint8Array([(n >> 16) & 255, (n >> 8) & 255, n & 255]));
    editor.child(
      new Chunk(MATERIAL)
        .child(new Chunk(MAT_NAME).name(name))
        .child(new Chunk(MAT_AMBIENT).child(rgb()))
        .child(new Chunk(MAT_DIFFUSE).child(rgb()))
        .child(new Chunk(MAT_TRANSPARENCY).child(new Chunk(PERCENT_INT).u16(Math.round((1 - m.opacity) * 100)))),
    );
  }
  let count = 0;
  for (const m of meshes) {
    const material = materials.get(`${m.color}/${m.opacity}`)!;
    for (const p of parts(m)) {
      count++;
      const n = p.faces.length / 3;
      const list: number[] = [n];
      for (let i = 0; i < p.faces.length; i += 3) list.push(p.faces[i], p.faces[i + 1], p.faces[i + 2], FACE_EDGES);
      const faces = new Chunk(FACES).u16s(list);
      faces.child(new Chunk(FACE_MATERIAL).name(material).u16s([n, ...Array.from({ length: n }, (_, i) => i)]));
      const mesh = new Chunk(TRIMESH)
        .child(new Chunk(VERTICES).u16(p.verts.length / 3).f32s(p.verts))
        .child(faces)
        .child(new Chunk(LOCAL_AXES).f32(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0));
      editor.child(new Chunk(OBJECT).name(`OBJ${count.toString(36).toUpperCase()}`.slice(0, 10)).child(mesh));
    }
  }
  return new Chunk(MAIN).child(new Chunk(VERSION).u32(3)).child(editor).build();
}
