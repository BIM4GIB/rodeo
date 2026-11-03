// The right-click menu's New Hatch from Locally Mapped Hatch, as Vectorworks has it: an object whose
// hatch the Attribute Mapping tool has laid (moved, turned or skewed from where the hatch lies on
// its own) gets a new hatch resource, named in a dialog, with that laying in its lines, and takes
// it, its mapping set back to the plain one, so it looks as it did and other objects can take the
// same hatch. The new hatch copies the old one's ground, colours, weights and sizing (on the page
// or in the world) and its previews are drawn anew. One undo step; Resources lists it.

import type { FillMapping, HatchFill, Pt } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { hatchPreviews } from "./hatchEditor.ts";
import { showDialog } from "./menubar.ts";
import { hatchFrame, mappingFits } from "./renderer.ts";
import { shapeBBox } from "./shapes.ts";
import { store } from "./state.ts";

/** The mapping that lays a hatch as it lies on its own: from the origin, along x and y. */
const PLAIN = { origin: { x: 0, y: 0 }, u: { x: 1, y: 0 }, v: { x: 0, y: 1 } };

/** Object `id`'s own hatch (not its class's) and the mapping that lays it other than plainly, or null. */
function localHatch(id: string | null): { index: number; name: string; hatch: HatchFill; map: FillMapping; scale: number } | null {
  const doc = store.session?.doc;
  const o = id === null ? null : doc?.object(id);
  const map = o?.fillMap;
  if (!doc || !o?.attrs || !o.shape || !map || o.attrs.fillPattern >= 0 || o.byClass?.includes("fill")) return null;
  const res = doc.resources().find((r) => r.kind === "hatch" && r.index === -o.attrs!.fillPattern);
  const box = shapeBBox(o.shape);
  // a mapping the drawing doesn't lay the hatch by (left behind far from the object) isn't local
  if (!res?.hatch || !box || !mappingFits(map, box)) return null;
  const f = hatchFrame(map, 1);
  const plain = Math.abs(f.a - 1) + Math.abs(f.b) + Math.abs(f.c) + Math.abs(f.d - 1) < 1e-9 && Math.hypot(f.e, f.f) < 1e-6;
  if (plain) return null;
  const layer = doc.layers().find((l) => l.id === o.layerId);
  // a page-sized hatch is drawn at the layer's scale, a world-sized one at 1:1
  const scale = res.hatch.page && layer?.kind === "design" ? layer.scale : 1;
  return { index: res.index, name: res.name, hatch: res.hatch, map, scale };
}

export function canMakeLocalHatch(id: string | null): boolean {
  return localHatch(id) !== null;
}

/** `hatch` with mapping `map` laid into its lines: drawn plainly at `scale`, it lies where the mapping laid it. */
export function bakedHatch(hatch: HatchFill, map: FillMapping, scale: number): HatchFill {
  const f = hatchFrame(map, 1);
  const turn = (p: Pt): Pt => ({ x: f.a * p.x + f.c * p.y, y: f.b * p.x + f.d * p.y });
  return {
    ...hatch,
    lines: hatch.lines.map((l) => {
      const base = turn(l.base);
      return { ...l, base: { x: base.x + f.e / scale, y: base.y + f.f / scale }, period: turn(l.period), offset: turn(l.offset) };
    }),
  };
}

/** New Hatch from Locally Mapped Hatch: asks the new hatch's name, then makes it and gives it to object `id`. */
export async function newHatchFromLocal(id: string): Promise<void> {
  const local = localHatch(id);
  const doc = store.session?.doc;
  if (!local || !doc) return;
  const taken = new Set([...doc.resources().map((r) => r.name), ...doc.classes().map((c) => c.name), ...doc.layers().map((l) => l.name)]);
  let n = 2;
  while (taken.has(`${local.name}-${n}`)) n++;
  const input = h("input", { cls: "menu-dialog-input", value: `${local.name}-${n}`, attrs: { type: "text", "aria-label": "Name", spellcheck: "false" } });
  const name = await showDialog<string>({
    title: "New Hatch from Locally Mapped Hatch",
    okLabel: "Create",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), input)],
    check: () => {
      const v = input.value.trim();
      if (!v) return { error: "Enter a name.", focus: input };
      if (taken.has(v)) return { error: `"${v}" is already used in this drawing.`, focus: input };
      return { value: v };
    },
  });
  if (!name) return;
  const hatch = bakedHatch(local.hatch, local.map, local.scale);
  const own = doc.resources().find((r) => r.kind === "hatch" && r.index === local.index);
  const previews = hatchPreviews(doc, hatch, own);
  attempt("New Hatch from Locally Mapped Hatch", (s) =>
    s.batch(() => {
      const index = s.createHatch(name, hatch, previews, local.index);
      s.setAttributes([id], { fillPattern: -index });
      s.setFillMapping(id, { ...PLAIN, shape: local.map.shape });
    }),
  );
}
