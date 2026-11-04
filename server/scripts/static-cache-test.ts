// node scripts/static-cache-test.ts — actual handler and generated files, on any OS.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
const data = mkdtempSync(join(tmpdir(), "rodeo-cache-"));
process.env.DATA_DIR = data;
process.env.WEB_DIST = join(data, "web");
const { registerStatic } = await import("../src/static.ts");
try {
  for (const dir of ["web/assets", "assets"]) mkdirSync(join(data, dir), { recursive: true });
  for (const file of ["web/index.html", "web/admin.html", "web/sw.js", "web/assets/current.js", "assets/old.js", "web/other.js"]) writeFileSync(join(data, file), "generated test file");
  const app = new Hono(); registerStatic(app);
  for (const [path, cache, status] of [
    ["/", "no-cache", 200], ["/drawing", "no-cache", 200], ["/admin", "no-cache", 200], ["/sw.js", "no-cache", 200],
    ["/assets/current.js", "public, max-age=31536000, immutable", 200], ["/assets/old.js", "public, max-age=31536000, immutable", 200],
    ["/assets/missing.js", "no-store", 404], ["/other.js", "public, max-age=3600", 200],
  ] as const) {
    const res = await app.request(`http://localhost${path}`); await res.text();
    assert.equal(res.status, status); assert.equal(res.headers.get("cache-control"), cache, path);
  }
  console.log("static cache checks passed");
} finally { rmSync(data, { recursive: true, force: true }); }
