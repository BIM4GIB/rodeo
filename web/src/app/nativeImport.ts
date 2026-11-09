// Converts a CAD part's file to STEP in a worker (nativeImport.worker.ts), so the seconds a SolidWorks
// conversion takes don't hold the page. One worker serves the conversions, one at a time. A worker whose
// module trapped can't convert again, so it is ended, and the next conversion starts another.

import type { CadConvert, Converted, NativeReply, NativeRequest } from "../import/native.ts";

let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

/** A CAD part converted to STEP in a worker, one conversion at a time: the converter the readers take (import/native.ts). */
export const convertInWorker: CadConvert = (format, bytes, name) => {
  const run = queue.then(() => convertOnce({ format, bytes, name }));
  queue = run.catch(() => undefined);
  return run;
};

/** One conversion in the worker: its answer, or the reason it failed. */
function convertOnce(req: NativeRequest): Promise<Converted> {
  return new Promise((resolve, reject) => {
    const w = (worker ??= new Worker(new URL("./nativeImport.worker.ts", import.meta.url), { type: "module" }));
    const end = (): void => {
      if (worker === w) worker = null;
      w.terminate();
    };
    w.onmessage = (e: MessageEvent<NativeReply>) => {
      const m = e.data;
      if (m.type === "done") return resolve(m.converted);
      if (m.trap) end();
      reject(new Error(m.message));
    };
    w.onerror = (e) => {
      end();
      reject(new Error(e.message || "the CAD reader stopped"));
    };
    w.postMessage({ format: req.format, bytes: req.bytes, name: req.name } satisfies NativeRequest);
  });
}
