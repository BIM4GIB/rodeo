// Furniture/Fixtures' Railing/Fence and Site Planning's Stake, Parking Along Path and Parking
// Area. Vectorworks makes plug-in objects of them; these draw what those objects draw in plan, as
// plain 2D objects grouped in the active class. Esc cancels.
//
// Railing/Fence (railingShapes.ts): click each corner of its path; a double-click or Enter ends it
// open, a click on the first corner closes it. Its top rail, posts and frame or panel are set in
// Preferences as on Vectorworks' Top Rail, Post and Frame/Panel panes.
// Stake (stakeShapes.ts): Standard Insertion places one stake with a click, or with a press
// dragged to where its label goes (with a leader line back to the stake); Poly-Vertex clicks a
// path and places a stake at each corner, a double-click or Enter ending it. Its label shows its ID,
// elevation, description or coordinates from the drawing's origin.
// Parking Along Path and Parking Area (parkingShapes.ts) click a path as Railing/Fence does: stalls
// either side of it, or rows of them filling the area it outlines (closed even when ended open).

import type { EditSession, Pt } from "../../core/index.ts";
import { attempt, setEditGroup } from "../commands.ts";
import { degToRad, dist } from "../geom.ts";
import { MAX_PARKING_STALLS, parkingAlongPath, parkingArea, type AlongPath, type Area } from "../parkingShapes.ts";
import { railing, type CornerPosts, type Railing, type PostArrangement, type RailInfill, type RailProfile } from "../railingShapes.ts";
import { stake, type StakeBubble, type StakeLabelPosition, type StakeStyle } from "../stakeShapes.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { formatLength, formatLengthValue } from "../units.ts";
import { cloudOutline } from "./cloud.ts";
import { addPart, addPieces, drawn, layerScale, preview, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** a press dragged further than this (CSS px) is a drag, and clicks closer count as one */
const CLICK_PX = 4;
/** a click this close (CSS px) to a path's first corner closes it */
const CLOSE_PX = 8;
/** a stake's label and indicator on paper, mm (the indicator times its scale factor) */
const STAKE_TEXT_MM = 2.5;
const STAKE_MARK_MM = 3;
/** parking stall numbers' height on paper, mm, until Preferences change it */
const PARKING_TEXT_MM = 2.5;

const units = (): string | undefined => store.session?.doc.info.units;

const options = <T extends string>(list: readonly { readonly id: T; readonly label: string }[]) => list.map((o) => ({ value: o.id, label: o.label }));
const pick = <T extends string>(list: readonly { readonly id: T }[], id: string, fallback: T): T => list.find((o) => o.id === id)?.id ?? fallback;

/** Corners clicked one by one: a double-click or Enter ends the path open, a click on the first corner (of three or more) closes it. */
export class ClickedPath {
  points: Pt[] = [];

  /** Takes a press; returns the path when it ends, with whether it closed. */
  click(p: PointerInfo, scale: number, closable: boolean): { points: Pt[]; closed: boolean } | null {
    // a third press of a double-click that ended a path starts no new one
    if (p.detail > 2 && this.points.length === 0) return null;
    const first = this.points[0];
    if (closable && this.points.length >= 3 && dist(p.pos, first) * scale <= CLOSE_PX) return this.end(true);
    const last = this.points.at(-1);
    if (!last || dist(last, p.pos) * scale > CLICK_PX) this.points.push(p.pos);
    return p.detail >= 2 && this.points.length >= 2 ? this.end(false) : null;
  }

  end(closed: boolean): { points: Pt[]; closed: boolean } {
    const points = this.points;
    this.points = [];
    return { points, closed };
  }
}

/**
 * A tool drawing from a clicked path: each corner clicked, a double-click or Enter ending it open,
 * a click on the first corner (of three or more) closing it, with what it will draw shown as the
 * path grows. `parts` gives what the path draws, or a message when it can't.
 */
export abstract class PathTool extends BaseTool {
  readonly cursor = "crosshair";
  protected abstract readonly label: string;
  private readonly path = new ClickedPath();
  private cursorAt: Pt | null = null;

  protected abstract parts(points: Pt[], closed: boolean): Part[] | string;
  /** what the path shows while it grows: what it draws, unless that draws curves `preview` would show as corners */
  protected previewParts(points: Pt[], closed: boolean): Part[] | string {
    return this.parts(points, closed);
  }
  /** what to click first */
  protected abstract startHint(): string;

  snapFrom(): Pt | null {
    return this.path.points.at(-1) ?? null;
  }

  hint(): string {
    return this.path.points.length ? "Click the next corner · double-click or Enter ends it, a click on the first corner closes it" : this.startHint();
  }

  down(p: PointerInfo): void {
    const done = this.path.click(p, this.env.view.scale, true);
    if (done) this.finish(done.points, done.closed);
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.path.points = [];
  }

  key(e: KeyboardEvent): boolean {
    if (this.path.points.length === 0) return false;
    if (e.key === "Enter" && this.path.points.length >= 2) {
      const done = this.path.end(false);
      this.finish(done.points, done.closed);
    } else if (e.key === "Escape") this.path.points = [];
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    const pts = this.path.points;
    if (!at || pts.length === 0) return;
    const parts = this.previewParts([...pts, at], false);
    if (typeof parts === "string") withPreview(g, () => strokeScreen(g, [...pts, at], false));
    else preview(g, parts);
  }

  /** after the path's parts are added */
  protected added(_points: Pt[], _closed: boolean): void {}

  protected finish(points: Pt[], closed: boolean): void {
    const parts = this.parts(points, closed);
    if (typeof parts === "string") toast(parts, "info");
    else {
      addPieces(this.label, [parts]);
      this.added(points, closed);
    }
  }
}

const PROFILES: readonly { readonly id: RailProfile; readonly label: string }[] = [
  { id: "round", label: "Round" },
  { id: "rect", label: "Rectangular" },
  { id: "octagon", label: "Octagon" },
];
const CORNERS: readonly { readonly id: CornerPosts; readonly label: string }[] = [
  { id: "none", label: "No post at corners" },
  { id: "one", label: "Place post at corner" },
  { id: "two", label: "Place two posts at corner" },
];
const ARRANGEMENTS: readonly { readonly id: PostArrangement; readonly label: string }[] = [
  { id: "approximate", label: "Approximate Distance" },
  { id: "fixed", label: "Fixed Distance" },
  { id: "number", label: "Number of Posts" },
];
const INFILLS: readonly { readonly id: RailInfill; readonly label: string }[] = [
  { id: "none", label: "None" },
  { id: "vertical", label: "Frame: vertical bars" },
  { id: "horizontal", label: "Frame: horizontal bars" },
  { id: "panel", label: "Panel" },
];
const BAR_PROFILES: readonly { readonly id: "round" | "rect"; readonly label: string }[] = [
  { id: "round", label: "Round" },
  { id: "rect", label: "Rectangular" },
];

export class RailingTool extends BaseTool {
  readonly id = "railing";
  readonly cursor = "crosshair";
  private readonly path = new ClickedPath();
  private cursorAt: Pt | null = null;
  private rail: Railing = {
    offset: 0,
    topRail: true,
    railWidth: 50,
    railEndsAtPost: false,
    posts: true,
    showPosts: true,
    postProfile: "rect",
    postWidth: 50,
    postDepth: 50,
    startPost: true,
    startDistance: 0,
    endPost: true,
    endDistance: 0,
    cornerPosts: "one",
    cornerDistance: 150,
    arrangement: "approximate",
    spacing: 1500,
    count: 5,
    infill: "vertical",
    barProfile: "round",
    barSize: 12,
    barSpacing: 100,
    panelThickness: 10,
  };

  async preferences(): Promise<void> {
    const r = this.rail;
    const v = await toolPrefs(
      "Railing/Fence Preferences",
      [
        { kind: "length", key: "offset", label: "Offset from path", value: r.offset, signed: true, zero: true },
        { kind: "check", key: "topRail", label: "Top rail", value: r.topRail },
        { kind: "length", key: "railWidth", label: "Top rail width or diameter", value: r.railWidth },
        { kind: "check", key: "railEndsAtPost", label: "Top rail ends at post", value: r.railEndsAtPost },
        { kind: "choice", key: "posts", label: "Post option", value: r.posts ? "post" : "none", options: [{ value: "post", label: "Post" }, { value: "none", label: "No Post" }] },
        { kind: "check", key: "showPosts", label: "Display posts in 2D view", value: r.showPosts },
        { kind: "choice", key: "postProfile", label: "Post profile", value: r.postProfile, options: options(PROFILES) },
        { kind: "length", key: "postWidth", label: "Post width or diameter", value: r.postWidth },
        { kind: "length", key: "postDepth", label: "Rectangular post depth", value: r.postDepth },
        { kind: "check", key: "startPost", label: "Place post at starting point", value: r.startPost },
        { kind: "length", key: "startDistance", label: "Distance from start", value: r.startDistance, zero: true },
        { kind: "check", key: "endPost", label: "Place post at end point", value: r.endPost },
        { kind: "length", key: "endDistance", label: "Distance from end", value: r.endDistance, zero: true },
        { kind: "choice", key: "cornerPosts", label: "Corners", value: r.cornerPosts, options: options(CORNERS) },
        { kind: "length", key: "cornerDistance", label: "Two posts' distance from the corner", value: r.cornerDistance },
        { kind: "choice", key: "arrangement", label: "Arrangement", value: r.arrangement, options: options(ARRANGEMENTS) },
        { kind: "length", key: "spacing", label: "Distance", value: r.spacing },
        { kind: "number", key: "count", label: "Number of posts", value: r.count, min: 1, max: 1000, integer: true },
        { kind: "choice", key: "infill", label: "Frame/Panel", value: r.infill, options: options(INFILLS) },
        { kind: "choice", key: "barProfile", label: "Frame bar shape", value: r.barProfile, options: options(BAR_PROFILES) },
        { kind: "length", key: "barSize", label: "Frame bar thickness", value: r.barSize },
        { kind: "length", key: "barSpacing", label: "Maximum distance between bars", value: r.barSpacing },
        { kind: "length", key: "panelThickness", label: "Panel thickness", value: r.panelThickness },
      ],
      "Drawn in plan: the top rail as a band its width along the path, over the frame or panel between posts, the posts over it. A positive offset puts the railing left of the way it's drawn. Posts stand at the start and end, at the corners, and between them by the arrangement.",
    );
    if (!v) return;
    this.rail = {
      offset: v.num("offset"),
      topRail: v.flag("topRail"),
      railWidth: v.num("railWidth"),
      railEndsAtPost: v.flag("railEndsAtPost"),
      posts: v.choice("posts") === "post",
      showPosts: v.flag("showPosts"),
      postProfile: pick(PROFILES, v.choice("postProfile"), "rect"),
      postWidth: v.num("postWidth"),
      postDepth: v.num("postDepth"),
      startPost: v.flag("startPost"),
      startDistance: v.num("startDistance"),
      endPost: v.flag("endPost"),
      endDistance: v.num("endDistance"),
      cornerPosts: pick(CORNERS, v.choice("cornerPosts"), "one"),
      cornerDistance: v.num("cornerDistance"),
      arrangement: pick(ARRANGEMENTS, v.choice("arrangement"), "approximate"),
      spacing: v.num("spacing"),
      count: v.num("count"),
      infill: pick(INFILLS, v.choice("infill"), "vertical"),
      barProfile: pick(BAR_PROFILES, v.choice("barProfile"), "round"),
      barSize: v.num("barSize"),
      barSpacing: v.num("barSpacing"),
      panelThickness: v.num("panelThickness"),
    };
  }

  snapFrom(): Pt | null {
    return this.path.points.at(-1) ?? null;
  }

  hint(): string {
    return this.path.points.length ? "Click the next corner · double-click or Enter ends it, a click on the first corner closes it" : "Click the railing's start";
  }

  down(p: PointerInfo): void {
    const done = this.path.click(p, this.env.view.scale, true);
    if (done) this.finish(done.points, done.closed);
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
  }

  cancel(): void {
    this.path.points = [];
  }

  key(e: KeyboardEvent): boolean {
    if (this.path.points.length === 0) return false;
    if (e.key === "Enter" && this.path.points.length >= 2) {
      const done = this.path.end(false);
      this.finish(done.points, done.closed);
    } else if (e.key === "Escape") this.path.points = [];
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    const pts = this.path.points;
    if (!at || pts.length === 0) return;
    const parts = this.parts([...pts, at], false);
    if (typeof parts === "string") withPreview(g, () => strokeScreen(g, [...pts, at], false));
    else preview(g, parts);
  }

  private parts(points: Pt[], closed: boolean): Part[] | string {
    const plan = railing(points, closed, this.rail);
    return typeof plan === "string" ? plan : [...drawn(plan.infill), ...drawn(plan.rail), ...drawn(plan.posts)];
  }

  private finish(points: Pt[], closed: boolean): void {
    const parts = this.parts(points, closed);
    if (typeof parts === "string") toast(parts, "info");
    else if (parts.length === 0) toast("The railing draws nothing: turn on its top rail or its posts in Preferences.", "info");
    else addPieces("Railing/Fence", [parts]);
  }
}

type StakeMode = "standard" | "polyVertex";
export type StakeLabel = "id" | "elevation" | "description" | "idElevation" | "idDescription" | "descriptionElevation" | "ne" | "en" | "xy" | "none";

const STAKE_MODES: readonly { readonly id: StakeMode; readonly label: string }[] = [
  { id: "standard", label: "Standard Insertion" },
  { id: "polyVertex", label: "Poly-Vertex Placement" },
];
export const STAKE_STYLES: readonly { readonly id: StakeStyle; readonly label: string }[] = [
  { id: "none", label: "None" },
  { id: "triangle", label: "Triangle" },
  { id: "filledTriangle", label: "Filled Triangle" },
  { id: "circle", label: "Circle" },
  { id: "dot", label: "Dot" },
  { id: "cross", label: "Cross" },
  { id: "circleCross", label: "Circle Cross" },
  { id: "tick", label: "Tick Mark" },
];
const BUBBLES: readonly { readonly id: StakeBubble; readonly label: string }[] = [
  { id: "none", label: "None" },
  { id: "box", label: "Box" },
  { id: "roundRect", label: "Round Rect" },
  { id: "cloud", label: "Cloud" },
  { id: "hexagonal", label: "Hexagonal" },
  { id: "circle", label: "Circle" },
];
export const STAKE_LABELS: readonly { readonly id: StakeLabel; readonly label: string }[] = [
  { id: "id", label: "ID" },
  { id: "elevation", label: "Elevation" },
  { id: "description", label: "Description" },
  { id: "idElevation", label: "ID/Elevation" },
  { id: "idDescription", label: "ID/Description" },
  { id: "descriptionElevation", label: "Description/Elevation" },
  { id: "ne", label: "Coordinate Point (NE - Northing-Easting)" },
  { id: "en", label: "Coordinate Point (EN - Easting-Northing)" },
  { id: "xy", label: "Coordinate Point (XY)" },
  { id: "none", label: "No Label" },
];
const POSITIONS: readonly { readonly id: StakeLabelPosition; readonly label: string }[] = [
  { id: "auto", label: "Auto" },
  { id: "right", label: "Right" },
  { id: "left", label: "Left" },
  { id: "center", label: "Center" },
];

/** What a stake is drawn with: the Stake tool's Preferences, and the dialog of Modify > Convert > Stake Object from 3D Locus. */
export interface StakeSettings {
  z: number;
  style: StakeStyle;
  bubble: StakeBubble;
  /** paper mm */
  cornerRadiusMm: number;
  marginMm: number;
  markOffsetX: number;
  markOffsetY: number;
  /** degrees */
  markRotation: number;
  label: StakeLabel;
  position: StakeLabelPosition;
  description: string;
  prefix: string;
  suffix: string;
  autoId: boolean;
  /** the next stake's ID number */
  idNumber: number;
  showElevation: boolean;
  unitMark: boolean;
  leader: boolean;
  scaleFactor: number;
}

export const newStakeSettings = (): StakeSettings => ({
  z: 0,
  style: "triangle",
  bubble: "none",
  cornerRadiusMm: 1,
  marginMm: 1,
  markOffsetX: 0,
  markOffsetY: 0,
  markRotation: 0,
  label: "elevation",
  position: "auto",
  description: "",
  prefix: "",
  suffix: "",
  autoId: true,
  idNumber: 1,
  showElevation: false,
  unitMark: true,
  leader: true,
  scaleFactor: 1,
});

/** The label's lines for a stake at `at`, numbered `step` past the next ID. */
function stakeLines(k: StakeSettings, at: Pt, step: number): string[] {
  const u = units();
  const length = (mm: number): string => (k.unitMark ? formatLength(mm, u) : formatLengthValue(mm, u));
  const id = `${k.prefix}${Math.round(k.idNumber) + (k.autoId ? step : 0)}${k.suffix}`;
  const elevation = length(k.z);
  const north = `${at.y >= 0 ? "N" : "S"} ${length(Math.abs(at.y))}`;
  const east = `${at.x >= 0 ? "E" : "W"} ${length(Math.abs(at.x))}`;
  const withElevation = (lines: string[]): string[] => (k.showElevation ? [...lines, elevation] : lines);
  switch (k.label) {
    case "id":
      return [id];
    case "elevation":
      return [elevation];
    case "description":
      return k.description ? [k.description] : [];
    case "idElevation":
      return [`${id} / ${elevation}`];
    case "idDescription":
      return [`${id} / ${k.description}`];
    case "descriptionElevation":
      return [`${k.description} / ${elevation}`];
    case "ne":
      return withElevation([north, east]);
    case "en":
      return withElevation([east, north]);
    case "xy":
      return withElevation([`X ${length(at.x)}`, `Y ${length(at.y)}`]);
    case "none":
      return [];
  }
}

/** A stake's parts on a layer at 1:`scale`, or null when it would draw nothing. */
export function stakeParts(k: StakeSettings, at: Pt, labelAt: Pt | null, step: number, scale: number): Part[] | null {
  const h = STAKE_TEXT_MM * scale;
  const d = stake(at, labelAt, stakeLines(k, at, step), {
    style: k.style,
    bubble: k.bubble,
    markSize: STAKE_MARK_MM * scale * k.scaleFactor,
    markOffset: { x: k.markOffsetX, y: k.markOffsetY },
    markRotation: degToRad(k.markRotation),
    textHeight: h,
    margin: k.marginMm * scale,
    cornerRadius: k.cornerRadiusMm * scale,
    position: k.position,
    leader: k.leader,
  });
  const cloud = d.cloud ? cloudOutline(d.cloud, h) : null;
  const parts = [...(cloud ? [{ kind: "polygon", points: cloud, closed: true } as const] : []), ...markerParts(d)];
  return parts.length ? parts : null;
}

/** Stakes as groups, each its drawing and a 3D locus at its height above the layer, which a site model reads as source data. */
export function addStakeGroups(s: EditSession, layerId: string, stakes: readonly { readonly parts: readonly Part[]; readonly at: Pt; readonly z: number }[]): string[] {
  const loci = s.add3DLoci(layerId, stakes.map((k) => [k.at.x, k.at.y, k.z]), store.activeClassIndex);
  return s.groupEach(stakes.map((k, i) => [...k.parts.map((part) => addPart(s, layerId, part)), loci[i]]));
}

export class StakeTool extends BaseTool {
  readonly id = "stake";
  readonly cursor = "crosshair";
  private mode: StakeMode = "standard";
  private readonly path = new ClickedPath();
  private press: { at: Pt; screen: Pt } | null = null;
  private pointer: PointerInfo | null = null;
  private readonly s = newStakeSettings();

  modes(): readonly ToolModes[] {
    return [{ label: "Stake", options: STAKE_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = STAKE_MODES.find((m) => m.id === id);
    if (!mode || mode.id === this.mode) return;
    this.mode = mode.id;
    this.cancel();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Stake Preferences",
      [
        { kind: "length", key: "z", label: "Z-value", value: this.s.z, signed: true, zero: true },
        { kind: "choice", key: "style", label: "Style", value: this.s.style, options: options(STAKE_STYLES) },
        { kind: "number", key: "scaleFactor", label: "Scale Factor", value: this.s.scaleFactor, min: 0.01, max: 100 },
        { kind: "length", key: "markOffsetX", label: "Mark Offset X", value: this.s.markOffsetX, signed: true, zero: true },
        { kind: "length", key: "markOffsetY", label: "Mark Offset Y", value: this.s.markOffsetY, signed: true, zero: true },
        { kind: "number", key: "markRotation", label: "Mark Rotation", value: this.s.markRotation, min: -360, max: 360, unit: "°" },
        { kind: "choice", key: "label", label: "Label Reference", value: this.s.label, options: options(STAKE_LABELS) },
        { kind: "choice", key: "position", label: "Label Position", value: this.s.position, options: options(POSITIONS) },
        { kind: "choice", key: "bubble", label: "Bubble Style", value: this.s.bubble, options: options(BUBBLES) },
        { kind: "number", key: "cornerRadius", label: "RR Corner Radius", value: this.s.cornerRadiusMm, min: 0, max: 100, unit: "mm on paper" },
        { kind: "number", key: "margin", label: "Text Margin", value: this.s.marginMm, min: 0, max: 100, unit: "mm on paper" },
        { kind: "text", key: "description", label: "Description", value: this.s.description },
        { kind: "text", key: "prefix", label: "ID Prefix", value: this.s.prefix },
        { kind: "text", key: "suffix", label: "ID Suffix", value: this.s.suffix },
        { kind: "check", key: "autoId", label: "Auto ID Numbering", value: this.s.autoId },
        { kind: "number", key: "idNumber", label: this.s.autoId ? "Initial ID Number" : "ID Number", value: this.s.idNumber, min: 0, max: 999999, integer: true },
        { kind: "check", key: "showElevation", label: "Show Elevation (coordinate labels)", value: this.s.showElevation },
        { kind: "check", key: "unitMark", label: "Show Unit Mark", value: this.s.unitMark },
        { kind: "check", key: "leader", label: "Display Leader Line", value: this.s.leader },
      ],
      "The label is 2.5 mm high on paper and the indicator 3 mm across times its scale factor: a layer at 1:n draws them n times larger. Coordinates are measured from the drawing's origin. Auto ID Numbering steps the ID on with each stake.",
    );
    if (!v) return;
    this.s.z = v.num("z");
    this.s.style = pick(STAKE_STYLES, v.choice("style"), "triangle");
    this.s.scaleFactor = v.num("scaleFactor");
    this.s.markOffsetX = v.num("markOffsetX");
    this.s.markOffsetY = v.num("markOffsetY");
    this.s.markRotation = v.num("markRotation");
    this.s.label = pick(STAKE_LABELS, v.choice("label"), "elevation");
    this.s.position = pick(POSITIONS, v.choice("position"), "auto");
    this.s.bubble = pick(BUBBLES, v.choice("bubble"), "none");
    this.s.cornerRadiusMm = v.num("cornerRadius");
    this.s.marginMm = v.num("margin");
    this.s.description = v.choice("description");
    this.s.prefix = v.choice("prefix");
    this.s.suffix = v.choice("suffix");
    this.s.autoId = v.flag("autoId");
    this.s.idNumber = v.num("idNumber");
    this.s.showElevation = v.flag("showElevation");
    this.s.unitMark = v.flag("unitMark");
    this.s.leader = v.flag("leader");
  }

  snapFrom(): Pt | null {
    return this.mode === "standard" ? (this.press?.at ?? null) : (this.path.points.at(-1) ?? null);
  }

  hint(): string {
    if (this.mode === "polyVertex") return this.path.points.length ? "Click the next corner · double-click or Enter ends it" : "Click the first stake · 1–2 mode";
    return this.press ? "Release where the label goes" : "Click to place a stake, or press and drag to its label · 1–2 mode";
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (this.mode === "standard") {
      this.press = { at: p.pos, screen: p.screen };
      return;
    }
    const done = this.path.click(p, this.env.view.scale, false);
    if (done) this.place(done.points.map((at) => ({ at, labelAt: null })));
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  up(p: PointerInfo): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    this.place([{ at: press.at, labelAt: dist(p.screen, press.screen) > CLICK_PX ? p.pos : null }]);
  }

  cancel(): void {
    this.press = null;
    this.path.points = [];
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (!this.press && this.path.points.length === 0) return false;
    if (e.key === "Enter" && this.path.points.length) this.place(this.path.end(false).points.map((at) => ({ at, labelAt: null })));
    else if (e.key === "Escape") this.cancel();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    if (this.mode === "standard") {
      const parts = this.press ? this.stakeParts(this.press.at, dist(p.screen, this.press.screen) > CLICK_PX ? p.pos : null, 0) : this.stakeParts(p.pos, null, 0);
      if (parts) preview(g, parts);
      return;
    }
    const pts = [...this.path.points, p.pos];
    withPreview(g, () => strokeScreen(g, pts, false));
    preview(g, pts.flatMap((at, i) => this.stakeParts(at, null, i) ?? []));
  }

  /** A stake's parts, or null without a layer or when it would draw nothing. */
  private stakeParts(at: Pt, labelAt: Pt | null, step: number): Part[] | null {
    const scale = layerScale(this.env);
    return scale === null ? null : stakeParts(this.s, at, labelAt, step, scale);
  }

  private place(stakes: readonly { at: Pt; labelAt: Pt | null }[]): void {
    const pieces = stakes.map((s, i) => this.stakeParts(s.at, s.labelAt, i));
    if (pieces.some((p) => !p)) {
      toast(layerScale(this.env) === null ? "Make a design layer active to place a stake." : "This stake draws nothing: set a Style or a Label Reference in Preferences.", "info");
      return;
    }
    const layerId = store.activeLayerId;
    if (!layerId) return;
    const r = attempt("Stake", (s) => s.batch(() => addStakeGroups(s, layerId, stakes.map((k, i) => ({ parts: pieces[i] as Part[], at: k.at, z: this.s.z })))));
    if (r) setEditGroup(null, r.value);
    if (this.s.autoId) this.s.idNumber += stakes.length;
  }
}

/** Preferences both parking tools share: the stalls' size and numbering, and the numbers' size on paper. */
interface Stalls {
  width: number;
  length: number;
  numbering: boolean;
  startAt: number;
  textMm: number;
}

const stallFields = (s: Stalls): PrefField[] => [
  { kind: "length", key: "width", label: "Space Width", value: s.width },
  { kind: "length", key: "length", label: "Space Length", value: s.length },
  { kind: "check", key: "numbering", label: "Space Numbering", value: s.numbering },
  { kind: "number", key: "startAt", label: "Start Num At", value: s.startAt, min: -1e6, max: 1e6, integer: true },
  { kind: "number", key: "text", label: "Text size", value: s.textMm, min: 0.5, max: 50, unit: "mm" },
];

const stallsFrom = (v: PrefValues): Stalls => ({ width: v.num("width"), length: v.num("length"), numbering: v.flag("numbering"), startAt: v.num("startAt"), textMm: v.num("text") });

export class ParkingAlongPathTool extends PathTool {
  readonly id = "parkingpath";
  protected readonly label = "Parking Along Path";
  private stalls: Stalls = { width: 2500, length: 5000, numbering: true, startAt: 1, textMm: PARKING_TEXT_MM };
  private left = true;
  private right = true;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Parking Along Path Preferences",
      [...stallFields(this.stalls), { kind: "check", key: "left", label: "Spaces on Left of Poly", value: this.left }, { kind: "check", key: "right", label: "Spaces on Right of Poly", value: this.right }],
      `Stalls stand square to each straight run of the path, the left side being the left of the way it's drawn; they're numbered along the left side first, then the right. Text size is on paper: a layer at 1:n draws it n times larger. Up to ${MAX_PARKING_STALLS} spaces.`,
    );
    if (!v) return;
    this.stalls = stallsFrom(v);
    this.left = v.flag("left");
    this.right = v.flag("right");
  }

  protected startHint(): string {
    return "Click the parking path's start";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a design layer active to place parking.";
    const p: AlongPath = { ...this.stalls, left: this.left, right: this.right };
    const plan = parkingAlongPath(points, closed, p, this.stalls.textMm * scale);
    return typeof plan === "string" ? plan : markerParts(plan);
  }
}

export class ParkingAreaTool extends PathTool {
  readonly id = "parkingarea";
  protected readonly label = "Parking Area";
  private stalls: Stalls = { width: 2500, length: 5000, numbering: false, startAt: 1, textMm: PARKING_TEXT_MM };
  private area = { rowAngle: 0, lane: 6000, spaceAngle: 60, stripe: true, perimeter: true };

  async preferences(): Promise<void> {
    const a = this.area;
    const v = await toolPrefs(
      "Parking Area Preferences",
      [
        { kind: "number", key: "rowAngle", label: "Row Angle", value: a.rowAngle, min: -180, max: 180, unit: "°" },
        { kind: "length", key: "lane", label: "Lane Width", value: a.lane, zero: true },
        { kind: "number", key: "spaceAngle", label: "Space Angle", value: a.spaceAngle, min: 1, max: 90, unit: "°" },
        ...stallFields(this.stalls),
        { kind: "check", key: "stripe", label: "Show Header Stripe", value: a.stripe },
        { kind: "check", key: "perimeter", label: "Show Perimeter", value: a.perimeter },
      ],
      `Rows of stalls stand back to back about header stripes at the Row Angle, each stall at the Space Angle to its stripe, with a lane between double rows and along the area's sides; as many as fit, centred across the area, laid along each stripe from the area's end. The outline closes even when ended open. Stalls are numbered left to right and top to bottom. Text size is on paper. Up to ${MAX_PARKING_STALLS} spaces.`,
    );
    if (!v) return;
    this.stalls = stallsFrom(v);
    this.area = { rowAngle: v.num("rowAngle"), lane: v.num("lane"), spaceAngle: v.num("spaceAngle"), stripe: v.flag("stripe"), perimeter: v.flag("perimeter") };
  }

  protected startHint(): string {
    return "Click the parking area's first corner";
  }

  protected parts(points: Pt[]): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a design layer active to place parking.";
    const p: Area = { ...this.area, ...this.stalls };
    const plan = parkingArea(points, p, this.stalls.textMm * scale);
    return typeof plan === "string" ? plan : markerParts(plan);
  }
}
