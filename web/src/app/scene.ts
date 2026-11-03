// Document-derived caches: layer and class lists, per-layer object indexes,
// top-level containers, shape geometry and decoded images. Everything derived
// from the document is dropped on each change event and rebuilt lazily, except
// what is derived from one layer's objects: the document hands back the same
// list for a layer an edit left alone, and that keeps them.
// Geometry and bitmaps are keyed by object id but validated by Shape identity,
// so a stale entry can never be drawn after the core replaces a shape.

import type {
  BBox,
  ChangeEvent,
  ClassInfo,
  GradientStop,
  HatchFill,
  LayerInfo,
  ObjectInfo,
  Shape,
  StyleOverride,
  TileFill,
  ViewportView,
  Visibility,
  VwxDocument,
} from "../core/index.ts";
import { imageBytes, withContainers } from "../core/index.ts";
import { unionBBox } from "./geom.ts";
import { graysOthers, snapsToOthers, store } from "./state.ts";
import { hiddenObjects } from "./hiddenObjects.ts";
import { buildGeom, type Geom } from "./shapes.ts";

/** Vectorworks' object types: a wall, and the plug-in objects and symbols set in one */
const WALL_TYPE = 68;
const PLUGIN_TYPE = 86;
const SYMBOL_TYPE = 15;

export interface LayerIndex {
  /** every object of the layer in draw order (groups expanded, containers included) */
  readonly objects: readonly ObjectInfo[];
  /** direct children of each container, restricted to this layer */
  readonly children: ReadonlyMap<string, readonly ObjectInfo[]>;
}

export interface CullIndex {
  /** drawable objects of the layer that have bounds, in draw order */
  readonly objects: readonly ObjectInfo[];
  /** their bounds, four numbers per object: x0, y0, x1, y1 (world mm) */
  readonly boxes: Float64Array;
}

export interface TopEntry {
  readonly id: string;
  /** bounds of the object and everything inside it */
  readonly bbox: BBox | null;
  /** can be selected now: its class is pickable (a live read, see topLevelEntries) */
  readonly visible: boolean;
}

export interface Selected {
  /** a drawable object (shape != null) */
  readonly obj: ObjectInfo;
  /** the top-level id it belongs to */
  readonly top: string;
}

interface ImageEntry {
  readonly source: Shape;
  bitmap: ImageBitmap | null;
}

/** What a fill resource holds: a fill pattern selects one resource, which holds one of these kinds. */
interface FillResource {
  readonly hatch?: HatchFill;
  readonly tile?: TileFill;
  readonly gradient?: readonly GradientStop[];
}

const DEFAULT_PEN = "#1d1d1f";
const GHOST_OPACITY = 0.3;
const MM_PER_INCH = 25.4;

/**
 * Ids containing "/" are geometry expanded from a symbol instance. They are
 * read-only and belong to their parent, so they are never edited or selected
 * directly; scene.topOf() maps them to the instance.
 */
export function isDerivedId(id: string): boolean {
  return id.includes("/");
}

/**
 * Where list `b` differs from list `a`, by identity: a[start] up to a[endA] became b[start] up to
 * b[endB], and the objects before and after are the same ones.
 */
export function listChange<T>(a: readonly T[], b: readonly T[]): { start: number; endA: number; endB: number } {
  const n = Math.min(a.length, b.length);
  let start = 0;
  while (start < n && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { start, endA, endB };
}

export class Scene {
  private doc: VwxDocument | null = null;
  private layerList: readonly LayerInfo[] | null = null;
  private classList: readonly ClassInfo[] | null = null;
  private classVis = new Map<number, Visibility>();
  /** by layer id, while the layer's objects are the ones they were made from */
  private readonly indexes = new Map<string, LayerIndex>();
  private readonly culls = new Map<string, { readonly from: readonly ObjectInfo[]; readonly cull: CullIndex }>();
  private readonly tops = new Map<string, string>();
  private readonly topEntryCache = new Map<string, { readonly from: readonly ObjectInfo[]; readonly entries: readonly TopEntry[] }>();
  private readonly geoms = new Map<string, Geom>();
  /** world-unit dash arrays keyed by "style@layerScale"; null = draw solid */
  private readonly dashes = new Map<string, readonly number[] | null>();
  private readonly images = new Map<string, ImageEntry>();
  /** fill resources (hatches, tiles, gradients) by name index, read when first drawn */
  private fills: Map<number, FillResource> | null = null;
  private rev = 0;

  get document(): VwxDocument | null {
    return this.doc;
  }

  /** Counts the changes to what is drawn: the document, its derived indexes and its decoded images. */
  get revision(): number {
    return this.rev;
  }

  setDocument(doc: VwxDocument | null): void {
    this.doc = doc;
    this.fills = null;
    this.geoms.clear();
    this.releaseImages();
    this.clearDerived();
    this.indexes.clear();
    this.culls.clear();
    this.topEntryCache.clear();
  }

  invalidate(e: ChangeEvent): void {
    this.clearDerived();
    if (e.kind !== "objects") this.forgetLayers();
    if (e.kind === "all" || (e.kind === "objects" && e.ids.length === 0)) {
      this.geoms.clear();
      this.releaseImages();
      // a hatch, tile or gradient may have changed
      if (e.kind === "all") this.fills = null;
    } else if (e.kind === "objects") {
      for (const id of e.ids) {
        this.geoms.delete(id);
        this.dropImage(id);
      }
    }
  }

  private clearDerived(): void {
    this.rev++;
    // counts live in LayerInfo/ClassInfo, so these refresh on every change
    this.layerList = null;
    this.classList = null;
    this.classVis.clear();
    this.tops.clear();
    this.dashes.clear();
  }

  /** Drops what was kept for layers the document no longer has. */
  private forgetLayers(): void {
    const ids = new Set(this.layers().map((l) => l.id));
    const open = store.symbolEdit?.layer.id;
    const gone = (key: string): boolean => !ids.has(key.split("|")[0]) && key.split("|")[0] !== open;
    for (const map of [this.indexes, this.culls, this.topEntryCache]) for (const key of [...map.keys()]) if (gone(key)) map.delete(key);
  }

  layers(): readonly LayerInfo[] {
    if (!this.doc) return [];
    this.layerList ??= this.doc.layers();
    return this.layerList;
  }

  layer(id: string): LayerInfo | undefined {
    const open = store.symbolEdit?.layer;
    if (open?.id === id) return open;
    return this.layers().find((l) => l.id === id);
  }

  classes(): readonly ClassInfo[] {
    if (!this.doc) return [];
    if (!this.classList) {
      this.classList = this.doc.classes();
      this.classVis = new Map(this.classList.map((c): [number, Visibility] => [c.index, c.visibility]));
    }
    return this.classList;
  }

  /** A class's own visibility as stored in the document. */
  ownClassVisibility(index: number): Visibility {
    this.classes();
    return this.classVis.get(index) ?? "visible";
  }

  /**
   * How a class is drawn right now. A class hidden on its own stays hidden. The
   * class options then hide (active-only) or gray (the gray ones) every class but
   * the active one. Reads store state each time, so no cache needs clearing.
   */
  classVisibility(index: number): Visibility {
    const own = this.ownClassVisibility(index);
    if (own === "hidden" || index === store.activeClassIndex) return own;
    if (store.classMode === "active-only") return "hidden";
    if (graysOthers(store.classMode)) return "grayed";
    return own;
  }

  isClassVisible(index: number): boolean {
    return this.classVisibility(index) !== "hidden";
  }

  /** Whether View > Hide Selected Objects (or Object Visibility) hid the object, or a container it is in. */
  isHidden(obj: ObjectInfo): boolean {
    return this.within(obj, hiddenObjects());
  }

  /** How an object is drawn: as its class is, unless a container's class hides or grays it, or it is hidden. */
  objectVisibility(obj: ObjectInfo): Visibility {
    if (this.isHidden(obj)) return "hidden";
    return withContainers(this.classVisibility(obj.classIndex), obj, (i) => this.ownClassVisibility(i));
  }

  isObjectVisible(obj: ObjectInfo): boolean {
    return this.objectVisibility(obj) !== "hidden";
  }

  /** Whether the pointer snaps to an object: it is drawn, and in the active class or the class options snap to others. */
  isObjectSnappable(obj: ObjectInfo): boolean {
    return this.isObjectVisible(obj) && (obj.classIndex === store.activeClassIndex || snapsToOthers(store.classMode));
  }

  color(index: number): string {
    return this.doc ? this.doc.color(index) : DEFAULT_PEN;
  }

  /** The name of the font a text names (Shape.fontIndex); undefined when the document does not list it. */
  fontName(index: number | undefined): string | undefined {
    return index === undefined ? undefined : this.doc?.fonts()[index];
  }

  /** The fill resource a fill pattern selects (negative: -name index), or null for other patterns. */
  private fill(fillPattern: number): FillResource | null {
    if (fillPattern >= 0 || !this.doc) return null;
    if (!this.fills) {
      this.fills = new Map();
      for (const r of this.doc.resources()) {
        if (r.hatch || r.tile || r.gradient) {
          this.fills.set(r.index, { hatch: r.hatch, tile: r.tile, gradient: r.gradient });
        }
      }
    }
    return this.fills.get(-fillPattern) ?? null;
  }

  /** Plan viewports on a sheet layer, or design-layer viewports on a design layer, which draw layers live. */
  viewports(layerId: string): readonly ViewportView[] {
    return this.doc ? this.doc.viewports(layerId) : [];
  }

  /** How data visualisations redraw a sheet's cached viewport drawings, by object id. */
  viewportStyles(layerId: string): ReadonlyMap<string, StyleOverride> | null {
    return this.doc ? this.doc.viewportStyles(layerId) : null;
  }

  /** The hatch a fill pattern selects (negative: -name index), or null when it is not a hatch. */
  hatch(fillPattern: number): HatchFill | null {
    return this.fill(fillPattern)?.hatch ?? null;
  }

  /** The motif and repeat of the tile a fill pattern selects, or null when it is not a tile. */
  tile(fillPattern: number): TileFill | null {
    return this.fill(fillPattern)?.tile ?? null;
  }

  /** Colour stops of the gradient a fill pattern selects, or null when it is not a gradient. */
  gradient(fillPattern: number): readonly GradientStop[] | null {
    return this.fill(fillPattern)?.gradient ?? null;
  }

  /**
   * Dash pattern for a line style in world units (mm) on a layer drawn at
   * 1:`layerScale`; null for solid lines and unknown styles. Line types store
   * their dashes in paper inches.
   */
  dashPattern(lineStyle: number, layerScale: number): readonly number[] | null {
    if (lineStyle >= 0 || !this.doc) return null;
    const key = `${lineStyle}@${layerScale}`;
    let d = this.dashes.get(key);
    if (d === undefined) {
      const lt = this.doc.lineTypes().find((t) => t.style === lineStyle);
      d = lt && lt.dashes.length > 0 ? lt.dashes.map((v) => v * MM_PER_INCH * layerScale) : null;
      this.dashes.set(key, d);
    }
    return d;
  }

  /**
   * Layers drawn on the canvas, in layers() order. Layer options "active-only"
   * draws just the active layer. Otherwise a sheet layer (or a symbol being edited) is
   * drawn alone, and a design layer draws every design layer that is not hidden, plus
   * the active one.
   */
  drawnLayers(activeId: string | null): LayerInfo[] {
    const active = activeId ? this.layer(activeId) : undefined;
    if (!active) return [];
    // a symbol being edited is drawn alone
    if (active === store.symbolEdit?.layer || active.kind === "sheet" || store.layerMode === "active-only") return [active];
    return this.layers().filter(
      (l) => l.kind === "design" && (l.id === active.id || l.visibility !== "hidden"),
    );
  }

  /**
   * Opacity a drawn layer is rendered with. The gray layer options ghost
   * every layer but the active one; otherwise grayed layers that are not active
   * are ghosted.
   */
  layerOpacity(layer: LayerInfo, activeId: string | null): number {
    if (layer.id === activeId) return 1;
    if (graysOthers(store.layerMode)) return GHOST_OPACITY;
    return layer.visibility === "grayed" ? GHOST_OPACITY : 1;
  }

  /**
   * Layers a click can select objects on: the active layer first, then the
   * other drawn, visible layers from the top of the stack down. Only the
   * "modify-others" layer option makes the other layers selectable.
   */
  pickableLayers(activeId: string | null): string[] {
    if (!activeId) return [];
    if (store.layerMode !== "modify-others") return [activeId];
    const others = this.drawnLayers(activeId)
      .filter((l) => l.id !== activeId && l.visibility === "visible")
      .map((l) => l.id)
      .reverse();
    return [activeId, ...others];
  }

  /** Layers whose objects the cursor snaps to: the drawn ones under the layer options with Snap in them, else the active one. */
  snappableLayers(activeId: string | null): LayerInfo[] {
    if (snapsToOthers(store.layerMode)) return this.drawnLayers(activeId);
    const active = activeId ? this.layer(activeId) : undefined;
    return active ? [active] : [];
  }

  /**
   * Whether objects of a class can be selected: the class is drawn, and either
   * the class options allow editing other classes or this is the active class.
   */
  isClassPickable(index: number): boolean {
    if (!this.isClassVisible(index)) return false;
    return store.classMode === "modify-others" || index === store.activeClassIndex;
  }

  /** Union of the bounds of everything drawn, or null when nothing is drawn. */
  drawnBounds(activeId: string | null): BBox | null {
    let box: BBox | null = null;
    for (const layer of this.drawnLayers(activeId)) {
      for (const obj of this.index(layer.id).objects) {
        if (!obj.shape || !this.isObjectVisible(obj)) continue;
        box = unionBBox(box, this.shownBox(obj));
      }
      // what design-layer viewports draw (a plan viewport's box is already inside its sheet's objects)
      for (const vp of this.viewports(layer.id)) if (vp.uncropped) box = unionBBox(box, vp.clip);
    }
    // a viewport's annotations being edited are drawn over its box, at its scale
    const open = store.symbolEdit;
    const vp = open?.viewport && open.layer.id === activeId ? this.doc?.viewport(open.viewport) : null;
    if (vp && open) {
      const k = open.layer.scale;
      box = unionBBox(box, { x0: vp.box.x0 * k, y0: vp.box.y0 * k, x1: vp.box.x1 * k, y1: vp.box.y1 * k });
    }
    return box;
  }

  index(layerId: string): LayerIndex {
    const objects = this.doc ? this.doc.objects(layerId) : [];
    const cached = this.indexes.get(layerId);
    if (cached?.objects === objects) return cached;
    const children = new Map<string, ObjectInfo[]>();
    for (const o of objects) {
      if (o.parentId === null) continue;
      const list = children.get(o.parentId);
      if (list) list.push(o);
      else children.set(o.parentId, [o]);
    }
    const idx: LayerIndex = { objects, children };
    this.indexes.set(layerId, idx);
    return idx;
  }

  /**
   * Drawable objects of a layer with their bounds packed into one array, so the
   * renderer can reject off-screen objects without a call per object. The bounds
   * come from the geometry cache; the index is kept while the layer's objects are the same.
   */
  cullIndex(layerId: string): CullIndex {
    const all = this.index(layerId).objects;
    const cached = this.culls.get(layerId);
    if (cached?.from === all) return cached.cull;
    const objects: ObjectInfo[] = [];
    const boxes = new Float64Array(all.length * 4);
    for (const obj of all) {
      const b = this.shownBox(obj);
      if (!b) continue;
      const k = objects.length * 4;
      boxes[k] = b.x0;
      boxes[k + 1] = b.y0;
      boxes[k + 2] = b.x1;
      boxes[k + 3] = b.y1;
      objects.push(obj);
    }
    const out: CullIndex = { objects, boxes: boxes.subarray(0, objects.length * 4) };
    this.culls.set(layerId, { from: all, cull: out });
    return out;
  }

  /** Bounds of what is drawn of `obj`: its geometry's, cropped to its viewport; null when nothing shows. */
  private shownBox(obj: ObjectInfo): BBox | null {
    const b = obj.planLines ? obj.planLines.reduce<BBox | null>((box, q) => unionBBox(box, { x0: q.x, y0: q.y, x1: q.x, y1: q.y }), null) : (this.geometry(obj)?.bbox ?? null);
    const c = obj.clip;
    if (!b || !c) return b;
    const x0 = Math.max(b.x0, c.x0);
    const y0 = Math.max(b.y0, c.y0);
    const x1 = Math.min(b.x1, c.x1);
    const y1 = Math.min(b.y1, c.y1);
    return x0 <= x1 && y0 <= y1 ? { x0, y0, x1, y1 } : null;
  }

  /** Id of the top-level object (outermost container) that `obj` belongs to. */
  topOf(obj: ObjectInfo): string {
    const memo = this.tops.get(obj.id);
    if (memo !== undefined) return memo;
    let cur = obj;
    for (let guard = 0; guard < 256; guard++) {
      const pid = cur.parentId;
      if (pid === null) break;
      const parent = this.doc?.object(pid);
      if (!parent) break;
      cur = parent;
    }
    this.tops.set(obj.id, cur.id);
    return cur.id;
  }

  /**
   * The object that is selected when `obj` is clicked while editing inside
   * group `scope` (null = the layer itself): the ancestor-or-self whose parent
   * is `scope`. Null when `obj` is not inside `scope`.
   */
  unitOf(obj: ObjectInfo, scope: string | null): string | null {
    if (scope === null) return this.topOf(obj);
    let cur = obj;
    for (let guard = 0; guard < 256; guard++) {
      if (cur.parentId === scope) return cur.id;
      const parent = cur.parentId === null ? null : this.doc?.object(cur.parentId);
      if (!parent) return null;
      cur = parent;
    }
    return null;
  }

  /**
   * What a click on `obj` selects (unitOf), but for a door, window or symbol set in a wall that
   * would be selected: that object, as Vectorworks picks a door out of its wall. The tools that
   * work on walls go on using unitOf.
   */
  pickedUnitOf(obj: ObjectInfo, scope: string | null): string | null {
    const unit = this.unitOf(obj, scope);
    if (unit === null || this.doc?.object(unit)?.type !== WALL_TYPE) return unit;
    const inner = this.unitOf(obj, unit);
    const t = inner === null ? undefined : this.doc?.object(inner)?.type;
    return t === PLUGIN_TYPE || t === SYMBOL_TYPE ? inner : unit;
  }

  /** True when `obj` or one of the containers around it is in `ids`. */
  within(obj: ObjectInfo, ids: ReadonlySet<string>): boolean {
    if (ids.size === 0) return false;
    let cur: ObjectInfo | null | undefined = obj;
    for (let guard = 0; cur && guard < 256; guard++) {
      if (ids.has(cur.id)) return true;
      cur = cur.parentId === null ? null : this.doc?.object(cur.parentId);
    }
    return false;
  }

  /**
   * Selectable objects of a layer with the bounds of their whole subtree: the
   * top-level objects, or the direct children of group `scope`.
   */
  topLevelEntries(layerId: string, scope: string | null = null): readonly TopEntry[] {
    const key = scope === null ? layerId : `${layerId}|${scope}`;
    const idx = this.index(layerId);
    const cached = this.topEntryCache.get(key);
    if (cached?.from === idx.objects) return cached.entries;
    const out: TopEntry[] = [];
    const units = scope === null ? idx.objects.filter((o) => o.parentId === null) : (idx.children.get(scope) ?? []);
    const pickable = (classIndex: number): boolean => this.isClassPickable(classIndex);
    for (const o of units) {
      const classIndex = o.classIndex;
      out.push({
        id: o.id,
        bbox: this.subtreeBBox(o, idx),
        // a getter: class options (and hiding) change pickability without rebuilding this cached list
        get visible() {
          return pickable(classIndex) && !hiddenObjects().has(o.id);
        },
      });
    }
    this.topEntryCache.set(key, { from: idx.objects, entries: out });
    return out;
  }

  private subtreeBBox(root: ObjectInfo, idx: LayerIndex): BBox | null {
    let box: BBox | null = null;
    const stack: ObjectInfo[] = [root];
    for (let o = stack.pop(); o !== undefined; o = stack.pop()) {
      // what shows: a viewport's drawing only inside its box
      if (o.shape) box = unionBBox(box, this.shownBox(o));
      // a 3D object covers its stored plan bounds, whatever plan draws of it
      if (o.bounds) box = unionBBox(box, o.bounds);
      const kids = idx.children.get(o.id);
      if (kids) stack.push(...kids);
    }
    return box;
  }

  /** Cached geometry for a drawable object; null for containers. */
  geometry(obj: ObjectInfo): Geom | null {
    const shape = obj.shape;
    if (!shape) return null;
    const cached = this.geoms.get(obj.id);
    if (cached && cached.source === shape) return cached;
    const g = buildGeom(shape);
    this.geoms.set(obj.id, g);
    return g;
  }

  /** Drawable objects belonging to the given top-level ids, descendants included. */
  expand(ids: Iterable<string>): Selected[] {
    const out: Selected[] = [];
    for (const top of ids) {
      const root = this.doc?.object(top);
      if (!root) continue;
      const idx = this.index(root.layerId);
      const stack: ObjectInfo[] = [root];
      for (let o = stack.pop(); o !== undefined; o = stack.pop()) {
        if (o.shape) out.push({ obj: o, top });
        const kids = idx.children.get(o.id);
        if (kids) stack.push(...kids);
      }
    }
    return out;
  }

  /**
   * Decoded bitmap of an image object. Returns null while decoding; `onReady`
   * is called once it is available so the caller can redraw.
   */
  bitmap(obj: ObjectInfo, shape: Shape, onReady: () => void): ImageBitmap | null {
    const entry = this.images.get(obj.id);
    if (entry && entry.source === shape) return entry.bitmap;
    entry?.bitmap?.close();
    const next: ImageEntry = { source: shape, bitmap: null };
    this.images.set(obj.id, next);
    if (!(shape.image || shape.heldImage) || !shape.imageMime) return null;
    const mime = shape.imageMime;
    // a big drawing's picture is read back from its file first (imageBytes)
    imageBytes(shape)
      .then((bytes) => {
        if (!bytes || this.images.get(obj.id) !== next) throw new Error("not wanted now");
        return createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
      })
      .then(
        (bmp) => {
          if (this.images.get(obj.id) === next) {
            next.bitmap = bmp;
            this.rev++;
            onReady();
          } else {
            bmp.close();
          }
        },
        () => {
          // undecodable or unreadable image: leave it empty until the shape changes
        },
      );
    return null;
  }

  private dropImage(id: string): void {
    this.images.get(id)?.bitmap?.close();
    this.images.delete(id);
  }

  private releaseImages(): void {
    for (const e of this.images.values()) e.bitmap?.close();
    this.images.clear();
  }
}
