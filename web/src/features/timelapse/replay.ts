// Rebuilds a drawing from its opening bytes and its history. The editor's own way to apply a
// change to another session is EditSession.applyRemote, which renumbers names and rebuilds the
// document for every change; a long history then takes seconds per hundred changes. So replay
// splices the same records the change names into the document, and rebuilds it once per position
// asked for. check.ts asserts the two give the same bytes.

import { openVwx, type EditSession, type VwxDocument } from "../../core/index.ts";
import type { Model } from "../../core/model.ts";
import { applyOp, type HistoryOp } from "./history.ts";

export class Replayer {
  private session: EditSession;
  /** how many ops the current document has applied */
  private applied = 0;

  constructor(
    readonly startBytes: Uint8Array,
    readonly ops: readonly HistoryOp[],
    private readonly fileName = "timelapse.vwx",
  ) {
    this.session = openVwx(startBytes, fileName);
  }

  /** The document at the current position. */
  get doc(): VwxDocument {
    return this.session.doc;
  }

  /** The number of ops applied: the position the document is at. */
  get position(): number {
    return this.applied;
  }

  /**
   * Moves the document to the state after the first `k` ops. Going back starts again from the
   * opening bytes, in a new document object (so the caller can tell it apart from the one it had).
   */
  seek(k: number): void {
    const target = Math.max(0, Math.min(Math.floor(k), this.ops.length));
    if (target < this.applied) {
      this.session = openVwx(this.startBytes, this.fileName);
      this.applied = 0;
    }
    if (target === this.applied) return;
    const model = this.session.doc as Model;
    for (let i = this.applied; i < target; i++) {
      const op = this.ops[i];
      applyOp(model.datas, op);
      if (op.header) model.patchHeader(op.header.at, op.header.bytes);
    }
    this.applied = target;
    model.rebuild();
  }
}
