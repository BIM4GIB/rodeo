// Spotlight's Video Camera tool: a click where the camera stands and a second click (or a drag) the
// way it faces places a video camera (videoCamera.ts), with the lens, body, format, stand and height
// Preferences sets. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { dist, snapAngle, ANGLE_STEP_DEG } from "../geom.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";
import { placeVideoCamera, videoCameraSettings } from "../videoCamera.ts";
import { BODIES, focalOn, FORMATS, LENSES, lensNamed, STANDS, type Stand } from "../videoCameraShapes.ts";
import { layerScale, preview } from "./detailing.ts";

/** a press dragged at least this far is a drag to the turn, not a click */
const CLICK_PX = 4;

const options = (names: readonly string[]) => names.map((value) => ({ value, label: value }));

export class VideoCameraTool extends BaseTool {
  readonly id = "videocamera";
  readonly cursor = "crosshair";
  private from: Pt | null = null;
  private pressScreen: Pt | null = null;
  private cursorAt: Pt | null = null;

  async preferences(): Promise<void> {
    const k = videoCameraSettings;
    const v = await toolPrefs("Video Camera Preferences", [
      { kind: "choice", key: "lens", label: "Lens", value: k.lens, options: options(LENSES.map((l) => l.name)), wide: true },
      { kind: "number", key: "focal", label: "Focal Length", value: k.focal, min: 1, max: 1000, unit: "mm" },
      { kind: "choice", key: "body", label: "Camera Body", value: k.body, options: options(BODIES.map((b) => b.name)), wide: true },
      { kind: "choice", key: "format", label: "Format", value: k.format, options: options(FORMATS.map((f) => f.name).filter((n) => n !== "Custom Aspect")) },
      { kind: "choice", key: "stand", label: "Stand Type", value: k.stand, options: options(STANDS) },
      { kind: "length", key: "height", label: "Height", value: k.height, zero: true },
      { kind: "choice", key: "showField", label: "Show Field of View", value: k.showField, options: options(["None", "Lines", "Filled"]) },
      { kind: "length", key: "reach", label: "Field of View Length", value: k.reach, zero: true },
    ]);
    if (!v) return;
    k.lens = v.choice("lens");
    k.focal = focalOn(lensNamed(k.lens), v.num("focal"));
    k.body = v.choice("body");
    k.format = v.choice("format");
    k.stand = v.choice("stand") as Stand;
    k.height = v.num("height");
    k.showField = v.choice("showField") as typeof k.showField;
    k.reach = v.num("reach");
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    return this.from ? `Click or release the way the camera faces · Shift ${ANGLE_STEP_DEG}°` : "Click where the video camera stands, then click the way it faces";
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    if (!this.from) {
      if (layerScale(this.env) === null) {
        toast("Make a design layer active to place a video camera.", "info");
        return;
      }
      this.from = p.pos;
      this.pressScreen = p.screen;
      return;
    }
    this.pressScreen = null;
    this.finish(this.at(p));
  }

  move(p: PointerInfo): void {
    this.cursorAt = this.at(p);
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.from && press && dist(p.screen, press) > CLICK_PX) this.finish(this.at(p));
  }

  cancel(): void {
    this.from = null;
    this.pressScreen = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.from) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    if (this.from && this.cursorAt) preview(g, [{ kind: "line", a: this.from, b: this.cursorAt }]);
  }

  private at(p: PointerInfo): Pt {
    return this.from && p.shift ? snapAngle(this.from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private finish(to: Pt): void {
    const at = this.from;
    const layerId = store.activeLayerId;
    this.from = null;
    if (!at || !layerId) return;
    const angle = dist(at, to) > 0 ? (Math.atan2(to.y - at.y, to.x - at.x) * 180) / Math.PI : 0;
    placeVideoCamera(layerId, at, angle);
  }
}
