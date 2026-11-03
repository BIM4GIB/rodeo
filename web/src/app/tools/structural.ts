// Detailing's Bulb Flat, Shaft Break and Shaft Break 2 (structuralShapes.ts): a bulb flat's section,
// listed or custom, with its section properties in the Preferences note and a locus at its centroid
// if asked, placed by a click (a press dragged turns it); one shaft break the same way; and Shaft
// Break 2's pair at both ends of a shortened length, a click on each. Plain objects where
// Vectorworks makes plug-in objects.

import type { NewShape, Pt } from "../../core/index.ts";
import { placed } from "../detailShapes.ts";
import { polygonSection } from "../engineeringProperties.ts";
import { dist } from "../geom.ts";
import { BULB_FLATS, bulbAngle, bulbFlatOutline, bulbFlatProblem, shaftBreakLines, shaftBreakProblem, type BulbFlat, type ShaftBreak, type ShaftBreakKind } from "../structuralShapes.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { PlaceTool, TwoPointTool } from "./detailing.ts";

/** a section's figures to four places, as the Preferences note lists them */
const figure = (v: number): string => Number(v.toPrecision(4)).toLocaleString("en");

export class BulbFlatTool extends PlaceTool {
  readonly id = "bulbflat";
  readonly cursor = "crosshair";
  protected readonly label = "Bulb Flat";
  private size = "HP 200 x 10";
  /** a size typed in with Custom Size, used instead of the list's */
  private custom: BulbFlat | null = null;
  private locus = false;
  /** the click places the centroid rather than the web's bottom middle */
  private lock = false;

  private current(): BulbFlat | null {
    return this.custom ?? BULB_FLATS.find((b) => b.id === this.size) ?? null;
  }

  async preferences(): Promise<void> {
    const s = this.current() ?? BULB_FLATS[0]!;
    const v = await toolPrefs(
      "Bulb Flat Preferences",
      [
        { kind: "choice", key: "size", label: "Size", value: this.size, options: BULB_FLATS.map((b) => ({ value: b.id, label: b.id })) },
        { kind: "check", key: "custom", label: "Custom Size", value: this.custom !== null },
        { kind: "length", key: "b", label: "Width", value: s.b },
        { kind: "length", key: "t", label: "Thickness", value: s.t },
        { kind: "length", key: "c", label: "Bulb Height", value: s.c },
        { kind: "length", key: "d", label: "Bulb Width", value: s.d },
        { kind: "length", key: "r", label: "Bulb Radius", value: s.r },
        { kind: "length", key: "r1", label: "Fillet Radius", value: s.r1, zero: true },
        { kind: "check", key: "locus", label: "Place Locus at Centroid", value: this.locus },
        { kind: "check", key: "lock", label: "Lock Centroid Position", value: this.lock },
      ],
      `EN 10067's hot-rolled bulb flats, HP 120 x 6 to HP 430 x 20 (width by thickness), as Corus Special Profiles lists them, with the square corners rounded to EN 10067's largest radius for the thickness. Custom Size draws the figures below Size instead; with it off they only show the size as this opened. The bulb angle follows from them: the underside meets the web the bulb width down from the top and touches the tip's circle, which is 30° for every listed size. The section stands on the bottom of its web with the bulb at the top to the right; Lock Centroid Position puts the centroid on the click instead. ${this.properties(s)}`,
    );
    if (!v) return;
    this.size = v.choice("size");
    this.custom = v.flag("custom") ? { id: "Custom", b: v.num("b"), t: v.num("t"), c: v.num("c"), d: v.num("d"), r: v.num("r"), r1: v.num("r1") } : null;
    this.locus = v.flag("locus");
    this.lock = v.flag("lock");
  }

  /** The section's figures in millimetres, as Vectorworks shows a metric shape's. */
  private properties(s: BulbFlat): string {
    const pts = bulbFlatOutline(s);
    const sec = pts && polygonSection(pts);
    if (!sec) return `${s.id} doesn't make a section: ${bulbFlatProblem(s)}.`;
    const { area: a, ix, iy } = sec;
    return (
      `${s.id}, as this opened: bulb angle ${figure((bulbAngle(s) * 180) / Math.PI)}°, area ${figure(a)} mm², centroid ${figure(sec.centroid.y)} mm up from the bottom and ${figure(sec.centroid.x + s.t / 2)} mm in from the web's back; ` +
      `about X-X and Y-Y, moments of inertia ${figure(ix)} and ${figure(iy)} mm⁴, section moduli ${figure(ix / sec.reachY)} and ${figure(iy / sec.reachX)} mm³ (to the farthest edge), radii of gyration ${figure(Math.sqrt(ix / a))} and ${figure(Math.sqrt(iy / a))} mm.`
    );
  }

  protected shapes(at: Pt, angle: number): NewShape[] | null {
    const s = this.current();
    const pts = s && bulbFlatOutline(s);
    const sec = pts && polygonSection(pts);
    if (!pts || !sec) return null;
    const origin = this.lock ? sec.centroid : { x: 0, y: 0 };
    const local = (q: readonly Pt[]): Pt[] => placed(q.map((p) => ({ x: p.x - origin.x, y: p.y - origin.y })), at, angle);
    const outline: NewShape = { kind: "polygon", points: local(pts), closed: true };
    return this.locus ? [outline, { kind: "locus", at: local([sec.centroid])[0]! }] : [outline];
  }

  protected refusal(): string {
    const s = this.current();
    return `The bulb flat's Preferences don't make one: ${(s && bulbFlatProblem(s)) ?? "no size is chosen"}.`;
  }
}

const CONFIGS: readonly { readonly value: ShaftBreakKind; readonly label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "hollow", label: "Hollow" },
];

/** Shaft Break's and Shaft Break 2's size until Preferences change it, mm */
const BREAK: ShaftBreak = { diameter: 50, width: 15, kind: "solid", wall: 6 };

/** The fields both shaft breaks ask for, and what they leave. */
async function shaftBreakPrefs(title: string, s: ShaftBreak, note: string): Promise<ShaftBreak | null> {
  const v = await toolPrefs(
    title,
    [
      { kind: "length", key: "diameter", label: "Shaft Diameter", value: s.diameter },
      { kind: "length", key: "width", label: "Width of Break", value: s.width },
      { kind: "choice", key: "kind", label: "Configuration", value: s.kind, options: CONFIGS },
      { kind: "length", key: "wall", label: "Wall Thickness", value: s.wall },
    ],
    note,
  );
  if (!v) return null;
  return { diameter: v.num("diameter"), width: v.num("width"), kind: v.choice("kind") === "hollow" ? "hollow" : "solid", wall: v.num("wall") };
}

const lines = (pts: readonly Pt[][]): NewShape[] => pts.map((points): NewShape => ({ kind: "polyline", points: [...points], closed: false }));

export class ShaftBreakTool extends PlaceTool {
  readonly id = "shaftbreak";
  readonly cursor = "crosshair";
  protected readonly label = "Shaft Break";
  private size = BREAK;

  async preferences(): Promise<void> {
    const s = await shaftBreakPrefs(
      "Shaft Break Preferences",
      this.size,
      "Click on the shaft's axis where it breaks off; a press dragged turns the axis toward the pointer. Unturned, the axis runs to the right and the break stands across it: an S from the top bowing out to the right, then a loop to the bottom, a hollow shaft's bore a smaller loop inside it. Wall Thickness counts only for Hollow.",
    );
    if (s) this.size = s;
  }

  protected shapes(at: Pt, angle: number): NewShape[] | null {
    const pts = shaftBreakLines(this.size);
    return pts ? lines(pts.map((p) => placed(p, at, angle))) : null;
  }

  protected refusal(): string {
    return `The shaft break's Preferences don't make one: ${shaftBreakProblem(this.size)}.`;
  }
}

export class ShaftBreak2Tool extends TwoPointTool {
  readonly id = "shaftbreak2";
  readonly cursor = "crosshair";
  protected readonly label = "Shaft Break 2";
  private size = BREAK;

  async preferences(): Promise<void> {
    const s = await shaftBreakPrefs(
      "Shaft Break 2 Preferences",
      this.size,
      "A shortened shaft: click on its axis where the first piece breaks off, then where the second begins (or drag between them). Each end gets a break facing the gap, the second turned half round from the first. Wall Thickness counts only for Hollow.",
    );
    if (s) this.size = s;
  }

  hint(): string {
    return this.start() ? "Click or release where the shaft carries on" : "Click on the shaft's axis where it breaks off, then where it carries on";
  }

  protected shapes(a: Pt, b: Pt): NewShape[] | null {
    const pts = shaftBreakLines(this.size);
    if (!pts || dist(a, b) < this.size.width) return null;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    return [...lines(pts.map((p) => placed(p, a, angle))), ...lines(pts.map((p) => placed(p, b, angle + Math.PI)))];
  }

  protected refusal(): string {
    const problem = shaftBreakProblem(this.size);
    return problem ? `The shaft break's Preferences don't make one: ${problem}.` : "Click the second break at least the width of break from the first.";
  }
}
