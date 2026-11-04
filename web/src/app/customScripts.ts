// The script options of Custom Selection and Custom Modification, as Vectorworks offers them: Execute
// Immediately, or Create VectorScript or Create Python Script, which write what the dialog chose as a
// script and keep it in a script palette, where a double-click runs it again (in Rodeo, and in Vectorworks
// once exported). The criteria become Vectorworks' search criteria, ((L='Layer-1') & (T=RECT) & (C<>'Walls')),
// and the changes vs calls. Custom Tool/Attribute's script sets the document's attributes, class, layer
// and tool (SetTool, by Vectorworks' tool numbers). Pure, so Node can check the scripts.

export type ScriptMode = "now" | "vectorscript" | "python";

export const SCRIPT_MODES: readonly { readonly id: ScriptMode; readonly label: string }[] = [
  { id: "now", label: "Execute Immediately" },
  { id: "vectorscript", label: "Create VectorScript" },
  { id: "python", label: "Create Python Script" },
];

/** Vectorworks' names for object types in search criteria (T=RECT), by type number. */
const TYPE_WORDS: Readonly<Record<number, string>> = {
  2: "LINE",
  3: "RECT",
  4: "OVAL",
  5: "POLY",
  6: "ARC",
  8: "FHAND",
  9: "LOCUS3D",
  10: "TEXT",
  11: "GROUP",
  13: "RRECT",
  14: "BITMAP",
  15: "SYMBOL",
  17: "LOCUS",
  18: "SPRDSHEET",
  21: "POLYLINE",
  22: "PICT",
  24: "XTRD",
  25: "POLY3D",
  29: "LAYERLINK",
  34: "SWEEP",
  38: "MXTRD",
  40: "MESH",
  63: "DIMENSION",
  68: "WALL",
  71: "SLAB",
  81: "LIGHT",
  83: "ROOF",
  84: "CSGSOLID",
  87: "ROOFELEMENT",
  95: "SOLID",
  111: "NURBSCURVE",
  113: "NURBSSURFACE",
  122: "VIEWPORT",
};

/** A plug-in object's type number */
export const PLUGIN_TYPE = 86;

/** A name in criteria, quoted; null when it holds a quote, which criteria can't. */
export function quoted(name: string): string | null {
  return name.includes("'") ? null : `'${name}'`;
}

/** One criterion as search criteria: T, PON, C, S or L, `is` or not. */
export function criterionText(word: "T" | "PON" | "C" | "S" | "L", value: string | number, is: boolean): string {
  return `(${word}${is ? "=" : "<>"}${value})`;
}

/** An object type as a criterion: a plug-in by its name (PON), any other by Vectorworks' word for it or its number. */
export function typeCriterion(type: number, typeName: string, is: boolean): string | null {
  if (type === PLUGIN_TYPE) {
    const q = quoted(typeName);
    return q && criterionText("PON", q, is);
  }
  return criterionText("T", TYPE_WORDS[type] ?? type, is);
}

/** Criteria `parts` all met, on layer `layer`. */
export function allOf(layer: string, parts: readonly string[]): string | null {
  const q = quoted(layer);
  return q && `(${[criterionText("L", q, true), ...parts].join(" & ")})`;
}

export type SelectAction = "replace" | "add" | "remove";

/** Custom Selection's script: the objects meeting `criteria` selected, added to the selection or taken from it. */
export function selectionScript(language: "python" | "vectorscript", criteria: string, action: SelectAction): string {
  if (language === "python") {
    return [
      "import vs",
      "",
      `# Custom Selection: ${action === "remove" ? "deselects" : "selects"} the objects that meet the criteria`,
      ...(action === "replace" ? ["vs.DSelectAll()"] : []),
      `vs.${action === "remove" ? "DSelectObj" : "SelectObj"}("${criteria}")`,
      "",
    ].join("\n");
  }
  return [
    "PROCEDURE CustomSelection;",
    "{ selects the objects that meet the criteria }",
    "BEGIN",
    ...(action === "replace" ? ["\tDSelectAll;"] : []),
    `\t${action === "remove" ? "DSelectObj" : "SelectObj"}(${criteria});`,
    "END;",
    "RUN(CustomSelection);",
    "",
  ].join("\n");
}

/** A change Custom Modification's script makes: colours as red, green and blue, 0 to 255. */
export type ScriptChange =
  | { readonly id: "class"; readonly name: string }
  | { readonly id: "fill"; readonly rgb: readonly [number, number, number] }
  | { readonly id: "pen"; readonly rgb: readonly [number, number, number] }
  | { readonly id: "weight"; readonly mils: number }
  | { readonly id: "opacity"; readonly percent: number };

/** Vectorworks' colours run 0 to 65535. */
const wide = (rgb: readonly number[]): number[] => rgb.map((v) => Math.round(v) * 257);

/** The vs calls for `c` on handle h, without the vs. or the line's end. */
function calls(c: ScriptChange, python: boolean): string[] {
  const colour = (rgb: readonly number[]): string => (python ? `(${wide(rgb).join(", ")})` : wide(rgb).join(", "));
  switch (c.id) {
    case "class":
      return [`SetClass(h, '${c.name}')`];
    case "fill":
      // a colour shows where the fill is solid
      return ["SetFPat(h, 1)", `SetFillFore(h, ${colour(c.rgb)})`];
    case "pen":
      return [`SetPenFore(h, ${colour(c.rgb)})`];
    case "weight":
      return [`SetLW(h, ${Math.round(c.mils)})`];
    case "opacity":
      return [`SetOpacity(h, ${Math.round(c.percent)})`];
  }
}

/** Custom Modification's script: the objects meeting `criteria` selected, then each changed by `changes`. */
export function modificationScript(language: "python" | "vectorscript", criteria: string, changes: readonly ScriptChange[]): string {
  if (language === "python") {
    return [
      "import vs",
      "",
      "# Custom Modification: changes the objects that meet the criteria",
      `CRITERIA = "${criteria}"`,
      "",
      "",
      "def modify(h):",
      ...changes.flatMap((c) => calls(c, true)).map((line) => `    vs.${line}`),
      "",
      "",
      "vs.DSelectAll()",
      "vs.SelectObj(CRITERIA)",
      "vs.ForEachObjectInLayer(modify, 2, 0, 0)",
      "",
    ].join("\n");
  }
  return [
    "PROCEDURE CustomModification;",
    "{ changes the objects that meet the criteria }",
    "",
    "PROCEDURE Modify(h: HANDLE);",
    "BEGIN",
    ...changes.flatMap((c) => calls(c, false)).map((line) => `\t${line};`),
    "END;",
    "",
    "BEGIN",
    "\tDSelectAll;",
    `\tSelectObj(${criteria});`,
    "\tForEachObjectInLayer(Modify, 2, 0, 0);",
    "END;",
    "RUN(CustomModification);",
    "",
  ].join("\n");
}

/**
 * Vectorworks' SetTool numbers for the tools Rodeo has, by Rodeo's tool id (the Vectorworks function
 * reference, Appendix E: SetTool - CallTool Selectors).
 */
const TOOL_SELECTORS: Readonly<Record<string, number>> = {
  text: -200,
  line: -201,
  arc: -202,
  rect: -203,
  polyline: -204,
  oval: -205,
  fillet: -206,
  polygon: -207,
  wall: -208,
  symbol: -209,
  dimension: -210,
  reshape: -214,
  rotate: -215,
  doubleline: -216,
  roundrect: -217,
  dlpolygon: -218,
  chamfer: -219,
  freehand: -220,
  locus: -221,
  mirror: -222,
  regpoly: -225,
  clip: -226,
  quarterarc: -227,
  centermark: -228,
  select: -240,
  pan: -241,
  zoom: -242,
  translateview: -300,
  walkthrough: -302,
  flyover: -303,
  slab: -311,
  alignplane: -312,
  poly3d: -313,
  locus3d: -316,
  light: -317,
  sphere: -319,
  hemisphere: -320,
  cone: -321,
  walljoin: -322,
  renderbitmap: -324,
  connect: -327,
  chamferedge: -342,
  filletedge: -343,
  loftsurface: -344,
  extract: -346,
  shellsolid: -347,
  moveby: -352,
};

/** Vectorworks' SetTool number for Rodeo's tool `id`, or null when it has none. */
export function selectorOfTool(id: string): number | null {
  return TOOL_SELECTORS[id] ?? null;
}

/** Rodeo's tool for Vectorworks' SetTool number `n` (Zoom Out as Zoom), or null when Rodeo has none. */
export function toolOfSelector(n: number): string | null {
  if (n === -243) return "zoom";
  return Object.entries(TOOL_SELECTORS).find(([, v]) => v === n)?.[0] ?? null;
}

/** What Custom Tool/Attribute's script sets: each only when recorded. Colours red, green and blue, 0 to 255. */
export interface ToolAttributes {
  readonly fillPattern?: number;
  readonly fillFore?: readonly [number, number, number];
  readonly fillBack?: readonly [number, number, number];
  /** fill and pen, 0 to 100 */
  readonly opacity?: readonly [number, number];
  readonly lineStyle?: number;
  readonly penFore?: readonly [number, number, number];
  readonly penBack?: readonly [number, number, number];
  readonly lineMils?: number;
  /** points */
  readonly textSize?: number;
  /** Vectorworks' justification (1 left, 2 centre, 3 right) and vertical alignment (1 top to 5 bottom) */
  readonly textAlign?: { readonly h: number; readonly v: number };
  readonly className?: string;
  readonly layerName?: string;
  /** a SetTool number */
  readonly tool?: number;
}

/** Custom Tool/Attribute's script: the attributes, class, layer and tool recorded, set for what is drawn next. */
export function toolAttributeScript(language: "python" | "vectorscript", a: ToolAttributes): string {
  const python = language === "python";
  const colour = (rgb: readonly number[]): string => (python ? `(${wide(rgb).join(", ")})` : wide(rgb).join(", "));
  const text = (s: string): string => `'${s}'`;
  const lines: string[] = [];
  if (a.fillPattern !== undefined) lines.push(`FillPat(${a.fillPattern})`);
  if (a.fillFore) lines.push(`FillFore(${colour(a.fillFore)})`);
  if (a.fillBack) lines.push(`FillBack(${colour(a.fillBack)})`);
  if (a.opacity) lines.push(`SetDefaultOpacityN(${a.opacity.map(Math.round).join(", ")})`);
  if (a.lineStyle !== undefined) lines.push(`PenPat(${a.lineStyle})`);
  if (a.penFore) lines.push(`PenFore(${colour(a.penFore)})`);
  if (a.penBack) lines.push(`PenBack(${colour(a.penBack)})`);
  if (a.lineMils !== undefined) lines.push(`PenSize(${Math.round(a.lineMils)})`);
  if (a.textSize !== undefined) lines.push(`TextSize(${Math.round(a.textSize * 100) / 100})`);
  if (a.textAlign) lines.push(`TextJust(${a.textAlign.h})`, `TextVerticalAlign(${a.textAlign.v})`);
  if (a.className !== undefined) lines.push(`NameClass(${text(a.className)})`);
  if (a.layerName !== undefined) lines.push(`Layer(${text(a.layerName)})`);
  if (a.tool !== undefined) lines.push(`SetTool(${a.tool})`);
  if (python) return ["import vs", "", "# Custom Tool/Attribute: sets what is drawn next with", ...lines.map((l) => `vs.${l}`), ""].join("\n");
  return ["PROCEDURE CustomTool;", "{ sets what is drawn next with }", "BEGIN", ...lines.map((l) => `\t${l};`), "END;", "RUN(CustomTool);", ""].join("\n");
}
