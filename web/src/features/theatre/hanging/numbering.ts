// The sums behind a hanging position: the order its devices are numbered in, the numbers, which position a
// point is over and what hangs on it weighs. Kept apart from the page so a check can run it.

import type { BBox, Pt } from "../../../core/index.ts";

export const NUMBER_DIRECTIONS = ["Left to Right", "Right to Left", "Bottom to Top", "Top to Bottom"] as const;
export type NumberDirection = (typeof NUMBER_DIRECTIONS)[number];

/** two points this near along the way they're numbered count as level, mm */
const LEVEL_MM = 1;

/**
 * `items` in numbering order, going the way the page shows them: `turn` is the plan's rotation on the page,
 * radians. Those level with each other go left to right, or bottom to top.
 */
export function numberOrder<T extends { readonly at: Pt }>(items: readonly T[], direction: NumberDirection, turn = 0): T[] {
  const [c, s] = [Math.cos(turn), Math.sin(turn)];
  const across = direction === "Left to Right" || direction === "Right to Left";
  const sign = direction === "Right to Left" || direction === "Top to Bottom" ? -1 : 1;
  const keyed = items.map((item) => {
    const page = { x: item.at.x * c - item.at.y * s, y: item.at.x * s + item.at.y * c };
    return { item, along: across ? page.x : page.y, beside: across ? page.y : page.x };
  });
  keyed.sort((a, b) => (Math.abs(a.along - b.along) > LEVEL_MM ? sign * (a.along - b.along) : a.beside - b.beside));
  return keyed.map((k) => k.item);
}

/** `count` unit numbers from `start`, `step` apart, without a binary fraction's tail. */
export function unitNumbers(start: number, step: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(Number((start + i * step).toFixed(6))));
}

/** Whether `p` is in `box` or within `pad` of it. */
export function within(p: Pt, box: BBox, pad: number): boolean {
  return p.x >= box.x0 - pad && p.x <= box.x1 + pad && p.y >= box.y0 - pad && p.y <= box.y1 + pad;
}

/** The position `p` is over: where boxes overlap, the smallest, as the one most nearly under it. */
export function positionUnder<T extends { readonly box: BBox }>(positions: readonly T[], p: Pt, pad: number): T | null {
  const area = (b: BBox): number => (b.x1 - b.x0 + 2 * pad) * (b.y1 - b.y0 + 2 * pad);
  return positions.filter((q) => within(p, q.box, pad)).sort((a, b) => area(a.box) - area(b.box))[0] ?? null;
}

/** What the devices weigh together, as Object Info shows it. */
export function hungWeight(devices: readonly { readonly weightKg: number }[]): string {
  const kg = devices.reduce((sum, d) => sum + (Number.isFinite(d.weightKg) ? d.weightKg : 0), 0);
  return `${Number(kg.toFixed(1))} kg`;
}

/** `name`, with a number on the end if it's taken. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}
