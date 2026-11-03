// The worker an Archicad import runs in (plnImport.ts starts it): it reads the dropped file by
// ranges, makes the drawing (archicadImport.ts) and answers with its bytes, saying each step as it goes.

import { archicadDrawing, type ArchicadReply, type ArchicadRequest } from "./archicadImport.ts";

const post = (m: ArchicadReply, transfer: Transferable[] = []): void => self.postMessage(m, { transfer });
const say = (step: string): void => post({ type: "progress", step });

self.onmessage = async (e: MessageEvent<ArchicadRequest>) => {
  const { file, name } = e.data;
  try {
    const read = async (offset: number, length: number): Promise<Uint8Array> => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    const drawing = await archicadDrawing(read, file.size, name, say);
    post({ type: "done", drawing }, [drawing.bytes.buffer]);
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
