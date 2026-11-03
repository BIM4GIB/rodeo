// Vectorworks plug-in files read: menu commands (.vsm), tools (.vst) and objects (.vso) made with
// the Plug-in Manager, whose script is Python or Vectorscript. Plug-ins built with the SDK (.vlb)
// are compiled code and aren't these files. Little-endian throughout; Pascal strings are a length
// byte and UTF-8 text (older files: the system's 8-bit encoding), in fixed-size fields.
//
//   +0x00  "MCVS"
//   +0x04  u8 kind: 0 menu command, 1 tool, 2 object
//   +0x06  Pascal[64] name               +0x46  Pascal[64] category
//   +0x86  u16 file version (11 to 13 seen)
//   +0x88  u32 script offset, u32 length (encrypted: 80 fc ff ff, then text with every bit flipped)
//   +0x94  u32 offset and end of the display names: Pascal[65] per parameter, in order
//   +0xe2  u32 small icon offset, length (PNG)    +0xf8  u32 large icon offset, length (PNG)
//   +0x8b0 u16 parameter count, then u32 offset per parameter
//
// A parameter: Pascal[21] name, u16 type, Pascal[128] default (imperial for a dimension),
// Pascal[128] metric default (dimensions; empty elsewhere), u16 choice count, then for each choice
// two Pascal strings (the value kept, the name shown). The file doesn't say which shape an object
// takes (point, line, rectangle, path), as far as the samples show; objectShape guesses it from
// what the script asks for.

/** What a plug-in file holds. */
export type VwPluginKind = "command" | "tool" | "object";

/** A parameter's type as Vectorworks codes it, named; "other" for codes not known here. */
export type VwParamKind = "integer" | "boolean" | "number" | "text" | "dimension" | "popup" | "radio" | "x" | "y" | "static" | "class" | "other";

const PARAM_KINDS: Readonly<Record<number, VwParamKind>> = {
  1: "integer",
  2: "boolean",
  3: "number",
  4: "text",
  7: "dimension",
  8: "popup",
  9: "radio",
  10: "x",
  11: "y",
  14: "static",
  18: "class",
};

export interface VwChoice {
  /** what the parameter holds when chosen */
  readonly value: string;
  /** what the Object Info palette shows */
  readonly label: string;
}

export interface VwParam {
  /** its name in scripts (P<name>, spaces as underscores) and in the object's record */
  readonly name: string;
  /** the name Object Info shows: the display name, or the name when it has none */
  readonly label: string;
  /** Vectorworks' type code */
  readonly type: number;
  readonly kind: VwParamKind;
  /** the default as typed in the Plug-in Manager (with a unit mark or none); for a dimension, the imperial one */
  readonly default: string;
  /** a dimension's metric default; "" when it has none */
  readonly metricDefault: string;
  /** a popup's or radio button's values */
  readonly choices: readonly VwChoice[];
}

/** The shape an object plug-in is placed by. */
export type VwObjectShape = "point" | "linear" | "rect" | "path";

export interface VwPlugin {
  readonly kind: VwPluginKind;
  readonly name: string;
  readonly category: string;
  /** the file's format version */
  readonly version: number;
  /** true when the script is encrypted: it can't be read or run */
  readonly encrypted: boolean;
  readonly language: "python" | "vectorscript";
  /** the script, line ends made \n; "" when encrypted */
  readonly script: string;
  readonly params: readonly VwParam[];
  /** the small icon as PNG bytes, or null */
  readonly icon: Uint8Array | null;
}

const MAGIC = "MCVS";
const KINDS: readonly VwPluginKind[] = ["command", "tool", "object"];
const PARAMS_AT = 0x8b0;
const NAME_FIELD = 21;
const DEFAULT_FIELD = 128;
const LABEL_FIELD = 65;
const ENCRYPTED = [0x80, 0xfc, 0xff, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47];

const utf8 = new TextDecoder("utf-8", { fatal: true });
const latin = new TextDecoder("windows-1252");

function text(b: Uint8Array): string {
  try {
    return utf8.decode(b);
  } catch {
    return latin.decode(b);
  }
}

class Reader {
  private readonly v: DataView;
  constructor(readonly b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  need(at: number, n: number, what: string): void {
    if (at < 0 || at + n > this.b.length) throw new Error(`this plug-in file is cut short (its ${what})`);
  }
  u16(at: number): number {
    this.need(at, 2, "header");
    return this.v.getUint16(at, true);
  }
  u32(at: number): number {
    this.need(at, 4, "header");
    return this.v.getUint32(at, true);
  }
  /** A Pascal string at `at`, read no further than `field` bytes (length byte included). */
  pascal(at: number, field: number): string {
    this.need(at, 1, "text");
    const n = Math.min(this.b[at], field - 1, this.b.length - at - 1);
    return text(this.b.subarray(at + 1, at + 1 + n));
  }
  /** A Pascal string at `at` with nothing after it reserved: the string and where the next one starts. */
  packed(at: number): [string, number] {
    this.need(at, 1, "choices");
    const n = this.b[at];
    this.need(at + 1, n, "choices");
    return [text(this.b.subarray(at + 1, at + 1 + n)), at + 1 + n];
  }
}

/** Whether `bytes` starts as a Vectorworks plug-in file does. */
export function isVwPlugin(bytes: Uint8Array): boolean {
  return bytes.length > 4 && String.fromCharCode(...bytes.subarray(0, 4)) === MAGIC;
}

/** Whether a script is Vectorscript: it starts, after its comments, with PROCEDURE or FUNCTION, as no Python script does. */
export function looksLikeVectorscript(code: string): boolean {
  const head = code.replace(/^(\s|\{[^}]*\}|\(\*[\s\S]*?\*\)|\/\/[^\n]*)*/, "");
  return /^(procedure|function)\s+[a-z_]\w*\s*[;(:]/i.test(head);
}

/** Reads a plug-in file. Throws when it isn't one. */
export function readVwPlugin(bytes: Uint8Array): VwPlugin {
  if (!isVwPlugin(bytes)) throw new Error("this isn't a Vectorworks plug-in file (.vsm, .vst or .vso)");
  const r = new Reader(bytes);
  const kind = KINDS[bytes[4]];
  if (!kind) throw new Error(`this plug-in file is of a kind Rodeo doesn't know (${bytes[4]})`);
  const name = r.pascal(0x06, 64);
  const category = r.pascal(0x46, 64);
  const version = r.u16(0x86);
  const scriptAt = r.u32(0x88);
  const scriptLength = r.u32(0x8c);
  r.need(scriptAt, scriptLength, "script");
  const raw = bytes.subarray(scriptAt, scriptAt + scriptLength);
  const encrypted = ENCRYPTED.every((x, i) => raw[i] === x);
  // a script ends at its first zero byte, if any
  const end = raw.indexOf(0);
  const script = encrypted ? "" : text(end < 0 ? raw : raw.subarray(0, end)).replace(/\r\n?/g, "\n");

  const labelsAt = r.u32(0x94);
  const labelsEnd = r.u32(0x98);
  const count = bytes.length >= PARAMS_AT + 2 ? r.u16(PARAMS_AT) : 0;
  const params: VwParam[] = [];
  for (let i = 0; i < count; i++) {
    const at = r.u32(PARAMS_AT + 2 + 4 * i);
    r.need(at, NAME_FIELD + 2 + 2 * DEFAULT_FIELD + 2, `parameter ${i + 1}`);
    const pname = r.pascal(at, NAME_FIELD);
    const type = r.u16(at + NAME_FIELD);
    const dflt = r.pascal(at + NAME_FIELD + 2, DEFAULT_FIELD);
    const metric = r.pascal(at + NAME_FIELD + 2 + DEFAULT_FIELD, DEFAULT_FIELD);
    const nChoices = r.u16(at + NAME_FIELD + 2 + 2 * DEFAULT_FIELD);
    const choices: VwChoice[] = [];
    let p = at + NAME_FIELD + 2 + 2 * DEFAULT_FIELD + 2;
    for (let k = 0; k < nChoices; k++) {
      const [value, q] = r.packed(p);
      const [label, next] = r.packed(q);
      choices.push({ value, label: label || value });
      p = next;
    }
    const labelAt = labelsAt + LABEL_FIELD * i;
    const label = labelsAt > 0 && labelAt + LABEL_FIELD <= labelsEnd ? r.pascal(labelAt, LABEL_FIELD) : "";
    params.push({ name: pname, label: label || pname, type, kind: PARAM_KINDS[type] ?? "other", default: dflt, metricDefault: metric, choices });
  }

  const iconAt = r.u32(0xe2);
  const iconLength = r.u32(0xe6);
  const icon = iconLength > 8 && iconAt + iconLength <= bytes.length && PNG.every((x, i) => bytes[iconAt + i] === x) ? bytes.slice(iconAt, iconAt + iconLength) : null;

  return {
    kind,
    name,
    category,
    version,
    encrypted,
    language: encrypted || looksLikeVectorscript(script) ? "vectorscript" : "python",
    script,
    params,
    icon,
  };
}

/**
 * The shape an object plug-in is placed by, from what its script (and the Python modules that come
 * with it) asks for: its path, its line's length or its rectangle's size; a point otherwise.
 */
export function objectShape(sources: readonly string[]): VwObjectShape {
  const all = sources.join("\n");
  if (/\bGetCustomObjectPath\b|\bGetCustomObjectProfileGroup\b/i.test(all)) return "path";
  if (/\bPBoxWidth\b|\bPBoxHeight\b/i.test(all)) return "rect";
  if (/\bPLineLength\b/i.test(all)) return "linear";
  return "point";
}
