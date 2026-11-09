// Checks the collaboration socket (collab.ts) over real WebSockets with two fake editors: that a
// change of several runs is taken and passed on whole, that one made against an older seq is
// rewritten past the changes since run by run, that one with a run touching a run of a change
// since is refused, that malformed runs are refused, and that an editor older than the protocol
// is turned away with 4003 "outdated".
//
// Run: cd server && node src/collab.check.ts

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { WebSocket } from "ws";
import { COLLAB_PROTOCOL, type ServerMessage, type WireOp } from "../../web/src/platform/protocol.ts";
import { attachCollab } from "./collab.ts";

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(cond: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await sleep(10);
  }
  return true;
}

const server = createServer();
attachCollab(server, {
  db: new DatabaseSync(":memory:"),
  userFromRequest: (req: IncomingMessage) => {
    const m = /(?:^|;\s*)u=(\w+)/.exec(req.headers.cookie ?? "");
    return m ? { id: m[1], name: m[1], avatarUrl: null } : null;
  },
  roleOf: () => "editor",
  head: () => ({ versionId: "v1", collabSeq: 0, size: 1000 }),
  saveRefusal: () => null,
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;

interface Editor {
  readonly ws: WebSocket;
  readonly got: ServerMessage[];
  closed: { code: number; reason: string } | null;
}

/** An editor connected and greeted; `proto` null leaves it out of hello, as editors before it did. */
async function join(user: string, proto: number | null = COLLAB_PROTOCOL): Promise<Editor> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/collab/f1`, { headers: { cookie: `u=${user}` } });
  const ed: Editor = { ws, got: [], closed: null };
  ws.on("message", (data) => ed.got.push(JSON.parse(data.toString()) as ServerMessage));
  ws.on("close", (code, reason) => (ed.closed = { code, reason: reason.toString() }));
  await new Promise<void>((resolve) => ws.on("open", () => resolve()));
  ws.send(JSON.stringify({ t: "hello", versionId: "v1", ...(proto === null ? {} : { proto }) }));
  return ed;
}

const last = <T extends ServerMessage["t"]>(ed: Editor, t: T): Extract<ServerMessage, { t: T }> | undefined =>
  ed.got.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t).at(-1);

const run = (start: number, del: number, n: number, tag: string) => ({ start, del, add: Array.from({ length: n }, (_, i) => `${tag}${i}`) });
const op = (runs: ReturnType<typeof run>[]): WireOp => ({ ...runs[0], ...(runs.length > 1 ? { more: runs.slice(1) } : {}), kind: "objects", ids: [] });

const old = await join("carol", null);
expect("an editor older than the protocol is closed with 4003 outdated", await until(() => old.closed !== null), JSON.stringify(old.closed));
expect("…with the reason", old.closed?.code === 4003 && old.closed.reason === "outdated");

const a = await join("alice");
const b = await join("bob");
expect("both editors are welcomed", await until(() => !!last(a, "welcome") && !!last(b, "welcome")));

// alice: a run near the top (a class) and one far down (objects), as an agent's step makes
a.ws.send(JSON.stringify({ t: "op", id: 1, base: 0, op: op([run(10, 1, 1, "names"), run(500, 0, 3, "obj")]) }));
expect("a change of two runs is taken", await until(() => last(a, "ack")?.id === 1));
const passed = await until(() => !!last(b, "op"));
const seen = last(b, "op")?.op;
expect("…and passed on whole", passed && seen?.start === 10 && seen.more?.length === 1 && seen.more[0].start === 500 && seen.more[0].add.length === 3);

// bob, against seq 0: a move between alice's runs, and one after them
b.ws.send(JSON.stringify({ t: "op", id: 7, base: 0, op: op([run(200, 1, 1, "m"), run(600, 1, 1, "n")]) }));
expect("a change made against an older seq is taken", await until(() => last(b, "ack")?.id === 7));
const moved = await until(() => last(a, "op")?.op.start === 200);
const fitted = last(a, "op")?.op;
// alice's runs replaced 1 by 1 at 10 and put 3 in at 500: 200 stays, 600 moves to 603
expect("…rewritten past it run by run", moved && fitted?.more?.[0].start === 603, JSON.stringify(fitted && [fitted.start, fitted.more?.[0].start]));

// bob again against seq 0: a run on alice's class record clashes, though its other run is far away
b.ws.send(JSON.stringify({ t: "op", id: 8, base: 0, op: op([run(10, 1, 1, "x"), run(900, 0, 1, "y")]) }));
expect("a run touching a run of a change since is refused", await until(() => last(b, "reject")?.id === 8));

b.ws.send(JSON.stringify({ t: "op", id: 9, base: 2, op: op([run(50, 2, 5, "p"), run(53, 0, 1, "q")]) }));
expect("runs out of order are refused", await until(() => last(b, "reject")?.id === 9) && last(b, "reject")?.reason === "invalid");

b.ws.send(JSON.stringify({ t: "op", id: 10, base: 2, op: { ...op([run(50, 0, 1, "r")]), more: [] } }));
expect("an empty more is refused", await until(() => last(b, "reject")?.id === 10));

a.ws.close();
b.ws.close();
server.close();
console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
