// The three plug-ins installed on first run, disabled. Each adds its work as a
// menu item (Plug-ins menu), so enabling one does nothing until it is chosen;
// Run in the editor runs it once.

import { parseHeader } from "./header.ts";

export interface Example {
  /** fixed, so an example keeps its id when it is installed again */
  readonly id: string;
  readonly code: string;
}

const NUMBER_SELECTED = String.raw`// @name Number Selected Objects
// @description Adds text labels 1, 2, 3 ... at the centre of each selected object, in stacking order.
// @version 1.0
// @author openvwx

// Each label goes on the active layer, centred on its object's bounds, at the Text
// tool's height for the layer's scale. Groups and symbols have no bounds of their own
// here, so they are skipped.
openvwx.menu.add("Number Selected Objects", async () => {
  const selected = await openvwx.doc.selection();
  if (selected.length === 0) {
    await openvwx.ui.alert("Number Selected Objects", "Select some objects first.");
    return;
  }
  const layerId = await openvwx.activeLayer();
  const layer = (await openvwx.doc.layers()).find((l) => l.id === layerId);
  const height = 2.5 * (layer ? layer.scale : 1);
  const stack = await openvwx.doc.objects(layerId);
  const order = new Map(stack.map((o, i) => [o.id, i]));
  const picks = selected
    .filter((o) => o.shape && o.shape.bbox)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  if (picks.length === 0) {
    await openvwx.ui.alert("Number Selected Objects", "None of the selection has a shape to label.");
    return;
  }
  const steps = picks.map((o, i) => {
    const b = o.shape.bbox;
    const at = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
    return ["addObject", layerId, { kind: "text", at, text: String(i + 1), height }];
  });
  await openvwx.edit.batch(steps);
  openvwx.ui.toast("Numbered " + steps.length + " objects.");
});
`;

const RANDOM_FILLS = String.raw`// @name Random Fill Colours
// @description Gives each selected object a solid fill in a random colour from the drawing's colour table. One undo step.
// @version 1.0
// @author openvwx

// Objects with no attributes of their own (groups, symbols) are skipped. The whole
// selection is one undo step: openvwx.edit.batch applies every change at once.
openvwx.menu.add("Random Fill Colours", async () => {
  const targets = (await openvwx.doc.selection()).filter((o) => o.attrs);
  if (targets.length === 0) {
    await openvwx.ui.alert("Random Fill Colours", "Select some objects that have a pen or fill first.");
    return;
  }
  const colours = await openvwx.doc.colors();
  if (colours.length === 0) {
    await openvwx.ui.alert("Random Fill Colours", "The drawing has no colours.");
    return;
  }
  const steps = targets.map((o) => {
    const c = colours[Math.floor(Math.random() * colours.length)];
    return ["setAttributes", [o.id], { fillPattern: 1, fillFore: c.index }];
  });
  await openvwx.edit.batch(steps);
  openvwx.ui.toast("Filled " + steps.length + " objects with random colours.");
});
`;

const COUNT_BY_CLASS = String.raw`// @name Count by Class
// @description Alerts how many objects of each class are on the active layer.
// @version 1.0
// @author openvwx

// Counts the top-level objects (a group counts once, its contents are not counted).
openvwx.menu.add("Count by Class", async () => {
  const layerId = await openvwx.activeLayer();
  const layer = (await openvwx.doc.layers()).find((l) => l.id === layerId);
  const objects = (await openvwx.doc.objects(layerId)).filter((o) => o.parentId === null);
  if (objects.length === 0) {
    await openvwx.ui.alert("Count by Class", "The active layer has no objects.");
    return;
  }
  const counts = new Map();
  for (const o of objects) {
    const name = o.className || "None";
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const lines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => name + ": " + n);
  const title = layer ? layer.name : "Active layer";
  await openvwx.ui.alert("Count by Class", title + ", " + objects.length + " objects\n" + lines.join("\n"));
});
`;

export const EXAMPLES: readonly Example[] = [
  { id: "example-number-selected", code: NUMBER_SELECTED },
  { id: "example-random-fills", code: RANDOM_FILLS },
  { id: "example-count-by-class", code: COUNT_BY_CLASS },
];

/** The header name of each example, for checks that the bundled code is well formed. */
export function exampleNames(): string[] {
  return EXAMPLES.map((e) => parseHeader(e.code).name);
}
