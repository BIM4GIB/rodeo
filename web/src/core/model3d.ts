// 3D geometry for the 3D view: design-layer objects as triangles and edges in
// world millimetres, z up. See Mesh3D in types.ts.
//
// Vectorworks keeps every solid (extrude 24, solid addition/subtraction 84,
// multiple extrude 38, sweep 34, generic solid 113 via its NURBS child 111,
// roof face 71, the bodies of walls and plug-in objects, ...) as a Parasolid
// body in a type-114 child. Next to the Parasolid transmit data the record
// holds the body's edges, already tessellated:
//   +0x5a  16 x (u16 id, u32 offset), offsets counted from +0x60; entry 0 is
//          (number of sections, end offset), unused entries have id 0xffff
//   section 0   points: 3 x f64 (x, y, z) each, in the owner's own frame for extrudes and
//               sweeps, in its parent's for multiple extrudes and solid additions
//   section 13  curves: 6-byte entries (u16 point count, u32 first point)
//   section 14  straight edges: same layout, two points each
//   section 19  the Parasolid transmit file (binary XT), not read here
// Faces are not cached, so they are rebuilt from the edges: every plane that
// two edges at a vertex span collects the edges lying in it, the planar graph
// of those edges gives its bounded faces, and nesting decides which are solid
// (even depth) and which are holes. Curved side faces come from pairs of
// curves that are translated copies of each other (extrusions). Faces whose
// boundary is not planar and not such a pair (spheres, free-form surfaces)
// show as edges only.
//
// Site models (the "DTM6" plug-in) cache only their bounding box as a body;
// the terrain is in their aux records (76, tag at +0x50 as stored):
//   "pNIT"  u32 version at +0x54, then points from +0x58: x, y, z as f64 and
//           8 more bytes (32 per point), or 16 more (40: two u32 flags and a
//           second height) in newer site models
//   "eNIT"  one f64 per point from +0x58, which gives the point count
//   "tNIT"  u32 version at +0x54, then 51-byte triangles from +0x58: three
//           i64 point indices, three i64 neighbour triangles (-1 none), 3 flags
// ("DMT" records beside them hold a 2D topology without heights.) Hardscapes,
// landscape areas and site modifiers keep a TIN too, flat near 0 where the
// drawing's terrain lies far above it; they show their own parts, draped.
//
// A plug-in object's profile group (a group tagged "gorp") holds what it is
// rebuilt from, not what it shows: a plant's symbol at 0 while the plant
// stands on the terrain, a plant symbol's image prop at its own size beside
// the copy at the plant's height, a door's handle at its origin, an
// assembly's frames.
// A hardscape's or landscape area's path draped on the terrain (a group with a
// TDMD of kind "htap") is its boundary, a few corners left at 0 where draping
// failed. Both are left out; the objects show their own parts.
//
// Textures: an object's RenderWorks texture is a "TDMD" aux record (76) whose
// 4CC at +0x56 is "ttwr". TDMD records are typed dictionaries: u16 count at
// +0x5a, u32 end at +0x5c, then (u16 key, u32 offset) entries from +0x60,
// offsets counted from +0x60; each value is u16 type (8 i32, 1 byte, 6 f64),
// u32 count (one per texture part), then the values. In "ttwr", key 3 is the
// texture's name index (-1 none, 0 the class's texture), key 5 the mapping
// and keys 6/7 its offset, scale, rotation and matrix. "By class" takes the
// texture whose name index is the i32 at +0x9e of the class record (0 none).
// An object without its own texture takes the one of the object it belongs to.
// A mesh that maps its texture by UV (Laubwerk plants) gives that texture a part
// of its own with mapping 5 (its whole-object part has none), and keeps the map
// in a TDMD of kind "TeMe" (its 4CC reads "eMeT"): key 1 a normal per vertex
// (3 f64), key 2 (u, v) per vertex (2 f64, v up). A 3D polygon mapped by plane
// (0: image props) places the image in the polygon's own frame: from its first
// vertex, x along its first edge, z up its face and y against its normal; key 7
// gives the image's u and v axes and its origin there, and the image spans the
// texture's size x the part's scale across, in proportion up (key 6).
//
// Colours: untextured faces show their fill as Top/Plan paints it, with the
// class's attributes where the object takes them by class: a solid or bitmap
// fill its background colour, a hatch its own ground (the fill background of
// a hatch-filled object is not drawn, and is often black), a gradient its
// middle stop. No fill shows a neutral grey.
//
// Walls (68) hold their 3D twice: a group (11) of bodies, one solid per
// component plus zero-thickness planes on the component faces, and one solid
// addition (84) per component carrying that component's fill, class and
// texture. The solids are the same triangles, so only the components are
// drawn (both would fight for the same pixels); the group serves walls
// without component solids. Doors, windows and cabinets often have a face
// lying exactly on a wall's face; the wall's faces are marked recessed, so
// the 3D view draws them a hair behind and the object in front wins.
//
// Frames: extrudes, solids, multiple extrudes and sweeps (24, 84, 38, 34) map
// their body to the parent's frame by a 3x3 matrix at +0xcc (three rows: the
// images of the x, y and z axes) and an offset at +0x114. Symbol instances
// (15) do the same with their matrix at +0x96, and plug-in objects (86) with
// theirs at +0xf0 for everything they hold; a design-layer viewport (a
// plug-in, model.ts dlvpShows) places the layers it shows by its own. A design
// layer's elevation is not added: objects are saved at their height in the
// model, the layer's elevation already in it. An extrude saved without a body (most plug-in
// objects' parts) sweeps its profile over its 3D box's z range (+0x9c: x1 y1
// z1 x0 y0 z0, in its own frame). 3D polygons (25) list their vertices directly: u16 count at
// +0xd0, then (x, y, z) f64 triples from +0xd2; +0x8d is 1 when closed. Open
// ones (contour lines) are edges only.

import earcut from "earcut";
import { CLASS_TEXTURE, readAttrs } from "./attrs.ts";
import { f64, i32, setF64, setU16, u16, u32 } from "./bytes.ts";
import { subtractMeshes, unionMeshes } from "./csg.ts";
import { simplifyMesh } from "./decimate.ts";
import { BODY_IN_PARENT, LOCUS, bodySections, instanceScale, translateRecord } from "./encode.ts";
import { LIGHT, LIGHT_AT, LIGHT_KIND, LIGHT_KINDS, LIGHT_ON, decodeShape, lightAim } from "./geometry.ts";
import { axisOf, isLightingDevice, readDeviceLight } from "./lightingDevice.ts";
import { guidOf, layerElevationOf, layerKindAt, objectChildren, type Model } from "./model.ts";
import type { Rec } from "./records.ts";
import type { Attributes, Light3D, LightChange, Mesh3D, ModelTree, ModelTreeGroup, ModelTreeNode, ModelTreePiece, ResourceInfo, SymbolPlacement, Vec3 } from "./types.ts";

const BODY = 114;
const SYMBOL_INSTANCE = 15;
const POLY3D = 25;
const LOCUS3D = 9;
/** half the size of the cross a 3D locus shows as, mm */
const LOCUS3D_REACH = 100;
const MESH = 40;
const MESH_FACE = 41;
const GROUP = 11;
const PLUGIN = 86;
const WALL = 68;
const SOLID_ADDITION = 84;
const AUX = 76;
const TDMD = "TDMD";
const TDMD_KIND = 0x56;
const TDMD_DIR = 0x5a;
const TDMD_BASE = 0x60;
const TD_I32 = 8;
const TD_F64 = 6;
const TEXTURE_KEY = 3;
/** "ttwr" keys: each part's mapping, its offset, scale and rotation (6 f64), its axes and origin (12 f64) */
const MAPPING_KEY = 5;
const PLACE_KEY = 6;
const AXES_KEY = 7;
const PLANE_MAPPING = 0;
const UV_MAPPING = 5;
/** "TeMe" key holding u, v per vertex */
const UV_KEY = 2;
/** Owners whose body is placed by their own matrix. */
const MATRIX_OWNERS = new Set([24, 34, 38, 84]);
const OWNER_MATRIX = 0xcc;
const OWNER_OFFSET = 0x114;
const INSTANCE_MATRIX = 0x96;
/** A light object's f64 fields after its kind (FORMAT.md §7, Renderworks cameras and lights; the rest are in geometry.ts). */
const LIGHT_COLOR = 0xa6;
const LIGHT_BRIGHTNESS = 0xbe;
const LIGHT_SPREAD = 0x116;
const LIGHT_BEAM = 0x11e;
/** the plug-in whose light is the sun, which the Visualization palette places */
const HELIODON = "Heliodon";
/** how far in front of a lighting device's body its lamp stands, mm */
const LENS_GAP = 20;
const PLUGIN_MATRIX = 0xf0;
/** Attached data, never geometry. */
const NOT_GEOMETRY = new Set([0, 48, 76, 91, 93, 101, 119, 121, 124, 125]);
/** 2D-only containers whose children are drawn in plan, not built in 3D. */
const PLAN_ONLY = new Set([63, 122]);

const DEFAULT_COLOR = "#d8d4cc";
const MAX_SYMBOL_DEPTH = 12;

// ---- 3D affine transforms ------------------------------------------------------

/** Rows: images of the x, y and z axes, then the offset: p' = x·r0 + y·r1 + z·r2 + t. */
type Xf = Float64Array;

const IDENTITY: Xf = Float64Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0);

function readXf(d: Uint8Array, rows: number, offset: number): Xf | null {
  if (offset + 24 > d.length) return null;
  const m = new Float64Array(12);
  for (let i = 0; i < 9; i++) m[i] = f64(d, rows + 8 * i);
  for (let i = 0; i < 3; i++) m[9 + i] = f64(d, offset + 8 * i);
  return m.every(Number.isFinite) ? m : null;
}

/** Where a symbol instance places its definition in 3D: its scale (instanceScale), then its matrix. */
function instanceXf(d: Uint8Array): Xf | null {
  const m = readXf(d, INSTANCE_MATRIX, INSTANCE_MATRIX + 72);
  if (!m) return null;
  instanceScale(d).forEach((k, row) => {
    for (let i = 0; i < 3; i++) m[3 * row + i] *= k;
  });
  return m;
}

/** a after b: p -> a(b(p)). */
function compose(a: Xf, b: Xf): Xf {
  const m = new Float64Array(12);
  for (let r = 0; r < 4; r++) {
    const x = b[3 * r];
    const y = b[3 * r + 1];
    const z = b[3 * r + 2];
    for (let k = 0; k < 3; k++) m[3 * r + k] = x * a[k] + y * a[3 + k] + z * a[6 + k] + (r === 3 ? a[9 + k] : 0);
  }
  return m;
}

/** A plug-in object's matrix (+0xf0, laid out as a symbol instance's), or none when it is flat or unreadable. */
function pluginXf(r: Rec): Xf {
  const m = readXf(r.data, PLUGIN_MATRIX, PLUGIN_MATRIX + 72);
  if (!m) return IDENTITY;
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  return Math.abs(det) > 1e-9 ? m : IDENTITY;
}

/** The determinant of m's 3 × 3 part: below 0 when it mirrors. */
function det3(m: Xf): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** Each triangle's last two corners swapped (`n` numbers a corner), so it faces the other way. */
function rewind(a: Float32Array | Float64Array, n: number): void {
  for (let t = 0; t + 3 * n <= a.length; t += 3 * n) {
    for (let k = 0; k < n; k++) {
      const v = a[t + n + k];
      a[t + n + k] = a[t + 2 * n + k];
      a[t + 2 * n + k] = v;
    }
  }
}

function apply(m: Xf, src: ArrayLike<number>, out: Float32Array | Float64Array): void {
  for (let i = 0; i + 2 < src.length; i += 3) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    out[i] = x * m[0] + y * m[3] + z * m[6] + m[9];
    out[i + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
    out[i + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
  }
}

// ---- body records ----------------------------------------------------------------

interface Wire {
  /** merged vertices, xyz */
  pts: Float64Array;
  /** vertex index pairs */
  edges: Uint32Array;
  /** curves as vertex index runs, for ruled faces */
  curves: Uint32Array[];
}

/** Local-frame triangles and edge segments of one body, cached per record buffer. */
interface BodyGeometry {
  triangles: Float64Array;
  edges: Float64Array;
  /** u, v at each corner (6 per triangle), in fractions of the texture's image, when the object maps its texture itself */
  uvs?: Float64Array;
  /** the polygons the triangles were cut from, when asked for (a mesh's faces): corners, and with uvs (u, v) at each */
  faces?: { corners: number[]; uvs?: number[] }[];
}

const bodyCache = new WeakMap<Uint8Array, BodyGeometry | null>();

const SEC_POINTS = 0;
const SEC_CURVES = 13;
const SEC_LINES = 14;

/** Vertex merge grid, mm. */
const MERGE = 0.01;
/** Steps per unit of a plane normal's components when finding planes that are one. */
const NORMAL_STEPS = 1e4;

function readWire(d: Uint8Array): Wire | null {
  const secs = bodySections(d);
  const ptsSec = secs?.get(SEC_POINTS);
  if (!secs || !ptsSec) return null;
  const [p0, p1] = ptsSec;
  const n = Math.floor((p1 - p0) / 24);
  if (n < 2) return null;
  // merge coincident points so faces can be traced through shared vertices: a point joins one
  // already seen within half a grid step on every axis, looked for in its cell and the cells
  // beside the nearer side on each axis, so where a body sits (moved, turned) doesn't change which
  // points merge. Cells are hashed to numbers; a shared hash only adds candidates to check.
  const cells = new Map<number, number[]>();
  const cellOf = (a: number, b: number, c: number): number => Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791);
  const pts: number[] = [];
  const remap = new Uint32Array(n);
  const near = MERGE / 2;
  for (let i = 0; i < n; i++) {
    const x = f64(d, p0 + 24 * i);
    const y = f64(d, p0 + 24 * i + 8);
    const z = f64(d, p0 + 24 * i + 16);
    const [fx, fy, fz] = [x / MERGE, y / MERGE, z / MERGE];
    const [cx, cy, cz] = [Math.floor(fx), Math.floor(fy), Math.floor(fz)];
    const [sx, sy, sz] = [fx - cx < 0.5 ? -1 : 1, fy - cy < 0.5 ? -1 : 1, fz - cz < 0.5 ? -1 : 1];
    let k = -1;
    for (let c = 0; c < 8 && k < 0; c++) {
      for (const j of cells.get(cellOf(cx + (c & 1 ? sx : 0), cy + (c & 2 ? sy : 0), cz + (c & 4 ? sz : 0))) ?? []) {
        if (Math.abs(pts[3 * j] - x) <= near && Math.abs(pts[3 * j + 1] - y) <= near && Math.abs(pts[3 * j + 2] - z) <= near) {
          k = j;
          break;
        }
      }
    }
    if (k < 0) {
      k = pts.length / 3;
      pts.push(x, y, z);
      const key = cellOf(cx, cy, cz);
      const list = cells.get(key);
      if (list) list.push(k);
      else cells.set(key, [k]);
    }
    remap[i] = k;
  }
  const seen = new Set<number>();
  const edges: number[] = [];
  const curves: Uint32Array[] = [];
  const nv = pts.length / 3;
  const addEdge = (a: number, b: number): void => {
    if (a === b) return;
    const key = a < b ? a * nv + b : b * nv + a;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push(a, b);
  };
  for (const id of [SEC_CURVES, SEC_LINES]) {
    const sec = secs.get(id);
    if (!sec) continue;
    for (let at = sec[0]; at + 6 <= sec[1]; at += 6) {
      const count = u16(d, at);
      const first = u32(d, at + 2);
      if (count < 2 || first + count > n) continue;
      const run = new Uint32Array(count);
      for (let i = 0; i < count; i++) run[i] = remap[first + i];
      for (let i = 1; i < count; i++) addEdge(run[i - 1], run[i]);
      if (id === SEC_CURVES && count >= 3) curves.push(run);
    }
  }
  if (!edges.length) return null;
  return { pts: Float64Array.from(pts), edges: Uint32Array.from(edges), curves };
}

function bodyGeometry(r: Rec): BodyGeometry | null {
  let g = bodyCache.get(r.data);
  if (g === undefined) {
    g = null;
    try {
      const w = readWire(r.data);
      if (w) {
        const tris: number[] = [];
        planarFaces(w, tris);
        ruledFaces(w, tris);
        const edges = new Float64Array(w.edges.length * 3);
        for (let i = 0; i < w.edges.length; i++) {
          const v = w.edges[i];
          edges[3 * i] = w.pts[3 * v];
          edges[3 * i + 1] = w.pts[3 * v + 1];
          edges[3 * i + 2] = w.pts[3 * v + 2];
        }
        g = { triangles: Float64Array.from(tris), edges };
      }
    } catch {
      g = null;
    }
    bodyCache.set(r.data, g);
  }
  return g;
}

// ---- faces from edges ----------------------------------------------------------

/** Plane offsets within this distance (mm) are the same plane. */
const PLANE_TOL = 0.05;
/** Skip pairs at vertices with more edges than this (dense meshes). */
const MAX_PAIR_DEGREE = 24;

interface Plane {
  n: [number, number, number];
  d: number;
  seeds: number[];
}

function planarFaces(w: Wire, out: number[]): void {
  const { pts, edges } = w;
  const nv = pts.length / 3;
  const ne = edges.length / 2;
  const adj: number[][] = Array.from({ length: nv }, () => []);
  for (let e = 0; e < ne; e++) {
    adj[edges[2 * e]].push(e);
    adj[edges[2 * e + 1]].push(e);
  }
  const other = (e: number, v: number): number => (edges[2 * e] === v ? edges[2 * e + 1] : edges[2 * e]);

  // candidate planes from pairs of edges meeting at a vertex
  // cells hashed to numbers; a shared hash only adds candidates to check
  const planes = new Map<number, Plane[]>();
  const planeCell = (a: number, b: number, c: number, e: number): number =>
    Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791) ^ Math.imul(e, 40503);
  const half = 0.5 / NORMAL_STEPS;
  for (let v = 0; v < nv; v++) {
    const inc = adj[v];
    if (inc.length < 2 || inc.length > MAX_PAIR_DEGREE) continue;
    const vx = pts[3 * v];
    const vy = pts[3 * v + 1];
    const vz = pts[3 * v + 2];
    for (let i = 0; i < inc.length; i++) {
      const a = other(inc[i], v);
      const ax = pts[3 * a] - vx;
      const ay = pts[3 * a + 1] - vy;
      const az = pts[3 * a + 2] - vz;
      for (let j = i + 1; j < inc.length; j++) {
        const b = other(inc[j], v);
        const bx = pts[3 * b] - vx;
        const by = pts[3 * b + 1] - vy;
        const bz = pts[3 * b + 2] - vz;
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz);
        if (len <= 1e-6 * Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz)) continue;
        nx /= len;
        ny /= len;
        nz /= len;
        // one orientation per plane: largest component positive
        const big = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? nx : Math.abs(ny) >= Math.abs(nz) ? ny : nz;
        if (big < 0) {
          nx = -nx;
          ny = -ny;
          nz = -nz;
        }
        const d = nx * vx + ny * vy + nz * vz;
        // a plane already found within half a step of this one's direction and within its
        // tolerance of its offset is the same plane: looked for in this cell and the ones beside
        // the nearer side of each, so where a body sits (moved, turned) doesn't split one in two
        const [fx, fy, fz, fd] = [nx * NORMAL_STEPS, ny * NORMAL_STEPS, nz * NORMAL_STEPS, d / PLANE_TOL];
        const [cx, cy, cz, cd] = [Math.floor(fx), Math.floor(fy), Math.floor(fz), Math.floor(fd)];
        const [sx, sy, sz, sd] = [fx - cx < 0.5 ? -1 : 1, fy - cy < 0.5 ? -1 : 1, fz - cz < 0.5 ? -1 : 1, fd - cd < 0.5 ? -1 : 1];
        let p: Plane | undefined;
        for (let c = 0; c < 16 && !p; c++) {
          const key = planeCell(cx + (c & 1 ? sx : 0), cy + (c & 2 ? sy : 0), cz + (c & 4 ? sz : 0), cd + (c & 8 ? sd : 0));
          for (const q of planes.get(key) ?? []) {
            if (Math.abs(q.n[0] - nx) <= half && Math.abs(q.n[1] - ny) <= half && Math.abs(q.n[2] - nz) <= half && Math.abs(q.d - d) <= PLANE_TOL) {
              p = q;
              break;
            }
          }
        }
        if (!p) {
          p = { n: [nx, ny, nz], d, seeds: [] };
          const key = planeCell(cx, cy, cz, cd);
          const list = planes.get(key);
          if (list) list.push(p);
          else planes.set(key, [p]);
        }
        p.seeds.push(inc[i], inc[j]);
      }
    }
  }

  const done = new Set<string>();
  const onPlane = (p: Plane, v: number): boolean =>
    Math.abs(p.n[0] * pts[3 * v] + p.n[1] * pts[3 * v + 1] + p.n[2] * pts[3 * v + 2] - p.d) <= PLANE_TOL;
  for (const p of [...planes.values()].flat()) {
    // grow the seeds to every connected edge lying in the plane
    const inPlane = new Set<number>();
    const stack = [...p.seeds];
    while (stack.length) {
      const e = stack.pop()!;
      if (inPlane.has(e)) continue;
      const a = edges[2 * e];
      const b = edges[2 * e + 1];
      if (!onPlane(p, a) || !onPlane(p, b)) continue;
      inPlane.add(e);
      for (const f of adj[a]) if (!inPlane.has(f)) stack.push(f);
      for (const f of adj[b]) if (!inPlane.has(f)) stack.push(f);
    }
    if (inPlane.size < 3) continue;
    const list = [...inPlane].sort((x, y) => x - y);
    const sig = list.join(",");
    if (done.has(sig)) continue;
    done.add(sig);
    facesInPlane(w, p, list, out);
  }
}

interface Cycle {
  verts: number[];
  area: number;
  /** 2D outline, flat xy */
  xy: number[];
  component: number;
}

function facesInPlane(w: Wire, p: Plane, list: number[], out: number[]): void {
  const { pts, edges } = w;
  // project by dropping the normal's largest axis, keeping orientation seen from +n
  const ax = Math.abs(p.n[0]);
  const ay = Math.abs(p.n[1]);
  const az = Math.abs(p.n[2]);
  const drop = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
  const ui = drop === 0 ? 1 : drop === 1 ? 2 : 0;
  const vi = drop === 0 ? 2 : drop === 1 ? 0 : 1;
  const flip = p.n[drop] < 0;
  const u = (v: number): number => pts[3 * v + ui];
  const vv = (v: number): number => (flip ? -1 : 1) * pts[3 * v + vi];

  // outgoing half-edges per vertex, sorted counter-clockwise
  const out2 = new Map<number, { to: number; ang: number }[]>();
  for (const e of list) {
    const a = edges[2 * e];
    const b = edges[2 * e + 1];
    for (const [s, t] of [
      [a, b],
      [b, a],
    ]) {
      let l = out2.get(s);
      if (!l) out2.set(s, (l = []));
      l.push({ to: t, ang: Math.atan2(vv(t) - vv(s), u(t) - u(s)) });
    }
  }
  for (const l of out2.values()) l.sort((x, y) => x.ang - y.ang);

  // components, for nesting
  const comp = new Map<number, number>();
  let nc = 0;
  for (const s of out2.keys()) {
    if (comp.has(s)) continue;
    const stack = [s];
    comp.set(s, nc);
    while (stack.length) {
      const x = stack.pop()!;
      for (const h of out2.get(x)!) if (!comp.has(h.to)) comp.set(h.to, nc), stack.push(h.to);
    }
    nc++;
  }

  // trace faces: arriving at b from a, leave by the edge just clockwise of b->a
  const used = new Set<string>();
  const cycles: Cycle[] = [];
  for (const [s, l] of out2) {
    for (const h0 of l) {
      if (used.has(`${s}>${h0.to}`)) continue;
      const verts: number[] = [];
      let a = s;
      let b = h0.to;
      let guard = 0;
      while (!used.has(`${a}>${b}`) && guard++ < 100000) {
        used.add(`${a}>${b}`);
        verts.push(a);
        const lb = out2.get(b)!;
        let k = lb.findIndex((h) => h.to === a);
        k = (k - 1 + lb.length) % lb.length;
        a = b;
        b = lb[k].to;
      }
      if (verts.length < 3) continue;
      const xy: number[] = [];
      let area = 0;
      for (let i = 0; i < verts.length; i++) {
        const j = (i + 1) % verts.length;
        xy.push(u(verts[i]), vv(verts[i]));
        area += u(verts[i]) * vv(verts[j]) - u(verts[j]) * vv(verts[i]);
      }
      area /= 2;
      if (Math.abs(area) < 1e-6) continue;
      cycles.push({ verts, area, xy, component: comp.get(s)! });
    }
  }
  const bounded = cycles.filter((c) => c.area > 0);
  if (!bounded.length) return;
  const outer = cycles.filter((c) => c.area < 0);

  // nesting: a bounded face inside an odd number of other components' faces is a hole
  const probe = (c: Cycle): [number, number] => interiorPoint(c.xy);
  const containers = (pt: [number, number], self: number): Cycle[] =>
    bounded.filter((o) => o.component !== self && pointInRing(pt, o.xy));
  const solid = new Map<Cycle, Cycle[]>();
  for (const c of bounded) {
    if (containers(probe(c), c.component).length % 2 === 0) solid.set(c, []);
  }
  // each component's outer boundary is a hole of the smallest solid face around it
  for (const o of outer) {
    const pt: [number, number] = [o.xy[0], o.xy[1]];
    let best: Cycle | null = null;
    for (const c of containers(pt, o.component)) if (!best || c.area < best.area) best = c;
    if (best) solid.get(best)?.push(o);
  }

  for (const [face, holes] of solid) {
    const flat = [...face.xy];
    const verts = [...face.verts];
    const holeIdx: number[] = [];
    for (const h of holes) {
      holeIdx.push(verts.length);
      flat.push(...h.xy);
      verts.push(...h.verts);
    }
    const tri = earcut(flat, holeIdx.length ? holeIdx : null, 2);
    for (const k of tri) {
      const v = verts[k];
      out.push(pts[3 * v], pts[3 * v + 1], pts[3 * v + 2]);
    }
  }
}

/** A point just inside a counter-clockwise ring (left of its first long edge). */
function interiorPoint(xy: number[]): [number, number] {
  const n = xy.length / 2;
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const l = Math.hypot(xy[2 * j] - xy[2 * i], xy[2 * j + 1] - xy[2 * i + 1]);
    if (l > bestLen) (bestLen = l), (best = i);
  }
  const j = (best + 1) % n;
  const mx = (xy[2 * best] + xy[2 * j]) / 2;
  const my = (xy[2 * best + 1] + xy[2 * j + 1]) / 2;
  const dx = (xy[2 * j] - xy[2 * best]) / bestLen;
  const dy = (xy[2 * j + 1] - xy[2 * best + 1]) / bestLen;
  const step = Math.min(1e-3 * bestLen, 0.01);
  return [mx - dy * step, my + dx * step];
}

function pointInRing(pt: [number, number], xy: number[]): boolean {
  const [x, y] = pt;
  const n = xy.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = xy[2 * i];
    const yi = xy[2 * i + 1];
    const xj = xy[2 * j];
    const yj = xy[2 * j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Side faces between curves that are translated copies of each other (extruded arcs and circles). */
function ruledFaces(w: Wire, out: number[]): void {
  const { pts, curves } = w;
  const byCount = new Map<number, Uint32Array[]>();
  for (const c of curves) {
    const l = byCount.get(c.length);
    if (l) l.push(c);
    else byCount.set(c.length, [c]);
  }
  const used = new Set<Uint32Array>();
  for (const group of byCount.values()) {
    if (group.length < 2 || group.length > 64) continue;
    for (let i = 0; i < group.length; i++) {
      const a = group[i];
      if (used.has(a)) continue;
      for (let j = i + 1; j < group.length; j++) {
        const b = group[j];
        if (used.has(b) || !translated(pts, a, b)) continue;
        used.add(a);
        used.add(b);
        for (let k = 0; k + 1 < a.length; k++) {
          const q = [a[k], a[k + 1], b[k + 1], a[k], b[k + 1], b[k]];
          for (const v of q) out.push(pts[3 * v], pts[3 * v + 1], pts[3 * v + 2]);
        }
        break;
      }
    }
  }
}

function translated(pts: Float64Array, a: Uint32Array, b: Uint32Array): boolean {
  const tx = pts[3 * b[0]] - pts[3 * a[0]];
  const ty = pts[3 * b[0] + 1] - pts[3 * a[0] + 1];
  const tz = pts[3 * b[0] + 2] - pts[3 * a[0] + 2];
  if (Math.hypot(tx, ty, tz) < PLANE_TOL) return false;
  for (let k = 1; k < a.length; k++) {
    if (
      Math.abs(pts[3 * b[k]] - pts[3 * a[k]] - tx) > PLANE_TOL ||
      Math.abs(pts[3 * b[k] + 1] - pts[3 * a[k] + 1] - ty) > PLANE_TOL ||
      Math.abs(pts[3 * b[k] + 2] - pts[3 * a[k] + 2] - tz) > PLANE_TOL
    ) {
      return false;
    }
  }
  return true;
}

// ---- 3D polygons -----------------------------------------------------------------

const POLY3D_CLOSED = 0x8d;
const POLY3D_COUNT = 0xd0;
const POLY3D_VERTS = 0xd2;

// Meshes (40): u32 vertex count at +0xd0, then 28-byte vertices from +0xd4,
// (x, y, z) f64 and 4 flag bytes. Each face is a type-41 child with its own
// attributes (and texture): u16 corner count at +0xcc, then that many u32
// vertex numbers counted from 1.
const MESH_COUNT = 0xd0;
const MESH_VERTS = 0xd4;
const MESH_VERT_SIZE = 28;
const FACE_COUNT = 0xcc;
const FACE_CORNERS = 0xce;

/**
 * A mesh's faces as triangles, one geometry per run of faces drawn alike (keyed by the first face of
 * each look); with `uvs` (u, v per vertex), each corner's texture coordinates too; with `keepFaces`,
 * the faces themselves as well.
 */
function meshGeometry(doc: Model, r: Rec, inherited: number, uvs: Float64Array | null, keepFaces = false): Map<Rec, BodyGeometry> {
  const out = new Map<Rec, BodyGeometry>();
  const d = r.data;
  if (d.length < MESH_VERTS) return out;
  const n = u32(d, MESH_COUNT);
  if (MESH_VERTS + MESH_VERT_SIZE * n > d.length) return out;
  const mapped = uvs !== null && uvs.length === 2 * n;
  const looks = new Map<string, { owner: Rec; tris: number[]; uvs: number[]; faces: { corners: number[]; uvs?: number[] }[] }>();
  for (const f of r.children) {
    if (f.type !== MESH_FACE || f.data.length < FACE_CORNERS) continue;
    const k = u16(f.data, FACE_COUNT);
    if (k < 3 || FACE_CORNERS + 4 * k > f.data.length) continue;
    const a = readAttrs(f.data);
    const key = `${a?.fillPattern ?? 0}/${a?.fillBack ?? 0}/${a?.fillOpacity ?? 100}/${textureOf(doc, f, inherited)}`;
    let look = looks.get(key);
    if (!look) {
      look = { owner: f, tris: [], uvs: [], faces: [] };
      looks.set(key, look);
    }
    const corner = (i: number): number => {
      const v = u32(f.data, FACE_CORNERS + 4 * i) - 1;
      return v >= 0 && v < n ? v : -1;
    };
    const first = corner(0);
    if (first < 0) continue;
    if (keepFaces) {
      const face: { corners: number[]; uvs?: number[] } = { corners: [], ...(mapped ? { uvs: [] } : {}) };
      for (let i = 0; i < k; i++) {
        const v = corner(i);
        if (v < 0) continue;
        const at = MESH_VERTS + MESH_VERT_SIZE * v;
        face.corners.push(f64(d, at), f64(d, at + 8), f64(d, at + 16));
        face.uvs?.push(uvs![2 * v], uvs![2 * v + 1]);
      }
      if (face.corners.length >= 9) look.faces.push(face);
    }
    // faces are convex: a fan from the first corner
    for (let i = 1; i + 1 < k; i++) {
      const b = corner(i);
      const c = corner(i + 1);
      if (b < 0 || c < 0) continue;
      for (const v of [first, b, c]) {
        const at = MESH_VERTS + MESH_VERT_SIZE * v;
        look.tris.push(f64(d, at), f64(d, at + 8), f64(d, at + 16));
        if (mapped) look.uvs.push(uvs[2 * v], uvs[2 * v + 1]);
      }
    }
  }
  for (const { owner, tris, uvs: lookUvs, faces } of looks.values()) {
    if (!tris.length) continue;
    out.set(owner, { triangles: Float64Array.from(tris), edges: new Float64Array(0), ...(mapped ? { uvs: Float64Array.from(lookUvs) } : {}), ...(keepFaces ? { faces } : {}) });
  }
  return out;
}

/** A 3D locus shows as a small cross, with no faces. */
function locus3dGeometry(r: Rec): BodyGeometry | null {
  const d = r.data;
  if (d.length < 0x7e) return null;
  const [x, y, z] = [f64(d, 0x66), f64(d, 0x6e), f64(d, 0x76)];
  if (![x, y, z].every(Number.isFinite)) return null;
  const a = LOCUS3D_REACH;
  return { triangles: new Float64Array(), edges: Float64Array.from([x - a, y, z, x + a, y, z, x, y - a, z, x, y + a, z, x, y, z - a, x, y, z + a]) };
}

function poly3dGeometry(r: Rec): BodyGeometry | null {
  const d = r.data;
  if (d.length < POLY3D_VERTS) return null;
  const n = u16(d, POLY3D_COUNT);
  if (n < 2 || POLY3D_VERTS + 24 * n > d.length) return null;
  const v: number[] = [];
  for (let i = 0; i < n; i++) v.push(f64(d, POLY3D_VERTS + 24 * i), f64(d, POLY3D_VERTS + 24 * i + 8), f64(d, POLY3D_VERTS + 24 * i + 16));
  const closed = d[POLY3D_CLOSED] !== 0 && n >= 3;
  const edges: number[] = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const j = (i + 1) % n;
    edges.push(v[3 * i], v[3 * i + 1], v[3 * i + 2], v[3 * j], v[3 * j + 1], v[3 * j + 2]);
  }
  const tris: number[] = [];
  if (closed) {
    // triangulate in the plane of the polygon's dominant axes
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      nx += (v[3 * i + 1] - v[3 * j + 1]) * (v[3 * i + 2] + v[3 * j + 2]);
      ny += (v[3 * i + 2] - v[3 * j + 2]) * (v[3 * i] + v[3 * j]);
      nz += (v[3 * i] - v[3 * j]) * (v[3 * i + 1] + v[3 * j + 1]);
    }
    const drop = Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? 0 : Math.abs(ny) >= Math.abs(nz) ? 1 : 2;
    const flat: number[] = [];
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) if (k !== drop) flat.push(v[3 * i + k]);
    for (const k of earcut(flat, null, 2)) tris.push(v[3 * k], v[3 * k + 1], v[3 * k + 2]);
  }
  return { triangles: Float64Array.from(tris), edges: Float64Array.from(edges) };
}

// ---- extrudes without a body -----------------------------------------------------

const EXTRUDE = 24;
const POLYGON = 5;
const POLYLINE = 21;
/** The own-frame 3D box: x1 y1 z1 x0 y0 z0. */
const OWN_BOX = 0x9c;
/** Points per full turn when a circle or ellipse profile becomes an outline: the 3D conversion resolution. */
let turnSteps = 48;
/** bumped when the resolution changes, so documents build their 3D again */
let resolutionGeneration = 0;

/**
 * Sets how finely curves openvwx turns into faces are divided (Preferences > 3D, 3D conversion
 * resolution): points per full turn of a circle or ellipse profile. Drawings build their 3D again.
 */
export function setTurnSteps(steps: number): void {
  const next = Math.max(8, Math.round(steps));
  if (next === turnSteps) return;
  turnSteps = next;
  resolutionGeneration++;
  extrudeCache = new WeakMap();
  sweepCache = new WeakMap();
  loftCache = new WeakMap();
  subtractionCache = new WeakMap();
}

/** Which resolution the 3D was built at, for documents to tell when theirs is out of date. */
export function turnStepsGeneration(): number {
  return resolutionGeneration;
}
/** A profile corner turning more than this (radians) shows an edge up the side. */
const CREASE = (20 * Math.PI) / 180;

/**
 * A profile's outline as flat xy, without a repeated closing point. An open polygon or polyline
 * counts as closed, as Vectorworks fills it and extrudes it; lines, open arcs and text are no
 * profile.
 */
function profileRing(rec: Rec): number[] | null {
  const s = decodeShape(rec);
  if (!s) return null;
  const xy: number[] = [];
  if (s.kind === "arc") {
    if (Math.abs(s.sweepAngle ?? 0) < 360 || !s.center || !s.rx) return null;
    const ry = s.ry ?? s.rx;
    for (let i = 0; i < turnSteps; i++) {
      const t = (2 * Math.PI * i) / turnSteps;
      xy.push(s.center.x + s.rx * Math.cos(t), s.center.y + ry * Math.sin(t));
    }
  } else if (s.kind === "rect" || s.kind === "polygon" || s.kind === "polyline") {
    for (const p of s.points) {
      const n = xy.length;
      if (n && Math.abs(xy[n - 2] - p.x) < 1e-9 && Math.abs(xy[n - 1] - p.y) < 1e-9) continue;
      xy.push(p.x, p.y);
    }
    while (xy.length > 2 && Math.abs(xy[0] - xy[xy.length - 2]) < 1e-9 && Math.abs(xy[1] - xy[xy.length - 1]) < 1e-9) xy.length -= 2;
  }
  return xy.length >= 6 && xy.every(Number.isFinite) ? xy : null;
}

let extrudeCache = new WeakMap<Uint8Array, { z0: number; z1: number; holes: Uint8Array[]; g: BodyGeometry | null }>();

/**
 * An extrude Vectorworks saved without its body (most plug-in objects' 3D parts, and the operands
 * of solids): its profile, in its own frame, swept from the low to the high z of its own box. A
 * polyline's holes are the polylines and polygons inside it.
 */
function extrudeGeometry(r: Rec): BodyGeometry | null {
  const profile = r.children.find((c) => !NOT_GEOMETRY.has(c.type));
  if (!profile || r.data.length < OWN_BOX + 48) return null;
  const z1 = f64(r.data, OWN_BOX + 16);
  const z0 = f64(r.data, OWN_BOX + 40);
  const inner = profile.children.filter((c) => c.type === POLYLINE || c.type === POLYGON);
  const holes = inner.map((c) => c.data);
  const hit = extrudeCache.get(profile.data);
  if (hit && hit.z0 === z0 && hit.z1 === z1 && hit.holes.length === holes.length && hit.holes.every((h, i) => h === holes[i])) return hit.g;
  let g: BodyGeometry | null = null;
  const outer = profileRing(profile);
  if (outer && Number.isFinite(z0) && Number.isFinite(z1) && z1 > z0) {
    const rings = [outer];
    for (const c of inner) {
      const hole = profileRing(c);
      if (hole) rings.push(hole);
    }
    const xy = rings.flat();
    const starts = rings.slice(1).map((_, i) => rings.slice(0, i + 1).reduce((n, h) => n + h.length / 2, 0));
    const tris: number[] = [];
    const edges: number[] = [];
    for (const z of [z0, z1]) for (const k of earcut(xy, starts, 2)) tris.push(xy[2 * k], xy[2 * k + 1], z);
    for (const ring of rings) {
      const n = ring.length / 2;
      const x = (i: number): number => ring[2 * ((i + n) % n)];
      const y = (i: number): number => ring[2 * ((i + n) % n) + 1];
      for (let i = 0; i < n; i++) {
        tris.push(x(i), y(i), z0, x(i + 1), y(i + 1), z0, x(i + 1), y(i + 1), z1);
        tris.push(x(i), y(i), z0, x(i + 1), y(i + 1), z1, x(i), y(i), z1);
        edges.push(x(i), y(i), z0, x(i + 1), y(i + 1), z0, x(i), y(i), z1, x(i + 1), y(i + 1), z1);
        // where the outline turns sharply, an edge runs up the side
        const [ux, uy, vx, vy] = [x(i) - x(i - 1), y(i) - y(i - 1), x(i + 1) - x(i), y(i + 1) - y(i)];
        if (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > CREASE) edges.push(x(i), y(i), z0, x(i), y(i), z1);
      }
    }
    g = { triangles: Float64Array.from(tris), edges: Float64Array.from(edges) };
  }
  extrudeCache.set(profile.data, { z0, z1, holes, g });
  return g;
}

// ---- sweeps without a body ------------------------------------------------------------

const SWEEP = 34;
/** f64 degrees between the segments Vectorworks draws a sweep with (5.625 in every demo) */
const SWEEP_SEGMENT = 0x148;
/** f64 degrees the profile is swept through (360, or 180) */
const SWEEP_ARC = 0x158;
/** f64s that are 0 in every demo sweep: its start angle and pitch, in some order */
const SWEEP_START_OR_PITCH = [0x140, 0x150];
const DEFAULT_SEGMENT = 5.625;
/** where a 2D locus a sweep holds beside its profile has its x, the axis running through it */
const LOCUS_X = 0x70;
const MAX_SWEEP_STEPS = 256;

let sweepCache = new WeakMap<Uint8Array, { arc: number; segment: number; axis: number; holes: Uint8Array[]; g: BodyGeometry | null }>();

/**
 * A sweep, from its profile: in its own frame, turned about the line parallel to its y axis through
 * the 2D locus it holds, or without one through the profile's left edge. A point `dx` right of that line goes to
 * (x0 + dx sin θ, y, −dx cos θ) for θ from 0 to the arc, which puts the profile's own plane in the
 * middle of a half sweep (FORMAT.md §3D). Null for one with a start angle or pitch, which aren't
 * told apart.
 */
function sweepGeometry(r: Rec): BodyGeometry | null {
  // after the aux records, among which a bodied sweep keeps its body
  const parts = objectChildren(r);
  const profile = parts.find((c) => !NOT_GEOMETRY.has(c.type) && c.type !== LOCUS);
  const locus = parts.find((c) => c.type === LOCUS && c.data.length >= LOCUS_X + 8);
  if (!profile || r.data.length < SWEEP_ARC + 8 || SWEEP_START_OR_PITCH.some((o) => f64(r.data, o) !== 0)) return null;
  const rawArc = f64(r.data, SWEEP_ARC);
  const rawSegment = f64(r.data, SWEEP_SEGMENT);
  const arc = rawArc > 0 && rawArc < 360 ? rawArc : 360;
  const segment = rawSegment > 0 && rawSegment <= 90 ? rawSegment : DEFAULT_SEGMENT;
  const inner = profile.children.filter((c) => c.type === POLYLINE || c.type === POLYGON);
  const holes = inner.map((c) => c.data);
  const x0 = locus ? f64(locus.data, LOCUS_X) : decodeShape(profile)?.bbox?.x0;
  if (x0 === undefined || !Number.isFinite(x0)) return null;
  const hit = sweepCache.get(profile.data);
  if (hit && hit.arc === arc && hit.segment === segment && hit.axis === x0 && hit.holes.length === holes.length && hit.holes.every((h, i) => h === holes[i])) return hit.g;
  let g: BodyGeometry | null = null;
  const outer = profileRing(profile);
  if (outer) {
    const rings = [outer];
    for (const c of inner) {
      const hole = profileRing(c);
      if (hole) rings.push(hole);
    }
    const full = arc >= 360;
    const steps = Math.min(MAX_SWEEP_STEPS, Math.max(1, Math.ceil(arc / segment - 1e-9)));
    const turn = (arc * Math.PI) / 180;
    const sin = Array.from({ length: steps + 1 }, (_, k) => Math.sin((turn * k) / steps));
    const cos = Array.from({ length: steps + 1 }, (_, k) => Math.cos((turn * k) / steps));
    const at = (x: number, y: number, k: number): [number, number, number] => [x0 + (x - x0) * sin[k], y, -(x - x0) * cos[k]];
    const tris: number[] = [];
    const edges: number[] = [];
    if (!full) {
      const xy = rings.flat();
      const starts = rings.slice(1).map((_, i) => rings.slice(0, i + 1).reduce((n, h) => n + h.length / 2, 0));
      const cap = earcut(xy, starts, 2);
      for (const k of [0, steps]) for (const i of cap) tris.push(...at(xy[2 * i], xy[2 * i + 1], k));
    }
    for (const ring of rings) {
      const n = ring.length / 2;
      const x = (i: number): number => ring[2 * ((i + n) % n)];
      const y = (i: number): number => ring[2 * ((i + n) % n) + 1];
      for (let i = 0; i < n; i++) {
        const onAxis = Math.abs(x(i) - x0) < 1e-9 && Math.abs(x(i + 1) - x0) < 1e-9;
        for (let k = 0; k < steps && !onAxis; k++) {
          const [a, b, c, d] = [at(x(i), y(i), k), at(x(i + 1), y(i + 1), k), at(x(i + 1), y(i + 1), k + 1), at(x(i), y(i), k + 1)];
          tris.push(...a, ...b, ...c, ...a, ...c, ...d);
        }
        if (!full) edges.push(...at(x(i), y(i), 0), ...at(x(i + 1), y(i + 1), 0), ...at(x(i), y(i), steps), ...at(x(i + 1), y(i + 1), steps));
        // where the outline turns sharply, an edge runs round the sweep
        const [ux, uy, vx, vy] = [x(i) - x(i - 1), y(i) - y(i - 1), x(i + 1) - x(i), y(i + 1) - y(i)];
        if (Math.abs(x(i) - x0) > 1e-9 && Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > CREASE) {
          for (let k = 0; k < steps; k++) edges.push(...at(x(i), y(i), k), ...at(x(i), y(i), k + 1));
        }
      }
    }
    if (tris.length) g = { triangles: Float64Array.from(tris), edges: Float64Array.from(edges) };
  }
  sweepCache.set(profile.data, { arc, segment, axis: x0, holes, g });
  return g;
}

// ---- multiple extrudes without a body ----------------------------------------------

const MULTI_EXTRUDE = 38;
/** The placeholder records a multiple extrude keeps among its profiles. */
const MULTI_PLACEHOLDER = 42;
/** Above this many points a ring keeps its own start rather than searching for the least twist. */
const MAX_TWIST_SEARCH = 512;

let loftCache = new WeakMap<Uint8Array, { profiles: Uint8Array[]; g: BodyGeometry | null }>();

function signedArea(xy: number[]): number {
  let a = 0;
  for (let i = 0; i < xy.length; i += 2) {
    const j = (i + 2) % xy.length;
    a += xy[i] * xy[j + 1] - xy[j] * xy[i + 1];
  }
  return a / 2;
}

/** Splits a ring's longest edges in half until it has `n` points, keeping its shape. */
function splitTo(xy: number[], n: number): number[] {
  const out = xy.slice();
  while (out.length / 2 < n) {
    let best = 0;
    let len = -1;
    for (let i = 0; i < out.length; i += 2) {
      const j = (i + 2) % out.length;
      const l = Math.hypot(out[j] - out[i], out[j + 1] - out[i + 1]);
      if (l > len) [best, len] = [i, l];
    }
    const j = (best + 2) % out.length;
    out.splice(best + 2, 0, (out[best] + out[j]) / 2, (out[best + 1] + out[j + 1]) / 2);
  }
  return out;
}

/** `ring` turned to start at the point that pairs with `base` with the least twist, about their centres. */
function leastTwist(base: number[], ring: number[]): number[] {
  const n = ring.length / 2;
  if (n > MAX_TWIST_SEARCH) return ring;
  const centre = (xy: number[]): [number, number] => {
    let x = 0;
    let y = 0;
    for (let i = 0; i < xy.length; i += 2) [x, y] = [x + xy[i], y + xy[i + 1]];
    return [(2 * x) / xy.length, (2 * y) / xy.length];
  };
  const [bx, by] = centre(base);
  const [rx, ry] = centre(ring);
  let best = 0;
  let cost = Infinity;
  for (let s = 0; s < n; s++) {
    let c = 0;
    for (let i = 0; i < n && c < cost; i++) {
      const k = 2 * ((i + s) % n);
      c += (ring[k] - rx - (base[2 * i] - bx)) ** 2 + (ring[k + 1] - ry - (base[2 * i + 1] - by)) ** 2;
    }
    if (c < cost) [best, cost] = [s, c];
  }
  return [...ring.slice(2 * best), ...ring.slice(0, 2 * best)];
}

/**
 * A multiple extrude Vectorworks saved without its body: a loft through its profiles, in its own
 * frame, the first at the low z of its own box and the last at the high z, evenly between. Each
 * profile's points pair with the next one's, turned to the same winding and the least twist.
 */
function multiExtrudeGeometry(r: Rec): BodyGeometry | null {
  if (r.data.length < OWN_BOX + 48) return null;
  const kids = r.children.filter((c) => !NOT_GEOMETRY.has(c.type) && c.type !== MULTI_PLACEHOLDER);
  const profiles = kids.map((c) => c.data);
  const hit = loftCache.get(r.data);
  if (hit && hit.profiles.length === profiles.length && hit.profiles.every((d, i) => d === profiles[i])) return hit.g;
  let g: BodyGeometry | null = null;
  const z1 = f64(r.data, OWN_BOX + 16);
  const z0 = f64(r.data, OWN_BOX + 40);
  const found = kids.map(profileRing);
  if (found.length >= 2 && found.every((x) => x) && Number.isFinite(z0) && Number.isFinite(z1) && z1 > z0) {
    let rings = found as number[][];
    const n = Math.max(...rings.map((x) => x.length / 2));
    rings = rings.map((x) => splitTo(x, n));
    for (let k = 1; k < rings.length; k++) {
      let x = rings[k];
      if (Math.sign(signedArea(x)) !== Math.sign(signedArea(rings[k - 1]))) {
        const back: number[] = [];
        for (let i = x.length - 2; i >= 0; i -= 2) back.push(x[i], x[i + 1]);
        x = back;
      }
      rings[k] = leastTwist(rings[k - 1], x);
    }
    const zs = rings.map((_, k) => z0 + ((z1 - z0) * k) / (rings.length - 1));
    const tris: number[] = [];
    const edges: number[] = [];
    for (const k of [0, rings.length - 1]) for (const i of earcut(rings[k], null, 2)) tris.push(rings[k][2 * i], rings[k][2 * i + 1], zs[k]);
    const sharp = (ring: number[], i: number): boolean => {
      const p = (j: number): [number, number] => [ring[2 * ((j + n) % n)], ring[2 * ((j + n) % n) + 1]];
      const [[ax, ay], [bx, by], [cx, cy]] = [p(i - 1), p(i), p(i + 1)];
      const [ux, uy, vx, vy] = [bx - ax, by - ay, cx - bx, cy - by];
      return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) > CREASE;
    };
    for (let k = 0; k < rings.length; k++) {
      const [a, za] = [rings[k], zs[k]];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        edges.push(a[2 * i], a[2 * i + 1], za, a[2 * j], a[2 * j + 1], za);
      }
      if (k === rings.length - 1) break;
      const [b, zb] = [rings[k + 1], zs[k + 1]];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tris.push(a[2 * i], a[2 * i + 1], za, a[2 * j], a[2 * j + 1], za, b[2 * j], b[2 * j + 1], zb);
        tris.push(a[2 * i], a[2 * i + 1], za, b[2 * j], b[2 * j + 1], zb, b[2 * i], b[2 * i + 1], zb);
        // where either outline turns sharply, an edge runs between them
        if (sharp(a, i) || sharp(b, i)) edges.push(a[2 * i], a[2 * i + 1], za, b[2 * i], b[2 * i + 1], zb);
      }
    }
    g = { triangles: Float64Array.from(tris), edges: Float64Array.from(edges) };
  }
  loftCache.set(r.data, { profiles, g });
  return g;
}

// ---- solids without a body -------------------------------------------------------

/** A solid's operation: 1 adds its operands, 3 takes the later ones from the first (FORMAT.md §3D). */
const SOLID_KIND = 0x17d;
const SOLID_SUBTRACT = 3;

let subtractionCache = new WeakMap<Uint8Array, { parts: Uint8Array[]; g: BodyGeometry | null }>();

/** Every record's data below `r`, to tell when anything a solid holds has changed. */
function heldData(r: Rec): Uint8Array[] {
  const out: Uint8Array[] = [];
  const stack = [...r.children];
  while (stack.length) {
    const c = stack.pop()!;
    out.push(c.data);
    stack.push(...c.children);
  }
  return out;
}

function joined(runs: { triangles: Float64Array }[]): Float64Array {
  const out = new Float64Array(runs.reduce((n, o) => n + o.triangles.length, 0));
  let at = 0;
  for (const o of runs) {
    out.set(o.triangles, at);
    at += o.triangles.length;
  }
  return out;
}

/**
 * An operand of a subtraction as one closed mesh: an addition saved without its body is its
 * operands overlapping, which the cut would read as faces inside the solid, so they are joined
 * into the volume they make first (overlapping, when that is too detailed).
 */
function operandTriangles(doc: Model, op: Rec): Float64Array {
  const runs = objectTriangles(doc, op);
  if (runs.length < 2 || op.type !== SOLID_ADDITION || op.data[SOLID_KIND] === SOLID_SUBTRACT) return joined(runs);
  return unionMeshes(runs.map((o) => o.triangles))?.triangles ?? joined(runs);
}

/**
 * A subtraction saved without its body: its first operand with the others taken away, in its
 * own frame, where its operands are. Null when the operands are too detailed to cut.
 */
function subtractionGeometry(doc: Model, r: Rec): BodyGeometry | null {
  const parts = heldData(r);
  const hit = subtractionCache.get(r.data);
  if (hit && hit.parts.length === parts.length && hit.parts.every((d, i) => d === parts[i])) return hit.g;
  const [first, ...rest] = objectChildren(r).map((op) => operandTriangles(doc, op));
  const g = first ? subtractMeshes(first, rest) : null;
  subtractionCache.set(r.data, { parts, g });
  return g;
}

// ---- site model terrain ------------------------------------------------------

const AUX_TAG = 0x50;
const TIN_DATA = 0x58;
const TIN_POINT_SIZES = [32, 40, 24];
const TIN_TRIANGLE = 51;

function auxTag(d: Uint8Array): string {
  return d.length < AUX_TAG + 4 ? "" : String.fromCharCode(d[AUX_TAG], d[AUX_TAG + 1], d[AUX_TAG + 2], d[AUX_TAG + 3]);
}

/** the plug-in drawn from its TIN */
const SITE_MODEL = "DTM6";
/** the tag of a plug-in's profile group, as stored */
const PROFILE_GROUP = "gorp";
/** the TDMD kind marking a hardscape's or landscape area's path draped on the terrain, as stored */
const DRAPED_PATH = "htap";

/**
 * A plug-in object's profile group: what it is rebuilt from, kept but shown neither in plan nor in
 * 3D (a lighting device's label legend layout, with its "Format and arrange the labels" note).
 */
export function isProfileGroup(r: Rec): boolean {
  return r.type === GROUP && r.children.some((c) => c.type === AUX && auxTag(c.data) === PROFILE_GROUP);
}

/**
 * A plug-in object's group that is not part of what it shows: its profile group or its path draped
 * on the terrain (a few corners left at 0 where draping failed).
 */
function isSourceGroup(r: Rec): boolean {
  return isProfileGroup(r) || (r.type === GROUP && tdmdRec(r, DRAPED_PATH) !== null);
}

function tinGeometry(owner: Rec): BodyGeometry | null {
  let pts: Uint8Array | null = null;
  let tris: Uint8Array | null = null;
  let heights: Uint8Array | null = null;
  for (const c of owner.children) {
    if (c.type !== AUX) continue;
    const tag = auxTag(c.data);
    if (tag === "pNIT") pts = c.data;
    else if (tag === "tNIT") tris = c.data;
    else if (tag === "eNIT") heights = c.data;
  }
  if (!pts || !tris) return null;
  const bytes = pts.length - TIN_DATA;
  const counted = heights ? (heights.length - TIN_DATA) / 8 : 0;
  const stride =
    counted > 0 && Number.isInteger(bytes / counted)
      ? bytes / counted
      : TIN_POINT_SIZES.find((size) => bytes % size === 0);
  if (!stride || stride < 24) return null;
  const np = bytes / stride;
  const nt = Math.floor((tris.length - TIN_DATA) / TIN_TRIANGLE);
  if (np < 3 || nt < 1) return null;
  const out = new Float64Array(nt * 9);
  let k = 0;
  for (let t = 0; t < nt; t++) {
    const at = TIN_DATA + TIN_TRIANGLE * t;
    for (let i = 0; i < 3; i++) {
      const v = u32(tris, at + 8 * i);
      if (v >= np || u32(tris, at + 8 * i + 4) !== 0) return null;
      const p = TIN_DATA + stride * v;
      out[k++] = f64(pts, p);
      out[k++] = f64(pts, p + 8);
      out[k++] = f64(pts, p + 16);
    }
  }
  return { triangles: out, edges: new Float64Array(0) };
}

// ---- textures ----------------------------------------------------------------

/** First i32 under `key` in the object's TDMD record of the given kind, or null. */
function tdmdInt(owner: Rec, kind: string, key: number): number | null {
  for (const c of owner.children) {
    const d = c.data;
    if (c.type !== AUX || auxTag(d) !== TDMD || d.length < TDMD_BASE) continue;
    if (String.fromCharCode(d[TDMD_KIND], d[TDMD_KIND + 1], d[TDMD_KIND + 2], d[TDMD_KIND + 3]) !== kind) continue;
    const n = u16(d, TDMD_DIR);
    for (let i = 0; i < n && TDMD_BASE + 6 * i + 6 <= d.length; i++) {
      if (u16(d, TDMD_BASE + 6 * i) !== key) continue;
      const at = TDMD_BASE + u32(d, TDMD_BASE + 6 * i + 2);
      if (at + 10 > d.length || u16(d, at) !== TD_I32 || u32(d, at + 2) < 1) return null;
      return i32(d, at + 6);
    }
  }
  return null;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
/** `a` scaled to length 1, or null when it has (almost) none. */
function unit(a: Vec3): Vec3 | null {
  const len = Math.hypot(a[0], a[1], a[2]);
  return len > 1e-9 ? [a[0] / len, a[1] / len, a[2] / len] : null;
}

/** The object's TDMD record of the given kind (its 4CC as stored), or null. */
function tdmdRec(owner: Rec, kind: string): Uint8Array | null {
  for (const c of owner.children) {
    const d = c.data;
    if (c.type !== AUX || auxTag(d) !== TDMD || d.length < TDMD_BASE) continue;
    if (String.fromCharCode(d[TDMD_KIND], d[TDMD_KIND + 1], d[TDMD_KIND + 2], d[TDMD_KIND + 3]) === kind) return d;
  }
  return null;
}

/** The values under `key` in a TDMD record: their type, count and where the first starts; null when it has none. */
function tdmdValues(d: Uint8Array, key: number): { type: number; count: number; at: number } | null {
  const n = u16(d, TDMD_DIR);
  for (let i = 0; i < n && TDMD_BASE + 6 * i + 6 <= d.length; i++) {
    if (u16(d, TDMD_BASE + 6 * i) !== key) continue;
    const at = TDMD_BASE + u32(d, TDMD_BASE + 6 * i + 2);
    if (at + 6 > d.length) return null;
    const type = u16(d, at);
    const count = u32(d, at + 2);
    const size = type === TD_I32 ? 4 : type === TD_F64 ? 8 : 1;
    return at + 6 + size * count <= d.length ? { type, count, at: at + 6 } : null;
  }
  return null;
}

/** The i32s under `key` in a TDMD record (one per texture part), or []. */
function tdmdInts(d: Uint8Array, key: number): number[] {
  const v = tdmdValues(d, key);
  return v?.type === TD_I32 ? Array.from({ length: v.count }, (_, i) => i32(d, v.at + 4 * i)) : [];
}

/** The f64s under `key` in a TDMD record, or []. */
function tdmdF64s(d: Uint8Array, key: number): number[] {
  const v = tdmdValues(d, key);
  return v?.type === TD_F64 ? Array.from({ length: v.count }, (_, i) => f64(d, v.at + 8 * i)) : [];
}

/** A mesh's UV map: the texture it maps by UV (its part with mapping 5) and u, v per vertex; null when it has none. */
function meshUvMap(r: Rec): { texture: number; uvs: Float64Array } | null {
  const ttwr = tdmdRec(r, "ttwr");
  const teme = tdmdRec(r, "eMeT");
  if (!ttwr || !teme) return null;
  const textures = tdmdInts(ttwr, TEXTURE_KEY);
  const part = tdmdInts(ttwr, MAPPING_KEY).findIndex((m, i) => m === UV_MAPPING && textures[i] > 0);
  const v = tdmdValues(teme, UV_KEY);
  if (part < 0 || !v || v.type !== TD_F64 || v.count % 2 !== 0) return null;
  const uvs = new Float64Array(v.count);
  for (let i = 0; i < v.count; i++) uvs[i] = f64(teme, v.at + 8 * i);
  return { texture: textures[part], uvs };
}

/**
 * Texture coordinates for a 3D polygon's triangles (in its own frame, as poly3dGeometry gives them)
 * when its own texture is mapped by plane and has an image of known size (see Textures above); else null.
 */
function planeUvs(ctx: Ctx, r: Rec, tris: Float64Array): Float64Array | null {
  const ttwr = tdmdRec(r, "ttwr");
  if (!ttwr || !tris.length || tdmdInts(ttwr, MAPPING_KEY)[0] !== PLANE_MAPPING) return null;
  const res = ctx.textures.get(textureOf(ctx.doc, r, -1));
  const place = tdmdF64s(ttwr, PLACE_KEY);
  const axes = tdmdF64s(ttwr, AXES_KEY);
  if (!res?.imageSize || !res.imagePixels || place.length < 6 || axes.length < 12) return null;
  const [offsetU, offsetV, scaleU, scaleV, rotation] = place;
  const width = res.imageSize * scaleU;
  const height = res.imageSize * scaleV * (res.imagePixels.height / res.imagePixels.width);
  if (!(width > 0) || !(height > 0)) return null;
  // the polygon's frame: its first vertex, x along its first edge, y against its normal, z up its face
  const d = r.data;
  const n = u16(d, POLY3D_COUNT);
  const p = (i: number): Vec3 => [f64(d, POLY3D_VERTS + 24 * i), f64(d, POLY3D_VERTS + 24 * i + 8), f64(d, POLY3D_VERTS + 24 * i + 16)];
  const o = p(0);
  let e: Vec3 | null = null;
  for (let i = 1; i < n && !e; i++) e = unit(sub(p(i), o));
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < n; i++) {
    const a = p(i);
    const b = p((i + 1) % n);
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const nn = unit([nx, ny, nz]);
  if (!e || !nn) return null;
  const up = cross(nn, e);
  const against: Vec3 = [-nn[0], -nn[1], -nn[2]];
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const out = new Float64Array((tris.length / 3) * 2);
  for (let i = 0, j = 0; i + 2 < tris.length; i += 3, j += 2) {
    const q = sub([tris[i], tris[i + 1], tris[i + 2]], o);
    const local: Vec3 = [dot(q, e) - axes[9], dot(q, against) - axes[10], dot(q, up) - axes[11]];
    const su = dot(local, [axes[0], axes[1], axes[2]]) - offsetU;
    const sv = dot(local, [axes[3], axes[4], axes[5]]) - offsetV;
    out[j] = (su * cos + sv * sin) / width;
    out[j + 1] = (sv * cos - su * sin) / height;
  }
  return out;
}

/** The object's own texture: a name index, 0 for "by class", -1 for none, null when it has no texture record. */
function ownTexture(r: Rec): number | null {
  return tdmdInt(r, "ttwr", TEXTURE_KEY);
}


/** The texture an object shows: its own, its class's when set "by class", else `inherited`. */
function textureOf(doc: Model, r: Rec, inherited: number): number {
  const own = ownTexture(r);
  if (own !== null && own > 0) return own;
  if (own === 0) {
    const cls = doc.classRecs.get(r.classIndex);
    const t = cls && cls.data.length >= CLASS_TEXTURE + 4 ? i32(cls.data, CLASS_TEXTURE) : 0;
    if (t > 0) return t;
  }
  return inherited;
}

// ---- walking the drawing -------------------------------------------------------------

interface Ctx {
  doc: Model;
  /** hatch, tile and gradient resources by name index, for the colour of resource fills */
  fills: ReadonlyMap<number, ResourceInfo>;
  /** textures with an image, by name index, for the objects that map them themselves */
  textures: ReadonlyMap<number, ResourceInfo>;
  layerId: string;
  out: Mesh3D[];
  depth: number;
  /** texture of the enclosing objects (name index, -1 none) */
  texture: number;
  /** inside a wall: its faces give way to objects flush with them */
  recessed: boolean;
  /** set by objectTriangles: each owner's triangles at full precision, in place of meshes */
  raw?: { owner: Rec; triangles: Float64Array }[];
  /** inside a top-level plain group: the object in it, or in a group in it, being walked (Mesh3D.partId) */
  part?: string;
  /** the plain group being walked whose members are parts: a top-level one, or one in it */
  chain?: Rec;
  /** how many times each symbol definition is placed (placementsOf), when the model is built */
  placements?: ReadonlyMap<Rec, number>;
  /** how many times what is being walked is placed in the model: the most of the definitions it is in */
  repeat: number;
  /** set by buildModelTree: symbols kept as placements, pieces in place of meshes */
  tree?: TreeCtx;
  /** inside a symbol instance that is a top-level object or a part: its placement (Mesh3D.instance) */
  instance?: SymbolPlacement;
  /**
   * inside a solid saved without its body: the outermost such solid, whose class, attributes and texture
   * its operands are drawn in, as its body would be
   */
  look?: Rec;
}

/** Where buildModelTree collects what the walk finds (see ModelTree). */
interface TreeCtx {
  /** the node of what the top-level object `topId` shows (inside a symbol, the symbol's) */
  node: (topId: string) => ModelTreeNode;
  symbols: ModelTree["symbols"];
  /** each symbol made, by its name index and the texture it inherits; -1 when it shows nothing */
  made: Map<string, number>;
  /** the definitions being walked, so one placed inside itself stops there */
  making: Set<Rec>;
}

/** The colour untextured faces show: the fill as Top/Plan paints it (see Colours above). */
function fillColour(ctx: Ctx, a: Attributes | null): string {
  if (!a || a.fillPattern === 0) return DEFAULT_COLOR;
  if (a.fillPattern > 0) return ctx.doc.color(a.fillBack);
  const res = ctx.fills.get(-a.fillPattern);
  if (res?.hatch) return ctx.doc.color(res.hatch.background);
  const stops = res?.gradient;
  if (stops?.length) return stops[Math.floor(stops.length / 2)].color;
  // a tile draws over the fill background
  return ctx.doc.color(a.fillBack);
}

// ---- repeated parts -------------------------------------------------------------
// A part a drawing places tens of thousands of times is drawn with fewer triangles, so the model
// stays within what a browser can hold: a Spotlight hoist hangs its chain as 854 links, each a
// 6,160-triangle solid 31 mm long, and a drawing with 75 hoists would need 395 million triangles
// (14 GB). Each part's triangles over all its placements are kept to REPEAT_BUDGET, simplified as
// Modify > Simplify Mesh does, its outline the creases of what is left.

/** the most triangles one part takes over all its placements before it is drawn simpler */
const REPEAT_BUDGET = 2_000_000;
/** the fewest triangles a simpler part keeps */
const REPEAT_FLOOR = 48;
/** where the triangles each side of an edge turn more than this (cos 40°), it is drawn */
const SIMPLER_CREASE = Math.cos((40 * Math.PI) / 180);
const SYMBOL_DEFINITION = 16;

/** How many times each symbol definition is placed: an instance in a definition counts once for each time that one is placed. */
function placementsOf(doc: Model): Map<Rec, number> {
  const uses = new Map<Rec, (Rec | null)[]>();
  for (const r of doc.recs) {
    if (r.type !== SYMBOL_INSTANCE) continue;
    const def = doc.symbols.get(u16(r.data, 0x8e));
    if (!def) continue;
    let p = r.parent;
    while (p && p.type !== SYMBOL_DEFINITION) p = p.parent;
    const list = uses.get(def);
    if (list) list.push(p);
    else uses.set(def, [p]);
  }
  const out = new Map<Rec, number>();
  const count = (def: Rec, depth: number): number => {
    const known = out.get(def);
    if (known !== undefined) return known;
    // a definition that holds itself counts once
    out.set(def, 1);
    let n = 0;
    for (const p of uses.get(def) ?? []) n += p && depth < MAX_SYMBOL_DEPTH ? count(p, depth + 1) : 1;
    out.set(def, Math.max(1, n));
    return out.get(def)!;
  };
  for (const def of uses.keys()) count(def, 0);
  return out;
}

/** simpler geometry by the record it belongs to and which of its geometries it is */
const simplerCache = new WeakMap<Uint8Array, Map<string, BodyGeometry>>();

/** `g` as drawn where it is placed `ctx.repeat` times: itself, or simpler when that would take too many triangles. */
function forRepeat(ctx: Ctx, g: BodyGeometry, owner: Rec): BodyGeometry {
  const n = g.triangles.length / 9;
  if (ctx.raw || ctx.repeat <= 1 || n <= REPEAT_FLOOR || n * ctx.repeat <= REPEAT_BUDGET) return g;
  const keep = Math.max(REPEAT_FLOOR, Math.floor(REPEAT_BUDGET / ctx.repeat));
  const key = `${n} ${g.triangles[0]} ${g.triangles[1]} ${g.triangles[2]} ${keep}`;
  let cache = simplerCache.get(owner.data);
  const hit = cache?.get(key);
  if (hit) return hit;
  const corners = n * 3;
  const uvs = g.uvs && g.uvs.length === corners * 2 ? g.uvs : undefined;
  const s = simplifyMesh(
    {
      points: g.triangles,
      triangles: Array.from({ length: corners }, (_, i) => i),
      parts: new Uint8Array(n),
      ...(uvs ? { carried: { values: uvs, size: 2 } } : {}),
    },
    keep / n,
  );
  const triangles = new Float64Array(s.triangles.length * 3);
  s.triangles.forEach((v, i) => triangles.set(s.points.slice(3 * v, 3 * v + 3), 3 * i));
  const simpler: BodyGeometry = { triangles, edges: creases(s.points, s.triangles) };
  if (uvs) simpler.uvs = Float64Array.from(s.triangles.flatMap((v) => [s.carried[2 * v], s.carried[2 * v + 1]]));
  if (!cache) simplerCache.set(owner.data, (cache = new Map()));
  cache.set(key, simpler);
  return simpler;
}

/** The edges of a mesh (vertex points, three vertex numbers a triangle) that are open or where it turns, as pairs of points. */
function creases(points: readonly number[], triangles: readonly number[]): Float64Array {
  const at = (v: number): string => `${points[3 * v]},${points[3 * v + 1]},${points[3 * v + 2]}`;
  const normals: number[][] = [];
  const sides = new Map<string, { a: number; b: number; tris: number[] }>();
  for (let t = 0; t < triangles.length / 3; t++) {
    const [a, b, c] = [triangles[3 * t], triangles[3 * t + 1], triangles[3 * t + 2]];
    const u = [0, 1, 2].map((k) => points[3 * b + k] - points[3 * a + k]);
    const w = [0, 1, 2].map((k) => points[3 * c + k] - points[3 * a + k]);
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const len = Math.hypot(nx, ny, nz) || 1;
    normals.push([nx / len, ny / len, nz / len]);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const [kp, kq] = [at(p), at(q)];
      const key = kp < kq ? `${kp}|${kq}` : `${kq}|${kp}`;
      const side = sides.get(key);
      if (side) side.tris.push(t);
      else sides.set(key, { a: p, b: q, tris: [t] });
    }
  }
  const out: number[] = [];
  for (const { a, b, tris } of sides.values()) {
    const [n0, n1] = [normals[tris[0]], normals[tris[1]]];
    if (tris.length === 2 && n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] > SIMPLER_CREASE) continue;
    out.push(points[3 * a], points[3 * a + 1], points[3 * a + 2], points[3 * b], points[3 * b + 1], points[3 * b + 2]);
  }
  return Float64Array.from(out);
}

function emit(ctx: Ctx, given: BodyGeometry, m: Xf, owner: Rec, topId: string): void {
  if (!given.triangles.length && !given.edges.length) return;
  const g = forRepeat(ctx, given, owner);
  // a mirroring placement (a flipped symbol) turns faces inside out unless their corners run the other way
  const mirrored = det3(m) < 0;
  if (ctx.tree) {
    const piece = treePiece(ctx, g, m, owner, mirrored);
    if (piece) ctx.tree.node(topId).pieces.push(piece);
    return;
  }
  if (ctx.raw) {
    const triangles = new Float64Array(g.triangles.length);
    apply(m, g.triangles, triangles);
    if (mirrored) rewind(triangles, 3);
    if (triangles.length) ctx.raw.push({ owner, triangles });
    return;
  }
  const look = ctx.look ?? owner;
  const a = ctx.doc.attrsOf(look);
  const texture = textureOf(ctx.doc, look, ctx.texture);
  // a texture cut out by a mask (a plant's leaves, an image prop) shows no outline
  const cutout = ctx.textures.get(texture)?.mask !== undefined;
  const triangles = new Float32Array(g.triangles.length);
  const edges = new Float32Array(cutout ? 0 : g.edges.length);
  apply(m, g.triangles, triangles);
  if (mirrored) rewind(triangles, 3);
  if (!cutout) apply(m, g.edges, edges);
  const uvs = g.uvs && g.uvs.length * 3 === g.triangles.length * 2 ? Float32Array.from(g.uvs) : null;
  if (uvs && mirrored) rewind(uvs, 2);
  ctx.out.push({
    objectId: topId,
    layerId: ctx.layerId,
    classIndex: look.classIndex,
    triangles,
    edges,
    color: fillColour(ctx, a),
    opacity: a ? Math.max(0, Math.min(1, a.fillOpacity / 100)) : 1,
    texture,
    ...(ctx.part ? { partId: ctx.part } : {}),
    ...(ctx.instance ? { instance: ctx.instance } : {}),
    ...(uvs ? { uvs } : {}),
    ...(ctx.recessed ? { recessed: true } : {}),
  });
}

/** What emit gives buildModelTree: the faces placed by m at full precision, an open 3D polygon's points or a locus's place; null for edges alone. */
function treePiece(ctx: Ctx, g: BodyGeometry, m: Xf, owner: Rec, mirrored: boolean): ModelTreePiece | null {
  const look = ctx.look ?? owner;
  const a = ctx.doc.attrsOf(look);
  const piece: ModelTreePiece = {
    classIndex: look.classIndex,
    color: fillColour(ctx, a),
    opacity: a ? Math.max(0, Math.min(1, a.fillOpacity / 100)) : 1,
    texture: textureOf(ctx.doc, look, ctx.texture),
    triangles: new Float64Array(g.triangles.length),
  };
  const placed = (src: ArrayLike<number>): number[] => {
    const out = new Float64Array(src.length);
    apply(m, src, out);
    return Array.from(out);
  };
  if (!g.triangles.length) {
    const e = g.edges;
    if (owner.type === POLY3D && e.length >= 6) {
      // its edges run end to end
      const points = [e[0], e[1], e[2]];
      for (let i = 3; i < e.length; i += 6) points.push(e[i], e[i + 1], e[i + 2]);
      return { ...piece, line: placed(points) };
    }
    // the middle of its cross
    if (owner.type === LOCUS3D && e.length >= 6) return { ...piece, point: placed([(e[0] + e[3]) / 2, (e[1] + e[4]) / 2, (e[2] + e[5]) / 2]) };
    return null;
  }
  apply(m, g.triangles, piece.triangles);
  if (mirrored) rewind(piece.triangles, 3);
  if (g.uvs && g.uvs.length * 3 === g.triangles.length * 2) {
    piece.uvs = Float64Array.from(g.uvs);
    if (mirrored) rewind(piece.uvs, 2);
  }
  if (g.faces) {
    // a mirroring placement runs each face's corners the other way, so it still looks out
    const back = (v: readonly number[], n: number): number[] => {
      const out: number[] = [];
      for (let i = v.length - n; i >= 0; i -= n) out.push(...v.slice(i, i + n));
      return out;
    };
    piece.faces = g.faces.map((f) => {
      const corners = placed(f.corners);
      if (!mirrored) return { corners, ...(f.uvs ? { uvs: f.uvs.slice() } : {}) };
      return { corners: back(corners, 3), ...(f.uvs ? { uvs: back(f.uvs, 2) } : {}) };
    });
  }
  return piece;
}

/**
 * The symbol `def` (name index `index`) as buildModelTree keeps it: walked once in its own frame for
 * each texture it inherits, the symbols it places first; its index in the tree, or -1 when it shows nothing.
 */
function treeSymbol(ctx: Ctx, def: Rec, index: number): number {
  const tree = ctx.tree!;
  const key = `${index}/${ctx.texture}`;
  const had = tree.made.get(key);
  if (had !== undefined) return had;
  if (tree.making.has(def) || ctx.depth >= MAX_SYMBOL_DEPTH) return -1;
  tree.making.add(def);
  const content: ModelTreeNode = { pieces: [], instances: [], groups: [] };
  const node = tree.node;
  tree.node = () => content;
  ctx.depth++;
  walk(ctx, def, IDENTITY, "");
  ctx.depth--;
  tree.node = node;
  tree.making.delete(def);
  const name = ctx.doc.names.get(index) ?? `Symbol ${index}`;
  // the same symbol inside an object with a texture (a group's, a plug-in's) shows it where it has none of its own
  const texture = ctx.texture > 0 ? ctx.doc.names.get(ctx.texture) : undefined;
  const k = content.pieces.length || content.instances.length || content.groups.length ? tree.symbols.push({ name: texture ? `${name} (${texture})` : name, content }) - 1 : -1;
  tree.made.set(key, k);
  return k;
}

function walk(ctx: Ctx, parent: Rec, m: Xf, topId: string | null): void {
  const outer = ctx.texture;
  const outerRecessed = ctx.recessed;
  ctx.texture = textureOf(ctx.doc, parent, outer);
  walkChildren(ctx, parent, m, topId);
  ctx.texture = outer;
  ctx.recessed = outerRecessed;
}

/** A wall whose components have solids of their own, which its group repeats (see Walls above). */
function hasComponentSolids(r: Rec): boolean {
  return r.type === WALL && r.children.some((c) => c.type === SOLID_ADDITION && c.children.some((k) => k.type === BODY));
}

function walkChildren(ctx: Ctx, parent: Rec, m: Xf, topId: string | null): void {
  const components = hasComponentSolids(parent);
  const wall = parent.type === WALL;
  // in a top-level group, and the groups in it, each object that isn't a group is the part its faces come from
  const outerPart = ctx.part;
  const outerChain = ctx.chain;
  const members = parent.type === GROUP && ctx.chain === parent;
  for (const c of parent.children) {
    if (NOT_GEOMETRY.has(c.type) || PLAN_ONLY.has(c.type)) continue;
    const top = topId ?? guidOf(c);
    if (topId === null || members) {
      ctx.chain = c.type === GROUP ? c : undefined;
      ctx.part = c.type === GROUP || topId === null ? undefined : guidOf(c);
    }
    // the doors and windows in a wall are its children too; only its own faces sit back
    if (wall) ctx.recessed = c.type === GROUP || c.type === SOLID_ADDITION;
    if (c.type === BODY) continue; // read by its owner
    if (parent.type === PLUGIN && isSourceGroup(c)) continue;
    if (components && c.type === GROUP) {
      walk(ctx, c, m, top);
      continue;
    }
    // a plug-in object's parts are in its own coordinates, placed by its matrix
    const at = c.type === PLUGIN ? compose(m, pluginXf(c)) : m;
    // a design-layer viewport shows layers, placed by its matrix as a plug-in's parts are
    const shows = c.type === PLUGIN ? ctx.doc.dlvpShows(c) : null;
    if (shows) {
      if (ctx.depth < MAX_SYMBOL_DEPTH) {
        ctx.depth++;
        for (const l of shows.layers) walk(ctx, l.rec, at, top);
        ctx.depth--;
      }
      continue;
    }
    if (c.type === PLUGIN && ctx.doc.pluginName(c) === SITE_MODEL) {
      const tin = tinGeometry(c);
      if (tin) {
        emit(ctx, tin, at, c, top);
        continue;
      }
    }
    // a sweep is turned from its profile, bodied or not: its body's curved faces don't rebuild
    const lathe = c.type === SWEEP ? sweepGeometry(c) : null;
    if (lathe) {
      const own = readXf(c.data, OWNER_MATRIX, OWNER_OFFSET);
      emit(ctx, lathe, own ? compose(at, own) : at, c, top);
      continue;
    }
    const bodies = c.children.filter((k) => k.type === BODY);
    if (bodies.length) {
      // extrudes and sweeps cache their body in their own frame, multiple extrudes and solid
      // additions in their parent's (FORMAT.md §3D)
      const own = MATRIX_OWNERS.has(c.type) && !BODY_IN_PARENT.has(c.type) ? readXf(c.data, OWNER_MATRIX, OWNER_OFFSET) : null;
      const mm = own ? compose(at, own) : at;
      for (const b of bodies) {
        const g = bodyGeometry(b);
        if (g) emit(ctx, g, mm, c, top);
      }
      // a body is the owner's whole result; only groups also hold further objects
      if (c.type === GROUP) walk(ctx, c, m, top);
      continue;
    }
    if (c.type === SOLID_ADDITION) {
      // a solid saved without its body (only those openvwx makes): its operands, in its own frame
      const own = readXf(c.data, OWNER_MATRIX, OWNER_OFFSET);
      const mm = own ? compose(at, own) : at;
      const ops = objectChildren(c);
      // its operands are drawn in its look, as its body would be (the outermost solid's)
      const outer = ctx.look;
      ctx.look ??= c;
      if (c.data[SOLID_KIND] !== SOLID_SUBTRACT) walk(ctx, c, mm, top);
      else {
        const g = subtractionGeometry(ctx.doc, c);
        if (g) emit(ctx, g, mm, c, top);
        // too detailed to cut: the first operand uncut
        else if (ops.length) walkChildren(ctx, { type: -1, children: [ops[0]] } as unknown as Rec, mm, top);
      }
      ctx.look = outer;
      continue;
    }
    if (c.type === EXTRUDE || c.type === MULTI_EXTRUDE) {
      const g = c.type === EXTRUDE ? extrudeGeometry(c) : multiExtrudeGeometry(c);
      const own = readXf(c.data, OWNER_MATRIX, OWNER_OFFSET);
      if (g) emit(ctx, g, own ? compose(m, own) : m, c, top);
      continue;
    }
    if (c.type === LOCUS3D) {
      const g = locus3dGeometry(c);
      if (g) emit(ctx, g, m, c, top);
      continue;
    }
    if (c.type === POLY3D) {
      const g = poly3dGeometry(c);
      const uvs = g ? planeUvs(ctx, c, g.triangles) : null;
      if (g) emit(ctx, uvs ? { ...g, uvs } : g, m, c, top);
      continue;
    }
    if (c.type === MESH) {
      const outer = ctx.texture;
      const map = meshUvMap(c);
      ctx.texture = map ? map.texture : textureOf(ctx.doc, c, outer);
      for (const [face, g] of meshGeometry(ctx.doc, c, ctx.texture, map?.uvs ?? null, !!ctx.tree)) emit(ctx, g, m, face, top);
      ctx.texture = outer;
      continue;
    }
    if (c.type === SYMBOL_INSTANCE) {
      const index = u16(c.data, 0x8e);
      const def = ctx.doc.symbols.get(index);
      const inst = instanceXf(c.data);
      if (def && inst && ctx.tree) {
        const symbol = treeSymbol(ctx, def, index);
        const name = c.nameIndex ? ctx.doc.names.get(c.nameIndex) : undefined;
        if (symbol >= 0) ctx.tree.node(top).instances.push({ symbol, matrix: Array.from(compose(m, inst)), id: guidOf(c), ...(name ? { name } : {}), classIndex: c.classIndex });
      } else if (def && inst && ctx.depth < MAX_SYMBOL_DEPTH) {
        const repeat = ctx.repeat;
        ctx.repeat = Math.max(repeat, ctx.placements?.get(def) ?? 1);
        const placed = compose(m, inst);
        const outerInstance = ctx.instance;
        // one that is an object of its own (on the layer, or a part) places its definition whole
        const id = guidOf(c);
        if (!ctx.instance && (top === id || ctx.part === id)) ctx.instance = { id, symbol: index, matrix: Array.from(placed) };
        ctx.depth++;
        walk(ctx, def, placed, top);
        ctx.depth--;
        ctx.repeat = repeat;
        ctx.instance = outerInstance;
      }
      continue;
    }
    // for buildModelTree, a group in a group or a symbol is a group of its own
    if (ctx.tree && c.type === GROUP && (parent.type === GROUP || parent.type === SYMBOL_DEFINITION)) {
      const tree = ctx.tree;
      const name = c.nameIndex ? ctx.doc.names.get(c.nameIndex) : undefined;
      const group: ModelTreeGroup = { id: guidOf(c), ...(name ? { name } : {}), classIndex: c.classIndex, pieces: [], instances: [], groups: [] };
      tree.node(top).groups.push(group);
      const node = tree.node;
      tree.node = () => group;
      walk(ctx, c, at, top);
      tree.node = node;
      continue;
    }
    if (c.children.length) walk(ctx, c, at, top);
  }
  ctx.part = outerPart;
  ctx.chain = outerChain;
}

/**
 * The faces one object shows in 3D as triangles (9 numbers each), in the frame of the layer or
 * group holding it, with the record each run of them takes its attributes
 * from: a body's owner, a mesh face, the object itself.
 */
export function objectTriangles(doc: Model, r: Rec): { owner: Rec; triangles: Float64Array }[] {
  const raw: { owner: Rec; triangles: Float64Array }[] = [];
  const ctx: Ctx = { doc, fills: new Map(), textures: new Map(), layerId: "", out: [], depth: 0, texture: -1, recessed: false, raw, repeat: 1 };
  // as the one child of a holder, so the object's own type is dispatched on
  walkChildren(ctx, { type: -1, children: [r] } as unknown as Rec, IDENTITY, "");
  return raw;
}

/**
 * One light object as it is placed by `m`, or null when its fields don't read; `ground` is the
 * elevation of the layer it is on, which its own height is shown above when the drawing places it.
 */
function readLight(doc: Model, r: Rec, m: Xf, objectId: string, layerId: string, placedBy: Light3D["placedBy"], ground: number): Light3D | null {
  const d = r.data;
  const kind = LIGHT_KINDS[u16(d, LIGHT_KIND)];
  if (!kind || d.length < LIGHT_BEAM + 8) return null;
  const triple = (at: number): number[] => [f64(d, at), f64(d, at + 8), f64(d, at + 16)];
  const local = triple(LIGHT_AT);
  const aim = triple(lightAim(d));
  const rgb = triple(LIGHT_COLOR);
  const brightness = f64(d, LIGHT_BRIGHTNESS);
  const spread = f64(d, LIGHT_SPREAD);
  const beam = f64(d, LIGHT_BEAM);
  if (![...local, ...aim, ...rgb, brightness, spread, beam].every(Number.isFinite)) return null;
  const position = new Float64Array(3);
  apply(m, local, position);
  // the direction turns with the matrix but isn't moved by it
  const linear = Float64Array.from(m);
  linear.fill(0, 9);
  const turned = new Float64Array(3);
  apply(linear, aim, turned);
  const length = Math.hypot(...turned);
  const ownLength = Math.hypot(...aim);
  const hex = rgb.map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0")).join("");
  const name = doc.names.get(r.nameIndex);
  return {
    id: guidOf(r),
    objectId,
    layerId,
    classIndex: r.classIndex,
    ...(name ? { name } : {}),
    kind,
    on: d[LIGHT_ON] !== 0,
    position: [position[0], position[1], position[2]] as Vec3,
    direction: (length > 0 ? [turned[0] / length, turned[1] / length, turned[2] / length] : [0, 0, -1]) as Vec3,
    own: {
      position: [local[0], local[1], local[2] - (placedBy === "drawing" ? ground : 0)],
      direction: ownLength > 0 ? [aim[0] / ownLength, aim[1] / ownLength, aim[2] / ownLength] : [0, 0, -1],
    },
    color: `#${hex}`,
    brightness: Math.max(0, brightness),
    spread: Math.max(0, spread),
    beam: Math.max(0, Math.min(beam, spread)),
    placedBy,
  };
}

/** Writes `change` into a light object's record data, or throws, leaving `d` as it was, on a value it can't take. */
export function writeLight(d: Uint8Array, change: LightChange): void {
  if (d.length < LIGHT_BEAM + 8) throw new Error("this light's record is too short to change");
  const kind = change.kind === undefined ? undefined : LIGHT_KINDS.indexOf(change.kind);
  if (kind === -1) throw new Error(`no light kind ${change.kind}`);
  const rgb = change.color === undefined ? undefined : /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(change.color);
  if (rgb === null) throw new Error("a light's colour is #rrggbb");
  for (const v of [change.brightness, change.spread, change.beam]) {
    if (v !== undefined && !(Number.isFinite(v) && v >= 0)) throw new Error("a light's brightness and angles are numbers of 0 or more");
  }
  const at = change.position;
  if (at && !(at.length === 3 && at.every(Number.isFinite))) throw new Error("a light's position is three numbers");
  const aim = change.direction;
  const aimLength = aim ? Math.hypot(...aim) : 0;
  if (aim && !(aim.length === 3 && aim.every(Number.isFinite) && aimLength > 0)) throw new Error("a light's direction is three numbers, not all 0");
  const spread = change.spread ?? f64(d, LIGHT_SPREAD);
  if (spread > Math.PI) throw new Error("a spot light's spread is at most 180°");
  if (change.beam !== undefined && change.beam > spread) throw new Error("a spot light's beam can't be wider than its spread");
  if (change.on !== undefined) d[LIGHT_ON] = change.on ? 1 : 0;
  if (kind !== undefined) setU16(d, LIGHT_KIND, kind);
  if (rgb) rgb.slice(1).forEach((hex, i) => setF64(d, LIGHT_COLOR + 8 * i, parseInt(hex, 16) / 255));
  if (change.brightness !== undefined) setF64(d, LIGHT_BRIGHTNESS, change.brightness);
  if (change.spread !== undefined) setF64(d, LIGHT_SPREAD, change.spread);
  if (change.beam !== undefined) setF64(d, LIGHT_BEAM, change.beam);
  else if (f64(d, LIGHT_BEAM) > spread) setF64(d, LIGHT_BEAM, spread);
  if (at) {
    // in plan as a move, so its plan box goes with it
    translateRecord(d, LIGHT, at[0] - f64(d, LIGHT_AT), at[1] - f64(d, LIGHT_AT + 8));
    setF64(d, LIGHT_AT + 16, at[2]);
  }
  // into the direction its kind reads
  if (aim) aim.forEach((v, i) => setF64(d, lightAim(d) + 8 * i, v / aimLength));
}

/**
 * The light objects the design layers place, through their groups, symbols and plug-ins, in the
 * model's frame. A Heliodon's own light is left out: it is the sun.
 */
export function buildLights3d(doc: Model): Light3D[] {
  const out: Light3D[] = [];
  // whether a container holds a light anywhere, so symbols placed many times are searched once
  const holds = new Map<Rec, boolean>();
  const lit = (r: Rec, depth: number): boolean => {
    let v = holds.get(r);
    if (v !== undefined) return v;
    holds.set(r, false);
    v = r.children.some((c) => {
      if (c.type === LIGHT) return true;
      if (c.type === SYMBOL_INSTANCE) {
        const def = doc.symbols.get(u16(c.data, 0x8e));
        return !!def && depth < MAX_SYMBOL_DEPTH && lit(def, depth + 1);
      }
      return !NOT_GEOMETRY.has(c.type) && !PLAN_ONLY.has(c.type) && c.type !== BODY && c.children.length > 0 && lit(c, depth);
    });
    holds.set(r, v);
    return v;
  };
  // `by`: what places the lights found, the drawing until a symbol or plug-in is on the way down
  const visit = (parent: Rec, m: Xf, topId: string | null, layerId: string, depth: number, by: Light3D["placedBy"], ground: number): void => {
    for (const c of parent.children) {
      if (NOT_GEOMETRY.has(c.type) || PLAN_ONLY.has(c.type) || c.type === BODY) continue;
      const top = topId ?? guidOf(c);
      if (c.type === LIGHT) {
        const light = readLight(doc, c, m, top, layerId, by, ground);
        if (light) out.push(light);
      } else if (c.type === SYMBOL_INSTANCE) {
        const def = doc.symbols.get(u16(c.data, 0x8e));
        const inst = instanceXf(c.data);
        if (def && inst && depth < MAX_SYMBOL_DEPTH && lit(def, depth + 1)) visit(def, compose(m, inst), top, layerId, depth + 1, by === "plugin" ? by : "symbol", ground);
      } else if (c.type === PLUGIN) {
        const name = doc.pluginName(c);
        if (name === HELIODON || !lit(c, depth)) continue;
        const from = out.length;
        const frame = compose(m, pluginXf(c));
        visit(c, frame, top, layerId, depth, "plugin", ground);
        if (isLightingDevice(name)) out.splice(from, out.length - from, ...deviceLights(doc, c, m, frame, out.slice(from)));
      } else if (c.children.length && lit(c, depth)) visit(c, m, top, layerId, depth, by, ground);
    }
  };
  for (const layer of doc.layerRecs) {
    if (layer.data[layerKindAt(layer.data)] !== 1) continue;
    visit(layer, IDENTITY, null, guidOf(layer), 0, "drawing", layerElevationOf(layer));
  }
  return out;
}

/**
 * A lighting device's lights as its parameters make them (lightingDevice.ts): on, coloured, bright and
 * spread as they say, shining along its pan and tilt in its `frame` (as `parent` places it), from just
 * past the fixture's body that way, so its own body doesn't stand in the beam.
 */
function deviceLights(doc: Model, device: Rec, parent: Xf, frame: Xf, lights: readonly Light3D[]): Light3D[] {
  const rec = doc.records(guidOf(device)).find((r) => r.parametric);
  if (!rec || !lights.length) return [...lights];
  const d = readDeviceLight(rec.fields);
  const linear = Float64Array.from(frame);
  linear.fill(0, 9);
  const turned = new Float64Array(3);
  apply(linear, axisOf(d), turned);
  const length = Math.hypot(...turned);
  const direction: Vec3 = length > 0 ? [turned[0] / length, turned[1] / length, turned[2] / length] : [0, 0, -1];
  const origin = new Float64Array(3);
  apply(frame, [0, 0, 0], origin);
  const on = d.on ?? lights.some((l) => l.on);
  // the lens: as far along the beam as the fixture's body reaches (worked out only for a light that shows)
  let reach = 0;
  if (on) {
    const at = new Float64Array(3);
    for (const { triangles } of objectTriangles(doc, device)) {
      for (let i = 0; i + 2 < triangles.length; i += 3) {
        apply(parent, [triangles[i], triangles[i + 1], triangles[i + 2]], at);
        reach = Math.max(reach, (at[0] - origin[0]) * direction[0] + (at[1] - origin[1]) * direction[1] + (at[2] - origin[2]) * direction[2]);
      }
    }
  }
  const lens: Vec3 = reach > 0 ? [origin[0] + direction[0] * (reach + LENS_GAP), origin[1] + direction[1] * (reach + LENS_GAP), origin[2] + direction[2] * (reach + LENS_GAP)] : [origin[0], origin[1], origin[2]];
  return lights.map((l) => {
    const spread = d.spread ?? l.spread;
    return {
      ...l,
      kind: "spot",
      on,
      position: lens,
      direction,
      color: d.color ?? l.color,
      brightness: d.brightness ?? l.brightness,
      spread,
      beam: Math.min(d.beam ?? l.beam, spread),
      device: true,
    };
  });
}

/** The resources the walk colours and maps by: hatch, tile and gradient fills, and textures with an image. */
function walkResources(doc: Model): Pick<Ctx, "fills" | "textures"> {
  const fills = new Map<number, ResourceInfo>();
  const textures = new Map<number, ResourceInfo>();
  for (const r of doc.resources()) {
    if (r.hatch || r.tile || r.gradient) fills.set(r.index, r);
    if (r.kind === "texture" && r.image) textures.set(r.index, r);
  }
  return { fills, textures };
}

export function buildModel3d(doc: Model): Mesh3D[] {
  const out: Mesh3D[] = [];
  const resources = walkResources(doc);
  const placements = placementsOf(doc);
  for (const layer of doc.layerRecs) {
    if (layer.data[layerKindAt(layer.data)] !== 1) continue;
    const ctx: Ctx = { doc, ...resources, layerId: guidOf(layer), out, depth: 0, texture: -1, recessed: false, placements, repeat: 1 };
    walk(ctx, layer, IDENTITY, null);
  }
  return out;
}

/**
 * The design layers' model as buildModel3d walks it, with its symbols kept as placements (see
 * ModelTree). Each symbol is defined once, so its faces stay whole however often it is placed.
 */
export function buildModelTree(doc: Model): ModelTree {
  const resources = walkResources(doc);
  const objects: ModelTree["objects"] = [];
  const tree: TreeCtx = { node: () => ({ pieces: [], instances: [], groups: [] }), symbols: [], made: new Map(), making: new Set() };
  for (const layer of doc.layerRecs) {
    if (layer.data[layerKindAt(layer.data)] !== 1) continue;
    const layerId = guidOf(layer);
    const byId = new Map<string, ModelTree["objects"][number]>();
    tree.node = (id) => {
      let n = byId.get(id);
      if (!n) {
        n = { id, layerId, pieces: [], instances: [], groups: [] };
        byId.set(id, n);
        objects.push(n);
      }
      return n;
    };
    walk({ doc, ...resources, layerId, out: [], depth: 0, texture: -1, recessed: false, repeat: 1, tree }, layer, IDENTITY, null);
  }
  return { symbols: tree.symbols, objects };
}

/**
 * A symbol definition's 3D geometry in its own coordinates, walked as a layer is: the objects it
 * holds are the top-level ones. Its layerId is "".
 */
export function buildSymbolModel3d(doc: Model, def: Rec): Mesh3D[] {
  const out: Mesh3D[] = [];
  // drawn in full, as an export writes it once
  const ctx: Ctx = { doc, ...walkResources(doc), layerId: "", out, depth: 0, texture: -1, recessed: false, repeat: 1 };
  walk(ctx, def, IDENTITY, null);
  return out;
}
