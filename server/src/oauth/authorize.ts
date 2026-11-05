// The authorize and consent steps of Rodeo's OAuth sign-in. An agent app sends the person to
// /oauth/authorize; Rodeo checks the request, keeps it while the person signs in and presses Allow on
// the consent page, and then sends them back to the app with a one-time code. Waiting requests are
// kept in memory for half an hour: a restart only asks the person to connect again. Every form post
// checks the Origin, the browser that began the sign-in, the signed-in person and a csrf value before
// anything changes, and a refused post keeps the request, so a forged post can't cancel a sign-in.

import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { allowed, clientIp, currentUser, signOut, type UserRow } from "../auth.ts";
import { config } from "../config.ts";
import { MINUTE, newToken, safeEqual } from "../util.ts";
import { resolveClient } from "./clients.ts";
import { consentPage, errorPage, newNonce, pageHeaders, signInPage } from "./pages.ts";
import {
  BINDER_COOKIE,
  CHALLENGE_FORMAT,
  checkResource,
  type ClientLook,
  describeClient,
  hashOf,
  MAX_GRANTS,
  MAX_STATE,
  originOf,
  PENDING_TTL_MS,
  redirectMatches,
  resourceOf,
} from "./shared.ts";
import { createCode, grantCount } from "./tokens.ts";

/** The binder cookie's value: 32 random bytes as base64url. */
const BINDER_FORMAT = /^[A-Za-z0-9_-]{43}$/;
/** The largest form or JSON body the OAuth routes read: 16 KB. */
const MAX_BODY = 16 * 1024;
/** Sign-ins waiting at once; past this the oldest is dropped, so a stranger can't fill memory. */
const MAX_PENDING = 5_000;
/** Sign-ins one address (an IPv6 /64) may have waiting; past this its own oldest is dropped, so one
 * sender can't push everyone else's out of the cap above. */
const MAX_PENDING_PER_IP = 20;
/** The binder cookie lasts as long as a sign-in can wait. */
const BINDER_MAX_AGE_S = PENDING_TTL_MS / 1000;
const PROVIDER_LABELS: Record<string, string> = { google: "Google", microsoft: "Microsoft", github: "GitHub" };
const EXPIRED_TITLE = "This sign-in has expired";
const EXPIRED_TEXT = "It waited more than half an hour, or Rodeo restarted.";
const REFUSED_TITLE = "This page is out of date";
const REFUSED_TEXT = "Go back to the app and connect again.";

/** A sign-in the person is part way through: the app's request, and who has signed in so far. */
interface Pending {
  readonly id: string;
  /** the SHA-256 of the browser's binder cookie: the sign-in only goes on in the browser it began in */
  readonly binderHash: string;
  /** who started it (ipKeyOf), for the per-address cap */
  readonly ipKey: string;
  readonly clientId: string;
  /** how the app is shown on the consent page */
  readonly look: ClientLook;
  readonly redirectUri: string;
  readonly state: string | null;
  readonly challenge: string;
  readonly resource: string;
  /** checked on every consent post, so a post from another page can't allow the sign-in */
  readonly csrf: string;
  readonly createdAt: number;
  /** the person signed in on this request, or null until the consent page has seen them */
  userId: string | null;
}

/** Sign-ins waiting on the consent page, by id. Memory only: after a restart the apps connect again. */
const pending = new Map<string, Pending>();

/** The result of the checks on a consent post: the sign-in it is about, and the person who signed in. */
interface Checked {
  readonly p: Pending;
  readonly user: UserRow;
}

/** Sends an HTML page with the headers every OAuth page gets: a strict policy, no caching, no framing. */
function html(c: Context, status: ContentfulStatusCode, body: string, nonce: string): Response {
  for (const [name, value] of Object.entries(pageHeaders(nonce))) c.header(name, value);
  const res = c.html(body, status);
  // Hono writes the charset in capitals; the page contract is the lower-case form
  res.headers.set("Content-Type", "text/html; charset=utf-8");
  return res;
}

/** An error page for the person. Never a redirect: the app's address can't be trusted until it has been checked. */
export function errorTo(c: Context, status: ContentfulStatusCode, title: string, message: string): Response {
  const nonce = newNonce();
  return html(c, status, errorPage(nonce, title, message), nonce);
}

/** A request body read as text, or null when it is over 16 KB. The declared length is checked first, then the bytes. */
export async function bodyText(c: Context): Promise<string | null> {
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY) return null;
  const text = await c.req.text();
  return Buffer.byteLength(text) > MAX_BODY ? null : text;
}

/** The sign-in waiting under this id, or null: an unknown id, or one that has waited past its time. */
function waiting(id: string | null | undefined): Pending | null {
  if (!id) return null;
  const p = pending.get(id);
  if (!p) return null;
  if (Date.now() - p.createdAt > PENDING_TTL_MS) {
    pending.delete(id);
    return null;
  }
  return p;
}

/**
 * The address a sign-in is counted under: an IPv4 address as it is (an IPv4-mapped IPv6 one as its
 * IPv4 form), an IPv6 address as its /64, since one sender usually holds a whole /64.
 */
function ipKeyOf(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return mapped[1];
  if (!ip.includes(":")) return ip;
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** Keeps a sign-in until the person answers it, dropping the oldest when a cap is reached. */
function keep(p: Pending): void {
  let mine = 0;
  let myOldest: string | null = null;
  for (const [id, q] of pending) {
    if (q.ipKey !== p.ipKey) continue;
    mine++;
    myOldest ??= id;
  }
  if (mine >= MAX_PENDING_PER_IP && myOldest !== null) pending.delete(myOldest);
  if (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest !== undefined) pending.delete(oldest);
  }
  pending.set(p.id, p);
}

/** Drops the sign-ins that have waited past their time. */
export function prunePending(): void {
  const now = Date.now();
  for (const [id, p] of pending) {
    if (now - p.createdAt > PENDING_TTL_MS) pending.delete(id);
  }
}

/** Whether the browser sending this request is the one the sign-in began in, by its binder cookie. */
function sameBrowser(c: Context, p: Pending): boolean {
  const binder = getCookie(c, BINDER_COOKIE);
  return binder !== undefined && safeEqual(hashOf(binder), p.binderHash);
}

/** Whether a post's Origin, when it sends one, is this site: its own origin, or the host it was sent to (local runs). */
function sameSite(c: Context): boolean {
  const origin = c.req.header("origin");
  if (origin === undefined) return true;
  if (origin === originOf(config.publicUrl)) return true;
  const host = c.req.header("host");
  try {
    return host !== undefined && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** The checks every consent post passes before it can change anything: the site, the sign-in, the browser, the person and the csrf value. */
function checkPost(c: Context, form: URLSearchParams): Checked | Response {
  if (!sameSite(c)) return errorTo(c, 403, REFUSED_TITLE, REFUSED_TEXT);
  const p = waiting(form.get("request"));
  if (!p) return errorTo(c, 400, EXPIRED_TITLE, EXPIRED_TEXT);
  const user = currentUser(c);
  if (!sameBrowser(c, p) || !user || user.id !== p.userId || !safeEqual(form.get("csrf") ?? "", p.csrf)) {
    return errorTo(c, 403, REFUSED_TITLE, REFUSED_TEXT);
  }
  return { p, user };
}

/** The sign-in providers this server has set up, with the names their buttons use. */
function providers(): { id: string; label: string }[] {
  return Object.keys(config.oauth).map((id) => ({ id, label: PROVIDER_LABELS[id] ?? id }));
}

/** The app's address with the answer added: a code or an error, the state the app sent, and Rodeo's issuer (RFC 9207). */
function backTo(redirectUri: string, params: Record<string, string | null>): string {
  const u = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) {
    if (value !== null) u.searchParams.set(name, value);
  }
  u.searchParams.set("iss", originOf(config.publicUrl));
  return u.toString();
}

/** Adds the authorize and consent routes. The token, registration and metadata routes are in index.ts. */
export function registerAuthorize(app: Hono): void {
  app.get("/oauth/authorize", async (c) => {
    const ipKey = ipKeyOf(clientIp(c));
    if (!allowed(`oauth-authorize:${ipKey}`, 30, MINUTE)) {
      return errorTo(c, 429, "Too many sign-ins from here", "Wait a minute, then try again.");
    }
    const q = (name: string): string[] => c.req.queries(name) ?? [];
    // a parameter given twice can't be read safely: it is not clear which one is meant
    for (const name of ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state"]) {
      if (q(name).length > 1) {
        return errorTo(c, 400, "This link can't connect an app", `It gives “${name}” twice, so Rodeo can't tell which one is meant.`);
      }
    }
    const clientId = q("client_id")[0] ?? "";
    if (clientId === "") return errorTo(c, 400, "This link can't connect an app", "It doesn't say which app is asking.");
    const resolved = await resolveClient(clientId);
    if (!resolved.ok) return errorTo(c, 400, "This app can't connect", resolved.message);
    const client = resolved.client;

    // the redirect address is checked first: only after that may an error go back to the app
    const asked = q("redirect_uri")[0];
    let redirectUri: string;
    if (asked !== undefined) {
      if (!client.redirectUris.some((registered) => redirectMatches(registered, asked))) {
        return errorTo(c, 400, "This app can't connect", "It asked Rodeo to send you to an address it didn't register.");
      }
      redirectUri = asked;
    } else {
      if (client.redirectUris.length !== 1) return errorTo(c, 400, "This app can't connect", "It didn't say where to send you back to.");
      redirectUri = client.redirectUris[0];
    }

    const state = q("state")[0] ?? null;
    const look = describeClient(client.id, redirectUri, client.name);
    // An error goes back to the app only when Rodeo knows the app, or the address is on this
    // computer. Anyone can register an app, so sending everyone else's errors back before the
    // person has seen anything would make this an open redirect (RFC 9700 §4.11.2).
    const back = (error: string, description: string, withState = true): Response =>
      look.verified || look.local
        ? c.redirect(backTo(redirectUri, { error, error_description: description, state: withState ? state : null }), 302)
        : errorTo(c, 400, "This app can't connect", `It sent Rodeo a request Rodeo can't take (${error}: ${description}). Tell the app's makers.`);

    if ((q("response_type")[0] ?? "") !== "code") return back("unsupported_response_type", "Rodeo only supports response_type=code");
    const challenge = q("code_challenge")[0] ?? "";
    // a missing method counts as plain, which is refused
    const method = q("code_challenge_method")[0] ?? "plain";
    if (!CHALLENGE_FORMAT.test(challenge) || method !== "S256") return back("invalid_request", "PKCE with S256 is required");
    // a state too long to echo is refused, and not echoed back
    if (state !== null && state.length > MAX_STATE) return back("invalid_request", "state is too long", false);
    const resource = checkResource(q("resource"), config.publicUrl);
    if (resource === "bad") return back("invalid_target", "resource must be the Rodeo MCP endpoint");
    if (q("prompt").join(" ").split(/\s+/).includes("none")) {
      return back("interaction_required", "The person has to sign in to Rodeo and allow it");
    }

    let binder = getCookie(c, BINDER_COOKIE);
    if (binder === undefined || !BINDER_FORMAT.test(binder)) {
      binder = newToken();
      setCookie(c, BINDER_COOKIE, binder, { path: "/oauth", httpOnly: true, sameSite: "Lax", secure: config.secureCookies, maxAge: BINDER_MAX_AGE_S });
    }
    const id = newToken();
    keep({
      id,
      binderHash: hashOf(binder),
      ipKey,
      clientId: client.id,
      look,
      redirectUri,
      state,
      challenge,
      resource: resource ?? resourceOf(config.publicUrl),
      csrf: newToken(),
      createdAt: Date.now(),
      userId: null,
    });
    return c.redirect(`/oauth/consent?request=${id}`, 302);
  });

  app.get("/oauth/consent", (c) => {
    const p = waiting(c.req.query("request"));
    if (!p) return errorTo(c, 400, EXPIRED_TITLE, EXPIRED_TEXT);
    if (!sameBrowser(c, p)) {
      return errorTo(c, 400, "This sign-in started in another browser", "Go back to the app and connect again from this browser.");
    }
    const nonce = newNonce();
    const user = currentUser(c);
    if (!user) {
      return html(c, 200, signInPage({ nonce, requestId: p.id, app: p.look, providers: providers(), email: config.emailAuth }), nonce);
    }
    p.userId = user.id;
    return html(
      c,
      200,
      consentPage({ nonce, requestId: p.id, csrf: p.csrf, app: p.look, user: { name: user.name, email: user.email } }),
      nonce,
    );
  });

  app.post("/oauth/consent", async (c) => {
    if (!allowed(`oauth-consent:${clientIp(c)}`, 30, MINUTE)) {
      return errorTo(c, 429, "Too many answers from here", "Wait a minute, then try again.");
    }
    const text = await bodyText(c);
    if (text === null) return errorTo(c, 413, "This form is too large", REFUSED_TEXT);
    const form = new URLSearchParams(text);
    const checked = checkPost(c, form);
    if (checked instanceof Response) return checked;
    const { p, user } = checked;
    // the request is used up whatever the answer, so a second post finds nothing
    pending.delete(p.id);
    const decision = form.get("decision");
    if (decision === "deny") {
      return c.redirect(
        backTo(p.redirectUri, { error: "access_denied", error_description: "The person didn't allow it", state: p.state }),
        303,
      );
    }
    if (decision !== "allow") return errorTo(c, 400, REFUSED_TITLE, REFUSED_TEXT);
    if (grantCount(user.id) >= MAX_GRANTS) {
      return errorTo(c, 409, `You have ${MAX_GRANTS} connected apps`, "Remove some in Window › Connect an Agent… in Rodeo, then connect again.");
    }
    const code = createCode({
      userId: user.id,
      clientId: p.clientId,
      clientName: p.look.name,
      redirectUri: p.redirectUri,
      challenge: p.challenge,
      resource: p.resource,
    });
    return c.redirect(backTo(p.redirectUri, { code, state: p.state }), 303);
  });

  app.post("/oauth/consent/signout", async (c) => {
    if (!allowed(`oauth-consent:${clientIp(c)}`, 30, MINUTE)) {
      return errorTo(c, 429, "Too many answers from here", "Wait a minute, then try again.");
    }
    const text = await bodyText(c);
    if (text === null) return errorTo(c, 413, "This form is too large", REFUSED_TEXT);
    const checked = checkPost(c, new URLSearchParams(text));
    if (checked instanceof Response) return checked;
    // the sign-in stays: the person can sign in as someone else on the same page
    signOut(c);
    checked.p.userId = null;
    return c.redirect(`/oauth/consent?request=${checked.p.id}`, 303);
  });
}
