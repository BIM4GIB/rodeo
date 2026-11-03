// AEC > Plants > Vegetation Line: a line round the outer edge of selected closed shapes and symbols,
// as they overlap, for a massed planting. Standard follows that edge, Cloud runs arcs along it. It's
// one polygon for each mass, in the drawing's attributes and active class, above what it goes round. A
// symbol or plant counts as the ellipse its box holds, since plants are mostly round; Vectorworks goes
// by their outlines.

import type { Pt } from "../core/index.ts";
import { attempt, selectionEntries, setSelection } from "./commands.ts";
import { appContext } from "./ext.ts";
import { ellipsePoints } from "./geom.ts";
import { store } from "./state.ts";
import { closedOutline, unionOf } from "./surfaces.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import { vegetationCloud, type VegetationCloud } from "./vegetationShapes.ts";

/** points round a symbol's ellipse */
const SYMBOL_STEPS = 48;

const last: { cloudy: boolean; deleteOriginal: boolean; cloud: VegetationCloud } = { cloudy: false, deleteOriginal: false, cloud: { minRadius: 300, maxRadius: 600, billow: 0.5 } };

/** The selection's outlines, as the line will take them. */
function outlines(): Pt[][] {
  const ctx = appContext();
  const doc = store.session?.doc;
  if (!ctx || !doc) return [];
  const out: Pt[][] = [];
  for (const { id, box } of selectionEntries(ctx.scene)) {
    const o = doc.object(id);
    if (!o) continue;
    const ring = o.shape ? closedOutline(o.shape) : null;
    if (ring) out.push(ring);
    else if (!o.shape && box.x1 > box.x0 && box.y1 > box.y0) {
      const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      out.push(ellipsePoints(c, (box.x1 - box.x0) / 2, (box.y1 - box.y0) / 2, 0, 360, SYMBOL_STEPS).slice(0, -1));
    }
  }
  return out;
}

export const canMakeVegetationLine = (): boolean => !!store.activeLayerId && store.selection.size > 0 && outlines().length > 0;

export async function vegetationLineDialog(): Promise<void> {
  const v = await toolPrefs(
    "Vegetation Line",
    [
      { kind: "choice", key: "type", label: "Type", value: last.cloudy ? "cloud" : "standard", options: [{ value: "standard", label: "Standard Vegetation Line" }, { value: "cloud", label: "Cloud Vegetation Line" }] },
      { kind: "length", key: "min", label: "Minimum Radius", value: last.cloud.minRadius },
      { kind: "length", key: "max", label: "Maximum Radius", value: last.cloud.maxRadius },
      { kind: "number", key: "billow", label: "Billow Height", value: last.cloud.billow, min: 0.05, max: 1 },
      { kind: "check", key: "delete", label: "Delete Original", value: last.deleteOriginal },
    ],
    "The items should overlap: each mass that doesn't gets its own line. Minimum Radius, Maximum Radius and Billow Height (1 is a half circle) are for the cloud.",
  );
  if (!v) return;
  last.cloudy = v.choice("type") === "cloud";
  last.cloud = { minRadius: v.num("min"), maxRadius: v.num("max"), billow: v.num("billow") };
  last.deleteOriginal = v.flag("delete");
  const layerId = store.activeLayerId;
  const rings = outlines();
  if (!layerId || rings.length === 0) return;
  if (last.cloudy && last.cloud.maxRadius < last.cloud.minRadius) {
    toast("The Maximum Radius can't be less than the Minimum Radius.", "info");
    return;
  }
  // the outer edge of each mass: a gap inside one isn't part of its line
  const edges = unionOf(rings).map((polygon) => polygon[0].slice(0, -1).map(([x, y]): Pt => ({ x, y })));
  const points = edges.map((edge) => (last.cloudy ? vegetationCloud(edge, last.cloud) : edge)).filter((p): p is Pt[] => p !== null && p.length >= 3);
  if (points.length === 0) {
    toast("Those objects have no area to go round.", "info");
    return;
  }
  const originals = [...store.selection];
  const r = attempt("Vegetation Line", (s) =>
    s.batch(() => {
      const made = points.map((pts) => s.addObject(layerId, { kind: "polygon", points: pts, closed: true }, store.activeClassIndex, store.drawAttrs));
      if (last.deleteOriginal) s.deleteObjects(originals);
      return made;
    }),
  );
  if (r) setSelection(r.value);
}
