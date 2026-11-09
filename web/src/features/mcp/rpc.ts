// The MCP protocol core: reads one JSON-RPC message, checks its protocol version and headers, and
// runs it against an McpServer. The HTTP endpoint and the stdio server both use it, so they answer
// alike. Two protocol eras are served: the modern stateless one (2026-07-28), whose requests carry
// their version and client capabilities in _meta, and the legacy one (initialize, then plain
// requests). Nothing here is HTTP or DOM code: the transport passes in headers and a notify
// function. Node only for readline in the stdio server.

import { createInterface } from "node:readline";
import type { CallContext, McpServer } from "./wire.ts";

export const MODERN_VERSION = "2026-07-28";
export const LEGACY_VERSIONS: readonly string[] = ["2025-11-25", "2025-06-18", "2025-03-26"];
export const SUPPORTED_VERSIONS: readonly string[] = [MODERN_VERSION, ...LEGACY_VERSIONS];
export const CODES = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603, headerMismatch: -32020, unsupportedVersion: -32022 } as const;

export type RpcId = string | number;
export interface RpcErrorBody { readonly code: number; readonly message: string; readonly data?: unknown }
export interface RpcReply { readonly jsonrpc: "2.0"; readonly id: RpcId | null; readonly result?: Record<string, unknown>; readonly error?: RpcErrorBody }
export interface RpcRequest { readonly id: RpcId; readonly method: string; readonly params: Record<string, unknown> }
export type Incoming =
  | { readonly kind: "request"; readonly request: RpcRequest }
  | { readonly kind: "notification"; readonly method: string; readonly params: Record<string, unknown> }
  | { readonly kind: "response" }
  | { readonly kind: "invalid"; readonly reply: RpcReply };
/** what to send back, and the HTTP status to send it with */
export interface Outcome { readonly status: number; readonly reply: RpcReply }
/** an HTTP request's headers; names are matched case-insensitively by the caller's get */
export interface HeaderBag { get(name: string): string | null | undefined }
export interface RunOptions {
  readonly signal: AbortSignal;
  /** sends a notification about this request (progress) on the transport */
  notify(message: Record<string, unknown>): void;
}

/** A protocol error a tool or the server throws: it goes back as a JSON-RPC error, not a tool error. */
export class McpError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

/** A JSON-RPC error reply to the request with this id (null when the id is unknown). */
export function errorReply(id: RpcId | null, code: number, message: string, data?: unknown): RpcReply {
  const error: RpcErrorBody = data === undefined ? { code, message } : { code, message, data };
  return { jsonrpc: "2.0", id, error };
}

/** Reads one incoming line: a request, a notification, a response, or an invalid message with the reply to send. */
export function parseIncoming(text: string): Incoming {
  const got = parseJson(text);
  if (got === null) return invalid(errorReply(null, CODES.parse, "The message isn't valid JSON"));
  const msg: unknown = got.value;
  if (Array.isArray(msg)) return invalid(errorReply(null, CODES.invalidRequest, "Batches aren't supported: send one message per request"));
  if (!isObject(msg) || msg.jsonrpc !== "2.0") {
    return invalid(errorReply(isObject(msg) ? idOf(msg.id) : null, CODES.invalidRequest, "Not a JSON-RPC 2.0 message"));
  }
  if (msg.method === undefined) {
    if ("result" in msg || "error" in msg) return { kind: "response" };
    return invalid(errorReply(idOf(msg.id), CODES.invalidRequest, "Not a JSON-RPC 2.0 message"));
  }
  if (typeof msg.method !== "string") return invalid(errorReply(idOf(msg.id), CODES.invalidRequest, "The message's method must be a string"));
  const method = msg.method;
  // A notification's odd params are dropped rather than answered: notifications get no reply.
  const params = isObject(msg.params) ? msg.params : {};
  if (msg.id === undefined) return { kind: "notification", method, params };
  const id = msg.id;
  if (!(typeof id === "string" || (typeof id === "number" && Number.isInteger(id)))) {
    return invalid(errorReply(null, CODES.invalidRequest, "A request's id must be a string or a number"));
  }
  if (msg.params !== undefined && !isObject(msg.params)) return invalid(errorReply(id, CODES.invalidRequest, "params must be an object"));
  return { kind: "request", request: { id, method, params } };
}

/** The calling client's name (from its _meta, or for initialize its clientInfo), trimmed to 60 characters; null when it gave none. */
export function clientName(req: RpcRequest): string | null {
  const fromMeta = nameOf(meta(req.params)["io.modelcontextprotocol/clientInfo"]);
  const fromInit = req.method === "initialize" ? nameOf(req.params.clientInfo) : null;
  return fromMeta ?? fromInit;
}

/** The id of the request a notifications/cancelled names, or null for any other message. */
export function cancelledId(method: string, params: Record<string, unknown>): RpcId | null {
  if (method !== "notifications/cancelled") return null;
  const id = params.requestId;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

/** Checks a request's version and MCP headers before it runs: the refusal to send, or null to run it. */
export function precheck(req: RpcRequest, headers: HeaderBag | null): Outcome | null {
  // The legacy handshake always comes first, so it is never refused.
  if (req.method === "initialize") return null;
  const headerVersion = headers?.get("mcp-protocol-version") ?? null;
  const version = metaVersion(req);
  if (version === null) {
    // A legacy request: the header may only name a version this server knows, and never the modern one without _meta.
    if (headerVersion === MODERN_VERSION) return refusal(400, CODES.invalidParams, `A ${MODERN_VERSION} request needs _meta io.modelcontextprotocol/protocolVersion`, req.id);
    if (headerVersion !== null && !SUPPORTED_VERSIONS.includes(headerVersion)) return unsupported(req, headerVersion);
    return null;
  }
  if (headers && headerVersion !== version) {
    return refusal(400, CODES.headerMismatch, `The MCP-Protocol-Version header (${headerVersion ?? "missing"}) doesn't match the request's protocol version (${version})`, req.id);
  }
  if (!SUPPORTED_VERSIONS.includes(version)) return unsupported(req, version);
  if (version !== MODERN_VERSION) return null;
  if (!isObject(meta(req.params)["io.modelcontextprotocol/clientCapabilities"])) {
    return refusal(400, CODES.invalidParams, "The request's _meta needs io.modelcontextprotocol/clientCapabilities", req.id);
  }
  if (headers) {
    if (headers.get("mcp-method") !== req.method) {
      return refusal(400, CODES.headerMismatch, `The Mcp-Method header doesn't match the request's method (${req.method})`, req.id);
    }
    if (req.method === "tools/call" && decodeHeader(headers.get("mcp-name")) !== req.params.name) {
      return refusal(400, CODES.headerMismatch, "The Mcp-Name header doesn't match the tool's name", req.id);
    }
  }
  return null;
}

/** Runs one request against the server and returns the reply to send, with the HTTP status to send it with. */
export async function runRequest(req: RpcRequest, server: McpServer, opts: RunOptions): Promise<Outcome> {
  const modern = metaVersion(req) === MODERN_VERSION;
  const info = { name: server.name, title: server.title, version: server.version };
  const raw = (result: Record<string, unknown>): Outcome => ({ status: 200, reply: { jsonrpc: "2.0", id: req.id, result } });
  // Modern results say they are complete and carry the server's identity in _meta.
  const complete = (result: Record<string, unknown>): Outcome => raw({ resultType: "complete", ...result, _meta: { "io.modelcontextprotocol/serverInfo": info } });
  const ok = (result: Record<string, unknown>): Outcome => (modern ? complete(result) : raw(result));
  // A bad request is 400 for a modern client; a legacy client takes a JSON-RPC error in a 200.
  const bad = (code: number, message: string): Outcome => ({ status: modern ? 400 : 200, reply: errorReply(req.id, code, message) });
  try {
    switch (req.method) {
      case "initialize": {
        const requested = req.params.protocolVersion;
        const version = typeof requested === "string" && LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_VERSIONS[0];
        return raw({ protocolVersion: version, capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions: server.instructions() });
      }
      case "server/discover":
        return complete({ supportedVersions: SUPPORTED_VERSIONS, capabilities: { tools: {} }, instructions: server.instructions() });
      case "ping":
        return ok({});
      case "tools/list":
        return ok({ tools: await server.listTools() });
      case "tools/call":
        return await callTool(req, server, opts, ok, bad);
      default:
        return { status: modern ? 404 : 200, reply: errorReply(req.id, CODES.methodNotFound, `Method not found: ${req.method}`) };
    }
  } catch {
    // Anything unexpected is logged by the caller's transport, never shown to the client.
    return { status: 500, reply: errorReply(req.id, CODES.internal, "Internal error") };
  }
}

/** Serves MCP over stdio, one message per line; resolves once the input closes and requests settle. */
export async function serveStdio(
  server: McpServer,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  log: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): Promise<void> {
  const write = (message: unknown): void => {
    output.write(`${JSON.stringify(message)}\n`);
  };
  const inflight = new Map<string, AbortController>();
  const settled: Promise<void>[] = [];
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === "") continue;
    const incoming = parseIncoming(line);
    if (incoming.kind === "invalid") {
      write(incoming.reply);
      continue;
    }
    if (incoming.kind === "response") continue;
    if (incoming.kind === "notification") {
      const cancelled = cancelledId(incoming.method, incoming.params);
      if (cancelled !== null) inflight.get(String(cancelled))?.abort();
      continue;
    }
    const req = incoming.request;
    const refused = precheck(req, null);
    if (refused) {
      write(refused.reply);
      continue;
    }
    const key = String(req.id);
    const controller = new AbortController();
    inflight.set(key, controller);
    const forget = (): void => {
      if (inflight.get(key) === controller) inflight.delete(key);
    };
    settled.push(
      runRequest(req, server, { signal: controller.signal, notify: write }).then(
        (outcome) => {
          forget();
          // A cancelled request gets no reply: the client has stopped waiting for it.
          if (!controller.signal.aborted) write(outcome.reply);
        },
        (e: unknown) => {
          forget();
          log(`mcp: ${messageOf(e)}`);
        },
      ),
    );
  }
  await Promise.all(settled);
}

// ---- helpers --------------------------------------------------------------------------

/** tools/call: the tool's name and arguments, the progress context, and the tool's result or its error. */
async function callTool(
  req: RpcRequest,
  server: McpServer,
  opts: RunOptions,
  ok: (result: Record<string, unknown>) => Outcome,
  bad: (code: number, message: string) => Outcome,
): Promise<Outcome> {
  const name = req.params.name;
  if (typeof name !== "string" || name === "") return bad(CODES.invalidParams, "tools/call needs the tool's name");
  const args = req.params.arguments;
  if (args !== undefined && !isObject(args)) return bad(CODES.invalidParams, "arguments must be an object");
  const token = progressToken(req);
  let sent = 0;
  const ctx: CallContext = {
    signal: opts.signal,
    client: clientName(req),
    progress(message: string): void {
      if (token === undefined) return;
      sent += 1;
      opts.notify({ jsonrpc: "2.0", method: "notifications/progress", params: { progressToken: token, progress: sent, message } });
    },
  };
  try {
    const result = await server.callTool(name, isObject(args) ? args : {}, ctx);
    return ok({ content: result.content, isError: result.isError });
  } catch (e) {
    // A protocol error goes back as a JSON-RPC error; anything else is a tool failure the model can read.
    if (e instanceof McpError) return { status: 200, reply: errorReply(req.id, e.code, e.message, e.data) };
    return ok({ content: [{ type: "text", text: `Error: ${messageOf(e)}` }], isError: true });
  }
}

function invalid(reply: RpcReply): Incoming {
  return { kind: "invalid", reply };
}

function refusal(status: number, code: number, message: string, id: RpcId, data?: unknown): Outcome {
  return { status, reply: errorReply(id, code, message, data) };
}

function unsupported(req: RpcRequest, requested: string): Outcome {
  return refusal(400, CODES.unsupportedVersion, "Unsupported protocol version", req.id, { supported: SUPPORTED_VERSIONS, requested });
}

function parseJson(text: string): { readonly value: unknown } | null {
  try {
    return { value: JSON.parse(text) };
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function idOf(value: unknown): RpcId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The request's _meta, or an empty object when it has none. */
function meta(params: Record<string, unknown>): Record<string, unknown> {
  const m = params._meta;
  return isObject(m) ? m : {};
}

/** The protocol version a modern request carries in its _meta, or null for a legacy one. */
function metaVersion(req: RpcRequest): string | null {
  const v = meta(req.params)["io.modelcontextprotocol/protocolVersion"];
  return typeof v === "string" ? v : null;
}

/** The progress token the client asked for in _meta, or undefined when it asked for none. */
function progressToken(req: RpcRequest): string | number | undefined {
  const token = meta(req.params).progressToken;
  return typeof token === "string" || typeof token === "number" ? token : undefined;
}

function nameOf(info: unknown): string | null {
  if (!isObject(info) || typeof info.name !== "string") return null;
  const name = info.name.trim().slice(0, 60);
  return name === "" ? null : name;
}

/** An MCP header value, decoded from the =?base64?...?= form; null when that form is broken. */
function decodeHeader(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const match = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value);
  if (!match) return value;
  try {
    const bin = atob(match[1]);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}
