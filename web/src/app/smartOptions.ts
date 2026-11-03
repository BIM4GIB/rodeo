// The Smart Options display, as Vectorworks has it: a heads-up palette at the cursor, so the
// palettes can stay folded or hidden and the drawing keeps the room. ` (backquote), a middle click
// that doesn't pan, or Window > Smart Options opens it. Four segments ring the active tool: Snaps
// (the Snapping palette's toggles), View (zoom, the previous and next views, 3D, standard views,
// rendering and the grid, the View menu's own rows), Layers (the active layer and class) and Tools
// (Basic and every tool set). Pointing at a segment, or an arrow key, opens its panel beside the
// ring. Choosing a tool, a command, a layer or a class closes the display, as do Escape, the key
// again and a click elsewhere; snaps stay open, to set several.

import { setActiveClass, setActiveLayer } from "./commands.ts";
import { h } from "./dom.ts";
import { SNAP_ICON, TOOL_ICON, UI_ICON } from "./icons.ts";
import { buildPanel, type Panel, type Row } from "./menu.ts";
import { allMenus } from "./menubar.ts";
import { snappingPalette } from "./panels/snapping.ts";
import "./smartOptions.css";
import { store, type ToolId } from "./state.ts";
import { toolPicker } from "./toolbar.ts";

type Side = "top" | "right" | "bottom" | "left";

interface Segment {
  readonly side: Side;
  readonly label: string;
  readonly icon: string;
}

const SEGMENTS: readonly Segment[] = [
  { side: "top", label: "Snaps", icon: SNAP_ICON.objects },
  { side: "right", label: "View", icon: UI_ICON.standardViews },
  { side: "bottom", label: "Layers", icon: UI_ICON.layers },
  { side: "left", label: "Tools", icon: TOOL_ICON.select },
];

const ARROWS: Readonly<Record<string, Side>> = { ArrowUp: "top", ArrowRight: "right", ArrowDown: "bottom", ArrowLeft: "left" };

/** The View menu's rows the View segment shows, in order. */
const VIEW_ROWS: readonly string[] = [
  "Zoom In",
  "Zoom Out",
  "Fit to Window",
  "Zoom to Selection",
  "Previous View",
  "Next View",
  "Zoom Line Thickness",
  "-",
  "3D View",
  "Standard Views",
  "Rendering",
  "Projection",
  "-",
  "Show Grid",
  "Dark Canvas",
];

/** Gap between the ring and a segment's panel, and the least margin to the window's edge. */
const GAP = 6;
const MARGIN = 8;

let deps: { canvas: HTMLCanvasElement; setTool: (id: ToolId) => void } | null = null;
/** where the pointer last was, in the window */
let pointer: { x: number; y: number } | null = null;

let root: HTMLElement | null = null;
let ring: HTMLElement | null = null;
let hub: HTMLElement | null = null;
const buttons = new Map<Side, HTMLButtonElement>();
let open: Side | null = null;
/** the panel shown beside the ring, and how to take it away */
let shown: { el: HTMLElement; remove: () => void } | null = null;
let tools: { el: HTMLElement; front: () => void } | null = null;
let snaps: HTMLElement | null = null;

/** Hooks the display up to the drawing's canvas and the controller's tool choice. */
export function installSmartOptions(canvas: HTMLCanvasElement, setTool: (id: ToolId) => void): void {
  deps = { canvas, setTool };
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer = { x: e.clientX, y: e.clientY };
    },
    { passive: true },
  );
}

/** Opens the display at (x, y) in the window, or at the pointer when it is over the drawing, else the drawing's middle. */
export function openSmartOptions(x?: number, y?: number): void {
  if (!deps || !store.session) return;
  closeSmartOptions();
  const area = deps.canvas.getBoundingClientRect();
  if (x === undefined || y === undefined) {
    const inside = pointer && pointer.x >= area.left && pointer.x <= area.right && pointer.y >= area.top && pointer.y <= area.bottom;
    ({ x, y } = inside ? pointer! : { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 });
  }
  build();
  const size = ring!.offsetWidth;
  const half = size / 2;
  const cx = Math.min(Math.max(x, MARGIN + half), window.innerWidth - MARGIN - half);
  const cy = Math.min(Math.max(y, MARGIN + half), window.innerHeight - MARGIN - half);
  ring!.style.left = `${cx - half}px`;
  ring!.style.top = `${cy - half}px`;
  window.addEventListener("pointerdown", onOutside, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", closeSmartOptions);
  window.addEventListener("blur", closeSmartOptions);
  // the tools first, the segment most often wanted
  show("left");
  buttons.get("left")!.focus({ preventScroll: true });
}

/** Opens the display, or closes it when it is open. */
export function toggleSmartOptions(): void {
  if (root) closeSmartOptions();
  else openSmartOptions();
}

export function closeSmartOptions(): void {
  if (!root) return;
  window.removeEventListener("pointerdown", onOutside, true);
  window.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", closeSmartOptions);
  window.removeEventListener("blur", closeSmartOptions);
  shown?.remove();
  shown = null;
  open = null;
  root.remove();
  root = ring = hub = null;
  buttons.clear();
}

function build(): void {
  hub = h("button", { cls: "smart-hub", attrs: { type: "button" } });
  const tool = store.tool;
  hub.innerHTML = TOOL_ICON[tool];
  hub.title = "Close Smart Options";
  hub.setAttribute("aria-label", "Close Smart Options");
  hub.addEventListener("click", closeSmartOptions);
  ring = h("div", { cls: "smart-ring", attrs: { role: "toolbar", "aria-label": "Smart Options" } }, hub);
  for (const seg of SEGMENTS) {
    const btn = h("button", {
      cls: `smart-seg ${seg.side}`,
      html: seg.icon,
      title: seg.label,
      attrs: { type: "button", "aria-label": seg.label, "aria-expanded": "false" },
    });
    btn.append(h("span", { cls: "smart-seg-label", text: seg.label }));
    btn.addEventListener("pointerenter", () => show(seg.side));
    btn.addEventListener("focus", () => show(seg.side));
    btn.addEventListener("click", () => show(seg.side));
    buttons.set(seg.side, btn);
    ring.append(btn);
  }
  root = h("div", { cls: "smart" }, ring);
  document.body.append(root);
}

/** Opens the panel of the segment on `side`. */
function show(side: Side): void {
  if (!root || open === side) return;
  shown?.remove();
  shown = null;
  open = side;
  for (const [s, btn] of buttons) {
    btn.classList.toggle("active", s === side);
    btn.setAttribute("aria-expanded", String(s === side));
  }
  if (side === "right") {
    const panel = viewPanel();
    panel.el.classList.add("smart-menu");
    panel.refresh();
    panel.el.hidden = false;
    place(panel.el, side);
    shown = { el: panel.el, remove: () => panel.remove() };
    return;
  }
  const body = side === "left" ? toolsBody() : side === "top" ? snapsBody() : layersBody();
  const label = SEGMENTS.find((s) => s.side === side)!.label;
  const el = h("div", { cls: `smart-panel ${side}`, attrs: { role: "dialog", "aria-label": label } }, h("div", { cls: "smart-title", text: label }), body);
  root.append(el);
  place(el, side);
  // the tools and snaps bodies are kept for the next time; the layers are read afresh
  shown = { el, remove: () => el.remove() };
}

function toolsBody(): HTMLElement {
  tools ??= toolPicker((id) => {
    deps?.setTool(id);
    closeSmartOptions();
  });
  tools.front();
  return tools.el;
}

function snapsBody(): HTMLElement {
  if (!snaps) {
    snaps = snappingPalette();
    // Snap Settings… opens a dialog over the drawing
    snaps.addEventListener("click", (e) => {
      if (e.target instanceof Element && e.target.closest("[aria-label='Snap Settings…']")) closeSmartOptions();
    });
  }
  return snaps;
}

/** The View menu's rows the View segment shows, as the menu has them now. */
function viewPanel(): Panel {
  const menu = allMenus().find((m) => m.title === "View")?.rows ?? [];
  const byLabel = new Map(menu.flatMap((r) => (r === "-" ? [] : [[r.label, r] as const])));
  const rows: Row[] = [];
  for (const label of VIEW_ROWS) {
    const row = label === "-" ? "-" : byLabel.get(label);
    if (row && !(row === "-" && (rows.length === 0 || rows[rows.length - 1] === "-"))) rows.push(row);
  }
  return buildPanel(rows, closeSmartOptions);
}

/** The drawing's layers and classes, the active ones marked; choosing one makes it active. */
function layersBody(): HTMLElement {
  const doc = store.session?.doc;
  const list = (label: string, items: readonly { text: string; on: boolean; pick: () => void }[], groups?: readonly (readonly [number, string])[]): HTMLElement => {
    const box = h("div", { cls: "smart-list", attrs: { role: "listbox", "aria-label": label } });
    items.forEach((it, i) => {
      const group = groups?.find(([at]) => at === i);
      if (group) box.append(h("div", { cls: "smart-group", text: group[1] }));
      const btn = h("button", {
        cls: `smart-item${it.on ? " active" : ""}`,
        text: it.text,
        title: it.text,
        attrs: { type: "button", role: "option", "aria-selected": String(it.on) },
      });
      btn.addEventListener("click", () => {
        it.pick();
        closeSmartOptions();
      });
      box.append(btn);
    });
    return h("div", { cls: "smart-col" }, h("div", { cls: "smart-head", text: label }), box);
  };
  const layers = doc?.layers() ?? [];
  const design = layers.filter((l) => l.kind === "design");
  const sheets = layers.filter((l) => l.kind === "sheet");
  const layerItems = [...design, ...sheets].map((l) => ({ text: l.name, on: l.id === store.activeLayerId, pick: () => setActiveLayer(l.id) }));
  const classItems = (doc?.classes() ?? []).map((c) => ({ text: c.name, on: c.index === store.activeClassIndex, pick: () => setActiveClass(c.index) }));
  const body = h(
    "div",
    { cls: "smart-cols" },
    list("Layer", layerItems, [
      ...(design.length ? [[0, "Design layers"] as const] : []),
      ...(sheets.length ? [[design.length, "Sheet layers"] as const] : []),
    ]),
    list("Class", classItems),
  );
  // the active rows in view
  queueMicrotask(() => body.querySelectorAll<HTMLElement>(".smart-item.active").forEach((el) => el.scrollIntoView({ block: "nearest" })));
  return body;
}

/** Puts `el` beside the ring on `side`, pulled back inside the window. */
function place(el: HTMLElement, side: Side): void {
  const r = ring!.getBoundingClientRect();
  const w = el.offsetWidth;
  const ht = el.offsetHeight;
  const cx = (r.left + r.right) / 2;
  const cy = (r.top + r.bottom) / 2;
  let left = side === "left" ? r.left - GAP - w : side === "right" ? r.right + GAP : cx - w / 2;
  let top = side === "top" ? r.top - GAP - ht : side === "bottom" ? r.bottom + GAP : cy - ht / 2;
  left = Math.min(Math.max(left, MARGIN), window.innerWidth - w - MARGIN);
  top = Math.min(Math.max(top, MARGIN), window.innerHeight - ht - MARGIN);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function onOutside(e: PointerEvent): void {
  if (e.target instanceof Element && e.target.closest(".smart, .menu-panel")) return;
  closeSmartOptions();
}

function onKey(e: KeyboardEvent): void {
  const side = ARROWS[e.key];
  if (e.key === "Escape" || (e.code === "Backquote" && !e.metaKey && !e.ctrlKey && !e.altKey)) closeSmartOptions();
  else if (side) buttons.get(side)?.focus();
  else return;
  // not passed on: Escape would clear the selection, an arrow nudge it, ` open the display again
  e.preventDefault();
  e.stopPropagation();
}
