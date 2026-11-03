// File X-ray: what takes up the space in an open drawing, and what could go. DOM-free: it reads the
// record list of a Model (core/model.ts) and returns plain data, which the dialog (dialog.ts) shows
// and check.ts prints.
//
// Every record is counted in exactly one category, so the categories add up to the record stream's
// size (the check in check.ts compares that with the decompressed stream). An item is one part of a
// category: a design layer, a symbol definition, a texture, an image, a plug-in, a record type. An
// item's bytes are the records it owns; an object's nested categories (its images, a plug-in's
// cached drawing) are counted in those categories, and `subtreeBytes` gives the whole subtree.
//
// The file on disk is compressed (Snappy blocks), so each category also gets its share of the file
// size: its record bytes times the drawing's compression ratio. That share assumes records compress
// alike, which is only an estimate.

import type { Model } from "../../core/model.ts";
import { guidOf, layerKindAt, objectChildren } from "../../core/model.ts";
import { readAttrs } from "../../core/attrs.ts";
import { u16, u32, u32be } from "../../core/bytes.ts";
import { recordFormat } from "../../core/params.ts";
import { RESOURCE_TYPES } from "../../core/resources.ts";
import { type Rec, TYPE_NAMES } from "../../core/records.ts";
import type { BBox, Shape } from "../../core/types.ts";

/** Lengths are millimetres whatever the document's units (see app/units.ts). */
const MM_PER_KM = 1e6;
/** An object this far from the drawing's centre makes Zoom to Fit zoom out to nothing useful. */
export const FAR_MM = 100 * MM_PER_KM;
export const BIG_IMAGE_PX = 2048;
export const BIG_IMAGE_BYTES = 2 * 1024 * 1024;
const CHUNK_BYTES = 1 << 20;
const TICK_MS = 0;

const TYPE = {
  terminator: 0,
  layer: 31,
  symbolDef: 16,
  instance: 15,
  texture: 97,
  image: 14,
  preview: 119,
  plugin: 86,
  data: 48,
  viewport: 122,
  folder: 92,
} as const;

/** Resource types whose records are the drawing's named library entries, by category. */
const RESOURCE_CATEGORY: ReadonlyMap<number, CategoryId> = new Map<number, CategoryId>([
  [18, "worksheet"],
  [19, "style"],
  [47, "recordFormat"],
  [66, "hatch"],
  [96, "lineType"],
  [102, "style"],
  [106, "style"],
  [107, "style"],
  [108, "tile"],
  [109, "style"],
  [115, "style"],
  [120, "gradient"],
  [127, "style"],
]);

/** Object types whose record carries an attribute block (line style at +0x50, fill pattern at +0x64, material at +0x88). */
const ATTRIBUTE_TYPES: ReadonlySet<number> = new Set([2, 3, 5, 6, 10, 13, 14, 21, 24, 25, 34, 38, 40, 41, 63, 68, 71, 84, 86, 94, 113, 114]);
/** Types whose u32 at +0x88 names their material (a material resource's name index). */
const MATERIAL_TYPES: ReadonlySet<number> = new Set([3, 5, 6, 21, 24, 25, 84, 86, 113]);
const MATERIAL_AT = 0x88;
const SYMBOL_INDEX_AT = 0x8e;

export type CategoryId =
  | "design"
  | "sheet"
  | "symbol"
  | "texture"
  | "image"
  | "viewport"
  | "plugin"
  | "data"
  | "hatch"
  | "tile"
  | "gradient"
  | "lineType"
  | "recordFormat"
  | "worksheet"
  | "style"
  | "preview"
  | "other";

/** Display order of the categories (the table and the bar sort by size). */
export const CATEGORY_ORDER: readonly CategoryId[] = [
  "design",
  "sheet",
  "symbol",
  "texture",
  "image",
  "viewport",
  "plugin",
  "data",
  "hatch",
  "tile",
  "gradient",
  "lineType",
  "recordFormat",
  "worksheet",
  "style",
  "preview",
  "other",
];

export const CATEGORY_LABEL: Readonly<Record<CategoryId, string>> = {
  design: "Design layers",
  sheet: "Sheet layers",
  symbol: "Symbol definitions",
  texture: "Textures",
  image: "Images and bitmaps",
  viewport: "Viewport drawings",
  plugin: "Plug-in objects (cached geometry)",
  data: "Object data records",
  hatch: "Hatches",
  tile: "Tile fills",
  gradient: "Gradients",
  lineType: "Line types",
  recordFormat: "Record formats",
  worksheet: "Worksheets",
  style: "Styles and materials",
  preview: "Previews (thumbnails)",
  other: "Other records",
};

const C = Object.fromEntries(CATEGORY_ORDER.map((c, i) => [c, i])) as Record<CategoryId, number>;
/** Categories whose records are split into items (the others are one bucket). */
const ITEMISED: ReadonlySet<CategoryId> = new Set<CategoryId>([
  "design",
  "sheet",
  "symbol",
  "texture",
  "image",
  "viewport",
  "plugin",
  "hatch",
  "tile",
  "gradient",
  "lineType",
  "recordFormat",
  "worksheet",
  "style",
  "other",
]);

export interface ImageInfo {
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  /** bytes of the picture stream (PNG or JPEG) */
  readonly bytes: number;
}

/** One part of a category: a layer, symbol definition, texture, image, plug-in, record type ... */
export interface XrayItem {
  /** stable within one analysis */
  readonly key: string;
  readonly label: string;
  /** what `count` counts: objects, instances, viewports, plug-in objects or records */
  readonly unit: string;
  readonly count: number;
  /** record bytes the item owns: nested categories (images, plug-in drawings) are not in it */
  readonly bytes: number;
  /** record bytes of its whole subtree, nested categories included (a single record's subtree) */
  readonly subtreeBytes: number;
  /** records the item owns */
  readonly records: number;
  /** estimated share of the file size */
  readonly share: number;
  /** symbol definitions and resources: their folder path in the library, "" at the top */
  readonly folder: string;
  readonly image: ImageInfo | null;
}

export interface XrayCategory {
  readonly id: CategoryId;
  readonly label: string;
  /** records in the category, the total that the categories add up to */
  readonly records: number;
  /** record bytes in the category */
  readonly bytes: number;
  /** estimated share of the file size */
  readonly share: number;
  /** sorted by bytes, largest first */
  readonly items: readonly XrayItem[];
}

export interface XrayTarget {
  /** a top-level object's id (on a layer) */
  readonly id: string;
  readonly layerId: string;
  /** its bounds in drawing coordinates, when known (Select zooms to the union) */
  readonly box?: BBox;
}

export interface XrayFindingRow {
  readonly label: string;
  readonly detail: string;
  readonly bytes: number;
  readonly target?: XrayTarget;
}

export type FindingId = "stray" | "duplicates" | "empty-layers" | "unused-symbols" | "unused-resources" | "large-images";

export interface XrayFinding {
  readonly id: FindingId;
  readonly title: string;
  readonly summary: string;
  /** every row found (the dialog shows the first few) */
  readonly rows: readonly XrayFindingRow[];
  /** top-level objects Select and Delete act on */
  readonly targets: readonly XrayTarget[];
  /** empty layers (Select and Delete Empty Layers act on these) */
  readonly layerIds: readonly string[];
  /** record bytes the finding accounts for */
  readonly bytes: number;
}

export interface XrayReport {
  readonly fileBytes: number;
  readonly recordBytes: number;
  readonly recordCount: number;
  /** settings block and file header, before the Snappy chunks */
  readonly headerBytes: number;
  /** the 4-byte size prefix of each Snappy chunk */
  readonly framingBytes: number;
  /** bytes of the Snappy blocks on disk (the records, compressed) */
  readonly compressedBytes: number;
  /** compressed bytes per record byte (below 1 when the file is smaller than its records) */
  readonly ratio: number;
  /** share of the file that is header and chunk framing */
  readonly overheadShare: number;
  readonly units: string;
  /** largest first */
  readonly categories: readonly XrayCategory[];
  readonly findings: readonly XrayFinding[];
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, TICK_MS));

interface Item {
  cat: number;
  key: string;
  label: string;
  unit: string;
  /** record index of the item's root, or -1 when it spans many records */
  root: number;
  id: string;
  count: number;
  records: number;
  bytes: number;
  folder: string;
  res: number;
  resType: number;
  image: ImageInfo | null;
}

/** Stream bytes and pixel size of the first PNG or JPEG in `d`, or null. */
function streamOf(d: Uint8Array): { at: number; png: boolean } | null {
  for (let i = 0; i + 3 < d.length; i++) {
    if (d[i] !== 0x89 && d[i] !== 0xff) continue;
    if (d[i] === 0x89 && d[i + 1] === 0x50 && d[i + 2] === 0x4e && d[i + 3] === 0x47) return { at: i, png: true };
    if (d[i] === 0xff && d[i + 1] === 0xd8 && d[i + 2] === 0xff) return { at: i, png: false };
  }
  return null;
}

function be16(d: Uint8Array, at: number): number {
  return (d[at] << 8) | d[at + 1];
}

function be32(d: Uint8Array, at: number): number {
  return d[at] * 0x1000000 + (d[at + 1] << 16) + (d[at + 2] << 8) + d[at + 3];
}

/** Pixel size of the picture starting at `at`: PNG's IHDR, or the JPEG frame header. */
function pixelsAt(d: Uint8Array, at: number, png: boolean): { width: number; height: number } {
  if (png) {
    if (at + 24 > d.length) return { width: 0, height: 0 };
    return { width: be32(d, at + 16), height: be32(d, at + 20) };
  }
  let i = at + 2;
  for (let seg = 0; seg < 10000 && i + 4 <= d.length; seg++) {
    if (d[i] !== 0xff) break;
    const m = d[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > d.length) break;
      return { height: be16(d, i + 5), width: be16(d, i + 7) };
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    i += 2 + be16(d, i + 2);
  }
  return { width: 0, height: 0 };
}

/** The picture a record holds (its stream from the first PNG or JPEG signature), with its size. */
function imageIn(d: Uint8Array): ImageInfo | null {
  const s = streamOf(d);
  if (!s) return null;
  const { width, height } = pixelsAt(d, s.at, s.png);
  return { width, height, mime: s.png ? "image/png" : "image/jpeg", bytes: d.length - s.at };
}

/** Geometry as a string: two objects with equal keys are drawn on top of each other. */
function geometryKey(s: Shape): string {
  const q = (v: number): number => Math.round(v * 1000) / 1000;
  const parts: (string | number)[] = [s.kind, s.closed ? 1 : 0];
  for (const p of s.points) parts.push(q(p.x), q(p.y));
  if (s.center) parts.push("c", q(s.center.x), q(s.center.y));
  if (s.rx !== undefined) parts.push("r", q(s.rx), q(s.ry ?? s.rx), s.startAngle ?? 0, s.sweepAngle ?? 0);
  if (s.text !== undefined) parts.push("t", s.text, s.textSize ?? 0, s.textAngle ?? 0);
  if (s.anchor) parts.push("a", q(s.anchor.x), q(s.anchor.y));
  return JSON.stringify(parts);
}

function unionBox(a: BBox | undefined, b: BBox): BBox {
  if (!a) return { ...b };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function finiteBox(b: BBox | null | undefined): b is BBox {
  return !!b && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  values.sort((x, y) => x - y);
  return values[values.length >> 1];
}

function fmtKm(mm: number): string {
  const km = mm / MM_PER_KM;
  return km >= 100 ? `${Math.round(km).toLocaleString("en-US")} km` : `${km.toFixed(1)} km`;
}

/**
 * Analyses an open drawing. `file` is the file's bytes (the header and Snappy chunks are then read
 * exactly) or its size on disk (the chunk count is then estimated from the records). `onPhase` is
 * told each step's name before it runs, and the analysis yields between steps so the page stays
 * responsive.
 */
export async function analyse(doc: Model, file: Uint8Array | number, onPhase?: (label: string) => void): Promise<XrayReport> {
  const recs = doc.recs;
  const n = recs.length;
  const phase = async (label: string): Promise<void> => {
    onPhase?.(label);
    await tick();
  };

  await phase("Reading the records");
  const size = new Float64Array(n);
  const cat = new Uint8Array(n);
  const item = new Int32Array(n).fill(-1);
  const layerOf = new Int32Array(n).fill(-1);
  const catBytes = new Float64Array(CATEGORY_ORDER.length);
  const catRecords = new Float64Array(CATEGORY_ORDER.length);
  const items: Item[] = [];
  const byKey = new Map<string, number>();
  const instances = new Map<number, number>();

  const open = (c: CategoryId, key: string, label: string, unit: string, root: number, extra: Partial<Item> = {}): number => {
    const found = byKey.get(key);
    if (found !== undefined) return found;
    items.push({ cat: C[c], key, label, unit, root, id: "", count: 0, records: 0, bytes: 0, folder: "", res: 0, resType: 0, image: null, ...extra });
    byKey.set(key, items.length - 1);
    return items.length - 1;
  };
  const nameOf = (index: number): string | undefined => doc.names.get(index) || undefined;
  const folderOf = (r: Rec): string => {
    const parts: string[] = [];
    for (let p = r.parent; p; p = p.parent) if (p.type === TYPE.folder) parts.unshift(nameOf(p.nameIndex) ?? "");
    return parts.filter(Boolean).join("/");
  };
  const typeLabel = (t: number): string => `${TYPE_NAMES[t] ?? `type ${t}`} (${t})`;
  const kindWord = (c: number): string => {
    const name = CATEGORY_ORDER[c];
    if (name === "design") return "layer";
    if (name === "sheet") return "sheet";
    if (name === "symbol") return "symbol";
    if (name === "plugin") return "plug-in";
    if (name === "viewport") return "viewport";
    return "";
  };

  // ---- 1. one pass down the record list: every record gets a category and an item ---------------
  // Pre-order: a parent comes before its children, so each record inherits from one already decided.
  for (let i = 0; i < n; i++) {
    const r = recs[i];
    const p = r.parent;
    const t = r.type;
    let c = p ? cat[p.index] : -1;
    let it = p ? item[p.index] : -1;
    // only a root-level layer record is a layer (the editor's list); a layer copy inside a viewport is part of it
    const isLayer = t === TYPE.layer && p === null;
    layerOf[i] = isLayer ? i : p ? layerOf[p.index] : -1;
    // everything in a texture (its shaders, their pictures) belongs to the texture, so it keeps what it inherited
    const inTexture = !!p && cat[p.index] === C.texture;
    if (!inTexture) {
      switch (t) {
        case TYPE.layer: {
          if (!isLayer) break;
          const sheet = r.data[layerKindAt(r.data)] === 2;
          c = sheet ? C.sheet : C.design;
          const id = guidOf(r);
          it = open(sheet ? "sheet" : "design", `layer:${id}`, doc.layerName(r) || "(unnamed layer)", "objects", i, { id });
          break;
        }
        case TYPE.symbolDef:
          c = C.symbol;
          it = open("symbol", `sym:${r.nameIndex || `#${i}`}`, nameOf(r.nameIndex) ?? "(unnamed symbol)", "instances", i, {
            res: r.nameIndex,
            folder: folderOf(r),
          });
          break;
        case TYPE.texture:
          c = C.texture;
          it = open("texture", `tex:${r.nameIndex || `#${i}`}`, nameOf(r.nameIndex) ?? "(unnamed texture)", "records", i, {
            res: r.nameIndex,
            folder: folderOf(r),
          });
          break;
        case TYPE.image:
          // a texture's picture is part of the texture, which is listed with it
          if (c !== C.texture) {
            const ctx = p && it >= 0 ? items[it] : null;
            const word = p ? kindWord(cat[p.index]) : "";
            const where = ctx ? ` · ${word ? `${word} ` : ""}${ctx.label}` : "";
            c = C.image;
            it = open("image", `img:${i}`, `${nameOf(r.nameIndex) ?? "Image"}${where}`, "records", i);
          }
          break;
        case TYPE.preview:
          if (c !== C.texture) {
            c = C.preview;
            it = -1;
          }
          break;
        case TYPE.plugin: {
          c = C.plugin;
          let format = -1;
          for (const ch of r.children) {
            if (ch.type === TYPE.data) {
              format = recordFormat(ch.data);
              break;
            }
          }
          const name = format >= 0 ? (nameOf(format) ?? "Plug-in") : "Plug-in";
          it = open("plugin", `plug:${name}`, name, "plug-in objects", -1);
          break;
        }
        case TYPE.data:
          c = C.data;
          it = -1;
          break;
        case TYPE.viewport:
          c = C.viewport;
          it =
            p && cat[p.index] === C.sheet && it >= 0
              ? open("viewport", `vp:${items[it].key}`, `Viewports on ${items[it].label}`, "viewports", -1)
              : open("viewport", "vp:not-on-sheet", "Viewports not on a sheet", "viewports", -1);
          break;
        default: {
          const rc = RESOURCE_CATEGORY.get(t);
          if (rc !== undefined) {
            c = C[rc];
            const kind = RESOURCE_TYPES.get(t) ?? `type ${t}`;
            it = open(rc, `res:${t}:${r.nameIndex || `#${i}`}`, nameOf(r.nameIndex) ?? `(unnamed ${kind})`, "records", i, {
              res: r.nameIndex,
              resType: t,
              folder: folderOf(r),
            });
          }
        }
      }
    }
    // anything nothing claimed (library lists, the name table, class list, aux data) is "Other", by type
    if (c < 0 || c === C.other) {
      c = C.other;
      it = open("other", `type:${t}`, typeLabel(t), "records", -1);
    }
    if (it < 0 && ITEMISED.has(CATEGORY_ORDER[c])) {
      const name = CATEGORY_ORDER[c];
      it = open(name, `${name}:misc`, "Not listed individually", "records", -1);
    }
    cat[i] = c;
    item[i] = it;
    size[i] = r.data.length;
    catBytes[c] += size[i];
    catRecords[c] += 1;
    if (it >= 0) {
      items[it].bytes += size[i];
      items[it].records += 1;
      if (t === TYPE.plugin || t === TYPE.viewport) items[it].count += 1;
    }
    if (t === TYPE.instance && r.data.length >= SYMBOL_INDEX_AT + 2) {
      const k = u16(r.data, SYMBOL_INDEX_AT);
      instances.set(k, (instances.get(k) ?? 0) + 1);
    }
  }

  // ---- 2. subtree sizes and ends (one pass up the tree), objects, and counts ----------------
  await phase("Sizing the subtrees");
  const sub = Float64Array.from(size);
  const end = new Int32Array(n);
  for (let i = 0; i < n; i++) end[i] = i;
  for (let i = n - 1; i >= 0; i--) {
    const p = recs[i].parent;
    if (!p) continue;
    sub[p.index] += sub[i];
    if (end[i] > end[p.index]) end[p.index] = end[i];
  }
  const isObject = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = recs[i];
    if (r.children.length === 0) continue;
    for (const ch of objectChildren(r)) isObject[ch.index] = 1;
  }
  // an object of a layer is one whose parent is the layer or a group on it (a plug-in's or a
  // viewport's parts and an image inside a plug-in are not the layer's own objects)
  for (let i = 0; i < n; i++) {
    if (!isObject[i]) continue;
    const L = layerOf[i];
    const p = recs[i].parent;
    if (L < 0 || !p) continue;
    const parentCat = CATEGORY_ORDER[cat[p.index]];
    if (parentCat === "design" || parentCat === "sheet") items[item[L]].count += 1;
  }
  for (const it of items) {
    if (CATEGORY_ORDER[it.cat] === "symbol") it.count = instances.get(it.res) ?? 0;
  }

  // ---- 3. references: which resources the object and class attributes name ------------------------
  await phase("Looking for resource references");
  const usedPatterns = new Set<number>();
  const usedLineTypes = new Set<number>();
  const usedMaterials = new Set<number>();
  for (let i = 0; i < n; i++) {
    const r = recs[i];
    if (!ATTRIBUTE_TYPES.has(r.type)) continue;
    const a = readAttrs(r.data);
    if (!a) continue;
    if (a.fillPattern < 0) usedPatterns.add(-a.fillPattern);
    if (a.lineStyle < 0) usedLineTypes.add(-a.lineStyle);
    if (MATERIAL_TYPES.has(r.type) && r.data.length >= MATERIAL_AT + 4) {
      const m = u32(r.data, MATERIAL_AT);
      if (m) usedMaterials.add(m);
    }
  }

  // ---- 4. pictures: images, and the picture inside each texture ----------------------------------
  await phase("Measuring images and textures");
  for (const it of items) {
    if (CATEGORY_ORDER[it.cat] === "image") {
      it.image = imageIn(recs[it.root].data);
    } else if (CATEGORY_ORDER[it.cat] === "texture") {
      let best: ImageInfo | null = null;
      for (let j = it.root; j <= end[it.root]; j++) {
        const t = recs[j].type;
        if (t !== TYPE.image && t !== TYPE.preview) continue;
        const img = imageIn(recs[j].data);
        if (img && (!best || img.bytes > best.bytes)) best = img;
      }
      it.image = best;
    }
  }

  // ---- 5. geometry: objects on the design layers ---------------------------------------------
  await phase("Reading object geometry");
  const designLayers = items.filter((it) => CATEGORY_ORDER[it.cat] === "design" && it.id);
  interface Top {
    id: string;
    layerId: string;
    kind: string;
    box: BBox | undefined;
    key: string | null;
  }
  const tops: Top[] = [];
  for (const layer of designLayers) {
    const top = new Map<string, string>();
    const boxes = new Map<string, BBox>();
    const kinds = new Map<string, Top>();
    for (const o of doc.objects(layer.id)) {
      const t = o.parentId === null ? o.id : (top.get(o.parentId) ?? o.parentId);
      top.set(o.id, t);
      const b = o.shape?.bbox;
      if (finiteBox(b)) boxes.set(t, unionBox(boxes.get(t), b));
      if (o.parentId === null) {
        const drawn = o.shape !== null && o.kind !== "group" && o.kind !== "symbol" && o.kind !== "other" && o.kind !== "image";
        const entry: Top = { id: o.id, layerId: layer.id, kind: o.kind, box: undefined, key: drawn && o.shape ? `${layer.id}\u0001${geometryKey(o.shape)}` : null };
        kinds.set(o.id, entry);
        tops.push(entry);
      }
    }
    for (const e of kinds.values()) e.box = boxes.get(e.id);
  }
  const boxById = new Map<string, BBox>();
  for (const t of tops) if (t.box) boxById.set(t.id, t.box);
  const withBox = tops.filter((t) => t.box);
  const cx = median(withBox.map((t) => (t.box!.x0 + t.box!.x1) / 2));
  const cy = median(withBox.map((t) => (t.box!.y0 + t.box!.y1) / 2));
  const layerLabel = new Map<string, string>(items.filter((it) => it.id).map((it) => [it.id, it.label] as const));
  const layerName = (id: string): string => layerLabel.get(id) ?? "(layer)";
  const bytesOf = (id: string): number => {
    const r = doc.rec(id);
    return r ? sub[r.index] : 0;
  };
  const topOfLayerRec = (r: Rec): XrayTarget | null => {
    let child = r;
    let p = r.parent;
    // stop at a root-level layer only: a layer copy inside a viewport is part of the viewport
    while (p && !(p.type === TYPE.layer && p.parent === null)) {
      child = p;
      p = p.parent;
    }
    if (!p) return null;
    const id = guidOf(child);
    const box = boxById.get(id);
    return { id, layerId: guidOf(p), ...(box ? { box } : {}) };
  };

  // ---- 6. findings ---------------------------------------------------------------------------
  await phase("Checking for problems");
  const findings: XrayFinding[] = [];

  const strays = withBox.filter((t) => Math.hypot((t.box!.x0 + t.box!.x1) / 2 - cx, (t.box!.y0 + t.box!.y1) / 2 - cy) > FAR_MM);
  if (strays.length) {
    const rows = strays
      .map((t) => {
        const d = Math.hypot((t.box!.x0 + t.box!.x1) / 2 - cx, (t.box!.y0 + t.box!.y1) / 2 - cy);
        return { label: `${t.kind} on ${layerName(t.layerId)}`, detail: `${fmtKm(d)} from the drawing's centre`, bytes: bytesOf(t.id), target: { id: t.id, layerId: t.layerId, box: t.box } };
      })
      .sort((a, b) => b.bytes - a.bytes);
    findings.push({
      id: "stray",
      title: "Objects far from the drawing",
      summary: `${strays.length} ${plural(strays.length, "object")} more than 100 km from the drawing's centre. Zoom to Fit zooms out to them.`,
      rows,
      targets: rows.map((r) => r.target!),
      layerIds: [],
      bytes: rows.reduce((s, r) => s + r.bytes, 0),
    });
  }

  const groups = new Map<string, Top[]>();
  for (const t of tops) {
    if (!t.key) continue;
    const g = groups.get(t.key);
    if (g) g.push(t);
    else groups.set(t.key, [t]);
  }
  const copies: Top[][] = [...groups.values()].filter((g) => g.length > 1);
  if (copies.length) {
    const rows: XrayFindingRow[] = [];
    const targets: XrayTarget[] = [];
    for (const g of copies) {
      // the first (lowest in the stream, drawn first) stays; the rest are the copies
      const extra = g.slice(1);
      const bytes = extra.reduce((s, t) => s + bytesOf(t.id), 0);
      rows.push({
        label: `${g.length} copies of a ${g[0].kind} on ${layerName(g[0].layerId)}`,
        detail: `${extra.length} stacked exactly on top of the first`,
        bytes,
        target: { id: g[1].id, layerId: g[1].layerId, box: g[1].box },
      });
      for (const t of extra) targets.push({ id: t.id, layerId: t.layerId, box: t.box });
    }
    rows.sort((a, b) => b.bytes - a.bytes);
    findings.push({
      id: "duplicates",
      title: "Duplicate objects",
      summary: `${targets.length} ${plural(targets.length, "object")} lie exactly on top of another with the same geometry, in ${copies.length} ${plural(copies.length, "place", "places")}.`,
      rows,
      targets,
      layerIds: [],
      bytes: rows.reduce((s, r) => s + r.bytes, 0),
    });
  }

  const empty = items.filter((it) => (CATEGORY_ORDER[it.cat] === "design" || CATEGORY_ORDER[it.cat] === "sheet") && it.count === 0 && it.id);
  if (empty.length) {
    findings.push({
      id: "empty-layers",
      title: "Empty layers",
      summary: `${empty.length} ${plural(empty.length, "layer")} with no objects.`,
      rows: empty.map((it) => ({ label: it.label, detail: CATEGORY_ORDER[it.cat] === "sheet" ? "sheet" : "design layer", bytes: 0 })),
      targets: [],
      layerIds: empty.map((it) => it.id),
      bytes: 0,
    });
  }

  const unusedSymbols = items.filter((it) => CATEGORY_ORDER[it.cat] === "symbol" && it.count === 0);
  if (unusedSymbols.length) {
    const rows = unusedSymbols
      .map((it) => ({ label: it.label, detail: it.folder ? `in ${it.folder}` : "top level of the library", bytes: sub[it.root] }))
      .sort((a, b) => b.bytes - a.bytes);
    findings.push({
      id: "unused-symbols",
      title: "Unused symbol definitions",
      summary: `${unusedSymbols.length} ${plural(unusedSymbols.length, "symbol definition")} with no instance in the drawing. Rodeo cannot delete symbol definitions yet, so these are listed for Vectorworks' Purge.`,
      rows,
      targets: [],
      layerIds: [],
      bytes: rows.reduce((s, r) => s + r.bytes, 0),
    });
  }

  const unusedRes = items.filter((it) => {
    const c = CATEGORY_ORDER[it.cat];
    if (c === "hatch" || c === "tile" || c === "gradient") return !usedPatterns.has(it.res);
    if (c === "lineType") return !usedLineTypes.has(it.res);
    if (c === "style" && it.resType === 19) return !usedMaterials.has(it.res);
    return false;
  });
  if (unusedRes.length) {
    const rows = unusedRes
      .map((it) => ({ label: it.label, detail: `${RESOURCE_TYPES.get(it.resType) ?? "resource"}${it.folder ? ` in ${it.folder}` : ""}`, bytes: sub[it.root] }))
      .sort((a, b) => b.bytes - a.bytes);
    findings.push({
      id: "unused-resources",
      title: "Unused resources",
      summary: `${unusedRes.length} ${plural(unusedRes.length, "resource")} that no object or class attribute names (hatches, tiles, gradients, line types, materials). Wall and slab styles are not searched, so check before deleting.`,
      rows,
      targets: [],
      layerIds: [],
      bytes: rows.reduce((s, r) => s + r.bytes, 0),
    });
  }

  const bigImages = items.filter((it) => {
    const img = it.image;
    return !!img && (img.width > BIG_IMAGE_PX || img.height > BIG_IMAGE_PX || img.bytes > BIG_IMAGE_BYTES);
  });
  if (bigImages.length) {
    const rows: XrayFindingRow[] = bigImages
      .map((it) => {
        const img = it.image!;
        const px = img.width && img.height ? `${img.width} × ${img.height} px` : "size unknown";
        const target = CATEGORY_ORDER[it.cat] === "image" ? topOfLayerRec(recs[it.root]) : null;
        return { label: it.label, detail: `${px}, ${mb(img.bytes)}`, bytes: img.bytes, ...(target ? { target } : {}) };
      })
      .sort((a, b) => b.bytes - a.bytes);
    findings.push({
      id: "large-images",
      title: "Large images",
      summary: `${bigImages.length} ${plural(bigImages.length, "image")} over ${BIG_IMAGE_PX} px or 2 MB. Scaling them down before insertion saves most of their size.`,
      rows,
      targets: rows.flatMap((r) => (r.target ? [r.target] : [])),
      layerIds: [],
      bytes: rows.reduce((s, r) => s + r.bytes, 0),
    });
  }

  // ---- 7. the report ------------------------------------------------------------------------
  await phase("Building the report");
  const recordBytes = catBytes.reduce((s, b) => s + b, 0);
  const headerBytes = doc.header.length;
  const chunks = typeof file === "number" ? Math.ceil(recordBytes / CHUNK_BYTES) : chunkCount(file);
  const fileBytes = typeof file === "number" ? file : file.length;
  const framingBytes = 4 * chunks;
  const compressedBytes = Math.max(0, fileBytes - headerBytes - framingBytes);
  const ratio = recordBytes > 0 ? compressedBytes / recordBytes : 0;
  const share = (bytes: number): number => (fileBytes > 0 ? (bytes * ratio) / fileBytes : 0);

  const categories: XrayCategory[] = [];
  for (let c = 0; c < CATEGORY_ORDER.length; c++) {
    if (catRecords[c] === 0) continue;
    const id = CATEGORY_ORDER[c];
    const its = items
      .filter((it) => it.cat === c)
      .sort((a, b) => b.bytes - a.bytes || a.label.localeCompare(b.label))
      .map(
        (it): XrayItem => ({
          key: it.key,
          label: it.label,
          unit: it.unit,
          count: it.unit === "records" ? it.records : it.count,
          bytes: it.bytes,
          subtreeBytes: it.root >= 0 ? sub[it.root] : it.bytes,
          records: it.records,
          share: share(it.bytes),
          folder: it.folder,
          image: it.image,
        }),
      );
    categories.push({ id, label: CATEGORY_LABEL[id], records: catRecords[c], bytes: catBytes[c], share: share(catBytes[c]), items: its });
  }
  categories.sort((a, b) => b.bytes - a.bytes);

  return {
    fileBytes,
    recordBytes,
    recordCount: n,
    headerBytes,
    framingBytes,
    compressedBytes,
    ratio,
    overheadShare: fileBytes > 0 ? (headerBytes + framingBytes) / fileBytes : 0,
    units: doc.info.units,
    categories,
    findings,
  };
}

/** Number of Snappy chunks in the file, from their size prefixes (no decompression). */
function chunkCount(file: Uint8Array): number {
  let pos = u32be(file, 8) + u32be(file, 0);
  let chunks = 0;
  while (pos + 4 <= file.length) {
    pos += 4 + u32(file, pos);
    chunks++;
  }
  return chunks;
}

function plural(n: number, word: string, many = `${word}s`): string {
  return n === 1 ? word : many;
}

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 2 : 1)} MB`;
}
