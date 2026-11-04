// npx tsx src/app/customScripts.check.ts
import { allOf, criterionText, modificationScript, PLUGIN_TYPE, quoted, selectionScript, selectorOfTool, toolAttributeScript, toolOfSelector, typeCriterion } from "./customScripts.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};

// criteria
ok(quoted("Walls") === "'Walls'" && quoted("Bob's") === null, "quoted");
ok(criterionText("C", "'Walls'", false) === "(C<>'Walls')", "not a class");
ok(typeCriterion(3, "", true) === "(T=RECT)", "rectangle");
ok(typeCriterion(999, "", true) === "(T=999)", "a type without a word goes by number");
ok(typeCriterion(PLUGIN_TYPE, "Door", false) === "(PON<>'Door')", "a plug-in by name");
ok(typeCriterion(PLUGIN_TYPE, "Bob's Door", true) === null, "a plug-in name with a quote");
const c = allOf("Layer-1", ["(T=RECT)", "(C<>'Walls')"]);
ok(c === "((L='Layer-1') & (T=RECT) & (C<>'Walls'))", `all of: ${c}`);
ok(allOf("It's", []) === null, "a layer with a quote");

// Custom Selection
const py = selectionScript("python", c ?? "", "replace");
ok(py.includes("vs.DSelectAll()") && py.includes(`vs.SelectObj("${c}")`), "python select, replacing");
ok(!selectionScript("python", "(T=RECT)", "add").includes("DSelectAll"), "python select, adding");
ok(selectionScript("python", "(T=RECT)", "remove").includes('vs.DSelectObj("(T=RECT)")'), "python deselect");
const vsc = selectionScript("vectorscript", "(T=RECT)", "replace");
ok(vsc.startsWith("PROCEDURE CustomSelection;") && vsc.includes("\tDSelectAll;") && vsc.includes("\tSelectObj((T=RECT));") && vsc.trim().endsWith("RUN(CustomSelection);"), "vectorscript select");

// Custom Modification
const changes = [
  { id: "class", name: "Walls" },
  { id: "fill", rgb: [255, 0, 128] },
  { id: "pen", rgb: [0, 0, 0] },
  { id: "weight", mils: 14 },
  { id: "opacity", percent: 50 },
] as const;
const mpy = modificationScript("python", "(T=RECT)", changes);
for (const line of [
  'CRITERIA = "(T=RECT)"',
  "    vs.SetClass(h, 'Walls')",
  "    vs.SetFPat(h, 1)",
  "    vs.SetFillFore(h, (65535, 0, 32896))",
  "    vs.SetPenFore(h, (0, 0, 0))",
  "    vs.SetLW(h, 14)",
  "    vs.SetOpacity(h, 50)",
  "vs.SelectObj(CRITERIA)",
  "vs.ForEachObjectInLayer(modify, 2, 0, 0)",
])
  ok(mpy.includes(line), `python modification: ${line}`);
const mvs = modificationScript("vectorscript", "(T=RECT)", changes);
for (const line of ["PROCEDURE Modify(h: HANDLE);", "\tSetFillFore(h, 65535, 0, 32896);", "\tSetClass(h, 'Walls');", "\tSelectObj((T=RECT));", "\tForEachObjectInLayer(Modify, 2, 0, 0);", "RUN(CustomModification);"])
  ok(mvs.includes(line), `vectorscript modification: ${line}`);

// Custom Tool/Attribute
ok(selectorOfTool("line") === -201 && selectorOfTool("select") === -240 && selectorOfTool("stagedeck") === null, "tool numbers");
ok(toolOfSelector(-203) === "rect" && toolOfSelector(-243) === "zoom" && toolOfSelector(-999) === null, "tools by number");
const tpy = toolAttributeScript("python", { fillPattern: 1, fillFore: [255, 0, 0], opacity: [60, 80], lineMils: 20, textSize: 12, textAlign: { h: 2, v: 3 }, className: "Walls", layerName: "Plan", tool: -201 });
for (const line of ["vs.FillPat(1)", "vs.FillFore((65535, 0, 0))", "vs.SetDefaultOpacityN(60, 80)", "vs.PenSize(20)", "vs.TextSize(12)", "vs.TextJust(2)", "vs.TextVerticalAlign(3)", "vs.NameClass('Walls')", "vs.Layer('Plan')", "vs.SetTool(-201)"])
  ok(tpy.includes(line), `python tool script: ${line}`);
ok(!tpy.includes("PenFore"), "only what was recorded");
const tvs = toolAttributeScript("vectorscript", { penFore: [0, 0, 255], tool: -200 });
ok(tvs.includes("\tPenFore(0, 0, 65535);") && tvs.includes("\tSetTool(-200);") && tvs.trim().endsWith("RUN(CustomTool);"), "vectorscript tool script");

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
