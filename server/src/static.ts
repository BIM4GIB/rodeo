// Serves the built editor (WEB_DIST): long cache for /assets, no cache for index.html and
// sw.js, admin.html at /admin (the admin page, admin.ts), and index.html for any other page
// route (a single-page app).
//
// Each deploy replaces the build, but a page opened before it still runs the old one, and it
// fetches parts of it later (the 3D view, rendering, exporters) by their old hashed names. So
// every build's assets (not its source maps) are also copied to DATA_DIR/assets, which outlives
// deploys, and an asset missing from the build is served from there. One that no build has had
// for a week goes.

import { copyFile, mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import type { Hono } from "hono";
import { config } from "./config.ts";
import { DAY, fileStream } from "./util.ts";

const ARCHIVE = join(config.dataDir, "assets");
const KEEP_MS = 7 * DAY;

/** Copies the build's assets into the archive, marking the ones it has as in use now. */
export async function archiveAssets(): Promise<void> {
  const from = join(config.webDist, "assets");
  const names = await readdir(from).catch(() => [] as string[]);
  if (names.length === 0) return;
  await mkdir(ARCHIVE, { recursive: true });
  const now = new Date();
  for (const name of names) {
    // a page never fetches a source map; only the browser's developer tools do
    if (name.endsWith(".map")) continue;
    const target = join(ARCHIVE, name);
    if ((await fileSize(target)) === null) {
      if ((await fileSize(join(from, name))) === null) continue;
      await copyFile(join(from, name), target);
    }
    await utimes(target, now, now);
  }
}

/** Deletes archived assets no build has had for KEEP_MS (housekeeping). */
export async function pruneAssets(): Promise<void> {
  const names = await readdir(ARCHIVE).catch(() => [] as string[]);
  const cutoff = Date.now() - KEEP_MS;
  for (const name of names) {
    const st = await stat(join(ARCHIVE, name)).catch(() => null);
    if (st && st.isFile() && st.mtimeMs < cutoff) await rm(join(ARCHIVE, name), { force: true });
  }
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

/** The size of a regular file, or null. */
async function fileSize(path: string): Promise<number | null> {
  const st = await stat(path).catch(() => null);
  return st && st.isFile() ? st.size : null;
}

export function registerStatic(app: Hono): void {
  app.get("*", async (c) => {
    const root = config.webDist;
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(c.req.url).pathname);
    } catch {
      return c.text("Bad request", 400);
    }

    const wanted = resolve(root, `.${pathname}`);
    let target: string | null = wanted === root || wanted.startsWith(root + sep) ? wanted : null;
    let size = target ? await fileSize(target) : null;
    if (size === null && pathname.startsWith("/assets/")) {
      // an earlier build's asset, asked for by a page opened before the deploy
      const old = resolve(ARCHIVE, `.${pathname.slice("/assets".length)}`);
      if (old.startsWith(ARCHIVE + sep)) {
        size = await fileSize(old);
        if (size !== null) target = old;
      }
    }
    if (pathname === "/admin/") return c.redirect("/admin", 301);
    if (pathname === "/admin") {
      target = join(root, "admin.html");
      size = await fileSize(target);
    }
    if (size === null) {
      // A missing asset or file is a 404; any other path is a page of the editor. The 404 is never
      // cached: mid-deploy, a request reaching the old server misses the new build's assets, and a
      // CDN (Cloudflare keeps 404s for minutes) would go on serving that miss after the deploy.
      if (pathname.startsWith("/assets/") || extname(pathname)) {
        c.header("Cache-Control", "no-store");
        return c.text("Not found", 404);
      }
      target = join(root, "index.html");
      size = await fileSize(target);
    }
    if (size === null || target === null) {
      return c.text("The editor is not built on this server (web/dist is missing).", 404);
    }

    const isIndex = target === join(root, "index.html");
    const isAdmin = target === join(root, "admin.html");
    const rel = target.startsWith(ARCHIVE + sep) ? `/assets${target.slice(ARCHIVE.length)}` : target.slice(root.length);
    c.header("Content-Type", TYPES[extname(target).toLowerCase()] ?? "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header("X-Content-Type-Options", "nosniff");
    if (isIndex) {
      // only an embed (a view-only shared drawing) may be framed by other sites
      const embed = new URL(c.req.url).searchParams.has("embed");
      c.header("Content-Security-Policy", embed ? "frame-ancestors *" : "frame-ancestors 'self'");
      if (!embed) c.header("X-Frame-Options", "SAMEORIGIN");
      // share and invite tokens ride in the address: other sites (map tiles, links) see the origin only
      c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    }
    if (isAdmin) {
      c.header("Content-Security-Policy", "frame-ancestors 'none'");
      c.header("X-Frame-Options", "DENY");
      c.header("Referrer-Policy", "same-origin");
      c.header("X-Robots-Tag", "noindex");
    }
    if (isIndex || isAdmin || rel.endsWith("/sw.js")) c.header("Cache-Control", "no-cache");
    else if (rel.startsWith("/assets/")) c.header("Cache-Control", "public, max-age=31536000, immutable");
    else c.header("Cache-Control", "public, max-age=3600");
    return c.body(fileStream(target));
  });
}
