// Tools > Utilities > Create Color Chart…, as the Vectorworks command does: the drawing's colour
// palette as a chart on the active layer, to print as a colour guide, with each colour's palette
// index under it when asked. Swatches are a set size on paper (as the Text tool's text is), sixteen
// to a row in palette order, grouped and centred in the view; one undo step.

import { attempt, setEditGroup } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import type { Attributes, NewShape } from "../core/index.ts";

/** swatches to a row */
const COLUMNS = 16;
/** a swatch's side, the gap between them and an index number's height, mm on paper */
const SWATCH = 10;
const GAP = 2;
const LABEL = 2.5;

/** Opens Create Color Chart and draws the chart. */
export async function colorChartDialog(): Promise<void> {
  const ctx = appContext();
  const doc = store.session?.doc;
  const layerId = store.activeLayerId;
  const layer = layerId ? ctx?.scene.layer(layerId) : undefined;
  if (!ctx || !doc || !layerId || !layer) return;
  const colors = doc.colors();
  if (colors.length === 0) {
    toast("This drawing has no colour palette.", "info");
    return;
  }
  const numbers = h("input", { checked: true, attrs: { type: "checkbox" } });
  const showNumbers = await showDialog<boolean>({
    title: "Create Color Chart",
    okLabel: "Create",
    body: [
      h("p", { cls: "menu-dialog-text", text: `A chart of the drawing's ${colors.length} colours goes on the layer "${layer.name}".` }),
      h("label", { cls: "menu-dialog-check" }, numbers, "Show color palette index numbers"),
    ],
    check: () => ({ value: numbers.checked }),
  });
  if (showNumbers === null) return;

  const k = layer.scale;
  const step = (SWATCH + GAP) * k;
  const pitch = (SWATCH + GAP + (showNumbers ? LABEL + GAP : 0)) * k;
  const rows = Math.ceil(colors.length / COLUMNS);
  const width = COLUMNS * step - GAP * k;
  const height = rows * pitch - GAP * k;
  const r = ctx.view.visibleRect();
  const left = (r.x0 + r.x1) / 2 - width / 2;
  const top = (r.y0 + r.y1) / 2 + height / 2;
  const shapes: NewShape[] = [];
  const attrs: (Partial<Attributes> | undefined)[] = [];
  colors.forEach((c, i) => {
    const x0 = left + (i % COLUMNS) * step;
    const y1 = top - Math.floor(i / COLUMNS) * pitch;
    shapes.push({ kind: "rect", x0, y0: y1 - SWATCH * k, x1: x0 + SWATCH * k, y1 });
    attrs.push({ fillPattern: 1, fillFore: c.index, fillBack: c.index, fillOpacity: 100 });
    if (!showNumbers) return;
    // centred under its swatch
    shapes.push({ kind: "text", at: { x: x0 + (SWATCH * k) / 2, y: y1 - (SWATCH + GAP / 2) * k }, text: String(c.index), height: LABEL * k, hAlign: 2, vAlign: 1 });
    attrs.push(undefined);
  });
  const done = attempt("Create color chart", (s) => s.batch(() => s.groupObjects(s.addObjects(layerId, shapes, store.activeClassIndex, attrs))));
  if (!done) return;
  setEditGroup(null, [done.value]);
  toast(`Color chart created: ${colors.length} colours.`, "info");
}
