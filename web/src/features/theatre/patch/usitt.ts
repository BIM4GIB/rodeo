// The patch as a lighting console reads it: USITT ASCII, the text most consoles import (an Ident block, a Clear
// Patch, one Patch line per channel and EndData), and the patch as a list for paperwork. Pure: the caller
// downloads the text. Each instrument contributes its channel and absolute DMX address, at full level. Only
// whole-number channels go in; an instrument without one, or not patched, comes back as skipped.

import type { Fixture } from "../fixture.ts";
import { absoluteOf, describeFixture, isPatched } from "./patch.ts";

/** A console line stays under 80 characters, so older consoles read it whole. */
const LINE_LIMIT = 79;
/** The level each address is patched at: full. */
const FULL = "@100";

/** An instrument left out of the console file, and why. */
export interface Skipped {
  readonly id: string;
  readonly label: string;
  readonly reason: string;
}

/** The console file's text (CRLF lines), how many instruments it patches, and those it leaves out. */
export interface ConsolePatch {
  readonly text: string;
  readonly patched: number;
  readonly skipped: readonly Skipped[];
}

/** A channel as a whole number, 1 or more, or null when the instrument has no channel the console can take. */
export function wholeChannel(channel: string): number | null {
  const t = channel.trim();
  if (!/^\d+(\.0+)?$/.test(t)) return null;
  const n = Math.floor(Number(t));
  return n >= 1 ? n : null;
}

/** The patch as USITT ASCII. Channels in order; each channel's addresses in order, several on one Patch line where they fit. */
export function usittPatch(list: readonly Fixture[]): ConsolePatch {
  const channels = new Map<number, Set<number>>();
  const skipped: Skipped[] = [];
  let patched = 0;
  for (const f of list) {
    const label = describeFixture(f);
    if (!isPatched(f)) {
      skipped.push({ id: f.id, label, reason: "not patched" });
      continue;
    }
    const channel = wholeChannel(f.channel);
    if (channel === null) {
      skipped.push({ id: f.id, label, reason: "no whole-number channel" });
      continue;
    }
    const addresses = channels.get(channel) ?? new Set<number>();
    addresses.add(absoluteOf(f.universe, f.address));
    channels.set(channel, addresses);
    patched++;
  }
  const lines = ["Ident 3:0", "Manufacturer Rodeo", "Console Rodeo", "Clear Patch"];
  for (const channel of [...channels.keys()].sort((a, b) => a - b)) {
    const head = `Patch 1 ${channel}`;
    let line = "";
    for (const address of [...(channels.get(channel) ?? [])].sort((a, b) => a - b)) {
      const token = `${address}${FULL}`;
      if (line === "") line = `${head} ${token}`;
      else if (line.length + 1 + token.length <= LINE_LIMIT) line += ` ${token}`;
      else {
        lines.push(line);
        line = `${head} ${token}`;
      }
    }
    lines.push(line);
  }
  lines.push("EndData");
  return { text: `${lines.join("\r\n")}\r\n`, patched, skipped };
}

/** The columns of the patch list, as patchRows fills them. */
export const PATCH_HEADINGS: readonly string[] = ["Channel", "Universe", "Address", "Absolute Address", "Footprint", "Type", "Position", "Unit", "Color", "Gobo", "Purpose"];

/** Every instrument as a row of PATCH_HEADINGS: patched ones first in address order, the rest after in list order. Blank where unpatched. */
export function patchRows(list: readonly Fixture[]): (string | number)[][] {
  const absolute = (f: Fixture): number => (isPatched(f) ? absoluteOf(f.universe, f.address) : Number.MAX_SAFE_INTEGER);
  return [...list]
    .sort((a, b) => absolute(a) - absolute(b))
    .map((f) => {
      const patched = isPatched(f);
      return [
        f.channel,
        patched ? f.universe : "",
        patched ? f.address : "",
        patched ? absolute(f) : "",
        f.footprint,
        f.label,
        f.position,
        f.unit,
        f.color,
        f.gobo,
        f.purpose,
      ];
    });
}
