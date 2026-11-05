// The placers: what a reader read (DXF and DWG entities, a PDF or EMF page, a mesh model) put into a
// drawing the way the editor's importers put it there, with no store, toasts or view. Each runs in one
// batch, so it is one change. They are the headless side of app/dxfImport.ts, app/pdfImport.ts and
// app/meshImport.ts: when one of those changes its placing, change the matching placer too.

import type { Attributes, EditSession, MeshGroupNode, MeshModel, MeshNode, NewShape, Pt } from "../core/index.ts";
import { dxfPlacements, type DxfDrawing, type DxfPlacement } from "../import/dxf.ts";
import { MAX_NESTED_SUBPATHS, type PdfColor, type PdfPage } from "../import/pdf.ts";
import { type MeshFile, type MeshPart, type MeshTree, type MeshTreeNode, treeFaces, treeLines } from "../import/mesh.ts";

const MM_PER_PT = 25.4 / 72;
/** Pen weights are in mils, a thousandth of an inch: per millimetre and per point. */
const MILS_PER_MM = 1000 / 25.4;
const MILS_PER_PT = 1000 / 72;
/** The thinnest pen a PDF line gets, in mils; a width of 0 is the device's thinnest line. */
const MIN_WEIGHT = 2;
/** A page that would make more objects than this is refused. */
const MAX_OBJECTS = 100_000;
/** Most meshes named after the file's objects; past it they stay unnamed, as each name takes one of the drawing's 65,535. */
const MAX_NAMED = 2000;
/** Coordinates and cross products closer to zero than this are zero. */
const EPS = 1e-7;
/** A mesh model's 2D object as the reader gives it: its geometry, its group, its colour and a text's size in points. */
type Drawn = NonNullable<MeshFile["shapes"]>[number];
/** The colour index of a file's colour, as the drawing's colour table gives it. */
type ColorOf = (c: NonNullable<MeshPart["color"]>) => number;

/** The index of the class named "None", where objects with no class of their own go, or undefined. */
export function noneClass(s: EditSession): number | undefined {
  return s.doc.classes().find((c) => c.name === "None")?.index;
}

/** A function giving the palette index of the drawing's colour nearest an (r, g, b) of 0 to 255 each. */
export function nearestColor(s: EditSession): (r: number, g: number, b: number) => number {
  const palette = s.doc
    .colors()
    .map((c) => {
      const n = /^#([0-9a-f]{6})/i.exec(c.css);
      return n ? { index: c.index, r: parseInt(n[1].slice(0, 2), 16), g: parseInt(n[1].slice(2, 4), 16), b: parseInt(n[1].slice(4, 6), 16) } : null;
    })
    .filter((c) => c !== null);
  const seen = new Map<string, number>();
  return (r0, g0, b0) => {
    const r = Math.round(r0);
    const g = Math.round(g0);
    const b = Math.round(b0);
    const key = `${r},${g},${b}`;
    let best = seen.get(key);
    if (best === undefined) {
      let d = Infinity;
      best = 0;
      for (const p of palette) {
        const e = (p.r - r) ** 2 + (p.g - g) ** 2 + (p.b - b) ** 2;
        if (e < d) {
          d = e;
          best = p.index;
        }
      }
      seen.set(key, best);
    }
    return best;
  };
}

/** Twice a ring's signed area. */
function area2(pts: readonly Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a;
}

/** True when p lies inside the ring (even-odd). */
function inside(p: Pt, ring: readonly Pt[]): boolean {
  let on = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) on = !on;
  }
  return on;
}

/** The points without repeats, and without the closing point a closed ring repeats. */
function tidy(pts: readonly Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.abs(q.x - p.x) > 1e-9 || Math.abs(q.y - p.y) > 1e-9) out.push(p);
  }
  if (closed && out.length > 2) {
    const a = out[0];
    const z = out[out.length - 1];
    if (Math.abs(a.x - z.x) < 1e-9 && Math.abs(a.y - z.y) < 1e-9) out.pop();
  }
  return out;
}

/** Filled rings as polygons: each outer ring with the holes directly inside it. */
export function fillShapes(rings: Pt[][]): { points: Pt[]; holes: boolean }[] {
  if (rings.length === 1 || rings.length > MAX_NESTED_SUBPATHS) return rings.map((points) => ({ points, holes: false }));
  const sized = rings.map((points) => ({ points, size: Math.abs(area2(points)), depth: 0, parent: -1 })).sort((a, b) => b.size - a.size);
  for (let i = 0; i < sized.length; i++) {
    // the smallest ring holding this one is the one checked last
    for (let j = i - 1; j >= 0; j--) {
      if (inside(sized[i].points[0], sized[j].points)) {
        sized[i].parent = j;
        sized[i].depth = sized[j].depth + 1;
        break;
      }
    }
  }
  const out: { points: Pt[]; holes: boolean }[] = [];
  sized.forEach((r, i) => {
    if (r.depth % 2 === 1) return;
    const holes = sized.filter((x) => x.parent === i && x.depth % 2 === 1).map((x) => x.points);
    out.push({ points: holes.length ? joinHoles(r.points, holes) : r.points, holes: holes.length > 0 });
  });
  return out;
}

/**
 * Joins holes into their outer ring, so that one ring fills correctly. Each hole is bridged from
 * its leftmost vertex to a visible vertex of the ring: the ring runs to the bridge, once round the
 * hole, back, and on. The bridge is walked both ways, so it has no width or area.
 */
function joinHoles(outer: readonly Pt[], holes: readonly Pt[][]): Pt[] {
  let ring: Pt[] = outer.map((p) => ({ x: p.x, y: p.y }));
  const pending = holes.filter((h) => h.length >= 3).sort((a, b) => maxX(b) - maxX(a));
  for (const hole of pending) {
    const m = leftmost(hole);
    const at = bridgeFrom(ring, hole, hole[m]);
    const loop = [...hole.slice(m), ...hole.slice(0, m), hole[m]];
    ring = [...ring.slice(0, at + 1), ...loop, ring[at], ...ring.slice(at + 1)];
  }
  return ring;
}

function maxX(pts: readonly Pt[]): number {
  return Math.max(...pts.map((p) => p.x));
}

function leftmost(pts: readonly Pt[]): number {
  let best = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[best].x) best = i;
  return best;
}

/** Index of the ring vertex the hole's bridge goes to: the nearest one the segment from `m` reaches without crossing an edge. */
function bridgeFrom(ring: readonly Pt[], hole: readonly Pt[], m: Pt): number {
  const edges = [...edgesOf(ring), ...edgesOf(hole)];
  const order = ring.map((_, i) => i).sort((i, j) => Math.hypot(ring[i].x - m.x, ring[i].y - m.y) - Math.hypot(ring[j].x - m.x, ring[j].y - m.y));
  for (const i of order) {
    const p = ring[i];
    const clear = edges.every(([a, b]) => samePoint(a, p) || samePoint(b, p) || samePoint(a, m) || samePoint(b, m) || !meets(m, p, a, b));
    if (clear) return i;
  }
  return order[0];
}

function edgesOf(pts: readonly Pt[]): [Pt, Pt][] {
  return pts.map((p, i): [Pt, Pt] => [p, pts[(i + 1) % pts.length]]);
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS;
}

/** True when segments ab and cd meet, touching included. */
function meets(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = sideOf(c, d, a);
  const d2 = sideOf(c, d, b);
  const d3 = sideOf(a, b, c);
  const d4 = sideOf(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return true;
  return (d1 === 0 && within(c, d, a)) || (d2 === 0 && within(c, d, b)) || (d3 === 0 && within(a, b, c)) || (d4 === 0 && within(a, b, d));
}

/** Which side of the line from a to b the point p is on: 1 left, -1 right, 0 on it. */
function sideOf(a: Pt, b: Pt, p: Pt): number {
  const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
  return cross > EPS ? 1 : cross < -EPS ? -1 : 0;
}

/** True when p lies in the box of segment ab; for a point known to be on the segment's line, that is on the segment. */
function within(a: Pt, b: Pt, p: Pt): boolean {
  return p.x >= Math.min(a.x, b.x) - EPS && p.x <= Math.max(a.x, b.x) + EPS && p.y >= Math.min(a.y, b.y) - EPS && p.y <= Math.max(a.y, b.y) + EPS;
}

/** Places a DXF or DWG drawing's objects on `layerId` as dxfImport.ts does; returns how many were made and what was left out. */
export function placeDxf(s: EditSession, layerId: string, drawing: DxfDrawing): { count: number; skipped: Record<string, number> } {
  const placements = dxfPlacements(drawing, drawing.mmPerUnit);
  const skipped: Record<string, number> = { ...drawing.skipped };
  const colorOf = nearestColor(s);
  const paletteOf = (rgb: number): number => colorOf((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
  let count = 0;

  s.batch(() => {
    const classes = new Map<string, number | undefined>();
    // a DXF layer is a class of the same name: an existing one is reused, otherwise one is made
    const classOf = (layer: string): number | undefined => {
      if (classes.has(layer)) return classes.get(layer);
      let index: number | undefined = s.doc.classes().find((c) => c.name.toLowerCase() === layer.toLowerCase())?.index;
      if (index === undefined) {
        try {
          index = s.createClass(layer);
          // what is on a layer that is off or frozen stays out of sight, as in AutoCAD
          if (drawing.hiddenLayers.has(layer.toUpperCase())) s.setClassVisibility(index, "hidden");
        } catch {
          // the name is taken by a layer, symbol or line type: the objects use the None class
          index = noneClass(s);
        }
      }
      classes.set(layer, index);
      return index;
    };
    const attrsOf = (p: DxfPlacement): Partial<Attributes> => {
      const color = paletteOf(p.style.color);
      if (p.filled) return { lineStyle: 0, fillPattern: 1, fillFore: color, fillBack: color, fillOpacity: 100 };
      const weight = p.style.weight !== null ? { lineWeight: Math.max(1, Math.round(p.style.weight * MILS_PER_MM)) } : {};
      // a drawing made here has no line types to copy, so its lines are solid, as in the editor's new drawing
      const pen = p.text ? {} : { lineStyle: 2, ...weight };
      return { ...pen, penFore: color, penOpacity: 100, fillPattern: 0 };
    };
    // an object the document cannot hold is left out, like one the reader skipped
    const leftOut = (p: DxfPlacement): void => {
      skipped[p.type] = (skipped[p.type] ?? 0) + 1;
    };
    const one = (p: DxfPlacement, shape: NewShape, cls: number | undefined, attrs: Partial<Attributes>): void => {
      try {
        const id = s.addObject(layerId, shape, cls, attrs);
        if (p.text) {
          // turning or justifying text moves its origin, so it goes back on the anchor after
          s.setTextStyle([id], p.text);
          s.setGeometry(id, shape);
        }
        count++;
      } catch {
        leftOut(p);
      }
    };
    // each add rebuilds the document, so a run of objects in one class goes in as one add; a run
    // holding one the document cannot hold goes in one by one to leave out just that one
    let run: { cls: number | undefined; items: { p: DxfPlacement; shape: NewShape; attrs: Partial<Attributes> }[] } | null = null;
    const flush = (): void => {
      if (!run) return;
      const { cls, items } = run;
      run = null;
      try {
        s.addObjects(layerId, items.map((it) => it.shape), cls, items.map((it) => it.attrs));
        count += items.length;
      } catch {
        for (const it of items) one(it.p, it.shape, cls, it.attrs);
      }
    };
    for (const p of placements) {
      let cls: number | undefined;
      let attrs: Partial<Attributes>;
      try {
        cls = classOf(p.layer);
        attrs = attrsOf(p);
      } catch {
        leftOut(p);
        continue;
      }
      // a fill with holes becomes one polygon per outer ring, with each hole joined into its ring
      const shapes: NewShape[] = p.rings ? fillShapes(p.rings).map((f) => ({ kind: "polygon", points: f.points, closed: true })) : [p.shape];
      if (p.text) {
        flush();
        for (const shape of shapes) one(p, shape, cls, attrs);
        continue;
      }
      if (run && run.cls !== cls) flush();
      run ??= { cls, items: [] };
      for (const shape of shapes) run.items.push({ p, shape, attrs });
    }
    flush();
  });
  return { count, skipped };
}

/** Places a PDF or EMF page on `layerId` at 1:`scale` as pdfImport.ts does, its lower left at the origin; returns the count and what was left out. */
export function placePage(s: EditSession, layerId: string, page: PdfPage, scale: number): { count: number; skipped: Record<string, number> } {
  const k = MM_PER_PT * scale;
  const world = (p: Pt): Pt => ({ x: p.x * k, y: p.y * k });
  const colorOf = nearestColor(s);
  const colour = (c: PdfColor): number => colorOf(c.r * 255, c.g * 255, c.b * 255);
  const shapes: NewShape[] = [];
  const attrs: Partial<Attributes>[] = [];
  const add = (shape: NewShape, a: Partial<Attributes>): void => {
    shapes.push(shape);
    attrs.push(a);
  };
  const noPen: Partial<Attributes> = { lineStyle: 0 };
  const noFill: Partial<Attributes> = { fillPattern: 0 };

  for (const path of page.paths) {
    const pen: Partial<Attributes> = path.stroke
      ? { lineStyle: 2, lineWeight: Math.max(MIN_WEIGHT, Math.round(path.width * MILS_PER_PT)), penFore: colour(path.stroke), penOpacity: 100 }
      : noPen;
    const fill: Partial<Attributes> = path.fill ? { fillPattern: 1, fillFore: colour(path.fill), fillBack: colour(path.fill), fillOpacity: 100 } : noFill;
    const strokes = (): void => {
      for (const sub of path.subpaths) {
        const pts = tidy(sub.points.map(world), sub.closed);
        if (pts.length === 2 && !sub.closed) add({ kind: "line", a: pts[0], b: pts[1] }, { ...pen, ...noFill });
        else if (pts.length >= 2) add({ kind: "polygon", points: pts, closed: sub.closed && pts.length >= 3 }, { ...pen, ...noFill });
      }
    };
    if (!path.fill) {
      strokes();
      continue;
    }
    const rings = path.subpaths.map((sub) => tidy(sub.points.map(world), true)).filter((r) => r.length >= 3);
    const polys = fillShapes(rings);
    // a pen would draw the cuts that join a hole to its outline, so holed fills take their outlines apart
    const holed = path.stroke !== null && polys.some((p) => p.holes);
    for (const p of polys) add({ kind: "polygon", points: p.points, closed: true }, holed ? { ...noPen, ...fill } : { ...pen, ...fill });
    if (holed) strokes();
  }

  if (s.canAdd("text")) {
    for (const t of page.texts) {
      const text = t.text.trim();
      if (!text) continue;
      const lead = t.text.length - t.text.trimStart().length;
      // leading spaces move the start along the baseline
      const shift = lead * 0.25 * t.size;
      const u = { x: Math.cos((t.angle * Math.PI) / 180), y: Math.sin((t.angle * Math.PI) / 180) };
      add(
        { kind: "text", at: world({ x: t.at.x + u.x * shift, y: t.at.y + u.y * shift }), text, height: t.size * k, hAlign: 1, vAlign: 2, angle: Math.round(t.angle * 100) / 100 },
        { penFore: colour(t.color), penOpacity: 100, ...noFill },
      );
    }
  }

  const skipped: Record<string, number> = { ...page.skipped };
  if (shapes.length === 0) return { count: 0, skipped };
  if (shapes.length > MAX_OBJECTS) throw new Error(`the page would make ${shapes.length.toLocaleString("en")} objects (at most ${MAX_OBJECTS.toLocaleString("en")})`);
  s.batch(() => s.addObjects(layerId, shapes, noneClass(s), attrs));
  return { count: shapes.length, skipped };
}

/** Places a mesh model on `layerId` as meshImport.ts does, in one model; returns the counts and what was left out. */
export function placeMesh(
  s: EditSession,
  layerId: string,
  model: MeshFile,
  settings: { mm: number; yUp: boolean },
  base: string,
  named: boolean,
): { count: number; meshes: number; faces: number; symbols: number; instances: number; flat: number; skipped: Record<string, number> } {
  const skipped: Record<string, number> = { ...model.skipped };
  if (model.textures?.length) skipped["texture (kept as colour)"] = model.textures.length;
  const none = requireNone(s);
  const scale = layerScaleOf(s, layerId);
  return s.batch(() => {
    const built = model.tree ? treeModel(s, model, model.tree, named, none, scale) : flatModel(s, model, settings, named, none, scale);
    if (!built) return { count: 0, meshes: 0, faces: 0, symbols: 0, instances: 0, flat: 0, skipped };
    const made = s.addMeshModel(layerId, built.model, none);
    nameGroup(s, made.id, base);
    // 2D objects the drawing has no template for are left out, as the editor counts them
    if (built.twoD > made.flat) skipped["2D object"] = (skipped["2D object"] ?? 0) + built.twoD - made.flat;
    return {
      count: made.meshes + made.lines + made.loci + made.flat + made.instances,
      meshes: made.meshes,
      faces: built.faces,
      symbols: made.symbols.length,
      instances: made.instances,
      flat: made.flat,
      skipped,
    };
  });
}

/** The class a model's parts go in when they have none of their own: the None class, or a refusal when the drawing has none. */
function requireNone(s: EditSession): number {
  const none = noneClass(s);
  if (none === undefined) throw new Error("the drawing has no None class to hold its objects");
  return none;
}

/** The layer's scale, which sizes the text a file gives in points; 1 when the layer isn't there. */
function layerScaleOf(s: EditSession, layerId: string): number {
  return s.doc.layers().find((l) => l.id === layerId)?.scale || 1;
}

/** A 2D object as a model's shape: a text given in points takes the layer's scale, and its colour is its pen. */
function drawnObject(sh: Drawn, scale: number, colorOf: ColorOf): { shape: NewShape; attrs: Partial<Attributes> | undefined } {
  const shape: NewShape = sh.points !== undefined && sh.shape.kind === "text" ? { ...sh.shape, height: sh.points * MM_PER_PT * scale } : sh.shape;
  return { shape, attrs: sh.color ? { penFore: colorOf(sh.color) } : undefined };
}

/** The model of a flat file: its parts and 2D objects, each group's in one node, or a top node with the groups in it. Null when there is nothing to place. */
function flatModel(s: EditSession, model: MeshFile, settings: { mm: number; yUp: boolean }, named: boolean, none: number, scale: number): { model: MeshModel; faces: number; twoD: number } | null {
  const { mm, yUp } = settings;
  // y up turns into z up: (x, y, z) to (x, −z, y)
  const parts = model.parts.map((p) =>
    p.faces.map((f) => {
      const out = new Array<number>(f.length);
      for (let i = 0; i < f.length; i += 3) {
        out[i] = f[i] * mm;
        out[i + 1] = (yUp ? -f[i + 2] : f[i + 1]) * mm;
        out[i + 2] = (yUp ? f[i + 1] : f[i + 2]) * mm;
      }
      return out;
    }),
  );
  const shapes = model.shapes ?? [];
  const faces = parts.reduce((n, p) => n + p.length, 0);
  if (faces === 0 && shapes.length === 0) return null;

  // parts and 2D objects by what holds them in the file (IFC storeys, USD prims, Rhino layers, SketchUp groups), in the file's order
  const groups = new Map<string, { parts: number[]; shapes: number[] }>();
  const groupOf = (k: string): { parts: number[]; shapes: number[] } => {
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { parts: [], shapes: [] }));
    return g;
  };
  parts.forEach((p, i) => {
    if (p.length) groupOf(model.parts[i].group ?? "").parts.push(i);
  });
  shapes.forEach((sh, i) => groupOf(sh.group ?? "").shapes.push(i));

  const tagged = model.parts.some((p) => p.tag);
  const classOf = tagClasses(s, none);
  const classes = tagged ? model.parts.map((p) => classOf(p.tag)) : undefined;
  const colorOf = exactColors(s, [...model.parts.map((p) => p.color), ...shapes.map((sh) => sh.color)]);
  const attrs = model.parts.map(attrsMaker(colorOf));
  const names = named && model.parts.length <= MAX_NAMED ? model.parts.map((p) => p.name) : undefined;
  const node = (g: { parts: number[]; shapes: number[] }): MeshNode => ({
    parts: g.parts.map((i) => parts[i]),
    attrs: g.parts.map((i) => attrs[i]),
    ...(classes ? { classes: g.parts.map((i) => classes[i]) } : {}),
    ...(names ? { names: g.parts.map((i) => names[i]) } : {}),
    shapes: g.shapes.map((i) => drawnObject(shapes[i], scale, colorOf)),
  });
  const top: MeshNode =
    groups.size >= 2
      ? { groups: [...groups].map(([name, g]): MeshGroupNode => ({ ...node(g), name })) }
      : node([...groups.values()][0]);
  return { model: { symbols: [], top }, faces, twoD: shapes.length };
}

/** A tree model (a SketchUp file's components): each container in millimetres, its tags as classes, its symbols and instances. Null when there is nothing to place. */
function treeModel(s: EditSession, model: MeshFile, tree: MeshTree, named: boolean, none: number, scale: number): { model: MeshModel; faces: number; twoD: number } | null {
  const mm = model.frame?.mm ?? 1;
  const faces = treeFaces(tree);
  const loose = treeLines(tree);
  if (faces === 0 && loose.lines === 0 && loose.points === 0 && loose.shapes === 0) return null;
  // a SketchUp part is a tag's and material's faces, not an object of the file's, so its meshes are left unnamed where the caller says
  const nameParts = named && treeNodes(tree).reduce((k, n) => k + n.parts.length, 0) <= MAX_NAMED;
  const classOf = tagClasses(s, none);
  const colorOf = exactColors(s, treeColors(tree));
  const attrsOf = attrsMaker(colorOf);
  // each container in millimetres, its tags as classes; a matrix's offset scales, its axes don't
  const node = (n: MeshTreeNode): MeshNode => ({
    parts: n.parts.map((p) => p.faces.map((f) => f.map((v) => v * mm))),
    attrs: n.parts.map((p) => attrsOf(p)),
    classes: n.parts.map((p) => classOf(p.tag)),
    ...(nameParts ? { names: n.parts.map((p) => p.name) } : {}),
    lines: (n.lines ?? []).map((q) => ({ points: q.points.map((v) => v * mm), closed: q.closed, classIndex: classOf(q.tag) })),
    loci: (n.points ?? []).map((q) => ({ at: q.at.map((v) => v * mm), classIndex: classOf(q.tag) })),
    shapes: (n.shapes ?? []).map((sh) => drawnObject(sh, scale, colorOf)),
    groups: n.groups.map((g) => ({ ...node(g), name: g.name, ...(g.tag ? { classIndex: classOf(g.tag) } : {}) })),
    instances: n.instances.map((i) => ({
      symbol: i.symbol,
      matrix: i.matrix.map((v, k) => (k >= 9 ? v * mm : v)),
      ...(i.name ? { name: i.name } : {}),
      ...(i.tag ? { classIndex: classOf(i.tag) } : {}),
    })),
  });
  const symbols = tree.symbols.map((x) => ({ name: x.name, content: node(x.content) }));
  const top = node(tree.top);
  // a tag the file hides hides the class made for it (a class the drawing had keeps its own visibility)
  for (const tag of model.hiddenTags ?? []) {
    const c = classOf.made(tag);
    if (c !== undefined) s.setClassVisibility(c, "hidden");
  }
  return { model: { symbols, top }, faces, twoD: loose.shapes };
}

/** Every container of a tree, each symbol's once. */
function treeNodes(tree: MeshTree): MeshTreeNode[] {
  const out: MeshTreeNode[] = [];
  const walk = (n: MeshTreeNode): void => {
    out.push(n);
    n.groups.forEach(walk);
  };
  tree.symbols.forEach((x) => walk(x.content));
  walk(tree.top);
  return out;
}

/** Every part's and 2D object's colour in a tree, each symbol's once. */
function treeColors(tree: MeshTree): (MeshPart["color"] | undefined)[] {
  return treeNodes(tree).flatMap((n) => [...n.parts.map((p) => p.color), ...(n.shapes ?? []).map((sh) => sh.color)]);
}

/**
 * The colour index for each of a file's colours, exactly: the drawing's colour where it has it, else
 * one added to its colour table. Called once with every colour the import uses.
 */
function exactColors(s: EditSession, colors: readonly (MeshPart["color"] | undefined)[]): ColorOf {
  const css = [...new Set(colors.flatMap((c) => (c ? [hex(c)] : [])))];
  const indices = s.addColors(css);
  return (c) => indices[css.indexOf(hex(c))];
}

/** "#rrggbb" for a file's colour (channels 0..1). */
function hex(c: { r: number; g: number; b: number }): string {
  return "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
}

/** A part's attributes: its colour as its fill, and its opacity; none for a part without a colour. */
function attrsMaker(colorOf: ColorOf): (p: MeshPart) => Partial<Attributes> | undefined {
  return (p) => {
    if (!p.color) return undefined;
    const c = colorOf(p.color);
    return { fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: Math.round(100 * (p.opacity ?? 1)) };
  };
}

/**
 * A tag's class: one of the same name, reused, otherwise made; the None class for no tag, or when the
 * name is taken by a layer, symbol or line type. `made(tag)` is the class made for a tag, if one was.
 */
function tagClasses(s: EditSession, none: number): ((tag: string | undefined) => number) & { made(tag: string): number | undefined } {
  const known = new Map<string, number>();
  const made = new Map<string, number>();
  const of = (tag: string | undefined): number => {
    if (!tag) return none;
    let index = known.get(tag) ?? s.doc.classes().find((c) => c.name.toLowerCase() === tag.toLowerCase())?.index;
    if (index === undefined) {
      try {
        index = s.createClass(tag);
        made.set(tag, index);
      } catch {
        index = none;
      }
    }
    known.set(tag, index);
    return index;
  };
  return Object.assign(of, { made: (tag: string) => made.get(tag) });
}

/** Names the group `base`, else `base 2`, `base 3`… when another object, layer or class has the name. */
function nameGroup(s: EditSession, id: string, base: string): void {
  for (let n = 1; n < 1000; n++) {
    try {
      s.setObjectName(id, n === 1 ? base : `${base} ${n}`);
      return;
    } catch {
      // taken: the next number
    }
  }
}
