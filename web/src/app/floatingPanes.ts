// View > Multiple View Panes > Create Floating View Pane, as Vectorworks 2027 has it: another view of
// the open drawing in a window of its own, floating over the drawing area, beside whatever panes
// that is split into. A new one shows what the active view shows (the plan where the live plan is,
// or the model from where the live 3D view looks); its view button and right-click menu turn it
// into the plan (Top/Plan) or a standard 3D view. A drag in it pans the plan or orbits the model
// (Shift- or middle-drag pans the model), the wheel zooms, and a double-click (or Show in Main View)
// gives its view to the live plan or 3D view. Its title bar drags it, its corner resizes it, and its
// buttons fit the drawing in it, roll it up to its title and close it. It is drawn again as the
// drawing changes, the 3D ones in View > Rendering's mode and projection (Path Traced as a still
// Realistic picture). A Renderworks camera's Open Camera View in New Pane makes one looking through
// the camera, shaped as its picture and in its projection, following the camera as it is edited
// until the pane's own view is turned. Nothing is drawn, picked or snapped to in one; the panes
// belong to the drawing that was open when they were made, close with it, and aren't saved.

import "./floatingPanes.css";
import type { CameraInfo, Vec3 } from "../core/index.ts";
import { h } from "./dom.ts";
import { openContextMenu, type Row } from "./menu.ts";
import { Renderer } from "./renderer.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import type { ToolOverlay } from "./tools.ts";
import { View } from "./view.ts";
import type { Viz3D } from "./heliodon.ts";
import type { CameraState, PaneLook, View3D, ViewPreset } from "./view3d.ts";
import { STANDARD_VIEWS } from "./viewbar.ts";

/** Where a plan is seen from: the world point at its middle and its pixels per document unit. */
export interface PlanAt {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
}

/** What the floating panes need of the editor. */
export interface FloatingHost {
  readonly scene: Scene;
  /** the live plan: a new plan pane starts where it is */
  readonly view: View;
  /** true while the live 3D view is the active one */
  showing3d(): boolean;
  /** View > Rendering's mode and the projection */
  look(): PaneLook;
  /** The 3D view with the drawing's model, built (and not shown) if need be; null without WebGL (having said why). */
  model3d(): Promise<View3D | null>;
  /** The live plan shows `at`. */
  takePlan(at: PlanAt): void;
  /** The live 3D view looks from `state`. */
  take3d(state: CameraState): void;
}

/** a picture with nothing of a tool's drawn over it */
const PICTURE: ToolOverlay = { moveDelta: () => null, fillPreview: () => null, drawOverlay: () => {} };
const START_W = 380;
const START_H = 280;
const MIN_W = 220;
const MIN_H = 150;
/** how far each new pane sits from the last, px */
const CASCADE = 28;
/** room left above a new pane for the View bar, px */
const TOP_ROOM = 56;
const MAX_PANES = 8;
/** how long a change waits before the panes draw again, ms */
const REDRAW_DELAY_MS = 60;
/** radians the model turns per pixel dragged */
const ORBIT_PER_PX = 0.008;
/** the zoom per wheel pixel */
const WHEEL_PER_PX = 0.0015;
const MIN_ZOOM = 1e-4;
const MAX_ZOOM = 1e4;
/** half the angle an orthogonal camera's picture spans, as Render Image frames one (features/render/camera.ts) */
const ORTHO_HALF_ANGLE = 17.5;
const DEG = Math.PI / 180;

const VIEW_ICON = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5 10.5 4v4L6 10.5 1.5 8V4Z M1.5 4 6 6.5 10.5 4 M6 6.5v4" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
const FIT_ICON = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.5 4.5v-3h3M7.5 1.5h3v3M10.5 7.5v3h-3M4.5 10.5h-3v-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const MAIN_ICON = `<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="2" width="9" height="8" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M4.5 7.5 7.5 4.5M5 4.5h2.5V7" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CHEVRON = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

let host: FloatingHost | null = null;
let layer: HTMLElement | null = null;
const panes: Pane[] = [];
/** panes made so far, for their names */
let made = 0;
/** the stacking order: the last pane pressed is on top */
let topZ = 0;
/** the 3D view the 3D panes are drawn with, once one has been made */
let view3d: View3D | null = null;
let watched: View3D | null = null;
let lookSeen = -1;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scaled = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => scaled(a, 1 / (Math.hypot(...a) || 1));

/** `cam` turned about its orbit point: across about the vertical, and up or down (stopping short of straight over or under). */
function orbit(cam: CameraState, dx: number, dy: number): CameraState {
  const [ox, oy, oz] = sub(cam.position, cam.target);
  const r = Math.hypot(ox, oy, oz) || 1;
  const theta = Math.atan2(oy, ox) - dx * ORBIT_PER_PX;
  const phi = clamp(Math.acos(clamp(oz / r, -1, 1)) - dy * ORBIT_PER_PX, 1e-3, Math.PI - 1e-3);
  const offset: Vec3 = [r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi)];
  return { ...cam, position: add(cam.target, offset) };
}

/** `cam` slid across the picture by (`dx`, `dy`) px of a picture `height` px high, the model following the pointer. */
function pan3d(cam: CameraState, dx: number, dy: number, height: number, ortho: boolean): CameraState {
  const ahead = sub(cam.target, cam.position);
  const distance = Math.hypot(...ahead);
  const right = unit(cross(ahead, [0, 0, 1]));
  const up = unit(cross(right, ahead));
  const perPx = (ortho ? (2 * cam.half) / cam.zoom : 2 * distance * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, height);
  const move = add(scaled(right, -dx * perPx), scaled(up, dy * perPx));
  return { ...cam, position: add(cam.position, move), target: add(cam.target, move) };
}

/** `cam` zoomed in by `factor` (out below 1): the orthogonal lens magnified, or the eye moved toward its orbit point. */
function zoom3d(cam: CameraState, factor: number, ortho: boolean): CameraState {
  if (ortho) return { ...cam, zoom: clamp(cam.zoom * factor, MIN_ZOOM, MAX_ZOOM) };
  return { ...cam, position: add(cam.target, scaled(sub(cam.position, cam.target), 1 / factor)) };
}

/** Where a pane stands to look through camera `c`: its eye, target and lens (its angle spans the picture's width). */
function cameraState(c: CameraInfo): CameraState {
  const distance = Math.hypot(...sub(c.target, c.eye));
  if (!c.perspective) return { position: c.eye, target: c.target, zoom: 1, half: distance * Math.tan(ORTHO_HALF_ANGLE * DEG), fov: 2 * ORTHO_HALF_ANGLE };
  const half = (clamp(c.viewAngle, 1, 170) / 2) * DEG;
  const fov = (2 * Math.atan(Math.tan(half) / Math.max(c.aspect, 0.1))) / DEG;
  return { position: c.eye, target: c.target, zoom: 1, half: distance * Math.tan((fov / 2) * DEG), fov };
}

/** The 3D view with the model, for the 3D panes; it draws them again when its look changes (lights, the Visualization and Render palettes, a Realistic scene ready). */
async function ensure3d(): Promise<View3D | null> {
  if (!host) return null;
  view3d = await host.model3d();
  if (view3d && watched !== view3d) {
    watched = view3d;
    const v = view3d;
    v.afterRender.add(() => {
      if (v.lookVersion === lookSeen) return;
      lookSeen = v.lookVersion;
      redrawFloating("3d");
    });
    v.picturesStale.add(() => redrawFloating("3d"));
  }
  return view3d;
}

class Pane {
  readonly el: HTMLElement;
  readonly canvas = h("canvas", { cls: "fpane-canvas" });
  private readonly title = h("span", { cls: "pal-title" });
  /** the plan as this pane shows it */
  private readonly plan = new View();
  private readonly renderer: Renderer;
  kind: "plan" | "3d" = "plan";
  /** the standard view a 3D pane shows, until it is turned */
  private preset: ViewPreset | null = null;
  private cam: CameraState | null = null;
  /** the camera it looks through, by id, until its view is turned */
  private through: { readonly id: string; readonly name: string } | null = null;
  /** a camera's projection, kept until a standard view or the plan is chosen; else View > Projection's */
  private projection: Viz3D["projection"] | null = null;
  /** where it is in the floating layer, px */
  private box: { x: number; y: number; w: number; h: number };
  private timer = 0;
  private frame = 0;
  readonly session = store.session;

  constructor(
    readonly name: string,
    at: { x: number; y: number },
  ) {
    const scene = host!.scene;
    this.box = { ...at, w: START_W, h: START_H };
    const button = (cls: string, html: string, title: string): HTMLButtonElement =>
      h("button", { cls: `pal-btn ${cls}`, html, title, attrs: { type: "button", "aria-label": title } });
    const views = button("fpane-views", VIEW_ICON, "Views");
    const fit = button("fpane-fit", FIT_ICON, "Fit to Window");
    const main = button("fpane-main", MAIN_ICON, "Show in Main View");
    const roll = button("pal-collapse", CHEVRON, "Roll up");
    const close = button("pal-close", CROSS, "Close");
    const head = h("header", { cls: "pal-head fpane-head" }, this.title, views, fit, main, roll, close);
    const grip = h("div", { cls: "fpane-grip", title: "Drag to resize" });
    this.el = h(
      "section",
      { cls: "pal floating fpane", attrs: { role: "group", "aria-label": name } },
      head,
      h("div", { cls: "fpane-body" }, this.canvas),
      grip,
    );
    this.renderer = new Renderer(this.canvas, this.plan, scene, PICTURE);
    views.addEventListener("click", () => {
      const r = views.getBoundingClientRect();
      openContextMenu(this.rows(), r.left, r.bottom + 4, views);
    });
    fit.addEventListener("click", () => void this.fit());
    main.addEventListener("click", () => this.handOver());
    roll.addEventListener("click", () => this.roll());
    close.addEventListener("click", () => this.close());
    for (const el of [head, this.canvas]) {
      el.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openContextMenu(this.rows(), e.clientX, e.clientY);
      });
    }
    this.el.addEventListener("pointerdown", () => this.raise(), { capture: true });
    head.addEventListener("dblclick", (e) => {
      if (!(e.target as Element).closest("button")) this.roll();
    });
    this.dragging(head, (dx, dy, from) => {
      this.box.x = from.x + dx;
      this.box.y = from.y + dy;
      this.place();
    });
    this.dragging(grip, (dx, dy, from) => {
      this.box.w = from.w + dx;
      this.box.h = from.h + dy;
      this.place();
      this.redraw();
    });
    this.lookAround();
    this.raise();
  }

  /** What the pane's title shows: its view's name. */
  private named(): string {
    if (this.kind === "plan") return "Top/Plan";
    if (this.through) return this.through.name;
    return STANDARD_VIEWS.find(([id]) => id === this.preset)?.[1] ?? "3D View";
  }

  /** Its view menu (the view button and a right-click). */
  private rows(): Row[] {
    return [
      { label: "Top/Plan", checked: () => this.kind === "plan", run: () => this.showPlan() },
      "-",
      ...STANDARD_VIEWS.map(([id, label]): Row => ({ label, checked: () => this.kind === "3d" && this.preset === id, run: () => void this.show3d(id) })),
      "-",
      { label: "Fit to Window", run: () => void this.fit() },
      { label: "Show in Main View", run: () => this.handOver() },
      "-",
      { label: this.rolled() ? "Unroll" : "Roll Up", run: () => this.roll() },
      { label: "Close Floating View Pane", run: () => this.close() },
    ];
  }

  /** Shows the plan from `at` (where the live plan is, to start with). */
  showPlan(at: PlanAt = host!.view): void {
    this.kind = "plan";
    this.preset = null;
    this.cam = null;
    this.through = null;
    this.projection = null;
    this.plan.setCenterAndScale(at.cx, at.cy, at.scale);
    this.retitle();
    this.redraw();
  }

  /** Shows the model in 3D from a standard view framing it, or from `cam`. */
  async show3d(preset: ViewPreset | null, cam?: CameraState): Promise<void> {
    const v = await ensure3d();
    if (!v || !this.el.isConnected) return;
    this.kind = "3d";
    this.preset = preset;
    this.through = null;
    this.projection = null;
    this.cam = cam ?? v.presetState(preset ?? "iso", this.canvas.clientWidth || START_W, this.canvas.clientHeight || START_H);
    this.retitle();
    this.redraw();
  }

  /** Looks through camera `c`, shaped as its picture, in its projection. */
  async lookThrough(c: CameraInfo, name: string): Promise<void> {
    const v = await ensure3d();
    if (!v || !this.el.isConnected) return;
    this.kind = "3d";
    this.preset = null;
    this.through = { id: c.id, name };
    this.projection = c.perspective ? "perspective" : "orthogonal";
    this.cam = cameraState(c);
    // the picture the camera's shape, as wide as a new pane
    const chrome = this.el.offsetHeight - this.canvas.clientHeight;
    this.box.h = Math.round(this.box.w / Math.max(c.aspect, 0.1)) + Math.max(0, chrome);
    this.place();
    this.retitle();
    this.redraw();
  }

  /** True while it follows a camera, so it draws again as the drawing changes. */
  followsCamera(): boolean {
    return this.through !== null;
  }

  private retitle(): void {
    this.title.textContent = this.named();
    this.el.classList.toggle("plan", this.kind === "plan");
  }

  /** The drawing fills the pane: the plan's drawn objects, or the visible model seen the way the pane looks. */
  async fit(): Promise<void> {
    if (this.kind === "plan") {
      const b = host!.scene.drawnBounds(store.activeLayerId);
      this.plan.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
      if (b) this.plan.fit(b);
      this.redraw();
      return;
    }
    const v = await ensure3d();
    if (!v || !this.cam) return;
    this.cam = v.framedState(sub(this.cam.position, this.cam.target), this.canvas.clientWidth, this.canvas.clientHeight);
    this.redraw();
  }

  /** The live plan or 3D view takes this pane's view. */
  handOver(): void {
    if (this.kind === "plan") host!.takePlan({ cx: this.plan.cx, cy: this.plan.cy, scale: this.plan.scale });
    else if (this.cam) host!.take3d(this.cam);
  }

  rolled(): boolean {
    return this.el.classList.contains("collapsed");
  }

  /** Rolls the pane up to its title, or unrolls it. */
  roll(): void {
    this.el.classList.toggle("collapsed");
    this.place();
    this.redraw();
  }

  close(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.frame);
    this.el.remove();
    const i = panes.indexOf(this);
    if (i >= 0) panes.splice(i, 1);
  }

  private raise(): void {
    this.el.style.zIndex = String(++topZ);
  }

  /** Puts the pane where its box says, inside the floating layer. */
  place(): void {
    const area = layer!;
    const W = area.clientWidth;
    const H = area.clientHeight;
    const b = this.box;
    b.w = clamp(b.w, MIN_W, Math.max(MIN_W, W));
    b.h = clamp(b.h, MIN_H, Math.max(MIN_H, H));
    // the title stays where it can be grabbed
    b.x = clamp(b.x, 0, Math.max(0, W - b.w));
    b.y = clamp(b.y, 0, Math.max(0, H - 36));
    Object.assign(this.el.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: this.rolled() ? "" : `${b.h}px` });
  }

  /** Draws the pane again at the next frame (as it is dragged), or after a pause (`soon`, as the drawing changes). */
  redraw(soon = false): void {
    if (soon) {
      clearTimeout(this.timer);
      this.timer = window.setTimeout(() => this.draw(), REDRAW_DELAY_MS);
      return;
    }
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw(): void {
    const w = this.canvas.clientWidth;
    const hgt = this.canvas.clientHeight;
    if (!host || this.rolled() || w === 0 || hgt === 0) return;
    if (this.kind === "plan") {
      this.renderer.renderNow(w, hgt, window.devicePixelRatio || 1);
      return;
    }
    if (!view3d) return;
    if (this.through) {
      // the camera as it stands now: it may have been moved or re-aimed (or deleted, and the view is kept)
      const id = this.through.id;
      const c = store.session?.doc.cameras().find((k) => k.id === id);
      if (c) this.cam = cameraState(c);
      else this.through = null;
    }
    if (!this.cam) return;
    const look = host.look();
    // Path Traced as a still Realistic picture: the live panes have the path tracer
    view3d.picture(this.cam, this.canvas, { mode: look.mode === "pathtraced" ? "realistic" : look.mode, projection: this.projection ?? look.projection });
  }

  /**
   * A drag in the picture pans the plan or orbits the model (Shift- or middle-drag pans it; the
   * right button opens the pane's menu, on a Mac as it is pressed); the wheel zooms; a double-click
   * hands the view over.
   */
  private lookAround(): void {
    const c = this.canvas;
    let last: { x: number; y: number; pan: boolean } | null = null;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      // no autoscroll for the middle button
      if (e.button === 1) e.preventDefault();
      c.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY, pan: this.kind === "plan" || e.button === 1 || e.shiftKey };
      c.classList.add("dragging");
    });
    c.addEventListener("pointermove", (e) => {
      if (!last || !c.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last = { ...last, x: e.clientX, y: e.clientY };
      if (this.kind === "plan") this.plan.pan(dx, dy);
      else if (this.cam) {
        this.preset = null;
        this.through = null;
        this.cam = last.pan ? pan3d(this.cam, dx, dy, c.clientHeight, this.ortho()) : orbit(this.cam, dx, dy);
        this.retitle();
      }
      this.redraw();
    });
    const end = (): void => {
      last = null;
      c.classList.remove("dragging");
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const px = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? c.clientHeight : 1);
        const factor = Math.exp(-px * WHEEL_PER_PX * (e.ctrlKey ? 4 : 1));
        if (this.kind === "plan") {
          const r = c.getBoundingClientRect();
          this.plan.zoomAt(e.clientX - r.left, e.clientY - r.top, factor);
        } else if (this.cam) {
          this.through = null;
          this.cam = zoom3d(this.cam, factor, this.ortho());
          this.retitle();
        }
        this.redraw();
      },
      { passive: false },
    );
    c.addEventListener("dblclick", () => this.handOver());
  }

  /** Whether its 3D picture is orthogonal: a camera's projection, else View > Projection's. */
  private ortho(): boolean {
    return (this.projection ?? host!.look().projection) === "orthogonal";
  }

  /** Calls `move` with how far the pointer has gone since it was pressed on `el`, and the box as it was. */
  private dragging(el: HTMLElement, move: (dx: number, dy: number, from: { x: number; y: number; w: number; h: number }) => void): void {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || (e.target as Element).closest("button")) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const from = { ...this.box };
      const x0 = e.clientX;
      const y0 = e.clientY;
      this.el.classList.add("dragging");
      const onMove = (m: PointerEvent): void => move(m.clientX - x0, m.clientY - y0, from);
      const onUp = (): void => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
        this.el.classList.remove("dragging");
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);
    });
  }
}

/** Sets up the floating panes over the drawing area (`parent`), drawn again as the drawing and its look change. */
export function mountFloatingPanes(parent: HTMLElement, h0: FloatingHost): void {
  host = h0;
  layer = h("div", { cls: "fpanes" });
  parent.append(layer);
  new ResizeObserver(() =>
    panes.forEach((p) => {
      p.place();
      p.redraw();
    }),
  ).observe(layer);
  store.on("session", () => {
    // they belong to the drawing they were made for
    for (const p of [...panes]) if (p.session !== store.session) p.close();
    // a camera's pane follows it as it is edited
    for (const p of panes) if (p.followsCamera()) p.redraw(true);
  });
  store.on(["session", "file", "selection", "layer", "class", "display", "attrs"], () => redrawFloating("plan"));
  store.on(["viz3d", "view3d", "layer", "class", "display", "selection"], () => redrawFloating("3d"));
}

/** A new pane over the drawing, cascaded from the last; null (said) when as many are open as may be. */
function newPane(): Pane | null {
  if (!host || !layer || !store.session) return null;
  if (panes.length >= MAX_PANES) {
    toast(`At most ${MAX_PANES} floating view panes are open at once: close one first.`, "info");
    return null;
  }
  const k = panes.length % 6;
  const pane = new Pane(`Floating View Pane ${++made}`, {
    x: layer.clientWidth - START_W - 16 - k * CASCADE,
    y: TOP_ROOM + k * CASCADE,
  });
  panes.push(pane);
  layer.append(pane.el);
  pane.place();
  return pane;
}

/** Closes every floating view pane: Reset Multiple View Panes. */
export function closeFloatingPanes(): void {
  for (const p of [...panes]) p.close();
}

/** View > Multiple View Panes > Create Floating View Pane: a new pane over the drawing, showing what the active view shows. */
export function createFloatingPane(): void {
  const pane = newPane();
  if (!pane || !host) return;
  if (!host.showing3d()) {
    pane.showPlan();
    return;
  }
  // from where the live 3D view looks
  pane.kind = "3d";
  void ensure3d().then((v) => (v?.visible ? pane.show3d(null, v.cameraState()) : pane.showPlan()));
}

/** Open Camera View in New Pane (a Renderworks camera's right-click menu): a new pane looking through camera `c`, titled `name`. */
export function openCameraPane(c: CameraInfo, name: string): void {
  const pane = newPane();
  if (!pane) return;
  pane.kind = "3d";
  void pane.lookThrough(c, name);
}

/** True while a floating pane shows the model in 3D: the model is then kept up to date as the drawing changes. */
export function floating3d(): boolean {
  return panes.some((p) => p.kind === "3d");
}

/** The floating panes of `kind` draw again soon (the drawing or its 3D model changed). */
export function redrawFloating(kind: "plan" | "3d"): void {
  for (const p of panes) if (p.kind === kind) p.redraw(true);
}
