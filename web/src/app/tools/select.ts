// Select tool: click / shift-click selection on any visible layer (the clicked
// object's layer becomes active), drag to move the selection, drag on empty
// space for a window (left-to-right) or crossing (right-to-left) box select,
// drag a grip of a single selected shape to reshape it. Double-click a group to
// edit inside it (Esc or double-click empty space leaves), double-click text to
// edit it; Cmd+click selects an object inside its groups directly. While the selection moves,
// the floating data bar shows how far it has gone and where the point dragged is, measured from
// the SmartCursor datum while one is set.

import type { Affine, BBox, NewShape, ObjectInfo, Pt, VwxDocument } from "../../core/index.ts";
import { polylineOutline } from "../../core/index.ts";
import {
  attempt,
  exitEditGroup,
  moveObjects,
  selectionBounds,
  selectionEntries,
  setActiveClass,
  setActiveLayer,
  setEditGroup,
  setSelection,
} from "../commands.ts";
import { pluginDriver } from "../ext.ts";
import { dist, ellipsePoints, normalizeRect, unionBBox } from "../geom.ts";
import { followHyperlink, isHyperlink } from "../hyperlink.ts";
import { boundsInFrame, pickObject, pickViewport, topIdsInFrame, topIdsInPolygon, topIdsInRect } from "../hittest.ts";
import { isDerivedId, type Scene } from "../scene.ts";
import type { View } from "../view.ts";
import { prefs } from "../prefs.ts";
import { store } from "../state.ts";
import { annotatableViewport, editAnnotations, editSymbol } from "../symbolEdit.ts";
import { editWorksheet } from "../worksheetEditor.ts";
import { deleteVertex, insertVertex, reshape, textLines } from "../shapes.ts";
import { ACCENT, HANDLE_PX } from "../renderer.ts";
import { toast } from "../toast.ts";
import { escapeLeavesGroup } from "../exitGroup.ts";
import { dataBar, FIELD_DX, FIELD_DY, FIELD_X, FIELD_Y, type BarHandlers, type BarStage } from "../databar.ts";
import {
  ALT_KEY,
  BaseTool,
  MOD_KEY,
  type MoveDelta,
  type Painter,
  type PointerInfo,
  type ToolModes,
} from "../tools.ts";

const DRAG_PX = 3;
/** screen distance between the points a lasso keeps */
const LASSO_STEP_PX = 4;
/** a polygon marquee closes with a click this near its first point */
const CLOSE_PX = 8;
/** grips can be grabbed a little outside the drawn square */
const GRIP_PICK_PX = HANDLE_PX / 2 + 3;
const ARC_PREVIEW_STEPS = 72;

/** The data bar while the selection moves: ΔX and ΔY, and the dragged point's X and Y; it only shows them. */
const MOVE_STAGE: BarStage = { key: "select-move", caption: "Move", fields: [FIELD_DX, FIELD_DY, FIELD_X, FIELD_Y] };
const MOVE_HANDLERS: BarHandlers = { commit: () => {}, edit: () => {} };

type Mode = "idle" | "press" | "move" | "marquee" | "polygon" | "reshape" | "scale";

/**
 * The marquee a drag (or, for Polygon, clicks) on empty space draws, as Vectorworks' Selection
 * tool modes have it: a box, a polygon clicked point by point, or a freehand lasso.
 */
type Marquee = "rect" | "polygon" | "lasso";

function isMarquee(id: string): id is Marquee {
  return id === "rect" || id === "polygon" || id === "lasso";
}

/**
 * Vectorworks' interactive scaling modes: the selection's bounds get handles that scale it, for
 * one selected object or for several, or there are none (dragging only moves and reshapes).
 */
type Scaling = "scale-off" | "scale-single" | "scale-multiple";

function isScaling(id: string): id is Scaling {
  return id === "scale-off" || id === "scale-single" || id === "scale-multiple";
}

/** A scaling handle: where it sits, and which way it pulls (-1, 0 or 1 across x and y from the centre). */
interface ScaleHandle {
  readonly at: Pt;
  readonly fx: -1 | 0 | 1;
  readonly fy: -1 | 0 | 1;
}

/** bounds thinner than this (document units) get no handles across them */
const FLAT = 1e-9;

interface Grip {
  readonly obj: ObjectInfo;
  /** index into the object's Geom.handles, or Geom.edges when `edge` */
  readonly index: number;
  readonly edge: boolean;
}


/** Layers a click can select from (see scene.pickableLayers); inside a group only the active layer. */
function pickLayers(scene: Scene): string[] {
  const active = store.activeLayerId;
  if (!active) return [];
  return store.editGroupId ? [active] : scene.pickableLayers(active);
}

/**
 * A right-click at `screen`: selects the object under it, as a click does, unless it is already
 * selected (so the menu acts on the whole selection). Returns the object under it (the one a
 * click picks: a group for what is inside it), or null for none.
 */
export function selectForMenu(scene: Scene, view: View, screen: Pt): string | null {
  const scope = store.editGroupId;
  const layers = pickLayers(scene);
  const hit = scope
    ? pickObject(scene, view, screen, layers, (o) => scene.unitOf(o, scope) !== null)
    : (pickObject(scene, view, screen, layers) ?? pickViewport(scene, view, screen, layers));
  const top = hit ? scene.pickedUnitOf(hit, scope) : null;
  if (!hit || top === null) return null;
  if (store.selection.has(top)) return top;
  if (hit.layerId !== store.activeLayerId) setActiveLayer(hit.layerId);
  setSelection([top]);
  return top;
}

/**
 * Force Select's object at `screen`: the topmost one drawn there that the layer and class options
 * keep a click from selecting (on another visible design layer, or in a visible class but not the
 * active one), as a click picks it; null for none, or inside a group or symbol being edited.
 */
export function forceSelectTarget(scene: Scene, view: View, screen: Pt): string | null {
  const active = store.activeLayerId;
  if (!active || store.editGroupId !== null || store.symbolEdit !== null) return null;
  const others = scene
    .drawnLayers(active)
    .filter((l) => l.id !== active)
    .map((l) => l.id)
    .reverse();
  const hit = pickObject(scene, view, screen, [active, ...others], undefined, true);
  return hit ? scene.pickedUnitOf(hit, null) : null;
}

/** Force Select: the object's layer and class made active where the options need it, and the object selected. */
export function forceSelect(scene: Scene, id: string): void {
  const o = store.session?.doc.object(id);
  if (!o) return;
  const active = store.activeLayerId;
  if (o.layerId !== active && !scene.pickableLayers(active).includes(o.layerId)) setActiveLayer(o.layerId);
  if (!scene.isClassPickable(o.classIndex)) setActiveClass(o.classIndex);
  setSelection([id]);
}

/** Ids of the groups around `obj`, outermost first; null when one of its containers is not a plain group. */
function groupPath(doc: VwxDocument, obj: ObjectInfo): string[] | null {
  const path: string[] = [];
  for (let id = obj.parentId; id !== null; ) {
    const g = doc.object(id);
    if (!g || g.kind !== "group") return null;
    path.unshift(id);
    id = g.parentId;
  }
  return path;
}

export class SelectTool extends BaseTool {
  readonly id = "select";
  readonly cursor = "default";

  private mode: Mode = "idle";
  private startRaw: Pt = { x: 0, y: 0 };
  private startScreen: Pt = { x: 0, y: 0 };
  private cursorRaw: Pt = { x: 0, y: 0 };
  private pressedTop: string | null = null;
  private pressedWasSelected = false;
  /** snapped position the drag is measured from */
  private anchor: Pt = { x: 0, y: 0 };
  private moveIds: ReadonlySet<string> = new Set<string>();
  private delta: Pt = { x: 0, y: 0 };
  private grip: Grip | null = null;
  /** geometry the grip drag would write, null while it would not change anything */
  private reshaped: NewShape | null = null;
  private dragged = false;
  private marquee: Marquee = "rect";
  /** the lasso's path, or the polygon's points, in world space */
  private path: Pt[] = [];
  /** Option held at the last pointer event: a polygon or lasso then selects what it touches */
  private alt = false;
  /** the press's click count (a release reports none) */
  private clicks = 1;
  private scaling: Scaling = "scale-off";
  /** a scaling drag: the handle, the point it scales about, and the scale it would apply */
  private scaleFrom: ScaleHandle | null = null;
  private scaleAnchor: Pt = { x: 0, y: 0 };
  private scaleBox: BBox | null = null;
  private scaleBy: Affine | null = null;
  /** waits for the pointer to rest before pre-selecting what is under it */
  private preselectTimer: ReturnType<typeof setTimeout> | undefined;

  modes(): ToolModes[] {
    // no keys: Selection is the tool most keys are typed in, and 3 shows the 3D view
    return [
      {
        label: "Marquee",
        options: [
          { id: "rect", label: "Rectangle" },
          { id: "polygon", label: "Polygon" },
          { id: "lasso", label: "Lasso" },
        ],
        active: this.marquee,
      },
      {
        label: "Interactive scaling",
        options: [
          { id: "scale-off", label: "No Scaling" },
          { id: "scale-single", label: "Single Object" },
          { id: "scale-multiple", label: "Multiple Objects" },
        ],
        active: this.scaling,
      },
    ];
  }

  setMode(id: string): void {
    if (this.mode !== "idle") this.cancel();
    if (isMarquee(id)) this.marquee = id;
    else if (isScaling(id)) this.scaling = id;
  }

  hint(): string {
    if (this.mode === "scale") return "Release to scale · Shift keeps the proportions";
    if (this.mode === "move") return "Release to drop the selection";
    if (this.mode === "reshape") return "Release to reshape";
    if (this.mode === "polygon") {
      return `Click the next point · Double-click, Enter or click the first point selects · ${ALT_KEY} selects what it touches`;
    }
    if (this.mode === "marquee" && this.marquee === "lasso") {
      return this.alt ? "Lasso: selects objects it touches" : `Lasso: selects objects fully inside · ${ALT_KEY} selects what it touches`;
    }
    if (this.mode === "marquee") {
      return this.cursorRaw.x < this.startRaw.x ? "Crossing: selects objects it touches" : "Window: selects objects fully inside";
    }
    if (store.editGroupId) return "Editing inside a group · Esc leaves";
    if (this.scaleHandles()) return "Drag a handle to scale · Shift keeps the proportions · Shift-click toggles";
    if (store.selection.size === 1) {
      const obj = store.session?.doc.object([...store.selection][0]);
      if (obj?.kind === "group") return `Double-click to edit the group · ${MOD_KEY} selects inside`;
      if (obj?.shape) {
        return obj.kind === "polygon" || obj.kind === "polyline"
          ? `Drag a vertex to reshape · Midpoint adds one · ${ALT_KEY} removes one`
          : "Drag a grip to reshape · Shift toggles";
      }
    }
    if (this.marquee === "polygon") return "Click, or click out a polygon to select · Shift toggles";
    if (this.marquee === "lasso") return "Click, or draw a lasso to select · Shift toggles";
    return `Click or drag a box to select · Shift toggles · ${MOD_KEY} selects inside`;
  }

  /**
   * Pre-selection: once the pointer rests on an object, outlines what a click there would select
   * (as a click picks it: the group or symbol it is in, or inside the group being edited).
   */
  private hover(p: PointerInfo): void {
    clearTimeout(this.preselectTimer);
    const set = prefs();
    if (!set.preselect) return this.clearPreselect();
    const screen = p.screen;
    this.preselectTimer = setTimeout(() => {
      const { scene, view } = this.env;
      if (this.mode !== "idle" || store.tool !== this.id || !scene.document) return;
      const scope = store.editGroupId;
      const layers = pickLayers(scene);
      const hit = scope
        ? pickObject(scene, view, screen, layers, (o) => scene.unitOf(o, scope) !== null)
        : (pickObject(scene, view, screen, layers) ?? pickViewport(scene, view, screen, layers));
      const top = hit ? scene.pickedUnitOf(hit, scope) : null;
      if (top === store.preselect) return;
      store.preselect = top;
      this.env.requestDraw();
    }, set.preselectMs);
  }

  private clearPreselect(): void {
    clearTimeout(this.preselectTimer);
    if (store.preselect === null) return;
    store.preselect = null;
    this.env.requestDraw();
  }

  down(p: PointerInfo): void {
    this.clearPreselect();
    const { scene, view } = this.env;
    const doc = scene.document;
    if (!doc || !store.activeLayerId) return;
    this.alt = p.alt;
    if (this.mode === "polygon") {
      if (p.detail < 2 || this.path.length >= 3) {
        this.addPolygonPoint(p);
        return;
      }
      // a double-click on empty space rather than a polygon: handled as one below
      this.cancel();
    }
    this.startRaw = p.raw;
    this.startScreen = p.screen;
    this.cursorRaw = p.raw;
    this.dragged = false;
    this.clicks = p.detail;

    // Shift held from the press keeps the proportions, so it does not stop a scaling drag
    const handle = p.detail < 2 ? this.scaleHandleAt(p.screen) : null;
    if (handle) {
      this.startScale(handle);
      return;
    }
    const grip = p.detail < 2 && !p.shift ? this.gripAt(p.screen) : null;
    if (grip && p.alt && !grip.edge) {
      // Option-click a vertex: remove it
      const shape = grip.obj.shape;
      const next = shape ? deleteVertex(shape, grip.index) : null;
      if (next) {
        const id = grip.obj.id;
        attempt("Delete vertex", (s) => s.setGeometry(id, next));
      } else if (shape?.kind === "polygon" || shape?.kind === "polyline") {
        toast("That would leave too few vertices.", "info");
      }
      this.mode = "idle";
      return;
    }
    if (grip) {
      this.grip = grip;
      this.reshaped = null;
      this.mode = "reshape";
      return;
    }

    const scope = store.editGroupId;
    const hit = scope
      ? pickObject(scene, view, p.screen, pickLayers(scene), (o) => scene.unitOf(o, scope) !== null)
      : (pickObject(scene, view, p.screen, pickLayers(scene)) ?? pickViewport(scene, view, p.screen, pickLayers(scene)));

    if (p.detail >= 2 && this.doubleClick(doc, hit)) {
      this.mode = "idle";
      return;
    }

    // Cmd+click on a hyperlink follows it, as in Vectorworks
    const link = hit && p.mod && !p.shift && p.detail < 2 ? scene.pickedUnitOf(hit, store.editGroupId) : null;
    if (link !== null && isHyperlink(doc, link)) {
      followHyperlink(link);
      this.mode = "idle";
      return;
    }

    let top: string | null = null;
    if (hit) {
      if (hit.layerId !== store.activeLayerId) setActiveLayer(hit.layerId);
      const path = p.mod && !isDerivedId(hit.id) ? groupPath(doc, hit) : null;
      if (path && path.length > 0) {
        // Cmd+click: straight to the object, editing inside its innermost group
        const inner = path[path.length - 1];
        if (store.editGroupId !== inner) setEditGroup(inner);
        top = hit.id;
      } else {
        top = scene.pickedUnitOf(hit, store.editGroupId);
      }
    }
    this.pressedTop = top;
    this.pressedWasSelected = top !== null && store.selection.has(top);
    if (top === null) {
      if (!p.shift) setSelection([]);
    } else if (p.shift) {
      if (!this.pressedWasSelected) setSelection([...store.selection, top]);
    } else if (!this.pressedWasSelected) {
      setSelection([top]);
    }
    this.mode = "press";
  }

  move(p: PointerInfo): void {
    if (this.mode === "idle") {
      this.hover(p);
      return;
    }
    this.cursorRaw = p.raw;
    this.alt = p.alt;
    if (this.mode === "polygon") return;
    if (!this.dragged && dist(p.screen, this.startScreen) >= DRAG_PX) this.dragged = true;
    if (this.mode === "scale") {
      this.scaleBy = this.dragged ? this.scaleTo(this.env.snap.snap(p.raw, this.env.view).pos, p.shift) : null;
      return;
    }
    if (this.mode === "reshape") {
      const grip = this.grip;
      if (!grip?.obj.shape || !this.dragged) return;
      const to = this.env.snap.snap(p.raw, this.env.view).pos;
      this.reshaped = grip.edge ? insertVertex(grip.obj.shape, grip.index, to) : reshape(grip.obj.shape, grip.index, to);
      return;
    }
    if (this.mode === "press") {
      if (!this.dragged) return;
      if (this.pressedTop !== null) {
        this.moveIds = new Set(store.selection);
        this.anchor = this.env.snap.snap(this.startRaw, this.env.view, this.moveIds).pos;
        this.mode = "move";
      } else {
        this.mode = "marquee";
        this.path = [this.startRaw];
      }
    }
    if (this.mode === "marquee" && this.marquee === "lasso") {
      const last = this.path[this.path.length - 1];
      if (dist(this.env.view.toScreen(last), p.screen) >= LASSO_STEP_PX) this.path.push(p.raw);
    }
    if (this.mode === "move") {
      const to = this.env.snap.snap(p.raw, this.env.view, this.moveIds).pos;
      this.delta = this.alongWall({ x: to.x - this.anchor.x, y: to.y - this.anchor.y });
      this.showMove();
    }
  }

  /** The data bar beside the dragged point: how far the selection has moved, and where the point is (from the datum while one is set). */
  private showMove(): void {
    const at = { x: this.anchor.x + this.delta.x, y: this.anchor.y + this.delta.y };
    dataBar.setStage(MOVE_STAGE, MOVE_HANDLERS);
    dataBar.show();
    dataBar.update({ dx: this.delta.x, dy: this.delta.y, x: at.x, y: at.y });
    dataBar.position(this.env.view.toScreen(at), this.env.view);
  }

  /**
   * A drag of one door, window or symbol set in a wall, as it moves: the part of `d` along the
   * wall's line (it slides along the wall, EditSession.moveObjects); any other drag as it is.
   */
  private alongWall(d: Pt): Pt {
    if (this.moveIds.size !== 1) return d;
    const doc = this.env.scene.document;
    const obj = doc?.object([...this.moveIds][0]);
    const w = obj?.parentId ? doc?.wall(obj.parentId) : null;
    if (!w) return d;
    const l = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    if (!(l > 0)) return d;
    const u = { x: (w.end.x - w.start.x) / l, y: (w.end.y - w.start.y) / l };
    const k = d.x * u.x + d.y * u.y;
    return { x: u.x * k, y: u.y * k };
  }

  up(p: PointerInfo): void {
    const mode = this.mode;
    if (mode === "polygon") return;
    this.mode = "idle";
    if (mode === "scale") {
      const m = this.scaleBy;
      this.cancel();
      const ids = [...store.selection];
      if (m && ids.length > 0) attempt("Scale", (s) => s.transformObjects(ids, m));
      return;
    }
    if (mode === "reshape") {
      const grip = this.grip;
      const next = this.reshaped;
      this.grip = null;
      this.reshaped = null;
      // no geometry: not dragged, or the shape would collapse (a zero-size rectangle)
      if (!grip || !next) return;
      const id = grip.obj.id;
      attempt("Reshape", (s) => s.setGeometry(id, next));
      return;
    }
    if (mode === "move") {
      const { x: dx, y: dy } = this.delta;
      this.delta = { x: 0, y: 0 };
      dataBar.reset();
      moveObjects([...this.moveIds], dx, dy);
      return;
    }
    if (mode === "marquee") {
      if (this.marquee === "lasso") this.polygonSelect([...this.path, p.raw], p.alt, p.shift);
      else this.boxSelect(p);
      this.path = [];
      return;
    }
    if (mode === "press" && this.pressedTop === null && this.marquee === "polygon" && this.clicks < 2) {
      // a click on empty space starts the polygon; the next clicks add its points
      this.path = [this.startRaw];
      this.mode = "polygon";
      return;
    }
    if (mode === "press" && this.pressedTop !== null && this.pressedWasSelected) {
      const top = this.pressedTop;
      if (p.shift) setSelection([...store.selection].filter((id) => id !== top));
      else setSelection([top]);
    }
  }

  cancel(): void {
    if (this.mode === "move") dataBar.reset();
    this.clearPreselect();
    this.mode = "idle";
    this.delta = { x: 0, y: 0 };
    this.grip = null;
    this.reshaped = null;
    this.path = [];
    this.scaleFrom = null;
    this.scaleBox = null;
    this.scaleBy = null;
  }

  key(e: KeyboardEvent): boolean {
    if (this.mode === "polygon") {
      // keys held with Option never reach a tool, so Option is as the last pointer event had it
      if (e.key === "Enter") this.finishPolygon(this.alt || e.altKey, e.shiftKey);
      else if (e.key === "Backspace" && this.path.length > 1) this.path.pop();
      else if (e.key === "Backspace" || e.key === "Escape") this.cancel();
      else return false;
      return true;
    }
    if (e.key !== "Escape") return false;
    if (this.mode !== "idle") {
      this.cancel();
      return true;
    }
    // Esc Esc leaves the group, as Edit Group and Object Visibility Options has it; the first clears the selection
    if (store.editGroupId && escapeLeavesGroup()) {
      exitEditGroup();
      return true;
    }
    return false;
  }

  moveDelta(): MoveDelta | null {
    if (this.mode !== "move") return null;
    return { ids: this.moveIds, dx: this.delta.x, dy: this.delta.y };
  }

  overlay(g: Painter): void {
    if (this.mode === "scale") {
      this.drawScale(g);
      return;
    }
    if (this.mode === "idle") this.drawScaleHandles(g);
    if (this.mode === "reshape") {
      this.drawReshape(g);
      return;
    }
    if (this.mode === "polygon" || (this.mode === "marquee" && this.marquee === "lasso")) {
      this.drawPath(g);
      return;
    }
    if (this.mode !== "marquee") return;
    const a = g.toScreen(this.startRaw);
    const b = g.toScreen(this.cursorRaw);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x);
    const h = Math.abs(a.y - b.y);
    const crossing = b.x < a.x;
    const { ctx } = g;
    ctx.save();
    ctx.fillStyle = crossing ? "rgba(47, 163, 74, 0.12)" : "rgba(47, 111, 219, 0.10)";
    ctx.strokeStyle = crossing ? "#2fa34a" : ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash(crossing ? [5, 3] : []);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  }

  /** The selection's bounds in the plan's coordinates: along the screen in a rotated plan, else the drawing's. */
  private planBounds(): BBox | null {
    const { scene, view } = this.env;
    const layerId = store.activeLayerId;
    if (view.rotation === 0 || !layerId) return selectionBounds(scene);
    let box: BBox | null = null;
    for (const e of selectionEntries(scene)) box = unionBBox(box, boundsInFrame(scene, layerId, e.id, (q) => view.toPlan(q)));
    return box;
  }

  /** The scaling handles on the selection's bounds, in the plan's coordinates, while a scaling mode offers them; null otherwise. */
  private scaleHandles(): { readonly box: BBox; readonly handles: readonly ScaleHandle[] } | null {
    const n = store.selection.size;
    if (this.scaling === "scale-off" || n === 0 || (this.scaling === "scale-single" && n !== 1)) return null;
    if ([...store.selection].some(isDerivedId)) return null;
    const box = this.planBounds();
    if (!box) return null;
    const wide = box.x1 - box.x0 > FLAT;
    const tall = box.y1 - box.y0 > FLAT;
    if (!wide && !tall) return null;
    const handles: ScaleHandle[] = [];
    for (const fy of [-1, 0, 1] as const) {
      for (const fx of [-1, 0, 1] as const) {
        if ((fx === 0 && fy === 0) || (!wide && fx !== 0) || (!tall && fy !== 0)) continue;
        const at = {
          x: fx < 0 ? box.x0 : fx > 0 ? box.x1 : (box.x0 + box.x1) / 2,
          y: fy < 0 ? box.y0 : fy > 0 ? box.y1 : (box.y0 + box.y1) / 2,
        };
        handles.push({ at, fx, fy });
      }
    }
    return { box, handles };
  }

  private scaleHandleAt(screen: Pt): { readonly box: BBox; readonly handle: ScaleHandle } | null {
    const sh = this.scaleHandles();
    if (!sh) return null;
    let best: ScaleHandle | null = null;
    let bestD = GRIP_PICK_PX;
    for (const hd of sh.handles) {
      const d = dist(this.env.view.toScreen(this.env.view.fromPlan(hd.at)), screen);
      if (d <= bestD) {
        best = hd;
        bestD = d;
      }
    }
    return best ? { box: sh.box, handle: best } : null;
  }

  private startScale(hit: { readonly box: BBox; readonly handle: ScaleHandle }): void {
    const { box, handle } = hit;
    this.scaleFrom = handle;
    this.scaleBox = box;
    // the opposite corner or edge stays put
    this.scaleAnchor = {
      x: handle.fx < 0 ? box.x1 : handle.fx > 0 ? box.x0 : (box.x0 + box.x1) / 2,
      y: handle.fy < 0 ? box.y1 : handle.fy > 0 ? box.y0 : (box.y0 + box.y1) / 2,
    };
    this.scaleBy = null;
    this.mode = "scale";
  }

  /** The scale that takes the dragged handle to `to`, about the anchor; null when it would flatten the selection. */
  private scaleTo(world: Pt, proportional: boolean): Affine | null {
    const hd = this.scaleFrom;
    if (!hd) return null;
    const o = this.scaleAnchor;
    const to = this.env.view.toPlan(world);
    let sx = hd.fx !== 0 ? (to.x - o.x) / (hd.at.x - o.x) : 1;
    let sy = hd.fy !== 0 ? (to.y - o.y) / (hd.at.y - o.y) : 1;
    if (proportional) {
      // the larger pull sets both; an edge handle's own axis sets the other
      const s = hd.fx === 0 ? Math.abs(sy) : hd.fy === 0 ? Math.abs(sx) : Math.max(Math.abs(sx), Math.abs(sy));
      sx = (sx < 0 ? -1 : 1) * s;
      sy = (sy < 0 ? -1 : 1) * s;
    }
    if (!(Math.abs(sx) > 1e-6 && Math.abs(sy) > 1e-6) || !Number.isFinite(sx) || !Number.isFinite(sy)) return null;
    return this.env.view.planChange({ a: sx, b: 0, c: 0, d: sy, e: o.x - sx * o.x, f: o.y - sy * o.y });
  }

  private drawScaleHandles(g: Painter): void {
    const sh = this.scaleHandles();
    if (!sh) return;
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.fillStyle = "#ffffff";
    ctx.lineWidth = 1;
    const half = HANDLE_PX / 2;
    for (const hd of sh.handles) {
      const s = g.toScreen(this.env.view.fromPlan(hd.at));
      ctx.fillRect(Math.round(s.x - half) + 0.5, Math.round(s.y - half) + 0.5, HANDLE_PX, HANDLE_PX);
      ctx.strokeRect(Math.round(s.x - half) + 0.5, Math.round(s.y - half) + 0.5, HANDLE_PX, HANDLE_PX);
    }
    ctx.restore();
  }

  /** A scaling drag: the scaled bounds, and the selected shapes as they would be. */
  private drawScale(g: Painter): void {
    const m = this.scaleBy;
    const box = this.scaleBox;
    if (!m || !box) return;
    const at = (px: number, py: number): Pt => {
      const { x, y } = this.env.view.fromPlan({ x: px, y: py });
      return g.toScreen({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    };
    const o = g.toScreen({ x: 0, y: 0 });
    const ex = g.toScreen({ x: 1, y: 0 });
    const ey = g.toScreen({ x: 0, y: 1 });
    const toScreen = new DOMMatrix([ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y]);
    const scaled = toScreen.multiply(new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]));
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    const doc = this.env.scene.document;
    for (const id of store.selection) {
      const obj = doc?.object(id);
      const geom = obj ? this.env.scene.geometry(obj) : null;
      const outline = geom?.stroke ?? geom?.path;
      if (!outline) continue;
      const path = new Path2D();
      path.addPath(outline, scaled);
      ctx.stroke(path);
    }
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    [at(box.x0, box.y0), at(box.x1, box.y0), at(box.x1, box.y1), at(box.x0, box.y1)].forEach((s, i) =>
      i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y),
    );
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  /** The polygon or lasso so far (and the rubber band to the cursor), filled as the box is. */
  private drawPath(g: Painter): void {
    const pts = [...this.path, this.cursorRaw].map((pt) => g.toScreen(pt));
    if (pts.length < 2) return;
    const { ctx } = g;
    ctx.save();
    ctx.fillStyle = this.alt ? "rgba(47, 163, 74, 0.12)" : "rgba(47, 111, 219, 0.10)";
    ctx.strokeStyle = this.alt ? "#2fa34a" : ACCENT;
    ctx.lineWidth = 1;
    ctx.setLineDash(this.alt ? [5, 3] : []);
    ctx.beginPath();
    pts.forEach((s, i) => (i === 0 ? ctx.moveTo(s.x, s.y) : ctx.lineTo(s.x, s.y)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (this.mode === "polygon") {
      // the first point, which a click closes the polygon on
      const first = pts[0];
      ctx.setLineDash([]);
      ctx.strokeRect(first.x - 3.5, first.y - 3.5, 7, 7);
    }
    ctx.restore();
  }

  /** A click while clicking out a polygon: closes it on its first point or a double-click, else adds a point. */
  private addPolygonPoint(p: PointerInfo): void {
    const first = this.path[0];
    const last = this.path[this.path.length - 1];
    const view = this.env.view;
    if (p.detail >= 2 || (this.path.length >= 3 && dist(view.toScreen(first), p.screen) <= CLOSE_PX)) {
      this.finishPolygon(p.alt, p.shift);
      return;
    }
    if (dist(view.toScreen(last), p.screen) > DRAG_PX) this.path.push(p.raw);
  }

  private finishPolygon(alt: boolean, shift: boolean): void {
    const pts = this.path;
    this.cancel();
    this.polygonSelect(pts, alt, shift);
  }

  /** Box select: objects inside the box, or touching it when it was drawn leftwards. */
  private boxSelect(p: PointerInfo): void {
    const view = this.env.view;
    const a = view.toScreen(this.startRaw);
    const b = view.toScreen(p.raw);
    const crossing = b.x < a.x;
    if (view.rotation !== 0) {
      // in a rotated plan the box lies along the screen, so it is a turned box in the drawing
      const box = normalizeRect(view.toPlan(this.startRaw), view.toPlan(p.raw));
      this.marqueeSelect(p.shift, (layerId, scope) => topIdsInFrame(this.env.scene, layerId, box, (q) => view.toPlan(q), crossing, scope));
      return;
    }
    const rect = normalizeRect(this.startRaw, p.raw);
    this.marqueeSelect(p.shift, (layerId, scope) => topIdsInRect(this.env.scene, layerId, rect, crossing, scope));
  }

  /** Polygon or lasso select: objects inside it, or touching it with Option. */
  private polygonSelect(pts: readonly Pt[], touching: boolean, shift: boolean): void {
    if (pts.length < 3) {
      if (!shift) setSelection([]);
      return;
    }
    this.marqueeSelect(shift, (layerId, scope) => topIdsInPolygon(this.env.scene, layerId, pts, touching, scope));
  }

  /**
   * Selects what a marquee catches on the active layer (inside the group being edited, if any).
   * When it catches nothing there, the topmost visible layer it does catch something on becomes
   * active instead.
   */
  private marqueeSelect(shift: boolean, hitsOn: (layerId: string, scope: string | null) => string[]): void {
    const scope = store.editGroupId;
    for (const layerId of pickLayers(this.env.scene)) {
      const hits = hitsOn(layerId, layerId === store.activeLayerId ? scope : null);
      if (hits.length === 0) continue;
      if (layerId !== store.activeLayerId) {
        setActiveLayer(layerId);
        setSelection(hits);
      } else {
        setSelection(shift ? [...store.selection, ...hits] : hits);
      }
      return;
    }
    if (!shift) setSelection([]);
  }

  /** Handles a double-click; returns false to treat it as an ordinary click. */
  private doubleClick(doc: VwxDocument, hit: ObjectInfo | null): boolean {
    const { scene } = this.env;
    if (!hit) {
      if (!store.editGroupId) return false;
      exitEditGroup();
      return true;
    }
    if (this.openPlugin(doc, hit)) return true;
    // read-only symbol geometry is not edited in place; the press falls through to its instance
    if (hit.shape?.kind === "text" && !isDerivedId(hit.id)) {
      this.editText(hit);
      return true;
    }
    if (hit.layerId !== store.activeLayerId) return false;
    const unit = scene.unitOf(hit, store.editGroupId);
    const obj = unit ? doc.object(unit) : null;
    if (!unit || !obj) return false;
    // a sheet viewport opens its annotations, the one part of it Rodeo edits in place
    if (annotatableViewport(unit)) {
      editAnnotations(unit);
      return true;
    }
    if (obj.kind === "group") {
      const inner = scene.unitOf(hit, unit);
      setEditGroup(unit, inner ? [inner] : []);
      return true;
    }
    if (obj.kind === "symbol" && obj.symbol !== undefined) {
      editSymbol(obj.symbol);
      return true;
    }
    if (obj.worksheet !== undefined) {
      void editWorksheet(obj.worksheet);
      return true;
    }
    return false;
  }

  /** A double-click on an object with its own settings, whichever of its parts was hit. */
  private openPlugin(doc: VwxDocument, hit: ObjectInfo): boolean {
    const unit = hit.layerId === store.activeLayerId ? this.env.scene.unitOf(hit, store.editGroupId) : null;
    const plugin = unit ? doc.records(unit).find((r) => r.parametric)?.name : undefined;
    const open = plugin ? pluginDriver(plugin)?.open : undefined;
    if (!unit || !open) return false;
    open(unit);
    return true;
  }

  /** The grip of the single selected shape under `screen`, if any. */
  private gripAt(screen: Pt): Grip | null {
    if (store.selection.size !== 1) return null;
    const id = [...store.selection][0];
    const obj = this.env.scene.document?.object(id);
    if (!obj?.shape || isDerivedId(id)) return null;
    const geom = this.env.scene.geometry(obj);
    if (!geom) return null;
    let best: Grip | null = null;
    let bestD = GRIP_PICK_PX;
    // vertices win over edge midpoints at the same distance
    for (const [list, edge] of [[geom.handles, false], [geom.edges, true]] as const) {
      for (let index = 0; index < list.length; index++) {
        const d = dist(this.env.view.toScreen(list[index]), screen);
        if (d < bestD || (d === bestD && !edge)) {
          best = { obj, index, edge };
          bestD = d;
        }
      }
    }
    return best;
  }

  /** Outline of the shape being reshaped, in screen space. */
  private drawReshape(g: Painter): void {
    if (this.reshaped) drawReshaped(g, this.reshaped);
  }

  /** Opens the in-place editor for an existing text object. */
  private editText(obj: ObjectInfo): void {
    const shape = obj.shape;
    if (!shape || shape.kind !== "text") return;
    const bb = this.env.scene.geometry(obj)?.bbox ?? shape.bbox;
    if (!bb) return;
    const current = shape.text ?? "";
    const lines = Math.max(1, textLines(current).length);
    const id = obj.id;
    this.env.text.open({
      at: { x: bb.x0, y: bb.y1 },
      text: current,
      heightWorld: (bb.y1 - bb.y0) / lines,
      onCommit: (text) => {
        if (text !== current) attempt("Edit text", (s) => s.setText(id, text));
      },
    });
  }
}

/** The dashed outline of a shape being reshaped, `next` as it will be. */
export function drawReshaped(g: Painter, next: NewShape): void {
  let pts: Pt[];
  let closed = false;
  switch (next.kind) {
    case "line":
      pts = [next.a, next.b];
      break;
    case "rect":
      pts = [
        { x: next.x0, y: next.y0 },
        { x: next.x1, y: next.y0 },
        { x: next.x1, y: next.y1 },
        { x: next.x0, y: next.y1 },
      ];
      closed = true;
      break;
    case "polygon":
      pts = next.points;
      closed = next.closed;
      break;
    case "polyline":
      // a curved polyline previews its curve, not its vertices
      pts = next.vertices?.some((k) => k !== "corner") ? polylineOutline(next.points, next.vertices, next.closed) : next.points;
      closed = next.closed;
      break;
    case "arc":
      pts = ellipsePoints(next.center, next.radius, next.radius, next.startAngle, next.sweepAngle, ARC_PREVIEW_STEPS);
      break;
    default:
      return;
  }
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  pts.forEach((pt, i) => {
    const s = g.toScreen(pt);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.restore();
}
