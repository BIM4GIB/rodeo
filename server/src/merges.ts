// Merge requests: asking to merge a branch into its main drawing, approvals, and the merge itself
// (a new version of Main from the merged drawing the editor sends; see lineage.ts writeMerged).
// Their discussion is the branch drawing's comments (comments.ts).

import type { Hono } from "hono";
import { CAN_EDIT, type Role } from "../../web/src/platform/protocol.ts";
import { MERGE_BODY_MAX, MERGE_TITLE_MAX, type MergeRequest, type MergeState } from "../../web/src/features/branches/wire.ts";
import { requireUser } from "./auth.ts";
import { all, get, run } from "./db.ts";
import { requireRole, toVersion } from "./files.ts";
import { readJson } from "./http.ts";
import { branchOf, familyRoot, writeMerged } from "./lineage.ts";
import { cleanBody, cleanLine, fail, newId, nowIso } from "./util.ts";

/** When true, a merge needs a current approval from someone other than its author. */
export const REQUIRE_APPROVAL = false;

/** Who may approve: the people who may comment on the drawing, but not its author (checked apart). */
const APPROVERS: readonly Role[] = ["owner", "editor", "reviewer"];

interface RequestRow {
  id: string;
  source_file_id: string;
  target_file_id: string;
  title: string;
  body: string;
  state: string;
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  merged_version_id: string | null;
  author_id: string | null;
  author_name: string | null;
  merged_by_id: string | null;
  merged_by_name: string | null;
  branch_name: string | null;
  source_head: string | null;
  target_head: string | null;
}

const REQUEST_SQL = `SELECT m.id, m.source_file_id, m.target_file_id, m.title, m.body, m.state, m.created_at, m.updated_at,
    m.merged_at, m.merged_version_id, m.author_id, a.name AS author_name, m.merged_by AS merged_by_id,
    mb.name AS merged_by_name, s.branch_name, s.head_version_id AS source_head, t.head_version_id AS target_head
  FROM merge_requests m
    JOIN files s ON s.id = m.source_file_id
    JOIN files t ON t.id = m.target_file_id
    LEFT JOIN users a ON a.id = m.author_id
    LEFT JOIN users mb ON mb.id = m.merged_by`;

interface ApprovalRow {
  user_id: string;
  user_name: string;
  source_version_id: string;
  created_at: string;
}

interface RequestRef {
  readonly id: string;
  readonly target: string;
  readonly source: string;
  readonly author: string | null;
  readonly state: string;
}

/** A merge request as the editor shows it, with its approvals and the heads it was made on. */
function requestOut(requestId: string): MergeRequest {
  const r = get<RequestRow>(`${REQUEST_SQL} WHERE m.id = ?`, requestId);
  if (!r) fail(404, "Merge request not found", "not_found");
  const head = r.source_head ?? "";
  const approvals = all<ApprovalRow>(
    `SELECT a.user_id, u.name AS user_name, a.source_version_id, a.created_at
     FROM merge_approvals a JOIN users u ON u.id = a.user_id
     WHERE a.request_id = ? ORDER BY a.created_at`,
    requestId,
  ).map((a) => ({
    user: { id: a.user_id, name: a.user_name },
    at: a.created_at,
    versionId: a.source_version_id,
    // an approval of an older version of the branch is still shown, marked as such
    current: a.source_version_id === head,
  }));
  return {
    id: r.id,
    sourceFileId: r.source_file_id,
    targetFileId: r.target_file_id,
    branchName: r.branch_name ?? "",
    title: r.title,
    body: r.body,
    state: r.state as MergeState,
    author: r.author_id ? { id: r.author_id, name: r.author_name ?? "Former member" } : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    mergedBy: r.merged_by_id ? { id: r.merged_by_id, name: r.merged_by_name ?? "Former member" } : null,
    mergedAt: r.merged_at,
    mergedVersionId: r.merged_version_id,
    approvals,
    sourceHeadVersionId: head,
    targetHeadVersionId: r.target_head ?? "",
  };
}

/** A merge request's ids and state, or 404. */
function requestRef(mid: string): RequestRef {
  const r = get<{ id: string; target_file_id: string; source_file_id: string; author_id: string | null; state: string }>(
    "SELECT id, target_file_id, source_file_id, author_id, state FROM merge_requests WHERE id = ?",
    mid,
  );
  if (!r) fail(404, "Merge request not found", "not_found");
  return { id: r.id, target: r.target_file_id, source: r.source_file_id, author: r.author_id, state: r.state };
}

/** The branch's current head version ("" when it has none). */
function headOfBranch(fileId: string): string {
  return get<{ head_version_id: string | null }>("SELECT head_version_id FROM files WHERE id = ?", fileId)?.head_version_id ?? "";
}

/** Whether the branch has an open merge request other than `except` (pass "" for none). */
function otherOpenRequest(source: string, except: string): boolean {
  return get<{ id: string }>("SELECT id FROM merge_requests WHERE source_file_id = ? AND state = 'open' AND id != ?", source, except) !== undefined;
}

/** Whether someone other than the author has approved the branch's head as it is now. */
function currentApproval(mid: string, head: string, author: string | null): boolean {
  return (
    get<{ user_id: string }>(
      "SELECT user_id FROM merge_approvals WHERE request_id = ? AND source_version_id = ? AND user_id IS NOT ?",
      mid,
      head,
      author,
    ) !== undefined
  );
}

/** Registers the merge request routes: list, open, edit, approve, and merge. */
export function registerMerges(app: Hono): void {
  // The family's merge requests: open ones first, then newest. ?state=all includes merged and closed ones.
  app.get("/api/files/:id/merge-requests", (c) => {
    const user = requireUser(c);
    const rootId = familyRoot(c.req.param("id"));
    requireRole(rootId, user.id);
    const onlyOpen = c.req.query("state") !== "all";
    const rows = all<{ id: string }>(
      `SELECT id FROM merge_requests WHERE target_file_id = ?${onlyOpen ? " AND state = 'open'" : ""}
       ORDER BY CASE state WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 100`,
      rootId,
    );
    return c.json({ requests: rows.map((r) => requestOut(r.id)) });
  });

  app.post("/api/branches/:id/merge-requests", async (c) => {
    const user = requireUser(c);
    const id = c.req.param("id");
    requireRole(familyRoot(id), user.id, CAN_EDIT, "Only the owner or an editor can ask to merge");
    const branch = branchOf(id);
    const body = await readJson(c);
    const title = cleanLine(body.title, MERGE_TITLE_MAX);
    if (!title) fail(400, "Give the merge request a title");
    const text = cleanBody(body.body, MERGE_BODY_MAX);
    if (otherOpenRequest(id, "")) fail(409, "This branch already has an open merge request.", "conflict");
    const now = nowIso();
    const mid = newId();
    run(
      "INSERT INTO merge_requests (id, source_file_id, target_file_id, author_id, title, body, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)",
      mid,
      id,
      branch.rootId,
      user.id,
      title,
      text,
      now,
      now,
    );
    return c.json({ request: requestOut(mid) }, 201);
  });

  app.get("/api/merge-requests/:mid", (c) => {
    const user = requireUser(c);
    const ref = requestRef(c.req.param("mid"));
    requireRole(ref.target, user.id);
    return c.json({ request: requestOut(ref.id) });
  });

  app.patch("/api/merge-requests/:mid", async (c) => {
    const user = requireUser(c);
    const ref = requestRef(c.req.param("mid"));
    const role = requireRole(ref.target, user.id);
    // its author keeps the right only while they can still edit the drawing
    if (role !== "owner" && !(role === "editor" && ref.author === user.id)) fail(403, "Only its author or the owner can change this merge request", "forbidden");
    if (ref.state === "merged") fail(409, "A merged request can't change", "conflict");
    const body = await readJson(c);
    const current = requestOut(ref.id);
    const title = body.title === undefined ? current.title : cleanLine(body.title, MERGE_TITLE_MAX);
    if (!title) fail(400, "Give the merge request a title");
    const text = body.body === undefined ? current.body : cleanBody(body.body, MERGE_BODY_MAX);
    let state: MergeState = current.state;
    const asked = body.state;
    if (asked !== undefined) {
      if (asked !== "open" && asked !== "closed") fail(400, "State must be open or closed");
      state = asked;
    }
    if (state === "open" && otherOpenRequest(ref.source, ref.id)) fail(409, "This branch already has an open merge request.", "conflict");
    run("UPDATE merge_requests SET title = ?, body = ?, state = ?, updated_at = ? WHERE id = ?", title, text, state, nowIso(), ref.id);
    return c.json({ request: requestOut(ref.id) });
  });

  app.post("/api/merge-requests/:mid/approval", (c) => {
    const user = requireUser(c);
    const ref = requestRef(c.req.param("mid"));
    requireRole(ref.target, user.id, APPROVERS, "Only reviewers, editors and the owner can approve");
    if (ref.author === user.id) fail(403, "You can't approve your own merge request.", "forbidden");
    if (ref.state !== "open") fail(409, "Only open merge requests can be approved", "conflict");
    const now = nowIso();
    // the branch's head as it is now: a later change to the branch shows this approval as older
    run(
      `INSERT INTO merge_approvals (request_id, user_id, source_version_id, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(request_id, user_id) DO UPDATE SET source_version_id = excluded.source_version_id, created_at = excluded.created_at`,
      ref.id,
      user.id,
      headOfBranch(ref.source),
      now,
    );
    run("UPDATE merge_requests SET updated_at = ? WHERE id = ?", now, ref.id);
    return c.json({ request: requestOut(ref.id) });
  });

  app.delete("/api/merge-requests/:mid/approval", (c) => {
    const user = requireUser(c);
    const ref = requestRef(c.req.param("mid"));
    requireRole(ref.target, user.id);
    if (run("DELETE FROM merge_approvals WHERE request_id = ? AND user_id = ?", ref.id, user.id) > 0) {
      run("UPDATE merge_requests SET updated_at = ? WHERE id = ?", nowIso(), ref.id);
    }
    return c.json({ request: requestOut(ref.id) });
  });

  // The editor merges the branch's drawing into Main and sends the result (see writeMerged).
  app.post("/api/merge-requests/:mid/merge", async (c) => {
    const user = requireUser(c);
    const ref = requestRef(c.req.param("mid"));
    requireRole(ref.target, user.id, CAN_EDIT, "Only the owner or an editor of Main can merge");
    if (ref.state === "merged") fail(409, "This merge request is already merged", "conflict");
    if (ref.state !== "open") fail(409, "This merge request is closed", "conflict");
    if (REQUIRE_APPROVAL && !currentApproval(ref.id, headOfBranch(ref.source), ref.author)) {
      fail(409, "This merge request needs an approval first.", "approval");
    }
    const branch = branchOf(ref.source);
    // the branch head the editor merged in: writeMerged has already checked it is the head
    const fromVersion = (c.req.header("x-from-version") ?? "").trim();
    const { row } = await writeMerged(c, {
      userId: user.id,
      intoFileId: ref.target,
      fromFileId: ref.source,
      branchId: ref.source,
      label: `Merged ${branch.name}`,
      inTx: (versionId) => {
        // checked again inside the transaction: a merge that raced this one is refused, and the whole write with it
        const state = get<{ state: string }>("SELECT state FROM merge_requests WHERE id = ?", ref.id)?.state;
        if (state === "merged") fail(409, "This merge request is already merged", "conflict");
        if (state !== "open") fail(409, "This merge request is closed", "conflict");
        const now = nowIso();
        run(
          "UPDATE merge_requests SET state = 'merged', merged_by = ?, merged_at = ?, merged_version_id = ?, source_version_id = ?, updated_at = ? WHERE id = ?",
          user.id,
          now,
          versionId,
          fromVersion,
          now,
          ref.id,
        );
      },
    });
    return c.json({ request: requestOut(ref.id), version: toVersion(row) });
  });
}
