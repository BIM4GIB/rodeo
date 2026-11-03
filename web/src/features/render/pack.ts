// A cloud render's job as the editor sends it (cloud.ts) and the cloud worker reads it
// (cloudWorker.ts): what the 3D view shows of the model, its textures, lights and Site Context,
// the Render palette's settings, the sun, the shots and the picture's size. The worker builds the
// scene from it as this computer would, so the picture matches the one made here.
//
// Layout: "RODEOPK1", the header's length (u32, little-endian), the header (JSON), then the arrays
// it points into, each starting on a multiple of 4 bytes. The whole is gzipped for the upload.

import * as THREE from "three";
import type { Viz3D } from "../../app/heliodon.ts";
import type { ModelFace, View3D } from "../../app/view3d.ts";
import type { Light3D, ResourceInfo } from "../../core/index.ts";
import type { Shot } from "./camera.ts";
import type { SceneSource } from "./sceneBuilder.ts";
import { completeSettings, type RenderSettings } from "./settings.ts";
import type { StillPlan } from "./still.ts";

const MAGIC = "RODEOPK1";

/** Where an array lies in the pack: its byte offset after the header, and its length in items. */
type Span = readonly [offset: number, length: number];

interface PackedFace {
  readonly color: string;
  readonly opacity: number;
  readonly texture: number;
  readonly recessed: boolean;
  /** Float32, 3 a corner, world mm */
  readonly position: Span;
  /** Float32, 2 a corner */
  readonly uv: Span | null;
  /** Uint32: the triangles */
  readonly index: Span;
}

interface PackedTexture {
  readonly index: number;
  /** the resource without its preview and image bytes */
  readonly resource: Omit<ResourceInfo, "preview" | "image" | "mask">;
  readonly image: Span | null;
  readonly imageMime: string;
  readonly mask: Span | null;
  readonly maskMime: string;
}

/** One picture of the job. */
export interface PackShot {
  readonly label: string;
  readonly shot: Shot;
}

interface Header {
  readonly plan: StillPlan;
  readonly settings: RenderSettings;
  readonly viz: Viz3D;
  readonly lights: readonly Light3D[];
  readonly shots: readonly PackShot[];
  readonly faces: readonly PackedFace[];
  readonly textures: readonly PackedTexture[];
  /** Site Context, as Object3D.toJSON makes it */
  readonly content: readonly unknown[];
}

/** A job read back: the scene's source and what to make of it. */
export interface Unpacked {
  readonly plan: StillPlan;
  readonly settings: RenderSettings;
  readonly viz: Viz3D;
  readonly shots: readonly PackShot[];
  readonly source: SceneSource;
}

/** Collects the arrays of a pack, each on a 4-byte boundary. */
class Chunks {
  private readonly parts: Uint8Array[] = [];
  private size = 0;

  add(a: Float32Array | Uint32Array | Uint8Array): Span {
    const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const at = this.size;
    this.parts.push(bytes);
    this.size += bytes.byteLength;
    const pad = (4 - (this.size % 4)) % 4;
    if (pad) {
      this.parts.push(new Uint8Array(pad));
      this.size += pad;
    }
    return [at, a.length];
  }

  get list(): readonly Uint8Array[] {
    return this.parts;
  }
}

/**
 * Packs what the 3D view shows (its textures decoded: View3D.ensureTextures) for the cloud worker,
 * gzipped. Each face keeps only the corners its visible triangles use.
 */
export async function packJob(view: View3D, plan: StillPlan, settings: RenderSettings, viz: Viz3D, shots: readonly PackShot[]): Promise<Blob> {
  const chunks = new Chunks();
  const faces: PackedFace[] = [];
  const used = new Set<number>();
  for (const face of view.modelFaces()) {
    if (face.geometry.drawRange.count <= 0 || face.opacity < 0.01) continue;
    const packed = packFace(face, chunks);
    if (!packed) continue;
    faces.push(packed);
    if (face.texture >= 0) used.add(face.texture);
  }
  const textures: PackedTexture[] = [];
  for (const face of view.modelFaces()) {
    const res = face.resource;
    if (!res || !used.delete(face.texture)) continue;
    const { preview: _preview, image, mask, ...resource } = res;
    textures.push({
      index: face.texture,
      resource,
      image: image?.length ? chunks.add(image) : null,
      imageMime: res.imageMime ?? "",
      mask: mask?.length ? chunks.add(mask) : null,
      maskMime: res.maskMime ?? "",
    });
  }
  const header: Header = {
    plan,
    settings,
    viz,
    lights: view.visibleLights(),
    shots,
    faces,
    textures,
    content: view.visibleContent().map((obj) => obj.toJSON()),
  };
  const head = new TextEncoder().encode(JSON.stringify(header));
  const lead = new Uint8Array(MAGIC.length + 4);
  lead.set(new TextEncoder().encode(MAGIC));
  new DataView(lead.buffer).setUint32(MAGIC.length, head.byteLength, true);
  const pad = new Uint8Array((4 - ((lead.byteLength + head.byteLength) % 4)) % 4);
  const raw = new Blob([lead, head, pad, ...chunks.list] as BlobPart[]);
  return new Response(raw.stream().pipeThrough(new CompressionStream("gzip"))).blob();
}

/** A face's visible triangles, re-indexed to the corners they use; null when it has none. */
function packFace(face: ModelFace, chunks: Chunks): PackedFace | null {
  const src = face.geometry;
  const pos = src.attributes.position;
  const uv = src.attributes.uv;
  const index = src.index;
  const count = Math.min(src.drawRange.count, index ? index.count : pos.count);
  if (count <= 0) return null;
  const remap = new Map<number, number>();
  const triangles = new Uint32Array(count);
  for (let k = 0; k < count; k++) {
    const v = index ? index.getX(k) : k;
    let to = remap.get(v);
    if (to === undefined) {
      to = remap.size;
      remap.set(v, to);
    }
    triangles[k] = to;
  }
  const positions = new Float32Array(remap.size * 3);
  const uvs = uv ? new Float32Array(remap.size * 2) : null;
  for (const [v, to] of remap) {
    positions[3 * to] = pos.getX(v);
    positions[3 * to + 1] = pos.getY(v);
    positions[3 * to + 2] = pos.getZ(v);
    if (uv && uvs) {
      uvs[2 * to] = uv.getX(v);
      uvs[2 * to + 1] = uv.getY(v);
    }
  }
  return {
    color: face.color,
    opacity: face.opacity,
    texture: face.texture,
    recessed: face.recessed,
    position: chunks.add(positions),
    uv: uvs ? chunks.add(uvs) : null,
    index: chunks.add(triangles),
  };
}

/** Reads a job (gunzipped), decoding its textures as the 3D view does. */
export async function unpackJob(bytes: Uint8Array): Promise<Unpacked> {
  const magic = new TextDecoder().decode(bytes.subarray(0, MAGIC.length));
  if (magic !== MAGIC) throw new Error("not a render job");
  const headLength = new DataView(bytes.buffer, bytes.byteOffset).getUint32(MAGIC.length, true);
  const headStart = MAGIC.length + 4;
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(headStart, headStart + headLength))) as Header;
  let base = headStart + headLength;
  base += (4 - (base % 4)) % 4;
  // the arrays are copied out, so each has a buffer of its own (the BVH worker takes them over)
  const f32 = (s: Span): Float32Array => new Float32Array(bytes.slice(base + s[0], base + s[0] + s[1] * 4).buffer);
  const u32 = (s: Span): Uint32Array => new Uint32Array(bytes.slice(base + s[0], base + s[0] + s[1] * 4).buffer);
  const u8 = (s: Span): Uint8Array => bytes.slice(base + s[0], base + s[0] + s[1]);

  const maps = new Map<number, { resource: ResourceInfo; map: THREE.Texture | null; alphaMap: THREE.Texture | null }>();
  await Promise.all(
    header.textures.map(async (t) => {
      const image = t.image ? u8(t.image) : undefined;
      const mask = t.mask ? u8(t.mask) : undefined;
      const resource: ResourceInfo = { ...t.resource, preview: null, image, imageMime: t.imageMime, mask, maskMime: t.maskMime } as ResourceInfo;
      let map: THREE.Texture | null = null;
      let alphaMap: THREE.Texture | null = null;
      try {
        if (image) map = mapTexture(await decode(image, t.imageMime), THREE.SRGBColorSpace);
        if (image && mask) alphaMap = mapTexture(await decode(mask, t.maskMime), THREE.NoColorSpace);
      } catch {
        // an image that does not decode leaves its faces in their colour, as in the 3D view
      }
      maps.set(t.index, { resource, map, alphaMap });
    }),
  );

  const faces: ModelFace[] = header.faces.map((f) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(f32(f.position), 3));
    if (f.uv) geometry.setAttribute("uv", new THREE.BufferAttribute(f32(f.uv), 2));
    geometry.setIndex(new THREE.BufferAttribute(u32(f.index), 1));
    const tex = f.texture >= 0 ? maps.get(f.texture) : undefined;
    return {
      geometry,
      color: f.color,
      opacity: f.opacity,
      texture: f.texture,
      resource: tex?.resource ?? null,
      map: tex?.map ?? null,
      alphaMap: tex?.alphaMap ?? null,
      recessed: f.recessed,
    };
  });
  const loader = new THREE.ObjectLoader();
  const content = await Promise.all(header.content.map((json) => loader.parseAsync(json as Parameters<THREE.ObjectLoader["parseAsync"]>[0])));
  return {
    plan: header.plan,
    // a job packed by an older version lacks the settings added since
    settings: completeSettings(header.settings),
    viz: header.viz,
    shots: header.shots,
    source: { faces, content, lights: header.lights },
  };
}

function decode(bytes: Uint8Array, mime: string): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }));
}

/** A texture as the 3D view makes one (View3D.mapTexture). */
function mapTexture(bitmap: ImageBitmap, colorSpace: THREE.ColorSpace): THREE.Texture {
  const tex = new THREE.Texture(bitmap);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = colorSpace;
  tex.needsUpdate = true;
  return tex;
}
