// Worker failure and save integrity, with real transferable buffers and generated drawings.
// Run from web/: npx tsx src/app/inflate.check.ts

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { blankDrawing } from "../core/blank.ts";
import { deflateChunks, inflateChunks } from "../core/container.ts";
import { openVwx } from "../core/index.ts";
import type { InflateReply, InflateRequest } from "./inflate.worker.ts";

const cases = ["healthy", "unavailable", "startup", "partial-startup", "deflate-crash", "inflate-crash", "subarray-crash", "pending-crash", "post-throws", "file-save", "blob-save"];
const scenario = process.argv[2];
if (!scenario) {
  // The pool lives for the page's lifetime: each child is a fresh page, without test-only reset hooks.
  let failed = 0;
  for (const name of cases) {
    const child = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), name], { encoding: "utf8", timeout: 30_000 });
    if (child.status !== 0) {
      failed++;
      console.error(`FAIL ${name}\n${child.stdout}${child.stderr}${child.error ?? ""}`);
    } else console.log(`ok ${name}`);
  }
  assert.equal(failed, 0, `${failed} worker checks failed`);
} else {
  assert.ok(cases.includes(scenario), `unknown case ${scenario}`);
  let mode: "healthy" | "crash" | "throw" = "healthy";
  const instances: TestWorker[] = [];
  let attempts = 0;
  class TestWorker {
    onmessage: ((e: { data: InflateReply }) => void) | null = null;
    onerror: ((e: { preventDefault(): void }) => void) | null = null;
    terminated = false;
    constructor() {
      attempts++;
      if (scenario === "startup" || (scenario === "partial-startup" && attempts === 2)) throw new Error("Worker construction refused");
      instances.push(this);
    }
    postMessage(request: InflateRequest, transfer: Transferable[]): void {
      if (mode === "throw") throw new Error("postMessage refused");
      const copy = structuredClone(request, { transfer });
      const crash = mode === "crash";
      queueMicrotask(() => {
        if (this.terminated) return;
        if (crash) this.onerror?.({ preventDefault() {} });
        else {
          try {
            const bytes = "raw" in copy ? deflateChunks(copy.raw) : inflateChunks(copy.chunks, copy.first, copy.at);
            this.onmessage?.({ data: { id: copy.id, bytes } });
          } catch (err) {
            this.onmessage?.({ data: { id: copy.id, error: String(err) } });
          }
        }
      });
    }
    terminate(): void {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, "navigator", { value: { hardwareConcurrency: 3 }, configurable: true });
  Object.defineProperty(globalThis, "Worker", { value: scenario === "unavailable" ? undefined : TestWorker, configurable: true });
  const { deflater, inflater } = await import("./inflate.ts");
  const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
  const compressed = deflateChunks(raw);
  const view = (bytes: Uint8Array): Uint8Array => {
    const buffer = new Uint8Array(bytes.length + 2);
    buffer.set(bytes, 1);
    return buffer.subarray(1, -1);
  };
  const same = (a: Uint8Array, b: Uint8Array): void => assert.deepEqual([...a], [...b]);

  if (["healthy", "unavailable", "startup", "partial-startup"].includes(scenario)) {
    for (const bytes of [raw.slice(), view(raw)]) same(await deflater().deflate(bytes), compressed);
    for (const bytes of [compressed.slice(), view(compressed)]) same(await inflater().inflate(bytes, 0, 0), raw);
    if (scenario !== "healthy") {
      assert.equal(deflater().ahead, 1);
      assert.ok(instances.every(w => w.terminated), "partly started workers are terminated");
    } else {
      await assert.rejects(inflater().inflate(new Uint8Array([1, 2, 3]), 0, 0), /bad chunk/);
      same(await deflater().deflate(raw.slice()), compressed);
    }
  } else if (["deflate-crash", "inflate-crash", "pending-crash"].includes(scenario)) {
    mode = "crash";
    const encode = deflater(), decode = inflater();
    const input = scenario === "inflate-crash" ? compressed.slice() : raw.slice();
    const first = scenario === "inflate-crash" ? decode.inflate(input, 0, 0) : encode.deflate(input);
    const pending = [first];
    if (scenario === "pending-crash") pending.push(encode.deflate(raw.slice()), decode.inflate(compressed.slice(), 0, 0));
    const outcomes = await Promise.allSettled(pending);
    assert.equal(input.byteLength, 0, "input was really transferred");
    assert.ok(outcomes.every(r => r.status === "rejected"), "transferred jobs must fail, never return empty bytes");
    assert.ok(instances.every(w => w.terminated));
    // Even callbacks captured before the failure can safely handle later, intact input.
    same(await encode.deflate(raw.slice()), compressed);
    same(await decode.inflate(compressed.slice(), 0, 0), raw);
    assert.equal(deflater().ahead, 1);
    assert.equal(inflater().ahead, 1);
  } else if (scenario === "subarray-crash") {
    mode = "crash";
    const a = view(raw), b = view(compressed);
    const [encoded, decoded] = await Promise.all([deflater().deflate(a), inflater().inflate(b, 0, 0)]);
    same(encoded, compressed);
    same(decoded, raw);
    same(a, raw);
    same(b, compressed);
    assert.ok(instances.every(w => w.terminated));
  } else if (scenario === "post-throws") {
    mode = "throw";
    await assert.rejects(deflater().deflate(raw.slice()), /postMessage refused/);
    mode = "healthy";
    same(await deflater().deflate(raw.slice()), compressed);
  } else {
    const session = openVwx(blankDrawing("mm"));
    session.addObjects(session.doc.layers()[0].id, Array.from({ length: 20 }, (_, i) => ({ kind: "line", a: { x: i, y: 0 }, b: { x: i + 1, y: 1 } })));
    const { documentBlob, writeToFile } = await import("./writeOut.ts");
    mode = "crash";
    if (scenario === "blob-save") {
      await assert.rejects(documentBlob(session), /stopped partway/i);
      const retry = openVwx(new Uint8Array(await (await documentBlob(session)).arrayBuffer()));
      assert.equal(retry.doc.objects(retry.doc.layers()[0].id).length, 20);
    } else {
      const original = blankDrawing("mm");
      let persisted: Uint8Array = original;
      let closed = 0, aborted = 0;
      const handle = {
        getFile: async () => new File([persisted as Uint8Array<ArrayBuffer>], "generated.vwx"),
        createWritable: async () => {
          const parts: Uint8Array[] = [];
          return {
            write: async (data: Uint8Array | { position: number; data: Uint8Array }) => {
              if (data instanceof Uint8Array) parts.push(data.slice());
              else parts[0].set(data.data, data.position);
            },
            close: async () => { persisted = Buffer.concat(parts); closed++; },
            abort: async () => { aborted++; },
          };
        },
      } as unknown as FileSystemFileHandle;
      await assert.rejects(writeToFile(session, handle, { follow: false }), /stopped partway/i);
      assert.equal(closed, 0, "failed save must not replace the file");
      assert.equal(aborted, 1);
      same(persisted, original);
      assert.equal(session.dirty, true);
      await writeToFile(session, handle, { follow: false });
      assert.equal(closed, 1);
      const retry = openVwx(persisted);
      assert.equal(retry.doc.objects(retry.doc.layers()[0].id).length, 20);
    }
  }
}
