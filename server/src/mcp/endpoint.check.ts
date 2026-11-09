// Checks the MCP endpoint (endpoint.ts) over real HTTP and WebSockets: who may call it, both protocol
// eras on the one URL, the event stream a modern call answers on, a call reaching a fake Rodeo tab
// and its answer coming back, a cancelled call reaching the tab, Rodeo's own tools, what an agent
// is told once no tab is open, and an OAuth connection's access token standing in for a personal
// access token. Prints an ok line per check; exits 1 on any failure.
//
// Run: cd server && node src/mcp/endpoint.check.ts

import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocket } from "ws";
import type { McpTool } from "../../../web/src/features/mcp/wire.ts";

// the data folder and the public address must be chosen before config.ts reads the environment, so the server modules load late
const dir = mkdtempSync(join(tmpdir(), "mcp-endpoint-"));
process.env.DATA_DIR = dir;
process.env.PUBLIC_URL = "http://127.0.0.1";

const { config } = await import("../config.ts");
const { database, openDatabase, run } = await import("../db.ts");
const { nowIso } = await import("../util.ts");
const store = await import("./store.ts");
const { attachMcp, registerMcp } = await import("./index.ts");
const { OAUTH_SCHEMA, challengeOf, resourceOf, wwwAuthenticate } = await import("../oauth/shared.ts");
const oauth = await import("../oauth/tokens.ts");

const MODERN = "2026-07-28";
const INSTRUCTIONS = "Test tab for the endpoint check.";
const DRAWING = "Check drawing";
const TOOLS: McpTool[] = [
  { name: "echo", description: "Echoes its arguments.", inputSchema: { type: "object", properties: {} } },
  { name: "wait", description: "Never answers until cancelled.", inputSchema: { type: "object", properties: {} } },
];

/** A JSON-RPC message or reply, read loosely: the checks look at a few fields. */
interface Reply {
  readonly id?: unknown;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number; readonly message: string };
}

/** An HTTP answer, read to the end. */
interface Got {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** A fake Rodeo tab: it says hello, answers echo, never answers wait, and keeps what it was sent. */
interface FakeTab {
  readonly ws: WebSocket;
  readonly calls: { readonly id: string; readonly tool: string; readonly agent: string }[];
  readonly cancels: string[];
  readonly closed: Promise<void>;
}

let failures = 0;
let port = 0;
let secret = "";
let nextId = 1;

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

/** The auth header for the check's token. */
function auth(): Record<string, string> {
  return { authorization: `Bearer ${secret}` };
}

/** A JSON-RPC request with a fresh id. */
function rpc(method: string, params: Record<string, unknown> = {}, id = nextId++): Record<string, unknown> {
  return { jsonrpc: "2.0", id, method, params };
}

/** The _meta a modern request carries. */
function meta(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "io.modelcontextprotocol/protocolVersion": MODERN,
    "io.modelcontextprotocol/clientCapabilities": {},
    "io.modelcontextprotocol/clientInfo": { name: "check-modern", version: "1" },
    ...extra,
  };
}

/** The headers a modern request carries; the name is for tools/call. */
function modernHeaders(method: string, name?: string): Record<string, string> {
  return { ...auth(), "mcp-protocol-version": MODERN, "mcp-method": method, ...(name ? { "mcp-name": name } : {}) };
}

/** POSTs a body (an object is sent as JSON) to /mcp and reads the answer. */
async function post(body: unknown, headers: Record<string, string> = {}): Promise<Got> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/** GETs a path on the server and reads the answer. */
async function get(path: string): Promise<Got> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/** An answer's body as a JSON-RPC reply. */
function reply(got: Got): Reply {
  return JSON.parse(got.text) as Reply;
}

/** The data events of an event-stream answer, each parsed as a JSON-RPC message, in order. */
function events(got: Got): Reply[] {
  return got.text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice("data: ".length)) as Reply);
}

/** The text parts of a tool result, joined. */
function textOf(result: Record<string, unknown> | undefined): string {
  const content = (result?.content ?? []) as { type: string; text?: string }[];
  return content.map((p) => (p.type === "text" ? (p.text ?? "") : "")).join("");
}

/** The names of the tools in a tools/list answer. */
function namesOf(got: Got): string[] {
  return ((reply(got).result?.tools ?? []) as { name: string }[]).map((t) => t.name);
}

/** Opens a fake tab for alice and resolves once the relay has welcomed it. */
async function openTab(): Promise<FakeTab> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mcp/live`, { headers: { cookie: "u=alice", origin: `http://127.0.0.1:${port}` } });
  ws.on("error", () => {});
  const calls: { id: string; tool: string; agent: string }[] = [];
  const cancels: string[] = [];
  const welcomed = new Promise<void>((resolve) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as { t: string; id: string; tool: string; agent: string; args: Record<string, unknown> };
      if (m.t === "welcome") resolve();
      else if (m.t === "call") {
        calls.push({ id: m.id, tool: m.tool, agent: m.agent });
        if (m.tool === "echo") {
          ws.send(JSON.stringify({ t: "progress", id: m.id, text: "echoing" }));
          ws.send(JSON.stringify({ t: "result", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(m.args) }], isError: false } }));
        }
      } else if (m.t === "cancel") cancels.push(m.id);
    });
  });
  const closed = new Promise<void>((resolve) => ws.once("close", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(
    JSON.stringify({
      t: "hello",
      tabId: "endpoint-tab-1",
      focused: true,
      visible: true,
      drawing: { name: DRAWING, fileId: null, readOnly: false },
      tools: TOOLS,
      instructions: INSTRUCTIONS,
    }),
  );
  await welcomed;
  return { ws, calls, cancels, closed };
}

function addUser(id: string, email: string, name: string): void {
  run("INSERT INTO users (id, email, name, avatar_url, created_at, plan) VALUES (?, ?, ?, ?, ?, 'free')", id, email, name, null, nowIso());
}

let server: Server | null = null;
let tab: FakeTab | null = null;

try {
  openDatabase();
  database().exec(store.MCP_SCHEMA);
  database().exec(OAUTH_SCHEMA);
  addUser("u1", "alice@example.com", "Alice");
  secret = store.createToken("u1", "Claude Code").secret;

  const app = new Hono();
  registerMcp(app);
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }) as Server;
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
  attachMcp(server, {
    userFromRequest: (req) => (req.headers.cookie === "u=alice" ? { id: "u1", name: "Alice" } : null),
  });

  // 1. who may call
  const noAuth = await post(rpc("tools/list"));
  expect(
    "no token → 401 with the plain WWW-Authenticate challenge and the help",
    noAuth.status === 401 &&
      noAuth.headers.get("www-authenticate") === wwwAuthenticate("http://127.0.0.1", false) &&
      reply(noAuth).error?.code === -31001,
  );
  let allRefused = true;
  for (let i = 0; i < 40; i++) {
    if ((await post(rpc("tools/list"))).status !== 401) allRefused = false;
  }
  expect("40 calls with no token in a row are all 401, none limited (no token starts a sign-in)", allRefused);
  const wrong = await post(rpc("tools/list"), { authorization: `Bearer rodeo_pat_${"x".repeat(43)}` });
  expect(
    "a token that isn't one of ours → 401 with error=\"invalid_token\"",
    wrong.status === 401 && (wrong.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'),
  );
  const foreign = await post(rpc("tools/list"), { ...auth(), origin: "http://evil.test" });
  expect("a request from a foreign page's origin → 403", foreign.status === 403 && reply(foreign).error?.code === -32600);

  // the tab comes up now, so the tools and instructions exist for the calls below
  tab = await openTab();

  // 2. the 2025 protocol: initialize, then plain requests
  const init = reply(
    await post(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-legacy", version: "1" } }), auth()),
  );
  expect(
    "legacy initialize echoes the version and gives the tab's instructions",
    init.result?.protocolVersion === "2025-06-18" && init.result?.instructions === INSTRUCTIONS,
  );
  const note = await post({ jsonrpc: "2.0", method: "notifications/initialized" }, auth());
  expect("notifications/initialized is answered 202", note.status === 202);
  const legacyList = await post(rpc("tools/list"), { ...auth(), "mcp-protocol-version": "2025-06-18" });
  const names = namesOf(legacyList);
  expect("legacy tools/list has the tab's tools and Rodeo's two", ["echo", "wait", "list_drawings", "use_drawing"].every((n) => names.includes(n)), names.join(", "));

  // 3. a legacy call answered as JSON
  const legacyCall = await post(rpc("tools/call", { name: "echo", arguments: { n: 3 } }), { ...auth(), "mcp-protocol-version": "2025-06-18" });
  expect(
    "a legacy tools/call answers as JSON with the tab's result, and the tab is told the agent's name",
    legacyCall.status === 200 && legacyCall.headers.get("content-type")?.startsWith("application/json") === true && textOf(reply(legacyCall).result) === '{"n":3}' && tab.calls.at(-1)?.agent === "Claude Code",
  );

  // 4. a modern call answered as an event stream: progress first, then the result
  const modernEcho = await post(
    rpc("tools/call", { name: "echo", arguments: { n: 4 }, _meta: meta({ progressToken: "t" }) }, 4),
    { ...modernHeaders("tools/call", "echo"), accept: "application/json, text/event-stream" },
  );
  const streamed = events(modernEcho);
  const progressAt = streamed.findIndex((e) => e.method === "notifications/progress");
  const resultAt = streamed.findIndex((e) => e.id === 4);
  expect(
    "a modern tools/call answers as an event stream that cannot be buffered",
    modernEcho.headers.get("content-type")?.startsWith("text/event-stream") === true && (modernEcho.headers.get("cache-control") ?? "").includes("no-transform"),
  );
  expect(
    "the stream carries the progress (for the token) and then the result, complete",
    progressAt >= 0 && (streamed[progressAt].params as Record<string, unknown> | undefined)?.progressToken === "t" && resultAt > progressAt && streamed[resultAt].result?.resultType === "complete" && textOf(streamed[resultAt].result) === '{"n":4}',
  );

  // 5. the modern checks refuse what is wrong, and an unknown method is 404 for a modern client
  const noName = await post(rpc("tools/call", { name: "echo", arguments: {}, _meta: meta() }, 5), modernHeaders("tools/call"));
  expect("a modern call without Mcp-Name is 400 with -32020", noName.status === 400 && reply(noName).error?.code === -32020);
  const unknown = await post(rpc("nope/what", { _meta: meta() }), modernHeaders("nope/what"));
  expect("an unknown method from a modern client is 404 with -32601", unknown.status === 404 && reply(unknown).error?.code === -32601);
  const broken = await post("{not json", auth());
  expect("a message that isn't JSON is 400 with -32700", broken.status === 400 && reply(broken).error?.code === -32700);

  // 6. the server's own discovery answer
  const disc = await post(rpc("server/discover", { _meta: meta() }), modernHeaders("server/discover"));
  expect("server/discover lists the supported versions", ((reply(disc).result?.supportedVersions ?? []) as string[]).includes(MODERN));

  // 7. Rodeo's own tools
  const listed = await post(rpc("tools/call", { name: "list_drawings", arguments: {} }), auth());
  const info = JSON.parse(textOf(reply(listed).result)) as { tabs: { id: string; drawing: string | null; current: boolean }[] };
  expect("list_drawings shows the one open tab, drawing and current", info.tabs.length === 1 && info.tabs[0].current && info.tabs[0].drawing === DRAWING);
  const badUse = await post(rpc("tools/call", { name: "use_drawing", arguments: { id: "nope" } }), auth());
  expect("use_drawing with an id no tab has is a tool error", reply(badUse).result?.isError === true && textOf(reply(badUse).result).includes("No open Rodeo tab has the id nope"));

  // 8. a call the client gives up on reaches the tab as a cancel
  const cancelling = new AbortController();
  const waiting = fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", ...modernHeaders("tools/call", "wait"), accept: "application/json, text/event-stream" },
    body: JSON.stringify(rpc("tools/call", { name: "wait", arguments: {}, _meta: meta() }, 8)),
    signal: cancelling.signal,
  })
    .then((r) => r.text())
    .catch(() => "aborted");
  const waitCalled = await until(() => tab?.calls.some((c) => c.tool === "wait") === true);
  await sleep(200);
  cancelling.abort();
  await waiting;
  const waitId = tab.calls.find((c) => c.tool === "wait")?.id;
  const cancelled = await until(() => waitId !== undefined && tab?.cancels.includes(waitId) === true);
  expect("a call the client abandons reaches the tab as a cancel", waitCalled && cancelled);

  // 9. what a GET gets, and the OAuth discovery paths (the oauth module answers those, not this one)
  const getMcp = await get("/mcp");
  expect("GET /mcp is 405 and says POST", getMcp.status === 405 && getMcp.headers.get("allow") === "POST");
  const probe = await get("/.well-known/oauth-authorization-server");
  expect("this feature no longer answers OAuth discovery (404)", probe.status === 404);

  // an OAuth connection: its access token calls the tab like a personal access token, under the app's name
  const appVerifier = "w".repeat(43);
  const appClient = `rodeo_dcr_${"C".repeat(22)}`;
  const appRedirect = "http://127.0.0.1/cb";
  const resource = resourceOf(config.publicUrl);
  const appCode = oauth.createCode({
    userId: "u1",
    clientId: appClient,
    clientName: "Endpoint Check App",
    redirectUri: appRedirect,
    challenge: challengeOf(appVerifier),
    resource,
  });
  const appGrant = oauth.redeemCode({ code: appCode, clientId: appClient, redirectUri: appRedirect, verifier: appVerifier, resource });
  if (!appGrant.ok) throw new Error(`the connection was refused: ${appGrant.description}`);
  const appAuth = { authorization: `Bearer ${appGrant.pair.access_token}` };

  expect("an OAuth access token lists the tab's tools", namesOf(await post(rpc("tools/list"), appAuth)).includes("echo"));
  const appEcho = reply(await post(rpc("tools/call", { name: "echo", arguments: { n: 9 } }), appAuth));
  expect(
    "a call with it reaches the tab, which is told the app's name",
    textOf(appEcho.result) === '{"n":9}' && tab.calls.at(-1)?.agent === "Endpoint Check App",
  );
  const connection = oauth.listGrants("u1").find((g) => g.id === appGrant.grantId);
  expect("the connection's last use is recorded", typeof connection?.lastUsedAt === "string");

  run("UPDATE oauth_tokens SET expires_at = ? WHERE grant_id = ? AND kind = 'access'", "2000-01-01T00:00:00.000Z", appGrant.grantId);
  const expiredApp = await post(rpc("tools/call", { name: "echo", arguments: { n: 10 } }), appAuth);
  expect(
    "an expired access token → 401 with error=\"invalid_token\"",
    expiredApp.status === 401 && (expiredApp.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'),
  );

  // 10. the tab goes: its tools are still offered, and a call says no tab is open
  tab.ws.close();
  await tab.closed;
  let noTab = false;
  for (let i = 0; i < 40 && !noTab; i++) {
    noTab = textOf(reply(await post(rpc("tools/call", { name: "list_drawings", arguments: {} }), auth())).result).startsWith("No Rodeo tab is open");
    if (!noTab) await sleep(50);
  }
  expect("with the tab closed, list_drawings says no tab is open", noTab);
  const echoNoTab = reply(await post(rpc("tools/call", { name: "echo", arguments: { n: 10 } }), auth()));
  expect("with no tab open, a call is a tool error that says so", echoNoTab.result?.isError === true && textOf(echoNoTab.result).startsWith("No Rodeo tab is open"));
  expect("tools/list still offers the tab's tools once it has gone", namesOf(await post(rpc("tools/list"), auth())).includes("echo"));

  // 11. the last use is recorded against the token
  const [row] = store.listTokens("u1");
  expect("the token's last use is recorded", typeof row?.lastUsedAt === "string" && row.lastClient !== null);
} catch (err) {
  failures++;
  console.log(`FAIL the check stopped: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
} finally {
  tab?.ws.close();
  if (server) {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
      server?.closeAllConnections();
    });
  }
  database().close();
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all good");
