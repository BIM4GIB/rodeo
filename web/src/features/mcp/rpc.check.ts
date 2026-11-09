// Checks the MCP protocol core (rpc.ts) against a fake server: message parsing, both protocol eras,
// the version and header checks the HTTP endpoint runs before a request, tool calls with progress
// and errors, server/discover, and cancellation over stdio. DOM-free.
//
// Run: cd web && npx tsx src/features/mcp/rpc.check.ts

import { PassThrough } from "node:stream";
import {
  McpError,
  MODERN_VERSION,
  SUPPORTED_VERSIONS,
  clientName,
  parseIncoming,
  precheck,
  runRequest,
  serveStdio,
  type HeaderBag,
  type Outcome,
  type RpcRequest,
} from "./rpc.ts";
import type { McpCallResult, McpServer } from "./wire.ts";

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

/** A tool result holding one line of text. */
function text(t: string): McpCallResult {
  return { content: [{ type: "text", text: t }], isError: false };
}

const fake: McpServer = {
  name: "fake",
  title: "Fake server",
  version: "1.0.0",
  instructions: () => "Call the fake tools.",
  async listTools() {
    return [
      { name: "echo", description: "Echoes its arguments as text.", inputSchema: { type: "object" } },
      { name: "boom", description: "Always fails.", inputSchema: { type: "object" } },
      { name: "proto", description: "Fails with a protocol error.", inputSchema: { type: "object" } },
      { name: "slow", description: "Waits until it is cancelled.", inputSchema: { type: "object" } },
    ];
  },
  async callTool(name, args, ctx) {
    if (name === "echo") {
      ctx.progress("half");
      return text(JSON.stringify(args));
    }
    if (name === "boom") throw new Error("bang");
    if (name === "proto") throw new McpError(-32602, "bad args");
    if (name === "slow") {
      await new Promise<void>((resolve) => {
        if (ctx.signal.aborted) resolve();
        else ctx.signal.addEventListener("abort", () => resolve(), { once: true });
      });
      return text("late");
    }
    throw new McpError(-32602, `No tool ${name}`);
  },
};

/** A header bag whose lookups ignore case. */
function headers(map: Record<string, string>): HeaderBag {
  const lower = new Map(Object.entries(map).map(([k, v]) => [k.toLowerCase(), v] as const));
  return { get: (name: string) => lower.get(name.toLowerCase()) };
}

const MODERN_META: Record<string, unknown> = {
  "io.modelcontextprotocol/protocolVersion": MODERN_VERSION,
  "io.modelcontextprotocol/clientCapabilities": {},
};

/** A modern request: its _meta carries the version and capabilities, plus any given _meta fields. */
function modern(method: string, params: Record<string, unknown> = {}, id: number | string = 1): RpcRequest {
  return { id, method, params: { _meta: MODERN_META, ...params } };
}

/** A legacy request: plain params, no _meta. */
function legacy(method: string, params: Record<string, unknown> = {}, id: number | string = 1): RpcRequest {
  return { id, method, params };
}

async function run(req: RpcRequest, notify: (message: Record<string, unknown>) => void = () => {}): Promise<Outcome> {
  return runRequest(req, fake, { signal: new AbortController().signal, notify });
}

function resultOf(o: Outcome): Record<string, unknown> {
  return o.reply.result ?? {};
}

function textOf(o: Outcome): string {
  const content = resultOf(o).content as { text?: string }[] | undefined;
  return content?.[0]?.text ?? "";
}

/** True when the outcome is a refusal with this HTTP status and JSON-RPC code. */
function refused(o: Outcome | null, status: number, code: number): boolean {
  return o !== null && o.status === status && o.reply.error?.code === code;
}

/** A short description of an outcome, for the detail column of a failing check. */
function describe(o: Outcome | null): string {
  return o === null ? "null" : `${o.status} ${JSON.stringify(o.reply.error ?? o.reply.result ?? {})}`;
}

async function main(): Promise<void> {
  // 1. parsing
  const notJson = parseIncoming("{nope");
  expect("parse: bad JSON is -32700", notJson.kind === "invalid" && notJson.reply.error?.code === -32700);

  const batch = parseIncoming("[]");
  expect("parse: an array is refused as a batch, -32600", batch.kind === "invalid" && batch.reply.error?.code === -32600);

  const stringId = parseIncoming('{"jsonrpc":"2.0","id":"a1","method":"ping"}');
  expect("parse: a string id is a request", stringId.kind === "request" && stringId.request.id === "a1");

  const note = parseIncoming('{"jsonrpc":"2.0","method":"notifications/initialized"}');
  expect("parse: no id is a notification", note.kind === "notification");

  const response = parseIncoming('{"jsonrpc":"2.0","id":3,"result":{}}');
  expect("parse: a result is a response", response.kind === "response");

  const nullId = parseIncoming('{"jsonrpc":"2.0","id":null,"method":"ping"}');
  expect("parse: a null id is invalid", nullId.kind === "invalid");

  // 2. the legacy handshake
  const init = await run(legacy("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "cli" }, capabilities: {} }));
  const initResult = resultOf(init);
  expect("initialize echoes a legacy version it knows", initResult.protocolVersion === "2025-06-18", describe(init));
  expect("initialize offers the tools capability", (initResult.capabilities as Record<string, unknown> | undefined)?.tools !== undefined);
  expect("initialize names the server", (initResult.serverInfo as { name?: string } | undefined)?.name === "fake");
  expect("initialize gives the server's instructions", initResult.instructions === "Call the fake tools.");
  expect("initialize is never decorated with resultType", !("resultType" in initResult));

  const oldVersion = await run(legacy("initialize", { protocolVersion: "2024-11-05" }));
  expect("initialize with an unknown version answers 2025-11-25", resultOf(oldVersion).protocolVersion === "2025-11-25", describe(oldVersion));
  expect("clientName reads initialize's clientInfo", clientName(legacy("initialize", { clientInfo: { name: "cli" } })) === "cli");

  // 3. tools/list in both eras
  const legacyList = await run(legacy("tools/list"));
  expect("legacy tools/list has no resultType", !("resultType" in resultOf(legacyList)));
  expect("legacy tools/list lists the fake tools", Array.isArray(resultOf(legacyList).tools) && (resultOf(legacyList).tools as unknown[]).length === 4);

  const modernList = await run(modern("tools/list"));
  const modernResult = resultOf(modernList);
  expect("modern tools/list is complete", modernResult.resultType === "complete", describe(modernList));
  const serverMeta = modernResult._meta as Record<string, unknown> | undefined;
  expect("modern tools/list carries serverInfo in _meta", (serverMeta?.["io.modelcontextprotocol/serverInfo"] as { name?: string } | undefined)?.name === "fake");

  // 4. the version and header checks, as the HTTP endpoint runs them
  const matching = headers({ "mcp-protocol-version": MODERN_VERSION, "mcp-method": "tools/list" });
  const noCaps: RpcRequest = { id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN_VERSION } } };
  expect("precheck: modern without clientCapabilities is 400 -32602", refused(precheck(noCaps, matching), 400, -32602), describe(precheck(noCaps, matching)));

  const wrongHeader = headers({ "mcp-protocol-version": "2025-06-18", "mcp-method": "tools/list" });
  expect("precheck: a header version that differs from _meta is -32020", refused(precheck(modern("tools/list"), wrongHeader), 400, -32020), describe(precheck(modern("tools/list"), wrongHeader)));

  const wrongMethod = headers({ "mcp-protocol-version": MODERN_VERSION, "mcp-method": "ping" });
  expect("precheck: an Mcp-Method that differs from the method is -32020", refused(precheck(modern("tools/list"), wrongMethod), 400, -32020), describe(precheck(modern("tools/list"), wrongMethod)));

  const encodedName = headers({ "mcp-protocol-version": MODERN_VERSION, "mcp-method": "tools/call", "mcp-name": "=?base64?ZWNobw==?=" });
  const echoCall = modern("tools/call", { name: "echo", arguments: {} });
  expect("precheck: a base64 Mcp-Name that decodes to the tool's name runs", precheck(echoCall, encodedName) === null, describe(precheck(echoCall, encodedName)));

  const otherName = headers({ "mcp-protocol-version": MODERN_VERSION, "mcp-method": "tools/call", "mcp-name": "boom" });
  expect("precheck: an Mcp-Name for another tool is -32020", refused(precheck(echoCall, otherName), 400, -32020), describe(precheck(echoCall, otherName)));

  const badMetaVersion: RpcRequest = { id: 1, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "1900-01-01", "io.modelcontextprotocol/clientCapabilities": {} } } };
  const unknownVersion = precheck(badMetaVersion, null);
  const supported = (unknownVersion?.reply.error?.data as { supported?: string[] } | undefined)?.supported;
  expect("precheck: an unknown _meta version is 400 -32022 and lists the supported ones", refused(unknownVersion, 400, -32022) && supported?.includes(MODERN_VERSION) === true, describe(unknownVersion));

  const headerOnly = headers({ "mcp-protocol-version": MODERN_VERSION });
  const plainHeader = precheck(legacy("tools/list"), headerOnly);
  expect("precheck: the modern header without _meta is -32602", refused(plainHeader, 400, -32602), describe(plainHeader));

  const legacyHeader = headers({ "mcp-protocol-version": "2025-06-18" });
  expect("precheck: a legacy header without _meta runs", precheck(legacy("tools/list"), legacyHeader) === null, describe(precheck(legacy("tools/list"), legacyHeader)));

  expect("precheck: no headers (stdio) and no _meta runs", precheck(legacy("tools/list"), null) === null);

  // 5. unknown methods
  const unknownLegacy = await run(legacy("nope/nothing"));
  expect("unknown method, legacy: status 200 and -32601", unknownLegacy.status === 200 && unknownLegacy.reply.error?.code === -32601, describe(unknownLegacy));
  const unknownModern = await run(modern("nope/nothing"));
  expect("unknown method, modern: status 404", unknownModern.status === 404, describe(unknownModern));

  // 6. tool calls: progress, a result, a tool failure and a protocol error
  const notes: Record<string, unknown>[] = [];
  const echo = await run(legacy("tools/call", { name: "echo", arguments: { a: 1 }, _meta: { progressToken: "p1" } }), (m) => notes.push(m));
  expect("tools/call echo sends one progress notification", notes.length === 1, `${notes.length} sent`);
  const progress = notes[0]?.params as { progressToken?: unknown; progress?: unknown; message?: unknown } | undefined;
  expect("the progress notification names the token, the count and the message", notes[0]?.method === "notifications/progress" && progress?.progressToken === "p1" && progress?.progress === 1 && progress?.message === "half");
  expect("tools/call echo returns the arguments as text", textOf(echo) === '{"a":1}', textOf(echo));
  expect("tools/call echo is not an error", resultOf(echo).isError === false);

  const quiet: Record<string, unknown>[] = [];
  await run(legacy("tools/call", { name: "echo", arguments: {} }), (m) => quiet.push(m));
  expect("no progress is sent when the client asked for none", quiet.length === 0);

  const boom = await run(legacy("tools/call", { name: "boom" }));
  expect("a thrown Error is a tool error the model can read", resultOf(boom).isError === true && textOf(boom) === "Error: bang", describe(boom));
  expect("a tool error is status 200, not a protocol error", boom.status === 200 && boom.reply.error === undefined);

  const proto = await run(legacy("tools/call", { name: "proto" }));
  expect("a McpError is a JSON-RPC error -32602", proto.reply.error?.code === -32602 && proto.reply.error?.message === "bad args", describe(proto));

  // 7. server/discover
  const discover = await run(modern("server/discover"));
  const versions = resultOf(discover).supportedVersions as string[] | undefined;
  expect("server/discover lists the supported versions", JSON.stringify(versions) === JSON.stringify(SUPPORTED_VERSIONS), describe(discover));
  expect("server/discover is decorated as modern", resultOf(discover).resultType === "complete");

  // 8. stdio: replies, cancellation and bad lines
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding("utf8");
  let out = "";
  output.on("data", (chunk: string) => {
    out += chunk;
  });
  const ended = new Promise<void>((resolve) => output.on("end", () => resolve()));
  const logs: string[] = [];
  const served = serveStdio(fake, input, output, (line) => logs.push(line));
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", clientInfo: { name: "t" }, capabilities: {} } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "slow" } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 7 } })}\n`);
  input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 8, method: "ping" })}\n`);
  input.write("this is not json\n");
  input.end();
  await served;
  output.end();
  await ended;

  const replies = out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as { id?: unknown; result?: Record<string, unknown>; error?: { code?: number } });
  expect("stdio: the initialize reply is written", replies.some((r) => r.id === 0 && (r.result as { protocolVersion?: string } | undefined)?.protocolVersion === "2025-06-18"));
  expect("stdio: the ping reply is written", replies.some((r) => r.id === 8 && r.result !== undefined));
  expect("stdio: a bad line gets a -32700 reply", replies.some((r) => r.error?.code === -32700));
  expect("stdio: the cancelled call writes no reply", !replies.some((r) => r.id === 7), `${replies.length} replies`);
  expect("stdio: nothing unexpected is logged", logs.length === 0, logs.join("; "));

  console.log(failures === 0 ? "\nall good" : `\n${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
