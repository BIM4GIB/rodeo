// Checks the command line under Node. Run from web/:
//   npx tsx src/convert/cli.check.ts
// Each command runs through runCli on a temp folder holding two copies of the fixture drawing, with
// a capturing io: the exit codes, the files written, the JSON and the text printed are compared with
// what the command line promises. With CLI_BUILD=1 it also builds the bundle (cli/build.mjs) and runs
// the bundled rodeo.mjs from a folder outside the repository, which proves the wasm readers and the
// FileReader shim are carried into the bundle.

import "./node.ts";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { addCommand, runCli, type CliIo } from "./cli.ts";
import { fixtureVwx } from "./fixture.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);
const here = fileURLToPath(new URL(".", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "rodeo-cli-"));
writeFileSync(join(dir, "a.vwx"), fixtureVwx());
writeFileSync(join(dir, "b.vwx"), fixtureVwx());
const a = join(dir, "a.vwx");

/** Runs the command line with a capturing io, in the temp folder. */
async function run(argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const io: CliIo = { out: (t) => (out += t), err: (t) => (err += t), tty: false, version: "dev", cwd: dir };
  const code = await runCli(argv, io);
  return { code, out, err };
}

try {
  // the formats table and its JSON
  const formatsText = await run(["formats"]);
  check(formatsText.code === 0 && formatsText.out.includes("IFC") && formatsText.out.includes("Revit"), "formats lists IFC and Revit");
  const formatsJson = await run(["formats", "--json"]);
  const listed = formatsJson.code === 0 ? JSON.parse(formatsJson.out) : null;
  check(listed !== null && listed.read.includes("rvt"), "formats --json parses and reads rvt");

  // one file to a named output, in a folder that isn't there yet
  const ifc = await run(["convert", a, join(dir, "out", "a.ifc")]);
  check(ifc.code === 0 && decode(readFileSync(join(dir, "out", "a.ifc")).subarray(0, 12)) === "ISO-10303-21", "convert a.vwx to a.ifc makes a STEP-coded IFC");

  // many files to --to, into --out
  const pdfs = await run(["convert", `${dir}/*.vwx`, "--to", "pdf", "--out", `${dir}/pdfs`]);
  const pdfFiles = existsSync(join(dir, "pdfs")) ? readdirSync(join(dir, "pdfs")).sort() : [];
  check(pdfs.code === 0 && pdfFiles.join(",") === "a.pdf,b.pdf", `batch converts both files to PDF (${pdfFiles.join(",")})`);
  check(pdfFiles.every((f) => decode(readFileSync(join(dir, "pdfs", f)).subarray(0, 4)) === "%PDF"), "each PDF starts %PDF");

  // a rerun skips what is there; --force replaces it
  const again = await run(["convert", `${dir}/*.vwx`, "--to", "pdf", "--out", `${dir}/pdfs`, "--json"]);
  const againJson = JSON.parse(again.out);
  check(again.code === 0 && againJson.results.length === 2 && againJson.results.every((r: { skipped: boolean }) => r.skipped), "a rerun skips both files already there");
  const forced = await run(["convert", `${dir}/*.vwx`, "--to", "pdf", "--out", `${dir}/pdfs`, "--json", "--force"]);
  check(forced.code === 0 && JSON.parse(forced.out).results.every((r: { skipped: boolean }) => r.skipped === false), "--force converts both again");

  // refusals and failures
  const dwg = await run(["convert", a, join(dir, "a.dwg")]);
  check(dwg.code === 2 && dwg.err.includes("Rodeo doesn't write DWG"), "writing a .dwg is a usage error that offers DXF");
  const missing = await run(["convert", join(dir, "missing.dwg"), join(dir, "x.pdf")]);
  check(missing.code === 1 && missing.err.includes("Could not read"), "a missing input is a failed file, exit 1");
  const same = await run(["convert", a, a]);
  check(same.code === 2, "an output that is the input is a usage error");
  const unknown = await run(["frobnicate"]);
  check(unknown.code === 2, "an unknown command is a usage error");
  const version = await run(["--version"]);
  check(version.code === 0 && version.out === "dev\n", "--version prints the version and nothing else");
  const bothAxes = await run(["convert", "--y-up", "--z-up", a, "x.stl"]);
  check(bothAxes.code === 2, "--y-up with --z-up is a usage error");
  const badUnit = await run(["convert", a, join(dir, "x.stl"), "--units", "furlong"]);
  check(badUnit.code === 2 && badUnit.err.includes("--units takes"), "an unknown unit is a usage error");
  const wrongOption = await run(["info", a, "--to", "pdf"]);
  check(wrongOption.code === 2 && wrongOption.err.includes("doesn't apply to info"), "an option the command doesn't take is a usage error");
  const noOutput = await run(["convert", a]);
  check(noOutput.code === 2, "convert with one file and no --to is a usage error");

  // a batch with one bad file: the JSON carries the failure, the exit is 1
  const mixed = await run(["convert", a, join(dir, "nope.vwx"), "--to", "svg", "--out", "svgs", "--json"]);
  const mixedJson = JSON.parse(mixed.out);
  check(mixed.code === 1 && mixedJson.ok === false && mixedJson.results[1].ok === false && mixedJson.results[1].error.startsWith("Could not read"), "a failed file in a batch is listed in the JSON and exits 1");

  // two inputs that map to one name get -2
  const dup = await run(["convert", a, join(dir, "a.vwx"), "--to", "ifc", "--out", "dup", "--json"]);
  const dupOutputs = JSON.parse(dup.out).results.map((r: { output: string }) => r.output);
  check(dup.code === 0 && dupOutputs.join(",") === "dup/a.ifc,dup/a-2.ifc", `a repeated input gets a -2 name (${dupOutputs.join(",")})`);

  // info, as text and as JSON
  const infoJson = await run(["info", a, "--json"]);
  const info = JSON.parse(infoJson.out);
  check(infoJson.code === 0 && info.units === "Millimeters" && info.layers.length === 2, "info --json gives the units and two layers");
  const infoText = await run(["info", a]);
  check(infoText.code === 0 && infoText.out.includes("Units      Millimeters"), "info prints the units line");

  // a command a feature adds gets the rest of its arguments, and nothing else reaches stdout
  addCommand("check-echo", "a command the checks add", async (args, io) => {
    io.out(`${args.join(" ")}\n`);
    return 0;
  });
  const echo = await run(["check-echo", "x", "--y"]);
  check(echo.code === 0 && echo.out === "x --y\n" && echo.err === "", "an added command gets its arguments and its output is all that prints");
  check((await run(["help"])).out.includes("rodeo check-echo"), "an added command has its line in the help");
  let refused = false;
  try {
    addCommand("check-echo", "again", async () => 0);
  } catch {
    refused = true;
  }
  check(refused, "adding a command under a taken name is refused");
  check((await run(["check-echo"])).code === 0, "an added command runs again");

  // the bundle, built and run from outside the repository
  if (process.env.CLI_BUILD === "1") {
    const webDir = resolve(here, "../..");
    const build = spawnSync(process.execPath, [resolve(webDir, "../cli/build.mjs")], { cwd: webDir, stdio: "inherit" });
    check(build.status === 0, "cli/build.mjs builds the bundle");
    const bundleDir = mkdtempSync(join(tmpdir(), "rodeo-bundle-"));
    cpSync(resolve(webDir, "../cli/dist"), bundleDir, { recursive: true });
    const rodeo = join(bundleDir, "rodeo.mjs");
    const shebang = readFileSync(rodeo, "utf8").split("\n")[0];
    check(shebang === "#!/usr/bin/env node", "the bundle starts with a node shebang");
    const node = (args: string[]) => spawnSync(process.execPath, [rodeo, ...args], { cwd: dir, encoding: "utf8" });
    const bundleFormats = node(["formats", "--json"]);
    check(bundleFormats.status === 0 && JSON.parse(bundleFormats.stdout).read.includes("rvt"), "the bundle lists the formats");
    check(node(["convert", a, join(dir, "bundle", "a.3dm")]).status === 0, "the bundle writes Rhino 3DM (the rhino wasm is beside it)");
    check(node(["convert", a, join(dir, "bundle", "a.glb")]).status === 0, "the bundle writes glTF (the FileReader shim)");
    check(node(["convert", a, join(dir, "bundle", "a.ifc")]).status === 0, "the bundle writes IFC");
    const back = node(["convert", join(dir, "bundle", "a.ifc"), join(dir, "bundle", "a2.obj")]);
    check(back.status === 0, "the bundle reads IFC back (web-ifc)");
    writeFileSync(join(dir, "junk.rvt"), "abc");
    const junk = node(["convert", join(dir, "junk.rvt"), join(dir, "bundle", "x.ifc")]);
    check(junk.status === 1 && junk.stderr.includes("this isn't a Revit file"), "a three-byte .rvt is refused by the Revit reader");
    rmSync(bundleDir, { recursive: true, force: true });
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures ? `${failures} failed` : "all passed");
process.exit(failures ? 1 : 0);
