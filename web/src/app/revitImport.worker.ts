// The worker a Revit import runs in (revitFile.ts starts it): it loads rvt-rs's WebAssembly, reads
// the model, makes the drawing (revitImport.ts) and answers with its bytes, saying each step as it goes.

import init, * as rvt from "../../vendor/rvt-rs/rvt.js";
import { readWith } from "../import/rvtModel.ts";
import { revitDrawing, type RevitReply, type RevitRequest } from "./revitImport.ts";

const post = (m: RevitReply, transfer: Transferable[] = []): void => self.postMessage(m, { transfer });
const say = (step: string): void => post({ type: "progress", step });

self.onmessage = async (e: MessageEvent<RevitRequest>) => {
  try {
    say("Loading the Revit reader");
    await init({ module_or_path: new URL("../../vendor/rvt-rs/rvt_bg.wasm", import.meta.url) });
    const drawing = revitDrawing(readWith(rvt, e.data.bytes, say), e.data.name, say);
    post({ type: "done", drawing }, [drawing.bytes.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
