// The admin log: every step an admin takes on the admin page or in the gallery (credit given, an
// account suspended, an announcement posted, a drawing hidden...), who took it and when, so the
// admins can see what each other did. The admin page's System tab reads it (GET /api/admin/log).

import type { Context, Hono } from "hono";
import type { AdminLogEntry } from "../../web/src/platform/protocol.ts";
import { isAdmin, requireUser, type UserRow } from "./auth.ts";
import { all, get, run } from "./db.ts";
import { fail, nowIso } from "./util.ts";

const PAGE = 50;

/**
 * Keeps one step: `action` is "area.verb" ("credit.grant", "user.suspend"), `target` what it was
 * done to (an account's email, an announcement's title), `detail` anything else worth a line.
 */
export function logAdmin(admin: UserRow, action: string, target: string | null, detail: string | null = null): void {
  run(
    "INSERT INTO admin_log (admin_id, admin_email, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    admin.id,
    admin.email,
    action,
    target?.slice(0, 200) ?? null,
    detail?.slice(0, 500) ?? null,
    nowIso(),
  );
}

export function registerAdminLog(app: Hono): void {
  app.get("/api/admin/log", (c: Context) => {
    if (!isAdmin(requireUser(c))) fail(403, "Only admins can see this", "forbidden");
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset") ?? 0)) || 0);
    const entries = all<AdminLogEntry>(
      "SELECT id, created_at AS at, admin_email AS admin, action, target, detail FROM admin_log ORDER BY id DESC LIMIT ? OFFSET ?",
      PAGE,
      offset,
    );
    const total = get<{ n: number }>("SELECT COUNT(*) AS n FROM admin_log")?.n ?? 0;
    return c.json({ entries, total });
  });
}
