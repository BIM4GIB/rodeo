// Spotlight's Photometer: a click where it reads and a second click (or a drag) for its turn places a
// Photometer plug-in object. Photometric Grid: two clicks run through its centre (Center-line Placement)
// or along its edge (Edge Placement), and a third sets its width. Object Info edits both, and
// features/theatre/beam/photometers.ts draws them and works out their readings. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { gridProblem, gridFromClicks, gridPoints, inDrawing, tiltOfOffset, type GridPlacement } from "../photometerShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs, type PrefField } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { dist, snapAngle, ANGLE_STEP_DEG } from "../geom.ts";
import { gridSettings, photoSettings, placePhotoGrid, placePhotometer } from "../../features/theatre/beam/photometers.ts";
import { layerScale, preview } from "./detailing.ts";

/** a press dragged at least this far is a drag to the turn, not a click */
const CLICK_PX = 4;

const commonPrefs = (): PrefField[] => [
  { kind: "length", key: "elevation", label: "Elevation", value: photoSettings.elevation, signed: true },
  { kind: "number", key: "textSize", label: "Text Size", value: photoSettings.textSize, min: 0.5, max: 50, unit: "mm on paper" },
  { kind: "check", key: "showElevation", label: "Show Elevation", value: photoSettings.showElevation },
  { kind: "check", key: "showZero", label: "Show Zero", value: photoSettings.showZero },
  { kind: "check", key: "useThresholds", label: "Use Threshold Settings", value: photoSettings.useThresholds },
];

const keepCommon = (v: { num(key: string): number; flag(key: string): boolean }): void => {
  photoSettings.elevation = v.num("elevation");
  photoSettings.textSize = v.num("textSize");
  photoSettings.showElevation = v.flag("showElevation");
  photoSettings.showZero = v.flag("showZero");
  photoSettings.useThresholds = v.flag("useThresholds");
};

const NOTE = "Each reading adds up every lighting instrument, focused or aimed straight down, at the levels being looked at. Moving a light doesn't change a reading until you click Refresh in Object Info.";

export class PhotometerTool extends BaseTool {
  readonly id = "photometer";
  readonly cursor = "crosshair";
  private from: Pt | null = null;
  private pressScreen: Pt | null = null;
  private cursorAt: Pt | null = null;

  async preferences(): Promise<void> {
    const v = await toolPrefs("Photometer Preferences", commonPrefs(), NOTE);
    if (v) keepCommon(v);
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    return this.from ? `Click or release to set its rotation · Shift ${ANGLE_STEP_DEG}°` : "Click where the photometer reads, then click to set its rotation";
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    if (!this.from) {
      if (layerScale(this.env) === null) {
        toast("Make a design layer active to place a photometer.", "info");
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
    placePhotometer(layerId, at, angle);
  }
}

export class PhotoGridTool extends BaseTool {
  readonly id = "photogrid";
  readonly cursor = "crosshair";
  private edge = false;
  private clicks: Pt[] = [];
  private cursorAt: Pt | null = null;

  modes(): ToolModes {
    return {
      options: [
        { id: "center", label: "Center-line Placement", key: "1" },
        { id: "edge", label: "Edge Placement", key: "2" },
      ],
      active: this.edge ? "edge" : "center",
    };
  }

  setMode(id: string): void {
    this.edge = id === "edge";
    this.clicks = [];
  }

  async preferences(): Promise<void> {
    const g = gridSettings;
    const v = await toolPrefs(
      "Photometric Grid Preferences",
      [
        ...commonPrefs(),
        { kind: "length", key: "spacingX", label: "Grid Spacing X", value: g.spacingX },
        { kind: "length", key: "spacingY", label: "Grid Spacing Y", value: g.spacingY },
        { kind: "choice", key: "slope", label: "Slope Based On", value: g.byDistance ? "distance" : "angle", options: [{ value: "angle", label: "Angle" }, { value: "distance", label: "Distance" }] },
        { kind: "number", key: "tiltX", label: "Tilt Angle X", value: g.tiltX, min: -88, max: 88, unit: "°" },
        { kind: "number", key: "tiltY", label: "Tilt Angle Y", value: g.tiltY, min: -88, max: 88, unit: "°" },
        { kind: "length", key: "offsetX", label: "Height Offset X", value: g.offsetX, signed: true },
        { kind: "length", key: "offsetY", label: "Height Offset Y", value: g.offsetY, signed: true },
      ],
      `${NOTE} X runs along your first two clicks. The tilt or offset rises from the corner at -X, -Y, which stands at the Elevation.`,
    );
    if (!v) return;
    keepCommon(v);
    g.spacingX = v.num("spacingX");
    g.spacingY = v.num("spacingY");
    g.byDistance = v.choice("slope") === "distance";
    g.tiltX = v.num("tiltX");
    g.tiltY = v.num("tiltY");
    g.offsetX = v.num("offsetX");
    g.offsetY = v.num("offsetY");
  }

  snapFrom(): Pt | null {
    return this.clicks.at(-1) ?? null;
  }

  hint(): string {
    if (this.clicks.length === 2) return "Click to set the grid's width";
    const along = this.edge ? "its edge" : "its center";
    return this.clicks.length ? `Click the other end of ${along}` : `Click to start a line along ${along}`;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0 || p.detail > 1) return;
    if (!this.clicks.length && layerScale(this.env) === null) {
      toast("Make a design layer active to place a photometric grid.", "info");
      return;
    }
    if (this.clicks.length < 2) {
      if (this.clicks.length === 1 && dist(this.clicks[0], p.pos) < 1) return;
      this.clicks.push(p.pos);
      return;
    }
    const placed = gridFromClicks(this.clicks[0], this.clicks[1], p.pos, this.edge);
    if (!placed) return;
    this.clicks = [];
    this.finish(placed);
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.clicks = [];
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.clicks.length) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    const c = this.cursorAt;
    if (!c || !this.clicks.length) return;
    if (this.clicks.length === 1) {
      preview(g, [{ kind: "line", a: this.clicks[0], b: c }]);
      return;
    }
    const placed = gridFromClicks(this.clicks[0], this.clicks[1], c, this.edge);
    if (!placed) {
      preview(g, [{ kind: "line", a: this.clicks[0], b: this.clicks[1] }]);
      return;
    }
    const corner = (x: number, y: number): Pt => inDrawing(placed.center, placed.angle, { x: (x * placed.widthX) / 2, y: (y * placed.widthY) / 2 });
    preview(g, [{ kind: "polygon", points: [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], closed: true }]);
  }

  private finish(placed: GridPlacement): void {
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const s = gridSettings;
    const spec = {
      widthX: placed.widthX,
      widthY: placed.widthY,
      spacingX: s.spacingX,
      spacingY: s.spacingY,
      elevation: photoSettings.elevation,
      tiltX: s.byDistance ? tiltOfOffset(s.offsetX, placed.widthX) : s.tiltX,
      tiltY: s.byDistance ? tiltOfOffset(s.offsetY, placed.widthY) : s.tiltY,
    };
    const problem = gridProblem(spec);
    if (problem) {
      toast(problem, "info");
      return;
    }
    placePhotoGrid(layerId, placed.center, placed.angle, placed.widthX, placed.widthY);
    toast(`Photometric Grid: ${gridPoints(spec).length.toLocaleString()} readings.`, "info");
  }
}
