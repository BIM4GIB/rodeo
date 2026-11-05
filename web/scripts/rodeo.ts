// The rodeo command (cli/ packages it as @rodeobuild/cli). In the repository: cd web && npx tsx scripts/rodeo.ts <command> …

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The converter is loaded only once the version is known to do: its modules use fs.glob, which an
// older Node refuses at load time, before it could say why.
const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  process.stderr.write(`Rodeo needs Node 22 or later; this is ${process.versions.node}.\n`);
  process.exitCode = 2;
} else {
  process.exitCode = await main();
}

/** Runs the command with the process's arguments and streams; resolves to the exit code. */
async function main(): Promise<number> {
  // node.ts first: the Node loaders for web-ifc, rhino3dm and rvt-rs, and the FileReader for glTF.
  const { setWasmDir } = await import("../src/convert/node.ts");
  const { addCommand, runCli } = await import("../src/convert/cli.ts");
  const core = await import("../src/convert/index.ts");
  const { runMcpCli } = await import("../src/features/mcp/cli.ts");
  const version = process.env.RODEO_VERSION ?? "dev";
  // rodeo mcp: the MCP server for agents over files on this computer; it writes nothing but protocol to stdout
  addCommand("mcp", "an MCP server for Claude, Cursor and other agents (--cwd <folder>)", async (args) => {
    await runMcpCli(args, core, version);
    return 0;
  });

  // The bundle (cli/build.mjs) carries rvt_bg.wasm in the folder it writes, beside this file.
  const here = dirname(fileURLToPath(import.meta.url));
  if (existsSync(join(here, "rvt_bg.wasm"))) setWasmDir(here);

  return runCli(process.argv.slice(2), {
    out: (text) => {
      process.stdout.write(text);
    },
    err: (text) => {
      process.stderr.write(text);
    },
    tty: process.stderr.isTTY === true,
    version,
    cwd: process.cwd(),
  });
}
