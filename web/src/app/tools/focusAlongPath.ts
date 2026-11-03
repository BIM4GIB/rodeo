// Spotlight's Focus Lighting Devices Along Path: with lighting devices selected, spreads their focus along a
// path, an object clicked (Along Existing Path) or one drawn (Vertex, a double-click or Enter ending it),
// by the Closest Point, Evenly Between or Evenly Inside mode, showing each beam and its centre line as it
// goes. Create Focus Points (Preferences) marks each spot with a focus point. Esc cancels.

import type { Pt, Shape } from "../../core/index.ts";
import { poolOutline } from "../../features/theatre/beam/photometry.ts";
import { aimTo, FOCUS_PLANE_MM, type Fixture } from "../../features/theatre/fixture.ts";
import { fixtures, writeFixtures } from "../../features/theatre/instrument.ts";
import { attempt } from "../commands.ts";
import { focusPoint } from "../fixtureShapes.ts";
import { focusTargets, type FocusDistribution } from "../focusPathShapes.ts";
import { pickObject } from "../hittest.ts";
import { store } from "../state.ts";
import { truePath } from "../stationShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { placedDrawing } from "./circulation.ts";
import { addPart, layerScale } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { ClickedPath } from "./paths.ts";

/** a focus point's size and its name's height, mm on paper, as the Focus Point tool's */
const FOCUS_MM = 4;
const FOCUS_TEXT_MM = 2.5;

interface FocusPath {
  readonly points: readonly Pt[];
  readonly closed: boolean;
}

/** An object's path, when it has one to follow. */
function pathOf(shape: Shape | null | undefined): FocusPath | null {
  if (!shape || shape.kind === "text" || shape.points.length < 2) return null;
  return { points: truePath(shape), closed: shape.closed };
}

export class FocusAlongPathTool extends BaseTool {
  readonly id = "focusalongpath";
  readonly cursor = "crosshair";
  private mode: FocusDistribution = "closest";
  private existing = true;
  private readonly drawing = new ClickedPath();
  private cursorAt: Pt | null = null;
  private hovered: FocusPath | null = null;
  private createPoints = false;
  private prefix = "FP";
  private planeMm = FOCUS_PLANE_MM;

  modes(): ToolModes[] {
    return [
      {
        options: [
          { id: "closest", label: "Closest Point", key: "1" },
          { id: "between", label: "Evenly Between", key: "2" },
          { id: "inside", label: "Evenly Inside", key: "3" },
        ],
        active: this.mode,
      },
      {
        options: [
          { id: "existing", label: "Along Existing Path", key: "4" },
          { id: "vertex", label: "Vertex", key: "5" },
        ],
        active: this.existing ? "existing" : "vertex",
      },
    ];
  }

  setMode(id: string): void {
    if (id === "existing" || id === "vertex") {
      this.existing = id === "existing";
      this.drawing.points = [];
      this.hovered = null;
    } else this.mode = id as FocusDistribution;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Focus Lighting Devices Along Path Preferences",
      [
        { kind: "check", key: "create", label: "Create Focus Points", value: this.createPoints },
        { kind: "text", key: "prefix", label: "Prefix", value: this.prefix },
        { kind: "length", key: "plane", label: "Focus Height", value: this.planeMm, zero: true },
      ],
      "Select the lighting devices first. A device that's focused keeps its focus height; the others use this one.",
    );
    if (!v) return;
    this.createPoints = v.flag("create");
    this.prefix = v.choice("prefix");
    this.planeMm = v.num("plane");
  }

  snapFrom(): Pt | null {
    return this.drawing.points.at(-1) ?? null;
  }

  private devices(): Fixture[] {
    return fixtures().filter((f) => store.selection.has(f.id));
  }

  hint(): string {
    const n = this.devices().length;
    if (!n) return "Select the lighting devices to focus first, then use this tool";
    const count = `${n} lighting device${n === 1 ? "" : "s"}`;
    if (this.existing) return `Click a path to focus ${count} along it`;
    return this.drawing.points.length ? `Click the next corner · double-click or Enter ends it · ${count}` : `Click to start the path for ${count}`;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const devices = this.devices();
    if (!devices.length) {
      toast("Select the lighting devices to focus first, then use this tool.", "info");
      return;
    }
    if (this.existing) {
      if (p.detail > 1) return;
      const path = this.pathAt(p.screen);
      if (path) this.finish(devices, path);
      else toast("Click a line, polyline, polygon, arc or other shape to focus along.", "info");
      return;
    }
    const done = this.drawing.click(p, this.env.view.scale, true);
    if (done) this.finish(devices, done);
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
    if (this.existing) this.hovered = this.pathAt(p.screen);
  }

  cancel(): void {
    this.drawing.points = [];
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && this.drawing.points.length) {
      this.cancel();
      return true;
    }
    if (e.key === "Enter" && this.drawing.points.length >= 2) {
      const devices = this.devices();
      const done = this.drawing.end(false);
      if (devices.length) this.finish(devices, done);
      return true;
    }
    return false;
  }

  overlay(g: Painter): void {
    const path = this.existing ? this.hovered : this.drawn();
    const devices = this.devices();
    if (!path) return;
    const spots = focusTargets(devices.map((d) => d.at), path.points, path.closed, this.mode);
    withPreview(g, () => {
      strokeScreen(g, [...path.points], path.closed);
      spots.forEach((spot, i) => {
        const f = devices[i];
        const z = this.heightOf(f);
        strokeScreen(g, poolOutline({ ...f, focus: { x: spot.x, y: spot.y, z } }, z, f.beamDeg), true);
        strokeScreen(g, [f.at, spot], false);
      });
    });
  }

  private drawn(): FocusPath | null {
    const points = this.drawing.points;
    if (!points.length || !this.cursorAt) return null;
    return { points: [...points, this.cursorAt], closed: false };
  }

  private heightOf(f: Fixture): number {
    return f.focus?.z ?? this.planeMm;
  }

  /** The path of what's under the point on the screen, leaving out the lighting devices themselves. */
  private pathAt(screen: Pt): FocusPath | null {
    const { scene, view } = this.env;
    const active = store.activeLayerId;
    if (!active) return null;
    const hit = pickObject(scene, view, screen, scene.pickableLayers(active));
    if (!hit || store.selection.has(hit.id)) return null;
    return pathOf(hit.shape);
  }

  private finish(devices: readonly Fixture[], path: FocusPath): void {
    const layerId = store.activeLayerId;
    const spots = focusTargets(devices.map((d) => d.at), path.points, path.closed, this.mode);
    if (!layerId || spots.length !== devices.length) return;
    const scale = layerScale(this.env) ?? 1;
    attempt("Focus Lighting Devices Along Path", (s) =>
      s.batch(() => {
        writeFixtures(
          s,
          devices.map((f, i) => ({ id: f.id, edit: { focus: { x: spots[i].x, y: spots[i].y, z: this.heightOf(f) }, aimDeg: aimTo(f.at, spots[i]) } })),
        );
        if (!this.createPoints) return;
        spots.forEach((spot, i) => {
          const drawing = placedDrawing(focusPoint(FOCUS_MM * scale, true, `${this.prefix}${i + 1}`, FOCUS_TEXT_MM * scale), spot, 0);
          s.groupObjects(markerParts(drawing).map((part) => addPart(s, layerId, part)));
        });
      }),
    );
  }
}
