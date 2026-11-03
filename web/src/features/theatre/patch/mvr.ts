// MVR, the scene exchange file lighting software trades: GeneralSceneDescription.xml, whose instruments sit in
// layers by position, each with its hanging point (x, y in mm; z the lens height), unit and absolute DMX address.
// mvrXml writes it, parseMvr reads it back, and instrumentTypeOf picks a catalogue type from a fixture's GDTF
// name. Pure: the zip is made and read by the caller, so this runs without the browser. Left out: the GDTF
// fixture files, trusses and other scene objects, and any colour finer than the gel's approximate one.

import { DEFAULT_TYPE, type Fixture } from "../fixture.ts";
import { colorOf } from "../gels.ts";
import type { StageFrame } from "../stage.ts";
import { absoluteOf, inOrder, isPatched } from "./patch.ts";

/** An instrument as an MVR file gives it back: its name, hanging point, unit, GDTF name, absolute address (0 unpatched) and layer. */
export interface MvrFixture {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly unit: string;
  readonly spec: string;
  readonly address: number;
  readonly layer: string;
}

/** The catalogue type a GDTF name points at, by the first keyword it holds (else the default profile). */
const KINDS: readonly (readonly [RegExp, string])[] = [
  [/\bfollowspot/i, "followspot"],
  [/\bmoving/i, "spotmover"],
  [/\bspot/i, "spotmover"],
  [/\bwash/i, "washmover"],
  [/\bbeam/i, "beammover"],
  [/\bpar/i, "parnsp"],
  [/\bfresnel/i, "fresnel1k"],
  [/\bprofile/i, DEFAULT_TYPE],
];

/** The catalogue type key for a GDTF name such as "Robe Spot 250.gdtf". */
export function instrumentTypeOf(spec: string): string {
  return KINDS.find(([word]) => word.test(spec))?.[1] ?? DEFAULT_TYPE;
}

/** A UUID as MVR writes them, upper case in 8-4-4-4-12, the same for the same key every time. */
export function uuidOf(key: string): string {
  let hex = "";
  for (let seed = 0; seed < 4; seed++) hex += hash32(key, seed).toString(16).padStart(8, "0");
  // version 4 and the RFC 4122 variant, so readers see a well-formed UUID
  const v = `${hex.slice(0, 12)}4${hex.slice(13, 16)}${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17)}`;
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20, 32)}`.toUpperCase();
}

/** FNV-1a over the text, from a seed, as 32 bits. */
function hash32(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML text with its entities read: &amp; and the rest, and character references. */
export function unescapeXml(text: string): string {
  return text.replace(/&(#x[\da-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (all: string, body: string) => {
    if (body[0] !== "#") return ENTITIES[body] ?? all;
    const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all;
  });
}

/** Text for an XML attribute or element, with its characters escaped. */
function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A number as MVR writes it: at most `digits` decimals, no exponent, no minus zero. */
function num(v: number, digits = 3): string {
  const r = Number(v.toFixed(digits));
  return String(r === 0 ? 0 : r);
}

/** A colour as CIE xyY, x and y as chromaticities and Y in percent: white (D65) when the gel leaves it so. */
export function colourOf(field: string): string {
  const { r, g, b } = colorOf(field);
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const X = 0.4124 * R + 0.3576 * G + 0.1805 * B;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = 0.0193 * R + 0.1192 * G + 0.9505 * B;
  const sum = X + Y + Z;
  const [x, y] = sum > 0 ? [X / sum, Y / sum] : [0.3127, 0.329];
  return `{${num(x, 4)},${num(y, 4)},${num(Y * 100)}}`;
}

/** One instrument as a Fixture element. Unpatched ones carry no Addresses. */
function fixtureXml(f: Fixture): string {
  const unit = f.unit.trim();
  const unitNumber = /^\d+$/.test(unit) ? Number(unit) : 0;
  const addresses = isPatched(f) ? `<Addresses><Address break="0">${absoluteOf(f.universe, f.address)}</Address></Addresses>` : "";
  const matrix = `{1,0,0}{0,1,0}{0,0,1}{${num(f.at.x)},${num(f.at.y)},${num(f.heightMm)}}`;
  return [
    `<Fixture name="${esc(f.label || "Instrument")}" uuid="${uuidOf(f.id)}">`,
    `<Matrix>${matrix}</Matrix>`,
    `<GDTFSpec>${esc(`${f.label || "Generic"}.gdtf`)}</GDTFSpec>`,
    "<GDTFMode>Default</GDTFMode>",
    `<FixtureID>${esc(unit)}</FixtureID>`,
    `<UnitNumber>${unitNumber}</UnitNumber>`,
    "<FixtureTypeId>0</FixtureTypeId>",
    "<CustomId>0</CustomId>",
    `<Color>${colourOf(f.color)}</Color>`,
    `${addresses}</Fixture>`,
  ].join("");
}

/**
 * The GeneralSceneDescription.xml of an MVR file: one layer per position, each instrument with its hanging point
 * (x and y as the drawing has them, z its lens height, mm) and address; instruments in stage order within a layer.
 * The drawing's name goes in the user data.
 */
export function mvrXml(list: readonly Fixture[], frame: StageFrame, drawingName: string): string {
  const layers = new Map<string, Fixture[]>();
  for (const f of inOrder(list, "position", frame)) {
    const items = layers.get(f.position) ?? [];
    items.push(f);
    layers.set(f.position, items);
  }
  const layerXml = [...layers].map(
    ([name, items]) => `<Layer name="${esc(name)}" uuid="${uuidOf(`layer:${name}`)}"><ChildList>\n${items.map(fixtureXml).join("\n")}\n</ChildList></Layer>`,
  );
  const user = drawingName.trim() ? `<UserData><Data provider="Rodeo" ver="1"><Drawing name="${esc(drawingName.trim())}"/></Data></UserData>` : "<UserData/>";
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<GeneralSceneDescription verMajor="1" verMinor="5" provider="Rodeo" providerVersion="1">${user}<Scene><AUXData/><Layers>`,
    ...layerXml,
    "</Layers></Scene></GeneralSceneDescription>",
    "",
  ].join("\n");
}

/** An element of a parsed XML document: its name, attributes, child elements and the text directly in it. */
interface XmlElement {
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  text: string;
}

const TAG = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<![^>]*>|<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|([^<]+)/g;
const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** A small XML reader: the element tree, with comments, declarations and doctypes left out. */
function parseTree(xml: string): XmlElement {
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

/** One Fixture element as an MVR fixture: the origin is the last group of its matrix; its unit is FixtureID, else UnitNumber. */
function fixtureOf(el: XmlElement, layer: string): MvrFixture {
  const child = (name: string): XmlElement | undefined => el.children.find((c) => c.name === name);
  const text = (name: string): string => (child(name)?.text ?? "").trim();
  const groups = [...(child("Matrix")?.text ?? "").matchAll(/\{([^}]*)\}/g)];
  const origin = (groups.at(-1)?.[1] ?? "").split(",").map((v) => Number(v) || 0);
  const addresses = (child("Addresses")?.children ?? []).filter((c) => c.name === "Address");
  const first = addresses.find((c) => (c.attrs.break ?? "0") === "0") ?? addresses[0];
  const number = Number(text("UnitNumber")) || 0;
  return {
    name: el.attrs.name ?? "",
    x: origin[0] ?? 0,
    y: origin[1] ?? 0,
    z: origin[2] ?? 0,
    unit: text("FixtureID") || (number > 0 ? String(number) : ""),
    spec: text("GDTFSpec"),
    address: Number(first?.text.trim()) || 0,
    layer,
  };
}

/** The instruments of an MVR file's scene, in the order the file lists them, each with its layer's name. */
export function parseMvr(xml: string): MvrFixture[] {
  const out: MvrFixture[] = [];
  const walk = (el: XmlElement, layer: string): void => {
    for (const child of el.children) {
      if (child.name === "Layer") walk(child, child.attrs.name ?? "");
      else {
        if (child.name === "Fixture") out.push(fixtureOf(child, layer));
        walk(child, layer);
      }
    }
  };
  walk(parseTree(xml), "");
  return out;
}
