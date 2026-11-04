// Drawings: the list, content and versions, restore, labels and thumbnails. Plan limits
// (drawings, bytes, versions kept) belong to the file owner's plan and are enforced on
// create and save; saving prunes the oldest versions beyond the plan's count, never the head.

import { rm } from "node:fs/promises";
import type { Context, Hono } from "hono";
import { BIG_DRAWING, CAN_EDIT, type CloudFile, type Member, type Role, type Version } from "../../web/src/platform/protocol.ts";
import { limitsOf, requireUser, usageOf, type UserRow } from "./auth.ts";
import { blobPath, blobSize, commitBlob, headBytes, receiveBody, releaseBlobs } from "./blobs.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { readJson } from "./http.ts";
import { getHub } from "./hub.ts";
import { receiveUpload } from "./uploads.ts";
import { cleanLine, fail, fileStream, formatBytes, HttpError, KB, newId, nowIso } from "./util.ts";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// ---- rows and views ----

interface FileRow {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  head_version_id: string | null;
  size: number;
  has_thumbnail: number;
  thumbnail_blob: string | null;
  owner_name: string;
  role: string;
}

export interface VersionRow {
  id: string;
  file_id: string;
  author_id: string | null;
  created_at: string;
  size: number;
  label: string | null;
  blob: string;
  sha256: string;
  collab_seq: number;
  autosave: number;
  author_name: string | null;
}

const FILE_SQL = `SELECT f.id, f.owner_id, f.name, f.created_at, f.updated_at, f.head_version_id, f.size,
    f.has_thumbnail, f.thumbnail_blob, o.name AS owner_name, m.role
  FROM files f JOIN members m ON m.file_id = f.id AND m.user_id = ? JOIN users o ON o.id = f.owner_id`;

export const VERSION_SQL = `SELECT v.id, v.file_id, v.author_id, v.created_at, v.size, v.label, v.blob, v.sha256, v.collab_seq,
    v.autosave, u.name AS author_name
  FROM versions v LEFT JOIN users u ON u.id = v.author_id`;

function toCloudFile(r: FileRow): CloudFile {
  return {
    id: r.id,
    name: r.name,
    size: r.size,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    role: r.role as Role,
    headVersionId: r.head_version_id ?? "",
    hasThumbnail: r.has_thumbnail === 1,
  };
}

export function toVersion(r: VersionRow): Version {
  return {
    id: r.id,
    fileId: r.file_id,
    createdAt: r.created_at,
    size: r.size,
    authorId: r.author_id ?? "",
    authorName: r.author_name ?? "Former member",
    label: r.label,
    autosave: r.autosave === 1,
  };
}

/** The drawing as one member sees it, or null. */
export function fileFor(fileId: string, userId: string): CloudFile | null {
  const r = get<FileRow>(`${FILE_SQL} WHERE f.id = ?`, userId, fileId);
  return r ? toCloudFile(r) : null;
}

export function mustFile(fileId: string, userId: string): CloudFile {
  const f = fileFor(fileId, userId);
  if (!f) fail(404, "Drawing not found", "not_found");
  return f;
}

export function accessOf(fileId: string, userId: string): Role | null {
  const r = get<{ role: string }>("SELECT role FROM members WHERE file_id = ? AND user_id = ?", fileId, userId);
  return r ? (r.role as Role) : null;
}

/** The caller's role in a drawing. Non-members get 404; a role outside `allowed` gets 403. */
export function requireRole(fileId: string, userId: string, allowed?: readonly Role[], message = "Your role does not allow this"): Role {
  const role = accessOf(fileId, userId);
  if (!role) fail(404, "Drawing not found", "not_found");
  if (allowed && !allowed.includes(role)) fail(403, message, "forbidden");
  return role;
}

export function ownerRow(fileId: string): UserRow | undefined {
  return get<UserRow>("SELECT o.* FROM files f JOIN users o ON o.id = f.owner_id WHERE f.id = ?", fileId);
}

export function memberList(fileId: string): Member[] {
  return all<{ user_id: string; name: string; email: string; avatar_url: string | null; role: string }>(
    `SELECT u.id AS user_id, u.name, u.email, u.avatar_url, m.role
     FROM members m JOIN users u ON u.id = m.user_id
     WHERE m.file_id = ?
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 WHEN 'reviewer' THEN 2 ELSE 3 END, u.name`,
    fileId,
  ).map((r) => ({ userId: r.user_id, name: r.name, email: r.email, avatarUrl: r.avatar_url, role: r.role as Role }));
}

/** Every stored blob a drawing uses (versions, voice notes, its preview, a branch's common ancestor, its gallery cover). Read before deleting it. */
export function fileBlobs(fileId: string): string[] {
  const ids = [
    ...all<{ blob: string }>("SELECT blob FROM versions WHERE file_id = ?", fileId).map((r) => r.blob),
    ...all<{ blob: string }>("SELECT blob FROM audio WHERE file_id = ?", fileId).map((r) => r.blob),
    ...all<{ blob: string | null }>("SELECT thumbnail_blob AS blob FROM files WHERE id = ?", fileId).map((r) => r.blob),
    ...all<{ blob: string | null }>("SELECT base_blob AS blob FROM files WHERE id = ?", fileId).map((r) => r.blob),
    ...all<{ blob: string | null }>("SELECT cover_blob AS blob FROM gallery_entries WHERE file_id = ?", fileId).map((r) => r.blob),
  ];
  return ids.filter((b): b is string => !!b);
}

export function decodeHeader(v: string | undefined): string | undefined {
  if (v === undefined) return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return fail(400, "A header is not properly encoded");
  }
}

function parseSeq(v: string): number {
  const s = v.trim();
  if (!/^\d{1,15}$/.test(s)) fail(400, "X-Collab-Seq must be a whole number");
  return Number(s);
}

function labelOf(v: string | undefined): string | null {
  return cleanLine(decodeHeader(v) ?? "", 120) || null;
}

// ---- quotas and versions ----

function countOwned(userId: string): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM files WHERE owner_id = ? AND lineage IS NOT 'branch'", userId)?.n ?? 0;
}

export function assertFileQuota(owner: UserRow): void {
  const limits = limitsOf(owner);
  if (limits.files > 0 && countOwned(owner.id) >= limits.files) {
    fail(409, `Your plan allows ${limits.files} drawings. Delete one to make room, or upgrade.`, "limit");
  }
}

function assertBytesQuota(owner: UserRow): void {
  const limits = limitsOf(owner);
  if (limits.bytes > 0 && usageOf(owner.id).bytes > limits.bytes) {
    fail(
      409,
      `Your drawings would be over the ${formatBytes(limits.bytes)} your plan allows. Delete a drawing to make room, or upgrade.`,
      "limit",
    );
  }
}

function assertBase(fileId: string, base: string | undefined): void {
  if (base === undefined) return;
  const head = get<{ head_version_id: string | null }>("SELECT head_version_id FROM files WHERE id = ?", fileId);
  if (!head) fail(404, "Drawing not found", "not_found");
  if (head.head_version_id !== base) {
    fail(409, "A newer version was saved since you opened this drawing. Reload it to see that version.", "conflict");
  }
}

/**
 * A live session's save holds the room's changes up to `seq`: it can't be older than the version
 * already at the head (catch-up from there would need changes the room has dropped) nor newer
 * than the room's last change.
 */
function assertSeq(fileId: string, seq: number | null, lastSeq: number): void {
  if (seq === null) return;
  const head = get<{ collab_seq: number }>("SELECT v.collab_seq FROM files f JOIN versions v ON v.id = f.head_version_id WHERE f.id = ?", fileId);
  if (head && seq < head.collab_seq) fail(409, "A newer version was saved by the live session", "conflict");
  if (seq > lastSeq) fail(400, "X-Collab-Seq is ahead of the live session");
}

export interface NewVersion {
  readonly fileId: string;
  readonly authorId: string;
  readonly blob: string;
  readonly size: number;
  readonly sha256: string;
  readonly label: string | null;
  readonly collabSeq: number;
  readonly autosave?: Autosave;
}

/**
 * An autosave is kept like any version ("keep"), or ("replace") takes the place of the version
 * before it when that was an unnamed autosave, so a big drawing's autosaves don't pile up full
 * copies. Naming an autosave in the history keeps it.
 */
export type Autosave = "keep" | "replace";

function autosaveOf(v: string | undefined): Autosave | undefined {
  const s = v?.trim().toLowerCase();
  if (!s) return undefined;
  if (s === "keep") return "keep";
  if (s === "replace") return "replace";
  fail(400, "X-Autosave must be keep or replace");
}

/** Adds a version and makes it the head, prunes past the owner's version limit, checks the bytes limit. Call inside tx(). */
/** versions a gallery entry shows (gallery.ts): kept while it is published or hidden, whatever the plan's count */
const PINNED = "SELECT version_id FROM gallery_entries WHERE version_id IS NOT NULL AND unpublished_at IS NULL";

export function addVersionTx(v: NewVersion): { row: VersionRow; pruned: string[] } {
  const owner = ownerRow(v.fileId);
  if (!owner) fail(404, "Drawing not found", "not_found");
  const before =
    v.autosave === "replace"
      ? get<{ id: string; blob: string; label: string | null; autosave: number }>(
          "SELECT v.id, v.blob, v.label, v.autosave FROM files f JOIN versions v ON v.id = f.head_version_id WHERE f.id = ?",
          v.fileId,
        )
      : undefined;
  const now = nowIso();
  const id = newId();
  run(
    `INSERT INTO versions (id, file_id, author_id, created_at, size, label, blob, sha256, collab_seq, autosave)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    v.fileId,
    v.authorId,
    now,
    v.size,
    v.label,
    v.blob,
    v.sha256,
    v.collabSeq,
    v.autosave ? 1 : 0,
  );
  run("UPDATE files SET head_version_id = ?, size = ?, updated_at = ? WHERE id = ?", id, v.size, now, v.fileId);

  const pruned: string[] = [];
  if (before && before.autosave === 1 && before.label === null && !get<{ x: number }>("SELECT 1 AS x FROM gallery_entries WHERE version_id = ? AND unpublished_at IS NULL", before.id)) {
    run("DELETE FROM versions WHERE id = ?", before.id);
    pruned.push(before.blob);
  }
  const keep = limitsOf(owner).versions;
  if (keep > 0) {
    const newestFirst = all<{ id: string; blob: string }>(
      `SELECT id, blob FROM versions WHERE file_id = ? AND id NOT IN (${PINNED}) ORDER BY created_at DESC, rowid DESC`,
      v.fileId,
    );
    for (const old of newestFirst.slice(keep)) {
      if (old.id === id) continue;
      run("DELETE FROM versions WHERE id = ?", old.id);
      pruned.push(old.blob);
    }
  }
  assertBytesQuota(owner);

  const row = get<VersionRow>(`${VERSION_SQL} WHERE v.id = ?`, id);
  if (!row) fail(500, "The new version could not be read back");
  return { row, pruned };
}

class DryRun extends Error {}

/**
 * What the drawing's owner's plan would refuse an autosave of this size for, or null: it is added
 * and taken back, so it counts just what a real one would (the version limit, what it replaces).
 */
export function saveRefusal(fileId: string, size: number): string | null {
  const owner = ownerRow(fileId);
  if (!owner) return null;
  try {
    tx(() => {
      addVersionTx({
        fileId,
        authorId: owner.id,
        blob: "",
        size,
        sha256: "",
        label: null,
        collabSeq: 0,
        autosave: size > BIG_DRAWING ? "replace" : "keep",
      });
      throw new DryRun();
    });
  } catch (e) {
    if (e instanceof HttpError && e.code === "limit") return e.message;
    if (!(e instanceof DryRun)) console.error("[files] could not check the plan's room for a save:", e);
  }
  return null;
}

/** Sends a stored version's bytes with the version headers. */
export async function serveVersion(c: Context, row: VersionRow): Promise<Response> {
  const size = await blobSize(row.blob);
  if (size === null) fail(500, "A stored version is missing its file");
  c.header("Content-Type", "application/octet-stream");
  c.header("Content-Length", String(size));
  c.header("Cache-Control", "private, no-store");
  c.header("X-Version-Id", row.id);
  c.header("X-Collab-Seq", String(row.collab_seq));
  return c.body(fileStream(blobPath(row.blob)));
}

// ---- routes ----

export function registerFiles(app: Hono): void {
  app.get("/api/files", (c) => {
    const user = requireUser(c);
    const rows = all<FileRow>(`${FILE_SQL} WHERE f.lineage IS NOT 'branch' ORDER BY f.updated_at DESC`, user.id);
    return c.json({ files: rows.map(toCloudFile) });
  });

  app.post("/api/files", async (c) => {
    const user = requireUser(c);
    const name = cleanLine(decodeHeader(c.req.header("x-file-name")), 200) || "Untitled drawing";
    assertFileQuota(user);
    const received = await receiveUpload(c.req.raw, user.id, config.maxUploadBytes, "The drawing");
    const blob = await commitBlob(received);
    const fileId = newId();
    try {
      tx(() => {
        assertFileQuota(user);
        const now = nowIso();
        run(
          "INSERT INTO files (id, owner_id, name, created_at, updated_at, head_version_id, size, has_thumbnail) VALUES (?, ?, ?, ?, ?, NULL, 0, 0)",
          fileId,
          user.id,
          name,
          now,
          now,
        );
        run("INSERT INTO members (file_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", fileId, user.id, now);
        addVersionTx({ fileId, authorId: user.id, blob, size: received.size, sha256: received.sha256, label: null, collabSeq: 0 });
      });
    } catch (e) {
      await releaseBlobs([blob]);
      throw e;
    }
    return c.json({ file: mustFile(fileId, user.id) }, 201);
  });

  app.get("/api/files/:id", (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id);
    return c.json({ file: mustFile(fileId, user.id), members: memberList(fileId) });
  });

  app.patch("/api/files/:id", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can rename this drawing");
    const body = await readJson(c);
    const name = cleanLine(body.name, 200);
    if (!name) fail(400, "Enter a name");
    run("UPDATE files SET name = ? WHERE id = ?", name, fileId);
    return c.json({ file: mustFile(fileId, user.id) });
  });

  app.delete("/api/files/:id", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, ["owner"], "Only the owner can delete this drawing");
    // a drawing's branches go with it (forks, owned by others, stay)
    const family = [fileId, ...all<{ id: string }>("SELECT id FROM files WHERE parent_file_id = ? AND lineage = 'branch'", fileId).map((r) => r.id)];
    const blobs = family.flatMap((id) => fileBlobs(id));
    tx(() => {
      for (const id of family) run("DELETE FROM files WHERE id = ?", id);
    });
    await releaseBlobs(blobs);
    for (const id of family) getHub().kick(id);
    return c.body(null, 204);
  });

  app.get("/api/files/:id/content", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id);
    const versionId = c.req.query("version");
    const row = versionId
      ? get<VersionRow>(`${VERSION_SQL} WHERE v.id = ? AND v.file_id = ?`, versionId, fileId)
      : get<VersionRow>(`${VERSION_SQL} JOIN files f ON f.head_version_id = v.id WHERE f.id = ?`, fileId);
    if (!row) fail(404, "Version not found", "not_found");
    return serveVersion(c, row);
  });

  app.put("/api/files/:id/content", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can save this drawing");
    const hub = getHub();

    // A save from a live session carries its seq; a plain save waits until the room has none unsaved.
    const seqHeader = c.req.header("x-collab-seq");
    const seq = seqHeader === undefined ? null : parseSeq(seqHeader);
    if (seq === null && !hub.canSavePlain(fileId)) fail(409, "A live session is editing this drawing", "conflict");
    const plainSeq = seq === null ? hub.currentSeq(fileId) : null;
    const base = c.req.header("x-base-version") || undefined;
    assertBase(fileId, base);
    const label = labelOf(c.req.header("x-version-label"));
    // only a save checked against the head (its base or its live session's seq) holds all the
    // version it would replace held
    const asked = autosaveOf(c.req.header("x-autosave"));
    const autosave = asked === "replace" && base === undefined && seq === null ? "keep" : asked;

    const received = await receiveUpload(c.req.raw, user.id, config.maxUploadBytes, "The drawing");
    const blob = await commitBlob(received);
    let saved: { row: VersionRow; pruned: string[] };
    try {
      saved = tx(() => {
        assertBase(fileId, base);
        if (seq === null && (!hub.canSavePlain(fileId) || hub.currentSeq(fileId) !== plainSeq)) {
          fail(409, "The live session changed while this drawing was uploading. Reload it before saving.", "conflict");
        }
        assertSeq(fileId, seq, hub.currentSeq(fileId));
        return addVersionTx({
          fileId,
          authorId: user.id,
          blob,
          size: received.size,
          sha256: received.sha256,
          label,
          collabSeq: seq ?? plainSeq!,
          autosave,
        });
      });
    } catch (e) {
      await releaseBlobs([blob]);
      if (seq !== null && e instanceof HttpError && e.code === "limit") hub.saveRefused(fileId, received.size);
      throw e;
    }
    await releaseBlobs(saved.pruned);
    if (seq !== null) hub.versionSaved(fileId, saved.row.id, seq);
    return c.json({ file: mustFile(fileId, user.id), version: toVersion(saved.row) });
  });

  app.get("/api/files/:id/versions", (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id);
    const rows = all<VersionRow>(`${VERSION_SQL} WHERE v.file_id = ? ORDER BY v.created_at DESC, v.rowid DESC`, fileId);
    return c.json({ versions: rows.map(toVersion) });
  });

  app.post("/api/files/:id/versions/:vid/restore", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can restore a version");
    const src = get<VersionRow>(`${VERSION_SQL} WHERE v.id = ? AND v.file_id = ?`, c.req.param("vid"), fileId);
    if (!src) fail(404, "Version not found", "not_found");
    // The room reloads for everyone; the restored version starts after the reset.
    const seq = getHub().reset(fileId);
    const saved = tx(() =>
      addVersionTx({ fileId, authorId: user.id, blob: src.blob, size: src.size, sha256: src.sha256, label: null, collabSeq: seq }),
    );
    await releaseBlobs(saved.pruned);
    return c.json({ file: mustFile(fileId, user.id), version: toVersion(saved.row) });
  });

  app.patch("/api/files/:id/versions/:vid", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    const vid = c.req.param("vid");
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can name a version");
    const body = await readJson(c);
    const label = cleanLine(body.label, 120) || null;
    const changed = run("UPDATE versions SET label = ? WHERE id = ? AND file_id = ?", label, vid, fileId);
    const row = changed === 1 ? get<VersionRow>(`${VERSION_SQL} WHERE v.id = ?`, vid) : undefined;
    if (!row) fail(404, "Version not found", "not_found");
    return c.json({ version: toVersion(row) });
  });

  app.put("/api/files/:id/thumbnail", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can change the preview");
    const received = await receiveBody(c.req.raw, 512 * KB, "The preview");
    const magic = await headBytes(received.tmp, PNG_SIGNATURE.length);
    if (!magic.equals(PNG_SIGNATURE)) {
      await rm(received.tmp, { force: true });
      fail(400, "The preview must be a PNG picture");
    }
    const blob = await commitBlob(received);
    let previous: string | null;
    try {
      previous = tx(() => {
        const row = get<{ thumbnail_blob: string | null }>("SELECT thumbnail_blob FROM files WHERE id = ?", fileId);
        if (!row) fail(404, "Drawing not found", "not_found");
        run("UPDATE files SET thumbnail_blob = ?, has_thumbnail = 1 WHERE id = ?", blob, fileId);
        return row.thumbnail_blob;
      });
    } catch (e) {
      await releaseBlobs([blob]);
      throw e;
    }
    await releaseBlobs([previous]);
    return c.body(null, 204);
  });

  app.get("/api/files/:id/thumbnail", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id);
    const row = get<{ thumbnail_blob: string | null }>("SELECT thumbnail_blob FROM files WHERE id = ?", fileId);
    if (!row?.thumbnail_blob) fail(404, "No preview yet", "not_found");
    const size = await blobSize(row.thumbnail_blob);
    if (size === null) fail(404, "No preview yet", "not_found");
    c.header("Content-Type", "image/png");
    c.header("Content-Length", String(size));
    c.header("Cache-Control", "private, no-cache");
    return c.body(fileStream(blobPath(row.thumbnail_blob)));
  });
}
