// Plug-in Insertion tool (Insertion): places plug-in objects of a kind the drawing has (columns and
// beams, plants, cabinets, stairs, grid lines, spaces...) by copying one: press where its insertion
// point goes, and drag to turn it (Shift: 15° steps); a click keeps the turn the copied one has.
// Preferences chooses the kind, one per plug-in. The copy keeps the copied object's class,
// parameters and drawing (Rodeo can't redraw a plug-in from its parameters); Object Info edits its
// parameters afterwards. It is selected, and the tool stays active for more.
//
// It also places the plug-ins a feature can draw from their parameters (installed Vectorworks
// plug-ins, ext.ts PluginDriver), new ones with their default parameters: a point object as a copy
// is placed, a linear one by dragging from its start to its end, a rectangular one by dragging
// across it.

import type { ObjectInfo, PluginKind, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { pluginDriver, pluginDrivers, takePreferredDriver, type PluginDriver } from "../ext.ts";
import { dist, snapAngle } from "../geom.ts";
import { ACCENT } from "../renderer.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

/** a press that moves less than this many CSS px is a click, not a drag that turns */
const DRAG_PX = 4;
/** Shift turns the copy in steps of this, degrees */
const ANGLE_STEP_DEG = 15;
/** arm length of the insertion-point cross, CSS px */
const CROSS_PX = 6;
/** a choice's id for a plug-in a feature draws: this and its name */
const DRIVER = "driver:";

/** The plug-ins a feature draws that this tool offers: those with no tool of their own. */
const insertable = (): PluginDriver[] => pluginDrivers().filter((d) => !d.builtIn);

/** What the tool places: a copy of a kind the drawing has, or a plug-in a feature draws. */
type Choice = { readonly kind: PluginKind; readonly driver?: undefined } | { readonly driver: PluginDriver; readonly kind?: undefined };

export class PluginInsertTool extends BaseTool {
  readonly id = "plugin";
  readonly cursor = "crosshair";
  /** the plug-in object a new one copies (PluginKind.id), once one has been chosen */
  private kind: string | null = null;
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;
  /** where the press went down: the insertion point while a drag turns the copy */
  private start: { pos: Pt; screen: Pt } | null = null;
  /** the pointer while a drag turns the copy */
  private drag: PointerInfo | null = null;

  constructor(env: ToolEnv) {
    super(env);
    // tools get no pointer-leave event, so the preview goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
  }

  async preferences(): Promise<void> {
    const kinds = store.session?.pluginKinds() ?? [];
    const drivers = insertable();
    if (!kinds.length && !drivers.length) return;
    const options = [
      ...kinds.map((k) => ({ value: k.id, label: `${k.name} (${k.count})` })),
      ...drivers.map((d) => ({ value: DRIVER + d.name, label: `${d.name} (installed)` })),
    ];
    const c = this.current();
    const v = await toolPrefs(
      "Plug-in Insertion Preferences",
      [{ kind: "choice", key: "kind", label: "Plug-in", value: c?.kind?.id ?? (c?.driver ? DRIVER + c.driver.name : options[0].value), options }],
      "A new plug-in object copies one the drawing has of that kind: its class, parameters and drawing. An installed plug-in draws a new one from its default parameters.",
    );
    if (v) this.kind = v.choice("kind");
  }

  /** Create Similar Object: new objects copy one of this object's plug-in (or are drawn by it, when installed). */
  takeFrom(obj: ObjectInfo): boolean {
    const name = store.session?.doc.records(obj.id).find((r) => r.parametric)?.name;
    const kind = (store.session?.pluginKinds() ?? []).find((k) => k.name === name);
    const driver = name === undefined ? undefined : pluginDriver(name);
    if (kind) this.kind = kind.id;
    else if (driver) this.kind = DRIVER + driver.name;
    return kind !== undefined || driver !== undefined;
  }

  hint(): string {
    const c = this.current();
    if (!c) return "This drawing has no plug-in object to copy";
    const d = c.driver;
    if (d?.shape === "linear") return this.start ? `Release at the end of the ${d.name} · Shift ${ANGLE_STEP_DEG}°` : `Drag from the start of a ${d.name} to its end · Preferences picks the plug-in`;
    if (d?.shape === "rect") return this.start ? `Release at the opposite corner` : `Drag across a ${d.name}'s rectangle · Preferences picks the plug-in`;
    if (this.start) return `Release where it faces · Shift ${ANGLE_STEP_DEG}°`;
    return `Click to place a ${c.kind?.name ?? d?.name}, or drag to turn it · Preferences picks the plug-in`;
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
    if (this.start) this.drag = p;
  }

  down(p: PointerInfo): void {
    this.at = p.pos;
    this.start = { pos: p.pos, screen: p.screen };
    this.drag = null;
  }

  up(p: PointerInfo): void {
    const start = this.start;
    this.start = null;
    this.drag = null;
    const c = this.current();
    const layerId = store.activeLayerId;
    if (!start || !c || !layerId) return;
    const dragged = Math.hypot(p.screen.x - start.screen.x, p.screen.y - start.screen.y) >= DRAG_PX;
    const angle = dragged ? this.angleTo(start.pos, p) : undefined;
    if (c.driver) {
      this.placeNew(c.driver, layerId, start.pos, dragged ? this.endOf(start.pos, p) : null);
      return;
    }
    const k = c.kind;
    const r = attempt("Insert Plug-in Object", (s) => s.insertPlugin(k.id, layerId, start.pos, angle));
    // the copy goes on the layer, not into the group being edited, and is selected
    if (r) setEditGroup(null, [r.value]);
  }

  cancel(): void {
    this.start = null;
    this.drag = null;
  }

  overlay(g: Painter): void {
    const c = this.current();
    const at = this.start?.pos ?? this.at;
    if (!c || !at) return;
    const end = this.drag && this.start ? this.endOf(this.start.pos, this.drag) : null;
    if (c.driver && end && c.driver.shape !== "point") {
      const outline = c.driver.shape === "linear" ? [at, end] : [at, { x: end.x, y: at.y }, end, { x: at.x, y: end.y }];
      withPreview(g, () => strokeScreen(g, outline, c.driver.shape === "rect"));
    }
    const k = c.kind;
    if (k) {
      const turn = this.drag && this.start && dist(this.start.pos, this.drag.pos) > 0 ? this.angleTo(this.start.pos, this.drag) - k.angle : 0;
      const rad = (turn * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const outline = k.outline.map((q) => ({ x: at.x + cos * q.x - sin * q.y, y: at.y + sin * q.x + cos * q.y }));
      withPreview(g, () => strokeScreen(g, outline, true));
    }
    this.cross(g, at);
  }

  /** The insertion point's cross. */
  private cross(g: Painter, at: Pt): void {
    const o = g.toScreen(at);
    const { ctx } = g;
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(o.x - CROSS_PX, o.y);
    ctx.lineTo(o.x + CROSS_PX, o.y);
    ctx.moveTo(o.x, o.y - CROSS_PX);
    ctx.lineTo(o.x, o.y + CROSS_PX);
    ctx.stroke();
    ctx.restore();
  }

  /** What a new object is: the choice made, while the drawing has that kind or it is still installed, else the first there is. */
  private current(): Choice | null {
    const wanted = takePreferredDriver();
    if (wanted) this.kind = DRIVER + wanted;
    const kinds = store.session?.pluginKinds() ?? [];
    const kind = kinds.find((k) => k.id === this.kind);
    if (kind) return { kind };
    const driver = this.kind?.startsWith(DRIVER) ? pluginDriver(this.kind.slice(DRIVER.length)) : undefined;
    if (driver) return { driver };
    if (kinds[0]) return { kind: kinds[0] };
    const first = insertable()[0];
    return first ? { driver: first } : null;
  }

  /** Where a drag from `from` ends: the pointer, along 15° steps with Shift. */
  private endOf(from: Pt, p: PointerInfo): Pt {
    return p.shift ? snapAngle(from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  /**
   * Places a plug-in a feature draws: from a click, at the point unturned; from a drag, a point object
   * turned to face its end, a linear one along it, a rectangular one across it (its origin is the
   * middle of the rectangle's left side, as in Vectorworks).
   */
  private placeNew(d: PluginDriver, layerId: string, from: Pt, to: Pt | null): void {
    if (!to) {
      d.place(layerId, from, 0, null);
      return;
    }
    const angle = (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
    if (d.shape === "point") d.place(layerId, from, angle, null);
    else if (d.shape === "linear") d.place(layerId, from, angle, { width: dist(from, to), height: 0 });
    else {
      const x0 = Math.min(from.x, to.x);
      const y0 = Math.min(from.y, to.y);
      const y1 = Math.max(from.y, to.y);
      d.place(layerId, { x: x0, y: (y0 + y1) / 2 }, 0, { width: Math.abs(to.x - from.x), height: y1 - y0 });
    }
  }

  /** The way a copy placed at `from` faces when the drag is at `p`, degrees (Shift: 15° steps). */
  private angleTo(from: Pt, p: PointerInfo): number {
    const to = this.endOf(from, p);
    return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
  }
}
