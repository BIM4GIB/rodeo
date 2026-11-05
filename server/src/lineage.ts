// Lineage: where a drawing came from. A fork (gallery) or a branch is a drawing whose first version
// shares its source version's stored file. Branches hang off one main drawing (the family root),
// share its members and roles, and keep base_blob: the drawing they and Main last agreed on, the
// common ancestor a merge needs. Routes: the family, new/rename/delete branch, a branch's base, and
// updating a branch from Main.

import type { Context, Hono } from "hono";
import { CAN_EDIT } from "../../web/src/platform/protocol.ts";
import {
  BRANCH_NAME_MAX,
  type BranchInfo,
  branchFileName,
  cleanBranchName,
  type Family,
  MAIN_NAME,
  MAX_BRANCHES,
} from "../../web/src/features/branches/wire.ts";
import { requireUser } from "./auth.ts";
import { blobPath, blobSize, commitBlob, releaseBlobs } from "./blobs.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { addVersionTx, fileBlobs, mustFile, requireRole, toVersion, type VersionRow } from "./files.ts";
import { readJson } from "./http.ts";
import { getHub } from "./hub.ts";
import { receiveUpload } from "./uploads.ts";
import { cleanLine, fail, fileStream, newId, nowIso } from "./util.ts";

/** What a new fork or branch is made from, and by whom. */
export interface CopyOptions {
  readonly sourceFileId: string;
  /** a version of the source; its head when left out */
  readonly versionId?: string;
  readonly ownerId: string;
  readonly name: string;
  readonly kind: "fork" | "branch";
  readonly branchName?: string;
  /** who made it (the version's author, files.created_by); ownerId when left out */
  readonly createdBy?: string;
}

/** What a merge writes: the bytes the editor merged, into `intoFileId`, from `fromFileId`. */
export interface MergeWrite {
  readonly userId: string;
  readonly intoFileId: string;
  readonly fromFileId: string;
  /** the branch whose base becomes the version merged in */
  readonly branchId: string;
  readonly label: string;
  /** runs inside the transaction after the version is added; throwing rolls the whole write back */
  readonly inTx?: (versionId: string) => void;
}

const MOVED = "The branch or Main has a newer version. Rodeo is merging again.";
const LIVE = "Someone is editing this drawing right now. Rodeo will try again when their changes are saved.";
const MAIN_CLASH = "Main is the name of the drawing itself. Pick another name.";

interface SourceRow {
  id: string;
  owner_id: string;
  name: string;
  head_version_id: string | null;
  has_thumbnail: number;
  thumbnail_blob: string | null;
  lineage: string | null;
  parent_file_id: string | null;
  base_blob: string | null;
}

/** Makes a drawing that shares a version's stored file; callers check access to the source and the plan's count. */
export function copyFileAt(opts: CopyOptions): { fileId: string; versionId: string } {
  // Only the row, its members and one version are written. Comments and share links stay behind. The
  // bytes are shared by reference (blobs.ts counts the references), so no bytes are copied on disk;
  // the owner's storage limit still counts the new version, as any version does.
  return tx(() => {
    const src = get<SourceRow>(
      "SELECT id, owner_id, name, head_version_id, has_thumbnail, thumbnail_blob, lineage, parent_file_id, base_blob FROM files WHERE id = ?",
      opts.sourceFileId,
    );
    if (!src) fail(404, "Drawing not found", "not_found");
    const versionId = opts.versionId ?? src.head_version_id ?? "";
    const v = get<{ id: string; blob: string; size: number; sha256: string }>(
      "SELECT id, blob, size, sha256 FROM versions WHERE id = ? AND file_id = ?",
      versionId,
      src.id,
    );
    if (!v) fail(404, "Version not found", "not_found");

    // A branch of a branch still hangs off the main drawing, and keeps the base it was made with.
    let root = src.id;
    let base: string | null = null;
    let branchName: string | null = null;
    if (opts.kind === "branch") {
      root = src.lineage === "branch" ? (src.parent_file_id ?? "") : src.id;
      if (!root) fail(409, "The branch's drawing was deleted", "conflict");
      base = src.lineage === "branch" ? src.base_blob : v.blob;
      branchName = opts.branchName ?? "";
      if (!branchName) fail(400, "Enter a branch name");
      const rootOwner = get<{ owner_id: string }>("SELECT owner_id FROM files WHERE id = ?", root);
      if (!rootOwner) fail(409, "The branch's drawing was deleted", "conflict");
      if (rootOwner.owner_id !== opts.ownerId) fail(500, "A branch belongs to its drawing's owner");
    }

    const fileId = newId();
    const now = nowIso();
    run(
      `INSERT INTO files (id, owner_id, name, created_at, updated_at, head_version_id, size, has_thumbnail,
        thumbnail_blob, parent_file_id, parent_version_id, lineage, branch_name, base_blob, created_by)
       VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
      fileId,
      opts.ownerId,
      opts.name,
      now,
      now,
      // a fork is of the published version, and the drawing's thumbnail shows it as it is now, which
      // may be private; the forker's first save makes the fork's own
      opts.kind === "fork" ? 0 : src.has_thumbnail,
      opts.kind === "fork" ? null : src.thumbnail_blob,
      root,
      v.id,
      opts.kind,
      branchName,
      base,
      opts.createdBy ?? opts.ownerId,
    );
    if (opts.kind === "branch") {
      run(
        "INSERT INTO members (file_id, user_id, role, added_at) SELECT ?, user_id, role, ? FROM members WHERE file_id = ?",
        fileId,
        now,
        root,
      );
    } else {
      run("INSERT INTO members (file_id, user_id, role, added_at) VALUES (?, ?, 'owner', ?)", fileId, opts.ownerId, now);
    }
    const added = addVersionTx({
      fileId,
      authorId: opts.createdBy ?? opts.ownerId,
      blob: v.blob,
      size: v.size,
      sha256: v.sha256,
      label: null,
      collabSeq: 0,
    });
    return { fileId, versionId: added.row.id };
  });
}

/** The family root of a drawing: Main for a branch, the drawing itself otherwise. */
export function familyRoot(fileId: string): string {
  const r = get<{ lineage: string | null; parent_file_id: string | null }>(
    "SELECT lineage, parent_file_id FROM files WHERE id = ?",
    fileId,
  );
  return r && r.lineage === "branch" && r.parent_file_id ? r.parent_file_id : fileId;
}

/** A branch's family root, its name and who made it; 400 when the drawing is not a branch. */
export function branchOf(fileId: string): { readonly id: string; readonly rootId: string; readonly name: string; readonly createdBy: string | null } {
  const row = get<{ lineage: string | null; root_id: string | null; branch_name: string | null; created_by: string | null }>(
    "SELECT lineage, parent_file_id AS root_id, branch_name, created_by FROM files WHERE id = ?",
    fileId,
  );
  if (!row || row.lineage !== "branch" || !row.root_id) fail(400, "That drawing is not a branch");
  return { id: fileId, rootId: row.root_id, name: row.branch_name ?? "", createdBy: row.created_by };
}

/** Gives every branch of `rootId` exactly Main's members and roles, and disconnects anyone whose access changed. */
export function syncFamily(rootId: string): void {
  // The kicks wait until the change has committed, so a reconnecting session sees the new roles.
  const roles = new Map(
    all<{ user_id: string; role: string }>("SELECT user_id, role FROM members WHERE file_id = ?", rootId).map((r) => [r.user_id, r.role]),
  );
  const kicks: { branchId: string; userId: string }[] = [];
  const now = nowIso();
  tx(() => {
    const ids = all<{ id: string }>("SELECT id FROM files WHERE parent_file_id = ? AND lineage = 'branch'", rootId).map((r) => r.id);
    for (const branchId of ids) {
      const before = all<{ user_id: string; role: string }>("SELECT user_id, role FROM members WHERE file_id = ?", branchId);
      run("DELETE FROM members WHERE file_id = ?", branchId);
      run("INSERT INTO members (file_id, user_id, role, added_at) SELECT ?, user_id, role, ? FROM members WHERE file_id = ?", branchId, now, rootId);
      for (const m of before) if (roles.get(m.user_id) !== m.role) kicks.push({ branchId, userId: m.user_id });
    }
  });
  for (const k of kicks) getHub().kick(k.branchId, k.userId);
}

/** The head version of a drawing, or null when it has none. 404 when there is no such drawing. */
function headOf(fileId: string): string | null {
  const r = get<{ head_version_id: string | null }>("SELECT head_version_id FROM files WHERE id = ?", fileId);
  if (!r) fail(404, "Drawing not found", "not_found");
  return r.head_version_id;
}

/** Refuses a merge on heads that have moved, or into a drawing whose live session has unsaved changes. */
function assertCurrent(intoFileId: string, fromFileId: string, intoVersion: string, fromVersion: string): void {
  if (headOf(intoFileId) !== intoVersion || headOf(fromFileId) !== fromVersion) fail(409, MOVED, "moved");
  if (!getHub().canSavePlain(intoFileId)) fail(409, LIVE, "live");
}

/** Writes a merged drawing as `intoFileId`'s new head, checking the heads the editor merged from. */
export async function writeMerged(c: Context, opts: MergeWrite): Promise<{ row: VersionRow }> {
  // The client says which heads it merged, in X-Into-Version and X-From-Version. A merge on heads that
  // have moved is refused (409 "moved") and the client merges again.
  const intoVersion = (c.req.header("x-into-version") ?? "").trim();
  const fromVersion = (c.req.header("x-from-version") ?? "").trim();
  if (!intoVersion || !fromVersion) fail(400, "X-Into-Version and X-From-Version are needed");
  // refused before the bytes come up, so a stale merge doesn't upload a large drawing first
  assertCurrent(opts.intoFileId, opts.fromFileId, intoVersion, fromVersion);

  const received = await receiveUpload(c.req.raw, opts.userId, config.maxUploadBytes, "The merged drawing");
  const blob = await commitBlob(received);
  let saved: { row: VersionRow; pruned: string[]; oldBase: string | null };
  try {
    saved = tx(() => {
      assertCurrent(opts.intoFileId, opts.fromFileId, intoVersion, fromVersion);
      const from = get<{ blob: string }>("SELECT blob FROM versions WHERE id = ?", fromVersion);
      if (!from) fail(409, MOVED, "moved");
      const oldBase = get<{ base_blob: string | null }>("SELECT base_blob FROM files WHERE id = ?", opts.branchId)?.base_blob ?? null;
      const added = addVersionTx({
        fileId: opts.intoFileId,
        authorId: opts.userId,
        blob,
        size: received.size,
        sha256: received.sha256,
        label: cleanLine(opts.label, 120) || null,
        collabSeq: getHub().currentSeq(opts.intoFileId),
      });
      run("UPDATE files SET base_blob = ? WHERE id = ?", from.blob, opts.branchId);
      opts.inTx?.(added.row.id);
      return { row: added.row, pruned: added.pruned, oldBase };
    });
  } catch (e) {
    await releaseBlobs([blob]);
    throw e;
  }
  // the reset follows the commit in the same run, so no live change can slip in between
  getHub().reset(opts.intoFileId);
  await releaseBlobs([...saved.pruned, saved.oldBase]);
  return { row: saved.row };
}

// ---- wire rows ----

interface InfoRow {
  id: string;
  name: string;
  branch_name: string | null;
  owner_id: string;
  head_version_id: string | null;
  size: number;
  created_at: string;
  updated_at: string;
  parent_version_id: string | null;
  by_id: string | null;
  by_name: string | null;
  open_request_id: string | null;
}

const INFO_SQL = `SELECT f.id, f.name, f.branch_name, f.owner_id, f.head_version_id, f.size, f.created_at, f.updated_at,
    f.parent_version_id, u.id AS by_id, u.name AS by_name,
    (SELECT r.id FROM merge_requests r WHERE r.source_file_id = f.id AND r.state = 'open') AS open_request_id
  FROM files f LEFT JOIN users u ON u.id = f.created_by`;

/** A drawing of a family as the editor lists it: Main when its id is the family root, else a branch. */
function infoOf(r: InfoRow, rootId: string): BranchInfo {
  const main = r.id === rootId;
  return {
    fileId: r.id,
    name: main ? MAIN_NAME : (r.branch_name ?? ""),
    main,
    headVersionId: r.head_version_id ?? "",
    size: r.size,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    createdBy: r.by_id ? { id: r.by_id, name: r.by_name ?? "Former member" } : null,
    fromVersionId: main ? null : r.parent_version_id,
    openRequestId: r.open_request_id,
  };
}

/** A branch name from a request body, or the 400 it earns: Main's own name gets its own message. */
function branchNameOf(v: unknown): string {
  const name = cleanBranchName(v);
  if (name) return name;
  if (cleanLine(v, BRANCH_NAME_MAX).toLowerCase() === MAIN_NAME.toLowerCase()) fail(400, MAIN_CLASH);
  fail(400, "Enter a branch name");
}

// ---- routes ----

/** Registers the branch routes: the family, new, rename and delete, a branch's base, and its update from Main. */
export function registerBranches(app: Hono): void {
  app.get("/api/files/:id/family", (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    requireRole(id, user.id);
    const rootId = familyRoot(id);
    const role = requireRole(rootId, user.id);
    const rows = all<InfoRow>(`${INFO_SQL} WHERE f.id = ? OR (f.parent_file_id = ? AND f.lineage = 'branch') ORDER BY f.created_at`, rootId, rootId);
    const main = rows.find((r) => r.id === rootId);
    if (!main) fail(404, "Drawing not found", "not_found");
    const family: Family = {
      rootId,
      rootName: main.name,
      ownerId: main.owner_id,
      role,
      main: infoOf(main, rootId),
      branches: rows.filter((r) => r.id !== rootId).map((r) => infoOf(r, rootId)),
    };
    return c.json({ family });
  });

  app.post("/api/files/:id/branches", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    const rootId = familyRoot(id);
    requireRole(rootId, user.id, CAN_EDIT, "Only the owner or an editor can start a branch");
    const body = await readJson(c);
    const name = branchNameOf(body.name);
    const root = get<{ name: string; owner_id: string }>("SELECT name, owner_id FROM files WHERE id = ?", rootId);
    if (!root) fail(404, "Drawing not found", "not_found");
    if (get<{ id: string }>("SELECT id FROM files WHERE parent_file_id = ? AND lineage = 'branch' AND lower(branch_name) = lower(?)", rootId, name)) {
      fail(409, `There's already a branch called ${name}.`, "conflict");
    }
    const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM files WHERE parent_file_id = ? AND lineage = 'branch'", rootId)?.n ?? 0;
    if (count >= MAX_BRANCHES) fail(409, `A drawing can have ${MAX_BRANCHES} branches. Delete one to make room.`, "limit");
    // it starts at this drawing's head (Main's, or the branch's own), sharing its stored bytes
    const made = copyFileAt({
      sourceFileId: id,
      ownerId: root.owner_id,
      name: branchFileName(root.name, name),
      kind: "branch",
      branchName: name,
      createdBy: user.id,
    });
    const row = get<InfoRow>(`${INFO_SQL} WHERE f.id = ?`, made.fileId);
    if (!row) fail(500, "The new branch could not be read back");
    return c.json({ branch: infoOf(row, rootId), file: mustFile(made.fileId, user.id) }, 201);
  });

  app.patch("/api/branches/:id", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    requireRole(id, user.id, CAN_EDIT, "Only the owner or an editor can rename a branch");
    const branch = branchOf(id);
    const body = await readJson(c);
    const name = branchNameOf(body.name);
    if (get<{ id: string }>("SELECT id FROM files WHERE parent_file_id = ? AND lineage = 'branch' AND lower(branch_name) = lower(?) AND id != ?", branch.rootId, name, id)) {
      fail(409, `There's already a branch called ${name}.`, "conflict");
    }
    const root = get<{ name: string }>("SELECT name FROM files WHERE id = ?", branch.rootId);
    if (!root) fail(404, "Drawing not found", "not_found");
    run("UPDATE files SET branch_name = ?, name = ? WHERE id = ?", name, branchFileName(root.name, name), id);
    const row = get<InfoRow>(`${INFO_SQL} WHERE f.id = ?`, id);
    if (!row) fail(404, "Drawing not found", "not_found");
    return c.json({ branch: infoOf(row, branch.rootId) });
  });

  app.delete("/api/branches/:id", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    const role = requireRole(id, user.id);
    const branch = branchOf(id);
    // whoever made it keeps the right only while they can still edit the drawing
    if (role !== "owner" && !(role === "editor" && branch.createdBy === user.id)) fail(403, "Only the owner or whoever made this branch can delete it", "forbidden");
    const blobs = fileBlobs(id);
    tx(() => {
      run("DELETE FROM files WHERE id = ?", id);
    });
    await releaseBlobs(blobs);
    getHub().kick(id);
    return c.body(null, 204);
  });

  // A branch's common ancestor, for the editor's three-way merge.
  app.get("/api/branches/:id/base", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    requireRole(id, user.id);
    const base = get<{ base_blob: string | null }>("SELECT base_blob FROM files WHERE id = ?", id)?.base_blob ?? null;
    const size = base ? await blobSize(base) : null;
    if (!base || size === null) fail(404, "This branch has no starting point stored", "not_found");
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Length", String(size));
    c.header("Cache-Control", "private, no-store");
    return c.body(fileStream(blobPath(base)));
  });

  // The editor merges Main into the branch and sends the result; the branch's base becomes Main's head.
  app.post("/api/branches/:id/update", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    requireRole(id, user.id, CAN_EDIT, "Only the owner or an editor can update a branch from Main");
    const branch = branchOf(id);
    const { row } = await writeMerged(c, {
      userId: user.id,
      intoFileId: id,
      fromFileId: branch.rootId,
      branchId: id,
      label: "Updated from Main",
    });
    return c.json({ version: toVersion(row) });
  });
}
