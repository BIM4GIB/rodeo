// Image files beside PNG, for File > Export > Export Image File…: the drawing's colours as
// Vectorworks offers them (full colour, greyscale or black and white), and TIFF and BMP written here
// (uncompressed, 8 bits a channel), since browsers encode only PNG, JPEG and WebP. JPEG and PNG go
// through the canvas.

export type ImageColor = "full" | "gray" | "bw";

/** RGBA pixels, 8 bits a channel, not premultiplied, rows top down (a canvas's ImageData). */
export interface Pixels {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
}

/** Rec. 601 luma of an RGB colour, 0–255. */
function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Turns the pixels grey (by their luma) or black and white (luma split at the middle), in place; alpha stays. */
export function recolor(data: Uint8ClampedArray, color: ImageColor): void {
  if (color === "full") return;
  for (let i = 0; i < data.length; i += 4) {
    const y = luma(data[i], data[i + 1], data[i + 2]);
    const v = color === "bw" ? (y < 128 ? 0 : 255) : Math.round(y);
    data[i] = data[i + 1] = data[i + 2] = v;
  }
}

const MM_PER_INCH = 25.4;

/**
 * A baseline TIFF, little-endian, uncompressed in one strip: RGB, RGBA (unassociated alpha) with
 * `alpha`, or one grey sample a pixel with `gray` (the pixels are grey already); `dpi` is written
 * as its resolution.
 */
export function encodeTiff(px: Pixels, opts: { alpha: boolean; gray: boolean; dpi: number }): Uint8Array<ArrayBuffer> {
  const samples = opts.gray ? 1 : opts.alpha ? 4 : 3;
  const { width, height } = px;
  const tags: [tag: number, type: 3 | 4 | 5, count: number, value: number][] = [];
  const entries = samples === 4 ? 13 : 12;
  const ifd = 8;
  const ifdSize = 2 + entries * 12 + 4;
  // what doesn't fit in an entry follows the IFD: the bits per sample (of three or four samples), then the resolutions
  let extra = ifd + ifdSize;
  const bitsAt = samples > 2 ? extra : 0;
  if (samples > 2) extra += samples * 2;
  const xResAt = extra;
  const yResAt = extra + 8;
  const dataAt = extra + 16;
  const bytes = width * height * samples;
  tags.push([256, 4, 1, width]);
  tags.push([257, 4, 1, height]);
  tags.push([258, 3, samples, samples > 2 ? bitsAt : 8]);
  tags.push([259, 3, 1, 1]); // no compression
  tags.push([262, 3, 1, opts.gray ? 1 : 2]); // black is zero, or RGB
  tags.push([273, 4, 1, dataAt]);
  tags.push([277, 3, 1, samples]);
  tags.push([278, 4, 1, height]);
  tags.push([279, 4, 1, bytes]);
  tags.push([282, 5, 1, xResAt]);
  tags.push([283, 5, 1, yResAt]);
  tags.push([296, 3, 1, 2]); // inches
  if (samples === 4) tags.push([338, 3, 1, 2]); // the fourth sample is unassociated alpha
  if (tags.length !== entries) throw new Error("TIFF entries miscounted");

  const out = new Uint8Array(dataAt + bytes);
  const dv = new DataView(out.buffer);
  out[0] = out[1] = 0x49; // "II"
  dv.setUint16(2, 42, true);
  dv.setUint32(4, ifd, true);
  dv.setUint16(ifd, entries, true);
  tags.forEach(([tag, type, count, value], i) => {
    const at = ifd + 2 + i * 12;
    dv.setUint16(at, tag, true);
    dv.setUint16(at + 2, type, true);
    dv.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(at + 8, value, true);
    else dv.setUint32(at + 8, value, true);
  });
  dv.setUint32(ifd + 2 + entries * 12, 0, true); // the only IFD
  if (samples > 2) for (let i = 0; i < samples; i++) dv.setUint16(bitsAt + i * 2, 8, true);
  const dpi = Math.max(1, Math.round(opts.dpi));
  for (const at of [xResAt, yResAt]) {
    dv.setUint32(at, dpi, true);
    dv.setUint32(at + 4, 1, true);
  }
  const src = px.data;
  let o = dataAt;
  for (let i = 0; i < width * height; i++) {
    const s = i * 4;
    if (samples === 1) out[o++] = src[s];
    else {
      out[o++] = src[s];
      out[o++] = src[s + 1];
      out[o++] = src[s + 2];
      if (samples === 4) out[o++] = src[s + 3];
    }
  }
  return out;
}

/** A 24-bit Windows bitmap (rows bottom up, each padded to four bytes); `dpi` is written as its resolution. */
export function encodeBmp(px: Pixels, dpi: number): Uint8Array<ArrayBuffer> {
  const { width, height } = px;
  const row = Math.ceil((width * 3) / 4) * 4;
  const header = 14 + 40;
  const size = header + row * height;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out[0] = 0x42; // "BM"
  out[1] = 0x4d;
  dv.setUint32(2, size, true);
  dv.setUint32(10, header, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true); // positive: bottom up
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(30, 0, true); // no compression
  dv.setUint32(34, row * height, true);
  const perMetre = Math.round((dpi / MM_PER_INCH) * 1000);
  dv.setInt32(38, perMetre, true);
  dv.setInt32(42, perMetre, true);
  const src = px.data;
  for (let y = 0; y < height; y++) {
    let o = header + (height - 1 - y) * row;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      out[o++] = src[s + 2];
      out[o++] = src[s + 1];
      out[o++] = src[s];
    }
  }
  return out;
}
