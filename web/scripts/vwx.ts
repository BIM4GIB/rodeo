// openvwx command line. Run from web/:  npx tsx scripts/vwx.ts <command> <file.vwx> [...]

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { openVwx } from "../src/core/index.ts";
import type { EditSession, LayerInfo, VwxDocument } from "../src/core/types.ts";
import { exportDxf } from "../src/export/dxf.ts";
import { exportPdf } from "../src/export/pdf.ts";
import { exportSvg } from "../src/export/svg.ts";

const USAGE = `usage: npx tsx scripts/vwx.ts <command> <file.vwx> [...]

  info      <file.vwx>                            versions, build, counts, units
  layers    <file.vwx>                            one line per layer
  classes   <file.vwx>                            classes, sorted by name
  svg       <file.vwx> <out.svg> [--layer NAME ...]  default: visible design layers
  dxf       <file.vwx> <out.dxf> [--layer NAME ...]  default: all layers
  pdf       <file.vwx> <out.pdf> [--layer NAME ...]  default: non-hidden layers with objects
  roundtrip <file.vwx>                            save, reopen, compare records and layers
  edit-demo <file.vwx> <out.vwx>                  exercise the editing API and save a copy`;

class UsageError extends Error {}

function usage(message: string): never {
  throw new UsageError(message);
}

function openFile(file: string): EditSession {
  return openVwx(new Uint8Array(readFileSync(file)), basename(file));
}

interface Parsed {
  positional: string[];
  layers: string[];
}

function parseArgs(args: string[], positional: number, allowLayers: boolean): Parsed {
  const out: Parsed = { positional: [], layers: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (allowLayers && (a === "--layer" || a.startsWith("--layer="))) {
      const value = a === "--layer" ? args[++i] : a.slice("--layer=".length);
      if (value === undefined || value === "") usage("--layer needs a layer name");
      out.layers.push(value);
    } else if (a.startsWith("-")) {
      usage(`unknown option ${a}`);
    } else {
      out.positional.push(a);
    }
  }
  if (out.positional.length !== positional) {
    usage(`expected ${positional} argument(s), got ${out.positional.length}`);
  }
  return out;
}

/** Layer by id, name or sheet title (first match wins). */
function findLayer(doc: VwxDocument, key: string): LayerInfo {
  const layer = doc.layers().find((l) => l.id === key || l.name === key || l.title === key);
  if (!layer) throw new Error(`no layer matches "${key}" (try: layers <file>)`);
  return layer;
}

function selectLayers(doc: VwxDocument, names: string[]): LayerInfo[] {
  if (names.length > 0) return names.map((n) => findLayer(doc, n));
  return doc.layers().filter((l) => l.kind === "design" && l.visibility === "visible");
}

function printLayers(layers: LayerInfo[]): void {
  layers.forEach((l, i) => {
    const title = l.title ? `  (${l.title})` : "";
    console.log(
      `${String(i).padStart(2)}  ${l.kind.padEnd(6)} ${l.visibility.padEnd(8)} ` +
        `1:${String(l.scale).padEnd(6)} ${String(l.objectCount).padStart(6)} objects  ${l.name}${title}`,
    );
  });
}

function compareCI(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function cmdInfo(file: string): void {
  const { doc } = openFile(file);
  const layers = doc.layers();
  const design = layers.filter((l) => l.kind === "design").length;
  console.log(`file:     ${file}`);
  console.log(`created with ${doc.info.createdWith}, saved with ${doc.info.savedWith} (build ${doc.info.build})`);
  console.log(`records:  ${doc.info.records}`);
  console.log(`layers:   ${layers.length} (${design} design, ${layers.length - design} sheet)`);
  console.log(`classes:  ${doc.classes().length}`);
  console.log(`units:    ${doc.info.units || "(unspecified)"}`);
}

function cmdLayers(file: string): void {
  printLayers(openFile(file).doc.layers());
}

function cmdClasses(file: string): void {
  const { doc } = openFile(file);
  const classes = doc.classes().slice().sort((a, b) => compareCI(a.name, b.name));
  for (const c of classes) {
    console.log(`${c.visibility.padEnd(8)} ${String(c.objectCount).padStart(6)}  ${c.name}`);
  }
}

function cmdSvg(file: string, out: string, names: string[]): void {
  const { doc } = openFile(file);
  const layers = selectLayers(doc, names);
  if (layers.length === 0) console.error("warning: no layers selected; writing an empty drawing");
  writeFileSync(out, exportSvg(doc, layers.map((l) => l.id)), "utf8");
  console.log(`wrote ${out} (${layers.map((l) => l.name).join(", ") || "no layers"})`);
}

function cmdDxf(file: string, out: string, names: string[]): void {
  const { doc } = openFile(file);
  const layerIds = names.length > 0 ? selectLayers(doc, names).map((l) => l.id) : undefined;
  writeFileSync(out, exportDxf(doc, { layerIds }), "utf8");
  const count = layerIds?.length ?? doc.layers().length;
  console.log(`wrote ${out} (${count} layer${count === 1 ? "" : "s"})`);
}

function cmdPdf(file: string, out: string, names: string[]): void {
  const { doc } = openFile(file);
  const layerIds = names.length > 0 ? names.map((n) => findLayer(doc, n).id) : undefined;
  const bytes = exportPdf(doc, { layerIds });
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes; ${layerIds ? names.join(", ") : "default layers"})`);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function cmdRoundtrip(file: string): number {
  const first = openFile(file);
  const bytes = first.doc.toBytes();
  const second = openVwx(bytes, basename(file));

  const recA = first.doc.info.records;
  const recB = second.doc.info.records;
  const namesA = first.doc.layers().map((l) => l.name);
  const namesB = second.doc.layers().map((l) => l.name);
  const layersSame = sameList(namesA, namesB);
  const ok = recA === recB && layersSame;

  console.log(`bytes:   ${bytes.length} written`);
  console.log(`records: ${recA} -> ${recB}`);
  console.log(`layers:  ${namesA.length} -> ${namesB.length}, names ${layersSame ? "equal" : "DIFFER"}`);
  if (!layersSame) {
    console.log(`  before: ${namesA.join(" | ")}`);
    console.log(`  after:  ${namesB.join(" | ")}`);
  }
  console.log(ok ? "roundtrip ok" : "roundtrip MISMATCH");
  return ok ? 0 : 1;
}

function cmdEditDemo(file: string, out: string): void {
  const s = openFile(file);
  const layers = s.doc.layers();
  const last = layers[layers.length - 1];
  if (!last) throw new Error("document has no layers to edit");
  const renamed = `${last.name} (edited)`;
  s.renameLayer(last.id, renamed);
  console.log(`renamed layer "${last.name}" -> "${renamed}"`);

  const demo = s.createLayer("openvwx demo", "design", 50);
  const rect = s.addObject(demo, { kind: "rect", x0: 0, y0: 0, x1: 1000, y1: 500 });
  const line = s.addObject(demo, { kind: "line", a: { x: 0, y: 600 }, b: { x: 1000, y: 1100 } });
  const circle = s.addObject(demo, {
    kind: "arc",
    center: { x: 2000, y: 250 },
    radius: 250,
    startAngle: 0,
    sweepAngle: 360,
  });
  const text = s.addObject(demo, { kind: "text", at: { x: 0, y: -300 }, text: "Hello from openvwx", height: 100 });
  const triangle = s.addObject(demo, {
    kind: "polygon",
    points: [
      { x: 2500, y: 600 },
      { x: 3000, y: 1200 },
      { x: 2000, y: 1200 },
    ],
    closed: true,
  });
  const created = [rect, line, circle, text, triangle];

  const cls = s.createClass("openvwx-demo");
  s.setObjectClass(created, cls);
  s.moveObjects([line], 100, 100);
  const copies = s.duplicateObjects([rect], 0, -1000);
  console.log(`duplicated rect -> ${copies.join(", ")}`);
  s.undo();
  s.redo();

  const bytes = s.doc.toBytes();
  writeFileSync(out, bytes);
  console.log(`wrote ${out} (${bytes.length} bytes)`);

  const reopened = openVwx(bytes, basename(out)).doc;
  console.log("layers after reopen:");
  printLayers(reopened.layers());

  const demoLayer = reopened.layers().find((l) => l.name === "openvwx demo");
  if (!demoLayer) throw new Error("demo layer missing after reopen");
  const tally = new Map<string, number>();
  for (const o of reopened.objects(demoLayer.id)) tally.set(o.kind, (tally.get(o.kind) ?? 0) + 1);
  const kinds = [...tally].map(([k, n]) => `${k} x${n}`).join(", ");
  console.log(`openvwx demo object kinds: ${kinds || "(none)"}`);
  const demoClass = reopened.classes().find((c) => c.name === "openvwx-demo");
  console.log(`class openvwx-demo: ${demoClass ? `${demoClass.objectCount} objects` : "missing"}`);
}

function run(argv: string[]): number {
  const [cmd, ...rest] = argv;
  if (cmd === undefined) {
    console.error(USAGE);
    return 2;
  }
  if (cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(USAGE);
    return 0;
  }
  switch (cmd) {
    case "info":
      cmdInfo(parseArgs(rest, 1, false).positional[0]);
      return 0;
    case "layers":
      cmdLayers(parseArgs(rest, 1, false).positional[0]);
      return 0;
    case "classes":
      cmdClasses(parseArgs(rest, 1, false).positional[0]);
      return 0;
    case "svg": {
      const p = parseArgs(rest, 2, true);
      cmdSvg(p.positional[0], p.positional[1], p.layers);
      return 0;
    }
    case "dxf": {
      const p = parseArgs(rest, 2, true);
      cmdDxf(p.positional[0], p.positional[1], p.layers);
      return 0;
    }
    case "pdf": {
      const p = parseArgs(rest, 2, true);
      cmdPdf(p.positional[0], p.positional[1], p.layers);
      return 0;
    }
    case "roundtrip":
      return cmdRoundtrip(parseArgs(rest, 1, false).positional[0]);
    case "edit-demo": {
      const p = parseArgs(rest, 2, false);
      cmdEditDemo(p.positional[0], p.positional[1]);
      return 0;
    }
    default:
      throw new UsageError(`unknown command "${cmd}"`);
  }
}

try {
  process.exitCode = run(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exitCode = 2;
  } else {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}
