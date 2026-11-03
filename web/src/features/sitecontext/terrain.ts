// Terrain for Site Context, without the network or the canvas: decoding the terrarium tiles
// (height = R·256 + G + B/256 − 32768 metres), a mosaic of tiles sampled at grid points, and
// contour lines by marching squares, chained into polylines. Grid coordinates are in cells: point
// (i, j) is the sample in column i and row j, row 0 at the south.

import type { Pt } from "../../core/index.ts";
import { TILE_PX } from "./geo.ts";
import { dedupe, simplify } from "./shapes.ts";

/** Metres from the RGB channels of terrarium tiles, one value per pixel (4 bytes each). */
export function decodeTerrarium(rgba: ArrayLike<number>): Float32Array {
  const n = Math.floor(rgba.length / 4);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const r = rgba[4 * i];
    const g = rgba[4 * i + 1];
    const b = rgba[4 * i + 2];
    out[i] = r * 256 + g + b / 256 - 32768;
  }
  return out;
}

/**
 * Tiles stitched into one pixel array, sampled bilinearly at global pixel positions (the web
 * mercator pixels of `zoom`). A pixel with no tile is NaN.
 */
export class Mosaic {
  readonly zoom: number;
  readonly tx0: number;
  readonly ty0: number;
  readonly cols: number;
  readonly rows: number;
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;

  constructor(zoom: number, tx0: number, ty0: number, cols: number, rows: number) {
    this.zoom = zoom;
    this.tx0 = tx0;
    this.ty0 = ty0;
    this.cols = cols;
    this.rows = rows;
    this.width = cols * TILE_PX;
    this.height = rows * TILE_PX;
    this.data = new Float32Array(this.width * this.height).fill(Number.NaN);
  }

  /** Copies one tile's heights (256 × 256, row by row) into place. */
  setTile(tx: number, ty: number, heights: Float32Array): void {
    const col = tx - this.tx0;
    const row = ty - this.ty0;
    if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) throw new Error("tile outside the mosaic");
    for (let y = 0; y < TILE_PX; y++) {
      const dst = (row * TILE_PX + y) * this.width + col * TILE_PX;
      this.data.set(heights.subarray(y * TILE_PX, (y + 1) * TILE_PX), dst);
    }
  }

  /** The height at a global pixel position, bilinear; NaN when a neighbouring pixel has none. */
  sample(px: number, py: number): number {
    const lx = clamp(px - this.tx0 * TILE_PX, 0, this.width - 1);
    const ly = clamp(py - this.ty0 * TILE_PX, 0, this.height - 1);
    const x0 = Math.floor(lx);
    const y0 = Math.floor(ly);
    const x1 = Math.min(x0 + 1, this.width - 1);
    const y1 = Math.min(y0 + 1, this.height - 1);
    const fx = lx - x0;
    const fy = ly - y0;
    const a = this.data[y0 * this.width + x0];
    const b = this.data[y0 * this.width + x1];
    const c = this.data[y1 * this.width + x0];
    const d = this.data[y1 * this.width + x1];
    const top = a + (b - a) * fx;
    const bottom = c + (d - c) * fx;
    return top + (bottom - top) * fy;
  }
}

/**
 * Heights at an nx × ny grid: `pixelAt(i, j)` gives the global pixel position of sample (i, j), and
 * the result is row-major (index j·nx + i).
 */
export function sampleGrid(
  mosaic: Mosaic,
  nx: number,
  ny: number,
  pixelAt: (i: number, j: number) => { px: number; py: number },
): Float32Array {
  const out = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const { px, py } = pixelAt(i, j);
      out[j * nx + i] = mosaic.sample(px, py);
    }
  }
  return out;
}

/** The lowest and highest finite values of a grid (0 and 0 when there are none). */
export function gridRange(grid: ArrayLike<number>): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

/** The height at a point in grid coordinates (cells), bilinear within the grid. */
export function gridHeightAt(grid: ArrayLike<number>, nx: number, ny: number, x: number, y: number): number {
  const i = clamp(Math.floor(x), 0, nx - 2);
  const j = clamp(Math.floor(y), 0, ny - 2);
  const fx = clamp(x - i, 0, 1);
  const fy = clamp(y - j, 0, 1);
  const a = grid[j * nx + i];
  const b = grid[j * nx + i + 1];
  const c = grid[(j + 1) * nx + i];
  const d = grid[(j + 1) * nx + i + 1];
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fy;
}

export interface Contour {
  /** the height of the line, metres */
  readonly level: number;
  /** every fifth contour (a multiple of five intervals): labelled */
  readonly major: boolean;
  /** vertices in grid coordinates (cells) */
  readonly points: Pt[];
  /** a loop: the first point is the last one's neighbour, not repeated */
  readonly closed: boolean;
}

/** Contour lines at every multiple of `interval` between the grid's lowest and highest heights. */
export function contours(grid: Float32Array, nx: number, ny: number, interval: number): Contour[] {
  const { min, max } = gridRange(grid);
  if (!(max > min) || !(interval > 0)) return [];
  const out: Contour[] = [];
  for (let k = Math.ceil(min / interval); k * interval <= max; k++) {
    const level = k * interval;
    for (const line of contourAt(grid, nx, ny, level)) {
      out.push({ level, major: k % 5 === 0, points: line.points, closed: line.closed });
    }
  }
  return out;
}

/** The contour lines at one height, as marching squares finds them. */
function contourAt(grid: Float32Array, nx: number, ny: number, level: number): { points: Pt[]; closed: boolean }[] {
  // an edge is named by the lower-left sample it starts at: horizontal edges (2k) and vertical (2k+1)
  const edgeKey = (i: number, j: number, vertical: boolean): number => (j * nx + i) * 2 + (vertical ? 1 : 0);
  const at = new Map<number, Pt>();
  const adj = new Map<number, number[]>();
  const segs: [number, number][] = [];

  // the crossing on an edge from sample a (value va, at xa, ya) to b (vb, xb, yb)
  const cross = (key: number, va: number, vb: number, xa: number, ya: number, xb: number, yb: number): number => {
    if (!at.has(key)) {
      const t = (level - va) / (vb - va);
      at.set(key, { x: xa + (xb - xa) * t, y: ya + (yb - ya) * t });
    }
    return key;
  };

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = grid[j * nx + i]; // lower left
      const b = grid[j * nx + i + 1]; // lower right
      const c = grid[(j + 1) * nx + i + 1]; // upper right
      const d = grid[(j + 1) * nx + i]; // upper left
      if (!(Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c) && Number.isFinite(d))) continue;
      const idx = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const bottom = () => cross(edgeKey(i, j, false), a, b, i, j, i + 1, j);
      const right = () => cross(edgeKey(i + 1, j, true), b, c, i + 1, j, i + 1, j + 1);
      const top = () => cross(edgeKey(i, j + 1, false), d, c, i, j + 1, i + 1, j + 1);
      const left = () => cross(edgeKey(i, j, true), a, d, i, j, i, j + 1);
      let pairs: [number, number][];
      switch (idx) {
        case 1:
        case 14:
          pairs = [[left(), bottom()]];
          break;
        case 2:
        case 13:
          pairs = [[bottom(), right()]];
          break;
        case 3:
        case 12:
          pairs = [[left(), right()]];
          break;
        case 4:
        case 11:
          pairs = [[right(), top()]];
          break;
        case 6:
        case 9:
          pairs = [[bottom(), top()]];
          break;
        case 7:
        case 8:
          pairs = [[left(), top()]];
          break;
        case 5:
        case 10: {
          // a saddle: the centre decides which corners the line keeps apart
          const centre = (a + b + c + d) / 4;
          const joinHigh = centre >= level;
          const pBR = [bottom(), right()] as [number, number];
          const pTL = [left(), top()] as [number, number];
          const pLB = [left(), bottom()] as [number, number];
          const pRT = [right(), top()] as [number, number];
          // case 5 has the high corners at BL and TR; case 10 has them at BR and TL
          const cutAround5 = joinHigh ? [pBR, pTL] : [pLB, pRT];
          const cutAround10 = joinHigh ? [pLB, pRT] : [pBR, pTL];
          pairs = idx === 5 ? cutAround5 : cutAround10;
          break;
        }
        default:
          pairs = [];
      }
      for (const [p, q] of pairs) {
        const s = segs.length;
        segs.push([p, q]);
        for (const k of [p, q]) {
          const list = adj.get(k);
          if (list) list.push(s);
          else adj.set(k, [s]);
        }
      }
    }
  }

  const used = new Uint8Array(segs.length);
  const nextUnused = (key: number): number => {
    for (const s of adj.get(key) ?? []) {
      if (!used[s]) {
        used[s] = 1;
        return s;
      }
    }
    return -1;
  };
  const out: { points: Pt[]; closed: boolean }[] = [];
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue;
    used[s0] = 1;
    const chain: number[] = [segs[s0][0], segs[s0][1]];
    let closed = false;
    // forward from the last key
    for (;;) {
      const s = nextUnused(chain[chain.length - 1]);
      if (s < 0) break;
      const [p, q] = segs[s];
      const last = chain[chain.length - 1];
      const other = p === last ? q : p;
      chain.push(other);
      if (other === chain[0]) {
        closed = true;
        break;
      }
    }
    if (closed) chain.pop();
    else {
      // backward from the first key
      for (;;) {
        const s = nextUnused(chain[0]);
        if (s < 0) break;
        const [p, q] = segs[s];
        const first = chain[0];
        chain.unshift(p === first ? q : p);
      }
    }
    const points = chain.map((k) => at.get(k) as Pt);
    out.push({ points, closed });
  }
  return out;
}

/**
 * A contour in grid coordinates with its redundant vertices removed: the staircase of the grid is
 * smoothed to `tol` cells.
 */
export function simplifyContour(points: readonly Pt[], closed: boolean, tol: number): Pt[] {
  const clean = dedupe(points);
  if (!closed) return simplify(clean, tol);
  // a loop: simplify it as two open halves between two of its vertices
  if (clean.length < 4) return clean;
  const half = Math.floor(clean.length / 2);
  const a = simplify(clean.slice(0, half + 1), tol);
  const b = simplify([...clean.slice(half), clean[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
