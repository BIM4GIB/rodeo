// Decodes a drawing's chunks in workers as it opens (readContainerStream), several slices at once:
// a large file opens in a fraction of the time, and the page keeps drawing and its Cancel works
// meanwhile. The same workers compress the stream as a drawing is written out (writeVwx). They
// start with the first drawing opened or saved and stay for the next. Where they cannot start,
// the work is done on the page's thread as before.

import { deflateChunks, inflateChunks } from "../core/container.ts";
import type { Deflate, Inflate } from "../core/index.ts";
import type { InflateReply, InflateRequest } from "./inflate.worker.ts";

interface Job {
  resolve(raw: Uint8Array): void;
  reject(err: Error): void;
}

/** the most workers; one core is left for the page */
const MAX_WORKERS = 8;

let workers: Worker[] | null = null;
/** set when a worker could not start or stopped: work on this thread from then on */
let broken = false;
const jobs = new Map<number, Job>();
let nextId = 0;

function start(): Worker[] | null {
  if (broken || typeof Worker === "undefined") return null;
  if (workers) return workers;
  const count = Math.min(MAX_WORKERS, Math.max(1, (navigator.hardwareConcurrency || 4) - 1));
  const pool: Worker[] = [];
  try {
    for (let i = 0; i < count; i++) {
      const w = new Worker(new URL("./inflate.worker.ts", import.meta.url), { type: "module" });
      pool.push(w);
      w.onmessage = ({ data }: MessageEvent<InflateReply>) => {
        const job = jobs.get(data.id);
        jobs.delete(data.id);
        if (!job) return;
        if ("error" in data) job.reject(new Error(data.error));
        else job.resolve(data.bytes);
      };
      w.onerror = (e) => {
        e.preventDefault();
        stop(pool);
      };
    }
    return (workers = pool);
  } catch {
    // Construction may fail partway through the pool; no inputs have been transferred yet.
    stop(pool);
    return null;
  }
}

function stop(pool: readonly Worker[]): void {
  broken = true;
  for (const job of jobs.values()) job.reject(new WorkerFailed());
  jobs.clear();
  for (const w of pool) w.terminate();
  workers = null;
}

class WorkerFailed extends Error {
  constructor() {
    super("Opening or saving stopped partway. Try again.");
  }
}

/** readContainerStream's inflate and how far ahead to read for it: the workers, or this thread when there are none. */
export function inflater(): { inflate: Inflate; ahead: number } {
  const pool = start();
  if (!pool) return { inflate: async (chunks, first, at) => inflateChunks(chunks, first, at), ahead: 1 };
  const count = pool.length;
  const inflate: Inflate = async (chunks, first, at) => {
    const length = chunks.byteLength;
    try {
      return await post({ chunks: own(chunks), first, at });
    } catch (err) {
      // A whole buffer was given away; retry only when the original input is still intact.
      if (err instanceof WorkerFailed && chunks.byteLength === length) return inflateChunks(chunks, first, at);
      throw err;
    }
  };
  // one slice waiting for each worker as it finishes the one before
  return { inflate, ahead: count * 2 };
}

/** writeVwx's deflate and how many runs to compress at once: the workers, or this thread when there are none. */
export function deflater(): { deflate: Deflate; ahead: number } {
  const pool = start();
  if (!pool) return { deflate: async (raw) => deflateChunks(raw), ahead: 1 };
  const count = pool.length;
  const deflate: Deflate = async (raw) => {
    const length = raw.byteLength;
    try {
      return await post({ raw: own(raw) });
    } catch (err) {
      if (err instanceof WorkerFailed && raw.byteLength === length) return deflateChunks(raw);
      throw err;
    }
  };
  return { deflate, ahead: count * 2 };
}

/** Bytes to give away to a worker: a view of part of a buffer is copied first, so nothing else is lost with it. */
function own(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
}

/** chunks to decode, or a run of the stream to compress */
type Work = { chunks: Uint8Array; first: number; at: number } | { raw: Uint8Array };

function post(work: Work): Promise<Uint8Array> {
  const pool = workers;
  if (!pool) return Promise.reject(new WorkerFailed());
  const id = nextId++;
  const bytes = "raw" in work ? work.raw : work.chunks;
  return new Promise<Uint8Array>((resolve, reject) => {
    jobs.set(id, { resolve, reject });
    const request: InflateRequest = { id, ...work };
    try {
      pool[id % pool.length].postMessage(request, [bytes.buffer as ArrayBuffer]);
    } catch (err) {
      jobs.delete(id);
      reject(err);
    }
  });
}
