// The converter page's worker: it reads and writes files with the converter (convert/index.ts), one
// request at a time, using the browser's copies of the WebAssembly readers. A read keeps its drawing
// here under the read's id, so a write or a drop names the drawing by that id. Bytes come in and go
// out as transferred buffers, never copied, and nothing is sent anywhere.

import {
  describe,
  formatById,
  type DrawingSummary,
  type HeadlessDrawing,
  readAny,
  useLibraries,
  writeAs,
  type Unit,
} from "../index.ts";
import { ifcReader } from "../../import/ifc.ts";
import { convertInWorker } from "../../app/nativeImport.ts";
import { cancelXt, stopsAfterTrap } from "../../core/parasolid.ts";
import { occtLib } from "../../import/occt.ts";
import { rhinoLib } from "../../import/rhino3dm.ts";
import type { PreviewMesh } from "./preview3d.ts";

/** What the page sends the worker. `id` is a read's id (the drawing it makes), or the drawing a write or drop is for. */
export type ToWorker =
  | { type: "read"; id: number; name: string; bytes: Uint8Array; options: { units?: Unit; yUp?: boolean } }
  | { type: "write"; id: number; format: string }
  | { type: "drop"; id: number };

/** What the worker answers. A read or a write answers with the id it was sent with. */
export type FromWorker =
  | { type: "progress"; id: number; step: string }
  | { type: "read"; id: number; summary: DrawingSummary; svg: string | null; mesh: PreviewMesh | null }
  | { type: "written"; id: number; name: string; mime: string; bytes: Uint8Array; notes: string[] }
  | { type: "error"; id: number; message: string };

/** The most triangles the 3D preview draws; a bigger model is cut short and the page says so. */
const PREVIEW_TRIANGLES = 1_500_000;
/** The largest plan kept as text; a bigger one shows no plan. */
const PLAN_BYTES = 15 * 1024 * 1024;

/** Loads once and hands back the same thing after; a failed load is tried again next time. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => {
    loading ??= load().catch((err: unknown) => {
      loading = null;
      throw err;
    });
    return loading;
  };
}

// The browser's readers: each WebAssembly module loads from its own file, as the editor's loaders do.
useLibraries({
  ifc: ifcReader,
  rhino: rhinoLib,
  occt: occtLib,
  convertCad: convertInWorker,
  xt: once(async () => {
    const xt = await import("../../../vendor/cadmpeg-xt/cadmpeg_xt.js");
    await xt.default({ module_or_path: new URL("../../../vendor/cadmpeg-xt/cadmpeg_xt_bg.wasm", import.meta.url) });
    return stopsAfterTrap({ mesh: xt.xt_mesh, report: xt.xt_last_report });
  }),
  revit: once(async () => {
    const rvt = await import("../../../vendor/rvt-rs/rvt.js");
    await rvt.default({ module_or_path: new URL("../../../vendor/rvt-rs/rvt_bg.wasm", import.meta.url) });
    return rvt;
  }),
});

const drawings = new Map<number, HeadlessDrawing>();
// Messages run one at a time, in order, so a write always finds the drawing its read made.
let chain: Promise<void> = Promise.resolve();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  chain = chain.then(() => handle(e.data));
};

/** Posts an answer, handing the buffers over rather than copying them. */
function post(m: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(m, { transfer });
}

/** Runs one request. */
async function handle(m: ToWorker): Promise<void> {
  if (m.type === "drop") {
    // its solids still waiting for their Parasolid faces go with it
    const drawing = drawings.get(m.id);
    if (drawing) cancelXt(drawing.session.doc);
    drawings.delete(m.id);
  } else if (m.type === "read") {
    await read(m);
  } else {
    await write(m);
  }
}

/** Reads a file into a drawing kept under the request's id, and answers with its summary and previews. */
async function read(m: Extract<ToWorker, { type: "read" }>): Promise<void> {
  try {
    const drawing = await readAny(m.bytes, m.name, {
      ...m.options,
      progress: (step) => post({ type: "progress", id: m.id, step }),
    });
    drawings.set(m.id, drawing);
    const summary = describe(drawing);
    const mesh = previewMesh(drawing);
    const svg = await planSvg(drawing, summary);
    post({ type: "read", id: m.id, summary, svg, mesh }, mesh ? [mesh.positions.buffer, mesh.colors.buffer] : []);
  } catch (err) {
    drawings.delete(m.id);
    post({ type: "error", id: m.id, message: `Could not read ${m.name}: ${messageOf(err)}` });
  }
}

/** Writes the drawing a read made in the requested format, and answers with the file. */
async function write(m: Extract<ToWorker, { type: "write" }>): Promise<void> {
  const label = formatById(m.format)?.name ?? m.format;
  try {
    const drawing = drawings.get(m.id);
    if (!drawing) throw new Error("the file isn't read any more");
    const made = await writeAs(drawing, m.format);
    // a view on a larger buffer is copied, so the transfer moves only the file
    const bytes = made.bytes.byteOffset === 0 && made.bytes.byteLength === made.bytes.buffer.byteLength ? made.bytes : made.bytes.slice();
    post({ type: "written", id: m.id, name: made.name, mime: made.mime, bytes, notes: [...made.notes] }, [bytes.buffer]);
  } catch (err) {
    post({ type: "error", id: m.id, message: `Could not convert to ${label}: ${messageOf(err)}` });
  }
}

/** The plan as SVG text, or null when there is no plan or it is too large to keep. */
async function planSvg(drawing: HeadlessDrawing, summary: DrawingSummary): Promise<string | null> {
  if (!summary.bounds2d) return null;
  try {
    const { bytes } = await writeAs(drawing, "svg");
    return bytes.byteLength > PLAN_BYTES ? null : new TextDecoder().decode(bytes);
  } catch {
    // a plan that won't draw is no reason to fail the read: the page shows no plan
    return null;
  }
}

/**
 * The model's triangles on the visible design layers, in millimetres with a colour per vertex, as the
 * 3D writers take them by default; null when there is nothing to draw. Capped at PREVIEW_TRIANGLES.
 */
function previewMesh(drawing: HeadlessDrawing): PreviewMesh | null {
  const doc = drawing.session.doc;
  const design = doc.layers().filter((l) => l.kind === "design");
  const visible = design.filter((l) => l.visibility !== "hidden");
  const shown = new Set((visible.length ? visible : design).map((l) => l.id));
  const meshes = doc.model3d().filter((m) => shown.has(m.layerId) && m.triangles.length >= 9);
  const total = meshes.reduce((n, m) => n + Math.floor(m.triangles.length / 9), 0);
  if (total === 0) return null;

  const count = Math.min(total, PREVIEW_TRIANGLES);
  const positions = new Float32Array(count * 9);
  const colors = new Float32Array(count * 9);
  let done = 0;
  for (const m of meshes) {
    if (done >= count) break;
    const n = Math.min(Math.floor(m.triangles.length / 9), count - done);
    positions.set(m.triangles.subarray(0, n * 9), done * 9);
    const [r, g, b] = rgbOf(m.color);
    for (let i = done * 9; i < (done + n) * 9; i += 3) {
      colors[i] = r;
      colors[i + 1] = g;
      colors[i + 2] = b;
    }
    done += n;
  }
  return { positions, colors, triangles: count, capped: total > count };
}

/** The red, green and blue of a CSS hex colour, 0 to 1; a light grey for one it can't read. */
function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.8, 0.8, 0.8];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/** The text of an error, whatever was thrown. */
function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
