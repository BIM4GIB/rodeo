// Select by Query: one line that says which objects to select. Grammar:
//
//   <kind> [where <cond> ((and | or) <cond>)*] [on <layer name> | on all]
//   cond  = <field> <op> <value>
//   op    = = | != | > | < | >= | <= | contains | startswith
//
// `and` binds tighter than `or`. Kinds: objects, lines, rectangles, polygons,
// polylines, arcs (circles, ovals), text, images, groups, symbols, other, or a
// plug-in's name (walls, doors, windows: singular or plural). Fields: kind, class,
// layer, name, text, symbol, linetype, fill, pen, lineweight, width, height, area,
// length, x, y, and record.<Field> or record.<Format>.<Field> for plug-in parameters
// and attached records. Lengths are millimetres: a bare number, or 500mm, 30cm, 1.5m.
// Areas are square millimetres: 10m2, 500mm2, 3cm2. x and y are the centre of the
// object's bounds. Colours are a name, a #rrggbb value or a palette index. Quote a
// value with spaces: "Ground Floor". Objects are the drawing's real objects, not the
// parts inside symbol instances (select the instance to reach them). Pure: no DOM.

import type { BBox, ObjectInfo, ObjectRecord, RecordValue, Shape, VwxDocument } from "../../core/index.ts";
import { arcRadii, isClosedShape, isFullArc, shapeBBox } from "../../app/shapes.ts";
import { dist, unionBBox } from "../../app/geom.ts";
import { isDerivedId, namesOf } from "./describe.ts";

export type Op = "=" | "!=" | ">" | "<" | ">=" | "<=" | "contains" | "startswith";

/** The fields a condition can name; `record` is written record.<Field> or record.<Format>.<Field>. */
export type Field =
  | "kind"
  | "class"
  | "layer"
  | "name"
  | "text"
  | "symbol"
  | "linetype"
  | "fill"
  | "pen"
  | "lineweight"
  | "width"
  | "height"
  | "area"
  | "length"
  | "x"
  | "y"
  | "record";

type FieldType = "text" | "colour" | "length" | "area" | "record";

const FIELD_TYPES: Readonly<Record<Exclude<Field, "record">, FieldType>> = {
  kind: "text",
  class: "text",
  layer: "text",
  name: "text",
  text: "text",
  symbol: "text",
  linetype: "text",
  fill: "colour",
  pen: "colour",
  lineweight: "length",
  width: "length",
  height: "length",
  length: "length",
  x: "length",
  y: "length",
  area: "area",
};

/** The field names as the help lists them. */
export const FIELD_LIST = "kind, class, layer, name, text, symbol, linetype, fill, pen, lineweight, width, height, area, length, x, y, record.Name";

/** A value as typed: its text, and its number in millimetres (or square millimetres) when it has one. */
export interface Value {
  readonly text: string;
  readonly num: number | null;
  readonly pos: number;
}

export interface Comparison {
  readonly type: "cmp";
  readonly field: Field;
  /** record fields: the format's name, or null for any format */
  readonly format: string | null;
  /** record fields: the field's name */
  readonly sub: string;
  readonly op: Op;
  readonly value: Value;
  readonly pos: number;
}

export interface Junction {
  readonly type: "and" | "or";
  readonly items: readonly Condition[];
}

export type Condition = Comparison | Junction;

export interface Query {
  /** the kind word as typed */
  readonly kind: string;
  readonly where: Condition | null;
  /** the layer's name, or null for every layer */
  readonly layer: string | null;
  readonly layerPos: number;
}

export interface ParseError {
  readonly error: string;
  /** index in the text where the problem starts */
  readonly pos: number;
}

export type Parsed = { readonly ok: true; readonly query: Query } | ({ readonly ok: false } & ParseError);

// ---- lexing -------------------------------------------------------------------

type TokKind = "word" | "string" | "op" | "end";

interface Tok {
  readonly kind: TokKind;
  readonly text: string;
  readonly pos: number;
}

const OPS: readonly string[] = ["!=", ">=", "<=", "=", ">", "<"];
const KEYWORDS = new Set(["where", "on", "and", "or"]);

function lex(src: string): Tok[] | ParseError {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      const close = src.indexOf('"', i + 1);
      if (close === -1) return { error: "A quoted value needs a closing quote.", pos: i };
      out.push({ kind: "string", text: src.slice(i + 1, close), pos: i });
      i = close + 1;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ kind: "op", text: op, pos: i });
      i += op.length;
      continue;
    }
    let j = i;
    while (j < src.length && !/\s/.test(src[j]) && src[j] !== '"' && !"=!<>".includes(src[j])) j++;
    if (j === i) return { error: `Unexpected "${c}".`, pos: i };
    out.push({ kind: "word", text: src.slice(i, j), pos: i });
    i = j;
  }
  out.push({ kind: "end", text: "", pos: src.length });
  return out;
}

// ---- parsing ------------------------------------------------------------------

type Fail = ParseError;
const isFail = (x: unknown): x is Fail => typeof x === "object" && x !== null && "error" in x;

const NUMBER = /^(-?(?:\d+\.?\d*|\.\d+))(mm2|cm2|m2|mm|cm|m)?$/i;
/** multipliers to millimetres (and to square millimetres for the squared units) */
const UNIT_MM: Readonly<Record<string, number>> = { "": 1, mm: 1, cm: 10, m: 1000, mm2: 1, cm2: 100, m2: 1e6 };

function isKeyword(t: Tok, ...words: string[]): boolean {
  return t.kind === "word" && words.includes(t.text.toLowerCase());
}

function parseValue(t: Tok, type: FieldType): Value | Fail {
  if (t.kind === "end") return { error: "Add a value after the operator.", pos: t.pos };
  if (t.kind === "op" || isKeyword(t, "and", "or", "on", "where")) {
    return { error: "Add a value after the operator.", pos: t.pos };
  }
  if (t.kind === "string") return { text: t.text, num: null, pos: t.pos };
  const norm = t.text.replace(/²/g, "2");
  const m = NUMBER.exec(norm);
  const unit = (m?.[2] ?? "").toLowerCase();
  if (m && type !== "text" && type !== "colour") {
    const num = Number.parseFloat(m[1]) * UNIT_MM[unit];
    if (type === "length" && unit.endsWith("2")) {
      return { error: `Lengths take mm, cm or m, such as 500, 30cm or 1.5m.`, pos: t.pos };
    }
    if (type === "area" && unit !== "" && !unit.endsWith("2")) {
      return { error: `Areas take square units, such as 10m2 or 500mm2.`, pos: t.pos };
    }
    return { text: t.text, num, pos: t.pos };
  }
  // a number in a text field, or a plain word: its text is what is compared
  const num = m ? Number.parseFloat(m[1]) * UNIT_MM[unit] : null;
  return { text: t.text, num, pos: t.pos };
}

const TEXT_OPS: readonly Op[] = ["=", "!=", ">", "<", ">=", "<=", "contains", "startswith"];
const NUMBER_OPS: readonly Op[] = ["=", "!=", ">", "<", ">=", "<="];
const COLOUR_OPS: readonly Op[] = ["=", "!=", "contains", "startswith"];

function opsFor(field: Field): readonly Op[] {
  if (field === "record") return TEXT_OPS;
  const type = FIELD_TYPES[field];
  if (type === "length" || type === "area") return NUMBER_OPS;
  if (type === "colour") return COLOUR_OPS;
  return TEXT_OPS;
}

/** Parses the field token: a field name, or record.Name / record.Format.Name. */
function parseField(t: Tok): { field: Field; format: string | null; sub: string } | Fail {
  if (t.kind !== "word") return { error: `Expected a field such as ${FIELD_LIST}.`, pos: t.pos };
  if (KEYWORDS.has(t.text.toLowerCase())) return { error: `Expected a field, not "${t.text}".`, pos: t.pos };
  const parts = t.text.split(".");
  const base = parts[0].toLowerCase();
  if (base === "record") {
    if (parts.length < 2 || parts.length > 3 || parts[parts.length - 1] === "") {
      return { error: "Name the record field, such as record.Width or record.Door.Width.", pos: t.pos };
    }
    return parts.length === 2
      ? { field: "record", format: null, sub: parts[1] }
      : { field: "record", format: parts[1], sub: parts[2] };
  }
  if (parts.length === 1 && base in FIELD_TYPES) return { field: base as Field, format: null, sub: "" };
  return { error: `"${t.text}" is not a field. Try ${FIELD_LIST}.`, pos: t.pos };
}

/** The operator a token names (symbols, or the words contains and startswith), or null. */
function parseOp(t: Tok, word: string): Op | null {
  if (t.kind === "op") return OPS.find((o) => o === t.text) ? (t.text as Op) : null;
  return word === "contains" || word === "startswith" ? word : null;
}

function parseComparison(p: Parser): Condition | Fail {
  const ft = p.take();
  if (ft.kind === "end") return { error: "Add a condition after where, such as name = \"Door\".", pos: ft.pos };
  const f = parseField(ft);
  if (isFail(f)) return f;
  const ot = p.take();
  const opWord = ot.kind === "word" ? ot.text.toLowerCase() : "";
  const op = parseOp(ot, opWord);
  if (op === null) {
    const msg = ot.kind === "end" ? "Add an operator after the field: = != > < >= <= contains startswith." : `Expected an operator, not "${ot.text}".`;
    return { error: msg, pos: ot.pos };
  }
  if (!opsFor(f.field).includes(op)) {
    const type = f.field === "record" ? "text" : FIELD_TYPES[f.field];
    const hint =
      type === "colour"
        ? "Colours compare with =, !=, contains or startswith."
        : type === "length" || type === "area"
          ? "Measurements compare with =, !=, >, <, >= or <=."
          : "This field does not take that operator.";
    return { error: hint, pos: ot.pos };
  }
  const vt = p.take();
  const type: FieldType = f.field === "record" ? "record" : FIELD_TYPES[f.field];
  const value = parseValue(vt, type);
  if (isFail(value)) return value;
  if ((type === "length" || type === "area") && value.num === null) {
    return { error: type === "length" ? "Give a length, such as 500, 30cm or 1.5m." : "Give an area, such as 10m2 or 500mm2.", pos: vt.pos };
  }
  return { type: "cmp", field: f.field, format: f.format, sub: f.sub, op, value, pos: ft.pos };
}

function parseAnd(p: Parser): Condition | Fail {
  const first = parseComparison(p);
  if (isFail(first)) return first;
  const items: Condition[] = [first];
  while (isKeyword(p.peek(), "and")) {
    p.take();
    const next = parseComparison(p);
    if (isFail(next)) return next;
    items.push(next);
  }
  return items.length === 1 ? first : { type: "and", items };
}

function parseOr(p: Parser): Condition | Fail {
  const first = parseAnd(p);
  if (isFail(first)) return first;
  const items: Condition[] = [first];
  while (isKeyword(p.peek(), "or")) {
    p.take();
    const next = parseAnd(p);
    if (isFail(next)) return next;
    items.push(next);
  }
  return items.length === 1 ? first : { type: "or", items };
}

class Parser {
  private i = 0;
  constructor(private readonly toks: readonly Tok[]) {}
  peek(): Tok {
    return this.toks[this.i];
  }
  take(): Tok {
    const t = this.toks[this.i];
    if (t.kind !== "end") this.i++;
    return t;
  }
}

/** Parses a query. Errors carry the index where the problem starts, for the message's position. */
export function parseQuery(src: string): Parsed {
  const lexed = lex(src);
  if (!Array.isArray(lexed)) return { ok: false, ...lexed };
  const p = new Parser(lexed);
  const head = p.take();
  if (head.kind === "end") return { ok: false, error: "Say what to select: objects, lines, text, symbols or a plug-in such as walls.", pos: 0 };
  if (head.kind !== "word" || KEYWORDS.has(head.text.toLowerCase())) {
    return { ok: false, error: `Start with what to select, such as objects, lines or text, not "${head.text}".`, pos: head.pos };
  }
  let where: Condition | null = null;
  if (isKeyword(p.peek(), "where")) {
    const whereTok = p.take();
    if (p.peek().kind === "end") return { ok: false, error: "Add a condition after where.", pos: whereTok.pos };
    const cond = parseOr(p);
    if (isFail(cond)) return { ok: false, ...cond };
    where = cond;
  }
  let layer: string | null = null;
  let layerPos = -1;
  if (isKeyword(p.peek(), "on")) {
    const onTok = p.take();
    const t = p.peek();
    if (t.kind === "end") return { ok: false, error: "Name a layer after on, or write on all.", pos: onTok.pos };
    layerPos = t.pos;
    if (t.kind === "string") {
      p.take();
      layer = t.text;
    } else {
      const words: string[] = [];
      while (p.peek().kind === "word") words.push(p.take().text);
      layer = words.join(" ");
    }
    if (layer.toLowerCase() === "all") layer = null;
  }
  const rest = p.peek();
  if (rest.kind !== "end") {
    return { ok: false, error: `Unexpected "${rest.text}". Use where, on, and or or.`, pos: rest.pos };
  }
  return { ok: true, query: { kind: head.text, where, layer, layerPos } };
}

// ---- evaluation ---------------------------------------------------------------

/** Words for kinds of object; anything else is a plug-in's name. */
const KIND_WORDS: Readonly<Record<string, ObjectInfo["kind"] | "any">> = {
  object: "any",
  thing: "any",
  item: "any",
  line: "line",
  rect: "rect",
  rectangle: "rect",
  polygon: "polygon",
  polyline: "polyline",
  arc: "arc",
  circle: "arc",
  oval: "arc",
  ellipse: "arc",
  text: "text",
  image: "image",
  group: "group",
  symbol: "symbol",
  instance: "symbol",
  other: "other",
};

/** The singular of a word written in the plural ("walls" → "wall", "windows" → "window"). */
export function singularOf(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

interface KindTest {
  match(o: ObjectInfo, records: (o: ObjectInfo) => ObjectRecord[]): boolean;
}

function kindTest(word: string): KindTest {
  const w = word.toLowerCase();
  const kind = KIND_WORDS[w] ?? KIND_WORDS[singularOf(w)];
  if (kind !== undefined) {
    return { match: (o) => kind === "any" || o.kind === kind };
  }
  const single = singularOf(w);
  return {
    match: (o, records) =>
      o.typeName.toLowerCase() === single ||
      records(o).some((r) => {
        const name = r.name.toLowerCase();
        return name === single || name === w;
      }),
  };
}

interface Env {
  bounds(o: ObjectInfo): BBox | null;
  area(o: ObjectInfo): number | null;
  length(o: ObjectInfo): number | null;
  records(o: ObjectInfo): ObjectRecord[];
  layerName(id: string): string;
  symbolName(index: number): string;
  lineTypeName(style: number): string;
  colours(index: number): string[];
}

/** Text of a text object's box when the file gave it none: its anchor and an estimate of its size. */
function textBox(shape: Shape): BBox | null {
  const a = shape.anchor;
  if (!a) return null;
  const size = shape.textSize ?? 0;
  const w = (shape.text?.length ?? 0) * size * 0.6;
  return { x0: a.x, y0: a.y, x1: a.x + w, y1: a.y + size };
}

function ownBounds(shape: Shape): BBox | null {
  return shape.kind === "text" ? (shapeBBox(shape) ?? textBox(shape)) : shapeBBox(shape);
}

function shoelace(pts: readonly { x: number; y: number }[]): number {
  let twice = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function ownArea(shape: Shape): number | null {
  if (shape.kind === "arc") {
    const r = arcRadii(shape);
    return r && isFullArc(shape) ? Math.PI * r.rx * r.ry : null;
  }
  if (!isClosedShape(shape) || shape.points.length < 3) return null;
  return shoelace(shape.points);
}

function ownLength(shape: Shape): number | null {
  if (shape.kind === "text" || shape.kind === "image") return null;
  if (shape.kind === "arc") {
    const r = arcRadii(shape);
    if (!r) return null;
    const sweep = isFullArc(shape) ? 2 * Math.PI : (Math.abs(shape.sweepAngle ?? 0) * Math.PI) / 180;
    return ((r.rx + r.ry) / 2) * sweep;
  }
  const pts = shape.points;
  if (pts.length < 2) return null;
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++) total += dist(pts[i], pts[i + 1]);
  if (isClosedShape(shape) && pts.length > 2) total += dist(pts[pts.length - 1], pts[0]);
  return total;
}

/** Builds the lookups a run shares: children of each object, names, and memoised bounds, areas, lengths and records. */
function makeEnv(doc: VwxDocument, layerIds: readonly string[]): Env {
  const names = namesOf(doc);
  const kids = new Map<string, ObjectInfo[]>();
  for (const id of layerIds) {
    for (const o of doc.objects(id)) {
      if (o.parentId === null) continue;
      const list = kids.get(o.parentId);
      if (list) list.push(o);
      else kids.set(o.parentId, [o]);
    }
  }
  const childrenOf = (o: ObjectInfo): ObjectInfo[] => kids.get(o.id) ?? [];
  const boxes = new Map<string, BBox | null>();
  const areas = new Map<string, number | null>();
  const lengths = new Map<string, number | null>();
  const recs = new Map<string, ObjectRecord[]>();
  const lineTypes = new Map(doc.lineTypes().map((t) => [t.style, t.name]));
  const colourNames = new Map(doc.colors().map((c) => [c.index, c.name]));

  const sum = (o: ObjectInfo, own: (s: Shape) => number | null, memo: Map<string, number | null>): number | null => {
    const hit = memo.get(o.id);
    if (hit !== undefined) return hit;
    let value = o.shape ? own(o.shape) : null;
    if (value === null) {
      for (const k of childrenOf(o)) {
        const a = sum(k, own, memo);
        if (a !== null) value = (value ?? 0) + a;
      }
    }
    memo.set(o.id, value);
    return value;
  };

  const bounds = (o: ObjectInfo): BBox | null => {
    if (boxes.has(o.id)) return boxes.get(o.id) ?? null;
    let box = o.shape ? ownBounds(o.shape) : null;
    for (const k of childrenOf(o)) box = unionBBox(box, bounds(k));
    boxes.set(o.id, box);
    return box;
  };
  const records = (o: ObjectInfo): ObjectRecord[] => {
    if (isDerivedId(o.id)) return [];
    let list = recs.get(o.id);
    if (!list) {
      list = doc.records(o.id);
      recs.set(o.id, list);
    }
    return list;
  };
  return {
    bounds,
    area: (o) => sum(o, ownArea, areas),
    length: (o) => sum(o, ownLength, lengths),
    records,
    layerName: (id) => names.layers.get(id) ?? "",
    symbolName: (index) => names.symbols.get(index) ?? `Symbol ${index}`,
    lineTypeName: (style) => lineTypes.get(style) ?? "",
    colours(index) {
      const name = colourNames.get(index) ?? "";
      return [name, doc.color(index), String(index)].map((x) => x.toLowerCase()).filter((x) => x !== "");
    },
  };
}

function textMatch(op: Op, values: readonly string[], wanted: string): boolean {
  const v = wanted.toLowerCase();
  const eq = (x: string): boolean => x.toLowerCase() === v;
  switch (op) {
    case "=":
      return values.some(eq);
    case "!=":
      return !values.some(eq);
    case "contains":
      return values.some((x) => x.toLowerCase().includes(v));
    case "startswith":
      return values.some((x) => x.toLowerCase().startsWith(v));
    default:
      return values.some((x) => {
        const c = x.toLowerCase().localeCompare(v);
        return op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : c <= 0;
      });
  }
}

function numMatch(op: Op, a: number, b: number): boolean {
  switch (op) {
    case "=":
      return Math.abs(a - b) < 1e-6;
    case "!=":
      return Math.abs(a - b) >= 1e-6;
    case ">":
      return a > b;
    case "<":
      return a < b;
    case ">=":
      return a >= b - 1e-6;
    case "<=":
      return a <= b + 1e-6;
    default:
      return false;
  }
}

function recordValue(c: Comparison, o: ObjectInfo, env: Env): RecordValue | undefined {
  for (const r of env.records(o)) {
    if (c.format !== null && r.name.toLowerCase() !== c.format.toLowerCase()) continue;
    const f = r.fields.find((x) => x.name.toLowerCase() === c.sub.toLowerCase());
    if (f) return f.value;
  }
  return undefined;
}

function evalComparison(c: Comparison, o: ObjectInfo, env: Env): boolean {
  const v = c.value;
  switch (c.field) {
    case "kind":
      return textMatch(c.op, [o.kind, o.typeName, ...env.records(o).map((r) => r.name)], v.text);
    case "class":
      return textMatch(c.op, [o.className || "None"], v.text);
    case "layer":
      return textMatch(c.op, [env.layerName(o.layerId)], v.text);
    case "name":
      return textMatch(c.op, [o.name ?? ""], v.text);
    case "text":
      return textMatch(c.op, [o.kind === "text" ? (o.shape?.text ?? "") : ""], v.text);
    case "symbol":
      return textMatch(c.op, o.kind === "symbol" && o.symbol !== undefined ? [env.symbolName(o.symbol)] : [], v.text);
    case "linetype": {
      const style = o.attrs?.lineStyle;
      if (style === undefined) return textMatch(c.op, [], v.text);
      const name = style === 0 ? "none" : style > 0 ? "solid" : env.lineTypeName(style);
      return textMatch(c.op, [name], v.text);
    }
    case "fill":
      if (!o.attrs) return textMatch(c.op, [], v.text);
      return textMatch(c.op, o.attrs.fillPattern === 0 ? ["none"] : env.colours(o.attrs.fillFore), v.text);
    case "pen":
      if (!o.attrs) return textMatch(c.op, [], v.text);
      return textMatch(c.op, o.attrs.lineStyle === 0 ? ["none"] : env.colours(o.attrs.penFore), v.text);
    case "lineweight":
      return o.attrs !== null && v.num !== null && numMatch(c.op, o.attrs.lineWeight * 0.0254, v.num);
    case "width":
    case "height":
    case "x":
    case "y": {
      const box = env.bounds(o);
      if (!box || v.num === null) return false;
      const got =
        c.field === "width" ? box.x1 - box.x0 : c.field === "height" ? box.y1 - box.y0 : c.field === "x" ? (box.x0 + box.x1) / 2 : (box.y0 + box.y1) / 2;
      return numMatch(c.op, got, v.num);
    }
    case "area": {
      const a = env.area(o);
      return a !== null && v.num !== null && numMatch(c.op, a, v.num);
    }
    case "length": {
      const l = env.length(o);
      return l !== null && v.num !== null && numMatch(c.op, l, v.num);
    }
    case "record": {
      const got = recordValue(c, o, env);
      if (got === undefined) return false;
      if (typeof got === "number" && v.num !== null && c.op !== "contains" && c.op !== "startswith") {
        return numMatch(c.op, got, v.num);
      }
      const text = typeof got === "string" ? got : String(got);
      return textMatch(c.op, [text], v.text);
    }
  }
}

function evalCondition(cond: Condition, o: ObjectInfo, env: Env): boolean {
  if (cond.type === "cmp") return evalComparison(cond, o, env);
  if (cond.type === "and") return cond.items.every((c) => evalCondition(c, o, env));
  return cond.items.some((c) => evalCondition(c, o, env));
}

/** An object a query selects: its id, its layer, and its bounds (for highlighting). */
export interface QueryHit {
  readonly id: string;
  readonly layerId: string;
  readonly bbox: BBox | null;
}

export interface QueryRun {
  readonly hits: readonly QueryHit[];
  /** the kind word as typed */
  readonly kind: string;
  /** objects of the kind (before the conditions and the visibility test), so a kind the drawing lacks can be told apart */
  readonly kindCount: number;
  /** true when the hits were stopped at the limit */
  readonly capped: boolean;
}

export type Outcome = { readonly ok: true; readonly run: QueryRun } | ({ readonly ok: false } & ParseError);

export interface RunOptions {
  /** objects that can be selected now (layer and class visibility); the others are not hits */
  readonly visible?: (o: ObjectInfo) => boolean;
  /** the most hits kept (default 5000) */
  readonly limit?: number;
}

/** Runs a query over the drawing: the hits in layer order, then object order. */
export function runQuery(doc: VwxDocument, src: string, options: RunOptions = {}): Outcome {
  const parsed = parseQuery(src);
  if (!parsed.ok) return { ok: false, error: parsed.error, pos: parsed.pos };
  const q = parsed.query;
  const layers = doc.layers();
  const scope = q.layer === null ? layers : layers.filter((l) => l.name.toLowerCase() === (q.layer ?? "").toLowerCase());
  if (scope.length === 0) return { ok: false, error: `No layer named "${q.layer}".`, pos: q.layerPos };
  const env = makeEnv(doc, scope.map((l) => l.id));
  const kind = kindTest(q.kind);
  const limit = options.limit ?? 5000;
  const hits: QueryHit[] = [];
  let kindCount = 0;
  let capped = false;
  for (const layer of scope) {
    for (const o of doc.objects(layer.id)) {
      if (isDerivedId(o.id) || !kind.match(o, (x) => env.records(x))) continue;
      kindCount++;
      if (options.visible && !options.visible(o)) continue;
      if (q.where && !evalCondition(q.where, o, env)) continue;
      if (hits.length >= limit) {
        capped = true;
        break;
      }
      hits.push({ id: o.id, layerId: layer.id, bbox: env.bounds(o) });
    }
    if (capped) break;
  }
  return { ok: true, run: { hits, kind: q.kind, kindCount, capped } };
}

