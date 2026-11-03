// Site Planning's Existing Tree: a click places a tree (a press dragged turns it), its canopy, trunk,
// root zones and protection zone drawn as its Preferences say, numbered on from the last. Vectorworks
// makes a plug-in object with species data and 2D and 3D settings; this draws what it shows in
// Top/Plan as plain objects, grouped in the active class and named by the tree's number. A tree's
// number and names are in its group's name and its tag; nothing else of it is kept.

import { TEXT_LINE_HEIGHT, type Attributes, type NewShape, type Pt } from "../../core/index.ts";
import { colorMatcher } from "../pdfImport.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { existingTree, treeNumber, type Circle, type ExistingTree, type RootDisplay, type TreeAction, type TreeProtection } from "../treeShapes.ts";
import { PlaceTool, type Part } from "./detailing.ts";

const ACTIONS: readonly { readonly value: TreeAction; readonly label: string }[] = [
  { value: "retain", label: "Retain" },
  { value: "remove", label: "Remove" },
  { value: "transplant-original", label: "Transplant - Original location" },
  { value: "transplant-proposed", label: "Transplant - Proposed location" },
];
const ROOTS: readonly { readonly value: RootDisplay; readonly label: string }[] = [
  { value: "none", label: "None" },
  { value: "zones", label: "Critical and Primary Root Zones" },
  { value: "ball", label: "Root Ball" },
];
const PROTECTIONS: readonly { readonly value: TreeProtection; readonly label: string }[] = [
  { value: "none", label: "None" },
  { value: "circle", label: "Display Circular Zone" },
  { value: "dbh", label: "Display using 12x DBH" },
];
/** Rodeo's significance colours: the tree's fill, pale so its line work reads over it. */
const SIGNIFICANCE: readonly { readonly value: string; readonly label: string; readonly color: { r: number; g: number; b: number } | null }[] = [
  { value: "none", label: "None", color: null },
  { value: "low", label: "Low", color: { r: 0.8, g: 0.92, b: 0.76 } },
  { value: "moderate", label: "Moderate", color: { r: 1, g: 0.95, b: 0.7 } },
  { value: "high", label: "High", color: { r: 1, g: 0.82, b: 0.62 } },
  { value: "hazardous", label: "Hazardous", color: { r: 1, g: 0.68, b: 0.68 } },
];
/** the tag's text height on paper, mm */
const TAG_MM = 2.5;

/** the tool's settings, which Create Existing Trees from Loci starts from too */
export const treeSettings = {
  tree: {
    action: "retain",
    canopyMax: 6000,
    canopyMin: 6000,
    canopyRotate: 0,
    dbh: 400,
    roots: "none",
    critical: 0,
    primary: 0,
    ball: 1200,
    protection: "none",
    tpzRadius: 4800,
  } as ExistingTree,
  botanical: "",
  common: "",
  significance: "none",
  auto: true,
  prefix: "T",
  zeros: 0,
  /** the next number, when numbering on; else the tree's number as typed */
  next: 1,
  typed: "",
};

/** The number the next tree takes. */
export function nextTreeNumber(): string {
  return treeSettings.auto ? treeNumber(treeSettings.prefix, treeSettings.next, treeSettings.zeros) : treeSettings.typed;
}

/** A drawing's names are all different; a number already used (a transplant's two places) goes without. */
export function treeName(n: string, taken: ReadonlySet<string> = new Set()): string | undefined {
  if (!n) return undefined;
  const doc = store.session?.doc;
  const name = `Tree ${n}`;
  return taken.has(name) || doc?.layers().some((l) => doc.objects(l.id).some((o) => o.name === name)) ? undefined : name;
}

/** What a tree draws in plan, at a layer's scale; null if its settings can't make one. */
export function treeParts(d: { tree: ExistingTree; significance: string; common: string; botanical: string; number: string }, at: Pt, angle: number, scale: number): Part[] | null {
  const plan = existingTree(d.tree, at, angle);
  if (!plan) return null;
  const dashed = store.session?.doc.lineTypes().find((t) => t.dashes.length > 0);
  const dash: Partial<Attributes> = dashed ? { lineStyle: dashed.style } : {};
  const color = SIGNIFICANCE.find((s) => s.value === d.significance)?.color;
  const fill: Partial<Attributes> = color ? ((c) => ({ fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100 }))(colorMatcher()(color)) : { fillPattern: 0 };
  const circle = (c: Circle, attrs: Partial<Attributes>): Part => ({ shape: { kind: "arc", center: c.center, radius: c.radius, startAngle: 0, sweepAngle: 360 }, attrs });
  const ink = store.drawAttrs.penFore ?? colorMatcher()({ r: 0, g: 0, b: 0 });
  const original = d.tree.action === "transplant-original";
  const parts: Part[] = [
    { shape: { kind: "polygon", points: plan.canopy, closed: true }, attrs: { ...fill, ...(original ? dash : {}) } },
    // the zones go over the canopy's fill, since the roots' are mostly inside it
    ...(plan.protection ? [circle(plan.protection, { ...dash, fillPattern: 0 })] : []),
    ...plan.rootZones.map((z) => circle(z, { ...dash, fillPattern: 0 })),
    ...(plan.inner ? [{ shape: { kind: "polygon", points: plan.inner, closed: true } as NewShape, attrs: { fillPattern: 0 } }] : []),
    ...plan.cross.map((points): Part => ({ shape: { kind: "polyline", points, closed: false, vertices: points.map(() => "corner"), radii: points.map(() => 0) } })),
    circle(plan.trunk, { fillPattern: 1, fillFore: ink, fillBack: ink, fillOpacity: 100 }),
  ];
  const lines = [d.number, d.common, d.botanical].filter(Boolean);
  if (lines.length) {
    const height = TAG_MM * scale;
    const right = Math.max(...plan.canopy.map((p) => p.x));
    const top = at.y + (lines.length * height * TEXT_LINE_HEIGHT) / 2;
    parts.push({ kind: "text", at: { x: right + height, y: top }, text: lines.join("\r"), height, hAlign: 1, vAlign: 1 });
  }
  return parts;
}

export class ExistingTreeTool extends PlaceTool {
  readonly id = "existingtree";
  readonly cursor = "crosshair";
  protected readonly label = "Existing Tree";
  async preferences(): Promise<void> {
    const t = treeSettings.tree;
    const v = await toolPrefs(
      "Existing Tree Preferences",
      [
        { kind: "text", key: "botanical", label: "Botanical Name", value: treeSettings.botanical },
        { kind: "text", key: "common", label: "Common Name", value: treeSettings.common },
        { kind: "choice", key: "action", label: "Action", value: t.action, options: ACTIONS },
        { kind: "choice", key: "significance", label: "Significance", value: treeSettings.significance, options: SIGNIFICANCE.map(({ value, label }) => ({ value, label })) },
        { kind: "check", key: "auto", label: "Auto Number New Trees", value: treeSettings.auto },
        { kind: "text", key: "prefix", label: "New Tree Prefix", value: treeSettings.prefix },
        { kind: "number", key: "zeros", label: "Leading Zeros", value: treeSettings.zeros, min: 0, max: 6, integer: true },
        { kind: "number", key: "next", label: "Next Number", value: treeSettings.next, min: 1, max: 999999, integer: true },
        { kind: "text", key: "typed", label: "Tree No (not auto numbered)", value: treeSettings.typed },
        { kind: "length", key: "max", label: "Canopy Max. Diam", value: t.canopyMax },
        { kind: "check", key: "useMin", label: "Also Use Canopy Min. Diameter", value: t.canopyMin !== t.canopyMax },
        { kind: "length", key: "min", label: "Canopy Min. Diam", value: t.canopyMin },
        { kind: "number", key: "rotate", label: "Canopy Rotate", value: (t.canopyRotate * 180) / Math.PI, min: -360, max: 360, unit: "°" },
        { kind: "length", key: "dbh", label: "DBH", value: t.dbh },
        { kind: "choice", key: "roots", label: "Root Display", value: t.roots, options: ROOTS },
        { kind: "length", key: "critical", label: "Critical Root Diam (0: 2.5 x DBH)", value: t.critical, zero: true },
        { kind: "length", key: "primary", label: "Primary Root Diam (0: 5 x DBH)", value: t.primary, zero: true },
        { kind: "length", key: "ball", label: "Ball Diameter", value: t.ball },
        { kind: "choice", key: "protection", label: "Tree Protection", value: t.protection, options: PROTECTIONS },
        { kind: "length", key: "tpz", label: "TPZ Radius", value: t.tpzRadius },
      ],
      "Each tree is drawn in plan as plain objects; there is no species list, 3D tree or irregular zone.",
    );
    if (!v) return;
    const max = v.num("max");
    treeSettings.botanical = v.choice("botanical");
    treeSettings.common = v.choice("common");
    treeSettings.significance = v.choice("significance");
    treeSettings.auto = v.flag("auto");
    treeSettings.prefix = v.choice("prefix");
    treeSettings.zeros = v.num("zeros");
    treeSettings.next = v.num("next");
    treeSettings.typed = v.choice("typed");
    treeSettings.tree = {
      action: v.choice("action") as TreeAction,
      canopyMax: max,
      canopyMin: v.flag("useMin") ? v.num("min") : max,
      canopyRotate: (v.num("rotate") * Math.PI) / 180,
      dbh: v.num("dbh"),
      roots: v.choice("roots") as RootDisplay,
      critical: v.num("critical"),
      primary: v.num("primary"),
      ball: v.num("ball"),
      protection: v.choice("protection") as TreeProtection,
      tpzRadius: v.num("tpz"),
    };
  }

  protected override objectName(): string | undefined {
    return treeName(nextTreeNumber());
  }

  protected override afterPlacing(): void {
    if (treeSettings.auto) treeSettings.next++;
  }

  protected override refusal(): string {
    return "The tree needs a canopy and a DBH, and a canopy's minimum no more than its maximum.";
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    return treeParts({ ...treeSettings, number: nextTreeNumber() }, at, angle, scale);
  }
}
