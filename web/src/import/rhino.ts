// Rhino .3dm import, the reading side (no DOM). parse3dm reads a Rhino file through rhino3dm (openNURBS
// compiled to WebAssembly; the app loads it and passes it in): a mesh's faces, each Brep face's and each
// extrusion's render mesh as parts; lines, polylines, circles and arcs in planes parallel to XY, text and
// points as 2D shapes in millimetres, any other curve sampled into a polyline. Each part and shape is
// grouped by its layer's full path and coloured as its object's colour source says (layer, object,
// material, or the block instance holding it). A file that places blocks comes back as a tree: each block
// definition a symbol of its objects, read once (once per colour its instances give it, when its objects
// take their instance's colour), and each instance placing it by its transform, nested up to 8 deep.
// The file's units go in the frame. Left out and counted: hidden layers and
// objects, subdivision surfaces, bare surfaces, Breps and extrusions saved without a render mesh (Rhino's
// "Save Small"), hatches, lights, dimensions, point clouds, and text entities whose height can't be had.
// It reads what export/rhino.ts writes.

import type {
  Arc, Brep, Curve, Extrusion, File3dm, File3dmObject, GeometryBase, InstanceDefinition, InstanceReference,
  Mesh, ObjectAttributes, Polyline, Text, TextDot, Transform, UnitSystem,
} from "rhino3dm";
import type rhino3dm from "rhino3dm";
import type { NewShape, Pt } from "../core/types.ts";
import { MAX_FACES, placementOf, tooMany, treeTop, type MeshFile, type MeshPart, type MeshTree, type MeshTreeInstance } from "./mesh.ts";

/** The rhino3dm module as its factory resolves; the app loads it, so this file only names its type. */
export type Rhino = Awaited<ReturnType<typeof rhino3dm>>;

/** Block instances nested deeper than this are left out. */
const MAX_NEST = 8;
/** Samples taken along a curve that is neither a line, a polyline nor an arc. */
const CURVE_SAMPLES = 128;
/** The text height a text without one is given (mm). */
const DEFAULT_TEXT_MM = 2.5;
/** Rhino's text dot size when it gives none (points). */
const DOT_POINTS = 14;
/** Millimetres in a point. */
const MM_PER_PT = 25.4 / 72;
/** Plan points closer than this (mm) are the same point. */
const SAME_MM = 1e-6;
const NO_MESH = "surface without a render mesh";
/** The 16 fields of a rhino3dm Transform, row by row. */
const MATRIX_FIELDS = Array.from({ length: 16 }, (_, i) => `m${Math.floor(i / 4)}${i % 4}`);

/** A colour, 0..1 channels. */
type Rgb = { r: number; g: number; b: number };

/** Where a point of an arc or plane lies: rhino3dm's Plane keeps its axes, which its typings leave out. */
interface PlaneAxes {
  origin: number[];
  xAxis: number[];
  yAxis: number[];
  zAxis: number[];
}

/** A layer as the file gives it: its full path, whether it or a parent is off, its colour and its render material. */
interface LayerRow {
  path: string;
  hidden: boolean;
  colour?: Rgb;
  material: number;
}

/** What the file, or the block instance an object is in, passes to the object. */
interface Ctx {
  /** how many block instances the object is inside */
  depth: number;
  /** the colour the instance gives its objects (a colour from parent) */
  colour?: Rgb;
  /** the render material index the instance gives its objects (a material from parent), -1 for none */
  material: number;
  /** the transform placing the objects, row-major 4 × 4; null for none */
  xf: number[] | null;
  /** whether that transform mirrors them */
  mirror: boolean;
}

/** One object as it is placed: its name, its layer's path, its colour, and whether its faces turn over. */
interface Item {
  name: string;
  group: string;
  colour: Rgb | undefined;
  mirror: boolean;
}

/** What the objects being read go into: the file's top level, or a block definition's symbol. */
interface Sink {
  parts: MeshPart[];
  shapes: NonNullable<MeshFile["shapes"]>;
  /** blocks placed, each on its layer's path (`group`) at the top level */
  instances: (MeshTreeInstance & { group?: string })[];
}

/** The file's state while it is read. */
interface Scan {
  readonly rhino: Rhino;
  readonly file: File3dm;
  /** millimetres per file unit */
  readonly mm: number;
  readonly layers: LayerRow[];
  readonly objects: ReturnType<File3dm["objects"]>;
  readonly definitions: ReturnType<File3dm["instanceDefinitions"]>;
  readonly materials: ReturnType<File3dm["materials"]>;
  /** where objects read now go */
  out: Sink;
  /** the blocks as symbols, when the file places any; null to read their objects where they are placed */
  readonly symbols: MeshTree["symbols"] | null;
  /** each block's symbol, by its id and the colour and material its instance gives it; -1 for none */
  readonly made: Map<string, number>;
  /** whether a block's objects take colour or material from their instance, by its id */
  readonly fromParent: Map<string, boolean>;
  readonly skipped: Record<string, number>;
  readonly diffuse: Map<number, Rgb | undefined>;
  faces: number;
}

const TOP: Ctx = { depth: 0, material: -1, xf: null, mirror: false };
const NO_LAYER: LayerRow = { path: "", hidden: false, material: -1 };

/**
 * A Rhino .3dm file: its objects as parts and 2D shapes, in the file's own units and axes (frame.mm says
 * how many millimetres a unit is; z up), or as a tree of them when it places blocks. Throws when the bytes
 * aren't a 3DM file or it has too many faces.
 */
export function parse3dm(bytes: Uint8Array, rhino: Rhino): MeshFile {
  const file = rhino.File3dm.fromByteArray(bytes);
  if (!file) throw new Error("it isn't a Rhino 3DM file");
  try {
    return scan(file, rhino);
  } finally {
    free(file);
  }
}

/** Reads every top-level object of an open file. */
function scan(file: File3dm, rhino: Rhino): MeshFile {
  const settings = file.settings();
  const mm = mmPerUnit(rhino, settings.modelUnitSystem);
  free(settings);
  const objects = file.objects();
  const definitions = file.instanceDefinitions();
  const materials = file.materials();
  const top: Sink = { parts: [], shapes: [], instances: [] };
  const s: Scan = {
    rhino,
    file,
    mm,
    layers: layerRows(file),
    objects,
    definitions,
    materials,
    out: top,
    symbols: placesBlocks(rhino, objects) ? [] : null,
    made: new Map(),
    fromParent: new Map(),
    skipped: {},
    diffuse: new Map(),
    faces: 0,
  };
  try {
    for (let i = 0; i < objects.count; i++) {
      const o = objects.get(i);
      try {
        readObject(s, o, TOP, true);
      } finally {
        free(o);
      }
    }
  } finally {
    free(definitions);
  }
  const frame = { mm, yUp: false };
  if (!s.symbols) return { parts: top.parts, skipped: s.skipped, frame, ...(top.shapes.length ? { shapes: top.shapes } : {}) };
  return { parts: [], skipped: s.skipped, frame, tree: { symbols: s.symbols, top: treeTop(top.parts, top.instances, top.shapes) } };
}

/** Whether a top-level object of the file places a block. */
function placesBlocks(rhino: Rhino, objects: ReturnType<File3dm["objects"]>): boolean {
  for (let i = 0; i < objects.count; i++) {
    const o = objects.get(i);
    const attrs = o.attributes();
    const geo = o.geometry();
    try {
      if (geo instanceof rhino.InstanceReference && !attrs.isInstanceDefinitionObject) return true;
    } finally {
      free(geo);
      free(attrs);
      free(o);
    }
  }
  return false;
}

/** Millimetres per unit of each unit system a file may keep; None, custom and unset are taken as millimetres. */
function mmPerUnit(rhino: Rhino, units: UnitSystem): number {
  const u = rhino.UnitSystem;
  switch (units) {
    case u.Angstroms:
      return 1e-7;
    case u.Nanometers:
      return 1e-6;
    case u.Microns:
      return 1e-3;
    case u.Millimeters:
      return 1;
    case u.Centimeters:
      return 10;
    case u.Decimeters:
      return 100;
    case u.Meters:
      return 1000;
    case u.Dekameters:
      return 1e4;
    case u.Hectometers:
      return 1e5;
    case u.Kilometers:
      return 1e6;
    case u.Megameters:
      return 1e9;
    case u.Gigameters:
      return 1e12;
    case u.Microinches:
      return 2.54e-5;
    case u.Mils:
      return 0.0254;
    case u.Inches:
      return 25.4;
    case u.Feet:
      return 304.8;
    case u.Yards:
      return 914.4;
    case u.Miles:
      return 1609344;
    case u.PrinterPoints:
      return 25.4 / 72;
    case u.PrinterPicas:
      return 25.4 / 6;
    case u.NauticalMiles:
      return 1852000;
    case u.AstronomicalUnits:
      return 1.495978707e11 * 1000;
    case u.LightYears:
      return 9.4607304725808e15 * 1000;
    case u.Parsecs:
      return 3.0856775814913673e16 * 1000;
    default:
      return 1;
  }
}

/** Every layer of the file, by index, with its full path, whether it is off (or a parent is), and its colour and material. */
function layerRows(file: File3dm): LayerRow[] {
  const table = file.layers();
  const raw: { id: string; parent: string; path: string; visible: boolean; colour?: Rgb; material: number }[] = [];
  try {
    for (let i = 0; i < table.count; i++) {
      const l = table.get(i);
      try {
        raw.push({ id: l.id, parent: l.parentLayerId, path: l.fullPath, visible: l.visible, colour: rgbOf(l.color), material: l.renderMaterialIndex });
      } finally {
        free(l);
      }
    }
  } finally {
  }
  const byId = new Map(raw.map((r, i): [string, number] => [r.id, i]));
  return raw.map((r, i): LayerRow => {
    // a layer is off when it or any parent is
    let hidden = false;
    let at: number | undefined = i;
    for (let hops = 0; at !== undefined && hops <= raw.length; hops++) {
      if (!raw[at].visible) {
        hidden = true;
        break;
      }
      at = byId.get(raw[at].parent);
    }
    return { path: r.path, hidden, ...(r.colour ? { colour: r.colour } : {}), material: r.material };
  });
}

/** One object (a top-level one, or one held by a block instance placed by `ctx`) read into parts and shapes, unless it is hidden. */
function readObject(s: Scan, o: File3dmObject, ctx: Ctx, top: boolean): void {
  const { rhino } = s;
  const attrs = o.attributes();
  const geo = o.geometry();
  try {
    // a block's objects are drawn through their instances, not on their own
    if (top && attrs.isInstanceDefinitionObject) return;
    const row = s.layers[attrs.layerIndex] ?? NO_LAYER;
    if (!attrs.visible || attrs.mode === rhino.ObjectMode.Hidden || row.hidden) {
      count(s, "hidden object");
      return;
    }
    const colour = colourOf(s, attrs, row, ctx);
    if (geo instanceof rhino.InstanceReference) {
      if (s.symbols) placeBlock(s, geo, ctx, colour, materialOf(s, attrs, row, ctx), attrs.name, row.path);
      else readBlock(s, geo, ctx, colour, materialOf(s, attrs, row, ctx));
      return;
    }
    const item: Item = { name: attrs.name, group: row.path, colour, mirror: ctx.mirror };
    // a block's geometry is copied and moved, so the file's own copy stays as it is
    const g = ctx.xf ? placed(s, geo, ctx.xf) : geo;
    try {
      readGeometry(s, g, item);
    } finally {
      if (g !== geo) free(g);
    }
  } finally {
    free(geo);
    free(attrs);
  }
}

/** A block instance's definition's objects, placed through the instance's transform, no deeper than MAX_NEST. */
function readBlock(s: Scan, ref: InstanceReference, ctx: Ctx, colour: Rgb | undefined, material: number): void {
  if (ctx.depth >= MAX_NEST) {
    count(s, "nested block");
    return;
  }
  const def = s.definitions.findId(ref.parentIdefId);
  if (!def) return;
  try {
    const own = matrixOf(ref.xform);
    const xf = compose(ctx.xf, own);
    const child: Ctx = { depth: ctx.depth + 1, colour, material, xf, mirror: ctx.mirror !== (det(xf) < 0) };
    // the ids are the definition's own objects, which the file also keeps in its object table
    const ids = def.getObjectIds() as unknown as string[];
    for (const id of ids) {
      const o = s.objects.findId(id);
      if (!o) continue;
      try {
        readObject(s, o, child, false);
      } finally {
        free(o);
      }
    }
  } finally {
    free(def);
  }
}

/**
 * A block instance as an instance of its definition's symbol, by its transform, named unless its name only
 * repeats its block's; no deeper than MAX_NEST.
 */
function placeBlock(s: Scan, ref: InstanceReference, ctx: Ctx, colour: Rgb | undefined, material: number, name: string, path: string): void {
  if (ctx.depth >= MAX_NEST) return count(s, "nested block");
  const def = s.definitions.findId(ref.parentIdefId);
  if (!def) return;
  try {
    const k = symbolOf(s, def, ctx.depth + 1, colour, material);
    if (k < 0) return;
    const own = name && name !== def.name ? { name } : {};
    s.out.instances.push({ symbol: k, matrix: placementOf(matrixOf(ref.xform)), ...own, ...(ctx.depth === 0 && path ? { group: path } : {}) });
  } finally {
    free(def);
  }
}

/**
 * A block definition's symbol, its objects read in its own frame the first time an instance at `depth`
 * places it (a symbol per colour and material its instances give it when its objects take them); -1 when
 * it holds nothing that comes in, or is placed inside itself.
 */
function symbolOf(s: Scan, def: InstanceDefinition, depth: number, colour: Rgb | undefined, material: number): number {
  const ids = def.getObjectIds() as unknown as string[];
  const fromParent = takesParent(s, def.id, ids);
  const key = fromParent ? `${def.id}\n${colour ? hexOf(colour) : ""}\n${material}` : def.id;
  const known = s.made.get(key);
  if (known !== undefined) return known;
  s.made.set(key, -1);
  const outer = s.out;
  const content: Sink = { parts: [], shapes: [], instances: [] };
  s.out = content;
  try {
    const child: Ctx = { depth, colour, material, xf: null, mirror: false };
    for (const id of ids) {
      const o = s.objects.findId(id);
      if (!o) continue;
      try {
        readObject(s, o, child, false);
      } finally {
        free(o);
      }
    }
  } finally {
    s.out = outer;
  }
  if (!content.parts.length && !content.shapes.length && !content.instances.length) return -1;
  const name = def.name || "Block";
  s.symbols!.push({
    name: fromParent && colour ? `${name} (${hexOf(colour)})` : name,
    content: { parts: content.parts, groups: [], instances: content.instances, ...(content.shapes.length ? { shapes: content.shapes } : {}) },
  });
  s.made.set(key, s.symbols!.length - 1);
  return s.symbols!.length - 1;
}

/** Whether any of a block's objects takes its colour or material from the instance placing it. */
function takesParent(s: Scan, id: string, ids: readonly string[]): boolean {
  let v = s.fromParent.get(id);
  if (v === undefined) {
    v = false;
    for (const oid of ids) {
      const o = s.objects.findId(oid);
      if (!o) continue;
      const a = o.attributes();
      try {
        v = a.colorSource === s.rhino.ObjectColorSource.ColorFromParent || a.materialSource === s.rhino.ObjectMaterialSource.MaterialFromParent;
      } finally {
        free(a);
        free(o);
      }
      if (v) break;
    }
    s.fromParent.set(id, v);
  }
  return v;
}

/** "#rrggbb" of a colour. */
function hexOf(c: Rgb): string {
  return "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** The geometry copied and moved by `xf`, so the file's own is not changed. */
function placed(s: Scan, geo: GeometryBase, xf: number[]): GeometryBase {
  const copy = geo.duplicate();
  const t = transformOf(s.rhino, xf);
  try {
    copy.transform(t);
  } finally {
    free(t);
  }
  return copy;
}

/** Reads one object's geometry by its kind; kinds with no 2D or 3D form are counted. */
function readGeometry(s: Scan, g: GeometryBase, item: Item): void {
  const r = s.rhino;
  if (g instanceof r.Mesh) return readMesh(s, g, item);
  if (g instanceof r.Brep) return readBrep(s, g, item);
  if (g instanceof r.Extrusion) return readExtrusion(s, g, item);
  if (g instanceof r.SubD) return count(s, "subdivision surface");
  if (g instanceof r.Curve) return pushShape(s, curveShape(s, g), item);
  if (g instanceof r.TextDot) return readDot(s, g, item);
  if (g instanceof r.Point) return pushShape(s, { kind: "locus", at: plan(s, g.location) }, item);
  if (g instanceof r.Text) return readText(s, g, item);
  if (g instanceof r.Surface) return count(s, "curve or surface");
  if (g instanceof r.Hatch) return count(s, "hatch pattern");
  if (g instanceof r.Light) return count(s, "light");
  if (g instanceof r.PointCloud) return count(s, "point cloud");
  if (g instanceof r.AnnotationBase) return count(s, "annotation");
  count(s, "other object");
}

/** A mesh's faces (quads as four corners, triangles as three) as one part. */
function readMesh(s: Scan, mesh: Mesh, item: Item): void {
  addPart(s, item, meshFaces(s, mesh, item.mirror));
}

/** A Brep's render mesh, face by face, as one part; a Brep with a face missing its mesh is counted once. */
function readBrep(s: Scan, brep: Brep, item: Item): void {
  const faces: number[][] = [];
  let bare = false;
  const list = brep.faces();
  try {
    for (let i = 0; i < list.count; i++) {
      const face = list.get(i);
      try {
        const got = renderFaces(s, face.getMesh(s.rhino.MeshType.Any), item.mirror);
        if (got) for (const f of got) faces.push(f);
        else bare = true;
      } finally {
        free(face);
      }
    }
  } finally {
    free(list);
  }
  if (bare) count(s, NO_MESH);
  addPart(s, item, faces);
}

/** An extrusion's render mesh as one part; with none saved it is counted. */
function readExtrusion(s: Scan, ext: Extrusion, item: Item): void {
  const faces = renderFaces(s, ext.getMesh(s.rhino.MeshType.Any), item.mirror);
  if (!faces) count(s, NO_MESH);
  addPart(s, item, faces ?? []);
}

/**
 * A text dot: its text at its point. A dot is drawn the same size on screen however near, so it has no size in
 * the model; its font height is taken as points on paper, for the layer it comes in on to scale.
 */
function readDot(s: Scan, dot: TextDot, item: Item): void {
  if (!dot.text) return;
  const points = dot.fontHeight > 0 ? dot.fontHeight : DOT_POINTS;
  pushShape(s, { kind: "text", at: plan(s, dot.point), text: dot.text, height: points * MM_PER_PT }, item, points);
}

/**
 * A text entity: its plain text on its plane, sized by its text style (the file's first dimension style, which
 * gives its height). Left out and counted when the file has no dimension style to give it.
 */
function readText(s: Scan, t: Text, item: Item): void {
  const text = t.plainText;
  const styles = s.file.dimstyles();
  if (!text) return;
  if (t.annotationType !== s.rhino.AnnotationType.Text || styles.count === 0) return count(s, "annotation");
  const style = styles.get(0);
  let height: number;
  try {
    height = t.getTextHeight(style) * s.mm;
  } finally {
    free(style);
  }
  const plane = t.plane;
  try {
    const axes = plane as unknown as PlaneAxes;
    const angle = (Math.atan2(axes.xAxis[1], axes.xAxis[0]) * 180) / Math.PI + t.textRotationDegrees;
    pushShape(s, { kind: "text", at: plan(s, axes.origin), text, height: height > 0 ? height : DEFAULT_TEXT_MM, angle }, item);
  } finally {
    free(plane);
  }
}

/** A curve as a 2D shape: a line, a polyline, an arc (a circle, or an arc in a plane parallel to XY), or a sampled polyline. */
function curveShape(s: Scan, c: Curve): NewShape | null {
  const r = s.rhino;
  if (c instanceof r.LineCurve) return { kind: "line", a: plan(s, c.pointAtStart), b: plan(s, c.pointAtEnd) };
  if (c instanceof r.PolylineCurve) {
    const pts: number[][] = [];
    for (let i = 0; i < c.pointCount; i++) pts.push(c.point(i));
    return polylineShape(s, pts, c.isClosed);
  }
  if (c.isArc()) {
    const arc = arcShape(s, c);
    if (arc) return arc;
  }
  if (c.isPolyline()) {
    const pl = c.tryGetPolyline() as Polyline | null;
    if (pl) {
      try {
        const pts: number[][] = [];
        for (let i = 0; i < pl.count; i++) pts.push(pl.get(i));
        return polylineShape(s, pts, pl.isClosed);
      } finally {
        free(pl);
      }
    }
  }
  const [t0, t1] = c.domain;
  const pts: number[][] = [];
  for (let i = 0; i <= CURVE_SAMPLES; i++) pts.push(c.pointAt(t0 + ((t1 - t0) * i) / CURVE_SAMPLES));
  return polylineShape(s, pts, c.isClosed);
}

/** A polyline in plan; a closed one drops the point that repeats its first. */
function polylineShape(s: Scan, pts: number[][], closed: boolean): NewShape | null {
  const p = pts.map((q) => plan(s, q));
  if (closed && p.length > 1 && samePlan(p[0], p[p.length - 1])) p.pop();
  if (p.length < 2) return null;
  return { kind: "polyline", points: p, closed };
}

/**
 * A circle or arc whose plane is parallel to XY, as an arc in plan with its start and sweep counter-clockwise
 * from +x. Null for an arc in another plane, which is then sampled. The sweep's direction comes from the
 * curve's middle, so the arc's own parametrisation (or a reversed one) doesn't matter.
 */
function arcShape(s: Scan, c: Curve): NewShape | null {
  const arc = c.tryGetArc() as Arc | null;
  if (!arc) return null;
  try {
    const plane = arc.plane;
    try {
      const z = (plane as unknown as PlaneAxes).zAxis;
      if (Math.abs(Math.abs(z[2]) - 1) > 1e-6) return null;
    } finally {
      free(plane);
    }
    const center = plan(s, arc.center);
    const radius = arc.radius * s.mm;
    if (arc.isCircle) return { kind: "arc", center, radius, startAngle: 0, sweepAngle: 360 };
    const [t0, t1] = c.domain;
    const c0 = arc.center;
    const angle = (q: number[]): number => (Math.atan2(q[1] - c0[1], q[0] - c0[0]) * 180) / Math.PI;
    const a0 = angle(c.pointAtStart);
    const span = mod360(angle(c.pointAtEnd) - a0);
    const mid = mod360(angle(c.pointAt((t0 + t1) / 2)) - a0);
    const sweep = span < 1e-9 ? 360 : mid < span ? span : span - 360;
    return { kind: "arc", center, radius, startAngle: mod360(a0), sweepAngle: sweep };
  } finally {
    free(arc);
  }
}

/** A render mesh's faces read through the placement's mirroring. */
function meshFaces(s: Scan, mesh: Mesh, mirror: boolean): number[][] {
  const verts = mesh.vertices();
  const faces = mesh.faces();
  try {
    const n = verts.count;
    const p: number[][] = [];
    for (let i = 0; i < n; i++) p.push(verts.get(i));
    const out: number[][] = [];
    for (let f = 0; f < faces.count; f++) {
      const q = faces.get(f);
      // a triangle is a quad whose last two corners are the same
      const idx = q[2] === q[3] ? [q[0], q[1], q[2]] : [q[0], q[1], q[2], q[3]];
      if (idx.some((i) => !(i >= 0 && i < n)) || new Set(idx).size < 3) {
        count(s, "bad face");
        continue;
      }
      if (mirror) idx.reverse();
      if (++s.faces > MAX_FACES) throw tooMany();
      out.push(idx.flatMap((i) => p[i]));
    }
    return out;
  } finally {
    free(verts);
    free(faces);
  }
}

/** A surface's render mesh faces, or null when it has no mesh saved. */
function renderFaces(s: Scan, mesh: Mesh | null, mirror: boolean): number[][] | null {
  if (!mesh) return null;
  try {
    return meshFaces(s, mesh, mirror);
  } finally {
    free(mesh);
  }
}

/** The colour an object is drawn in, from the source its attributes name. */
function colourOf(s: Scan, attrs: ObjectAttributes, row: LayerRow, ctx: Ctx): Rgb | undefined {
  const src = s.rhino.ObjectColorSource;
  switch (attrs.colorSource) {
    case src.ColorFromObject:
      return rgbOf(attrs.objectColor) ?? row.colour;
    case src.ColorFromMaterial:
      return materialColour(s, materialOf(s, attrs, row, ctx)) ?? row.colour;
    case src.ColorFromParent:
      return ctx.colour ?? row.colour;
    default:
      return row.colour;
  }
}

/** The render material index an object takes, from its material source (-1 for none). */
function materialOf(s: Scan, attrs: ObjectAttributes, row: LayerRow, ctx: Ctx): number {
  const src = s.rhino.ObjectMaterialSource;
  switch (attrs.materialSource) {
    case src.MaterialFromObject:
      return attrs.materialIndex;
    case src.MaterialFromParent:
      return ctx.material;
    default:
      return row.material;
  }
}

/** A render material's diffuse colour, read once per material. */
function materialColour(s: Scan, index: number): Rgb | undefined {
  if (index < 0 || index >= s.materials.count) return undefined;
  if (!s.diffuse.has(index)) {
    const m = s.materials.get(index);
    try {
      s.diffuse.set(index, rgbOf(m.diffuseColor));
    } finally {
      free(m);
    }
  }
  return s.diffuse.get(index);
}

/** A rhino3dm colour object (0..255 channels) as 0..1 channels; undefined when it has none. */
function rgbOf(c: unknown): Rgb | undefined {
  const v = c as { r?: unknown; g?: unknown; b?: unknown } | null | undefined;
  if (!v || typeof v.r !== "number" || typeof v.g !== "number" || typeof v.b !== "number") return undefined;
  return { r: clamp01(v.r / 255), g: clamp01(v.g / 255), b: clamp01(v.b / 255) };
}

/** Adds a part for an object's faces, when it has any, named as the object is in Rhino ("" when it isn't). */
function addPart(s: Scan, item: Item, faces: number[][]): void {
  if (faces.length === 0) return;
  s.out.parts.push({
    name: item.name,
    faces,
    ...(item.group ? { group: item.group } : {}),
    ...(item.colour ? { color: item.colour } : {}),
  });
}

/** Adds a 2D shape for an object, when it has one; `points` sizes a text in points (see MeshFile.shapes). */
function pushShape(s: Scan, shape: NewShape | null, item: Item, points?: number): void {
  if (!shape) return;
  s.out.shapes.push({
    shape,
    ...(item.group ? { group: item.group } : {}),
    ...(item.colour ? { color: item.colour } : {}),
    ...(points !== undefined ? { points } : {}),
  });
}

/** Counts something left out, by its kind. */
function count(s: Scan, kind: string): void {
  s.skipped[kind] = (s.skipped[kind] ?? 0) + 1;
}

/** A point in plan, in millimetres. */
function plan(s: Scan, p: number[]): Pt {
  return { x: p[0] * s.mm, y: p[1] * s.mm };
}

function samePlan(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < SAME_MM && Math.abs(a.y - b.y) < SAME_MM;
}

function mod360(d: number): number {
  return ((d % 360) + 360) % 360;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

/** A row-major 4 × 4 from a rhino3dm Transform. */
function matrixOf(t: Transform): number[] {
  return MATRIX_FIELDS.map((f) => (t as unknown as Record<string, number>)[f]);
}

/** A rhino3dm Transform from a row-major 4 × 4. */
function transformOf(rhino: Rhino, m: number[]): Transform {
  const t = new rhino.Transform(1);
  MATRIX_FIELDS.forEach((f, i) => {
    (t as unknown as Record<string, number>)[f] = m[i];
  });
  return t;
}

/** a · b for row-major 4 × 4s; `b` alone when `a` is null. */
function compose(a: number[] | null, b: number[]): number[] {
  if (!a) return b;
  const out = new Array<number>(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let v = 0;
      for (let k = 0; k < 4; k++) v += a[4 * r + k] * b[4 * k + c];
      out[4 * r + c] = v;
    }
  }
  return out;
}

/** The determinant of a row-major 4 × 4's 3 × 3 part: negative when the transform mirrors. */
function det(m: number[]): number {
  return m[0] * (m[5] * m[10] - m[6] * m[9]) - m[1] * (m[4] * m[10] - m[6] * m[8]) + m[2] * (m[4] * m[9] - m[5] * m[8]);
}

/**
 * Frees a rhino3dm object (its wasm memory); the typings leave `delete` out. The file's own tables (objects, layers,
 * materials, dimension styles) are views into the file and go with it, and their `delete(id)` would shadow this.
 */
function free(o: object | null | undefined): void {
  (o as { delete?: () => void } | null | undefined)?.delete?.();
}

