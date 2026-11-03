// The sums behind ConnectCAD's Check Drawing (markup.ts) and Renumber ConnectCAD Objects (dialogs.ts):
// what's wrong with a schematic, from plain facts about its devices and circuits, and the labels a
// renumbering gives. Kept apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";
import { signalsMatch } from "./ccadShapes.ts";

export type Severity = "Error" | "Warning" | "Notify";
export const SEVERITIES: readonly Severity[] = ["Error", "Warning", "Notify"];
export type CheckKind = "Sockets" | "Devices" | "Circuits" | "Signals";
export const CHECK_KINDS: readonly CheckKind[] = ["Sockets", "Devices", "Circuits", "Signals"];

export interface CheckedDevice {
  readonly id: string;
  /** the layer its markup goes on */
  readonly layerId?: string;
  readonly name: string;
  readonly tag: string;
  /** its box on the drawing */
  readonly outline: readonly Pt[];
  readonly sockets: readonly { readonly id: number; readonly name: string; readonly tip: Pt; readonly side?: string }[];
  /** a panel device's ports (a term panel's or jackfield's): devices of one panel share its name, and a port is on both its sides */
  readonly ports?: readonly string[];
  /** an adapter, and whether it's on a socket: adapters go by their make, not a name of their own */
  readonly adapter?: { readonly onSocket: boolean };
}

export interface CheckedCircuit {
  readonly id: string;
  readonly layerId?: string;
  readonly number: string;
  /** false when its device or socket at that end has gone */
  readonly sourceJoined: boolean;
  readonly destinationJoined: boolean;
  readonly sourceSignal: string;
  readonly destinationSignal: string;
  /** what it says it joins, for the markup's information */
  readonly source: string;
  readonly destination: string;
  /** halfway along its run */
  readonly mid: Pt;
}

export interface Issue {
  readonly severity: Severity;
  /** what found it: a Check Drawing check, Compare Cable List and Drawing, or Calculate Cable Lengths */
  readonly kind: CheckKind | "Cable List" | "Cable Lengths" | "Cable Routes";
  readonly problem: string;
  readonly information: string;
  /** issues of one finding (the devices of a name used twice) share it, for Previous and Next Markup */
  readonly group: string;
  /** the markup's outline on the drawing, and the layer of what it marks */
  readonly outline: readonly Pt[];
  readonly layerId: string;
}

/** A ring of `n` points round a point. */
export function ringAround(at: Pt, r: number, n = 20): Pt[] {
  return Array.from({ length: n }, (_, i) => ({ x: at.x + r * Math.cos((2 * Math.PI * i) / n), y: at.y + r * Math.sin((2 * Math.PI * i) / n) }));
}

/** An outline pushed out from its middle by `by` (a box's corners stay square for a box). */
export function grown(outline: readonly Pt[], by: number): Pt[] {
  const c = { x: outline.reduce((n, p) => n + p.x, 0) / outline.length, y: outline.reduce((n, p) => n + p.y, 0) / outline.length };
  return outline.map((p) => {
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    return { x: p.x + Math.sign(dx) * by, y: p.y + Math.sign(dy) * by };
  });
}

/** Groups of more than one with the same key. */
function repeats<T>(items: readonly T[], key: (t: T) => string): T[][] {
  const by = new Map<string, T[]>();
  for (const t of items) {
    const k = key(t);
    if (k) by.set(k, [...(by.get(k) ?? []), t]);
  }
  return [...by.values()].filter((g) => g.length > 1);
}

/**
 * What's wrong, for the checks asked: a socket name twice on a device (error); a device name twice or
 * none (warning), a display tag twice (notify), panel devices aside, which share their panel's name
 * and tag, but a panel's port twice (warning), and adapters, but one off its socket (warning); a
 * circuit number twice (warning) or a circuit whose
 * device or socket has gone (error); a circuit joining two signals that differ (notify). `pitch` sizes
 * the markup.
 */
export function findIssues(devices: readonly CheckedDevice[], circuits: readonly CheckedCircuit[], checks: ReadonlySet<CheckKind>, pitch: number): Issue[] {
  const out: Issue[] = [];
  if (checks.has("Sockets")) {
    for (const d of devices) {
      // a panel's port is one socket, on both its sides
      for (const g of repeats(d.sockets, (k) => (d.ports === undefined ? k.name : `${k.name}/${k.side}`))) {
        for (const k of g) out.push({ severity: "Error", kind: "Sockets", problem: "Duplicate socket name", information: `${d.name} : ${k.name}`, group: `socket:${d.id}:${k.name}`, outline: ringAround(k.tip, 0.6 * pitch), layerId: d.layerId ?? "" });
      }
    }
  }
  if (checks.has("Devices")) {
    const ports = devices.flatMap((d) => (d.ports ?? []).map((port) => ({ d, port })));
    const plain = devices.filter((d) => d.ports === undefined && !d.adapter);
    for (const g of repeats(ports, (p) => `${p.d.name}/${p.port}`)) {
      for (const { d, port } of g) out.push({ severity: "Warning", kind: "Devices", problem: "Duplicate panel port", information: `${d.name} port ${port}`, group: `port:${d.name}/${port}`, outline: grown(d.outline, 0.5 * pitch), layerId: d.layerId ?? "" });
    }
    for (const g of repeats(plain, (d) => d.name)) {
      for (const d of g) out.push({ severity: "Warning", kind: "Devices", problem: "Duplicate device name", information: d.name, group: `device:${d.name}`, outline: grown(d.outline, 0.5 * pitch), layerId: d.layerId ?? "" });
    }
    for (const d of devices) if (d.adapter && !d.adapter.onSocket) out.push({ severity: "Warning", kind: "Devices", problem: "Adapter is not on a socket", information: d.name || "Adapter", group: `adapter:${d.id}`, outline: grown(d.outline, 0.5 * pitch), layerId: d.layerId ?? "" });
    for (const d of plain) if (!d.name.trim()) out.push({ severity: "Warning", kind: "Devices", problem: "Device has no name", information: d.tag || "(no name)", group: `unnamed:${d.id}`, outline: grown(d.outline, 0.5 * pitch), layerId: d.layerId ?? "" });
    const named = new Set(out.filter((i) => i.kind === "Devices").map((i) => i.group));
    for (const g of repeats(plain, (d) => d.tag)) {
      // a tag twice because the name is twice is already marked
      if (named.has(`device:${g[0].name}`) && g.every((d) => d.name === g[0].name)) continue;
      for (const d of g) out.push({ severity: "Notify", kind: "Devices", problem: "Duplicate display tag", information: `${d.tag} (${d.name})`, group: `tag:${d.tag}`, outline: grown(d.outline, 0.75 * pitch), layerId: d.layerId ?? "" });
    }
  }
  if (checks.has("Circuits")) {
    for (const g of repeats(circuits, (c) => c.number.trim())) {
      for (const c of g) out.push({ severity: "Warning", kind: "Circuits", problem: "Duplicate circuit number", information: `${c.number}: ${c.source} to ${c.destination}`, group: `circuit:${c.number}`, outline: ringAround(c.mid, 0.8 * pitch), layerId: c.layerId ?? "" });
    }
    for (const c of circuits) {
      if (c.sourceJoined && c.destinationJoined) continue;
      const loose = !c.sourceJoined && !c.destinationJoined ? "either end" : !c.sourceJoined ? "its source" : "its destination";
      out.push({ severity: "Error", kind: "Circuits", problem: `Circuit is disconnected at ${loose}`, information: `${c.number || "(no number)"}: ${c.source} to ${c.destination}`, group: `loose:${c.id}`, outline: ringAround(c.mid, 0.8 * pitch), layerId: c.layerId ?? "" });
    }
  }
  if (checks.has("Signals")) {
    for (const c of circuits) {
      if (!c.sourceJoined || !c.destinationJoined || signalsMatch(c.sourceSignal, c.destinationSignal)) continue;
      out.push({ severity: "Notify", kind: "Signals", problem: `Signals differ: ${c.sourceSignal} to ${c.destinationSignal}`, information: `${c.number || "(no number)"}: ${c.source} to ${c.destination}`, group: `signal:${c.id}`, outline: ringAround(c.mid, 0.8 * pitch), layerId: c.layerId ?? "" });
    }
  }
  const rank = (s: Severity): number => SEVERITIES.indexOf(s);
  return out.sort((a, b) => rank(a.severity) - rank(b.severity));
}

/** What an issue is about, as the ConnectCAD Status palette's Object column names it. */
export function issueObject(i: Issue): string {
  if (i.kind === "Sockets") return "Socket";
  if (i.kind === "Circuits" || i.kind === "Signals") return "Circuit";
  if (i.kind === "Devices") return i.problem.startsWith("Adapter") ? "Adapter" : i.problem === "Duplicate panel port" ? "Panel" : "Device";
  return i.kind;
}

/** An issue's key, for keeping it ignored while the drawing changes: what it is and what it names, not where its markup is. */
export const issueKey = (i: Issue): string => `${i.kind}|${i.problem}|${i.information}`;

/** A row of the ConnectCAD Status palette: its issue, whether it's ignored, and the issues of its finding (the devices of a name used twice), itself among them, for its View buttons. */
export interface StatusRow {
  readonly issue: Issue;
  readonly key: string;
  readonly ignored: boolean;
  readonly others: readonly Issue[];
}

/** The palette's rows: errors, then warnings, then notes, the ignored ones (by issueKey) greyed at the foot in the same order. */
export function statusRows(issues: readonly Issue[], ignored: ReadonlySet<string>): StatusRow[] {
  const groups = new Map<string, Issue[]>();
  for (const i of issues) groups.set(i.group, [...(groups.get(i.group) ?? []), i]);
  const rank = (s: Severity): number => SEVERITIES.indexOf(s);
  return issues
    .map((issue) => ({ issue, key: issueKey(issue), ignored: ignored.has(issueKey(issue)), others: groups.get(issue.group) ?? [issue] }))
    .sort((a, b) => Number(a.ignored) - Number(b.ignored) || rank(a.issue.severity) - rank(b.issue.severity));
}

/** A count in letters: 0 is A, 25 Z, 26 AA. */
export function letters(n: number): string {
  let k = Math.max(0, Math.floor(n));
  let out = "";
  do {
    out = String.fromCharCode(65 + (k % 26)) + out;
    k = Math.floor(k / 26) - 1;
  } while (k >= 0);
  return out;
}

/** Where a letter label counts from: A is 0, AA 26. */
export function letterIndex(text: string): number {
  const t = text.trim().toUpperCase();
  if (!/^[A-Z]+$/.test(t)) return 0;
  return [...t].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;
}

export interface Labeling {
  readonly style: "Numeric" | "Alpha";
  /** a number to start from, or letters */
  readonly start: string;
  readonly increment: number;
  /** numeric: digits, with leading zeros */
  readonly digits: number;
  readonly upper: boolean;
  readonly delimiter: string;
}

/** The `k`th label of a renumbering, counting from 0. */
export function labelAt(k: number, l: Labeling): string {
  if (l.style === "Alpha") {
    const text = letters(letterIndex(l.start) + k * l.increment);
    return l.upper ? text : text.toLowerCase();
  }
  const n = (Number(l.start) || 0) + k * l.increment;
  return (n < 0 ? "-" : "") + String(Math.abs(n)).padStart(Math.max(1, l.digits), "0");
}

/** A name without its old number: the digits at its end and the delimiter before them. */
export function stemOf(name: string): string {
  return name.replace(/\d+$/, "").replace(/[-_. ]$/, "");
}

/** A name renumbered: the prefix asked (or the name's own stem), the delimiter and the label. */
export function renamed(old: string, prefix: string, label: string, delimiter: string): string {
  const stem = prefix || stemOf(old);
  return stem ? `${stem}${delimiter}${label}` : label;
}

/** The order to renumber in: as drawn, by rows from the top, or by columns from the left. */
export function renumberOrder<T extends { readonly at: Pt }>(items: readonly T[], direction: "Drawing Order" | "Left to Right, then Down" | "Top to Bottom, then Right"): T[] {
  const list = items.map((t, i) => ({ t, i }));
  if (direction === "Left to Right, then Down") list.sort((a, b) => b.t.at.y - a.t.at.y || a.t.at.x - b.t.at.x || a.i - b.i);
  else if (direction === "Top to Bottom, then Right") list.sort((a, b) => a.t.at.x - b.t.at.x || b.t.at.y - a.t.at.y || a.i - b.i);
  return list.map((x) => x.t);
}
