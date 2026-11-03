// Builds the path tracer's BVH in bvh.worker.ts, so a large model's scene builds without stopping
// the page. three-gpu-pathtracer takes any object with generate(geometry, options) for this
// (setBVHWorker); three-mesh-bvh's own GenerateMeshBVHWorker would serve, but its worker cannot be
// found once the bundler has pre-bundled the package.

import * as THREE from "three";
import { MeshBVH, type MeshBVHOptions } from "three-mesh-bvh";
import type { BVHWorker } from "three-gpu-pathtracer";
import type { BuildReply, BuildRequest } from "./bvh.worker.ts";

export class BvhBuilder implements BVHWorker {
  private worker: Worker | null = new Worker(new URL("./bvh.worker.ts", import.meta.url), { type: "module" });
  private running = false;

  /** Builds `geometry`'s BVH. Its position and index arrays are lent to the worker until it is built. */
  generate(geometry: THREE.BufferGeometry, options: MeshBVHOptions = {}): Promise<MeshBVH> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("the BVH builder has been disposed"));
    if (this.running) return Promise.reject(new Error("a BVH is already building"));
    this.running = true;
    const { onProgress, ...rest } = options;
    const position = geometry.attributes.position.array as Float32Array;
    const index = geometry.index ? (geometry.index.array as Uint16Array | Uint32Array) : null;
    const built = new Promise<MeshBVH>((resolve, reject) => {
      worker.onerror = (e) => reject(new Error(`the BVH worker: ${e.message || "it could not start"}`));
      worker.onmessage = ({ data }: MessageEvent<BuildReply>) => {
        if ("progress" in data) {
          onProgress?.(data.progress);
          return;
        }
        if ("error" in data) {
          reject(new Error(data.error));
          return;
        }
        // the arrays come back from the worker, which had them
        giveBack(geometry.attributes.position, data.position);
        if (geometry.index && data.serialized.index) giveBack(geometry.index, data.serialized.index);
        const bvh = MeshBVH.deserialize(data.serialized, geometry, { setIndex: false });
        if (options.setBoundingBox !== false) geometry.boundingBox = bvh.getBoundingBox(new THREE.Box3());
        onProgress?.(1);
        resolve(bvh);
      };
    });
    const request: BuildRequest = { position, index, groups: geometry.groups.map((g) => ({ ...g })), options: rest };
    const transfer: Transferable[] = [position.buffer as ArrayBuffer];
    if (index) transfer.push(index.buffer as ArrayBuffer);
    worker.postMessage(request, transfer);
    return built.finally(() => {
      this.running = false;
      worker.onmessage = null;
      worker.onerror = null;
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}

/** Puts back an array lent to the worker. three's typings make it read-only; three-mesh-bvh's own worker sets it as here. */
function giveBack(attribute: object, array: ArrayBufferView): void {
  (attribute as { array: ArrayBufferView }).array = array;
}
