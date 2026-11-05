// The converter's command line: `rodeo convert`, `rodeo info` and `rodeo formats`, plus any command a
// feature adds with addCommand (the MCP server's `rodeo mcp`). It reads and writes files on this
// computer through the converter (index.ts) and nothing else: no network, no editor. The entry
// (web/scripts/rodeo.ts) loads node.ts and passes in the process's streams; this module doesn't load
// node.ts itself. Only a command's own output goes to stdout, so a command that speaks a protocol on
// stdout is not disturbed.

import type { Stats } from "node:fs";
import { glob, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  describe,
  formatById,
  formatInfo,
  formatOfName,
  formats,
  outputFormat,
  readAny,
  summaryText,
  writeAs,
  type HeadlessDrawing,
  type ReadOptions,
  type Unit,
  type WrittenFile,
} from "./index.ts";

/** What the command line writes, and what it knows of the terminal and the folder it runs in. */
export interface CliIo {
  /** stdout: a line or more, newlines included; the caller adds nothing */
  out(text: string): void;
  /** stderr */
  err(text: string): void;
  /** stderr is a terminal, so progress lines can be drawn on it */
  readonly tty: boolean;
  readonly version: string;
  /** the folder relative paths are taken from */
  readonly cwd: string;
}

/** The npm package the command is published as. */
export const PACKAGE = "@rodeo.build/cli";

/** What runs a command: it gets the arguments after the command's name and gives the exit code. */
type Command = (args: string[], io: CliIo) => Promise<number>;

const BUILT_IN = ["convert", "info", "formats", "help"];
const added = new Map<string, { help: string; run: Command }>();

/**
 * Adds a command, such as the MCP server's `rodeo mcp`: `help` is its line in the help, after
 * `rodeo <name>`, and `run` gets the arguments after the name.
 */
export function addCommand(name: string, help: string, run: (args: string[], io: CliIo) => Promise<number>): void {
  // a second command under the same name would silently replace the first, so it is refused
  if (!/^[a-z][a-z-]*$/.test(name) || BUILT_IN.includes(name) || added.has(name)) {
    throw new Error(`rodeo can't add the command ${name}: its name is taken or isn't a plain word`);
  }
  added.set(name, { help, run });
}

/** A command used wrong: the exit code is 2 and the message says how to fix it. */
class UsageError extends Error {}

const UNITS = ["mm", "cm", "m", "in", "ft"] as const;
/** A file of this size or more is refused: Node reads a file into one buffer, and that is the limit. */
const TWO_GB = 2 * 1024 ** 3;
/** An input that contains one of these is a glob, when no file of that name exists. */
const GLOB = /[*?[]/;

const OPTIONS = {
  to: { type: "string" },
  out: { type: "string" },
  layer: { type: "string", multiple: true },
  "dxf-layers": { type: "string" },
  units: { type: "string" },
  "y-up": { type: "boolean" },
  "z-up": { type: "boolean" },
  page: { type: "string" },
  scale: { type: "string" },
  force: { type: "boolean" },
  json: { type: "boolean" },
  quiet: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

/** The options each command takes; --help and --version are taken by all. */
const CONVERT_OPTIONS = ["to", "out", "layer", "dxf-layers", "units", "y-up", "z-up", "page", "scale", "force", "json", "quiet"];
const INFO_OPTIONS = ["units", "y-up", "z-up", "page", "scale", "json"];
const FORMATS_OPTIONS = ["json"];

/** A command's arguments split into options and files; an option the command doesn't take is a usage error. */
function parseCommand(command: string, args: string[], allowed: readonly string[]) {
  let parsed;
  try {
    parsed = parseArgs({ args, options: OPTIONS, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(reason(err));
  }
  const taken = [...allowed, "help", "version"];
  for (const [flag, value] of Object.entries(parsed.values)) {
    if (value !== undefined && value !== false && !taken.includes(flag)) throw new UsageError(`--${flag} doesn't apply to ${command}.`);
  }
  return parsed;
}

type Values = ReturnType<typeof parseCommand>["values"];

/** The options that say how a file is read and written, checked. */
interface Settings {
  readonly units?: Unit;
  readonly yUp?: boolean;
  readonly page?: number;
  readonly scale?: number;
  readonly layers?: string[];
  readonly dxfLayers?: "layers" | "classes";
}

/** The settings the options give, refusing a value that isn't one of the ones the option takes. */
function settings(values: Values): Settings {
  if (values["y-up"] && values["z-up"]) throw new UsageError("--y-up and --z-up can't both be given: a file has one up axis.");
  const units = UNITS.find((u) => u === values.units);
  if (values.units !== undefined && units === undefined) throw new UsageError(`--units takes mm, cm, m, in or ft, not ${values.units}.`);
  let page: number | undefined;
  if (values.page !== undefined) {
    page = Number(values.page);
    if (!/^\d+$/.test(values.page) || page < 1) throw new UsageError(`--page takes a page number from 1, not ${values.page}.`);
  }
  let scale: number | undefined;
  if (values.scale !== undefined) {
    scale = Number(values.scale);
    if (!Number.isFinite(scale) || scale <= 0) throw new UsageError(`--scale takes a number above 0, not ${values.scale}.`);
  }
  const dxf = values["dxf-layers"];
  if (dxf !== undefined && dxf !== "layers" && dxf !== "classes") throw new UsageError(`--dxf-layers takes layers or classes, not ${dxf}.`);
  return {
    units,
    yUp: values["y-up"] ? true : values["z-up"] ? false : undefined,
    page,
    scale,
    layers: values.layer,
    dxfLayers: dxf,
  };
}

/** The read options for a file, with the progress line that goes with them. */
function readOptionsOf(s: Settings, progress: ((step: string) => void) | undefined): ReadOptions {
  return { units: s.units, yUp: s.yUp, page: s.page, scale: s.scale, progress };
}

/** The progress line a long read draws on stderr when the terminal shows it, else nothing. */
function progressLine(io: CliIo, input: string, enabled: boolean): ((step: string) => void) | undefined {
  return enabled ? (step) => io.err(`\r\x1b[K${input}: ${step}…`) : undefined;
}

/** The message of an error, or the error as text. */
function reason(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A file's status, or null when there is nothing at the path. */
async function statOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

/** Whether the path is a folder. */
async function isFolder(path: string): Promise<boolean> {
  return (await statOrNull(path))?.isDirectory() === true;
}

/** The bytes of a file to read, or the plain reason it can't be read. */
async function readInput(path: string): Promise<Uint8Array> {
  let size: number;
  try {
    size = (await stat(path)).size;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") throw new Error("it isn't there");
    throw err;
  }
  if (size >= TWO_GB) throw new Error("it's over 2 GB, more than Node reads in one piece");
  return readFile(path);
}

/**
 * The input files the arguments name. A glob that names no existing file is expanded to the files
 * it matches, sorted; a plain name is kept as given, even when nothing is there (reading it then
 * says so).
 */
async function inputsOf(patterns: readonly string[], cwd: string): Promise<string[]> {
  const files: string[] = [];
  for (const p of patterns) {
    const plain = await statOrNull(resolve(cwd, p));
    if (plain === null && GLOB.test(p)) {
      const matches: string[] = [];
      for await (const m of glob(p, { cwd })) {
        if ((await statOrNull(resolve(cwd, m)))?.isFile()) matches.push(m);
      }
      if (matches.length === 0) throw new UsageError(`Nothing matches ${p}.`);
      files.push(...matches.sort());
    } else if (plain?.isDirectory()) {
      throw new UsageError(`${p} is a folder: use a glob such as "${p}/*.dwg".`);
    } else {
      files.push(p);
    }
  }
  return files;
}

/** What one file's conversion came to: the entry the results list shows, in JSON or in plain lines. */
interface Item {
  readonly input: string;
  readonly ok: boolean;
  readonly skipped?: boolean;
  readonly output?: string;
  readonly format?: string;
  readonly from?: string | null;
  readonly bytes?: number;
  readonly ms?: number;
  readonly leftOut?: Readonly<Record<string, number>>;
  readonly notes?: readonly string[];
  readonly error?: string;
}

/** Reads `input` and writes it as `format` to `output` (both as given, relative to cwd), and says what came of it. */
async function convertFile(input: string, output: string, format: string, s: Settings, io: CliIo, progress: boolean): Promise<Item> {
  const started = performance.now();
  let drawing: HeadlessDrawing;
  try {
    drawing = await readAny(await readInput(resolve(io.cwd, input)), basename(input), readOptionsOf(s, progressLine(io, input, progress)));
  } catch (err) {
    return { input, ok: false, error: `Could not read ${input}: ${reason(err)}` };
  }
  let written: WrittenFile;
  try {
    written = await writeAs(drawing, format, { layers: s.layers, dxfLayers: s.dxfLayers });
  } catch (err) {
    return { input, ok: false, error: `Could not write ${output}: ${reason(err)}` };
  }
  try {
    // a single output may name a folder that isn't there yet, as --out does for many
    await mkdir(dirname(resolve(io.cwd, output)), { recursive: true });
    await writeFile(resolve(io.cwd, output), written.bytes);
  } catch (err) {
    return { input, ok: false, error: `Could not write ${output}: ${reason(err)}` };
  }
  return {
    input,
    ok: true,
    skipped: false,
    output,
    format,
    from: drawing.from,
    bytes: written.bytes.byteLength,
    ms: Math.round(performance.now() - started),
    leftOut: drawing.skipped,
    notes: [...drawing.notes, ...written.notes],
  };
}

/** A byte count for people: "512 B", "210 KB", "12.4 MB". */
function sizeText(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(1)} GB`;
}

/** Prints one file's result in plain form: its line, then what was left out and the notes. Errors print even with --quiet. */
function report(item: Item, io: CliIo, quiet: boolean): void {
  if (!item.ok) {
    io.err(`${item.error}\n`);
    return;
  }
  if (quiet) return;
  if (item.skipped) {
    io.out(`${item.input} → ${item.output}  already there, skipped\n`);
    return;
  }
  io.out(`${item.input} → ${item.output}  ${sizeText(item.bytes ?? 0)}  ${((item.ms ?? 0) / 1000).toFixed(1)} s\n`);
  for (const [kind, n] of Object.entries(item.leftOut ?? {})) {
    if (n > 0) io.out(`  left out: ${kind} ${n.toLocaleString("en")}\n`);
  }
  for (const note of item.notes ?? []) io.out(`  note: ${note}\n`);
}

/** Why a name can't be an output: DWG is refused with the DXF to write instead; other names give the extensions Rodeo writes. */
function unwritable(input: string, output: string): string {
  const ext = extname(output).slice(1).toLowerCase();
  if (ext === "dwg") return `Rodeo doesn't write DWG. Write DXF, which AutoCAD opens: rodeo convert ${input} ${output.replace(/\.dwg$/i, ".dxf")}`;
  const writes = formatInfo().flatMap((f) => f.writeExtensions).map((e) => `.${e}`).join(", ");
  return ext ? `Rodeo doesn't write .${ext} files. It writes: ${writes}.` : `Rodeo doesn't write files with no extension. It writes: ${writes}.`;
}

/** `rodeo convert`: one file to the output named, or many files to --to a format, in --out or beside each input. */
async function convert(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseCommand("convert", args, CONVERT_OPTIONS);
  const early = earlyExit(values, io);
  if (early !== null) return early;
  const s = settings(values);
  const json = values.json === true;
  const quiet = values.quiet === true;
  const progress = io.tty && !quiet && !json;
  const results: Item[] = [];

  if (values.to === undefined) {
    if (positionals.length !== 2) throw new UsageError("convert takes an input file and an output file: rodeo convert <input> <output>. For many files, give --to <format>.");
    if (values.out !== undefined) throw new UsageError("--out goes with --to: name the output file instead.");
    const files = await inputsOf([positionals[0]], io.cwd);
    if (files.length > 1) throw new UsageError(`${positionals[0]} matches ${files.length} files: give --to <format> and --out <folder> to convert several.`);
    const [input] = files;
    const output = positionals[1];
    if (await isFolder(resolve(io.cwd, output))) throw new UsageError(`${output} is a folder: name the output file, or use --to with --out.`);
    const format = outputFormat(output);
    if (format === null) throw new UsageError(unwritable(input, output));
    if (resolve(io.cwd, input) === resolve(io.cwd, output)) throw new UsageError("The output would replace the input.");
    const item = await convertFile(input, output, format, s, io, progress);
    if (progress) io.err("\r\x1b[K");
    results.push(item);
    if (!json) report(item, io, quiet);
  } else {
    const format = outputFormat(values.to);
    if (format === null) throw new UsageError(`--to ${values.to} isn't a format Rodeo writes. It writes: ${formats().write.join(", ")}.`);
    if (positionals.length === 0) throw new UsageError("convert needs the files to convert: rodeo convert <inputs…> --to <format>.");
    const files = await inputsOf(positionals, io.cwd);
    const ext = formatById(format)?.writeExtensions[0] ?? format;
    // two inputs that map to one name get -2, -3… so that neither overwrites the other in this run
    const taken = new Set<string>();
    const plan = files.map((input) => {
      const dir = values.out ?? dirname(input);
      const base = basename(input, extname(input));
      let n = 1;
      let output = join(dir, `${base}.${ext}`);
      while (taken.has(resolve(io.cwd, output))) {
        n++;
        output = join(dir, `${base}-${n}.${ext}`);
      }
      taken.add(resolve(io.cwd, output));
      if (resolve(io.cwd, output) === resolve(io.cwd, input)) throw new UsageError("The output would replace the input.");
      return { input, output };
    });
    for (const { input, output } of plan) {
      const existing = await statOrNull(resolve(io.cwd, output));
      let item: Item;
      if (existing?.isFile() && !values.force) {
        item = { input, ok: true, skipped: true, output, format, from: formatOfName(input), bytes: existing.size, ms: 0, leftOut: {}, notes: [] };
      } else {
        item = await convertFile(input, output, format, s, io, progress);
      }
      if (progress) io.err("\r\x1b[K");
      results.push(item);
      if (!json) report(item, io, quiet);
    }
  }

  const failed = results.filter((r) => !r.ok).length;
  if (json) {
    io.out(`${JSON.stringify({ ok: failed === 0, results }, null, 2)}\n`);
  } else if (results.length > 1 && !quiet) {
    const converted = results.filter((r) => r.ok && !r.skipped).length;
    const skipped = results.filter((r) => r.skipped).length;
    const extra = skipped > 0 ? `, ${skipped} skipped (already there; --force replaces them)` : "";
    io.out(`${converted} of ${results.length} converted${extra}.\n`);
  }
  return failed === 0 ? 0 : 1;
}

/** `rodeo info <file>`: the file's units, layers, objects, extent, 3D model and what was left out. */
async function info(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseCommand("info", args, INFO_OPTIONS);
  const early = earlyExit(values, io);
  if (early !== null) return early;
  if (positionals.length !== 1) throw new UsageError("info takes one file: rodeo info <file>.");
  const [file] = positionals;
  if (await isFolder(resolve(io.cwd, file))) throw new UsageError(`${file} is a folder: info reads one file.`);
  const s = settings(values);
  const json = values.json === true;
  const progress = io.tty && !json;
  try {
    const drawing = await readAny(await readInput(resolve(io.cwd, file)), basename(file), readOptionsOf(s, progressLine(io, file, progress)));
    const summary = describe(drawing);
    io.out(json ? `${JSON.stringify({ file, ...summary }, null, 2)}\n` : `${summaryText(summary).join("\n")}\n`);
    return 0;
  } catch (err) {
    const error = `Could not read ${file}: ${reason(err)}`;
    if (json) io.out(`${JSON.stringify({ file, ok: false, error }, null, 2)}\n`);
    else io.err(`${error}\n`);
    return 1;
  } finally {
    if (progress) io.err("\r\x1b[K");
  }
}

/** `rodeo formats`: the formats Rodeo reads and writes, as a table or as JSON. */
async function formatsList(args: string[], io: CliIo): Promise<number> {
  const { values, positionals } = parseCommand("formats", args, FORMATS_OPTIONS);
  const early = earlyExit(values, io);
  if (early !== null) return early;
  if (positionals.length > 0) throw new UsageError("formats takes no files: rodeo formats.");
  const list = formatInfo();
  if (values.json) {
    io.out(`${JSON.stringify({ ...formats(), formats: list }, null, 2)}\n`);
    return 0;
  }
  const rows = list.map((f) => [
    f.long,
    f.readExtensions.length > 0 ? "yes" : "no",
    f.writeExtensions.length > 0 ? "yes" : "no",
    [...new Set([...f.readExtensions, ...f.writeExtensions])].join(", "),
  ]);
  const head = ["Format", "Reads", "Writes", "Extensions"];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]): string => `${cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd()}\n`;
  io.out(line(head) + rows.map(line).join("") + "\n" + "PNG is written by the converter page (rodeo.build/convert), not here.\n");
  return 0;
}

/** What --help and --version do, with any command: prints it and gives 0; otherwise null. */
function earlyExit(values: Values, io: CliIo): number | null {
  if (values.help) {
    io.out(helpText());
    return 0;
  }
  if (values.version) {
    io.out(`${io.version}\n`);
    return 0;
  }
  return null;
}

/** The help the command line prints: its commands (with the ones features added), options and exit codes. */
function helpText(): string {
  const extra = [...added].map(([name, c]) => `  ${`rodeo ${name}`.padEnd(37)}${c.help}\n`).join("");
  return `Rodeo converts CAD and 3D files: Vectorworks, Revit, Archicad, DWG, DXF, SketchUp, IFC, Rhino and more.
Nothing is uploaded: files are read and written on this computer.

Usage
  rodeo convert <input> <output>       convert one file; the output's extension picks the format
  rodeo convert <inputs…> --to <format> [--out <folder>]
                                       convert many files (globs such as "plans/*.dwg" work too)
  rodeo info <file>                    layers, object counts, extent and units
  rodeo formats                        what Rodeo reads and writes
  rodeo help, rodeo --version
${extra}
Options
  --to <format>        the format to write: ifc, pdf, dxf, glb, step… (rodeo formats lists them)
  --out <folder>       where converted files go, made if missing; default beside each input
  --layer <name>       write only this layer; repeat for more
  --dxf-layers <how>   DXF: "classes" or "layers" become DXF layers (default classes for DWG and DXF input)
  --units <unit>       OBJ, STL, PLY, 3DS input: mm, cm, m, in or ft (default m; mm for STL)
  --y-up, --z-up       OBJ, STL, PLY, 3DS input: the up axis (default y for OBJ, z for the others)
  --page <n>           PDF input: the page to convert (default 1)
  --scale <n>          PDF and EMF input: place at 1:n (default 1)
  --force              replace files already in the --out folder
  --json               print results as JSON, for scripts
  --quiet              print only errors

Exit codes: 0 done, 1 a file failed, 2 the command was wrong.
`;
}

/** Routes argv to its command; a command the converter doesn't know is a usage error. */
async function dispatch(argv: string[], io: CliIo): Promise<number> {
  const [first, ...rest] = argv;
  if (first === undefined) {
    io.err(helpText());
    return 2;
  }
  switch (first) {
    case "help":
    case "--help":
    case "-h":
      io.out(helpText());
      return 0;
    case "--version":
    case "-v":
      io.out(`${io.version}\n`);
      return 0;
    case "convert":
      return convert(rest, io);
    case "info":
      return info(rest, io);
    case "formats":
      return formatsList(rest, io);
  }
  const command = added.get(first);
  if (command) return command.run(rest, io);
  throw new UsageError(`Rodeo has no command ${first}. Run rodeo help for the commands.`);
}

/**
 * Runs the command line on its arguments (those after the program's name) and resolves to the exit
 * code: 0 done or skipped, 1 a file failed, 2 the command was wrong. With --json a usage error is one
 * JSON object on stdout; otherwise it goes to stderr.
 */
export async function runCli(argv: string[], io: CliIo): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (err) {
    const usage = err instanceof UsageError;
    const message = usage ? err.message : `Rodeo stopped: ${reason(err)}`;
    if (argv.includes("--json")) io.out(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`);
    else io.err(`${message}\n`);
    return usage ? 2 : 1;
  }
}
