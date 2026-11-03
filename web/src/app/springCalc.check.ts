// npx tsx src/app/springCalc.check.ts
import { LB_IN_PER_N_MM, mpaOfPsi, psiOfMpa, PSI_LB_PER_MPA_N, solveSpring, type Spring, type SpringKnown } from "./springCalc.ts";

let failed = 0;
const ok = (cond: boolean, what: string): void => {
  if (!cond) {
    failed++;
    console.log("FAIL", what);
  }
};
const near = (a: number, b: number, tol: number): boolean => Math.abs(a - b) <= tol;
const IN = 25.4;
const solve = (k: Partial<SpringKnown>): Spring => {
  const r = solveSpring({ method: "outsideSolid", ends: "squaredground", diameter: 0.97 * IN, wire: 0.09 * IN, coils: 1.634 * IN, g: mpaOfPsi(12e6), ...k });
  if (typeof r === "string") throw new Error(r);
  return r;
};

// Vectorworks' example, music wire at 12,000,000 psi with closed and ground ends
{
  // method 1: outside 0.970", wire 0.09", solid height 1.634": 16.2 active coils, 8.939 lb/in, 3074 (lb/in²)/lb
  const s = solve({});
  ok(near(s.mean / IN, 0.88, 1e-9), `mean diameter ${s.mean / IN}`);
  ok(near(s.active, 16.156, 0.001) && near(s.total, 18.156, 0.001), `active coils ${s.active}`);
  ok(near(s.rate * LB_IN_PER_N_MM, 8.939, 0.001), `spring rate ${s.rate * LB_IN_PER_N_MM} lb/in`);
  ok(near(s.unitStress * PSI_LB_PER_MPA_N, 3074, 0.5), `unit stress ${s.unitStress * PSI_LB_PER_MPA_N}`);
  // method 2: mean 0.880", wire 0.09", 9 active coils: solid height 0.990", 16.05 lb/in
  const t = solve({ method: "meanActive", diameter: 0.88 * IN, coils: 9 });
  ok(near(t.solid / IN, 0.99, 1e-9) && near(t.outside / IN, 0.97, 1e-9), `solid height ${t.solid / IN}`);
  ok(near(t.rate * LB_IN_PER_N_MM, 16.05, 0.005), `spring rate ${t.rate * LB_IN_PER_N_MM} lb/in`);
}

// the other methods, and each end type's coils
{
  const a = solve({ method: "outsideActive", diameter: 0.97 * IN, coils: 9 });
  const b = solve({ method: "meanSolid", diameter: 0.88 * IN, coils: 0.99 * IN });
  ok(near(a.rate, b.rate, 1e-9) && near(b.active, 9, 1e-9), `outside and coils, mean and solid height agree: ${a.rate} ${b.rate} ${b.active}`);
  const ends = (e: SpringKnown["ends"]) => solve({ method: "meanActive", ends: e, diameter: 20, wire: 2, coils: 8 });
  ok(ends("squaredground").solid === 20 && ends("squared").solid === 22 && ends("plainground").solid === 18 && ends("plain").solid === 18, "solid heights by ends: (n+2)d, (n+3)d, (n+1)d, (n+1)d");
  ok(ends("plain").total === 8 && ends("plainground").total === 9 && ends("squared").total === 10, "total coils by ends");
  const s = ends("squaredground");
  ok(near(s.index, 10, 1e-12) && near(s.wahl, 39 / 36 + 0.615 / 10, 1e-12), `index and Wahl factor: ${s.index} ${s.wahl}`);
}

// what makes no spring, and the units
{
  const err = (k: Partial<SpringKnown>) => solveSpring({ method: "outsideSolid", ends: "squaredground", diameter: 25, wire: 2, coils: 30, g: 80000, ...k });
  ok(err({ wire: 0 }) === "Enter the wire diameter.", "no wire");
  ok(err({ diameter: 4 }) === "The wire is too thick for the spring's diameter.", "too thick");
  ok(/no active coils/.test(String(err({ coils: 3 }))), "solid height too low");
  ok(err({ method: "meanActive", coils: 0 }) === "Enter the number of active coils.", "no coils");
  ok(/at most 400/.test(String(err({ method: "meanActive", coils: 500 }))), "too many coils");
  ok(err({ g: 0 }) === "Enter the material's modulus.", "no modulus");
  ok(near(psiOfMpa(mpaOfPsi(11.5e6)), 11.5e6, 1e-6) && near(mpaOfPsi(11.5e6), 79290, 1), `psi and MPa: ${mpaOfPsi(11.5e6)}`);
}

console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
