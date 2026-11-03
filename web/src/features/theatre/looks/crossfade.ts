// How one look fades into another. Each channel's level moves in a straight line from its level in the
// first look to its level in the second, over t from 0 to 1, and easeInOut shapes t so a fade starts and
// ends softly. A channel a look leaves out is off, as levels.ts has it. Pure: the Looks palette calls this
// each frame while a fade plays.

/** Channel levels, 0 to 1, by channel name; a channel left out is off. */
export type Levels = Readonly<Record<string, number>>;

/** The levels at `t` between `a` (t = 0) and `b` (t = 1), for every channel either look names. */
export function levelsBetween(a: Levels, b: Levels, t: number): Record<string, number> {
  const k = clamp01(t);
  const out: Record<string, number> = {};
  for (const channel of new Set([...Object.keys(a), ...Object.keys(b)])) {
    out[channel] = (1 - k) * (a[channel] ?? 0) + k * (b[channel] ?? 0);
  }
  return out;
}

/** `t` from 0 to 1 eased (cubic, slow at both ends): 0 at 0, 0.5 at 0.5, 1 at 1. */
export function easeInOut(t: number): number {
  const k = clamp01(t);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
