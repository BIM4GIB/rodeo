// The 3D model as Collada 1.4.1 (.dae), the XML 3D format SketchUp reads and writes, so a drawing's
// model opens there. Coordinates are written in metres with z up (the file says unit meter="1" and
// up_axis Z_UP), the drawing's millimetres divided by 1000: Blender's importer ignores <unit> unless
// told otherwise and takes metres, and SketchUp reads <unit>, so both bring the model in at its size.
// Each object is one geometry of its positions, shared within the object, with one triangles element
// per piece; a material (lambert, its diffuse colour, and a transparency when the piece is see-through)
// is made per distinct colour and opacity. The layers are
// the top-level nodes of the one visual scene, each holding its objects as instance_geometry nodes,
// and the objects in groups inside a node for each group. Each symbol is a node in library_nodes
// holding its objects as a layer's node does, and each instance a node placing it with instance_node
// through its matrix, as SketchUp writes a component. (Blender 4's importer leaves the nodes inside a
// library node at the instancing node's origin, as it does SketchUp's nested components; Blender
// reads the FBX export's instances right.)
// Textures, edges and normals are left out. It is read back by import/collada.ts.

import type { Model3D, ModelObject } from "./scene3d.ts";

const HEADER = '<?xml version="1.0" encoding="utf-8"?>\n';

/** A group's node while it is filled: the object nodes and groups in it, in order. */
interface GroupNode {
  name: string;
  nodes: (string | GroupNode)[];
}

/** A number as Collada text, rounded to a billionth of a metre (a millionth of a millimetre), so equal positions compare equal. */
function fmt(v: number): string {
  return Number.isFinite(v) ? String(Number(v.toFixed(9))) : "0";
}

/** "#rrggbb" as three 0..1 channels; grey when it does not read. */
function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Text or an attribute value with the markup characters escaped and the characters XML cannot hold dropped. */
function esc(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The model as a Collada 1.4.1 document: the effects and materials, one per distinct colour and
 * opacity; a geometry per object; a library node per symbol; and the visual scene, one node per layer
 * holding a node per object. `now` dates the file's asset.
 */
export function exportCollada(model: Model3D, now = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const effects: string[] = [];
  const materials: string[] = [];
  const geometries: string[] = [];
  const layerNodes: string[] = [];
  // material number by "colour/opacity"
  const made = new Map<string, number>();
  const material = (hex: string, opacity: number): number => {
    const key = `${hex.toLowerCase().slice(0, 7)}/${fmt(opacity)}`;
    const known = made.get(key);
    if (known !== undefined) return known;
    const k = made.size + 1;
    made.set(key, k);
    const [r, g, b] = rgbOf(hex);
    const see =
      opacity < 1
        ? `<transparent opaque="A_ONE"><color>1 1 1 ${fmt(opacity)}</color></transparent><transparency><float>1</float></transparency>`
        : "";
    effects.push(
      `<effect id="fx${k}"><profile_COMMON><technique sid="common"><lambert>` +
        `<diffuse><color>${fmt(r)} ${fmt(g)} ${fmt(b)} 1</color></diffuse>${see}</lambert></technique></profile_COMMON></effect>`,
    );
    const label = `${hex.toLowerCase().slice(0, 7)}${opacity < 1 ? ` ${fmt(opacity * 100)}%` : ""}`;
    materials.push(`<material id="mat${k}" name="${esc(label)}"><instance_effect url="#fx${k}"/></material>`);
    return k;
  };

  let geometryCount = 0;
  let nodeCount = 0;
  // an object's node: its geometry placed, or the symbol it places through its matrix; "" when it has no faces
  const objectNode = (obj: ModelObject): string => {
    if (obj.instance) {
      const m = obj.instance.matrix;
      // the axes' images as columns, the offset in metres
      const rows = [0, 1, 2].map((r) => `${fmt(m[r])} ${fmt(m[3 + r])} ${fmt(m[6 + r])} ${fmt(m[9 + r] / 1000)}`);
      return (
        `<node id="node${++nodeCount}" name="${esc(obj.name)}"><matrix sid="transform">${rows.join(" ")} 0 0 0 1</matrix>` +
        `<instance_node url="#symbol${obj.instance.symbol + 1}"/></node>`
      );
    }
    const pieces = obj.pieces.filter((p) => p.triangles.length >= 9);
    if (!pieces.length) return "";
    const gid = ++geometryCount;
    // the object's distinct positions, each once, and the triangles of each piece as their indices
    const index = new Map<string, number>();
    const coords: string[] = [];
    const bindings: string[] = [];
    const bound = new Set<number>();
    const triangles: string[] = [];
    for (const piece of pieces) {
      const k = material(piece.color, piece.opacity);
      const symbol = `M${k}`;
      if (!bound.has(k)) {
        bound.add(k);
        bindings.push(`<instance_material symbol="${symbol}" target="#mat${k}"/>`);
      }
      const t = piece.triangles;
      const corners: number[] = [];
      for (let i = 0; i + 2 < t.length; i += 3) {
        // millimetres to metres
        const key = `${fmt(t[i] / 1000)} ${fmt(t[i + 1] / 1000)} ${fmt(t[i + 2] / 1000)}`;
        let at = index.get(key);
        if (at === undefined) {
          at = index.size;
          index.set(key, at);
          coords.push(key);
        }
        corners.push(at);
      }
      triangles.push(
        `<triangles material="${symbol}" count="${corners.length / 3}">` +
          `<input semantic="VERTEX" source="#geom${gid}-vertices" offset="0"/><p>${corners.join(" ")}</p></triangles>`,
      );
    }
    const n = index.size;
    geometries.push(
      `<geometry id="geom${gid}" name="${esc(obj.name)}"><mesh>` +
        `<source id="geom${gid}-positions"><float_array id="geom${gid}-positions-array" count="${3 * n}">${coords.join(" ")}</float_array>` +
        `<technique_common><accessor source="#geom${gid}-positions-array" count="${n}" stride="3">` +
        `<param name="X" type="float"/><param name="Y" type="float"/><param name="Z" type="float"/></accessor></technique_common></source>` +
        `<vertices id="geom${gid}-vertices"><input semantic="POSITION" source="#geom${gid}-positions"/></vertices>` +
        `${triangles.join("")}</mesh></geometry>`,
    );
    return (
      `<node id="node${++nodeCount}" name="${esc(obj.name)}"><instance_geometry url="#geom${gid}"><bind_material><technique_common>` +
      `${bindings.join("")}</technique_common></bind_material></instance_geometry></node>`
    );
  };
  // objects, and the groups holding some, in their order, as the nodes inside a layer's or symbol's
  const nodesOf = (objects: readonly ModelObject[]): string => {
    const root: GroupNode = { name: "", nodes: [] };
    const groupNodes = new Map<string, GroupNode>();
    for (const obj of objects) {
      const node = objectNode(obj);
      if (!node) continue;
      let into = root;
      for (const g of obj.groups ?? []) {
        let group = groupNodes.get(g.id);
        if (!group) {
          group = { name: g.name, nodes: [] };
          groupNodes.set(g.id, group);
          into.nodes.push(group);
        }
        into = group;
      }
      into.nodes.push(node);
    }
    const inside = (g: GroupNode): string =>
      g.nodes.map((n) => (typeof n === "string" ? n : `<node id="node${++nodeCount}" name="${esc(n.name)}">${inside(n)}</node>`)).join("");
    return inside(root);
  };
  const symbolNodes = (model.symbols ?? []).map((sym, k) => `<node id="symbol${k + 1}" name="${esc(sym.name)}">${nodesOf(sym.objects)}</node>`);
  model.layers.forEach((layer, li) => {
    layerNodes.push(`<node id="layer${li + 1}" name="${esc(layer.name)}">${nodesOf(layer.objects)}</node>`);
  });

  return [
    `${HEADER}<COLLADA xmlns="http://www.collada.org/2005/11/COLLADASchema" version="1.4.1">`,
    `<asset><contributor><authoring_tool>Rodeo</authoring_tool></contributor><created>${stamp}</created><modified>${stamp}</modified>` +
      `<unit meter="1" name="meter"/><up_axis>Z_UP</up_axis></asset>`,
    `<library_effects>${effects.join("")}</library_effects>`,
    `<library_materials>${materials.join("")}</library_materials>`,
    `<library_geometries>${geometries.join("")}</library_geometries>`,
    ...(symbolNodes.length ? [`<library_nodes>${symbolNodes.join("")}</library_nodes>`] : []),
    `<library_visual_scenes><visual_scene id="Scene" name="Scene">${layerNodes.join("")}</visual_scene></library_visual_scenes>`,
    `<scene><instance_visual_scene url="#Scene"/></scene>`,
    `</COLLADA>`,
    ``,
  ].join("\n");
}
