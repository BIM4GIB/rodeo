// Create Existing Trees from Loci's sums: which parameter of a tree a record's field looks like, and a
// tree's settings with a locus's record laid over them. Kept apart from the page (treesFromLoci.ts) so a
// check can run it. Lengths in mm.

import type { RecordField } from "../core/index.ts";
import type { ExistingTree, TreeAction } from "./treeShapes.ts";
import { parseLength } from "./units.ts";

export const TREE_PARAMETERS = [
  { id: "none", label: "None" },
  { id: "number", label: "Tree No" },
  { id: "botanical", label: "Botanical Name" },
  { id: "common", label: "Common Name" },
  { id: "action", label: "Action" },
  { id: "significance", label: "Significance" },
  { id: "canopyMax", label: "Canopy Max. Diam" },
  { id: "canopyMin", label: "Canopy Min. Diam" },
  { id: "canopyRotate", label: "Canopy Rotate" },
  { id: "dbh", label: "DBH" },
  { id: "critical", label: "Critical Root Diam" },
  { id: "primary", label: "Primary Root Diam" },
  { id: "ball", label: "Ball Diameter" },
  { id: "tpzRadius", label: "TPZ Radius" },
] as const;

export type TreeParameter = (typeof TREE_PARAMETERS)[number]["id"];

/** Units a field can be read in; Automatic goes by the drawing's. */
export const FIELD_UNITS = [
  { id: "auto", label: "None/Automatic", mm: 0 },
  { id: "mm", label: "Millimeters", mm: 1 },
  { id: "cm", label: "Centimeters", mm: 10 },
  { id: "m", label: "Meters", mm: 1000 },
  { id: "in", label: "Inches", mm: 25.4 },
  { id: "ft", label: "Feet", mm: 304.8 },
] as const;

export type FieldUnit = (typeof FIELD_UNITS)[number]["id"];

export interface FieldMapping {
  readonly field: string;
  readonly parameter: TreeParameter;
  readonly unit: FieldUnit;
}

/** A tree as far as a record can say. */
export interface TreeValues {
  readonly tree: ExistingTree;
  readonly botanical: string;
  readonly common: string;
  readonly significance: string;
  /** its number when the record gives one */
  readonly number: string | null;
}

const LOOKS_LIKE: readonly (readonly [RegExp, TreeParameter])[] = [
  [/^(tree[ _-]*)?(no|num|number|tag|id)$|tree[ _-]*(no|num|number|tag|id)|^tag/i, "number"],
  [/botan|species|latin|scientific/i, "botanical"],
  [/common/i, "common"],
  [/action|disposition|retain/i, "action"],
  [/signif/i, "significance"],
  [/(canopy|spread).*(min)|min.*(canopy|spread)/i, "canopyMin"],
  [/canopy.*rot|rot.*canopy/i, "canopyRotate"],
  [/canopy|spread|crown/i, "canopyMax"],
  [/dbh|trunk|calip|girth/i, "dbh"],
  [/critical/i, "critical"],
  [/primary/i, "primary"],
  [/ball/i, "ball"],
  [/tpz|protection/i, "tpzRadius"],
];

/** The parameter a field's name suggests. */
export function guessParameter(field: string): TreeParameter {
  return LOOKS_LIKE.find(([re]) => re.test(field))?.[1] ?? "none";
}

/** A length read from a field; null when there's no length in it. */
export function fieldLength(f: RecordField, unit: FieldUnit, docUnits: string | undefined): number | null {
  const scale = FIELD_UNITS.find((u) => u.id === unit)?.mm ?? 0;
  if (f.kind === "dimension" && unit === "auto" && typeof f.value === "number") return f.value;
  if (typeof f.value === "boolean") return null;
  const text = String(f.value ?? "").trim();
  if (!text) return null;
  const mm = scale ? (Number.isFinite(Number(text)) ? Number(text) * scale : parseLength(text, docUnits)) : parseLength(text, docUnits);
  return mm !== null && Number.isFinite(mm) ? mm : null;
}

function actionOf(text: string): TreeAction | null {
  const t = text.toLowerCase();
  if (t.includes("proposed")) return "transplant-proposed";
  if (t.includes("transplant") || t.includes("original")) return "transplant-original";
  if (t.includes("remov")) return "remove";
  if (t.includes("retain") || t.includes("keep")) return "retain";
  return null;
}

function significanceOf(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("hazard")) return "hazardous";
  for (const word of ["low", "moderate", "high", "none"]) if (t.includes(word)) return word;
  return null;
}

/** The tree the settings make with these fields laid over them; a field with nothing in it leaves the setting as it was. */
export function mappedTree(base: TreeValues, fields: readonly RecordField[], mappings: readonly FieldMapping[], docUnits: string | undefined): TreeValues {
  const tree: { -readonly [K in keyof ExistingTree]: ExistingTree[K] } = { ...base.tree };
  let { botanical, common, significance, number } = base;
  let minGiven = false;
  for (const m of mappings) {
    const f = fields.find((x) => x.name === m.field);
    if (!f || m.parameter === "none") continue;
    const text = typeof f.value === "boolean" ? "" : String(f.value ?? "").trim();
    const length = (): number | null => {
      const mm = fieldLength(f, m.unit, docUnits);
      return mm !== null && mm > 0 ? mm : null;
    };
    switch (m.parameter) {
      case "number":
        if (text) number = text;
        break;
      case "botanical":
        if (text) botanical = text;
        break;
      case "common":
        if (text) common = text;
        break;
      case "action":
        tree.action = actionOf(text) ?? tree.action;
        break;
      case "significance":
        significance = significanceOf(text) ?? significance;
        break;
      case "canopyRotate": {
        const deg = Number(text);
        if (text && Number.isFinite(deg)) tree.canopyRotate = (deg * Math.PI) / 180;
        break;
      }
      case "canopyMin": {
        const mm = length();
        if (mm !== null) {
          tree.canopyMin = mm;
          minGiven = true;
        }
        break;
      }
      default: {
        const mm = length();
        if (mm !== null) tree[m.parameter] = mm;
      }
    }
  }
  // a round tree's settings stay round with the record's canopy, and no minimum passes the maximum
  if (!minGiven && base.tree.canopyMin === base.tree.canopyMax) tree.canopyMin = tree.canopyMax;
  tree.canopyMin = Math.min(tree.canopyMin, tree.canopyMax);
  return { tree, botanical, common, significance, number };
}
