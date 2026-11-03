// Dims/Notes' Dimension Tape (tapeShapes.ts): click the tape's start, click its end (Shift in 15°
// steps; a press dragged there sets both), then click where it goes: it lies through that point,
// parallel to the first two. Its hash marks, subdivisions and numbers come from Preferences, the
// numbers in the drawing's units. Vectorworks makes a plug-in object of it, with specific markers
// added from its context menu; this draws plain lines and text, grouped.

import type { Pt } from "../../core/index.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { store } from "../state.ts";
import { dimensionTape, type DimensionTape, type TapeNumbers } from "../tapeShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";
import { formatLengthValue, unitLabel } from "../units.ts";
import { addPieces, layerScale, preview, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** a press dragged further than this (CSS px) sets the tape's end where it's released */
const CLICK_PX = 4;
/** the numbers' height on paper, mm, until Preferences change it */
const TAPE_TEXT_MM = 2.5;

const NUMBER_SIDES: readonly { readonly value: TapeNumbers; readonly label: string }[] = [
  { value: "above", label: "Above (right of an upright tape)" },
  { value: "below", label: "Below (left of an upright tape)" },
];

/** What a tape starts with: hash marks 2' apart in a drawing in feet or inches (as Vectorworks' example has them), else 1 m. */
function defaultTape(inch: boolean): DimensionTape {
  return {
    spacing: inch ? 609.6 : 1000,
    subdivisions: 4,
    hashHeight: inch ? 152.4 : 200,
    subdivisionHeight: inch ? 76.2 : 100,
    negative: false,
    numbers: "above",
    fromCentre: true,
    centreOffset: 0,
  };
}

export class DimensionTapeTool extends BaseTool {
  readonly id = "dimtape";
  readonly cursor = "crosshair";
  private points: Pt[] = [];
  private pressScreen: Pt | null = null;
  private pointer: PointerInfo | null = null;
  /** set from the drawing's units on first use */
  private settings: DimensionTape | null = null;
  private textMm = TAPE_TEXT_MM;

  private get tape(): DimensionTape {
    return (this.settings ??= defaultTape(["in", "ft"].includes(unitLabel(store.session?.doc.info.units))));
  }

  async preferences(): Promise<void> {
    const t = this.tape;
    const v = await toolPrefs(
      "Dimension Tape Preferences",
      [
        { kind: "length", key: "spacing", label: "Dist. between Hash Marks", value: t.spacing },
        { kind: "number", key: "subdivisions", label: "Number of subdivisions", value: t.subdivisions, min: 0, max: 100, integer: true },
        { kind: "length", key: "hash", label: "Height of hash marker", value: t.hashHeight, zero: true },
        { kind: "length", key: "sub", label: "Height of subdivision marker", value: t.subdivisionHeight, zero: true },
        { kind: "check", key: "negative", label: "Number in negative direction", value: t.negative },
        { kind: "choice", key: "numbers", label: "Number placement", value: t.numbers, options: NUMBER_SIDES },
        { kind: "check", key: "centre", label: "Mark from center", value: t.fromCentre },
        { kind: "length", key: "offset", label: "Offset of 0 from the center", value: t.centreOffset, zero: true, signed: true },
        { kind: "number", key: "text", label: "Text size", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      "The tape's length and turn come from its first two clicks, and the third sets where it lies. Its numbers count from 0 at its start, or with Mark from center from its middle (moved along it by the offset) both ways; they grow the way it was drawn unless Number in negative direction. Text size is on paper: a layer at 1:n draws it n times larger.",
    );
    if (!v) return;
    this.settings = {
      spacing: v.num("spacing"),
      subdivisions: v.num("subdivisions"),
      hashHeight: v.num("hash"),
      subdivisionHeight: v.num("sub"),
      negative: v.flag("negative"),
      numbers: NUMBER_SIDES.find((s) => s.value === v.choice("numbers"))?.value ?? "above",
      fromCentre: v.flag("centre"),
      centreOffset: v.num("offset"),
    };
    this.textMm = v.num("text");
  }

  snapFrom(): Pt | null {
    return this.points[this.points.length - 1] ?? null;
  }

  hint(): string {
    if (this.points.length === 1) return "Click the tape's end · Shift 15°";
    if (this.points.length === 2) return "Click where the tape goes";
    return "Click the tape's start";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (this.points.length === 0) {
      this.points = [p.pos];
      this.pressScreen = p.screen;
      return;
    }
    this.pressScreen = null;
    if (this.points.length === 1) {
      this.end(this.at(p));
      return;
    }
    const [a, b] = this.points;
    this.points = [];
    const parts = this.parts(a, b, p.pos);
    if (parts) addPieces("Dimension Tape", [parts]);
    else toast(this.refusal(), "info");
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.points.length === 1 && press && dist(p.screen, press) > CLICK_PX) this.end(this.at(p));
  }

  cancel(): void {
    this.points = [];
    this.pressScreen = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.points.length) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p || !this.points.length) return;
    const parts = this.points.length === 1 ? this.parts(this.points[0], this.at(p), null) : this.parts(this.points[0], this.points[1], p.pos);
    if (parts) preview(g, parts);
  }

  /** The pointer's point; Shift turns the tape in 15° steps from its start. */
  private at(p: PointerInfo): Pt {
    const a = this.points[0];
    return a && p.shift ? snapAngle(a, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private end(b: Pt): void {
    if (dist(this.points[0], b) > 0) this.points = [this.points[0], b];
  }

  /** The tape from `a` to `b`, moved square to them through `through` when given; null when it can't draw. */
  private parts(a: Pt, b: Pt, through: Pt | null): Part[] | null {
    const scale = layerScale(this.env);
    const len = dist(a, b);
    if (scale === null || !(len > 0)) return null;
    const left = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const off = through ? (through.x - a.x) * left.x + (through.y - a.y) * left.y : 0;
    const move = (q: Pt): Pt => ({ x: q.x + left.x * off, y: q.y + left.y * off });
    const units = store.session?.doc.info.units;
    const d = dimensionTape(move(a), move(b), this.tape, this.textMm * scale, (mm) => formatLengthValue(mm, units));
    return d ? markerParts(d) : null;
  }

  private refusal(): string {
    if (layerScale(this.env) === null) return "Make a design layer active to place a dimension tape.";
    return "This tape would have no hash marks or too many: set a longer Dist. between Hash Marks in Preferences.";
  }
}
