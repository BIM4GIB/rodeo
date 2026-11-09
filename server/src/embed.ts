// Share links as pages and pictures: the link-preview tags a share or embed link gets (for chat
// apps, search and oEmbed), an embed's first picture, a share's preview pictures (a still and a
// turning GIF, uploaded by the owner or an editor), the oEmbed answer for a Rodeo link, and the
// sweep that deletes the pictures of revoked links. Public reads are by token only.

import { rm } from "node:fs/promises";
import type { Context, Hono } from "hono";
import { CAN_EDIT } from "../../web/src/platform/protocol.ts";
import { allowed, clientIp, requireUser } from "./auth.ts";
import { blobPath, blobSize, commitBlob, headBytes, receiveBody } from "./blobs.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { requireRole } from "./files.ts";
import { escapeHtml, type PageExtras, registerPageHook } from "./page.ts";
import { fail, fileStream, MB, MINUTE, nowIso } from "./util.ts";

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;
/** The viewer's options, in the order they are written into an address (the contract in the design). */
const OPTION_KEYS = ["view", "layer", "at", "cam", "preset", "render", "rotate", "theme", "ui"] as const;
const POSTER_MAX = 1 * MB;
const TURNTABLE_MAX = 4 * MB;
const MEDIA_CACHE = "public, max-age=300";
const OEMBED_WIDTH = 800;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// X shows a live viewer in a tweet (player card) only for sites it accepts; off until rodeo.build is checked with X's card validator
const PLAYER_CARD = false;
// The embed's first picture covers the page until the viewer is ready. It is shown before the
// viewer's own stylesheet loads, so its style is inline.
const POSTER_STYLE = `<style>.embed-poster{position:fixed;inset:0;z-index:60;background:#e6e7ea;transition:opacity .25s}.embed-poster img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.embed-poster-name{position:absolute;left:12px;top:10px;margin:0;font:600 13px system-ui,sans-serif;color:#333}.embed-poster-status{position:absolute;left:12px;bottom:12px;margin:0;font:12px system-ui,sans-serif;color:#333}.embed-poster-spin{position:absolute;right:14px;bottom:14px;width:16px;height:16px;border:2px solid #b8babf;border-top-color:#333;border-radius:50%;animation:embed-spin .8s linear infinite}.embed-poster.gone{opacity:0;pointer-events:none}@keyframes embed-spin{to{transform:rotate(360deg)}}</style>`;

/** A live share joined to its drawing and owner. */
interface LiveShare {
  token: string;
  file_id: string;
  file_name: string;
  owner_name: string;
  head_version_id: string | null;
  /** the picture to fall back on: a gallery entry's published cover, else the drawing's thumbnail */
  thumbnail_blob: string | null;
  thumbnail_type: string;
  /** a gallery entry's owner when the link is the entry's (gallery.ts), else null */
  gallery_owner: string | null;
}

/** A share_media row: one preview picture of a link. */
interface MediaRow {
  blob: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  version_id: string | null;
  created_at: string;
}

/** One preview picture as the Share dialog reads it. */
interface PreviewImage {
  url: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
}

/** The Share dialog's answer: the link's pictures, and whether the still is older than the drawing. */
interface SharePreview {
  poster: PreviewImage | null;
  turntable: PreviewImage | null;
  stale: boolean;
}

/**
 * A live share (not revoked) with its drawing and owner; undefined for a malformed or unknown token.
 * A gallery entry's link is named, credited and pictured as it was published, as sharing.ts serves
 * it: the drawing's own name, owner and newest thumbnail stay private.
 */
function liveShare(token: string): LiveShare | undefined {
  if (!TOKEN.test(token)) return undefined;
  return get<LiveShare>(
    `SELECT s.token, s.file_id, COALESCE(g.title, f.name) AS file_name, COALESCE(g.credit_name, o.name) AS owner_name,
       CASE WHEN g.id IS NULL THEN f.head_version_id ELSE g.version_id END AS head_version_id,
       CASE WHEN g.id IS NULL THEN f.thumbnail_blob ELSE g.cover_blob END AS thumbnail_blob,
       CASE WHEN g.id IS NULL THEN 'image/png' ELSE COALESCE(g.cover_type, 'image/png') END AS thumbnail_type,
       g.owner_id AS gallery_owner
     FROM shares s JOIN files f ON f.id = s.file_id JOIN users o ON o.id = f.owner_id
     LEFT JOIN gallery_entries g ON g.share_token = s.token
     WHERE s.token = ? AND s.revoked_at IS NULL`,
    token,
  );
}

/** The link's preview picture of one kind, or undefined. */
function media(token: string, kind: "poster" | "turntable"): MediaRow | undefined {
  return get<MediaRow>(
    "SELECT blob, mime, width, height, size, version_id, created_at FROM share_media WHERE token = ? AND kind = ?",
    token,
    kind,
  );
}

/** The address of a preview picture; its ?v= changes with each upload, so a new picture is not kept in a cache. */
function mediaUrl(token: string, kind: string, createdAt: string): string {
  return `${config.publicUrl}/api/s/${token}/${kind}?v=${Date.parse(createdAt).toString(36)}`;
}

/** A file name without its extension, for titles; "Drawing" when nothing is left. */
function displayName(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || "Drawing";
}

/** The drawing's name from a public file's address (its last path segment), for titles. */
function nameOfAddress(address: string): string {
  try {
    const last = new URL(address).pathname.split("/").filter(Boolean).pop() ?? "";
    return displayName(decodeURIComponent(last));
  } catch {
    return "Drawing";
  }
}

/** A value in an address: encoded, with commas left as they are (the viewer's lists use them). */
function encodeValue(value: string): string {
  return encodeURIComponent(value).replace(/%2C/gi, ",");
}

/** The viewer's options from a page's query, written back in OPTION_KEYS order; empty or missing ones are left out. */
function optionQuery(params: URLSearchParams): string {
  const out: string[] = [];
  for (const key of OPTION_KEYS) {
    const raw = key === "layer" ? (params.get("layer") ?? params.get("sheet")) : params.get(key);
    if (raw === null) continue;
    const value = Array.from(raw.trim()).slice(0, 200).join("");
    if (key === "rotate") {
      // rotate is a switch: present with no value, or 1 or true, turns it on
      if (value === "" || value === "1" || value === "true") out.push("rotate=1");
      continue;
    }
    if (value === "") continue;
    out.push(`${key}=${encodeValue(value)}`);
  }
  return out.join("&");
}

/** The embed's first picture: the drawing's still, with its name and a spinner, until the viewer is ready. */
function posterMarkup(name: string, img: string | null): string {
  return `<div id="embed-poster" class="embed-poster">${img ? `<img src="${escapeHtml(img)}" alt="" fetchpriority="high">` : ""}<p class="embed-poster-name">${escapeHtml(name)}</p><span class="embed-poster-spin"></span></div>`;
}

/** The picture type from its first bytes (PNG, JPEG or GIF), or null. The upload's own type is never trusted. */
function sniff(head: Buffer): "image/png" | "image/jpeg" | "image/gif" | null {
  if (head.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "image/jpeg";
  if (head.length >= 6 && head.toString("latin1", 0, 4) === "GIF8" && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) {
    return "image/gif";
  }
  return null;
}

/** Sends a stored picture with its headers; null when its file is missing, so the caller can fall back. */
async function serveBlob(c: Context, blob: string, mime: string): Promise<Response | null> {
  const size = await blobSize(blob);
  if (size === null) return null;
  c.header("Content-Type", mime);
  c.header("Content-Length", String(size));
  c.header("Cache-Control", MEDIA_CACHE);
  c.header("Cross-Origin-Resource-Policy", "cross-origin");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(fileStream(blobPath(blob)));
}

/** A whole number from 16 to 4096 (a picture's side), or null. */
function dimension(v: string | undefined): number | null {
  if (v === undefined || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 16 && n <= 4096 ? n : null;
}

/** A positive whole number from a query, or null when it is missing or not one. */
function positive(v: string | undefined): number | null {
  if (v === undefined || !/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

/** The picture's width and height from the query. */
function pictureSize(c: Context): { width: number; height: number } {
  const width = dimension(c.req.query("width"));
  const height = dimension(c.req.query("height"));
  if (width === null || height === null) fail(400, "Give the picture's width and height");
  return { width, height };
}

/** The preview picture's answer for the Share dialog. */
function previewImage(token: string, kind: string, row: MediaRow): PreviewImage {
  return {
    url: mediaUrl(token, kind, row.created_at),
    width: row.width,
    height: row.height,
    size: row.size,
    createdAt: row.created_at,
  };
}

/** The address is one of this site's, or of a host that moves here. */
function ownHost(page: URL): boolean {
  return new URL(config.publicUrl).origin === page.origin || config.redirectHosts.has(page.hostname.toLowerCase());
}

/** The page hook: a share or embed link's preview tags, and an embed's poster. */
export function embedPageExtras(url: URL): PageExtras | null {
  const embed = url.searchParams.get("embed");
  const share = url.searchParams.get("share");
  const file = url.searchParams.get("url");

  // a public file by address: the viewer fetches it in the browser, so only the poster is known here
  if (embed === "" && file) {
    const name = nameOfAddress(file);
    return {
      title: `${name} · Rodeo`,
      head: '<meta name="robots" content="noindex">',
      body: posterMarkup(name, null),
      bodyClass: "embed",
    };
  }

  const token = embed || share;
  const live = token ? liveShare(token) : undefined;
  if (!live) return null;
  const t = live.token;
  const isEmbed = Boolean(embed);
  const title = displayName(live.file_name);
  const desc = `Shared by ${live.owner_name} on Rodeo. Look around it in 2D and 3D in your browser, with no download or account.`;
  const q = optionQuery(url.searchParams);
  const shareUrl = `${config.publicUrl}/?share=${t}`;
  const pageUrl = (isEmbed ? `${config.publicUrl}/?embed=${t}` : shareUrl) + (q ? `&${q}` : "");
  const embedUrl = `${config.publicUrl}/?embed=${t}` + (q ? `&${q}` : "");

  // the picture a chat app or search shows: the still when there is one, else the drawing's thumbnail, else the icon
  const poster = media(t, "poster");
  let image = `${config.publicUrl}/icon-512.png`;
  let width: number | undefined = 512;
  let height: number | undefined = 512;
  let card = "summary";
  if (poster) {
    image = mediaUrl(t, "poster", poster.created_at);
    width = poster.width;
    height = poster.height;
    card = "summary_large_image";
  } else if (live.thumbnail_blob) {
    image = `${config.publicUrl}/api/s/${t}/poster`;
    width = undefined;
    height = undefined;
    card = "summary_large_image";
  }
  if (PLAYER_CARD) card = "player";

  const lines = [
    `<meta name="description" content="${escapeHtml(desc)}">`,
    `<meta name="robots" content="noindex">`,
    `<link rel="canonical" href="${escapeHtml(shareUrl)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="Rodeo">`,
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(desc)}">`,
    `<meta property="og:url" content="${escapeHtml(shareUrl)}">`,
    `<meta property="og:image" content="${escapeHtml(image)}">`,
  ];
  if (width !== undefined && height !== undefined) {
    lines.push(`<meta property="og:image:width" content="${width}">`, `<meta property="og:image:height" content="${height}">`);
  }
  lines.push(
    `<meta property="og:image:alt" content="${escapeHtml(`${title}, a drawing on Rodeo`)}">`,
    `<meta name="twitter:card" content="${card}">`,
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(desc)}">`,
    `<meta name="twitter:image" content="${escapeHtml(image)}">`,
  );
  if (PLAYER_CARD) {
    lines.push(
      `<meta name="twitter:player" content="${escapeHtml(embedUrl)}">`,
      `<meta name="twitter:player:width" content="800">`,
      `<meta name="twitter:player:height" content="450">`,
    );
  }
  lines.push(
    `<link rel="alternate" type="application/json+oembed" href="${escapeHtml(`${config.publicUrl}/api/oembed?format=json&url=${encodeURIComponent(pageUrl)}`)}" title="${escapeHtml(title)}">`,
  );
  const head = lines.join("\n");

  if (!isEmbed) return { title: `${title} · Rodeo`, head };

  // an embed's first paint: the picture, and the drawing's bytes and info fetched at once for the viewer
  const posterImg = poster ? image : live.thumbnail_blob ? `/api/s/${t}/poster` : null;
  return {
    title: `${title} · Rodeo`,
    head: `${head}\n${POSTER_STYLE}\n<script>window.openvwxPreload={info:fetch("/api/s/${t}").catch(function(){return null}),content:fetch("/api/s/${t}/content").catch(function(){return null})};</script>`,
    body: posterMarkup(title, posterImg),
    bodyClass: "embed",
  };
}

/** The oEmbed answer for a Rodeo address, or null when it names no live share. */
export function oembedFor(page: URL, maxWidth: number | null, maxHeight: number | null): Record<string, unknown> | null {
  const embed = page.searchParams.get("embed");
  const file = page.searchParams.get("url");
  const token = embed || page.searchParams.get("share");

  // a card is 16:9, at most 800 wide, and never taller than the caller's maxheight
  let w = Math.max(1, Math.min(OEMBED_WIDTH, maxWidth ?? OEMBED_WIDTH));
  let h = Math.max(1, Math.round((w * 9) / 16));
  if (maxHeight !== null && h > maxHeight) {
    h = maxHeight;
    w = Math.max(1, Math.round((h * 16) / 9));
  }

  let title: string;
  let author: string | undefined;
  let src: string;
  let thumb: { url: string; width: number; height: number } | undefined;
  if (embed === "" && file) {
    title = nameOfAddress(file);
    src = `${config.publicUrl}/?embed&url=${encodeURIComponent(file)}`;
  } else {
    const live = token ? liveShare(token) : undefined;
    if (!live) return null;
    title = displayName(live.file_name);
    author = live.owner_name;
    src = `${config.publicUrl}/?embed=${live.token}`;
    const poster = media(live.token, "poster");
    if (poster) thumb = { url: mediaUrl(live.token, "poster", poster.created_at), width: poster.width, height: poster.height };
  }
  const q = optionQuery(page.searchParams);
  if (q) src += `&${q}`;

  const html = `<iframe src="${escapeHtml(src)}" width="${w}" height="${h}" style="border:0;max-width:100%" allow="fullscreen" allowfullscreen loading="lazy" title="${escapeHtml(title)} on Rodeo"></iframe>`;
  const result: Record<string, unknown> = {
    version: "1.0",
    type: "rich",
    provider_name: "Rodeo",
    provider_url: `${config.publicUrl}/`,
    title,
    html,
    width: w,
    height: h,
    cache_age: 300,
  };
  if (author !== undefined) result.author_name = author;
  if (thumb) {
    result.thumbnail_url = thumb.url;
    result.thumbnail_width = thumb.width;
    result.thumbnail_height = thumb.height;
  }
  return result;
}

/** A PUT of a preview picture: the still (poster) or the turning GIF (turntable). */
async function putMedia(c: Context, token: string, kind: "poster" | "turntable"): Promise<Response> {
  const user = requireUser(c);
  const share = liveShare(token);
  if (!share) fail(404, "Share link not found", "not_found");
  requireRole(share.file_id, user.id, CAN_EDIT, "Only the owner or an editor can change a link's preview");
  // a gallery entry's pictures are what its publisher chose, so only they replace them
  if (share.gallery_owner !== null && share.gallery_owner !== user.id) fail(403, "Only the person who published this drawing can change its preview", "forbidden");
  const { width, height } = pictureSize(c);

  const poster = kind === "poster";
  const received = await receiveBody(c.req.raw, poster ? POSTER_MAX : TURNTABLE_MAX, poster ? "The preview" : "The turning preview");
  const mime = sniff(await headBytes(received.tmp, 8));
  const fits = poster ? mime === "image/png" || mime === "image/jpeg" : mime === "image/gif";
  if (mime === null || !fits) {
    await rm(received.tmp, { force: true });
    fail(400, poster ? "The preview must be a PNG or JPEG picture" : "The turning preview must be a GIF");
  }

  const blob = await commitBlob(received);
  let previous: string | null;
  try {
    // one picture per kind for each link: the new one replaces the old in the same transaction
    previous = tx(() => {
      const old = get<{ blob: string }>("SELECT blob FROM share_media WHERE token = ? AND kind = ?", share.token, kind);
      run(
        `INSERT INTO share_media (token, kind, blob, mime, width, height, size, version_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(token, kind) DO UPDATE SET blob = excluded.blob, mime = excluded.mime, width = excluded.width,
           height = excluded.height, size = excluded.size, version_id = excluded.version_id, created_at = excluded.created_at`,
        share.token,
        kind,
        blob,
        mime,
        width,
        height,
        received.size,
        share.head_version_id,
        nowIso(),
      );
      return old?.blob ?? null;
    });
  } catch (e) {
    await rm(blobPath(blob), { force: true });
    throw e;
  }
  if (previous) await rm(blobPath(previous), { force: true });
  return c.body(null, 204);
}

/** Deletes the preview pictures of revoked or deleted links; returns how many went. */
export async function sweepShareMedia(): Promise<number> {
  // blobs.ts's reference count does not look at share_media, so these files are deleted here
  const rows = all<{ token: string; kind: string; blob: string }>(
    `SELECT m.token, m.kind, m.blob FROM share_media m LEFT JOIN shares s ON s.token = m.token
     WHERE s.token IS NULL OR s.revoked_at IS NOT NULL`,
  );
  let count = 0;
  for (const row of rows) {
    if (run("DELETE FROM share_media WHERE token = ? AND kind = ? AND blob = ?", row.token, row.kind, row.blob) === 0) continue;
    await rm(blobPath(row.blob), { force: true });
    count++;
  }
  return count;
}

/** The share and embed routes, the link-preview page hook and the sweep of old preview pictures. */
export function registerEmbed(app: Hono): void {
  registerPageHook(embedPageExtras);

  // Public: a link's still picture. Without one, the drawing's thumbnail; without that, the icon.
  app.get("/api/s/:token/poster", async (c) => {
    const token = c.req.param("token");
    const share = liveShare(token);
    if (!share) fail(404, "Share link not found", "not_found");
    const poster = media(token, "poster");
    if (poster) {
      const served = await serveBlob(c, poster.blob, poster.mime);
      if (served) return served;
    }
    if (share.thumbnail_blob) {
      const served = await serveBlob(c, share.thumbnail_blob, share.thumbnail_type);
      if (served) return served;
    }
    return c.redirect(`${config.publicUrl}/icon-512.png`, 302);
  });

  // Public: a link's turning GIF, else the still.
  app.get("/api/s/:token/turntable", async (c) => {
    const token = c.req.param("token");
    if (!liveShare(token)) fail(404, "Share link not found", "not_found");
    const turntable = media(token, "turntable");
    if (turntable) {
      const served = await serveBlob(c, turntable.blob, turntable.mime);
      if (served) return served;
    }
    return c.redirect(`${config.publicUrl}/api/s/${token}/poster`, 302);
  });

  app.get("/api/shares/:token/preview", (c) => {
    const user = requireUser(c);
    const share = liveShare(c.req.param("token"));
    if (!share) fail(404, "Share link not found", "not_found");
    requireRole(share.file_id, user.id, CAN_EDIT, "Only the owner or an editor can change a link's preview");
    const poster = media(share.token, "poster");
    const turntable = media(share.token, "turntable");
    const preview: SharePreview = {
      poster: poster ? previewImage(share.token, "poster", poster) : null,
      turntable: turntable ? previewImage(share.token, "turntable", turntable) : null,
      stale: poster !== undefined && poster.version_id !== share.head_version_id,
    };
    return c.json(preview);
  });

  app.put("/api/shares/:token/poster", (c) => putMedia(c, c.req.param("token"), "poster"));
  app.put("/api/shares/:token/turntable", (c) => putMedia(c, c.req.param("token"), "turntable"));

  // Public JSON for link previews: some editors fetch it from the browser, so it allows any origin.
  app.get("/api/oembed", (c) => {
    if (!allowed(`oembed:${clientIp(c)}`, 120, MINUTE)) fail(429, "Too many requests. Try again in a minute.", "rate_limited");
    const format = c.req.query("format") ?? "json";
    if (format !== "json") fail(501, "Only JSON is offered", "not_implemented");
    const raw = c.req.query("url");
    let page: URL | null = null;
    try {
      page = raw ? new URL(raw) : null;
    } catch {
      page = null;
    }
    if (!page) fail(400, "Give the address of a Rodeo link in url");
    if (!ownHost(page)) fail(404, "That is not a Rodeo link", "not_found");
    const result = oembedFor(page, positive(c.req.query("maxwidth")), positive(c.req.query("maxheight")));
    if (!result) fail(404, "Share link not found", "not_found");
    c.header("Cache-Control", MEDIA_CACHE);
    c.header("Access-Control-Allow-Origin", "*");
    return c.json(result);
  });

  const sweep = (): void => void sweepShareMedia().catch((e: unknown) => console.error("[embed] sweep failed:", e));
  setTimeout(sweep, 10_000).unref();
  setInterval(sweep, 30 * MINUTE).unref();
}
