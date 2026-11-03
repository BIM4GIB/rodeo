// Windows Enhanced Metafile (EMF, [MS-EMF]), as File > Export > Export Metafile writes it: the page
// Export EPSF draws (pdf.ts layersPage), its content operators replayed as GDI records. Points are
// worked out here, in page units of a hundredth of a millimetre with y down (MM_TEXT on a reference
// device of 100 pixels a millimetre), so the file sets no world transform for a reader to get wrong;
// a group (q … Q) saves and restores the clip. Paths are filled with solid brushes and stroked with
// geometric pens of the line's width, caps, joins and dashes. EMF draws no transparency: a colour
// drawn see-through is mixed with the white page by its opacity, as Export EPSF does. Text is set in
// Arial (Helvetica's metric twin on Windows; Arial Narrow for narrow fonts), each character placed at
// Helvetica's advance and the line turned by the font's escapement. Images aren't written; the caller
// is told how many were left out.

import { helveticaWidth, type DrawnPage } from "./pdf.ts";
import { arrayNumbers, onWhite, stateAlpha, stringText, tokens, type Token } from "./pageOps.ts";

/** Page units a point: hundredths of a millimetre, the unit the header's frame is given in. */
const UNIT = 2540 / 72;

/** Record types ([MS-EMF] 2.1.1). */
const EMR = {
  HEADER: 1,
  POLYBEZIERTO: 5,
  EOF: 14,
  SETMAPMODE: 17,
  SETBKMODE: 18,
  SETPOLYFILLMODE: 19,
  SETTEXTALIGN: 22,
  SETTEXTCOLOR: 24,
  MOVETOEX: 27,
  SAVEDC: 33,
  RESTOREDC: 34,
  SELECTOBJECT: 37,
  CREATEBRUSHINDIRECT: 39,
  DELETEOBJECT: 40,
  LINETO: 54,
  BEGINPATH: 59,
  ENDPATH: 60,
  CLOSEFIGURE: 61,
  FILLPATH: 62,
  STROKEANDFILLPATH: 63,
  STROKEPATH: 64,
  SELECTCLIPPATH: 67,
  EXTCREATEFONTINDIRECTW: 82,
  EXTTEXTOUTW: 84,
  EXTCREATEPEN: 95,
} as const;

const NULL_BRUSH = 0x80000005;
const NULL_PEN = 0x80000008;
const SYSTEM_FONT = 0x8000000d;
/** Object table slots: a pen, a brush and a font at a time, each deleted once it has been used. */
const PEN = 1;
const BRUSH = 2;
const FONT = 3;

const PS_GEOMETRIC = 0x10000;
const PS_USERSTYLE = 7;
/** PDF line caps (J: butt, round, square) and joins (j: miter, round, bevel) as pen style bits. */
const CAPS = [0x200, 0, 0x100];
const JOINS = [0x2000, 0, 0x1000];

/** PDF fonts (pdf.ts F1-F4: Helvetica, bold, oblique, bold oblique) as bold and italic. */
const FACES: Readonly<Record<string, { bold: boolean; italic: boolean }>> = {
  F1: { bold: false, italic: false },
  F2: { bold: true, italic: false },
  F3: { bold: false, italic: true },
  F4: { bold: true, italic: true },
};

/** Little-endian fields written into one record. */
class Fields {
  private readonly view: DataView;
  private at = 0;
  constructor(buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
  u32(...xs: number[]): this {
    for (const x of xs) {
      this.view.setUint32(this.at, x >>> 0, true);
      this.at += 4;
    }
    return this;
  }
  i32(...xs: number[]): this {
    for (const x of xs) {
      this.view.setInt32(this.at, Math.round(x), true);
      this.at += 4;
    }
    return this;
  }
  f32(...xs: number[]): this {
    for (const x of xs) {
      this.view.setFloat32(this.at, x, true);
      this.at += 4;
    }
    return this;
  }
  u8(...xs: number[]): this {
    for (const x of xs) this.view.setUint8(this.at++, x);
    return this;
  }
  /** `s` as UTF-16LE in a field of `chars` characters, zero-filled. */
  utf16(s: string, chars: number): this {
    for (let i = 0; i < chars; i++) this.view.setUint16(this.at + 2 * i, i < s.length ? s.charCodeAt(i) : 0, true);
    this.at += 2 * chars;
    return this;
  }
  skip(bytes: number): this {
    this.at += bytes;
    return this;
  }
}

/** The records of a metafile, in order, each a multiple of 4 bytes long. */
class Records {
  readonly parts: Uint8Array[] = [];
  bytes = 0;
  /** A record of `type` with `body` bytes after its type and size, written by `write` (zeros where it writes nothing). */
  add(type: number, body: number, write?: (f: Fields) => void): void {
    const size = 8 + Math.ceil(body / 4) * 4;
    const buf = new Uint8Array(size);
    const f = new Fields(buf).u32(type, size);
    write?.(f);
    this.parts.push(buf);
    this.bytes += size;
  }
  /** A record of 32-bit integers. */
  ints(type: number, ...xs: number[]): void {
    this.add(type, 4 * xs.length, (f) => f.i32(...xs));
  }
}

type Matrix = [number, number, number, number, number, number];

/** `m` then `n`, as PDF composes them (row vectors). */
function times(m: readonly number[], n: readonly number[]): Matrix {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

/** How much a matrix scales lengths (the square root of its area scale). */
function scaleOf(m: readonly number[]): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

/** A GDI COLORREF: red, green and blue bytes. */
function colorRef(rgb: readonly number[]): number {
  const byte = (c: number | undefined): number => Math.max(0, Math.min(255, Math.round((c ?? 0) * 255)));
  return byte(rgb[0]) | (byte(rgb[1]) << 8) | (byte(rgb[2]) << 16);
}

interface State {
  ctm: Matrix;
  fill: number[];
  stroke: number[];
  fillAlpha: number;
  strokeAlpha: number;
  width: number;
  cap: number;
  join: number;
  dash: number[];
  font: string;
  size: number;
  hscale: number;
}

export interface Emf {
  readonly bytes: Uint8Array<ArrayBuffer>;
  /** images in the drawing that the file leaves out */
  readonly imagesLeftOut: number;
}

/** An EMF file of the page. */
export function pageEmf(page: DrawnPage, title: string): Emf {
  const h = Math.max(1, page.height);
  const right = Math.ceil(Math.max(1, page.width) * UNIT);
  const bottom = Math.ceil(h * UNIT);
  const out = new Records();
  out.ints(EMR.SETMAPMODE, 1); // MM_TEXT: a logical unit is a page unit
  out.ints(EMR.SETBKMODE, 1); // TRANSPARENT: text has no background box
  out.ints(EMR.SETTEXTALIGN, 24); // TA_BASELINE | TA_LEFT: text sits on its point, as in PDF
  out.ints(EMR.SELECTOBJECT, NULL_PEN);
  out.ints(EMR.SELECTOBJECT, NULL_BRUSH);

  let st: State = {
    ctm: [1, 0, 0, 1, 0, 0],
    fill: [0, 0, 0],
    stroke: [0, 0, 0],
    fillAlpha: 1,
    strokeAlpha: 1,
    width: 1,
    cap: 0,
    join: 0,
    dash: [],
    font: "F1",
    size: 12,
    hscale: 100,
  };
  const stack: State[] = [];
  /** the path being built: each segment's record type and points */
  let path: { type: number; pts: number[] }[] = [];
  let clipNext: 1 | 2 | 0 = 0; // 1 nonzero, 2 even-odd
  let tm: Matrix = [1, 0, 0, 1, 0, 0];
  const args: Token[] = [];
  const nums = (): number[] => args.filter((t): t is Extract<Token, { kind: "num" }> => t.kind === "num").map((t) => t.v);

  /** A point in the current user space, in page units. */
  const at = (x: number, y: number, m: readonly number[] = st.ctm): [number, number] => [
    Math.round((m[0] * x + m[2] * y + m[4]) * UNIT),
    Math.round((h - (m[1] * x + m[3] * y + m[5])) * UNIT),
  ];
  const writePath = (): void => {
    out.add(EMR.BEGINPATH, 0);
    for (const s of path) {
      if (s.type === EMR.POLYBEZIERTO) out.add(s.type, 20 + 4 * s.pts.length, (f) => f.i32(0, 0, right, bottom, s.pts.length / 2, ...s.pts));
      else out.ints(s.type, ...s.pts);
    }
    out.add(EMR.ENDPATH, 0);
  };
  /** Paints the path built (`fill` 1 nonzero, 2 even-odd), then makes it the clip when W came before. */
  const paint = (fill: 0 | 1 | 2, stroke: boolean): void => {
    if (path.length > 0 && (fill || stroke)) {
      if (fill) {
        out.ints(EMR.SETPOLYFILLMODE, fill === 2 ? 1 : 2); // ALTERNATE or WINDING
        out.add(EMR.CREATEBRUSHINDIRECT, 16, (f) => f.u32(BRUSH, 0, colorRef(onWhite(st.fill, st.fillAlpha)), 0));
        out.ints(EMR.SELECTOBJECT, BRUSH);
      }
      if (stroke) {
        const k = scaleOf(st.ctm) * UNIT;
        const dashes = st.dash.map((d) => Math.max(1, Math.round(d * k)));
        const style = PS_GEOMETRIC | (CAPS[st.cap] ?? 0) | (JOINS[st.join] ?? 0) | (dashes.length > 0 ? PS_USERSTYLE : 0);
        const width = Math.max(1, Math.round(st.width * k));
        out.add(EMR.EXTCREATEPEN, 44 + 4 * dashes.length, (f) =>
          f.u32(PEN, 0, 0, 0, 0, style, width, 0, colorRef(onWhite(st.stroke, st.strokeAlpha)), 0, dashes.length, ...dashes),
        );
        out.ints(EMR.SELECTOBJECT, PEN);
      }
      writePath();
      out.ints(fill && stroke ? EMR.STROKEANDFILLPATH : fill ? EMR.FILLPATH : EMR.STROKEPATH, 0, 0, right, bottom);
      if (fill) {
        out.ints(EMR.SELECTOBJECT, NULL_BRUSH);
        out.ints(EMR.DELETEOBJECT, BRUSH);
      }
      if (stroke) {
        out.ints(EMR.SELECTOBJECT, NULL_PEN);
        out.ints(EMR.DELETEOBJECT, PEN);
      }
    }
    if (clipNext && path.length > 0) {
      out.ints(EMR.SETPOLYFILLMODE, clipNext === 2 ? 1 : 2);
      writePath();
      out.ints(EMR.SELECTCLIPPATH, 1); // RGN_AND: within the clip already set
    }
    clipNext = 0;
    path = [];
  };
  const text = (raw: string): void => {
    const s = stringText(raw).replace(/[\r\n]/g, "");
    if (s === "") return;
    const face = FACES[st.font] ?? FACES.F1;
    const m = times(tm, st.ctm);
    const [x, y] = at(0, 0, m);
    const k = scaleOf(m) * UNIT;
    const angle = Math.round((Math.atan2(m[1], m[0]) * 1800) / Math.PI);
    const escapement = (angle + 3600) % 3600;
    const narrow = st.hscale < 100;
    out.add(EMR.EXTCREATEFONTINDIRECTW, 324, (f) =>
      f
        .u32(FONT)
        .i32(-Math.max(1, Math.round(st.size * k)), 0, escapement, escapement, face.bold ? 700 : 400)
        // italic, underline, strike-out, DEFAULT_CHARSET, OUT_TT_PRECIS, default clipping, default quality, VARIABLE_PITCH | FF_SWISS
        .u8(face.italic ? 1 : 0, 0, 0, 1, 4, 0, 0, 0x22)
        .utf16(narrow ? "Arial Narrow" : "Arial", 32),
    );
    out.ints(EMR.SELECTOBJECT, FONT);
    out.ints(EMR.SETTEXTCOLOR, colorRef(onWhite(st.fill, st.fillAlpha)));
    // each character's advance along the line, from Helvetica's widths, rounded so they add up
    const per = st.size * (st.hscale / 100) * k;
    const dx: number[] = [];
    let run = 0;
    for (const ch of s) {
      const next = run + helveticaWidth(ch, face.bold) * per;
      dx.push(Math.round(next) - Math.round(run));
      run = next;
    }
    const chars = s.length;
    const stringBytes = Math.ceil((2 * chars) / 4) * 4;
    out.add(EMR.EXTTEXTOUTW, 68 + stringBytes + 4 * chars, (f) =>
      f
        .i32(0, 0, -1, -1) // bounds, ignored
        .u32(1) // GM_COMPATIBLE
        .f32(1, 1) // page units to .01 mm
        .i32(x, y)
        .u32(chars, 76, 0)
        .i32(0, 0, -1, -1) // no clipping or opaque rectangle
        .u32(76 + stringBytes)
        .utf16(s, stringBytes / 2)
        .u32(...dx),
    );
    out.ints(EMR.SELECTOBJECT, SYSTEM_FONT);
    out.ints(EMR.DELETEOBJECT, FONT);
  };

  for (const t of tokens(page.content)) {
    if (t.kind !== "op") {
      args.push(t);
      continue;
    }
    const a = nums();
    switch (t.v) {
      case "q":
        stack.push({ ...st, fill: [...st.fill], stroke: [...st.stroke], dash: [...st.dash] });
        out.add(EMR.SAVEDC, 0);
        break;
      case "Q":
        st = stack.pop() ?? st;
        out.ints(EMR.RESTOREDC, -1);
        break;
      case "cm":
        if (a.length === 6) st.ctm = times(a, st.ctm);
        break;
      case "w":
        st.width = a[0] ?? 1;
        break;
      case "J":
        st.cap = a[0] ?? 0;
        break;
      case "j":
        st.join = a[0] ?? 0;
        break;
      case "d": {
        const arr = args.find((x) => x.kind === "arr");
        st.dash = arr && arr.kind === "arr" ? arrayNumbers(arr.raw).filter((v) => v >= 0) : [];
        if (st.dash.every((v) => v === 0)) st.dash = [];
        break;
      }
      case "rg":
        st.fill = a.slice(0, 3);
        break;
      case "RG":
        st.stroke = a.slice(0, 3);
        break;
      case "gs": {
        const name = args.find((x) => x.kind === "name");
        const al = stateAlpha(name && name.kind === "name" ? page.states.get(name.v) : undefined);
        st.fillAlpha = al.fill;
        st.strokeAlpha = al.stroke;
        break;
      }
      case "m":
        path.push({ type: EMR.MOVETOEX, pts: at(a[0], a[1]) });
        break;
      case "l":
        path.push({ type: EMR.LINETO, pts: at(a[0], a[1]) });
        break;
      case "c":
        path.push({ type: EMR.POLYBEZIERTO, pts: [...at(a[0], a[1]), ...at(a[2], a[3]), ...at(a[4], a[5])] });
        break;
      case "h":
        path.push({ type: EMR.CLOSEFIGURE, pts: [] });
        break;
      case "re": {
        const [x, y, w, hh] = a;
        path.push(
          { type: EMR.MOVETOEX, pts: at(x, y) },
          { type: EMR.LINETO, pts: at(x + w, y) },
          { type: EMR.LINETO, pts: at(x + w, y + hh) },
          { type: EMR.LINETO, pts: at(x, y + hh) },
          { type: EMR.CLOSEFIGURE, pts: [] },
        );
        break;
      }
      case "W":
        clipNext = 1;
        break;
      case "W*":
        clipNext = 2;
        break;
      case "n":
        paint(0, false);
        break;
      case "S":
        paint(0, true);
        break;
      case "f":
      case "F":
        paint(1, false);
        break;
      case "f*":
        paint(2, false);
        break;
      case "B":
        paint(1, true);
        break;
      case "B*":
        paint(2, true);
        break;
      case "BT":
      case "ET":
        tm = [1, 0, 0, 1, 0, 0];
        break;
      case "Tf": {
        const name = args.find((x) => x.kind === "name");
        if (name && name.kind === "name") st.font = name.v;
        st.size = a[0] ?? st.size;
        break;
      }
      case "Tz":
        st.hscale = a[0] ?? 100;
        break;
      case "Tm":
        if (a.length === 6) tm = [a[0], a[1], a[2], a[3], a[4], a[5]];
        break;
      case "Tj": {
        const s = args.find((x) => x.kind === "str");
        if (s && s.kind === "str") text(s.raw);
        break;
      }
      // images (Do) and anything else pdf.ts doesn't write are left out
      default:
        break;
    }
    args.length = 0;
  }

  out.ints(EMR.EOF, 0, 16, 20); // no palette; this record's size

  // the header: the page's bounds and frame (both in hundredths of a millimetre here), a reference
  // device of 100 pixels a millimetre, and a description naming the program and the drawing
  const description = `Rodeo\0${title}\0\0`;
  const descriptionBytes = Math.ceil((2 * description.length) / 4) * 4;
  const mm = [Math.ceil(right / 100), Math.ceil(bottom / 100)];
  const header = new Records();
  header.add(EMR.HEADER, 100 + descriptionBytes, (f) =>
    f
      .i32(0, 0, right, bottom) // bounds
      .i32(0, 0, right, bottom) // frame
      .u32(0x464d4520, 0x10000) // " EMF", version 1.0
      .u32(0, 0) // bytes and records, filled in below
      .u32(4) // handles (the three object table slots and slot 0), and 0 reserved
      .u32(description.length, 108, 0)
      .i32(mm[0] * 100, mm[1] * 100, mm[0], mm[1]) // device in pixels, then millimetres
      .u32(0, 0, 0) // no pixel format, not OpenGL
      .u32(mm[0] * 1000, mm[1] * 1000) // device in micrometres
      .utf16(description, descriptionBytes / 2),
  );
  const parts = [...header.parts, ...out.parts];
  const total = header.bytes + out.bytes;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  const view = new DataView(bytes.buffer);
  view.setUint32(48, total, true);
  view.setUint32(52, parts.length, true);
  return { bytes, imagesLeftOut: page.images };
}
