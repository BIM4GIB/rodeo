// Drop shadows. An object with drop-shadow settings has an aux child of type 101, always 112
// bytes: the common header, then
//   +0x50 u8   1 = the shadow is drawn (0 keeps the settings unused)
//   +0x54 f64  blur radius, paper inches
//   +0x5c f64  offset distance, paper inches
//   +0x64 f64  offset angle, degrees counter-clockwise from +x (315 puts it below right)
//   +0x6c u16  colour index
//   +0x6e u8   opacity, percent
// The defaults are 0.1, 0.05, 135 degrees, black at 75 %. Settings a shadow never shows (all
// zero, as plug-ins carry them) draw nothing.

import { f64, setF64, setU16, u16 } from "./bytes.ts";
import type { Rec } from "./records.ts";
import type { DropShadow } from "./types.ts";

/** The aux record (a child of the object) that holds its drop shadow. */
export const DROP_SHADOW = 101;
export const SHADOW_BYTES = 0x70;
/** The body of a new type-101 record: Vectorworks' defaults, not drawn. */
export const NEW_SHADOW: Uint8Array = Uint8Array.from(
  "0000000042469b3e9699b93fb49ec662409ba93f0000000000e0604001014b00".match(/../g)!,
  (b) => parseInt(b, 16),
);

/** The drop shadow an object casts, from its type-101 aux child; null when it casts none. */
export function readDropShadow(r: Rec): DropShadow | null {
  for (const c of r.children) {
    if (c.type === DROP_SHADOW) {
      const d = c.data;
      if (d.length < SHADOW_BYTES || d[0x50] !== 1) return null;
      const blur = f64(d, 0x54);
      const offset = f64(d, 0x5c);
      const angle = f64(d, 0x64);
      const opacity = d[0x6e];
      if (!(blur >= 0 && offset >= 0) || blur + offset <= 0 || !Number.isFinite(angle) || opacity === 0) return null;
      return { blur, offset, angle, color: u16(d, 0x6c), opacity: Math.min(100, opacity) };
    }
    // the last aux record; objects follow
    if (!c.hasNext) break;
  }
  return null;
}

/** Sets a type-101 record's shadow; null stops it casting one and keeps the settings. */
export function writeDropShadow(d: Uint8Array, s: DropShadow | null): void {
  if (!s) {
    d[0x50] = 0;
    return;
  }
  d[0x50] = 1;
  setF64(d, 0x54, Math.max(0, s.blur));
  setF64(d, 0x5c, Math.max(0, s.offset));
  setF64(d, 0x64, ((s.angle % 360) + 360) % 360);
  setU16(d, 0x6c, s.color);
  d[0x6e] = Math.round(Math.min(Math.max(s.opacity, 0), 100));
}

/** The shadow's displacement in world units, `k` world units to the paper inch. */
export function shadowOffset(s: DropShadow, k: number): { x: number; y: number } {
  const a = (s.angle * Math.PI) / 180;
  return { x: Math.cos(a) * s.offset * k, y: Math.sin(a) * s.offset * k };
}
