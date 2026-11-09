// The Parasolid mesher for Node: the command line's converter (node.ts gives it to write.ts as
// libraries().xt) and the checks. cadmpeg's WebAssembly comes from web/vendor/cadmpeg-xt and is
// loaded the way node.ts loads the other readers. In a browser the worker does this instead
// (app/parasolidDecode.ts).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { stopsAfterTrap, type XtMesher } from "../core/parasolid.ts";

/**
 * cadmpeg's mesher, initialised; its WebAssembly is read from `dir` when given, else beside the glue. After a trap
 * (cadmpeg is built with panic = "abort") this instance is unusable, and initSync keeps the first instance, so
 * drainXt stops for the drawing instead of starting again, and every later drawing stops at its first solid.
 */
export async function loadXtMesherNode(dir?: string): Promise<XtMesher> {
  const xt = await import("../../vendor/cadmpeg-xt/cadmpeg_xt.js");
  const wasm = dir ? join(dir, "cadmpeg_xt_bg.wasm") : fileURLToPath(new URL("../../vendor/cadmpeg-xt/cadmpeg_xt_bg.wasm", import.meta.url));
  xt.initSync({ module: readFileSync(wasm) });
  return stopsAfterTrap({ mesh: xt.xt_mesh, report: xt.xt_last_report });
}
