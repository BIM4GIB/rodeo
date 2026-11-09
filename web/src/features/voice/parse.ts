// The words of a voice command as the bubble shows them and the agent is told them: each word, and
// what "this", "that", "these", "here", "there" and "it" point at (a pin, the selection, or what
// the words before pointed at). Every command goes to the agent, which reads the meaning; this only
// links the pointing words to the clicks. DOM-free, so parse.check.ts runs it in node.

import type { Word } from "./command.ts";

/** What the words are read against: the pins dropped while speaking, and how many objects are selected. */
export interface WordOptions {
  readonly pins: readonly { readonly n: number }[];
  readonly selected: number;
}

/** "This point", "that spot": a place, like "here". */
const PLACE_NOUNS = new Set(["point", "spot", "place", "position", "location"]);
const DEMOS = new Set(["this", "that", "these", "those"]);
const PLURAL = new Set(["these", "those"]);
const ANAPHORA = new Set(["it", "them", "they", "itself", "themselves"]);

/** The transcript's words as said, split on white space. */
export function splitWords(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== "");
}

/** A word as the pointing rules read it: lower case, without punctuation ("This," → "this"). */
function keyOf(word: string): string {
  return word
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, "");
}

/**
 * Each word with what it points at. Places ("here", "there", "this point") take the last pins, in
 * order, one each; a place with no pin left is missing. "This" and "that" take the next pin the
 * places left, "these" and "those" all the rest; with no pin they mean the selection, when there is
 * one. "It" and "them" mean what an earlier pointing word pointed at, else the selection.
 */
export function readWords(text: string, opts: WordOptions): Word[] {
  const said = splitWords(text);
  const keys = said.map(keyOf);
  const places: number[] = [];
  const demos: { at: number; plural: boolean }[] = [];
  const anaphora: number[] = [];
  for (let k = 0; k < keys.length; k++) {
    const t = keys[k];
    if (t === "here" || t === "there") {
      places.push(k);
    } else if (DEMOS.has(t) && PLACE_NOUNS.has(keys[k + 1] ?? "")) {
      places.push(k);
      // the noun goes with it
      k++;
    } else if (DEMOS.has(t)) {
      demos.push({ at: k, plural: PLURAL.has(t) });
    } else if (ANAPHORA.has(t)) {
      anaphora.push(k);
    }
  }
  const refs = new Map<number, Word["ref"]>();
  const P = opts.pins.length;
  const L = places.length;
  places.forEach((k, j) => {
    const pin = opts.pins[P - L + j];
    refs.set(k, pin ? { kind: "pin", n: pin.n } : { kind: "missing" });
  });
  // the pins the places didn't take, in click order, go to "this" and "these"
  let spare = opts.pins.slice(0, Math.max(0, P - L)).map((p) => p.n);
  for (const d of demos) {
    const taken = d.plural ? spare : spare.slice(0, 1);
    spare = d.plural ? [] : spare.slice(1);
    const first = taken[0];
    const ref: Word["ref"] =
      first !== undefined
        ? taken.length > 1
          ? { kind: "pin", n: first, all: taken }
          : { kind: "pin", n: first }
        : opts.selected > 0
          ? { kind: "selection" }
          : null;
    refs.set(d.at, ref);
  }
  for (const k of anaphora) {
    const before = [...refs.entries()].some(([at, r]) => at < k && r !== null && r.kind !== "missing");
    refs.set(k, before ? { kind: "previous" } : opts.selected > 0 ? { kind: "selection" } : null);
  }
  return said.map((word, k) => ({ text: word, ref: refs.get(k) ?? null }));
}

/** What the pointing words point at, one line each, for the agent: '"this" = pin 1'. */
export function pointingLines(words: readonly Word[]): string[] {
  const lines: string[] = [];
  for (const w of words) {
    const r = w.ref;
    if (!r) continue;
    const said = `"${keyOf(w.text) || w.text}"`;
    if (r.kind === "pin") {
      const ns = r.all ?? [r.n];
      lines.push(ns.length > 1 ? `${said} = pins ${ns.slice(0, -1).join(", ")} and ${ns[ns.length - 1]}` : `${said} = pin ${r.n}`);
    } else if (r.kind === "selection") {
      lines.push(`${said} = the selection`);
    } else if (r.kind === "previous") {
      lines.push(`${said} = what the words before it point at`);
    } else {
      lines.push(`${said} = no pin (none was clicked for it)`);
    }
  }
  return lines;
}
