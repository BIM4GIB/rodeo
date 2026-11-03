// Power for the Power Balance window: the loads the instruments put on a supply (by circuit, else dimmer, else each
// instrument alone), balanced over one or three phases, the amps they draw, the neutral and the imbalance, and what
// each saved look draws at its levels. Pure: watts and amps. It leaves out demand factors, cable runs, breakers and
// the dimmers' own losses, and reads the watts as the instruments' ratings.

import type { Fixture } from "../fixture.ts";
import { naturalCompare } from "../fixture.ts";
import type { Look } from "../showTypes.ts";

/** One supply load: a circuit, a dimmer, or an instrument on its own. */
export interface Load {
  /** names the load in the phase assignments */
  readonly key: string;
  readonly name: string;
  readonly watts: number;
  readonly fixtureIds: readonly string[];
}

/** The key of the load an instrument belongs to: its circuit, else its dimmer, else itself. */
export function loadKeyOf(f: Fixture): string {
  const circuit = f.circuit.trim();
  if (circuit) return `circuit:${circuit}`;
  const dimmer = f.dimmer.trim();
  return dimmer ? `dimmer:${dimmer}` : `fixture:${f.id}`;
}

/** The name a load shows: its circuit or dimmer, or an instrument's unit and channel. */
function nameOf(f: Fixture): string {
  const circuit = f.circuit.trim();
  if (circuit) return circuit;
  const dimmer = f.dimmer.trim();
  if (dimmer) return dimmer;
  const parts = [f.unit.trim() ? `Unit ${f.unit.trim()}` : "", f.channel.trim() ? `Ch ${f.channel.trim()}` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : f.label;
}

/** The loads of `fixtures`, one per circuit, dimmer or instrument, watts summed, by name. */
export function loadsOf(fixtures: readonly Fixture[]): Load[] {
  const groups = new Map<string, { name: string; watts: number; fixtureIds: string[] }>();
  for (const f of fixtures) {
    const key = loadKeyOf(f);
    const g = groups.get(key) ?? { name: nameOf(f), watts: 0, fixtureIds: [] };
    g.watts += f.watts;
    g.fixtureIds.push(f.id);
    groups.set(key, g);
  }
  return [...groups]
    .map(([key, g]) => ({ key, ...g }))
    .sort((a, b) => naturalCompare(a.name, b.name));
}

/** The result of balancing loads over phases. */
export interface Balance {
  /** the phase (0 to phases - 1) of each load, in the order given */
  readonly assignment: number[];
  /** the watts on each phase */
  readonly watts: number[];
  /** (largest - smallest) / average phase, %: 0 when balanced */
  readonly imbalancePct: number;
}

function lowest(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] < values[best]) best = i;
  return best;
}

function highest(values: readonly number[]): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i;
  return best;
}

function spreadOf(values: readonly number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/** The swap of a load on the heaviest phase with one on the lightest that narrows the spread most, or null when none does. */
function bestSwap(loads: readonly number[], assignment: readonly number[], sums: readonly number[]): [number, number] | null {
  const hi = highest(sums);
  const lo = lowest(sums);
  let spread = spreadOf(sums);
  let best: [number, number] | null = null;
  for (let a = 0; a < loads.length; a++) {
    if (assignment[a] !== hi) continue;
    for (let b = 0; b < loads.length; b++) {
      if (assignment[b] !== lo) continue;
      const next = [...sums];
      next[hi] += loads[b] - loads[a];
      next[lo] += loads[a] - loads[b];
      const s = spreadOf(next);
      if (s < spread - 1e-9) {
        spread = s;
        best = [a, b];
      }
    }
  }
  return best;
}

/** (largest - smallest) / average phase, %, of the watts on each phase; 0 for no load. */
export function imbalanceOf(phaseWatts: readonly number[]): number {
  const total = phaseWatts.reduce((s, w) => s + w, 0);
  if (total <= 0) return 0;
  return (spreadOf(phaseWatts) / (total / phaseWatts.length)) * 100;
}

/**
 * Balances `loads` (watts) over `phases`: the heaviest first, each to the lightest phase, then swaps between the
 * heaviest and the lightest phase for as long as one narrows the spread.
 */
export function balancePhases(loads: readonly number[], phases = 3): Balance {
  const assignment = new Array<number>(loads.length).fill(0);
  const sums = new Array<number>(phases).fill(0);
  const heaviest = loads.map((_, i) => i).sort((a, b) => loads[b] - loads[a] || a - b);
  for (const i of heaviest) {
    const p = lowest(sums);
    assignment[i] = p;
    sums[p] += loads[i];
  }
  let swap = phases > 1 ? bestSwap(loads, assignment, sums) : null;
  while (swap) {
    const [a, b] = swap;
    const hi = assignment[a];
    const lo = assignment[b];
    sums[hi] += loads[b] - loads[a];
    sums[lo] += loads[a] - loads[b];
    assignment[a] = lo;
    assignment[b] = hi;
    swap = bestSwap(loads, assignment, sums);
  }
  return { assignment, watts: sums, imbalancePct: imbalanceOf(sums) };
}

/** Amps on one phase: watts over volts to neutral. */
export function phaseAmps(watts: number, volts: number): number {
  return watts / volts;
}

/** Neutral amps on three phases: the current that doesn't cancel between the three line currents. */
export function neutralAmps(a: number, b: number, c: number): number {
  return Math.sqrt(Math.max(0, a * a + b * b + c * c - a * b - b * c - c * a));
}

/** Amps per line of a balanced supply: total watts over phases times volts to neutral. */
export function serviceAmps(totalWatts: number, volts: number, phases: number): number {
  return totalWatts / (phases * volts);
}

/** The phase a label names ("L2", "l 2", "2"), 1 to `phases`, or null when it names none on this supply. */
export function phaseNumber(text: string, phases: number): number | null {
  const m = /^\s*l?\s*([1-9])\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return n <= phases ? n : null;
}

/** What one look draws: its watts at its levels, in all and on each phase. */
export interface LookDemand {
  readonly name: string;
  readonly watts: number;
  readonly phaseWatts: number[];
}

/**
 * Each look's watts: every instrument's watts times its channel's level in the look (0 to 1). A channel the look
 * leaves out is off, as levels.ts has it. `phaseOf` gives each instrument's phase, 0 to phases - 1.
 */
export function lookDemand(looks: readonly Look[], fixtures: readonly Fixture[], phaseOf: (f: Fixture) => number, phases: number): LookDemand[] {
  return looks.map((look) => {
    const phaseWatts = new Array<number>(phases).fill(0);
    for (const f of fixtures) {
      const v = look.levels[f.channel];
      const level = typeof v === "number" ? Math.min(1, Math.max(0, v)) : 0;
      phaseWatts[phaseOf(f)] += f.watts * level;
    }
    return { name: look.name, watts: phaseWatts.reduce((s, w) => s + w, 0), phaseWatts };
  });
}
