// The formats the converter reads and writes, in one table. It is the source for formats(), the
// command line's formats listing and the converter page's format menu. PNG is not in it: the page
// makes PNG from the SVG on its own, since the core has no rasteriser.

import type { FormatInfo } from "./types.ts";

/** Every format the converter knows, in the order the lists show them. */
export const FORMATS: readonly FormatInfo[] = [
  { id: "vwx", name: "Vectorworks", long: "Vectorworks drawing", readExtensions: ["vwx", "sta"], writeExtensions: ["vwx"], kind: "drawing", mime: "application/octet-stream" },
  { id: "dwg", name: "DWG", long: "AutoCAD DWG", readExtensions: ["dwg"], writeExtensions: [], kind: "2d", mime: "image/vnd.dwg" },
  { id: "dxf", name: "DXF", long: "AutoCAD DXF", readExtensions: ["dxf"], writeExtensions: ["dxf"], kind: "2d", mime: "application/dxf" },
  { id: "pdf", name: "PDF", long: "PDF", readExtensions: ["pdf"], writeExtensions: ["pdf"], kind: "2d", mime: "application/pdf" },
  { id: "svg", name: "SVG", long: "SVG image", readExtensions: [], writeExtensions: ["svg"], kind: "2d", mime: "image/svg+xml" },
  { id: "eps", name: "EPS", long: "Encapsulated PostScript", readExtensions: [], writeExtensions: ["eps"], kind: "2d", mime: "application/postscript" },
  { id: "emf", name: "EMF", long: "Windows metafile", readExtensions: ["emf"], writeExtensions: ["emf"], kind: "2d", mime: "image/emf" },
  { id: "rvt", name: "Revit", long: "Revit project", readExtensions: ["rvt"], writeExtensions: [], kind: "3d", mime: "application/octet-stream" },
  { id: "pln", name: "Archicad", long: "Archicad project", readExtensions: ["pln", "pla", "tpl"], writeExtensions: [], kind: "3d", mime: "application/octet-stream" },
  { id: "ifc", name: "IFC", long: "IFC (BIM)", readExtensions: ["ifc"], writeExtensions: ["ifc"], kind: "3d", mime: "application/x-step" },
  { id: "skp", name: "SketchUp", long: "SketchUp model", readExtensions: ["skp"], writeExtensions: ["skp"], kind: "3d", mime: "application/vnd.sketchup.skp" },
  { id: "3dm", name: "Rhino", long: "Rhino 3DM", readExtensions: ["3dm"], writeExtensions: ["3dm"], kind: "3d", mime: "model/vnd.3dm" },
  { id: "glb", name: "glTF", long: "glTF binary", readExtensions: ["glb", "gltf"], writeExtensions: ["glb"], kind: "3d", mime: "model/gltf-binary" },
  { id: "obj", name: "OBJ", long: "Wavefront OBJ", readExtensions: ["obj"], writeExtensions: ["obj"], kind: "3d", mime: "model/obj" },
  { id: "fbx", name: "FBX", long: "Autodesk FBX", readExtensions: ["fbx"], writeExtensions: ["fbx"], kind: "3d", mime: "application/octet-stream" },
  { id: "dae", name: "Collada", long: "Collada", readExtensions: ["dae", "kmz"], writeExtensions: ["dae"], kind: "3d", mime: "model/vnd.collada+xml" },
  { id: "stl", name: "STL", long: "STL (3D printing)", readExtensions: ["stl"], writeExtensions: ["stl"], kind: "3d", mime: "model/stl" },
  { id: "ply", name: "PLY", long: "PLY polygon file", readExtensions: ["ply"], writeExtensions: ["ply"], kind: "3d", mime: "application/octet-stream" },
  { id: "3ds", name: "3DS", long: "3D Studio", readExtensions: ["3ds"], writeExtensions: ["3ds"], kind: "3d", mime: "application/x-3ds" },
  { id: "usdz", name: "USD", long: "Universal Scene Description", readExtensions: ["usdz", "usd", "usda", "usdc"], writeExtensions: ["usdz"], kind: "3d", mime: "model/vnd.usdz+zip" },
  { id: "blend", name: "Blender", long: "Blender file", readExtensions: ["blend"], writeExtensions: [], kind: "3d", mime: "application/octet-stream" },
  { id: "step", name: "STEP", long: "STEP (AP214)", readExtensions: ["stp", "step"], writeExtensions: ["stp", "step"], kind: "3d", mime: "model/step" },
  { id: "iges", name: "IGES", long: "IGES", readExtensions: ["igs", "iges"], writeExtensions: ["igs", "iges"], kind: "3d", mime: "model/iges" },
  { id: "cad", name: "CAD", long: "CAD part (SolidWorks, Inventor, FreeCAD, Fusion 360, NX or Creo)", readExtensions: ["sldprt", "ipt", "fcstd", "f3d", "prt"], writeExtensions: [], kind: "3d", mime: "application/octet-stream" },
];

/** The ids of the formats that can be read and written, in table order. */
export function formats(): { read: string[]; write: string[] } {
  return {
    read: FORMATS.filter((f) => f.readExtensions.length > 0).map((f) => f.id),
    write: FORMATS.filter((f) => f.writeExtensions.length > 0).map((f) => f.id),
  };
}

/** Every format in the table, in its order. */
export function formatInfo(): readonly FormatInfo[] {
  return FORMATS;
}

/** The format with this id, or undefined. */
export function formatById(id: string): FormatInfo | undefined {
  return FORMATS.find((f) => f.id === id);
}

/** The id of the format a file name is read as, from its extension (any case), or null. A Blender backup (.blend1) is Blender. */
export function formatOfName(name: string): string | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  if (/^blend\d+$/.test(ext)) return "blend";
  return FORMATS.find((f) => f.readExtensions.includes(ext))?.id ?? null;
}

/**
 * The id of the format written for `what`: an id ("step"), an extension with or without its dot
 * ("stp", ".stp") or a file name ("out.stp"), in any case. Null for anything Rodeo doesn't write.
 */
export function outputFormat(what: string): string | null {
  const s = what.trim().toLowerCase();
  const writable = FORMATS.filter((f) => f.writeExtensions.length > 0);
  const byId = writable.find((f) => f.id === s);
  if (byId) return byId.id;
  const ext = s.slice(s.lastIndexOf(".") + 1);
  return writable.find((f) => f.writeExtensions.includes(ext))?.id ?? null;
}
