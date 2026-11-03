// Checks the timelapse's replay against the editor: opens a drawing, records its changes with
// the same hooks the recorder uses (onStep) while making ten edits, then rebuilds the drawing from
// the opening bytes and the recorded history. The replayed bytes must equal the edited drawing's
// bytes after every edit it is checked at (the midpoint and the end), when seeking back, and when
// the history is applied with EditSession.applyRemote as collaboration does. It also checks that a
// saved drawing reopens to the bytes it was saved as, which continuing a history relies on.
//
// Run: cd web && npx tsx src/features/timelapse/check.ts ../samples/sample.vwx

import { readFileSync } from "node:fs";
import { openVwx, type EditSession, type NewShape, type Pt } from "../../core/index.ts";
import { historyOp, sha256Hex, type HistoryOp } from "./history.ts";
import { Replayer } from "./replay.ts";

const path = process.argv[2] ?? "../samples/sample.vwx";
let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && Buffer.compare(Buffer.from(a.buffer, a.byteOffset, a.length), Buffer.from(b.buffer, b.byteOffset, b.length)) === 0;
}

/** The first design layer with drawable objects, and up to n of its ids. */
function pick(s: EditSession, n: number): { layer: string; ids: string[] } {
  const layer = s.doc.layers().find((l) => l.kind === "design" && s.doc.objects(l.id).some((o) => o.shape && o.shape.kind !== "text"));
  if (!layer) throw new Error("no design layer with objects");
  const ids = s.doc.objects(layer.id).filter((o) => o.shape && o.shape.kind !== "text" && !o.id.includes("/")).map((o) => o.id);
  return { layer: layer.id, ids: ids.slice(0, n) };
}

const bytes = new Uint8Array(readFileSync(path));
const start = openVwx(bytes, "check.vwx").doc.toBytes();
expect("opening bytes re-serialise to themselves", same(openVwx(start, "check.vwx").doc.toBytes(), start));

// record the edits the way the recorder does
const session = openVwx(start, "check.vwx");
const ops: HistoryOp[] = [];
const unlisten = session.onStep((op) => ops.push(historyOp(op, Date.now())));
const { layer, ids } = pick(session, 8);
const at = (x: number, y: number): Pt => ({ x, y });
const rect = (x: number, y: number): NewShape => ({ kind: "rect", x0: x, y0: y, x1: x + 400, y1: y + 300 });
const line = (x: number, y: number): NewShape => ({ kind: "line", a: at(x, y), b: at(x + 900, y + 500) });

const edits: (() => void)[] = [
  () => session.addObject(layer, rect(-2000, -2000)),
  () => session.moveObjects([ids[0]], 100, 0),
  () => session.addObject(layer, line(-2000, 1000)),
  () => session.moveObjects([ids[1]], 0, -50),
  () => session.undo(),
  () => session.moveObjects([ids[2]], 20, 20),
  () => session.addObject(layer, rect(3000, -1000)),
  () => session.moveObjects([ids[3], ids[4]], 5, 5),
  () => session.undo(),
  () => session.addObject(layer, line(3000, 2000)),
];

// after each edit: the history length and the drawing's bytes
const snaps: { ops: number; bytes: Uint8Array }[] = [];
for (const edit of edits) {
  edit();
  snaps.push({ ops: ops.length, bytes: session.doc.toBytes() });
}
unlisten();
expect("ten edits recorded as ops", ops.length >= 8 && ops.length <= 10, `${ops.length} ops`);

// replay from the opening bytes
const replay = new Replayer(start, ops, "check.vwx");
const end = snaps.at(-1)!;
replay.seek(end.ops);
expect("replay at the end equals the edited drawing", same(replay.doc.toBytes(), end.bytes));

const mid = snaps[Math.floor(snaps.length / 2)];
replay.seek(mid.ops);
expect("replay at the midpoint equals the drawing then", same(replay.doc.toBytes(), mid.bytes), `after ${mid.ops} ops`);

replay.seek(end.ops);
expect("seeking forward again after seeking back", same(replay.doc.toBytes(), end.bytes));

replay.seek(0);
expect("replay at 0 equals the opening bytes", same(replay.doc.toBytes(), start));

// the collaboration path: applyRemote per op must give the same drawing
const remote = openVwx(start, "check.vwx");
for (const op of ops) remote.applyRemote({ start: op.start, del: op.del, add: [...op.add], kind: op.kind, ids: [...op.ids] });
expect("applyRemote of every op equals the replay", same(remote.doc.toBytes(), end.bytes));

// a saved drawing reopens to the bytes it was saved as, and its hash is stable
const saved = end.bytes;
const reopened = openVwx(saved, "check.vwx").doc.toBytes();
expect("saved bytes reopen to themselves", same(reopened, saved));
expect("saved hash matches the reopened drawing's", (await sha256Hex(saved)) === (await sha256Hex(reopened)));

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
