// What this server offers (GET /api/config), and the admin-set funding, sponsor and
// announcements (kept in the settings table; funding falls back to the FUNDING_* environment
// variables).

import type { Hono } from "hono";
import type { Announcement, Funding, FundingLink, ServerConfig, Sponsor } from "../../web/src/platform/protocol.ts";
import { logAdmin } from "./adminLog.ts";
import { isAdmin, requireUser, type UserRow } from "./auth.ts";
import { config, type Provider } from "./config.ts";
import { creditTerms } from "./credit.ts";
import { renderTerms } from "./render.ts";
import { voiceTerms } from "./voice.ts";
import { imageTerms } from "./image.ts";
import { get, run } from "./db.ts";
import { readJson, readJsonAny } from "./http.ts";
import { cleanBody, cleanLine, fail, newId, nowIso } from "./util.ts";

export function setting<T>(key: string): T | null {
  const row = get<{ value_json: string }>("SELECT value_json FROM settings WHERE key = ?", key);
  return row ? (JSON.parse(row.value_json) as T) : null;
}

export function saveSetting(key: string, value: unknown): void {
  run("INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json", key, JSON.stringify(value));
}

/** The donations through the Stripe donation link in a month: their total in minor units, and the
 * Checkout sessions counted (Stripe sends an event again when it is not sure it arrived). */
interface DonationTally {
  readonly month: string;
  readonly currency: string;
  readonly amount: number;
  readonly sessions: readonly string[];
}

/** This calendar month in UTC, as "2026-11". */
const thisMonth = (): string => new Date().toISOString().slice(0, 7);

/**
 * Adds a paid donation (Checkout session `id`, `amount` in minor units) to this month's total, which
 * starts again each month. False when it was counted already or is in another currency.
 */
export function recordDonation(id: string, amount: number, paidIn: string): boolean {
  const month = thisMonth();
  const currency = paidIn.toLowerCase();
  const kept = setting<DonationTally>("donations");
  const tally = kept && kept.month === month ? kept : { month, currency, amount: 0, sessions: [] };
  if (tally.sessions.includes(id)) return false;
  if (tally.currency !== currency) {
    console.error(`[billing] donation ${id} was paid in ${currency}, not ${tally.currency}: add it to Raised elsewhere by hand`);
    return false;
  }
  saveSetting("donations", { month, currency, amount: tally.amount + amount, sessions: [...tally.sessions, id] });
  return true;
}

export function fundingNow(): Funding | null {
  const funding = setting<Funding>("funding") ?? config.fundingEnv;
  if (!funding) return null;
  const tally = setting<DonationTally>("donations");
  const counted = tally && tally.month === thisMonth() && tally.currency === funding.currency.toLowerCase();
  // amounts in pence or cents: a hundredth of the currency
  return { ...funding, donatedThisMonth: counted ? tally.amount / 100 : 0 };
}

export function sponsorNow(): Sponsor | null {
  return setting<Sponsor>("sponsor");
}

const newestFirst = (a: Announcement, b: Announcement): number => Date.parse(b.date) - Date.parse(a.date);

/** The start screen's announcements, newest first. */
export function announcementsNow(): Announcement[] {
  return (setting<Announcement[]>("announcements") ?? []).sort(newestFirst);
}

function httpUrl(v: unknown, what: string): string {
  if (typeof v !== "string" || v.length > 500 || !/^https?:\/\/\S+$/.test(v)) fail(400, `${what} must be a web address (http or https)`);
  return v;
}

function num(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000_000) fail(400, `${what} must be a number`);
  return v;
}

function parseFunding(v: Record<string, unknown>): Funding {
  const currency = cleanLine(v.currency, 8) || "GBP";
  const rawLinks: unknown = v.links ?? [];
  if (!Array.isArray(rawLinks) || rawLinks.length > 10) fail(400, "links must be a list of up to 10 links");
  const links: FundingLink[] = rawLinks.map((l: unknown) => {
    const link = (typeof l === "object" && l !== null ? l : {}) as Record<string, unknown>;
    const label = cleanLine(link.label, 60);
    if (!label) fail(400, "Every link needs a label");
    return { label, url: httpUrl(link.url, "A link") };
  });
  return {
    currency,
    goalMonthly: num(v.goalMonthly, "goalMonthly"),
    raisedThisMonth: num(v.raisedThisMonth, "raisedThisMonth"),
    links,
  };
}

function parseSponsor(v: Record<string, unknown>): Sponsor {
  const name = cleanLine(v.name, 80);
  if (!name) fail(400, "The sponsor needs a name");
  const image = v.image === undefined || v.image === null || v.image === "" ? null : httpUrl(v.image, "The sponsor's picture");
  return {
    id: cleanLine(v.id, 64) || newId(),
    name,
    text: cleanLine(v.text, 300),
    url: httpUrl(v.url, "The sponsor's link"),
    image,
    cta: cleanLine(v.cta, 24) || "Visit",
  };
}

/** Text over lines: line breaks kept, at most two in a row, at most `max` characters. */
function cleanText(v: unknown, max: number): string {
  return cleanBody(v, max).replace(/\n{3,}/g, "\n\n");
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an announcement's bar across the editor runs out: null for none, else no more than 60 days from now. */
function barUntil(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const until = typeof v === "string" ? Date.parse(v) : NaN;
  if (Number.isNaN(until)) fail(400, "The bar's end must be a date");
  if (until > Date.now() + 60 * DAY_MS) fail(400, "The bar can run for 60 days at most");
  return new Date(until).toISOString();
}

function parseAnnouncement(v: unknown): Announcement {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(400, "Each announcement must be an object");
  const a = v as Record<string, unknown>;
  const title = cleanLine(a.title, 100);
  if (!title) fail(400, "Every announcement needs a title");
  const url = a.url === undefined || a.url === null || a.url === "" ? null : httpUrl(a.url, "An announcement's link");
  const posted = typeof a.date === "string" ? Date.parse(a.date) : NaN;
  return {
    id: cleanLine(a.id, 64) || newId(),
    title,
    body: cleanText(a.body, 1000),
    url,
    date: Number.isNaN(posted) ? nowIso() : new Date(posted).toISOString(),
    bannerUntil: barUntil(a.bannerUntil),
  };
}

/** Logs what an admin changed in the announcements: posted, deleted, or edited ones (by title). */
function logAnnouncementChanges(admin: UserRow, before: readonly Announcement[], after: readonly Announcement[]): void {
  const old = new Map(before.map((a) => [a.id, a]));
  const kept = new Set(after.map((a) => a.id));
  for (const a of after) {
    const prev = old.get(a.id);
    if (!prev) logAdmin(admin, "announcement.post", a.title);
    else if (
      prev.title !== a.title ||
      prev.body !== a.body ||
      prev.url !== a.url ||
      prev.date !== a.date ||
      (prev.bannerUntil ?? null) !== (a.bannerUntil ?? null)
    ) {
      logAdmin(admin, "announcement.edit", a.title);
    }
  }
  for (const a of before) if (!kept.has(a.id)) logAdmin(admin, "announcement.delete", a.title);
}

export function registerSettings(app: Hono): void {
  app.get("/api/config", (c) => {
    const body: ServerConfig = {
      version: config.version,
      auth: {
        email: config.emailAuth,
        oauth: (Object.keys(config.oauth) as Provider[]).filter((p) => config.oauth[p] !== undefined),
      },
      billing: config.stripe !== null,
      collab: true,
      drives: config.drives,
      funding: fundingNow(),
      sponsor: sponsorNow(),
      carbon: config.carbon,
      announcements: announcementsNow(),
      plans: {
        free: config.limits.free,
        supporter: { ...config.limits.supporter, monthly: config.labels.monthly, yearly: config.labels.yearly },
      },
      ai: config.ai ? { planner: config.ai.planner, worker: config.ai.worker, models: config.ai.models, credit: creditTerms() } : null,
      credit: creditTerms(),
      render: renderTerms(),
      voice: voiceTerms(),
      image: imageTerms(),
      maxUploadBytes: config.maxUploadBytes,
    };
    return c.json(body);
  });

  app.put("/api/admin/funding", async (c) => {
    const user = requireUser(c);
    if (!isAdmin(user)) fail(403, "Only admins can change funding", "forbidden");
    const funding = parseFunding(await readJson(c));
    saveSetting("funding", funding);
    logAdmin(user, "funding.save", null, `goal ${funding.goalMonthly} ${funding.currency}`);
    return c.json({ funding });
  });

  // PUT with null takes the sponsor card down.
  app.put("/api/admin/sponsor", async (c) => {
    const user = requireUser(c);
    if (!isAdmin(user)) fail(403, "Only admins can change the sponsor", "forbidden");
    const value = await readJsonAny(c);
    const before = sponsorNow();
    if (value === null) {
      run("DELETE FROM settings WHERE key = 'sponsor'");
      logAdmin(user, "sponsor.clear", before?.name ?? null);
      return c.json({ sponsor: null });
    }
    if (typeof value !== "object" || Array.isArray(value)) fail(400, "The sponsor must be an object or null");
    const sponsor = parseSponsor(value as Record<string, unknown>);
    saveSetting("sponsor", sponsor);
    logAdmin(user, "sponsor.save", sponsor.name);
    return c.json({ sponsor });
  });

  // The whole list: the editor sends it again after each post, edit or delete.
  app.put("/api/admin/announcements", async (c) => {
    const user = requireUser(c);
    if (!isAdmin(user)) fail(403, "Only admins can change the announcements", "forbidden");
    const value = await readJsonAny(c);
    if (!Array.isArray(value)) fail(400, "The announcements must be a list");
    if (value.length > 20) fail(400, "There can be at most 20 announcements");
    const before = announcementsNow();
    const announcements = value.map(parseAnnouncement).sort(newestFirst);
    saveSetting("announcements", announcements);
    logAnnouncementChanges(user, before, announcements);
    return c.json({ announcements });
  });
}
