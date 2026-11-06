// Landmark: Vectorworks' site and landscape objects in drawings it saved. Object Info shows their
// data a group at a time and keeps changes in their parameters; plants, existing trees, hardscapes,
// landscape areas and massing models draw again when a change alters what they draw (kinds.ts).
// Tools > Reports makes plant, tree and area schedules of them (schedules.ts). How they look as
// Vectorworks drew them is core's (model.ts, model3d.ts). Registered with app/ext.ts when imported.

import { registerMenu, registerPluginDrivers } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { hardscape, landscapeArea } from "./areas.ts";
import { landmarkDriver, type LandmarkKind } from "./kinds.ts";
import { massingModel } from "./massing.ts";
import { plant } from "./plant.ts";
import { EXISTING_TREE, HARDSCAPE, LANDSCAPE_AREA, LAUBWERK, MASSING, PLANT } from "./read.ts";
import { areaQuantities, plantSchedule, treeSchedule } from "./scheduleRows.ts";
import { hasAny, makeSchedule } from "./schedules.ts";
import { existingTree } from "./tree.ts";

const SHOWN = "it shows as Vectorworks drew it, and its parameters are kept for Vectorworks";

const laubwerk: LandmarkKind = {
  name: LAUBWERK,
  note: `A Laubwerk plant: ${SHOWN}`,
  groups: [
    { title: "Plant", fields: ["botanical name", "common name", "variant", "qualifier", "qualifier is global"] },
    { title: "Display", fields: ["2drep", "3drep", "material", "rep is global"] },
  ],
  labels: {
    "botanical name": "Botanical Name",
    "common name": "Common Name",
    variant: "Variant",
    qualifier: "Season",
    "qualifier is global": "Season from Document",
    "2drep": "2D Display",
    "3drep": "3D Display",
    material: "Material",
    "rep is global": "Display from Document",
  },
};

const hedgerow: LandmarkKind = {
  name: "Hedgerow",
  note: `A Landmark hedgerow: ${SHOWN}`,
  groups: [
    { title: "Hedge", fields: ["Height", "Offset", "Align", "SmoothCorners", "Closed"] },
    { title: "Quantities", fields: ["Hedge length", "Total Plants", "Perimeter", "Area", "VertexCount"] },
    { title: "Planting", fields: ["PlantDensity", "Density", "Rate", "PlantNumber"] },
    { title: "Border", fields: ["BorderStyle", "BillowSize", "BillowVar", "BillowHeight", "BillowType", "SegmentLength", "SegmentThickness"] },
  ],
  labels: { SmoothCorners: "Smooth Corners", "Hedge length": "Hedge Length", "Total Plants": "Total Plants", PlantDensity: "Plant Density", PlantNumber: "Plant Kinds" },
  computed: ["Hedge length", "Total Plants", "Perimeter", "Area", "VertexCount"],
};

const drivers = [existingTree, plant, hardscape, landscapeArea, massingModel, laubwerk, hedgerow].map(landmarkDriver);
registerPluginDrivers(() => drivers);

registerMenu("Tools › Reports", () => {
  const doc = store.session?.doc;
  return [
    { label: "Plant Schedule", enabled: () => hasAny(doc, PLANT, LAUBWERK), run: () => makeSchedule(plantSchedule) },
    { label: "Existing Tree Schedule", enabled: () => hasAny(doc, EXISTING_TREE), run: () => makeSchedule(treeSchedule) },
    { label: "Landscape Quantities", enabled: () => hasAny(doc, LANDSCAPE_AREA, HARDSCAPE, MASSING), run: () => makeSchedule(areaQuantities) },
  ];
});
