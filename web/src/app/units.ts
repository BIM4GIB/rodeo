// The document's units (doc.info.units): how lengths and areas are shown and typed. World
// coordinates are always millimetres, whatever the document's units, so every length that the user
// sees or types is converted here, at the edge: formatLength and parseLength map millimetres to
// text and back. unitLabel and millimetresPerUnit give the short label and the size of one unit.

/** British spellings of the unit names below, which the tables do not list. */
const ALIASES: Readonly<Record<string, string>> = {
  millimetres: "millimeters",
  centimetres: "centimeters",
  metres: "meters",
  kilometres: "kilometers",
  "feet & inches": "feet and inches",
};

/** The document's unit name in the spelling the tables use, lower case; "" when the document names none. */
function keyOf(units: string | undefined): string {
  const key = (units ?? "").toLowerCase();
  return ALIASES[key] ?? key;
}

const SHORT_UNITS: Readonly<Record<string, string>> = {
  millimeters: "mm",
  centimeters: "cm",
  meters: "m",
  kilometers: "km",
  inches: "in",
  feet: "ft",
  "feet and inches": "ft",
  yards: "yd",
  miles: "mi",
};

/** Short label for the document's units ("Millimeters" reads as "mm"); "mm" when the document names none. */
export function unitLabel(units: string | undefined): string {
  if (!units) return "mm";
  return SHORT_UNITS[keyOf(units)] ?? units;
}

const MM_PER_UNIT: Readonly<Record<string, number>> = {
  millimeters: 1,
  centimeters: 10,
  meters: 1000,
  kilometers: 1e6,
  inches: 25.4,
  feet: 304.8,
  "feet and inches": 304.8,
  yards: 914.4,
  miles: 1609344,
};

/** Millimetres in one document unit; 1 (millimetres) when the document names none or an unknown one. */
export function millimetresPerUnit(units: string | undefined): number {
  if (!units) return 1;
  return MM_PER_UNIT[keyOf(units)] ?? 1;
}

const MM_PER_FOOT = 304.8;
const MM_PER_INCH = 25.4;
/** sixteenths of an inch: architectural lengths are rounded to this */
const SIXTEENTHS = 16;
const INCHES_PER_FOOT = 12;

/** Decimal places a metric length shows in its unit. Millimetres have their own rule (see millimetreText). */
const DECIMALS: Readonly<Record<string, number>> = {
  centimeters: 1,
  meters: 3,
  kilometers: 3,
};
/** Decimal places of the other decimal units (yards, miles, names this file does not know). */
const OTHER_DECIMALS = 2;

/** Feet and inches are written as architects write them; the other units show plain decimals. */
function isArchitectural(key: string): boolean {
  return key === "feet" || key === "feet and inches" || key === "inches";
}

/** Millimetres are the default unit: whole numbers, with two decimals only when a value is fractional. */
function isMillimetres(key: string): boolean {
  return key === "" || key === "millimeters";
}

/** Millimetres as text: 0 decimal places, or two when the value is fractional (1250, 1234.57). */
function millimetreText(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** A number with a fixed count of decimal places, and no minus sign on zero. */
function fixedText(v: number, dp: number): string {
  const text = v.toFixed(dp);
  return text.startsWith("-") && Number(text) === 0 ? text.slice(1) : text;
}

/** A count of sixteenths of an inch as text: "6 1/2", "1/4", "8". */
function inchText(sixteenths: number): string {
  const whole = Math.floor(sixteenths / SIXTEENTHS);
  const frac = sixteenths % SIXTEENTHS;
  if (frac === 0) return String(whole);
  // reduce the fraction: 8/16 is 1/2
  let a = frac;
  let b = SIXTEENTHS;
  while (b !== 0) [a, b] = [b, a % b];
  const top = frac / a;
  const bottom = SIXTEENTHS / a;
  return whole === 0 ? `${top}/${bottom}` : `${whole} ${top}/${bottom}`;
}

/**
 * Feet and inches as architects write them (12'-6 1/2", 8", 1/2"), or with `withFeet` off inches
 * alone (150 1/4"). Rounded to a sixteenth of an inch. Under one foot the feet part is dropped.
 */
function architectural(mm: number, withFeet: boolean): string {
  const sixteenths = Math.round((Math.abs(mm) / MM_PER_INCH) * SIXTEENTHS);
  const sign = mm < 0 && sixteenths > 0 ? "-" : "";
  if (!withFeet) return `${sign}${inchText(sixteenths)}"`;
  const perFoot = INCHES_PER_FOOT * SIXTEENTHS;
  const feet = Math.floor(sixteenths / perFoot);
  const rest = sixteenths - feet * perFoot;
  if (feet === 0) return `${sign}${inchText(rest)}"`;
  // 18'-0 9/16", as 18'-9/16" reads as a subtraction
  const zero = rest > 0 && rest < SIXTEENTHS ? "0 " : "";
  return `${sign}${feet}'-${zero}${inchText(rest)}"`;
}

/**
 * A length in the document's units, as a number: millimetres as whole numbers, feet and inches as
 * architectural text (12'-0"), metric units with their decimal places (1.250 for metres). There is
 * no unit label; lengthSuffix gives the one to show beside it.
 */
export function formatLengthValue(mm: number, units?: string): string {
  const key = keyOf(units);
  if (isArchitectural(key)) return architectural(mm, key !== "inches");
  const v = mm / millimetresPerUnit(units);
  if (isMillimetres(key)) return millimetreText(v);
  return fixedText(v, DECIMALS[key] ?? OTHER_DECIMALS);
}

/**
 * The unit to show beside a length field: the short label for decimal units, nothing for feet and
 * inches, whose marks (' and ") are the unit.
 */
export function lengthSuffix(units?: string): string {
  return isArchitectural(keyOf(units)) ? "" : unitLabel(units);
}

/** A length in the document's units with its unit: "1250 mm", "12'-0\"", "1.250 m". */
export function formatLength(mm: number, units?: string): string {
  const text = formatLengthValue(mm, units);
  const suffix = lengthSuffix(units);
  return suffix ? `${text} ${suffix}` : text;
}

/** Square metres for metric documents, square feet for feet and inches, square yards or miles for those units. */
export function formatArea(mm2: number, units?: string): string {
  const key = keyOf(units);
  if (isArchitectural(key)) return `${areaNumber(mm2 / (MM_PER_FOOT * MM_PER_FOOT), 2)} sq ft`;
  if (key === "yards") return `${areaNumber(mm2 / (914.4 * 914.4), 2)} sq yd`;
  if (key === "miles") return `${areaNumber(mm2 / (1609344 * 1609344), 3)} sq mi`;
  return `${areaNumber(mm2 / 1e6, 3)} m²`;
}

export function formatVolume(mm3: number, units?: string): string {
  const key = keyOf(units);
  if (isArchitectural(key) || key === "yards" || key === "miles") return `${areaNumber(mm3 / (914.4 * 914.4 * 914.4), 2)} cu yd`;
  return `${areaNumber(mm3 / 1e9, 3)} m³`;
}

/** An area number to `dp` decimals; a non-zero area too small to show reads as "< 0.001". */
function areaNumber(v: number, dp: number): string {
  const least = 10 ** -dp;
  return v > 0 && v < least / 2 ? `< ${fixedText(least, dp)}` : fixedText(v, dp);
}

/** Millimetres per length unit name that parseLength takes after a number ("1200mm", "2in", "3ft"). Lower case. */
const SUFFIX_MM: Readonly<Record<string, number>> = {
  mm: 1,
  millimeter: 1,
  millimetre: 1,
  cm: 10,
  centimeter: 10,
  centimetre: 10,
  m: 1000,
  meter: 1000,
  metre: 1000,
  km: 1e6,
  kilometer: 1e6,
  kilometre: 1e6,
  in: MM_PER_INCH,
  inch: MM_PER_INCH,
  ft: MM_PER_FOOT,
  foot: MM_PER_FOOT,
  feet: MM_PER_FOOT,
  yd: 914.4,
  yard: 914.4,
  mi: 1609344,
  mile: 1609344,
};

/** Millimetres per unit name as typed, with a plural ending taken off when the name itself is not listed. */
function suffixMm(word: string): number | null {
  return SUFFIX_MM[word] ?? SUFFIX_MM[word.replace(/s$/, "")] ?? SUFFIX_MM[word.replace(/es$/, "")] ?? null;
}

/** A number as typed: a decimal ("3.5", ".5"), a fraction ("1/2") or a mixed fraction ("6 1/2"); null otherwise. */
function numberOfText(text: string): number | null {
  const t = text.trim();
  if (/^(\d+\.?\d*|\.\d+)$/.test(t)) return Number(t);
  const m = /^(?:(\d+)\s+)?(\d+)\/(\d+)$/.exec(t);
  if (!m) return null;
  const bottom = Number(m[3]);
  return bottom > 0 ? Number(m[1] ?? 0) + Number(m[2]) / bottom : null;
}

/**
 * Feet and inches as typed, without a sign: 12', 12'6", 12'-6 1/2", 6", 1/2". Inches need their
 * " mark unless they follow a feet mark. Returns millimetres, or null.
 */
function architecturalMagnitude(s: string): number | null {
  const q = s.indexOf("'");
  let feet = 0;
  let rest = s;
  if (q >= 0) {
    const f = numberOfText(s.slice(0, q));
    if (f === null) return null;
    feet = f;
    // the dash between feet and inches is optional: 12'-6" and 12' 6" both read as 12 ft 6 in
    rest = s.slice(q + 1).replace(/^\s*-?\s*/, "");
  }
  let inches = 0;
  if (rest !== "") {
    const mark = rest.indexOf('"');
    if (mark >= 0 && mark !== rest.length - 1) return null;
    const v = numberOfText(mark >= 0 ? rest.slice(0, -1) : rest);
    if (v === null) return null;
    inches = v;
  }
  return (feet * INCHES_PER_FOOT + inches) * MM_PER_INCH;
}

/** A length as typed without a sign, in millimetres: feet and inches, a number with a unit, or a bare number in the document's units. */
function magnitudeMm(s: string, units: string | undefined): number | null {
  if (s.includes("'") || s.includes('"')) return architecturalMagnitude(s);
  const m = /^([\d./\s]+?)\s*([a-z]+)$/.exec(s);
  if (m) {
    const perUnit = suffixMm(m[2]);
    const v = numberOfText(m[1]);
    return perUnit === null || v === null ? null : v * perUnit;
  }
  const v = numberOfText(s);
  return v === null ? null : v * millimetresPerUnit(units);
}

/**
 * A length typed into a field, in millimetres (world units), or null when the text is not a length.
 * A bare number is in the document's units (12 is 12 ft in a feet document). Also takes feet and
 * inches (12', 12'6", 12'-6 1/2", 6", 3.5', 1/2") and a number with a unit (1200mm, 120cm, 1.2m,
 * 2in, 2ft, 1 1/2yd). A comma counts as a decimal point.
 */
export function parseLength(text: string, units?: string): number | null {
  let s = text
    .trim()
    .replace(/[’‘′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/,/g, ".")
    .toLowerCase();
  const negative = s.startsWith("-");
  if (negative || s.startsWith("+")) s = s.slice(1).trim();
  const mm = magnitudeMm(s, units);
  if (mm === null || !Number.isFinite(mm)) return null;
  return negative ? -mm : mm;
}
