// SketchUp import, the reading side (no DOM). parseSkp reads a .skp file, from SketchUp 2021 on (a
// zip around a tree of tagged records) and from the versions before it (an MFC archive, SketchUp 6
// to 2020), through openskp, an MIT reader worked out from the files themselves (no SketchUp SDK),
// into a MeshTree as import/mesh.ts has it, in inches and z up as SketchUp keeps every model.
// Components become symbols, as Vectorworks imports them: a definition is read once however often
// it is placed, and each instance places it through its transform (turned, mirrored or scaled). A
// component whose unpainted faces take an instance's paint is a symbol for each paint it is placed
// with ("Chair (Red)"), as a symbol has one look. Groups become groups of their own contents,
// placed. A part is the faces that share a tag and a colour. A face takes its front's material,
// else its back's (a face turned the wrong way is often painted on its back), else the nearest
// painted instance's above it, and is drawn with it on both sides; a group's tag goes down to what
// it holds and an instance's tag is its class (a face's own tag isn't read). A face with holes is
// cut into triangles, others stay whole. Components nested deeper than a symbol can be drawn are
// placed as groups instead. Shown edges no face uses are lines, joined end to end; guide lines are
// lines and guide points points, tagged Guides. Faces past MAX_FACES refuse the file; lines and
// guide points have a cap of their own, the same, past which the rest are left out and counted (a
// detailed model's loose edges once outnumbered its faces). An image is a group holding its one textured face,
// lifted a millimetre off its plane so it shows over a face it is glued to (SketchUp draws it so).
// Hidden faces and instances are left out as SketchUp leaves them out of view, and counted; things
// on a hidden tag come in, and the file names the tag hidden. Texts (openskp doesn't read where
// they are), dimensions, section planes, endless guide lines and scenes are left out and counted. A
// textured material's image (PNG or JPEG) is a texture its parts show, each face's corners placed
// on it as SketchUp places them (the side's own positioning, else the face's plane at the
// material's tile size), recoloured as SketchUp colorizes it; a face showing an instance's paint
// takes the plain placement.

import earcut from "earcut";
import { computeFaceUv, faceUvBasis, isDrawableEdge, parseSkp as readModel, sniffImageMime, type Definition, type Edge, type Face, type Material, type SkpModel, type Vertex } from "openskp";
import { MAX_FACES, tooMany, type MeshFile, type MeshLine, type MeshPart, type MeshTexture, type MeshTree, type MeshTreeGroup, type MeshTreeNode } from "./mesh.ts";

/** SketchUp's own name for Untagged */
const UNTAGGED = "Layer0";
/** deepest instance nesting followed */
const MAX_DEPTH = 64;
/** most levels of components placed as symbols in one another (Rodeo draws symbols 9 deep in plan) */
const MAX_NESTING = 8;
/** the tag guides come in on */
const GUIDES = "Guides";
/** most points in a line (a 3D polygon counts its vertices in 16 bits) */
const MAX_LINE_POINTS = 60_000;
/** how far an image's face is lifted along its normal, in inches (a millimetre) */
const IMAGE_LIFT = 1 / 25.4;

/** x' = m[0]x + m[1]y + m[2]z + m[3], and so on for y' (m[4..7]) and z' (m[8..11]) */
type Affine = readonly number[];
const IDENTITY: Affine = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

/** a definition's faces' loops, each a corner list, outer loop first */
interface Geometry {
  loops: Map<Face, number[][]>;
  /** shown edges no face's loop runs along, joined end to end, each run's points */
  lines: number[][];
}

/** A SketchUp file: its components as symbols, placed, and the rest as groups and meshes. */
export function parseSkp(bytes: Uint8Array): MeshFile {
  let model: SkpModel;
  try {
    model = readModel(bytes.slice().buffer);
  } catch (err) {
    const why = String(err instanceof Error ? err.message : err).replace(/\s*\|.*$/s, "");
    throw new Error(/bad header|magic/i.test(why) ? "it isn't a SketchUp file" : `its SketchUp data couldn't be read (${why})`);
  }
  const hiddenTags = new Set(model.layers.filter((l) => l.hidden).map((l) => l.name));
  const geometry = new Map<Definition, Geometry>();
  const skipped: Record<string, number> = {};
  const count = (kind: string, n = 1): void => {
    if (n > 0) skipped[kind] = (skipped[kind] ?? 0) + n;
  };
  let faces = 0;
  // lines and guide points, held to a cap of their own
  let loose = 0;

  const geometryOf = (d: Definition): Geometry => {
    let g = geometry.get(d);
    if (g) return g;
    const edges = new Map(d.edges.map((e) => [e.id, e]));
    const used = new Set<number>();
    const loops = new Map<Face, number[][]>();
    const verts = new Map(d.vertices.map((v) => [v.id, v]));
    for (const f of d.faces) {
      const out: number[][] = [];
      for (const loop of f.loops) {
        const corners: number[] = [];
        let last = -1;
        for (const use of loop) {
          const e = edges.get(use.edgeId);
          if (!e) continue;
          used.add(e.id);
          // a forward use runs from the edge's start, a reversed one from its end
          const id = use.orientation === 1 ? e.v1Id : e.v2Id;
          const v = verts.get(id);
          if (!v || id === last) continue;
          corners.push(v.x, v.y, v.z);
          last = id;
        }
        if (corners.length >= 9 && corners[0] === corners[corners.length - 3] && corners[1] === corners[corners.length - 2] && corners[2] === corners[corners.length - 1]) {
          corners.length -= 3;
        }
        if (corners.length >= 9) out.push(corners);
      }
      loops.set(f, out);
    }
    // soft, smooth and hidden edges don't show in SketchUp either
    g = { loops, lines: chains(d.edges.filter((e) => !used.has(e.id) && isDrawableEdge(e)), verts) };
    geometry.set(d, g);
    return g;
  };

  // each textured material's image, once; -1 for one that isn't a PNG or JPEG
  const textures: MeshTexture[] = [];
  const imageOf = new Map<Material, number>();
  const textureOf = (material: Material): number => {
    let k = imageOf.get(material);
    if (k !== undefined) return k;
    const t = material.texture!;
    const mime = t.data && t.data.length ? sniffImageMime(t.data) : null;
    const { r, g, b } = material.color;
    const colorize = material.colorized ? { colorize: { color: [r, g, b] as [number, number, number], by: material.colorizeType === 1 ? ("tint" as const) : ("shift" as const) } } : {};
    k = mime ? textures.push({ name: material.name || "Texture", image: t.data!, mime, size: t.width > 1e-9 ? t.width : 1, ...colorize }) - 1 : -1;
    // its parts keep the material's colour
    if (k < 0) count("texture image not in PNG or JPEG");
    imageOf.set(material, k);
    return k;
  };

  // each node's parts, by tag and material
  const partsOf = new Map<MeshTreeNode, Map<string, MeshPart>>();
  const partFor = (n: MeshTreeNode, tag: string, material: Material | null): MeshPart => {
    let byKey = partsOf.get(n);
    if (!byKey) partsOf.set(n, (byKey = new Map()));
    const key = `${tag}\u0000${material ? material.id ?? material.name : ""}`;
    let p = byKey.get(key);
    if (!p) {
      p = { name: material?.name ?? "", faces: [], ...(tag ? { tag } : {}) };
      if (material) {
        const { r, g, b } = material.color;
        p.color = { r: r / 255, g: g / 255, b: b / 255 };
        if (material.transparency < 1) p.opacity = Math.max(0, material.transparency);
        const k = material.texture ? textureOf(material) : -1;
        if (k >= 0) {
          p.texture = k;
          p.uvs = [];
        }
      }
      byKey.set(key, p);
      n.parts.push(p);
    }
    return p;
  };
  const addFace = (p: MeshPart, corners: number[]): void => {
    if (++faces > MAX_FACES) throw tooMany();
    p.faces.push(corners);
  };
  // a line or point past its cap is left out and counted, where a face past its cap refuses the file
  const addLine = (n: MeshTreeNode, line: MeshLine, skip: typeof count): void => {
    if (++loose > MAX_FACES) return skip(line.tag === GUIDES ? "guide line" : "line");
    (n.lines ??= []).push(line);
  };
  const addPoint = (n: MeshTreeNode, at: number[], skip: typeof count): void => {
    if (++loose > MAX_FACES) return skip("guide point");
    (n.points ??= []).push({ at, tag: GUIDES });
  };

  // the faces under a hidden instance, to say how many were left out
  const hiddenFaces = (d: Definition, depth: number): number => {
    if (depth > MAX_DEPTH) return 0;
    let n = d.faces.length;
    for (const i of d.instances) {
      const child = model.definitions.get(i.refIdx);
      if (child) n += hiddenFaces(child, depth + 1);
    }
    return n;
  };

  // whether a definition shows unpainted faces, which take the paint of the instance placing it
  const paintable = new Map<Definition, boolean>();
  const takesPaint = (d: Definition, depth = 0): boolean => {
    let yes = paintable.get(d);
    if (yes !== undefined) return yes;
    paintable.set(d, false);
    yes =
      d.faces.some((f) => !f.hidden && f.materialId === null) ||
      (depth < MAX_DEPTH &&
        d.instances.some((i) => {
          const child = model.definitions.get(i.refIdx);
          return !!child && i.materialId === null && !child.isImage && takesPaint(child, depth + 1);
        }));
    paintable.set(d, yes);
    return yes;
  };
  // how many levels of components a definition holds below it (groups add none)
  const levels = new Map<Definition, number>();
  const levelsOf = (d: Definition, depth = 0): number => {
    let n = levels.get(d);
    if (n !== undefined) return n;
    levels.set(d, 0);
    n = 0;
    if (depth < MAX_DEPTH) {
      for (const i of d.instances) {
        const child = model.definitions.get(i.refIdx);
        if (child && !child.isImage) n = Math.max(n, levelsOf(child, depth + 1) + (child.isGroup ? 0 : 1));
      }
    }
    levels.set(d, n);
    return n;
  };

  const symbols: MeshTree["symbols"] = [];
  // each definition's symbol for a paint, -1 when it shows nothing
  const made = new Map<string, number>();
  const making = new Set<Definition>();
  const filled = new Set<Definition>();
  const empty = (n: MeshTreeNode): boolean => !n.parts.length && !n.groups.length && !n.instances.length && !n.lines?.length && !n.points?.length;

  /** The symbol of `d` with unpainted faces in `paint` (when it takes paint): made once, its contents before it. */
  const symbolOf = (d: Definition, paint: Material | null, depth: number): number => {
    const own = takesPaint(d) ? paint : null;
    const key = `${d.id}\u0000${own ? own.id ?? own.name : ""}`;
    const had = made.get(key);
    if (had !== undefined) return had;
    // a component can't hold itself; a file that says so is read as far as it goes
    if (making.has(d)) return -1;
    making.add(d);
    const content: MeshTreeNode = { parts: [], groups: [], instances: [] };
    // what a definition leaves out is counted once, not again for each paint
    fill(content, d, IDENTITY, "", own, depth, filled.has(d));
    filled.add(d);
    making.delete(d);
    const base = d.name || "Component";
    const k = empty(content) ? -1 : symbols.push({ name: own ? `${base} (${own.name || "Paint"})` : base, content }) - 1;
    made.set(key, k);
    return k;
  };

  /** What `d` holds, placed by m into n: its faces by tag and colour (lifted `lift` along their normals), its groups and its components' instances; `quiet` counts nothing left out. */
  const fill = (n: MeshTreeNode, d: Definition, m: Affine, tag: string, painted: Material | null, depth: number, quiet = false, lift = 0): void => {
    const skip = quiet ? (): void => {} : count;
    const g = geometryOf(d);
    const flip = determinant(m) < 0;
    for (const f of d.faces) {
      if (f.hidden) {
        skip("hidden face");
        continue;
      }
      const loops = g.loops.get(f) ?? [];
      if (!loops.length) {
        skip("bad face");
        continue;
      }
      const front = f.materialId !== null ? model.materialsById.get(f.materialId) : undefined;
      const back = !front && f.backMaterialId !== null ? model.materialsById.get(f.backMaterialId) : undefined;
      const own = front ?? back;
      const material = own ?? painted;
      const p = partFor(n, tag, material);
      // a texture's place on the face, worked out where the face is drawn in its definition
      const uvsOf = p.uvs && material?.texture ? faceUvs(f, front ? f.uvTransform : back ? f.uvTransformBack : null, material.texture) : null;
      for (const corners of loops.length === 1 ? loops : cut(loops, f.normal)) {
        if (uvsOf) p.uvs!.push(placedUvs(uvsOf(corners), flip));
        addFace(p, placed(lift ? corners.map((v, i) => v + lift * f.normal[i % 3]) : corners, m, flip));
      }
    }
    // a loop of edges is no face, so it isn't closed (a closed 3D polygon shows filled): it runs back to its start
    for (const line of g.lines) addLine(n, { points: placed(line, m, false), closed: false, ...(tag ? { tag } : {}) }, skip);
    for (const c of d.constructionLines) {
      if (c.start && c.end) addLine(n, { points: placed([...c.start, ...c.end], m, false), closed: false, tag: GUIDES }, skip);
      else skip("endless guide line");
    }
    for (const c of d.constructionPoints) addPoint(n, placed(c.position, m, false), skip);
    skip("text", d.texts.length);
    skip("dimension", d.dimensions.length);
    skip("section plane", d.sectionPlanes.length);
    for (const inst of d.instances) {
      const child = model.definitions.get(inst.refIdx);
      if (!child) {
        skip("missing component");
        continue;
      }
      const own = inst.layer && inst.layer !== UNTAGGED ? inst.layer : "";
      if (inst.hidden) {
        skip("hidden face", hiddenFaces(child, depth + 1));
        continue;
      }
      if (depth >= MAX_DEPTH) {
        skip("too deeply nested component");
        continue;
      }
      const paint = (inst.materialId !== null ? model.materialsById.get(inst.materialId) : undefined) ?? painted;
      const at = compose(m, affine(inst.matrix));
      const onTag = own || tag;
      if (child.isGroup || child.isImage || levelsOf(child) >= MAX_NESTING) {
        // a group, an image, or a component nested deeper than symbols are drawn: its contents, placed, in a group
        const group: MeshTreeGroup = { name: inst.name || (child.isImage ? child.name || "Image" : ""), parts: [], groups: [], instances: [], ...(onTag ? { tag: onTag } : {}) };
        fill(group, child, at, onTag, paint, depth + 1, quiet, child.isImage ? IMAGE_LIFT : 0);
        if (!empty(group)) n.groups.push(group);
        continue;
      }
      const k = symbolOf(child, paint, depth + 1);
      // a name that only repeats its component's (as openskp's writer gives one) adds nothing
      const name = inst.name && inst.name !== child.name ? inst.name : "";
      if (k >= 0) n.instances.push({ symbol: k, matrix: rows(at), ...(name ? { name } : {}), ...(onTag ? { tag: onTag } : {}) });
    }
  };

  const top: MeshTreeNode = { parts: [], groups: [], instances: [] };
  fill(top, model.root, IDENTITY, "", null, 0);
  // model-level dimensions (2021 on) aren't any definition's
  count("dimension", model.dimensions.length);
  count("scene", model.pages.length);
  return {
    parts: [],
    skipped,
    frame: { mm: 25.4, yUp: false },
    tree: { symbols, top },
    ...(textures.length ? { textures } : {}),
    ...(hiddenTags.size ? { hiddenTags: [...hiddenTags] } : {}),
  };
}

/** Edges joined end to end into runs of points: from ends and forks, then round loops back to their start; each at most MAX_LINE_POINTS long. */
function chains(edges: readonly Edge[], verts: ReadonlyMap<number, Vertex>): number[][] {
  const at = new Map<number, Edge[]>();
  for (const e of edges) {
    if (e.v1Id === e.v2Id || !verts.has(e.v1Id) || !verts.has(e.v2Id)) continue;
    for (const v of [e.v1Id, e.v2Id]) {
      let list = at.get(v);
      if (!list) at.set(v, (list = []));
      list.push(e);
    }
  }
  const used = new Set<Edge>();
  const out: number[][] = [];
  const emit = (ids: number[]): void => {
    const points: number[] = [];
    for (const id of ids) {
      const p = verts.get(id)!;
      points.push(p.x, p.y, p.z);
    }
    out.push(points);
  };
  // from v along e, on through every vertex only two edges meet at
  const walk = (v: number, e: Edge): void => {
    let ids = [v];
    let next: Edge | undefined = e;
    while (next && !used.has(next)) {
      used.add(next);
      v = next.v1Id === v ? next.v2Id : next.v1Id;
      ids.push(v);
      if (ids.length === MAX_LINE_POINTS) {
        emit(ids);
        ids = [v];
      }
      const meeting = at.get(v)!;
      next = meeting.length === 2 ? meeting.find((x) => !used.has(x)) : undefined;
    }
    if (ids.length >= 2) emit(ids);
  };
  for (const [v, list] of at) if (list.length !== 2) for (const e of list) if (!used.has(e)) walk(v, e);
  for (const [v, list] of at) for (const e of list) if (!used.has(e)) walk(v, e);
  return out;
}

/** (u, v) at a face's corners: SketchUp's own positioning of the texture on it, else its plane at the tile size. */
function faceUvs(f: Face, positioned: number[] | null, tile: { width: number; height: number }): (corners: readonly number[]) => number[] {
  const { xr, yr } = faceUvBasis(f.normal);
  const w = tile.width > 1e-9 ? tile.width : 1;
  const h = tile.height > 1e-9 ? tile.height : 1;
  return (corners) => {
    const out: number[] = [];
    for (let i = 0; i < corners.length; i += 3) out.push(...computeFaceUv([corners[i], corners[i + 1], corners[i + 2]], xr, yr, positioned, w, h));
    return out;
  };
}

/** (u, v) pairs in the order placed puts their corners in */
function placedUvs(uvs: number[], flip: boolean): number[] {
  if (!flip) return uvs;
  const out: number[] = [];
  for (let i = uvs.length - 2; i >= 0; i -= 2) out.push(uvs[i], uvs[i + 1]);
  return out;
}

/** An Affine as MeshTree's matrix: the images of the x, y and z axes, then the offset. */
function rows(m: Affine): number[] {
  return [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10], m[3], m[7], m[11]];
}

/** openskp's instance matrix as an Affine: 12 or 13 values row by row (the 13th a scale over all), or 16 column by column. */
function affine(m: readonly number[]): Affine {
  if (m.length >= 16) return [m[0], m[4], m[8], m[12], m[1], m[5], m[9], m[13], m[2], m[6], m[10], m[14]];
  if (m.length < 12) return IDENTITY;
  const s = m.length >= 13 && Number.isFinite(m[12]) && m[12] !== 0 ? m[12] : 1;
  return [m[0] * s, m[1] * s, m[2] * s, m[9] * s, m[3] * s, m[4] * s, m[5] * s, m[10] * s, m[6] * s, m[7] * s, m[8] * s, m[11] * s];
}

/** a then b: b's frame placed by a */
function compose(a: Affine, b: Affine): Affine {
  const out = new Array<number>(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      out[4 * r + c] = a[4 * r] * b[c] + a[4 * r + 1] * b[4 + c] + a[4 * r + 2] * b[8 + c] + (c === 3 ? a[4 * r + 3] : 0);
    }
  }
  return out;
}

function determinant(m: Affine): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/** corners placed by m, in reverse when m mirrors so the face still looks the way it did */
function placed(corners: readonly number[], m: Affine, flip: boolean): number[] {
  const n = corners.length / 3;
  const out = new Array<number>(corners.length);
  for (let i = 0; i < n; i++) {
    const k = 3 * (flip ? n - 1 - i : i);
    const x = corners[k];
    const y = corners[k + 1];
    const z = corners[k + 2];
    out[3 * i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[3 * i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[3 * i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

/** A face with holes as triangles, each turned to face the way the face does. */
function cut(loops: readonly number[][], normal: readonly number[]): number[][] {
  // flattened onto the plane square to the normal's largest component
  const [nx, ny, nz] = normal.map(Math.abs);
  const [u, v] = nz >= nx && nz >= ny ? [0, 1] : nx >= ny ? [1, 2] : [2, 0];
  const all = loops.flat();
  const flat: number[] = [];
  const holes: number[] = [];
  for (const loop of loops) {
    if (flat.length) holes.push(flat.length / 2);
    for (let i = 0; i < loop.length; i += 3) flat.push(loop[i + u], loop[i + v]);
  }
  const tri = earcut(flat, holes, 2);
  const out: number[][] = [];
  for (let t = 0; t < tri.length; t += 3) {
    const [a, b, c] = [tri[t], tri[t + 1], tri[t + 2]].map((i) => all.slice(3 * i, 3 * i + 3));
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const facing = normal[0] * (e1[1] * e2[2] - e1[2] * e2[1]) + normal[1] * (e1[2] * e2[0] - e1[0] * e2[2]) + normal[2] * (e1[0] * e2[1] - e1[1] * e2[0]);
    out.push(facing < 0 ? [...a, ...c, ...b] : [...a, ...b, ...c]);
  }
  return out;
}
