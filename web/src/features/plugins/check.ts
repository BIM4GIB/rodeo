// Checks the plug-in host's pure parts against a real drawing (Node, no browser):
//   npx tsx src/features/plugins/check.ts ../samples/sample.vwx
// Reads through openvwx.doc, one edit, a batch that is one undo step, a refused
// batch that changes nothing, refused methods, plain data, headers, and the worker
// source's line offsets. Exits 1 when a check fails.

import { readFileSync } from "node:fs";
import { openVwx, type BBox, type EditSession, type LayerInfo } from "../../core/index.ts";
import { workerSource } from "./bootstrap.ts";
import { type CallEnv, dispatch, plain, RefusedCall } from "./dispatch.ts";
import { EXAMPLES, exampleNames } from "./examples.ts";
import { parseHeader } from "./header.ts";

const path = process.argv[2];
if (!path) {
  console.error("usage: npx tsx src/features/plugins/check.ts ../samples/sample.vwx");
  process.exit(2);
}

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `  (${detail})` : ""}`);
}

function refused(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof RefusedCall;
  }
}

function throws(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const session: EditSession = openVwx(new Uint8Array(readFileSync(path)), path.split("/").pop() ?? "drawing.vwx");
const layers = session.doc.layers();
const design = layers.find((l: LayerInfo) => l.kind === "design" && l.objectCount > 0) ?? layers[0];
if (!design) throw new Error("the drawing has no layers");

const selectedBoxes: BBox[] = [];
let activeLayer = design.id;
const selection: string[] = [];
const env: CallEnv = {
  session,
  activeLayerId: activeLayer,
  selection,
  effects: {
    select: (ids) => ids,
    zoomTo: (box) => {
      selectedBoxes.push(box);
    },
    setActiveLayer: (id) => {
      activeLayer = id;
    },
  },
};
const call = (method: string, args: unknown[] = []): unknown => dispatch(method, args, env);

// ---- reads ----------------------------------------------------------------
const info = call("doc.info") as { fileName: string };
check("doc.info returns the document info", typeof info.fileName === "string" && info.fileName.length > 0);

const layerList = call("doc.layers") as LayerInfo[];
check("doc.layers lists the layers", layerList.length === layers.length, `${layerList.length} vs ${layers.length}`);

const onLayer = call("doc.objects") as { id: string; layerId: string }[];
check("doc.objects() defaults to the active layer", onLayer.length > 0 && onLayer.every((o) => o.layerId === design.id));

const first = onLayer[0];
const one = call("doc.object", [first.id]) as { id: string } | null;
check("doc.object(id) returns the object", one?.id === first.id);
check("doc.object(unknown) returns null", call("doc.object", ["no-such-object"]) === null);

selection.splice(0, selection.length, ...onLayer.slice(0, 2).map((o) => o.id));
const selected = call("doc.selection") as { id: string }[];
check("doc.selection returns the selected objects", selected.length === 2 && selected[0].id === onLayer[0].id);

check("doc.classes, symbols, lineTypes, colors, records answer", (call("doc.classes") as unknown[]).length > 0 &&
  Array.isArray(call("doc.symbols")) && Array.isArray(call("doc.lineTypes")) && (call("doc.colors") as unknown[]).length > 0 &&
  Array.isArray(call("doc.records", [first.id])));

let cloneable = true;
try {
  structuredClone(call("doc.objects", [design.id]));
} catch {
  cloneable = false;
}
check("results are structured-cloneable (they cross postMessage)", cloneable);

// ---- one edit ---------------------------------------------------------------
const before = session.doc.objects(design.id).length;
const id = call("edit.addObject", [design.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 1000, y: 0 } }]) as string;
check("edit.addObject adds an object", typeof id === "string" && session.doc.objects(design.id).length === before + 1);
session.undo();
check("the edit is one undo step", session.doc.objects(design.id).length === before);

// ---- a batch: one undo step ----------------------------------------------------
const layerName = session.doc.layers().find((l) => l.id === design.id)?.name ?? "";
const batchResult = call("edit.batch", [
  [
    ["addObject", design.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 500, y: 0 } }],
    ["addObject", design.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 0, y: 500 } }],
    ["renameLayer", design.id, "Batch check"],
  ],
]) as unknown[];
check("edit.batch applies every step", batchResult.length === 3 && session.doc.objects(design.id).length === before + 2);
check("edit.batch renamed the layer", session.doc.layers().find((l) => l.id === design.id)?.name === "Batch check");
session.undo();
const restored = session.doc.layers().find((l) => l.id === design.id)?.name === layerName;
check("the batch is one undo step", session.doc.objects(design.id).length === before && restored);

// a batch with a refused step changes nothing, not even its earlier steps
const beforeRefused = session.doc.objects(design.id).length;
check(
  "a batch with a refused step is refused before any change",
  refused(() =>
    call("edit.batch", [
      [
        ["addObject", design.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 9, y: 9 } }],
        ["deleteLayer", design.id],
      ],
    ]),
  ) && session.doc.objects(design.id).length === beforeRefused,
);

// ---- refused calls ----------------------------------------------------------------
check("edit.deleteLayer is refused", refused(() => call("edit.deleteLayer", [design.id])));
check("edit.setAttributesByClass is refused", refused(() => call("edit.setAttributesByClass", [[first.id], "fill", true])));
check("edit.undo is refused (undo belongs to the editor)", refused(() => call("edit.undo")));
check("doc.toBytes is refused (no raw file access)", refused(() => call("doc.toBytes")));
check("an unknown call is refused", refused(() => call("shell.exec", ["ls"])));
check("select needs the editor's effects", throws(() => dispatch("select", [[first.id]], { ...env, effects: undefined })));

// ---- effects -------------------------------------------------------------------------
check("select goes through the editor's effects", (call("select", [[first.id]]) as string[])[0] === first.id);
const zoomed = call("zoomTo", [[first.id, onLayer[1].id]]) as boolean;
check("zoomTo fits a box round the ids", zoomed === true && selectedBoxes.length === 1 &&
  Number.isFinite(selectedBoxes[0].x0) && selectedBoxes[0].x1 >= selectedBoxes[0].x0);
check("activeLayer reads the active layer", call("activeLayer") === design.id);
call("setActiveLayer", [design.id]);
check("setActiveLayer sets it through the effects", activeLayer === design.id);
check("setActiveLayer rejects an unknown layer", throws(() => call("setActiveLayer", ["no-layer"])));

// ---- plain data ------------------------------------------------------------------------
const copied = plain({ a: new Uint8Array([1, 2]), f: () => 1, m: new Map([["k", 1]]), s: new Set([3]), n: { deep: [1, { x: 2 }] } }) as unknown as {
  a: Uint8Array;
  f?: unknown;
  m: Record<string, number>;
  s: number[];
  n: unknown;
};
check("plain keeps typed arrays, drops functions, turns Maps into objects",
  copied.a instanceof Uint8Array && copied.a.length === 2 && copied.f === undefined && copied.m.k === 1 && copied.s[0] === 3);

// ---- headers and worker source ----------------------------------------------------------
const names = exampleNames();
check("bundled examples have their names", JSON.stringify(names) === JSON.stringify(["Number Selected Objects", "Random Fill Colours", "Count by Class"]), names.join(", "));
const h = parseHeader("// @name Hello there\n// @version 2\n// @author me\n\nopenvwx.ui.toast('hi')");
check("parseHeader reads the header fields", h.name === "Hello there" && h.version === "2" && h.author === "me" && h.description === "");
check("parseHeader stops at the first line of code", parseHeader("openvwx.ui.toast(1)\n// @name Late").name === "Untitled Plug-in");

for (const ex of EXAMPLES) {
  const src = workerSource(ex.code);
  const lines = src.source.split("\n");
  const codeLines = ex.code.split("\n");
  const mapped = codeLines.every((line, i) => lines[src.offset + i] === line);
  check(`line offset maps ${ex.id} line for line`, mapped && lines[src.offset - 1] === "self.__ovEntry = async function () {");
  let compiles = true;
  try {
    new Function(src.source);
  } catch (err) {
    compiles = false;
    console.log(String(err));
  }
  check(`the worker source for ${ex.id} parses`, compiles);
}

const broken = workerSource("openvwx.ui.toast(");
check("a syntax error in plug-in code fails to parse", throws(() => new Function(broken.source)));
check("the console's worker source parses", (() => {
  try {
    new Function(workerSource(null).source);
    return true;
  } catch {
    return false;
  }
})());

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
