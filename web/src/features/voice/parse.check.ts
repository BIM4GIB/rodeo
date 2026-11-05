// Checks the pointing words (parse.ts) in node, with no browser: what each "this", "here" and "it" points at.
//
//   cd web && npx tsx src/features/voice/parse.check.ts

import type { Word } from "./command.ts";
import { pointingLines, readWords, splitWords } from "./parse.ts";

/** One case: the words said, how many pins are dropped, how many objects are selected, and the words as show writes them. */
type Row = readonly [text: string, pins: number, selected: number, expected: string];

/** The pins of a case: n pins, numbered from 1 in click order. */
function pinsOf(n: number): { n: number }[] {
  return Array.from({ length: n }, (_, i) => ({ n: i + 1 }));
}

/** The words as one line: each word, then in brackets what it points at ([1] a pin, [1,2] pins, [sel], [prev], [?] no pin). */
function show(words: readonly Word[]): string {
  return words
    .map((w) => {
      const r = w.ref;
      if (!r) return w.text;
      if (r.kind === "pin") return `${w.text}[${(r.all ?? [r.n]).join(",")}]`;
      if (r.kind === "selection") return `${w.text}[sel]`;
      if (r.kind === "previous") return `${w.text}[prev]`;
      return `${w.text}[?]`;
    })
    .join(" ");
}

const CASES: readonly Row[] = [
  ["rotate this 90", 0, 1, "rotate this[sel] 90"],
  ["rotate this 90", 0, 0, "rotate this 90"],
  ["move this door here", 2, 0, "move this[1] door here[2]"],
  ["move this here and rotate it 90", 2, 0, "move this[1] here[2] and rotate it[prev] 90"],
  ["copy these here and here", 4, 0, "copy these[1,2] here[3] and here[4]"],
  ["move it here", 0, 1, "move it[sel] here[?]"],
  ["make it red", 0, 0, "make it red"],
  ["put this at this point", 1, 2, "put this[sel] at this[1] point"],
  ["delete that", 1, 0, "delete that[1]"],
  ["Move THIS, here.", 2, 0, "Move THIS,[1] here.[2]"],
  ["", 0, 0, ""],
  ["what's on this layer", 1, 0, "what's on this[1] layer"],
  ["move these there", 3, 0, "move these[1,2] there[3]"],
  ["move these there", 1, 2, "move these[sel] there[1]"],
  ["copy this here here and here", 2, 0, "copy this here[?] here[1] and here[2]"],
  ["rotate them 45", 0, 3, "rotate them[sel] 45"],
];

let failures = 0;

/** Prints one line for a check and counts it when it fails. */
function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

/** Compares two values as JSON and prints the check, with both sides when they differ. */
function same(label: string, got: unknown, want: unknown): void {
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  expect(label, a === b, a === b ? a : `want ${b}, got ${a}`);
}

/** Runs every case, the pointing lines and the word split; returns the failure count. */
export function checkParse(): number {
  failures = 0;
  CASES.forEach(([text, pins, selected, expected], i) => {
    const got = show(readWords(text, { pins: pinsOf(pins), selected }));
    expect(`case ${i + 1} ${JSON.stringify(text)}`, got === expected, got === expected ? got : `want ${expected}, got ${got}`);
  });

  same(
    "lines: copy these here and here",
    pointingLines(readWords("copy these here and here", { pins: pinsOf(4), selected: 0 })),
    ['"these" = pins 1 and 2', '"here" = pin 3', '"here" = pin 4'],
  );
  same(
    "lines: move it here, nothing pinned",
    pointingLines(readWords("move it here", { pins: pinsOf(0), selected: 1 })),
    ['"it" = the selection', '"here" = no pin (none was clicked for it)'],
  );
  const linked = pointingLines(readWords("move this here and rotate it 90", { pins: pinsOf(2), selected: 0 }));
  same("lines: it points at the words before", linked[2], '"it" = what the words before it point at');

  same("split: white space and line breaks", splitWords("  move   this\nhere "), ["move", "this", "here"]);

  return failures;
}

if (process.argv[1]?.endsWith("parse.check.ts")) {
  const count = checkParse();
  console.log(count === 0 ? "\nall checks passed" : `\n${count} check(s) failed`);
  process.exit(count > 0 ? 1 : 0);
}
