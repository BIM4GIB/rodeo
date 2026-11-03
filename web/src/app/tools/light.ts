// Light tool (Visualization): each click places a light object at the snapped cursor on the active
// layer in the active class, as Vectorworks' Light tool does: a point light, a spot or a directional
// light, at the elevation the tool's preferences give, a spot or directional light shining straight
// down. Dragging from where it goes aims it: a spot at the point the drag ends, on the layer's floor,
// a directional light that way in plan, 45° down. A new light takes its colour, brightness and spot
// cone from one the drawing has (there is no blank one to start from). It is selected, and the tool
// stays active for more.

import type { ObjectInfo, Pt, Vec3 } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { ACCENT, LIGHT_RING_PX } from "../renderer.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";

type LightKind = "point" | "spot" | "directional";

const KINDS: readonly { id: LightKind; label: string }[] = [
  { id: "point", label: "Point" },
  { id: "spot", label: "Spot" },
  { id: "directional", label: "Directional" },
];

/** a press that moves less than this many CSS px is a click, not a drag that aims */
const DRAG_PX = 4;
/** a ceiling's height, where a new light goes until the preferences say otherwise (mm) */
const DEFAULT_ELEVATION = 2400;

export class LightTool extends BaseTool {
  readonly id = "light";
  readonly cursor = "crosshair";
  private kind: LightKind = "spot";
  private elevation = DEFAULT_ELEVATION;
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;
  /** where the press went down: the light's place while a drag aims it */
  private start: { pos: Pt; screen: Pt } | null = null;

  constructor(env: ToolEnv) {
    super(env);
    // tools get no pointer-leave event, so the preview goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
  }

  modes(): ToolModes {
    return { label: "Kind", options: KINDS.map((k, i) => ({ id: k.id, label: k.label, key: String(i + 1) })), active: this.kind };
  }

  setMode(id: string): void {
    const k = KINDS.find((m) => m.id === id);
    if (k) this.kind = k.id;
  }

  /** Create Similar Object: new lights are of this light's kind. */
  takeFrom(obj: ObjectInfo): boolean {
    if (!obj.shape?.light) return false;
    this.setMode(obj.shape.light.kind);
    return true;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Light Preferences",
      [
        { kind: "choice", key: "kind", label: "Kind", value: this.kind, options: KINDS.map((k) => ({ value: k.id, label: k.label })) },
        { kind: "length", key: "elevation", label: "Elevation", value: this.elevation },
      ],
      "The elevation is above the layer. Brightness, colour and a spot's cone come from a light the drawing already has.",
    );
    if (!v) return;
    this.setMode(v.choice("kind"));
    this.elevation = v.num("elevation");
  }

  hint(): string {
    if (store.session && !store.session.canAdd("light")) return "This drawing has no light object to copy settings from";
    if (this.start) return this.kind === "spot" ? "Release where the spot shines" : "Release the way the light shines";
    return this.kind === "point" ? "Click to place a point light · 1–3 kind" : "Click to place, or drag to aim · 1–3 kind";
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
  }

  down(p: PointerInfo): void {
    this.at = p.pos;
    this.start = { pos: p.pos, screen: p.screen };
  }

  up(p: PointerInfo): void {
    const start = this.start;
    this.start = null;
    const layerId = store.activeLayerId;
    if (!start || !layerId) return;
    const dragged = Math.hypot(p.screen.x - start.screen.x, p.screen.y - start.screen.y) >= DRAG_PX;
    const direction = dragged && this.kind !== "point" ? this.aim(start.pos, p.pos) : undefined;
    const shape = { kind: "light" as const, at: start.pos, z: this.elevation, light: this.kind, ...(direction ? { direction } : {}) };
    // light objects take no attributes, so the drawing attributes and effects other tools apply are left off
    const r = attempt("Add Light", (s) => s.addObject(layerId, shape, store.activeClassIndex));
    // the new light goes on the layer, not into the group being edited, and is selected
    if (r) setEditGroup(null, [r.value]);
  }

  cancel(): void {
    this.start = null;
  }

  /** Where a light placed at `from` shines when the drag ends at `to`. */
  private aim(from: Pt, to: Pt): Vec3 {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (this.kind === "spot") return [dx, dy, -this.elevation];
    const flat = Math.hypot(dx, dy) || 1;
    return [dx / flat, dy / flat, -1];
  }

  overlay(p: Painter): void {
    const at = this.start?.pos ?? this.at;
    if (!at) return;
    const { ctx } = p;
    const o = p.toScreen(at);
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(o.x, o.y, LIGHT_RING_PX, 0, 2 * Math.PI);
    if (this.start && this.at && this.kind !== "point") {
      // the aim, to where the drag is
      const e = p.toScreen(this.at);
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(e.x, e.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
