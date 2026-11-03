// HTTP plumbing: CORS for the configured origins, the CSRF header check, JSON bodies, a log line
// for slow or failed requests, and the error handler that turns HttpError into { error, code }
// answers (any other error is a 500, logged and passed to onServerError's listeners).

import type { Context, MiddlewareHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { config } from "./config.ts";
import { fail, HttpError } from "./util.ts";

const ALLOW_HEADERS = "Content-Type, X-Requested-With, X-File-Name, X-Base-Version, X-Version-Label, X-Collab-Seq, X-Upload-Id, X-Upload-Size, X-Autosave";
const EXPOSE_HEADERS = "X-Version-Id, X-Collab-Seq";

/** CORS with credentials, only for CORS_ORIGINS (development). */
export const cors: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = origin !== undefined && config.corsOrigins.includes(origin);
  if (origin !== undefined && allowed) {
    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    c.header("Access-Control-Expose-Headers", EXPOSE_HEADERS);
    c.header("Vary", "Origin");
  }
  if (c.req.method === "OPTIONS") {
    if (allowed) {
      c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      c.header("Access-Control-Allow-Headers", ALLOW_HEADERS);
      c.header("Access-Control-Max-Age", "600");
    }
    return c.body(null, 204);
  }
  await next();
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Every change under /api must send X-Requested-With: openvwx (a CSRF guard). */
export const csrf: MiddlewareHandler = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method) && c.req.path !== "/api/billing/webhook" && c.req.header("x-requested-with") !== "openvwx") {
    return c.json({ error: "This request must come from the Rodeo editor", code: "forbidden" }, 403);
  }
  await next();
};

/**
 * A request to one of REDIRECT_HOSTS goes to the same path on PUBLIC_URL, for good: sign-in
 * works only on PUBLIC_URL (its cookies and the OAuth return address are there).
 */
export const redirectHosts: MiddlewareHandler = async (c, next) => {
  const host = (c.req.header("host") ?? "").toLowerCase().replace(/:\d+$/, "");
  if (config.redirectHosts.has(host)) {
    const url = new URL(c.req.url);
    return c.redirect(`${config.publicUrl}${url.pathname}${url.search}`, 301);
  }
  await next();
};

/**
 * API answers are never cached unless a route says otherwise: a CDN in front (Cloudflare) must
 * not keep one person's /api/me or drawing list and hand it to the next.
 */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.res.headers.set("Cache-Control", "private, no-store");
};

/** A JSON object body (at most `max` bytes). */
export async function readJson(c: Context, max = 4 * 1024 * 1024): Promise<Record<string, unknown>> {
  const value = await readJsonAny(c, max);
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "Expected a JSON object");
  return value as Record<string, unknown>;
}

/** A JSON body of any shape (null included). */
export async function readJsonAny(c: Context, max = 4 * 1024 * 1024): Promise<unknown> {
  if (Number(c.req.header("content-length") ?? 0) > max) fail(413, "The request is too large", "too_large");
  const text = await c.req.text();
  if (text.length > max) fail(413, "The request is too large", "too_large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return fail(400, "The request is not valid JSON");
  }
}

/** API requests that take longer than this are logged, with their size */
const SLOW_MS = 8000;

/** Logs an API request that failed on the server or was slow (an upload on a poor line, a stuck call). */
export const requestLog: MiddlewareHandler = async (c, next) => {
  const start = performance.now();
  await next();
  const ms = performance.now() - start;
  const status = c.res.status;
  if (status < 500 && ms < SLOW_MS) return;
  const size = Number(c.req.header("content-length") ?? 0);
  const sent = size > 0 ? ` ${(size / 1048576).toFixed(1)} MB in` : "";
  console.error(`[${status >= 500 ? "error" : "slow"}] ${c.req.method} ${c.req.path} ${status}${sent} ${(ms / 1000).toFixed(1)} s`);
};

const errorListeners: ((err: Error, c: Context) => void)[] = [];

/** Calls `fn` with each error the server didn't expect (a 500), after it is logged. */
export function onServerError(fn: (err: Error, c: Context) => void): void {
  errorListeners.push(fn);
}

export function onError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    const body = err.code ? { error: err.message, code: err.code } : { error: err.message };
    // Cloudflare (in front of rodeo.build) swaps an origin's 502 or 504 for its own HTML page, and
    // the reason with it: a service behind this one failing goes out as 503, which it passes on
    const status = err.status === 502 || err.status === 504 ? 503 : err.status;
    return c.json(body, status as ContentfulStatusCode);
  }
  console.error(`[${c.req.method} ${c.req.path}]`, err);
  for (const fn of errorListeners) fn(err, c);
  return c.json({ error: "Something went wrong on the server" }, 500);
}

export function apiNotFound(c: Context): Response {
  return c.json({ error: "Not found", code: "not_found" }, 404);
}
