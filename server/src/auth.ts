// Accounts and sign-in: sessions (cookie ovx_session, the token stored as a hash), email
// sign-in links, OAuth (Google, Microsoft, GitHub) with PKCE, and the user helpers.

import { getConnInfo } from "@hono/node-server/conninfo";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { CookieOptions } from "hono/utils/cookie";
import type { Limits, Plan, User } from "../../web/src/platform/protocol.ts";
import type { CollabUser } from "./collab.ts";
import { config, type OAuthApp, type Provider } from "./config.ts";
import { get, run, tx } from "./db.ts";
import { readJson } from "./http.ts";
import { sendMail } from "./mail.ts";
import { cleanLine, DAY, fail, HOUR, inMs, MINUTE, newId, newToken, nowIso, safePath, sha256Hex, signedInPath } from "./util.ts";

export const SESSION_COOKIE = "ovx_session";
const SESSION_MS = 30 * DAY;
const OAUTH_COOKIE = "ovx_oauth";
const OAUTH_PATH = "/api/auth/oauth";

/** A users row. */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  created_at: string;
  plan: string;
  supporter_until: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  /** AI credit, millionths of the credit's currency (credit.ts) */
  ai_credit: number;
  /** when the editor last heard from the account (visits.ts), at most a few minutes out */
  last_seen_at: string | null;
  /** set by an admin: the account can't sign in, and its sessions are gone */
  suspended_at: string | null;
}

export function planOf(row: { supporter_until: string | null }): Plan {
  return row.supporter_until !== null && Date.parse(row.supporter_until) > Date.now() ? "supporter" : "free";
}

export function limitsFor(plan: Plan): Limits {
  return plan === "supporter" ? config.limits.supporter : config.limits.free;
}

export function limitsOf(row: { supporter_until: string | null }): Limits {
  return limitsFor(planOf(row));
}

/** Drawings the user owns, and the bytes of every version of them. */
export function usageOf(userId: string): { files: number; bytes: number } {
  const row = get<{ files: number; bytes: number }>(
    `SELECT COUNT(*) AS files,
       COALESCE((SELECT SUM(v.size) FROM versions v JOIN files f ON f.id = v.file_id WHERE f.owner_id = ?), 0) AS bytes
     FROM files WHERE owner_id = ?`,
    userId,
    userId,
  );
  return { files: row?.files ?? 0, bytes: row?.bytes ?? 0 };
}

/** Admins are the accounts listed in ADMIN_EMAILS. */
export function isAdmin(row: UserRow): boolean {
  return config.admins.has(row.email);
}

export function userOut(row: UserRow): User {
  const plan = planOf(row);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    plan,
    supporterUntil: plan === "supporter" ? row.supporter_until : null,
    usage: usageOf(row.id),
    limits: limitsFor(plan),
    admin: isAdmin(row),
    aiCredit: config.credit ? row.ai_credit / 1_000_000 : null,
  };
}

function cookieOptions(maxAge: number): CookieOptions {
  return { path: "/", httpOnly: true, sameSite: "Lax", secure: config.secureCookies, maxAge };
}

/** Starts a session for the user and sets its cookie. */
export function startSession(c: Context, userId: string): void {
  const token = newToken();
  const now = nowIso();
  run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256Hex(token), userId, now, inMs(SESSION_MS));
  setCookie(c, SESSION_COOKIE, token, cookieOptions(SESSION_MS / 1000));
}

/** The signed-in user (sliding 30-day session), or null. */
export function currentUser(c: Context): UserRow | null {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = get<UserRow & { expires_at: string }>(
    "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    sha256Hex(token),
  );
  if (!row || row.suspended_at !== null) return null;
  const left = Date.parse(row.expires_at) - Date.now();
  if (left <= 0) {
    run("DELETE FROM sessions WHERE token_hash = ?", sha256Hex(token));
    return null;
  }
  if (left < SESSION_MS - DAY) {
    run("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", inMs(SESSION_MS), sha256Hex(token));
    setCookie(c, SESSION_COOKIE, token, cookieOptions(SESSION_MS / 1000));
  }
  return row;
}

export function requireUser(c: Context): UserRow {
  const user = currentUser(c);
  if (!user) fail(401, "Sign in to continue", "auth");
  return user;
}

export function signOut(c: Context): void {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256Hex(token));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** The cookie value of a name in a Cookie header. */
export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** The signed-in user of a WebSocket upgrade request (the collaboration socket). */
export function userFromRequest(req: IncomingMessage): CollabUser | null {
  const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
  if (!token) return null;
  const row = get<UserRow & { expires_at: string }>(
    "SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    sha256Hex(token),
  );
  if (!row || row.suspended_at !== null || Date.parse(row.expires_at) <= Date.now()) return null;
  return { id: row.id, name: row.name, avatarUrl: row.avatar_url };
}

export interface SignIn {
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly provider?: Provider;
  readonly subject?: string;
}

const newUserHooks: ((user: UserRow) => void)[] = [];

/** Calls `fn` with each account as it is made, just after (welcome credit, admin.ts). */
export function onNewUser(fn: (user: UserRow) => void): void {
  newUserHooks.push(fn);
}

/**
 * Finds the user a sign-in belongs to (by provider identity, else by email), or creates one.
 * Throws a 403 for an account an admin has suspended.
 */
export function signInUser(s: SignIn): UserRow {
  let created = false;
  const user = tx(() => findOrCreateUser(s, () => (created = true)));
  if (user.suspended_at !== null) fail(403, "This account is suspended", "suspended");
  if (created) {
    for (const fn of newUserHooks) {
      try {
        fn(user);
      } catch (e) {
        console.error("[auth] a new-account step failed:", e);
      }
    }
  }
  return user;
}

function findOrCreateUser(s: SignIn, onCreate: () => void): UserRow {
  if (s.provider && s.subject) {
    const linked = get<UserRow>(
      "SELECT u.* FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?",
      s.provider,
      s.subject,
    );
    if (linked) return linked;
  }
  let user = get<UserRow>("SELECT * FROM users WHERE email = ?", s.email);
  if (!user) {
    onCreate();
    const id = newId();
    run(
      "INSERT INTO users (id, email, name, avatar_url, created_at, plan) VALUES (?, ?, ?, ?, ?, 'free')",
      id,
      s.email,
      cleanLine(s.name, 80) || localPart(s.email),
      s.avatarUrl,
      nowIso(),
    );
    user = get<UserRow>("SELECT * FROM users WHERE id = ?", id);
  }
  if (!user) fail(500, "The account could not be created");
  if (s.provider && s.subject) {
    run("INSERT OR IGNORE INTO identities (provider, subject, user_id) VALUES (?, ?, ?)", s.provider, s.subject, user.id);
  }
  return user;
}

export function normalizeEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
}

export function localPart(email: string): string {
  return email.split("@")[0] || "Member";
}

// ---- rate limits (in memory) ----

const hits = new Map<string, number[]>();

/** Counts a hit on `key`; false once it has had `max` hits within `windowMs`. */
export function allowed(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  const ok = recent.length < max;
  if (ok) recent.push(now);
  hits.set(key, recent);
  return ok;
}

export function pruneRateLimits(): void {
  const now = Date.now();
  for (const [key, list] of hits) {
    const recent = list.filter((t) => now - t < HOUR);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
}

/**
 * The client's address: CLIENT_IP_HEADER when it is set and present, else the rightmost
 * X-Forwarded-For entry (the proxy's view), else the socket's.
 */
export function clientIp(c: Context): string {
  const named = config.clientIpHeader ? c.req.header(config.clientIpHeader)?.split(",")[0]?.trim() : undefined;
  if (named) return named;
  const xff = c.req.header("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ---- OAuth providers ----

interface ProviderSpec {
  readonly authUrl: string;
  readonly tokenUrl: string;
  readonly userUrl: string;
  readonly scope: string;
}

const SPECS: Record<Provider, ProviderSpec> = {
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
    scope: "openid email profile",
  },
  microsoft: {
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    userUrl: "https://graph.microsoft.com/oidc/userinfo",
    scope: "openid email profile",
  },
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    userUrl: "https://api.github.com/user",
    scope: "read:user user:email",
  },
};

function isProvider(v: string): v is Provider {
  return v === "google" || v === "microsoft" || v === "github";
}

function callbackUrl(p: Provider): string {
  return `${config.publicUrl}/api/auth/oauth/${p}/callback`;
}

interface OAuthProfile {
  readonly subject: string;
  readonly email: string;
  readonly name: string;
  readonly avatarUrl: string | null;
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return (await res.json()) as T;
}

/** Trades the code for a token and reads who signed in. */
async function exchangeCode(p: Provider, app: OAuthApp, code: string, verifier: string): Promise<OAuthProfile> {
  const spec = SPECS[p];
  const tok = await fetchJson<{ access_token?: string }>(spec.tokenUrl, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code,
      redirect_uri: callbackUrl(p),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
  });
  if (!tok.access_token) throw new Error(`${p} sent no access token`);
  const bearer = { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" };

  if (p === "github") {
    const gh = { ...bearer, Accept: "application/vnd.github+json", "User-Agent": "openvwx" };
    const user = await fetchJson<{ id: number; login: string; name: string | null; avatar_url: string | null }>(spec.userUrl, { headers: gh });
    const emails = await fetchJson<{ email: string; primary: boolean; verified: boolean }[]>("https://api.github.com/user/emails", { headers: gh });
    const pick = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    if (!pick) throw new Error("GitHub gave no verified email address");
    return { subject: String(user.id), email: pick.email, name: user.name || user.login, avatarUrl: user.avatar_url };
  }
  if (p === "google") {
    const u = await fetchJson<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(spec.userUrl, { headers: bearer });
    if (!u.email || u.email_verified !== true) throw new Error("Google gave no verified email address");
    return { subject: u.sub, email: u.email, name: u.name ?? "", avatarUrl: u.picture ?? null };
  }
  const u = await fetchJson<{ sub: string; email?: string; name?: string }>(spec.userUrl, { headers: bearer });
  if (!u.email) throw new Error("Microsoft gave no email address");
  return { subject: u.sub, email: u.email, name: u.name ?? "", avatarUrl: null };
}

// ---- routes ----

export function registerAuth(app: Hono): void {
  // Email sign-in: a link valid for 15 minutes, single use.
  app.post("/api/auth/email", async (c) => {
    if (!config.emailAuth) fail(404, "Email sign-in is not set up on this server", "not_found");
    const body = await readJson(c);
    const email = normalizeEmail(body.email);
    if (!email) fail(400, "Enter a valid email address");
    const redirect = safePath(body.redirect);
    if (!allowed(`email:${email}`, 5, HOUR) || !allowed(`ip:${clientIp(c)}`, 20, HOUR)) {
      fail(429, "Too many sign-in links requested. Try again later.", "rate_limited");
    }
    const token = newToken();
    run(
      "INSERT INTO magic_links (token_hash, email, redirect, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      sha256Hex(token),
      email,
      redirect,
      nowIso(),
      inMs(15 * MINUTE),
    );
    const link = `${config.publicUrl}/api/auth/email/callback?token=${token}`;
    await sendMail(
      email,
      "Your Rodeo sign-in link",
      `Sign in to Rodeo:\n\n${link}\n\nThe link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.`,
    );
    return c.json({ ok: true });
  });

  app.get("/api/auth/email/callback", (c) => {
    const token = c.req.query("token") ?? "";
    const row = token ? get<{ token_hash: string; email: string; redirect: string; expires_at: string; used_at: string | null }>(
      "SELECT * FROM magic_links WHERE token_hash = ?",
      sha256Hex(token),
    ) : undefined;
    const now = nowIso();
    if (!row || row.used_at !== null || row.expires_at <= now) return c.redirect("/?signin=failed", 302);
    const used = run("UPDATE magic_links SET used_at = ? WHERE token_hash = ? AND used_at IS NULL", now, row.token_hash);
    if (used !== 1) return c.redirect("/?signin=failed", 302);
    let user: UserRow;
    try {
      user = signInUser({ email: row.email, name: localPart(row.email), avatarUrl: null });
    } catch {
      return c.redirect("/?signin=failed", 302);
    }
    startSession(c, user.id);
    return c.redirect(signedInPath(safePath(row.redirect)), 302);
  });

  // OAuth: the state and PKCE verifier wait in a short HttpOnly cookie.
  app.get("/api/auth/oauth/:provider", (c) => {
    const provider = c.req.param("provider");
    if (!isProvider(provider) || !config.oauth[provider]) fail(404, "That sign-in method is not set up", "not_found");
    const creds = config.oauth[provider] as OAuthApp;
    const state = newToken();
    const verifier = newToken();
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const redirect = safePath(c.req.query("redirect"));
    const saved = Buffer.from(JSON.stringify({ p: provider, s: state, v: verifier, r: redirect })).toString("base64url");
    setCookie(c, OAUTH_COOKIE, saved, { path: OAUTH_PATH, httpOnly: true, sameSite: "Lax", secure: config.secureCookies, maxAge: 600 });
    const spec = SPECS[provider];
    const url = new URL(spec.authUrl);
    url.searchParams.set("client_id", creds.clientId);
    url.searchParams.set("redirect_uri", callbackUrl(provider));
    if (provider !== "github") url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", spec.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return c.redirect(url.toString(), 302);
  });

  app.get("/api/auth/oauth/:provider/callback", async (c) => {
    const provider = c.req.param("provider");
    if (!isProvider(provider) || !config.oauth[provider]) fail(404, "That sign-in method is not set up", "not_found");
    const raw = getCookie(c, OAUTH_COOKIE);
    deleteCookie(c, OAUTH_COOKIE, { path: OAUTH_PATH });
    const failed = () => c.redirect("/?signin=failed", 302);
    if (c.req.query("error") || !raw) return failed();
    const code = c.req.query("code");
    const state = c.req.query("state");
    let saved: { p?: unknown; s?: unknown; v?: unknown; r?: unknown };
    try {
      saved = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as typeof saved;
    } catch {
      return failed();
    }
    if (!code || !state || saved.p !== provider || saved.s !== state || typeof saved.v !== "string") return failed();
    try {
      const profile = await exchangeCode(provider, config.oauth[provider] as OAuthApp, code, saved.v);
      const email = normalizeEmail(profile.email);
      if (!email) throw new Error("the provider's email address is not usable");
      const user = signInUser({
        email,
        name: cleanLine(profile.name, 80),
        avatarUrl: profile.avatarUrl,
        provider,
        subject: profile.subject,
      });
      startSession(c, user.id);
      return c.redirect(signedInPath(safePath(saved.r)), 302);
    } catch (e) {
      console.error(`[oauth ${provider}]`, e instanceof Error ? e.message : e);
      return failed();
    }
  });

  app.post("/api/auth/logout", (c) => {
    signOut(c);
    return c.body(null, 204);
  });
}
