// Vectorworks 2013 bodies of drawn objects (lines, rectangles, polygons, text, symbols, groups and
// the like) as their 2018+ bodies. legacy.ts calls shapeBody for a 2013 record docBody didn't take.

import type { BodyConversion } from "./legacy.ts";
import { concat, f64, setF64, setU16, u16 } from "./bytes.ts";

/**
 * Body offset where 2018+ has the u32 material slot (record +0x88) that 2013 lacks: 2013's record
 * +0x60, body +0x38. Everything from there on sits 4 bytes later in 2018+ (its record offsets 0x2c
 * past the 2013 ones, the attribute block and plan box 0x28 past).
 */
const MATERIAL_AT = 0x38;

/** A 2013 body with the 2018+ material slot (zero) inserted. */
function withMaterial(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 4);
  out.set(body.subarray(0, MATERIAL_AT), 0);
  out.set(body.subarray(MATERIAL_AT), MATERIAL_AT + 4);
  return out;
}

/** Text (type 10). Point sizes are 16 bytes 2018+ has before the font and 2013 does not (point size = size / 0.3528 mm). */
const POINT_MM = 0.3528;
/** The bbox height of a one-line text is this many sizes (lines are 1.14 apart; the stored boxes say 1.17). */
const TEXT_BOX_LINE = 1.17;

/**
 * A 2013 text as 2018+. The one-line layout (font at 2013 +0xdc, the size 6 bytes on, 4 bytes
 * after the style run of +0xee) holds for 558 of 644 texts in the 2013 test file: their advance
 * table ends where their line count says, and the size and font read plausibly. Those take
 * the layout as it is, with 2018+'s point sizes and the 4 bytes 2018+ has after its style.
 * The rest (multi-line texts and the odd one-line ones, whose layout reads as garbage) are
 * rebuilt as one-line texts: their size comes from their box, their font is the first in the
 * list, and their lines are wrapped at the box's width (see rebuiltText).
 */
function textBody(body: Uint8Array): Uint8Array {
  const n = u16(body, 0xca - 0x28);
  const lines = u16(body, 0xd4 - 0x28);
  const end = body.length + 0x28;
  const font = 0xdc + 2 * (lines - 1);
  const b = (o: number) => o - 0x28;
  const rem = end - 10 * n - (0xf2 + 2 * (lines - 1));
  const size = lines >= 1 && lines <= 50 && font + 16 <= end ? f64(body, b(font + 6)) : NaN;
  const ok =
    n >= 1 &&
    lines >= 1 &&
    lines <= 50 &&
    rem >= 0 &&
    rem % 10 === 0 &&
    Number.isFinite(size) &&
    Math.abs(size) > 1e-3 &&
    Math.abs(size) < 1e4 &&
    u16(body, b(font)) < 256 &&
    u16(body, b(font + 2)) < 16;
  if (ok) {
    const at = b(font);
    return concat([
      body.subarray(0, 0x38),
      new Uint8Array(4),
      body.subarray(0x38, at),
      pointSizes(size),
      body.subarray(at, b(0xee + 2 * (lines - 1))),
      new Uint8Array(4),
      body.subarray(b(0xee + 2 * (lines - 1))),
    ]);
  }
  return rebuiltText(body, n);
}

/** Two f64 point sizes for a text of this size (point = size / 0.3528 mm, as the size is in mm). */
function pointSizes(size: number): Uint8Array {
  const out = new Uint8Array(16);
  setF64(out, 0, size / POINT_MM);
  setF64(out, 8, size / POINT_MM);
  return out;
}

/** A character's width in sizes: the median of the 2013 test file's one-line texts (10th to 90th percentile 0.50 to 0.67). */
const CHAR_WIDTH = 0.61;
/** The most lines a rebuilt text is tried at (see rebuiltSize). */
const MAX_LINES = 200;

/**
 * A rebuilt text's size, from its box: a line is 1.17 sizes tall, and a paragraph takes as many lines
 * as wrapping it at the box's width makes. The line count is the first that fits the box at its own
 * size (the nearest when none does).
 */
function rebuiltSize(H: number, W: number, paragraphs: number[]): number {
  const hard = paragraphs.length;
  if (!(H > 0) || !Number.isFinite(H)) return 1;
  if (!(W > 0) || !Number.isFinite(W)) return H / (TEXT_BOX_LINE * hard);
  let best = { lines: hard, miss: Infinity };
  for (let lines = hard; lines <= MAX_LINES; lines++) {
    const size = H / (TEXT_BOX_LINE * lines);
    const wrapped = paragraphs.reduce((sum, len) => sum + Math.max(1, Math.ceil((CHAR_WIDTH * len * size) / W)), 0);
    const miss = Math.abs(wrapped - lines);
    if (miss < best.miss) best = { lines, miss };
    if (miss === 0) break;
  }
  return H / (TEXT_BOX_LINE * best.lines);
}

/** A paragraph broken at its spaces into lines of at most `maxChars` characters (a longer word stays whole). */
function wrapParagraph(paragraph: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line: string | null = null;
  for (const word of paragraph.split(" ")) {
    if (line === null) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  lines.push(line ?? "");
  return lines;
}

/** A 2013 text's n characters: UTF-16 units at the end of its body. */
function readChars(body: Uint8Array, n: number): string {
  if (2 * n > body.length) return "";
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(u16(body, body.length - 2 * n + 2 * i));
  return s;
}

/**
 * A text rebuilt as a one-line text (see textBody) from the 2013 header, box and characters. Its size
 * comes from its box (rebuiltSize), and its paragraphs are wrapped at the box's width at that size:
 * Rodeo draws only the breaks the text holds, so the wrapped lines get breaks of their own. Its
 * advances are the average character width, none for a break.
 */
function rebuiltText(body: Uint8Array, n: number): Uint8Array {
  const top = f64(body, 0x18), left = f64(body, 0x20), bottom = f64(body, 0x28), right = f64(body, 0x30);
  const w = Math.abs(right - left), h = Math.abs(top - bottom);
  // the box's extent along the text's up direction and along it, from its turned bounds (bw = W|c| + H|s|, bh = W|s| + H|c|)
  const s = Math.abs(f64(body, 0x64)), c = Math.abs(f64(body, 0x6c));
  const det = c * c - s * s;
  const turned = Math.abs(det) > 0.2;
  const H = turned ? (h * c - w * s) / det : c >= s ? h : w;
  const W = turned ? (w * c - h * s) / det : c >= s ? w : h;
  const paragraphs = readChars(body, n).split("\r");
  const size = rebuiltSize(H, W, paragraphs.map((p) => p.length));
  const maxChars = W > 0 && Number.isFinite(W) ? Math.max(1, Math.floor(W / (CHAR_WIDTH * size))) : Infinity;
  const text = paragraphs.flatMap((p) => wrapParagraph(p, maxChars)).join("\r");
  // 2018+ fixed part: the 2013 header, box and frame, with the material slot, then the one-line fields
  const head = concat([body.subarray(0, 0x38), new Uint8Array(4), body.subarray(0x38, 0xb4)]);
  const out = new Uint8Array(0xe2 + 10 * text.length);
  out.set(head, 0);
  setU16(out, 0xa6, text.length); // the character count (2018+ +0xf6)
  setU16(out, 0xb0, 1); // one line: the breaks are the characters' own
  out.set(pointSizes(size), 0xb8);
  setF64(out, 0xce, size);
  // the advances (8 bytes a character) and then the UTF-16 characters, at the end of the record
  for (let i = 0; i < text.length; i++) {
    setF64(out, 0xe2 + 8 * i, text[i] === "\r" ? 0 : CHAR_WIDTH * size);
    setU16(out, 0xe2 + 8 * text.length + 2 * i, text.charCodeAt(i));
  }
  return out;
}

/**
 * A group, plug-in object or viewport-like container: 2018+ has 12 bytes more before its 3D box (at
 * +0x9c, 2013's +0x68): the material slot and 8 more, as the 2013 record's own +0x60 u32 pair (stale
 * pointers) moves up to +0x94. The bodies after it keep their 2013 offsets + 0x34 (record).
 */
const CONTAINER_GAP = 12;

/** A 2013 body with the container gap inserted at the material slot. */
function withContainerGap(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + CONTAINER_GAP);
  out.set(body.subarray(0, MATERIAL_AT), 0);
  out.set(body.subarray(MATERIAL_AT), MATERIAL_AT + CONTAINER_GAP);
  return out;
}

/**
 * A group (11): its plan box and attributes as they are, then 2018+'s 20 bytes (material and two
 * stale pointers) with the 2013 record's 3D box moved to +0x9c. Its children follow as they are.
 */
function groupBody(body: Uint8Array): Uint8Array {
  return withContainerGap(body);
}

/** A symbol definition (16): its attributes and plan box; 2018+ holds the rest of its record as stale data or zeros. */
function symbolDefinitionBody(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(356);
  out.set(body.subarray(0, 0x38), 0);
  // no 3D box is read from 2013; an empty one (±DBL_MAX, as an empty group's) is what 2018+ writes for no 3D content
  [-1, -1, -1, 1, 1, 1].forEach((sgn, i) => setF64(out, 0x4c + 8 * i, sgn * Number.MAX_VALUE));
  return out;
}

/**
 * A dimension (63): its attributes and its drawing's box (plan box at +0x68). Its measured points
 * and dimension-line fields are not read from 2013 yet; its extension lines, dimension line and
 * text are children, drawn from those as they are.
 */
function dimensionBody(body: Uint8Array): Uint8Array {
  const out = new Uint8Array(848 - 0x50);
  out.set(body.subarray(0, 0x38), 0);
  return out;
}

/**
 * A viewport (122): 2018+ has 128 bytes more between its shift and its view matrix (2013 +0x18c,
 * 2018 +0x238), so the 2013 fields from there on sit 0xac past their 2013 offsets: the view matrix
 * (identity in all 10 plan viewports of the 2013 test file), the scale (2013 +0x220, 2018 +0x2cc)
 * and the layer and class list (2013 +0x28c, 2018 +0x338, its counts matching its entries).
 * Checked on that file's 10 sheet viewports: the identity matrix sits at +0x18c in all 10, the
 * scale is the only f64 equal to the scale at +0x220 in all 10, and the list at +0x28c ends the
 * record and names design layers. The plan box (2013 +0x40, 2018 +0x68) moves by the header only,
 * and the rotation (+0x60, 2018 +0x8c) and shift (+0xa8, 2018 +0xd4) by the header and the
 * material slot too. On three fit viewports the drawn extents of their listed layers map onto
 * their boxes at the stored scale and shift to within 0.1 mm.
 */
const VIEW_VIEW_13 = 0x18c;
const VIEW_GAP = 128;

function viewportBody(body: Uint8Array): Uint8Array {
  const at = VIEW_VIEW_13 - 0x28; // body offset of the view matrix in 2013, before the material slot
  const out = new Uint8Array(body.length + 4 + VIEW_GAP);
  out.set(body.subarray(0, MATERIAL_AT), 0);
  out.set(body.subarray(MATERIAL_AT, at), MATERIAL_AT + 4);
  out.set(body.subarray(at), at + 4 + VIEW_GAP);
  return out;
}

/** An arc record's body (FORMAT.md, arc/circle): 0xd2 bytes in all, less the header. */
const ARC_BODY = 0xd2 - 0x50;

/**
 * An oval (type 4: a rectangle's layout, the ellipse inside its frame) as the arc record (type 6,
 * see shapeType) of the whole ellipse, the way 2018+ keeps ellipses and Rodeo draws them: its box
 * is the frame's, and it starts and ends at the right, sweeping a whole turn (encode.ts writes arcs
 * so). A turned oval has no such record, so it is left out.
 */
function ovalBody(body: Uint8Array): Uint8Array | null {
  const rect = withMaterial(body);
  // the rectangle's x axis (sin, cos) at 2018+ +0x9c
  if (Math.abs(f64(rect, 0x9c - 0x50)) > 1e-9) return null;
  const out = new Uint8Array(ARC_BODY);
  out.set(rect.subarray(0, 0x8c - 0x50), 0);
  // the plan box at +0x68: top, left, bottom, right
  const [top, left, bottom, right] = [0, 8, 16, 24].map((k) => f64(out, 0x18 + k));
  const cx = (left + right) / 2;
  const cy = (top + bottom) / 2;
  const rx = Math.abs(right - left) / 2;
  for (const [at, x] of [[0x90, cx + rx], [0xa0, cx + rx], [0xb0, cx]]) {
    setF64(out, at - 0x50, cy);
    setF64(out, at - 0x50 + 8, x);
  }
  // QuickDraw angles: 90 is the right, and a whole turn the other way round
  setF64(out, 0xc0 - 0x50, 90);
  setF64(out, 0xc8 - 0x50, -360);
  return out;
}

/** The type a converted 2013 record of type `type` has in 2018+: an oval becomes an arc (ovalBody). */
export function shapeType(type: number): number {
  return type === 4 ? 6 : type;
}

/** The 2018+ body (from +0x50) for a 2013 record of type `type` whose body (from +0x28) is `body`. */
export function shapeBody(type: number, body: Uint8Array): BodyConversion {
  switch (type) {
    // line: same body, its 4-byte tail (2013 +0x60) is 2018+'s +0x88
    case 2:
    // 2D locus and 3D locus: same bodies (the point at 2018 +0x68, or the 3D one at +0x66)
    case 9:
    case 17:
    // line markers: two 10-byte markers at the same body offsets
    case 125:
      return body;
    case 3: // rectangle
    case 5: // polygon
    case 6: // arc
    case 13: // rounded rectangle
    case 15: // symbol instance
    case 21: // polyline
      return withMaterial(body);
    case 10: // text
      return textBody(body);
    case 11: // group
      return groupBody(body);
    case 16: // symbol definition
      return symbolDefinitionBody(body);
    case 63: // dimension
      return dimensionBody(body);
    case 81: // light
      return withMaterial(body);
    case 86: // plug-in object
      return withContainerGap(body);
    case 122: // viewport
      return viewportBody(body);
    case 14: // image: its layout isn't read yet, and it has no children, so it is left out
      return null;
    case 4: // oval
      return ovalBody(body);
    // 3D objects (extrude, sweep, multiple extrude, profile record, solids, 3D bodies): their 2013
    // layouts aren't converted, so they are left out with what they hold (legacy.ts)
    case 24:
    case 34:
    case 38:
    case 42:
    case 84:
    case 111:
    case 112:
    case 113:
    case 114:
      return null;
    default:
      return undefined;
  }
}
