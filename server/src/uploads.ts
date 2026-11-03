// Uploads sent in parts. A proxy in front of the server can refuse a large request outright
// (Cloudflare takes at most 100 MB a request), and one long request shows no progress and is
// lost whole when the line drops. So a large drawing or render job goes up in parts:
//
//   POST /api/uploads            header X-Upload-Size: the whole size  → { id }
//   PUT  /api/uploads/:id?offset=n  the next part, at byte n            → { size }
//   GET  /api/uploads/:id         how much has arrived                  → { size }
//
// then the call that takes the bytes (POST /api/files, PUT /api/files/:id/content, POST
// /api/render/jobs) is sent with no body and X-Upload-Id instead. A part that fails part way
// is cut off again, so it can be sent once more from the same offset. An upload not used within
// an hour is dropped.

import { createReadStream, createWriteStream } from "node:fs";
import { rm, truncate } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { createHash } from "node:crypto";
import type { Hono } from "hono";
import { requireUser } from "./auth.ts";
import { receiveBody, type Received } from "./blobs.ts";
import { config } from "./config.ts";
import { fail, formatBytes, HOUR, MB, newId } from "./util.ts";

/** the largest part taken in one request: under what Cloudflare lets through */
const MAX_PART = 64 * MB;
/** uploads one user may have open at once */
const OPEN_PER_USER = 4;

interface Upload {
  readonly userId: string;
  readonly tmp: string;
  /** the size declared at the start; the upload is done when this much has arrived */
  readonly total: number;
  size: number;
  busy: boolean;
  touched: number;
}

const uploads = new Map<string, Upload>();

function ownUpload(id: string, userId: string): Upload {
  const u = uploads.get(id);
  if (!u || u.userId !== userId) fail(404, "That upload has expired or never started. Try again.", "not_found");
  return u;
}

async function drop(id: string): Promise<void> {
  const u = uploads.get(id);
  if (!u) return;
  uploads.delete(id);
  await rm(u.tmp, { force: true });
}

/** Drops uploads not touched for an hour (housekeeping). */
export async function sweepUploads(): Promise<void> {
  const old = Date.now() - HOUR;
  for (const [id, u] of uploads) if (!u.busy && u.touched < old) await drop(id);
}

/**
 * The bytes of a request that takes a drawing or a job: its body, or with X-Upload-Id the upload
 * sent in parts (it must be whole). Either way they end in a temp file, hashed.
 */
export async function receiveUpload(req: Request, userId: string, max: number, what: string): Promise<Received> {
  const id = req.headers.get("x-upload-id");
  if (!id) return receiveBody(req, max, what);
  const u = ownUpload(id, userId);
  if (u.busy) fail(409, "That upload is still receiving a part", "conflict");
  if (u.size !== u.total) fail(400, `Only ${formatBytes(u.size)} of ${formatBytes(u.total)} has arrived`);
  if (u.size > max) fail(413, `${what} is larger than ${formatBytes(max)}`, "too_large");
  uploads.delete(id);
  const hash = createHash("sha256");
  try {
    await pipeline(createReadStream(u.tmp), hash);
  } catch (e) {
    await rm(u.tmp, { force: true });
    throw e;
  }
  return { tmp: u.tmp, size: u.size, sha256: hash.digest("hex") };
}

export function registerUploads(app: Hono): void {
  app.post("/api/uploads", async (c) => {
    const user = requireUser(c);
    const total = Number(c.req.header("x-upload-size"));
    if (!Number.isSafeInteger(total) || total <= 0) fail(400, "X-Upload-Size must be the upload's size in bytes");
    if (total > config.maxUploadBytes) fail(413, `The upload is larger than ${formatBytes(config.maxUploadBytes)}`, "too_large");
    const mine = [...uploads.entries()].filter(([, u]) => u.userId === user.id);
    if (mine.length >= OPEN_PER_USER) {
      // the oldest goes: an upload abandoned when its page closed
      mine.sort(([, a], [, b]) => a.touched - b.touched);
      await drop(mine[0][0]);
    }
    const id = newId();
    const tmp = join(config.tmpDir, `upload-${id}`);
    await rm(tmp, { force: true });
    uploads.set(id, { userId: user.id, tmp, total, size: 0, busy: false, touched: Date.now() });
    return c.json({ id }, 201);
  });

  app.get("/api/uploads/:id", (c) => {
    const u = ownUpload(c.req.param("id"), requireUser(c).id);
    return c.json({ size: u.size, total: u.total });
  });

  app.put("/api/uploads/:id", async (c) => {
    const u = ownUpload(c.req.param("id"), requireUser(c).id);
    const offset = Number(c.req.query("offset"));
    if (u.busy) fail(409, "A part of this upload is arriving already", "conflict");
    if (offset !== u.size) fail(409, `The next part starts at byte ${u.size}`, "offset");
    if (!c.req.raw.body) fail(400, "Nothing was uploaded");
    u.busy = true;
    u.touched = Date.now();
    let got = 0;
    try {
      await pipeline(
        Readable.fromWeb(c.req.raw.body as unknown as NodeWebReadableStream),
        async function* (source) {
          for await (const chunk of source) {
            got += chunk.byteLength;
            if (got > MAX_PART) fail(413, `A part is larger than ${formatBytes(MAX_PART)}`, "too_large");
            if (u.size + got > u.total) fail(400, "The upload is longer than its X-Upload-Size");
            yield chunk;
          }
        },
        createWriteStream(u.tmp, { flags: "a" }),
      );
      u.size += got;
    } catch (e) {
      // what arrived of this part goes, so it can be sent again from the same offset
      await truncate(u.tmp, u.size).catch(() => undefined);
      throw e;
    } finally {
      u.busy = false;
      u.touched = Date.now();
    }
    return c.json({ size: u.size, total: u.total });
  });
}
