// The object index behind Model.objects() and Model.object(): every layer's objects in drawing
// order, and each by id. Building it whole takes about a second on a drawing of a few hundred
// thousand objects, so after an edit it keeps what the edit left alone.
//
// An object's ObjectInfo comes from the records of the object it sits in directly on its layer
// (its top-level object, with everything that holds) and from records outside the layers (names,
// classes, symbol definitions, worksheets) and the file header. When every record that changed
// since the last build lies inside one layer's objects, the other layers keep their lists, and
// the changed layer keeps the ObjectInfo of every top-level object before and after the change.
// Only the top-level objects the change touches are indexed again, and the lookups by id are
// patched. Anything else is indexed whole, as before.

import type { Rec } from "./records.ts";
import type { ObjectInfo } from "./types.ts";

export interface Index {
  byLayer: Map<string, ObjectInfo[]>;
  objects: Map<string, ObjectInfo>;
  recs: Map<string, Rec>;
  classCounts: Map<number, number>;
}

/** Puts an object in the index; `rec` is its record, null for one drawn from a symbol or a worksheet. */
export type AddObject = (info: ObjectInfo, rec: Rec | null) => void;

/** What the index is built from. */
export interface IndexSource {
  readonly recs: readonly Rec[];
  readonly header: Uint8Array;
  /** whatever else the objects are read with: nothing is kept across a change of it */
  readonly context: number;
  /**
   * the layers in order; an open symbol definition comes last, not counted towards its classes,
   * and open viewport annotations after that, inside their sheet's records
   */
  readonly layers: readonly { readonly rec: Rec; readonly id: string; readonly counted: boolean }[];
  /** the objects directly on a layer */
  kids(layer: Rec): readonly Rec[];
  /** what indexes an object directly on `layer`, with everything it holds, through `add` */
  visitor(layer: Rec, layerId: string, add: AddObject): (top: Rec) => void;
}

interface Layer {
  readonly id: string;
  /** the layer's record and the last record of what it holds */
  readonly start: number;
  readonly end: number;
  readonly list: ObjectInfo[];
  /**
   * Three numbers per object directly on the layer: its record and the last record it holds,
   * counted from the layer's, and where its objects start in `list`.
   */
  readonly runs: Int32Array;
}

interface Built {
  readonly recs: readonly Rec[];
  readonly header: Uint8Array;
  readonly context: number;
  readonly idx: Index;
  readonly layers: readonly Layer[];
}

/** Records a change to the records inside a symbol definition or a worksheet reaches beyond its layer. */
const SYMBOL_DEF = 16;
const WORKSHEET = 18;

/** The last record in `rec`'s subtree. */
function lastOf(rec: Rec): number {
  let r = rec;
  while (r.children.length) r = r.children[r.children.length - 1];
  return r.index;
}

/** Ids of objects drawn from a symbol or a worksheet ("<id>/<n>"); they have no record of their own. */
function derived(id: string): boolean {
  return id.includes("/");
}

export class ObjectIndex {
  private built: Built | null = null;
  /** ids more than one object has: looking one up finds the last indexed, as it always did */
  private dupIds = new Set<string>();
  /** the records of the objects with those ids */
  private dupRecs = new WeakMap<ObjectInfo, Rec>();
  /** a patch found something it can't keep: the index is built whole */
  private bail = false;
  /** objects with records added, and how many of those had an id already added */
  private own = 0;
  private clashes = 0;

  update(src: IndexSource): Index {
    const prev = this.built;
    this.built = (prev && this.patch(prev, src)) || this.whole(src);
    return this.built.idx;
  }

  private whole(src: IndexSource): Built {
    const idx: Index = { byLayer: new Map(), objects: new Map(), recs: new Map(), classCounts: new Map() };
    this.dupIds = new Set();
    this.dupRecs = new WeakMap();
    this.bail = false;
    this.own = 0;
    this.clashes = 0;
    const layers: Layer[] = [];
    for (const l of src.layers) {
      idx.recs.set(l.id, l.rec);
      const list: ObjectInfo[] = [];
      const visit = src.visitor(l.rec, l.id, this.adder(idx, list, l.counted, null));
      const kids = src.kids(l.rec);
      const start = l.rec.index;
      const runs = new Int32Array(kids.length * 3);
      for (let k = 0; k < kids.length; k++) {
        const c = kids[k];
        runs[3 * k] = c.index - start;
        runs[3 * k + 1] = lastOf(c) - start;
        runs[3 * k + 2] = list.length;
        visit(c);
      }
      idx.byLayer.set(l.id, list);
      layers.push({ id: l.id, start, end: lastOf(l.rec), list, runs });
    }
    // an object with a layer's id took its place among the records: keep nothing next time
    if (idx.recs.size !== layers.length + this.own - this.clashes) this.bail = true;
    return { recs: src.recs, header: src.header, context: src.context, idx, layers };
  }

  /**
   * Adds objects to `list` and the lookups. `recheck` (while patching) collects the ids several
   * objects have, whose last one is found again once every layer is done.
   */
  private adder(idx: Index, list: ObjectInfo[], counted: boolean, recheck: Set<string> | null): AddObject {
    const { objects, recs, classCounts } = idx;
    return (info, rec) => {
      list.push(info);
      const id = info.id;
      const had = objects.get(id);
      if (rec) this.own++;
      if (had !== undefined || this.dupIds.has(id)) {
        if (rec && had) this.clashes++;
        this.dupIds.add(id);
        const hadRec = rec && had && recs.get(id);
        if (had && hadRec && !this.dupRecs.has(had)) this.dupRecs.set(had, hadRec);
        if (rec) this.dupRecs.set(info, rec);
        recheck?.add(id);
      } else if (recheck && rec && recs.has(id)) {
        // a layer's id
        this.bail = true;
      }
      objects.set(id, info);
      if (!rec) return;
      recs.set(id, rec);
      if (counted) classCounts.set(rec.classIndex, (classCounts.get(rec.classIndex) ?? 0) + 1);
    };
  }

  /** The index after an edit, keeping what it can of `prev`; null when it must be built whole. */
  private patch(prev: Built, src: IndexSource): Built | null {
    if (this.bail || src.header !== prev.header || src.context !== prev.context || src.layers.length !== prev.layers.length) return null;
    const before = prev.recs;
    const after = src.recs;
    // the records that changed: [s, eb) before, [s, ea) after
    const n = Math.min(before.length, after.length);
    let s = 0;
    while (s < n && before[s] === after[s]) s++;
    let eb = before.length;
    let ea = after.length;
    while (eb > s && ea > s && before[eb - 1] === after[ea - 1]) {
      eb--;
      ea--;
    }
    const delta = ea - eb;
    const changed = eb > s || ea > s;
    // the one layer whose objects held and hold every changed record (an open definition is not one)
    let at = -1;
    if (changed) {
      for (let k = 0; k < prev.layers.length; k++) {
        const p = prev.layers[k];
        if (p.start < s && Math.max(eb - 1, s) <= p.end && src.layers[k].counted) {
          at = k;
          break;
        }
      }
      if (at < 0) return null;
      // a layer held inside another (a viewport's annotations open on their sheet) is indexed whole after a change in it
      for (let k = 0; k < prev.layers.length; k++) {
        const p = prev.layers[k];
        if (k !== at && p.start <= Math.max(eb - 1, s) && p.end >= s) return null;
      }
      for (let i = s; i < eb; i++) if (before[i].type === SYMBOL_DEF || before[i].type === WORKSHEET) return null;
      for (let i = s; i < ea; i++) {
        for (let r: Rec | null = after[i]; r; r = r.parent) if (r.type === SYMBOL_DEF || r.type === WORKSHEET) return null;
      }
    }
    const idx: Index = { byLayer: new Map(), objects: prev.idx.objects, recs: prev.idx.recs, classCounts: prev.idx.classCounts };
    const recheck = new Set<string>();
    const layers: Layer[] = [];
    for (let k = 0; k < src.layers.length; k++) {
      const l = src.layers[k];
      const p = prev.layers[k];
      const start = l.rec.index;
      const end = lastOf(l.rec);
      if (l.id !== p.id) return null;
      let next: Layer | null;
      if (k === at) {
        if (start !== p.start || end !== p.end + delta || Math.max(ea - 1, s) > end) return null;
        next = this.patchLayer(p, l, src, idx, recheck, s, ea, delta);
      } else {
        // wholly before the change, or wholly after it
        const shift = p.start >= eb && changed ? delta : 0;
        next = start === p.start + shift && end === p.end + shift ? (shift ? { ...p, start, end } : p) : null;
      }
      if (!next || this.bail) return null;
      layers.push(next);
      idx.byLayer.set(l.id, next.list);
    }
    if (recheck.size && !this.relink(layers, recheck, idx)) return null;
    return { recs: after, header: src.header, context: src.context, idx, layers };
  }

  /**
   * Layer `p` after an edit to the records [s, ea) (as they now are) inside it, which moved what
   * follows by `delta`: the top-level objects on either side keep their objects.
   */
  private patchLayer(
    p: Layer,
    l: IndexSource["layers"][number],
    src: IndexSource,
    idx: Index,
    recheck: Set<string>,
    s: number,
    ea: number,
    delta: number,
  ): Layer | null {
    const start = p.start;
    const kids = src.kids(l.rec);
    const runs = p.runs;
    const m = runs.length / 3;
    // the objects before the change, as they were
    let a = 0;
    for (; a < kids.length && a < m; a++) {
      const c = kids[a];
      const e = lastOf(c);
      if (e >= s || runs[3 * a] !== c.index - start || runs[3 * a + 1] !== e - start) break;
    }
    // and after it, moved along
    let b = 0;
    for (; b < kids.length - a && b < m - a; b++) {
      const c = kids[kids.length - 1 - b];
      const r = 3 * (m - 1 - b);
      if (c.index < ea || runs[r] + delta !== c.index - start || runs[r + 1] + delta !== lastOf(c) - start) break;
    }
    // every changed record is, and was, in the objects between: not the layer's own (its aux data)
    const eb = ea - delta;
    if (ea > s && (a >= kids.length - b || s < kids[a].index || ea - 1 > lastOf(kids[kids.length - b - 1]))) return null;
    if (eb > s && (a >= m - b || s < runs[3 * a] + start || eb - 1 > runs[3 * (m - b - 1) + 1] + start)) return null;
    const from = a < m ? runs[3 * a + 2] : p.list.length;
    const to = b > 0 ? runs[3 * (m - b) + 2] : p.list.length;
    for (let i = from; i < to; i++) this.drop(p.list[i], idx, l.counted, recheck);
    const mid: ObjectInfo[] = [];
    const visit = src.visitor(l.rec, l.id, this.adder(idx, mid, l.counted, recheck));
    const out = new Int32Array(kids.length * 3);
    out.set(runs.subarray(0, 3 * a));
    for (let k = a; k < kids.length - b; k++) {
      const c = kids[k];
      out[3 * k] = c.index - start;
      out[3 * k + 1] = lastOf(c) - start;
      out[3 * k + 2] = from + mid.length;
      visit(c);
    }
    const moved = from + mid.length - to;
    for (let t = 0; t < b; t++) {
      const r = 3 * (m - b + t);
      const w = 3 * (kids.length - b + t);
      out[w] = runs[r] + delta;
      out[w + 1] = runs[r + 1] + delta;
      out[w + 2] = runs[r + 2] + moved;
    }
    const list = from === 0 && to === p.list.length ? mid : p.list.slice(0, from).concat(mid, p.list.slice(to));
    return { id: p.id, start, end: p.end + delta, list, runs: out };
  }

  /** Takes an object the edit replaced out of the lookups. */
  private drop(info: ObjectInfo, idx: Index, counted: boolean, recheck: Set<string>): void {
    const id = info.id;
    const own = !derived(id);
    if (own && counted) {
      const n = (idx.classCounts.get(info.classIndex) ?? 0) - 1;
      if (n > 0) idx.classCounts.set(info.classIndex, n);
      else idx.classCounts.delete(info.classIndex);
    }
    if (this.dupIds.has(id) || idx.objects.get(id) !== info) {
      recheck.add(id);
      return;
    }
    idx.objects.delete(id);
    if (own) idx.recs.delete(id);
  }

  /** Points each id in `ids` at the last object that has it, as building the index whole does. */
  private relink(layers: readonly Layer[], ids: ReadonlySet<string>, idx: Index): boolean {
    const last = new Map<string, ObjectInfo>();
    for (const l of layers) for (const o of l.list) if (ids.has(o.id)) last.set(o.id, o);
    for (const id of ids) {
      const o = last.get(id);
      if (!o) {
        idx.objects.delete(id);
        if (!derived(id)) idx.recs.delete(id);
        continue;
      }
      idx.objects.set(id, o);
      if (derived(id)) continue;
      const r = this.dupRecs.get(o);
      if (!r) return false;
      idx.recs.set(id, r);
    }
    return true;
  }
}
