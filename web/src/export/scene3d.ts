// The drawing as the 3D exchange writers (export/fbx.ts, collada.ts, ply.ts and rhino.ts) take it:
// design layers holding objects, each object its pieces of one colour and opacity, in the drawing's
// millimetres with z up, as the 3D view shows them. Writers that place blocks (Rhino, Collada, FBX)
// can take the symbols too: each definition once, in its own frame, and each instance as a symbol
// and a matrix. The Rhino writer also takes the 2D objects that stand for nothing in 3D (lines,
// arcs, polygons, text), flat at their layer's elevation. Keeping the writers on these plain lists
// lets them be checked under Node without a drawing.

import type { Mesh3D, Shape, VwxDocument } from "../core/types.ts";

/** A group's record type. */
const GROUP = 11;

export interface ModelPiece {
  /** CSS hex, "#rrggbb" */
  color: string;
  /** 0..1 */
  opacity: number;
  /** 9 floats (three x, y, z corners) per triangle, counter-clockwise seen from outside; mm, z up */
  triangles: Float32Array;
}

export interface ModelObject {
  /** the object's GUID, unique in the drawing */
  id: string;
  /** its own name, else its kind ("Wall", "Extrude"); not unique */
  name: string;
  /** the class it is in ("None" when unnamed) */
  className: string;
  /** the groups it is in, the top-level one first, which writers that nest objects put it in */
  groups?: readonly { id: string; name: string }[];
  pieces: ModelPiece[];
  /**
   * when it is a symbol instance: the symbol it places (an index into Model3D.symbols) and how, 12
   * numbers: the images of the x, y and z axes, then where the symbol's origin goes (mm),
   * p' = x·r0 + y·r1 + z·r2 + t; its pieces are then empty
   */
  instance?: { symbol: number; matrix: readonly number[] };
}

/** A symbol definition, written once: what it holds in its own frame, as a layer holds its objects. */
export interface ModelSymbol {
  /** unique in the drawing */
  name: string;
  /** its objects, some placing symbols before it in Model3D.symbols */
  objects: ModelObject[];
}

export interface ModelLayer {
  /** the layer's GUID */
  id: string;
  /** not unique, may be empty */
  name: string;
  /** mm; the objects' z already includes it */
  elevation: number;
  objects: ModelObject[];
}

export interface Model3D {
  layers: ModelLayer[];
  /** the symbols the objects place, each placing only ones before it (none unless modelOf is asked for them) */
  symbols?: ModelSymbol[];
}

/** A 2D object for writers that keep linework: its geometry in world mm (x, y), flat at `z`. */
export interface FlatObject {
  layerId: string;
  className: string;
  /** mm, the layer's elevation */
  z: number;
  /** its pen colour, "#rrggbb" */
  color: string;
  /** the layer's drawing scale (50 for 1:50), which sizes its text in points */
  scale: number;
  shape: Shape;
}

/** What modelOf reads of an object: a drawing's (ObjectInfo) or one in a symbol definition. */
interface Info {
  id: string;
  name?: string;
  typeName: string;
  className: string;
  parentId: string | null;
}

/**
 * The shaded objects of `layerIds`, by layer in the drawing's order, each object's pieces in model
 * order. The objects in a top-level group (and in the groups in it) are objects of their own, each
 * with its own name and class and the groups it is in. With `symbols`, a symbol instance that is an
 * object of its own places its definition, which is in the model's symbols once, as are the symbols
 * placed in it; an instance unnamed takes its symbol's name. Without, its faces are its own.
 */
export function modelOf(doc: VwxDocument, layerIds: ReadonlySet<string>, symbols = false): Model3D {
  const infos = new Map(doc.layers().map((l) => [l.id, l]));
  const layers = new Map<string, ModelLayer>();
  const made: ModelSymbol[] = [];
  // each definition's place in `made`; null for one with no 3D, or while it is being made
  const at = new Map<number, number | null>();
  const symbolNames = symbols ? new Map(doc.symbolDefs().map((d) => [d.index, d.name])) : new Map<number, string>();
  const symbolOf = (index: number): number | null => {
    if (at.has(index)) return at.get(index) ?? null;
    at.set(index, null);
    const def = doc.symbolModel3d(index);
    const objects: ModelObject[] = [];
    if (def) {
      const lookup = (id: string): Info | null => {
        const m = def.members.get(id);
        return m ? { id, ...m } : null;
      };
      gather(def.meshes, lookup, () => objects);
    }
    if (!objects.length) return null;
    made.push({ name: symbolNames.get(index) || "Symbol", objects });
    at.set(index, made.length - 1);
    return made.length - 1;
  };
  // each mesh's faces into its object, made the first time in the list `into` gives (null leaves it out)
  const gather = (meshes: readonly Mesh3D[], lookup: (id: string) => Info | null, into: (m: Mesh3D) => ModelObject[] | null): void => {
    const objects = new Map<string, ModelObject>();
    for (const m of meshes) {
      if (m.triangles.length < 9) continue;
      const id = m.partId ?? m.objectId;
      let obj = objects.get(id);
      if (!obj) {
        const list = into(m);
        if (!list) continue;
        const o = lookup(id);
        const symbol = symbols && m.instance ? symbolOf(m.instance.symbol) : null;
        const name = o?.name || (symbol !== null ? made[symbol].name : o?.typeName) || "Object";
        obj = { id, name, className: o?.className || "None", pieces: [] };
        if (symbol !== null) obj.instance = { symbol, matrix: m.instance!.matrix };
        if (m.partId) {
          // the groups from the top-level one down to the one holding it
          const groups: { id: string; name: string }[] = [];
          for (let g = lookup(o?.parentId ?? m.objectId); g; g = g.id === m.objectId ? null : lookup(g.parentId ?? "")) {
            groups.unshift({ id: g.id, name: g.name || g.typeName || "Group" });
          }
          obj.groups = groups;
        }
        objects.set(id, obj);
        list.push(obj);
      }
      if (!obj.instance) obj.pieces.push({ color: m.color, opacity: m.opacity, triangles: m.triangles });
    }
  };
  gather(
    doc.model3d(),
    (id) => doc.object(id),
    (m) => {
      if (!layerIds.has(m.layerId)) return null;
      let layer = layers.get(m.layerId);
      if (!layer) {
        const info = infos.get(m.layerId);
        layer = { id: m.layerId, name: info?.name ?? "", elevation: info?.elevation ?? 0, objects: [] };
        layers.set(m.layerId, layer);
      }
      return layer.objects;
    },
  );
  const order = doc.layers().map((l) => l.id);
  return { layers: [...layers.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id)), ...(made.length ? { symbols: made } : {}) };
}

/**
 * A symbol's pieces placed by `matrix` (12 numbers, as ModelObject.instance gives them), with those of
 * the symbols it places, for a writer that can't place it: each triangle turned round where the
 * placement mirrors, so it still faces out.
 */
export function bakeSymbol(model: Model3D, symbol: number, matrix: readonly number[]): ModelPiece[] {
  const out: ModelPiece[] = [];
  const walk = (k: number, m: readonly number[]): void => {
    for (const obj of model.symbols?.[k]?.objects ?? []) {
      if (obj.instance) walk(obj.instance.symbol, compose(m, obj.instance.matrix));
      else for (const p of obj.pieces) out.push({ ...p, triangles: placed(p.triangles, m) });
    }
  };
  walk(symbol, matrix);
  return out;
}

/** a after b, both 12 numbers (the images of the axes, then where the origin goes): p -> a(b(p)). */
function compose(a: readonly number[], b: readonly number[]): number[] {
  const m = new Array<number>(12);
  for (let r = 0; r < 4; r++) {
    const [x, y, z] = [b[3 * r], b[3 * r + 1], b[3 * r + 2]];
    for (let k = 0; k < 3; k++) m[3 * r + k] = x * a[k] + y * a[3 + k] + z * a[6 + k] + (r === 3 ? a[9 + k] : 0);
  }
  return m;
}

/** Triangles put through a placement, each one's last two corners swapped when it mirrors. */
function placed(t: Float32Array, m: readonly number[]): Float32Array {
  const out = new Float32Array(t.length);
  const det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  for (let i = 0; i + 8 < t.length; i += 9) {
    for (let c = 0; c < 3; c++) {
      // a mirrored triangle's corners run 0, 2, 1
      const from = i + 3 * c;
      const to = i + 3 * (det < 0 && c > 0 ? 3 - c : c);
      const [x, y, z] = [t[from], t[from + 1], t[from + 2]];
      out[to] = x * m[0] + y * m[3] + z * m[6] + m[9];
      out[to + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
      out[to + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
    }
  }
  return out;
}

/**
 * The 2D objects of the design layers in `layerIds` that nothing in 3D stands for: lines, rectangles,
 * polygons, polylines, arcs and text, not inside an object that has a 3D form (a wall's plan
 * outline, a symbol's 2D) and not the wireframe parts of a 3D solid.
 */
export function flatOf(doc: VwxDocument, layerIds: ReadonlySet<string>): FlatObject[] {
  const in3d = new Set(doc.model3d().map((m) => m.objectId));
  const out: FlatObject[] = [];
  for (const layer of doc.layers()) {
    if (layer.kind !== "design" || !layerIds.has(layer.id)) continue;
    for (const o of doc.objects(layer.id)) {
      const s = o.shape;
      if (!s || o.wireframe || !["line", "rect", "polygon", "polyline", "arc", "text"].includes(s.kind)) continue;
      // one that is part of a symbol or plug-in object stands for it, and is left out when the top-level
      // object holding it has a 3D form; one on its own or only in groups stands for itself
      let top = o;
      let inObject = false;
      for (let up = o.parentId ? doc.object(o.parentId) : null; up; up = up.parentId ? doc.object(up.parentId) : null) {
        if (up.type !== GROUP) inObject = true;
        top = up;
      }
      if ((top === o || inObject) && in3d.has(top.id)) continue;
      const pen = o.attrs ? doc.color(o.attrs.penFore) : "#000000";
      out.push({ layerId: layer.id, className: o.className || "None", z: layer.elevation ?? 0, color: /^#[0-9a-f]{6}/i.test(pen) ? pen.slice(0, 7) : "#000000", scale: layer.scale || 1, shape: s });
    }
  }
  return out;
}
