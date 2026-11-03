// Checks of Parking Spaces' plan: run with `npx tsx src/app/parkingSpaces.check.ts` from web/.

import { parkingSpaces, parkingSpacesSolid, type ParkingSpaces, type ParkingSpacesPlan } from "./parkingShapes.ts";

let failures = 0;
function near(got: number, want: number, tol: number, what: string): void {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? "ok  " : "FAIL"} ${what} ${got.toFixed(1)} ${want.toFixed(1)}`);
  if (!ok) failures++;
}

const base: ParkingSpaces = {
  style: "single",
  count: 5,
  width: 2500,
  length: 5000,
  angle: 90,
  angledHeader: false,
  accessible: 0,
  accessibleWidth: 3600,
  accessibleAtEnd: false,
  accessibleSymbol: true,
  aisles: false,
  aisleWidth: 1500,
  aisleSide: "right",
  aisleFill: "stripes",
  header: true,
  startStripe: true,
  endStripe: true,
  numbering: true,
  startAt: 1,
  bumpers: true,
};
const plan = (p: Partial<ParkingSpaces>): ParkingSpacesPlan => {
  const made = parkingSpaces({ ...base, ...p });
  if (typeof made === "string") throw new Error(made);
  return made;
};
const pts = (lines: readonly (readonly { x: number; y: number }[])[]) => lines.flat();
const xs = (lines: readonly (readonly { x: number; y: number }[])[]) => pts(lines).map((q) => q.x);
const ys = (lines: readonly (readonly { x: number; y: number }[])[]) => pts(lines).map((q) => q.y);

const single = plan({});
near(single.stripes.length, 7, 0, "single: a header and six dividers");
near(Math.max(...xs(single.stripes)), 12500, 1e-6, "single: five widths long");
near(Math.min(...ys(single.stripes)), -5000, 1e-6, "single: a length deep, below the header");
near(single.stalls, 5, 0, "single: five stalls");
near(single.bumpers.length, 5, 0, "a bumper each");

const noStart = plan({ startStripe: false, endStripe: false, header: false });
near(noStart.stripes.length, 4, 0, "no header, start or end stripe: the four between");

const double = plan({ style: "double", angledHeader: false });
near(double.stripes.length, 13, 0, "double: one header and twelve dividers");
near(double.stalls, 10, 0, "double: five a row");
near(Math.max(...ys(double.stripes)), 5000, 1e-6, "double: its upper row above");
near(+double.numbers[0].text, 1, 0, "the upper row's first number first");
near(double.numbers[0].at.y > 0 ? 1 : 0, 1, 0, "and it's above");
near(double.numbers[5].at.y < 0 ? 1 : 0, 1, 0, "the lower row comes after");

const lean = plan({ angle: 60 });
near(Math.max(...xs(lean.stripes)), (5 * 2500) / Math.sin(Math.PI / 3) + 5000 * Math.cos(Math.PI / 3), 1e-6, "at 60°, wider by its widths and its lean");
near(Math.min(...ys(lean.stripes)), -5000 * Math.sin(Math.PI / 3), 1e-6, "at 60°, as deep as its length reaches");
near(Math.max(...ys(lean.bumpers)) < 0 ? 1 : 0, 1, 0, "bumpers clear of a straight header");

const angled = plan({ angle: 45, angledHeader: true });
near(Math.max(...ys(angled.stripes)), 2500 * Math.cos(Math.PI / 4), 1e-6, "angled: its teeth rise by a width's lean");
near(angled.stripes[0].length, 10, 0, "angled: the header zigzags, two points a stall");
const angledDouble = plan({ angle: 45, angledHeader: true, style: "double" });
near(angledDouble.stripes.slice(1, 2).flat().every((q) => q.y <= 1e-6) ? 1 : 0, 1, 0, "angled double: a row's teeth stop at the middle");

const access = plan({ accessible: 2, aisles: true, aisleSide: "both", numbering: true });
near(access.aisles.length, 4, 0, "two accessible spaces, an aisle each side");
near(access.stalls, 7, 0, "aisles aren't stalls");
near(access.symbols.length, 8, 0, "four pieces to a symbol");
near(Math.max(...xs(access.stripes)), 5 * 2500 + 2 * 3600 + 4 * 1500, 1e-6, "as wide as all its cells");
near(access.hatch.length > 0 ? 1 : 0, 1, 0, "striped aisles");
near(plan({ accessible: 1, aisles: true, aisleFill: "solid" }).hatch.length, 0, 0, "a solid aisle has no stripes");

const parallel = plan({ style: "parallel", accessible: 1, numbering: false });
near(Math.max(...xs(parallel.stripes)), 6 * 5000, 1e-6, "parallel: Length along the curb");
near(Math.min(...ys(parallel.stripes)), -3600, 1e-6, "parallel: Width out from it, an accessible one's wider");
near(parallel.bumpers.length, 0, 0, "parallel: no bumpers");
near(parallel.numbers.length, 0, 0, "numbers off");

near(typeof parkingSpaces({ ...base, count: 0 }) === "string" ? 1 : 0, 1, 0, "no spaces refused");
near(typeof parkingSpaces({ ...base, angle: 0 }) === "string" ? 1 : 0, 1, 0, "no angle refused");
near(typeof parkingSpaces({ ...base, count: 5000 }) === "string" ? 1 : 0, 1, 0, "too many refused");

near(parkingSpacesSolid(single, 100).length, (7 + 5) * 8, 0, "3D: a prism of two triangles an end and four sides, for a stripe and a bumper");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
