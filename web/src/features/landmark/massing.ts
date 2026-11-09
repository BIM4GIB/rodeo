// Landmark's Massing Model: a building shell from an outline (its path group's). A change to its height,
// floors or roof, or a Reshape, draws it again with Site Planning's own massing model (app/massingModel.ts),
// its parameters read as that one's, standing where Vectorworks stood it. Its gross area follows.

import type { EditSession, RecordValue } from "../../core/index.ts";
import { FIELD, redraw as drawShell, type Building } from "../../app/massingModel.ts";
import { formatArea } from "../../app/units.ts";
import type { LandmarkKind } from "./kinds.ts";
import { frameOf, MASSING, pathOf, type Params } from "./read.ts";

/** Landmark's tag display, as Site Planning's label choices */
const labelOf = (text: string): string => {
  const name = /name/i.test(text);
  const area = /area/i.test(text);
  return name && area ? "Name and Gross Area" : name ? "Name" : area ? "Gross Area" : "None";
};

/** mm² in the area unit the drawing's units show areas in, as Landmark keeps a gross area */
const AREA_UNITS: Readonly<Record<string, number>> = { "m²": 1e6, "sq ft": 92903.04, "sq yd": 836127.36, "sq mi": 1609344 * 1609344 };
const areaUnit = (units: string): number => AREA_UNITS[formatArea(1, units).replace(/^[^a-z]*/i, "")] ?? 1e6;

/** Rodeo's parameters, read from Landmark's */
function asBuilding(s: EditSession, p: Params): Building {
  const doc = s.doc;
  const world = pathOf(doc, p.id);
  if (!world || world.length < 3) throw new Error("A massing model needs an outline of three corners or more.");
  const corners = world.map(frameOf(doc, p.id).toLocal);
  const layer = doc.layers().find((l) => l.id === p.layerId);
  const base = (doc.heightsOf(p.id)?.min ?? 0) + (layer?.elevation ?? 0);
  const floors = Math.max(1, Math.round(p.num("NumFloors")));
  const values: Readonly<Record<string, RecordValue>> = {
    [FIELD.name]: p.text("Name"),
    [FIELD.show]: /foot/i.test(p.text("2Ddisplay")) ? "Footprint" : "Roof",
    [FIELD.label]: labelOf(p.text("TagDisplay")),
    [FIELD.base]: base,
    [FIELD.height]: p.num("Height"),
    [FIELD.floors]: floors,
    [FIELD.overhang]: p.num("Overhang"),
    [FIELD.thickness]: p.num("RoofThk"),
    [FIELD.pitched]: p.flag("DrawPitchedRoof"),
    [FIELD.eave]: p.text("EaveStyle") || "Square",
    [FIELD.slope]: p.num("RoofPitch") || 30,
    [FIELD.drawFloors]: p.flag("DrawFloorLevels"),
    [FIELD.slab]: p.num("FloorThk"),
    [FIELD.shadow]: p.flag("Use Shadow"),
    [FIELD.labelX]: p.num("ControlPoint01X"),
    [FIELD.labelY]: p.num("ControlPoint01Y"),
  };
  return {
    id: p.id,
    layerId: p.layerId,
    format: p.format,
    value: (field) => values[field],
    corners,
    gross: (s2, area) => s2.setRecordField(p.id, p.format, "Gross Area", Math.round((area / areaUnit(doc.info.units)) * 100) / 100),
  };
}

export const massingModel: LandmarkKind = {
  name: MASSING,
  note: "A Landmark massing model: reshaped, or its height, floors or roof changed, it is drawn again with Rodeo's massing model; until then it shows as Vectorworks drew it",
  groups: [
    { title: "Building", fields: ["Name", "Height", "NumFloors", "Floor Usage Data", "Gross Area", "WallMatl"] },
    { title: "Roof", fields: ["Custom Roof", "DrawPitchedRoof", "EaveStyle", "RoofPitch", "Overhang", "RoofThk", "RoofMatl"] },
    { title: "Floors", fields: ["DrawFloorLevels", "FloorThk"] },
    { title: "Display", fields: ["2Ddisplay", "TagDisplay", "Use Shadow"] },
    { title: "Site", fields: ["Use Site Modifiers", "Use Fence", "Fence offset"] },
  ],
  labels: {
    NumFloors: "Number of Floors",
    WallMatl: "Wall Material",
    DrawPitchedRoof: "Pitched Roof",
    EaveStyle: "Eave Style",
    RoofPitch: "Roof Pitch",
    RoofThk: "Roof Thickness",
    RoofMatl: "Roof Material",
    DrawFloorLevels: "Draw Floor Levels",
    FloorThk: "Floor Thickness",
    "2Ddisplay": "2D Display",
    TagDisplay: "Tag Display",
    "Use Fence": "Use Grade Limits",
    "Fence offset": "Grade Limits Offset",
  },
  computed: ["Gross Area"],
  choices: { EaveStyle: ["Square", "Vertical", "Horizontal"], "2Ddisplay": ["Roof", "Footprint"] },
  draws: ["Height", "NumFloors", "DrawPitchedRoof", "EaveStyle", "RoofPitch", "Overhang", "RoofThk", "DrawFloorLevels", "FloorThk", "2Ddisplay", "TagDisplay", "Name", "Use Shadow"],
  redraw: (s, p) => drawShell(s, asBuilding(s, p)),
  path: { closed: true },
};
