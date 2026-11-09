// The worker a Revit import runs in (revitFile.ts starts it): it loads rvt-rs's WebAssembly, reads
// the model, makes the drawing (revitImport.ts) and answers with its bytes, saying each step as it
// goes. Then, with the drawing open, it loads the build of rvt-rs that has the slow last pass
// (vendor/rvt-rs-detail), reads the file again for the elements only that pass draws in full and,
// when there are any, answers with the drawing made again with them.

import init, * as rvt from "../../vendor/rvt-rs/rvt.js";
import { readDetailWith, readWith } from "../import/rvtModel.ts";
import { revitDrawing, type RevitReply, type RevitRequest } from "./revitImport.ts";

const post = (m: RevitReply, transfer: Transferable[] = []): void => self.postMessage(m, { transfer });
const say = (step: string): void => post({ type: "progress", step });

self.onmessage = async (e: MessageEvent<RevitRequest>) => {
  let read;
  try {
    say("Loading the Revit reader");
    await init({ module_or_path: new URL("../../vendor/rvt-rs/rvt_bg.wasm", import.meta.url) });
    read = readWith(rvt, e.data.bytes, say);
    const drawing = revitDrawing(read, e.data.name, say);
    post({ type: "done", drawing }, [drawing.bytes.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
    return;
  }
  try {
    const detail = await import("../../vendor/rvt-rs-detail/rvt.js");
    await detail.default({ module_or_path: new URL("../../vendor/rvt-rs-detail/rvt_bg.wasm", import.meta.url) });
    const more = readDetailWith(detail, e.data.bytes, read);
    const drawing = more ? revitDrawing(more.read, e.data.name) : null;
    post({ type: "detail", drawing, count: more?.count ?? 0 }, drawing ? [drawing.bytes.buffer] : []);
  } catch {
    // the drawing as opened stands
    post({ type: "detail", drawing: null, count: 0 });
  }
};
