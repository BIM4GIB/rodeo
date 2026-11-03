// Stored bytes (drawings, thumbnails, voice notes). An upload streams to a temp file in
// DATA_DIR/tmp while it is hashed, then is renamed to DATA_DIR/blobs/xx/<id>. A blob is
// deleted once no version, voice note or thumbnail refers to it.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { config } from "./config.ts";
import { get } from "./db.ts";
import { fail, formatBytes, newId } from "./util.ts";

export interface Received {
  readonly tmp: string;
  readonly size: number;
  readonly sha256: string;
}

/** Streams a request body to a temp file, hashing it; refuses more than `max` bytes. */
export async function receiveBody(req: Request, max: number, what = "The upload"): Promise<Received> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max) fail(413, `${what} is larger than ${formatBytes(max)}`, "too_large");
  if (!req.body) fail(400, "Nothing was uploaded");

  const tmp = join(config.tmpDir, newId());
  const hash = createHash("sha256");
  let size = 0;
  try {
    await pipeline(
      Readable.fromWeb(req.body as unknown as NodeWebReadableStream),
      async function* (source) {
        for await (const chunk of source) {
          size += chunk.byteLength;
          if (size > max) fail(413, `${what} is larger than ${formatBytes(max)}`, "too_large");
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(tmp),
    );
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  if (size === 0) {
    await rm(tmp, { force: true });
    fail(400, "Nothing was uploaded");
  }
  return { tmp, size, sha256: hash.digest("hex") };
}

/** Moves a received upload into the blob store; returns its id. */
export async function commitBlob(r: Pick<Received, "tmp">): Promise<string> {
  const id = newId();
  const dir = join(config.blobsDir, id.slice(0, 2));
  await mkdir(dir, { recursive: true });
  await rename(r.tmp, join(dir, id));
  return id;
}

export function blobPath(id: string): string {
  return join(config.blobsDir, id.slice(0, 2), id);
}

/** Deletes the given blobs that nothing refers to any more. Call after the change is committed. */
export async function releaseBlobs(ids: Iterable<string | null | undefined>): Promise<void> {
  for (const id of new Set(ids)) {
    if (!id) continue;
    const refs = get<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM versions WHERE blob = ?) + (SELECT COUNT(*) FROM audio WHERE blob = ?)
        + (SELECT COUNT(*) FROM files WHERE thumbnail_blob = ?) AS n`,
      id,
      id,
      id,
    );
    if (refs && refs.n > 0) continue;
    await rm(blobPath(id), { force: true });
  }
}

/** The size of a stored blob, or null if its file is missing. */
export async function blobSize(id: string): Promise<number | null> {
  const st = await stat(blobPath(id)).catch(() => null);
  return st && st.isFile() ? st.size : null;
}

/** The first n bytes of a file (for checking a file type). */
export async function headBytes(path: string, n: number): Promise<Buffer> {
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}
