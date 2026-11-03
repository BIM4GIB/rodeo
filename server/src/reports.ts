// Error reports: the editor sends one on its own when something breaks (an error nothing caught,
// a failure the user was told of) or crawls (a cloud save that took minutes), and the server
// files its own 500s the same way. Reports of the same error (kind, area and message, with the
// numbers and quoted names taken out) share a group that counts them; the latest few of each are
// kept in full for 30 days. Each report is also one line in the server log. With SMTP set up, a
// new error is emailed to ADMIN_EMAILS (again after a day if it keeps coming).
//
// Admins read them in the editor (Help > Error Reports…); scripts read and clear them with
// REPORTS_TOKEN as a bearer token (server/scripts/reports.ts).

import type { Context, Hono } from "hono";
import type {
  ErrorReport,
  ErrorReportGroup,
  ErrorReportKind,
  NewErrorReport,
  ReportValue,
} from "../../web/src/platform/protocol.ts";
import { allowed, clientIp, currentUser, isAdmin, requireUser } from "./auth.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { onServerError, readJson } from "./http.ts";
import { sendMail } from "./mail.ts";
import { cleanBody, cleanLine, DAY, fail, HOUR, inMs, newId, nowIso, safeEqual, sha256Hex } from "./util.ts";

const KINDS: readonly ErrorReportKind[] = ["crash", "failure", "slow", "server"];
/** full reports kept for each group; the group's count goes on past them */
const KEEP_PER_GROUP = 20;
/** groups listed at most */
const LISTED = 200;
/** reports one address (and one account) may send in an hour */
const PER_HOUR = 60;
const MAX_ENTRIES = 40;
const MAX_TRAIL = 80;

interface GroupRow {
  fingerprint: string;
  kind: string;
  area: string;
  message: string;
  count: number;
  first_seen: string;
  last_seen: string;
  notified_at: string | null;
}

interface ReportRow {
  id: string;
  report_json: string;
  created_at: string;
  user_name: string | null;
}

const REPORT_SQL = `SELECT r.id, r.report_json, r.created_at, u.name AS user_name
  FROM error_reports r LEFT JOIN users u ON u.id = r.user_id`;

/** At most MAX_ENTRIES short keys, each with a short one-line value; anything else is dropped. */
function cleanRecord(v: unknown): Record<string, ReportValue> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const out: Record<string, ReportValue> = {};
  for (const [key, value] of Object.entries(v).slice(0, MAX_ENTRIES)) {
    const k = cleanLine(key, 40);
    if (!k) continue;
    if (value === null || typeof value === "boolean") out[k] = value;
    else if (typeof value === "number") out[k] = Number.isFinite(value) ? value : null;
    else if (typeof value === "string") out[k] = cleanLine(value, 500);
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseReport(body: Record<string, unknown>): NewErrorReport {
  if (!KINDS.includes(body.kind as ErrorReportKind)) fail(400, "kind must be crash, failure, slow or server");
  const area = cleanLine(body.area, 60) || "unknown";
  const message = cleanLine(body.message, 1000);
  if (!message) fail(400, "A report needs a message");
  const stack = cleanBody(body.stack, 8000) || undefined;
  const trail = Array.isArray(body.trail)
    ? body.trail
        .slice(-MAX_TRAIL)
        .map((line) => cleanLine(line, 400))
        .filter(Boolean)
    : [];
  return {
    kind: body.kind as ErrorReportKind,
    area,
    message,
    ...(stack ? { stack } : {}),
    ...(cleanRecord(body.details) ? { details: cleanRecord(body.details) } : {}),
    ...(cleanRecord(body.env) ? { env: cleanRecord(body.env) } : {}),
    ...(trail.length ? { trail } : {}),
  };
}

/**
 * What makes two reports the same error: kind, area and message, with numbers, ids and quoted
 * names taken out ("A 3840 × 2160 px picture…" and "A 7680 × 4320 px picture…" are one error).
 */
export function fingerprintOf(r: Pick<NewErrorReport, "kind" | "area" | "message">): string {
  const message = r.message
    .replace(/[“"'‘][^”"'’]{0,200}[”"'’]/g, "…")
    .replace(/\b[0-9a-f]{12,}\b/gi, "#")
    .replace(/\d+(?:[.,]\d+)*/g, "#")
    .toLowerCase();
  return sha256Hex(`${r.kind}\n${r.area}\n${message}`).slice(0, 16);
}

/** Keeps a report: its group counts it, and older full reports past KEEP_PER_GROUP go. */
export function fileReport(report: NewErrorReport, userId: string | null, userName: string | null): void {
  const fingerprint = fingerprintOf(report);
  const now = nowIso();
  const group = tx(() => {
    const was = get<GroupRow>("SELECT * FROM error_groups WHERE fingerprint = ?", fingerprint);
    if (was) {
      run("UPDATE error_groups SET count = count + 1, last_seen = ? WHERE fingerprint = ?", now, fingerprint);
    } else {
      run(
        "INSERT INTO error_groups (fingerprint, kind, area, message, count, first_seen, last_seen) VALUES (?, ?, ?, ?, 1, ?, ?)",
        fingerprint,
        report.kind,
        report.area,
        report.message,
        now,
        now,
      );
    }
    run(
      "INSERT INTO error_reports (id, fingerprint, user_id, report_json, created_at) VALUES (?, ?, ?, ?, ?)",
      newId(),
      fingerprint,
      userId,
      JSON.stringify(report),
      now,
    );
    run(
      `DELETE FROM error_reports WHERE fingerprint = ? AND id NOT IN
        (SELECT id FROM error_reports WHERE fingerprint = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
      fingerprint,
      fingerprint,
      KEEP_PER_GROUP,
    );
    return was ?? null;
  });
  logReport(report, fingerprint, userName);
  const due = !group || !group.notified_at || group.notified_at < inMs(-DAY);
  if (due) notifyAdmins(report, fingerprint, group ? group.count + 1 : 1, userName);
}

/** One line in the server log (Coolify keeps it), so a report shows there as it comes in. */
function logReport(r: NewErrorReport, fingerprint: string, userName: string | null): void {
  const where = [r.env?.build, r.env?.browser, r.env?.platform].filter((v) => v !== undefined && v !== null).join(", ");
  const details = r.details ? ` ${JSON.stringify(r.details)}` : "";
  console.error(`[report ${fingerprint}] ${r.kind} in ${r.area}: ${r.message}${details} (${userName ?? "signed out"}${where ? `; ${where}` : ""})`);
}

/** Emails an error the admins haven't heard of today; at most a few emails an hour in all. */
function notifyAdmins(r: NewErrorReport, fingerprint: string, count: number, userName: string | null): void {
  if (!config.smtpUrl || config.admins.size === 0) return;
  if (!allowed("report-mail", 6, HOUR)) return;
  run("UPDATE error_groups SET notified_at = ? WHERE fingerprint = ?", nowIso(), fingerprint);
  const message = r.message.length > 70 ? `${r.message.slice(0, 67)}…` : r.message;
  const subject = `Rodeo ${r.kind === "slow" ? "slow" : "error"} in ${r.area}: ${message}`;
  const lines = (title: string, rec: Readonly<Record<string, ReportValue>> | undefined): string[] =>
    rec ? ["", title, ...Object.entries(rec).map(([k, v]) => `  ${k}: ${String(v)}`)] : [];
  const text = [
    `${r.kind} in ${r.area}${count > 1 ? ` (${count} times so far)` : ""}`,
    "",
    r.message,
    ...lines("Details", r.details),
    ...lines("Where", r.env),
    ...(r.trail?.length ? ["", "Just before", ...r.trail.slice(-25).map((t) => `  ${t}`)] : []),
    ...(r.stack ? ["", r.stack.slice(0, 3000)] : []),
    "",
    `From: ${userName ?? "someone not signed in"} · group ${fingerprint}`,
    `Every report is in the editor under Help > Error Reports… (${config.publicUrl}).`,
  ].join("\n");
  for (const to of config.admins) {
    sendMail(to, subject, text).catch((err: unknown) => console.error(`[reports] could not email ${to}:`, err));
  }
}

function reportOut(r: ReportRow): ErrorReport {
  return { ...(JSON.parse(r.report_json) as NewErrorReport), id: r.id, userName: r.user_name, createdAt: r.created_at };
}

function groupOut(g: GroupRow, latest: ReportRow): ErrorReportGroup {
  return {
    fingerprint: g.fingerprint,
    kind: KINDS.includes(g.kind as ErrorReportKind) ? (g.kind as ErrorReportKind) : "failure",
    area: g.area,
    message: g.message,
    count: g.count,
    firstSeen: g.first_seen,
    lastSeen: g.last_seen,
    latest: reportOut(latest),
  };
}

/** An admin signed in, or a script with REPORTS_TOKEN. */
function requireReader(c: Context): void {
  const auth = c.req.header("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token && config.reportsToken && safeEqual(token, config.reportsToken)) return;
  if (!isAdmin(requireUser(c))) fail(403, "Only admins can read error reports", "forbidden");
}

/** Drops reports and groups not seen for 30 days (housekeeping). */
export function pruneReports(): void {
  const cutoff = inMs(-30 * DAY);
  run("DELETE FROM error_reports WHERE created_at <= ?", cutoff);
  run("DELETE FROM error_groups WHERE last_seen <= ?", cutoff);
}

export function registerReports(app: Hono): void {
  onServerError((err, c) => {
    const user = currentUser(c);
    try {
      fileReport(
        {
          kind: "server",
          area: `${c.req.method} ${c.req.routePath || c.req.path}`,
          message: cleanLine(err.message, 1000) || err.name,
          ...(err.stack ? { stack: err.stack.slice(0, 8000) } : {}),
          details: { path: c.req.path },
        },
        user?.id ?? null,
        user?.name ?? null,
      );
    } catch (e) {
      console.error("[reports] could not file a server error:", e);
    }
  });

  app.post("/api/reports", async (c) => {
    const body = await readJson(c, 64 * 1024);
    const user = currentUser(c);
    if (!allowed(`report:${clientIp(c)}`, PER_HOUR, HOUR) || (user && !allowed(`report-user:${user.id}`, PER_HOUR, HOUR))) {
      fail(429, "Too many error reports in an hour", "rate_limited");
    }
    const report = parseReport(body);
    if (report.kind === "server") fail(400, "Only the server files server errors");
    fileReport(report, user?.id ?? null, user?.name ?? null);
    return c.json({ ok: true }, 201);
  });

  // ?group=<fingerprint> gives every kept report of one group, newest first
  app.get("/api/admin/reports", (c) => {
    requireReader(c);
    const one = c.req.query("group");
    if (one) {
      const rows = all<ReportRow>(`${REPORT_SQL} WHERE r.fingerprint = ? ORDER BY r.created_at DESC, r.rowid DESC`, one);
      return c.json({ reports: rows.map(reportOut) });
    }
    const groups = all<GroupRow>("SELECT * FROM error_groups ORDER BY last_seen DESC LIMIT ?", LISTED);
    const out: ErrorReportGroup[] = [];
    for (const g of groups) {
      const latest = get<ReportRow>(`${REPORT_SQL} WHERE r.fingerprint = ? ORDER BY r.created_at DESC, r.rowid DESC LIMIT 1`, g.fingerprint);
      if (latest) out.push(groupOut(g, latest));
    }
    return c.json({ groups: out });
  });

  // clears a group once its error is fixed: a report of it after that starts a new group
  app.delete("/api/admin/reports/:fingerprint", (c) => {
    requireReader(c);
    if (run("DELETE FROM error_groups WHERE fingerprint = ?", c.req.param("fingerprint")) === 0) fail(404, "No such error", "not_found");
    return c.json({ ok: true });
  });
}
