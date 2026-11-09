// Live collaboration: the WebSocket at /api/collab/:fileId (docs/PLATFORM.md,
// "Live collaboration"). The rest of the server reaches it only through
// attachCollab() and the CollabHub it returns.
//
// A room per drawing with members connected. Its change log (the changes made
// after the last saved version) lives in memory and in collab_ops, and the
// room's counters in collab_rooms, so a restart loses nothing. The server puts
// the changes in one order: a change made against an older seq is rewritten
// past the ones since (core/splice.ts), run by run, or refused when a run of it
// touches the records of a run of one of them. A client older than the
// protocol (COLLAB_PROTOCOL) is turned away: it would apply a change of
// several runs as its first run alone.
//
// Project Sharing: members check layers out for their editing alone. The
// checkouts live in collab_checkouts, outlive the room and the holder's
// connection (as Vectorworks' do), and go to everyone on welcome and on every
// change. The editors keep to them (a change touching a layer someone else
// holds is refused before it is sent); the server can't see which layer a
// change touches, so it doesn't check.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { inOrder, transformRuns, type Splice } from "../../web/src/core/splice.ts";
import {
  BIG_DRAWING,
  CAN_EDIT,
  COLLAB_PROTOCOL,
  MAX_CHECKOUT_LAYERS,
  PEER_COLORS,
  SAVE_BIG_EVERY_MS,
  SAVE_EVERY_MS,
  SAVE_EVERY_OPS,
} from "../../web/src/platform/protocol.ts";
import type { Checkout, Comment, Peer, Presence, Role, ServerMessage, WireOp, WireRun } from "../../web/src/platform/protocol.ts";

export interface CollabUser {
  readonly id: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

export interface CollabDeps {
  readonly db: DatabaseSync;
  /** the signed-in user of an upgrade request (its session cookie), or null */
  userFromRequest(req: IncomingMessage): CollabUser | null;
  /** the user's role in a drawing, or null when they aren't a member */
  roleOf(fileId: string, userId: string): Role | null;
  /** a drawing's head version, the last collaboration change it holds and its size, or null if there's no such drawing */
  head(fileId: string): { readonly versionId: string; readonly collabSeq: number; readonly size: number } | null;
  /** what the drawing's owner's plan would refuse a new version of this size for, or null */
  saveRefusal(fileId: string, size: number): string | null;
}

export interface CollabHub {
  /** The last change number of a drawing's room (0 before any). A plain save stores this as its version's collabSeq. */
  currentSeq(fileId: string): number;
  /** Whether a save that doesn't come from the live session (no X-Collab-Seq) may go ahead: false while changes are unsaved. */
  canSavePlain(fileId: string): boolean;
  /** A version holding every change up to `collabSeq` was saved: changes up to it are dropped from the log. */
  versionSaved(fileId: string, versionId: string, collabSeq: number): void;
  /** A save from the live session was refused for the owner's plan: none is asked for until one this size would fit. */
  saveRefused(fileId: string, size: number): void;
  /** The drawing's content was replaced (a version restored): everyone reloads; returns the seq the new version holds. */
  reset(fileId: string): number;
  broadcastComment(fileId: string, comment: Comment): void;
  broadcastCommentDeleted(fileId: string, id: string): void;
  /** Disconnects a user (removed from the drawing), or everyone (drawing deleted) when userId is left out. */
  kick(fileId: string, userId?: string): void;
  /** Drawings open in a live session now, and the people in them (each account once a drawing), for the admin page. */
  liveStats(): { readonly drawings: number; readonly people: number; readonly together: number };
}

const COLLAB_PATH = /^\/api\/collab\/([^/]+)$/;
const KINDS: readonly string[] = ["objects", "layers", "classes", "all"];
const MAX_PAYLOAD = 64 * 1024 * 1024;
/** base64 length of the largest header change taken (the whole header is a few KB) */
const MAX_HEADER_PATCH = 64 * 1024;
const HEARTBEAT_MS = 30_000;
const MISSED_PONGS = 2;
const SAVE_CHECK_MS = 10_000;
/** after a save request, no further one for this long (until a save arrives) */
const SAVE_ASK_GAP_MS = 30_000;
/** the same for a big drawing, which takes minutes to send */
const SAVE_BIG_ASK_GAP_MS = 10 * 60_000;
/** how often a room with no room on its owner's plan looks again */
const SAVE_BLOCKED_CHECK_MS = 5000;

/** A socket. `peer` is set once its hello was accepted and it is in `room`. */
interface Client {
  readonly ws: WebSocket;
  readonly fileId: string;
  readonly user: CollabUser;
  readonly role: Role;
  peer: Peer | null;
  presence: Presence | null;
  room: Room | null;
  missed: number;
  /** told that saves are blocked, while they are */
  toldBlocked: boolean;
}

interface LoggedOp {
  readonly seq: number;
  readonly op: WireOp;
  /** its runs' spans, for rewriting later changes past it */
  readonly runs: readonly Splice[];
  /** when the change was made (ms) */
  readonly at: number;
}

interface Room {
  readonly fileId: string;
  lastSeq: number;
  savedSeq: number;
  /** when the oldest change not yet in a saved version was made (null: none) */
  firstUnsavedAt: number | null;
  ops: LoggedOp[];
  readonly clients: Set<Client>;
  lastOpClient: Client | null;
  saveAskedAt: number | null;
  /** the size of the last save refused for the owner's plan (0: none) */
  refusedSize: number;
  /** when the owner's plan was last found to have no room for a version (null: it has room) */
  blockedAt: number | null;
}

type HeaderRow = { last_seq: number; saved_seq: number; first_unsaved_at: number | null };
type OpRow = { seq: number; op: string };
type CheckoutRow = { layer_id: string; user_id: string; name: string; at: string };
/** the longest layer id taken (a GUID is 36 characters) */
const MAX_LAYER_ID = 64;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isIndex(v: unknown): v is number {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function parseRun(v: unknown): WireRun | null {
  if (!isRecord(v)) return null;
  const { start, del, add } = v;
  if (!isIndex(start) || !isIndex(del)) return null;
  if (!Array.isArray(add) || !add.every((s) => typeof s === "string")) return null;
  return { start, del, add: add as string[] };
}

function parseOp(v: unknown): WireOp | null {
  const first = parseRun(v);
  if (!first || !isRecord(v)) return null;
  const { kind, ids, header, more } = v;
  if (typeof kind !== "string" || !KINDS.includes(kind)) return null;
  if (!Array.isArray(ids) || !ids.every((s) => typeof s === "string")) return null;
  let op: WireOp = { ...first, kind: kind as WireOp["kind"], ids: [...ids] };
  if (more !== undefined) {
    if (!Array.isArray(more) || more.length === 0) return null;
    const runs = more.map(parseRun);
    if (!runs.every((r) => r !== null)) return null;
    op = { ...op, more: runs };
    if (!inOrder(spansOf(op))) return null;
  }
  if (header === undefined) return op;
  if (!isRecord(header) || !isIndex(header.at) || typeof header.bytes !== "string" || header.bytes.length > MAX_HEADER_PATCH) return null;
  return { ...op, header: { at: header.at, bytes: header.bytes } };
}

/** A change's runs as spans (record counts), in order. */
function spansOf(op: WireOp): Splice[] {
  const span = (r: WireRun): Splice => ({ start: r.start, del: r.del, add: r.add.length });
  return op.more ? [span(op), ...op.more.map(span)] : [span(op)];
}

/** The change with its runs moved to `spans` (the same runs, rewritten past others). */
function withSpans(op: WireOp, spans: readonly Splice[]): WireOp {
  const out: WireOp = { ...op, start: spans[0].start };
  return op.more ? { ...out, more: op.more.map((r, i) => ({ ...r, start: spans[i + 1].start })) } : out;
}

/** The layer ids of a checkout or release message, or null when malformed. */
function parseLayers(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_CHECKOUT_LAYERS) return null;
  if (!v.every((s) => typeof s === "string" && s.length > 0 && s.length <= MAX_LAYER_ID)) return null;
  return [...new Set(v as string[])];
}

function decodeId(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

function sendText(ws: WebSocket, text: string): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(text);
}

function sendMsg(ws: WebSocket, msg: ServerMessage): void {
  sendText(ws, JSON.stringify(msg));
}

function broadcast(room: Room, msg: ServerMessage, except?: Client): void {
  const text = JSON.stringify(msg);
  for (const c of room.clients) if (c !== except) sendText(c.ws, text);
}

/** Answers an upgrade request we won't serve, as a plain HTTP status, then drops the socket. */
function refuse(socket: Duplex, status: string): void {
  socket.on("error", () => {});
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

function newRoom(fileId: string): Room {
  return { fileId, lastSeq: 0, savedSeq: 0, firstUnsavedAt: null, ops: [], clients: new Set(), lastOpClient: null, saveAskedAt: null, refusedSize: 0, blockedAt: null };
}

export function attachCollab(server: Server, deps: CollabDeps): CollabHub {
  const { db } = deps;
  db.exec(`
    CREATE TABLE IF NOT EXISTS collab_ops (file_id TEXT, seq INTEGER, op TEXT, PRIMARY KEY (file_id, seq));
    CREATE TABLE IF NOT EXISTS collab_rooms (file_id TEXT PRIMARY KEY, last_seq INTEGER NOT NULL, saved_seq INTEGER NOT NULL, first_unsaved_at INTEGER);
    CREATE TABLE IF NOT EXISTS collab_checkouts (file_id TEXT, layer_id TEXT, user_id TEXT NOT NULL, name TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (file_id, layer_id));
  `);
  const selectHeader = db.prepare("SELECT last_seq, saved_seq, first_unsaved_at FROM collab_rooms WHERE file_id = ?");
  const selectOps = db.prepare("SELECT seq, op FROM collab_ops WHERE file_id = ? ORDER BY seq");
  const upsertHeader = db.prepare(
    "INSERT INTO collab_rooms (file_id, last_seq, saved_seq, first_unsaved_at) VALUES (?, ?, ?, ?) " +
      "ON CONFLICT(file_id) DO UPDATE SET last_seq = excluded.last_seq, saved_seq = excluded.saved_seq, first_unsaved_at = excluded.first_unsaved_at",
  );
  const insertOp = db.prepare("INSERT INTO collab_ops (file_id, seq, op) VALUES (?, ?, ?)");
  const deleteOpsUpTo = db.prepare("DELETE FROM collab_ops WHERE file_id = ? AND seq <= ?");
  const deleteAllOps = db.prepare("DELETE FROM collab_ops WHERE file_id = ?");
  const selectCheckouts = db.prepare("SELECT layer_id, user_id, name, at FROM collab_checkouts WHERE file_id = ? ORDER BY at, layer_id");
  const insertCheckout = db.prepare("INSERT OR IGNORE INTO collab_checkouts (file_id, layer_id, user_id, name, at) VALUES (?, ?, ?, ?, ?)");
  const deleteCheckout = db.prepare("DELETE FROM collab_checkouts WHERE file_id = ? AND layer_id = ?");
  const deleteUserCheckouts = db.prepare("DELETE FROM collab_checkouts WHERE file_id = ? AND user_id = ?");
  const deleteFileCheckouts = db.prepare("DELETE FROM collab_checkouts WHERE file_id = ?");

  function checkoutsOf(fileId: string): Checkout[] {
    return (selectCheckouts.all(fileId) as CheckoutRow[]).map((r) => ({ layerId: r.layer_id, userId: r.user_id, name: r.name, at: r.at }));
  }

  /** Tells everyone in a drawing's room the checkouts as they now stand. */
  function sendCheckouts(fileId: string): void {
    const room = rooms.get(fileId);
    if (room) broadcast(room, { t: "checkouts", checkouts: checkoutsOf(fileId) });
  }

  /** rooms with joined clients */
  const rooms = new Map<string, Room>();
  /** every upgraded socket, joined or not */
  const connections = new Set<Client>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

  function transaction(fn: () => void): void {
    db.exec("BEGIN");
    try {
      fn();
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  /** a drawing's log from the database, or null when it has no collaboration state */
  function loadRoom(fileId: string): Room | null {
    const h = selectHeader.get(fileId) as HeaderRow | undefined;
    if (!h) return null;
    // the database keeps no per-change time: the oldest unsaved time stands for all of them
    const first = h.first_unsaved_at ?? Date.now();
    const ops = (selectOps.all(fileId) as OpRow[]).map((r) => {
      const op = JSON.parse(r.op) as WireOp;
      return { seq: r.seq, op, runs: spansOf(op), at: first };
    });
    return {
      fileId,
      lastSeq: h.last_seq,
      savedSeq: h.saved_seq,
      firstUnsavedAt: ops.length > 0 ? first : null,
      ops,
      clients: new Set(),
      lastOpClient: null,
      saveAskedAt: null,
      refusedSize: 0,
      blockedAt: null,
    };
  }

  /** the room in memory, or loaded from the database (not kept in memory unless joined) */
  function lookup(fileId: string): Room | null {
    return rooms.get(fileId) ?? loadRoom(fileId);
  }

  function stateOf(fileId: string): { lastSeq: number; savedSeq: number } | null {
    const room = rooms.get(fileId);
    if (room) return room;
    const h = selectHeader.get(fileId) as HeaderRow | undefined;
    return h ? { lastSeq: h.last_seq, savedSeq: h.saved_seq } : null;
  }

  /** Takes a joined socket out of its room, telling the others. */
  function detach(c: Client): void {
    const room = c.room;
    if (!room) return;
    const peer = c.peer;
    c.room = null;
    c.peer = null;
    c.presence = null;
    room.clients.delete(c);
    if (room.lastOpClient === c) room.lastOpClient = null;
    if (peer) broadcast(room, { t: "leave", clientId: peer.clientId });
    if (room.clients.size === 0 && rooms.get(room.fileId) === room) rooms.delete(room.fileId);
  }

  function onMessage(c: Client, text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      sendMsg(c.ws, { t: "error", error: "malformed JSON" });
      return;
    }
    if (!isRecord(msg) || typeof msg.t !== "string") {
      sendMsg(c.ws, { t: "error", error: "malformed message" });
      return;
    }
    switch (msg.t) {
      case "hello":
        return onHello(c, msg.versionId, msg.proto);
      case "op":
        return onOp(c, msg);
      case "presence":
        return onPresence(c, msg.p);
      case "saved":
        return; // the save itself (versionSaved) does the work
      case "checkout":
        return onCheckout(c, msg.layers);
      case "release":
        return onRelease(c, msg.layers);
      case "ping":
        sendMsg(c.ws, { t: "pong" });
        return;
      default:
        sendMsg(c.ws, { t: "error", error: "unknown message" });
    }
  }

  function onHello(c: Client, versionId: unknown, proto: unknown): void {
    if (typeof versionId !== "string") {
      sendMsg(c.ws, { t: "error", error: "hello needs a versionId" });
      return;
    }
    detach(c);
    // an editor loaded before an update can't apply today's changes; 4003 stops its retries (its page must be reloaded)
    if (typeof proto !== "number" || proto < COLLAB_PROTOCOL) {
      sendMsg(c.ws, { t: "error", error: "Rodeo was updated: reload the page to keep editing with others" });
      c.ws.close(4003, "outdated");
      return;
    }
    const head = deps.head(c.fileId);
    if (!head || head.versionId !== versionId) {
      sendMsg(c.ws, { t: "reload" });
      return;
    }
    const room = rooms.get(c.fileId) ?? loadRoom(c.fileId) ?? newRoom(c.fileId);
    rooms.set(c.fileId, room);
    const members = [...room.clients];
    const peers = members.flatMap((m) => (m.peer ? [m.peer] : []));
    const used = new Set(peers.map((p) => p.color));
    const color = PEER_COLORS.find((x) => !used.has(x)) ?? PEER_COLORS[peers.length % PEER_COLORS.length];
    const you: Peer = {
      clientId: randomUUID(),
      userId: c.user.id,
      name: c.user.name,
      color,
      avatarUrl: c.user.avatarUrl,
      role: c.role,
    };
    const presence: Record<string, Presence> = {};
    for (const m of members) if (m.peer && m.presence) presence[m.peer.clientId] = m.presence;
    const ops = room.ops.filter((l) => l.seq > head.collabSeq).map((l) => ({ seq: l.seq, op: l.op }));
    c.peer = you;
    c.room = room;
    room.clients.add(c);
    sendMsg(c.ws, { t: "welcome", you, peers, presence, seq: room.lastSeq, ops, checkouts: checkoutsOf(c.fileId) });
    broadcast(room, { t: "join", peer: you }, c);
  }

  function onOp(c: Client, msg: Record<string, unknown>): void {
    const room = c.room;
    const peer = c.peer;
    if (!room || !peer) return; // before hello
    const id = msg.id;
    if (typeof id !== "number") {
      sendMsg(c.ws, { t: "error", error: "op needs a numeric id" });
      return;
    }
    if (!CAN_EDIT.includes(c.role)) {
      sendMsg(c.ws, { t: "reject", id, reason: "view only" });
      return;
    }
    const base = msg.base;
    const op = parseOp(msg.op);
    if (!isIndex(base) || !op || base > room.lastSeq) {
      sendMsg(c.ws, { t: "reject", id, reason: "invalid" });
      return;
    }
    // changes up to savedSeq were dropped by a save: a client that older can't be caught up
    if (base < room.savedSeq) {
      sendMsg(c.ws, { t: "reject", id, reason: "stale" });
      return;
    }
    // rewrite the change past each logged change made since base, in order
    let runs: Splice[] | null = spansOf(op);
    for (const l of room.ops) {
      if (l.seq <= base) continue;
      runs = transformRuns(runs, l.runs, false);
      // two header changes clash wherever they fall, as the replicas have it
      if (!runs || (op.header && l.op.header)) {
        sendMsg(c.ws, { t: "reject", id, reason: "conflict" });
        return;
      }
    }
    const rewritten = withSpans(op, runs);
    const seq = room.lastSeq + 1;
    const at = Date.now();
    const firstUnsavedAt = room.firstUnsavedAt ?? at;
    try {
      transaction(() => {
        insertOp.run(room.fileId, seq, JSON.stringify(rewritten));
        upsertHeader.run(room.fileId, seq, room.savedSeq, firstUnsavedAt);
      });
    } catch {
      sendMsg(c.ws, { t: "reject", id, reason: "error" });
      return;
    }
    room.lastSeq = seq;
    room.firstUnsavedAt = firstUnsavedAt;
    room.ops.push({ seq, op: rewritten, runs, at });
    room.lastOpClient = c;
    sendMsg(c.ws, { t: "ack", id, seq });
    broadcast(room, { t: "op", seq, clientId: peer.clientId, op: rewritten }, c);
    checkSave(room);
  }

  /** Checks the layers out for the member, but those someone else holds. */
  function onCheckout(c: Client, raw: unknown): void {
    if (!c.room) return; // before hello
    const layers = parseLayers(raw);
    if (!layers) {
      sendMsg(c.ws, { t: "error", error: "checkout needs a list of layer ids" });
      return;
    }
    if (!CAN_EDIT.includes(c.role)) {
      sendMsg(c.ws, { t: "error", error: "view only" });
      return;
    }
    const at = new Date().toISOString();
    transaction(() => {
      for (const layer of layers) insertCheckout.run(c.fileId, layer, c.user.id, c.user.name, at);
    });
    sendCheckouts(c.fileId);
  }

  /** Releases the member's own checkouts of the layers, or anyone's for the drawing's owner. */
  function onRelease(c: Client, raw: unknown): void {
    if (!c.room) return;
    const layers = parseLayers(raw);
    if (!layers) {
      sendMsg(c.ws, { t: "error", error: "release needs a list of layer ids" });
      return;
    }
    const held = new Map(checkoutsOf(c.fileId).map((k) => [k.layerId, k]));
    transaction(() => {
      for (const layer of layers) {
        const k = held.get(layer);
        if (k && (k.userId === c.user.id || c.role === "owner")) deleteCheckout.run(c.fileId, layer);
      }
    });
    sendCheckouts(c.fileId);
  }

  function onPresence(c: Client, p: unknown): void {
    const room = c.room;
    const peer = c.peer;
    if (!room || !peer || typeof p !== "object" || p === null) return;
    const presence = p as Presence;
    c.presence = presence;
    broadcast(room, { t: "presence", clientId: peer.clientId, p: presence }, c);
  }

  /** Asks one editor to save when many changes or a long wait have piled up. */
  function checkSave(room: Room): void {
    const now = Date.now();
    const many = room.lastSeq - room.savedSeq >= SAVE_EVERY_OPS;
    const waited = room.firstUnsavedAt === null ? 0 : now - room.firstUnsavedAt;
    if (!many && waited < SAVE_EVERY_MS) return;
    const size = deps.head(room.fileId)?.size ?? 0;
    const big = size > BIG_DRAWING;
    // a big drawing waits longer, however many changes: each save writes all of it out
    if (big && waited < SAVE_BIG_EVERY_MS) return;
    if (room.saveAskedAt !== null && now - room.saveAskedAt < (big ? SAVE_BIG_ASK_GAP_MS : SAVE_ASK_GAP_MS)) return;
    const editors = [...room.clients].filter((m) => CAN_EDIT.includes(m.role));
    const target = editors.find((m) => m === room.lastOpClient) ?? editors[0];
    if (!target) return;
    // a version the owner's plan has no room for isn't asked for: all of the drawing would be written
    // out and sent, to be refused. The editors hear why, and saves resume once there is room
    if (room.blockedAt !== null && now - room.blockedAt < SAVE_BLOCKED_CHECK_MS) return;
    const refusal = deps.saveRefusal(room.fileId, Math.max(size, room.refusedSize));
    if (refusal !== null) {
      room.blockedAt = now;
      for (const m of editors) {
        if (m.toldBlocked) continue;
        m.toldBlocked = true;
        sendMsg(m.ws, { t: "save-blocked", error: refusal });
      }
      return;
    }
    room.blockedAt = null;
    for (const m of room.clients) m.toldBlocked = false;
    sendMsg(target.ws, { t: "save-request" });
    room.saveAskedAt = now;
  }

  function accept(ws: WebSocket, fileId: string, user: CollabUser, role: Role): void {
    const c: Client = { ws, fileId, user, role, peer: null, presence: null, room: null, missed: 0, toldBlocked: false };
    connections.add(c);
    ws.on("message", (data) => onMessage(c, data.toString()));
    ws.on("pong", () => {
      c.missed = 0;
    });
    ws.on("close", () => {
      connections.delete(c);
      detach(c);
    });
    ws.on("error", () => ws.terminate());
  }

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = COLLAB_PATH.exec(new URL(req.url ?? "/", "http://localhost").pathname);
    if (!match) return; // another endpoint's upgrade: not ours to answer
    const fileId = decodeId(match[1]);
    if (fileId === null) return refuse(socket, "400 Bad Request");
    const user = deps.userFromRequest(req);
    if (!user) return refuse(socket, "401 Unauthorized");
    const role = deps.roleOf(fileId, user.id);
    if (!role) return refuse(socket, "403 Forbidden");
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, fileId, user, role));
  });

  const heartbeat = setInterval(() => {
    for (const c of connections) {
      if (c.ws.readyState !== WebSocket.OPEN) continue;
      if (c.missed >= MISSED_PONGS) {
        c.ws.terminate();
        continue;
      }
      c.missed++;
      c.ws.ping();
    }
  }, HEARTBEAT_MS);

  const saver = setInterval(() => {
    for (const room of rooms.values()) checkSave(room);
  }, SAVE_CHECK_MS);

  server.on("close", () => {
    clearInterval(heartbeat);
    clearInterval(saver);
    wss.close();
    for (const c of connections) c.ws.terminate();
    connections.clear();
    rooms.clear();
  });

  return {
    liveStats() {
      let people = 0;
      let together = 0;
      for (const room of rooms.values()) {
        const n = new Set([...room.clients].map((c) => c.user.id)).size;
        people += n;
        if (n > 1) together++;
      }
      return { drawings: rooms.size, people, together };
    },

    currentSeq(fileId) {
      return stateOf(fileId)?.lastSeq ?? 0;
    },

    canSavePlain(fileId) {
      const s = stateOf(fileId);
      return !s || s.lastSeq === s.savedSeq;
    },

    versionSaved(fileId, _versionId, collabSeq) {
      const room = lookup(fileId);
      if (!room) return;
      room.saveAskedAt = null;
      room.refusedSize = 0;
      const upTo = Math.min(collabSeq, room.lastSeq);
      if (upTo > room.savedSeq) {
        room.savedSeq = upTo;
        room.ops = room.ops.filter((l) => l.seq > upTo);
        room.firstUnsavedAt = room.ops.length > 0 ? room.ops[0].at : null;
        transaction(() => {
          deleteOpsUpTo.run(fileId, upTo);
          upsertHeader.run(fileId, room.lastSeq, room.savedSeq, room.firstUnsavedAt);
        });
      }
    },

    saveRefused(fileId, size) {
      const room = lookup(fileId);
      if (!room) return;
      room.refusedSize = size;
      room.saveAskedAt = null;
    },

    reset(fileId) {
      const room = lookup(fileId);
      if (!room) return 0;
      room.ops = [];
      room.savedSeq = room.lastSeq;
      room.firstUnsavedAt = null;
      room.saveAskedAt = null;
      transaction(() => {
        deleteAllOps.run(fileId);
        upsertHeader.run(fileId, room.lastSeq, room.savedSeq, null);
      });
      // everyone reloads; they leave the room and come back with a hello on the new head
      const members = [...room.clients];
      room.clients.clear();
      for (const m of members) {
        m.room = null;
        m.peer = null;
        m.presence = null;
      }
      if (rooms.get(fileId) === room) rooms.delete(fileId);
      for (const m of members) sendMsg(m.ws, { t: "reload" });
      return room.lastSeq;
    },

    broadcastComment(fileId, comment) {
      const room = rooms.get(fileId);
      if (room) broadcast(room, { t: "comment", comment });
    },

    broadcastCommentDeleted(fileId, id) {
      const room = rooms.get(fileId);
      if (room) broadcast(room, { t: "comment-deleted", id });
    },

    kick(fileId, userId) {
      // a member taken off the drawing gives back what they held; a deleted drawing holds nothing
      if (userId === undefined) deleteFileCheckouts.run(fileId);
      else deleteUserCheckouts.run(fileId, userId);
      for (const c of [...connections]) {
        if (c.fileId !== fileId || (userId !== undefined && c.user.id !== userId)) continue;
        detach(c);
        c.ws.close(4003, "removed");
      }
      if (userId !== undefined) sendCheckouts(fileId);
    },
  };
}
