// Landmark's Plant: one plant or a mass of them (a symbol each), with the Plant Record a plant schedule
// reads. Its ID and names are copied into its Plant Record as they change, its spread and height scaled
// there. A change of spread or height draws its plants again Rodeo's way where they stand: in plan as
// Site Planning's Plant tool draws one, in 3D a round canopy, on the ground Vectorworks stood them on.

import type { EditSession, RecordValue } from "../../core/index.ts";
import { plantPlan } from "../../app/detailShapes.ts";
import { nearColour } from "../../app/siteModel.ts";
import { store } from "../../app/state.ts";
import { drawn } from "../../app/tools/detailing.ts";
import type { LandmarkKind } from "./kinds.ts";
import { PLANT, PLANT_RECORD, plantSpots, type Params } from "./read.ts";
import { canopyFaces } from "./shapes.ts";

const COLOUR = "#7f9f6a";

/** a plant's parameters and what its Plant Record calls them */
const COPIED: Readonly<Record<string, string>> = { "plant id": "ID", "latin name": "Latin Name", "common name": "Common Name" };
/** those the record keeps in its own units: scaled with the parameter */
const SCALED: Readonly<Record<string, string>> = { spread: "Spread", height: "Height", spacing: "Spacing" };


function redraw(s: EditSession, p: Params): void {
  const doc = s.doc;
  const spread = p.num("spread");
  if (!(spread > 0)) throw new Error("A plant needs a spread.");
  const classIndex = doc.object(p.id)?.classIndex ?? store.activeClassIndex;
  const spots = plantSpots(p, doc);
  const base = doc.heightsOf(p.id)?.min ?? 0;
  const shapes = spots.flatMap((at) => drawn(plantPlan(at, spread, "scalloped")!));
  const ids = s.addObjects(p.layerId, shapes, classIndex);
  const height = p.num("height");
  if (height > 0) {
    const c = nearColour(doc)(COLOUR);
    const faces = spots.flatMap((at) => canopyFaces(at, spread / 2, spread / 2, 0, base, base + height));
    ids.push(...s.addMeshes(p.layerId, [faces], classIndex, { ...store.drawAttrs, fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100, lineStyle: 0 }));
  }
  s.setPluginDrawing(p.id, ids);
}

/** Its Plant Record follows its ID and names, and its sizes by the same share. */
function follow(s: EditSession, before: Params, values: Readonly<Record<string, RecordValue>>): void {
  const rec = s.doc.records(before.id).find((r) => !r.parametric && r.name === PLANT_RECORD);
  if (!rec) return;
  const field = (name: string) => rec.fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
  for (const [name, value] of Object.entries(values)) {
    const key = name.toLowerCase();
    const copied = COPIED[key] ? field(COPIED[key]) : undefined;
    if (copied) s.setRecordField(before.id, rec.format, copied.name, String(value));
    const scaled = SCALED[key] ? field(SCALED[key]) : undefined;
    const was = before.num(name);
    if (scaled && was > 0 && typeof scaled.value === "number") s.setRecordField(before.id, rec.format, scaled.name, (scaled.value * Number(value)) / was);
  }
}

export const plant: LandmarkKind = {
  name: PLANT,
  note: "A Landmark plant: its ID and names follow into its Plant Record; a change to its spread or height draws its plants again Rodeo's way where they stand",
  groups: [
    { title: "Plant", fields: ["plant ID", "latin name", "common name", "PlantDescription", "comments", "onPlantList"] },
    { title: "Size", fields: ["spread", "height", "PlantScale", "Plant height scale"] },
    { title: "Placement", fields: ["config", "Plant spacing mode", "spacing", "Spacing mode", "Row spacing mode", "Row spacing", "Rate mode", "Rate", "Percentage", "Plants per row", "Plants per column", "Hedge", "Hedge rows"] },
    { title: "Schedule", fields: ["quantity measure", "SKU", "Price"] },
    { title: "Display", fields: ["plant style", "tag display", "poly display", "Outline", "Show 3D Detail"] },
  ],
  labels: {
    "plant ID": "Plant ID",
    "latin name": "Latin Name",
    "common name": "Common Name",
    PlantDescription: "Description",
    comments: "Comments",
    onPlantList: "On Plant List",
    spread: "Spread",
    height: "Height",
    PlantScale: "Spread Scale",
    "Plant height scale": "Height Scale",
    config: "Configuration",
    "Plant spacing mode": "Spacing Mode",
    spacing: "Spacing",
    "quantity measure": "Quantity Measure",
    "plant style": "Plant Style",
    "tag display": "Tag Display",
    "poly display": "Outline Display",
    "Show 3D Detail": "Show 3D Detail",
  },
  draws: ["spread", "height"],
  redraw,
  follow,
};
