// Zip archives read (Excel workbooks, zipped shapefile sets): the central directory's files,
// stored or deflated, each inflated when asked for.

import { inflate } from "../export/flate.ts";

/** The files of a zip archive, by path, read as asked for (stored or deflated entries). */
export function unzip(bytes: Uint8Array): Map<string, () => Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 22 - 0xffff); p--) {
    if (v.getUint32(p, true) === 0x06054b50) {
      end = p;
      break;
    }
  }
  if (end < 0) throw new Error("this isn't a zip archive");
  const count = v.getUint16(end + 10, true);
  let at = v.getUint32(end + 16, true);
  const files = new Map<string, () => Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || v.getUint32(at, true) !== 0x02014b50) throw new Error("the zip archive's directory is damaged");
    const method = v.getUint16(at + 10, true);
    const size = v.getUint32(at + 20, true);
    const nameLength = v.getUint16(at + 28, true);
    const extra = v.getUint16(at + 30, true);
    const comment = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extra + comment;
    files.set(name, () => {
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      const data = bytes.subarray(start, start + size);
      if (method === 0) return data;
      if (method !== 8) throw new Error(`the archive holds ${name} compressed in a way that can't be read`);
      // a zlib header before the raw deflate (inflate doesn't check the trailing checksum)
      const z = new Uint8Array(data.length + 2);
      z.set([0x78, 0x9c]);
      z.set(data, 2);
      return inflate(z);
    });
  }
  return files;
}
