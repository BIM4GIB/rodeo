// The worker a CAD part's conversion runs in (nativeImport.ts starts it): it loads the WebAssembly of the
// part's format, converts the file to STEP and answers with the STEP and what cadmpeg reported. The
// modules abort on a panic, which leaves the module unusable, so after a trap the page ends this worker and
// starts another; the modules loaded here are kept for the requests this worker serves otherwise.

import { answerNative, type Cadmpeg, type CadFormat, initCadmpeg, type NativeReply, type NativeRequest, WASM } from "../import/native.ts";

/** Each format's module, loaded once in this worker; a failed load is tried again next time. */
const loaded = new Map<CadFormat, Promise<Cadmpeg>>();

function moduleOf(format: CadFormat): Promise<Cadmpeg> {
  let at = loaded.get(format);
  if (!at) {
    at = initCadmpeg(format, WASM[format]());
    at.catch(() => loaded.delete(format));
    loaded.set(format, at);
  }
  return at;
}

self.onmessage = async (e: MessageEvent<NativeRequest>) => {
  const reply: NativeReply = await answerNative(e.data, moduleOf);
  self.postMessage(reply);
};
