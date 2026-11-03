// Compound files read (Microsoft's Compound File Binary format, "OLE2"): the container Revit
// files, old Office documents and many Windows formats are, a small file system of named streams
// in storages. Little-endian throughout.
//
//   header, 512 bytes: D0 CF 11 E0 A1 B1 1A E1, +0x1e u16 sector shift (9: 512-byte sectors in
//   version 3, 12: 4096 in version 4), +0x20 u16 mini sector shift (6), +0x2c u32 FAT sector
//   count, +0x30 u32 first directory sector, +0x38 u32 mini stream cutoff (4096), +0x3c u32 first
//   mini FAT sector, +0x44 u32 first DIFAT sector, +0x4c 109 u32 FAT sector numbers (the DIFAT's
//   head; further DIFAT sectors list the rest, their last u32 the next DIFAT sector).
//   Sector n starts at (n + 1) << shift. The FAT gives each sector the next one of its chain.
//   A directory entry, 128 bytes: UTF-16 name, +0x40 u16 name length in bytes with its null,
//   +0x42 u8 type (1 storage, 2 stream, 5 root), +0x44 u32 left and +0x48 right sibling, +0x4c
//   child (a storage's children are a tree through the siblings), +0x74 u32 start sector, +0x78
//   u32 size. The root entry's chain is the mini stream: streams under the cutoff live there in
//   64-byte mini sectors, chained by the mini FAT.

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END = 0xfffffffe;
const NONE = 0xffffffff;

/** True when `bytes` start as a compound file does. */
export function isCompoundFile(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * A compound file's streams, by path ("BasicFileInfo", "Formats/Latest"), each read when asked
 * for. Throws when the file isn't one or its tables are damaged; a stream whose chain is damaged
 * throws when read.
 */
export function readCompoundFile(bytes: Uint8Array): Map<string, () => Uint8Array> {
  if (!isCompoundFile(bytes)) throw new Error("this isn't a compound file");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (at: number): number => v.getUint32(at, true);
  const shift = v.getUint16(0x1e, true);
  const miniShift = v.getUint16(0x20, true);
  if (shift !== 9 && shift !== 12) throw new Error("the compound file's sector size isn't one known");
  const size = 1 << shift;
  const miniSize = 1 << miniShift;
  const cutoff = u32(0x38);
  const sectors = Math.ceil((bytes.length - size) / size);
  const sectorAt = (n: number): number => {
    if (n >= sectors) throw new Error("the compound file is cut short or damaged");
    return (n + 1) * size;
  };

  // the FAT's own sectors: 109 in the header, the rest down the DIFAT chain
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) {
    const n = u32(0x4c + i * 4);
    if (n !== NONE) fatSectors.push(n);
  }
  const seen = new Set<number>();
  for (let d = u32(0x44); d !== END && d !== NONE; d = u32(sectorAt(d) + size - 4)) {
    if (seen.has(d)) throw new Error("the compound file's tables loop");
    seen.add(d);
    for (let i = 0; i < size / 4 - 1; i++) {
      const n = u32(sectorAt(d) + i * 4);
      if (n !== NONE) fatSectors.push(n);
    }
  }
  const fat = new Uint32Array(fatSectors.length * (size / 4));
  fatSectors.forEach((n, i) => {
    const at = sectorAt(n);
    for (let j = 0; j < size / 4; j++) fat[i * (size / 4) + j] = u32(at + j * 4);
  });

  /** The sectors of the chain from `start`, following `table`. */
  const chain = (start: number, table: Uint32Array): number[] => {
    const out: number[] = [];
    for (let n = start; n !== END && n !== NONE; n = table[n]) {
      if (n >= table.length || out.length > table.length) throw new Error("a stream's chain in the compound file is damaged");
      out.push(n);
    }
    return out;
  };
  const readChain = (start: number, length: number): Uint8Array => {
    const out = new Uint8Array(length);
    let at = 0;
    for (const n of chain(start, fat)) {
      if (at >= length) break;
      const from = sectorAt(n);
      const part = bytes.subarray(from, Math.min(from + size, from + length - at));
      out.set(part, at);
      at += part.length;
    }
    if (at < length) throw new Error("a stream in the compound file is cut short");
    return out;
  };

  const dirChain = chain(u32(0x30), fat);
  const dir = new Uint8Array(dirChain.length * size);
  dirChain.forEach((n, i) => dir.set(bytes.subarray(sectorAt(n), sectorAt(n) + size), i * size));
  const dv = new DataView(dir.buffer);
  const count = dir.length / 128;
  const entry = (i: number) => {
    const at = i * 128;
    const nameBytes = Math.max(0, Math.min(64, dv.getUint16(at + 0x40, true)) - 2);
    let name = "";
    for (let k = 0; k < nameBytes; k += 2) name += String.fromCharCode(dv.getUint16(at + k, true));
    return {
      name,
      type: dir[at + 0x42],
      left: dv.getUint32(at + 0x44, true),
      right: dv.getUint32(at + 0x48, true),
      child: dv.getUint32(at + 0x4c, true),
      start: dv.getUint32(at + 0x74, true),
      // version 3 files may leave junk in the high half
      size: dv.getUint32(at + 0x78, true),
    };
  };
  const root = entry(0);
  if (root.type !== 5) throw new Error("the compound file's directory is damaged");

  const miniFat = (() => {
    const start = u32(0x3c);
    if (start === END || start === NONE) return new Uint32Array();
    const sectorsOf = chain(start, fat);
    const out = new Uint32Array(sectorsOf.length * (size / 4));
    sectorsOf.forEach((n, i) => {
      for (let j = 0; j < size / 4; j++) out[i * (size / 4) + j] = u32(sectorAt(n) + j * 4);
    });
    return out;
  })();
  let mini: Uint8Array | null = null;
  const readMini = (start: number, length: number): Uint8Array => {
    mini ??= readChain(root.start, root.size);
    const out = new Uint8Array(length);
    let at = 0;
    for (const n of chain(start, miniFat)) {
      if (at >= length) break;
      const part = mini.subarray(n * miniSize, Math.min(n * miniSize + miniSize, n * miniSize + length - at));
      out.set(part, at);
      at += part.length;
    }
    if (at < length) throw new Error("a small stream in the compound file is cut short");
    return out;
  };

  const streams = new Map<string, () => Uint8Array>();
  const visited = new Set<number>();
  const walk = (i: number, prefix: string): void => {
    if (i === NONE || i >= count || visited.has(i)) return;
    visited.add(i);
    const e = entry(i);
    walk(e.left, prefix);
    walk(e.right, prefix);
    const path = prefix + e.name;
    if (e.type === 1) walk(e.child, path + "/");
    else if (e.type === 2) streams.set(path, () => (e.size < cutoff ? readMini(e.start, e.size) : readChain(e.start, e.size)));
  };
  walk(root.child, "");
  return streams;
}
