// Revit files read (.rvt projects, .rfa families, .rte and .rft templates): what a file says about
// itself, not its model. A Revit file is a compound file (cfb.ts); the streams read here are the
// ones Revit writes for other programs to look at, so they hold no element geometry:
//
//   BasicFileInfo        u32 stream version (9 in Revit 2015, 14 from 2021), 10 bytes, then u32
//                        counted UTF-16 strings from +14: the release and build ("Autodesk Revit
//                        2015 (Build: 20140120_2215(x64))" to 2018; "2019" then "20180123_1515(x64)"
//                        from 2019), the last save path, ids and the locale. After them, UTF-16
//                        "Key: value" lines (Worksharing, Format, Build, Locale when saved, …),
//                        from 2019 one byte off the even boundary.
//   ProjectInformation   projects: a zip of one Atom entry (urn:schemas-autodesk-com:partatom), its
//                        title, save time, release and the Project Information parameters by group.
//   PartAtom             families: the same Atom, plain, with the family's category, parameters
//                        and types (A:family/A:part), each type's parameters with their units.
//   TransmissionData     u32 character count, then UTF-16 XML: the files the model refers to
//                        (Revit and CAD links, keynote tables) with their last paths and states.
//   RevitPreview4.0      a header, then the thumbnail as a PNG (128 x 128 in the samples).
//
// The model itself is in Global/Latest and Partitions/n, compressed, laid out by the class schema
// in Formats/Latest; that layout isn't documented and isn't read here. Seen in Autodesk's sample
// projects and families from Revit 2015 to 2027 (rvt.check.ts).

import { inflate } from "../export/flate.ts";
import { isCompoundFile, readCompoundFile } from "./cfb.ts";

export type RevitKind = "project" | "family" | "project template" | "family template";

/** A named value: a Project Information or family parameter, or one of a family type's. */
export interface RevitParam {
  /** the group Revit shows it under ("Identity Data", "Other"); "" for a type's */
  readonly group: string;
  readonly name: string;
  /** as written, with its unit after it when the file gives one ("762.00 mm") */
  readonly value: string;
}

/** One of a family's types, with its parameters. */
export interface RevitType {
  readonly name: string;
  readonly params: readonly RevitParam[];
}

/** A file the model refers to: a linked Revit model or CAD drawing, a keynote table. */
export interface RevitLink {
  /** Revit's word for it: "Revit Link", "CAD Link", "Keynote Table", … */
  readonly type: string;
  /** its file name, without the folders */
  readonly name: string;
  /** "Loaded", "Unloaded", "Not Found", …; "" when not said */
  readonly state: string;
}

export interface RevitFile {
  readonly kind: RevitKind;
  /** the Revit release that saved it (2024); null when the file doesn't say */
  readonly release: number | null;
  /** that release's build ("20230308_1635(x64)"); null when not said */
  readonly build: string | null;
  /** the name Revit gave it when it was saved; null when not said */
  readonly title: string | null;
  /** when it was saved, as the file writes it (ISO 8601, UTC); null when not said */
  readonly saved: string | null;
  /** "Not enabled", or how it is shared ("Central", "Local"); null when not said */
  readonly worksharing: string | null;
  /** the language Revit ran in ("ENU"); null when not said */
  readonly locale: string | null;
  /** a project's Project Information, or a family's parameters; those with no value left out */
  readonly info: readonly RevitParam[];
  /** a family's category ("Furniture"); null for projects */
  readonly category: string | null;
  /** a family's types */
  readonly types: readonly RevitType[];
  readonly links: readonly RevitLink[];
  /** the thumbnail Revit saved, as PNG; null when there is none */
  readonly preview: { readonly png: Uint8Array; readonly width: number; readonly height: number } | null;
}

/** True when a file's name is a Revit project, family or template's. */
export function isRevitName(name: string): boolean {
  return /\.(rvt|rfa|rte|rft)$/i.test(name);
}

/** Whether `name` is a Revit project's, whose model Rodeo opens (app/revitImport.ts); a family's or template's shows its details. */
export function isRevitModelName(name: string): boolean {
  return /\.rvt$/i.test(name);
}

/** What a Revit file says about itself. `name`, the file's name, tells templates apart. Throws when it isn't a Revit file. */
export function readRevit(bytes: Uint8Array, name = ""): RevitFile {
  if (!isCompoundFile(bytes)) throw new Error("this isn't a Revit file");
  const streams = readCompoundFile(bytes);
  const stream = (path: string): Uint8Array | null => {
    const read = streams.get(path);
    if (!read) return null;
    try {
      return read();
    } catch {
      return null;
    }
  };
  const basic = stream("BasicFileInfo");
  if (!basic) throw new Error("this isn't a Revit file");
  const info = basicFileInfo(basic);

  const partAtom = stream("PartAtom");
  const family = partAtom !== null;
  const atomBytes = partAtom ?? zipEntry(stream("ProjectInformation"));
  const atom = atomBytes ? parseXml(new TextDecoder().decode(atomBytes)) : null;
  const entry = atom ? child(atom, "entry") : null;

  const ext = /\.(rte|rft)$/i.exec(name)?.[1].toLowerCase();
  const kind: RevitKind = ext === "rte" ? "project template" : ext === "rft" ? "family template" : family ? "family" : "project";
  return {
    kind,
    release: info.release ?? releaseOf(entry ? textAt(entry, "link", "A:design-file", "A:product-version") : ""),
    build: info.build,
    title: entry ? textAt(entry, "title") || null : null,
    saved: entry ? textAt(entry, "updated") || null : null,
    worksharing: info.lines.get("Worksharing") ?? null,
    locale: info.lines.get("Locale when saved") ?? null,
    info: entry ? featureParams(entry) : [],
    category: entry ? familyCategory(entry) : null,
    types: entry ? familyTypes(entry) : [],
    links: links(stream("TransmissionData")),
    preview: preview(stream("RevitPreview4.0")),
  };
}

// ---- BasicFileInfo ------------------------------------------------------------------------------

interface BasicInfo {
  release: number | null;
  build: string | null;
  /** the "Key: value" lines */
  lines: Map<string, string>;
}

function basicFileInfo(b: Uint8Array): BasicInfo {
  const lines = new Map<string, string>();
  // the lines lie on an even byte from 2015 to 2018, an odd one after: both are tried. The first
  // follows the bytes 0d 0a, which read as one character, U+0A0D.
  for (const off of [0, 1]) {
    const text = new TextDecoder("utf-16le").decode(b.subarray(off, off + ((b.length - off) & ~1)));
    const found = new Map<string, string>();
    for (const m of text.matchAll(/(?:^|[\r\n਍])([A-Za-z][A-Za-z' ]*): ([^\r\n\0਍]*)/g)) found.set(m[1], m[2].trim());
    if (found.has("Worksharing") && found.size > lines.size) {
      lines.clear();
      for (const [k, val] of found) lines.set(k, val);
    }
  }
  // the counted strings at the head: the release (and build) as Revit wrote them
  const head = countedString(b, 14);
  let release: number | null = null;
  let build: string | null = null;
  if (head && /^\d{4}$/.test(head.text)) {
    release = Number(head.text);
    build = countedString(b, head.end)?.text || null;
  } else if (head) {
    release = releaseOf(head.text);
    build = /\(Build: ([^)]*\)?)\)/.exec(head.text)?.[1] ?? null;
  }
  release ??= releaseOf(lines.get("Format") ?? lines.get("Revit Build") ?? "");
  build ??= lines.get("Build") ?? /\(Build: ([^)]*\)?)\)/.exec(lines.get("Revit Build") ?? "")?.[1] ?? null;
  return { release, build, lines };
}

/** The u32-counted UTF-16 string at `at`, and where it ends; null when what's there isn't one. */
function countedString(b: Uint8Array, at: number): { text: string; end: number } | null {
  if (at + 4 > b.length) return null;
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
  const end = at + 4 + n * 2;
  if (n === 0 || n > 1024 || end > b.length) return null;
  const text = new TextDecoder("utf-16le").decode(b.subarray(at + 4, end));
  return /^[\x20-\x7e]+$/.test(text) ? { text, end } : null;
}

/** The release year in "2024", "Autodesk Revit 2015 (Build: …)" or "Autodesk Revit Architecture 2012"; null when there's none. */
function releaseOf(text: string): number | null {
  const m = /^(\d{4})$/.exec(text.trim()) ?? /Revit(?: [A-Za-z]+)* (\d{4})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

// ---- the Atom entries ---------------------------------------------------------------------------

/** The first entry of the zip ProjectInformation holds, inflated; null when it isn't one. */
function zipEntry(b: Uint8Array | null): Uint8Array | null {
  if (!b || b.length < 30) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(0, true) !== 0x04034b50) return null;
  const method = v.getUint16(8, true);
  const start = 30 + v.getUint16(26, true) + v.getUint16(28, true);
  // the entry's name is a temporary path on the computer that saved it, so it's passed over
  const data = b.subarray(start);
  if (method === 0) return data.subarray(0, v.getUint32(18, true));
  if (method !== 8) return null;
  // a zlib header before the raw deflate (inflate doesn't check the trailing checksum)
  const z = new Uint8Array(data.length + 2);
  z.set([0x78, 0x9c]);
  z.set(data, 2);
  try {
    return inflate(z);
  } catch {
    return null;
  }
}

/** A family's or project's parameters: each A:feature's groups, values with their units. */
function featureParams(entry: XmlElement): RevitParam[] {
  const out: RevitParam[] = [];
  for (const feature of child(entry, "A:features")?.children ?? []) {
    for (const group of feature.children) {
      if (group.name !== "A:group") continue;
      const title = textAt(group, "A:title");
      for (const p of group.children) if (p.name !== "A:title") pushParam(out, title, p);
    }
  }
  return out;
}

function familyTypes(entry: XmlElement): RevitType[] {
  return (child(entry, "A:family")?.children ?? [])
    .filter((el) => el.name === "A:part")
    .map((part) => {
      const params: RevitParam[] = [];
      for (const p of part.children) if (p.name !== "title") pushParam(params, "", p);
      return { name: textAt(part, "title"), params };
    });
}

/** Adds a parameter element: its display name (or its tag, underscores as spaces) and value, when it has one. */
function pushParam(out: RevitParam[], group: string, p: XmlElement): void {
  const value = p.text.trim();
  if (!value) return;
  const unit = p.attrs.units;
  out.push({ group, name: p.attrs.displayName ?? p.name.replace(/_/g, " "), value: unit ? `${value} ${unit}` : value });
}

/** A family's Revit category, from its "adsk:revit:grouping" category term. */
function familyCategory(entry: XmlElement): string | null {
  for (const c of entry.children) {
    if (c.name === "category" && textAt(c, "scheme") === "adsk:revit:grouping") return textAt(c, "term") || null;
  }
  return null;
}

// ---- TransmissionData and the preview -----------------------------------------------------------

function links(b: Uint8Array | null): RevitLink[] {
  if (!b || b.length < 4) return [];
  const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true);
  const xml = new TextDecoder("utf-16le").decode(b.subarray(4, Math.min(b.length, 4 + n * 2)));
  const root = child(parseXml(xml), "TransmissionData");
  return (root?.children ?? [])
    .filter((el) => el.name === "ExternalFileReference")
    .map((ref) => ({
      type: textAt(ref, "ExternalFileReferenceType"),
      name: (textAt(ref, "LastSavedPath") || textAt(ref, "DesiredPath")).split(/[\\/]/).pop() ?? "",
      state: textAt(ref, "LastSavedLoadState"),
    }))
    .filter((l) => l.name !== "");
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The PNG in RevitPreview4.0, cut at its IEND chunk, with its size; null when there's none. */
function preview(b: Uint8Array | null): RevitFile["preview"] {
  if (!b) return null;
  let start = -1;
  for (let i = 0; i + 8 <= b.length && start < 0; i++) if (PNG.every((x, k) => b[i + k] === x)) start = i;
  if (start < 0) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let width = 0;
  let height = 0;
  for (let at = start + 8; at + 12 <= b.length; ) {
    const length = v.getUint32(at);
    const type = String.fromCharCode(b[at + 4], b[at + 5], b[at + 6], b[at + 7]);
    if (type === "IHDR") {
      width = v.getUint32(at + 8);
      height = v.getUint32(at + 12);
    }
    at += 12 + length;
    if (type === "IEND") return at <= b.length && width > 0 && height > 0 ? { png: b.slice(start, at), width, height } : null;
  }
  return null;
}

// ---- a small XML reader -------------------------------------------------------------------------

/** An element of a parsed XML document: its name, attributes, child elements and the text directly in it. */
interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  text: string;
}

const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function unescapeXml(text: string): string {
  return text.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all: string, body: string) => {
    if (body[0] !== "#") return ENTITIES[body] ?? all;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

/** The element tree, with comments, declarations and doctypes left out. */
function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "", attrs: {}, children: [], text: "" };
  const stack: XmlElement[] = [root];
  for (const m of xml.matchAll(TAG)) {
    const [, close, name, rest, selfClosing, text] = m;
    if (text !== undefined) {
      stack[stack.length - 1].text += unescapeXml(text);
      continue;
    }
    if (name === undefined) continue;
    if (close) {
      let at = stack.length - 1;
      while (at > 0 && stack[at].name !== name) at--;
      if (at > 0) stack.length = at;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rest.matchAll(ATTR)) attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? "");
    const el: XmlElement = { name, attrs, children: [], text: "" };
    stack[stack.length - 1].children.push(el);
    if (!selfClosing) stack.push(el);
  }
  return root;
}

function child(el: XmlElement, name: string): XmlElement | null {
  return el.children.find((c) => c.name === name) ?? null;
}

/** The text of the element down `path` from `el`, trimmed; "" when it isn't there. */
function textAt(el: XmlElement, ...path: string[]): string {
  let at: XmlElement | null = el;
  for (const name of path) at = at ? child(at, name) : null;
  return at?.text.trim() ?? "";
}
