// Tests for the admin page's statistics (src/adminStats.ts): node scripts/admin-stats-test.ts
// A temporary data folder is seeded before the server starts (so the live sample at start-up sees
// the seeded visits). The expected numbers are worked out by hand from the seed; the cohorts and the
// hours are counted again the plain way. A real server runs on a loopback port, and an admin signs
// in through an email link.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "rodeo-admin-stats-"));
// removed however the run ends, including when the seeding fails before the checks start
process.on("exit", () => rmSync(data, { recursive: true, force: true }));
let log = "";

// config.ts reads the environment when it is imported, so the src modules load after these lines
Object.assign(process.env, {
  NODE_ENV: "development",
  PORT: String(PORT),
  DATA_DIR: data,
  PUBLIC_URL: BASE,
  ADMIN_EMAILS: "admin@example.com",
  // a model key turns AI credit on, priced at half a dollar to the pound; no request reaches it
  OPENROUTER_API_KEY: "test-key",
  ANTHROPIC_API_KEY: "",
  AI_CURRENCY: "gbp",
  AI_USD_RATE: "0.5",
  CLIENT_IP_HEADER: "x-test-ip",
});

const { database, openDatabase } = await import("../src/db.ts");

const MIN = 60_000;
const DAY = 86_400_000;
const seedAt = Date.now();
const today = new Date(seedAt).toISOString().slice(0, 10);
/** the UTC day `n` days before today */
const ago = (n: number): string => new Date(Date.parse(`${today}T00:00:00Z`) - n * DAY).toISOString().slice(0, 10);
/** a time on the day `n` days before today, "HH:MM" or "HH:MM:SS" */
const on = (n: number, hms: string): string => `${ago(n)}T${hms.length === 5 ? `${hms}:00` : hms}.000Z`;
/** the time `ms` before the seed */
const before = (ms: number): string => new Date(seedAt - ms).toISOString();
const hash = (s: string): string => createHash("sha256").update(s).digest("hex");
const addDays = (day: string, n: number): string => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const mondayOf = (day: string): string => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

// ---- the seed ----

openDatabase();
const db = database();

function insert(sql: string, ...params: (string | number | null)[]): void {
  db.prepare(sql).run(...params);
}

interface Person {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly created: string;
  readonly until: string | null;
  readonly sub: string | null;
}

const admin: Person = { id: "u_admin", email: "admin@example.com", name: "Admin", created: on(100, "00:00"), until: null, sub: null };
const accounts: Person[] = [
  { id: "u_alice", email: "alice@example.com", name: "Alice", created: on(3, "09:00"), until: null, sub: null },
  // paid for Rodeo Plus through Stripe
  { id: "u_ben", email: "ben@example.com", name: "Ben", created: on(0, "10:00"), until: new Date(seedAt + 30 * DAY).toISOString(), sub: "sub_ben" },
  // given Rodeo Plus by an admin
  { id: "u_cara", email: "cara@example.com", name: "Cara", created: on(40, "08:00"), until: new Date(seedAt + 10 * DAY).toISOString(), sub: null },
  { id: "u_dan", email: "dan@example.com", name: "Dan", created: on(29, "12:00"), until: null, sub: null },
  { id: "u_erin", email: "erin@example.com", name: "Erin", created: on(60, "09:00"), until: null, sub: null },
];
for (const p of [admin, ...accounts]) {
  insert(
    "INSERT INTO users (id, email, name, created_at, plan, supporter_until, stripe_subscription_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    p.id,
    p.email,
    p.name,
    p.created,
    p.until ? "supporter" : "free",
    p.until,
    p.sub,
  );
}

interface Seen {
  /** days before today */
  readonly n: number;
  readonly name: string;
  readonly user: string | null;
  readonly first: string;
  readonly last: string;
  readonly opens: number;
  readonly entry: string;
  readonly country: string;
  readonly device: string;
  readonly browser: string;
  readonly os: string;
  readonly referrer?: string;
  readonly city?: string;
  readonly region?: string;
  readonly lat?: number;
  readonly lon?: number;
}

const LONDON = { city: "London", region: "England", lat: 51.5, lon: -0.1 };
const LYON = { city: "Lyon", region: "Auvergne-Rhône-Alpes", lat: 45.8, lon: 4.8 };
const BRISTOL = { city: "Bristol", region: "England", lat: 51.5, lon: -2.6 };
const PARIS = { city: "Paris", region: "Île-de-France", lat: 48.9, lon: 2.3 };
const AUSTIN = { city: "Austin", region: "Texas", lat: 30.3, lon: -97.7 };
const LEEDS = { city: "Leeds", region: "England", lat: 53.8, lon: -1.5 };
const CHROME_MAC = { device: "desktop", browser: "Chrome", os: "macOS" };
const SAFARI_PHONE = { device: "phone", browser: "Safari", os: "iOS" };
const FIREFOX_LINUX = { device: "desktop", browser: "Firefox", os: "Linux" };

const seen: Seen[] = [
  // guests in the period
  { n: 0, name: "g1", user: null, first: on(0, "09:00"), last: on(0, "09:02"), opens: 0, entry: "share", referrer: "news.ycombinator.com", country: "FR", ...SAFARI_PHONE, ...PARIS },
  { n: 1, name: "g2", user: null, first: on(1, "14:00"), last: on(1, "14:40"), opens: 3, entry: "editor", country: "FR", device: "desktop", browser: "Chrome", os: "Windows" },
  { n: 2, name: "g3", user: null, first: on(2, "10:00"), last: on(2, "10:00"), opens: 0, entry: "embed", country: "DE", ...FIREFOX_LINUX },
  // a guest last heard from 10 minutes ago: not live
  { n: 0, name: "stale", user: null, first: before(30 * MIN), last: before(10 * MIN), opens: 0, entry: "editor", country: "GB", ...CHROME_MAC },
  // a guest in the editor now
  { n: 0, name: "l1", user: null, first: before(4 * MIN), last: before(0), opens: 1, entry: "editor", referrer: "news.ycombinator.com", country: "GB", device: "desktop", browser: "Firefox", os: "Windows", ...LEEDS },
  // Alice, Ben and Cara; Alice's a4 is a second device, in the editor now
  { n: 3, name: "a1", user: "u_alice", first: on(3, "09:00"), last: on(3, "09:20"), opens: 2, entry: "share", country: "GB", ...CHROME_MAC, ...LONDON },
  { n: 1, name: "a2", user: "u_alice", first: on(1, "09:00"), last: on(1, "09:45"), opens: 1, entry: "editor", country: "GB", ...CHROME_MAC, ...LONDON },
  { n: 0, name: "a3", user: "u_alice", first: on(0, "08:00"), last: on(0, "08:03"), opens: 0, entry: "editor", country: "GB", ...CHROME_MAC, ...LONDON },
  { n: 0, name: "a4", user: "u_alice", first: before(2 * MIN), last: before(30_000), opens: 0, entry: "editor", country: "GB", ...SAFARI_PHONE, ...LONDON },
  { n: 0, name: "b1", user: "u_ben", first: on(0, "10:30"), last: on(0, "12:35"), opens: 3, entry: "editor", country: "US", ...SAFARI_PHONE, ...AUSTIN },
  { n: 2, name: "c1", user: "u_cara", first: on(2, "09:00"), last: on(2, "09:09"), opens: 0, entry: "editor", country: "FR", ...FIREFOX_LINUX, ...LYON },
  { n: 0, name: "c2", user: "u_cara", first: on(0, "15:00"), last: on(0, "15:40"), opens: 2, entry: "editor", country: "FR", ...FIREFOX_LINUX, ...LYON },
  { n: 10, name: "c3", user: "u_cara", first: on(10, "11:00"), last: on(10, "11:07"), opens: 1, entry: "editor", country: "FR", ...FIREFOX_LINUX, ...LYON },
  // Dan, who signed up at the start of the period and came back once
  { n: 29, name: "d1", user: "u_dan", first: on(29, "12:00"), last: on(29, "12:06"), opens: 0, entry: "invite", country: "GB", device: "desktop", browser: "Chrome", os: "Windows", ...BRISTOL },
  { n: 20, name: "d2", user: "u_dan", first: on(20, "08:00"), last: on(20, "08:01:30"), opens: 1, entry: "editor", country: "GB", device: "desktop", browser: "Chrome", os: "Windows", ...BRISTOL },
  // outside the 30-day period
  { n: 33, name: "g4", user: null, first: on(33, "10:00"), last: on(33, "10:20"), opens: 0, entry: "editor", country: "US", device: "desktop", browser: "Chrome", os: "Windows" },
  { n: 33, name: "e1", user: "u_erin", first: on(33, "10:00"), last: on(33, "10:10"), opens: 0, entry: "editor", country: "NL", device: "desktop", browser: "Chrome", os: "Windows" },
  // the admin's own visits, left out of every number (one of them in the editor now)
  { n: 0, name: "ad1", user: "u_admin", first: on(0, "07:00"), last: on(0, "07:50"), opens: 4, entry: "editor", country: "GB", ...CHROME_MAC },
  { n: 3, name: "ad2", user: "u_admin", first: on(3, "09:00"), last: on(3, "09:30"), opens: 2, entry: "editor", country: "GB", ...CHROME_MAC },
  { n: 0, name: "adl", user: "u_admin", first: before(3 * MIN), last: before(0), opens: 1, entry: "editor", country: "GB", ...CHROME_MAC },
];
for (const v of seen) {
  insert(
    "INSERT INTO visits (day, visitor, user_id, first_at, last_at, pings, opens, entry, referrer, country, device, browser, os, city, region, lat, lon) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ago(v.n),
    hash(v.name),
    v.user,
    v.first,
    v.last,
    v.opens,
    v.entry,
    v.referrer ?? null,
    v.country,
    v.device,
    v.browser,
    v.os,
    v.city ?? null,
    v.region ?? null,
    v.lat ?? null,
    v.lon ?? null,
  );
}

function ledger(user: string, kind: string, amount: number, at: string, e: { ref: string; model?: string; tokensIn?: number; tokensOut?: number; cost?: number }): void {
  insert(
    "INSERT INTO ai_ledger (user_id, kind, amount, balance, ref, model, tokens_in, tokens_out, cost_usd, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
    user,
    kind,
    amount,
    e.ref,
    e.model ?? null,
    e.tokensIn ?? null,
    e.tokensOut ?? null,
    e.cost ?? null,
    at,
  );
}
ledger("u_alice", "usage", -1_000_000, on(1, "10:00"), { ref: "req-1", model: "anthropic/claude-x", tokensIn: 1000, tokensOut: 200, cost: 0.6 });
ledger("u_alice", "usage", -500_000, on(0, "08:30"), { ref: "req-2", model: "anthropic/claude-x", tokensIn: 500, tokensOut: 100, cost: 0.3 });
ledger("u_alice", "usage", -500_000, on(1, "16:00"), { ref: "rj-alice", model: "render L40S", cost: 0.4 });
ledger("u_alice", "topup", 2_000_000, on(2, "09:30"), { ref: "cs_alice" });
ledger("u_ben", "topup", 5_000_000, on(0, "11:00"), { ref: "cs_ben" });
ledger("u_ben", "usage", -2_000_000, on(0, "12:00"), { ref: "req-3", model: "openai/gpt-y", tokensIn: 2000, tokensOut: 400, cost: 1.0 });
ledger("u_ben", "usage", -3_000_000, on(0, "13:00"), { ref: "rj-ben", model: "render L40S", cost: 2.0 });
ledger("u_cara", "topup", 4_000_000, on(10, "10:00"), { ref: "cs_cara" });
ledger("u_cara", "usage", -1_000_000, on(10, "10:30"), { ref: "req-4", model: "anthropic/claude-x", tokensIn: 800, tokensOut: 150, cost: 0.5 });
ledger("u_dan", "usage", -250_000, on(20, "08:00"), { ref: "req-5", cost: 0.1 });
ledger("u_erin", "usage", -9_000_000, on(45, "10:00"), { ref: "req-6", model: "anthropic/claude-x", tokensIn: 9000, tokensOut: 900, cost: 4.0 });

function job(id: string, user: string, state: string, created: string, finished: string | null, seconds: number | null, charged: number | null): void {
  insert(
    "INSERT INTO render_jobs (id, user_id, state, name, width, height, samples, shots, gpu, limit_seconds, hold, seconds, charged, error, pictures, created_at, finished_at) VALUES (?, ?, ?, 'Render', 1920, 1080, 64, 1, 'L40S', 600, 1000000, ?, ?, ?, '[]', ?, ?)",
    id,
    user,
    state,
    seconds,
    charged,
    state === "failed" ? "The render made no picture." : null,
    created,
    finished,
  );
}
job("rj-ben", "u_ben", "done", on(0, "13:00"), on(0, "13:05"), 100, 3_000_000);
job("rj-dan", "u_dan", "failed", on(5, "10:00"), on(5, "10:02"), null, null);
job("rj-alice", "u_alice", "cancelled", on(1, "16:00"), on(1, "16:01"), 20, 500_000);

// files, the versions they hold, who has them, shares, merge requests, comments, gallery and agents
const files: [id: string, owner: string, name: string, created: string, branch: string | null][] = [
  ["f1", "u_alice", "House.vwx", on(2, "09:00"), null],
  ["f2", "u_alice", "notes", on(1, "09:00"), null],
  ["f3", "u_alice", "plan.dwg", on(0, "08:00"), null],
  ["f4", "u_ben", "garden.VWX", on(0, "10:00"), null],
  ["f5", "u_cara", "old.skp", on(50, "09:00"), null],
  ["f6", "u_dan", "branch.vwx", on(5, "12:00"), "alt"],
  ["f7", "u_ben", "site.plan.v2.PDF", on(0, "11:30"), null],
  ["f8", "u_alice", "trailing.", on(0, "08:10"), null],
];
for (const [id, owner, name, created, branch] of files) {
  insert("INSERT INTO files (id, owner_id, name, created_at, updated_at, size, branch_name, created_by) VALUES (?, ?, ?, ?, ?, 0, ?, ?)", id, owner, name, created, created, branch, owner);
}
const versions: [file: string, created: string, size: number][] = [
  ["f1", on(2, "09:00"), 100],
  ["f1", on(2, "09:30"), 200],
  ["f2", on(1, "09:00"), 10],
  ["f3", on(0, "08:00"), 30],
  ["f4", on(0, "10:00"), 40],
  ["f4", on(0, "10:10"), 50],
  ["f5", on(50, "09:00"), 500],
  ["f6", on(5, "12:00"), 60],
  ["f7", on(0, "11:30"), 70],
  ["f8", on(0, "08:10"), 5],
];
versions.forEach(([file, created, size], i) => {
  insert("INSERT INTO versions (id, file_id, created_at, size, blob, sha256) VALUES (?, ?, ?, ?, ?, 'x')", `v${i}`, file, created, size, `blob${i}`);
});
const members: [file: string, user: string, role: string][] = [
  ["f1", "u_alice", "owner"],
  ["f1", "u_ben", "editor"],
  ["f2", "u_alice", "owner"],
  ["f3", "u_alice", "owner"],
  ["f4", "u_ben", "owner"],
  ["f4", "u_cara", "reviewer"],
  ["f5", "u_cara", "owner"],
  ["f6", "u_dan", "owner"],
  ["f7", "u_ben", "owner"],
  ["f8", "u_alice", "owner"],
];
for (const [file, user, role] of members) insert("INSERT INTO members (file_id, user_id, role, added_at) VALUES (?, ?, ?, ?)", file, user, role, on(0, "00:00"));
insert("INSERT INTO shares (token, file_id, created_by, allow_download, created_at) VALUES ('tok-f1', 'f1', 'u_alice', 1, ?)", on(2, "10:00"));
insert("INSERT INTO shares (token, file_id, created_by, allow_download, created_at, revoked_at) VALUES ('tok-f4', 'f4', 'u_ben', 1, ?, ?)", on(0, "11:00"), on(0, "11:30"));
insert(
  "INSERT INTO merge_requests (id, source_file_id, target_file_id, author_id, title, state, created_at, updated_at) VALUES ('mr1', 'f6', 'f1', 'u_dan', 'Add the branch', 'open', ?, ?)",
  on(4, "10:00"),
  on(4, "10:00"),
);
insert(
  "INSERT INTO merge_requests (id, source_file_id, target_file_id, author_id, title, state, created_at, updated_at) VALUES ('mr2', 'f4', 'f1', 'u_ben', 'Old change', 'merged', ?, ?)",
  on(40, "10:00"),
  on(40, "10:00"),
);
insert("INSERT INTO comments (id, file_id, author_id, created_at, updated_at, body) VALUES ('c1', 'f1', 'u_ben', ?, ?, 'Nice wall')", on(1, "12:00"), on(1, "12:00"));
insert("INSERT INTO comments (id, file_id, author_id, created_at, updated_at, body) VALUES ('c2', 'f1', 'u_alice', ?, ?, 'Old')", on(35, "12:00"), on(35, "12:00"));
insert("INSERT INTO comments (id, file_id, author_id, created_at, updated_at, body) VALUES ('c3', 'f4', 'u_cara', ?, ?, 'Hi')", on(0, "16:00"), on(0, "16:00"));
const GALLERY = "INSERT INTO gallery_entries (id, file_id, owner_id, title, licence, credit_name, published_at, updated_at, unpublished_at, hidden_at, hidden_reason) VALUES (?, ?, ?, ?, 'CC-BY-4.0', ?, ?, ?, ?, ?, ?)";
// published
insert(GALLERY, "ge1", "f1", "u_alice", "House", "Alice", on(2, "10:00"), on(2, "10:00"), null, null, null);
// hidden by a moderator, and not unpublished
insert(GALLERY, "ge2", "f4", "u_ben", "Garden", "Ben", on(40, "10:00"), on(1, "12:00"), null, on(1, "12:00"), "spam");
// published in the period, then taken down the same day
insert(GALLERY, "ge3", "f7", "u_ben", "Site", "Ben", on(0, "12:00"), on(0, "12:30"), on(0, "12:30"), null, null);
insert("INSERT INTO gallery_reports (id, entry_id, reason, created_at) VALUES ('r1', 'ge1', 'other', ?)", on(1, "12:00"));
insert("INSERT INTO gallery_reports (id, entry_id, reason, created_at, resolved_at) VALUES ('r2', 'ge2', 'other', ?, ?)", on(2, "12:00"), on(0, "09:00"));
insert(
  "INSERT INTO gallery_forks (file_id, entry_id, title, credit_name, licence, forked_by, forked_at) VALUES ('f6', 'ge1', 'Branch of House', 'Alice', 'CC-BY-4.0', 'u_dan', ?)",
  on(5, "12:00"),
);
insert("INSERT INTO oauth_grants (id, user_id, client_id, client_name, redirect_uri, scope, resource, created_at) VALUES ('og1', 'u_alice', 'a', 'Claude', 'https://x/cb', 'mcp', 'https://r', ?)", on(3, "10:00"));
insert("INSERT INTO oauth_grants (id, user_id, client_id, client_name, redirect_uri, scope, resource, created_at) VALUES ('og2', 'u_ben', 'b', 'ChatGPT', 'https://y/cb', 'mcp', 'https://r', ?)", on(3, "10:00"));
// a connection with a live refresh token (housekeeping drops those without one)
for (const grant of ["og1", "og2"]) {
  insert("INSERT INTO oauth_tokens (hash, grant_id, kind, created_at, expires_at) VALUES (?, ?, 'refresh', ?, ?)", hash(`refresh-${grant}`), grant, on(0, "00:00"), before(-DAY));
}
insert("INSERT INTO mcp_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES ('t1', 'u_alice', 'laptop', ?, 'ovx_abc', ?)", hash("token-1"), on(1, "10:00"));
db.close();

// ---- the server ----

const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

async function call(cookie: string, method: string, path: string, body?: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "X-Requested-With": "openvwx",
      "User-Agent": CHROME_UA,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    redirect: "manual",
  });
}

async function json<T>(cookie: string, path: string): Promise<T> {
  const res = await call(cookie, "GET", path);
  const text = await res.text();
  assert.ok(res.ok, `GET ${path} answered ${res.status}: ${text}`);
  return JSON.parse(text) as T;
}

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}\n${log}`);
}

/** Signs `email` in through an email link; resolves with the session cookie ("" when refused). */
async function signIn(email: string): Promise<string> {
  const mark = log.length;
  assert.equal((await call("", "POST", "/api/auth/email", { email })).status, 200);
  await until(() => /callback\?token=[\w-]+/.test(log.slice(mark)), `${email}'s sign-in link`);
  const link = /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(log.slice(mark))![1];
  const res = await call("", "GET", link);
  assert.equal(res.status, 302);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

/** Rounds every number to a millionth (money is summed in floats), and -0 to 0, for comparing. */
function round(v: unknown): unknown {
  if (typeof v === "number") return Math.round(v * 1e6) / 1e6 + 0;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
}

const ENDPOINTS = ["/api/admin/live", "/api/admin/geo", "/api/admin/engagement", "/api/admin/revenue", "/api/admin/usage"];

interface Live {
  at: string;
  visitors: {
    key: string;
    member: { id: string; name: string; email: string } | null;
    country: string | null;
    city: string | null;
    lat: number | null;
    entry: string;
    referrer: string | null;
    device: string;
    opens: number;
  }[];
  recent: { at: string; guests: number; members: number }[];
  today: { visitors: number; members: number; signups: number; opens: number };
  sessions: { drawings: number; people: number; together: number };
}
interface Geo {
  days: number;
  countries: { code: string; visits: number; members: number; signups: number; opens: number; medianMinutes: number }[];
  places: {
    country: string;
    city: string | null;
    region: string | null;
    lat: number | null;
    lon: number | null;
    visits: number;
    members: number;
  }[];
  located: number;
  total: number;
}
interface Engagement {
  days: number;
  active: { day: string; dau: number; wau: number; mau: number }[];
  hours: number[][];
  lengths: { label: string; count: number }[];
  opensPerVisit: { label: string; count: number }[];
  funnel: { label: string; count: number; note: string | null }[];
  cohorts: { week: string; size: number; weeks: number[] }[];
  members: { day: string; fresh: number; returning: number }[];
}
interface Revenue {
  days: number;
  currency: string | null;
  plus: { paid: number; given: number; monthlyLabel: string; yearlyLabel: string };
  models: { model: string; steps: number; users: number; charged: number; costUsd: number; tokensIn: number; tokensOut: number }[];
  renders: { jobs: number; finished: number; failed: number; gpuSeconds: number; charged: number };
  topSpenders: { id: string; name: string; email: string; spent: number; bought: number }[];
  daily: { day: string; topups: number; charged: number; costUsd: number }[];
  margin: { charged: number; cost: number } | null;
}
interface Usage {
  days: number;
  files: {
    total: number;
    fresh: number;
    versions: number;
    bytes: number;
    branches: number;
    shared: number;
    withMembers: number;
    kinds: { label: string; count: number }[];
  };
  daily: { day: string; files: number; versions: number }[];
  gallery: { published: number; hidden: number; openReports: number; forks: number; fresh: number };
  comments: number;
  mergeRequests: number;
  agents: { apps: number; tokens: number; users: number };
}

try {
  await until(() => log.includes("listening"), "the server");

  const cookie = await signIn("admin@example.com");
  assert.ok(cookie, "the admin's session");

  // ---- live ----------------------------------------------------------------------
  const live = await json<Live>(cookie, "/api/admin/live");
  assert.ok(!Number.isNaN(Date.parse(live.at)), "the server's time");
  // Live: the guest in the editor and Alice's second device, newest first; the stale guest and
  // the admin's own visit are left out
  assert.equal(live.visitors.length, 2);
  assert.deepEqual(
    live.visitors.map((v) => v.key),
    [hash("l1").slice(0, 12), hash("a4").slice(0, 12)],
  );
  assert.deepEqual(live.visitors[0], {
    key: hash("l1").slice(0, 12),
    member: null,
    country: "GB",
    city: "Leeds",
    region: "England",
    lat: 53.8,
    lon: -1.5,
    device: "desktop",
    browser: "Firefox",
    os: "Windows",
    entry: "editor",
    referrer: "news.ycombinator.com",
    firstAt: before(4 * MIN),
    lastAt: before(0),
    opens: 1,
  });
  assert.deepEqual(live.visitors[1].member, { id: "u_alice", name: "Alice", email: "alice@example.com" });
  // the sample taken at start-up saw the guest and Alice (not the admin)
  assert.ok(live.recent.length >= 1);
  assert.deepEqual({ guests: live.recent[0].guests, members: live.recent[0].members }, { guests: 1, members: 1 });
  // today: the 7 visits of today's day (the admin left out), 3 accounts, 6 drawings opened, and Ben signed up today
  assert.deepEqual(live.today, { visitors: 7, members: 3, signups: 1, opens: 6 });
  assert.deepEqual(live.sessions, { drawings: 0, people: 0, together: 0 }, "no live drawings in this test");

  // ---- geo -----------------------------------------------------------------------
  const geo = await json<Geo>(cookie, "/api/admin/geo");
  assert.equal(geo.days, 30);
  assert.equal(geo.total, 15, "15 visits in the period, the admin's and the 33-day-old ones left out");
  assert.equal(geo.located, 12, "three of them had no city");
  assert.deepEqual(round(geo.countries), [
    { code: "GB", visits: 8, members: 2, signups: 2, opens: 5, medianMinutes: 6 },
    { code: "FR", visits: 5, members: 1, signups: 0, opens: 6, medianMinutes: 9 },
    { code: "DE", visits: 1, members: 0, signups: 0, opens: 0, medianMinutes: 0 },
    { code: "US", visits: 1, members: 1, signups: 1, opens: 3, medianMinutes: 125 },
  ]);
  assert.deepEqual(round(geo.places), [
    { country: "GB", city: "London", region: "England", lat: 51.5, lon: -0.1, visits: 4, members: 1 },
    { country: "FR", city: "Lyon", region: "Auvergne-Rhône-Alpes", lat: 45.8, lon: 4.8, visits: 3, members: 1 },
    { country: "GB", city: "Bristol", region: "England", lat: 51.5, lon: -2.6, visits: 2, members: 1 },
    { country: "DE", city: null, region: null, lat: null, lon: null, visits: 1, members: 0 },
    { country: "FR", city: null, region: null, lat: null, lon: null, visits: 1, members: 0 },
    { country: "FR", city: "Paris", region: "Île-de-France", lat: 48.9, lon: 2.3, visits: 1, members: 0 },
    { country: "GB", city: null, region: null, lat: null, lon: null, visits: 1, members: 0 },
    { country: "GB", city: "Leeds", region: "England", lat: 53.8, lon: -1.5, visits: 1, members: 0 },
    { country: "US", city: "Austin", region: "Texas", lat: 30.3, lon: -97.7, visits: 1, members: 1 },
  ]);
  // a week: the visits from the last 7 days only
  const geo7 = await json<Geo>(cookie, "/api/admin/geo?days=7");
  assert.equal(geo7.days, 7);
  assert.equal(geo7.total, 12);
  assert.equal(geo7.countries[0].code, "GB");
  assert.equal(geo7.countries[0].visits, 6);

  // ---- engagement ----------------------------------------------------------------
  const eng = await json<Engagement>(cookie, "/api/admin/engagement");
  assert.equal(eng.days, 30);
  assert.equal(eng.active.length, 30);
  assert.equal(eng.active[0].day, ago(29));
  assert.equal(eng.active[29].day, ago(0));
  // [dau, wau, mau] for each day, oldest first: the same as counting the visits day by day
  const activeCounts: [number, number, number][] = [
    [1, 2, 2], [0, 2, 2], [0, 2, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 0, 2], [0, 0, 2], [1, 1, 2],
    [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 1, 2], [0, 0, 2], [0, 0, 2], [0, 0, 2], [1, 1, 3],
    [0, 1, 3], [0, 1, 3], [0, 1, 3], [0, 1, 3], [0, 1, 3], [0, 1, 3], [1, 1, 3], [1, 2, 3], [1, 2, 3], [3, 3, 4],
  ];
  assert.deepEqual(
    eng.active.map((a) => [a.dau, a.wau, a.mau]),
    activeCounts,
  );
  // when the visits began, counted the plain way (weekday from 0 Sunday, hour in UTC)
  const grid = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  for (const v of seen) {
    if (v.user === "u_admin" || v.n > 29) continue;
    const at = new Date(v.first);
    grid[at.getUTCDay()][at.getUTCHours()]++;
  }
  assert.deepEqual(eng.hours, grid);
  assert.deepEqual(eng.lengths, [
    { label: "Under 1 min", count: 1 },
    { label: "1–5 min", count: 5 },
    { label: "5–15 min", count: 3 },
    { label: "15–30 min", count: 2 },
    { label: "30–60 min", count: 3 },
    { label: "1–2 h", count: 0 },
    { label: "Over 2 h", count: 1 },
  ]);
  assert.deepEqual(eng.opensPerVisit, [
    { label: "None", count: 7 },
    { label: "1", count: 4 },
    { label: "2–3", count: 4 },
    { label: "4–9", count: 0 },
    { label: "10 or more", count: 0 },
  ]);
  assert.deepEqual(
    eng.funnel.map((f) => [f.label, f.count]),
    [
      ["Visits", 15],
      ["Opened a drawing", 8],
      ["Signed up", 3],
      ["Came back another day", 2],
      ["Paid", 1],
    ],
  );
  assert.ok(eng.funnel.every((f) => f.note === null || typeof f.note === "string"));
  // the cohorts, counted the plain way: the 12 weeks from this Monday back, accounts (no admin) and
  // their visits by the week after they joined
  const visitDays = seen.filter((v) => v.user !== null && v.user !== "u_admin").map((v) => ({ id: v.user!, day: ago(v.n) }));
  const starts = Array.from({ length: 12 }, (_, i) => addDays(mondayOf(today), -7 * (11 - i)));
  const cohorts = starts.map((week, i) => {
    const who = accounts.filter((a) => a.created.slice(0, 10) >= week && a.created.slice(0, 10) < addDays(week, 7));
    const weeks = Array.from({ length: 12 - i }, (_, k) => {
      const from = addDays(week, 7 * k);
      const to = addDays(from, 7);
      return who.filter((a) => visitDays.some((v) => v.id === a.id && v.day >= from && v.day < to)).length;
    });
    return { week, size: who.length, weeks };
  });
  assert.deepEqual(eng.cohorts, cohorts);
  assert.equal(eng.cohorts.length, 12);
  assert.equal(new Date(`${eng.cohorts[11].week}T00:00:00Z`).getUTCDay(), 1, "weeks start on Monday");
  // signed-in visitors a day: accounts made in the last 7 days to the day, and older ones
  const returningOn = new Map<number, [number, number]>([
    [0, [2, 1]],
    [1, [1, 0]],
    [2, [0, 1]],
    [3, [1, 0]],
    [10, [0, 1]],
    [20, [0, 1]],
    [29, [1, 0]],
  ]);
  eng.members.forEach((m, i) => {
    const [fresh, returning] = returningOn.get(29 - i) ?? [0, 0];
    assert.deepEqual([m.day, m.fresh, m.returning], [ago(29 - i), fresh, returning], `members for ${m.day}`);
  });

  // a week of engagement: 7 days
  assert.equal((await json<Engagement>(cookie, "/api/admin/engagement?days=7")).active.length, 7);

  // ---- revenue -------------------------------------------------------------------
  const rev = await json<Revenue>(cookie, "/api/admin/revenue");
  assert.equal(rev.currency, "gbp");
  assert.deepEqual(rev.plus, { paid: 1, given: 1, monthlyLabel: "£2/month", yearlyLabel: "£15/year" });
  // the agents by model, most charged first; the renders and the admin's and Erin's old use left out
  assert.deepEqual(round(rev.models), [
    { model: "anthropic/claude-x", steps: 3, users: 2, charged: 2.5, costUsd: 1.4, tokensIn: 2300, tokensOut: 450 },
    { model: "openai/gpt-y", steps: 1, users: 1, charged: 2, costUsd: 1, tokensIn: 2000, tokensOut: 400 },
    { model: "unknown", steps: 1, users: 1, charged: 0.25, costUsd: 0.1, tokensIn: 0, tokensOut: 0 },
  ]);
  assert.deepEqual(round(rev.renders), { jobs: 3, finished: 1, failed: 1, gpuSeconds: 120, charged: 3.5 });
  assert.deepEqual(round(rev.topSpenders), [
    { id: "u_ben", name: "Ben", email: "ben@example.com", spent: 5, bought: 5 },
    { id: "u_alice", name: "Alice", email: "alice@example.com", spent: 2, bought: 2 },
    { id: "u_cara", name: "Cara", email: "cara@example.com", spent: 1, bought: 4 },
    { id: "u_dan", name: "Dan", email: "dan@example.com", spent: 0.25, bought: 0 },
  ]);
  const dailyRev = new Map<number, [number, number, number]>([
    [0, [5, 5.5, 3.3]],
    [1, [0, 1.5, 1]],
    [2, [2, 0, 0]],
    [10, [4, 1, 0.5]],
    [20, [0, 0.25, 0.1]],
  ]);
  assert.equal(rev.daily.length, 30);
  rev.daily.forEach((d, i) => {
    const [topups, charged, costUsd] = dailyRev.get(29 - i) ?? [0, 0, 0];
    assert.deepEqual(round(d), { day: ago(29 - i), topups, charged, costUsd }, `daily for ${d.day}`);
  });
  assert.deepEqual(round(rev.margin), { charged: 8.25, cost: 2.45 }, "the cost at half a dollar to the pound");

  // two days: only the last two days' use, and renders in them
  const rev2 = await json<Revenue>(cookie, "/api/admin/revenue?days=2");
  assert.equal(rev2.daily.length, 2);
  assert.deepEqual(round(rev2.renders), { jobs: 2, finished: 1, failed: 0, gpuSeconds: 120, charged: 3.5 });
  assert.deepEqual(round(rev2.models), [
    { model: "openai/gpt-y", steps: 1, users: 1, charged: 2, costUsd: 1, tokensIn: 2000, tokensOut: 400 },
    { model: "anthropic/claude-x", steps: 2, users: 1, charged: 1.5, costUsd: 0.9, tokensIn: 1500, tokensOut: 300 },
  ]);
  assert.deepEqual(round(rev2.topSpenders), [
    { id: "u_ben", name: "Ben", email: "ben@example.com", spent: 5, bought: 5 },
    { id: "u_alice", name: "Alice", email: "alice@example.com", spent: 2, bought: 0 },
  ]);
  assert.deepEqual(round(rev2.margin), { charged: 7, cost: 2.15 });

  // ---- usage ---------------------------------------------------------------------
  const use = await json<Usage>(cookie, "/api/admin/usage");
  assert.equal(use.days, 30);
  assert.deepEqual(use.files, {
    total: 8,
    fresh: 7,
    versions: 10,
    bytes: 1065,
    branches: 1,
    shared: 1,
    withMembers: 2,
    kinds: [
      { label: "vwx", count: 3 },
      { label: "none", count: 2 },
      { label: "dwg", count: 1 },
      { label: "pdf", count: 1 },
      { label: "skp", count: 1 },
    ],
  });
  const dailyUse = new Map<number, [number, number]>([
    [0, [4, 5]],
    [1, [1, 1]],
    [2, [1, 2]],
    [5, [1, 1]],
  ]);
  assert.equal(use.daily.length, 30);
  use.daily.forEach((d, i) => {
    const [files, versions] = dailyUse.get(29 - i) ?? [0, 0];
    assert.deepEqual(d, { day: ago(29 - i), files, versions }, `daily for ${d.day}`);
  });
  assert.deepEqual(use.gallery, { published: 1, hidden: 1, openReports: 1, forks: 1, fresh: 2 });
  assert.equal(use.comments, 2);
  assert.equal(use.mergeRequests, 1);
  assert.deepEqual(use.agents, { apps: 2, tokens: 1, users: 4 });

  // ---- the period's length ------------------------------------------------------------
  assert.equal((await json<Usage>(cookie, "/api/admin/usage?days=400")).days, 30, "an unknown period is 30 days");
  assert.equal((await json<Usage>(cookie, "/api/admin/usage?days=abc")).days, 30);

  // ---- who may ask --------------------------------------------------------------------
  for (const path of ENDPOINTS) {
    assert.equal((await call("", "GET", path)).status, 401, `${path} needs a session`);
  }
  // Bob is signed up now, so he is counted nowhere above
  const bob = await signIn("bob@example.com");
  assert.ok(bob, "bob's session");
  for (const path of ENDPOINTS) {
    assert.equal((await call(bob, "GET", path)).status, 403, `${path} is for admins`);
  }

  console.log("admin-stats: all checks passed");
} catch (e) {
  console.error(e);
  console.error(log.split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
