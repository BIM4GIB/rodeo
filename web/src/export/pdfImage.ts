// Image XObjects for the PDF writer, from the PNG and JPEG streams image records hold. A JPEG goes in
// as it is (DCTDecode). A PNG without transparency keeps its compressed pixels, which PDF reads with
// the same row filters (FlateDecode, predictor 15). One with an alpha channel or a transparent
// palette entry is decoded, and its colours and its alpha are written apart, the alpha as a soft
// mask; an alpha that is opaque throughout is left out. Interlaced PNGs and other formats give null.

import { deflate, inflate } from "./flate.ts";

/** A PDF image: the stream's dictionary entries (without /Length) and its data, and its soft mask. */
export interface PdfImage {
  readonly width: number;
  readonly height: number;
  readonly dict: string;
  readonly data: Uint8Array;
  readonly smask?: { readonly dict: string; readonly data: Uint8Array };
}

/** Largest image side written; anything bigger is left out rather than risk running out of memory. */
const MAX_SIDE = 20000;

export function pdfImage(bytes: Uint8Array): PdfImage | null {
  try {
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return pngImage(bytes);
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegImage(bytes);
  } catch {
    // a damaged stream: the image is left out, as one in an unknown format is
  }
  return null;
}

// ---- JPEG ---------------------------------------------------------------------------------

function jpegImage(b: Uint8Array): PdfImage | null {
  let adobe = false;
  for (let i = 2; i + 4 <= b.length; ) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    const len = (b[i + 2] << 8) | b[i + 3];
    // APP14 "Adobe": its CMYK is stored inverted
    if (marker === 0xee && String.fromCharCode(...b.subarray(i + 4, i + 9)) === "Adobe") adobe = true;
    // start of frame (baseline, extended, progressive, lossless, …), not DHT, JPG or DAC
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const bpc = b[i + 4];
      const height = (b[i + 5] << 8) | b[i + 6];
      const width = (b[i + 7] << 8) | b[i + 8];
      const comps = b[i + 9];
      const space = comps === 1 ? "/DeviceGray" : comps === 3 ? "/DeviceRGB" : comps === 4 ? "/DeviceCMYK" : null;
      if (!space || bpc !== 8 || !fits(width, height)) return null;
      const decode = comps === 4 && adobe ? " /Decode [1 0 1 0 1 0 1 0]" : "";
      return { width, height, dict: imageDict(width, height, space, 8, "/DCTDecode") + decode, data: b };
    }
    i += 2 + len;
  }
  return null;
}

// ---- PNG ----------------------------------------------------------------------------------

interface Png {
  width: number;
  height: number;
  depth: number;
  /** 0 grey, 2 RGB, 3 palette, 4 grey and alpha, 6 RGB and alpha */
  colour: number;
  interlaced: boolean;
  palette: Uint8Array | null;
  /** palette alphas (tRNS), for colour type 3 */
  alphas: Uint8Array | null;
  /** the IDAT chunks joined: one zlib stream */
  idat: Uint8Array;
}

function readPng(b: Uint8Array): Png | null {
  const u32 = (i: number): number => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
  let png: Png | null = null;
  const idat: Uint8Array[] = [];
  for (let i = 8; i + 8 <= b.length; ) {
    const len = u32(i);
    const type = String.fromCharCode(...b.subarray(i + 4, i + 8));
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === "IHDR") {
      png = { width: u32(i + 8), height: u32(i + 12), depth: b[i + 16], colour: b[i + 17], interlaced: b[i + 20] !== 0, palette: null, alphas: null, idat: new Uint8Array(0) };
    } else if (type === "PLTE" && png) png.palette = data;
    else if (type === "tRNS" && png) png.alphas = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    i += 12 + len;
  }
  if (!png || idat.length === 0) return null;
  png.idat = join(idat);
  return png;
}

function pngImage(bytes: Uint8Array): PdfImage | null {
  const png = readPng(bytes);
  if (!png || png.interlaced || !fits(png.width, png.height)) return null;
  const { width, height, depth, colour } = png;
  const channels = [1, 0, 3, 1, 2, 0, 4][colour] ?? 0;
  if (channels === 0 || ![1, 2, 4, 8, 16].includes(depth)) return null;
  const paletteSpace = (): string | null => {
    const p = png.palette;
    if (!p || p.length < 3) return null;
    const n = Math.min(Math.floor(p.length / 3), 1 << depth);
    return `[/Indexed /DeviceRGB ${n - 1} <${hex(p.subarray(0, 3 * n))}>]`;
  };

  // grey, RGB and palette images with no transparency: the PNG's own compressed rows
  const transparent = colour === 4 || colour === 6 || (colour === 3 && png.alphas !== null && png.alphas.some((a) => a < 255));
  if (!transparent) {
    const space = colour === 3 ? paletteSpace() : colour === 0 ? "/DeviceGray" : "/DeviceRGB";
    if (!space) return null;
    const parms = `/DecodeParms << /Predictor 15 /Colors ${channels} /BitsPerComponent ${depth} /Columns ${width} >>`;
    return { width, height, dict: `${imageDict(width, height, space, depth, "/FlateDecode")} ${parms}`, data: png.idat };
  }

  // with transparency: decode, then write the colours and the alpha apart (8 bits each)
  const rows = unfilter(inflate(png.idat), width, height, channels, depth);
  const stride = Math.ceil((width * channels * depth) / 8);
  // grey and alpha, or RGB (and alpha, or a palette's)
  const grey = colour === 4;
  const out = grey ? 1 : 3;
  const colours = new Uint8Array(width * height * out);
  const alpha = new Uint8Array(width * height);
  let opaque = true;
  for (let y = 0; y < height; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      let a = 255;
      if (colour === 3) {
        const idx = sample(row, x, depth);
        const p = png.palette;
        if (!p) return null;
        colours.set(p.subarray(3 * idx, 3 * idx + 3), 3 * at);
        a = png.alphas && idx < png.alphas.length ? png.alphas[idx] : 255;
      } else {
        // 8 or 16 bits per sample here (the PNG rules for colour types 4 and 6); 16 keeps the high byte
        const k = depth === 16 ? 2 : 1;
        const base = x * channels * k;
        for (let c = 0; c < out; c++) colours[out * at + c] = row[base + c * k];
        a = row[base + out * k];
      }
      alpha[at] = a;
      if (a !== 255) opaque = false;
    }
  }
  const space = grey ? "/DeviceGray" : "/DeviceRGB";
  const image = {
    width,
    height,
    dict: `${imageDict(width, height, space, 8, "/FlateDecode")} ${predictorParms(out, width)}`,
    data: deflate(filterRows(colours, width, height, out)),
  };
  if (opaque) return image;
  return {
    ...image,
    smask: {
      dict: `${imageDict(width, height, "/DeviceGray", 8, "/FlateDecode")} ${predictorParms(1, width)}`,
      data: deflate(filterRows(alpha, width, height, 1)),
    },
  };
}

/** Reverses the PNG row filters: the rows' bytes, without their filter bytes. */
function unfilter(raw: Uint8Array, width: number, height: number, channels: number, depth: number): Uint8Array {
  const stride = Math.ceil((width * channels * depth) / 8);
  const bpp = Math.max(1, Math.ceil((channels * depth) / 8));
  if (raw.length < (stride + 1) * height) throw new Error("the PNG's pixels are short");
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const at = y * stride;
    for (let x = 0; x < stride; x++) {
      const v = raw[src + x];
      const left = x >= bpp ? out[at + x - bpp] : 0;
      const up = y > 0 ? out[at - stride + x] : 0;
      const corner = x >= bpp && y > 0 ? out[at - stride + x - bpp] : 0;
      out[at + x] =
        f === 0 ? v : f === 1 ? v + left : f === 2 ? v + up : f === 3 ? v + ((left + up) >> 1) : f === 4 ? v + paeth(left, up, corner) : v;
    }
  }
  return out;
}

/**
 * 8-bit samples as PNG-filtered rows, each row taking the filter that leaves the smallest sum of
 * differences (libpng's choice), which the PDF reads back with predictor 15.
 */
function filterRows(px: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array((stride + 1) * height);
  const trial = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const at = y * stride;
    let bestCost = Infinity;
    for (let f = 0; f <= 4; f++) {
      let cost = 0;
      for (let x = 0; x < stride; x++) {
        const v = px[at + x];
        const left = x >= bpp ? px[at + x - bpp] : 0;
        const up = y > 0 ? px[at - stride + x] : 0;
        const corner = x >= bpp && y > 0 ? px[at - stride + x - bpp] : 0;
        const r = (v - (f === 0 ? 0 : f === 1 ? left : f === 2 ? up : f === 3 ? (left + up) >> 1 : paeth(left, up, corner))) & 0xff;
        trial[x] = r;
        cost += r < 128 ? r : 256 - r;
        if (cost >= bestCost) break;
      }
      if (cost < bestCost) {
        bestCost = cost;
        out[y * (stride + 1)] = f;
        out.set(trial, y * (stride + 1) + 1);
      }
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Sample x of a row of 1-, 2-, 4- or 8-bit samples. */
function sample(row: Uint8Array, x: number, depth: number): number {
  if (depth === 8) return row[x];
  const per = 8 / depth;
  const byte = row[Math.floor(x / per)];
  const shift = 8 - depth * ((x % per) + 1);
  return (byte >> shift) & ((1 << depth) - 1);
}

function imageDict(width: number, height: number, space: string, bpc: number, filter: string): string {
  return `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${space} /BitsPerComponent ${bpc} /Filter ${filter}`;
}

function predictorParms(colours: number, width: number): string {
  return `/DecodeParms << /Predictor 15 /Colors ${colours} /BitsPerComponent 8 /Columns ${width} >>`;
}

function fits(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= MAX_SIDE && height <= MAX_SIDE;
}

function hex(b: Uint8Array): string {
  let s = "";
  for (const v of b) s += v.toString(16).padStart(2, "0");
  return s;
}

function join(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
