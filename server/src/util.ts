// Small shared helpers: errors, ids and tokens, text cleaning, redirects, file streams.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

/** An error the API answers with a status and a { error, code? } body. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export function fail(status: number, message: string, code?: string): never {
  throw new HttpError(status, message, code);
}

/** A 16-byte id, base64url. */
export function newId(): string {
  return randomBytes(16).toString("base64url");
}

/** A 32-byte secret, base64url. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** The ISO time `ms` from now (negative: in the past). */
export function inMs(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A single-line text field: control characters become spaces, trimmed, at most `max` characters. */
export function cleanLine(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return Array.from(v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim())
    .slice(0, max)
    .join("");
}

/** A longer text field (comment bodies): line breaks are kept. */
export function cleanBody(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return Array.from(
    v
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, "")
      .trim(),
  )
    .slice(0, max)
    .join("");
}

/** Redirect targets: only paths on this site ("/..." but not "//" or "/\"), else "/". */
export function safePath(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/") || v.startsWith("//") || v.startsWith("/\\") || /[\u0000-\u001f\u007f]/.test(v)) {
    return "/";
  }
  return v;
}

/** The path with signed-in=1 added to its query. */
export function signedInPath(path: string): string {
  const u = new URL(path, "http://openvwx.invalid");
  u.searchParams.set("signed-in", "1");
  return u.pathname + u.search + u.hash;
}

/** A file's bytes as a web stream (read from disk as the response goes out). */
export function fileStream(path: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
}

export function formatBytes(n: number): string {
  if (n >= GB) return `${+(n / GB).toFixed(1)} GB`;
  if (n >= MB) return `${+(n / MB).toFixed(1)} MB`;
  if (n >= KB) return `${+(n / KB).toFixed(1)} KB`;
  return `${n} bytes`;
}
