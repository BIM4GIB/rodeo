// AEC > Framing > Simple Beam Calculator…, as Vectorworks has it: one beam of uniform section under
// a single kind of load, its reactions, end moments, greatest shear and bending moment, bending
// stress and greatest deflection, worked out as the values are typed. Simple beams, beams fixed at
// both ends, beams fixed at one end and supported at the other, and cantilevers, each under a
// uniform load or concentrated loads (the classic beam diagrams). Reactions and end moments come
// from those diagrams' formulas; the deflected shape is the bending moment integrated twice along
// the beam, so its greatest deflection and where it lies hold for every case. The stress is the
// bending stress M/S; a shear stress needs the section's shape, which the calculator doesn't take.

import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { numberText } from "./engineeringProperties.ts";
import { store } from "./state.ts";
import "./calculators.css";

type End = "pinned" | "fixed" | "free";
type Load = "uniform" | "center" | "point" | "two" | "end";

export interface BeamCase {
  readonly key: string;
  readonly label: string;
  readonly left: End;
  readonly right: End;
  readonly load: Load;
}

export const BEAM_CASES: readonly BeamCase[] = [
  { key: "simple-uniform", label: "Simple: uniform load", left: "pinned", right: "pinned", load: "uniform" },
  { key: "simple-center", label: "Simple: load at center", left: "pinned", right: "pinned", load: "center" },
  { key: "simple-point", label: "Simple: load at any point", left: "pinned", right: "pinned", load: "point" },
  { key: "simple-two", label: "Simple: two equal loads", left: "pinned", right: "pinned", load: "two" },
  { key: "fixed-uniform", label: "Fixed both ends: uniform load", left: "fixed", right: "fixed", load: "uniform" },
  { key: "fixed-center", label: "Fixed both ends: load at center", left: "fixed", right: "fixed", load: "center" },
  { key: "fixed-point", label: "Fixed both ends: load at any point", left: "fixed", right: "fixed", load: "point" },
  { key: "propped-uniform", label: "Propped cantilever: uniform load", left: "fixed", right: "pinned", load: "uniform" },
  { key: "propped-center", label: "Propped cantilever: load at center", left: "fixed", right: "pinned", load: "center" },
  { key: "cantilever-uniform", label: "Cantilever: uniform load", left: "fixed", right: "free", load: "uniform" },
  { key: "cantilever-end", label: "Cantilever: load at free end", left: "fixed", right: "free", load: "end" },
  { key: "cantilever-point", label: "Cantilever: load at any point", left: "fixed", right: "free", load: "point" },
];

/** A beam and its load in SI units: m, N, N/m, Pa, m⁴, m³; `a` from the left end. */
export interface BeamInput {
  readonly L: number;
  readonly P: number;
  readonly a: number;
  readonly w: number;
  readonly E: number;
  readonly I: number;
  readonly S: number;
}

/** The answers, SI: reactions and shear in N, moments in N·m (end moments as magnitudes), stress in Pa, deflection in m (downward positive) at `at` m from the left end. */
export interface BeamResult {
  readonly rL: number;
  readonly rR: number;
  readonly mL: number;
  readonly mR: number;
  readonly vMax: number;
  readonly mMax: number;
  readonly stress: number;
  readonly deflection: number;
  readonly at: number;
}

/** points along the beam the shape is integrated over */
const STEPS = 20000;

/** The loads on the beam: point loads (N at m from the left) and a uniform load (N/m). */
function loadsOf(c: BeamCase, b: BeamInput): { points: { x: number; P: number }[]; w: number } {
  const { L, P, a, w } = b;
  switch (c.load) {
    case "uniform":
      return { points: [], w };
    case "center":
      return { points: [{ x: L / 2, P }], w: 0 };
    case "end":
      return { points: [{ x: L, P }], w: 0 };
    case "point":
      return { points: [{ x: a, P }], w: 0 };
    case "two":
      return {
        points: [
          { x: a, P },
          { x: L - a, P },
        ],
        w: 0,
      };
  }
}

/** The left reaction and the hogging moments at the ends, by the beam diagrams' formulas. */
function supportsOf(c: BeamCase, b: BeamInput): { rL: number; mL: number; mR: number } {
  const { L, P, w } = b;
  const a = c.load === "center" ? L / 2 : b.a;
  const r = L - a;
  switch (c.key) {
    case "simple-uniform":
      return { rL: (w * L) / 2, mL: 0, mR: 0 };
    case "simple-center":
    case "simple-point":
      return { rL: (P * r) / L, mL: 0, mR: 0 };
    case "simple-two":
      return { rL: P, mL: 0, mR: 0 };
    case "fixed-uniform":
      return { rL: (w * L) / 2, mL: (w * L * L) / 12, mR: (w * L * L) / 12 };
    case "fixed-center":
    case "fixed-point":
      return { rL: (P * r * r * (3 * a + r)) / L ** 3, mL: (P * a * r * r) / (L * L), mR: (P * a * a * r) / (L * L) };
    case "propped-uniform":
      return { rL: (5 * w * L) / 8, mL: (w * L * L) / 8, mR: 0 };
    case "propped-center":
      return { rL: (11 * P) / 16, mL: (3 * P * L) / 16, mR: 0 };
    case "cantilever-uniform":
      return { rL: w * L, mL: (w * L * L) / 2, mR: 0 };
    default:
      // a cantilever's load at its end or a point along it
      return { rL: P, mL: P * (c.load === "end" ? L : a), mR: 0 };
  }
}

/** Why the values can't make this beam, or null. */
export function beamProblem(c: BeamCase, b: BeamInput): string | null {
  if (!(b.L > 0)) return "Beam Length: enter a length above nought.";
  if (c.load === "uniform" ? !(b.w > 0) : !(b.P > 0)) return c.load === "uniform" ? "Distributed Load: enter a load above nought." : "Concentrated Load: enter a load above nought.";
  if (c.load === "point" && !(b.a > 0 && b.a < b.L)) return "Dist. from end of beam: the load must lie on the beam, between its ends.";
  if (c.load === "two" && !(b.a > 0 && b.a <= b.L / 2)) return "Dist. from end of beam: each load lies that far from its end, so it can be at most half the beam's length.";
  if (!(b.E > 0) || !(b.I > 0) || !(b.S > 0)) return "Enter the beam's modulus of elasticity, moment of inertia and section modulus.";
  return null;
}

/** The beam solved: its supports by formula, its shear, moment and deflected shape along it. */
export function solveBeam(c: BeamCase, b: BeamInput): BeamResult {
  const { L, E, I, S } = b;
  const { points, w } = loadsOf(c, b);
  const { rL, mL, mR } = supportsOf(c, b);
  const total = w * L + points.reduce((s, p) => s + p.P, 0);
  const rR = c.right === "free" ? 0 : total - rL;
  // bending moment (sagging positive) and shear along the beam
  const moment = (x: number): number => -mL + rL * x - (w * x * x) / 2 - points.reduce((s, p) => s + (x > p.x ? p.P * (x - p.x) : 0), 0);
  const shear = (x: number): number => rL - w * x - points.reduce((s, p) => s + (x > p.x ? p.P : 0), 0);
  let mMax = Math.max(Math.abs(moment(0)), Math.abs(moment(L)), ...points.map((p) => Math.abs(moment(p.x))));
  let vMax = Math.max(Math.abs(shear(0)), Math.abs(shear(L)), Math.abs(rR));
  // the slope and deflection, the moment over EI integrated twice (trapezoids); a pinned left end turns
  const h = L / STEPS;
  const slope = new Float64Array(STEPS + 1);
  const y = new Float64Array(STEPS + 1);
  let prev = moment(0);
  for (let i = 1; i <= STEPS; i++) {
    const m = moment(i * h);
    mMax = Math.max(mMax, Math.abs(m));
    vMax = Math.max(vMax, Math.abs(shear(i * h)));
    slope[i] = slope[i - 1] + ((prev + m) / 2) * h;
    y[i] = y[i - 1] + ((slope[i - 1] + slope[i]) / 2) * h;
    prev = m;
  }
  // a pinned left end: the turn there that brings the right end back onto its support
  const turn = c.left === "pinned" ? -y[STEPS] / L : 0;
  let deflection = 0;
  let at = 0;
  for (let i = 0; i <= STEPS; i++) {
    const d = -(y[i] + turn * i * h) / (E * I);
    if (d > deflection) [deflection, at] = [d, i * h];
  }
  return { rL, rR, mL, mR, vMax, mMax, stress: mMax / S, deflection, at };
}

// ---- the dialog -------------------------------------------------------------------------------

/** Each system's units for the fields and the answers, and what one of each is in SI. */
const SYSTEMS = {
  imperial: {
    length: ["ft", 0.3048],
    force: ["lb", 4.4482216152605],
    perLength: ["lb/ft", 4.4482216152605 / 0.3048],
    modulus: ["psi", 6894.757293168361],
    inertia: ["in⁴", 0.0254 ** 4],
    section: ["in³", 0.0254 ** 3],
    moment: ["lb·ft", 4.4482216152605 * 0.3048],
    stress: ["psi", 6894.757293168361],
    deflection: ["in", 0.0254],
  },
  metric: {
    length: ["m", 1],
    force: ["kN", 1e3],
    perLength: ["kN/m", 1e3],
    modulus: ["GPa", 1e9],
    inertia: ["cm⁴", 1e-8],
    section: ["cm³", 1e-6],
    moment: ["kN·m", 1e3],
    stress: ["MPa", 1e6],
    deflection: ["mm", 1e-3],
  },
} as const;

type System = keyof typeof SYSTEMS;

/** The beam drawn small: its supports and its load, the load at `share` of the length for one at any point. */
function preview(c: BeamCase, share: number): string {
  const [x0, x1, y] = [24, 216, 46];
  const at = (s: number): number => x0 + (x1 - x0) * s;
  const support = (x: number, end: End, left: boolean): string => {
    if (end === "free") return "";
    if (end === "fixed") {
      const o = left ? -1 : 1;
      const hatch = [0, 1, 2, 3, 4].map((i) => `M${x} ${y - 14 + i * 7}l${o * 6} 6`).join("");
      return `<path d="M${x} ${y - 16}v32${hatch}" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
    }
    const roller = !left ? `<circle cx="${x}" cy="${y + 13}" r="2.5" fill="none" stroke="currentColor"/>` : "";
    return `<path d="M${x} ${y + 1}l-6 10h12z" fill="none" stroke="currentColor" stroke-width="1.5"/>${roller}`;
  };
  const arrow = (x: number, top: number): string => `<path d="M${x} ${top}V${y - 3}M${x - 3} ${y - 8}l3 5 3-5" fill="none" stroke="currentColor" stroke-width="1.5"/>`;
  let load = "";
  if (c.load === "uniform") load = `<path d="M${x0} 22H${x1}" stroke="currentColor" stroke-width="1.5"/>` + Array.from({ length: 9 }, (_, i) => arrow(at(i / 8), 22)).join("");
  else if (c.load === "center") load = arrow(at(0.5), 10);
  else if (c.load === "end") load = arrow(x1, 10);
  else if (c.load === "point") load = arrow(at(share), 10);
  else load = arrow(at(share), 10) + arrow(at(1 - share), 10);
  return (
    `<svg class="beam-preview" viewBox="0 0 240 72" aria-hidden="true">` +
    `<path d="M${x0} ${y}H${x1}" stroke="currentColor" stroke-width="3"/>` +
    support(x0, c.left, true) +
    support(x1, c.right, false) +
    `<g class="load">${load}</g></svg>`
  );
}

const last = { kind: BEAM_CASES[0].key, system: "" as System | "", values: {} as Record<string, string> };

/** AEC > Framing > Simple Beam Calculator…: a beam's reactions, moments, shear, stress and deflection under its load. */
export async function simpleBeamDialog(): Promise<void> {
  const units = store.session?.doc.info.units ?? "";
  const kind = h("select", { cls: "menu-dialog-input menu-dialog-select calc-wide", attrs: { "aria-label": "Configuration" } }, ...BEAM_CASES.map((c) => h("option", { value: c.key, text: c.label })));
  kind.value = last.kind;
  const system = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Input Units" } },
    h("option", { value: "imperial", text: "Imperial" }),
    h("option", { value: "metric", text: "Metric (SI)" }),
  );
  system.value = last.system || (/feet|inch|yard|mile/i.test(units) ? "imperial" : "metric");
  const picture = h("div");
  const fields = {
    L: ["Beam Length (L)", "length"],
    P: ["Concentrated Load (P)", "force"],
    a: ["Dist. from end of beam (a)", "length"],
    w: ["Distributed Load (w)", "perLength"],
    E: ["Modulus of Elasticity", "modulus"],
    I: ["Moment of Inertia", "inertia"],
    S: ["Section Modulus", "section"],
  } as const;
  type Key = keyof typeof fields;
  const rows = {} as Record<Key, { row: HTMLElement; input: HTMLInputElement; unit: HTMLElement }>;
  for (const [k, [label]] of Object.entries(fields) as [Key, (typeof fields)[Key]][]) {
    const input = h("input", { cls: "menu-dialog-input", value: last.values[k] ?? "", attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
    const unit = h("span", { cls: "menu-dialog-unit" });
    rows[k] = { row: h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, unit), input, unit };
  }
  const holder = h("div", { cls: "props-holder" });
  const show = (lines: readonly (readonly [string, string])[] | string): void =>
    void holder.replaceChildren(
      typeof lines === "string" ? h("p", { cls: "muted", text: lines }) : h("dl", { cls: "props-list" }, ...lines.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
    );
  const solve = (): void => {
    const c = BEAM_CASES.find((x) => x.key === kind.value) ?? BEAM_CASES[0];
    const sys = SYSTEMS[system.value as System];
    rows.P.row.hidden = c.load === "uniform";
    rows.w.row.hidden = c.load !== "uniform";
    rows.a.row.hidden = c.load !== "point" && c.load !== "two";
    for (const [k, [, q]] of Object.entries(fields) as [Key, (typeof fields)[Key]][]) rows[k].unit.textContent = sys[q][0];
    const num = (k: Key): number => {
      const v = Number(rows[k].input.value.trim().replace(",", "."));
      return rows[k].input.value.trim() && Number.isFinite(v) ? v * sys[fields[k][1]][1] : NaN;
    };
    const b: BeamInput = { L: num("L"), P: num("P"), a: num("a"), w: num("w"), E: num("E"), I: num("I"), S: num("S") };
    picture.innerHTML = preview(c, b.a > 0 && b.L > b.a ? b.a / b.L : 0.3);
    const why = beamProblem(c, b);
    if (why) return show(why);
    const r = solveBeam(c, b);
    const v = (x: number, q: keyof typeof sys): string => `${numberText(x / sys[q][1])} ${sys[q][0]}`;
    show([
      ["Reaction at Left End (rL)", v(r.rL, "force")],
      ["Reaction at Right End (rR)", v(r.rR, "force")],
      ["Moment at Left End (mL)", v(r.mL, "moment")],
      ["Moment at Right End (mR)", v(r.mR, "moment")],
      ["Max. Shear (vMax)", v(r.vMax, "force")],
      ["Max. Bending Moment (mMax)", v(r.mMax, "moment")],
      ["Max. Bending Stress (mMax/S)", v(r.stress, "stress")],
      ["Max. Deflection", v(r.deflection, "deflection")],
      ["at x (from left end)", v(r.at, "length")],
    ]);
  };
  kind.addEventListener("input", solve);
  system.addEventListener("input", solve);
  for (const k of Object.keys(fields) as Key[]) rows[k].input.addEventListener("input", solve);
  solve();
  const field = (label: string, control: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
  await showDialog<true>({
    title: "Simple Beam Calculator",
    okLabel: "Close",
    cls: "props-dialog",
    body: [
      field("Configuration", kind),
      picture,
      field("Input Units", system),
      ...(Object.keys(fields) as Key[]).map((k) => rows[k].row),
      h("p", {
        cls: "muted",
        text:
          "A propped cantilever is fixed at its left end and rests on a support at its right; a cantilever is fixed at its left end. Loads act downward, " +
          "and a load at any point lies its distance from the left end. End moments are given as their size; the stress is the bending stress, the greatest moment over the section modulus.",
      }),
      holder,
    ],
    check: () => ({ value: true }),
  });
  last.kind = kind.value;
  last.system = system.value as System;
  last.values = Object.fromEntries((Object.keys(fields) as Key[]).map((k) => [k, rows[k].input.value]));
}
