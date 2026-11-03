// The sums behind ConnectCAD's schematics (device.ts, circuit.ts): a device's box with its sockets
// down its sides, where a socket's circuit leaves it, the way a circuit runs from one socket to
// another, where its number is written, the signals and their connectors, cable numbers, and the
// loops that pass a signal from one socket to the one beside it (Socket Loop), and where one circuit
// crosses another and hops it (HopOver). A
// device's own frame has its insertion point at the top-left corner of its box, x across and y up,
// so the box runs down to −height; its rows are a pitch apart, the first kept for its description.
// Kept apart so it runs without the page.

import type { Pt, VertexKind } from "../../../core/index.ts";
import { hopPoints, hopRefusal } from "../../../app/hopOver.ts";

export type SocketType = "IN" | "OUT" | "IO";
export type Side = "L" | "R" | "T" | "B";

export interface Socket {
  /** its own number on its device, which circuits keep to, so a rename doesn't lose them */
  readonly id: number;
  readonly name: string;
  readonly tag: string;
  readonly type: SocketType;
  readonly side: Side;
  /** its place along its side, counted from the top (left and right) or from the left (top and bottom) */
  readonly slot: number;
  readonly signal: string;
  readonly connector: string;
  readonly terminated: boolean;
  /** a loop-thru: the socket beside it on the same device it passes its signal on to, which loops back to it */
  readonly loop?: number;
}

export const SOCKET_TYPES: readonly SocketType[] = ["IN", "OUT", "IO"];
export const SIDES: readonly { readonly side: Side; readonly label: string }[] = [
  { side: "L", label: "Left" },
  { side: "R", label: "Right" },
  { side: "T", label: "Top" },
  { side: "B", label: "Bottom" },
];

export interface Signal {
  readonly name: string;
  readonly category: string;
  /** its letter in a cable number */
  readonly letter: string;
  readonly connectors: readonly string[];
}

export const PASSIVE = "---";
export const UNKNOWN = "???";
export const PROPRIETARY = "$$$";

/** Rodeo's signals: common ones, not Vectorworks' own lists, which come from its settings files. */
export const SIGNALS: readonly Signal[] = [
  { name: "SDI", category: "Video", letter: "V", connectors: ["BNC", "DIN 1.0/2.3"] },
  { name: "HDMI", category: "Video", letter: "V", connectors: ["HDMI"] },
  { name: "DisplayPort", category: "Video", letter: "V", connectors: ["DisplayPort", "Mini DisplayPort"] },
  { name: "Composite Video", category: "Video", letter: "V", connectors: ["BNC", "RCA"] },
  { name: "VGA", category: "Video", letter: "V", connectors: ["HD15"] },
  { name: "Reference", category: "Video", letter: "R", connectors: ["BNC"] },
  { name: "Analog Audio", category: "Audio", letter: "A", connectors: ["XLR3", "TRS", "RCA", "Phoenix"] },
  { name: "AES/EBU", category: "Audio", letter: "A", connectors: ["XLR3", "BNC"] },
  { name: "MADI", category: "Audio", letter: "A", connectors: ["BNC", "SC"] },
  { name: "Speaker Level", category: "Audio", letter: "S", connectors: ["NL4", "NL8", "Bare Wire"] },
  { name: "Timecode", category: "Audio", letter: "T", connectors: ["XLR3", "BNC"] },
  { name: "Ethernet", category: "Network", letter: "N", connectors: ["RJ45", "etherCON"] },
  { name: "Dante", category: "Network", letter: "N", connectors: ["RJ45", "etherCON"] },
  { name: "DMX", category: "Control", letter: "C", connectors: ["XLR5", "XLR3", "RJ45"] },
  { name: "RS-232", category: "Control", letter: "C", connectors: ["DB9", "Phoenix"] },
  { name: "RS-422", category: "Control", letter: "C", connectors: ["DB9"] },
  { name: "GPIO", category: "Control", letter: "C", connectors: ["Phoenix", "DB25"] },
  { name: "MIDI", category: "Control", letter: "C", connectors: ["DIN5"] },
  { name: "Fiber", category: "Optical", letter: "F", connectors: ["LC", "SC", "ST", "opticalCON"] },
  { name: "USB", category: "Computer", letter: "U", connectors: ["USB-A", "USB-B", "USB-C"] },
  { name: "AC Power", category: "Power", letter: "P", connectors: ["IEC C13", "IEC C14", "powerCON", "Edison", "Schuko"] },
  { name: "DC Power", category: "Power", letter: "P", connectors: ["Barrel", "XLR4"] },
];

/** The colour a circuit of each kind of signal is drawn in. */
const CATEGORY_INK: Readonly<Record<string, string>> = {
  Video: "#1f6feb",
  Audio: "#1a7f37",
  Network: "#9a6700",
  Control: "#8250df",
  Optical: "#d4580e",
  Computer: "#0a7ea4",
  Power: "#cf222e",
};
const OTHER_INK = "#57606a";

/** What a drawing's ConnectCAD Settings change here; settings.ts keeps them in the drawing and hands them over. */
export interface FileSettings {
  /** the drawing's own signals, each in place of a built-in one of its name */
  readonly signals: readonly Signal[];
  /** the drawing's own connectors, offered with every signal's */
  readonly connectors: readonly string[];
  /** a Linear Array's numbers have at least this many digits (2: IN01) */
  readonly digits: number;
  /** ports on a panel, by its Device Type, in place of the type's own size */
  readonly panelSizes: Readonly<Record<string, number>>;
  /** a circuit's Cable and Cable Length choices; none leaves the field to type in */
  readonly cables: readonly string[];
  readonly lengths: readonly string[];
  /** circuits hop the ones drawn before them where they cross */
  readonly autoHop: boolean;
}

export const NO_FILE_SETTINGS: FileSettings = { signals: [], connectors: [], digits: 1, panelSizes: {}, cables: [], lengths: [], autoHop: false };
let fileSettings = (): FileSettings => NO_FILE_SETTINGS;
/** Where the open drawing's settings come from (settings.ts); the defaults without one. */
export const readSettingsFrom = (get: () => FileSettings): void => {
  fileSettings = get;
};
export const settingsNow = (): FileSettings => fileSettings();

/** Every signal: the built-in ones, a drawing's own in place of one of its name, then its new ones. */
export function allSignals(): Signal[] {
  const own = fileSettings().signals;
  if (!own.length) return [...SIGNALS];
  const named = new Map(own.map((s) => [s.name, s]));
  return [...SIGNALS.map((s) => named.get(s.name) ?? s), ...own.filter((s) => !SIGNALS.some((b) => b.name === s.name))];
}

export const signalNames = (): string[] => [...allSignals().map((s) => s.name), PASSIVE, UNKNOWN, PROPRIETARY];

export const signalNamed = (name: string): Signal | null => allSignals().find((s) => s.name === name) ?? null;
export const signalInk = (name: string): string => CATEGORY_INK[signalNamed(name)?.category ?? ""] ?? OTHER_INK;
/** a signal's letter in a cable number; X for passive, unknown and proprietary ones */
export const signalLetter = (name: string): string => signalNamed(name)?.letter ?? "X";

/** The connectors a socket of this signal can take: its own first, then none and unknown; any signal's (and the drawing's own) for one it doesn't know. */
export function connectorsFor(signal: string): string[] {
  const own = signalNamed(signal)?.connectors ?? [...new Set([...allSignals().flatMap((s) => s.connectors), ...fileSettings().connectors])];
  return [...own, PASSIVE, UNKNOWN];
}

/** whether a circuit's two ends carry the same signal: passive and unknown sockets go with anything */
export const signalsMatch = (a: string, b: string): boolean => a === b || [PASSIVE, UNKNOWN].includes(a) || [PASSIVE, UNKNOWN].includes(b);

/** rows on paper (mm) a pitch apart, and the box a new device has, in pitches */
export const PITCH_MM = 5;
export const DEFAULT_WIDTH = 8;
export const DEFAULT_ROWS = 4;
/** the rows at the top of the box kept for its description */
const HEADER_ROWS = 1;
/** a device's tag and the rest of its writing on paper, mm */
export const TAG_MM = 2.5;
export const LABEL_MM = 1.8;

export interface Box {
  readonly width: number;
  readonly height: number;
}

const add = (a: Pt, b: Pt, k = 1): Pt => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const perp = (d: Pt): Pt => ({ x: -d.y, y: d.x });
const EPS = 1e-6;

/** The box a device draws: as large as asked, and large enough for its sockets. */
export function boxFor(asked: Box, sockets: readonly Socket[], pitch: number): Box {
  const deepest = Math.max(-1, ...sockets.filter((s) => s.side === "L" || s.side === "R").map((s) => s.slot));
  const widest = Math.max(-1, ...sockets.filter((s) => s.side === "T" || s.side === "B").map((s) => s.slot));
  return { width: Math.max(asked.width, (widest + 1) * pitch, 2 * pitch), height: Math.max(asked.height, (HEADER_ROWS + deepest + 1) * pitch + pitch / 2, 2 * pitch) };
}

/** Where a circuit leaves a socket: the point on the box's edge and the way out, in the device's frame. */
export interface End {
  readonly tip: Pt;
  readonly out: Pt;
}

export function slotEnd(box: Box, side: Side, slot: number, pitch: number): End {
  const y = -(HEADER_ROWS + slot + 0.5) * pitch;
  const x = (slot + 0.5) * pitch;
  if (side === "L") return { tip: { x: 0, y }, out: { x: -1, y: 0 } };
  if (side === "R") return { tip: { x: box.width, y }, out: { x: 1, y: 0 } };
  if (side === "T") return { tip: { x, y: 0 }, out: { x: 0, y: 1 } };
  return { tip: { x, y: -box.height }, out: { x: 0, y: -1 } };
}

/** how far into the box a socket's mark reaches, in pitches */
const MARK = 0.5;

/** The socket of a device at a point of its frame: on its row, from just outside the edge to its label. */
export function socketAt(sockets: readonly Socket[], box: Box, p: Pt, pitch: number): Socket | null {
  let best: { s: Socket; d: number } | null = null;
  for (const s of sockets) {
    const { tip, out } = slotEnd(box, s.side, s.slot, pitch);
    const across = (p.x - tip.x) * out.x + (p.y - tip.y) * out.y;
    const along = Math.abs((p.x - tip.x) * out.y - (p.y - tip.y) * out.x);
    if (along > pitch / 2 || across > pitch || across < -3 * pitch) continue;
    const d = Math.abs(across) + along;
    if (!best || d < best.d) best = { s, d };
  }
  return best?.s ?? null;
}

/**
 * The side and slot a click at `p` (in the device's frame) puts a new socket in: on the side asked, or
 * on the nearest side for Automatic; null when it's off the box by more than a pitch.
 */
export function slotFor(box: Box, p: Pt, pitch: number, side: Side | "auto"): { side: Side; slot: number } | null {
  if (p.x < -pitch || p.x > box.width + pitch || p.y > pitch || p.y < -box.height - pitch) return null;
  const gaps: [Side, number][] = [
    ["L", Math.abs(p.x)],
    ["R", Math.abs(box.width - p.x)],
    ["T", Math.abs(p.y)],
    ["B", Math.abs(p.y + box.height)],
  ];
  const chosen = side === "auto" ? gaps.sort((a, b) => a[1] - b[1])[0][0] : side;
  return { side: chosen, slot: slotOn(chosen, p, pitch) };
}

/** The row along a side that a point of the device's frame is level with, on or off the box. */
export const slotOn = (side: Side, p: Pt, pitch: number): number => (side === "L" || side === "R" ? Math.max(0, Math.floor(-p.y / pitch - HEADER_ROWS)) : Math.max(0, Math.floor(p.x / pitch)));

/** A socket's marks: the green triangle in (input), the red one out (output), both for IO; its label; its terminator. */
export interface SocketMarks {
  readonly triangles: readonly { readonly points: readonly Pt[]; readonly flow: "in" | "out" }[];
  readonly label: { readonly at: Pt; readonly text: string; readonly hAlign: number };
  readonly terminator: readonly Pt[] | null;
}

export function socketMarks(s: Socket, box: Box, pitch: number): SocketMarks {
  const { tip, out } = slotEnd(box, s.side, s.slot, pitch);
  const inward = { x: -out.x, y: -out.y };
  const side = perp(out);
  const t = MARK * pitch;
  const h = t * 0.45;
  const pointingIn = (from: number): Pt[] => [add(add(tip, inward, from), side, h), add(add(tip, inward, from), side, -h), add(tip, inward, from + t)];
  const pointingOut = (from: number): Pt[] => [add(add(tip, inward, from + t), side, h), add(add(tip, inward, from + t), side, -h), add(tip, inward, from)];
  const triangles =
    s.type === "IN"
      ? [{ points: pointingIn(0), flow: "in" as const }]
      : s.type === "OUT"
        ? [{ points: pointingOut(0), flow: "out" as const }]
        : [
            { points: pointingIn(0), flow: "in" as const },
            { points: pointingOut(t), flow: "out" as const },
          ];
  const depth = (s.type === "IO" ? 2 : 1) * t + 0.3 * pitch;
  const hAlign = s.side === "L" ? 1 : s.side === "R" ? 3 : 2;
  const label = { at: add(tip, inward, s.side === "T" || s.side === "B" ? depth + 0.3 * pitch : depth), text: s.tag || s.name, hAlign };
  const k = 0.35 * pitch;
  const terminator = s.terminated ? [add(tip, side, k / 2), add(add(tip, side, k / 2), out, k), add(add(tip, side, -k / 2), out, k), add(tip, side, -k / 2)] : null;
  return { triangles, label, terminator };
}

/** Where a device writes its tag (above the box), its description (in its first row) and its rack (below). */
export function deviceWriting(box: Box, pitch: number): { tag: Pt; description: Pt; rack: Pt } {
  return { tag: { x: box.width / 2, y: 0.25 * pitch }, description: { x: box.width / 2, y: -0.5 * pitch }, rack: { x: box.width / 2, y: -box.height - 0.25 * pitch } };
}

/** A device's name with the next number when the name is taken: CAM1 after CAM1, or DEV2 after DEV. */
export function nextName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const m = /^(.*?)(\d+)$/.exec(name);
  const stem = m ? m[1] : name;
  const width = m ? m[2].length : 1;
  let n = m ? Number(m[2]) : 1;
  for (;;) {
    n++;
    const next = stem + String(n).padStart(width, "0");
    if (!taken.has(next)) return next;
  }
}

/** A name's number given at least `digits` digits: IN1 → IN01. */
export const padNumber = (name: string, digits: number): string => name.replace(/\d+$/, (n) => n.padStart(digits, "0"));

/** A socket's name: the stem and the next free number on its device (IN1, IN2…, or IN01 with 2 `digits`), or the name asked when free. */
export function socketName(asked: string, type: SocketType, taken: ReadonlySet<string>, digits = 1): string {
  const stem = asked.trim() || type;
  if (/\d$/.test(stem)) return nextName(padNumber(stem, digits), taken);
  return nextName(`${stem}${"1".padStart(digits, "0")}`, taken);
}

/** How a socket connects: a looped input passes its signal on to the next device, so it connects either way. */
export const flowOf = (k: Socket): SocketType => (k.loop !== undefined && k.type === "IN" ? "IO" : k.type);

/** Sockets with a loop kept only where both ends name each other, sit side by side on one side, and take a signal in. */
export function cleanLoops(sockets: readonly Socket[]): Socket[] {
  const by = new Map(sockets.map((k) => [k.id, k]));
  return sockets.map((k) => {
    if (k.loop === undefined) return k;
    const o = by.get(k.loop);
    if (o && o.loop === k.id && o.side === k.side && Math.abs(o.slot - k.slot) === 1 && k.type !== "OUT" && o.type !== "OUT") return k;
    const { loop: _gone, ...rest } = k;
    return rest;
  });
}

/** A loop's mark: a half circle outside the device's edge from one socket's tip round to the other's. */
export function loopArc(a: Socket, b: Socket, box: Box, pitch: number, n = 12): Pt[] {
  const ea = slotEnd(box, a.side, a.slot, pitch);
  const tb = slotEnd(box, b.side, b.slot, pitch).tip;
  const c = { x: (ea.tip.x + tb.x) / 2, y: (ea.tip.y + tb.y) / 2 };
  const r = Math.hypot(tb.x - ea.tip.x, tb.y - ea.tip.y) / 2;
  const along = { x: (tb.x - ea.tip.x) / (2 * r || 1), y: (tb.y - ea.tip.y) / (2 * r || 1) };
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (Math.PI * i) / n;
    return add(add(c, along, -r * Math.cos(t)), ea.out, r * Math.sin(t));
  });
}

/** What a Socket Loop click on a device's side does: takes a loop off, or loops two sockets there, adding those missing. */
export type LoopPlan =
  | { readonly kind: "unloop"; readonly ids: readonly [number, number] }
  /** the sockets there already to join, and the slots to add sockets in */
  | { readonly kind: "loop"; readonly join: readonly number[]; readonly add: readonly number[] };

/**
 * A Socket Loop click at `slot` on `side`: a looped socket loses its loop; otherwise the socket there and
 * the one below are looped (or the one above, when only that one is there), each missing one added. An
 * output can't be looped, nor a socket looped already.
 */
export function loopPlan(sockets: readonly Socket[], side: Side, slot: number): LoopPlan | string {
  const at = (k: number): Socket | undefined => sockets.find((x) => x.side === side && x.slot === k);
  const here = at(slot);
  if (here?.loop !== undefined) return { kind: "unloop", ids: [here.id, here.loop] };
  const above = at(slot - 1);
  const pair = here && !at(slot + 1) && above && above.loop === undefined && above.type !== "OUT" ? [slot - 1, slot] : [slot, slot + 1];
  const ends = pair.map(at);
  for (const k of ends) {
    if (k?.type === "OUT") return `${k.name} is an output: a loop joins inputs or IO sockets.`;
    if (k?.loop !== undefined) return `${k.name} is looped already.`;
  }
  return { kind: "loop", join: ends.flatMap((k) => (k ? [k.id] : [])), add: pair.filter((_, i) => !ends[i]) };
}

/**
 * The rows a Linear Array of sockets fills on one side, from slot `from` to slot `to`: each free row,
 * or for loops each two free rows side by side, in order.
 */
export function rowSlots(sockets: readonly Socket[], side: Side, from: number, to: number, looped: boolean): number[][] {
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.max(0, from, to);
  const free = (k: number): boolean => !sockets.some((x) => x.side === side && x.slot === k);
  const out: number[][] = [];
  for (let k = lo; k <= hi; k++) {
    if (!free(k)) continue;
    if (!looped) out.push([k]);
    else if (k + 1 <= hi && free(k + 1)) out.push([k, ++k]);
  }
  return out;
}

/** Which end of a circuit a socket can be: an output's the source, an input's the destination, IO either. */
export const canSource = (t: SocketType): boolean => t !== "IN";
export const canReceive = (t: SocketType): boolean => t !== "OUT";

/**
 * The two sockets a circuit drawn from `first` to `second` joins, source first, or why it can't: an
 * input clicked first becomes the destination, as Vectorworks draws them, so the circuit runs as its
 * signal does. `reversed` tells the caller to turn its corners round.
 */
export function circuitEnds(first: SocketType, second: SocketType): { reversed: boolean } | string {
  if (canSource(first) && canReceive(second)) return { reversed: false };
  if (canReceive(first) && canSource(second)) return { reversed: true };
  return first === "IN" ? "Two inputs can't be connected: an input takes its signal from an output or IO socket." : "Two outputs can't be connected: an output sends its signal to an input or IO socket.";
}

const horizontal = (d: Pt): boolean => Math.abs(d.x) > Math.abs(d.y);

/** Corners from a socket's stub end `p` leaving along `dp` to the other's `q`, which the run arrives at against `dq`. */
/** A device's extent on the drawing, for a circuit to run round. */
export interface Bounds {
  readonly lo: Pt;
  readonly hi: Pt;
}

function manhattan(p: Pt, dp: Pt, q: Pt, dq: Pt, stub: number, boxes: readonly Bounds[]): Pt[] {
  const swap = (v: Pt): Pt => ({ x: v.y, y: v.x });
  // the same sums serve upright stubs with x and y swapped
  if (!horizontal(dp) && !horizontal(dq)) return manhattan(swap(p), swap(dp), swap(q), swap(dq), stub, boxes.map((b) => ({ lo: swap(b.lo), hi: swap(b.hi) }))).map(swap);
  if (horizontal(dp) && !horizontal(dq)) return [p, { x: q.x, y: p.y }, q];
  if (!horizontal(dp) && horizontal(dq)) return [p, { x: p.x, y: q.y }, q];
  if (Math.sign(dp.x) === Math.sign(dq.x)) {
    // both leave the same way: out past the further, then back along the other's row, or round a
    // device in the way (a loop-thru's second socket feeding a device on its far side)
    const x = dp.x > 0 ? Math.max(p.x, q.x) : Math.min(p.x, q.x);
    const inWay = boxes.filter((b) => q.y > b.lo.y && q.y < b.hi.y && Math.min(x, q.x) < b.hi.x && Math.max(x, q.x) > b.lo.x);
    if (!inWay.length) return [p, { x, y: p.y }, { x, y: q.y }, q];
    const above = Math.max(...inWay.map((b) => b.hi.y)) + stub;
    const below = Math.min(...inWay.map((b) => b.lo.y)) - stub;
    const y = Math.abs(above - p.y) < Math.abs(below - p.y) ? above : below;
    return [p, { x, y: p.y }, { x, y }, { x: q.x, y }, q];
  }
  if ((q.x - p.x) * dp.x >= 0) {
    const x = (p.x + q.x) / 2;
    return [p, { x, y: p.y }, { x, y: q.y }, q];
  }
  // backward: across between their rows, or under them when level
  const y = Math.abs(p.y - q.y) < EPS ? p.y - 2 * stub : (p.y + q.y) / 2;
  return [p, { x: p.x, y }, { x: q.x, y }, q];
}

/** Takes out repeated points and the middle of three in a line. */
export function simplify(points: readonly Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < EPS) continue;
    const before = out[out.length - 2];
    if (last && before && Math.abs((last.x - before.x) * (p.y - before.y) - (last.y - before.y) * (p.x - before.x)) < EPS * Math.max(1, Math.hypot(p.x - before.x, p.y - before.y))) out.pop();
    out.push(p);
  }
  return out;
}

/**
 * The way a circuit runs from its source's end `a` to its destination's `b`: a stub straight out of each
 * socket and square corners between (round `boxes`, its devices, when it would run back across one),
 * or through the corners it was drawn with.
 */
export function route(a: End, b: End, corners: readonly Pt[], stub: number, boxes: readonly Bounds[] = []): Pt[] {
  const s1 = add(a.tip, a.out, stub);
  const d1 = add(b.tip, b.out, stub);
  const middle = corners.length ? [s1, ...corners, d1] : manhattan(s1, a.out, d1, b.out, stub, boxes);
  return simplify([a.tip, ...middle, b.tip]);
}

export const pathLength = (points: readonly Pt[]): number => points.slice(1).reduce((n, p, i) => n + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);

/** The point `d` along a path and the way it runs there. */
export function along(points: readonly Pt[], d: number): { at: Pt; dir: Pt } {
  let left = Math.max(0, d);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.hypot(b.x - a.x, b.y - a.y);
    if (n < EPS) continue;
    const dir = { x: (b.x - a.x) / n, y: (b.y - a.y) / n };
    if (left <= n || i === points.length - 1) return { at: add(a, dir, Math.min(left, n)), dir };
    left -= n;
  }
  return { at: points[0] ?? { x: 0, y: 0 }, dir: { x: 1, y: 0 } };
}

export const NUMBER_DISPLAYS = ["Auto", "Source", "Destination", "Both", "Mid", "None"] as const;
export type NumberDisplay = (typeof NUMBER_DISPLAYS)[number];

export interface Writing {
  readonly at: Pt;
  readonly hAlign: number;
  readonly vAlign: number;
}

/** Writing beside a path at `d` along it: over a level run, to the side of an upright one. */
function beside(points: readonly Pt[], d: number, gap: number, centred: boolean): Writing {
  const { at, dir } = along(points, d);
  if (horizontal(dir)) return { at: { x: at.x, y: at.y + gap }, hAlign: centred ? 2 : dir.x > 0 ? 1 : 3, vAlign: 5 };
  return { at: { x: at.x + gap, y: at.y }, hAlign: 1, vAlign: centred ? 3 : dir.y > 0 ? 5 : 1 };
}

/** Where a circuit writes its number: at its ends, its middle, or not at all; Auto writes the middle on a short run. */
export function numberPlaces(points: readonly Pt[], display: NumberDisplay, pitch: number): Writing[] {
  const length = pathLength(points);
  if (display === "None" || length < EPS) return [];
  const gap = 0.15 * pitch;
  const near = Math.min(0.35 * pitch, length / 4);
  const source = (): Writing => beside(points, near, gap, false);
  const destination = (): Writing => {
    const back = [...points].reverse();
    return beside(back, near, gap, false);
  };
  const mid = (): Writing => beside(points, length / 2, gap, true);
  if (display === "Source") return [source()];
  if (display === "Destination") return [destination()];
  if (display === "Mid") return [mid()];
  if (display === "Both" || length >= 8 * pitch) return [source(), destination()];
  return [mid()];
}

/** An arrow circuit's end: a stub out of the socket with a head (outward at the source, back toward the socket at the destination) and where its note goes. */
export function arrowEnd(e: End, pitch: number, source: boolean): { line: [Pt, Pt]; head: Pt[]; note: Writing } {
  const length = 3 * pitch;
  const far = add(e.tip, e.out, length);
  const h = 0.35 * pitch;
  const side = perp(e.out);
  const apex = source ? far : add(e.tip, e.out, 0.15 * pitch);
  const back = source ? -1 : 1;
  const base = add(apex, e.out, back * h * 1.6);
  const head = [apex, add(base, side, h / 2), add(base, side, -h / 2)];
  const at = add(far, e.out, 0.2 * pitch);
  const note = horizontal(e.out) ? { at, hAlign: e.out.x > 0 ? 1 : 3, vAlign: 3 } : { at, hAlign: 2, vAlign: e.out.y > 0 ? 5 : 1 };
  return { line: [e.tip, far], head, note };
}

/** The warning triangle a disconnected circuit shows at its loose end. */
export function warningTriangle(at: Pt, pitch: number): Pt[] {
  const r = 0.6 * pitch;
  return [
    { x: at.x, y: at.y + r },
    { x: at.x - r * 0.9, y: at.y - r * 0.55 },
    { x: at.x + r * 0.9, y: at.y - r * 0.55 },
  ];
}

export const NUMBERING_SYSTEMS = ["Signal and Sequence", "Source Device and Sequence", "Source Device and Socket", "Sequence"] as const;
export type NumberingSystem = (typeof NUMBERING_SYSTEMS)[number];
export const NUMBERING_DIRECTIONS = ["Left to Right, then Down", "Top to Bottom, then Right", "Drawing Order"] as const;
export type NumberingDirection = (typeof NUMBERING_DIRECTIONS)[number];

export interface NumberingCircuit {
  readonly id: string;
  readonly signal: string;
  readonly sourceDevice: string;
  readonly sourceSocket: string;
  /** where its source end is, for the numbering direction */
  readonly at: Pt;
}

/**
 * Cable numbers for circuits without one, in the order the direction gives, by the numbering system;
 * a number already in `taken` is skipped, so circuits numbered before keep theirs and none repeats.
 */
export function cableNumbers(circuits: readonly NumberingCircuit[], system: NumberingSystem, direction: NumberingDirection, digits: number, taken: ReadonlySet<string>): Map<string, string> {
  const order = circuits.map((c, i) => ({ c, i }));
  if (direction === "Left to Right, then Down") order.sort((a, b) => b.c.at.y - a.c.at.y || a.c.at.x - b.c.at.x || a.i - b.i);
  else if (direction === "Top to Bottom, then Right") order.sort((a, b) => a.c.at.x - b.c.at.x || b.c.at.y - a.c.at.y || a.i - b.i);
  const used = new Set(taken);
  const counters = new Map<string, number>();
  const out = new Map<string, string>();
  const pad = (n: number): string => String(n).padStart(Math.max(1, digits), "0");
  const fresh = (stem: string, joiner: string): string => {
    let n = counters.get(stem) ?? 0;
    let text: string;
    do {
      n++;
      text = `${stem}${stem ? joiner : ""}${pad(n)}`;
    } while (used.has(text));
    counters.set(stem, n);
    return text;
  };
  for (const { c } of order) {
    let text: string;
    if (system === "Signal and Sequence") text = fresh(signalLetter(c.signal), "");
    else if (system === "Source Device and Sequence") text = fresh(c.sourceDevice, "-");
    else if (system === "Sequence") text = fresh("", "");
    else {
      const stem = `${c.sourceDevice}-${c.sourceSocket}`;
      text = used.has(stem) ? fresh(stem, "-") : stem;
    }
    used.add(text);
    out.set(c.id, text);
  }
  return out;
}

/** A crossing of two runs: the piece of the first (from 0) and the point. */
export interface Crossing {
  readonly piece: number;
  readonly at: Pt;
}

/** Where run `b` crosses run `a`: their straight pieces crossing, not meeting at an end or running along each other. */
export function crossings(a: readonly Pt[], b: readonly Pt[]): Crossing[] {
  const out: Crossing[] = [];
  for (let i = 1; i < a.length; i++) {
    const p = a[i - 1];
    const r = { x: a[i].x - p.x, y: a[i].y - p.y };
    for (let j = 1; j < b.length; j++) {
      const q = b[j - 1];
      const s = { x: b[j].x - q.x, y: b[j].y - q.y };
      const den = r.x * s.y - r.y * s.x;
      if (Math.abs(den) < EPS * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) continue;
      const t = ((q.x - p.x) * s.y - (q.y - p.y) * s.x) / den;
      const u = ((q.x - p.x) * r.y - (q.y - p.y) * r.x) / den;
      if (t > EPS && t < 1 - EPS && u > EPS && u < 1 - EPS) out.push({ piece: i - 1, at: { x: p.x + r.x * t, y: p.y + r.y * t } });
    }
  }
  return out;
}

/** A hop wanted over a crossing: its radius, and whether it bows down (or right on an upright piece). */
export interface Hop extends Crossing {
  readonly radius: number;
  readonly down: boolean;
}

/**
 * A circuit's run drawn with a half-circle hop over each crossing in `hops`: its points and their
 * kinds, a hop's top a point the arc passes through. A hop that would reach past a corner, or overlap
 * another, is left out.
 */
export function hopped(points: readonly Pt[], hops: readonly Hop[]): { points: Pt[]; vertices: VertexKind[] } {
  const out: Pt[] = [points[0]];
  const kinds: VertexKind[] = ["corner"];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const along = (p: Pt): number => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / (len || 1);
    let reached = 0;
    for (const h of hops.filter((h) => h.piece === i - 1).sort((x, y) => along(x.at) - along(y.at))) {
      if (len < EPS || hopRefusal({ i: i - 1, a, b }, h.at, h.radius) || along(h.at) - h.radius < reached - EPS) continue;
      const [before, top, after] = hopPoints({ i: i - 1, a, b }, h.at, h.radius, h.down);
      out.push(before, top, after);
      kinds.push("corner", "through", "corner");
      reached = along(h.at) + h.radius;
    }
    out.push(b);
    kinds.push("corner");
  }
  return { points: out, vertices: kinds };
}
