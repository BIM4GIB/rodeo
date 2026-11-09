// The live agent relay: the server's half of /api/mcp/live. A Rodeo tab connects with its session
// cookie and says which tools it offers (hello). An agent's tool call (endpoint.ts) goes to the
// user's current tab, and the tab's result comes back to the agent. The tab runs the tools itself
// (web/src/features/mcp/bridge.ts), so the drawing never passes through the server. The one thing
// kept in the database is the list of tools a tab offers, so an agent that connects while no tab
// is open still sees them.

import { randomUUID } from "node:crypto";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { CLOSE_REPLACED, CLOSE_TOO_MANY, LIVE_PATH } from "../../../web/src/features/mcp/wire.ts";
import type { McpCallResult, McpContent, McpTool, RelayMessage, TabDrawing, TabMessage } from "../../../web/src/features/mcp/wire.ts";

/** The account a tab's session cookie belongs to. */
export interface RelayUser {
  readonly id: string;
  readonly name: string;
}

/** What the relay needs from the rest of the server. */
export interface RelayDeps {
  userFromRequest(req: IncomingMessage): RelayUser | null;
  allowedOrigin(origin: string | undefined, host: string | undefined): boolean;
  /** the site's address, for the messages agents read */
  readonly siteUrl: string;
  saveTools(userId: string, tools: readonly McpTool[], instructions: string): void;
  loadTools(userId: string): { readonly tools: readonly McpTool[]; readonly instructions: string } | null;
  /** a call's time limit; timeoutFor when left out (checks pass a short one) */
  timeout?(tool: string, args: Record<string, unknown>): number;
}

/** One of a user's open tabs. */
export interface TabInfo {
  readonly tabId: string;
  readonly drawing: TabDrawing | null;
  readonly focusedAt: number;
  readonly connectedAt: number;
  readonly visible: boolean;
}

/** A tool call from an agent, to be run in the user's tab. */
export interface RelayCall {
  readonly userId: string;
  readonly tokenId: string;
  /** the token's name, shown in the editor's pill */
  readonly agent: string;
  readonly tool: string;
  readonly args: Record<string, unknown>;
  readonly signal: AbortSignal;
  progress(text: string): void;
}

/** The relay as the endpoint and the Connect an Agent dialog use it. */
export interface Relay {
  call(c: RelayCall): Promise<McpCallResult>;
  /** the user's open tabs, most recently focused first */
  tabs(userId: string): TabInfo[];
  /** the tab a token's calls go to now */
  current(userId: string, tokenId: string): TabInfo | null;
  /** sends a token's calls to this tab until it closes (null: back to the most recently focused); false when the user has no such tab */
  pin(userId: string, tokenId: string, tabId: string | null): boolean;
  /** the tools the user's tabs offer, live or as last kept */
  tools(userId: string): { readonly tools: readonly McpTool[]; readonly instructions: string } | null;
  close(): void;
}

/** A call's time limit, from its tool and arguments: the slow tools get minutes, a render as long as it takes. */
export function timeoutFor(tool: string, args: Record<string, unknown>): number {
  const n = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
  if (tool === "render") return args.engine === "pathtraced" ? Math.min(30, Math.max(1, n(args.minutes, 3))) * 60_000 + 120_000 : 300_000;
  if (tool === "run_script") return Math.min(600, Math.max(1, n(args.seconds, 120))) * 1000 + 30_000;
  return LONG_TOOLS.has(tool) ? 300_000 : 120_000;
}

/** Attaches the relay to the server's upgrade requests for /api/mcp/live and returns it. */
export function attachRelay(server: Server, deps: RelayDeps): Relay {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  /** each account's open tabs, by tab id */
  const users = new Map<string, Map<string, Tab>>();
  /** the tools each account's open tabs offer, while one is open */
  const live = new Map<string, Offer>();
  /** the tools last saved per account, as JSON, so a hello that changes nothing writes nothing */
  const saved = new Map<string, string>();
  /** the calls the tabs are running, by call id */
  const calls = new Map<string, Pending>();
  /** the tab each token's calls go to, while it is open */
  const pins = new Map<string, { readonly userId: string; readonly tabId: string }>();
  /** every socket still connected, including those that have not said hello */
  const sockets = new Set<WebSocket>();

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== LIVE_PATH) return; // another endpoint's upgrade
    // the origin check stops a foreign page posing as the user's tab (cross-site socket hijacking)
    if (!deps.allowedOrigin(req.headers.origin, req.headers.host)) return refuse(socket, "403 Forbidden");
    const user = deps.userFromRequest(req);
    if (!user) return refuse(socket, "401 Unauthorized");
    wss.handleUpgrade(req, socket, head, (ws) => accept(ws, user));
  });

  const heartbeat = setInterval(() => {
    for (const map of users.values()) {
      for (const tab of map.values()) {
        if (tab.ws.readyState !== WebSocket.OPEN) continue;
        if (tab.missed >= MISSED_PONGS) {
          tab.ws.terminate();
          continue;
        }
        tab.missed++;
        tab.ws.ping();
      }
    }
  }, HEARTBEAT_MS);

  /** Runs one socket: its hello makes it a tab, and each message after that belongs to the tab. */
  function accept(ws: WebSocket, user: RelayUser): void {
    sockets.add(ws);
    let tab: Tab | null = null;
    // a socket that never says hello is not a tab, so it can't hold one of the account's slots
    const helloTimer = setTimeout(() => ws.close(1008, "No hello"), HELLO_MS);
    ws.on("pong", () => {
      if (tab) tab.missed = 0;
    });
    ws.on("message", (data: WebSocket.RawData) => {
      try {
        const buf = bytesOf(data);
        if (!tab) {
          const hello = parseHello(buf);
          if (!hello) return ws.close(1008, "Bad hello");
          clearTimeout(helloTimer);
          tab = join(user, hello, ws);
          return;
        }
        onTabMessage(tab, buf);
      } catch {
        // a bug here must not take the server down with the socket; the tab reconnects
        ws.close(1011, "Server error");
      }
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      sockets.delete(ws);
      if (tab) drop(tab);
    });
    ws.on("error", () => ws.terminate());
  }

  /** Makes a socket's hello a tab. A newer tab with the same id takes the old one's place; null when the account already has MAX_TABS. */
  function join(user: RelayUser, hello: Hello, ws: WebSocket): Tab | null {
    const map = users.get(user.id) ?? new Map<string, Tab>();
    const old = map.get(hello.tabId);
    if (!old && map.size >= MAX_TABS) {
      ws.close(CLOSE_TOO_MANY, "Too many Rodeo tabs are connected for agents");
      return null;
    }
    const json = JSON.stringify({ tools: hello.tools, instructions: hello.instructions });
    if (saved.get(user.id) !== json) {
      deps.saveTools(user.id, hello.tools, hello.instructions);
      saved.set(user.id, json);
    }
    old?.ws.close(CLOSE_REPLACED, "Replaced by a newer Rodeo tab with the same id");
    const now = Date.now();
    const next: Tab = {
      tabId: hello.tabId,
      userId: user.id,
      ws,
      drawing: hello.drawing,
      visible: hello.visible,
      focusedAt: hello.focused ? now : 0,
      connectedAt: now,
      missed: 0,
    };
    map.set(hello.tabId, next);
    users.set(user.id, map);
    live.set(user.id, { tools: hello.tools, instructions: hello.instructions });
    send(ws, { t: "welcome" });
    return next;
  }

  /** A message from a tab that has said hello: its focus, drawing, and its progress and results for calls it was sent. */
  function onTabMessage(tab: Tab, buf: Buffer): void {
    const msg = parseJson(buf);
    if (!isObject(msg)) return;
    if (msg.t === "focus") {
      if (typeof msg.visible !== "boolean" || typeof msg.focused !== "boolean") return;
      tab.visible = msg.visible;
      if (msg.focused) tab.focusedAt = Date.now();
    } else if (msg.t === "drawing") {
      const drawing = drawingOf(msg.drawing);
      if (drawing !== undefined) tab.drawing = drawing;
    } else if (msg.t === "progress") {
      const p = pendingOf(msg.id, tab);
      // a line of progress is short: the agent reads it between tool steps
      if (p && typeof msg.text === "string") p.progress(msg.text.slice(0, MAX_PROGRESS));
    } else if (msg.t === "result") {
      pendingOf(msg.id, tab)?.finish(sanitize(msg.result));
    }
  }

  /** The call a message names, if this tab is the one it was sent to. */
  function pendingOf(id: unknown, tab: Tab): Pending | undefined {
    if (typeof id !== "string") return undefined;
    const p = calls.get(id);
    return p && p.tab === tab ? p : undefined;
  }

  /** A tab's socket has closed: its calls are lost, and it leaves the account unless a newer tab replaced it. */
  function drop(tab: Tab): void {
    for (const p of [...calls.values()]) {
      if (p.tab === tab) p.finish(failure(lostText(p.tool)));
    }
    const map = users.get(tab.userId);
    if (!map || map.get(tab.tabId) !== tab) return;
    map.delete(tab.tabId);
    for (const [tokenId, pin] of pins) {
      if (pin.userId === tab.userId && pin.tabId === tab.tabId) pins.delete(tokenId);
    }
    if (!map.size) {
      users.delete(tab.userId);
      live.delete(tab.userId);
    }
  }

  /** The tab a token's calls go to: its pinned tab while that is open, else the most recently focused. */
  function pickTab(userId: string, tokenId: string): Tab | null {
    const map = users.get(userId);
    if (!map) return null;
    const pin = pins.get(tokenId);
    const pinned = pin && pin.userId === userId ? map.get(pin.tabId) : undefined;
    return pinned ?? sortedTabs(map)[0] ?? null;
  }

  /** Runs a call in the user's tab and waits for its answer, its time limit, the agent's cancel, or the tab's loss. */
  async function call(c: RelayCall): Promise<McpCallResult> {
    if (c.signal.aborted) return failure(CANCELLED);
    const tab = pickTab(c.userId, c.tokenId);
    if (!tab) return failure(noTabText(deps.siteUrl));
    // a tab runs one call at a time, so a backlog would only pile up behind a stuck one
    let busy = 0;
    for (const p of calls.values()) if (p.userId === c.userId) busy++;
    if (busy >= MAX_PENDING) return failure(`Rodeo is already working on ${MAX_PENDING} calls for this account: wait for them to finish.`);
    const id = randomUUID();
    const limit = deps.timeout ? deps.timeout(c.tool, c.args) : timeoutFor(c.tool, c.args);
    return new Promise<McpCallResult>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onAbort = (): void => stop(failure(CANCELLED), true);
      /** Settles the call once: a call already settled (by a result, a loss or a timeout) is left alone. */
      const stop = (result: McpCallResult, cancel: boolean): void => {
        if (!calls.delete(id)) return;
        clearTimeout(timer);
        c.signal.removeEventListener("abort", onAbort);
        if (cancel) send(tab.ws, { t: "cancel", id });
        resolve(result);
      };
      calls.set(id, {
        userId: c.userId,
        tab,
        tool: c.tool,
        progress: (text) => c.progress(text),
        finish: (result) => stop(result, false),
      });
      timer = setTimeout(() => stop(failure(timedOutText(c.tool, limit)), true), limit);
      c.signal.addEventListener("abort", onAbort, { once: true });
      send(tab.ws, { t: "call", id, tool: c.tool, args: c.args, agent: c.agent });
    });
  }

  /** Every socket's heartbeat is cleared and the sockets are closed; their calls settle as lost. */
  function close(): void {
    clearInterval(heartbeat);
    wss.close();
    for (const ws of sockets) ws.terminate();
  }

  return {
    call,
    tabs(userId) {
      const map = users.get(userId);
      return map ? sortedTabs(map).map(infoOf) : [];
    },
    current(userId, tokenId) {
      const tab = pickTab(userId, tokenId);
      return tab ? infoOf(tab) : null;
    },
    pin(userId, tokenId, tabId) {
      if (tabId === null) {
        pins.delete(tokenId);
        return true;
      }
      if (!users.get(userId)?.has(tabId)) return false;
      pins.set(tokenId, { userId, tabId });
      return true;
    },
    tools(userId) {
      return live.get(userId) ?? deps.loadTools(userId);
    },
    close,
  };
}

// ---- internals -----------------------------------------------------------------------

const MAX_PAYLOAD = 16 * 1024 * 1024;
/** the largest hello: a tab's whole tool list and instructions */
const MAX_HELLO = 1024 * 1024;
const HELLO_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const MISSED_PONGS = 2;
const MAX_TABS = 10;
const MAX_PENDING = 16;
const MAX_TOOLS = 100;
const MAX_DESCRIPTION = 32_768;
const MAX_INSTRUCTIONS = 65_536;
const MAX_CONTENT = 50;
const MAX_PROGRESS = 300;
const TAB_ID = /^[A-Za-z0-9_-]{8,64}$/;
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
const IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** the tools that take minutes: a build, a file's export or import, plug-ins, a command in a dialog */
const LONG_TOOLS: ReadonlySet<string> = new Set(["build", "axo_to_3d", "import_file", "export_file", "plugins", "run_command"]);
const CANCELLED = "The call was cancelled.";

/** The tools and instructions a tab offers. */
interface Offer {
  readonly tools: readonly McpTool[];
  readonly instructions: string;
}

/** A tab's hello, checked. */
type Hello = Extract<TabMessage, { readonly t: "hello" }>;

/** A socket that has said hello. */
interface Tab {
  readonly tabId: string;
  readonly userId: string;
  readonly ws: WebSocket;
  drawing: TabDrawing | null;
  visible: boolean;
  focusedAt: number;
  readonly connectedAt: number;
  /** pings sent since the tab last answered */
  missed: number;
}

/** A call a tab is running. */
interface Pending {
  readonly userId: string;
  readonly tab: Tab;
  readonly tool: string;
  progress(text: string): void;
  /** settles the call with this result */
  finish(result: McpCallResult): void;
}

function failure(text: string): McpCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

function noTabText(site: string): string {
  return `No Rodeo tab is open for this account. Ask the user to open ${site} in a browser, sign in and open a drawing, then try again.`;
}

function lostText(tool: string): string {
  return `Rodeo's tab closed or lost its connection while ${tool} ran. Part of it may have been done: once the user has Rodeo open again, check with overview or a look before going on.`;
}

function timedOutText(tool: string, ms: number): string {
  return `Rodeo didn't finish ${tool} within ${Math.round(ms / 1000)} seconds, so it was stopped. Part of it may have been done: check with overview or a look. Rodeo draws only while its tab is visible, so ask the user to keep it on screen.`;
}

/** Answers an upgrade request we won't serve, as a plain HTTP status, then drops the socket. */
function refuse(socket: Duplex, status: string): void {
  socket.on("error", () => {});
  socket.write(`HTTP/1.1 ${status}\r\n\r\n`);
  socket.destroy();
}

function send(ws: WebSocket, msg: RelayMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function infoOf(tab: Tab): TabInfo {
  return { tabId: tab.tabId, drawing: tab.drawing, focusedAt: tab.focusedAt, connectedAt: tab.connectedAt, visible: tab.visible };
}

/** An account's tabs, most recently focused first, then the newest connection. */
function sortedTabs(map: Map<string, Tab>): Tab[] {
  return [...map.values()].sort((a, b) => b.focusedAt - a.focusedAt || b.connectedAt - a.connectedAt);
}

function bytesOf(data: WebSocket.RawData): Buffer {
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

function parseJson(buf: Buffer): unknown {
  try {
    return JSON.parse(buf.toString("utf8"));
  } catch {
    return undefined;
  }
}

/** A plain JSON object: not null, not an array. */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A hello, checked and cleaned, or null when it is not one this server takes. */
function parseHello(buf: Buffer): Hello | null {
  if (buf.length > MAX_HELLO) return null;
  const m = parseJson(buf);
  if (!isObject(m) || m.t !== "hello") return null;
  if (typeof m.tabId !== "string" || !TAB_ID.test(m.tabId)) return null;
  if (typeof m.focused !== "boolean" || typeof m.visible !== "boolean") return null;
  const drawing = drawingOf(m.drawing);
  if (drawing === undefined) return null;
  const tools = toolsOf(m.tools);
  if (!tools) return null;
  if (typeof m.instructions !== "string" || m.instructions.length > MAX_INSTRUCTIONS) return null;
  return { t: "hello", tabId: m.tabId, focused: m.focused, visible: m.visible, drawing, tools, instructions: m.instructions };
}

/** A tab's drawing, checked: null when none is open, undefined when the value is not one. */
function drawingOf(v: unknown): TabDrawing | null | undefined {
  if (v === null) return null;
  if (!isObject(v) || typeof v.name !== "string") return undefined;
  if (v.fileId !== null && typeof v.fileId !== "string") return undefined;
  if (typeof v.readOnly !== "boolean") return undefined;
  return { name: v.name.slice(0, 200), fileId: v.fileId, readOnly: v.readOnly };
}

/** The tools a hello offers, checked; null when any one of them is not a tool. */
function toolsOf(v: unknown): McpTool[] | null {
  if (!Array.isArray(v) || v.length > MAX_TOOLS) return null;
  const out: McpTool[] = [];
  for (const t of v) {
    if (!isObject(t) || typeof t.name !== "string" || !TOOL_NAME.test(t.name)) return null;
    if (typeof t.description !== "string" || t.description.length > MAX_DESCRIPTION) return null;
    if (!isObject(t.inputSchema)) return null;
    out.push({
      name: t.name,
      ...(typeof t.title === "string" ? { title: t.title } : {}),
      description: t.description,
      inputSchema: t.inputSchema,
      ...(isObject(t.annotations) ? { annotations: t.annotations as McpTool["annotations"] } : {}),
    });
  }
  return out;
}

/** A tab's result, cleaned into what an agent can read: text, or a picture of a type MCP allows. */
function sanitize(r: unknown): McpCallResult {
  const parts = isObject(r) && Array.isArray(r.content) ? r.content.slice(0, MAX_CONTENT) : [];
  const content: McpContent[] = [];
  for (const p of parts) {
    if (!isObject(p)) continue;
    if (p.type === "text" && typeof p.text === "string") {
      content.push({ type: "text", text: p.text });
    } else if (p.type === "image" && typeof p.data === "string" && typeof p.mimeType === "string" && IMAGE_TYPES.has(p.mimeType)) {
      content.push({ type: "image", data: p.data, mimeType: p.mimeType });
    }
  }
  if (!content.length) return { content: [{ type: "text", text: "Rodeo sent a result the server couldn't read." }], isError: true };
  const isError = isObject(r) && typeof r.isError === "boolean" ? r.isError : true;
  return { content, isError };
}
