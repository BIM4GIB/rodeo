// Dims/Notes' Title Block Border (sheetBorderShapes.ts). Vectorworks makes a title block border
// object of it, its title block a layout linked to the drawing's project and sheet data; this draws
// what it shows, as plain 2D objects grouped in the active class, its sizes on paper times the
// layer's scale. A click places the border centred on it; the pointer previews it. Esc cancels.

import type { Pt } from "../../core/index.ts";
import { MAX_ZONES, SHEET_SIZES, sheetBorder, type CropMarks, type SheetBorder } from "../sheetBorderShapes.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { BaseTool, type Painter, type PointerInfo } from "../tools.ts";
import { addPieces, layerScale, preview, type Part } from "./detailing.ts";

type Options<T extends string> = readonly { readonly value: T; readonly label: string }[];
const pick = <T extends string>(list: Options<T>, v: string, fallback: T): T => list.find((o) => o.value === v)?.value ?? fallback;

const CROPS: Options<CropMarks> = [
  { value: "none", label: "None" },
  { value: "crops", label: "Crops" },
  { value: "outline", label: "Outline" },
  { value: "both", label: "Crops + Outline" },
];
const H_CENTRE = 2;
const H_LEFT = 1;
const V_CENTRE = 3;
/** mils in a mm, for line weights */
const MILS_PER_MM = 1000 / 25.4;

/** Today as the drawing's title blocks usually show it. */
const today = (): string => new Date().toISOString().slice(0, 10);

export class TitleBlockBorderTool extends BaseTool {
  readonly id = "tbborder";
  readonly cursor = "crosshair";
  private size = "a1";
  private custom = { width: 841, height: 594 };
  private portrait = false;
  private s: Omit<SheetBorder, "width" | "height" | "titleBlock"> = {
    fit: "outer",
    margins: { left: 20, right: 10, top: 10, bottom: 10 },
    across: 0,
    down: 0,
    lettersFrom: "top",
    numbersFrom: "left",
    labelSize: 3.5,
    markerLength: 5,
    showGrids: true,
    extensions: false,
    crop: "none",
    hideBorder: false,
  };
  private borderWeight = 0.7;
  private showBlock = true;
  private block = { factor: 1, project: "", sheetTitle: "", drawnBy: "", date: today(), scale: "", sheetNumber: "A-101" };
  private pointer: Pt | null = null;

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Title Block Border Settings",
      [
        { kind: "choice", key: "size", label: "Sheet Size", value: this.size, options: [...SHEET_SIZES.map((s) => ({ value: s.id, label: s.label })), { value: "custom", label: "Custom" }] },
        { kind: "length", key: "width", label: "Custom Width", value: this.custom.width },
        { kind: "length", key: "height", label: "Custom Height", value: this.custom.height },
        { kind: "choice", key: "orientation", label: "Orientation", value: this.portrait ? "portrait" : "landscape", options: [{ value: "landscape", label: "Landscape" }, { value: "portrait", label: "Portrait" }] },
        { kind: "choice", key: "fit", label: "Sheet Fit Mode", value: this.s.fit, options: [{ value: "outer", label: "Outer Border" }, { value: "inner", label: "Inner Border" }] },
        { kind: "length", key: "left", label: "Left Margin", value: this.s.margins.left, zero: true },
        { kind: "length", key: "right", label: "Right Margin", value: this.s.margins.right, zero: true },
        { kind: "length", key: "top", label: "Top Margin", value: this.s.margins.top, zero: true },
        { kind: "length", key: "bottom", label: "Bottom Margin", value: this.s.margins.bottom, zero: true },
        { kind: "check", key: "hide", label: "Hide border", value: this.s.hideBorder },
        { kind: "number", key: "weight", label: "Border Line Weight", value: this.borderWeight, min: 0.05, max: 5, unit: "mm" },
        { kind: "check", key: "grids", label: "Show grids", value: this.s.showGrids },
        { kind: "number", key: "down", label: "Vertical Zones", value: this.s.down, min: 0, max: MAX_ZONES },
        { kind: "choice", key: "letters", label: "Grid Text Order", value: this.s.lettersFrom, options: [{ value: "top", label: "Top to Bottom" }, { value: "bottom", label: "Bottom to Top" }] },
        { kind: "number", key: "across", label: "Horizontal Zones", value: this.s.across, min: 0, max: MAX_ZONES },
        { kind: "choice", key: "numbers", label: "Grid Number Order", value: this.s.numbersFrom, options: [{ value: "left", label: "Left to Right" }, { value: "right", label: "Right to Left" }] },
        { kind: "number", key: "labelSize", label: "Grid Label Size", value: this.s.labelSize, min: 0.5, max: 50, unit: "mm" },
        { kind: "length", key: "marker", label: "Grid Marker Line Length", value: this.s.markerLength, zero: true },
        { kind: "check", key: "extensions", label: "Show grid line extensions", value: this.s.extensions },
        { kind: "choice", key: "crop", label: "Crop Marks", value: this.s.crop, options: CROPS.map((c) => ({ value: c.value, label: c.label })) },
        { kind: "check", key: "block", label: "Show Title Block", value: this.showBlock },
        { kind: "number", key: "factor", label: "Title Block Scale Factor", value: this.block.factor, min: 0.1, max: 10 },
        { kind: "text", key: "project", label: "Project Name", value: this.block.project },
        { kind: "text", key: "sheetTitle", label: "Sheet Title", value: this.block.sheetTitle },
        { kind: "text", key: "sheetNumber", label: "Sheet Number", value: this.block.sheetNumber },
        { kind: "text", key: "drawnBy", label: "Drawn By", value: this.block.drawnBy },
        { kind: "text", key: "date", label: "Date", value: this.block.date },
        { kind: "text", key: "scale", label: "Scale (blank: the layer's)", value: this.block.scale },
      ],
      "A click places the border centred on it, its sizes on paper times the layer's scale. The sheet is the margins' outside edge (Outer Border) or the frame inside them (Inner Border); the frame is drawn the Border Line Weight. Show grids letters the vertical zones (no I or O) and numbers the horizontal ones in the margins, with marker lines between them out from the frame; 0 zones gives one about every 50 mm. Grid line extensions run the frame's lines out through the margins; crop marks are crosses on the sheet's corners, the outline its edge. The title block sits in the frame's bottom right corner: project, sheet title, drawn by, date, scale and sheet number. Hide border leaves only the title block. Title block layouts and styles, project, sheet, revision and issue data shared with Title Block Manager, fold marks, countersignatures, locking to the page centre and fills aren't kept.",
    );
    if (!v) return;
    this.size = v.choice("size") === "custom" ? "custom" : (SHEET_SIZES.find((s) => s.id === v.choice("size"))?.id ?? this.size);
    this.custom = { width: v.num("width"), height: v.num("height") };
    this.portrait = v.choice("orientation") === "portrait";
    this.borderWeight = v.num("weight");
    this.showBlock = v.flag("block");
    this.s = {
      fit: v.choice("fit") === "inner" ? "inner" : "outer",
      margins: { left: v.num("left"), right: v.num("right"), top: v.num("top"), bottom: v.num("bottom") },
      across: Math.round(v.num("across")),
      down: Math.round(v.num("down")),
      lettersFrom: v.choice("letters") === "bottom" ? "bottom" : "top",
      numbersFrom: v.choice("numbers") === "right" ? "right" : "left",
      labelSize: v.num("labelSize"),
      markerLength: v.num("marker"),
      showGrids: v.flag("grids"),
      extensions: v.flag("extensions"),
      crop: pick(CROPS, v.choice("crop"), this.s.crop),
      hideBorder: v.flag("hide"),
    };
    this.block = {
      factor: v.num("factor"),
      project: v.choice("project"),
      sheetTitle: v.choice("sheetTitle"),
      sheetNumber: v.choice("sheetNumber"),
      drawnBy: v.choice("drawnBy"),
      date: v.choice("date"),
      scale: v.choice("scale"),
    };
  }

  hint(): string {
    return "Click where the border's centre goes";
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.detail > 1) return;
    const parts = this.parts(p.pos);
    if (typeof parts === "string") toast(parts, "info");
    else addPieces("Title Block Border", [parts]);
  }

  cancel(): void {
    this.pointer = null;
  }

  overlay(g: Painter): void {
    if (!this.pointer) return;
    const parts = this.parts(this.pointer);
    if (typeof parts !== "string") preview(g, parts);
  }

  /** The border centred on `at`, or why it can't be placed. */
  private parts(at: Pt): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a layer active to place a title block border.";
    const sheet = this.size === "custom" ? this.custom : SHEET_SIZES.find((s) => s.id === this.size)!;
    const [w, h] = this.portrait ? [Math.min(sheet.width, sheet.height), Math.max(sheet.width, sheet.height)] : [Math.max(sheet.width, sheet.height), Math.min(sheet.width, sheet.height)];
    const block = this.showBlock ? { ...this.block, scale: this.block.scale.trim() || `1:${scale}` } : null;
    const plan = sheetBorder({ ...this.s, width: w, height: h, titleBlock: block });
    if (typeof plan === "string") return plan;
    const place = (pts: Pt[]): Pt[] => pts.map((p) => ({ x: at.x + p.x * scale, y: at.y + p.y * scale }));
    return [
      ...plan.heavy.map((pts): Part => ({ shape: { kind: "polygon", points: place(pts), closed: true }, attrs: { fillPattern: 0, lineWeight: Math.round(this.borderWeight * MILS_PER_MM) } })),
      ...plan.outlines.map((pts): Part => ({ shape: { kind: "polygon", points: place(pts), closed: true }, attrs: { fillPattern: 0 } })),
      ...plan.lines.map((pts): Part => ({ kind: "polyline", points: place(pts), closed: false })),
      ...plan.texts.map((t): Part => ({ kind: "text", at: place([t.at])[0], text: t.text, height: t.height * scale, hAlign: t.justify === "left" ? H_LEFT : H_CENTRE, vAlign: V_CENTRE })),
    ];
  }
}
