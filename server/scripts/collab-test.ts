// Tests for server/src/collab.ts: node scripts/collab-test.ts
// Real servers on loopback ports, an in-memory database, and ws clients that
// check the protocol from the outside.

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { attachCollab, type CollabDeps, type CollabHub, type CollabUser } from "../src/collab.ts";
import {
  BIG_DRAWING,
  PEER_COLORS,
  SAVE_EVERY_OPS,
  type ClientMessage,
  type Comment,
  type Presence,
  type Role,
  type ServerMessage,
  type WireOp,
} from "../../web/src/platform/protocol.ts";

type Msg<T extends ServerMessage["t"]> = Extract<ServerMessage, { t: T }>;
interface Head {
  versionId: string;
  collabSeq: number;
  size: number;
}

const N = SAVE_EVERY_OPS;
const conns: Conn[] = [];
const servers: Server[] = [];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A ws client that reads server messages in order. */
class Conn {
  readonly ws: WebSocket;
  readonly name: string;
  readonly closed: Promise<number>;
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: Array<(m: ServerMessage) => void> = [];

  constructor(ws: WebSocket, name: string) {
    this.ws = ws;
    this.name = name;
    ws.on("message", (data) => {
      const m = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(m);
      else this.queue.push(m);
    });
    ws.on("error", () => {});
    this.closed = new Promise((resolve) => ws.on("close", (code) => resolve(code)));
  }

  send(m: ClientMessage): void {
    this.ws.send(JSON.stringify(m));
  }

  private next(): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const waiter = (m: ServerMessage) => {
        clearTimeout(timer);
        resolve(m);
      };
      const timer = setTimeout(() => {
        const i = this.waiters.indexOf(waiter);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`${this.name}: timed out waiting for a message`));
      }, 2000);
      this.waiters.push(waiter);
    });
  }

  /** The next message, which must have type t. */
  async take<T extends ServerMessage["t"]>(t: T): Promise<Msg<T>> {
    const m = await this.next();
    assert.equal(m.t, t, `${this.name}: expected ${t}, got ${JSON.stringify(m)}`);
    return m as Msg<T>;
  }

  /** No message arrives for a moment. */
  async quiet(): Promise<void> {
    await sleep(60);
    assert.equal(this.queue.length, 0, `${this.name}: unexpected ${JSON.stringify(this.queue[0])}`);
  }

  leave(): Promise<number> {
    this.ws.close();
    return this.closed;
  }
}

function open(port: number, name: string, user: string, fileId = "f1"): Promise<Conn> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/collab/${fileId}?user=${user}`);
    ws.once("open", () => {
      const conn = new Conn(ws, name);
      conns.push(conn);
      resolve(conn);
    });
    ws.once("error", reject);
  });
}

/** The HTTP status an upgrade attempt gets (101 when it opens). */
function upgradeStatus(port: number, path: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
    ws.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on("open", () => {
      resolve(101);
      ws.terminate();
    });
    ws.on("error", () => {});
  });
}

async function start(deps: CollabDeps): Promise<{ server: Server; hub: CollabHub; port: number }> {
  const server = createServer();
  const hub = attachCollab(server, deps);
  // another endpoint's upgrade must reach its own listener, untouched
  server.on("upgrade", (req, socket) => {
    if (req.url?.startsWith("/other")) socket.end("HTTP/1.1 418 I'm a teapot\r\nConnection: close\r\n\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return { server, hub, port: (server.address() as AddressInfo).port };
}

function stop(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

function makeDeps(db: DatabaseSync, head: Head, refusal?: { why: string | null; sizes: number[] }): CollabDeps {
  return {
    db,
    userFromRequest(req): CollabUser | null {
      const id = new URL(req.url ?? "/", "http://localhost").searchParams.get("user");
      return id ? { id, name: `User ${id}`, avatarUrl: null } : null;
    },
    roleOf(_fileId, userId): Role | null {
      if (userId === "a" || userId === "b") return "editor";
      if (userId === "v") return "viewer";
      return null;
    },
    head(fileId) {
      return fileId === "f1" ? head : null;
    },
    saveRefusal(_fileId, size) {
      refusal?.sizes.push(size);
      return refusal?.why ?? null;
    },
  };
}

function insertOp(start: number, del: number, add: string[], ids: string[]): WireOp {
  return { start, del, add, kind: "objects", ids };
}

function countOps(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM collab_ops").get() as { n: number }).n;
}

async function main(): Promise<void> {
  const db = new DatabaseSync(":memory:");
  const head: Head = { versionId: "v1", collabSeq: 0, size: 1000 };
  let h = await start(makeDeps(db, head));

  // refused upgrades: signed out, not a member; another path is left alone
  assert.equal(await upgradeStatus(h.port, "/api/collab/f1"), 401);
  assert.equal(await upgradeStatus(h.port, "/api/collab/f1?user=x"), 403);
  assert.equal(await upgradeStatus(h.port, "/other?user=a"), 418);

  // malformed JSON, ping, and an op before hello (ignored)
  const a = await open(h.port, "a", "a");
  a.ws.send("{not json");
  assert.equal((await a.take("error")).error, "malformed JSON");
  a.send({ t: "ping" });
  await a.take("pong");
  a.send({ t: "op", id: 0, base: 0, op: insertOp(0, 0, ["AAAA"], ["o0"]) });
  await a.quiet();

  // welcome, join, leave
  a.send({ t: "hello", versionId: "v1" });
  const welcomeA = await a.take("welcome");
  assert.equal(welcomeA.you.userId, "a");
  assert.equal(welcomeA.you.role, "editor");
  assert.equal(welcomeA.you.color, PEER_COLORS[0]);
  assert.deepEqual(welcomeA.peers, []);
  assert.equal(welcomeA.seq, 0);
  assert.deepEqual(welcomeA.ops, []);

  const b = await open(h.port, "b", "b");
  b.send({ t: "hello", versionId: "v1" });
  const welcomeB = await b.take("welcome");
  assert.deepEqual(
    welcomeB.peers.map((p) => p.userId),
    ["a"],
  );
  assert.equal(welcomeB.you.color, PEER_COLORS[1]);
  assert.equal((await a.take("join")).peer.clientId, welcomeB.you.clientId);
  await b.quiet();

  const v1 = await open(h.port, "v1", "v");
  v1.send({ t: "hello", versionId: "v1" });
  const welcomeV1 = await v1.take("welcome");
  assert.equal(welcomeV1.you.role, "viewer");
  assert.equal(welcomeV1.you.color, PEER_COLORS[2]);
  await a.take("join");
  await b.take("join");
  await v1.leave();
  assert.equal((await a.take("leave")).clientId, welcomeV1.you.clientId);
  assert.equal((await b.take("leave")).clientId, welcomeV1.you.clientId);

  const v = await open(h.port, "v", "v");
  v.send({ t: "hello", versionId: "v1" });
  const welcomeV = await v.take("welcome");
  assert.equal(welcomeV.you.color, PEER_COLORS[2]);
  assert.deepEqual(
    welcomeV.peers.map((p) => p.userId),
    ["a", "b"],
  );
  await a.take("join");
  await b.take("join");

  // an op is acked to its sender and broadcast to the others only
  const five = ["AAAA", "BBBB", "CCCC", "DDDD", "EEEE"];
  a.send({ t: "op", id: 1, base: 0, op: insertOp(0, 0, five, ["o1", "o2", "o3", "o4", "o5"]) });
  assert.deepEqual(await a.take("ack"), { t: "ack", id: 1, seq: 1 });
  const b1 = await b.take("op");
  assert.equal(b1.seq, 1);
  assert.equal(b1.clientId, welcomeA.you.clientId);
  assert.deepEqual(b1.op, insertOp(0, 0, five, ["o1", "o2", "o3", "o4", "o5"]));
  assert.equal((await v.take("op")).seq, 1);
  await a.quiet();

  // two changes made against seq 1 on disjoint records: the second is shifted past the first
  a.send({ t: "op", id: 2, base: 1, op: insertOp(0, 1, ["X1", "X2"], ["x1", "x2"]) });
  assert.deepEqual(await a.take("ack"), { t: "ack", id: 2, seq: 2 });
  b.send({ t: "op", id: 2, base: 1, op: insertOp(3, 1, ["Z"], ["z"]) });
  const bX = await b.take("op");
  assert.equal(bX.seq, 2);
  assert.equal(bX.op.start, 0);
  assert.deepEqual(await b.take("ack"), { t: "ack", id: 2, seq: 3 });
  const aY = await a.take("op");
  assert.equal(aY.seq, 3);
  assert.equal(aY.op.start, 4);
  assert.equal(aY.op.del, 1);
  assert.deepEqual(aY.op.add, ["Z"]);
  assert.equal((await v.take("op")).seq, 2);
  const vY = await v.take("op");
  assert.equal(vY.seq, 3);
  assert.equal(vY.op.start, 4);

  // a change against seq 1 that overlaps X's records is refused
  b.send({ t: "op", id: 3, base: 1, op: insertOp(0, 1, ["W"], ["w"]) });
  assert.deepEqual(await b.take("reject"), { t: "reject", id: 3, reason: "conflict" });
  await a.quiet();
  await v.quiet();

  // viewers can't change anything
  v.send({ t: "op", id: 9, base: 3, op: insertOp(0, 0, ["V"], ["v"]) });
  assert.deepEqual(await v.take("reject"), { t: "reject", id: 9, reason: "view only" });
  await a.quiet();
  await b.quiet();

  // presence is relayed to the others
  const pres: Presence = {
    mode: "2d",
    layerId: "L1",
    cursor: { x: 10, y: 20 },
    selection: ["o1"],
    view: { cx: 0, cy: 0, scale: 2 },
    camera: null,
    pointer3d: null,
  };
  a.send({ t: "presence", p: pres });
  const pB = await b.take("presence");
  assert.equal(pB.clientId, welcomeA.you.clientId);
  assert.deepEqual(pB.p, pres);
  assert.equal((await v.take("presence")).clientId, welcomeA.you.clientId);
  await a.quiet();

  // changes pile up; at SAVE_EVERY_OPS one editor is asked to save, the latest sender first. A big
  // drawing isn't asked then: it waits SAVE_BIG_EVERY_MS, however many changes
  head.size = BIG_DRAWING + 1;
  let seq = 3;
  while (seq < N) {
    a.send({ t: "op", id: 100 + seq, base: seq, op: insertOp(0, 0, [`n${seq}`], [`s${seq}`]) });
    const ack = await a.take("ack");
    assert.equal(ack.seq, seq + 1);
    seq = ack.seq;
    await b.take("op");
    await v.take("op");
  }
  await a.quiet();
  head.size = 1000;
  // the next round of checks (every 10 s) asks
  await sleep(10_500);
  assert.deepEqual(await a.take("save-request"), { t: "save-request" });
  await b.quiet();
  await v.quiet();

  // no second request while the first is unanswered
  a.send({ t: "op", id: 999, base: N, op: insertOp(0, 0, ["late"], ["late"]) });
  assert.deepEqual(await a.take("ack"), { t: "ack", id: 999, seq: N + 1 });
  await a.quiet();
  await b.take("op");
  await v.take("op");

  // a version holding changes up to N is saved: they leave the log, the last one stays
  head.versionId = "v2";
  head.collabSeq = N;
  h.hub.versionSaved("f1", "v2", N);
  assert.equal(h.hub.currentSeq("f1"), N + 1);
  assert.equal(h.hub.canSavePlain("f1"), false);
  assert.equal(countOps(db), 1);

  // a change made against a dropped seq is refused as stale; a malformed one as invalid
  a.send({ t: "op", id: 5, base: 0, op: insertOp(0, 0, ["old"], ["old"]) });
  assert.deepEqual(await a.take("reject"), { t: "reject", id: 5, reason: "stale" });
  a.send({ t: "op", id: 6, base: N + 1, op: { ...insertOp(0, 0, [], []), start: -1 } });
  assert.deepEqual(await a.take("reject"), { t: "reject", id: 6, reason: "invalid" });
  await a.quiet();
  await b.quiet();
  await v.quiet();

  // a late joiner on the new head gets only the later change, with who is there and presence
  const late = await open(h.port, "late", "b");
  late.send({ t: "hello", versionId: "v2" });
  const welcomeL = await late.take("welcome");
  assert.equal(welcomeL.seq, N + 1);
  assert.deepEqual(
    welcomeL.ops.map((o) => o.seq),
    [N + 1],
  );
  assert.deepEqual(welcomeL.ops[0].op, insertOp(0, 0, ["late"], ["late"]));
  assert.equal(welcomeL.you.color, PEER_COLORS[3]);
  assert.deepEqual(welcomeL.presence, { [welcomeA.you.clientId]: pres });
  assert.deepEqual(welcomeL.peers.map((p) => p.userId).sort(), ["a", "b", "v"]);
  await a.take("join");
  await b.take("join");
  await v.take("join");

  // a client holding an old version is told to reload and is not let into the room
  const stale = await open(h.port, "stale", "a");
  stale.send({ t: "hello", versionId: "v1" });
  await stale.take("reload");
  stale.send({ t: "op", id: 1, base: N + 1, op: insertOp(0, 0, ["s"], ["s"]) });
  await stale.quiet();
  await a.quiet();
  await b.quiet();
  await v.quiet();

  // restart: a new hub on the same database still has the changes
  await Promise.all([a, b, v, late, stale].map((c) => c.leave()));
  await stop(h.server);
  h = await start(makeDeps(db, head));
  assert.equal(h.hub.currentSeq("f1"), N + 1);
  assert.equal(h.hub.canSavePlain("f1"), false);
  const a2 = await open(h.port, "a2", "a");
  a2.send({ t: "hello", versionId: "v2" });
  const welcomeA2 = await a2.take("welcome");
  assert.equal(welcomeA2.seq, N + 1);
  assert.deepEqual(
    welcomeA2.ops.map((o) => o.seq),
    [N + 1],
  );

  // comments reach the room
  const b2 = await open(h.port, "b2", "b");
  b2.send({ t: "hello", versionId: "v2" });
  const welcomeB2 = await b2.take("welcome");
  assert.equal((await a2.take("join")).peer.clientId, welcomeB2.you.clientId);
  const comment: Comment = {
    id: "c1",
    fileId: "f1",
    parentId: null,
    authorId: "b",
    authorName: "User b",
    createdAt: "2026-10-30T00:00:00.000Z",
    body: "check this",
    anchor: null,
    strokes: [],
    audio: null,
    resolved: false,
  };
  h.hub.broadcastComment("f1", comment);
  assert.deepEqual((await a2.take("comment")).comment, comment);
  assert.deepEqual((await b2.take("comment")).comment, comment);
  h.hub.broadcastCommentDeleted("f1", "c1");
  assert.equal((await a2.take("comment-deleted")).id, "c1");
  assert.equal((await b2.take("comment-deleted")).id, "c1");

  // a reset reloads everyone; they hello again on the new head and carry on
  const after = h.hub.reset("f1", (seq) => {
    head.versionId = "v3";
    head.collabSeq = seq;
    return seq;
  });
  assert.equal(after, N + 1);
  await a2.take("reload");
  await b2.take("reload");
  assert.equal(countOps(db), 0);
  assert.equal(h.hub.canSavePlain("f1"), true);
  a2.send({ t: "hello", versionId: "v3" });
  const welcomeR = await a2.take("welcome");
  assert.equal(welcomeR.seq, N + 1);
  assert.deepEqual(welcomeR.ops, []);
  b2.send({ t: "hello", versionId: "v3" });
  const welcomeB3 = await b2.take("welcome");
  assert.deepEqual(
    welcomeB3.peers.map((p) => p.userId),
    ["a"],
  );
  assert.equal((await a2.take("join")).peer.userId, "b");
  a2.send({ t: "op", id: 1, base: after, op: insertOp(0, 0, ["after"], ["after"]) });
  assert.deepEqual(await a2.take("ack"), { t: "ack", id: 1, seq: N + 2 });
  assert.equal((await b2.take("op")).seq, N + 2);

  // kick: one user, then everyone
  h.hub.kick("f1", "b");
  assert.equal(await b2.closed, 4003);
  assert.equal((await a2.take("leave")).clientId, welcomeB3.you.clientId);
  h.hub.kick("f1");
  assert.equal(await a2.closed, 4003);

  await stop(h.server);
  db.close();

  // a save the owner's plan has no room for isn't asked for: the editors hear why, once
  const db2 = new DatabaseSync(":memory:");
  const head2: Head = { versionId: "v1", collabSeq: 0, size: 1000 };
  const refusal: { why: string | null; sizes: number[] } = { why: "No room on the plan", sizes: [] };
  const h2 = await start(makeDeps(db2, head2, refusal));
  const a3 = await open(h2.port, "a3", "a");
  a3.send({ t: "hello", versionId: "v1" });
  await a3.take("welcome");
  const v2 = await open(h2.port, "v2", "v");
  v2.send({ t: "hello", versionId: "v1" });
  await v2.take("welcome");
  await a3.take("join");
  const change = async (s: number): Promise<void> => {
    a3.send({ t: "op", id: s, base: s, op: insertOp(0, 0, [`n${s}`], [`s${s}`]) });
    assert.equal((await a3.take("ack")).seq, s + 1);
    await v2.take("op");
  };
  for (let s = 0; s < N; s++) await change(s);
  assert.deepEqual(await a3.take("save-blocked"), { t: "save-blocked", error: "No room on the plan" });
  await a3.quiet();
  await v2.quiet();
  assert.deepEqual(refusal.sizes, [1000], "it asks about the drawing's size");
  await sleep(5100);
  await change(N);
  await a3.quiet(); // not told twice, nor asked
  // a save was refused at its real size: that is the size to find room for
  h2.hub.saveRefused("f1", 5000);
  await sleep(5100);
  await change(N + 1);
  await a3.quiet();
  assert.equal(refusal.sizes.at(-1), 5000);
  // room is made: the next round of checks (every 10 s) asks
  refusal.why = null;
  await sleep(10_500);
  assert.deepEqual(await a3.take("save-request"), { t: "save-request" });
  head2.versionId = "v2";
  head2.collabSeq = N + 2;
  h2.hub.versionSaved("f1", "v2", N + 2);
  a3.ws.terminate();
  v2.ws.terminate();
  await stop(h2.server);
  db2.close();
}

main().then(
  () => console.log("collab tests passed"),
  (err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  },
).finally(() => {
  // a failed run must not hang on open sockets or listening servers
  if (process.exitCode) {
    for (const c of conns) c.ws.terminate();
    for (const s of servers) if (s.listening) s.close();
    setTimeout(() => process.exit(1), 1000).unref();
  }
});
