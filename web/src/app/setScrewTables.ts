// Sizes for the Fastener tool's set screws and shoulder screws (screwShapes.ts), from the
// standards' tables: ASME B18.3 (hex and spline socket set screws, socket head shoulder screws)
// and B18.6.2 (slotted headless and square head set screws), inch; ASME B18.3.6M (hex socket set
// screws) and B18.3.3M (shoulder screws), metric; ISO 4026 to 4029 (hex socket), 4766 and 7434
// to 7436 (slotted) and 7379 (shoulder screws); DIN 913 to 916 (hex socket) and 551, 553, 417 and
// 438 (slotted). Figures are the tables' largest. Where a table has none, Rodeo derives one and
// says so: a short ASME inch screw's shallower socket, an ASME metric oval point's radius, DIN's
// short-screw lengths L0 above M6, and an ISO shoulder screw's head chamfer.

import { pointLength, type BoltThread, type PointSize, type ThumbPoint } from "./boltShapes.ts";
import type { FastenerStandard } from "./fastenerShapes.ts";
import type { ScrewHead } from "./screwShapes.ts";

const INCH = 25.4;

/** size, then the table's figures */
type Row = readonly [string, ...number[]];
/** shoulder size, thread, then the table's figures */
type ShoulderRow = readonly [string, string, ...number[]];

export type SetHead = "hex" | "spline" | "slotted" | "square";
export type SetPoint = "cupFlat" | "flat" | "cup" | "dog" | "fullDog" | "halfDog" | "oval" | "cone";

export const SET_HEADS: Record<SetHead, string> = { hex: "Hex Socket", spline: "Spline Socket", slotted: "Slotted", square: "Square" };
export const SET_POINTS: Record<SetPoint, string> = { cupFlat: "Cup/Flat", flat: "Flat", cup: "Cup", dog: "Dog", fullDog: "Full Dog", halfDog: "Half Dog", oval: "Oval", cone: "Cone" };

/** the points each standard's set screws come with, as Vectorworks lists them */
export const SET_POINT_CHOICES: Record<FastenerStandard, readonly SetPoint[]> = {
  asmeInch: ["cupFlat", "fullDog", "halfDog", "oval", "cone"],
  asmeMetric: ["cupFlat", "halfDog", "oval", "cone"],
  iso: ["dog", "flat", "cup", "cone"],
  din: ["flat", "cup", "cone", "halfDog"],
};

/** A set screw's point: its shape (as a thumb screw's) and the table's sizes for it. */
export interface SetPointShape {
  readonly shape: ThumbPoint;
  readonly size: PointSize;
}

/** A set screw size: its name (the nominal size, and for metric ones the pitch), nominal, diameter and pitches (mm), and its head and point for a length. */
export interface SetScrewSize {
  readonly id: string;
  readonly nominal: string;
  readonly diameter: number;
  readonly coarse: number | null;
  readonly fine: number | null;
  /** the head for a screw `length` long with `point`: a headless end with its socket or slot, or a square head */
  readonly head: (length: number, point: SetPoint) => ScrewHead;
  /** a square head's neck relief under it */
  readonly neck: { readonly diameter: number; readonly width: number } | null;
  /** the point for a screw `length` long, or null where the size doesn't come with it */
  readonly point: (point: SetPoint, length: number) => SetPointShape | null;
}

/** A set screw head type of a standard: its standard for each point, and its sizes. */
export interface SetScrewType {
  readonly id: SetHead;
  readonly label: string;
  readonly standard: (point: SetPoint) => string;
  readonly inch: boolean;
  readonly sizes: readonly SetScrewSize[];
}

const NO_HEAD: Omit<ScrewHead, "kind" | "width" | "height"> = { crown: 0, radius: 0, socket: null, slot: null, flange: null, washerFace: null, angle: 82, rounded: false };

/** a headless screw's end `D` across, its socket or slot cut in it, crowned to radius `crown` (0 for flat) */
const headless = (D: number, drive: Pick<ScrewHead, "socket" | "slot">, crown = 0): ScrewHead => ({ ...NO_HEAD, kind: "none", width: D, height: 0, radius: crown, ...drive });

const metricDiameter = (size: string): number => parseFloat(size.slice(1));

/** a row's figure in a column (0 past its end) */
const figure = (r: Row | undefined, column: number): number => Number(r?.[column] ?? 0);

/** a metric size's figure in a column where it has one, else the nearest size's (the smaller of two as near) */
function nearest(rows: readonly Row[], size: string, column: number): number {
  const own = figure(rows.find((r) => r[0] === size), column);
  if (own) return own;
  const d = metricDiameter(size);
  const near = rows.filter((r) => figure(r, column)).reduce((a, b) => {
    const [da, db] = [Math.abs(metricDiameter(a[0]) - d), Math.abs(metricDiameter(b[0]) - d)];
    return db < da - 1e-9 || (Math.abs(db - da) < 1e-9 && metricDiameter(b[0]) < metricDiameter(a[0])) ? b : a;
  });
  return figure(near, column);
}

/** ASME inch points from a size's figures (mm): cup and flat end, dog across, half and full dog lengths (0 for none), oval radius, and the length from which a cone is 90° (118° shorter) */
function inchPoint(C: number, P: number, half: number, full: number, R: number, Y: number): SetScrewSize["point"] {
  return (point, length) => {
    switch (point) {
      case "cupFlat":
        return { shape: "cup", size: { diameter: C } };
      case "halfDog":
        return { shape: "dog", size: { diameter: P, length: half } };
      case "fullDog":
        return full ? { shape: "dog", size: { diameter: P, length: full } } : null;
      case "oval":
        return { shape: "oval", size: { radius: R } };
      case "cone":
        return { shape: "cone", size: { angle: length >= Y - 1e-6 ? 90 : 118 } };
      default:
        return null;
    }
  };
}

/** how far a point reaches below the thread, for a socket's depth to leave room for */
const tipOf = (t: BoltThread, p: SetPointShape | null): number => (p ? pointLength(t, p.shape, p.size) : 0);

/** threads per inch for each ASME inch size: UNC and UNF (0 for none) */
function inchThreads(size: string): [number, number] {
  const row = ASME_SOCKET.find((r) => r[0] === size);
  return row ? [row[2], row[3]] : size === "#12" ? [24, 28] : [0, 0];
}

function inchSize(nominal: string, d: number, head: SetScrewSize["head"], point: SetScrewSize["point"], neck: SetScrewSize["neck"] = null): SetScrewSize {
  const [unc, unf] = inchThreads(nominal);
  return { id: nominal, nominal, diameter: d * INCH, coarse: unc ? INCH / unc : null, fine: unf ? INCH / unf : null, head, neck, point };
}

/** ASME B18.3: a hex or spline socket as deep as the table's key engagement, or (shorter screws, Rodeo's estimate) 0.55 of what the point leaves */
function asmeSocket(r: Row, spline: boolean): SetScrewSize {
  const [nominal, d, , , J, M, C, P, half, R, TH, TS, Y, full] = r;
  const point = inchPoint(C * INCH, P * INCH, half * INCH, full * INCH, R * INCH, Y * INCH);
  const t: BoltThread = { id: nominal, diameter: d * INCH, pitch: 1, inch: true };
  const key = (spline ? M : J) * INCH;
  const T = (spline ? TS : TH) * INCH;
  return inchSize(nominal, d, (length, p) => headless(d * INCH, { socket: { flats: key, depth: Math.min(T, 0.55 * (length - tipOf(t, point(p, length)))), spline }, slot: null }), point);
}

/** ASME B18.6.2 slotted headless: its end crowned to a radius the thread's diameter */
function asmeSlotted(r: Row): SetScrewSize {
  const [nominal, d, J, T, C, P, full, half, R, crown, Y] = r;
  const head = headless(d * INCH, { socket: null, slot: { width: J * INCH, depth: T * INCH } }, crown * INCH);
  return inchSize(nominal, d, () => head, inchPoint(C * INCH, P * INCH, half * INCH, full * INCH, R * INCH, Y * INCH));
}

/** ASME B18.6.2 square head: its neck relief under the head (the head's crown is drawn as a square head's chamfer) */
function asmeSquare(r: Row): SetScrewSize {
  const [nominal, d, F, , H, K, , U, , C, P, full, half, R, Y] = r;
  const head: ScrewHead = { ...NO_HEAD, kind: "square", width: F * INCH, height: H * INCH };
  return inchSize(nominal, d, () => head, inchPoint(C * INCH, P * INCH, half * INCH, full * INCH, R * INCH, Y * INCH), { diameter: K * INCH, width: U * INCH });
}

/** ASME B18.3.6M: the key engagement listed for the longest length at most the screw's (shorter, Rodeo's 0.55 of what the point leaves); an oval point's radius 0.75 d as the inch standard's (derived); cones 90° from length a, 118° shorter, as the inch standard's (the source states it the other way round) */
function metricSocket(r: Row): SetScrewSize {
  const [nominal, pitch, s, , , dz, dog, z, a] = r;
  const D = metricDiameter(nominal);
  const t: BoltThread = { id: nominal, diameter: D, pitch, inch: false };
  const point: SetScrewSize["point"] = (p, length) => {
    switch (p) {
      case "cupFlat":
        return { shape: "cup", size: { diameter: dz } };
      case "halfDog":
        return { shape: "dog", size: { diameter: dog, length: z } };
      case "oval":
        return { shape: "oval", size: { radius: 0.75 * D } };
      case "cone":
        return { shape: "cone", size: { angle: length >= a - 1e-6 ? 90 : 118 } };
      default:
        return null;
    }
  };
  const depth = (length: number, p: SetPoint): number => {
    const pairs = (p === "halfDog" ? METRIC_ENGAGEMENT_DOG : p === "cone" || p === "oval" ? METRIC_ENGAGEMENT_CONE : METRIC_ENGAGEMENT_CUP)[nominal] ?? [];
    let T = 0;
    for (let i = 0; i + 1 < pairs.length; i += 2) if (pairs[i] <= length + 1e-6) T = pairs[i + 1];
    return T || Math.min(pairs[1] ?? s, 0.55 * (length - tipOf(t, point(p, length))));
  };
  return { id: `${nominal} × ${pitch}`, nominal, diameter: D, coarse: pitch, fine: null, head: (length, p) => headless(D, { socket: { flats: s, depth: depth(length, p) }, slot: null }), neck: null, point };
}

/** a metric screw's point: flat and dog across, cone tip and cup across (0 for none), dog length, and whether the screw is short (a 120° cone) */
function metricPoint(flat: number, tip: number, cup: number, dog: number, dogLength: (length: number) => number, short: (p: SetPoint, length: number) => boolean): SetScrewSize["point"] {
  return (p, length) => {
    switch (p) {
      case "flat":
        return flat ? { shape: "plain", size: { diameter: flat } } : null;
      case "cup":
        return cup ? { shape: "cup", size: { diameter: cup } } : null;
      case "dog":
      case "halfDog":
        return dog && dogLength(length) ? { shape: "dog", size: { diameter: dog, length: dogLength(length) } } : null;
      case "cone":
        return { shape: "cone", size: { tip, angle: short(p, length) ? 120 : 90 } };
      default:
        return null;
    }
  };
}

const metricSize = (nominal: string, pitch: number, head: SetScrewSize["head"], point: SetScrewSize["point"]): SetScrewSize => ({ id: `${nominal} × ${pitch}`, nominal, diameter: metricDiameter(nominal), coarse: pitch, fine: null, head, neck: null, point });

/** the ISO 4026 to 4029 column of L0 for a point */
const ISO_L0_COLUMN: Partial<Record<SetPoint, number>> = { flat: 11, cone: 12, dog: 13, halfDog: 13, cup: 14 };

/** ISO 4026 to 4029: a screw at most L0 long is short, with the shallower socket, a 120° cone and the short dog */
function isoSocket(r: Row): SetScrewSize {
  const [nominal, pitch, s, , tShort, tLong, dp, dt, dz, zShort, zLong] = r;
  const short = (p: SetPoint, length: number): boolean => length <= figure(r, ISO_L0_COLUMN[p] ?? 11) + 1e-6;
  const point = metricPoint(dp, dt, dz, dp, (length) => (short("dog", length) ? zShort : zLong), short);
  return metricSize(nominal, pitch, (length, p) => headless(metricDiameter(nominal), { socket: { flats: s, depth: short(p, length) ? tShort : tLong }, slot: null }), point);
}

/** ISO 4766 and 7434 to 7436, slotted: L0 is ISO 4766's for every point (7434's to 7436's weren't found), the nearest size's where it has none */
function isoSlotted(r: Row): SetScrewSize {
  const [nominal, pitch, , n, t, dp, dt, dz, z] = r;
  const L0 = nearest(ISO_SLOTTED, nominal, 9);
  const point = metricPoint(dp, dt, dz, z ? dp : 0, () => z, (_, length) => length <= L0 + 1e-6);
  const head = headless(metricDiameter(nominal), { socket: null, slot: { width: n, depth: t } });
  return metricSize(nominal, pitch, () => head, point);
}

/** DIN 914, 915 and 916's L0 (cone, dog, cup) for M1.4 to M6 */
const DIN_L0: Record<string, readonly [number, number, number]> = {
  "M1.4": [2, 2, 2],
  "M1.6": [2.5, 2.5, 2],
  "M1.8": [2.5, 3, 2.5],
  M2: [2.5, 3, 2.5],
  "M2.5": [3, 4, 3],
  M3: [3, 5, 4],
  M4: [4, 6, 5],
  M5: [5, 6, 5],
  M6: [6, 8, 6],
};

/** DIN 913 to 916: L0 is DIN's to M6, else the ISO screw's of the size (the nearest ISO size's for M14, M18 and M22); a short dog is DIN 915's to M6, ISO 4028's above */
function dinSocket(r: Row): SetScrewSize {
  const [nominal, pitch, s, , tShort, tLong, dp, , dt, dog, z, zShort, dz] = r;
  const din = DIN_L0[nominal];
  const L0 = (p: SetPoint): number => (p === "cone" && din ? din[0] : p === "halfDog" && din ? din[1] : p === "cup" && din ? din[2] : nearest(ISO_SOCKET, nominal, ISO_L0_COLUMN[p] ?? 11));
  const short = (p: SetPoint, length: number): boolean => length <= L0(p) + 1e-6;
  const shortDog = zShort || figure(ISO_SOCKET.find((i) => i[0] === nominal), 9) || z;
  const point = metricPoint(dp, dt, dz, dog, (length) => (short("halfDog", length) ? shortDog : z), short);
  return metricSize(nominal, pitch, (length, p) => headless(metricDiameter(nominal), { socket: { flats: s, depth: short(p, length) ? tShort : tLong }, slot: null }), point);
}

/** DIN 551, 553, 417 and 438, slotted: L0 is ISO 4766's for the size or the nearest */
function dinSlotted(r: Row): SetScrewSize {
  const [nominal, pitch, , n, t, dp, dt, dog, z, dz] = r;
  const L0 = nearest(ISO_SLOTTED, nominal, 9);
  const point = metricPoint(dp, dt, dz, z ? dog : 0, () => z, (_, length) => length <= L0 + 1e-6);
  const head = headless(metricDiameter(nominal), { socket: null, slot: { width: n, depth: t } });
  return metricSize(nominal, pitch, () => head, point);
}

/** the nearest of `series` to `length`, or past its end the nearest multiple of `step` */
function inSeries(series: readonly number[], length: number, step: number): number {
  const last = series[series.length - 1];
  if (length > last + step / 2) return Math.round(length / step) * step;
  return series.reduce((best, l) => (Math.abs(l - length) < Math.abs(best - length) ? l : best));
}

/** in `steps` (inch bands: up to each limit, its step), the nearest step to `length`, at least the first step */
function inSteps(length: number, steps: readonly (readonly [number, number])[]): number {
  const inches = length / INCH;
  const step = steps.find(([limit]) => inches < limit)?.[1] ?? steps[steps.length - 1][1];
  return Math.max(steps[0][1], Math.round(inches / step) * step) * INCH;
}

/** A standard set screw length: inch ones in 1/16 in steps to 3/16 in, then 1/8 to 1 in, 1/4 to 2 in, 1/2 to 6 in and whole inches (ASME B18.3); metric ones from ISO 4026's lengths, tens past 60 mm. */
export function standardSetLength(length: number, inch: boolean): number {
  if (!inch) return inSeries([2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60], length, 10);
  return inSteps(length, [[3 / 16, 1 / 16], [1, 1 / 8], [2, 1 / 4], [6, 1 / 2], [Infinity, 1]]);
}

// ---- shoulder screws -------------------------------------------------------------------------

export type ShoulderStyle = "plain" | "chamfered" | "rounded";

/** A shoulder screw size: the shoulder's diameter (its name), its thread, socket head, thread length, and the thread's undercut where it meets the shoulder. */
export interface ShoulderSize {
  readonly id: string;
  readonly label: string;
  readonly shoulder: number;
  readonly thread: BoltThread;
  readonly head: ScrewHead;
  readonly threadLength: number;
  readonly undercut: { readonly diameter: number; readonly width: number };
}

/** A standard's shoulder screws: whether Head Style and Draw Underhead Fillet apply, and its sizes. */
export interface ShoulderType {
  readonly standard: string;
  readonly inch: boolean;
  readonly styles: boolean;
  readonly fillet: boolean;
  readonly sizes: readonly ShoulderSize[];
}

const socketHead = (width: number, height: number, key: number, depth: number, edge: number): ScrewHead => ({ ...NO_HEAD, kind: "socket", width, height, socket: { flats: key, depth }, edge });

function asmeShoulder(r: ShoulderRow): ShoulderSize {
  const [size, thread, D, A, H, C, J, T, E, , , G, I, , , , major, tpi] = r;
  return {
    id: size,
    label: `${size} (${thread.replace(" UNC", "")})`,
    shoulder: D * INCH,
    thread: { id: thread, diameter: major * INCH, pitch: INCH / tpi, inch: true },
    head: socketHead(A * INCH, H * INCH, J * INCH, T * INCH, C * INCH),
    threadLength: E * INCH,
    undercut: { diameter: G * INCH, width: I * INCH },
  };
}

function metricShoulder(r: ShoulderRow): ShoulderSize {
  const [size, thread, pitch, ds, dk, k, c, s, t, b, , , ds2, L2] = r;
  return { id: size, label: `${size} (${thread})`, shoulder: ds, thread: { id: `${thread} × ${pitch}`, diameter: metricDiameter(thread), pitch, inch: false }, head: socketHead(dk, k, s, t, c), threadLength: b, undercut: { diameter: ds2, width: L2 } };
}

/** ISO 7379 (which DIN publishes as is): its head's edge, plain, chamfered or rounded, the size of B18.3.3M's chamfer (ISO gives none) */
function isoShoulder(r: ShoulderRow): ShoulderSize {
  const [size, thread, pitch, ds, dk, , k, s, , t, b, ds1, , g2] = r;
  const c = METRIC_SHOULDER.find((m) => m[0] === size)?.[6] ?? 0.1 * k;
  return { id: size, label: `${size} (${thread})`, shoulder: ds, thread: { id: `${thread} × ${pitch}`, diameter: metricDiameter(thread), pitch, inch: false }, head: socketHead(dk, k, s, t, c), threadLength: b, undercut: { diameter: ds1, width: g2 } };
}

/** A standard shoulder length: inch ones in 1/8 in steps to 3/4 in, then 1/4 to 5 in and 1/2 past (ASME B18.3); metric ones from ISO 7379's lengths, twenties past 120 mm. */
export function standardShoulderLength(length: number, inch: boolean): number {
  if (!inch) return inSeries([10, 12, 16, 20, 25, 30, 40, 50, 60, 70, 80, 90, 100, 120], length, 20);
  return inSteps(length, [[0.75, 1 / 8], [5, 1 / 4], [Infinity, 1 / 2]]);
}

// ---- the tables ------------------------------------------------------------------------------

/** ASME B18.3 hex and spline socket set screws, inches: size, D, UNC and UNF threads per inch, hex key J, spline key M, cup and flat point C, dog P, half dog Q, oval radius R, hex and spline key engagement TH and TS, the length Y from which a cone is 90°, full dog Q (B18.6.2's) */
const ASME_SOCKET: readonly Row[] = [
  ["#0", 0.06, 0, 80, 0.028, 0.033, 0.033, 0.04, 0.017, 0.045, 0.05, 0.026, 0.09, 0.032],
  ["#1", 0.073, 64, 72, 0.035, 0.033, 0.04, 0.049, 0.021, 0.055, 0.06, 0.035, 0.09, 0.04],
  ["#2", 0.086, 56, 64, 0.035, 0.048, 0.047, 0.057, 0.024, 0.064, 0.06, 0.04, 0.13, 0.046],
  ["#3", 0.099, 48, 56, 0.05, 0.048, 0.054, 0.066, 0.027, 0.074, 0.07, 0.04, 0.13, 0.052],
  ["#4", 0.112, 40, 48, 0.05, 0.06, 0.061, 0.075, 0.03, 0.084, 0.07, 0.045, 0.19, 0.058],
  ["#5", 0.125, 40, 44, 0.0625, 0.072, 0.067, 0.083, 0.033, 0.094, 0.08, 0.055, 0.19, 0.063],
  ["#6", 0.138, 32, 40, 0.0625, 0.072, 0.074, 0.092, 0.038, 0.104, 0.08, 0.055, 0.19, 0.073],
  ["#8", 0.164, 32, 36, 0.0781, 0.096, 0.087, 0.109, 0.043, 0.123, 0.09, 0.08, 0.25, 0.083],
  ["#10", 0.19, 24, 32, 0.0938, 0.111, 0.102, 0.127, 0.049, 0.142, 0.1, 0.08, 0.25, 0.095],
  ["1/4", 0.25, 20, 28, 0.125, 0.145, 0.132, 0.156, 0.067, 0.188, 0.125, 0.125, 0.31, 0.13],
  ["5/16", 0.3125, 18, 24, 0.1562, 0.183, 0.172, 0.203, 0.082, 0.234, 0.156, 0.156, 0.38, 0.161],
  ["3/8", 0.375, 16, 24, 0.1875, 0.216, 0.212, 0.25, 0.099, 0.281, 0.188, 0.188, 0.44, 0.193],
  ["7/16", 0.4375, 14, 20, 0.2188, 0.251, 0.252, 0.297, 0.114, 0.328, 0.219, 0.219, 0.5, 0.224],
  ["1/2", 0.5, 13, 20, 0.25, 0.291, 0.291, 0.344, 0.13, 0.375, 0.25, 0.25, 0.57, 0.255],
  ["5/8", 0.625, 11, 18, 0.3125, 0.372, 0.371, 0.469, 0.164, 0.469, 0.312, 0.312, 0.75, 0.321],
  ["3/4", 0.75, 10, 16, 0.375, 0.454, 0.45, 0.562, 0.196, 0.562, 0.375, 0.375, 0.88, 0.383],
  ["7/8", 0.875, 9, 14, 0.5, 0.595, 0.53, 0.656, 0.227, 0.656, 0.5, 0.5, 1, 0.446],
  ["1", 1, 8, 12, 0.5625, 0, 0.609, 0.75, 0.26, 0.75, 0.562, 0, 1.13, 0.51],
  ["1-1/8", 1.125, 7, 12, 0.5625, 0, 0.689, 0.844, 0.291, 0.844, 0.562, 0, 1.25, 0.572],
  ["1-1/4", 1.25, 7, 12, 0.625, 0, 0.767, 0.938, 0.323, 0.938, 0.625, 0, 1.5, 0.635],
  ["1-3/8", 1.375, 6, 12, 0.625, 0, 0.848, 1.031, 0.354, 1.031, 0.625, 0, 1.63, 0.698],
  ["1-1/2", 1.5, 6, 12, 0.75, 0, 0.926, 1.125, 0.385, 1.125, 0.75, 0, 1.75, 0.76],
  ["1-3/4", 1.75, 5, 0, 1, 0, 1.086, 1.312, 0.448, 1.312, 1, 0, 2, 0],
  ["2", 2, 4.5, 0, 1, 0, 1.244, 1.5, 0.51, 1.5, 1, 0, 2.25, 0],
];

/** ASME B18.6.2 slotted headless set screws, inches: size, D, slot width J and depth T, cup and flat point C, dog P, full dog Q, half dog Q1, oval radius R, the end's crown radius, cone Y */
const ASME_SLOTTED: readonly Row[] = [
  ["#0", 0.06, 0.014, 0.02, 0.033, 0.04, 0.032, 0.017, 0.045, 0.06, 0.078],
  ["#1", 0.073, 0.016, 0.02, 0.04, 0.049, 0.04, 0.021, 0.055, 0.073, 0.094],
  ["#2", 0.086, 0.018, 0.025, 0.047, 0.057, 0.046, 0.024, 0.064, 0.086, 0.109],
  ["#3", 0.099, 0.02, 0.028, 0.054, 0.066, 0.052, 0.027, 0.074, 0.099, 0.125],
  ["#4", 0.112, 0.024, 0.031, 0.061, 0.075, 0.058, 0.03, 0.084, 0.112, 0.156],
  ["#5", 0.125, 0.026, 0.036, 0.067, 0.083, 0.063, 0.033, 0.094, 0.125, 0.188],
  ["#6", 0.138, 0.028, 0.04, 0.074, 0.092, 0.073, 0.038, 0.104, 0.138, 0.188],
  ["#8", 0.164, 0.032, 0.046, 0.087, 0.109, 0.083, 0.043, 0.123, 0.164, 0.25],
  ["#10", 0.19, 0.035, 0.053, 0.102, 0.127, 0.095, 0.05, 0.142, 0.19, 0.25],
  ["#12", 0.216, 0.042, 0.061, 0.115, 0.144, 0.115, 0.06, 0.162, 0.216, 0.312],
  ["1/4", 0.25, 0.049, 0.068, 0.132, 0.156, 0.13, 0.068, 0.188, 0.25, 0.312],
  ["5/16", 0.3125, 0.055, 0.083, 0.172, 0.203, 0.161, 0.083, 0.234, 0.312, 0.375],
  ["3/8", 0.375, 0.068, 0.099, 0.212, 0.25, 0.193, 0.099, 0.281, 0.375, 0.438],
  ["7/16", 0.4375, 0.076, 0.114, 0.252, 0.297, 0.224, 0.114, 0.328, 0.438, 0.5],
  ["1/2", 0.5, 0.086, 0.13, 0.291, 0.344, 0.255, 0.13, 0.375, 0.5, 0.562],
  ["9/16", 0.5625, 0.096, 0.146, 0.332, 0.391, 0.287, 0.146, 0.422, 0.562, 0.625],
  ["5/8", 0.625, 0.107, 0.161, 0.371, 0.469, 0.321, 0.164, 0.469, 0.625, 0.75],
  ["3/4", 0.75, 0.134, 0.193, 0.45, 0.562, 0.383, 0.196, 0.562, 0.75, 0.875],
];

/** ASME B18.6.2 square head set screws, inches: size, D, across the flats F and corners G, head height H, neck relief diameter K, fillet S and width U, crown radius W, then cup and flat point C, dog P, full dog Q, half dog Q1, oval radius R, cone Y */
const ASME_SQUARE: readonly Row[] = [
  ["#10", 0.19, 0.188, 0.265, 0.148, 0.145, 0.027, 0.083, 0.48, 0.102, 0.127, 0.095, 0.05, 0.142, 0.25],
  ["1/4", 0.25, 0.25, 0.354, 0.196, 0.185, 0.032, 0.1, 0.62, 0.132, 0.156, 0.13, 0.068, 0.188, 0.312],
  ["5/16", 0.3125, 0.312, 0.442, 0.245, 0.24, 0.036, 0.111, 0.78, 0.172, 0.203, 0.161, 0.083, 0.234, 0.375],
  ["3/8", 0.375, 0.375, 0.53, 0.293, 0.294, 0.041, 0.125, 0.94, 0.212, 0.25, 0.193, 0.099, 0.281, 0.438],
  ["7/16", 0.4375, 0.438, 0.619, 0.341, 0.345, 0.046, 0.143, 1.09, 0.252, 0.297, 0.224, 0.114, 0.328, 0.5],
  ["1/2", 0.5, 0.5, 0.707, 0.389, 0.4, 0.05, 0.154, 1.25, 0.291, 0.344, 0.255, 0.13, 0.375, 0.562],
  ["9/16", 0.5625, 0.562, 0.795, 0.437, 0.454, 0.054, 0.167, 1.41, 0.332, 0.391, 0.287, 0.146, 0.422, 0.625],
  ["5/8", 0.625, 0.625, 0.884, 0.485, 0.507, 0.059, 0.182, 1.56, 0.371, 0.469, 0.321, 0.164, 0.469, 0.75],
  ["3/4", 0.75, 0.75, 1.06, 0.582, 0.62, 0.065, 0.2, 1.88, 0.45, 0.562, 0.383, 0.196, 0.562, 0.875],
  ["7/8", 0.875, 0.875, 1.237, 0.678, 0.731, 0.072, 0.222, 2.19, 0.53, 0.656, 0.446, 0.227, 0.656, 1],
  ["1", 1, 1, 1.414, 0.774, 0.838, 0.081, 0.25, 2.5, 0.609, 0.75, 0.51, 0.26, 0.75, 1.125],
  ["1-1/8", 1.125, 1.125, 1.591, 0.87, 0.939, 0.092, 0.283, 2.81, 0.689, 0.844, 0.572, 0.291, 0.844, 1.25],
  ["1-1/4", 1.25, 1.25, 1.768, 0.966, 1.064, 0.092, 0.283, 3.12, 0.767, 0.938, 0.635, 0.323, 0.938, 1.5],
  ["1-3/8", 1.375, 1.375, 1.945, 1.063, 1.159, 0.109, 0.333, 3.44, 0.848, 1.031, 0.698, 0.354, 1.031, 1.625],
  ["1-1/2", 1.5, 1.5, 2.121, 1.159, 1.284, 0.109, 0.333, 3.75, 0.926, 1.125, 0.76, 0.385, 1.125, 1.75],
];

/** ASME B18.3.6M hex socket set screws, mm: size, pitch, hex key s, key engagement T, flat point dp, cup dz, half dog dp and z, the length a from which a cone is 90° */
const METRIC_SOCKET: readonly Row[] = [
  ["M1.6", 0.35, 0.7, 1.25, 0.8, 0.8, 0.8, 0.53, 3],
  ["M2", 0.4, 0.9, 1.5, 1, 1, 1, 0.64, 3],
  ["M2.5", 0.45, 1.3, 1.8, 1.5, 1.25, 1.5, 0.78, 4],
  ["M3", 0.5, 1.5, 2.1, 2, 1.5, 2, 0.92, 4],
  ["M4", 0.7, 2, 2.3, 2.5, 2, 2.5, 1.2, 5],
  ["M5", 0.8, 2.5, 2.7, 3.5, 2.5, 3.5, 1.37, 6],
  ["M6", 1, 3, 3, 4, 3, 4, 1.74, 8],
  ["M8", 1.25, 4, 4, 5.5, 4, 5.5, 2.28, 10],
  ["M10", 1.5, 5, 5, 7, 5, 7, 2.82, 12],
  ["M12", 1.75, 6, 6, 8.5, 6, 8.5, 3.35, 16],
  ["M16", 2, 8, 8, 12, 8, 12, 4.4, 20],
  ["M20", 2.5, 10, 10, 15, 10, 15, 5.45, 25],
  ["M24", 3, 12, 12, 18, 12, 18, 6.49, 30],
];

/** B18.3.6M key engagement T (hex) by length, flat and cup points: size, then length and depth pairs, mm */
const METRIC_ENGAGEMENT_CUP: Record<string, readonly number[]> = {
  "M1.6": [1.5, 0.6, 2, 0.8, 2.5, 1, 3, 1.25],
  "M2": [1.5, 0.6, 2, 0.8, 2.5, 1, 3, 1.2, 4, 1.5],
  "M2.5": [2, 0.7, 2.5, 1.1, 3, 1.5, 4, 1.8],
  "M3": [2, 0.6, 2.5, 1.1, 3, 1.5, 4, 2.1, 5, 2.1],
  "M4": [2.5, 1, 3, 1.3, 4, 1.8, 5, 2.3, 6, 2.3],
  "M5": [3, 1.2, 4, 2, 5, 2.7, 6, 2.7, 8, 2.7],
  "M6": [4, 1.8, 5, 2.5, 6, 3, 8, 3],
  "M8": [5, 1.8, 6, 2.5, 8, 4, 10, 4],
  "M10": [6, 2, 8, 3.6, 10, 5, 12, 5],
  "M12": [8, 3, 10, 4.5, 12, 6, 16, 6],
  "M16": [10, 3, 12, 4.8, 16, 8, 20, 8],
  "M20": [16, 6, 20, 9, 25, 10],
  "M24": [16, 5, 20, 8, 25, 12, 30, 12],
};

/** B18.3.6M key engagement T (hex) by length, cone and oval points: size, then length and depth pairs, mm */
const METRIC_ENGAGEMENT_CONE: Record<string, readonly number[]> = {
  "M1.6": [1.5, 0.6, 2, 0.8, 2.5, 1, 3, 1.25],
  "M2": [1.5, 0.6, 2, 0.8, 2.5, 1, 3, 1.2, 4, 1.5],
  "M2.5": [2, 0.7, 2.5, 1, 3, 1.3, 4, 1.8],
  "M3": [2.5, 0.7, 3, 1, 4, 1.5, 5, 2.1],
  "M4": [3, 1, 4, 1.5, 5, 2, 6, 2.3],
  "M5": [4, 1.2, 5, 1.7, 6, 2, 8, 2.7],
  "M6": [5, 1.8, 6, 2.7, 8, 3],
  "M8": [6, 2.3, 8, 3.5, 10, 4],
  "M10": [8, 3, 10, 4, 12, 5],
  "M12": [10, 3.8, 12, 5, 16, 6],
  "M16": [12, 3, 16, 6, 20, 8],
  "M20": [16, 5, 20, 8, 25, 10],
  "M24": [20, 7, 25, 10, 30, 12],
};

/** B18.3.6M key engagement T (hex) by length, half dog points: size, then length and depth pairs, mm */
const METRIC_ENGAGEMENT_DOG: Record<string, readonly number[]> = {
  "M1.6": [2, 0.6, 2.5, 0.7, 3, 1.25],
  "M2": [2.5, 0.8, 3, 1.2, 4, 1.5],
  "M2.5": [2.5, 0.9, 3, 1.2, 4, 1.8],
  "M3": [3, 1, 4, 2, 5, 2.1],
  "M4": [3, 1, 4, 1.5, 5, 2, 6, 2.3],
  "M5": [5, 2, 6, 2.5, 8, 2.7],
  "M6": [5, 1.5, 6, 2, 8, 3],
  "M8": [6, 1.8, 8, 3, 10, 4],
  "M10": [8, 2.5, 10, 4, 12, 5],
  "M12": [10, 3.5, 12, 5, 16, 6],
  "M16": [12, 3, 16, 6, 20, 8],
  "M20": [16, 5, 20, 8, 25, 10],
  "M24": [20, 6, 25, 10, 30, 12],
};

/** ISO 4026 to 4029 hex socket set screws, mm: size, pitch, hex key s, key engagement for short and long screws, flat and dog point dp, cone tip dt, cup dz, short and long dog z, and L0 (a screw at most this long is short) for flat, cone, dog and cup points */
const ISO_SOCKET: readonly Row[] = [
  ["M1.6", 0.35, 0.7, 0.803, 0.7, 1.5, 0.8, 0.4, 0.8, 0.65, 1.05, 2, 2.5, 2.5, 2],
  ["M2", 0.4, 0.9, 1.003, 0.8, 1.7, 1, 0.5, 1, 0.75, 1.25, 2.5, 2.5, 3, 2.5],
  ["M2.5", 0.45, 1.3, 1.427, 1.2, 2, 1.5, 0.65, 1.2, 0.88, 1.5, 3, 3, 4, 3],
  ["M3", 0.5, 1.5, 1.73, 1.2, 2, 2, 0.75, 1.4, 1, 1.75, 3, 3, 5, 4],
  ["M4", 0.7, 2, 2.3, 1.5, 2.5, 2.5, 1, 2, 1.25, 2.25, 4, 4, 6, 5],
  ["M5", 0.8, 2.5, 2.87, 2, 3, 3.5, 1.25, 2.5, 1.5, 2.75, 5, 5, 6, 5],
  ["M6", 1, 3, 3.44, 2, 3.5, 4, 1.5, 3, 1.75, 3.25, 6, 6, 8, 6],
  ["M8", 1.25, 4, 4.58, 3, 5, 5.5, 2, 5, 2.25, 4.3, 6, 8, 10, 8],
  ["M10", 1.5, 5, 5.72, 4, 6, 7, 2.5, 6, 2.75, 5.3, 8, 10, 12, 10],
  ["M12", 1.75, 6, 6.86, 4.8, 8, 8.5, 3, 8, 3.25, 6.3, 12, 12, 16, 12],
  ["M16", 2, 8, 9.15, 6.4, 10, 12, 4, 10, 4.3, 8.36, 16, 16, 20, 16],
  ["M20", 2.5, 10, 11.43, 8, 12, 15, 5, 14, 5.3, 10.36, 16, 20, 25, 20],
  ["M24", 3, 12, 13.72, 10, 15, 18, 6, 16, 6.3, 12.43, 20, 25, 30, 25],
];

/** ISO 4766, 7434, 7435 and 7436 slotted set screws, mm: size, pitch, slot width nominal and max, slot depth t, flat and dog point dp, cone tip dt, cup dz, dog z, L0 */
const ISO_SLOTTED: readonly Row[] = [
  ["M1.2", 0.25, 0.2, 0.4, 0.52, 0.6, 0.12, 0, 0, 0],
  ["M1.6", 0.35, 0.25, 0.45, 0.74, 0.8, 0.16, 0.8, 1.05, 2],
  ["M2", 0.4, 0.25, 0.45, 0.84, 1, 0.2, 1, 1.25, 2.5],
  ["M2.5", 0.45, 0.4, 0.6, 0.95, 1.5, 0.25, 1.2, 1.5, 3],
  ["M3", 0.5, 0.4, 0.6, 1.05, 2, 0.3, 1.4, 1.75, 3],
  ["M3.5", 0.6, 0.5, 0.7, 1.21, 2.2, 0.35, 1.7, 2, 4],
  ["M4", 0.7, 0.6, 0.8, 1.42, 2.5, 0.4, 2, 2.25, 4],
  ["M5", 0.8, 0.8, 1, 1.63, 3.5, 0.5, 2.5, 2.75, 5],
  ["M6", 1, 1, 1.2, 2, 4, 1.5, 3, 3.25, 6],
  ["M8", 1.25, 1.2, 1.51, 2.5, 5.5, 2, 5, 4.3, 6],
  ["M10", 1.5, 1.6, 1.91, 3, 7, 2.5, 6, 5.3, 8],
  ["M12", 1.75, 2, 2.31, 3.6, 8.5, 3, 8, 6.3, 10],
];

/** DIN 913 to 916 hex socket set screws, mm: size, pitch, hex key s, e, key engagement short and long, flat point dp, cone tip dt min and max, dog dp, dog z long and short, cup dz */
const DIN_SOCKET: readonly Row[] = [
  ["M1.4", 0.3, 0.7, 0.803, 0.6, 1.4, 0.7, 0, 0, 0.7, 1.05, 0.65, 0.7],
  ["M1.6", 0.35, 0.7, 0.803, 0.7, 1.5, 0.8, 0, 0, 0.8, 1.05, 0.65, 0.8],
  ["M1.8", 0.35, 0.7, 0.803, 0.8, 1.6, 0.8, 0, 0, 0.9, 1.25, 0.65, 0.9],
  ["M2", 0.4, 0.9, 1.003, 0.8, 1.7, 1, 0, 0.3, 1, 1.25, 0.75, 1],
  ["M2.5", 0.45, 1.3, 1.427, 1.2, 2, 1.5, 0, 0.3, 1.5, 1.5, 0.88, 1.2],
  ["M3", 0.5, 1.5, 1.73, 1.2, 2, 2, 0, 0.3, 2, 1.75, 1, 1.4],
  ["M4", 0.7, 2, 2.3, 1.5, 2.5, 2.5, 0, 0.4, 2.5, 2.25, 1.25, 2],
  ["M5", 0.8, 2.5, 2.87, 2, 3, 3.5, 0, 0.5, 3.5, 2.75, 1.5, 2.5],
  ["M6", 1, 3, 3.44, 2, 3.5, 4, 0.9, 1.5, 4, 3.25, 1.75, 3],
  ["M8", 1.25, 4, 4.58, 3, 5, 5.5, 1.4, 2, 5.5, 4.3, 0, 5],
  ["M10", 1.5, 5, 5.72, 4, 6, 7, 1.9, 2.5, 7, 5.3, 0, 6],
  ["M12", 1.75, 6, 6.86, 4.8, 8, 8.5, 2.4, 3, 8.5, 6.3, 0, 8],
  ["M14", 2, 6, 6.86, 5.6, 9, 10, 3.25, 4, 10, 7.36, 0, 9],
  ["M16", 2, 8, 9.15, 6.4, 10, 12, 3.25, 4, 12, 8.36, 0, 10],
  ["M18", 2.5, 10, 11.43, 7.2, 11, 13, 4.25, 5, 13, 9.86, 0, 12],
  ["M20", 2.5, 10, 11.43, 8, 12, 15, 4.25, 5, 15, 10.36, 0, 14],
  ["M22", 2.5, 12, 13.72, 9, 13.5, 17, 5.25, 6, 17, 11.43, 0, 16],
  ["M24", 3, 12, 13.72, 10, 15, 18, 5.25, 6, 18, 12.43, 0, 16],
];

/** DIN 551, 553, 417 and 438 slotted set screws, mm: size, pitch, slot width nominal and max, slot depth t, flat point dp, cone tip dt, dog dp and z, cup dz */
const DIN_SLOTTED: readonly Row[] = [
  ["M1", 0.25, 0.2, 0.4, 0.52, 0.5, 0.1, 0, 0, 0],
  ["M1.2", 0.25, 0.2, 0.4, 0.52, 0.6, 0.12, 0, 0, 0],
  ["M1.4", 0.3, 0.2, 0.4, 0.63, 0.7, 0.14, 0, 0, 0],
  ["M1.6", 0.35, 0.25, 0.45, 0.74, 0.8, 0.16, 0.8, 1.05, 0.8],
  ["M2", 0.4, 0.25, 0.45, 0.84, 1, 0.2, 1, 1.25, 1],
  ["M2.5", 0.45, 0.4, 0.6, 0.95, 1.5, 0.25, 1.5, 1.5, 1.2],
  ["M3", 0.5, 0.4, 0.6, 1.05, 2, 0.3, 2, 1.75, 1.4],
  ["M3.5", 0.6, 0.5, 0.7, 1.21, 2.2, 0.35, 2.2, 2, 1.7],
  ["M4", 0.7, 0.6, 0.8, 1.42, 2.5, 0.4, 2.5, 2.25, 2],
  ["M5", 0.8, 0.8, 1, 1.63, 3.5, 0.5, 3.5, 2.75, 2.5],
  ["M6", 1, 1, 1.2, 2, 4, 1.5, 4, 3.25, 3],
  ["M8", 1.25, 1.2, 1.51, 2.5, 5.5, 2, 5.5, 4.3, 5],
  ["M10", 1.5, 1.6, 1.91, 3, 7, 2.5, 7, 5.3, 6],
  ["M12", 1.75, 2, 2.31, 3.6, 8.5, 3, 8.5, 6.3, 8],
];

/** ASME B18.3 socket head shoulder screws, inches: shoulder size, thread, shoulder D, head A and height H, its top edge C, hex key J and engagement T, thread length E, shoulder neck K and width F, thread neck G and width I, its fillet N, head fillet R, fillet transition M, then the thread's major diameter and threads per inch */
const ASME_SHOULDER: readonly ShoulderRow[] = [
  ["1/8", "#4-40 UNC", 0.123, 0.25, 0.125, 0.008, 0.078, 0.067, 0.157, 0.108, 0.04, 0.076, 0.078, 0.016, 0.006, 0.138, 0.112, 40],
  ["5/32", "#6-32 UNC", 0.154, 0.281, 0.125, 0.008, 0.094, 0.067, 0.187, 0.14, 0.04, 0.1, 0.063, 0.018, 0.007, 0.172, 0.138, 32],
  ["3/16", "#8-32 UNC", 0.185, 0.312, 0.156, 0.012, 0.094, 0.079, 0.189, 0.154, 0.04, 0.12, 0.069, 0.018, 0.008, 0.207, 0.164, 32],
  ["1/4", "#10-24 UNC", 0.248, 0.375, 0.188, 0.02, 0.125, 0.094, 0.375, 0.227, 0.093, 0.142, 0.083, 0.023, 0.009, 0.276, 0.19, 24],
  ["5/16", "1/4-20 UNC", 0.3105, 0.438, 0.219, 0.026, 0.156, 0.117, 0.438, 0.289, 0.093, 0.193, 0.1, 0.028, 0.012, 0.345, 0.25, 20],
  ["3/8", "5/16-18 UNC", 0.373, 0.562, 0.25, 0.031, 0.188, 0.141, 0.5, 0.352, 0.093, 0.249, 0.111, 0.031, 0.015, 0.413, 0.3125, 18],
  ["1/2", "3/8-16 UNC", 0.498, 0.75, 0.312, 0.04, 0.25, 0.188, 0.625, 0.477, 0.093, 0.304, 0.125, 0.035, 0.02, 0.55, 0.375, 16],
  ["5/8", "1/2-13 UNC", 0.623, 0.875, 0.375, 0.05, 0.312, 0.234, 0.75, 0.602, 0.093, 0.414, 0.154, 0.042, 0.024, 0.687, 0.5, 13],
  ["3/4", "5/8-11 UNC", 0.748, 1, 0.5, 0.069, 0.375, 0.281, 0.875, 0.727, 0.093, 0.521, 0.182, 0.051, 0.03, 0.826, 0.625, 11],
  ["1", "3/4-10 UNC", 0.998, 1.312, 0.625, 0.083, 0.5, 0.375, 1, 0.977, 0.125, 0.638, 0.2, 0.055, 0.04, 1.098, 0.75, 10],
  ["1-1/4", "7/8-9 UNC", 1.248, 1.75, 0.75, 0.102, 0.625, 0.469, 1.125, 1.227, 0.125, 0.75, 0.222, 0.062, 0.05, 1.368, 0.875, 9],
  ["1-1/2", "1-1/8-7 UNC", 1.498, 2.125, 1, 0.138, 0.875, 0.656, 1.5, 1.478, 0.125, 0.964, 0.286, 0.072, 0.06, 1.638, 1.125, 7],
  ["1-3/4", "1-1/4-7 UNC", 1.748, 2.375, 1.125, 0.157, 1, 0.75, 1.75, 1.728, 0.125, 1.089, 0.286, 0.072, 0.07, 1.908, 1.25, 7],
  ["2", "1-1/2-6 UNC", 1.998, 2.75, 1.25, 0.176, 1.25, 0.937, 2, 1.978, 0.125, 1.307, 0.333, 0.102, 0.08, 2.178, 1.5, 6],
];

/** ASME B18.3.3M socket head shoulder screws, mm: shoulder size, thread, pitch, shoulder ds, head dk and k, its top chamfer c, hex key s and engagement t, thread length b, shoulder neck ds1 and L1, thread neck ds2 and L2 */
const METRIC_SHOULDER: readonly ShoulderRow[] = [
  ["6.5", "M5", 0.8, 6.487, 10, 4.5, 0.6, 3, 2.4, 9.75, 5.92, 2.5, 3.86, 2.4],
  ["8", "M6", 1, 7.987, 13, 5.5, 0.8, 4, 3.3, 11.25, 7.42, 2.5, 4.58, 2.6],
  ["10", "M8", 1.25, 9.987, 16, 7, 1, 5, 4.2, 13.25, 9.42, 2.5, 6.25, 2.8],
  ["13", "M10", 1.5, 12.984, 18, 9, 1.2, 6, 4.9, 16.4, 12.42, 2.5, 7.91, 3],
  ["16", "M12", 1.75, 15.984, 24, 11, 1.6, 8, 6.6, 18.4, 15.42, 2.5, 9.57, 4],
  ["20", "M16", 2, 19.98, 30, 14, 2, 10, 8.8, 22.4, 19.42, 2.5, 13.23, 4.8],
  ["25", "M20", 2.5, 24.98, 36, 16, 2.4, 12, 10, 27.4, 24.42, 3, 16.57, 5.6],
];

/** ISO 7379 socket head shoulder screws, mm: shoulder size, thread, pitch, shoulder ds, head dk plain and knurled, k, hex key s, e, key engagement t, thread length b, thread undercut ds1, undercut widths g1 (under the head) and g2 (at the thread), head fillet r */
const ISO_SHOULDER: readonly ShoulderRow[] = [
  ["6.5", "M5", 0.8, 6.487, 10, 10.22, 4.5, 3, 3.44, 2.4, 9.75, 3.86, 2.5, 2, 0.25],
  ["8", "M6", 1, 7.987, 13, 13.27, 5.5, 4, 4.58, 3.3, 11.25, 4.58, 2.5, 2.5, 0.4],
  ["10", "M8", 1.25, 9.987, 16, 16.27, 7, 5, 5.72, 4.2, 13.25, 6.25, 2.5, 3.1, 0.6],
  ["13", "M10", 1.5, 12.984, 18, 18.27, 9, 6, 6.86, 4.9, 16.4, 7.91, 2.5, 3.7, 0.6],
  ["16", "M12", 1.75, 15.984, 24, 24.33, 11, 8, 9.15, 6.6, 18.4, 9.57, 2.5, 4.4, 0.6],
  ["20", "M16", 2, 19.98, 30, 30.33, 14, 10, 11.43, 8.8, 22.4, 13.33, 2.5, 5, 0.8],
  ["25", "M20", 2.5, 24.98, 36, 36.39, 16, 12, 13.72, 10, 27.4, 16.57, 3, 6.3, 0.8],
];

// ---- the types -------------------------------------------------------------------------------

const byPoint = (names: Partial<Record<SetPoint, string>>, fallback: string) => (p: SetPoint): string => names[p] ?? fallback;

export const SET_SCREW_TYPES: Record<FastenerStandard, readonly SetScrewType[]> = {
  asmeInch: [
    { id: "hex", label: SET_HEADS.hex, standard: () => "ASME B18.3", inch: true, sizes: ASME_SOCKET.map((r) => asmeSocket(r, false)) },
    { id: "spline", label: SET_HEADS.spline, standard: () => "ASME B18.3", inch: true, sizes: ASME_SOCKET.filter((r) => r[5]).map((r) => asmeSocket(r, true)) },
    { id: "slotted", label: SET_HEADS.slotted, standard: () => "ASME B18.6.2", inch: true, sizes: ASME_SLOTTED.map(asmeSlotted) },
    { id: "square", label: SET_HEADS.square, standard: () => "ASME B18.6.2", inch: true, sizes: ASME_SQUARE.map(asmeSquare) },
  ],
  asmeMetric: [{ id: "hex", label: SET_HEADS.hex, standard: () => "ASME B18.3.6M", inch: false, sizes: METRIC_SOCKET.map(metricSocket) }],
  iso: [
    { id: "hex", label: SET_HEADS.hex, standard: byPoint({ flat: "ISO 4026", cone: "ISO 4027", dog: "ISO 4028", cup: "ISO 4029" }, "ISO 4026"), inch: false, sizes: ISO_SOCKET.map(isoSocket) },
    { id: "slotted", label: SET_HEADS.slotted, standard: byPoint({ flat: "ISO 4766", cone: "ISO 7434", dog: "ISO 7435", cup: "ISO 7436" }, "ISO 4766"), inch: false, sizes: ISO_SLOTTED.map(isoSlotted) },
  ],
  din: [
    { id: "hex", label: SET_HEADS.hex, standard: byPoint({ flat: "DIN 913", cone: "DIN 914", halfDog: "DIN 915", cup: "DIN 916" }, "DIN 913"), inch: false, sizes: DIN_SOCKET.map(dinSocket) },
    { id: "slotted", label: SET_HEADS.slotted, standard: byPoint({ flat: "DIN 551", cone: "DIN 553", halfDog: "DIN 417", cup: "DIN 438" }, "DIN 551"), inch: false, sizes: DIN_SLOTTED.map(dinSlotted) },
  ],
};

export const SHOULDER_TYPES: Record<FastenerStandard, ShoulderType> = {
  asmeInch: { standard: "ASME B18.3", inch: true, styles: false, fillet: true, sizes: ASME_SHOULDER.map(asmeShoulder) },
  asmeMetric: { standard: "ASME B18.3.3M", inch: false, styles: false, fillet: true, sizes: METRIC_SHOULDER.map(metricShoulder) },
  iso: { standard: "ISO 7379", inch: false, styles: true, fillet: false, sizes: ISO_SHOULDER.map(isoShoulder) },
  din: { standard: "DIN ISO 7379", inch: false, styles: false, fillet: true, sizes: ISO_SHOULDER.map(isoShoulder) },
};
