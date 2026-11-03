// The 3D Modeling tool set's primitives, drawn in Top/Plan as Vectorworks draws them. Sphere,
// Hemisphere and Cone go from the centre out to the radius, as the Circle tool does (Tab types the
// centre, then the radius); Extruded Rectangle and Extruded Polygon draw as the Rectangle and
// Polygon tools do. Each makes a true Vectorworks object, as Model > Sweep and Extrude make them
// (so the drawing needs an extrude to copy settings from): the round ones are sweeps turning a
// profile a full turn about their upright axis — a half disc for a sphere, centred on the layer's
// plane; a quarter disc for a hemisphere and a right triangle for a cone, standing on it — and the
// others extrudes. The cone's and the extrudes' heights are their Preferences; one undo step each.

import type { EditSession, NewShape, Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { dist } from "../geom.ts";
import { type ToolId } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { boxOf, CircleTool, RectTool } from "./draw.ts";
import { PolygonTool } from "./poly.ts";

const MIN_WORLD = 1e-9;
/** degrees each segment of a round solid turns, as Model > Sweep offers at first */
const SEGMENT = 5.625;
/** the heights new cones and extrudes start with, in millimetres: a metre */
const START_HEIGHT = 1000;

/** A closed polyline whose points between `corners` are arc vertices of radius `r` at `arcs`. */
function profile(points: Pt[], arcs: readonly number[], r: number): NewShape {
  return {
    kind: "polyline",
    points,
    closed: true,
    vertices: points.map((_, i) => (arcs.includes(i) ? "arc" : "corner")),
    radii: points.map((_, i) => (arcs.includes(i) ? r : 0)),
  };
}

/** Turns the new profile a full turn into a sweep, raised or lowered by `dz`; the sweep's id. */
function sweep(dz = 0): (s: EditSession, id: string) => string {
  return (s, id) => {
    const [made] = s.sweepObjects([id], 360, SEGMENT);
    if (dz) s.moveObjects3D([made], 0, 0, dz);
    return made;
  };
}

/** Extrudes the new shape `height` (mm); the extrude's id. */
function extrude(height: number): (s: EditSession, id: string) => string {
  return (s, id) => s.extrudeObjects([id], height)[0];
}

/** Asks for a height (mm) in `title`; null when cancelled. */
async function askHeight(title: string, height: number): Promise<number | null> {
  const v = await toolPrefs(title, [{ kind: "length", key: "height", label: "Height", value: height }]);
  return v ? v.num("height") : null;
}

export class SphereTool extends CircleTool {
  override readonly id: ToolId = "sphere";

  override hint(): string {
    return this.start ? "Click or release to set the sphere's radius · Tab radius" : "Click or drag from the sphere's centre · Tab X, Y";
  }

  protected override commit(center: Pt, edge: Pt): void {
    const r = dist(center, edge);
    if (r <= MIN_WORLD) return;
    // the right half of the disc, its straight side on the axis; the sweep stands it up from the layer, so it goes down by r
    const { x, y } = center;
    const half = profile(
      [
        { x, y: y - r },
        { x: x + r, y: y - r },
        { x: x + r, y: y + r },
        { x, y: y + r },
      ],
      [1, 2],
      r,
    );
    addAndSelect(half, undefined, sweep(-r));
  }
}

export class HemisphereTool extends CircleTool {
  override readonly id: ToolId = "hemisphere";

  override hint(): string {
    return this.start ? "Click or release to set the hemisphere's radius · Tab radius" : "Click or drag from the hemisphere's centre · Tab X, Y";
  }

  protected override commit(center: Pt, edge: Pt): void {
    const r = dist(center, edge);
    if (r <= MIN_WORLD) return;
    // a quarter disc, its bottom on the layer and its straight side on the axis
    const { x, y } = center;
    addAndSelect(
      profile(
        [
          { x, y: y - r / 2 },
          { x: x + r, y: y - r / 2 },
          { x: x + r, y: y + r / 2 },
          { x, y: y + r / 2 },
        ],
        [2],
        r,
      ),
      undefined,
      sweep(),
    );
  }
}

export class ConeTool extends CircleTool {
  override readonly id: ToolId = "cone";
  private height = START_HEIGHT;

  override hint(): string {
    return this.start ? "Click or release to set the base's radius · Tab radius" : "Click or drag from the base's centre · Tab X, Y · the height is in Preferences";
  }

  async preferences(): Promise<void> {
    const h = await askHeight("Cone Preferences", this.height);
    if (h !== null) this.height = h;
  }

  protected override commit(center: Pt, edge: Pt): void {
    const r = dist(center, edge);
    if (r <= MIN_WORLD) return;
    // a right triangle: the base along the bottom, the upright side on the axis
    const { x, y } = center;
    const h = this.height;
    addAndSelect(
      {
        kind: "polygon",
        closed: true,
        points: [
          { x, y: y - h / 2 },
          { x: x + r, y: y - h / 2 },
          { x, y: y + h / 2 },
        ],
      },
      undefined,
      sweep(),
    );
  }
}

export class ExtrudedRectTool extends RectTool {
  override readonly id: ToolId = "extrect";
  private height = START_HEIGHT;

  override hint(): string {
    return `${super.hint().replace("draw a rectangle", "draw the extrude's footprint")} · the height is in Preferences`;
  }

  async preferences(): Promise<void> {
    const h = await askHeight("Extruded Rectangle Preferences", this.height);
    if (h !== null) this.height = h;
  }

  protected override commit(a: Pt, b: Pt): void {
    const box = boxOf(a, b);
    if (box) addAndSelect({ kind: "rect", ...box }, undefined, extrude(this.height));
  }
}

export class ExtrudedPolygonTool extends PolygonTool {
  override readonly id: ToolId = "extpoly";
  private height = START_HEIGHT;

  async preferences(): Promise<void> {
    const h = await askHeight("Extruded Polygon Preferences", this.height);
    if (h !== null) this.height = h;
  }

  protected override commit(points: Pt[]): void {
    addAndSelect({ kind: "polygon", points, closed: true }, undefined, extrude(this.height));
  }
}
