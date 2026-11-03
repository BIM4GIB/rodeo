// Sun Study's arithmetic: the days of the seasons, the daylight of a day at a latitude, and the
// solar-time range the time slider covers. The sun's own place is heliodon.ts's sunPlace, and
// this uses the same declination, so the slider's sunrise and sunset match where the sun is drawn.

const RAD = Math.PI / 180;
/** Day of the year before the first of each month, in a year of 365 days. */
const MONTH_STARTS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/** Day of the year (1 to 365) of a month (1 to 12) and a day of that month. */
export function dayOf(month: number, day: number): number {
  return MONTH_STARTS[month - 1] + day;
}

/** "06-21" for a day of the year, for file names. */
export function monthDay(dayOfYear: number): string {
  let m = 0;
  while (m < 11 && MONTH_STARTS[m + 1] < dayOfYear) m++;
  return `${String(m + 1).padStart(2, "0")}-${String(dayOfYear - MONTH_STARTS[m]).padStart(2, "0")}`;
}

/** The seasons' days, for the buttons. */
export const SEASONS: readonly { readonly label: string; readonly day: number }[] = [
  { label: "March equinox", day: dayOf(3, 20) },
  { label: "June solstice", day: dayOf(6, 21) },
  { label: "September equinox", day: dayOf(9, 22) },
  { label: "December solstice", day: dayOf(12, 21) },
];

/** A day at a latitude: the sun rises and sets (in solar hours), or it stays up or down all day. */
export type Daylight = { readonly kind: "rise-set"; readonly rise: number; readonly set: number } | { readonly kind: "up" | "down" };

export function daylight(latitude: number, dayOfYear: number): Daylight {
  const lat = latitude * RAD;
  const decl = -23.44 * RAD * Math.cos(((2 * Math.PI) / 365) * (dayOfYear + 10));
  // the cosine of the hour angle at which the sun is on the horizon
  const c = -Math.tan(lat) * Math.tan(decl);
  if (c <= -1) return { kind: "up" };
  if (c >= 1) return { kind: "down" };
  const half = Math.acos(c) / RAD / 15;
  return { kind: "rise-set", rise: 12 - half, set: 12 + half };
}

/** The solar hours the time slider covers on a day: sunrise to sunset in quarter hours, or the whole day when the sun does not rise or set. */
export function hourRange(latitude: number, dayOfYear: number): readonly [number, number] {
  const d = daylight(latitude, dayOfYear);
  if (d.kind !== "rise-set") return [0, 24];
  const lo = Math.ceil(d.rise * 4) / 4;
  const hi = Math.floor(d.set * 4) / 4;
  return hi - lo >= 0.25 ? [lo, hi] : [0, 24];
}

export function clampHour(hour: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(hi, Math.max(lo, hour));
}

/** A bearing in degrees, from -180 (exclusive) to 180 (inclusive). */
export function bearing(deg: number): number {
  const n = ((((deg + 180) % 360) + 360) % 360) - 180;
  return n === -180 ? 180 : n;
}
