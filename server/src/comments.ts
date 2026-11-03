// Crit mode: comments on a drawing (a pin, redlines, text, a voice note; replies have a
// parent) and their voice-note audio. New and deleted comments are pushed to live sessions.

import type { Hono } from "hono";
import { type Anchor, CAN_COMMENT, type Comment, type Stroke } from "../../web/src/platform/protocol.ts";
import { requireUser } from "./auth.ts";
import { blobPath, blobSize, commitBlob, receiveBody, releaseBlobs } from "./blobs.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { requireRole } from "./files.ts";
import { readJson } from "./http.ts";
import { getHub } from "./hub.ts";
import { cleanBody, cleanLine, fail, fileStream, MB, newId, nowIso } from "./util.ts";

const MAX_VOICE_MS = 3_600_000;

interface CommentRow {
  id: string;
  file_id: string;
  parent_id: string | null;
  author_id: string | null;
  created_at: string;
  updated_at: string;
  body: string;
  anchor_json: string | null;
  strokes_json: string | null;
  audio_id: string | null;
  audio_ms: number | null;
  resolved: number;
  author_name: string | null;
}

const COMMENT_SQL = `SELECT c.id, c.file_id, c.parent_id, c.author_id, c.created_at, c.updated_at, c.body,
    c.anchor_json, c.strokes_json, c.audio_id, c.audio_ms, c.resolved, u.name AS author_name
  FROM comments c LEFT JOIN users u ON u.id = c.author_id`;

function commentOut(r: CommentRow): Comment {
  return {
    id: r.id,
    fileId: r.file_id,
    parentId: r.parent_id,
    authorId: r.author_id ?? "",
    authorName: r.author_name ?? "Former member",
    createdAt: r.created_at,
    body: r.body,
    anchor: r.anchor_json ? (JSON.parse(r.anchor_json) as Anchor) : null,
    strokes: r.strokes_json ? (JSON.parse(r.strokes_json) as Stroke[]) : [],
    audio: r.audio_id ? { id: r.audio_id, durationMs: r.audio_ms ?? 0 } : null,
    resolved: r.resolved === 1,
  };
}

function loadComment(id: string): CommentRow {
  const row = get<CommentRow>(`${COMMENT_SQL} WHERE c.id = ?`, id);
  if (!row) fail(500, "The comment could not be read back");
  return row;
}

// ---- validation of what the editor sends ----

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseAnchor(v: unknown): Anchor | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) fail(400, "The pin is not valid");
  if (v.kind === "2d") {
    const layerId = cleanLine(v.layerId, 200);
    const x = finite(v.x);
    const y = finite(v.y);
    if (!layerId || x === null || y === null) fail(400, "The pin is not valid");
    return { kind: "2d", layerId, x, y };
  }
  if (v.kind === "3d") {
    const x = finite(v.x);
    const y = finite(v.y);
    const z = finite(v.z);
    if (x === null || y === null || z === null) fail(400, "The pin is not valid");
    return { kind: "3d", x, y, z };
  }
  return fail(400, "The pin is not valid");
}

function parseStrokes(v: unknown): Stroke[] {
  if (v === null || v === undefined) return [];
  if (!Array.isArray(v) || v.length > 500) fail(400, "The redlines are not valid");
  return v.map((s: unknown): Stroke => {
    if (!isObj(s)) fail(400, "The redlines are not valid");
    const rawPoints: unknown = s.points;
    if (!Array.isArray(rawPoints) || rawPoints.length > 20_000) fail(400, "The redlines are not valid");
    const points: [number, number][] = rawPoints.map((p: unknown) => {
      if (!Array.isArray(p)) fail(400, "The redlines are not valid");
      const x = finite(p[0]);
      const y = finite(p[1]);
      if (x === null || y === null) fail(400, "The redlines are not valid");
      return [x, y];
    });
    const layerId = cleanLine(s.layerId, 200);
    const color = cleanLine(s.color, 32);
    const width = finite(s.width);
    if (!layerId || !color || width === null || width < 0 || width > 100) fail(400, "The redlines are not valid");
    return { layerId, points, color, width };
  });
}

function parseAudioRef(v: unknown): { id: string; durationMs: number } | null {
  if (v === null || v === undefined) return null;
  if (!isObj(v)) fail(400, "The voice note is not valid");
  const id = cleanLine(v.id, 64);
  const ms = finite(v.durationMs);
  if (!id || ms === null || ms < 0 || ms > MAX_VOICE_MS) fail(400, "The voice note is not valid");
  return { id, durationMs: Math.round(ms) };
}

function audioMime(header: string | undefined): string {
  const base = (header ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "" || base === "application/octet-stream") return "audio/webm";
  if (!/^audio\/[a-z0-9.+-]{1,60}$/.test(base)) fail(415, "A voice note must be audio", "invalid");
  return base;
}

export function registerComments(app: Hono): void {
  app.get("/api/files/:id/comments", (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id);
    const rows = all<CommentRow>(`${COMMENT_SQL} WHERE c.file_id = ? ORDER BY c.created_at, c.rowid`, fileId);
    return c.json({ comments: rows.map(commentOut) });
  });

  app.post("/api/files/:id/comments", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_COMMENT, "Reviewers, editors and the owner can comment");
    const body = await readJson(c);

    let parentId: string | null = null;
    if (body.parentId !== undefined && body.parentId !== null) {
      if (typeof body.parentId !== "string") fail(400, "The comment being replied to was not found");
      const parent = get<{ file_id: string }>("SELECT file_id FROM comments WHERE id = ?", body.parentId);
      if (!parent || parent.file_id !== fileId) fail(400, "The comment being replied to was not found");
      parentId = body.parentId;
    }
    const text = cleanBody(body.body, 4000);
    const anchor = parseAnchor(body.anchor);
    const strokes = parseStrokes(body.strokes);
    const audio = parseAudioRef(body.audio);
    if (!text && strokes.length === 0 && !audio) fail(400, "A comment needs text, a redline or a voice note");
    if (audio) {
      const note = get<{ id: string }>("SELECT id FROM audio WHERE id = ? AND file_id = ? AND author_id = ?", audio.id, fileId, user.id);
      if (!note) fail(400, "The voice note was not found");
      if (get<{ id: string }>("SELECT id FROM comments WHERE audio_id = ?", audio.id)) {
        fail(409, "That voice note is already attached to a comment", "conflict");
      }
    }

    const id = newId();
    const now = nowIso();
    try {
      tx(() => {
        run(
          `INSERT INTO comments (id, file_id, parent_id, author_id, created_at, updated_at, body, anchor_json, strokes_json, audio_id, audio_ms, resolved)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          id,
          fileId,
          parentId,
          user.id,
          now,
          now,
          text,
          anchor ? JSON.stringify(anchor) : null,
          strokes.length > 0 ? JSON.stringify(strokes) : null,
          audio ? audio.id : null,
          audio ? audio.durationMs : null,
        );
      });
    } catch (e) {
      if (e instanceof Error && /UNIQUE/.test(e.message)) fail(409, "That voice note is already attached to a comment", "conflict");
      throw e;
    }
    const comment = commentOut(loadComment(id));
    getHub().broadcastComment(fileId, comment);
    return c.json({ comment }, 201);
  });

  // Editing text is for the author; resolving is for anyone who can comment.
  app.patch("/api/comments/:cid", async (c) => {
    const user = requireUser(c);
    const cid = c.req.param("cid");
    const row = get<CommentRow>(`${COMMENT_SQL} WHERE c.id = ?`, cid);
    if (!row) fail(404, "Comment not found", "not_found");
    const role = requireRole(row.file_id, user.id);
    const body = await readJson(c);
    const hasBody = body.body !== undefined;
    const hasResolved = body.resolved !== undefined;
    if (!hasBody && !hasResolved) fail(400, "Nothing to change");
    if (!CAN_COMMENT.includes(role)) fail(403, "Your role does not allow commenting", "forbidden");

    let text = row.body;
    if (hasBody) {
      if (row.author_id !== user.id) fail(403, "Only the author can edit a comment", "forbidden");
      text = cleanBody(body.body, 4000);
      if (!text && !row.strokes_json && !row.audio_id) fail(400, "A comment needs text, a redline or a voice note");
    }
    let resolved = row.resolved === 1;
    if (hasResolved) {
      if (typeof body.resolved !== "boolean") fail(400, "resolved must be true or false");
      resolved = body.resolved;
    }
    run("UPDATE comments SET body = ?, resolved = ?, updated_at = ? WHERE id = ?", text, resolved ? 1 : 0, nowIso(), cid);
    return c.json({ comment: commentOut(loadComment(cid)) });
  });

  app.delete("/api/comments/:cid", async (c) => {
    const user = requireUser(c);
    const cid = c.req.param("cid");
    const row = get<CommentRow>(`${COMMENT_SQL} WHERE c.id = ?`, cid);
    if (!row) fail(404, "Comment not found", "not_found");
    const role = requireRole(row.file_id, user.id);
    if (row.author_id !== user.id && role !== "owner") fail(403, "Only the author or the owner can delete a comment", "forbidden");

    // The comment and its replies go together; their voice notes go with them.
    const gone = all<{ id: string; audio_id: string | null }>(
      `WITH RECURSIVE tree(id) AS (
         SELECT id FROM comments WHERE id = ?
         UNION ALL
         SELECT c.id FROM comments c JOIN tree t ON c.parent_id = t.id
       )
       SELECT c.id, c.audio_id FROM comments c JOIN tree t ON t.id = c.id`,
      cid,
    );
    const blobs: string[] = [];
    tx(() => {
      run("DELETE FROM comments WHERE id = ?", cid);
      for (const g of gone) {
        if (!g.audio_id) continue;
        const note = get<{ blob: string }>("SELECT blob FROM audio WHERE id = ?", g.audio_id);
        if (note) blobs.push(note.blob);
        run("DELETE FROM audio WHERE id = ?", g.audio_id);
      }
    });
    await releaseBlobs(blobs);
    for (const g of gone) getHub().broadcastCommentDeleted(row.file_id, g.id);
    return c.body(null, 204);
  });

  app.post("/api/files/:id/audio", async (c) => {
    const user = requireUser(c);
    const fileId = c.req.param("id");
    requireRole(fileId, user.id, CAN_COMMENT, "Reviewers, editors and the owner can add voice notes");
    const mime = audioMime(c.req.header("content-type"));
    const received = await receiveBody(c.req.raw, Math.min(5 * MB, config.maxUploadBytes), "The voice note");
    const blob = await commitBlob(received);
    const id = newId();
    try {
      run(
        "INSERT INTO audio (id, file_id, author_id, blob, mime, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        fileId,
        user.id,
        blob,
        mime,
        received.size,
        nowIso(),
      );
    } catch (e) {
      await releaseBlobs([blob]);
      throw e;
    }
    return c.json({ id }, 201);
  });

  app.get("/api/audio/:id", async (c) => {
    const user = requireUser(c);
    const note = get<{ file_id: string; blob: string; mime: string }>("SELECT file_id, blob, mime FROM audio WHERE id = ?", c.req.param("id"));
    if (!note) fail(404, "Voice note not found", "not_found");
    requireRole(note.file_id, user.id);
    const size = await blobSize(note.blob);
    if (size === null) fail(404, "Voice note not found", "not_found");
    c.header("Content-Type", note.mime);
    c.header("Content-Length", String(size));
    c.header("Cache-Control", "private, no-store");
    return c.body(fileStream(blobPath(note.blob)));
  });
}
