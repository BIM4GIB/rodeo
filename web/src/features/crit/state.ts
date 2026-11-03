// Crit mode's state: the drawing's comment threads (kept in step with the
// server and live edits), the mode and its tool, and the drafts of a pin or a
// redline that is being made and not yet posted. Pure data: the UI modules
// subscribe here and draw from it.

import type { Anchor, Comment, Role, Stroke } from "../../platform/protocol.ts";
import { CAN_COMMENT } from "../../platform/protocol.ts";

export type CritTool = "select" | "pin" | "redline";
export type ThreadFilter = "open" | "resolved" | "all";

export const REDLINE_COLOURS: readonly { readonly name: string; readonly value: string }[] = [
  { name: "Red", value: "#e5484d" },
  { name: "Blue", value: "#0090ff" },
  { name: "Green", value: "#30a46c" },
  { name: "Black", value: "#111111" },
];

/** A redline's width on screen, in CSS px. */
export const STROKE_WIDTH_PX = 2;

/** A comment thread: the comment that opened it, its replies oldest first, and its pin number. */
export interface Thread {
  readonly root: Comment;
  /** threads are numbered in the order they were made, from 1 */
  readonly number: number;
  readonly replies: readonly Comment[];
}

/** A redline being drawn on the 2D drawing, its points in world units. */
export interface StrokeInProgress {
  readonly layerId: string;
  readonly colour: string;
  readonly points: [number, number][];
}

function byTime(a: Comment, b: Comment): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

class CritState {
  /** crit mode is on (only for a cloud drawing) */
  active = false;
  tool: CritTool = "select";
  colour: string = REDLINE_COLOURS[0].value;
  filter: ThreadFilter = "open";
  /** the cloud drawing under review, and the signed-in user's role in it */
  fileId: string | null = null;
  role: Role | null = null;
  /** the thread whose popover is open, by its root comment's id */
  selected: string | null = null;
  /** where the pin being placed goes (its popover is open while it exists) */
  pinDraft: Anchor | null = null;
  /** redlines drawn but not yet posted */
  strokes: Stroke[] = [];
  /** the redline being dragged out right now */
  stroke: StrokeInProgress | null = null;

  private all: Comment[] = [];
  private cache: Thread[] | null = null;
  private readonly listeners = new Set<() => void>();

  /** Calls `fn` after every change to the comments or the mode; returns a function that stops it. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Tells the subscribers something they show has changed. */
  changed(): void {
    for (const fn of [...this.listeners]) fn();
  }

  /** Whether the signed-in user's role may add comments (owner, editor, reviewer). */
  get canComment(): boolean {
    return this.role !== null && (CAN_COMMENT as readonly Role[]).includes(this.role);
  }

  /** Every comment of the drawing, oldest first. */
  comments(): readonly Comment[] {
    return this.all;
  }

  threads(): readonly Thread[] {
    if (!this.cache) {
      const replies = new Map<string, Comment[]>();
      for (const c of this.all) {
        if (c.parentId === null) continue;
        const list = replies.get(c.parentId);
        if (list) list.push(c);
        else replies.set(c.parentId, [c]);
      }
      const roots = this.all.filter((c) => c.parentId === null);
      this.cache = roots.map((root, i) => ({ root, number: i + 1, replies: replies.get(root.id) ?? [] }));
    }
    return this.cache;
  }

  thread(id: string): Thread | undefined {
    return this.threads().find((t) => t.root.id === id);
  }

  openCount(): number {
    return this.threads().filter((t) => !t.root.resolved).length;
  }

  /** Adds a comment, or replaces the one with its id. */
  upsert(c: Comment): void {
    const i = this.all.findIndex((x) => x.id === c.id);
    if (i >= 0) this.all[i] = c;
    else this.all.push(c);
    this.all.sort(byTime);
    this.cache = null;
    this.changed();
  }

  /** Removes a comment; a thread's replies go with it. */
  remove(id: string): void {
    const before = this.all.length;
    this.all = this.all.filter((c) => c.id !== id && c.parentId !== id);
    if (this.all.length === before) return;
    this.cache = null;
    if (this.selected === id) this.selected = null;
    this.changed();
  }

  /** Replaces every comment (a load from the server). */
  replace(list: readonly Comment[]): void {
    this.all = [...list].sort(byTime);
    this.cache = null;
    this.changed();
  }
}

export const crit = new CritState();
