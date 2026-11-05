// Simulation: several editors change one drawing at once through a fake server
// that orders and rewrites changes as the real one does (server/src/collab.ts),
// with messages delayed at random (each direction stays in order, as over a
// socket). At the end every editor and the server must hold the same bytes.
//
// Before the random run, set pieces: changes all made against the same drawing
// before any reaches the server, then delivered. An agent's step (a class added
// at the top of the file and objects drawn in it at the end) against moves
// anywhere must keep every change; two people adding classes, or two agents'
// steps, report how many changes were turned back.
//
//   cd web && npx tsx src/features/collab/check.ts [file.vwx] [editors] [steps] [seed]

import { readFileSync } from "node:fs";
import { openVwx, type EditSession } from "../../core/index.ts";
import { transformRuns, type Splice } from "../../core/splice.ts";
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
let failures = 0;

type ToClient = { t: "ack"; id: number; seq: number } | { t: "reject"; id: number } | { t: "op"; seq: number; op: Incoming };

interface Logged extends Incoming {
  readonly seq: number;
  readonly spans: readonly Splice[];
}

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

const spansOf = (op: Incoming | Outgoing): Splice[] => op.runs.map((r) => ({ start: r.start, del: r.del, add: r.add.length }));

/** A fake server and its editors, each with the drawing as it opened. */
class World {
  readonly server = { session: openVwx(bytes), log: [] as Logged[], seq: 0, accepted: 0, refused: 0 };
  readonly editors: Editor[] = [];

  constructor(count: number) {
    for (let n = 0; n < count; n++) {
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
      this.editors.push(ed);
    }
  }

  /** The server takes the editor's next change: rewritten past those since its base, or refused. */
  receive(from: Editor): boolean {
    const op = from.outbox.shift();
    if (!op) return false;
    const server = this.server;
    let s: Splice[] | null = spansOf(op);
    for (const prior of server.log) {
      if (prior.seq <= op.base || !s) continue;
      s = transformRuns(s, prior.spans, false);
      if (op.header && prior.header) s = null;
    }
    if (!s) {
      server.refused++;
      from.inbox.push({ t: "reject", id: op.id });
      return true;
    }
    const seq = ++server.seq;
    const runs = op.runs.map((r, i) => ({ start: s[i].start, del: r.del, add: r.add }));
    const incoming: Logged = { seq, spans: s, runs, kind: op.kind, ids: op.ids, header: op.header };
    server.log.push(incoming);
    server.accepted++;
    const [first, ...more] = runs;
    server.session.applyRemote({ ...first, ...(more.length ? { more } : {}), kind: op.kind, ids: [...op.ids], header: op.header });
    from.inbox.push({ t: "ack", id: op.id, seq });
    for (const ed of this.editors) if (ed !== from) ed.inbox.push({ t: "op", seq, op: incoming });
    return true;
  }

  /** The editor takes the next message from the server. */
  deliver(ed: Editor): boolean {
    const msg = ed.inbox.shift();
    if (!msg) return false;
    if (msg.t === "ack") {
      if (!ed.replica.ack(msg.id, msg.seq)) throw new Error(`editor ${ed.n}: a change turned back here was accepted there`);
    } else if (msg.t === "reject") ed.replica.refused(msg.id);
    else ed.replica.remote(msg.seq, msg.op);
    ed.replica.flush(true);
    return true;
  }

  /** Lets everything arrive: the server takes each editor's changes in turn, then each editor its messages. */
  settle(): void {
    for (let guard = 0; guard < 100_000; guard++) {
      let moved = false;
      for (const ed of this.editors) moved = this.receive(ed) || moved;
      for (const ed of this.editors) moved = this.deliver(ed) || moved;
      if (!moved) break;
    }
  }

  /** Whether every editor is idle and holds the server's bytes; logs each. */
  converged(label: string): boolean {
    const want = Buffer.from(this.server.session.doc.toBytes());
    let ok = true;
    for (const ed of this.editors) {
      const same = want.equals(Buffer.from(ed.session.doc.toBytes()));
      if (!same || !ed.replica.idle()) ok = false;
      if (!same || !ed.replica.idle()) console.log(`  ${label}: editor ${ed.n} ${same ? "same as server" : "DIFFERS"}, idle ${ed.replica.idle()}`);
    }
    return ok;
  }
}

/** The first design layer with drawn objects, and its top-level drawn objects. */
function objectsOf(s: EditSession): { layer: string; ids: string[] } {
  const layer = s.doc.layers().find((l) => l.kind === "design" && s.doc.objects(l.id).some((o) => o.shape && !o.parentId))!;
  return { layer: layer.id, ids: s.doc.objects(layer.id).filter((o) => o.shape && !o.parentId).map((o) => o.id) };
}

/** What an agent's script does in one step: a class, and objects drawn in it. */
function agentStep(s: EditSession, name: string, objects = 6): void {
  const { layer } = objectsOf(s);
  s.batch(() => {
    const c = s.createClass(name);
    for (let i = 0; i < objects; i++) s.addObject(layer, { kind: "rect", x0: i * 100, y0: 0, x1: i * 100 + 50, y1: 50 }, c);
  });
}

/**
 * A set piece: each editor makes its changes against the drawing as it opened, before any of them
 * reaches the server; then everything arrives. `undone` is how many changes each editor should
 * have turned back (null: just report it).
 */
function setPiece(label: string, edits: ((s: EditSession) => void)[], undone: (number | null)[]): void {
  const w = new World(edits.length);
  edits.forEach((edit, i) => edit(w.editors[i].session));
  w.settle();
  const got = w.editors.map((ed) => ed.undone);
  const ok = w.converged(label) && undone.every((u, i) => u === null || u === got[i]);
  console.log(`${ok ? "ok  " : "FAIL"} ${label}: ${w.server.accepted} accepted, ${w.server.refused} refused, turned back ${got.join("/")}`);
  if (!ok) failures++;
}

const picks = objectsOf(openVwx(bytes)).ids;
const first = picks[0];
const middle = picks[Math.floor(picks.length / 2)];
const last = picks[picks.length - 1];

setPiece(
  "agent step × moves (first, middle and last object)",
  [(s) => agentStep(s, "Agent A"), (s) => s.moveObjects([first], 10, 0), (s) => s.moveObjects([middle], 0, 10), (s) => s.moveObjects([last], -10, 0)],
  [0, 0, 0, 0],
);
setPiece(
  "moves × agent step (theirs first)",
  [(s) => s.moveObjects([middle, last], 5, 5), (s) => agentStep(s, "Agent B")],
  [0, 0],
);
setPiece(
  "agent step × deletes and moves",
  [(s) => s.deleteObjects([middle]), (s) => agentStep(s, "Agent C", 20), (s) => s.moveObjects([first], 3, 3)],
  [0, 0, 0],
);
setPiece("two people add classes", [(s) => s.createClass("Mine"), (s) => s.createClass("Yours")], [null, null]);
setPiece("two agents' steps", [(s) => agentStep(s, "Agent D"), (s) => agentStep(s, "Agent E")], [null, null]);
setPiece("an agent step × a class added", [(s) => agentStep(s, "Agent F"), (s) => s.createClass("Plain")], [null, null]);

// ---- the random run ----

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
    else if (r < 0.87) s.createClass(`Sim ${ed.n}-${Math.floor(rand() * 1e6)}`);
    else if (r < 0.89) agentStep(s, `Agent ${ed.n}-${Math.floor(rand() * 1e6)}`, 3);
    else if (r < 0.95 && objs.length > 1) s.groupObjects([objs[0].id, objs[1].id]);
    else if (o) s.setAttributes([o.id], { penColor: Math.floor(rand() * 200) } as never);
  } catch (err) {
    // some edits don't apply to some objects (a group's attributes...): that's the editor's business, not the sync's
    if (!(err instanceof Error)) throw err;
  }
}

const t0 = performance.now();
const w = new World(EDITORS);
for (let i = 0; i < STEPS; i++) {
  const r = rand();
  const ed = pick(w.editors);
  if (r < 0.35) edit(ed);
  else if (r < 0.7) w.deliver(ed);
  else w.receive(ed);
}
w.settle();
const random = w.converged("random");
console.log(`${random ? "ok  " : "FAIL"} random run: ${w.server.accepted} accepted, ${w.server.refused} refused, turned back ${w.editors.map((ed) => ed.undone).join("/")}, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
if (!random) failures++;
console.log(failures ? `${failures} FAILED` : "converged");
process.exitCode = failures ? 1 : 0;
