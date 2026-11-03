// Collada (.dae, the XML 3D format SketchUp exports and imports) and KMZ (a zipped Collada model with a
// KML wrapper), the reading side, no DOM. parseCollada places the visual scene the file names (else
// its first) through its node transforms: matrix, translate, rotate and scale in document order, with
// instance_node (a component instanced anywhere, nested or many times, as SketchUp writes every
// component), instance_geometry and instance_controller (at its skin's bind shape). A scene that uses
// instance_node comes back as a tree instead: each node it instances a symbol of what the node holds,
// read once and turned to z up, and each instance_node an instance placing it. Meshes are read as
// triangles, polylists and polygons; a polygon with holes keeps its outer ring and the holes are left
// out. Lines, strips and fans are left out and counted. Each node instance's geometry is a part,
// coloured by its material's diffuse colour (a texture gives none). Lookat and skew are ignored, and
// so are cameras, lights and skeletons. The file's unit and up axis come back as `frame`; an X-up file
// is turned to y up here. parseKmz reads the model a KMZ's doc.kml names, placement in KML ignored.
// It reads what export/collada.ts writes.

import { MAX_FACES, placementOf, tooMany, treeTop, type MeshFile, type MeshPart, type MeshTree, type MeshTreeInstance } from "./mesh.ts";
import { attr, child, childrenNamed, findAll, parseXml, type XmlNode } from "./xml.ts";
import { unzip } from "./zip.ts";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** A mesh's faces before placement: flat x, y, z corners in the file's own units and axes, bound to a material symbol ("" when none). */
interface Local {
  symbol: string;
  faces: number[][];
}

const IDENTITY: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
/** X up turned to y up: x, y, z become z, x, y */
const X_UP_TO_Y_UP: number[] = [0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1];
/** Y up turned to z up: x, y, z become x, -z, y */
const Y_UP_TO_Z_UP: number[] = [1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1];
/** the shading elements of a COMMON profile whose diffuse colour is read */
const SHADING = new Set(["phong", "lambert", "blinn", "constant"]);
/** the deepest node nesting followed (a component instanced inside itself stops here) */
const MAX_DEPTH = 64;


function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** Adds to a skipped count. */
function note(skipped: Record<string, number>, kind: string, n = 1): void {
  skipped[kind] = (skipped[kind] ?? 0) + n;
}

/** The numbers in a text, split on any white space. */
function numbers(text: string): number[] {
  const t = text.trim();
  return t ? t.split(/\s+/).map(Number) : [];
}

/** The count attribute of a primitive, at least 1. */
function countOf(el: XmlNode): number {
  const n = Number(el.attrs.count);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** The id an internal reference ("#id") names, else undefined. */
function ref(url: string | undefined): string | undefined {
  return url?.startsWith("#") ? url.slice(1) : undefined;
}

/** A node's own label: its name, else its id. */
function nameOf(n: XmlNode): string | undefined {
  return n.attrs.name || n.attrs.id || undefined;
}

/** The elements by their id; the first with an id keeps it. */
function byId(list: XmlNode[]): Map<string, XmlNode> {
  const out = new Map<string, XmlNode>();
  for (const n of list) if (n.attrs.id && !out.has(n.attrs.id)) out.set(n.attrs.id, n);
  return out;
}

/** A 4 × 4 matrix given as sixteen numbers (row-major, as Collada writes it), else the identity. */
function matrixOf(el: XmlNode | undefined): number[] {
  const v = numbers(el?.text ?? "");
  return v.length === 16 && v.every(Number.isFinite) ? v : IDENTITY;
}

/** a · b, both 4 × 4 row-major */
function mul(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[4 * r + k] * b[4 * k + c];
      out[4 * r + c] = s;
    }
  }
  return out;
}

/** The determinant of a 4 × 4's 3 × 3 part: negative when the transform mirrors. */
function det3(m: number[]): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/** A rotation of `degrees` about the axis (x, y, z), right-handed. */
function rotation(x: number, y: number, z: number, degrees: number): number[] {
  const len = Math.hypot(x, y, z);
  if (!(len > 0)) return IDENTITY;
  const ax = x / len;
  const ay = y / len;
  const az = z / len;
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const t = 1 - c;
  return [
    t * ax * ax + c, t * ax * ay - s * az, t * ax * az + s * ay, 0,
    t * ax * ay + s * az, t * ay * ay + c, t * ay * az - s * ax, 0,
    t * ax * az - s * ay, t * ay * az + s * ax, t * az * az + c, 0,
    0, 0, 0, 1,
  ];
}

/** A node's own transform: its transform elements multiplied in the order they are written. */
function transformOf(node: XmlNode): number[] {
  let m = IDENTITY;
  for (const t of node.children) {
    const v = numbers(t.text);
    if (t.name === "matrix") m = mul(m, matrixOf(t));
    else if (t.name === "translate" && v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) {
      m = mul(m, [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2], 0, 0, 0, 1]);
    } else if (t.name === "scale" && v.length >= 3 && v.slice(0, 3).every(Number.isFinite)) {
      m = mul(m, [v[0], 0, 0, 0, 0, v[1], 0, 0, 0, 0, v[2], 0, 0, 0, 0, 1]);
    } else if (t.name === "rotate" && v.length >= 4 && v.slice(0, 4).every(Number.isFinite)) {
      m = mul(m, rotation(v[0], v[1], v[2], v[3]));
    }
  }
  return m;
}

/** A face's corners put through a 4 × 4 (its affine part), in reverse order when the transform mirrors. */
function placeFace(face: number[], m: number[], flip: boolean): number[] {
  const n = face.length / 3;
  const out = new Array<number>(face.length);
  for (let i = 0; i < n; i++) {
    const j = 3 * (flip ? n - 1 - i : i);
    const x = face[j];
    const y = face[j + 1];
    const z = face[j + 2];
    out[3 * i] = m[0] * x + m[1] * y + m[2] * z + m[3];
    out[3 * i + 1] = m[4] * x + m[5] * y + m[6] * z + m[7];
    out[3 * i + 2] = m[8] * x + m[9] * y + m[10] * z + m[11];
  }
  return out;
}

/** The positions of a float source: x, y, z triples, read through its accessor's stride and offset. */
function positionsFrom(source: XmlNode | undefined): Float64Array | null {
  const floats = child(source, "float_array");
  if (!floats) return null;
  const values = numbers(floats.text);
  const acc = child(child(source, "technique_common"), "accessor");
  const stride = Math.max(1, Number(acc?.attrs.stride) || 3);
  const offset = Number(acc?.attrs.offset) || 0;
  const declared = Number(acc?.attrs.count) || Math.floor(values.length / stride);
  const names = childrenNamed(acc, "param").map((p) => p.attrs.name ?? "");
  // where X, Y and Z sit among the accessor's params (in order when they are not named)
  const pick = (axis: string, dflt: number): number => {
    const k = names.indexOf(axis);
    return k >= 0 && k < stride ? k : dflt;
  };
  const ix = pick("X", 0);
  const iy = pick("Y", 1);
  const iz = pick("Z", 2);
  const n = Math.max(0, Math.min(declared, Math.floor((values.length - offset) / stride)));
  const out = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const at = offset + i * stride;
    out[3 * i] = values[at + ix];
    out[3 * i + 1] = values[at + iy];
    out[3 * i + 2] = values[at + iz];
  }
  return out;
}

/** A mesh's primitives as local faces, one list per material symbol; lines, strips and fans are left out and counted. */
function readMesh(mesh: XmlNode, skipped: Record<string, number>): Local[] {
  const sources = new Map<string, XmlNode>();
  for (const s of childrenNamed(mesh, "source")) if (s.attrs.id) sources.set(s.attrs.id, s);
  // each <vertices> id, to the source its POSITION input names
  const vertexSource = new Map<string, string>();
  for (const v of childrenNamed(mesh, "vertices")) {
    const position = childrenNamed(v, "input").find((i) => i.attrs.semantic === "POSITION");
    vertexSource.set(v.attrs.id ?? "", ref(position?.attrs.source) ?? "");
  }
  const positionCache = new Map<string, Float64Array | null>();
  // a VERTEX input names a <vertices>; one that names a source directly is read as that source
  const positionsOf = (id: string): Float64Array | null => {
    if (!positionCache.has(id)) positionCache.set(id, positionsFrom(sources.get(vertexSource.get(id) ?? id)));
    return positionCache.get(id) ?? null;
  };

  const out = new Map<string, number[][]>();
  let count = 0;
  const add = (symbol: string, face: number[]): void => {
    if (++count > MAX_FACES) throw tooMany();
    const list = out.get(symbol);
    if (list) list.push(face);
    else out.set(symbol, [face]);
  };

  const primitive = (prim: XmlNode): void => {
    const inputs = childrenNamed(prim, "input");
    const vertex = inputs.find((i) => i.attrs.semantic === "VERTEX");
    const pos = vertex ? positionsOf(ref(vertex.attrs.source) ?? "") : null;
    if (!vertex || !pos) {
      note(skipped, "bad face", countOf(prim));
      return;
    }
    // each corner takes one index per input; the vertex index sits at the VERTEX input's offset
    const stride = inputs.reduce((n, i) => Math.max(n, (Number(i.attrs.offset) || 0) + 1), 1);
    const slot = Number(vertex.attrs.offset) || 0;
    const nv = pos.length / 3;
    const symbol = prim.attrs.material ?? "";
    const index = (list: number[], k: number): number => list[k * stride + slot];
    const face = (idx: number[]): void => {
      if (idx.length < 3) return void note(skipped, "bad face");
      const flat: number[] = [];
      for (const i of idx) {
        if (!Number.isInteger(i) || i < 0 || i >= nv) return void note(skipped, "bad face");
        flat.push(pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]);
      }
      if (!flat.every(Number.isFinite)) return void note(skipped, "bad face");
      // a triangle with a corner repeated is a line or a point, which draws nothing: dropped, not counted
      if (idx.length === 3 && (idx[0] === idx[1] || idx[1] === idx[2] || idx[0] === idx[2])) return;
      add(symbol, flat);
    };
    const polygon = (p: number[]): void => {
      const n = Math.floor(p.length / stride);
      face(Array.from({ length: n }, (_, k) => index(p, k)));
    };

    if (prim.name === "triangles") {
      const p = numbers(child(prim, "p")?.text ?? "");
      const n = Math.min(Math.floor(p.length / (3 * stride)), Number(prim.attrs.count) || 0);
      for (let t = 0; t < n; t++) face([index(p, 3 * t), index(p, 3 * t + 1), index(p, 3 * t + 2)]);
    } else if (prim.name === "polylist") {
      // vcount gives each polygon's corner count; its corners follow the last polygon's in p
      const vcount = numbers(child(prim, "vcount")?.text ?? "");
      const p = numbers(child(prim, "p")?.text ?? "");
      let k = 0;
      for (const v of vcount) {
        const n = Math.max(0, Math.floor(v) || 0);
        face(Array.from({ length: n }, (_, c) => index(p, k + c)));
        k += n;
      }
    } else {
      // polygons: one <p> each; a <ph> is an outer ring with holes, the ring kept and the holes left out
      for (const c of prim.children) {
        if (c.name === "p") polygon(numbers(c.text));
        else if (c.name === "ph") {
          const outer = child(c, "p");
          if (outer) polygon(numbers(outer.text));
          else note(skipped, "bad face");
          const holes = childrenNamed(c, "h").length;
          if (holes) note(skipped, "hole", holes);
        }
      }
    }
  };

  for (const prim of mesh.children) {
    switch (prim.name) {
      case "triangles":
      case "polylist":
      case "polygons":
        primitive(prim);
        break;
      case "lines":
      case "linestrips":
        note(skipped, "line", countOf(prim));
        break;
      case "trifans":
        note(skipped, "triangle fan", countOf(prim));
        break;
      case "tristrips":
        note(skipped, "triangle strip", countOf(prim));
        break;
    }
  }
  return [...out].map(([symbol, faces]) => ({ symbol, faces }));
}

/** A geometry's local faces: its mesh (or convex mesh); null when it is a curve or surface, which is left out. */
function readGeometry(geom: XmlNode, skipped: Record<string, number>): Local[] | null {
  const mesh = child(geom, "mesh") ?? child(geom, "convex_mesh");
  return mesh ? readMesh(mesh, skipped) : null;
}

/** The material each symbol of an instance is bound to, by the target's id. */
function bindingsOf(instance: XmlNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const im of findAll(instance, "instance_material")) {
    const target = ref(im.attrs.target);
    if (im.attrs.symbol !== undefined && target !== undefined) out.set(im.attrs.symbol, target);
  }
  return out;
}

/** A material's diffuse colour from its effect's COMMON profile; undefined when it is a texture or there is none. */
function diffuseOf(material: XmlNode | undefined, effects: Map<string, XmlNode>): Rgb | undefined {
  const effect = effects.get(ref(child(material, "instance_effect")?.attrs.url) ?? "");
  const technique = child(child(effect, "profile_COMMON"), "technique");
  const shading = technique?.children.find((c) => SHADING.has(c.name));
  const diffuse = child(shading, "diffuse");
  if (!diffuse || child(diffuse, "texture")) return undefined;
  const v = numbers(child(diffuse, "color")?.text ?? "");
  return v.length >= 3 && v.slice(0, 3).every(Number.isFinite) ? { r: clamp01(v[0]), g: clamp01(v[1]), b: clamp01(v[2]) } : undefined;
}

/** A turn's inverse: its 3 × 3 part transposed. */
function transposed(m: number[]): number[] {
  return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
}

/**
 * Collada text (.dae): the parts of the visual scene the file names (else its first). Each part is one
 * node instance's geometry for one material, in the file's units (`frame.mm` millimetres each) and
 * axes (`frame.yUp`). `group` is the top-level node the part sits under when the scene has two or
 * more; when it has one, the child node it sits under (SketchUp's "SketchUp" root holds the model).
 * A part is named after the node that places its geometry (for a component, the node that instances
 * it), else that node's id, else the geometry's name. A scene that uses instance_node is a tree, z
 * up, grouped the same way (but a node under the one top node that only places one thing is not a
 * group): the nodes it instances are symbols of their own parts (named after their own nodes) and
 * instances, and each instance is named after the node holding it, unless that only repeats its
 * symbol's name.
 */
export function parseCollada(text: string): MeshFile {
  const root = parseXml(text);
  if (root.name !== "COLLADA") throw new Error("it isn't a Collada file");
  const skipped: Record<string, number> = {};
  const asset = child(root, "asset");
  const meter = Number(attr(child(asset, "unit"), "meter"));
  const mm = (meter > 0 && Number.isFinite(meter) ? meter : 1) * 1000;
  const up = (child(asset, "up_axis")?.text ?? "Y_UP").trim().toUpperCase();
  const frame = { mm, yUp: up !== "Z_UP" };
  const axis = up === "X_UP" ? X_UP_TO_Y_UP : IDENTITY;

  const geometries = byId(findAll(root, "geometry"));
  const controllers = byId(findAll(root, "controller"));
  const nodes = byId(findAll(root, "node"));
  const materials = byId(findAll(root, "material"));
  const effects = byId(findAll(root, "effect"));
  const scenes = byId(findAll(root, "visual_scene"));

  const scene = scenes.get(ref(child(child(root, "scene"), "instance_visual_scene")?.attrs.url) ?? "") ?? [...scenes.values()][0];
  if (!scene) throw new Error("it has no visual scene");

  const locals = new Map<XmlNode, Local[] | null>();
  // a geometry is read once however many nodes place it; a curve or surface is counted once, as the lines are
  const localsOf = (geom: XmlNode): Local[] | null => {
    if (!locals.has(geom)) {
      const read = readGeometry(geom, skipped);
      if (!read) note(skipped, "curve or surface");
      locals.set(geom, read);
    }
    return locals.get(geom) ?? null;
  };
  const colours = new Map<string, Rgb | undefined>();
  const colourOf = (materialId: string): Rgb | undefined => {
    if (!colours.has(materialId)) colours.set(materialId, diffuseOf(materials.get(materialId), effects));
    return colours.get(materialId);
  };

  let parts: MeshPart[] = [];
  let faces = 0;
  // the tree's symbols, when the scene instances nodes, and its instances being gathered
  const tree = findAll(scene, "instance_node").length > 0;
  const symbols: MeshTree["symbols"] = [];
  let instances: (MeshTreeInstance & { group?: string })[] = [];
  const made = new Map<XmlNode, number>();
  // a flat file's parts are turned to y up, a tree's to z up
  const turn = tree ? (up === "Z_UP" ? IDENTITY : mul(Y_UP_TO_Z_UP, axis)) : axis;
  const unturn = transposed(turn);
  // one node instance's geometry placed by its transform (the file's axes in, the result's out), a part per material it uses
  const place = (geom: XmlNode, inst: XmlNode, world: number[], name: string, group: string | undefined): void => {
    const mine = localsOf(geom);
    if (!mine) return;
    const bound = bindingsOf(inst);
    const m = mul(turn, world);
    const flip = det3(m) < 0;
    const byMaterial = new Map<string, MeshPart>();
    for (const local of mine) {
      let part = byMaterial.get(local.symbol);
      if (!part) {
        const target = bound.get(local.symbol);
        const color = target !== undefined ? colourOf(target) : undefined;
        part = { name, faces: [], ...(group !== undefined ? { group } : {}), ...(color ? { color } : {}) };
        byMaterial.set(local.symbol, part);
        parts.push(part);
      }
      for (const face of local.faces) {
        if (++faces > MAX_FACES) throw tooMany();
        part.faces.push(placeFace(face, m, flip));
      }
    }
  };
  const instanced = (geom: XmlNode | undefined, inst: XmlNode, world: number[], label: string | undefined, group: string | undefined): void => {
    if (geom) place(geom, inst, world, label ?? (geom.attrs.name || geom.attrs.id || ""), group);
  };

  // whether the scene has one top-level node (SketchUp's "SketchUp" root), whose children then group the parts
  const topNodes = childrenNamed(scene, "node");
  const soleTop = topNodes.length === 1;
  // `label` is the name of the node that instances this one, which names its parts over the component's own name
  const visit = (node: XmlNode, parent: number[], depth: number, group: string | undefined, label: string | undefined): void => {
    if (depth > MAX_DEPTH) return;
    const m = mul(parent, transformOf(node));
    const own = label ?? nameOf(node);
    for (const c of node.children) {
      const url = ref(c.attrs.url) ?? "";
      if (c.name === "instance_geometry") instanced(geometries.get(url), c, m, own, group);
      else if (c.name === "instance_controller") {
        // a skinned mesh is drawn at its bind shape, its skeleton ignored
        const skin = child(controllers.get(url), "skin");
        instanced(geometries.get(ref(skin?.attrs.source) ?? ""), c, mul(m, matrixOf(child(skin, "bind_shape_matrix"))), own, group);
      } else if (c.name === "instance_node") {
        const target = nodes.get(url);
        if (!target) continue;
        if (!tree) {
          visit(target, m, depth + 1, group, own);
          continue;
        }
        const k = symbolOf(target, depth + 1);
        if (k < 0) continue;
        // the node's frame as the tree has it, from the target's parent frame turned to z up
        const name = nameOf(node);
        const named = name && name !== symbols[k].name ? { name } : {};
        instances.push({ symbol: k, matrix: placementOf(mul(mul(turn, m), unturn)), ...named, ...(group !== undefined ? { group } : {}) });
      }
    }
    for (const c of node.children) {
      if (c.name === "node") visit(c, m, depth + 1, depth === 0 && soleTop && !(tree && placesOne(c)) ? nameOf(c) : group, undefined);
    }
  };
  // a node that holds no nodes and places one thing is that thing, not a group of it
  const placesOne = (node: XmlNode): boolean =>
    !node.children.some((c) => c.name === "node") && node.children.filter((c) => c.name.startsWith("instance_")).length === 1;
  // a node an instance_node names as a symbol of what it holds, its own transform in it, read the first time; -1 when it holds nothing or holds itself
  const symbolOf = (node: XmlNode, depth: number): number => {
    const known = made.get(node);
    if (known !== undefined) return known;
    made.set(node, -1);
    const outer = { parts, instances };
    parts = [];
    instances = [];
    try {
      visit(node, IDENTITY, depth, undefined, undefined);
      const content = { parts: parts.filter((p) => p.faces.length > 0), groups: [], instances };
      if (!content.parts.length && !content.instances.length) return -1;
      symbols.push({ name: nameOf(node) ?? "Component", content });
      made.set(node, symbols.length - 1);
      return symbols.length - 1;
    } finally {
      ({ parts, instances } = outer);
    }
  };
  for (const top of topNodes) visit(top, IDENTITY, 0, soleTop ? undefined : nameOf(top), undefined);

  const kept = parts.filter((p) => p.faces.length > 0);
  if (!tree) return { parts: kept, skipped, frame };
  return { parts: [], skipped, frame: { mm, yUp: false }, tree: { symbols, top: treeTop(kept, instances) } };
}

/**
 * A KMZ: the Collada model its doc.kml's Model links to (else the first .dae in the archive). The KML's
 * placement of the model (Location, Orientation, Scale) is ignored; the model is read as its own file.
 */
export function parseKmz(bytes: Uint8Array): MeshFile {
  const files = unzip(bytes);
  const names = [...files.keys()];
  const kml = names.find((n) => /^doc\.kml$/i.test(n)) ?? names.find((n) => /\.kml$/i.test(n));
  let href: string | undefined;
  if (kml !== undefined) {
    try {
      const model = findAll(parseXml(new TextDecoder().decode(files.get(kml)!())), "Model")[0];
      href = child(child(model, "Link"), "href")?.text.trim() || undefined;
    } catch {
      // a KML that does not read leaves the model to the first .dae
      href = undefined;
    }
  }
  const wanted = href?.replace(/^\.?\//, "");
  const dae =
    (wanted !== undefined ? names.find((n) => n === wanted) ?? names.find((n) => n.toLowerCase() === wanted.toLowerCase()) : undefined) ??
    names.find((n) => /\.dae$/i.test(n));
  if (dae === undefined) throw new Error("it has no Collada model");
  return parseCollada(new TextDecoder().decode(files.get(dae)!()));
}
