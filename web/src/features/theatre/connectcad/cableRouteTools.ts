// The ConnectCAD Cable Route tool set's tools: Cable Route, a cable path clicked corner by corner at
// the Cable Height chosen on the mode bar (Edit Cable Route Heights in its Preferences), joining the
// drop points and paths it starts or ends on with Join to Existing Routes, and Drop Point, a click
// for a drop point and a click for its turn, in Insert in Cable Path mode splitting the path it's on.
// cableRoute.ts makes them.

import type { Pt } from "../../../core/index.ts";
import { h } from "../../../app/dom.ts";
import { showDialog } from "../../../app/menubar.ts";
import { ACCENT } from "../../../app/renderer.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../../../app/tools.ts";
import { formatLength, formatLengthValue, lengthSuffix, parseLength } from "../../../app/units.ts";
import { cablePathsIn, DROP_CATEGORIES, dropSettings, placeCableRoute, placeDropPoint, routeSettings, routeTarget } from "./cableRoute.ts";
import { routeCorners, type Pt3 } from "./cableRouteShapes.ts";

/** how near the pointer comes to a drop point or a path to land on it, px */
const PICK_PX = 8;
/** a drop point's box across on screen, as the tools show it, px */
const DROP_PX = 10;

const JOIN_MODES = [
  { id: "join", label: "Join to Existing Routes", key: "1" },
  { id: "apart", label: "Separate Path", key: "2" },
];

/** The Edit Cable Route Heights dialog: the heights the Cable Route tool offers, in the drawing's units; null when cancelled. */
async function editHeights(units: string | undefined): Promise<number[] | null> {
  const suffix = lengthSuffix(units);
  const list = h("div", { cls: "ccad-heights" });
  const row = (mm: number | null): HTMLElement => {
    const input = h("input", { cls: "menu-dialog-input", value: mm === null ? "" : formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": "Cable height" } });
    const remove = h("button", { cls: "menu-dialog-button", text: "Delete", attrs: { type: "button" } });
    const line = h("label", { cls: "menu-dialog-field" }, input, suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null, remove);
    remove.addEventListener("click", () => line.remove());
    return line;
  };
  for (const mm of routeSettings.heights) list.append(row(mm));
  const add = h("button", { cls: "menu-dialog-button", text: "Add", attrs: { type: "button" } });
  add.addEventListener("click", () => {
    const line = row(null);
    list.append(line);
    line.querySelector("input")?.focus();
  });
  return showDialog<number[]>({
    title: "Edit Cable Route Heights",
    okLabel: "OK",
    body: [list, add, h("p", { cls: "muted", text: "The heights above the layer the Cable Route tool draws cable paths at, chosen on its mode bar." })],
    check: () => {
      const inputs = [...list.querySelectorAll("input")];
      const heights: number[] = [];
      for (const input of inputs) {
        if (!input.value.trim()) continue;
        const mm = parseLength(input.value, units);
        if (mm === null || mm < 0) return { error: "Enter a height, 0 or more.", focus: input };
        heights.push(mm);
      }
      if (!heights.length) return { error: "Keep one height at least.", focus: add };
      return { value: [...new Set(heights.map((mm) => Math.round(mm * 1e4) / 1e4))].sort((a, b) => a - b) };
    },
  });
}

/** The Cable Route tool: a click for each corner at the Cable Height chosen, a double-click or Enter ending it; with Join to Existing Routes, a click on a drop point or a cable path starts or ends it there. */
export class CableRouteTool extends BaseTool {
  readonly id = "cccableroute";
  readonly cursor = "crosshair";
  /** the corners so far, each at its height */
  private clicks: Pt3[] = [];
  /** the paths its ends land on, to split there */
  private splits: { id: string; i: number; t: number }[] = [];
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    const units = store.session?.doc.info.units;
    return [
      { label: "Join", options: JOIN_MODES, active: routeSettings.join ? "join" : "apart" },
      { label: "Cable Height", options: routeSettings.heights.map((mm) => ({ id: `h:${mm}`, label: formatLength(mm, units) })), active: `h:${routeSettings.height}` },
    ];
  }

  setMode(id: string): void {
    if (id === "join" || id === "apart") routeSettings.join = id === "join";
    else if (id.startsWith("h:")) routeSettings.height = Number(id.slice(2));
    this.env.requestDraw();
  }

  async preferences(): Promise<void> {
    const heights = await editHeights(store.session?.doc.info.units);
    if (!heights) return;
    routeSettings.heights = heights;
    if (!heights.includes(routeSettings.height)) routeSettings.height = heights.reduce((a, b) => (Math.abs(b - routeSettings.height) < Math.abs(a - routeSettings.height) ? b : a));
  }

  hint(): string {
    const join = routeSettings.join ? " or on a drop point or a cable path" : "";
    return this.clicks.length ? `Click the next corner · double-click or Enter ends it${join ? ", a click on a drop point or a cable path ends it there" : ""} · 3 (Shift+3) steps the Cable Height` : `Click where the cable path starts${join}`;
  }

  snapFrom(): Pt | null {
    return this.clicks.at(-1) ?? null;
  }

  /** what the pointer is over to join, with Join to Existing Routes */
  private target(p: Pt): ReturnType<typeof routeTarget> {
    const doc = store.session?.doc;
    return doc && routeSettings.join ? routeTarget(doc, p, PICK_PX / this.env.view.scale) : null;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    // a third press of a double-click that ended a path starts no new one
    if (p.detail > 2 && !this.clicks.length) return;
    const z = routeSettings.height;
    const on = this.target(p.raw);
    const last = this.clicks.at(-1);
    if (!on) {
      if (!last || Math.hypot(last.x - p.pos.x, last.y - p.pos.y) * this.env.view.scale > 3) this.clicks.push({ ...p.pos, z });
      if (p.detail >= 2) this.finish();
      return;
    }
    if (on.kind === "path") this.splits.push({ id: on.id, i: on.i, t: on.t });
    const at = on.at;
    // it meets a path at the path's height, rising or dropping there to the Cable Height
    const height = on.kind === "path" ? on.at.z : z;
    if (!last) {
      this.clicks.push({ x: at.x, y: at.y, z: height });
      if (height !== z) this.clicks.push({ x: at.x, y: at.y, z });
      return;
    }
    this.clicks.push({ x: at.x, y: at.y, z }, { x: at.x, y: at.y, z: height });
    this.finish();
  }

  private finish(): void {
    const corners = routeCorners(this.clicks);
    const splits = this.splits;
    this.clicks = [];
    this.splits = [];
    const layerId = store.activeLayerId;
    if (!layerId || corners.length < 2) return;
    placeCableRoute(layerId, corners, splits);
  }

  cancel(): void {
    this.clicks = [];
    this.splits = [];
  }

  key(e: KeyboardEvent): boolean {
    if (e.code === "Digit3" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // steps through the heights, Shift backwards
      const list = routeSettings.heights;
      const k = list.indexOf(routeSettings.height);
      routeSettings.height = list[(Math.max(0, k) + (e.shiftKey ? list.length - 1 : 1)) % list.length] ?? routeSettings.height;
      this.env.requestDraw();
      return true;
    }
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (!this.clicks.length) return false;
    if (e.key === "Enter") this.finish();
    else if (e.key === "Escape") this.cancel();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.pointer;
    if (!at) return;
    const on = this.target(at);
    if (on) {
      // what a click joins
      g.ctx.save();
      g.ctx.strokeStyle = ACCENT;
      g.ctx.lineWidth = 2;
      if (on.kind === "path") strokeScreen(g, cablePathsIn(store.session!.doc).find((p) => p.id === on.id)?.points ?? [], false);
      else {
        const c = g.toScreen(on.at);
        g.ctx.strokeRect(c.x - DROP_PX, c.y - DROP_PX, DROP_PX * 2, DROP_PX * 2);
      }
      g.ctx.restore();
    }
    if (this.clicks.length) withPreview(g, () => strokeScreen(g, [...this.clicks, on ? on.at : at], false));
  }
}

const INSERT_MODES = [
  { id: "standard", label: "Standard Insertion", key: "1" },
  { id: "inpath", label: "Insert in Cable Path", key: "2" },
];

/** The Drop Point tool: a click for a drop point (in Insert in Cable Path mode, on a cable path, splitting it there) and a click toward where it turns. */
export class DropPointTool extends BaseTool {
  readonly id = "ccdroppoint";
  readonly cursor = "crosshair";
  private inPath = false;
  private at: Pt | null = null;
  private split: { id: string; i: number; t: number } | null = null;
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "Insertion", options: INSERT_MODES, active: this.inPath ? "inpath" : "standard" }];
  }

  setMode(id: string): void {
    this.inPath = id === "inpath";
    this.cancel();
  }

  async preferences(): Promise<void> {
    const k = dropSettings;
    const v = await toolPrefs(
      "Drop Point Preferences",
      [
        { kind: "choice", key: "category", label: "Category", value: k.category, options: DROP_CATEGORIES.map((c) => ({ value: c, label: c })) },
        { kind: "length", key: "slack", label: "Cable Slack", value: k.slack, zero: true },
      ],
      "A drop point is where cables come out to equipment: a wall box, a floor pocket. It's named A, B… (I and O passed by), takes the Room ID of the layout room it's in, and counts the equipment whose Drop Point names it. Its Cable Slack is added to each cable length through it.",
    );
    if (!v) return;
    k.category = v.choice("category");
    k.slack = v.num("slack");
  }

  hint(): string {
    if (this.at) return "Click toward where the drop point turns · Esc cancels";
    return this.inPath ? "Click on a cable path to put a drop point in it" : "Click where the drop point goes";
  }

  snapFrom(): Pt | null {
    return this.at;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  /** where a click on a cable path lands on it */
  private onPath(p: Pt): Extract<ReturnType<typeof routeTarget>, { kind: "path" }> | null {
    const doc = store.session?.doc;
    if (!doc) return null;
    const on = routeTarget(doc, p, PICK_PX / this.env.view.scale, false);
    return on?.kind === "path" ? on : null;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    if (!this.at) {
      if (!this.inPath) {
        this.at = p.pos;
        return;
      }
      const on = this.onPath(p.raw);
      if (!on) return toast("Click on a cable path to put a drop point in it.", "info");
      this.at = on.at;
      this.split = { id: on.id, i: on.i, t: on.t };
      return;
    }
    const at = this.at;
    const turn = Math.hypot(p.pos.x - at.x, p.pos.y - at.y) > 1e-6 ? (Math.atan2(p.pos.y - at.y, p.pos.x - at.x) * 180) / Math.PI : 0;
    const split = this.split;
    this.cancel();
    placeDropPoint(layerId, at, turn, split);
  }

  cancel(): void {
    this.at = null;
    this.split = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.at) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    const doc = store.session?.doc;
    const pointer = this.pointer;
    if (!doc || !pointer) return;
    const where = this.at ?? (this.inPath ? this.onPath(pointer)?.at : pointer);
    if (!where) return;
    const c = g.toScreen(where);
    withPreview(g, () => {
      g.ctx.strokeRect(c.x - DROP_PX / 2, c.y - DROP_PX / 2, DROP_PX, DROP_PX);
      if (this.at) strokeScreen(g, [this.at, pointer], false);
    });
  }
}
