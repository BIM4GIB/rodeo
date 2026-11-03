// AEC > Create Polys from Walls…, Vectorworks' command of that name: polygons from the selected
// walls, Gross Area Polys round the outside of each run of walls that meet, or Net Area (Room)
// Polys inside each room they close. Each wall is the area its plan drawing covers
// (EditSession.wallFootprints); those areas are joined with polygon-clipping, and a gross polygon
// is each joined area's outline, a net one each hole in it. The polygons go on the active layer in
// the active class with the attributes new objects are drawn with, selected, in one undo step; the
// walls stay as they are.

import type { Pt } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatArea } from "./units.ts";
import { ringArea, wallPolys } from "./wallPolys.ts";

/** Vectorworks' wall object type */
const WALL = 68;

/** the last choice: net (room) polygons, or gross */
let lastNet = false;

export function canCreatePolysFromWalls(): boolean {
  const doc = store.session?.doc;
  return !!doc && [...store.selection].some((id) => doc.object(id)?.type === WALL);
}

/** AEC > Create Polys from Walls…: Gross Area Polys or Net Area (Room) Polys from the selected walls. */
export async function createPolysFromWallsDialog(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || !canCreatePolysFromWalls()) return;
  const radio = (net: boolean): HTMLInputElement => h("input", { checked: lastNet === net, attrs: { type: "radio", name: "polys-from-walls", value: net ? "net" : "gross" } });
  const gross = radio(false);
  const net = radio(true);
  const ok = await showDialog<true>({
    title: "Create Polys from Walls",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-check" }, gross, "Gross Area Polys"),
      h("label", { cls: "menu-dialog-check" }, net, "Net Area (Room) Polys"),
      h("p", { cls: "muted", text: "Gross: round the outside of the walls. Net: inside each room the walls close." }),
    ],
    check: () => ({ value: true }),
  });
  if (!ok) return;
  lastNet = net.checked;
  let rings: Pt[][];
  try {
    rings = wallPolys(s.wallFootprints([...store.selection]), lastNet);
  } catch (e) {
    toast(`Create Polys from Walls: ${(e as Error).message}`, "error");
    return;
  }
  if (!rings.length) {
    toast(lastNet ? "These walls close no room." : "These walls have no area to go round.", "info");
    return;
  }
  const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const shapes = rings.map((points) => ({ kind: "polygon" as const, points, closed: true }));
  const r = attempt("Create Polys from Walls", (s) => s.addObjects(layerId, shapes, store.activeClassIndex, attrs));
  if (!r) return;
  setSelection(r.value);
  const total = rings.reduce((a, ring) => a + ringArea(ring), 0);
  const units = s.doc.info.units;
  toast(`Made ${r.value.length} ${lastNet ? "room" : "gross area"} polygon${r.value.length === 1 ? "" : "s"}, ${formatArea(total, units)} in all.`, "info");
}
