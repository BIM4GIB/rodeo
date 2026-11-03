// Stage > Sightlines > Masking Solver…: the legs and borders that hide the wings and the gap over the
// fly from one critical seat (masking.ts). Its inputs come from a dialog that starts from the venue. The
// results window shows a table, a plan and a section sketch of the sightlines, and can draw the legs and
// sight lines on the plan as one undo step, or add each leg pair and border to the Linesets. Lengths are
// in the drawing's units; the Linesets keep the batten at a border's top and its hem as the trim.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs, type PrefField } from "../../../app/toolPrefs.ts";
import { addPieces, type Part } from "../../../app/tools/detailing.ts";
import { readShow, writeShow } from "../show.ts";
import { fromStage, type StagePoint } from "../stage.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { dataTable, noteLine, openPanel, type Column, type OpenPanel } from "../ui.ts";
import { LINESETS_KEY, type Lineset } from "../showTypes.ts";
import { solveMasking, type MaskingInput, type Solution } from "./masking.ts";
import { activeScale, fitBox, sketch, svgDot, svgLine, svgPoly, svgText, venue, type Px } from "./shared.ts";
import "./sightlines.css";

/** The inputs, in mm. */
interface Form {
  readonly prosWidth: number;
  readonly prosHeight: number;
  readonly depth: number;
  readonly legs: number;
  readonly firstLeg: number;
  readonly performingWidth: number;
  readonly performingHeight: number;
  readonly wing: number;
  readonly minLeg: number;
  readonly wantedTrim: number;
  readonly grid: number;
  readonly seatAcross: number;
  readonly seatDown: number;
  readonly frontEye: number;
}

/** One row of the table: a leg pair or a border. */
interface Piece {
  readonly name: string;
  readonly up: number;
  readonly onstage?: number;
  readonly width?: number;
  readonly trim?: number;
  readonly cloth?: number;
  readonly flags: readonly string[];
}

/** A batten's pipe, mm. */
const PIPE_MM = 48;
/** A label's height on paper, mm. */
const TEXT_MM = 2.5;
const NOTE = "The critical seat is the outside seat of the front row. Its sightlines run past the proscenium edges (the legs) and over the proscenium top (the borders), and each piece sits where its sightline is stopped. The other side of the stage mirrors it.";

let form: Form | null = null;
let results: OpenPanel | null = null;
let seq = 0;

function defaults(): Form {
  const v = venue();
  const prosHeight = v?.prosHeightMm || 6000;
  return {
    prosWidth: v?.prosWidthMm || 10000,
    prosHeight,
    depth: v?.stageDepthMm || 10000,
    legs: 4,
    firstLeg: 1000,
    performingWidth: 8000,
    performingHeight: Math.round(prosHeight * 0.9),
    wing: v && v.stageWidthMm > v.prosWidthMm ? (v.stageWidthMm - v.prosWidthMm) / 2 : 6000,
    minLeg: 1000,
    wantedTrim: prosHeight,
    grid: v?.gridHeightMm || 12000,
    seatAcross: 6000,
    seatDown: 3000,
    frontEye: 1120,
  };
}

function fields(f: Form): PrefField[] {
  return [
    { kind: "length", key: "prosWidth", label: "Proscenium Width", value: f.prosWidth },
    { kind: "length", key: "prosHeight", label: "Proscenium Height", value: f.prosHeight },
    { kind: "length", key: "depth", label: "Stage Depth to Back Wall", value: f.depth },
    { kind: "number", key: "legs", label: "Leg Pairs", value: f.legs, min: 1, max: 12, integer: true },
    { kind: "length", key: "firstLeg", label: "First Leg Upstage of PL", value: f.firstLeg },
    { kind: "length", key: "performingWidth", label: "Performing Width (Clear Opening)", value: f.performingWidth },
    { kind: "length", key: "performingHeight", label: "Performing Height", value: f.performingHeight },
    { kind: "length", key: "wing", label: "Wing Width to Hide", value: f.wing },
    { kind: "length", key: "minLeg", label: "Minimum Leg Width", value: f.minLeg },
    { kind: "length", key: "wantedTrim", label: "Wanted Border Trim", value: f.wantedTrim },
    { kind: "length", key: "grid", label: "Grid Height", value: f.grid },
    { kind: "length", key: "seatAcross", label: "Critical Seat Off CL", value: f.seatAcross, zero: true },
    { kind: "length", key: "seatDown", label: "Critical Seat into House from PL", value: f.seatDown },
    { kind: "length", key: "frontEye", label: "Front Row Eye above Stage Floor", value: f.frontEye },
  ];
}

/** Asks for the inputs (starting from the last ones given, else the venue), then opens the results. */
export async function openMasking(): Promise<void> {
  const v = await toolPrefs("Masking Solver", fields(form ?? defaults()), NOTE);
  if (!v) return;
  form = {
    prosWidth: v.num("prosWidth"),
    prosHeight: v.num("prosHeight"),
    depth: v.num("depth"),
    legs: v.num("legs"),
    firstLeg: v.num("firstLeg"),
    performingWidth: v.num("performingWidth"),
    performingHeight: v.num("performingHeight"),
    wing: v.num("wing"),
    minLeg: v.num("minLeg"),
    wantedTrim: v.num("wantedTrim"),
    grid: v.num("grid"),
    seatAcross: v.num("seatAcross"),
    seatDown: v.num("seatDown"),
    frontEye: v.num("frontEye"),
  };
  showResults();
}

function toInput(f: Form): MaskingInput {
  return {
    prosWidthMm: f.prosWidth,
    prosHeightMm: f.prosHeight,
    stageDepthMm: f.depth,
    legs: f.legs,
    firstLegUpMm: f.firstLeg,
    performingWidthMm: f.performingWidth,
    performingHeightMm: f.performingHeight,
    wingWidthMm: f.wing,
    minLegWidthMm: f.minLeg,
    wantedTrimMm: f.wantedTrim,
    gridHeightMm: f.grid,
    seatAcrossMm: f.seatAcross,
    seatDownMm: f.seatDown,
    frontEyeMm: f.frontEye,
  };
}

const COLUMNS: Column<Piece>[] = [
  { label: "Piece", value: (p) => p.name },
  { label: "Up from PL", value: (p) => `${lengthText(p.up)} US`, numeric: true },
  { label: "Onstage Edge", value: (p) => (p.onstage === undefined ? "" : `${lengthText(p.onstage)} from CL`), numeric: true },
  { label: "Leg Width", value: (p) => (p.width === undefined ? "" : lengthText(p.width)), numeric: true },
  { label: "Trim (Hem)", value: (p) => (p.trim === undefined ? "" : lengthText(p.trim)), numeric: true },
  { label: "Cloth Height", value: (p) => (p.cloth === undefined ? "" : lengthText(p.cloth)), numeric: true },
  { label: "Flags", value: (p) => p.flags.join("; "), cellClass: (p) => (p.flags.length ? "th-warn" : undefined) },
];

/** Opens the results for the inputs last given (replacing any open ones). */
function showResults(): void {
  if (!form) return;
  const f = form;
  const sol = solveMasking(toInput(f));
  const pieces: Piece[] = [
    ...sol.legs.map((l): Piece => ({ name: `Leg ${l.pair}`, up: l.upMm, onstage: l.onstageMm, width: l.widthMm, flags: l.flags })),
    ...sol.borders.map((b): Piece => ({ name: `Border ${b.pair}`, up: b.upMm, trim: b.trimMm, cloth: b.clothMm, flags: b.flags })),
  ];
  const flagged = pieces.filter((p) => p.flags.length > 0).length;
  const table = dataTable(COLUMNS, () => pieces, { empty: "No legs or borders to show." });
  table.element.style.flex = "none";
  table.element.style.height = "220px";
  const summary = h(
    "div",
    { cls: "sightlines-summary" },
    h("p", { text: `Critical seat: ${lengthText(f.seatAcross)} off CL and ${lengthText(f.seatDown)} into the house, its front-row eye ${lengthText(f.frontEye)} above the stage floor. ${sol.legs.length} leg pair${sol.legs.length === 1 ? "" : "s"} and ${sol.borders.length} border${sol.borders.length === 1 ? "" : "s"}; ${flagged ? `${flagged} need${flagged === 1 ? "s" : ""} a look (see Flags).` : "nothing is flagged."}` }),
    f.performingWidth > f.prosWidth ? noteLine("The performing width is wider than the proscenium: check the legs against the wings.", "th-warn") : null,
    noteLine("Approximate: sightlines from one seat in plan and section; no rigging loads, hanging or cloth fullness. Lengths are from the audience's centre line and the plaster line."),
  );
  results?.close();
  results = openPanel({
    key: "sightlines.masking.solver",
    title: "Masking Solver",
    body: h("div", { cls: "sightlines-body" }, summary, table.element, h("div", { cls: "sightlines-sketches" }, planSketch(sol, f), sectionSketch(sol, f))),
    width: 920,
    height: 700,
    actions: [
      { label: "Change Inputs…", run: () => void openMasking() },
      { label: "Add to Linesets", run: () => addLinesets(sol, f) },
      { label: "Draw on Plan", run: () => drawOnPlan(sol), primary: true },
    ],
    onClose: () => {
      results = null;
    },
  });
}

/** The plan: the proscenium opening, the legs each side (pleated), and the critical seat's sightlines past them. */
function planSketch(sol: Solution, f: Form): HTMLElement {
  const w2 = f.prosWidth / 2;
  const reach = Math.max(w2, Math.abs(sol.plan.seat.across), ...sol.legs.map((l) => l.offstageMm), ...sol.plan.rays.map((r) => Math.abs(r.to.across))) * 1.08;
  const y0 = -Math.max(f.seatDown, 0) - 1200;
  const y1 = f.depth + 400;
  const fit = fitBox(-reach, reach, y0, y1);
  const at = (across: number, up: number): Px => fit.at(across, up);
  const seat = sol.plan.seat;
  const parts: string[] = [
    svgLine(at(-reach, 0), at(reach, 0), "sl-thin"),
    svgLine(at(-reach, f.depth), at(reach, f.depth), "sl-thin"),
    svgLine(at(-w2, 0), at(w2, 0), "sl-wall"),
  ];
  for (const leg of sol.plan.legs) {
    parts.push(svgPoly(leg.left.map((p) => at(p.across, p.up)), "sl-leg"), svgPoly(leg.right.map((p) => at(p.across, p.up)), "sl-leg"));
    const first = leg.left[0];
    const last = leg.left[leg.left.length - 1];
    parts.push(svgText(at((first.across + last.across) / 2, first.up + 500), `L${leg.pair}`, "middle", ""));
  }
  // the labels at the back wall step in turn, so the ones beside each other don't overlap
  sol.plan.rays.forEach((ray, i) => {
    parts.push(svgLine(at(seat.across, seat.up), at(ray.to.across, ray.to.up), "sl-ray"));
    parts.push(svgText(at(ray.to.across, ray.to.up - 500 - (i % 2) * 900), `L${ray.pair} SR`, "middle", "sl-accent"));
  });
  parts.push(svgDot(at(seat.across, seat.up), 3.5, "sl-dot"), svgText(at(seat.across + 300, seat.up), "Critical seat", "start", ""));
  parts.push(svgText(at(reach * 0.93, 300), "SL", "middle", ""), svgText(at(-reach * 0.93, 300), "SR", "middle", ""), svgText(at(0, y0 + 250), "Audience", "middle", ""));
  return sketch(fit, parts.join(""), "Plan of the masking and the critical seat's sightlines");
}

/** The section: the stage floor, the proscenium and grid, the borders, and the seat's sightlines over them. */
function sectionSketch(sol: Solution, f: Form): HTMLElement {
  const D = f.depth;
  const sd = f.seatDown;
  const high = Math.max(f.grid, f.prosHeight, ...sol.section.rays.map((r) => r.to.height), ...sol.borders.map((b) => b.topMm)) * 1.05;
  const x0 = -D - 300;
  const x1 = sd + 1500;
  const fit = fitBox(x0, x1, -600, high);
  const at = (house: number, height: number): Px => fit.at(house, height);
  const eye = sol.section.eye;
  const parts: string[] = [
    svgLine(at(-D, 0), at(0, 0), "sl-wall"),
    svgLine(at(0, 0), at(0, f.prosHeight), "sl-wall"),
    svgLine(at(-D, f.grid), at(x1, f.grid), "sl-thin"),
    svgText(at(x1 - 200, f.grid + high * 0.02), "Grid", "end", ""),
  ];
  for (const b of sol.borders) parts.push(svgLine(at(-b.upMm, b.trimMm), at(-b.upMm, b.topMm), "sl-cloth"), svgText(at(-b.upMm + 150, b.topMm + high * 0.02), `B${b.pair}`, "start", ""));
  for (const ray of sol.section.rays) {
    parts.push(svgLine(at(eye.house, eye.height), at(ray.to.house, ray.to.height), "sl-ray"));
    // the label sits on its sightline a little way upstage
    const house = -D * 0.82;
    const along = (house - eye.house) / (ray.to.house - eye.house);
    const height = eye.height + (ray.to.height - eye.height) * along;
    parts.push(svgText(at(house, Math.min(height, high * 0.95)), `B${ray.pair} SR`, "middle", "sl-accent"));
  }
  parts.push(svgDot(at(eye.house, eye.height), 3.5, "sl-eye"), svgText(at(eye.house + 200, eye.height), "Eye", "start", ""));
  parts.push(svgText(at(-D / 2, -300), "Stage", "middle", ""), svgText(at(sd / 2, -300), "Audience", "middle", ""));
  return sketch(fit, parts.join(""), "Section of the borders and the seat's sightlines over them");
}

/** Draws the legs (pleated, both sides) and the critical seat's sight lines on the plan, as one undo step. */
function drawOnPlan(sol: Solution): void {
  if (!store.activeLayerId) {
    toast("Make a design layer active first.", "info");
    return;
  }
  const f = stageFrame();
  const size = TEXT_MM * activeScale();
  const label = (at: StagePoint, text: string): Part => ({ kind: "text", at: fromStage(f, at), text, height: size, hAlign: 2, vAlign: 3 });
  const pieces: Part[][] = [];
  for (const leg of sol.plan.legs) {
    const first = leg.left[0];
    const last = leg.left[leg.left.length - 1];
    pieces.push([
      { kind: "polyline", points: leg.left.map((p) => fromStage(f, p)), closed: false },
      { kind: "polyline", points: leg.right.map((p) => fromStage(f, p)), closed: false },
      label({ across: (first.across + last.across) / 2, up: first.up + size * 2 }, `L${leg.pair}`),
    ]);
  }
  for (const ray of sol.plan.rays) {
    pieces.push([
      { kind: "line", a: fromStage(f, sol.plan.seat), b: fromStage(f, ray.to) },
      label({ across: ray.to.across, up: ray.to.up - size * 2 }, `L${ray.pair} SR`),
    ]);
  }
  addPieces("Masking Solver", pieces);
  toast(`Drew ${sol.legs.length} leg pair${sol.legs.length === 1 ? "" : "s"} and their sight lines on the plan.`, "info");
}

/** The first of `prefix 1`, `prefix 2`… not among `names`; it is then taken. */
function freeName(prefix: string, names: Set<string>): string {
  for (let n = 1; ; n++) {
    const name = `${prefix} ${n}`;
    if (!names.has(name)) {
      names.add(name);
      return name;
    }
  }
}

/** Appends a border lineset per border and a leg lineset per pair to the Linesets, named "Border n" and "Legs n". */
function addLinesets(sol: Solution, f: Form): void {
  const existing = readShow<Lineset[]>(LINESETS_KEY, []);
  const names = new Set(existing.map((l) => l.name));
  const id = (): string => `sightlines-${Date.now().toString(36)}-${seq++}`;
  const made: Lineset[] = [
    ...sol.borders.map(
      (b): Lineset => ({
        id: id(),
        name: freeName("Border", names),
        upMm: b.upMm,
        battenMm: PIPE_MM,
        capacityKg: 0,
        inTrimMm: b.topMm,
        outTrimMm: f.grid,
        kind: "border",
        hung: `Masking border, hem ${lengthText(b.trimMm)}, cloth ${lengthText(b.clothMm)}`,
        weightKg: 0,
        clothMm: b.clothMm,
      }),
    ),
    ...sol.legs.map(
      (l): Lineset => ({
        id: id(),
        name: freeName("Legs", names),
        upMm: l.upMm,
        battenMm: PIPE_MM,
        capacityKg: 0,
        inTrimMm: f.grid,
        outTrimMm: f.grid,
        kind: "leg",
        hung: `Leg pair, ${lengthText(l.widthMm)} wide`,
        weightKg: 0,
        clothMm: f.grid,
      }),
    ),
  ];
  if (made.length === 0) {
    toast("There are no legs or borders to add.", "info");
    return;
  }
  writeShow("Add Masking Linesets", LINESETS_KEY, [...existing, ...made]);
  toast(`Added ${made.length} linesets: ${made.map((m) => m.name).join(", ")}.`, "info");
}
