// Dims/Notes' Grid Line and Reference Marker. Vectorworks makes plug-in objects of them; these draw
// what those objects draw, as plain 2D objects grouped in the active class, sizes on paper (times
// the layer scale). Esc cancels.
//
// Grid Line (gridLineShapes.ts): Parallel draws a straight grid line, a drag or two clicks, Shift
// in 15° steps from the last grid line (so parallel or square to it); Radial clicks a centre, then
// where the line starts and where it ends along the ray from the centre; Polyline clicks corners,
// a double-click or Enter ending it; Duplicate copies the last grid line drawn to where the pointer
// is, moved across, offset or turned about its centre, or by the offset or angle in Preferences.
// Each takes the next label, incremented as Vectorworks does.
// Reference Marker (markerShapes.ts): a bubble with the referenced drawing's number over its
// sheet's, the note under it; with a leader, Towards Target Object clicks the marker then the
// target, Towards Reference Marker the target then the marker.

import type { Pt } from "../../core/index.ts";
import { dist } from "../geom.ts";
import { gridLine, nextGridLabel, offsetPath, radialPath, sideOf, turnedPath, type BubbleEnds } from "../gridLineShapes.ts";
import { referenceMarker, type LeaderKind, type ReferenceLeader } from "../markerShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { addPieces, layerScale, preview, TwoPointTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** a bubble's diameter on paper, mm, before its scale factor */
const BUBBLE_MM = 10;
/** a reference marker's leader arrowhead on paper, mm */
const ARROW_MM = 3;
const ARROW_WIDTH_MM = 1.2;
/** Shift keeps a parallel grid line to steps of this from the last one */
const GRID_STEP_DEG = 15;
/** a press dragged further than this (CSS px) is a drag, and clicks closer count as one */
const CLICK_PX = 4;

const rad = (deg: number): number => (deg * Math.PI) / 180;

type GridMode = "parallel" | "radial" | "polyline" | "duplicate";

const GRID_MODES: readonly { readonly id: GridMode; readonly label: string }[] = [
  { id: "parallel", label: "Parallel" },
  { id: "radial", label: "Radial" },
  { id: "polyline", label: "Polyline" },
  { id: "duplicate", label: "Duplicate" },
];

const BUBBLE_ENDS: readonly { readonly value: BubbleEnds; readonly label: string }[] = [
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "both", label: "Both" },
  { value: "none", label: "None" },
];

/** A grid line placed, for Duplicate: its path, and a radial one's centre. */
interface Placed {
  readonly path: Pt[];
  readonly centre: Pt | null;
}

export class GridLineTool extends BaseTool {
  readonly id = "gridline";
  readonly cursor = "crosshair";
  private mode: GridMode = "parallel";
  private points: Pt[] = [];
  private cursorAt: Pt | null = null;
  private pressScreen: Pt | null = null;
  private next = "1";
  private skip = "";
  private shoulderStartMm = 5;
  private shoulderEndMm = 5;
  private bubbles: BubbleEnds = "start";
  private bubbleScale = 1;
  /** Duplicate's step across a straight or cornered line, and round a radial one's centre; 0 follows the pointer */
  private offset = 0;
  private stepDeg = 0;
  private last: Placed | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "Grid Line", options: GRID_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = GRID_MODES.find((m) => m.id === id);
    if (!mode) return;
    this.mode = mode.id;
    this.reset();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Grid Line Preferences",
      [
        { kind: "text", key: "next", label: "Next Grid Label", value: this.next },
        { kind: "text", key: "skip", label: "Do Not Include Characters", value: this.skip },
        { kind: "number", key: "shoulderStart", label: "Shoulder Length at Start", value: this.shoulderStartMm, min: 0, max: 200, unit: "mm" },
        { kind: "number", key: "shoulderEnd", label: "Shoulder Length at End", value: this.shoulderEndMm, min: 0, max: 200, unit: "mm" },
        { kind: "choice", key: "bubbles", label: "Show Bubble at", value: this.bubbles, options: BUBBLE_ENDS },
        { kind: "number", key: "scale", label: "Bubble Scale Factor", value: this.bubbleScale, min: 0.1, max: 20 },
        { kind: "length", key: "offset", label: "Duplicate Offset", value: this.offset, zero: true },
        { kind: "number", key: "step", label: "Duplicate Angle", value: this.stepDeg, min: 0, max: 180, unit: "°" },
      ],
      "Shoulders and the bubble (10 mm across, times its scale factor) are on paper: a layer at 1:n draws them n times larger. Each grid line takes the next label, which then steps on as Vectorworks steps one: only the rightmost run of digits or of letters of one case, 1.9 to 2.0, 09 to 10, Z to AA, ZZ to AAA, past any label holding a character not to include. Duplicate copies the last grid line drawn toward the pointer: by the offset (or angle, for a radial line) when it is more than 0, else to the pointer.",
    );
    if (!v) return;
    this.next = v.choice("next");
    this.skip = v.choice("skip");
    this.shoulderStartMm = v.num("shoulderStart");
    this.shoulderEndMm = v.num("shoulderEnd");
    this.bubbles = BUBBLE_ENDS.find((b) => b.value === v.choice("bubbles"))?.value ?? "start";
    this.bubbleScale = v.num("scale");
    this.offset = v.num("offset");
    this.stepDeg = v.num("step");
  }

  snapFrom(): Pt | null {
    return this.points.at(-1) ?? null;
  }

  hint(): string {
    const keys = `label ${this.next || "none"} · 1–4 mode`;
    const n = this.points.length;
    if (this.mode === "parallel") return n ? `Click or release at its end · Shift ${GRID_STEP_DEG}° from the last grid line` : `Drag a grid line or click its start · ${keys}`;
    if (this.mode === "radial") return n === 0 ? `Click the centre · ${keys}` : n === 1 ? "Click where the line starts, at its bubble" : "Click where it ends, along the ray from the centre";
    if (this.mode === "polyline") return n ? "Click the next corner · double-click or Enter ends it" : `Click the grid line's start · ${keys}`;
    return this.last ? `Click where the copy goes · ${keys}` : "Draw a grid line first: Duplicate copies the last one drawn";
  }

  down(p: PointerInfo): void {
    this.pressScreen = p.screen;
    const pos = this.at(p);
    const last = this.points.at(-1);
    const fresh = !last || dist(last, pos) * this.env.view.scale > CLICK_PX;
    if (this.mode === "parallel") {
      if (!last) this.points = [pos];
      else this.finish(fresh ? [last, pos] : null, null);
    } else if (this.mode === "radial") {
      if (fresh) this.points.push(pos);
      if (this.points.length === 3) this.finish(radialPath(this.points[0], this.points[1], this.points[2]), this.points[0]);
    } else if (this.mode === "polyline") {
      if (fresh) this.points.push(pos);
      if (p.detail >= 2 && this.points.length >= 2) this.finish(this.points, null);
    } else if (!this.last) {
      toast("Draw a grid line first: Duplicate copies the last one drawn.", "info");
    } else {
      const copy = this.copy(pos);
      this.finish(copy?.path ?? null, copy?.centre ?? null);
    }
  }

  move(p: PointerInfo): void {
    this.cursorAt = this.at(p);
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.mode === "parallel" && this.points.length === 1 && press && dist(p.screen, press) > CLICK_PX) this.finish([this.points[0], this.at(p)], null);
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (this.points.length === 0) return false;
    if (e.key === "Enter" && this.mode === "polyline" && this.points.length >= 2) this.finish(this.points, null);
    else if (e.key === "Escape") this.reset();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    if (!at) return;
    const pts = this.points;
    let path: Pt[] | null = null;
    if (this.mode === "duplicate") path = this.last ? (this.copy(at)?.path ?? null) : null;
    else if (this.mode === "radial" && pts.length === 1) {
      preview(g, [{ kind: "polyline", points: [pts[0], at], closed: false }]);
      return;
    } else if (this.mode === "radial" && pts.length === 2) path = radialPath(pts[0], pts[1], at);
    else if (pts.length) path = [...pts, at];
    const parts = path && this.parts(path);
    if (parts) preview(g, parts);
  }

  /** The pointer's point; Shift keeps a parallel line to 15° steps from the last grid line's direction. */
  private at(p: PointerInfo): Pt {
    const from = this.points[0];
    if (this.mode !== "parallel" || !from || !p.shift) return p.pos;
    const ref = this.last?.path;
    const base = ref ? Math.atan2(ref[1].y - ref[0].y, ref[1].x - ref[0].x) : 0;
    const len = dist(from, p.pos);
    const step = rad(GRID_STEP_DEG);
    const a = base + Math.round((Math.atan2(p.pos.y - from.y, p.pos.x - from.x) - base) / step) * step;
    return { x: from.x + Math.cos(a) * len, y: from.y + Math.sin(a) * len };
  }

  /** The last grid line moved toward `to`: turned about a radial line's centre, else offset across. */
  private copy(to: Pt): Placed | null {
    const last = this.last;
    if (!last) return null;
    if (last.centre) {
      const c = last.centre;
      let turn = Math.atan2(to.y - c.y, to.x - c.x) - Math.atan2(last.path[0].y - c.y, last.path[0].x - c.x);
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      if (this.stepDeg > 0) turn = Math.sign(turn) * rad(this.stepDeg);
      return turn ? { path: turnedPath(last.path, c, turn), centre: c } : null;
    }
    let by = sideOf(last.path, to);
    if (this.offset > 0) by = Math.sign(by) * this.offset;
    const path = by ? offsetPath(last.path, by) : null;
    return path ? { path, centre: null } : null;
  }

  private parts(path: readonly Pt[]): Part[] | null {
    const scale = layerScale(this.env);
    if (scale === null) return null;
    const d = gridLine(path, {
      label: this.next,
      r: (BUBBLE_MM / 2) * this.bubbleScale * scale,
      shoulderStart: this.shoulderStartMm * scale,
      shoulderEnd: this.shoulderEndMm * scale,
      bubbles: this.bubbles,
    });
    return d ? markerParts(d) : null;
  }

  private finish(path: Pt[] | null, centre: Pt | null): void {
    this.reset();
    const parts = path && this.parts(path);
    if (!path || !parts) {
      toast(this.mode === "duplicate" ? "Move the pointer off the grid line to copy it there." : "Draw a grid line with some length.", "info");
      return;
    }
    addPieces("Grid Line", [parts]);
    this.last = { path, centre };
    this.next = nextGridLabel(this.next, this.skip);
  }

  private reset(): void {
    this.points = [];
    this.pressScreen = null;
  }
}

type ClickOrder = "toTarget" | "toMarker";

const CLICK_ORDERS: readonly { readonly id: ClickOrder; readonly label: string }[] = [
  { id: "toTarget", label: "Towards Target Object" },
  { id: "toMarker", label: "Towards Reference Marker" },
];
const LEADER_KINDS: readonly { readonly value: LeaderKind; readonly label: string }[] = [
  { value: "line", label: "Line" },
  { value: "arc", label: "Arc" },
  { value: "bezier", label: "Bézier" },
];
const POSITIONS: readonly { readonly value: string; readonly label: string; readonly side: ReferenceLeader["side"] }[] = [
  { value: "auto", label: "Auto", side: 0 },
  { value: "left", label: "Left", side: -1 },
  { value: "right", label: "Right", side: 1 },
];

export class ReferenceMarkerTool extends TwoPointTool {
  readonly id = "refmarker";
  readonly cursor = "crosshair";
  protected readonly label = "Reference Marker";
  private order: ClickOrder = "toTarget";
  private number = "1";
  private sheet = "A-501";
  private note = "";
  private arrow = false;
  private arrowDeg = 0;
  private leader = true;
  private leaderKind: LeaderKind = "line";
  private shoulderMm = 5;
  private radiusMm = 10;
  private position = "auto";
  private markerDeg = 0;
  private markerScale = 1;

  modes(): readonly ToolModes[] {
    return [{ label: "Reference Marker", options: CLICK_ORDERS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.order }];
  }

  setMode(id: string): void {
    const order = CLICK_ORDERS.find((m) => m.id === id);
    if (order) this.order = order.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Reference Marker Preferences",
      [
        { kind: "text", key: "number", label: "Drawing Number", value: this.number },
        { kind: "text", key: "sheet", label: "Sheet Number", value: this.sheet },
        { kind: "text", key: "note", label: "Note", value: this.note },
        { kind: "check", key: "arrow", label: "Arrow on Marker", value: this.arrow },
        { kind: "number", key: "arrowAngle", label: "Arrow Angle", value: this.arrowDeg, min: -360, max: 360, unit: "°" },
        { kind: "check", key: "leader", label: "Use leader", value: this.leader },
        { kind: "choice", key: "kind", label: "Leader Type", value: this.leaderKind, options: LEADER_KINDS },
        { kind: "number", key: "shoulder", label: "Shoulder Length", value: this.shoulderMm, min: 0, max: 200, unit: "mm" },
        { kind: "number", key: "radius", label: "Leader Radius", value: this.radiusMm, min: 0, max: 1000, unit: "mm" },
        { kind: "choice", key: "position", label: "Horizontal Position", value: this.position, options: POSITIONS },
        { kind: "number", key: "markerAngle", label: "Marker Angle", value: this.markerDeg, min: -90, max: 90, unit: "°" },
        { kind: "number", key: "scale", label: "Marker Scale Factor", value: this.markerScale, min: 0.1, max: 20 },
      ],
      "The bubble (10 mm across, times the scale factor), the shoulder, an arc leader's radius and the leader's arrowhead are on paper: a layer at 1:n draws them n times larger. The note sits under the bubble. The shoulder runs from the leader to the bubble, left or right, Auto away from the target, at the marker angle from level; an arrow on the marker points at the arrow angle (0 to the right). Without a leader a click places the marker.",
    );
    if (!v) return;
    this.number = v.choice("number");
    this.sheet = v.choice("sheet");
    this.note = v.choice("note");
    this.arrow = v.flag("arrow");
    this.arrowDeg = v.num("arrowAngle");
    this.leader = v.flag("leader");
    this.leaderKind = LEADER_KINDS.find((k) => k.value === v.choice("kind"))?.value ?? "line";
    this.shoulderMm = v.num("shoulder");
    this.radiusMm = v.num("radius");
    this.position = v.choice("position");
    this.markerDeg = v.num("markerAngle");
    this.markerScale = v.num("scale");
  }

  hint(): string {
    if (!this.leader) return "Click to place the marker";
    const first = this.order === "toTarget" ? "the marker" : "the target";
    const second = this.order === "toTarget" ? "the target the leader points at" : "the marker";
    return `${this.start() ? `Click or release at ${second}` : `Click ${first}, then ${second}`} · 1–2 click order`;
  }

  protected oneClick(at: Pt): Part[] | null | undefined {
    return this.leader ? undefined : this.marker(at, null);
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    return this.order === "toTarget" ? this.marker(a, b) : this.marker(b, a);
  }

  protected refusal(): string {
    return this.leader ? "Click the target outside the marker's bubble and shoulder." : "The marker's Preferences don't make one.";
  }

  private marker(c: Pt, target: Pt | null): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const leader: ReferenceLeader | null = target && {
      target,
      kind: this.leaderKind,
      radius: this.radiusMm * scale,
      shoulder: this.shoulderMm * scale,
      angle: rad(this.markerDeg),
      side: POSITIONS.find((p) => p.value === this.position)?.side ?? 0,
      arrowLength: ARROW_MM * scale,
      arrowWidth: ARROW_WIDTH_MM * scale,
    };
    const d = referenceMarker(c, (BUBBLE_MM / 2) * this.markerScale * scale, this.number, this.sheet, this.note, this.arrow ? rad(this.arrowDeg) : null, leader);
    return d ? markerParts(d) : null;
  }
}
