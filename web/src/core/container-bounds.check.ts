// npx tsx src/core/container-bounds.check.ts — generated data only.
import assert from "node:assert/strict";
import { blankDrawing } from "./blank.ts";
import { setU32be, u32be } from "./bytes.ts";
import { bytesSource, readContainer, readContainerStream } from "./container.ts";

const good = blankDrawing("mm");
for (const [field, value] of [[0, good.length], [8, good.length + 1], [8, 0], [0, 0xffffffff]]) {
  const bad = good.slice();
  setU32be(bad, field, value);
  assert.throws(() => readContainer(bad), /settings block/);
  await assert.rejects(readContainerStream(bytesSource(bad)), /settings block/);
}
// The extent may end exactly at EOF; a header-only container has no records.
const empty = good.slice(0, u32be(good, 8) + u32be(good, 0));
setU32be(empty, 0x54, empty.length);
assert.equal(readContainer(empty).raw.length, 0);
assert.equal((await readContainerStream(bytesSource(empty))).records.length, 0);
await assert.rejects(readContainerStream({ size: good.length, read: async () => good.subarray(0, 80) }), /too small/);
await assert.rejects(readContainerStream({ size: good.length, read: async () => good.subarray(0, 0x94) }), /truncated settings/);
assert.ok(readContainer(good).raw.length > 0);
assert.ok((await readContainerStream(bytesSource(good))).records.length > 0);
console.log("container bounds checks passed");

assert.throws(() => readContainer(new Uint8Array(0x94)), /missing VectorWorks signature/);
