// The admin page's statistics (web/src/admin, its Live, Geo, Engagement, Revenue and Usage tabs):
// who is in the editor now and where from, where the period's visitors were, how people use the
// editor over time, what the period earned and what the agents and cloud renders cost, and what is
// in the cloud and what people make with it. Visits leave the admins out, as admin.ts does, and
// every route needs an admin.

import type { Context, Hono } from "hono";
import type {
  AdminCountry,
  AdminEngagement,
  AdminGeo,
  AdminLive,
  AdminLiveVisitor,
  AdminPlace,
  AdminRevenue,
  AdminUsage,
  Tally,
  VisitEntry,
} from "../../web/src/platform/protocol.ts";
import { admins, dayBefore, NOT_ADMIN, nextDay, requireAdmin } from "./admin.ts";
import { config } from "./config.ts";
import { MICRO } from "./credit.ts";
import { all, get, type Param } from "./db.ts";
import { getHub } from "./hub.ts";
import { DAY, inMs, MINUTE, nowIso } from "./util.ts";

const NOT_ADMIN_V = NOT_ADMIN.replaceAll("user_id", "v.user_id");
/** in the editor this lately counts as there now (it pings each minute while in front) */
const LIVE = 3 * MINUTE;
const RING = 60;
/** a visit's length in minutes, first word to last */
const MINUTES = "(julianday(last_at) - julianday(first_at)) * 1440";
const COHORT_WEEKS = 12;
const LENGTHS = ["Under 1 min", "1–5 min", "5–15 min", "15–30 min", "30–60 min", "1–2 h", "Over 2 h"];
const OPENS = ["None", "1", "2–3", "4–9", "10 or more"];

interface Period {
  readonly days: number;
  /** the first day, and the day after the last: visit days and sign-up days compare with these */
  readonly from: string;
  readonly end: string;
}

function periodOf(c: Context): Period {
  const n = Number(c.req.query("days") ?? 30);
  const days = Number.isInteger(n) && n >= 1 && n <= 365 ? n : 30;
  return { days, from: dayBefore(days - 1), end: nextDay(dayBefore(0)) };
}

/** The day `n` days from `day` (negative: before it). */
function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** Each day from `from` up to `end`, oldest first. */
function daysFrom(from: string, end: string): string[] {
  const out: string[] = [];
  for (let d = from; d < end; d = nextDay(d)) out.push(d);
  return out;
}

/** The Monday (UTC) of the week `day` falls in. */
function mondayOf(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  return shiftDay(day, -((weekday + 6) % 7));
}

function tenth(v: number | null): number | null {
  return v === null ? null : Math.round(v * 10) / 10;
}

/** The visit in the middle of the sorted minutes, as admin.ts's medianMinutes takes it. */
function middle(sorted: readonly number[]): number {
  return sorted.length ? (tenth(sorted[Math.floor(sorted.length / 2)]) ?? 0) : 0;
}

/** Counts by bucket number, in the labels' order, every label there. */
function buckets(labels: readonly string[], rows: readonly { bucket: number; n: number }[]): Tally[] {
  return labels.map((label, i) => ({ label, count: rows.find((r) => r.bucket === i)?.n ?? 0 }));
}

function countOf(sql: string, ...params: Param[]): number {
  return get<{ n: number | null }>(sql, ...params)?.n ?? 0;
}

// ---- live ----

/** The people heard from each minute since the server started, oldest first. */
const recent: { at: string; guests: number; members: number }[] = [];

function heardLately(): { guests: number; members: number } {
  const row = get<{ guests: number | null; members: number }>(
    `SELECT SUM(user_id IS NULL) AS guests, COUNT(DISTINCT user_id) AS members FROM visits WHERE last_at >= ? AND ${NOT_ADMIN}`,
    inMs(-LIVE),
    admins(),
  );
  return { guests: row?.guests ?? 0, members: row?.members ?? 0 };
}

function sample(): void {
  recent.push({ at: nowIso(), ...heardLately() });
  if (recent.length > RING) recent.shift();
}

function visitorsNow(): AdminLiveVisitor[] {
  const rows = all<{
    key: string;
    entry: VisitEntry;
    referrer: string | null;
    country: string | null;
    city: string | null;
    region: string | null;
    lat: number | null;
    lon: number | null;
    device: string;
    browser: string;
    os: string;
    firstAt: string;
    lastAt: string;
    opens: number;
    memberId: string | null;
    memberName: string | null;
    memberEmail: string | null;
  }>(
    `SELECT substr(v.visitor, 1, 12) AS key, v.entry, v.referrer, v.country, v.city, v.region, v.lat, v.lon, v.device, v.browser, v.os,
       v.first_at AS firstAt, v.last_at AS lastAt, v.opens, u.id AS memberId, u.name AS memberName, u.email AS memberEmail
     FROM visits v LEFT JOIN users u ON u.id = v.user_id
     WHERE v.last_at >= ? AND ${NOT_ADMIN_V}
     ORDER BY v.last_at DESC LIMIT 300`,
    inMs(-LIVE),
    admins(),
  );
  return rows.map(({ memberId, memberName, memberEmail, ...v }) => ({
    ...v,
    member: memberId === null ? null : { id: memberId, name: memberName ?? "", email: memberEmail ?? "" },
  }));
}

function todayNow(): AdminLive["today"] {
  const day = dayBefore(0);
  const row = get<{ visitors: number; members: number; opens: number | null }>(
    `SELECT COUNT(*) AS visitors, COUNT(DISTINCT user_id) AS members, SUM(opens) AS opens FROM visits WHERE day = ? AND ${NOT_ADMIN}`,
    day,
    admins(),
  );
  return {
    visitors: row?.visitors ?? 0,
    members: row?.members ?? 0,
    signups: countOf("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", day),
    opens: row?.opens ?? 0,
  };
}

/** The live sessions of cloud drawings (collab.ts); zeros where there is no hub. */
function sessionsNow(): AdminLive["sessions"] {
  try {
    return getHub().liveStats();
  } catch {
    return { drawings: 0, people: 0, together: 0 };
  }
}

// ---- geo ----

function geo(p: Period): AdminGeo {
  const minutes = new Map<string, number[]>();
  for (const r of all<{ code: string; m: number }>(
    `SELECT country AS code, ${MINUTES} AS m FROM visits WHERE day >= ? AND day < ? AND country IS NOT NULL AND ${NOT_ADMIN}`,
    p.from,
    p.end,
    admins(),
  )) {
    const list = minutes.get(r.code) ?? [];
    list.push(r.m);
    minutes.set(r.code, list);
  }
  for (const list of minutes.values()) list.sort((a, b) => a - b);

  // accounts made in the period, counted under the country of their visit on the day they joined
  const signed = new Map(
    all<{ code: string; n: number }>(
      `SELECT v.country AS code, COUNT(DISTINCT u.id) AS n FROM users u JOIN visits v ON v.user_id = u.id AND v.day = substr(u.created_at, 1, 10)
       WHERE u.created_at >= ? AND u.created_at < ? AND v.country IS NOT NULL AND ${NOT_ADMIN_V}
       GROUP BY v.country`,
      p.from,
      p.end,
      admins(),
    ).map((r): [string, number] => [r.code, r.n]),
  );

  const countries: AdminCountry[] = all<{ code: string; visits: number; members: number; opens: number | null }>(
    `SELECT country AS code, COUNT(*) AS visits, COUNT(DISTINCT user_id) AS members, SUM(opens) AS opens FROM visits
     WHERE day >= ? AND day < ? AND country IS NOT NULL AND ${NOT_ADMIN}
     GROUP BY country ORDER BY visits DESC, code`,
    p.from,
    p.end,
    admins(),
  ).map((r) => ({
    code: r.code,
    visits: r.visits,
    members: r.members,
    signups: signed.get(r.code) ?? 0,
    opens: r.opens ?? 0,
    medianMinutes: middle(minutes.get(r.code) ?? []),
  }));

  const places: AdminPlace[] = all<{
    country: string;
    city: string | null;
    region: string | null;
    lat: number | null;
    lon: number | null;
    visits: number;
    members: number;
  }>(
    `SELECT country, city, MAX(region) AS region, AVG(lat) AS lat, AVG(lon) AS lon, COUNT(*) AS visits, COUNT(DISTINCT user_id) AS members
     FROM visits WHERE day >= ? AND day < ? AND country IS NOT NULL AND ${NOT_ADMIN}
     GROUP BY country, city ORDER BY visits DESC, country, city LIMIT 400`,
    p.from,
    p.end,
    admins(),
  ).map((r) => ({
    country: r.country,
    city: r.city,
    region: r.region,
    lat: tenth(r.lat),
    lon: tenth(r.lon),
    visits: r.visits,
    members: r.members,
  }));

  const total = get<{ total: number; located: number | null }>(
    `SELECT COUNT(*) AS total, SUM(city IS NOT NULL) AS located FROM visits WHERE day >= ? AND day < ? AND ${NOT_ADMIN}`,
    p.from,
    p.end,
    admins(),
  );
  return { days: p.days, countries, places, located: total?.located ?? 0, total: total?.total ?? 0 };
}

// ---- engagement ----

function engagement(p: Period): AdminEngagement {
  // the accounts that visited each day, with when each joined; from 29 days before the period, so the
  // first day's 30-day window is whole
  const visitsOn = new Map<string, Map<string, string>>();
  for (const r of all<{ day: string; id: string; created_at: string }>(
    `SELECT DISTINCT v.day, v.user_id AS id, u.created_at FROM visits v JOIN users u ON u.id = v.user_id
     WHERE v.day >= ? AND v.day < ? AND ${NOT_ADMIN_V}`,
    shiftDay(p.from, -29),
    p.end,
    admins(),
  )) {
    const who = visitsOn.get(r.day) ?? new Map<string, string>();
    who.set(r.id, r.created_at);
    visitsOn.set(r.day, who);
  }
  // the accounts with a visit on any of the `n` days up to and including `day`
  const seenIn = (day: string, n: number): number => {
    const who = new Set<string>();
    for (let k = 0; k < n; k++) for (const id of visitsOn.get(shiftDay(day, -k))?.keys() ?? []) who.add(id);
    return who.size;
  };
  const days = daysFrom(p.from, p.end);
  const active = days.map((day) => ({ day, dau: seenIn(day, 1), wau: seenIn(day, 7), mau: seenIn(day, 30) }));

  const hours = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const r of all<{ wd: number; hr: number; n: number }>(
    `SELECT CAST(strftime('%w', first_at) AS INTEGER) AS wd, CAST(strftime('%H', first_at) AS INTEGER) AS hr, COUNT(*) AS n
     FROM visits WHERE day >= ? AND day < ? AND ${NOT_ADMIN} GROUP BY wd, hr`,
    p.from,
    p.end,
    admins(),
  )) {
    hours[r.wd][r.hr] = r.n;
  }

  const lengths = buckets(
    LENGTHS,
    all<{ bucket: number; n: number }>(
      `SELECT CASE WHEN m < 1 THEN 0 WHEN m < 5 THEN 1 WHEN m < 15 THEN 2 WHEN m < 30 THEN 3 WHEN m < 60 THEN 4 WHEN m < 120 THEN 5 ELSE 6 END AS bucket,
         COUNT(*) AS n
       FROM (SELECT ${MINUTES} AS m FROM visits WHERE day >= ? AND day < ? AND ${NOT_ADMIN}) GROUP BY bucket`,
      p.from,
      p.end,
      admins(),
    ),
  );

  const opened = buckets(
    OPENS,
    all<{ bucket: number; n: number }>(
      `SELECT CASE WHEN opens = 0 THEN 0 WHEN opens = 1 THEN 1 WHEN opens <= 3 THEN 2 WHEN opens <= 9 THEN 3 ELSE 4 END AS bucket, COUNT(*) AS n
       FROM visits WHERE day >= ? AND day < ? AND ${NOT_ADMIN} GROUP BY bucket`,
      p.from,
      p.end,
      admins(),
    ),
  );

  const visits = get<{ visits: number; opened: number | null }>(
    `SELECT COUNT(*) AS visits, SUM(opens > 0) AS opened FROM visits WHERE day >= ? AND day < ? AND ${NOT_ADMIN}`,
    p.from,
    p.end,
    admins(),
  );
  const joined = all<{ id: string; sub: string | null; bought: number }>(
    `SELECT u.id, u.stripe_subscription_id AS sub, EXISTS (SELECT 1 FROM ai_ledger l WHERE l.user_id = u.id AND l.kind = 'topup') AS bought
     FROM users u WHERE u.created_at >= ? AND u.created_at < ? AND u.email NOT IN (SELECT value FROM json_each(?))`,
    p.from,
    p.end,
    admins(),
  );
  const dayCount = new Map<string, number>();
  for (const who of visitsOn.values()) for (const id of who.keys()) dayCount.set(id, (dayCount.get(id) ?? 0) + 1);
  const came = joined.filter((s) => (dayCount.get(s.id) ?? 0) >= 2);
  const paid = came.filter((s) => s.sub !== null || s.bought === 1);
  const funnel = [
    { label: "Visits", count: visits?.visits ?? 0, note: "a visitor counts once a day" },
    { label: "Opened a drawing", count: visits?.opened ?? 0, note: "visits where a drawing was opened" },
    { label: "Signed up", count: joined.length, note: "accounts made in the period" },
    { label: "Came back another day", count: came.length, note: "signed up and visited on two or more days" },
    { label: "Paid", count: paid.length, note: "bought credit or Rodeo Plus" },
  ];

  // the Mondays of the last COHORT_WEEKS weeks, this week last
  const starts = Array.from({ length: COHORT_WEEKS }, (_, i) => shiftDay(mondayOf(dayBefore(0)), 7 * (i - (COHORT_WEEKS - 1))));
  const cohortOf = new Map<string, number>();
  const size = new Array<number>(COHORT_WEEKS).fill(0);
  for (const u of all<{ id: string; created_at: string }>(
    "SELECT id, created_at FROM users WHERE created_at >= ? AND email NOT IN (SELECT value FROM json_each(?))",
    starts[0],
    admins(),
  )) {
    const i = Math.round((Date.parse(mondayOf(u.created_at.slice(0, 10))) - Date.parse(starts[0])) / (7 * DAY));
    cohortOf.set(u.id, i);
    size[i]++;
  }
  // weeks[k]: the cohort's members with a visit k weeks on from its Monday
  const weeks = starts.map((_, i) => new Array<number>(COHORT_WEEKS - i).fill(0));
  const counted = new Set<string>();
  for (const r of all<{ id: string; day: string }>(
    `SELECT DISTINCT v.user_id AS id, v.day FROM visits v WHERE v.day >= ? AND v.user_id IS NOT NULL AND ${NOT_ADMIN_V}`,
    starts[0],
    admins(),
  )) {
    const i = cohortOf.get(r.id);
    if (i === undefined) continue;
    const k = Math.floor((Date.parse(r.day) - Date.parse(starts[i])) / (7 * DAY));
    if (k < 0 || k >= weeks[i].length || counted.has(`${k} ${r.id}`)) continue;
    counted.add(`${k} ${r.id}`);
    weeks[i][k]++;
  }
  const cohorts = starts.map((week, i) => ({ week, size: size[i], weeks: weeks[i] }));

  const members = days.map((day) => {
    const on = visitsOn.get(day) ?? new Map<string, string>();
    const since = shiftDay(day, -6);
    let fresh = 0;
    for (const created of on.values()) if (created >= since) fresh++;
    return { day, fresh, returning: on.size - fresh };
  });

  return { days: p.days, active, hours, lengths, opensPerVisit: opened, funnel, cohorts, members };
}

// ---- revenue ----

function revenue(p: Period): AdminRevenue {
  const credit = config.credit;
  const now = nowIso();
  const plus = get<{ paid: number | null; given: number | null }>(
    `SELECT SUM(supporter_until > ? AND stripe_subscription_id IS NOT NULL) AS paid,
       SUM(supporter_until > ? AND stripe_subscription_id IS NULL) AS given FROM users`,
    now,
    now,
  );

  // top-ups, and the usage taken (agents and renders alike) with what the providers charged for it
  const ledger = credit
    ? all<{ day: string; topups: number | null; charged: number | null; cost: number | null }>(
        `SELECT substr(created_at, 1, 10) AS day, SUM(CASE WHEN kind = 'topup' THEN amount ELSE 0 END) AS topups,
           -SUM(CASE WHEN kind = 'usage' THEN amount ELSE 0 END) AS charged, SUM(CASE WHEN kind = 'usage' THEN cost_usd ELSE 0 END) AS cost
         FROM ai_ledger WHERE created_at >= ? AND created_at < ? GROUP BY day`,
        p.from,
        p.end,
      )
    : [];
  const byDay = new Map(ledger.map((r) => [r.day, r] as const));
  const daily = daysFrom(p.from, p.end).map((day) => {
    const r = byDay.get(day);
    return { day, topups: (r?.topups ?? 0) / MICRO, charged: (r?.charged ?? 0) / MICRO, costUsd: r?.cost ?? 0 };
  });
  const margin = credit
    ? {
        charged: daily.reduce((s, d) => s + d.charged, 0),
        cost: daily.reduce((s, d) => s + d.costUsd, 0) * credit.usdRate,
      }
    : null;

  // the agents only: cloud renders are counted apart
  const models = credit
    ? all<{ model: string; steps: number; users: number; charged: number; cost: number | null; tokensIn: number | null; tokensOut: number | null }>(
        `SELECT coalesce(model, 'unknown') AS model, COUNT(*) AS steps, COUNT(DISTINCT user_id) AS users, -SUM(amount) AS charged,
           SUM(cost_usd) AS cost, SUM(tokens_in) AS tokensIn, SUM(tokens_out) AS tokensOut
         FROM ai_ledger WHERE kind = 'usage' AND coalesce(model, '') NOT LIKE 'render %' AND created_at >= ? AND created_at < ?
         GROUP BY coalesce(model, 'unknown') ORDER BY charged DESC, model`,
        p.from,
        p.end,
      ).map((r) => ({
        model: r.model,
        steps: r.steps,
        users: r.users,
        charged: r.charged / MICRO,
        costUsd: r.cost ?? 0,
        tokensIn: r.tokensIn ?? 0,
        tokensOut: r.tokensOut ?? 0,
      }))
    : [];

  const jobs = get<{ jobs: number; finished: number | null; failed: number | null; seconds: number | null; charged: number | null }>(
    `SELECT COUNT(*) AS jobs, SUM(state = 'done') AS finished, SUM(state = 'failed') AS failed, SUM(seconds) AS seconds, SUM(charged) AS charged
     FROM render_jobs WHERE created_at >= ? AND created_at < ?`,
    p.from,
    p.end,
  );

  const topSpenders = credit
    ? all<{ id: string; name: string; email: string; spent: number; bought: number | null }>(
        `SELECT u.id, u.name, u.email, -SUM(l.amount) AS spent,
           (SELECT SUM(t.amount) FROM ai_ledger t WHERE t.user_id = u.id AND t.kind = 'topup' AND t.created_at >= ? AND t.created_at < ?) AS bought
         FROM ai_ledger l JOIN users u ON u.id = l.user_id
         WHERE l.kind = 'usage' AND l.created_at >= ? AND l.created_at < ?
         GROUP BY u.id ORDER BY spent DESC LIMIT 10`,
        p.from,
        p.end,
        p.from,
        p.end,
      ).map((r) => ({ id: r.id, name: r.name, email: r.email, spent: r.spent / MICRO, bought: (r.bought ?? 0) / MICRO }))
    : [];

  return {
    days: p.days,
    currency: credit?.currency ?? null,
    plus: {
      paid: plus?.paid ?? 0,
      given: plus?.given ?? 0,
      monthlyLabel: config.labels.monthly,
      yearlyLabel: config.labels.yearly,
    },
    models,
    renders: {
      jobs: jobs?.jobs ?? 0,
      finished: jobs?.finished ?? 0,
      failed: jobs?.failed ?? 0,
      gpuSeconds: jobs?.seconds ?? 0,
      charged: credit ? (jobs?.charged ?? 0) / MICRO : 0,
    },
    topSpenders,
    daily,
    margin,
  };
}

// ---- usage ----

/** How many rows of `table` were made each day of the period, by day. */
function madePerDay(table: "files" | "versions", p: Period): Map<string, number> {
  return new Map(
    all<{ day: string; n: number }>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS n FROM ${table} WHERE created_at >= ? AND created_at < ? GROUP BY day`,
      p.from,
      p.end,
    ).map((r) => [r.day, r.n] as const),
  );
}

function usage(p: Period): AdminUsage {
  const files = get<{ total: number; fresh: number | null; branches: number | null }>(
    `SELECT COUNT(*) AS total, SUM(created_at >= ? AND created_at < ?) AS fresh, SUM(branch_name IS NOT NULL) AS branches FROM files`,
    p.from,
    p.end,
  );
  const versions = get<{ n: number; bytes: number | null }>("SELECT COUNT(*) AS n, SUM(size) AS bytes FROM versions");
  // the extension is what follows the name's last dot: trimming the name's other characters off its
  // end stops at that dot
  const kinds = all<Tally>(
    `SELECT label, COUNT(*) AS count FROM (
       SELECT CASE WHEN instr(name, '.') = 0 OR name LIKE '%.' THEN 'none'
         ELSE lower(substr(name, length(rtrim(name, replace(name, '.', ''))) + 1)) END AS label
       FROM files
     ) GROUP BY label ORDER BY count DESC, label LIMIT 12`,
  );
  const gallery = get<{ published: number | null; hidden: number | null; fresh: number | null }>(
    `SELECT SUM(unpublished_at IS NULL AND hidden_at IS NULL) AS published, SUM(unpublished_at IS NULL AND hidden_at IS NOT NULL) AS hidden,
       SUM(published_at >= ? AND published_at < ?) AS fresh FROM gallery_entries`,
    p.from,
    p.end,
  );
  const madeFiles = madePerDay("files", p);
  const madeVersions = madePerDay("versions", p);

  return {
    days: p.days,
    files: {
      total: files?.total ?? 0,
      fresh: files?.fresh ?? 0,
      versions: versions?.n ?? 0,
      bytes: versions?.bytes ?? 0,
      branches: files?.branches ?? 0,
      shared: countOf("SELECT COUNT(DISTINCT file_id) AS n FROM shares WHERE revoked_at IS NULL"),
      withMembers: countOf("SELECT COUNT(DISTINCT file_id) AS n FROM members WHERE role != 'owner'"),
      kinds,
    },
    daily: daysFrom(p.from, p.end).map((day) => ({ day, files: madeFiles.get(day) ?? 0, versions: madeVersions.get(day) ?? 0 })),
    gallery: {
      published: gallery?.published ?? 0,
      hidden: gallery?.hidden ?? 0,
      openReports: countOf("SELECT COUNT(*) AS n FROM gallery_reports WHERE resolved_at IS NULL"),
      forks: countOf("SELECT COUNT(*) AS n FROM gallery_forks"),
      fresh: gallery?.fresh ?? 0,
    },
    comments: countOf("SELECT COUNT(*) AS n FROM comments WHERE created_at >= ? AND created_at < ?", p.from, p.end),
    mergeRequests: countOf("SELECT COUNT(*) AS n FROM merge_requests WHERE created_at >= ? AND created_at < ?", p.from, p.end),
    agents: {
      apps: countOf("SELECT COUNT(*) AS n FROM oauth_grants"),
      tokens: countOf("SELECT COUNT(*) AS n FROM mcp_tokens"),
      users: countOf(
        "SELECT COUNT(DISTINCT user_id) AS n FROM ai_ledger WHERE kind = 'usage' AND coalesce(model, '') NOT LIKE 'render %' AND created_at >= ? AND created_at < ?",
        p.from,
        p.end,
      ),
    },
  };
}

export function registerAdminStats(app: Hono): void {
  sample();
  setInterval(sample, MINUTE).unref();

  app.get("/api/admin/live", (c) => {
    requireAdmin(c);
    const out: AdminLive = { at: nowIso(), visitors: visitorsNow(), recent: [...recent], today: todayNow(), sessions: sessionsNow() };
    return c.json(out);
  });

  app.get("/api/admin/geo", (c) => {
    requireAdmin(c);
    return c.json(geo(periodOf(c)));
  });

  app.get("/api/admin/engagement", (c) => {
    requireAdmin(c);
    return c.json(engagement(periodOf(c)));
  });

  app.get("/api/admin/revenue", (c) => {
    requireAdmin(c);
    return c.json(revenue(periodOf(c)));
  });

  app.get("/api/admin/usage", (c) => {
    requireAdmin(c);
    return c.json(usage(periodOf(c)));
  });
}
