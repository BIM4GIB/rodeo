// Dims/Notes' Geom Dim and Tol Note (gdtShapes.ts' holeNote): a click places the note, level or at
// the Rotation in Preferences; a press dragged from where its arrow points to where the leader
// meets the shoulder adds the leader, the note past the shoulder on the side Preferences give.
// Its numbers are in the drawing's units, to the Precision set, and in decimal inches without a
// leading zero in a feet-and-inches drawing, as ASME notes write them. Vectorworks makes a plug-in
// object of it, its leader added by a control point; this draws plain lines and text, grouped.

import type { Pt } from "../../core/index.ts";
import { HOLE_NOTE_TYPES, TOLERANCE_STYLES, holeNote, type HoleNote, type ToleranceStyle, type Toleranced } from "../gdtShapes.ts";
import { degToRad, dist } from "../geom.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs, type PrefField } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";
import { unitLabel } from "../units.ts";
import { addPieces, layerScale, preview, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** a press dragged further than this (CSS px) draws a leader */
const CLICK_PX = 4;
/** the note's text height and its shoulder's length on paper, mm, until Preferences change them */
const NOTE_TEXT_MM = 2.5;
const SHOULDER_MM = 5;

const SIDES: readonly { readonly value: "left" | "right"; readonly label: string }[] = [
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];
const PRECISIONS = [0, 1, 2, 3, 4].map((dp) => ({ value: String(dp), label: dp === 0 ? "1" : `0.${"0".repeat(dp - 1)}1` }));

interface NoteSettings {
  readonly note: HoleNote;
  /** decimal places */
  readonly precision: number;
  readonly side: "left" | "right";
  /** on paper, mm */
  readonly shoulderMm: number;
  /** degrees */
  readonly rotation: number;
  readonly textMm: number;
}

const units = (): string | undefined => store.session?.doc.info.units;
/** GD&T notes in drawings measured in feet or inches are in decimal inches */
const inchNotes = (): boolean => ["in", "ft"].includes(unitLabel(units()));

/** What a note starts with: a 5/8" hole 3/8" deep to three places in an inch drawing, else a 10 deep 5 one to one place. */
function defaults(inch: boolean): NoteSettings {
  const t = (value: number, tol: number): Toleranced => ({ value, style: "none", top: tol, bottom: tol });
  return {
    note: { type: "round", size: t(inch ? 0.625 : 10, inch ? 0.002 : 0.1), depth: t(inch ? 0.375 : 5, inch ? 0.002 : 0.1), leader: "", trailer: "" },
    precision: inch ? 3 : 1,
    side: "left",
    shoulderMm: SHOULDER_MM,
    rotation: 0,
    textMm: NOTE_TEXT_MM,
  };
}

export class HoleNoteTool extends BaseTool {
  readonly id = "gdtnote";
  readonly cursor = "crosshair";
  private press: { at: Pt; screen: Pt } | null = null;
  private pointer: PointerInfo | null = null;
  /** set from the drawing's units on first use */
  private settings: NoteSettings | null = null;

  private get s(): NoteSettings {
    return (this.settings ??= defaults(inchNotes()));
  }

  async preferences(): Promise<void> {
    const s = this.s;
    const n = s.note;
    const tolerance = (key: string, label: string, v: Toleranced): PrefField[] => [
      { kind: "choice", key: `${key}Style`, label: `${label} Tolerance`, value: v.style, options: TOLERANCE_STYLES.map((t) => ({ value: t.id, label: t.label })) },
      { kind: "number", key: `${key}Top`, label: `${label} Top`, value: v.top, min: -1e6, max: 1e6 },
      { kind: "number", key: `${key}Bottom`, label: `${label} Bottom`, value: v.bottom, min: -1e6, max: 1e6 },
    ];
    const v = await toolPrefs(
      "Geom Dim and Tol Note Preferences",
      [
        { kind: "choice", key: "type", label: "Note Type", value: n.type, options: HOLE_NOTE_TYPES.map((t) => ({ value: t.id, label: t.label })) },
        { kind: "number", key: "rotation", label: "Rotation", value: s.rotation, min: -360, max: 360, unit: "°" },
        { kind: "choice", key: "precision", label: "Precision", value: String(s.precision), options: PRECISIONS },
        { kind: "number", key: "size", label: "Hole Size/Taper", value: n.size.value, min: 0, max: 1e6 },
        ...tolerance("size", "Hole Size/Taper", n.size),
        { kind: "number", key: "depth", label: "Depth/Angle", value: n.depth.value, min: -1e6, max: 1e6 },
        ...tolerance("depth", "Depth/Angle", n.depth),
        { kind: "text", key: "leader", label: "Leader", value: n.leader },
        { kind: "text", key: "trailer", label: "Trailer", value: n.trailer },
        { kind: "choice", key: "side", label: "Leader Line Position", value: s.side, options: SIDES },
        { kind: "number", key: "shoulder", label: "Shoulder Length", value: s.shoulderMm, min: 0, max: 100, unit: "mm" },
        { kind: "number", key: "text", label: "Text size", value: s.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      `Hole Size/Taper is a round, square, counterbore or countersink hole's diameter, or a taper's ratio to 1; Depth/Angle a hole's depth (not shown when 0 or less) or a countersink's angle in degrees. Sizes and tolerances are numbers in ${inchNotes() ? "inches" : "the drawing's units"}, to the Precision's places; Top is added for the upper limit, Bottom taken away for the lower. The shoulder and text sizes are on paper: a layer at 1:n draws them n times larger. Press and drag from where the arrow points to add a leader.`,
    );
    if (!v) return;
    const style = (key: string): ToleranceStyle => TOLERANCE_STYLES.find((t) => t.id === v.choice(key))?.id ?? "none";
    const toleranced = (key: string): Toleranced => ({ value: v.num(key), style: style(`${key}Style`), top: v.num(`${key}Top`), bottom: v.num(`${key}Bottom`) });
    this.settings = {
      note: {
        type: HOLE_NOTE_TYPES.find((t) => t.id === v.choice("type"))?.id ?? "round",
        size: toleranced("size"),
        depth: toleranced("depth"),
        leader: v.choice("leader").trim(),
        trailer: v.choice("trailer").trim(),
      },
      precision: Number(v.choice("precision")),
      side: v.choice("side") === "right" ? "right" : "left",
      shoulderMm: v.num("shoulder"),
      rotation: v.num("rotation"),
      textMm: v.num("text"),
    };
  }

  hint(): string {
    return this.press ? "Release where the leader meets the shoulder" : "Click to place the note, or press where its arrow points and drag to its shoulder";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    this.press = { at: p.pos, screen: p.screen };
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  up(p: PointerInfo): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    const parts = dist(p.screen, press.screen) > CLICK_PX ? this.parts(p.pos, press.at) : this.parts(press.at, null);
    if (parts) addPieces("Geom Dim and Tol Note", [parts]);
    else toast("Make a design layer active to place a note.", "info");
  }

  cancel(): void {
    this.press = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.press) return false;
    this.cancel();
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    const press = this.press;
    const parts = press && dist(p.screen, press.screen) > CLICK_PX ? this.parts(p.pos, press.at) : this.parts(press?.at ?? p.pos, null);
    if (parts) preview(g, parts);
  }

  /** The note at `at`, with a leader to `point` when given; null without a design layer. */
  private parts(at: Pt, point: Pt | null): Part[] | null {
    const scale = layerScale(this.env);
    if (scale === null) return null;
    const s = this.s;
    const inch = inchNotes();
    const fmt = (v: number): string => {
      let text = v.toFixed(s.precision);
      if (Number(text) === 0) text = text.replace("-", "");
      return inch ? text.replace(/^(-?)0\./, "$1.") : text;
    };
    const leader = point ? { point, side: s.side, shoulder: s.shoulderMm * scale } : null;
    const d = holeNote(s.note, at, degToRad(s.rotation), s.textMm * scale, fmt, leader);
    return d ? markerParts(d) : null;
  }
}

