// FBX export, the writing side (no DOM): a binary FBX 7.4 file that Blender, 3ds Max, Maya, Revit,
// SketchUp, Unity and Unreal read. It is y up in centimetres (UnitScaleFactor 1), so the drawing's
// millimetres, z up, become x, z, -y over 10. Each design layer is a Null model; under it, a Mesh model
// per object, whose triangles are one Geometry with its vertices shared by position and its polygons
// given a material each. A symbol's objects are Geometries made once, named after the symbol: each
// instance is a model placed by its translation, rotation and scale that shares them, a Mesh model
// when the symbol is one object, else a Null holding a Mesh model for each object and the instances
// in it. An instance its scale can't say (one sheared) has its faces written as an object's are. A
// Phong material (diffuse colour, opacity) is made for each distinct colour and
// opacity and connected to every model that uses it. Textures, normals, UVs, edges and animation are not
// written. The records and the footer follow Blender's own binary writer, with arrays stored raw, the
// times in UTC, and the file id derived from the time, so the same drawing at the same time gives the
// same bytes.

import { bakeSymbol, type Model3D, type ModelObject } from "./scene3d.ts";

/** A property of a record, typed for the binary writer. */
type Prop =
  | { t: "I"; v: number }
  | { t: "L"; v: bigint }
  | { t: "D"; v: number }
  | { t: "C"; v: boolean }
  | { t: "S" | "R"; v: Uint8Array }
  | { t: "d"; v: Float64Array }
  | { t: "i"; v: Int32Array };

/** A record: its name, its properties and the records inside it; `size` and `plen` are set by `layout`. */
interface Rec {
  /** the name, as bytes */
  name: Uint8Array;
  /** its properties, in order */
  props: Prop[];
  /** the records inside it, in order */
  children: Rec[];
  /** its whole length in bytes, from its end offset back to its start, including the null records that follow it */
  size: number;
  /** the length of its properties in bytes */
  plen: number;
}

/** A mesh as the writer takes it, in centimetres and y up. */
interface Mesh {
  /** the vertices' x, y, z, shared by position */
  verts: Float64Array;
  /** each triangle's corner indices, the last of each as ~i */
  polys: Int32Array;
  /** each triangle's material, an index into `materials` */
  matOf: Int32Array;
  /** the object's materials, in the order `matOf` indexes them */
  materials: Material[];
}

/** A colour and opacity as a material. */
interface Material {
  /** the key that tells the same colour and opacity apart: "rrggbb/opacity" */
  key: string;
  /** "#rrggbb" in lower case */
  colour: string;
  /** 0..1 */
  opacity: number;
}

/** the bytes of a null record, which ends a list of records */
const NULL = 13;
const FILE_VERSION = 7400;
const enc = new TextEncoder();
const MAGIC = [...enc.encode("Kaydara FBX Binary"), 0x20, 0x20, 0x00, 0x1a, 0x00];
const FOOTER_ID = [0xfa, 0xbc, 0xab, 0x09, 0xd0, 0xc8, 0xd4, 0x66, 0xb1, 0x76, 0xfb, 0x83, 0x1c, 0xf7, 0x26, 0x7e];
const FOOTER_MAGIC = [0xf8, 0x5a, 0x8c, 0x6a, 0xde, 0xf5, 0xd9, 0x7e, 0xec, 0xe9, 0x0c, 0xe3, 0x75, 0x8f, 0x29, 0x0b];

const int = (v: number): Prop => ({ t: "I", v });
const long = (v: number | bigint): Prop => ({ t: "L", v: BigInt(v) });
const dbl = (v: number): Prop => ({ t: "D", v });
const flag = (v: boolean): Prop => ({ t: "C", v });
const str = (v: string): Prop => ({ t: "S", v: enc.encode(v) });
const raw = (v: Uint8Array): Prop => ({ t: "R", v });
const dbls = (v: Float64Array): Prop => ({ t: "d", v });
const ints = (v: Int32Array): Prop => ({ t: "i", v });

function rec(name: string, props: Prop[] = [], children: Rec[] = []): Rec {
  return { name: enc.encode(name), props, children, size: 0, plen: 0 };
}

/** A Properties70 entry: its name, type, label and flags, then its values. */
function entry(name: string, type: string, label: string, flags: string, values: Prop[]): Rec {
  return rec("P", [str(name), str(type), str(label), str(flags), ...values]);
}

/** The bytes a property takes, its type code included. */
function propSize(p: Prop): number {
  switch (p.t) {
    case "I":
      return 5;
    case "L":
    case "D":
      return 9;
    case "C":
      return 2;
    case "S":
    case "R":
      return 5 + p.v.length;
    case "d":
      return 13 + 8 * p.v.length;
    case "i":
      return 13 + 4 * p.v.length;
  }
}

/** Writes a property at `at`, returning where the next one starts. */
function writeProp(dv: DataView, out: Uint8Array, at: number, p: Prop): number {
  out[at] = p.t.charCodeAt(0);
  const q = at + 1;
  switch (p.t) {
    case "I":
      dv.setInt32(q, p.v, true);
      return q + 4;
    case "L":
      dv.setBigInt64(q, p.v, true);
      return q + 8;
    case "D":
      dv.setFloat64(q, p.v, true);
      return q + 8;
    case "C":
      out[q] = p.v ? 1 : 0;
      return q + 1;
    case "S":
    case "R":
      dv.setUint32(q, p.v.length, true);
      out.set(p.v, q + 4);
      return q + 4 + p.v.length;
    case "d":
    case "i": {
      // an array: its length, its encoding (0, raw), the bytes that follow, then them
      const n = p.v.length;
      const bytes = p.t === "d" ? 8 * n : 4 * n;
      dv.setUint32(q, n, true);
      dv.setUint32(q + 4, 0, true);
      dv.setUint32(q + 8, bytes, true);
      for (let k = 0; k < n; k++) {
        if (p.t === "d") dv.setFloat64(q + 12 + 8 * k, p.v[k], true);
        else dv.setInt32(q + 12 + 4 * k, p.v[k], true);
      }
      return q + 12 + bytes;
    }
  }
}

/**
 * Sizes a record and those inside it, as Blender's writer lays them out: a record with children is
 * followed by a null record; one with no properties and no children is too, unless it is the last
 * of its list. The size is the record's whole length, so the next sibling starts after it.
 */
function layout(r: Rec, last: boolean): number {
  let plen = 0;
  for (const p of r.props) plen += propSize(p);
  let size = 13 + r.name.length + plen;
  r.plen = plen;
  if (r.children.length) {
    for (let i = 0; i < r.children.length; i++) size += layout(r.children[i], i === r.children.length - 1);
    size += NULL;
  } else if (r.props.length === 0 && !last) size += NULL;
  r.size = size;
  return size;
}

function writeRec(dv: DataView, out: Uint8Array, at: number, r: Rec): void {
  dv.setUint32(at, at + r.size, true);
  dv.setUint32(at + 4, r.props.length, true);
  dv.setUint32(at + 8, r.plen, true);
  out[at + 12] = r.name.length;
  out.set(r.name, at + 13);
  let p = at + 13 + r.name.length;
  for (const pr of r.props) p = writeProp(dv, out, p, pr);
  // the children follow; the null record after them is zeros already
  let q = p;
  for (const c of r.children) {
    writeRec(dv, out, q, c);
    q += c.size;
  }
}

/** "#rrggbb" as three 0..1 channels; grey when it is not a colour. */
function rgbOf(colour: string): [number, number, number] {
  const n = parseInt(colour.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** A piece's colour and opacity as a material, the colour as "#rrggbb" in lower case. */
function materialOf(color: string, opacity: number): Material {
  const hex = /^#?([0-9a-f]{6})/i.exec(color)?.[1]?.toLowerCase() ?? "cccccc";
  const o = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  return { key: `${hex}/${o}`, colour: `#${hex}`, opacity: o };
}

/** A name readers accept: no control characters (a NUL separates the name from its class), else the fallback. */
function cleanName(s: string, fallback: string): string {
  return s.replace(/[\u0000-\u001f]/g, " ").trim() || fallback;
}

/**
 * An object's triangles as one mesh: vertices shared by position (in centimetres, y up), each
 * triangle's corners as ~i for its last. Degenerate triangles are dropped; null when none is left.
 */
function meshOf(obj: Pick<ModelObject, "pieces">): Mesh | null {
  const verts: number[] = [];
  const index = new Map<string, number>();
  const polys: number[] = [];
  const matOf: number[] = [];
  const materials: Material[] = [];
  const local = new Map<string, number>();
  for (const piece of obj.pieces) {
    const t = piece.triangles;
    if (t.length < 9) continue;
    const m = materialOf(piece.color, piece.opacity);
    let at = local.get(m.key);
    if (at === undefined) {
      at = materials.length;
      materials.push(m);
      local.set(m.key, at);
    }
    for (let i = 0; i + 8 < t.length; i += 9) {
      const corner = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const o = i + 3 * k;
        // z up, mm to y up, cm: (x, y, z) becomes (x, z, -y) / 10
        // (0 - v) rather than -v, so a zero is written as +0
        const x = t[o] / 10;
        const y = t[o + 2] / 10;
        const z = (0 - t[o + 1]) / 10;
        const key = `${x},${y},${z}`;
        let v = index.get(key);
        if (v === undefined) {
          v = index.size;
          index.set(key, v);
          verts.push(x, y, z);
        }
        corner[k] = v;
      }
      if (corner[0] === corner[1] || corner[1] === corner[2] || corner[0] === corner[2]) continue;
      polys.push(corner[0], corner[1], ~corner[2]);
      matOf.push(at);
    }
  }
  if (!polys.length) return null;
  return { verts: Float64Array.from(verts), polys: Int32Array.from(polys), matOf: Int32Array.from(matOf), materials };
}

/** Where a model sits in its parent: a translation (cm), XYZ Euler angles (degrees) and a scale. */
interface Trs {
  t: [number, number, number];
  r: [number, number, number];
  s: [number, number, number];
}

const NO_MOVE: Trs = { t: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] };

/**
 * A placement's 12 numbers (the images of the drawing's axes, then where the origin goes, mm, z up)
 * as FBX's T · R · S in its y-up centimetres, R turning x, then y, then z; null when it shears or
 * squashes an axis flat, which no scale says.
 */
function trsOf(m: readonly number[]): Trs | null {
  // z up to y up turns (x, y, z) into (x, z, -y): the axes' images and the offset turned so, as columns
  const turn = (v: readonly number[]): [number, number, number] => [v[0], v[2], 0 - v[1]];
  const ex = turn(m.slice(0, 3));
  const ey = turn(m.slice(3, 6));
  const ez = turn(m.slice(6, 9));
  // in y-up numbers the drawing's x, y and z axes are FBX's x, -z and y: its own axes' images
  const cols = [ex, ez, [0 - ey[0], 0 - ey[1], 0 - ey[2]]];
  const len = cols.map((c) => Math.hypot(c[0], c[1], c[2]));
  if (len.some((l) => !(l > 1e-12))) return null;
  const unit = cols.map((c, i) => c.map((v) => v / len[i]));
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (Math.abs(dot(unit[0], unit[1])) > 1e-6 || Math.abs(dot(unit[0], unit[2])) > 1e-6 || Math.abs(dot(unit[1], unit[2])) > 1e-6) return null;
  // a mirror is a negative scale on z, which leaves a rotation
  const [a, b, c] = unit;
  const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
  if (det < 0) {
    len[2] = -len[2];
    unit[2] = unit[2].map((v) => 0 - v);
  }
  // R = Rz · Ry · Rx, its columns the unit images; R[row][col] = unit[col][row]
  const R = (row: number, col: number): number => unit[col][row];
  const deg = 180 / Math.PI;
  const sy = Math.max(-1, Math.min(1, -R(2, 0)));
  const y = Math.asin(sy);
  let x: number;
  let z: number;
  if (Math.abs(sy) < 1 - 1e-9) {
    x = Math.atan2(R(2, 1), R(2, 2));
    z = Math.atan2(R(1, 0), R(0, 0));
  } else {
    // straight up or down: the turns about x and z are one, all given to x
    x = Math.atan2(-R(1, 2), R(1, 1));
    z = 0;
  }
  const t = turn(m.slice(9, 12));
  return { t: [t[0] / 10, t[1] / 10, t[2] / 10], r: [x * deg, y * deg, z * deg], s: [len[0], len[1], len[2]] };
}

/** A Model: a Null for a layer, a group or a symbol's instance, a Mesh for an object; placed by `at` in its parent. */
function modelRec(id: bigint, name: string, kind: "Null" | "Mesh", at: Trs = NO_MOVE): Rec {
  return rec("Model", [long(id), str(`${name}\u0000\u0001Model`), str(kind)], [
    rec("Version", [int(232)]),
    rec("Properties70", [], [
      entry("Lcl Translation", "Lcl Translation", "", "A", at.t.map(dbl)),
      entry("Lcl Rotation", "Lcl Rotation", "", "A", at.r.map(dbl)),
      entry("Lcl Scaling", "Lcl Scaling", "", "A", at.s.map(dbl)),
      entry("Visibility", "Visibility", "", "A", [dbl(1)]),
      entry("InheritType", "enum", "", "", [int(1)]),
    ]),
    rec("MultiLayer", [int(0)]),
    rec("MultiTake", [int(0)]),
    rec("Shading", [flag(true)]),
    rec("Culling", [str("CullingOff")]),
  ]);
}

/** A Geometry: its vertices and polygons, and a material index for each polygon. */
function geometryRec(id: bigint, name: string, mesh: Mesh): Rec {
  return rec("Geometry", [long(id), str(`${name}\u0000\u0001Geometry`), str("Mesh")], [
    rec("GeometryVersion", [int(124)]),
    rec("Vertices", [dbls(mesh.verts)]),
    rec("PolygonVertexIndex", [ints(mesh.polys)]),
    rec("LayerElementMaterial", [int(0)], [
      rec("Version", [int(101)]),
      rec("Name", [str("")]),
      rec("MappingInformationType", [str("ByPolygon")]),
      rec("ReferenceInformationType", [str("IndexToDirect")]),
      rec("Materials", [ints(mesh.matOf)]),
    ]),
    rec("Layer", [int(0)], [
      rec("Version", [int(100)]),
      rec("LayerElement", [], [rec("Type", [str("LayerElementMaterial")]), rec("TypedIndex", [int(0)])]),
    ]),
  ]);
}

/** A Phong material: its diffuse colour, its opacity and the transparency that is left. */
function materialRec(id: bigint, name: string, m: Material): Rec {
  const [r, g, b] = rgbOf(m.colour);
  return rec("Material", [long(id), str(`${name}\u0000\u0001Material`), str("")], [
    rec("Version", [int(102)]),
    rec("ShadingModel", [str("phong")]),
    rec("MultiLayer", [int(0)]),
    rec("Properties70", [], [
      entry("DiffuseColor", "Color", "", "A", [dbl(r), dbl(g), dbl(b)]),
      entry("Opacity", "double", "Number", "", [dbl(m.opacity)]),
      entry("TransparencyFactor", "double", "Number", "", [dbl(1 - m.opacity)]),
    ]),
  ]);
}

/** A connection: the child is connected to the parent (0 is the scene). */
function connect(child: bigint, parent: bigint): Rec {
  return rec("C", [str("OO"), long(child), long(parent)]);
}

/** Sixteen bytes of a file id, from the time it is written (a linear congruential generator). */
function fileIdOf(now: Date): Uint8Array {
  const out = new Uint8Array(16);
  let seed = (now.getTime() >>> 0) ^ 0x2545f491;
  for (let i = 0; i < 16; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out[i] = seed >>> 24;
  }
  return out;
}

/** The FBX file of a drawing's 3D model, stamped with `now` (UTC). */
export function exportFbx(model: Model3D, now = new Date()): Uint8Array {
  let last = 1000n;
  const id = (): bigint => {
    last += 1n;
    return last;
  };
  const objects: Rec[] = [];
  const conns: Rec[] = [];
  const materials = new Map<string, { id: bigint; m: Material }>();
  let nModels = 0;
  let nGeoms = 0;
  // a model's materials, connected in the order its material indexes count them
  const connectMaterials = (mesh: Mesh, modelId: bigint): void => {
    for (const m of mesh.materials) {
      let mat = materials.get(m.key);
      if (!mat) {
        mat = { id: id(), m };
        materials.set(m.key, mat);
      }
      conns.push(connect(mat.id, modelId));
    }
  };
  // a Mesh model under `parent` showing a Geometry
  const meshModel = (name: string, parent: bigint, geomId: bigint, mesh: Mesh, at?: Trs): void => {
    const modelId = id();
    objects.push(modelRec(modelId, name, "Mesh", at));
    nModels++;
    conns.push(connect(modelId, parent), connect(geomId, modelId));
    connectMaterials(mesh, modelId);
  };
  // the objects in groups under a null for each group, made the first time, under `root`
  const grouper = (root: bigint): ((obj: ModelObject) => bigint) => {
    const groups = new Map<string, bigint>();
    return (obj) => {
      let parent = root;
      for (const g of obj.groups ?? []) {
        let groupId = groups.get(g.id);
        if (groupId === undefined) {
          groupId = id();
          groups.set(g.id, groupId);
          objects.push(modelRec(groupId, cleanName(g.name, "Group"), "Null"));
          nModels++;
          conns.push(connect(groupId, parent));
        }
        parent = groupId;
      }
      return parent;
    };
  };
  // each symbol's objects as Geometries, named after it, made the first time an instance places it
  const shared = new Map<number, Map<ModelObject, { geomId: bigint; mesh: Mesh }>>();
  const geometriesOf = (k: number): Map<ModelObject, { geomId: bigint; mesh: Mesh }> => {
    let made = shared.get(k);
    if (!made) {
      made = new Map();
      const symbol = model.symbols![k];
      for (const obj of symbol.objects) {
        const mesh = obj.instance ? null : meshOf(obj);
        if (!mesh) continue;
        const geomId = id();
        objects.push(geometryRec(geomId, cleanName(symbol.name, "Symbol"), mesh));
        nGeoms++;
        made.set(obj, { geomId, mesh });
      }
      shared.set(k, made);
    }
    return made;
  };
  // an object under `parent`: its own Geometry, or the symbol it places sharing the symbol's
  const place = (obj: ModelObject, parent: bigint): void => {
    const name = cleanName(obj.name, "Object");
    const k = obj.instance?.symbol;
    const symbol = k === undefined ? undefined : model.symbols?.[k];
    const at = symbol ? trsOf(obj.instance!.matrix) : null;
    if (k !== undefined && symbol && at) {
      const geometries = geometriesOf(k);
      const only = symbol.objects.length === 1 ? geometries.get(symbol.objects[0]) : undefined;
      if (only) return meshModel(name, parent, only.geomId, only.mesh, at);
      const nullId = id();
      objects.push(modelRec(nullId, name, "Null", at));
      nModels++;
      conns.push(connect(nullId, parent));
      const parentOf = grouper(nullId);
      for (const o of symbol.objects) {
        const g = geometries.get(o);
        if (g) meshModel(cleanName(o.name, "Object"), parentOf(o), g.geomId, g.mesh);
        else if (o.instance) place(o, parentOf(o));
      }
      return;
    }
    // an object's own faces, or an instance's that no translation, rotation and scale place
    const mesh = meshOf(k !== undefined && symbol ? { pieces: bakeSymbol(model, k, obj.instance!.matrix) } : obj);
    if (!mesh) return;
    const geomId = id();
    objects.push(geometryRec(geomId, name, mesh));
    nGeoms++;
    meshModel(name, parent, geomId, mesh);
  };
  for (const layer of model.layers) {
    const layerId = id();
    objects.push(modelRec(layerId, cleanName(layer.name, "Layer"), "Null"));
    nModels++;
    conns.push(connect(layerId, 0n));
    const parentOf = grouper(layerId);
    for (const obj of layer.objects) place(obj, parentOf(obj));
  }
  for (const { id: matId, m } of materials.values()) {
    const pct = m.opacity < 1 ? ` ${Math.round(m.opacity * 100)}%` : "";
    objects.push(materialRec(matId, `${m.colour}${pct}`, m));
  }
  const docId = id();
  const nMats = materials.size;
  const stamp = {
    y: now.getUTCFullYear(),
    mo: now.getUTCMonth() + 1,
    d: now.getUTCDate(),
    h: now.getUTCHours(),
    mi: now.getUTCMinutes(),
    s: now.getUTCSeconds(),
    ms: now.getUTCMilliseconds(),
  };
  const p2 = (n: number): string => String(n).padStart(2, "0");
  const timeText = `${stamp.y}-${p2(stamp.mo)}-${p2(stamp.d)} ${p2(stamp.h)}:${p2(stamp.mi)}:${p2(stamp.s)}:${String(stamp.ms).padStart(3, "0")}`;

  const definitions: Rec[] = [rec("ObjectType", [str("GlobalSettings")], [rec("Count", [int(1)])])];
  if (nModels) {
    definitions.push(
      rec("ObjectType", [str("Model")], [
        rec("Count", [int(nModels)]),
        rec("PropertyTemplate", [str("FbxNode")], [
          rec("Properties70", [], [
            entry("Lcl Translation", "Lcl Translation", "", "A", [dbl(0), dbl(0), dbl(0)]),
            entry("Lcl Rotation", "Lcl Rotation", "", "A", [dbl(0), dbl(0), dbl(0)]),
            entry("Lcl Scaling", "Lcl Scaling", "", "A", [dbl(1), dbl(1), dbl(1)]),
          ]),
        ]),
      ]),
    );
  }
  if (nGeoms) {
    definitions.push(
      rec("ObjectType", [str("Geometry")], [
        rec("Count", [int(nGeoms)]),
        rec("PropertyTemplate", [str("FbxMesh")], [rec("Properties70", [], [entry("Color", "ColorRGB", "Color", "", [dbl(0.8), dbl(0.8), dbl(0.8)])])]),
      ]),
    );
  }
  if (nMats) {
    definitions.push(
      rec("ObjectType", [str("Material")], [
        rec("Count", [int(nMats)]),
        rec("PropertyTemplate", [str("FbxSurfacePhong")], [
          rec("Properties70", [], [
            entry("DiffuseColor", "Color", "", "A", [dbl(0.8), dbl(0.8), dbl(0.8)]),
            entry("Opacity", "double", "Number", "", [dbl(1)]),
            entry("TransparencyFactor", "double", "Number", "", [dbl(0)]),
          ]),
        ]),
      ]),
    );
  }

  const top: Rec[] = [
    rec("FBXHeaderExtension", [], [
      rec("FBXHeaderVersion", [int(1003)]),
      rec("FBXVersion", [int(FILE_VERSION)]),
      rec("CreationTimeStamp", [], [
        rec("Version", [int(1000)]),
        rec("Year", [int(stamp.y)]),
        rec("Month", [int(stamp.mo)]),
        rec("Day", [int(stamp.d)]),
        rec("Hour", [int(stamp.h)]),
        rec("Minute", [int(stamp.mi)]),
        rec("Second", [int(stamp.s)]),
        rec("Millisecond", [int(stamp.ms)]),
      ]),
      rec("Creator", [str("Rodeo")]),
    ]),
    rec("FileId", [raw(fileIdOf(now))]),
    rec("CreationTime", [str(timeText)]),
    rec("Creator", [str("Rodeo")]),
    rec("GlobalSettings", [], [
      rec("Version", [int(1000)]),
      rec("Properties70", [], [
        entry("UpAxis", "int", "Integer", "", [int(1)]),
        entry("UpAxisSign", "int", "Integer", "", [int(1)]),
        entry("FrontAxis", "int", "Integer", "", [int(2)]),
        entry("FrontAxisSign", "int", "Integer", "", [int(1)]),
        entry("CoordAxis", "int", "Integer", "", [int(0)]),
        entry("CoordAxisSign", "int", "Integer", "", [int(1)]),
        entry("OriginalUpAxis", "int", "Integer", "", [int(2)]),
        entry("OriginalUpAxisSign", "int", "Integer", "", [int(1)]),
        entry("UnitScaleFactor", "double", "Number", "", [dbl(1)]),
        entry("OriginalUnitScaleFactor", "double", "Number", "", [dbl(1)]),
        entry("AmbientColor", "ColorRGB", "Color", "", [dbl(0), dbl(0), dbl(0)]),
        entry("TimeMode", "enum", "", "", [int(11)]),
        entry("TimeSpanStart", "KTime", "Time", "", [long(0)]),
        entry("TimeSpanStop", "KTime", "Time", "", [long(0)]),
        entry("CustomFrameRate", "double", "Number", "", [dbl(24)]),
      ]),
    ]),
    rec("Documents", [], [rec("Count", [int(1)]), rec("Document", [long(docId), str("Scene"), str("Scene")], [rec("RootNode", [long(0)])])]),
    rec("References"),
    rec("Definitions", [], [rec("Version", [int(100)]), rec("Count", [int(1 + nModels + nGeoms + nMats)]), ...definitions]),
    rec("Objects", [], objects),
    rec("Connections", [], conns),
    rec("Takes", [], [rec("Current", [str("")])]),
  ];

  // size the whole file first: the header, the top level and its null record, then the footer
  let body = 27;
  for (let i = 0; i < top.length; i++) body += layout(top[i], i === top.length - 1);
  const footId = body + NULL;
  const ofs = footId + FOOTER_ID.length + 4;
  let pad = ((ofs + 15) & ~15) - ofs;
  if (pad === 0) pad = 16;
  const versionAt = ofs + pad;
  const total = versionAt + 4 + 120 + FOOTER_MAGIC.length;

  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  dv.setUint32(23, FILE_VERSION, true);
  let at = 27;
  for (const r of top) {
    writeRec(dv, out, at, r);
    at += r.size;
  }
  out.set(FOOTER_ID, footId);
  dv.setUint32(versionAt, FILE_VERSION, true);
  out.set(FOOTER_MAGIC, versionAt + 4 + 120);
  return out;
}
