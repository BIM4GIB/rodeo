// Checks the live relay (relay.ts) over real WebSockets, with fake tabs: who may connect, that a
// call reaches the user's tab and its answer comes back, that a timeout or a cancel reaches the
// tab, that pins and focus choose the tab, that a tab going takes its calls with it, and that the
// tools a user's tabs offered survive every tab closing.
//
// Run: cd server && node src/mcp/relay.check.ts

import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import type { McpCallResult, McpTool } from "../../../web/src/features/mcp/wire.ts";
import { attachRelay, type RelayUser } from "./relay.ts";

const SITE = "https://rodeo.build";
const ORIGIN = "http://test.local";
const USERS: Record<string, RelayUser | undefined> = {
  alice: { id: "alice", name: "Alice" },
  bob: { id: "bob", name: "Bob" },
};
const TOOLS = [
  { name: "echo", description: "Echoes its arguments.", inputSchema: { type: "object" } },
  { name: "slow", description: "Never answers.", inputSchema: { type: "object" } },
];
const INSTRUCTIONS = "Test tab.";

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits until cond holds, up to ms; false when it never did. */
async function until(cond: () => boolean, ms = 2000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) return false;
    await sleep(10);
  }
  return true;
}

function textOf(r: McpCallResult): string {
  return r.content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** The tools and instructions the relay saved, per account (the loadTools side of the check). */
const saved = new Map<string, { tools: readonly McpTool[]; instructions: string }>();

const server = createServer();
const relay = attachRelay(server, {
  userFromRequest: (req: IncomingMessage) => {
    const m = /(?:^|;\s*)u=(\w+)/.exec(req.headers.cookie ?? "");
    return m ? (USERS[m[1]] ?? null) : null;
  },
  allowedOrigin: (origin) => origin === ORIGIN,
  siteUrl: SITE,
  saveTools: (userId, tools, instructions) => {
    saved.set(userId, { tools, instructions });
  },
  loadTools: (userId) => saved.get(userId) ?? null,
  timeout: (tool) => (tool === "slow" ? 300 : 5000),
});

interface Call {
  readonly id: string;
  readonly tool: string;
}

/** A fake tab: a socket that says hello, answers echo, ignores slow, and keeps what it was sent. */
interface FakeTab {
  readonly tabId: string;
  readonly ws: WebSocket;
  readonly calls: Call[];
  readonly cancels: string[];
  /** the close code, once the socket has closed */
  readonly closed: Promise<number>;
}

/** Opens a socket to the relay with these headers, and reports its close code when it closes. */
function connect(port: number, headers: Record<string, string>): { ws: WebSocket; closed: Promise<number> } {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mcp/live`, { headers });
  // refused upgrades and bad hellos also report here; the checks read the outcome instead
  ws.on("error", () => {});
  const closed = new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
  return { ws, closed };
}

/** Opens a fake tab for alice (or whoever the cookie names) and resolves once the relay has welcomed it. */
async function openTab(port: number, cookie: string, tabId: string, focused: boolean): Promise<FakeTab> {
  const { ws, closed } = connect(port, { origin: ORIGIN, cookie });
  const calls: Call[] = [];
  const cancels: string[] = [];
  const welcomed = new Promise<void>((resolve) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as { t: string; id: string; tool: string; args: unknown };
      if (m.t === "welcome") resolve();
      else if (m.t === "call") {
        calls.push({ id: m.id, tool: m.tool });
        if (m.tool === "echo") {
          ws.send(JSON.stringify({ t: "progress", id: m.id, text: "echoing" }));
          ws.send(JSON.stringify({ t: "result", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(m.args) }], isError: false } }));
        }
      } else if (m.t === "cancel") cancels.push(m.id);
    });
  });
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  ws.send(
    JSON.stringify({
      t: "hello",
      tabId,
      focused,
      visible: true,
      drawing: { name: "Test drawing", fileId: null, readOnly: false },
      tools: TOOLS,
      instructions: INSTRUCTIONS,
    }),
  );
  await welcomed;
  return { tabId, ws, calls, cancels, closed };
}

/** The status an upgrade is refused with, or 200 when it opens. */
function upgradeStatus(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mcp/live`, { headers });
    ws.on("error", () => {});
    ws.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on("open", () => {
      resolve(200);
      ws.close();
    });
  });
}

/** An agent's call of one tool, from alice's token "tok-a" unless told otherwise. */
function callFor(tool: string, args: Record<string, unknown>, opts: { userId?: string; tokenId?: string; signal?: AbortSignal; lines?: string[] } = {}) {
  return relay.call({
    userId: opts.userId ?? "alice",
    tokenId: opts.tokenId ?? "tok-a",
    agent: "check",
    tool,
    args,
    signal: opts.signal ?? new AbortController().signal,
    progress: (text) => opts.lines?.push(text),
  });
}

async function main(): Promise<void> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  const alice = "u=alice";
  const tabs: FakeTab[] = [];

  // 1. who may connect
  expect("no cookie: the upgrade is refused with 401", (await upgradeStatus(port, { origin: ORIGIN })) === 401);
  expect("a foreign origin: the upgrade is refused with 403", (await upgradeStatus(port, { origin: "http://evil.test", cookie: alice })) === 403);

  // 2. a call reaches the tab, and its progress and result come back
  const t1 = await openTab(port, alice, "tab-one-1", true);
  tabs.push(t1);
  const lines: string[] = [];
  const echoed = await callFor("echo", { hello: "world" }, { lines });
  expect("a call reaches the tab and its result comes back", !echoed.isError && textOf(echoed) === JSON.stringify({ hello: "world" }));
  expect("progress from the tab reaches the caller", lines.includes("echoing"));

  // 3. a call past its time limit is stopped, and the tab is told
  const timedOut = await callFor("slow", {});
  const slowId = t1.calls.at(-1)?.id ?? "";
  expect("a call past its time limit answers with a timeout", timedOut.isError && textOf(timedOut).includes("didn't finish slow"));
  expect("the tab is told to cancel the timed-out call", await until(() => t1.cancels.includes(slowId)));

  // 4. the agent cancels a call: CANCELLED, and the tab is told
  const ac = new AbortController();
  const before = t1.calls.length;
  const aborted = callFor("slow", {}, { signal: ac.signal });
  await until(() => t1.calls.length > before);
  const abortedId = t1.calls.at(-1)?.id ?? "";
  ac.abort();
  const cancelled = await aborted;
  expect("an aborted call answers CANCELLED", cancelled.isError && textOf(cancelled) === "The call was cancelled.");
  expect("the tab is told to cancel the aborted call", await until(() => t1.cancels.includes(abortedId)));

  // 5. focus picks the tab; a pin overrides it; a tab going clears its pin
  await sleep(5);
  const t2 = await openTab(port, alice, "tab-two-2", true);
  tabs.push(t2);
  expect("the most recently focused tab takes the calls", relay.current("alice", "tok-a")?.tabId === "tab-two-2");
  expect("a pin sends the calls to its tab", relay.pin("alice", "tok-a", "tab-one-1") && relay.current("alice", "tok-a")?.tabId === "tab-one-1");
  const beforeLost = t1.calls.length;
  const pending = callFor("slow", {});
  await until(() => t1.calls.length > beforeLost);
  t1.ws.close();
  const lost = await pending;
  expect("a tab that goes takes its pending call with it", lost.isError && textOf(lost).includes("lost its connection while slow ran"));
  await until(() => relay.tabs("alice").every((t) => t.tabId !== "tab-one-1"));
  const t1again = await openTab(port, alice, "tab-one-1", false);
  tabs.push(t1again);
  expect("a pin cleared by its tab going does not come back with the tab", relay.current("alice", "tok-a")?.tabId === "tab-two-2");

  // 6. an account with no tab
  const bob = await callFor("echo", {}, { userId: "bob", tokenId: "tok-b" });
  expect("an account with no tab is told to open Rodeo", bob.isError && textOf(bob).includes(SITE));

  // 7. the same tab id again replaces the old socket
  const t2again = await openTab(port, alice, "tab-two-2", false);
  tabs.push(t2again);
  expect("the same tab id again closes the old socket with 4000", (await t2.closed) === 4000);

  // 8. a bad hello is refused
  const bad = connect(port, { origin: ORIGIN, cookie: alice });
  bad.ws.once("open", () =>
    bad.ws.send(
      JSON.stringify({
        t: "hello",
        tabId: "tab-bad-3",
        focused: true,
        visible: true,
        drawing: null,
        tools: [{ name: "bad name!", description: "Not a tool name.", inputSchema: { type: "object" } }],
        instructions: "",
      }),
    ),
  );
  expect("a bad hello closes the socket with 1008", (await bad.closed) === 1008);

  // 9. the tools survive every tab closing
  for (const t of [t1again, t2again]) t.ws.close();
  await until(() => relay.tabs("alice").length === 0);
  const offer = relay.tools("alice");
  expect("the tools survive every tab closing", offer?.tools[0]?.name === "echo" && offer.instructions === INSTRUCTIONS);

  for (const t of tabs) t.ws.terminate();
  relay.close();
  server.close();
  console.log(failures ? `${failures} check${failures === 1 ? "" : "s"} failed` : "all relay checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
