// Writes the app icons into web/public/ from one set of shapes: a rounded square in
// the Rodeo orange with the lasso mark in white (brand/make-logo.py draws the same mark for
// the logo files). Run from web/:
//
//   npx tsx src/features/touch/make-icons.ts
//
// No dependencies: the PNGs are encoded here with node:zlib.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Rgb = readonly [number, number, number];
type Pt = readonly [number, number];
type Cubic = readonly [Pt, Pt, Pt];

/** The mark's parts in icon pixels: stroked ellipse and curves (round ends), a disc, a rounded square. */
type Shape =
  | { readonly kind: "ring"; readonly c: Pt; readonly rx: number; readonly ry: number; readonly rot: number; readonly w: number }
  | { readonly kind: "rope"; readonly from: Pt; readonly curves: readonly Cubic[]; readonly w: number }
  | { readonly kind: "disc"; readonly c: Pt; readonly r: number }
  | { readonly kind: "block"; readonly c: Pt; readonly half: number; readonly r: number };

const ACCENT: Rgb = [0xff, 0x5a, 0x1f];
const INK: Rgb = [0xff, 0xff, 0xff];
/** the rounded square's corner radius, as a share of the icon's size */
const CORNER = 0.22;
/** supersampling per pixel side, for smooth edges */
const SAMPLES = 4;

/**
 * Mark geometry in its own units (a 512 square): the loop, the block caught in it, the knot the
 * rope runs through and the rope trailing away to the lower left. (275, 270) goes to the icon's centre.
 */
const LOOP = { cx: 300, cy: 212, rx: 158, ry: 122, rot: -12 } as const;
const KNOT_AT = 202; // degrees round the loop
const CENTRE: Pt = [275, 270];
const WEIGHT = 34;

/** The lasso for an icon of `size` pixels, `fit` of its size per 512 units of mark geometry. */
function lasso(size: number, fit: number): Shape[] {
  const k = (size * fit) / 512;
  const at = (x: number, y: number): Pt => [size / 2 + (x - CENTRE[0]) * k, size / 2 + (y - CENTRE[1]) * k];
  const t = (KNOT_AT * Math.PI) / 180;
  const r = (LOOP.rot * Math.PI) / 180;
  const ex = LOOP.rx * Math.cos(t);
  const ey = LOOP.ry * Math.sin(t);
  const kx = LOOP.cx + ex * Math.cos(r) - ey * Math.sin(r);
  const ky = LOOP.cy + ex * Math.sin(r) + ey * Math.cos(r);
  return [
    { kind: "ring", c: at(LOOP.cx, LOOP.cy), rx: LOOP.rx * k, ry: LOOP.ry * k, rot: LOOP.rot, w: WEIGHT * k },
    { kind: "block", c: at(LOOP.cx, LOOP.cy), half: 40 * k, r: 11 * k },
    {
      kind: "rope",
      from: at(kx, ky),
      curves: [
        [at(kx - 60, ky + 70), at(170, 360), at(104, 400)],
        [at(38, 440), at(36, 440), at(40, 472)],
      ],
      w: WEIGHT * k,
    },
    { kind: "disc", c: at(kx, ky), r: 31 * k },
  ];
}

/** Distance from (x, y) to the segment a-b. */
function toSegment(x: number, y: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.min(Math.max(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy), 0), 1);
  return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y);
}

/** Distance from (x, y) to the ellipse's outline, by Newton's method on the curve parameter. */
function toEllipse(x: number, y: number, s: Extract<Shape, { kind: "ring" }>): number {
  const r = (-s.rot * Math.PI) / 180;
  const dx = x - s.c[0];
  const dy = y - s.c[1];
  const px = dx * Math.cos(r) - dy * Math.sin(r);
  const py = dx * Math.sin(r) + dy * Math.cos(r);
  const a = s.rx;
  const b = s.ry;
  let t = Math.atan2(a * py, b * px);
  for (let i = 0; i < 4; i++) {
    const sin = Math.sin(t);
    const cos = Math.cos(t);
    const g = (b * b - a * a) * sin * cos + a * px * sin - b * py * cos;
    const dg = (b * b - a * a) * (cos * cos - sin * sin) + a * px * cos + b * py * sin;
    if (dg === 0) break;
    t -= g / dg;
  }
  return Math.hypot(a * Math.cos(t) - px, b * Math.sin(t) - py);
}

/** The rope as a polyline, fine enough that its stroke matches the curves to well under a pixel. */
function flatten(s: Extract<Shape, { kind: "rope" }>): Pt[] {
  const pts: Pt[] = [s.from];
  let p0 = s.from;
  for (const [p1, p2, p3] of s.curves) {
    for (let i = 1; i <= 64; i++) {
      const t = i / 64;
      const u = 1 - t;
      pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    p0 = p3;
  }
  return pts;
}

/** A test for whether a point is in the shape. */
function hitTest(s: Shape): (x: number, y: number) => boolean {
  switch (s.kind) {
    case "disc":
      return (x, y) => Math.hypot(x - s.c[0], y - s.c[1]) <= s.r;
    case "block":
      return (x, y) => {
        const dx = Math.abs(x - s.c[0]);
        const dy = Math.abs(y - s.c[1]);
        if (dx > s.half || dy > s.half) return false;
        return Math.hypot(Math.max(dx - s.half + s.r, 0), Math.max(dy - s.half + s.r, 0)) <= s.r;
      };
    case "ring":
      return (x, y) => toEllipse(x, y, s) <= s.w / 2;
    case "rope": {
      const pts = flatten(s);
      const pad = s.w / 2;
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
      return (x, y) => {
        if (x < x0 || x > x1 || y < y0 || y > y1) return false;
        for (let i = 1; i < pts.length; i++) if (toSegment(x, y, pts[i - 1], pts[i]) <= pad) return true;
        return false;
      };
    }
  }
}

/** The rounded square (radius r; 0 for a full square) holds (x, y). */
function inSquare(x: number, y: number, size: number, r: number): boolean {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  if (r === 0) return true;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return Math.hypot(x - cx, y - cy) <= r;
}

/** RGBA pixels: the accent square, the mark in white, edges antialiased. */
function raster(size: number, rounded: boolean, shapes: readonly Shape[]): Buffer {
  const out = Buffer.alloc(size * size * 4);
  const tests = shapes.map(hitTest);
  const radius = rounded ? size * CORNER : 0;
  const n = SAMPLES * SAMPLES;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) / SAMPLES;
          const y = py + (sy + 0.5) / SAMPLES;
          if (!inSquare(x, y, size, radius)) continue;
          const c = tests.some((inside) => inside(x, y)) ? INK : ACCENT;
          r += c[0];
          g += c[1];
          b += c[2];
          covered++;
        }
      }
      const i = (py * size + px) * 4;
      if (covered > 0) {
        out[i] = Math.round(r / covered);
        out[i + 1] = Math.round(g / covered);
        out[i + 2] = Math.round(b / covered);
      }
      out[i + 3] = Math.round((255 * covered) / n);
    }
  }
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** An 8-bit RGBA PNG: each row prefixed with filter type 0. */
function encodePng(size: number, rgba: Buffer): Buffer {
  const stride = size * 4;
  const rows = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([PNG_SIGNATURE, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

function hex(c: Rgb): string {
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function num(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function element(s: Shape): string {
  const ink = hex(INK);
  switch (s.kind) {
    case "disc":
      return `<circle cx="${num(s.c[0])}" cy="${num(s.c[1])}" r="${num(s.r)}" fill="${ink}"/>`;
    case "block":
      return `<rect x="${num(s.c[0] - s.half)}" y="${num(s.c[1] - s.half)}" width="${num(2 * s.half)}" height="${num(2 * s.half)}" rx="${num(s.r)}" fill="${ink}"/>`;
    case "ring":
      return `<ellipse cx="${num(s.c[0])}" cy="${num(s.c[1])}" rx="${num(s.rx)}" ry="${num(s.ry)}" transform="rotate(${s.rot} ${num(s.c[0])} ${num(s.c[1])})" fill="none" stroke="${ink}" stroke-width="${num(s.w)}"/>`;
    case "rope": {
      const pt = (p: Pt): string => `${num(p[0])} ${num(p[1])}`;
      const d = `M${pt(s.from)}` + s.curves.map((c) => `C${c.map(pt).join(" ")}`).join("");
      return `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${num(s.w)}" stroke-linecap="round"/>`;
    }
  }
}

function svg(size: number, rounded: boolean, shapes: readonly Shape[]): string {
  const rx = rounded ? ` rx="${num(size * CORNER)}"` : "";
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">`,
    `  <rect width="${size}" height="${size}"${rx} fill="${hex(ACCENT)}"/>`,
    ...shapes.map((s) => `  ${element(s)}`),
    "</svg>",
    "",
  ].join("\n");
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../public");
mkdirSync(out, { recursive: true });

// any-purpose icons are rounded squares; maskable and iOS icons are full squares, their
// mark held inside the central safe area (a circle of 40% of the size)
const SVG_FIT = 0.8;
const SAFE_FIT = 0.6;
writeFileSync(resolve(out, "icon.svg"), svg(512, true, lasso(512, SVG_FIT)));
writeFileSync(resolve(out, "icon-maskable.svg"), svg(512, false, lasso(512, SAFE_FIT)));

const pngs: { file: string; size: number; rounded: boolean; fit: number }[] = [
  { file: "icon-192.png", size: 192, rounded: true, fit: SVG_FIT },
  { file: "icon-512.png", size: 512, rounded: true, fit: SVG_FIT },
  { file: "icon-maskable-512.png", size: 512, rounded: false, fit: SAFE_FIT },
  { file: "apple-touch-icon.png", size: 180, rounded: false, fit: SAFE_FIT },
];
for (const p of pngs) {
  writeFileSync(resolve(out, p.file), encodePng(p.size, raster(p.size, p.rounded, lasso(p.size, p.fit))));
}
console.log(`Icons written to ${out}`);
