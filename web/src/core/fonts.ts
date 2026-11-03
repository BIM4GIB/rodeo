// The font list: a root record (type 74) naming the fonts texts use. A text names its font by its
// place in this list (Shape.fontIndex), not by the font id an entry carries, which differs from
// file to file for the same font. Layout: u16 count at +0x50, then 518-byte entries from +0x52,
// each u16 0, u16 font id, the name in UTF-16LE (NUL-terminated, zero-padded), u16, u8 1, u8.

import { setU16, setU64, u16 } from "./bytes.ts";

export const FONT_LIST = 74;

const COUNT = 0x50;
const FIRST = 0x52;
const ENTRY = 518;
const ID = 2;
const NAME = 4;
const NAME_BYTES = 510;
const FLAG = 516;

/** Font names in list order; empty when the record does not look like a font list. */
export function readFontList(d: Uint8Array): string[] {
  const n = d.length >= FIRST ? u16(d, COUNT) : 0;
  if (FIRST + ENTRY * n > d.length) return [];
  const names: string[] = [];
  for (let i = 0; i < n; i++) {
    const at = FIRST + ENTRY * i + NAME;
    let name = "";
    for (let k = 0; k < NAME_BYTES; k += 2) {
      const c = u16(d, at + k);
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    names.push(name);
  }
  return names;
}

/** The font list with `name` added at the end, under an id no entry has yet. */
export function withFont(d: Uint8Array, name: string): Uint8Array {
  if (name.length === 0 || 2 * name.length >= NAME_BYTES) throw new Error("font names are 1 to 254 characters");
  const n = u16(d, COUNT);
  let id = 0;
  for (let i = 0; i < n; i++) id = Math.max(id, u16(d, FIRST + ENTRY * i + ID));
  const out = new Uint8Array(FIRST + ENTRY * (n + 1));
  out.set(d.subarray(0, FIRST + ENTRY * n));
  setU64(out, 0, BigInt(out.length));
  setU16(out, COUNT, n + 1);
  const at = FIRST + ENTRY * n;
  setU16(out, at + ID, id + 1);
  for (let k = 0; k < name.length; k++) setU16(out, at + NAME + 2 * k, name.charCodeAt(k));
  out[at + FLAG] = 1;
  return out;
}

/** True for a font drawn narrower than its family's regular face (Arial Narrow, … Condensed). */
export function isNarrowFont(name: string | undefined): boolean {
  return !!name && /narrow|condensed|compressed/i.test(name);
}
