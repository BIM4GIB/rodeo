// The Onscreen View Control, as Vectorworks has it: a cube in a corner of the drawing turned as the
// view is, its faces, edges and corners each a view to click (a face or corner the standard view
// it names; the face or corner of the view shown already, the opposite one), dragged to turn the
// 3D view about its centre as a flyover does, the wheel over it zooming, with the X, Y and Z axes
// beside it. Top/Plan shows its top; a 2D/3D toggle on the top face goes to Top/Plan, or from it back to
// the 3D view (where the top face is out of sight, the top bar's 2D and 3D do). A menu button that shows as
// the pointer nears it holds its settings (Show Onscreen View Control, Show Axes, Show Cube,
// Show Compass Ring, Position), kept in this browser as the application's settings; View > Onscreen
// View Control has them too. With several view panes it is in the active pane's corner. In a georeferenced
// drawing a compass ring lies round the cube's foot, N where true north is: it only shows, as Vectorworks'.

import "./viewControl.css";
import type { Vec3 } from "../core/index.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { documentGeoref, onGeoref } from "./georef.ts";
import { openContextMenu, type Row } from "./menu.ts";
import { whyNot } from "./menuReasons.ts";
import { store } from "./state.ts";
import type { View3D, ViewPreset } from "./view3d.ts";
import { activePaneRect, onActivePane } from "./viewPanes.ts";

export interface ViewControlDeps {
  /** the 3D view, once it has been built */
  view3d(): View3D | null;
  /** a standard view in the 3D view (built and shown when needed) */
  standardView(preset: ViewPreset): Promise<void>;
  /** the 3D view looking along `toward` (to the viewer), shown when needed */
  lookAlong(toward: Vec3): Promise<void>;
  /** Top/Plan: the 2D drawing */
  topPlan(): void;
  /** back to the 3D view as it was */
  show3d(): Promise<void>;
  /** zooms the view shown by `factor` (above 1 nearer) about its centre */
  zoom(factor: number): void;
}

type Corner = "bl" | "br" | "tl" | "tr";

interface Settings {
  readonly show: boolean;
  readonly axes: boolean;
  readonly cube: boolean;
  readonly compass: boolean;
  readonly position: Corner;
}

const STORAGE_KEY = "openvwx.viewControl";
const DEFAULTS: Settings = { show: true, axes: true, cube: true, compass: true, position: "bl" };
const CORNERS: readonly (readonly [Corner, string])[] = [
  ["tl", "Top Left"],
  ["tr", "Top Right"],
  ["bl", "Bottom Left"],
  ["br", "Bottom Right"],
];

/** the cube's half size, in the SVG's units */
const R = 25;
/** where a face's edge and corner cells give way to its middle, from its centre (1 at its edge) */
const SPLIT = 0.52;
/** a face's name: its font size, and its height on the face (1 is half the face) */
const LABEL_FONT = 10;
const LABEL_HEIGHT = 0.36;
/** on the top face: how far its name moves up for the 2D/3D toggle, and the toggle's place and half sizes (face units) */
const TOP_LABEL_LIFT = 0.24;
const TOGGLE_AT = 0.22;
const TOGGLE_HALF: readonly [number, number] = [0.48, 0.24];
const TOGGLE_TEXT = 0.3;
/** a drag this far (CSS px) turns the view; less is a click */
const DRAG_PX = 3;
/** degrees the view turns per CSS px dragged */
const TURN_PER_PX = 0.5;
/** the compass ring's radius and where its letters go, in the cube's half sizes */
const COMPASS_RADIUS = 1.75;
const COMPASS_LETTERS = 2.02;

/** The faces: outward normal, and the axes their name reads along (right, then down) seen from outside. */
const FACES: readonly { readonly name: string; readonly n: Vec3; readonly right: Vec3; readonly down: Vec3 }[] = [
  { name: "TOP", n: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0] },
  { name: "BOTTOM", n: [0, 0, -1], right: [1, 0, 0], down: [0, 1, 0] },
  { name: "FRONT", n: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1] },
  { name: "BACK", n: [0, 1, 0], right: [-1, 0, 0], down: [0, 0, -1] },
  { name: "LEFT", n: [-1, 0, 0], right: [0, -1, 0], down: [0, 0, -1] },
  { name: "RIGHT", n: [1, 0, 0], right: [0, 1, 0], down: [0, 0, -1] },
];

/** The standard views by the direction (to the viewer) they look along, as View3D's presets have them. */
const PRESETS: readonly (readonly [Vec3, ViewPreset])[] = [
  [[0, 0, 1], "top"],
  [[0, 0, -1], "bottom"],
  [[0, -1, 0], "front"],
  [[0, 1, 0], "back"],
  [[-1, 0, 0], "left"],
  [[1, 0, 0], "right"],
  [[1, -1, 1], "iso"],
  [[-1, -1, 1], "leftIso"],
  [[1, 1, 1], "rightRearIso"],
  [[-1, 1, 1], "leftRearIso"],
  [[1, -1, -1], "lowerRightIso"],
  [[-1, -1, -1], "lowerLeftIso"],
  [[1, 1, -1], "lowerRightRearIso"],
  [[-1, 1, -1], "lowerLeftRearIso"],
];

const AXES: readonly (readonly [string, Vec3, string])[] = [
  ["X", [1, 0, 0], "ovc-x"],
  ["Y", [0, 1, 0], "ovc-y"],
  ["Z", [0, 0, 1], "ovc-z"],
];

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (...vs: Vec3[]): Vec3 => vs.reduce<Vec3>((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]);
const scale = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const unit = (v: Vec3): Vec3 => scale(v, 1 / Math.hypot(...v));
const key = (v: Vec3): string => v.map((c) => Math.sign(Math.round(c * 1000))).join(",");

function load(): Settings {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const position = CORNERS.some(([c]) => c === r.position) ? (r.position as Corner) : DEFAULTS.position;
    return { show: r.show !== false, axes: r.axes !== false, cube: r.cube !== false, compass: r.compass !== false, position };
  } catch {
    return DEFAULTS;
  }
}

let settings: Settings = load();
let rerender: (() => void) | null = null;

function setSettings(next: Partial<Settings>): void {
  settings = { ...settings, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // storage blocked: the settings last for this visit
  }
  rerender?.();
}

/** The control's settings, for its menu button and View > Onscreen View Control. */
export function viewControlRows(): Row[] {
  return [
    { label: "Show Onscreen View Control", checked: () => settings.show, run: () => setSettings({ show: !settings.show }) },
    { label: "Show Axes", why: () => "Turn on Show Onscreen View Control first", enabled: () => settings.show, checked: () => settings.axes, run: () => setSettings({ axes: !settings.axes }) },
    { label: "Show Cube", why: () => "Turn on Show Onscreen View Control first", enabled: () => settings.show, checked: () => settings.cube, run: () => setSettings({ cube: !settings.cube }) },
    { label: "Show Compass Ring", why: whyNot([() => settings.show, "Turn on Show Onscreen View Control first"], [() => documentGeoref() !== null, "Set the drawing's location first: File › Document Settings › Georeferencing…"]), enabled: () => settings.show && documentGeoref() !== null, checked: () => settings.compass, run: () => setSettings({ compass: !settings.compass }) },
    {
      label: "Position",
      items: CORNERS.map(([c, label]): Row => ({ label, checked: () => settings.position === c, run: () => setSettings({ position: c }) })),
    },
  ];
}

/** The view's screen axes in the model: the 3D view's camera, or Top/Plan's (looking down, north up). */
function orientation(deps: ViewControlDeps): { right: Vec3; up: Vec3; toward: Vec3; plan: boolean } {
  const v = store.view3d ? deps.view3d() : null;
  if (!v) {
    // a rotated plan's screen axes lie turned in the model: the cube turns with it, its axes the unrotated ones
    const turn = appContext()?.view.rotation ?? 0;
    const c = Math.cos(turn);
    const s = Math.sin(turn);
    return { right: [c, -s, 0], up: [s, c, 0], toward: [0, 0, 1], plan: true };
  }
  const c = v.currentView();
  return { right: c.right, up: c.up, toward: c.toward, plan: false };
}

export function mountViewControl(host: HTMLElement, deps: ViewControlDeps): void {
  const svg = svgEl("svg", { class: "ovc-cube", viewBox: "-60 -60 120 120", role: "group", "aria-label": "Onscreen View Control" });
  const menuBtn = h("button", {
    cls: "ovc-menu",
    title: "Onscreen View Control Settings",
    html: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>',
    attrs: { type: "button", "aria-label": "Onscreen View Control Settings" },
  });
  const el = h("div", { cls: "ovc" }, svg, menuBtn);
  host.append(el);

  menuBtn.addEventListener("click", () => {
    const r = menuBtn.getBoundingClientRect();
    openContextMenu(viewControlRows(), r.left, r.bottom + 4, menuBtn);
  });
  /** The top face's 2D/3D toggle: Top/Plan, or from it back to the 3D view. */
  const toggle = (): void => {
    if (store.view3d) deps.topPlan();
    else void deps.show3d();
  };

  /** the direction each cell's paths stand for, by its key */
  const dirs = new Map<string, Vec3>();
  let current: string | null = null;

  const render = (): void => {
    const shown = store.session !== null;
    el.hidden = !shown;
    el.dataset.position = settings.position;
    el.classList.toggle("off", !settings.show);
    if (!shown) return;
    // in the active pane's corner: how far in from each side of the drawing area it is
    const pane = activePaneRect();
    const area = host.getBoundingClientRect();
    const inset = pane ? [pane.left - area.left, pane.top - area.top, area.right - pane.right, area.bottom - pane.bottom] : [0, 0, 0, 0];
    (["left", "top", "right", "bottom"] as const).forEach((side, i) => el.style.setProperty(`--pane-${side}`, `${Math.max(0, Math.round(inset[i]))}px`));
    const o = orientation(deps);
    // model point to the SVG: across the screen's right, down its up
    const at = (p: Vec3): [number, number] => [dot(p, o.right) * R, -dot(p, o.up) * R];
    const pts = (ps: Vec3[]): string => ps.map((p) => at(p).map((c) => c.toFixed(2)).join(",")).join(" ");
    const parts: SVGElement[] = [];
    dirs.clear();
    // in Top/Plan no 3D view is current: its top goes to the 3D view's Top
    current = o.plan ? null : key(nearestDir(o.toward));
    const axes = (): SVGElement[] => {
      if (!settings.axes) return [];
      const from: Vec3 = [-1.15, -1.15, -1.15];
      return AXES.flatMap(([label, d, cls]) => {
        const end = add(from, scale(d, 2.6));
        const [x0, y0] = at(from);
        const [x1, y1] = at(end);
        const [tx, ty] = at(add(from, scale(d, 2.85)));
        const t = svgEl("text", { class: `ovc-axis-label ${cls}`, x: tx.toFixed(2), y: ty.toFixed(2) });
        t.textContent = label;
        return [svgEl("line", { class: `ovc-axis ${cls}`, x1: x0, y1: y0, x2: x1, y2: y1 }), t];
      });
    };
    // the axes start behind the cube's corner nearest them, so they go in front when that corner faces the viewer
    const axesFront = dot([-1, -1, -1], o.toward) > 0;
    const located = settings.compass ? documentGeoref() : null;
    if (located) parts.push(compassRing(located.north, at, pts));
    if (!axesFront) parts.push(...axes());
    if (settings.cube) {
      for (const f of FACES) {
        const facing = dot(f.n, o.toward);
        if (facing <= 1e-3) continue;
        const corner = (u: number, v: number): Vec3 => add(f.n, scale(f.right, u), scale(f.down, v));
        const g = svgEl("g", { class: "ovc-face" });
        g.append(svgEl("polygon", { class: "ovc-face-fill", points: pts([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]) }));
        // lit from above and a little to the front right
        g.append(svgEl("polygon", { class: "ovc-face-shade", points: pts([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)]), "fill-opacity": (0.02 + 0.12 * Math.max(0, dot(f.n, unit([0.4, -0.5, 1])))).toFixed(3) }));
        // the name, laid on the face as the projection lays it (on the top face, above the toggle)
        const top = f.n[2] === 1;
        const [rx, ry] = at(f.right);
        const [dx, dy] = at(f.down);
        const laid = (text: string, cls: string, centre: Vec3, height: number): SVGTextElement => {
          const [ox, oy] = at(centre);
          const sz = height / LABEL_FONT;
          const t = svgEl("text", {
            class: cls,
            "font-size": LABEL_FONT,
            transform: `matrix(${[rx * sz, ry * sz, dx * sz, dy * sz, ox, oy].map((c) => c.toFixed(4)).join(" ")})`,
          });
          t.textContent = text;
          return t;
        };
        g.append(laid(f.name, "ovc-face-label", top ? add(f.n, scale(f.down, -TOP_LABEL_LIFT)) : f.n, LABEL_HEIGHT));
        // three by three cells: the middle the face, the sides its edges, the corners the cube's corners
        const cuts = [-1, -SPLIT, SPLIT, 1];
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            const dir = add(f.n, i === 1 ? [0, 0, 0] : scale(f.right, i - 1), j === 1 ? [0, 0, 0] : scale(f.down, j - 1));
            const k = key(dir);
            dirs.set(k, dir);
            const cell = svgEl("polygon", {
              class: `ovc-cell${k === current ? " current" : ""}`,
              points: pts([corner(cuts[i], cuts[j]), corner(cuts[i + 1], cuts[j]), corner(cuts[i + 1], cuts[j + 1]), corner(cuts[i], cuts[j + 1])]),
              "data-dir": k,
            });
            const title = svgEl("title");
            title.textContent = viewName(dir, k === current);
            cell.append(title);
            g.append(cell);
          }
        }
        if (top) {
          // the 2D/3D toggle, over the face's middle
          const at0 = add(f.n, scale(f.down, TOGGLE_AT));
          const [hw, hh] = TOGGLE_HALF;
          const c = (u: number, v: number): Vec3 => add(at0, scale(f.right, u), scale(f.down, v));
          const btn = svgEl("g", { class: "ovc-toggle", role: "button", "aria-label": o.plan ? "3D view" : "Top/Plan" });
          const fill = svgEl("polygon", { class: "ovc-toggle-fill", "data-toggle": "", points: pts([c(-hw, -hh), c(hw, -hh), c(hw, hh), c(-hw, hh)]) });
          const tip = svgEl("title");
          tip.textContent = o.plan ? "3D: back to the 3D view" : "2D: Top/Plan";
          fill.append(tip);
          btn.append(fill, laid(o.plan ? "3D" : "2D", "ovc-toggle-label", at0, TOGGLE_TEXT));
          g.append(btn);
        }
        parts.push(g);
      }
    }
    if (axesFront) parts.push(...axes());
    svg.replaceChildren(...parts);
  };
  rerender = render;

  // a corner or edge lights up on every face it touches
  svg.addEventListener("pointerover", (e) => {
    const k = (e.target as Element).getAttribute?.("data-dir");
    for (const c of svg.querySelectorAll(".ovc-cell")) c.classList.toggle("hover", k !== null && c.getAttribute("data-dir") === k);
  });
  svg.addEventListener("pointerleave", () => {
    for (const c of svg.querySelectorAll(".ovc-cell.hover")) c.classList.remove("hover");
  });

  // a click goes to a view; a drag turns the 3D view about its centre, as a flyover
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    svg.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    let last = start;
    let turning = false;
    let ready: Promise<void> | null = null;
    const onMove = (ev: PointerEvent): void => {
      if (!turning && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < DRAG_PX) return;
      if (!turning) {
        turning = true;
        el.classList.add("turning");
        // from Top/Plan the flyover starts from the 3D view's Top
        if (!store.view3d) ready = deps.standardView("top");
      }
      const dx = ev.clientX - last.x;
      const dy = ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
      const turn = (): void => deps.view3d()?.rotateView(dy * TURN_PER_PX, 0, dx * TURN_PER_PX);
      if (ready) void ready.then(turn);
      else turn();
    };
    const onUp = (ev: PointerEvent): void => {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      svg.removeEventListener("pointercancel", onUp);
      el.classList.remove("turning");
      if (turning || ev.type === "pointercancel") return;
      if ((e.target as Element).hasAttribute?.("data-toggle")) {
        toggle();
        return;
      }
      const k = (e.target as Element).getAttribute?.("data-dir");
      const dir = k ? dirs.get(k) : undefined;
      if (dir) void go(k === current ? scale(dir, -1) : dir);
    };
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
    svg.addEventListener("pointercancel", onUp);
  });

  // the wheel over it zooms the view about its centre, as the wheel over the drawing does about the pointer
  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      deps.zoom(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 16 : 1) * 0.0015));
    },
    { passive: false },
  );

  /** To the standard view along `dir` where there is one, else along it. */
  const go = async (dir: Vec3): Promise<void> => {
    const preset = presetOf(dir);
    if (preset) await deps.standardView(preset);
    else await deps.lookAlong(unit(dir));
    render();
  };

  let watched: View3D | null = null;
  const watch = (): void => {
    const v = deps.view3d();
    if (v && v !== watched) {
      watched = v;
      v.onCameraChange(() => requestAnimationFrame(render));
    }
    render();
  };
  store.on(["session", "view3d"], watch);
  onGeoref(render);
  let shownTurn = 0;
  store.on("view", () => {
    const turn = appContext()?.view.rotation ?? 0;
    if (turn === shownTurn) return;
    shownTurn = turn;
    render();
  });
  onActivePane(render);
  watch();
}

/** The compass ring round the cube's foot, N where true north is (`north` degrees clockwise of the drawing's Y). */
function compassRing(north: number, at: (p: Vec3) => [number, number], pts: (ps: Vec3[]) => string): SVGElement {
  const t = (north * Math.PI) / 180;
  const n: Vec3 = [Math.sin(t), Math.cos(t), 0];
  const e: Vec3 = [Math.cos(t), -Math.sin(t), 0];
  const foot: Vec3 = [0, 0, -1];
  const on = (r: number, degrees: number): Vec3 => {
    const a = (degrees * Math.PI) / 180;
    return add(foot, scale(n, r * Math.cos(a)), scale(e, r * Math.sin(a)));
  };
  const g = svgEl("g", { class: "ovc-compass" });
  g.append(svgEl("polygon", { class: "ovc-compass-ring", points: pts(Array.from({ length: 72 }, (_, i) => on(COMPASS_RADIUS, i * 5))) }));
  for (let i = 0; i < 12; i++) g.append(svgEl("polyline", { class: "ovc-compass-tick", points: pts([on(COMPASS_RADIUS, i * 30), on(COMPASS_RADIUS - (i % 3 ? 0.08 : 0.18), i * 30)]) }));
  (["N", "E", "S", "W"] as const).forEach((letter, i) => {
    const [x, y] = at(on(COMPASS_LETTERS, i * 90));
    const text = svgEl("text", { class: `ovc-compass-letter${letter === "N" ? " north" : ""}`, x: x.toFixed(2), y: y.toFixed(2) });
    text.textContent = letter;
    g.append(text);
  });
  return g;
}

/** The direction among the faces', edges' and corners' nearest `toward`. */
function nearestDir(toward: Vec3): Vec3 {
  let best: Vec3 = [0, 0, 1];
  let bestDot = -Infinity;
  for (const x of [-1, 0, 1]) {
    for (const y of [-1, 0, 1]) {
      for (const z of [-1, 0, 1]) {
        if (x === 0 && y === 0 && z === 0) continue;
        const d = dot(unit([x, y, z]), toward);
        if (d > bestDot) {
          bestDot = d;
          best = [x, y, z];
        }
      }
    }
  }
  // only a view straight along one counts as the current one
  return bestDot > 0.9995 ? best : [0, 0, 0];
}

function presetOf(dir: Vec3): ViewPreset | null {
  const k = key(dir);
  return PRESETS.find(([d]) => key(d) === k)?.[1] ?? null;
}

const PRESET_NAMES: Partial<Record<ViewPreset, string>> = {
  top: "Top",
  bottom: "Bottom",
  front: "Front",
  back: "Back",
  left: "Left",
  right: "Right",
  iso: "Right Isometric",
  leftIso: "Left Isometric",
  rightRearIso: "Right Rear Isometric",
  leftRearIso: "Left Rear Isometric",
  lowerRightIso: "Lower Right Isometric",
  lowerLeftIso: "Lower Left Isometric",
  lowerRightRearIso: "Lower Right Rear Isometric",
  lowerLeftRearIso: "Lower Left Rear Isometric",
};

/** A cell's tooltip: the view it goes to (the opposite one for the view shown). */
function viewName(dir: Vec3, isCurrent: boolean): string {
  const to = isCurrent ? scale(dir, -1) : dir;
  const preset = presetOf(to);
  if (preset) return PRESET_NAMES[preset] ?? preset;
  const names = FACES.filter((f) => dot(f.n, to) > 0).map((f) => f.name[0] + f.name.slice(1).toLowerCase());
  return `${names.join(" and ")} edge`;
}
