// Site Planning's Hedgerow (hedgerowShapes.ts): click each corner of its path; a double-click or
// Enter ends it open, a click on the first corner closes it into a ring. Vectorworks makes a
// plug-in object of it from plant styles; this draws what it shows in Top/Plan, as plain 2D objects
// grouped in the active class, and reports its length and how many of each plant it takes. Esc
// cancels.

import type { Pt } from "../../core/index.ts";
import { dist, signedArea } from "../geom.ts";
import { hedgerow, parsePlants, plantCounts, plantsText, type HedgeAlign, type HedgeBorder, type Hedgerow, type HedgerowPlan } from "../hedgerowShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { formatArea, formatLength, unitLabel } from "../units.ts";
import type { Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

const ALIGNS: readonly { readonly value: HedgeAlign; readonly label: string }[] = [
  { value: "centre", label: "Center" },
  { value: "left", label: "Left of the path" },
  { value: "right", label: "Right of the path" },
];
const BORDERS: readonly { readonly value: HedgeBorder; readonly label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "cloud", label: "Plant Cloud" },
  { value: "line", label: "Plant Line" },
];
const BILLOWS: readonly { readonly value: string; readonly label: string }[] = [
  { value: "convex", label: "Convex" },
  { value: "concave", label: "Concave" },
];
const IMPERIAL = new Set(["in", "ft", "yd", "mi"]);

const units = (): string | undefined => store.session?.doc.info.units;
/** the density's unit: a foot in imperial drawings, a metre in the rest, in mm */
const densityUnit = (): { readonly mm: number; readonly name: string } => (IMPERIAL.has(unitLabel(units())) ? { mm: 304.8, name: "ft" } : { mm: 1000, name: "m" });

/** `ring` and `hole` as one outline, joined from the ring's first point to the hole's nearest, the hole run the other way round. */
function keyhole(ring: readonly Pt[], hole: readonly Pt[]): Pt[] {
  const back = signedArea(hole) > 0 === signedArea(ring) > 0 ? [...hole].reverse() : [...hole];
  const a = ring[0];
  let j = 0;
  for (let i = 1; i < back.length; i++) if (dist(back[i], a) < dist(back[j], a)) j = i;
  const from = [...back.slice(j), ...back.slice(0, j)];
  return [...ring, a, ...from, from[0]];
}

export class HedgerowTool extends PathTool {
  readonly id = "hedgerow";
  protected readonly label = "Hedgerow";
  private h: Hedgerow = {
    smooth: true,
    align: "centre",
    width: 600,
    densityBy: "length",
    density: 5,
    border: "cloud",
    concave: false,
    billowSize: 400,
    billowHeight: 120,
    variability: 50,
    segment: 150,
    thickness: 40,
    plants: [{ name: "Hedging", percent: 100 }],
  };

  async preferences(): Promise<void> {
    const h = this.h;
    const per = densityUnit().name;
    const v = await toolPrefs(
      "Hedgerow Preferences",
      [
        { kind: "check", key: "smooth", label: "Smooth corners", value: h.smooth },
        { kind: "choice", key: "align", label: "Align", value: h.align, options: ALIGNS },
        { kind: "length", key: "width", label: "Width", value: h.width },
        {
          kind: "choice",
          key: "by",
          label: "Density by",
          value: h.densityBy,
          options: [
            { value: "length", label: `Plants per ${per}` },
            { value: "area", label: `Plants per ${per}²` },
          ],
        },
        { kind: "number", key: "density", label: "Density", value: h.density, min: 0.001, max: 10000 },
        { kind: "choice", key: "border", label: "Border Style", value: h.border, options: BORDERS },
        { kind: "choice", key: "billow", label: "Billow", value: h.concave ? "concave" : "convex", options: BILLOWS },
        { kind: "length", key: "size", label: "Billow Size", value: h.billowSize },
        { kind: "length", key: "height", label: "Billow Height", value: h.billowHeight },
        { kind: "number", key: "variability", label: "Billow Variability", value: h.variability, min: 0, max: 100, unit: "%" },
        { kind: "length", key: "segment", label: "Segment Length", value: h.segment },
        { kind: "length", key: "thickness", label: "Segment Thickness", value: h.thickness, zero: true },
        { kind: "text", key: "plants", label: "Plants", value: plantsText(h.plants) },
      ],
      "Align centres the hedge on the clicked path or lays it to the path's left or right; Smooth corners rounds the outside of each corner. Plant Cloud draws the edge as billows about the Billow Size long, bulging out (Convex) or in (Concave) the Billow Height, the largest up to the Variability bigger than the smallest; Plant Line as a rough line of segments the Segment Length long, straying up to half the Segment Thickness either side. Plants: up to seven, each with its share, as in \"Beech 60%, Hornbeam 40%\" (100% in all at the most); each is counted from the density times the hedge's length or area. Plant styles, Height and 3D, site models, worksheets and editing the hedge as one object aren't offered.",
    );
    if (!v) return;
    const plants = parsePlants(v.choice("plants"));
    if (typeof plants === "string") toast(`${plants} The plants were kept as they were.`, "info");
    this.h = {
      smooth: v.flag("smooth"),
      align: ALIGNS.find((a) => a.value === v.choice("align"))?.value ?? "centre",
      width: v.num("width"),
      densityBy: v.choice("by") === "area" ? "area" : "length",
      density: v.num("density"),
      border: BORDERS.find((b) => b.value === v.choice("border"))?.value ?? "standard",
      concave: v.choice("billow") === "concave",
      billowSize: v.num("size"),
      billowHeight: v.num("height"),
      variability: v.num("variability"),
      segment: v.num("segment"),
      thickness: v.num("thickness"),
      plants: typeof plants === "string" ? h.plants : plants,
    };
  }

  protected startHint(): string {
    return "Click the start of the hedgerow's path";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const plan = hedgerow(points, closed, this.h);
    if (typeof plan === "string") return plan;
    const [ring, hole] = plan.outlines;
    if (!hole) return [{ kind: "polygon", points: ring, closed: true }];
    // a ring: filled between its edges, which are drawn over the fill
    return [
      { shape: { kind: "polygon", points: keyhole(ring, hole), closed: true }, attrs: { lineStyle: 0 } },
      { shape: { kind: "polygon", points: ring, closed: true }, attrs: { fillPattern: 0 } },
      { shape: { kind: "polygon", points: hole, closed: true }, attrs: { fillPattern: 0 } },
    ];
  }

  protected added(points: Pt[], closed: boolean): void {
    const plan = hedgerow(points, closed, this.h);
    if (typeof plan !== "string") toast(this.summary(plan), "info");
  }

  /** "Hedgerow: 12.4 m long, 7.44 m², 62 plants (Beech 37, Hornbeam 25)" */
  private summary(plan: HedgerowPlan): string {
    const counts = plantCounts(this.h, plan, densityUnit().mm);
    const total = counts.reduce((s, c) => s + c.count, 0);
    const each = counts.length > 1 ? ` (${counts.map((c) => `${c.name} ${c.count}`).join(", ")})` : ` of ${counts[0].name}`;
    return `Hedgerow: ${formatLength(plan.length, units())} long, ${formatArea(plan.area, units())}, ${total} ${total === 1 ? "plant" : "plants"}${each}`;
  }
}
