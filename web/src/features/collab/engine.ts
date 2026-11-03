// The live-collaboration engine: keeps an open cloud drawing in step with
// everyone else editing it, over the server's socket (docs/PLATFORM.md, "Live
// collaboration"). The collab feature's UI (avatars, cursors, follow) and crit
// mode use the API below; the collab feature starts it when a cloud drawing opens.
//
// Every change is one splice of the record list. Local changes apply at once
// and are sent one at a time; the server orders them with everyone else's.
// A change from someone else that arrives while ours are unconfirmed is
// rewritten past ours (theirs first, as the server ordered it); a change of
// ours that touches the same records as theirs is turned back here and refused
// there, so every editor ends with the same bytes.
//
// Project Sharing: layers checked out by someone else can't be changed here.
// While someone else holds one, the session's layer guard refuses such a change
// before it is made (or sent), with an error naming the layer and its holder.

import { appContext, documentSource } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { documentBytes } from "../../app/writeOut.ts";
import type { EditSession } from "../../core/index.ts";
import { ApiError, collabUrl, files, type Progress } from "../../platform/api.ts";
import {
  BIG_DRAWING,
  type Checkout,
  type Comment,
  type Peer,
  type Presence,
  type Role,
  type ServerMessage,
  type WireOp,
} from "../../platform/protocol.ts";
import { Replica, type Incoming } from "./replica.ts";

export type CollabStatus = "connecting" | "live" | "offline";

/** A copy of the drawing and the last change it holds. */
export interface WrittenOut {
  readonly bytes: Uint8Array;
  readonly seq: number | null;
}

export interface CollabSession {
  readonly fileId: string;
  /** this client as the others see it */
  readonly you: Peer;
  readonly role: Role;
  status(): CollabStatus;
  /** everyone else in the drawing now */
  peers(): readonly Peer[];
  /** where a peer is and what they look at (null before they've said) */
  presence(clientId: string): Presence | null;
  /** Merges into what this client tells the others (sent at most ~15 times a second). */
  setPresence(p: Partial<Presence>): void;
  /**
   * Saves a version holding every change so far (waits for this client's changes to be accepted
   * first, and for a save under way). `written`: the drawing already written out, at `heldSeq()`,
   * which saves writing it out again if nothing has changed since.
   */
  saveVersion(label?: string, onProgress?: Progress, written?: WrittenOut): Promise<void>;
  /** The last change a copy of the drawing written out now holds exactly; null while changes of ours are on their way. */
  heldSeq(): number | null;
  /** Autosave has stopped (with why; `plan`: this user's plan is why), or is working again (null). */
  onAutosave(fn: (stopped: string | null, plan: boolean) => void): () => void;
  /** Called when peers join, leave or move; returns a function that stops it. */
  onPeers(fn: () => void): () => void;
  onStatus(fn: (s: CollabStatus) => void): () => void;
  /** Crit comments created, changed or deleted by anyone (deleted: { id, deleted: true }). */
  onComment(fn: (c: Comment | { id: string; deleted: true }) => void): () => void;
  /** Called when a change of this client's is refused because someone changed the same thing first. */
  onRejected(fn: (reason: string) => void): () => void;
  /** The layers checked out now (Project Sharing), as the server last said. */
  checkouts(): readonly Checkout[];
  /** Checks layers out for this member alone; those someone else holds stay theirs. False when not connected. */
  checkOut(layerIds: readonly string[]): boolean;
  /** Gives layers back: one's own, or anyone's for the drawing's owner. False when not connected. */
  release(layerIds: readonly string[]): boolean;
  /** Called when layers are checked out or released, by anyone. */
  onCheckouts(fn: () => void): () => void;
  /** Whether every change of this client's has been accepted (none queued or on its way). */
  settled(): boolean;
  leave(): void;
}

let active: CollabSession | null = null;
/**
 * Where each drawing left its live session with nothing of its own unsent, by its edit session: a
 * drawing brought back to the front from its tab joins again from there, the changes it holds
 * being the server's up to `collabSeq`.
 */
const resumes = new WeakMap<EditSession, { readonly versionId: string; readonly collabSeq: number }>();

/** Where `session` left its live session, if it can join again from there. */
export function resumeOf(session: EditSession): { readonly versionId: string; readonly collabSeq: number } | undefined {
  return resumes.get(session);
}

const listeners = new Set<(s: CollabSession | null) => void>();

/** The live session for the open drawing, or null. */
export function collab(): CollabSession | null {
  return active;
}

/** Calls `fn` now and whenever a live session starts or ends. */
export function onCollab(fn: (s: CollabSession | null) => void): () => void {
  listeners.add(fn);
  fn(active);
  return () => listeners.delete(fn);
}

export function setActive(s: CollabSession | null): void {
  active = s;
  for (const fn of [...listeners]) fn(s);
}

/** Joins the live session of a cloud drawing just opened from `versionId` (whose content holds changes up to `collabSeq`). */
export function startCollab(fileId: string, session: EditSession, versionId: string, collabSeq: number): Promise<CollabSession> {
  active?.leave();
  const live = new Live(fileId, session, versionId, collabSeq);
  return live.connect().then(
    () => {
      setActive(live);
      return live;
    },
    (err: unknown) => {
      live.leave();
      throw err;
    },
  );
}

// ---- records on the wire --------------------------------------------------------

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A change as the server sends it, records and header bytes decoded. */
function incoming(op: WireOp): Incoming {
  const header = op.header && { at: op.header.at, bytes: fromBase64(op.header.bytes) };
  return { start: op.start, del: op.del, add: op.add.map(fromBase64), kind: op.kind, ids: op.ids, header };
}

const PRESENCE_MS = 66;
const RETRY_MS = [1000, 2000, 5000, 10000];
const QUIET_WAIT_MS = 10_000;

const EMPTY_PRESENCE: Presence = { mode: "2d", layerId: null, cursor: null, selection: [], view: null, camera: null, pointer3d: null };

class Live implements CollabSession {
  you: Peer = { clientId: "", userId: "", name: "", color: "#888", avatarUrl: null, role: "viewer" };
  private ws: WebSocket | null = null;
  private state: CollabStatus = "connecting";
  private readonly others = new Map<string, Peer>();
  private readonly where = new Map<string, Presence>();
  private readonly replica: Replica;
  private mine: Presence = EMPTY_PRESENCE;
  private presenceTimer = 0;
  private presenceDue = false;
  private retry = 0;
  private retryTimer = 0;
  private closed = false;
  private welcomed: (() => void) | null = null;
  private readonly peerFns = new Set<() => void>();
  private readonly statusFns = new Set<(s: CollabStatus) => void>();
  private readonly commentFns = new Set<(c: Comment | { id: string; deleted: true }) => void>();
  private readonly rejectFns = new Set<(reason: string) => void>();
  private readonly autosaveFns = new Set<(stopped: string | null, plan: boolean) => void>();
  /** saves under way or waiting their turn */
  private saving = 0;
  private lastSave: Promise<unknown> = Promise.resolve();
  /** autosave has stopped, and the user has been told */
  private autosaveStopped = false;
  /** the drawing is more than the cloud takes: nothing can be done by asking again */
  private tooLarge = false;
  private readonly checkoutFns = new Set<() => void>();
  private held: readonly Checkout[] = [];
  private readonly onUnload = (e: Event): void => {
    // the changes are on the server: closing the tab loses nothing, so the editor's own "unsaved changes" prompt stays quiet
    if (this.state === "live" && this.replica.idle()) e.stopImmediatePropagation();
  };

  constructor(
    readonly fileId: string,
    private readonly session: EditSession,
    private readonly versionId: string,
    collabSeq: number,
  ) {
    this.replica = new Replica(session, collabSeq, {
      send: (op) => {
        const header = op.header && { at: op.header.at, bytes: toBase64(op.header.bytes) };
        this.send({ t: "op", id: op.id, base: op.base, op: { start: op.start, del: op.del, add: op.add.map(toBase64), kind: op.kind, ids: op.ids, header } });
      },
      undone: (why) =>
        this.rejected(
          why === "clash"
            ? "Your change clashed with someone else’s edit and was undone"
            : why === "lost"
              ? "Your last change didn't reach the server and was undone"
              : this.role === "viewer" || this.role === "reviewer"
                ? "This drawing is view only for you"
                : "Your change couldn't be applied and was undone",
        ),
      queued: () => this.replica.flush(this.state === "live"),
    });
    window.addEventListener("beforeunload", this.onUnload, true);
  }

  get role(): Role {
    return this.you.role;
  }

  status(): CollabStatus {
    return this.state;
  }

  peers(): readonly Peer[] {
    return [...this.others.values()];
  }

  presence(clientId: string): Presence | null {
    return this.where.get(clientId) ?? null;
  }

  onPeers(fn: () => void): () => void {
    this.peerFns.add(fn);
    return () => this.peerFns.delete(fn);
  }

  onStatus(fn: (s: CollabStatus) => void): () => void {
    this.statusFns.add(fn);
    return () => this.statusFns.delete(fn);
  }

  onComment(fn: (c: Comment | { id: string; deleted: true }) => void): () => void {
    this.commentFns.add(fn);
    return () => this.commentFns.delete(fn);
  }

  onAutosave(fn: (stopped: string | null, plan: boolean) => void): () => void {
    this.autosaveFns.add(fn);
    return () => this.autosaveFns.delete(fn);
  }

  onRejected(fn: (reason: string) => void): () => void {
    this.rejectFns.add(fn);
    return () => this.rejectFns.delete(fn);
  }

  // ---- project sharing ---------------------------------------------------------------

  checkouts(): readonly Checkout[] {
    return this.held;
  }

  checkOut(layerIds: readonly string[]): boolean {
    return this.sendIfLive({ t: "checkout", layers: [...layerIds] });
  }

  release(layerIds: readonly string[]): boolean {
    return this.sendIfLive({ t: "release", layers: [...layerIds] });
  }

  onCheckouts(fn: () => void): () => void {
    this.checkoutFns.add(fn);
    return () => this.checkoutFns.delete(fn);
  }

  private setCheckouts(list: readonly Checkout[]): void {
    this.held = list;
    // guarded only while someone else holds a layer, so other edits don't pay for the look-up
    const others = list.some((c) => c.userId !== this.you.userId);
    this.session.setLayerGuard(others ? (ids) => this.refusal(ids) : null);
    for (const fn of [...this.checkoutFns]) fn();
  }

  /** Why a change touching these layers can't be made here: the first held by someone else, by name. */
  private refusal(layerIds: readonly string[]): string | null {
    const k = this.held.find((c) => c.userId !== this.you.userId && layerIds.includes(c.layerId));
    if (!k) return null;
    const layer = this.session.doc.layers().find((l) => l.id === k.layerId)?.name ?? "That layer";
    return `${layer} is checked out by ${k.name}`;
  }

  private sendIfLive(msg: unknown): boolean {
    if (this.state !== "live" || this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  // ---- connection ----------------------------------------------------------------

  /** Opens the socket and resolves once the server has welcomed this client. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.welcomed = resolve;
      this.open(reject);
    });
  }

  private open(failed?: (err: Error) => void): void {
    this.setStatus("connecting");
    const ws = new WebSocket(collabUrl(this.fileId));
    this.ws = ws;
    let welcomed = false;
    ws.onopen = () => ws.send(JSON.stringify({ t: "hello", versionId: this.versionId }));
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === "welcome") welcomed = true;
      this.receive(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.closed) return;
      if (!welcomed && failed) {
        failed(new Error(e.code === 1006 ? "the server could not be reached" : e.reason || `closed (${e.code})`));
        return;
      }
      // 4003: removed from the drawing
      if (e.code === 4003) {
        this.leave();
        return;
      }
      this.setStatus("offline");
      this.retryTimer = window.setTimeout(() => this.open(), RETRY_MS[Math.min(this.retry++, RETRY_MS.length - 1)]);
    };
  }

  settled(): boolean {
    return this.replica.idle();
  }

  leave(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.presenceTimer);
    // a change still unsent is dropped below, so the copy is no longer the server's at `applied`
    if (this.replica.idle()) resumes.set(this.session, { versionId: this.versionId, collabSeq: this.replica.applied });
    else resumes.delete(this.session);
    this.replica.stop();
    this.session.setLayerGuard(null);
    window.removeEventListener("beforeunload", this.onUnload, true);
    this.ws?.close(1000);
    this.ws = null;
    this.setStatus("offline");
    if (active === this) setActive(null);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private setStatus(s: CollabStatus): void {
    if (this.state === s) return;
    this.state = s;
    for (const fn of [...this.statusFns]) fn(s);
  }

  private peersChanged(): void {
    for (const fn of [...this.peerFns]) fn();
  }

  // ---- messages --------------------------------------------------------------------

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        this.welcome(msg);
        break;
      case "reload":
        void this.reload();
        break;
      case "ack":
        // accepted there after being turned back here: the copies differ, so start again from the server's
        if (!this.replica.ack(msg.id, msg.seq)) void this.reload();
        else this.replica.flush(true);
        break;
      case "reject":
        this.replica.refused(msg.id);
        if (msg.reason === "stale") void this.reload();
        else this.replica.flush(true);
        break;
      case "op":
        this.replica.remote(msg.seq, incoming(msg.op));
        break;
      case "presence":
        this.where.set(msg.clientId, msg.p);
        this.peersChanged();
        break;
      case "join":
        this.others.set(msg.peer.clientId, msg.peer);
        this.peersChanged();
        break;
      case "leave":
        this.others.delete(msg.clientId);
        this.where.delete(msg.clientId);
        this.peersChanged();
        break;
      case "save-request":
        if (this.role === "owner" || this.role === "editor") void this.autosave();
        break;
      case "save-blocked":
        if (this.role === "owner") this.setAutosaveStopped(msg.error, true);
        else this.setAutosaveStopped("The drawing's owner has no room left on their plan.");
        break;
      case "comment":
        for (const fn of [...this.commentFns]) fn(msg.comment);
        break;
      case "comment-deleted":
        for (const fn of [...this.commentFns]) fn({ id: msg.id, deleted: true });
        break;
      case "checkouts":
        this.setCheckouts(msg.checkouts);
        break;
      case "error":
        console.warn("openvwx: collaboration server:", msg.error);
        break;
      case "pong":
        break;
    }
  }

  private welcome(msg: Extract<ServerMessage, { t: "welcome" }>): void {
    this.you = msg.you;
    this.others.clear();
    for (const p of msg.peers) this.others.set(p.clientId, p);
    this.where.clear();
    for (const [id, p] of Object.entries(msg.presence)) this.where.set(id, p);
    // a change sent before the connection dropped may or may not have reached the server: it can't be
    // told apart from the others' changes in the catch-up, so it (and what was built on it) is turned back
    this.replica.dropInFlight();
    for (const { seq, op } of msg.ops) {
      this.replica.remote(seq, incoming(op));
    }
    this.replica.applied = Math.max(this.replica.applied, msg.seq);
    this.setCheckouts(msg.checkouts ?? []);
    this.retry = 0;
    this.setStatus("live");
    this.peersChanged();
    this.sendPresence();
    this.replica.flush(true);
    this.welcomed?.();
    this.welcomed = null;
  }

  /** The room has moved past the version this copy started from: open the drawing again. */
  private async reload(): Promise<void> {
    const ctx = appContext();
    const source = documentSource();
    this.leave();
    if (!ctx || !source || store.session?.doc !== this.session.doc) return;
    try {
      const content = await files.content(this.fileId);
      this.session.markSaved();
      await ctx.openDocument(content.bytes, store.fileName, {
        source: { ...source, versionId: content.versionId, collabSeq: content.collabSeq } as typeof source,
      });
    } catch (err) {
      console.warn("openvwx: could not reopen the drawing", err);
    }
  }

  private rejected(text: string): void {
    for (const fn of [...this.rejectFns]) fn(text);
  }

  // ---- presence ----------------------------------------------------------------------

  setPresence(p: Partial<Presence>): void {
    this.mine = { ...this.mine, ...p };
    this.presenceDue = true;
    if (!this.presenceTimer) this.presenceTimer = window.setTimeout(() => this.sendPresence(), PRESENCE_MS);
  }

  private sendPresence(): void {
    this.presenceTimer = 0;
    if (!this.presenceDue && this.state === "live") return;
    this.presenceDue = false;
    this.send({ t: "presence", p: this.mine });
  }

  // ---- versions ----------------------------------------------------------------------

  saveVersion(label?: string, onProgress?: Progress, written?: WrittenOut): Promise<void> {
    return this.queueSave(false, label, onProgress, written);
  }

  heldSeq(): number | null {
    return this.replica.idle() ? this.replica.applied : null;
  }

  /** The server asked for a version. It asks again if none has arrived, as during a long upload: that one is still coming. */
  private async autosave(): Promise<void> {
    if (this.saving > 0 || this.tooLarge) return;
    try {
      await this.queueSave(true);
    } catch (err) {
      if (err instanceof ApiError && err.code === "too_large") {
        this.tooLarge = true;
        this.setAutosaveStopped(`${err.message}.`);
      }
      // refused for the owner's plan: the server has heard, and answers with save-blocked
      console.warn("openvwx: autosave failed:", err);
    }
  }

  private setAutosaveStopped(why: string | null, plan = false): void {
    if (this.autosaveStopped === (why !== null)) return;
    this.autosaveStopped = why !== null;
    for (const fn of [...this.autosaveFns]) fn(why, plan);
  }

  /** Saves run one at a time: each writes all of the drawing out, and a large one takes minutes to send. */
  private queueSave(autosave: boolean, label?: string, onProgress?: Progress, written?: WrittenOut): Promise<void> {
    this.saving++;
    const run = this.lastSave.then(() => this.writeVersion(autosave, label, onProgress, written));
    this.lastSave = run.catch(() => undefined);
    return run.finally(() => {
      this.saving--;
    });
  }

  private async writeVersion(autosave: boolean, label?: string, onProgress?: Progress, written?: WrittenOut): Promise<void> {
    // a version must hold exactly the changes up to a confirmed seq: wait until ours are all confirmed
    const until = Date.now() + QUIET_WAIT_MS;
    while (!this.replica.idle()) {
      if (this.closed || Date.now() > until) throw new Error("changes are still being sent");
      await new Promise((r) => setTimeout(r, 100));
    }
    const seq = this.replica.applied;
    const bytes = written?.seq === seq ? written.bytes : await documentBytes(this.session);
    let versionId: string;
    try {
      const kind = !autosave ? undefined : bytes.length > BIG_DRAWING ? "replace" : "keep";
      versionId = (await files.save(this.fileId, bytes, { collabSeq: seq, label, autosave: kind, onProgress })).version.id;
    } catch (err) {
      // someone else in the session saved a newer version, which holds every change of ours confirmed by now
      if (label || !(err instanceof ApiError && err.code === "conflict")) throw err;
      if (seq === this.replica.applied && this.replica.idle()) this.session.markSaved();
      return;
    }
    this.tooLarge = false;
    this.setAutosaveStopped(null);
    // edits made while the bytes were sent are newer than the saved version
    if (seq === this.replica.applied && this.replica.idle()) this.session.markSaved();
    this.send({ t: "saved", seq, versionId });
  }
}
