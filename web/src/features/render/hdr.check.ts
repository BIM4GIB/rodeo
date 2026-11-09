// Checks the Radiance HDR writer under Node. Run from web/:
//   npx tsx src/features/render/hdr.check.ts [out.hdr]
// Pictures of gradients over eight decades, flat stretches (runs past 127), noise (literal stretches
// past 128), black, negative, NaN, an exact power of two and a value too bright to hold go through
// encodeHdr and back through a reader written here to the Radiance format's own rules (the run-length
// coding, and (m + ½) / 256 · 2^(e − 128) a channel); each channel must come back within half an RGBE
// step of its pixel's brightest channel. three.js's HDRLoader must read the files too (it decodes
// m / 255 · 2^(e − 128), so within two steps). With a path, the first picture is also written there,
// for another reader (Blender) to check.

import { writeFileSync } from "node:fs";
import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { encodeHdr } from "./hdr.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

/** A test picture: rows of different kinds, top row first. */
function picture(width: number, height: number): Float32Array {
  const px = new Float32Array(width * height * 4);
  let seed = 7;
  const rand = (): number => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const kind = y % 5;
      let rgb: [number, number, number];
      if (kind === 0) {
        // eight decades, coloured
        const v = 10 ** (-4 + (8 * x) / Math.max(1, width - 1));
        rgb = [v, v * 0.5, v * 0.25];
      } else if (kind === 1) {
        rgb = [0.75, 0.75, 0.75];
      } else if (kind === 2) {
        rgb = [rand() * 4, rand() * 4, rand() * 4];
      } else if (kind === 3) {
        rgb = x < width / 2 ? [0, 0, 0] : [2, 1, 0.5];
      } else {
        rgb = [rand() < 0.5 ? 0.3 : 0.6, 0.1, 0.9];
      }
      px[p] = rgb[0];
      px[p + 1] = rgb[1];
      px[p + 2] = rgb[2];
      px[p + 3] = 1;
    }
  }
  return px;
}

/** Reads a .hdr as the Radiance format defines it: the header, then each scanline flat or run-length coded. */
function readHdr(bytes: Uint8Array): { width: number; height: number; data: Float32Array } {
  let at = 0;
  const line = (): string => {
    const end = bytes.indexOf(10, at);
    const text = new TextDecoder().decode(bytes.subarray(at, end));
    at = end + 1;
    return text;
  };
  if (line() !== "#?RADIANCE") throw new Error("no #?RADIANCE");
  let format = "";
  for (let l = line(); l !== ""; l = line()) if (l.startsWith("FORMAT=")) format = l.slice(7);
  if (format !== "32-bit_rle_rgbe") throw new Error(`format ${format}`);
  const size = /^-Y (\d+) \+X (\d+)$/.exec(line());
  if (!size) throw new Error("no -Y H +X W");
  const height = Number(size[1]);
  const width = Number(size[2]);
  const data = new Float32Array(width * height * 4);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (width >= 8 && width <= 32767 && bytes[at] === 2 && bytes[at + 1] === 2 && !(bytes[at + 2] & 128)) {
      if (((bytes[at + 2] << 8) | bytes[at + 3]) !== width) throw new Error(`scanline ${y}: wrong width`);
      at += 4;
      for (let c = 0; c < 4; c++) {
        for (let x = 0; x < width; ) {
          const n = bytes[at++];
          if (n > 128) {
            const v = bytes[at++];
            for (let k = 0; k < n - 128; k++) scan[(x++) * 4 + c] = v;
          } else {
            if (n === 0) throw new Error(`scanline ${y}: a zero count`);
            for (let k = 0; k < n; k++) scan[(x++) * 4 + c] = bytes[at++];
          }
          if (x > width) throw new Error(`scanline ${y}: overruns`);
        }
      }
    } else {
      scan.set(bytes.subarray(at, at + width * 4));
      at += width * 4;
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3];
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[p + c] = e === 0 ? 0 : ((scan[x * 4 + c] + 0.5) / 256) * 2 ** (e - 128);
      data[p + 3] = 1;
    }
  }
  if (at !== bytes.length) throw new Error(`${bytes.length - at} bytes left over`);
  return { width, height, data };
}

/** What three.js reads of a .hdr file. */
function readThree(bytes: ArrayBuffer): { width: number; height: number; data: Float32Array } {
  const loader = new HDRLoader();
  loader.setDataType(THREE.FloatType);
  return loader.parse(bytes) as { width: number; height: number; data: Float32Array };
}

async function roundTrip(pixels: Float32Array, width: number, height: number): Promise<Float32Array> {
  const bytes = await encodeHdr(pixels, width, height).arrayBuffer();
  const parsed = readHdr(new Uint8Array(bytes));
  if (parsed.width !== width || parsed.height !== height) throw new Error(`read back ${parsed.width} × ${parsed.height}`);
  const three = readThree(bytes);
  check(three.width === width && three.height === height && worst(pixels, three.data, width, height) <= 2.0001, `three.js reads it too, within two steps (worst ${worst(pixels, three.data, width, height).toFixed(3)})`);
  return parsed.data;
}

/** The largest error of any channel over its pixel's brightest channel's RGBE step (2^e / 256). */
function worst(a: Float32Array, b: Float32Array, width: number, height: number): number {
  let out = 0;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const peak = Math.max(a[p], a[p + 1], a[p + 2], 0);
    // past what RGBE holds either way, or NaN: not a value to come back
    if (!(peak < 2 ** 127) || (peak > 0 && peak < 2 ** -128)) continue;
    // the encoder's exponent: peak = m · 2^e with m in [½, 1)
    const step = peak > 0 ? 2 ** (Math.floor(Math.log2(peak)) + 1) / 256 : 1e-30;
    for (let c = 0; c < 3; c++) out = Math.max(out, Math.abs(Math.max(a[p + c], 0) - b[p + c]) / step);
  }
  return out;
}

const W = 1000;
const H = 25;
const pic = picture(W, H);
console.log("1000 × 25 (run-length coded)");
const back = await roundTrip(pic, W, H);
check(worst(pic, back, W, H) <= 0.5001, `every channel within half an RGBE step (worst ${worst(pic, back, W, H).toFixed(3)})`);
const blob = encodeHdr(pic, W, H);
check(blob.size < W * H * 4, `smaller than flat (${blob.size} of ${W * H * 4} bytes)`);
check(Math.abs(back[(1 * W + 10) * 4] - 0.75) <= 0.5 / 256, "a flat row reads back 0.75 within half a step");

console.log("5 × 6 (too narrow to code: flat)");
const narrow = picture(5, 6);
const narrowBack = await roundTrip(narrow, 5, 6);
check(worst(narrow, narrowBack, 5, 6) <= 0.5001, "within half an RGBE step");

console.log("edge values");
const edge = new Float32Array([1, 0.5, 0.25, 1, -3, 2, 0, 1, Number.NaN, 1, 1, 1, 3e38, 0, 0, 1, 2 ** -20, 0, 0, 1, 0, 0, 0, 1, 256, 256, 256, 1, 1e-40, 0, 0, 1]);
const edgeBack = await roundTrip(edge, 8, 1);
const near = (v: number, want: number, step: number): boolean => Math.abs(v - want) <= step / 2 + 1e-12;
check(near(edgeBack[0], 1, 1 / 128) && near(edgeBack[1], 0.5, 1 / 128) && near(edgeBack[2], 0.25, 1 / 128), "1, ½, ¼ (an exact power of two) within half a step");
check(edgeBack[4] < 1 / 64 && near(edgeBack[5], 2, 2 / 128), "a negative channel reads (about) 0, the others kept");
check(edgeBack[8] === 0 && edgeBack[9] === 0 && edgeBack[10] === 0, "NaN is black");
check(edgeBack[12] > 1.69e38, `too bright to hold: the brightest RGBE value (${edgeBack[12].toExponential(2)})`);
check(near(edgeBack[16], 2 ** -20, 2 ** -20 / 128), "2^-20 kept");
check(near(edgeBack[24], 256, 256 / 128) && near(edgeBack[25], 256, 256 / 128), "256 (a mantissa of 1 bumps the exponent)");
check(edgeBack[28] === 0, "below what RGBE holds: black");

const out = process.argv[2];
if (out) {
  writeFileSync(out, new Uint8Array(await blob.arrayBuffer()));
  // the values another reader should find: (x, y from the top) → rgb
  const probes = [
    [0, 0],
    [500, 0],
    [999, 0],
    [10, 1],
    [999, 3],
    [3, 5],
  ].map(([x, y]) => ({ x, y, rgb: [0, 1, 2].map((c) => back[(y * W + x) * 4 + c]) }));
  writeFileSync(`${out}.json`, JSON.stringify({ width: W, height: H, probes }));
  console.log(`wrote ${out}`);
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all passed");
