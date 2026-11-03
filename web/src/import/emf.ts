// Windows enhanced metafile (.emf) import, the reading side: readEmf (no DOM) plays a metafile's GDI
// records into the page Import PDF places (import/pdf.ts's PdfPage): its line work and fills as
// paths and its text as texts, in points, y up, the origin at the bottom left of the picture's frame.
// Logical coordinates go through the world transform, the mapping mode with its window and
// viewport, and the reference device's pixels to millimetres, as GDI maps them. Pens, brushes and
// fonts (and the stock ones) are followed, with SaveDC and RestoreDC, path brackets and the arc
// direction; curves, ellipses and arcs are flattened. Pictures (bitmaps), regions and pattern or
// hatch fills are left out and counted, as are files drawn only in EMF+ records; clipping is left
// out as Import PDF leaves it.

import type { Pt } from "../core/types.ts";
import { helveticaWidth } from "../export/pdf.ts";
import type { PdfColor, PdfPage, PdfPath, PdfSubpath, PdfText } from "./pdf.ts";

const PT_PER_MM = 72 / 25.4;
/** most paths and texts one picture may have, as a PDF page */
const MAX_ITEMS = 200_000;
/** straight pieces a Bézier curve becomes */
const BEZIER_STEPS = 12;
/** straight pieces a whole ellipse becomes */
const ELLIPSE_STEPS = 64;
/** an em as a share of a font's cell height (a positive LOGFONT height), and its ascent and descent */
const EM_PER_CELL = 1 / 1.15;
const ASCENT = 0.905;
const DESCENT = 0.212;

// record types
const HEADER = 1;
const POLYBEZIER = 2;
const POLYGON = 3;
const POLYLINE = 4;
const POLYBEZIERTO = 5;
const POLYLINETO = 6;
const POLYPOLYLINE = 7;
const POLYPOLYGON = 8;
const SETWINDOWEXTEX = 9;
const SETWINDOWORGEX = 10;
const SETVIEWPORTEXTEX = 11;
const SETVIEWPORTORGEX = 12;
const EOF = 14;
const SETMAPMODE = 17;
const SETPOLYFILLMODE = 19;
const SETTEXTALIGN = 22;
const SETTEXTCOLOR = 24;
const OFFSETCLIPRGN = 26;
const MOVETOEX = 27;
const EXCLUDECLIPRECT = 29;
const INTERSECTCLIPRECT = 30;
const SCALEVIEWPORTEXTEX = 31;
const SCALEWINDOWEXTEX = 32;
const SAVEDC = 33;
const RESTOREDC = 34;
const SETWORLDTRANSFORM = 35;
const MODIFYWORLDTRANSFORM = 36;
const SELECTOBJECT = 37;
const CREATEPEN = 38;
const CREATEBRUSHINDIRECT = 39;
const DELETEOBJECT = 40;
const ANGLEARC = 41;
const ELLIPSE = 42;
const RECTANGLE = 43;
const ROUNDRECT = 44;
const ARC = 45;
const CHORD = 46;
const PIE = 47;
const LINETO = 54;
const ARCTO = 55;
const POLYDRAW = 56;
const SETARCDIRECTION = 57;
const BEGINPATH = 59;
const ENDPATH = 60;
const CLOSEFIGURE = 61;
const FILLPATH = 62;
const STROKEANDFILLPATH = 63;
const STROKEPATH = 64;
const SELECTCLIPPATH = 67;
const ABORTPATH = 68;
const GDICOMMENT = 70;
const FILLRGN = 71;
const FRAMERGN = 72;
const INVERTRGN = 73;
const PAINTRGN = 74;
const EXTSELECTCLIPRGN = 75;
const BITBLT = 76;
const STRETCHBLT = 77;
const MASKBLT = 78;
const PLGBLT = 79;
const SETDIBITSTODEVICE = 80;
const STRETCHDIBITS = 81;
const EXTCREATEFONTINDIRECTW = 82;
const EXTTEXTOUTA = 83;
const EXTTEXTOUTW = 84;
const POLYBEZIER16 = 85;
const POLYGON16 = 86;
const POLYLINE16 = 87;
const POLYBEZIERTO16 = 88;
const POLYLINETO16 = 89;
const POLYPOLYLINE16 = 90;
const POLYPOLYGON16 = 91;
const POLYDRAW16 = 92;
const CREATEMONOBRUSH = 93;
const CREATEDIBPATTERNBRUSHPT = 94;
const EXTCREATEPEN = 95;
const SMALLTEXTOUT = 108;
const ALPHABLEND = 114;
const TRANSPARENTBLT = 116;

/** " EMF" in the header, and "EMF+" opening a comment that holds EMF+ records */
const EMF_SIGNATURE = 0x464d4520;
const EMF_PLUS = 0x2b464d45;

// mapping modes; the fixed ones' logical unit in millimetres (their y runs up)
const MM_TEXT = 1;
const MM_ISOTROPIC = 7;
const MM_ANISOTROPIC = 8;
const FIXED_MM: Readonly<Record<number, number>> = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 };

const PS_NULL = 5;
const PS_STYLE_MASK = 0xf;
const PS_GEOMETRIC = 0x10000;
const PS_TYPE_MASK = 0xf0000;
const BS_SOLID = 0;
const BS_NULL = 1;
const TA_UPDATECP = 1;
const TA_HMASK = 6;
const TA_RIGHT = 2;
const TA_CENTER = 6;
const TA_VMASK = 24;
const TA_BOTTOM = 8;
const TA_BASELINE = 24;
const ETO_PDY = 0x2000;
const AD_CLOCKWISE = 2;
const STOCK = 0x80000000;

interface Pen {
  /** null for no line */
  readonly color: PdfColor | null;
  /** logical units, or null for a cosmetic pen (the thinnest line) */
  readonly width: number | null;
}

interface Brush {
  /** null for no fill */
  readonly color: PdfColor | null;
}

interface Font {
  /** logical units: negative an em, positive a cell */
  readonly height: number;
  /** tenths of a degree, anticlockwise */
  readonly escapement: number;
}

type GdiObject = { readonly pen: Pen } | { readonly brush: Brush } | { readonly font: Font } | { readonly other: true };

/** eM11, eM12, eM21, eM22, eDx, eDy: x' = x·eM11 + y·eM21 + eDx, y' = x·eM12 + y·eM22 + eDy */
type Xform = readonly [number, number, number, number, number, number];
const IDENTITY: Xform = [1, 0, 0, 1, 0, 0];

interface Dc {
  pen: Pen;
  brush: Brush;
  font: Font;
  textColor: PdfColor;
  textAlign: number;
  mapMode: number;
  windowOrg: Pt;
  windowExt: Pt;
  viewportOrg: Pt;
  viewportExt: Pt;
  world: Xform;
  clockwise: boolean;
  /** the current position, logical */
  at: Pt;
}

const BLACK: PdfColor = { r: 0, g: 0, b: 0 };
const rgb = (r: number, g: number, b: number): PdfColor => ({ r: r / 255, g: g / 255, b: b / 255 });

/** The stock objects GetStockObject gives, by their index. */
const STOCK_OBJECTS: Readonly<Record<number, GdiObject>> = {
  0: { brush: { color: rgb(255, 255, 255) } },
  1: { brush: { color: rgb(192, 192, 192) } },
  2: { brush: { color: rgb(128, 128, 128) } },
  3: { brush: { color: rgb(64, 64, 64) } },
  4: { brush: { color: BLACK } },
  5: { brush: { color: null } },
  6: { pen: { color: rgb(255, 255, 255), width: null } },
  7: { pen: { color: BLACK, width: null } },
  8: { pen: { color: null, width: null } },
  18: { brush: { color: rgb(255, 255, 255) } },
  19: { pen: { color: BLACK, width: null } },
};

function colorRef(v: number): PdfColor {
  return rgb(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff);
}

function compose(a: Xform, b: Xform): Xform {
  // a then b
  return [
    a[0] * b[0] + a[1] * b[2],
    a[0] * b[1] + a[1] * b[3],
    a[2] * b[0] + a[3] * b[2],
    a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4],
    a[4] * b[1] + a[5] * b[3] + b[5],
  ];
}

/** Subpaths being built, in page points: open figures and closed ones. */
class Figures {
  readonly done: PdfSubpath[] = [];
  private open: Pt[] | null = null;

  move(p: Pt): void {
    this.end();
    this.open = [p];
  }

  line(p: Pt, from: Pt): void {
    if (!this.open) this.open = [from];
    this.open.push(p);
  }

  close(): void {
    if (this.open && this.open.length > 1) this.done.push({ points: this.open, closed: true });
    this.open = null;
  }

  end(): void {
    if (this.open && this.open.length > 1) this.done.push({ points: this.open, closed: false });
    this.open = null;
  }

  take(): PdfSubpath[] {
    this.end();
    return this.done.splice(0);
  }
}

class Player {
  readonly paths: PdfPath[] = [];
  readonly texts: PdfText[] = [];
  readonly skipped: Record<string, number> = {};
  private readonly objects = new Map<number, GdiObject>();
  private readonly saved: Dc[] = [];
  private dc: Dc;
  /** the path bracket's figures (BeginPath to EndPath and its use), null outside one */
  private path: Figures | null = null;
  private inBracket = false;
  /** EMF+ comments seen */
  plus = 0;

  constructor(
    /** device pixel to page millimetre, per axis, and the frame's top-left corner in millimetres */
    private readonly mmPerPx: Pt,
    private readonly frame: Pt,
    private readonly heightMm: number,
  ) {
    this.dc = {
      pen: { color: BLACK, width: null },
      brush: { color: rgb(255, 255, 255) },
      font: { height: -12, escapement: 0 },
      textColor: BLACK,
      textAlign: 0,
      mapMode: MM_TEXT,
      windowOrg: { x: 0, y: 0 },
      windowExt: { x: 1, y: 1 },
      viewportOrg: { x: 0, y: 0 },
      viewportExt: { x: 1, y: 1 },
      world: IDENTITY,
      clockwise: false,
      at: { x: 0, y: 0 },
    };
  }

  skip(kind: string, n = 1): void {
    this.skipped[kind] = (this.skipped[kind] ?? 0) + n;
  }

  full(): boolean {
    if (this.paths.length + this.texts.length < MAX_ITEMS) return false;
    this.skip("over the limit");
    return true;
  }

  // ---- mapping ---------------------------------------------------------------------------

  /** Device pixels per page-space unit along x and y, as the mapping mode has them. */
  private scales(): Pt {
    const dc = this.dc;
    const fixed = FIXED_MM[dc.mapMode];
    if (fixed !== undefined) return { x: fixed / this.mmPerPx.x, y: -fixed / this.mmPerPx.y };
    if (dc.mapMode !== MM_ISOTROPIC && dc.mapMode !== MM_ANISOTROPIC) return { x: 1, y: 1 };
    const sx = dc.windowExt.x ? dc.viewportExt.x / dc.windowExt.x : 1;
    const sy = dc.windowExt.y ? dc.viewportExt.y / dc.windowExt.y : 1;
    if (dc.mapMode === MM_ANISOTROPIC) return { x: sx, y: sy };
    const s = Math.min(Math.abs(sx), Math.abs(sy));
    return { x: Math.sign(sx || 1) * s, y: Math.sign(sy || 1) * s };
  }

  /** The whole logical-to-page-millimetre transform (y down), as an Xform. */
  private toMm(): Xform {
    const dc = this.dc;
    const s = this.scales();
    const sx = s.x * this.mmPerPx.x;
    const sy = s.y * this.mmPerPx.y;
    const page: Xform = [
      sx,
      0,
      0,
      sy,
      (dc.viewportOrg.x - dc.windowOrg.x * s.x) * this.mmPerPx.x - this.frame.x,
      (dc.viewportOrg.y - dc.windowOrg.y * s.y) * this.mmPerPx.y - this.frame.y,
    ];
    return compose(dc.world, page);
  }

  /** A logical point in page points (y up from the frame's bottom). */
  pt(x: number, y: number): Pt {
    const m = this.toMm();
    const mx = x * m[0] + y * m[2] + m[4];
    const my = x * m[1] + y * m[3] + m[5];
    return { x: mx * PT_PER_MM, y: (this.heightMm - my) * PT_PER_MM };
  }

  /** A logical length in points (the transform's mean scale). */
  len(n: number): number {
    const m = this.toMm();
    return Math.abs(n) * Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) * PT_PER_MM;
  }

  /** Whether the logical y axis runs up the page (the transform turns the picture over). */
  private yUp(): boolean {
    const m = this.toMm();
    return m[0] * m[3] - m[1] * m[2] < 0;
  }

  // ---- state -----------------------------------------------------------------------------

  setMapMode(mode: number): void {
    this.dc.mapMode = mode;
  }

  setWindowOrg(p: Pt): void {
    this.dc.windowOrg = p;
  }

  setWindowExt(p: Pt): void {
    if (this.dc.mapMode === MM_ISOTROPIC || this.dc.mapMode === MM_ANISOTROPIC) this.dc.windowExt = p;
  }

  setViewportOrg(p: Pt): void {
    this.dc.viewportOrg = p;
  }

  setViewportExt(p: Pt): void {
    if (this.dc.mapMode === MM_ISOTROPIC || this.dc.mapMode === MM_ANISOTROPIC) this.dc.viewportExt = p;
  }

  scaleExt(viewport: boolean, xn: number, xd: number, yn: number, yd: number): void {
    if (!xd || !yd) return;
    const e = viewport ? this.dc.viewportExt : this.dc.windowExt;
    const next = { x: (e.x * xn) / xd, y: (e.y * yn) / yd };
    if (viewport) this.setViewportExt(next);
    else this.setWindowExt(next);
  }

  setWorld(x: Xform, mode: number | null): void {
    if (mode === null || mode === 4) this.dc.world = x;
    else if (mode === 1) this.dc.world = IDENTITY;
    else if (mode === 2) this.dc.world = compose(x, this.dc.world);
    else if (mode === 3) this.dc.world = compose(this.dc.world, x);
  }

  setTextColor(c: PdfColor): void {
    this.dc.textColor = c;
  }

  setTextAlign(a: number): void {
    this.dc.textAlign = a;
  }

  setArcDirection(d: number): void {
    this.dc.clockwise = d === AD_CLOCKWISE;
  }

  save(): void {
    this.saved.push({ ...this.dc });
  }

  restore(n: number): void {
    // a negative count goes back that many saves; a positive one to that save
    const keep = n < 0 ? this.saved.length + n : n - 1;
    if (keep < 0 || keep >= this.saved.length) return;
    this.dc = this.saved[keep];
    this.saved.length = keep;
  }

  create(index: number, o: GdiObject): void {
    this.objects.set(index, o);
  }

  delete(index: number): void {
    this.objects.delete(index);
  }

  select(index: number): void {
    const o = index >= STOCK ? STOCK_OBJECTS[index - STOCK] : this.objects.get(index);
    if (!o) return;
    if ("pen" in o) this.dc.pen = o.pen;
    else if ("brush" in o) this.dc.brush = o.brush;
    else if ("font" in o) this.dc.font = o.font;
  }

  // ---- drawing ---------------------------------------------------------------------------

  /** Figures to add to: the path bracket's, or ones drawn at once. */
  private figures(): Figures {
    return this.inBracket && this.path ? this.path : new Figures();
  }

  /** Draws `f` at once unless a path bracket takes it: filled (and outlined) or only outlined. */
  private draw(f: Figures, filled: boolean): void {
    if (this.inBracket) return;
    this.paint(f.take(), filled, true);
  }

  private paint(subpaths: PdfSubpath[], fill: boolean, stroke: boolean): void {
    if (subpaths.length === 0 || this.full()) return;
    const pen = stroke ? this.dc.pen : null;
    const fillColor = fill ? this.dc.brush.color : null;
    const strokeColor = pen?.color ?? null;
    if (!fillColor && !strokeColor) return;
    const width = pen && pen.width !== null ? this.len(pen.width) : 0;
    this.paths.push({ subpaths: fill ? subpaths.map((s) => ({ points: s.points, closed: true })) : subpaths, stroke: strokeColor, fill: fillColor, width });
  }

  moveTo(p: Pt): void {
    this.dc.at = p;
    if (this.inBracket) this.path?.move(this.pt(p.x, p.y));
  }

  lineTo(p: Pt): void {
    const f = this.figures();
    f.line(this.pt(p.x, p.y), this.pt(this.dc.at.x, this.dc.at.y));
    this.dc.at = p;
    this.draw(f, false);
  }

  /** Polygon, Polyline, PolyBezier and their -To forms: `closed` ones fill, `to` ones start from the current position. */
  poly(pts: readonly Pt[], opts: { closed: boolean; bezier: boolean; to: boolean }): void {
    if (pts.length === 0) return;
    const f = this.figures();
    const start = opts.to ? this.dc.at : pts[0];
    const rest = opts.to ? pts : pts.slice(1);
    if (opts.to) {
      if (!this.inBracket) f.move(this.pt(start.x, start.y));
    } else f.move(this.pt(start.x, start.y));
    const from = this.pt(start.x, start.y);
    if (opts.bezier) {
      let p0 = start;
      for (let i = 0; i + 2 < rest.length; i += 3) {
        const [c1, c2, p3] = [rest[i], rest[i + 1], rest[i + 2]];
        for (let k = 1; k <= BEZIER_STEPS; k++) {
          const t = k / BEZIER_STEPS;
          const u = 1 - t;
          const x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x;
          const y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y;
          f.line(this.pt(x, y), from);
        }
        p0 = p3;
      }
    } else {
      for (const p of rest) f.line(this.pt(p.x, p.y), from);
    }
    if (opts.to || this.inBracket) this.dc.at = rest[rest.length - 1] ?? this.dc.at;
    if (opts.closed) f.close();
    this.draw(f, opts.closed);
  }

  /** PolyPolygon and PolyPolyline: each run of points its own figure, one shape. */
  polyPoly(runs: readonly (readonly Pt[])[], closed: boolean): void {
    const f = this.figures();
    for (const run of runs) {
      if (run.length < 2) continue;
      f.move(this.pt(run[0].x, run[0].y));
      const from = this.pt(run[0].x, run[0].y);
      for (const p of run.slice(1)) f.line(this.pt(p.x, p.y), from);
      if (closed) f.close();
      else f.end();
    }
    this.draw(f, closed);
  }

  /** Points round the ellipse in box `b` from angle t0 through `sweep` (radians, logical, y as stored). */
  private ellipsePts(b: { l: number; t: number; r: number; btm: number }, t0: number, sweep: number): Pt[] {
    const cx = (b.l + b.r) / 2;
    const cy = (b.t + b.btm) / 2;
    const rx = Math.abs(b.r - b.l) / 2;
    const ry = Math.abs(b.btm - b.t) / 2;
    const n = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * ELLIPSE_STEPS));
    const out: Pt[] = [];
    for (let i = 0; i <= n; i++) {
      const t = t0 + (sweep * i) / n;
      out.push({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
    }
    return out;
  }

  ellipse(b: { l: number; t: number; r: number; btm: number }): void {
    const pts = this.ellipsePts(b, 0, 2 * Math.PI);
    pts.pop();
    this.poly(pts, { closed: true, bezier: false, to: false });
  }

  rectangle(b: { l: number; t: number; r: number; btm: number }): void {
    this.poly(
      [
        { x: b.l, y: b.t },
        { x: b.r, y: b.t },
        { x: b.r, y: b.btm },
        { x: b.l, y: b.btm },
      ],
      { closed: true, bezier: false, to: false },
    );
  }

  roundRect(b: { l: number; t: number; r: number; btm: number }, cw: number, ch: number): void {
    const [l, r] = [Math.min(b.l, b.r), Math.max(b.l, b.r)];
    const [t, btm] = [Math.min(b.t, b.btm), Math.max(b.t, b.btm)];
    const rx = Math.min(Math.abs(cw) / 2, (r - l) / 2);
    const ry = Math.min(Math.abs(ch) / 2, (btm - t) / 2);
    const corner = (cx: number, cy: number, from: number): Pt[] =>
      this.ellipsePts({ l: cx - rx, t: cy - ry, r: cx + rx, btm: cy + ry }, from, Math.PI / 2);
    const pts = [...corner(r - rx, t + ry, -Math.PI / 2), ...corner(r - rx, btm - ry, 0), ...corner(l + rx, btm - ry, Math.PI / 2), ...corner(l + rx, t + ry, Math.PI)];
    this.poly(pts, { closed: true, bezier: false, to: false });
  }

  /**
   * Arc, ArcTo, Chord and Pie: the ellipse in box `b` from the ray through `start` to the ray
   * through `end`, the way the arc direction says as the picture shows it.
   */
  arc(b: { l: number; t: number; r: number; btm: number }, start: Pt, end: Pt, kind: "arc" | "arcto" | "chord" | "pie"): void {
    const cx = (b.l + b.r) / 2;
    const cy = (b.t + b.btm) / 2;
    const rx = Math.abs(b.r - b.l) / 2 || 1;
    const ry = Math.abs(b.btm - b.t) / 2 || 1;
    const a0 = Math.atan2((start.y - cy) / ry, (start.x - cx) / rx);
    let a1 = Math.atan2((end.y - cy) / ry, (end.x - cx) / rx);
    // anticlockwise as shown runs against the logical angle where y runs down the page
    const decreasing = this.dc.clockwise === this.yUp();
    if (decreasing) {
      while (a1 >= a0) a1 -= 2 * Math.PI;
    } else {
      while (a1 <= a0) a1 += 2 * Math.PI;
    }
    const pts = this.ellipsePts(b, a0, a1 - a0);
    if (kind === "pie") pts.push({ x: cx, y: cy });
    if (kind === "arcto") {
      this.poly(pts, { closed: false, bezier: false, to: true });
      return;
    }
    this.poly(pts, { closed: kind !== "arc", bezier: false, to: false });
  }

  angleArc(c: Pt, radius: number, startDeg: number, sweepDeg: number): void {
    const pts: Pt[] = [];
    const n = Math.max(2, Math.ceil((Math.abs(sweepDeg) / 360) * ELLIPSE_STEPS));
    // its angles run anticlockwise as the picture shows them
    const sign = this.yUp() ? 1 : -1;
    for (let i = 0; i <= n; i++) {
      const a = ((startDeg + (sweepDeg * i) / n) * Math.PI) / 180;
      pts.push({ x: c.x + radius * Math.cos(a), y: c.y + sign * radius * Math.sin(a) });
    }
    this.poly(pts, { closed: false, bezier: false, to: true });
  }

  /** PolyDraw: each point a move, a line, a Bézier's or a figure's close. */
  polyDraw(pts: readonly Pt[], types: readonly number[]): void {
    const f = this.figures();
    let at = this.dc.at;
    for (let i = 0; i < pts.length; i++) {
      const kind = types[i] & 6;
      if (kind === 6) {
        f.move(this.pt(pts[i].x, pts[i].y));
        at = pts[i];
      } else if (kind === 4 && i + 2 < pts.length) {
        const [c1, c2, p3] = [pts[i], pts[i + 1], pts[i + 2]];
        for (let k = 1; k <= BEZIER_STEPS; k++) {
          const t = k / BEZIER_STEPS;
          const u = 1 - t;
          f.line(
            this.pt(
              u * u * u * at.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
              u * u * u * at.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
            ),
            this.pt(at.x, at.y),
          );
        }
        at = p3;
        if (types[i + 2] & 1) f.close();
        i += 2;
      } else {
        f.line(this.pt(pts[i].x, pts[i].y), this.pt(at.x, at.y));
        at = pts[i];
        if (types[i] & 1) f.close();
      }
    }
    this.dc.at = at;
    this.draw(f, false);
  }

  beginPath(): void {
    this.path = new Figures();
    this.inBracket = true;
  }

  endPath(): void {
    this.inBracket = false;
  }

  abortPath(): void {
    this.path = null;
    this.inBracket = false;
  }

  closeFigure(): void {
    if (this.inBracket) this.path?.close();
  }

  /** FillPath, StrokePath, StrokeAndFillPath: the bracket's figures drawn, then gone. */
  usePath(fill: boolean, stroke: boolean): void {
    const f = this.path;
    this.path = null;
    this.inBracket = false;
    if (f) this.paint(f.take(), fill, stroke);
  }

  /** SelectClipPath: the bracket's figures become the clip, which is left out (as Import PDF leaves it). */
  clipPath(): void {
    this.path = null;
    this.inBracket = false;
  }

  /** ExtTextOut: `text` at the logical `ref` (or the current position), as the text alignment places it. */
  text(ref: Pt, text: string, advance: number | null): void {
    if (!text || this.full()) return;
    const dc = this.dc;
    const at = dc.textAlign & TA_UPDATECP ? dc.at : ref;
    const h = dc.font.height;
    const em = this.len(h < 0 ? -h : h * EM_PER_CELL) || 12;
    // the baseline's way across the page, from the escapement, the logical y and the world transform
    const e = (dc.font.escapement / 10) * (Math.PI / 180);
    const up = this.yUp();
    const a = this.pt(at.x, at.y);
    const b = this.pt(at.x + Math.cos(e) * 100, at.y + (up ? 1 : -1) * Math.sin(e) * 100);
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / d, y: (b.y - a.y) / d };
    const n = { x: -u.y, y: u.x };
    const width = advance !== null ? this.len(advance) : helveticaWidth(text) * em;
    const h0 = dc.textAlign & TA_HMASK;
    const along = h0 === TA_CENTER ? -width / 2 : h0 === TA_RIGHT ? -width : 0;
    const v0 = dc.textAlign & TA_VMASK;
    const across = v0 === TA_BASELINE ? 0 : v0 === TA_BOTTOM ? DESCENT * em : -ASCENT * em;
    const start = { x: a.x + u.x * along + n.x * across, y: a.y + u.y * along + n.y * across };
    if (dc.textAlign & TA_UPDATECP && advance !== null) dc.at = { x: dc.at.x + advance, y: dc.at.y };
    this.texts.push({ at: start, angle: (Math.atan2(u.y, u.x) * 180) / Math.PI, size: em, text, color: dc.textColor });
  }
}

/**
 * The picture an EMF file draws, read into a page: its size (the header's frame) in points, its
 * paths and texts, and what was left out by kind. Throws on a file that isn't an EMF.
 */
export function readEmf(bytes: Uint8Array): PdfPage {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 88 || v.getUint32(0, true) !== HEADER || v.getUint32(40, true) !== EMF_SIGNATURE) throw new Error("it isn't an enhanced metafile (EMF)");
  const i32 = (o: number): number => v.getInt32(o, true);
  const u32 = (o: number): number => v.getUint32(o, true);
  const headerSize = u32(4);
  // the frame, 0.01 mm, and the reference device: its pixels and its millimetres (or micrometres)
  const frame = { l: i32(24) / 100, t: i32(28) / 100, r: i32(32) / 100, b: i32(36) / 100 };
  const devPx = { x: i32(72), y: i32(76) };
  let devMm = { x: i32(80), y: i32(84) };
  if (headerSize >= 108 && i32(100) > 0 && i32(104) > 0) devMm = { x: i32(100) / 1000, y: i32(104) / 1000 };
  if (!(devPx.x > 0 && devPx.y > 0 && devMm.x > 0 && devMm.y > 0)) throw new Error("its header gives no reference device");
  const mmPerPx = { x: devMm.x / devPx.x, y: devMm.y / devPx.y };
  // a frame that says nothing: the bounds, in device pixels
  if (!(frame.r > frame.l && frame.b > frame.t)) {
    Object.assign(frame, { l: i32(8) * mmPerPx.x, t: i32(12) * mmPerPx.y, r: (i32(16) + 1) * mmPerPx.x, b: (i32(20) + 1) * mmPerPx.y });
  }
  const widthMm = Math.max(frame.r - frame.l, 0.01);
  const heightMm = Math.max(frame.b - frame.t, 0.01);
  const p = new Player(mmPerPx, { x: frame.l, y: frame.t }, heightMm);

  let at = 0;
  while (at + 8 <= bytes.length) {
    const type = u32(at);
    const size = u32(at + 4);
    if (size < 8 || size % 4 !== 0 || at + size > bytes.length) break;
    const r = at;
    at += size;
    if (type === EOF) break;
    const pts32 = (o: number, n: number): Pt[] => Array.from({ length: n }, (_, k) => ({ x: i32(r + o + k * 8), y: i32(r + o + k * 8 + 4) }));
    const pts16 = (o: number, n: number): Pt[] => Array.from({ length: n }, (_, k) => ({ x: v.getInt16(r + o + k * 4, true), y: v.getInt16(r + o + k * 4 + 2, true) }));
    const box = (o: number): { l: number; t: number; r: number; btm: number } => ({ l: i32(r + o), t: i32(r + o + 4), r: i32(r + o + 8), btm: i32(r + o + 12) });
    const count = (o: number, each: number): number => Math.max(0, Math.min(u32(r + o), Math.floor((size - o - 4) / each)));
    switch (type) {
      case POLYBEZIER:
      case POLYGON:
      case POLYLINE:
      case POLYBEZIERTO:
      case POLYLINETO: {
        const pts = pts32(28, count(24, 8));
        p.poly(pts, { closed: type === POLYGON, bezier: type === POLYBEZIER || type === POLYBEZIERTO, to: type === POLYBEZIERTO || type === POLYLINETO });
        break;
      }
      case POLYBEZIER16:
      case POLYGON16:
      case POLYLINE16:
      case POLYBEZIERTO16:
      case POLYLINETO16: {
        const pts = pts16(28, count(24, 4));
        p.poly(pts, { closed: type === POLYGON16, bezier: type === POLYBEZIER16 || type === POLYBEZIERTO16, to: type === POLYBEZIERTO16 || type === POLYLINETO16 });
        break;
      }
      case POLYPOLYLINE:
      case POLYPOLYGON:
      case POLYPOLYLINE16:
      case POLYPOLYGON16: {
        const wide = type === POLYPOLYLINE || type === POLYPOLYGON;
        const polys = u32(r + 24);
        const total = u32(r + 28);
        const counts = Array.from({ length: Math.min(polys, (size - 32) / 4) }, (_, k) => u32(r + 32 + k * 4));
        const o = 32 + counts.length * 4;
        const all = wide ? pts32(o, Math.min(total, (size - o) / 8)) : pts16(o, Math.min(total, (size - o) / 4));
        const runs: Pt[][] = [];
        let k = 0;
        for (const c of counts) {
          runs.push(all.slice(k, k + c));
          k += c;
        }
        p.polyPoly(runs, type === POLYPOLYGON || type === POLYPOLYGON16);
        break;
      }
      case POLYDRAW:
      case POLYDRAW16: {
        const wide = type === POLYDRAW;
        const n = count(24, wide ? 9 : 5);
        const pts = wide ? pts32(28, n) : pts16(28, n);
        const tOff = r + 28 + n * (wide ? 8 : 4);
        p.polyDraw(pts, Array.from({ length: n }, (_, k) => bytes[tOff + k]));
        break;
      }
      case RECTANGLE:
        p.rectangle(box(8));
        break;
      case ELLIPSE:
        p.ellipse(box(8));
        break;
      case ROUNDRECT:
        p.roundRect(box(8), i32(r + 24), i32(r + 28));
        break;
      case ARC:
      case ARCTO:
      case CHORD:
      case PIE:
        p.arc(box(8), { x: i32(r + 24), y: i32(r + 28) }, { x: i32(r + 32), y: i32(r + 36) }, type === ARC ? "arc" : type === ARCTO ? "arcto" : type === CHORD ? "chord" : "pie");
        break;
      case ANGLEARC:
        p.angleArc({ x: i32(r + 8), y: i32(r + 12) }, u32(r + 16), v.getFloat32(r + 20, true), v.getFloat32(r + 24, true));
        break;
      case MOVETOEX:
        p.moveTo({ x: i32(r + 8), y: i32(r + 12) });
        break;
      case LINETO:
        p.lineTo({ x: i32(r + 8), y: i32(r + 12) });
        break;
      case BEGINPATH:
        p.beginPath();
        break;
      case ENDPATH:
        p.endPath();
        break;
      case ABORTPATH:
        p.abortPath();
        break;
      case CLOSEFIGURE:
        p.closeFigure();
        break;
      case FILLPATH:
        p.usePath(true, false);
        break;
      case STROKEPATH:
        p.usePath(false, true);
        break;
      case STROKEANDFILLPATH:
        p.usePath(true, true);
        break;
      case SELECTCLIPPATH:
        p.clipPath();
        break;
      case SETMAPMODE:
        p.setMapMode(u32(r + 8));
        break;
      case SETWINDOWORGEX:
        p.setWindowOrg({ x: i32(r + 8), y: i32(r + 12) });
        break;
      case SETWINDOWEXTEX:
        p.setWindowExt({ x: i32(r + 8), y: i32(r + 12) });
        break;
      case SETVIEWPORTORGEX:
        p.setViewportOrg({ x: i32(r + 8), y: i32(r + 12) });
        break;
      case SETVIEWPORTEXTEX:
        p.setViewportExt({ x: i32(r + 8), y: i32(r + 12) });
        break;
      case SCALEVIEWPORTEXTEX:
      case SCALEWINDOWEXTEX:
        p.scaleExt(type === SCALEVIEWPORTEXTEX, i32(r + 8), i32(r + 12), i32(r + 16), i32(r + 20));
        break;
      case SETWORLDTRANSFORM:
      case MODIFYWORLDTRANSFORM: {
        const f = (k: number): number => v.getFloat32(r + 8 + k * 4, true);
        const x: Xform = [f(0), f(1), f(2), f(3), f(4), f(5)];
        p.setWorld(x, type === SETWORLDTRANSFORM ? null : u32(r + 32));
        break;
      }
      case SETARCDIRECTION:
        p.setArcDirection(u32(r + 8));
        break;
      case SETTEXTCOLOR:
        p.setTextColor(colorRef(u32(r + 8)));
        break;
      case SETTEXTALIGN:
        p.setTextAlign(u32(r + 8));
        break;
      case SETPOLYFILLMODE:
        // holes are found by nesting, as Import PDF finds them
        break;
      case SAVEDC:
        p.save();
        break;
      case RESTOREDC:
        p.restore(i32(r + 8));
        break;
      case CREATEPEN: {
        const style = u32(r + 12) & PS_STYLE_MASK;
        const width = i32(r + 16);
        p.create(u32(r + 8), { pen: { color: style === PS_NULL ? null : colorRef(u32(r + 24)), width: width > 0 ? width : null } });
        break;
      }
      case EXTCREATEPEN: {
        const style = u32(r + 28);
        const width = u32(r + 32);
        const brushStyle = u32(r + 36);
        const none = (style & PS_STYLE_MASK) === PS_NULL || brushStyle === BS_NULL;
        if (!none && brushStyle !== BS_SOLID) p.skip("patterned lines");
        const geometric = (style & PS_TYPE_MASK) === PS_GEOMETRIC;
        p.create(u32(r + 8), { pen: { color: none ? null : colorRef(u32(r + 40)), width: geometric && width > 0 ? width : null } });
        break;
      }
      case CREATEBRUSHINDIRECT: {
        const style = u32(r + 12);
        if (style !== BS_SOLID && style !== BS_NULL) p.skip("hatched or patterned fills");
        p.create(u32(r + 8), { brush: { color: style === BS_SOLID ? colorRef(u32(r + 16)) : null } });
        break;
      }
      case CREATEMONOBRUSH:
      case CREATEDIBPATTERNBRUSHPT:
        p.skip("hatched or patterned fills");
        p.create(u32(r + 8), { brush: { color: null } });
        break;
      case EXTCREATEFONTINDIRECTW:
        p.create(u32(r + 8), { font: { height: i32(r + 12) || -12, escapement: i32(r + 20) } });
        break;
      case SELECTOBJECT:
        p.select(u32(r + 8));
        break;
      case DELETEOBJECT:
        p.delete(u32(r + 8));
        break;
      case EXTTEXTOUTW:
      case EXTTEXTOUTA: {
        const ref = { x: i32(r + 36), y: i32(r + 40) };
        const chars = u32(r + 44);
        const offString = u32(r + 48);
        const options = u32(r + 52);
        const offDx = u32(r + 72);
        const wide = type === EXTTEXTOUTW;
        if (offString + chars * (wide ? 2 : 1) > size) break;
        let text = "";
        for (let k = 0; k < chars; k++) text += String.fromCharCode(wide ? v.getUint16(r + offString + k * 2, true) : bytes[r + offString + k]);
        // the characters' advances, when the record gives them (pairs, x then y, with ETO_PDY)
        let advance: number | null = null;
        const step = options & ETO_PDY ? 8 : 4;
        if (offDx > 0 && offDx + chars * step <= size) {
          advance = 0;
          for (let k = 0; k < chars; k++) advance += i32(r + offDx + k * step);
        }
        p.text(ref, text.replace(/\0+$/, ""), advance);
        break;
      }
      case SMALLTEXTOUT:
        p.skip("unreadable text");
        break;
      case BITBLT:
      case STRETCHBLT:
      case MASKBLT:
      case PLGBLT:
      case SETDIBITSTODEVICE:
      case STRETCHDIBITS:
      case ALPHABLEND:
      case TRANSPARENTBLT:
        p.skip("pictures");
        break;
      case EXCLUDECLIPRECT:
      case INTERSECTCLIPRECT:
      case EXTSELECTCLIPRGN:
      case OFFSETCLIPRGN:
        // clipping is left out, as Import PDF leaves it: what it would hide is drawn
        break;
      case FILLRGN:
      case FRAMERGN:
      case INVERTRGN:
      case PAINTRGN:
        p.skip("regions");
        break;
      case GDICOMMENT:
        if (size >= 16 && u32(r + 12) === EMF_PLUS) p.plus++;
        break;
      default:
        break;
    }
  }
  // a picture drawn only in EMF+ records (no GDI fallback) shows nothing here
  if (p.plus > 0 && p.paths.length === 0 && p.texts.length === 0) p.skip("EMF+ drawing", p.plus);
  return { width: widthMm * PT_PER_MM, height: heightMm * PT_PER_MM, paths: p.paths, texts: p.texts, skipped: p.skipped };
}
