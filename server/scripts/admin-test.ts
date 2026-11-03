// Tests for the admin page's API (src/admin.ts), visits (src/visits.ts), suspended accounts and
// welcome credit (src/auth.ts), and credit grants with notes (src/credit.ts):
// node scripts/admin-test.ts
// A real server on a loopback port with its own data folder; accounts sign in through email links.

import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PORT = 19000 + Math.floor(Math.random() * 1000);
const BASE = `http://localhost:${PORT}`;
const data = mkdtempSync(join(tmpdir(), "rodeo-admin-"));
let log = "";

const server: ChildProcess = spawn(process.execPath, ["src/index.ts"], {
  cwd: join(import.meta.dirname, ".."),
  env: {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(PORT),
    DATA_DIR: data,
    PUBLIC_URL: BASE,
    ADMIN_EMAILS: "admin@example.com",
    // a model key turns AI credit on; no request reaches it here
    OPENROUTER_API_KEY: "test-key",
    ANTHROPIC_API_KEY: "",
    CLIENT_IP_HEADER: "x-test-ip",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout?.on("data", (d: Buffer) => (log += d.toString()));
server.stderr?.on("data", (d: Buffer) => (log += d.toString()));

const CHROME_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FIREFOX_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

async function call(cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      "X-Requested-With": "openvwx",
      "User-Agent": CHROME_MAC,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    redirect: "manual",
  });
}

async function json<T>(cookie: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await call(cookie, method, path, body);
  const text = await res.text();
  assert.ok(res.ok, `${method} ${path} answered ${res.status}: ${text}`);
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
  const before = log.length;
  assert.equal((await call("", "POST", "/api/auth/email", { email })).status, 200);
  await until(() => /callback\?token=[\w-]+/.test(log.slice(before)), `${email}'s sign-in link`);
  const link = /(\/api\/auth\/email\/callback\?token=[\w-]+)/.exec(log.slice(before))![1];
  const res = await call("", "GET", link);
  assert.equal(res.status, 302);
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

/** A visit event as a browser at `ip` with `ua` sends it. */
function visit(cookie: string, ip: string, ua: string, body: Record<string, unknown>, country = "GB"): Promise<Response> {
  return call(cookie, "POST", "/api/visits", body, { "User-Agent": ua, "x-test-ip": ip, "cf-ipcountry": country });
}

interface Overview {
  now: { guests: number; members: number };
  period: { visits: number; guestVisits: number; activeMembers: number; signups: number; converted: number; opens: number };
  accounts: { total: number; plus: number; plusPaid: number; suspended: number };
  money: { owed: number; granted: number } | null;
  series: { day: string; guests: number; members: number; signups: number }[];
  breakdowns: Record<string, { label: string; count: number }[]>;
}
interface Listed {
  id: string;
  email: string;
  name: string;
  credit: number | null;
  granted: number;
  plan: string;
  paidPlus: boolean;
  supporterUntil: string | null;
  suspended: boolean;
  providers: string[];
}

try {
  await until(() => log.includes("listening"), "the server");

  const admin = await signIn("admin@example.com");
  assert.ok(admin, "the admin's session");

  // ---- welcome credit --------------------------------------------------------------
  assert.deepEqual(await json(admin, "GET", "/api/admin/settings"), { welcomeCredit: 0 });
  const bob = await signIn("bob@example.com");
  assert.equal((await call(bob, "PUT", "/api/admin/settings", { welcomeCredit: 2 })).status, 403, "only admins set it");
  assert.equal((await call(admin, "PUT", "/api/admin/settings", { welcomeCredit: 51 })).status, 400);
  assert.deepEqual(await json(admin, "PUT", "/api/admin/settings", { welcomeCredit: 2 }), { welcomeCredit: 2 });
  const carol = await signIn("carol@example.com");
  const carolCredit = await json<{ balance: number; moves: { kind: string; amount: number; note?: string }[] }>(carol, "GET", "/api/ai/credit");
  assert.equal(carolCredit.balance, 2, "a new account starts with the welcome credit");
  assert.equal(carolCredit.moves[0].note, "Welcome credit");
  // signing in again is not a new account
  await signIn("carol@example.com");
  assert.equal((await json<{ balance: number }>(carol, "GET", "/api/ai/credit")).balance, 2);
  const bobCredit = await json<{ balance: number }>(bob, "GET", "/api/ai/credit");
  assert.equal(bobCredit.balance, 0, "accounts made before it was set get none");

  // ---- visits ----------------------------------------------------------------------
  assert.equal((await visit("", "10.0.0.1", CHROME_MAC, { event: "visit", entry: "share", referrer: "www.News.YCombinator.com", campaign: "HN", device: "desktop" })).status, 204);
  await visit("", "10.0.0.1", CHROME_MAC, { event: "ping", device: "desktop" });
  await visit("", "10.0.0.1", CHROME_MAC, { event: "open", format: "vwx", device: "desktop" });
  // a second guest on a phone, from a site with no referrer, opening a new drawing
  await visit("", "10.0.0.2", SAFARI_IPHONE, { event: "visit", device: "phone", referrer: `localhost` }, "US");
  await visit("", "10.0.0.2", SAFARI_IPHONE, { event: "open", format: "blank", device: "phone" }, "US");
  // bob, signed in
  await visit(bob, "10.0.0.3", FIREFOX_WIN, { event: "visit", device: "desktop", entry: "nonsense" }, "FR");
  // the admin, and a crawler: neither counted
  await visit(admin, "10.0.0.4", CHROME_MAC, { event: "visit", device: "desktop" });
  await visit(admin, "10.0.0.4", CHROME_MAC, { event: "open", format: "dwg", device: "desktop" });
  assert.equal((await visit("", "10.0.0.5", "Googlebot/2.1 (+http://www.google.com/bot.html)", { event: "visit" })).status, 204);
  assert.equal((await visit("", "10.0.0.5", "Mozilla/5.0 HeadlessChrome/141.0", { event: "visit" })).status, 204);
  assert.equal((await call("", "POST", "/api/visits", { event: "visit" }, { "X-Requested-With": "" })).status, 403, "the CSRF guard holds");

  assert.equal((await call(bob, "GET", "/api/admin/overview")).status, 403, "only admins see the overview");
  assert.equal((await call("", "GET", "/api/admin/overview")).status, 401);
  let o = await json<Overview>(admin, "GET", "/api/admin/overview?days=7");
  assert.deepEqual(o.now, { guests: 2, members: 1 });
  assert.equal(o.period.visits, 3, "two guests and bob; not the admin or the crawlers");
  assert.equal(o.period.guestVisits, 2);
  assert.equal(o.period.activeMembers, 1);
  assert.equal(o.period.signups, 3);
  assert.equal(o.period.converted, 1, "bob signed up the day he came");
  assert.equal(o.period.opens, 2, "the admin's open is left out");
  assert.equal(o.series.length, 7);
  assert.equal(o.series[6].guests, 2);
  assert.equal(o.series[6].members, 1);
  assert.equal(o.series[6].signups, 3);
  assert.deepEqual(o.breakdowns.referrers, [{ label: "news.ycombinator.com", count: 1 }], "www. is dropped and this site's own host left out");
  assert.deepEqual(o.breakdowns.campaigns, [{ label: "hn", count: 1 }]);
  assert.deepEqual(
    o.breakdowns.countries.map((t) => t.label),
    ["FR", "GB", "US"],
  );
  assert.deepEqual(
    Object.fromEntries(o.breakdowns.devices.map((t) => [t.label, t.count])),
    { desktop: 2, phone: 1 },
  );
  assert.deepEqual(
    Object.fromEntries(o.breakdowns.browsers.map((t) => [t.label, t.count])),
    { Chrome: 1, Firefox: 1, Safari: 1 },
  );
  assert.deepEqual(
    Object.fromEntries(o.breakdowns.systems.map((t) => [t.label, t.count])),
    { iOS: 1, Windows: 1, macOS: 1 },
  );
  assert.deepEqual(
    Object.fromEntries(o.breakdowns.entries.map((t) => [t.label, t.count])),
    { editor: 2, share: 1 },
  );
  assert.deepEqual(
    Object.fromEntries(o.breakdowns.formats.map((t) => [t.label, t.count])),
    { blank: 1, vwx: 1 },
  );
  assert.equal(o.money?.owed, 2);
  assert.equal(o.money?.granted, 2);
  // the guest who signs in later the same day becomes a member's visit, not a second visitor
  const guest = await signIn("dave@example.com");
  await visit(guest, "10.0.0.1", CHROME_MAC, { event: "ping", device: "desktop" });
  o = await json<Overview>(admin, "GET", "/api/admin/overview?days=7");
  assert.equal(o.period.visits, 3);
  assert.equal(o.period.guestVisits, 1);
  assert.equal(o.period.converted, 2);
  assert.equal(o.series.length, 7);
  assert.equal((await json<Overview>(admin, "GET", "/api/admin/overview?days=400")).series.length, 30, "an unknown period is 30 days");

  // ---- the account list ------------------------------------------------------------
  type Page = { users: Listed[]; total: number };
  let page = await json<Page>(admin, "GET", "/api/admin/users");
  assert.equal(page.total, 4);
  assert.deepEqual(
    page.users.map((u) => u.email),
    ["dave@example.com", "carol@example.com", "bob@example.com", "admin@example.com"],
    "newest first",
  );
  assert.deepEqual(page.users[0].providers, ["email"]);
  page = await json<Page>(admin, "GET", "/api/admin/users?q=BOB");
  assert.deepEqual(
    page.users.map((u) => u.email),
    ["bob@example.com"],
  );
  page = await json<Page>(admin, "GET", "/api/admin/users?q=%25");
  assert.equal(page.total, 0, "a % in the search is a %, not a wildcard");
  page = await json<Page>(admin, "GET", "/api/admin/users?filter=credit");
  assert.deepEqual(
    page.users.map((u) => u.email).sort(),
    ["carol@example.com", "dave@example.com"],
  );
  page = await json<Page>(admin, "GET", "/api/admin/users?sort=name&filter=nonsense");
  assert.equal(page.total, 4);
  assert.equal(page.users[0].email, "admin@example.com");
  const bobId = (await json<Page>(admin, "GET", "/api/admin/users?q=bob")).users[0].id;
  const carolId = (await json<Page>(admin, "GET", "/api/admin/users?q=carol")).users[0].id;
  const adminId = (await json<Page>(admin, "GET", "/api/admin/users?q=admin")).users[0].id;

  // ---- credit ----------------------------------------------------------------------
  const before = log.length;
  assert.deepEqual(await json(admin, "POST", "/api/admin/ai-credit", { userId: bobId, amount: 5, note: "Thanks for the bug report", notify: true }), { balance: 5 });
  await until(() => log.slice(before).includes("£5.00 of AI credit for you in Rodeo"), "the grant's email");
  assert.equal((await call(admin, "POST", "/api/admin/ai-credit", { userId: bobId, amount: -10 })).status, 400, "not below nothing");
  assert.deepEqual(await json(admin, "POST", "/api/admin/ai-credit", { userId: bobId, amount: -2 }), { balance: 3 });
  assert.deepEqual(await json(admin, "POST", "/api/admin/ai-credit", { email: "bob@example.com", amount: 1 }), { balance: 4 }, "by email still works");
  assert.equal((await call(admin, "POST", "/api/admin/ai-credit", { userId: "nobody", amount: 1 })).status, 404);
  assert.equal((await call(bob, "POST", "/api/admin/ai-credit", { userId: bobId, amount: 1 })).status, 403);
  const bobMoves = (await json<{ moves: { amount: number; note?: string }[] }>(bob, "GET", "/api/ai/credit")).moves;
  assert.deepEqual(
    bobMoves.map((m) => [m.amount, m.note ?? null]),
    [
      [1, null],
      [-2, null],
      [5, "Thanks for the bug report"],
    ],
  );
  let detail = await json<{ user: Listed; ledger: { kind: string; amount: number; note: string | null; by: string | null }[]; daysActive: number; lastVisit: Record<string, string> | null }>(
    admin,
    "GET",
    `/api/admin/users/${bobId}`,
  );
  assert.equal(detail.user.credit, 4);
  assert.equal(detail.user.granted, 4);
  assert.equal(detail.ledger[2].by, "admin@example.com");
  assert.equal(detail.daysActive, 1);
  assert.deepEqual(detail.lastVisit, { device: "desktop", browser: "Firefox", os: "Windows", country: "FR" });

  // ---- Rodeo Plus ------------------------------------------------------------------
  detail = await json(admin, "POST", `/api/admin/users/${bobId}/plus`, { months: 1 });
  assert.equal(detail.user.plan, "supporter");
  assert.equal(detail.user.paidPlus, false);
  const until1 = Date.parse(detail.user.supporterUntil!);
  assert.ok(Math.abs(until1 - Date.now() - 30.5 * 86_400_000) < 2 * 86_400_000, "about a month");
  assert.equal((await json<{ user: { plan: string } }>(bob, "GET", "/api/me")).user.plan, "supporter");
  detail = await json(admin, "POST", `/api/admin/users/${bobId}/plus`, { months: 12 });
  assert.ok(Date.parse(detail.user.supporterUntil!) - until1 > 360 * 86_400_000, "a year more, on top of the month");
  assert.equal((await json<Overview>(admin, "GET", "/api/admin/overview")).accounts.plus, 1);
  assert.equal((await call(admin, "POST", `/api/admin/users/${bobId}/plus`, { months: 1.5 })).status, 400);
  detail = await json(admin, "POST", `/api/admin/users/${bobId}/plus`, { months: 0 });
  assert.equal(detail.user.plan, "free");

  // ---- suspend, sign out -----------------------------------------------------------
  assert.equal((await call(admin, "POST", `/api/admin/users/${adminId}/suspend`, { suspended: true })).status, 400, "not an admin");
  detail = await json(admin, "POST", `/api/admin/users/${bobId}/suspend`, { suspended: true });
  assert.equal(detail.user.suspended, true);
  assert.equal((await json<{ user: unknown }>(bob, "GET", "/api/me")).user, null, "signed out");
  assert.equal(await signIn("bob@example.com"), "", "and can't sign in again");
  assert.equal((await json<Overview>(admin, "GET", "/api/admin/overview")).accounts.suspended, 1);
  assert.equal((await json<Page>(admin, "GET", "/api/admin/users?filter=suspended")).total, 1);
  await json(admin, "POST", `/api/admin/users/${bobId}/suspend`, { suspended: false });
  const bob2 = await signIn("bob@example.com");
  assert.ok(bob2, "let back in");
  assert.equal((await json<{ user: { email: string } }>(bob2, "GET", "/api/me")).user.email, "bob@example.com");
  await json(admin, "POST", `/api/admin/users/${bobId}/sign-out`);
  assert.equal((await json<{ user: unknown }>(bob2, "GET", "/api/me")).user, null, "signed out everywhere");

  // ---- CSV -------------------------------------------------------------------------
  assert.equal((await call(carol, "PATCH", "/api/me", { name: "=HYPERLINK(\"x\")" })).status, 200);
  const csv = await call(admin, "GET", "/api/admin/users.csv");
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get("content-type") ?? "", /text\/csv/);
  const text = await csv.text();
  assert.ok(text.startsWith("email,name,joined,"));
  assert.ok(text.includes(`carol@example.com,"'=HYPERLINK(""x"")"`), "a formula is never a formula");
  assert.equal(text.trim().split("\r\n").length, 5);

  // ---- delete ----------------------------------------------------------------------
  assert.equal((await call(admin, "DELETE", `/api/admin/users/${carolId}`, { email: "bob@example.com" })).status, 400, "the email must be the account's");
  assert.equal((await call(admin, "DELETE", `/api/admin/users/${adminId}`, { email: "admin@example.com" })).status, 400, "not an admin");
  assert.equal((await call(admin, "DELETE", `/api/admin/users/${carolId}`, { email: "Carol@Example.com " })).status, 204);
  assert.equal((await json<{ user: unknown }>(carol, "GET", "/api/me")).user, null);
  assert.equal((await json<Page>(admin, "GET", "/api/admin/users")).total, 3);
  assert.equal((await call(admin, "GET", `/api/admin/users/${carolId}`)).status, 404);

  console.log("admin: all checks passed");
} catch (e) {
  console.error(e);
  console.error(log.split("\n").slice(-30).join("\n"));
  process.exitCode = 1;
} finally {
  server.kill();
  rmSync(data, { recursive: true, force: true });
}
