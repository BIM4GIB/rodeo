// The resource library: named records of resource types, wherever they sit
// (the symbol library 54 and its folders 92, the class list 57, the root).
//
// Every resource kind has its own record type. Thumbnails are type-119
// children holding a PNG or JPEG stream that starts at +0xea (or +0xfa).
// Hatches (66): flags at +0x51 (bit 0: sized on the page, not the world), the
// background colour index (u16) at +0x54, u16 line count at +0x56, then 60-byte
// lines from +0x58: base point, period vector and offset to the next parallel
// line, each stored (y, x), and the dash fraction, f64s in inches; then the
// line's colour index (u16) and pen weight (u8, mils); the record ends there.
// Its previews are type-119 children, 256 and 64 pixels square in the demos.
// A type-76 child tagged "SGAT" holds the hatch's tags, when it has any.
//
// A preview (119): width and height u32 at +0x7c and +0x80, then from +0x94 a
// QuickTime image description: its own size (u32, 0x56, or 0x66 with a 16-byte
// "gama" atom after it), the codec ("png " or "jpeg", stored backwards), the
// size again as u16 at +0xb4, +0xb6, the image's length u32 at +0xc0, the
// compressor's name (a 32-byte Pascal string) at +0xc6, the depth (u16, 32
// or 24) at +0xe6 and the colour table id (-1, none) at +0xe8. An 8-bit image
// has depth 8, table 0 and a 0x808-byte colour table after the description,
// whose size is then 0x85e. The image follows the description, then a byte
// when that leaves the record's length odd (its value can be anything).
//
// Tiles (108): the motif is a type-11 child group of ordinary objects in mm;
// it repeats along two vectors stored (y, x) at +0x5a and +0x6a.
//
// Gradients (120): u16 stop count at +0x52, then 24-byte stops from +0x54:
// f64 position (0..1), f64 midpoint (where the blend to the next stop is half
// way, as a fraction of the gap), u16 red, green, blue (0..255), u16 opacity
// (0..100); the record ends after the stops. Two previews (256 and 64 pixels
// square) are its children.
//
// Textures (97) keep their shaders as type-48 children; a shader that uses an
// image holds it in a type-93 child, again as a type-119 record. The 48's
// format names the shader: "NNAMaxon Image Color" holds the image the texture
// shows, "NNAMaxon Image Mask Transparency" a mask (black clear, white solid)
// that cuts it out, as image props and Laubwerk plants' leaves are. The mask's
// shader comes first. The texture's
// size (the real-world width its image covers) is an f64 at +0x5a, in inches
// as far as the demo files show (a "24x24 tile" texture reads 24).

import { readAttrs } from "./attrs.ts";
import { concat, f64, setF64, setU16, setU32, setU64, u16, u32 } from "./bytes.ts";
import { decodeShape } from "./geometry.ts";
import type { Rec } from "./records.ts";
import type { GradientStop, HatchFill, HatchLine, ResourceInfo, ResourceKind, Shape, TextStyleDef, TileFill } from "./types.ts";

export const RESOURCE_TYPES: ReadonlyMap<number, ResourceKind> = new Map<number, ResourceKind>([
  [16, "symbol"],
  [18, "worksheet"],
  [19, "material"],
  [47, "record-format"],
  [66, "hatch"],
  [96, "line-type"],
  [97, "texture"],
  [102, "slab-style"],
  [106, "render-style"],
  [107, "roof-style"],
  [108, "tile"],
  [109, "text-style"],
  [115, "background"],
  [120, "gradient"],
  [127, "wall-style"],
]);

const PREVIEW_TYPE = 119;
const SHADER_IMAGE_TYPE = 93;
/** a shader's settings: a data record (48) and where it names its format */
const RECORD_TYPE = 48;
const RECORD_FORMAT = 0x50;
const FOLDER_TYPE = 92;
const IMAGE_SCAN_START = 0xe0;
const IMAGE_SCAN_END = 0x140;
const TEXTURE_SIZE = 0x5a;
const MM_PER_INCH = 25.4;

/**
 * A text style (109): u16 font (its place in the font list, as a text's) at +0x52, f64 size in
 * inches at +0x58, then u8 vertical and u8 horizontal alignment at +0x62 / +0x63 (a text's
 * values). Its two children are previews. The rest (+0x56, +0x57, +0x60, +0x64) is not known.
 */
export const TEXT_STYLE_TYPE = 109;
const TEXT_STYLE_FONT = 0x52;
const TEXT_STYLE_SIZE = 0x58;
const TEXT_STYLE_V_ALIGN = 0x62;
const TEXT_STYLE_H_ALIGN = 0x63;
/** the record's length in every demo file */
const TEXT_STYLE_LENGTH = 0x6e;
const POINTS_PER_INCH = 72;

export function readTextStyle(d: Uint8Array): TextStyleDef | null {
  if (d.length < TEXT_STYLE_H_ALIGN + 1) return null;
  const inches = f64(d, TEXT_STYLE_SIZE);
  const vAlign = d[TEXT_STYLE_V_ALIGN];
  const hAlign = d[TEXT_STYLE_H_ALIGN];
  if (!(inches > 0 && inches < 100) || hAlign < 1 || hAlign > 3 || vAlign < 1 || vAlign > 5) return null;
  return { fontIndex: u16(d, TEXT_STYLE_FONT), points: inches * POINTS_PER_INCH, hAlign, vAlign };
}

/** A copy of a text style record holding `def`; the bytes not known are kept. */
export function writeTextStyle(d: Uint8Array, def: TextStyleDef): Uint8Array {
  if (d.length < TEXT_STYLE_H_ALIGN + 1) throw new Error("this text style's record is too short to edit");
  if (!(def.points > 0 && def.points / POINTS_PER_INCH < 100)) throw new Error("a text style's size is a positive number of points");
  if (![1, 2, 3].includes(def.hAlign) || ![1, 2, 3, 4, 5].includes(def.vAlign)) throw new Error("no such text alignment");
  if (!(Number.isInteger(def.fontIndex) && def.fontIndex >= 0 && def.fontIndex <= 0xffff)) throw new Error("no such font");
  const out = d.slice();
  setU16(out, TEXT_STYLE_FONT, def.fontIndex);
  setF64(out, TEXT_STYLE_SIZE, def.points / POINTS_PER_INCH);
  out[TEXT_STYLE_V_ALIGN] = def.vAlign;
  out[TEXT_STYLE_H_ALIGN] = def.hAlign;
  return out;
}

/**
 * A new text style record with the header of `like` (another resource record) and `def`; the
 * bytes not known take the values every demo style has (+0x56 and +0x57 1, +0x60 and +0x61 0xff,
 * +0x64 1). The caller sets its name, owner and GUID.
 */
export function newTextStyle(like: Uint8Array, def: TextStyleDef): Uint8Array {
  const out = new Uint8Array(TEXT_STYLE_LENGTH);
  out.set(like.subarray(0, 0x50));
  out[0x19] = TEXT_STYLE_TYPE;
  setU64(out, 0, BigInt(out.length));
  out[0x56] = out[0x57] = 1;
  out[0x60] = out[0x61] = 0xff;
  out[0x64] = 1;
  return writeTextStyle(out, def);
}
const HATCH_FLAGS = 0x51;
const HATCH_PAGE = 0x01;
const HATCH_BACKGROUND = 0x54;
const HATCH_COUNT = 0x56;
const HATCH_LINES = 0x58;
const HATCH_LINE_SIZE = 60;
const HATCH_LINE_COLOR = 56;
const HATCH_LINE_WEIGHT = 58;
const PREVIEW_WIDTH = 0x7c;
const PREVIEW_HEIGHT = 0x80;
const PREVIEW_DESC = 0x94;
const PREVIEW_CODEC = 0x98;
const PREVIEW_LENGTH = 0xc0;
const PREVIEW_NAME = 0xc6;
const PREVIEW_DEPTH = 0xe6;
const PREVIEW_CLUT = 0xe8;
/** where the image starts after a plain image description */
const PREVIEW_PNG = 0xea;
const PREVIEW_DESC_SIZE = PREVIEW_PNG - PREVIEW_DESC;
const GRADIENT_TYPE = 120;
const TILE_U = 0x5a;
const TILE_V = 0x6a;
const TILE_GROUP_TYPE = 11;
const GRADIENT_COUNT = 0x52;
const GRADIENT_STOPS = 0x54;
const GRADIENT_STOP_SIZE = 24;

/** A PNG's or JPEG's size in pixels, from its header (a JPEG's frame marker), or null. */
export function imagePixels(b: Uint8Array, mime: string): { width: number; height: number } | null {
  const be16 = (at: number): number => (b[at] << 8) | b[at + 1];
  const be32 = (at: number): number => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
  if (mime === "image/png") return b.length >= 24 ? { width: be32(16), height: be32(20) } : null;
  // JPEG: segments from after the start marker; a start-of-frame (C0-CF, not C4 C8 CC) holds the size
  for (let i = 2; i + 9 < b.length; ) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { width: be16(i + 7), height: be16(i + 5) };
    i += 2 + be16(i + 2);
  }
  return null;
}

/** The PNG or JPEG stream that starts at `i`, if one does. */
function imageAt(d: Uint8Array, i: number): { bytes: Uint8Array; mime: string } | null {
  if (i + 4 > d.length) return null;
  if (d[i] === 0x89 && d[i + 1] === 0x50 && d[i + 2] === 0x4e && d[i + 3] === 0x47) return { bytes: d.subarray(i), mime: "image/png" };
  if (d[i] === 0xff && d[i + 1] === 0xd8 && d[i + 2] === 0xff) return { bytes: d.subarray(i), mime: "image/jpeg" };
  return null;
}

/**
 * PNG or JPEG bytes embedded in a record: where its image description says they start (past
 * an 8-bit image's colour table too), or else found by their signature near +0xea.
 */
export function embeddedImage(r: Rec): { bytes: Uint8Array; mime: string } | null {
  const d = r.data;
  const after = d.length >= PREVIEW_DESC + 4 ? imageAt(d, PREVIEW_DESC + u32(d, PREVIEW_DESC)) : null;
  if (after) return after;
  const end = Math.min(d.length - 4, IMAGE_SCAN_END);
  for (let i = IMAGE_SCAN_START; i < end; i++) {
    const img = imageAt(d, i);
    if (img) return img;
  }
  return null;
}

function preview(r: Rec): { bytes: Uint8Array; mime: string } | null {
  for (const c of r.children) {
    if (c.type !== PREVIEW_TYPE) continue;
    const img = embeddedImage(c);
    if (img) return img;
  }
  return null;
}

type Embedded = { bytes: Uint8Array; mime: string };

/**
 * The images a texture's shaders hold: the one it shows (the first not a transparency shader's,
 * usually the colour shader's) and its transparency mask, when it has one.
 */
function textureImages(r: Rec, names: ReadonlyMap<number, string>): { image: Embedded | null; mask: Embedded | null } {
  let image: Embedded | null = null;
  let mask: Embedded | null = null;
  const stack = r.children.map((c) => ({ c, shader: "" }));
  while (stack.length) {
    const { c, shader } = stack.shift()!;
    const name = c.type === RECORD_TYPE && c.data.length >= RECORD_FORMAT + 2 ? (names.get(u16(c.data, RECORD_FORMAT)) ?? "") : shader;
    if (c.type === SHADER_IMAGE_TYPE) {
      const transparency = /transparen/i.test(name);
      for (const g of c.children) {
        if (g.type !== PREVIEW_TYPE || (transparency ? mask : image)) continue;
        const img = embeddedImage(g);
        if (img && transparency) mask = img;
        else if (img) image = img;
      }
    }
    if (c.type !== PREVIEW_TYPE) stack.push(...c.children.map((g) => ({ c: g, shader: name })));
  }
  return { image, mask };
}

function hatchFill(r: Rec): HatchFill | null {
  return readHatch(r.data);
}

export function readHatch(d: Uint8Array): HatchFill | null {
  if (d.length < HATCH_LINES) return null;
  const n = u16(d, HATCH_COUNT);
  if (n === 0 || HATCH_LINES + n * HATCH_LINE_SIZE > d.length) return null;
  const lines: HatchLine[] = [];
  for (let i = 0; i < n; i++) {
    const at = HATCH_LINES + i * HATCH_LINE_SIZE;
    const v = Array.from({ length: 7 }, (_, k) => f64(d, at + 8 * k));
    if (!v.every(Number.isFinite)) return null;
    const mm = v.map((x, k) => (k < 6 ? x * MM_PER_INCH : x));
    lines.push({
      base: { x: mm[1], y: mm[0] },
      period: { x: mm[3], y: mm[2] },
      offset: { x: mm[5], y: mm[4] },
      dash: Math.max(0, Math.min(1, mm[6])),
      color: u16(d, at + HATCH_LINE_COLOR),
      weight: d[at + HATCH_LINE_WEIGHT],
    });
  }
  return { lines, page: (d[HATCH_FLAGS] & HATCH_PAGE) !== 0, background: u16(d, HATCH_BACKGROUND) };
}

/** The hatch record with `hatch`'s lines, ground and page sizing; the other flags stay. */
export function writeHatch(d: Uint8Array, hatch: HatchFill): Uint8Array {
  if (hatch.lines.length === 0 || hatch.lines.length > 0xffff) throw new Error("a hatch needs from 1 to 65535 lines");
  const old = readHatch(d)?.lines ?? [];
  const lines = new Uint8Array(HATCH_LINE_SIZE * hatch.lines.length);
  hatch.lines.forEach((l, i) => {
    const at = i * HATCH_LINE_SIZE;
    // a line left as it was keeps its bytes (inches to mm and back can move the last digit)
    if (old[i] && sameLine(old[i], l)) {
      lines.set(d.subarray(HATCH_LINES + at, HATCH_LINES + at + HATCH_LINE_SIZE), at);
      return;
    }
    const v = [l.base.y, l.base.x, l.period.y, l.period.x, l.offset.y, l.offset.x];
    if (![...v, l.dash].every(Number.isFinite)) throw new Error("a hatch line's sizes must be numbers");
    v.forEach((x, k) => setF64(lines, at + 8 * k, x / MM_PER_INCH));
    setF64(lines, at + 48, Math.max(0, Math.min(1, l.dash)));
    setU16(lines, at + HATCH_LINE_COLOR, l.color);
    lines[at + HATCH_LINE_WEIGHT] = Math.max(0, Math.min(255, Math.round(l.weight)));
  });
  const out = concat([d.subarray(0, HATCH_LINES), lines]);
  out[HATCH_FLAGS] = (out[HATCH_FLAGS] & ~HATCH_PAGE) | (hatch.page ? HATCH_PAGE : 0);
  setU16(out, HATCH_BACKGROUND, hatch.background);
  setU16(out, HATCH_COUNT, hatch.lines.length);
  setU64(out, 0, BigInt(out.length));
  return out;
}

function sameLine(a: HatchLine, b: HatchLine): boolean {
  return (
    a.base.x === b.base.x &&
    a.base.y === b.base.y &&
    a.period.x === b.period.x &&
    a.period.y === b.period.y &&
    a.offset.x === b.offset.x &&
    a.offset.y === b.offset.y &&
    a.dash === b.dash &&
    a.color === b.color &&
    a.weight === b.weight
  );
}

/** The size of a preview record's image in pixels, or null when its layout isn't the one known. */
export function previewSize(d: Uint8Array): { width: number; height: number } | null {
  if (d.length < PREVIEW_PNG) return null;
  const desc = u32(d, PREVIEW_DESC);
  const end = PREVIEW_DESC + desc + u32(d, PREVIEW_LENGTH);
  if (desc < PREVIEW_DESC_SIZE || (d.length !== end && d.length !== end + 1)) return null;
  const codec = String.fromCharCode(d[PREVIEW_CODEC + 3], d[PREVIEW_CODEC + 2], d[PREVIEW_CODEC + 1], d[PREVIEW_CODEC]);
  if (codec !== "png " && codec !== "jpeg") return null;
  return { width: u32(d, PREVIEW_WIDTH), height: u32(d, PREVIEW_HEIGHT) };
}

/** The preview record with `png` (a PNG of the same size) as its image, whatever the image was. */
export function writePreview(d: Uint8Array, png: Uint8Array): Uint8Array {
  const size = previewSize(d);
  const be = (at: number): number => ((png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3]) >>> 0;
  if (!size || png.length < 24 || be(16) !== size.width || be(20) !== size.height) throw new Error("a preview takes a PNG of its own size");
  const head = d.slice(0, PREVIEW_PNG);
  setU32(head, PREVIEW_LENGTH, png.length);
  // a JPEG's or 8-bit image's description becomes a plain PNG one, without a colour table (a
  // PNG's keeps the stale bytes after its name)
  if (u32(d, PREVIEW_DESC) !== PREVIEW_DESC_SIZE || d[PREVIEW_CODEC] !== 0x20) {
    setU32(head, PREVIEW_DESC, PREVIEW_DESC_SIZE);
    head.set([0x20, 0x67, 0x6e, 0x70], PREVIEW_CODEC);
    head.fill(0, PREVIEW_NAME, PREVIEW_DEPTH);
    head.set([3, 0x50, 0x4e, 0x47], PREVIEW_NAME);
    setU16(head, PREVIEW_DEPTH, 32);
    setU16(head, PREVIEW_CLUT, 0xffff);
  }
  // the record's length is kept even
  const out = concat([head, png, new Uint8Array((PREVIEW_PNG + png.length) % 2)]);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/**
 * A new preview record holding `image`, a PNG or JPEG of `width` × `height` pixels, described as
 * the demos' texture images and previews are: 72 dpi, Apple's normal quality, 32 bits deep for a
 * PNG with alpha and 24 otherwise. `role` is the byte at +0x7b, which tells a texture's large
 * preview (2) and small one (1) from its image (0). Its GUID is a placeholder for instantiate to
 * replace.
 */
export function newPreview(image: Uint8Array, width: number, height: number, mime: "image/png" | "image/jpeg", role = 0): Uint8Array {
  if (!(width >= 1 && height >= 1 && width <= 0xffff && height <= 0xffff) || !Number.isInteger(width) || !Number.isInteger(height)) throw new Error("a preview takes a whole size in pixels");
  const png = mime === "image/png";
  // a PNG's colour type is the 26th byte: 4 and 6 carry alpha
  const depth = png && (image[25] === 4 || image[25] === 6) ? 32 : 24;
  const d = new Uint8Array(PREVIEW_PNG + image.length + ((PREVIEW_PNG + image.length) % 2));
  setU64(d, 0, BigInt(d.length));
  d[0x19] = PREVIEW_TYPE;
  d[0x1f] = 0x40;
  d[0x2f] = 0x12;
  d[0x38] = 1;
  d[0x52] = 1;
  d[PREVIEW_WIDTH - 1] = role;
  setU32(d, PREVIEW_WIDTH, width);
  setU32(d, PREVIEW_HEIGHT, height);
  setU32(d, PREVIEW_WIDTH + 8, depth);
  setU32(d, PREVIEW_DESC, PREVIEW_DESC_SIZE);
  // the codec and vendor ("appl") as QuickTime keeps four-letter codes, reversed
  d.set([...(png ? " gnp" : "gepj")].map((c) => c.charCodeAt(0)), PREVIEW_CODEC);
  setU16(d, 0xa4, 1);
  setU16(d, 0xa6, 1);
  d.set([0x6c, 0x70, 0x70, 0x61], 0xa8);
  setU32(d, 0xb0, 0x200);
  setU16(d, 0xb4, width);
  setU16(d, 0xb6, height);
  // 72 dpi across and up, as 16.16 fixed point
  setU32(d, 0xb8, 72 << 16);
  setU32(d, 0xbc, 72 << 16);
  setU32(d, PREVIEW_LENGTH, image.length);
  setU16(d, PREVIEW_LENGTH + 4, 1);
  const name = png ? "PNG" : "Photo - JPEG";
  d[PREVIEW_NAME] = name.length;
  d.set([...name].map((c) => c.charCodeAt(0)), PREVIEW_NAME + 1);
  setU16(d, PREVIEW_DEPTH, depth);
  setU16(d, PREVIEW_CLUT, 0xffff);
  d.set(image, PREVIEW_PNG);
  return d;
}

function tileFill(r: Rec): TileFill | null {
  const d = r.data;
  if (d.length < TILE_V + 16) return null;
  const u = { x: f64(d, TILE_U + 8), y: f64(d, TILE_U) };
  const v = { x: f64(d, TILE_V + 8), y: f64(d, TILE_V) };
  if (![u.x, u.y, v.x, v.y].every(Number.isFinite) || Math.abs(u.x * v.y - u.y * v.x) < 1e-6) return null;
  const shapes: Shape[] = [];
  const stack = r.children.filter((c) => c.type === TILE_GROUP_TYPE);
  while (stack.length) {
    const c = stack.pop()!;
    if (c.type === TILE_GROUP_TYPE) stack.push(...c.children);
    // a shape with a weightless pen frames the repeat cell (the batt tile's rectangle), and the
    // published sheets never draw it
    else if (c.type !== PREVIEW_TYPE && readAttrs(c.data)?.lineWeight !== 0) {
      const s = decodeShape(c);
      if (s && s.kind !== "text" && s.kind !== "image") shapes.push(s);
    }
  }
  return shapes.length ? { u, v, shapes } : null;
}

/** A gradient record's stops in the order it keeps them; null when it can't be read. */
function storedStops(d: Uint8Array): GradientStop[] | null {
  if (d.length < GRADIENT_STOPS) return null;
  const n = u16(d, GRADIENT_COUNT);
  if (n < 1 || GRADIENT_STOPS + n * GRADIENT_STOP_SIZE > d.length) return null;
  const out: GradientStop[] = [];
  for (let i = 0; i < n; i++) {
    const at = GRADIENT_STOPS + i * GRADIENT_STOP_SIZE;
    const pos = f64(d, at);
    if (!Number.isFinite(pos)) return null;
    const hex = [0, 2, 4].map((k) => Math.min(255, u16(d, at + 16 + k)).toString(16).padStart(2, "0")).join("");
    const mid = f64(d, at + 8);
    out.push({
      at: Math.max(0, Math.min(1, pos)),
      color: `#${hex}`,
      opacity: Math.min(100, u16(d, at + 22)) / 100,
      midpoint: Number.isFinite(mid) ? Math.max(0, Math.min(1, mid)) : 0.5,
    });
  }
  return out;
}

/** A gradient record's stops, by position; null when it can't be read. */
export function readGradient(d: Uint8Array): GradientStop[] | null {
  return storedStops(d)?.sort((a, b) => a.at - b.at) ?? null;
}

/** The gradient record with `stops` in place of its own; a stop that doesn't change keeps its bytes. */
export function writeGradient(d: Uint8Array, stops: readonly GradientStop[]): Uint8Array {
  if (stops.length < 2 || stops.length > 0xff) throw new Error("a gradient takes 2 to 255 stops");
  const was = storedStops(d) ?? [];
  const body = new Uint8Array(stops.length * GRADIENT_STOP_SIZE);
  stops.forEach((st, i) => {
    const at = i * GRADIENT_STOP_SIZE;
    const old = was[i];
    if (old && old.at === st.at && old.color === st.color && old.opacity === st.opacity && old.midpoint === st.midpoint) {
      body.set(d.subarray(GRADIENT_STOPS + at, GRADIENT_STOPS + at + GRADIENT_STOP_SIZE), at);
      return;
    }
    const rgb = /^#([0-9a-f]{6})$/i.exec(st.color);
    if (!rgb || !(st.at >= 0 && st.at <= 1) || !(st.midpoint >= 0 && st.midpoint <= 1) || !(st.opacity >= 0 && st.opacity <= 1)) {
      throw new Error("a gradient stop takes a position, midpoint and opacity from 0 to 1 and a #rrggbb colour");
    }
    setF64(body, at, st.at);
    setF64(body, at + 8, st.midpoint);
    for (let k = 0; k < 3; k++) setU16(body, at + 16 + 2 * k, parseInt(rgb[1].slice(2 * k, 2 * k + 2), 16));
    setU16(body, at + 22, Math.round(st.opacity * 100));
  });
  const keep = was.length ? GRADIENT_STOPS + was.length * GRADIENT_STOP_SIZE : d.length;
  const out = concat([d.subarray(0, GRADIENT_STOPS), body, d.subarray(Math.min(keep, d.length))]);
  setU16(out, GRADIENT_COUNT, stops.length);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** A new gradient record with the header of `like` (another resource record) and `stops`. The caller sets its name, owner and GUID. */
export function newGradient(like: Uint8Array, stops: readonly GradientStop[]): Uint8Array {
  const head = concat([like.subarray(0, GRADIENT_COUNT), new Uint8Array(GRADIENT_STOPS - GRADIENT_COUNT)]);
  head.fill(0, 0x50);
  head[0x19] = GRADIENT_TYPE;
  return writeGradient(head, stops);
}

function folderOf(r: Rec, names: ReadonlyMap<number, string>): string {
  const parts: string[] = [];
  for (let p = r.parent; p; p = p.parent) {
    if (p.type === FOLDER_TYPE) parts.unshift(names.get(p.nameIndex) ?? "");
  }
  return parts.filter(Boolean).join("/");
}

export function readResources(recs: Iterable<Rec>, names: ReadonlyMap<number, string>): ResourceInfo[] {
  const out: ResourceInfo[] = [];
  for (const r of recs) {
    const kind = RESOURCE_TYPES.get(r.type);
    if (!kind || r.nameIndex === 0) continue;
    const name = names.get(r.nameIndex);
    if (!name) continue;
    const p = preview(r);
    const info: ResourceInfo = {
      index: r.nameIndex,
      kind,
      name,
      folder: folderOf(r, names),
      preview: p?.bytes ?? null,
      previewMime: p?.mime ?? "",
      previewSizes: r.children.flatMap((c) => (c.type === PREVIEW_TYPE ? (previewSize(c.data) ?? []) : [])),
    };
    if (kind === "hatch") {
      const hatch = hatchFill(r);
      if (hatch) info.hatch = hatch;
    }
    if (kind === "tile") {
      const tile = tileFill(r);
      if (tile) info.tile = tile;
    }
    if (kind === "gradient") {
      const stops = readGradient(r.data);
      if (stops) info.gradient = stops;
    }
    if (kind === "text-style") {
      const style = readTextStyle(r.data);
      if (style) info.textStyle = style;
    }
    if (kind === "texture") {
      const { image: img, mask } = textureImages(r, names);
      if (mask) {
        info.mask = mask.bytes;
        info.maskMime = mask.mime;
      }
      if (img) {
        info.image = img.bytes;
        info.imageMime = img.mime;
        const px = imagePixels(img.bytes, img.mime);
        if (px && px.width > 0 && px.height > 0) info.imagePixels = px;
        const size = r.data.length >= TEXTURE_SIZE + 8 ? f64(r.data, TEXTURE_SIZE) : 0;
        info.imageSize = Number.isFinite(size) && size > 0 ? size * MM_PER_INCH : 0;
      }
    }
    out.push(info);
  }
  out.sort((a, b) => a.kind.localeCompare(b.kind) || a.folder.localeCompare(b.folder) || a.name.localeCompare(b.name));
  return out;
}
