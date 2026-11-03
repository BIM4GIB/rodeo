// Camera tool (Visualization): press where the camera stands and drag to the point it looks at, as
// Vectorworks' Camera tool does; a click without a drag looks north. The camera goes on the active
// layer in the active class at the eye height the tool's preferences give, looking level. A new camera
// takes its lens, projection and drawing from one the drawing has (there is no blank one to start
// from), and is named "Camera n". It is selected, and the tool stays active for more.

import type { Pt, Vec3 } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { ACCENT } from "../renderer.ts";
import { layerInfo, store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";

/** a press that moves less than this many CSS px is a click, not a drag that aims */
const DRAG_PX = 4;
/** a standing person's eye, where a new camera goes until the preferences say otherwise (mm) */
const DEFAULT_HEIGHT = 1600;
/** how far a camera placed with a click looks (mm) */
const CLICK_REACH = 5000;
/** the eye's mark, CSS px */
const EYE_PX = 5;

export class CameraTool extends BaseTool {
  readonly id = "camera";
  readonly cursor = "crosshair";
  private height = DEFAULT_HEIGHT;
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;
  /** where the press went down: the camera's eye while a drag aims it */
  private start: { pos: Pt; screen: Pt } | null = null;

  constructor(env: ToolEnv) {
    super(env);
    // tools get no pointer-leave event, so the preview goes when the pointer leaves the canvas
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Camera Preferences",
      [{ kind: "length", key: "height", label: "Eye height", value: this.height }],
      "The eye height is above the layer, and the camera looks level. Its lens and projection come from a camera the drawing already has.",
    );
    if (!v) return;
    this.height = v.num("height");
  }

  hint(): string {
    if (store.session && !store.session.canAddCamera()) return "This drawing has no Renderworks camera to copy settings from";
    if (this.start) return "Release where the camera looks";
    return "Press where the camera stands and drag to where it looks · click to look north";
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
    const look = dragged ? p.pos : { x: start.pos.x, y: start.pos.y + CLICK_REACH };
    // the eye and look-to point are in the 3D view's frame, which carries the layer's elevation
    const z = (layerInfo(layerId)?.elevation ?? 0) + this.height;
    const eye: Vec3 = [start.pos.x, start.pos.y, z];
    const target: Vec3 = [look.x, look.y, z];
    const r = attempt("Add Camera", (s) => s.addCamera(layerId, eye, target, store.activeClassIndex));
    // the new camera goes on the layer, not into the group being edited, and is selected
    if (r) setEditGroup(null, [r.value]);
  }

  cancel(): void {
    this.start = null;
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
    ctx.arc(o.x, o.y, EYE_PX, 0, 2 * Math.PI);
    if (this.start && this.at) {
      // the line of sight, to where the drag is
      const e = p.toScreen(this.at);
      ctx.moveTo(o.x, o.y);
      ctx.lineTo(e.x, e.y);
    }
    ctx.stroke();
    ctx.restore();
  }
}
