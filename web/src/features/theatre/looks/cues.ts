// The Looks as a USITT ASCII cue list (.asc), the plain-text format lighting consoles and visualisers read:
// one cue per look, with its fade times and the channels it lights, each at a whole-number percent. Only
// whole-number channels go in (a channel named "1A" has no place in the format), and a level that rounds to
// 0% is left out. Pure: the Looks palette saves the text as a file.

import type { Look } from "../showTypes.ts";

/** How many channels one Chan line holds. */
export const CHANNELS_PER_LINE = 8;

/** A channel and its percent, 0 to 100. */
export interface CueChannel {
  readonly channel: number;
  readonly percent: number;
}

/** A level's percent, a whole number 0 to 100. */
export function percentOf(level: number): number {
  return Number.isFinite(level) ? Math.min(100, Math.max(0, Math.round(level * 100))) : 0;
}

/** The channels a look lights: whole-number channels above 0 at a percent above 0, in channel order. */
export function cueChannels(levels: Readonly<Record<string, number>>): CueChannel[] {
  const byNumber = new Map<number, number>();
  for (const [name, level] of Object.entries(levels)) {
    const text = name.trim();
    const channel = /^\d+$/.test(text) ? Number(text) : 0;
    const percent = percentOf(level);
    if (channel > 0 && percent > 0) byNumber.set(channel, percent);
  }
  return [...byNumber].map(([channel, percent]) => ({ channel, percent })).sort((a, b) => a.channel - b.channel);
}

/** The Chan lines for a look's channels, up to CHANNELS_PER_LINE to a line. */
export function chanLines(channels: readonly CueChannel[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < channels.length; i += CHANNELS_PER_LINE) {
    const pairs = channels.slice(i, i + CHANNELS_PER_LINE).map((c) => `${c.channel}@${c.percent}`);
    out.push(`Chan ${pairs.join(" ")}`);
  }
  return out;
}

/** The whole cue list for `looks` in order, as USITT ASCII text with CRLF line ends. */
export function cueListAsc(looks: readonly Look[]): string {
  const lines = ["Ident 3:0", "Manufacturer Rodeo", "Console Rodeo", "Clear Cues"];
  looks.forEach((look, i) => {
    const fade = seconds(look.fadeSeconds);
    lines.push(`Cue ${i + 1}`, `Text ${nameText(look.name, i)}`, `Up ${fade}`, `Down ${fade}`, ...chanLines(cueChannels(look.levels)));
  });
  lines.push("EndData");
  return lines.map((line) => `${line}\r\n`).join("");
}

/** A fade time in seconds, to two places, without trailing zeros. */
function seconds(v: number): string {
  return String(Number.isFinite(v) && v > 0 ? Number(v.toFixed(2)) : 0);
}

/** A look's name on one line, or "Look n" when it has none. */
function nameText(name: string, index: number): string {
  const one = name.replace(/[\r\n]+/g, " ").trim();
  return one || `Look ${index + 1}`;
}
