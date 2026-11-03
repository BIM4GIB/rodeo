// Simulation: several editors change one drawing at once through a fake server
// that orders and rewrites changes as the real one does (server/src/collab.ts),
// with messages delayed at random (each direction stays in order, as over a
// socket). At the end every editor and the server must hold the same bytes.
//
//   cd web && npx tsx src/features/collab/check.ts [file.vwx] [editors] [steps] [seed]

import { readFileSync } from "node:fs";
import { openVwx, type EditSession } from "../../core/index.ts";
import { transformSplice } from "../../core/splice.ts";
import { Replica, type Incoming, type Outgoing } from "./replica.ts";

const file = process.argv[2] ?? new URL("../../../../samples/sample.vwx", import.meta.url).pathname;
const EDITORS = Number(process.argv[3] ?? 3);
const STEPS = Number(process.argv[4] ?? 400);
let seed = Number(process.argv[5] ?? 7);
const rand = (): number => {
  seed = (seed * 1103515245 + 12345) % 2 ** 31;
  return seed / 2 ** 31;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

const bytes = new Uint8Array(readFileSync(file));

type ToClient = { t: "ack"; id: number; seq: number } | { t: "reject"; id: number } | { t: "op"; seq: number; op: Incoming };

interface Logged extends Incoming {
  readonly seq: number;
}

const server = { session: openVwx(bytes), log: [] as Logged[], seq: 0, accepted: 0, refused: 0 };

interface Editor {
  readonly n: number;
  readonly session: EditSession;
  readonly replica: Replica;
  /** server → editor, in order */
  readonly inbox: ToClient[];
  /** editor → server, in order */
  readonly outbox: Outgoing[];
  undone: number;
}

const editors: Editor[] = [];
for (let n = 0; n < EDITORS; n++) {
  const session = openVwx(bytes);
  const outbox: Outgoing[] = [];
  const ed: Editor = {
    n,
    session,
    inbox: [],
    outbox,
    undone: 0,
    replica: new Replica(session, 0, {
      send: (op) => outbox.push(op),
      undone: () => ed.undone++,
      queued: () => ed.replica.flush(true),
    }),
  };
  editors.push(ed);
}

function serverReceive(from: Editor, op: Outgoing): void {
  let s: { start: number; del: number; add: number } | null = { start: op.start, del: op.del, add: op.add.length };
  for (const prior of server.log) {
    if (prior.seq <= op.base || !s) continue;
    s = transformSplice(s, { start: prior.start, del: prior.del, add: prior.add.length }, false);
  }
  if (!s) {
    server.refused++;
    from.inbox.push({ t: "reject", id: op.id });
    return;
  }
  const seq = ++server.seq;
  const incoming: Logged = { seq, start: s.start, del: s.del, add: [...op.add], kind: op.kind, ids: op.ids };
  server.log.push(incoming);
  server.accepted++;
  server.session.applyRemote({ start: s.start, del: s.del, add: [...op.add], kind: op.kind, ids: [...op.ids] });
  from.inbox.push({ t: "ack", id: op.id, seq });
  for (const ed of editors) if (ed !== from) ed.inbox.push({ t: "op", seq, op: incoming });
}

function deliver(ed: Editor): void {
  const msg = ed.inbox.shift();
  if (!msg) return;
  if (msg.t === "ack") {
    if (!ed.replica.ack(msg.id, msg.seq)) throw new Error(`editor ${ed.n}: a change turned back here was accepted there`);
  } else if (msg.t === "reject") ed.replica.refused(msg.id);
  else ed.replica.remote(msg.seq, msg.op);
  ed.replica.flush(true);
}

function edit(ed: Editor): void {
  const s = ed.session;
  const layer = s.doc.layers().find((l) => l.kind === "design")!;
  const objs = s.doc.objects(layer.id).filter((o) => o.shape && !o.parentId);
  const o = objs.length ? pick(objs) : null;
  const r = rand();
  try {
    if (r < 0.3 && o) s.moveObjects([o.id], Math.round(rand() * 200 - 100), Math.round(rand() * 200 - 100));
    else if (r < 0.5) s.addObject(layer.id, { kind: "rect", x0: rand() * 1e4, y0: rand() * 1e4, x1: 1e4 + rand() * 1e3, y1: 1e4 + rand() * 1e3 });
    else if (r < 0.6 && o) s.deleteObjects([o.id]);
    else if (r < 0.7 && o) s.duplicateObjects([o.id], 50, 50);
    else if (r < 0.8 && s.canUndo()) s.undo();
    else if (r < 0.85 && s.canRedo()) s.redo();
    else if (r < 0.88) s.createClass(`Sim ${ed.n}-${Math.floor(rand() * 1e6)}`);
    else if (r < 0.95 && objs.length > 1) s.groupObjects([objs[0].id, objs[1].id]);
    else if (o) s.setAttributes([o.id], { penColor: Math.floor(rand() * 200) } as never);
  } catch (err) {
    // some edits don't apply to some objects (a group's attributes...): that's the editor's business, not the sync's
    if (!(err instanceof Error)) throw err;
  }
}

const t0 = performance.now();
for (let i = 0; i < STEPS; i++) {
  const r = rand();
  const ed = pick(editors);
  if (r < 0.35) edit(ed);
  else if (r < 0.7) deliver(ed);
  else {
    const op = ed.outbox.shift();
    if (op) serverReceive(ed, op);
  }
}
// let everything arrive
for (let guard = 0; guard < 100_000; guard++) {
  let moved = false;
  for (const ed of editors) {
    const op = ed.outbox.shift();
    if (op) {
      serverReceive(ed, op);
      moved = true;
    }
    if (ed.inbox.length) {
      deliver(ed);
      moved = true;
    }
  }
  if (!moved) break;
}

const want = Buffer.from(server.session.doc.toBytes());
let ok = true;
for (const ed of editors) {
  const same = want.equals(Buffer.from(ed.session.doc.toBytes()));
  if (!same || !ed.replica.idle()) ok = false;
  console.log(`editor ${ed.n}: ${same ? "same as server" : "DIFFERS"}, idle ${ed.replica.idle()}, ${ed.undone} turned back`);
}
console.log(`server: ${server.accepted} accepted, ${server.refused} refused, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(ok ? "converged" : "NOT CONVERGED");
process.exitCode = ok ? 0 : 1;
