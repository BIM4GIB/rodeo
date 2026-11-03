// ConnectCAD's Rack Ruler (rackRulerShapes.ts): click where the ruler's foot goes, beside an
// equipment rack, then click (or drag) toward its top to turn it; two clicks together stand it up
// the screen. Shift keeps the turn to 15° steps. Vectorworks makes a rack ruler object; this draws
// its columns, ticks and labels as plain objects grouped in the active class. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { rackRuler } from "../rackRulerShapes.ts";
import { store } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { formatLengthValue, unitLabel } from "../units.ts";
import { placedDrawing } from "./circulation.ts";
import { TwoPointTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** two clicks this close stand the ruler up the screen */
const TURN_MIN = 1e-6;

export class RackRulerTool extends TwoPointTool {
  readonly id = "rackruler";
  readonly cursor = "crosshair";
  protected readonly label = "Rack Ruler";
  private units = 42;
  private baseOffset = 0;
  private textMm = 2;
  /** why the last ruler couldn't be drawn */
  private why = "";

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Rack Ruler Preferences",
      [
        { kind: "number", key: "units", label: "Height (RU)", value: this.units, min: 1, max: 200 },
        { kind: "number", key: "offset", label: "Base Offset", value: this.baseOffset, min: -100000, max: 100000, unit: "mm" },
        { kind: "number", key: "text", label: "Text height", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      "Click where the ruler's foot goes, beside the rack, then click (or drag) toward its top to turn it; two clicks together stand it up the screen. Its rack units (1.75 in each) are numbered up one column, a tick at each and a longer one every fifth, with their heights in the drawing's units every five beside them; the ruler's zero sits Base Offset above the first click. Labels crowd out at small scales, so the units are then numbered every 2, 5, 10… Plain objects, grouped: Object Info doesn't edit it afterwards.",
    );
    if (!v) return;
    this.units = Math.round(v.num("units"));
    this.baseOffset = v.num("offset");
    this.textMm = v.num("text");
  }

  hint(): string {
    return this.start() ? super.hint() : `Click the rack ruler's foot, then toward its top · ${this.units} RU`;
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    if (scale === null) {
      this.why = "Make a design layer active to place a rack ruler.";
      return null;
    }
    const units = store.session?.doc.info.units;
    const d = rackRuler({
      units: this.units,
      baseOffset: this.baseOffset,
      textHeight: this.textMm * scale,
      length: (mm) => formatLengthValue(mm, units),
      unitName: unitLabel(units),
    });
    if (typeof d === "string") {
      this.why = d;
      return null;
    }
    // the ruler runs up toward the second click
    const turn = Math.hypot(b.x - a.x, b.y - a.y) > TURN_MIN ? Math.atan2(b.y - a.y, b.x - a.x) - Math.PI / 2 : 0;
    const placed = placedDrawing(d, a, turn);
    // placedDrawing turns labels past (−90°, 90°] back round to read, so they hang from their other end
    const deg = ((((turn * 180) / Math.PI) % 360) + 360) % 360;
    if (deg > 90 + 1e-6 && deg <= 270 + 1e-6) placed.texts.splice(0, placed.texts.length, ...placed.texts.map((t) => ({ ...t, justify: t.justify === "right" ? ("left" as const) : t.justify === "left" ? ("right" as const) : t.justify })));
    return markerParts(placed);
  }

  protected refusal(): string {
    return this.why || super.refusal();
  }
}
