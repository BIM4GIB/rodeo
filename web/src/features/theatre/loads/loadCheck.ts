// The Load Check window (Stage > Loads and Power > Load Check…): each hanging position's instruments, pipe, hoists
// and their reactions, checked against the position's capacity and each hoist's. A row opens its Detail tab, with
// the batten drawn to scale, its hoists, and its shear and bending. A planning check, not an engineer's calculation:
// it doesn't check cable, shackles, bridles or dynamic loads. The pure part is positions.ts and beam.ts.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { parseLength } from "../../../app/units.ts";
import { fixtures } from "../instrument.ts";
import { readShow, writeShow } from "../show.ts";
import { POSITIONS_KEY, type PositionInfo } from "../showTypes.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { csvOf, dataTable, downloadText, noteLine, openPanel, tabs, type Column, type OpenPanel, type Tab } from "../ui.ts";
import type { BeamResult, BeamStation } from "./beam.ts";
import { kgOf, kgText, svgNode, watchDrawing, weightLines } from "./loadsUi.ts";
import { checkOf, infoOf, NO_POSITION, PIPE_KG_PER_M, positionsOf, type LoadPosition, type PositionCheck } from "./positions.ts";

const PIPE_KEY = "loads.pipe";
/** the batten drawings are this wide in their own units; the window scales them */
const VIEW_W = 640;
const PLOT_LEFT = 44;
const PLOT_RIGHT = VIEW_W - 44;
const CHECK_NOTE = "A planning check, not an engineer's calculation. It doesn't check cable, shackles, bridles or dynamic loads, and a qualified rigger must sign off the hang.";

interface Row {
  readonly pos: LoadPosition;
  readonly check: PositionCheck;
}

/** Each position with its pipe counted, from the drawing as it is now. */
function rowsNow(): Row[] {
  const pipe = readShow<number>(PIPE_KEY, PIPE_KG_PER_M);
  const infos = readShow<PositionInfo[]>(POSITIONS_KEY, []);
  return positionsOf(fixtures(), infos, stageFrame()).map((pos) => ({ pos, check: checkOf(pos, pipe) }));
}

function infosNow(): PositionInfo[] {
  return readShow<PositionInfo[]>(POSITIONS_KEY, []);
}

/** Saves one position's limits, the other positions' kept. */
function saveInfo(label: string, next: PositionInfo): void {
  writeShow(label, POSITIONS_KEY, [...infosNow().filter((i) => i.name !== next.name), next]);
}

/** Red over 100% of a capacity, amber from 80%. */
function useClass(pct: number | null): string | undefined {
  if (pct === null) return undefined;
  return pct > 100 ? "th-bad" : pct >= 80 ? "th-warn" : undefined;
}

/** Sets one limit of a position from typed text in kg, then redraws. */
function editLimit(r: Row, text: string, set: (info: PositionInfo, kg: number) => PositionInfo, redraw: () => void): void {
  const kg = kgOf(text);
  if (kg === null) toast("Enter a weight in kg, 0 or more.", "info");
  else if (r.pos.name === NO_POSITION) toast("Instruments with no Position hang on no batten. Give them a Position to set its limits.", "info");
  else saveInfo("Set Limit", set(infoOf(r.pos.name, infosNow()), kg));
  redraw();
}

function columnsFor(redraw: () => void): Column<Row>[] {
  return [
    { label: "Position", value: (r) => r.pos.name },
    { label: "Instruments", value: (r) => r.pos.hangs.length, numeric: true },
    { label: "Weight", value: (r) => kgText(r.pos.instrumentKg), numeric: true },
    { label: "Pipe Weight", value: (r) => kgText(r.check.pipeKg), numeric: true },
    { label: "Total", value: (r) => kgText(r.check.totalKg), numeric: true },
    {
      label: "Capacity (kg)",
      value: (r) => (r.pos.capacityKg > 0 ? r.pos.capacityKg : ""),
      numeric: true,
      edit: (r, text) => editLimit(r, text, (i, kg) => ({ ...i, capacityKg: kg }), redraw),
    },
    { label: "Use %", value: (r) => (r.check.usePct === null ? "" : `${Math.round(r.check.usePct)}%`), numeric: true, cellClass: (r) => useClass(r.check.usePct) },
    { label: "Max Support Reaction", value: (r) => (r.pos.supportsMm.length ? kgText(r.check.maxReactionKg) : ""), numeric: true },
    {
      label: "Support Capacity (kg)",
      value: (r) => (r.pos.supportCapacityKg > 0 ? r.pos.supportCapacityKg : ""),
      numeric: true,
      edit: (r, text) => editLimit(r, text, (i, kg) => ({ ...i, supportCapacityKg: kg }), redraw),
    },
    { label: "Status", value: (r) => r.check.status, cellClass: (r) => (r.check.level === "bad" ? "th-bad" : r.check.level === "unset" ? "th-warn" : undefined) },
  ];
}

/** The batten's drawing: instruments as arrows with their weight, hoists as triangles with their reactions. */
function battenSvg(pos: LoadPosition, beam: BeamResult): SVGElement {
  const beamY = 74;
  const x = (mm: number): number => PLOT_LEFT + (mm / pos.lengthMm) * (PLOT_RIGHT - PLOT_LEFT);
  const svg = svgNode("svg", { viewBox: `0 0 ${VIEW_W} 124`, class: "loads-svg", role: "img", "aria-label": `${pos.name} batten` });
  svg.append(svgNode("line", { class: "loads-batten", x1: x(0), y1: beamY, x2: x(pos.lengthMm), y2: beamY }));
  svg.append(svgNode("text", { x: 4, y: beamY + 4 }, "SR"), svgNode("text", { x: VIEW_W - 4, y: beamY + 4, "text-anchor": "end" }, "SL"));
  for (const hang of pos.hangs) {
    const hx = x(hang.offsetMm);
    svg.append(svgNode("line", { class: "loads-hang", x1: hx, y1: beamY - 36, x2: hx, y2: beamY - 4 }));
    svg.append(svgNode("polyline", { class: "loads-hang", points: `${hx - 3},${beamY - 9} ${hx},${beamY - 3} ${hx + 3},${beamY - 9}` }));
    const lines = weightLines(hang.fixture.weightKg);
    lines.forEach((line, i) => svg.append(svgNode("text", { x: hx, y: beamY - 41 - (lines.length - 1 - i) * 11, "text-anchor": "middle" }, line)));
  }
  pos.supportsMm.forEach((mm, i) => {
    const sx = x(mm);
    svg.append(svgNode("polygon", { class: "loads-hoist", points: `${sx - 7},${beamY + 10} ${sx + 7},${beamY + 10} ${sx},${beamY}` }));
    svg.append(svgNode("text", { x: sx, y: beamY + 24, "text-anchor": "middle" }, `Hoist ${i + 1}`));
    weightLines(beam.reactionsKg[i] ?? 0).forEach((line, k) => svg.append(svgNode("text", { x: sx, y: beamY + 36 + k * 11, "text-anchor": "middle" }, line)));
  });
  return svg;
}

/** A graph along the batten: shear as steps (it jumps at a load or hoist), bending as a curve, with the peaks labelled. */
function chartSvg(title: string, unit: string, lengthMm: number, stations: readonly BeamStation[], pick: (s: BeamStation) => number, stepped: boolean, cls: string): SVGElement {
  const top = 34;
  const bottom = 94;
  const x = (mm: number): number => PLOT_LEFT + (mm / lengthMm) * (PLOT_RIGHT - PLOT_LEFT);
  const values = stations.map(pick);
  // where a load or hoist sits, the shear jumps from the value just before the station, so the range takes that too
  const before = stepped ? stations.map((s) => s.shearBeforeKg) : values;
  const hi = Math.max(0, ...values, ...before);
  const lo = Math.min(0, ...values, ...before);
  const span = hi - lo > 1e-9 ? hi - lo : 1;
  const y = (v: number): number => top + ((hi - v) / span) * (bottom - top);
  const svg = svgNode("svg", { viewBox: `0 0 ${VIEW_W} 120`, class: `loads-svg loads-chart ${cls}`, role: "img", "aria-label": title });
  svg.append(svgNode("text", { x: 4, y: 12 }, `${title} (${unit})`));
  svg.append(svgNode("line", { class: "loads-zero", x1: PLOT_LEFT, y1: y(0), x2: PLOT_RIGHT, y2: y(0) }));
  if (stations.length === 0) return svg;
  const d = stations.map((s, i) => {
    const px = x(s.atMm);
    if (i === 0) return `M${px},${y(values[0])}`;
    return stepped ? `L${px},${y(before[i])} L${px},${y(values[i])}` : `L${px},${y(values[i])}`;
  });
  svg.append(svgNode("path", { class: "loads-line", d: d.join(" "), fill: "none" }));
  const place = (mm: number): string => (mm < PLOT_LEFT + 40 ? "start" : mm > PLOT_RIGHT - 40 ? "end" : "middle");
  const label = (i: number, at: number, text: string): void => svg.append(svgNode("text", { class: "loads-peak", x: x(stations[i].atMm), y: at, "text-anchor": place(stations[i].atMm) }, text));
  // the station of a peak: its value after the station, or the value just before it
  const stationOf = (v: number): number => (values.includes(v) ? values.indexOf(v) : before.indexOf(v));
  if (hi > 0.05) label(stationOf(hi), y(hi) - 5, `${hi.toFixed(1)} ${unit}`);
  if (lo < -0.05) label(stationOf(lo), y(lo) + 12, `${lo.toFixed(1)} ${unit}`);
  return svg;
}

/** The supports typed as "0, 4000 mm, 12'-0"": each a distance from the stage-right end, on the batten. */
function supportsOf(text: string, lengthMm: number): { supports: number[] } | { error: string } {
  const units = store.session?.doc.info.units;
  const out: number[] = [];
  for (const part of text.split(",").map((s) => s.trim()).filter((s) => s !== "")) {
    const mm = parseLength(part, units);
    if (mm === null) return { error: `"${part}" isn't a distance. Write it as 4000 mm or 13'-1", separated by commas.` };
    if (mm < 0 || mm > lengthMm) return { error: `${part} is off the batten, which runs from 0 to ${lengthText(lengthMm)}.` };
    if (out.some((v) => Math.abs(v - mm) < 1)) return { error: `Two hoists are at ${part}.` };
    out.push(mm);
  }
  return { supports: out.sort((a, b) => a - b) };
}

/** The hoist positions as text to type; a change of them is saved and the detail redrawn. Blank means the two ends. */
function supportsEditor(pos: LoadPosition, redraw: () => void): HTMLElement {
  const units = store.session?.doc.info.units;
  const label = !units || /milli/i.test(units) ? "Supports at (mm from SR end)" : "Supports at (from SR end)";
  const input = h("input", { cls: "loads-input loads-wide", value: pos.supportsMm.map((mm) => lengthText(mm)).join(", "), attrs: { type: "text" } });
  const error = noteLine("", "th-bad");
  error.hidden = true;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  input.addEventListener("change", () => {
    const r = supportsOf(input.value, pos.lengthMm);
    if ("error" in r) {
      error.textContent = r.error;
      error.hidden = false;
      return;
    }
    saveInfo("Set Hoists", { ...infoOf(pos.name, infosNow()), supportsMm: r.supports });
    redraw();
  });
  return h("div", { cls: "loads-stack" }, h("label", { cls: "loads-field" }, h("span", { cls: "loads-label", text: label }), input), error);
}

/** The Detail of one position: its batten, hoists, shear and bending. */
function detailOf(row: Row, redraw: () => void, close: () => void): HTMLElement {
  const { pos, check } = row;
  const n = pos.hangs.length;
  const head = h("p", { cls: "loads-detail-head", text: `${pos.name}: ${n} instrument${n === 1 ? "" : "s"}` });
  const closeButton = h("button", { cls: "btn", text: "Close Detail", attrs: { type: "button" } });
  closeButton.addEventListener("click", () => close());
  if (pos.name === NO_POSITION) {
    return h("div", { cls: "loads-detail" }, head, noteLine("Instruments with no Position hang on no batten, so there is no beam to check. Give them a Position to check their hang."), closeButton);
  }
  const usage = check.usePct === null ? "" : ` ${kgText(check.totalKg)} of ${kgText(pos.capacityKg)}, ${Math.round(check.usePct)}% used.`;
  const status = h("p", { cls: check.level === "bad" ? "th-bad" : check.level === "unset" ? "th-warn" : undefined, text: `Status: ${check.status}.${usage}` });
  const hoistLines = pos.supportsMm.map((mm, i) => {
    const r = check.beam.reactionsKg[i] ?? 0;
    const pulls = r < -0.05 ? " (pulls down: it needs a hold-down)" : "";
    return h("li", { text: `Hoist ${i + 1} at ${lengthText(mm)}: ${kgText(r)}${pulls}` });
  });
  const notes: HTMLElement[] = [];
  if (check.beam.unstable) notes.push(noteLine("Hung from one hoist: it balances on that point, so nothing bends and the hoist takes the whole weight."));
  if (pos.hangs.some((hang) => hang.offsetMm > pos.lengthMm)) notes.push(noteLine("Some instruments hang past the batten's end: make the length longer.", "th-bad"));
  const hoistCap = pos.supportCapacityKg > 0 ? `Each hoist may carry ${kgText(pos.supportCapacityKg)}.` : "No limit set for each hoist.";
  return h(
    "div",
    { cls: "loads-detail" },
    head,
    h("p", { text: `Instruments ${kgText(check.totalKg - check.pipeKg)}, pipe ${kgText(check.pipeKg)} over ${lengthText(pos.lengthMm)}, total ${kgText(check.totalKg)}. ${hoistCap}` }),
    status,
    battenSvg(pos, check.beam),
    h("ul", { cls: "loads-hoists" }, ...hoistLines),
    supportsEditor(pos, redraw),
    ...notes,
    chartSvg("Shear", "kg", pos.lengthMm, check.beam.stations, (s) => s.shearKg, true, "loads-shear"),
    chartSvg("Bending moment", "kg·m", pos.lengthMm, check.beam.stations, (s) => s.momentKgM, false, "loads-moment"),
    h("p", { text: `Biggest bending moment ${check.beam.maxMomentKgM.toFixed(1)} kg·m; biggest shear ${check.beam.maxShearKg.toFixed(1)} kg.` }),
    closeButton,
  );
}

function positionsTable(rows: readonly Row[], open: (name: string) => void, redraw: () => void): HTMLElement {
  return dataTable(columnsFor(redraw), () => rows, {
    empty: "No lighting instruments hang on a position yet.",
    onRow: (r) => open(r.pos.name),
  }).element;
}

let panel: OpenPanel | null = null;
let stopWatching: (() => void) | null = null;

/** Opens the Load Check window, or brings it forward when it's open. */
export function openLoadCheck(): void {
  if (panel) {
    document.body.append(panel.element);
    return;
  }
  if (fixtures().length === 0) {
    toast("No lighting instruments on the drawing to check.", "info");
    return;
  }
  const details: string[] = [];
  let shown = "positions";
  const host = h("div", { cls: "loads-host" });
  const redraw = (): void => {
    const rows = rowsNow();
    const list: Tab[] = [
      {
        id: "positions",
        label: "Positions",
        build: () => {
          shown = "positions";
          return positionsTable(rows, openDetail, redraw);
        },
      },
      ...details.map(
        (name): Tab => ({
          id: `detail:${name}`,
          label: `Detail: ${name}`,
          build: () => {
            shown = `detail:${name}`;
            const row = rows.find((r) => r.pos.name === name);
            return row ? detailOf(row, redraw, () => closeDetail(name)) : h("p", { cls: "th-empty", text: "No instruments hang on this position now." });
          },
        }),
      ),
    ];
    host.replaceChildren(tabs(list, shown).element);
  };
  const openDetail = (name: string): void => {
    if (!details.includes(name)) details.push(name);
    shown = `detail:${name}`;
    redraw();
  };
  const closeDetail = (name: string): void => {
    const at = details.indexOf(name);
    if (at >= 0) details.splice(at, 1);
    shown = "positions";
    redraw();
  };

  const pipeInput = h("input", { cls: "loads-input loads-small", value: String(readShow<number>(PIPE_KEY, PIPE_KG_PER_M)), attrs: { type: "text", inputmode: "decimal", "aria-label": "Pipe weight, kg per m" } });
  pipeInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") pipeInput.blur();
  });
  pipeInput.addEventListener("change", () => {
    const kg = kgOf(pipeInput.value);
    if (kg === null || pipeInput.value.trim() === "") {
      toast("Enter the pipe's weight in kg per m, 0 or more.", "info");
      pipeInput.value = String(readShow<number>(PIPE_KEY, PIPE_KG_PER_M));
      return;
    }
    writeShow("Pipe Weight", PIPE_KEY, kg);
    redraw();
  });
  const toolbar = h(
    "div",
    { cls: "th-toolbar" },
    h("label", { cls: "loads-field" }, h("span", { cls: "loads-label", text: "Pipe weight" }), pipeInput, h("span", { cls: "loads-unit", text: "kg per m" })),
    h("span", { cls: "loads-hint", text: "Schedule 40 pipe is about 3 kg per m. Click a position for its batten." }),
  );
  const body = h("div", { cls: "loads-body" }, toolbar, host, noteLine(CHECK_NOTE));

  const exportCsv = (): void => {
    downloadText("load-check.csv", csvOf(columnsFor(() => {}), rowsNow()), "text/csv");
  };
  redraw();
  panel = openPanel({
    key: "loads.check",
    title: "Load Check",
    body,
    actions: [{ label: "Export CSV", run: exportCsv }],
    width: 1120,
    height: 720,
    onClose: () => {
      stopWatching?.();
      stopWatching = null;
      panel = null;
    },
  });
  stopWatching = watchDrawing(redraw);
}
