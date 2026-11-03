// Packing for the Scene Shop's cut lists. Lengths of solid stock go into the sticks it comes in, first fit with
// the longest cut first, a saw kerf between cuts on a stick and the shortest stick that holds the first cut.
// Sheets are nested on shelves, longest side first, each piece turned if that fits. Pure: lengths in mm, and
// prices are the caller's. Leaves out grain, knots, and offcuts kept for later.

/** A piece to cut: `qty` of them, each `lengthMm` long from a stick of `material`. */
export interface CutPiece {
  readonly mark: string;
  readonly material: string;
  readonly lengthMm: number;
  readonly qty: number;
}

export interface Cut {
  readonly mark: string;
  readonly lengthMm: number;
}

/** One stick bought: what is cut from it, and what is left over. */
export interface Stick {
  readonly material: string;
  readonly stockMm: number;
  readonly cuts: readonly Cut[];
  readonly offcutMm: number;
}

export interface CutResult {
  readonly sticks: readonly Stick[];
  /** pieces longer than the longest stick, one entry each */
  readonly tooLong: readonly CutPiece[];
  /** how many sticks of each length of each material */
  readonly byLength: readonly { readonly material: string; readonly stockMm: number; readonly count: number }[];
  /** the offcuts as a share of all the stick, 0 to 100 */
  readonly wastePct: number;
}

interface Open {
  readonly stockMm: number;
  used: number;
  readonly cuts: Cut[];
}

/**
 * Packs the pieces into sticks of the lengths given, by material. Each piece goes on the first stick with room
 * (a kerf between cuts counts against it); a new stick is the shortest length that holds the piece.
 */
export function cutStock(pieces: readonly CutPiece[], stockLengths: readonly number[], kerfMm: number): CutResult {
  const stocks = [...new Set(stockLengths.map((n) => Math.round(n)).filter((n) => n > 0))].sort((a, b) => a - b);
  const longest = stocks.at(-1) ?? 0;
  const materials = [...new Set(pieces.map((p) => p.material))];
  const sticks: Stick[] = [];
  const tooLong: CutPiece[] = [];
  for (const material of materials) {
    const list: Cut[] = [];
    for (const p of pieces) {
      if (p.material !== material || !(p.lengthMm > 0)) continue;
      for (let i = 0; i < p.qty; i++) list.push({ mark: p.mark, lengthMm: p.lengthMm });
    }
    // longest first; the sort is stable, so equal pieces keep their order
    list.sort((a, b) => b.lengthMm - a.lengthMm);
    const open: Open[] = [];
    for (const c of list) {
      if (c.lengthMm > longest) {
        tooLong.push({ mark: c.mark, material, lengthMm: c.lengthMm, qty: 1 });
        continue;
      }
      const home = open.find((s) => s.used + (s.cuts.length ? kerfMm : 0) + c.lengthMm <= s.stockMm);
      if (home) {
        home.used += (home.cuts.length ? kerfMm : 0) + c.lengthMm;
        home.cuts.push(c);
        continue;
      }
      const stockMm = stocks.find((s) => s >= c.lengthMm) ?? longest;
      open.push({ stockMm, used: c.lengthMm, cuts: [c] });
    }
    for (const s of open) sticks.push({ material, stockMm: s.stockMm, cuts: s.cuts, offcutMm: s.stockMm - s.used });
  }
  const totalStock = sticks.reduce((sum, s) => sum + s.stockMm, 0);
  const totalOffcut = sticks.reduce((sum, s) => sum + s.offcutMm, 0);
  const counts = new Map<string, { material: string; stockMm: number; count: number }>();
  for (const s of sticks) {
    const key = `${s.material}|${s.stockMm}`;
    const found = counts.get(key);
    if (found) found.count++;
    else counts.set(key, { material: s.material, stockMm: s.stockMm, count: 1 });
  }
  return {
    sticks,
    tooLong,
    byLength: [...counts.values()].sort((a, b) => (a.material < b.material ? -1 : a.material > b.material ? 1 : a.stockMm - b.stockMm)),
    wastePct: totalStock > 0 ? (totalOffcut / totalStock) * 100 : 0,
  };
}

/** A rectangle to nest on a sheet: its size as drawn, the mark it's known by. */
export interface NestRect {
  readonly mark: string;
  readonly widthMm: number;
  readonly heightMm: number;
}

/** Where a rectangle sits on its sheet, from the sheet's bottom left corner, and whether it's turned. */
export interface Placed {
  readonly mark: string;
  readonly xMm: number;
  readonly yMm: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly turned: boolean;
}

export interface NestResult {
  readonly sheets: readonly (readonly Placed[])[];
  /** rectangles that don't fit a sheet either way round */
  readonly tooBig: readonly NestRect[];
  readonly wastePct: number;
}

interface Shelf {
  readonly y: number;
  readonly h: number;
  x: number;
}

interface SheetState {
  readonly shelves: Shelf[];
  readonly placed: Placed[];
}

/**
 * Nests rectangles on sheets in shelves: each takes the first shelf with room, else a new shelf on a sheet with
 * room above, else a new sheet. Longest side first; a rectangle turns when the turn fits. A kerf sits between
 * neighbours (not at the sheet's edge), so a row that needs the kerf too can't take a second piece.
 */
export function nestSheets(rects: readonly NestRect[], sheetW: number, sheetH: number, kerfMm: number): NestResult {
  const tooBig: NestRect[] = [];
  const todo: NestRect[] = [];
  for (const r of rects) {
    const fits = (r.widthMm <= sheetW && r.heightMm <= sheetH) || (r.heightMm <= sheetW && r.widthMm <= sheetH);
    if (fits) todo.push(r);
    else tooBig.push(r);
  }
  todo.sort((a, b) => Math.max(b.widthMm, b.heightMm) - Math.max(a.widthMm, a.heightMm));
  const sheets: SheetState[] = [];
  const place = (sh: SheetState, shelf: Shelf, r: NestRect, turned: boolean, x: number): void => {
    const w = turned ? r.heightMm : r.widthMm;
    const h = turned ? r.widthMm : r.heightMm;
    sh.placed.push({ mark: r.mark, xMm: x, yMm: shelf.y, widthMm: w, heightMm: h, turned });
    shelf.x = x + w + kerfMm;
  };
  for (const r of todo) {
    const options = [
      { turned: false, w: r.widthMm, h: r.heightMm },
      { turned: true, w: r.heightMm, h: r.widthMm },
    ];
    let done = false;
    // an existing shelf, first sheet first
    for (const sh of sheets) {
      for (const shelf of sh.shelves) {
        const o = options.find((opt) => opt.h <= shelf.h && shelf.x + opt.w <= sheetW);
        if (o) {
          place(sh, shelf, r, o.turned, shelf.x);
          done = true;
          break;
        }
      }
      if (done) break;
    }
    if (done) continue;
    // a new shelf on a sheet, the shorter turn first
    const byHeight = [...options].sort((a, b) => a.h - b.h);
    for (const sh of sheets) {
      const last = sh.shelves.at(-1);
      const y = last ? last.y + last.h + kerfMm : 0;
      const o = byHeight.find((opt) => opt.w <= sheetW && y + opt.h <= sheetH);
      if (o) {
        const shelf: Shelf = { y, h: o.h, x: 0 };
        sh.shelves.push(shelf);
        place(sh, shelf, r, o.turned, 0);
        done = true;
        break;
      }
    }
    if (done) continue;
    const o = byHeight.find((opt) => opt.w <= sheetW && opt.h <= sheetH) as (typeof options)[number];
    const sh: SheetState = { shelves: [], placed: [] };
    const shelf: Shelf = { y: 0, h: o.h, x: 0 };
    sh.shelves.push(shelf);
    sheets.push(sh);
    place(sh, shelf, r, o.turned, 0);
  }
  const sheetArea = sheetW * sheetH;
  const used = todo.reduce((sum, r) => sum + r.widthMm * r.heightMm, 0);
  const total = sheets.length * sheetArea;
  return {
    sheets: sheets.map((s) => s.placed),
    tooBig,
    wastePct: total > 0 ? ((total - used) / total) * 100 : 0,
  };
}

/** A line of counts with a unit price each. */
export function costOf(lines: readonly { readonly count: number; readonly unit: number }[]): number {
  return lines.reduce((sum, l) => sum + l.count * l.unit, 0);
}
