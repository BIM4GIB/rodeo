// The sums behind ConnectCAD's Device Builder tool (builder.ts): a device described by its make and
// model, identification, physical details and rows of sockets; where those sockets go on its box
// (inputs down the left, outputs down the right, a row's sockets together, a gap between rows); how
// big the box is; the devices kept in the user's list; and a picture of it. Kept apart so it runs
// without the page.

import { connectorsFor, nextName, socketName, type Box, type Socket, type SocketType } from "./ccadShapes.ts";

/** a row of the Sockets Definition: so many sockets of one type, signal and connector down one side */
export interface SocketRow {
  readonly use: boolean;
  readonly count: number;
  readonly type: SocketType;
  readonly signal: string;
  readonly connector: string;
  readonly side: "L" | "R";
  /** the sockets' name, numbered on when there are several (IN1, IN2…); the type's when empty */
  readonly name: string;
}

export interface DeviceDesign {
  readonly make: string;
  readonly model: string;
  readonly name: string;
  readonly tag: string;
  readonly description: string;
  /** a virtual device has no size, so no equipment item */
  readonly physical: boolean;
  /** mm */
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly ru: number;
  readonly halfRack: boolean;
  /** W and kg */
  readonly power: number;
  readonly weight: number;
  readonly rows: readonly SocketRow[];
}

/** the Device Builder's Preferences, in grid spaces (pitches) */
export interface BuilderLayout {
  readonly minWidth: number;
  readonly top: number;
  readonly bottom: number;
  readonly groupGap: number;
  readonly truncate: boolean;
}

export const BUILDER_DEFAULTS: BuilderLayout = { minWidth: 8, top: 0, bottom: 0, groupGap: 1, truncate: false };
/** sockets a device can have at most */
export const MAX_SOCKETS = 256;
/** a half-rack device's width, mm (9.5 in) */
export const HALF_RACK_MM = 241.3;
/** a full rack device's width, mm (19 in) */
export const FULL_RACK_MM = 482.6;
/** a rack unit, mm */
export const RU_MM = 44.45;

export const newRow = (type: SocketType, signal: string): SocketRow => ({ use: true, count: 1, type, signal, connector: connectorsFor(signal)[0] ?? "", side: type === "OUT" ? "R" : "L", name: "" });

export const NEW_DESIGN: DeviceDesign = {
  make: "",
  model: "",
  name: "DEV1",
  tag: "",
  description: "",
  physical: true,
  height: RU_MM,
  width: FULL_RACK_MM,
  depth: 0,
  ru: 1,
  halfRack: false,
  power: 0,
  weight: 0,
  rows: [newRow("IN", "SDI"), newRow("OUT", "SDI")],
};

const whole = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, Math.round(Number.isFinite(n) ? n : min)));

/**
 * The device's sockets: each row's in turn down its side, a slot apart, `groupGap` slots between one
 * row and the next on that side, starting `top` slots down; names numbered on through the device.
 */
export function designSockets(d: DeviceDesign, layout: BuilderLayout): Socket[] {
  const out: Socket[] = [];
  const taken = new Set<string>();
  const next: Record<"L" | "R", number> = { L: whole(layout.top, 0, 50), R: whole(layout.top, 0, 50) };
  const gap = whole(layout.groupGap, 0, 10);
  for (const r of d.rows) {
    if (!r.use) continue;
    const n = whole(r.count, 1, MAX_SOCKETS);
    for (let i = 0; i < n && out.length < MAX_SOCKETS; i++) {
      const asked = r.name.trim();
      // one socket named takes its name as it is; several are numbered from it
      const name = n === 1 && asked && !taken.has(asked) ? asked : n === 1 && asked ? nextName(asked, taken) : socketName(asked, r.type, taken);
      taken.add(name);
      out.push({ id: out.length + 1, name, tag: name, type: r.type, side: r.side, slot: next[r.side]++, signal: r.signal, connector: r.connector, terminated: false });
    }
    next[r.side] += gap;
  }
  return out;
}

/** The box, in pitches: the minimum width or the longest names' across, and as deep as its sockets with the space below. */
export function designBox(sockets: readonly Socket[], layout: BuilderLayout, header = 1): Box {
  const deepest = Math.max(-1, ...sockets.map((k) => k.slot));
  const longest = (side: "L" | "R"): number => Math.max(0, ...sockets.filter((k) => k.side === side).map((k) => k.name.length));
  // a name is about half a pitch a character at the device's writing size
  const named = Math.ceil((longest("L") + longest("R")) * 0.45) + 2;
  return { width: Math.max(whole(layout.minWidth, 2, 100), named), height: header + deepest + 1 + whole(layout.bottom, 0, 50) + 0.5 };
}

/** A long tag cut to its first and last five characters, as Truncate long display tags does. */
export const truncated = (text: string): string => (text.length > 13 ? `${text.slice(0, 5)}…${text.slice(-5)}` : text);

/** The Rack Width a device of this design takes. */
export const rackWidthOf = (d: DeviceDesign): "Full" | "Half" | "Non-rack" => (!d.physical || d.ru <= 0 ? "Non-rack" : d.halfRack ? "Half" : "Full");

/** What's wrong with a design, to say before placing it. */
export function designProblems(d: DeviceDesign): string[] {
  const out: string[] = [];
  if (!d.name.trim()) out.push("the device needs a name");
  if (!d.rows.some((r) => r.use)) out.push("no socket rows are used");
  const total = d.rows.filter((r) => r.use).reduce((n, r) => n + Math.max(1, Math.round(Number.isFinite(r.count) ? r.count : 1)), 0);
  if (total > MAX_SOCKETS) out.push(`a device has ${MAX_SOCKETS} sockets at most`);
  if (d.physical && (d.height < 0 || d.width < 0 || d.depth < 0)) out.push("sizes can't be less than nothing");
  return out;
}

/** A device's place in the user's list: its make and model. */
export const designKey = (d: Pick<DeviceDesign, "make" | "model">): string => `${d.make.trim()} ${d.model.trim()}`.trim();

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const text = (v: unknown, or = ""): string => (typeof v === "string" ? v : or);
const amount = (v: unknown, or = 0): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : or);
const TYPES = new Set(["IN", "OUT", "IO"]);

/** A row as kept, or null for anything that isn't one. */
function rowFrom(v: unknown): SocketRow | null {
  const o = obj(v);
  const type = text(o.type);
  if (!TYPES.has(type)) return null;
  return { use: o.use !== false, count: whole(amount(o.count, 1), 1, MAX_SOCKETS), type: type as SocketType, signal: text(o.signal, "SDI"), connector: text(o.connector), side: o.side === "R" ? "R" : "L", name: text(o.name) };
}

/** A design as kept, or null when it has no make and model. */
export function designFrom(v: unknown): DeviceDesign | null {
  const o = obj(v);
  const d: DeviceDesign = {
    make: text(o.make).trim(),
    model: text(o.model).trim(),
    name: text(o.name, "DEV1"),
    tag: text(o.tag),
    description: text(o.description),
    physical: o.physical !== false,
    height: amount(o.height),
    width: amount(o.width),
    depth: amount(o.depth),
    ru: amount(o.ru),
    halfRack: o.halfRack === true,
    power: amount(o.power),
    weight: amount(o.weight),
    rows: Array.isArray(o.rows) ? o.rows.map(rowFrom).filter((r): r is SocketRow => r !== null) : [],
  };
  return designKey(d) ? d : null;
}

/** The user's list as kept: designs with a make and model, one of each, sorted by them. */
export function designsFrom(raw: unknown): DeviceDesign[] {
  const out = new Map<string, DeviceDesign>();
  for (const v of Array.isArray(raw) ? raw : []) {
    const d = designFrom(v);
    if (d) out.set(designKey(d), d);
  }
  return [...out.values()].sort((a, b) => designKey(a).localeCompare(designKey(b)));
}

/** The list with `d` put in (in place of one of its make and model) or, with `remove`, taken out. */
export function withDesign(list: readonly DeviceDesign[], d: DeviceDesign, remove = false): DeviceDesign[] {
  const rest = list.filter((x) => designKey(x) !== designKey(d));
  return remove ? rest : designsFrom([...rest, d]);
}

const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A picture of the device: its box, tag and description, and its sockets' names, `px` a pitch. */
export function designSvg(d: DeviceDesign, layout: BuilderLayout, px = 14): string {
  const sockets = designSockets(d, layout);
  const box = designBox(sockets, layout);
  const w = box.width * px;
  const h = box.height * px;
  const pad = 2 * px;
  const tag = layout.truncate ? truncated(d.tag.trim() || d.name) : d.tag.trim() || d.name;
  const parts = [
    `<rect x="${pad}" y="${pad}" width="${w}" height="${h}" fill="#fff" stroke="#1f2328" stroke-width="1.2"/>`,
    `<text x="${pad + w / 2}" y="${pad - 4}" text-anchor="middle" font-size="${px * 0.8}" font-weight="600">${esc(tag)}</text>`,
    `<text x="${pad + w / 2}" y="${pad + px * 0.75}" text-anchor="middle" font-size="${px * 0.6}" fill="#57606a">${esc(d.description || designKey(d))}</text>`,
  ];
  for (const k of sockets) {
    const y = pad + (1 + k.slot + 0.5) * px;
    const left = k.side === "L";
    const x = left ? pad : pad + w;
    parts.push(`<line x1="${x}" y1="${y}" x2="${left ? x - px * 0.8 : x + px * 0.8}" y2="${y}" stroke="#1f6feb" stroke-width="1.2"/>`);
    parts.push(`<text x="${left ? x + 3 : x - 3}" y="${y + px * 0.22}" text-anchor="${left ? "start" : "end"}" font-size="${px * 0.6}">${esc(k.name)}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 2 * pad} ${h + 2 * pad}" width="${w + 2 * pad}" height="${h + 2 * pad}" font-family="system-ui, sans-serif">${parts.join("")}</svg>`;
}
