// Create Auto Hybrid's sums (autoHybrid.ts draws them): what Top/Plan shows of 3D objects, worked out
// from the triangles they show in 3D. A level cut plane goes through them: where it cuts they show the
// cut's outline, and the edges of what lies below it and above it (each as deep or high as asked) show
// as they're seen looking down, or up for a reflected ceiling plan, those out of sight split off to be
// dashed or left out. Plain data, lengths in mm, heights in the model.

import type { Pt } from "../core/index.ts";

type V3 = readonly [number, number, number];

/** How the plan's worked out. */
export interface HybridView {
  /** the cut plane's height */
  readonly cut: number;
  /** how far below the cut its extents go (Infinity for all of them), or null for none */
  readonly below: number | null;
  /** how far above the cut its extents go (Infinity for all of them), or null for none */
  readonly above: number | null;
  /** faces meeting within this many degrees show no edge between them */
  readonly smoothing: number;
  /** a reflected ceiling plan: everything looked at from below */
  readonly up: boolean;
}

/** One object's plan, its lines as runs of points. */
export interface HybridPlan {
  /** the cut's closed outlines, outer ones and the holes in them alike (they fill even-odd) */
  readonly rings: Pt[][];
  /** where the cut went through faces that don't close round */
  readonly open: Pt[][];
  readonly below: Pt[][];
  readonly belowHidden: Pt[][];
  readonly above: Pt[][];
  readonly aboveHidden: Pt[][];
}

/** heights this close to the cut count as on it, on the side below */
const ON = 1e-6;
const over = (z: number, h: number): boolean => z > h + ON;

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A flat x y z list as triangles, with each one's unit normal; those with no area left out. */
function triangles(flat: ArrayLike<number>): { t: V3[]; n: V3 }[] {
  const out: { t: V3[]; n: V3 }[] = [];
  for (let i = 0; i + 8 < flat.length; i += 9) {
    const t: V3[] = [
      [flat[i], flat[i + 1], flat[i + 2]],
      [flat[i + 3], flat[i + 4], flat[i + 5]],
      [flat[i + 6], flat[i + 7], flat[i + 8]],
    ];
    const c = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    const size = Math.hypot(...c);
    if (size > 1e-9) out.push({ t, n: [c[0] / size, c[1] / size, c[2] / size] });
  }
  return out;
}

/** Where p–q crosses height h, worked from the same end whichever way round it's given, so faces sharing a side agree to the last digit. */
function crossing(p: V3, q: V3, h: number): V3 {
  const [a, b] = p[0] < q[0] || (p[0] === q[0] && (p[1] < q[1] || (p[1] === q[1] && p[2] < q[2]))) ? [p, q] : [q, p];
  const t = (h - a[2]) / (b[2] - a[2]);
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), h];
}

/** A face kept on one side of height h (above it with `up`), each side flagged when the cut made it. */
function clip(pts: readonly V3[], made: readonly boolean[], h: number, up: boolean): { pts: V3[]; made: boolean[] } {
  const inside = (p: V3): boolean => over(p[2], h) === up;
  const out: V3[] = [];
  const flags: boolean[] = [];
  for (let i = 0; i < pts.length; i++) {
    const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
    if (inside(p)) {
      out.push(p);
      flags.push(made[i]);
      if (!inside(q)) {
        out.push(crossing(p, q, h));
        flags.push(true);
      }
    } else if (inside(q)) {
      out.push(crossing(p, q, h));
      flags.push(made[i]);
    }
  }
  return { pts: out, made: flags };
}

const keyOf = (p: Pt): string => `${Math.round(p.x * 1e3)},${Math.round(p.y * 1e3)}`;

/** Segments joined end to end where just two meet: closed runs (their first point not repeated) and open ones. */
export function joined(segs: readonly (readonly [Pt, Pt])[]): { closed: Pt[][]; open: Pt[][] } {
  const kept = segs.filter(([a, b]) => keyOf(a) !== keyOf(b));
  const ends = new Map<string, number[]>();
  kept.forEach(([a, b], i) => {
    for (const k of [keyOf(a), keyOf(b)]) {
      const list = ends.get(k);
      if (list) list.push(i);
      else ends.set(k, [i]);
    }
  });
  const used = new Uint8Array(kept.length);
  const step = (from: Pt): Pt | null => {
    const k = keyOf(from);
    const list = ends.get(k)!;
    if (list.length !== 2) return null;
    const i = list.find((j) => !used[j]);
    if (i === undefined) return null;
    used[i] = 1;
    const [a, b] = kept[i];
    return keyOf(a) === k ? b : a;
  };
  const closed: Pt[][] = [];
  const open: Pt[][] = [];
  for (let i = 0; i < kept.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const run: Pt[] = [kept[i][0], kept[i][1]];
    for (let p = step(run[run.length - 1]); p; p = step(run[run.length - 1])) run.push(p);
    if (run.length > 3 && keyOf(run[0]) === keyOf(run[run.length - 1])) {
      run.pop();
      closed.push(run);
      continue;
    }
    const back: Pt[] = [];
    for (let p = step(run[0]); p; p = step(back[back.length - 1])) back.push(p);
    open.push([...back.reverse(), ...run]);
  }
  return { closed, open };
}

/** Whether p is inside the closed rings, counted even-odd. */
function insideRings(p: Pt, rings: readonly (readonly Pt[])[]): boolean {
  let inside = false;
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [a, b] = [ring[i], ring[j]];
      if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
    }
  return inside;
}

/** Each ring's holes: rings inside an even number of others are outer, and each odd one is a hole in the smallest outer ring round it. */
export function nested(rings: readonly Pt[][]): { outer: Pt[]; holes: Pt[][] }[] {
  const area = (r: readonly Pt[]): number => Math.abs(r.reduce((sum, p, i) => sum + p.x * r[(i + 1) % r.length].y - r[(i + 1) % r.length].x * p.y, 0)) / 2;
  const within = rings.map((r, i) => rings.flatMap((o, j) => (j !== i && area(o) > area(r) && insideRings(r[0], [o]) ? [j] : [])));
  const out = new Map<number, { outer: Pt[]; holes: Pt[][] }>();
  rings.forEach((r, i) => {
    if (within[i].length % 2 === 0) out.set(i, { outer: r, holes: [] });
  });
  rings.forEach((r, i) => {
    if (within[i].length % 2 === 0) return;
    const parent = within[i].filter((j) => out.has(j)).sort((a, b) => area(rings[a]) - area(rings[b]))[0];
    if (parent !== undefined) out.get(parent)!.holes.push(r);
  });
  return [...out.values()];
}

/** One ring and its holes as a single outline that fills the same, each hole reached along a bridge from the nearest corner. */
export function keyhole(outer: readonly Pt[], holes: readonly (readonly Pt[])[]): Pt[] {
  let ring = [...outer];
  for (const hole of holes) {
    let [bi, bj, best] = [0, 0, Infinity];
    for (let i = 0; i < ring.length; i++)
      for (let j = 0; j < hole.length; j++) {
        const d = (ring[i].x - hole[j].x) ** 2 + (ring[i].y - hole[j].y) ** 2;
        if (d < best) [bi, bj, best] = [i, j, d];
      }
    const around = [...hole.slice(bj), ...hole.slice(0, bj), hole[bj]];
    ring = [...ring.slice(0, bi + 1), ...around, ...ring.slice(bi)];
  }
  return ring;
}

/** A triangle seen from above or below: its corners in plan, its sides' lines, and its height at a point. */
interface Cover {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly number[];
  readonly n: V3;
  readonly box: readonly [number, number, number, number];
}

/** Triangles binned by where they lie in plan, to find those over a point quickly. */
class Covers {
  private readonly cells: number[][];
  private readonly x0: number;
  private readonly y0: number;
  private readonly size: number;
  private readonly count: number;

  constructor(
    private readonly list: readonly Cover[],
    bounds: readonly [number, number, number, number],
  ) {
    this.count = Math.max(1, Math.min(256, Math.ceil(Math.sqrt(list.length / 4))));
    [this.x0, this.y0] = [bounds[0], bounds[1]];
    this.size = Math.max(bounds[2] - bounds[0], bounds[3] - bounds[1], 1e-6) / this.count;
    this.cells = Array.from({ length: this.count * this.count }, () => []);
    list.forEach((c, i) => {
      const [a0, b0] = [this.col(c.box[0]), this.row(c.box[1])];
      const [a1, b1] = [this.col(c.box[2]), this.row(c.box[3])];
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) this.cells[b * this.count + a].push(i);
    });
  }

  private col(x: number): number {
    return Math.max(0, Math.min(this.count - 1, Math.floor((x - this.x0) / this.size)));
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.count - 1, Math.floor((y - this.y0) / this.size)));
  }

  /**
   * Whether a triangle over (x, y), or with (x, y) on its edge within `margin`, is nearer the eye than z by
   * more than `dz`: an edge right under another is out of sight, while the faces an edge belongs to
   * are at its own height there and don't hide it.
   */
  hides(x: number, y: number, z: number, fromBelow: boolean, margin: number, dz: number): boolean {
    for (const i of this.cells[this.row(y) * this.count + this.col(x)]) {
      const c = this.list[i];
      if (x < c.box[0] - margin || x > c.box[2] + margin || y < c.box[1] - margin || y > c.box[3] + margin) continue;
      // whichever way round its corners go in plan
      const turn = Math.sign((c.x[1] - c.x[0]) * (c.y[2] - c.y[0]) - (c.y[1] - c.y[0]) * (c.x[2] - c.x[0]));
      let over = true;
      for (let k = 0; k < 3 && over; k++) {
        const [ax, ay, bx, by] = [c.x[k], c.y[k], c.x[(k + 1) % 3], c.y[(k + 1) % 3]];
        const len = Math.hypot(bx - ax, by - ay);
        over = len > 0 && (turn * ((bx - ax) * (y - ay) - (by - ay) * (x - ax))) / len >= -margin;
      }
      if (!over) continue;
      const at = c.z[0] - (c.n[0] * (x - c.x[0]) + c.n[1] * (y - c.y[0])) / c.n[2];
      if (fromBelow ? at < z - dz : at > z + dz) return true;
    }
    return false;
  }
}

/** Closed rings' sides binned by height in plan, to ask quickly whether a point is inside them (even-odd) or on a side. */
class Outline {
  private readonly bands: [Pt, Pt][][];
  private readonly size: number;

  constructor(
    rings: readonly (readonly Pt[])[],
    private readonly y0: number,
    y1: number,
  ) {
    const sides = rings.flatMap((r) => r.map((p, i): [Pt, Pt] => [p, r[(i + 1) % r.length]]));
    const count = Math.max(1, Math.min(1024, Math.ceil(sides.length / 4)));
    this.size = Math.max(y1 - y0, 1e-6) / count;
    this.bands = Array.from({ length: count }, () => []);
    for (const side of sides) {
      const [b0, b1] = [this.band(Math.min(side[0].y, side[1].y)), this.band(Math.max(side[0].y, side[1].y))];
      for (let b = b0; b <= b1; b++) this.bands[b].push(side);
    }
  }

  private band(y: number): number {
    return Math.max(0, Math.min(this.bands.length - 1, Math.floor((y - this.y0) / this.size)));
  }

  inside(x: number, y: number): boolean {
    let inside = false;
    for (const [a, b] of this.bands[this.band(y)]) if (a.y > y !== b.y > y && x < a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
    return inside;
  }

  near(x: number, y: number, margin: number): boolean {
    for (let b = this.band(y - margin); b <= this.band(y + margin); b++)
      for (const [a, c] of this.bands[b]) {
        const [dx, dy] = [c.x - a.x, c.y - a.y];
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(a.x + t * dx - x, a.y + t * dy - y) <= margin) return true;
      }
    return false;
  }
}

/** The edges a part shows from above: rims, folds sharper than the smoothing angle, and where its faces turn from facing up to facing down. */
function edgesOf(faces: readonly { pts: V3[]; made: boolean[]; n: V3 }[], smoothing: number): [V3, V3][] {
  const k3 = (p: V3): string => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
  const sides = new Map<string, { a: V3; b: V3; normals: V3[] }>();
  for (const f of faces)
    for (let i = 0; i < f.pts.length; i++) {
      if (f.made[i]) continue;
      const [a, b] = [f.pts[i], f.pts[(i + 1) % f.pts.length]];
      const [ka, kb] = [k3(a), k3(b)];
      if (ka === kb) continue;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const side = sides.get(key);
      if (side) side.normals.push(f.n);
      else sides.set(key, { a, b, normals: [f.n] });
    }
  const fold = Math.cos((Math.max(smoothing, 0.5) * Math.PI) / 180);
  const out: [V3, V3][] = [];
  for (const { a, b, normals } of sides.values()) {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-3) continue;
    if (normals.length === 2) {
      const [m, n] = normals;
      const sharp = m[0] * n[0] + m[1] * n[1] + m[2] * n[2] < fold;
      const turns = (m[2] > 1e-9 && n[2] < -1e-9) || (m[2] < -1e-9 && n[2] > 1e-9);
      if (!sharp && !turns) continue;
    }
    out.push([a, b]);
  }
  return out;
}

/**
 * The plan of each object, given its triangles (x y z for each corner): the cut's outlines, and the
 * edges below and above it, split into those seen and those hidden by the part they belong to
 * (and, looked at from the cut's side, by the cut itself).
 */
export function hybridPlan(objects: readonly ArrayLike<number>[], v: HybridView): HybridPlan[] {
  const tris = objects.map(triangles);
  let [x0, y0, x1, y1, z0, z1] = [Infinity, Infinity, -Infinity, -Infinity, Infinity, -Infinity];
  for (const list of tris)
    for (const { t } of list)
      for (const p of t) [x0, y0, x1, y1, z0, z1] = [Math.min(x0, p[0]), Math.min(y0, p[1]), Math.max(x1, p[0]), Math.max(y1, p[1]), Math.min(z0, p[2]), Math.max(z1, p[2])];
  const bounds: [number, number, number, number] = [x0, y0, x1, y1];
  const span = Math.hypot(x1 - x0, y1 - y0, z1 - z0) || 1;
  const margin = Math.max(1e-3, span * 1e-7);
  const dz = Math.max(1e-2, span * 1e-6);

  // the cut
  const cuts = tris.map((list) => {
    const segs: [Pt, Pt][] = [];
    for (const { t } of list) {
      const ups = t.map((p) => over(p[2], v.cut));
      if (ups.every(Boolean) || !ups.some(Boolean)) continue;
      const pts: Pt[] = [];
      for (let i = 0; i < 3; i++)
        if (ups[i] !== ups[(i + 1) % 3]) {
          const p = crossing(t[i], t[(i + 1) % 3], v.cut);
          pts.push({ x: p[0], y: p[1] });
        }
      segs.push([pts[0], pts[1]]);
    }
    return joined(segs);
  });
  const caps = cuts.flatMap((c) => c.closed);

  // each side's faces as the cut leaves them, as deep or high as asked
  const part = (high: boolean, reach: number | null): { pts: V3[]; made: boolean[]; n: V3 }[][] | null => {
    if (reach === null) return null;
    return tris.map((list) =>
      list.flatMap(({ t, n }) => {
        let f = clip(t, [false, false, false], v.cut, high);
        if (Number.isFinite(reach) && f.pts.length >= 3) f = clip(f.pts, f.made, high ? v.cut + reach : v.cut - reach, !high);
        return f.pts.length >= 3 ? [{ ...f, n }] : [];
      }),
    );
  };

  const shown = (faces: { pts: V3[]; made: boolean[]; n: V3 }[][] | null, high: boolean): { seen: Pt[][]; hidden: Pt[][] }[] => {
    if (!faces) return tris.map(() => ({ seen: [], hidden: [] }));
    const covers: Cover[] = [];
    for (const list of faces)
      for (const f of list) {
        if (Math.abs(f.n[2]) < 1e-6) continue;
        for (let i = 1; i + 1 < f.pts.length; i++) {
          const c = [f.pts[0], f.pts[i], f.pts[i + 1]];
          const [xs, ys] = [c.map((p) => p[0]), c.map((p) => p[1])];
          covers.push({ x: xs, y: ys, z: c.map((p) => p[2]), n: f.n, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] });
        }
      }
    const grid = new Covers(covers, bounds);
    // the cut's faces hide what's beyond them from the cut's side: below it looking down, above it looking up
    const capHides = high === v.up && caps.length > 0;
    const cap = new Outline(caps, bounds[1], bounds[3]);
    const nearCapEdge = (x: number, y: number): boolean => cap.near(x, y, margin);
    const hidden = (p: V3): boolean => {
      if (grid.hides(p[0], p[1], p[2], v.up, margin, dz)) return true;
      if (!capHides || (v.up ? p[2] <= v.cut + dz : p[2] >= v.cut - dz)) return false;
      return cap.inside(p[0], p[1]) || nearCapEdge(p[0], p[1]);
    };
    const step = span / 300;
    return faces.map((list) => {
      const seen: [Pt, Pt][] = [];
      const out: [Pt, Pt][] = [];
      // of edges right over each other in plan (a box's top over its bottom), the one nearer the eye stands for both
      const nearest = new Map<string, [V3, V3]>();
      for (const [a, b] of edgesOf(list, v.smoothing)) {
        const [ka, kb] = [keyOf({ x: a[0], y: a[1] }), keyOf({ x: b[0], y: b[1] })];
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
        const was = nearest.get(key);
        const nearer = !was || (a[2] + b[2] > was[0][2] + was[1][2]) !== v.up;
        if (nearer) nearest.set(key, [a, b]);
      }
      for (const [a, b] of nearest.values()) {
        const n = Math.max(1, Math.min(64, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)));
        const at = (t: number): V3 => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
        const flat = (t: number): Pt => ({ x: a[0] + t * (b[0] - a[0]), y: a[1] + t * (b[1] - a[1]) });
        let from = 0;
        let was = hidden(at(0.5 / n));
        for (let i = 1; i <= n; i++) {
          const now = i < n ? hidden(at((i + 0.5) / n)) : !was;
          if (now === was) continue;
          const piece: [Pt, Pt] = [flat(from / n), flat(i / n)];
          // hidden right under the cut's outline, which is drawn there
          const under = was && capHides && nearCapEdge((piece[0].x + piece[1].x) / 2, (piece[0].y + piece[1].y) / 2) && nearCapEdge(piece[0].x, piece[0].y) && nearCapEdge(piece[1].x, piece[1].y);
          if (!under) (was ? out : seen).push(piece);
          [from, was] = [i, now];
        }
      }
      // an edge right over another in plan (a box's top over its bottom) is drawn once, and only in sight if it's in sight at all
      const drawn = new Set<string>();
      const once = (segs: [Pt, Pt][]): [Pt, Pt][] =>
        segs.filter(([a, b]) => {
          const [ka, kb] = [keyOf(a), keyOf(b)];
          const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
          if (drawn.has(key)) return false;
          drawn.add(key);
          return true;
        });
      const runs = (segs: [Pt, Pt][]): Pt[][] => {
        const j = joined(segs);
        return [...j.open, ...j.closed.map((r) => [...r, r[0]])];
      };
      return { seen: runs(once(seen)), hidden: runs(once(out)) };
    });
  };

  const below = shown(part(false, v.below), false);
  const above = shown(part(true, v.above), true);
  return cuts.map((c, i) => ({ rings: c.closed, open: c.open, below: below[i].seen, belowHidden: below[i].hidden, above: above[i].seen, aboveHidden: above[i].hidden }));
}
