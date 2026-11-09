// The worker that meshes Parasolid bodies for the 3D view (parasolidDecode.ts starts it). It loads
// cadmpeg's WebAssembly the first time a batch arrives, meshes each batch in turn (parasolid.ts) and
// answers with the triangles, which are moved to the page rather than copied. cadmpeg is built with
// panic = "abort", so a panic is a trap that leaves its instance unusable: the answer then says
// `restart`, and the page replaces this worker (parasolidDecode.ts).

import init, * as xt from "../../vendor/cadmpeg-xt/cadmpeg_xt.js";
import { meshJobs, type XtMesher, type XtReply, type XtRequest } from "../core/parasolid.ts";

let mesher: Promise<XtMesher> | null = null;

/** cadmpeg's mesher, loaded once; a failed load is tried again with the next batch. */
function loadMesher(): Promise<XtMesher> {
  mesher ??= (async () => {
    await init({ module_or_path: new URL("../../vendor/cadmpeg-xt/cadmpeg_xt_bg.wasm", import.meta.url) });
    return { mesh: xt.xt_mesh, report: xt.xt_last_report };
  })().catch((err: unknown) => {
    mesher = null;
    throw err;
  });
  return mesher;
}

const post = (m: XtReply, transfer: Transferable[] = []): void => self.postMessage(m, { transfer });

self.onmessage = async (e: MessageEvent<XtRequest>) => {
  let results;
  try {
    results = meshJobs(e.data.jobs, await loadMesher());
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    return;
  }
  const transfer = results.flatMap((r) => (r.triangles ? [r.triangles.buffer] : []));
  post({ type: "done", results, restart: results.some((r) => r.trap) }, transfer);
};
