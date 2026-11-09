// Landmark's Hardscape and Landscape Area: paving and planting drawn from an outline (the path group's).
// Reshape moves its corners; then, or when a hardscape's border changes, it is drawn again Rodeo's way:
// its outline filled as Vectorworks filled it (its biggest filled shape's look), a border inside it,
// and in 3D a slab or bed as thick and as high as Vectorworks made it. Its areas and perimeters follow.

import type { Attributes, EditSession } from "../../core/index.ts";
import { nearColour } from "../../app/siteModel.ts";
import { hardscape as hardscapeShape } from "../../app/siteShapes.ts";
import { store } from "../../app/state.ts";
import type { LandmarkKind } from "./kinds.ts";
import { areaUnit, fillOf, frameOf, HARDSCAPE, LANDSCAPE_AREA, pathOf, type Params } from "./read.ts";
import { bedFace, perimeter, prismFaces, signedArea } from "./shapes.ts";

const COLOUR = { [HARDSCAPE]: "#b9b3a8", [LANDSCAPE_AREA]: "#9db67f" } as const;


/** Sets those of `values` it has, numbers as numbers and text as text. */
function setKnown(s: EditSession, p: Params, values: Readonly<Record<string, number>>): void {
  const rec = s.doc.records(p.id).find((r) => r.parametric);
  for (const [name, value] of Object.entries(values)) {
    const f = rec?.fields.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (!f) continue;
    s.setRecordField(p.id, p.format, f.name, typeof f.value === "string" ? String(Math.round(value * 100) / 100) : value);
  }
}

function redrawArea(s: EditSession, p: Params, kind: typeof HARDSCAPE | typeof LANDSCAPE_AREA): void {
  const doc = s.doc;
  const world = pathOf(doc, p.id);
  if (!world || world.length < 3) throw new Error(`A ${kind.toLowerCase()} needs an outline of three corners or more.`);
  const corners = world.map(frameOf(doc, p.id).toLocal);
  const classIndex = doc.object(p.id)?.classIndex ?? store.activeClassIndex;
  // what it looked like, before it goes
  const fill = fillOf(doc, p.id);
  const heights = doc.heightsOf(p.id);
  const border = kind === HARDSCAPE && p.flag("Use Border") ? p.num("Border Wid") : 0;
  const shape = hardscapeShape(corners, border, 0, 0) ?? hardscapeShape(corners, 0, 0, 0);
  if (!shape) throw new Error(`A ${kind.toLowerCase()} needs an outline with some area.`);
  const look: Partial<Attributes> = fill ?? { fillPattern: 1 };
  const ids = [s.addObject(p.layerId, { kind: "polygon", points: shape.outline, closed: true }, classIndex, { ...store.drawAttrs, ...look })];
  if (shape.inner) ids.push(s.addObject(p.layerId, { kind: "polygon", points: shape.inner, closed: true }, classIndex, { ...store.drawAttrs, ...look, fillPattern: 0 }));
  if (heights) {
    const solid = fill && fill.fillPattern === 1 ? fill.fillBack : nearColour(doc)(COLOUR[kind]);
    const faces = heights.max - heights.min > 1 ? prismFaces(shape.outline, heights.min, heights.max) : bedFace(shape.outline, heights.max);
    ids.push(...s.addMeshes(p.layerId, [faces], classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: solid, fillBack: solid, fillOpacity: 100, lineStyle: 0 }));
  }
  s.setPluginDrawing(p.id, ids);
  const area = shape.area;
  const main = shape.inner ? Math.abs(signedArea(shape.inner)) : area;
  if (kind === HARDSCAPE) {
    setKnown(s, p, {
      "Footprint Area": area,
      "Main Area": main,
      "Border Area": area - main,
      Perimeter: perimeter(shape.outline),
      "Main Perimeter": perimeter(shape.inner ?? shape.outline),
      "Border Perimeter": shape.inner ? perimeter(shape.outline) : 0,
    });
  } else {
    const unit = areaUnit(p.text("areaUnits"));
    setKnown(s, p, { area: area / unit, projectedArea: area / unit });
  }
}

export const hardscape: LandmarkKind = {
  name: HARDSCAPE,
  note: "A Landmark hardscape: reshaped, or its border changed, it is drawn again Rodeo's way and its areas follow; until then it shows as Vectorworks drew it",
  groups: [
    { title: "Hardscape", fields: ["ID", "Configuration", "isPathway", "Path Wid", "Path Offset"] },
    { title: "Quantities", fields: ["Footprint Area", "Main Area", "Border Area", "Perimeter", "Main Perimeter", "Border Perimeter"] },
    { title: "Border", fields: ["Use Border", "Border Wid", "Border Thick", "Bord Spacing"] },
    { title: "3D", fields: ["Draw 3D", "Slab Thick", "Mode 3D", "Site Mod", "Use Site Modifier", "Site Model Interaction"] },
    { title: "Cost", fields: ["Main Unit Price", "Main Price Code", "Border Unit Price", "Border Price Code"] },
    { title: "Tag", fields: ["Tag Display", "Tag Style"] },
  ],
  labels: {
    isPathway: "Pathway",
    "Path Wid": "Path Width",
    "Border Wid": "Border Width",
    "Border Thick": "Border Thickness",
    "Bord Spacing": "Border Joint Spacing",
    "Slab Thick": "Slab Thickness",
    "Site Mod": "Site Modifier",
  },
  computed: ["Footprint Area", "Main Area", "Border Area", "Perimeter", "Main Perimeter", "Border Perimeter"],
  draws: ["Use Border", "Border Wid"],
  redraw: (s, p) => redrawArea(s, p, HARDSCAPE),
  path: { closed: true },
};

export const landscapeArea: LandmarkKind = {
  name: LANDSCAPE_AREA,
  note: "A Landmark landscape area: reshaped, it is drawn again Rodeo's way and its area follows; until then it shows as Vectorworks drew it",
  groups: [
    { title: "Landscape Area", fields: ["name", "ID", "Category", "Description"] },
    { title: "Quantities", fields: ["area", "projectedArea", "areaUnits", "Area Vertex Count", "numPlants", "numAttachedPlants"] },
    { title: "Planting", fields: ["percRate", "percType", "distRate", "showPlants2D", "showPlants3D", "diameterScalePopup", "heightScalePopup", "randomizePlantRotation", "randomizePlantPosition"] },
    { title: "Border", fields: ["borderStyle", "billowSize", "billowVar", "billowHeight", "billowType", "segLength", "segThickness"] },
    { title: "3D", fields: ["3dDisplay", "displayComponents3D", "displayAs3DPolygon", "displayOnExisting", "Cut into Site Model", "Use Component Texture", "siteModelLayer"] },
    { title: "Sustainability", fields: ["IsPermeable", "RunoffCoef", "Permeability", "Permeability Unit", "Sustainability Metric", "SRI"] },
    { title: "Cost", fields: ["unitPrice", "priceCode"] },
    { title: "Tag", fields: ["tagDisplay", "tagHeader", "tagBody"] },
  ],
  labels: {
    name: "Name",
    area: "Area",
    projectedArea: "Projected Area",
    areaUnits: "Area Units",
    numPlants: "Plants",
    numAttachedPlants: "Attached Plants",
    percRate: "Rate",
    percType: "Rate Type",
    distRate: "Distribute by Rate",
    borderStyle: "Border Style",
    "3dDisplay": "3D Display",
    IsPermeable: "Permeable",
    RunoffCoef: "Runoff Coefficient",
    unitPrice: "Unit Price",
    priceCode: "Price Code",
    tagDisplay: "Tag Display",
  },
  computed: ["area", "projectedArea", "Area Vertex Count", "numPlants", "numAttachedPlants"],
  redraw: (s, p) => redrawArea(s, p, LANDSCAPE_AREA),
  path: { closed: true },
};

