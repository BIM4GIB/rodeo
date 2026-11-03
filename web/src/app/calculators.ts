// AEC > Machine Design's calculators, as Vectorworks has them: Belt Length Calculator, Chain Length
// Calculator, Conversion Factors, Solution of Triangles and Spring Calculator (its sums in
// springCalc.ts). Each works its answer out as values are typed, so Vectorworks' Solve button has
// nothing left to do. Lengths are in the document's units (typed as the Object Info palette takes
// them), the Spring Calculator's in the inches or millimetres it is set to. Left blank, the center
// distance of a belt or chain is the least one: the pulleys' pitch circles touching, the sprockets'
// tips touching. The belt and chain calculators can place their data as text where the drawing is
// clicked next; drawing the chain and sprockets themselves is the Sprocket and Roller Chain tools'
// work, and the Spring Calculator hands its spring to the Compression Spring 2 tools to place.

import { CHAINS, MAX_SPROCKET_TEETH, MIN_SPROCKET_TEETH, sprocketPitchDiameter, sprocketTipDiameter, type ChainSize } from "./chainShapes.ts";
import { h } from "./dom.ts";
import { checkRow, numberText, placeTextAtClick } from "./engineeringProperties.ts";
import { appContext } from "./ext.ts";
import { showDialog } from "./menubar.ts";
import { LB_IN_PER_N_MM, mpaOfPsi, psiOfMpa, PSI_LB_PER_MPA_N, solveSpring, SPRING_CALC_ENDS, SPRING_MATERIALS, SPRING_METHODS, type Spring, type SpringMethod } from "./springCalc.ts";
import { handSpring } from "./springHandoff.ts";
import type { SpringEnds } from "./springShapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatArea, formatLength, millimetresPerUnit, parseLength } from "./units.ts";
import "./calculators.css";

// ---- belts ------------------------------------------------------------------------------------

/** An open belt's length round pulleys of pitch diameters d1 and d2 with their centres c apart. */
export function beltLength(d1: number, d2: number, c: number): number {
  return 2 * c + (Math.PI * (d1 + d2)) / 2 + (d1 - d2) ** 2 / (4 * c);
}

/** The center distance at which an open belt of `length` fits pulleys d1 and d2, or null when it is too short to go round them apart. */
export function beltCenter(d1: number, d2: number, length: number): number | null {
  const b = length - (Math.PI * (d1 + d2)) / 2;
  const disc = b * b - 2 * (d1 - d2) ** 2;
  if (!(b > 0) || disc < 0) return null;
  const c = (b + Math.sqrt(disc)) / 4;
  return c >= beltMinCenter(d1, d2) ? c : null;
}

/** The least center distance: the pitch circles touching. */
export function beltMinCenter(d1: number, d2: number): number {
  return (d1 + d2) / 2;
}

// ---- chains -----------------------------------------------------------------------------------

/** A roller chain's length in pitches round sprockets of n1 and n2 teeth with their centres c apart (c in mm). */
export function chainPitches(chain: ChainSize, n1: number, n2: number, c: number): number {
  const cp = c / chain.pitch;
  return 2 * cp + (n1 + n2) / 2 + (n2 - n1) ** 2 / (4 * Math.PI * Math.PI * cp);
}

/** The center distance (mm) at which a chain `pitches` long fits sprockets n1 and n2, or null when it is too short to go round them apart. */
export function chainCenter(chain: ChainSize, n1: number, n2: number, pitches: number): number | null {
  const b = pitches - (n1 + n2) / 2;
  const disc = b * b - 8 * ((n2 - n1) / (2 * Math.PI)) ** 2;
  if (!(b > 0) || disc < 0) return null;
  const c = (chain.pitch / 4) * (b + Math.sqrt(disc));
  return c >= chainMinCenter(chain, n1, n2) ? c : null;
}

/** The least center distance (mm): the sprockets' tips touching. */
export function chainMinCenter(chain: ChainSize, n1: number, n2: number): number {
  return (sprocketTipDiameter(chain, n1) + sprocketTipDiameter(chain, n2)) / 2;
}

// ---- conversion factors -----------------------------------------------------------------------

/** A unit of a quantity: its name and how many of the quantity's base unit one of it is. */
interface FactorUnit {
  readonly name: string;
  readonly base: number;
}

const FT = 0.3048;
const IN = 0.0254;
const LB = 0.45359237;
const G0 = 9.80665;
const LBF = LB * G0;

/** The quantities and units Conversion Factors knows, each unit in the quantity's SI unit (exact where the unit is defined exactly). */
export const QUANTITIES: readonly { readonly name: string; readonly units: readonly FactorUnit[] }[] = [
  {
    name: "Length",
    units: [
      { name: "micrometers", base: 1e-6 },
      { name: "millimeters", base: 1e-3 },
      { name: "centimeters", base: 1e-2 },
      { name: "meters", base: 1 },
      { name: "kilometers", base: 1e3 },
      { name: "mils", base: IN / 1000 },
      { name: "inches", base: IN },
      { name: "feet", base: FT },
      { name: "yards", base: 3 * FT },
      { name: "miles", base: 5280 * FT },
      { name: "nautical miles", base: 1852 },
    ],
  },
  {
    name: "Area",
    units: [
      { name: "square millimeters", base: 1e-6 },
      { name: "square centimeters", base: 1e-4 },
      { name: "square meters", base: 1 },
      { name: "hectares", base: 1e4 },
      { name: "square kilometers", base: 1e6 },
      { name: "square inches", base: IN * IN },
      { name: "square feet", base: FT * FT },
      { name: "square yards", base: 9 * FT * FT },
      { name: "acres", base: 43560 * FT * FT },
      { name: "square miles", base: (5280 * FT) ** 2 },
    ],
  },
  {
    name: "Volume",
    units: [
      { name: "cubic millimeters", base: 1e-9 },
      { name: "cubic centimeters", base: 1e-6 },
      { name: "liters", base: 1e-3 },
      { name: "cubic meters", base: 1 },
      { name: "cubic inches", base: IN ** 3 },
      { name: "cubic feet", base: FT ** 3 },
      { name: "cubic yards", base: 27 * FT ** 3 },
      { name: "US fluid ounces", base: (231 * IN ** 3) / 128 },
      { name: "US gallons", base: 231 * IN ** 3 },
      { name: "imperial gallons", base: 4.54609e-3 },
    ],
  },
  {
    name: "Mass",
    units: [
      { name: "grams", base: 1e-3 },
      { name: "kilograms", base: 1 },
      { name: "metric tons", base: 1e3 },
      { name: "ounces", base: LB / 16 },
      { name: "pounds", base: LB },
      { name: "short tons", base: 2000 * LB },
      { name: "long tons", base: 2240 * LB },
    ],
  },
  {
    name: "Force",
    units: [
      { name: "newtons", base: 1 },
      { name: "kilonewtons", base: 1e3 },
      { name: "kilograms-force", base: G0 },
      { name: "pounds-force", base: LBF },
      { name: "kips", base: 1000 * LBF },
    ],
  },
  {
    name: "Pressure and stress",
    units: [
      { name: "pascals", base: 1 },
      { name: "kilopascals", base: 1e3 },
      { name: "megapascals (N/mm²)", base: 1e6 },
      { name: "gigapascals", base: 1e9 },
      { name: "bars", base: 1e5 },
      { name: "atmospheres", base: 101325 },
      { name: "kilograms-force per cm²", base: G0 * 1e4 },
      { name: "pounds per square foot", base: LBF / (FT * FT) },
      { name: "pounds per square inch", base: LBF / (IN * IN) },
      { name: "kips per square inch", base: (1000 * LBF) / (IN * IN) },
    ],
  },
  {
    name: "Energy",
    units: [
      { name: "joules", base: 1 },
      { name: "kilojoules", base: 1e3 },
      { name: "watt-hours", base: 3600 },
      { name: "kilowatt-hours", base: 3.6e6 },
      { name: "calories", base: 4.184 },
      { name: "kilocalories", base: 4184 },
      { name: "British thermal units", base: 1055.05585262 },
      { name: "foot-pounds", base: LBF * FT },
    ],
  },
  {
    name: "Power",
    units: [
      { name: "watts", base: 1 },
      { name: "kilowatts", base: 1e3 },
      { name: "horsepower", base: 550 * LBF * FT },
      { name: "metric horsepower", base: 75 * G0 },
      { name: "BTU per hour", base: 1055.05585262 / 3600 },
      { name: "foot-pounds per second", base: LBF * FT },
    ],
  },
  {
    name: "Torque",
    units: [
      { name: "newton-meters", base: 1 },
      { name: "kilonewton-meters", base: 1e3 },
      { name: "kilogram-force meters", base: G0 },
      { name: "pound-force inches", base: LBF * IN },
      { name: "pound-force feet", base: LBF * FT },
    ],
  },
  {
    name: "Velocity",
    units: [
      { name: "meters per second", base: 1 },
      { name: "kilometers per hour", base: 1 / 3.6 },
      { name: "feet per minute", base: FT / 60 },
      { name: "feet per second", base: FT },
      { name: "miles per hour", base: (5280 * FT) / 3600 },
      { name: "knots", base: 1852 / 3600 },
    ],
  },
  {
    name: "Angle",
    units: [
      { name: "degrees", base: Math.PI / 180 },
      { name: "minutes", base: Math.PI / 10800 },
      { name: "seconds", base: Math.PI / 648000 },
      { name: "radians", base: 1 },
      { name: "grads", base: Math.PI / 200 },
      { name: "revolutions", base: 2 * Math.PI },
    ],
  },
  {
    name: "Moment of inertia",
    units: [
      { name: "millimeters⁴", base: 1e-12 },
      { name: "centimeters⁴", base: 1e-8 },
      { name: "meters⁴", base: 1 },
      { name: "inches⁴", base: IN ** 4 },
      { name: "feet⁴", base: FT ** 4 },
    ],
  },
  {
    name: "Density",
    units: [
      { name: "kilograms per cubic meter", base: 1 },
      { name: "grams per cubic centimeter", base: 1e3 },
      { name: "pounds per cubic foot", base: LB / FT ** 3 },
      { name: "pounds per cubic inch", base: LB / IN ** 3 },
    ],
  },
];

// ---- triangles --------------------------------------------------------------------------------

/** What is known of a triangle: sides a, b, c opposite angles A, B, C. */
export type TriangleCase = "sss" | "sas" | "asa" | "aas" | "ssa";

export const TRIANGLE_CASES: readonly { readonly key: TriangleCase; readonly label: string; readonly known: readonly ("a" | "b" | "c" | "A" | "B" | "C")[] }[] = [
  { key: "sss", label: "Three sides (a, b, c)", known: ["a", "b", "c"] },
  { key: "sas", label: "Two sides and the angle between (a, b, C)", known: ["a", "b", "C"] },
  { key: "asa", label: "Two angles and the side between (A, B, c)", known: ["A", "B", "c"] },
  { key: "aas", label: "Two angles and a side opposite (A, B, a)", known: ["A", "B", "a"] },
  { key: "ssa", label: "Two sides and an angle opposite (a, b, A)", known: ["a", "b", "A"] },
];

/** A solved triangle: sides (any one unit) and angles in degrees. */
export interface Triangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly A: number;
  readonly B: number;
  readonly C: number;
}

const RAD = Math.PI / 180;
const law = (x: number, y: number, angle: number): number => Math.sqrt(Math.max(0, x * x + y * y - 2 * x * y * Math.cos(angle * RAD)));
const angleOf = (opposite: number, x: number, y: number): number => Math.acos(Math.min(1, Math.max(-1, (x * x + y * y - opposite * opposite) / (2 * x * y)))) / RAD;

/** The triangles the known values make (two for an ambiguous two sides and an angle opposite), or why there is none. */
export function solveTriangle(kind: TriangleCase, v: Readonly<Record<string, number>>): Triangle[] | string {
  const known = TRIANGLE_CASES.find((t) => t.key === kind)!.known;
  for (const k of known) {
    if (!(v[k] > 0)) return `${k}: enter a value above nought.`;
    if (k === k.toUpperCase() && v[k] >= 180) return `${k}: an angle of a triangle is less than 180°.`;
  }
  const { a, b, c, A, B, C } = v;
  switch (kind) {
    case "sss":
      if (a >= b + c || b >= a + c || c >= a + b) return "Each side must be shorter than the other two together.";
      return [{ a, b, c, A: angleOf(a, b, c), B: angleOf(b, a, c), C: 180 - angleOf(a, b, c) - angleOf(b, a, c) }];
    case "sas": {
      const cc = law(a, b, C);
      const aa = angleOf(a, b, cc);
      return [{ a, b, c: cc, A: aa, B: 180 - C - aa, C }];
    }
    case "asa":
    case "aas": {
      const cc = 180 - A - B;
      if (!(cc > 0)) return "The two angles must come to less than 180°.";
      // the law of sines from the side given
      const k = kind === "asa" ? c / Math.sin(cc * RAD) : a / Math.sin(A * RAD);
      return [{ a: k * Math.sin(A * RAD), b: k * Math.sin(B * RAD), c: k * Math.sin(cc * RAD), A, B, C: cc }];
    }
    case "ssa": {
      const sinB = (b * Math.sin(A * RAD)) / a;
      if (sinB > 1 + 1e-12) return "Side a is too short to reach the third side: no triangle has these values.";
      const out: Triangle[] = [];
      const b1 = Math.asin(Math.min(1, sinB)) / RAD;
      for (const bb of b1 > 90 - 1e-9 ? [90] : [b1, 180 - b1]) {
        const cc = 180 - A - bb;
        if (cc > 1e-9) out.push({ a, b, c: (a * Math.sin(cc * RAD)) / Math.sin(A * RAD), A, B: bb, C: cc });
      }
      return out.length ? out : "The angle and side b leave no room for the third angle: no triangle has these values.";
    }
  }
}

/** A triangle's area, by Heron's formula. */
export function triangleArea(t: Triangle): number {
  const s = (t.a + t.b + t.c) / 2;
  return Math.sqrt(Math.max(0, s * (s - t.a) * (s - t.b) * (s - t.c)));
}

// ---- the dialogs ------------------------------------------------------------------------------

const units = (): string | undefined => store.session?.doc.info.units;
const len = (mm: number): string => formatLength(mm, units());

function input(label: string, value = ""): HTMLInputElement {
  return h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
}

function select(label: string, options: readonly (readonly [string, string])[], width = "wide"): HTMLSelectElement {
  return h("select", { cls: `menu-dialog-input menu-dialog-select ${width}`, attrs: { "aria-label": label } }, ...options.map(([value, text]) => h("option", { value, text })));
}

function field(label: string, ...control: Node[]): { el: HTMLElement; name: HTMLElement } {
  const name = h("span", { cls: "menu-dialog-label", text: label });
  return { el: h("label", { cls: "menu-dialog-field" }, name, ...control), name };
}

/** The solution as a two-column list, or the reason there is none. */
function solution(holder: HTMLElement, rows: readonly (readonly [string, string])[] | string): void {
  holder.replaceChildren(
    typeof rows === "string"
      ? h("p", { cls: "muted", text: rows })
      : h("dl", { cls: "props-list" }, ...rows.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })])),
  );
}

/** A length typed into a field in the document's units, null when it isn't one, undefined when it is blank. */
function lengthOf(el: HTMLInputElement): number | null | undefined {
  if (!el.value.trim()) return undefined;
  const mm = parseLength(el.value, units());
  return mm !== null && mm > 0 ? mm : null;
}

/** Remembered between openings, as Vectorworks keeps a calculator's last values. */
const belt = { find: "length", d1: "", d2: "", third: "", place: false };

/** AEC > Machine Design > Belt Length Calculator…: an open belt's length round two pulleys, or the center distance a belt fits. */
export async function beltLengthDialog(): Promise<void> {
  const find = select("Find", [
    ["length", "Belt Length"],
    ["center", "Center Distance"],
  ]);
  find.value = belt.find;
  const d1 = input("(1) Diameter", belt.d1);
  const d2 = input("(2) Diameter", belt.d2);
  const third = input("(3) Center Distance", belt.third);
  const thirdRow = field("(3) Center Distance", third);
  const holder = h("div", { cls: "props-holder" });
  const [place, placeRow] = checkRow("Place data on drawing");
  place.checked = belt.place;
  let lines: string[] = [];
  const solve = (): void => {
    const center = find.value === "center";
    thirdRow.name.textContent = center ? "(3) Belt Length" : "(3) Center Distance";
    third.setAttribute("aria-label", thirdRow.name.textContent);
    lines = [];
    const [p, q, r] = [lengthOf(d1), lengthOf(d2), lengthOf(third)];
    if (!p || !q) return solution(holder, "Enter both pulleys' pitch diameters.");
    if (r === null) return solution(holder, `${thirdRow.name.textContent.slice(4)}: enter a length.`);
    const min = beltMinCenter(p, q);
    let c: number;
    let l: number;
    if (center) {
      if (r === undefined) return solution(holder, "Enter the belt's length.");
      const found = beltCenter(p, q, r);
      if (found === null) return solution(holder, `The belt is too short to go round the pulleys: it must be at least ${len(beltLength(p, q, min))}.`);
      [c, l] = [found, r];
    } else {
      // left blank, the least center distance
      c = r ?? min;
      if (c < min - 1e-9) return solution(holder, `The pulleys overlap: the center distance must be at least ${len(min)}.`);
      l = beltLength(p, q, c);
    }
    const rows: [string, string][] = [
      center ? ["Center Distance", len(c)] : ["Belt Length", len(l)],
      ...(r === undefined ? [["Center Distance (least)", len(c)] as [string, string]] : []),
    ];
    solution(holder, rows);
    lines = ["Belt Length Calculator", `(1) Diameter: ${len(p)}`, `(2) Diameter: ${len(q)}`, `Center Distance: ${len(c)}`, `Belt Length: ${len(l)}`];
  };
  for (const el of [find, d1, d2, third]) el.addEventListener("input", solve);
  solve();
  const ok = await showDialog<boolean>({
    title: "Belt Length Calculator",
    okLabel: "OK",
    cls: "props-dialog",
    body: [field("Find", find).el, field("(1) Diameter", d1).el, field("(2) Diameter", d2).el, thirdRow.el, holder, placeRow],
    check: () => (place.checked && !lines.length ? { error: "Solve the belt first: its values aren't complete." } : { value: place.checked }),
  });
  Object.assign(belt, { find: find.value, d1: d1.value, d2: d2.value, third: third.value, place: place.checked });
  if (ok) placeTextAtClick("Belt Length Calculator", lines);
}

const chain = { find: "length", size: CHAINS[2].id, n1: "", n2: "", third: "", place: false };

/** AEC > Machine Design > Chain Length Calculator…: a roller chain's length round two sprockets, or the center distance a chain fits. */
export async function chainLengthDialog(): Promise<void> {
  const find = select("Find", [
    ["length", "Chain Length"],
    ["center", "Center Distance"],
  ]);
  find.value = chain.find;
  const size = select(
    "Std. Chain No. (Pitch)",
    CHAINS.map((c) => [c.id, c.label]),
  );
  size.value = chain.size;
  const n1 = input("(1) Number of Teeth, Sprocket #1", chain.n1);
  const n2 = input("(2) Number of Teeth, Sprocket #2", chain.n2);
  const third = input("(3) Center Distance", chain.third);
  const thirdRow = field("(3) Center Distance", third);
  const holder = h("div", { cls: "props-holder" });
  const [place, placeRow] = checkRow("Place data on drawing");
  place.checked = chain.place;
  let lines: string[] = [];
  const teeth = (el: HTMLInputElement): number | null => {
    const n = Number(el.value.trim());
    return Number.isInteger(n) && n >= MIN_SPROCKET_TEETH && n <= MAX_SPROCKET_TEETH ? n : null;
  };
  const solve = (): void => {
    const center = find.value === "center";
    thirdRow.name.textContent = center ? "(3) Chain Length" : "(3) Center Distance";
    third.setAttribute("aria-label", thirdRow.name.textContent);
    lines = [];
    const ch = CHAINS.find((c) => c.id === size.value) ?? CHAINS[0];
    const [p, q, r] = [teeth(n1), teeth(n2), lengthOf(third)];
    if (!p || !q) return solution(holder, `Enter each sprocket's number of teeth (${MIN_SPROCKET_TEETH} to ${MAX_SPROCKET_TEETH}).`);
    if (r === null) return solution(holder, `${thirdRow.name.textContent.slice(4)}: enter a length.`);
    const min = chainMinCenter(ch, p, q);
    let c: number;
    let pitches: number;
    if (center) {
      if (r === undefined) return solution(holder, "Enter the chain's length (its number of pitches times the pitch).");
      const found = chainCenter(ch, p, q, r / ch.pitch);
      if (found === null) return solution(holder, `The chain is too short to go round the sprockets: it must be at least ${len(chainPitches(ch, p, q, min) * ch.pitch)}.`);
      [c, pitches] = [found, r / ch.pitch];
    } else {
      c = r ?? min;
      if (c < min - 1e-9) return solution(holder, `The sprockets overlap: the center distance must be at least ${len(min)}.`);
      pitches = chainPitches(ch, p, q, c);
    }
    const rows: [string, string][] = [
      center ? ["Center Distance", len(c)] : ["Chain Length", len(pitches * ch.pitch)],
      ["Pitches", numberText(pitches)],
      ...(r === undefined ? [["Center Distance (least)", len(c)] as [string, string]] : []),
      ["Pitch Diameters", `${len(sprocketPitchDiameter(ch, p))}, ${len(sprocketPitchDiameter(ch, q))}`],
    ];
    solution(holder, rows);
    lines = [
      "Chain Length Calculator",
      `Chain: ${ch.label}`,
      `(1) Sprocket #1: ${p} teeth`,
      `(2) Sprocket #2: ${q} teeth`,
      `Center Distance: ${len(c)}`,
      `Chain Length: ${len(pitches * ch.pitch)} (${numberText(pitches)} pitches)`,
    ];
  };
  for (const el of [find, size, n1, n2, third]) el.addEventListener("input", solve);
  solve();
  const ok = await showDialog<boolean>({
    title: "Chain Length Calculator",
    okLabel: "OK",
    cls: "props-dialog",
    body: [
      field("Find", find).el,
      field("Std. Chain No. (Pitch)", size).el,
      field("(1) Number of Teeth, Sprocket #1", n1).el,
      field("(2) Number of Teeth, Sprocket #2", n2).el,
      thirdRow.el,
      holder,
      placeRow,
    ],
    check: () => (place.checked && !lines.length ? { error: "Solve the chain first: its values aren't complete." } : { value: place.checked }),
  });
  Object.assign(chain, { find: find.value, size: size.value, n1: n1.value, n2: n2.value, third: third.value, place: place.checked });
  if (ok) placeTextAtClick("Chain Length Calculator", lines);
}

const conversion = { value: "1", from: "Length/inches", to: "millimeters" };

/** AEC > Machine Design > Conversion Factors…: an amount in one unit, the factor to another of the same quantity and the amount in it. */
export async function conversionFactorsDialog(): Promise<void> {
  const value = input("Multiply", conversion.value);
  const from = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Multiply unit" } },
    ...QUANTITIES.map((q) => h("optgroup", { attrs: { label: q.name } }, ...q.units.map((u) => h("option", { value: `${q.name}/${u.name}`, text: u.name })))),
  );
  from.value = conversion.from;
  if (from.selectedIndex < 0) from.selectedIndex = 0;
  const to = select("To Obtain unit", []);
  const by = h("output", { cls: "conv-out", attrs: { "aria-label": "By" } });
  const result = h("output", { cls: "conv-out", attrs: { "aria-label": "To Obtain" } });
  const quantity = (): (typeof QUANTITIES)[number] => QUANTITIES.find((q) => from.value.startsWith(`${q.name}/`)) ?? QUANTITIES[0];
  let shown = "";
  const fill = (): void => {
    const q = quantity();
    if (q.name === shown) return;
    shown = q.name;
    const keep = to.value || conversion.to;
    to.replaceChildren(...q.units.map((u) => h("option", { value: u.name, text: u.name })));
    to.value = q.units.some((u) => u.name === keep) ? keep : q.units[0].name;
  };
  const solve = (): void => {
    fill();
    const q = quantity();
    const a = q.units.find((u) => from.value === `${q.name}/${u.name}`)!;
    const b = q.units.find((u) => u.name === to.value)!;
    const factor = a.base / b.base;
    const v = Number(value.value.trim().replace(",", "."));
    by.textContent = numberText(factor);
    result.textContent = value.value.trim() && Number.isFinite(v) ? numberText(v * factor) : "—";
  };
  for (const el of [value, from, to]) el.addEventListener("input", solve);
  solve();
  await showDialog<true>({
    title: "Conversion Factors",
    okLabel: "Close",
    cls: "props-dialog",
    body: [
      field("Multiply", value, from).el,
      field("By", by).el,
      field("To Obtain", result, to).el,
      h("p", { cls: "muted", text: "Amounts and factors to six significant figures." }),
    ],
    check: () => ({ value: true }),
  });
  Object.assign(conversion, { value: value.value, from: from.value, to: to.value });
}

const triangle: { kind: TriangleCase; values: Record<string, string> } = { kind: "sss", values: {} };

/** AEC > Machine Design > Solution of Triangles…: the sides, angles and area of a triangle from three things known of it. */
export async function solutionOfTrianglesDialog(): Promise<void> {
  const kind = select(
    "Known Values",
    TRIANGLE_CASES.map((t) => [t.key, t.label]),
    "calc-wide",
  );
  kind.value = triangle.kind;
  const names = ["a", "b", "c", "A", "B", "C"] as const;
  const inputs = Object.fromEntries(names.map((n) => [n, input(n === n.toUpperCase() ? `Angle ${n}` : `Side ${n}`, triangle.values[n] ?? "")])) as Record<(typeof names)[number], HTMLInputElement>;
  const holder = h("div", { cls: "props-holder" });
  const solve = (): void => {
    const known = TRIANGLE_CASES.find((t) => t.key === kind.value)!.known;
    for (const n of names) inputs[n].disabled = !known.includes(n);
    const v: Record<string, number> = {};
    for (const n of known) {
      const text = inputs[n].value.trim();
      if (!text) return solution(holder, `Enter ${known.map((k) => (k === k.toUpperCase() ? `angle ${k}` : `side ${k}`)).join(", ")}.`);
      const x = n === n.toUpperCase() ? Number(text.replace(",", ".").replace(/°$/, "")) : parseLength(text, units());
      if (x === null || !Number.isFinite(x)) return solution(holder, `${n}: enter ${n === n.toUpperCase() ? "an angle in degrees" : "a length"}.`);
      v[n] = x;
    }
    const found = solveTriangle(kind.value as TriangleCase, v);
    if (typeof found === "string") return solution(holder, found);
    const deg = (x: number): string => `${Number(x.toFixed(4))}°`;
    solution(
      holder,
      found.flatMap((t, i) => [
        ...(found.length > 1 ? [[i ? "Second solution" : "First solution", ""] as [string, string]] : []),
        ["Sides a, b, c", `${len(t.a)}, ${len(t.b)}, ${len(t.c)}`],
        ["Angles A, B, C", `${deg(t.A)}, ${deg(t.B)}, ${deg(t.C)}`],
        ["Area", formatArea(triangleArea(t), units())],
        ["Perimeter", len(t.a + t.b + t.c)],
      ]),
    );
  };
  kind.addEventListener("input", solve);
  for (const n of names) inputs[n].addEventListener("input", solve);
  solve();
  const row = (a: string, b: string, x: HTMLInputElement, y: HTMLInputElement): HTMLElement =>
    h("div", { cls: "menu-dialog-field tri-row" }, h("span", { cls: "menu-dialog-label", text: a }), x, h("span", { cls: "menu-dialog-label", text: b }), y);
  await showDialog<true>({
    title: "Solution of Triangles",
    okLabel: "Close",
    cls: "props-dialog",
    body: [
      field("Known Values", kind).el,
      row("Side a", "Angle A", inputs.a, inputs.A),
      row("Side b", "Angle B", inputs.b, inputs.B),
      row("Side c", "Angle C", inputs.c, inputs.C),
      h("p", { cls: "muted", text: "Each side lies opposite the angle of its letter; angles are in degrees." }),
      holder,
    ],
    check: () => ({ value: true }),
  });
  triangle.kind = kind.value as TriangleCase;
  triangle.values = Object.fromEntries(names.map((n) => [n, inputs[n].value]));
}

// ---- springs ----------------------------------------------------------------------------------

/** Remembered between openings; the units start as the drawing's, inches for imperial ones. */
const spring = {
  units: "",
  method: "outsideSolid" as SpringMethod,
  ends: "squaredground" as SpringEnds,
  values: {} as Record<string, string>,
  material: SPRING_MATERIALS[0].name,
  modulus: "",
};

/** AEC > Machine Design > Spring Calculator…: a round-wire helical compression spring's rate and unit stress, and the tool to draw it. */
export async function springCalculatorDialog(): Promise<void> {
  const unitSelect = select("Units", [
    ["in", "Inches"],
    ["mm", "Millimeters"],
  ]);
  unitSelect.value = spring.units || ([25.4, 304.8, 914.4, 1609344].includes(millimetresPerUnit(units())) ? "in" : "mm");
  const method = select(
    "Method",
    SPRING_METHODS.map((m) => [m.key, m.label]),
    "calc-wide",
  );
  method.value = spring.method;
  const names = ["outside", "mean", "wire", "solid", "active"] as const;
  const labels: Record<(typeof names)[number], string> = { outside: "Outside Diameter", mean: "Mean Diameter", wire: "Wire Diameter", solid: "Solid Height", active: "No. of Active Coils" };
  const inputs = Object.fromEntries(names.map((n) => [n, input(labels[n], spring.values[n] ?? "")])) as Record<(typeof names)[number], HTMLInputElement>;
  const ends = SPRING_CALC_ENDS.map((e) => {
    const r = h("input", { attrs: { type: "radio", name: "spring-ends", value: e.value, "aria-label": e.label }, checked: e.value === spring.ends });
    return { e, r, row: h("label", { cls: "menu-dialog-check" }, r, e.label) };
  });
  const material = select("Material", [...SPRING_MATERIALS.map((m): [string, string] => [m.name, m.name]), ["", "Other"]], "calc-wide");
  material.value = spring.material;
  const modulus = input("Shear Modulus (G)", spring.modulus);
  const modulusUnit = h("span", { cls: "menu-dialog-label" });
  const holder = h("div", { cls: "props-holder" });
  const [place2d, row2d] = checkRow("Place 2D spring on drawing");
  const [place3d, row3d] = checkRow("Place 3D spring on drawing");
  // one tool places the spring, so one of the two
  place2d.addEventListener("change", () => place2d.checked && (place3d.checked = false));
  place3d.addEventListener("change", () => place3d.checked && (place2d.checked = false));
  const unitName = (u: string): string => (u === "in" ? "Inches" : "Millimeters");
  const show = (mm: number, u: string): string => numberText(u === "in" ? mm / 25.4 : mm);
  let shownUnits = unitSelect.value;
  let solved: Spring | null = null;
  const fillModulus = (): void => {
    const m = SPRING_MATERIALS.find((x) => x.name === material.value);
    if (m) modulus.value = unitSelect.value === "in" ? numberText(m.mpsi * 1e6) : numberText(mpaOfPsi(m.mpsi * 1e6));
  };
  if (!modulus.value) fillModulus();
  const solve = (): void => {
    const u = unitSelect.value;
    const inch = u === "in";
    // the typed lengths and the modulus follow a change of units
    if (u !== shownUnits) {
      for (const n of ["outside", "mean", "wire", "solid"] as const) {
        const mm = parseLength(inputs[n].value, unitName(shownUnits));
        if (!inputs[n].disabled && inputs[n].value.trim() && mm !== null) inputs[n].value = show(mm, u);
      }
      const g = Number(modulus.value.trim().replace(",", "."));
      if (modulus.value.trim() && Number.isFinite(g)) modulus.value = numberText(inch ? psiOfMpa(g) : mpaOfPsi(g));
      shownUnits = u;
    }
    modulusUnit.textContent = inch ? "lb/sq in" : "N/mm²";
    const m = method.value as SpringMethod;
    const byOutside = m === "outsideSolid" || m === "outsideActive";
    const bySolid = m === "outsideSolid" || m === "meanSolid";
    inputs.outside.disabled = !byOutside;
    inputs.mean.disabled = byOutside;
    inputs.solid.disabled = !bySolid;
    inputs.active.disabled = bySolid;
    const length = (el: HTMLInputElement): number => (el.value.trim() ? (parseLength(el.value, unitName(u)) ?? NaN) : 0);
    const g = Number(modulus.value.trim().replace(",", "."));
    const r = solveSpring({
      method: m,
      ends: ends.find((x) => x.r.checked)?.e.value ?? "squaredground",
      diameter: length(byOutside ? inputs.outside : inputs.mean),
      wire: length(inputs.wire),
      coils: bySolid ? length(inputs.solid) : Number(inputs.active.value.trim().replace(",", ".")) || 0,
      g: modulus.value.trim() && Number.isFinite(g) ? (inch ? mpaOfPsi(g) : g) : 0,
    });
    const shown = (el: HTMLInputElement, text: string): void => {
      if (el.disabled) el.value = text;
    };
    if (typeof r === "string") {
      solved = null;
      for (const n of names) shown(inputs[n], "");
      return solution(holder, r);
    }
    solved = r;
    shown(inputs.outside, show(r.outside, u));
    shown(inputs.mean, show(r.mean, u));
    shown(inputs.solid, show(r.solid, u));
    shown(inputs.active, numberText(Number(r.active.toFixed(3))));
    solution(holder, [
      ["Spring Rate", `${numberText(inch ? r.rate * LB_IN_PER_N_MM : r.rate)} ${inch ? "lb/in" : "N/mm"}`],
      ["Unit Stress", `${numberText(inch ? r.unitStress * PSI_LB_PER_MPA_N : r.unitStress)} ${inch ? "(lb/sq in)/lb" : "(N/mm²)/N"}`],
      ["Total Coils", numberText(Number(r.total.toFixed(3)))],
      ["Spring Index", numberText(r.index)],
      ["Wahl Factor", numberText(r.wahl)],
    ]);
  };
  material.addEventListener("input", () => {
    fillModulus();
    solve();
  });
  for (const el of [unitSelect, method, modulus, ...names.map((n) => inputs[n]), ...ends.map((x) => x.r)]) el.addEventListener("input", solve);
  for (const x of ends) x.r.addEventListener("change", solve);
  solve();
  const ok = await showDialog<"2d" | "3d" | "none">({
    title: "Spring Calculator",
    okLabel: "OK",
    cls: "props-dialog spring-dialog",
    body: [
      field("Units", unitSelect).el,
      field("Method", method).el,
      ...names.map((n) => field(labels[n], inputs[n]).el),
      h("div", { cls: "menu-dialog-field spring-ends" }, h("span", { cls: "menu-dialog-label", text: "Type of Ends" }), h("div", {}, ...ends.map((x) => x.row))),
      field("Material", material).el,
      field("Shear Modulus (G)", modulus, modulusUnit).el,
      holder,
      h("p", { cls: "muted", text: "Unit stress is the shear stress one unit of load makes, without Wahl's correction for the coils' curve: multiply by the load, and by the Wahl factor for the stress at the wire's inside. Moduli are Shigley's for spring wire; type another for other wire." }),
      row2d,
      row3d,
    ],
    check: () => ((place2d.checked || place3d.checked) && !solved ? { error: "Solve the spring first: its values aren't complete." } : { value: place2d.checked ? "2d" : place3d.checked ? "3d" : "none" }),
  });
  Object.assign(spring, {
    units: unitSelect.value,
    method: method.value,
    ends: ends.find((x) => x.r.checked)?.e.value ?? "squaredground",
    values: Object.fromEntries(names.filter((n) => !inputs[n].disabled).map((n) => [n, inputs[n].value])),
    material: material.value,
    modulus: modulus.value,
  });
  const s = solved as Spring | null;
  if (!s || (ok !== "2d" && ok !== "3d")) return;
  const id = ok === "2d" ? "compspring2" : "compspring23d";
  handSpring(id, { ends: spring.ends, wire: s.wire, mean: s.mean, active: s.active, solid: s.solid });
  appContext()?.setTool(id);
  toast(`${ok === "2d" ? "Compression Spring 2" : "Compression Spring 2 - 3D"} is ready with the spring: click in the drawing to place it. Its Preferences set the working length.`, "info");
}
