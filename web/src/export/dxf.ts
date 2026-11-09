// ASCII DXF, AutoCAD R12 (AC1009) flavour. World coordinates are written unchanged (y-up), and they
// are millimetres whatever the document's units, so the file is always declared in millimetres.

import { textBaselines } from "../core/geometry.ts";
import type { BBox, LayerInfo, LineType, Pt, Shape, VwxDocument } from "../core/types.ts";
import { arcPoint, findLayer, shapeBounds, unionBounds } from "./svg.ts";

const MAX_LAYER_NAME = 31; // R12 symbol-table name limit
const MAX_TEXT = 255; // R12 limit for group 1 strings
const ELLIPSE_SEGMENTS = 64;
const MM_PER_INCH = 25.4;
const NONE_CLASS = "None"; // the class new objects take; it draws on DXF layer "0"

/**
 * The drawing as DXF text. `layersFrom` "classes" puts each object on a DXF layer named for its class
 * (the class None on "0"), so a DWG or DXF read back keeps the AutoCAD layers its classes came from;
 * the default "layers" puts each object on the DXF layer named for its layer.
 */
export function exportDxf(doc: VwxDocument, opts: { layerIds?: string[]; layersFrom?: "layers" | "classes" } = {}): string {
  const allLayers = doc.layers();
  const picked = opts.layerIds ? opts.layerIds.map((id) => findLayer(allLayers, id)) : allLayers;
  const layers = [...new Map(picked.map((l): [string, LayerInfo] => [l.id, l])).values()];
  const byClass = opts.layersFrom === "classes";

  // "0" is the DXF default layer and is reserved; names compare case-insensitively.
  const taken = new Set<string>(["0"]);
  const dxfNames = new Map<string, string>();
  if (!byClass) for (const layer of layers) dxfNames.set(layer.id, uniqueName(layer.name, taken));
  // by class: the DXF layer of each class an object is in, in the order they are first used
  const classLayers = new Map<string, { name: string; hidden: boolean }>();
  const classLayer = (className: string): string => {
    if (className === NONE_CLASS) return "0";
    let found = classLayers.get(className);
    if (!found) {
      const hidden = doc.classes().find((c) => c.name === className)?.visibility === "hidden";
      found = { name: uniqueName(className, taken), hidden };
      classLayers.set(className, found);
    }
    return found.name;
  };

  const entities = new Writer();
  const ltypes = new LineTypes(doc);
  const boxes: BBox[] = [];
  for (const layer of layers) {
    const dxfLayer = dxfNames.get(layer.id) ?? "0";
    const scale = layer.kind === "design" ? layer.scale : 1;
    for (const obj of doc.objects(layer.id)) {
      const shape = obj.shape;
      if (!shape || shape.kind === "image") continue;
      const ltype = ltypes.nameFor(obj.attrs?.lineStyle ?? 0, scale);
      if (!emit(entities, shape, byClass ? classLayer(obj.className) : dxfLayer, ltype)) continue;
      const b = shapeBounds(shape);
      if (b) boxes.push(b);
    }
  }
  const ext = unionBounds(boxes) ?? { x0: 0, y0: 0, x1: 1, y1: 1 };

  const header = new Writer()
    .pair(0, "SECTION").pair(2, "HEADER")
    .pair(9, "$ACADVER").pair(1, "AC1009")
    .pair(9, "$INSBASE").pair(10, "0").pair(20, "0").pair(30, "0")
    .pair(9, "$EXTMIN").pair(10, num(ext.x0)).pair(20, num(ext.y0)).pair(30, "0")
    .pair(9, "$EXTMAX").pair(10, num(ext.x1)).pair(20, num(ext.y1)).pair(30, "0")
    .pair(9, "$MEASUREMENT").pair(70, "1")
    .pair(9, "$INSUNITS").pair(70, "4")
    .pair(0, "ENDSEC");

  const tables = new Writer().pair(0, "SECTION").pair(2, "TABLES");
  ltypes.write(tables);
  const tableLayers: { name: string; hidden: boolean }[] = byClass
    ? [...classLayers.values()]
    : layers.map((layer) => ({ name: dxfNames.get(layer.id) ?? "0", hidden: layer.visibility === "hidden" }));
  tables
    .pair(0, "TABLE").pair(2, "LAYER").pair(70, String(tableLayers.length + 1))
    .pair(0, "LAYER").pair(2, "0").pair(70, "0").pair(62, "7").pair(6, "CONTINUOUS");
  for (const layer of tableLayers) {
    tables
      .pair(0, "LAYER")
      .pair(2, layer.name)
      .pair(70, layer.hidden ? "1" : "0") // frozen
      .pair(62, "7")
      .pair(6, "CONTINUOUS");
  }
  tables
    .pair(0, "ENDTAB")
    .pair(0, "TABLE").pair(2, "STYLE").pair(70, "1")
    .pair(0, "STYLE").pair(2, "STANDARD").pair(70, "0").pair(40, "0").pair(41, "1")
    .pair(50, "0").pair(71, "0").pair(42, "0.2").pair(3, "txt")
    .pair(0, "ENDTAB")
    .pair(0, "ENDSEC");

  const blocks = new Writer().pair(0, "SECTION").pair(2, "BLOCKS").pair(0, "ENDSEC");

  return (
    header.text() +
    tables.text() +
    blocks.text() +
    new Writer().pair(0, "SECTION").pair(2, "ENTITIES").text() +
    entities.text() +
    new Writer().pair(0, "ENDSEC").pair(0, "EOF").text()
  );
}

/** Accumulates DXF group code / value pairs. */
class Writer {
  private readonly lines: string[] = [];

  pair(code: number, value: string): this {
    this.lines.push(String(code), value);
    return this;
  }

  text(): string {
    return this.lines.length ? this.lines.join("\n") + "\n" : "";
  }
}

/**
 * LTYPE entries for the dash styles in use. R12 has no per-entity linetype
 * scale, so each style gets one entry per layer scale, with its dashes in
 * world millimetres (VW stores them in paper inches).
 */
class LineTypes {
  private readonly styles: Map<number, LineType>;
  private readonly defs = new Map<string, { name: string; label: string; dashes: number[] }>();
  private readonly taken = new Set<string>(["continuous", "bylayer", "byblock"]);

  constructor(doc: VwxDocument) {
    this.styles = new Map(doc.lineTypes().map((t): [number, LineType] => [t.style, t]));
  }

  /** LTYPE name for an object's line style on a layer at 1:scale; null for solid lines. */
  nameFor(lineStyle: number, scale: number): string | null {
    const t = lineStyle < 0 ? this.styles.get(lineStyle) : undefined;
    if (!t || t.dashes.length === 0) return null;
    const key = `${lineStyle}@${scale}`;
    let def = this.defs.get(key);
    if (!def) {
      def = {
        name: uniqueName(`${t.name} 1-${scale}`, this.taken),
        label: `${t.name} at 1:${scale}`,
        dashes: t.dashes.map((v) => v * MM_PER_INCH * scale),
      };
      this.defs.set(key, def);
    }
    return def.name;
  }

  write(w: Writer): void {
    w.pair(0, "TABLE").pair(2, "LTYPE").pair(70, String(this.defs.size + 1))
      .pair(0, "LTYPE").pair(2, "CONTINUOUS").pair(70, "0").pair(3, "Solid line")
      .pair(72, "65").pair(73, "0").pair(40, "0");
    for (const d of this.defs.values()) {
      const total = d.dashes.reduce((a, b) => a + b, 0);
      w.pair(0, "LTYPE").pair(2, d.name).pair(70, "0").pair(3, dxfString(d.label))
        .pair(72, "65").pair(73, String(d.dashes.length)).pair(40, num(total));
      // dashes are positive, gaps negative
      d.dashes.forEach((v, i) => w.pair(49, num(i % 2 === 0 ? v : -v)));
    }
    w.pair(0, "ENDTAB");
  }
}

/** Starts an entity: its type, layer and, for dashed objects, its line type. */
function start(w: Writer, type: string, layer: string, ltype: string | null): Writer {
  w.pair(0, type).pair(8, layer);
  if (ltype) w.pair(6, ltype);
  return w;
}

/** Writes one entity for a shape. Returns false when nothing was written. */
function emit(w: Writer, s: Shape, layer: string, ltype: string | null): boolean {
  switch (s.kind) {
    case "locus": {
      const p = s.points[0];
      if (!p) return false;
      start(w, "POINT", layer, null).pair(10, num(p.x)).pair(20, num(p.y)).pair(30, "0");
      return true;
    }
    case "line": {
      if (s.points.length < 2) return false;
      const [a, b] = s.points;
      start(w, "LINE", layer, ltype)
        .pair(10, num(a.x)).pair(20, num(a.y)).pair(30, "0")
        .pair(11, num(b.x)).pair(21, num(b.y)).pair(31, "0");
      return true;
    }
    case "rect":
    case "polygon":
    case "polyline":
      return polyline(w, s.points, s.closed, layer, ltype);
    case "arc":
      return arc(w, s, layer, ltype);
    case "text":
      return text(w, s, layer);
    default:
      return false;
  }
}

function polyline(w: Writer, pts: Pt[], closed: boolean, layer: string, ltype: string | null): boolean {
  if (pts.length < 2) return false;
  start(w, "POLYLINE", layer, ltype).pair(66, "1")
    .pair(10, "0").pair(20, "0").pair(30, "0")
    .pair(70, closed ? "1" : "0");
  for (const p of pts) {
    w.pair(0, "VERTEX").pair(8, layer).pair(10, num(p.x)).pair(20, num(p.y)).pair(30, "0");
  }
  w.pair(0, "SEQEND").pair(8, layer);
  return true;
}

function arc(w: Writer, s: Shape, layer: string, ltype: string | null): boolean {
  const c = s.center;
  if (!c || s.rx === undefined || s.ry === undefined) return false;
  const rx = Math.abs(s.rx);
  const ry = Math.abs(s.ry);
  const a0 = s.startAngle ?? 0;
  const sweep = s.sweepAngle ?? 0;
  if (sweep === 0) return false;
  const full = Math.abs(sweep) >= 360;
  const circular = Math.abs(rx - ry) <= 1e-6 * Math.max(rx, ry, 1);

  if (circular && full) {
    start(w, "CIRCLE", layer, ltype).pair(10, num(c.x)).pair(20, num(c.y)).pair(30, "0")
      .pair(40, num(rx));
    return true;
  }
  if (circular) {
    // DXF ARCs run counter-clockwise from start to end, so a negative sweep is written reversed.
    const lo = sweep > 0 ? a0 : a0 + sweep;
    const hi = lo + Math.abs(sweep);
    start(w, "ARC", layer, ltype).pair(10, num(c.x)).pair(20, num(c.y)).pair(30, "0")
      .pair(40, num(rx)).pair(50, num(normDeg(lo))).pair(51, num(normDeg(hi)));
    return true;
  }
  // Elliptical: approximate with a polyline (closed when the ellipse is complete).
  const total = full ? Math.sign(sweep) * 360 : sweep;
  const count = full ? ELLIPSE_SEGMENTS : ELLIPSE_SEGMENTS + 1;
  const pts: Pt[] = [];
  for (let i = 0; i < count; i++) {
    pts.push(arcPoint(c, rx, ry, a0 + (total * i) / ELLIPSE_SEGMENTS));
  }
  return polyline(w, pts, full, layer, ltype);
}

function text(w: Writer, s: Shape, layer: string): boolean {
  const laid = textBaselines(s);
  if (laid) {
    // R12 TEXT: height is the cap height (about 0.72 of the em); a justified
    // line is placed by its alignment point (11/21) with 72 = 1 centre, 2 right
    const just = laid.hAlign === 2 ? 1 : laid.hAlign === 3 ? 2 : 0;
    let emitted = false;
    for (const { text: raw, at } of laid.lines) {
      const value = dxfString(raw);
      if (value === "") continue;
      w.pair(0, "TEXT").pair(8, layer).pair(10, num(at.x)).pair(20, num(at.y)).pair(30, "0")
        .pair(40, num(laid.size * 0.72)).pair(1, value);
      if (laid.angle) w.pair(50, num(laid.angle));
      if (just) w.pair(72, String(just)).pair(11, num(at.x)).pair(21, num(at.y)).pair(31, "0");
      emitted = true;
    }
    return emitted;
  }
  const b = s.bbox;
  if (!b || !s.text) return false;
  const h = (b.y1 - b.y0) || 1;
  const lines = s.text.split(/\r\n|\r|\n/);
  const size = (h / Math.max(1, lines.length)) * 0.8;
  let emitted = false;
  // First line sits at the top of the box, as in svg.py; later lines step down by one size.
  for (const [i, raw] of lines.entries()) {
    const value = dxfString(raw);
    if (value === "") continue;
    w.pair(0, "TEXT").pair(8, layer).pair(10, num(b.x0)).pair(20, num(b.y1 - size * (i + 1)))
      .pair(30, "0").pair(40, num(size)).pair(1, value);
    emitted = true;
  }
  return emitted;
}

/** Layer or line type name for DXF: sanitized, capped, and unique (case-insensitively) within the file. */
function uniqueName(raw: string, taken: Set<string>): string {
  const base = raw.replace(/[^A-Za-z0-9_-]/g, "_") || "LAYER";
  let name = base.slice(0, MAX_LAYER_NAME);
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = `_${n}`;
    name = base.slice(0, MAX_LAYER_NAME - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

/** Group 1 text: no control characters or line breaks, capped at the R12 length. */
function dxfString(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, MAX_TEXT);
}

function normDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}

/** Up to 6 decimals, trailing zeros stripped. */
function num(v: number): string {
  if (!Number.isFinite(v)) return "0";
  let s = v.toFixed(6);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}
