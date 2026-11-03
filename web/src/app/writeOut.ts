// Writing drawings out. A large file opens with its big parts nothing reads left in it (core/held.ts),
// so its drawing can only be written a slice at a time (EditSession.doc.write), the parts read back
// from the file as it goes; any drawing saved to a file is written that way, compressed in the
// inflate workers, so a big one doesn't stop the page while it saves.
//
// A drawing's held parts are read from the file it was opened from. Saved over that file, they are
// read from the new one, where the save put them; a part the save didn't write (an object deleted
// and still in the undo history) is read into memory first, before the file it was in is replaced.

import { blobSource, type ByteSource, type EditSession, FileStream, heldTables, type StreamOptions, type VwxSink, type Written } from "../core/index.ts";
import { deflater, inflater } from "./inflate.ts";

/** files this big open with their big unread parts left in them */
export const HOLD_FROM = 256 << 20;

/** How to open `data` (StreamOptions): a large file's big unread parts are left in it, and read from it again should it change on disk. */
export function holdOptions(data: Uint8Array | Blob, handle: FileSystemFileHandle | null): Pick<StreamOptions, "hold" | "refresh"> {
  if (data instanceof Uint8Array || data.size < HOLD_FROM) return {};
  return { hold: true, refresh: handle ? () => fileAgain(handle) : undefined };
}

async function fileAgain(handle: FileSystemFileHandle): Promise<ByteSource | null> {
  try {
    return blobSource(await handle.getFile());
  } catch {
    return null;
  }
}

/** Whether `a` is the file `b` is, as it was when read: same name, size and time. */
function sameFile(a: Blob | undefined, b: File): boolean {
  return a instanceof File && a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;
}

export interface WriteToFile {
  /** the drawing goes on with this file (Save, Save As): its held parts are read from it from now on */
  readonly follow: boolean;
  readonly onProgress?: (fraction: number) => void;
  readonly signal?: AbortSignal;
}

/** Writes the drawing to `handle`'s file a slice at a time, replacing it only once all is written. */
export async function writeToFile(session: EditSession, handle: FileSystemFileHandle, options: WriteToFile): Promise<void> {
  const before = await handle.getFile().catch(() => null);
  const writable = await handle.createWritable();
  const sink: VwxSink = {
    write: (bytes) => writable.write(bytes as Uint8Array<ArrayBuffer>),
    patch: (at, bytes) => writable.write({ type: "write", position: at, data: bytes as Uint8Array<ArrayBuffer> }),
  };
  let written: Written;
  /** whether the file replaced is one held parts were read from */
  let replacing = false;
  try {
    written = await session.doc.write(sink, { ...deflater(), onProgress: options.onProgress, signal: options.signal });
    if (before) {
      for (const table of heldTables()) {
        for (const entry of table.entries) {
          const from = entry.from;
          if (!(from instanceof FileStream) || !sameFile(from.file, before)) continue;
          replacing = true;
          if (!written.placed.has(entry)) await entry.load();
        }
      }
    }
    await writable.close();
  } catch (err) {
    await writable.abort().catch(() => undefined);
    throw err;
  }
  if (!written.placed.size || !(options.follow || replacing)) return;
  const stream = new FileStream(blobSource(await handle.getFile()), written.chunks, inflater().inflate, () => fileAgain(handle));
  for (const [entry, at] of written.placed) entry.moveTo(stream, at);
}

/** The drawing written out, in parts (each a slice of the file, the header patched once its size is known). */
async function writtenParts(session: EditSession, onProgress?: (fraction: number) => void): Promise<Uint8Array<ArrayBuffer>[]> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  await session.doc.write(
    {
      write: async (bytes) => void parts.push(bytes as Uint8Array<ArrayBuffer>),
      patch: async (at, bytes) => parts[0].set(bytes, at),
    },
    { ...deflater(), onProgress },
  );
  return parts;
}

/** The drawing as a .vwx file to download or send, without its bytes in one piece. */
export async function documentBlob(session: EditSession, onProgress?: (fraction: number) => void): Promise<Blob> {
  return new Blob(await writtenParts(session, onProgress), { type: "application/octet-stream" });
}

/** The drawing as .vwx bytes: toBytes() unless parts of it are still in its file, when they are read back as it is written. */
export async function documentBytes(session: EditSession): Promise<Uint8Array> {
  if (!session.doc.holdsParts()) return session.doc.toBytes();
  const parts = await writtenParts(session);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
