// Stories: a building's floors, each with an elevation and the levels on it
// (finish floor, top of slab, ...) that design layers are put at (FORMAT.md §5.1).
//
// Each story is a type-76 record tagged "YRTS" at +0x50, under one tagged
// "LRTS" in the class list's root; its name is the record's name index, and a
// design layer names its story at +0xf4 (§5). From +0x54 it holds a tree, read
// as the data visualisations' is (dataviz.ts): a node is u16 kind, u32 length
// (from the node's start), fields until a u32 0, then child nodes to its end. A
// field is u32 length and the bytes; strings are FF FE, UTF-16LE and 00 00. The
// root's one child is the story: [0] its suffix, [1] its elevation (f64, mm).
// Its kind-2 child lists the levels, [0] their count, one child each: [0] the
// level type, [1] its elevation above the story (f64), [2] the design layer at
// it ("" for none), [3] a u32 id, unique among the story's levels, then two u32s
// kept as they are (1 and 209 or 0 on slab levels, 0 and 0 on the others; a new
// level takes the story's next id and 0 and 0). Bytes after the tree are
// kept as they are too (stale level nodes, in the demo files). The story list
// has a header and the tag only; the records under it are its children by
// their place (records.ts), as a list's always are.

import { concat, encodeUtf16, f64, setF64, setU32, setU64, u16, u32 } from "./bytes.ts";
import type { StoryLevelSpec } from "./types.ts";
import type { Rec } from "./records.ts";

const AUX = 76;
const TAG_AT = 0x50;
const ROOT = 0x54;
const STORY_TAG = "YRTS";
export const STORY_LIST_TAG = "LRTS";
const STORY_NODE = 0x1100;
const LEVELS = 2;
const S_SUFFIX = 0;
const S_ELEVATION = 1;
const L_TYPE = 0;
const L_ELEVATION = 1;
const L_LAYER = 2;
const L_ID = 3;

interface Node {
  kind: number;
  fields: Uint8Array[];
  kids: Node[];
}

export interface StoryLevel {
  /** the level type: "Finish Floor", "Top of Slab", ... */
  readonly type: string;
  /** its elevation above the story's, mm */
  readonly elevation: number;
  /** the name of the design layer at it, "" for none */
  readonly layer: string;
}

export interface Story {
  readonly suffix: string;
  /** mm */
  readonly elevation: number;
  readonly levels: readonly StoryLevel[];
}

/** What editStory changes; a part left out stays. */
export interface StoryChange {
  suffix?: string;
  elevation?: number;
  /** the design layers its levels name, renamed: a level at a layer named by a key takes the value ("" for none) */
  layers?: ReadonlyMap<string, string>;
  /** its levels, in order, in place of those it has */
  levels?: readonly StoryLevelSpec[];
}

function tag(d: Uint8Array, at: number): string {
  return d.length < at + 4 ? "" : String.fromCharCode(d[at], d[at + 1], d[at + 2], d[at + 3]);
}

export function isStory(r: Rec): boolean {
  return r.type === AUX && tag(r.data, TAG_AT) === STORY_TAG;
}

export function isStoryList(r: Rec): boolean {
  return r.type === AUX && tag(r.data, TAG_AT) === STORY_LIST_TAG;
}

/** The node at `at`, every byte to its end accounted for; null when it isn't one. */
function readNode(d: Uint8Array, at: number, limit: number): Node | null {
  if (at + 6 > limit) return null;
  const kind = u16(d, at);
  const end = at + u32(d, at + 2);
  if (end < at + 10 || end > limit) return null;
  const fields: Uint8Array[] = [];
  let p = at + 6;
  while (p + 4 <= end && u32(d, p) !== 0) {
    const n = u32(d, p);
    if (p + 4 + n > end) return null;
    fields.push(d.subarray(p + 4, p + 4 + n));
    p += 4 + n;
  }
  if (p + 4 > end) return null;
  p += 4;
  const kids: Node[] = [];
  while (p < end) {
    const c = readNode(d, p, end);
    if (!c) return null;
    kids.push(c);
    p += u32(d, p + 2);
  }
  return { kind, fields, kids };
}

function writeNode(n: Node): Uint8Array {
  const parts: Uint8Array[] = [new Uint8Array(6)];
  for (const f of n.fields) {
    const len = new Uint8Array(4);
    setU32(len, 0, f.length);
    parts.push(len, f);
  }
  parts.push(new Uint8Array(4));
  for (const k of n.kids) parts.push(writeNode(k));
  const out = concat(parts);
  out[0] = n.kind & 0xff;
  out[1] = n.kind >>> 8;
  setU32(out, 2, out.length);
  return out;
}

/** The story's tree, its node, its levels' node and where the tree ends; null when it can't be read. */
function parse(d: Uint8Array): { root: Node; story: Node; levels: Node | null; end: number } | null {
  if (d.length < ROOT + 10) return null;
  const end = ROOT + u32(d, ROOT + 2);
  const root = readNode(d, ROOT, d.length);
  const story = root?.kids[0];
  if (!root || !story || root.kids.length !== 1 || story.fields.length <= S_ELEVATION || story.fields[S_ELEVATION].length !== 8) return null;
  if (text(story.fields[S_SUFFIX]) === null) return null;
  const levels = story.kids.find((k) => k.kind === LEVELS) ?? null;
  for (const l of levels?.kids ?? []) {
    if (l.fields.length <= L_LAYER || text(l.fields[L_TYPE]) === null || l.fields[L_ELEVATION].length !== 8 || text(l.fields[L_LAYER]) === null) return null;
  }
  return { root, story, levels, end };
}

/** A string field's text, or null when it isn't one. */
function text(b: Uint8Array | undefined): string | null {
  if (!b || b.length < 4 || b.length % 2 || b[0] !== 0xff || b[1] !== 0xfe || b[b.length - 1] || b[b.length - 2]) return null;
  let s = "";
  for (let i = 2; i + 3 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8));
  return s;
}

function textField(s: string): Uint8Array {
  return concat([Uint8Array.of(0xff, 0xfe), encodeUtf16(s), new Uint8Array(2)]);
}

function f64Field(v: number): Uint8Array {
  const b = new Uint8Array(8);
  setF64(b, 0, v);
  return b;
}

function u32Field(v: number): Uint8Array {
  const b = new Uint8Array(4);
  setU32(b, 0, v);
  return b;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The story a record holds, or null when it can't be read. */
export function readStory(d: Uint8Array): Story | null {
  const t = parse(d);
  if (!t) return null;
  return {
    suffix: text(t.story.fields[S_SUFFIX])!,
    elevation: f64(t.story.fields[S_ELEVATION], 0),
    levels: (t.levels?.kids ?? []).map((l) => ({
      type: text(l.fields[L_TYPE])!,
      elevation: f64(l.fields[L_ELEVATION], 0),
      layer: text(l.fields[L_LAYER])!,
    })),
  };
}

/** The story record with `change` made, or the same data when nothing changes. */
export function writeStory(d: Uint8Array, change: StoryChange): Uint8Array {
  const t = parse(d);
  if (!t) throw new Error("a story record can't be read");
  let changed = false;
  const set = (fields: Uint8Array[], i: number, b: Uint8Array): void => {
    if (fields[i].length === b.length && fields[i].every((v, k) => v === b[k])) return;
    fields[i] = b;
    changed = true;
  };
  if (change.suffix !== undefined) set(t.story.fields, S_SUFFIX, textField(change.suffix));
  if (change.elevation !== undefined) set(t.story.fields, S_ELEVATION, f64Field(change.elevation));
  if (change.levels && (t.levels || change.levels.length)) {
    let levels = t.levels;
    if (!levels) {
      levels = { kind: LEVELS, fields: [u32Field(0)], kids: [] };
      t.story.kids.push(levels);
    }
    const before = writeNode(levels);
    const old = levels.kids;
    const ids = old.map((l) => (l.fields[L_ID]?.length === 4 ? u32(l.fields[L_ID], 0) : -1));
    let next = Math.max(-1, ...ids) + 1;
    levels.kids = change.levels.map((v, i) => {
      const was = v.from === undefined ? undefined : old[v.from];
      if (v.from !== undefined && !was) throw new Error(`the story has no level #${v.from}`);
      const fields = was ? [...was.fields] : [new Uint8Array(0), new Uint8Array(0), new Uint8Array(0), u32Field(next++), u32Field(0), u32Field(0)];
      fields[L_TYPE] = textField(v.type);
      fields[L_ELEVATION] = f64Field(v.elevation);
      fields[L_LAYER] = textField(v.layer);
      // levels are numbered by their place
      return { kind: i, fields, kids: was?.kids ?? [] };
    });
    levels.fields[0] = u32Field(levels.kids.length);
    if (!same(before, writeNode(levels))) changed = true;
  }
  for (const l of t.levels?.kids ?? []) {
    const layer = text(l.fields[L_LAYER])!;
    const to = change.layers?.get(layer);
    if (to !== undefined && layer !== "") set(l.fields, L_LAYER, textField(to));
  }
  if (!changed) return d;
  const out = concat([d.subarray(0, ROOT), writeNode(t.root), d.subarray(t.end)]);
  setU64(out, 0, BigInt(out.length));
  return out;
}

/** True when the record's tree writes back byte for byte (what writeStory relies on). */
export function storyRoundTrips(d: Uint8Array): boolean {
  const t = parse(d);
  if (!t) return false;
  const again = writeNode(t.root);
  return again.length === t.end - ROOT && again.every((v, i) => v === d[ROOT + i]);
}

/**
 * A new story with no levels: the header of `like` (another story, or the story list), then the
 * tag and the tree. The caller sets its name, owner, next mark and GUID.
 */
export function newStory(like: Uint8Array, suffix: string, elevation: number): Uint8Array {
  const count = new Uint8Array(4);
  const tree = writeNode({
    kind: 0,
    fields: [],
    kids: [{ kind: STORY_NODE, fields: [textField(suffix), f64Field(elevation)], kids: [{ kind: LEVELS, fields: [count], kids: [] }] }],
  });
  const d = concat([like.subarray(0, TAG_AT), Uint8Array.from(STORY_TAG, (c) => c.charCodeAt(0)), tree]);
  setU64(d, 0, BigInt(d.length));
  return d;
}
