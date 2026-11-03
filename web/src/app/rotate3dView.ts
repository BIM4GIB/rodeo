// View > Rotate 3D View…, as Vectorworks Fundamentals has it: the 3D view turned about its orbit
// point by typed angles, as if the model turned about the screen's horizontal, then its upright,
// then the drawing's z axis (opened when the plan shows). The fields keep the last angles while the
// page is open.

import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";

type Angles = [number, number, number];

let last: Angles = [0, 0, 0];

export async function rotate3dViewDialog(): Promise<void> {
  const ctx = appContext();
  if (!ctx || !store.session) return;
  const labels = ["About the screen's horizontal", "About the screen's upright", "About the drawing's z axis"];
  const inputs = labels.map((label, i) =>
    h("input", { cls: "menu-dialog-input", value: String(last[i]), attrs: { type: "text", inputmode: "decimal", "aria-label": label } }),
  );
  const angles = await showDialog<Angles>({
    title: "Rotate 3D View",
    okLabel: "Rotate",
    body: [
      h("p", { cls: "muted", text: "Turns the 3D view about the point it orbits, as if the model turned by these angles (degrees, counter-clockwise looking along each axis toward that point)." }),
      ...inputs.map((input, i) =>
        h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: labels[i] }), input, h("span", { cls: "menu-dialog-unit", text: "°" })),
      ),
    ],
    check: () => {
      const v = inputs.map((input) => Number(input.value.trim().replace(/°$/, "") || "0"));
      const bad = v.findIndex((x) => !Number.isFinite(x));
      if (bad >= 0) return { error: `${labels[bad]}: enter an angle in degrees.`, focus: inputs[bad] };
      return { value: v as Angles };
    },
  });
  if (!angles) return;
  last = angles;
  if (angles.every((a) => a % 360 === 0)) return;
  const view = await ctx.show3d();
  view?.rotateView(...angles);
}
