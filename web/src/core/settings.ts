// The settings block in a file's header (FORMAT.md §1): the document's units. Vectorworks keeps
// the length unit, and the area and volume units that go with it, as names, marks and factors at
// fixed offsets. openvwx reads the length unit's name, and Units writes the whole set; the rounding
// and display fields beside them are left as the file has them.

/** A length unit as Document Settings > Units offers it, with the area and volume units it shows. */
interface UnitSet {
  readonly name: string;
  /** this unit in an inch (25.4 for millimetres; 1 for feet and inches, counted in inches) */
  readonly perInch: number;
  readonly mark: string;
  /** feet and inches only: the feet mark, the separator and the inches in a foot */
  readonly feet?: { readonly mark: string; readonly separator: string; readonly per: number };
  /** the mark of the unit squared and cubed (" sq mm"; " sq ft" for feet and inches) */
  readonly square: string;
  readonly cube: string;
  readonly area: { readonly name: string; readonly mark: string; readonly perSquareInch: number };
  readonly volume: { readonly name: string; readonly mark: string; readonly perCubicInch: number };
}

const INCH_M = 0.0254;
const SQ_M = { name: "Square Meters", mark: " sq m", perSquareInch: INCH_M ** 2 };
const CU_M = { name: "Cubic Meters", mark: " cu m", perCubicInch: INCH_M ** 3 };
const SQ_FT = { name: "Square Feet", mark: " sq ft", perSquareInch: 1 / 144 };
const CU_FT = { name: "Cubic Feet", mark: " cu ft", perCubicInch: 1 / 1728 };

const UNIT_SETS: readonly UnitSet[] = [
  { name: "Millimeters", perInch: 25.4, mark: "mm", square: " sq mm", cube: " cu mm", area: SQ_M, volume: CU_M },
  { name: "Centimeters", perInch: 2.54, mark: "cm", square: " sq cm", cube: " cu cm", area: SQ_M, volume: CU_M },
  { name: "Meters", perInch: INCH_M, mark: "m", square: " sq m", cube: " cu m", area: SQ_M, volume: CU_M },
  {
    name: "Kilometers",
    perInch: INCH_M / 1000,
    mark: "km",
    square: " sq km",
    cube: " cu km",
    area: { name: "Square Kilometers", mark: " sq km", perSquareInch: (INCH_M / 1000) ** 2 },
    volume: CU_M,
  },
  { name: "Inches", perInch: 1, mark: '"', square: " sq in", cube: " cu in", area: SQ_FT, volume: CU_FT },
  { name: "Feet", perInch: 1 / 12, mark: "'", square: " sq ft", cube: " cu ft", area: SQ_FT, volume: CU_FT },
  {
    name: "Feet & Inches",
    perInch: 1,
    mark: '"',
    feet: { mark: "'", separator: "-", per: 12 },
    square: " sq ft",
    cube: " cu ft",
    area: SQ_FT,
    volume: CU_FT,
  },
  {
    name: "Yards",
    perInch: 1 / 36,
    mark: "yd",
    square: " sq yd",
    cube: " cu yd",
    area: { name: "Square Yards", mark: " sq yd", perSquareInch: 1 / 1296 },
    volume: { name: "Cubic Yards", mark: " cu yd", perCubicInch: 1 / 46656 },
  },
  {
    name: "Miles",
    perInch: 1 / 63360,
    mark: "mi",
    square: " sq mi",
    cube: " cu mi",
    area: { name: "Square Miles", mark: " sq mi", perSquareInch: 1 / 63360 ** 2 },
    volume: CU_FT,
  },
];

/** The length units Units offers, by name. */
export const LENGTH_UNITS: readonly string[] = UNIT_SETS.map((u) => u.name);

/** The area and volume unit names that go with a length unit (as Units writes them). */
export function companionUnits(name: string): { area: string; volume: string } | null {
  const u = UNIT_SETS.find((s) => s.name === name);
  return u ? { area: u.area.name, volume: u.volume.name } : null;
}

// file offsets of the units fields (FORMAT.md §1); text is UTF-16LE in fixed slots, zero-ended
const PER_INCH = 0x1ac; // f64
const AREA_PER = 0x1b4; // f64 area units in a square inch
const VOLUME_PER = 0x1bc; // f64 volume units in a cubic inch
const STYLE = 0x1c4; // u16: 2 feet and inches, 0 decimal
const NAME = 0x1c6;
const MARK = 0x1f0;
const FEET_MARK = 0x202;
const SEPARATOR = 0x214;
const PER_FOOT = 0x226; // u16: inches in a foot for feet and inches, else 1
const SQUARE_MARK = 0x228;
const PER_SQUARE_FOOT = 0x242; // u16: 144 for feet and inches, else 1
const CUBE_MARK = 0x246;
const PER_CUBIC_FOOT = 0x260; // u16: 1728 for feet and inches, else 1
const AREA_NAME = 0x278;
const AREA_MARK = 0x2a2;
const VOLUME_NAME = 0x2c0;
const VOLUME_MARK = 0x2ea;
const UNITS_END = 0x304;
const FEET_AND_INCHES = 2;
const NAME_SLOT = 21;
const MARK_SLOT = 9;
const SQUARE_SLOT = 13;
/** settings block length, little-endian, at the block's start */
const SETTINGS = 0x94;

function f64(h: Uint8Array, at: number): number {
  return new DataView(h.buffer, h.byteOffset, h.byteLength).getFloat64(at, true);
}

/** Zero-ended UTF-16LE text in a slot of `slot` characters; null when it isn't printable text. */
function slotText(h: Uint8Array, at: number, slot: number): string | null {
  let s = "";
  for (let i = 0; i < slot; i++) {
    const c = h[at + 2 * i] | (h[at + 2 * i + 1] << 8);
    if (c === 0) return s;
    if (c < 0x20 || c > 0x7e) return null;
    s += String.fromCharCode(c);
  }
  return null;
}

/**
 * The length unit's name ("Millimeters", "Feet & Inches") when the header holds the units where
 * the files openvwx has seen do; null otherwise.
 */
export function unitsName(h: Uint8Array): string | null {
  if (h.length < UNITS_END) return null;
  const len = h[SETTINGS] | (h[SETTINGS + 1] << 8) | (h[SETTINGS + 2] << 16) | (h[SETTINGS + 3] * 0x1000000);
  if (len < UNITS_END - SETTINGS) return null;
  const perInch = f64(h, PER_INCH);
  if (!(perInch > 0 && Number.isFinite(perInch))) return null;
  const name = slotText(h, NAME, NAME_SLOT);
  const area = slotText(h, AREA_NAME, NAME_SLOT);
  if (!name || area === null) return null;
  // a unit openvwx knows must have its own size, or these aren't the units
  const known = UNIT_SETS.find((u) => u.name === name);
  if (known && Math.abs(known.perInch - perInch) > known.perInch * 1e-9) return null;
  return name;
}

/** Writes zero-ended UTF-16LE text into a slot, clearing the rest of it. */
function setSlot(h: Uint8Array, at: number, slot: number, text: string): void {
  h.fill(0, at, at + 2 * slot);
  for (let i = 0; i < text.length && i < slot - 1; i++) {
    const c = text.charCodeAt(i);
    h[at + 2 * i] = c & 0xff;
    h[at + 2 * i + 1] = c >> 8;
  }
}

/**
 * The units fields (from PER_INCH to UNITS_END) set to length unit `name` and its area and volume
 * units, for a header whose units unitsName can read. Throws when it can't, or `name` isn't one of
 * LENGTH_UNITS. Returns the offset and the new bytes; the header itself is not changed.
 */
export function unitsPatch(h: Uint8Array, name: string): { at: number; bytes: Uint8Array } {
  const u = UNIT_SETS.find((s) => s.name === name);
  if (!u) throw new Error(`unknown unit "${name}"`);
  if (unitsName(h) === null) throw new Error("this file keeps its units where openvwx can't change them");
  const p = h.slice(0, UNITS_END);
  const dv = new DataView(p.buffer);
  dv.setFloat64(PER_INCH, u.perInch, true);
  dv.setFloat64(AREA_PER, u.area.perSquareInch, true);
  dv.setFloat64(VOLUME_PER, u.volume.perCubicInch, true);
  dv.setUint16(STYLE, u.feet ? FEET_AND_INCHES : 0, true);
  setSlot(p, NAME, NAME_SLOT, u.name);
  setSlot(p, MARK, MARK_SLOT, u.mark);
  setSlot(p, FEET_MARK, MARK_SLOT, u.feet?.mark ?? "");
  setSlot(p, SEPARATOR, MARK_SLOT, u.feet?.separator ?? "");
  const per = u.feet?.per ?? 1;
  dv.setUint16(PER_FOOT, per, true);
  setSlot(p, SQUARE_MARK, SQUARE_SLOT, u.square);
  dv.setUint16(PER_SQUARE_FOOT, per ** 2, true);
  setSlot(p, CUBE_MARK, SQUARE_SLOT, u.cube);
  dv.setUint16(PER_CUBIC_FOOT, per ** 3, true);
  setSlot(p, AREA_NAME, NAME_SLOT, u.area.name);
  setSlot(p, AREA_MARK, SQUARE_SLOT, u.area.mark);
  setSlot(p, VOLUME_NAME, NAME_SLOT, u.volume.name);
  setSlot(p, VOLUME_MARK, SQUARE_SLOT, u.volume.mark);
  return { at: PER_INCH, bytes: p.slice(PER_INCH) };
}
