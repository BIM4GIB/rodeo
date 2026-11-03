// What scenic paint looks like lit through each gel, as RGB estimates for the Gel and Paint Matrix. Lit, a
// paint takes each channel of the light's colour (gels.ts), so its brightness drops (the loss) and its hue
// turns (the hue shift). A paint that loses most of its brightness goes muddy or black ("dead"); one whose hue
// turns far goes another colour ("shifted"). These are not spectral figures: test swatches under the real light.

import { colorOf, multiply, type Rgb } from "../gels.ts";

/** A loss above this share of the paint's brightness flags it dead. */
export const DEAD_LOSS = 0.75;
/** A hue turn above this many degrees flags a paint shifted. */
export const SHIFTED_DEGREES = 60;

export interface Paint {
  readonly name: string;
  /** the paint's colour, each channel 0 to 1 */
  readonly rgb: Rgb;
}

export type Flag = "dead" | "shifted" | "";

export interface Cell {
  /** the paint as the light leaves it */
  readonly lit: Rgb;
  /** 0 to 1: the share of the paint's brightness the light takes */
  readonly loss: number;
  /** degrees the hue turns, the short way round; 0 when either is grey */
  readonly hueShift: number;
  /** "dead" wins over "shifted" when both hold */
  readonly flag: Flag;
}

/** A rough brightness of a colour, 0 to 1 (Rec. 709 weights on the channels as given). */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** A colour's hue in degrees, 0 to 360, or null for a grey. */
export function hueOf(c: Rgb): number | null {
  const max = Math.max(c.r, c.g, c.b);
  const span = max - Math.min(c.r, c.g, c.b);
  if (span < 1e-6) return null;
  const sector = max === c.r ? (c.g - c.b) / span : max === c.g ? (c.b - c.r) / span + 2 : (c.r - c.g) / span + 4;
  return (((sector * 60) % 360) + 360) % 360;
}

/** The degrees between two colours' hues, the short way round; 0 when either is grey. */
export function hueDifference(a: Rgb, b: Rgb): number {
  const ha = hueOf(a);
  const hb = hueOf(b);
  if (ha === null || hb === null) return 0;
  const d = Math.abs(ha - hb) % 360;
  return Math.min(d, 360 - d);
}

/** The cell for `paint` under the light `gel` (a Color field's text, as colorOf reads it). */
export function cellOf(paint: Paint, gel: string): Cell {
  const lit = multiply(paint.rgb, colorOf(gel));
  const before = luminance(paint.rgb);
  const loss = before > 0 ? Math.min(1, Math.max(0, 1 - luminance(lit) / before)) : 0;
  const hueShift = hueDifference(paint.rgb, lit);
  const flag: Flag = loss > DEAD_LOSS ? "dead" : hueShift > SHIFTED_DEGREES ? "shifted" : "";
  return { lit, loss, hueShift, flag };
}

/** The matrix: a row of cells for each paint, a cell for each gel, in the order given. */
export function matrix(paints: readonly Paint[], gels: readonly string[]): Cell[][] {
  return paints.map((paint) => gels.map((gel) => cellOf(paint, gel)));
}
