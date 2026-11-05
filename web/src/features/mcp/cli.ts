// `rodeo mcp`: Rodeo as a local MCP server on stdin and stdout, over the files on this computer,
// for the convert CLI to run. Stdout carries only protocol messages; usage and errors go to stderr,
// because an agent reads stdout as the protocol. Run it with tsx or from a bundle, not with plain
// node: headless.ts loads the format library, which uses constructor parameter properties that
// Node's type stripping refuses.

import { resolve } from "node:path";
import { headlessServer, type HeadlessCore } from "./headless.ts";
import { serveStdio } from "./rpc.ts";

/** The streams the server reads requests from, answers on, and writes its usage and errors to. */
export interface CliIo {
  readonly input: NodeJS.ReadableStream;
  readonly output: NodeJS.WritableStream;
  readonly error: NodeJS.WritableStream;
}

const USAGE = [
  "Usage: rodeo mcp [--cwd <dir>]",
  "Runs Rodeo as an MCP server on stdin/stdout for Claude Code, Claude Desktop, Cursor and other agents.",
  "Claude Code: claude mcp add rodeo-files -- npx -y @rodeobuild/cli mcp",
].join("\n");

/**
 * Runs the stdio server for the words after `mcp`. --cwd sets the folder relative paths resolve
 * against (the folder the server was started in by default); --help prints the usage.
 */
export async function runMcpCli(argv: readonly string[], core: HeadlessCore, version: string, io?: CliIo): Promise<void> {
  const streams: CliIo = io ?? { input: process.stdin, output: process.stdout, error: process.stderr };
  let cwd = process.cwd();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      streams.error.write(`${USAGE}\n`);
      return;
    }
    if (arg === "--cwd" && argv[i + 1] !== undefined) {
      cwd = resolve(argv[i + 1]);
      i++;
      continue;
    }
    // an option this server doesn't know (or --cwd with no folder after it): say so, and exit with 2 as a usage error does
    const problem = arg === "--cwd" ? "--cwd needs a folder." : `Unknown option ${arg}.`;
    streams.error.write(`${problem}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  await serveStdio(headlessServer(core, { cwd, version }), streams.input, streams.output, (line) => {
    streams.error.write(`${line}\n`);
  });
}
