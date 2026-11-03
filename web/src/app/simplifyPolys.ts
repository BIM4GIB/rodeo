// Modify > Drafting Aids > Simplify Polys…: fewer corner vertices in the selected polygons,
// polylines and 3D polygons (EditSession.simplifyPolys), by maximum deviation or minimum distance,
// the length typed in the document's units. The dialog keeps the last choice and lengths while
// the page is open; the objects stay selected, and a toast says how many vertices went.

import type { SimplifyBy } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** Vectorworks' polygon, polyline and 3D polygon object types */
const SIMPLIFIABLE = new Set([5, 21, 25]);

/** the last choice and lengths (mm) */
let last: { by: SimplifyBy; deviation: number; distance: number } = { by: "deviation", deviation: 0, distance: 0 };

/** The selected polygons, polylines and 3D polygons. */
function selectedPolys(): string[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].filter((id) => SIMPLIFIABLE.has(doc.object(id)?.type ?? -1));
}

/** True when the selection holds a polygon, polyline or 3D polygon. */
export function canSimplifyPolys(): boolean {
  return selectedPolys().length > 0;
}

/** The dialog, on the selection or on `given` (Tools > Check File Health's polygons, which may sit in groups). */
export async function simplifyPolysDialog(given?: readonly string[]): Promise<void> {
  const ids = given ? [...given] : selectedPolys();
  if (!ids.length) {
    toast("Simplify Polys works on polygons, polylines and 3D polygons.", "info");
    return;
  }
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);
  const option = (by: SimplifyBy, label: string, field: string, mm: number) => {
    const radio = h("input", { checked: last.by === by, attrs: { type: "radio", name: "simplify-by", value: by } });
    const input = h("input", {
      cls: "menu-dialog-input",
      value: formatLengthValue(mm, units),
      attrs: { type: "text", inputmode: "decimal", "aria-label": field },
    });
    const row = h(
      "label",
      { cls: "menu-dialog-field" },
      h("span", { cls: "menu-dialog-label", text: field }),
      input,
      suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
    );
    return { by, field, radio, input, nodes: [h("label", { cls: "menu-dialog-check" }, radio, label), row] };
  };
  const options = [
    option("deviation", "Maximum deviation", "Deviation", last.deviation),
    option("distance", "Minimum distance", "Distance", last.distance),
  ];
  const sync = (): void => options.forEach((o) => (o.input.disabled = !o.radio.checked));
  options.forEach((o) => o.radio.addEventListener("change", sync));
  sync();
  const v = await showDialog<{ by: SimplifyBy; mm: number }>({
    title: "Simplify Polys",
    okLabel: "Simplify",
    body: [
      h("p", {
        cls: "muted",
        text: `Takes corner vertices from ${ids.length}${given ? "" : " selected"} object${ids.length === 1 ? "" : "s"}: within the deviation the outline stays where it was (0 takes collinear vertices); those within the distance of a neighbour go (0 takes coincident ones). Start and end vertices and curves stay.`,
      }),
      ...options.flatMap((o) => o.nodes),
    ],
    check: () => {
      const o = options.find((x) => x.radio.checked) ?? options[0];
      // typed lengths are read in the document's units; the session takes millimetres
      const mm = parseLength(o.input.value, units);
      if (mm === null || mm < 0) return { error: `${o.field}: enter a length of 0 or more.`, focus: o.input };
      return { value: { by: o.by, mm } };
    },
  });
  if (!v) return;
  last = { ...last, by: v.by, [v.by]: v.mm };
  const r = attempt("Simplify Polys", (s) => s.simplifyPolys(ids, v.by, v.mm));
  if (!r) return;
  const { objects, removed } = r.value;
  if (removed === 0) toast(`No vertex goes at that ${v.by === "deviation" ? "deviation" : "distance"}.`, "info");
  else toast(`Took ${removed} vert${removed === 1 ? "ex" : "ices"} from ${objects} object${objects === 1 ? "" : "s"}.`, "info");
}
