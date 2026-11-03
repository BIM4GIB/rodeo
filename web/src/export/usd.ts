// The 3D model as Universal Scene Description, as Vectorworks' Export USD writes it: the meshes the
// 3D view shows, y up in metres (the drawing's millimetres, z up, become x, z, -y over 1000, as the
// OBJ and glTF exports write them), organized by layer (an Xform per layer, an object a Mesh, or an
// Xform of Meshes when its parts differ in colour or texture) or by texture (an Xform per material,
// or one Mesh per material when objects are combined). Each material is a UsdPreviewSurface: the
// object's colour and opacity, or its texture's image tiled as the 3D view tiles it (the object's
// own mapping where it has one, else projected along each face's main axis at the image's size),
// the images written as files beside the scene. Faces are flat shaded and double-sided. Each object
// carries its name, type, id, class and layer as `vw:` attributes, and with `records` its records'
// and plug-in parameters' values too (lost when objects are combined). Text USD (usda) only: a
// .usdz packages the text and the images, stored and 64-byte aligned as the format asks.

import { crc32 } from "../core/bytes.ts";
import type { Mesh3D, RecordValue, ResourceInfo, VwxDocument } from "../core/types.ts";

const M_PER_MM = 0.001;
/** the size an image is tiled at when its texture doesn't say, as the 3D view takes it (mm) */
const DEFAULT_IMAGE_MM = 1000;
const IMAGE_EXT: Readonly<Record<string, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg" };

export type UsdOrganization = "layer" | "texture";

export interface UsdOptions {
  readonly organization: UsdOrganization;
  /** by texture: one mesh per material, the objects' own data left out */
  readonly combine: boolean;
  /** the values of objects' records and plug-in parameters, as attributes */
  readonly records: boolean;
  /** textures' images as files beside the scene; else each textured face takes its object's colour */
  readonly textures: boolean;
}

export interface UsdScene {
  /** the usda text */
  readonly text: string;
  /** the images it refers to, by their path from it */
  readonly files: readonly (readonly [string, Uint8Array])[];
  /** textures whose image couldn't go (not PNG or JPEG): their faces take the colour */
  readonly texturesLeftOut: number;
}

/** A USD identifier from any name: letters, digits and underscores, not starting with a digit. */
export function usdIdent(name: string): string {
  const t = name.normalize("NFKD").replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return !t ? "_" : /^[0-9]/.test(t) ? `_${t}` : t;
}

/** Names unique among one prim's children: the second "Wall" is "Wall_2". */
function namer(): (name: string) => string {
  const used = new Map<string, number>();
  return (name) => {
    const base = usdIdent(name);
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  };
}

const str = (s: string): string => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n|\r/g, "\\n")}"`;
const num = (v: number): string => (Math.abs(v) < 5e-10 ? "0" : String(Math.round(v * 1e6) / 1e6));

/** "#rrggbb" as three 0..1 channels. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  if (!Number.isFinite(n)) return [0.8, 0.8, 0.8];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

interface Material {
  readonly path: string;
  readonly name: string;
  readonly color: string;
  readonly opacity: number;
  /** the image's path from the scene, when textured */
  readonly file: string | null;
  /** the size the image tiles at, mm */
  readonly size: number;
}

/** One mesh's corners, normals and texture coordinates, y up in metres. */
interface Geometry {
  points: string[];
  indices: number[];
  normals: string[];
  st: string[];
  lo: [number, number, number];
  hi: [number, number, number];
}

function newGeometry(): Geometry {
  return { points: [], indices: [], normals: [], st: [], lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity] };
}

/** Adds `m`'s triangles to `g`, corners shared within it, with texture coordinates when `mat` is textured. */
function addTriangles(g: Geometry, m: Mesh3D, mat: Material, index: Map<string, number>): void {
  const t = m.triangles;
  const tris = Math.floor(t.length / 9);
  const own = m.uvs && m.uvs.length === tris * 6 ? m.uvs : null;
  for (let i = 0; i < tris; i++) {
    const o = i * 9;
    const p = [0, 3, 6].map((k): [number, number, number] => [t[o + k] * M_PER_MM, t[o + k + 2] * M_PER_MM, -t[o + k + 1] * M_PER_MM]);
    const corners = p.map(([x, y, z]) => `(${num(x)}, ${num(y)}, ${num(z)})`);
    // a triangle squashed to a line or point by the rounding draws nothing
    if (corners[0] === corners[1] || corners[1] === corners[2] || corners[0] === corners[2]) continue;
    const ux = t[o + 3] - t[o], uy = t[o + 4] - t[o + 1], uz = t[o + 5] - t[o + 2];
    const vx = t[o + 6] - t[o], vy = t[o + 7] - t[o + 1], vz = t[o + 8] - t[o + 2];
    const n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    // the normal turned y up as the corners are
    const normal = `(${num(n[0] / len)}, ${num(n[2] / len)}, ${num(-n[1] / len)})`;
    // the axis the face looks along most: the 3D view projects an image along it
    const an = n.map(Math.abs);
    const [iu, iv] = an[0] >= an[1] && an[0] >= an[2] ? [1, 2] : an[1] >= an[2] ? [0, 2] : [0, 1];
    for (let k = 0; k < 3; k++) {
      let at = index.get(corners[k]);
      if (at === undefined) {
        at = g.points.length;
        index.set(corners[k], at);
        g.points.push(corners[k]);
        for (let a = 0; a < 3; a++) {
          g.lo[a] = Math.min(g.lo[a], p[k][a]);
          g.hi[a] = Math.max(g.hi[a], p[k][a]);
        }
      }
      g.indices.push(at);
      g.normals.push(normal);
      if (mat.file === null) continue;
      // st is v up from the image's foot; the 3D view's box projection runs its v down from the top
      if (own) g.st.push(`(${num(own[i * 6 + 2 * k])}, ${num(own[i * 6 + 2 * k + 1])})`);
      else g.st.push(`(${num(t[o + 3 * k + iu] / mat.size)}, ${num(-t[o + 3 * k + iv] / mat.size)})`);
    }
  }
}

/** The Mesh prim for `g`, at `depth` levels in, bound to `mat`, with `attrs` after. */
function meshPrim(name: string, g: Geometry, mat: Material, attrs: readonly string[], depth: number): string[] {
  const pad = "    ".repeat(depth);
  const p = (s: string): string => `${pad}    ${s}`;
  const out = [`${pad}def Mesh ${str(name)} (`, `${pad}    prepend apiSchemas = ["MaterialBindingAPI"]`, `${pad})`, `${pad}{`];
  out.push(p("uniform bool doubleSided = 1"));
  out.push(p(`float3[] extent = [(${g.lo.map(num).join(", ")}), (${g.hi.map(num).join(", ")})]`));
  out.push(p(`int[] faceVertexCounts = [${new Array(g.indices.length / 3).fill(3).join(", ")}]`));
  out.push(p(`int[] faceVertexIndices = [${g.indices.join(", ")}]`));
  out.push(p(`normal3f[] normals = [${g.normals.join(", ")}] (`), p('    interpolation = "faceVarying"'), p(")"));
  out.push(p(`point3f[] points = [${g.points.join(", ")}]`));
  if (mat.file !== null) out.push(p(`texCoord2f[] primvars:st = [${g.st.join(", ")}] (`), p('    interpolation = "faceVarying"'), p(")"));
  out.push(p('uniform token subdivisionScheme = "none"'));
  out.push(p(`rel material:binding = <${mat.path}>`));
  out.push(...attrs.map(p));
  out.push(`${pad}}`);
  return out;
}

/** The Material prim: a UsdPreviewSurface of a colour, or of an image read through st. */
function materialPrim(m: Material): string[] {
  const [r, g, b] = rgb(m.color);
  const out = [
    `        def Material ${str(m.name)}`,
    "        {",
    `            token outputs:surface.connect = <${m.path}/Surface.outputs:surface>`,
    "",
    '            def Shader "Surface"',
    "            {",
    '                uniform token info:id = "UsdPreviewSurface"',
    m.file !== null ? `                color3f inputs:diffuseColor.connect = <${m.path}/Image.outputs:rgb>` : `                color3f inputs:diffuseColor = (${num(r)}, ${num(g)}, ${num(b)})`,
    `                float inputs:opacity = ${num(m.opacity)}`,
    "                float inputs:roughness = 0.8",
    "                token outputs:surface",
    "            }",
  ];
  if (m.file !== null) {
    out.push(
      "",
      '            def Shader "Image"',
      "            {",
      '                uniform token info:id = "UsdUVTexture"',
      `                asset inputs:file = @${m.file}@`,
      '                token inputs:sourceColorSpace = "sRGB"',
      `                float2 inputs:st.connect = <${m.path}/St.outputs:result>`,
      '                token inputs:wrapS = "repeat"',
      '                token inputs:wrapT = "repeat"',
      "                float3 outputs:rgb",
      "            }",
      "",
      '            def Shader "St"',
      "            {",
      '                uniform token info:id = "UsdPrimvarReader_float2"',
      '                string inputs:varname = "st"',
      "                float2 outputs:result",
      "            }",
    );
  }
  out.push("        }");
  return out;
}

/** An object's data as `vw:` attributes: its name, type, id, class and layer, and its records' values with `records`. */
function objectAttrs(doc: VwxDocument, id: string, records: boolean): string[] {
  const o = doc.object(id);
  if (!o) return [];
  const layer = doc.layers().find((l) => l.id === o.layerId)?.name ?? "";
  const out = [
    ...(o.name ? [`custom string vw:name = ${str(o.name)}`] : []),
    `custom string vw:type = ${str(o.typeName)}`,
    `custom string vw:uuid = ${str(o.id)}`,
    `custom string vw:class = ${str(o.className)}`,
    `custom string vw:layer = ${str(layer)}`,
  ];
  if (!records) return out;
  const seen = new Set<string>();
  for (const r of doc.records(id)) {
    for (const f of r.fields) {
      const name = `vw:record:${usdIdent(r.name)}:${usdIdent(f.name)}`;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(`custom ${attrType(f.value)} ${name} = ${attrValue(f.value)}`);
    }
  }
  return out;
}

const attrType = (v: RecordValue): string => (typeof v === "number" ? "double" : typeof v === "boolean" ? "bool" : "string");
const attrValue = (v: RecordValue): string => (typeof v === "number" ? (Number.isFinite(v) ? String(v) : "0") : typeof v === "boolean" ? (v ? "1" : "0") : str(v));

/** The usda scene of `meshes` (the 3D view's, of the layers and objects to export) and the images it refers to. */
export function usdScene(doc: VwxDocument, meshes: readonly Mesh3D[], options: UsdOptions, title = "Rodeo"): UsdScene {
  const resources = new Map<number, ResourceInfo>();
  for (const r of doc.resources()) if (r.kind === "texture") resources.set(r.index, r);
  const materials = new Map<string, Material>();
  const materialName = namer();
  const fileName = namer();
  const files: [string, Uint8Array][] = [];
  const leftOut = new Set<number>();
  const materialOf = (m: Mesh3D): Material => {
    const res = options.textures && m.texture >= 0 ? resources.get(m.texture) : undefined;
    const ext = res?.image?.length ? IMAGE_EXT[(res.imageMime ?? "").toLowerCase()] : undefined;
    if (res?.image?.length && !ext) leftOut.add(res.index);
    const textured = res && ext ? res : undefined;
    const opacity = Math.min(1, Math.max(0, m.opacity));
    const key = textured ? `t${textured.index}|${opacity}` : `${m.color}|${opacity}`;
    let mat = materials.get(key);
    if (!mat) {
      const plain = `Color_${m.color.replace("#", "").slice(0, 6)}${opacity < 1 ? `_${Math.round(opacity * 100)}` : ""}`;
      const name = materialName(textured ? textured.name : plain);
      let file: string | null = null;
      if (textured) {
        file = `textures/${fileName(textured.name)}.${ext}`;
        files.push([file, textured.image!]);
      }
      const size = textured?.imageSize && textured.imageSize > 0 ? textured.imageSize : DEFAULT_IMAGE_MM;
      mat = { path: `/Model/Materials/${name}`, name, color: m.color, opacity, file, size };
      materials.set(key, mat);
    }
    return mat;
  };

  const body: string[] = [];
  const top = namer();
  // the materials' scope keeps its name
  top("Materials");
  const shaded = meshes.filter((m) => m.triangles.length >= 9);
  const objectName = (id: string): string => {
    const o = doc.object(id);
    return `${o?.name || o?.typeName || "Object"}`;
  };
  const meshOf = (parts: readonly Mesh3D[], mat: Material): Geometry => {
    const g = newGeometry();
    const index = new Map<string, number>();
    for (const m of parts) addTriangles(g, m, mat, index);
    return g;
  };

  if (options.organization === "layer") {
    const byLayer = new Map<string, Mesh3D[]>();
    for (const m of shaded) byLayer.set(m.layerId, [...(byLayer.get(m.layerId) ?? []), m]);
    for (const [layerId, list] of byLayer) {
      const layerName = top(doc.layers().find((l) => l.id === layerId)?.name || "Layer");
      body.push(`    def Xform ${str(layerName)}`, "    {");
      const child = namer();
      const byObject = new Map<string, Mesh3D[]>();
      for (const m of list) byObject.set(m.objectId, [...(byObject.get(m.objectId) ?? []), m]);
      for (const [id, parts] of byObject) {
        const attrs = objectAttrs(doc, id, options.records);
        const byMat = new Map<Material, Mesh3D[]>();
        for (const m of parts) {
          const mat = materialOf(m);
          byMat.set(mat, [...(byMat.get(mat) ?? []), m]);
        }
        const geoms = [...byMat].map(([mat, ms]) => ({ mat, g: meshOf(ms, mat) })).filter((x) => x.g.indices.length > 0);
        if (geoms.length === 0) continue;
        const name = child(objectName(id));
        if (geoms.length === 1) {
          body.push(...meshPrim(name, geoms[0].g, geoms[0].mat, attrs, 2));
          continue;
        }
        // parts in different materials: an Xform holding the object's data, a Mesh per material
        body.push(`        def Xform ${str(name)}`, "        {", ...attrs.map((a) => `            ${a}`));
        const part = namer();
        for (const { mat, g } of geoms) body.push(...meshPrim(part(mat.name), g, mat, [], 3));
        body.push("        }");
      }
      body.push("    }");
    }
  } else {
    const byMat = new Map<Material, Mesh3D[]>();
    for (const m of shaded) {
      const mat = materialOf(m);
      byMat.set(mat, [...(byMat.get(mat) ?? []), m]);
    }
    for (const [mat, list] of byMat) {
      if (options.combine) {
        const g = meshOf(list, mat);
        if (g.indices.length > 0) body.push(...meshPrim(top(mat.name), g, mat, [], 1));
        continue;
      }
      body.push(`    def Xform ${str(top(mat.name))}`, "    {");
      const child = namer();
      const byObject = new Map<string, Mesh3D[]>();
      for (const m of list) byObject.set(m.objectId, [...(byObject.get(m.objectId) ?? []), m]);
      for (const [id, parts] of byObject) {
        const g = meshOf(parts, mat);
        if (g.indices.length > 0) body.push(...meshPrim(child(objectName(id)), g, mat, objectAttrs(doc, id, options.records), 2));
      }
      body.push("    }");
    }
  }

  const text = [
    "#usda 1.0",
    "(",
    '    defaultPrim = "Model"',
    `    doc = ${str(`${title}, exported by Rodeo`)}`,
    "    metersPerUnit = 1",
    '    upAxis = "Y"',
    ")",
    "",
    'def Xform "Model" (',
    '    kind = "assembly"',
    ")",
    "{",
    ...body,
    '    def Scope "Materials"',
    "    {",
    ...[...materials.values()].flatMap((m, i) => [...(i > 0 ? [""] : []), ...materialPrim(m)]),
    "    }",
    "}",
    "",
  ].join("\n");
  return { text, files, texturesLeftOut: leftOut.size };
}

/**
 * A .usdz package: `files` stored (not compressed) in a zip, the first the scene, each file's data
 * starting on a 64-byte boundary (an extra field pads the header), as USDZ readers require.
 */
export function usdzPackage(files: readonly (readonly [string, Uint8Array])[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = new TextEncoder().encode(path);
    const head = 30 + name.length;
    let extra = (64 - ((offset + head) % 64)) % 64;
    // an extra field is at least its 4-byte header
    if (extra > 0 && extra < 4) extra += 64;
    const crc = crc32(data);
    const local = new Uint8Array(head + extra);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // names in UTF-8
    lv.setUint16(8, 0, true); // stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, extra, true);
    local.set(name, 30);
    if (extra > 0) {
      lv.setUint16(head, 0x1986, true); // padding, as Pixar's packager writes it
      lv.setUint16(head + 2, extra - 4, true);
    }
    const entry = new Uint8Array(46 + name.length);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    entry.set(name, 46);
    parts.push(local, data);
    central.push(entry);
    offset += local.length + data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, size, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + size + 22);
  let at = 0;
  for (const p of [...parts, ...central, end]) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
