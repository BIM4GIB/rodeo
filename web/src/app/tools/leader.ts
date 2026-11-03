// Basic's Leader Line Simple and Leader Line. Leader Line Simple draws a leader as Vectorworks
// Fundamentals does: click the start of the shoulder, then where the shoulder ends and the leader
// starts, then the leader's end, which gets the Attributes palette's end marker (Vectorworks'
// default arrow when it has none). Leader Line places one from where it points and where its
// leader meets the shoulder: the shoulder runs level from there its Shoulder Length on paper, on
// the side its text goes (Arrows), and the point gets the marker its preferences set. Each is an
// open polygon with a real line marker, so the Attributes palette and Object Info edit it like any
// line. Shift keeps a segment to 15° steps; Esc cancels.

import type { EditSession, MarkerStyle, Pt } from "../../core/index.ts";
import { addAndSelect } from "../commands.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { makeMarker } from "../optionLists.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../tools.ts";
import { layerScale } from "./detailing.ts";

const MM_PER_INCH = 25.4;
/** Vectorworks' default arrow: 1/8 inch at 15° */
const DEFAULT_ARROW = makeMarker("arrow", 1 / 8, 15);
/** clicks closer than this (CSS px) count as the same point */
const SAME_PX = 3;

/** A leader's clicks, previewed as they're placed, made an open polygon on the last one. */
abstract class LeaderTool extends BaseTool {
  readonly cursor = "crosshair";
  private points: Pt[] = [];
  private lastScreen: Pt | null = null;
  private cursorAt: Pt | null = null;

  /** how many clicks place the leader */
  protected abstract readonly clicks: number;
  /** The leader's points from its clicks so far (the marker at the last), or why it can't be drawn. */
  protected abstract shape(points: readonly Pt[]): Pt[] | string;
  /** Sets the new leader's markers. */
  protected abstract mark(s: EditSession, id: string): void;

  down(p: PointerInfo): void {
    if (p.detail > 1) return;
    if (this.lastScreen && dist(p.screen, this.lastScreen) < SAME_PX) return;
    this.points.push(this.at(p));
    this.lastScreen = p.screen;
    if (this.points.length < this.clicks) return;
    const pts = this.shape(this.points);
    this.reset();
    if (typeof pts === "string") toast(pts, "info");
    else addAndSelect({ kind: "polygon", points: pts, closed: false }, undefined, (s, id) => this.mark(s, id));
  }

  move(p: PointerInfo): void {
    this.cursorAt = this.at(p);
  }

  snapFrom(): Pt | null {
    return this.points.at(-1) ?? null;
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || this.points.length === 0) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    if (this.points.length === 0 || !this.cursorAt) return;
    const pts = this.shape([...this.points, this.cursorAt]);
    if (typeof pts !== "string") withPreview(g, () => strokeScreen(g, pts, false));
  }

  protected placed(): number {
    return this.points.length;
  }

  private at(p: PointerInfo): Pt {
    const last = this.points.at(-1);
    return last && p.shift ? snapAngle(last, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private reset(): void {
    this.points = [];
    this.lastScreen = null;
  }
}

export class LeaderLineSimpleTool extends LeaderTool {
  readonly id = "leadersimple";
  protected readonly clicks = 3;

  hint(): string {
    const step = ` · Shift ${ANGLE_STEP_DEG}°`;
    return ["Click the start of the shoulder", "Click where the shoulder ends and the leader starts" + step, "Click the leader's end" + step][this.placed()] ?? "";
  }

  protected shape(points: readonly Pt[]): Pt[] {
    return [...points];
  }

  protected mark(s: EditSession, id: string): void {
    // the Attributes palette's markers are on it already; without an end marker it gets the default arrow
    if (!store.drawEffects.end) s.setLineMarkers([id], { end: DEFAULT_ARROW });
  }
}

type TextSide = "auto" | "left" | "right";
const SIDES: readonly { readonly value: TextSide; readonly label: string }[] = [
  { value: "auto", label: "Away from the Point" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];
const STYLES: readonly { readonly value: MarkerStyle | "none"; readonly label: string }[] = [
  { value: "arrow", label: "Arrow" },
  { value: "dot", label: "Dot" },
  { value: "slash", label: "Slash" },
  { value: "none", label: "None" },
];

export class LeaderLineTool extends LeaderTool {
  readonly id = "leaderline";
  protected readonly clicks = 2;
  /** paper mm */
  private shoulderMm = 6;
  private side: TextSide = "auto";
  private style: MarkerStyle | "none" = "arrow";
  /** paper mm and degrees */
  private markerMm = MM_PER_INCH / 8;
  private markerAngle = 15;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Leader Line Preferences",
      [
        { kind: "number", key: "shoulder", label: "Shoulder Length", value: this.shoulderMm, min: 0, max: 100, unit: "mm" },
        { kind: "choice", key: "side", label: "Arrows", value: this.side, options: SIDES.map((s) => ({ value: s.value, label: s.label })) },
        { kind: "choice", key: "style", label: "Marker Style", value: this.style, options: STYLES.map((s) => ({ value: s.value, label: s.label })) },
        { kind: "number", key: "size", label: "Marker Size", value: this.markerMm, min: 0.1, max: 99, unit: "mm" },
        { kind: "number", key: "angle", label: "Marker Angle", value: this.markerAngle, min: 1, max: 89, unit: "°" },
      ],
      "Click where the leader points, then where it meets the shoulder; Shift keeps the leader to 15° steps. The shoulder runs level from there the Shoulder Length on paper, toward the side the text goes (Arrows: away from the point, left or right), and the point gets the marker: an arrow (its size tip to base and each side's angle to the line), a dot (its diameter) or a slash. It's an open polygon with a line marker, so the Attributes palette edits it afterwards. Control points on the marker and shoulder, and text kept with the leader, aren't kept.",
    );
    if (!v) return;
    this.shoulderMm = v.num("shoulder");
    this.side = SIDES.find((s) => s.value === v.choice("side"))?.value ?? this.side;
    this.style = STYLES.find((s) => s.value === v.choice("style"))?.value ?? this.style;
    this.markerMm = v.num("size");
    this.markerAngle = v.num("angle");
  }

  hint(): string {
    return this.placed() === 0 ? "Click where the leader points" : `Click where the leader meets the shoulder · Shift ${ANGLE_STEP_DEG}°`;
  }

  protected shape(points: readonly Pt[]): Pt[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a layer active to draw a leader line.";
    const [tip, joint] = points;
    if (!joint) return [tip!];
    const dir = this.side === "left" ? -1 : this.side === "right" ? 1 : joint.x >= tip!.x ? 1 : -1;
    const shoulder = this.shoulderMm * scale;
    return shoulder > 0 ? [{ x: joint.x + dir * shoulder, y: joint.y }, joint, tip!] : [joint, tip!];
  }

  protected mark(s: EditSession, id: string): void {
    // its own marker at the point, none at the shoulder, whatever the Attributes palette holds
    s.setLineMarkers([id], { start: null, end: this.style === "none" ? null : makeMarker(this.style, this.markerMm / MM_PER_INCH, this.markerAngle) });
  }
}
