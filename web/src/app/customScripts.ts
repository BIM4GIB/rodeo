// The script options of Custom Selection and Custom Modification, as Vectorworks offers them: Execute
// Immediately, or Create VectorScript or Create Python Script, which write what the dialog chose as a
// script and keep it in a script palette, where a double-click runs it again (in Rodeo, and in Vectorworks
// once exported). The criteria become Vectorworks' search criteria, ((L='Layer-1') & (T=RECT) & (C<>'Walls')),
// and the changes vs calls. Pure, so Node can check the scripts.

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
