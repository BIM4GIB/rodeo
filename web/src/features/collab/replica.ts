// One editor's copy of a shared drawing: its own changes waiting for the
// server, and how changes from others are fitted in. No DOM or sockets, so the
// simulation in check.ts can run many replicas against a fake server.
//
// Local changes apply at once and are sent one at a time, each as the runs of
// records it changed (a class added at the top of the file and an object drawn
// at its end are two small runs, not one span over the whole drawing). Someone
// else's change that arrives while ours are unconfirmed was ordered before them
// by the server: it is rewritten past ours (theirs first on ties) and ours past
// it, run by run. A change of ours with a run that touches the same records as
// one of theirs is turned back here, and the server refuses it there, so every
// replica ends with the same bytes.

import type { EditSession, HeaderPatch, SpliceOp, SpliceRun } from "../../core/index.ts";
import { changedRuns, invertRuns, transformRuns, type Run, type Splice } from "../../core/splice.ts";

/** A change of this replica's that the server hasn't confirmed. */
interface Local {
  readonly id: number;
  /** its runs where they now stand (rewritten as others' changes arrive), in order */
  runs: Splice[];
  /** each run's records: those it put in, and those it took out */
  readonly add: readonly (readonly Uint8Array[])[];
  readonly removed: readonly (readonly Uint8Array[])[];
  readonly op: SpliceOp;
  /** turned back here because someone else's change came first; the server will refuse it */
  doomed: boolean;
}

/** A change as the server orders it: records already decoded. */
export interface Incoming {
  /** in order (core/splice.ts): each at the positions the ones before it left */
  readonly runs: readonly Run<Uint8Array>[];
  readonly kind: SpliceOp["kind"];
  readonly ids: readonly string[];
  readonly header?: HeaderPatch;
}

export interface Outgoing {
  readonly id: number;
  /** the last server change this replica held when it made the change */
  readonly base: number;
  readonly runs: readonly Run<Uint8Array>[];
  readonly kind: SpliceOp["kind"];
  readonly ids: readonly string[];
  readonly header?: { readonly at: number; readonly bytes: Uint8Array };
}

export interface ReplicaHooks {
  /** sends a change to the server (one at a time: the next waits for ack or refused) */
  send(op: Outgoing): void;
  /** a change of ours was turned back */
  undone(why: "clash" | "lost" | "refused"): void;
  /** a change of ours was made and queued (call flush to send it) */
  queued(): void;
}

/** A change of runs for EditSession.applyRemote. */
function spliceOp(runs: readonly Run<Uint8Array>[], kind: SpliceOp["kind"], ids: readonly string[], header?: HeaderPatch): SpliceOp {
  const [first, ...more] = runs;
  const op: SpliceOp = { start: first.start, del: first.del, add: first.add, kind, ids: [...ids], header };
  if (more.length) op.more = more as SpliceRun[];
  return op;
}

const counts = (r: Run<unknown>): Splice => ({ start: r.start, del: r.del, add: r.add.length });

export class Replica {
  /** the last server change this copy holds */
  applied: number;
  private pending: Local | null = null;
  private queue: Local[] = [];
  private nextId = 1;
  private readonly unStep: () => void;

  constructor(
    private readonly session: EditSession,
    applied: number,
    private readonly hooks: ReplicaHooks,
  ) {
    this.applied = applied;
    this.unStep = session.onStep((op) => {
      this.local(op);
      hooks.queued();
    });
  }

  /** Whether every change of ours is confirmed (the copy is exactly the server's at `applied`). */
  idle(): boolean {
    return !this.pending && !this.queue.length;
  }

  stop(): void {
    this.unStep();
  }

  private local(op: SpliceOp): void {
    // the session reports a step as one span from its first changed record to its last: cut to the runs it changed
    const removed = op.removed ?? [];
    const runs: readonly Run<Uint8Array>[] = (op.removed && changedRuns(op.start, removed, op.add)) || [op];
    // what each run took out: its records where it stands before any of them applied
    let net = 0;
    const taken = runs.map((r) => {
      const from = r.start - net - op.start;
      net += r.add.length - r.del;
      return removed.slice(from, from + r.del);
    });
    this.queue.push({ id: this.nextId++, runs: runs.map(counts), add: runs.map((r) => r.add), removed: taken, op, doomed: false });
  }

  /** Sends the next change if none is in flight; `connected` false keeps them queued. */
  flush(connected: boolean): void {
    if (this.pending || !this.queue.length || !connected) return;
    const next = this.queue.shift()!;
    this.pending = next;
    const { op } = next;
    const header = op.header && { at: op.header.at, bytes: op.header.bytes };
    this.hooks.send({ id: next.id, base: this.applied, runs: this.runsOf(next), kind: op.kind, ids: op.ids, header });
  }

  /** A change's runs where they now stand, with their records. */
  private runsOf(l: Local): Run<Uint8Array>[] {
    return l.runs.map((r, i) => ({ start: r.start, del: r.del, add: l.add[i] }));
  }

  /** The server accepted our change in flight as `seq`; false when the copies have come apart (reload). */
  ack(id: number, seq: number): boolean {
    if (this.pending?.id !== id) return true;
    const doomed = this.pending.doomed;
    this.applied = seq;
    this.pending = null;
    return !doomed;
  }

  /** The server refused our change in flight. */
  refused(id: number): void {
    const p = this.pending;
    if (p?.id !== id) return;
    this.pending = null;
    if (!p.doomed) {
      this.revert([p, ...this.queue]);
      this.queue = [];
      this.hooks.undone("refused");
    }
  }

  /** After reconnecting: a change in flight may or may not have reached the server, so it and those after it go back. */
  dropInFlight(): void {
    if (!this.pending) return;
    if (!this.pending.doomed) {
      this.revert([this.pending, ...this.queue]);
      this.hooks.undone("lost");
    }
    this.pending = null;
    this.queue = [];
  }

  /** Someone else's change, ordered by the server before every unconfirmed change of ours. */
  remote(seq: number, op: Incoming): void {
    if (seq <= this.applied) return;
    const locals = this.unconfirmed();
    // theirs is rewritten past each of ours in turn, and each of ours past theirs as it stood there
    let r: Splice[] = op.runs.map(counts);
    const rebased: Splice[][] = [];
    let clash = -1;
    for (let i = 0; i < locals.length; i++) {
      const theirs = transformRuns(r, locals[i].runs, true);
      const ours = transformRuns(locals[i].runs, r, false);
      // two header changes clash wherever they fall, as the server has it
      if (!theirs || !ours || (op.header && locals[i].op.header)) {
        clash = i;
        break;
      }
      rebased.push(ours);
      r = theirs;
    }
    if (clash >= 0) {
      // ours touch what theirs touched: ours, and everything built on them, go back
      const lost = locals.slice(clash);
      this.revert(lost);
      for (const l of lost) l.doomed = true;
      this.queue = this.queue.filter((l) => !l.doomed);
      this.hooks.undone("clash");
      this.remote(seq, op);
      return;
    }
    locals.forEach((l, i) => (l.runs = rebased[i]));
    this.applied = seq;
    const runs = op.runs.map((x, i) => ({ start: r[i].start, del: x.del, add: x.add }));
    this.session.applyRemote(spliceOp(runs, op.kind, op.ids, op.header));
  }

  /** Changes of ours not yet confirmed nor already turned back, oldest first. */
  private unconfirmed(): Local[] {
    const out: Local[] = [];
    if (this.pending && !this.pending.doomed) out.push(this.pending);
    out.push(...this.queue);
    return out;
  }

  /** Turns back changes of ours, newest first, leaving the others' in place. */
  private revert(locals: readonly Local[]): void {
    for (let i = locals.length - 1; i >= 0; i--) {
      const l = locals[i];
      if (l.doomed) continue;
      const h = l.op.header;
      const header = h?.before && { at: h.at, bytes: h.before };
      this.session.applyRemote(spliceOp(invertRuns(this.runsOf(l), l.removed), l.op.kind, l.op.ids, header));
    }
  }
}
