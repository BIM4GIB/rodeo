// Sharing: members and their roles, invites (single use, 14 days), share links and embeds
// (public and view-only; a plan feature), and the public endpoints that serve a share.

import type { Hono } from "hono";
import { CAN_EDIT, type Member, type Role, type Share, type SharedFile } from "../../web/src/platform/protocol.ts";
import { limitsOf, normalizeEmail, requireUser } from "./auth.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { memberList, mustFile, ownerRow, requireRole, serveVersion, VERSION_SQL, type VersionRow } from "./files.ts";
import { readJson } from "./http.ts";
import { familyRoot, syncFamily } from "./lineage.ts";
import { getHub } from "./hub.ts";
import { sendMail } from "./mail.ts";
import { DAY, fail, inMs, newToken, nowIso } from "./util.ts";

const INVITE_DAYS = 14;
const INVITE_ROLES: readonly Role[] = ["editor", "reviewer", "viewer"];
const RANK: Record<Role, number> = { viewer: 1, reviewer: 2, editor: 3, owner: 4 };
const INVITE_GONE = "This invite has expired or was already used";

interface InviteRow {
  token: string;
  file_id: string;
  role: string;
  expires_at: string;
  accepted_by: string | null;
  file_name: string;
  inviter_name: string | null;
}

interface ShareRow {
  token: string;
  file_id: string;
  allow_download: number;
  created_at: string;
}

function inviteRow(token: string): InviteRow | undefined {
  return get<InviteRow>(
    `SELECT i.token, i.file_id, i.role, i.expires_at, i.accepted_by, f.name AS file_name, u.name AS inviter_name
     FROM invites i JOIN files f ON f.id = i.file_id LEFT JOIN users u ON u.id = i.created_by
     WHERE i.token = ?`,
    token,
  );
}

function shareView(r: ShareRow): Share {
  return {
    token: r.token,
    fileId: r.file_id,
    allowDownload: r.allow_download === 1,
    url: `${config.publicUrl}/?share=${r.token}`,
    embedUrl: `${config.publicUrl}/?embed=${r.token}`,
    createdAt: r.created_at,
  };
}

function parseRole(v: unknown): Role {
  if (typeof v !== "string" || !INVITE_ROLES.includes(v as Role)) fail(400, `Role must be one of ${INVITE_ROLES.join(", ")}`);
  return v as Role;
}

export function registerSharing(app: Hono): void {
  app.get("/api/files/:id/members", (c) => {
    const user = requireUser(c);
    const fileId = familyRoot(c.req.param("id"));
    requireRole(fileId, user.id);
    return c.json({ members: memberList(fileId) });
  });

  app.patch("/api/files/:id/members/:userId", async (c) => {
    const user = requireUser(c);
    const fileId = familyRoot(c.req.param("id"));
    const target = c.req.param("userId");
    requireRole(fileId, user.id, ["owner"], "Only the owner can change roles");
    const body = await readJson(c);
    const role = parseRole(body.role);
    const current = get<{ role: string }>("SELECT role FROM members WHERE file_id = ? AND user_id = ?", fileId, target);
    if (!current) fail(404, "That person is not a member", "not_found");
    if (current.role === "owner") fail(400, "The owner's role cannot change");
    run("UPDATE members SET role = ? WHERE file_id = ? AND user_id = ?", role, fileId, target);
    // A live session keeps the role it joined with, so it reconnects to pick up the new one.
    getHub().kick(fileId, target);
    // a drawing's branches have its members (lineage.ts)
    syncFamily(fileId);
    const member: Member | undefined = memberList(fileId).find((m) => m.userId === target);
    if (!member) fail(404, "That person is not a member", "not_found");
    return c.json({ member });
  });

  app.delete("/api/files/:id/members/:userId", (c) => {
    const user = requireUser(c);
    const fileId = familyRoot(c.req.param("id"));
    const target = c.req.param("userId");
    requireRole(fileId, user.id, target === user.id ? undefined : ["owner"], "Only the owner can remove people");
    const current = get<{ role: string }>("SELECT role FROM members WHERE file_id = ? AND user_id = ?", fileId, target);
    if (!current) fail(404, "That person is not a member", "not_found");
    if (current.role === "owner") fail(400, "The owner cannot leave. Delete the drawing instead.");
    run("DELETE FROM members WHERE file_id = ? AND user_id = ?", fileId, target);
    getHub().kick(fileId, target);
    // a drawing's branches have its members (lineage.ts)
    syncFamily(fileId);
    return c.body(null, 204);
  });

  app.post("/api/files/:id/invites", async (c) => {
    const user = requireUser(c);
    const fileId = familyRoot(c.req.param("id"));
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can invite people");
    const body = await readJson(c);
    const role = parseRole(body.role);
    let email: string | null = null;
    if (body.email !== undefined && body.email !== null && body.email !== "") {
      email = normalizeEmail(body.email);
      if (!email) fail(400, "Enter a valid email address");
    }
    const file = get<{ name: string }>("SELECT name FROM files WHERE id = ?", fileId);
    if (!file) fail(404, "Drawing not found", "not_found");

    const token = newToken();
    const url = `${config.publicUrl}/?invite=${token}`;
    const expiresAt = inMs(INVITE_DAYS * DAY);
    if (email) {
      await sendMail(
        email,
        `${user.name} invited you to ${file.name} on Rodeo`,
        `${user.name} invited you to the drawing "${file.name}" on Rodeo.\n\nOpen it here. The link works once and expires in ${INVITE_DAYS} days:\n\n${url}\n`,
      );
    }
    run(
      "INSERT INTO invites (token, file_id, role, created_by, email, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      token,
      fileId,
      role,
      user.id,
      email,
      nowIso(),
      expiresAt,
    );
    return c.json({ invite: { token, fileId, role, url, expiresAt } }, 201);
  });

  // Public: what an invite offers, shown before the person signs in.
  app.get("/api/invites/:token", (c) => {
    const inv = inviteRow(c.req.param("token"));
    if (!inv || inv.expires_at <= nowIso() || inv.accepted_by !== null) fail(404, INVITE_GONE, "not_found");
    return c.json({ fileName: inv.file_name, role: inv.role as Role, inviterName: inv.inviter_name ?? "Someone" });
  });

  // An invite is single use: the first person to accept it is recorded as accepted_by.
  app.post("/api/invites/:token/accept", (c) => {
    const user = requireUser(c);
    const token = c.req.param("token");
    const inv = inviteRow(token);
    if (!inv || inv.expires_at <= nowIso()) fail(404, INVITE_GONE, "not_found");
    if (inv.accepted_by !== null && inv.accepted_by !== user.id) fail(404, INVITE_GONE, "not_found");
    tx(() => {
      run("UPDATE invites SET accepted_by = ? WHERE token = ? AND accepted_by IS NULL", user.id, token);
      const existing = get<{ role: string }>("SELECT role FROM members WHERE file_id = ? AND user_id = ?", inv.file_id, user.id);
      if (!existing) {
        run("INSERT INTO members (file_id, user_id, role, added_at) VALUES (?, ?, ?, ?)", inv.file_id, user.id, inv.role, nowIso());
      } else if (RANK[inv.role as Role] > RANK[existing.role as Role]) {
        run("UPDATE members SET role = ? WHERE file_id = ? AND user_id = ?", inv.role, inv.file_id, user.id);
      }
    });
    syncFamily(inv.file_id);
    return c.json({ file: mustFile(inv.file_id, user.id) });
  });

  app.get("/api/files/:id/shares", (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can see the share links");
    const rows = all<ShareRow>(
      // a gallery entry's link (gallery.ts) is the drawing's gallery page, not one of its share links
      "SELECT token, file_id, allow_download, created_at FROM shares WHERE file_id = ? AND revoked_at IS NULL AND token NOT IN (SELECT share_token FROM gallery_entries WHERE share_token IS NOT NULL) ORDER BY created_at DESC",
      fileId,
    );
    return c.json({ shares: rows.map(shareView) });
  });

  app.post("/api/files/:id/shares", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_EDIT, "Only the owner or an editor can share this drawing");
    const owner = ownerRow(fileId);
    if (!owner) fail(404, "Drawing not found", "not_found");
    if (!limitsOf(owner).shareLinks) fail(403, "Share links need Rodeo Plus", "plan");
    const body = await readJson(c);
    const row: ShareRow = {
      token: newToken(),
      file_id: fileId,
      allow_download: body.allowDownload === true ? 1 : 0,
      created_at: nowIso(),
    };
    run(
      "INSERT INTO shares (token, file_id, created_by, allow_download, created_at) VALUES (?, ?, ?, ?, ?)",
      row.token,
      fileId,
      user.id,
      row.allow_download,
      row.created_at,
    );
    return c.json({ share: shareView(row) }, 201);
  });

  app.delete("/api/shares/:token", (c) => {
    const user = requireUser(c);
    const token = c.req.param("token");
    const share = get<{ file_id: string }>("SELECT file_id FROM shares WHERE token = ? AND revoked_at IS NULL", token);
    if (!share) fail(404, "Share link not found", "not_found");
    requireRole(share.file_id, user.id, CAN_EDIT, "Only the owner or an editor can revoke share links");
    if (get<{ x: number }>("SELECT 1 AS x FROM gallery_entries WHERE share_token = ?", token)) {
      fail(400, "This link is the drawing's gallery page. Unpublish it from File › Publish to Gallery… instead.");
    }
    run("UPDATE shares SET revoked_at = ? WHERE token = ?", nowIso(), token);
    return c.body(null, 204);
  });

  // Public: a share link's drawing. Viewing needs the bytes, so allowDownload is for the editor to honour.
  app.get("/api/s/:token", (c) => {
    const r = get<{ file_name: string; owner_name: string; allow_download: number; updated_at: string }>(
      // a gallery entry's link (gallery.ts) is named and credited as it was published
      `SELECT COALESCE(g.title, f.name) AS file_name, COALESCE(g.credit_name, o.name) AS owner_name, s.allow_download,
         COALESCE(g.updated_at, f.updated_at) AS updated_at
       FROM shares s JOIN files f ON f.id = s.file_id JOIN users o ON o.id = f.owner_id
       LEFT JOIN gallery_entries g ON g.share_token = s.token
       WHERE s.token = ? AND s.revoked_at IS NULL`,
      c.req.param("token"),
    );
    if (!r) fail(404, "Share link not found", "not_found");
    const shared: SharedFile = {
      fileName: r.file_name,
      ownerName: r.owner_name,
      allowDownload: r.allow_download === 1,
      updatedAt: r.updated_at,
    };
    return c.json(shared);
  });

  app.get("/api/s/:token/content", async (c) => {
    // a gallery entry's link (gallery.ts) shows only the version that was published, never the head:
    // with that version gone the link has nothing to show, rather than the owner's later saves
    const row = get<VersionRow>(
      `${VERSION_SQL} JOIN shares s ON s.token = ? AND s.revoked_at IS NULL JOIN files f ON f.id = s.file_id
       LEFT JOIN gallery_entries g ON g.share_token = s.token
       WHERE v.id = CASE WHEN g.id IS NULL THEN f.head_version_id ELSE g.version_id END`,
      c.req.param("token"),
    );
    if (!row) fail(404, "Share link not found", "not_found");
    return serveVersion(c, row);
  });
}
