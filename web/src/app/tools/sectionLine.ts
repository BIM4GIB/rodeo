// Dims/Notes' Section-Elevation Line: click each corner of the line, a double-click or Enter ending
// it (a click back on its first corner ends it there). Section puts a bubble past each end, Partial
// Section past its start, and Elevation one on its middle, the line stopping at its circle; each
// arrow looks square to its segment, to the left or right of the way the line was drawn. Use gapped
// line keeps only the Gap Line Length of a section's line at each end. The bubble's size is on
// paper, times the Marker Scale Factor. Plain 2D objects grouped in the active class, as the other
// markers (markerShapes.ts). Esc cancels.

import type { Pt } from "../../core/index.ts";
import { sectionLine, type Look, type SectionConfig } from "../markerShapes.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { modeForKey, type ToolModes } from "../tools.ts";
import { layerScale, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";
import { PathTool } from "./paths.ts";

/** a bubble's diameter on paper, mm, at a Marker Scale Factor of 1 */
const BUBBLE_MM = 10;

const CONFIGS: readonly { readonly id: SectionConfig; readonly label: string }[] = [
  { id: "section", label: "Section" },
  { id: "partial", label: "Partial Section" },
  { id: "elevation", label: "Elevation" },
];
const LOOKS: readonly { readonly id: Look; readonly label: string }[] = [
  { id: "left", label: "Look Left" },
  { id: "right", label: "Look Right" },
];

export class SectionLineTool extends PathTool {
  readonly id = "secline";
  protected readonly label = "Section-Elevation Line";
  private config: SectionConfig = "section";
  private look: Look = "left";
  private number = "1";
  private sheet = "A-301";
  private factor = 1;
  private gapped = false;
  private gap = 1000;

  modes(): readonly ToolModes[] {
    return [
      { label: "Configuration", options: CONFIGS.map((c, i) => ({ id: c.id, label: c.label, key: String(i + 1) })), active: this.config },
      { label: "Look", options: LOOKS.map((l, i) => ({ id: l.id, label: l.label, key: String(i + 1 + CONFIGS.length) })), active: this.look },
    ];
  }

  setMode(id: string): void {
    this.config = CONFIGS.find((c) => c.id === id)?.id ?? this.config;
    this.look = LOOKS.find((l) => l.id === id)?.id ?? this.look;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Section-Elevation Line Preferences",
      [
        { kind: "text", key: "number", label: "Drawing Number", value: this.number },
        { kind: "text", key: "sheet", label: "Sheet Number", value: this.sheet },
        { kind: "number", key: "factor", label: "Marker Scale Factor", value: this.factor, min: 0.1, max: 10 },
        { kind: "check", key: "gapped", label: "Use gapped line", value: this.gapped },
        { kind: "length", key: "gap", label: "Gap Line Length", value: this.gap },
      ],
      `Click each corner of the line; a double-click or Enter ends it. Keys 1–3 choose Section (a bubble past each end), Partial Section (past its start) or Elevation (on its middle); 4–5 look to the left or right of the way it's drawn. A bubble is ${BUBBLE_MM} mm across on paper times the Marker Scale Factor, its drawing number over its sheet number, kept level. Use gapped line keeps only the Gap Line Length of a section's line at each end. Linked viewports, auto-coordinated titles, styles, edited marker layouts, a different end marker, the drawing title and note, and moving an elevation's marker along its line aren't kept.`,
    );
    if (!v) return;
    this.number = v.choice("number");
    this.sheet = v.choice("sheet");
    this.factor = v.num("factor");
    this.gapped = v.flag("gapped");
    this.gap = v.num("gap");
  }

  protected startHint(): string {
    return "Click the line's start · 1–3 configuration · 4–5 look";
  }

  protected parts(points: Pt[], closed: boolean): Part[] | string {
    const scale = layerScale(this.env);
    if (scale === null) return "Make a layer active to draw a section-elevation line.";
    const r = (BUBBLE_MM / 2) * this.factor * scale;
    const line = { config: this.config, look: this.look, gap: this.gapped ? this.gap : null };
    const d = sectionLine(closed ? [...points, points[0]!] : points, line, r, this.number, this.sheet);
    if (!d) return this.config === "elevation" ? "Draw an elevation line longer than its bubble." : "Click the line's corners apart.";
    return markerParts(d);
  }
}
