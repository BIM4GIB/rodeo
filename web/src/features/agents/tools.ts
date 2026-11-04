// The agents' tools: everything the editor can do, as functions a model calls. Reads go to the
// document (any VwxDocument method), edits to the session (any EditSession method, one undo step
// each, or a batch as one), and the api_docs tool explains both from core/types.ts. The agents
// see the drawing through look.ts, run menu commands as the user would, export and import files,
// run JavaScript against the whole API in the plug-in sandbox, and save plug-ins of their own.
// The planner can also hand work to subagents (agent.ts runs them).

import { setActiveLayer, setSelection } from "../../app/commands.ts";
import type { AppContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { documentBlob } from "../../app/writeOut.ts";
import type { Row } from "../../app/menu.ts";
import { allMenus } from "../../app/menubar.ts";
import { store, type ToolId } from "../../app/state.ts";
import { onToast, toast } from "../../app/toast.ts";
import type { RenderMode, ViewPreset } from "../../app/view3d.ts";
import type { BBox, EditSession, Vec3, VwxDocument } from "../../core/index.ts";
import type { WorkerApi } from "../plugins/bootstrap.ts";
import { boundsOfAll, dispatch, plain, type CallEnv, type Effects } from "../plugins/dispatch.ts";
import { installed, newRecord, removePlugin, runPlugin, grantsFor, savePluginRecord, setEnabled, displayName } from "../plugins/host.ts";
import { PluginWorker } from "../plugins/worker.ts";
import { docsFor, methodNames, members, searchDocs } from "./apidocs.ts";
import { BUILD_REFERENCE, buildParts } from "./build.ts";
import { checkSolids, closureVerdict } from "./check3d.ts";
import { HANDLE_LENGTH, UUID } from "./history.ts";
import { findAxes, readDrawn, unprojectIso, type IsoModel, type IsoSegment } from "./iso.ts";
import type { ToolSpec } from "./llm.ts";
import { blobPicture, lookModel, lookPlan, renderLook, type Picture } from "./look.ts";
import { placeParts } from "./place.ts";
import { readPlan, wallPaths, type PlanInput } from "./plan.ts";

export interface OutFile {
  readonly name: string;
  readonly blob: Blob;
}

export interface ToolOutput {
  readonly text: string;
  readonly images?: readonly Picture[];
  readonly files?: readonly OutFile[];
  /** the tool failed: the text says why */
  readonly error?: boolean;
}

export interface SubTask {
  readonly title: string;
  readonly instructions: string;
}

export interface ToolContext {
  readonly app: AppContext;
  readonly signal: AbortSignal;
  /** files the user attached to the conversation, by name */
  readonly attachments: ReadonlyMap<string, File>;
  /** a line of progress for the tool's card */
  progress(text: string): void;
  /** runs subagents (the planner only) */
  readonly delegate?: (tasks: readonly SubTask[]) => Promise<string>;
}

export interface Tool {
  readonly spec: ToolSpec;
  /** what the tool is doing, for its card ("Reading layers") */
  label(args: Record<string, unknown>): string;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

/** longest text a tool hands back to a model */
const MAX_TEXT = 24_000;
const SCRIPT_SECONDS = 120;

// ---- helpers --------------------------------------------------------------------

function session(): EditSession {
  const s = store.session;
  if (!s) throw new Error("No drawing is open. Ask the user to open one (or import a file they attach).");
  return s;
}

/** JSON for a model: typed arrays and maps summarised, the whole cut to MAX_TEXT. */
export function toText(value: unknown, max = MAX_TEXT): string {
  if (value === undefined) return "done";
  if (typeof value === "string") return clip(value, max);
  let s: string;
  try {
    s = JSON.stringify(value, (_k, x: unknown) => {
      if (typeof x === "bigint") return `${x}n`;
      if (ArrayBuffer.isView(x)) return `[${x.constructor.name} of ${(x as unknown as { length: number }).length}]`;
      if (x instanceof Map) return Object.fromEntries(x);
      if (x instanceof Set) return [...x];
      if (typeof x === "number" && !Number.isInteger(x)) return precise(x);
      return x;
    });
  } catch {
    s = String(value);
  }
  return clip(s ?? "null", max);
}

/**
 * A number as precise as the model needs: whole millimetres from a metre up, tenths from 10, and
 * thousandths below that (scales, ratios, small angles). Digits it doesn't need are tokens paid for.
 */
function precise(x: number): number {
  const a = Math.abs(x);
  const k = a >= 1000 ? 1 : a >= 10 ? 10 : 1000;
  return Math.round(x * k) / k;
}

/** The text cut to `max` characters as the model is sent it, where each id is a short handle (history.ts). */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const ids = [...s.matchAll(UUID)];
  const length = s.length - ids.reduce((n, m) => n + m[0].length - HANDLE_LENGTH, 0);
  if (length <= max) return s;
  // the place in s where what's sent reaches max, never part way through an id
  let sent = 0;
  let at = 0;
  let cut = -1;
  for (const m of ids) {
    if (sent + m.index - at >= max) {
      cut = at + max - sent;
      break;
    }
    sent += m.index - at + HANDLE_LENGTH;
    at = m.index + m[0].length;
    if (sent >= max) {
      cut = at;
      break;
    }
  }
  if (cut < 0) cut = at + max - sent;
  return `${s.slice(0, cut)}\n… cut at ${max} of ${length} characters: ask for less (filter, page with offset and limit, or summarise in run_script)`;
}

function str(v: unknown, name: string): string {
  if (typeof v !== "string" || !v) throw new Error(`${name} is required`);
  return v;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function vec3(v: unknown): Vec3 | undefined {
  return Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === "number" && Number.isFinite(x)) ? [v[0], v[1], v[2]] : undefined;
}

function box(v: unknown): BBox | undefined {
  if (!v || typeof v !== "object") return undefined;
  const b = v as Record<string, unknown>;
  const n = [b.x0, b.y0, b.x1, b.y1];
  if (!n.every((x) => typeof x === "number" && Number.isFinite(x))) return undefined;
  const [x0, y0, x1, y1] = n as number[];
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
}

function ids(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function args(v: unknown): unknown[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];
}

function spec(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolSpec {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } };
}

const VIEW_PRESETS: readonly ViewPreset[] = ["top", "bottom", "front", "back", "left", "right", "iso", "leftIso", "rightRearIso", "leftRearIso", "lowerRightIso", "lowerLeftIso", "lowerRightRearIso", "lowerLeftRearIso"];
const RENDER_MODES: readonly RenderMode[] = ["shaded", "textured", "wireframe", "hidden", "dashed", "sketch", "realistic", "pathtraced"];

// ---- the API the agents may call -------------------------------------------------

/** edits that aren't drawing changes: listeners, collaboration and saving bookkeeping */
const NOT_EDITS = new Set(["onChange", "onStep", "markSaved", "setLayerGuard", "applyRemote", "batch"]);

/** Every edit an agent may make. */
export function editMethods(): string[] {
  return methodNames("EditSession").filter((n) => !NOT_EDITS.has(n));
}

/** Every read of the document, with its properties. */
export function docMembers(): string[] {
  return members("VwxDocument").map((m) => m.name);
}

function callEdit(s: EditSession, method: string, a: readonly unknown[]): unknown {
  if (NOT_EDITS.has(method) || !editMethods().includes(method)) throw new Error(`edit.${method} isn't an edit (api_docs with search lists them)`);
  const fn = (s as unknown as Record<string, unknown>)[method];
  if (typeof fn !== "function") throw new Error(`edit.${method} isn't available`);
  return (fn as (...x: unknown[]) => unknown).apply(s, [...a]);
}

function callDoc(doc: VwxDocument, method: string, a: readonly unknown[]): unknown {
  if (!docMembers().includes(method)) throw new Error(`doc.${method} isn't a read of the document (api_docs with search lists them)`);
  const v = (doc as unknown as Record<string, unknown>)[method];
  return typeof v === "function" ? (v as (...x: unknown[]) => unknown).apply(doc, [...a]) : v;
}

/** The editor's state in a few lines: the file, the layer and selection, the views. */
function editorState(ctx: AppContext): Record<string, unknown> {
  const s = store.session;
  if (!s) return { open: false };
  const doc = s.doc;
  const layer = doc.layers().find((l) => l.id === store.activeLayerId);
  const sel = [...store.selection];
  const r = ctx.view.visibleRect();
  return {
    open: true,
    file: doc.info.fileName,
    units: doc.info.units,
    activeLayer: layer ? { id: layer.id, name: layer.name, kind: layer.kind } : null,
    selection: { count: sel.length, ids: sel.slice(0, 60) },
    editingGroup: store.editGroupId,
    tool: store.tool,
    view: store.view3d ? "3d" : "2d",
    renderMode3d: ctx.renderMode(),
    planView: { x0: Math.round(r.x0), y0: Math.round(r.y0), x1: Math.round(r.x1), y1: Math.round(r.y1) },
    canUndo: s.canUndo(),
    canRedo: s.canRedo(),
    unsaved: s.dirty,
  };
}

const effects: Effects = {
  select(list) {
    const doc = store.session?.doc;
    if (!doc) return [];
    const keep = list.filter((id) => {
      const o = doc.object(id);
      return !!o && o.layerId === store.activeLayerId && o.parentId === store.editGroupId;
    });
    setSelection(keep);
    return keep;
  },
  zoomTo(b) {
    const ctx = appCtx;
    if (!ctx) return;
    ctx.view.fit(b);
    store.emit("view");
  },
  setActiveLayer(id) {
    setActiveLayer(id);
  },
};

let appCtx: AppContext | null = null;

function callEnv(): CallEnv {
  return { session: store.session, activeLayerId: store.activeLayerId, selection: [...store.selection], effects };
}

/** What a script's openvwx offers: every read and edit, and long results. */
function scriptApi(): WorkerApi {
  return { doc: docMembers(), edit: editMethods(), evalMax: 20_000 };
}

/** Answers a script's call: reads and edits straight to the drawing, the rest as plug-ins get it. */
async function scriptCall(method: string, a: unknown[]): Promise<unknown> {
  if (method.startsWith("doc.")) return plain(callDoc(session().doc, method.slice(4), a));
  if (method === "edit.batch") {
    const steps = a[0];
    if (!Array.isArray(steps)) throw new TypeError("openvwx.edit.batch takes a list of [method, ...args] steps");
    const s = session();
    return plain(s.batch(() => (steps as unknown[][]).map((step) => callEdit(s, String(step[0]), step.slice(1)))));
  }
  if (method.startsWith("edit.")) return plain(callEdit(session(), method.slice(5), a));
  if (method === "ui.toast") {
    toast(String(a[0] ?? ""), "info");
    return undefined;
  }
  if (method.startsWith("ui.") || method === "fetch") throw new Error(`openvwx.${method} isn't open to agent scripts: report back in the result instead`);
  return dispatch(method, a, callEnv());
}

// ---- menus --------------------------------------------------------------------

interface Command {
  readonly path: string;
  readonly row: Exclude<Row, "-">;
}

function commands(): Command[] {
  const out: Command[] = [];
  const walk = (prefix: string, rows: readonly Row[], depth: number): void => {
    for (const row of rows) {
      if (row === "-") continue;
      const path = `${prefix} › ${row.label}`;
      if (row.items) {
        if (depth < 4) walk(path, typeof row.items === "function" ? row.items() : row.items, depth + 1);
      } else if (row.run) out.push({ path, row });
    }
  };
  for (const m of allMenus()) walk(m.title, m.rows, 0);
  return out;
}

const norm = (s: string): string => s.toLowerCase().replace(/[…]|\.\.\./g, "").replace(/\s*[›>]\s*/g, " › ").trim();

// ---- export and import -----------------------------------------------------------

type Format = "vwx" | "pdf" | "svg" | "png" | "dxf" | "ifc" | "obj" | "glb" | "3ds" | "stl" | "3dm" | "fbx" | "dae" | "ply" | "skp";
const FORMATS: readonly Format[] = ["vwx", "pdf", "svg", "png", "dxf", "ifc", "obj", "glb", "3ds", "stl", "3dm", "fbx", "dae", "ply", "skp"];

function baseName(): string {
  return (store.session?.doc.info.fileName ?? "drawing").replace(/\.[^.]+$/, "") || "drawing";
}

function exportLayers(ctx: AppContext, given: string[], kinds: readonly ("design" | "sheet")[]): string[] {
  const all = ctx.scene.layers();
  if (given.length) {
    for (const id of given) if (!all.some((l) => l.id === id)) throw new Error(`no layer has the id ${id}`);
    return given;
  }
  const drawn = ctx.scene.drawnLayers(store.activeLayerId).filter((l) => kinds.includes(l.kind));
  return (drawn.length ? drawn : all.filter((l) => kinds.includes(l.kind) && l.visibility !== "hidden")).map((l) => l.id);
}

async function exportFile(ctx: AppContext, format: Format, layerIds: string[], name: string, widthPx: number): Promise<OutFile> {
  const doc = session().doc;
  const file = `${name}.${format}`;
  switch (format) {
    case "vwx":
      return { name: file, blob: await documentBlob(session()) };
    case "pdf": {
      const { exportPdf } = await import("../../export/pdf.ts");
      const bytes = exportPdf(doc, layerIds.length ? { layerIds } : {});
      return { name: file, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }) };
    }
    case "svg":
    case "png": {
      const { exportSvg } = await import("../../export/svg.ts");
      const svg = exportSvg(doc, exportLayers(ctx, layerIds, ["design", "sheet"]));
      if (format === "svg") return { name: file, blob: new Blob([svg], { type: "image/svg+xml" }) };
      const { svgToPng } = await import("../../export/png.ts");
      const m = /viewBox="[-\d.e]+ [-\d.e]+ ([\d.e]+) ([\d.e]+)"/.exec(svg);
      const aspect = m ? Number(m[2]) / Number(m[1]) : 0.7;
      const w = Math.min(8192, Math.max(64, Math.round(widthPx)));
      return { name: file, blob: await svgToPng(svg, w, Math.max(1, Math.round(w * (Number.isFinite(aspect) && aspect > 0 ? aspect : 0.7)))) };
    }
    case "dxf": {
      const { exportDxf } = await import("../../export/dxf.ts");
      return { name: file, blob: new Blob([exportDxf(doc, layerIds.length ? { layerIds } : {})], { type: "application/dxf" }) };
    }
    case "ifc": {
      const { exportIfc } = await import("../../export/ifc.ts");
      return { name: file, blob: new Blob([exportIfc(doc, new Set(exportLayers(ctx, layerIds, ["design"])), file)], { type: "application/x-step" }) };
    }
    case "obj": {
      const { exportObj } = await import("../../export/model3d.ts");
      return { name: file, blob: new Blob([exportObj(doc, new Set(exportLayers(ctx, layerIds, ["design"])))], { type: "text/plain" }) };
    }
    case "glb": {
      const { exportGlb } = await import("../../export/model3d.ts");
      return { name: file, blob: new Blob([await exportGlb(doc, new Set(exportLayers(ctx, layerIds, ["design"])))], { type: "model/gltf-binary" }) };
    }
    case "3ds": {
      const { export3ds } = await import("../../export/threeds.ts");
      return { name: file, blob: new Blob([export3ds(doc, new Set(exportLayers(ctx, layerIds, ["design"]))) as Uint8Array<ArrayBuffer>], { type: "application/x-3ds" }) };
    }
    case "stl": {
      const { exportStlBinary, stlMeshes } = await import("../../export/stl.ts");
      const meshes = stlMeshes(doc, new Set(exportLayers(ctx, layerIds, ["design"])));
      return { name: file, blob: new Blob([exportStlBinary(meshes) as Uint8Array<ArrayBuffer>], { type: "model/stl" }) };
    }
    case "3dm": {
      const [{ export3dm }, { flatOf, modelOf }, { rhinoLib }] = await Promise.all([
        import("../../export/rhino.ts"),
        import("../../export/scene3d.ts"),
        import("../../import/rhino3dm.ts"),
      ]);
      const layers = new Set(exportLayers(ctx, layerIds, ["design"]));
      const names = new Map(doc.layers().map((l) => [l.id, l.name]));
      const bytes = export3dm(modelOf(doc, layers, true), flatOf(doc, layers), names, await rhinoLib());
      return { name: file, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "model/vnd.3dm" }) };
    }
    case "fbx": {
      const [{ exportFbx }, { modelOf }] = await Promise.all([import("../../export/fbx.ts"), import("../../export/scene3d.ts")]);
      const bytes = exportFbx(modelOf(doc, new Set(exportLayers(ctx, layerIds, ["design"])), true));
      return { name: file, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }) };
    }
    case "dae": {
      const [{ exportCollada }, { modelOf }] = await Promise.all([import("../../export/collada.ts"), import("../../export/scene3d.ts")]);
      return { name: file, blob: new Blob([exportCollada(modelOf(doc, new Set(exportLayers(ctx, layerIds, ["design"])), true))], { type: "model/vnd.collada+xml" }) };
    }
    case "ply": {
      const [{ exportPly }, { modelOf }] = await Promise.all([import("../../export/ply.ts"), import("../../export/scene3d.ts")]);
      const bytes = exportPly(modelOf(doc, new Set(exportLayers(ctx, layerIds, ["design"]))));
      return { name: file, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" }) };
    }
    case "skp": {
      const { exportSkp } = await import("../../export/skp.ts");
      const { bytes } = exportSkp(doc, new Set(exportLayers(ctx, layerIds, ["design"])));
      return { name: file, blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/vnd.sketchup.skp" }) };
    }
  }
}

/** OBJ and 3DS units, millimetres each */
const MESH_UNITS: Readonly<Record<string, number>> = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

interface ImportOptions {
  readonly units?: string;
  readonly yUp?: boolean;
  /** PDF: 1-based */
  readonly page?: number;
  readonly scale?: number;
  readonly lines?: boolean;
  readonly text?: boolean;
}

/** Opens or imports an attachment, answering the importers' questions from `o`; says what the editor said. */
async function importFile(ctx: AppContext, file: File, o: ImportOptions): Promise<ToolOutput> {
  const name = file.name;
  if (/\.vwx$/i.test(name)) {
    await ctx.openDocument(new Uint8Array(await file.arrayBuffer()), name);
    return { text: `Opened ${name} in place of the drawing that was open (the editor asked about unsaved changes first).` };
  }
  if (!store.session) throw new Error("open a drawing first: files other than .vwx are imported into one");
  const said: string[] = [];
  let failed = false;
  const before = store.selection;
  const stop = onToast((message, kind) => {
    said.push(message);
    failed ||= kind === "error";
  });
  try {
    if (/\.dxf$/i.test(name)) {
      const { importDroppedDxf } = await import("../../app/dxfImport.ts");
      await importDroppedDxf(file, ctx.scene, ctx.view);
    } else if (/\.dwg$/i.test(name)) {
      const { importDroppedDwg } = await import("../../app/dxfImport.ts");
      await importDroppedDwg(file, ctx.scene, ctx.view);
    } else if (/\.pdf$/i.test(name)) {
      const { importPdf } = await import("../../app/pdfImport.ts");
      await importPdf(file, ctx.scene, ctx.view, {
        page: o.page !== undefined ? Math.round(o.page) - 1 : undefined,
        scale: o.scale,
        lines: o.lines,
        text: o.text,
      });
    } else {
      const { meshFormat, importMesh } = await import("../../app/meshImport.ts");
      const format = meshFormat(name);
      if (!format) throw new Error(`${name}: Rodeo opens .vwx and imports .dxf, .dwg, .pdf, .obj, .gltf/.glb, .3ds, .stl, .ifc, .usd, .skp, .3dm, .fbx, .dae/.kmz, .blend and .ply; a picture the user attaches is seen, not imported`);
      // what the dialog would default to: metres, y up for OBJ and z up for 3DS and PLY (the formats that say their units ignore it)
      await importMesh(file, ctx.scene, ctx.view, { mm: MESH_UNITS[o.units ?? (format === "stl" ? "mm" : "m")] ?? 1000, yUp: o.yUp ?? format === "obj" });
    }
  } finally {
    stop();
  }
  // an import selects what it made
  const made = store.selection !== before ? [...store.selection] : [];
  const text = said.length ? said.join("\n") : `Imported ${name}.`;
  const sel = made.length ? `\nThe import is selected (${made.length} object${made.length === 1 ? "" : "s"}): ${made.slice(0, 20).join(", ")}` : "";
  return { text: `${text}${failed ? "" : sel}`, error: failed };
}

/** most straight lines axo_to_3d takes in one go (21,000 take some 4 s) */
const AXO_LINES = 30_000;

/**
 * The straight edges of a layer's lines, rectangles, polygons and polylines (the objects `want`
 * names and what groups among them hold, or all of the layer's), each marked hidden when its class
 * says so, as Make2D's hidden-line classes do. Viewport crops are left out.
 */
function lineWork(doc: VwxDocument, layerId: string, want: ReadonlySet<string>): IsoSegment[] {
  const objs = doc.objects(layerId);
  const parent = new Map(objs.map((o) => [o.id, o.parentId]));
  const chosen = (id: string): boolean => {
    for (let at: string | null | undefined = id; at; at = parent.get(at)) if (want.has(at)) return true;
    return false;
  };
  const out: IsoSegment[] = [];
  for (const o of objs) {
    const sh = o.shape;
    if (!sh || !["line", "rect", "polygon", "polyline"].includes(sh.kind) || o.className.includes("ViewportRectangle") || (want.size && !chosen(o.id))) continue;
    const hidden = /hidden/i.test(o.className);
    const pts = sh.points;
    const n = sh.closed || sh.kind === "rect" ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) out.push({ a: pts[i], b: pts[(i + 1) % pts.length], hidden });
  }
  return out;
}

/** A design layer by id or name. */
function designLayer(doc: VwxDocument, key: string): { id: string; name: string; scale: number } {
  const layer = doc.layers().find((l) => l.id === key) ?? doc.layers().find((l) => l.name === key);
  if (!layer || layer.kind !== "design") throw new Error(`no design layer ${key}`);
  return layer;
}

/** A floor plan's line work on a layer (only `want` and what they hold, when given), as readPlan takes it. */
function planInput(doc: VwxDocument, layerId: string, want: ReadonlySet<string>): PlanInput {
  const objs = doc.objects(layerId);
  const parent = new Map(objs.map((o) => [o.id, o.parentId]));
  const chosen = (id: string): boolean => {
    for (let at: string | null | undefined = id; at; at = parent.get(at)) if (want.has(at)) return true;
    return false;
  };
  const input: { segments: PlanInput["segments"][number][]; arcs: PlanInput["arcs"][number][]; fills: PlanInput["fills"][number][]; texts: PlanInput["texts"][number][] } = { segments: [], arcs: [], fills: [], texts: [] };
  for (const o of objs) {
    const sh = o.shape;
    if (!sh || o.className.includes("ViewportRectangle") || (want.size && !chosen(o.id))) continue;
    if (sh.kind === "line" || sh.kind === "rect" || sh.kind === "polygon" || sh.kind === "polyline") {
      const pts = sh.points;
      const closed = sh.closed || sh.kind === "rect";
      const n = closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) input.segments.push({ a: pts[i], b: pts[(i + 1) % pts.length], id: o.id, className: o.className });
      if (closed && pts.length >= 3 && o.attrs && o.attrs.fillPattern !== 0) input.fills.push({ points: pts, id: o.id, className: o.className });
    } else if (sh.kind === "arc" && sh.center && sh.rx !== undefined && (sh.ry === undefined || Math.abs(sh.ry - sh.rx) < 1e-6 * Math.max(1, sh.rx))) {
      input.arcs.push({ center: sh.center, radius: sh.rx, start: sh.startAngle ?? 0, sweep: sh.sweepAngle ?? 360, id: o.id, className: o.className });
    } else if (sh.kind === "text" && sh.text) {
      const b = sh.bbox;
      input.texts.push({ at: b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : (sh.anchor ?? { x: 0, y: 0 }), text: sh.text, id: o.id });
    }
  }
  return input;
}

/** Numbers rounded to a tenth of a millimetre, for answers a model reads. */
function rounded(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 10) / 10;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]));
  return v;
}

/**
 * The model moved level so its plan's middle is under the line work's, so it is found where its
 * drawing is (the solver leaves it wherever the drawing's origin falls).
 */
function underDrawing(m: IsoModel, segments: readonly IsoSegment[]): Vec3[] {
  const mid = (vs: readonly number[]): number => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of vs) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return (lo + hi) / 2;
  };
  const dx = mid(segments.flatMap((g) => [g.a.x, g.b.x])) - mid(m.vertices.map((v) => v[0]));
  const dy = mid(segments.flatMap((g) => [g.a.y, g.b.y])) - mid(m.vertices.map((v) => v[1]));
  return m.vertices.map(([x, y, z]) => [x + dx, y + dy, z]);
}

/** The faces as mesh parts, one per building (what the edges join), x, y, z triples round each. */
function meshParts(m: IsoModel, at: readonly Vec3[]): number[][][] {
  const root = at.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (const [i, j] of m.edges) root[find(i)] = find(j);
  for (const f of m.faces) for (const v of f.slice(1)) root[find(v)] = find(f[0]);
  const parts = new Map<number, number[][]>();
  for (const f of m.faces) {
    const k = find(f[0]);
    parts.set(k, [...(parts.get(k) ?? []), f.flatMap((v) => [...at[v]])]);
  }
  return [...parts.values()];
}

/** A layer name not yet taken: `name`, else `name 2`, `name 3`... */
function freeLayerName(doc: VwxDocument, name: string): string {
  const taken = new Set(doc.layers().map((l) => l.name));
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name} ${n}`)) n++;
  return `${name} ${n}`;
}

// ---- the tools -------------------------------------------------------------------

const TOOLS: Tool[] = [
  {
    spec: spec(
      "overview",
      "The open drawing at a glance: the file and its units, every layer (id, name, kind, scale, elevation, story, visibility, object count), the classes, stories, cameras and the editor's state (active layer, selection, 2D or 3D, the plan's visible box, undo). Call it first.",
      {},
    ),
    label: () => "Reading the drawing",
    async run(_a, ctx) {
      const s = store.session;
      if (!s) return { text: toText({ open: false, note: "No drawing is open." }) };
      const doc = s.doc;
      const classes = doc.classes();
      const out = {
        info: doc.info,
        state: editorState(ctx.app),
        layers: doc.layers().map((l) => ({
          id: l.id,
          name: l.name,
          ...(l.title ? { title: l.title } : {}),
          kind: l.kind,
          scale: l.scale,
          visibility: l.visibility,
          objects: l.objectCount,
          ...(l.elevation ? { elevation: l.elevation } : {}),
          ...(l.story ? { story: l.story } : {}),
        })),
        classes: { count: classes.length, list: classes.slice(0, 300).map((c) => ({ index: c.index, name: c.name, visibility: c.visibility, objects: c.objectCount })) },
        stories: safe(() => doc.stories()),
        cameras: safe(() => doc.cameras().map((c) => ({ id: c.id, name: c.name, layerId: c.layerId }))),
      };
      return { text: toText(out) };
    },
  },
  {
    spec: spec(
      "doc",
      "Reads the document: calls VwxDocument.<method>(...args) and returns its result as JSON (big results are cut: page or filter). For example objects(layerId), object(id), records(id), wall(id), layers(), classes(), symbolDefs(), resources(), cameras(), lights3d(). See api_docs for every read and its arguments.",
      { method: { type: "string", description: "a VwxDocument method or property, e.g. objects" }, args: { type: "array", description: "its arguments, in order", items: {} }, offset: { type: "integer", description: "for a list result: the first item to return" }, limit: { type: "integer", description: "for a list result: at most this many items (default 200)" } },
      ["method"],
    ),
    label: (a) => `Reading ${String(a.method ?? "")}`,
    async run(a) {
      const value = callDoc(session().doc, str(a.method, "method"), args(a.args));
      if (Array.isArray(value)) {
        const offset = Math.max(0, Math.floor(num(a.offset, 0)));
        const limit = Math.max(1, Math.floor(num(a.limit, 200)));
        const page = value.slice(offset, offset + limit);
        return { text: toText({ total: value.length, offset, items: page }) };
      }
      return { text: toText(value) };
    },
  },
  {
    spec: spec(
      "edit",
      "Changes the drawing: calls EditSession.<method>(...args), one undo step, and returns its result (new ids, for instance). Check the method in api_docs first when you aren't sure of its arguments; lengths are world millimetres. undo and redo are edits too.",
      { method: { type: "string", description: "an EditSession method, e.g. addObjects, moveObjects, setAttributes, createLayer, setWallHeights, undo" }, args: { type: "array", description: "its arguments, in order", items: {} } },
      ["method"],
    ),
    label: (a) => `Editing: ${String(a.method ?? "")}`,
    async run(a) {
      return { text: toText(callEdit(session(), str(a.method, "method"), args(a.args))) };
    },
  },
  {
    spec: spec(
      "edit_batch",
      "Several edits as ONE undo step, in order: [[method, ...args], ...]. If one fails, none of them is applied. Later steps can't use earlier steps' results: use run_script for that.",
      { steps: { type: "array", description: "the edits, each [method, ...args]", items: { type: "array", items: {} } } },
      ["steps"],
    ),
    label: (a) => `Editing: ${Array.isArray(a.steps) ? a.steps.length : 0} changes as one step`,
    async run(a) {
      const steps = a.steps;
      if (!Array.isArray(steps) || !steps.every(Array.isArray)) throw new Error("steps is a list of [method, ...args] lists");
      const s = session();
      for (const step of steps as unknown[][]) if (!editMethods().includes(String(step[0]))) throw new Error(`edit.${String(step[0])} isn't an edit`);
      const results = s.batch(() => (steps as unknown[][]).map((step) => callEdit(s, String(step[0]), step.slice(1))));
      return { text: toText(results) };
    },
  },
  {
    spec: spec(
      "api_docs",
      "The editor API's reference, from its source: give names (edit or doc methods such as addObjects or objects, or types such as NewShape, Attributes, ObjectInfo, LayerInfo) for their signatures and docs, or a search for every member and type whose name or doc (a type's whole source) has all its words, else the ones with the most of them. Look up all the names you need in one call.",
      { names: { type: "array", items: { type: "string" } }, search: { type: "string" } },
    ),
    label: (a) => (Array.isArray(a.names) && a.names.length ? `Reading the docs for ${a.names.slice(0, 3).join(", ")}` : `Searching the docs for "${String(a.search ?? "")}"`),
    async run(a) {
      const names = Array.isArray(a.names) ? a.names.map(String) : [];
      const parts: string[] = [];
      if (names.length) parts.push(docsFor(names));
      if (typeof a.search === "string" && a.search.trim()) parts.push(searchDocs(a.search) || `nothing mentions "${a.search}"`);
      return { text: parts.length ? clip(parts.join("\n\n"), MAX_TEXT) : "Give names or a search." };
    },
  },
  {
    spec: spec(
      "look_plan",
      "Sees the 2D drawing: draws the plan offscreen (the user's own view doesn't move) and returns the picture, with the world box it shows. Fits objects (ids), a box, the user's current view (frame: view) or everything drawn (the default). layerId draws that layer alone.",
      {
        ids: { type: "array", items: { type: "string" } },
        box: { type: "object", properties: { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" } } },
        frame: { type: "string", enum: ["extent", "view"] },
        layerId: { type: "string" },
        size: { type: "integer", description: "the picture's longest side in px, 256 to 2048 (default 1280)" },
        showSelection: { type: "boolean" },
      },
    ),
    label: () => "Looking at the plan",
    async run(a, ctx) {
      const pic = lookPlan(ctx.app, { ids: ids(a.ids), box: box(a.box), frame: a.frame === "view" ? "view" : "extent", layerId: typeof a.layerId === "string" ? a.layerId : undefined, size: num(a.size, 1280), showSelection: a.showSelection === true });
      return { text: pic.caption, images: [pic] };
    },
  },
  {
    spec: spec(
      "look_3d",
      "Sees the model in 3D: shows the 3D view (the user sees it too), points it from a standard direction, an eye at a target (world mm, z up) or through one of the drawing's cameras, optionally in a render mode, and returns the picture with the camera's place. An eye and target, or a camera, switch the view to perspective (an orthographic view, as a layer's saved view may be, ignores how near the eye is); lens sets its view angle.",
      {
        preset: { type: "string", enum: VIEW_PRESETS },
        eye: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        target: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3 },
        lens: { type: "number", description: "the perspective's view angle, degrees top to bottom: 20 to 30 a long lens, 35 the usual, 50 to 70 wide (default as the view has it)" },
        cameraId: { type: "string" },
        mode: { type: "string", enum: RENDER_MODES },
        size: { type: "integer" },
        holes: { type: "boolean", description: "fill every hole in the solids magenta and draw its rim magenta, as check_3d finds them" },
      },
    ),
    label: (a) => `Looking in 3D${typeof a.preset === "string" ? ` (${a.preset})` : ""}${a.holes === true ? " for holes" : ""}`,
    async run(a, ctx) {
      const pic = await lookModel(ctx.app, {
        preset: VIEW_PRESETS.includes(a.preset as ViewPreset) ? (a.preset as ViewPreset) : undefined,
        eye: vec3(a.eye),
        target: vec3(a.target),
        cameraId: typeof a.cameraId === "string" ? a.cameraId : undefined,
        lens: typeof a.lens === "number" ? a.lens : undefined,
        mode: RENDER_MODES.includes(a.mode as RenderMode) ? (a.mode as RenderMode) : undefined,
        size: num(a.size, 1280),
        holes: a.holes === true,
      });
      return { text: pic.caption, images: [pic] };
    },
  },
  {
    spec: spec(
      "check_3d",
      "Checks that solids are closed, as a modeller checks a model is watertight before calling it done: each object's faces in 3D are joined at their corners, and every edge must border two faces; an edge with a face on one side only is the rim of a hole. Reports a verdict and, worst first, each object's holes (the middle of each rim, world mm, and its size) and edges where three or more faces meet (parts of one object touching along a line, which is fine, or faces overlapping inside one solid, which isn't). Single faces (a pane, a 3D polygon) are open by nature; anything else with holes isn't finished: rebuild or mend it and check again. look_3d with holes: true shows where they are.",
      {
        layerId: { type: "string", description: "a design layer's id or name: every object on it; with neither this nor ids, every visible design layer" },
        ids: { type: "array", items: { type: "string" }, description: "only these top-level objects" },
      },
    ),
    label: (a) => (typeof a.layerId === "string" || ids(a.ids).length ? "Checking the model is closed" : "Checking every layer is closed"),
    async run(a) {
      const s = session();
      const key = typeof a.layerId === "string" ? a.layerId : "";
      const layer = key ? (s.doc.layers().find((l) => l.id === key) ?? s.doc.layers().find((l) => l.name === key)) : undefined;
      if (key && !layer) throw new Error(`no layer ${key}`);
      const only = new Set(ids(a.ids));
      // neither: the whole model as the user sees it
      const shown3d = !layer && !only.size ? new Set(s.doc.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden").map((l) => l.id)) : null;
      const meshes = s.doc.model3d().filter((m) => (!layer || m.layerId === layer.id) && (!only.size || only.has(m.objectId)) && (!shown3d || shown3d.has(m.layerId)));
      const { solids, linesOnly } = checkSolids(meshes);
      const shown = solids.slice(0, 30);
      const layerName = new Map(s.doc.layers().map((l) => [l.id, l.name]));
      return {
        text: toText({
          verdict: closureVerdict(solids),
          ...(linesOnly.length ? { linesOnly: `${linesOnly.length} object${linesOnly.length === 1 ? " shows" : "s show"} only lines in 3D (no faces)` } : {}),
          objects: shown.map(({ id, layerId, closure: c }) => {
            const o = s.doc.object(id);
            return {
              id,
              ...(o?.name ? { name: o.name } : {}),
              ...(layer ? {} : { layer: layerName.get(layerId) }),
              type: o?.typeName,
              triangles: c.triangles,
              closed: c.open === 0,
              ...(c.holes.length ? { holes: c.holes.length, openEdges: c.open, largestHoles: c.holes.slice(0, 3).map((h) => ({ at: h.at, across: h.across })) } : {}),
              ...(c.overlaps ? { overlapEdges: c.overlaps } : {}),
            };
          }),
          ...(solids.length > shown.length ? { more: `${solids.length - shown.length} more objects, better than these` } : {}),
        }),
      };
    },
  },
  {
    spec: spec(
      "render",
      "Renders a picture as File > Export > Render Image does, with the Render palette's sky, sun, light objects, materials and effects (lighting reads and changes them): from one of the drawing's cameras, a standard direction, an eye and target (in perspective, lens its view angle), or the 3D view as it is. realistic is fast (seconds) and draws the spots' beams in haze; pathtraced is photoreal and slower (samples and minutes bound it), without beams. The user gets the full-size picture to download; you get a smaller copy.",
      {
        cameraId: { type: "string" },
        preset: { type: "string", enum: VIEW_PRESETS },
        eye: { type: "array", items: { type: "number" } },
        target: { type: "array", items: { type: "number" } },
        lens: { type: "number", description: "the perspective's view angle in degrees, top to bottom" },
        width: { type: "integer", description: "px, default 1920" },
        height: { type: "integer", description: "px, default 1080" },
        engine: { type: "string", enum: ["realistic", "pathtraced"] },
        samples: { type: "integer", description: "path traced only, default 128" },
        minutes: { type: "number", description: "path traced only: at most this long, default 3" },
      },
    ),
    label: (a) => `Rendering ${num(a.width, 1920)}×${num(a.height, 1080)}${a.engine === "pathtraced" ? ", path traced" : ""}`,
    async run(a, ctx) {
      const pic = await renderLook(ctx.app, {
        cameraId: typeof a.cameraId === "string" ? a.cameraId : undefined,
        preset: VIEW_PRESETS.includes(a.preset as ViewPreset) ? (a.preset as ViewPreset) : undefined,
        eye: vec3(a.eye),
        target: vec3(a.target),
        lens: typeof a.lens === "number" ? a.lens : undefined,
        width: Math.round(num(a.width, 1920)),
        height: Math.round(num(a.height, 1080)),
        engine: a.engine === "pathtraced" ? "pathtraced" : "realistic",
        samples: num(a.samples, 128),
        minutes: num(a.minutes, 3),
        signal: ctx.signal,
        progress: (t) => ctx.progress(t),
      });
      const files = pic.full ? [{ name: `${baseName()} render.png`, blob: pic.full }] : [];
      return { text: pic.caption, images: [pic], files };
    },
  },
  {
    spec: spec(
      "lighting",
      "The light in the 3D view and the renders, and the drawing's light objects. With no arguments it reads them: the 3D view's sun, ambient light and haze (Visualization), the renders' sky, sun, light objects, exposure, fog and bloom (Render palette), and the light objects (how many, how many on, spots, Spotlight lighting devices, the first few with ids). Light objects are weighed against the sun as real lamps are (a fixture 6 m away gives about 3 % of daylight), so in daylight they hardly show: for a stage, a concert or any scene lit at night set preset dark_stage (sun off, a night sky, exposure +5, haze so the spots show as beams); daylight puts back what was there before. viz and render change only the fields given. lights switches, colours, dims, widens and aims light objects (ids, or every one), as one undo step: aimAt points each spot at one place, a performer say. Lighting devices' lights change through their parameters (Light On, RGBColor, Brightness, Pan, Tilt, Field and Beam Angle). Look or render afterwards to see it.",
      {
        preset: { type: "string", enum: ["dark_stage", "daylight"] },
        viz: {
          type: "object",
          description: "the 3D view's light",
          properties: {
            sun: { type: "string", enum: ["view", "heliodon", "off"], description: "off: only ambient light and the light objects, which then show brighter" },
            ambient: { type: "number", description: "0 to 2, 1 the usual" },
            lights: { type: "boolean", description: "the light objects light the model" },
            haze: { type: "number", description: "0 none to 1 thick: the spots that are on show as beams" },
          },
          additionalProperties: false,
        },
        render: {
          type: "object",
          description: "the renders' settings, section by section, only the fields given: sun {on, intensity, softness}, environment {sky: physical|gradient|color, zenith, horizon, ground (#rrggbb), intensity, visible, groundPlane, groundColor, groundGloss}, lights {on, intensity, haze}, exposure (stops), toneMap, fog {on, color, distance, height, base, glow}, effects {bloom, bloomThreshold, vignette, contrast, saturation, ...}",
        },
        lights: {
          type: "object",
          description: "light objects to change",
          properties: {
            ids: { type: "array", items: { type: "string" }, description: "lights' or lighting devices' ids; every light object when left out" },
            on: { type: "boolean" },
            color: { type: "string", description: "#rrggbb" },
            brightness: { type: "number", description: "1 = 100 %" },
            aimAt: { type: "array", items: { type: "number" }, minItems: 3, maxItems: 3, description: "point every spot at this place, world mm, z up" },
            spread: { type: "number", description: "a spot's field angle, degrees" },
            beam: { type: "number", description: "a spot's beam angle, degrees" },
          },
          additionalProperties: false,
        },
      },
    ),
    label: (a) => (a.preset === "dark_stage" ? "Lighting the stage for night" : a.lights ? "Changing the lights" : a.viz || a.render || a.preset ? "Changing the lighting" : "Reading the lighting"),
    async run(a) {
      const { lighting } = await import("./lighting.ts");
      return { text: toText(lighting(session(), { preset: a.preset, viz: a.viz, render: a.render, lights: a.lights })) };
    },
  },
  {
    spec: spec(
      "editor",
      "Works the editor as the user would: select objects (on one layer; it becomes active), zoom the plan to objects or fit it, set the active layer, show 2D or 3D, set the 3D render mode, pick a tool, save the file, or read its state.",
      {
        action: { type: "string", enum: ["state", "select", "zoom_to", "fit", "set_active_layer", "show_2d", "show_3d", "set_render_mode", "set_tool", "save"] },
        ids: { type: "array", items: { type: "string" } },
        layerId: { type: "string" },
        mode: { type: "string", enum: RENDER_MODES },
        tool: { type: "string" },
      },
      ["action"],
    ),
    label: (a) => `Editor: ${String(a.action ?? "").replace(/_/g, " ")}`,
    async run(a, ctx) {
      const app = ctx.app;
      switch (a.action) {
        case "state":
          return { text: toText(editorState(app)) };
        case "select": {
          const list = ids(a.ids);
          const doc = session().doc;
          const layers = new Set(list.map((id) => doc.object(id)?.layerId).filter(Boolean));
          if (layers.size === 1) {
            const only = [...layers][0]!;
            if (only !== store.activeLayerId) setActiveLayer(only);
          }
          const kept = effects.select(list);
          return { text: `Selected ${kept.length} of ${list.length}${kept.length < list.length ? " (only objects directly on the active layer, outside groups, can be selected)" : ""}.` };
        }
        case "zoom_to": {
          const b = boundsOfAll(session().doc, ids(a.ids));
          if (!b) throw new Error("none of those objects has a place in the plan");
          app.show2d();
          effects.zoomTo(b);
          return { text: "Zoomed the plan to them." };
        }
        case "fit":
          app.show2d();
          app.fit();
          return { text: "Fitted the plan to the drawing." };
        case "set_active_layer":
          setActiveLayer(str(a.layerId, "layerId"));
          return { text: "Done." };
        case "show_2d":
          app.show2d();
          return { text: "Showing the plan." };
        case "show_3d":
          return { text: (await app.show3d()) ? "Showing the 3D view." : "The 3D view isn't available here." };
        case "set_render_mode": {
          if (!RENDER_MODES.includes(a.mode as RenderMode)) throw new Error(`mode is one of ${RENDER_MODES.join(", ")}`);
          app.setRenderMode(a.mode as RenderMode);
          return { text: "Done." };
        }
        case "set_tool":
          app.setTool(str(a.tool, "tool") as ToolId);
          return { text: `The ${String(a.tool)} tool is active.` };
        case "save":
          await app.save();
          return { text: "Saved (File > Save)." };
        default:
          throw new Error("unknown action");
      }
    },
  },
  {
    spec: spec(
      "commands",
      "Lists the editor's menu commands as 'Menu › Item' paths (with whether each is enabled now), filtered by a query. Everything the menus can do is reachable through run_command.",
      { query: { type: "string" } },
    ),
    label: (a) => (a.query ? `Finding commands: ${String(a.query)}` : "Listing commands"),
    async run(a) {
      const q = typeof a.query === "string" ? norm(a.query) : "";
      const words = q.split(/\s+/).filter(Boolean);
      const list = commands().filter((c) => words.every((w) => norm(c.path).includes(w)));
      const lines = list.map((c) => `${c.path}${c.row.enabled && !c.row.enabled() ? " (disabled now)" : ""}`);
      return { text: lines.length ? clip(lines.join("\n"), MAX_TEXT) : "No command matches." };
    },
  },
  {
    spec: spec(
      "run_command",
      "Runs a menu command by its path, as the user choosing it would (e.g. 'Modify › Align › Align Left', 'View › Zoom › Fit to Objects'). Commands ending in … open a dialog for the user to answer. Prefer edit for changes the API covers.",
      { path: { type: "string" } },
      ["path"],
    ),
    label: (a) => `Running ${String(a.path ?? "")}`,
    async run(a) {
      const want = norm(str(a.path, "path"));
      const list = commands();
      const hit = list.find((c) => norm(c.path) === want) ?? list.find((c) => norm(c.path).endsWith(want));
      if (!hit) throw new Error(`no command ${a.path}: list them with commands`);
      if (hit.row.enabled && !hit.row.enabled()) throw new Error(`${hit.path} is disabled now (it may need a selection, a drawing or another view)`);
      hit.row.run!();
      return { text: `Ran ${hit.path}.${hit.row.label.endsWith("…") ? " It opened a dialog for the user." : ""}` };
    },
  },
  {
    spec: spec(
      "export_file",
      "Exports the drawing as a file the user can download from the chat: vwx (the drawing itself), pdf, svg, png, dxf, ifc, obj, glb, 3ds, stl (binary, millimetres), 3dm (Rhino: the 3D model plus 2D linework, millimetres), fbx, dae (Collada), ply or skp (SketchUp: symbols as components, groups as groups, classes as tags). layerIds chooses layers (the default is those drawn now; 3D formats take design layers).",
      { format: { type: "string", enum: FORMATS }, layerIds: { type: "array", items: { type: "string" } }, name: { type: "string", description: "file name without extension" }, widthPx: { type: "integer", description: "png only, default 3000" }, download: { type: "boolean", description: "also start the download now" } },
      ["format"],
    ),
    label: (a) => `Exporting ${String(a.format ?? "").toUpperCase()}`,
    async run(a, ctx) {
      const format = a.format as Format;
      if (!FORMATS.includes(format)) throw new Error(`format is one of ${FORMATS.join(", ")}`);
      const name = (typeof a.name === "string" && a.name.trim() ? a.name.trim() : baseName()).replace(/[\\/:*?"<>|]+/g, "-");
      const file = await exportFile(ctx.app, format, ids(a.layerIds), name, num(a.widthPx, 3000));
      if (a.download === true) downloadBlob(file.name, file.blob);
      const images = format === "png" ? [{ ...(await blobPicture(file.blob)), caption: file.name }] : undefined;
      return { text: `Made ${file.name} (${Math.round(file.blob.size / 1024)} KB); it is in the chat for the user to download.`, files: [file], images };
    },
  },
  {
    spec: spec(
      "import_file",
      "Imports a file the user attached to the chat, by its name: .vwx opens in place of the drawing; .dxf, .dwg (AutoCAD R13 to 2018 and later), .pdf, .obj, .gltf/.glb, .3ds, .stl, .ifc, .usd, .skp (SketchUp), .3dm (Rhino), .fbx, .dae/.kmz (SketchUp's Collada), .blend (Blender) and .ply come into the active layer, selected. OBJ, 3DS, STL and PLY files don't say their units: give units and yUp (default metres, millimetres for STL; y up for OBJ, z up for 3DS, STL and PLY); the others say their own. A PDF imports one page (default 1) at a scale (default the layer's).",
      {
        name: { type: "string" },
        units: { type: "string", enum: Object.keys(MESH_UNITS), description: "OBJ and 3DS" },
        yUp: { type: "boolean", description: "OBJ and 3DS: the model's y axis is up" },
        page: { type: "integer", description: "PDF: 1-based" },
        scale: { type: "number", description: "PDF: 1:scale" },
        lines: { type: "boolean", description: "PDF: line work and fills, default true" },
        text: { type: "boolean", description: "PDF: text, default true" },
      },
      ["name"],
    ),
    label: (a) => `Importing ${String(a.name ?? "")}`,
    async run(a, ctx) {
      const name = str(a.name, "name");
      const file = ctx.attachments.get(name) ?? [...ctx.attachments.values()].find((f) => f.name.toLowerCase() === name.toLowerCase());
      if (!file) throw new Error(`no attachment is called ${name}; attached: ${[...ctx.attachments.keys()].join(", ") || "none"}`);
      const flag = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);
      const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
      return importFile(ctx.app, file, {
        units: typeof a.units === "string" ? a.units : undefined,
        yUp: flag(a.yUp),
        page: n(a.page),
        scale: n(a.scale),
        lines: flag(a.lines),
        text: flag(a.text),
      });
    },
  },
  {
    spec: spec(
      "axo_to_3d",
      "Builds a 3D scaffold from isometric or axonometric line work (Rhino Make2D output, a hand-drawn iso view): finds the drawing's three axis directions from its lines, puts each corner back in 3D, and on a new design layer makes a mesh of the flat faces it finds for each separate building, and 3D lines of every edge. Give the design layer holding the line work, and ids to use only some of it (one building; a group's contents count). Make2D's hidden-line classes are used too. Lengths come out true for an isometric projection; give scale (drawn length of 1 mm along an axis) for another, 1 for an iso drawing drawn full length. Then look_3d at the result and tidy it: faces it missed, heights to check with the user.",
      {
        layerId: { type: "string", description: "the layer with the line work: its id or name" },
        ids: { type: "array", items: { type: "string" }, description: "only these objects" },
        scale: { type: "number" },
        tolerance: { type: "number", description: "how far apart (drawing mm) line ends may be and still meet; default a fifty-thousandth of the drawing's size. Raise it for line work whose lines stop short or overshoot" },
        name: { type: "string", description: "the new layer's name, default the layer's name + \" 3D\"" },
      },
      ["layerId"],
    ),
    label: () => "Building 3D from the line work",
    async run(a, ctx) {
      const s = session();
      const key = str(a.layerId, "layerId");
      const layer = s.doc.layers().find((l) => l.id === key) ?? s.doc.layers().find((l) => l.name === key);
      if (!layer || layer.kind !== "design") throw new Error(`no design layer ${key}`);
      const segments = lineWork(s.doc, layer.id, new Set(ids(a.ids)));
      if (segments.length < 3) throw new Error(`${layer.name} has ${segments.length} straight lines to work from${ids(a.ids).length ? " among those objects" : ""}`);
      if (segments.length > AXO_LINES) throw new Error(`${layer.name} has ${segments.length} straight lines, more than ${AXO_LINES} at once: give ids for part of it (one building or group)`);
      ctx.progress(`${segments.length} lines`);
      const m = unprojectIso(segments, { scale: typeof a.scale === "number" && a.scale > 0 ? a.scale : undefined, tolerance: typeof a.tolerance === "number" && a.tolerance > 0 ? a.tolerance : undefined });
      if (!m.vertices.length) return { text: `Couldn't place any of ${layer.name}'s lines in 3D. ${m.notes.join(" ")}`, error: true };
      const name = freeLayerName(s.doc, typeof a.name === "string" && a.name.trim() ? a.name.trim() : `${layer.name} 3D`);
      const at = underDrawing(m, segments);
      const parts = meshParts(m, at);
      const made = s.batch(() => {
        const target = s.createLayer(name, "design", layer.scale);
        const meshes = parts.length ? s.addMeshes(target, parts) : [];
        const edges = m.edges.length ? s.add3DPolygons(target, m.edges.map(([i, j]) => ({ points: [...at[i], ...at[j]], closed: false }))) : null;
        return { target, meshes, edges };
      });
      setSelection(made.meshes.length ? made.meshes : made.edges ? [made.edges] : []);
      const madeIds = new Set(made.meshes);
      const { solids } = checkSolids(s.doc.model3d().filter((x) => madeIds.has(x.objectId)));
      const open = solids.reduce((n, x) => n + x.closure.open, 0);
      const all = solids.reduce((n, x) => n + x.closure.edges, 0);
      return {
        text: toText({
          layer: { id: made.target, name },
          from: { lines: segments.length, hidden: segments.filter((g) => g.hidden).length },
          axes: m.axes,
          buildings: m.components,
          corners: m.vertices.length,
          edges: m.edges.length,
          faces: m.faces.length,
          meshes: made.meshes,
          edgeLines: made.edges,
          skippedLines: m.skipped,
          notes: m.notes,
          closed: closureVerdict(solids),
          next:
            all > 0 && open > all * 0.02
              ? "This scaffold has holes and won't tidy into a model (lines that stop short or overshoot do this): don't mend it face by face. Measure from it and model the building from parts with build, then check_3d what you built."
              : "look_3d it (holes: true shows anything still open) and mend what check_3d reports.",
        }),
      };
    },
  },
  {
    spec: spec(
      "measure_axo",
      "Measures an axonometric or isometric drawing (Make2D views, hand-drawn isos, ones not drawn exactly) so you can model from it: fits the three directions its lines run along (their angles and foreshortening) on a layer or some of its objects, then reads lines as true lengths: one drawn along an axis as its length along that axis, any other as the run (dx, dy, dz) and slope it would have in each plane through two axes (a gable's verge lies in an upright plane, so read its rise and pitch there; a hip's or a splayed bay's plan in the level one). Fit the axes on one building at a time when a layer holds several views. Give lines as object ids (a line, or each side of a rectangle or polygon) or as drawn point pairs [x0, y0, x1, y1].",
      {
        layerId: { type: "string", description: "the layer with the drawing: its id or name" },
        ids: { type: "array", items: { type: "string" }, description: "fit the axes on these objects only (a group's contents count)" },
        lines: { type: "array", items: { type: "string" }, description: "objects whose sides to read" },
        pairs: { type: "array", items: { type: "array", items: { type: "number" }, minItems: 4, maxItems: 4 }, description: "drawn lines to read, [x0, y0, x1, y1] in drawing mm" },
      },
      ["layerId"],
    ),
    label: () => "Measuring the drawing",
    async run(a) {
      const s = session();
      const layer = designLayer(s.doc, str(a.layerId, "layerId"));
      const segments = lineWork(s.doc, layer.id, new Set(ids(a.ids)));
      const axes = findAxes(segments);
      if (!axes) return { text: `${layer.name}'s lines${ids(a.ids).length ? " among those objects" : ""} don't run along three directions, so they can't be measured as an axonometric drawing`, error: true };
      const deg = (p: { x: number; y: number }): number => Math.round(((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360 * 10) / 10;
      const readings: unknown[] = [];
      const read = (from: { x: number; y: number }, to: { x: number; y: number }, extra: Record<string, unknown>): void => {
        if (readings.length < 300) readings.push({ ...extra, from, to, ...readDrawn(axes, from, to) });
      };
      for (const id of ids(a.lines)) {
        const o = s.doc.object(id);
        const pts = o?.shape?.points ?? [];
        if (!o || pts.length < 2) {
          readings.push({ id, error: "not a line, rectangle, polygon or polyline" });
          continue;
        }
        const closed = !!o.shape?.closed || o.shape?.kind === "rect";
        const n = closed ? pts.length : pts.length - 1;
        for (let i = 0; i < n; i++) read(pts[i], pts[(i + 1) % pts.length], n > 1 ? { id, side: i } : { id });
      }
      for (const q of Array.isArray(a.pairs) ? a.pairs : []) {
        if (Array.isArray(q) && q.length === 4 && q.every((v) => typeof v === "number" && Number.isFinite(v))) read({ x: q[0], y: q[1] }, { x: q[2], y: q[3] }, {});
      }
      return {
        text: toText(
          rounded({
            layer: layer.name,
            fittedOn: segments.length,
            axes: Object.fromEntries((["x", "y", "z"] as const).map((k, i) => [k, { drawnAt: deg(axes.dirs[i]), drawnPerMm: Math.hypot(axes.m[i].x, axes.m[i].y) }])),
            seenFrom: axes.from,
            // look_3d's preset from the same corner, as the drawing is taken to be seen from above
            matchingView: axes.from[1] > 0 ? (axes.from[0] > 0 ? "rightRearIso" : "leftRearIso") : axes.from[0] > 0 ? "iso" : "leftIso",
            notes: axes.notes,
            readings,
          }),
        ),
      };
    },
  },
  {
    spec: spec(
      "read_plan",
      "Reads a 2D floor plan's line work into walls (centre lines and thicknesses), the door and window openings in them, and rooms with their areas and labels. forBuild has the walls chained into runs (corners joined, loops closed, openings placed by their middle) as build's walls elements: add height and the openings' sizes and styles, and pass them on. Give the layer, and ids to read only part of it. It reads lines, not intent: check what it found against look_plan before building, and fix or add what it missed.",
      {
        layerId: { type: "string", description: "the layer with the plan: its id or name" },
        ids: { type: "array", items: { type: "string" }, description: "only these objects (a group's contents count)" },
      },
      ["layerId"],
    ),
    label: () => "Reading the floor plan",
    async run(a) {
      const s = session();
      const layer = designLayer(s.doc, str(a.layerId, "layerId"));
      const input = planInput(s.doc, layer.id, new Set(ids(a.ids)));
      if (!input.segments.length) return { text: `${layer.name} has no straight lines${ids(a.ids).length ? " among those objects" : ""} to read a plan from`, error: true };
      const r = readPlan(input);
      const forBuild = wallPaths(r).map((w) => ({ kind: "walls", path: w.path, closed: w.closed, thickness: w.thickness, openings: w.openings }));
      return { text: toText(rounded({ layer: layer.name, ...r, forBuild })) };
    },
  },
  {
    spec: spec(
      "build",
      `Models in 3D from a list of elements: walls with their window and door openings cut and filled, windows and doors with frames, glazing and fittings, floors, roofs (gable, hip, lean-to, flat, thatched and more), chimneys, steps, lawns, paths, driveways, hedges, fences, trees, plain solids and products' parts (one closed solid each, holes and slots cut). Upright parts become extrudes and sloped ones meshes, each in a class named for its category and filled in the drawing's nearest colour; each window, door, tree and the like is a named group; the whole call is one undo step. World mm, plan x right and y up, heights above the layer. Build in stages (walls and floors, then roofs, then openings' details or the garden) and look_3d after each.\n${BUILD_REFERENCE}`,
      {
        layer: { type: "string", description: "the design layer to build on: its id or name; a name no layer has makes a new design layer" },
        elements: { type: "array", items: { type: "object" }, description: "the elements, each with its kind and fields as above" },
        offset: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "moves everything by (dx, dy) in plan" },
      },
      ["layer", "elements"],
    ),
    label: (a) => `Building ${Array.isArray(a.elements) ? a.elements.length : 0} element${Array.isArray(a.elements) && a.elements.length === 1 ? "" : "s"} in 3D`,
    async run(a, ctx) {
      const s = session();
      const key = str(a.layer, "layer");
      const elements = Array.isArray(a.elements) ? a.elements : [];
      if (!elements.length) throw new Error("elements is empty");
      const { parts, notes } = buildParts(elements);
      if (!parts.length) return { text: toText({ made: 0, notes }), error: true };
      ctx.progress(`${parts.length} parts`);
      const existing = s.doc.layers().find((l) => l.id === key) ?? s.doc.layers().find((l) => l.name === key);
      if (existing && existing.kind !== "design") throw new Error(`${existing.name} is a sheet layer: build on a design layer`);
      const off = Array.isArray(a.offset) && a.offset.length === 2 && a.offset.every((v) => typeof v === "number" && Number.isFinite(v)) ? { x: a.offset[0] as number, y: a.offset[1] as number } : undefined;
      const active = s.doc.layers().find((l) => l.id === store.activeLayerId);
      const made = s.batch(() => {
        const target = existing ? existing.id : s.createLayer(key, "design", active?.kind === "design" ? active.scale : 50);
        return { target, placed: placeParts(s, target, parts, off) };
      });
      setSelection(made.placed.ids);
      return {
        text: toText(
          rounded({
            layer: { id: made.target, name: existing?.name ?? key, new: !existing },
            parts: parts.length,
            objects: made.placed.ids.length,
            byCategory: made.placed.counts,
            groups: made.placed.groups,
            newClasses: made.placed.newClasses,
            notes,
          }),
        ),
      };
    },
  },
  {
    spec: spec(
      "run_script",
      "Runs JavaScript in Rodeo's plug-in sandbox (a worker: no page, no network) with the whole API: `await openvwx.doc.<read>(...)`, `await openvwx.edit.<edit>(...)` (each one undo step), `await openvwx.edit.batch([[method, ...args], ...])` (one step), `openvwx.select(ids)`, `openvwx.zoomTo(ids)`, `openvwx.activeLayer()`. Every call is async and data crosses as plain JSON. The code runs as an async function body: `return` a value (up to 20,000 characters come back) and console.log lines come back too. Use it for loops over many objects, measuring, and edits that need earlier results. Each call starts afresh: nothing (variables, helpers) is kept from earlier calls.",
      { code: { type: "string" }, seconds: { type: "integer", description: `time limit, default ${SCRIPT_SECONDS}` } },
      ["code"],
    ),
    label: () => "Running a script",
    async run(a, ctx) {
      const code = str(a.code, "code");
      const logs: string[] = [];
      // the code is the worker's own script (the sandbox allows no eval), run as an async body
      const worker = new PluginWorker(
        code,
        {
          call: (method, x) => scriptCall(method, x),
          log: (level, text) => logs.push(level === "log" ? text : `[${level}] ${text}`),
          menu: () => {},
          uncaught: (e) => logs.push(`[uncaught] ${e.name}: ${e.message}`),
        },
        scriptApi(),
      );
      const seconds = Math.min(600, Math.max(1, num(a.seconds, SCRIPT_SECONDS)));
      let timer = 0;
      const stop = (): void => worker.kill();
      ctx.signal.addEventListener("abort", stop, { once: true });
      try {
        const outcome = await Promise.race([
          worker.start(),
          new Promise<never>((_r, reject) => (timer = window.setTimeout(() => reject(new Error(`the script ran past ${seconds} s and was stopped`)), seconds * 1000))),
        ]);
        const log = logs.length ? `console:\n${logs.join("\n")}\n` : "";
        if (!outcome.ok) {
          const at = outcome.error.line ? ` (line ${outcome.error.line})` : "";
          return { text: clip(`${log}${outcome.error.name}${at}: ${outcome.error.message}`, MAX_TEXT), error: true };
        }
        return { text: clip(`${log}result: ${outcome.text ?? "undefined"}`, MAX_TEXT) };
      } finally {
        window.clearTimeout(timer);
        ctx.signal.removeEventListener("abort", stop);
        worker.kill();
      }
    },
  },
  {
    spec: spec(
      "plugins",
      "Rodeo's saved plug-ins (Plug-ins menu): list them; save one you wrote (it gets a Plug-ins menu entry the user can run again; it uses the public plug-in API: openvwx.doc reads info, layers, classes, objects, object, selection, records, symbols, lineTypes, colors; openvwx.edit offers the common edits; openvwx.menu.add(label, fn) adds menu items; openvwx.ui.toast/alert/prompt); run one now; turn one on or off; or delete one. Code starts with header lines such as `// @name My Tool` and `// @description …`.",
      {
        action: { type: "string", enum: ["list", "save", "run", "enable", "disable", "delete"] },
        id: { type: "string" },
        code: { type: "string" },
        enabled: { type: "boolean", description: "save: turn it on, so its menu items appear" },
      },
      ["action"],
    ),
    label: (a) => `Plug-ins: ${String(a.action ?? "")}`,
    async run(a) {
      const find = (): ReturnType<typeof installed>[number] => {
        const rec = installed().find((r) => r.id === a.id || r.name === a.id);
        if (!rec) throw new Error(`no plug-in ${String(a.id)}: list them`);
        return rec;
      };
      switch (a.action) {
        case "list":
          return { text: toText(installed().map((r) => ({ id: r.id, name: displayName(r), description: r.description, enabled: r.enabled, lines: r.code.split("\n").length }))) };
        case "save": {
          const code = str(a.code, "code");
          const existing = typeof a.id === "string" ? installed().find((r) => r.id === a.id) : undefined;
          const rec = existing ? { ...newRecord(code), id: existing.id, created: existing.created, grants: existing.grants } : newRecord(code);
          rec.enabled = a.enabled === true || (existing?.enabled ?? false);
          await savePluginRecord(rec);
          return { text: `Saved "${displayName(rec)}" (id ${rec.id})${rec.enabled ? ", turned on: its menu items are in the Plug-ins menu" : ", turned off"}.` };
        }
        case "run": {
          const rec = find();
          const logs: string[] = [];
          const handle = runPlugin({ name: displayName(rec), code: rec.code, grants: grantsFor(rec), sink: { log: (level, text) => logs.push(`[${level}] ${text}`) }, invokeMenus: true });
          const r = await handle.finished;
          return { text: clip(`${r.ok ? "Ran" : "Failed:"} ${displayName(rec)}${r.error ? ` ${r.error.name}: ${r.error.message}` : ""}\n${logs.join("\n")}`, MAX_TEXT), error: !r.ok };
        }
        case "enable":
        case "disable": {
          const rec = find();
          await setEnabled(rec.id, a.action === "enable");
          return { text: "Done." };
        }
        case "delete": {
          const rec = find();
          await removePlugin(rec.id);
          return { text: `Deleted ${displayName(rec)}.` };
        }
        default:
          throw new Error("unknown action");
      }
    },
  },
];

const DELEGATE: Tool = {
  spec: spec(
    "delegate",
    "Hands independent pieces of work to subagents (a faster, cheaper model with the same tools, apart from this one), which run at the same time and report back. Give each a self-contained brief: they don't see this conversation. Good for surveying many layers, checking several views, or making separate parts of a change; keep the plan and the final say yourself.",
    { tasks: { type: "array", items: { type: "object", properties: { title: { type: "string" }, instructions: { type: "string" } }, required: ["title", "instructions"] }, minItems: 1, maxItems: 6 } },
    ["tasks"],
  ),
  label: (a) => `Delegating ${Array.isArray(a.tasks) ? a.tasks.length : 0} task${Array.isArray(a.tasks) && a.tasks.length === 1 ? "" : "s"}`,
  async run(a, ctx) {
    if (!ctx.delegate) throw new Error("subagents can't delegate");
    const tasks = (Array.isArray(a.tasks) ? a.tasks : [])
      .filter((t): t is SubTask => !!t && typeof t === "object" && typeof (t as SubTask).title === "string" && typeof (t as SubTask).instructions === "string")
      .slice(0, 6);
    if (!tasks.length) throw new Error("give tasks, each with a title and instructions");
    return { text: await ctx.delegate(tasks) };
  },
};

/** The tools a planner (with delegate) or a subagent gets. */
export function toolsFor(planner: boolean, ctx: AppContext): readonly Tool[] {
  appCtx = ctx;
  return planner ? [...TOOLS, DELEGATE] : TOOLS;
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
