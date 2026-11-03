// Canvas 2D renderer. World is y-up; the context transform maps it to device
// pixels. Stroke width is one CSS pixel (hairline) for objects, two for the
// selection. Handles and the tool overlay are drawn in CSS-pixel space.
// Objects off screen, and those too small to see at this zoom, are skipped
// before any drawing work (see scene.cullIndex()).

import { drawExtensionOverlays } from "./ext.ts";
import {
  type Affine,
  type BBox,
  type Clip,
  type DropShadow,
  type FillMapping,
  type GradientStop,
  type HatchFill,
  type LineMarkers,
  type ObjectInfo,
  type PageSize,
  type Pt,
  type Shape,
  type TileFill,
  type StyleOverride,
  type ViewportView,
  drawsPen,
  fillPatternBits,
  markerPaths,
  shadowOffset,
  withContainers,
} from "../core/index.ts";
import { prefs } from "./prefs.ts";
import { store } from "./state.ts";
import { hiddenVersion } from "./hiddenObjects.ts";
import type { Scene } from "./scene.ts";
import type { View } from "./view.ts";
import type { FillPreview, MoveDelta, Painter, ToolOverlay } from "./tools.ts";
import { gridStep } from "./snap.ts";
import { bboxOfPoints, unionBBox } from "./geom.ts";
import { buildGeom, fillsShape, outlineOf, type Geom } from "./shapes.ts";
import { FONT, paintText } from "./textPaint.ts";

/**
 * The selection's colour, its handles' and the tools' previews; with PRESELECT and SNAP_COLOR set by
 * Preferences > Appearance (appearance.ts). Live bindings: the tools read whatever is set now.
 */
export let ACCENT = "#2f6fdb";
/** the pre-selection highlight's colour */
let PRESELECT = ACCENT;
/** snap markers' colour (tools.ts) */
export let SNAP_COLOR = ACCENT;

/** Sets the interactive colours (Preferences > Appearance); the next frame draws with them. */
export function setInteractiveColors(c: { readonly selection: string; readonly preselect: string; readonly snap: string }): void {
  ACCENT = c.selection;
  PRESELECT = c.preselect;
  SNAP_COLOR = c.snap;
}
const PEN_DEFAULT = "#1d1d1f";
const PAPER = "#fcfcfb";
const GRID_MINOR = "rgba(60, 70, 90, 0.08)";
const GRID_MAJOR = "rgba(60, 70, 90, 0.18)";
const GRID_AXIS = "rgba(60, 70, 90, 0.32)";
/** a sheet layer's page boundary */
const PAGE_EDGE = "rgba(60, 70, 90, 0.45)";
/** minor steps per major line */
const GRID_MAJOR_EVERY = 5;
/** grid lines closer than this (CSS px) are not drawn */
const GRID_MIN_PX = 6;
const GRID_MAX_LINES = 4000;
const GHOST_ALPHA = 0.3;
/** how strongly the pre-selected object is outlined, against the selection's full accent */
const PRESELECT_ALPHA = 0.45;
/** grips are bigger under a finger (coarse pointers); read once, when the module loads */
const COARSE_POINTER = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
export const HANDLE_PX = COARSE_POINTER ? 12 : 7;
/** line markers are sized in paper inches; world units are mm */
const MM_PER_INCH = 25.4;
/** dash patterns shorter than this on screen are drawn solid */
const MIN_DASH_PERIOD_PX = 3;
/** objects whose bounds are under this many CSS px in both directions are not drawn */
const MIN_OBJECT_PX = 0.5;
/** text under this many CSS px tall is not drawn */
const MIN_TEXT_PX = 2;
/** a locus's cross reaches this many CSS px each way from its point */
const LOCUS_ARM_PX = 6;
/** a light object's ring, CSS px in radius, and how far a point light's rays and a spot's or directional light's aim reach */
export const LIGHT_RING_PX = 4;
const LIGHT_RAY_PX = [6, 9];
const LIGHT_AIM_PX = 14;
/** how much of its colour a light object that is off keeps */
const LIGHT_OFF_ALPHA = 0.45;
/**
 * a light object's mark is amber, whatever its pen (the fixtures' lights have white pens): it shows on
 * a white or a black background, apart from the drawing
 */
const LIGHT_INK = "#c47f00";
/** hatch lines packed closer than this (CSS px) are left out; the ground colour reads as the fill */
const MIN_HATCH_GAP_PX = 2;
/** most hatch segments drawn for one object in one frame */
const MAX_HATCH_SEGMENTS = 20000;
/** tiles whose repeat is under this many CSS px on screen, in either direction, are not drawn */
const MIN_TILE_PX = 3;
/** most tile repeats drawn for one object in one frame */
const MAX_TILE_CELLS = 4000;
/** bounds this far (CSS px) outside the canvas still count as visible, so a thick stroke at the edge does not pop in */
const CULL_MARGIN_PX = 24;
/** room around a shadow group's drawing for its line widths and antialiasing, device px */
const SHADOW_PAD_PX = 4;
/** a shadow group larger than this on the canvas (device px a side) casts none */
const SHADOW_MAX_PX = 8192;
const DRAW_START = "openvwx:draw:start";
const DRAW_MEASURE = "openvwx:draw";
/** a document pass slower than this (ms) is kept, and reused while only the view or the overlays change */
const KEEP_MS = 30;
/** how long (ms) the view rests before a moved or scaled kept picture is drawn afresh */
const SETTLE_MS = 200;
/** a kept picture is drawn afresh once the view zooms this far from it, either way */
const KEEP_MAX_ZOOM = 2;
/** ... or pans this fraction of the canvas away from it */
const KEEP_MAX_PAN = 0.5;

/** True when the box at boxes[k..k+3] (x0, y0, x1, y1), moved by (dx, dy), touches r. */
/** CSS colour for #rrggbb at an opacity from 0 to 1. */
function rgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}

/** The colour half way between two #rrggbb colours. */
function mixHex(a: string, b: string): string {
  const x = parseInt(a.slice(1), 16);
  const y = parseInt(b.slice(1), 16);
  const ch = (k: number) => Math.round((((x >> k) & 255) + ((y >> k) & 255)) / 2);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

/** FillMapping.shape of a radial gradient */
const RADIAL_GRADIENT = 2;

/** Puts a gradient resource's stops on a canvas gradient, an uneven midpoint as a stop of its own. */
export function addGradientStops(ramp: CanvasGradient, stops: readonly GradientStop[]): void {
  stops.forEach((stop, i) => {
    // canvas throws on an offset outside 0..1 or not a number, which would stop the frame
    if (!Number.isFinite(stop.at)) return;
    ramp.addColorStop(Math.min(1, Math.max(0, stop.at)), rgba(stop.color, stop.opacity));
    // an uneven midpoint: the half-way blend sits off centre in the gap
    const next = stops[i + 1];
    if (next && Math.abs(stop.midpoint - 0.5) > 0.01 && next.at > stop.at) {
      const at = stop.at + (next.at - stop.at) * Math.min(0.999, Math.max(0.001, stop.midpoint));
      ramp.addColorStop(at, rgba(mixHex(stop.color, next.color), (stop.opacity + next.opacity) / 2));
    }
  });
}

/**
 * Whether a fill mapping belongs where the shape is: its ramp has a length and starts within a few
 * shape sizes of it. Some files keep mappings left behind elsewhere, which would paint one colour.
 */
export function mappingFits(map: FillMapping, b: BBox): boolean {
  const size = Math.max(b.x1 - b.x0, b.y1 - b.y0);
  const len = Math.hypot(map.u.x - map.origin.x, map.u.y - map.origin.y);
  const gap = Math.max(b.x0 - map.origin.x, map.origin.x - b.x1, b.y0 - map.origin.y, map.origin.y - b.y1, 0);
  return len > 0 && Number.isFinite(len) && gap <= 2 * size;
}

function boxTouches(boxes: Float64Array, k: number, dx: number, dy: number, r: BBox): boolean {
  return boxes[k + 2] + dx >= r.x0 && boxes[k] + dx <= r.x1 && boxes[k + 3] + dy >= r.y0 && boxes[k + 1] + dy <= r.y1;
}

/** True when b, moved by (dx, dy), touches r. */
function touches(b: BBox, dx: number, dy: number, r: BBox): boolean {
  return b.x1 + dx >= r.x0 && b.x0 + dx <= r.x1 && b.y1 + dy >= r.y0 && b.y0 + dy <= r.y1;
}

/** True when an object drawn w x h CSS px is too small to see; text goes by its glyph height at px per unit. */
function tooSmall(shape: Shape, w: number, h: number, px: number): boolean {
  // a locus or light object is a point, drawn at a fixed screen size
  if (shape.kind === "locus" || shape.kind === "light") return false;
  if (w < MIN_OBJECT_PX && h < MIN_OBJECT_PX) return true;
  if (shape.kind !== "text") return false;
  // drawText sets the font size from textSize when the text is anchored; otherwise the bounds are the text
  const size = shape.textSize ?? 0;
  return (shape.anchor && size > 0 ? size * px : h) < MIN_TEXT_PX;
}

/** Narrows the clip to a viewport's crop: its box, then its crop object's outline when it has one. */
function clipTo(ctx: CanvasRenderingContext2D, clip: Clip): void {
  ctx.beginPath();
  ctx.rect(clip.x0, clip.y0, clip.x1 - clip.x0, clip.y1 - clip.y0);
  ctx.clip();
  const pts = clip.outline;
  if (!pts || pts.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
  ctx.clip();
}

/**
 * Where a hatch lies: hatch coordinates to the shape's, from the fill mapping's origin and the
 * directions of its axes (their length is not the hatch's size), `k` shape units per hatch unit.
 */
export function hatchFrame(map: FillMapping | undefined, k: number): Affine {
  if (map) {
    const ux = map.u.x - map.origin.x;
    const uy = map.u.y - map.origin.y;
    const vx = map.v.x - map.origin.x;
    const vy = map.v.y - map.origin.y;
    const lu = Math.hypot(ux, uy);
    const lv = Math.hypot(vx, vy);
    if (lu > 0 && lv > 0 && Math.abs(ux * vy - uy * vx) > 1e-6 * lu * lv) {
      return { a: (k * ux) / lu, b: (k * uy) / lu, c: (k * vx) / lv, d: (k * vy) / lv, e: map.origin.x, f: map.origin.y };
    }
  }
  return { a: k, b: 0, c: 0, d: k, e: 0, f: 0 };
}

/**
 * Where a tile lies: tile coordinates to the shape's. A fill mapping lays one repeat cell, the one
 * centred on the tile's origin, on the parallelogram from its origin along its two axes, the first
 * taking the tile's more nearly horizontal repeat. So, unlike a hatch's, its axes set the tile's
 * size: a batt's mapping spans the insulation's depth, and the published sections fit one loop
 * across it. Without one the tile lies from the origin at `k` shape units per tile unit.
 */
function tileFrame(map: FillMapping | undefined, tile: TileFill, k: number): Affine {
  if (map) {
    const [rx, ry] = Math.abs(tile.u.x) >= Math.abs(tile.v.x) ? [tile.u, tile.v] : [tile.v, tile.u];
    const U = { x: map.u.x - map.origin.x, y: map.u.y - map.origin.y };
    const V = { x: map.v.x - map.origin.x, y: map.v.y - map.origin.y };
    const det = rx.x * ry.y - ry.x * rx.y;
    const span = U.x * V.y - V.x * U.y;
    if (Math.abs(det) > 0 && Math.abs(span) > 1e-6 * Math.hypot(U.x, U.y) * Math.hypot(V.x, V.y)) {
      // the linear part takes rx to U and ry to V; the cell's corner, -(rx + ry) / 2, lands on the origin
      const a = (U.x * ry.y - V.x * rx.y) / det;
      const c = (V.x * rx.x - U.x * ry.x) / det;
      const b = (U.y * ry.y - V.y * rx.y) / det;
      const d = (V.y * rx.x - U.y * ry.x) / det;
      const hx = (rx.x + ry.x) / 2;
      const hy = (rx.y + ry.y) / 2;
      return { a, b, c, d, e: map.origin.x + a * hx + c * hy, f: map.origin.y + b * hx + d * hy };
    }
  }
  return { a: k, b: 0, c: 0, d: k, e: 0, f: 0 };
}

/** The bounds, in m's source coordinates, of what m maps into b; null when m is singular. */
function sourceBox(m: Affine, b: BBox): BBox | null {
  const det = m.a * m.d - m.b * m.c;
  if (!(Math.abs(det) > 0)) return null;
  const out: BBox = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) {
    const u = x - m.e;
    const v = y - m.f;
    const sx = (m.d * u - m.c * v) / det;
    const sy = (m.a * v - m.b * u) / det;
    out.x0 = Math.min(out.x0, sx);
    out.y0 = Math.min(out.y0, sy);
    out.x1 = Math.max(out.x1, sx);
    out.y1 = Math.max(out.y1, sy);
  }
  return out;
}

/**
 * A slow drawing's last document pass, drawn on its own canvas (device px, clear where nothing is
 * drawn), with the view it was drawn at and the key of everything else it was drawn from.
 */
interface Kept {
  readonly ctx: CanvasRenderingContext2D;
  readonly key: readonly unknown[];
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
}

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/** An object that is moving, with what the document pass worked out for drawing it; or a viewport that is. */
type Mover =
  | { readonly vp: ViewportView; readonly alpha: number }
  | {
      readonly obj: ObjectInfo;
      readonly shape: Shape;
      /** its layer's cull index, and where it is in it */
      readonly objects: readonly ObjectInfo[];
      readonly boxes: Float64Array;
      readonly i: number;
      readonly alpha: number;
      readonly layerScale: number;
      readonly styles?: ReadonlyMap<string, StyleOverride>;
    };

/**
 * While a slow drawing's selection is dragged: its still objects, drawn once on two canvases of their
 * own, those below the first moving object and those above it, and the moving objects, which each
 * frame draws between the two where the drag has taken them.
 */
interface Still {
  readonly below: Kept;
  readonly above: Kept;
  readonly movers: readonly Mover[];
}

/** How the document pass draws while a slow drawing's selection is dragged (see Still). */
interface Split {
  readonly above: CanvasRenderingContext2D;
  /** what the drag moves, as Scene.expand finds it: such objects are taken off screen as well */
  readonly moving: ReadonlySet<ObjectInfo>;
  readonly movers: Mover[];
}

export class Renderer {
  /** the canvas drawn on; a shadow group swaps in its offscreen one while it draws the group */
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private frame = 0;
  private drawMs = 0;
  /** CSS px per unit of what is being drawn: the zoom, times the viewport's scale inside one */
  private px = 1;
  /** the offscreen canvas shadows are drawn from */
  private shade: CanvasRenderingContext2D | null = null;
  /** the visible rectangle grown by the cull margin, in the coordinates of what is being drawn */
  private cull: BBox = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** the fill mapping a tool is dragging this frame */
  private fillDrag: FillPreview | null = null;
  /** 8 x 8 tiles of the bitmap fill patterns in use, by bits and colours */
  private readonly bitmaps = new Map<string, HTMLCanvasElement>();
  /** milliseconds the last document pass took */
  private docMs = 0;
  /** the last document pass of a slow drawing (KEEP_MS) */
  private kept: Kept | null = null;
  /** a slow drawing's still objects while its selection is dragged */
  private still: Still | null = null;
  /** the view of the last frame, to tell a moving view from one at rest */
  private shown = { cx: 0, cy: 0, scale: 0 };
  private settle = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly view: View,
    private readonly scene: Scene,
    private readonly overlay: ToolOverlay,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("openvwx: 2D canvas is not available");
    this.ctx = ctx;
    this.resize();
  }

  /** Re-reads the canvas size (CSS pixels) and backing store size (device pixels). */
  resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.view.setSize(w, h);
    this.requestDraw();
  }

  /**
   * Draws the scene onto the canvas now, `width` x `height` CSS px at `dpr` device px per CSS px,
   * without the editor's extension overlays. The timelapse export draws its frames this way, from
   * outside the editor's own frames; the scene and store are read as the editor reads them.
   */
  renderNow(width: number, height: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.view.setSize(width, height);
    this.paint(false, false);
  }

  requestDraw(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  /** Milliseconds the last frame took to draw, for checking speed on big drawings. */
  get lastDrawMs(): number {
    return this.drawMs;
  }

  private draw(): void {
    const t0 = performance.now();
    if (import.meta.env.DEV) performance.mark(DRAW_START);
    this.paint(true, true);
    this.drawMs = performance.now() - t0;
    if (import.meta.env.DEV) {
      // shows in DevTools' timeline; cleared at once so a long session does not grow the buffer
      performance.measure(DRAW_MEASURE, DRAW_START);
      performance.clearMarks(DRAW_START);
      performance.clearMeasures(DRAW_MEASURE);
    }
  }

  /** The visible world rectangle, grown by the cull margin. */
  private cullRect(): BBox {
    const r = this.view.visibleRect();
    const pad = CULL_MARGIN_PX / this.view.scale;
    return { x0: r.x0 - pad, y0: r.y0 - pad, x1: r.x1 + pad, y1: r.y1 + pad };
  }

  /**
   * `overlays` false leaves out the extension overlays (see renderNow); `keep` lets a slow
   * drawing's document pass be kept and reused (see documentPass).
   */
  private paint(overlays: boolean, keep: boolean): void {
    const { ctx, view, scene, dpr } = this;
    const W = view.width;
    const H = view.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    if (!scene.document) {
      this.kept = null;
      return;
    }

    this.drawGrid();

    const move = this.overlay.moveDelta();
    this.fillDrag = this.overlay.fillPreview();
    const s = view.scale;
    this.px = s;
    this.cull = this.cullRect();
    this.documentPass(move, keep);

    // document (x right, y up) -> device pixels (y down)
    ctx.setTransform(...view.matrix(dpr));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 1 / s;
    ctx.globalAlpha = 1;
    const selected = scene.expand(store.selection);
    this.drawSelection(selected, move);
    // what a click of the Selection tool would select, fainter (Preferences > Interactive)
    const pre = store.preselect;
    if (pre && store.tool === "select" && !store.selection.has(pre)) {
      this.drawSelection(scene.expand(new Set([pre])), null, PRESELECT_ALPHA, PRESELECT);
      ctx.globalAlpha = 1;
    }

    // screen-space pass: handles and the tool overlay
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1;
    const group = store.editGroupId;
    if (group) this.drawGroupFrame(group);
    this.drawHandles(selected, move);
    const painter: Painter = {
      ctx,
      width: W,
      height: H,
      scale: s,
      toScreen: (p) => view.toScreen(p),
    };
    this.overlay.drawOverlay(painter);
    if (overlays) drawExtensionOverlays(painter);
  }

  /**
   * Everything the document pass reads besides the view; a kept pass is reused only while it is the
   * same. `move` is the move drawn, or while a drag draws the still objects apart, what it moves.
   */
  private keptKey(move: MoveDelta | ReadonlySet<string> | null): unknown[] {
    return [
      this.scene.revision,
      store.activeLayerId,
      store.activeClassIndex,
      store.editGroupId,
      store.symbolEdit,
      store.layerMode,
      store.classMode,
      hiddenVersion(),
      store.zoomLineThickness,
      prefs().showOthersEditing,
      move,
      this.fillDrag,
      this.canvas.width,
      this.canvas.height,
      this.dpr,
      this.view.rotation,
    ];
  }

  /**
   * The document pass, which on a big drawing is most of a frame. A slow one (KEEP_MS) is drawn on
   * a canvas of its own and kept: while nothing it was drawn from changes, a frame for the tools'
   * overlays draws the kept picture instead, and while the view zooms or pans, so does each frame,
   * moved and scaled to the new view, until the view rests (SETTLE_MS) or goes too far from it.
   */
  private documentPass(move: MoveDelta | null, keep: boolean): void {
    const { view } = this;
    if (keep && move && this.docMs >= KEEP_MS) {
      this.dragPass(move);
      return;
    }
    // no drag: its pictures of the still objects go
    if (!move) this.still = null;
    const kept = this.kept;
    const key = this.keptKey(move);
    const same = keep && kept !== null && sameKey(kept.key, key);
    const moving = this.shown.cx !== view.cx || this.shown.cy !== view.cy || this.shown.scale !== view.scale;
    if (keep) this.shown = { cx: view.cx, cy: view.cy, scale: view.scale };
    if (same && kept.cx === view.cx && kept.cy === view.cy && kept.scale === view.scale) {
      this.drawKept(kept);
      return;
    }
    if (same && moving && this.near(kept)) {
      this.drawKept(kept);
      clearTimeout(this.settle);
      this.settle = window.setTimeout(() => {
        this.settle = 0;
        this.requestDraw();
      }, SETTLE_MS);
      return;
    }

    const t0 = performance.now();
    if (!keep || this.docMs < KEEP_MS) {
      this.kept = null;
      this.drawDocument(move);
    } else {
      const ctx = kept?.ctx ?? document.createElement("canvas").getContext("2d");
      if (!ctx) {
        this.drawDocument(move);
        return;
      }
      if (ctx.canvas.width !== this.canvas.width) ctx.canvas.width = this.canvas.width;
      if (ctx.canvas.height !== this.canvas.height) ctx.canvas.height = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      const main = this.ctx;
      this.ctx = ctx;
      try {
        this.drawDocument(move);
      } finally {
        this.ctx = main;
      }
      this.kept = { ctx, key, cx: view.cx, cy: view.cy, scale: view.scale };
      this.drawKept(this.kept);
    }
    this.docMs = performance.now() - t0;
  }

  /**
   * A frame of a slow drawing's drag: the still objects as drawn when it started (or last changed),
   * and the moving ones between them, where the drag has taken them.
   */
  private dragPass(move: MoveDelta): void {
    const { view } = this;
    this.shown = { cx: view.cx, cy: view.cy, scale: view.scale };
    const key = this.keptKey(move.ids);
    const at = (k: Kept) => sameKey(k.key, key) && k.cx === view.cx && k.cy === view.cy && k.scale === view.scale;
    if (!this.still || !at(this.still.below)) this.still = this.drawStill(move, key);
    const still = this.still;
    if (!still) {
      this.drawDocument(move);
      return;
    }
    this.drawKept(still.below);
    this.drawMovers(still.movers, move);
    this.drawKept(still.above);
  }

  /** Draws the still objects of a drag apart (see Still); null when no canvas can be had for them. */
  private drawStill(move: MoveDelta, key: readonly unknown[]): Still | null {
    const { view } = this;
    const fresh = (): CanvasRenderingContext2D | null => document.createElement("canvas").getContext("2d");
    const below = this.still?.below.ctx ?? fresh();
    const above = this.still?.above.ctx ?? fresh();
    if (!below || !above) return null;
    for (const ctx of [below, above]) {
      if (ctx.canvas.width !== this.canvas.width) ctx.canvas.width = this.canvas.width;
      if (ctx.canvas.height !== this.canvas.height) ctx.canvas.height = this.canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    const split: Split = { above, moving: new Set(this.scene.expand(move.ids).map((s) => s.obj)), movers: [] };
    const main = this.ctx;
    this.ctx = below;
    try {
      this.drawDocument(move, split);
    } finally {
      this.ctx = main;
    }
    const pictured = { key, cx: view.cx, cy: view.cy, scale: view.scale };
    return { below: { ctx: below, ...pictured }, above: { ctx: above, ...pictured }, movers: split.movers };
  }

  /** Draws the moving objects of a drag (see Still) where it has taken them, as the document pass would. */
  private drawMovers(movers: readonly Mover[], move: MoveDelta): void {
    const { ctx } = this;
    this.toDocument(ctx);
    let clip: Clip | undefined;
    const setClip = (next: Clip | undefined): void => {
      if (next === clip) return;
      if (clip) ctx.restore();
      clip = next;
      if (!clip) return;
      ctx.save();
      clipTo(ctx, clip);
    };
    const shadows = new Set<DropShadow>();
    for (const m of movers) {
      if ("vp" in m) {
        setClip(undefined);
        this.drawViewport(m.vp, m.alpha, move);
        continue;
      }
      if (!boxTouches(m.boxes, 4 * m.i, move.dx, move.dy, this.cull)) continue;
      setClip(m.obj.clip);
      ctx.globalAlpha = m.alpha;
      if (m.obj.shadow && !shadows.has(m.obj.shadow)) {
        shadows.add(m.obj.shadow);
        this.drawShadow(m.objects, m.i, move, m.layerScale, m.styles);
      }
      this.drawObject(m.obj, m.shape, move, m.layerScale, m.styles?.get(m.obj.id));
    }
    setClip(undefined);
    ctx.globalAlpha = 1;
  }

  /** Sets `ctx` to draw in document coordinates (x right, y up) in the current view, with hairline strokes. */
  private toDocument(ctx: CanvasRenderingContext2D): void {
    const { view, dpr } = this;
    const s = view.scale;
    ctx.setTransform(...view.matrix(dpr));
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.lineWidth = 1 / s;
  }

  /** Whether the view is still near enough the kept picture's for the picture to stand in for it. */
  private near(kept: Kept): boolean {
    const { view } = this;
    const k = view.scale / kept.scale;
    if (k > KEEP_MAX_ZOOM || k < 1 / KEEP_MAX_ZOOM) return false;
    // how far the kept picture's centre has moved on screen
    const d = view.screenDelta(kept.cx - view.cx, kept.cy - view.cy);
    return Math.abs(d.x) <= view.width * KEEP_MAX_PAN && Math.abs(d.y) <= view.height * KEEP_MAX_PAN;
  }

  /** Draws the kept picture where its contents fall in the current view. */
  private drawKept(kept: Kept): void {
    const { ctx, view, dpr } = this;
    const k = view.scale / kept.scale;
    const d = view.screenDelta(kept.cx - view.cx, kept.cy - view.cy);
    const ex = dpr * ((view.width / 2) * (1 - k) + d.x);
    const ey = dpr * ((view.height / 2) * (1 - k) + d.y);
    ctx.setTransform(k, 0, 0, k, ex, ey);
    ctx.globalAlpha = 1;
    ctx.drawImage(kept.ctx.canvas, 0, 0);
  }

  /**
   * Draws the visible objects of the drawn layers, in the document's order. With `split` it draws
   * the still ones only, those after the first moving one on `split.above`, and lists the moving ones.
   */
  private drawDocument(move: MoveDelta | null, split?: Split): void {
    const { view, scene } = this;
    const active = store.activeLayerId;
    const s = view.scale;
    // document (x right, y up) -> device pixels (y down)
    this.toDocument(this.ctx);

    // while editing inside a group, everything outside it is drawn grayed, or not at all
    const group = store.editGroupId;
    const othersHidden = group !== null && !prefs().showOthersEditing;
    const groupIds: ReadonlySet<string> = new Set(group ? [group] : []);
    const cull = this.cull;
    // a moved object can sit this far from its stored bounds, so the first, cheap test allows for it
    const reach = move ? Math.max(Math.abs(move.dx), Math.abs(move.dy)) : 0;
    const grown: BBox = { x0: cull.x0 - reach, y0: cull.y0 - reach, x1: cull.x1 + reach, y1: cull.y1 + reach };
    // viewport contents are cropped to the viewport's crop; consecutive objects share one clip
    let clip: Clip | undefined;
    const setClip = (next: Clip | undefined): void => {
      if (next === clip) return;
      if (clip) this.ctx.restore();
      clip = next;
      if (!clip) return;
      this.ctx.save();
      clipTo(this.ctx, clip);
    };
    // a moving object goes on the list, and the still ones after the first go above it
    const moves = (m: Mover): void => {
      if (!split) return;
      split.movers.push(m);
      if (this.ctx === split.above) return;
      setClip(undefined);
      this.ctx = split.above;
      this.toDocument(this.ctx);
    };
    // each shadow is drawn once, before the first of the objects that cast it
    const shadows = new Set<DropShadow>();
    const layers = scene.drawnLayers(active);
    const sheet = layers.find((l) => l.id === active);
    if (sheet?.kind === "sheet" && sheet.page) this.drawPage(sheet.page);
    // a viewport's annotations being edited: what the viewport shows, under them
    const annotating = store.symbolEdit;
    if (annotating?.viewport) this.drawAnnotated(annotating.viewport, annotating.from.layerId, annotating.layer.scale);
    for (const layer of layers) {
      const layerAlpha = scene.layerOpacity(layer, active);
      const layerScale = layer.kind === "design" ? layer.scale : 1;
      // a sheet's plan viewports and a design layer's design-layer viewports draw the layers they
      // show under the layer's own objects
      setClip(undefined);
      for (const vp of othersHidden ? [] : scene.viewports(layer.id)) {
        const obj = split && move && scene.document?.object(vp.id);
        if (obj && scene.within(obj, move.ids)) moves({ vp, alpha: layerAlpha });
        else this.drawViewport(vp, layerAlpha, move);
      }
      // what the other viewports draw from their caches is restyled by their data visualisations
      const styles = layer.kind === "sheet" ? (scene.viewportStyles(layer.id) ?? undefined) : undefined;
      const { objects, boxes } = scene.cullIndex(layer.id);
      for (let i = 0; i < objects.length; i++) {
        const k = 4 * i;
        const obj = objects[i];
        // a drag lists every object it moves, which it can take anywhere
        if (!boxTouches(boxes, k, 0, 0, grown) && !split?.moving.has(obj)) continue;
        const shape = obj.shape;
        if (!shape) {
          if (obj.planLines) {
            const cls = scene.objectVisibility(obj);
            const outside = group !== null && !scene.within(obj, groupIds);
            const off = move && scene.within(obj, move.ids) ? move : null;
            if (cls !== "hidden" && !(outside && othersHidden) && !(split && off) && boxTouches(boxes, k, off?.dx ?? 0, off?.dy ?? 0, cull)) {
              setClip(obj.clip);
              this.ctx.globalAlpha = layerAlpha * (cls === "grayed" ? GHOST_ALPHA : 1) * (outside ? GHOST_ALPHA : 1);
              this.drawPlanLines(obj, obj.planLines, off, layerScale);
            }
          }
          continue;
        }
        // too small to see at this zoom; judged on the stored bounds, which a move does not change
        if (tooSmall(shape, (boxes[k + 2] - boxes[k]) * s, (boxes[k + 3] - boxes[k + 1]) * s, s)) continue;
        const cls = scene.objectVisibility(obj);
        if (cls === "hidden") continue;
        const outside = group !== null && !scene.within(obj, groupIds);
        if (outside && othersHidden) continue;
        const off = move && scene.within(obj, move.ids) ? move : null;
        if (split && off) {
          const alpha = layerAlpha * (cls === "grayed" ? GHOST_ALPHA : 1) * (outside ? GHOST_ALPHA : 1);
          moves({ obj, shape, objects, boxes, i, alpha, layerScale, styles });
          continue;
        }
        if (!boxTouches(boxes, k, off?.dx ?? 0, off?.dy ?? 0, cull)) continue;
        setClip(obj.clip);
        this.ctx.globalAlpha = layerAlpha * (cls === "grayed" ? GHOST_ALPHA : 1) * (outside ? GHOST_ALPHA : 1);
        if (obj.shadow && !shadows.has(obj.shadow)) {
          shadows.add(obj.shadow);
          this.drawShadow(objects, i, off, layerScale, styles);
        }
        this.drawObject(obj, shape, off, layerScale, styles?.get(obj.id));
      }
    }
    setClip(undefined);
    this.ctx.globalAlpha = 1;
  }

  /** The lines Top/Plan draws of a mesh, which has no shape, in its pen. */
  private drawPlanLines(obj: ObjectInfo, lines: readonly Pt[], off: MoveDelta | null, layerScale: number): void {
    const { ctx } = this;
    const attrs = obj.attrs;
    if (!drawsPen(attrs)) return;
    const alpha = ctx.globalAlpha;
    if (attrs) ctx.globalAlpha = alpha * Math.min(1, attrs.penOpacity / 100);
    ctx.strokeStyle = attrs ? this.scene.color(attrs.penFore) : PEN_DEFAULT;
    const weightPx = attrs ? Math.max(1, attrs.lineWeight * 0.072) : 1;
    ctx.lineWidth = attrs && store.zoomLineThickness ? Math.max(1 / this.px, attrs.lineWeight * 0.0254 * layerScale) : weightPx / this.px;
    const [dx, dy] = [off?.dx ?? 0, off?.dy ?? 0];
    ctx.beginPath();
    for (let i = 0; i + 1 < lines.length; i += 2) {
      ctx.moveTo(lines[i].x + dx, lines[i].y + dy);
      ctx.lineTo(lines[i + 1].x + dx, lines[i + 1].y + dy);
    }
    ctx.stroke();
    ctx.lineWidth = 1 / this.px;
    ctx.globalAlpha = alpha;
  }

  /** `style` is what a viewport's data visualisations change about how the object draws. */
  private drawObject(obj: ObjectInfo, shape: Shape, off: MoveDelta | null, layerScale: number, style?: StyleOverride): void {
    const { ctx } = this;
    const geom = this.scene.geometry(obj);
    if (!geom) return;
    const dx = off?.dx ?? 0;
    const dy = off?.dy ?? 0;
    const moved = dx !== 0 || dy !== 0;
    if (moved) {
      ctx.save();
      ctx.translate(dx, dy);
    }
    const attrs =
      obj.attrs && style
        ? { ...obj.attrs, fillPattern: style.fillPattern ?? obj.attrs.fillPattern, lineStyle: style.lineStyle ?? obj.attrs.lineStyle }
        : obj.attrs;
    const pen = style?.pen ?? (attrs ? this.scene.color(attrs.penFore) : PEN_DEFAULT);
    if (shape.kind === "text") {
      this.drawText(shape, geom, pen);
    } else if (shape.kind === "image") {
      this.drawImage(obj, shape, geom);
    } else if (shape.kind === "locus") {
      this.drawLocus(shape.points[0], pen);
    } else if (shape.kind === "light") {
      this.drawLight(shape);
    } else if (geom.path) {
      // opacities multiply into whatever alpha the layer/class already set (grayed)
      const alpha = ctx.globalAlpha;
      if (attrs && attrs.fillPattern !== 0 && fillsShape(shape) && !obj.wireframe && attrs.fillOpacity > 0) {
        // solid fills paint the fill background colour and tiles draw over it; hatches paint
        // their own ground and lines, and gradients replace the fill with a colour ramp
        ctx.globalAlpha = alpha * Math.min(1, attrs.fillOpacity / 100);
        const hatch = this.scene.hatch(attrs.fillPattern);
        const fillMap = this.fillDrag?.id === obj.id ? this.fillDrag.map : obj.fillMap;
        const back = style?.fillBack ?? this.scene.color(attrs.fillBack);
        const bits = attrs.fillPattern > 1 ? fillPatternBits(attrs.fillPattern) : null;
        ctx.fillStyle =
          this.gradientFill(geom, attrs.fillPattern, fillMap) ??
          (hatch
            ? this.scene.color(hatch.background)
            : bits
              ? this.bitmapFill(bits, style?.fillFore ?? this.scene.color(attrs.fillFore), back)
              : back);
        // a bitmap's pixels stay crisp
        ctx.imageSmoothingEnabled = !bits;
        ctx.fill(geom.path);
        ctx.imageSmoothingEnabled = true;
        // world-sized patterns shrink with whatever placed the object (a viewport's drawing does);
        // a page-sized hatch keeps its size on the sheet, so the layer's scale enlarges it
        const k = obj.patternScale ?? 1;
        if (hatch) this.drawHatch(geom, hatch, fillMap, dx, dy, hatch.page ? layerScale : k);
        const tile = this.scene.tile(attrs.fillPattern);
        if (tile) this.drawTile(geom, tile, fillMap, pen, dx, dy, k);
      }
      if (attrs) ctx.globalAlpha = alpha * Math.min(1, attrs.penOpacity / 100);
      ctx.strokeStyle = pen;
      // line weight as paper size: mils x 0.0254 mm x 72 px/in / 25.4 mm/in = CSS px at 72 dpi,
      // whatever the zoom; with Zoom Line Thickness, mils x 0.0254 mm on paper, so the layer's (or
      // viewport's) scale makes it drawing units and zoom thickens it. Thinner than a hairline draws as one.
      const weightPx = attrs ? Math.max(1, attrs.lineWeight * 0.072) : 1;
      ctx.lineWidth = attrs && store.zoomLineThickness ? Math.max(1 / this.px, attrs.lineWeight * 0.0254 * layerScale) : weightPx / this.px;
      const dash = attrs ? this.visibleDash(attrs.lineStyle, layerScale) : null;
      if (dash) ctx.setLineDash(dash);
      const outlined = drawsPen(attrs);
      if (geom.stroke && outlined) ctx.stroke(geom.stroke);
      if (dash) ctx.setLineDash([]);
      if (obj.markers && outlined) this.drawMarkers(shape, obj.markers, pen, layerScale);
      ctx.lineWidth = 1 / this.px;
      ctx.globalAlpha = alpha;
    }
    if (moved) ctx.restore();
  }

  /**
   * The shadow of the objects that cast `objects[i].shadow` (a container's drawing shares its
   * container's), drawn once under all of them so overlapping parts don't darken it twice. They
   * are drawn into an offscreen canvas, and that canvas is drawn far off the visible one with its
   * canvas shadow moved back on, so only the blurred shadow lands. Canvas shadows are measured in
   * device pixels whatever the transform, so the paper-sized offset and blur go through the
   * current one (a viewport's too).
   */
  private drawShadow(
    objects: readonly ObjectInfo[],
    i: number,
    off: MoveDelta | null,
    layerScale: number,
    styles?: ReadonlyMap<string, StyleOverride>,
  ): void {
    const s = objects[i].shadow;
    if (!s) return;
    let first = i;
    while (first > 0 && objects[first - 1].shadow === s) first--;
    let end = i + 1;
    while (end < objects.length && objects[end].shadow === s) end++;
    const main = this.ctx;
    const t = main.getTransform();
    const k = MM_PER_INCH * layerScale;
    const v = shadowOffset(s, k);
    const ox = t.a * v.x + t.c * v.y;
    const oy = t.b * v.x + t.d * v.y;
    const blur = s.blur * k * Math.hypot(t.a, t.b);
    // the members' bounds on the canvas, as far beyond its edges as a shadow could reach into it
    const dx = off?.dx ?? 0;
    const dy = off?.dy ?? 0;
    let box: BBox | null = null;
    for (let j = first; j < end; j++) {
      const b = this.scene.geometry(objects[j])?.bbox;
      if (!b) continue;
      for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) {
        const px = t.a * (x + dx) + t.c * (y + dy) + t.e;
        const py = t.b * (x + dx) + t.d * (y + dy) + t.f;
        box = box
          ? { x0: Math.min(box.x0, px), y0: Math.min(box.y0, py), x1: Math.max(box.x1, px), y1: Math.max(box.y1, py) }
          : { x0: px, y0: py, x1: px, y1: py };
      }
    }
    if (!box) return;
    const reach = Math.hypot(ox, oy) + 3 * blur + SHADOW_PAD_PX;
    const W = main.canvas.width;
    const H = main.canvas.height;
    const x0 = Math.floor(Math.max(box.x0 - SHADOW_PAD_PX, -reach));
    const y0 = Math.floor(Math.max(box.y0 - SHADOW_PAD_PX, -reach));
    const x1 = Math.ceil(Math.min(box.x1 + SHADOW_PAD_PX, W + reach));
    const y1 = Math.ceil(Math.min(box.y1 + SHADOW_PAD_PX, H + reach));
    const w = x1 - x0;
    const h = y1 - y0;
    if (w <= 0 || h <= 0 || w > SHADOW_MAX_PX || h > SHADOW_MAX_PX) return;
    const shade = this.shadowCanvas();
    if (!shade) return;
    if (shade.canvas.width < w) shade.canvas.width = w;
    if (shade.canvas.height < h) shade.canvas.height = h;
    shade.setTransform(1, 0, 0, 1, 0, 0);
    shade.clearRect(0, 0, w, h);
    shade.setTransform(t.a, t.b, t.c, t.d, t.e - x0, t.f - y0);
    shade.lineJoin = "round";
    shade.lineCap = "round";
    shade.globalAlpha = 1;
    this.ctx = shade;
    try {
      for (let j = first; j < end; j++) {
        const o = objects[j];
        if (o.shape) this.drawObject(o, o.shape, off, layerScale, styles?.get(o.id));
      }
    } finally {
      this.ctx = main;
    }
    // drawn this far to the right, the members' copy misses the canvas; its shadow comes back
    const away = W + w + SHADOW_PAD_PX;
    main.save();
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.shadowColor = rgba(this.scene.color(s.color), s.opacity / 100);
    main.shadowBlur = blur;
    main.shadowOffsetX = ox - away;
    main.shadowOffsetY = oy;
    main.drawImage(shade.canvas, 0, 0, w, h, x0 + away, y0, w, h);
    main.restore();
  }

  private shadowCanvas(): CanvasRenderingContext2D | null {
    if (!this.shade) this.shade = document.createElement("canvas").getContext("2d");
    return this.shade;
  }

  /**
   * An object's line markers in its pen colour, at the alpha and line width its outline was just
   * stroked with: arrows and dots filled, slashes stroked solid. They are paper sized, so the
   * layer's scale (a plan viewport's, inside one) sets their size, as it does dash lengths.
   */
  private drawMarkers(shape: Shape, markers: LineMarkers, pen: string, layerScale: number): void {
    const paths = markerPaths(shape, markers, MM_PER_INCH * layerScale);
    if (paths.length === 0) return;
    const fills = new Path2D();
    const strokes = new Path2D();
    for (const p of paths) {
      if (p.kind === "polygon") {
        p.points.forEach((q, i) => (i === 0 ? fills.moveTo(q.x, q.y) : fills.lineTo(q.x, q.y)));
        fills.closePath();
      } else if (p.kind === "circle") {
        fills.moveTo(p.center.x + p.r, p.center.y);
        fills.arc(p.center.x, p.center.y, p.r, 0, 2 * Math.PI);
      } else {
        strokes.moveTo(p.a.x, p.a.y);
        strokes.lineTo(p.b.x, p.b.y);
      }
    }
    const { ctx } = this;
    ctx.fillStyle = pen;
    ctx.fill(fills);
    ctx.stroke(strokes);
  }

  /**
   * Under a viewport's open annotations, in their coordinates (the sheet's times the viewport's
   * scale `k`): what the viewport shows, its plan drawing live and what it caches, cropped as on
   * the sheet; and the rest of the sheet grayed when other objects show in editing modes. None of
   * it is picked or edited.
   */
  private drawAnnotated(viewportId: string, sheetId: string | null, k: number): void {
    const { ctx, scene } = this;
    if (!sheetId || !(k > 0)) return;
    const scaled = (b: Clip): Clip => ({
      x0: b.x0 * k,
      y0: b.y0 * k,
      x1: b.x1 * k,
      y1: b.y1 * k,
      ...(b.outline ? { outline: b.outline.map((p) => ({ x: p.x * k, y: p.y * k })) } : {}),
    });
    const live = scene.viewports(sheetId).find((v) => v.id === viewportId);
    if (live) {
      const { a, b, c, d, e, f } = live.m;
      this.drawViewport({ ...live, m: { a: a * k, b: b * k, c: c * k, d: d * k, e: e * k, f: f * k }, clip: scaled(live.clip) }, 1, null);
    }
    // the sheet's objects, placed by k: the viewport's cached drawing, and the rest when it shows
    const others = prefs().showOthersEditing;
    const outer = { px: this.px, cull: this.cull };
    const cull: BBox = { x0: outer.cull.x0 / k, y0: outer.cull.y0 / k, x1: outer.cull.x1 / k, y1: outer.cull.y1 / k };
    const px = outer.px * k;
    this.px = px;
    this.cull = cull;
    ctx.save();
    ctx.scale(k, k);
    let clip: Clip | undefined;
    const setClip = (next: Clip | undefined): void => {
      if (next === clip) return;
      if (clip) ctx.restore();
      clip = next;
      if (!clip) return;
      ctx.save();
      clipTo(ctx, clip);
    };
    const own = new Set([viewportId]);
    const { objects, boxes } = scene.cullIndex(sheetId);
    for (let i = 0; i < objects.length; i++) {
      const o = objects[i];
      const shape = o.shape;
      const k4 = 4 * i;
      if (!shape || o.id === viewportId || !boxTouches(boxes, k4, 0, 0, cull)) continue;
      const mine = scene.within(o, own);
      if (!mine && !others) continue;
      if (tooSmall(shape, (boxes[k4 + 2] - boxes[k4]) * px, (boxes[k4 + 3] - boxes[k4 + 1]) * px, px)) continue;
      const cls = scene.objectVisibility(o);
      if (cls === "hidden") continue;
      setClip(o.clip);
      ctx.globalAlpha = (cls === "grayed" ? GHOST_ALPHA : 1) * (mine ? 1 : GHOST_ALPHA);
      this.drawObject(o, shape, null, 1, undefined);
    }
    setClip(undefined);
    ctx.restore();
    this.px = outer.px;
    this.cull = outer.cull;
  }

  /**
   * What a plan viewport shows of its design layers, drawn live through its placement, cropped to
   * its box, with the class visibility it sets. Its annotations are sheet objects and draw with the
   * rest of the sheet. A design-layer viewport draws the same way, uncropped, unless its own class
   * hides it. `alpha` is the layer's; a viewport being moved takes its drawing along.
   */
  private drawViewport(vp: ViewportView, alpha: number, move: MoveDelta | null): void {
    const { ctx, scene } = this;
    const obj = scene.document?.object(vp.id);
    const own = vp.uncropped && obj ? scene.objectVisibility(obj) : "visible";
    if (own === "hidden") return;
    const off = move && obj && scene.within(obj, move.ids) ? move : null;
    const dx = off?.dx ?? 0;
    const dy = off?.dy ?? 0;
    // the part of the box on screen, on the sheet before the move, then in design-layer coordinates
    const sheet = this.cull;
    const box = vp.uncropped ? sheet : vp.clip;
    const shown: BBox = {
      x0: Math.max(box.x0, sheet.x0 - dx),
      y0: Math.max(box.y0, sheet.y0 - dy),
      x1: Math.min(box.x1, sheet.x1 - dx),
      y1: Math.min(box.y1, sheet.y1 - dy),
    };
    if (shown.x0 >= shown.x1 || shown.y0 >= shown.y1) return;
    const cull = sourceBox(vp.m, shown);
    if (!cull) return;
    const px = this.px * Math.hypot(vp.m.a, vp.m.b);
    const outer = { px: this.px, cull: this.cull };
    ctx.save();
    ctx.translate(dx, dy);
    if (!vp.uncropped) clipTo(ctx, vp.clip);
    ctx.transform(vp.m.a, vp.m.b, vp.m.c, vp.m.d, vp.m.e, vp.m.f);
    const shadows = new Set<DropShadow>();
    for (const layer of vp.layers) {
      if (layer.visibility === "hidden") continue;
      const layerAlpha = alpha * (layer.visibility === "grayed" || own === "grayed" ? GHOST_ALPHA : 1);
      // a layer a design-layer viewport on one of the viewport's layers shows: placed by it, in its classes
      const via = layer.via;
      const classes = via?.classes ?? vp.classes;
      const lcull = via ? sourceBox(via.m, cull) : cull;
      if (!lcull) continue;
      const lpx = via ? px * Math.hypot(via.m.a, via.m.b) : px;
      if (via) {
        ctx.save();
        ctx.transform(via.m.a, via.m.b, via.m.c, via.m.d, via.m.e, via.m.f);
      }
      this.px = lpx;
      this.cull = lcull;
      const { objects, boxes } = scene.cullIndex(layer.id);
      for (let i = 0; i < objects.length; i++) {
        const k = 4 * i;
        if (!boxTouches(boxes, k, 0, 0, lcull)) continue;
        const o = objects[i];
        const shape = o.shape;
        // loci are construction points and light objects are lit, not drawn: viewports don't show them,
        // nor hidden objects
        if (!shape || shape.kind === "locus" || shape.kind === "light" || scene.isHidden(o)) continue;
        if (tooSmall(shape, (boxes[k + 2] - boxes[k]) * lpx, (boxes[k + 3] - boxes[k + 1]) * lpx, lpx)) continue;
        const own = classes.get(o.classIndex) ?? scene.classVisibility(o.classIndex);
        const cls = withContainers(own, o, (i) => classes.get(i) ?? scene.ownClassVisibility(i));
        if (cls === "hidden") continue;
        ctx.globalAlpha = layerAlpha * (cls === "grayed" ? GHOST_ALPHA : 1);
        if (o.shadow && !shadows.has(o.shadow)) {
          shadows.add(o.shadow);
          this.drawShadow(objects, i, null, vp.scale, vp.styles);
        }
        // the viewport's scale sets line-type dash lengths, as a design layer's own scale does
        this.drawObject(o, shape, null, vp.scale, vp.styles?.get(o.id));
      }
      if (via) ctx.restore();
    }
    this.px = outer.px;
    this.cull = outer.cull;
    ctx.restore();
  }

  /**
   * A bitmap fill pattern in its two colours, one bit to a CSS pixel at any zoom, as Vectorworks
   * draws them on screen.
   */
  private bitmapFill(bits: readonly number[], fore: string, back: string): CanvasPattern | string {
    const key = `${bits.join(",")} ${fore} ${back}`;
    let tile = this.bitmaps.get(key);
    if (!tile) {
      tile = document.createElement("canvas");
      tile.width = tile.height = 8;
      const t = tile.getContext("2d");
      if (!t) return back;
      t.fillStyle = back;
      t.fillRect(0, 0, 8, 8);
      t.fillStyle = fore;
      for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) if ((bits[row] >> (7 - col)) & 1) t.fillRect(col, row, 1, 1);
      }
      this.bitmaps.set(key, tile);
    }
    const pattern = this.ctx.createPattern(tile, "repeat");
    if (!pattern) return back;
    // undo the drawing's transform, then one bit to a CSS pixel
    pattern.setTransform(this.ctx.getTransform().inverse().scale(this.dpr));
    return pattern;
  }

  /**
   * A hatch's lines over a filled shape, clipped to it, each family in its own colour. The hatch
   * is laid from the object's fill mapping (its origin and the directions of its axes) at `k`
   * times its own size. Only the part of the shape on screen gets lines, and families packed
   * closer than a few pixels at this zoom are left out, as their ground colour already reads as
   * the fill. `dx`, `dy` is the move the object is drawn with.
   */
  private drawHatch(geom: Geom, hatch: HatchFill, map: FillMapping | undefined, dx: number, dy: number, k: number): void {
    const b = geom.bbox;
    if (!b || !geom.path) return;
    // the visible part of the shape, in the shape's own coordinates, then in the hatch's
    const view = this.cull;
    const visible: BBox = {
      x0: Math.max(b.x0, view.x0 - dx),
      y0: Math.max(b.y0, view.y0 - dy),
      x1: Math.min(b.x1, view.x1 - dx),
      y1: Math.min(b.y1, view.y1 - dy),
    };
    if (visible.x0 >= visible.x1 || visible.y0 >= visible.y1) return;
    const frame = hatchFrame(map && mappingFits(map, b) ? map : undefined, k);
    const box = sourceBox(frame, visible);
    if (!box) return;
    const corners = [box.x0, box.y0, box.x1, box.y0, box.x1, box.y1, box.x0, box.y1];
    // CSS px per hatch unit
    const s = this.px * k;
    const paths = new Map<number, Path2D>();
    let segs = 0;
    for (const h of hatch.lines) {
      const len = Math.hypot(h.period.x, h.period.y);
      if (!(len > 0)) continue;
      const ux = h.period.x / len;
      const uy = h.period.y / len;
      // spacing between neighbouring lines, across them
      const gap = h.offset.y * ux - h.offset.x * uy;
      if (Math.abs(gap) * s < MIN_HATCH_GAP_PX) continue;
      // lines j whose across-coordinate falls inside the visible box
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 8; i += 2) {
        const v = ((corners[i + 1] - h.base.y) * ux - (corners[i] - h.base.x) * uy) / gap;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      let path = paths.get(h.color);
      if (!path) paths.set(h.color, (path = new Path2D()));
      const on = h.dash * len;
      for (let j = Math.ceil(lo); j <= hi && segs < MAX_HATCH_SEGMENTS; j++) {
        const px = h.base.x + j * h.offset.x;
        const py = h.base.y + j * h.offset.y;
        let t0 = Infinity;
        let t1 = -Infinity;
        for (let i = 0; i < 8; i += 2) {
          const t = (corners[i] - px) * ux + (corners[i + 1] - py) * uy;
          t0 = Math.min(t0, t);
          t1 = Math.max(t1, t);
        }
        if (h.dash >= 1) {
          path.moveTo(px + t0 * ux, py + t0 * uy);
          path.lineTo(px + t1 * ux, py + t1 * uy);
          segs++;
          continue;
        }
        if (on <= 0) continue;
        for (let n = Math.floor(t0 / len); n * len <= t1 && segs < MAX_HATCH_SEGMENTS; n++) {
          const a = Math.max(t0, n * len);
          const e = Math.min(t1, n * len + on);
          if (e <= a) continue;
          path.moveTo(px + a * ux, py + a * uy);
          path.lineTo(px + e * ux, py + e * uy);
          segs++;
        }
      }
    }
    if (segs === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.clip(geom.path);
    ctx.transform(frame.a, frame.b, frame.c, frame.d, frame.e, frame.f);
    ctx.lineWidth = 1 / s;
    // a stipple's dashes are specks a fraction of a pixel long; round caps would blot each into a dot
    ctx.lineCap = "butt";
    for (const [color, path] of paths) {
      ctx.strokeStyle = this.scene.color(color);
      ctx.stroke(path);
    }
    ctx.restore();
  }

  /**
   * Colour ramp for a gradient fill, laid as the object's mapping says: from its origin to its
   * u point, or around the origin out to u for a radial one. Without a usable mapping the stops
   * run left to right across the shape's bounds at mid height. Null when the pattern is not a
   * gradient with stops, so the ground colour shows.
   */
  private gradientFill(geom: Geom, fillPattern: number, map: FillMapping | undefined): CanvasGradient | null {
    const stops = this.scene.gradient(fillPattern);
    const b = geom.bbox;
    if (!stops || stops.length === 0 || !b) return null;
    let ramp: CanvasGradient;
    if (map && mappingFits(map, b)) {
      const { origin: o, u } = map;
      ramp =
        map.shape === RADIAL_GRADIENT
          ? this.ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Math.hypot(u.x - o.x, u.y - o.y))
          : this.ctx.createLinearGradient(o.x, o.y, u.x, u.y);
    } else {
      const y = (b.y0 + b.y1) / 2;
      ramp = this.ctx.createLinearGradient(b.x0, y, b.x1, y);
    }
    addGradientStops(ramp, stops);
    return ramp;
  }

  /**
   * Tile motif over a filled shape, clipped to it and stroked in the pen colour at hairline width.
   * Every repeat i·u + j·v that overlaps the visible part of the shape gets a copy of the motif,
   * laid where the fill mapping puts the tile (tileFrame). `dx`, `dy` is the move the object is
   * drawn with, and `k` the scale the tile is drawn at without a mapping. Repeats too small to
   * read at this zoom are left out, and the number of repeats is capped as hatch segments are.
   */
  private drawTile(geom: Geom, tile: TileFill, map: FillMapping | undefined, color: string, dx: number, dy: number, k: number): void {
    const b = geom.bbox;
    if (!b || !geom.path || tile.shapes.length === 0) return;
    const { u, v } = tile;
    const frame = tileFrame(map && mappingFits(map, b) ? map : undefined, tile, k);
    // the repeats on screen, in CSS px
    const onScreen = (r: Pt) => Math.hypot(frame.a * r.x + frame.c * r.y, frame.b * r.x + frame.d * r.y) * this.px;
    if (onScreen(u) < MIN_TILE_PX || onScreen(v) < MIN_TILE_PX) return;
    // parallel repeats leave gaps in the plane that no cell can reach
    const det = u.x * v.y - v.x * u.y;
    if (!(Math.abs(det) > 0)) return;
    // the visible part of the shape, in the shape's own coordinates, then in the tile's
    const view = this.cull;
    const visible: BBox = {
      x0: Math.max(b.x0, view.x0 - dx),
      y0: Math.max(b.y0, view.y0 - dy),
      x1: Math.min(b.x1, view.x1 - dx),
      y1: Math.min(b.y1, view.y1 - dy),
    };
    if (visible.x0 >= visible.x1 || visible.y0 >= visible.y1) return;
    const box = sourceBox(frame, visible);
    if (!box) return;
    // cell indices of the visible corners: solve p = i·u + j·v with the inverse of [u v]
    const corners = [box.x0, box.y0, box.x1, box.y0, box.x1, box.y1, box.x0, box.y1];
    let i0 = Infinity;
    let i1 = -Infinity;
    let j0 = Infinity;
    let j1 = -Infinity;
    for (let n = 0; n < 8; n += 2) {
      const i = (v.y * corners[n] - v.x * corners[n + 1]) / det;
      const j = (u.x * corners[n + 1] - u.y * corners[n]) / det;
      i0 = Math.min(i0, i);
      i1 = Math.max(i1, i);
      j0 = Math.min(j0, j);
      j1 = Math.max(j1, j);
    }
    // each motif's outline as drawn, in its own coordinates (hidden polyline edges left out)
    const motifs: Path2D[] = [];
    for (const m of tile.shapes) {
      const outline = buildGeom(m).stroke;
      if (outline) motifs.push(outline);
    }
    if (motifs.length === 0) return;
    // one cell more each way, for motifs that overhang their repeat
    const path = new Path2D();
    // the frame moved to the current repeat, reused for every cell; the path is in shape
    // coordinates so the hairline stays one pixel however the frame stretches
    const place = { ...frame };
    let cells = 0;
    for (let i = Math.floor(i0) - 1; i <= Math.ceil(i1) + 1 && cells < MAX_TILE_CELLS; i++) {
      for (let j = Math.floor(j0) - 1; j <= Math.ceil(j1) + 1 && cells < MAX_TILE_CELLS; j++) {
        cells++;
        const sx = i * u.x + j * v.x;
        const sy = i * u.y + j * v.y;
        place.e = frame.e + frame.a * sx + frame.c * sy;
        place.f = frame.f + frame.b * sx + frame.d * sy;
        for (const outline of motifs) path.addPath(outline, place);
      }
    }
    if (cells === 0) return;
    const { ctx } = this;
    ctx.save();
    ctx.clip(geom.path);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.px;
    ctx.stroke(path);
    ctx.restore();
  }

  /** The dash pattern for a line style, or null when it is solid or too fine to see at this zoom. */
  private visibleDash(lineStyle: number, layerScale: number): readonly number[] | null {
    const dash = this.scene.dashPattern(lineStyle, layerScale);
    if (!dash) return null;
    let period = 0;
    for (const v of dash) period += v;
    return period * this.px >= MIN_DASH_PERIOD_PX ? dash : null;
  }

  private drawText(shape: Shape, geom: Geom, color: string): void {
    const b = geom.bbox;
    if (!b || !shape.text) return;
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = color;
    paintText(ctx, shape, b, this.scene.fontName(shape.fontIndex));
    ctx.restore();
  }

  /**
   * A light object, a hairline mark at a fixed screen size: a ring with rays round it (a point
   * light), or with its aim seen from above (a spot's beam opening out, a directional light's arrow),
   * longer the flatter it shines and a dot inside when it shines straight down. Faint while it is off.
   */
  private drawLight(shape: Shape): void {
    const p = shape.points[0];
    const l = shape.light;
    if (!p || !l) return;
    const { ctx } = this;
    const u = 1 / this.px;
    const r = LIGHT_RING_PX * u;
    const flat = Math.hypot(l.aim.x, l.aim.y);
    const dir = flat > 0.05 ? { x: l.aim.x / flat, y: l.aim.y / flat } : null;
    ctx.save();
    if (!l.on) ctx.globalAlpha *= LIGHT_OFF_ALPHA;
    ctx.strokeStyle = LIGHT_INK;
    ctx.fillStyle = LIGHT_INK;
    ctx.lineWidth = u;
    ctx.beginPath();
    ctx.moveTo(p.x + r, p.y);
    ctx.arc(p.x, p.y, r, 0, 2 * Math.PI);
    if (l.kind === "point") {
      const [from, to] = LIGHT_RAY_PX;
      for (let k = 0; k < 8; k++) {
        const c = Math.cos((k * Math.PI) / 4);
        const s = Math.sin((k * Math.PI) / 4);
        ctx.moveTo(p.x + c * from * u, p.y + s * from * u);
        ctx.lineTo(p.x + c * to * u, p.y + s * to * u);
      }
    } else if (dir) {
      const reach = r + (LIGHT_AIM_PX - LIGHT_RING_PX) * flat * u;
      const tip = { x: p.x + dir.x * reach, y: p.y + dir.y * reach };
      const side = { x: -dir.y * r, y: dir.x * r };
      if (l.kind === "spot") {
        // the cone from the ring's sides, a bar across its mouth
        ctx.moveTo(p.x + side.x, p.y + side.y);
        ctx.lineTo(tip.x + 1.5 * side.x, tip.y + 1.5 * side.y);
        ctx.lineTo(tip.x - 1.5 * side.x, tip.y - 1.5 * side.y);
        ctx.lineTo(p.x - side.x, p.y - side.y);
      } else {
        ctx.moveTo(p.x + dir.x * r, p.y + dir.y * r);
        ctx.lineTo(tip.x, tip.y);
        ctx.moveTo(tip.x - dir.x * r + side.x, tip.y - dir.y * r + side.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(tip.x - dir.x * r - side.x, tip.y - dir.y * r - side.y);
      }
    }
    ctx.stroke();
    if (l.kind !== "point" && !dir) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r / 3, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /** A locus: a cross LOCUS_ARM_PX long each way from its point, a hairline whatever the zoom. */
  private drawLocus(p: Pt | undefined, color: string): void {
    if (!p) return;
    const { ctx } = this;
    const r = LOCUS_ARM_PX / this.px;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y);
    ctx.lineTo(p.x + r, p.y);
    ctx.moveTo(p.x, p.y - r);
    ctx.lineTo(p.x, p.y + r);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.px;
    ctx.stroke();
  }

  private drawImage(obj: ObjectInfo, shape: Shape, geom: Geom): void {
    const b = geom.bbox;
    if (!b) return;
    const bmp = this.scene.bitmap(obj, shape, () => this.requestDraw());
    if (!bmp) return;
    const { ctx } = this;
    ctx.save();
    ctx.translate(b.x0, b.y1);
    ctx.scale(1, -1);
    ctx.drawImage(bmp, 0, 0, b.x1 - b.x0, b.y1 - b.y0);
    ctx.restore();
  }

  private drawSelection(selected: readonly { obj: ObjectInfo; top: string }[], move: MoveDelta | null, alpha = 1, color = ACCENT): void {
    if (selected.length === 0) return;
    const { ctx, view, scene } = this;
    const cull = this.cullRect();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 / view.scale;
    for (const { obj, top } of selected) {
      const geom = scene.geometry(obj);
      if (!geom) continue;
      const dx = move && move.ids.has(top) ? move.dx : 0;
      const dy = move && move.ids.has(top) ? move.dy : 0;
      // off screen: nothing to outline
      if (geom.bbox && !touches(geom.bbox, dx, dy, cull)) continue;
      ctx.save();
      ctx.translate(dx, dy);
      if (geom.path) {
        // the edges as drawn: a hatch's hidden runs between its strokes stay unlit
        ctx.stroke(geom.stroke ?? geom.path);
      } else if (geom.bbox && view.rotation !== 0) {
        // a text level in a rotated plan, not the box round it along the drawing's axes
        ctx.beginPath();
        for (const p of outlineOf(geom.source, geom.bbox)) ctx.lineTo(p.x, p.y);
        ctx.closePath();
        ctx.stroke();
      } else if (geom.bbox) {
        const b = geom.bbox;
        ctx.strokeRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      }
      ctx.restore();
    }
  }

  /**
   * Grips. A single selected shape shows its reshape grips (white squares);
   * otherwise each selected object shows the corners of its bounds (solid,
   * not draggable).
   */
  private drawHandles(selected: readonly { obj: ObjectInfo; top: string }[], move: MoveDelta | null): void {
    if (selected.length === 0) return;
    const { ctx, view, scene } = this;
    const offset = (top: string) => (move && move.ids.has(top) ? move : { dx: 0, dy: 0 });
    const square = (p: { x: number; y: number }, dx: number, dy: number, size: number, hollow: boolean) => {
      const s = view.toScreen({ x: p.x + dx, y: p.y + dy });
      const half = size / 2;
      if (hollow) {
        ctx.fillRect(s.x - half, s.y - half, size, size);
        ctx.strokeRect(s.x - half + 0.5, s.y - half + 0.5, size - 1, size - 1);
      } else {
        ctx.fillRect(s.x - half, s.y - half, size, size);
      }
    };

    const only = selected.length === 1 && store.selection.size === 1 ? selected[0] : null;
    if (only && only.obj.id === only.top) {
      const geom = scene.geometry(only.obj);
      if (geom && geom.handles.length > 0) {
        const { dx, dy } = offset(only.top);
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = ACCENT;
        ctx.lineWidth = 1.5;
        for (const p of geom.handles) square(p, dx, dy, HANDLE_PX, true);
        // the vertex Object Info is editing, filled
        const vertex = store.editVertex?.id === only.obj.id ? geom.handles[store.editVertex.index] : undefined;
        if (vertex) {
          ctx.fillStyle = ACCENT;
          square(vertex, dx, dy, HANDLE_PX + 2, false);
          ctx.fillStyle = "#ffffff";
        }
        // edge midpoints: smaller and fainter, drag one to add a vertex
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1;
        for (const p of geom.edges) square(p, dx, dy, HANDLE_PX - 2, true);
        ctx.globalAlpha = 1;
        return;
      }
    }

    const boxes = new Map<string, BBox>();
    for (const { obj, top } of selected) {
      const geom = scene.geometry(obj);
      // in a rotated plan the bounds lie along the plan (toPlan and fromPlan do nothing unrotated)
      const b = view.rotation === 0 ? geom?.bbox : geom && bboxOfPoints(outlineOf(geom.source, geom.bbox).map((p) => view.toPlan(p)));
      if (!b) continue;
      const cur = boxes.get(top);
      boxes.set(top, cur ? unionBBox(cur, b)! : b);
    }
    ctx.fillStyle = ACCENT;
    for (const [top, b] of boxes) {
      const { dx, dy } = offset(top);
      for (const p of [
        { x: b.x0, y: b.y0 },
        { x: b.x1, y: b.y0 },
        { x: b.x1, y: b.y1 },
        { x: b.x0, y: b.y1 },
      ]) {
        square(view.fromPlan(p), dx, dy, HANDLE_PX - 2, false);
      }
    }
  }

  /** Dashed frame around the group being edited and a label saying how to leave it. */
  private drawGroupFrame(id: string): void {
    const { ctx, view, scene } = this;
    const b = scene.expand([id]).reduce<BBox | null>((acc, s) => unionBBox(acc, scene.geometry(s.obj)?.bbox ?? null), null);
    ctx.save();
    if (b) {
      const a = view.toScreen({ x: b.x0, y: b.y1 });
      const c = view.toScreen({ x: b.x1, y: b.y0 });
      const pad = 6;
      ctx.strokeStyle = ACCENT;
      ctx.setLineDash([6, 4]);
      if (view.rotation === 0) ctx.strokeRect(Math.round(a.x) - pad + 0.5, Math.round(a.y) - pad + 0.5, c.x - a.x + 2 * pad, c.y - a.y + 2 * pad);
      else {
        // its box turns with a rotated plan
        const k = view.toScreen({ x: b.x1, y: b.y1 });
        const d = view.toScreen({ x: b.x0, y: b.y0 });
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(k.x, k.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    const label = "Editing group · Esc to leave";
    ctx.font = `12px ${FONT}`;
    const w = ctx.measureText(label).width + 20;
    const x = Math.round(view.width / 2 - w / 2);
    ctx.fillStyle = ACCENT;
    ctx.beginPath();
    ctx.roundRect(x, 10, w, 24, 12);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 10, 22);
    ctx.restore();
  }

  /** A sheet layer's page (Page Setup), centred on its origin: a 1 px outline under its drawing. */
  private drawPage(page: PageSize): void {
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.strokeStyle = PAGE_EDGE;
    ctx.lineWidth = 1 / this.view.scale;
    ctx.strokeRect(-page.width / 2, -page.height / 2, page.width, page.height);
    ctx.restore();
  }

  /**
   * Grid lines at the snap spacing, drawn whenever showGrid is on (snapping
   * does not matter). Every GRID_MAJOR_EVERY-th line is stronger, and the
   * world axes are strongest. Lines are 1 CSS px, offset by 0.5 to stay crisp.
   */
  private drawGrid(): void {
    if (!store.showGrid) return;
    const { ctx, view } = this;
    const g = gridStep(view.scale);
    const minorPx = g * view.scale;
    // when minor lines are too dense, only the major lines are drawn
    const stride = minorPx >= GRID_MIN_PX ? 1 : GRID_MAJOR_EVERY;
    if (minorPx * stride < GRID_MIN_PX) return;
    const step = g * stride;
    const W = view.width;
    const H = view.height;
    // a rotated plan's grid lies along the screen, from its pivot
    const o = view.rotation === 0 ? null : view.toScreen(view.pivot);
    const px = step * view.scale;
    const r = view.visibleRect();
    const kx0 = o ? Math.ceil(-o.x / px) : Math.ceil(r.x0 / step);
    const kx1 = o ? Math.floor((W - o.x) / px) : Math.floor(r.x1 / step);
    const ky0 = o ? Math.ceil((o.y - H) / px) : Math.ceil(r.y0 / step);
    const ky1 = o ? Math.floor(o.y / px) : Math.floor(r.y1 / step);
    if (kx1 - kx0 > GRID_MAX_LINES || ky1 - ky0 > GRID_MAX_LINES) return;

    const minor = new Path2D();
    const major = new Path2D();
    const axes = new Path2D();
    const pick = (k: number): Path2D => {
      if (k === 0) return axes;
      return (k * stride) % GRID_MAJOR_EVERY === 0 ? major : minor;
    };
    for (let k = kx0; k <= kx1; k++) {
      const x = Math.floor(o ? o.x + k * px : (k * step - view.cx) * view.scale + W / 2) + 0.5;
      pick(k).moveTo(x, 0);
      pick(k).lineTo(x, H);
    }
    for (let k = ky0; k <= ky1; k++) {
      const y = Math.floor(o ? o.y - k * px : H / 2 - (k * step - view.cy) * view.scale) + 0.5;
      pick(k).moveTo(0, y);
      pick(k).lineTo(W, y);
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = GRID_MINOR;
    ctx.stroke(minor);
    ctx.strokeStyle = GRID_MAJOR;
    ctx.stroke(major);
    ctx.strokeStyle = GRID_AXIS;
    ctx.stroke(axes);
  }
}
