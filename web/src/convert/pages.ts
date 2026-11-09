// The converter's pages (rodeo.build/convert and /convert/<from>-to-<to>): the formats they name,
// the pairs of formats that have a page, and the words each page shows. It has no imports, because
// the server reads it too (server/src/convertPage.ts) and Node runs it as it is.

/** A format as the converter's pages describe it. */
export interface PageFormat {
  readonly id: string;
  /** the name in the headline, upper case */
  readonly short: string;
  /** the name in the description and the formats table */
  readonly long: string;
  /** the extensions the page names; the first one is the usual one */
  readonly extensions: readonly string[];
  readonly read: boolean;
  readonly write: boolean;
  /** what Rodeo reads in this format, one or two sentences; empty when it doesn't read it */
  readonly reads: string;
  /** what Rodeo writes in this format, one or two sentences; empty when it doesn't write it */
  readonly writes: string;
}

/** One converter page: its address, its text, and the pages it links to. */
export interface ConvertPage {
  readonly path: string;
  readonly title: string;
  readonly description: string;
  readonly h1: string;
  readonly intro: string;
  /** the input format's id, or null on the index page */
  readonly from: string | null;
  /** the output format's id, or null on the index page */
  readonly to: string | null;
  /** pages to link to, as [from, to] pairs */
  readonly links: readonly (readonly [string, string])[];
}

/** Every format a page can name, with what Rodeo reads and writes in it. The read and write flags match web/src/convert/formats.ts. */
export const PAGE_FORMATS: readonly PageFormat[] = [
  {
    id: "vwx",
    short: "VWX",
    long: "Vectorworks",
    extensions: ["vwx", "sta"],
    read: true,
    write: true,
    reads: "Rodeo opens Vectorworks files natively: layers, classes, symbols, records and 3D objects.",
    writes: "A Vectorworks .vwx drawing with its layers, classes and 3D objects.",
  },
  {
    id: "dwg",
    short: "DWG",
    long: "AutoCAD DWG",
    extensions: ["dwg"],
    read: true,
    write: false,
    reads: "Rodeo reads AutoCAD DWG files from R13 to 2018 and later: lines, arcs, polylines, text, hatches and blocks, each AutoCAD layer becoming a class, with colours and line weights.",
    writes: "",
  },
  {
    id: "dxf",
    short: "DXF",
    long: "DXF",
    extensions: ["dxf"],
    read: true,
    write: true,
    reads: "Rodeo reads DXF files: lines, arcs, polylines, splines, text, hatches and blocks, each layer becoming a class, with colours and line weights.",
    writes: "A DXF file in millimetres that AutoCAD, BricsCAD, LibreCAD and most CAD apps open.",
  },
  {
    id: "pdf",
    short: "PDF",
    long: "PDF",
    extensions: ["pdf"],
    read: true,
    write: true,
    reads: "Rodeo reads a PDF page's vector line work, fills and text; pictures, shadings and clipping are left out.",
    writes: "A vector PDF, a page per layer at its scale.",
  },
  {
    id: "svg",
    short: "SVG",
    long: "SVG",
    extensions: ["svg"],
    read: false,
    write: true,
    reads: "",
    writes: "An SVG of the plan in millimetres, for the web and illustration apps.",
  },
  {
    id: "eps",
    short: "EPS",
    long: "EPS",
    extensions: ["eps"],
    read: false,
    write: true,
    reads: "",
    writes: "An EPS of the plan for print and illustration apps; pictures are left out.",
  },
  {
    id: "emf",
    short: "EMF",
    long: "EMF",
    extensions: ["emf"],
    read: true,
    write: true,
    reads: "Rodeo reads a Windows metafile's line work, fills and text.",
    writes: "A Windows metafile of the plan, for Office documents.",
  },
  {
    id: "rvt",
    short: "RVT",
    long: "Revit",
    extensions: ["rvt"],
    read: true,
    write: false,
    reads: "Rodeo reads a Revit project's levels, walls, floors, doors, windows and other elements with their parameters, with the open-source rvt-rs reader.",
    writes: "",
  },
  {
    id: "pln",
    short: "PLN",
    long: "Archicad",
    extensions: ["pln", "pla", "tpl"],
    read: true,
    write: false,
    reads: "Rodeo reads Archicad 17 and later projects: stories, walls, slabs, doors, windows, objects and drafting.",
    writes: "",
  },
  {
    id: "ifc",
    short: "IFC",
    long: "IFC",
    extensions: ["ifc"],
    read: true,
    write: true,
    reads: "Rodeo reads IFC models: each element a mesh named after it, grouped by building storey.",
    writes: "An IFC4 model: each object a wall, slab, door, window or other element on its storey, with its records as property sets.",
  },
  {
    id: "skp",
    short: "SKP",
    long: "SketchUp",
    extensions: ["skp"],
    read: true,
    write: true,
    reads: "Rodeo reads SketchUp models: components as symbols, groups, tags, colours and lines.",
    writes: "A SketchUp model that every SketchUp since 2013 opens, symbols as components and classes as tags.",
  },
  {
    id: "3dm",
    short: "3DM",
    long: "Rhino",
    extensions: ["3dm"],
    read: true,
    write: true,
    reads: "Rodeo reads Rhino files: meshes and surfaces, blocks as symbols, layers, curves and text.",
    writes: "A Rhino file in millimetres with layers, blocks, meshes and 2D linework.",
  },
  {
    id: "glb",
    short: "GLB",
    long: "glTF",
    extensions: ["glb", "gltf"],
    read: true,
    write: true,
    reads: "Rodeo reads glTF and GLB models with their colours, in metres.",
    writes: "A binary glTF in metres: each object a named mesh under its layer, with its colours.",
  },
  {
    id: "obj",
    short: "OBJ",
    long: "OBJ",
    extensions: ["obj"],
    read: true,
    write: true,
    reads: "Rodeo reads OBJ meshes with their vertex colours; you choose the units and the up axis.",
    writes: "An OBJ in metres with vertex colours, an object per mesh.",
  },
  {
    id: "fbx",
    short: "FBX",
    long: "FBX",
    extensions: ["fbx"],
    read: true,
    write: true,
    reads: "Rodeo reads FBX models, shared geometry as symbols.",
    writes: "A binary FBX that Blender, 3ds Max, Maya, Unity and Unreal open.",
  },
  {
    id: "dae",
    short: "DAE",
    long: "Collada",
    extensions: ["dae", "kmz"],
    read: true,
    write: true,
    reads: "Rodeo reads Collada (.dae) and Google Earth (.kmz) models, instanced nodes as symbols.",
    writes: "A Collada model in metres that SketchUp and Blender open.",
  },
  {
    id: "stl",
    short: "STL",
    long: "STL",
    extensions: ["stl"],
    read: true,
    write: true,
    reads: "Rodeo reads binary and text STL, in millimetres unless you choose other units.",
    writes: "A binary STL in millimetres, ready for a slicer.",
  },
  {
    id: "ply",
    short: "PLY",
    long: "PLY",
    extensions: ["ply"],
    read: true,
    write: true,
    reads: "Rodeo reads PLY meshes with their vertex colours.",
    writes: "A binary PLY in metres with vertex colours.",
  },
  {
    id: "3ds",
    short: "3DS",
    long: "3D Studio",
    extensions: ["3ds"],
    read: true,
    write: true,
    reads: "Rodeo reads 3D Studio meshes with their material colours.",
    writes: "A 3D Studio file for older renderers.",
  },
  {
    id: "usdz",
    short: "USDZ",
    long: "USD",
    extensions: ["usdz", "usd", "usda", "usdc"],
    read: true,
    write: true,
    reads: "Rodeo reads USD, USDA, USDC and USDZ scenes in the units and up axis they say.",
    writes: "A USDZ scene in metres with its materials, for AR Quick Look and USD apps.",
  },
  {
    id: "blend",
    short: "BLEND",
    long: "Blender",
    extensions: ["blend"],
    read: true,
    write: false,
    reads: "Rodeo reads Blender files' meshes, grouped by collection.",
    writes: "",
  },
  {
    id: "step",
    short: "STEP",
    long: "STEP",
    extensions: ["stp", "step"],
    read: true,
    write: true,
    reads: "Rodeo reads STEP files' parts, grouped as their assemblies group them, each in the colour its faces have.",
    writes: "A STEP file of planar solids for mechanical CAD such as SolidWorks and Fusion.",
  },
  {
    id: "iges",
    short: "IGES",
    long: "IGES",
    extensions: ["igs", "iges"],
    read: true,
    write: true,
    reads: "Rodeo reads IGES files' parts, each in the colour its faces have.",
    writes: "An IGES file of planar surfaces.",
  },
  {
    id: "png",
    short: "PNG",
    long: "PNG",
    extensions: ["png"],
    read: false,
    write: true,
    reads: "",
    writes: "A PNG picture of the plan, 3,000 pixels across.",
  },
];

/** The converter's pairs, in the order their pages are listed. Each is [from, to], and every one has a page. */
export const PAIRS: readonly (readonly [string, string])[] = [
  ["rvt", "ifc"],
  ["rvt", "pdf"],
  ["rvt", "dxf"],
  ["rvt", "skp"],
  ["rvt", "obj"],
  ["rvt", "glb"],
  ["rvt", "fbx"],
  ["rvt", "stl"],
  ["rvt", "3dm"],
  ["rvt", "vwx"],
  ["dwg", "pdf"],
  ["dwg", "dxf"],
  ["dwg", "svg"],
  ["dwg", "vwx"],
  ["dxf", "pdf"],
  ["dxf", "svg"],
  ["dxf", "vwx"],
  ["skp", "obj"],
  ["skp", "glb"],
  ["skp", "fbx"],
  ["skp", "stl"],
  ["skp", "ifc"],
  ["skp", "dae"],
  ["skp", "3dm"],
  ["skp", "vwx"],
  ["ifc", "obj"],
  ["ifc", "glb"],
  ["ifc", "stl"],
  ["ifc", "skp"],
  ["ifc", "fbx"],
  ["ifc", "3dm"],
  ["ifc", "dae"],
  ["ifc", "vwx"],
  ["3dm", "obj"],
  ["3dm", "stl"],
  ["3dm", "glb"],
  ["3dm", "skp"],
  ["3dm", "ifc"],
  ["3dm", "fbx"],
  ["3dm", "dae"],
  ["pln", "ifc"],
  ["pln", "obj"],
  ["pln", "skp"],
  ["pln", "pdf"],
  ["pln", "glb"],
  ["pln", "vwx"],
  ["vwx", "pdf"],
  ["vwx", "dxf"],
  ["vwx", "ifc"],
  ["vwx", "svg"],
  ["vwx", "skp"],
  ["vwx", "obj"],
  ["vwx", "glb"],
  ["fbx", "obj"],
  ["fbx", "glb"],
  ["fbx", "stl"],
  ["fbx", "skp"],
  ["obj", "stl"],
  ["obj", "glb"],
  ["obj", "fbx"],
  ["obj", "skp"],
  ["obj", "3dm"],
  ["obj", "step"],
  ["stl", "obj"],
  ["stl", "glb"],
  ["stl", "step"],
  ["stl", "3dm"],
  ["glb", "obj"],
  ["glb", "stl"],
  ["glb", "fbx"],
  ["glb", "skp"],
  ["dae", "obj"],
  ["dae", "glb"],
  ["dae", "stl"],
  ["dae", "skp"],
  ["blend", "obj"],
  ["blend", "glb"],
  ["blend", "stl"],
  ["blend", "fbx"],
  ["step", "obj"],
  ["step", "glb"],
  ["step", "stl"],
  ["step", "ifc"],
  ["iges", "obj"],
  ["iges", "glb"],
  ["iges", "stl"],
  ["usdz", "obj"],
  ["usdz", "glb"],
  ["usdz", "stl"],
  ["pdf", "dxf"],
  ["pdf", "svg"],
  ["pdf", "vwx"],
];

/** The page's format with this id, or undefined. */
export function pageFormat(id: string): PageFormat | undefined {
  return PAGE_FORMATS.find((f) => f.id === id);
}

/** The address part of a pair's page: "rvt-to-ifc". */
export function pairSlug(from: string, to: string): string {
  return `${from}-to-${to}`;
}

/** The index page at /convert when `slug` is null, a pair's page for its slug, and null for anything else (including a slug that isn't lower case). */
export function convertPage(slug: string | null): ConvertPage | null {
  if (slug === null) {
    return {
      path: "/convert",
      title: "Convert CAD files online, free and private | Rodeo",
      description:
        "Convert Revit, DWG, SketchUp, IFC, Rhino, Archicad and Vectorworks files to IFC, PDF, DXF, glTF, OBJ, STL and more, free in your browser. Nothing is uploaded.",
      h1: "Convert CAD and 3D files",
      intro:
        "Drop Revit, AutoCAD, SketchUp, Rhino, Archicad, IFC or Vectorworks files here and download IFC, PDF, DXF, glTF, OBJ, STL, SketchUp and more. Rodeo converts them in your browser, so your files never leave your computer.",
      from: null,
      to: null,
      links: PAIRS,
    };
  }

  const pair = PAIRS.find(([a, b]) => pairSlug(a, b) === slug);
  if (!pair) return null;
  const [fromId, toId] = pair;
  const from = pageFormat(fromId);
  const to = pageFormat(toId);
  if (!from || !to) return null;

  // the other pairs from the same input, then the ones into the same output: twelve at most
  const sameFrom = PAIRS.filter(([a, b]) => a === fromId && b !== toId);
  const sameTo = PAIRS.filter(([a, b]) => b === toId && a !== fromId);

  return {
    path: `/convert/${pairSlug(fromId, toId)}`,
    title: `Convert ${from.short} to ${to.short} online, free | Rodeo`,
    description: `Convert ${from.long} (.${from.extensions[0]}) files to ${to.long} (.${to.extensions[0]}) in your browser. Free, no sign-up, and nothing is uploaded.`,
    h1: `Convert ${from.short} to ${to.short}`,
    intro: `${from.reads} ${to.writes} Your file never leaves your computer.`,
    from: fromId,
    to: toId,
    links: [...sameFrom, ...sameTo].slice(0, 12),
  };
}
