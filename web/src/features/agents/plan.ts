// Floor plans read from plain line work: the walls as centre lines with thicknesses, the doors,
// windows and plain openings in them, and the rooms the walls enclose.
//
// A wall is drawn as two parallel lines its thickness apart (three or four for a cavity wall), so
// walls are found as bands: the lines along one direction (a family) are swept along that
// direction, and at each place the lines side by side are grouped into bands no thicker than a
// wall, split where a gap between them is room rather than cavity. Pieces of band with one centre
// and thickness are joined along their line across junctions, and across gaps that a door swing,
// window lines or plain jambs show to be openings. The longest walls are taken first; what then
// overlaps them (furniture against a wall, the lines of a window, hatching, the jambs of an
// opening paired with each other) is left out, as are small pieces standing alone (furniture
// that happens to pair like a wall). Wall ends are extended or trimmed to where centre lines
// meet, the openings are where a wall's lines stop or change along it, and the rooms are the
// regions the centre lines enclose. Clutter that could pass for walls is taken out first:
// dimension lines (crossed by ticks), stair treads and hatching (runs of equal, evenly spaced
// lines), door leaves, and lines whose class names say what they are.

import type { Pt } from "../../core/types.ts";

export interface PlanInput {
  /** straight lines, and the straight sides of rectangles, polygons and polylines */
  segments: readonly { a: Pt; b: Pt; id: string; className: string }[];
  /** arcs and circles (sweep 360); angles in degrees, counter-clockwise from +x */
  arcs: readonly { center: Pt; radius: number; start: number; sweep: number; id: string; className: string }[];
  /** closed shapes drawn with a fill (solid, hatch or pattern): solid-filled walls ("poché") among them */
  fills: readonly { points: Pt[]; id: string; className: string }[];
  texts: readonly { at: Pt; text: string; id: string }[];
}

export interface PlanWall {
  a: Pt;
  b: Pt;
  thickness: number;
  /** the objects it was read from */
  ids: string[];
}

export interface PlanOpening {
  /** index into walls */
  wall: number;
  /** its middle, on the wall's centre line */
  at: Pt;
  width: number;
  type: "door" | "window" | "opening";
  /** doors: the hinge end (a point on the centre line at one jamb) and the side the leaf swings to, when a swing arc shows them */
  hinge?: Pt;
  /** left or right of the wall's direction from a to b */
  swing?: "left" | "right";
  ids: string[];
}

export interface PlanRoom {
  /** counter-clockwise, along the wall centre lines */
  outline: Pt[];
  /** square millimetres, to the wall centre lines */
  area: number;
  label?: string;
}

export interface PlanReading {
  walls: PlanWall[];
  openings: PlanOpening[];
  rooms: PlanRoom[];
  /** the plan's extent: the walls' outer faces, or all the line work when no walls were found */
  bounds: { x0: number; y0: number; x1: number; y1: number };
  /** what was assumed or left out, e.g. "214 short lines inside rooms taken as furniture and left out" */
  notes: string[];
}

export interface PlanOptions {
  /** the thinnest wall, mm (default 50) */
  minThickness?: number;
  /** the thickest wall, mm (default 700) */
  maxThickness?: number;
}

/** ends and offsets this near (mm) count as meeting: drawings are a few millimetres out */
const SNAP = 25;
/** parallel lines this near (mm) are one line drawn twice */
const SAME = 8;
/** lines within this many degrees of a direction run along it */
const FAMILY_DEG = 3;
/** in a band of parallel lines, a gap wider than this (mm) and twice the rest together is room between walls, not a cavity */
const CAVITY = 150;
/** gaps in a wall narrower than this (mm) are slop in the drawing, not openings */
const MIN_OPENING = 250;
/** a gap with nothing in it this wide or less (mm) is still read as an opening, when no other wall passes through it */
const PLAIN_OPENING = 2500;
/** the widest opening (mm) a door swing or window lines can vouch for */
const MAX_OPENING = 6000;
/** door swings' radii, mm */
const SWING_MIN = 300;
const SWING_MAX = 2200;
/** the smallest room, mm² */
const MIN_ROOM = 300_000;
const DEG = Math.PI / 180;
const PARALLEL = Math.sin(FAMILY_DEG * DEG);

const dot = (a: Pt, b: Pt): number => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt): number => a.x * b.y - a.y * b.x;
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const perp = (a: Pt): Pt => ({ x: -a.y, y: a.x });
const unit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const fine = (p: Pt | undefined | null): p is Pt => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const round = (n: number): number => Math.round(n * 10) / 10;
const rpt = (p: Pt): Pt => ({ x: round(p.x), y: round(p.y) });
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
/** a line's direction as degrees in [0, 180) */
const angle180 = (d: Pt): number => ((((Math.atan2(d.y, d.x) * 180) / Math.PI) % 180) + 180) % 180;
const apart = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
};

/** Where lines p + s·r and q + t·w cross: [s, t], or null when they are parallel. */
function crossAt(p: Pt, r: Pt, q: Pt, w: Pt): [number, number] | null {
  const d = cross(r, w);
  if (Math.abs(d) < 1e-12 * (Math.hypot(r.x, r.y) * Math.hypot(w.x, w.y) || 1)) return null;
  const qp = sub(q, p);
  return [cross(qp, w) / d, cross(qp, r) / d];
}

/** Whether segments ab and cd cross, each strictly inside the other. */
function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const hit = crossAt(a, sub(b, a), c, sub(d, c));
  return !!hit && hit[0] > 0 && hit[0] < 1 && hit[1] > 0 && hit[1] < 1;
}

/** The nearest point to p on segment ab. */
function nearestOn(p: Pt, a: Pt, b: Pt): Pt {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / l2)) : 0;
  return lerp(a, b, t);
}

function signedArea(pts: readonly Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) s += cross(pts[i], pts[(i + 1) % pts.length]);
  return s / 2;
}

function inside(p: Pt, poly: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

// ---- intervals along a line --------------------------------------------------------

type Span = [number, number];

function union(spans: Span[]): Span[] {
  const s = spans.filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
  const out: Span[] = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function intersect(p: Span[], q: Span[]): Span[] {
  const out: Span[] = [];
  let i = 0;
  let j = 0;
  while (i < p.length && j < q.length) {
    const a = Math.max(p[i][0], q[j][0]);
    const b = Math.min(p[i][1], q[j][1]);
    if (b > a) out.push([a, b]);
    if (p[i][1] < q[j][1]) i++;
    else j++;
  }
  return out;
}

/** p without q */
function subtract(p: Span[], q: Span[]): Span[] {
  let out = p.map((s): Span => [s[0], s[1]]);
  for (const [c, d] of q) {
    const next: Span[] = [];
    for (const [a, b] of out) {
      if (d <= a || c >= b) next.push([a, b]);
      else {
        if (c > a) next.push([a, c]);
        if (d < b) next.push([d, b]);
      }
    }
    out = next;
  }
  return out;
}

const measure = (s: readonly Span[]): number => s.reduce((n, [a, b]) => n + b - a, 0);
const covers = (s: readonly Span[], x: number): boolean => s.some(([a, b]) => a <= x && x <= b);

// ---- a grid index -----------------------------------------------------------------

/** A uniform grid over segments, for finding what lies near a place. */
class Grid {
  private readonly cells = new Map<number, number[]>();
  private seen: Int32Array;
  private mark = 0;
  constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly size: number,
    n: number,
  ) {
    this.seen = new Int32Array(Math.max(16, n));
  }
  private ci(x: number): number {
    return Math.max(-30000, Math.min(30000, Math.floor((x - this.x0) / this.size)));
  }
  private cj(y: number): number {
    return Math.max(-30000, Math.min(30000, Math.floor((y - this.y0) / this.size)));
  }
  private put(i: number, j: number, k: number): void {
    const key = (i + 32768) * 65536 + (j + 32768);
    const list = this.cells.get(key);
    if (list) {
      if (list[list.length - 1] !== k) list.push(k);
    } else this.cells.set(key, [k]);
  }
  /** item k along segment ab, widened by pad on every side */
  segment(k: number, a: Pt, b: Pt, pad: number): void {
    if (k >= this.seen.length) {
      const grown = new Int32Array(Math.max(k + 1, this.seen.length * 2));
      grown.set(this.seen);
      this.seen = grown;
    }
    const lx = Math.min(a.x, b.x);
    const hx = Math.max(a.x, b.x);
    for (let i = this.ci(lx - pad); i <= this.ci(hx + pad); i++) {
      // the part of the segment over this column of cells
      const cx0 = Math.max(this.x0 + i * this.size, lx - pad);
      const cx1 = Math.min(this.x0 + (i + 1) * this.size, hx + pad);
      let ya: number;
      let yb: number;
      if (hx - lx < 1e-9) {
        ya = a.y;
        yb = b.y;
      } else {
        const t0 = Math.max(0, Math.min(1, (cx0 - a.x) / (b.x - a.x)));
        const t1 = Math.max(0, Math.min(1, (cx1 - a.x) / (b.x - a.x)));
        ya = a.y + (b.y - a.y) * t0;
        yb = a.y + (b.y - a.y) * t1;
      }
      for (let j = this.cj(Math.min(ya, yb) - pad); j <= this.cj(Math.max(ya, yb) + pad); j++) this.put(i, j, k);
    }
  }
  /** items in cells touching the box */
  near(x0: number, y0: number, x1: number, y1: number): number[] {
    const out: number[] = [];
    if (++this.mark > 2e9) {
      this.mark = 1;
      this.seen.fill(0);
    }
    for (let i = this.ci(x0); i <= this.ci(x1); i++) {
      for (let j = this.cj(y0); j <= this.cj(y1); j++) {
        const list = this.cells.get((i + 32768) * 65536 + (j + 32768));
        if (!list) continue;
        for (const k of list) {
          if (this.seen[k] === this.mark) continue;
          this.seen[k] = this.mark;
          out.push(k);
        }
      }
    }
    return out;
  }
  around(p: Pt, r: number): number[] {
    return this.near(p.x - r, p.y - r, p.x + r, p.y + r);
  }
  along(a: Pt, b: Pt, r: number): number[] {
    return this.near(Math.min(a.x, b.x) - r, Math.min(a.y, b.y) - r, Math.max(a.x, b.x) + r, Math.max(a.y, b.y) + r);
  }
}

class UnionFind {
  private readonly parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n).map((_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    this.parent[ra] = rb;
    return true;
  }
}

// ---- the line work ------------------------------------------------------------------

/** what a class name says a line is */
type Hint = "" | "wall" | "door" | "window" | "dim" | "hatch" | "stair" | "grid" | "furniture";
/** what a line was taken as */
type Use = "" | "wall" | "opening" | "leaf" | "dim" | "stair" | "hatch" | "grid" | "furniture" | "inside";

interface Line {
  a: Pt;
  b: Pt;
  len: number;
  /** the input segments it was made from */
  src: number[];
  hint: Hint;
  /** the family of parallel lines it runs with, -1 for none */
  fam: number;
  /** along its family's direction (x0 <= x1, a at x0) and across it at each end */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  use: Use;
}

interface Family {
  /** along, and across (u turned anticlockwise) */
  u: Pt;
  n: Pt;
}

function hintOf(cls: string, fill: boolean): Hint {
  if (!cls) return "";
  // a filled shape's outline is a wall's outline, whatever its hatch
  if (/hatch|poch/i.test(cls) && !fill) return "hatch";
  if (/dim(?!m)/i.test(cls)) return "dim";
  if (/door/i.test(cls)) return "door";
  if (/window|glaz/i.test(cls)) return "window";
  if (/wall/i.test(cls)) return "wall";
  if (/stair|tread/i.test(cls)) return "stair";
  if (/grid/i.test(cls)) return "grid";
  if (/furn|fixture|fitting|equip|applian|sanitar|plumb|casework|joinery/i.test(cls)) return "furniture";
  return "";
}

/** across-position of a line at a place along its family */
const yAt = (l: Line, x: number): number => (l.x1 - l.x0 > 1e-9 ? l.y0 + ((l.y1 - l.y0) * (x - l.x0)) / (l.x1 - l.x0) : (l.y0 + l.y1) / 2);
const midY = (l: Line): number => (l.y0 + l.y1) / 2;

function setFrame(l: Line, f: Family): void {
  let xa = dot(l.a, f.u);
  let xb = dot(l.b, f.u);
  if (xb < xa) {
    [l.a, l.b] = [l.b, l.a];
    [xa, xb] = [xb, xa];
  }
  l.x0 = xa;
  l.x1 = xb;
  l.y0 = dot(l.a, f.n);
  l.y1 = dot(l.b, f.n);
}

/**
 * The directions most of the line work runs along, from a length-weighted histogram of angles:
 * each peak in turn, refined to the mean of the lines near it, takes the lines within a few
 * degrees of it.
 */
function findFamilies(lines: Line[]): Family[] {
  const BINS = 720;
  const hist = new Float64Array(BINS);
  const ang = lines.map((l) => angle180(sub(l.b, l.a)));
  const bin = (a: number): number => Math.min(BINS - 1, Math.floor(a * 4));
  let total = 0;
  lines.forEach((l, i) => {
    if (l.use) return;
    hist[bin(ang[i])] += l.len;
    total += l.len;
  });
  const fams: Family[] = [];
  const least = Math.max(400, total * 0.002);
  for (let round = 0; round < 24; round++) {
    let best = -1;
    let bestW = 0;
    for (let i = 0; i < BINS; i++) {
      let w = 0;
      for (let j = -4; j <= 4; j++) w += hist[(i + j + BINS) % BINS];
      if (w > bestW) {
        bestW = w;
        best = i;
      }
    }
    if (best < 0 || bestW < least) break;
    const peak = (best + 0.5) / 4;
    // the length-weighted mean of the free lines near it (doubled angles, as directions wrap at 180°)
    let sx = 0;
    let sy = 0;
    lines.forEach((l, i) => {
      if (l.use || l.fam >= 0 || apart(ang[i], peak) > 1.5) return;
      sx += l.len * Math.cos(ang[i] * 2 * DEG);
      sy += l.len * Math.sin(ang[i] * 2 * DEG);
    });
    const mean = (((Math.atan2(sy, sx) / DEG / 2) % 180) + 180) % 180;
    const f = fams.length;
    const u = { x: Math.cos(mean * DEG), y: Math.sin(mean * DEG) };
    fams.push({ u, n: perp(u) });
    let took = 0;
    lines.forEach((l, i) => {
      if (l.use || l.fam >= 0 || apart(ang[i], mean) > FAMILY_DEG) return;
      l.fam = f;
      hist[bin(ang[i])] -= l.len;
      took++;
    });
    if (!took) for (let j = -4; j <= 4; j++) hist[(best + j + BINS) % BINS] = 0;
  }
  for (const l of lines) if (l.fam >= 0) setFrame(l, fams[l.fam]);
  return fams;
}

/**
 * Pieces of one line joined into one: the same line drawn twice, pieces overlapping, and pieces
 * meeting end to end (or a few millimetres apart) where nothing else ends. Where another line ends
 * at the meeting point (a jamb across a wall), the pieces are different things that line up.
 */
function mergeCollinear(raw: Line[], fams: readonly Family[]): Line[] {
  const R = 12;
  const ends = new Map<number, number>();
  const key = (i: number, j: number): number => (i + 2 ** 25) * 2 ** 26 + (j + 2 ** 25);
  for (const l of raw) {
    for (const p of [l.a, l.b]) {
      const k = key(Math.floor(p.x / R), Math.floor(p.y / R));
      ends.set(k, (ends.get(k) ?? 0) + 1);
    }
  }
  const endsNear = (p: Pt): number => {
    const ci = Math.floor(p.x / R);
    const cj = Math.floor(p.y / R);
    let n = 0;
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) n += ends.get(key(ci + i, cj + j)) ?? 0;
    return n;
  };
  const out: Line[] = [];
  const groups = new Map<string, Line[]>();
  for (const l of raw) {
    if (l.fam < 0 || l.use) {
      out.push(l);
      continue;
    }
    // window and door lines stay apart from the rest
    const k = `${l.fam}:${l.hint === "door" || l.hint === "window" ? l.hint : ""}`;
    const list = groups.get(k);
    if (list) list.push(l);
    else groups.set(k, [l]);
  }
  for (const [k, list] of groups) {
    const f = fams[Number(k.split(":")[0])];
    list.sort((p, q) => midY(p) - midY(q));
    for (let i = 0; i < list.length; ) {
      let j = i + 1;
      while (j < list.length && midY(list[j]) - midY(list[j - 1]) <= SAME && midY(list[j]) - midY(list[i]) <= 1.5 * SAME) j++;
      const run = list.slice(i, j).sort((p, q) => p.x0 - q.x0);
      let cur: Line = { ...run[0], src: [...run[0].src] };
      for (const it of run.slice(1)) {
        const gap = it.x0 - cur.x1;
        const join = it.x1 <= cur.x1 + SNAP || gap < -SNAP || (gap <= 10 && endsNear(lerp(cur.b, it.a, 0.5)) <= 2);
        if (join) {
          if (it.x1 > cur.x1) {
            cur.b = it.b;
            cur.x1 = it.x1;
            cur.y1 = it.y1;
          }
          cur.src.push(...it.src);
          if (it.hint === "wall") cur.hint = "wall";
        } else {
          cur.len = dist(cur.a, cur.b);
          out.push(cur);
          cur = { ...it, src: [...it.src] };
        }
      }
      cur.len = dist(cur.a, cur.b);
      setFrame(cur, f);
      out.push(cur);
      i = j;
    }
  }
  return out;
}

// ---- clutter ------------------------------------------------------------------------

interface Door {
  arc: number;
  id: string;
  /** the hinge: the swing's centre */
  c: Pt;
  r: number;
  /** the swing's ends: one where the leaf closes, along the wall, and one where it stands open */
  ends: [Pt, Pt];
  /** which end the leaf was drawn at, -1 when that isn't clear */
  open: number;
  leaf: Line[];
  used: boolean;
}

/** Door swings (quarter arcs about a hinge) and the leaves drawn from their hinges. */
function findDoors(arcs: PlanInput["arcs"], lines: Line[], grid: Grid): Door[] {
  const out: Door[] = [];
  arcs.forEach((arc, k) => {
    const hint = hintOf(arc.className ?? "", false);
    if (hint && hint !== "door" && hint !== "wall" && hint !== "window") return;
    const sweep = Math.abs(arc.sweep);
    const r = arc.radius;
    if (r < SWING_MIN || r > SWING_MAX) return;
    if (hint === "door" ? sweep < 20 || sweep > 185 : sweep < 45 || sweep > 135) return;
    const start = (arc.sweep < 0 ? arc.start + arc.sweep : arc.start) * DEG;
    const c = arc.center;
    const ends: [Pt, Pt] = [add(c, { x: r * Math.cos(start), y: r * Math.sin(start) }), add(c, { x: r * Math.cos(start + sweep * DEG), y: r * Math.sin(start + sweep * DEG) })];
    const leaves: number[][] = [[], []];
    const weight = [0, 0];
    ends.forEach((e, j) => {
      const d = unit(sub(e, c));
      for (const i of grid.along(c, e, 100)) {
        const l = lines[i];
        if (l.use || l.len < 0.05 * r) continue;
        const within = (p: Pt): boolean => {
          const along = dot(sub(p, c), d);
          return along >= -40 && along <= r + 40 && Math.abs(cross(d, sub(p, c))) <= 80;
        };
        if (within(l.a) && within(l.b)) {
          leaves[j].push(i);
          weight[j] += l.len;
        }
      }
    });
    // a leaf drawn at one end only says which way it opens; lines at both are a leaf and a threshold
    const open = weight[0] > 0 && !weight[1] ? 0 : weight[1] > 0 && !weight[0] ? 1 : -1;
    const leaf = [...new Set([...leaves[0], ...leaves[1]])].filter((i) => open < 0 || leaves[open].includes(i)).map((i) => lines[i]);
    for (const l of leaf) l.use = "leaf";
    out.push({ arc: k, id: arc.id, c, r, ends, open, leaf, used: false });
  });
  return out;
}

/**
 * Dimension lines: long lines crossed through the middle by at least two short slanted ticks whose
 * own ends touch nothing (hatching across a wall ends on its faces), and with them their ticks and
 * the extension lines that end at them. Returns how many were found.
 */
function findDimensions(lines: Line[], grid: Grid): number {
  const dims: number[] = [];
  lines.forEach((l, i) => {
    if (l.use === "dim" && l.len >= 300) dims.push(i);
  });
  let found = 0;
  lines.forEach((D, i) => {
    if (D.use !== "" || D.hint === "wall" || D.len < 300) return;
    const r = sub(D.b, D.a);
    const ticks: number[] = [];
    for (const k of grid.along(D.a, D.b, 300)) {
      const S = lines[k];
      if (k === i || (S.use !== "" && S.use !== "dim") || S.len > Math.min(500, D.len * 0.5)) continue;
      const w = sub(S.b, S.a);
      const s = Math.abs(cross(unit(r), unit(w)));
      // architectural ticks are slashes at about 45°
      if (s < 0.42 || s > 0.91) continue;
      const hit = crossAt(D.a, r, S.a, w);
      if (!hit || hit[1] < 0.3 || hit[1] > 0.7 || hit[0] < -0.05 || hit[0] > 1.05) continue;
      const loose = (p: Pt): boolean =>
        grid.around(p, SNAP).every((j) => {
          if (j === k || j === i) return true;
          const o = lines[j];
          return dist(p, nearestOn(p, o.a, o.b)) > SNAP / 2;
        });
      if (!loose(S.a) || !loose(S.b)) continue;
      ticks.push(k);
    }
    if (ticks.length < 2) return;
    D.use = "dim";
    for (const k of ticks) lines[k].use = "dim";
    dims.push(i);
    found++;
  });
  for (const i of dims) {
    const D = lines[i];
    const r = sub(D.b, D.a);
    for (const k of grid.along(D.a, D.b, SNAP)) {
      const E = lines[k];
      if (E.use !== "" || E.hint === "wall" || E.len > 4000) continue;
      const w = sub(E.b, E.a);
      if (Math.abs(cross(unit(r), unit(w))) < 0.85) continue;
      const hit = crossAt(D.a, r, E.a, w);
      if (!hit) continue;
      const [td, te] = hit;
      if (td < -SNAP / D.len || td > 1 + SNAP / D.len) continue;
      // meeting the dimension line near one of its own ends, a little short or a little past
      const off = te < 0 ? -te * E.len : te > 1 ? (te - 1) * E.len : 0;
      const fromEnd = Math.min(Math.abs(te), Math.abs(1 - te)) * E.len;
      if (off > SNAP || fromEnd > Math.max(SNAP, 0.25 * E.len)) continue;
      E.use = "dim";
    }
  }
  return found;
}

/**
 * Runs of at least four equal parallel lines, evenly spaced and side by side: stair treads when
 * spaced and sized like treads, hatching otherwise.
 */
function findLadders(lines: Line[], fams: readonly Family[]): { treads: number; flights: number; hatch: number } {
  const byFam: number[][] = fams.map(() => []);
  lines.forEach((l, i) => {
    if (l.fam >= 0 && l.use === "" && l.hint !== "wall" && l.hint !== "door" && l.hint !== "window") byFam[l.fam].push(i);
  });
  let treads = 0;
  let flights = 0;
  let hatch = 0;
  for (const list of byFam) {
    list.sort((i, j) => midY(lines[i]) - midY(lines[j]));
    const y = list.map((i) => midY(lines[i]));
    const done = new Uint8Array(list.length);
    for (let s = 0; s < list.length; s++) {
      if (done[s]) continue;
      const first = lines[list[s]];
      const chain = [s];
      let spacing = 0;
      for (let cur = s; ; ) {
        let next = -1;
        const c = lines[list[cur]];
        for (let k = cur + 1; k < list.length && y[k] - y[cur] <= 450; k++) {
          const gap = y[k] - y[cur];
          if (done[k] || gap < 20) continue;
          if (spacing && gap > spacing + Math.max(15, 0.12 * spacing)) break;
          if (spacing && gap < spacing - Math.max(15, 0.12 * spacing)) continue;
          const l = lines[list[k]];
          if (Math.abs(l.len - first.len) > 0.15 * first.len) continue;
          // side by side: hatching at 45° across a wall overlaps its neighbour by little more than half
          if (Math.min(l.x1, c.x1) - Math.max(l.x0, c.x0) < 0.5 * Math.min(l.len, c.len)) continue;
          next = k;
          break;
        }
        if (next < 0) break;
        if (!spacing) spacing = y[next] - y[cur];
        chain.push(next);
        cur = next;
      }
      if (chain.length < 4) continue;
      const lens = chain.map((k) => lines[list[k]].len).sort((a, b) => a - b);
      const median = lens[lens.length >> 1];
      if (y[chain[chain.length - 1]] - y[chain[0]] < 0.6 * median) continue;
      const stair = spacing >= 150 && spacing <= 400 && median >= 500 && median <= 2500;
      for (const k of chain) {
        done[k] = 1;
        lines[list[k]].use = stair ? "stair" : "hatch";
      }
      if (stair) {
        treads += chain.length;
        flights++;
      } else hatch += chain.length;
    }
  }
  return { treads, flights, hatch };
}

// ---- bands ----------------------------------------------------------------------------

/** A stretch along a family's direction where the same lines lie side by side, as a wall would. */
interface Piece {
  f: number;
  x0: number;
  x1: number;
  /** across, at the start and at the end: the outer lines */
  lo0: number;
  hi0: number;
  lo1: number;
  hi1: number;
  lines: Set<number>;
}

/**
 * Sweeps one family's lines along its direction. Between each place where a line starts or ends,
 * the lines present are sorted across and grouped into bands: runs of lines no further apart
 * than a wall is thick, split at the widest gap while too thick, or where one gap is so much wider
 * than the rest that it is the room between two walls (unless a wall's fill says it is solid).
 */
function sweepBands(lines: readonly Line[], f: number, idx: readonly number[], minT: number, maxT: number, solid: (f: number, x: number, y: number) => boolean): Piece[] {
  const events: { x: number; k: number; add: boolean }[] = [];
  for (const k of idx) events.push({ x: lines[k].x0, k, add: true }, { x: lines[k].x1, k, add: false });
  events.sort((p, q) => p.x - q.x);
  const act: number[] = [];
  const out: Piece[] = [];
  let open: Piece[] = [];
  const tracks: { y: number; ks: number[] }[] = [];
  const stack: [number, number][] = [];
  for (let e = 0; e < events.length; ) {
    const x = events[e].x;
    for (; e < events.length && events[e].x === x; e++) {
      const { k, add: adding } = events[e];
      const y = midY(lines[k]);
      if (adding) {
        let lo = 0;
        let hi = act.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (midY(lines[act[m]]) < y) lo = m + 1;
          else hi = m;
        }
        act.splice(lo, 0, k);
      } else {
        const at = act.indexOf(k);
        if (at >= 0) act.splice(at, 1);
      }
    }
    if (e >= events.length) break;
    const xn = events[e].x;
    if (act.length < 2) {
      open = [];
      continue;
    }
    if (xn - x < 0.5) continue;
    const xm = (x + xn) / 2;
    const ys = act.map((k) => ({ k, y: yAt(lines[k], xm) }));
    // nearly in order already: lines of one family seldom cross
    for (let i = 1; i < ys.length; i++) {
      const v = ys[i];
      let j = i - 1;
      while (j >= 0 && ys[j].y > v.y) {
        ys[j + 1] = ys[j];
        j--;
      }
      ys[j + 1] = v;
    }
    tracks.length = 0;
    for (const { k, y } of ys) {
      const last = tracks[tracks.length - 1];
      if (last && y - last.y <= SAME) last.ks.push(k);
      else tracks.push({ y, ks: [k] });
    }
    const bands: { lo: number; hi: number; ks: number[] }[] = [];
    const viable = (i: number, j: number): boolean => j > i && tracks[j].y - tracks[i].y >= minT;
    for (let s = 0, m = 1; m <= tracks.length; m++) {
      if (m < tracks.length && tracks[m].y - tracks[m - 1].y <= maxT) continue;
      stack.push([s, m - 1]);
      s = m;
      while (stack.length) {
        const [i, j] = stack.pop()!;
        if (j <= i) continue;
        const total = tracks[j].y - tracks[i].y;
        if (total < minT) continue;
        let g = -1;
        for (let q = i; q < j; q++) g = Math.max(g, tracks[q + 1].y - tracks[q].y);
        // the widest gap, the one nearest the middle among equals, so even runs split evenly
        let k = i;
        let best = Infinity;
        for (let q = i; q < j; q++) {
          const d = tracks[q + 1].y - tracks[q].y;
          if (d >= g - 1 && Math.abs(q - (i + j - 1) / 2) < best) {
            best = Math.abs(q - (i + j - 1) / 2);
            k = q;
          }
        }
        const room = j - i >= 2 && g > CAVITY && g >= 2 * (total - g) && (viable(i, k) || viable(k + 1, j)) && !solid(f, xm, (tracks[k].y + tracks[k + 1].y) / 2);
        if (total > maxT || room) {
          stack.push([i, k], [k + 1, j]);
          continue;
        }
        const ks: number[] = [];
        for (let q = i; q <= j; q++) ks.push(...tracks[q].ks);
        bands.push({ lo: tracks[i].y, hi: tracks[j].y, ks });
      }
    }
    const next: Piece[] = [];
    for (const b of bands) {
      const p = open.find((q) => Math.abs(q.lo1 - b.lo) <= SAME && Math.abs(q.hi1 - b.hi) <= SAME);
      if (p) {
        p.x1 = xn;
        p.lo1 = b.lo;
        p.hi1 = b.hi;
        for (const k of b.ks) p.lines.add(k);
        next.push(p);
      } else {
        const q: Piece = { f, x0: x, x1: xn, lo0: b.lo, hi0: b.hi, lo1: b.lo, hi1: b.hi, lines: new Set(b.ks) };
        out.push(q);
        next.push(q);
      }
    }
    open = next;
  }
  return out.filter((p) => p.x1 - p.x0 >= 15);
}

/** Pieces of band along one line: their centre line (across = al + be·along) and mean thickness. */
interface Run {
  f: number;
  pieces: Piece[];
  x0: number;
  x1: number;
  al: number;
  be: number;
  t: number;
}

function fitRun(f: number, pieces: Piece[]): Run {
  let sw = 0;
  let sx = 0;
  let sc = 0;
  let st = 0;
  for (const p of pieces) {
    const w = Math.max(1, p.x1 - p.x0);
    sw += 2 * w;
    sx += w * (p.x0 + p.x1);
    sc += w * ((p.lo0 + p.hi0) / 2 + (p.lo1 + p.hi1) / 2);
    st += w * (p.hi0 - p.lo0 + (p.hi1 - p.lo1));
  }
  const mx = sx / sw;
  const mc = sc / sw;
  let sxx = 0;
  let sxc = 0;
  for (const p of pieces) {
    const w = Math.max(1, p.x1 - p.x0);
    for (const [x, c] of [
      [p.x0, (p.lo0 + p.hi0) / 2],
      [p.x1, (p.lo1 + p.hi1) / 2],
    ]) {
      sxx += w * (x - mx) ** 2;
      sxc += w * (x - mx) * (c - mc);
    }
  }
  const be = sxx > 1e-6 ? Math.max(-PARALLEL, Math.min(PARALLEL, sxc / sxx)) : 0;
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const p of pieces) {
    x0 = Math.min(x0, p.x0);
    x1 = Math.max(x1, p.x1);
  }
  return { f, pieces, x0, x1, al: mc - be * mx, be, t: st / sw };
}

interface Wall {
  f: number;
  a: Pt;
  b: Pt;
  /** its ends as found, before they were moved to junctions */
  a0: Pt;
  b0: Pt;
  t: number;
  /** some of its lines are in a class named for walls */
  hinted: boolean;
  /** why it was left out, "" when kept */
  gone: "" | "alone" | "stub";
}

interface Meet {
  i: number;
  j: number;
  at: Pt;
  /** where along each wall from its a */
  si: number;
  sj: number;
  /** sine of the angle between them */
  sin: number;
}

// ---- reading -------------------------------------------------------------------------

/** Reads walls, openings and rooms from a floor plan's line work. Never throws. */
export function readPlan(input: PlanInput, opts: PlanOptions = {}): PlanReading {
  try {
    return read(input, opts);
  } catch (e) {
    return { walls: [], openings: [], rooms: [], bounds: extentOf(input), notes: [`The plan couldn't be read: ${e instanceof Error ? e.message : String(e)}.`] };
  }
}

function extentOf(input: PlanInput): PlanReading["bounds"] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const take = (p: Pt | undefined | null, r = 0): void => {
    if (!fine(p) || !Number.isFinite(r)) return;
    x0 = Math.min(x0, p.x - r);
    y0 = Math.min(y0, p.y - r);
    x1 = Math.max(x1, p.x + r);
    y1 = Math.max(y1, p.y + r);
  };
  for (const s of input?.segments ?? []) {
    take(s?.a);
    take(s?.b);
  }
  for (const a of input?.arcs ?? []) take(a?.center, Math.abs(a?.radius ?? 0));
  for (const f of input?.fills ?? []) for (const p of f?.points ?? []) take(p);
  for (const t of input?.texts ?? []) take(t?.at);
  return x0 <= x1 ? { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) } : { x0: 0, y0: 0, x1: 0, y1: 0 };
}

function read(input: PlanInput, opts: PlanOptions): PlanReading {
  const minT = opts.minThickness !== undefined && opts.minThickness > 0 ? opts.minThickness : 50;
  const maxT = opts.maxThickness !== undefined && opts.maxThickness > minT ? opts.maxThickness : Math.max(700, 2 * minT);
  const notes: string[] = [];
  const box = extentOf(input);
  const nothing = (why: string): PlanReading => ({ walls: [], openings: [], rooms: [], bounds: box, notes: [why] });

  // ---- the input, with hints from class names --------------------------------------
  const segIds = new Set<string>();
  for (const s of input.segments ?? []) segIds.add(s.id);
  const fillIds = new Set<string>((input.fills ?? []).map((f) => f.id));
  const segs: { a: Pt; b: Pt; id: string; cls: string }[] = [];
  for (const s of input.segments ?? []) if (fine(s.a) && fine(s.b) && dist(s.a, s.b) > 0.5) segs.push({ a: s.a, b: s.b, id: s.id, cls: s.className ?? "" });
  // filled shapes not also given as lines bring their sides
  for (const f of input.fills ?? []) {
    if (segIds.has(f.id)) continue;
    const pts = (f.points ?? []).filter(fine);
    for (let i = 0; pts.length >= 3 && i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (dist(a, b) > 0.5) segs.push({ a, b, id: f.id, cls: f.className ?? "" });
    }
  }
  const arcs = (input.arcs ?? []).filter((a) => fine(a.center) && a.radius > 0 && Number.isFinite(a.radius) && Number.isFinite(a.start) && Number.isFinite(a.sweep));
  const texts = (input.texts ?? []).filter((t) => fine(t.at) && typeof t.text === "string" && t.text.trim());
  if (!segs.length) return nothing("There are no lines to read walls from.");

  const raw: Line[] = segs.map((s, i) => {
    const hint = hintOf(s.cls, fillIds.has(s.id));
    const use: Use = hint === "dim" || hint === "hatch" || hint === "stair" || hint === "grid" || hint === "furniture" ? hint : "";
    return { a: s.a, b: s.b, len: dist(s.a, s.b), src: [i], hint, fam: -1, x0: 0, x1: 0, y0: 0, y1: 0, use };
  });
  const extent = Math.max(box.x1 - box.x0, box.y1 - box.y0, 1);
  const cell = Math.max(250, extent / 300);
  const gridOf = (ls: readonly Line[]): Grid => {
    const g = new Grid(box.x0, box.y0, cell, ls.length);
    ls.forEach((l, k) => g.segment(k, l.a, l.b, 0));
    return g;
  };

  // door swings and their leaves come out before the lines are joined up
  const doors = findDoors(arcs, raw, gridOf(raw));
  const fams = findFamilies(raw);
  const lines = mergeCollinear(raw, fams);
  const grid = gridOf(lines);
  const ladders = findLadders(lines, fams);
  const dimLines = findDimensions(lines, grid);

  // fills shaped like walls (thin for their size) say the space between their lines is solid
  const solidFills = (input.fills ?? [])
    .map((f) => ({ pts: (f.points ?? []).filter(fine), hint: hintOf(f.className ?? "", true) }))
    .filter(({ pts, hint }) => {
      if (pts.length < 3 || hint === "furniture") return false;
      let perim = 0;
      for (let i = 0; i < pts.length; i++) perim += dist(pts[i], pts[(i + 1) % pts.length]);
      return hint === "wall" || Math.abs(signedArea(pts)) / Math.max(perim, 1) <= 0.3 * maxT;
    })
    .map(({ pts }) => pts);
  const fillGrid = new Grid(box.x0, box.y0, cell, solidFills.length);
  solidFills.forEach((pts, k) => pts.forEach((p, i) => fillGrid.segment(k, p, pts[(i + 1) % pts.length], 0)));
  const fillBoxes = solidFills.map((pts) => ({ x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) }));
  const solid = (f: number, x: number, y: number): boolean => {
    if (!solidFills.length) return false;
    const p = add(mul(fams[f].u, x), mul(fams[f].n, y));
    for (let k = 0; k < solidFills.length; k++) {
      const b = fillBoxes[k];
      if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && inside(p, solidFills[k])) return true;
    }
    return false;
  };

  // ---- bands of parallel lines --------------------------------------------------------
  const pieces: Piece[] = [];
  fams.forEach((_, f) => {
    const idx: number[] = [];
    lines.forEach((l, k) => {
      if (l.fam === f && l.use === "" && l.hint !== "door" && l.hint !== "window") idx.push(k);
    });
    pieces.push(...sweepBands(lines, f, idx, minT, maxT, solid));
  });
  if (!pieces.length) return nothing(`No parallel lines ${minT}–${maxT} mm apart were found, so no walls could be read from ${plural(segs.length, "line", "lines")}.`);

  const runAt = (r: Run, x: number): Pt => add(mul(fams[r.f].u, x), mul(fams[r.f].n, r.al + r.be * x));
  const doorGrid = new Grid(box.x0, box.y0, cell, doors.length);
  doors.forEach((d, k) => doorGrid.segment(k, d.c, d.c, 0));
  /** door swings hinged at either end of the stretch p..q of a wall t thick, about as wide as it (or half, one of a pair) */
  const swingsAt = (p: Pt, q: Pt, t: number): number[] => {
    const g = dist(p, q);
    const u = unit(sub(q, p));
    const out: number[] = [];
    for (const k of doorGrid.along(p, q, 150 + t)) {
      const d = doors[k];
      const along = dot(sub(d.c, p), u);
      if (Math.abs(cross(u, sub(d.c, p))) > t / 2 + 150) continue;
      if (Math.abs(along) > 150 && Math.abs(along - g) > 150) continue;
      const ratio = d.r / g;
      if ((ratio >= 0.7 && ratio <= 1.35) || (ratio >= 0.35 && ratio <= 0.65)) out.push(k);
    }
    return out;
  };
  /**
   * How much of the stretch p..q of a wall t thick has lines along it within the thickness that
   * start and end within it (window lines run jamb to jamb), 0..1. Lines running on past it are
   * the wall's own, and say nothing about an opening.
   */
  const linesAlong = (p: Pt, q: Pt, t: number): number => {
    const g = dist(p, q);
    if (g <= 0) return 0;
    const u = unit(sub(q, p));
    const spans: Span[] = [];
    for (const k of grid.along(p, q, t / 2 + SNAP)) {
      const l = lines[k];
      if (l.use !== "" && l.use !== "wall") continue;
      if (Math.abs(cross(unit(sub(l.b, l.a)), u)) > PARALLEL) continue;
      if (Math.abs(cross(u, sub(l.a, p))) > t / 2 + 10 || Math.abs(cross(u, sub(l.b, p))) > t / 2 + 10) continue;
      const sa = dot(sub(l.a, p), u);
      const sb = dot(sub(l.b, p), u);
      if (Math.min(sa, sb) < -SNAP || Math.max(sa, sb) > g + SNAP) continue;
      spans.push([Math.max(0, Math.min(sa, sb)), Math.min(g, Math.max(sa, sb))]);
    }
    return measure(union(spans)) / g;
  };

  // ---- runs: pieces with one centre and thickness, joined across junctions ----------
  const pc = pieces.map((p) => (p.lo0 + p.hi0 + p.lo1 + p.hi1) / 4);
  const pt = pieces.map((p) => (p.hi0 - p.lo0 + p.hi1 - p.lo1) / 2);
  const uf = new UnionFind(pieces.length);
  const byFam = new Map<number, number[]>();
  pieces.forEach((p, i) => {
    const list = byFam.get(p.f);
    if (list) list.push(i);
    else byFam.set(p.f, [i]);
  });
  for (const list of byFam.values()) {
    list.sort((i, j) => pc[i] - pc[j]);
    for (let k = 0; k < list.length; k++) {
      for (let m = k + 1; m < list.length && pc[list[m]] - pc[list[k]] <= 12; m++) if (Math.abs(pt[list[m]] - pt[list[k]]) <= 15) uf.union(list[k], list[m]);
    }
  }
  const groups = new Map<number, Piece[]>();
  pieces.forEach((p, i) => {
    const r = uf.find(i);
    const list = groups.get(r);
    if (list) list.push(p);
    else groups.set(r, [p]);
  });
  const runGroups: Run[][] = [];
  for (const g of groups.values()) {
    g.sort((p, q) => p.x0 - q.x0);
    const runs: Run[] = [];
    let cur = [g[0]];
    let end = g[0].x1;
    for (const p of g.slice(1)) {
      if (p.x0 - end <= maxT + SNAP) {
        cur.push(p);
        end = Math.max(end, p.x1);
      } else {
        runs.push(fitRun(g[0].f, cur));
        cur = [p];
        end = p.x1;
      }
    }
    runs.push(fitRun(g[0].f, cur));
    runGroups.push(runs);
  }
  // ...and across openings: a door swing at a jamb, window lines, or nothing at all but no other wall passing through
  const allRuns = runGroups.flat();
  const runGrid = new Grid(box.x0, box.y0, cell, allRuns.length);
  allRuns.forEach((r, k) => runGrid.segment(k, runAt(r, r.x0), runAt(r, r.x1), 0));
  const passedThrough = (p: Pt, q: Pt, f: number, grid: Grid, segOf: (k: number) => [Pt, Pt, number] | null): boolean => {
    const u = unit(sub(q, p));
    const pa = add(p, mul(u, SNAP));
    const qb = sub(q, mul(u, SNAP));
    if (dist(p, q) <= 2 * SNAP) return false;
    for (const k of grid.along(pa, qb, SNAP)) {
      const s = segOf(k);
      if (s && s[2] !== f && crosses(pa, qb, s[0], s[1])) return true;
    }
    return false;
  };
  // stretches where a wider band still has lines at both of a run's faces (a shelf or a sofa
  // against the wall, a radiator) are the wall running on, not a gap in it
  const famPieces = new Map<number, Map<number, number[]>>();
  const BUCKET = 1000;
  pieces.forEach((p, k) => {
    let m = famPieces.get(p.f);
    if (!m) famPieces.set(p.f, (m = new Map()));
    for (let b = Math.floor(p.x0 / BUCKET); b <= Math.floor(p.x1 / BUCKET); b++) {
      const list = m.get(b);
      if (list) list.push(k);
      else m.set(b, [k]);
    }
  });
  const runsOn = (r: Run, xa: number, xb: number): Span[] => {
    const m = famPieces.get(r.f);
    const spans: Span[] = [];
    if (!m) return spans;
    const seen = new Set<number>();
    for (let b = Math.floor(xa / BUCKET); b <= Math.floor(xb / BUCKET); b++) {
      for (const k of m.get(b) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const p = pieces[k];
        const lo = Math.max(xa, p.x0);
        const hi = Math.min(xb, p.x1);
        if (hi <= lo) continue;
        const xm = (lo + hi) / 2;
        const c = r.al + r.be * xm;
        const ys = [...p.lines].map((i) => yAt(lines[i], xm));
        if (ys.some((y) => Math.abs(y - (c - r.t / 2)) <= SAME + 2) && ys.some((y) => Math.abs(y - (c + r.t / 2)) <= SAME + 2)) spans.push([lo, hi]);
      }
    }
    return union(spans);
  };
  const runGap = (cur: Run, r: Run): boolean => {
    const t = (cur.t + r.t) / 2;
    const open = subtract([[cur.x1, r.x0]], runsOn(cur, cur.x1, r.x0));
    return open.every(([xa, xb]) => {
      const gap = xb - xa;
      if (gap <= maxT + SNAP) return true;
      if (gap > MAX_OPENING) return false;
      const p = runAt(cur, xa);
      const q = runAt(cur, xb);
      return swingsAt(p, q, t).length > 0 || linesAlong(p, q, t) >= 0.5 || (gap <= PLAIN_OPENING && !passedThrough(p, q, cur.f, runGrid, (k) => [runAt(allRuns[k], allRuns[k].x0), runAt(allRuns[k], allRuns[k].x1), allRuns[k].f]));
    });
  };
  const candidates: Run[] = [];
  for (const g of runGroups) {
    let cur = g[0];
    for (const r of g.slice(1)) {
      if (runGap(cur, r)) cur = fitRun(cur.f, [...cur.pieces, ...r.pieces]);
      else {
        candidates.push(cur);
        cur = r;
      }
    }
    candidates.push(cur);
  }

  // ---- walls: the most band first; what overlaps them is not a wall --------------------
  // (by the band they have rather than their span, which pieces joined across openings stretch)
  const solidLen = (r: Run): number => r.pieces.reduce((s, p) => s + p.x1 - p.x0, 0);
  candidates.sort((p, q) => solidLen(q) - solidLen(p));
  const inRect = (w: Wall, p: Pt, m: number): boolean => {
    const d = sub(w.b, w.a);
    const L = Math.hypot(d.x, d.y);
    const u = unit(d);
    const s = dot(sub(p, w.a), u);
    return s >= -m && s <= L + m && Math.abs(cross(u, sub(p, w.a))) <= w.t / 2 + m;
  };
  /**
   * Whether a wall overlaps those already taken: one the same way along (walls can't share their
   * thickness), or, unless only those are asked about, one of another direction it lies inside.
   */
  const overlaps = (c: Wall, taken: readonly Wall[], g: Grid, sameOnly: boolean): boolean => {
    const L = dist(c.a, c.b);
    const near = g.along(c.a, c.b, maxT);
    const { u, n } = fams[c.f];
    const ca = dot(c.a, u);
    const cb = dot(c.b, u);
    for (const k of near) {
      const w = taken[k];
      if (w.f !== c.f) continue;
      const wa = dot(w.a, u);
      const wb = dot(w.b, u);
      const lo = Math.max(Math.min(ca, cb), Math.min(wa, wb));
      const hi = Math.min(Math.max(ca, cb), Math.max(wa, wb));
      if (hi - lo < 0.5 * Math.min(L, Math.abs(wb - wa))) continue;
      const xm = (lo + hi) / 2;
      const cc = dot(lerp(c.a, c.b, (xm - ca) / (cb - ca || 1)), n);
      const wc = dot(lerp(w.a, w.b, (xm - wa) / (wb - wa || 1)), n);
      if (Math.min(cc + c.t / 2, wc + w.t / 2) - Math.max(cc - c.t / 2, wc - w.t / 2) > SAME) return true;
    }
    if (sameOnly) return false;
    let within = 0;
    for (let s = 1; s <= 7; s++) {
      const p = lerp(c.a, c.b, s / 8);
      if (near.some((k) => taken[k].f !== c.f && inRect(taken[k], p, SNAP))) within++;
    }
    return within >= 4;
  };
  const first: Wall[] = [];
  const firstGrid = new Grid(box.x0, box.y0, cell, candidates.length);
  let overlapping = 0;
  for (const c of candidates) {
    if (c.x1 - c.x0 < Math.max(30, 0.2 * c.t)) continue;
    let hinted = false;
    for (const p of c.pieces) for (const k of p.lines) if (lines[k].hint === "wall") hinted = true;
    const a = runAt(c, c.x0);
    const b = runAt(c, c.x1);
    const w: Wall = { f: c.f, a, b, a0: a, b0: b, t: c.t, hinted, gone: "" };
    if (overlaps(w, first, firstGrid, false)) {
      overlapping++;
      continue;
    }
    first.push(w);
    firstGrid.segment(first.length - 1, a, b, c.t / 2 + SNAP);
  }
  if (!first.length) return nothing(`No walls were found among ${plural(segs.length, "line", "lines")}: the parallel lines found don't run far enough to be walls.`);

  // ---- junctions: ends extended or trimmed to where centre lines meet -----------------
  const SIN_MIN = Math.sin(20 * DEG);
  /** moves the walls' ends to where they meet others; returns how many ran on through a door or window to meet one */
  const extendJunctions = (walls: Wall[]): number => {
    const allWalls = new Grid(box.x0, box.y0, cell, walls.length);
    walls.forEach((w, k) => allWalls.segment(k, w.a, w.b, w.t / 2 + SNAP));
    const moved: (Pt | null)[][] = walls.map(() => [null, null]);
    let through = 0;
    walls.forEach((w, i) => {
      const u = unit(sub(w.b, w.a));
      for (const end of [0, 1]) {
        const p = end ? w.b : w.a;
        const d = end ? u : mul(u, -1);
        let best: { at: Pt; e: number } | null = null;
        for (const j of allWalls.around(p, maxT + 2 * SNAP)) {
          if (j === i) continue;
          const o = walls[j];
          const v = unit(sub(o.b, o.a));
          const s = Math.abs(cross(u, v));
          if (s < SIN_MIN) continue;
          const hit = crossAt(p, d, o.a, v);
          if (!hit) continue;
          const e = hit[0];
          const half = o.t / 2 / s + SNAP;
          const reach = w.t / 2 / s + SNAP;
          if (e < -half || e > half || hit[1] < -reach || hit[1] > dist(o.a, o.b) + reach) continue;
          if (!best || Math.abs(e) < Math.abs(best.e)) best = { at: add(p, mul(d, e)), e };
        }
        if (!best) {
          // a door or window between this end and a wall across its way: the wall runs on through it
          const far = add(p, mul(d, MAX_OPENING + maxT));
          let reachBest: { at: Pt; f: number } | null = null;
          for (const j of allWalls.along(p, far, w.t)) {
            if (j === i) continue;
            const o = walls[j];
            const v = unit(sub(o.b, o.a));
            const s = Math.abs(cross(u, v));
            if (s < SIN_MIN) continue;
            const hit = crossAt(p, d, o.a, v);
            if (!hit) continue;
            const face = hit[0] - o.t / 2 / s;
            const reach = w.t / 2 / s + SNAP;
            if (face <= SNAP || face > MAX_OPENING || hit[1] < -reach || hit[1] > dist(o.a, o.b) + reach) continue;
            if (reachBest && face >= reachBest.f) continue;
            const F = add(p, mul(d, face));
            if (!swingsAt(p, F, w.t).length && linesAlong(p, F, w.t) < 0.5) continue;
            if (passedThrough(p, F, -1, allWalls, (k) => (k === i || k === j ? null : [walls[k].a, walls[k].b, walls[k].f]))) continue;
            reachBest = { at: add(p, mul(d, hit[0])), f: face };
          }
          if (reachBest) {
            best = { at: reachBest.at, e: 0 };
            through++;
          }
        }
        if (best) moved[i][end] = best.at;
      }
    });
    walls.forEach((w, i) => {
      if (moved[i][0]) w.a = moved[i][0]!;
      if (moved[i][1]) w.b = moved[i][1]!;
    });
    return through;
  };
  // once walls reach into their corners, pieces of band there (where only some of a cavity
  // wall's lines run) overlap them too
  extendJunctions(first);
  const walls: Wall[] = [];
  const wallGrid = new Grid(box.x0, box.y0, cell, first.length);
  for (const w of first) {
    if (overlaps(w, walls, wallGrid, true)) {
      overlapping++;
      continue;
    }
    walls.push(w);
    wallGrid.segment(walls.length - 1, w.a, w.b, w.t / 2 + SNAP);
  }
  for (const w of walls) {
    w.a = w.a0;
    w.b = w.b0;
  }
  const throughDoors = extendJunctions(walls);

  // where walls meet or cross
  const meetsOf = (live: (i: number) => boolean): Meet[] => {
    const g = new Grid(box.x0, box.y0, cell, walls.length);
    walls.forEach((w, k) => {
      if (live(k)) g.segment(k, w.a, w.b, SNAP);
    });
    const out: Meet[] = [];
    walls.forEach((w, i) => {
      if (!live(i)) return;
      const u = unit(sub(w.b, w.a));
      const Li = dist(w.a, w.b);
      for (const j of g.along(w.a, w.b, SNAP)) {
        if (j <= i || !live(j)) continue;
        const o = walls[j];
        const v = unit(sub(o.b, o.a));
        const s = Math.abs(cross(u, v));
        if (s < Math.sin(5 * DEG)) continue;
        const hit = crossAt(w.a, u, o.a, v);
        if (!hit) continue;
        const [si, sj] = hit;
        const tol = 2 * SNAP;
        if (si < -tol || si > Li + tol || sj < -tol || sj > dist(o.a, o.b) + tol) continue;
        out.push({ i, j, at: add(w.a, mul(u, si)), si: Math.max(0, Math.min(Li, si)), sj: Math.max(0, Math.min(dist(o.a, o.b), sj)), sin: s });
      }
    });
    return out;
  };
  let meets = meetsOf(() => true);

  // separate small pieces are furniture that happens to pair like a wall; short thick stubs
  // standing out from a wall with a free end are cupboards and worktops
  const comp = new UnionFind(walls.length);
  for (const m of meets) comp.union(m.i, m.j);
  const compLen = new Map<number, number>();
  const compHinted = new Set<number>();
  walls.forEach((w, i) => {
    const r = comp.find(i);
    compLen.set(r, (compLen.get(r) ?? 0) + dist(w.a, w.b));
    if (w.hinted) compHinted.add(r);
  });
  const largest = Math.max(...compLen.values());
  walls.forEach((w, i) => {
    const r = comp.find(i);
    if (!compHinted.has(r) && compLen.get(r)! < Math.max(3000, 0.1 * largest)) w.gone = "alone";
  });
  const endMet = (i: number, end: number, ms: readonly Meet[]): boolean => {
    const w = walls[i];
    const L = dist(w.a, w.b);
    return ms.some((m) => (m.i === i && Math.abs(m.si - (end ? L : 0)) <= w.t + SNAP) || (m.j === i && Math.abs(m.sj - (end ? L : 0)) <= w.t + SNAP));
  };
  walls.forEach((w, i) => {
    if (w.gone || w.hinted) return;
    const L = dist(w.a, w.b);
    if (w.t >= 300 && L < 1.5 * w.t && (!endMet(i, 0, meets) || !endMet(i, 1, meets))) w.gone = "stub";
  });
  meets = meets.filter((m) => !walls[m.i].gone && !walls[m.j].gone);
  const keptIdx = walls.map((_, i) => i).filter((i) => !walls[i].gone);
  if (!keptIdx.length) return nothing(`No walls were found among ${plural(segs.length, "line", "lines")}: the only parallel lines a wall's thickness apart are short pieces standing alone (furniture, fixtures).`);
  const outIndex = new Int32Array(walls.length).fill(-1);
  keptIdx.forEach((i, k) => (outIndex[i] = k));

  // ---- openings: where a wall's lines stop or change along it --------------------------
  const outWalls: PlanWall[] = [];
  const openings: PlanOpening[] = [];
  let cavity = 0;
  let doubles = 0;
  const idsOf = (ks: Iterable<number | Line>): Set<string> => {
    const out = new Set<string>();
    for (const k of ks) for (const s of (typeof k === "number" ? lines[k] : k).src) out.add(segs[s].id);
    return out;
  };
  for (const wi of keptIdx) {
    const w = walls[wi];
    const L = dist(w.a, w.b);
    const u = unit(sub(w.b, w.a));
    const n = perp(u);
    const h = w.t / 2;
    const tolB = Math.max(10, 0.1 * w.t);
    const band: { k: number; o: number; s0: number; s1: number; face: number; odd: boolean }[] = [];
    const across: number[] = [];
    for (const k of grid.along(w.a, w.b, h + SNAP)) {
      const l = lines[k];
      if (l.use !== "" && l.use !== "wall") continue;
      const oa = dot(sub(l.a, w.a), n);
      const ob = dot(sub(l.b, w.a), n);
      const sa = dot(sub(l.a, w.a), u);
      const sb = dot(sub(l.b, w.a), u);
      if (Math.abs(cross(unit(sub(l.b, l.a)), u)) <= PARALLEL) {
        if (Math.max(Math.abs(oa), Math.abs(ob)) > h + tolB) continue;
        const s0 = Math.max(0, Math.min(sa, sb));
        const s1 = Math.min(L, Math.max(sa, sb));
        if (s1 - s0 <= 0.5) continue;
        const o = (oa + ob) / 2;
        const odd = l.hint === "window" || l.hint === "door";
        band.push({ k, o, s0, s1, face: odd ? 0 : o <= -h + tolB ? -1 : o >= h - tolB ? 1 : 0, odd });
      } else if (Math.max(Math.abs(oa), Math.abs(ob)) <= h + SNAP && Math.min(sa, sb) >= -SNAP && Math.max(sa, sb) <= L + SNAP) {
        across.push(k);
      }
    }
    const f0 = union(band.filter((x) => x.face === -1).map((x): Span => [x.s0, x.s1]));
    const f1 = union(band.filter((x) => x.face === 1).map((x): Span => [x.s0, x.s1]));
    const both = intersect(f0, f1);
    const bothLen = measure(both);
    // lines between the faces: cavity and lining lines run with the faces, window lines don't
    const inner = band.filter((x) => x.face === 0 && !x.odd).sort((p, q) => p.o - q.o);
    const regular: Span[][] = [];
    const isRegular = new Set<number>();
    for (let i = 0; i < inner.length; ) {
      let j = i + 1;
      while (j < inner.length && inner[j].o - inner[j - 1].o <= SAME) j++;
      const track = inner.slice(i, j);
      const spans = union(track.map((x): Span => [x.s0, x.s1]));
      if (bothLen > 0 && measure(intersect(spans, both)) >= 0.6 * bothLen) {
        regular.push(spans);
        for (const x of track) isRegular.add(x.k);
      }
      i = j;
    }
    if (regular.length) cavity++;
    const odd = band.filter((x) => x.odd || (x.face === 0 && !isRegular.has(x.k)));
    const cuts = [...new Set([0, L, ...band.flatMap((x) => [x.s0, x.s1])])].filter((s) => s >= 0 && s <= L).sort((p, q) => p - q);
    const breaks: Span[] = [];
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [p, q] = [cuts[i], cuts[i + 1]];
      if (q - p < 0.5) continue;
      const m = (p + q) / 2;
      const whole = covers(f0, m) && covers(f1, m) && regular.every((s) => covers(s, m)) && !odd.some((x) => x.s0 < m && x.s1 > m);
      if (whole) continue;
      const last = breaks[breaks.length - 1];
      if (last && p - last[1] < 1) last[1] = q;
      else breaks.push([p, q]);
    }
    // where other walls meet it is not an opening
    const zones: Span[] = [];
    for (const m of meets) {
      if (m.i !== wi && m.j !== wi) continue;
      const s = m.i === wi ? m.si : m.sj;
      const o = walls[m.i === wi ? m.j : m.i];
      const half = o.t / 2 / m.sin;
      zones.push([s - half, s + half]);
    }
    // a run of window lines inside a wider break is the window, and the rest is read on its own;
    // a break open in two or more places with the whole wall between them is that many gaps
    const glazedAll = union(band.filter((x) => lines[x.k].hint === "window").map((x): Span => [x.s0, x.s1]));
    const gaps: Span[] = [];
    for (const [p, q] of subtract(breaks, union(zones))) {
      if (q - p < MIN_OPENING) continue;
      let parts: Span[] = [[p, q]];
      const glazed = intersect(glazedAll, [[p, q]]);
      if (glazed.length && measure(glazed) < 0.5 * (q - p)) {
        const runs: Span[] = [];
        for (const [c, d] of glazed) {
          const last = runs[runs.length - 1];
          if (last && c - last[1] <= 2 * SNAP) last[1] = d;
          else runs.push([c, d]);
        }
        // slivers beside a run, too narrow to be openings, are its frame
        for (const r of runs) {
          if (r[0] - p < MIN_OPENING) r[0] = p;
          if (q - r[1] < MIN_OPENING) r[1] = q;
        }
        parts = [...runs, ...subtract([[p, q]], runs)];
      }
      for (const [c, d] of parts) {
        if (d - c < MIN_OPENING) continue;
        const open = subtract([[c, d]], both).filter(([e, f]) => f - e >= MIN_OPENING);
        gaps.push(...(open.length >= 2 ? open : [[c, d] as Span]));
      }
    }
    const taken = new Set<number>();
    for (const [p, q] of gaps) {
      const width = q - p;
      const inGap = band.filter((x) => Math.min(x.s1, q) - Math.max(x.s0, p) > 0.5);
      const spanOf = (xs: typeof band): number => measure(union(xs.map((x): Span => [Math.max(p, x.s0), Math.min(q, x.s1)])));
      // the gap's own lines lie within it (or don't run with the wall's); a face line that runs
      // on past both jambs is the wall carrying on across it
      const own = inGap.filter((x) => (x.s0 >= p - SNAP && x.s1 <= q + SNAP) || x.odd || (x.face === 0 && !isRegular.has(x.k)));
      const cover = spanOf(own) / width;
      const glass = spanOf(inGap.filter((x) => x.odd)) / width;
      const faces = [-1, 1].filter((f) => spanOf(inGap.filter((x) => x.face === f && !own.includes(x))) >= 0.9 * width).length;
      // one face drawn across it and the other not: a recess, a change in the drawing or a
      // junction with something that isn't a wall, unless it is glazed (or hung, if both stop)
      const lopsided = faces > 0 || Math.abs(spanOf(inGap.filter((x) => x.face === -1)) - spanOf(inGap.filter((x) => x.face === 1))) >= 0.5 * width;
      if (faces > 0 && glass < 0.5) continue;
      const at = add(w.a, mul(u, (p + q) / 2));
      const op: PlanOpening = { wall: outIndex[wi], at: rpt(at), width: round(width), type: "opening", ids: [] };
      const ids = new Set<string>();
      // a door: a swing hinged at one jamb, as wide as the gap, or two hinged at both, half as wide
      let single: { k: number; end: number; miss: number } | null = null;
      const halves: { k: number; end: number }[] = [];
      for (const k of faces > 0 ? [] : doorGrid.along(add(w.a, mul(u, p)), add(w.a, mul(u, q)), h + 150)) {
        const d = doors[k];
        if (d.used) continue;
        const along = dot(sub(d.c, w.a), u);
        if (Math.abs(dot(sub(d.c, w.a), n)) > h + 150) continue;
        const end = Math.abs(along - p) <= 150 ? 0 : Math.abs(along - q) <= 150 ? 1 : -1;
        if (end < 0) continue;
        const ratio = d.r / width;
        if (ratio >= 0.75 && ratio <= 1.3) {
          if (!single || Math.abs(ratio - 1) < single.miss) single = { k, end, miss: Math.abs(ratio - 1) };
        } else if (ratio >= 0.38 && ratio <= 0.65) halves.push({ k, end });
      }
      const swingOf = (d: Door, hinge: Pt): "left" | "right" => {
        const tip = d.open >= 0 ? d.ends[d.open] : Math.abs(dot(sub(d.ends[0], w.a), n)) >= Math.abs(dot(sub(d.ends[1], w.a), n)) ? d.ends[0] : d.ends[1];
        return dot(sub(tip, hinge), n) >= 0 ? "left" : "right";
      };
      const pair = halves.find((x) => halves.some((y) => y.end !== x.end));
      if (single) {
        const d = doors[single.k];
        d.used = true;
        const hinge = add(w.a, mul(u, single.end ? q : p));
        op.type = "door";
        op.hinge = rpt(hinge);
        op.swing = swingOf(d, hinge);
        ids.add(d.id);
        for (const id of idsOf(d.leaf)) ids.add(id);
      } else if (pair) {
        const other = halves.find((y) => y.end !== pair.end)!;
        op.type = "door";
        for (const x of [pair, other]) {
          const d = doors[x.k];
          d.used = true;
          ids.add(d.id);
          for (const id of idsOf(d.leaf)) ids.add(id);
        }
        op.swing = swingOf(doors[pair.k], add(w.a, mul(u, pair.end ? q : p)));
        doubles++;
      }
      // its own lines along it, within the wall's thickness: a window (or a door's threshold)
      if (op.type === "opening" && (lopsided ? glass : cover) >= 0.5) op.type = "window";
      if (op.type === "opening" && lopsided) continue;
      for (const x of own) {
        taken.add(x.k);
        for (const id of idsOf([x.k])) ids.add(id);
      }
      op.ids = [...ids];
      openings.push(op);
    }
    // the lines it was read from; others across it are its jambs and ends, or hatching
    const used = new Set<number>();
    for (const x of band) {
      if (taken.has(x.k)) lines[x.k].use = "opening";
      else {
        lines[x.k].use = "wall";
        used.add(x.k);
      }
    }
    for (const k of across) {
      const l = lines[k];
      if (l.use !== "") continue;
      const s = Math.abs(cross(unit(sub(l.b, l.a)), u));
      if (s >= 0.9 && l.len >= 0.6 * w.t) {
        l.use = "wall";
        used.add(k);
      } else l.use = "inside";
    }
    outWalls.push({ a: rpt(w.a), b: rpt(w.b), thickness: round(w.t), ids: [...idsOf(used)] });
  }
  for (const d of doors) if (d.used) for (const l of d.leaf) l.use = "opening";

  // ---- rooms: the regions the centre lines enclose -------------------------------------
  const nodes: Pt[] = [];
  const nodeCells = new Map<string, number[]>();
  const nodeAt = (p: Pt): number => {
    const ci = Math.floor(p.x / SNAP);
    const cj = Math.floor(p.y / SNAP);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const k of nodeCells.get(`${ci + i},${cj + j}`) ?? []) if (dist(nodes[k], p) <= SNAP) return k;
    nodes.push(p);
    const key = `${ci},${cj}`;
    const list = nodeCells.get(key);
    if (list) list.push(nodes.length - 1);
    else nodeCells.set(key, [nodes.length - 1]);
    return nodes.length - 1;
  };
  const stops: { s: number; p: Pt }[][] = walls.map((w) => [
    { s: 0, p: w.a },
    { s: dist(w.a, w.b), p: w.b },
  ]);
  for (const m of meets) {
    stops[m.i].push({ s: m.si, p: m.at });
    stops[m.j].push({ s: m.sj, p: m.at });
  }
  // free ends near another wall (a jog, a junction drawn loosely) are linked to it
  const links: [Pt, Pt][] = [];
  const kept = new Grid(box.x0, box.y0, cell, walls.length);
  for (const i of keptIdx) kept.segment(i, walls[i].a, walls[i].b, walls[i].t / 2 + SNAP);
  for (const i of keptIdx) {
    const w = walls[i];
    for (const end of [0, 1]) {
      if (endMet(i, end, meets)) continue;
      const p = end ? w.b : w.a;
      let best: { j: number; q: Pt; d: number } | null = null;
      for (const j of kept.around(p, maxT)) {
        if (j === i) continue;
        const o = walls[j];
        const q = nearestOn(p, o.a, o.b);
        const d = dist(p, q);
        if (d <= (w.t + o.t) / 2 + SNAP && (!best || d < best.d)) best = { j, q, d };
      }
      if (!best) continue;
      stops[best.j].push({ s: dist(walls[best.j].a, best.q), p: best.q });
      links.push([p, best.q]);
    }
  }
  const edgeSet = new Map<string, number>();
  const addEdge = (a: number, b: number, wall: number): void => {
    if (a === b) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!edgeSet.has(key)) edgeSet.set(key, wall);
  };
  for (const i of keptIdx) {
    const list = stops[i].sort((p, q) => p.s - q.s).map((x) => nodeAt(x.p));
    for (let k = 0; k + 1 < list.length; k++) addEdge(list[k], list[k + 1], i);
  }
  for (const [p, q] of links) addEdge(nodeAt(p), nodeAt(q), -1);
  const adj: Map<number, number>[] = nodes.map(() => new Map());
  for (const [key, wall] of edgeSet) {
    const [a, b] = key.split(",").map(Number);
    adj[a].set(b, wall);
    adj[b].set(a, wall);
  }
  // spurs (walls ending inside a room) enclose nothing
  const queue = nodes.map((_, v) => v).filter((v) => adj[v].size === 1);
  while (queue.length) {
    const v = queue.pop()!;
    if (adj[v].size !== 1) continue;
    const [w] = adj[v].keys();
    adj[v].clear();
    adj[w].delete(v);
    if (adj[w].size === 1) queue.push(w);
  }
  const order = adj.map((m, v) => [...m.keys()].sort((p, q) => Math.atan2(nodes[p].y - nodes[v].y, nodes[p].x - nodes[v].x) - Math.atan2(nodes[q].y - nodes[v].y, nodes[q].x - nodes[v].x)));
  const seen = new Set<number>();
  const N = nodes.length;
  const faces: { loop: number[]; area: number }[] = [];
  for (let v = 0; v < N; v++) {
    for (const w0 of order[v]) {
      if (seen.has(v * N + w0)) continue;
      const loop: number[] = [];
      let a = v;
      let b = w0;
      for (let guard = 0; guard <= 2 * edgeSet.size + 2; guard++) {
        seen.add(a * N + b);
        loop.push(a);
        const list = order[b];
        const c = list[(list.indexOf(a) - 1 + list.length) % list.length];
        a = b;
        b = c;
        if (a === v && b === w0) break;
      }
      faces.push({ loop, area: signedArea(loop.map((k) => nodes[k])) });
    }
  }
  const rooms: PlanRoom[] = [];
  const labelUsed = new Set<number>();
  for (const f of faces.filter((x) => x.area >= MIN_ROOM).sort((p, q) => q.area - p.area)) {
    // corners only: points along a straight wall (junctions on the far side) are dropped
    let pts = f.loop.map((k) => nodes[k]);
    pts = pts.filter((p, i) => {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const next = pts[(i + 1) % pts.length];
      return Math.abs(cross(unit(sub(p, prev)), unit(sub(next, p)))) > 1e-3 || dot(sub(p, prev), sub(next, p)) < 0;
    });
    const room: PlanRoom = { outline: pts.map(rpt), area: Math.round(f.area) };
    let cx = 0;
    let cy = 0;
    for (const p of pts) {
      cx += p.x / pts.length;
      cy += p.y / pts.length;
    }
    let best = -1;
    let bestScore = -Infinity;
    texts.forEach((t, k) => {
      if (labelUsed.has(k) || !inside(t.at, pts)) return;
      const s = t.text.trim();
      // a name rather than a number or an area
      const score = (/[a-z]/i.test(s) ? 2 : 0) - (/^[\d\s.,]+(m²|m2|sq\.? ?(m|ft)|ft²|mm)?$/i.test(s) ? 1 : 0) - dist(t.at, { x: cx, y: cy }) / 1e6;
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    });
    if (best >= 0) {
      labelUsed.add(best);
      room.label = texts[best].text.trim().replace(/\s*[\r\n]+\s*/g, " ");
    }
    rooms.push(room);
  }

  // ---- what was left out ----------------------------------------------------------------
  const segUse: Use[] = new Array<Use>(segs.length).fill("");
  for (const l of lines) for (const s of l.src) segUse[s] = l.use;
  let furniture = 0;
  let outside = 0;
  const furnitureIds = new Set<string>();
  const roomPolys = rooms.map((r) => r.outline);
  segs.forEach((s, i) => {
    if (segUse[i] === "furniture") {
      furniture++;
      furnitureIds.add(s.id);
      return;
    }
    if (segUse[i] !== "") return;
    const m = lerp(s.a, s.b, 0.5);
    if (roomPolys.some((poly) => inside(m, poly))) {
      furniture++;
      furnitureIds.add(s.id);
    } else outside++;
  });
  const count = (u: Use): number => segUse.filter((x) => x === u).length;

  const kw = keptIdx.map((i) => walls[i]);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of kw) {
    for (const p of [w.a, w.b]) {
      x0 = Math.min(x0, p.x - w.t / 2);
      y0 = Math.min(y0, p.y - w.t / 2);
      x1 = Math.max(x1, p.x + w.t / 2);
      y1 = Math.max(y1, p.y + w.t / 2);
    }
  }
  const total = kw.reduce((s, w) => s + dist(w.a, w.b), 0);
  const ts = kw.map((w) => Math.round(w.t));
  const kinds = (t: PlanOpening["type"]): number => openings.filter((o) => o.type === t).length;
  notes.push(
    `Read ${plural(kw.length, "wall", "walls")} (${(total / 1000).toFixed(1)} m of centre line, ${Math.min(...ts) === Math.max(...ts) ? `${ts[0]} mm` : `${Math.min(...ts)}–${Math.max(...ts)} mm`} thick), ${plural(kinds("door"), "door", "doors")}, ${plural(kinds("window"), "window", "windows")}, ${plural(kinds("opening"), "plain opening", "plain openings")} and ${plural(rooms.length, "room", "rooms")}.`,
  );
  const outer = faces.filter((f) => f.area < 0).sort((p, q) => p.area - q.area)[0];
  if (rooms.length && outer) {
    const around = new Set<number>();
    for (let k = 0; k < outer.loop.length; k++) {
      const a = outer.loop[k];
      const b = outer.loop[(k + 1) % outer.loop.length];
      const wall = adj[a].get(b);
      if (wall !== undefined && wall >= 0) around.add(outIndex[wall]);
    }
    notes.push(`The external walls form a closed loop (${plural(around.size, "wall", "walls")}, ${(-outer.area / 1e6).toFixed(1)} m² to their centre lines).`);
  } else {
    const free = keptIdx.reduce((s, i) => s + (endMet(i, 0, meets) ? 0 : 1) + (endMet(i, 1, meets) ? 0 : 1), 0);
    notes.push(`The walls don't close into a loop, so no rooms were found (${plural(free, "wall end is", "wall ends are")} free).`);
  }
  if (rooms.length) notes.push("Room areas are measured to the wall centre lines.");
  if (cavity) notes.push(`${plural(cavity, "wall is", "walls are")} drawn with three or more lines (cavity walls, linings) and read as one wall to its outer lines.`);
  if (throughDoors) notes.push(`${plural(throughDoors, "wall end was", "wall ends were")} extended through a door or window to the wall across it.`);
  if (doubles) notes.push(`${plural(doubles, "door is a pair", "doors are pairs")} of leaves, so no single hinge is given.`);
  const unusedSwings = doors.filter((d) => !d.used).length;
  if (unusedSwings) notes.push(`${plural(unusedSwings, "door swing has", "door swings have")} no gap in a wall to sit in and ${unusedSwings === 1 ? "was" : "were"} left out.`);
  const dims = count("dim");
  if (dims) notes.push(`${plural(dims, "dimension line, tick or extension line was", "dimension lines, ticks and extension lines were")} left out${dimLines ? ` (${plural(dimLines, "dimension line", "dimension lines")} found by their ticks)` : ""}.`);
  if (ladders.treads || count("stair")) notes.push(`${plural(count("stair"), "stair line was", "stair lines were")} left out${ladders.flights ? ` (${plural(ladders.treads, "tread", "treads")} in ${plural(ladders.flights, "flight", "flights")})` : ""}: stairs aren't walls and aren't modelled here.`);
  const hatching = count("hatch") + count("inside");
  if (hatching) notes.push(`${plural(hatching, "hatch line", "hatch lines")} (inside walls, or evenly spaced runs) left out.`);
  if (count("grid")) notes.push(`${plural(count("grid"), "grid line", "grid lines")} left out.`);
  if (furniture) notes.push(`${plural(furniture, "line", "lines")} inside rooms or classed as furniture (${plural(furnitureIds.size, "object", "objects")}) taken as furniture and fixtures and left out.`);
  const alone = walls.filter((w) => w.gone === "alone").length;
  const stubs = walls.filter((w) => w.gone === "stub").length;
  if (alone) notes.push(`${plural(alone, "short pair", "short pairs")} of parallel lines standing apart from the walls (furniture, fixtures) left out.`);
  if (stubs) notes.push(`${plural(stubs, "short thick stub", "short thick stubs")} standing out from walls (cupboards, worktops) left out.`);
  if (overlapping) notes.push(`${plural(overlapping, "pairing", "pairings")} of lines inside or alongside walls (window lines, jambs, things against walls) not taken as walls.`);
  if (outside) notes.push(`${plural(outside, "line", "lines")} outside the rooms left out.`);
  const loose = arcs.length - doors.filter((d) => d.used).length;
  if (loose) notes.push(`${plural(loose, "arc or circle", "arcs and circles")} not read as door swings left out.`);

  return {
    walls: outWalls,
    openings,
    rooms,
    bounds: x0 <= x1 ? { x0: round(x0), y0: round(y0), x1: round(x1), y1: round(y1) } : box,
    notes,
  };
}

// ---- walls for building ------------------------------------------------------------------

/** A run of walls as the build tool's walls element takes it. */
export interface PlanWallPath {
  /** centre line; for a closed run the last corner joins the first */
  path: Pt[];
  closed: boolean;
  thickness: number;
  /** the walls it was made from, indices into the reading's walls, in order along the path */
  walls: number[];
  openings: { type: PlanOpening["type"]; point: Pt; width: number }[];
}

/**
 * The walls chained into runs: two walls of about the same thickness whose ends meet, and nothing
 * else meets there, join at a corner (so it is mitred), and a run that comes back round is
 * closed. A wall ending on another's side (a T) stays a run of its own. Openings go with their
 * wall's run, placed by their middle.
 */
export function wallPaths(r: PlanReading): PlanWallPath[] {
  // the walls' ends gathered into places where they meet
  const nodes: { at: Pt; ends: { wall: number; end: 0 | 1 }[] }[] = [];
  const nodeOf: [number, number][] = r.walls.map(() => [-1, -1]);
  r.walls.forEach((w, i) =>
    ([w.a, w.b] as const).forEach((p, end) => {
      let k = nodes.findIndex((n) => dist(n.at, p) <= SNAP);
      if (k < 0) k = nodes.push({ at: p, ends: [] }) - 1;
      nodes[k].ends.push({ wall: i, end: end as 0 | 1 });
      nodeOf[i][end] = k;
    }),
  );
  for (const n of nodes) {
    n.at = {
      x: n.ends.reduce((s, e) => s + (e.end ? r.walls[e.wall].b.x : r.walls[e.wall].a.x), 0) / n.ends.length,
      y: n.ends.reduce((s, e) => s + (e.end ? r.walls[e.wall].b.y : r.walls[e.wall].a.y), 0) / n.ends.length,
    };
  }
  /** the wall a run carries on into at node k, coming from wall i */
  const onward = (k: number, i: number): number => {
    const ends = nodes[k].ends;
    if (ends.length !== 2) return -1;
    const j = ends[0].wall === i ? ends[1].wall : ends[0].wall;
    return j !== i && Math.abs(r.walls[i].thickness - r.walls[j].thickness) <= 10 ? j : -1;
  };
  const used = new Set<number>();
  const runs: PlanWallPath[] = [];
  /** walks from wall i out of its end `from`, collecting walls and the nodes passed */
  const walk = (start: number, fromEnd: 0 | 1): { walls: number[]; nodes: number[]; closed: boolean } => {
    const walls = [start];
    const at = [nodeOf[start][fromEnd]];
    used.add(start);
    let i = start;
    let k = nodeOf[start][fromEnd ? 0 : 1];
    for (;;) {
      at.push(k);
      const j = onward(k, i);
      if (j < 0) return { walls, nodes: at, closed: false };
      if (j === start) return { walls, nodes: at.slice(0, -1), closed: true };
      if (used.has(j)) return { walls, nodes: at, closed: false };
      used.add(j);
      walls.push(j);
      k = nodeOf[j][0] === k ? nodeOf[j][1] : nodeOf[j][0];
      i = j;
    }
  };
  const take = (w: { walls: number[]; nodes: number[]; closed: boolean }): void => {
    // corners where the run goes straight on are dropped: they aren't corners
    let pts = w.nodes.map((k) => nodes[k].at);
    for (let changed = true; changed && pts.length > (w.closed ? 3 : 2); ) {
      changed = false;
      const n = pts.length;
      for (let i = w.closed ? 0 : 1; i < (w.closed ? n : n - 1); i++) {
        const p = pts[(i + n - 1) % n];
        const q = pts[i];
        const s = pts[(i + 1) % n];
        const u = { x: q.x - p.x, y: q.y - p.y };
        const v = { x: s.x - q.x, y: s.y - q.y };
        const cross = u.x * v.y - u.y * v.x;
        const dot = u.x * v.x + u.y * v.y;
        if (dot > 0 && Math.abs(cross) <= 1e-3 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y)) {
          pts = pts.filter((_, j) => j !== i);
          changed = true;
          break;
        }
      }
    }
    const set = new Set(w.walls);
    runs.push({
      path: pts.map((p) => ({ x: round(p.x), y: round(p.y) })),
      closed: w.closed,
      thickness: round(w.walls.reduce((s, i) => s + r.walls[i].thickness, 0) / w.walls.length),
      walls: w.walls,
      openings: r.openings.filter((o) => set.has(o.wall)).map((o) => ({ type: o.type, point: { x: round(o.at.x), y: round(o.at.y) }, width: round(o.width) })),
    });
  };
  // open runs from their loose ends first, then what is left goes round in loops
  r.walls.forEach((_, i) => {
    if (used.has(i)) return;
    for (const end of [0, 1] as const) {
      if (onward(nodeOf[i][end], i) < 0) {
        take(walk(i, end));
        return;
      }
    }
  });
  r.walls.forEach((_, i) => {
    if (!used.has(i)) take(walk(i, 0));
  });
  return runs;
}
