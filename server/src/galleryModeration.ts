// Keeping the gallery clean: anyone may report an entry; admins hear of it by email, and three
// people signed in reporting the same one take it out until an admin looks. Admins list what is
// reported or hidden, hide with a reason the owner is told, restore, dismiss reports and pick
// entries for the front.

import type { Context, Hono } from "hono";
import { logAdmin } from "./adminLog.ts";
import { allowed, clientIp, currentUser, isAdmin, normalizeEmail, requireUser, type UserRow } from "./auth.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { entryById, entryOf, hideEntry, NOT_THERE, reportsOf, restoreEntry, visibleEntry, type EntryRow } from "./gallery.ts";
import { readJson } from "./http.ts";
import { sendMail } from "./mail.ts";
import {
  entryPath,
  isEntryId,
  isReportReason,
  LIMITS,
  type ModerationItem,
  REPORT_REASONS,
  type ReportReason,
} from "../../web/src/features/gallery/rules.ts";
import { cleanBody, cleanLine, fail, HOUR, newId, nowIso } from "./util.ts";

/** Distinct signed-in people whose reports take a drawing out of the gallery until an admin looks. */
const REPORTS_TO_HIDE = 3;
/** How old an account must be for its report to count towards hiding a drawing: new accounts only take an email. */
const REPORTER_MIN_AGE = 3 * 24 * 60 * 60 * 1000;

/** Only admins may moderate; a signed-in non-admin gets 403, a signed-out visitor 401. */
function requireAdmin(c: Context): UserRow {
  const user = requireUser(c);
  if (!isAdmin(user)) fail(403, "Only admins can do this", "forbidden");
  return user;
}

/** Emails every admin. A mail failure is logged, never failing the request that caused it. */
async function notifyAdmins(subject: string, text: string): Promise<void> {
  for (const to of config.admins) {
    await sendMail(to, subject, text).catch((e: unknown) => console.error("[gallery] could not email the admins:", e));
  }
}

/** Emails the owner of an entry, replying to an admin. A mail failure is logged only. */
async function notifyOwner(row: EntryRow, subject: string, text: string): Promise<void> {
  const owner = get<{ email: string }>("SELECT email FROM users WHERE id = ?", row.owner_id);
  if (!owner) return;
  const replyTo = [...config.admins][0];
  await sendMail(owner.email, subject, text, replyTo).catch((e: unknown) => console.error("[gallery] could not email the owner:", e));
}

/** The entry the path names, unless it is unpublished or missing (both answer NOT_THERE). */
function entryParam(c: Context): EntryRow {
  // an empty id is not an entry id, so it answers as missing like any other
  const id = c.req.param("id") ?? "";
  const row = isEntryId(id) ? entryById(id) : undefined;
  if (!row || row.unpublished_at !== null) fail(404, NOT_THERE, "not_found");
  return row;
}

/** Closes every open report on an entry. Call inside tx() when other changes go with it. */
function resolveReports(entryId: string): void {
  run("UPDATE gallery_reports SET resolved_at = ? WHERE entry_id = ? AND resolved_at IS NULL", nowIso(), entryId);
}

/** After a new report: the admins hear of the first one, and the drawing comes out once enough people have reported it. */
async function afterReport(row: EntryRow, reason: ReportReason, note: string): Promise<void> {
  const open = get<{ n: number; people: number }>(
    `SELECT COUNT(*) AS n, COUNT(DISTINCT CASE WHEN u.created_at <= ? THEN r.reporter_id END) AS people
     FROM gallery_reports r LEFT JOIN users u ON u.id = r.reporter_id
     WHERE r.entry_id = ? AND r.resolved_at IS NULL`,
    new Date(Date.now() - REPORTER_MIN_AGE).toISOString(),
    row.id,
  );
  const label = REPORT_REASONS.find((r) => r.id === reason)?.label ?? reason;
  // only the first open report is emailed: a flood of them would bury the admins, and the list shows the rest
  if (open?.n === 1) {
    await notifyAdmins(
      `Gallery report: ${row.title}`,
      `${label}\n\n${note || "No note was given."}\n\nThe drawing: ${config.publicUrl}${entryPath(row.id, row.title)}\nAll reports: ${config.publicUrl}/gallery?view=reported\n`,
    );
  }
  // anonymous reports and new accounts' do not count towards hiding: only established people, each
  // once. It only takes the drawing out of the gallery: its link and embeds keep working until an
  // admin looks, so a few reports can't break them for good
  if ((open?.people ?? 0) >= REPORTS_TO_HIDE) {
    hideEntry(row.id, "Reported by several people. Waiting for review.", true);
    await notifyOwner(
      row,
      `Your drawing “${row.title}” is out of the Rodeo Gallery for now`,
      `Your drawing “${row.title}” was taken out of the Rodeo Gallery while we look at reports about it. It is still in your drawings. If you think this is a mistake, reply to this email.\n`,
    );
    await notifyAdmins(
      `Gallery drawing hidden after reports: ${row.title}`,
      `${REPORTS_TO_HIDE} people reported it, so it is out of the gallery until someone looks.\n\nReview it: ${config.publicUrl}/gallery?view=reported\n`,
    );
  }
}

/** The gallery's reports and moderation routes: reporting for anyone, and the admins' list and actions. */
export function registerGalleryModeration(app: Hono): void {
  app.post("/api/gallery/entries/:id/report", async (c) => {
    if (!allowed(`gallery-report:${clientIp(c)}`, 5, HOUR)) fail(429, "Too many reports from here. Try again later.", "rate_limited");
    const id = c.req.param("id");
    const row = isEntryId(id) ? visibleEntry(id) : undefined;
    if (!row) fail(404, NOT_THERE, "not_found");

    const body = await readJson(c);
    const reason = body.reason;
    if (!isReportReason(reason)) fail(400, "Choose a reason");
    const note = cleanBody(body.note, LIMITS.reportNote);
    const given = cleanLine(body.email, 254);
    const email = given ? normalizeEmail(given) : null;
    if (given && !email) fail(400, "Enter a valid email address, or leave it empty");

    const reporter = currentUser(c);
    if (reporter?.id === row.owner_id) fail(400, "You can't report your own drawing. Unpublish it instead.");

    // one report per signed-in person while theirs is open (the index); a repeat is quietly ignored
    const added = run(
      "INSERT OR IGNORE INTO gallery_reports (id, entry_id, reporter_id, email, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      newId(),
      row.id,
      reporter?.id ?? null,
      email,
      reason,
      note,
      nowIso(),
    );
    if (added > 0) await afterReport(row, reason, note);
    return c.json({ ok: true }, 201);
  });

  app.get("/api/gallery/admin/reports", (c) => {
    requireAdmin(c);
    // the drawings with open reports or hidden, the newest report (or hide) first; not the unpublished ones
    const rows = all<EntryRow>(
      `SELECT e.* FROM gallery_entries e
       WHERE e.unpublished_at IS NULL AND (e.hidden_at IS NOT NULL OR EXISTS (SELECT 1 FROM gallery_reports r WHERE r.entry_id = e.id AND r.resolved_at IS NULL))
       ORDER BY COALESCE((SELECT MAX(r.created_at) FROM gallery_reports r WHERE r.entry_id = e.id AND r.resolved_at IS NULL), e.hidden_at) DESC
       LIMIT 100`,
    );
    const items: ModerationItem[] = rows.map((row) => ({
      entry: entryOf(row, true),
      ownerEmail: get<{ email: string }>("SELECT email FROM users WHERE id = ?", row.owner_id)?.email ?? "",
      reports: reportsOf(row.id),
    }));
    return c.json({ items });
  });

  app.post("/api/gallery/admin/entries/:id/hide", async (c) => {
    const admin = requireAdmin(c);
    const body = await readJson(c);
    const reason = cleanLine(body.reason, LIMITS.hideReason);
    if (!reason) fail(400, "Give a reason. The owner is told it.");
    const row = entryParam(c);
    tx(() => {
      hideEntry(row.id, reason);
      resolveReports(row.id);
      logAdmin(admin, "gallery.hide", row.title, reason);
    });
    await notifyOwner(
      row,
      `Rodeo took your drawing “${row.title}” out of the gallery`,
      `Rodeo took your drawing “${row.title}” out of the gallery.\n\nReason: ${reason}\n\nIt is still in your drawings. If you think this is a mistake, reply to this email.\n`,
    );
    return c.body(null, 204);
  });

  app.post("/api/gallery/admin/entries/:id/restore", async (c) => {
    const admin = requireAdmin(c);
    const row = entryParam(c);
    tx(() => {
      restoreEntry(row.id);
      resolveReports(row.id);
      logAdmin(admin, "gallery.restore", row.title);
    });
    // the owner hears only when the drawing was hidden: restoring a visible one changes nothing for them
    if (row.hidden_at !== null) {
      await notifyOwner(
        row,
        `Your drawing “${row.title}” is back in the Rodeo Gallery`,
        `Your drawing “${row.title}” is listed again in the Rodeo Gallery: ${config.publicUrl}${entryPath(row.id, row.title)}\n`,
      );
    }
    return c.body(null, 204);
  });

  app.post("/api/gallery/admin/entries/:id/dismiss", (c) => {
    const admin = requireAdmin(c);
    const row = entryParam(c);
    tx(() => {
      resolveReports(row.id);
      logAdmin(admin, "gallery.dismiss", row.title);
    });
    return c.body(null, 204);
  });

  app.post("/api/gallery/admin/entries/:id/feature", async (c) => {
    const admin = requireAdmin(c);
    const body = await readJson(c);
    const featured = body.featured;
    if (typeof featured !== "boolean") fail(400, "featured must be true or false");
    const row = entryParam(c);
    // COALESCE keeps the day it was first picked, so picking it again does not move it up the trending order
    tx(() => {
      if (featured) run("UPDATE gallery_entries SET featured_at = COALESCE(featured_at, ?) WHERE id = ?", nowIso(), row.id);
      else run("UPDATE gallery_entries SET featured_at = NULL WHERE id = ?", row.id);
      logAdmin(admin, featured ? "gallery.feature" : "gallery.unfeature", row.title);
    });
    return c.body(null, 204);
  });
}
