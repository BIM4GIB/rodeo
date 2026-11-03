// The 3D model (the meshes the 3D view shows) as OBJ text or a binary glTF (.glb). Both are
// written y-up in metres, as their readers expect: the drawing's millimetres, z-up, become
// x, z, -y over 1000. Each object is its own named mesh under its layer; colours and opacity
// carry over (OBJ as vertex colours, glTF as materials), textures and edges do not.

import type { Mesh3D, VwxDocument } from "../core/types.ts";

const M_PER_MM = 0.001;

/**
 * The formats File > Export writes the 3D model in: OBJ and glTF here, IFC in export/ifc.ts, 3DS in
 * export/threeds.ts, Rhino 3DM in export/rhino.ts, FBX in export/fbx.ts, Collada in
 * export/collada.ts, PLY in export/ply.ts and SketchUp in export/skp.ts (STEP and IGES, which ask first, in export/step.ts and export/iges.ts).
 */
export type ModelFormat = "obj" | "glb" | "ifc" | "3ds" | "3dm" | "fbx" | "dae" | "ply" | "skp";
export const MODEL_FORMAT_NAMES: Record<ModelFormat, string> = {
  obj: "OBJ",
  glb: "glTF",
  ifc: "IFC",
  "3ds": "3DS",
  "3dm": "Rhino 3DM",
  fbx: "FBX",
  dae: "Collada",
  ply: "PLY",
  skp: "SketchUp",
};

/** The meshes of `layerIds`, with any shaded faces, in model order. */
function meshesOf(doc: VwxDocument, layerIds: ReadonlySet<string>): Mesh3D[] {
  return doc.model3d().filter((m) => layerIds.has(m.layerId) && m.triangles.length >= 9);
}

/** A name readers accept: the object's own, else its kind, with an id tail so each stays unique. */
function meshName(doc: VwxDocument, m: Mesh3D): string {
  const o = doc.object(m.objectId);
  const base = (o?.name || o?.typeName || "Object").replace(/\s+/g, "_");
  return `${base}_${m.objectId.slice(0, 8)}`;
}

function layerName(doc: VwxDocument, id: string): string {
  return (doc.layers().find((l) => l.id === id)?.name || "Layer").replace(/\s+/g, "_");
}

/** "#rrggbb" as three 0..1 channels. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const num = (v: number): string => (Math.abs(v) < 5e-10 ? "0" : String(Math.round(v * 1e6) / 1e6));

/**
 * OBJ text: a `g` per layer and an `o` per object, vertices shared within an object, each with its
 * object's colour after the position (the "v x y z r g b" form Blender and MeshLab read).
 */
export function exportObj(doc: VwxDocument, layerIds: ReadonlySet<string>): string {
  const out: string[] = ["# Rodeo 3D model", "# units: metres, y up", ""];
  let base = 1;
  let layer = "";
  for (const m of meshesOf(doc, layerIds)) {
    if (m.layerId !== layer) {
      layer = m.layerId;
      out.push(`g ${layerName(doc, layer)}`);
    }
    out.push(`o ${meshName(doc, m)}`);
    const [r, g, b] = rgb(m.color);
    const colour = `${num(r)} ${num(g)} ${num(b)}`;
    const index = new Map<string, number>();
    const faces: string[] = [];
    const t = m.triangles;
    for (let i = 0; i < t.length; i += 9) {
      const corner: number[] = [];
      for (let k = 0; k < 9; k += 3) {
        const v = `${num(t[i + k] * M_PER_MM)} ${num(t[i + k + 2] * M_PER_MM)} ${num(-t[i + k + 1] * M_PER_MM)}`;
        let at = index.get(v);
        if (at === undefined) {
          at = base + index.size;
          index.set(v, at);
          out.push(`v ${v} ${colour}`);
        }
        corner.push(at);
      }
      // a triangle squashed to a line or point by the rounding draws nothing
      if (corner[0] !== corner[1] && corner[1] !== corner[2] && corner[0] !== corner[2]) faces.push(`f ${corner.join(" ")}`);
    }
    base += index.size;
    out.push(...faces);
  }
  out.push("");
  return out.join("\n");
}

/** A binary glTF: a node per layer holding a mesh per object, one material per colour and opacity. */
export async function exportGlb(doc: VwxDocument, layerIds: ReadonlySet<string>): Promise<ArrayBuffer> {
  // three and its exporter load only when a model is exported
  const THREE = await import("three");
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const scene = new THREE.Scene();
  const layers = new Map<string, InstanceType<typeof THREE.Group>>();
  const materials = new Map<string, InstanceType<typeof THREE.MeshStandardMaterial>>();
  for (const m of meshesOf(doc, layerIds)) {
    let group = layers.get(m.layerId);
    if (!group) {
      group = new THREE.Group();
      group.name = layerName(doc, m.layerId);
      layers.set(m.layerId, group);
      scene.add(group);
    }
    const key = `${m.color}/${m.opacity}`;
    let material = materials.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(m.color),
        opacity: m.opacity,
        transparent: m.opacity < 1,
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
      materials.set(key, material);
    }
    const t = m.triangles;
    const positions = new Float32Array(t.length);
    for (let i = 0; i < t.length; i += 3) {
      positions[i] = t[i] * M_PER_MM;
      positions[i + 1] = t[i + 2] * M_PER_MM;
      positions[i + 2] = -t[i + 1] * M_PER_MM;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = meshName(doc, m);
    group.add(mesh);
  }
  try {
    const result = await new GLTFExporter().parseAsync(scene, { binary: true });
    if (!(result instanceof ArrayBuffer)) throw new Error("the glTF exporter gave no binary");
    return result;
  } finally {
    for (const mesh of scene.getObjectsByProperty("type", "Mesh")) (mesh as InstanceType<typeof THREE.Mesh>).geometry.dispose();
    for (const material of materials.values()) material.dispose();
  }
}
