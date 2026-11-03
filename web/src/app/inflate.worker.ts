// Decodes a run of a drawing's chunks off the page's thread (inflate.ts), for readContainerStream:
// it takes the chunks' bytes and sends back their part of the record stream. It also compresses
// runs of the stream into chunks, for writeVwx.

import { deflateChunks, inflateChunks } from "../core/container.ts";

export type InflateRequest =
  | {
      readonly id: number;
      readonly chunks: Uint8Array;
      /** the first chunk's number and file offset, for errors */
      readonly first: number;
      readonly at: number;
    }
  | { readonly id: number; readonly raw: Uint8Array };

export type InflateReply = { readonly id: number; readonly bytes: Uint8Array } | { readonly id: number; readonly error: string };

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<InflateRequest>) => void) | null;
  postMessage(message: InflateReply, transfer?: Transferable[]): void;
};

scope.onmessage = ({ data }) => {
  try {
    const bytes = "raw" in data ? deflateChunks(data.raw) : inflateChunks(data.chunks, data.first, data.at);
    scope.postMessage({ id: data.id, bytes }, [bytes.buffer as ArrayBuffer]);
  } catch (err) {
    scope.postMessage({ id: data.id, error: err instanceof Error ? err.message : String(err) });
  }
};
