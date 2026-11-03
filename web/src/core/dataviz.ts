// Data visualisations: named rules that redraw the objects matching some
// criteria with other fills and pens, which a viewport applies to its drawing.
//
// They live in one type-76 record tagged "rOSC" at +0x50, as a tree from +0x54.
// A node is u16 kind, u32 length (from the node's start), then fields until a
// u32 0, then child nodes to its end. A field is u32 length and the bytes;
// strings are FF FE, UTF-16LE and 00 00. Under the root's first child, kind-1
// nodes are the visualisations: [0] GUID (as text, 8-4-4-4-12 hex digits),
// [1] name, [2] what the values are ("" every object, "C" class, "MATERIAL",
// "OSTYLE" object style), [14] the criteria. Their kind-0 children are the values:
// [1] enabled, [3] the value ("<All Objects>", a class name, ...), [7] fill
// (0 none, 1 solid, 2 pattern, 3 hatch, 7 unchanged), [8] [9] fill fore and
// back colours as "r,g,b" (a solid fill is [9]), [14] the pattern's index,
// [16] pen (0 none, 1 solid, 3 line type, 4 unchanged), [17] its colour,
// [27] the hatch's name, [28] the line type's.
//
// Criteria are u16 tokens in postfix; a 0 token is followed by a NUL-ended
// UTF-16 string. A test is a field (0x328 plug-in name, 0x305 layer, 0x306
// class, 0x332 story, 0x327 object type), the operator (0x65b "=", 0x2a3 for
// classes), a name index, then the name; 0x647 ends it, 0x648 ORs the two
// before. The object type test takes one u16 instead. Tokens around them set
// where it looks (symbols, plug-ins, viewports) and are not read.
//
// A viewport lists the ones it applies in a TDMD record of kind "cSCV": key 2
// holds their GUIDs, 16 bytes each in the order the string writes them.

import { u16, u32 } from "./bytes.ts";
import type { Rec } from "./records.ts";

const AUX = 76;
const AUX_TAG = 0x50;
const ROOT = 0x54;
const VIZ_NODE = 1;
const VALUE_NODE = 0;

const F_GUID = 0;
const F_NAME = 1;
const F_BY = 2;
const F_CRITERIA = 14;
const V_ENABLED = 1;
const V_VALUE = 3;
const V_FILL = 7;
const V_FILL_FORE = 8;
const V_FILL_BACK = 9;
const V_PATTERN = 14;
const V_PEN = 16;
const V_PEN_COLOR = 17;
const V_HATCH = 27;
const V_LINE_TYPE = 28;

const T_STRING = 0;
const T_PLUGIN = 0x328;
const T_LAYER = 0x305;
const T_CLASS = 0x306;
const T_STORY = 0x332;
const T_TYPE = 0x327;
const T_EQUALS = 0x65b;
const T_CLASS_IS = 0x2a3;
const T_OR = 0x648;

const TDMD = "TDMD";
const TDMD_KIND = 0x56;
const TDMD_DIR = 0x5a;
const TDMD_BASE = 0x60;
const VIZ_LIST_KIND = "cSCV";
const VIZ_LIST_KEY = 2;
const GUID_SIZE = 16;

/** The value that every object takes in a visualisation of everything. */
export const ALL_OBJECTS = "<All Objects>";

/** DataViz.by for values by material and by object style. */
export const MATERIAL = "MATERIAL";
export const OBJECT_STYLE = "OSTYLE";

/** What a visualisation's tests look at. */
export type VizField = "plugin" | "layer" | "class" | "story" | "type";

/**
 * The object type codes type tests name, by the record type each means. 509 is the slab (71): the
 * floor finish visualisations test for it beside the Slab plug-in, and list the sloped roof slabs'
 * styles among their values.
 */
const TEST_TYPES: ReadonlyMap<number, number> = new Map([[509, 71]]);

export type VizCriteria = { test: VizField; value: string } | { or: [VizCriteria, VizCriteria] } | { and: VizCriteria[] };

/** How a value redraws an object; a part left out stays as the object has it. Colours are CSS. */
export interface VizStyle {
  fill?:
    | { kind: "none" }
    | { kind: "solid"; color: string }
    | { kind: "pattern"; index: number; fore: string; back: string }
    | { kind: "hatch"; name: string };
  pen?: { kind: "none" } | { kind: "solid"; color: string } | { kind: "line-type"; name: string; color: string };
}

export interface DataViz {
  guid: string;
  name: string;
  /** what the values are: "" every object, "C" class name, "MATERIAL", "OSTYLE" (object style) */
  by: string;
  /** null matches every object */
  criteria: VizCriteria | null;
  /** the enabled values, by value */
  values: Map<string, VizStyle>;
}

interface Node {
  kind: number;
  fields: Uint8Array[];
  kids: Node[];
}

/** The document's data visualisations by GUID (empty when it has none, or they can't be read). */
export function readDataViz(recs: Iterable<Rec>): Map<string, DataViz> {
  const out = new Map<string, DataViz>();
  for (const r of recs) {
    if (r.type !== AUX || tag(r.data, AUX_TAG) !== "rOSC") continue;
    const root = readNode(r.data, ROOT, r.data.length);
    for (const n of root?.kids[0]?.kids ?? []) {
      if (n.kind !== VIZ_NODE || n.fields.length <= F_CRITERIA) continue;
      const viz: DataViz = {
        guid: text(n.fields[F_GUID]),
        name: text(n.fields[F_NAME]),
        by: text(n.fields[F_BY]),
        criteria: readCriteria(n.fields[F_CRITERIA]),
        values: new Map(),
      };
      for (const v of n.kids) {
        if (v.kind !== VALUE_NODE || v.fields.length <= V_LINE_TYPE || v.fields[V_ENABLED][0] !== 1) continue;
        viz.values.set(text(v.fields[V_VALUE]), readStyle(v.fields));
      }
      out.set(viz.guid, viz);
    }
  }
  return out;
}

/** GUIDs of the visualisations a viewport applies, in its order. */
export function viewportDataViz(viewport: Rec): string[] {
  for (const c of viewport.children) {
    const d = c.data;
    if (c.type !== AUX || d.length < TDMD_BASE || tag(d, AUX_TAG) !== TDMD || tag(d, TDMD_KIND) !== VIZ_LIST_KIND) continue;
    const n = u16(d, TDMD_DIR);
    for (let i = 0; i < n && TDMD_BASE + 6 * i + 6 <= d.length; i++) {
      if (u16(d, TDMD_BASE + 6 * i) !== VIZ_LIST_KEY) continue;
      const at = TDMD_BASE + u32(d, TDMD_BASE + 6 * i + 2);
      if (at + 6 > d.length) return [];
      const size = u32(d, at + 2);
      const out: string[] = [];
      for (let p = at + 6; p + GUID_SIZE <= Math.min(d.length, at + 6 + size); p += GUID_SIZE) out.push(guidString(d, p));
      return out;
    }
  }
  return [];
}

/** What an object is tested on: `type` is its record type, `story` its layer's story, if any. */
export interface VizSubject {
  plugin: string | null;
  layer: string;
  story: string | null;
  className: string;
  type: number;
}

export function vizMatches(c: VizCriteria | null, o: VizSubject): boolean {
  if (!c) return true;
  if ("or" in c) return vizMatches(c.or[0], o) || vizMatches(c.or[1], o);
  if ("and" in c) return c.and.every((x) => vizMatches(x, o));
  switch (c.test) {
    case "plugin":
      return o.plugin === c.value;
    case "layer":
      return o.layer === c.value;
    case "class":
      return o.className === c.value;
    case "story":
      return o.story === c.value;
    case "type":
      return TEST_TYPES.get(Number(c.value)) === o.type;
    default:
      return false;
  }
}

function readCriteria(b: Uint8Array): VizCriteria | null {
  const stack: VizCriteria[] = [];
  const word = (i: number) => (i + 1 < b.length ? u16(b, i) : -1);
  const fields = new Map<number, VizField>([
    [T_PLUGIN, "plugin"],
    [T_LAYER, "layer"],
    [T_CLASS, "class"],
    [T_STORY, "story"],
  ]);
  let i = 0;
  while (i + 1 < b.length) {
    const t = word(i);
    i += 2;
    const field = fields.get(t);
    if (field && (word(i) === T_EQUALS || word(i) === T_CLASS_IS) && word(i + 4) === T_STRING) {
      // operator, name index, then the name
      i += 6;
      let value = "";
      for (let ch = word(i); ch > 0; ch = word(i)) {
        value += String.fromCharCode(ch);
        i += 2;
      }
      i += 2;
      stack.push({ test: field, value });
    } else if (t === T_TYPE) {
      stack.push({ test: "type", value: String(word(i)) });
      i += 2;
    } else if (t === T_OR && stack.length >= 2) {
      const b2 = stack.pop()!;
      const a = stack.pop()!;
      stack.push({ or: [a, b2] });
    } else if (t === T_STRING) {
      // a string the tests above don't take: skip it
      while (word(i) > 0) i += 2;
      i += 2;
    }
  }
  return stack.length === 0 ? null : stack.length === 1 ? stack[0] : { and: stack };
}

function readStyle(f: Uint8Array[]): VizStyle {
  const style: VizStyle = {};
  const fill = int(f[V_FILL]);
  if (fill === 0) style.fill = { kind: "none" };
  else if (fill === 1) style.fill = { kind: "solid", color: css(f[V_FILL_BACK]) };
  else if (fill === 2) style.fill = { kind: "pattern", index: int(f[V_PATTERN]), fore: css(f[V_FILL_FORE]), back: css(f[V_FILL_BACK]) };
  // a hatch draws in its own colours; [8] and [9] copy them
  else if (fill === 3) style.fill = { kind: "hatch", name: text(f[V_HATCH]) };
  const pen = int(f[V_PEN]);
  if (pen === 0) style.pen = { kind: "none" };
  else if (pen === 1) style.pen = { kind: "solid", color: css(f[V_PEN_COLOR]) };
  else if (pen === 3) style.pen = { kind: "line-type", name: text(f[V_LINE_TYPE]), color: css(f[V_PEN_COLOR]) };
  return style;
}

function readNode(d: Uint8Array, at: number, limit: number): Node | null {
  if (at + 6 > limit) return null;
  const kind = u16(d, at);
  const end = at + u32(d, at + 2);
  if (end <= at + 6 || end > limit) return null;
  const fields: Uint8Array[] = [];
  let p = at + 6;
  while (p + 4 <= end && u32(d, p) !== 0) {
    const n = u32(d, p);
    if (p + 4 + n > end) return null;
    fields.push(d.subarray(p + 4, p + 4 + n));
    p += 4 + n;
  }
  p += 4;
  const kids: Node[] = [];
  while (p + 6 <= end) {
    const c = readNode(d, p, end);
    if (!c) break;
    kids.push(c);
    p += u32(d, p + 2);
  }
  return { kind, fields, kids };
}

function tag(d: Uint8Array, at: number): string {
  return d.length < at + 4 ? "" : String.fromCharCode(d[at], d[at + 1], d[at + 2], d[at + 3]);
}

/** A string field: FF FE, UTF-16LE, 00 00 ("" when it isn't one). */
function text(b: Uint8Array | undefined): string {
  if (!b || b.length < 4 || b[0] !== 0xff || b[1] !== 0xfe) return "";
  let s = "";
  for (let i = 2; i + 3 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8));
  return s;
}

/** A 1, 2 or 4 byte integer field. */
function int(b: Uint8Array | undefined): number {
  if (!b) return -1;
  if (b.length === 1) return b[0];
  if (b.length === 2) return u16(b, 0);
  return b.length === 4 ? u32(b, 0) : -1;
}

/** "r,g,b" as CSS hex. */
function css(b: Uint8Array | undefined): string {
  const [r, g, bl] = text(b)
    .split(",")
    .map((s) => Math.max(0, Math.min(255, Number(s) || 0)));
  return `#${[r ?? 0, g ?? 0, bl ?? 0].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function guidString(d: Uint8Array, at: number): string {
  const h = Array.from(d.subarray(at, at + GUID_SIZE), (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
