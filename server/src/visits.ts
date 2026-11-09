// Visits: how many people use the editor, signed in or not, for the admin page (admin.ts). The
// editor says when it opens (POST /api/visits, event "visit"), each minute while it is in front
// ("ping"), when a drawing opens ("open", with its kind), and how the check after a file comes in
// was answered ("check", with the answer and the file's kind) (web/src/app/visits.ts).
//
// No cookie, and nothing kept on the visitor's device: the server knows a visitor by a hash of
// their address and browser with a salt that changes each day and is then forgotten, so the same
// person counts once a day and can't be followed from one day to the next. The address itself is
// never kept. Each visitor has one row a day: when they came and were last heard of, how they
// came (the site that linked them, a campaign tag, a share link), their country (Cloudflare's
// CF-IPCountry), roughly where (the city, region and a position rounded to 0.1°, when Cloudflare's
// "Add visitor location headers" transform is on), and their kind of device, browser and system.
// A signed-in visitor's row names the account, and the account's last_seen_at moves on.

import type { Context, Hono } from "hono";
import type { VisitEntry } from "../../web/src/platform/protocol.ts";
import { allowed, clientIp, currentUser, isAdmin } from "./auth.ts";
import { run } from "./db.ts";
import { readJson } from "./http.ts";
import { saveSetting, setting } from "./settings.ts";
import { cleanLine, DAY, HOUR, inMs, MINUTE, newToken, nowIso, sha256Hex } from "./util.ts";

const ENTRIES: readonly VisitEntry[] = ["editor", "share", "invite", "embed", "app", "convert"];
const DEVICES = ["phone", "tablet", "desktop"] as const;
/** how the check after a file comes in went: shown, shown for a file that failed, then the answer */
const CHECK_ANSWERS: readonly string[] = ["asked", "failed", "ok", "report", "closed"];
/** how often a signed-in account's last_seen_at is written, at most */
const SEEN_EVERY = 5 * MINUTE;
/** visits kept, for comparing a month with the same one a year before */
const KEEP_DAYS = 400;

let salt: { day: string; salt: string } | null = null;

/** Today's salt; a new one each day (UTC), kept in the settings so a restart doesn't split a day. */
function saltOf(day: string): string {
  if (salt?.day === day) return salt.salt;
  const kept = setting<{ day: string; salt: string }>("visit_salt");
  salt = kept?.day === day ? kept : { day, salt: newToken() };
  if (salt !== kept) saveSetting("visit_salt", salt);
  return salt.salt;
}

/** Crawlers and test browsers, which the editor's own check (navigator.webdriver) may miss. */
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|java\//i;

export function browserOf(ua: string): string {
  if (/Edg(e|A|iOS)?\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser\//.test(ua)) return "Samsung Internet";
  if (/Firefox\/|FxiOS\//.test(ua)) return "Firefox";
  if (/Chrome\/|CriOS\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

export function osOf(ua: string): string {
  if (/iPad/.test(ua)) return "iPadOS";
  if (/iPhone|iPod/.test(ua)) return "iOS";
  if (/Android/.test(ua)) return "Android";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Linux/.test(ua)) return "Linux";
  return "Other";
}

/** "news.ycombinator.com", "google.com": the host a visitor came from, without www. and the like. */
export function referrerOf(v: unknown, ownHost: string): string | null {
  const host = cleanLine(v, 120)
    .toLowerCase()
    .replace(/^(www|m|l|lm|mobile)\./, "");
  if (!host || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host === ownHost.replace(/^www\./, "")) return null;
  return host;
}

/** A two-letter country, or null for Cloudflare's unknown (XX) and Tor (T1). */
function countryOf(c: Context): string | null {
  const v = (c.req.header("cf-ipcountry") ?? "").toUpperCase();
  return /^[A-Z]{2}$/.test(v) && v !== "XX" && v !== "T1" ? v : null;
}

/**
 * A header Cloudflare filled with a place name: its UTF-8 arrives as Latin-1 characters (Node reads
 * headers so), and some names come percent-encoded.
 */
function placeName(c: Context, header: string): string | null {
  let v = c.req.header(header) ?? "";
  if (!v) return null;
  try {
    if (/%[0-9A-Fa-f]{2}/.test(v)) v = decodeURIComponent(v);
    else if (/[\x80-\xff]/.test(v)) {
      const utf8 = Buffer.from(v, "latin1").toString("utf8");
      if (!utf8.includes("\ufffd")) v = utf8;
    }
  } catch {
    // kept as it came
  }
  return cleanLine(v, 60) || null;
}

/** Cloudflare's rough position for the visitor, rounded to 0.1° (about 10 km), or null. */
function positionOf(c: Context): { lat: number; lon: number } | null {
  const lat = Number(c.req.header("cf-iplatitude"));
  const lon = Number(c.req.header("cf-iplongitude"));
  if (!c.req.header("cf-iplatitude") || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 };
}

function bump(day: string, name: string): void {
  run("INSERT INTO visit_counts (day, name, count) VALUES (?, ?, 1) ON CONFLICT(day, name) DO UPDATE SET count = count + 1", day, name);
}

/** Drops visits older than KEEP_DAYS (housekeeping). */
export function pruneVisits(): void {
  const cutoff = inMs(-KEEP_DAYS * DAY).slice(0, 10);
  run("DELETE FROM visits WHERE day < ?", cutoff);
  run("DELETE FROM visit_counts WHERE day < ?", cutoff);
}

export function registerVisits(app: Hono): void {
  app.post("/api/visits", async (c) => {
    const ua = c.req.header("user-agent") ?? "";
    const ip = clientIp(c);
    // nothing to tell the editor either way: it never waits on this
    if (!ua || BOT.test(ua) || !allowed(`visit:${ip}`, 600, HOUR)) return c.body(null, 204);
    const body = await readJson(c, 4 * 1024);
    const event = body.event;
    if (event !== "visit" && event !== "ping" && event !== "open" && event !== "check") return c.body(null, 204);

    const now = nowIso();
    const day = now.slice(0, 10);
    const visitor = sha256Hex(`${saltOf(day)}\n${ip}\n${ua}`).slice(0, 24);
    const user = currentUser(c);
    const device = DEVICES.includes(body.device as (typeof DEVICES)[number]) ? (body.device as string) : "desktop";
    const entry = ENTRIES.includes(body.entry as VisitEntry) ? (body.entry as VisitEntry) : "editor";
    const host = (c.req.header("host") ?? "").toLowerCase().replace(/:\d+$/, "");
    const campaign = cleanLine(body.campaign, 60).toLowerCase() || null;

    // the day's first word from this visitor makes the row (a ping too: a tab open past midnight);
    // later ones move it on, and name the account once they have signed in
    const at = positionOf(c);
    run(
      `INSERT INTO visits (day, visitor, user_id, first_at, last_at, pings, opens, entry, referrer, campaign, country, device, browser, os, city, region, lat, lon)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(day, visitor) DO UPDATE SET
         last_at = excluded.last_at,
         user_id = COALESCE(excluded.user_id, visits.user_id),
         pings = visits.pings + excluded.pings,
         opens = visits.opens + excluded.opens,
         city = COALESCE(visits.city, excluded.city),
         region = COALESCE(visits.region, excluded.region),
         lat = COALESCE(visits.lat, excluded.lat),
         lon = COALESCE(visits.lon, excluded.lon)`,
      day,
      visitor,
      user?.id ?? null,
      now,
      now,
      event === "ping" ? 1 : 0,
      event === "open" ? 1 : 0,
      entry,
      event === "visit" ? referrerOf(body.referrer, host) : null,
      event === "visit" ? campaign : null,
      countryOf(c),
      device,
      browserOf(ua),
      osOf(ua),
      placeName(c, "cf-ipcity"),
      placeName(c, "cf-region"),
      at?.lat ?? null,
      at?.lon ?? null,
    );
    // the admins' own visits are left out of the numbers (admin.ts), and so are their counts
    const counted = !user || !isAdmin(user);
    if (counted && event === "visit") bump(day, "loads");
    const format = cleanLine(body.format, 12).toLowerCase().replace(/[^a-z0-9]/g, "") || "other";
    if (counted && event === "open") bump(day, `open:${format}`);
    if (counted && event === "check" && CHECK_ANSWERS.includes(body.answer as string)) bump(day, `check:${body.answer as string}:${format}`);
    if (user) {
      run("UPDATE users SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)", now, user.id, inMs(-SEEN_EVERY));
    }
    return c.body(null, 204);
  });
}
