// Tool contract and the controller that routes canvas pointer, wheel and key
// events to the active tool. The controller also owns panning, the hover snap
// marker and the status-bar hint.

import type { FillMapping, ObjectInfo, Pt } from "../core/index.ts";
import { store, type ToolId } from "./state.ts";
import type { Scene } from "./scene.ts";
import { datumOffsetPoints, type Snapper, type SnapKind, type SnapResult } from "./snap.ts";
import type { View } from "./view.ts";
import type { TextEditor } from "./tools/text.ts";
import { ACCENT, SNAP_COLOR } from "./renderer.ts";
import { IS_MAC } from "./menu.ts";
import { stopGlide } from "./glide.ts";
import { prefs } from "./prefs.ts";
import { SnapLoupe } from "./loupe.ts";
import { dataBar } from "./databar.ts";
import { t } from "./i18n.ts";

export interface Painter {
  readonly ctx: CanvasRenderingContext2D;
  /** canvas size in CSS pixels */
  readonly width: number;
  readonly height: number;
  /** CSS pixels per document unit */
  readonly scale: number;
  toScreen(p: Pt): Pt;
}

/** Live displacement of the selection while it is being dragged. */
export interface MoveDelta {
  readonly ids: ReadonlySet<string>;
  readonly dx: number;
  readonly dy: number;
}

/** A fill mapping being dragged: the object draws its fill this way until the drag ends. */
export interface FillPreview {
  readonly id: string;
  readonly map: FillMapping;
}

/** What the renderer asks of the tool layer. */
export interface ToolOverlay {
  moveDelta(): MoveDelta | null;
  fillPreview(): FillPreview | null;
  drawOverlay(p: Painter): void;
}

export interface PointerInfo {
  /** CSS pixels relative to the canvas */
  readonly screen: Pt;
  /** document units, unsnapped */
  readonly raw: Pt;
  /** document units, snapped (equal to raw when nothing snapped) */
  readonly pos: Pt;
  readonly snap: SnapResult["kind"];
  /** the smart points `pos` lines up with, when snap is "align" or "extension" */
  readonly guides?: readonly Pt[];
  readonly shift: boolean;
  /** Cmd (Mac) or Ctrl held */
  readonly mod: boolean;
  /** Option (Mac) or Alt held */
  readonly alt: boolean;
  /** click count of this press (2 = double-click) */
  readonly detail: number;
  readonly button: number;
}

/** Modifier names for hints: Option and Cmd on a Mac, Alt and Ctrl elsewhere. */
export const ALT_KEY = IS_MAC ? "Option" : "Alt";
export const MOD_KEY = IS_MAC ? "Cmd" : "Ctrl";

export interface ToolEnv {
  readonly view: View;
  readonly scene: Scene;
  readonly snap: Snapper;
  readonly text: TextEditor;
  requestDraw(): void;
}

/** A tool's modes as the mode bar shows them: one choice among options. */
export interface ToolModes {
  /** what the choice is about, for a tool with several groups ("Control line") */
  readonly label?: string;
  readonly options: readonly { readonly id: string; readonly label: string; readonly key?: string }[];
  readonly active: string;
}

/**
 * The mode a key press chooses among a tool's mode groups (each option's `key`), or null. Keys
 * held with Cmd, Ctrl or Option never choose one.
 */
export function modeForKey(e: KeyboardEvent, groups: ToolModes | readonly ToolModes[] | undefined): string | null {
  if (!groups || e.metaKey || e.ctrlKey || e.altKey) return null;
  for (const g of "options" in groups ? [groups] : groups) {
    for (const o of g.options) if (o.key === e.key) return o.id;
  }
  return null;
}

export interface Tool {
  readonly id: ToolId;
  /** CSS cursor while the pointer is over the canvas */
  readonly cursor: string;
  down(p: PointerInfo): void;
  move(p: PointerInfo): void;
  up(p: PointerInfo): void;
  /** abandon any gesture in progress without committing */
  cancel(): void;
  /** returns true when the key was consumed */
  key(e: KeyboardEvent): boolean;
  /** tool-specific preview drawn above the drawing */
  overlay(p: Painter): void;
  /** status-bar text for the current state */
  hint(): string;
  /** live displacement of the selection while it is being dragged */
  moveDelta(): MoveDelta | null;
  /** a fill mapping being dragged, which the renderer draws in place of the object's own */
  fillPreview?(): FillPreview | null;
  /** the modes the mode bar offers, for a tool that has them: one group, or several side by side */
  modes?(): ToolModes | readonly ToolModes[];
  /** chooses one of the modes by its id (ids are unique across a tool's groups) */
  setMode?(id: string): void;
  /** opens the tool's preferences (the mode bar's Preferences button), for a tool that has them */
  preferences?(): void | Promise<void>;
  /** the point the tool draws from now (a line's start), for tangent and perpendicular snaps */
  snapFrom?(): Pt | null;
  /**
   * Create Similar Object: takes the settings `obj` was drawn with (the wall or symbol it copies, a
   * light's kind); false when the tool can't copy that object and keeps what it had
   */
  takeFrom?(obj: ObjectInfo): boolean;
}

export abstract class BaseTool implements Tool {
  abstract readonly id: ToolId;
  abstract readonly cursor: string;

  constructor(protected readonly env: ToolEnv) {}

  down(_p: PointerInfo): void {}
  move(_p: PointerInfo): void {}
  up(_p: PointerInfo): void {}
  cancel(): void {}
  key(_e: KeyboardEvent): boolean {
    return false;
  }
  overlay(_p: Painter): void {}
  hint(): string {
    return "";
  }
  moveDelta(): MoveDelta | null {
    return null;
  }
}

export class PanTool extends BaseTool {
  readonly id = "pan";
  readonly cursor = "grab";

  hint(): string {
    return "Drag to pan · Scroll zoom · Space in any tool";
  }
}

/** Strokes an open or closed polyline through screen-projected points. */
export function strokeScreen(g: Painter, pts: readonly Pt[], closed: boolean): void {
  if (pts.length === 0) return;
  const { ctx } = g;
  ctx.beginPath();
  pts.forEach((p, i) => {
    const s = g.toScreen(p);
    if (i === 0) ctx.moveTo(s.x, s.y);
    else ctx.lineTo(s.x, s.y);
  });
  if (closed) ctx.closePath();
  ctx.stroke();
}

/** Runs `fn` with the dashed accent preview style, restoring the context afterwards. */
export function withPreview(g: Painter, fn: () => void): void {
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 3]);
  fn();
  ctx.restore();
}

const SNAP_FONT = `"Helvetica Neue", Arial, system-ui, sans-serif`;

/** Name shown in the cue beside the marker, per snap kind. */
const SNAP_LABEL: Record<SnapKind, string> = {
  end: "Endpoint",
  mid: "Midpoint",
  center: "Center",
  intersection: "Intersection",
  tangent: "Tangent",
  perpendicular: "Perpendicular",
  nearest: "On object",
  align: "Aligned",
  extension: "Extension",
  datum: "Datum offset",
  grid: "Grid",
};

/** Outline of the marker for a snap kind, centred on the screen point s (CSS px). */
function strokeSnapGlyph(ctx: CanvasRenderingContext2D, s: Pt, kind: SnapKind): void {
  ctx.beginPath();
  switch (kind) {
    case "end":
      ctx.rect(s.x - 5, s.y - 5, 10, 10);
      break;
    case "mid":
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x + 6, s.y + 5);
      ctx.lineTo(s.x - 6, s.y + 5);
      ctx.closePath();
      break;
    case "center":
      ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
      break;
    case "intersection":
      ctx.moveTo(s.x - 5, s.y - 5);
      ctx.lineTo(s.x + 5, s.y + 5);
      ctx.moveTo(s.x + 5, s.y - 5);
      ctx.lineTo(s.x - 5, s.y + 5);
      break;
    case "tangent":
      // a line touching a circle at the point
      ctx.moveTo(s.x - 7, s.y);
      ctx.lineTo(s.x + 7, s.y);
      ctx.moveTo(s.x + 4.5, s.y + 4.5);
      ctx.arc(s.x, s.y + 4.5, 4.5, 0, Math.PI * 2);
      break;
    case "perpendicular":
      // an upright on a base, square at the point
      ctx.moveTo(s.x - 6, s.y + 5);
      ctx.lineTo(s.x + 6, s.y + 5);
      ctx.moveTo(s.x, s.y + 5);
      ctx.lineTo(s.x, s.y - 6);
      ctx.moveTo(s.x, s.y + 1.5);
      ctx.lineTo(s.x + 3.5, s.y + 1.5);
      ctx.lineTo(s.x + 3.5, s.y + 5);
      break;
    case "nearest":
      // hourglass: two triangles meeting at the point
      ctx.moveTo(s.x - 5, s.y - 5);
      ctx.lineTo(s.x + 5, s.y - 5);
      ctx.lineTo(s.x - 5, s.y + 5);
      ctx.lineTo(s.x + 5, s.y + 5);
      ctx.closePath();
      break;
    case "datum":
      // a diamond: a point measured from the datum
      ctx.moveTo(s.x, s.y - 6);
      ctx.lineTo(s.x + 6, s.y);
      ctx.lineTo(s.x, s.y + 6);
      ctx.lineTo(s.x - 6, s.y);
      ctx.closePath();
      break;
    case "align":
    case "extension":
    case "grid":
      ctx.moveTo(s.x - 5, s.y);
      ctx.lineTo(s.x + 5, s.y);
      ctx.moveTo(s.x, s.y - 5);
      ctx.lineTo(s.x, s.y + 5);
      break;
  }
  ctx.stroke();
}

/** Small pill with the snap name, up and to the right of the marker. */
function snapLabel(ctx: CanvasRenderingContext2D, s: Pt, english: string): void {
  const text = t(english);
  ctx.font = `11px ${SNAP_FONT}`;
  const w = ctx.measureText(text).width + 10;
  const h = 16;
  const x = s.x + 9;
  const y = s.y - h - 5;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = SNAP_COLOR;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x + 5, y + h / 2 + 0.5);
}

function drawSnapMarker(g: Painter, world: Pt, kind: SnapKind, guides: readonly Pt[] = []): void {
  const s = g.toScreen(world);
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  // a smart point's guide: dashed from the acquired point to the cursor
  if (guides.length) {
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    for (const a of guides) {
      const p = g.toScreen(a);
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.lineWidth = 1.5;
  strokeSnapGlyph(ctx, s, kind);
  snapLabel(ctx, s, kind === "align" ? alignLabel(world, guides) : SNAP_LABEL[kind]);
  ctx.restore();
}

/** "Vertical" or "Horizontal" for a guide along one axis, "Aligned" for two. */
function alignLabel(at: Pt, guides: readonly Pt[]): string {
  if (guides.length !== 1) return SNAP_LABEL.align;
  return guides[0].x === at.x ? "Vertical" : "Horizontal";
}

/**
 * The SmartCursor datum: a small circle around it, as Vectorworks marks it, with a dot at its
 * middle; with Use datum offset, a dashed extension out to a small diamond at each offset point.
 */
function drawDatum(g: Painter, at: Pt): void {
  const { ctx } = g;
  const s = g.toScreen(at);
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  ctx.fillStyle = SNAP_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(s.x, s.y, 6, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s.x, s.y, 1.5, 0, Math.PI * 2);
  ctx.fill();
  const offsets = datumOffsetPoints().map((q) => g.toScreen(q));
  if (offsets.length) {
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const q of offsets) {
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    for (const q of offsets) {
      ctx.moveTo(q.x, q.y - 3.5);
      ctx.lineTo(q.x + 3.5, q.y);
      ctx.lineTo(q.x, q.y + 3.5);
      ctx.lineTo(q.x - 3.5, q.y);
      ctx.closePath();
    }
    ctx.fill();
  }
  ctx.restore();
}

/** The acquired smart points: a small cross on each. */
function drawSmartPoints(g: Painter, pts: readonly Pt[]): void {
  if (pts.length === 0) return;
  const { ctx } = g;
  ctx.save();
  ctx.strokeStyle = SNAP_COLOR;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  for (const a of pts) {
    const s = g.toScreen(a);
    ctx.moveTo(s.x - 3.5, s.y - 3.5);
    ctx.lineTo(s.x + 3.5, s.y + 3.5);
    ctx.moveTo(s.x + 3.5, s.y - 3.5);
    ctx.lineTo(s.x - 3.5, s.y + 3.5);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Tools that can be used on the active layer; pan is always allowed. The
 * select tool also works while the active layer is hidden, because it picks
 * from every visible layer and makes the clicked object's layer active.
 */
/** Tools that only change the view: they work without a drawing and show no snap markers. */
const VIEW_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>(["pan", "zoom"]);

function blockedReason(env: ToolEnv, tool: Tool): string | null {
  if (VIEW_TOOLS.has(tool.id)) return null;
  if (!store.session || !store.activeLayerId) return "Open a drawing to edit";
  if (tool.id === "select") return null;
  const layer = env.scene.layer(store.activeLayerId);
  if (layer && layer.visibility === "hidden") return "Active layer is hidden";
  return null;
}

/**
 * A feature's first look at the canvas's pointer events (features/touch: touch gestures and the
 * Apple Pencil). It returns true when it took the event, and the tool then never sees it.
 */
export type PointerGate = (e: PointerEvent, phase: "down" | "move" | "up" | "cancel") => boolean;

export class ToolController implements ToolOverlay {
  private readonly tools = new Map<ToolId, Tool>();
  private active: Tool;
  private panAnchor: Pt | null = null;
  private spaceHeld = false;
  private hovering = false;
  private lastInfo: PointerInfo | null = null;
  private lastPress: { time: number; at: Pt; count: number } | null = null;
  private gate: PointerGate | null = null;
  /** where and when the middle button went down, for telling a click from a pan */
  private middlePress: { x: number; y: number; time: number } | null = null;
  /** a middle click that didn't pan (the Smart Options display), at its place in the window */
  onMiddleClick: ((x: number, y: number) => void) | null = null;
  /** Shift and Option latched on the touch quick bar: OR-ed into the pointer events the tools get */
  private latch = { shift: false, alt: false };
  /** the Snap Loupe (Z), made the first time it opens */
  private loupe: SnapLoupe | null = null;
  /** a press in the open loupe, which closes it once released */
  private loupeClick = false;
  /** a press outside the open loupe closed it: its release does nothing either */
  private swallowUp = false;
  /** Set datum if mouse stops: the timer since the pointer last moved */
  private datumTimer = 0;

  /** Adds tools once the editor runs (a feature's), which `setTool` can then pick. */
  addTools(build: (env: ToolEnv) => readonly Tool[]): void {
    for (const t of build(this.env)) this.tools.set(t.id, t);
  }

  constructor(
    private readonly env: ToolEnv,
    private readonly canvas: HTMLCanvasElement,
    tools: readonly Tool[],
  ) {
    for (const t of tools) this.tools.set(t.id, t);
    const initial = this.tools.get(store.tool);
    if (!initial) throw new Error(`openvwx: no tool registered for "${store.tool}"`);
    this.active = initial;
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointerleave", () => {
      this.hovering = false;
      clearTimeout(this.datumTimer);
      store.preselect = null;
      this.env.requestDraw();
    });
    // keep focus where it is; text editing and inputs are committed explicitly
    canvas.addEventListener("mousedown", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    this.syncCursor();
    this.refreshHint();
    // hints depend on the document, the selection and the active layer, not only on pointer events
    store.on(["session", "selection", "layer"], () => this.refreshHint());
    // the loupe magnifies the view as it was when it opened: a zoom, pan or new drawing closes it
    store.on(["view", "session"], () => this.closeLoupe());
    // a datum belongs to the drawing it was set in
    let session = store.session;
    store.on("session", () => {
      if (store.session === session) return;
      session = store.session;
      if (!store.datum) return;
      store.datum = null;
      store.emit("datum");
    });
  }

  get activeId(): ToolId {
    return this.active.id;
  }

  /** What tool `id` says to do (its Mode bar help), for its screen tip. */
  helpOf(id: ToolId): string {
    return this.tools.get(id)?.hint() ?? "";
  }

  setTool(id: ToolId): void {
    const next = this.tools.get(id);
    if (!next || next === this.active) return;
    this.closeLoupe();
    this.active.cancel();
    this.active = next;
    store.tool = id;
    store.emit("tool");
    this.syncCursor();
    this.refreshHint();
    this.env.requestDraw();
  }

  /** Create Similar Object: makes `id` the tool, with the settings `obj` was drawn with; false when it can't copy `obj`. */
  setToolFrom(id: ToolId, obj: ObjectInfo): boolean {
    this.setTool(id);
    const took = this.tools.get(id)?.takeFrom?.(obj) ?? true;
    this.refreshHint();
    // the mode bar shows the modes taken
    store.emit("modes");
    this.env.requestDraw();
    return took;
  }

  /** Abandons the gesture in progress (used when the document is replaced). */
  cancel(): void {
    this.active.cancel();
    this.refreshHint();
    this.env.requestDraw();
  }

  /** Puts a feature's gate in front of the canvas's pointer events (one gate; null removes it). */
  setPointerGate(gate: PointerGate | null): void {
    this.gate = gate;
  }

  /** Abandons the pointer gesture in progress (a pan, or the tool's): no up follows it. */
  abortPointer(): void {
    this.panAnchor = null;
    this.cancel();
    this.syncCursor();
  }

  /** Latches Shift and/or Option for pointer events (the touch quick bar); the tools see them as if held. */
  setLatch(next: { readonly shift?: boolean; readonly alt?: boolean }): void {
    this.latch = { shift: next.shift ?? this.latch.shift, alt: next.alt ?? this.latch.alt };
    this.env.requestDraw();
  }

  setSpace(held: boolean): void {
    if (this.spaceHeld === held) return;
    this.spaceHeld = held;
    this.syncCursor();
  }

  /**
   * Z over the drawing (Vectorworks' Snap Loupe): opens the loupe at the pointer, or magnifies the
   * open one further. False when the pointer isn't over the drawing or a view tool is active.
   */
  snapLoupe(): boolean {
    const last = this.lastInfo;
    if (!this.hovering || !last || !store.session || this.panAnchor || VIEW_TOOLS.has(this.active.id)) return false;
    const overlay: ToolOverlay = { moveDelta: () => this.moveDelta(), fillPreview: () => this.fillPreview(), drawOverlay: (p) => this.paintOverlay(p) };
    this.loupe ??= new SnapLoupe(this.canvas, this.view, this.env.scene, overlay);
    this.loupe.open(last.screen);
    // the pointer's point is now the one under it in the loupe
    this.lastInfo = { ...last, ...this.pointAt(last.screen) };
    this.env.requestDraw();
    return true;
  }

  /**
   * G over the drawing (Vectorworks' SmartCursor datum): sets the datum at the snapped point under
   * the pointer, moves it there, or releases it when the pointer is on it. False when the pointer
   * isn't over the drawing or a view tool is active.
   */
  toggleDatum(): boolean {
    const last = this.lastInfo;
    if (!this.hovering || !last || !store.session || this.panAnchor || VIEW_TOOLS.has(this.active.id)) return false;
    const d = store.datum;
    const release = d !== null && Math.hypot(last.pos.x - d.x, last.pos.y - d.y) <= store.snapSettings.radiusPx / this.view.scale;
    store.datum = release ? null : { x: last.pos.x, y: last.pos.y };
    store.emit("datum");
    // the pointer may line up with the datum now
    this.lastInfo = { ...last, ...this.pointAt(last.screen) };
    if (!release) dataBar.datumSet();
    this.env.requestDraw();
    return true;
  }

  /**
   * Smart Point Settings' Set datum if mouse stops: once the pointer has rested that long where
   * `info` has it, the datum is set there, moved there, or released when it is there already.
   */
  private pauseForDatum(info: PointerInfo): void {
    clearTimeout(this.datumTimer);
    const sec = store.snapSettings.datumSec;
    if (sec === null || !store.snapObjects || !store.snapKinds.smart) return;
    this.datumTimer = window.setTimeout(() => {
      if (this.lastInfo === info) this.toggleDatum();
    }, sec * 1000);
  }

  private closeLoupe(): void {
    if (!this.loupe?.isOpen) return;
    this.loupe.close();
    this.loupeClick = false;
    this.env.requestDraw();
  }

  /** Lets the active tool consume a key. Returns true when consumed. */
  handleKey(e: KeyboardEvent): boolean {
    // Escape closes the Snap Loupe before it reaches the tool
    if (e.key === "Escape" && this.loupe?.isOpen) {
      this.closeLoupe();
      return true;
    }
    const used = this.active.key(e);
    if (used) {
      this.afterEvent();
      // a key may have chosen one of the tool's modes, and with it the cursor
      this.syncCursor();
      store.emit("modes");
    }
    return used;
  }

  /** The active tool's mode groups; empty when it has none. */
  modes(): readonly ToolModes[] {
    const m = this.active.modes?.();
    return !m ? [] : "options" in m ? [m] : m;
  }

  /** True when the active tool has preferences to open. */
  hasPreferences(): boolean {
    return !!this.active.preferences;
  }

  /** Opens the active tool's preferences; the hint and preview follow what they change. */
  async preferences(): Promise<void> {
    await this.active.preferences?.();
    this.afterEvent();
    store.emit("modes");
  }

  /** Chooses a mode of the active tool (the mode bar's buttons). */
  setMode(id: string): void {
    this.active.setMode?.(id);
    this.afterEvent();
    this.syncCursor();
    store.emit("modes");
  }

  refreshHint(): void {
    store.setHint(blockedReason(this.env, this.active) ?? this.active.hint());
  }

  moveDelta(): MoveDelta | null {
    return this.active.moveDelta();
  }

  fillPreview(): FillPreview | null {
    return this.active.fillPreview?.() ?? null;
  }

  drawOverlay(p: Painter): void {
    this.paintOverlay(p);
    // the loupe shows the same drawing and overlay, magnified
    this.loupe?.requestDraw();
  }

  /** The snap marker and the active tool's overlay, on the drawing or in the loupe. */
  private paintOverlay(p: Painter): void {
    const info = this.lastInfo;
    const drawing = this.active.id !== "select" && !VIEW_TOOLS.has(this.active.id);
    if (store.datum && store.session && !VIEW_TOOLS.has(this.active.id)) drawDatum(p, store.datum);
    if (drawing && this.hovering && !this.panAnchor && info && !blockedReason(this.env, this.active)) {
      if (store.snapObjects && store.snapKinds.smart) drawSmartPoints(p, this.env.snap.acquiredPoints);
      if (info.snap) drawSnapMarker(p, info.pos, info.snap, info.guides);
    }
    this.active.overlay(p);
  }

  private get view(): View {
    return this.env.view;
  }

  private screenOf(e: MouseEvent): Pt {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /**
   * The drawing's point at `screen` and its snap; inside the open Snap Loupe the point under the
   * pointer there, snapped as finely as the loupe magnifies.
   */
  private pointAt(screen: Pt): Pick<PointerInfo, "raw" | "pos" | "snap" | "guides"> {
    const loupe = this.loupe?.contains(screen) ? this.loupe : null;
    const view = loupe?.view ?? this.view;
    const at = loupe?.local(screen) ?? screen;
    const raw = view.toWorld(at.x, at.y);
    const s = this.env.snap.snap(raw, view, undefined, this.active.snapFrom?.() ?? null);
    return { raw, pos: s.pos, snap: s.kind, guides: s.guides };
  }

  private infoFor(e: MouseEvent, screen: Pt, detail = 0): PointerInfo {
    const mod = e.metaKey || e.ctrlKey;
    return {
      screen,
      ...this.pointAt(screen),
      shift: e.shiftKey || this.latch.shift,
      mod,
      alt: e.altKey || this.latch.alt,
      detail,
      button: e.button,
    };
  }

  /** Click count for a press. PointerEvent.detail is 0 on pointerdown in
   *  Chromium, so count presses close together in time and space ourselves. */
  private clickCount(e: PointerEvent, screen: Pt): number {
    const last = this.lastPress;
    const near = last && e.timeStamp - last.time < 450 && Math.hypot(screen.x - last.at.x, screen.y - last.at.y) < 5;
    const count = near ? last.count + 1 : 1;
    this.lastPress = { time: e.timeStamp, at: screen, count };
    return Math.max(count, e.detail);
  }

  private onDown(e: PointerEvent): void {
    const screen = this.screenOf(e);
    this.hovering = true;
    // Commit whatever holds focus (text editor, inputs) before acting on the canvas.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused !== document.body) focused.blur();
    if (this.gate?.(e, "down")) return;
    const panning = e.button === 1 || (e.button === 0 && (this.spaceHeld || this.active.id === "pan"));
    if (panning) {
      this.closeLoupe();
      this.canvas.setPointerCapture(e.pointerId);
      this.middlePress = e.button === 1 ? { x: e.clientX, y: e.clientY, time: e.timeStamp } : null;
      this.panAnchor = screen;
      // panning by hand takes over from an animated view change
      stopGlide();
      this.syncCursor();
      return;
    }
    if (e.button !== 0) return;
    if (this.loupe?.isOpen) {
      // a click outside the loupe only closes it; one inside acts there, and closes it once released
      if (!this.loupe.contains(screen)) {
        this.closeLoupe();
        this.swallowUp = true;
        return;
      }
      this.loupeClick = true;
    }
    if (blockedReason(this.env, this.active)) {
      this.refreshHint();
      return;
    }
    this.canvas.setPointerCapture(e.pointerId);
    const info = this.infoFor(e, screen, this.clickCount(e, screen));
    this.lastInfo = info;
    this.active.down(info);
    this.afterEvent();
  }

  private onMove(e: PointerEvent): void {
    if (this.gate?.(e, "move")) return;
    const screen = this.screenOf(e);
    this.hovering = true;
    if (this.panAnchor) {
      this.view.pan(screen.x - this.panAnchor.x, screen.y - this.panAnchor.y);
      this.panAnchor = screen;
      this.env.requestDraw();
      return;
    }
    const info = this.infoFor(e, screen);
    this.lastInfo = info;
    store.cursor = info.pos;
    store.emit("cursor");
    this.pauseForDatum(info);
    if (!blockedReason(this.env, this.active)) this.active.move(info);
    this.afterEvent();
  }

  private onUp(e: PointerEvent): void {
    if (this.gate?.(e, "up")) return;
    if (this.panAnchor) {
      this.panAnchor = null;
      this.syncCursor();
      const press = this.middlePress;
      this.middlePress = null;
      if (e.button === 1 && press && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 4 && e.timeStamp - press.time < 400) {
        this.onMiddleClick?.(e.clientX, e.clientY);
      }
      return;
    }
    if (e.button === 0 && this.swallowUp) {
      this.swallowUp = false;
      return;
    }
    if (e.button !== 0 || blockedReason(this.env, this.active)) return;
    const info = this.infoFor(e, this.screenOf(e));
    this.lastInfo = info;
    this.active.up(info);
    if (this.loupeClick) this.closeLoupe();
    this.afterEvent();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    stopGlide();
    this.closeLoupe();
    const screen = this.screenOf(e);
    const unit = e.deltaMode === 1 ? 16 : 1;
    // a pinch arrives as the wheel with Ctrl; Preferences > Edit can make the wheel scroll
    if (prefs().wheelZooms || e.ctrlKey || e.metaKey) {
      this.view.zoomAt(screen.x, screen.y, Math.exp(-e.deltaY * unit * 0.0015));
    } else {
      // Shift turns a mouse's wheel sideways where the browser doesn't
      const sideways = e.shiftKey && e.deltaX === 0;
      this.view.pan(-(sideways ? e.deltaY : e.deltaX) * unit, -(sideways ? 0 : e.deltaY) * unit);
    }
    store.emit("view");
    this.env.requestDraw();
  }

  private afterEvent(): void {
    this.refreshHint();
    this.env.requestDraw();
  }

  private syncCursor(): void {
    if (this.panAnchor) this.canvas.style.cursor = "grabbing";
    else if (this.spaceHeld || this.active.id === "pan") this.canvas.style.cursor = "grab";
    else this.canvas.style.cursor = this.active.cursor;
  }
}
