// Checks the blank drawing and the built-in templates under Node. Run from web/:
//   npx tsx src/core/blank.check.ts
// For each unit system the drawing opens with one design layer, class None and no objects, in
// its units. Every object kind (and a mesh) is added and reads back with its geometry, named meshes keep
// their names in 3D exports, two objects group,
// and the file saves and reopens with the same objects. Layers, classes and units can be added
// and changed. A model with symbols comes in from a file as definitions placed many times and goes
// out to 3DM, Collada and FBX the same way. Nothing is drawn.

import rhino3dm from "rhino3dm";
import { exportCollada } from "../export/collada.ts";
import { exportFbx } from "../export/fbx.ts";
import { export3dm } from "../export/rhino.ts";
import { modelOf, type ModelObject } from "../export/scene3d.ts";
import { parseCollada } from "../import/collada.ts";
import { parseFbx } from "../import/fbx.ts";
import type { MeshFile, MeshTreeNode } from "../import/mesh.ts";
import { parse3dm, type Rhino } from "../import/rhino.ts";
import { checkSymbolTrip, LEGS, MIRRORED, SYMBOL_MODEL, TURNED } from "../import/symbols.fixture.ts";
import { builtinTemplates } from "./builtins.ts";
import { blankDrawing } from "./blank.ts";
import { openVwx } from "./index.ts";
import { unitsName } from "./settings.ts";
import type { MeshModel, MeshNode, NewShape } from "./types.ts";

const rhino: Rhino = await rhino3dm();

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
const at = (p: { x: number; y: number } | undefined, x: number, y: number): boolean => !!p && near(p.x, x) && near(p.y, y);

const SHAPES: NewShape[] = [
  { kind: "line", a: { x: 0, y: 0 }, b: { x: 10, y: 20 } },
  { kind: "rect", x0: 0, y0: 0, x1: 30, y1: 40 },
  { kind: "roundrect", x0: 50, y0: 0, x1: 100, y1: 30, rx: 5, ry: 5 },
  { kind: "polygon", points: [{ x: 0, y: 60 }, { x: 30, y: 60 }, { x: 15, y: 90 }], closed: true },
  { kind: "polyline", points: [{ x: 50, y: 60 }, { x: 80, y: 60 }, { x: 80, y: 90 }], closed: false },
  { kind: "arc", center: { x: 120, y: 20 }, radius: 20, startAngle: 0, sweepAngle: 90 },
  { kind: "text", at: { x: 5, y: 110 }, text: "Hello", height: 10 },
];

const UNITS = { mm: { name: "Millimeters", scale: 100 }, ftin: { name: "Feet & Inches", scale: 48 } } as const;

const sameMatrix = (a: readonly number[] | undefined, b: readonly number[]): boolean => !!a && a.length === 12 && a.every((v, k) => Math.abs(v - b[k]) < (k >= 9 ? 1e-3 : 1e-9));

/** A file's tree as File > Import makes it (importTree in app/meshImport.ts): in mm, its colours exactly, its parts named. */
function meshModelOf(session: ReturnType<typeof openVwx>, file: MeshFile): MeshModel {
  const mm = file.frame?.mm ?? 1;
  const hex = (c: { r: number; g: number; b: number }): string => "#" + [c.r, c.g, c.b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
  const node = (n: MeshTreeNode): MeshNode => ({
    parts: n.parts.map((p) => p.faces.map((f) => f.map((v) => v * mm))),
    attrs: n.parts.map((p) => {
      if (!p.color) return undefined;
      const c = session.addColors([hex(p.color)])[0];
      return { fillPattern: 1, fillFore: c, fillBack: c };
    }),
    names: n.parts.map((p) => p.name),
    groups: n.groups.map((g) => ({ ...node(g), name: g.name })),
    instances: n.instances.map((i) => ({ symbol: i.symbol, matrix: i.matrix.map((v, k) => (k >= 9 ? v * mm : v)), ...(i.name ? { name: i.name } : {}) })),
  });
  return { symbols: (file.tree?.symbols ?? []).map((x) => ({ name: x.name, content: node(x.content) })), top: node(file.tree?.top ?? { parts: [], groups: [], instances: [] }) };
}

for (const units of ["mm", "ftin"] as const) {
  const { name, scale } = UNITS[units];
  const label = units === "mm" ? "millimetres" : "feet and inches";
  const bytes = blankDrawing(units);
  const header = bytes.subarray(0, 2676);
  check(new TextDecoder().decode(bytes.subarray(0x0e, 0x1f)) === "VW31.2.0 VW31.2.0", `${label}: version VW31.2.0`);
  check(new TextDecoder().decode(bytes.subarray(0x3a, 0x45)) === "VectorWorks", `${label}: signature`);
  check(header.subarray(0x20, 0x3a).every((b) => b === 0), `${label}: serial and licence block blank`);
  check(unitsName(header) === name, `${label}: units ${name}`);

  const s = openVwx(bytes, `blank-${units}.vwx`);
  const layers = s.doc.layers();
  check(layers.length === 1, `${label}: one layer`);
  const layer = layers[0];
  check(layer.name === "Design Layer-1" && layer.kind === "design", `${label}: design layer named Design Layer-1`);
  check(layer.scale === scale, `${label}: scale 1:${scale}`);
  check(s.doc.classes().some((c) => c.name === "None"), `${label}: class None`);
  check(s.doc.objects(layer.id).length === 0, `${label}: no objects`);

  const ids = s.addObjects(layer.id, SHAPES);
  check(ids.length === SHAPES.length, `${label}: ${SHAPES.length} objects added`);
  const [line, rect, roundrect, polygon, polyline, arc, text] = ids.map((id) => s.doc.object(id)!);

  check(line.kind === "line" && at(line.shape!.points[0], 0, 0) && at(line.shape!.points[1], 10, 20), `${label}: line geometry`);
  check(rect.kind === "rect" && at(rect.shape!.points[2], 30, 40), `${label}: rect geometry`);
  const rb = roundrect.shape!.bbox!;
  // reads back as type 13 with its corners flattened to points (kind "polygon")
  check(roundrect.type === 13 && roundrect.shape!.points.length > 4 && near(rb.x0, 50) && near(rb.y0, 0) && near(rb.x1, 100) && near(rb.y1, 30), `${label}: roundrect geometry`);
  check(polygon.kind === "polygon" && polygon.shape!.points.length === 3 && at(polygon.shape!.points[2], 15, 90), `${label}: polygon geometry`);
  check(polyline.kind === "polyline" && polyline.shape!.points.length === 3 && at(polyline.shape!.points[2], 80, 90), `${label}: polyline geometry`);
  check(arc.kind === "arc" && at(arc.shape!.center, 120, 20) && near(arc.shape!.rx!, 20) && near(arc.shape!.sweepAngle!, 90), `${label}: arc geometry`);
  check(text.kind === "text" && text.shape!.text === "Hello", `${label}: text reads back`);
  // its size sits after its line table: one line, whatever its length
  check(near(text.shape!.textSize!, 10), `${label}: text keeps its size`);

  const group = s.groupObjects(ids.slice(0, 2));
  check(s.doc.object(group)?.kind === "group" && s.doc.object(ids[0])?.parentId === group, `${label}: two objects group`);

  // a mesh (the 3D imports), from the built-in shell: a 1 m box's six square faces
  check(s.canAddMeshes(), `${label}: can add meshes with no mesh to copy`);
  const box = [
    [0, 0, 0, 0, 1000, 0, 1000, 1000, 0, 1000, 0, 0],
    [0, 0, 1000, 1000, 0, 1000, 1000, 1000, 1000, 0, 1000, 1000],
    [0, 0, 0, 1000, 0, 0, 1000, 0, 1000, 0, 0, 1000],
    [1000, 0, 0, 1000, 1000, 0, 1000, 1000, 1000, 1000, 0, 1000],
    [1000, 1000, 0, 0, 1000, 0, 0, 1000, 1000, 1000, 1000, 1000],
    [0, 1000, 0, 0, 0, 0, 0, 0, 1000, 0, 1000, 1000],
  ];
  const [mesh] = s.addMeshes(layer.id, [box]);
  const tris = (session: typeof s): number =>
    session.doc.model3d().filter((m) => m.objectId === mesh).reduce((n, m) => n + m.triangles.length / 9, 0);
  check(s.doc.object(mesh)?.type === 40 && tris(s) === 12, `${label}: a mesh added (12 triangles in 3D)`);

  // meshes named after a file's objects, unique as the drawing's names are; in groups, each exports as an object of its own
  {
    const n = openVwx(s.doc.toBytes(), `blank-${units}-named.vwx`);
    const [sink, sink2, hob] = n.addMeshes(layer.id, [box, box, box], undefined, undefined, ["Sink", "Sink", undefined]);
    const nameOf = (id: string): string | undefined => n.doc.object(id)?.name;
    check(nameOf(sink) === "Sink" && nameOf(sink2) === "Sink 2" && nameOf(hob) === undefined, `${label}: meshes take the names given, made unique (${[sink, sink2, hob].map(nameOf)})`);
    const inner = n.groupObjects([sink2, hob]);
    n.setObjectName(inner, "Cooking");
    const outer = n.groupObjects([sink, inner]);
    n.setObjectName(outer, "Kitchen");
    const faces = n.doc.model3d().filter((m) => m.objectId === outer);
    check(faces.length > 0 && [sink, sink2, hob].every((id) => faces.some((m) => m.partId === id)) && faces.every((m) => m.partId !== inner), `${label}: a group's faces say which object in it they belong to`);
    const objs = modelOf(n.doc, new Set([layer.id])).layers.flatMap((l) => l.objects).filter((o) => o.groups?.[0]?.id === outer);
    const path = (o: ModelObject): string => [...(o.groups ?? []).map((g) => g.name), o.name].join("/");
    check(objs.map(path).join() === "Kitchen/Sink,Kitchen/Cooking/Sink 2,Kitchen/Cooking/mesh", `${label}: grouped meshes export by their own names in their groups (${objs.map(path)})`);
  }

  // symbols through the drawing: a file's Chair placed twice comes in as one definition placed twice, and each format writes it so
  {
    const n = openVwx(blankDrawing(units), `blank-${units}-symbols.vwx`);
    const ground = n.doc.layers()[0];
    const made = n.addMeshModel(ground.id, meshModelOf(n, parseCollada(exportCollada(SYMBOL_MODEL))));
    check(made.symbols.length === 2 && made.instances === 4, `${label}: a Leg and a Chair defined, the Legs placed in the Chair, the Chair twice (${made.symbols.length}, ${made.instances})`);
    const back = openVwx(n.doc.toBytes(), `blank-${units}-symbols-saved.vwx`);
    const model = modelOf(back.doc, new Set([ground.id]), true);
    const syms = model.symbols ?? [];
    const chair = syms.findIndex((x) => x.name === "Chair");
    const leg = syms.findIndex((x) => x.name === "Leg");
    check(syms.length === 2 && leg >= 0 && leg < chair, `${label}: saved and reopened, the 3D model holds the Leg, then the Chair (${syms.map((x) => x.name)})`);
    const placed = model.layers.flatMap((l) => l.objects).filter((o) => o.instance?.symbol === chair);
    const turned = placed.find((o) => sameMatrix(o.instance?.matrix, TURNED));
    const mirrored = placed.find((o) => sameMatrix(o.instance?.matrix, MIRRORED));
    check(placed.length === 2 && !!turned && !!mirrored && placed.every((o) => o.pieces.length === 0), `${label}: the Chair placed twice, turned and mirrored, as instances with no faces of their own`);
    check(turned?.name === "Chair" && mirrored?.name === "Window chair", `${label}: the instances named (${placed.map((o) => o.name)})`);
    const inside = syms[chair]?.objects ?? [];
    const legs = inside.filter((o) => o.instance?.symbol === leg);
    check(
      inside.some((o) => o.name === "Seat" && o.pieces[0]?.color === "#d62828") && legs.length === 2 && LEGS.every((m) => legs.some((o) => sameMatrix(o.instance?.matrix, m))),
      `${label}: the Chair holds its red Seat and places the Leg twice (${inside.map((o) => o.name)})`,
    );
    checkSymbolTrip(`${label} to 3DM`, parse3dm(export3dm(model, [], new Map([[ground.id, ground.name]]), rhino), rhino), check);
    checkSymbolTrip(`${label} to Collada`, parseCollada(exportCollada(model)), check);
    checkSymbolTrip(`${label} to FBX`, parseFbx(exportFbx(model)), check);
  }

  const saved = s.doc.toBytes();
  const again = openVwx(saved, `blank-${units}-saved.vwx`);
  const same = [...ids, group, mesh].every((id) => again.doc.object(id)?.kind === s.doc.object(id)?.kind);
  check(again.doc.objects(layer.id).length === s.doc.objects(layer.id).length && same, `${label}: saved file reopens with the same objects`);
  check(tris(again) === 12, `${label}: the mesh reopens with its faces`);

  // colours of their own (the 3D imports): the table has none spare, so it grows, then fills its spare slots
  const before = s.doc.colors().length;
  const wanted = ["#12a4c7", "#FFFFFF", "#12a4c7", "#000000", "#7f3300"];
  const got = s.addColors(wanted);
  check(got[1] === 256 && got[3] === 257 && got[0] === got[2] && got[0] >= before && got[4] === got[0] + 1, `${label}: addColors keeps white and black, adds two new colours once each (${got})`);
  check(got.every((i, k) => s.doc.color(i) === wanted[k].toLowerCase()), `${label}: each colour index is exactly its colour`);
  check(s.doc.colors().length === before + 32, `${label}: the full table grew by 32 slots (${before} to ${s.doc.colors().length})`);
  const many = Array.from({ length: 40 }, (_, i) => `#${(0x10305 * (i + 7) + 0x2a0000 * i).toString(16).padStart(6, "0").slice(-6)}`);
  const more = s.addColors(many);
  check(more.every((i, k) => s.doc.color(i) === many[k]), `${label}: 40 more colours exact, across the spare slots and another growth`);
  check(s.addColors([wanted[0]])[0] === got[0] && s.doc.colors().length === before + 64, `${label}: a colour it has is not added again`);
  const tinted = s.doc.objects(layer.id)[0].id;
  s.setAttributes([tinted], { fillPattern: 1, fillFore: got[4], fillBack: got[4] });
  const tintedCopy = openVwx(s.doc.toBytes(), `blank-${units}-colours.vwx`);
  check(more.every((i, k) => tintedCopy.doc.color(i) === many[k]) && tintedCopy.doc.color(got[0]) === wanted[0], `${label}: added colours save and reopen`);
  check(tintedCopy.doc.object(tinted)?.attrs?.fillBack === got[4], `${label}: an object keeps an added colour`);
  // every 24-bit colour comes back exactly through the table's float32 C, M, Y, K
  const exact = Array.from({ length: 4096 }, (_, i) => `#${((i * 2654435761) >>> 8).toString(16).padStart(6, "0").slice(-6)}`);
  const sweep = openVwx(s.doc.toBytes(), "sweep.vwx");
  const swept = sweep.addColors(exact);
  check(swept.every((i, k) => sweep.doc.color(i) === exact[k]), `${label}: 4096 scattered colours read back exactly`);
  s.undo();
  s.undo();
  s.undo();
  check(s.doc.colors().length === before && s.doc.color(got[0]) !== wanted[0], `${label}: undo takes the added colours out again`);

  // plain walls: none to copy, so the plain sizes are offered, and they join, save and reopen
  const kinds = s.wallTemplates();
  check(kinds.length === 4 && kinds.every((k) => k.style === null && k.id.startsWith("plain-wall:")), `${label}: four plain wall sizes`);
  const kind = kinds[0];
  const room: [number, number][] = [[0, 0], [5000, 0], [5000, 4000], [0, 4000]];
  const walls: string[] = [];
  room.forEach(([x, y], i) => {
    const [nx, ny] = room[(i + 1) % 4];
    const joins = { ...(walls.length ? { before: walls[walls.length - 1] } : {}), ...(i === 3 ? { after: walls[0] } : {}) };
    walls.push(s.addWall(layer.id, { x, y }, { x: nx, y: ny }, kind.id, undefined, joins));
  });
  const w0 = s.doc.wall(walls[0]);
  check(!!w0 && at(w0.start, 0, 0) && at(w0.end, 5000, 0), `${label}: a plain wall lies on its line`);
  check(!!w0 && near(w0.thickness, kind.thickness) && near(w0.top - w0.bottom, kind.height), `${label}: a plain wall has its size`);
  check(s.wallTemplates().length >= 4, `${label}: sizes still offered with walls drawn`);
  const net = s.wallFootprints(walls);
  check(net.length === 4, `${label}: footprints of four walls`);
  const tee = s.addWall(layer.id, { x: 2500, y: 0 }, { x: 2500, y: 4000 }, kinds[1].id, undefined, { before: walls[0], after: walls[2] });
  check(!!s.doc.wall(tee), `${label}: a plain wall of another size tees between two`);
  const restyled = s.setWallStyle(tee, kinds[2].id);
  check(near(s.doc.wall(restyled)!.thickness, kinds[2].thickness), `${label}: a wall takes a plain size`);
  const reopened = openVwx(s.doc.toBytes());
  check(!!reopened.doc.wall(walls[1]) && near(reopened.doc.wall(walls[1])!.thickness, kind.thickness), `${label}: plain walls save and reopen`);
  check(reopened.wallTemplates().every((k) => k.style === null), `${label}: reopened walls are unstyled`);
  // a record format with none to copy
  const format = s.createRecordFormat("Blank Data", [
    { name: "Label", kind: "text", value: "" },
    { name: "Count", kind: "integer", value: 0 },
    { name: "Size", kind: "dimension", value: 0 },
    { name: "Share", kind: "number", value: 0 },
  ]);
  s.attachRecord([walls[0]], format);
  s.setRecordFields(format, [{ id: walls[0], fields: { Label: "North", Count: 3, Size: 1200, Share: 0.25 } }]);
  const back = openVwx(s.doc.toBytes()).doc;
  const field = (name: string) => back.records(walls[0]).find((r) => r.format === format)?.fields.find((f) => f.name === name)?.value;
  check(back.recordFormats().some((f) => f.format === format && f.name === "Blank Data"), `${label}: a new record format saves`);
  check(field("Label") === "North" && field("Count") === 3 && field("Size") === 1200 && field("Share") === 0.25, `${label}: its values save and reopen`);
  const second = s.createLayer("Second", "design", 50);
  check(s.doc.layers().length === 2 && s.doc.layers().some((l) => l.id === second), `${label}: createLayer`);
  check(s.doc.stories().length === 0, `${label}: no stories to begin with`);
  const story = s.createStory("Level 2", "L2", 3000);
  s.setLayerStory(second, story);
  s.setLayerElevation(second, 3000);
  const storied = openVwx(s.doc.toBytes()).doc;
  const level2 = storied.stories().find((t) => t.index === story);
  check(level2?.name === "Level 2" && level2.suffix === "L2" && level2.elevation === 3000, `${label}: createStory saves and reopens`);
  check(storied.layers().find((l) => l.id === second)?.story === story, `${label}: a layer on the new story`);
  const cls = s.createClass("Walls");
  check(s.doc.classes().some((c) => c.name === "Walls") && cls > 0, `${label}: createClass`);
  {
    // one add with a class per shape, none given being None, as a DWG import places its layers
    const none = s.doc.classes().find((c) => c.name === "None")!.index;
    const line = (x: number): NewShape => ({ kind: "line", a: { x, y: 0 }, b: { x, y: 10 } });
    const made = s.addObjects(second, [line(1), line(2), line(3)], [cls, undefined, cls]);
    check(JSON.stringify(made.map((id) => s.doc.object(id)?.classIndex)) === JSON.stringify([cls, none, cls]), `${label}: addObjects takes a class per shape`);
    let refused = false;
    try {
      s.addObjects(second, [line(4), line(5)], [cls]);
    } catch {
      refused = true;
    }
    check(refused, `${label}: addObjects refuses a class list of the wrong length`);
  }
  const other = units === "mm" ? "Feet & Inches" : "Millimeters";
  s.setUnits(other);
  check(unitsName(s.doc.toBytes().subarray(0, 2676)) === other, `${label}: setUnits to ${other}`);
}

const tpls = builtinTemplates();
check(
  [2, 3, 13, 5, 21, 6, 10, 11].every((t) => tpls.has(t) && tpls.get(t)!.recs[0][0x19] === t),
  "built-in templates for line, rect, roundrect, polygon, polyline, arc, text and group",
);
const shell = tpls.get(11)!;
check(shell.recs.length === 2 && shell.parent[1] === 0 && shell.recs[1][0x19] === 0, "group template: group with its terminator");
const fresh = builtinTemplates().get(2)!;
fresh.recs[0][0x50] = 99;
check(builtinTemplates().get(2)!.recs[0][0x50] !== 99, "built-in templates are fresh copies");

if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("all checks passed");
