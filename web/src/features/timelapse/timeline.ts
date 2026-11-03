// What a timelapse shows: a drawing's recorded history (its opening bytes and changes, replayed),
// or the saved versions of a cloud drawing (each a keyframe). A timeline gives the drawing at each
// of a timelapse's frames, spread evenly over the history or the versions.

import { openVwx, type ChangeEvent, type VwxDocument } from "../../core/index.ts";
import { changesOf, positionOf, type HistoryOp } from "./history.ts";
import { Replayer } from "./replay.ts";

/** A recorded history: the drawing it opened from, and its changes. */
export interface HistorySource {
  readonly kind: "history";
  readonly label: string;
  readonly start: Uint8Array;
  readonly ops: readonly HistoryOp[];
  /** when the history began, ms since the epoch */
  readonly created: number;
}

/** A cloud drawing's saved versions, oldest first. */
export interface VersionSource {
  readonly kind: "versions";
  readonly label: string;
  readonly versions: readonly { readonly id: string; readonly createdAt: number }[];
  fetch(id: string): Promise<Uint8Array>;
}

export type Source = HistorySource | VersionSource;

/**
 * The drawing at one frame. `key` changes exactly when the picture does. `changesSince(key0)` is
 * what changed in `doc` between the state `key0` (an earlier key of the same document) and this one,
 * so a renderer that skipped some frames still updates everything it must.
 */
export interface Shown {
  readonly doc: VwxDocument;
  readonly key: number;
  /** when the state was reached, ms since the epoch (null when unknown) */
  readonly time: number | null;
  changesSince(key0: number): ChangeEvent | null;
}

export interface Timeline {
  /** the drawing at frame `frame` of `frames` */
  at(frame: number, frames: number): Promise<Shown>;
  /** the final state (for framing the drawing); independent of at() */
  last(): Promise<Shown>;
  /** changes in a history, or versions */
  readonly steps: number;
  /** the number of steps shown as "step k of n" (versions are numbered from 1) */
  readonly label: string;
}

class HistoryTimeline implements Timeline {
  private readonly replayer: Replayer;

  constructor(private readonly src: HistorySource) {
    this.replayer = new Replayer(src.start, src.ops);
  }

  get steps(): number {
    return this.src.ops.length;
  }

  get label(): string {
    return this.src.label;
  }

  private timeOf(k: number): number {
    return k === 0 ? this.src.created : this.src.ops[k - 1].t;
  }

  async at(frame: number, frames: number): Promise<Shown> {
    const k = positionOf(frame, frames, this.src.ops.length);
    this.replayer.seek(k);
    const ops = this.src.ops;
    return { doc: this.replayer.doc, key: k, time: this.timeOf(k), changesSince: (key0) => changesOf(ops, key0, k) };
  }

  async last(): Promise<Shown> {
    // a separate replay, so the frames' own replay keeps its place
    const n = this.src.ops.length;
    const replayer = new Replayer(this.src.start, this.src.ops);
    replayer.seek(n);
    return { doc: replayer.doc, key: n, time: this.timeOf(n), changesSince: () => null };
  }
}

/** Versions are documents of their own: whatever differs about them is a change to everything. */
function versionChange(): ChangeEvent {
  return { kind: "all", ids: [] };
}

class VersionTimeline implements Timeline {
  private held: { index: number; doc: VwxDocument } | null = null;

  constructor(private readonly src: VersionSource) {}

  get steps(): number {
    return this.src.versions.length;
  }

  get label(): string {
    return this.src.label;
  }

  private async open(index: number): Promise<VwxDocument> {
    if (this.held?.index === index) return this.held.doc;
    const version = this.src.versions[index];
    const doc = openVwx(await this.src.fetch(version.id), "version.vwx").doc;
    this.held = { index, doc };
    return doc;
  }

  async at(frame: number, frames: number): Promise<Shown> {
    const v = positionOf(frame, frames, this.src.versions.length - 1);
    return { doc: await this.open(v), key: v, time: this.src.versions[v].createdAt, changesSince: versionChange };
  }

  async last(): Promise<Shown> {
    const v = this.src.versions.length - 1;
    return { doc: await this.open(v), key: v, time: this.src.versions[v].createdAt, changesSince: versionChange };
  }
}

export function timelineFor(source: Source): Timeline {
  return source.kind === "history" ? new HistoryTimeline(source) : new VersionTimeline(source);
}
