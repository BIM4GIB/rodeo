// Cursor snapping. Object snaps come from the drawn layers and are ranked:
// end and intersection, then centre, midpoint, and nearest point on an edge.
// The grid is the fallback when no object snap is within the snap radius. The
// Snapping palette turns each kind of object snap on or off (store.snapKinds)
// and sets the radius and the grid spacing (store.snapSettings).
//
// Smart points, as Vectorworks has them: a point snap the cursor rests on for a
// moment is acquired (the last few are kept), and away from objects the cursor
// then lines up with them, horizontally, vertically or both, along dashed guides.
// An acquired end of a slanted straight edge also offers that edge's extension.
// The datum (store.datum, G over the drawing) lines the cursor up the same way, and with
// Use datum offset the points that far from it along its extensions snap ("datum").
//
// While a tool draws from a point (a line's start, a polyline's last vertex),
// the snaps also offer the points where a line from it would touch a circle or
// arc (tangent) or meet a straight edge square (perpendicular).
//
// Point candidates and edges are kept in uniform grids, brought up to date lazily
// after each change: a layer whose objects are the same keeps its points and
// edges, and one an edit changed swaps out those of the objects that changed.
// Intersections and nearest points are computed on the fly
// from the edges near the cursor, so they cost nothing elsewhere. Arcs are
// approximated by chords sized to the current zoom (a fraction of a pixel).

import type { Affine, ObjectInfo, Pt, Shape } from "../core/index.ts";
import { mapShape } from "../core/model.ts";
import { prefs } from "./prefs.ts";
import { store } from "./state.ts";
import { hiddenVersion } from "./hiddenObjects.ts";
import { listChange, type Scene } from "./scene.ts";
import type { View } from "./view.ts";
import { clamp, degToRad, distToSegment, niceStep } from "./geom.ts";
import { arcRadii, isClosedShape, isFullArc } from "./shapes.ts";

/** What the cursor snapped to. "grid" is the fallback when no object snap is in range. */
export type SnapKind =
  | "end"
  | "mid"
  | "center"
  | "intersection"
  | "tangent"
  | "perpendicular"
  | "nearest"
  | "align"
  | "extension"
  | "datum"
  | "grid";

type ObjectKind = Exclude<SnapKind, "grid" | "align" | "extension" | "datum">;

/** When several object snaps are within the snap radius the highest rank wins, then the nearest. */
const RANK: Record<ObjectKind, number> = {
  end: 6,
  intersection: 6,
  center: 5,
  tangent: 5,
  perpendicular: 5,
  mid: 4,
  nearest: 3,
};

export interface SnapResult {
  readonly pos: Pt;
  readonly kind: SnapKind | null;
  /** for "align" and "extension": the acquired points the cursor lines up with */
  readonly guides?: readonly Pt[];
}

/** The snaps that can be acquired as smart points: those that stay put whatever the tool draws from. */
const ACQUIRABLE: ReadonlySet<SnapKind> = new Set<SnapKind>(["end", "mid", "center", "intersection"]);
/** Smart points kept; acquiring another drops the oldest. */
const MAX_ACQUIRED = 4;

/** Most edges considered for intersections and nearest points in one query. */
const MAX_NEAR_EDGES = 200;
/** Arcs are approximated by chords no further than this many CSS px from the arc. */
const ARC_TOL_PX = 0.25;
const MIN_ARC_CHORDS = 4;
const MAX_ARC_CHORDS = 512;
/** A crossing this close (CSS px) to a segment end is left to the end snap. */
const END_PX = 0.25;
/** Queries covering more cells than this scan every item. */
const MAX_QUERY_CELLS = 4096;
/** Items spanning more cells than this are kept apart and checked by every query. */
const MAX_CELLS_PER_ITEM = 64;

/** Axis-aligned box, plus the query stamp that lets one query report each item once. */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  seen: number;
  /** where it is in its grid's list of every item */
  slot: number;
}

/** A vertex, edge midpoint or centre that can be snapped to. */
interface PointCand extends Box {
  readonly x: number;
  readonly y: number;
  readonly kind: "end" | "mid" | "center";
  /** id of the drawable object, so a moving selection can exclude its own points */
  readonly owner: string;
}

/** A straight piece of geometry. */
interface Seg {
  readonly ax: number;
  readonly ay: number;
  readonly bx: number;
  readonly by: number;
  readonly owner: string;
}

/** An arc or full circle; chords are made from it only when a query needs them. */
interface ArcSpan {
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  /** start angle and signed sweep, in radians */
  readonly a0: number;
  readonly sweep: number;
}

/** Grid entry: a straight segment (arc null) or an arc. */
interface Edge extends Box, Seg {
  readonly arc: ArcSpan | null;
}

/** An acquired smart point, with the outward directions of the slanted straight edges that end there. */
interface Acquired extends Pt {
  readonly dirs: readonly Pt[];
}

/** The best candidate so far. */
interface Hit {
  readonly x: number;
  readonly y: number;
  readonly kind: ObjectKind;
  readonly rank: number;
  /** distance from the cursor, document units */
  readonly d: number;
}

/**
 * A cell's key: its column above its row's low 16 bits (a number keys the map many times faster than
 * a string). Cells far outside the grid can share a key; a query then only checks a few more boxes.
 */
function keyOf(ix: number, iy: number): number {
  return (ix << 16) | (iy & 0xffff);
}

/**
 * Uniform grid over boxes. A box is listed in every cell it touches, unless it spans too many.
 * Boxes can be added and removed; the cells stay as they were laid out for the boxes it was built with.
 */
class BoxGrid<T extends Box> {
  private cells = new Map<number, T[]>();
  /** boxes too large for the cells; every query checks them */
  private spanning: T[] = [];
  private all: T[] = [];
  private origin: Pt = { x: 0, y: 0 };
  private cell = 1;
  /** a box around every item (and some it no longer has) */
  private x0 = Infinity;
  private y0 = Infinity;
  private x1 = -Infinity;
  private y1 = -Infinity;
  private stamp = 0;
  /** boxes added and removed since it was laid out */
  private churn = 0;

  /** Lays the grid out for `items`, which it keeps (and reorders). */
  build(items: T[]): void {
    this.all = items;
    this.cells = new Map();
    this.spanning = [];
    this.churn = 0;
    this.x0 = this.y0 = Infinity;
    this.x1 = this.y1 = -Infinity;
    for (let i = 0; i < items.length; i++) items[i].slot = i;
    if (items.length === 0) return;
    for (const it of items) this.cover(it);
    const span = Math.max(this.x1 - this.x0, this.y1 - this.y0, 1e-9);
    this.origin = { x: this.x0, y: this.y0 };
    this.cell = span / Math.max(8, Math.sqrt(items.length));
    for (const it of items) this.insert(it);
  }

  /** Swaps `gone` for `added`; once as many have come and gone as half what it holds, it is laid out again. */
  update(gone: readonly T[], added: readonly T[]): void {
    this.churn += gone.length + added.length;
    if (this.churn > this.all.length / 2) {
      const dropped = new Set(gone);
      const kept = gone.length ? this.all.filter((it) => !dropped.has(it)) : this.all;
      this.build(kept.concat(added));
      return;
    }
    for (const it of gone) {
      if (this.all[it.slot] !== it) continue;
      const last = this.all.pop()!;
      if (last !== it) {
        this.all[it.slot] = last;
        last.slot = it.slot;
      }
      this.place(it, (list) => {
        const i = list.indexOf(it);
        if (i < 0) return;
        list[i] = list[list.length - 1];
        list.pop();
      });
    }
    for (const it of added) {
      it.slot = this.all.length;
      this.all.push(it);
      this.cover(it);
      this.insert(it);
    }
  }

  private cover(it: T): void {
    this.x0 = Math.min(this.x0, it.x0);
    this.y0 = Math.min(this.y0, it.y0);
    this.x1 = Math.max(this.x1, it.x1);
    this.y1 = Math.max(this.y1, it.y1);
  }

  /** Every item whose box overlaps the window, each once, added to `out`. */
  query(x0: number, y0: number, x1: number, y1: number, out: T[] = []): T[] {
    // nothing there; and only the part of the window over the items needs its cells looked in
    if (x1 < this.x0 || x0 > this.x1 || y1 < this.y0 || y0 > this.y1) return out;
    x0 = Math.max(x0, this.x0);
    y0 = Math.max(y0, this.y0);
    x1 = Math.min(x1, this.x1);
    y1 = Math.min(y1, this.y1);
    const stamp = ++this.stamp;
    const visit = (list: readonly T[]): void => {
      for (const it of list) {
        if (it.seen === stamp) continue;
        it.seen = stamp;
        if (it.x1 >= x0 && it.x0 <= x1 && it.y1 >= y0 && it.y0 <= y1) out.push(it);
      }
    };
    const c0 = this.col(x0);
    const c1 = this.col(x1);
    const r0 = this.row(y0);
    const r1 = this.row(y1);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_QUERY_CELLS) {
      visit(this.all);
      return out;
    }
    for (let ix = c0; ix <= c1; ix++) {
      for (let iy = r0; iy <= r1; iy++) {
        const list = this.cells.get(keyOf(ix, iy));
        if (list) visit(list);
      }
    }
    visit(this.spanning);
    return out;
  }

  private col(x: number): number {
    return Math.floor((x - this.origin.x) / this.cell);
  }

  private row(y: number): number {
    return Math.floor((y - this.origin.y) / this.cell);
  }

  private insert(it: T): void {
    const c0 = this.col(it.x0);
    const c1 = this.col(it.x1);
    const r0 = this.row(it.y0);
    const r1 = this.row(it.y1);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS_PER_ITEM) {
      this.spanning.push(it);
      return;
    }
    for (let ix = c0; ix <= c1; ix++) {
      for (let iy = r0; iy <= r1; iy++) {
        const key = keyOf(ix, iy);
        const list = this.cells.get(key);
        if (list) list.push(it);
        else this.cells.set(key, [it]);
      }
    }
  }

  /** Calls `f` with each list `it` was put in. */
  private place(it: T, f: (list: T[]) => void): void {
    const c0 = this.col(it.x0);
    const c1 = this.col(it.x1);
    const r0 = this.row(it.y0);
    const r1 = this.row(it.y1);
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_CELLS_PER_ITEM) {
      f(this.spanning);
      return;
    }
    for (let ix = c0; ix <= c1; ix++) {
      for (let iy = r0; iy <= r1; iy++) {
        const list = this.cells.get(keyOf(ix, iy));
        if (list) f(list);
      }
    }
  }
}

/**
 * A layer's snap points and edges, made from its objects in order: object i's points are
 * points[pointAt[i]] up to points[pointAt[i + 1]], and its edges likewise.
 */
interface LayerSnaps {
  readonly objects: readonly ObjectInfo[];
  readonly points: readonly PointCand[];
  readonly edges: readonly Edge[];
  readonly pointAt: Int32Array;
  readonly edgeAt: Int32Array;
}

/** Points and edges to take out of the grids or put in. */
interface Snaps {
  readonly points: PointCand[];
  readonly edges: Edge[];
}

/** Puts the snaps of objects [from, to) of `s` in `into`. */
function take(into: Snaps, s: LayerSnaps, from = 0, to = s.objects.length): void {
  for (let i = s.pointAt[from]; i < s.pointAt[to]; i++) into.points.push(s.points[i]);
  for (let i = s.edgeAt[from]; i < s.edgeAt[to]; i++) into.edges.push(s.edges[i]);
}

export class Snapper {
  private readonly points = new BoxGrid<PointCand>();
  private readonly edges = new BoxGrid<Edge>();
  /** by layer id, kept while the layer's objects and what shows of them stay the same */
  private layers = new Map<string, LayerSnaps>();
  /** the layers whose snaps the grids hold */
  private gridded = new Map<string, LayerSnaps>();
  /** what decides which objects show (see visibilityKey) when the layers' snaps were made */
  private shows = "";
  private builtFor: string | null = null;
  /** the snaps under a viewport's open annotations (backdropSnaps), and the scene revision they were made at */
  private backdrop: { id: string; revision: number; snaps: LayerSnaps } | null = null;
  private stale = true;
  /** drawable ids under the last `exclude` set (selections hold containers) */
  private excluded: { ids: ReadonlySet<string>; leaves: ReadonlySet<string> } | null = null;
  /** smart points, oldest first */
  private acquired: Acquired[] = [];
  /** the point snap the cursor rests on, and since when */
  private resting: { x: number; y: number; since: number } | null = null;

  constructor(private readonly scene: Scene) {}

  /** The smart points acquired so far, oldest first. */
  get acquiredPoints(): readonly Pt[] {
    return this.acquired;
  }

  invalidate(): void {
    this.stale = true;
    this.excluded = null;
  }

  /**
   * Snaps `raw`, ignoring the points and edges of `exclude` and everything inside those objects.
   * `from` is the point the tool draws from, if any, for tangent and perpendicular snaps.
   */
  snap(raw: Pt, view: View, exclude?: ReadonlySet<string>, from: Pt | null = null): SnapResult {
    if (store.snapObjects) {
      this.ensureBuilt();
      const r = store.snapSettings.radiusPx / view.scale;
      const hit = this.objectSnap(raw, r, view.scale, exclude && this.leavesOf(exclude), from);
      const smart = store.snapKinds.smart;
      // the datum's offset points, where nearer than any object snap
      const off = smart ? datumOffsetSnap(raw, r) : null;
      if (off && (!hit || off.d < hit.d)) return { pos: off.at, kind: "datum" };
      if (hit) {
        if (smart && ACQUIRABLE.has(hit.kind)) this.rest(hit);
        return { pos: { x: hit.x, y: hit.y }, kind: hit.kind };
      }
      this.resting = null;
      const aligned = smart ? this.align(raw, r, view) : null;
      if (aligned) return aligned;
    }
    if (store.snapGrid) {
      // a rotated plan's grid lies along the screen, from its pivot
      const g = gridStep(view.scale);
      const q = view.toPlan(raw);
      return { pos: view.fromPlan({ x: Math.round(q.x / g) * g, y: Math.round(q.y / g) * g }), kind: "grid" };
    }
    return { pos: raw, kind: null };
  }

  /** Forgets the smart points. */
  clearAcquired(): void {
    this.acquired = [];
    this.resting = null;
  }

  /** Notes the cursor on a point snap; once it has rested there as long as Smart Point Settings say, the point is acquired. */
  private rest(hit: Hit): void {
    const now = performance.now();
    const r = this.resting;
    if (!r || r.x !== hit.x || r.y !== hit.y) {
      this.resting = { x: hit.x, y: hit.y, since: now };
      return;
    }
    if (now - r.since < store.snapSettings.acquireSec * 1000 || this.acquired.some((a) => a.x === hit.x && a.y === hit.y)) return;
    this.acquired = [...this.acquired, { x: hit.x, y: hit.y, dirs: this.edgeEndsAt(hit) }].slice(-MAX_ACQUIRED);
  }

  /**
   * Unit directions pointing out of `p` along the straight edges that end there,
   * leaving out horizontal and vertical ones (lining up covers those).
   */
  private edgeEndsAt(p: Pt): Pt[] {
    const eps = 1e-6 * Math.max(1, Math.abs(p.x), Math.abs(p.y));
    const dirs: Pt[] = [];
    for (const e of this.edges.query(p.x - eps, p.y - eps, p.x + eps, p.y + eps)) {
      if (e.arc !== null) continue;
      const atA = Math.abs(e.ax - p.x) <= eps && Math.abs(e.ay - p.y) <= eps;
      const atB = Math.abs(e.bx - p.x) <= eps && Math.abs(e.by - p.y) <= eps;
      if (atA === atB) continue;
      const dx = atA ? e.ax - e.bx : e.bx - e.ax;
      const dy = atA ? e.ay - e.by : e.by - e.ay;
      const len = Math.hypot(dx, dy);
      if (!(len > 0)) continue;
      const u = { x: dx / len, y: dy / len };
      if (Math.abs(u.x) < 1e-9 || Math.abs(u.y) < 1e-9) continue;
      if (!dirs.some((d) => Math.abs(d.x - u.x) < 1e-9 && Math.abs(d.y - u.y) < 1e-9)) dirs.push(u);
    }
    return dirs;
  }

  /**
   * Lines `raw` up with the nearest smart point in x, in y, or both, within `r`;
   * the other coordinate stays free (on the grid when grid snapping is on). Or,
   * when nearer, puts it on the extension of an edge ending at a smart point.
   * Null when no smart point is in line.
   */
  private align(raw: Pt, r: number, view: View): SnapResult | null {
    let vx: { a: Pt; d: number } | null = null;
    let hy: { a: Pt; d: number } | null = null;
    let ext: { a: Pt; at: Pt; d: number } | null = null;
    const datum = store.datum;
    // lined up along the screen's axes: a rotated plan's
    const q = view.toPlan(raw);
    for (const a of datum ? [...this.acquired, { x: datum.x, y: datum.y, dirs: [] }] : this.acquired) {
      const qa = view.toPlan(a);
      const dx = Math.abs(q.x - qa.x);
      const dy = Math.abs(q.y - qa.y);
      if (dx <= r && (!vx || dx < vx.d)) vx = { a, d: dx };
      if (dy <= r && (!hy || dy < hy.d)) hy = { a, d: dy };
      for (const u of a.dirs) {
        const t = (raw.x - a.x) * u.x + (raw.y - a.y) * u.y;
        const d = Math.abs((raw.x - a.x) * u.y - (raw.y - a.y) * u.x);
        if (t > 0 && d <= r && (!ext || d < ext.d)) ext = { a, at: { x: a.x + u.x * t, y: a.y + u.y * t }, d };
      }
    }
    // one guide along an axis gives way to a nearer extension; two guides (a corner) do not
    const axis = vx && hy ? null : (vx ?? hy);
    if (ext && !(vx && hy) && (!axis || ext.d < axis.d)) return { pos: ext.at, kind: "extension", guides: [ext.a] };
    if (!vx && !hy) return null;
    const g = store.snapGrid ? gridStep(view.scale) : 0;
    const free = (v: number): number => (g > 0 ? Math.round(v / g) * g : v);
    const pos = view.fromPlan({ x: vx ? view.toPlan(vx.a).x : free(q.x), y: hy ? view.toPlan(hy.a).y : free(q.y) });
    const guides = [vx?.a, hy?.a].filter((a): a is Pt => !!a && (a.x !== pos.x || a.y !== pos.y));
    if (guides.length === 2 && guides[0] === guides[1]) guides.pop();
    return guides.length ? { pos, kind: "align", guides } : null;
  }

  /**
   * Whether an object's snaps are left out: those outside the group being edited, while
   * Preferences > Display hides them; null when none are.
   */
  private hiddenOwner(): ((owner: string) => boolean) | null {
    const group = store.editGroupId;
    const doc = this.scene.document;
    if (!group || !doc || prefs().showOthersEditing) return null;
    const ids = new Set([group]);
    return (owner) => {
      const obj = doc.object(owner);
      return !obj || !this.scene.within(obj, ids);
    };
  }

  /** Best object snap within `r` document units of p, or null. */
  private objectSnap(p: Pt, r: number, scale: number, exclude: ReadonlySet<string> | undefined, from: Pt | null): Hit | null {
    const on = store.snapKinds;
    const hidden = this.hiddenOwner();
    let best: Hit | null = null;
    for (const c of this.points.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
      if (exclude?.has(c.owner) || hidden?.(c.owner) || !on[c.kind]) continue;
      best = prefer(best, hitAt(p, c.x, c.y, c.kind, r));
    }
    if (from && on.tangent) {
      for (const e of this.edges.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
        if (exclude?.has(e.owner) || hidden?.(e.owner)) continue;
        if (e.arc) {
          for (const t of tangentPoints(from, e.arc)) best = prefer(best, hitAt(p, t.x, t.y, "tangent", r));
        } else {
          const q = perpendicularFoot(from, e);
          if (q) best = prefer(best, hitAt(p, q.x, q.y, "perpendicular", r));
        }
      }
    }
    if (!on.intersection && !on.nearest) return best;
    const near = this.nearEdges(p, r, scale, exclude);
    const eps = END_PX / scale;
    for (let i = 0; on.intersection && i < near.length; i++) {
      for (let j = i + 1; j < near.length; j++) {
        const x = crossing(near[i], near[j], eps);
        if (x) best = prefer(best, hitAt(p, x.x, x.y, "intersection", r));
      }
    }
    if (best === null && on.nearest) {
      for (const s of near) {
        const q = nearestOn(p, s);
        best = prefer(best, hitAt(p, q.x, q.y, "nearest", r));
      }
    }
    return best;
  }

  /** Straight edges and arc chords within `r` of p, nearest first, at most MAX_NEAR_EDGES. */
  private nearEdges(p: Pt, r: number, scale: number, exclude?: ReadonlySet<string>): Seg[] {
    const found: { seg: Seg; d: number }[] = [];
    const hidden = this.hiddenOwner();
    for (const e of this.edges.query(p.x - r, p.y - r, p.x + r, p.y + r)) {
      if (exclude?.has(e.owner) || hidden?.(e.owner)) continue;
      if (e.arc === null) {
        const d = distToSegment(p, { x: e.ax, y: e.ay }, { x: e.bx, y: e.by });
        if (d <= r) found.push({ seg: e, d });
      } else {
        arcChordsNear(found, e.arc, e.owner, p, r, scale);
      }
    }
    found.sort((a, b) => a.d - b.d);
    return found.slice(0, MAX_NEAR_EDGES).map((f) => f.seg);
  }

  private leavesOf(ids: ReadonlySet<string>): ReadonlySet<string> {
    if (this.excluded?.ids !== ids) {
      this.excluded = { ids, leaves: new Set(this.scene.expand(ids).map((s) => s.obj.id)) };
    }
    return this.excluded.leaves;
  }

  private ensureBuilt(): void {
    const layerId = store.activeLayerId;
    if (!this.stale && layerId === this.builtFor) return;
    // smart points belong to the layer they were acquired on
    if (layerId !== this.builtFor) this.clearAcquired();
    this.builtFor = layerId;
    this.stale = false;
    const shows = this.visibilityKey();
    if (shows !== this.shows) {
      this.layers.clear();
      this.gridded.clear();
      this.points.build([]);
      this.edges.build([]);
    }
    this.shows = shows;
    const gone: Snaps = { points: [], edges: [] };
    const added: Snaps = { points: [], edges: [] };
    const snappable = this.scene.snappableLayers(layerId);
    const next = new Map<string, LayerSnaps>();
    for (const layer of snappable) {
      const objects = this.scene.index(layer.id).objects;
      const had = this.layers.get(layer.id);
      let was = this.gridded.get(layer.id);
      let now = had;
      if (!now || now.objects !== objects) {
        const change = had && listChange(had.objects, objects);
        // a small change swaps the snaps of the objects it changed; a large one makes the layer's again
        if (had && change && change.endA - change.start + (change.endB - change.start) <= objects.length) {
          now = this.patched(had, objects, change);
          if (was === had) {
            take(gone, had, change.start, change.endA);
            take(added, now, change.start, change.endB);
            was = now;
          }
        } else {
          now = { objects, ...this.snapsOf(objects, 0, objects.length) };
        }
        this.layers.set(layer.id, now);
      }
      next.set(layer.id, now);
      if (was === now) continue;
      if (was) take(gone, was);
      take(added, now);
    }
    // under a viewport's open annotations, what the viewport shows snaps where it is drawn there
    const backdrop = this.backdropSnaps();
    if (backdrop) {
      const was = this.gridded.get(backdrop.id);
      next.set(backdrop.id, backdrop.snaps);
      if (was !== backdrop.snaps) {
        if (was) take(gone, was);
        take(added, backdrop.snaps);
      }
    }
    for (const [id, was] of this.gridded) if (!next.has(id)) take(gone, was);
    this.gridded = next;
    this.points.update(gone.points, added.points);
    this.edges.update(gone.edges, added.edges);
    // forget the layers the drawing no longer has
    const known = new Set([...this.scene.layers().map((l) => l.id), ...snappable.map((l) => l.id)]);
    for (const id of [...this.layers.keys()]) if (!known.has(id)) this.layers.delete(id);
  }

  /**
   * While a viewport's annotations are open: the snaps of what the viewport shows, its plan drawing
   * and what it caches, in the annotations' coordinates (the sheet's times its scale), as Vectorworks
   * snaps dimensions to them. Kept while the drawing is the same.
   */
  private backdropSnaps(): { id: string; snaps: LayerSnaps } | null {
    const open = store.symbolEdit;
    const sheet = open?.from.layerId;
    if (!open?.viewport || !sheet) return null;
    const id = `annotated:${open.viewport}`;
    const revision = this.scene.revision;
    if (this.backdrop?.id === id && this.backdrop.revision === revision) return this.backdrop;
    const k = open.layer.scale;
    const placed: { obj: ObjectInfo; m: Affine }[] = [];
    const live = this.scene.viewports(sheet).find((v) => v.id === open.viewport);
    if (live) {
      const { a, b, c, d, e, f } = live.m;
      const m = { a: a * k, b: b * k, c: c * k, d: d * k, e: e * k, f: f * k };
      for (const l of live.layers) {
        if (l.visibility === "hidden" || l.via) continue;
        for (const obj of this.scene.index(l.id).objects) placed.push({ obj, m });
      }
    }
    const onSheet = { a: k, b: 0, c: 0, d: k, e: 0, f: 0 };
    const own = new Set([open.viewport]);
    for (const obj of this.scene.index(sheet).objects) if (obj.id !== open.viewport && this.scene.within(obj, own)) placed.push({ obj, m: onSheet });
    const points: PointCand[] = [];
    const edges: Edge[] = [];
    const pointAt = new Int32Array(placed.length + 1);
    const edgeAt = new Int32Array(placed.length + 1);
    placed.forEach(({ obj, m }, i) => {
      if (obj.shape && this.scene.isObjectSnappable(obj)) addShape(mapShape(obj.shape, m), obj.id, points, edges);
      pointAt[i + 1] = points.length;
      edgeAt[i + 1] = edges.length;
    });
    const snaps: LayerSnaps = { objects: placed.map((p) => p.obj), points, edges, pointAt, edgeAt };
    this.backdrop = { id, revision, snaps };
    return this.backdrop;
  }

  /** What decides which objects show (Scene.isObjectVisible): the class options, the active class, each class's own visibility and the hidden objects. */
  private visibilityKey(): string {
    return [store.classMode, store.activeClassIndex, hiddenVersion(), ...this.scene.classes().map((c) => `${c.index}:${c.visibility}`)].join(" ");
  }

  /** `had`'s snaps for `objects`, the layer's objects after an edit changed `had.objects[start..endA)` to `objects[start..endB)`. */
  private patched(had: LayerSnaps, objects: readonly ObjectInfo[], { start, endA, endB }: ReturnType<typeof listChange>): LayerSnaps {
    const mid = this.snapsOf(objects, start, endB);
    const p0 = had.pointAt[start];
    const p1 = had.pointAt[endA];
    const e0 = had.edgeAt[start];
    const e1 = had.edgeAt[endA];
    return {
      objects,
      points: had.points.slice(0, p0).concat(mid.points, had.points.slice(p1)),
      edges: had.edges.slice(0, e0).concat(mid.edges, had.edges.slice(e1)),
      pointAt: spliceAt(had.pointAt, mid.pointAt, start, endA, endB),
      edgeAt: spliceAt(had.edgeAt, mid.edgeAt, start, endA, endB),
    };
  }

  /** The snap points and edges of objects[from] up to objects[to], with where each object's start (pointAt[0] = 0). */
  private snapsOf(objects: readonly ObjectInfo[], from: number, to: number): Omit<LayerSnaps, "objects"> & Snaps {
    const points: PointCand[] = [];
    const edges: Edge[] = [];
    const pointAt = new Int32Array(to - from + 1);
    const edgeAt = new Int32Array(to - from + 1);
    for (let i = from; i < to; i++) {
      const obj = objects[i];
      if (obj.shape && this.scene.isObjectSnappable(obj)) addShape(obj.shape, obj.id, points, edges);
      pointAt[i - from + 1] = points.length;
      edgeAt[i - from + 1] = edges.length;
    }
    return { points, edges, pointAt, edgeAt };
  }
}

/**
 * Where each object's snaps start (LayerSnaps.pointAt) once objects [start, endA) of the old list
 * became [start, endB): `mid` holds the new objects' own, from 0.
 */
function spliceAt(at: Int32Array, mid: Int32Array, start: number, endA: number, endB: number): Int32Array {
  const n = at.length - 1 - (endA - start) + (endB - start);
  const out = new Int32Array(n + 1);
  out.set(at.subarray(0, start + 1));
  const base = at[start];
  for (let k = 1; k <= endB - start; k++) out[start + k] = base + mid[k];
  const moved = base + mid[endB - start] - at[endA];
  for (let i = endB + 1; i <= n; i++) out[i] = at[i - endB + endA] + moved;
  return out;
}

/** Grid spacing in document units: the fixed spacing when one is set, else one that follows the zoom. */
/** The points Use datum offset marks: that far from the datum along its horizontal and vertical extensions; none without both. */
export function datumOffsetPoints(): Pt[] {
  const d = store.datum;
  const o = store.snapSettings.datumOffset;
  if (!d || o === null) return [];
  return [
    { x: d.x + o, y: d.y },
    { x: d.x - o, y: d.y },
    { x: d.x, y: d.y + o },
    { x: d.x, y: d.y - o },
  ];
}

/** The datum offset point nearest `p` within `r`, or null. */
function datumOffsetSnap(p: Pt, r: number): { at: Pt; d: number } | null {
  let best: { at: Pt; d: number } | null = null;
  for (const at of datumOffsetPoints()) {
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    if (d <= r && (!best || d < best.d)) best = { at, d };
  }
  return best;
}

export function gridStep(scale: number): number {
  return store.snapSettings.gridSpacing ?? niceStep(scale);
}

/** Adds the snap points and edges of one drawable shape. */
function addShape(shape: Shape, owner: string, points: PointCand[], edges: Edge[]): void {
  if (shape.kind === "text" || shape.kind === "image") return;
  if (shape.kind === "arc") {
    addArc(shape, owner, points, edges);
    return;
  }
  const pts = shape.points;
  const n = pts.length;
  if (n === 0) return;
  for (const p of pts) addPoint(points, p, "end", owner);
  if (shape.kind === "rect" && n === 4) {
    addPoint(points, { x: (pts[0].x + pts[2].x) / 2, y: (pts[0].y + pts[2].y) / 2 }, "center", owner);
  }
  const count = isClosedShape(shape) ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    if (!a || !b || (a.x === b.x && a.y === b.y)) continue;
    addPoint(points, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, "mid", owner);
    addStraight(edges, a, b, owner);
  }
}

function addArc(shape: Shape, owner: string, points: PointCand[], edges: Edge[]): void {
  const c = shape.center;
  const r = arcRadii(shape);
  if (!c || !r) return;
  addPoint(points, c, "center", owner);
  const a0 = degToRad(shape.startAngle ?? 0);
  const sweep = degToRad(shape.sweepAngle ?? 360);
  if (!isFullArc(shape)) {
    addPoint(points, { x: c.x + r.rx * Math.cos(a0), y: c.y + r.ry * Math.sin(a0) }, "end", owner);
    const a1 = a0 + sweep;
    addPoint(points, { x: c.x + r.rx * Math.cos(a1), y: c.y + r.ry * Math.sin(a1) }, "end", owner);
  }
  const big = Math.max(r.rx, r.ry);
  if (!(big > 0) || !Number.isFinite(big)) return;
  const arc: ArcSpan = { cx: c.x, cy: c.y, rx: r.rx, ry: r.ry, a0, sweep };
  edges.push({
    x0: c.x - big,
    y0: c.y - big,
    x1: c.x + big,
    y1: c.y + big,
    seen: 0,
    slot: 0,
    ax: 0,
    ay: 0,
    bx: 0,
    by: 0,
    owner,
    arc,
  });
}

function addPoint(points: PointCand[], p: Pt, kind: PointCand["kind"], owner: string): void {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
  points.push({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, seen: 0, slot: 0, x: p.x, y: p.y, kind, owner });
}

/** Where lines from `f` touch a circular arc (none from inside the circle, or for an ellipse). */
function tangentPoints(f: Pt, arc: ArcSpan): Pt[] {
  const R = arc.rx;
  if (!(R > 0) || Math.abs(arc.rx - arc.ry) > 1e-9 * R) return [];
  const dx = f.x - arc.cx;
  const dy = f.y - arc.cy;
  const d = Math.hypot(dx, dy);
  if (!(d > R * (1 + 1e-9))) return [];
  const toward = Math.atan2(dy, dx);
  const spread = Math.acos(R / d);
  return [toward + spread, toward - spread]
    .filter((phi) => onArc(arc, phi))
    .map((phi) => ({ x: arc.cx + R * Math.cos(phi), y: arc.cy + R * Math.sin(phi) }));
}

/** Whether the angle `phi` (radians) falls within the arc's sweep. */
function onArc(arc: ArcSpan, phi: number): boolean {
  const span = Math.abs(arc.sweep);
  if (span >= 2 * Math.PI - 1e-9) return true;
  const start = arc.sweep >= 0 ? arc.a0 : arc.a0 + arc.sweep;
  const turn = 2 * Math.PI;
  const rel = (((phi - start) % turn) + turn) % turn;
  return rel <= span + 1e-9;
}

/** The foot of the perpendicular from `f` to segment `s`, or null when it falls off the segment or `f` is on its line. */
function perpendicularFoot(f: Pt, s: Seg): Pt | null {
  const dx = s.bx - s.ax;
  const dy = s.by - s.ay;
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return null;
  const t = ((f.x - s.ax) * dx + (f.y - s.ay) * dy) / len2;
  if (t < 0 || t > 1) return null;
  const q = { x: s.ax + dx * t, y: s.ay + dy * t };
  return Math.hypot(f.x - q.x, f.y - q.y) > 1e-9 * Math.sqrt(len2) ? q : null;
}

function addStraight(edges: Edge[], a: Pt, b: Pt, owner: string): void {
  if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return;
  edges.push({
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
    seen: 0,
    slot: 0,
    ax: a.x,
    ay: a.y,
    bx: b.x,
    by: b.y,
    owner,
    arc: null,
  });
}

function arcPoint(arc: ArcSpan, f: number): Pt {
  const t = arc.a0 + arc.sweep * f;
  return { x: arc.cx + arc.rx * Math.cos(t), y: arc.cy + arc.ry * Math.sin(t) };
}

/**
 * Pushes the chords of an arc that lie within `r` of p. The chord count follows
 * the zoom, so the approximation error stays under ARC_TOL_PX on screen.
 */
function arcChordsNear(
  out: { seg: Seg; d: number }[],
  arc: ArcSpan,
  owner: string,
  p: Pt,
  r: number,
  scale: number,
): void {
  const far = Math.max(arc.rx, arc.ry);
  const near = Math.min(arc.rx, arc.ry);
  const dc = Math.hypot(p.x - arc.cx, p.y - arc.cy);
  // every point of the arc is between `near` and `far` from the centre
  if (dc + r < near || dc - r > far) return;
  const rpx = far * scale;
  const step = rpx > ARC_TOL_PX ? 2 * Math.acos(1 - ARC_TOL_PX / rpx) : Math.PI;
  const n = clamp(Math.ceil(Math.abs(arc.sweep) / step), MIN_ARC_CHORDS, MAX_ARC_CHORDS);
  let prev = arcPoint(arc, 0);
  for (let i = 1; i <= n; i++) {
    const next = arcPoint(arc, i / n);
    const d = distToSegment(p, prev, next);
    if (d <= r) out.push({ seg: { ax: prev.x, ay: prev.y, bx: next.x, by: next.y, owner }, d });
    prev = next;
  }
}

function hitAt(p: Pt, x: number, y: number, kind: ObjectKind, r: number): Hit | null {
  const d = Math.hypot(x - p.x, y - p.y);
  return d <= r ? { x, y, kind, rank: RANK[kind], d } : null;
}

/** The better of two hits: higher rank, then nearer. */
function prefer(a: Hit | null, b: Hit | null): Hit | null {
  if (a === null) return b;
  if (b === null) return a;
  if (a.rank !== b.rank) return a.rank > b.rank ? a : b;
  return a.d <= b.d ? a : b;
}

/**
 * Crossing point of two segments, or null. Parallel segments and crossings
 * within `eps` of an end are skipped (an end snap covers those).
 */
function crossing(a: Seg, b: Seg, eps: number): Pt | null {
  const rx = a.bx - a.ax;
  const ry = a.by - a.ay;
  const sx = b.bx - b.ax;
  const sy = b.by - b.ay;
  const lenA = Math.hypot(rx, ry);
  const lenB = Math.hypot(sx, sy);
  const den = rx * sy - ry * sx;
  if (!(Math.abs(den) > 1e-12 * lenA * lenB)) return null;
  const qx = b.ax - a.ax;
  const qy = b.ay - a.ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  if (t * lenA < eps || (1 - t) * lenA < eps || u * lenB < eps || (1 - u) * lenB < eps) return null;
  return { x: a.ax + rx * t, y: a.ay + ry * t };
}

/** The point of segment s nearest to p. */
function nearestOn(p: Pt, s: Seg): Pt {
  const vx = s.bx - s.ax;
  const vy = s.by - s.ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 > 0 ? clamp(((p.x - s.ax) * vx + (p.y - s.ay) * vy) / len2, 0, 1) : 0;
  return { x: s.ax + vx * t, y: s.ay + vy * t };
}
