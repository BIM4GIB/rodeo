// AEC > Electrical > Conductor Sizing Calc…, Vectorworks' Conductor Sizing Calculator: one of a
// conductor's wire size, resistivity, voltage drop, phase factor, voltage, current or length,
// worked out from the rest by the voltage drop formula VD = PF × K × I × L / CM (K the material's
// resistivity in ohm-circular mils per foot at the temperature, from its value at 75 °C and its
// temperature coefficient alpha; L the one-way run in feet; CM the wire's area in circular mils).
// It works its answer out as values are typed, so Vectorworks' Calculate button has nothing left
// to do. The wire list is copper and aluminum by AWG and kcmil, their areas by the AWG formula;
// Vectorworks' wire specification database (manufacturers and part numbers) isn't here. Ampacity
// is the current at which the run drops the voltage given, not an ampacity table's rating.

import { h } from "./dom.ts";
import { numberText } from "./engineeringProperties.ts";
import { showDialog } from "./menubar.ts";
import "./calculators.css";

/** What the calculator works out, as Vectorworks lists them. */
export const CONDUCTOR_CALCS = [
  ["size", "Wire Size"],
  ["k", "Ohms/ft/cmil-ft"],
  ["drop", "Voltage Drop"],
  ["phase", "Phase Factor"],
  ["voltage", "Voltage"],
  ["amps", "Ampacity"],
  ["length", "Length of Run"],
] as const;
export type ConductorCalc = (typeof CONDUCTOR_CALCS)[number][0];

/** Resistivity at 75 °C (ohm-cmil/ft) and temperature coefficient (per °C, from 75 °C) of the two conductor materials. */
export const MATERIALS = {
  copper: { k75: 12.9, alpha: 0.00323 },
  aluminum: { k75: 21.2, alpha: 0.0033 },
} as const;

/** A wire of AWG gauge `n` (0 for 1/0, -1 for 2/0 and so on): its area in circular mils, by the AWG formula. */
export function awgCmil(n: number): number {
  return (5 * 92 ** ((36 - n) / 39)) ** 2;
}

/** The AWG gauge nearest a wire of `cmil` circular mils, as Vectorworks names it ("1/0" for 0 and so on). */
export function approxAwg(cmil: number): string {
  const n = Math.round(36 - 39 * Math.log(Math.sqrt(cmil) / 5) / Math.log(92));
  return n <= 0 ? `${1 - n}/0` : String(n);
}

/** The wire sizes listed: AWG 18 to 4/0, then 250 to 1000 kcmil. */
export const WIRE_SIZES: readonly { readonly label: string; readonly cmil: number }[] = [
  ...[18, 16, 14, 12, 10, 8, 6, 4, 3, 2, 1, 0, -1, -2, -3].map((n) => ({ label: `${n <= 0 ? `${1 - n}/0` : n} AWG`, cmil: Math.round(awgCmil(n)) })),
  ...[250, 300, 350, 400, 500, 600, 700, 750, 800, 900, 1000].map((k) => ({ label: `${k} kcmil`, cmil: k * 1000 })),
];

/** A conductor's values: K the resistivity at the temperature (ohm-cmil/ft), cm its area (cmil), drop the voltage drop (V). */
export interface Conductor {
  phase: number;
  k: number;
  cm: number;
  amps: number;
  length: number;
  drop: number;
  voltage: number;
}

/** The resistivity at `t` °C, from its value at 75 °C and the temperature coefficient. */
export function kAt(k75: number, alpha: number, t: number): number {
  return k75 * (1 + alpha * (t - 75));
}

/**
 * The value `calc` asks for, from the others in `v` (each of which it needs set and more than 0):
 * the voltage drop formula solved for it. Voltage needs the drop as a share of it (`pct`).
 */
export function solveConductor(calc: ConductorCalc, v: Partial<Conductor>, pct?: number): number | null {
  const { phase = NaN, k = NaN, cm = NaN, amps = NaN, length = NaN, drop = NaN } = v;
  const r =
    calc === "size"
      ? (phase * k * amps * length) / drop
      : calc === "k"
        ? (drop * cm) / (phase * amps * length)
        : calc === "drop"
          ? (phase * k * amps * length) / cm
          : calc === "phase"
            ? (drop * cm) / (k * amps * length)
            : calc === "voltage"
              ? (((phase * k * amps * length) / cm) * 100) / (pct ?? NaN)
              : calc === "amps"
                ? (drop * cm) / (phase * k * length)
                : (drop * cm) / (phase * k * amps);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/** Remembered between openings, as Vectorworks keeps a calculator's last values. */
const last = {
  calc: "size" as ConductorCalc,
  phase: "2",
  material: "copper" as keyof typeof MATERIALS,
  size: String(WIRE_SIZES[3].cmil),
  cmil: "",
  k75: String(MATERIALS.copper.k75),
  alpha: String(MATERIALS.copper.alpha),
  temp: "75",
  amps: "",
  length: "",
  dropBy: "pct",
  drop: "3",
  voltage: "",
};

/** AEC > Electrical > Conductor Sizing Calc…: a conductor's wire size, resistivity, voltage drop, phase factor, voltage, current or run length from the rest. */
export async function conductorSizingDialog(): Promise<void> {
  const input = (label: string, value: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const select = (label: string, options: readonly (readonly [string, string])[]): HTMLSelectElement =>
    h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map(([value, text]) => h("option", { value, text })));
  const field = (label: string, ...control: Node[]): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
  const calc = select("Calculate", CONDUCTOR_CALCS);
  calc.value = last.calc;
  const phase = input("Phase Factor", last.phase);
  const material = select("Type", [
    ["copper", "Copper"],
    ["aluminum", "Aluminum"],
  ]);
  material.value = last.material;
  const size = select("Size", [...WIRE_SIZES.map((w): [string, string] => [String(w.cmil), w.label]), ["other", "Other"]]);
  size.value = last.size;
  const cmil = input("Sectional area of the wire, cmil", last.cmil);
  const k75 = input("Resistance of conductor material at 75c", last.k75);
  const alpha = input("Alpha", last.alpha);
  const temp = input("Temperature (c)", last.temp);
  const amps = input("Amps", last.amps);
  const length = input("Length (ft.)", last.length);
  const dropBy = select("Voltage Drop", [
    ["pct", "Percentage"],
    ["abs", "Absolute"],
  ]);
  dropBy.value = last.dropBy;
  const drop = input("Voltage Drop value", last.drop);
  const voltage = input("Voltage", last.voltage);
  const holder = h("div", { cls: "props-holder" });
  const num = (el: HTMLInputElement): number => (el.value.trim() ? Number(el.value.trim().replace(",", ".")) : NaN);
  // a new material brings its own resistivity and alpha
  material.addEventListener("input", () => {
    const m = MATERIALS[material.value as keyof typeof MATERIALS];
    k75.value = String(m.k75);
    alpha.value = String(m.alpha);
  });
  // a listed size shows its area; Other leaves the area to be typed
  size.addEventListener("input", () => {
    if (size.value !== "other") cmil.value = size.value;
  });
  if (size.value !== "other") cmil.value = size.value;
  // and a typed area picks its size, or Other
  cmil.addEventListener("input", () => {
    size.value = WIRE_SIZES.some((w) => String(w.cmil) === cmil.value.trim()) ? cmil.value.trim() : "other";
  });
  // leaving Wire Size, the area goes back to the size it chose
  calc.addEventListener("input", () => {
    if (calc.value !== "size" && size.value !== "other") cmil.value = size.value;
  });
  const solve = (): void => {
    const c = calc.value as ConductorCalc;
    // the field the answer goes in is greyed, as in Vectorworks
    const target: Partial<Record<ConductorCalc, HTMLInputElement>> = { size: cmil, k: k75, phase, voltage, amps, length, drop };
    for (const el of [cmil, k75, phase, voltage, amps, length, drop]) el.disabled = el === target[c];
    size.disabled = c === "size";
    const pct = dropBy.value === "pct";
    const kt = kAt(num(k75), num(alpha) || 0, Number.isFinite(num(temp)) ? num(temp) : 75);
    const v: Partial<Conductor> = { phase: num(phase), k: kt, cm: num(cmil), amps: num(amps), length: num(length), voltage: num(voltage) };
    // the drop in volts: a percentage of the voltage, or as typed
    v.drop = pct ? (num(drop) / 100) * num(voltage) : num(drop);
    if (c === "voltage" && !pct) return void holder.replaceChildren(h("p", { cls: "muted", text: "Voltage needs the Voltage Drop as a Percentage of it." }));
    const r = solveConductor(c, v, pct ? num(drop) : undefined);
    if (r === null) return void holder.replaceChildren(h("p", { cls: "muted", text: "Enter the values the calculation needs, each more than 0." }));
    const rows: [string, string][] = [];
    if (c === "size") {
      cmil.value = numberText(Math.round(r));
      // a hair of slack, so an area typed back from a rounded answer still fits its own size
      const listed = WIRE_SIZES.find((w) => w.cmil >= r * (1 - 1e-4));
      rows.push(["Sectional area of the wire", `${numberText(Math.round(r))} cmil`]);
      if (r < 250000) rows.push(["Approximate AWG", approxAwg(r)]);
      rows.push(["Next size up", listed ? listed.label : "larger than 1000 kcmil"]);
      size.value = listed ? String(listed.cmil) : "other";
    } else if (c === "k") {
      // the 75 °C value, as the field holds
      const at75 = r / (1 + (num(alpha) || 0) * ((Number.isFinite(num(temp)) ? num(temp) : 75) - 75));
      k75.value = numberText(at75);
      rows.push(["Ohms/ft/cmil-ft at the temperature", numberText(r)], ["at 75 °C", numberText(at75)]);
    } else if (c === "drop") {
      drop.value = numberText(pct ? (r / num(voltage)) * 100 : r);
      rows.push(["Voltage Drop", `${numberText(r)} V`]);
      if (Number.isFinite(num(voltage)) && num(voltage) > 0) rows.push(["Percentage of the voltage", `${numberText((r / num(voltage)) * 100)}%`]);
    } else {
      const el = target[c]!;
      el.value = numberText(r);
      const unit = c === "voltage" ? " V" : c === "amps" ? " A" : c === "length" ? " ft" : "";
      rows.push([CONDUCTOR_CALCS.find(([id]) => id === c)![1], `${numberText(r)}${unit}`]);
    }
    holder.replaceChildren(h("dl", { cls: "props-list" }, ...rows.flatMap(([k, val]) => [h("dt", { text: k }), h("dd", { text: val })])));
  };
  for (const el of [calc, phase, material, size, cmil, k75, alpha, temp, amps, length, dropBy, drop, voltage]) el.addEventListener("input", solve);
  solve();
  await showDialog<boolean>({
    title: "Conductor Sizing Calculator",
    okLabel: "Close",
    cls: "props-dialog",
    body: [
      field("Calculate", calc),
      field("Phase Factor", phase),
      h("p", { cls: "muted", text: "2 for a single-phase run, 1.732 (√3) for three-phase." }),
      field("Type", material),
      field("Size", size),
      field("Sectional area, cmil", cmil),
      field("Resistance at 75 °C", k75),
      field("Alpha", alpha),
      field("Temperature (°C)", temp),
      field("Amps", amps),
      field("Length (ft.)", length),
      field("Voltage Drop", dropBy, drop),
      field("Voltage", voltage),
      holder,
    ],
    check: () => ({ value: true }),
  });
  Object.assign(last, {
    calc: calc.value,
    phase: phase.value,
    material: material.value,
    size: size.value,
    cmil: cmil.value,
    k75: k75.value,
    alpha: alpha.value,
    temp: temp.value,
    amps: amps.value,
    length: length.value,
    dropBy: dropBy.value,
    drop: drop.value,
    voltage: voltage.value,
  });
}
