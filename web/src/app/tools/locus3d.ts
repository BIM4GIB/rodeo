// The 3D Modeling set's 3D Locus: each click places a 3D locus, a reference point in space that doesn't
// print. In Top/Plan it lies at the snapped cursor, at the Elevation in Preferences above the layer's plane.
// In the 3D view a click on a face of the model puts it on that face, and a click on nothing puts it on the
// active working plane, or else at that Elevation.

import type { Pt, Vec3 } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { appContext, on3d } from "../ext.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo, type ToolEnv } from "../tools.ts";
import type { FaceHit } from "../view3d.ts";
import { activePlane, onWorkingPlanes } from "../workingPlanes.ts";
import { paintCross } from "./locus.ts";

const settings = { elevation: 0 };

let active = false;

const layerElevation = (): number => store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;

/** Places a 3D locus at (x, y) and z above the layer's plane, and selects it. */
function place(x: number, y: number, z: number): void {
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const made = attempt("3D Locus", (s) => s.add3DLoci(layerId, [[x, y, z]], store.activeClassIndex));
  if (made) setEditGroup(null, made.value);
}

function clicked(hit: FaceHit | null, _shift: boolean, e: MouseEvent): void {
  if (!active) return;
  const v = appContext()?.view3d();
  if (!v) return;
  const plane = activePlane();
  const onPlane = (): Vec3 | null => {
    if (!plane) return v.pointAtHeight(e, layerElevation() + settings.elevation);
    const { x, y } = plane;
    return v.pointOnPlane(e, plane.origin, [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]);
  };
  const at = hit?.point ?? onPlane();
  if (!at) {
    toast("That click met nothing to put a 3D locus on: the view looks away from the plane it would lie on.", "info");
    return;
  }
  place(at[0], at[1], at[2] - layerElevation());
}

/** Has the tool take the 3D view's clicks while it's in use. */
export function mountLocus3d(): void {
  const claim = (): void => {
    const v = appContext()?.view3d();
    if (!v) return;
    if (active) v.onFacePick = clicked;
    else if (v.onFacePick === clicked) v.onFacePick = null;
  };
  store.on("tool", () => {
    const now = store.tool === "locus3d";
    if (now === active) return;
    active = now;
    claim();
  });
  on3d(claim);
  onWorkingPlanes(() => {
    const v = appContext()?.view3d();
    if (v && active) v.onFacePick ??= clicked;
  });
}

export class Locus3DTool extends BaseTool {
  readonly id = "locus3d";
  readonly cursor = "crosshair";
  /** snapped pointer position in document units; null once the pointer leaves the canvas */
  private at: Pt | null = null;

  constructor(env: ToolEnv) {
    super(env);
    document.getElementById("canvas")?.addEventListener("pointerleave", () => {
      this.at = null;
      this.env.requestDraw();
    });
  }

  hint(): string {
    return settings.elevation ? "Click to place a 3D locus at the Elevation in Preferences" : "Click to place a 3D locus on the layer's plane (Elevation in Preferences)";
  }

  move(p: PointerInfo): void {
    this.at = p.pos;
  }

  down(p: PointerInfo): void {
    this.at = p.pos;
    place(p.pos.x, p.pos.y, settings.elevation);
  }

  overlay(p: Painter): void {
    if (this.at) paintCross(p, this.at);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "3D Locus Preferences",
      [{ kind: "length", key: "elevation", label: "Elevation", value: settings.elevation, zero: true, signed: true }],
      "How far above the layer's plane a locus lies when it's placed in Top/Plan, or on nothing in the 3D view with no working plane active.",
    );
    if (v) settings.elevation = v.num("elevation");
  }
}
