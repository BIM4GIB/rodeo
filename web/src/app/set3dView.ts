// View > Set 3D View…, as Vectorworks has it: the viewer's position and the point it looks to,
// typed as x, y and a height above the active layer's elevation, and the 3D view looks from one to
// the other (opened when the plan shows), its projection kept. The fields start at the 3D view's
// camera, or from the plan at a standing eye height at the foot of the window, looking level to its
// middle.

import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";
import type { View } from "./view.ts";

/** a standing person's eye, mm, where the viewer starts from the plan */
const EYE_HEIGHT = 1600;
/** viewer and look-to point at least this far apart, mm */
const MIN_APART = 1;

type Point = [number, number, number];

/** Opens Set 3D View and looks as it says. */
export async function set3dViewDialog(scene: Scene, view: View): Promise<void> {
  const ctx = appContext();
  const doc = store.session?.doc;
  if (!ctx || !doc) return;
  const units = doc.info.units;
  const layer = store.activeLayerId ? scene.layer(store.activeLayerId) : undefined;
  const base = layer?.kind === "design" ? (layer.elevation ?? 0) : 0;
  // where the fields start: the camera now, or a person at the window's foot looking to its middle
  const v3 = store.view3d ? ctx.view3d() : null;
  let from: Point;
  let to: Point;
  if (v3) {
    const c = v3.cameraState();
    from = [c.position[0], c.position[1], c.position[2] - base];
    to = [c.target[0], c.target[1], c.target[2] - base];
  } else {
    const r = view.visibleRect();
    from = [view.cx, r.y0, EYE_HEIGHT];
    to = [view.cx, view.cy, EYE_HEIGHT];
  }
  const labels = ["Viewer X", "Viewer Y", "Viewer height", "Look-to X", "Look-to Y", "Look-to height"];
  const suffix = lengthSuffix(units);
  const inputs = [...from, ...to].map((mm, i) =>
    h("input", { cls: "menu-dialog-input", value: formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": labels[i] } }),
  );
  const field = (i: number): HTMLElement =>
    h(
      "label",
      { cls: "menu-dialog-field" },
      h("span", { cls: "menu-dialog-label", text: labels[i] }),
      inputs[i],
      suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
    );
  const v = await showDialog<{ from: Point; to: Point }>({
    title: "Set 3D View",
    okLabel: "Set View",
    body: [
      ...labels.map((_, i) => field(i)),
      h("p", { cls: "muted", text: `Heights are above the active layer${base ? `'s elevation (${formatLengthValue(base, units)}${suffix ? ` ${suffix}` : ""})` : ""}.` }),
    ],
    check: () => {
      const mm: number[] = [];
      for (let i = 0; i < inputs.length; i++) {
        const x = parseLength(inputs[i].value, units);
        if (x === null) return { error: `${labels[i]}: enter a length.`, focus: inputs[i] };
        mm.push(x);
      }
      const a: Point = [mm[0], mm[1], mm[2] + base];
      const b: Point = [mm[3], mm[4], mm[5] + base];
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < MIN_APART) return { error: "The viewer and the look-to point can't be the same point.", focus: inputs[3] };
      return { value: { from: a, to: b } };
    },
  });
  if (!v || store.session?.doc !== doc) return;
  const shown = await ctx.show3d();
  if (!shown) return;
  shown.lookFrom({ x: v.from[0], y: v.from[1], z: v.from[2] }, { x: v.to[0], y: v.to[1], z: v.to[2] });
}
