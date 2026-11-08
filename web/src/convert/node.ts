// The converter's Node setup. Importing this file once, for its side effects, lets the converter run
// under Node (the command line, the MCP server's headless mode, the checks): it installs a FileReader
// for three's glTF exporter, which Node lacks, and hands the converter the WebAssembly readers loaded
// the way Node loads them (web-ifc, rhino3dm, occt-import-js and rvt-rs). A browser never imports this
// file; a page hands its own loaders to useLibraries instead.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IfcReader } from "../import/ifc.ts";
import { loadOcct } from "../import/occt.ts";
import type { Rhino } from "../import/rhino.ts";
import { type Libraries, type RvtModule, useLibraries } from "./libs.ts";

let wasmDir: string | null = null;

/** Where the bundled rvt_bg.wasm sits when the converter isn't run from the source tree. */
export function setWasmDir(dir: string): void {
  wasmDir = dir;
}

/** A FileReader made from Blob.arrayBuffer, the two reads three's glTF exporter makes. */
class NodeFileReader {
  result: string | ArrayBuffer | null = null;
  onload: ((e: { target: NodeFileReader }) => void) | null = null;
  onloadend: ((e: { target: NodeFileReader }) => void) | null = null;
  onerror: ((e: { target: NodeFileReader }) => void) | null = null;

  readAsArrayBuffer(blob: Blob): void {
    this.settle(blob.arrayBuffer());
  }

  readAsDataURL(blob: Blob): void {
    this.settle(blob.arrayBuffer().then((buf) => `data:${blob.type || "application/octet-stream"};base64,${Buffer.from(buf).toString("base64")}`));
  }

  private settle(read: Promise<string | ArrayBuffer>): void {
    read.then(
      (result) => {
        this.result = result;
        this.onload?.({ target: this });
        this.onloadend?.({ target: this });
      },
      () => {
        this.onerror?.({ target: this });
        this.onloadend?.({ target: this });
      },
    );
  }
}

// Node has no FileReader; a browser's own is kept.
if (globalThis.FileReader === undefined) {
  globalThis.FileReader = NodeFileReader as unknown as typeof FileReader;
}

/** A loader that loads once and hands back the same thing after; a failed load is tried again next time. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let loading: Promise<T> | null = null;
  return () => {
    loading ??= load().catch((err: unknown) => {
      loading = null;
      throw err;
    });
    return loading;
  };
}

useLibraries({
  // web-ifc's Node build finds its WebAssembly beside it, so Init takes no locate function
  ifc: once(async (): Promise<IfcReader> => {
    const lib = (await import("web-ifc")) as unknown as IfcReader["lib"];
    const api = new lib.IfcAPI();
    await api.Init();
    return { lib, api };
  }),
  rhino: once(async (): Promise<Rhino> => {
    const { default: rhino3dm } = await import("rhino3dm");
    return (await rhino3dm()) as Rhino;
  }),
  // occt-import-js's Node build finds its WebAssembly beside its script (the command line copies it there)
  occt: once(() => loadOcct()),
  revit: once(async (): Promise<RvtModule> => {
    const rvt = await import("../../vendor/rvt-rs/rvt.js");
    const wasmPath = wasmDir ? join(wasmDir, "rvt_bg.wasm") : fileURLToPath(new URL("../../vendor/rvt-rs/rvt_bg.wasm", import.meta.url));
    rvt.initSync({ module: readFileSync(wasmPath) });
    return rvt;
  }),
} satisfies Libraries);
