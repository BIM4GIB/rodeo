// npx tsx src/features/collab/large.check.ts — one large generated edit, plus failure controls.
import assert from "node:assert/strict";
import { blankDrawing } from "../../core/blank.ts";
import { openVwx, type SpliceOp } from "../../core/index.ts";
import { Replica } from "./replica.ts";
const bytes = blankDrawing("mm");
const source = openVwx(bytes), target = openVwx(bytes);
let op!: SpliceOp;
source.onStep(o => op = o);
source.addObjects(source.doc.layers()[0].id, Array.from({ length: 150000 }, (_, i) => ({ kind: "locus" as const, at: { x: i, y: i % 100 } })));
const replica = new Replica(target, 0, { send() {}, undone() {}, queued() {} });
replica.remote(1, op);
assert.equal(replica.applied, 1);
assert.equal(target.doc.objects(target.doc.layers()[0].id).length, 150000);
assert.deepEqual(target.doc.toBytes(), source.doc.toBytes());
// Replacing all of those records exercises removal as well as insertion.
source.undo(); replica.remote(2, op);
assert.equal(target.doc.objects(target.doc.layers()[0].id).length, 0);
source.redo(); replica.remote(3, op);
assert.deepEqual(target.doc.toBytes(), source.doc.toBytes());
replica.stop();

const s = openVwx(bytes); let sent = 0;
const r = new Replica(s, 0, { send() { sent++; }, undone() {}, queued() {} });
s.addObjects(s.doc.layers()[0].id, [{ kind: "line", a: { x: 0, y: 0 }, b: { x: 1, y: 1 } }]);
const before = s.doc.toBytes();
// Header application fails after records were spliced: the model must roll back both.
assert.throws(() => r.remote(1, { start: 0, del: 1, add: [], kind: "all", ids: [], header: { at: -1, bytes: new Uint8Array(1) } }), /header patch/);
assert.deepEqual(s.doc.toBytes(), before);
assert.equal(r.applied, 0);
assert.equal(r.idle(), false);
r.flush(true); assert.equal(sent, 0, "failed copy must not send a rebased pending edit");
assert.equal(r.ack(1, 5), false); assert.equal(r.applied, 0);
assert.throws(() => r.remote(2, { start: 0, del: 0, add: [], kind: "all", ids: [] }), /reopened/);
r.stop();
console.log("large collaboration checks passed");
