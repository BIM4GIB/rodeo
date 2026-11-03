// Detailing's Framing Member (framingShapes.ts). Vectorworks makes a framing member object of it,
// with 3D; this draws what that object draws in Top/Plan, as plain 2D objects grouped in the
// active class. A drag or two clicks set its span and turn: solid, as its centre line, by its
// width, or by its width with its centre line, each end cut square or mitred, a rafter's bearing
// inset and overhang run past its clicks, with its label above its middle. The centre line beside
// the width is drawn in the drawing's first dashed line type, and solid in a drawing without one.

import type { Pt } from "../../core/index.ts";
import { framingMember, MAX_MITER, type FramingMember } from "../framingShapes.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { TwoPointTool, type Part } from "./detailing.ts";

type Display = "solid" | "centre" | "width" | "both";

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const DISPLAYS: Options<Display> = [
  { value: "solid", label: "Solid" },
  { value: "centre", label: "Centerline" },
  { value: "width", label: "Width" },
  { value: "both", label: "Width with Centerline" },
];

/** a label's height on paper, mm */
const LABEL_MM = 2.5;
const H_CENTRE = 2;
const V_CENTRE = 3;

const dashedStyle = (): number | undefined => store.session?.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;

export class FramingMemberTool extends TwoPointTool {
  readonly id = "framing";
  readonly cursor = "crosshair";
  protected readonly label = "Framing Member";
  private m: FramingMember = { width: 50, startMiter: 0, endMiter: 0, inset: 0, overhang: 0 };
  private display: Display = "solid";
  private showLabel = false;
  private labelText = "Bm #";
  private problem = "";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Framing Member Preferences",
      [
        { kind: "length", key: "width", label: "Width", value: this.m.width },
        { kind: "number", key: "startMiter", label: "Beginning Miter", value: this.m.startMiter, min: -MAX_MITER, max: MAX_MITER, unit: "°" },
        { kind: "number", key: "endMiter", label: "Ending Miter", value: this.m.endMiter, min: -MAX_MITER, max: MAX_MITER, unit: "°" },
        { kind: "length", key: "inset", label: "Bearing Inset", value: this.m.inset, zero: true },
        { kind: "length", key: "overhang", label: "Overhang", value: this.m.overhang, zero: true },
        { kind: "choice", key: "display", label: "2D Display", value: this.display, options: DISPLAYS.map((d) => ({ value: d.value, label: d.label })) },
        { kind: "check", key: "showLabel", label: "Show Label", value: this.showLabel },
        { kind: "text", key: "labelText", label: "Label Text", value: this.labelText },
      ],
      `Drag or click the member's span: its start, then its end, which set its turn. It's drawn the Width across, Solid (in the drawing's fill), as its Centerline, by its Width, or by its Width with its Centerline. A miter cuts its end that many degrees from square in plan (positive lengthens its left edge, as drawn, at that end). A rafter starts the Bearing Inset before its first click and runs the Overhang past its second. Show Label puts the Label Text above its middle, ${LABEL_MM} mm high on paper. Height, pitch, length, bevels, types and their trusses, joists, channels, hangers and profiles, structural use, material, volume, quantity labels, vertical reference, eaves and 3D aren't kept.`,
    );
    if (!v) return;
    this.m = {
      width: Math.max(0, v.num("width")),
      startMiter: v.num("startMiter"),
      endMiter: v.num("endMiter"),
      inset: Math.max(0, v.num("inset")),
      overhang: Math.max(0, v.num("overhang")),
    };
    this.display = pick(DISPLAYS, v.choice("display"), this.display);
    this.showLabel = v.flag("showLabel");
    this.labelText = v.choice("labelText");
  }

  hint(): string {
    return this.start() ? super.hint() : "Drag the member's span, or click its start";
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    if (scale === null) {
      this.problem = "Make a design layer active to draw a framing member.";
      return null;
    }
    const textSize = LABEL_MM * scale;
    const plan = framingMember(a, b, this.m, textSize);
    if (typeof plan === "string") {
      this.problem = plan;
      return null;
    }
    const outline: Part = { kind: "polygon", points: plan.outline, closed: true };
    const centre = (style?: number): Part => ({ shape: { kind: "polyline", points: plan.centre, closed: false }, attrs: style === undefined ? {} : { lineStyle: style } });
    const body: Part[] =
      this.display === "solid"
        ? [outline]
        : this.display === "centre"
          ? [centre()]
          : this.display === "width"
            ? [{ shape: outline, attrs: { fillPattern: 0 } }]
            : [{ shape: outline, attrs: { fillPattern: 0 } }, centre(dashedStyle())];
    const text = this.labelText.trim();
    const label: Part[] = this.showLabel && text ? [{ kind: "text", at: plan.label.at, text, height: textSize, hAlign: H_CENTRE, vAlign: V_CENTRE, angle: plan.label.angle }] : [];
    return [...body, ...label];
  }

  protected refusal(): string {
    return this.problem || super.refusal();
  }
}
