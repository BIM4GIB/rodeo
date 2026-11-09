// Checks the CLI's stdio entry (cli.ts) over in-memory streams: the protocol is read from the input
// and answered on the output, nothing but JSON reaches the output, and --help and an unknown option
// print to stderr only. Prints an ok line per check; exits 1 on any failure.
//
// Run: cd web && npx tsx src/features/mcp/cli.check.ts

import { PassThrough } from "node:stream";
import { runMcpCli, type CliIo } from "./cli.ts";
import type { HeadlessCore } from "./headless.ts";

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

// the format library is not needed to see the protocol work: a stand-in core answers formats
const core: HeadlessCore = {
  async readAny() {
    return { layers: 1 };
  },
  async writeAs() {
    return { bytes: new Uint8Array(), name: "x" };
  },
  formats: () => ({ read: ["vwx", "dxf"], write: ["dxf", "pdf"] }),
  describe: () => ({ layers: 1 }),
};

/** Fresh streams for one run: the check writes requests to input, and reads output and error back. */
function streams(): { io: CliIo; input: PassThrough; output: PassThrough; error: PassThrough } {
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  return { io: { input, output, error }, input, output, error };
}

/** Everything written to a stream: ends it, then reads it to the end. */
function collect(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let text = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      text += chunk;
    });
    stream.on("end", () => resolve(text));
    stream.end();
  });
}

/** One JSON-RPC message as a line. */
function line(message: unknown): string {
  return `${JSON.stringify(message)}\n`;
}

// a session: initialize, the notification, then two requests, one of them a tool call
const run = streams();
const served = runMcpCli([], core, "0.0.0", run.io);
run.input.write(
  line({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } } }),
);
run.input.write(line({ jsonrpc: "2.0", method: "notifications/initialized" }));
run.input.write(line({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
run.input.write(line({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "formats", arguments: {} } }));
run.input.end();
await served;

const outText = await collect(run.output);
const errText = await collect(run.error);
const replies = outText
  .split("\n")
  .filter((l) => l !== "")
  .map((l) => JSON.parse(l) as { id?: number; result?: Record<string, unknown> });
const ids = replies.map((r) => r.id).sort();
expect("the session gets three replies, one per request (the notification gets none)", replies.length === 3, `${replies.length} lines`);
expect("the replies are for ids 1, 2 and 3", JSON.stringify(ids) === "[1,2,3]", JSON.stringify(ids));
expect("initialize answers with the version it asked for", replies.find((r) => r.id === 1)?.result?.protocolVersion === "2025-06-18");
const names = ((replies.find((r) => r.id === 2)?.result?.tools ?? []) as { name: string }[]).map((t) => t.name);
expect("tools/list names the headless tools", names.includes("formats") && names.includes("convert") && names.includes("vwx_edit"));
const formatsText = JSON.stringify(replies.find((r) => r.id === 3)?.result ?? {});
expect("tools/call formats answers from the core", formatsText.includes("vwx") && formatsText.includes("pdf"));
expect("nothing is written to stderr on a normal session", errText === "", errText.slice(0, 80));

// --help: the usage goes to stderr, and nothing to stdout
const help = streams();
await runMcpCli(["--help"], core, "0.0.0", help.io);
const helpOut = await collect(help.output);
const helpErr = await collect(help.error);
expect("--help writes the usage to stderr and nothing to stdout", helpOut === "" && helpErr.startsWith("Usage: ") && helpErr.includes("claude mcp add rodeo-files"));

// an unknown option: an error on stderr, exit code 2, nothing to stdout
const unknown = streams();
await runMcpCli(["--bogus"], core, "0.0.0", unknown.io);
const unknownOut = await collect(unknown.output);
const unknownErr = await collect(unknown.error);
expect("an unknown option is an error on stderr with exit code 2", unknownOut === "" && unknownErr.includes("--bogus") && process.exitCode === 2);
process.exitCode = undefined;

// --cwd with no folder after it is the same kind of error
const noFolder = streams();
await runMcpCli(["--cwd"], core, "0.0.0", noFolder.io);
const noFolderErr = await collect(noFolder.error);
expect("--cwd with no folder is refused", noFolderErr.includes("--cwd needs a folder") && process.exitCode === 2);
process.exitCode = undefined;

if (failures > 0) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all good");
