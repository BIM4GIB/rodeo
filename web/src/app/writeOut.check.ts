// npx tsx src/app/writeOut.check.ts — real serialization paused at compression.
import assert from "node:assert/strict";
import { blankDrawing } from "../core/blank.ts";
import { deflateChunks } from "../core/container.ts";
import { openVwx, type SpliceOp } from "../core/index.ts";
import { documentBlob, saveSnapshot } from "./writeOut.ts";
for (const change of ["none", "edit", "undo", "redo", "remote", "failure"] as const) {
  const s = openVwx(blankDrawing("mm"));
  const add = () => s.addObjects(s.doc.layers()[0].id, [{ kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 20 } }]);
  add(); if (change === "redo") s.undo();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => release = r), started = new Promise<void>(r => entered = r);
  const write = s.doc.write.bind(s.doc);
  s.doc.write = (sink, opts) => write(sink, { ...opts, deflate: async raw => {
    entered(); await gate; if (change === "failure") throw new Error("injected"); return deflateChunks(raw);
  } });
  let saved = 0;
  const pending = saveSnapshot(s, () => documentBlob(s), () => { saved++; s.markSaved(); });
  await started;
  if (change === "edit") add();
  if (change === "undo") s.undo();
  if (change === "redo") s.redo();
  if (change === "remote") {
    const other = openVwx(s.doc.toBytes()); let op!: SpliceOp;
    other.onStep(o => op = o);
    other.addObjects(other.doc.layers()[0].id, [{ kind: "line", a: { x: 2, y: 3 }, b: { x: 4, y: 5 } }]);
    s.applyRemote(op);
  }
  release();
  if (change === "failure") await assert.rejects(pending, /injected/);
  else {
    const blob = await pending;
    const stored = openVwx(new Uint8Array(await blob.arrayBuffer())).doc;
    assert.equal(stored.objects(stored.layers()[0].id).length, change === "redo" ? 0 : 1, "snapshot remains the original revision");
  }
  assert.equal(saved, change === "none" || change === "remote" ? 1 : 0);
  // A later save must still work, including after failure; temporary listeners are detached.
  s.doc.write = write;
  await saveSnapshot(s, () => documentBlob(s), () => s.markSaved());
  assert.equal(s.dirty, false);
}
console.log("save snapshot checks passed");
