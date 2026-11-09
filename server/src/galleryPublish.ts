// Publishing to the gallery and forking from it: a drawing's gallery state for its publish dialog;
// publishing (a new entry, a republish, or the current version in place of the one shown), its
// details, its cover and unpublishing, each by the drawing's owner; forking an entry into the
// signed-in account (copyFileAt copies the version; the fork keeps the credit and licence it was
// taken under); and where a forked drawing came from.

import { randomBytes } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Hono } from "hono";
import { allowed, isAdmin, limitsOf, requireUser, type UserRow, usageOf } from "./auth.ts";
import { commitBlob, headBytes, receiveBody, releaseBlobs } from "./blobs.ts";
import { get, run, tx } from "./db.ts";
import { assertFileQuota, requireRole } from "./files.ts";
import {
  cardOf,
  type EntryRow,
  entryById,
  entryForFile,
  forkedFromOf,
  issueShare,
  NOT_THERE,
  ownEntryOf,
  revokeShare,
  visibleEntry,
} from "./gallery.ts";
import { readJson } from "./http.ts";
import { copyFileAt } from "./lineage.ts";
import {
  defaultLicenceFor,
  type ForkAttribution,
  type ForkResult,
  isEntryId,
  isLicenceId,
  licenceOf,
  licencesForFork,
  LIMITS,
  type LicenceId,
  MAX_COVER_BYTES,
  MAX_GALLERY_BYTES,
  MAX_TAGS,
  normalizeTags,
  type OwnEntry,
  type PublishFields,
  type PublishState,
} from "../../web/src/features/gallery/rules.ts";
import type { Role } from "../../web/src/platform/protocol.ts";
import { cleanBody, cleanLine, DAY, fail, formatBytes, HOUR, nowIso } from "./util.ts";

/** Publishing needs Rodeo Plus when true (the gallery is free while false). */
const GALLERY_NEEDS_PLUS = false;

/** Drawings one account may have in the gallery at once. */
const LIVE_ENTRIES = 50;

/** Drawings a new account (one less than a day old) may have in the gallery. */
const NEW_ACCOUNT_ENTRIES = 3;

/** The letters entry ids are written in: the alphabet isEntryId accepts. */
const ENTRY_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

/** The label a published version gets, so an autosave does not replace it (files.ts). */
const PINNED_LABEL = "Published to the gallery";

const PLUS_NOTICE = "Publishing to the gallery is part of Rodeo Plus.";
const TOO_BIG = `Drawings over ${formatBytes(MAX_GALLERY_BYTES)} can't go in the gallery yet.`;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

/** A drawing's row as the publish routes read it. */
interface DrawingRow {
  name: string;
  head_version_id: string | null;
  size: number;
}

/** The drawing with this id, or 404. */
function drawingOf(fileId: string): DrawingRow {
  const row = get<DrawingRow>("SELECT name, head_version_id, size FROM files WHERE id = ?", fileId);
  if (!row) fail(404, "Drawing not found", "not_found");
  return row;
}

/** A new entry id: 12 characters, none in use yet. */
function newEntryId(): string {
  for (;;) {
    const id = Array.from(randomBytes(12), (b) => ENTRY_ALPHABET[b & 31]).join("");
    if (!entryById(id)) return id;
  }
}

/** The title from a request body; 400 when it is empty. */
function titleOf(v: unknown): string {
  const title = cleanLine(v, LIMITS.title);
  if (!title) fail(400, "Enter a title");
  return title;
}

/** The tags from a request body; 400 when there are more than MAX_TAGS. */
function tagsOf(v: unknown): string[] {
  const tags = normalizeTags(v);
  if (tags.length > MAX_TAGS) fail(400, `Use at most ${MAX_TAGS} tags`);
  return tags;
}

/** A licence from a request body that a drawing with this parent licence may use; 400 otherwise. */
function licenceFor(v: unknown, parent: LicenceId | null): LicenceId {
  if (!isLicenceId(v)) fail(400, "Choose a licence");
  const options = licencesForFork(parent);
  if (options.includes(v)) return v;
  // only a fork can be refused: a drawing that is not one may use any of the four
  const under = parent === null ? "" : (licenceOf(parent)?.name ?? parent);
  const names = options.map((id) => licenceOf(id)?.name ?? id).join(" or ");
  fail(400, `This drawing is a fork of one under ${under}, so it can use ${names}`);
}

/** The publish fields from a request body, each checked; `parent` is the licence of the drawing it was forked from, if any. */
function fieldsOf(body: Record<string, unknown>, parent: LicenceId | null, fallbackCredit: string): PublishFields {
  return {
    title: titleOf(body.title),
    description: cleanBody(body.description, LIMITS.description),
    tags: tagsOf(body.tags),
    licence: licenceFor(body.licence, parent),
    creditName: cleanLine(body.creditName, LIMITS.credit) || fallbackCredit,
  };
}

/** The fields an entry was last published with, as the publish dialog fills them in again. */
function fieldsOfRow(row: EntryRow): PublishFields {
  const card = cardOf(row);
  return { title: row.title, description: row.description, tags: card.tags, licence: card.licence, creditName: row.credit_name };
}

/** Replaces an entry's tags. Call inside tx(). */
function setTags(entryId: string, tags: readonly string[]): void {
  run("DELETE FROM gallery_tags WHERE entry_id = ?", entryId);
  for (const tag of tags) run("INSERT INTO gallery_tags (entry_id, tag) VALUES (?, ?)", entryId, tag);
}

/** Labels the version an entry shows, unless it has a label already. Call inside tx(). */
function labelPinned(versionId: string): void {
  run("UPDATE versions SET label = ? WHERE id = ? AND label IS NULL", PINNED_LABEL, versionId);
}

/** Why an admin's hide is shown to the owner. */
function hiddenNotice(row: EntryRow): string {
  return `Rodeo took this drawing out of the gallery: ${row.hidden_reason ?? "no reason was given"}`;
}

/** The entry with this id when `user` owns it and it has not been unpublished; 404 otherwise. */
function ownedEntry(user: UserRow, id: string): EntryRow {
  const row = isEntryId(id) ? entryById(id) : undefined;
  if (!row || row.owner_id !== user.id || row.unpublished_at !== null) fail(404, NOT_THERE, "not_found");
  return row;
}

/** An entry as its owner sees it, read back after a write. */
function ownEntryAfter(id: string): OwnEntry {
  const row = entryById(id);
  if (!row) fail(500, "The gallery entry could not be read back");
  return ownEntryOf(row);
}

/** Refuses one more live entry past the account's limit, or past a new account's allowance. */
function assertRoomFor(user: UserRow): void {
  const live = get<{ n: number }>("SELECT COUNT(*) AS n FROM gallery_entries WHERE owner_id = ? AND unpublished_at IS NULL", user.id)?.n ?? 0;
  if (live >= LIVE_ENTRIES) fail(409, `You can have ${LIVE_ENTRIES} drawings in the gallery. Unpublish one first.`, "limit");
  const newAccount = Date.parse(user.created_at) > Date.now() - DAY;
  if (newAccount && live >= NEW_ACCOUNT_ENTRIES) {
    fail(409, `New accounts can publish ${NEW_ACCOUNT_ENTRIES} drawings on their first day.`, "limit");
  }
}

/** Why `role` on this drawing can't publish it right now, in one sentence; null when it can. */
function blockedBecause(role: Role, user: UserRow, drawing: DrawingRow, row: EntryRow | undefined): string | null {
  if (role !== "owner") return "Only the drawing's owner can publish it.";
  if (GALLERY_NEEDS_PLUS && !limitsOf(user).shareLinks) return PLUS_NOTICE;
  if (drawing.head_version_id === null) return "Save the drawing first.";
  if (drawing.size > MAX_GALLERY_BYTES) return TOO_BIG;
  if (row && row.hidden_at !== null) return hiddenNotice(row);
  return null;
}

/** The picture type a cover's first bytes show, or null for anything but a PNG or a JPEG. */
function coverTypeOf(head: Buffer): "image/png" | "image/jpeg" | null {
  if (head.equals(PNG_SIGNATURE)) return "image/png";
  if (head.subarray(0, 3).equals(JPEG_SIGNATURE)) return "image/jpeg";
  return null;
}

/** Registers the gallery's signed-in routes: a drawing's publish state, publishing, details, cover, unpublish, forking and attribution. */
export function registerGalleryPublish(app: Hono): void {
  // The publish dialog's state for one drawing; the owner and the drawing's members may read it.
  app.get("/api/gallery/files/:fileId", (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("fileId");
    const role = requireRole(fileId, user.id);
    const drawing = drawingOf(fileId);
    const row = entryForFile(fileId);
    const forkedFrom = forkedFromOf(fileId);
    const parent = forkedFrom?.licence ?? null;
    const owner = role === "owner";
    const reason = blockedBecause(role, user, drawing, row);
    const state: PublishState = {
      entry: owner && row && row.unpublished_at === null ? ownEntryOf(row) : null,
      previous: owner && row && row.unpublished_at !== null ? fieldsOfRow(row) : null,
      canPublish: reason === null,
      reason,
      licences: licencesForFork(parent),
      defaultLicence: defaultLicenceFor(parent),
      forkedFrom,
      fileName: drawing.name,
      headVersionId: drawing.head_version_id,
      size: drawing.size,
      maxBytes: MAX_GALLERY_BYTES,
      defaultCredit: user.name,
      isAdmin: isAdmin(user),
    };
    return c.json(state);
  });

  // Publishes the drawing's head. A new entry, a drawing taken down again (same entry, new share link),
  // or a published one whose version is replaced by the head. Only the owner may.
  app.post("/api/gallery/files/:fileId/publish", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("fileId");
    requireRole(fileId, user.id, ["owner"], "Only the drawing's owner can publish it");
    if (GALLERY_NEEDS_PLUS && !limitsOf(user).shareLinks) fail(403, PLUS_NOTICE, "plan");
    if (!allowed(`gallery-publish:${user.id}`, 10, HOUR)) {
      fail(429, "You've published a lot in the last hour. Try again later.", "rate_limited");
    }
    const body = await readJson(c);
    if (body.agree !== true) fail(400, "Confirm you have the right to share this drawing");

    // Everything below is read after the last await, so nothing changes between the reads and the writes.
    const drawing = drawingOf(fileId);
    const existing = entryForFile(fileId);
    const parent = forkedFromOf(fileId)?.licence ?? null;
    const admin = isAdmin(user);
    const typed = fieldsOf(body, parent, cleanLine(user.name, LIMITS.credit));
    const official = admin && body.official === true;
    const featured = admin && body.featured === true;
    const fields: PublishFields = official ? { ...typed, creditName: "Rodeo" } : typed;

    if (drawing.head_version_id === null) fail(409, "Save the drawing first.", "conflict");
    const head: string = drawing.head_version_id;
    if (drawing.size > MAX_GALLERY_BYTES) fail(413, TOO_BIG, "too_large");
    if (existing && existing.hidden_at !== null) fail(403, hiddenNotice(existing), "forbidden");
    if (!existing || existing.unpublished_at !== null) assertRoomFor(user);

    const now = nowIso();
    // an admin says whether the drawing is picked; anyone else leaves it as it is
    const featuredAt = admin ? (featured ? (existing?.featured_at ?? now) : null) : (existing?.featured_at ?? null);
    const id = existing?.id ?? newEntryId();
    tx(() => {
      if (existing) {
        run(
          `UPDATE gallery_entries SET title = ?, description = ?, tags_json = ?, licence = ?, credit_name = ?, official = ?,
            featured_at = ?, version_id = ?, size = ?, updated_at = ?, unpublished_at = NULL WHERE id = ?`,
          fields.title,
          fields.description,
          JSON.stringify(fields.tags),
          fields.licence,
          fields.creditName,
          official ? 1 : 0,
          featuredAt,
          head,
          drawing.size,
          now,
          id,
        );
        // a drawing taken down gets a new share link; one still published keeps its link and shows the new version
        if (existing.unpublished_at !== null) issueShare({ id, file_id: fileId, owner_id: user.id });
      } else {
        run(
          `INSERT INTO gallery_entries (id, file_id, owner_id, version_id, title, description, tags_json, licence, credit_name,
            official, featured_at, size, published_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          fileId,
          user.id,
          head,
          fields.title,
          fields.description,
          JSON.stringify(fields.tags),
          fields.licence,
          fields.creditName,
          official ? 1 : 0,
          featuredAt,
          drawing.size,
          now,
          now,
        );
        issueShare({ id, file_id: fileId, owner_id: user.id });
      }
      setTags(id, fields.tags);
      labelPinned(head);
    });
    return c.json({ entry: ownEntryAfter(id) }, 201);
  });

  // The details of a published entry, without a new version. Admins may also set official and featured.
  app.patch("/api/gallery/entries/:id", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    ownedEntry(user, id);
    const body = await readJson(c);
    // read again after the body: an admin may have hidden it meanwhile
    const row = ownedEntry(user, id);
    if (row.hidden_at !== null) fail(403, hiddenNotice(row), "forbidden");

    const parent = forkedFromOf(row.file_id)?.licence ?? null;
    const admin = isAdmin(user);
    const now = nowIso();
    const title = "title" in body ? titleOf(body.title) : row.title;
    const description = "description" in body ? cleanBody(body.description, LIMITS.description) : row.description;
    const licence = "licence" in body ? licenceFor(body.licence, parent) : row.licence;
    const tags = "tags" in body ? tagsOf(body.tags) : null;
    // an empty credit keeps the one it had; an official drawing is always credited as Rodeo
    let creditName = "creditName" in body ? cleanLine(body.creditName, LIMITS.credit) || row.credit_name : row.credit_name;
    const official = admin && "official" in body ? body.official === true : row.official === 1;
    if (official) creditName = "Rodeo";
    const featuredAt = admin && "featured" in body ? (body.featured === true ? (row.featured_at ?? now) : null) : row.featured_at;

    tx(() => {
      run(
        "UPDATE gallery_entries SET title = ?, description = ?, licence = ?, credit_name = ?, official = ?, featured_at = ?, updated_at = ? WHERE id = ?",
        title,
        description,
        licence,
        creditName,
        official ? 1 : 0,
        featuredAt,
        now,
        id,
      );
      if (tags !== null) setTags(id, tags);
    });
    return c.json({ entry: ownEntryAfter(id) });
  });

  // Unpublishes: the entry keeps its cover, fields and id for a republish; its share link is revoked.
  app.delete("/api/gallery/entries/:id", (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    const row = isEntryId(id) ? entryById(id) : undefined;
    if (!row || row.owner_id !== user.id) fail(404, NOT_THERE, "not_found");
    if (row.unpublished_at !== null) return c.body(null, 204);
    tx(() => {
      run("UPDATE gallery_entries SET unpublished_at = ?, featured_at = NULL WHERE id = ?", nowIso(), id);
      revokeShare(row);
    });
    return c.body(null, 204);
  });

  // The cover is a PNG or JPEG picture of at most 1 MB, shown in place of the drawing on link previews.
  app.put("/api/gallery/entries/:id/cover", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    ownedEntry(user, id);
    const received = await receiveBody(c.req.raw, MAX_COVER_BYTES, "The cover picture");
    const type = coverTypeOf(await headBytes(received.tmp, 8));
    if (type === null) {
      await rm(received.tmp, { force: true });
      fail(400, "The cover must be a PNG or JPEG picture");
    }
    const blob = await commitBlob(received);
    let previous: string | null;
    try {
      previous = tx(() => {
        const row = ownedEntry(user, id);
        run("UPDATE gallery_entries SET cover_blob = ?, cover_type = ? WHERE id = ?", blob, type, id);
        return row.cover_blob;
      });
    } catch (e) {
      await releaseBlobs([blob]);
      throw e;
    }
    await releaseBlobs([previous]);
    return c.body(null, 204);
  });

  // Makes the signed-in account its own copy of the entry's version. The copy keeps the credit and
  // licence it was taken under, so the attribution outlives the original.
  app.post("/api/gallery/entries/:id/fork", (c) => {
    const user = requireUser(c);
    if (!allowed(`gallery-fork:${user.id}`, 20, HOUR)) {
      fail(429, "You've forked a lot in the last hour. Try again later.", "rate_limited");
    }
    const id = c.req.param("id");
    const row = isEntryId(id) ? visibleEntry(id) : undefined;
    if (!row || row.version_id === null) fail(404, NOT_THERE, "not_found");
    const versionId: string = row.version_id;
    const fileId = tx(() => {
      assertFileQuota(user);
      const limits = limitsOf(user);
      if (limits.bytes > 0 && usageOf(user.id).bytes + row.size > limits.bytes) {
        fail(
          409,
          `This drawing would take you over the ${formatBytes(limits.bytes)} your plan allows. Delete a drawing to make room, or upgrade.`,
          "limit",
        );
      }
      const made = copyFileAt({ sourceFileId: row.file_id, versionId, ownerId: user.id, name: row.title, kind: "fork" });
      run(
        "INSERT INTO gallery_forks (file_id, entry_id, title, credit_name, licence, forked_by, forked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        made.fileId,
        row.id,
        row.title,
        row.credit_name,
        row.licence,
        user.id,
        nowIso(),
      );
      return made.fileId;
    });
    const result: ForkResult = { fileId, url: `/?file=${encodeURIComponent(fileId)}&forked=1` };
    return c.json(result, 201);
  });

  // Where a drawing was forked from, for its members; 404 when it was not forked from the gallery.
  app.get("/api/gallery/forked/:fileId", (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("fileId");
    requireRole(fileId, user.id);
    const from = forkedFromOf(fileId);
    const when = get<{ forked_at: string }>("SELECT forked_at FROM gallery_forks WHERE file_id = ?", fileId);
    // every cloud drawing the editor opens asks, so a drawing that isn't a fork answers null, not an error
    const attribution: ForkAttribution | null = from && when ? { ...from, forkedAt: when.forked_at } : null;
    return c.json({ attribution });
  });
}
