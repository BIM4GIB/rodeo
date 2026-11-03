// Rhino .3dm export, the writing side (no DOM). export3dm writes a Rhino file in millimetres, z up, through
// rhino3dm (openNURBS compiled to WebAssembly; the app loads it and passes it in): a Rhino layer per design
// layer, with a sublayer per class its objects use ("Layer::Class"); each 3D object piece as a mesh, with
// the vertices where they meet shared, named after its object and coloured by it; each symbol as a block
// definition of its objects' meshes (and the blocks placed in it), on the sublayers of the first layer that
// places it, and each instance as a block instance through its matrix; and the 2D objects that
// stand for nothing in 3D as lines, polylines (a closed one repeats its first point), circles and arcs (a
// sampled polyline when elliptical), points and text. Text is a text dot, since rhino3dm can't make a text
// entity: a dot is drawn the same size on screen however near, so its size is the text's in points (its world
// size over its layer's scale), whole and at least 3, and it keeps no rotation. Imports nothing from rhino3dm
// at run time, so it can be checked under Node.

import { arcPoint } from "./svg.ts";
import type { Pt, Shape } from "../core/types.ts";
import type { FlatObject, Model3D, ModelObject, ModelPiece } from "./scene3d.ts";
import type { Rhino } from "../import/rhino.ts";
import type { File3dm, GeometryBase, InstanceReference, Mesh, ObjectAttributes, Transform } from "rhino3dm";

/** Segments a sampled ellipse or elliptical arc takes. */
const ELLIPSE_SEGMENTS = 64;
/** The smallest text dot size rhino3dm keeps (points); smaller ones read back as its default. */
const MIN_DOT_POINTS = 3;
/** The size of a text whose shape gives none (points). */
const DEFAULT_POINTS = 10;
/** Millimetres in a point. */
const MM_PER_PT = 25.4 / 72;

/**
 * The drawing as a Rhino file (.3dm bytes) in millimetres: `model`'s pieces as meshes and `flat`'s 2D objects
 * as linework and text, each on a layer named after its design layer (`layerNames` names the layers that only
 * have flat objects) under a sublayer for its class. The objects in a group are put in a Rhino group named after
 * it, and in the groups holding that one, as Rhino nests groups. The model's symbols are block definitions, and
 * an object placing one a block instance.
 */
export function export3dm(model: Model3D, flat: readonly FlatObject[], layerNames: ReadonlyMap<string, string>, rhino: Rhino): Uint8Array {
  const file = new rhino.File3dm();
  const settings = file.settings();
  settings.modelUnitSystem = rhino.UnitSystem.Millimeters;
  free(settings);
  const objects = file.objects();
  try {
    const placedOn = symbolLayers(model);
    const at = addLayers(file, rhino, model, flat, layerNames, placedOn);
    const index = (layerId: string, className: string): number => at.get(keyOf(layerId, className)) ?? 0;
    const blocks = addBlocks(file, rhino, model, (k, className) => index(placedOn[k], className));
    const groups = new Map<string, number>();
    const groupTable = file.groups();
    const groupOf = (group: { id: string; name: string }): number => {
      let i = groups.get(group.id);
      if (i === undefined) {
        const g = new rhino.Group();
        g.name = group.name;
        groupTable.add(g);
        free(g);
        i = groupTable.count - 1;
        groups.set(group.id, i);
      }
      return i;
    };
    for (const layer of model.layers) {
      for (const obj of layer.objects) {
        if (obj.instance) {
          const ref = blockOf(rhino, blocks, obj);
          if (!ref) continue;
          const attrs = attributes(rhino, index(layer.id, obj.className), undefined, obj.name);
          for (const g of obj.groups ?? []) attrs.addToGroup(groupOf(g));
          try {
            objects.addInstanceObject(ref, attrs);
          } finally {
            free(ref);
            free(attrs);
          }
          continue;
        }
        for (const piece of obj.pieces) {
          const mesh = pieceMesh(rhino, piece);
          if (!mesh) continue;
          const attrs = attributes(rhino, index(layer.id, obj.className), piece.color, obj.name);
          for (const g of obj.groups ?? []) attrs.addToGroup(groupOf(g));
          try {
            objects.addMesh(mesh, attrs);
          } finally {
            free(mesh);
            free(attrs);
          }
        }
      }
    }
    for (const f of flat) writeFlat(rhino, objects, f, index(f.layerId, f.className));
    return file.toByteArray();
  } finally {
    free(file);
  }
}

/** The first layer placing each of the model's symbols, itself or through another symbol, by symbol. */
function symbolLayers(model: Model3D): string[] {
  const out: string[] = [];
  const mark = (objects: readonly ModelObject[], layerId: string): void => {
    for (const obj of objects) {
      const k = obj.instance?.symbol;
      if (k === undefined || out[k] !== undefined) continue;
      out[k] = layerId;
      mark(model.symbols?.[k]?.objects ?? [], layerId);
    }
  };
  for (const layer of model.layers) mark(layer.objects, layer.id);
  return out;
}

/**
 * The model's symbols as block definitions, each of its objects' meshes and the blocks placed in it, named
 * after the symbol, its objects on `layerOf`'s layer for their class. Each one's id, by symbol; null for one
 * left with nothing to hold.
 */
function addBlocks(file: File3dm, rhino: Rhino, model: Model3D, layerOf: (symbol: number, className: string) => number): (string | null)[] {
  const ids: (string | null)[] = [];
  const table = file.instanceDefinitions();
  const taken = new Set<string>();
  for (const [k, symbol] of (model.symbols ?? []).entries()) {
    const geometry: GeometryBase[] = [];
    const attrs: ObjectAttributes[] = [];
    try {
      for (const obj of symbol.objects) {
        if (obj.instance) {
          const ref = blockOf(rhino, ids, obj);
          if (ref) {
            geometry.push(ref);
            attrs.push(attributes(rhino, layerOf(k, obj.className), undefined, obj.name));
          }
          continue;
        }
        for (const piece of obj.pieces) {
          const mesh = pieceMesh(rhino, piece);
          if (!mesh) continue;
          geometry.push(mesh);
          attrs.push(attributes(rhino, layerOf(k, obj.className), piece.color, obj.name));
        }
      }
      const i = geometry.length ? table.add(uniqueName(symbol.name, "Block", taken), "", "", "", [0, 0, 0], geometry, attrs) : -1;
      const def = i >= 0 ? table.get(i) : null;
      ids.push(def ? def.id : null);
      free(def);
    } finally {
      for (const g of geometry) free(g);
      for (const a of attrs) free(a);
    }
  }
  return ids;
}

/** An instance of the block an object places, through its matrix; null when that block wasn't made. */
function blockOf(rhino: Rhino, blocks: readonly (string | null)[], obj: ModelObject): InstanceReference | null {
  const id = obj.instance ? blocks[obj.instance.symbol] : null;
  if (!id) return null;
  const xf = transformOf(rhino, obj.instance!.matrix);
  try {
    return new (rhino.InstanceReference as unknown as new (id: string, xf: Transform) => InstanceReference)(id, xf);
  } finally {
    free(xf);
  }
}

/** A rhino3dm Transform of a placement's 12 numbers (the images of the axes, then where the origin goes). */
function transformOf(rhino: Rhino, m: readonly number[]): Transform {
  const t = new rhino.Transform(1);
  // each axis's image is a column, the origin's the last
  const columns = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9), m.slice(9, 12)];
  const cells = t as unknown as Record<string, number>;
  columns.forEach((v, c) => v.forEach((x, r) => (cells[`m${r}${c}`] = x)));
  return t;
}

/**
 * Adds the Rhino layers: one per design layer, in the drawing's order, then a sublayer for each class its objects
 * (and the objects of the symbols it is the first to place, `placedOn`) use. Returns the layer index of each
 * (layer, class) pair, keyed by `keyOf`.
 */
function addLayers(
  file: File3dm,
  rhino: Rhino,
  model: Model3D,
  flat: readonly FlatObject[],
  layerNames: ReadonlyMap<string, string>,
  placedOn: readonly string[],
): Map<string, number> {
  const groups = new Map<string, { name: string; classes: string[] }>();
  const use = (layerId: string, name: string, className: string): void => {
    let g = groups.get(layerId);
    if (!g) {
      g = { name, classes: [] };
      groups.set(layerId, g);
    }
    if (!g.classes.includes(className)) g.classes.push(className);
  };
  for (const layer of model.layers) {
    const name = layer.name || (layerNames.get(layer.id) ?? "");
    for (const obj of layer.objects) use(layer.id, name, obj.className);
    placedOn.forEach((id, k) => {
      if (id === layer.id) for (const obj of model.symbols?.[k]?.objects ?? []) use(id, name, obj.className);
    });
  }
  for (const f of flat) use(f.layerId, layerNames.get(f.layerId) ?? "", f.className);

  const out = new Map<string, number>();
  const taken = new Set<string>();
  for (const [layerId, g] of groups) {
    const top = addLayer(file, rhino, uniqueName(g.name, "Layer", taken), null);
    const inside = new Set<string>();
    for (const className of g.classes) {
      out.set(keyOf(layerId, className), addLayer(file, rhino, uniqueName(className, "None", inside), top.id).index);
    }
  }
  return out;
}

/** Adds a layer under `parentId` (none for a top-level one) and returns its index in the file and its id. */
function addLayer(file: File3dm, rhino: Rhino, name: string, parentId: string | null): { index: number; id: string } {
  const layer = new rhino.Layer();
  try {
    layer.name = name;
    if (parentId) layer.parentLayerId = parentId;
    const index = file.layers().add(layer);
    const added = file.layers().get(index);
    try {
      return { index, id: added.id };
    } finally {
      free(added);
    }
  } finally {
    free(layer);
  }
}

/** A key for a (layer, class) pair. */
function keyOf(layerId: string, className: string): string {
  return `${layerId}\n${className}`;
}

/**
 * A name Rhino takes for a layer: its path separator "::" and control characters out, never empty, and unique
 * in `taken` (case-blind), with " 2", " 3"... added to a repeat.
 */
function uniqueName(raw: string, fallback: string, taken: Set<string>): string {
  const base = raw.replace(/::/g, ":").replace(/[\u0000-\u001f]/g, " ").trim() || fallback;
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}

/**
 * A mesh of one piece's triangles, the vertices shared where they meet and degenerate triangles left out.
 * Null when none is left.
 */
function pieceMesh(rhino: Rhino, piece: ModelPiece): Mesh | null {
  const mesh = new rhino.Mesh();
  const verts = mesh.vertices();
  const faces = mesh.faces();
  const at = new Map<string, number>();
  const vertex = (x: number, y: number, z: number): number => {
    const key = `${x} ${y} ${z}`;
    let i = at.get(key);
    if (i === undefined) {
      i = verts.add(x, y, z);
      at.set(key, i);
    }
    return i;
  };
  let triangles = 0;
  const t = piece.triangles;
  try {
    for (let k = 0; k + 8 < t.length; k += 9) {
      const a = vertex(t[k], t[k + 1], t[k + 2]);
      const b = vertex(t[k + 3], t[k + 4], t[k + 5]);
      const c = vertex(t[k + 6], t[k + 7], t[k + 8]);
      if (a === b || b === c || a === c) continue;
      faces.addTriFace(a, b, c);
      triangles++;
    }
  } finally {
    free(verts);
    free(faces);
  }
  if (triangles === 0) {
    free(mesh);
    return null;
  }
  return mesh;
}

/** Attributes for an object on a layer, coloured by the object (when it has a colour) and named. */
function attributes(rhino: Rhino, layerIndex: number, colour: string | undefined, name = ""): ObjectAttributes {
  const a = new rhino.ObjectAttributes();
  a.name = name;
  a.layerIndex = layerIndex;
  if (colour) {
    a.colorSource = rhino.ObjectColorSource.ColorFromObject;
    a.objectColor = rgbOf(colour);
  }
  return a;
}

/** A 2D object written as its Rhino counterpart at its z; shapes with no Rhino form are left out. */
function writeFlat(rhino: Rhino, objects: ReturnType<File3dm["objects"]>, f: FlatObject, layerIndex: number): void {
  const s: Shape = f.shape;
  const attrs = attributes(rhino, layerIndex, f.color);
  try {
    switch (s.kind) {
      case "line": {
        if (s.points.length < 2) break;
        const [a, b] = s.points;
        objects.addLine(at3(a, f.z), at3(b, f.z), attrs);
        break;
      }
      case "rect":
      case "polygon":
      case "polyline": {
        const pts = s.points.map((p) => at3(p, f.z));
        if (s.closed && pts.length) pts.push([...pts[0]]);
        if (pts.length >= 2) objects.addPolyline(pts, attrs);
        break;
      }
      case "arc":
        writeArc(rhino, objects, s, f.z, attrs);
        break;
      case "text":
        writeText(rhino, objects, s, f.z, f.scale, attrs);
        break;
      case "locus": {
        const p = s.points[0];
        if (p) objects.addPoint(at3(p, f.z), attrs);
        break;
      }
      default:
        break;
    }
  } finally {
    free(attrs);
  }
}

/**
 * An arc: a circle when complete, an arc when circular (its radius the x one) and a sampled polyline when
 * elliptical. Its sweep counts from its start, counter-clockwise when positive.
 */
function writeArc(rhino: Rhino, objects: ReturnType<File3dm["objects"]>, s: Shape, z: number, attrs: ObjectAttributes): void {
  const c = s.center;
  if (!c || s.rx === undefined || s.ry === undefined) return;
  const rx = Math.abs(s.rx);
  const ry = Math.abs(s.ry);
  const a0 = s.startAngle ?? 0;
  const sweep = s.sweepAngle ?? 0;
  if (sweep === 0 || !(rx > 0) || !(ry > 0)) return;
  const full = Math.abs(sweep) >= 360;
  if (Math.abs(rx - ry) <= 1e-6 * Math.max(rx, ry, 1)) {
    if (full) {
      const circle = new rhino.Circle([c.x, c.y, z], rx);
      try {
        objects.addCircle(circle, attrs);
      } finally {
        free(circle);
      }
      return;
    }
    // three points on the arc fix it, its middle one giving the way round
    const pt = (deg: number): number[] => [c.x + rx * Math.cos(rad(deg)), c.y + rx * Math.sin(rad(deg)), z];
    const arc = rhino.Arc.createFromPoints(pt(a0), pt(a0 + sweep / 2), pt(a0 + sweep));
    try {
      objects.addArc(arc, attrs);
    } finally {
      free(arc);
    }
    return;
  }
  // an ellipse has no Rhino arc here, so it is sampled
  const total = full ? Math.sign(sweep) * 360 : sweep;
  const count = full ? ELLIPSE_SEGMENTS : ELLIPSE_SEGMENTS + 1;
  const pts: number[][] = [];
  for (let i = 0; i < count; i++) pts.push(at3(arcPoint(c, rx, ry, a0 + (total * i) / ELLIPSE_SEGMENTS), z));
  if (full) pts.push([...pts[0]]);
  objects.addPolyline(pts, attrs);
}

/**
 * Text as a text dot at the anchor, its font height the text's size in points on a layer at 1:`scale` (whole, at
 * least MIN_DOT_POINTS; a dot keeps no finer size and no rotation).
 */
function writeText(rhino: Rhino, objects: ReturnType<File3dm["objects"]>, s: Shape, z: number, scale: number, attrs: ObjectAttributes): void {
  const at = s.anchor ?? (s.bbox ? { x: s.bbox.x0, y: s.bbox.y0 } : null);
  if (!s.text || !at) return;
  const text = s.text.replace(/\r\n|\r/g, "\n");
  const points = s.textSize !== undefined && s.textSize > 0 ? s.textSize / (MM_PER_PT * (scale > 0 ? scale : 1)) : DEFAULT_POINTS;
  const id = objects.addTextDot(text, at3(at, z), attrs);
  const o = objects.findId(id);
  try {
    const g = o.geometry();
    try {
      if (g instanceof rhino.TextDot) g.fontHeight = Math.max(MIN_DOT_POINTS, Math.round(points));
    } finally {
      free(g);
    }
  } finally {
    free(o);
  }
}

/** A plan point at z, as rhino3dm takes a point. */
function at3(p: Pt, z: number): number[] {
  return [p.x, p.y, z];
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** A "#rrggbb" colour as rhino3dm's colour object (0..255 channels, opaque); black when it isn't one. */
function rgbOf(hex: string): { r: number; g: number; b: number; a: number } {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return { r: 0, g: 0, b: 0, a: 255 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 255 };
}

/**
 * Frees a rhino3dm object (its wasm memory); the typings leave `delete` out. The file's own tables (objects, layers,
 * materials, dimension styles) are views into the file and go with it, and their `delete(id)` would shadow this.
 */
function free(o: object | null | undefined): void {
  (o as { delete?: () => void } | null | undefined)?.delete?.();
}
