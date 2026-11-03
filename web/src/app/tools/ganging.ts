// Spotlight's Ganging (gangingShapes.ts): click each lighting device to gang, the last with a
// double-click (or press Enter after it), then click where the two-fer's label goes. Vectorworks
// makes a two-fer object and writes the shared value into the devices' records; Rodeo has no two-fer
// object, so this draws the two-fer's lines and label, grouped in the active class. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { twoFer, type Gang, type GangBy, type GangCorner } from "../gangingShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";
import { addPieces, layerScale, preview } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { ClickedPath } from "./paths.ts";

const CORNERS: readonly { readonly value: GangCorner; readonly label: string }[] = [
  { value: "square", label: "Square" },
  { value: "arc", label: "Arc" },
  { value: "bezier", label: "Bézier" },
];
const GANG_BY: readonly { readonly value: GangBy; readonly label: string }[] = [
  { value: "channel", label: "Channel" },
  { value: "dimmer", label: "Dimmer" },
  { value: "circuit", label: "Circuit" },
  { value: "dimmerChannel", label: "Dimmer and Channel" },
];
/** a rounded or curved corner on paper, mm */
const CORNER_MM = 3;

export class GangingTool extends BaseTool {
  readonly id = "ganging";
  readonly cursor = "crosshair";
  private readonly path = new ClickedPath();
  /** the devices, once the last is clicked: the next click places the label */
  private devices: Pt[] | null = null;
  private cursorAt: Pt | null = null;
  private corner: GangCorner = "arc";
  private by: GangBy = "channel";
  private value = "1";
  private showLabel = true;
  private container = true;
  private textMm = 2.5;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Ganging Preferences",
      [
        { kind: "choice", key: "corner", label: "Corner Style", value: this.corner, options: CORNERS },
        { kind: "choice", key: "by", label: "Gang By", value: this.by, options: GANG_BY },
        { kind: "text", key: "value", label: "Field Value", value: this.value },
        { kind: "check", key: "show", label: "Show Label", value: this.showLabel },
        { kind: "check", key: "container", label: "Use Container", value: this.container },
        { kind: "number", key: "text", label: "Text height", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      "Click each lighting device, the last with a double-click (or Enter after it), then where the label goes: a line runs from each device to the label's height and one line there joins them, its outer corners Square, Arc or Bézier. The label shows the Field Value (for Circuit, and Dimmer and Channel, two values separated by a comma, the second below the first), in a circle with Use Container. The devices' own records aren't changed, the two-fer isn't counted in reports, and Rotation and text styles aren't offered.",
    );
    if (!v) return;
    this.corner = CORNERS.find((o) => o.value === v.choice("corner"))?.value ?? "arc";
    this.by = GANG_BY.find((o) => o.value === v.choice("by"))?.value ?? "channel";
    this.value = v.choice("value");
    this.showLabel = v.flag("show");
    this.container = v.flag("container");
    this.textMm = v.num("text");
  }

  snapFrom(): Pt | null {
    return this.devices?.at(-1) ?? this.path.points.at(-1) ?? null;
  }

  hint(): string {
    if (this.devices) return "Click where the two-fer's label goes · Esc cancels";
    if (this.path.points.length === 0) return "Click the first lighting device to gang";
    return "Click the next lighting device · double-click the last, or press Enter after it";
  }

  down(p: PointerInfo): void {
    if (this.devices) {
      const devices = this.devices;
      // the third press of the double-click that ended the devices isn't the label's click
      if (p.detail > 2) return;
      this.devices = null;
      const d = twoFer(devices, p.pos, this.gang());
      if (typeof d === "string") toast(d, "info");
      else addPieces("Ganging", [markerParts(d)]);
      return;
    }
    const done = this.path.click(p, this.env.view.scale, false);
    if (done) this.devices = done.points;
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.path.points = [];
    this.devices = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key === "Escape" && (this.devices || this.path.points.length)) {
      this.cancel();
      return true;
    }
    if (e.key !== "Enter" || this.devices || this.path.points.length === 0) return false;
    if (this.path.points.length < 2) toast("Click at least two lighting devices to gang.", "info");
    else this.devices = this.path.end(false).points;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    if (!at) return;
    if (this.devices) {
      const d = twoFer(this.devices, at, this.gang());
      if (typeof d !== "string") preview(g, markerParts(d));
    } else if (this.path.points.length) withPreview(g, () => strokeScreen(g, [...this.path.points, at], false));
  }

  private gang(): Gang {
    const scale = layerScale(this.env) ?? 1;
    return {
      corner: this.corner,
      by: this.by,
      value: this.value,
      showLabel: this.showLabel,
      container: this.container,
      textHeight: this.textMm * scale,
      cornerSize: CORNER_MM * scale,
    };
  }
}
