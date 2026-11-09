// SolidWorks, Inventor, FreeCAD, Fusion 360, NX and Creo parts, the reading side (no DOM). cadmpeg, a Rust
// library compiled to WebAssembly, turns a part's file into a STEP file, and readStep (step.ts) reads that
// as it reads any STEP file: the part comes in as a STEP import's does, its shapes as parts, coloured where
// the STEP keeps colour. The top of the tree is named after the file and the app it came from ("Bracket
// (SolidWorks part)"). cadmpeg's warnings (what it could not convert) come back with the model, and a file it
// can't read, or one with no shapes in it (a file of sketches or drawings), is refused with the reason.
//
// Each format has its own module and WebAssembly (vendor/cadmpeg/<format>), loaded only for a file of that
// format, once. A .prt is NX or Creo: NX is tried first, Creo only when NX can't read it. The modules are
// built to abort on a panic, which leaves the module unusable, so a browser converts in a worker
// (app/nativeImport.worker.ts) that the page ends after such a trap; Node calls the modules directly.

import type { MeshFile } from "./mesh.ts";
import type { Occt } from "./occt.ts";
import { readStep } from "./step.ts";

/** The formats cadmpeg reads, each with its own module and WebAssembly. */
export type CadFormat = "sldprt" | "inventor" | "fcstd" | "f3d" | "nx" | "creo";

/** What a format's to_step gives, as the module's Converted object does: the STEP file, the format read, its support level and its warnings (a JSON array of strings). */
export interface CadmpegConverted {
  readonly step: Uint8Array;
  readonly format: string;
  readonly level: number;
  readonly warnings: string;
  free(): void;
}

/** A format's module, loaded: to_step turns a file's bytes into a STEP file, or throws with the reason. */
export interface Cadmpeg {
  to_step(bytes: Uint8Array, fileName: string): CadmpegConverted;
}

/** A format's module as its generated script exports it: to_step, and the two ways its WebAssembly is initialised. */
export interface CadModule extends Cadmpeg {
  default(input: { module_or_path: URL }): Promise<unknown>;
  initSync(input: { module: Uint8Array }): unknown;
}

/** A converted file: the STEP bytes, the format cadmpeg read (an id such as "sldprt"), its support level and its warnings. */
export interface Converted {
  step: Uint8Array;
  format: string;
  level: number;
  warnings: string[];
}

/** Converts a part's bytes with the reader for `format`. Throws with the reason when that reader can't read them, or CadReaderMissing when the format's WebAssembly isn't here. */
export type CadConvert = (format: CadFormat, bytes: Uint8Array, name: string) => Promise<Converted>;

/** A format whose WebAssembly is not on this computer (the command line's bundle doesn't carry them). */
export class CadReaderMissing extends Error {}

/** A part read: the model as readStep gives it, with the title its top takes, its warnings and cadmpeg's support level. */
export interface NativeFile extends MeshFile {
  level: number;
}

/** A conversion for a worker: the file, its format's reader to use, and the name it is read by. */
export interface NativeRequest {
  format: CadFormat;
  bytes: Uint8Array;
  name: string;
}

/** A worker's answer: the converted file, or the reason it failed. `trap` when the module trapped (a panic), so its instance can't run again. */
export type NativeReply = { type: "done"; converted: Converted } | { type: "error"; message: string; trap: boolean };

/** Each format's module script, imported on its own when a file of that format is read: nothing else of the readers is bundled with it. */
export const MODULES: Readonly<Record<CadFormat, () => Promise<CadModule>>> = {
  sldprt: () => import("../../vendor/cadmpeg/sldprt/cadmpeg.js"),
  inventor: () => import("../../vendor/cadmpeg/inventor/cadmpeg.js"),
  fcstd: () => import("../../vendor/cadmpeg/fcstd/cadmpeg.js"),
  f3d: () => import("../../vendor/cadmpeg/f3d/cadmpeg.js"),
  nx: () => import("../../vendor/cadmpeg/nx/cadmpeg.js"),
  creo: () => import("../../vendor/cadmpeg/creo/cadmpeg.js"),
};

/** Each format's WebAssembly file as a URL the browser fetches; Vite emits each as its own asset. */
export const WASM: Readonly<Record<CadFormat, () => URL>> = {
  sldprt: () => new URL("../../vendor/cadmpeg/sldprt/cadmpeg_bg.wasm", import.meta.url),
  inventor: () => new URL("../../vendor/cadmpeg/inventor/cadmpeg_bg.wasm", import.meta.url),
  fcstd: () => new URL("../../vendor/cadmpeg/fcstd/cadmpeg_bg.wasm", import.meta.url),
  f3d: () => new URL("../../vendor/cadmpeg/f3d/cadmpeg_bg.wasm", import.meta.url),
  nx: () => new URL("../../vendor/cadmpeg/nx/cadmpeg_bg.wasm", import.meta.url),
  creo: () => new URL("../../vendor/cadmpeg/creo/cadmpeg_bg.wasm", import.meta.url),
};

/** The app each format names, as the part's title and refusals say it. */
const APPS: Readonly<Record<CadFormat, string>> = { sldprt: "SolidWorks", inventor: "Inventor", fcstd: "FreeCAD", f3d: "Fusion 360", nx: "NX", creo: "Creo" };

/** The formats a file's name may be read as, in the order they are tried, and the app its name says (a .prt is NX or Creo, which only the reader tells apart). */
const BY_EXTENSION: readonly { test: RegExp; formats: readonly CadFormat[]; app: string }[] = [
  { test: /\.sldprt$/i, formats: ["sldprt"], app: "SolidWorks" },
  { test: /\.ipt$/i, formats: ["inventor"], app: "Inventor" },
  { test: /\.fcstd$/i, formats: ["fcstd"], app: "FreeCAD" },
  { test: /\.f3d$/i, formats: ["f3d"], app: "Fusion 360" },
  { test: /\.prt$/i, formats: ["nx", "creo"], app: "NX or Creo" },
];

/** The formats a file's name may be read as, in the order they are tried; none for a name that isn't a CAD part. */
export function candidatesOf(name: string): readonly CadFormat[] {
  return BY_EXTENSION.find(({ test }) => test.test(name))?.formats ?? [];
}

/**
 * A part's file read as a model: its format's reader turns it into a STEP file, which readStep reads.
 * A .prt tries NX, then Creo when NX throws. Throws with a plain reason when no reader can read it.
 */
export async function readNative(bytes: Uint8Array, name: string, convert: CadConvert, occt: Occt): Promise<NativeFile> {
  const guess = BY_EXTENSION.find(({ test }) => test.test(name))?.app ?? "CAD";
  const tried: Attempt[] = [];
  let out: Converted | null = null;
  for (const format of candidatesOf(name)) {
    try {
      out = await convert(format, bytes, name);
      break;
    } catch (err) {
      tried.push({ format, reason: reasonOf(err), missing: err instanceof CadReaderMissing });
    }
  }
  if (!out) throw refusalOf(guess, tried);
  const app = APPS[out.format as CadFormat] ?? guess;
  let file: MeshFile;
  try {
    file = readStep(out.step, occt);
  } catch {
    throw new Error(`no solid bodies could be read from this ${app} part, which may hold only sketches or drawings`);
  }
  const base = name.replace(/\.[^.]+$/, "") || app;
  return { ...file, title: `${base} (${app} part)`, warnings: out.warnings, level: out.level };
}

/** One reader's try at a file: its format, why it failed, and whether its WebAssembly is missing. */
interface Attempt {
  format: CadFormat;
  reason: string;
  missing: boolean;
}

/** The refusal for a file no reader converted: the missing build when none was there, else the reasons each reader gave. */
function refusalOf(app: string, tried: readonly Attempt[]): Error {
  if (tried.length > 0 && tried.every((t) => t.missing)) return new Error(`${app} parts need the full Rodeo build`);
  const why =
    tried.length === 1
      ? tried[0].reason
      : tried.map((t) => `${APPS[t.format]}: ${t.missing ? "needs the full Rodeo build" : t.reason || "no reason given"}`).join("; ");
  if (!why) return new Error(`the reader can't open this ${app} part`);
  return new Error(`the reader can't open this ${app} part (${why})`);
}

/** A converted file read out of cadmpeg's object, which is freed once read. */
export function readConverted(c: CadmpegConverted): Converted {
  try {
    return { step: c.step, format: c.format, level: c.level, warnings: warningsOf(c.warnings) };
  } finally {
    c.free();
  }
}

/** One conversion as the worker runs it: the format's module (from `load`) converts the file. A failure is an error reply; a trap, a WebAssembly RuntimeError, says so. */
export async function answerNative(req: NativeRequest, load: (format: CadFormat) => Promise<Cadmpeg>): Promise<NativeReply> {
  try {
    const cad = await load(req.format);
    return { type: "done", converted: readConverted(cad.to_step(req.bytes, req.name)) };
  } catch (err) {
    return { type: "error", message: reasonOf(err), trap: err instanceof WebAssembly.RuntimeError };
  }
}

/** The reason a thrown value gives, as text ("" when it gives none). */
function reasonOf(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).trim();
}

/** cadmpeg's warnings, a JSON array of strings; text that isn't one is kept as a single warning. */
function warningsOf(json: string): string[] {
  const text = json.trim();
  if (!text) return [];
  try {
    const v = JSON.parse(text) as unknown;
    return Array.isArray(v) ? v.map(String) : [text];
  } catch {
    return [text];
  }
}

/**
 * A format's module, loaded and initialised from its WebAssembly: its bytes (Node's initSync), or where the
 * file is (a URL, the browser's init).
 */
export async function initCadmpeg(format: CadFormat, wasm: URL | Uint8Array): Promise<Cadmpeg> {
  const mod = await MODULES[format]();
  if (wasm instanceof Uint8Array) mod.initSync({ module: wasm });
  else await mod.default({ module_or_path: wasm });
  return mod;
}
