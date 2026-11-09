// The MCP endpoint: POST /mcp over Streamable HTTP, for the 2026-07-28 protocol and the 2025 ones.
// The bearer token says whose Rodeo tabs an agent drives: a personal access token the person made,
// or an OAuth access token from Rodeo's sign-in (server/src/oauth). Each tool call goes through the
// relay to the user's tab. Nothing here reads cookies: the endpoint takes a bearer token only, so
// the cookie-session CSRF middleware under /api never applies to it.

import type { Context, Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { allowed, clientIp } from "../auth.ts";
import { config } from "../config.ts";
import {
  cancelledId,
  clientName,
  errorReply,
  parseIncoming,
  precheck,
  runRequest,
  type Outcome,
  type RpcId,
  type RpcRequest,
} from "../../../web/src/features/mcp/rpc.ts";
import type { CallContext, McpCallResult, McpServer, McpTool } from "../../../web/src/features/mcp/wire.ts";
import type { Relay } from "./relay.ts";
import { touchToken, tokenOwner, type TokenOwner } from "./store.ts";
import { bearerOf, resourceOf, wwwAuthenticate } from "../oauth/shared.ts";
import { oauthOwner, touchGrant } from "../oauth/tokens.ts";
import { HOUR, MB, MINUTE } from "../util.ts";

/** A request body may be this long at most. */
const MAX_BODY = 8 * MB;
/** Calls a token may make a minute, and failed sign-ins an address may make a minute. */
const CALLS_PER_MINUTE = 300;
const FAILS_PER_MINUTE = 60;
/** An open stream sends a keep-alive comment this often: Cloudflare closes an idle response after 100 seconds. */
const KEEP_ALIVE_MS = 15_000;

const AUTH_HELP =
  "Rodeo needs you to sign in: an MCP client that supports OAuth opens Rodeo's sign-in page by itself (Rodeo's metadata is at the resource_metadata address in the WWW-Authenticate header). Or make a personal access token in Rodeo with Window › Connect an Agent… and send it as Authorization: Bearer <token>.";
const TOO_MANY = "Too many requests: slow down a little.";
const TOO_LARGE = "The request is larger than 8 MB.";
const FROM_PAGE = "Rodeo's MCP endpoint doesn't take requests from this page";
const NOT_POST = "Rodeo's MCP endpoint takes POST requests only (Streamable HTTP).";

/** Who is calling: a personal access token's owner, or an app's OAuth connection (tokenId is then the grant's id). */
type Caller = TokenOwner & { readonly kind: "pat" | "oauth" };

/** The caller an Authorization header names: "none" when it names nobody, "bad" when its token isn't a working one of ours. */
function callerOf(authorization: string | undefined): Caller | "none" | "bad" {
  if ((authorization ?? "").trim() === "") return "none";
  const pat = tokenOwner(authorization);
  if (pat) return { ...pat, kind: "pat" };
  const bearer = bearerOf(authorization);
  const app = bearer ? oauthOwner(bearer, resourceOf(config.publicUrl)) : null;
  if (app) return { tokenId: app.grantId, userId: app.userId, name: app.name, kind: "oauth" };
  return "bad";
}

/** What the endpoint needs from the server: the live relay (null until it is attached), the site's address and the version. */
export interface EndpointOptions {
  relay(): Relay | null;
  readonly siteUrl: string;
  readonly version: string;
}

/**
 * Whether a page at this origin may use the agent relay or the endpoint: the site itself, a
 * CORS_ORIGINS entry, or the host the request was sent to (the Vite dev proxy, a local run).
 * Defined here rather than in index.ts, which imports this file.
 */
export function allowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (origin === undefined) return false;
  if (origin === new URL(config.publicUrl).origin || config.corsOrigins.includes(origin)) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Calls in progress, by token and request id, so a cancel notification can stop the one it names. */
const inflight = new Map<string, AbortController>();

/** Adds the endpoint's routes: POST /mcp answers agents; GET, DELETE and OPTIONS say what is allowed. */
export function registerEndpoint(app: Hono, opts: EndpointOptions): void {
  app.post("/mcp", (c) => answer(c, opts));
  const notPost = (c: Context): Response => {
    c.header("Allow", "POST");
    return refuse(c, 405, -32600, NOT_POST);
  };
  app.get("/mcp", notPost);
  app.delete("/mcp", notPost);
  app.options("/mcp", (c) => {
    c.header("Allow", "POST");
    return c.body(null, 204);
  });
}

/** Answers one POST /mcp: checks the page, the token and the limits, then runs the message and answers it. */
async function answer(c: Context, opts: EndpointOptions): Promise<Response> {
  const origin = c.req.header("origin");
  if (origin !== undefined && !allowedOrigin(origin, c.req.header("host"))) return refuse(c, 403, -32600, FROM_PAGE);

  const owner = callerOf(c.req.header("authorization"));
  if (owner === "none") {
    // no token: the start of an OAuth sign-in, so not counted (agents' addresses are shared)
    c.header("WWW-Authenticate", wwwAuthenticate(config.publicUrl, false));
    return refuse(c, 401, -31001, AUTH_HELP);
  }
  if (owner === "bad") {
    // a token that isn't a working one is a failed sign-in, counted per address so that guessing is slowed
    if (!allowed(`mcp-auth:${clientIp(c)}`, FAILS_PER_MINUTE, MINUTE)) return refuse(c, 429, -31029, TOO_MANY);
    c.header("WWW-Authenticate", wwwAuthenticate(config.publicUrl, true));
    return refuse(c, 401, -31001, AUTH_HELP);
  }
  if (!allowed(`mcp:${owner.tokenId}`, CALLS_PER_MINUTE, MINUTE)) return refuse(c, 429, -31029, TOO_MANY);

  const relay = opts.relay();
  if (!relay) return refuse(c, 503, -31503, "Rodeo is starting up: try again in a moment.");

  // the declared length is checked before the body is read; the read text is checked too, in case none was declared
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY) return refuse(c, 413, -31413, TOO_LARGE);
  const text = await c.req.text();
  if (text.length > MAX_BODY) return refuse(c, 413, -31413, TOO_LARGE);

  const incoming = parseIncoming(text);
  if (incoming.kind === "invalid") return c.json(incoming.reply, 400);
  if (incoming.kind === "response") return c.body(null, 202);
  if (incoming.kind === "notification") {
    // a cancel stops the call it names; a notification gets no reply
    const id = cancelledId(incoming.method, incoming.params);
    if (id !== null) inflight.get(keyOf(owner.tokenId, id))?.abort();
    return c.body(null, 202);
  }

  const req = incoming.request;
  const refused = precheck(req, { get: (name) => c.req.header(name) ?? null });
  if (refused) return answerWith(c, refused);
  if (owner.kind === "pat") touchToken(owner.tokenId, clientName(req));
  else touchGrant(owner.tokenId, clientName(req));

  const server = liveServer(owner, relay, opts);
  const key = keyOf(owner.tokenId, req.id);
  if (req.method === "tools/call" && (c.req.header("accept") ?? "").includes("text/event-stream")) {
    return streamCall(c, req, server, key);
  }
  // A plain JSON answer has nowhere to send progress, so progress is dropped.
  const { ctl, done } = track(key, c.req.raw.signal);
  try {
    const out = await runRequest(req, server, { signal: ctl.signal, notify: () => {} });
    c.header("Cache-Control", "no-store");
    return answerWith(c, out);
  } finally {
    done();
  }
}

/** A tools/call the client takes as an event stream: progress as it comes, then the result, with keep-alive comments meanwhile. */
function streamCall(c: Context, req: RpcRequest, server: McpServer, key: string): Response {
  const res = streamSSE(c, async (stream) => {
    const { ctl, done } = track(key, c.req.raw.signal);
    stream.onAbort(() => ctl.abort());
    const keep = setInterval(() => void stream.write(": keep-alive\n\n"), KEEP_ALIVE_MS);
    try {
      const out = await runRequest(req, server, {
        signal: ctl.signal,
        notify: (message) => void stream.writeSSE({ data: JSON.stringify(message) }).catch(() => {}),
      });
      // a call the client cancelled gets no reply: it has stopped waiting for one
      if (!ctl.signal.aborted) await stream.writeSSE({ data: JSON.stringify(out.reply) });
    } finally {
      clearInterval(keep);
      done();
    }
  });
  // streamSSE sets its own Cache-Control; a proxy must not buffer or transform the stream
  res.headers.set("Cache-Control", "no-cache, no-transform");
  res.headers.set("X-Accel-Buffering", "no");
  return res;
}

/** Registers a call so a cancel can find it, and aborts it when the client goes away. Call done() when the call ends. */
function track(key: string, request: AbortSignal): { readonly ctl: AbortController; done(): void } {
  const ctl = new AbortController();
  inflight.set(key, ctl);
  request.addEventListener("abort", () => ctl.abort(), { once: true });
  return {
    ctl,
    done() {
      if (inflight.get(key) === ctl) inflight.delete(key);
    },
  };
}

/** The key a call is registered under: the token and the request id, so one agent cannot cancel another's call. */
function keyOf(tokenId: string, id: RpcId): string {
  return `${tokenId}:${String(id)}`;
}

/** A refusal as a JSON-RPC error. It has no request id, since the message was never read. */
function refuse(c: Context, status: ContentfulStatusCode, code: number, message: string): Response {
  return c.json(errorReply(null, code, message), status);
}

/** An outcome as a JSON reply with its HTTP status. */
function answerWith(c: Context, out: Outcome): Response {
  return c.json(out.reply, out.status as ContentfulStatusCode);
}

/** The MCP server one agent's calls run on: the tools its user's tabs offer, and the two the server answers itself. */
function liveServer(owner: TokenOwner, relay: Relay, opts: EndpointOptions): McpServer {
  return {
    name: "rodeo",
    title: "Rodeo",
    version: opts.version,
    instructions: () => relay.tools(owner.userId)?.instructions ?? unconnectedInstructions(opts.siteUrl),
    async listTools(): Promise<readonly McpTool[]> {
      const offered = (relay.tools(owner.userId)?.tools ?? []).filter((t) => t.name !== "list_drawings" && t.name !== "use_drawing");
      return [...offered, LIST_DRAWINGS, USE_DRAWING];
    },
    callTool: (name, args, ctx) => callTool(owner, relay, opts, name, args, ctx),
  };
}

/** Runs one tool call: the two server tools here, every other one in the user's tab. */
async function callTool(
  owner: TokenOwner,
  relay: Relay,
  opts: EndpointOptions,
  name: string,
  args: Record<string, unknown>,
  ctx: CallContext,
): Promise<McpCallResult> {
  if (name === "list_drawings") return listDrawings(owner, relay, opts.siteUrl);
  if (name === "use_drawing") return useDrawing(owner, relay, args);
  return relay.call({
    userId: owner.userId,
    tokenId: owner.tokenId,
    agent: owner.name,
    tool: name,
    args,
    signal: ctx.signal,
    progress: (text) => ctx.progress(text),
  });
}

/** list_drawings: the user's open tabs, the drawing in each, and which one this token's calls go to. */
function listDrawings(owner: TokenOwner, relay: Relay, siteUrl: string): McpCallResult {
  const tabs = relay.tabs(owner.userId);
  // the same words relay.ts gives a call when no tab is open; this is not an error, since the list is the answer
  if (tabs.length === 0) return textResult(noTabText(siteUrl));
  const current = relay.current(owner.userId, owner.tokenId)?.tabId;
  const now = Date.now();
  const rows = tabs.map((t) => ({
    id: t.tabId,
    drawing: t.drawing?.name ?? null,
    cloud: Boolean(t.drawing?.fileId),
    viewOnly: t.drawing?.readOnly ?? false,
    onScreen: t.visible,
    lastUsed: ago(t.focusedAt || t.connectedAt, now),
    current: t.tabId === current,
  }));
  return textResult(JSON.stringify({ tabs: rows, note: "Your calls go to the current tab. use_drawing picks another." }));
}

/** use_drawing: sends this token's calls to a tab until it closes, or back to the one the user used last when no id is given. */
function useDrawing(owner: TokenOwner, relay: Relay, args: Record<string, unknown>): McpCallResult {
  const id = args.id;
  if (id === undefined || id === null) {
    relay.pin(owner.userId, owner.tokenId, null);
    return textResult("Your calls go to the Rodeo tab the user used last.");
  }
  if (typeof id !== "string") return textResult("use_drawing needs id (a string): list_drawings shows the ids.", true);
  const tab = relay.tabs(owner.userId).find((t) => t.tabId === id);
  if (!tab || !relay.pin(owner.userId, owner.tokenId, id)) {
    return textResult(`No open Rodeo tab has the id ${id}: list_drawings shows them.`, true);
  }
  return textResult(
    tab.drawing ? `Your calls now go to the tab showing "${tab.drawing.name}".` : "Your calls now go to the tab with no drawing open.",
  );
}

/** A tool result with one text part. */
function textResult(message: string, isError = false): McpCallResult {
  return { content: [{ type: "text", text: message }], isError };
}

/** How long ago a time was, in words an agent reads. */
function ago(at: number, now: number): string {
  const ms = now - at;
  if (ms < MINUTE) return "just now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`;
  return `${Math.floor(ms / HOUR)} h ago`;
}

/** What list_drawings and a call say when no Rodeo tab is open. */
function noTabText(site: string): string {
  return `No Rodeo tab is open for this account. Ask the user to open ${site} in a browser, sign in and open a drawing, then try again.`;
}

/** What an agent is told when no tab has ever offered tools: how to get Rodeo connected. */
function unconnectedInstructions(site: string): string {
  return `Rodeo's drawing tools appear here once the user has opened Rodeo (${site}) in a browser and signed in with the account this token belongs to. Ask them to, then reconnect this server (in Claude Code: /mcp).`;
}

/** The two tools the server answers itself, as tools/list shows them. */
const LIST_DRAWINGS: McpTool = {
  name: "list_drawings",
  title: "Open drawings",
  description:
    "Lists the user's open Rodeo tabs, each with the drawing in front (cloud or from disk, view only or not), whether it is on screen, when the user last used it, and which one your calls go to. use_drawing picks another.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
};

const USE_DRAWING: McpTool = {
  name: "use_drawing",
  title: "Use a drawing",
  description:
    "Sends your calls to the Rodeo tab with this id (from list_drawings) until it closes. Without an id, your calls go back to the tab the user used last.",
  inputSchema: { type: "object", properties: { id: { type: "string", description: "a tab id from list_drawings" } }, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};
