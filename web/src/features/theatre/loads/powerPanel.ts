// The Power Balance window (Stage > Loads and Power > Power Balance…): the loads the instruments put on the supply,
// balanced over one or three phases, with the amps they draw, the neutral and the imbalance, and what each saved look
// draws at its levels, which is the peak the show asks for. The phases of each load are saved in the drawing. Watts
// are the instruments' ratings: demand factors, cable and breakers aren't checked. The pure part is power.ts.

import { h } from "../../../app/dom.ts";
import { toast } from "../../../app/toast.ts";
import { fixtures } from "../instrument.ts";
import { readShow, writeShow } from "../show.ts";
import { LOOKS_KEY, type Look } from "../showTypes.ts";
import { csvOf, dataTable, downloadText, noteLine, openPanel, type Column, type OpenPanel } from "../ui.ts";
import { imbalanceOf, phaseAmps, phaseNumber, balancePhases, loadKeyOf, loadsOf, lookDemand, neutralAmps, serviceAmps, type Load, type LookDemand } from "./power.ts";
import { imperial, watchDrawing } from "./loadsUi.ts";

/** Each load's phase, by its key: "L1" to "L3". */
export const PHASES_KEY = "loads.phases";
const PHASE_NAMES = ["L1", "L2", "L3"];
const FINE_PRINT = "Watts are the instruments' ratings, not measured draw. Demand factors, cable runs and breakers aren't checked: a qualified electrician signs off the supply.";

interface LoadRow {
  readonly load: Load;
  /** 0 to 2 */
  readonly phase: number;
}

interface Snapshot {
  readonly rows: LoadRow[];
  readonly phaseWatts: number[];
  readonly looks: LookDemand[];
  /** loads with no phase saved yet, which count on L1 */
  readonly unassigned: number;
}

/** The phase index of a saved label, 0 when it's none (or none on this supply). */
function phaseIndex(saved: string | undefined, phases: number): number {
  const n = saved === undefined ? null : phaseNumber(saved, phases);
  return n === null ? 0 : n - 1;
}

/** The loads, their phases, and each look's draw, from the drawing as it is now. */
function snapshotNow(phases: number): Snapshot {
  const list = fixtures();
  const loads = loadsOf(list);
  const saved = readShow<Record<string, string>>(PHASES_KEY, {});
  const rows = loads.map((load) => ({ load, phase: phaseIndex(saved[load.key], phases) }));
  const phaseWatts = new Array<number>(phases).fill(0);
  for (const r of rows) phaseWatts[r.phase] += r.load.watts;
  const phaseByKey = new Map<string, number>(rows.map((r) => [r.load.key, r.phase] as const));
  const looks = lookDemand(readShow<Look[]>(LOOKS_KEY, []), list, (f) => phaseByKey.get(loadKeyOf(f)) ?? 0, phases);
  return { rows, phaseWatts, looks, unassigned: loads.filter((l) => !(l.key in saved)).length };
}

function loadColumns(volts: number, phases: number, redraw: () => void): Column<LoadRow>[] {
  return [
    { label: "Circuit/Dimmer", value: (r) => r.load.name },
    { label: "Watts", value: (r) => Math.round(r.load.watts), numeric: true },
    { label: "Amps", value: (r) => phaseAmps(r.load.watts, volts).toFixed(1), numeric: true },
    { label: "Phase", value: (r) => PHASE_NAMES[r.phase], edit: (r, text) => setPhase(r.load.key, text, phases, redraw) },
  ];
}

function lookColumns(volts: number): Column<LookDemand>[] {
  return [
    { label: "Look", value: (d) => d.name },
    { label: "kW", value: (d) => (d.watts / 1000).toFixed(2), numeric: true },
    { label: "Peak Phase", value: (d) => PHASE_NAMES[d.phaseWatts.indexOf(Math.max(...d.phaseWatts))] },
    { label: "Peak Phase Amps", value: (d) => phaseAmps(Math.max(...d.phaseWatts), volts).toFixed(1), numeric: true },
  ];
}

/** Puts one load on the phase the text names ("L2"), saved in the drawing. */
function setPhase(key: string, text: string, phases: number, redraw: () => void): void {
  const n = phaseNumber(text, phases);
  if (n === null) toast(phases === 1 ? "A single phase supply has only L1." : "Enter L1, L2 or L3.", "info");
  else writeShow("Set Phase", PHASES_KEY, { ...readShow<Record<string, string>>(PHASES_KEY, {}), [key]: PHASE_NAMES[n - 1] });
  redraw();
}

/** Balances every load over the phases and saves the result. */
function balanceNow(phases: number, redraw: () => void): void {
  const loads = loadsOf(fixtures());
  const b = balancePhases(
    loads.map((l) => l.watts),
    phases,
  );
  const next: Record<string, string> = {};
  loads.forEach((l, i) => {
    next[l.key] = PHASE_NAMES[b.assignment[i]];
  });
  writeShow("Balance Phases", PHASES_KEY, next);
  redraw();
}

/** One bar per phase, its width the share of the biggest phase, with its watts and amps. */
function barsOf(phaseWatts: readonly number[], volts: number): HTMLElement {
  const top = Math.max(...phaseWatts, 1);
  return h(
    "div",
    { cls: "loads-bars" },
    ...phaseWatts.map((w, i) => {
      const fill = h("i", { cls: `loads-phase-${i}` });
      fill.style.width = `${(w / top) * 100}%`;
      return h(
        "div",
        { cls: "loads-bar-row" },
        h("span", { cls: "loads-phase-name", text: PHASE_NAMES[i] }),
        h("div", { cls: "loads-bar" }, fill),
        h("span", { cls: "loads-bar-text", text: `${Math.round(w)} W · ${phaseAmps(w, volts).toFixed(1)} A` }),
      );
    }),
  );
}

/** The window's body under the toolbar: the loads, the phases, the supply's figures, and each look's draw. */
function contentOf(snap: Snapshot, volts: number, phases: number, redraw: () => void): HTMLElement {
  const total = snap.phaseWatts.reduce((s, w) => s + w, 0);
  const amps = snap.phaseWatts.map((w) => phaseAmps(w, volts));
  const pct = imbalanceOf(snap.phaseWatts);
  const loadTable = dataTable(loadColumns(volts, phases, redraw), () => snap.rows, { empty: "Nothing on the supply yet." }).element;
  const lookTable = dataTable(lookColumns(volts), () => snap.looks, { empty: "No looks are saved yet, so there's no look demand to show." }).element;
  const notes: HTMLElement[] = [];
  notes.push(noteLine(`Total ${(total / 1000).toFixed(2)} kW. Balanced, each line carries ${serviceAmps(total, volts, phases).toFixed(1)} A.`));
  if (phases === 3) notes.push(noteLine(`Neutral ${neutralAmps(amps[0], amps[1], amps[2]).toFixed(1)} A, the current that doesn't cancel between the phases.`));
  else notes.push(noteLine("On one phase the neutral carries the same current as the phase."));
  notes.push(noteLine(`Imbalance ${pct.toFixed(1)}%. Keep it under 10%.`, pct > 25 ? "th-bad" : pct > 10 ? "th-warn" : undefined));
  if (snap.unassigned > 0) {
    notes.push(noteLine(`${snap.unassigned} load${snap.unassigned === 1 ? " has" : "s have"} no phase yet and count on L1. Balance them, or pick a phase in the table.`, "th-warn"));
  }
  return h(
    "div",
    { cls: "loads-stack" },
    h("p", { cls: "loads-heading", text: "Supply" }),
    h("div", { cls: "loads-table" }, loadTable),
    barsOf(snap.phaseWatts, volts),
    ...notes,
    h("p", { cls: "loads-heading", text: "What each look draws" }),
    h("div", { cls: "loads-table" }, lookTable),
    noteLine(FINE_PRINT),
  );
}

let panel: OpenPanel | null = null;
let stopWatching: (() => void) | null = null;

/** Opens the Power Balance window, or brings it forward when it's open. */
export function openPowerBalance(): void {
  if (panel) {
    document.body.append(panel.element);
    return;
  }
  if (fixtures().length === 0) {
    toast("No lighting instruments on the drawing to balance.", "info");
    return;
  }
  let volts = imperial() ? 120 : 230;
  let phases = 3;
  const host = h("div", { cls: "loads-host" });
  const redraw = (): void => {
    host.replaceChildren(contentOf(snapshotNow(phases), volts, phases, redraw));
  };

  const voltsSelect = h("select", { cls: "loads-input", attrs: { "aria-label": "Volts to neutral" } }, h("option", { value: "120", text: "120 V" }), h("option", { value: "230", text: "230 V" }));
  voltsSelect.value = String(volts);
  voltsSelect.addEventListener("change", () => {
    volts = Number(voltsSelect.value);
    redraw();
  });
  const phasesSelect = h("select", { cls: "loads-input", attrs: { "aria-label": "Supply phases" } }, h("option", { value: "1", text: "1 phase" }), h("option", { value: "3", text: "3 phases" }));
  phasesSelect.value = String(phases);
  phasesSelect.addEventListener("change", () => {
    phases = Number(phasesSelect.value);
    redraw();
  });
  const balance = h("button", { cls: "btn primary", text: "Balance", attrs: { type: "button" } });
  balance.addEventListener("click", () => balanceNow(phases, redraw));
  const toolbar = h(
    "div",
    { cls: "th-toolbar" },
    h("label", { cls: "loads-field" }, h("span", { cls: "loads-label", text: "Volts to neutral" }), voltsSelect),
    h("label", { cls: "loads-field" }, h("span", { cls: "loads-label", text: "Supply" }), phasesSelect),
    h("span", { cls: "th-spacer" }),
    balance,
  );
  const body = h("div", { cls: "loads-body" }, toolbar, host);

  const exportCsv = (): void => {
    const snap = snapshotNow(phases);
    downloadText("power-balance.csv", `${csvOf(loadColumns(volts, phases, () => {}), snap.rows)}\r\n${csvOf(lookColumns(volts), snap.looks)}`, "text/csv");
  };
  redraw();
  panel = openPanel({
    key: "loads.power",
    title: "Power Balance",
    body,
    actions: [{ label: "Export CSV", run: exportCsv }],
    width: 840,
    height: 660,
    onClose: () => {
      stopWatching?.();
      stopWatching = null;
      panel = null;
    },
  });
  stopWatching = watchDrawing(redraw);
}
