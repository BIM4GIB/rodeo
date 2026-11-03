// Checks for cues.ts, with each expected line worked out by hand in the comments.

import assert from "node:assert/strict";
import type { Look } from "../showTypes.ts";
import { chanLines, cueChannels, cueListAsc, percentOf } from "./cues.ts";

// 0.504 is 50.4 percent: 50. 0.6 is 60. Above 1 clamps to 100, below 0 to 0.
assert.equal(percentOf(0.504), 50);
assert.equal(percentOf(0.6), 60);
assert.equal(percentOf(1.3), 100);
assert.equal(percentOf(-0.2), 0);
assert.equal(percentOf(Number.NaN), 0);

// channel "1" at full: 100. "2" at 0: left out. "1A" is not a whole number: left out.
// "3" at 0.004 is 0.4 percent, which rounds to 0: left out. "10" at 0.333 is 33.3 percent: 33.
// The result is in channel order.
{
  const got = cueChannels({ "10": 0.333, "1": 1, "2": 0, "1A": 0.5, "3": 0.004 });
  assert.deepEqual(got, [
    { channel: 1, percent: 100 },
    { channel: 10, percent: 33 },
  ]);
}

// 10 channels at full make two Chan lines: the first holds channels 1 to 8, the second 9 and 10.
{
  const ten = Array.from({ length: 10 }, (_, i) => ({ channel: i + 1, percent: 100 }));
  assert.deepEqual(chanLines(ten), [
    "Chan 1@100 2@100 3@100 4@100 5@100 6@100 7@100 8@100",
    "Chan 9@100 10@100",
  ]);
}

// eight channels fill exactly one line; none makes no line at all
{
  const eight = Array.from({ length: 8 }, (_, i) => ({ channel: i + 1, percent: 50 }));
  assert.equal(chanLines(eight).length, 1);
  assert.equal(chanLines([]).length, 0);
}

// one look, channels 1 at 100 and 2 at 50, fade 3 seconds: the exact text, CRLF after every line
{
  const looks: Look[] = [{ id: "a", name: "House", levels: { 1: 1, 2: 0.5 }, fadeSeconds: 3 }];
  assert.equal(
    cueListAsc(looks),
    ["Ident 3:0", "Manufacturer Rodeo", "Console Rodeo", "Clear Cues", "Cue 1", "Text House", "Up 3", "Down 3", "Chan 1@100 2@50", "EndData", ""].join("\r\n"),
  );
}

// a second look with a 2.5 second fade and a blank name, which takes its number; its blackout cue has no Chan line
{
  const looks: Look[] = [
    { id: "a", name: "House", levels: { 1: 1 }, fadeSeconds: 0 },
    { id: "b", name: "", levels: {}, fadeSeconds: 2.5 },
  ];
  const text = cueListAsc(looks);
  assert.ok(text.includes("Cue 2\r\nText Look 2\r\nUp 2.5\r\nDown 2.5\r\nEndData\r\n"));
  assert.ok(text.startsWith("Ident 3:0\r\n"));
  // every line end is CRLF: no bare LF
  assert.ok(!/(^|[^\r])\n/.test(text));
}

console.log("cues.check.ts: all passed");
