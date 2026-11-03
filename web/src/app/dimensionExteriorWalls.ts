// AEC > Dimension Exterior Walls…, Vectorworks' command of that name: chains of dimensions round the
// buildings the walls on a layer make, on all four sides (exteriorDims.ts lays them out): the doors
// and windows, the walls' corners and jogs, and the overall size, each chain further out. The
// dimensions are the Dimension tool's (dimension objects copying one the drawing has, else plain
// lines and text), on the walls' layer in the Dimension class when there is one, each chain grouped,
// selected after, in one undo step. Small spans are drawn in red or left out.

import { attempt, setSelection } from "./commands.ts";
import { frameLayout, linearDrawing, dimensionValue, type DimensionFrame } from "./dimension.ts";
import { exteriorChains, type ExteriorOptions, type ExteriorWall } from "./exteriorDims.ts";
import { colorMatcher } from "./pdfImport.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import { addDimensionDrawings, dimensionClass } from "./tools/dimension.ts";
import { millimetresPerUnit } from "./units.ts";

/** Vectorworks' wall object type */
const WALL = 68;

let last: ExteriorOptions | null = null;

/** The design layers holding walls, the active one first. */
function wallLayers(): { id: string; name: string; scale: number }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const layers = doc.layers().filter((l) => l.kind === "design" && doc.objects(l.id).some((o) => o.type === WALL));
  return layers.sort((a, b) => Number(b.id === store.activeLayerId) - Number(a.id === store.activeLayerId)).map((l) => ({ id: l.id, name: l.name, scale: l.scale || 1 }));
}

export const canDimensionExteriorWalls = (): boolean => wallLayers().length > 0;

/** AEC > Dimension Exterior Walls…. */
export async function dimensionExteriorWalls(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const layers = wallLayers();
  if (!layers.length) {
    toast("Dimension Exterior Walls: no design layer holds walls.", "info");
    return;
  }
  const perUnit = millimetresPerUnit(s.doc.info.units);
  const ft = perUnit === 25.4 || perUnit === 304.8;
  const scale = layers[0].scale;
  // 10, 20 and 30 mm out on paper; a span under an inch (or 20 mm) small
  const d: ExteriorOptions = last ?? { to: "faces", openings: "edges", tees: false, offsets: { openings: 10 * scale, walls: 20 * scale, overall: 30 * scale }, small: ft ? 25.4 : 20, smallMode: "red" };
  const v = await toolPrefs(
    "Dimension Exterior Walls",
    [
      { kind: "choice", key: "layer", label: "Source Layer", value: layers[0].id, options: layers.map((l) => ({ value: l.id, label: l.name })), wide: true },
      { kind: "heading", key: "options", label: "Options" },
      { kind: "check", key: "tees", label: "Dimension T-joins in exterior walls", value: d.tees },
      { kind: "choice", key: "to", label: "Dimension to", value: d.to, options: [{ value: "faces", label: "Outer Sides" }, { value: "centerlines", label: "Centerlines" }] },
      { kind: "choice", key: "openings", label: "Dimension to Openings", value: d.openings, options: [{ value: "edges", label: "Edges" }, { value: "centers", label: "Centers" }] },
      { kind: "heading", key: "offsets", label: "Offsets from Building" },
      { kind: "length", key: "offOpenings", label: "Openings", value: d.offsets.openings },
      { kind: "length", key: "offWalls", label: "Walls", value: d.offsets.walls },
      { kind: "length", key: "offOverall", label: "Overall", value: d.offsets.overall },
      { kind: "heading", key: "smallHead", label: "Small Dimensions" },
      { kind: "length", key: "small", label: "Smaller than", value: d.small, zero: true },
      { kind: "choice", key: "smallMode", label: "Small ones", value: d.smallMode, options: [{ value: "red", label: "Draw in red" }, { value: "skip", label: "Do not draw" }] },
    ],
    "Every building the walls on the layer make is dimensioned on all four sides along its own directions: its doors and windows nearest, then its corners and jogs, then its overall size, each chain left out when it would say no more than the next. Red marks spans shorter than the limit, which often show a misaligned wall.",
  );
  if (!v || store.session !== s) return;
  const o: ExteriorOptions = {
    to: v.choice("to") === "centerlines" ? "centerlines" : "faces",
    openings: v.choice("openings") === "centers" ? "centers" : "edges",
    tees: v.flag("tees"),
    offsets: { openings: v.num("offOpenings"), walls: v.num("offWalls"), overall: v.num("offOverall") },
    small: v.num("small"),
    smallMode: v.choice("smallMode") === "skip" ? "skip" : "red",
  };
  if (!(o.offsets.openings < o.offsets.walls && o.offsets.walls < o.offsets.overall) || o.offsets.openings <= 0) {
    toast("Dimension Exterior Walls: the offsets go outward: Openings, then Walls, then Overall, each further than the one before.", "info");
    return;
  }
  last = o;
  const layerId = v.choice("layer");
  const layerScale = layers.find((l) => l.id === layerId)?.scale ?? 1;
  const doc = s.doc;
  const walls: ExteriorWall[] = [];
  for (const obj of doc.objects(layerId)) {
    const w = obj.type === WALL ? doc.wall(obj.id) : null;
    if (!w) continue;
    const footprint = s.wallFootprints([obj.id])[0];
    if (!footprint) continue;
    walls.push({ start: w.start, end: w.end, footprint, openings: s.wallOpenings(obj.id) });
  }
  const chains = exteriorChains(walls, o);
  if (typeof chains === "string") {
    toast(`Dimension Exterior Walls: ${chains}.`, "info");
    return;
  }
  const classIndex = dimensionClass(doc) ?? store.activeClassIndex;
  const attrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const red = colorMatcher()({ r: 1, g: 0, b: 0 });
  let small = 0;
  const r = attempt("Dimension Exterior Walls", (session) =>
    session.batch(() =>
      chains.map((c) => {
        const frame: DimensionFrame = Math.abs(c.u.y) < 1e-12 ? { axis: "horizontal", u: { x: 1, y: 0 } } : Math.abs(c.u.x) < 1e-12 ? { axis: "vertical", u: { x: 0, y: 1 } } : { axis: "aligned", u: c.u };
        const spans = c.points.slice(1).flatMap((b, i) => {
          const layout = frameLayout(c.points[i], b, c.at, frame, layerScale);
          return layout ? [{ drawing: linearDrawing(layout, dimensionValue(layout.length, doc.info.units)), small: c.small[i] }] : [];
        });
        if (!spans.some((x) => x.small)) return addDimensionDrawings(session, layerId, spans.map((x) => x.drawing), classIndex, attrs);
        // a small span on its own, in red
        const ids = spans.map((x) => {
          const id = addDimensionDrawings(session, layerId, [x.drawing], classIndex, x.small ? { ...attrs, penFore: red } : attrs);
          if (x.small) {
            session.setAttributes([id], { penFore: red });
            small++;
          }
          return id;
        });
        return session.groupObjects(ids);
      }),
    ),
  );
  if (!r) return;
  setSelection(r.value);
  toast(`Dimension Exterior Walls: ${r.value.length} chains of dimensions${small ? `, ${small} small ${small === 1 ? "span" : "spans"} in red` : ""}.`, "info");
}
