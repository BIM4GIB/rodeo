// Dims/Notes' Redline and General Notes (noteShapes.ts). Vectorworks makes plug-in objects of them;
// these draw what those objects draw, as plain 2D objects grouped in the active class, sizes on
// paper (times the layer scale). Esc cancels.
//
// Redline: Oval and Rectangular take a drag or two clicks; Regular Polygon takes each corner, a
// click on the first, a double-click or Enter closing it; Freehand Polygon follows a press dragged,
// closing it on release. The outline is a cloud, rounded at its corners or plain (Radius Dashed and
// Simple Dashed in the drawing's first dashed line type, solid in a drawing that has none), unfilled
// and red; the Place Redline dialog then asks for the notation, and a leader runs to a tag with the
// date and who authorised and was assigned it over a line, the notation under it.
// General Notes: a click places the block's top left, then the General Notes dialog takes the notes,
// one a line; they are numbered or lettered in order under the title.

import type { Pt } from "../../core/index.ts";
import { h } from "../dom.ts";
import { dist, normalizeRect, signedArea } from "../geom.ts";
import { showDialog } from "../menubar.ts";
import {
  generalNotes,
  ovalOutline,
  redlineTag,
  resampleOutline,
  roundCorners,
  type BodyAlign,
  type GeneralNotesLook,
  type NoteNumbers,
  type TagAlign,
} from "../noteShapes.ts";
import { redlineClass, redlineDate, redlineName, redlineRed } from "../redlines.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../tools.ts";
import { cloudOutline } from "./cloud.ts";
import { addPieces, layerScale, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

type RedlineMode = "oval" | "rect" | "polygon" | "freehand";
type RedlineStyle = "cloud" | "radius" | "radiusDashed" | "simple" | "simpleDashed";

const REDLINE_MODES: readonly { readonly id: RedlineMode; readonly label: string }[] = [
  { id: "oval", label: "Oval" },
  { id: "rect", label: "Rectangular" },
  { id: "polygon", label: "Regular Polygon" },
  { id: "freehand", label: "Freehand Polygon" },
];
const REDLINE_STYLES: readonly { readonly value: RedlineStyle; readonly label: string }[] = [
  { value: "cloud", label: "Cloud" },
  { value: "radius", label: "Radius" },
  { value: "radiusDashed", label: "Radius Dashed" },
  { value: "simple", label: "Simple" },
  { value: "simpleDashed", label: "Simple Dashed" },
];
const TAG_ALIGNS: readonly { readonly value: TagAlign; readonly label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
];

/** sizes on paper, mm */
const CLOUD_ARC_MM = 6;
const CORNER_MM = 3;
const TAG_OFFSET_MM = 6;
/** pointer travel (CSS px) below which a press is a click; clicks this close to the first corner close a polygon; a freehand stroke's points at least this far apart */
const CLICK_PX = 4;
const CLOSE_PX = 6;
const FREEHAND_PX = 4;

/** `part` drawn in the pen colour `pen`, with whatever else it was styled with. */
const inPen = (part: Part, pen: number): Part => ("shape" in part ? { ...part, attrs: { ...part.attrs, penFore: pen } } : { shape: part, attrs: { penFore: pen } });

export class RedlineTool extends BaseTool {
  readonly id = "redline";
  readonly cursor = "crosshair";
  private mode: RedlineMode = "rect";
  private style: RedlineStyle = "cloud";
  private authorized = "";
  private assigned = "";
  private showAuthorizer = true;
  private showAssignee = false;
  private align: TagAlign = "auto";
  private tagMm = 35;
  private textMm = 2.5;
  private points: Pt[] = [];
  private pressScreen: Pt | null = null;
  private cursorAt: Pt | null = null;
  /** a freehand stroke under way, and the screen point of its last sample */
  private stroke: Pt | null = null;
  /** the Place Redline dialog is open */
  private busy = false;

  modes(): readonly ToolModes[] {
    return [{ label: "Redline", options: REDLINE_MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const mode = REDLINE_MODES.find((m) => m.id === id);
    if (!mode) return;
    this.mode = mode.id;
    this.reset();
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Redline Preferences",
      [
        { kind: "choice", key: "style", label: "Redline Style", value: this.style, options: REDLINE_STYLES },
        { kind: "text", key: "authorized", label: "Authorized By", value: this.authorized },
        { kind: "text", key: "assigned", label: "Assigned To", value: this.assigned },
        { kind: "check", key: "showAuthorizer", label: "Show Authorizer", value: this.showAuthorizer },
        { kind: "check", key: "showAssignee", label: "Show Assignee", value: this.showAssignee },
        { kind: "choice", key: "align", label: "Tag Alignment", value: this.align, options: TAG_ALIGNS },
        { kind: "number", key: "tag", label: "Tag Length", value: this.tagMm, min: 5, max: 300, unit: "mm" },
        { kind: "number", key: "text", label: "Text Size", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      "Sizes are on paper: a layer at 1:n draws them n times larger. The redline is red, unfilled: a cloud, its corners rounded (Radius) or plain (Simple); the dashed styles take the drawing's first dashed line type, and stay solid in a drawing that has none. The tag stands up and out past the outline's top corner, to the right (Auto and Right) or left, with today's date and the names shown over a line of the tag length and the notation wrapped under it.",
    );
    if (!v) return;
    this.style = REDLINE_STYLES.find((s) => s.value === v.choice("style"))?.value ?? "cloud";
    this.authorized = v.choice("authorized");
    this.assigned = v.choice("assigned");
    this.showAuthorizer = v.flag("showAuthorizer");
    this.showAssignee = v.flag("showAssignee");
    this.align = TAG_ALIGNS.find((a) => a.value === v.choice("align"))?.value ?? "auto";
    this.tagMm = v.num("tag");
    this.textMm = v.num("text");
  }

  snapFrom(): Pt | null {
    return this.mode === "freehand" ? null : (this.points.at(-1) ?? null);
  }

  hint(): string {
    const keys = "1–4 mode";
    if (this.mode === "freehand") return this.stroke ? "Release to close the outline" : `Press and drag round the change · ${keys}`;
    if (this.mode === "polygon") return this.points.length ? "Click the next corner · click the first, double-click or Enter closes it" : `Click the first corner · ${keys}`;
    return this.points.length ? "Click or release at the opposite corner" : `Drag round the change or click a corner · ${keys}`;
  }

  down(p: PointerInfo): void {
    if (this.busy) return;
    this.pressScreen = p.screen;
    if (this.mode === "freehand") {
      this.points = [p.pos];
      this.stroke = p.screen;
      return;
    }
    if (this.mode !== "polygon") {
      if (this.points.length === 0) this.points = [p.pos];
      else void this.finish([this.points[0], p.pos]);
      return;
    }
    const first = this.points[0];
    if (this.points.length >= 3 && dist(p.pos, first) * this.env.view.scale <= CLOSE_PX) {
      void this.finish(this.points);
      return;
    }
    const last = this.points.at(-1);
    if (!last || dist(last, p.pos) * this.env.view.scale > CLICK_PX) this.points.push(p.pos);
    if (p.detail >= 2) void this.finish(this.points);
  }

  move(p: PointerInfo): void {
    this.cursorAt = p.pos;
    if (this.stroke && dist(this.stroke, p.screen) >= FREEHAND_PX) {
      this.points.push(p.pos);
      this.stroke = p.screen;
    }
  }

  up(p: PointerInfo): void {
    const press = this.pressScreen;
    this.pressScreen = null;
    if (this.stroke) {
      this.stroke = null;
      void this.finish(this.points);
      return;
    }
    if ((this.mode === "oval" || this.mode === "rect") && this.points.length === 1 && press && dist(p.screen, press) > CLICK_PX) void this.finish([this.points[0], p.pos]);
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
    if (e.key === "Enter" && this.mode === "polygon") void this.finish(this.points);
    else if (e.key === "Escape") this.reset();
    else return false;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.cursorAt;
    if (!at || this.points.length === 0) return;
    const pts = this.stroke ? this.points : [...this.points, at];
    const outline = this.outline(pts);
    const styled = outline && this.styled(outline);
    withPreview(g, () => strokeScreen(g, styled ?? pts, styled !== null));
  }

  /** The outline drawn: the box two corners span or the oval in it, or the polygon. Null when it has no area. */
  private outline(pts: readonly Pt[]): Pt[] | null {
    if (this.mode === "oval") return pts.length >= 2 ? ovalOutline(pts[0], pts[pts.length - 1]) : null;
    let outline: Pt[];
    if (this.mode === "rect") {
      if (pts.length < 2) return null;
      const r = normalizeRect(pts[0], pts[pts.length - 1]);
      outline = [
        { x: r.x0, y: r.y0 },
        { x: r.x1, y: r.y0 },
        { x: r.x1, y: r.y1 },
        { x: r.x0, y: r.y1 },
      ];
    } else outline = [...pts];
    return outline.length >= 3 && Math.abs(signedArea(outline)) > 0 ? outline : null;
  }

  /** The outline in the redline's style: a cloud, rounded corners, or as it is. */
  private styled(outline: readonly Pt[]): Pt[] | null {
    const scale = layerScale(this.env);
    if (scale === null) return null;
    const arc = CLOUD_ARC_MM * scale;
    // an oval's or a stroke's short sides would each take two tiny arcs: evened out, a side takes two arcs of about the arc length
    if (this.style === "cloud") return cloudOutline(this.mode === "oval" || this.mode === "freehand" ? resampleOutline(outline, 2 * arc) : outline, arc);
    if (this.style.startsWith("radius") && this.mode !== "oval") return roundCorners(outline, CORNER_MM * scale);
    return [...outline];
  }

  /** Asks for the notation, then draws the redline round `pts` with its tag. */
  private async finish(pts: readonly Pt[]): Promise<void> {
    const outline = this.outline(pts);
    const styled = outline && this.styled(outline);
    this.reset();
    const scale = layerScale(this.env);
    if (!styled || scale === null) {
      toast("A redline needs an outline with some area.", "info");
      return;
    }
    this.busy = true;
    const v = await toolPrefs("Place Redline", [
      { kind: "text", key: "notation", label: "Redline Notation", value: "" },
      { kind: "text", key: "authorized", label: "Authorized By", value: this.authorized },
      { kind: "text", key: "assigned", label: "Assigned To", value: this.assigned },
    ]).finally(() => {
      this.busy = false;
    });
    if (!v) return;
    const date = redlineDate();
    // the names typed stand for the next redline
    const authorized = (this.authorized = v.choice("authorized"));
    const assigned = (this.assigned = v.choice("assigned"));
    const tag = redlineTag(styled, {
      info: [date, this.showAuthorizer && authorized ? `Auth By: ${authorized}` : "", this.showAssignee && assigned ? `Assigned To: ${assigned}` : ""],
      notation: v.choice("notation"),
      align: this.align,
      length: this.tagMm * scale,
      height: this.textMm * scale,
      offset: TAG_OFFSET_MM * scale,
    });
    if (!tag) return;
    const red = redlineRed();
    const dashed = this.style.endsWith("Dashed") ? store.session?.doc.lineTypes().find((t) => t.dashes.length > 0) : undefined;
    const outlinePart: Part = { shape: { kind: "polygon", points: styled, closed: true }, attrs: { penFore: red, fillPattern: 0, ...(dashed ? { lineStyle: dashed.style } : {}) } };
    const rest = markerParts({ outlines: [], lines: [tag.leader, tag.separator], circles: [], filled: [], texts: tag.texts }).map((part) => inPen(part, red));
    const cls = redlineClass();
    const classed = (part: Part): Part => (cls === undefined ? part : "shape" in part ? { ...part, classIndex: cls } : { shape: part, classIndex: cls });
    addPieces("Redline", [[outlinePart, ...rest].map(classed)], redlineName(date), cls);
  }

  private reset(): void {
    this.points = [];
    this.pressScreen = null;
    this.stroke = null;
  }
}

const NUMBERS: readonly { readonly value: NoteNumbers; readonly label: string }[] = [
  { value: "1", label: "1" },
  { value: "1.", label: "1." },
  { value: "A", label: "A" },
  { value: "A.", label: "A." },
  { value: "a", label: "a" },
  { value: "a.", label: "a." },
];
const BODY_ALIGNS: readonly { readonly value: BodyAlign; readonly label: string }[] = [
  { value: "left", label: "Left" },
  { value: "centre", label: "Center" },
  { value: "right", label: "Right" },
];

/** The General Notes dialog: the notes, one a line. Null when cancelled. */
async function notesDialog(notes: readonly string[]): Promise<string[] | null> {
  const area = h("textarea", {
    cls: "menu-dialog-input",
    attrs: { rows: "10", "aria-label": "Notes", spellcheck: "true", style: "width: 100%; min-height: 12em; resize: vertical; font: inherit; box-sizing: border-box" },
  });
  area.value = notes.join("\n");
  const shown = showDialog<string[]>({
    title: "General Notes",
    okLabel: "OK",
    body: [h("p", { cls: "menu-dialog-text", text: "One note a line; they are numbered in this order." }), area],
    check: () => {
      const list = area.value
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean);
      return list.length ? { value: list } : { error: "Type at least one note.", focus: area };
    },
  });
  area.focus();
  return shown;
}

export class GeneralNotesTool extends BaseTool {
  readonly id = "generalnotes";
  readonly cursor = "crosshair";
  private title = "General Notes";
  private numbers: NoteNumbers = "1.";
  private prefix = "";
  private suffix = "";
  private widthMm = 100;
  private indentMm = 6;
  private spacing = 0;
  private columns = 1;
  private gutterMm = 10;
  private breakAcross = false;
  private align: BodyAlign = "left";
  private titleMm = 3.5;
  private textMm = 2.5;
  /** the notes last placed, offered again */
  private notes: string[] = [];
  private busy = false;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "General Notes Preferences",
      [
        { kind: "text", key: "title", label: "Title", value: this.title },
        { kind: "choice", key: "numbers", label: "General Notes Display", value: this.numbers, options: NUMBERS },
        { kind: "text", key: "prefix", label: "Prefix", value: this.prefix },
        { kind: "text", key: "suffix", label: "Suffix", value: this.suffix },
        { kind: "number", key: "width", label: "Overall Width", value: this.widthMm, min: 10, max: 2000, unit: "mm" },
        { kind: "number", key: "indent", label: "Note Text Indent", value: this.indentMm, min: 0, max: 200, unit: "mm" },
        { kind: "number", key: "spacing", label: "Line Spacing", value: this.spacing, min: 0, max: 10, integer: true },
        { kind: "number", key: "columns", label: "# of Columns", value: this.columns, min: 1, max: 12, integer: true },
        { kind: "number", key: "gutter", label: "Gutter Width", value: this.gutterMm, min: 0, max: 500, unit: "mm" },
        { kind: "check", key: "break", label: "Break Note Text Across Columns", value: this.breakAcross },
        { kind: "choice", key: "align", label: "Body Text Alignment", value: this.align, options: BODY_ALIGNS },
        { kind: "number", key: "titleSize", label: "Title Text Size", value: this.titleMm, min: 0.5, max: 50, unit: "mm" },
        { kind: "number", key: "textSize", label: "Body Text Size", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
      ],
      "Sizes are on paper: a layer at 1:n draws them n times larger. Each column is the overall width, the notes' text starting the indent past their marks and wrapped to the rest; Line Spacing is the blank lines between notes. Several columns fill left to right to about the same depth, a note moving whole to the next column unless it may break across.",
    );
    if (!v) return;
    this.title = v.choice("title");
    this.numbers = NUMBERS.find((n) => n.value === v.choice("numbers"))?.value ?? "1.";
    this.prefix = v.choice("prefix");
    this.suffix = v.choice("suffix");
    this.widthMm = v.num("width");
    this.indentMm = v.num("indent");
    this.spacing = v.num("spacing");
    this.columns = Math.round(v.num("columns"));
    this.gutterMm = v.num("gutter");
    this.breakAcross = v.flag("break");
    this.align = BODY_ALIGNS.find((a) => a.value === v.choice("align"))?.value ?? "left";
    this.titleMm = v.num("titleSize");
    this.textMm = v.num("textSize");
  }

  hint(): string {
    return "Click where the notes' top left goes, then type the notes";
  }

  down(p: PointerInfo): void {
    if (this.busy) return;
    this.busy = true;
    void this.place(p.pos).finally(() => {
      this.busy = false;
    });
  }

  private async place(at: Pt): Promise<void> {
    const notes = await notesDialog(this.notes);
    if (!notes) return;
    this.notes = notes;
    const scale = layerScale(this.env);
    const look: GeneralNotesLook = {
      title: this.title,
      numbers: this.numbers,
      prefix: this.prefix,
      suffix: this.suffix,
      width: this.widthMm * (scale ?? 1),
      indent: this.indentMm * (scale ?? 1),
      spacing: this.spacing,
      columns: this.columns,
      gutter: this.gutterMm * (scale ?? 1),
      breakAcross: this.breakAcross,
      align: this.align,
      titleHeight: this.titleMm * (scale ?? 1),
      height: this.textMm * (scale ?? 1),
    };
    const layout = scale === null ? null : generalNotes(at, notes, look);
    if (!layout) {
      toast("The general notes need an overall width wider than the note text indent.", "info");
      return;
    }
    addPieces("General Notes", [markerParts({ outlines: [], lines: layout.lines, circles: [], filled: [], texts: layout.texts })]);
  }
}
