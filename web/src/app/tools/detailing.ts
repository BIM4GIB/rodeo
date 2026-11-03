// The Detailing tool set's tools. Vectorworks makes plug-in objects of them; these draw what those
// objects draw, as plain 2D objects in the active class (several grouped). Break Line, Insulation
// and Repetitive Unit take a line, a drag or two clicks; Steel Section and Lumber take a click to
// place, or a press dragged to turn the section toward the pointer. Shift keeps the line or the
// turn to 15° steps; Esc cancels. The gestures and adding pieces in one undo step are shared with
// the markers (tools/markers.ts).
//
// Break Line: a line with a zigzag break at its middle, the break about the size set in
// Preferences (paper mm, times the layer scale).
// Insulation: a band the thickness set in Preferences along the line, to its left, centred on it
// or to its right. Batt draws the band's loops as one polyline; Rigid draws its outline crossed
// corner to corner.
// Repetitive Unit: bricks or blocks in courses on the line, stretcher bonded, cut at its ends.
// Steel Section: a wide flange, channel, angle, tee, I-beam or Z-section outline, or rectangular,
// square or round tubing (its inside a hole in the outline), of the size in Preferences.
// Lumber: a lumber section of a nominal size, crossed (continuous) or with one diagonal (blocking).
// Bolt: a hex-head bolt from the side along the line, head at its start, of the diameter set in
// Preferences.
// Weld: a welding symbol, the arrow from the joint clicked first to the reference line's end
// clicked next: a fillet or V-groove on the arrow side, the other side or both, a circle at the
// elbow for all around.
// Plant (the Site Planning set): a plant in plan, scalloped or round, its canopy the spread set in
// Preferences; a click places one, or in Row a line places them along it at the spacing set.

import type { EditSession, Attributes, ByClassGroup, NewShape, Pt } from "../../core/index.ts";
import { addAndSelect, attempt, setEditGroup } from "../commands.ts";
import {
  anchorSide,
  battLoops,
  boltSide,
  breakLine,
  lumberSection,
  MAX_DOTS,
  MAX_PLANTS,
  MAX_UNITS,
  nailSide,
  placed,
  plantPlan,
  plantRow,
  rigidInsulation,
  screwSide,
  steelOutline,
  stippleDots,
  unitCourses,
  weldSymbol,
  type Drawing,
  type InsulationSide,
  type LumberMark,
  type PlantStyle,
  type SteelShape,
  type SteelSize,
  type UnitCourse,
  type WeldKind,
  type WeldSide,
} from "../detailShapes.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { partNote, registerTwin, type PartTwin } from "./partRecord.ts";
import { store, type ToolId } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolEnv, type ToolModes } from "../tools.ts";

/** pointer travel (CSS px) below which a press is a click, not a drag */
export const CLICK_PX = 4;
/** the break's height on paper, mm, until Preferences change it */
const BREAK_MM = 4;
/** insulation's thickness, mm, until Preferences change it */
const THICKNESS_MM = 100;
/** fasteners' diameters, mm, until Preferences change them */
const BOLT_MM = 12;
const SCREW_MM = 5;
const NAIL_MM = 3.4;
const ANCHOR_MM = 12;
/** a welding symbol's height on paper, mm, until Preferences change it */
const WELD_MM = 3;
/** a plant's spread and a row's spacing, mm, until Preferences change them */
const SPREAD_MM = 3000;
const SPACING_MM = 4000;

/** A shape with attributes of its own over the drawing's, or in a class of its own drawn in the class's attributes. */
export interface Styled {
  readonly shape: NewShape;
  readonly attrs?: Partial<Attributes>;
  readonly classIndex?: number;
  readonly byClass?: boolean;
}

const BY_CLASS_GROUPS: readonly ByClassGroup[] = ["fill", "lineStyle", "penColor", "lineWeight", "opacity"];
/** What a tool adds: a shape drawn in the drawing's attributes, or one styled. */
export type Part = NewShape | Styled;

const shapeOf = (p: Part): NewShape => ("shape" in p ? p.shape : p);

/** Adds one part to a layer in the drawing's attributes and active class, or its own. */
export function addPart(s: EditSession, layerId: string, part: Part): string {
  const own = "shape" in part ? part : null;
  const attrs = { ...store.drawAttrs, ...own?.attrs };
  const id = s.addObject(layerId, shapeOf(part), own?.classIndex ?? store.activeClassIndex, own?.byClass || Object.keys(attrs).length === 0 ? undefined : attrs);
  if (own?.byClass) for (const g of BY_CLASS_GROUPS) s.setAttributesByClass([id], g, true);
  return id;
}

/**
 * Adds what a tool draws, in one undo step: each piece one object or, of several, a group; one
 * object or group alone is selected, else all of them. A lone group takes `name` (Object Info's Name).
 * `finish` runs in the same step on a lone piece's object or group.
 */
export function addPieces(label: string, pieces: readonly (readonly Part[])[], name?: string, groupClass?: number, finish?: (s: EditSession, id: string) => void): void {
  const only = pieces.length === 1 && pieces[0].length === 1 ? pieces[0][0] : null;
  if (only && !("shape" in only)) {
    addAndSelect(only, undefined, finish);
    return;
  }
  const layerId = store.activeLayerId;
  if (!layerId) return;
  const r = attempt(label, (s) =>
    s.batch(() =>
      pieces.map((parts) => {
        const ids = parts.map((part) => addPart(s, layerId, part));
        const group = ids.length === 1 ? ids[0] : s.groupObjects(ids);
        if (ids.length > 1 && name && pieces.length === 1) s.setObjectName(group, name);
        if (ids.length > 1 && groupClass !== undefined) s.setObjectClass([group], groupClass);
        if (pieces.length === 1) finish?.(s, group);
        return group;
      }),
    ),
  );
  // the groups go on the layer, as addAndSelect puts an object
  if (r) setEditGroup(null, r.value);
}

/** Adds what a tool draws: one object selected, or several grouped and the group selected. */
function addShapes(label: string, shapes: readonly Part[], name?: string, finish?: (s: EditSession, id: string) => void): void {
  addPieces(label, [shapes], name, undefined, finish);
}

/** A drawing's outlines, lines and circles as shapes. */
export function drawn(d: Drawing): NewShape[] {
  return [
    ...d.outlines.map((points): NewShape => ({ kind: "polygon", points, closed: true })),
    ...d.lines.map((points): NewShape => ({ kind: "polyline", points, closed: false })),
    ...d.circles.map((c): NewShape => ({ kind: "arc", center: c.center, radius: c.radius, startAngle: 0, sweepAngle: 360 })),
  ];
}

/** Strokes the lines, outlines, circles and circular arcs a tool would draw, dashed. */
export function preview(g: Painter, parts: readonly Part[]): void {
  withPreview(g, () => {
    for (const s of parts.map(shapeOf)) {
      if (s.kind === "polyline" || s.kind === "polygon") strokeScreen(g, s.points, s.kind === "polygon" || s.closed === true);
      else if (s.kind === "line") strokeScreen(g, [s.a, s.b], false);
      else if (s.kind === "arc") {
        const c = g.toScreen(s.center);
        const full = Math.abs(s.sweepAngle) >= 360;
        // the screen's y runs down, so anticlockwise in the drawing is clockwise on the canvas
        const from = full ? 0 : (-s.startAngle * Math.PI) / 180;
        const to = full ? 2 * Math.PI : (-(s.startAngle + s.sweepAngle) * Math.PI) / 180;
        g.ctx.beginPath();
        g.ctx.ellipse(c.x, c.y, s.radius * g.scale, (s.radiusY ?? s.radius) * g.scale, 0, from, to, !full && s.sweepAngle > 0);
        g.ctx.stroke();
      }
    }
  });
}

/** The active layer's scale (1:n gives n), or null without a layer. */
export function layerScale(env: ToolEnv): number | null {
  const layerId = store.activeLayerId;
  const layer = layerId ? env.scene.layer(layerId) : undefined;
  return layer ? layer.scale || 1 : null;
}

/** A drag or two clicks from a start to an end: the gesture the line tools share. */
export abstract class TwoPointTool extends BaseTool {
  private from: Pt | null = null;
  private pressScreen: Pt | null = null;
  private cursorAt: Pt | null = null;

  /** What the tool draws from `a` to `b`, or null when it can't (too short). */
  protected abstract shapes(a: Pt, b: Pt): Part[] | null;
  protected abstract readonly label: string;
  modes?(): readonly ToolModes[];
  setMode?(id: string): void;

  /** What a click alone draws at `at`, when the tool is in a mode that places on a click; undefined in a line mode. */
  protected oneClick(_at: Pt): Part[] | null | undefined {
    return undefined;
  }

  /** What the tool adds from `a` to `b`, each piece an object or a group: its shapes, as one piece. */
  protected pieces(a: Pt, b: Pt): Part[][] | null {
    const shapes = this.shapes(a, b);
    return shapes ? [shapes] : null;
  }

  snapFrom(): Pt | null {
    return this.from;
  }

  hint(): string {
    return this.from ? `Click or release at the end · Shift ${ANGLE_STEP_DEG}°` : "Drag a line or click its start";
  }

  down(p: PointerInfo): void {
    if (!this.from) {
      const one = this.oneClick(p.pos);
      if (one === undefined) this.from = p.pos;
      else if (one) addShapes(this.label, one);
      else toast(this.refusal(), "info");
      this.pressScreen = one === undefined ? p.screen : null;
      return;
    }
    this.pressScreen = p.screen;
    this.finish(this.at(p));
  }

  move(p: PointerInfo): void {
    this.cursorAt = this.at(p);
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.from && press && dist(p.screen, press) > CLICK_PX) this.finish(this.at(p));
  }

  cancel(): void {
    this.reset();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes?.());
    if (mode) {
      this.setMode?.(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.from) return false;
    this.reset();
    return true;
  }

  overlay(g: Painter): void {
    const a = this.from;
    const b = this.cursorAt;
    if (!b) return;
    if (!a) {
      const one = this.oneClick(b);
      if (one) preview(g, one);
      return;
    }
    preview(g, this.shapes(a, b) ?? [{ kind: "polyline", points: [a, b], closed: false }]);
  }

  /** The active layer's scale (1:n gives n), or null without a layer. */
  protected scale(): number | null {
    return layerScale(this.env);
  }

  /** Where the line started, while it is being drawn. */
  protected start(): Pt | null {
    return this.from;
  }

  /** The pointer's point, kept to 15° steps from the start while Shift is held. */
  private at(p: PointerInfo): Pt {
    return this.from && p.shift ? snapAngle(this.from, p.pos, ANGLE_STEP_DEG) : p.pos;
  }

  private finish(b: Pt): void {
    const a = this.from;
    this.reset();
    if (!a) return;
    const pieces = this.pieces(a, b);
    if (!pieces) {
      toast(this.refusal(), "info");
      return;
    }
    this.add(pieces, a, b);
  }

  /** Adds what the tool drew from `a` to `b`. */
  protected add(pieces: readonly (readonly Part[])[], _a: Pt, _b: Pt): void {
    addPieces(this.label, pieces);
  }

  /** Why nothing was drawn. */
  protected refusal(): string {
    return `Drag a longer line for the ${this.label.toLowerCase()}.`;
  }

  private reset(): void {
    this.from = null;
    this.pressScreen = null;
  }
}

export class BreakLineTool extends TwoPointTool {
  readonly id = "breakline";
  readonly cursor = "crosshair";
  protected readonly label = "Break Line";
  private breakMm = BREAK_MM;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Break Line Preferences",
      [{ kind: "number", key: "size", label: "Break height", value: this.breakMm, min: 0.5, max: 50, unit: "mm" }],
      "On paper: a layer at 1:n draws the break n times larger.",
    );
    if (v) this.breakMm = v.num("size");
  }

  protected shapes(a: Pt, b: Pt): NewShape[] | null {
    const scale = this.scale();
    const pts = scale === null ? null : breakLine(a, b, this.breakMm * scale);
    return pts ? [{ kind: "polyline", points: pts, closed: false }] : null;
  }
}

type InsulationKind = "batt" | "rigid";

const KINDS: readonly { readonly id: InsulationKind; readonly label: string }[] = [
  { id: "batt", label: "Batt" },
  { id: "rigid", label: "Rigid" },
];
const SIDES: readonly { readonly id: InsulationSide; readonly label: string }[] = [
  { id: "left", label: "Left" },
  { id: "centre", label: "Centre" },
  { id: "right", label: "Right" },
];

export class InsulationTool extends TwoPointTool {
  readonly id = "insulation";
  readonly cursor = "crosshair";
  protected readonly label = "Insulation";
  private kind: InsulationKind = "batt";
  private side: InsulationSide = "centre";
  private thickness = THICKNESS_MM;

  modes(): readonly ToolModes[] {
    return [
      { label: "Insulation", options: KINDS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind },
      { label: "Line", options: SIDES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + KINDS.length) })), active: this.side },
    ];
  }

  setMode(id: string): void {
    const kind = KINDS.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
    const side = SIDES.find((m) => m.id === id);
    if (side) this.side = side.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Insulation Preferences", [
      { kind: "length", key: "thickness", label: "Thickness", value: this.thickness },
      { kind: "choice", key: "kind", label: "Insulation", value: this.kind, options: KINDS.map((m) => ({ value: m.id, label: m.label })) },
      { kind: "choice", key: "side", label: "Line", value: this.side, options: SIDES.map((m) => ({ value: m.id, label: m.label })) },
    ]);
    if (!v) return;
    this.thickness = v.num("thickness");
    this.setMode(v.choice("kind"));
    this.setMode(v.choice("side"));
  }

  hint(): string {
    return `${super.hint()} · 1–2 batt or rigid · 3–5 line`;
  }

  protected shapes(a: Pt, b: Pt): NewShape[] | null {
    if (this.kind === "batt") {
      const pts = battLoops(a, b, this.thickness, this.side);
      return pts ? [{ kind: "polyline", points: pts, closed: false }] : null;
    }
    const rigid = rigidInsulation(a, b, this.thickness, this.side);
    return rigid ? [{ kind: "polygon", points: rigid.outline, closed: true }, ...rigid.crosses.map((points): NewShape => ({ kind: "polyline", points, closed: false }))] : null;
  }
}

type UnitKind = "brick" | "block";

const UNITS: readonly { readonly id: UnitKind; readonly label: string; readonly size: UnitCourse }[] = [
  { id: "brick", label: "Brick", size: { length: 215, height: 65, joint: 10, courses: 1 } },
  { id: "block", label: "Block", size: { length: 440, height: 215, joint: 10, courses: 1 } },
];

export class RepetitiveUnitTool extends TwoPointTool {
  readonly id = "repunit";
  readonly cursor = "crosshair";
  protected readonly label = "Repetitive Unit";
  private kind: UnitKind = "brick";
  /** each kind's size as Preferences last left it */
  private readonly sizes = new Map<UnitKind, UnitCourse>(UNITS.map((u) => [u.id, u.size]));

  modes(): readonly ToolModes[] {
    return [{ label: "Unit", options: UNITS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    const kind = UNITS.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
  }

  async preferences(): Promise<void> {
    const size = this.size();
    const v = await toolPrefs(
      `Repetitive Unit Preferences (${UNITS.find((u) => u.id === this.kind)!.label})`,
      [
        { kind: "length", key: "length", label: "Unit length", value: size.length },
        { kind: "length", key: "height", label: "Unit height", value: size.height },
        { kind: "length", key: "joint", label: "Joint", value: size.joint },
        { kind: "number", key: "courses", label: "Courses", value: size.courses, min: 1, max: 200 },
      ],
      "The first course sits on the line and the rest above it, to its left; every other course is moved half a unit.",
    );
    if (v) this.sizes.set(this.kind, { length: v.num("length"), height: v.num("height"), joint: v.num("joint"), courses: Math.round(v.num("courses")) });
  }

  hint(): string {
    return `${super.hint()} · 1–2 brick or block`;
  }

  protected shapes(a: Pt, b: Pt): NewShape[] | null {
    const units = unitCourses(a, b, this.size());
    return units ? units.map((points): NewShape => ({ kind: "polygon", points, closed: true })) : null;
  }

  protected refusal(): string {
    return `Repetitive Unit lays up to ${MAX_UNITS} units at a time: drag a line longer than a joint and shorter than that.`;
  }

  private size(): UnitCourse {
    return this.sizes.get(this.kind) ?? UNITS[0].size;
  }
}

/** A click to place, or a press dragged to turn what is placed toward the pointer: the gesture the section tools share. */
export abstract class PlaceTool extends BaseTool {
  private press: { at: Pt; screen: Pt } | null = null;
  private pointer: PointerInfo | null = null;
  /** where the part being placed goes and its turn, for Create 3D Object From 2D's record */
  private placing: { at: Pt; angle: number } | null = null;

  /** What the tool draws at `at`, turned by `angle` radians, or null when its size doesn't work. */
  protected abstract shapes(at: Pt, angle: number): Part[] | null;
  /** the turn a click gives, before a drag turns it toward the pointer */
  protected readonly clickAngle: number = 0;
  protected abstract readonly label: string;
  modes?(): readonly ToolModes[];
  setMode?(id: string): void;
  /** After each placing, for a tool that counts on (automatic numbering). */
  protected afterPlacing?(): void;
  /** Why nothing may be placed now, checked on placing; null when it may. */
  protected placeProblem?(): string | null;
  /** the Name (Object Info's) the placed group takes */
  protected objectName?(): string | undefined;

  snapFrom(): Pt | null {
    return this.press?.at ?? null;
  }

  hint(): string {
    return this.press ? `Release to place · drag turns it · Shift ${ANGLE_STEP_DEG}°` : "Click to place, or press and drag to turn it";
  }

  down(p: PointerInfo): void {
    this.press = { at: p.pos, screen: p.screen };
    this.pointer = p;
  }

  move(p: PointerInfo): void {
    this.pointer = p;
  }

  up(p: PointerInfo): void {
    const press = this.press;
    this.press = null;
    if (!press) return;
    const angle = this.angle(press, p);
    const shapes = this.shapes(press.at, angle);
    if (!shapes) {
      toast(this.refusal(), "info");
      return;
    }
    const problem = this.placeProblem?.();
    if (problem) {
      toast(problem, "info");
      return;
    }
    this.placing = { at: press.at, angle };
    this.place(shapes);
    this.placing = null;
    this.afterPlacing?.();
  }

  /** Adds what was placed (with Create 3D Object From 2D's record, for a part with a "- 3D" tool). */
  protected place(parts: readonly Part[]): void {
    addShapes(this.label, parts, this.objectName?.(), partNote(this, this.label, this.placing));
  }

  /** Why nothing was placed. */
  protected refusal(): string {
    return `The ${this.label.toLowerCase()}'s size in its Preferences doesn't make a section.`;
  }

  /** The active layer's scale (1:n gives n), or null without a layer. */
  protected scale(): number | null {
    return layerScale(this.env);
  }

  cancel(): void {
    this.press = null;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes?.());
    if (mode) {
      this.setMode?.(mode);
      return true;
    }
    if (e.key !== "Escape" || !this.press) return false;
    this.press = null;
    return true;
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    const shapes = this.press ? this.shapes(this.press.at, this.angle(this.press, p)) : this.shapes(p.pos, this.clickTurn());
    if (shapes) preview(g, shapes);
  }

  /** The turn a click gives: its own, matching a rotated plan so it shows the same way up on screen. */
  private clickTurn(): number {
    return this.clickAngle - this.env.view.rotation;
  }

  /** The turn a press dragged to `p` gives: none for a click, else toward the pointer (Shift: 15° steps). */
  private angle(press: { at: Pt; screen: Pt }, p: PointerInfo): number {
    if (dist(p.screen, press.screen) <= CLICK_PX) return this.clickTurn();
    const to = p.shift ? snapAngle(press.at, p.pos, ANGLE_STEP_DEG) : p.pos;
    return Math.atan2(to.y - press.at.y, to.x - press.at.x);
  }
}

export const STEEL: readonly { readonly id: SteelShape; readonly label: string; readonly size: SteelSize }[] = [
  { id: "w", label: "Wide Flange", size: { depth: 250, width: 200, web: 8, flange: 12 } },
  { id: "c", label: "Channel", size: { depth: 250, width: 70, web: 7, flange: 11 } },
  { id: "l", label: "Angle", size: { depth: 100, width: 100, web: 10, flange: 10 } },
  { id: "t", label: "Tee", size: { depth: 125, width: 200, web: 8, flange: 12 } },
  { id: "i", label: "I-Beam", size: { depth: 254, width: 118, web: 7.9, flange: 12.5 } },
  { id: "rt", label: "Rectangular Tubing", size: { depth: 152, width: 102, web: 6, flange: 0 } },
  { id: "st", label: "Square Tubing", size: { depth: 102, width: 102, web: 6, flange: 0 } },
  { id: "rd", label: "Round Tubing", size: { depth: 114, width: 114, web: 6, flange: 0 } },
  { id: "z", label: "Z-Section", size: { depth: 100, width: 55, web: 6.5, flange: 8 } },
];

export class SteelSectionTool extends PlaceTool {
  readonly id: ToolId = "steel";
  readonly cursor = "crosshair";
  protected readonly label: string = "Steel Section";
  private shape: SteelShape = "w";
  /** each shape's size as Preferences last left it */
  private readonly sizes = new Map<SteelShape, SteelSize>(STEEL.map((s) => [s.id, s.size]));

  modes(): readonly ToolModes[] {
    return [{ label: "Shape", options: STEEL.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.shape }];
  }

  setMode(id: string): void {
    const shape = STEEL.find((m) => m.id === id);
    if (shape) this.shape = shape.id;
  }

  async preferences(): Promise<void> {
    const shape = this.shape;
    const size = this.sizes.get(shape)!;
    const title = `Steel Section Preferences (${STEEL.find((s) => s.id === shape)!.label})`;
    if (shape === "rt" || shape === "st" || shape === "rd") {
      const v = await toolPrefs(
        title,
        [
          { kind: "length", key: "depth", label: shape === "rd" ? "Outside diameter" : shape === "st" ? "Size" : "Depth", value: size.depth },
          ...(shape === "rt" ? [{ kind: "length", key: "width", label: "Width", value: size.width } as const] : []),
          { kind: "length", key: "web", label: "Wall thickness", value: size.web },
          ...this.moreFields(),
        ],
        shape === "rd" ? "Drawn as a 64-sided outline with its inside as a hole." : "Outside corners rounded to twice the wall, inside corners to the wall.",
      );
      if (v) {
        this.sizes.set(shape, { ...size, depth: v.num("depth"), width: shape === "rt" ? v.num("width") : v.num("depth"), web: v.num("web") });
        this.readMore(v);
      }
      return;
    }
    const v = await toolPrefs(
      title,
      [
        { kind: "length", key: "depth", label: "Depth", value: size.depth },
        { kind: "length", key: "width", label: "Width", value: size.width },
        { kind: "length", key: "web", label: "Web thickness", value: size.web },
        { kind: "length", key: "flange", label: shape === "i" ? "Mean flange thickness" : "Flange thickness", value: size.flange },
        ...this.moreFields(),
      ],
      shape === "i"
        ? "The flanges' inner faces slope 1 in 6. Drawn without root fillets."
        : shape === "z"
          ? "The width is each flange's, the web's thickness in it. Drawn without root fillets."
          : "An angle's legs are both the web's thickness. Drawn without root fillets.",
    );
    if (v) {
      this.sizes.set(shape, { depth: v.num("depth"), width: v.num("width"), web: v.num("web"), flange: v.num("flange") });
      this.readMore(v);
    }
  }

  /** Preferences beyond the section's own. */
  protected moreFields(): readonly PrefField[] {
    return [];
  }

  protected readMore(_v: PrefValues): void {}

  hint(): string {
    return `${super.hint()} · 1–9 shape`;
  }

  protected shapes(at: Pt, angle: number): NewShape[] | null {
    const outline = steelOutline(this.shape, this.sizes.get(this.shape)!);
    return outline ? [{ kind: "polygon", points: placed(outline, at, angle), closed: true }] : null;
  }
}

/** Steel Section - 3D: a section stood up as an extrude of the Length in its Preferences, as Vectorworks' Angle - 3D, Channel - 3D and the rest are. */
export class Steel3DTool extends SteelSectionTool implements PartTwin {
  override readonly id: ToolId = "steel3d";
  protected override readonly label = "Steel Section - 3D";
  private length = 3000;

  protected override moreFields(): readonly PrefField[] {
    return [{ kind: "length", key: "length", label: "Length", value: this.length }];
  }

  protected override readMore(v: PrefValues): void {
    this.length = v.num("length");
  }

  protected override place(parts: readonly Part[]): void {
    const length = this.length;
    addAndSelect(parts[0] as NewShape, undefined, (s, id) => s.extrudeObjects([id], length)[0]);
  }

  placeIn(s: EditSession, layerId: string, classIndex: number, at: Pt, angle: number): string[] | string {
    const parts = this.shapes(at, angle);
    if (!parts) return this.refusal();
    const id = addPart(s, layerId, parts[0]);
    s.setObjectClass([id], classIndex);
    return [s.extrudeObjects([id], this.length)[0]];
  }
}
registerTwin(SteelSectionTool, "steel3d", Steel3DTool);

/** Nominal lumber sizes and what they measure, mm (dressed). */
const LUMBER_SIZES: readonly { readonly id: string; readonly width: number; readonly depth: number }[] = [
  { id: "2×2", width: 38, depth: 38 },
  { id: "2×3", width: 38, depth: 64 },
  { id: "2×4", width: 38, depth: 89 },
  { id: "2×6", width: 38, depth: 140 },
  { id: "2×8", width: 38, depth: 184 },
  { id: "2×10", width: 38, depth: 235 },
  { id: "2×12", width: 38, depth: 286 },
  { id: "4×4", width: 89, depth: 89 },
  { id: "4×6", width: 89, depth: 140 },
  { id: "6×6", width: 140, depth: 140 },
];
const CUSTOM = "custom";

const MARKS: readonly { readonly id: LumberMark; readonly label: string }[] = [
  { id: "continuous", label: "Continuous" },
  { id: "blocking", label: "Blocking" },
];

export class LumberTool extends PlaceTool {
  readonly id = "lumber";
  readonly cursor = "crosshair";
  protected readonly label = "Lumber";
  private mark: LumberMark = "continuous";
  private sizeId = "2×4";
  private custom = { width: 47, depth: 100 };

  modes(): readonly ToolModes[] {
    return [{ label: "Mark", options: MARKS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mark }];
  }

  setMode(id: string): void {
    const mark = MARKS.find((m) => m.id === id);
    if (mark) this.mark = mark.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Lumber Preferences",
      [
        {
          kind: "choice",
          key: "size",
          label: "Size",
          value: this.sizeId,
          options: [...LUMBER_SIZES.map((s) => ({ value: s.id, label: `${s.id} (${s.width} × ${s.depth} mm)` })), { value: CUSTOM, label: "Custom" }],
        },
        { kind: "length", key: "width", label: "Custom width", value: this.custom.width },
        { kind: "length", key: "depth", label: "Custom depth", value: this.custom.depth },
        { kind: "choice", key: "mark", label: "Mark", value: this.mark, options: MARKS.map((m) => ({ value: m.id, label: m.label })) },
      ],
      "Nominal sizes draw at their dressed size; Custom draws the width and depth given.",
    );
    if (!v) return;
    this.sizeId = v.choice("size");
    this.custom = { width: v.num("width"), depth: v.num("depth") };
    this.setMode(v.choice("mark"));
  }

  hint(): string {
    return `${super.hint()} · 1–2 continuous or blocking`;
  }

  protected shapes(at: Pt, angle: number): NewShape[] | null {
    const size = LUMBER_SIZES.find((s) => s.id === this.sizeId) ?? this.custom;
    const section = lumberSection(size.width, size.depth, this.mark);
    if (!section) return null;
    return [
      { kind: "polygon", points: placed(section.outline, at, angle), closed: true },
      ...section.marks.map((m): NewShape => ({ kind: "polyline", points: placed(m, at, angle), closed: false })),
    ];
  }
}

/** A fastener seen from the side along a line from its head to its tip, its diameter in Preferences. */
abstract class FastenerTool extends TwoPointTool {
  readonly cursor = "crosshair";
  protected abstract diameter: number;
  /** what it draws from `a` to `b` at a diameter, or null when too short */
  protected abstract side(a: Pt, b: Pt, diameter: number): Drawing | null;
  /** the Preferences note: where the line runs and what is drawn */
  protected abstract readonly note: string;
  /** how many diameters long it has to be */
  protected abstract readonly least: number;

  async preferences(): Promise<void> {
    const v = await toolPrefs(`${this.label} Preferences`, [{ kind: "length", key: "diameter", label: "Diameter", value: this.diameter }], this.note);
    if (v) this.diameter = v.num("diameter");
  }

  hint(): string {
    return this.start() ? super.hint() : "Drag from the head to the tip, or click there";
  }

  protected shapes(a: Pt, b: Pt): NewShape[] | null {
    const d = this.side(a, b, this.diameter);
    return d ? drawn(d) : null;
  }

  protected refusal(): string {
    return `Drag a ${this.label.toLowerCase()} at least ${this.least === 1 ? "as long as its diameter" : `${this.least} times its diameter long`}.`;
  }
}

export class BoltTool extends FastenerTool {
  readonly id = "bolt";
  protected readonly label = "Bolt";
  protected diameter = BOLT_MM;
  protected readonly note = "The line runs from under the head to the tip. Hex head, threaded for twice the diameter and 6 mm.";
  protected readonly least = 1;
  protected side = boltSide;
}

export class ScrewTool extends FastenerTool {
  readonly id = "screw";
  protected readonly label = "Screw";
  protected diameter = SCREW_MM;
  protected readonly note = "A countersunk wood screw: the line runs from the head's top to the point, threaded from two fifths of the way down.";
  protected readonly least = 3;
  protected side = screwSide;
}

export class NailTool extends FastenerTool {
  readonly id = "nail";
  protected readonly label = "Nail";
  protected diameter = NAIL_MM;
  protected readonly note = "A flat-headed nail: the line runs from the head to the point.";
  protected readonly least = 3;
  protected side = nailSide;
}

export class AnchorTool extends FastenerTool {
  readonly id = "anchor";
  protected readonly label = "Anchor";
  protected diameter = ANCHOR_MM;
  protected readonly note = "A wedge anchor: the line runs from the rod's top to its tip; a nut and washer near the top, the sleeve above the tip.";
  protected readonly least = 5;
  protected side = anchorSide;
}

const WELDS: readonly { readonly id: WeldKind; readonly label: string }[] = [
  { id: "fillet", label: "Fillet" },
  { id: "vgroove", label: "V-Groove" },
];
const WELD_SIDES: readonly { readonly id: WeldSide; readonly label: string }[] = [
  { id: "arrow", label: "Arrow Side" },
  { id: "other", label: "Other Side" },
  { id: "both", label: "Both" },
];

export class WeldTool extends TwoPointTool {
  readonly id = "weld";
  readonly cursor = "crosshair";
  protected readonly label = "Weld";
  private kind: WeldKind = "fillet";
  private side: WeldSide = "arrow";
  private sizeMm = WELD_MM;
  private allAround = false;

  modes(): readonly ToolModes[] {
    return [
      { label: "Weld", options: WELDS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind },
      { label: "Side", options: WELD_SIDES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + WELDS.length) })), active: this.side },
    ];
  }

  setMode(id: string): void {
    const kind = WELDS.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
    const side = WELD_SIDES.find((m) => m.id === id);
    if (side) this.side = side.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Weld Preferences",
      [
        { kind: "number", key: "size", label: "Symbol height", value: this.sizeMm, min: 0.5, max: 50, unit: "mm" },
        { kind: "check", key: "around", label: "Weld all around", value: this.allAround },
      ],
      "On paper: a layer at 1:n draws the symbol n times larger. The reference line is five symbols long.",
    );
    if (!v) return;
    this.sizeMm = v.num("size");
    this.allAround = v.flag("around");
  }

  hint(): string {
    return `${this.start() ? "Click or release at the reference line's end" : "Click the joint, then where the arrow meets the reference line"} · 1–2 fillet or V-groove · 3–5 side`;
  }

  protected shapes(a: Pt, b: Pt): NewShape[] | null {
    const scale = this.scale();
    const weld = scale === null ? null : weldSymbol(a, b, this.kind, this.side, this.sizeMm * scale, this.allAround);
    return weld ? drawn(weld) : null;
  }

  protected refusal(): string {
    return "Drag a longer arrow for the welding symbol.";
  }
}

type PlantPlace = "single" | "row";

const PLANT_PLACES: readonly { readonly id: PlantPlace; readonly label: string }[] = [
  { id: "single", label: "Single" },
  { id: "row", label: "Row" },
];
const PLANT_STYLES: readonly { readonly id: PlantStyle; readonly label: string }[] = [
  { id: "scalloped", label: "Scalloped" },
  { id: "circle", label: "Circle" },
];

export class PlantTool extends TwoPointTool {
  readonly id = "plant";
  readonly cursor = "crosshair";
  protected readonly label = "Plant";
  private place: PlantPlace = "single";
  private style: PlantStyle = "scalloped";
  private spread = SPREAD_MM;
  private spacing = SPACING_MM;

  modes(): readonly ToolModes[] {
    return [
      { label: "Place", options: PLANT_PLACES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.place },
      { label: "Style", options: PLANT_STYLES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + PLANT_PLACES.length) })), active: this.style },
    ];
  }

  setMode(id: string): void {
    const place = PLANT_PLACES.find((m) => m.id === id);
    if (place) this.place = place.id;
    const style = PLANT_STYLES.find((m) => m.id === id);
    if (style) this.style = style.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs("Plant Preferences", [
      { kind: "length", key: "spread", label: "Spread", value: this.spread },
      { kind: "length", key: "spacing", label: "Row spacing", value: this.spacing },
      { kind: "choice", key: "style", label: "Style", value: this.style, options: PLANT_STYLES.map((m) => ({ value: m.id, label: m.label })) },
    ]);
    if (!v) return;
    this.spread = v.num("spread");
    this.spacing = v.num("spacing");
    this.setMode(v.choice("style"));
  }

  hint(): string {
    const keys = "1–2 single or row · 3–4 style";
    return this.place === "single" ? `Click to place a plant · ${keys}` : `${super.hint()} · ${keys}`;
  }

  protected oneClick(at: Pt): NewShape[] | null | undefined {
    if (this.place !== "single") return undefined;
    const plant = plantPlan(at, this.spread, this.style);
    return plant ? drawn(plant) : null;
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    return this.pieces(a, b)?.flat() ?? null;
  }

  /** Each plant its own group. */
  protected pieces(a: Pt, b: Pt): Part[][] | null {
    const spots = plantRow(a, b, this.spacing);
    if (!spots) return null;
    const plants: Part[][] = [];
    for (const at of spots) {
      const plant = plantPlan(at, this.spread, this.style);
      if (!plant) return null;
      plants.push(drawn(plant));
    }
    return plants;
  }

  protected refusal(): string {
    return `A row places up to ${MAX_PLANTS} plants: drag a shorter line or set a wider spacing.`;
  }
}

type StippleKind = "even" | "gradient";

const STIPPLES: readonly { readonly id: StippleKind; readonly label: string }[] = [
  { id: "even", label: "Even" },
  { id: "gradient", label: "Gradient" },
];
/** dots per square centimetre on paper, and a dot's radius on paper (mm), until Preferences change them */
const STIPPLE_DENSITY = 25;
const DOT_MM = 0.15;

export class StippleTool extends TwoPointTool {
  readonly id = "stipple";
  readonly cursor = "crosshair";
  protected readonly label = "Stipple";
  private kind: StippleKind = "even";
  private density = STIPPLE_DENSITY;

  modes(): readonly ToolModes[] {
    return [{ label: "Stipple", options: STIPPLES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.kind }];
  }

  setMode(id: string): void {
    const kind = STIPPLES.find((m) => m.id === id);
    if (kind) this.kind = kind.id;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Stipple Preferences",
      [{ kind: "number", key: "density", label: "Density", value: this.density, min: 1, max: 200, unit: "per cm²" }],
      "Dots per square centimetre on paper. A gradient thins them from the first corner's side to none at the other's.",
    );
    if (v) this.density = v.num("density");
  }

  hint(): string {
    return `${this.start() ? "Click or release at the opposite corner" : "Drag a rectangle to stipple, or click its first corner"} · 1–2 even or gradient`;
  }

  protected shapes(a: Pt, b: Pt): NewShape[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    // dots per square centimetre on paper, as per square unit of the drawing
    const dots = stippleDots(a, b, this.density / (100 * scale * scale), this.kind === "gradient");
    const r = DOT_MM * scale;
    return dots ? dots.map((center): NewShape => ({ kind: "arc", center, radius: r, startAngle: 0, sweepAngle: 360 })) : null;
  }

  protected refusal(): string {
    return `Stipple places up to ${MAX_DOTS} dots: drag a smaller rectangle or set a lower density.`;
  }
}
