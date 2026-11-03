// Modify > Align > Align/Distribute 3D… (⇧⌘=), Vectorworks' 3D Object Align and Distribute dialog:
// the selected objects that show in 3D are aligned along X, Y and Z by their minimum, centre,
// maximum or insertion point, or distributed so those fall evenly or the gaps between neighbours
// (Spacing) are equal, along the layer plane's axes or the active working plane's. Each object is
// measured by the box its 3D faces and edges fill in that frame. 2D objects are left where they
// are, as Vectorworks leaves them. Rodeo knows insertion points in plan only, so they count along
// the layer plane's X and Y; elsewhere objects go by their centres, as Vectorworks takes objects
// without one. Aligning lines objects up with the selection's edge, or its middle for centres and
// insertion points; distributing keeps the two outermost where they are. All three axes together
// are one undo step.

import type { Vec3 } from "../core/index.ts";
import { alignAxis, axisRow, distributeAxis, type AxisPlan, type AxisSetting, type Item, type Measure } from "./alignDistribute.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { activePlane } from "./workingPlanes.ts";

export interface Plan3D {
  readonly x?: AxisPlan;
  readonly y?: AxisPlan;
  readonly z?: AxisPlan;
  /** along the active working plane's axes, not the layer plane's */
  readonly workingPlane?: boolean;
}

/** The axes lined up along: unit and square, from `origin`. */
interface Frame {
  readonly origin: Vec3;
  readonly axes: readonly [Vec3, Vec3, Vec3];
}

const LAYER_PLANE: Frame = {
  origin: [0, 0, 0],
  axes: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
};

/** Offsets below this many millimetres are rounding noise and are not applied. */
const MOVE_EPS = 1e-9;

/** The active working plane's axes, its z square to it; null when the layer plane is active. */
function workingFrame(): Frame | null {
  const p = activePlane();
  if (!p) return null;
  const [x, y] = [p.x, p.y];
  return { origin: p.origin, axes: [x, y, [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]] };
}

/** The selected objects with a 3D form, measured in `frame`, and how many selected objects have none. */
function items3d(frame: Frame): { list: Item[]; flat: number } {
  const doc = store.session?.doc;
  const ids = new Set(store.selection);
  if (!doc || ids.size === 0) return { list: [], flat: 0 };
  const boxes = new Map<string, { lo: number[]; hi: number[] }>();
  const [o, ax] = [frame.origin, frame.axes];
  for (const m of doc.model3d()) {
    if (!ids.has(m.objectId)) continue;
    for (const pts of [m.triangles, m.edges]) {
      for (let i = 0; i + 2 < pts.length; i += 3) {
        const d = [pts[i] - o[0], pts[i + 1] - o[1], pts[i + 2] - o[2]];
        let box = boxes.get(m.objectId);
        if (!box) boxes.set(m.objectId, (box = { lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] }));
        for (let k = 0; k < 3; k++) {
          const v = d[0] * ax[k][0] + d[1] * ax[k][1] + d[2] * ax[k][2];
          if (v < box.lo[k]) box.lo[k] = v;
          if (v > box.hi[k]) box.hi[k] = v;
        }
      }
    }
  }
  const plan = frame === LAYER_PLANE;
  const list = [...boxes].map(([id, box]): Item => {
    const at = plan ? doc.object(id)?.insertion : undefined;
    return { id, lo: box.lo, hi: box.hi, insertion: at ? [at.x, at.y] : null, locus: null };
  });
  return { list, flat: ids.size - list.length };
}

/** Why `plan` can't run on `count` 3D objects, or null when it can. */
function refusal(count: number, plan: Plan3D): string | null {
  const plans = [plan.x, plan.y, plan.z].filter((p): p is AxisPlan => !!p);
  if (!plans.length) return "Choose an axis to align or distribute along.";
  if (count === 0) return "Select objects that show in 3D: Align/Distribute 3D leaves 2D objects where they are.";
  if (plans.some((p) => p.how === "distribute") && count < 3) return "Distributing takes three 3D objects or more.";
  if (count < 2) return "Aligning takes two 3D objects or more.";
  return null;
}

/** Aligns and distributes the selection's 3D objects by `plan`, as one undo step. */
export function alignDistribute3d(plan: Plan3D): void {
  const frame = (plan.workingPlane ? workingFrame() : null) ?? LAYER_PLANE;
  const { list, flat } = items3d(frame);
  const why = refusal(list.length, plan);
  if (why) {
    toast(why, "info");
    return;
  }
  const along = (axis: number, p: AxisPlan | undefined): Map<string, number> =>
    !p ? new Map() : p.how === "align" ? alignAxis(list, axis, p.by, null) : distributeAxis(list, axis, p.by);
  const offsets = [along(0, plan.x), along(1, plan.y), along(2, plan.z)];
  // each object's move along the frame's axes, as one in the drawing's; the same moves go together
  const groups = new Map<string, { d: Vec3; ids: string[] }>();
  for (const it of list) {
    const [a, b, c] = offsets.map((m) => m.get(it.id) ?? 0);
    const [u, v, w] = frame.axes;
    const d: Vec3 = [a * u[0] + b * v[0] + c * w[0], a * u[1] + b * v[1] + c * w[1], a * u[2] + b * v[2] + c * w[2]];
    if (d.every((v) => Math.abs(v) < MOVE_EPS)) continue;
    const key = d.join("|");
    const g = groups.get(key);
    if (g) g.ids.push(it.id);
    else groups.set(key, { d, ids: [it.id] });
  }
  if (groups.size > 0) {
    attempt("Align/Distribute 3D", (s) => s.batch(() => groups.forEach(({ d, ids }) => s.moveObjects3D(ids, d[0], d[1], d[2]))));
  }
  if (flat > 0) toast(`${flat === 1 ? "A 2D object was" : `${flat} 2D objects were`} left where ${flat === 1 ? "it was" : "they were"}: Align/Distribute 3D moves objects that show in 3D.`, "info");
}

// ---- the dialog ---------------------------------------------------------------------------------

const CHOICES: readonly (readonly [Measure, string])[] = [
  ["min", "Minimum"],
  ["center", "Center"],
  ["insertion", "Insertion Point"],
  ["max", "Maximum"],
  ["spacing", "Spacing"],
];

/** the dialog's last settings, kept for the next time */
const last: { x: AxisSetting; y: AxisSetting; z: AxisSetting; workingPlane: boolean } = {
  x: { on: false, how: "align", by: "min" },
  y: { on: false, how: "align", by: "min" },
  z: { on: true, how: "align", by: "min" },
  workingPlane: false,
};

/** Modify > Align > Align/Distribute 3D…: each axis's alignment or distribution, run on OK. */
export async function alignDistribute3dDialog(): Promise<void> {
  const hasPlane = activePlane() !== null;
  const axes = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Alignment/Distribution Axes" } },
    h("option", { value: "layer", text: "Layer plane" }),
    h("option", { value: "working", text: "Working plane" }),
  );
  axes.options[1].disabled = !hasPlane;
  axes.value = last.workingPlane && hasPlane ? "working" : "layer";
  const x = axisRow("X", CHOICES, last.x);
  const y = axisRow("Y", CHOICES, last.y);
  const z = axisRow("Z", CHOICES, last.z);
  const plan = await showDialog<Plan3D>({
    title: "3D Object Align and Distribute",
    okLabel: "OK",
    cls: "align-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Alignment/Distribution Axes" }), axes),
      x.el,
      y.el,
      z.el,
      h("p", {
        cls: "muted",
        text: "2D objects stay where they are. Insertion points are those of symbols and plug-in objects, along the layer plane's X and Y; other objects go by their centres.",
      }),
    ],
    check: () => {
      last.workingPlane = axes.value === "working";
      const p: Plan3D = { x: x.plan(), y: y.plan(), z: z.plan(), workingPlane: last.workingPlane };
      const count = items3d((p.workingPlane ? workingFrame() : null) ?? LAYER_PLANE).list.length;
      const why = refusal(count, p);
      return why ? { error: why } : { value: p };
    },
  });
  if (plan) alignDistribute3d(plan);
}
