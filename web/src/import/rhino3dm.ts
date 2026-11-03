// rhino3dm (McNeel's openNURBS compiled to WebAssembly, MIT), which reads and writes Rhino .3dm
// files for import/rhino.ts and export/rhino.ts. Its script and WebAssembly (2.7 MB) load only
// when a .3dm file is first imported or exported, once.

import type { Rhino } from "./rhino.ts";

let loading: Promise<Rhino> | null = null;

/** rhino3dm, loaded and initialised once; a failed load is tried again next time. */
export function rhinoLib(): Promise<Rhino> {
  loading ??= (async () => {
    const { default: rhino3dm } = await import("rhino3dm/rhino3dm.module.js");
    const wasm = new URL("../../node_modules/rhino3dm/rhino3dm.wasm", import.meta.url).href;
    return (await rhino3dm({ locateFile: () => wasm })) as Rhino;
  })().catch((err: unknown) => {
    loading = null;
    throw err;
  });
  return loading;
}
