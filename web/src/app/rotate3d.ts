// Modify > Rotate 3D…, Vectorworks' Rotate Object in 3D dialog: turns the selected 3D objects by
// an angle (counter-clockwise seen from the axis's positive end) about the X, Y or Z axis of the
// layer plane or of the active working plane, through the working plane's centre, the centre of
// the box the selection fills in 3D, or a point clicked next. The click is taken in plan, on the
// layer plane (at the active layer's elevation). About the layer's Z axis every object turns, as
// Rotate turns it in plan; about any other only 3D objects do (extrudes, sweeps, multiple
// extrudes, solids, 3D polygons, meshes and symbols holding only 3D, those in groups too), and the
// rest stay as they are. One undo step.

import type { BBox, Pt, Vec3 } from "../core/index.ts";
import { attempt, selectionBounds } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { activePlane } from "./workingPlanes.ts";

const LABEL = "Rotate 3D";

type Centre = "plane" | "object" | "click";

/** the dialog's last settings, kept for the next time */
const last: { deg: number; centre: Centre; workingPlane: boolean; axis: 0 | 1 | 2 } = { deg: 90, centre: "object", workingPlane: false, axis: 0 };

/** A rotation waiting for its centre to be clicked. */
interface Job {
  readonly ids: readonly string[];
  readonly axis: Vec3;
  readonly deg: number;
}

let pending: Job | null = null;

export function rotate3DJob(): Job | null {
  return pending;
}

export function endRotate3DJob(): void {
  pending = null;
}

/** The active layer's elevation: the height of the layer plane. */
function layerZ(): number {
  return store.session?.doc.layers().find((l) => l.id === store.activeLayerId)?.elevation ?? 0;
}

/** The box the selection fills in 3D, or in plan at the layer plane when nothing of it shows in 3D. */
function selectionBox(scene: Scene): { lo: number[]; hi: number[] } | null {
  const doc = store.session?.doc;
  const ids = store.selection;
  if (!doc || !ids.size) return null;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of doc.model3d()) {
    if (!ids.has(m.objectId)) continue;
    for (const pts of [m.triangles, m.edges]) {
      for (let i = 0; i + 2 < pts.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], pts[i + k]);
          hi[k] = Math.max(hi[k], pts[i + k]);
        }
      }
    }
  }
  if (lo[0] <= hi[0]) return { lo, hi };
  const box: BBox | null = selectionBounds(scene);
  const z = layerZ();
  return box ? { lo: [box.x0, box.y0, z], hi: [box.x1, box.y1, z] } : null;
}

function run(job: Job, centre: Vec3): void {
  const r = attempt(LABEL, (s) => s.rotateObjects3D([...job.ids], job.axis, job.deg, centre));
  if (!r) return;
  const { turned, left } = r.value;
  const others = `${left === 1 ? "1 object that isn't" : `${left} objects that aren't`} a 3D object (2D objects, plug-in objects, walls, doors and windows) stayed as ${left === 1 ? "it was" : "they were"}`;
  if (!turned.length) toast("Nothing turned: only extrudes, sweeps, solids, 3D polygons, meshes and symbols holding only 3D turn about this axis.", "info");
  else if (left) toast(`${LABEL}: ${others}.`, "info");
}

/** Next Mouse Click: the rotation, about the point clicked in plan on the layer plane. */
export function finishRotate3D(at: Pt): void {
  const job = pending;
  pending = null;
  if (job) run(job, [at.x, at.y, layerZ()]);
}

/**
 * Modify > Rotate 3D…: the rotation, run on OK; for Next Mouse Click, `pick` takes up the
 * tool the click is made with and the rotation runs on it.
 */
export async function rotate3DDialog(scene: Scene, pick: () => void): Promise<void> {
  const ids = [...store.selection];
  if (!ids.length || !store.session) return;
  const plane = activePlane();
  const angle = h("input", { cls: "menu-dialog-input", value: String(last.deg), attrs: { type: "text", inputmode: "decimal", "aria-label": "Rotation Angle" } });
  // wide, so the three line up (two of them hold phrases)
  const select = (label: string, options: [string, string][]): HTMLSelectElement =>
    h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map(([value, text]) => h("option", { value, text })));
  const centre = select("Center of Rotation", [
    ["plane", "Working Plane Center"],
    ["object", "Object Center"],
    ["click", "Next Mouse Click"],
  ]);
  centre.value = last.centre;
  const frame = select("Rotation Axis", [
    ["layer", "Active Layer Plane"],
    ["working", "Working Plane"],
  ]);
  frame.options[1].disabled = !plane;
  frame.value = last.workingPlane && plane ? "working" : "layer";
  const axis = select("Axis", [
    ["0", "X"],
    ["1", "Y"],
    ["2", "Z"],
  ]);
  axis.value = String(last.axis);
  const field = (label: string, ...control: Node[]): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
  const deg = await showDialog<number>({
    title: "Rotate Object in 3D",
    okLabel: "OK",
    body: [
      field("Rotation Angle", angle, h("span", { cls: "menu-dialog-unit", text: "°" })),
      field("Center of Rotation", centre),
      field("Rotation Axis", frame),
      field("Axis", axis),
      h("p", {
        cls: "muted",
        text:
          "Counter-clockwise seen from the axis's positive end; a negative angle turns the other way. Object Center is the middle of the box the selection fills in 3D; " +
          "a mouse click is taken in plan, on the layer plane. About any axis but the layer's Z only 3D objects turn.",
      }),
    ],
    check: () => {
      const v = Number(angle.value.trim().replace(",", ".").replace(/°$/, ""));
      return Number.isFinite(v) ? { value: v } : { error: "Rotation Angle: enter a number of degrees.", focus: angle };
    },
  });
  if (deg === null) return;
  last.deg = deg;
  last.centre = centre.value as Centre;
  last.workingPlane = frame.value === "working";
  last.axis = Number(axis.value) as 0 | 1 | 2;
  const p = last.workingPlane ? plane : null;
  const axes: Vec3[] = p
    ? [p.x, p.y, [p.x[1] * p.y[2] - p.x[2] * p.y[1], p.x[2] * p.y[0] - p.x[0] * p.y[2], p.x[0] * p.y[1] - p.x[1] * p.y[0]]]
    : [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ];
  const job: Job = { ids, axis: axes[last.axis], deg };
  if (last.centre === "click") {
    pending = job;
    pick();
    return;
  }
  if (last.centre === "plane") {
    run(job, plane ? plane.origin : [0, 0, layerZ()]);
    return;
  }
  const box = selectionBox(scene);
  if (box) run(job, [0, 1, 2].map((k) => (box.lo[k] + box.hi[k]) / 2) as unknown as Vec3);
}
