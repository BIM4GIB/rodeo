// ACIS solid data, the reading side. parseAcis takes the bytes of one ACIS model, either SAT text
// (already deciphered, as dxf.ts and dwg.ts give it on Entry.data) or SAB binary, and returns its bodies in the neutral model of
// brep.ts. AutoCAD keeps these bytes in the 3DSOLID, REGION and BODY entities: as ciphered SAT text in
// files up to 2010, and as SAB in the ACDSDATA section of later ones. Each form is first tokenized
// into one list of records (an entity name and the values after it), then one builder walks the
// records from each body down. The field order follows the Spatial SAT and SAB notes as ezdxf (MIT
// licence) reads them: from version 700 every record has an id and a pattern pointer after its
// attribute pointer, and from 500 edges carry their parameters. Cones, spheres, tori and the spline
// and intcurve kinds are read from the same notes; the samples have none of them, so those readers
// are not checked against a file.

import type { BrepBody, BrepCoedge, BrepCurve, BrepEdge, BrepFace, BrepLoop, BrepShell, BrepSurface, V3 } from "./brep.ts";

/**
 * Keywords of SAT text that stand for a flag, with the value SAB writes them as. The flag's value is
 * true for the reversed sense, reverse_v and double-sided, as the SAB tags show (a SAB face that is
 * forward and single is tag 0x0B, the false one, beside the same face written as SAT keywords).
 */
const FLAG_WORDS: ReadonlyMap<string, boolean> = new Map([
  ["reversed", true], ["reverse_v", true], ["double", true], ["out", true], ["T", true], ["yes", true],
  ["forward", false], ["forward_v", false], ["single", false], ["in", false], ["F", false], ["no", false],
]);
/** Records that end the geometry: the end marker, and the history data after it. */
const END_RECORDS: ReadonlySet<string> = new Set(["End-of-ACIS-data", "End-of-ASM-data", "Begin-of-ACIS-History-data"]);
/** From this version on, each record has an id and a pattern pointer after its attribute pointer. */
const ID_FROM = 700;
/** From this version on, edges carry their start and end parameters and a convexity. */
const PARAMS_FROM = 500;
const SAB_SIGNATURE_LENGTH = 15;
const TAU = 2 * Math.PI;

/** Raised for anything in the data this reader does not expect; a body that raises it is skipped. */
class AcisError extends Error {}

/** One value of a record, in the order the file gives it. Both forms tokenize into these. */
type AcisValue =
  /** a pointer to another record by its index, -1 for none */
  | { readonly kind: "ptr"; readonly index: number }
  | { readonly kind: "int"; readonly value: number }
  | { readonly kind: "dbl"; readonly value: number }
  /** a string; SAT writes it as @length text, SAB with a length tag */
  | { readonly kind: "str"; readonly value: string }
  /** a keyword or logical: true for reversed, reverse_v and double, false for their opposites; SAB writes the same bit as tag 0x0A or 0x0B */
  | { readonly kind: "flag"; readonly value: boolean }
  /** a name inside a record, such as a subtype's name (exactsur) */
  | { readonly kind: "word"; readonly value: string }
  | { readonly kind: "open" }
  | { readonly kind: "close" };

interface AcisRecord {
  readonly name: string;
  readonly values: readonly AcisValue[];
}

interface AcisFile {
  readonly form: "sat" | "sab";
  readonly version: number;
  readonly flags: number;
  /** every record in file order; a pointer is an index into this list, attribute records included */
  readonly records: readonly AcisRecord[];
  /** why tokenizing stopped before the end, when it did; the records before it are kept */
  readonly stopped?: string;
}

/** The bodies of one ACIS model, and the bodies that could not be read with the reason for each. */
export interface AcisReport {
  readonly bodies: readonly BrepBody[];
  /** record is the index of the body record, or -1 for a problem with the file as a whole */
  readonly failed: readonly { readonly record: number; readonly reason: string }[];
  /** the form the bytes were in, and the ACIS version from the header (0 when the header would not read) */
  readonly form: "sat" | "sab";
  readonly version: number;
}

/** The bodies of an ACIS model in SAT text or SAB binary form. A body that cannot be read is left out. */
export function parseAcis(data: Uint8Array): BrepBody[] {
  return parseAcisReport(data).bodies.slice();
}

/** As parseAcis, and also says which bodies failed and why. */
export function parseAcisReport(data: Uint8Array): AcisReport {
  const form = isBinary(data) ? "sab" : "sat";
  let file: AcisFile;
  try {
    file = form === "sab" ? tokenizeSab(data) : tokenizeSat(data);
  } catch (error) {
    return { bodies: [], failed: [{ record: -1, reason: messageOf(error) }], form, version: 0 };
  }
  const bodies: BrepBody[] = [];
  const failed: { record: number; reason: string }[] = [];
  if (file.stopped !== undefined) failed.push({ record: -1, reason: file.stopped });
  file.records.forEach((rec, index) => {
    if (rec.name !== "body") return;
    try {
      bodies.push(new Reader(file).body(index));
    } catch (error) {
      failed.push({ record: index, reason: messageOf(error) });
    }
  });
  return { bodies, failed, form, version: file.version };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * True when the bytes open with an ACIS or ASM binary signature. The 2018 DWG blob in
 * acadsharp/samples/sample_AC1032.dwg opens with ASM BinaryFile4, the Shape Manager fork of the format.
 * Anything else is taken for SAT text.
 */
function isBinary(data: Uint8Array): boolean {
  const head = latin1(data, 0, SAB_SIGNATURE_LENGTH);
  return head.startsWith("ACIS BinaryFile") || head.startsWith("ASM BinaryFile");
}

function latin1(data: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < data.length; i++) out += String.fromCharCode(data[i]);
  return out;
}

// ---- SAT text --------------------------------------------------------------------------------------

/**
 * Tokenizes SAT text. The header is its first line (version, record count, entity count and flags),
 * then the application lines, then the resolution line; records start at the first line that opens with
 * a letter. Each record is a name, then its values, then a "#". Values are $n pointers, numbers, "@n"
 * strings (n characters after a space), I or -I for the infinite bounds, keywords, and braces around
 * a subtype's block.
 */
function tokenizeSat(data: Uint8Array): AcisFile {
  const text = new TextDecoder("latin1").decode(data);
  const lines = text.split("\n");
  const head = lines[0].trim().split(/\s+/).map(Number);
  if (head.length < 4 || head.slice(0, 4).some((n) => !Number.isFinite(n))) throw new AcisError("SAT header line is not four numbers");
  let first = 1;
  while (first < lines.length && !/^\s*[A-Za-z]/.test(lines[first])) first++;
  const source = lines.slice(first).join("\n");

  const records: AcisRecord[] = [];
  const space = /\s*/y;
  const word = /[^\s#{}]+/y;
  const pointer = /\$(-?\d+)/y;
  const stringHead = /@(\d+) /y;
  let at = 0;
  let name: string | undefined;
  let values: AcisValue[] = [];
  let stopped: string | undefined;
  try {
    for (;;) {
      space.lastIndex = at;
      space.exec(source);
      at = space.lastIndex;
      if (at >= source.length) break;
      const c = source[at];
      if (c === "#") {
        if (name !== undefined) records.push({ name, values });
        name = undefined;
        values = [];
        at++;
      } else if (c === "{" || c === "}") {
        values.push({ kind: c === "{" ? "open" : "close" });
        at++;
      } else if (c === "$") {
        pointer.lastIndex = at;
        const m = pointer.exec(source);
        if (!m) throw new AcisError(`bad pointer near ${JSON.stringify(source.slice(at, at + 12))}`);
        values.push({ kind: "ptr", index: Number(m[1]) });
        at = pointer.lastIndex;
      } else if (c === "@") {
        stringHead.lastIndex = at;
        const m = stringHead.exec(source);
        if (!m) throw new AcisError(`bad string near ${JSON.stringify(source.slice(at, at + 12))}`);
        const start = stringHead.lastIndex;
        const length = Number(m[1]);
        values.push({ kind: "str", value: source.slice(start, start + length) });
        at = start + length;
      } else {
        word.lastIndex = at;
        const m = word.exec(source);
        if (!m) throw new AcisError(`unreadable text near ${JSON.stringify(source.slice(at, at + 12))}`);
        const w = m[0];
        at = word.lastIndex;
        if (name === undefined) {
          if (END_RECORDS.has(w)) break;
          name = w;
        } else {
          values.push(classifySat(w));
        }
      }
    }
    if (name !== undefined && !END_RECORDS.has(name)) records.push({ name, values });
  } catch (error) {
    stopped = messageOf(error);
  }
  return { form: "sat", version: head[0], flags: head[3], records, stopped };
}

/** One SAT word that is not a name: a number, I (infinite), a keyword, or a word kept as it is. */
function classifySat(w: string): AcisValue {
  if (/^[+-]?\d+$/.test(w)) return { kind: "int", value: Number(w) };
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(w)) return { kind: "dbl", value: Number(w) };
  if (w === "I" || w === "+I") return { kind: "dbl", value: Infinity };
  if (w === "-I") return { kind: "dbl", value: -Infinity };
  const flag = FLAG_WORDS.get(w);
  if (flag !== undefined) return { kind: "flag", value: flag };
  return { kind: "word", value: w };
}

// ---- SAB binary ------------------------------------------------------------------------------------

/**
 * Tokenizes SAB. After the 15-byte signature come four int32s (version, record count, entity count and
 * flags), three tagged strings (product, ACIS version, date) and three tagged doubles (the scale in mm
 * per unit, and the two resolutions). Records follow, each opened by its name (tags 0x0E for every part
 * but the last, 0x0D for the last) and closed by tag 0x11. Tags 0x0A and 0x0B are logicals: 0x0A where the
 * sense is reversed, the surface's v is reversed or the face is double-sided, 0x0B for the opposite and for
 * the infinite bounds. Vectors expand to three doubles, as they do in SAT.
 */
function tokenizeSab(data: Uint8Array): AcisFile {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = SAB_SIGNATURE_LENGTH;
  const version = int32();
  int32(); // record count, zero in the files seen
  int32(); // entity count
  const flags = int32();
  for (let i = 0; i < 3; i++) headerString();
  for (let i = 0; i < 3; i++) headerDouble();
  const records: AcisRecord[] = [];
  let stopped: string | undefined;
  try {
    while (at < data.length) {
      const name = nameParts();
      if (END_RECORDS.has(name)) break;
      const values: AcisValue[] = [];
      for (;;) {
        const tag = byte();
        if (tag === 0x11) break;
        values.push(...valueOf(tag));
      }
      records.push({ name, values });
    }
  } catch (error) {
    stopped = messageOf(error);
  }
  return { form: "sab", version, flags, records, stopped };

  function byte(): number {
    if (at >= data.length) throw new AcisError("SAB data ends inside a record");
    return data[at++];
  }
  function int32(): number {
    need(4);
    const v = view.getInt32(at, true);
    at += 4;
    return v;
  }
  function double(): number {
    need(8);
    const v = view.getFloat64(at, true);
    at += 8;
    return v;
  }
  function need(n: number): void {
    if (at + n > data.length) throw new AcisError("SAB data ends early");
  }
  function headerString(): string {
    if (byte() !== 0x07) throw new AcisError("SAB header string tag 7 expected");
    return shortName();
  }
  function headerDouble(): number {
    if (byte() !== 0x06) throw new AcisError("SAB header double tag 6 expected");
    return double();
  }
  /** a record or subtype name: parts with tag 0x0E and a closing part with 0x0D, joined by "-" */
  function nameParts(): string {
    const parts: string[] = [];
    while (at < data.length && data[at] === 0x0e) {
      at++;
      parts.push(shortName());
    }
    if (byte() !== 0x0d) throw new AcisError("SAB name ends without tag 0x0D");
    parts.push(shortName());
    return parts.join("-");
  }
  function shortName(): string {
    const length = byte();
    need(length);
    const s = latin1(data, at, length);
    at += length;
    return s;
  }
  function valueOf(tag: number): AcisValue[] {
    switch (tag) {
      case 0x04:
        return [{ kind: "int", value: int32() }];
      case 0x06:
      case 0x17:
        return [{ kind: "dbl", value: double() }];
      case 0x07:
        return [{ kind: "str", value: shortName() }];
      case 0x08:
      case 0x09: {
        const width = tag === 0x08 ? 2 : 4;
        need(width);
        let length = 0;
        for (let i = 0; i < width; i++) length += data[at + i] * 2 ** (8 * i);
        at += width;
        need(length);
        const s = latin1(data, at, length);
        at += length;
        return [{ kind: "str", value: s }];
      }
      case 0x0a:
        return [{ kind: "flag", value: true }];
      case 0x0b:
        return [{ kind: "flag", value: false }];
      case 0x0c:
        return [{ kind: "ptr", index: int32() }];
      case 0x0d:
      case 0x0e: {
        at--;
        return [{ kind: "word", value: nameParts() }];
      }
      case 0x0f:
        return [{ kind: "open" }];
      case 0x10:
        return [{ kind: "close" }];
      case 0x12: {
        need(4);
        const length = view.getUint32(at, true);
        at += 4;
        need(length);
        const s = latin1(data, at, length);
        at += length;
        return [{ kind: "str", value: s }];
      }
      case 0x13:
      case 0x14:
        return [{ kind: "dbl", value: double() }, { kind: "dbl", value: double() }, { kind: "dbl", value: double() }];
      case 0x15:
        return [{ kind: "int", value: int32() }];
      default:
        throw new AcisError(`unknown SAB tag 0x${tag.toString(16)} at byte ${at - 1}`);
    }
  }
}

// ---- records to model ------------------------------------------------------------------------------

/** Reads the values of one record in order, and checks that each one is the kind its field needs. */
class Fields {
  private at = 0;

  constructor(
    private readonly rec: AcisRecord,
    private readonly form: "sat" | "sab",
  ) {}

  /** How many values of the record are still to read. */
  left(): number {
    return this.rec.values.length - this.at;
  }

  ptr(): number {
    const v = this.take();
    if (v.kind !== "ptr") throw this.wrong("a pointer", v);
    return v.index;
  }

  int(): number {
    const v = this.take();
    if (v.kind !== "int") throw this.wrong("an integer", v);
    return v.value;
  }

  /** An integer that some versions write and others do not: taken only when a pointer follows it. */
  optionalInt(): void {
    const at = this.at;
    if (this.rec.values[at]?.kind === "int" && this.rec.values[at + 1]?.kind === "ptr") this.at++;
  }

  num(): number {
    const v = this.take();
    if (v.kind !== "int" && v.kind !== "dbl") throw this.wrong("a number", v);
    return v.value;
  }

  /** A logical: a keyword, or in the version 106 files of R13 and R14, the integer 0 or 1. */
  flag(): boolean {
    const v = this.take();
    if (v.kind === "int" && (v.value === 0 || v.value === 1)) return v.value === 1;
    if (v.kind !== "flag") throw this.wrong("a flag", v);
    return v.value;
  }

  vec(): V3 {
    return [this.num(), this.num(), this.num()];
  }

  /**
   * One bound of an interval: a number, or the infinite I. In SAT a finite bound is F then its number
   * (F reads as a false flag) and an infinite one is I; in SAB a finite bound is a true logical then
   * its double, and an infinite one a false logical.
   */
  bound(): number {
    const v = this.take();
    if (v.kind === "int" || v.kind === "dbl") return v.value;
    if (v.kind !== "flag") throw this.wrong("an interval bound", v);
    return v.value || this.form === "sat" ? this.num() : Infinity;
  }

  private take(): AcisValue {
    const v = this.rec.values[this.at];
    if (v === undefined) throw new AcisError(`${this.rec.name} has no value ${this.at + 1}`);
    this.at++;
    return v;
  }

  private wrong(what: string, v: AcisValue): AcisError {
    return new AcisError(`${this.rec.name} value ${this.at}: expected ${what}, found ${JSON.stringify(v)}`);
  }
}

/** A surface as its record gives it, in the body's world frame. */
interface SurfaceRead {
  readonly surface: BrepSurface;
}

/** The transform a body is placed by: the 3x3 part (row-major, rows are the images of the axes), its inverse, and the translation. */
interface Placement {
  readonly m: readonly number[];
  readonly inv: readonly number[];
  readonly t: V3;
  /** the cube root of |det m|: the scale a radius is multiplied by */
  readonly scale: number;
}

const IDENTITY: Placement = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], inv: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0], scale: 1 };

/**
 * Builds the model of one body. A body's records are read through pointers, each one checked to be the
 * record name its field needs, so a field read in the wrong order fails the body instead of giving wrong
 * geometry. Records shared by several uses (vertices, edges, surfaces) are read once.
 */
class Reader {
  private place: Placement = IDENTITY;
  private readonly points = new Map<number, V3>();
  private readonly curves = new Map<number, BrepCurve>();
  private readonly surfaces = new Map<number, SurfaceRead>();
  private readonly edges = new Map<number, BrepEdge>();

  constructor(private readonly file: AcisFile) {}

  body(index: number): BrepBody {
    const f = this.open(index, "body", true);
    const lump = f.ptr();
    f.ptr(); // wire
    const transform = f.ptr();
    this.place = transform < 0 ? IDENTITY : this.transform(transform);
    const shells: BrepShell[] = [];
    for (let l = lump; l >= 0; ) {
      const lf = this.open(l, "lump", true);
      const next = lf.ptr();
      for (let s = lf.ptr(); s >= 0; ) {
        const r = this.shell(s);
        shells.push(r.shell);
        s = r.next;
      }
      l = next;
    }
    return { shells };
  }

  /** The fields of a record after its attribute pointer, and after the id and pattern from version 700. */
  private open(index: number, name: string, pattern: boolean): Fields {
    const rec = this.record(index, name);
    const f = new Fields(rec, this.file.form);
    f.ptr(); // attribute, not used
    if (this.file.version >= ID_FROM) {
      f.int();
      if (pattern) f.ptr();
    }
    return f;
  }

  /** The record a pointer names, which must have the name asked for. */
  private record(index: number, name: string): AcisRecord {
    const rec = this.file.records[index];
    if (rec === undefined) throw new AcisError(`pointer ${index} is past the last record`);
    if (rec.name !== name) throw new AcisError(`pointer ${index} is a ${rec.name}, not a ${name}`);
    return rec;
  }

  private transform(index: number): Placement {
    const f = this.open(index, "transform", false);
    const m: number[] = [];
    for (let i = 0; i < 9; i++) m.push(f.num());
    const t: V3 = [f.num(), f.num(), f.num()];
    const inv = invert3(m);
    return { m, inv, t, scale: Math.cbrt(Math.abs(det3(m))) };
  }

  private shell(index: number): { shell: BrepShell; next: number } {
    const f = this.open(index, "shell", true);
    const next = f.ptr();
    const subshell = f.ptr();
    const firstFace = f.ptr();
    if (f.left() > 1) f.ptr(); // wire, which the version 106 files of R13 and R14 do not have
    f.ptr(); // lump
    const faces: BrepFace[] = [];
    const seen = new Set<number>();
    for (let fi = firstFace; fi >= 0; ) {
      const r = this.face(fi);
      faces.push(r.face);
      seen.add(fi);
      fi = r.next;
    }
    if (subshell >= 0) {
      for (const first of this.subshellFaces(subshell, new Set())) {
        for (let fi = first; fi >= 0 && !seen.has(fi); ) {
          const r = this.face(fi);
          faces.push(r.face);
          seen.add(fi);
          fi = r.next;
        }
      }
    }
    return { shell: { faces }, next };
  }

  /**
   * The faces a subshell holds. Its layout is not confirmed, so the faces are found by the pointers the
   * subshell record makes to face records, and to nested subshells, and nothing else is read from it.
   */
  private subshellFaces(index: number, visited: Set<number>): number[] {
    if (visited.has(index)) return [];
    visited.add(index);
    const rec = this.file.records[index];
    if (rec === undefined || rec.name !== "subshell") throw new AcisError(`pointer ${index} is not a subshell`);
    const out: number[] = [];
    for (const v of rec.values) {
      if (v.kind !== "ptr" || v.index < 0) continue;
      const target = this.file.records[v.index];
      if (target?.name === "face") out.push(v.index);
      else if (target?.name === "subshell") out.push(...this.subshellFaces(v.index, visited));
    }
    return out;
  }

  private face(index: number): { face: BrepFace; next: number } {
    const f = this.open(index, "face", true);
    const next = f.ptr();
    const loop = f.ptr();
    f.ptr(); // shell
    f.ptr(); // subshell
    const surface = f.ptr();
    const reversed = f.flag();
    const doubleSided = f.flag();
    if (doubleSided) f.flag(); // containment, in or out, for a face seen from both sides
    if (surface < 0) throw new AcisError(`face ${index} has no surface`);
    const read = this.surfaceOf(surface);
    const loops: BrepLoop[] = [];
    for (let li = loop; li >= 0; ) {
      const r = this.loop(li);
      loops.push(r.loop);
      li = r.next;
    }
    // The face's outward normal runs against the surface's when its sense is reversed. reverse_v does not
    // turn a face over: TS1's planes carry it with loops that run about the stored normal, turned by the
    // sense alone. No other corpus file has reverse_v.
    return { face: { surface: read.surface, reversed, loops, doubleSided }, next };
  }

  private loop(index: number): { loop: BrepLoop; next: number } {
    const f = this.open(index, "loop", true);
    const next = f.ptr();
    const first = f.ptr();
    f.ptr(); // face
    const coedges: BrepCoedge[] = [];
    let c = first;
    for (let guard = 0; ; guard++) {
      if (guard > this.file.records.length) throw new AcisError(`loop ${index} coedges do not close`);
      const r = this.coedge(c);
      coedges.push(r.coedge);
      c = r.next;
      if (c === first) break;
      if (c < 0) throw new AcisError(`loop ${index} coedge ring is open`);
    }
    return { loop: { coedges }, next };
  }

  private coedge(index: number): { coedge: BrepCoedge; next: number } {
    const f = this.open(index, "coedge", true);
    const next = f.ptr();
    f.ptr(); // previous
    f.ptr(); // partner
    const edge = f.ptr();
    const reversed = f.flag();
    f.ptr(); // loop
    f.optionalInt(); // a counter that SAB keeps and SAT does not
    f.ptr(); // pcurve
    return { coedge: { edge: this.edgeOf(edge), reversed }, next };
  }

  private edgeOf(index: number): BrepEdge {
    const known = this.edges.get(index);
    if (known !== undefined) return known;
    const f = this.open(index, "edge", true);
    const startVertex = f.ptr();
    const startParam = this.hasParams() ? f.num() : undefined;
    const endVertex = f.ptr();
    const endParam = this.hasParams() ? f.num() : undefined;
    f.ptr(); // coedge
    const curve = f.ptr();
    const reversed = f.flag();
    const start = this.pointOf(startVertex);
    const end = this.pointOf(endVertex);
    const model = curve < 0 ? null : this.curveOf(curve);
    let t0: number;
    let t1: number;
    if (startParam !== undefined && endParam !== undefined) {
      // the file gives them along the edge, so an edge against its curve has them negated
      t0 = reversed ? -startParam : startParam;
      t1 = reversed ? -endParam : endParam;
    } else if (model === null) {
      t0 = 0;
      t1 = 0;
    } else {
      t0 = paramOf(model, start);
      t1 = wrapParam(model, t0, paramOf(model, end), reversed);
    }
    const edge: BrepEdge = { start, end, curve: model, t0, t1, reversed };
    this.edges.set(index, edge);
    return edge;
  }

  /** Versions before 500 keep no edge parameters; the edge's vertices give them instead. */
  private hasParams(): boolean {
    return this.file.version >= PARAMS_FROM;
  }

  private pointOf(vertex: number): V3 {
    const known = this.points.get(vertex);
    if (known !== undefined) return known;
    const f = this.open(vertex, "vertex", true);
    f.ptr(); // edge
    f.optionalInt(); // reference count, written from about version 21000 on
    const point = f.ptr();
    if (point < 0) throw new AcisError(`vertex ${vertex} has no point`);
    const pf = this.open(point, "point", true);
    const p = placePoint(this.place, pf.vec());
    this.points.set(vertex, p);
    return p;
  }

  private curveOf(index: number): BrepCurve {
    const known = this.curves.get(index);
    if (known !== undefined) return known;
    const rec = this.file.records[index];
    if (rec === undefined) throw new AcisError(`pointer ${index} is past the last record`);
    let curve: BrepCurve;
    if (rec.name === "straight-curve") {
      const f = this.open(index, rec.name, true);
      const origin = f.vec();
      const dir = f.vec();
      curve = { kind: "line", origin: placePoint(this.place, origin), dir: placeVector(this.place, dir) };
    } else if (rec.name === "ellipse-curve") {
      const f = this.open(index, rec.name, true);
      const center = f.vec();
      const normal = f.vec();
      const major = f.vec();
      const ratio = f.num();
      curve = {
        kind: "ellipse",
        center: placePoint(this.place, center),
        normal: placeNormal(this.place, normal),
        major: placeVector(this.place, major),
        ratio,
      };
    } else {
      curve = { kind: "unknown", name: subtypeName(rec) };
    }
    this.curves.set(index, curve);
    return curve;
  }

  private surfaceOf(index: number): SurfaceRead {
    const known = this.surfaces.get(index);
    if (known !== undefined) return known;
    const rec = this.file.records[index];
    if (rec === undefined) throw new AcisError(`pointer ${index} is past the last record`);
    const read = this.readSurface(index, rec);
    this.surfaces.set(index, read);
    return read;
  }

  private readSurface(index: number, rec: AcisRecord): SurfaceRead {
    const p = this.place;
    switch (rec.name) {
      case "plane-surface": {
        const f = this.open(index, rec.name, true);
        const origin = f.vec();
        const normal = f.vec();
        const uDir = f.vec();
        f.flag(); // reverse_v, read to keep the record in step; see face()
        return {
          surface: { kind: "plane", origin: placePoint(p, origin), normal: placeNormal(p, normal), uDir: placeVector(p, uDir) },
        };
      }
      case "cone-surface": {
        const f = this.open(index, rec.name, true);
        const origin = f.vec();
        const axis = f.vec();
        const major = f.vec();
        const ratio = f.num();
        f.bound(); // the u range, I I in every file seen
        f.bound();
        const sinHalf = f.num();
        const cosHalf = f.num();
        f.num(); // the u parameter's scale
        f.flag(); // reverse_v, read to keep the record in step; see face()
        return {
          surface: {
            kind: "cone",
            origin: placePoint(p, origin),
            axis: placeVector(p, axis),
            major: placeVector(p, major),
            ratio,
            sinHalf,
            cosHalf,
          },
        };
      }
      case "sphere-surface": {
        const f = this.open(index, rec.name, true);
        const center = f.vec();
        const radius = f.num();
        const pole = f.vec();
        const uDir = f.vec();
        f.flag(); // reverse_v, read to keep the record in step; see face()
        return {
          surface: {
            kind: "sphere",
            center: placePoint(p, center),
            radius: radius * p.scale,
            uDir: placeVector(p, uDir),
            pole: placeVector(p, pole),
          },
        };
      }
      case "torus-surface": {
        const f = this.open(index, rec.name, true);
        const center = f.vec();
        const axis = f.vec();
        const major = f.num();
        const minor = f.num();
        const uDir = f.vec();
        f.flag(); // reverse_v, read to keep the record in step; see face()
        return {
          surface: {
            kind: "torus",
            center: placePoint(p, center),
            axis: placeVector(p, axis),
            major: major * p.scale,
            minor: minor * p.scale,
            uDir: placeVector(p, uDir),
          },
        };
      }
      default:
        return { surface: { kind: "unknown", name: subtypeName(rec) } };
    }
  }
}

/** A record's name with its first subtype name, for the surfaces and curves this reader leaves unread. */
function subtypeName(rec: AcisRecord): string {
  for (const v of rec.values) {
    if (v.kind === "word") return `${rec.name} ${v.value}`;
  }
  return rec.name;
}

// ---- geometry helpers ----------------------------------------------------------------------------

function placePoint(pl: Placement, p: V3): V3 {
  const v = placeVector(pl, p);
  return [v[0] + pl.t[0], v[1] + pl.t[1], v[2] + pl.t[2]];
}

/** A direction or length under the placement's linear part. */
function placeVector(pl: Placement, v: V3): V3 {
  const m = pl.m;
  return [
    v[0] * m[0] + v[1] * m[3] + v[2] * m[6],
    v[0] * m[1] + v[1] * m[4] + v[2] * m[7],
    v[0] * m[2] + v[1] * m[5] + v[2] * m[8],
  ];
}

/**
 * A unit normal under the placement. Points move by p·M, so their linear map acting on columns is Mᵀ, and
 * a normal takes the inverse transpose of that map: M⁻¹ applied to the normal as a column. That keeps it
 * perpendicular to the moved surface, which applying M itself would not.
 */
function placeNormal(pl: Placement, n: V3): V3 {
  const i = pl.inv;
  const out: V3 = [
    n[0] * i[0] + n[1] * i[1] + n[2] * i[2],
    n[0] * i[3] + n[1] * i[4] + n[2] * i[5],
    n[0] * i[6] + n[1] * i[7] + n[2] * i[8],
  ];
  const len = Math.hypot(out[0], out[1], out[2]);
  if (len === 0) throw new AcisError("zero normal");
  return [out[0] / len, out[1] / len, out[2] / len];
}

function det3(m: readonly number[]): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

function invert3(m: readonly number[]): number[] {
  const d = det3(m);
  if (Math.abs(d) < 1e-300) throw new AcisError("transform is singular");
  return [
    (m[4] * m[8] - m[5] * m[7]) / d,
    (m[2] * m[7] - m[1] * m[8]) / d,
    (m[1] * m[5] - m[2] * m[4]) / d,
    (m[5] * m[6] - m[3] * m[8]) / d,
    (m[0] * m[8] - m[2] * m[6]) / d,
    (m[2] * m[3] - m[0] * m[5]) / d,
    (m[3] * m[7] - m[4] * m[6]) / d,
    (m[1] * m[6] - m[0] * m[7]) / d,
    (m[0] * m[4] - m[1] * m[3]) / d,
  ];
}

/** The curve parameter of the point on the curve nearest to p, taken from its position in the curve's frame. */
function paramOf(curve: BrepCurve, p: V3): number {
  if (curve.kind === "line") {
    const d: V3 = [p[0] - curve.origin[0], p[1] - curve.origin[1], p[2] - curve.origin[2]];
    return dot(d, curve.dir) / dot(curve.dir, curve.dir);
  }
  if (curve.kind === "ellipse") {
    const n = cross(curve.normal, curve.major);
    const nn: V3 = [n[0] * curve.ratio, n[1] * curve.ratio, n[2] * curve.ratio];
    const d: V3 = [p[0] - curve.center[0], p[1] - curve.center[1], p[2] - curve.center[2]];
    return Math.atan2(dot(d, nn) / dot(nn, nn), dot(d, curve.major) / dot(curve.major, curve.major));
  }
  return NaN;
}

/**
 * The end parameter of an edge without parameters in the file: taken from its end vertex, and kept in the
 * edge's direction. A closed edge (both vertices at one point) runs once round an ellipse.
 */
function wrapParam(curve: BrepCurve, t0: number, te: number, reversed: boolean): number {
  if (curve.kind !== "ellipse") return te;
  const mod = (x: number) => ((x % TAU) + TAU) % TAU;
  let span = reversed ? -mod(t0 - te) : mod(te - t0);
  if (Math.abs(span) < 1e-12) span = reversed ? -TAU : TAU;
  return t0 + span;
}

function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: V3, b: V3): V3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
