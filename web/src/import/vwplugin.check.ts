// Checks Vectorworks plug-in files and the plug-in objects Rodeo makes for them, under Node. Run from web/:
//   npx tsx src/import/vwplugin.check.ts
// A plug-in file written here as the Plug-in Manager writes one (vwplugin.ts's layout) reads back
// with its kind, name, script, parameters, choices, display names and icon; an encrypted script is
// recognised and not decoded. On blank drawings a plug-in object is placed with a format made for
// it, drawn into (in its own frame), drawn again, and saved and reopened; each is one undo step.

import { blankDrawing } from "../core/blank.ts";
import { readBBox } from "../core/encode.ts";
import { openVwx } from "../core/index.ts";
import type { PluginFieldSpec } from "../core/types.ts";
import { isVwPlugin, looksLikeVectorscript, objectShape, readVwPlugin } from "./vwplugin.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

// ---- a plug-in file ------------------------------------------------------------------------------

interface Param {
  name: string;
  label: string;
  type: number;
  dflt: string;
  metric?: string;
  choices?: [string, string][];
}

const utf8 = new TextEncoder();

/** A Pascal string in a field `size` bytes long (or just as long as it is, with size 0). */
function pascal(text: string, size = 0): Uint8Array {
  const b = utf8.encode(text);
  const out = new Uint8Array(size || b.length + 1);
  out[0] = b.length;
  out.set(b, 1);
  return out;
}

function writePlugin(kind: number, name: string, category: string, script: Uint8Array, params: Param[], icon: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let end = 0x8b0 + 2 + 4 * params.length;
  const place = (b: Uint8Array): number => {
    const at = end;
    parts.push(b);
    end += b.length;
    return at;
  };
  const scriptAt = place(script);
  const labels = new Uint8Array(65 * params.length);
  params.forEach((p, i) => labels.set(pascal(p.label, 65), 65 * i));
  const labelsAt = place(labels);
  const iconAt = place(icon);
  const paramAt = params.map((p) => {
    const choices = (p.choices ?? []).flatMap(([v, l]) => [pascal(v), pascal(l)]);
    const head = new Uint8Array(21 + 2 + 128 + 128 + 2);
    head.set(pascal(p.name, 21));
    new DataView(head.buffer).setUint16(21, p.type, true);
    head.set(pascal(p.dflt, 128), 23);
    head.set(pascal(p.metric ?? "", 128), 23 + 128);
    new DataView(head.buffer).setUint16(23 + 256, choices.length / 2, true);
    return place(new Uint8Array([...head, ...choices.flatMap((c) => [...c])]));
  });
  const out = new Uint8Array(end);
  const v = new DataView(out.buffer);
  out.set(utf8.encode("MCVS"));
  out[4] = kind;
  out.set(pascal(name, 64), 0x06);
  out.set(pascal(category, 64), 0x46);
  v.setUint16(0x86, 13, true);
  v.setUint32(0x88, scriptAt, true);
  v.setUint32(0x8c, script.length, true);
  v.setUint32(0x94, labelsAt, true);
  v.setUint32(0x98, labelsAt + labels.length, true);
  v.setUint32(0xe2, iconAt, true);
  v.setUint32(0xe6, icon.length, true);
  v.setUint16(0x8b0, params.length, true);
  paramAt.forEach((at, i) => v.setUint32(0x8b2 + 4 * i, at, true));
  let at = 0x8b2 + 4 * params.length;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const SCRIPT = "import vs\r\nok, name, h, rec, wall = vs.GetCustomObjectInfo()\r\nvs.Rect(0, -vs.PBoxHeight / 2, vs.PBoxWidth, vs.PBoxHeight / 2)\r\n";
const PARAMS: Param[] = [
  { name: "Depth", label: "Depth of shelf", type: 7, dflt: '12"', metric: "300" },
  { name: "Finish", label: "Finish", type: 8, dflt: "Oak", choices: [["Oak", "Oak veneer"], ["Ash", ""]] },
  { name: "Show Legs", label: "Show legs", type: 2, dflt: "True" },
  { name: "Note", label: "Ünïcode note", type: 4, dflt: "Größe" },
];

{
  const bytes = writePlugin(2, "Shelf", "Furniture", utf8.encode(SCRIPT + "\0junk"), PARAMS, PNG);
  check(isVwPlugin(bytes) && !isVwPlugin(new Uint8Array(8)), "file: recognised by its MCVS start");
  const p = readVwPlugin(bytes);
  check(p.kind === "object" && p.name === "Shelf" && p.category === "Furniture" && p.version === 13, "file: kind, name, category, version");
  check(!p.encrypted && p.language === "python", "file: a Python script, not encrypted");
  check(p.script === SCRIPT.replace(/\r\n/g, "\n"), "file: script ends at its zero byte, with \\n line ends");
  check(p.params.length === 4 && p.params.map((q) => q.name).join() === "Depth,Finish,Show Legs,Note", "file: parameters in order");
  const [depth, finish, legs, note] = p.params;
  check(depth.kind === "dimension" && depth.default === '12"' && depth.metricDefault === "300" && depth.label === "Depth of shelf", "file: a dimension with both defaults and its display name");
  check(finish.kind === "popup" && finish.choices.length === 2 && finish.choices[0].label === "Oak veneer" && finish.choices[1].label === "Ash", "file: a popup's choices (a choice with no name shows its value)");
  check(legs.kind === "boolean" && legs.default === "True" && legs.label === "Show legs", "file: a boolean");
  check(note.kind === "text" && note.default === "Größe" && note.label === "Ünïcode note", "file: UTF-8 text");
  check(p.icon !== null && p.icon.length === PNG.length, "file: icon");
  check(objectShape([p.script]) === "rect", "file: placed by a rectangle (it reads PBoxWidth and PBoxHeight)");

  const locked = readVwPlugin(writePlugin(0, "Locked", "", new Uint8Array([0x80, 0xfc, 0xff, 0xff, 0x9e, 0x8d]), [], new Uint8Array(0)));
  check(locked.kind === "command" && locked.encrypted && locked.script === "" && locked.icon === null, "file: an encrypted command is recognised, its script not read");
  let threw = false;
  try {
    readVwPlugin(bytes.subarray(0, 0x200));
  } catch {
    threw = true;
  }
  check(threw, "file: a file cut short is refused");
}

check(looksLikeVectorscript("{ draws }\nPROCEDURE Shelf;\nBEGIN END;\nRUN(Shelf);") && !looksLikeVectorscript("import vs\n"), "Vectorscript told from Python");
check(objectShape(["x = vs.PLineLength"]) === "linear" && objectShape(["vs.GetCustomObjectPath(h)"]) === "path" && objectShape(["vs.Rect(0,0,1,1)"]) === "point", "object shapes: line, path, point");

// ---- plug-in objects ------------------------------------------------------------------------------

const FIELDS: PluginFieldSpec[] = [
  { name: "BoxWidth", type: 7, value: 1000 },
  { name: "BoxHeight", type: 7, value: 400 },
  { name: "Finish", type: 8, value: "Oak" },
  { name: "Show Legs", type: 2, value: true },
  { name: "Count", type: 1, value: 3 },
  { name: "Note", type: 14, value: "" },
];

for (const units of ["mm", "ftin"] as const) {
  const s = openVwx(blankDrawing(units), `blank-${units}.vwx`);
  const layer = s.doc.layers()[0];
  const id = s.addPluginObject(layer.id, "Shelf", FIELDS, { BoxWidth: 1200, Finish: "Ash" }, { x: 1000, y: 2000 }, 90);
  const o = s.doc.object(id);
  check(o?.type === 86, `${units}: a plug-in object placed`);
  const recs = s.doc.records(id);
  const own = recs.find((r) => r.parametric);
  check(recs.length === 1 && own?.name === "Shelf", `${units}: it holds the Shelf parameters`);
  const value = (name: string) => own?.fields.find((f) => f.name === name)?.value;
  check(value("BoxWidth") === 1200 && value("BoxHeight") === 400 && value("Finish") === "Ash" && value("Show Legs") === true && value("Count") === 3, `${units}: values given, defaults for the rest`);
  check(s.doc.recordFormats().every((f) => f.name !== "Shelf"), `${units}: its format isn't listed with the data formats`);

  // drawn into: shapes drawn in its frame (origin, unturned), moved in
  const a = s.addObject(layer.id, { kind: "rect", x0: 0, y0: -200, x1: 1200, y1: 200 });
  const b = s.addObject(layer.id, { kind: "line", a: { x: 0, y: 0 }, b: { x: 1200, y: 0 } });
  s.setPluginDrawing(id, [a, b]);
  const top = s.doc.objects(layer.id).filter((x) => !x.parentId);
  check(top.length === 1 && top[0].id === id, `${units}: its drawing is inside it`);
  check(s.doc.objects(layer.id).filter((x) => x.parentId === id).length === 2, `${units}: two objects in it`);
  const box = readBBox((s.doc as unknown as { rec(id: string): { data: Uint8Array } }).rec(id).data);
  // turned 90°: x 0..1200 runs up from y 2000, y -200..200 runs from x 1200 to 800
  check(!!box && near(box.x0, 800) && near(box.x1, 1200) && near(box.y0, 2000) && near(box.y1, 3200), `${units}: its plan box is its drawing, turned and placed`);

  // drawn again: the old drawing goes
  const c = s.addObject(layer.id, { kind: "rect", x0: 0, y0: -100, x1: 500, y1: 100 });
  s.setPluginDrawing(id, [c]);
  check(s.doc.objects(layer.id).filter((x) => x.parentId === id).length === 1, `${units}: drawn again, the old drawing gone`);

  // a second one shares the format; a field set reads back
  const id2 = s.addPluginObject(layer.id, "Shelf", [], {}, { x: 0, y: 0 }, 0);
  const own2 = s.doc.records(id2).find((r) => r.parametric);
  check(own2?.format === own?.format && own2?.fields.find((f) => f.name === "BoxWidth")?.value === 1000, `${units}: a second one uses the same format, with its defaults`);
  s.setRecordField(id2, own2!.format, "Finish", "Ash");

  const t = openVwx(s.doc.toBytes(), "again.vwx");
  const back = t.doc.records(id2).find((r) => r.parametric);
  check(t.doc.objects(layer.id).filter((x) => x.type === 86).length === 2 && back?.fields.find((f) => f.name === "Finish")?.value === "Ash", `${units}: saved and reopened`);
  check(t.doc.objects(layer.id).filter((x) => x.parentId === id).length === 1, `${units}: its drawing reopens inside it`);

  // each was one undo step: the field, the second object, the redraw and its shape, the drawing and its two shapes
  for (let i = 0; i < 7; i++) s.undo();
  const left = s.doc.objects(layer.id);
  check(left.length === 1 && left[0].id === id && s.doc.objects(layer.id).every((x) => x.parentId !== id), `${units}: undone step by step back to the empty object`);
  s.undo();
  check(s.doc.objects(layer.id).length === 0, `${units}: and to nothing`);

  let refused = false;
  try {
    s.addPluginObject(layer.id, "Bad", [{ name: "X", type: 999, value: "" }], {}, { x: 0, y: 0 }, 0);
  } catch {
    refused = true;
  }
  check(refused && s.doc.objects(layer.id).length === 0, `${units}: a field of an unknown type is refused, changing nothing`);
}

if (failures) {
  console.log(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall passed");
