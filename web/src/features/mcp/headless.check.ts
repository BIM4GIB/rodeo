// Checks the files half of the MCP server (headless.ts) against a fake converter core in a
// temporary folder: the tool list, making, reading and editing .vwx drawings through the real
// format library, modelling in one, and the converter's refusals. Nothing under samples/ is read.
//
// Run: cd web && npx tsx src/features/mcp/headless.check.ts

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openVwx } from "../../core/index.ts";
import { headlessServer, type HeadlessCore } from "./headless.ts";
import type { McpCallResult } from "./wire.ts";

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function textOf(r: McpCallResult): string {
  return r.content.map((p) => (p.type === "text" ? p.text : "")).join("");
}

/** The fake converter: it reads any file as its name and size, and writes "converted" for any format asked. */
const fake: HeadlessCore = {
  async readAny(bytes, name) {
    return { name, size: bytes.length };
  },
  async writeAs(_drawing, format) {
    return { bytes: new TextEncoder().encode("converted"), name: `x.${format}` };
  },
  formats() {
    return { read: ["vwx", "dxf"], write: ["dxf", "pdf"] };
  },
  describe(drawing) {
    return { layers: 1, name: (drawing as { name: string }).name };
  },
};

const dir = mkdtempSync(join(tmpdir(), "rodeo-headless-"));

async function main(): Promise<void> {
  try {
    const server = headlessServer(fake, { cwd: dir, version: "0.0.0-check" });
    const call = (name: string, args: Record<string, unknown>): Promise<McpCallResult> =>
      server.callTool(name, args, { signal: new AbortController().signal, progress() {}, client: null });
    const file = (name: string): string => join(dir, name);
    const open = (name: string) => openVwx(new Uint8Array(readFileSync(file(name))), name);

    const names = (await server.listTools()).map((t) => t.name).join(",");
    expect("the tools are listed in order", names === "formats,inspect,convert,vwx_new,vwx_read,vwx_edit,vwx_build", names);

    const made = await call("vwx_new", { path: "a.vwx" });
    expect("vwx_new makes a drawing that openVwx opens", !made.isError && existsSync(file("a.vwx")) && open("a.vwx").doc.layers().length > 0);

    const again = await call("vwx_new", { path: "a.vwx" });
    expect("vwx_new refuses to replace a file without overwrite", again.isError && textOf(again).includes("overwrite: true"));

    const layers = await call("vwx_read", { path: "a.vwx", method: "layers" });
    expect("vwx_read pages a list: a new drawing has one layer", !layers.isError && JSON.parse(textOf(layers)).total === 1, textOf(layers).slice(0, 80));

    const edited = await call("vwx_edit", { path: "a.vwx", steps: [["createLayer", "Check", "design", 50]] });
    expect("vwx_edit writes a-edited.vwx beside the input", !edited.isError && existsSync(file("a-edited.vwx")));
    expect("the edited drawing has the new layer", open("a-edited.vwx").doc.layers().some((l) => l.name === "Check"));

    const bogus = await call("vwx_edit", { path: "a.vwx", steps: [["notAMethod"]] });
    expect("an unknown edit is refused and named", bogus.isError && textOf(bogus).includes("notAMethod"));

    const built = await call("vwx_build", {
      path: "a.vwx",
      layer: "Model",
      elements: [{ kind: "box", at: { x: 0, y: 0 }, size: [1000, 1000, 1000] }],
      output: "b.vwx",
    });
    const buildResult = built.isError ? { objects: 0, closed: "" } : (JSON.parse(textOf(built)) as { objects: number; closed: string });
    expect("vwx_build models a box in a new design layer", !built.isError && buildResult.objects >= 1, textOf(built).slice(0, 120));
    expect("vwx_build says whether the solids are closed", buildResult.closed.includes("closed"), buildResult.closed);
    expect("vwx_build wrote b.vwx", existsSync(file("b.vwx")));

    const inspected = await call("inspect", { path: "a.vwx" });
    expect("inspect hands the file to the core's describe", !inspected.isError && textOf(inspected).includes('"layers":1'), textOf(inspected));

    const dxf = await call("convert", { path: "a.vwx", to: "dxf" });
    expect("convert writes beside the input under the name the core gives", !dxf.isError && existsSync(file("x.dxf")));

    const stl = await call("convert", { path: "a.vwx", to: "stl" });
    expect("convert to a format the core doesn't write lists the ones it does", stl.isError && textOf(stl).includes("dxf, pdf"), textOf(stl));

    expect("the instructions name the edits (the drawing's types were read)", server.instructions().includes("addObjects"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(failures ? `${failures} check${failures === 1 ? "" : "s"} failed` : "all headless checks passed");
  process.exitCode = failures ? 1 : 0;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
