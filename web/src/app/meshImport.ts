// File > Import OBJ…, glTF…, 3DS…, STL…, IFC…, USD…, Rhino 3DM…, FBX…, Collada (SketchUp)…,
// Blender…, PLY…, SketchUp…, STEP… and IGES…: a 3D model's parts as meshes on the active layer, in the
// active class, grouped, selected and zoomed to, as one undo step.
// OBJ, 3DS, STL and PLY files say nothing reliable of their units or which way is up, so the user
// says (metres, with y up for OBJ and z up for 3DS and PLY, as most are and as File > Export writes
// them; millimetres and z up for STL, as 3D printing has it); a glTF file is metres and y up by
// definition, and IFC, Rhino, FBX, Collada, Blender, STEP and IGES files say their units and up axis.
// A SketchUp file is inches and z up whatever units its model shows. A USD file says its units per
// metre and up axis, and Vectorworks' Import USD Options can re-scale it, redefine its up axis and offset it.
// Coordinates are kept, so a model exported from here comes back where it was. An STL or USD model
// can come in as a symbol, as Vectorworks' Import as symbol does: its definition holds the meshes, an
// instance at the origin shows them where they were. A Rhino file's blocks, a Collada file's instanced
// nodes and an FBX file's models that share geometry come in as symbols, as a SketchUp file's components
// do: each definition made once and placed by each instance, keeping its name. A part with a colour
// keeps it exactly as its fill (added to the drawing's colours where it hasn't it), and a see-through
// one keeps its opacity. Parts are grouped by what holds them in the
// file (an IFC building storey, the prims under a USD file's default prim, a Rhino layer, a Collada
// scene node, a Blender collection, a SketchUp model's top-level groups and components), each group
// named after it. A SketchUp tag is a class of the same name, as a DXF layer is: an existing one is
// reused, otherwise one is made. A Rhino file's curves, text and points come in as 2D objects in plan,
// in their layer's group, pen coloured as in Rhino. A STEP or IGES file's assembly comes in as groups,
// each named after its node, with a mesh for each colour its shape's faces have. The reading is in
// import/; the readers of the newer formats (and Rhino's and OpenCascade's WebAssembly) load only when
// such a file is imported. New meshes copy their settings from one in the drawing, as Convert to Mesh
// does, or from the built-in one in a drawing that has none.

import type { Attributes, ImageTextureSpec, MeshNode } from "../core/index.ts";
import { ifcReader, parseIfc } from "../import/ifc.ts";
import { countOf, MAX_FACES, parse3ds, parseGltf, parseObj, parseStl, treeFaces, treeLines, type MeshFile, type MeshPart, type MeshTexture, type MeshTree, type MeshTreeNode } from "../import/mesh.ts";
import { occtLib } from "../import/occt.ts";
import { rhinoLib } from "../import/rhino3dm.ts";
import { parseUsd, type UsdFile } from "../import/usd.ts";
import { attempt, setEditGroup, zoomToSelection } from "./commands.ts";
import { fileIn } from "./ext.ts";
import { h, nextPaint } from "./dom.ts";
import { showLoading } from "./loading.ts";
import { showDialog } from "./menubar.ts";
import { previewPngs } from "./resourcePreview.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { mmPerPt } from "./textMenu.ts";
import { errorMessage, toast } from "./toast.ts";
import { formatLength, parseLength } from "./units.ts";
import type { View } from "./view.ts";

/** The 3D formats File > Import reads. */
export type MeshImportFormat = "obj" | "gltf" | "3ds" | "stl" | "ifc" | "usd" | "3dm" | "fbx" | "dae" | "blend" | "ply" | "skp" | "step" | "iges";
type Format = MeshImportFormat;
/** Most meshes an import names after the file's objects: past it they stay unnamed, as each name takes one of the drawing's 65,535. */
const MAX_NAMED = 2000;
/** the formats whose units and up axis the user gives before the file is read */
type Asks = "obj" | "3ds" | "stl" | "ply";
const ASKS: ReadonlySet<Format> = new Set<Format>(["obj", "3ds", "stl", "ply"]);
/** the formats that may take a while to read (a WebAssembly reader to load, or big files), which show a progress note */
const SLOW: ReadonlySet<Format> = new Set<Format>(["ifc", "3dm", "fbx", "dae", "blend", "skp", "step", "iges"]);

const FORMAT_NAME: Record<Format, string> = {
  obj: "OBJ",
  gltf: "glTF",
  "3ds": "3DS",
  stl: "STL",
  ifc: "IFC",
  usd: "USD",
  "3dm": "Rhino 3DM",
  fbx: "FBX",
  dae: "Collada",
  blend: "Blender",
  ply: "PLY",
  skp: "SketchUp",
  step: "STEP",
  iges: "IGES",
};
/** "a glTF", "an OBJ": the article each name takes as it is said */
const A_FORMAT: Record<Format, string> = {
  obj: "an OBJ",
  gltf: "a glTF",
  "3ds": "a 3DS",
  stl: "an STL",
  ifc: "an IFC",
  usd: "a USD",
  "3dm": "a Rhino",
  fbx: "an FBX",
  dae: "a Collada",
  blend: "a Blender",
  ply: "a PLY",
  skp: "a SketchUp",
  step: "a STEP",
  iges: "an IGES",
};
const ACCEPT: Record<Format, string> = {
  obj: ".obj",
  gltf: ".glb,.gltf,model/gltf-binary,model/gltf+json",
  "3ds": ".3ds",
  stl: ".stl,model/stl",
  ifc: ".ifc",
  usd: ".usd,.usda,.usdc,.usdz,model/vnd.usdz+zip",
  "3dm": ".3dm",
  fbx: ".fbx",
  dae: ".dae,.kmz,model/vnd.collada+xml,application/vnd.google-earth.kmz",
  blend: ".blend",
  ply: ".ply",
  skp: ".skp",
  step: ".stp,.step,model/step",
  iges: ".igs,.iges,model/iges",
};
/** each format's file names */
const EXTENSIONS: readonly [Format, RegExp][] = [
  ["obj", /\.obj$/i],
  ["gltf", /\.(glb|gltf)$/i],
  ["3ds", /\.3ds$/i],
  ["stl", /\.stl$/i],
  ["ifc", /\.ifc$/i],
  ["usd", /\.usd[acz]?$/i],
  ["3dm", /\.3dm$/i],
  ["fbx", /\.fbx$/i],
  ["dae", /\.(dae|kmz)$/i],
  // Blender's numbered backups (.blend1, .blend2) are .blend files too
  ["blend", /\.blend\d*$/i],
  ["ply", /\.ply$/i],
  ["skp", /\.skp$/i],
  ["step", /\.(stp|step)$/i],
  ["iges", /\.(igs|iges)$/i],
];

/** OBJ units the dialog offers, in millimetres each. */
const UNITS: readonly { label: string; mm: number }[] = [
  { label: "Millimetres", mm: 1 },
  { label: "Centimetres", mm: 10 },
  { label: "Metres", mm: 1000 },
  { label: "Inches", mm: 25.4 },
  { label: "Feet", mm: 304.8 },
];
const MILLIMETRES = 0;
const METRES = 2;

/** the settings last used for the formats that ask */
const last: Record<Asks, { unit: number; yUp: boolean; symbol: boolean }> = {
  obj: { unit: METRES, yUp: true, symbol: false },
  "3ds": { unit: METRES, yUp: false, symbol: false },
  stl: { unit: MILLIMETRES, yUp: false, symbol: false },
  ply: { unit: METRES, yUp: false, symbol: false },
};

/** The format a file's name says it is in, or null. */
export function meshFormat(name: string): Format | null {
  return EXTENSIONS.find(([, test]) => test.test(name))?.[0] ?? null;
}

/** Apps whose own files are closed or not read here, and what to export from each instead. (Revit's and Archicad's are read: revitFile.ts, plnImport.ts.) */
const ELSEWHERE: readonly [RegExp, string][] = [
  [/\.(max|c4d|ma|mb)$/i, "3ds Max, Cinema 4D and Maya files are closed. Export the model as FBX from that app, then import that"],
];

/** What to export instead, for a file from an app whose own format isn't read here (3ds Max…), or null. */
export function exportAdvice(name: string): string | null {
  return ELSEWHERE.find(([test]) => test.test(name))?.[1] ?? null;
}

/** True when there is a drawing, an active layer and a mesh to copy settings from; otherwise says why. */
function ready(format: Format): boolean {
  const s = store.session;
  if (!s) {
    toast(`Open a drawing before importing ${FORMAT_NAME[format]}.`, "info");
    return false;
  }
  if (store.activeLayerId === null) {
    toast(`Choose a layer to import the ${FORMAT_NAME[format]} model into.`, "info");
    return false;
  }
  if (!s.canAddMeshes()) {
    toast(`This drawing has no mesh to copy settings from yet, so ${A_FORMAT[format]} model can't be imported into it.`, "info");
    return false;
  }
  return true;
}

/** File > Import OBJ…, glTF…, 3DS…, STL…, IFC…, USD…, Rhino 3DM…, FBX…, Collada…, Blender…, PLY…, SketchUp…, STEP… or IGES…: asks for the file and imports it. */
export function importMeshFile(format: Format, scene: Scene, view: View): void {
  if (!ready(format)) return;
  const input = h("input", { attrs: { type: "file", accept: ACCEPT[format] }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void importMesh(file, scene, view);
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/** An OBJ, 3DS, STL, PLY or USD file's units, millimetres each, and which way is up; an STL or USD model as a symbol, a USD model moved by `offset` (mm, x, y and z in the drawing). */
export interface MeshUnits {
  readonly mm: number;
  readonly yUp: boolean;
  readonly symbol?: boolean;
  readonly offset?: readonly [number, number, number];
}

/** The file read as `format`, each reader of the newer formats loaded as it is first needed. */
async function readModel(format: Format, name: string, bytes: Uint8Array): Promise<MeshFile> {
  const base = name.replace(/\.[^.]+$/, "");
  switch (format) {
    case "obj":
      return parseObj(new TextDecoder().decode(bytes));
    case "gltf":
      return parseGltf(bytes);
    case "3ds":
      return parse3ds(bytes);
    case "stl":
      return parseStl(bytes, base);
    case "ifc":
      return parseIfc(bytes, await ifcReader());
    case "usd":
      return parseUsd(bytes);
    case "3dm": {
      const [{ parse3dm }, rhino] = await Promise.all([import("../import/rhino.ts"), rhinoLib()]);
      return parse3dm(bytes, rhino);
    }
    case "fbx":
      return (await import("../import/fbx.ts")).parseFbx(bytes);
    case "dae": {
      const { parseCollada, parseKmz } = await import("../import/collada.ts");
      return /\.kmz$/i.test(name) ? parseKmz(bytes) : parseCollada(new TextDecoder().decode(bytes));
    }
    case "blend":
      return (await import("../import/blend.ts")).parseBlend(bytes);
    case "ply":
      return (await import("../import/ply.ts")).parsePly(bytes, base);
    case "skp":
      return (await import("../import/skp.ts")).parseSkp(bytes);
    case "step":
    case "iges": {
      const [{ readStep, readIges }, occt] = await Promise.all([import("../import/step.ts"), occtLib()]);
      return format === "step" ? readStep(bytes, occt) : readIges(bytes, occt);
    }
  }
}

/** Names the group `base`, else `base 2`, `base 3`… when another object, layer or class has the name. */
function nameGroup(s: NonNullable<typeof store.session>, id: string, base: string): void {
  for (let n = 1; n < 1000; n++) {
    try {
      s.setObjectName(id, n === 1 ? base : `${base} ${n}`);
      return;
    } catch {
      // taken: the next number
    }
  }
}

/**
 * A 3D model file (any format meshFormat knows), chosen or dropped on the window: imported into the
 * active layer. `units`, when given, answers what an OBJ, 3DS, STL, PLY or USD import would ask (the
 * Agents panel).
 */
export async function importMesh(file: File, scene: Scene, view: View, units?: MeshUnits): Promise<void> {
  const format = meshFormat(file.name);
  if (!format || !ready(format)) return;
  let asked: MeshUnits | null = null;
  if (ASKS.has(format)) {
    asked = units ?? (await askUnits(format as Asks));
    if (!asked) return;
  }
  let model: MeshFile;
  // a WebAssembly reader's first load and a large model's geometry take a while
  const done = SLOW.has(format) ? showLoading(`Reading ${file.name}…`) : () => {};
  try {
    await nextPaint();
    model = await readModel(format, file.name, new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    fileIn(file, file.name, errorMessage(err));
    return;
  } finally {
    done();
  }
  if (format === "usd") {
    // a USD file says its units and up axis, so the options are asked once it has been read
    asked = units ?? (await askUsd(model as UsdFile));
    if (!asked) return;
  }
  const layerId = store.activeLayerId;
  if (!layerId) return;
  if (model.tree) {
    await importTree(file, format, model, model.tree, layerId, scene, view);
    return;
  }

  // what the user said, else what the file says, else glTF's metres and y up
  const settings: MeshUnits = asked ?? model.frame ?? { mm: 1000, yUp: true };
  const { mm, yUp } = settings;
  const [dx, dy, dz] = settings.offset ?? [0, 0, 0];
  // y up turns into z up: (x, y, z) to (x, −z, y)
  const parts = model.parts.map((p) =>
    p.faces.map((f) => {
      const out = new Array<number>(f.length);
      for (let i = 0; i < f.length; i += 3) {
        out[i] = f[i] * mm + dx;
        out[i + 1] = (yUp ? -f[i + 2] : f[i + 1]) * mm + dy;
        out[i + 2] = (yUp ? f[i + 1] : f[i + 2]) * mm + dz;
      }
      return out;
    }),
  );
  const shapes = model.shapes ?? [];
  const skipped = { ...model.skipped };
  const faces = parts.reduce((n, p) => n + p.length, 0);
  if (faces === 0 && shapes.length === 0) {
    toast(`Nothing to import in ${file.name}${leftOutOf(skipped)}.`, "info");
    fileIn(file, file.name, `nothing to import${leftOutOf(skipped)}`);
    return;
  }
  const drawAttrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const tagged = model.parts.some((p) => p.tag);
  // each mesh named after the file's object, unless there are so many the names would crowd the drawing's
  const names = model.parts.length <= MAX_NAMED ? model.parts.map((p) => p.name) : undefined;
  // the parts and 2D objects by what holds them in the file (IFC storeys, USD prims, Rhino layers, SketchUp groups), in the file's order
  const groups = new Map<string, { parts: number[]; shapes: number[] }>();
  const groupOf = (k: string): { parts: number[]; shapes: number[] } => {
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { parts: [], shapes: [] }));
    return g;
  };
  model.parts.forEach((p, i) => {
    if (parts[i].length) groupOf(p.group ?? "").parts.push(i);
  });
  shapes.forEach((sh, i) => groupOf(sh.group ?? "").shapes.push(i));
  const base = file.name.replace(/\.[^.]+$/, "") || FORMAT_NAME[format];
  const symbol = settings.symbol ? symbolName(base, `${FORMAT_NAME[format]} model`) : null;
  let flat = 0;
  const r = attempt(`Import ${FORMAT_NAME[format]}`, (s) =>
    s.batch(() => {
      const classOf = tagClasses(s);
      const classes = tagged ? model.parts.map((p) => classOf(p.tag)) : undefined;
      // the file's colours exactly, added to the drawing's colour table where it hasn't them
      const colorOf = exactColors(s, [...model.parts.map((p) => p.color), ...shapes.map((sh) => sh.color)]);
      const attrs = model.parts.map(attrsMaker(colorOf));
      let made: { count: number; top: string };
      // the group holding the whole import is named after the file, which exports then carry
      const outer = (ids: string[]): string => {
        const id = s.groupObjects(ids);
        nameGroup(s, id, base);
        return id;
      };
      if (shapes.length === 0 && groups.size >= 2) {
        const sets = [...groups].map(([name, g]) => ({
          name,
          parts: g.parts.map((i) => parts[i]),
          attrs: g.parts.map((i) => attrs[i]),
          classes: classes && g.parts.map((i) => classes[i]),
          names: names && g.parts.map((i) => names[i]),
        }));
        const { id, count } = s.addMeshGroups(layerId, sets, store.activeClassIndex);
        nameGroup(s, id, base);
        made = { count, top: id };
      } else if (shapes.length === 0) {
        const ids = s.addMeshes(layerId, parts, classes ?? store.activeClassIndex, attrs, names);
        made = { count: ids.length, top: ids.length < 2 ? ids[0] : outer(ids) };
      } else {
        // meshes and linework together: each group's objects made, then grouped and named
        const tops: string[] = [];
        let count = 0;
        for (const [name, g] of groups) {
          const ids = g.parts.length
            ? s.addMeshes(layerId, g.parts.map((i) => parts[i]), classes ? g.parts.map((i) => classes[i]) : store.activeClassIndex, g.parts.map((i) => attrs[i]), names && g.parts.map((i) => names[i]))
            : [];
          for (const i of g.shapes) {
            const { shape, color, points } = shapes[i];
            const sized = points !== undefined && shape.kind === "text" ? { ...shape, height: points * mmPerPt(layerId) } : shape;
            try {
              ids.push(s.addObject(layerId, sized, store.activeClassIndex, color ? { ...drawAttrs, penFore: colorOf(color) } : drawAttrs));
              flat++;
            } catch {
              // one the drawing can't hold (a line of no length) is left out
              skipped["2D object"] = (skipped["2D object"] ?? 0) + 1;
            }
          }
          count += ids.length;
          if (ids.length === 0) continue;
          const top = ids.length < 2 ? ids[0] : s.groupObjects(ids);
          if (groups.size >= 2 && name && ids.length >= 2) nameGroup(s, top, name);
          tops.push(top);
        }
        if (tops.length === 0) throw new Error("none of its objects could be added");
        made = { count, top: tops.length < 2 ? tops[0] : outer(tops) };
      }
      // as a symbol: its insertion point at the origin, so the instance stands where the model was
      return symbol ? { count: made.count, top: s.createSymbol([made.top], symbol, { x: 0, y: 0 }) } : made;
    }),
  );
  if (!r) {
    fileIn(file, file.name, "it could not be added to the drawing");
    return;
  }
  setEditGroup(null, [r.value.top]);
  zoomToSelection(scene, view);
  const meshCount = r.value.count - flat;
  const said: string[] = [];
  if (meshCount > 0) said.push(`${meshCount} ${meshCount === 1 ? "mesh" : "meshes"}, ${faces.toLocaleString("en")} ${faces === 1 ? "face" : "faces"}`);
  if (flat > 0) said.push(`${flat} 2D ${flat === 1 ? "object" : "objects"}`);
  const as = symbol ? ` as the symbol ${symbol}` : "";
  toast(`Imported ${file.name}${as}: ${said.join(", ")}${leftOutOf(skipped)}.`, "info");
  fileIn(file, file.name);
}

/**
 * A model whose repeated parts are symbols (a SketchUp file's components, a Rhino file's blocks, a
 * Collada file's instanced nodes, an FBX file's shared geometry) into the active layer:
 * its symbols made and placed, all in one group named after the file, selected and zoomed to, as
 * one undo step. The tree is z up, in the units its frame says.
 */
async function importTree(file: File, format: Format, model: MeshFile, tree: MeshTree, layerId: string, scene: Scene, view: View): Promise<void> {
  const mm = model.frame?.mm ?? 1;
  const faces = treeFaces(tree);
  const loose = treeLines(tree);
  if (faces === 0 && loose.lines === 0 && loose.points === 0 && loose.shapes === 0) {
    toast(`Nothing to import in ${file.name}${leftOutOf(model.skipped)}.`, "info");
    fileIn(file, file.name, `nothing to import${leftOutOf(model.skipped)}`);
    return;
  }
  // a SketchUp part is a tag's and material's faces, not an object of the file's, so its meshes stay unnamed
  const named = format !== "skp" && treeNodes(tree).reduce((k, n) => k + n.parts.length, 0) <= MAX_NAMED;
  const drawAttrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  const base = file.name.replace(/\.[^.]+$/, "") || FORMAT_NAME[format];
  const specs = await textureSpecs(model.textures ?? [], mm);
  let textures = 0;
  const r = attempt(`Import ${FORMAT_NAME[format]}`, (s) =>
    s.batch(() => {
      const classOf = tagClasses(s);
      const colorOf = exactColors(s, treeColors(tree));
      const attrsOf = attrsMaker(colorOf);
      const textureOf = textureMaker(s, model.textures ?? [], specs);
      // each container in millimetres, its tags as classes, its images as textures; a matrix's
      // offset scales, its axes don't
      const node = (n: MeshTreeNode): MeshNode => ({
        parts: n.parts.map((p) => p.faces.map((f) => f.map((v) => v * mm))),
        attrs: n.parts.map(attrsOf),
        classes: n.parts.map((p) => classOf(p.tag)),
        ...(named ? { names: n.parts.map((p) => p.name) } : {}),
        textures: n.parts.map((p) => (p.texture === undefined ? undefined : textureOf(p.texture))),
        uvs: n.parts.map((p) => p.uvs),
        lines: (n.lines ?? []).map((q) => ({ points: q.points.map((v) => v * mm), closed: q.closed, classIndex: classOf(q.tag) })),
        loci: (n.points ?? []).map((q) => ({ at: q.at.map((v) => v * mm), classIndex: classOf(q.tag) })),
        // 2D objects are in millimetres already; a text sized in points takes the layer's scale
        shapes: (n.shapes ?? []).map(({ shape, color, points }) => ({
          shape: points !== undefined && shape.kind === "text" ? { ...shape, height: points * mmPerPt(layerId) } : shape,
          attrs: color ? { ...drawAttrs, penFore: colorOf(color) } : drawAttrs,
        })),
        groups: n.groups.map((g) => ({ ...node(g), name: g.name, ...(g.tag ? { classIndex: classOf(g.tag) } : {}) })),
        instances: n.instances.map((i) => ({
          symbol: i.symbol,
          matrix: i.matrix.map((v, k) => (k >= 9 ? v * mm : v)),
          ...(i.name ? { name: i.name } : {}),
          ...(i.tag ? { classIndex: classOf(i.tag) } : {}),
        })),
      });
      const made = s.addMeshModel(layerId, { symbols: tree.symbols.map((x) => ({ name: x.name, content: node(x.content) })), top: node(tree.top) }, store.activeClassIndex);
      // the group holding the whole import is named after the file, which exports then carry
      nameGroup(s, made.id, base);
      // a tag the file hides hides the class made for it (a class the drawing had keeps its own visibility)
      for (const tag of model.hiddenTags ?? []) {
        const c = classOf.made(tag);
        if (c !== undefined) s.setClassVisibility(c, "hidden");
      }
      textures = textureOf.made();
      return made;
    }),
  );
  if (!r) {
    fileIn(file, file.name, "it could not be added to the drawing");
    return;
  }
  setEditGroup(null, [r.value.id]);
  zoomToSelection(scene, view);
  const { meshes, instances, lines, loci, flat, symbols } = r.value;
  const said = meshes ? [`${meshes.toLocaleString("en")} ${meshes === 1 ? "mesh" : "meshes"}, ${faces.toLocaleString("en")} ${faces === 1 ? "face" : "faces"}`] : [];
  if (lines) said.push(countOf("3D polygon", lines));
  if (loci) said.push(countOf("3D locus", loci));
  if (flat) said.push(countOf("2D object", flat));
  if (symbols.length) said.push(`${countOf("symbol", symbols.length)} placed ${instances.toLocaleString("en")} ${instances === 1 ? "time" : "times"}`);
  if (textures) said.push(countOf("texture", textures));
  const unread = specs.filter((x) => !x).length;
  const skipped = { ...model.skipped };
  if (unread) skipped["texture image the browser couldn't open"] = unread;
  // one the drawing has no template for
  if (loose.shapes > flat) skipped["2D object"] = (skipped["2D object"] ?? 0) + loose.shapes - flat;
  toast(`Imported ${file.name}: ${said.join(", ")}${leftOutOf(skipped)}.`, "info");
  fileIn(file, file.name);
}

/** Every container of a tree, each symbol's once. */
function treeNodes(tree: MeshTree): MeshTreeNode[] {
  const out: MeshTreeNode[] = [];
  const walk = (n: MeshTreeNode): void => {
    out.push(n);
    n.groups.forEach(walk);
  };
  tree.symbols.forEach((x) => walk(x.content));
  walk(tree.top);
  return out;
}

/** the squares a texture's previews are drawn in */
const TEXTURE_PREVIEWS = [
  { width: 256, height: 256 },
  { width: 64, height: 64 },
];

/** Each image as addImageTexture takes it, its width in millimetres, recoloured where it is colorized; null for one the browser can't open. */
async function textureSpecs(textures: readonly MeshTexture[], mm: number): Promise<(ImageTextureSpec | null)[]> {
  return Promise.all(
    textures.map(async (t) => {
      try {
        let bitmap = await createImageBitmap(new Blob([t.image as BlobPart], { type: t.mime }));
        let image = t.image;
        if (t.colorize) {
          image = await colorized(bitmap, t.mime, t.colorize);
          bitmap.close();
          bitmap = await createImageBitmap(new Blob([image as BlobPart], { type: t.mime }));
        }
        const { width, height } = bitmap;
        // the whole image fitted in each square, as the Resources tiles show a texture
        const pngs = previewPngs(TEXTURE_PREVIEWS, (c, w, h) => {
          const g = c.getContext("2d")!;
          g.clearRect(0, 0, w, h);
          const k = Math.min(w / width, h / height);
          g.drawImage(bitmap, (w - width * k) / 2, (h - height * k) / 2, width * k, height * k);
        });
        const color = averageColor(bitmap);
        bitmap.close();
        return { image, mime: t.mime, width, height, size: t.size * mm, color, previews: { large: pngs.get(256)!, small: pngs.get(64)! } };
      } catch {
        return null;
      }
    }),
  );
}

/**
 * An image recoloured as SketchUp colorizes a texture, encoded as it was: each pixel's hue, lightness
 * and saturation moved by the difference between the colour's and the image's average ("shift"), or
 * its hue and saturation the colour's and its lightness moved so ("tint").
 */
async function colorized(bitmap: ImageBitmap, mime: MeshTexture["mime"], how: NonNullable<MeshTexture["colorize"]>): Promise<Uint8Array> {
  const { width, height } = bitmap;
  const c = h("canvas", { attrs: { width: String(width), height: String(height) } });
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0);
  const data = g.getImageData(0, 0, width, height);
  const px = data.data;
  const [th, tl, ts] = hls(...how.color);
  const [ah, al, as] = hls(...averageColor(bitmap));
  for (let i = 0; i < px.length; i += 4) {
    const [ph, pl, ps] = hls(px[i], px[i + 1], px[i + 2]);
    const l = clamp01(pl + tl - al);
    const [r, gg, b] = how.by === "tint" ? rgb(th, l, ts) : rgb(ph + th - ah, l, clamp01(ps + ts - as));
    px[i] = r;
    px[i + 1] = gg;
    px[i + 2] = b;
  }
  g.putImageData(data, 0, 0);
  const blob = await new Promise<Blob | null>((done) => c.toBlob(done, mime, 0.92));
  if (!blob) throw new Error("the recoloured texture couldn't be encoded");
  return new Uint8Array(await blob.arrayBuffer());
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 0..255 channels as hue (0..1, round), lightness and saturation (0..1) */
function hls(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const hi = Math.max(r, g, b);
  const lo = Math.min(r, g, b);
  const l = (hi + lo) / 2;
  const d = hi - lo;
  if (d === 0) return [0, l, 0];
  const s = l > 0.5 ? d / (2 - hi - lo) : d / (hi + lo);
  const hue = hi === r ? (g - b) / d + (g < b ? 6 : 0) : hi === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hue / 6, l, s];
}

/** hls's inverse, the hue taken round */
function rgb(hue: number, l: number, s: number): [number, number, number] {
  hue -= Math.floor(hue);
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    t -= Math.floor(t);
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return [channel(hue + 1 / 3), channel(hue), channel(hue - 1 / 3)];
}

/** An image's average colour, from it drawn 16 pixels across, its see-through pixels counting for less. */
function averageColor(bitmap: ImageBitmap): [number, number, number] {
  const c = h("canvas", { attrs: { width: "16", height: "16" } });
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.imageSmoothingQuality = "high";
  g.drawImage(bitmap, 0, 0, 16, 16);
  const px = g.getImageData(0, 0, 16, 16).data;
  const sum = [0, 0, 0, 0];
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    for (let k = 0; k < 3; k++) sum[k] += px[i + k] * a;
    sum[3] += a;
  }
  return sum[3] ? [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3]] : [128, 128, 128];
}

/**
 * Each image as one of the drawing's textures, made the first time a part shows it and named after
 * the file's material ("Brick 2" where "Brick" is taken); undefined for one that couldn't be made,
 * whose parts keep their colour. `made()` counts those made.
 */
function textureMaker(s: NonNullable<typeof store.session>, textures: readonly MeshTexture[], specs: readonly (ImageTextureSpec | null)[]): ((k: number) => number | undefined) & { made(): number } {
  const done = new Map<number, number | undefined>();
  const taken = new Set([...s.doc.layers().map((l) => l.name), ...s.doc.classes().map((c) => c.name), ...s.doc.resources().map((r) => r.name)]);
  const of = (k: number): number | undefined => {
    if (done.has(k)) return done.get(k);
    const spec = specs[k];
    let index: number | undefined;
    if (spec) {
      const base = textures[k].name.trim() || "Texture";
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      taken.add(name);
      try {
        index = s.addImageTexture(name, spec);
      } catch {
        index = undefined;
      }
    }
    done.set(k, index);
    return index;
  };
  return Object.assign(of, { made: () => [...done.values()].filter((x) => x !== undefined).length });
}

/** A part's attributes: the drawing's own, filled with the part's colour (its index by `colorOf`) where it has one. */
function attrsMaker(colorOf: (c: NonNullable<MeshPart["color"]>) => number): (p: MeshPart) => Partial<Attributes> | undefined {
  const drawAttrs = Object.keys(store.drawAttrs).length > 0 ? store.drawAttrs : undefined;
  return (p) => {
    if (!p.color) return drawAttrs;
    const c = colorOf(p.color);
    return { ...drawAttrs, fillPattern: 1, fillFore: c, fillBack: c, fillOpacity: Math.round(100 * (p.opacity ?? 1)) };
  };
}

/**
 * A tag's class: one of the same name, reused, otherwise made; the active class for no tag, or when
 * the name is taken by a layer, symbol or line type. `made(tag)` is the class made for a tag, if one was.
 */
function tagClasses(s: NonNullable<typeof store.session>): ((tag: string | undefined) => number) & { made(tag: string): number | undefined } {
  const known = new Map<string, number>();
  const made = new Map<string, number>();
  const of = (tag: string | undefined): number => {
    if (!tag) return store.activeClassIndex;
    let index = known.get(tag) ?? s.doc.classes().find((c) => c.name.toLowerCase() === tag.toLowerCase())?.index;
    if (index === undefined) {
      try {
        index = s.createClass(tag);
        made.set(tag, index);
      } catch {
        index = store.activeClassIndex;
      }
    }
    known.set(tag, index);
    return index;
  };
  return Object.assign(of, { made: (tag: string) => made.get(tag) });
}

/** "#rrggbb" for a file's colour (channels 0..1). */
function hex(c: { r: number; g: number; b: number }): string {
  return "#" + [c.r, c.g, c.b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("");
}

/**
 * The colour index for each of a file's colours, exactly: the drawing's colour where it has it,
 * else one added to its colour table (a step of `s`'s batch). Called with every colour the import uses.
 */
function exactColors(s: NonNullable<typeof store.session>, colors: readonly (MeshPart["color"] | undefined)[]): (c: NonNullable<MeshPart["color"]>) => number {
  const css = [...new Set(colors.flatMap((c) => (c ? [hex(c)] : [])))];
  const indices = s.addColors(css);
  return (c) => indices[css.indexOf(hex(c))];
}

/** Every part's and 2D object's colour in a tree, each symbol's once. */
function treeColors(tree: MeshTree): MeshPart["color"][] {
  return treeNodes(tree).flatMap((n) => [...n.parts.map((p) => p.color), ...(n.shapes ?? []).map((sh) => sh.color)]);
}

/** "; left out 3 lines, 1 point" for what a file left out, or "" when nothing was. */
function leftOutOf(skipped: Record<string, number>): string {
  const left = Object.entries(skipped).filter(([, n]) => n > 0);
  return left.length ? `; left out ${left.map(([kind, n]) => countOf(kind, n)).join(", ")}` : "";
}

/** `base`, or `base-2`, `base-3`… when the drawing has a symbol of that name. */
function symbolName(base: string, fallback: string): string {
  const taken = new Set(store.session?.doc.symbolDefs().map((d) => d.name) ?? []);
  const name = base.trim() || fallback;
  let out = name;
  for (let n = 2; taken.has(out); n++) out = `${name}-${n}`;
  return out;
}

/** An OBJ, 3DS, STL or PLY file's units and which way is up; for STL, whether it comes in as a symbol. */
function askUnits(format: Asks): Promise<MeshUnits | null> {
  const unit = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Units" } },
    ...UNITS.map((u, i) => h("option", { value: String(i), text: u.label })),
  );
  unit.value = String(last[format].unit);
  const yUp = h("input", { attrs: { type: "checkbox" }, checked: last[format].yUp });
  const symbol = h("input", { attrs: { type: "checkbox" }, checked: last[format].symbol });
  return showDialog<MeshUnits>({
    title: `Import ${FORMAT_NAME[format]}`,
    okLabel: "Import",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Units" }), unit),
      h("label", { cls: "menu-dialog-check" }, yUp, h("span", { text: "Y axis is up" })),
      ...(format === "stl" ? [h("label", { cls: "menu-dialog-check" }, symbol, h("span", { text: "Import as symbol" }))] : []),
      h("p", {
        cls: "muted",
        text:
          format === "obj"
            ? `Each object or group becomes a mesh on the active layer, at the model's own coordinates; several are grouped. Lines, points, textures and materials are left out (vertex colours are kept); at most ${MAX_FACES.toLocaleString("en")} faces.`
            : format === "stl"
              ? `Each solid becomes a mesh on the active layer, at the model's own coordinates; several are grouped. As a symbol, the definition holds them and an instance at the origin shows them where they were. At most ${MAX_FACES.toLocaleString("en")} faces.`
              : format === "ply"
                ? `The model becomes a mesh on the active layer (one per vertex colour, coloured so), at its own coordinates; several are grouped. A point cloud, with no faces, is left out. At most ${MAX_FACES.toLocaleString("en")} faces.`
                : `Each object becomes a mesh on the active layer (one per material), at the model's own coordinates; several are grouped. Textures are left out (diffuse colours are kept); at most ${MAX_FACES.toLocaleString("en")} faces.`,
      }),
    ],
    check: () => {
      const i = Number(unit.value);
      const asSymbol = format === "stl" && symbol.checked;
      if (asSymbol && !store.session?.canCreateSymbols()) {
        return { error: "This drawing has no symbol to copy settings from yet, so the model can't come in as a symbol.", focus: symbol };
      }
      last[format] = { unit: i, yUp: yUp.checked, symbol: asSymbol };
      return { value: { mm: UNITS[i].mm, yUp: yUp.checked, symbol: asSymbol } };
    },
  });
}

/** the USD settings last used, beyond what the file says */
let lastUsd = { symbol: false, rescale: false, unitsPerMeter: 1, offset: false, upAxis: false, yUp: true };

/** Vectorworks' Import USD Options: as a symbol, re-scaled units per metre, an offset and a redefined up axis, over what `usd` says. */
function askUsd(usd: UsdFile): Promise<MeshUnits | null> {
  const units = store.session?.doc.info.units;
  const check = (label: string, on: boolean): HTMLInputElement => h("input", { attrs: { type: "checkbox", "aria-label": label }, checked: on });
  const input = (label: string, value: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", "aria-label": label, spellcheck: "false" } });
  const fileUnits = Number((1 / usd.metersPerUnit).toPrecision(6));
  const symbol = check("Import as symbol", lastUsd.symbol);
  const rescale = check("Re-scale units per meter", lastUsd.rescale);
  const perMeter = input("Units per meter", String(lastUsd.rescale ? lastUsd.unitsPerMeter : fileUnits));
  const offset = check("Offset imported model", lastUsd.offset);
  const [ox, oy, oz] = ["X", "Y", "Z"].map((a) => input(`Offset ${a}`, formatLength(0, units)));
  const redefine = check("Redefine up axis", lastUsd.upAxis);
  const up = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Up axis" } }, h("option", { value: "Y", text: "Y" }), h("option", { value: "Z", text: "Z" }));
  up.value = (lastUsd.upAxis ? lastUsd.yUp : usd.upAxis === "Y") ? "Y" : "Z";
  const follow = (): void => {
    perMeter.disabled = !rescale.checked;
    for (const o of [ox, oy, oz]) o.disabled = !offset.checked;
    up.disabled = !redefine.checked;
  };
  for (const c of [rescale, offset, redefine]) c.addEventListener("change", follow);
  follow();
  const row = (box: HTMLInputElement, label: string): HTMLElement => h("label", { cls: "menu-dialog-check" }, box, h("span", { text: label }));
  const field = (label: string, control: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
  return showDialog<MeshUnits>({
    title: "Import USD",
    okLabel: "Import",
    body: [
      row(symbol, "Import as symbol"),
      row(rescale, "Re-scale units per meter"),
      field("Units per meter", perMeter),
      row(offset, "Offset imported model"),
      field("X", ox),
      field("Y", oy),
      field("Z", oz),
      row(redefine, "Redefine up axis"),
      field("Up axis", up),
      h("p", {
        cls: "muted",
        text: `The file says ${fileUnits} units per metre, ${usd.upAxis} up. Each mesh comes in on the active layer and class, grouped by the prims that hold them; diffuse colours are kept, textures left out. At most ${MAX_FACES.toLocaleString("en")} faces.`,
      }),
    ],
    check: () => {
      const per = rescale.checked ? Number(perMeter.value.trim()) : fileUnits;
      if (!(per > 0) || !Number.isFinite(per)) return { error: "Enter the units per meter, a number above 0.", focus: perMeter };
      const at: number[] = [];
      for (const o of [ox, oy, oz]) {
        const v = offset.checked ? parseLength(o.value, units) : 0;
        if (v === null) return { error: "Enter the offset as lengths.", focus: o };
        at.push(v);
      }
      if (symbol.checked && !store.session?.canCreateSymbols()) {
        return { error: "This drawing has no symbol to copy settings from yet, so the model can't come in as a symbol.", focus: symbol };
      }
      const yUp = redefine.checked ? up.value === "Y" : usd.upAxis === "Y";
      lastUsd = { symbol: symbol.checked, rescale: rescale.checked, unitsPerMeter: per, offset: offset.checked, upAxis: redefine.checked, yUp };
      return { value: { mm: 1000 / per, yUp, symbol: symbol.checked, offset: [at[0], at[1], at[2]] } };
    },
  });
}
