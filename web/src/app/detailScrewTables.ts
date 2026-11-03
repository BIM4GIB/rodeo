// Sizes for the Detailing tool set's Carriage Bolt, Lag Screw, Wood Screw and Sheet Metal Screw
// (screwShapes.ts draws them), from the standards' tables: ASME B18.5 Tables 1 to 3 (round head,
// round head square neck and round head short square neck bolts, inch), ASME B18.5.2.2M (round
// head square neck bolts, metric) and DIN 603 (the large head); ASME B18.2.1 (hex and square lag
// screws, inch) and B18.2.3.8M (hex lag screws, metric); ASME B18.6.1 (wood screws, inch) and DIN
// 95, 96, 97, 7995, 7996 and 7997 (metric); ASME B18.6.4 and B18.6.3 (tapping screws, inch) and
// ISO 1478, 1479, 1481 to 1483, 7049 to 7051 and 7053 (metric). Heads are the tables' largest;
// threads their rules.

import type { BoltThread } from "./boltShapes.ts";
import type { HeadKind, ScrewHead, WoodThread } from "./screwShapes.ts";

const INCH = 25.4;

const head = (kind: HeadKind, width: number, height: number, more: Partial<ScrewHead> = {}): ScrewHead => ({
  kind,
  width,
  height,
  crown: 0,
  radius: 0,
  socket: null,
  slot: null,
  flange: null,
  washerFace: null,
  angle: 82,
  rounded: false,
  ...more,
});

const inchThread = (size: string, diameter: number, tpi: number): BoltThread => ({ id: `${size}-${tpi} UNC`, diameter: diameter * INCH, pitch: INCH / tpi, inch: true });
const metricThread = (size: string, pitch: number): BoltThread => ({ id: `${size} × ${pitch}`, diameter: Number(size.replace("M", "")), pitch, inch: false });

/** A size of a carriage bolt or lag screw: its nominal size, thread and head. */
export interface DetailSize {
  readonly id: string;
  readonly thread: BoltThread;
  readonly head: ScrewHead;
}

// ---- carriage bolts ----------------------------------------------------------------------------

export type CarriageType = "round" | "shortNeck" | "squareNeck" | "largeHead";
export const CARRIAGE_TYPES: readonly { readonly value: CarriageType; readonly label: string }[] = [
  { value: "round", label: "Round Head" },
  { value: "shortNeck", label: "Round Head Short Square Neck" },
  { value: "squareNeck", label: "Round Head Square Neck" },
  { value: "largeHead", label: "Round Head Square Neck with Large Head" },
];

/** A carriage bolt type in a series: its standard and sizes. */
export interface CarriageBolts {
  readonly type: CarriageType;
  readonly inch: boolean;
  readonly standard: string;
  readonly sizes: readonly DetailSize[];
}

/** a dome on a rim: B18.5.2.2M's edge thickness C where it gives one, else a quarter of the head's height (Rodeo's estimate) */
const carriageHead = (width: number, height: number, rim: number | null, neck: { flats: number; depth: number } | null): ScrewHead =>
  head("carriage", width, height, { crown: rim ?? height / 4, neck });

/** inch rows: size, D, threads per inch, head A, H, then the neck's O and P where it has one (in) */
type InchCarriageRow = readonly [string, number, number, number, number, number?, number?];
const inchCarriage = (rows: readonly InchCarriageRow[], neck = true): DetailSize[] =>
  rows.map(([size, D, tpi, A, H, O, P]) => ({ id: size, thread: inchThread(size, D, tpi), head: carriageHead(A * INCH, H * INCH, null, neck && O && P ? { flats: O * INCH, depth: P * INCH } : null) }));

/** ASME B18.5 Table 2, round head square neck bolts: A, H, O and P max (Table 1's round head bolts have its heads) */
const B18_5_SQUARE_NECK: readonly InchCarriageRow[] = [
  ["#10", 0.19, 24, 0.469, 0.114, 0.199, 0.125],
  ["1/4", 0.25, 20, 0.594, 0.145, 0.26, 0.156],
  ["5/16", 0.3125, 18, 0.719, 0.176, 0.324, 0.187],
  ["3/8", 0.375, 16, 0.844, 0.208, 0.388, 0.219],
  ["7/16", 0.4375, 14, 0.969, 0.239, 0.452, 0.25],
  ["1/2", 0.5, 13, 1.094, 0.27, 0.515, 0.281],
  ["5/8", 0.625, 11, 1.344, 0.344, 0.642, 0.344],
  ["3/4", 0.75, 10, 1.594, 0.406, 0.768, 0.406],
  ["7/8", 0.875, 9, 1.844, 0.469, 0.895, 0.469],
  ["1", 1, 8, 2.094, 0.531, 1.022, 0.531],
];

/** ASME B18.5 Table 3, round head short square neck bolts */
const B18_5_SHORT_NECK: readonly InchCarriageRow[] = [
  ["1/4", 0.25, 20, 0.594, 0.145, 0.26, 0.124],
  ["5/16", 0.3125, 18, 0.719, 0.176, 0.324, 0.124],
  ["3/8", 0.375, 16, 0.844, 0.208, 0.388, 0.156],
  ["7/16", 0.4375, 14, 0.969, 0.239, 0.452, 0.156],
  ["1/2", 0.5, 13, 1.094, 0.27, 0.515, 0.156],
  ["5/8", 0.625, 11, 1.344, 0.344, 0.642, 0.218],
  ["3/4", 0.75, 10, 1.594, 0.406, 0.768, 0.218],
];

/** ASME B18.5.2.2M: size, pitch, dk, K, C min, V, F max (mm) */
const B18_5_2_2M: readonly (readonly [string, number, number, number, number, number, number])[] = [
  ["M5", 0.8, 11.8, 3.1, 1, 5.48, 3.1],
  ["M6", 1, 14.2, 3.6, 1.1, 6.48, 3.6],
  ["M8", 1.25, 18, 4.8, 1.2, 8.58, 4.8],
  ["M10", 1.5, 22.3, 5.8, 1.5, 10.58, 5.8],
  ["M12", 1.75, 26.6, 6.8, 1.8, 12.7, 6.8],
  ["M14", 2, 30.5, 7.9, 2.1, 14.7, 7.9],
  ["M16", 2, 35, 8.9, 2.4, 16.7, 8.9],
  ["M20", 2.5, 43, 10.9, 3, 20.84, 10.9],
  ["M24", 3, 51, 13.1, 3.6, 24.84, 13.1],
];

/** DIN 603: size, pitch, dk (nominal), k, v, f max (mm) */
const DIN_603: readonly (readonly [string, number, number, number, number, number])[] = [
  ["M5", 0.8, 13, 3.3, 5.48, 4.1],
  ["M6", 1, 16, 3.88, 6.48, 4.6],
  ["M8", 1.25, 20, 4.88, 8.58, 5.6],
  ["M10", 1.5, 24, 5.38, 10.58, 6.6],
  ["M12", 1.75, 30, 6.95, 12.7, 8.75],
  ["M16", 2, 38, 8.95, 16.7, 12.9],
  ["M20", 2.5, 46, 11.05, 20.84, 15.9],
];

export const CARRIAGE_BOLTS: readonly CarriageBolts[] = [
  { type: "round", inch: true, standard: "ASME B18.5 Table 1", sizes: inchCarriage(B18_5_SQUARE_NECK.filter((r) => r[0] !== "1"), false) },
  { type: "shortNeck", inch: true, standard: "ASME B18.5 Table 3", sizes: inchCarriage(B18_5_SHORT_NECK) },
  { type: "squareNeck", inch: true, standard: "ASME B18.5 Table 2", sizes: inchCarriage(B18_5_SQUARE_NECK) },
  {
    type: "squareNeck",
    inch: false,
    standard: "ASME B18.5.2.2M",
    sizes: B18_5_2_2M.map(([size, pitch, dk, K, C, V, F]) => ({ id: size, thread: metricThread(size, pitch), head: carriageHead(dk, K, C, { flats: V, depth: F }) })),
  },
  {
    type: "largeHead",
    inch: false,
    standard: "DIN 603",
    sizes: DIN_603.map(([size, pitch, dk, k, v, f]) => ({ id: size, thread: metricThread(size, pitch), head: carriageHead(dk, k, null, { flats: v, depth: f }) })),
  },
];

/** A carriage bolt's thread length: ASME B18.5's 2D + 1/4 in (2D + 1/2 in past 6 in), or the metric standards' 2d + 6, 12 or 25 mm (past 125 and 200 mm). */
export function carriageThreadLength(t: BoltThread, length: number): number {
  const D = t.diameter;
  if (t.inch) return 2 * D + (length <= 6 * INCH + 1e-6 ? 0.25 : 0.5) * INCH;
  return 2 * D + (length <= 125 + 1e-6 ? 6 : length <= 200 + 1e-6 ? 12 : 25);
}

// ---- lag screws --------------------------------------------------------------------------------

export type LagHead = "hex" | "square";

/** A lag screw size: its thread's root diameter and the least plain length under its head, besides its head. */
export interface LagSize extends DetailSize {
  readonly root: number;
  readonly shoulder: number;
}

/** ASME B18.2.1 lag screws: size, D, threads per inch, root D1, shoulder S min, then hex F and H, square F and H max (in) */
const B18_2_1_LAG: readonly (readonly [string, number, number, number, number, number, number, number, number])[] = [
  ["#10", 0.19, 11, 0.12, 0.094, 0.281, 0.14, 0.281, 0.14],
  ["1/4", 0.25, 10, 0.173, 0.094, 0.438, 0.188, 0.375, 0.188],
  ["5/16", 0.3125, 9, 0.227, 0.125, 0.5, 0.235, 0.5, 0.22],
  ["3/8", 0.375, 7, 0.265, 0.125, 0.562, 0.268, 0.562, 0.268],
  ["7/16", 0.4375, 7, 0.328, 0.156, 0.625, 0.316, 0.625, 0.316],
  ["1/2", 0.5, 6, 0.371, 0.156, 0.75, 0.364, 0.75, 0.348],
  ["5/8", 0.625, 5, 0.471, 0.312, 0.938, 0.444, 0.938, 0.444],
  ["3/4", 0.75, 4.5, 0.579, 0.375, 1.125, 0.524, 1.125, 0.524],
  ["7/8", 0.875, 4, 0.683, 0.375, 1.312, 0.604, 1.312, 0.62],
  ["1", 1, 3.5, 0.78, 0.625, 1.5, 0.7, 1.5, 0.684],
  ["1-1/8", 1.125, 3.25, 0.887, 0.625, 1.688, 0.78, 1.688, 0.78],
  ["1-1/4", 1.25, 3.25, 1.012, 0.625, 1.875, 0.876, 1.875, 0.876],
];

/** ASME B18.2.3.8M hex lag screws: size, S, K max, pitch P, root D1 (mm) */
const B18_2_3_8M: readonly (readonly [string, number, number, number, number])[] = [
  ["M5", 8, 3.9, 2.3, 3.2],
  ["M6", 10, 4.4, 2.5, 4],
  ["M8", 13, 5.7, 2.8, 5.8],
  ["M10", 16, 6.9, 3.6, 7.2],
  ["M12", 18, 8, 4.2, 8.7],
  ["M16", 24, 10.8, 5.1, 12],
  ["M20", 30, 13.4, 5.6, 15.6],
  ["M24", 36, 15.9, 7.3, 18.1],
];

const inchLag = (kind: LagHead): LagSize[] =>
  B18_2_1_LAG.map(([size, D, tpi, root, S, hexF, hexH, squareF, squareH]) => ({
    id: size,
    thread: { id: size, diameter: D * INCH, pitch: INCH / tpi, inch: true },
    head: kind === "hex" ? head("hex", hexF * INCH, hexH * INCH) : head("square", squareF * INCH, squareH * INCH),
    root: root * INCH,
    shoulder: S * INCH,
  }));

export const LAG_SCREWS: { readonly inch: Record<LagHead, readonly LagSize[]>; readonly metric: readonly LagSize[] } = {
  inch: { hex: inchLag("hex"), square: inchLag("square") },
  // its plain length under the head half a diameter (Rodeo's reading: B18.2.3.8M's isn't published freely)
  metric: B18_2_3_8M.map(([size, S, K, pitch, root]) => {
    const D = Number(size.replace("M", ""));
    return { id: size, thread: { id: size, diameter: D, pitch, inch: false }, head: head("hex", S, K), root, shoulder: D / 2 };
  }),
};

/** A lag screw's thread length: ASME B18.2.1's half the length and 1/2 in, at most 6 in (in mm for metric ones, 12.7 and 152.4), leaving its shoulder plain. */
export function lagThreadLength(s: LagSize, length: number): number {
  return Math.max(0, Math.min(length / 2 + 0.5 * INCH, 6 * INCH, length - s.shoulder));
}

/** how far a gimlet point tapers: 1.25 diameters, as Vectorworks pictures it (the standards don't give it) */
export const gimletTaper = (diameter: number): number => 1.25 * diameter;

// ---- wood and sheet metal screws ---------------------------------------------------------------

/** a table row: the size's name, then its figures (null where the table has none) */
type Row = readonly [string, ...(number | null)[]];
const fig = (r: Row | undefined, column: number): number => Number(r?.[column] ?? 0);
const rowOf = (rows: readonly Row[], id: string): Row | undefined => rows.find((r) => r[0] === id);

/** ASME B18.6.1 wood screw threads: size, D, threads per inch, thread depth F min (in) */
const WOOD_THREAD_INCH: readonly Row[] = [
  ["2", 0.086, 26, 0.01],
  ["3", 0.099, 24, 0.014],
  ["4", 0.112, 22, 0.016],
  ["5", 0.125, 20, 0.018],
  ["6", 0.138, 18, 0.02],
  ["7", 0.151, 16, 0.022],
  ["8", 0.164, 15, 0.023],
  ["9", 0.177, 14, 0.026],
  ["10", 0.19, 13, 0.03],
  ["12", 0.216, 11, 0.031],
  ["14", 0.242, 10, 0.035],
  ["16", 0.268, 9, 0.038],
];

/** ASME B18.6.1 flat countersunk heads, slotted: size, D, threads per inch, A max, H, slot J and T max (in) */
const WOOD_FLAT_INCH: readonly Row[] = [
  ["0", 0.06, 32, 0.119, 0.035, 0.023, 0.015],
  ["1", 0.073, 28, 0.146, 0.043, 0.026, 0.019],
  ["2", 0.086, 26, 0.172, 0.051, 0.031, 0.023],
  ["3", 0.099, 24, 0.199, 0.059, 0.035, 0.027],
  ["4", 0.112, 22, 0.225, 0.067, 0.039, 0.03],
  ["5", 0.125, 20, 0.252, 0.075, 0.043, 0.034],
  ["6", 0.138, 18, 0.279, 0.083, 0.048, 0.038],
  ["7", 0.151, 16, 0.305, 0.091, 0.048, 0.041],
  ["8", 0.164, 15, 0.332, 0.1, 0.054, 0.045],
  ["9", 0.177, 14, 0.358, 0.108, 0.054, 0.049],
  ["10", 0.19, 13, 0.385, 0.116, 0.06, 0.053],
  ["12", 0.216, 11, 0.438, 0.132, 0.067, 0.06],
  ["14", 0.242, 10, 0.507, 0.153, 0.075, 0.07],
  ["16", 0.268, 9, 0.544, 0.164, 0.075, 0.075],
  ["18", 0.294, 8, 0.635, 0.191, 0.084, 0.083],
  ["20", 0.32, 8, 0.65, 0.196, 0.084, 0.09],
  ["24", 0.372, 7, 0.762, 0.23, 0.094, 0.106],
];

/** ASME B18.6.1 flat heads, cross recess: size, M and G max (in) */
const WOOD_FLAT_CROSS_INCH: readonly Row[] = [
  ["2", 0.102, 0.063],
  ["3", 0.107, 0.068],
  ["4", 0.128, 0.089],
  ["5", 0.154, 0.086],
  ["6", 0.174, 0.106],
  ["7", 0.189, 0.121],
  ["8", 0.204, 0.136],
  ["9", 0.214, 0.146],
  ["10", 0.258, 0.146],
  ["12", 0.283, 0.171],
  ["14", 0.283, 0.171],
  ["16", 0.303, 0.191],
];

/** ASME B18.6.1 oval countersunk heads, slotted: size, D, threads per inch, A max, H, O max, slot J and V max (in) */
const WOOD_OVAL_INCH: readonly Row[] = [
  ["0", 0.06, 32, 0.119, 0.035, 0.056, 0.023, 0.03],
  ["1", 0.073, 28, 0.146, 0.043, 0.068, 0.026, 0.038],
  ["2", 0.086, 26, 0.172, 0.051, 0.08, 0.031, 0.045],
  ["3", 0.099, 24, 0.199, 0.059, 0.092, 0.035, 0.052],
  ["4", 0.112, 22, 0.225, 0.067, 0.104, 0.039, 0.059],
  ["5", 0.125, 20, 0.252, 0.075, 0.116, 0.043, 0.067],
  ["6", 0.138, 18, 0.279, 0.083, 0.128, 0.048, 0.074],
  ["7", 0.151, 16, 0.305, 0.091, 0.14, 0.048, 0.081],
  ["8", 0.164, 15, 0.332, 0.1, 0.152, 0.054, 0.088],
  ["9", 0.177, 14, 0.358, 0.108, 0.164, 0.054, 0.095],
  ["10", 0.19, 13, 0.385, 0.116, 0.176, 0.06, 0.103],
  ["12", 0.216, 11, 0.438, 0.132, 0.2, 0.067, 0.117],
  ["14", 0.242, 10, 0.507, 0.153, 0.232, 0.075, 0.136],
  ["16", 0.268, 9, 0.544, 0.164, 0.248, 0.075, 0.146],
  ["18", 0.294, 8, 0.635, 0.191, 0.29, 0.084, 0.171],
  ["20", 0.32, 8, 0.65, 0.196, 0.296, 0.084, 0.175],
  ["24", 0.372, 7, 0.762, 0.23, 0.347, 0.094, 0.204],
];

/** ASME B18.6.1 oval heads, cross recess: size, M and G max (in) */
const WOOD_OVAL_CROSS_INCH: readonly Row[] = [
  ["4", 0.136, 0.094],
  ["5", 0.158, 0.085],
  ["6", 0.178, 0.105],
  ["8", 0.205, 0.131],
  ["9", 0.216, 0.144],
  ["10", 0.261, 0.142],
  ["12", 0.283, 0.165],
];

/** ASME B18.6.1 pan heads, slotted: size, D, threads per inch, B and K max, P, slot J and U max (in) */
const WOOD_PAN_INCH: readonly Row[] = [
  ["0", 0.06, 32, 0.116, 0.039, 0.02, 0.023, 0.022],
  ["1", 0.073, 28, 0.142, 0.046, 0.025, 0.026, 0.027],
  ["2", 0.086, 26, 0.167, 0.053, 0.035, 0.031, 0.031],
  ["3", 0.099, 24, 0.193, 0.06, 0.037, 0.035, 0.035],
  ["4", 0.112, 22, 0.219, 0.068, 0.042, 0.039, 0.04],
  ["5", 0.125, 20, 0.245, 0.075, 0.044, 0.043, 0.045],
  ["6", 0.138, 18, 0.27, 0.082, 0.046, 0.048, 0.05],
  ["7", 0.151, 16, 0.296, 0.089, 0.049, 0.048, 0.054],
  ["8", 0.164, 15, 0.322, 0.096, 0.052, 0.054, 0.058],
  ["9", 0.177, 14, 0.348, 0.103, 0.056, 0.054, 0.063],
  ["10", 0.19, 13, 0.373, 0.11, 0.061, 0.06, 0.068],
  ["12", 0.216, 11, 0.425, 0.125, 0.078, 0.067, 0.077],
  ["14", 0.242, 10, 0.492, 0.144, 0.087, 0.075, 0.087],
  ["16", 0.268, 9, 0.528, 0.153, 0.094, 0.075, 0.093],
  ["18", 0.294, 8, 0.615, 0.178, 0.099, 0.084, 0.106],
  ["20", 0.32, 8, 0.631, 0.182, 0.121, 0.084, 0.108],
  ["24", 0.372, 7, 0.74, 0.212, 0.143, 0.094, 0.124],
];

/** ASME B18.6.1 round heads: size, A and H max, slot J and T max, cross recess M and G max (in) */
const WOOD_ROUND_INCH: readonly Row[] = [
  ["2", 0.162, 0.069, 0.031, 0.048, 0.114, 0.064],
  ["4", 0.211, 0.086, 0.039, 0.058, 0.13, 0.083],
  ["5", 0.236, 0.095, 0.043, 0.063, 0.154, 0.074],
  ["6", 0.26, 0.103, 0.048, 0.068, 0.162, 0.084],
  ["7", 0.285, 0.111, 0.048, 0.072, 0.17, 0.092],
  ["8", 0.309, 0.12, 0.054, 0.077, 0.178, 0.101],
  ["9", 0.334, 0.128, 0.054, 0.082, 0.186, 0.11],
  ["10", 0.359, 0.137, 0.06, 0.087, 0.195, 0.119],
  ["12", 0.408, 0.153, 0.067, 0.096, 0.249, 0.125],
  ["14", 0.457, 0.17, 0.075, 0.106, 0.265, 0.142],
];

/** DIN 97 slotted countersunk heads: size, D, k max, slot t max and n (mm) */
const DIN_97: readonly Row[] = [
  ["1.6", 3, 0.96, 0.45, 0.4],
  ["2", 3.8, 1.2, 0.6, 0.5],
  ["2.5", 4.7, 1.5, 0.7, 0.6],
  ["3", 5.6, 1.65, 0.85, 0.8],
  ["3.5", 6.5, 1.93, 1, 0.8],
  ["4", 7.5, 2.2, 1.1, 1],
  ["4.5", 8.3, 2.35, 1.2, 1],
  ["5", 9.2, 2.5, 1.3, 1.2],
  ["5.5", 10.2, 2.75, 1.4, 1.2],
  ["6", 11, 3, 1.6, 1.6],
  ["7", 12.5, 3.5, 1.9, 2],
  ["8", 14.5, 4, 2.1, 2],
  ["10", 18, 5, 2.6, 2.5],
];

/** DIN 7997 cross recessed countersunk heads: size, dk, k max, recess m (mm) */
const DIN_7997: readonly Row[] = [
  ["2", 3.8, 1.2, null],
  ["2.5", 4.7, 1.5, 2.7],
  ["3", 5.6, 1.65, 2.9],
  ["3.5", 6.5, 1.93, 3.9],
  ["4", 7.5, 2.2, 4.4],
  ["4.5", 8.3, 2.35, 4.6],
  ["5", 9.2, 2.5, 4.8],
  ["5.5", 10.2, 2.75, 6.2],
  ["6", 11, 3, 6.6],
  ["7", 12.5, 3.5, 6.8],
  ["8", 14, 4, 8.7],
];

/** DIN 95 slotted raised countersunk heads: size, dk, k max, raise f, slot t max and n (mm) */
const DIN_95: readonly Row[] = [
  ["1.6", 3, 0.96, 0.4, 0.8, 0.4],
  ["2", 3.8, 1.2, 0.5, 1, 0.5],
  ["2.5", 4.7, 1.5, 0.6, 1.2, 0.6],
  ["3", 5.6, 1.65, 0.75, 1.45, 0.8],
  ["3.5", 6.5, 1.93, 0.9, 1.7, 0.8],
  ["4", 7.5, 2.2, 1, 1.9, 1],
  ["4.5", 8.3, 2.35, 1.1, 2.1, 1],
  ["5", 9.2, 2.5, 1.25, 2.3, 1.2],
  ["5.5", 10.2, 2.75, 1.4, 2.5, 1.2],
  ["6", 11, 3, 1.5, 2.8, 1.6],
  ["7", 12.5, 3.5, 1.8, 3.2, 2],
  ["8", 14.5, 4, 2, 3.7, 2],
];

/** DIN 7995 cross recessed raised countersunk heads: size, dk, k max, recess m (mm) */
const DIN_7995: readonly Row[] = [
  ["2", 3.8, 1.2, null],
  ["2.5", 4.7, 1.5, 2.7],
  ["3", 5.6, 1.65, 3.1],
  ["3.5", 6.5, 1.93, 4.2],
  ["4", 7.5, 2.2, 4.5],
  ["4.5", 8.3, 2.35, 5],
  ["5", 9.2, 2.5, 5.3],
  ["5.5", 10.2, 2.75, 7.1],
  ["6", 11, 3, 7.4],
  ["7", 12.5, 3.5, 8.3],
  ["8", 14, 4, 9],
];

/** DIN 96 slotted round heads: size, dk, k, slot t max and n (mm) */
const DIN_96: readonly Row[] = [
  ["1.6", 3.2, 1.1, 0.7, 0.4],
  ["2", 4, 1.4, 0.9, 0.5],
  ["2.5", 5, 1.7, 1.1, 0.6],
  ["3", 6, 2.1, 1.35, 0.8],
  ["3.5", 7, 2.4, 1.6, 0.8],
  ["4", 8, 2.8, 1.8, 1],
  ["4.5", 9, 3.1, 2, 1],
  ["5", 10, 3.5, 2.3, 1.2],
  ["5.5", 11, 3.8, 2.5, 1.2],
  ["6", 12, 4.2, 2.7, 1.6],
  ["7", 14, 4.9, 3.2, 2],
  ["8", 16, 5.6, 3.6, 2],
];

/** DIN 7996 cross recessed round heads: size, dk, k, recess m (mm) */
const DIN_7996: readonly Row[] = [
  ["2", 4, 1.4, null],
  ["2.5", 5, 1.7, 2.3],
  ["3", 6, 2.1, 2.7],
  ["3.5", 7, 2.35, 3.7],
  ["4", 8, 2.8, 4.1],
  ["4.5", 9, 3.1, 4.4],
  ["5", 10, 3.5, 4.8],
  ["5.5", 11, 3.8, 6.2],
  ["6", 12, 4.2, 6.6],
  ["7", 14, 4.9, 7.3],
  ["8", 16, 5.6, 8.8],
];

/** ASME B18.6.4 Type AB threads: size, D, threads per inch, major and minor max (in) */
const TAP_AB_INCH: readonly Row[] = [
  ["0", 0.06, 48, 0.06, 0.036],
  ["1", 0.073, 42, 0.075, 0.049],
  ["2", 0.086, 32, 0.088, 0.064],
  ["3", 0.099, 28, 0.101, 0.075],
  ["4", 0.112, 24, 0.114, 0.086],
  ["5", 0.125, 20, 0.13, 0.094],
  ["6", 0.138, 20, 0.139, 0.104],
  ["7", 0.151, 19, 0.154, 0.115],
  ["8", 0.164, 18, 0.166, 0.122],
  ["10", 0.19, 16, 0.189, 0.141],
  ["12", 0.216, 14, 0.215, 0.164],
  ["1/4", 0.25, 14, 0.246, 0.192],
  ["5/16", 0.3125, 12, 0.315, 0.244],
  ["3/8", 0.375, 12, 0.38, 0.309],
  ["7/16", 0.4375, 10, 0.44, 0.359],
  ["1/2", 0.5, 10, 0.504, 0.423],
];

/** ASME B18.6.4 Type A threads: size, D, threads per inch, major and minor max (in) */
const TAP_A_INCH: readonly Row[] = [
  ["0", 0.06, 40, 0.06, 0.042],
  ["1", 0.073, 32, 0.075, 0.051],
  ["2", 0.086, 32, 0.088, 0.061],
  ["3", 0.099, 28, 0.101, 0.076],
  ["4", 0.112, 24, 0.114, 0.083],
  ["5", 0.125, 20, 0.13, 0.095],
  ["6", 0.138, 18, 0.141, 0.102],
  ["7", 0.151, 16, 0.158, 0.114],
  ["8", 0.164, 15, 0.168, 0.123],
  ["10", 0.19, 12, 0.194, 0.133],
  ["12", 0.216, 11, 0.221, 0.162],
  ["14", 0.242, 10, 0.254, 0.185],
  ["16", 0.268, 10, 0.28, 0.197],
  ["18", 0.294, 9, 0.306, 0.217],
  ["20", 0.32, 9, 0.333, 0.234],
  ["24", 0.372, 9, 0.39, 0.291],
];

/** ASME B18.6.4 Type B threads: size, D, threads per inch, major and minor max, point P and taper S max (in) */
const TAP_B_INCH: readonly Row[] = [
  ["2", 0.086, 32, 0.088, 0.064, 0.058, 0.062],
  ["3", 0.099, 28, 0.101, 0.075, 0.068, 0.071],
  ["4", 0.112, 24, 0.114, 0.086, 0.079, 0.083],
  ["5", 0.125, 20, 0.13, 0.094, 0.087, 0.1],
  ["6", 0.138, 20, 0.139, 0.104, 0.095, 0.1],
  ["7", 0.151, 19, 0.154, 0.115, 0.105, 0.105],
  ["8", 0.164, 18, 0.166, 0.122, 0.112, 0.111],
  ["10", 0.19, 16, 0.189, 0.141, 0.13, 0.125],
  ["12", 0.216, 14, 0.215, 0.164, 0.152, 0.143],
  ["1/4", 0.25, 14, 0.246, 0.192, 0.179, 0.143],
  ["5/16", 0.3125, 12, 0.315, 0.244, 0.23, 0.167],
  ["3/8", 0.375, 12, 0.38, 0.309, 0.293, 0.167],
];

/** ASME B18.6.4 flat (82°) heads: size, A and H max, slot J and T max, cross recess M and depth (in) */
const TAP_FLAT_INCH: readonly Row[] = [
  ["0", 0.112, 0.035, 0.023, 0.015, 0.062, 0.035],
  ["1", 0.137, 0.043, 0.026, 0.019, 0.07, 0.043],
  ["2", 0.162, 0.051, 0.031, 0.023, 0.096, 0.055],
  ["3", 0.187, 0.061, 0.035, 0.027, 0.1, 0.06],
  ["4", 0.212, 0.067, 0.039, 0.03, 0.122, 0.081],
  ["5", 0.237, 0.075, 0.043, 0.034, 0.148, 0.074],
  ["6", 0.262, 0.083, 0.048, 0.038, 0.168, 0.094],
  ["7", 0.287, 0.091, 0.048, 0.041, 0.176, 0.102],
  ["8", 0.312, 0.1, 0.054, 0.045, 0.182, 0.11],
  ["10", 0.362, 0.116, 0.06, 0.053, 0.198, 0.124],
  ["12", 0.412, 0.132, 0.067, 0.06, 0.262, 0.144],
  ["14", 0.462, 0.148, 0.075, 0.068, 0.276, 0.16],
  ["1/4", 0.477, 0.153, 0.075, 0.07, 0.276, 0.16],
  ["5/16", 0.597, 0.191, 0.084, 0.088, 0.358, 0.205],
  ["3/8", 0.717, 0.23, 0.094, 0.106, 0.386, 0.234],
  ["1/2", 0.815, 0.223, 0.106, 0.103, 0.418, 0.265],
];

/** ASME B18.6.4 oval heads: size, A, H and O max, slot J and T max, cross recess M and depth (in) */
const TAP_OVAL_INCH: readonly Row[] = [
  ["0", 0.112, 0.035, 0.056, 0.023, 0.03, 0.068, 0.036],
  ["1", 0.137, 0.043, 0.068, 0.026, 0.038, 0.07, 0.039],
  ["2", 0.162, 0.051, 0.08, 0.031, 0.045, 0.106, 0.06],
  ["3", 0.187, 0.059, 0.092, 0.035, 0.052, 0.118, 0.072],
  ["4", 0.212, 0.067, 0.104, 0.039, 0.059, 0.13, 0.086],
  ["5", 0.237, 0.075, 0.116, 0.043, 0.067, 0.152, 0.073],
  ["6", 0.262, 0.083, 0.128, 0.048, 0.074, 0.172, 0.092],
  ["7", 0.287, 0.091, 0.14, 0.048, 0.081, 0.176, 0.098],
  ["8", 0.312, 0.1, 0.152, 0.054, 0.088, 0.186, 0.107],
  ["10", 0.362, 0.116, 0.176, 0.06, 0.103, 0.202, 0.125],
  ["12", 0.412, 0.132, 0.2, 0.067, 0.117, 0.264, 0.14],
  ["14", 0.462, 0.148, 0.224, 0.075, 0.132, 0.282, 0.152],
  ["1/4", 0.477, 0.153, 0.232, 0.075, 0.136, 0.284, 0.16],
  ["5/16", 0.597, 0.191, 0.29, 0.084, 0.171, 0.384, 0.226],
  ["3/8", 0.717, 0.23, 0.347, 0.094, 0.206, 0.404, 0.245],
  ["7/16", 0.76, 0.223, 0.345, 0.094, 0.21, 0.416, 0.257],
  ["1/2", 0.815, 0.223, 0.354, 0.106, 0.216, 0.43, 0.271],
];

/** ASME B18.6.4 truss heads: size, A and H max, slot J and T max, cross recess M and G max (in) */
const TAP_TRUSS_INCH: readonly Row[] = [
  ["2", 0.194, 0.053, 0.031, 0.031, 0.104, 0.05],
  ["4", 0.257, 0.069, 0.039, 0.04, 0.112, 0.069],
  ["5", 0.289, 0.078, 0.043, 0.045, 0.128, 0.076],
  ["6", 0.321, 0.086, 0.048, 0.05, 0.158, 0.084],
  ["7", 0.352, 0.094, 0.048, 0.054, 0.165, 0.078],
  ["8", 0.384, 0.102, 0.054, 0.058, 0.173, 0.099],
  ["10", 0.448, 0.118, 0.06, 0.068, 0.188, 0.115],
  ["12", 0.511, 0.134, 0.067, 0.077, 0.248, 0.128],
  ["14", 0.557, 0.146, 0.075, 0.085, 0.263, 0.13],
  ["1/4", 0.573, 0.15, 0.075, 0.087, 0.263, 0.143],
  ["5/16", 0.698, 0.183, 0.084, 0.106, 0.352, 0.193],
  ["3/8", 0.823, 0.215, 0.094, 0.124, 0.383, 0.226],
];

/** ASME B18.6.3 pan heads: size, A, H (slotted) and H1 (recessed) max, slot J and T max, cross recess M and depth max (in) */
const TAP_PAN_INCH: readonly Row[] = [
  ["0", 0.116, 0.039, 0.044, 0.023, 0.022, 0.06, 0.032],
  ["2", 0.167, 0.053, 0.062, 0.031, 0.031, 0.097, 0.052],
  ["3", 0.193, 0.06, 0.071, 0.035, 0.036, 0.105, 0.061],
  ["4", 0.219, 0.068, 0.08, 0.039, 0.04, 0.115, 0.071],
  ["5", 0.245, 0.075, 0.089, 0.043, 0.045, 0.152, 0.072],
  ["6", 0.27, 0.082, 0.097, 0.048, 0.05, 0.159, 0.08],
  ["8", 0.322, 0.096, 0.115, 0.054, 0.058, 0.175, 0.097],
  ["10", 0.373, 0.11, 0.133, 0.06, 0.068, 0.192, 0.113],
  ["12", 0.425, 0.125, 0.151, 0.067, 0.077, 0.252, 0.124],
  ["1/4", 0.492, 0.144, 0.175, 0.075, 0.087, 0.274, 0.144],
  ["5/16", 0.615, 0.178, 0.218, 0.084, 0.106, 0.343, 0.173],
  ["3/8", 0.74, 0.212, 0.261, 0.094, 0.124, 0.382, 0.213],
  ["1/2", 0.987, 0.281, 0.348, 0.106, 0.161, 0.428, 0.26],
];

/** ASME B18.6.3 hex and hex washer heads: size, A and H max, washer F and U max, slot J and T max (in) */
const TAP_HEX_INCH: readonly Row[] = [
  ["4", 0.188, 0.06, 0.243, 0.019, 0.039, 0.036],
  ["6", 0.25, 0.093, 0.328, 0.025, 0.048, 0.046],
  ["7", 0.25, 0.093, 0.328, 0.029, 0.048, 0.054],
  ["8", 0.25, 0.11, 0.348, 0.031, 0.054, 0.066],
  ["10", 0.312, 0.12, 0.414, 0.031, 0.06, 0.072],
  ["12", 0.312, 0.155, 0.432, 0.039, 0.067, 0.093],
  ["14", 0.375, 0.19, 0.52, 0.05, 0.075, 0.101],
  ["1/4", 0.375, 0.19, 0.52, 0.05, 0.075, 0.101],
  ["5/16", 0.5, 0.23, 0.676, 0.055, 0.084, 0.122],
  ["3/8", 0.562, 0.295, 0.78, 0.063, 0.094, 0.156],
  ["1/2", 0.75, 0.4, 1.04, 0.085, 0.106, 0.19],
];

/** ASME B18.6.3 square recess (pan heads): size, D, recess M and T (in) */
const SQUARE_RECESS_INCH: readonly Row[] = [
  ["4", 0.112, 0.07, 0.066],
  ["6", 0.138, 0.091, 0.106],
  ["8", 0.164, 0.112, 0.127],
  ["10", 0.19, 0.112, 0.127],
  ["12", 0.216, 0.133, 0.158],
  ["1/4", 0.25, 0.133, 0.158],
  ["5/16", 0.3125, 0.191, 0.194],
];

/** ISO 1478 tapping screw threads: size, pitch, major d1 and minor d2 max, flat end d3 max, incomplete thread y for types C and F (mm) */
const ISO_1478: readonly Row[] = [
  ["ST1.5", 0.5, 1.52, 0.91, 0.79, 1.4, 1.1],
  ["ST1.9", 0.6, 1.9, 1.24, 1.12, 1.6, 1.2],
  ["ST2.2", 0.8, 2.24, 1.63, 1.47, 2, 1.6],
  ["ST2.6", 0.9, 2.57, 1.9, 1.73, 2.3, 1.8],
  ["ST2.9", 1.1, 2.9, 2.18, 2.01, 2.6, 2.1],
  ["ST3.3", 1.3, 3.3, 2.39, 2.21, 3, 2.5],
  ["ST3.5", 1.3, 3.53, 2.64, 2.41, 3.2, 2.5],
  ["ST3.9", 1.3, 3.91, 2.92, 2.67, 3.5, 2.7],
  ["ST4.2", 1.4, 4.22, 3.1, 2.84, 3.7, 2.8],
  ["ST4.8", 1.6, 4.8, 3.58, 3.3, 4.3, 3.2],
  ["ST5.5", 1.8, 5.46, 4.17, 3.86, 5, 3.6],
  ["ST6.3", 1.8, 6.25, 4.88, 4.55, 6, 3.6],
  ["ST8", 2.1, 8, 6.2, 5.84, 7.5, 4.2],
  ["ST9.5", 2.1, 9.65, 7.85, 7.44, 8, 4.2],
];

/** ISO 7049 cross recessed pan heads: size, dk and k max, recess m (mm) */
const ISO_7049: readonly Row[] = [
  ["ST2.2", 4, 1.6, 1.9],
  ["ST2.9", 5.6, 2.4, 3],
  ["ST3.5", 7, 2.6, 3.9],
  ["ST4.2", 8, 3.1, 4.4],
  ["ST4.8", 9.5, 3.7, 4.9],
  ["ST5.5", 11, 4, 6.4],
  ["ST6.3", 12, 4.6, 6.9],
  ["ST8", 16, 6, 9],
  ["ST9.5", 20, 7.5, 10.1],
];

/** ISO 1481 slotted pan heads: size, dk and k max, slot t min and n (mm) */
const ISO_1481: readonly Row[] = [
  ["ST2.2", 4, 1.3, 0.5, 0.5],
  ["ST2.9", 5.6, 1.8, 0.7, 0.8],
  ["ST3.5", 7, 2.1, 0.8, 1],
  ["ST4.2", 8, 2.4, 1, 1.2],
  ["ST4.8", 9.5, 3, 1.2, 1.2],
  ["ST5.5", 11, 3.2, 1.3, 1.6],
  ["ST6.3", 12, 3.6, 1.4, 1.6],
  ["ST8", 16, 4.8, 1.9, 2],
  ["ST9.5", 20, 6, 2.4, 2.5],
];

/** ISO 7050 cross recessed countersunk heads: size, dk and k max, recess m (mm) */
const ISO_7050: readonly Row[] = [
  ["ST2.2", 3.8, 1.1, 1.9],
  ["ST2.9", 5.5, 1.7, 3.2],
  ["ST3.5", 7.3, 2.35, 4.4],
  ["ST4.2", 8.4, 2.6, 4.6],
  ["ST4.8", 9.3, 2.8, 5.2],
  ["ST5.5", 10.3, 3, 6.6],
  ["ST6.3", 11.3, 3.15, 6.8],
  ["ST8", 15.8, 4.65, 8.9],
  ["ST9.5", 18.3, 5.25, 10],
];

/** ISO 1482 slotted countersunk heads: size, dk and k max, slot t min and n (mm) */
const ISO_1482: readonly Row[] = [
  ["ST2.2", 3.8, 1.1, 0.4, 0.5],
  ["ST2.9", 5.5, 1.7, 0.6, 0.8],
  ["ST3.5", 7.3, 2.35, 0.9, 1],
  ["ST4.2", 8.4, 2.6, 1, 1.2],
  ["ST4.8", 9.3, 2.8, 1.1, 1.2],
  ["ST5.5", 10.3, 3, 1.1, 1.6],
  ["ST6.3", 11.3, 3.15, 1.2, 1.6],
  ["ST8", 15.8, 4.65, 1.8, 2],
  ["ST9.5", 18.3, 5.25, 2, 2.5],
];

/** ISO 7051 cross recessed raised countersunk heads: size, dk and k max, raise f, recess m (mm) */
const ISO_7051: readonly Row[] = [
  ["ST2.2", 3.8, 1.1, 0.5, 1.9],
  ["ST2.9", 5.5, 1.7, 0.7, 3.2],
  ["ST3.5", 7.3, 2.35, 0.8, 4.4],
  ["ST4.2", 8.4, 2.6, 1, 4.6],
  ["ST4.8", 9.3, 2.8, 1.2, 5.2],
  ["ST5.5", 10.3, 3, 1.3, 6.6],
  ["ST6.3", 11.3, 3.15, 1.4, 6.8],
  ["ST8", 15.8, 4.65, 2, 8.9],
  ["ST9.5", 18.3, 5.25, 2.3, 10],
];

/** ISO 1483 slotted raised countersunk heads: size, dk and k max, raise f, slot t min and n (mm) */
const ISO_1483: readonly Row[] = [
  ["ST2.2", 3.8, 1.1, 0.5, 0.8, 0.5],
  ["ST2.9", 5.5, 1.7, 0.7, 1.2, 0.8],
  ["ST3.5", 7.3, 2.35, 0.8, 1.4, 1],
  ["ST4.2", 8.4, 2.6, 1, 1.6, 1.2],
  ["ST4.8", 9.3, 2.8, 1.2, 2, 1.2],
  ["ST5.5", 10.3, 3, 1.3, 2.2, 1.6],
  ["ST6.3", 11.3, 3.15, 1.4, 2.4, 1.6],
  ["ST8", 15.8, 4.65, 2, 3.2, 2],
  ["ST9.5", 18.3, 5.25, 2.3, 3.8, 2.5],
];

/** ISO 1479 hexagon heads: size, s and k max (mm); ST4.2's and ST8's k (printed 3.8 and 6.7, out of step with their neighbours) are taken as 3 and 6 */
const ISO_1479: readonly Row[] = [
  ["ST2.2", 3.2, 1.6],
  ["ST2.9", 5, 2.3],
  ["ST3.5", 5.5, 2.6],
  ["ST4.2", 7, 3],
  ["ST4.8", 8, 3.8],
  ["ST5.5", 8, 4.1],
  ["ST6.3", 10, 4.7],
  ["ST8", 13, 6],
  ["ST9.5", 16, 7.5],
];

/** ISO 7053 hexagon washer heads: size, s and k max, washer dk max and c min (mm) */
const ISO_7053: readonly Row[] = [
  ["ST2.9", 4, 2.8, 6.3, 0.4],
  ["ST3.5", 5.5, 3.4, 8.3, 0.6],
  ["ST3.9", 5.5, 3.4, 8.3, 0.6],
  ["ST4.2", 7, 4.1, 8.8, 0.8],
  ["ST4.8", 8, 4.3, 10.5, 0.9],
  ["ST5.5", 8, 5.4, 11, 1],
  ["ST6.3", 10, 5.9, 13.5, 1],
  ["ST8", 13, 7, 18, 1.2],
];

export type SlotType = "regular" | "cross" | "square";
export const SLOT_TYPES: readonly { readonly value: SlotType; readonly label: string }[] = [
  { value: "regular", label: "Regular" },
  { value: "cross", label: "Cross" },
  { value: "square", label: "Square" },
];

/** A wood or sheet metal screw size: its name, label, series and nominal diameter. */
export interface ScrewNominal {
  readonly id: string;
  readonly label: string;
  readonly inch: boolean;
  readonly diameter: number;
}

/** the figures of the row of `rows` (its diameter in `diameters`) nearest `diameter`, scaled to it */
function scaledRow(rows: readonly Row[], diameterOf: (r: Row) => number, diameter: number, columns: readonly number[]): number[] {
  const near = rows.reduce((a, b) => (Math.abs(diameterOf(b) - diameter) < Math.abs(diameterOf(a) - diameter) ? b : a));
  const k = diameter / diameterOf(near);
  return columns.map((c) => fig(near, c) * k);
}

/** a square (Robertson) recess: ASME B18.6.3's for pan heads, the nearest size's scaled to the diameter (the only table found) */
function squareRecess(diameter: number): ScrewHead["recess"] {
  const [width, depth] = scaledRow(SQUARE_RECESS_INCH, (r) => fig(r, 1) * INCH, diameter, [2, 3]).map((x) => x * INCH);
  return { kind: "square", width, depth };
}

/** a cross recess m across; DIN and ISO give no depth, so it's taken as 0.6 of m, as ASME's run */
const metricCross = (m: number): ScrewHead["recess"] => ({ kind: "cross", width: m, depth: 0.6 * m });

// wood screws

export type WoodHead = "flat" | "oval" | "pan" | "round";
export const WOOD_HEADS: readonly { readonly value: WoodHead; readonly label: string }[] = [
  { value: "flat", label: "Flat Countersunk" },
  { value: "oval", label: "Oval Countersunk" },
  { value: "pan", label: "Pan" },
  { value: "round", label: "Round" },
];

const DIN_WOOD_SIZES = [1.6, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 10];
export const WOOD_SIZES: { readonly inch: readonly ScrewNominal[]; readonly metric: readonly ScrewNominal[] } = {
  inch: WOOD_FLAT_INCH.map((r) => ({ id: `#${r[0]}`, label: `#${r[0]}`, inch: true, diameter: fig(r, 1) * INCH })),
  metric: DIN_WOOD_SIZES.map((d) => ({ id: String(d), label: `${d} mm`, inch: false, diameter: d })),
};

/** ASME B18.6.1's threads per inch and thread depth for each inch size; sizes past its thread table take the nearest size's depth for their pitch */
function inchWoodThread(id: string): { pitch: number; depth: number } {
  const n = id.replace("#", "");
  const r = rowOf(WOOD_FLAT_INCH, n)!;
  const pitch = INCH / fig(r, 2);
  const t = rowOf(WOOD_THREAD_INCH, n);
  if (t) return { pitch, depth: fig(t, 3) * INCH };
  const near = WOOD_THREAD_INCH.reduce((a, b) => (Math.abs(fig(b, 1) - fig(r, 1)) < Math.abs(fig(a, 1) - fig(r, 1)) ? b : a));
  return { pitch, depth: fig(near, 3) * fig(near, 2) * pitch };
}

/** a wood screw's thread: ASME B18.6.1's, or for metric sizes (DIN 7998, their thread standard, isn't published freely) the inch pitch and depth for the diameter, in proportion */
export function woodThread(s: ScrewNominal): { pitch: number; root: number } {
  if (s.inch) {
    const { pitch, depth } = inchWoodThread(s.id);
    return { pitch, root: s.diameter - 2 * depth };
  }
  const near = WOOD_SIZES.inch.reduce((a, b) => (Math.abs(b.diameter - s.diameter) < Math.abs(a.diameter - s.diameter) ? b : a));
  const { pitch, depth } = inchWoodThread(near.id);
  const k = s.diameter / near.diameter;
  return { pitch: pitch * k, root: s.diameter - 2 * depth * k };
}

const sizeRange = (rows: readonly Row[], inch: boolean): string => {
  const name = (r: Row): string => (inch ? `#${r[0]}` : `${r[0]} mm`);
  return `${name(rows[0])} to ${name(rows[rows.length - 1])}`;
};

/** A wood screw's head for its size, head type and slot, or why there isn't one. */
export function woodHead(s: ScrewNominal, kind: WoodHead, slot: SlotType): ScrewHead | string {
  const D = s.diameter;
  const n = s.inch ? s.id.replace("#", "") : s.id;
  const label = WOOD_HEADS.find((h) => h.value === kind)!.label;
  const k = s.inch ? INCH : 1;
  if (s.inch) {
    // a row's diameter by its size, from the flat head table, which lists every size
    const inchD = (r: Row): number => fig(rowOf(WOOD_FLAT_INCH, r[0]), 1) * INCH;
    // a cross recess from the head's table, or the nearest size's scaled where it stops
    const cross = (rows: readonly Row[], m: number, g: number): ScrewHead["recess"] => {
      const [width, depth] = scaledRow(rows, inchD, D, [m, g]);
      return { kind: "cross", width: width * INCH, depth: depth * INCH };
    };
    const recess = (rows: readonly Row[], m: number, g: number): ScrewHead["recess"] => (slot === "cross" ? cross(rows, m, g) : slot === "square" ? squareRecess(D) : null);
    if (kind === "flat") {
      const r = rowOf(WOOD_FLAT_INCH, n)!;
      return head("flat", fig(r, 3) * k, fig(r, 4) * k, { angle: 82, slot: slot === "regular" ? { width: fig(r, 5) * k, depth: fig(r, 6) * k } : null, recess: recess(WOOD_FLAT_CROSS_INCH, 1, 2) });
    }
    if (kind === "oval") {
      const r = rowOf(WOOD_OVAL_INCH, n)!;
      return head("oval", fig(r, 3) * k, fig(r, 4) * k, { angle: 82, crown: (fig(r, 5) - fig(r, 4)) * k, slot: slot === "regular" ? { width: fig(r, 6) * k, depth: fig(r, 7) * k } : null, recess: recess(WOOD_OVAL_CROSS_INCH, 1, 2) });
    }
    if (kind === "pan") {
      const r = rowOf(WOOD_PAN_INCH, n)!;
      // a recessed pan head is taller: by ASME B18.6.3's machine screw pan heads' H1 to H, the nearest size's
      const tall = slot === "regular" ? 1 : (([h, h1]) => h1 / h)(scaledRow(TAP_PAN_INCH, (p) => panDiameter(p), D, [2, 3]));
      const [m, depth] = scaledRow(TAP_PAN_INCH, (p) => panDiameter(p), D, [6, 7]);
      return head("pan", fig(r, 3) * k, fig(r, 4) * k * tall, {
        radius: fig(r, 5) * k,
        slot: slot === "regular" ? { width: fig(r, 6) * k, depth: fig(r, 7) * k } : null,
        recess: slot === "cross" ? { kind: "cross", width: m * INCH, depth: depth * INCH } : slot === "square" ? squareRecess(D) : null,
      });
    }
    const r = rowOf(WOOD_ROUND_INCH, n);
    if (!r) return `Round heads don't come in ${s.label} (only ${sizeRange(WOOD_ROUND_INCH, true)})`;
    return head("round", fig(r, 1) * k, fig(r, 2) * k, { slot: slot === "regular" ? { width: fig(r, 3) * k, depth: fig(r, 4) * k } : null, recess: slot === "cross" ? { kind: "cross", width: fig(r, 5) * k, depth: fig(r, 6) * k } : slot === "square" ? squareRecess(D) : null });
  }
  // DIN: slotted heads, cross recessed ones (a square recess in the slotted head)
  const missing = (rows: readonly Row[], what: string): string => `${what} don't come in ${s.label} (only ${sizeRange(rows, false)})`;
  if (kind === "pan") {
    // no DIN or ISO pan head wood screw: the inch pan head's proportions at the nearest diameter
    const inch = woodHead(WOOD_SIZES.inch.reduce((a, b) => (Math.abs(b.diameter - D) < Math.abs(a.diameter - D) ? b : a)), "pan", slot);
    if (typeof inch === "string") return inch;
    const near = WOOD_SIZES.inch.reduce((a, b) => (Math.abs(b.diameter - D) < Math.abs(a.diameter - D) ? b : a));
    const q = D / near.diameter;
    return {
      ...inch,
      width: inch.width * q,
      height: inch.height * q,
      radius: inch.radius * q,
      slot: inch.slot ? { width: inch.slot.width * q, depth: inch.slot.depth * q } : null,
      recess: inch.recess ? { ...inch.recess, width: inch.recess.width * q, depth: inch.recess.depth * q } : null,
    };
  }
  const slotted = kind === "flat" ? DIN_97 : kind === "oval" ? DIN_95 : DIN_96;
  const crossed = kind === "flat" ? DIN_7997 : kind === "oval" ? DIN_7995 : DIN_7996;
  const standard = kind === "flat" ? ["DIN 97", "DIN 7997"] : kind === "oval" ? ["DIN 95", "DIN 7995"] : ["DIN 96", "DIN 7996"];
  if (slot === "cross") {
    const r = rowOf(crossed, n);
    if (!r) return missing(crossed, `${standard[1]} cross recessed ${label.toLowerCase()} heads`);
    // DIN 7997's and 7995's smallest have no recess size: the next's, scaled
    const m = r[3] ?? scaledRow(crossed.filter((x) => x[3] !== null), (x) => Number(x[0]), D, [3])[0];
    const raise = kind === "oval" ? fig(rowOf(DIN_95, n), 3) : 0;
    return head(kind, fig(r, 1), fig(r, 2), { angle: 90, crown: raise, recess: metricCross(m) });
  }
  const r = rowOf(slotted, n);
  if (!r) return missing(slotted, `${standard[0]} slotted ${label.toLowerCase()} heads`);
  if (kind === "oval") return head("oval", fig(r, 1), fig(r, 2), { angle: 90, crown: fig(r, 3), slot: slot === "regular" ? { width: fig(r, 5), depth: fig(r, 4) } : null, recess: slot === "square" ? squareRecess(D) : null });
  return head(kind, fig(r, 1), fig(r, 2), { angle: 90, slot: slot === "regular" ? { width: fig(r, 4), depth: fig(r, 3) } : null, recess: slot === "square" ? squareRecess(D) : null });
}

/** a wood screw's thread length: ASME B18.6.1's two thirds of the length, or DIN's 0.6 */
export const woodThreadLength = (s: ScrewNominal, length: number): number => (s.inch ? (2 / 3) * length : 0.6 * length);

/** DIN 95, 96 and 97's lengths, mm */
const DIN_WOOD_LENGTHS = [8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80];

/** A wood screw's standard length: the inch steps (1/16 in to 1/4 in, 1/8 to 1 in, 1/4 to 4 in, 1/2 to 6 in, then inches; B18.6.1's own list isn't published freely), or the nearest of DIN's (then tens of mm). */
export function standardWoodLength(length: number, inch: boolean): number {
  if (inch) {
    const inches = length / INCH;
    const step = inches < 0.25 ? 1 / 16 : inches < 1 ? 1 / 8 : inches < 4 ? 1 / 4 : inches < 6 ? 1 / 2 : 1;
    return Math.max(1 / 8, Math.round(inches / step) * step) * INCH;
  }
  if (length > 85) return Math.round(length / 10) * 10;
  return DIN_WOOD_LENGTHS.reduce((a, b) => (Math.abs(b - length) < Math.abs(a - length) ? b : a));
}

// sheet metal (tapping) screws

export type TapHead = "flat" | "oval" | "truss" | "pan" | "hex" | "hexWasher";
export const TAP_HEADS: readonly { readonly value: TapHead; readonly label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "oval", label: "Oval" },
  { value: "truss", label: "Truss" },
  { value: "pan", label: "Pan" },
  { value: "hex", label: "Hex" },
  { value: "hexWasher", label: "Hex Washer" },
];
export type TapPoint = "a" | "ab" | "b";
export const TAP_POINTS: readonly { readonly value: TapPoint; readonly label: string }[] = [
  { value: "a", label: "A" },
  { value: "ab", label: "AB" },
  { value: "b", label: "B" },
];

const TAP_INCH_SIZES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "10", "12", "14", "1/4", "5/16", "3/8", "7/16", "1/2"];
const TAP_METRIC_SIZES = ["ST2.2", "ST2.9", "ST3.5", "ST3.9", "ST4.2", "ST4.8", "ST5.5", "ST6.3", "ST8", "ST9.5"];
const numbered = (id: string): boolean => !id.includes("/");
export const TAP_SIZES: { readonly inch: readonly ScrewNominal[]; readonly metric: readonly ScrewNominal[] } = {
  inch: TAP_INCH_SIZES.map((n) => ({ id: numbered(n) ? `#${n}` : n, label: numbered(n) ? `#${n}` : n, inch: true, diameter: fig(rowOf(TAP_A_INCH, n) ?? rowOf(TAP_AB_INCH, n), 1) * INCH })),
  metric: TAP_METRIC_SIZES.map((n) => ({ id: n, label: n, inch: false, diameter: Number(n.slice(2)) })),
};

/** an inch tapping screw size's basic diameter from its name, for tables that don't list it */
const panDiameter = (r: Row): number => {
  const n = r[0];
  return (TAP_SIZES.inch.find((s) => s.id === (numbered(n) ? `#${n}` : n))?.diameter ?? fig(rowOf(TAP_AB_INCH, n), 1) * INCH) / INCH;
};

/** A tapping screw's thread for its point type: crest and root diameters and pitch, and its point's taper and end, or why there isn't one. */
export function tapThread(s: ScrewNominal, point: TapPoint, threads: boolean): { diameter: number; wood: WoodThread } | string {
  const n = s.inch ? s.id.replace("#", "") : s.id;
  if (s.inch) {
    const rows = point === "a" ? TAP_A_INCH : point === "ab" ? TAP_AB_INCH : TAP_B_INCH;
    const r = rowOf(rows, n);
    if (!r) return `Type ${point.toUpperCase()} points don't come in ${s.label}`;
    const D = fig(r, 3) * INCH;
    const wood: WoodThread =
      point === "b"
        ? { root: fig(r, 4) * INCH, pitch: INCH / fig(r, 2), taper: fig(r, 6) * INCH, point: "blunt", end: fig(r, 5) * INCH, threads }
        : { root: fig(r, 4) * INCH, pitch: INCH / fig(r, 2), taper: gimletTaper(D), point: "gimlet", threads };
    return { diameter: D, wood };
  }
  // ISO 1478's pointed end (type C) for AB, its flat end (type F) for B
  const r = rowOf(ISO_1478, n)!;
  const blunt = point === "b";
  return { diameter: fig(r, 2), wood: { root: fig(r, 3), pitch: fig(r, 1), taper: fig(r, blunt ? 6 : 5), point: blunt ? "blunt" : "gimlet", end: blunt ? fig(r, 4) : undefined, threads } };
}

/** A tapping screw's head for its size, head type and slot, or why there isn't one. Hex heads take no recess (and ISO's no slot), so they're plain. */
export function tapHead(s: ScrewNominal, kind: TapHead, slot: SlotType): ScrewHead | string {
  const D = s.diameter;
  const n = s.inch ? s.id.replace("#", "") : s.id;
  const label = TAP_HEADS.find((h) => h.value === kind)!.label;
  const none = `${label} heads don't come in ${s.label}`;
  if (s.inch) {
    const k = INCH;
    const recess = (m: number, depth: number): ScrewHead["recess"] => (slot === "cross" ? { kind: "cross", width: m * k, depth: depth * k } : slot === "square" ? squareRecess(D) : null);
    const slotOf = (r: Row, j: number, t: number) => (slot === "regular" ? { width: fig(r, j) * k, depth: fig(r, t) * k } : null);
    if (kind === "flat") {
      const r = rowOf(TAP_FLAT_INCH, n);
      return r ? head("flat", fig(r, 1) * k, fig(r, 2) * k, { angle: 82, slot: slotOf(r, 3, 4), recess: recess(fig(r, 5), fig(r, 6)) }) : none;
    }
    if (kind === "oval") {
      const r = rowOf(TAP_OVAL_INCH, n);
      return r ? head("oval", fig(r, 1) * k, fig(r, 2) * k, { angle: 82, crown: (fig(r, 3) - fig(r, 2)) * k, slot: slotOf(r, 4, 5), recess: recess(fig(r, 6), fig(r, 7)) }) : none;
    }
    if (kind === "truss") {
      const r = rowOf(TAP_TRUSS_INCH, n);
      return r ? head("truss", fig(r, 1) * k, fig(r, 2) * k, { slot: slotOf(r, 3, 4), recess: recess(fig(r, 5), fig(r, 6)) }) : none;
    }
    if (kind === "pan") {
      const r = rowOf(TAP_PAN_INCH, n);
      return r ? head("pan", fig(r, 1) * k, fig(r, slot === "regular" ? 2 : 3) * k, { slot: slotOf(r, 4, 5), recess: recess(fig(r, 6), fig(r, 7)) }) : none;
    }
    const r = rowOf(TAP_HEX_INCH, n);
    if (!r) return none;
    return kind === "hex" ? head("hex", fig(r, 1) * k, fig(r, 2) * k, { slot: slotOf(r, 5, 6) }) : head("hexFlange", fig(r, 1) * k, fig(r, 2) * k, { flange: { diameter: fig(r, 3) * k, thickness: fig(r, 4) * k }, slot: slotOf(r, 5, 6) });
  }
  if (kind === "hex" || kind === "hexWasher") {
    const r = rowOf(kind === "hex" ? ISO_1479 : ISO_7053, n);
    if (!r) return none;
    return kind === "hex" ? head("hex", fig(r, 1), fig(r, 2)) : head("hexFlange", fig(r, 1), fig(r, 2), { flange: { diameter: fig(r, 3), thickness: fig(r, 4) } });
  }
  if (kind === "truss") {
    // no ISO truss head: the inch truss head's proportions at the nearest diameter
    const near = TAP_SIZES.inch.filter((x) => rowOf(TAP_TRUSS_INCH, x.id.replace("#", ""))).reduce((a, b) => (Math.abs(b.diameter - D) < Math.abs(a.diameter - D) ? b : a));
    const inch = tapHead(near, "truss", slot) as ScrewHead;
    const q = D / near.diameter;
    return { ...inch, width: inch.width * q, height: inch.height * q, slot: inch.slot ? { width: inch.slot.width * q, depth: inch.slot.depth * q } : null, recess: inch.recess ? { ...inch.recess, width: inch.recess.width * q, depth: inch.recess.depth * q } : null };
  }
  // ISO: slotted heads, cross recessed ones (a square recess in the slotted head)
  const slotted = kind === "flat" ? ISO_1482 : kind === "oval" ? ISO_1483 : ISO_1481;
  const crossed = kind === "flat" ? ISO_7050 : kind === "oval" ? ISO_7051 : ISO_7049;
  const r = rowOf(slot === "cross" ? crossed : slotted, n);
  if (!r) return none;
  const hk: HeadKind = kind === "pan" ? "pan" : kind;
  if (slot === "cross") return head(hk, fig(r, 1), fig(r, 2), { angle: 90, crown: kind === "oval" ? fig(r, 3) : 0, recess: metricCross(fig(r, kind === "oval" ? 4 : 3)) });
  const raise = kind === "oval" ? fig(r, 3) : 0;
  const [t, w] = kind === "oval" ? [fig(r, 4), fig(r, 5)] : [fig(r, 3), fig(r, 4)];
  return head(hk, fig(r, 1), fig(r, 2), { angle: 90, crown: raise, slot: slot === "regular" ? { width: w, depth: t } : null, recess: slot === "square" ? squareRecess(D) : null });
}

