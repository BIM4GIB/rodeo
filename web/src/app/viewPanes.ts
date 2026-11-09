// View > Multiple View Panes, as Vectorworks' multiple view panes: the drawing area as one pane, or as two,
// three or four, all drawn at once, each a plan or a 3D view. A new arrangement has the plan in the
// first (with three or four, the large one, on whichever side the arrangement puts it) and a 3D view
// in each of the others (Front, Right and an isometric view to start with). One pane is active,
// ringed in the accent: the render mode, the zoom and Fit act on it, as they act on the one view
// shown alone; Top/Plan, 3D View and the standard views make the pane of their kind the active one,
// turning the active pane into one only when no pane is. The live plan (drawing, editing) is in the
// plan pane last made active, and the live 3D view (orbiting, picking, walking) in the 3D pane last
// made active; every other pane shows the drawing from where its view was left, drawn again as it
// changes. A click in a pane showing a picture makes it the active one (that click does nothing
// else). Each pane has a chip in its corner naming what it shows, whose menu shows the plan or the
// 3D view there, turns it to a standard view or closes it. The dividers drag, a double-click on one
// shares the area evenly, and the arrangement is kept in this browser and with saved workspaces.
//
// View > Multiple View Panes has Vectorworks' commands too: Enable Multiple View Panes goes from
// one pane to the last arrangement of several and back; Split Horizontally and Split Vertically
// cut the active pane in two with a level or an upright divider, the new half showing what it
// showed; Close Active View Pane gives its room to its neighbours. They go as far as the
// arrangements above reach: four panes at most, and a row or column of three small panes splits
// no further. Create Floating View Pane opens one more view of the drawing, floating over it
// (floatingPanes.ts).

import "./viewPanes.css";
import { h } from "./dom.ts";
import { UI_ICON } from "./icons.ts";
import { menuButton, type Row } from "./menu.ts";
import { store } from "./state.ts";
import type { ViewPreset } from "./view3d.ts";

export type PaneLayout =
  | "single"
  | "side"
  | "stacked"
  | "three"
  | "threeRight"
  | "threeTop"
  | "threeBottom"
  | "four"
  | "fourLeft"
  | "fourRight"
  | "fourTop"
  | "fourBottom";

/** What a pane shows: the plan, or the model in 3D. */
export type PaneKind = "plan" | "3d";

/** An arrangement as kept: the layout, where its dividers stand and what each pane shows. */
export interface PaneArrangement {
  readonly layout: PaneLayout;
  readonly x: number;
  readonly y: number;
  readonly kinds: readonly PaneKind[];
}

const STORAGE_KEY = "openvwx.viewPanes";
/** the least of the area a pane keeps across a divider, as a fraction */
const MIN_SHARE = 0.15;
/** half the gap between panes, px */
const GAP = 3;

/** The arrangements in menu order, a separator before each new number of panes. */
export const PANE_LAYOUTS: readonly (readonly [PaneLayout, string])[] = [
  ["single", "Single Pane"],
  ["side", "Two Panes Side by Side"],
  ["stacked", "Two Panes Stacked"],
  ["three", "Three Panes, Plan on the Left"],
  ["threeRight", "Three Panes, Plan on the Right"],
  ["threeTop", "Three Panes, Plan on Top"],
  ["threeBottom", "Three Panes, Plan Below"],
  ["four", "Four Panes"],
  ["fourLeft", "Four Panes, Plan on the Left"],
  ["fourRight", "Four Panes, Plan on the Right"],
  ["fourTop", "Four Panes, Plan on Top"],
  ["fourBottom", "Four Panes, Plan Below"],
];

/** The view each 3D pane starts with, by pane (the first is the plan). */
const TWO: readonly ViewPreset[] = ["iso"];
const THREE: readonly ViewPreset[] = ["front", "iso"];
const FOUR: readonly ViewPreset[] = ["front", "right", "iso"];
const START_VIEWS: Readonly<Record<PaneLayout, readonly ViewPreset[]>> = {
  single: [],
  side: TWO,
  stacked: TWO,
  three: THREE,
  threeRight: THREE,
  threeTop: THREE,
  threeBottom: THREE,
  four: FOUR,
  fourLeft: FOUR,
  fourRight: FOUR,
  fourTop: FOUR,
  fourBottom: FOUR,
};

/** A pane's place in the drawing area, as fractions of its width and height. */
interface Frac {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

let layout: PaneLayout = "single";
/** where the upright divider stands, and the level one, as fractions */
let shareX = 0.5;
let shareY = 0.5;
/** what each pane shows */
let kinds: PaneKind[] = ["plan"];
/** the 3D pane holding the live 3D view, and the plan pane holding the live plan; -1 where there is none */
let live = -1;
let livePlan = 0;
const listeners = new Set<() => void>();
let place: (() => void) | null = null;
/** the last arrangement of several panes, which Enable Multiple View Panes goes back to */
let lastMulti: PaneArrangement | null = null;

load();

/** What a new arrangement's panes show: the plan in the first, 3D views in the others. */
function startKinds(l: PaneLayout): PaneKind[] {
  return ["plan", ...START_VIEWS[l].map((): PaneKind => "3d")];
}

/** An arrangement read from storage or a workspace: an unknown layout is one pane, a divider out of range halfway, kinds that don't fit the layout its own. */
export function readPaneArrangement(data: unknown): PaneArrangement {
  const d = (typeof data === "object" && data !== null ? data : {}) as { layout?: unknown; x?: unknown; y?: unknown; kinds?: unknown };
  const known = PANE_LAYOUTS.find(([l]) => l === d.layout);
  const l = known ? known[0] : "single";
  const fraction = (v: unknown): number => (typeof v === "number" && v >= MIN_SHARE && v <= 1 - MIN_SHARE ? v : 0.5);
  const fits =
    Array.isArray(d.kinds) && d.kinds.length === START_VIEWS[l].length + 1 && d.kinds.every((k) => k === "plan" || k === "3d");
  return { layout: l, x: fraction(d.x), y: fraction(d.y), kinds: fits ? (d.kinds as PaneKind[]) : startKinds(l) };
}

/** The live plan in the first plan pane, the live 3D view in the last 3D pane. */
function startLive(): void {
  livePlan = kinds.indexOf("plan");
  live = kinds.lastIndexOf("3d");
}

function load(): void {
  try {
    const kept = readPaneArrangement(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
    layout = kept.layout;
    shareX = kept.x;
    shareY = kept.y;
    kinds = [...kept.kinds];
  } catch {
    // no storage, or nothing kept: one pane
  }
  startLive();
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(paneArrangement()));
  } catch {
    // kept for this visit only
  }
}

/** The arrangement now, as a workspace keeps it. */
export function paneArrangement(): PaneArrangement {
  return { layout, x: shareX, y: shareY, kinds: [...kinds] };
}

/** Puts an arrangement in place (a workspace chosen); a new layout or new kinds start the live views afresh. */
export function setPaneArrangement(next: PaneArrangement): void {
  const changed = next.layout !== layout || next.kinds.some((k, i) => k !== kinds[i]);
  if (!changed && next.x === shareX && next.y === shareY) return;
  layout = next.layout;
  shareX = next.x;
  shareY = next.y;
  kinds = [...next.kinds];
  if (changed) startLive();
  persist();
  place?.();
  if (changed) for (const f of listeners) f();
}

export function paneLayout(): PaneLayout {
  return layout;
}

/** How many panes the drawing area holds. */
export function paneCount(): number {
  return START_VIEWS[layout].length + 1;
}

/** True while the drawing area holds more than one pane. */
export function multiPane(): boolean {
  return layout !== "single";
}

/** The 3D pane holding the live 3D view, -1 when no pane is a 3D one. */
export function livePane(): number {
  return live;
}

/** The plan pane holding the live plan, -1 when no pane is a plan. */
export function livePlanPane(): number {
  return livePlan;
}

/** What pane `i` shows. */
export function paneKind(i: number): PaneKind {
  return kinds[i] ?? "plan";
}

/** The pane the active view is in: the live 3D view's while it is active, else the live plan's. */
function activePane(): number {
  const a = store.view3d ? live : livePlan;
  return a >= 0 ? a : Math.max(live, livePlan);
}

/** The standard view pane `i` starts with as a 3D view. */
export function startView(i: number): ViewPreset {
  return START_VIEWS[layout][i - 1] ?? "iso";
}

/** A new arrangement starts the live plan in its first pane and the live 3D view in its last, the others in their standard views. */
export function setPaneLayout(next: PaneLayout): void {
  if (next === layout) return;
  if (multiPane()) lastMulti = paneArrangement();
  layout = next;
  kinds = startKinds(next);
  startLive();
  persist();
  place?.();
  for (const f of listeners) f();
}

/** Puts the live 3D view in pane `i` (one of the 3D panes). */
export function setLivePane(i: number): void {
  if (kinds[i] !== "3d" || i === live) return;
  live = i;
  place?.();
}

/** Puts the live plan in pane `i` (one of the plan panes). */
export function setLivePlanPane(i: number): void {
  if (kinds[i] !== "plan" || i === livePlan) return;
  livePlan = i;
  place?.();
}

/**
 * Turns pane `i` into a plan or a 3D view, which takes the live one of its kind; the live one of
 * the other kind it held moves to the pane of that kind last in line (none when none is left).
 */
export function setPaneKind(i: number, kind: PaneKind): void {
  if (i < 0 || i >= kinds.length || kinds[i] === kind) return;
  kinds[i] = kind;
  if (kind === "plan") {
    livePlan = i;
    if (live === i) live = kinds.lastIndexOf("3d");
  } else {
    live = i;
    if (livePlan === i) livePlan = kinds.indexOf("plan");
  }
  persist();
  place?.();
}

/** Calls `f` when the arrangement changes; returns the function that stops it. */
export function onPanes(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** The arrangement Reset Multiple View Panes goes back to. */
const DEFAULT_LAYOUT: PaneLayout = "four";
const resetListeners = new Set<() => void>();

/**
 * View > Multiple View Panes > Reset Multiple View Panes: Four Panes, the dividers halfway, each pane
 * back to its standard view (the plan, Front, Right and an isometric view), even when the layout is
 * already Four Panes.
 */
export function resetPanes(): void {
  layout = DEFAULT_LAYOUT;
  shareX = 0.5;
  shareY = 0.5;
  kinds = startKinds(layout);
  startLive();
  persist();
  place?.();
  for (const f of listeners) f();
  for (const f of resetListeners) f();
}

/** Calls `f` after Reset Multiple View Panes, the new arrangement in place; returns the function that stops it. */
export function onPanesReset(f: () => void): () => void {
  resetListeners.add(f);
  return () => resetListeners.delete(f);
}

/** A change of arrangement: the new layout and, for each of its panes, the pane of the old one it shows. */
type Change = readonly [PaneLayout, readonly number[]];

/** Split Vertically: by layout, what splitting each of its panes with an upright divider makes (none where no layout fits). */
const SPLIT_UPRIGHT: Partial<Record<PaneLayout, readonly (Change | null)[]>> = {
  single: [["side", [0, 0]]],
  stacked: [["threeBottom", [1, 0, 0]], ["threeTop", [0, 1, 1]]],
  threeTop: [["four", [0, 0, 1, 2]], ["fourTop", [0, 1, 1, 2]], ["fourTop", [0, 1, 2, 2]]],
  threeBottom: [["four", [1, 2, 0, 0]], ["fourBottom", [0, 1, 1, 2]], ["fourBottom", [0, 1, 2, 2]]],
};

/** Split Horizontally: the same with a level divider. */
const SPLIT_LEVEL: Partial<Record<PaneLayout, readonly (Change | null)[]>> = {
  single: [["stacked", [0, 0]]],
  side: [["threeRight", [1, 0, 0]], ["three", [0, 1, 1]]],
  three: [["four", [0, 1, 0, 2]], ["fourLeft", [0, 1, 1, 2]], ["fourLeft", [0, 1, 2, 2]]],
  threeRight: [["four", [1, 0, 2, 0]], ["fourRight", [0, 1, 1, 2]], ["fourRight", [0, 1, 2, 2]]],
};

/** Close Active View Pane: by layout, what closing each of its panes leaves (the large pane beside three small ones doesn't close). */
const CLOSE: Partial<Record<PaneLayout, readonly (Change | null)[]>> = {
  side: [["single", [1]], ["single", [0]]],
  stacked: [["single", [1]], ["single", [0]]],
  three: [["stacked", [1, 2]], ["side", [0, 2]], ["side", [0, 1]]],
  threeRight: [["stacked", [1, 2]], ["side", [2, 0]], ["side", [1, 0]]],
  threeTop: [["side", [1, 2]], ["stacked", [0, 2]], ["stacked", [0, 1]]],
  threeBottom: [["side", [1, 2]], ["stacked", [2, 0]], ["stacked", [1, 0]]],
  four: [["three", [2, 1, 3]], ["threeRight", [3, 0, 2]], ["three", [0, 1, 3]], ["threeRight", [1, 0, 2]]],
  fourLeft: [null, ["three", [0, 2, 3]], ["three", [0, 1, 3]], ["three", [0, 1, 2]]],
  fourRight: [null, ["threeRight", [0, 2, 3]], ["threeRight", [0, 1, 3]], ["threeRight", [0, 1, 2]]],
  fourTop: [null, ["threeTop", [0, 2, 3]], ["threeTop", [0, 1, 3]], ["threeTop", [0, 1, 2]]],
  fourBottom: [null, ["threeBottom", [0, 2, 3]], ["threeBottom", [0, 1, 3]], ["threeBottom", [0, 1, 2]]],
};

/** What `table` makes of pane `i` (the active one unless said), or null. */
function changeOf(table: Partial<Record<PaneLayout, readonly (Change | null)[]>>, i = activePane()): Change | null {
  return table[layout]?.[i] ?? null;
}

/**
 * Puts `change` in place: each pane shows what the old pane it comes from showed, and the live
 * plan and 3D view stay in the panes they were in (the first made from them).
 */
function rearrange([next, from]: Change): void {
  if (multiPane()) lastMulti = paneArrangement();
  const old = kinds;
  const at = (i: number): number => from.indexOf(i);
  const plan = at(livePlan);
  const view = at(live);
  layout = next;
  kinds = from.map((i) => old[i] ?? "plan");
  livePlan = plan >= 0 && kinds[plan] === "plan" ? plan : kinds.indexOf("plan");
  live = view >= 0 && kinds[view] === "3d" ? view : kinds.lastIndexOf("3d");
  persist();
  place?.();
  for (const f of listeners) f();
}

export function canSplitPane(upright: boolean): boolean {
  return changeOf(upright ? SPLIT_UPRIGHT : SPLIT_LEVEL) !== null;
}

/** Split Vertically (an upright divider) or Split Horizontally (a level one): the active pane in two. */
export function splitPane(upright: boolean): void {
  const change = changeOf(upright ? SPLIT_UPRIGHT : SPLIT_LEVEL);
  if (change) rearrange(change);
}

export function canClosePane(i = activePane()): boolean {
  return changeOf(CLOSE, i) !== null;
}

/**
 * Close Active View Pane, or a pane's chip's Close Pane: pane `i`'s room goes to its neighbours.
 * Down to one pane, that pane shows what it showed: store.view3d says which before the panes are
 * put in place, so they keep the 3D view or hide it.
 */
export function closePane(i = activePane()): void {
  const change = changeOf(CLOSE, i);
  if (!change) return;
  const [next, from] = change;
  const to3d = next === "single" ? kinds[from[0]] === "3d" : store.view3d;
  const flip = to3d !== store.view3d;
  store.view3d = to3d;
  rearrange(change);
  if (flip) store.emit("view3d");
}

/** Enable Multiple View Panes: one pane, or back to the last arrangement of several (two side by side at first). */
export function toggleMultiplePanes(): void {
  if (multiPane()) {
    setPaneLayout("single");
  } else if (lastMulti) {
    setPaneArrangement(lastMulti);
  } else {
    setPaneLayout("side");
  }
}

/** The Multiple View Panes commands, before the arrangements. */
function commandRows(enabled: () => boolean): Row[] {
  return [
    { label: "Enable Multiple View Panes", enabled, checked: multiPane, run: toggleMultiplePanes },
    { label: "Split Horizontally", enabled: () => enabled() && canSplitPane(false), run: () => splitPane(false) },
    { label: "Split Vertically", enabled: () => enabled() && canSplitPane(true), run: () => splitPane(true) },
    { label: "Close Active View Pane", why: () => "Only one view pane is open", enabled: () => enabled() && canClosePane(), run: () => closePane() },
    {
      label: "Create Floating View Pane",
      enabled: () => enabled() && store.session !== null,
      run: () => void import("./floatingPanes.ts").then((m) => m.createFloatingPane()),
    },
    {
      label: "Reset Multiple View Panes",
      enabled,
      run: () => {
        resetPanes();
        void import("./floatingPanes.ts").then((m) => m.closeFloatingPanes());
      },
    },
    // Rodeo's panes always show the same layer and class visibilities and clip cube: nothing to turn off or on
    { label: "Use Same Visibilities in All Panes", why: () => "Rodeo's panes always share their visibilities", enabled: () => false },
    "-",
  ];
}

/** The arrangements, each with a picture of itself, the current one highlighted: View > Multiple View Panes and the View bar's pop-up. */
export function paneRows(enabled: () => boolean): Row[] {
  const rows: Row[] = commandRows(enabled);
  let panes = 1;
  for (const [id, label] of PANE_LAYOUTS) {
    if (START_VIEWS[id].length + 1 !== panes) rows.push("-");
    panes = START_VIEWS[id].length + 1;
    rows.push({ label, icon: layoutIcon(id), enabled, checked: () => layout === id, run: () => setPaneLayout(id) });
  }
  return rows;
}

/** A layout drawn small: its panes, the plan's filled. */
function layoutIcon(l: PaneLayout): string {
  const [x0, y0, W, H] = [3.5, 5, 17, 14];
  const panes = fractions(l, 0.5, 0.5)
    .map((f, i) => {
      const r = (v: number) => +v.toFixed(2);
      const fill = i === 0 ? ' fill="currentColor" fill-opacity="0.35"' : "";
      return `<rect x="${r(x0 + f.x * W)}" y="${r(y0 + f.y * H)}" width="${r(f.w * W)}" height="${r(f.h * H)}"${fill}/>`;
    })
    .join("");
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" aria-hidden="true">${panes}</svg>`;
}

/** A third of the way, for the three small panes beside a large one, which share their side evenly. */
const THIRD = 1 / 3;

/** Each pane's place in `l`, as fractions of the drawing area, the dividers at `x` and `y`; the plan's first. */
function fractions(l: PaneLayout, x: number, y: number): Frac[] {
  switch (l) {
    case "side":
      return [{ x: 0, y: 0, w: x, h: 1 }, { x, y: 0, w: 1 - x, h: 1 }];
    case "stacked":
      return [{ x: 0, y: 0, w: 1, h: y }, { x: 0, y, w: 1, h: 1 - y }];
    case "three":
      return [{ x: 0, y: 0, w: x, h: 1 }, { x, y: 0, w: 1 - x, h: y }, { x, y, w: 1 - x, h: 1 - y }];
    case "threeRight":
      return [{ x, y: 0, w: 1 - x, h: 1 }, { x: 0, y: 0, w: x, h: y }, { x: 0, y, w: x, h: 1 - y }];
    case "threeTop":
      return [{ x: 0, y: 0, w: 1, h: y }, { x: 0, y, w: x, h: 1 - y }, { x, y, w: 1 - x, h: 1 - y }];
    case "threeBottom":
      return [{ x: 0, y, w: 1, h: 1 - y }, { x: 0, y: 0, w: x, h: y }, { x, y: 0, w: 1 - x, h: y }];
    case "four":
      return [{ x: 0, y: 0, w: x, h: y }, { x, y: 0, w: 1 - x, h: y }, { x: 0, y, w: x, h: 1 - y }, { x, y, w: 1 - x, h: 1 - y }];
    case "fourLeft":
      return [{ x: 0, y: 0, w: x, h: 1 }, ...[0, 1, 2].map((k) => ({ x, y: k * THIRD, w: 1 - x, h: THIRD }))];
    case "fourRight":
      return [{ x, y: 0, w: 1 - x, h: 1 }, ...[0, 1, 2].map((k) => ({ x: 0, y: k * THIRD, w: x, h: THIRD }))];
    case "fourTop":
      return [{ x: 0, y: 0, w: 1, h: y }, ...[0, 1, 2].map((k) => ({ x: k * THIRD, y, w: THIRD, h: 1 - y }))];
    case "fourBottom":
      return [{ x: 0, y, w: 1, h: 1 - y }, ...[0, 1, 2].map((k) => ({ x: k * THIRD, y: 0, w: THIRD, h: y }))];
    default:
      return [{ x: 0, y: 0, w: 1, h: 1 }];
  }
}

/**
 * The span of each divider that drags, as fractions along it (the upright one stands at `x`, the
 * level one at `y`), or null where the layout hasn't one; the three small panes beside a large one
 * share their side evenly, with no divider of their own.
 */
function dividers(l: PaneLayout, x: number, y: number): { upright: readonly [number, number] | null; level: readonly [number, number] | null } {
  const whole = [0, 1] as const;
  switch (l) {
    case "side":
    case "fourLeft":
    case "fourRight":
      return { upright: whole, level: null };
    case "stacked":
    case "fourTop":
    case "fourBottom":
      return { upright: null, level: whole };
    case "three":
      return { upright: whole, level: [x, 1] };
    case "threeRight":
      return { upright: whole, level: [0, x] };
    case "threeTop":
      return { upright: [y, 1], level: whole };
    case "threeBottom":
      return { upright: [0, y], level: whole };
    case "four":
      return { upright: whole, level: whole };
    default:
      return { upright: null, level: null };
  }
}

export interface PaneHooks {
  /** the plan pane's size has changed */
  resized(): void;
  /** a click in a pane showing a picture: it is to take the live view of its kind */
  activate(index: number): void;
  /** the panes have moved or changed size: the pictures are to be drawn again */
  placed(): void;
  /** the standard view 3D pane `index` looks from, by name ("Right Isometric"), or null (a plan, or a view turned from them) */
  view(index: number): string | null;
  /** the rows of pane `index`'s chip menu */
  menu(index: number): readonly Row[];
}

/** The canvases the panes without a live view show their picture on, by pane. */
const pictures: HTMLCanvasElement[] = [];
/** the ring round the active pane, and who follows where it is */
let activeRing: HTMLElement | null = null;
const ringListeners = new Set<() => void>();

/** Where the active pane is on screen while there are several, else null. */
export function activePaneRect(): DOMRect | null {
  return multiPane() && activeRing ? activeRing.getBoundingClientRect() : null;
}

/** Calls `f` whenever the active pane moves: another pane made active, or the panes placed again. */
export function onActivePane(f: () => void): () => void {
  ringListeners.add(f);
  return () => ringListeners.delete(f);
}

/** The canvas pane `i` shows its picture on, while it hasn't a live view. */
export function pictureOf(i: number): HTMLCanvasElement | null {
  return multiPane() && i >= 0 && i < paneCount() && i !== live && i !== livePlan ? (pictures[i] ?? null) : null;
}

/** the chip naming each pane, in its top-left corner */
const chips: HTMLButtonElement[] = [];
/** names the chips again (relabelPanes), once the panes are mounted */
let relabel: (() => void) | null = null;
/** how far a chip stands in from its pane's corner, and below what it steps under, CSS px */
const CHIP_INSET = 8;
/** what a chip mustn't sit under: the View bar, the Onscreen View Control's cube and the bars over the drawing while editing */
const CHIP_OBSTACLES = "#viewbar > .pill, .ovc:not([hidden]) .ovc-cube, .edit-bars > :not([hidden])";

/** Names the panes' chips again: called as the live 3D view moves, so a 3D pane's chip follows its view. */
export function relabelPanes(): void {
  relabel?.();
}

/**
 * Lays the panes out in `wrap`: the drawing's canvas and its text editors in the first, the 3D
 * view's host in the live pane, a picture in each other 3D pane, the dividers between them, the
 * ring round the active one and each pane's chip.
 */
export function mountPanes(wrap: HTMLElement, hooks: PaneHooks): void {
  const canvas = wrap.querySelector<HTMLElement>("#canvas")!;
  const text = wrap.querySelector<HTMLElement>(".text-host")!;
  const host = wrap.querySelector<HTMLElement>(".view3d-host")!;
  const across = h("div", { cls: "pane-divider upright", attrs: { role: "separator", "aria-orientation": "vertical", "aria-label": "Resize the view panes" } });
  const along = h("div", { cls: "pane-divider level", attrs: { role: "separator", "aria-orientation": "horizontal", "aria-label": "Resize the view panes" } });
  const ring = h("div", { cls: "pane-ring", attrs: { "aria-hidden": "true" } });
  activeRing = ring;
  for (let i = 0; i <= 3; i++) {
    const c = h("canvas", { cls: "pane-picture" }) as HTMLCanvasElement;
    c.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      hooks.activate(i);
    });
    pictures[i] = c;
  }
  // each pane's chip: what it shows, and a menu to show the other kind there, a standard view, or close it
  const kindTexts: HTMLElement[] = [];
  const viewTexts: HTMLElement[] = [];
  /** what each chip says now, in English, so it is written again only when that changes */
  const said: string[] = [];
  for (let i = 0; i <= 3; i++) {
    kindTexts[i] = h("span", { cls: "pane-chip-kind" });
    viewTexts[i] = h("span", { cls: "pane-chip-view", hidden: true });
    const chip = h("button", {
      cls: "pane-chip",
      html: UI_ICON.caret,
      title: "This pane's view: show the plan or the 3D view here, pick a standard view, or close the pane",
      attrs: { type: "button" },
    });
    chip.prepend(kindTexts[i], viewTexts[i]);
    chips[i] = menuButton(chip, () => hooks.menu(i));
  }
  wrap.append(...pictures, ...chips, across, along, ring);

  const put = (el: HTMLElement, r: { left: number; top: number; width: number; height: number } | null): void => {
    for (const k of ["left", "top", "width", "height"] as const) el.style[k] = r ? `${r[k]}px` : "";
    if (r) el.style.right = el.style.bottom = "auto";
    else el.style.right = el.style.bottom = "";
  };
  const px = (f: Frac, W: number, H: number) => {
    const left = f.x * W + (f.x > 0 ? GAP : 0);
    const top = f.y * H + (f.y > 0 ? GAP : 0);
    const right = (f.x + f.w) * W - (f.x + f.w < 1 ? GAP : 0);
    const bottom = (f.y + f.h) * H - (f.y + f.h < 1 ? GAP : 0);
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };
  // the chips: shown with several panes, saying "Plan", "3D" or "3D · Right Isometric", the active pane's in the accent
  const labelChips = (): void => {
    for (let i = 0; i <= 3; i++) {
      const hide = !multiPane() || i >= paneCount();
      if (chips[i].hidden !== hide) chips[i].hidden = hide;
      if (hide) continue;
      chips[i].classList.toggle("active", i === activePane());
      const kind = kinds[i] ?? "plan";
      const view = kind === "3d" ? hooks.view(i) : null;
      const text = `${kind}|${view ?? ""}`;
      if (said[i] === text) continue;
      said[i] = text;
      kindTexts[i].textContent = kind === "3d" ? "3D" : "Plan";
      viewTexts[i].hidden = view === null;
      if (view !== null) {
        // translated as View > Standard Views names it (i18n.ts)
        viewTexts[i].setAttribute("data-i18n", `View › ${view}`);
        viewTexts[i].textContent = view;
      }
    }
  };
  // each chip in its pane's top-left corner, stepping below the View bar, the cube or an editing bar it would sit under
  const placeChips = (f: readonly Frac[], W: number, H: number): void => {
    const obstacles = [...document.querySelectorAll<HTMLElement>(CHIP_OBSTACLES)].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    for (let i = 0; i < f.length; i++) {
      const chip = chips[i];
      if (chip.hidden) continue;
      const pane = px(f[i], W, H);
      let top = pane.top + CHIP_INSET;
      chip.style.left = `${pane.left + CHIP_INSET}px`;
      chip.style.top = `${top}px`;
      for (let tries = 0; tries < obstacles.length; tries++) {
        const r = chip.getBoundingClientRect();
        const hit = obstacles.find((o) => o.left < r.right && o.right > r.left && o.top < r.bottom && o.bottom > r.top);
        if (!hit) break;
        top += hit.bottom + CHIP_INSET - r.top;
        chip.style.top = `${top}px`;
      }
    }
  };
  const chipsOnly = (): void => {
    labelChips();
    placeChips(fractions(layout, shareX, shareY), wrap.clientWidth, wrap.clientHeight);
  };
  const ringOnly = (): void => {
    const f = fractions(layout, shareX, shareY);
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    ring.hidden = !multiPane();
    put(ring, multiPane() ? px(f[activePane()], W, H) : null);
    for (const g of ringListeners) g();
    labelChips();
    placeChips(f, W, H);
  };
  const apply = (): void => {
    const f = fractions(layout, shareX, shareY);
    const W = wrap.clientWidth;
    const H = wrap.clientHeight;
    const many = multiPane();
    wrap.classList.toggle("panes", many);
    // with no plan pane, the plan's canvas waits under the live 3D view; with no 3D pane, the 3D view is hidden
    const planAt = livePlan >= 0 ? livePlan : Math.max(live, 0);
    put(canvas, many ? px(f[planAt], W, H) : null);
    put(text, many ? px(f[planAt], W, H) : null);
    put(host, many ? px(f[live >= 0 ? live : planAt], W, H) : null);
    for (let i = 0; i <= 3; i++) {
      const shown = many && i < f.length && i !== live && i !== livePlan;
      pictures[i].hidden = !shown;
      pictures[i].setAttribute("aria-label", kinds[i] === "3d" ? "3D view pane" : "Plan view pane");
      put(pictures[i], shown ? px(f[i], W, H) : null);
    }
    // each divider along the panes it parts; the gaps between the even ones show the wrap's chrome
    const { upright, level } = dividers(layout, shareX, shareY);
    across.hidden = !upright;
    along.hidden = !level;
    const span = (from: number, to: number, size: number) => ({ at: from * size + (from > 0 ? GAP : 0), to: to * size - (to < 1 ? GAP : 0) });
    if (upright) {
      const s = span(upright[0], upright[1], H);
      put(across, { left: shareX * W - GAP, top: s.at, width: 2 * GAP, height: s.to - s.at });
    } else put(across, null);
    if (level) {
      const s = span(level[0], level[1], W);
      put(along, { left: s.at, top: shareY * H - GAP, width: s.to - s.at, height: 2 * GAP });
    } else put(along, null);
    ringOnly();
    hooks.resized();
    hooks.placed();
  };
  place = apply;
  relabel = labelChips;
  store.on("view3d", ringOnly);
  // the View bar changes width with the layer and class names; editing bars come and go with the drawing
  store.on(["session", "layer", "class"], chipsOnly);
  new ResizeObserver(apply).observe(wrap);
  apply();

  const drag = (el: HTMLElement, upright: boolean): void => {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
      const move = (ev: PointerEvent): void => {
        const r = wrap.getBoundingClientRect();
        const t = upright ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
        const v = Math.min(1 - MIN_SHARE, Math.max(MIN_SHARE, t));
        if (upright) shareX = v;
        else shareY = v;
        apply();
      };
      const up = (): void => {
        el.classList.remove("dragging");
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
        el.removeEventListener("pointercancel", up);
        persist();
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", up);
    });
    el.addEventListener("dblclick", () => {
      if (upright) shareX = 0.5;
      else shareY = 0.5;
      persist();
      apply();
    });
  };
  drag(across, true);
  drag(along, false);
}
