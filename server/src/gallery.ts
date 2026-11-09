// The public gallery (rodeo.build/gallery): the drawings their owners published, each a snapshot
// of one version with a public share link the viewer (?embed=) reads. Here: the listing, tags and
// an entry with its remixes, covers and downloads, the gallery's pages with their link previews,
// the sitemap and robots.txt, and the helpers galleryPublish.ts and galleryModeration.ts share
// (rows, share links, hiding).

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context, Hono } from "hono";
import { allowed, clientIp, currentUser, isAdmin, type UserRow } from "./auth.ts";
import { blobPath, blobSize } from "./blobs.ts";
import { config } from "./config.ts";
import { all, get, run, tx, type Param } from "./db.ts";
import { serveVersion, VERSION_SQL, type VersionRow } from "./files.ts";
import { cleanLine, DAY, fail, fileStream, HOUR, inMs, newToken, nowIso } from "./util.ts";
import {
  DEFAULT_LICENCE,
  entryMeta,
  entryPath,
  homeMeta,
  isEntryId,
  isLicenceId,
  isReportReason,
  isSort,
  LIMITS,
  metaTags,
  missingMeta,
  normalizeTag,
  PAGE_SIZE,
  parseGalleryPath,
  robotsTxt,
  sitemapXml,
  slugOf,
  trendingScore,
  type EntryDetail,
  type EntryState,
  type ForkedFrom,
  type GalleryCard,
  type GalleryEntry,
  type GallerySort,
  type GalleryList,
  type ModerationReport,
  type OwnEntry,
  type PageMeta,
  type RemixNode,
  type TagCount,
} from "../../web/src/features/gallery/rules.ts";

/** What every "no such drawing in the gallery" answer says: hidden, unpublished and missing look alike. */
export const NOT_THERE = "This drawing is no longer in the gallery";

/** A gallery_entries row, as the gallery's queries read it. */
export interface EntryRow {
  id: string;
  file_id: string;
  owner_id: string;
  version_id: string | null;
  share_token: string | null;
  title: string;
  description: string;
  tags_json: string;
  licence: string;
  credit_name: string;
  official: number;
  featured_at: string | null;
  size: number;
  cover_blob: string | null;
  cover_type: string | null;
  published_at: string;
  updated_at: string;
  unpublished_at: string | null;
  hidden_at: string | null;
  hidden_reason: string | null;
}

/**
 * The SQL condition (table alias e) for an entry anyone may see. The viewer reads the pinned
 * version through the share link, so both must be there; a suspended owner's drawings leave the
 * gallery with the account.
 */
export const VISIBLE =
  "e.unpublished_at IS NULL AND e.hidden_at IS NULL AND e.version_id IS NOT NULL AND e.share_token IS NOT NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = e.owner_id AND u.suspended_at IS NULL)";

/** Forks by other people, as a subquery for the "Most forked" sort (alias e). */
const FORKS_SQL = "(SELECT COUNT(*) FROM files f WHERE f.parent_file_id = e.file_id AND f.lineage = 'fork' AND f.owner_id <> e.owner_id)";

/** How many of the newest matching drawings the trending sort scores. */
const TRENDING_POOL = 2000;

/** How many levels of remixes an entry page shows. */
const REMIX_LEVELS = 3;

/** How many drawings the remix tree may show in all. */
const REMIX_BUDGET = 50;

/** The drawing with this id in any state, or undefined. */
export function entryById(id: string): EntryRow | undefined {
  return get<EntryRow>("SELECT * FROM gallery_entries WHERE id = ?", id);
}

/** The entry with this id when anyone may see it (see VISIBLE), else undefined. */
export function visibleEntry(id: string): EntryRow | undefined {
  return get<EntryRow>(`SELECT e.* FROM gallery_entries e WHERE e.id = ? AND ${VISIBLE}`, id);
}

/** The entry of a drawing in any state, or undefined. */
export function entryForFile(fileId: string): EntryRow | undefined {
  return get<EntryRow>("SELECT * FROM gallery_entries WHERE file_id = ?", fileId);
}

/** Whether an entry is published, hidden by an admin, or unpublished by its owner (unpublished wins). */
export function stateOf(row: EntryRow): EntryState {
  if (row.unpublished_at !== null) return "unpublished";
  if (row.hidden_at !== null) return "hidden";
  return "published";
}

/** Forks of the entry's drawing by other people (files.lineage = 'fork'), made since `since` when given. */
export function forkCount(row: Pick<EntryRow, "file_id" | "owner_id">, since?: string): number {
  let sql = "SELECT COUNT(*) AS n FROM files f WHERE f.parent_file_id = ? AND f.lineage = 'fork' AND f.owner_id <> ?";
  const params: Param[] = [row.file_id, row.owner_id];
  if (since !== undefined) {
    sql += " AND f.created_at >= ?";
    params.push(since);
  }
  return get<{ n: number }>(sql, ...params)?.n ?? 0;
}

/** The drawing a fork was taken from, as it was when forked, with its page while that is still in the gallery; null when it was not forked from the gallery. */
export function forkedFromOf(fileId: string): ForkedFrom | null {
  const r = get<{ title: string; credit_name: string; licence: string; entry_id: string | null }>(
    "SELECT title, credit_name, licence, entry_id FROM gallery_forks WHERE file_id = ?",
    fileId,
  );
  if (!r) return null;
  const origin = r.entry_id !== null ? visibleEntry(r.entry_id) : undefined;
  return {
    title: r.title,
    creditName: r.credit_name,
    // a stored licence that is no longer one of the four still gets credit, under the default
    licence: isLicenceId(r.licence) ? r.licence : DEFAULT_LICENCE,
    path: origin ? entryPath(origin.id, origin.title) : null,
  };
}

/** The tags a row holds, as strings; [] when the stored JSON is not a list. */
function tagsOf(row: EntryRow): string[] {
  try {
    const v: unknown = JSON.parse(row.tags_json);
    return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

/** One drawing as a card in the listing. */
export function cardOf(row: EntryRow): GalleryCard {
  return {
    id: row.id,
    path: entryPath(row.id, row.title),
    title: row.title,
    creditName: row.credit_name,
    official: row.official === 1,
    // "more by" links to the author; a drawing credited as Rodeo has no author to link to
    authorId: row.official === 1 ? null : row.owner_id,
    tags: tagsOf(row),
    licence: isLicenceId(row.licence) ? row.licence : DEFAULT_LICENCE,
    forks: forkCount(row),
    featured: row.featured_at !== null,
    // the cover's id prefix changes with each new cover, so a replaced one is fetched again
    coverUrl: row.cover_blob ? `/api/gallery/entries/${row.id}/cover?v=${row.cover_blob.slice(0, 8)}` : null,
    publishedAt: row.published_at,
    updatedAt: row.updated_at,
    forkedFrom: forkedFromOf(row.file_id),
  };
}

/** One drawing's own page: its card, its description, and the links to view, embed and download it. */
export function entryOf(row: EntryRow, privileged: boolean): GalleryEntry {
  const token = row.share_token;
  return {
    ...cardOf(row),
    description: row.description,
    size: row.size,
    embedUrl: token ? `/?embed=${token}` : "",
    viewUrl: token ? `/?share=${token}` : "",
    downloadUrl: `/api/gallery/entries/${row.id}/download`,
    state: stateOf(row),
    hiddenReason: privileged ? row.hidden_reason : null,
  };
}

/** An entry as its owner sees it, with the drawing it was published from. */
export function ownEntryOf(row: EntryRow): OwnEntry {
  return { ...entryOf(row, true), fileId: row.file_id, versionId: row.version_id };
}

/** Makes a new share link (downloads allowed) for the entry and stores it; returns the token. Call inside tx(). */
export function issueShare(row: Pick<EntryRow, "id" | "file_id" | "owner_id">): string {
  const token = newToken();
  run("INSERT INTO shares (token, file_id, created_by, allow_download, created_at) VALUES (?, ?, ?, 1, ?)", token, row.file_id, row.owner_id, nowIso());
  run("UPDATE gallery_entries SET share_token = ? WHERE id = ?", token, row.id);
  return token;
}

/** Revokes the entry's share link, if it has one, and clears it. Call inside tx(). */
export function revokeShare(row: Pick<EntryRow, "id" | "share_token">): void {
  if (row.share_token !== null) run("UPDATE shares SET revoked_at = ? WHERE token = ? AND revoked_at IS NULL", nowIso(), row.share_token);
  run("UPDATE gallery_entries SET share_token = NULL WHERE id = ?", row.id);
}

/** Takes an entry out of the gallery (an admin, or enough reports). */
export function hideEntry(id: string, reason: string, keepLink = false): void {
  tx(() => {
    const row = entryById(id);
    if (!row) fail(404, NOT_THERE, "not_found");
    run("UPDATE gallery_entries SET hidden_at = ?, hidden_reason = ? WHERE id = ?", nowIso(), reason, id);
    if (!keepLink) revokeShare(row);
  });
}

/** Puts a hidden entry back, with a new share link while it is still published. */
export function restoreEntry(id: string): void {
  tx(() => {
    const row = entryById(id);
    if (!row) fail(404, NOT_THERE, "not_found");
    run("UPDATE gallery_entries SET hidden_at = NULL, hidden_reason = NULL WHERE id = ?", id);
    // the hide revoked the link and cleared it, so a live one is never issued twice
    if (row.unpublished_at === null && row.version_id !== null && row.share_token === null) issueShare(row);
  });
}

/** An entry's open reports, newest first. */
export function reportsOf(entryId: string): ModerationReport[] {
  return all<{ id: string; reason: string; note: string; email: string | null; created_at: string; reporter_name: string | null }>(
    `SELECT r.id, r.reason, r.note, r.email, r.created_at, u.name AS reporter_name
     FROM gallery_reports r LEFT JOIN users u ON u.id = r.reporter_id
     WHERE r.entry_id = ? AND r.resolved_at IS NULL ORDER BY r.created_at DESC`,
    entryId,
  ).map((r) => ({
    id: r.id,
    reason: isReportReason(r.reason) ? r.reason : "other",
    note: r.note,
    email: r.email,
    reporterName: r.reporter_name,
    createdAt: r.created_at,
  }));
}

/** The entry when `viewer` may see its page: a visible one for anyone; its owner and admins also see a hidden one. Unpublished is gone for all. */
function entryFor(id: string, viewer: UserRow | null): EntryRow | undefined {
  if (!isEntryId(id)) return undefined;
  const row = entryById(id);
  if (!row || row.unpublished_at !== null) return undefined;
  return isPrivileged(row, viewer) ? row : visibleEntry(id);
}

/** Whether `viewer` owns the drawing's entry or is an admin, so may see it while it is hidden. */
function isPrivileged(row: EntryRow, viewer: UserRow | null): boolean {
  return viewer !== null && (viewer.id === row.owner_id || isAdmin(viewer));
}

/** Published forks of an entry, their forks, and so on for three levels, at most `budget.left` drawings in all. */
function remixesOf(entryId: string, depth: number, budget: { left: number }): RemixNode[] {
  if (depth > REMIX_LEVELS || budget.left <= 0) return [];
  const rows = all<EntryRow>(
    `SELECT e.* FROM gallery_entries e JOIN gallery_forks g ON g.file_id = e.file_id
     WHERE g.entry_id = ? AND ${VISIBLE} ORDER BY e.published_at LIMIT 20`,
    entryId,
  );
  const nodes: RemixNode[] = [];
  for (const row of rows) {
    if (budget.left <= 0) break;
    budget.left--;
    nodes.push({ card: cardOf(row), children: remixesOf(row.id, depth + 1, budget) });
  }
  return nodes;
}

/** One page of the matching drawings in the chosen order, and whether more follow. */
function pageOf(sort: GallerySort, where: string, params: Param[], page: number): { rows: EntryRow[]; hasMore: boolean } {
  const offset = (page - 1) * PAGE_SIZE;
  if (sort === "trending") {
    // only the newest drawings are scored, so a page costs a fixed amount of work however big the gallery grows
    const pool = all<EntryRow>(`SELECT e.* FROM gallery_entries e WHERE ${where} ORDER BY e.published_at DESC LIMIT ?`, ...params, TRENDING_POOL);
    const now = Date.now();
    const since = inMs(-14 * DAY);
    const scored = pool.map((row) => ({
      row,
      score: trendingScore({
        recentForks: forkCount(row, since),
        forks: forkCount(row),
        ageDays: (now - Date.parse(row.published_at)) / DAY,
        featured: row.featured_at !== null,
      }),
    }));
    scored.sort((a, b) => b.score - a.score || b.row.published_at.localeCompare(a.row.published_at));
    const slice = scored.slice(offset, offset + PAGE_SIZE + 1).map((s) => s.row);
    return { rows: slice.slice(0, PAGE_SIZE), hasMore: slice.length > PAGE_SIZE };
  }
  const order = sort === "forks" ? `${FORKS_SQL} DESC, e.published_at DESC` : "e.published_at DESC";
  const rows = all<EntryRow>(`SELECT e.* FROM gallery_entries e WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, PAGE_SIZE + 1, offset);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE };
}

/** A Content-Disposition that names the download after the drawing, in plain ASCII and in UTF-8. */
function attachmentFor(title: string): string {
  // RFC 5987 leaves ' ( ) * out of the characters that may stay as they are
  const utf8 = encodeURIComponent(`${title}.vwx`).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${slugOf(title)}.vwx"; filename*=UTF-8''${utf8}`;
}

/** A gallery page: the built HTML with the head tags of the listing, or of the drawing it names. */
async function galleryPage(c: Context): Promise<Response> {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(c.req.url).pathname);
  } catch {
    return c.text("Bad request", 400);
  }
  const route = parseGalleryPath(pathname);
  if (!route) return c.notFound();
  const html = await readFile(join(config.webDist, "gallery.html"), "utf8").catch(() => null);
  if (html === null) return c.text("The gallery is not built on this server (web/dist/gallery.html is missing).", 404);

  const row = route.kind === "entry" ? visibleEntry(route.id) : undefined;
  const missing = route.kind === "missing" || (route.kind === "entry" && row === undefined);
  let meta: PageMeta;
  if (row) {
    const card = cardOf(row);
    meta = entryMeta(
      {
        id: row.id,
        title: row.title,
        description: row.description,
        creditName: row.credit_name,
        official: row.official === 1,
        licence: card.licence,
        coverUrl: card.coverUrl,
        publishedAt: row.published_at,
        updatedAt: row.updated_at,
        tags: card.tags,
      },
      config.publicUrl,
    );
  } else if (missing) {
    meta = missingMeta(config.publicUrl);
  } else {
    meta = homeMeta(config.publicUrl, { tag: c.req.query("tag"), q: c.req.query("q") });
  }

  // a function, not a string: a "$&" in a title would otherwise be read as a replacement pattern
  const body = html.replace(/<title>[^<]*<\/title>/, () => metaTags(meta));
  c.header("Content-Type", "text/html; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Content-Security-Policy", "frame-ancestors 'self'");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  return c.body(body, missing ? 404 : 200);
}

/** Registers the gallery's public reads and its pages (the gallery's writes are in galleryPublish.ts and galleryModeration.ts). */
export function registerGallery(app: Hono): void {
  app.get("/api/gallery/entries", (c) => {
    const q = cleanLine(c.req.query("q"), LIMITS.query);
    const tag = normalizeTag(c.req.query("tag") ?? "");
    const author = cleanLine(c.req.query("author"), 64);
    const featured = c.req.query("featured") === "1";
    const sortParam = c.req.query("sort");
    const sort: GallerySort = isSort(sortParam) ? sortParam : "trending";
    const pageNo = Number(c.req.query("page") ?? "1");
    const page = Number.isInteger(pageNo) && pageNo >= 1 && pageNo <= 100 ? pageNo : 1;

    // every word must appear somewhere in the drawing's text; at most five words are read
    const words = q.split(/\s+/).filter((w) => w !== "").slice(0, 5);
    const clauses: string[] = [VISIBLE];
    const params: Param[] = [];
    for (const word of words) {
      // LIKE treats %, _ and \ as wildcards; the backslash escapes them
      const pattern = `%${word.replace(/[\\%_]/g, "\\$&")}%`;
      clauses.push("(e.title LIKE ? ESCAPE '\\' OR e.description LIKE ? ESCAPE '\\' OR e.credit_name LIKE ? ESCAPE '\\' OR e.tags_json LIKE ? ESCAPE '\\')");
      params.push(pattern, pattern, pattern, pattern);
    }
    if (tag) {
      clauses.push("e.id IN (SELECT entry_id FROM gallery_tags WHERE tag = ?)");
      params.push(tag);
    }
    if (author) {
      clauses.push("e.owner_id = ? AND e.official = 0");
      params.push(author);
    }
    if (featured) clauses.push("e.featured_at IS NOT NULL");

    const { rows, hasMore } = pageOf(sort, clauses.join(" AND "), params, page);
    const list: GalleryList = { entries: rows.map((r) => cardOf(r)), page, hasMore };
    return c.json(list);
  });

  app.get("/api/gallery/tags", (c) => {
    const tags = all<TagCount>(
      `SELECT t.tag, COUNT(*) AS count FROM gallery_tags t JOIN gallery_entries e ON e.id = t.entry_id
       WHERE ${VISIBLE} GROUP BY t.tag ORDER BY count DESC, t.tag LIMIT 40`,
    );
    return c.json({ tags });
  });

  app.get("/api/gallery/entries/:id", (c) => {
    const viewer = currentUser(c);
    const row = entryFor(c.req.param("id"), viewer);
    if (!row) fail(404, NOT_THERE, "not_found");
    const isOwner = viewer !== null && viewer.id === row.owner_id;
    const admin = viewer !== null && isAdmin(viewer);
    // the forks that are not shown: forks of this drawing, less the published ones
    const shown = get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM gallery_forks g JOIN gallery_entries e ON e.file_id = g.file_id WHERE g.entry_id = ? AND ${VISIBLE}`,
      row.id,
    )?.n ?? 0;
    const detail: EntryDetail = {
      entry: entryOf(row, isPrivileged(row, viewer)),
      remixes: remixesOf(row.id, 1, { left: REMIX_BUDGET }),
      privateForks: Math.max(0, forkCount(row) - shown),
      viewer: { signedIn: viewer !== null, isOwner, isAdmin: admin },
      fileId: isOwner ? row.file_id : null,
      reports: admin ? reportsOf(row.id) : null,
    };
    return c.json(detail);
  });

  app.get("/api/gallery/entries/:id/cover", async (c) => {
    const viewer = currentUser(c);
    const row = entryFor(c.req.param("id"), viewer);
    if (!row) fail(404, NOT_THERE, "not_found");
    const blob = row.cover_blob;
    const type = row.cover_type;
    const size = blob ? await blobSize(blob) : null;
    if (!blob || size === null || (type !== "image/png" && type !== "image/jpeg")) fail(404, "No cover yet", "not_found");
    c.header("Content-Type", type);
    c.header("Content-Length", String(size));
    c.header("X-Content-Type-Options", "nosniff");
    // an owner's or an admin's view of a hidden drawing is not for caches
    c.header("Cache-Control", isPrivileged(row, viewer) ? "private, no-store" : "public, max-age=300");
    return c.body(fileStream(blobPath(blob)));
  });

  app.get("/api/gallery/entries/:id/download", async (c) => {
    if (!allowed(`gallery-download:${clientIp(c)}`, 60, HOUR)) fail(429, "Too many downloads from here. Try again in a while.", "rate_limited");
    const id = c.req.param("id");
    const row = isEntryId(id) ? visibleEntry(id) : undefined;
    if (!row) fail(404, NOT_THERE, "not_found");
    const version = row.version_id ? get<VersionRow>(`${VERSION_SQL} WHERE v.id = ?`, row.version_id) : undefined;
    if (!version) fail(404, NOT_THERE, "not_found");
    c.header("Content-Disposition", attachmentFor(row.title));
    return serveVersion(c, version);
  });

  // The page is the editor's build with its own head: the gallery's pages are not the editor.
  app.get("/gallery.html", (c) => c.redirect("/gallery", 301));
  app.get("/gallery", galleryPage);
  app.get("/gallery/*", galleryPage);

  app.get("/sitemap.xml", (c) => {
    const rows = all<EntryRow>(`SELECT e.* FROM gallery_entries e WHERE ${VISIBLE} ORDER BY e.updated_at DESC LIMIT 5000`);
    const xml = sitemapXml(
      config.publicUrl,
      rows.map((r) => ({ path: entryPath(r.id, r.title), updatedAt: r.updated_at })),
    );
    c.header("Content-Type", "application/xml; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(xml);
  });

  app.get("/robots.txt", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Cache-Control", "public, max-age=3600");
    return c.body(robotsTxt(config.publicUrl));
  });
}
