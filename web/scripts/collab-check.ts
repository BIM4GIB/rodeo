// Checks that two sessions editing one drawing at once end with the same bytes
// once their changes are combined through transformSplice (as the collaboration server does).
import { readFileSync } from "node:fs";
import { openVwx, type SpliceOp } from "../src/core/index.ts";
import { transformSplice } from "../src/core/splice.ts";

const file = process.argv[2] ?? new URL("../../samples/sample.vwx", import.meta.url).pathname;
const bytes = new Uint8Array(readFileSync(file));
const a = openVwx(bytes);
const b = openVwx(bytes);
const layer = a.doc.layers().find((l) => l.kind === "design")!;
const objs = a.doc.objects(layer.id).filter((o) => o.shape);

const ops: { who: string; op: SpliceOp }[] = [];
a.onStep((op) => ops.push({ who: "a", op }));
b.onStep((op) => ops.push({ who: "b", op }));
const take = (): SpliceOp => ops.shift()!.op;

function exchange(name: string, editA: () => void, editB: () => void): void {
  editA();
  const opA = take();
  editB();
  const opB = take();
  console.log(name, "A span", opA.start, opA.del, opA.add.length, "B span", opB.start, opB.del, opB.add.length);
  // the server orders A first: B is rewritten after A; A's editor rewrites B (B goes second, A wins ties)
  const bOnServer = transformSplice({ start: opB.start, del: opB.del, add: opB.add.length }, { start: opA.start, del: opA.del, add: opA.add.length }, false);
  if (!bOnServer) {
    console.log("  conflict: B refused; B's editor turns its change back");
    b.applyRemote({ ...opB, start: opB.start, del: opB.add.length, add: opB.removed! });
    b.applyRemote(opA);
  } else {
    a.applyRemote({ ...opB, start: bOnServer.start });
    // B's editor: A arrives while B is pending; A is rewritten past B with A first on ties
    const aOnB = transformSplice({ start: opA.start, del: opA.del, add: opA.add.length }, { start: opB.start, del: opB.del, add: opB.add.length }, true)!;
    b.applyRemote({ ...opA, start: aOnB.start });
  }
  const same = Buffer.from(a.doc.toBytes()).equals(Buffer.from(b.doc.toBytes()));
  console.log("  converged:", same);
  if (!same) process.exitCode = 1;
}

exchange("add+add same layer", () => a.addObject(layer.id, { kind: "rect", x0: 0, y0: 0, x1: 1000, y1: 500 } as never), () => b.addObject(layer.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 2000, y: 0 } } as never));
exchange("move+move different", () => a.moveObjects([objs[0].id], 100, 0), () => b.moveObjects([objs[5].id], 0, 100));
exchange("attrs+move", () => a.setAttributes([objs[2].id], { fillColor: 3 } as never), () => b.moveObjects([objs[8].id], 50, 50));
exchange("move same object", () => a.moveObjects([objs[3].id], 10, 0), () => b.moveObjects([objs[3].id], 0, 10));
exchange("group+add", () => a.groupObjects([objs[10].id, objs[11].id]), () => b.addObject(layer.id, { kind: "rect", x0: 5, y0: 5, x1: 50, y1: 50 } as never));
exchange("new class+new layer", () => a.createClass("Alpha"), () => b.createLayer("Beta"));
console.log("undo after remote:", a.canUndo());
a.undo();
const opUndo = take();
b.applyRemote(opUndo);
console.log("undo converged:", Buffer.from(a.doc.toBytes()).equals(Buffer.from(b.doc.toBytes())));
