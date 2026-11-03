// Store-level operations shared by tools, panels, shortcuts and the menu bar.
// Every session mutation goes through attempt(), which turns thrown errors into
// toasts. Commands act on store.selection; the ones that need the geometry of
// the selection take the scene, and the ones that need the window take the view.

import type {
  Affine,
  Arrange,
  BBox,
  ClipboardData,
  EditSession,
  LayerInfo,
  NewShape,
  Pt,
  VwxDocument,
} from "../core/index.ts";
import { clipboardHolds, expandClipboard } from "../core/index.ts";
import { copiedFrom, cutFrom } from "./copyPicture.ts";
import { degToRad, unionBBox } from "./geom.ts";
import { glide, stopGlide } from "./glide.ts";
import type { Scene } from "./scene.ts";
import { prefs } from "./prefs.ts";
import { layerInfo, setGrid, store } from "./state.ts";
import { exitSymbol } from "./symbolEdit.ts";
import { gridStep } from "./snap.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

/** Vectorworks' object types: a wall, and the plug-in objects and symbols set in one */
const WALL_TYPE = 68;
const PLUGIN_TYPE = 86;
const SYMBOL_TYPE = 15;

/** Runs a session call; on failure shows a toast and returns null. */
export function attempt<T>(label: string, fn: (s: EditSession) => T): { readonly value: T } | null {
  const s = store.session;
  if (!s) return null;
  try {
    return { value: fn(s) };
  } catch (err) {
    toast(`${label} failed: ${errorMessage(err)}`);
    return null;
  }
}

export function undo(): void {
  if (store.session?.canUndo()) attempt("Undo", (s) => s.undo());
}

export function redo(): void {
  if (store.session?.canRedo()) attempt("Redo", (s) => s.redo());
}

export function setSelection(ids: Iterable<string>): void {
  store.selection = new Set(ids);
  store.emit("selection");
}

/**
 * True when `id` is a direct child of group `scope` (or top-level when scope is null), or a door,
 * window or symbol set in a wall that is (as a click picks it out, Scene.pickedUnitOf).
 */
function inScope(doc: VwxDocument, id: string, scope: string | null): boolean {
  const o = doc.object(id);
  if (!o || o.layerId !== store.activeLayerId) return false;
  if (o.parentId === scope) return true;
  const wall = o.parentId ? doc.object(o.parentId) : null;
  return (o.type === PLUGIN_TYPE || o.type === SYMBOL_TYPE) && wall?.type === WALL_TYPE && wall.parentId === scope;
}

/**
 * Keeps only ids that still exist on the active layer, inside the group being
 * edited. Leaves the group when it is gone. Emits when something was dropped.
 */
export function pruneSelection(): void {
  const doc = store.session?.doc;
  if (!doc) {
    store.editGroupId = null;
    if (store.selection.size > 0) setSelection([]);
    return;
  }
  const g = store.editGroupId ? doc.object(store.editGroupId) : null;
  if (store.editGroupId && (!g || g.layerId !== store.activeLayerId)) store.editGroupId = null;
  const kept = [...store.selection].filter((id) => inScope(doc, id, store.editGroupId));
  if (kept.length !== store.selection.size) setSelection(kept);
}

/** Edits inside group `id` (null leaves group editing) and selects `select`. */
export function setEditGroup(id: string | null, select: Iterable<string> = []): void {
  store.editGroupId = id;
  setSelection(select);
}

/** The one selected group, which Modify > Edit Group opens; null when the selection is not one group. */
export function selectedGroup(): string | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  return doc.object(id)?.kind === "group" ? id : null;
}

/** Edits inside the selected group, with nothing selected in it. */
export function editSelectedGroup(): void {
  const id = selectedGroup();
  if (id) setEditGroup(id);
}

/** Leaves the group being edited for its parent group (or the layer) and selects it. */
export function exitEditGroup(): void {
  const doc = store.session?.doc;
  const id = store.editGroupId;
  if (!doc || !id) return;
  const parent = doc.object(id)?.parentId ?? null;
  setEditGroup(parent && doc.object(parent)?.kind === "group" ? parent : null, [id]);
}

/** Modify > Top Level: leaves every group being edited at once, the outermost one selected. */
export function exitToTopLevel(): void {
  const doc = store.session?.doc;
  let id = store.editGroupId;
  if (!doc || !id) return;
  for (let up = doc.object(id)?.parentId ?? null; up && doc.object(up)?.kind === "group"; up = doc.object(up)?.parentId ?? null) id = up;
  setEditGroup(null, [id]);
}

/** the shapes that carry line markers */
const MARKED_KINDS: ReadonlySet<NewShape["kind"]> = new Set(["line", "polygon", "polyline", "arc"]);

/**
 * Adds a shape to the active layer with the active class and selects it, drawn with the
 * attributes, markers and shadow for new objects: one undo step, which `finish` (further changes
 * to the new object) joins. When `finish` returns an id (an extrude or sweep made of the shape),
 * that object is the one selected.
 */
export function addAndSelect(shape: NewShape, classIndex?: number, finish?: (s: EditSession, id: string) => string | void): string | null {
  const layerId = store.activeLayerId;
  if (!layerId) return null;
  const cls = classIndex ?? store.activeClassIndex;
  const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const { start, end, shadow } = store.drawEffects;
  const marked = MARKED_KINDS.has(shape.kind) && (start || end);
  const r = attempt("Add object", (s) =>
    s.batch(() => {
      const id = s.addObject(layerId, shape, cls, attrs);
      if (marked) s.setLineMarkers([id], { ...(start ? { start } : {}), ...(end ? { end } : {}) });
      if (shadow) s.setDropShadow([id], shadow);
      return finish?.(s, id) ?? id;
    }),
  );
  if (!r) return null;
  // new objects go on the layer, not into the group being edited
  setEditGroup(null, [r.value]);
  return r.value;
}

/** For addAndSelect: turns a shape made in a rotated plan's coordinates into the drawing, so it lies square to the screen; undefined when the plan isn't rotated. */
export function inPlan(view: View): ((s: EditSession, id: string) => void) | undefined {
  return view.rotation === 0 ? undefined : (s, id) => s.transformObjects([id], view.planAffine());
}

export function deleteObjects(ids: string[]): void {
  if (ids.length === 0) return;
  if (attempt("Delete", (s) => s.deleteObjects(ids))) setSelection([]);
}

export function moveObjects(ids: string[], dx: number, dy: number): void {
  if (ids.length === 0 || (dx === 0 && dy === 0)) return;
  attempt("Move", (s) => s.moveObjects(ids, dx, dy));
}

export function duplicateObjects(ids: string[], step: number): void {
  if (ids.length === 0) return;
  const r = attempt("Duplicate", (s) => s.duplicateObjects(ids, step, -step));
  if (r) setSelection(r.value);
}

export function setActiveLayer(id: string): void {
  if (store.activeLayerId === id) return;
  // choosing a layer leaves the symbol being edited
  exitSymbol();
  store.activeLayerId = id;
  store.editGroupId = null;
  pruneSelection();
  store.emit("layer");
}

export function setActiveClass(index: number): void {
  if (store.activeClassIndex === index) return;
  store.activeClassIndex = index;
  store.emit("class");
}

/** The first visible design layer with objects, so a fresh document is editable. */
function defaultLayer(layers: readonly LayerInfo[]): LayerInfo | undefined {
  const design = layers.filter((l) => l.kind === "design");
  return (
    design.find((l) => l.visibility === "visible" && l.objectCount > 0) ??
    design.find((l) => l.visibility !== "hidden") ??
    design[0] ??
    layers[0]
  );
}

/**
 * Brings active layer, active class and selection back to valid values after
 * the document changed. Does not emit the session topic itself.
 */
export function reconcile(): void {
  const s = store.session;
  if (!s) {
    store.activeLayerId = null;
    store.selection = new Set<string>();
    return;
  }
  // a symbol being edited stands in for the active layer until its definition is gone (an undone Create
  // Symbol), and a viewport's annotations until the viewport is
  const open = store.symbolEdit;
  if (open && (open.viewport ? s.doc.openAnnotations(open.viewport) : s.doc.openSymbol(open.index)) === null) {
    exitSymbol();
    return;
  }
  const layers = s.doc.layers();
  if (!store.symbolEdit && !layers.some((l) => l.id === store.activeLayerId)) {
    store.activeLayerId = defaultLayer(layers)?.id ?? null;
  }
  const classes = s.doc.classes();
  if (!classes.some((c) => c.index === store.activeClassIndex)) {
    const fallback = classes.find((c) => c.name === "None") ?? classes[0];
    store.activeClassIndex = fallback ? fallback.index : 0;
  }
  pruneSelection();
}

// ---- selection ------------------------------------------------------------

/** Selects every visible top-level object (or group child) on the active layer. */
export function selectAll(scene: Scene): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  setSelection(
    scene
      .topLevelEntries(layerId, store.editGroupId)
      .filter((e) => e.visible)
      .map((e) => e.id),
  );
}

/** Edit > Invert Selection: selects what Select All would that isn't selected, and lets go of what is. */
export function invertSelection(scene: Scene): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  setSelection(
    scene
      .topLevelEntries(layerId, store.editGroupId)
      .filter((e) => e.visible && !store.selection.has(e.id))
      .map((e) => e.id),
  );
}

/** Each selected object with the bounds of its whole subtree; objects without geometry are left out. */
export function selectionEntries(scene: Scene): { readonly id: string; readonly box: BBox }[] {
  const layerId = store.activeLayerId;
  if (!layerId) return [];
  const out: { readonly id: string; readonly box: BBox }[] = [];
  for (const e of scene.topLevelEntries(layerId, store.editGroupId)) {
    if (e.bbox && store.selection.has(e.id)) out.push({ id: e.id, box: e.bbox });
  }
  return out;
}

/** Bounds of the selection, or null when nothing selected has geometry. */
export function selectionBounds(scene: Scene): BBox | null {
  let box: BBox | null = null;
  for (const e of selectionEntries(scene)) box = unionBBox(box, e.box);
  return box;
}

// ---- clipboard ------------------------------------------------------------

const CLIPBOARD_FORMAT = "openvwx-objects-1";

/** The last copy made in this editor; used when the system clipboard holds nothing of ours. */
let clipboard: ClipboardData | null = null;
/** for a copy holding parts of a big drawing left in its file, what the system clipboard was given: read back there, it is this copy */
let clipboardText = "";

function rememberCopy(data: ClipboardData): void {
  clipboard = data;
  clipboardText = "";
  // the system clipboard carries the copy to other windows; a denied write is not an error
  try {
    if (!clipboardHolds(data)) {
      navigator.clipboard.writeText(JSON.stringify(data)).catch(() => undefined);
      return;
    }
    // parts of a big drawing left in its file (core/held.ts) are put back for other windows, which can't read them
    void expandClipboard(data)
      .then((full) => {
        if (clipboard !== data) return;
        clipboardText = JSON.stringify(full);
        return navigator.clipboard.writeText(clipboardText);
      })
      .catch(() => undefined);
  } catch {
    // no clipboard API here (insecure context): the in-editor clipboard still works
  }
}

/** Copied objects read back from the system clipboard; null when it holds anything else. */
async function readSystemCopy(): Promise<ClipboardData | null> {
  try {
    const text = await navigator.clipboard.readText();
    // this window's own copy holding parts left in a file: they stay there
    if (clipboard && clipboardText && text === clipboardText) return clipboard;
    const parsed = JSON.parse(text) as Partial<ClipboardData> | null;
    if (parsed?.format === CLIPBOARD_FORMAT && Array.isArray(parsed.records)) return parsed as ClipboardData;
  } catch {
    // denied, empty or not JSON: the in-editor copy is used instead
  }
  return null;
}

/** The layer's scale for a copy drawn as a bitmap: a design layer's, else 1. */
function copyScale(layerId: string): number {
  const layer = layerInfo(layerId);
  return layer?.kind === "design" && layer.scale > 0 ? layer.scale : 1;
}

export function copySelection(): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const r = attempt("Copy", (s) => s.copyObjects(ids));
  if (!r) return;
  rememberCopy(r.value);
  const session = store.session;
  const layerId = store.activeLayerId;
  if (session && layerId) copiedFrom(session, layerId, ids, copyScale(layerId));
}

export function cutSelection(): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const r = attempt("Cut", (s) => s.copyObjects(ids));
  if (!r) return;
  rememberCopy(r.value);
  const doc = store.session?.doc;
  const layerId = store.activeLayerId;
  if (doc && layerId) cutFrom(doc, layerId, ids, copyScale(layerId));
  deleteObjects(ids);
}

/**
 * Pastes onto the active layer, leaves group editing and selects the new
 * objects. With a view the copy's bounds are centred in it; with null (Paste in
 * Place) the objects keep their coordinates.
 */
async function pasteCopy(view: View | null): Promise<void> {
  const data = (await readSystemCopy()) ?? clipboard;
  // the read is asynchronous, so the document and layer are looked up after it
  const layerId = store.activeLayerId;
  if (!data || !layerId || data.records.length === 0) return;
  let dx = 0;
  let dy = 0;
  if (view && data.bbox) {
    dx = view.cx - (data.bbox.x0 + data.bbox.x1) / 2;
    dy = view.cy - (data.bbox.y0 + data.bbox.y1) / 2;
  }
  const r = attempt("Paste", (s) => s.pasteObjects(layerId, data, dx, dy));
  if (r) setEditGroup(null, r.value);
}

export function paste(view: View): Promise<void> {
  return pasteCopy(view);
}

export function pasteInPlace(): Promise<void> {
  return pasteCopy(null);
}

// ---- edit -----------------------------------------------------------------

/** Duplicates the selection, offset by one grid step (or in place, as Preferences > Edit says). */
export function duplicateSelection(view: View): void {
  duplicateObjects([...store.selection], prefs().offsetDuplicates ? gridStep(view.scale) : 0);
}

// ---- objects --------------------------------------------------------------

/** Groups the selection (two or more objects in one container) and selects the group. */
export function groupSelection(): void {
  const ids = [...store.selection];
  if (ids.length < 2) return;
  const r = attempt("Group", (s) => s.groupObjects(ids));
  if (r) setSelection([r.value]);
}

/** Releases the selected groups; the objects inside and the other selected objects stay selected. */
export function ungroupSelection(): void {
  const doc = store.session?.doc;
  if (!doc) return;
  const ids = [...store.selection];
  const groups = ids.filter((id) => doc.object(id)?.kind === "group");
  if (groups.length === 0) return;
  const groupSet = new Set(groups);
  const others = ids.filter((id) => !groupSet.has(id));
  const r = attempt("Ungroup", (s) => s.ungroupObjects(groups));
  if (r) setSelection([...r.value, ...others]);
}

export function arrangeSelection(to: Arrange): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  attempt("Arrange", (s) => s.arrangeObjects(ids, to));
}

/** Moves the selection by (dx, dy) millimetres (world units). */
export function moveBy(dx: number, dy: number): void {
  moveObjects([...store.selection], dx, dy);
}

/** Moves the selection by (dx, dy) and raises it by dz, in millimetres (Modify > Move 3D…). */
export function moveBy3D(dx: number, dy: number, dz: number): void {
  const ids = [...store.selection];
  if (ids.length === 0 || (dx === 0 && dy === 0 && dz === 0)) return;
  const r = attempt("Move 3D", (s) => s.moveObjects3D(ids, dx, dy, dz));
  if (r && !r.value) toast("Move 3D: 2D objects have no height, so they moved in plan only.");
}

/**
 * Modify > Unrotate 3D Objects: turns the selected extrudes, sweeps, multiple extrudes, solids and
 * symbols holding 3D back to the layer's axes, each where it stands. One undo step.
 */
export function unrotate3D(): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const r = attempt("Unrotate 3D Objects", (s) => s.unrotateObjects3D(ids));
  if (r && r.value.length === 0) toast("None of the selected objects is a turned extrude, sweep, multiple extrude, solid or 3D symbol.", "info");
}

/** Applies `about(centre)` to the selection, where the centre is the middle of the selection's bounds. */
function transformSelection(scene: Scene, label: string, about: (centre: Pt) => Affine): void {
  const ids = [...store.selection];
  const box = selectionBounds(scene);
  if (ids.length === 0 || !box) return;
  const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  attempt(label, (s) => s.transformObjects(ids, about(centre)));
}

/** sin and cos of an angle, exact at multiples of 90 degrees so right-angle turns stay exact. */
function sinCos(deg: number): { readonly s: number; readonly c: number } {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return { s: 0, c: 1 };
  if (r === 90) return { s: 1, c: 0 };
  if (r === 180) return { s: 0, c: -1 };
  if (r === 270) return { s: -1, c: 0 };
  const t = degToRad(deg);
  return { s: Math.sin(t), c: Math.cos(t) };
}

/** A counter-clockwise turn of `deg` degrees about `p`. */
export function turnAbout(p: Pt, deg: number): Affine {
  const { s, c } = sinCos(deg);
  return { a: c, b: s, c: -s, d: c, e: p.x - c * p.x + s * p.y, f: p.y - s * p.x - c * p.y };
}

/** Rotates the selection counter-clockwise by `deg` degrees about the centre of its bounds. */
export function rotateBy(scene: Scene, deg: number): void {
  if (((deg % 360) + 360) % 360 === 0) return;
  transformSelection(scene, "Rotate", (p) => turnAbout(p, deg));
}

/**
 * Modify > Rotate Each Left 90° and Rotate Each Right 90°: turns each selected object
 * counter-clockwise by `deg` degrees about the centre of its own bounds, so each stays where it
 * was. One undo step.
 */
export function rotateEachBy(scene: Scene, deg: number): void {
  const entries = selectionEntries(scene);
  if (entries.length === 0 || ((deg % 360) + 360) % 360 === 0) return;
  attempt("Rotate Each", (s) =>
    s.batch(() => {
      for (const { id, box } of entries) s.transformObjects([id], turnAbout({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, deg));
    }),
  );
}

/** Mirrors the selection about the vertical (or horizontal) line through the centre of its bounds. */
export function flipSelection(scene: Scene, axis: "horizontal" | "vertical"): void {
  transformSelection(scene, "Flip", (p) =>
    axis === "horizontal"
      ? { a: -1, b: 0, c: 0, d: 1, e: 2 * p.x, f: 0 }
      : { a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * p.y },
  );
}

/** Scales the selection by `factor` about the centre of its bounds. */
export function scaleBy(scene: Scene, factor: number): void {
  if (!(factor > 0) || factor === 1) return;
  transformSelection(scene, "Scale", (p) => ({
    a: factor,
    b: 0,
    c: 0,
    d: factor,
    e: p.x * (1 - factor),
    f: p.y * (1 - factor),
  }));
}

/** Which edge or centre of the selection's bounds the objects line up with. */
export type AlignEdge = "left" | "centre" | "right" | "top" | "middle" | "bottom";

export interface Move {
  readonly id: string;
  readonly dx: number;
  readonly dy: number;
}

/** Offsets below this many millimetres are rounding noise and are not applied. */
const MOVE_EPS = 1e-9;

/** Moves each object by its own offset, objects that need the same offset moved together, as one undo step. */
export function applyMoves(label: string, moves: readonly Move[]): void {
  const groups = movesByOffset(moves);
  if (groups.length) attempt(label, (s) => s.batch(() => groups.forEach(({ dx, dy, ids }) => s.moveObjects(ids, dx, dy))));
}

/** The moves grouped by offset, leaving out the ones too small to apply. */
function movesByOffset(moves: readonly Move[]): { readonly dx: number; readonly dy: number; readonly ids: string[] }[] {
  const batches = new Map<string, { readonly dx: number; readonly dy: number; readonly ids: string[] }>();
  for (const m of moves) {
    if (Math.abs(m.dx) < MOVE_EPS && Math.abs(m.dy) < MOVE_EPS) continue;
    const key = `${m.dx}|${m.dy}`;
    const batch = batches.get(key);
    if (batch) batch.ids.push(m.id);
    else batches.set(key, { dx: m.dx, dy: m.dy, ids: [m.id] });
  }
  return [...batches.values()];
}

/**
 * Modify > Align > Align to Grid: each selected object moves so its upper-left corner lands on the
 * nearest point of the snap grid (the grid shown, at its fixed spacing or the one the zoom gives
 * it), in one undo step.
 */
export function alignToGrid(scene: Scene, view: View): void {
  const items = selectionEntries(scene);
  if (items.length === 0) return;
  const g = gridStep(view.scale);
  const onGrid = (v: number): number => Math.round(v / g) * g;
  const groups = movesByOffset(items.map(({ id, box: b }): Move => ({ id, dx: onGrid(b.x0) - b.x0, dy: onGrid(b.y1) - b.y1 })));
  if (groups.length === 0) {
    toast("The selection is already on the grid.", "info");
    return;
  }
  attempt("Align to Grid", (s) => s.batch(() => groups.forEach(({ dx, dy, ids }) => s.moveObjects(ids, dx, dy))));
}

/** Lines up the selected objects on `edge` of the selection's bounds (needs two or more). */
export function alignSelection(scene: Scene, edge: AlignEdge): void {
  const items = selectionEntries(scene);
  if (items.length < 2) return;
  let box: BBox | null = null;
  for (const it of items) box = unionBBox(box, it.box);
  if (!box) return;
  const target = box;
  const moves = items.map(({ id, box: b }): Move => {
    switch (edge) {
      case "left":
        return { id, dx: target.x0 - b.x0, dy: 0 };
      case "right":
        return { id, dx: target.x1 - b.x1, dy: 0 };
      case "centre":
        return { id, dx: (target.x0 + target.x1) / 2 - (b.x0 + b.x1) / 2, dy: 0 };
      case "top":
        return { id, dx: 0, dy: target.y1 - b.y1 };
      case "bottom":
        return { id, dx: 0, dy: target.y0 - b.y0 };
      case "middle":
        return { id, dx: 0, dy: (target.y0 + target.y1) / 2 - (b.y0 + b.y1) / 2 };
    }
  });
  applyMoves("Align", moves);
}

/**
 * Spaces the selected objects evenly along an axis: the outermost ones stay
 * where they are and the gaps between neighbours become equal (needs three or more).
 */
export function distributeSelection(scene: Scene, axis: "horizontal" | "vertical"): void {
  const items = selectionEntries(scene);
  if (items.length < 3) return;
  const lo = (b: BBox): number => (axis === "horizontal" ? b.x0 : b.y0);
  const hi = (b: BBox): number => (axis === "horizontal" ? b.x1 : b.y1);
  const sorted = [...items].sort((p, q) => lo(p.box) - lo(q.box));
  const start = lo(sorted[0].box);
  let end = -Infinity;
  let sizes = 0;
  for (const it of sorted) {
    end = Math.max(end, hi(it.box));
    sizes += hi(it.box) - lo(it.box);
  }
  const gap = (end - start - sizes) / (sorted.length - 1);
  let cursor = start;
  const moves = sorted.map(({ id, box }): Move => {
    const d = cursor - lo(box);
    cursor += hi(box) - lo(box) + gap;
    return axis === "horizontal" ? { id, dx: d, dy: 0 } : { id, dx: 0, dy: d };
  });
  applyMoves("Distribute", moves);
}

// ---- view and display -----------------------------------------------------

/** How much one Zoom In or Zoom Out step changes the scale. */
export const ZOOM_STEP = 1.5;

/** Zooms by `factor` about the centre of the window. */
export function zoomBy(view: View, factor: number): void {
  stopGlide();
  view.zoomAt(view.width / 2, view.height / 2, factor);
  store.emit("view");
}

/** Fits the window to the bounds of the selection. */
export function zoomToSelection(scene: Scene, view: View): void {
  const box = selectionBounds(scene);
  if (!box) return;
  glide(view, () => view.fit(box));
}

/** CSS px a millimetre takes on screen: the browser draws an inch (25.4 mm) as 96 px. */
const SCREEN_PX_PER_MM = 96 / 25.4;
/** the page's margin in the window when it is fitted, a share of the window */
const PAGE_MARGIN = 0.04;

/** The active sheet layer's page (Page Setup), centred on its origin; null on a design layer, whose page isn't placed. */
function activePage(scene: Scene): BBox | null {
  const layer = store.activeLayerId ? scene.layer(store.activeLayerId) : undefined;
  const page = layer?.kind === "sheet" && !store.view3d ? layer.page : undefined;
  return page ? { x0: -page.width / 2, y0: -page.height / 2, x1: page.width / 2, y1: page.height / 2 } : null;
}

/** True when View > Fit to Page Area has a page to fit: the active layer is a sheet with its page set. */
export function canFitToPage(scene: Scene): boolean {
  return activePage(scene) !== null;
}

/** View > Fit to Page Area: the active sheet's page fills the window. */
export function fitToPage(scene: Scene, view: View): void {
  const page = activePage(scene);
  if (page) glide(view, () => view.fit(page, PAGE_MARGIN));
}

/** View > Normal Scale: the drawing as large on screen as it prints, at the active layer's scale, about the window's centre. */
export function normalScale(scene: Scene, view: View): void {
  const layer = store.activeLayerId ? scene.layer(store.activeLayerId) : undefined;
  if (!layer || store.view3d) return;
  const target = SCREEN_PX_PER_MM / (layer.kind === "sheet" ? 1 : layer.scale || 1);
  glide(view, () => view.zoomAt(view.width / 2, view.height / 2, target / view.scale));
}

export function toggleGrid(): void {
  setGrid({ show: !store.showGrid });
}

export function toggleSnapGrid(): void {
  setGrid({ snap: !store.snapGrid });
}

export function toggleSnapObjects(): void {
  store.snapObjects = !store.snapObjects;
  store.emit("snap");
}
