// ConnectCAD Layout's Panel Connector tool: connectors on a panel layout (panelLayout.ts), one at a
// click (Single Click), a line of them from one click toward the next (Linear Array) or a grid of
// them across two clicks (Grid Array), Spacing apart; a click outside every layout (and more than
// Spacing from one with no panel) starts a new one there, with no panel drawn. Preferences: Link-to Socket (the device's socket the first connector
// links to, the next ones taking the sockets after it), Display Tag (counting on as connectors are
// placed), Connector and Spacing.

import type { Pt } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { store } from "../../../app/state.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../../../app/tools.ts";
import { addConnectors, addPanelLayout, layoutSockets, panelLayoutsOn } from "./panelLayout.ts";
import { arrayAlong, arrayGrid, footprint, nextTags } from "./panelLayoutShapes.ts";
import { allConnectors } from "./schematic.ts";

export const connectorSettings = { socket: "", tag: "1", connector: "XLR3", spacing: 27 };

const MODES = [
  { id: "single", label: "Single Click", key: "1" },
  { id: "linear", label: "Linear Array", key: "2" },
  { id: "grid", label: "Grid Array", key: "3" },
];

export class PanelConnectorTool extends BaseTool {
  readonly id = "ccpanelconnector";
  readonly cursor = "crosshair";
  private mode = "single";
  private start: Pt | null = null;
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "Placement", options: MODES, active: this.mode }];
  }

  setMode(id: string): void {
    this.mode = id;
    this.cancel();
    this.env.requestDraw();
  }

  async preferences(): Promise<void> {
    const k = connectorSettings;
    const v = await toolPrefs(
      "Panel Connector Preferences",
      [
        { kind: "text", key: "socket", label: "Link-to Socket", value: k.socket },
        { kind: "text", key: "tag", label: "Display Tag", value: k.tag },
        { kind: "choice", key: "connector", label: "Connector", value: k.connector, options: [...new Set([...allConnectors(), "XLR3", "BNC", "RJ45", "TRS", "LC", "HDMI", "USB", "Phoenix", k.connector])].map((c) => ({ value: c, label: c })) },
        { kind: "length", key: "spacing", label: "Spacing", value: k.spacing },
      ],
      "Link-to Socket names a socket of the device the layout is linked to (its Device Name): the first connector placed links to it and the next ones to the sockets after it. The Display Tag counts on as connectors are placed.",
    );
    if (!v) return;
    k.socket = v.choice("socket").trim();
    k.tag = v.choice("tag").trim();
    k.connector = v.choice("connector");
    k.spacing = v.num("spacing");
  }

  hint(): string {
    if (this.start) return `Click to place the ${this.mode === "grid" ? "grid" : "line"} of connectors · Esc cancels`;
    if (this.mode === "single") return "Click in a panel layout to put a connector there, or elsewhere to start a layout";
    return `Click where the ${this.mode === "grid" ? "grid" : "line"} of connectors starts`;
  }

  snapFrom(): Pt | null {
    return this.start;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
    this.env.requestDraw();
  }

  /** where connectors would go, from `a` toward `b` */
  private spots(a: Pt, b: Pt): Pt[] {
    const spacing = Math.max(1, connectorSettings.spacing);
    return this.mode === "linear" ? arrayAlong(a, b, spacing) : this.mode === "grid" ? arrayGrid(a, b, spacing) : [a];
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    if (this.mode !== "single" && !this.start) {
      this.start = p.pos;
      return;
    }
    const spots = this.spots(this.start ?? p.pos, p.pos);
    this.start = null;
    this.place(spots);
  }

  private place(spots: readonly Pt[]): void {
    const s = store.session;
    const layerId = store.activeLayerId;
    if (!s || !layerId || !spots.length) return;
    // a layout with no panel takes a click within Spacing of its connectors too, so a line can be clicked out
    const into = panelLayoutsOn(s.doc, layerId).find((l) => {
      const q = l.toLocal(spots[0]);
      const m = l.panel ? 0 : Math.max(1, connectorSettings.spacing);
      return !!l.box && q.x >= l.box.x0 - m && q.x <= l.box.x1 + m && q.y >= l.box.y0 - m && q.y <= l.box.y1 + m;
    });
    const k = connectorSettings;
    const tags = nextTags(k.tag, spots.length);
    const r = attempt("Panel Connector", (session) =>
      session.batch(() => {
        const id = into?.id ?? addPanelLayout(session, layerId, spots[0], { "Panel Type": "No Graphics" }, []);
        const sockets = layoutSockets(session, id);
        const from = k.socket ? sockets.indexOf(k.socket) : -1;
        const linked = spots.map((_, i) => (from >= 0 ? (sockets[from + i] ?? "") : ""));
        addConnectors(session, id, spots, spots.map((_, i) => ({ tag: tags[i], socket: linked[i], connector: k.connector })));
        return { id, next: from >= 0 ? (sockets[from + spots.length] ?? "") : k.socket };
      }),
    );
    if (!r) return;
    k.tag = nextTags(tags[tags.length - 1], 2)[1];
    k.socket = r.value.next;
    setSelection([r.value.id]);
  }

  cancel(): void {
    this.start = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.start) return false;
    this.cancel();
    this.env.requestDraw();
    return true;
  }

  overlay(g: Painter): void {
    const pointer = this.pointer;
    if (!pointer) return;
    const f = footprint(connectorSettings.connector);
    withPreview(g, () => {
      for (const c of this.spots(this.start ?? pointer, pointer))
        strokeScreen(g, [{ x: c.x - f.width / 2, y: c.y - f.height / 2 }, { x: c.x + f.width / 2, y: c.y - f.height / 2 }, { x: c.x + f.width / 2, y: c.y + f.height / 2 }, { x: c.x - f.width / 2, y: c.y + f.height / 2 }], true);
      if (this.start) strokeScreen(g, [this.start, pointer], false);
    });
  }
}
