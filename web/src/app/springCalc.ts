// AEC > Machine Design > Spring Calculator's sums (the dialog is in calculators.ts): a round-wire helical
// compression spring's diameters, coils and solid height from the three a method gives, its spring rate
// G·d⁴ / (8·D³·n) and its unit stress 8·D / (π·d³), the shear stress one unit of load makes, uncorrected as
// Vectorworks gives it; the spring index and Wahl factor besides. The ends count the coils as the Compression
// Spring tools do (springShapes.ts). Lengths in mm, the modulus in N/mm² (MPa). Pure.

import { activeFromSolid, compressionCoils, MAX_COILS, type SpringEnds } from "./springShapes.ts";

/** What is known: a diameter (outside or mean), the wire, and the coils (by solid height or as a count). */
export type SpringMethod = "outsideSolid" | "meanActive" | "outsideActive" | "meanSolid";

export const SPRING_METHODS: readonly { readonly key: SpringMethod; readonly label: string }[] = [
  { key: "outsideSolid", label: "1 - Outside Dia., Wire Dia., Solid Height" },
  { key: "meanActive", label: "2 - Mean Dia., Wire Dia., No. of Active Coils" },
  { key: "outsideActive", label: "3 - Outside Dia., Wire Dia., No. of Active Coils" },
  { key: "meanSolid", label: "4 - Mean Dia., Wire Dia., Solid Height" },
];

/** The ends as Vectorworks' Spring Calculator names them, and as the spring tools draw them. */
export const SPRING_CALC_ENDS: readonly { readonly value: SpringEnds; readonly label: string }[] = [
  { value: "squaredground", label: "Closed and Ground" },
  { value: "plainground", label: "Open and Ground" },
  { value: "squared", label: "Closed" },
  { value: "plain", label: "Open" },
];

const PSI_PER_MPA = 1 / 0.006894757;

/**
 * Spring wire and its shear modulus G, from Shigley's table of spring wire (Mpsi), music and hard-drawn wire
 * by gauge in inches. A modulus typed in the dialog stands instead.
 */
export const SPRING_MATERIALS: readonly { readonly name: string; readonly mpsi: number }[] = [
  { name: 'Music Wire - Up to 0.032" (0.81 mm)', mpsi: 11.85 },
  { name: 'Music Wire - 0.033" to 0.063" (0.84 to 1.6 mm)', mpsi: 11.75 },
  { name: 'Music Wire - Over 0.063" (1.6 mm)', mpsi: 11.6 },
  { name: 'Hard Drawn - Up to 0.032" (0.81 mm)', mpsi: 11.7 },
  { name: 'Hard Drawn - 0.033" to 0.063" (0.84 to 1.6 mm)', mpsi: 11.6 },
  { name: 'Hard Drawn - 0.064" to 0.125" (1.63 to 3.18 mm)', mpsi: 11.5 },
  { name: 'Hard Drawn - Over 0.125" (3.18 mm)', mpsi: 11.4 },
  { name: "Oil Tempered", mpsi: 11.2 },
  { name: "Chrome Vanadium", mpsi: 11.2 },
  { name: "Chrome Silicon", mpsi: 11.2 },
  { name: "Stainless Steel 302", mpsi: 10.0 },
  { name: "Phosphor Bronze", mpsi: 6.0 },
  { name: "Beryllium Copper", mpsi: 7.0 },
];

/** A modulus in psi as N/mm², and back. */
export const mpaOfPsi = (psi: number): number => psi / PSI_PER_MPA;
export const psiOfMpa = (mpa: number): number => mpa * PSI_PER_MPA;

/** A spring rate in N/mm as lb/in, and a unit stress in (N/mm²)/N as (lb/in²)/lb. */
export const LB_IN_PER_N_MM = 25.4 / 4.4482216152605;
export const PSI_LB_PER_MPA_N = 25.4 * 25.4;

export interface SpringKnown {
  readonly method: SpringMethod;
  readonly ends: SpringEnds;
  /** the outside or mean diameter, as the method says */
  readonly diameter: number;
  readonly wire: number;
  /** the solid height or the number of active coils, as the method says */
  readonly coils: number;
  /** shear modulus, N/mm² */
  readonly g: number;
}

export interface Spring {
  readonly outside: number;
  readonly mean: number;
  readonly wire: number;
  readonly solid: number;
  readonly active: number;
  readonly total: number;
  /** N/mm */
  readonly rate: number;
  /** (N/mm²) per N of load */
  readonly unitStress: number;
  /** mean diameter over wire diameter */
  readonly index: number;
  /** Wahl's factor for the stress the coils' curvature adds */
  readonly wahl: number;
}

/** The spring the known values make, or why they make none. */
export function solveSpring(k: SpringKnown): Spring | string {
  const d = k.wire;
  if (!(d > 0)) return "Enter the wire diameter.";
  const byOutside = k.method === "outsideSolid" || k.method === "outsideActive";
  if (!(k.diameter > 0)) return `Enter the ${byOutside ? "outside" : "mean"} diameter.`;
  const mean = byOutside ? k.diameter - d : k.diameter;
  if (!(mean > d)) return "The wire is too thick for the spring's diameter.";
  const bySolid = k.method === "outsideSolid" || k.method === "meanSolid";
  if (!(k.coils > 0)) return bySolid ? "Enter the solid height." : "Enter the number of active coils.";
  const active = bySolid ? activeFromSolid(k.ends, k.coils, d) : k.coils;
  if (!(active > 0)) return "The solid height leaves no active coils: it must be more than the end coils' height.";
  const { total, solid } = compressionCoils(k.ends, active, d);
  if (total > MAX_COILS) return `A spring has at most ${MAX_COILS} coils.`;
  if (!(k.g > 0)) return "Enter the material's modulus.";
  const index = mean / d;
  return {
    outside: mean + d,
    mean,
    wire: d,
    solid: bySolid ? k.coils : solid,
    active,
    total,
    rate: (k.g * d ** 4) / (8 * mean ** 3 * active),
    unitStress: (8 * mean) / (Math.PI * d ** 3),
    index,
    wahl: (4 * index - 1) / (4 * index - 4) + 0.615 / index,
  };
}
