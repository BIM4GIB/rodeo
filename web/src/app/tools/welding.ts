// Dims/Notes' Welding Sym- tools: AWS A2.4's and ISO 2553's fillet, flange, groove, miscellaneous
// and slot-plug welding symbols (weldShapes.ts), each a click on the joint and a click where the
// arrow meets the reference line, what the symbol says set in Preferences as Vectorworks' Object
// Info lists it. Plain objects, grouped, where Vectorworks makes plug-in objects.

import type { Pt } from "../../core/index.ts";
import type { ToolEnv } from "../tools.ts";
import { toolPrefs, type PrefField } from "../toolPrefs.ts";
import {
  bracketed,
  degrees,
  weldingSymbol,
  type FieldFlag,
  type FinishContour,
  type FinishMethod,
  type GrooveSymbol,
  type WeldGlyph,
  type WeldLayout,
  type WeldSideData,
  type WeldStandard,
} from "../weldShapes.ts";
import { TwoPointTool, type Part } from "./detailing.ts";
import { markerParts } from "./markers.ts";

/** the symbol's size and its texts' height on paper, mm, until Preferences change it */
const TEXT_MM = 2.5;

type Options = readonly { readonly value: string; readonly label: string }[];

const CONTOURS: Options = [
  { value: "none", label: "None" },
  { value: "flush", label: "Flush or Flat" },
  { value: "convex", label: "Convex" },
  { value: "concave", label: "Concave" },
];
const METHODS: Options = [
  { value: "U", label: "Unspecified" },
  { value: "C", label: "Chipping" },
  { value: "G", label: "Grinding" },
  { value: "H", label: "Hammering" },
  { value: "M", label: "Machining" },
  { value: "R", label: "Rolling" },
];
const GROOVES: Options = [
  { value: "none", label: "<None>" },
  { value: "bevel", label: "Bevel" },
  { value: "flareBevel", label: "Flare - Bevel" },
  { value: "flareV", label: "Flare - V" },
  { value: "scarf", label: "Scarf" },
  { value: "square", label: "Square" },
  { value: "j", label: "J" },
  { value: "u", label: "U" },
  { value: "v", label: "V" },
  { value: "back", label: "Back or Backing Weld" },
  { value: "meltThrough", label: "Melt Through" },
  { value: "backing", label: "Backing" },
  { value: "backingRemove", label: "Backing (Remove)" },
  { value: "insert", label: "Consumable Insert" },
];
type Sides = "arrow" | "other" | "both" | "none";
const SIDES: Options = [
  { value: "arrow", label: "Arrow Side" },
  { value: "other", label: "Other Side" },
  { value: "both", label: "Both Sides" },
];
const CONFIGS: Options = [
  { value: "symmetrical", label: "Symmetrical" },
  { value: "arrowBelow", label: "Arrow Side Bottom/Other Side Top" },
  { value: "arrowAbove", label: "Arrow Side Top/Other Side Bottom" },
];
const FLAGS: Options = [
  { value: "topRight", label: "Top |>" },
  { value: "topLeft", label: "Top <|" },
  { value: "bottomRight", label: "Bottom |>" },
  { value: "bottomLeft", label: "Bottom <|" },
];

/** A field of what one side says: text, a choice, or a check kept as "1" or "". */
interface SideField {
  readonly key: string;
  readonly label: string;
  readonly options?: Options;
  readonly check?: boolean;
  /** asked for in this standard only */
  readonly only?: WeldStandard;
}

type Values = Readonly<Record<string, string>>;

const contourFields: readonly SideField[] = [
  { key: "contour", label: "Finish Contour", options: CONTOURS },
  { key: "method", label: "Finish Method", options: METHODS },
];
const finish = (v: Values) => ({ contour: (v.contour || "none") as FinishContour, method: (v.method || "U") as FinishMethod });

/** `a` and `b` joined by `sep`, or whichever there is. */
const joined = (a: string, b: string, sep: string): string => (a && b ? `${a}${sep}${b}` : a || b);

/** What sets a welding symbol apart: its types, its fields per side and what they draw. */
interface WeldKind {
  readonly name: string;
  /** arrow side, other side or both, with Symmetrical; otherwise one side by Significance */
  readonly twoSided: boolean;
  readonly types?: Options;
  /** a one-sided symbol's sides; across the line too for None */
  readonly significance?: Options;
  readonly stagger?: boolean;
  readonly fields: readonly SideField[];
  readonly defaults: Record<WeldStandard, Values>;
  readonly side: (std: WeldStandard, type: string, v: Values, stagger: boolean) => WeldSideData;
}

const FILLET: WeldKind = {
  name: "Fillet",
  twoSided: true,
  stagger: true,
  fields: [
    { key: "size", label: "Weld Size" },
    { key: "number", label: "Number of Welds", only: "iso" },
    { key: "length", label: "Length of Weld" },
    { key: "pitch", label: "Pitch/Spacing" },
    ...contourFields,
  ],
  defaults: { aws: { size: "1/4", length: "1", pitch: "3" }, iso: { size: "a5", number: "", length: "", pitch: "" } },
  side: (std, _type, v, stagger) => {
    const glyph: WeldGlyph = { kind: "fillet" };
    if (std === "aws") return { glyph, before: [v.size], after: [joined(v.length, v.pitch, "-")], beyond: [], ...finish(v) };
    const run = joined(v.number, v.length, " x ");
    const pitch = bracketed(v.pitch);
    return { glyph, before: [v.size], after: stagger ? [run, pitch] : [joined(run, pitch, " ")], beyond: [], ...finish(v) };
  },
};

const GROOVE: WeldKind = {
  name: "Groove",
  twoSided: true,
  fields: [
    { key: "symbol", label: "Weld Symbol", options: GROOVES },
    { key: "size", label: "Weld Size" },
    { key: "depth", label: "Depth of Bevel" },
    { key: "root", label: "Root Opening" },
    { key: "angle", label: "Groove Angle" },
    ...contourFields,
  ],
  defaults: {
    aws: { symbol: "v", size: "3/8", depth: "1/4", root: "1/8", angle: "60" },
    iso: { symbol: "v", size: "10", depth: "6", root: "3", angle: "60" },
  },
  side: (_std, _type, v) => ({
    glyph: { kind: "groove", symbol: (GROOVES.some((g) => g.value === v.symbol) ? v.symbol : "none") as GrooveSymbol },
    before: [joined(v.depth, bracketed(v.size), " ")],
    after: [],
    beyond: [v.root, degrees(v.angle)],
    ...finish(v),
  }),
};

const FLANGE: WeldKind = {
  name: "Flange",
  twoSided: false,
  types: [
    { value: "edge", label: "Edge-Flange Weld" },
    { value: "corner", label: "Corner-Flange Weld" },
  ],
  significance: SIDES.slice(0, 2),
  fields: [
    { key: "size", label: "Weld Size" },
    { key: "flange", label: "Flange Size" },
    { key: "radius", label: "Radius of Flange" },
    { key: "root", label: "Root Opening" },
    { key: "penetration", label: "Complete Joint Penetration", check: true },
  ],
  defaults: {
    aws: { size: "1/8", flange: "1/16", radius: "3/32", root: "1/64" },
    iso: { size: "4", flange: "2", radius: "2.5", root: "1" },
  },
  side: (_std, type, v) => ({
    glyph: { kind: "flange", corner: type === "corner" },
    before: [joined(v.radius, v.flange, " + "), v.size],
    after: [v.root],
    beyond: [],
    contour: "none",
    method: "U",
    penetration: v.penetration === "1",
  }),
};

const MISC: WeldKind = {
  name: "Misc",
  twoSided: false,
  types: [
    { value: "spot", label: "Spot" },
    { value: "seam", label: "Seam" },
    { value: "stud", label: "Stud" },
    { value: "surfacing", label: "Surfacing" },
  ],
  significance: [...SIDES.slice(0, 2), { value: "none", label: "None" }],
  fields: [
    { key: "size", label: "Weld Size" },
    { key: "length", label: "Length" },
    { key: "pitch", label: "Spacing or Pitch" },
    { key: "number", label: "Number of Welds" },
    ...contourFields,
  ],
  defaults: {
    aws: { size: "3/8", length: "1/2", pitch: "2", number: "6" },
    iso: { size: "8", length: "", pitch: "50", number: "6" },
  },
  side: (std, type, v) => {
    const kind = (["spot", "seam", "stud", "surfacing"].includes(type) ? type : "spot") as "spot" | "seam" | "stud" | "surfacing";
    const glyph: WeldGlyph = { kind };
    if (kind === "surfacing") return { glyph, before: [v.size], after: [], beyond: [], ...finish(v) };
    if (std === "aws") {
      const after = kind === "seam" ? joined(v.length, v.pitch, " - ") : v.pitch;
      return { glyph, before: [v.size], after: [after], beyond: [bracketed(v.number)], ...finish(v) };
    }
    const run = kind === "seam" ? joined(v.number, v.length, " x ") : v.number;
    return { glyph, before: [v.size], after: [joined(run, bracketed(v.pitch), " ")], beyond: [], ...finish(v) };
  },
};

const SLOT_PLUG: WeldKind = {
  name: "Slot-Plug",
  twoSided: true,
  types: [
    { value: "plug", label: "Plug Weld" },
    { value: "slot", label: "Slot Weld" },
  ],
  fields: [
    { key: "size", label: "Weld Size" },
    { key: "width", label: "Slot Width" },
    { key: "slotLength", label: "Slot Length" },
    { key: "angle", label: "Angle of Countersink" },
    { key: "filling", label: "Depth of Filling" },
    { key: "spacing", label: "Spacing" },
    { key: "number", label: "Number of Welds" },
    ...contourFields,
  ],
  defaults: {
    aws: { size: "3/8", width: "3/8", slotLength: "1 1/2", angle: "60", filling: "1/4", spacing: "2 1/2", number: "6" },
    iso: { size: "8", width: "8", slotLength: "30", angle: "60", filling: "10", spacing: "65", number: "6" },
  },
  side: (std, type, v) => {
    const plug = type !== "slot";
    const glyph: WeldGlyph = { kind: plug ? "plug" : "slot", filling: v.filling };
    const before = [plug ? (v.size ? `Ø ${v.size}` : "") : v.width];
    if (std === "aws") {
      const after = plug ? v.spacing : joined(v.slotLength, v.spacing, " - ");
      return { glyph, before, after: [after], beyond: [degrees(v.angle), bracketed(v.number)], ...finish(v) };
    }
    const run = plug ? v.number : joined(v.number, v.slotLength, " x ");
    return { glyph, before, after: [joined(run, bracketed(v.spacing), " ")], beyond: [degrees(v.angle)], ...finish(v) };
  },
};

export type WeldingToolId =
  | "weldfilletaws"
  | "weldfilletiso"
  | "weldflangeaws"
  | "weldflangeiso"
  | "weldgrooveaws"
  | "weldgrooveiso"
  | "weldmiscaws"
  | "weldmisciso"
  | "weldslotplugaws"
  | "weldslotplugiso";

const KINDS: Record<string, WeldKind> = { fillet: FILLET, flange: FLANGE, groove: GROOVE, misc: MISC, slotplug: SLOT_PLUG };

/** Vectorworks' Welding Sym- tools, one per symbol and standard. */
export class WeldingSymbolTool extends TwoPointTool {
  readonly cursor = "crosshair";
  protected readonly label: string;
  private readonly kind: WeldKind;
  private readonly standard: WeldStandard;
  private textMm = TEXT_MM;
  private type: string;
  /** AWS's Symmetrical; ISO's is a configuration */
  private symmetrical = false;
  private config: WeldLayout = "arrowBelow";
  /** which sides the two-sided symbols fill, or where a one-sided one goes */
  private sides: Sides = "arrow";
  private stagger = false;
  private arrowValues: Values;
  private otherValues: Values;
  private arrowhead = true;
  private reference = false;
  private notes: string[] = ["", "", ""];
  private allAround = false;
  private field = false;
  private flag: FieldFlag = "topRight";

  constructor(
    env: ToolEnv,
    readonly id: WeldingToolId,
  ) {
    super(env);
    const m = /^weld(\w+?)(aws|iso)$/.exec(id)!;
    this.kind = KINDS[m[1]];
    this.standard = m[2] as WeldStandard;
    this.label = `Welding Sym-${this.kind.name} (${this.standard.toUpperCase()})`;
    this.type = this.kind.types?.[0].value ?? "";
    const blank = Object.fromEntries(this.kind.fields.map((f) => [f.key, f.options?.[0].value ?? ""]));
    this.arrowValues = { ...blank, ...this.kind.defaults[this.standard] };
    this.otherValues = { ...this.arrowValues };
  }

  async preferences(): Promise<void> {
    const k = this.kind;
    const iso = this.standard === "iso";
    const sideFields = k.fields.filter((f) => !f.only || f.only === this.standard);
    const ofSide = (prefix: string, title: string, values: Values): PrefField[] =>
      sideFields.map((f): PrefField => {
        const key = `${prefix}${f.key}`;
        const label = title ? `${title} ${f.label}` : f.label;
        if (f.check) return { kind: "check", key, label, value: values[f.key] === "1" };
        if (f.options) return { kind: "choice", key, label, value: values[f.key], options: f.options };
        return { kind: "text", key, label, value: values[f.key] ?? "" };
      });
    const fields: PrefField[] = [
      ...(k.types ? [{ kind: "choice", key: "type", label: "Type of Weld", value: this.type, options: k.types } as const] : []),
      ...(k.twoSided
        ? [
            iso
              ? ({ kind: "choice", key: "config", label: "Configuration", value: this.symmetrical ? "symmetrical" : this.config, options: CONFIGS } as const)
              : ({ kind: "check", key: "symmetrical", label: "Symmetrical (both sides the same as Arrow Side)", value: this.symmetrical } as const),
            { kind: "choice", key: "sides", label: "Arrow Side/Other Side", value: this.sides === "none" ? "arrow" : this.sides, options: SIDES } as const,
          ]
        : [
            ...(iso ? [{ kind: "choice", key: "config", label: "Configuration", value: this.config, options: CONFIGS.slice(1) } as const] : []),
            { kind: "choice", key: "sides", label: "Significance", value: this.sides === "both" ? "arrow" : this.sides, options: k.significance ?? SIDES } as const,
          ]),
      ...(k.stagger ? [{ kind: "check", key: "stagger", label: "Stagger", value: this.stagger } as const] : []),
      ...(k.twoSided ? [...ofSide("a.", "Arrow Side", this.arrowValues), ...ofSide("o.", "Other Side", this.otherValues)] : ofSide("a.", "", this.arrowValues)),
      { kind: "check", key: "arrowhead", label: "Arrow", value: this.arrowhead },
      { kind: "check", key: "reference", label: "Reference", value: this.reference },
      ...this.notes.map((t, i): PrefField => ({ kind: "text", key: `note${i}`, label: `Ref. Line ${i + 1}`, value: t })),
      { kind: "check", key: "around", label: "Weld All Around", value: this.allAround },
      { kind: "check", key: "field", label: "Field Weld", value: this.field },
      { kind: "choice", key: "flag", label: "Field Weld Position", value: this.flag, options: FLAGS },
      { kind: "number", key: "text", label: "Text size", value: this.textMm, min: 0.5, max: 50, unit: "mm" },
    ];
    const v = await toolPrefs(
      `${this.label} Preferences`,
      fields,
      `${iso ? "ISO 2553" : "AWS A2.4"}. Click the joint, then where the arrow meets the reference line: the line runs level away from the arrow, and the reference note's tail is at its far end. ${
        k.twoSided
          ? iso
            ? "A symmetrical weld shows the arrow side's data both ways; otherwise the other side sits on the dashed identification line. "
            : "Symmetrical shows the arrow side's data on both sides. "
          : ""
      }A finish method shows only with a finish contour. Text size is on paper (the symbol is as high as its text): a layer at 1:n draws it n times larger.`,
    );
    if (!v) return;
    const read = (prefix: string): Values =>
      Object.fromEntries(sideFields.map((f) => [f.key, f.check ? (v.flag(`${prefix}${f.key}`) ? "1" : "") : v.choice(`${prefix}${f.key}`)]));
    if (k.types) this.type = v.choice("type");
    if (iso) {
      const config = v.choice("config") as WeldLayout;
      this.symmetrical = k.twoSided && config === "symmetrical";
      this.config = config === "symmetrical" ? this.config : config;
    } else if (k.twoSided) this.symmetrical = v.flag("symmetrical");
    this.sides = v.choice("sides") as Sides;
    if (k.stagger) this.stagger = v.flag("stagger");
    this.arrowValues = { ...this.arrowValues, ...read("a.") };
    if (k.twoSided) this.otherValues = { ...this.otherValues, ...read("o.") };
    this.arrowhead = v.flag("arrowhead");
    this.reference = v.flag("reference");
    this.notes = this.notes.map((_, i) => v.choice(`note${i}`));
    this.allAround = v.flag("around");
    this.field = v.flag("field");
    this.flag = v.choice("flag") as FieldFlag;
    this.textMm = v.num("text");
  }

  hint(): string {
    return this.start() ? "Click or release where the arrow meets the reference line" : "Click the joint, then where the arrow meets the reference line";
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    const scale = this.scale();
    if (scale === null) return null;
    const k = this.kind;
    const std = this.standard;
    const side = (values: Values) => k.side(std, this.type, values, this.stagger);
    const both = k.twoSided && this.symmetrical;
    const arrow = both || this.sides === "arrow" || (k.twoSided && this.sides === "both");
    const other = both || this.sides === "other" || (k.twoSided && this.sides === "both");
    const layout: WeldLayout = std === "aws" ? "aws" : both ? "symmetrical" : this.config;
    const d = weldingSymbol(
      a,
      b,
      {
        standard: std,
        layout,
        arrowSide: arrow ? side(this.arrowValues) : null,
        otherSide: other ? side(both ? this.arrowValues : k.twoSided ? this.otherValues : this.arrowValues) : null,
        across: !k.twoSided && this.sides === "none" ? side(this.arrowValues) : null,
        stagger: !!k.stagger && this.stagger,
        arrowhead: this.arrowhead,
        allAround: this.allAround,
        field: this.field ? this.flag : null,
        reference: this.reference ? this.notes : null,
      },
      this.textMm * scale,
    );
    return d ? markerParts(d) : null;
  }

  protected refusal(): string {
    return "Click where the arrow meets the reference line at least the symbol's size from the joint.";
  }
}
