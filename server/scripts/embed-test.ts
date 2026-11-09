// Tests for link previews, oEmbed and preview pictures (src/page.ts, src/embed.ts): node scripts/embed-test.ts
// The routes run on a Hono app with a data folder of their own. The database, blobs and sessions
// are real; no server or network is used.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

const data = mkdtempSync(join(tmpdir(), "rodeo-embed-"));
// config.ts reads the environment when it is imported, so the src modules load after these lines.
process.env.DATA_DIR = data;
process.env.PUBLIC_URL = "http://localhost:9999";
process.env.NODE_ENV = "development";

const { database, get, openDatabase, run } = await import("../src/db.ts");
const { blobPath } = await import("../src/blobs.ts");
const { csrf, onError } = await import("../src/http.ts");
const { registerEmbed, sweepShareMedia } = await import("../src/embed.ts");
const { injectPage, pageExtrasFor } = await import("../src/page.ts");
const { sha256Hex } = await import("../src/util.ts");

const BASE = "http://localhost:9999";
const T = "t".repeat(43);
const T2 = "s".repeat(43);
const THUMB = "thumbtestblob0000000000";
const SHARE_MEDIA_SQL = `
CREATE TABLE share_media (
  token TEXT NOT NULL,
  kind TEXT NOT NULL,
  blob TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size INTEGER NOT NULL,
  version_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (token, kind)
);
`;

/** A file of `size` bytes that starts with `head`, the magic bytes a picture is checked by. */
function picture(head: readonly number[], size = 2048): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(size).fill(7);
  out.set(head);
  return out;
}

const PNG = picture([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = picture([0xff, 0xd8, 0xff, 0xe0]);
const GIF = picture([...Buffer.from("GIF89a")]);

/** A request to the test app; `signedIn` sends the session cookie. */
async function send(method: string, path: string, options: { body?: Uint8Array<ArrayBuffer>; signedIn?: boolean } = {}): Promise<Response> {
  const headers: Record<string, string> = { "X-Requested-With": "openvwx" };
  if (options.signedIn) headers.Cookie = "ovx_session=sess";
  return app.request(path, { method, headers, body: options.body });
}

/** The error text of a JSON answer. */
async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error;
}

/** The head markup of a page hook's answer for a URL (empty when there is none). */
function headOf(address: string): string {
  return pageExtrasFor(new URL(address))?.head ?? "";
}

const app = new Hono();
app.use("/api/*", csrf);
app.onError(onError);

try {
  openDatabase();
  // The integrator's SCHEMA_V9 adds this table; until it lands, the test makes it from the same SQL.
  if (!get("SELECT name FROM sqlite_master WHERE name = 'share_media'")) database().exec(SHARE_MEDIA_SQL);
  registerEmbed(app);

  const now = new Date().toISOString();
  const inAYear = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  run("INSERT INTO users (id, email, name, created_at, supporter_until) VALUES (?, ?, ?, ?, ?)", "user-owner", "owner@example.com", "Test Owner", now, inAYear);
  run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256Hex("sess"), "user-owner", now, inAYear);
  run("INSERT INTO files (id, owner_id, name, created_at, updated_at, head_version_id) VALUES (?, ?, ?, ?, ?, ?)", "file-house", "user-owner", "House.vwx", now, now, "v1");
  run("INSERT INTO members (file_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", "file-house", "user-owner", now);
  run("INSERT INTO shares (token, file_id, created_by, allow_download, created_at) VALUES (?, ?, ?, 0, ?)", T, "file-house", "user-owner", now);

  const poster = `/api/shares/${T}/poster?width=1200&height=630`;

  // ---- uploads: a session, a picture, its size and its type ---------------------------------
  assert.equal((await send("PUT", poster, { body: PNG })).status, 401, "a picture needs a session");

  {
    const res = await send("PUT", poster, { body: Buffer.from("hello"), signedIn: true });
    assert.equal(res.status, 400);
    assert.equal(await errorOf(res), "The preview must be a PNG or JPEG picture");
  }
  {
    const res = await send("PUT", `/api/shares/${T}/poster`, { body: PNG, signedIn: true });
    assert.equal(res.status, 400);
    assert.equal(await errorOf(res), "Give the picture's width and height");
  }

  assert.equal((await send("PUT", poster, { body: PNG, signedIn: true })).status, 204);
  {
    const res = await send("GET", `/api/s/${T}/poster`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.match(res.headers.get("cache-control") ?? "", /public/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PNG));
  }

  assert.equal((await send("PUT", `/api/shares/${T}/turntable?width=480&height=270`, { body: GIF, signedIn: true })).status, 204);
  {
    const res = await send("GET", `/api/s/${T}/turntable`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/gif");
  }

  {
    const tooBig = picture([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 1024 * 1024 + 1);
    const res = await send("PUT", poster, { body: tooBig, signedIn: true });
    assert.equal(res.status, 413);
    assert.equal(await errorOf(res), "The preview is larger than 1 MB");
  }

  // a JPEG replaces the PNG, and the PNG's file is deleted
  const oldPoster = get<{ blob: string }>("SELECT blob FROM share_media WHERE token = ? AND kind = 'poster'", T)!.blob;
  assert.equal((await send("PUT", poster, { body: JPEG, signedIn: true })).status, 204);
  assert.equal(existsSync(blobPath(oldPoster)), false, "the replaced picture's file is gone");
  assert.equal((await send("GET", `/api/s/${T}/poster`)).headers.get("content-type"), "image/jpeg");

  // ---- the Share dialog's preview ----------------------------------------------------------
  {
    const res = await send("GET", `/api/shares/${T}/preview`, { signedIn: true });
    assert.equal(res.status, 200);
    const preview = (await res.json()) as { poster: { width: number } | null; turntable: { width: number } | null; stale: boolean };
    assert.equal(preview.poster?.width, 1200);
    assert.equal(preview.turntable?.width, 480);
    assert.equal(preview.stale, false);
  }
  run("UPDATE files SET head_version_id = 'v2' WHERE id = 'file-house'");
  assert.equal(((await (await send("GET", `/api/shares/${T}/preview`, { signedIn: true })).json()) as { stale: boolean }).stale, true, "the still is older than the drawing");

  // ---- link previews for a share link ------------------------------------------------------
  {
    const extras = pageExtrasFor(new URL(`${BASE}/?share=${T}`));
    assert.ok(extras);
    assert.equal(extras.title, "House · Rodeo");
    assert.equal(extras.bodyClass, undefined);
    const head = extras.head ?? "";
    assert.ok(head.includes(`og:image" content="${BASE}/api/s/${T}/poster?v=`), "the still is the share's picture");
    assert.ok(head.includes("application/json+oembed"));
    assert.ok(head.includes("noindex"));
  }

  // the name is typed by the owner, so it is escaped in the tags
  run("UPDATE files SET name = ? WHERE id = 'file-house'", '<b>"x"</b>.vwx');
  {
    const head = headOf(`${BASE}/?share=${T}`);
    assert.ok(head.includes("&lt;b&gt;&quot;x&quot;&lt;/b&gt;"));
    assert.ok(!head.includes("<b>"));
  }

  // ---- an embed's first paint --------------------------------------------------------------
  {
    const extras = pageExtrasFor(new URL(`${BASE}/?embed=${T}&view=3d`));
    assert.ok(extras);
    assert.equal(extras.bodyClass, "embed");
    assert.ok((extras.body ?? "").includes('id="embed-poster"'));
    const head = extras.head ?? "";
    assert.ok(head.includes("openvwxPreload"));
    assert.ok(head.includes("view%3D3d"), "the oEmbed link carries the options");
  }

  // ---- addresses that are not a share ------------------------------------------------------
  assert.equal(pageExtrasFor(new URL(`${BASE}/?share=${"u".repeat(43)}`)), null, "an unknown token");
  assert.equal(pageExtrasFor(new URL(`${BASE}/?file=abc`)), null);
  {
    const extras = pageExtrasFor(new URL(`${BASE}/?embed&url=https%3A%2F%2Fexample.com%2Fa%2Fhouse.vwx`));
    assert.equal(extras?.title, "house · Rodeo");
    assert.equal(extras?.bodyClass, "embed");
  }

  // ---- injectPage --------------------------------------------------------------------------
  assert.equal(
    injectPage("<html><head><title>Rodeo</title></head><body>x</body></html>", { title: "A", head: "<meta x>", body: "<i>", bodyClass: "embed" }),
    '<html><head><title>A</title>\n<meta x></head><body class="embed"><i>x</body></html>',
  );
  assert.equal(
    injectPage('<html><head><title>Rodeo</title></head><body class="a">x</body></html>', { bodyClass: "embed" }),
    '<html><head><title>Rodeo</title></head><body class="a embed">x</body></html>',
  );
  assert.ok(injectPage("<html><head></head><body></body></html>", { title: "A & B" }).includes("<title>A &amp; B</title>"), "a missing title is added, escaped");

  // ---- oEmbed -------------------------------------------------------------------------------
  const shareWithView = encodeURIComponent(`${BASE}/?share=${T}&view=3d`);
  {
    const res = await send("GET", `/api/oembed?url=${shareWithView}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    const body = (await res.json()) as { type: string; width: number; height: number; html: string; author_name: string };
    assert.equal(body.type, "rich");
    assert.equal(body.width, 800);
    assert.equal(body.height, 450);
    assert.ok(body.html.includes(`?embed=${T}&amp;view=3d`));
    assert.equal(body.author_name, "Test Owner");
  }
  {
    const body = (await (await send("GET", `/api/oembed?url=${shareWithView}&maxwidth=400`)).json()) as { width: number; height: number };
    assert.deepEqual([body.width, body.height], [400, 225]);
  }
  {
    const body = (await (await send("GET", `/api/oembed?url=${shareWithView}&maxheight=200`)).json()) as { width: number; height: number };
    assert.deepEqual([body.width, body.height], [356, 200]);
  }
  assert.equal((await send("GET", `/api/oembed?url=${shareWithView}&format=xml`)).status, 501);
  assert.equal((await send("GET", `/api/oembed?url=${encodeURIComponent(`https://evil.example/?share=${T}`)}`)).status, 404);
  assert.equal((await send("GET", "/api/oembed?url=nonsense")).status, 400);

  // ---- a drawing's thumbnail stands in when there is no still -----------------------------
  mkdirSync(join(data, "blobs", THUMB.slice(0, 2)), { recursive: true });
  writeFileSync(blobPath(THUMB), PNG);
  run(
    "INSERT INTO files (id, owner_id, name, created_at, updated_at, head_version_id, thumbnail_blob) VALUES (?, ?, ?, ?, ?, ?, ?)",
    "file-shed", "user-owner", "Shed.vwx", now, now, "v1", THUMB,
  );
  run("INSERT INTO members (file_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", "file-shed", "user-owner", now);
  run("INSERT INTO shares (token, file_id, created_by, allow_download, created_at) VALUES (?, ?, ?, 0, ?)", T2, "file-shed", "user-owner", now);
  {
    const res = await send("GET", `/api/s/${T2}/poster`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), Buffer.from(PNG));
    assert.ok(headOf(`${BASE}/?share=${T2}`).includes(`og:image" content="${BASE}/api/s/${T2}/poster"`));
  }
  run("UPDATE files SET thumbnail_blob = NULL WHERE id = 'file-shed'");
  {
    const res = await send("GET", `/api/s/${T2}/poster`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `${BASE}/icon-512.png`);
    const turn = await send("GET", `/api/s/${T2}/turntable`);
    assert.equal(turn.status, 302);
    assert.equal(turn.headers.get("location"), `${BASE}/api/s/${T2}/poster`);
  }

  // ---- a revoked link ----------------------------------------------------------------------
  const leftover = [
    get<{ blob: string }>("SELECT blob FROM share_media WHERE token = ? AND kind = 'poster'", T)!.blob,
    get<{ blob: string }>("SELECT blob FROM share_media WHERE token = ? AND kind = 'turntable'", T)!.blob,
  ];
  run("UPDATE shares SET revoked_at = ? WHERE token = ?", now, T);
  assert.equal((await send("GET", `/api/s/${T}/poster`)).status, 404);
  assert.equal((await send("GET", `/api/s/${T}/turntable`)).status, 404);
  assert.equal(pageExtrasFor(new URL(`${BASE}/?share=${T}`)), null);
  assert.equal((await send("GET", `/api/oembed?url=${shareWithView}`)).status, 404);
  assert.equal(await sweepShareMedia(), 2, "the revoked link's two pictures are swept");
  for (const blob of leftover) assert.equal(existsSync(blobPath(blob)), false, "and their files are deleted");
  assert.equal(get<{ n: number }>("SELECT COUNT(*) AS n FROM share_media WHERE token = ?", T)!.n, 0);

  console.log("embed-test: all passed");
} finally {
  rmSync(data, { recursive: true, force: true });
}
