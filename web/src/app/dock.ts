// Palettes: the panels beside the drawing, after Spline's side panels. Each
// sits in the left or right dock, a full-height column at that edge of the
// window, or floats anywhere over the drawing; its title bar drags it between them, and
// its buttons roll it up to its title or close it (the Window menu shows it
// again). Dropped on another palette's title bar, a palette becomes a tab of it;
// dragging a tab out of the title bar separates it again. Palettes that fill
// (Object Info, Navigation) share their dock's spare height, split by the
// handles between them; tool palettes keep their own height. A dock's palettes
// can also stand side by side, in columns, as Vectorworks docks them: while a
// palette is dragged, a docking guide over the docked palette under the pointer
// offers above, below, left and right of it (a new column) and its middle (a
// tab), a guide at each side of the drawing the end of that dock, and Option or
// Ctrl held keeps the palette floating. A right-click on a
// title bar offers the same moves. Along each dock's outer edge runs a rail of
// icons, one per palette of that side, closed ones too: a click shows a palette,
// brings its tab to the front or closes it, so every palette is a click away
// without taking room from the drawing. A dock folds to its rail, leaving the
// drawing all but the rail's width; an icon then opens its palette beside the
// rail, over the drawing, until the next click elsewhere. The arrangement, with
// the interface's density (Window > Compact Interface), is kept in localStorage,
// per browser.
//
// Window > View Bar Options shows the View bar in its regular size, compact (tighter, without the
// layer's scale) or auto-hidden (out of sight till the pointer comes near it), with or without
// captions over its groups. Window > Palette Options auto-hides the docked palettes (both docks
// folded to their rails, a palette sliding out from its icon) or the floating ones (each rolled up
// to its title bar while the pointer is elsewhere).
//
// On a phone (560 px wide or less) there are no docks: one palette at a time comes up as a
// bottom sheet over the foot of the drawing, which is cut short to stand above it. The sheet's
// title lists the palettes to switch to, and its grip sets its height: 30, 55 or 90 per cent of
// the window.

import { h } from "./dom.ts";
import { openContextMenu, type Row } from "./menu.ts";
import "./dock.css";

export type DockSide = "left" | "right";

/** The docking bars along the drawing's top and bottom, as Vectorworks 2027 has them: palettes side by side across the drawing. */
export type Shelf = "top" | "bottom";

const SHELVES: readonly Shelf[] = ["top", "bottom"];
const SHELF_NAMES: Record<Shelf, string> = { top: "Top Docking Bar", bottom: "Bottom Docking Bar" };
const DEFAULT_SHELF_H = 220;
const MIN_SHELF_H = 96;
/** a docking bar's tallest, as a share of the window */
const MAX_SHELF_SHARE = 0.6;
/** a palette's narrowest in a docking bar */
const MIN_SHELF_W = 140;

function isSide(where: string): where is DockSide {
  return where === "left" || where === "right";
}

export interface PaletteSpec {
  readonly id: string;
  readonly title: string;
  /** its name in Window > Palettes, where Vectorworks calls it otherwise than its title bar does */
  readonly menuTitle?: string;
  readonly body: HTMLElement;
  /** the dock it starts in; palettes keep the order they are listed in */
  readonly side: DockSide;
  /** its icon in the dock's rail (an inline SVG); the title's first letters without one */
  readonly icon?: string;
  /** starts as a tab of this palette */
  readonly tabOf?: string;
  /** shares the dock's spare height; otherwise it keeps its content's height */
  readonly fill?: boolean;
  /** a filling palette's share of the spare height, against the others' (300 by default) */
  readonly weight?: number;
  /** starts rolled up to its title */
  readonly collapsed?: boolean;
  /** starts closed */
  readonly hidden?: boolean;
  /** the palette's own options, offered at the foot of its title bar's menu */
  readonly menu?: () => Row[];
  /** the key its tabs were made with (tabbed): each can come out as a palette of its own */
  readonly tabbed?: string;
}

/**
 * The bars over the drawing: the Window menu hides them too, and each has a grip at its start that
 * moves it anywhere over the drawing, rolls it up to the grip, or puts it back where it started.
 */
export type BarId = "viewbar" | "modebar" | "snapbar";

const BAR_IDS: readonly BarId[] = ["viewbar", "modebar", "snapbar"];
const BAR_NAMES: Record<BarId, string> = { viewbar: "View bar", modebar: "Mode bar", snapbar: "Snapping" };

/** The top bar's groups that a right-click on the top bar, or Window > Top Bar, shows and hides. */
export type TopGroupId = "menus" | "view" | "tools" | "undo" | "zoom";

const TOP_IDS: readonly TopGroupId[] = ["menus", "view", "tools", "undo", "zoom"];
const TOP_NAMES: Record<TopGroupId, string> = { menus: "Menu Bar", view: "2D, 3D and Views", tools: "Tools", undo: "Undo and Redo", zoom: "Zoom" };

/** How tightly the chrome is packed: Spline's spacing, or Vectorworks' tighter rows (Window > Compact Interface). */
export type Density = "standard" | "compact";

/** Window > View Bar Options' display mode. */
export type ViewBarMode = "regular" | "compact" | "autohide";

/** how near the pointer comes to an auto-hidden View bar to bring it out, px */
const REVEAL_PX = 24;
/** how long an auto-hidden View bar or a floating palette waits after the pointer leaves, ms */
const TUCK_DELAY_MS = 600;

interface Placement {
  where: DockSide | Shelf | "float";
  /** order within its dock's column or docking bar, or among the tabs of its palette */
  order: number;
  /** its dock's column, left to right, when the dock has two or more */
  col: number;
  /** the palette whose tab it is, null when it has its own title bar (the rest of its placement is then unused) */
  group: string | null;
  /** floating, docked under another floating palette: the one at the top of their stack (its box is the stack's) */
  stack: string | null;
  /** of a palette with tabs: the tab in front, null for its own */
  tab: string | null;
  collapsed: boolean;
  shown: boolean;
  /** share of the dock's spare height (the palette's height in px when last resized) */
  weight: number;
  /** floating box, in workspace px */
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a bar over the drawing is: moved this far from where it starts, and whether rolled up. */
interface BarPlace {
  dx: number;
  dy: number;
  rolled: boolean;
}

interface Layout {
  palettes: Record<string, Placement>;
  width: Record<DockSide, number>;
  /** each docking bar's height while a palette in it is unrolled */
  shelf: Record<Shelf, number>;
  /** each dock's columns' widths, left to right, when its palettes stand in two or more side by side (the width is the rail's and theirs) */
  columns: Record<DockSide, number[]>;
  /** every palette put away (Window > Palettes > Hide Enabled Palettes) */
  away: boolean;
  bars: Record<BarId, boolean>;
  barPlaces: Record<BarId, BarPlace>;
  /** the top bar's groups shown */
  top: Record<TopGroupId, boolean>;
  /** docks folded to a strip of their palettes' names */
  folded: Record<DockSide, boolean>;
  /** folded docks whose palettes slide out while the pointer rests on their icons (Vectorworks' Auto Hide) */
  autoHide: Record<DockSide, boolean>;
  density: Density;
  viewBar: ViewBarMode;
  /** captions over the View bar's groups */
  viewBarLabels: boolean;
  /** floating palettes roll up to their titles while the pointer is elsewhere */
  autoHideFloating: boolean;
  /** floating palettes dock above and below one another, and take each other's tabs (Floating Palettes Can Dock to Each Other) */
  floatDock: boolean;
  /** each tabbed palette's tabs in order, by the palette's id (the defaults' order where it has none) */
  tabOrder: Record<string, string[]>;
  /** tabbed palettes whose tabs are locked (Lock tabs): they neither move nor come out or go back */
  tabLock: Record<string, boolean>;
  /** each palette's Tab Style, by its id: its tabs show their icons, their names or both (names where it has none) */
  tabStyle: Record<string, TabStyle>;
}

/** Vectorworks 2027's Tab Style for a palette's tabs: Icon Only, Text Only, or Icon and Text. */
export type TabStyle = "icon" | "text" | "both";

const TAB_STYLES: readonly (readonly [TabStyle, string])[] = [
  ["icon", "Icon Only"],
  ["text", "Text Only"],
  ["both", "Icon and Text"],
];

/** What the docks and docking bars cover of the drawing, in CSS px from each edge. */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

// v2: the side-panel layout; arrangements kept for the floating-glass one start afresh
const STORAGE_KEY = "openvwx.palettes.v2";
/** a dock's width, its rail included */
const DEFAULT_WIDTH: Record<DockSide, number> = { left: 280, right: 280 };
const MIN_WIDTH = 160;
/** a column of a dock with two or more: at least this wide */
const MIN_COL_WIDTH = 124;
/** most columns one dock takes */
const MAX_COLUMNS = 4;
/** the drawing keeps at least this much width when a dock takes another column */
const DRAWING_ROOM_PX = 240;
/** a docking guide's square */
const GUIDE_CELL_PX = 26;
/** the left dock's width in the Classic workspace: the tool palettes' grids of buttons */
const CLASSIC_LEFT_WIDTH = 200;
const MAX_WIDTH = 600;
/** the rail's width, and so a folded dock's (dock.css's --rail-w) */
const RAIL_WIDTH: Record<Density, number> = { standard: 36, compact: 30 };
/** margin between a floating palette and the edges of the drawing */
const GAP = 8;
/** how far an arrow key moves a bar by its grip (Shift: five times) */
const NUDGE_PX = 10;
/** how long the pointer rests on an auto-hidden dock's icon before its palette slides out */
const HOVER_OPEN_MS = 150;
/** how long after the pointer leaves an auto-hidden dock's palette it slides back */
const HOVER_CLOSE_MS = 400;
/** pointer travel before a press on a title bar becomes a drag */
const DRAG_START_PX = 4;
/** how far past a dock's inner edge a dragged palette still docks there */
const DOCK_REACH_PX = 40;
const MIN_FLOAT_W = 150;
const MIN_FLOAT_H = 64;
/** smallest height a filling palette is split down to */
const MIN_FILL_PX = 72;
const DEFAULT_WEIGHT = 300;
/** a phone's width: no docks, and the palettes are one bottom sheet */
const PHONE_QUERY = "(max-width: 560px)";
/** a phone's sheet stops, in per cent of the window's height (the sheet starts at the middle one) */
const SHEET_STOPS = [30, 55, 90];
const SHEET_START = 1;

const CHEVRON = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** points into the drawing: unfolding the left dock; mirrored for the right */
const UNFOLD = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3 6 6 3 9M6.5 3 9.5 6 6.5 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
/** a bar's grip: two columns of dots */
const GRIP = `<svg viewBox="0 0 8 14" aria-hidden="true"><g fill="currentColor"><circle cx="2" cy="3" r="1"/><circle cx="6" cy="3" r="1"/><circle cx="2" cy="7" r="1"/><circle cx="6" cy="7" r="1"/><circle cx="2" cy="11" r="1"/><circle cx="6" cy="11" r="1"/></g></svg>`;
/** a pushpin: a dock kept open, or (lit) auto-hidden */
const PIN = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 1.5h3M5 1.5v3.2L3.3 6.6h5.4L7 4.7V1.5M6 6.6v3.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CROSS = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/** Where a docking guide's square puts the dragged palette against the one under it. */
type GuideAt = "top" | "bottom" | "left" | "right" | "tab";

/** Where a dragged palette would dock: at `index` in column `col` of a dock, or alone in a new column put in at `col`. */
interface DropAt {
  side: DockSide;
  col: number;
  index: number;
  newCol: boolean;
}

/** A docking guide's square, a bar in it marking where the palette would go. */
function guideCell(at: GuideAt, label: string): HTMLElement {
  return h("div", { cls: `dock-guide-cell at-${at}`, title: label, attrs: { "data-at": at } }, h("span"));
}

function inside(r: DOMRect, x: number, y: number): boolean {
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** A palette without an icon shows the first letters of its title's first two words in the rail. */
function initials(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : title.slice(0, 2);
  return letters.replace(/[&<>"]/g, "");
}

function home(): BarPlace {
  return { dx: 0, dy: 0, rolled: false };
}

function defaults(specs: readonly PaletteSpec[]): Layout {
  const palettes: Record<string, Placement> = {};
  specs.forEach((s, i) => {
    palettes[s.id] = {
      where: s.side,
      order: i,
      col: 0,
      group: null,
      stack: null,
      tab: null,
      collapsed: s.collapsed ?? false,
      shown: !s.hidden,
      weight: s.weight ?? DEFAULT_WEIGHT,
      x: 120 + 24 * i,
      y: 40 + 24 * i,
      w: 260,
      h: 320,
    };
  });
  for (const s of specs) {
    const host = s.tabOf === undefined ? undefined : palettes[s.tabOf];
    const p = palettes[s.id];
    if (!host || host.group !== null || !host.shown || !p.shown) continue;
    p.where = host.where;
    p.group = s.tabOf!;
  }
  return {
    palettes,
    width: { ...DEFAULT_WIDTH },
    shelf: { top: DEFAULT_SHELF_H, bottom: DEFAULT_SHELF_H },
    columns: { left: [], right: [] },
    away: false,
    bars: { viewbar: true, modebar: true, snapbar: true },
    barPlaces: { viewbar: home(), modebar: home(), snapbar: home() },
    // the menu bar's row of titles is Dense's and Classic's; Standard keeps the menus behind the Menu button
    top: { menus: false, view: true, tools: true, undo: true, zoom: true },
    folded: { left: false, right: false },
    autoHide: { left: false, right: false },
    density: "standard",
    viewBar: "regular",
    viewBarLabels: false,
    autoHideFloating: false,
    floatDock: true,
    tabOrder: {},
    tabLock: {},
    tabStyle: {},
  };
}

/** The saved arrangement in localStorage over the defaults. */
function load(specs: readonly PaletteSpec[]): Layout {
  try {
    return parse(specs, JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    // unreadable or blocked storage: the defaults
    return defaults(specs);
  }
}

/** A kept arrangement over the defaults: palettes it does not know start where the defaults put them. */
function parse(specs: readonly PaletteSpec[], raw: unknown): Layout {
  const layout = defaults(specs);
  const saved = raw as Partial<Layout> | null;
  if (!saved || typeof saved !== "object") return layout;
  for (const side of ["left", "right"] as const) {
    const cols = saved.columns?.[side];
    if (Array.isArray(cols) && cols.length >= 2 && cols.length <= MAX_COLUMNS && cols.every((c) => typeof c === "number" && Number.isFinite(c))) {
      layout.columns[side] = cols.map((c) => clamp(c, MIN_COL_WIDTH, MAX_WIDTH));
    }
    const w = saved.width?.[side];
    if (typeof w === "number" && Number.isFinite(w)) layout.width[side] = clamp(w, MIN_WIDTH, MAX_WIDTH * Math.max(1, layout.columns[side].length));
    if (typeof saved.folded?.[side] === "boolean") layout.folded[side] = saved.folded[side];
    // an auto-hidden dock is a folded one
    if (saved.autoHide?.[side] === true) layout.autoHide[side] = layout.folded[side] = true;
  }
  for (const shelf of SHELVES) {
    const v = saved.shelf?.[shelf];
    if (typeof v === "number" && Number.isFinite(v)) layout.shelf[shelf] = Math.max(MIN_SHELF_H, v);
  }
  layout.away = saved.away === true;
  if (saved.density === "compact") layout.density = "compact";
  if (saved.viewBar === "compact" || saved.viewBar === "autohide") layout.viewBar = saved.viewBar;
  layout.viewBarLabels = saved.viewBarLabels === true;
  layout.autoHideFloating = saved.autoHideFloating === true;
  layout.floatDock = saved.floatDock !== false;
  for (const [id, order] of Object.entries(saved.tabOrder ?? {})) {
    if (Array.isArray(order) && order.every((t) => typeof t === "string")) layout.tabOrder[id] = order;
  }
  for (const [id, locked] of Object.entries(saved.tabLock ?? {})) {
    if (locked === true) layout.tabLock[id] = true;
  }
  for (const [id, style] of Object.entries(saved.tabStyle ?? {})) {
    if (style === "icon" || style === "both") layout.tabStyle[id] = style;
  }
  for (const bar of BAR_IDS) {
    if (typeof saved.bars?.[bar] === "boolean") layout.bars[bar] = saved.bars[bar];
    const at = saved.barPlaces?.[bar];
    if (!at || typeof at !== "object") continue;
    const into = layout.barPlaces[bar];
    if (Number.isFinite(at.dx) && Number.isFinite(at.dy)) Object.assign(into, { dx: at.dx, dy: at.dy });
    into.rolled = at.rolled === true;
  }
  for (const id of TOP_IDS) {
    if (typeof saved.top?.[id] === "boolean") layout.top[id] = saved.top[id];
  }
  for (const [id, p] of Object.entries(saved.palettes ?? {})) {
    const into = layout.palettes[id];
    if (!into || !p || typeof p !== "object") continue;
    if (p.where === "left" || p.where === "right" || p.where === "top" || p.where === "bottom" || p.where === "float") into.where = p.where;
    for (const k of ["order", "col", "weight", "x", "y", "w", "h"] as const) {
      if (typeof p[k] === "number" && Number.isFinite(p[k])) into[k] = p[k];
    }
    if (typeof p.collapsed === "boolean") into.collapsed = p.collapsed;
    if (typeof p.shown === "boolean") into.shown = p.shown;
    if (p.group === null || typeof p.group === "string") into.group = p.group;
    if (p.stack === null || typeof p.stack === "string") into.stack = p.stack;
    if (p.tab === null || typeof p.tab === "string") into.tab = p.tab;
  }
  // a tab of a palette that is gone, closed or itself a tab gets its own title bar back
  for (const [id, p] of Object.entries(layout.palettes)) {
    const host = p.group === null ? undefined : layout.palettes[p.group];
    if (p.group === id || !host || host.group !== null || !host.shown || !p.shown) p.group = null;
  }
  return layout;
}

function save(layout: Layout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // storage blocked: the arrangement lasts for this visit only
  }
}

export class Palettes {
  private layout: Layout;
  private readonly specs = new Map<string, PaletteSpec>();
  private readonly els = new Map<string, HTMLElement>();
  private readonly docks: Record<DockSide, HTMLElement>;
  /** the docking bars: their palettes side by side, and an inner edge that sets their height */
  private readonly shelves: Record<Shelf, HTMLElement>;
  private readonly shelfRows: Record<Shelf, HTMLElement> = { top: h("div", { cls: "shelf-row" }), bottom: h("div", { cls: "shelf-row" }) };
  /** the docking guides at the drawing's top and bottom: the end of that docking bar */
  private readonly shelfGuides: Record<Shelf, HTMLElement> = {
    top: h("div", { cls: "dock-guide-edge", hidden: true }, guideCell("top", SHELF_NAMES.top)),
    bottom: h("div", { cls: "dock-guide-edge", hidden: true }, guideCell("bottom", SHELF_NAMES.bottom)),
  };
  /** each dock's rail: an icon per palette of that side */
  private readonly rails: Record<DockSide, HTMLElement> = {
    left: h("div", { cls: "dock-rail", attrs: { role: "toolbar", "aria-orientation": "vertical", "aria-label": "Left palettes" } }),
    right: h("div", { cls: "dock-rail", attrs: { role: "toolbar", "aria-orientation": "vertical", "aria-label": "Right palettes" } }),
  };
  /** each dock's columns of palettes, beside its rail */
  private readonly cols: Record<DockSide, HTMLElement> = {
    left: h("div", { cls: "dock-cols" }),
    right: h("div", { cls: "dock-cols" }),
  };
  /** a folded dock's palette, opened beside its rail */
  private readonly flyout = h("div", { cls: "dock-flyout", hidden: true });
  private open: { side: DockSide; id: string } | null = null;
  /** the least an open dock is drawn at: the top bar's end over it, with its buttons (app.ts) */
  private readonly floor: Record<DockSide, number> = { left: 0, right: 0 };
  /** an auto-hidden dock's palette about to slide out or back */
  private hoverTimer = 0;
  /** an auto-hidden View bar about to go out of sight */
  private viewBarTimer = 0;
  /** floating palettes about to roll up to their titles (Auto-Hide Floating Palettes) */
  private readonly tuckTimers = new Map<string, number>();
  private readonly floating = h("div", { cls: "dock-float" });
  /** where a dragged palette would land */
  private readonly dropLine = h("div", { cls: "dock-drop", hidden: true });
  /** a dragged palette's new column, as it would stand */
  private readonly preview = h("div", { cls: "dock-preview", hidden: true });
  /** the docking guide over a docked palette: above, below, left, right and (the middle) a tab */
  private readonly guideCells: Record<GuideAt, HTMLElement> = {
    top: guideCell("top", "Above"),
    left: guideCell("left", "A column to the left"),
    tab: guideCell("tab", "A tab of it"),
    right: guideCell("right", "A column to the right"),
    bottom: guideCell("bottom", "Below"),
  };
  private readonly guide = h("div", { cls: "dock-guide", hidden: true }, ...Object.values(this.guideCells));
  /** the docking guides at each side of the drawing: the end of that dock */
  private readonly edgeGuides: Record<DockSide, HTMLElement> = {
    left: h("div", { cls: "dock-guide-edge", hidden: true }, guideCell("left", "The left dock")),
    right: h("div", { cls: "dock-guide-edge", hidden: true }, guideCell("right", "The right dock")),
  };
  /** each dock's columns' elements, and the handles between them, made as needed */
  private readonly colEls: Record<DockSide, HTMLElement[]> = { left: [], right: [] };
  private readonly colSplits: Record<DockSide, HTMLElement[]> = { left: [], right: [] };
  private readonly bars = new Map<BarId, HTMLElement>();
  private readonly topGroups = new Map<TopGroupId, HTMLElement>();
  /** each bar's box (the pill its grip is in), and how far it is moved as shown (kept inside the drawing) */
  private readonly barBoxes = new Map<BarId, HTMLElement>();
  private readonly barShift = new Map<BarId, { dx: number; dy: number }>();
  /** a bar was just dragged by its grip: the click that ends the drag doesn't roll it up */
  private barDragged = false;
  private readonly listeners = new Set<() => void>();
  /** each tabbed palette's strip, by the palette's id */
  private readonly strips = new Map<string, TabStrip>();
  /** a tab come out of its palette: a palette of its own (id "palette:tab"), shown while it is out */
  private readonly loose = new Map<string, { home: string; strip: TabStrip; tab: string }>();
  /** each floating stack's box, by the palette at its top */
  private readonly stackBoxes = new Map<string, HTMLElement>();
  /** stacking order of floating palettes: the last one pressed is on top */
  private zTop = 1;
  /** a phone's sheet: the palette in it (null for none), and its height stop (an index of SHEET_STOPS) */
  private sheetId: string | null = null;
  private sheetStop = SHEET_START;
  private readonly phoneQuery = window.matchMedia(PHONE_QUERY);
  private readonly sheet: HTMLElement;
  /** the sheet's grip: drag it to make the sheet taller or shorter */
  private readonly grip = h(
    "div",
    {
      cls: "sheet-grip",
      attrs: { role: "separator", "aria-orientation": "horizontal", "aria-label": "Drag to resize the sheet", title: "Drag to resize" },
    },
    h("span"),
  );

  constructor(
    private readonly host: HTMLElement,
    specs: readonly PaletteSpec[],
  ) {
    // a tabbed palette's tabs are palettes too, shown while they are out of it
    const all = [...specs];
    for (const s of specs) {
      const strip = s.tabbed === undefined ? undefined : tabStrips.get(s.tabbed);
      if (!strip) continue;
      this.strips.set(s.id, strip);
      for (const t of strip.panels) {
        const id = `${s.id}:${t.id}`;
        this.loose.set(id, { home: s.id, strip, tab: t.id });
        all.push({ id, title: t.name ?? t.label, side: s.side, icon: t.icon ?? s.icon, fill: s.fill, hidden: true, body: t.body });
      }
      strip.tearOff = (tab, e) => this.tearOff(s.id, tab, e);
      strip.reordered = (order) => {
        this.layout.tabOrder[s.id] = [...order];
        this.commit();
      };
    }
    for (const s of all) this.specs.set(s.id, s);
    this.layout = load(all);
    this.docks = { left: this.buildDock("left"), right: this.buildDock("right") };
    this.shelves = { top: this.buildShelf("top"), bottom: this.buildShelf("bottom") };
    for (const s of all) this.els.set(s.id, this.buildPalette(s));
    this.sheet = h("section", { cls: "pal-sheet", attrs: { "aria-label": "Palette" }, hidden: true });
    this.grip.addEventListener("pointerdown", (e) => this.resizeSheet(e));
    host.append(
      this.docks.left,
      this.docks.right,
      this.shelves.top,
      this.shelves.bottom,
      this.floating,
      this.flyout,
      this.dropLine,
      this.preview,
      this.guide,
      this.edgeGuides.left,
      this.edgeGuides.right,
      this.shelfGuides.top,
      this.shelfGuides.bottom,
      this.sheet,
    );
    // an auto-hidden dock's palette stays out while the pointer is on it
    this.flyout.addEventListener("pointerenter", () => clearTimeout(this.hoverTimer));
    this.flyout.addEventListener("pointerleave", (e) => {
      if (this.open) this.leaveAutoHidden(this.open.side, e);
    });
    // a press anywhere else, or Escape, closes an opened palette of a folded dock
    host.addEventListener(
      "pointerdown",
      (e) => {
        if (this.open && !(e.target as Element).closest(".dock-flyout, .dock-rail")) this.fly(null);
      },
      true,
    );
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.open) this.fly(null);
    });
    // an auto-hidden View bar comes out as the pointer nears it
    window.addEventListener("pointermove", (e) => this.revealViewBar(e), { passive: true });
    window.addEventListener("focusin", () => this.revealViewBar(null));
    // a window crossing the phone's width lays the palettes out again
    this.phoneQuery.addEventListener("change", () => this.commit());
    this.place();
  }

  /** Called after the arrangement changes (the drawing's fit takes the docks into account). */
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /**
   * A bar over the drawing the Window menu shows and hides. Its box (`el`, or the pill in it) gets a
   * grip: drag it to move the bar, click it to roll the bar up to it, double-click it to put the bar
   * back; arrow keys on it move the bar too.
   */
  addBar(id: BarId, el: HTMLElement): void {
    this.bars.set(id, el);
    el.hidden = !this.layout.bars[id];
    if (id === "viewbar") this.dressViewBar();
    const box = el.classList.contains("pill") ? el : el.querySelector<HTMLElement>(".pill");
    if (!box) return;
    const name = BAR_NAMES[id];
    const grip = h(
      "button",
      {
        cls: "hud-grip",
        html: GRIP,
        title: `${name}: drag to move, click to roll up, double-click to put back`,
        attrs: { type: "button", "aria-label": `Move or roll up the ${name}` },
      },
      h("span", { text: name }),
    );
    grip.addEventListener("pointerdown", (e) => this.dragBar(id, box, grip, e));
    grip.addEventListener("click", () => {
      if (!this.barDragged) this.rollBar(id);
    });
    grip.addEventListener("dblclick", () => this.putBarBack(id));
    grip.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? NUDGE_PX * 5 : NUDGE_PX;
      const by = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!by) return;
      e.preventDefault();
      const at = this.barShift.get(id) ?? this.layout.barPlaces[id];
      Object.assign(this.layout.barPlaces[id], { dx: at.dx + by[0], dy: at.dy + by[1] });
      this.commit();
    });
    box.prepend(grip);
    box.dataset.bar = id;
    this.barBoxes.set(id, box);
    // kept inside the drawing as it and the bar change size
    const fit = new ResizeObserver(() => this.fitBar(id));
    fit.observe(box);
    const area = box.closest<HTMLElement>(".stage");
    if (area) fit.observe(area);
    this.placeBar(id);
  }

  barShown(id: BarId): boolean {
    return this.layout.bars[id];
  }

  toggleBar(id: BarId): void {
    this.layout.bars[id] = !this.layout.bars[id];
    this.commit();
  }

  /** A group of the top bar that can be hidden. */
  addTopGroup(id: TopGroupId, el: HTMLElement): void {
    this.topGroups.set(id, el);
    this.placeTop();
  }

  topShown(id: TopGroupId): boolean {
    return this.layout.top[id];
  }

  /**
   * Shows or hides a group of the top bar. Hiding the tools brings the Tools and Tool Sets palettes
   * out when neither is shown, so the tools stay in reach.
   */
  toggleTop(id: TopGroupId): void {
    this.layout.top[id] = !this.layout.top[id];
    const { basic, toolsets } = this.layout.palettes;
    if (id === "tools" && !this.layout.top.tools && !basic?.shown && !toolsets?.shown) {
      for (const p of [basic, toolsets]) if (p) Object.assign(p, { shown: true, collapsed: false });
      this.layout.away = false;
    }
    this.commit();
  }

  /** The top bar's menu (a right-click on it) and Window > Top Bar: a row per group, then Show All. */
  topRows(): Row[] {
    const ids = TOP_IDS.filter((id) => this.topGroups.has(id));
    return [
      ...ids.map((id): Row => ({ label: TOP_NAMES[id], checked: () => this.layout.top[id], run: () => this.toggleTop(id) })),
      "-",
      {
        label: "Show All",
        enabled: () => ids.some((id) => !this.layout.top[id]),
        run: () => {
          for (const id of ids) this.layout.top[id] = true;
          this.commit();
        },
      },
    ];
  }

  barRolled(id: BarId): boolean {
    return this.layout.barPlaces[id].rolled;
  }

  /** Rolls a bar up to its grip, or unrolls it; the grip stays where it is. */
  rollBar(id: BarId): void {
    const box = this.barBoxes.get(id);
    const place = this.layout.barPlaces[id];
    const grip = box?.querySelector(".hud-grip");
    if (!box || !grip || this.phone || !box.offsetParent) {
      place.rolled = !place.rolled;
      this.commit();
      return;
    }
    const was = grip.getBoundingClientRect();
    Object.assign(place, this.barShift.get(id) ?? {}, { rolled: !place.rolled });
    this.placeBar(id);
    const now = grip.getBoundingClientRect();
    place.dx += was.left - now.left;
    place.dy += was.top - now.top;
    this.commit();
  }

  /** Puts a bar back where it starts, unrolled. */
  putBarBack(id: BarId): void {
    this.layout.barPlaces[id] = home();
    this.commit();
  }

  /** Window > Reset Bars: every bar back where it starts, shown and unrolled. */
  resetBars(): void {
    for (const id of BAR_IDS) {
      this.layout.bars[id] = true;
      this.layout.barPlaces[id] = home();
    }
    this.commit();
  }

  /** Whether any bar is moved, rolled up or hidden. */
  barsMoved(): boolean {
    return BAR_IDS.some((id) => {
      const p = this.layout.barPlaces[id];
      return !this.layout.bars[id] || p.rolled || p.dx !== 0 || p.dy !== 0;
    });
  }

  /**
   * Every palette by its Vectorworks name, with each tab of a tabbed palette as a palette of its own
   * (Vectorworks 2025's Shape, Data and Render, Design Layers, Classes, Lights, Cameras…), by name.
   * A tab whose name a palette has too is named with its palette's, e.g. "Render (Object Info)".
   */
  entries(): { id: string; name: string }[] {
    const named = [...this.specs.values()].map((s) => ({ id: s.id, name: s.menuTitle ?? s.title }));
    const taken = new Set(named.filter((e) => !this.loose.has(e.id)).map((e) => e.name));
    return named
      .map((e) => {
        const l = this.loose.get(e.id);
        return l && taken.has(e.name) ? { id: e.id, name: `${e.name} (${this.specs.get(l.home)!.title})` } : e;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Window > Palettes: each palette and tab, checked while it is in view, choosing it showing or closing it. */
  menuRows(): Row[] {
    return this.entries().map(({ id, name }): Row => ({ label: name, checked: () => this.inView(id), run: () => this.toggleInView(id) }));
  }

  /** Whether a palette is in view; a tab still in its palette, while it is that palette's front tab. */
  inView(id: string): boolean {
    const l = this.loose.get(id);
    if (!l || (!this.phone && this.layout.palettes[id]?.shown)) return this.isShown(id);
    return this.isShown(l.home) && l.strip.front() === l.tab;
  }

  /**
   * Shows a palette or tab, or closes it when it is in view: a tab out of its palette closes back
   * into it, and one still in its palette comes to the front of it (closing, it closes its palette).
   */
  toggleInView(id: string): void {
    const l = this.loose.get(id);
    if (!l || (!this.phone && this.layout.palettes[id]?.shown)) {
      this.toggle(id);
      return;
    }
    if (this.inView(id)) {
      this.toggle(l.home);
      return;
    }
    l.strip.show(l.tab);
    this.show(l.home);
  }

  /** Brings a palette or tab into view, as a search result does. */
  reveal(id: string): void {
    if (!this.inView(id)) this.toggleInView(id);
  }

  /** Palettes in the order the Window menu lists them. */
  list(): { id: string; title: string }[] {
    return [...this.specs.values()].filter((s) => !this.loose.has(s.id)).map((s) => ({ id: s.id, title: s.title }));
  }

  /** The palettes to pick from, Object Info first: a menu's rows, with the one in view checked. */
  choices(): Row[] {
    const ids = [...this.specs.keys()].filter((id) => !this.loose.has(id)).sort((a, b) => Number(b === "objectInfo") - Number(a === "objectInfo"));
    return ids.map((id) => ({ label: this.specs.get(id)!.title, checked: () => this.isShown(id), run: () => this.show(id) }));
  }

  isShown(id: string): boolean {
    if (this.phone) return this.sheetId === id;
    return !this.layout.away && (this.layout.palettes[id]?.shown ?? false);
  }

  /** Shows or closes a palette; showing one also brings the others back when they were put away. */
  toggle(id: string): void {
    const p = this.layout.palettes[id];
    if (!p) return;
    if (this.phone) {
      this.sheetId = this.sheetId === id ? null : id;
      this.commit();
      return;
    }
    if (this.layout.away || !p.shown) {
      this.show(id);
      return;
    }
    this.hide(id);
    this.commit();
  }

  /** Opens a palette (and unrolls it, or brings its tab to the front), e.g. when a command needs it. */
  show(id: string): void {
    const p = this.layout.palettes[id];
    if (!p) return;
    // a phone's sheet takes the palette as it is, whatever the docks hold
    if (this.phone) {
      this.sheetId = id;
      this.commit();
      return;
    }
    this.layout.away = false;
    p.shown = true;
    const host = this.layout.palettes[p.group ?? id];
    host.collapsed = false;
    if (p.group !== null) host.tab = id;
    // in a folded dock, it opens beside the strip
    if (isSide(host.where) && this.layout.folded[host.where]) this.open = { side: host.where, id: p.group ?? id };
    this.commit();
  }

  get away(): boolean {
    return this.layout.away;
  }

  /** Puts every palette away, or brings them back, leaving the whole window to the drawing. */
  toggleAway(): void {
    this.layout.away = !this.layout.away;
    this.sheetId = null;
    this.commit();
  }

  isFolded(side: DockSide): boolean {
    return this.layout.folded[side];
  }

  /** Whether a dock is down to its rail: folded, or with no palette open in it. */
  isNarrow(side: DockSide): boolean {
    return this.narrow(side);
  }

  /** Keeps an open dock at least `px` wide, so the top bar's end over it lines up with it. */
  setFloor(side: DockSide, px: number): void {
    px = Math.ceil(px);
    if (this.floor[side] === px) return;
    this.floor[side] = px;
    this.place();
    for (const fn of this.listeners) fn();
  }

  /** Folds a dock to its rail, or unfolds it (an auto-hidden one stops hiding). */
  toggleFold(side: DockSide): void {
    this.layout.folded[side] = !this.layout.folded[side];
    if (!this.layout.folded[side]) this.layout.autoHide[side] = false;
    this.open = null;
    this.commit();
  }

  isAutoHidden(side: DockSide): boolean {
    return this.layout.autoHide[side];
  }

  /**
   * Auto-hides a dock, or keeps it open: auto-hidden, it is folded to its rail and a palette slides
   * out while the pointer rests on its icon, back again when the pointer leaves it.
   */
  toggleAutoHide(side: DockSide): void {
    const on = !this.layout.autoHide[side];
    this.layout.autoHide[side] = on;
    this.layout.folded[side] = on;
    this.open = null;
    this.commit();
  }

  get density(): Density {
    return this.layout.density;
  }

  /** Packs the chrome tighter, or back to Spline's spacing. */
  toggleDensity(): void {
    this.layout.density = this.layout.density === "compact" ? "standard" : "compact";
    this.commit();
  }

  get viewBarMode(): ViewBarMode {
    return this.layout.viewBar;
  }

  /** Window > View Bar Options: regular, compact or auto-hidden. */
  setViewBarMode(mode: ViewBarMode): void {
    this.layout.viewBar = mode;
    this.commit();
  }

  get viewBarLabels(): boolean {
    return this.layout.viewBarLabels;
  }

  /** Shows or hides the captions over the View bar's groups. */
  toggleViewBarLabels(): void {
    this.layout.viewBarLabels = !this.layout.viewBarLabels;
    this.commit();
  }

  /** Both docks auto-hidden (Window > Palette Options > Auto-Hide Docked Palettes). */
  get docksAutoHidden(): boolean {
    return this.layout.autoHide.left && this.layout.autoHide.right;
  }

  /** Auto-hides both docks, or keeps both open. */
  toggleDocksAutoHide(): void {
    const on = !this.docksAutoHidden;
    for (const side of ["left", "right"] as const) this.layout.autoHide[side] = this.layout.folded[side] = on;
    this.open = null;
    this.commit();
  }

  get floatingAutoHidden(): boolean {
    return this.layout.autoHideFloating;
  }

  /** Floating palettes roll up to their titles while the pointer is elsewhere, or stay as they are. */
  /** Window > Palette Options > Floating Palettes Can Dock to Each Other. */
  get floatDocking(): boolean {
    return this.layout.floatDock;
  }

  toggleFloatDocking(): void {
    this.layout.floatDock = !this.layout.floatDock;
    this.commit();
  }

  toggleFloatingAutoHide(): void {
    this.layout.autoHideFloating = !this.layout.autoHideFloating;
    this.commit();
    // those the pointer isn't on go now
    for (const [id, el] of this.els) if (!el.matches(":hover")) this.tuck(id, el);
  }

  /**
   * The built-in Dense workspace's arrangement, after Vectorworks': compact rows, narrower docks,
   * the menu bar's row of titles, Resources a tab of Navigation, and Attributes, Snapping and
   * Visualization tabs of one palette under Object Info.
   */
  dense(): unknown {
    const layout = defaults([...this.specs.values()]);
    layout.density = "compact";
    layout.width = { left: 232, right: 256 };
    layout.top.menus = true;
    const p = layout.palettes;
    const tab = (id: string, of: string, order: number): void => {
      // the tab joins the palette whose tabs `of` is among, if it is one, after `of`
      const host = p[of]?.group ?? of;
      if (!p[id] || !p[host]) return;
      const after = host === of ? 0 : p[of].order;
      Object.assign(p[id], { where: p[host].where, group: host, tab: null, shown: true, collapsed: false, order: after + order });
    };
    tab("resources", "navigation", 1);
    tab("snapping", "attributes", 1);
    tab("visualization", "attributes", 2);
    return layout;
  }

  /**
   * Window > Workspaces > Two Sidebars: Navigation and its tabs in the left dock, Object Info and
   * Attributes stacked in the right one, as openvwx started before its palettes shared one sidebar.
   */
  twoSidebars(): unknown {
    const layout = defaults([...this.specs.values()]);
    for (const [id, p] of Object.entries(layout.palettes)) {
      if (id === "navigation" || p.group === "navigation") p.where = "left";
      // Attributes on its own under Object Info
      if (id === "attributes" && p.group !== null) Object.assign(p, { group: null, tab: null, where: "right", order: (layout.palettes.objectInfo?.order ?? 0) + 0.5 });
    }
    return layout;
  }

  /**
   * Window > Workspaces > Classic: the tools in the Tools and Tool Sets palettes down the left dock,
   * as Vectorworks keeps them, the top bar without them, and the menu bar's row of titles over it;
   * the rest as Standard has it.
   */
  classic(): unknown {
    const layout = defaults([...this.specs.values()]);
    layout.top.tools = false;
    layout.top.menus = true;
    layout.width.left = CLASSIC_LEFT_WIDTH;
    const { basic, toolsets } = layout.palettes;
    if (basic) Object.assign(basic, { where: "left", shown: true, collapsed: false, order: -2 });
    if (toolsets) Object.assign(toolsets, { where: "left", shown: true, collapsed: false, order: -1 });
    return layout;
  }

  /** Rolls every shown palette up to its title, or unrolls them all. */
  collapseAll(collapsed: boolean): void {
    for (const p of Object.values(this.layout.palettes)) p.collapsed = collapsed;
    this.commit();
  }

  /** Back to the arrangement openvwx starts with. */
  reset(): void {
    this.layout = defaults([...this.specs.values()]);
    this.commit();
  }

  /** The arrangement as it stands, to keep under a workspace's name. */
  snapshot(): unknown {
    return JSON.parse(JSON.stringify(this.layout));
  }

  /** Arranges the palettes as a kept snapshot has them. */
  restore(snapshot: unknown): void {
    this.layout = parse([...this.specs.values()], snapshot);
    this.commit();
  }

  /** How wide each dock is, 0 while it has no palette at all; the drawing sits between them. */
  insets(): Insets {
    const cover = (side: DockSide): number => (this.docks[side].hidden ? 0 : this.span(side));
    return { left: cover("left"), right: cover("right"), top: this.shelfSpan("top"), bottom: this.shelfSpan("bottom") };
  }

  // ---- building -----------------------------------------------------------

  private buildDock(side: DockSide): HTMLElement {
    const edge = h("div", { cls: "dock-edge", title: "Drag to resize, double-click to fold" });
    edge.addEventListener("pointerdown", (e) => this.resizeDock(side, edge, e));
    edge.addEventListener("dblclick", () => this.toggleFold(side));
    // a double-click on the rail's empty part folds or unfolds the dock too
    this.rails[side].addEventListener("dblclick", (e) => {
      if (!(e.target as Element).closest("button") && this.docked(side).length > 0) this.toggleFold(side);
    });
    this.rails[side].addEventListener("pointerleave", (e) => this.leaveAutoHidden(side, e));
    return h("div", { cls: `dock dock-${side}`, attrs: { "data-side": side } }, this.rails[side], this.cols[side], edge);
  }

  private buildShelf(shelf: Shelf): HTMLElement {
    const edge = h("div", { cls: "shelf-edge", title: "Drag to resize, double-click to roll up or unroll" });
    edge.addEventListener("pointerdown", (e) => this.resizeShelf(shelf, edge, e));
    edge.addEventListener("dblclick", () => this.rollShelf(shelf));
    return h("div", { cls: `shelf shelf-${shelf}`, attrs: { "data-shelf": shelf, role: "region", "aria-label": SHELF_NAMES[shelf] }, hidden: true }, this.shelfRows[shelf], edge);
  }

  /** The palettes a dock's rail lists, closed ones included, in the order the Window menu has them. */
  private railed(side: DockSide): string[] {
    return [...this.specs.keys()].filter((id) => {
      const p = this.layout.palettes[id];
      // a tab out of its palette while it is out
      if (p === undefined || (this.loose.has(id) && !p.shown)) return false;
      return (p.group === null ? p.where : this.layout.palettes[p.group].where) === side;
    });
  }

  /** A dock's rail: an icon per palette (lit while it is in view, marked while it is open), then the fold button. */
  private fillRail(side: DockSide): void {
    const narrow = this.narrow(side);
    const icons = this.railed(side).map((id) => {
      const spec = this.specs.get(id)!;
      const p = this.layout.palettes[id];
      const host = p.group ?? id;
      const seen = p.shown && this.front(host) === id && (narrow ? this.open?.id === host : !this.layout.palettes[host].collapsed);
      const btn = h("button", {
        cls: seen ? "dock-icon active" : p.shown ? "dock-icon open" : "dock-icon",
        html: spec.icon ?? `<span class="dock-icon-letters">${initials(spec.title)}</span>`,
        title: spec.title,
        attrs: { type: "button", "aria-label": spec.title, "aria-pressed": String(seen), "data-pal": id },
      });
      btn.addEventListener("click", () => this.railClick(side, id));
      btn.addEventListener("pointerenter", (e) => this.hoverRail(side, id, e));
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const rows: Row[] = p.shown ? this.paletteMenu(host) : [{ label: `Show ${spec.title}`, run: () => this.show(id) }];
        openContextMenu(rows, e.clientX, e.clientY);
      });
      return btn;
    });
    const folded = this.layout.folded[side];
    const fold = h("button", {
      cls: folded ? "pal-btn dock-fold folded" : "pal-btn dock-fold",
      html: UNFOLD,
      title: folded ? "Unfold dock" : "Fold dock",
      attrs: { type: "button", "aria-label": `${folded ? "Unfold" : "Fold"} the ${side} dock`, "aria-expanded": String(!folded) },
    });
    fold.addEventListener("click", () => this.toggleFold(side));
    fold.hidden = this.docked(side).length === 0;
    const auto = this.layout.autoHide[side];
    const pin = h("button", {
      cls: auto ? "pal-btn dock-pin on" : "pal-btn dock-pin",
      html: PIN,
      title: auto ? "Keep the dock open" : "Auto-hide the dock",
      attrs: { type: "button", "aria-label": `Auto-hide the ${side} dock`, "aria-pressed": String(auto) },
    });
    pin.addEventListener("click", () => this.toggleAutoHide(side));
    pin.hidden = fold.hidden;
    this.rails[side].replaceChildren(...icons, h("div", { cls: "dock-rail-gap" }), pin, fold);
  }

  /** The pointer resting on an auto-hidden dock's icon: its palette slides out (a closed one waits for a click). */
  private hoverRail(side: DockSide, id: string, e: PointerEvent): void {
    if (!this.layout.autoHide[side] || this.phone || e.pointerType === "touch" || e.buttons !== 0) return;
    const p = this.layout.palettes[id];
    if (!p?.shown) return;
    this.hoverLater(() => {
      const host = p.group ?? id;
      if (this.open?.id !== host || this.front(host) !== id) this.fly({ side, id: host }, id);
    }, HOVER_OPEN_MS);
  }

  /**
   * The pointer leaving an auto-hidden dock's rail or its palette: the palette slides back unless the
   * pointer comes back, a field in it is being typed in, or a menu is open.
   */
  private leaveAutoHidden(side: DockSide, e: PointerEvent): void {
    if (!this.layout.autoHide[side] || this.phone || e.pointerType === "touch" || e.buttons !== 0) return;
    this.hoverLater(() => {
      if (this.open?.side !== side || this.flyout.matches(":hover") || this.rails[side].matches(":hover")) return;
      const focus = document.activeElement;
      if (focus && this.flyout.contains(focus) && focus.matches("input, select, textarea")) return;
      if (document.querySelector(".context-menu")) return;
      this.fly(null);
    }, HOVER_CLOSE_MS);
  }

  private hoverLater(fn: () => void, ms: number): void {
    clearTimeout(this.hoverTimer);
    this.hoverTimer = window.setTimeout(fn, ms);
  }

  /**
   * A click on a rail's icon: a closed palette opens; in a folded dock an open one opens beside the
   * rail or closes again; otherwise a rolled-up palette or a tab behind another comes into view, and
   * one in view closes.
   */
  private railClick(side: DockSide, id: string): void {
    const p = this.layout.palettes[id];
    if (!p.shown) {
      this.show(id);
      return;
    }
    const host = p.group ?? id;
    if (this.layout.folded[side]) {
      const on = this.open?.id === host && this.front(host) === id;
      this.fly(on ? null : { side, id: host }, id);
      return;
    }
    if (!this.layout.palettes[host].collapsed && this.front(host) === id) {
      this.hide(id);
      this.commit();
      return;
    }
    this.bringToFront(host, id);
  }

  private buildPalette(spec: PaletteSpec): HTMLElement {
    const collapse = h("button", {
      cls: "pal-btn pal-collapse",
      html: CHEVRON,
      title: "Roll up",
      attrs: { type: "button", "aria-label": `Roll up ${spec.title}` },
    });
    const close = h("button", {
      cls: "pal-btn pal-close",
      html: CROSS,
      title: "Close",
      attrs: { type: "button", "aria-label": `Close ${spec.title}` },
    });
    const title = h("span", { cls: "pal-title", text: spec.title });
    const head = h("header", { cls: "pal-head" }, collapse, title, close);
    head.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(this.paletteMenu(spec.id), e.clientX, e.clientY);
    });
    const edge = h("div", { cls: "pal-edge" });
    const grip = h("div", { cls: "pal-grip" });
    const el = h(
      "section",
      { cls: spec.fill ? "pal fill" : "pal", attrs: { "data-pal": spec.id, "aria-label": spec.title } },
      head,
      // a tab's body stays in its palette's strip till it comes out
      h("div", { cls: "pal-body" }, ...(this.loose.has(spec.id) ? [] : [spec.body])),
      edge,
      grip,
    );
    collapse.addEventListener("click", () => {
      const p = this.layout.palettes[spec.id];
      p.collapsed = !p.collapsed;
      this.commit();
    });
    // with tabs, the one in front closes
    close.addEventListener("click", () => {
      this.hide(this.front(spec.id));
      this.commit();
    });
    // on a phone the sheet's title lists the palettes to switch to
    title.addEventListener("click", () => {
      if (!this.phone) return;
      const r = title.getBoundingClientRect();
      openContextMenu(this.choices(), r.left, r.bottom, title);
    });
    head.addEventListener("dblclick", (e) => {
      if (this.phone || (e.target as Element).closest("button")) return;
      const p = this.layout.palettes[spec.id];
      p.collapsed = !p.collapsed;
      this.commit();
    });
    head.addEventListener("pointerdown", (e) => this.drag(spec.id, head, e));
    el.addEventListener("pointerdown", () => {
      if (this.layout.palettes[spec.id].where === "float") el.style.zIndex = String(++this.zTop);
    });
    el.addEventListener("pointerenter", () => {
      clearTimeout(this.tuckTimers.get(spec.id));
      el.classList.remove("tucked");
    });
    el.addEventListener("pointerleave", () => this.tuck(spec.id, el));
    edge.addEventListener("pointerdown", (e) => this.split(spec.id, edge, e));
    grip.addEventListener("pointerdown", (e) => this.resizeFloat(spec.id, grip, e));
    return el;
  }

  // ---- layout -------------------------------------------------------------

  /** The rail's width at the interface's density. */
  private rail(): number {
    return RAIL_WIDTH[this.layout.density];
  }

  /** A phone-width window: no docks, and the palettes are one bottom sheet. */
  private get phone(): boolean {
    return this.phoneQuery.matches;
  }

  /** Whether a palette is the one a phone's sheet shows. */
  private inSheet(id: string): boolean {
    return this.phone && this.sheetId === id;
  }

  /** Whether a dock is down to its rail: folded, or with no palette open in it but `except`. */
  private narrow(side: DockSide, except?: string): boolean {
    return this.layout.folded[side] || this.docked(side, except).length === 0;
  }

  /** How wide a dock is drawn: just its rail while it is narrow, and never narrower than the top bar's end over it. */
  private span(side: DockSide, except?: string): number {
    return this.narrow(side, except) ? this.rail() : Math.max(this.layout.width[side], this.floor[side]);
  }

  /** Opens a folded dock's palette beside its strip, `tab` in front, or closes the one open (null). */
  private fly(open: { side: DockSide; id: string } | null, tab?: string): void {
    this.open = open;
    const p = open && this.layout.palettes[open.id];
    const next = tab === undefined || tab === open?.id ? null : tab;
    if (p && p.tab !== next) {
      p.tab = next;
      this.commit();
    } else {
      this.place();
    }
  }

  /** Docked palettes on a side, column by column, in order, leaving out `except` (tabs are part of their palette). */
  private docked(side: DockSide, except?: string): string[] {
    return Object.entries(this.layout.palettes)
      .filter(([id, p]) => p.where === side && p.shown && p.group === null && id !== except && this.specs.has(id))
      .sort((a, b) => this.colOf(a[0]) - this.colOf(b[0]) || a[1].order - b[1].order)
      .map(([id]) => id);
  }

  /** The palettes in a docking bar, left to right, leaving out `except`. */
  private shelved(shelf: Shelf, except?: string): string[] {
    return Object.entries(this.layout.palettes)
      .filter(([id, p]) => p.where === shelf && p.shown && p.group === null && id !== except && this.specs.has(id))
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);
  }

  /** How tall a docking bar is drawn: 0 while it has no palette or is out of sight. */
  private shelfSpan(shelf: Shelf): number {
    return this.shelves[shelf].hidden ? 0 : this.shelves[shelf].offsetHeight;
  }

  /** Rolls every palette in a docking bar up to its title, or unrolls them all when they all are. */
  private rollShelf(shelf: Shelf): void {
    const ids = this.shelved(shelf);
    const roll = ids.some((id) => !this.layout.palettes[id].collapsed);
    for (const id of ids) this.layout.palettes[id].collapsed = roll;
    this.commit();
  }

  /** How many columns a dock's palettes stand in. */
  private colCount(side: DockSide): number {
    return Math.max(1, this.layout.columns[side].length);
  }

  /** The column a docked palette stands in. */
  private colOf(id: string): number {
    const p = this.layout.palettes[id];
    const n = isSide(p.where) ? this.colCount(p.where) : 1;
    return clamp(Math.round(Number.isFinite(p.col) ? p.col : 0), 0, n - 1);
  }

  /** The column beside the drawing. */
  private innermost(side: DockSide): number {
    return side === "left" ? this.colCount(side) - 1 : 0;
  }

  /** A column's palettes, in order, leaving out `except`. */
  private column(side: DockSide, col: number, except?: string): string[] {
    return this.docked(side, except).filter((id) => this.colOf(id) === col);
  }

  /** Every column's width, one column's being the dock's less its rail. */
  private colWidths(side: DockSide): number[] {
    const cols = this.layout.columns[side];
    return cols.length >= 2 ? [...cols] : [this.layout.width[side] - this.rail()];
  }

  /**
   * After a change: a column whose palettes are all gone goes, the dock narrowing by its width
   * (one column left is no columns), and the dock is its rail and its columns wide. Palettes put
   * away keep a column near theirs for when they come back.
   */
  private reconcile(side: DockSide): void {
    const widths = this.layout.columns[side];
    const here = Object.values(this.layout.palettes).filter((p) => p.where === side);
    if (widths.length < 2) {
      this.layout.columns[side] = [];
      for (const p of here) p.col = 0;
      return;
    }
    const ids = this.docked(side);
    if (ids.length === 0) return;
    const used = [...new Set(ids.map((id) => this.colOf(id)))].sort((a, b) => a - b);
    for (const p of here) {
      const c = clamp(Math.round(Number.isFinite(p.col) ? p.col : 0), 0, widths.length - 1);
      p.col = Math.min(used.length - 1, used.filter((u) => u < c).length);
    }
    const kept = used.map((c) => widths[c]);
    this.layout.columns[side] = kept.length >= 2 ? kept : [];
    this.layout.width[side] = this.rail() + kept.reduce((a, b) => a + b, 0);
  }

  /** Floating palettes, leaving out `except`. */
  /** The floating palettes, each with its own box: alone or at the top of a stack. */
  private floats(except?: string): string[] {
    return Object.entries(this.layout.palettes)
      .filter(([id, p]) => p.where === "float" && p.shown && p.group === null && p.stack === null && id !== except && this.specs.has(id))
      .map(([id]) => id);
  }

  /** The palettes docked under a floating one, top to bottom. */
  private stacked(top: string): string[] {
    return Object.entries(this.layout.palettes)
      .filter(([id, p]) => p.stack === top && p.where === "float" && p.shown && p.group === null && this.specs.has(id))
      .sort((a, b) => a[1].order - b[1].order)
      .map(([id]) => id);
  }

  /** Every floating palette, those in stacks too. */
  private floating_(): string[] {
    return this.floats().flatMap((id) => [id, ...this.stacked(id)]);
  }

  /**
   * Keeps the stacks whole: a palette docked, made a tab or under itself leaves its stack, and the
   * first shown palette of a stack whose top is closed, docked or gone takes its place.
   */
  private reconcileStacks(): void {
    const P = this.layout.palettes;
    const top = (id: string): boolean => {
      const q = P[id];
      return q !== undefined && q.where === "float" && q.shown && q.group === null && q.stack === null && this.specs.has(id);
    };
    for (const [id, q] of Object.entries(P)) {
      if (q.stack !== null && (q.where !== "float" || q.group !== null || q.stack === id)) q.stack = null;
    }
    const orphans = new Map<string, string[]>();
    for (const [id, q] of Object.entries(P)) {
      if (q.stack !== null && !top(q.stack)) orphans.set(q.stack, [...(orphans.get(q.stack) ?? []), id]);
    }
    for (const [gone, ids] of orphans) {
      ids.sort((a, b) => P[a].order - P[b].order);
      const heir = ids.find((m) => P[m].shown) ?? ids[0];
      const from = P[gone];
      Object.assign(P[heir], { stack: null }, from ? { x: from.x, y: from.y, w: from.w } : {});
      for (const m of ids) if (m !== heir) P[m].stack = heir;
    }
  }

  /**
   * Docks `id` (with the palettes under it) above or below floating palette `over`, in `over`'s
   * stack; the stack keeps its place, whichever palette ends up at its top.
   */
  private stackOnto(id: string, over: string, below: boolean): void {
    const P = this.layout.palettes;
    const moving = [id, ...this.stacked(id)];
    const top = P[over].stack ?? over;
    const list = [top, ...this.stacked(top)].filter((m) => !moving.includes(m));
    list.splice(list.indexOf(over) + (below ? 1 : 0), 0, ...moving);
    const place = { x: P[top].x, y: P[top].y, w: P[top].w };
    list.forEach((m, i) => {
      Object.assign(P[m], { where: "float", stack: i === 0 ? null : list[0], order: i });
    });
    Object.assign(P[list[0]], place);
  }

  /** A palette's tabs: itself, then the palettes that are tabs of it, in order. */
  private tabs(id: string): string[] {
    const others = Object.entries(this.layout.palettes)
      .filter(([pid, p]) => p.group === id && pid !== id && p.shown && this.specs.has(pid))
      .sort((a, b) => a[1].order - b[1].order)
      .map(([pid]) => pid);
    return [id, ...others];
  }

  /** The tab in front of a palette (itself when it has none). */
  private front(id: string): string {
    const tab = this.layout.palettes[id].tab;
    return tab !== null && this.tabs(id).includes(tab) ? tab : id;
  }

  /** Whether a palette shares its dock's spare height: when any of its tabs does. */
  private fills(id: string): boolean {
    return this.tabs(id).some((t) => this.specs.get(t)!.fill === true);
  }

  /** Gives a palette's element its title, or a tab per palette in it, and the body of the tab in front. */
  private dress(id: string): void {
    const el = this.els.get(id)!;
    // in a phone's sheet a palette shows as itself: its tabs are left to the title's switch
    const sheeted = this.inSheet(id);
    const tabs = sheeted ? [id] : this.tabs(id);
    const front = sheeted ? id : this.front(id);
    const title = el.querySelector<HTMLElement>(".pal-title")!;
    el.classList.toggle("fill", this.fills(id));
    el.classList.toggle("tabbed", tabs.length > 1);
    // Tab Style: the head's tabs and those of the strip in its body
    el.dataset.tabStyle = this.layout.tabStyle[id] ?? "text";
    if (tabs.length > 1) {
      title.replaceChildren(
        ...tabs.map((t) => {
          const spec = this.specs.get(t)!;
          const tab = h(
            "button",
            {
              cls: t === front ? "pal-htab active" : "pal-htab",
              title: spec.title,
              attrs: { type: "button", role: "tab", "aria-selected": String(t === front), "aria-label": spec.title, "data-tab": t },
            },
            ...tabFace(spec.icon ?? `<span class="dock-icon-letters">${initials(spec.title)}</span>`, spec.title),
          );
          // keyboard activation; a press with the pointer is handled where it drags (see drag)
          tab.addEventListener("click", () => this.bringToFront(id, t));
          return tab;
        }),
      );
    } else {
      title.textContent = this.specs.get(id)!.title;
    }
    const body = this.specs.get(front)!.body;
    // a tab out of its palette shows whatever tab is in front there
    if (this.loose.has(front)) body.hidden = false;
    el.querySelector(".pal-body")!.replaceChildren(body);
    el.setAttribute("aria-label", this.specs.get(front)!.title);
  }

  private bringToFront(id: string, tab: string): void {
    const p = this.layout.palettes[id];
    const next = tab === id ? null : tab;
    if (p.tab === next && !p.collapsed) return;
    p.tab = next;
    p.collapsed = false;
    this.commit();
  }

  /** Closes a palette; a tab leaves its palette first, and the next tab takes over a palette that closes. */
  private hide(id: string): void {
    // a phone's sheet holds one palette: hiding it empties the sheet
    if (this.phone) {
      this.sheetId = null;
      return;
    }
    this.detach(id);
    this.layout.palettes[id].shown = false;
    // a tab goes back into its palette, at the end of the strip
    const l = this.loose.get(id);
    if (l) this.layout.tabOrder[l.home] = [...l.strip.ordered().filter((t) => t !== l.tab), l.tab];
  }

  /**
   * Gives a palette its own title bar. A tab takes the place of the palette it leaves, just after
   * it; a palette with tabs passes its place and its other tabs to its next tab.
   */
  private detach(id: string): void {
    const p = this.layout.palettes[id];
    const copyPlace = (to: Placement, from: Placement): void => {
      to.where = from.where;
      to.col = from.col;
      to.stack = from.stack;
      to.collapsed = from.collapsed;
      to.weight = from.weight;
      to.x = from.x;
      to.y = from.y;
      to.w = from.w;
      to.h = from.h;
    };
    if (p.group !== null) {
      const host = this.layout.palettes[p.group];
      if (host.tab === id) host.tab = null;
      p.group = null;
      copyPlace(p, host);
      p.order = host.order + 0.5;
      p.collapsed = false;
      p.x += 24;
      p.y += 24;
      return;
    }
    const rest = this.tabs(id).slice(1);
    if (rest.length === 0) return;
    const heir = rest[0];
    const q = this.layout.palettes[heir];
    copyPlace(q, p);
    q.order = p.order;
    q.group = null;
    q.tab = p.tab === heir || p.tab === id ? null : p.tab;
    for (const t of rest.slice(1)) this.layout.palettes[t].group = heir;
    p.tab = null;
    p.order += 0.5;
    p.x += 24;
    p.y += 24;
  }

  /** Makes palette `id`, with any tabs it has, tabs of `target`'s palette, `id` in front. */
  private join(id: string, target: string): void {
    const host = this.layout.palettes[target].group ?? target;
    if (host === id) return;
    const incoming = this.tabs(id);
    let order = Math.max(0, ...this.tabs(host).slice(1).map((t) => this.layout.palettes[t].order)) + 1;
    for (const t of incoming) {
      const q = this.layout.palettes[t];
      q.group = host;
      q.tab = null;
      q.order = order++;
    }
    const hp = this.layout.palettes[host];
    hp.tab = id;
    hp.collapsed = false;
  }

  /** Moves a palette, with its tabs, to the end of a dock or out to float where it is now. */
  private moveTo(id: string, where: DockSide | Shelf | "float"): void {
    const p = this.layout.palettes[id];
    const el = this.els.get(id)!;
    // a palette in a folded dock has no box: it floats where it last did
    if (where === "float" && el.isConnected) {
      const host = this.host.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      p.x = r.left - host.left;
      p.y = r.top - host.top;
      p.w = Math.max(MIN_FLOAT_W, r.width);
      if (this.fills(id) && !p.collapsed) p.h = Math.max(MIN_FLOAT_H, Math.min(r.height, 420));
    } else if (isSide(where)) {
      p.col = this.innermost(where);
      p.order = this.docked(where, id).length;
    } else if (where !== "float") {
      p.order = this.shelved(where, id).length;
    }
    p.where = where;
    p.stack = null;
    this.commit();
  }

  /** What a right-click on a palette's title bar offers. */
  private paletteMenu(id: string): Row[] {
    // a phone's sheet has no dock to move it to: its menu closes it, and keeps the palette's own options
    if (this.phone) return [{ label: "Close", run: () => { this.hide(id); this.commit(); } }, ...this.optionRows(id)];
    const p = this.layout.palettes[id];
    const front = this.front(id);
    const tabs = this.tabs(id);
    const others = [...this.docked("left"), ...this.docked("right"), ...this.shelved("top"), ...this.shelved("bottom"), ...this.floating_()].filter(
      (o) => o !== id && this.joinable(id, o) && this.homeUnder(id, o) === null,
    );
    return [
      {
        label: p.collapsed ? "Unroll" : "Roll Up",
        run: () => {
          p.collapsed = !p.collapsed;
          this.commit();
        },
      },
      {
        label: tabs.length > 1 ? `Close ${this.specs.get(front)!.title}` : "Close",
        run: () => {
          this.hide(front);
          this.commit();
        },
      },
      "-",
      { label: "Dock Left", checked: () => p.where === "left", run: () => this.moveTo(id, "left") },
      { label: "Dock Right", checked: () => p.where === "right", run: () => this.moveTo(id, "right") },
      { label: "Float", checked: () => p.where === "float", run: () => this.moveTo(id, "float") },
      // Vectorworks 2027's Send to: one of the four docking bars (the docks are the left and right ones)
      {
        label: "Send to",
        items: (["top", "bottom", "left", "right"] as const).map(
          (w): Row => ({
            label: isSide(w) ? `${w === "left" ? "Left" : "Right"} Docking Bar` : SHELF_NAMES[w],
            checked: () => p.where === w,
            run: () => this.moveTo(id, w),
          }),
        ),
      },
      // with tabs, Tab Style: Icon Only, Text Only, or Icon and Text
      ...(tabs.length > 1 || this.strips.has(front)
        ? [
            {
              label: "Tab Style",
              items: TAB_STYLES.map(
                ([style, label]): Row => ({
                  label,
                  checked: () => (this.layout.tabStyle[id] ?? "text") === style,
                  run: () => {
                    if (style === "text") delete this.layout.tabStyle[id];
                    else this.layout.tabStyle[id] = style;
                    this.commit();
                  },
                }),
              ),
            },
          ]
        : []),
      ...(isSide(p.where)
        ? [
            { label: this.layout.folded[p.where] ? "Unfold Dock" : "Fold Dock", run: () => this.toggleFold(p.where as DockSide) },
            { label: "Auto-Hide Dock", checked: () => this.layout.autoHide[p.where as DockSide], run: () => this.toggleAutoHide(p.where as DockSide) },
          ]
        : p.where === "float"
          ? []
          : [
              {
                label: this.shelved(p.where).every((o) => this.layout.palettes[o].collapsed) ? "Unroll Docking Bar" : "Roll Up Docking Bar",
                run: () => this.rollShelf(p.where as Shelf),
              },
            ]),
      "-",
      {
        label: "Add as Tab To",
        enabled: () => others.length > 0,
        items: others.map(
          (o): Row => ({
            label: this.tabs(o)
              .map((t) => this.specs.get(t)!.title)
              .join(", "),
            run: () => {
              this.join(id, o);
              this.commit();
            },
          }),
        ),
      },
      ...(tabs.length > 1
        ? [
            {
              label: `Separate ${this.specs.get(front)!.title}`,
              run: () => {
                this.detach(front);
                this.commit();
              },
            },
            {
              label: "Separate All Tabs",
              run: () => {
                for (const t of tabs.slice(1)) this.detach(t);
                this.commit();
              },
            },
          ]
        : []),
      ...this.tabRows(front),
      ...this.optionRows(front),
    ];
  }

  /** The palette's own options for its title bar's menu, after a divider; none when it has none. */
  private optionRows(id: string): Row[] {
    const rows = this.specs.get(id)?.menu?.() ?? [];
    return rows.length ? ["-", ...rows] : [];
  }

  /** Puts every palette where the layout says, with its sizes and state. */
  private place(): void {
    this.arrangeTabs();
    // a phone has no docks: its palette is in the sheet
    const away = this.layout.away || this.phone;
    const open = this.open;
    if (open && (away || !this.layout.folded[open.side] || !this.docked(open.side).includes(open.id))) this.open = null;
    for (const side of ["left", "right"] as const) {
      const dock = this.docks[side];
      const narrow = this.narrow(side);
      dock.classList.toggle("folded", narrow);
      dock.hidden = away || this.railed(side).length === 0;
      dock.style.width = `${this.span(side)}px`;
      this.fillRail(side);
      // put away, the palettes are in no dock (a phone's is in its sheet)
      if (narrow || away) {
        this.cols[side].replaceChildren();
        continue;
      }
      // the columns side by side, each its share of the dock's width, a handle between each two
      const widths = this.colWidths(side);
      const parts: HTMLElement[] = [];
      widths.forEach((w, c) => {
        const col = this.colEl(side, c);
        col.style.flex = widths.length >= 2 ? `${w} 1 0px` : "";
        col.replaceChildren(...this.column(side, c).map((id) => this.els.get(id)!));
        if (c > 0) parts.push(this.colSplit(side, c - 1));
        parts.push(col);
      });
      this.cols[side].replaceChildren(...parts);
      for (let c = 0; c < widths.length; c++) {
        // a filling palette's lower edge splits the height with the next filling one below it
        const inCol = this.column(side, c);
        const open = inCol.filter((id) => this.fills(id) && !this.layout.palettes[id].collapsed);
        for (const id of inCol) {
          const p = this.layout.palettes[id];
          const el = this.els.get(id)!;
          this.dress(id);
          this.style(id, el, p);
          el.style.flex = this.fills(id) && !p.collapsed ? `${p.weight} 1 0px` : "";
          el.classList.toggle("splits", open.includes(id) && open.indexOf(id) < open.length - 1);
        }
      }
    }
    for (const shelf of SHELVES) this.placeShelf(shelf, away);
    const floats = away ? [] : this.floats();
    // a stack's palettes in one box, top to bottom; a palette alone is its own box
    const boxes = floats.map((id) => {
      const under = this.stacked(id);
      if (under.length === 0) return this.els.get(id)!;
      const box = this.stackBoxes.get(id) ?? this.stackBox(id);
      box.replaceChildren(...[id, ...under].map((m) => this.els.get(m)!));
      return box;
    });
    this.floating.replaceChildren(...boxes);
    for (const id of floats) {
      for (const m of [id, ...this.stacked(id)]) {
        const el = this.els.get(m)!;
        this.dress(m);
        this.style(m, el, this.layout.palettes[m]);
        el.style.flex = "";
        el.classList.remove("splits");
      }
      const box = this.stackBoxes.get(id);
      if (box?.isConnected) this.placeStack(id, box);
    }
    this.placeFlyout();
    this.placeSheet();
    for (const [id, el] of this.bars) el.hidden = !this.layout.bars[id];
    this.dressViewBar();
    for (const id of this.barBoxes.keys()) this.placeBar(id);
    this.placeTop();
    document.documentElement.dataset.density = this.layout.density;
  }

  /** A floating stack's box: the palettes docked under one another, moved and resized as one. */
  private stackBox(top: string): HTMLElement {
    const box = h("div", { cls: "pal-stack", attrs: { "data-stack": top } });
    box.addEventListener("pointerdown", () => {
      box.style.zIndex = String(++this.zTop);
    });
    this.stackBoxes.set(top, box);
    return box;
  }

  /** Puts a stack's box where the palette at its top floats, as wide as it, no taller than the window below it. */
  private placeStack(top: string, box: HTMLElement): void {
    const p = this.layout.palettes[top];
    const bounds = this.host.getBoundingClientRect();
    const x = clamp(p.x, 0, Math.max(0, bounds.width - 60));
    const y = clamp(p.y, 0, Math.max(0, bounds.height - 28));
    Object.assign(box.style, { left: `${x}px`, top: `${y}px`, width: `${p.w}px`, maxHeight: `${Math.max(MIN_FLOAT_H, bounds.height - y - GAP)}px` });
  }

  /** A docking bar's palettes side by side, each its share of the width, a handle between each two; as tall as their titles while all are rolled up. */
  private placeShelf(shelf: Shelf, away: boolean): void {
    const ids = away ? [] : this.shelved(shelf);
    const bar = this.shelves[shelf];
    bar.hidden = ids.length === 0;
    const parts: HTMLElement[] = [];
    ids.forEach((id, i) => {
      if (i > 0) parts.push(this.shelfSplit(shelf, i - 1));
      parts.push(this.els.get(id)!);
    });
    this.shelfRows[shelf].replaceChildren(...parts);
    for (const id of ids) {
      const p = this.layout.palettes[id];
      const el = this.els.get(id)!;
      this.dress(id);
      this.style(id, el, p);
      el.style.flex = p.collapsed ? "" : `${p.weight} 1 0px`;
      el.classList.remove("splits");
    }
    const open = ids.some((id) => !this.layout.palettes[id].collapsed);
    const most = Math.max(MIN_SHELF_H, Math.round(this.host.clientHeight * MAX_SHELF_SHARE));
    bar.style.height = open ? `${clamp(this.layout.shelf[shelf], MIN_SHELF_H, most)}px` : "";
  }

  /** The handle between palette `i` of a docking bar and the next: one widens as the other narrows. */
  private shelfSplit(shelf: Shelf, i: number): HTMLElement {
    const el = h("div", { cls: "shelf-split", attrs: { role: "separator", "aria-orientation": "vertical" } });
    el.addEventListener("pointerdown", (e) => this.resizeShelfPair(shelf, i, el, e));
    return el;
  }

  /** Each tabbed palette's strip as the layout has it: in its order, without the tabs out of it (a phone's sheet shows a palette whole). */
  private arrangeTabs(): void {
    for (const [home, strip] of this.strips) {
      const out = new Set(this.phone ? [] : strip.panels.map((t) => t.id).filter((t) => this.layout.palettes[`${home}:${t}`]?.shown));
      strip.locked = this.layout.tabLock[home] === true;
      strip.arrange(this.layout.tabOrder[home] ?? [], out);
    }
  }

  /**
   * A tab dragged off its palette's strip: it comes out as a floating palette of its own under the
   * pointer, as wide as its palette, and goes on being dragged like any palette (into a dock, onto
   * its palette's other tabs that are out, or back onto its palette).
   */
  private tearOff(home: string, tab: string, e: PointerEvent): boolean {
    const id = `${home}:${tab}`;
    const p = this.layout.palettes[id];
    if (!p || this.phone || this.layout.away) return false;
    const host = this.host.getBoundingClientRect();
    const from = this.els.get(this.layout.palettes[home].group ?? home)!.getBoundingClientRect();
    Object.assign(p, {
      where: "float",
      group: null,
      tab: null,
      shown: true,
      collapsed: false,
      w: Math.max(MIN_FLOAT_W, Math.round(from.width)),
      h: Math.max(MIN_FLOAT_H, Math.min(Math.round(from.height), 360)),
      x: e.clientX - host.left - 40,
      y: clamp(e.clientY - host.top - 12, 0, host.height - 24),
    });
    this.commit();
    const el = this.els.get(id)!;
    el.style.zIndex = String(++this.zTop);
    this.drag(id, el.querySelector<HTMLElement>(".pal-head")!, e, true);
    return true;
  }

  /**
   * A tab out of its palette by its title bar's menu: a floating palette of its own beside the
   * palette, toward the drawing (in the window's middle when the palette is closed), as wide as it.
   */
  private undock(home: string, tab: string): void {
    const id = `${home}:${tab}`;
    const p = this.layout.palettes[id];
    const strip = this.strips.get(home);
    if (!p || !strip || this.phone || strip.inStrip().length < 2) return;
    this.layout.away = false;
    const host = this.host.getBoundingClientRect();
    const from = this.els.get(this.layout.palettes[home].group ?? home)!.getBoundingClientRect();
    const open = from.width > 0;
    const w = Math.max(MIN_FLOAT_W, Math.round(open ? from.width : 240));
    const tall = Math.max(MIN_FLOAT_H, Math.min(Math.round(open ? from.height : 360), 360));
    const onRight = from.left - host.left > host.width / 2;
    const x = !open ? (host.width - w) / 2 : onRight ? from.left - host.left - w - 12 : from.right - host.left + 12;
    Object.assign(p, {
      where: "float",
      group: null,
      tab: null,
      shown: true,
      collapsed: false,
      w,
      h: tall,
      x: clamp(Math.round(x), 0, Math.max(0, host.width - w)),
      y: clamp(Math.round(open ? from.top - host.top : 80), 0, Math.max(0, host.height - 24)),
    });
    this.commit();
    const el = this.els.get(id);
    if (el) el.style.zIndex = String(++this.zTop);
  }

  /** The palette `id`'s tabs came out of, when `target`'s palette is it or holds it: dropped there, they go back. */
  private homeUnder(id: string, target: string): string | null {
    const l = this.loose.get(id);
    if (!l) return null;
    return this.tabs(this.layout.palettes[target].group ?? target).includes(l.home) ? l.home : null;
  }

  /**
   * Whether palette `id` (with its tabs) may become tabs of `target`'s palette: tabs out of a
   * palette only with that palette's other tabs out of it, or back into it, and not while its tabs
   * are locked; other palettes only with palettes that are not tabs out of one.
   */
  private joinable(id: string, target: string): boolean {
    const there = this.tabs(this.layout.palettes[target].group ?? target);
    const homes = there.map((t) => this.loose.get(t)?.home ?? null);
    const l = this.loose.get(id);
    if (!l) return homes.every((x) => x === null);
    if (this.layout.tabLock[l.home]) return false;
    return there.includes(l.home) || homes.every((x) => x === l.home);
  }

  /** Puts tabs back into the palette they came out of, at the end of its strip, the first of them in front. */
  private putBack(ids: readonly string[]): void {
    const first = ids.map((t) => this.loose.get(t)).find((l) => l !== undefined);
    for (const t of ids) if (this.loose.has(t)) this.hide(t);
    this.commit();
    if (first) first.strip.show(first.tab);
  }

  /** A tabbed palette's title bar menu rows for its tabs: each one out docked back, all of them, and Lock tabs. */
  private tabRows(id: string): Row[] {
    const strip = this.strips.get(id);
    if (!strip || this.phone) return [];
    const locked = (): boolean => this.layout.tabLock[id] === true;
    const out = strip.panels.filter((t) => this.layout.palettes[`${id}:${t.id}`]?.shown);
    const kept = strip.panels.filter((t) => !out.includes(t));
    return [
      "-",
      // a tab still in the palette comes out beside it, as one dragged off the strip does (the last stays)
      ...kept.map((t): Row => ({ label: `Undock ${t.name ?? t.label}`, enabled: () => !locked() && kept.length > 1, run: () => this.undock(id, t.id) })),
      ...out.map((t): Row => ({ label: `Dock ${t.label} here`, enabled: () => !locked(), run: () => this.putBack([`${id}:${t.id}`]) })),
      { label: "Dock all tabs here", enabled: () => out.length > 0 && !locked(), run: () => this.putBack(out.map((t) => `${id}:${t.id}`)) },
      {
        label: "Lock tabs",
        checked: locked,
        run: () => {
          if (locked()) delete this.layout.tabLock[id];
          else this.layout.tabLock[id] = true;
          this.commit();
        },
      },
    ];
  }

  /** The View bar as View Bar Options has it: regular, compact or auto-hidden, with or without its captions. */
  private dressViewBar(): void {
    const el = this.bars.get("viewbar");
    if (!el) return;
    const mode = this.layout.viewBar;
    el.classList.toggle("vb-compact", mode === "compact");
    el.classList.toggle("vb-autohide", mode === "autohide");
    el.classList.toggle("vb-labels", this.layout.viewBarLabels);
    if (mode !== "autohide") el.classList.remove("vb-out");
  }

  /** Column `c` of a dock's element, made the first time it is needed. */
  private colEl(side: DockSide, c: number): HTMLElement {
    while (this.colEls[side].length <= c) this.colEls[side].push(h("div", { cls: "dock-col" }));
    return this.colEls[side][c];
  }

  /** The handle between column `c` of a dock and the next, made the first time it is needed. */
  private colSplit(side: DockSide, c: number): HTMLElement {
    while (this.colSplits[side].length <= c) {
      const at = this.colSplits[side].length;
      const edge = h("div", {
        cls: "dock-col-split",
        title: "Drag to resize the columns",
        attrs: { role: "separator", "aria-orientation": "vertical", "aria-label": "Drag to resize the columns" },
      });
      edge.addEventListener("pointerdown", (e) => this.resizeColumns(side, at, edge, e));
      this.colSplits[side].push(edge);
    }
    return this.colSplits[side][c];
  }

  /** The top bar's groups shown or hidden (a phone keeps them all, its tools being its bottom bar, but has no room for the menu bar's row). */
  private placeTop(): void {
    for (const [id, el] of this.topGroups) el.hidden = id === "menus" ? !this.layout.top.menus || this.phone : !this.layout.top[id] && !this.phone;
  }

  /** A bar rolled up or not, and moved where its place has it (none of this on a phone). */
  private placeBar(id: BarId): void {
    const box = this.barBoxes.get(id);
    if (!box) return;
    const place = this.layout.barPlaces[id];
    box.classList.toggle("hud-rolled", place.rolled && !this.phone);
    // the Mode bar fits its modes again to its width
    box.dispatchEvent(new Event("barroll"));
    this.fitBar(id);
  }

  /** Moves a bar by its place, as far as the drawing has room: the place is kept for a wider one. */
  private fitBar(id: BarId): void {
    const box = this.barBoxes.get(id);
    if (!box) return;
    const place = this.layout.barPlaces[id];
    const area = box.closest<HTMLElement>(".stage");
    if (this.phone || !area || (place.dx === 0 && place.dy === 0)) {
      box.style.transform = "";
      this.barShift.delete(id);
      return;
    }
    // hidden (closed, or the 2D bars in 3D): it fits when it shows again
    if (!box.offsetParent) return;
    box.style.transform = "";
    const r = box.getBoundingClientRect();
    const a = area.getBoundingClientRect();
    const dx = clamp(r.left + place.dx, a.left + GAP, Math.max(a.left + GAP, a.right - GAP - r.width)) - r.left;
    const dy = clamp(r.top + place.dy, a.top + GAP, Math.max(a.top + GAP, a.bottom - GAP - r.height)) - r.top;
    box.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
    this.barShift.set(id, { dx, dy });
  }

  /** The folded dock's palette that is open, unrolled beside its rail at the dock's unfolded width. */
  private placeFlyout(): void {
    const fly = this.flyout;
    fly.hidden = this.open === null;
    if (this.open === null) {
      fly.replaceChildren();
      return;
    }
    const { side, id } = this.open;
    const el = this.els.get(id)!;
    this.dress(id);
    this.style(id, el, { ...this.layout.palettes[id], collapsed: false });
    el.style.flex = this.fills(id) ? "1 1 0px" : "";
    el.classList.remove("splits");
    fly.replaceChildren(el);
    fly.dataset.side = side;
    fly.classList.toggle("fill", this.fills(id));
    fly.style.width = `${this.layout.width[side] - this.rail()}px`;
    fly.style.left = side === "left" ? `${this.rail()}px` : "";
    fly.style.right = side === "right" ? `${this.rail()}px` : "";
  }

  /** A phone's sheet: the palette in it, at its height stop; hidden, and empty, otherwise. */
  private placeSheet(): void {
    const id = this.phone ? this.sheetId : null;
    const el = id === null ? undefined : this.els.get(id);
    this.sheet.hidden = el === undefined;
    this.host.classList.toggle("sheet-open", el !== undefined);
    this.host.classList.toggle("sheet-tall", el !== undefined && this.sheetStop === SHEET_STOPS.length - 1);
    if (id === null || el === undefined) {
      this.sheet.replaceChildren();
      return;
    }
    this.dress(id);
    // a palette in the sheet keeps no box of its own, and does not roll up
    el.classList.remove("floating", "collapsed", "splits", "tucked");
    for (const k of ["left", "top", "width", "height", "maxHeight", "zIndex", "flex"] as const) el.style[k] = "";
    this.sheet.replaceChildren(this.grip, el);
    this.host.style.setProperty("--sheet-h", `${SHEET_STOPS[this.sheetStop]}dvh`);
  }

  private style(id: string, el: HTMLElement, p: Placement): void {
    const float = p.where === "float";
    el.classList.toggle("collapsed", p.collapsed);
    el.classList.toggle("floating", float);
    if (!float || !this.layout.autoHideFloating) el.classList.remove("tucked");
    const btn = el.querySelector(".pal-collapse");
    btn?.setAttribute("aria-expanded", String(!p.collapsed));
    btn?.setAttribute("title", p.collapsed ? "Unroll" : "Roll up");
    const inStack = float && (p.stack !== null || this.stacked(id).length > 0);
    el.classList.toggle("stacked", inStack);
    if (inStack) {
      // its box is the stack's: it keeps only its own height, when it fills
      for (const k of ["left", "top", "width", "maxHeight", "zIndex"] as const) el.style[k] = "";
      el.style.height = p.collapsed || !this.fills(id) ? "" : `${p.h}px`;
    } else if (float) {
      const bounds = this.host.getBoundingClientRect();
      const x = clamp(p.x, 0, Math.max(0, bounds.width - 60));
      const y = clamp(p.y, 0, Math.max(0, bounds.height - 28));
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${p.w}px`;
      el.style.height = p.collapsed || !this.fills(id) ? "" : `${p.h}px`;
      el.style.maxHeight = p.collapsed ? "" : `${Math.max(MIN_FLOAT_H, bounds.height - y - GAP)}px`;
    } else {
      for (const k of ["left", "top", "width", "height", "maxHeight", "zIndex"] as const) el.style[k] = "";
    }
  }

  /** Rolls a floating palette up to its title a moment after the pointer leaves it, while Auto-Hide Floating Palettes is on. */
  private tuck(id: string, el: HTMLElement): void {
    clearTimeout(this.tuckTimers.get(id));
    const p = this.layout.palettes[id];
    if (!this.layout.autoHideFloating || !p || p.where !== "float" || p.group !== null || p.collapsed || this.phone) return;
    this.tuckTimers.set(
      id,
      window.setTimeout(() => {
        // not while the pointer is back on it, or a field in it is being typed in
        if (el.matches(":hover") || el.contains(document.activeElement)) return;
        if (this.layout.autoHideFloating && this.layout.palettes[id]?.where === "float") el.classList.add("tucked");
      }, TUCK_DELAY_MS),
    );
  }

  /**
   * An auto-hidden View bar comes out while the pointer is within REVEAL_PX of it, and stays out
   * while a field in it has focus or a menu is open; it goes again a moment after neither holds.
   * `e` null: focus moved, the pointer didn't.
   */
  private revealViewBar(e: PointerEvent | null): void {
    const el = this.bars.get("viewbar");
    const box = this.barBoxes.get("viewbar");
    if (!el || !box || this.layout.viewBar !== "autohide") return;
    const out = el.classList.contains("vb-out");
    let near = false;
    if (e) {
      const r = box.getBoundingClientRect();
      near = e.clientX >= r.left - REVEAL_PX && e.clientX <= r.right + REVEAL_PX && e.clientY >= r.top - REVEAL_PX && e.clientY <= r.bottom + REVEAL_PX;
    }
    const busy = box.contains(document.activeElement) || document.querySelector(".menu-panel:not([hidden])") !== null;
    if (near || (out && busy)) {
      clearTimeout(this.viewBarTimer);
      this.viewBarTimer = 0;
      el.classList.add("vb-out");
    } else if (out && !this.viewBarTimer) {
      this.viewBarTimer = window.setTimeout(() => {
        this.viewBarTimer = 0;
        if (!box.contains(document.activeElement) && !document.querySelector(".menu-panel:not([hidden])")) el.classList.remove("vb-out");
      }, TUCK_DELAY_MS);
    }
  }

  private commit(): void {
    this.reconcileStacks();
    for (const side of ["left", "right"] as const) {
      this.reconcile(side);
      this.docked(side).forEach((id, i) => {
        this.layout.palettes[id].order = i;
      });
    }
    for (const shelf of SHELVES) {
      this.shelved(shelf).forEach((id, i) => {
        this.layout.palettes[id].order = i;
      });
    }
    save(this.layout);
    this.place();
    for (const fn of this.listeners) fn();
  }

  // ---- gestures -----------------------------------------------------------

  /** Follows a press on `handle` until it is released; `move` gets the travel since the press. */
  private track(
    handle: HTMLElement,
    e: PointerEvent,
    move: (dx: number, dy: number, ev: PointerEvent) => void,
    end: (ev: PointerEvent) => void,
  ): void {
    const x0 = e.clientX;
    const y0 = e.clientY;
    handle.setPointerCapture(e.pointerId);
    // on the window: lifting a palette out of its dock moves it in the page, which ends the capture
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId === e.pointerId) move(ev.clientX - x0, ev.clientY - y0, ev);
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      end(ev);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  /** Drags a bar by its grip anywhere over the drawing; a press that doesn't move is a click (roll up). */
  private dragBar(id: BarId, box: HTMLElement, grip: HTMLElement, e: PointerEvent): void {
    if (this.phone || e.button !== 0) return;
    const place = this.layout.barPlaces[id];
    const from = this.barShift.get(id) ?? { dx: place.dx, dy: place.dy };
    let moved = false;
    this.track(
      grip,
      e,
      (dx, dy) => {
        if (!moved && Math.hypot(dx, dy) < DRAG_START_PX) return;
        moved = true;
        box.classList.add("hud-moving");
        Object.assign(place, { dx: from.dx + dx, dy: from.dy + dy });
        this.fitBar(id);
      },
      () => {
        box.classList.remove("hud-moving");
        if (!moved) return;
        // where it shows: dragged past the drawing's edge, it stays at the edge
        Object.assign(place, this.barShift.get(id) ?? {});
        this.barDragged = true;
        setTimeout(() => (this.barDragged = false));
        this.commit();
      },
    );
  }

  /**
   * Drags a palette by its title bar: into a dock, to another place in one, onto another palette's
   * title bar to become a tab of it, or out to float. A press on one of its tabs drags that tab out
   * on its own, or, without moving, brings it to the front.
   */
  private drag(id: string, head: HTMLElement, e: PointerEvent, torn = false): void {
    // a tab torn off its palette's strip is already on the move
    if (!torn && (this.phone || e.button !== 0 || (e.target as Element).closest("button:not(.pal-htab), input, select"))) return;
    if (!torn) e.preventDefault();
    const pressedTab = (e.target as Element).closest<HTMLElement>(".pal-htab")?.dataset.tab ?? null;
    /** the palette that moves: the pressed tab once it is pulled out, else the whole palette */
    let moving = id;
    let start: DOMRect | null = null;
    let target: DropAt | null = null;
    /** the docking bar it would join, and where in it */
    let shelfAt: { shelf: Shelf; index: number } | null = null;
    let tabInto: string | null = null;
    /** the floating palette it would dock above or below */
    let stackAt: { over: string; below: boolean } | null = null;
    /** the palettes under it in a floating stack, which come along; and what follows the pointer (the stack's box, or the palette) */
    let crew: string[] = [];
    let box: HTMLElement | null = null;
    /** the docked palette the docking guide stands over */
    let guideFor: string | null = null;
    this.track(
      head,
      e,
      (dx, dy, ev) => {
        const host = this.host.getBoundingClientRect();
        if (!start) {
          if (Math.hypot(dx, dy) < DRAG_START_PX) return;
          start = this.els.get(id)!.getBoundingClientRect();
          if (pressedTab !== null && this.tabs(id).length > 1) {
            // the tab comes out as a palette of its own, under the pointer where its palette was
            moving = pressedTab;
            this.detach(pressedTab);
            this.place();
            start = new DOMRect(start.left, start.top, start.width, Math.min(start.height, 360));
          }
          const p = this.layout.palettes[moving];
          // the top of a floating stack takes the stack along; one under another comes away from it
          crew = p.where === "float" && p.stack === null ? this.stacked(moving) : [];
          const stackBox = this.stackBoxes.get(moving);
          if (crew.length > 0 && stackBox?.isConnected) {
            box = stackBox;
            start = stackBox.getBoundingClientRect();
            stackBox.classList.add("dragging");
            stackBox.style.zIndex = String(++this.zTop);
          }
          p.stack = null;
        }
        if (!box) {
          // lift it out where it is, as a floating palette that follows the pointer
          const el = this.els.get(moving)!;
          const p = this.layout.palettes[moving];
          box = el;
          el.classList.remove("stacked");
          el.classList.add("floating", "dragging");
          el.style.flex = "";
          el.style.width = `${start.width}px`;
          el.style.height = this.fills(moving) && !p.collapsed ? `${Math.min(start.height, 360)}px` : "";
          el.style.zIndex = String(++this.zTop);
          this.floating.append(el);
          if (this.open) {
            this.open = null;
            this.flyout.hidden = true;
          }
          if (p.where !== "float") {
            // the rest of its dock closes up, to its rail when nothing else is open in it
            for (const side of ["left", "right"] as const) {
              if (!this.narrow(side, moving)) continue;
              this.docks[side].classList.add("folded");
              this.docks[side].style.width = `${this.rail()}px`;
            }
          }
        }
        box.style.left = `${start.left - host.left + dx}px`;
        box.style.top = `${clamp(start.top - host.top + dy, 0, host.height - 24)}px`;
        // Option or Ctrl held: it floats, as in Vectorworks, with no guides
        const free = ev.altKey || ev.ctrlKey;
        tabInto = free ? null : this.titleUnder(ev.clientX, ev.clientY, moving);
        guideFor = free || tabInto !== null ? null : this.guideOver(ev.clientX, ev.clientY, moving, guideFor);
        this.showGuides(free ? null : moving, guideFor, start.width);
        const cell = free ? null : this.cellUnder(ev.clientX, ev.clientY);
        target = null;
        shelfAt = null;
        stackAt = null;
        if (cell?.at === "tab" && guideFor !== null) tabInto = this.joinable(moving, guideFor) ? guideFor : null;
        else if (cell?.shelf) shelfAt = { shelf: cell.shelf, index: this.shelved(cell.shelf, moving).length };
        else if (cell && cell.at !== null && guideFor !== null && this.layout.palettes[guideFor].where === "float") {
          if (cell.at === "top" || cell.at === "bottom") stackAt = { over: guideFor, below: cell.at === "bottom" };
        } else if (cell) target = this.guideTarget(cell, guideFor, moving);
        else if (tabInto === null && !free) {
          // over a docking bar (or near the drawing's top or bottom edge) it joins the bar, before a dock's reach
          shelfAt = this.shelfTarget(ev.clientX - host.left, ev.clientY - host.top, moving);
          if (!shelfAt) target = this.dropTarget(ev.clientX - host.left, ev.clientY - host.top, moving);
        }
        const edges = [...Object.values(this.edgeGuides), ...Object.values(this.shelfGuides)].map((g) => g.firstElementChild!);
        for (const c of [...Object.values(this.guideCells), ...edges]) c.classList.toggle("on", c === cell?.el);
        this.showDrop(target, moving, tabInto, start.width);
        this.showShelfDrop(shelfAt, moving);
        this.showStackDrop(stackAt);
      },
      () => {
        this.showDrop(null, moving, null, 0);
        this.showShelfDrop(null, moving);
        this.showGuides(null, null, 0);
        if (!start || !box) {
          if (pressedTab !== null) this.bringToFront(id, pressedTab);
          return;
        }
        const el = box;
        const p = this.layout.palettes[moving];
        el.classList.remove("dragging");
        /** it and the palettes that came along with it, in order */
        const all = [moving, ...crew];
        const back = tabInto === null ? null : this.homeUnder(moving, tabInto);
        if (back !== null) {
          // onto the palette it came out of: back into its strip
          this.putBack(this.tabs(moving));
          return;
        }
        this.showStackDrop(null);
        if (tabInto !== null) {
          for (const m of all) this.join(m, tabInto);
        } else if (stackAt) {
          this.stackOnto(moving, stackAt.over, stackAt.below);
        } else if (shelfAt) {
          const others = this.shelved(shelfAt.shelf, moving).filter((m) => !all.includes(m));
          others.splice(shelfAt.index, 0, ...all);
          for (const m of all) this.layout.palettes[m].where = shelfAt.shelf;
          others.forEach((pid, i) => {
            this.layout.palettes[pid].order = i;
          });
        } else if (target?.newCol) {
          this.addColumn(target.side, target.col, moving, this.newColWidth(start.width));
          crew.forEach((m, i) => Object.assign(this.layout.palettes[m], { where: target!.side, col: p.col, order: i + 1 }));
        } else if (target) {
          const others = this.column(target.side, target.col, moving).filter((m) => !all.includes(m));
          others.splice(target.index, 0, ...all);
          for (const m of all) Object.assign(this.layout.palettes[m], { where: target.side, col: target.col });
          others.forEach((pid, i) => {
            this.layout.palettes[pid].order = i;
          });
        } else {
          p.where = "float";
          p.x = parseFloat(el.style.left) || 0;
          p.y = parseFloat(el.style.top) || 0;
          p.w = Math.max(MIN_FLOAT_W, start.width);
          // a stack keeps its palettes' heights
          if (crew.length === 0 && this.fills(moving) && !p.collapsed) p.h = Math.max(MIN_FLOAT_H, el.offsetHeight);
        }
        this.commit();
      },
    );
  }

  /** The palette whose title bar is under (x, y) in the window, leaving out `except`; null when none is. */
  private titleUnder(x: number, y: number, except: string): string | null {
    if (this.layout.away) return null;
    // floating palettes take tabs only while they dock to each other
    const floating = this.layout.floatDock ? this.floating_() : [];
    for (const id of [...this.docked("left"), ...this.docked("right"), ...this.shelved("top"), ...this.shelved("bottom"), ...floating]) {
      if (id === except || !this.joinable(except, id)) continue;
      const r = this.els.get(id)!.querySelector(".pal-head")!.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }

  /** The dock and place a palette dropped at (x, y) in the workspace would take, or null to float. */
  private dropTarget(x: number, y: number, id: string): DropAt | null {
    const width = this.host.clientWidth;
    let side: DockSide | null = null;
    if (x <= this.span("left", id) + DOCK_REACH_PX) side = "left";
    else if (x >= width - this.span("right", id) - DOCK_REACH_PX) side = "right";
    if (!side) return null;
    const host = this.host.getBoundingClientRect();
    // the column under the pointer, or the one beside the drawing
    let col = this.innermost(side);
    if (!this.narrow(side, id)) {
      this.colEls[side].slice(0, this.colCount(side)).forEach((el, c) => {
        const r = el.getBoundingClientRect();
        if (x + host.left >= r.left && x + host.left <= r.right) col = c;
      });
    }
    const ids = this.column(side, col, id);
    let index = ids.length;
    for (let i = 0; i < ids.length; i++) {
      const r = this.els.get(ids[i])!.getBoundingClientRect();
      if (y < r.top - host.top + r.height / 2) {
        index = i;
        break;
      }
    }
    return { side, col, index, newCol: false };
  }

  /** The docked palette (not `except`) the docking guide stands over at (x, y) in the window: `current` while the pointer is on its guide. */
  private guideOver(x: number, y: number, except: string, current: string | null): string | null {
    if (current !== null && !this.guide.hidden && inside(this.guide.getBoundingClientRect(), x, y)) return current;
    // floating palettes over the docks first, the moving one and those under it left out
    if (this.layout.floatDock) {
      const moving = new Set([except, ...this.stacked(except)]);
      for (const id of this.floating_()) {
        if (!moving.has(id) && inside(this.els.get(id)!.getBoundingClientRect(), x, y)) return id;
      }
    }
    for (const side of ["left", "right"] as const) {
      if (this.narrow(side, except)) continue;
      for (const id of this.docked(side, except)) {
        if (inside(this.els.get(id)!.getBoundingClientRect(), x, y)) return id;
      }
    }
    return null;
  }

  /** The docking bar and place a palette dropped at (x, y) in the workspace would take: near the drawing's top or bottom edge, between the docks. */
  private shelfTarget(x: number, y: number, id: string): { shelf: Shelf; index: number } | null {
    if (x <= this.span("left", id) || x >= this.host.clientWidth - this.span("right", id)) return null;
    let shelf: Shelf | null = null;
    if (y <= this.shelfSpan("top") + DOCK_REACH_PX) shelf = "top";
    else if (y >= this.host.clientHeight - this.shelfSpan("bottom") - DOCK_REACH_PX) shelf = "bottom";
    if (!shelf) return null;
    const left = this.host.getBoundingClientRect().left;
    const ids = this.shelved(shelf, id);
    const at = ids.findIndex((pid) => {
      const r = this.els.get(pid)!.getBoundingClientRect();
      return x + left < r.left + r.width / 2;
    });
    return { shelf, index: at < 0 ? ids.length : at };
  }

  /** Shows where a dragged palette would stand in a docking bar (null for none): a line between its palettes, or the bar it would make. */
  private showShelfDrop(at: { shelf: Shelf; index: number } | null, moving: string): void {
    for (const shelf of SHELVES) this.shelves[shelf].classList.toggle("drop", at?.shelf === shelf);
    if (!at) return;
    const host = this.host.getBoundingClientRect();
    const ids = this.shelved(at.shelf, moving);
    const bar = this.shelves[at.shelf];
    if (ids.length === 0 || bar.hidden) {
      // an empty bar: where it will stand, across the drawing
      const left = this.span("left", moving);
      const height = Math.min(this.layout.shelf[at.shelf], Math.round(host.height * MAX_SHELF_SHARE));
      Object.assign(this.preview.style, {
        left: `${left}px`,
        width: `${host.width - left - this.span("right", moving)}px`,
        top: `${at.shelf === "top" ? 0 : host.height - height}px`,
        height: `${height}px`,
      });
      this.preview.hidden = false;
      return;
    }
    const r = bar.getBoundingClientRect();
    const x = at.index < ids.length ? this.els.get(ids[at.index])!.getBoundingClientRect().left - 2 : this.els.get(ids[ids.length - 1])!.getBoundingClientRect().right - 1;
    Object.assign(this.dropLine.style, { left: `${x - host.left}px`, top: `${r.top - host.top}px`, width: "2px", height: `${r.height}px` });
    this.dropLine.hidden = false;
  }

  /** Shows where a palette dragged onto a floating one's guide would dock: a line along that palette's top or bottom edge. */
  private showStackDrop(at: { over: string; below: boolean } | null): void {
    if (!at) return;
    const host = this.host.getBoundingClientRect();
    const r = this.els.get(at.over)!.getBoundingClientRect();
    Object.assign(this.dropLine.style, { left: `${r.left - host.left}px`, top: `${(at.below ? r.bottom + 1 : r.top - 3) - host.top}px`, width: `${r.width}px`, height: "" });
    this.dropLine.hidden = false;
  }

  /** Whether a dock can take another column `w` wide and leave the drawing room. */
  private roomForColumn(side: DockSide, except: string, w: number): boolean {
    if (this.colCount(side) >= MAX_COLUMNS) return false;
    const other: DockSide = side === "left" ? "right" : "left";
    return this.span(side, except) + w + this.span(other, except) + DRAWING_ROOM_PX <= this.host.clientWidth;
  }

  /** The width a new column takes: the dragged palette's. */
  private newColWidth(w: number): number {
    return clamp(Math.round(w), MIN_COL_WIDTH, MAX_WIDTH - this.rail());
  }

  /**
   * Shows the docking guides for a dragged palette (`moving`, null to hide them): one over the
   * docked palette `over`, its left and right squares only where the dock has room for a column the
   * palette's width, and one at each side of the drawing.
   */
  private showGuides(moving: string | null, over: string | null, width: number): void {
    const host = this.host.getBoundingClientRect();
    this.guide.hidden = moving === null || over === null;
    if (moving !== null && over !== null) {
      const r = this.els.get(over)!.getBoundingClientRect();
      const size = 3 * GUIDE_CELL_PX + 6;
      const where = this.layout.palettes[over].where;
      // a floating palette takes others above and below it, not in columns beside it
      const room = isSide(where) && this.roomForColumn(where, moving, this.newColWidth(width));
      this.guideCells.tab.classList.toggle("off", !this.joinable(moving, over));
      this.guideCells.left.classList.toggle("off", !room);
      this.guideCells.right.classList.toggle("off", !room);
      this.guide.style.left = `${clamp(r.left - host.left + r.width / 2 - size / 2, 0, host.width - size)}px`;
      this.guide.style.top = `${clamp(r.top - host.top + r.height / 2 - size / 2, 0, host.height - size)}px`;
    }
    for (const shelf of SHELVES) {
      const g = this.shelfGuides[shelf];
      g.hidden = moving === null || this.layout.away;
      if (g.hidden) continue;
      const left = this.span("left", moving!);
      const right = host.width - this.span("right", moving!);
      g.style.left = `${(left + right) / 2 - GUIDE_CELL_PX / 2}px`;
      g.style.top = `${shelf === "top" ? this.shelfSpan("top") + 10 : host.height - this.shelfSpan("bottom") - 10 - GUIDE_CELL_PX}px`;
    }
    for (const side of ["left", "right"] as const) {
      const g = this.edgeGuides[side];
      g.hidden = moving === null || this.layout.away;
      if (g.hidden) continue;
      const x = side === "left" ? this.span("left", moving!) + 10 : host.width - this.span("right", moving!) - 10 - GUIDE_CELL_PX;
      g.style.left = `${x}px`;
      g.style.top = `${host.height / 2 - GUIDE_CELL_PX / 2}px`;
    }
  }

  /** The docking guide's square under (x, y) in the window, with what it stands for. */
  private cellUnder(x: number, y: number): { el: HTMLElement; at: GuideAt | null; side: DockSide | null; shelf: Shelf | null } | null {
    if (!this.guide.hidden) {
      for (const [at, el] of Object.entries(this.guideCells) as [GuideAt, HTMLElement][]) {
        if (!el.classList.contains("off") && inside(el.getBoundingClientRect(), x, y)) return { el, at, side: null, shelf: null };
      }
    }
    for (const side of ["left", "right"] as const) {
      const el = this.edgeGuides[side].firstElementChild as HTMLElement;
      if (!this.edgeGuides[side].hidden && inside(el.getBoundingClientRect(), x, y)) return { el, at: null, side, shelf: null };
    }
    for (const shelf of SHELVES) {
      const el = this.shelfGuides[shelf].firstElementChild as HTMLElement;
      if (!this.shelfGuides[shelf].hidden && inside(el.getBoundingClientRect(), x, y)) return { el, at: null, side: null, shelf };
    }
    return null;
  }

  /** Where a docking guide's square docks the dragged palette: against `over`, or at the end of a dock's column beside the drawing. */
  private guideTarget(cell: { at: GuideAt | null; side: DockSide | null }, over: string | null, moving: string): DropAt | null {
    if (cell.side !== null) {
      const col = this.innermost(cell.side);
      return { side: cell.side, col, index: this.column(cell.side, col, moving).length, newCol: false };
    }
    if (over === null || cell.at === null || cell.at === "tab") return null;
    const side = this.layout.palettes[over].where as DockSide;
    const col = this.colOf(over);
    const at = this.column(side, col, moving).indexOf(over);
    if (cell.at === "top") return { side, col, index: at, newCol: false };
    if (cell.at === "bottom") return { side, col, index: at + 1, newCol: false };
    return { side, col: cell.at === "left" ? col : col + 1, index: 0, newCol: true };
  }

  /** Puts `id` alone in a new column `w` wide at `col` of a dock, the columns from there on moving over one. */
  private addColumn(side: DockSide, col: number, id: string, w: number): void {
    const widths = this.colWidths(side);
    for (const [pid, q] of Object.entries(this.layout.palettes)) {
      if (pid === id || q.where !== side) continue;
      const c = q.group === null ? this.colOf(pid) : clamp(Math.round(q.col || 0), 0, widths.length - 1);
      q.col = c >= col ? c + 1 : c;
    }
    widths.splice(col, 0, w);
    this.layout.columns[side] = widths;
    this.layout.width[side] = this.rail() + widths.reduce((a, b) => a + b, 0);
    const p = this.layout.palettes[id];
    p.where = side;
    p.col = col;
    p.order = 0;
  }

  /**
   * Marks where a dragged palette would land: a line in a dock's column, the new column it would
   * stand in (`width` wide), or the title bar it would become a tab of.
   */
  private showDrop(target: DropAt | null, id: string, tabInto: string | null, width: number): void {
    for (const [pid, el] of this.els) el.classList.toggle("tab-drop", pid === tabInto);
    // a dock down to its rail lights the rail up: the palette joins the end of the dock
    for (const side of ["left", "right"] as const) {
      this.rails[side].classList.toggle("drop", target?.side === side && this.narrow(side, id));
    }
    const line = this.dropLine;
    const host = this.host.getBoundingClientRect();
    const shown = target !== null && !this.narrow(target.side, id);
    line.hidden = !shown || target.newCol;
    this.preview.hidden = !shown || !target.newCol;
    if (!shown) return;
    if (target.newCol) {
      // the new column where it will stand, the palette's width, once the dock has widened for it
      const w = this.newColWidth(width);
      const widths = this.colWidths(target.side);
      const before = widths.slice(0, target.col).reduce((a, b) => a + b, 0);
      const total = this.rail() + widths.reduce((a, b) => a + b, 0) + w;
      const left = target.side === "left" ? this.rail() + before : host.width - total + before;
      this.preview.style.left = `${left}px`;
      this.preview.style.top = "0px";
      this.preview.style.width = `${w}px`;
      this.preview.style.height = `${host.height}px`;
      return;
    }
    // the line spans the column
    const col = this.colEls[target.side][target.col]?.getBoundingClientRect();
    const ids = this.column(target.side, target.col, id);
    let top = col ? col.top - host.top : 0;
    if (ids.length > 0) {
      const at = ids[Math.min(target.index, ids.length - 1)];
      const r = this.els.get(at)!.getBoundingClientRect();
      top = target.index < ids.length ? r.top - host.top - 4 : r.bottom - host.top + 3;
    }
    const w = col ? col.width : this.layout.width[target.side] - this.rail();
    line.style.top = `${top}px`;
    line.style.width = `${w}px`;
    line.style.height = "";
    line.style.left = col ? `${col.left - host.left}px` : target.side === "left" ? `${this.rail()}px` : `${host.width - w - this.rail()}px`;
  }

  /** Drags a dock's inner edge to make it wider or narrower. */
  private resizeDock(side: DockSide, edge: HTMLElement, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    // from the width it is drawn at, which the top bar's end may hold above the one kept
    const w0 = this.span(side);
    // with columns, the one beside the drawing takes the change
    const cols = this.layout.columns[side];
    const inner = this.innermost(side);
    const others = cols.length >= 2 ? cols.reduce((a, b) => a + b, 0) - cols[inner] : 0;
    const lo = Math.max(cols.length >= 2 ? this.rail() + others + MIN_COL_WIDTH : MIN_WIDTH, this.floor[side]);
    const hi = cols.length >= 2 ? this.rail() + others + MAX_WIDTH - this.rail() : MAX_WIDTH;
    this.track(
      edge,
      e,
      (dx) => {
        this.layout.width[side] = clamp(side === "left" ? w0 + dx : w0 - dx, lo, hi);
        if (cols.length >= 2) {
          cols[inner] = this.layout.width[side] - this.rail() - others;
          this.colEls[side][inner].style.flex = `${cols[inner]} 1 0px`;
        }
        this.docks[side].style.width = `${this.layout.width[side]}px`;
        // the drawing beside the dock follows it
        for (const fn of this.listeners) fn();
      },
      () => this.commit(),
    );
  }

  /** Drags a docking bar's inner edge to make it taller or shorter. */
  private resizeShelf(shelf: Shelf, edge: HTMLElement, e: PointerEvent): void {
    if (e.button !== 0 || this.shelved(shelf).every((id) => this.layout.palettes[id].collapsed)) return;
    e.preventDefault();
    const h0 = this.shelves[shelf].offsetHeight;
    const most = Math.max(MIN_SHELF_H, Math.round(this.host.clientHeight * MAX_SHELF_SHARE));
    this.track(
      edge,
      e,
      (_dx, dy) => {
        this.layout.shelf[shelf] = clamp(shelf === "top" ? h0 + dy : h0 - dy, MIN_SHELF_H, most);
        this.shelves[shelf].style.height = `${this.layout.shelf[shelf]}px`;
        // the drawing under or over the bar follows it
        for (const fn of this.listeners) fn();
      },
      () => this.commit(),
    );
  }

  /** Drags the handle between two palettes of a docking bar: the one widens as the other narrows, the rest keep their widths. */
  private resizeShelfPair(shelf: Shelf, i: number, edge: HTMLElement, e: PointerEvent): void {
    const ids = this.shelved(shelf);
    const [a, b] = [ids[i], ids[i + 1]];
    if (e.button !== 0 || !a || !b || this.layout.palettes[a].collapsed || this.layout.palettes[b].collapsed) return;
    e.preventDefault();
    // the shares become the widths they are drawn at, so only these two change
    for (const id of ids) {
      if (!this.layout.palettes[id].collapsed) this.layout.palettes[id].weight = this.els.get(id)!.offsetWidth;
    }
    const a0 = this.layout.palettes[a].weight;
    const b0 = this.layout.palettes[b].weight;
    this.track(
      edge,
      e,
      (dx) => {
        const wa = clamp(a0 + dx, MIN_SHELF_W, a0 + b0 - MIN_SHELF_W);
        this.layout.palettes[a].weight = wa;
        this.layout.palettes[b].weight = a0 + b0 - wa;
        this.els.get(a)!.style.flex = `${wa} 1 0px`;
        this.els.get(b)!.style.flex = `${a0 + b0 - wa} 1 0px`;
      },
      () => this.commit(),
    );
  }

  /** Drags the edge between a filling palette and the next filling one below it. */
  /** Drags the handle between column `c` of a dock and the next: one widens as the other narrows. */
  private resizeColumns(side: DockSide, c: number, edge: HTMLElement, e: PointerEvent): void {
    const cols = this.layout.columns[side];
    if (e.button !== 0 || c + 1 >= cols.length) return;
    e.preventDefault();
    const a0 = cols[c];
    const b0 = cols[c + 1];
    this.track(
      edge,
      e,
      (dx) => {
        const a = clamp(a0 + dx, MIN_COL_WIDTH, a0 + b0 - MIN_COL_WIDTH);
        cols[c] = a;
        cols[c + 1] = a0 + b0 - a;
        this.colEls[side][c].style.flex = `${a} 1 0px`;
        this.colEls[side][c + 1].style.flex = `${a0 + b0 - a} 1 0px`;
      },
      () => this.commit(),
    );
  }

  private split(id: string, edge: HTMLElement, e: PointerEvent): void {
    const p = this.layout.palettes[id];
    if (e.button !== 0 || !isSide(p.where)) return;
    const open = this.column(p.where, this.colOf(id)).filter((pid) => this.fills(pid) && !this.layout.palettes[pid].collapsed);
    const next = open[open.indexOf(id) + 1];
    if (!next) return;
    e.preventDefault();
    // weights become heights in px, so a split moves by exactly the pointer's travel
    for (const pid of open) this.layout.palettes[pid].weight = this.els.get(pid)!.offsetHeight;
    const a0 = this.layout.palettes[id].weight;
    const b0 = this.layout.palettes[next].weight;
    this.track(
      edge,
      e,
      (_dx, dy) => {
        const a = clamp(a0 + dy, MIN_FILL_PX, a0 + b0 - MIN_FILL_PX);
        this.layout.palettes[id].weight = a;
        this.layout.palettes[next].weight = a0 + b0 - a;
        this.els.get(id)!.style.flex = `${a} 1 0px`;
        this.els.get(next)!.style.flex = `${a0 + b0 - a} 1 0px`;
      },
      () => this.commit(),
    );
  }

  /**
   * Drags the sheet's grip: the sheet follows the pointer between its lowest and highest stops, and
   * on release settles at the nearest one.
   */
  private resizeSheet(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const vh = window.innerHeight;
    const px = (i: number): number => (SHEET_STOPS[i] / 100) * vh;
    const low = px(0);
    const high = px(SHEET_STOPS.length - 1);
    const h0 = this.sheet.offsetHeight;
    this.host.classList.add("sheet-drag");
    this.track(
      this.grip,
      e,
      (_dx, dy) => {
        const at = clamp(h0 - dy, low, high);
        this.host.style.setProperty("--sheet-h", `${at}px`);
        this.host.classList.toggle("sheet-tall", at === high);
      },
      () => {
        this.host.classList.remove("sheet-drag");
        const at = this.sheet.offsetHeight;
        let nearest = 0;
        SHEET_STOPS.forEach((_, i) => {
          if (Math.abs(px(i) - at) < Math.abs(px(nearest) - at)) nearest = i;
        });
        this.sheetStop = nearest;
        this.placeSheet();
      },
    );
  }

  /** Drags a floating palette's corner to resize it. */
  private resizeFloat(id: string, grip: HTMLElement, e: PointerEvent): void {
    const p = this.layout.palettes[id];
    if (e.button !== 0 || p.where !== "float") return;
    e.preventDefault();
    const el = this.els.get(id)!;
    const w0 = el.offsetWidth;
    const h0 = el.offsetHeight;
    const fill = this.fills(id);
    // in a stack, the width is the stack's (its top palette's), the height its own
    const topId = p.stack ?? id;
    const box = this.stackBoxes.get(topId);
    const stacked = box !== undefined && el.parentElement === box;
    this.track(
      grip,
      e,
      (dx, dy) => {
        const q = this.layout.palettes[topId];
        q.w = Math.max(MIN_FLOAT_W, w0 + dx);
        (stacked ? box : el).style.width = `${q.w}px`;
        if (fill && !p.collapsed) {
          p.h = Math.max(MIN_FLOAT_H, h0 + dy);
          el.style.height = `${p.h}px`;
        }
      },
      () => this.commit(),
    );
  }
}

/** A panel of a tabbed palette. */
interface TabPanel {
  readonly id: string;
  readonly label: string;
  /** its name as a palette of its own (Vectorworks'), where that is not its label */
  readonly name?: string;
  readonly title?: string;
  /** its icon (an inline SVG), shown as its palette's Tab Style has it */
  readonly icon?: string;
  readonly body: HTMLElement;
}

/** A tab's icon and name, which its palette's Tab Style shows or hides (see dock.css). */
function tabFace(icon: string, label: string): HTMLElement[] {
  return [h("span", { cls: "tab-icon", html: icon }), h("span", { cls: "tab-label", text: label })];
}

/** How far past its strip a tab is dragged before it comes out as a palette of its own. */
const TEAR_PX = 14;

/** Each tabbed palette's strip, by the key it was made with: the palettes let its tabs come out. */
const tabStrips = new Map<string, TabStrip>();

/** Whether an element's children are these, in this order. */
function holds(el: HTMLElement, kids: readonly HTMLElement[]): boolean {
  return el.children.length === kids.length && kids.every((k, i) => el.children[i] === k);
}

/**
 * The tabs of a palette that holds several panels (Navigation's Layers, Classes and Saved Views;
 * Object Info's Shape, Data and Render): a compact strip and the bodies under it, the open tab
 * remembered. A tab dragged along the strip moves along it; one dragged off it comes out as a
 * palette of its own where the palettes allow (Palettes.tearOff), its button out of the strip till
 * it is back, as Vectorworks 2027 detaches palette tabs.
 */
class TabStrip {
  readonly el: HTMLElement;
  private readonly strip = h("div", { cls: "pal-tabs", attrs: { role: "tablist" } });
  private readonly bodies = h("div", { cls: "pal-tab-bodies" });
  private readonly buttons = new Map<string, HTMLElement>();
  private order: string[];
  /** the tabs out as palettes of their own */
  private out: ReadonlySet<string> = new Set();
  private active: string;
  /** Lock Tabs: the tabs neither move nor come out */
  locked = false;
  /** set by the palettes: a tab dragged off the strip comes out (true when it did) */
  tearOff: ((tab: string, e: PointerEvent) => boolean) | null = null;
  /** set by the palettes: the strip's order after a tab is moved along it */
  reordered: ((order: readonly string[]) => void) | null = null;

  constructor(
    private readonly key: string,
    readonly panels: readonly TabPanel[],
  ) {
    this.order = panels.map((t) => t.id);
    for (const t of panels) {
      const btn = h(
        "button",
        { cls: "pal-tab", title: t.title ?? t.label, attrs: { type: "button", role: "tab", "aria-label": t.label, "data-tab": t.id } },
        ...tabFace(t.icon ?? `<span class="dock-icon-letters">${initials(t.label)}</span>`, t.label),
      );
      btn.addEventListener("click", () => this.show(t.id));
      btn.addEventListener("pointerdown", (e) => this.press(t.id, btn, e));
      t.body.classList.add("pal-tab-body");
      this.buttons.set(t.id, btn);
    }
    let first = this.order[0] ?? "";
    try {
      const saved = localStorage.getItem(`openvwx.tab.${key}`);
      if (saved && this.order.includes(saved)) first = saved;
    } catch {
      // storage blocked: the first tab
    }
    this.active = first;
    this.el = h("div", { cls: "pal-tabbed" }, this.strip, this.bodies);
    this.render();
  }

  /** The tab in front of the strip. */
  front(): string {
    const ids = this.inStrip();
    return ids.includes(this.active) ? this.active : (ids[0] ?? "");
  }

  /** Every tab, in the strip's order (those out of it too). */
  ordered(): string[] {
    return [...this.order];
  }

  /** The tabs in the strip, in order. */
  inStrip(): string[] {
    return this.order.filter((id) => !this.out.has(id));
  }

  /** Lays the strip out as `order` has it (tabs it leaves out at the end), without the tabs `out` of it. */
  arrange(order: readonly string[], out: ReadonlySet<string>): void {
    const known = this.panels.map((t) => t.id);
    const next = order.filter((id, i) => known.includes(id) && order.indexOf(id) === i);
    for (const id of known) if (!next.includes(id)) next.push(id);
    this.order = next;
    this.out = out;
    this.render();
  }

  /** Brings a tab in the strip to the front. */
  show(id: string): void {
    if (this.out.has(id) || !this.buttons.has(id)) return;
    this.active = id;
    try {
      localStorage.setItem(`openvwx.tab.${this.key}`, id);
    } catch {
      // storage blocked: the tab is not remembered
    }
    this.render();
  }

  private panel(id: string): TabPanel {
    return this.panels.find((t) => t.id === id)!;
  }

  private render(): void {
    const ids = this.inStrip();
    if (!ids.includes(this.active)) this.active = ids[0] ?? "";
    // moved only when they change, so a field being typed in keeps its focus and a list its scroll
    const buttons = ids.map((id) => this.buttons.get(id)!);
    if (!holds(this.strip, buttons)) this.strip.replaceChildren(...buttons);
    // the bodies of the tabs out of the strip are in their own palettes
    const bodies = ids.map((id) => this.panel(id).body);
    if (!holds(this.bodies, bodies)) this.bodies.replaceChildren(...bodies);
    for (const id of ids) {
      const on = id === this.active;
      const btn = this.buttons.get(id)!;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", String(on));
      this.panel(id).body.hidden = !on;
    }
  }

  /** A press on a tab: dragged along the strip it moves there; dragged off it, it comes out as a palette. */
  private press(id: string, btn: HTMLElement, e: PointerEvent): void {
    if (e.button !== 0) return;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moving = false;
    const stop = (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      btn.classList.remove("moving");
    };
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId || this.locked) return;
      if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START_PX) return;
      moving = true;
      const r = this.strip.getBoundingClientRect();
      const off = ev.clientY < r.top - TEAR_PX || ev.clientY > r.bottom + TEAR_PX || ev.clientX < r.left - TEAR_PX || ev.clientX > r.right + TEAR_PX;
      // the last tab in the strip stays
      if (off && this.inStrip().length > 1 && this.tearOff?.(id, ev)) {
        moving = false;
        stop();
        return;
      }
      btn.classList.add("moving");
      // along the strip: before the first other tab whose middle is past the pointer
      const others = this.inStrip().filter((t) => t !== id);
      const before = others.find((t) => {
        const b = this.buttons.get(t)!.getBoundingClientRect();
        return ev.clientX < b.left + b.width / 2;
      });
      const next = this.order.filter((t) => t !== id);
      next.splice(before === undefined ? next.length : next.indexOf(before), 0, id);
      if (next.join() === this.order.join()) return;
      this.order = next;
      this.render();
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== e.pointerId) return;
      stop();
      if (moving) this.reordered?.(this.order);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }
}

/**
 * Tabs for a palette that holds several panels: a compact strip and the bodies under it (TabStrip).
 * The open tab is remembered under `key`, which the palette's spec names (PaletteSpec.tabbed) so
 * its tabs can come out as palettes of their own.
 */
export function tabbed(key: string, tabs: readonly TabPanel[]): HTMLElement {
  const strip = new TabStrip(key, tabs);
  tabStrips.set(key, strip);
  return strip.el;
}

/** Brings the tab `tab` of the tabbed palette `key` to the front (nothing when it is out as a palette of its own). */
export function showTab(key: string, tab: string): void {
  tabStrips.get(key)?.show(tab);
}
