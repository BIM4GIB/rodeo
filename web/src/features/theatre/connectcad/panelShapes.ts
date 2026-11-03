// The sums behind ConnectCAD's Term Panel, Jackfield, Linked Jackfield and Connector Panel tools
// (tools.ts) and their panel devices (schematic.ts). A schematic panel device is one port of a physical
// panel: devices of one panel share its name (prefix, group and panel: JA1) and each has its own port. A
// term panel's port takes a circuit from either side; a jack's top takes an output in on its left and
// its bottom feeds an input from its right, linked through in a linked (normalled) jack. Ports count on
// to the panel's size, then on to the next panel. A connector panel is a custom panel at a facilities
// box (BOX1), its ports named by a code and number (MIC01), each an input or output connector wired
// through to the system. Kept apart so it runs without the page.

import { PASSIVE, settingsNow, signalNamed, UNKNOWN, type Socket } from "./ccadShapes.ts";

export type PanelKind = "term" | "jack" | "linked" | "connector";

export interface PanelType {
  readonly kind: PanelKind;
  /** its Device Type, and the Tool bar's mode */
  readonly device: string;
  readonly signal: string;
  readonly connector: string;
  /** the signal category it carries; null for anything */
  readonly category: string | null;
  /** ports on a panel */
  readonly size: number;
}

export const PANEL_TYPES: readonly PanelType[] = [
  { kind: "term", device: "Video Term Panel", signal: "SDI", connector: "BNC", category: "Video", size: 32 },
  { kind: "term", device: "Audio Term Panel", signal: "Analog Audio", connector: "XLR3", category: "Audio", size: 32 },
  { kind: "term", device: "Data Term Panel", signal: "Ethernet", connector: "RJ45", category: "Network", size: 24 },
  { kind: "term", device: "Optical Term Panel", signal: "Fiber", connector: "LC", category: "Optical", size: 24 },
  { kind: "term", device: "DIN Rail Term Panel", signal: PASSIVE, connector: "Phoenix", category: null, size: 32 },
  { kind: "jack", device: "Video Jack", signal: "SDI", connector: "BNC", category: "Video", size: 32 },
  { kind: "jack", device: "Audio Jack", signal: "Analog Audio", connector: "TRS", category: "Audio", size: 48 },
  { kind: "jack", device: "Data Jack", signal: "Ethernet", connector: "RJ45", category: "Network", size: 24 },
  { kind: "jack", device: "Optical Jack", signal: "Fiber", connector: "LC", category: "Optical", size: 24 },
  { kind: "linked", device: "U-Linked Video Jack", signal: "SDI", connector: "BNC", category: "Video", size: 32 },
  { kind: "linked", device: "Full-Normal Audio Jack", signal: "Analog Audio", connector: "TRS", category: "Audio", size: 48 },
  { kind: "linked", device: "Half-Normal Audio Jack", signal: "Analog Audio", connector: "TRS", category: "Audio", size: 48 },
  { kind: "linked", device: "Normal Data Jack", signal: "Ethernet", connector: "RJ45", category: "Network", size: 24 },
  { kind: "linked", device: "Linked Optical Jack", signal: "Fiber", connector: "LC", category: "Optical", size: 24 },
  { kind: "connector", device: "Connector Panel Input", signal: UNKNOWN, connector: "XLR3", category: null, size: 999 },
  { kind: "connector", device: "Connector Panel Output", signal: UNKNOWN, connector: "XLR3", category: null, size: 999 },
];

export const panelTypeOf = (device: string): PanelType | null => PANEL_TYPES.find((t) => t.device === device) ?? null;
export const panelTypes = (kind: PanelKind): PanelType[] => PANEL_TYPES.filter((t) => t.kind === kind);
/** Ports on a panel of this type: the drawing's ConnectCAD Settings' size for it, or its own. */
export const panelSize = (t: PanelType): number => Math.max(1, Math.round(settingsNow().panelSizes[t.device] ?? t.size));

/** what a kind's panel names start with */
export const PANEL_PREFIX: Readonly<Record<PanelKind, string>> = { term: "TP", jack: "J", linked: "J", connector: "CTP_" };
/** a new panel device's width, in pitches */
export const PANEL_WIDTH = 4;
/** panel devices a linear array places at most */
export const MAX_PORTS = 100;

/** Where a port is: its panel's group (A, B…) and number, and its own number. */
export interface PortPlace {
  readonly group: string;
  readonly panel: number;
  readonly port: number;
}

/** A group: letters only, upper case; A when there are none. */
export const groupOf = (text: string): string => text.toUpperCase().replace(/[^A-Z]/g, "") || "A";
const whole = (n: number): number => Math.max(1, Math.round(Number.isFinite(n) ? n : 1));

export const panelName = (prefix: string, place: Pick<PortPlace, "group" | "panel">): string => `${prefix}${place.group}${place.panel}`;
export const panelTag = (place: Pick<PortPlace, "group" | "panel">): string => `${place.group}${place.panel}`;
export const portLabel = (port: number): string => String(whole(port)).padStart(2, "0");
const key = (prefix: string, p: PortPlace): string => `${panelName(prefix, p)}/${p.port}`;
/** The key a port taken in the drawing is kept by, for nextPorts. */
export const portKey = (name: string, port: number): string => `${name}/${port}`;

/**
 * The places of `count` ports from `start` on, skipping ports the drawing has already (`taken`, by
 * portKey) and panels holding another type (`others`, by name): past the panel's `size`, on to port 1
 * of the next panel.
 */
export function nextPorts(prefix: string, start: PortPlace, count: number, size: number, taken: ReadonlySet<string>, others: ReadonlySet<string> = new Set()): PortPlace[] {
  const out: PortPlace[] = [];
  let p: PortPlace = { group: groupOf(start.group), panel: whole(start.panel), port: whole(start.port) };
  if (p.port > size) p = { ...p, panel: p.panel + 1, port: 1 };
  while (out.length < count) {
    if (others.has(panelName(prefix, p))) {
      p = { ...p, panel: p.panel + 1, port: 1 };
      continue;
    }
    if (!taken.has(key(prefix, p))) out.push(p);
    p = p.port >= size ? { ...p, panel: p.panel + 1, port: 1 } : { ...p, port: p.port + 1 };
  }
  return out;
}

/** The place after `p`, on a panel of `size` ports. */
export const afterPort = (p: PortPlace, size: number): PortPlace => (p.port >= size ? { ...p, panel: p.panel + 1, port: 1 } : { ...p, port: p.port + 1 });

/** Whether a panel type can carry a signal: its own category's, or a passive or unknown one; a DIN rail anything. */
export const panelCarries = (t: PanelType, signal: string): boolean => t.category === null || [PASSIVE, UNKNOWN].includes(signal) || signalNamed(signal)?.category === t.category;

/** Whether a panel's two sockets are joined through it when nothing is patched: a term panel's and a linked jack's are. */
export const linkedThrough = (t: PanelType): boolean => t.kind !== "jack";

/**
 * A panel device's sockets: a row for each of its ports, numbered on from `port`, a socket on its left
 * and one on its right, both named by the port. A term panel's take a circuit either way; a jack's left
 * takes one in and its right sends one out. With no sockets yet, one row. Sockets it has already keep
 * their ids, so circuits stay joined; its rows close up from the top.
 */
export function panelSockets(t: PanelType, port: number, signal: string, connector: string, existing: readonly Socket[] = []): Socket[] {
  const slots = [...new Set(existing.filter((k) => k.side === "L" || k.side === "R").map((k) => k.slot))].sort((a, b) => a - b);
  let id = Math.max(0, ...existing.map((k) => k.id));
  return (slots.length ? slots : [0]).flatMap((slot, i) => {
    const name = portLabel(whole(port) + i);
    const make = (side: "L" | "R", type: Socket["type"]): Socket => {
      const had = existing.find((k) => k.side === side && k.slot === slot);
      return had ? { ...had, name, tag: name, slot: i } : { id: ++id, name, tag: name, type, side, slot: i, signal, connector, terminated: false };
    };
    return [make("L", t.kind === "term" ? "IO" : "IN"), make("R", t.kind === "term" ? "IO" : "OUT")];
  });
}

/** A panel device's ports, as its sockets name them, each once. */
export const portsIn = (sockets: readonly Socket[]): string[] => [...new Set(sockets.map((k) => k.name))];

/** A connector panel's name as typed (BOX1, FOH-B2) as a group and panel: its letters, and its last number (1 when it has none). */
export function panelPlaceOf(text: string): Pick<PortPlace, "group" | "panel"> {
  const n = /(\d+)\D*$/.exec(text);
  return { group: groupOf(text), panel: n ? whole(Number(n[1])) : 1 };
}

/** A connector panel's port: its code and number (MIC01), or the code alone for no number (0). */
export const connectorPort = (code: string, port: number): string => (port > 0 ? `${code.trim()}${portLabel(port)}` : code.trim() || "---");

/**
 * The numbers of a connector panel's next `count` ports of `code` from `start` on, past those `taken`
 * (its ports, by connectorPort); all 0 (no number) from 0.
 */
export function nextConnectorPorts(code: string, start: number, count: number, taken: ReadonlySet<string>): number[] {
  if (!(start > 0)) return Array.from({ length: count }, () => 0);
  const out: number[] = [];
  for (let n = whole(start); out.length < count; n++) if (!taken.has(connectorPort(code, n))) out.push(n);
  return out;
}

/**
 * A connector panel device's sockets: a row for each of a multi-circuit connector's `circuits`, an input
 * on its left and an output on its right, named by the port (MIC01), or MIC01.1, MIC01.2… for several.
 * Sockets it has keep their ids, signals and connectors; rows past `circuits` go.
 */
export function connectorSockets(port: string, circuits: number, signal: string, connector: string, existing: readonly Socket[] = []): Socket[] {
  const count = Math.min(MAX_PORTS, whole(circuits));
  const slots = [...new Set(existing.filter((k) => k.side === "L" || k.side === "R").map((k) => k.slot))].sort((a, b) => a - b);
  let id = Math.max(0, ...existing.map((k) => k.id));
  return Array.from({ length: count }, (_, i) => {
    const name = count > 1 ? `${port}.${i + 1}` : port;
    const make = (side: "L" | "R"): Socket => {
      const had = slots[i] === undefined ? undefined : existing.find((k) => k.side === side && k.slot === slots[i]);
      return had ? { ...had, name, tag: name, slot: i } : { id: ++id, name, tag: name, type: side === "L" ? "IN" : "OUT", side, slot: i, signal, connector, terminated: false };
    };
    return [make("L"), make("R")];
  }).flat();
}

/** The rows of a connector panel device that `circuits` would take away holding a circuit (by socket id, in `joined`): their names. */
export const rowsLost = (existing: readonly Socket[], circuits: number, joined: ReadonlySet<number>): string[] => {
  const slots = [...new Set(existing.map((k) => k.slot))].sort((a, b) => a - b).slice(whole(circuits));
  return [...new Set(existing.filter((k) => slots.includes(k.slot) && joined.has(k.id)).map((k) => k.name))];
};
