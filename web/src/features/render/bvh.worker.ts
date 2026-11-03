// Builds the path tracer's BVH off the page's thread (bvhBuilder.ts): a large model's takes
// seconds, and the 3D view keeps drawing meanwhile. It takes the merged geometry's positions, index
// and groups with the BVH options, and sends back the serialised BVH with the arrays it was given.

import * as THREE from "three";
import { MeshBVH, type MeshBVHOptions } from "three-mesh-bvh";

export interface BuildRequest {
  readonly position: Float32Array;
  readonly index: Uint16Array | Uint32Array | null;
  readonly groups: readonly { start: number; count: number; materialIndex?: number }[];
  /** with three-gpu-pathtracer's indirect, which the typings leave out */
  readonly options: Omit<MeshBVHOptions, "onProgress">;
}

export type BuildReply =
  | { readonly progress: number }
  | { readonly error: string }
  | { readonly serialized: ReturnType<typeof MeshBVH.serialize>; readonly position: Float32Array };

/** how often progress is sent, ms */
const PROGRESS_EVERY = 50;

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<BuildRequest>) => void) | null;
  postMessage(message: BuildReply, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data }) => {
  try {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(data.position, 3, false));
    if (data.index) geometry.setIndex(new THREE.BufferAttribute(data.index, 1, false));
    for (const g of data.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    let sent = performance.now();
    const bvh = new MeshBVH(geometry, {
      ...data.options,
      onProgress: (progress: number) => {
        const now = performance.now();
        if (now - sent < PROGRESS_EVERY) return;
        sent = now;
        scope.postMessage({ progress: Math.min(1, progress) });
      },
    });
    const serialized = MeshBVH.serialize(bvh, { cloneBuffers: false });
    const transfer: Transferable[] = [data.position.buffer as ArrayBuffer, ...serialized.roots];
    if (serialized.index) transfer.push(serialized.index.buffer as ArrayBuffer);
    scope.postMessage({ serialized, position: data.position }, transfer);
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
