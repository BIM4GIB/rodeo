// The conversion from the document's 3D geometry to a three.js scene for the exporters. Mesh3D is
// in millimetres with z up; the scene is in metres with y up, at the chosen scale (1:n of the real
// size), optionally centred on the origin with its lowest point on the ground. Faces stay flat, as
// the 3D view draws them; they are grouped by colour, opacity and texture, and textures are mapped
// by the same box projection the 3D view uses, so a texture lands where it does on screen.

import * as THREE from "three";
import type { Mesh3D, ResourceInfo } from "../../core/index.ts";

type Vec3 = [number, number, number];

/** Triangles above which the export warns that the file will be large and slow to open. */
export const TRIANGLE_WARNING = 2_000_000;

/** How far (mm) a recessed face (a wall) is pushed back, so a face lying on it (a door frame) wins. */
const RECESS_MM = 0.5;
/** Image size assumed for a texture that does not give one (mm), as the 3D view assumes. */
const DEFAULT_IMAGE_MM = 1000;
/** Normal used for a degenerate triangle: up in the scene, straight up in the drawing. */
const UP: Vec3 = [0, 1, 0];

export interface Box {
  min: Vec3;
  max: Vec3;
}

export interface LayerStats extends Box {
  triangles: number;
}

export interface ModelOptions {
  /** the design layers to export */
  readonly layers: ReadonlySet<string>;
  /** the model at 1:scale of its real size (1 for 1:1) */
  readonly scale: number;
  /** centre the model on the origin and set its lowest point on the ground */
  readonly centre: boolean;
}

/** Triangle count and box (millimetres, z up) of each layer that has 3D geometry. */
export function layerStats(meshes: readonly Mesh3D[]): Map<string, LayerStats> {
  const out = new Map<string, LayerStats>();
  for (const m of meshes) {
    const tris = Math.floor(m.triangles.length / 9);
    if (tris === 0) continue;
    let s = out.get(m.layerId);
    if (!s) {
      s = { triangles: 0, min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      out.set(m.layerId, s);
    }
    s.triangles += tris;
    extend(s, m.triangles, tris * 9);
  }
  return out;
}

/** The box round several boxes, or null when there are none. */
export function unionOf(boxes: readonly Box[]): Box | null {
  let out: Box | null = null;
  for (const b of boxes) {
    if (!out) out = { min: [...b.min], max: [...b.max] };
    for (let k = 0; k < 3; k++) {
      out.min[k] = Math.min(out.min[k], b.min[k]);
      out.max[k] = Math.max(out.max[k], b.max[k]);
    }
  }
  return out;
}

function extend(box: Box, xyz: Float32Array, n: number): void {
  for (let i = 0; i < n; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = xyz[i + k];
      if (v < box.min[k]) box.min[k] = v;
      if (v > box.max[k]) box.max[k] = v;
    }
  }
}

/** A group of triangles that share one material. */
interface Group {
  /** "colour", "image" (the texture's picture) or "preview" (the average colour of its preview) */
  mode: "colour" | "image" | "preview";
  /** the material colour; white for a picture */
  colour: string;
  /** the colour of the first object, for when a texture cannot be decoded */
  fallback: string;
  opacity: number;
  /** the texture resource, for "image" and "preview" */
  res: ResourceInfo | null;
  parts: Mesh3D[];
  triangles: number;
}

export interface BuiltScene {
  readonly scene: THREE.Scene;
  readonly triangles: number;
}

/** The scene for the chosen layers at the chosen scale. */
export async function buildScene(meshes: readonly Mesh3D[], resources: readonly ResourceInfo[], options: ModelOptions): Promise<BuiltScene> {
  const chosen = meshes.filter((m) => options.layers.has(m.layerId) && m.triangles.length >= 9);
  const box = unionOf([...layerStats(chosen).values()]);
  // millimetres, z up: move the centre of the footprint to the origin and the lowest point to z 0
  const offset: Vec3 =
    options.centre && box ? [-(box.min[0] + box.max[0]) / 2, -(box.min[1] + box.max[1]) / 2, -box.min[2]] : [0, 0, 0];
  // metres per millimetre at this scale
  const k = 0.001 / options.scale;

  const byIndex = new Map(resources.map((r): [number, ResourceInfo] => [r.index, r]));
  const groups = groupMeshes(chosen, byIndex);

  const textures = new Map<number, THREE.Texture | null>();
  for (const g of groups.values()) {
    if (g.mode === "image" && g.res && !textures.has(g.res.index)) textures.set(g.res.index, await imageTexture(g.res));
    if (g.mode === "preview" && g.res) {
      const colour = await previewColour(g.res);
      g.colour = colour ?? g.fallback;
    }
    if (g.mode === "image" && g.res && !textures.get(g.res.index)) {
      // a picture that will not decode leaves its faces in the colour of the object
      g.mode = "colour";
      g.colour = g.fallback;
    }
  }

  const scene = new THREE.Scene();
  let triangles = 0;
  for (const g of groups.values()) {
    const { position, normal, uv } = fillGroup(g, offset, k);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    if (uv) geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    const material = new THREE.MeshStandardMaterial({
      color: g.colour,
      map: g.mode === "image" && g.res ? (textures.get(g.res.index) ?? null) : null,
      roughness: 0.85,
      metalness: 0,
      opacity: g.opacity,
      transparent: g.opacity < 1,
      // the triangles are counter-clockwise seen from outside, so one side is enough
      side: THREE.FrontSide,
    });
    scene.add(new THREE.Mesh(geometry, material));
    triangles += g.triangles;
  }
  return { scene, triangles };
}

function groupMeshes(meshes: readonly Mesh3D[], byIndex: ReadonlyMap<number, ResourceInfo>): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const m of meshes) {
    const opacity = Math.min(1, Math.max(0, m.opacity));
    const res = byIndex.get(m.texture) ?? null;
    let key: string;
    let mode: Group["mode"] = "colour";
    if (res?.image?.length) {
      key = `image|${m.texture}|${opacity}`;
      mode = "image";
    } else if (res?.preview?.length) {
      key = `preview|${m.texture}|${opacity}`;
      mode = "preview";
    } else {
      key = `colour|${m.color}|${opacity}`;
    }
    let g = groups.get(key);
    if (!g) {
      g = {
        mode,
        colour: mode === "image" ? "#ffffff" : m.color,
        fallback: m.color,
        opacity,
        res: mode === "colour" ? null : res,
        parts: [],
        triangles: 0,
      };
      groups.set(key, g);
    }
    g.parts.push(m);
    g.triangles += Math.floor(m.triangles.length / 9);
  }
  return groups;
}

/** Positions, flat normals and (for a picture) texture coordinates of a group, in the scene's space. */
function fillGroup(g: Group, offset: Vec3, k: number): { position: Float32Array; normal: Float32Array; uv: Float32Array | null } {
  const position = new Float32Array(g.triangles * 9);
  const normal = new Float32Array(g.triangles * 9);
  const uv = g.mode === "image" ? new Float32Array(g.triangles * 6) : null;
  const size = g.res?.imageSize && g.res.imageSize > 0 ? g.res.imageSize : DEFAULT_IMAGE_MM;
  let t0 = 0;
  for (const m of g.parts) {
    const src = m.triangles;
    const tris = Math.floor(src.length / 9);
    for (let t = 0; t < tris; t++, t0++) {
      const b = t * 9;
      const o = t0 * 9;
      // a recessed face moves back along its normal (millimetres, z up)
      let sx = 0;
      let sy = 0;
      let sz = 0;
      if (m.recessed) {
        const [nx, ny, nz] = unitNormal(src, b, [0, 0, 1]);
        sx = -nx * RECESS_MM;
        sy = -ny * RECESS_MM;
        sz = -nz * RECESS_MM;
      }
      for (let c = 0; c < 3; c++) {
        const x = src[b + 3 * c] + offset[0] + sx;
        const y = src[b + 3 * c + 1] + offset[1] + sy;
        const z = src[b + 3 * c + 2] + offset[2] + sz;
        // z up to y up: (x, y, z) becomes (x, z, -y), a turn that keeps the winding
        position[o + 3 * c] = x * k;
        position[o + 3 * c + 1] = z * k;
        position[o + 3 * c + 2] = -y * k;
      }
      const [nx, ny, nz] = unitNormal(position, o, UP);
      for (let c = 0; c < 3; c++) {
        normal[o + 3 * c] = nx;
        normal[o + 3 * c + 1] = ny;
        normal[o + 3 * c + 2] = nz;
      }
      if (uv) boxUv(src, b, size, uv, t0 * 6);
    }
  }
  return { position, normal, uv };
}

/** The unit normal of the triangle at `b` (nine floats, three points), or `fallback` when it has no area. */
function unitNormal(a: Float32Array, b: number, fallback: Vec3): Vec3 {
  const ux = a[b + 3] - a[b];
  const uy = a[b + 4] - a[b + 1];
  const uz = a[b + 5] - a[b + 2];
  const vx = a[b + 6] - a[b];
  const vy = a[b + 7] - a[b + 1];
  const vz = a[b + 8] - a[b + 2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const len = Math.hypot(x, y, z);
  return len > 0 ? [x / len, y / len, z / len] : fallback;
}

/**
 * Texture coordinates by box projection, as the 3D view maps them: each triangle is projected along
 * its dominant normal axis, and u and v are the other two coordinates over the image's size.
 */
function boxUv(src: Float32Array, b: number, size: number, out: Float32Array, o: number): void {
  const ux = src[b + 3] - src[b];
  const uy = src[b + 4] - src[b + 1];
  const uz = src[b + 5] - src[b + 2];
  const vx = src[b + 6] - src[b];
  const vy = src[b + 7] - src[b + 1];
  const vz = src[b + 8] - src[b + 2];
  const nx = Math.abs(uy * vz - uz * vy);
  const ny = Math.abs(uz * vx - ux * vz);
  const nz = Math.abs(ux * vy - uy * vx);
  let iu = 0; // dominant z: x and y
  let iv = 1;
  if (nx >= ny && nx >= nz) {
    iu = 1; // dominant x: y and z
    iv = 2;
  } else if (ny >= nz) {
    iu = 0; // dominant y: x and z
    iv = 2;
  }
  for (let c = 0; c < 3; c++) {
    out[o + 2 * c] = src[b + 3 * c + iu] / size;
    out[o + 2 * c + 1] = src[b + 3 * c + iv] / size;
  }
}

/** The picture of a texture resource, repeating as the 3D view repeats it, or null when it does not decode. */
async function imageTexture(res: ResourceInfo): Promise<THREE.Texture | null> {
  if (!res.image?.length) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(res.image)], { type: res.imageMime ?? "" }));
    const tex = new THREE.Texture(bitmap);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  } catch {
    return null;
  }
}

/** The average colour of the middle of a texture's preview (its swatch), as a CSS hex colour, or null. */
async function previewColour(res: ResourceInfo): Promise<string | null> {
  if (!res.preview?.length) return null;
  try {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(res.preview)], { type: res.previewMime }));
    const size = 16;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, bitmap.width * 0.3, bitmap.height * 0.3, bitmap.width * 0.4, bitmap.height * 0.4, 0, 0, size, size);
    bitmap.close();
    const px = ctx.getImageData(0, 0, size, size).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 128) continue;
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n++;
    }
    if (n === 0) return null;
    return `#${hex(r / n)}${hex(g / n)}${hex(b / n)}`;
  } catch {
    return null;
  }
}

function hex(v: number): string {
  return Math.round(v).toString(16).padStart(2, "0");
}
