// Landmark's Existing Tree: a surveyed tree, its species, size, condition and what's to be done with it.
// Drawn again Rodeo's way when its size, zones or action change: in plan as Site Planning's Existing Tree
// tool draws one (app/tools/existingTree.ts), in 3D a trunk to the first branch and a round canopy over it,
// standing where Vectorworks stood it.

import type { EditSession } from "../../core/index.ts";
import { nearColour } from "../../app/siteModel.ts";
import { layerScaleOf } from "../../app/spaces.ts";
import { store } from "../../app/state.ts";
import { addPart } from "../../app/tools/detailing.ts";
import { treeParts } from "../../app/tools/existingTree.ts";
import { protectionRadius, type ExistingTree, type RootDisplay, type TreeAction, type TreeProtection } from "../../app/treeShapes.ts";
import type { LandmarkKind } from "./kinds.ts";
import { EXISTING_TREE, fillOf, paramsOf, type Params } from "./read.ts";
import { canopyFaces, trunkFaces } from "./shapes.ts";

/** Landmark's actions, root displays and protection zones, as its popups name them */
const ACTIONS = ["Retain", "Remove", "Transplant - Original location", "Transplant - Proposed location"];
const ROOTS = ["None", "Critical and Primary Root Zones", "Root Ball"];
const PROTECTIONS = ["None", "Display Circular Zone", "Display Using 12 x DBH"];

const COLOUR = { canopy: "#7f9f6a", trunk: "#7a5c43" } as const;

const actionOf = (text: string): TreeAction =>
  /remove/i.test(text) ? "remove" : /transplant/i.test(text) ? (/proposed|new/i.test(text) ? "transplant-proposed" : "transplant-original") : "retain";
const rootsOf = (text: string): RootDisplay => (/ball/i.test(text) ? "ball" : /zone/i.test(text) ? "zones" : "none");
const protectionOf = (text: string): TreeProtection => (/dbh|12/i.test(text) ? "dbh" : /circ|zone/i.test(text) ? "circle" : "none");
/** Rodeo's significance fills, by the words Landmark's significance uses */
const significanceOf = (text: string): string =>
  /hazard/i.test(text) ? "hazardous" : /high/i.test(text) ? "high" : /low|not/i.test(text) ? "low" : /signif|moderate/i.test(text) ? "moderate" : "none";

export function treeOf(p: Params): ExistingTree {
  const canopy = p.num("Canopy");
  const narrow = p.flag("UseCanopyMin") ? p.num("CanopyMin") : canopy;
  return {
    action: actionOf(p.text("ActionComment")),
    canopyMax: Math.max(canopy, narrow),
    canopyMin: Math.min(canopy, narrow),
    canopyRotate: (p.num("CanopyRotate") * Math.PI) / 180,
    dbh: p.num("Calliper"),
    roots: rootsOf(p.text("RootZones")),
    critical: p.num("CriticalRootZone"),
    primary: p.num("PrimaryRootZone"),
    ball: p.num("RootBall"),
    protection: protectionOf(p.text("DisplayTPZ")),
    tpzRadius: p.num("TPZCornerRadius"),
  };
}

function redraw(s: EditSession, p: Params): void {
  const doc = s.doc;
  const o = doc.object(p.id);
  const classIndex = o?.classIndex ?? store.activeClassIndex;
  const tree = treeOf(p);
  // in its own frame: the trunk at its origin, unturned
  const at = { x: 0, y: 0 };
  // its canopy filled as Vectorworks filled it, else by its significance as Rodeo's tool fills one
  const fill = fillOf(doc, p.id);
  const significance = fill ? "none" : significanceOf(p.text("Significance"));
  const drawn = treeParts({ tree, significance, common: "", botanical: "", number: p.text("Tree No") }, at, 0, layerScaleOf(p.layerId));
  if (!drawn) throw new Error("An existing tree needs a canopy and a calliper.");
  // the canopy comes first
  const parts = fill ? drawn.map((part, i) => (i === 0 && "shape" in part ? { ...part, attrs: { ...part.attrs, fillPattern: fill.fillPattern, fillFore: fill.fillFore, fillBack: fill.fillBack, fillOpacity: fill.fillOpacity } } : part)) : drawn;
  // where Vectorworks stood it, before it goes
  const base = doc.heightsOf(p.id)?.min ?? 0;
  const ids = parts.map((part) => addPart(s, p.layerId, "shape" in part ? { ...part, classIndex } : { shape: part, classIndex }));
  const height = p.num("Height");
  if (p.flag("Create 3D") && height > 0) {
    const branch = Math.min(p.num("Hgt First Branch") || height / 3, height * 0.9);
    const colour = nearColour(doc);
    const solid = (css: string) => ((c) => ({ ...store.drawAttrs, fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100, lineStyle: 0 }))(colour(css));
    const trunk = trunkFaces(at, tree.dbh / 2, base, base + branch + (height - branch) / 2);
    const canopy = canopyFaces(at, tree.canopyMax / 2, tree.canopyMin / 2, tree.canopyRotate, base + branch, base + height);
    if (trunk.length) ids.push(...s.addMeshes(p.layerId, [trunk], classIndex, solid(COLOUR.trunk)));
    if (canopy.length) ids.push(...s.addMeshes(p.layerId, [canopy], classIndex, solid(COLOUR.canopy)));
  }
  s.setPluginDrawing(p.id, ids);
}

/** Its protection zone's area follows its radius, in the units Landmark gave it. */
function follow(s: EditSession, before: Params): void {
  const after = paramsOf(s.doc, before.id, EXISTING_TREE);
  const was = protectionRadius(treeOf(before));
  const now = after ? protectionRadius(treeOf(after)) : 0;
  const area = Number(before.text("TPZArea"));
  if (!after || was === now || !(was > 0) || !(area > 0)) return;
  s.setRecordField(before.id, before.format, "TPZArea", ((area * now * now) / (was * was)).toFixed(2));
}

export const existingTree: LandmarkKind = {
  name: EXISTING_TREE,
  note: "A Landmark existing tree: a change to its size, zones or action draws it again Rodeo's way; until then it shows as Vectorworks drew it",
  groups: [
    { title: "Tree", fields: ["Tree No", "Genus Species", "Common Name", "Origin", "Age", "Year Planted", "Location", "RL"] },
    { title: "Size", fields: ["Height", "Hgt First Branch", "Canopy", "UseCanopyMin", "CanopyMin", "CanopyRotate", "Calliper", "DiamAtButtress"] },
    { title: "Assessment", fields: ["Condition", "Form", "Structure", "Vigor", "SULE", "Significance", "ActionComment", "DateAssessed", "Comments"] },
    { title: "Roots and Protection", fields: ["RootZones", "RootBall", "CriticalRootZone", "PrimaryRootZone", "StructuralRootZone", "CalculatedSRZ", "MinSRZRadius", "DisplayTPZ", "TPZCornerRadius", "TPZArea"] },
    { title: "Display", fields: ["Create 3D"] },
  ],
  labels: {
    "Genus Species": "Botanical Name",
    Calliper: "DBH",
    DiamAtButtress: "Diam. at Buttress",
    "Hgt First Branch": "Height to First Branch",
    UseCanopyMin: "Use Canopy Min. Diameter",
    CanopyMin: "Canopy Min. Diameter",
    CanopyRotate: "Canopy Rotation",
    Canopy: "Canopy Diameter",
    SULE: "Safe Useful Life Expectancy",
    ActionComment: "Action",
    RootZones: "Root Display",
    RootBall: "Root Ball Diameter",
    CriticalRootZone: "Critical Root Zone Diam.",
    PrimaryRootZone: "Primary Root Zone Diam.",
    StructuralRootZone: "Show Structural Root Zone",
    CalculatedSRZ: "Structural Root Zone",
    MinSRZRadius: "Min. SRZ Radius",
    DisplayTPZ: "Tree Protection",
    TPZCornerRadius: "TPZ Radius",
    TPZArea: "TPZ Area",
    DateAssessed: "Date Assessed",
    RL: "Reduced Level",
  },
  computed: ["TPZArea", "CalculatedSRZ"],
  choices: { ActionComment: ACTIONS, RootZones: ROOTS, DisplayTPZ: PROTECTIONS },
  draws: ["Tree No", "Height", "Hgt First Branch", "Canopy", "UseCanopyMin", "CanopyMin", "CanopyRotate", "Calliper", "RootZones", "RootBall", "CriticalRootZone", "PrimaryRootZone", "DisplayTPZ", "TPZCornerRadius", "ActionComment", "Significance", "Create 3D"],
  redraw,
  follow,
};
