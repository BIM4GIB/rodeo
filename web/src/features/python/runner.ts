// Runs a Python script written for Vectorworks: Pyodide in a Web Worker (fetched from the CDN the
// first time a script runs, then kept for the visit), with the vs module (vsModule.ts) over a copy
// of the open drawing taken as the script starts. A Vectorscript is translated to Python there
// first (vscriptModule.ts), its errors given at its own lines. What the script changed comes back as a list of
// steps, applied here as one undo step; a script that fails changes nothing. The vs dialogs that
// wait for an answer (StrDialog, YNDialog...) pause the script while the editor's dialog is open,
// where the browser can pause WebAssembly (JSPI); elsewhere they raise an error.
//
// A Vectorworks plug-in's script runs the same way, with its parameters and the Python files that
// came with it; an object plug-in's script draws into its object (one in the drawing, or one placed
// as the run is applied), replacing what it held, in the same undo step.

import { fieldKind, type Attributes, type Affine, type Arrange, type ByClassGroup, type EditSession, type FieldKind, type NewShape, type PluginFieldSpec, type Pt, type RecordValue, type TextStyle, type Visibility } from "../../core/index.ts";
import { setActiveClass, setActiveLayer, setSelection } from "../../app/commands.ts";
import { h } from "../../app/dom.ts";
import { appContext, registerOverlay } from "../../app/ext.ts";
import { showDialog } from "../../app/menubar.ts";
import { toolOfSelector } from "../../app/customScripts.ts";
import { store, type DisplayMode, type ToolId } from "../../app/state.ts";
import { DISPLAY_MODES } from "../../app/displayModes.ts";
import { textDefaults } from "../../app/tools/text.ts";
import { toast } from "../../app/toast.ts";
import { millimetresPerUnit, parseLength } from "../../app/units.ts";
import { showAlert } from "../plugins/ui.ts";
import { closeLayoutDialog, closeLayoutDialogs, runLayoutDialog } from "./layoutDialog.ts";
import { VS_SOURCE } from "./vsModule.ts";
import { VSC_SOURCE } from "./vscriptModule.ts";

const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.28.3/full/";

/** Where a plug-in's own Python files are put for its run, first on the import path. */
const PLUGIN_DIR = "/rodeo/plugin";

/** The text tool's size on paper, mm, which new text takes until vs.TextSize sets one. */
const TEXT_PAPER_MM = 2.5;
/** a point, mm: TextSize gives points */
const MM_PER_POINT = 25.4 / 72;

/** Runs the script in the worker: the vs module set up over the snapshot, the script's own globals fresh. */
const RUN_PY = `
import json as _json, traceback as _tb
import sys as _sys, importlib as _importlib
import vs as _vs
# a plug-in's own modules: imported fresh each run, as its files may have changed
if _plugin_dir not in _sys.path:
    _sys.path.insert(0, _plugin_dir)
for _n in [k for k, m in list(_sys.modules.items()) if (getattr(m, "__file__", None) or "").startswith(_plugin_dir + "/")]:
    del _sys.modules[_n]
_importlib.invalidate_caches()
_vs._init(_snapshot)
_g = {"__name__": "__main__", "__file__": _file}
_err = None
_where = None
try:
    _src = _code
    if _vectorscript:
        import _vsc
        _src, _where = _vsc.translate(_code)
        _g.update(_vsc.runtime())
    exec(compile(_src, _file, "exec"), _g)
except SystemExit as e:
    if e.code not in (None, 0):
        _err = {"name": "SystemExit", "message": str(e.code), "line": None}
except BaseException as e:
    _line = getattr(e, "lineno", None) if isinstance(e, SyntaxError) and e.filename == _file else None
    for _f in _tb.extract_tb(e.__traceback__):
        if _f.filename == _file:
            _line = _f.lineno
    _name = type(e).__name__
    _msg = str(e)
    if _name == "VsError":
        _name, _line = "Error", e.line
    elif _where is not None:
        if _line is not None:
            _line = _where[_line - 1] if 0 < _line <= len(_where) else None
        if _name == "NotImplementedError":
            _msg = _msg.replace("vs.", "", 1)
    _err = {"name": _name, "message": _msg, "line": _line}
_out = _json.loads(_vs._result()) if _err is None else {}
_out["error"] = _err
_json.dumps(_out)
`;

function workerSource(): string {
  return `
importScripts(${JSON.stringify(PYODIDE + "pyodide.js")});
const VS = ${JSON.stringify(VS_SOURCE)};
const VSC = ${JSON.stringify(VSC_SOURCE)};
const RUN = ${JSON.stringify(RUN_PY)};
const DIR = ${JSON.stringify(PLUGIN_DIR)};
const asks = new Map();
let seq = 0;
let py = null;
const ready = (async () => {
  py = await loadPyodide({ indexURL: ${JSON.stringify(PYODIDE)} });
  py.registerJsModule("_rodeo", {
    ask: (kind, args) => new Promise((resolve) => {
      const id = ++seq;
      asks.set(id, resolve);
      postMessage({ type: "ask", id, kind, args });
    }),
  });
  py.globals.set("_vs_source", VS);
  py.globals.set("_vsc_source", VSC);
  py.runPython('import sys, types\\nfor _n, _s in (("vs", _vs_source), ("_vsc", _vsc_source)):\\n    _m = types.ModuleType(_n)\\n    sys.modules[_n] = _m\\n    exec(compile(_s, _n + ".py", "exec"), _m.__dict__)');
  // honest, not a sandbox (as plug-ins): once Python is in, the network entry points go
  for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts"]) {
    self[k] = function () { throw new Error(k + " isn't available to scripts"); };
  }
  postMessage({ type: "ready", jspi: typeof WebAssembly.Suspending === "function" });
})();
ready.catch((e) => postMessage({ type: "failed", message: String(e && e.message || e) }));
function writeModules(files) {
  const FS = py.FS;
  const clear = (dir) => {
    for (const n of FS.readdir(dir)) {
      if (n === "." || n === "..") continue;
      const p = dir + "/" + n;
      if (FS.isDir(FS.stat(p).mode)) {
        clear(p);
        FS.rmdir(p);
      } else FS.unlink(p);
    }
  };
  FS.mkdirTree(DIR);
  clear(DIR);
  for (const [path, text] of Object.entries(files)) {
    const cut = path.lastIndexOf("/");
    if (cut > 0) FS.mkdirTree(DIR + "/" + path.slice(0, cut));
    FS.writeFile(DIR + "/" + path, text);
  }
}
onmessage = async (e) => {
  const m = e.data;
  if (m.type === "answer") {
    const resolve = asks.get(m.id);
    asks.delete(m.id);
    if (resolve) resolve(m.value);
    return;
  }
  if (m.type !== "run") return;
  try {
    await ready;
  } catch (err) {
    return;
  }
  py.setStdout({ batched: (text) => postMessage({ type: "print", text }) });
  py.setStderr({ batched: (text) => postMessage({ type: "warn", text }) });
  py.globals.set("_snapshot", m.snapshot);
  py.globals.set("_code", m.code);
  py.globals.set("_file", m.file);
  py.globals.set("_vectorscript", m.vectorscript);
  py.globals.set("_plugin_dir", DIR);
  try {
    writeModules(m.modules || {});
    postMessage({ type: "done", result: await py.runPythonAsync(RUN) });
  } catch (err) {
    postMessage({ type: "done", result: JSON.stringify({ error: { name: "Error", message: String(err && err.message || err), line: null } }) });
  }
};
`;
}

// ---- the copy of the drawing ---------------------------------------------------------------------

interface Units {
  readonly mm: number;
  readonly mark: string;
  readonly area: string;
  readonly format: number;
  readonly display: number;
}

/** The drawing's units as vs.GetUnits gives them; feet and inches count in inches, as Vectorworks' scripts do. */
export function scriptUnits(name: string | undefined): Units {
  const key = (name ?? "").toLowerCase().replace("&", "and");
  if (key.startsWith("feet and inches") || key === "inches") return { mm: 25.4, mark: '"', area: "sq ft", format: key === "inches" ? 1 : 3, display: 16 };
  if (key === "feet") return { mm: 304.8, mark: "'", area: "sq ft", format: 3, display: 16 };
  const mm = millimetresPerUnit(name);
  const marks: Record<number, [string, number]> = { 1: ["mm", 2], 10: ["cm", 1], 1000: ["m", 3], 1e6: ["km", 3] };
  const [mark, display] = marks[mm] ?? [name ?? "mm", 2];
  return { mm, mark, area: mm >= 1000 ? "sq " + mark : "m²", format: 0, display };
}

function rgb(css: string): [number, number, number] {
  const n = parseInt(css.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A record field's value as a script reads it: a dimension in the drawing's units (scriptUnits). */
function scriptValue(kind: FieldKind | null, value: RecordValue, mm: number): RecordValue {
  return kind === "dimension" && typeof value === "number" ? value / mm : value;
}

/** How the vs module types a parameter's value. */
function scriptType(kind: FieldKind | null): "int" | "real" | "bool" | "str" {
  if (kind === "integer" || kind === "color") return "int";
  if (kind === "boolean") return "bool";
  if (kind === "number" || kind === "dimension" || kind === "angle" || kind === "area" || kind === "volume") return "real";
  return "str";
}

/** The id a plug-in object placed by its run has until the run is applied. */
const NEW_PLUGIN_OBJECT = "new:plugin";

/** The plug-in's parameters as the script reads them: the object's own values over the defaults, then those being set. */
function pluginParams(s: EditSession, run: PluginRun, mm: number): [string, string, RecordValue][] {
  const params = new Map<string, [string, string, RecordValue]>();
  for (const f of run.fields) params.set(f.name, [f.name, scriptType(fieldKind(f.type)), scriptValue(fieldKind(f.type), f.value, mm)]);
  const own = run.object ? s.doc.records(run.object).find((r) => r.name === run.name) : undefined;
  for (const f of own?.fields ?? []) {
    const kind = f.kind === "other" ? null : f.kind;
    const value = run.set && f.name in run.set ? run.set[f.name] : f.value;
    params.set(f.name, [f.name, scriptType(kind), scriptValue(kind, value, mm)]);
  }
  return [...params.values()];
}

/** The open drawing as the vs module reads it: lengths in millimetres, objects in their stacking order. */
function snapshot(s: EditSession, jspi: boolean, run?: PluginRun): string {
  const doc = s.doc;
  const units = scriptUnits(doc.info.units);
  const classes = doc.classes();
  const className = new Map(classes.map((c) => [c.index, c.name]));
  const fonts = doc.fonts();
  const formats = new Map<string, number>(doc.recordFormats().map((f) => [f.name, f.format]));
  const objects: unknown[] = [];
  // what the plug-in object being drawn holds now: Vectorworks clears it before the script runs
  const cleared = new Set<string>();
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (run?.object && o.parentId && (o.parentId === run.object || cleared.has(o.parentId))) {
        cleared.add(o.id);
        continue;
      }
      const g = o.shape;
      const records: Record<string, Record<string, RecordValue>> = {};
      for (const r of doc.records(o.id)) {
        formats.set(r.name, r.format);
        records[r.name] = Object.fromEntries(r.fields.map((f) => [f.name, scriptValue(f.kind === "other" ? null : f.kind, f.value, units.mm)]));
      }
      const box = g?.bbox ?? o.bounds ?? null;
      objects.push({
        id: o.id,
        type: o.type,
        typeName: o.typeName,
        layer: o.layerId,
        parent: o.parentId,
        cls: o.className,
        name: o.name ?? "",
        bbox: box ? [box.x0, box.y0, box.x1, box.y1] : null,
        attrs: o.attrs,
        byClass: o.byClass ?? [],
        sym: o.symbol ?? null,
        records,
        shape: g
          ? {
              kind: g.roundRect ? "roundrect" : g.kind,
              pts: g.roundRect ? g.roundRect.corners.map((p) => [p.x, p.y]) : g.points.map((p) => [p.x, p.y]),
              closed: g.closed,
              verts: g.vertices?.map((v) => [v.p.x, v.p.y, v.kind, v.radius]),
              center: g.center ? [g.center.x, g.center.y] : undefined,
              rx: g.rx,
              ry: g.ry,
              rr: g.roundRect ? [g.roundRect.rx, g.roundRect.ry] : undefined,
              start: g.startAngle,
              sweep: g.sweepAngle,
              text: g.text,
              at: g.anchor ? [g.anchor.x, g.anchor.y] : undefined,
              ...(g.kind === "text"
                ? {
                    size: g.textSize,
                    angle: g.textAngle,
                    h: g.hAlign,
                    v: g.vAlign,
                    font: g.fontIndex === undefined ? undefined : fonts[g.fontIndex],
                    tstyle: g.textStyle,
                    bold: g.bold,
                    italic: g.italic,
                    underline: g.underline,
                  }
                : {}),
            }
          : null,
      });
    }
  }
  let plugin: unknown = null;
  let activeLayer = store.activeLayerId;
  if (run) {
    const params = pluginParams(s, run, units.mm);
    let object = run.object ?? null;
    if (object) activeLayer = doc.object(object)?.layerId ?? activeLayer;
    else if (run.place) {
      object = NEW_PLUGIN_OBJECT;
      activeLayer = run.place.layer;
      objects.push({
        id: object,
        type: 86,
        typeName: "plug-in-object",
        layer: activeLayer,
        parent: null,
        cls: className.get(run.place.classIndex ?? store.activeClassIndex) ?? "None",
        name: "",
        bbox: null,
        attrs: store.drawAttrs,
        sym: null,
        records: { [run.name]: Object.fromEntries(params.map(([name, , value]) => [name, value])) },
        shape: null,
      });
    }
    // the plug-in's own format, made as the run is applied when the drawing hasn't one
    if (!formats.has(run.name)) formats.set(run.name, NEW_FORMAT);
    plugin = { name: run.name, object, isNew: !run.object, params, event: run.event ?? RECALCULATE, eventData: run.eventData ?? 0 };
  }
  return JSON.stringify({
    units,
    layers: doc.layers().map((l) => ({ id: l.id, name: l.name, kind: l.kind, scale: l.scale, vis: l.visibility, elev: l.elevation ?? 0 })),
    classes: classes.map((c) => ({ name: c.name, vis: c.visibility, attrs: c.attrs, textStyle: c.textStyle })),
    activeLayer,
    activeClass: className.get(store.activeClassIndex) ?? "None",
    palette: doc.colors().map((c) => [c.index, ...rgb(c.css)]),
    symbols: doc.symbolDefs().map((x) => ({ index: x.index, name: x.name })),
    formats: [...formats].map(([name, format]) => ({ name, format })),
    objects,
    selection: [...store.selection],
    newAttrs: store.drawAttrs,
    templateAttrs: s.templateAttributes("rect"),
    fonts,
    classMode: store.classMode,
    layerMode: store.layerMode,
    textPaperMm: TEXT_PAPER_MM,
    jspi,
    plugin,
  });
}

// ---- applying what the script did -----------------------------------------------------------------

interface ScriptError {
  readonly name: string;
  readonly message: string;
  readonly line: number | null;
}

interface Result {
  readonly ops?: unknown[][];
  readonly selection?: string[] | null;
  readonly activeLayer?: string | null;
  readonly activeClass?: string | null;
  readonly messages?: string[];
  readonly alerts?: string[];
  /** a plug-in object's run: what it drew, top level, in the object's own frame */
  readonly drawing?: string[] | null;
  /** a plug-in's run: what it set up for Object Info */
  readonly ui?: PluginUi | null;
  /** whether it asked for its object to be drawn again (ResetObject) */
  readonly reset?: boolean;
  /** the attributes it set for new objects (FillPat, PenFore, SetDefaultOpacity...); not a plug-in's */
  readonly attrs?: Partial<Attributes> | null;
  /** the text settings it set: TextSize in points, TextJust, TextVerticalAlign; not a plug-in's */
  readonly text?: { readonly pts?: number; readonly h?: number; readonly v?: number } | null;
  /** the tool it chose with SetTool, by Vectorworks' number */
  readonly tool?: number | null;
  /** Layer Options and Class Options as it leaves them (SetLayerOptions, SetClassOptions) */
  readonly layerMode?: DisplayMode | null;
  readonly classMode?: DisplayMode | null;
  readonly error: ScriptError | null;
}

/** A row a plug-in adds to its Object Info layout, as the vs module records it. */
export interface PluginUiWidget {
  readonly id?: number;
  /** a widget's type (vsoAddWidget's), when it isn't a parameter's */
  readonly type?: number;
  /** the parameter it shows (vsoAddParamWidget) */
  readonly param?: string;
  /** every parameter in order (vsoInsertAllParams) */
  readonly all?: boolean;
  readonly label?: string;
  readonly level: number;
}

/** What a plug-in's script set up for Object Info in its run. */
export interface PluginUi {
  /** the object properties it set (SetObjPropVS), by number */
  readonly props: Readonly<Record<string, boolean>>;
  readonly widgets: readonly PluginUiWidget[];
  /** the widgets it greyed or hid, or enabled and showed, by id */
  readonly states: Readonly<Record<string, { readonly enabled?: boolean; readonly visible?: boolean }>>;
}

/** The event that draws a plug-in object (vsoGetEventInfo's); runs for its other events apply nothing. */
const RECALCULATE = 3;

/** The format number the vs module gives a plug-in's format the drawing doesn't have yet. */
const NEW_FORMAT = -1;

const SHAPE_KINDS: ReadonlySet<string> = new Set(["line", "rect", "roundrect", "polygon", "polyline", "arc", "text", "locus"]);
const ARRANGE: ReadonlySet<string> = new Set(["front", "back", "forward", "backward"]);
const VISIBILITY: ReadonlySet<string> = new Set(["visible", "hidden", "grayed"]);
const BY_CLASS: ReadonlySet<string> = new Set(["fill", "lineStyle", "penColor", "lineWeight", "opacity"]);

/** A 3D polygon a script adds, as vsModule's _add_poly3d sends it. */
interface Poly3DStep {
  readonly kind: "poly3d";
  readonly points: readonly number[];
  readonly closed: boolean;
}

const str = (v: unknown): string => String(v);
const ids = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

/** A record field's value in the field's own kind: numbers and booleans from the script's text, a dimension from the drawing's units. */
function fieldValue(s: EditSession, id: string, format: number, field: string, text: string): RecordValue {
  const f = s.doc.records(id).find((r) => r.format === format)?.fields.find((x) => x.name === field);
  const current = f?.value;
  if (f?.kind === "dimension") {
    const n = Number(text.trim());
    const mm = Number.isFinite(n) && text.trim() !== "" ? n * scriptUnits(s.doc.info.units).mm : parseLength(text, s.doc.info.units);
    if (mm === null) throw new Error(`field "${field}" takes a length, not "${text}"`);
    return mm;
  }
  if (typeof current === "number") {
    const n = Number(text);
    if (!Number.isFinite(n)) throw new Error(`field "${field}" takes a number, not "${text}"`);
    return n;
  }
  if (typeof current === "boolean") return /^(true|yes|1)$/i.test(text.trim());
  return text;
}

/** What a plug-in run does around the script's steps, in the same undo step. */
interface Around {
  /** the plug-in's name: its format's, which a step's NEW_FORMAT stands for */
  readonly plugin?: string;
  before?(made: Map<string, string>): void;
  after?(made: Map<string, string>): void;
}

/** Applies the script's steps in one undo step; the ids it made up become the real ones as they are made. */
function applySteps(s: EditSession, steps: readonly unknown[][], around: Around = {}): Map<string, string> {
  const made = new Map<string, string>();
  const real = (v: unknown): string => made.get(str(v)) ?? str(v);
  const classIndex = (name: string): number => s.doc.classes().find((c) => c.name === name)?.index ?? s.createClass(name);
  s.batch(() => {
    around.before?.(made);
    for (const step of steps) {
      const [kind, ...a] = step;
      switch (kind) {
        case "add": {
          const shape = a[2] as NewShape | Poly3DStep;
          const attrs = (a[4] ?? undefined) as Record<string, number> | undefined;
          const cls = a[3] === null ? undefined : classIndex(str(a[3]));
          if (shape?.kind === "poly3d") {
            // a 3D polygon (vs.Poly3D, vs.BeginPoly3D ... vs.EndPoly3D): its points as x, y, z in mm
            const id = s.add3DPolygons(real(a[1]), [{ points: shape.points.map(Number), closed: !!shape.closed }], cls);
            if (attrs) s.setAttributes([id], attrs);
            made.set(str(a[0]), id);
            break;
          }
          if (!SHAPE_KINDS.has(shape?.kind)) throw new Error(`a script can't add a ${String(shape?.kind)}`);
          made.set(str(a[0]), s.addObject(real(a[1]), shape, cls, attrs));
          break;
        }
        case "group":
          made.set(str(a[0]), s.groupObjects(ids(a[1]).map(real)));
          break;
        case "ungroup":
          s.ungroupObjects(ids(a[0]).map(real));
          break;
        case "delete":
          s.deleteObjects(ids(a[0]).map(real));
          break;
        case "xform": {
          const m = a[1] as Affine;
          const list = ids(a[0]).map(real);
          if (m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1) s.moveObjects(list, m.e, m.f);
          else s.transformObjects(list, m);
          break;
        }
        case "dup": {
          const copies = s.duplicateObjects(ids(a[1]).map(real), Number(a[2]), Number(a[3]));
          ids(a[0]).forEach((tmp, i) => {
            if (copies[i]) made.set(tmp, copies[i]);
          });
          break;
        }
        case "attrs":
          s.setAttributes(ids(a[0]).map(real), a[1] as Record<string, number>);
          break;
        case "class":
          s.setObjectClass(ids(a[0]).map(real), classIndex(str(a[1])));
          break;
        case "byclass":
          if (!BY_CLASS.has(str(a[1]))) throw new Error(`unknown attribute group ${str(a[1])}`);
          s.setAttributesByClass(ids(a[0]).map(real), str(a[1]) as ByClassGroup, a[2] !== false);
          break;
        case "textstyle": {
          // Rodeo keeps a restyled text where it stands; Vectorworks keeps its origin (the text shifts), or
          // puts the origin at a point (SetTextOrientation), unless the script asked otherwise (SetTextJustN)
          const list = ids(a[0]).map(real);
          const origin = (id: string): Pt | undefined => s.doc.object(id)?.shape?.anchor;
          const before = list.map(origin);
          s.setTextStyle(list, a[1] as TextStyle);
          const to = a[2];
          if (!to) break;
          list.forEach((id, i) => {
            const want = Array.isArray(to) ? { x: Number(to[0]), y: Number(to[1]) } : before[i];
            const now = origin(id);
            if (want && now && (want.x !== now.x || want.y !== now.y)) s.moveObjects([id], want.x - now.x, want.y - now.y);
          });
          break;
        }
        case "geom":
          s.setGeometry(real(a[0]), a[1] as NewShape);
          break;
        case "name":
          s.setObjectName(real(a[0]), str(a[1]));
          break;
        case "text":
          s.setText(real(a[0]), str(a[1]));
          break;
        case "arrange":
          if (!ARRANGE.has(str(a[1]))) throw new Error(`unknown stacking move ${str(a[1])}`);
          s.arrangeObjects(ids(a[0]).map(real), str(a[1]) as Arrange);
          break;
        case "layer":
          made.set(str(a[0]), s.createLayer(str(a[1]), a[2] === "sheet" ? "sheet" : "design", a[3] == null ? undefined : Number(a[3])));
          break;
        case "layervis":
          if (!VISIBILITY.has(str(a[1]))) throw new Error(`unknown visibility ${str(a[1])}`);
          s.setLayerVisibility(real(a[0]), str(a[1]) as Visibility);
          break;
        case "layerscale":
          s.setLayerScale(real(a[0]), Number(a[1]));
          break;
        case "layerelev":
          s.setLayerElevation(real(a[0]), Number(a[1]));
          break;
        case "newclass":
          classIndex(str(a[0]));
          break;
        case "classattrs":
          s.setClassAttributes(classIndex(str(a[0])), a[1] as Partial<Attributes>);
          break;
        case "classtextstyle":
          s.setClassTextStyle(classIndex(str(a[0])), Number(a[1]));
          break;
        case "renameclass":
          s.renameClass(classIndex(str(a[0])), str(a[1]));
          break;
        case "delclass":
          s.deleteClass(classIndex(str(a[0])));
          break;
        case "classvis":
          if (!VISIBILITY.has(str(a[1]))) throw new Error(`unknown visibility ${str(a[1])}`);
          s.setClassVisibility(classIndex(str(a[0])), str(a[1]) as Visibility);
          break;
        case "record": {
          const id = real(a[0]);
          let format = Number(a[1]);
          if (format === NEW_FORMAT) format = s.doc.records(id).find((r) => r.name === around.plugin)?.format ?? NEW_FORMAT;
          s.setRecordField(id, format, str(a[2]), fieldValue(s, id, format, str(a[2]), str(a[3])));
          break;
        }
        default:
          throw new Error(`unknown step ${str(kind)}`);
      }
    }
    around.after?.(made);
  });
  return made;
}

// ---- the worker -------------------------------------------------------------------------------------

export interface RunEvents {
  print(kind: "print" | "warn" | "system", text: string): void;
}

let worker: Worker | null = null;
let ready: Promise<boolean> | null = null;
let running: ((r: Result) => void) | null = null;
/** where the running script's print output goes: the run's own, not the first run's that started the worker */
let printTo: RunEvents | null = null;

function startWorker(): Promise<boolean> {
  if (worker && ready) return ready;
  const url = URL.createObjectURL(new Blob([workerSource()], { type: "text/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  worker = w;
  ready = new Promise<boolean>((resolve, reject) => {
    w.onerror = (e) => {
      e.preventDefault();
      reject(new Error(e.message || "Python couldn't start."));
    };
    w.onmessage = (e: MessageEvent) => {
      const m = e.data as { type: string; jspi?: boolean; message?: string; text?: string; result?: string; id?: number; kind?: string; args?: string };
      switch (m.type) {
        case "ready":
          resolve(!!m.jspi);
          return;
        case "failed":
          reject(new Error(`Python couldn't start: ${m.message ?? ""}`));
          return;
        case "print":
        case "warn":
          printTo?.print(m.type, m.text ?? "");
          return;
        case "ask":
          void answer(w, m.id ?? 0, m.kind ?? "", m.args ?? "[]");
          return;
        case "done": {
          const done = running;
          running = null;
          closeLayoutDialogs();
          let result: Result;
          try {
            result = JSON.parse(m.result ?? "{}") as Result;
          } catch {
            result = { error: { name: "Error", message: "The script's result couldn't be read.", line: null } };
          }
          done?.(result);
          return;
        }
      }
    };
  });
  ready.catch(() => stopScript());
  return ready;
}

// ---- points the script asks for ---------------------------------------------------------------------

/** The points clicked so far for vs.GetPt, GetLine or GetRect, and the pointer: drawn over the drawing. */
let picking: { readonly pts: Pt[]; at: Pt | null; readonly rect: boolean } | null = null;

registerOverlay((p) => {
  if (!picking?.at) return;
  const { ctx } = p;
  const at = p.toScreen(picking.at);
  ctx.strokeStyle = "#2f7cf6";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(at.x - 8, at.y);
  ctx.lineTo(at.x + 8, at.y);
  ctx.moveTo(at.x, at.y - 8);
  ctx.lineTo(at.x, at.y + 8);
  const from = picking.pts[0] ? p.toScreen(picking.pts[0]) : null;
  if (from && picking.rect) ctx.rect(Math.min(from.x, at.x), Math.min(from.y, at.y), Math.abs(at.x - from.x), Math.abs(at.y - from.y));
  else if (from) {
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(at.x, at.y);
  }
  ctx.stroke();
});

/**
 * `n` points clicked in the drawing (mm, unsnapped), with a rubber band from the first; null when
 * Esc ends it. Other pointer and key input waits meanwhile, but the middle button still pans.
 */
function pickPoints(n: number, rect: boolean, prompt: string): Promise<number[][] | null> {
  const app = appContext();
  if (!app) return Promise.resolve(null);
  return new Promise((resolve) => {
    const pick = { pts: [] as Pt[], at: null as Pt | null, rect };
    picking = pick;
    const world = (e: PointerEvent): Pt => {
      const r = app.canvas.getBoundingClientRect();
      return app.view.toWorld(e.clientX - r.left, e.clientY - r.top);
    };
    const finish = (v: number[][] | null): void => {
      app.controller.setPointerGate(null);
      window.removeEventListener("keydown", key, true);
      picking = null;
      app.requestDraw();
      resolve(v);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      finish(null);
    };
    window.addEventListener("keydown", key, true);
    app.controller.setPointerGate((e, phase) => {
      if (phase === "cancel") return false;
      if (phase === "move") {
        pick.at = world(e);
        app.requestDraw();
        return (e.buttons & 4) === 0;
      }
      if (e.button !== 0) return false;
      if (phase === "down") pick.pts.push(world(e));
      // the last press's release is swallowed too, so the tool doesn't see a release with no press
      else if (pick.pts.length >= n) finish(pick.pts.map((q) => [q.x, q.y]));
      return true;
    });
    toast(prompt || (n === 1 ? "Click a point in the drawing (Esc ends the script)" : "Click two points in the drawing (Esc ends the script)"), "info");
  });
}

/** A vs dialog the script waits on: the editor's own, its answer sent back (null when cancelled). */
async function answer(w: Worker, id: number, kind: string, rawArgs: string): Promise<void> {
  const args = (JSON.parse(rawArgs) as unknown[]).map(str);
  let value: unknown = null;
  if (kind === "GetPt" || kind === "GetLine" || kind === "GetRect") {
    value = await pickPoints(kind === "GetPt" ? 1 : 2, kind === "GetRect", args[0] ?? "");
  } else if (kind === "Dialog") {
    value = await runLayoutDialog(args[0] ?? "{}");
  } else if (kind === "DialogClose") {
    closeLayoutDialog(Number(args[0]));
  } else if (kind === "AlrtDialog") {
    await showAlert("Script", args[0] ?? "");
  } else if (kind === "YNDialog") {
    value = (await showDialog<true>({ title: "Script", okLabel: "Yes", body: [h("p", { cls: "pi-alert", text: args[0] ?? "" })], check: () => ({ value: true }) })) === true;
  } else {
    const numeric = kind !== "StrDialog";
    const input = h("input", { cls: "menu-dialog-input", attrs: { type: "text", value: args[1] ?? "", spellcheck: "false" } });
    value = await showDialog<string | number>({
      title: "Script",
      okLabel: "OK",
      body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: args[0] ?? "" }), input)],
      check: () => {
        if (!numeric) return { value: input.value };
        const n = Number(input.value.trim());
        if (!Number.isFinite(n) || (kind === "IntDialog" && !Number.isInteger(n))) return { error: kind === "IntDialog" ? "Type a whole number." : "Type a number.", focus: input };
        return { value: n };
      },
    });
  }
  w.postMessage({ type: "answer", id, value: JSON.stringify(value) });
}

/** Stops a running script (it changes nothing) and the worker with it; the next run starts Python again. */
export function stopScript(): void {
  closeLayoutDialogs();
  worker?.terminate();
  worker = null;
  ready = null;
  const done = running;
  running = null;
  done?.({ error: { name: "Stopped", message: "Stopped: nothing was changed.", line: null } });
}

export function scriptRunning(): boolean {
  return running !== null;
}

/**
 * Whether a script is Vectorscript: one that starts (after its comments) with PROCEDURE or FUNCTION,
 * as no Python script does, or a .vs or .px file that doesn't start as Python does.
 */
export function isVectorscript(code: string, file: string): boolean {
  const head = code.replace(/^(\s|\{[^}]*\}|\(\*[\s\S]*?\*\)|\/\/[^\n]*)*/, "");
  if (/^(procedure|function)\s+[a-z_]\w*\s*[;(:]/i.test(head)) return true;
  return /\.(vs|px)$/i.test(file) && !/^\s*(import|from|def|class|#|print\s*\()/.test(code);
}

export interface RunOutcome {
  readonly error: ScriptError | null;
  /** objects the script added, changed or removed, counted by step */
  readonly steps: number;
  /** the plug-in object drawn (placed or drawn again), when the run was one */
  readonly object?: string;
  /** a plug-in's run: what it set up for Object Info */
  readonly ui?: PluginUi | null;
  /** a plug-in event's run on an object: the values it set on the object's parameters, not yet applied */
  readonly set?: Readonly<Record<string, RecordValue>>;
  /** a plug-in event's run: whether it asked for the object to be drawn again */
  readonly reset?: boolean;
  /** a plug-in event's run: how many of its other changes were left unapplied */
  readonly ignored?: number;
}

/** A Vectorworks plug-in's run: a command's or tool's, or an object's (one in the drawing, or one to place). */
export interface PluginRun {
  /** its name, which its parameters' record format has */
  readonly name: string;
  /** its parameters with their defaults, as its record holds them (lengths in millimetres) */
  readonly fields: readonly PluginFieldSpec[];
  /** the Python files that came with it, by path ("window.py", "UI/__init__.py") */
  readonly modules?: Readonly<Record<string, string>>;
  /** an object of the drawing that the script draws again */
  readonly object?: string;
  /** values set on that object's record first, as the record holds them (in the run's undo step) */
  readonly set?: Readonly<Record<string, RecordValue>>;
  /** where a new object is placed, holding what the script draws (with no object) */
  readonly place?: { readonly layer: string; readonly at: Pt; readonly angle: number; readonly classIndex?: number };
  /**
   * The event the script handles (vsoGetEventInfo) and its data, Recalculate when left out. A run for
   * another event (setting up Object Info, a button clicked) applies nothing: it reports what it set up,
   * and the values it set on the object for the caller to draw it again with.
   */
  readonly event?: number;
  readonly eventData?: number;
}

/** An event run's changes to its object's own parameters, as the record holds them; the rest are counted. */
function eventValues(s: EditSession, run: PluginRun, steps: readonly unknown[][]): { set: Record<string, RecordValue>; ignored: number } {
  const set: Record<string, RecordValue> = {};
  let ignored = 0;
  const id = run.object;
  const own = id ? s.doc.records(id).find((r) => r.name === run.name) : undefined;
  for (const [kind, ...a] of steps) {
    const format = Number(a[1]);
    if (id && own && kind === "record" && str(a[0]) === id && (format === own.format || format === NEW_FORMAT)) {
      set[str(a[2])] = fieldValue(s, id, own.format, str(a[2]), str(a[3]));
    } else ignored++;
  }
  return { set, ignored };
}

/** The steps around a plug-in's script: its object placed or its values set, then what it drew moved into it. */
function pluginAround(s: EditSession, run: PluginRun, drawing: readonly string[], placed: (id: string) => void): Around {
  const values = (): Record<string, RecordValue> => Object.fromEntries(run.fields.map((f) => [f.name, f.value]));
  const target = (made: Map<string, string>): string => run.object ?? made.get(NEW_PLUGIN_OBJECT) ?? "";
  return {
    plugin: run.name,
    before(made) {
      if (run.object) {
        const own = s.doc.records(run.object).find((r) => r.name === run.name);
        if (!own) throw new Error(`the object has no ${run.name} record`);
        for (const [field, value] of Object.entries(run.set ?? {})) s.setRecordField(run.object, own.format, field, value);
      } else if (run.place) {
        const p = run.place;
        made.set(NEW_PLUGIN_OBJECT, s.addPluginObject(p.layer, run.name, run.fields, values(), p.at, p.angle, p.classIndex));
      }
    },
    after(made) {
      const id = target(made);
      if (!id) return;
      s.setPluginDrawing(id, drawing.map((x) => made.get(x) ?? x));
      placed(id);
    },
  };
}

/**
 * What a script leaves set for what is drawn next, as Vectorworks keeps it: the attributes new objects
 * take, the Text tool's size and justification, and the tool chosen with SetTool.
 */
function applyDefaults(result: Result): void {
  if (result.attrs && Object.keys(result.attrs).length) {
    store.drawAttrs = { ...store.drawAttrs, ...result.attrs };
    store.emit("attrs");
  }
  const text = result.text;
  if (text) {
    if (text.pts) textDefaults.paperHeight = text.pts * MM_PER_POINT;
    textDefaults.align = { h: text.h ?? textDefaults.align.h, v: text.v ?? textDefaults.align.v };
  }
  const modes = DISPLAY_MODES.map((m) => m.value);
  let display = false;
  for (const key of ["layerMode", "classMode"] as const) {
    const mode = result[key];
    if (mode && modes.includes(mode) && store[key] !== mode) {
      store[key] = mode;
      display = true;
    }
  }
  if (display) store.emit("display");
  if (result.tool != null) {
    const id = toolOfSelector(result.tool);
    if (id) appContext()?.setTool(id as ToolId);
    else toast(`The script chose Vectorworks tool ${result.tool}, which Rodeo doesn't have.`, "info");
  }
}

/** Runs `code` (from `file`) on the open drawing; a plug-in's script with `plugin`. */
export async function runScript(code: string, file: string, events: RunEvents, plugin?: PluginRun): Promise<RunOutcome> {
  if (running) return { error: { name: "Busy", message: "A script is running already.", line: null }, steps: 0 };
  const s = store.session;
  if (!s) return { error: { name: "Error", message: "Open a drawing first.", line: null }, steps: 0 };
  if (!worker) events.print("system", "Starting Python (the first run fetches it, about 11 MB)…");
  printTo = events;
  let jspi: boolean;
  try {
    jspi = await startWorker();
  } catch (err) {
    return { error: { name: "Error", message: err instanceof Error ? err.message : String(err), line: null }, steps: 0 };
  }
  const w = worker;
  if (!w) return { error: { name: "Stopped", message: "Stopped.", line: null }, steps: 0 };
  const result = await new Promise<Result>((resolve) => {
    running = resolve;
    w.postMessage({ type: "run", snapshot: snapshot(s, jspi, plugin), code, file, vectorscript: isVectorscript(code, file), modules: plugin?.modules ?? {} });
  });
  for (const m of result.messages ?? []) events.print("system", m);
  if (result.error) return { error: result.error, steps: 0 };
  // the drawing may have closed or changed under a script waiting on a dialog
  if (store.session !== s) return { error: { name: "Error", message: "The drawing changed while the script ran: nothing was applied.", line: null }, steps: 0 };
  const steps = result.ops ?? [];
  if (plugin && (plugin.event ?? RECALCULATE) !== RECALCULATE) {
    try {
      return { error: null, steps: 0, ui: result.ui ?? null, reset: result.reset === true, ...eventValues(s, plugin, steps) };
    } catch (err) {
      return { error: { name: "Error", message: err instanceof Error ? err.message : String(err), line: null }, steps: 0 };
    }
  }
  let made: Map<string, string>;
  let object: string | undefined;
  const drawn = plugin && (plugin.object || plugin.place);
  try {
    if (drawn) made = applySteps(s, steps, pluginAround(s, plugin, result.drawing ?? [], (id) => (object = id)));
    else made = steps.length > 0 ? applySteps(s, steps) : new Map();
  } catch (err) {
    return { error: { name: "Error", message: `Applying the script's changes failed, so none were made: ${err instanceof Error ? err.message : String(err)}`, line: null }, steps: 0 };
  }
  const real = (id: string): string => made.get(id) ?? id;
  if (result.activeLayer) setActiveLayer(real(result.activeLayer));
  if (result.activeClass) {
    const c = s.doc.classes().find((x) => x.name === result.activeClass);
    if (c) setActiveClass(c.index);
  }
  if (result.selection) {
    // the editor's rule: objects on the active layer, at the level being edited
    const keep = result.selection.map(real).filter((id) => {
      const o = s.doc.object(id);
      return !!o && o.layerId === store.activeLayerId && o.parentId === store.editGroupId;
    });
    setSelection(keep);
  } else if (steps.length > 0) {
    setSelection([...store.selection].filter((id) => s.doc.object(id)));
  }
  applyDefaults(result);
  for (const text of result.alerts ?? []) await showAlert("Script", text);
  return { error: null, steps: steps.length, object, ui: result.ui ?? null };
}
