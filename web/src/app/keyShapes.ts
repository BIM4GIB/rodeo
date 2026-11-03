// Keys: a parallel key and a Woodruff key, each seen from the front (a parallel key's end, a
// Woodruff key's half-moon face), the top or the side, centred on the origin. Woodruff keys are
// DIN 6888's and ASME B17.2's full-radius keys: a segment of a circle cut by a flat across it below
// its centre. Pure geometry in mm.

import type { Pt } from "../core/index.ts";
import type { HoleDrawing } from "./machineShapes.ts";
import { empty } from "./gearShapes.ts";

export type KeyView = "front" | "top" | "side";

/** points along a Woodruff key's round edge */
const ARC_STEPS = 48;

export interface WoodruffSize {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly diameter: number;
  readonly height: number;
  /** the key's seat in the shaft, and in the hub (metric) or the key's height above the shaft (inch) */
  readonly shaft: number;
  readonly hub: number;
  readonly metric: boolean;
}

/** DIN 6888: width, height, diameter, and the keyseat's depth in the shaft (t1) and the hub (t2), mm. */
const DIN_6888: readonly (readonly [number, number, number, number, number])[] = [
  // 1 × 1.4, 2.5 × 3.7, 4 × 7.5 and 6 × 10's depths aren't in the tables found; they follow the others' t1 + t2 = h + 0.2
  [1, 1.4, 4, 1, 0.6],
  [1.5, 2.6, 7, 2, 0.8],
  [2, 2.6, 7, 1.8, 1],
  [2, 3.7, 10, 2.9, 1],
  [2.5, 3.7, 10, 2.7, 1.2],
  [3, 3.7, 10, 2.5, 1.4],
  [3, 5, 13, 3.8, 1.4],
  [3, 6.5, 16, 5.3, 1.4],
  [4, 5, 13, 3.5, 1.7],
  [4, 6.5, 16, 5, 1.7],
  [4, 7.5, 19, 6, 1.7],
  [5, 6.5, 16, 4.5, 2.2],
  [5, 7.5, 19, 5.5, 2.2],
  [5, 9, 22, 7, 2.2],
  [6, 7.5, 19, 5.1, 2.6],
  [6, 9, 22, 6.6, 2.6],
  [6, 10, 25, 7.6, 2.6],
  [6, 11, 28, 8.6, 2.6],
  [8, 9, 22, 6.2, 3],
  [8, 11, 28, 8.2, 3],
  [8, 13, 32, 10.2, 3],
  [10, 11, 28, 7.8, 3.4],
  [10, 13, 32, 9.8, 3.4],
  [10, 16, 45, 12.8, 3.4],
];

/** ASME B17.2 by the key's diameter in eighths of an inch: its height, the keyseat's depth in the shaft and the key's height above it, inches; and the key numbers of that diameter. */
const B17_2: readonly (readonly [number, number, number, number, readonly string[]])[] = [
  [2, 0.109, 0.0728, 0.0312, ["202"]],
  [2.5, 0.14, 0.0882, 0.0469, ["202.5", "302.5"]],
  [3, 0.172, 0.1038, 0.0625, ["203", "303", "403"]],
  [4, 0.203, 0.1668, 0.0312, ["204", "304", "404"]],
  [5, 0.25, 0.2031, 0.0469, ["305", "405", "505", "605"]],
  [6, 0.313, 0.2505, 0.0625, ["406", "506", "606", "806"]],
  [7, 0.375, 0.313, 0.0625, ["507", "607", "707", "807"]],
  [8, 0.438, 0.3755, 0.0625, ["608", "708", "808", "1008", "1208"]],
  [9, 0.484, 0.4063, 0.0781, ["609", "709", "809", "1009"]],
  [10, 0.547, 0.4688, 0.0781, ["610", "710", "810", "1010", "1210"]],
  [11, 0.594, 0.5, 0.0938, ["811", "1011", "1211"]],
  [12, 0.641, 0.5313, 0.1094, ["812", "1012", "1212"]],
];

/** An inch size as a fraction: "1/4", "1-3/8". */
export function inchText(inches: number): string {
  const whole = Math.floor(inches + 1e-9);
  let n = Math.round((inches - whole) * 64);
  let d = 64;
  while (n > 0 && n % 2 === 0) {
    n /= 2;
    d /= 2;
  }
  if (n === 0) return String(whole);
  return whole > 0 ? `${whole}-${n}/${d}` : `${n}/${d}`;
}

export const WOODRUFF_KEYS: readonly WoodruffSize[] = [
  ...DIN_6888.map(([b, h, d, t1, t2]) => ({
    id: `m${b}x${h}`,
    label: `${b} × ${h} × ${d} mm (DIN 6888)`,
    width: b,
    diameter: d,
    height: h,
    shaft: t1,
    hub: t2,
    metric: true,
  })),
  ...B17_2.flatMap(([eighths, c, shaft, above, numbers]) =>
    numbers.map((no) => {
      // the digits before the last two are the width in 32nds, the last two the diameter in 8ths
      const width = Number(no.slice(0, no.indexOf(".") < 0 ? no.length - 2 : no.length - 4)) / 32;
      return {
        id: `i${no}`,
        label: `${no}: ${inchText(width)} × ${inchText(eighths / 8)} in (ASME B17.2)`,
        width: width * 25.4,
        diameter: (eighths / 8) * 25.4,
        height: c * 25.4,
        shaft: shaft * 25.4,
        hub: above * 25.4,
        metric: false,
      };
    }),
  ),
];

/** A Woodruff key's length: the flat's chord. */
export function woodruffLength(k: { diameter: number; height: number }): number {
  const r = k.diameter / 2;
  return 2 * Math.sqrt(r * r - (r - k.height) ** 2);
}

function box(w: number, h: number): Pt[] {
  return [
    { x: -w / 2, y: -h / 2 },
    { x: w / 2, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 },
  ];
}

/**
 * A parallel key `width` by `height` and `length` long, its long edges chamfered by `chamfer`: from
 * the front its end (the chamfers cut across its corners), from the top or the side its length
 * with the chamfers' lines along it.
 */
export function parallelKey(width: number, height: number, length: number, chamfer: number, view: KeyView): HoleDrawing {
  const d = empty();
  if (view === "front") {
    if (chamfer <= 0) {
      d.outlines.push(box(width, height));
      return d;
    }
    const w = width / 2;
    const h = height / 2;
    const c = chamfer;
    d.outlines.push([
      { x: -w + c, y: -h },
      { x: w - c, y: -h },
      { x: w, y: -h + c },
      { x: w, y: h - c },
      { x: w - c, y: h },
      { x: -w + c, y: h },
      { x: -w, y: h - c },
      { x: -w, y: -h + c },
    ]);
    return d;
  }
  const across = view === "top" ? width : height;
  d.outlines.push(box(length, across));
  if (chamfer > 0) {
    for (const sign of [1, -1]) d.lines.push([{ x: -length / 2, y: sign * (across / 2 - chamfer) }, { x: length / 2, y: sign * (across / 2 - chamfer) }]);
  }
  return d;
}

/** Why a parallel key can't be drawn, or null when it can. */
export function parallelKeyProblem(width: number, height: number, chamfer: number): string | null {
  return 2 * chamfer < Math.min(width, height) ? null : "the key is too small for its chamfers";
}

/** A Woodruff key: from the front its half-moon face, the flat on top; from the top (its flat) or the side (its end) a rectangle. */
export function woodruffKey(k: WoodruffSize, view: KeyView): HoleDrawing {
  const d = empty();
  const length = woodruffLength(k);
  if (view === "top") d.outlines.push(box(length, k.width));
  else if (view === "side") d.outlines.push(box(k.width, k.height));
  else {
    const r = k.diameter / 2;
    const cy = -k.height / 2 + r;
    const a = Math.atan2(k.height / 2 - cy, length / 2);
    // round from the flat's right end down under the centre to its left end; the flat closes it
    const pts: Pt[] = [];
    for (let i = 0; i <= ARC_STEPS; i++) {
      const t = a - ((Math.PI + 2 * a) * i) / ARC_STEPS;
      pts.push({ x: r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
    d.outlines.push(pts);
  }
  return d;
}
