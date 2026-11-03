// Stage > Sightlines > Seating Rake Solver…: each row's floor rise and eye height for a clearance over the
// heads in front, by the isoptic (C-value) method (rake.ts). The results window shows a table and a
// section sketch with each eye's sightline from the stage's focal point. Draw Section places the section
// on the drawing after a click; Use for Audience writes the average riser and the eye above the stage
// floor into an audience block, so the sightline maps follow the rake.

import { h } from "../../../app/dom.ts";
import { placeAtNextClick } from "../../../app/placeAt.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs, type PrefField } from "../../../app/toolPrefs.ts";
import { addPieces, type Part } from "../../../app/tools/detailing.ts";
import type { Pt } from "../../../core/index.ts";
import { writeShow } from "../show.ts";
import { lengthText } from "../stageTool.ts";
import { AUDIENCE_KEY } from "../showTypes.ts";
import { dataTable, noteLine, openPanel, type Column, type OpenPanel } from "../ui.ts";
import { audience, refreshAudience } from "./audienceWindow.ts";
import { RAKE_LIMIT_DEG, RISER_LIMIT_MM, rakeSection, solveRake, type Rake, type RakeInput, type RakeRow } from "./rake.ts";
import { activeScale, fitBox, sketch, svgDot, svgPoly, svgText, svgLine, type Px } from "./shared.ts";
import "./sightlines.css";

/** A label's height on paper, mm. */
const TEXT_MM = 2.5;
/** The stage block's depth in the section sketch, mm. */
const STAGE_BLOCK_MM = 2000;
const CLEARANCES: readonly { readonly value: string; readonly label: string }[] = [
  { value: "60", label: "60 mm: with staggered seats" },
  { value: "90", label: "90 mm: good" },
  { value: "120", label: "120 mm: excellent" },
];
const DEFAULT: RakeInput = {
  firstRowMm: 4000,
  spacingMm: 900,
  rows: 10,
  seatedEyeMm: 1120,
  stageHeightMm: 900,
  focalHeightMm: 0,
  clearanceMm: 90,
  stepMm: 25,
};
const NOTE =
  "Each row's eye is set so its sightline from the stage's focal point, over the head of the row in front, clears it by the clearance. Risers are rounded up to whole steps, so each row gets at least that clearance. The focal point is on the stage's front edge; heights are above the first row's floor.";

let input: RakeInput | null = null;
let results: OpenPanel | null = null;

function fields(r: RakeInput): PrefField[] {
  return [
    { kind: "length", key: "first", label: "First Row from Focal Point", value: r.firstRowMm },
    { kind: "length", key: "spacing", label: "Row Spacing", value: r.spacingMm },
    { kind: "number", key: "rows", label: "Rows", value: r.rows, min: 1, max: 60, integer: true },
    { kind: "length", key: "eye", label: "Seated Eye Height above Floor", value: r.seatedEyeMm },
    { kind: "length", key: "stage", label: "Stage Height above First Row Floor", value: r.stageHeightMm, zero: true },
    { kind: "length", key: "focal", label: "Focal Point above Stage Floor", value: r.focalHeightMm, zero: true },
    { kind: "choice", key: "clearance", label: "Clearance over Heads", value: String(r.clearanceMm), options: CLEARANCES },
    { kind: "length", key: "step", label: "Riser Step", value: r.stepMm },
  ];
}

/** Asks for the inputs (starting from the last ones given), then opens the results. */
export async function openRake(): Promise<void> {
  const v = await toolPrefs("Seating Rake Solver", fields(input ?? DEFAULT), NOTE);
  if (!v) return;
  input = {
    firstRowMm: v.num("first"),
    spacingMm: v.num("spacing"),
    rows: v.num("rows"),
    seatedEyeMm: v.num("eye"),
    stageHeightMm: v.num("stage"),
    focalHeightMm: v.num("focal"),
    clearanceMm: Number(v.choice("clearance")),
    stepMm: v.num("step"),
  };
  showResults();
}

const COLUMNS: Column<RakeRow>[] = [
  { label: "Row", value: (r) => r.row, numeric: true },
  { label: "Distance", value: (r) => lengthText(r.distanceMm), numeric: true },
  { label: "Floor Rise", value: (r) => lengthText(r.riseMm), numeric: true },
  { label: "Riser", value: (r) => lengthText(r.riserMm), numeric: true },
  { label: "Eye Height", value: (r) => lengthText(r.eyeMm), numeric: true },
  { label: "C Actual", value: (r) => (r.clearanceMm === null ? "n/a" : lengthText(r.clearanceMm)), numeric: true },
  { label: "Flags", value: (r) => r.flags.join("; "), cellClass: (r) => (r.flags.length ? "th-warn" : undefined) },
];

/** Opens the results for the inputs last given, replacing any open ones. */
function showResults(): void {
  if (!input) return;
  const r = input;
  const rake = solveRake(r);
  const flagged = rake.rows.filter((row) => row.flags.length > 0).length;
  const target = CLEARANCES.find((c) => c.value === String(r.clearanceMm))?.label ?? `${r.clearanceMm} mm`;
  const table = dataTable(COLUMNS, () => rake.rows, { empty: "No rows to show." });
  table.element.style.flex = "none";
  table.element.style.height = "220px";
  const summary = h(
    "div",
    { cls: "sightlines-summary" },
    h("p", {
      text: `${r.rows} row${r.rows === 1 ? "" : "s"}, ${lengthText(r.spacingMm)} apart, the first ${lengthText(r.firstRowMm)} from the focal point. The floor rises ${lengthText(rake.totalRiseMm)} over the rake; the average riser is ${lengthText(rake.averageRiserMm)} and the steepest floor is ${rake.steepestDeg.toFixed(1)}°.`,
    }),
    h("p", {
      text: `Clearance target ${target}; the lowest any row gets is ${rake.lowestClearanceMm === null ? "not applicable" : lengthText(rake.lowestClearanceMm)}. ${flagged ? `${flagged} row${flagged === 1 ? "" : "s"} need${flagged === 1 ? "s" : ""} a look (see Flags).` : "Nothing is flagged."}`,
    }),
    noteLine(`A riser over ${RISER_LIMIT_MM} mm needs an intermediate step for safe access. A floor steeper than ${RAKE_LIMIT_DEG}° is flagged.`),
  );
  results?.close();
  results = openPanel({
    key: "sightlines.rake.solver",
    title: "Seating Rake Solver",
    body: h("div", { cls: "sightlines-body" }, summary, table.element, h("div", { cls: "sightlines-sketches" }, sectionSketch(rake, r))),
    width: 900,
    height: 680,
    actions: [
      { label: "Change Inputs…", run: () => void openRake() },
      { label: "Use for Audience", run: () => void useForAudience(rake, r) },
      { label: "Draw Section", run: () => drawSectionClick(rake, r), primary: true },
    ],
    onClose: () => {
      results = null;
    },
  });
}

/** The section sketch: the stepped floor under the rows, the stage block, each eye and its sightline from the focal point. */
function sectionSketch(rake: Rake, r: RakeInput): HTMLElement {
  const sec = rakeSection(rake, r);
  const xs = [-STAGE_BLOCK_MM, ...sec.floor.map((p) => p.x), ...sec.rays.map((ray) => ray.to.x)];
  const ys = [0, r.stageHeightMm, ...sec.floor.map((p) => p.y), ...sec.rays.map((ray) => ray.to.y), ...sec.eyes.map((e) => e.at.y)];
  const fit = fitBox(Math.min(...xs), Math.max(...xs), -400, Math.max(...ys) * 1.08);
  const at = (x: number, y: number): Px => fit.at(x, y);
  const parts: string[] = [
    svgPoly(sec.floor.map((p) => at(p.x, p.y)), "sl-wall"),
    svgPoly([...sec.stage, sec.stage[0]].map((p) => at(p.x, p.y)), ""),
    ...sec.rays.map((ray) => svgLine(at(ray.from.x, ray.from.y), at(ray.to.x, ray.to.y), "sl-ray")),
    ...sec.eyes.map((e) => svgDot(at(e.at.x, e.at.y), 3.5, "sl-eye") + svgText(at(e.at.x, e.at.y + Math.max(...ys) * 0.04), String(e.row), "middle", "")),
    svgDot(at(sec.focal.x, sec.focal.y), 3.5, "sl-dot"),
    svgText(at(sec.focal.x + 120, sec.focal.y + Math.max(...ys) * 0.04), "Focal point", "start", "sl-accent"),
    svgText(at(-STAGE_BLOCK_MM / 2, -250), "Stage", "middle", ""),
    svgText(at(sec.floor[sec.floor.length - 1].x / 2, -250), "Audience", "middle", ""),
  ];
  return sketch(fit, parts.join(""), "Section of the rake with each eye's sightline from the focal point");
}

/** Places the section where the next click on the drawing lands. */
function drawSectionClick(rake: Rake, r: RakeInput): void {
  const placed = placeAtNextClick({ what: "Seating rake section", place: (at) => placeSection(at, rake, r) });
  if (placed) {
    // out of the way of the click
    results?.close();
    toast("Click on the drawing where the section goes.", "info");
  } else toast("Open a drawing first.", "info");
}

/** Draws the section with its origin (the stage's front edge at the first row's floor) at `origin`, as one group. */
function placeSection(origin: Pt, rake: Rake, r: RakeInput): void {
  const sec = rakeSection(rake, r);
  const size = TEXT_MM * activeScale();
  const p = (x: number, y: number): Pt => ({ x: origin.x + x, y: origin.y + y });
  const text = (at: Pt, s: string): Part => ({ kind: "text", at, text: s, height: size, hAlign: 2, vAlign: 3 });
  const parts: Part[] = [
    { kind: "polyline", points: sec.floor.map((q) => p(q.x, q.y)), closed: false },
    { kind: "polygon", points: sec.stage.map((q) => p(q.x, q.y)), closed: true },
    ...sec.rays.map((ray): Part => ({ kind: "line", a: p(ray.from.x, ray.from.y), b: p(ray.to.x, ray.to.y) })),
    ...sec.eyes.flatMap((e): Part[] => [
      { kind: "arc", center: p(e.at.x, e.at.y), radius: size * 0.6, startAngle: 0, sweepAngle: 360 },
      text(p(e.at.x, e.at.y + size * 2), String(e.row)),
    ]),
    { kind: "arc", center: p(sec.focal.x, sec.focal.y), radius: size * 0.6, startAngle: 0, sweepAngle: 360 },
    text(p(sec.focal.x + size * 2, sec.focal.y + size), "Focal point"),
    text(p(-STAGE_BLOCK_MM / 2, -size * 2), "Stage"),
    text(p(sec.floor[sec.floor.length - 1].x / 2, -size * 2), "Audience"),
  ];
  addPieces("Seating Rake", [parts], "Seating Rake Section");
  toast(`Drew the section of ${rake.rows.length} row${rake.rows.length === 1 ? "" : "s"}.`, "info");
}

/** Writes the rake's average riser and the first row's eye above the stage floor into an audience block. */
async function useForAudience(rake: Rake, r: RakeInput): Promise<void> {
  const blocks = audience().blocks;
  if (blocks.length === 0) {
    toast("Add an audience first: Stage > Sightlines > Audience…", "info");
    return;
  }
  let index = 0;
  if (blocks.length > 1) {
    const v = await toolPrefs(
      "Use Rake for Audience",
      [{ kind: "choice", key: "block", label: "Seat Block", value: "0", options: blocks.map((b, i) => ({ value: String(i), label: b.name })) }],
      "Writes the rake's average riser into the block's rise a row, and its first row's eye height above the stage floor, so the sightline maps follow this rake.",
    );
    if (!v) return;
    index = Number(v.choice("block"));
  }
  const riseMm = Math.round(rake.averageRiserMm);
  const eyeMm = Math.round(r.seatedEyeMm - r.stageHeightMm);
  writeShow(
    "Use Rake for Audience",
    AUDIENCE_KEY,
    { blocks: blocks.map((b, i) => (i === index ? { ...b, riseMm, eyeMm } : b)) },
  );
  refreshAudience();
  toast(`${blocks[index].name}: eyes rise ${lengthText(riseMm)} a row and sit ${lengthText(eyeMm)} above the stage floor.`, "info");
}
