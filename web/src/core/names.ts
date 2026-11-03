// Name table (record type 55): classes, symbols, record formats, line types, ...
//
//   +0x58  u32 count
//   +0x5c  count x { u32 index; u32 byte_len; UTF-16LE name[byte_len / 2] }

import type { Rec } from "./records.ts";
import { concat, encodeUtf16, readUtf16, setU32, setU64, u32 } from "./bytes.ts";

export function readNameTable(rec: Rec): Map<number, string> {
  const d = rec.data;
  const names = new Map<number, string>();
  const count = u32(d, 0x58);
  let pos = 0x5c;
  for (let k = 0; k < count; k++) {
    const index = u32(d, pos);
    const byteLen = u32(d, pos + 4);
    names.set(index, readUtf16(d, pos + 8, byteLen));
    pos += 8 + byteLen;
  }
  return names;
}

/** Replace the record's entries. Bytes before +0x58 are kept; the size field is updated. */
export function writeNameTable(rec: Rec, names: Map<number, string>): void {
  const parts: Uint8Array[] = [rec.data.slice(0, 0x58)];
  const count = new Uint8Array(4);
  setU32(count, 0, names.size);
  parts.push(count);
  for (const [index, name] of names) {
    const body = encodeUtf16(name);
    const head = new Uint8Array(8);
    setU32(head, 0, index);
    setU32(head, 4, body.length);
    parts.push(head, body);
  }
  const data = concat(parts);
  setU64(data, 0, BigInt(data.length));
  rec.data = data;
}
