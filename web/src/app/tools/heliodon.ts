// Heliodon tool (Visualization): each click places a Heliodon, the sun for a place, a date and a
// time, by copying one the drawing has (its class, parameters, drawing and lights), as the
// Plug-in Insertion tool does. Preferences set the latitude, date and solar time a new one has;
// until they do it keeps the copied one's. Setting them works out the sun again and turns the
// Heliodon's lights to shine from it; Object Info sets them afterwards. It is selected, and the
// tool stays active for more.

import type { Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { MONTHS } from "../heliodon.ts";
import { ACCENT } from "../renderer.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

/** arm length of the insertion-point cross, CSS px */
const CROSS_PX = 6;

type Sun = { latitude: number; month: number; day: number; hour: number };

export class HeliodonTool extends BaseTool {
  readonly id = "heliodon";
  readonly cursor = "crosshair";
  /** the sun a new Heliodon is set to, once the preferences have said one */
  private sun: Sun | null = null;
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;

  constructor(env: ToolEnv) {
    super(env);
    // tools get no pointer-leave event, so the preview goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
  }

  async preferences(): Promise<void> {
    const s = store.session;
    const template = s?.heliodonTemplate();
    const was = this.sun ?? (template ? s?.doc.heliodon(template) : null);
    if (!was) return;
    const minutes = Math.round(was.hour * 60) % 1440;
    const v = await toolPrefs(
      "Heliodon Preferences",
      [
        { kind: "number", key: "latitude", label: "Latitude", value: Math.round(was.latitude * 100) / 100, min: -90, max: 90, unit: "°" },
        { kind: "choice", key: "month", label: "Month", value: String(was.month), options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
        { kind: "number", key: "day", label: "Day", value: was.day, min: 1, max: 31, integer: true },
        { kind: "number", key: "hour", label: "Solar time, hours", value: Math.floor(minutes / 60), min: 0, max: 23, integer: true },
        { kind: "number", key: "minute", label: "Minutes", value: minutes % 60, min: 0, max: 59, integer: true },
      ],
      "South is a negative latitude. A new Heliodon copies one the drawing has, set to this sun.",
    );
    if (v) this.sun = { latitude: v.num("latitude"), month: Number(v.choice("month")), day: v.num("day"), hour: v.num("hour") + v.num("minute") / 60 };
  }

  hint(): string {
    if (!store.session?.heliodonTemplate()) return "This drawing has no Heliodon to copy";
    return "Click to place a Heliodon · Preferences set its latitude, date and time";
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
  }

  down(p: PointerInfo): void {
    this.at = p.pos;
    const layerId = store.activeLayerId;
    const sun = this.sun;
    if (!layerId) return;
    const r = attempt("Insert Heliodon", (s) => {
      const template = s.heliodonTemplate();
      if (!template) throw new Error("this drawing has no Heliodon to copy");
      return s.batch(() => {
        const id = s.insertPlugin(template, layerId, p.pos);
        if (sun) s.setHeliodonSun(id, sun);
        return id;
      });
    });
    // the copy goes on the layer, not into the group being edited, and is selected
    if (r) setEditGroup(null, [r.value]);
  }

  overlay(g: Painter): void {
    const at = this.at;
    const kind = store.session?.pluginKinds().find((k) => k.name === "Heliodon");
    if (!at || !kind) return;
    withPreview(g, () => strokeScreen(g, kind.outline.map((q) => ({ x: at.x + q.x, y: at.y + q.y })), true));
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
}
