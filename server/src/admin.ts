// The admin page's API (web/src/admin, at /admin): an overview of who uses the editor (visits.ts)
// and what it earns and costs, the accounts with what each has used and bought, and the steps an
// admin takes on one: give or take back AI credit (POST /api/admin/ai-credit, credit.ts), give
// Rodeo Plus for a while, sign it out everywhere, suspend it, or delete it. Admins also set the
// credit each new account starts with. Every route here needs an account in ADMIN_EMAILS.

import type { Context, Hono } from "hono";
import type {
  AdminDay,
  AdminLedgerRow,
  AdminOverview,
  AdminPeriod,
  AdminSettings,
  AdminUser,
  AdminUserDetail,
  AdminUserFilter,
  AdminUserSort,
  Tally,
} from "../../web/src/platform/protocol.ts";
import { deleteAccount } from "./account.ts";
import { isAdmin, onNewUser, planOf, requireUser, type UserRow } from "./auth.ts";
import { config } from "./config.ts";
import { addCredit, MICRO } from "./credit.ts";
import { all, get, run } from "./db.ts";
import { readJson } from "./http.ts";
import { saveSetting, setting } from "./settings.ts";
import { DAY, fail, inMs, MINUTE, nowIso } from "./util.ts";

/** visits from these accounts are the admins' own, and left out of the numbers */
const NOT_ADMIN = "(user_id IS NULL OR user_id NOT IN (SELECT id FROM users WHERE email IN (SELECT value FROM json_each(?))))";
const PAGE = 50;
/** in the editor this lately counts as there now (it pings each minute while in front) */
const ONLINE = 3 * MINUTE;

function requireAdmin(c: Context): UserRow {
  const user = requireUser(c);
  if (!isAdmin(user)) fail(403, "Only admins can see this", "forbidden");
  return user;
}

function admins(): string {
  return JSON.stringify([...config.admins]);
}

/** "2026-11-03": the UTC day `n` days before today's (0: today). */
function dayBefore(n: number): string {
  return new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
}

function welcomeCredit(): number {
  return setting<AdminSettings>("admin")?.welcomeCredit ?? 0;
}

// ---- the overview ----

function period(from: string, to: string): AdminPeriod {
  const v = get<{ visits: number; guests: number | null; members: number; opens: number | null }>(
    `SELECT COUNT(*) AS visits, SUM(user_id IS NULL) AS guests, COUNT(DISTINCT user_id) AS members, SUM(opens) AS opens
     FROM visits WHERE day >= ? AND day < ? AND ${NOT_ADMIN}`,
    from,
    to,
    admins(),
  );
  const signups = get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND created_at < ?", from, to)?.n ?? 0;
  const converted =
    get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM visits v JOIN users u ON u.id = v.user_id
       WHERE v.day >= ? AND v.day < ? AND substr(u.created_at, 1, 10) = v.day AND ${NOT_ADMIN.replaceAll("user_id", "v.user_id")}`,
      from,
      to,
      admins(),
    )?.n ?? 0;
  const visits = v?.visits ?? 0;
  // the middle visit's length: first word to last of the day
  const middle = visits
    ? get<{ m: number }>(
        `SELECT (julianday(last_at) - julianday(first_at)) * 1440 AS m FROM visits WHERE day >= ? AND day < ? AND ${NOT_ADMIN}
         ORDER BY m LIMIT 1 OFFSET ?`,
        from,
        to,
        admins(),
        Math.floor(visits / 2),
      )?.m ?? 0
    : 0;
  return {
    visits,
    guestVisits: v?.guests ?? 0,
    activeMembers: v?.members ?? 0,
    signups,
    converted,
    opens: v?.opens ?? 0,
    medianMinutes: Math.round(middle * 10) / 10,
  };
}

function tally(column: string, from: string, to: string): Tally[] {
  return all<Tally>(
    `SELECT ${column} AS label, COUNT(*) AS count FROM visits WHERE day >= ? AND day < ? AND ${column} IS NOT NULL AND ${NOT_ADMIN}
     GROUP BY label ORDER BY count DESC, label LIMIT 12`,
    from,
    to,
    admins(),
  );
}

function overview(days: number): AdminOverview {
  const today = dayBefore(0);
  const end = nextDay(today);
  const from = dayBefore(days - 1);
  const before = dayBefore(2 * days - 1);
  const credit = config.credit;

  const online = get<{ guests: number | null; members: number }>(
    `SELECT SUM(user_id IS NULL) AS guests, COUNT(DISTINCT user_id) AS members FROM visits WHERE last_at >= ? AND ${NOT_ADMIN}`,
    inMs(-ONLINE),
    admins(),
  );
  const accounts = get<{ total: number; plus: number | null; paid: number | null; suspended: number | null }>(
    `SELECT COUNT(*) AS total, SUM(supporter_until > ?) AS plus, SUM(supporter_until > ? AND stripe_subscription_id IS NOT NULL) AS paid,
       SUM(suspended_at IS NOT NULL) AS suspended FROM users`,
    nowIso(),
    nowIso(),
  );

  let money: AdminOverview["money"] = null;
  if (credit) {
    const rows = all<{ kind: string; render: number; amount: number; usd: number | null }>(
      `SELECT kind, coalesce(model, '') LIKE 'render %' AS render, SUM(amount) AS amount, SUM(cost_usd) AS usd FROM ai_ledger
       WHERE created_at >= ? AND created_at < ? GROUP BY kind, render`,
      from,
      end,
    );
    const sum = (kind: string, render?: number): number =>
      rows.filter((r) => r.kind === kind && (render === undefined || r.render === render)).reduce((s, r) => s + r.amount, 0) / MICRO;
    money = {
      owed: (get<{ owed: number }>("SELECT COALESCE(SUM(ai_credit), 0) AS owed FROM users")?.owed ?? 0) / MICRO,
      topups: sum("topup"),
      granted: sum("grant"),
      agents: -sum("usage", 0),
      renders: -sum("usage", 1),
      providerUsd: rows.filter((r) => r.kind === "usage").reduce((s, r) => s + (r.usd ?? 0), 0),
    };
  }

  // a row for every day, the quiet ones too
  const series = new Map<string, { -readonly [K in keyof AdminDay]: AdminDay[K] }>();
  for (let d = from; d < end; d = nextDay(d)) series.set(d, { day: d, guests: 0, members: 0, signups: 0, opens: 0, topups: 0, usage: 0 });
  for (const r of all<{ day: string; guests: number; members: number; opens: number }>(
    `SELECT day, SUM(user_id IS NULL) AS guests, COUNT(DISTINCT user_id) AS members, SUM(opens) AS opens FROM visits
     WHERE day >= ? AND ${NOT_ADMIN} GROUP BY day`,
    from,
    admins(),
  )) {
    const s = series.get(r.day);
    if (s) Object.assign(s, { guests: r.guests, members: r.members, opens: r.opens });
  }
  for (const r of all<{ day: string; n: number }>("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM users WHERE created_at >= ? GROUP BY day", from)) {
    const s = series.get(r.day);
    if (s) s.signups = r.n;
  }
  for (const r of all<{ day: string; topups: number; usage: number }>(
    `SELECT substr(created_at, 1, 10) AS day, SUM(CASE WHEN kind = 'topup' THEN amount ELSE 0 END) AS topups,
       -SUM(CASE WHEN kind = 'usage' THEN amount ELSE 0 END) AS usage FROM ai_ledger WHERE created_at >= ? GROUP BY day`,
    from,
  )) {
    const s = series.get(r.day);
    if (s) Object.assign(s, { topups: r.topups / MICRO, usage: r.usage / MICRO });
  }

  return {
    days,
    currency: credit?.currency ?? null,
    now: { guests: online?.guests ?? 0, members: online?.members ?? 0 },
    period: period(from, end),
    previous: period(before, from),
    accounts: {
      total: accounts?.total ?? 0,
      plus: accounts?.plus ?? 0,
      plusPaid: accounts?.paid ?? 0,
      suspended: accounts?.suspended ?? 0,
      files: get<{ n: number }>("SELECT COUNT(*) AS n FROM files")?.n ?? 0,
      bytes: get<{ n: number }>("SELECT COALESCE(SUM(size), 0) AS n FROM versions")?.n ?? 0,
    },
    money,
    series: [...series.values()],
    breakdowns: {
      referrers: tally("referrer", from, end),
      campaigns: tally("campaign", from, end),
      countries: tally("country", from, end),
      devices: tally("device", from, end),
      browsers: tally("browser", from, end),
      systems: tally("os", from, end),
      entries: tally("entry", from, end),
      formats: all<Tally>(
        `SELECT substr(name, 6) AS label, SUM(count) AS count FROM visit_counts WHERE day >= ? AND name LIKE 'open:%'
         GROUP BY label ORDER BY count DESC LIMIT 12`,
        from,
      ),
      // check:<answer>:<format>, by answer
      checks: all<Tally>(
        `SELECT substr(name, 7, instr(substr(name, 7), ':') - 1) AS label, SUM(count) AS count FROM visit_counts
         WHERE day >= ? AND name LIKE 'check:%:%' GROUP BY label ORDER BY count DESC`,
        from,
      ),
    },
    inbox: {
      feedback: get<{ n: number }>("SELECT COUNT(*) AS n FROM feedback WHERE status = 'new'")?.n ?? 0,
      errors: get<{ n: number }>("SELECT COUNT(*) AS n FROM error_groups WHERE last_seen >= ?", inMs(-DAY))?.n ?? 0,
    },
  };
}

// ---- accounts ----

interface ListedRow extends UserRow {
  files: number;
  bytes: number;
  spent: number;
  bought: number;
  granted: number;
  providers: string | null;
}

const ACCOUNTS = `(SELECT u.*,
    (SELECT COUNT(*) FROM files f WHERE f.owner_id = u.id) AS files,
    (SELECT COALESCE(SUM(v.size), 0) FROM versions v JOIN files f ON f.id = v.file_id WHERE f.owner_id = u.id) AS bytes,
    (SELECT COALESCE(-SUM(amount), 0) FROM ai_ledger l WHERE l.user_id = u.id AND l.kind = 'usage') AS spent,
    (SELECT COALESCE(SUM(amount), 0) FROM ai_ledger l WHERE l.user_id = u.id AND l.kind = 'topup') AS bought,
    (SELECT COALESCE(SUM(amount), 0) FROM ai_ledger l WHERE l.user_id = u.id AND l.kind = 'grant') AS granted,
    (SELECT group_concat(provider) FROM identities i WHERE i.user_id = u.id) AS providers
  FROM users u)`;
const LISTED = `SELECT * FROM ${ACCOUNTS}`;

const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const FILTERS: Record<AdminUserFilter, string> = {
  all: "1",
  plus: `supporter_until > ${NOW_SQL}`,
  credit: "ai_credit > 0",
  spenders: "(spent > 0 OR bought > 0)",
  suspended: "suspended_at IS NOT NULL",
};

const SORTS: Record<AdminUserSort, string> = {
  joined: "created_at DESC",
  seen: "last_seen_at IS NULL, last_seen_at DESC, created_at DESC",
  credit: "ai_credit DESC, created_at DESC",
  spent: "spent DESC, bought DESC, created_at DESC",
  files: "bytes DESC, files DESC, created_at DESC",
  name: "name COLLATE NOCASE, email",
};

const SEARCH = "(? = '' OR email LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')";

function userOutAdmin(r: ListedRow): AdminUser {
  const plan = planOf(r);
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    avatarUrl: r.avatar_url,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    plan,
    supporterUntil: plan === "supporter" ? r.supporter_until : null,
    paidPlus: plan === "supporter" && r.stripe_subscription_id !== null,
    credit: config.credit ? r.ai_credit / MICRO : null,
    spent: r.spent / MICRO,
    bought: r.bought / MICRO,
    granted: r.granted / MICRO,
    files: r.files,
    bytes: r.bytes,
    providers: r.providers ? [...new Set(r.providers.split(","))].sort() : ["email"],
    suspended: r.suspended_at !== null,
    admin: isAdmin(r),
  };
}

function listed(id: string): AdminUser {
  const row = get<ListedRow>(`${LISTED} WHERE id = ?`, id);
  if (!row) fail(404, "No such account", "not_found");
  return userOutAdmin(row);
}

function target(c: Context): UserRow {
  const row = get<UserRow>("SELECT * FROM users WHERE id = ?", c.req.param("id") ?? "");
  if (!row) fail(404, "No such account", "not_found");
  return row;
}

function detail(id: string): AdminUserDetail {
  const user = listed(id);
  const moves = all<{ kind: "topup" | "grant"; amount: number; at: string; note: string | null; ref: string | null }>(
    "SELECT kind, amount, created_at AS at, note, ref FROM ai_ledger WHERE user_id = ? AND kind != 'usage' ORDER BY id DESC LIMIT 40",
    id,
  );
  const used = all<{ amount: number; n: number; at: string; render: number }>(
    `SELECT SUM(amount) AS amount, COUNT(*) AS n, MAX(created_at) AS at, coalesce(model, '') LIKE 'render %' AS render FROM ai_ledger
     WHERE user_id = ? AND kind = 'usage' GROUP BY substr(created_at, 1, 10), render ORDER BY at DESC LIMIT 40`,
    id,
  );
  const ledger: AdminLedgerRow[] = [
    ...moves.map((m) => ({
      kind: m.kind,
      amount: m.amount / MICRO,
      at: m.at,
      note: m.note,
      // a top-up's ref is its Checkout session, which means nothing here
      by: m.kind === "grant" ? m.ref : null,
    })),
    ...used.map((u) => ({
      kind: u.render ? ("renders" as const) : ("usage" as const),
      amount: u.amount / MICRO,
      at: u.at,
      note: u.render ? `${u.n} cloud render${u.n === 1 ? "" : "s"}` : `${u.n} agent step${u.n === 1 ? "" : "s"}`,
      by: null,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 40);
  return {
    user,
    ledger,
    daysActive: get<{ n: number }>("SELECT COUNT(DISTINCT day) AS n FROM visits WHERE user_id = ? AND day >= ?", id, dayBefore(29))?.n ?? 0,
    lastVisit: get<NonNullable<AdminUserDetail["lastVisit"]>>("SELECT device, browser, os, country FROM visits WHERE user_id = ? ORDER BY last_at DESC LIMIT 1", id) ?? null,
    renders: get<{ n: number }>("SELECT COUNT(*) AS n FROM render_jobs WHERE user_id = ?", id)?.n ?? 0,
    feedback: get<{ n: number }>("SELECT COUNT(*) AS n FROM feedback WHERE user_id = ?", id)?.n ?? 0,
  };
}

/** A CSV cell: quoted when it must be, and never read by a spreadsheet as a formula. */
function cell(v: string | number | null): string {
  let s = v === null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Months on from a date (the 31st runs into the next month, as Stripe's do not; near enough). */
function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

export function registerAdmin(app: Hono): void {
  onNewUser((user) => {
    const amount = welcomeCredit();
    if (!config.credit || amount <= 0) return;
    addCredit(user.id, "grant", Math.round(amount * MICRO), { ref: "welcome", note: "Welcome credit" });
  });

  app.get("/api/admin/overview", (c) => {
    requireAdmin(c);
    const days = Number(c.req.query("days") ?? 30);
    return c.json(overview(Number.isInteger(days) && days >= 1 && days <= 365 ? days : 30));
  });

  // ?q= searches email and name; ?filter=, ?sort= and ?offset= pick and page them
  app.get("/api/admin/users", (c) => {
    requireAdmin(c);
    const q = (c.req.query("q") ?? "").trim().slice(0, 100);
    const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    const filter = FILTERS[c.req.query("filter") as AdminUserFilter] ?? FILTERS.all;
    const sort = SORTS[c.req.query("sort") as AdminUserSort] ?? SORTS.joined;
    const offset = Math.max(0, Math.floor(Number(c.req.query("offset") ?? 0)) || 0);
    const where = `WHERE ${SEARCH} AND ${filter}`;
    const rows = all<ListedRow>(`${LISTED} ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`, q, like, like, PAGE, offset);
    const total = get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${ACCOUNTS} ${where}`, q, like, like)?.n ?? 0;
    return c.json({ users: rows.map(userOutAdmin), total, page: PAGE });
  });

  // every account as a spreadsheet
  app.get("/api/admin/users.csv", (c) => {
    requireAdmin(c);
    const rows = all<ListedRow>(`${LISTED} ORDER BY created_at`).map(userOutAdmin);
    const head = ["email", "name", "joined", "last seen", "sign-in", "plan", "plus until", "credit", "spent", "bought", "granted", "drawings", "bytes", "suspended"];
    const lines = [
      head.join(","),
      ...rows.map((u) =>
        [
          u.email,
          u.name,
          u.createdAt,
          u.lastSeenAt,
          u.providers.join(" "),
          u.plan === "supporter" ? (u.paidPlus ? "plus (paid)" : "plus (given)") : "free",
          u.supporterUntil,
          u.credit === null ? null : u.credit.toFixed(2),
          u.spent.toFixed(2),
          u.bought.toFixed(2),
          u.granted.toFixed(2),
          u.files,
          u.bytes,
          u.suspended ? "yes" : "",
        ]
          .map(cell)
          .join(","),
      ),
    ];
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="rodeo-accounts-${dayBefore(0)}.csv"`);
    return c.body(`${lines.join("\r\n")}\r\n`);
  });

  app.get("/api/admin/users/:id", (c) => {
    requireAdmin(c);
    return c.json(detail(target(c).id));
  });

  // Rodeo Plus for `months` more (from now, or from the end of the plan they have), or, with 0,
  // ended now. Not for a plan paid through Stripe, whose webhook would undo it.
  app.post("/api/admin/users/:id/plus", async (c) => {
    requireAdmin(c);
    const user = target(c);
    const months = (await readJson(c)).months;
    if (typeof months !== "number" || !Number.isInteger(months) || months < 0 || months > 36) fail(400, "Give a whole number of months, up to 36");
    if (planOf(user) === "supporter" && user.stripe_subscription_id) {
      fail(409, "They pay for Rodeo Plus through Stripe. Change their plan in Stripe's dashboard.", "conflict");
    }
    if (months === 0) {
      run("UPDATE users SET supporter_until = NULL, plan = 'free' WHERE id = ?", user.id);
    } else {
      const base = planOf(user) === "supporter" && user.supporter_until ? new Date(user.supporter_until) : new Date();
      run("UPDATE users SET supporter_until = ?, plan = 'supporter' WHERE id = ?", addMonths(base, months).toISOString(), user.id);
    }
    return c.json(detail(user.id));
  });

  app.post("/api/admin/users/:id/sign-out", (c) => {
    requireAdmin(c);
    const user = target(c);
    run("DELETE FROM sessions WHERE user_id = ?", user.id);
    return c.json(detail(user.id));
  });

  // a suspended account is signed out, can't sign in again, and is treated as signed out
  // everywhere until it is let back
  app.post("/api/admin/users/:id/suspend", async (c) => {
    const admin = requireAdmin(c);
    const user = target(c);
    const suspended = (await readJson(c)).suspended;
    if (typeof suspended !== "boolean") fail(400, "suspended must be true or false");
    if (suspended && (isAdmin(user) || user.id === admin.id)) fail(400, "An admin can't be suspended");
    run("UPDATE users SET suspended_at = ? WHERE id = ?", suspended ? nowIso() : null, user.id);
    if (suspended) run("DELETE FROM sessions WHERE user_id = ?", user.id);
    return c.json(detail(user.id));
  });

  // for good: the body must name the account's email, as the admin typed it to confirm
  app.delete("/api/admin/users/:id", async (c) => {
    requireAdmin(c);
    const user = target(c);
    if (isAdmin(user)) fail(400, "An admin's account can't be deleted from here");
    const typed = (await readJson(c)).email;
    if (typeof typed !== "string" || typed.trim().toLowerCase() !== user.email) fail(400, "Type the account's email to delete it");
    await deleteAccount(user);
    return c.body(null, 204);
  });

  app.get("/api/admin/settings", (c) => {
    requireAdmin(c);
    const out: AdminSettings = { welcomeCredit: welcomeCredit() };
    return c.json(out);
  });

  app.put("/api/admin/settings", async (c) => {
    requireAdmin(c);
    const body = await readJson(c);
    const amount = body.welcomeCredit;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > 50) fail(400, "Welcome credit must be between 0 and 50");
    const out: AdminSettings = { welcomeCredit: Math.round(amount * 100) / 100 };
    saveSetting("admin", out);
    return c.json(out);
  });
}
