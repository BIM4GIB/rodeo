// The 3D model as a SketchUp file (.skp), so a drawing's model opens in SketchUp as its own: written
// by openskp's writer (MIT, worked out from the files themselves, no SketchUp SDK) in the format of
// SketchUp 2013 to 2020, which every later SketchUp opens. Inches, z up, as SketchUp keeps every model.
// Each symbol placed is a component, defined once in its own frame and placed by its full matrix
// (turned, mirrored, scaled), inside the components it is placed in too. Each top-level object on
// the design layers the 3D view shows is a group named as the object, or, a symbol placed on its
// own, its component's instance; a group inside one, or inside a symbol, is a group inside that. Classes are tags (None is Untagged, a hidden class a hidden tag):
// a group or instance is on its class's tag, a face on its own object's where that differs. Each
// colour and opacity is a material, painted on both sides of its faces; a texture with a PNG or
// JPEG image is a textured material at the image's size, each face's corners pinned where the 3D
// view puts them on it (the object's own UV map, else the image projected along the face's main
// axis, in the frame of the component or group the face is in). A mesh's faces stay its faces;
// what the drawing knows only as triangles (walls, extrudes, solids, ...) has its coplanar
// triangles of one look joined into faces again, holes and all, and the edges between faces less
// than 20° apart softened and smoothed, so a curved surface reads as SketchUp shows one. Open 3D
// polygons are edges, and 3D loci not in symbols guide points. Lights, texts, dimensions and the
// 2D objects are left out. It is read back by import/skp.ts.

import { create, SkpWriteError, type ComponentDefinitionBuilder, type Matrix3x3, type Point3, type SkpBuilder, type UvPair } from "openskp";
import type { ModelTreeGroup, ModelTreeInstance, ModelTreeNode, ModelTreePiece, VwxDocument } from "../core/types.ts";

const MM_PER_INCH = 25.4;
/** faces closer in angle than this have the edge between them softened and smoothed (20°, SketchUp's own default) */
const SOFT = Math.cos((20 * Math.PI) / 180);
/** how far a corner may lie off the plane of a face it is joined into, in mm (well inside openskp's own check) */
const PLANE_TOL = 1e-5;
/** how far apart two (u, v) may be, over their size, and still be the same place on an image */
const UV_TOL = 1e-6;
/** a triangle's doubled area below this (mm²) draws nothing */
const SLIVER = 1e-6;
/** corners are welded at this many steps a millimetre */
const WELD = 1e5;
/** the size an image is tiled at when its texture doesn't say, as the 3D view takes it (mm) */
const DEFAULT_IMAGE_MM = 1000;
/** SketchUp's own name for Untagged, which no tag may take */
const UNTAGGED = "Layer0";

type Vec = [number, number, number];

/** A SketchUp file written, with what went into it. */
export interface SkpFile {
  bytes: Uint8Array;
  /** components defined */
  components: number;
  /** top-level groups */
  groups: number;
  /** faces written, each component's once */
  faces: number;
  /** textures whose image couldn't go (not a PNG or JPEG): their faces take the texture's colour */
  texturesLeftOut: number;
}

/** A material written, and with a texture, how its image lies on faces. */
interface Look {
  material: number;
  /** the image's applied size in inches, as SketchUp keeps it, and the size the 3D view tiles it at (mm) */
  texture?: { width: number; height: number; tile: number };
}

/** A face to write: corner numbers into its node's corners, round its outside then round each hole. */
interface Face {
  loops: number[][];
  /** the triangles it was joined from, each three corner numbers, written instead should openskp refuse it */
  triangles: number[][];
  normal: Vec;
  look: Look;
  /** a key that tells looks apart */
  lookKey: string;
  tag: number | undefined;
  /** (u, v) at its corners, in fractions of the image: its own, else null for the image projected */
  uv: Map<number, [number, number]> | null;
}

/** One node's corners, welded: their place in mm, and once written, in inches. */
class Corners {
  readonly at: Vec[] = [];
  private readonly index = new Map<string, number>();
  private readonly inches: (Point3 | undefined)[] = [];

  id(x: number, y: number, z: number): number {
    const key = `${Math.round(x * WELD)},${Math.round(y * WELD)},${Math.round(z * WELD)}`;
    let k = this.index.get(key);
    if (k === undefined) {
      k = this.at.push([x, y, z]) - 1;
      this.index.set(key, k);
    }
    return k;
  }

  /** a corner in inches, the same numbers each time, so openskp shares the vertex */
  point(k: number): Point3 {
    let p = this.inches[k];
    if (!p) {
      const [x, y, z] = this.at[k];
      p = this.inches[k] = [x / MM_PER_INCH, y / MM_PER_INCH, z / MM_PER_INCH];
    }
    return p;
  }
}

const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec): number => Math.hypot(a[0], a[1], a[2]);
const edgeKey = (a: number, b: number): string => (a < b ? `${a}_${b}` : `${b}_${a}`);

/** A loop's normal times twice its area (Newell's). */
function newell(c: Corners, loop: readonly number[]): Vec {
  const n: Vec = [0, 0, 0];
  for (let i = 0; i < loop.length; i++) {
    const a = c.at[loop[i]];
    const b = c.at[loop[(i + 1) % loop.length]];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

/** "#rrggbb" as three 0..255 channels; grey when it does not read. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [204, 204, 204];
}

/** An image's kind from its first bytes: the two SketchUp keeps in a material. */
function imageKind(b: Uint8Array): "png" | "jpg" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

/** "Wall", then "Wall#1", "Wall#2" for the next ones (as SketchUp numbers its own), once each. */
function namer(): (name: string) => string {
  const taken = new Set<string>();
  return (name) => {
    let out = name;
    for (let n = 1; taken.has(out); n++) out = `${name}#${n}`;
    taken.add(out);
    return out;
  };
}

/**
 * openskp gives each edge the soft and smooth flags of the first face that draws it, all that
 * face's new edges alike. A face whose edges differ (a cylinder's side strip, hard where it meets
 * its caps and soft between strips) needs each its own: the returned function sets the flags of
 * the new edges the next face draws, in the order it draws them, through the definition writer's
 * record header, whose only call with five arguments is an edge's.
 */
function edgeFlags(skp: SkpBuilder): (flags: boolean[]) => () => boolean {
  type Drawbase = (material?: number, layer?: number, hidden?: boolean, soft?: boolean, smooth?: boolean) => void;
  let queue: boolean[] = [];
  let at = 0;
  let hooked: unknown = null;
  return (flags) => {
    const writer = (skp as unknown as { _definitionWriter(): { drawbase: Drawbase } | null })._definitionWriter();
    if (writer && writer !== hooked) {
      const plain = writer.drawbase;
      writer.drawbase = function (this: unknown, ...args: Parameters<Drawbase>): void {
        if (args.length === 5 && at < queue.length) {
          args[3] = queue[at];
          args[4] = queue[at++];
        }
        plain.apply(this, args);
      };
      hooked = writer;
    }
    queue = flags;
    at = 0;
    // whether the face drew as many new edges as it was expected to
    return () => {
      const right = at === queue.length;
      queue = [];
      return right;
    };
  };
}

/** The design layers in `layerIds` as a SketchUp file, their objects hidden from the 3D view left out. */
export function exportSkp(doc: VwxDocument, layerIds: ReadonlySet<string>): SkpFile {
  const tree = doc.model3dTree();
  const shown = new Set(doc.model3d().map((m) => m.objectId));
  const objects = tree.objects.filter((o) => layerIds.has(o.layerId) && shown.has(o.id));
  const info = (id: string) => doc.object(id);
  const classes = new Map(doc.classes().map((c) => [c.index, c]));
  const none = doc.classes().find((c) => c.name === "None")?.index ?? -1;

  // the symbols the objects place, through one another, and which of them draw anything
  const used = new Set<number>();
  const use = (n: ModelTreeNode): void => {
    for (const i of n.instances) {
      if (used.has(i.symbol)) continue;
      used.add(i.symbol);
      use(tree.symbols[i.symbol].content);
    }
    n.groups.forEach(use);
  };
  objects.forEach(use);
  // symbols come before any that place them, so one pass decides
  const draws = tree.symbols.map(() => false);
  const drawsAnything = (n: ModelTreeNode): boolean =>
    n.pieces.some((p) => p.triangles.length >= 9 || (p.line && p.line.length >= 6)) || n.instances.some((i) => draws[i.symbol]) || n.groups.some(drawsAnything);
  tree.symbols.forEach((s, k) => (draws[k] = used.has(k) && drawsAnything(s.content)));
  const within = (n: ModelTreeNode): ModelTreeNode[] => [n, ...n.groups.flatMap(within)];
  const nodes = [...tree.symbols.filter((_, k) => draws[k]).map((s) => s.content), ...objects].flatMap(within);

  const skp = create();

  // materials first: a colour and opacity each, or a texture and opacity
  const textures = new Map(doc.resources().filter((r) => r.kind === "texture").map((r) => [r.index, r]));
  const looks = new Map<string, Look>();
  const materialName = namer();
  const texturesOut = new Set<number>();
  const lookKey = (p: ModelTreePiece): string => {
    const res = p.texture > 0 ? textures.get(p.texture) : undefined;
    if (res?.image && imageKind(res.image)) return `t${p.texture}/${p.opacity}`;
    // one without an image shows its colour in the 3D view too
    if (res?.image) texturesOut.add(p.texture);
    return `${p.color.toLowerCase().slice(0, 7)}/${p.opacity}`;
  };
  const lookOf = (p: ModelTreePiece): Look => looks.get(lookKey(p))!;
  for (const n of nodes) {
    for (const p of n.pieces) {
      if (p.triangles.length < 9) continue;
      const key = lookKey(p);
      if (looks.has(key)) continue;
      const opacity = p.opacity < 1 ? p.opacity : undefined;
      const see = opacity === undefined ? "" : ` ${Math.round(opacity * 100)}%`;
      const res = key.startsWith("t") ? textures.get(p.texture)! : undefined;
      if (res?.image) {
        const tile = res.imageSize && res.imageSize > 0 ? res.imageSize : DEFAULT_IMAGE_MM;
        const width = tile / MM_PER_INCH;
        const px = res.imagePixels;
        const height = px && px.width > 0 && px.height > 0 ? (width * px.height) / px.width : width;
        const name = materialName(`${res.name || "Texture"}${see}`);
        const material = skp.addTextureMaterial(name, res.image, `${res.name || "texture"}.${imageKind(res.image)}`, height, width, opacity);
        looks.set(key, { material, texture: { width, height, tile } });
      } else {
        const color = p.color.toLowerCase().slice(0, 7);
        looks.set(key, { material: skp.addMaterial(materialName(`${color}${see}`), rgb(color), opacity) });
      }
    }
  }

  // then tags: each class anything is in, but None
  const tags = new Map<number, number>();
  const tagName = namer();
  tagName(UNTAGGED);
  const tagOf = (classIndex: number): number | undefined => {
    if (classIndex === none) return undefined;
    let tag = tags.get(classIndex);
    if (tag === undefined) {
      const c = classes.get(classIndex);
      if (!c) return undefined;
      tag = skp.addLayer(tagName(c.name), { hidden: c.visibility === "hidden" });
      tags.set(classIndex, tag);
    }
    return tag;
  };
  for (const n of nodes) {
    n.pieces.forEach((p) => tagOf(p.classIndex));
    n.instances.forEach((i) => tagOf(i.classIndex));
    n.groups.forEach((g) => tagOf(g.classIndex));
  }
  const objectClass = new Map(objects.map((o) => [o.id, info(o.id)?.classIndex ?? none]));
  objectClass.forEach((c) => tagOf(c));

  const flags = edgeFlags(skp);
  const defName = namer();
  const defs: (ComponentDefinitionBuilder | undefined)[] = [];
  let faces = 0;
  // a group in an object or a symbol is defined before what holds it (openskp writes one
  // definition at a time) and placed in it as a group
  const inner = new Map<ModelTreeGroup, ComponentDefinitionBuilder>();
  const define = (n: ModelTreeNode): void => {
    for (const g of n.groups) {
      if (!drawsAnything(g)) continue;
      define(g);
      inner.set(g, skp.addComponentDefinition(defName(g.name || "Group"), (def) => write(def, g, g.classIndex)));
    }
  };
  const write = (target: ComponentDefinitionBuilder, n: ModelTreeNode, own: number): void => {
    faces += writeNode(target, n, own, lookOf, tagOf, flags);
    for (const g of n.groups) {
      const def = inner.get(g);
      const layer = tagOf(g.classIndex);
      // unnamed, as SketchUp leaves a group it makes
      if (def) target.addGroupInstance(def, { name: g.name ?? "", ...(layer !== undefined ? { layer } : {}) });
    }
    for (const i of n.instances) {
      const def = defs[i.symbol];
      if (def) target.addInstance(def, instanceOptions(i, tagOf(i.classIndex)));
    }
  };

  // components, each before any that places it
  tree.symbols.forEach((s, k) => {
    if (!draws[k]) return;
    define(s.content);
    defs[k] = skp.addComponentDefinition(defName(s.name || "Symbol"), (def) => write(def, s.content, none));
  });

  // groups: every object but a symbol placed on its own, then those
  const alone = (o: (typeof objects)[number]): boolean => o.pieces.length === 0 && o.instances.length === 1 && o.instances[0].id === o.id;
  let groups = 0;
  for (const o of objects) {
    if (alone(o) || !drawsAnything(o)) continue;
    const own = objectClass.get(o.id) ?? none;
    const about = info(o.id);
    // its own name, else its kind ("extrude" as "Extrude", "3d-polygon" as "3d polygon")
    const kind = about?.typeName.replace(/-/g, " ").replace(/^./, (a) => a.toUpperCase());
    define(o);
    skp.addGroup((def) => write(def, o, own), { name: defName(about?.name || kind || "Object"), layer: tagOf(own) });
    groups++;
  }
  for (const o of objects) {
    if (!alone(o)) continue;
    const [i] = o.instances;
    const def = defs[i.symbol];
    if (def) skp.addInstance(def, instanceOptions(i, tagOf(i.classIndex)));
  }
  // 3D loci as guide points, which only the model itself holds (the groups, theirs too, are where the layers are)
  for (const n of objects.flatMap(within)) {
    for (const p of n.pieces) if (p.point) skp.addConstructionPoint([p.point[0] / MM_PER_INCH, p.point[1] / MM_PER_INCH, p.point[2] / MM_PER_INCH]);
  }

  return { bytes: skp.toBytes(), components: defs.filter(Boolean).length, groups, faces, texturesLeftOut: texturesOut.size };
}

/** An instance's placement and what it is on, as openskp's addInstance takes them. */
function instanceOptions(i: ModelTreeInstance, layer: number | undefined) {
  const m = i.matrix;
  // openskp's matrix is row by row, x' = m00 x + m01 y + m02 z; the tree's rows are the axes' images
  const matrix3x3: Matrix3x3 = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
  const translation: Point3 = [m[9] / MM_PER_INCH, m[10] / MM_PER_INCH, m[11] / MM_PER_INCH];
  return { matrix3x3, translation, ...(i.name ? { name: i.name } : {}), ...(layer !== undefined ? { layer } : {}) };
}

/**
 * One component's or group's faces and lines, written into `target`: a mesh's faces as they are, others'
 * triangles joined into faces, the edges between faces closer than 20° softened. `own` is the class
 * of what holds them, whose tag their faces don't repeat. Returns how many faces were written.
 */
function writeNode(
  target: ComponentDefinitionBuilder,
  n: ModelTreeNode,
  own: number,
  lookOf: (p: ModelTreePiece) => Look,
  tagOf: (classIndex: number) => number | undefined,
  flags: (flags: boolean[]) => () => boolean,
): number {
  const c = new Corners();
  const list: Face[] = [];
  for (const p of n.pieces) {
    if (p.triangles.length < 9) continue;
    const look = lookOf(p);
    const base = { look, lookKey: String(look.material), tag: p.classIndex === own ? undefined : tagOf(p.classIndex) };
    if (p.faces) for (const f of p.faces) list.push(...meshFace(c, f, base, !!look.texture));
    else list.push(...joined(c, p, base, !!look.texture));
  }
  simplify(c, list);

  // the edges between faces closer than 20°, but between faces of two looks lying flat on each other
  const by = new Map<string, number[]>();
  list.forEach((f, k) => {
    for (const loop of f.loops) for (let i = 0; i < loop.length; i++) {
      const key = edgeKey(loop[i], loop[(i + 1) % loop.length]);
      const at = by.get(key);
      if (at) at.push(k);
      else by.set(key, [k]);
    }
  });
  const soft = new Set<string>();
  for (const [key, at] of by) {
    if (at.length !== 2) continue;
    const [a, b] = [list[at[0]], list[at[1]]];
    const cos = dot(a.normal, b.normal);
    if (cos > SOFT && !(cos > 1 - 1e-9 && a.lookKey !== b.lookKey)) soft.add(key);
  }

  const drawn = new Set<string>();
  let count = 0;
  const put = (loops: number[][], f: Face, normal: Vec, softAt: (key: string) => boolean): boolean => {
    const next: boolean[] = [];
    const fresh: string[] = [];
    for (const loop of loops) for (let i = 0; i < loop.length; i++) {
      const key = edgeKey(loop[i], loop[(i + 1) % loop.length]);
      if (drawn.has(key) || fresh.includes(key)) continue;
      fresh.push(key);
      next.push(softAt(key));
    }
    const done = flags(next);
    try {
      target.addFace(loops[0].map((k) => c.point(k)), {
        material: f.look.material,
        ...(f.look.texture ? { frontUv: pins(c, loops[0], f, normal) } : { backMaterial: f.look.material }),
        ...(f.tag !== undefined ? { layer: f.tag } : {}),
        ...(loops.length > 1 ? { holes: loops.slice(1).map((l) => l.map((k) => c.point(k))) } : {}),
      });
    } catch (err) {
      done();
      if (err instanceof SkpWriteError) return false;
      throw err;
    }
    done();
    fresh.forEach((key) => drawn.add(key));
    count++;
    return true;
  };
  for (const f of list) {
    if (put(f.loops, f, f.normal, (key) => soft.has(key))) continue;
    // refused (a corner off its plane by openskp's measure): its triangles, soft between themselves
    for (const t of f.triangles) put([t], f, f.normal, (key) => soft.has(key) || !by.has(key));
  }

  for (const p of n.pieces) {
    if (!p.line) continue;
    const ks: number[] = [];
    for (let i = 0; i + 2 < p.line.length; i += 3) {
      const k = c.id(p.line[i], p.line[i + 1], p.line[i + 2]);
      if (ks[ks.length - 1] !== k) ks.push(k);
    }
    if (ks.length >= 2) target.addPolyline(ks.map((k) => c.point(k)));
  }
  return count;
}

/** A mesh's face as a face, or its fan of triangles where its corners don't lie flat or its image isn't laid flat on it. */
function meshFace(c: Corners, f: { corners: number[]; uvs?: number[] }, base: Pick<Face, "look" | "lookKey" | "tag">, textured: boolean): Face[] {
  const ks: number[] = [];
  const uv = new Map<number, [number, number]>();
  for (let i = 0; i + 2 < f.corners.length; i += 3) {
    const k = c.id(f.corners[i], f.corners[i + 1], f.corners[i + 2]);
    if (ks[ks.length - 1] === k) continue;
    ks.push(k);
    if (f.uvs) uv.set(k, [f.uvs[(2 * i) / 3], f.uvs[(2 * i) / 3 + 1]]);
  }
  if (ks.length > 1 && ks[0] === ks[ks.length - 1]) ks.pop();
  if (ks.length < 3) return [];
  const own = textured && f.uvs ? uv : null;
  const fan = (): Face[] => {
    const out: Face[] = [];
    for (let i = 1; i + 1 < ks.length; i++) {
      const t = [ks[0], ks[i], ks[i + 1]];
      const n = newell(c, t);
      const len = length(n);
      if (new Set(t).size === 3 && len > SLIVER) out.push({ ...base, loops: [t], triangles: [t], normal: [n[0] / len, n[1] / len, n[2] / len], uv: own });
    }
    return out;
  };
  const n = newell(c, ks);
  const len = length(n);
  if (len <= SLIVER || new Set(ks).size !== ks.length) return fan();
  const normal: Vec = [n[0] / len, n[1] / len, n[2] / len];
  const d = dot(normal, c.at[ks[0]]);
  if (ks.some((k) => Math.abs(dot(normal, c.at[k]) - d) > PLANE_TOL) || (own && !affine(c, ks, own, normal))) return fan();
  const triangles: number[][] = [];
  for (let i = 1; i + 1 < ks.length; i++) triangles.push([ks[0], ks[i], ks[i + 1]]);
  return [{ ...base, loops: [ks], triangles, normal, uv: own }];
}

/** Whether (u, v) at `ks` lie on the face as one flat mapping does (as a face's texture pins place it). */
function affine(c: Corners, ks: readonly number[], uv: ReadonlyMap<number, [number, number]>, normal: Vec): boolean {
  const map = planeMap(c, ks.slice(0, 3), uv, normal);
  return !!map && ks.every((k) => near(map(c.at[k]), uv.get(k)!));
}

const near = (a: readonly number[], b: readonly number[]): boolean => Math.abs(a[0] - b[0]) <= UV_TOL * Math.max(1, Math.abs(b[0])) && Math.abs(a[1] - b[1]) <= UV_TOL * Math.max(1, Math.abs(b[1]));

/** The flat mapping of a plane through three corners that gives each its (u, v), or null when they are in a line. */
function planeMap(c: Corners, t: readonly number[], uv: ReadonlyMap<number, [number, number]>, normal: Vec): ((p: Vec) => [number, number]) | null {
  const o = c.at[t[0]];
  const e1 = sub(c.at[t[1]], o);
  const l1 = length(e1);
  if (!(l1 > 0)) return null;
  const x: Vec = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const y = cross(normal, x);
  const q1 = [dot(e1, x), dot(e1, y)];
  const e2 = sub(c.at[t[2]], o);
  const q2 = [dot(e2, x), dot(e2, y)];
  const det = q1[0] * q2[1] - q2[0] * q1[1];
  if (Math.abs(det) < 1e-12) return null;
  const [w0, w1, w2] = t.map((k) => uv.get(k));
  if (!w0 || !w1 || !w2) return null;
  // (u, v) = w0 + a·dx + b·dy, solved from the other two corners
  const du = [w1[0] - w0[0], w2[0] - w0[0]];
  const dv = [w1[1] - w0[1], w2[1] - w0[1]];
  const au = (du[0] * q2[1] - du[1] * q1[1]) / det;
  const bu = (du[1] * q1[0] - du[0] * q2[0]) / det;
  const av = (dv[0] * q2[1] - dv[1] * q1[1]) / det;
  const bv = (dv[1] * q1[0] - dv[0] * q2[0]) / det;
  return (p) => {
    const e = sub(p, o);
    const px = dot(e, x);
    const py = dot(e, y);
    return [w0[0] + au * px + bu * py, w0[1] + av * px + bv * py];
  };
}

/** A triangle as corner numbers, with (u, v) at each when its texture is laid by its own map. */
interface Tri {
  k: [number, number, number];
  uv?: [number, number][];
}

/** how far off an edge a corner may lie and still split it (mm) */
const ON_EDGE = 1e-4;

/**
 * Triangles split where a corner of another lies along one of their edges (a solid's cut leaves
 * them so: a window's corner part way along the wall face's edge), so that neighbours share whole
 * edges and can be joined across them. Only edges no other triangle shares can hold such a corner,
 * and only corners of such edges can be one.
 */
function healed(c: Corners, tris: readonly Tri[]): Tri[] {
  const uses = new Map<string, number>();
  for (const t of tris) for (let q = 0; q < 3; q++) {
    const key = edgeKey(t.k[q], t.k[(q + 1) % 3]);
    uses.set(key, (uses.get(key) ?? 0) + 1);
  }
  const lone = new Set<number>();
  for (const t of tris) for (let q = 0; q < 3; q++) if (uses.get(edgeKey(t.k[q], t.k[(q + 1) % 3])) === 1) lone.add(t.k[q]).add(t.k[(q + 1) % 3]);
  if (!lone.size) return [...tris];
  // the candidates by x, to find those within an edge's reach quickly
  const byX = [...lone].sort((a, b) => c.at[a][0] - c.at[b][0]);
  const xs = byX.map((k) => c.at[k][0]);
  const from = (x: number): number => {
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const out: Tri[] = [];
  const todo = [...tris];
  while (todo.length) {
    const t = todo.pop()!;
    let split = false;
    for (let q = 0; q < 3 && !split; q++) {
      const a = t.k[q];
      const b = t.k[(q + 1) % 3];
      // an edge made by a split here, or shared, holds none
      if (uses.get(edgeKey(a, b)) !== 1) continue;
      const pa = c.at[a];
      const ab = sub(c.at[b], pa);
      const span = dot(ab, ab);
      if (!(span > 0)) continue;
      const on: [number, number][] = [];
      for (let i = from(Math.min(pa[0], c.at[b][0]) - ON_EDGE); i < byX.length && xs[i] <= Math.max(pa[0], c.at[b][0]) + ON_EDGE; i++) {
        const k = byX[i];
        if (k === a || k === b) continue;
        const ak = sub(c.at[k], pa);
        const s = dot(ak, ab) / span;
        if (s <= 1e-9 || s >= 1 - 1e-9) continue;
        if (length(sub(ak, [ab[0] * s, ab[1] * s, ab[2] * s])) <= ON_EDGE) on.push([s, k]);
      }
      if (!on.length) continue;
      on.sort((x, y) => x[0] - y[0]);
      // a fan from the opposite corner over the edge's pieces, each turning the triangle's way
      const o = t.k[(q + 2) % 3];
      const lerp = (s: number): [number, number] => {
        const [ua, va] = t.uv![q];
        const [ub, vb] = t.uv![(q + 1) % 3];
        return [ua + (ub - ua) * s, va + (vb - va) * s];
      };
      const run: [number, number][] = [[0, a], ...on, [1, b]];
      for (let i = 0; i + 1 < run.length; i++) {
        const [s0, k0] = run[i];
        const [s1, k1] = run[i + 1];
        todo.push({ k: [k0, k1, o], ...(t.uv ? { uv: [lerp(s0), lerp(s1), t.uv[(q + 2) % 3]] } : {}) });
      }
      split = true;
    }
    if (!split) out.push(t);
  }
  return out;
}

/**
 * A piece's triangles joined into faces: each run of neighbours lying in the plane of the first,
 * facing its way and (with their own (u, v)) laid on its image as one, becomes a face of the loops
 * round its edge, holes and all. A run whose edge touches itself stays triangles.
 */
function joined(c: Corners, p: ModelTreePiece, base: Pick<Face, "look" | "lookKey" | "tag">, textured: boolean): Face[] {
  const t = p.triangles;
  const own = textured && p.uvs ? p.uvs : null;
  const given: Tri[] = [];
  for (let i = 0; i + 8 < t.length; i += 9) {
    const k: [number, number, number] = [c.id(t[i], t[i + 1], t[i + 2]), c.id(t[i + 3], t[i + 4], t[i + 5]), c.id(t[i + 6], t[i + 7], t[i + 8])];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue;
    const j = (i / 9) * 6;
    given.push({ k, ...(own ? { uv: [0, 1, 2].map((q) => [own[j + 2 * q], own[j + 2 * q + 1]] as [number, number]) } : {}) });
  }
  const tris: (Tri & { normal: Vec })[] = [];
  for (const tri of healed(c, given)) {
    const n = cross(sub(c.at[tri.k[1]], c.at[tri.k[0]]), sub(c.at[tri.k[2]], c.at[tri.k[0]]));
    const len = length(n);
    if (len > SLIVER) tris.push({ ...tri, normal: [n[0] / len, n[1] / len, n[2] / len] });
  }
  // the triangles round each edge
  const at = new Map<string, number[]>();
  tris.forEach((tri, i) => {
    for (let q = 0; q < 3; q++) {
      const key = edgeKey(tri.k[q], tri.k[(q + 1) % 3]);
      const list = at.get(key);
      if (list) list.push(i);
      else at.set(key, [i]);
    }
  });
  const out: Face[] = [];
  const taken = new Uint8Array(tris.length);
  for (let s = 0; s < tris.length; s++) {
    if (taken[s]) continue;
    taken[s] = 1;
    const seed = tris[s];
    const normal = seed.normal;
    const d = dot(normal, c.at[seed.k[0]]);
    const uv = own ? new Map<number, [number, number]>() : null;
    seed.uv?.forEach((w, q) => uv!.set(seed.k[q], w));
    const map = uv ? planeMap(c, seed.k, uv, normal) : null;
    const run = [s];
    for (let r = 0; r < run.length; r++) {
      const tri = tris[run[r]];
      for (let q = 0; q < 3; q++) {
        const a = tri.k[q];
        const b = tri.k[(q + 1) % 3];
        const list = at.get(edgeKey(a, b))!;
        if (list.length !== 2) continue;
        const o = list[0] === run[r] ? list[1] : list[0];
        if (taken[o]) continue;
        const other = tris[o];
        // the neighbour runs the shared edge the other way, so faces the same way round it
        const qa = other.k.indexOf(a);
        if (other.k[(qa + 2) % 3] !== b) continue;
        if (dot(other.normal, normal) <= 0 || other.k.some((k) => Math.abs(dot(normal, c.at[k]) - d) > PLANE_TOL)) continue;
        if (uv && (!map || !other.uv || other.k.some((k, i) => !near(map(c.at[k]), other.uv![i]) || (uv.has(k) && !near(uv.get(k)!, other.uv![i]))))) continue;
        taken[o] = 1;
        run.push(o);
        other.uv?.forEach((w, i) => uv!.set(other.k[i], w));
      }
    }
    const triangles = run.map((i) => [...tris[i].k]);
    const loops = run.length > 1 ? outline(c, triangles, normal) : [triangles[0]];
    if (loops) out.push({ ...base, loops, triangles, normal, uv });
    else for (const tri of triangles) out.push({ ...base, loops: [tri], triangles: [tri], normal, uv });
  }
  return out;
}

/** The loops round a run of triangles: its outside first (counter-clockwise about `normal`), then its holes; null when its edge touches itself. */
function outline(c: Corners, triangles: readonly number[][], normal: Vec): number[][] | null {
  const inside = new Set<string>();
  for (const t of triangles) for (let q = 0; q < 3; q++) inside.add(`${t[q]}>${t[(q + 1) % 3]}`);
  const next = new Map<number, number>();
  for (const t of triangles) {
    for (let q = 0; q < 3; q++) {
      const a = t[q];
      const b = t[(q + 1) % 3];
      if (inside.has(`${b}>${a}`)) continue;
      // two boundary edges leaving one corner: the run touches itself there
      if (next.has(a)) return null;
      next.set(a, b);
    }
  }
  const loops: number[][] = [];
  const done = new Set<number>();
  for (const start of next.keys()) {
    if (done.has(start)) continue;
    const loop: number[] = [];
    for (let k: number | undefined = start; k !== undefined && !done.has(k); k = next.get(k)) {
      done.add(k);
      loop.push(k);
    }
    if (loop.length < 3 || next.get(loop[loop.length - 1]) !== start) return null;
    loops.push(loop);
  }
  const outside = loops.filter((l) => dot(newell(c, l), normal) > 0);
  if (outside.length !== 1) return null;
  return [outside[0], ...loops.filter((l) => l !== outside[0])];
}

/** Each face's corners that lie in a line between their neighbours and belong to no other face, taken out. */
function simplify(c: Corners, list: Face[]): void {
  const uses = new Map<number, number>();
  for (const f of list) for (const loop of f.loops) for (const k of loop) uses.set(k, (uses.get(k) ?? 0) + 1);
  for (const f of list) {
    f.loops = f.loops.map((loop) => {
      const kept = loop.slice();
      for (let i = 0; kept.length > 3 && i < kept.length; ) {
        const k = kept[i];
        const a = c.at[kept[(i + kept.length - 1) % kept.length]];
        const b = c.at[kept[(i + 1) % kept.length]];
        const ab = sub(b, a);
        const span = length(ab);
        const ak = sub(c.at[k], a);
        if (uses.get(k) === 1 && span > 0 && length(cross(ab, ak)) / span < PLANE_TOL && dot(ak, ab) > 0 && dot(ak, ab) < span * span) kept.splice(i, 1);
        else i++;
      }
      return kept;
    });
  }
}

/** Three of a face's corners, far apart, each with where it lies on the face's image, in the inches openskp pins it by. */
function pins(c: Corners, loop: readonly number[], f: Face, normal: Vec): UvPair[] {
  const tex = f.look.texture!;
  // the image projected along the face's main axis, as the 3D view lays it where the object doesn't
  const [ax, ay, az] = normal.map(Math.abs);
  const [iu, iv] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1];
  const uvAt = (k: number): [number, number] => f.uv?.get(k) ?? [c.at[k][iu] / tex.tile, c.at[k][iv] / tex.tile];
  const p0 = loop[0];
  let p1 = loop[1];
  for (const k of loop) if (length(sub(c.at[k], c.at[p0])) > length(sub(c.at[p1], c.at[p0]))) p1 = k;
  const e = sub(c.at[p1], c.at[p0]);
  let p2 = loop[2];
  for (const k of loop) if (length(cross(e, sub(c.at[k], c.at[p0]))) > length(cross(e, sub(c.at[p2], c.at[p0])))) p2 = k;
  const [u0, w0, n] = writerFrame(loop.map((k) => c.point(k)));
  const [xr, yr] = readerFrame(n);
  return [p0, p1, p2].map((k) => {
    const [u, v] = uvAt(k);
    // openskp's writer measures a pin along the face's first edge and square to it, where SketchUp
    // (and openskp's own reader, worked out from SketchUp's files) measures it in a frame from the
    // face's normal alone: the point is turned from the one frame into the other about the normal
    const p = c.point(k);
    const [a, b, h] = [dot(p, xr), dot(p, yr), dot(p, n)];
    const turned: Point3 = [0, 1, 2].map((i) => a * u0[i] + b * w0[i] + h * n[i]) as Point3;
    // and reads a pinned (u, v) over the material's applied size
    return [turned, [u * tex.width, v * tex.height]] as UvPair;
  });
}

/** The frame openskp's writer pins a face's texture in: along its first edge, square to that in its plane, and its normal, as it works them out. */
function writerFrame(points: readonly Point3[]): [Vec, Vec, Vec] {
  // the normal as openskp's planeFromPolygon has it, number for number, as it is stored
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0, z0] = points[i];
    const [x1, y1, z1] = points[(i + 1) % points.length];
    nx += (y0 - y1) * (z0 + z1);
    ny += (z0 - z1) * (x0 + x1);
    nz += (x0 - x1) * (y0 + y1);
  }
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  const n: Vec = [nx / len, ny / len, nz / len];
  const e = sub(points[1] as Vec, points[0] as Vec);
  const el = length(e);
  const u: Vec = [e[0] / el, e[1] / el, e[2] / el];
  const w = cross(n, u);
  const wl = length(w);
  return [u, [w[0] / wl, w[1] / wl, w[2] / wl], n];
}

/** The frame SketchUp measures a face's texture in from its normal (openskp's faceUvBasis): level across it, then up it. */
function readerFrame(n: Vec): [Vec, Vec] {
  const clen = Math.sqrt(n[1] * n[1] + n[0] * n[0]);
  if (clen < 1e-9) return [[1, 0, 0], [0, n[2] >= 0 ? 1 : -1, 0]];
  const xr: Vec = [-n[1] / clen, n[0] / clen, 0];
  return [xr, cross(n, xr)];
}
