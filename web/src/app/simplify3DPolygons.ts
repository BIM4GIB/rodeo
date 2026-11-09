// AEC > Terrain > Simplify 3D Polygons…, Vectorworks' Simplify Selected 3D Polygons dialog: a
// Simplification Tolerance and the layer to Put Simplified Result in. The selected 3D polygons
// stay as they are; copies of them go to that layer (as high above it as they were above their
// own), with the vertices within the tolerance of the outline taken out (EditSession.simplifyPolys
// by deviation, measured in 3D), all as one undo step.

import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** the last tolerance (mm) */
let lastTolerance = 0;

/** The selected 3D polygons, outside groups. */
function selected3DPolygons(): string[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].filter((id) => {
    const o = doc.object(id);
    return o?.type === 25 && !o.parentId;
  });
}

export function canSimplify3DPolygons(): boolean {
  return selected3DPolygons().length > 0;
}

/** AEC > Terrain > Simplify 3D Polygons…: the tolerance and the layer the simplified copies go to. */
export async function simplify3DPolygonsDialog(): Promise<void> {
  const s = store.session;
  const ids = selected3DPolygons();
  if (!s || !ids.length) return;
  const units = s.doc.info.units;
  const tolerance = h("input", {
    cls: "menu-dialog-input",
    value: formatLengthValue(lastTolerance, units),
    attrs: { type: "text", inputmode: "decimal", "aria-label": "Simplification Tolerance" },
  });
  const suffix = lengthSuffix(units);
  const layers = s.doc.layers().filter((l) => l.kind === "design");
  const layer = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Put Simplified Result in Layer" } },
    ...layers.map((l) => h("option", { attrs: { translate: "no" }, value: l.id, text: l.name })),
  );
  layer.value = layers.some((l) => l.id === store.activeLayerId) ? store.activeLayerId! : (layers[0]?.id ?? "");
  const v = await showDialog<{ mm: number; layerId: string }>({
    title: "Simplify Selected 3D Polygons",
    okLabel: "OK",
    body: [
      h(
        "label",
        { cls: "menu-dialog-field" },
        h("span", { cls: "menu-dialog-label", text: "Simplification Tolerance" }),
        tolerance,
        suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
      ),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Put Simplified Result in Layer" }), layer),
      h("p", {
        cls: "muted",
        text: `Copies ${ids.length} 3D polygon${ids.length === 1 ? "" : "s"} to the layer, taking out the vertices that lie within the tolerance of the outline without them (0 takes out those in line); the originals stay as they are. Start and end vertices stay.`,
      }),
    ],
    check: () => {
      const mm = parseLength(tolerance.value, units);
      if (mm === null || mm < 0) return { error: "Simplification Tolerance: enter a length of 0 or more.", focus: tolerance };
      if (!layer.value) return { error: "This drawing has no design layer to put them on.", focus: layer };
      return { value: { mm, layerId: layer.value } };
    },
  });
  if (!v) return;
  lastTolerance = v.mm;
  const r = attempt("Simplify 3D Polygons", (s) =>
    s.batch(() => {
      const copies = s.pasteObjects(v.layerId, s.copyObjects(ids), 0, 0);
      return { copies, ...s.simplifyPolys(copies, "deviation", v.mm) };
    }),
  );
  if (!r) return;
  const { copies, removed } = r.value;
  if (v.layerId === store.activeLayerId) setSelection(copies);
  const name = layers.find((l) => l.id === v.layerId)?.name ?? "the layer";
  toast(`Copied ${copies.length} 3D polygon${copies.length === 1 ? "" : "s"} to ${name}, taking out ${removed} vert${removed === 1 ? "ex" : "ices"}.`, "info");
}
