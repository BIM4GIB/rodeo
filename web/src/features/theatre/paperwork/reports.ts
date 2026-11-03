// The lighting paperwork worked out from the plot's instruments (fixture.ts): the channel and dimmer
// hookups, colour cuts, gobo pull, shop order and the problems to fix before a plot goes out. Pure: each
// report takes the list and returns rows, so Node can check the sums. Frame and sheet sizes are the usual
// ones for gel, and watts and weights are the instruments' own figures, not a maker's data. Leaves out
// prices, hire, and the cutter's waste.

import { gelOf } from "../gels.ts";
import { naturalCompare, patchText, type Fixture } from "../fixture.ts";

/** A gel sheet in inches. */
const SHEET = { width: 20, height: 24 } as const;

/** The frame a gel is cut to, in inches, by the instrument's glyph; moving lights take no gel. */
const FRAME_IN: Readonly<Record<Fixture["glyph"], number | null>> = { ellipsoidal: 6.25, fresnel: 8, par: 10, wash: 12, moving: null };

/** Colour values that mean no gel. */
const NO_GEL: ReadonlySet<string> = new Set(["", "OPEN", "N/C", "NC", "NONE", "-"]);

/** A gel frame's size in inches for an instrument's glyph, or null for a moving light, which takes no gel. */
export function frameInches(glyph: Fixture["glyph"]): number | null {
  return FRAME_IN[glyph];
}

/** How many frames of `frameIn` inches one sheet cuts, in rows and columns of the sheet's 20 by 24 inches. */
export function cutsPerSheet(frameIn: number): number {
  return Math.floor(SHEET.width / frameIn) * Math.floor(SHEET.height / frameIn);
}

/** The filters a Color field names, one code each: a gel's catalogue code, or the upper-case text of anything else. */
function codesOf(color: string): string[] {
  return color
    .split("+")
    .map((part) => part.trim())
    .filter((part) => !NO_GEL.has(part.toUpperCase()))
    .map((part) => gelOf(part)?.code ?? part.toUpperCase());
}

/** A Color field as one key, its codes sorted so "L119+L201" and "L201+L119" match; "" for no filter. */
function colourKey(color: string): string {
  return codesOf(color).sort().join("+");
}

/** Two decimals, so weights add up without float dust. */
const round2 = (v: number): number => Math.round(v * 100) / 100;

/** The total of some figures, to two decimals. */
const totalOf = (values: readonly number[]): number => round2(values.reduce((a, b) => a + b, 0));

/** The instruments grouped by a key, in the order they came. */
function groupBy(list: readonly Fixture[], key: (f: Fixture) => string): Map<string, Fixture[]> {
  const out = new Map<string, Fixture[]>();
  for (const f of list) {
    const k = key(f);
    const group = out.get(k);
    if (group) group.push(f);
    else out.set(k, [f]);
  }
  return out;
}

/** Natural order, with the blank key (no channel, no dimmer, no type) last. */
function blankLast(a: string, b: string): number {
  if (a === b) return 0;
  if (a === "") return 1;
  if (b === "") return -1;
  return naturalCompare(a, b);
}

/** The distinct non-blank values in natural order, joined by commas. */
function listOf(values: readonly string[]): string {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort(naturalCompare).join(", ");
}

/** The Color fields a group holds, one each in natural order; "none" for an open or blank colour. */
function coloursText(group: readonly Fixture[]): string {
  return [...new Set(group.map((f) => colourKey(f.color)))]
    .sort(naturalCompare)
    .map((k) => k || "none")
    .join(", ");
}

/** "1st Electric #3, #4": each position's units in order, positions joined by semicolons. */
export function unitsText(list: readonly Fixture[]): string {
  const units = new Map<string, string[]>();
  for (const f of list) {
    const position = f.position.trim();
    const row = units.get(position) ?? [];
    if (f.unit.trim()) row.push(f.unit.trim());
    units.set(position, row);
  }
  return [...units.keys()]
    .sort(blankLast)
    .map((position) => [position, [...(units.get(position) ?? [])].sort(naturalCompare).map((u) => `#${u}`).join(", ")].filter(Boolean).join(" "))
    .filter(Boolean)
    .join("; ");
}

/** An instrument's name in a message: its unit ("1st Electric #3"), else its type and position. */
function nameOf(f: Fixture): string {
  if (f.unit.trim()) return [f.position.trim(), `#${f.unit.trim()}`].filter(Boolean).join(" ");
  return f.position.trim() ? `${f.label} on ${f.position.trim()}` : f.label;
}

/** The last DMX channel an instrument uses, at least its own. */
function lastChannel(f: Fixture): number {
  return f.address + Math.max(1, f.footprint) - 1;
}

export interface ChannelRow {
  readonly channel: string;
  readonly count: number;
  readonly units: string;
  readonly dimmers: string;
  readonly types: string;
  readonly colours: string;
  readonly purposes: string;
  readonly watts: number;
}

/** One row per channel, in natural order with the unchannelled last. */
export function channelHookup(list: readonly Fixture[]): ChannelRow[] {
  return [...groupBy(list, (f) => f.channel.trim())]
    .sort(([a], [b]) => blankLast(a, b))
    .map(([channel, group]) => ({
      channel,
      count: group.length,
      units: unitsText(group),
      dimmers: listOf(group.map((f) => f.dimmer)),
      types: listOf(group.map((f) => f.label)),
      colours: coloursText(group),
      purposes: listOf(group.map((f) => f.purpose)),
      watts: totalOf(group.map((f) => f.watts)),
    }));
}

export interface DimmerRow {
  readonly dimmer: string;
  readonly channels: string;
  readonly units: string;
  /** the load: the wattage of its instruments */
  readonly watts: number;
  /** the load is more than the limit */
  readonly over: boolean;
}

/** One row per dimmer, in natural order. Instruments with no dimmer aren't on a row. */
export function dimmerHookup(list: readonly Fixture[], limitWatts: number): DimmerRow[] {
  return [...groupBy(list.filter((f) => f.dimmer.trim()), (f) => f.dimmer.trim())]
    .sort(([a], [b]) => naturalCompare(a, b))
    .map(([dimmer, group]) => {
      const watts = totalOf(group.map((f) => f.watts));
      return { dimmer, channels: listOf(group.map((f) => f.channel)), units: unitsText(group), watts, over: watts > limitWatts };
    });
}

export interface ColorCutRow {
  readonly code: string;
  /** the gel's name from the catalogue, or "" when it isn't in it */
  readonly name: string;
  readonly frameIn: number;
  readonly cuts: number;
  readonly sheets: number;
}

/** One row per gel and frame size: each filter an instrument names is one cut, sheets rounded up. */
export function colorCuts(list: readonly Fixture[]): ColorCutRow[] {
  const tally = new Map<string, { code: string; frameIn: number; cuts: number }>();
  for (const f of list) {
    const frameIn = frameInches(f.glyph);
    if (frameIn === null) continue;
    for (const code of codesOf(f.color)) {
      if (code.startsWith("#")) continue;
      const key = `${code}|${frameIn}`;
      const row = tally.get(key) ?? { code, frameIn, cuts: 0 };
      row.cuts += 1;
      tally.set(key, row);
    }
  }
  return [...tally.values()]
    .map((r) => ({ code: r.code, name: gelOf(r.code)?.name ?? "", frameIn: r.frameIn, cuts: r.cuts, sheets: Math.ceil(r.cuts / cutsPerSheet(r.frameIn)) }))
    .sort((a, b) => naturalCompare(a.code, b.code) || a.frameIn - b.frameIn);
}

export interface GoboRow {
  readonly gobo: string;
  readonly count: number;
  readonly units: string;
  readonly types: string;
}

/** One row per gobo, its name as first typed; gobos are matched without regard to case. */
export function goboPull(list: readonly Fixture[]): GoboRow[] {
  return [...groupBy(list.filter((f) => f.gobo.trim()), (f) => f.gobo.trim().toUpperCase()).values()]
    .map((group) => ({ gobo: group[0].gobo.trim(), count: group.length, units: unitsText(group), types: listOf(group.map((f) => f.label)) }))
    .sort((a, b) => naturalCompare(a.gobo, b.gobo));
}

export interface ShopRow {
  readonly type: string;
  readonly count: number;
  /** the average when the instruments of a type differ */
  readonly wattsEach: number;
  readonly watts: number;
  readonly weightEach: number;
  readonly weightKg: number;
}

export interface ShopTotal {
  readonly count: number;
  readonly watts: number;
  readonly weightKg: number;
}

/** One row per instrument type, then the totals. */
export function shopOrder(list: readonly Fixture[]): { readonly rows: ShopRow[]; readonly total: ShopTotal } {
  const rows = [...groupBy(list, (f) => f.label)]
    .sort(([a], [b]) => blankLast(a, b))
    .map(([type, group]) => {
      const watts = totalOf(group.map((f) => f.watts));
      const weightKg = totalOf(group.map((f) => f.weightKg));
      return { type, count: group.length, wattsEach: round2(watts / group.length), watts, weightEach: round2(weightKg / group.length), weightKg };
    });
  return { rows, total: { count: list.length, watts: totalOf(list.map((f) => f.watts)), weightKg: totalOf(list.map((f) => f.weightKg)) } };
}

export interface Problem {
  readonly severity: "error" | "warning";
  readonly text: string;
  /** the instruments the problem is about */
  readonly ids: readonly string[];
}

/** What to fix before the plot goes out: the errors, then the warnings. */
export function problems(list: readonly Fixture[]): Problem[] {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];

  for (const group of groupBy(list.filter((f) => f.unit.trim()), (f) => `${f.position.trim().toUpperCase()}|${f.unit.trim().toUpperCase()}`).values()) {
    if (group.length < 2) continue;
    const at = group[0].position.trim() ? ` at ${group[0].position.trim()}` : "";
    errors.push({ severity: "error", text: `Unit #${group[0].unit.trim()}${at} is used by ${group.length} instruments`, ids: group.map((f) => f.id) });
  }
  for (const f of list) if (!f.unit.trim()) errors.push({ severity: "error", text: `${nameOf(f)} has no unit number`, ids: [f.id] });
  for (const f of list) if (!f.channel.trim()) errors.push({ severity: "error", text: `${nameOf(f)} has no channel`, ids: [f.id] });

  // in each DMX universe, an instrument that starts inside the range of one before it overlaps it
  const patched = list.filter((f) => f.universe > 0 && f.address > 0);
  for (const group of groupBy(patched, (f) => String(f.universe)).values()) {
    const ordered = [...group].sort((a, b) => a.address - b.address || naturalCompare(a.id, b.id));
    let reach: Fixture | null = null;
    for (const f of ordered) {
      if (reach && f.address <= lastChannel(reach)) {
        errors.push({ severity: "error", text: `DMX ${patchText(f)} (${nameOf(f)}) overlaps ${patchText(reach)} (${nameOf(reach)})`, ids: [reach.id, f.id] });
      }
      if (!reach || lastChannel(f) > lastChannel(reach)) reach = f;
    }
  }

  for (const [channel, group] of [...groupBy(list.filter((f) => f.channel.trim()), (f) => f.channel.trim())].sort(([a], [b]) => naturalCompare(a, b))) {
    const ids = group.map((f) => f.id);
    if (new Set(group.map((f) => colourKey(f.color))).size > 1) {
      warnings.push({ severity: "warning", text: `Channel ${channel} mixes colours: ${coloursText(group)}`, ids });
    }
    if (new Set(group.map((f) => f.label)).size > 1) {
      warnings.push({ severity: "warning", text: `Channel ${channel} mixes types: ${listOf(group.map((f) => f.label))}`, ids });
    }
  }
  return [...errors, ...warnings];
}
