// The sums behind Spotlight Numbering (numbering.ts): the values a field's numbering gives one object after
// another (numbers or letters, a prefix and suffix, counted on by a step or kept the same, several objects
// a value, restarting or stopping at a limit, a DMX address counted on by each device's footprint into
// the next universe), and the order objects picked are numbered in (along rows or columns lined up within
// a tolerance, the rows in turn, zigzag or not). Kept apart so it runs without the page.

import type { Pt } from "../../../core/index.ts";

export const DIRECTIONS = ["Left to Right", "Right to Left", "Top to Bottom", "Bottom to Top"] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const LIMITS = ["No Limit", "Restart at", "Stop at"] as const;
export type Limit = (typeof LIMITS)[number];

/** How one field is numbered. */
export interface FieldNumbering {
  /** the first value: a number (its leading zeros kept) or letters */
  readonly start: string;
  readonly prefix: string;
  readonly suffix: string;
  /** every object the same value */
  readonly same: boolean;
  readonly step: number;
  readonly limit: Limit;
  /** the value restarted after or stopped at */
  readonly limitAt: number;
  /** how many objects take each value before it counts on */
  readonly perValue: number;
  /** a DMX address counted on by each device's footprint, into the next universe when 512 is passed */
  readonly footprint?: boolean;
}

/** the channels in a DMX universe */
export const UNIVERSE = 512;

/** Letters as a count: A is 1, Z 26, AA 27. */
export function lettersValue(text: string): number {
  let n = 0;
  for (const c of text.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n;
}

/** A count as letters, upper or lower case: 1 is A, 27 AA. */
export function valueLetters(n: number, lower = false): string {
  let out = "";
  for (let k = Math.max(1, Math.floor(n)); k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
  return lower ? out.toLowerCase() : out;
}

/** What a start is: a number (with how many digits it's written with) or letters; null for neither. */
export function startOf(text: string): { kind: "number"; value: number; digits: number } | { kind: "letters"; value: number; lower: boolean } | null {
  const t = text.trim();
  // leading zeros give the width every value is written to
  if (/^-?\d+$/.test(t)) return { kind: "number", value: Number(t), digits: /^-?0\d/.test(t) ? t.replace("-", "").length : 1 };
  if (/^[A-Za-z]+$/.test(t)) return { kind: "letters", value: lettersValue(t), lower: t === t.toLowerCase() };
  return null;
}

/** Why a field's numbering can't run, or null. */
export function numberingProblem(o: FieldNumbering): string | null {
  const s = startOf(o.start);
  if (!s) return "Start is a whole number or letters (1, 001, A).";
  if (!o.same && !(Number.isInteger(o.step) && o.step !== 0)) return "Increment by is a whole number other than 0.";
  if (!(Number.isInteger(o.perValue) && o.perValue >= 1)) return "Number of Units per Increment is a whole number, 1 or more.";
  if (o.limit !== "No Limit" && !Number.isInteger(o.limitAt)) return `${o.limit} is a whole number.`;
  if (o.limit !== "No Limit" && !o.same && (o.step > 0 ? o.limitAt < s.value : o.limitAt > s.value)) return `${o.limit} ${o.limitAt} comes before the start.`;
  return null;
}

/**
 * The values `count` objects take, in order, and how many were numbered before a Stop at limit was
 * passed (null when none stopped it). With `footprints` (each object's DMX footprint) and the field's
 * footprint option, a value counts on by the object's footprint, and `universes` gives the universe each
 * goes in, from `universe` on, counting on when an address would run past 512.
 */
export function sequence(o: FieldNumbering, count: number, footprints: readonly number[] = [], universe = 1): { values: string[]; universes: number[]; stopped: number | null } {
  const s = startOf(o.start);
  if (!s) return { values: [], universes: [], stopped: 0 };
  const write = (n: number): string => {
    const body = s.kind === "number" ? (n < 0 ? "-" : "") + String(Math.abs(n)).padStart(s.digits, "0") : valueLetters(n, s.lower);
    return o.prefix + body + o.suffix;
  };
  const values: string[] = [];
  const universes: number[] = [];
  let n = s.value;
  let u = universe;
  let left = o.perValue;
  for (let k = 0; k < count; k++) {
    const dmx = !!o.footprint && !o.same;
    const size = Math.max(1, Math.round(footprints[k] ?? 1));
    // a device that won't fit in what's left of the universe starts the next, at its first address
    if (dmx && n + size - 1 > UNIVERSE) {
      n = 1;
      u++;
    }
    if (o.limit === "Stop at" && !o.same && (o.step > 0 ? n > o.limitAt : n < o.limitAt)) return { values, universes, stopped: k };
    values.push(write(n));
    universes.push(u);
    if (o.same) continue;
    if (--left > 0) continue;
    left = o.perValue;
    n += dmx ? size : o.step;
    if (o.limit === "Restart at" && (o.step > 0 ? n > o.limitAt : n < o.limitAt)) n = s.value;
  }
  return { values, universes, stopped: null };
}

const horizontal = (d: Direction): boolean => d === "Left to Right" || d === "Right to Left";

/** The secondary directions that go with a primary one: across it. */
export const secondaries = (primary: Direction): Direction[] => DIRECTIONS.filter((d) => horizontal(d) !== horizontal(primary));

/**
 * The order objects at `at` are numbered in: along `primary`, objects within `tolerance` of each other
 * across it taken as lined up in a row (or column), the rows in turn along `secondary`, every other row
 * run back the other way with `zigzag`. Their indexes.
 */
export function numberingOrder(at: readonly Pt[], primary: Direction, secondary: Direction, zigzag: boolean, tolerance: number): number[] {
  const along = (p: Pt, d: Direction): number => (d === "Left to Right" ? p.x : d === "Right to Left" ? -p.x : d === "Bottom to Top" ? p.y : -p.y);
  const second = horizontal(secondary) !== horizontal(primary) ? secondary : secondaries(primary)[0];
  const order = at.map((_, k) => k).sort((a, b) => along(at[a], second) - along(at[b], second) || along(at[a], primary) - along(at[b], primary));
  const rows: number[][] = [];
  for (const k of order) {
    const row = rows[rows.length - 1];
    // lined up with the row's first, within the tolerance
    if (row && along(at[k], second) - along(at[row[0]], second) <= tolerance) row.push(k);
    else rows.push([k]);
  }
  return rows.flatMap((row, r) => {
    const sorted = row.sort((a, b) => along(at[a], primary) - along(at[b], primary));
    return zigzag && r % 2 === 1 ? sorted.reverse() : sorted;
  });
}
