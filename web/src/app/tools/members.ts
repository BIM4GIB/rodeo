// Building Shell's Structural Member (memberShapes.ts). Vectorworks makes a structural member
// object of it, with 3D; this draws what that object draws in Top/Plan, as plain 2D objects grouped
// in the active class. Column Insertion stands a column's section where it's clicked, a press
// dragged turning it (Shift in 15° steps). Linear Insertion takes the member's start and end clicks
// (Shift in 15° steps), Poly Insertion its path's corners as Railing/Fence does: its body the
// breadth wide along them, aligned on the clicks, its ends run on or cut back and mitred, with its
// caps and centre marks. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { placed, type SteelSize } from "../detailShapes.ts";
import { ANGLE_STEP_DEG, dist, snapAngle } from "../geom.ts";
import { columnSection, linearMember, MAX_MEMBER_MITER, memberBreadth, type AxisAlign, type LinearMember, type MemberProfile, type MemberShape } from "../memberShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { modeForKey, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { addPieces, CLICK_PX, layerScale, preview, STEEL, type Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

type Insertion = "column" | "linear" | "poly";

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const INSERTIONS: Options<Insertion> = [
  { value: "column", label: "Column Insertion" },
  { value: "linear", label: "Linear Insertion" },
  { value: "poly", label: "Poly Insertion" },
];
const ALIGNS: Options<AxisAlign> = [
  { value: "left", label: "Left" },
  { value: "centre", label: "Center" },
  { value: "right", label: "Right" },
];
/** each shape offered: steel's sections, concrete's rectangle and circle, wood's rectangle */
const SHAPES: readonly { readonly value: string; readonly label: string; readonly shape: MemberShape }[] = [
  ...STEEL.map((s) => ({ value: `steel:${s.id}`, label: `Steel: ${s.label}`, shape: { kind: "steel", shape: s.id } as const })),
  { value: "concrete:rect", label: "Concrete: Rectangular", shape: { kind: "rect" } },
  { value: "concrete:circle", label: "Concrete: Circular", shape: { kind: "circle" } },
  { value: "wood:rect", label: "Wood: Rectangular", shape: { kind: "rect" } },
];

export class StructuralMemberTool extends PathTool {
  readonly id = "structmember";
  protected readonly label = "Structural Member";
  private insertion: Insertion = "linear";
  private shape = "steel:w";
  private size: SteelSize = STEEL[0].size;
  private m: LinearMember = { align: "centre", offset: 0, startOffset: 0, endOffset: 0, startMiter: 0, endMiter: 0, startCap: true, endCap: true, mark: null };
  private markLength = 300;
  private markGap = 0;
  private useMark = false;
  private press: { at: Pt; screen: Pt } | null = null;
  private pointer: PointerInfo | null = null;

  modes(): readonly ToolModes[] {
    return [{ label: "Insertion", options: INSERTIONS.map((o, i) => ({ id: o.value, label: o.label, key: String(i + 1) })), active: this.insertion }];
  }

  setMode(id: string): void {
    const insertion = pick(INSERTIONS, id, this.insertion);
    if (insertion !== this.insertion) this.cancel();
    this.insertion = insertion;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Structural Member Settings",
      [
        { kind: "choice", key: "shape", label: "Shape", value: this.shape, options: SHAPES.map((s) => ({ value: s.value, label: s.label })) },
        { kind: "length", key: "depth", label: "Depth", value: this.size.depth },
        { kind: "length", key: "width", label: "Breadth", value: this.size.width },
        { kind: "length", key: "web", label: "Web Thickness", value: this.size.web },
        { kind: "length", key: "flange", label: "Flange Thickness", value: this.size.flange, zero: true },
        { kind: "choice", key: "align", label: "Axis Alignment", value: this.m.align, options: ALIGNS.map((a) => ({ value: a.value, label: a.label })) },
        { kind: "length", key: "offset", label: "Offset", value: this.m.offset, signed: true },
        { kind: "length", key: "startOffset", label: "Start Offset", value: this.m.startOffset, signed: true },
        { kind: "length", key: "endOffset", label: "End Offset", value: this.m.endOffset, signed: true },
        { kind: "number", key: "startMiter", label: "Start Miter", value: this.m.startMiter, min: -MAX_MEMBER_MITER, max: MAX_MEMBER_MITER, unit: "°" },
        { kind: "number", key: "endMiter", label: "End Miter", value: this.m.endMiter, min: -MAX_MEMBER_MITER, max: MAX_MEMBER_MITER, unit: "°" },
        { kind: "check", key: "startCap", label: "Start Cap", value: this.m.startCap },
        { kind: "check", key: "endCap", label: "End Cap", value: this.m.endCap },
        { kind: "check", key: "mark", label: "Use Center Mark", value: this.useMark },
        { kind: "length", key: "markLength", label: "Mark Length", value: this.markLength },
        { kind: "length", key: "markGap", label: "Mark Gap", value: this.markGap, zero: true },
      ],
      `Column Insertion: click where the column stands (a drag turns it): its section, Depth up the screen and Breadth across, a steel section as Steel Section draws it (Web and Flange Thickness; a square tube's size and a round tube's diameter its Depth), a circle the Breadth across. Linear Insertion: click its start and end; Poly Insertion: click its path's corners, a double-click or Enter ending it. From above it's the Breadth wide (a square or round tube's Depth), the clicks on its Left, Center or Right edge as seen along it, moved the Offset to its left (right when negative). Start and End Offset run each end on past its click (cut it back when negative); Start and End Miter cut each end up to ${MAX_MEMBER_MITER}° from square (positive lengthens its left edge there); Start and End Cap draw a line across each end. Use Center Mark puts a line the Mark Length on its middle beyond each end, the Mark Gap from it. Member ID, structural usage, materials and their shapes' libraries, covers, profile rotation, vertical alignment, elevations and bounds, column height, bevels, automatic end conditions and joining, attributes by cut plane and 3D aren't kept.`,
    );
    if (!v) return;
    this.shape = SHAPES.find((s) => s.value === v.choice("shape"))?.value ?? this.shape;
    this.size = { depth: v.num("depth"), width: v.num("width"), web: v.num("web"), flange: v.num("flange") };
    this.useMark = v.flag("mark");
    this.markLength = v.num("markLength");
    this.markGap = Math.max(0, v.num("markGap"));
    this.m = {
      align: pick(ALIGNS, v.choice("align"), this.m.align),
      offset: v.num("offset"),
      startOffset: v.num("startOffset"),
      endOffset: v.num("endOffset"),
      startMiter: v.num("startMiter"),
      endMiter: v.num("endMiter"),
      startCap: v.flag("startCap"),
      endCap: v.flag("endCap"),
      mark: null,
    };
  }

  hint(): string {
    if (this.insertion === "column") return this.press ? `Release to place · drag turns it · Shift ${ANGLE_STEP_DEG}°` : "Click where the column stands, or press and drag to turn it · 1–3 insertion";
    if (this.insertion === "linear" && super.snapFrom()) return `Click the member's end · Shift ${ANGLE_STEP_DEG}°`;
    return super.hint();
  }

  protected startHint(): string {
    return "Click the member's start · 1–3 insertion";
  }

  snapFrom(): Pt | null {
    return this.insertion === "column" ? (this.press?.at ?? null) : super.snapFrom();
  }

  down(p: PointerInfo): void {
    this.pointer = p;
    if (this.insertion === "column") {
      this.press = { at: p.pos, screen: p.screen };
      return;
    }
    const start = this.insertion === "linear" ? super.snapFrom() : null;
    if (!start) {
      super.down(p);
      return;
    }
    super.cancel();
    const end = p.shift ? snapAngle(start, p.pos, ANGLE_STEP_DEG) : p.pos;
    const parts = this.parts([start, end], false);
    if (typeof parts === "string") toast(parts, "info");
    else addPieces(this.label, [parts]);
  }

  move(p: PointerInfo): void {
    this.pointer = p;
    super.move(p);
  }

  up(p: PointerInfo): void {
    const press = this.press;
    this.press = null;
    if (this.insertion !== "column" || !press) return;
    const parts = this.column(press.at, this.turn(press, p));
    if (typeof parts === "string") toast(parts, "info");
    else addPieces(this.label, [parts]);
  }

  cancel(): void {
    this.press = null;
    super.cancel();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    if (this.insertion !== "column") return super.key(e);
    if (e.key !== "Escape" || !this.press) return false;
    this.press = null;
    return true;
  }

  overlay(g: Painter): void {
    if (this.insertion !== "column") {
      super.overlay(g);
      return;
    }
    const p = this.pointer;
    if (!p) return;
    const parts = this.press ? this.column(this.press.at, this.turn(this.press, p)) : this.column(p.pos, 0);
    if (typeof parts !== "string") preview(g, parts);
  }

  private profile(): MemberProfile {
    return { shape: (SHAPES.find((s) => s.value === this.shape) ?? SHAPES[0]).shape, size: this.size };
  }

  /** The turn a press dragged to `p` gives: none for a click, else toward the pointer (Shift: 15° steps), the column's breadth along the drag. */
  private turn(press: { at: Pt; screen: Pt }, p: PointerInfo): number {
    if (dist(p.screen, press.screen) <= CLICK_PX) return 0;
    const to = p.shift ? snapAngle(press.at, p.pos, ANGLE_STEP_DEG) : p.pos;
    return Math.atan2(to.y - press.at.y, to.x - press.at.x);
  }

  /** A column standing at `at`, turned `angle` radians, or why it can't. */
  private column(at: Pt, angle: number): Part[] | string {
    if (layerScale(this.env) === null) return "Make a design layer active to place a structural member.";
    const section = columnSection(this.profile());
    if (typeof section === "string") return section;
    return [{ kind: "polygon", points: placed(section, at, angle), closed: true }];
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    if (layerScale(this.env) === null) return "Make a design layer active to place a structural member.";
    const path = closed ? [...points, points[0]] : points;
    const plan = linearMember(path, memberBreadth(this.profile()), { ...this.m, mark: this.useMark ? { length: this.markLength, gap: this.markGap } : null });
    if (typeof plan === "string") return plan;
    const line = (points: Pt[]): Part => ({ kind: "polyline", points, closed: false });
    const outline: Part[] =
      plan.caps.length === 2
        ? [{ kind: "polygon", points: plan.body, closed: true }]
        : [{ shape: { kind: "polygon", points: plan.body, closed: true }, attrs: { lineStyle: 0 } }, line(plan.left), line(plan.right), ...plan.caps.map(line)];
    return [...outline, ...plan.marks.map(line)];
  }
}
