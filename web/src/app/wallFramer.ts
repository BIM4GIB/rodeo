// AEC > Framing > Wall Framer…, Vectorworks' command of that name: the walls on the layers chosen
// framed (wallFramerShapes.ts) with plates and studs, and kings, jacks, headers, sills and cripples
// round their doors and windows, by each wall class's options. A framing model is a set of design
// layers named after it: "<name>" holds the framing in 3D, "<name> Plan" the framing plan (the
// bottom plates and the uprights, the top plates left off) and "<name> Diagram" each wall's framing
// in elevation; Frame TakeOff and Frame Wall Info worksheets list them where the drawing has a
// worksheet to copy them from. Framing a model again redraws its layers.

import type { EditSession, LayerInfo, NewShape, NewSheetCell, Pt } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { confirmDialog } from "./menubar.ts";
import { colorMatcher } from "./pdfImport.ts";
import { prism, type Solid } from "./solids3d.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs, type PrefField } from "./toolPrefs.ts";
import { formatArea, formatLength, millimetresPerUnit } from "./units.ts";
import { countPieces, frameWall, LUMBER, PIECE_LABEL, pieceLength, wallInfo, type ClassOptions, type Lumber, type Opening, type Piece, type PieceKind } from "./wallFramerShapes.ts";

/** Vectorworks' wall and plug-in object types */
const WALL = 68;
const PLUGIN = 86;
const TIMBER = { r: 0.82, g: 0.68, b: 0.47 };
const PLATE = { r: 0.93, g: 0.87, b: 0.76 };
/** the diagram's labels on paper, mm, and the room between its walls, as many label heights */
const LABEL_MM = 3;
const GAP = 4;
const UPRIGHTS: ReadonlySet<PieceKind> = new Set<PieceKind>(["stud", "king", "jack", "cripple"]);

interface Output {
  readonly model: string;
  readonly three: boolean;
  readonly two: boolean;
  readonly sheets: boolean;
  readonly layers: readonly string[];
}

let lastOutput: Output | null = null;
/** each wall class's options, by its name */
const classOptions = new Map<string, ClassOptions>();

function firstOptions(): ClassOptions {
  const perUnit = millimetresPerUnit(store.session?.doc.info.units);
  const imperial = perUnit === 25.4 || perUnit === 304.8;
  return imperial
    ? { spacing: 406.4, sheetWidth: 1219.2, sheetHeight: 2438.4, maxPlate: 4876.8, lumber: LUMBER[0], fireBlocking: false, doubleEnd: false, doubleTop: true, doubleBottom: false }
    : { spacing: 400, sheetWidth: 1200, sheetHeight: 2400, maxPlate: 4800, lumber: LUMBER[0], fireBlocking: false, doubleEnd: false, doubleTop: true, doubleBottom: false };
}

interface FoundWall {
  readonly layer: LayerInfo;
  readonly className: string;
  readonly classIndex: number;
  readonly start: Pt;
  /** along it, and to its left */
  readonly u: Pt;
  readonly n: Pt;
  /** the middle of its thickness, left of its line */
  readonly across: number;
  /** its bottom in the model */
  readonly base: number;
  readonly length: number;
  readonly height: number;
  readonly openings: Opening[];
}

/** The walls on a design layer, with the doors and windows set in them as openings: each one's reach along the wall and up it, from what it shows in 3D. */
function wallsOn(s: EditSession, layer: LayerInfo): FoundWall[] {
  const doc = s.doc;
  const classes = new Map(doc.classes().map((c) => [c.index, c.name]));
  const objects = doc.objects(layer.id);
  return objects
    .filter((o) => o.type === WALL)
    .flatMap((o): FoundWall[] => {
      const w = doc.wall(o.id);
      if (!w) return [];
      const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
      const height = w.top - w.bottom;
      if (!(length > 0) || !(height > 0)) return [];
      const u = { x: (w.end.x - w.start.x) / length, y: (w.end.y - w.start.y) / length };
      const n = { x: -u.y, y: u.x };
      const sides = s.wallFootprints([o.id]).flat().map((p) => (p.x - w.start.x) * n.x + (p.y - w.start.y) * n.y);
      const across = sides.length ? (Math.min(...sides) + Math.max(...sides)) / 2 : 0;
      const base = (layer.elevation ?? 0) + w.bottom;
      const openings = objects
        .filter((k) => k.parentId === o.id && k.type === PLUGIN)
        .flatMap((k): Opening[] => {
          const tri = s.faceTriangles(k.id);
          if (!tri.length) return [];
          let [a0, a1, z0, z1] = [Infinity, -Infinity, Infinity, -Infinity];
          for (let i = 0; i + 2 < tri.length; i += 3) {
            const along = (tri[i] - w.start.x) * u.x + (tri[i + 1] - w.start.y) * u.y;
            [a0, a1, z0, z1] = [Math.min(a0, along), Math.max(a1, along), Math.min(z0, tri[i + 2]), Math.max(z1, tri[i + 2])];
          }
          return [{ from: a0, to: a1, sill: z0 - base, head: z1 - base }];
        });
      return [{ layer, className: classes.get(o.classIndex) ?? "None", classIndex: o.classIndex, start: w.start, u, n, across, base, length, height, openings }];
    });
}

/** The design layers holding walls, and the wall classes on them. */
function framable(s: EditSession): { layers: LayerInfo[]; classes: string[] } {
  const names = new Map(s.doc.classes().map((c) => [c.index, c.name]));
  const layers = s.doc.layers().filter((l) => l.kind === "design" && s.doc.objects(l.id).some((o) => o.type === WALL));
  const classes = new Set<string>();
  for (const l of layers) for (const o of s.doc.objects(l.id)) if (o.type === WALL && s.doc.wall(o.id)) classes.add(names.get(o.classIndex) ?? "None");
  return { layers, classes: [...classes].sort() };
}

export const canFrameWalls = (): boolean => {
  const s = store.session;
  return !!s && s.doc.layers().some((l) => l.kind === "design" && s.doc.objects(l.id).some((o) => o.type === WALL));
};

async function askOptions(layers: readonly LayerInfo[], classes: readonly string[]): Promise<{ output: Output; options: Map<string, ClassOptions> } | null> {
  const active = store.activeLayerId;
  const was = lastOutput;
  const chosen = new Set(was?.layers.length ? was.layers : layers.some((l) => l.id === active) ? [active] : layers.map((l) => l.id));
  const lumberChoices = LUMBER.map((l) => ({ value: l.name, label: l.name }));
  const fields: PrefField[] = [
    { kind: "text", key: "model", label: "Model Name", value: was?.model ?? "Frame" },
    { kind: "heading", key: "", label: "Framer Output" },
    { kind: "check", key: "three", label: "3D Model", value: was?.three ?? true },
    { kind: "check", key: "two", label: "2D Model", value: was?.two ?? true },
    { kind: "check", key: "sheets", label: "Worksheets", value: was?.sheets ?? true },
    { kind: "heading", key: "", label: "Frame the following layers" },
    ...layers.map((l): PrefField => ({ kind: "check", key: `layer:${l.id}`, label: l.name, value: chosen.has(l.id) })),
  ];
  classes.forEach((name, i) => {
    const o = classOptions.get(name) ?? firstOptions();
    fields.push(
      { kind: "heading", key: "", label: `Wall Class: ${name}` },
      { kind: "length", key: `${i}:spacing`, label: "Stud Spacing", value: o.spacing },
      { kind: "length", key: `${i}:sheetWidth`, label: "Sheet Stock Width", value: o.sheetWidth },
      { kind: "length", key: `${i}:sheetHeight`, label: "Sheet Stock Height", value: o.sheetHeight },
      { kind: "length", key: `${i}:maxPlate`, label: "Max Plate Length", value: o.maxPlate },
      { kind: "choice", key: `${i}:nominal`, label: "Nominal", value: o.lumber.name, options: lumberChoices },
      { kind: "length", key: `${i}:size`, label: "Size", value: o.lumber.size },
      { kind: "length", key: `${i}:by`, label: "by", value: o.lumber.by },
      { kind: "check", key: `${i}:fireBlocking`, label: "Fire Blocking", value: o.fireBlocking },
      { kind: "check", key: `${i}:doubleEnd`, label: "Double End Studs", value: o.doubleEnd },
      { kind: "check", key: `${i}:doubleTop`, label: "Double Top Plate", value: o.doubleTop },
      { kind: "check", key: `${i}:doubleBottom`, label: "Double Bottom Plate", value: o.doubleBottom },
    );
  });
  const v = await toolPrefs(
    "Wall Framing",
    fields,
    `The walls on the layers ticked are framed by their class's options: plates top and bottom (cut at the longest plate and through doors), end studs, studs the spacing apart from each wall's start, and round each door and window (its reach along the wall and up it, from what it shows in 3D) kings, jacks, a header twice the lumber's long side tall, cripples, and under a window a sill. Fire Blocking runs blocks between the studs at the sheet's height, or halfway up a lower wall. The lumber's Size is its short side and "by" its long side, across the wall; choosing another Nominal takes its sizes unless they've been typed. The model's layers are "<name>", "<name> Plan" and "<name> Diagram"; a model framed again is redrawn there.`,
  );
  if (!v) return null;
  const model = v.choice("model").trim();
  const output: Output = { model, three: v.flag("three"), two: v.flag("two"), sheets: v.flag("sheets"), layers: layers.filter((l) => v.flag(`layer:${l.id}`)).map((l) => l.id) };
  const options = new Map<string, ClassOptions>();
  classes.forEach((name, i) => {
    const o = classOptions.get(name) ?? firstOptions();
    const nominal = LUMBER.find((l) => l.name === v.choice(`${i}:nominal`)) ?? o.lumber;
    const [size, by] = [v.num(`${i}:size`), v.num(`${i}:by`)];
    // sizes left as they were follow a new nominal
    const typed = Math.abs(size - o.lumber.size) > 0.01 || Math.abs(by - o.lumber.by) > 0.01;
    const lumber: Lumber = nominal.name !== o.lumber.name && !typed ? nominal : { name: nominal.name, size, by };
    options.set(name, {
      spacing: v.num(`${i}:spacing`),
      sheetWidth: v.num(`${i}:sheetWidth`),
      sheetHeight: v.num(`${i}:sheetHeight`),
      maxPlate: v.num(`${i}:maxPlate`),
      lumber,
      fireBlocking: v.flag(`${i}:fireBlocking`),
      doubleEnd: v.flag(`${i}:doubleEnd`),
      doubleTop: v.flag(`${i}:doubleTop`),
      doubleBottom: v.flag(`${i}:doubleBottom`),
    });
  });
  return { output, options };
}

interface Frame {
  readonly n: number;
  readonly wall: FoundWall;
  readonly options: ClassOptions;
  readonly pieces: Piece[];
}

/** A piece's footprint in plan, the lumber's long side across the wall's middle. */
function planOf(f: Frame, p: Piece): Pt[] {
  const { start, u, n, across } = f.wall;
  const half = f.options.lumber.by / 2;
  const at = (x: number, c: number): Pt => ({ x: start.x + u.x * x + n.x * c, y: start.y + u.y * x + n.y * c });
  return [at(p.x0, across - half), at(p.x1, across - half), at(p.x1, across + half), at(p.x0, across + half)];
}

/** A design layer of this name emptied, or made at the elevation 0 and this scale; its id and elevation. */
function freshLayer(s: EditSession, name: string, scale: number): { id: string; elevation: number } {
  const was = s.doc.layers().find((l) => l.kind === "design" && l.name === name);
  if (was) {
    const top = s.doc.objects(was.id).filter((o) => !o.parentId).map((o) => o.id);
    if (top.length) s.deleteObjects(top);
    return { id: was.id, elevation: was.elevation ?? 0 };
  }
  const id = s.createLayer(name, "design", scale);
  s.setLayerElevation(id, 0);
  return { id, elevation: 0 };
}

const fillOf = (rgb: { r: number; g: number; b: number }): { fillPattern: number; fillFore: number; fillBack: number; fillOpacity: number } => {
  const c = colorMatcher()(rgb);
  return { fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: 100 };
};

function draw3D(s: EditSession, frames: readonly Frame[], scale: number, model: string): void {
  const layer = freshLayer(s, model, scale);
  const timber = { ...store.drawAttrs, ...fillOf(TIMBER) };
  for (const f of frames) {
    const byKind = new Map<PieceKind, Solid>();
    for (const p of f.pieces) {
      const solid = prism([planOf(f, p)], f.wall.base + p.z0 - layer.elevation, f.wall.base + p.z1 - layer.elevation);
      byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), ...solid]);
    }
    const meshes = s.addMeshes(layer.id, [...byKind.values()], f.wall.classIndex, timber);
    if (meshes.length > 1) s.groupObjects(meshes);
  }
}

function draw2D(s: EditSession, frames: readonly Frame[], scale: number, model: string): void {
  const plan = freshLayer(s, `${model} Plan`, scale);
  const pen = { ...store.drawAttrs, penFore: colorMatcher()({ r: 0, g: 0, b: 0 }), lineStyle: store.drawAttrs.lineStyle || 2 };
  const [plateLook, studLook] = [{ ...pen, ...fillOf(PLATE) }, { ...pen, ...fillOf(TIMBER) }];
  const polygon = (points: Pt[]): NewShape => ({ kind: "polygon", points, closed: true });
  for (const f of frames) {
    // from above with the top plates off: the bottom plate and the uprights standing on it
    const ids = [
      ...f.pieces.filter((p) => p.kind === "bottom" && p.z0 === 0).map((p) => s.addObject(plan.id, polygon(planOf(f, p)), f.wall.classIndex, plateLook)),
      ...f.pieces.filter((p) => UPRIGHTS.has(p.kind) && p.kind !== "cripple").map((p) => s.addObject(plan.id, polygon(planOf(f, p)), f.wall.classIndex, studLook)),
    ];
    if (ids.length > 1) s.groupObjects(ids);
  }
  const diagram = freshLayer(s, `${model} Diagram`, scale);
  const units = s.doc.info.units;
  const text = LABEL_MM * scale;
  let y = 0;
  for (const f of frames) {
    const box = (p: Piece): NewShape => polygon([
      { x: p.x0, y: y + p.z0 },
      { x: p.x1, y: y + p.z0 },
      { x: p.x1, y: y + p.z1 },
      { x: p.x0, y: y + p.z1 },
    ]);
    const label = `Frame ${f.n} · ${f.wall.layer.name} · ${f.wall.className} · ${formatLength(f.wall.length, units)} × ${formatLength(f.wall.height, units)}`;
    const ids = [
      ...f.pieces.map((p) => s.addObject(diagram.id, box(p), f.wall.classIndex, p.kind === "bottom" || p.kind === "top" ? plateLook : studLook)),
      s.addObject(diagram.id, { kind: "text", at: { x: 0, y: y + f.wall.height + text * 0.8 }, text: label, height: text, hAlign: 1, vAlign: 4 }, f.wall.classIndex, pen),
    ];
    s.groupObjects(ids);
    y -= f.wall.height + GAP * text;
  }
}

function worksheets(s: EditSession, frames: readonly Frame[], model: string): void {
  const units = s.doc.info.units;
  const len = (mm: number): string => formatLength(mm, units);
  const bold = (value: string): NewSheetCell => ({ value, bold: true, align: "center" });
  const replace = (name: string, widths: number[], rows: NewSheetCell[][]): void => {
    const was = s.doc.resources().find((r) => r.kind === "worksheet" && r.name === name);
    if (was) s.deleteWorksheet(was.index);
    s.createWorksheet({ name, widths, rowHeight: 14, rows });
  };
  const sorted = [...frames].sort((a, b) => a.wall.layer.name.localeCompare(b.wall.layer.name) || a.wall.className.localeCompare(b.wall.className) || a.n - b.n);
  const takeOff: NewSheetCell[][] = [["Layer", "Class", "Frame", "Member", "Size", "Length", "Count"].map(bold)];
  for (const f of sorted)
    for (const r of countPieces(f.pieces)) takeOff.push([{ value: f.wall.layer.name }, { value: f.wall.className }, { value: `Frame ${f.n}` }, { value: PIECE_LABEL[r.kind] }, { value: f.options.lumber.name }, { value: len(r.length) }, { value: r.count, align: "right" }]);
  takeOff.push([{ value: "Total", bold: true }, { value: "" }, { value: "" }, { value: "" }, { value: "" }, { value: len(frames.reduce((n, f) => n + f.pieces.reduce((m, p) => m + pieceLength(p), 0), 0)), bold: true }, { value: frames.reduce((n, f) => n + f.pieces.length, 0), align: "right", bold: true }]);
  replace(`${model} Frame TakeOff`, [90, 90, 60, 90, 60, 80, 50], takeOff);
  const info: NewSheetCell[][] = [["Layer", "Class", "Frame", "Length", "Height", "Area", "Studs", "Plates", "Sheets"].map(bold)];
  for (const f of sorted) {
    const w = wallInfo(f.wall.length, f.wall.height, f.wall.openings, f.pieces, f.options);
    info.push([{ value: f.wall.layer.name }, { value: f.wall.className }, { value: `Frame ${f.n}` }, { value: len(w.length) }, { value: len(w.height) }, { value: formatArea(w.area, units) }, { value: w.studs, align: "right" }, { value: len(w.plates) }, { value: w.sheets, align: "right" }]);
  }
  replace(`${model} Frame Wall Info`, [90, 90, 60, 80, 70, 80, 50, 80, 50], info);
}

/** AEC > Framing > Wall Framer…: the framing model's layers and the wall classes' options, then the framing. */
export async function wallFramerDialog(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const { layers, classes } = framable(s);
  if (!layers.length) {
    toast("There are no walls on the drawing's design layers to frame.", "info");
    return;
  }
  const asked = await askOptions(layers, classes);
  if (!asked || store.session !== s) return;
  const { output, options } = asked;
  lastOutput = output;
  for (const [name, o] of options) classOptions.set(name, o);
  if (!output.model) {
    toast("Give the framing model a name.", "info");
    return;
  }
  if (!output.three && !output.two && !output.sheets) {
    toast("Choose 3D Model, 2D Model or Worksheets.", "info");
    return;
  }
  const chosen = layers.filter((l) => output.layers.includes(l.id));
  if (!chosen.length) {
    toast("Tick a layer to frame.", "info");
    return;
  }
  const outputs = new Set([output.model, `${output.model} Plan`, `${output.model} Diagram`]);
  if (chosen.some((l) => outputs.has(l.name))) {
    toast("Name the model apart from the layers being framed.", "info");
    return;
  }
  // a layer of the model's name is emptied and drawn again, so say so when it holds anything
  const replaced = [...(output.three ? [output.model] : []), ...(output.two ? [`${output.model} Plan`, `${output.model} Diagram`] : [])].filter((name) => {
    const l = s.doc.layers().find((x) => x.kind === "design" && x.name === name);
    return !!l && s.doc.objects(l.id).some((o) => !o.parentId);
  });
  if (replaced.length) {
    const one = replaced.length === 1;
    const ok = await confirmDialog("Wall Framer", `${replaced.map((n) => `“${n}”`).join(", ")} already ${one ? "holds" : "hold"} objects. Framing replaces everything on ${one ? "it" : "them"}.`, "Replace");
    if (!ok || store.session !== s) return;
  }
  const frames: Frame[] = [];
  const refused: string[] = [];
  for (const w of chosen.flatMap((l) => wallsOn(s, l))) {
    const o = options.get(w.className) ?? firstOptions();
    const pieces = frameWall(w.length, w.height, w.openings, o);
    if (typeof pieces === "string") refused.push(pieces);
    else frames.push({ n: frames.length + 1, wall: w, options: o, pieces });
  }
  if (!frames.length) {
    toast(refused[0] ?? "There are no walls on those layers to frame.", "info");
    return;
  }
  const scale = chosen[0].scale || 1;
  const sheets = output.sheets && s.doc.resources().some((r) => r.kind === "worksheet");
  const made = attempt("Wall Framer", (e) =>
    e.batch(() => {
      if (output.three) draw3D(e, frames, scale, output.model);
      if (output.two) draw2D(e, frames, scale, output.model);
      if (sheets) worksheets(e, frames, output.model);
    }),
  );
  if (!made) return;
  store.emit("session");
  const studs = frames.reduce((n, f) => n + f.pieces.filter((p) => UPRIGHTS.has(p.kind)).length, 0);
  const openings = frames.reduce((n, f) => n + f.wall.openings.length, 0);
  const parts = [`Framed ${frames.length} wall${frames.length === 1 ? "" : "s"}: ${studs} studs${openings ? `, round ${openings === 1 ? "1 door or window" : `${openings} doors and windows`}` : ""}.`];
  if (refused.length) parts.push(`${refused.length} too small to frame ${refused.length === 1 ? "was" : "were"} left out.`);
  if (output.sheets && !sheets) parts.push("This drawing has no worksheet to copy one from, so there are no worksheets.");
  toast(parts.join(" "), "info");
}
