// Site Planning's Parking Spaces, Vectorworks' tool of that name: a click places a row of stalls, or
// two back to back, along a header stripe from the click (a press dragged turns it), with its
// accessible spaces, aisles, stripes, numbers and bumpers as Preferences say (parkingShapes.ts). Rodeo
// draws them as plain objects in a group; Show 3D Stripes adds a mesh of the stripes painted on the
// layer and bumpers standing on it. Space Height, which Vectorworks keeps only for IFC, isn't asked for.

import type { Attributes, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { placed } from "../detailShapes.ts";
import { parkingSpaces, parkingSpacesSolid, upright, type AisleFill, type AisleSide, type ParkingSpaces, type ParkingSpacesPlan, type SpaceStyle } from "../parkingShapes.ts";
import { colorMatcher } from "../pdfImport.ts";
import { placedSolid } from "../solids3d.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { addPart, PlaceTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

const STYLES: readonly { readonly value: SpaceStyle; readonly label: string }[] = [
  { value: "single", label: "Single Bay" },
  { value: "double", label: "Double Bay" },
  { value: "parallel", label: "Parallel" },
];
const AISLE_SIDES: readonly { readonly value: AisleSide; readonly label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "both", label: "Both Sides" },
];
const AISLE_FILLS: readonly { readonly value: AisleFill; readonly label: string }[] = [
  { value: "none", label: "None" },
  { value: "solid", label: "Solid" },
  { value: "stripes", label: "Stripes" },
];
const AISLE_GREY = { r: 0.82, g: 0.82, b: 0.82 };
/** a 3D stripe's width, mm */
const STRIPE_WIDTH = 100;
/** the numbers' height on paper, mm */
const TEXT_MM = 2.5;

export class ParkingSpacesTool extends PlaceTool {
  readonly id = "parkingspaces";
  readonly cursor = "crosshair";
  protected readonly label = "Parking Spaces";
  protected override clickAngle = 0;
  private spaces: ParkingSpaces = {
    style: "single",
    count: 5,
    width: 2500,
    length: 5000,
    angle: 90,
    angledHeader: false,
    accessible: 0,
    accessibleWidth: 3600,
    accessibleAtEnd: false,
    accessibleSymbol: true,
    aisles: false,
    aisleWidth: 1500,
    aisleSide: "right",
    aisleFill: "stripes",
    header: true,
    startStripe: true,
    endStripe: true,
    numbering: false,
    startAt: 1,
    bumpers: false,
  };
  private stripes3D = true;
  private textMm = TEXT_MM;
  private problem: string | null = null;
  private last: { at: Pt; angle: number } | null = null;

  async preferences(): Promise<void> {
    const p = this.spaces;
    const v = await toolPrefs(
      "Parking Spaces Preferences",
      [
        { kind: "number", key: "rotation", label: "Rotation", value: (this.clickAngle * 180) / Math.PI, min: -360, max: 360, unit: "°" },
        { kind: "choice", key: "style", label: "Space Style", value: p.style, options: STYLES },
        { kind: "number", key: "count", label: "No. of Standard Spaces", value: p.count, min: 0, max: 2000, integer: true },
        { kind: "length", key: "width", label: "Space Width", value: p.width },
        { kind: "length", key: "length", label: "Space Length", value: p.length },
        { kind: "number", key: "angle", label: "Space Angle", value: p.angle, min: 1, max: 90, unit: "°" },
        { kind: "choice", key: "header", label: "Header Style", value: p.angledHeader ? "angled" : "straight", options: [{ value: "straight", label: "Straight" }, { value: "angled", label: "Angled" }] },
        { kind: "number", key: "accessible", label: "No. of Accessible Spaces", value: p.accessible, min: 0, max: 2000, integer: true },
        { kind: "length", key: "accessibleWidth", label: "Accessible Width", value: p.accessibleWidth },
        { kind: "choice", key: "accessibleAt", label: "Accessible Location", value: p.accessibleAtEnd ? "end" : "start", options: [{ value: "start", label: "Beginning of Row" }, { value: "end", label: "End of Row" }] },
        { kind: "check", key: "symbol", label: "Show Accessible Symbol", value: p.accessibleSymbol },
        { kind: "check", key: "aisles", label: "Add Accessible Aisle Spaces", value: p.aisles },
        { kind: "length", key: "aisleWidth", label: "Aisle Width", value: p.aisleWidth },
        { kind: "choice", key: "aisleSide", label: "Aisle Location", value: p.aisleSide, options: AISLE_SIDES },
        { kind: "choice", key: "aisleFill", label: "Aisle Fill", value: p.aisleFill, options: AISLE_FILLS },
        { kind: "check", key: "showHeader", label: "Show Header Stripe", value: p.header },
        { kind: "check", key: "startStripe", label: "Show Start Stripe", value: p.startStripe },
        { kind: "check", key: "endStripe", label: "Show End Stripe", value: p.endStripe },
        { kind: "check", key: "numbering", label: "Space Numbering", value: p.numbering },
        { kind: "number", key: "startAt", label: "Start Numbering At", value: p.startAt, min: -1e6, max: 1e6, integer: true },
        { kind: "number", key: "text", label: "Text size", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
        { kind: "check", key: "bumpers", label: "Show Bumpers", value: p.bumpers },
        { kind: "check", key: "stripes3D", label: "Show 3D Stripes", value: this.stripes3D },
      ],
      "The row runs from the click along the header stripe, its stalls below the stripe; a double bay's other row mirrors them, with the numbers and spaces given for each row. A parallel space's Length runs along the curb and its Width out from it.",
    );
    if (!v) return;
    this.clickAngle = (v.num("rotation") * Math.PI) / 180;
    this.textMm = v.num("text");
    this.stripes3D = v.flag("stripes3D");
    this.spaces = {
      style: v.choice("style") as SpaceStyle,
      count: v.num("count"),
      width: v.num("width"),
      length: v.num("length"),
      angle: v.num("angle"),
      angledHeader: v.choice("header") === "angled",
      accessible: v.num("accessible"),
      accessibleWidth: v.num("accessibleWidth"),
      accessibleAtEnd: v.choice("accessibleAt") === "end",
      accessibleSymbol: v.flag("symbol"),
      aisles: v.flag("aisles"),
      aisleWidth: v.num("aisleWidth"),
      aisleSide: v.choice("aisleSide") as AisleSide,
      aisleFill: v.choice("aisleFill") as AisleFill,
      header: v.flag("showHeader"),
      startStripe: v.flag("startStripe"),
      endStripe: v.flag("endStripe"),
      numbering: v.flag("numbering"),
      startAt: v.num("startAt"),
      bumpers: v.flag("bumpers"),
    };
  }

  private plan(): ParkingSpacesPlan | null {
    const plan = parkingSpaces(this.spaces);
    this.problem = typeof plan === "string" ? plan : null;
    return typeof plan === "string" ? null : plan;
  }

  protected shapes(at: Pt, angle: number): Part[] | null {
    const scale = this.scale();
    const plan = this.plan();
    if (scale === null || !plan) return null;
    this.last = { at, angle };
    const on = (pts: readonly Pt[]): Pt[] => placed(pts, at, angle);
    const grey = colorMatcher()(AISLE_GREY);
    const solid = this.spaces.aisleFill === "solid";
    const aisle: Partial<Attributes> = solid ? { fillPattern: 1, fillFore: grey, fillBack: grey, fillOpacity: 100 } : { fillPattern: 0 };
    return [
      ...plan.aisles.map((o): Part => ({ shape: { kind: "polygon", points: on(o), closed: true }, attrs: aisle })),
      ...markerParts({
        outlines: plan.bumpers.map(on),
        lines: [...plan.hatch, ...plan.stripes].map(on),
        circles: [],
        filled: plan.symbols.map(on),
        texts: plan.numbers.map((n) => ({ at: on([n.at])[0], text: n.text, height: this.textMm * scale, justify: "centre", angle: upright(angle) })),
      }),
    ];
  }

  protected override place(parts: readonly Part[]): void {
    const layer = store.activeLayerId;
    const plan = this.plan();
    if (!layer || !plan) return;
    const { at, angle } = this.last ?? { at: { x: 0, y: 0 }, angle: 0 };
    // the stripes in the colour they're drawn in
    const ink = store.drawAttrs.penFore ?? colorMatcher()({ r: 0, g: 0, b: 0 });
    const made = attempt(this.label, (s) =>
      s.batch(() => {
        const drawn = parts.map((part) => addPart(s, layer, part));
        // Rodeo's plan shows no meshes and its 3D view no plan drawings
        const solid = this.stripes3D ? parkingSpacesSolid(plan, STRIPE_WIDTH) : [];
        const mesh = solid.length ? s.addMeshes(layer, [placedSolid(solid, at, angle)], store.activeClassIndex, { fillPattern: 1, fillFore: ink, fillBack: ink, fillOpacity: 100 }) : [];
        return s.groupObjects([...drawn, ...mesh]);
      }),
    );
    if (made) setEditGroup(null, [made.value]);
  }

  protected override refusal(): string {
    return `The Parking Spaces' Preferences don't make one: ${this.problem ?? "check its sizes"}.`;
  }
}
