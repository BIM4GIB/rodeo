// The OAuth routes for Rodeo's MCP endpoint. They sit outside /api, so the API's CORS, CSRF and
// no-store rules never touch them. They are the metadata an agent app reads to find Rodeo's sign-in,
// the token, registration and revocation endpoints, and the authorize and consent pages (authorize.ts).
// Each route sets its own headers. Every OAuth answer names itself with X-Openvwx-Page, so the service
// worker never keeps one as the app shell. registerOAuth must come before the editor's catch-all.

import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { allowed, clientIp } from "../auth.ts";
import { config } from "../config.ts";
import { HOUR, MINUTE } from "../util.ts";
import { bodyText, errorTo, prunePending, registerAuthorize } from "./authorize.ts";
import { clientKnown, markClientUsed, pruneClients, registerClient } from "./clients.ts";
import { authServerMetadata, checkResource, protectedResourceMetadata } from "./shared.ts";
import { pruneTokens, redeemCode, refreshGrant, revokeToken } from "./tokens.ts";

/** The headers that let any app call the metadata and token routes: they read no cookies, so any origin may. */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "600",
};

/** The metadata paths an app reads. */
const METADATA_PATHS = [
  "/.well-known/oauth-protected-resource/mcp",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
] as const;

/** Paths an app may look for OpenID Connect metadata at: each answers 404, and says why. */
const OIDC_PATHS = [
  "/.well-known/openid-configuration",
  "/.well-known/openid-configuration/mcp",
  "/.well-known/oauth-authorization-server/mcp",
  "/mcp/.well-known/openid-configuration",
] as const;

/** The answer to an OpenID Connect discovery probe: Rodeo is OAuth only, so the app should read the OAuth metadata. */
const OIDC_ANSWER = {
  error: "not_found",
  error_description: "Rodeo is an OAuth 2.0 authorization server, not OpenID Connect: see /.well-known/oauth-authorization-server",
};

/** Metadata is public and changes rarely, so an app may keep it for five minutes. */
const METADATA_HEADERS = { "Cache-Control": "public, max-age=300" };
/** A token answer carries secrets, so no cache may keep it. */
const TOKEN_HEADERS = { "Cache-Control": "no-store", Pragma: "no-cache" };
const NO_STORE = { "Cache-Control": "no-store" };
const INVALID_REQUEST = "invalid_request";

/** A JSON answer with the CORS headers and the OAuth page marker; `extra` adds or replaces headers. */
function json(c: Context, status: ContentfulStatusCode, body: unknown, extra: Record<string, string> = {}): Response {
  for (const [name, value] of Object.entries({ ...CORS, "X-Openvwx-Page": "oauth", ...extra })) c.header(name, value);
  return c.json(body, status);
}

/** The answer to a CORS preflight: no body, just the CORS headers. */
function preflight(c: Context): Response {
  return c.body(null, 204, CORS);
}

/** A token or revoke request's fields: a form body, or a JSON object whose text and number values count. "too_large" over 16 KB, "bad" when unreadable. */
async function formOf(c: Context): Promise<URLSearchParams | "too_large" | "bad"> {
  const text = await bodyText(c);
  if (text === null) return "too_large";
  if (!(c.req.header("content-type") ?? "").toLowerCase().includes("application/json")) return new URLSearchParams(text);
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return "bad";
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "bad";
  const form = new URLSearchParams();
  for (const [name, value] of Object.entries(body)) {
    if (typeof value === "string") form.append(name, value);
    else if (typeof value === "number") form.append(name, String(value));
  }
  return form;
}

/** The client_id in an HTTP Basic header (RFC 6749 §2.3.1); its password is ignored. Null when there is no Basic header, "bad" when it can't be read. */
function basicId(authorization: string | undefined): string | null | "bad" {
  const m = /^basic\s+(\S+)$/i.exec((authorization ?? "").trim());
  if (!m) return null;
  const text = Buffer.from(m[1], "base64").toString("utf8");
  const colon = text.indexOf(":");
  try {
    return decodeURIComponent(colon < 0 ? text : text.slice(0, colon));
  } catch {
    return "bad";
  }
}

/** POST /oauth/token: trades a code or a refresh token for a pair of tokens (RFC 6749 §4.1.3, §6). */
async function token(c: Context): Promise<Response> {
  if (!allowed(`oauth-token:${clientIp(c)}`, 600, MINUTE)) {
    return json(c, 429, { error: INVALID_REQUEST, error_description: "Too many requests: try again in a minute" }, TOKEN_HEADERS);
  }
  const form = await formOf(c);
  if (form === "too_large") return json(c, 413, { error: INVALID_REQUEST, error_description: "The request is too large" }, TOKEN_HEADERS);
  if (form === "bad") return json(c, 400, { error: INVALID_REQUEST, error_description: "The request body can't be read" }, TOKEN_HEADERS);

  // every app is public, so a client secret, if one is sent, is ignored; the id may come from the body or from HTTP Basic
  const basic = basicId(c.req.header("authorization"));
  if (basic === "bad") return json(c, 401, { error: "invalid_client", error_description: "The Authorization header can't be read" }, TOKEN_HEADERS);
  const fromBody = form.get("client_id") ?? "";
  const fromBasic = basic ?? "";
  if (fromBody !== "" && fromBasic !== "" && fromBody !== fromBasic) {
    return json(c, 400, { error: INVALID_REQUEST, error_description: "The client_id in the body and in the Authorization header differ" }, TOKEN_HEADERS);
  }
  const clientId = fromBody || fromBasic;
  if (clientId === "") return json(c, 401, { error: "invalid_client", error_description: "The request doesn't say which app is asking" }, TOKEN_HEADERS);
  if (!clientKnown(clientId)) {
    return json(c, 401, { error: "invalid_client", error_description: "Rodeo doesn't know this app: connect again from the app" }, TOKEN_HEADERS);
  }

  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    const code = form.get("code") ?? "";
    const verifier = form.get("code_verifier") ?? "";
    if (code === "" || verifier === "") {
      return json(c, 400, { error: INVALID_REQUEST, error_description: "The code and code_verifier are needed" }, TOKEN_HEADERS);
    }
    // checked before the code is used, so a request for another resource doesn't spend the code
    const resource = checkResource(form.getAll("resource"), config.publicUrl);
    if (resource === "bad") {
      return json(c, 400, { error: "invalid_target", error_description: "resource must be the Rodeo MCP endpoint" }, TOKEN_HEADERS);
    }
    const got = redeemCode({ code, clientId, redirectUri: form.get("redirect_uri"), verifier, resource });
    if (!got.ok) return json(c, 400, { error: got.error, error_description: got.description }, TOKEN_HEADERS);
    markClientUsed(clientId);
    return json(c, 200, got.pair, TOKEN_HEADERS);
  }
  if (grantType === "refresh_token") {
    const refreshToken = form.get("refresh_token") ?? "";
    if (refreshToken === "") return json(c, 400, { error: INVALID_REQUEST, error_description: "The refresh_token is needed" }, TOKEN_HEADERS);
    const resource = checkResource(form.getAll("resource"), config.publicUrl);
    if (resource === "bad") {
      return json(c, 400, { error: "invalid_target", error_description: "resource must be the Rodeo MCP endpoint" }, TOKEN_HEADERS);
    }
    const got = refreshGrant({ refreshToken, clientId, resource });
    if (!got.ok) return json(c, 400, { error: got.error, error_description: got.description }, TOKEN_HEADERS);
    return json(c, 200, got.pair, TOKEN_HEADERS);
  }
  return json(c, 400, { error: "unsupported_grant_type", error_description: "Use authorization_code or refresh_token" }, TOKEN_HEADERS);
}

/** POST /oauth/register: registers an app that asked for a client_id (RFC 7591), within the rate limits. */
async function register(c: Context): Promise<Response> {
  if (!allowed(`oauth-register:${clientIp(c)}`, 60, HOUR) || !allowed("oauth-register-all", 2000, HOUR)) {
    return json(c, 429, { error: INVALID_REQUEST, error_description: "Too many registrations: try again later" }, NO_STORE);
  }
  const text = await bodyText(c);
  if (text === null) return json(c, 413, { error: "invalid_client_metadata", error_description: "The registration is too large" }, NO_STORE);
  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
  } catch {
    return json(c, 400, { error: "invalid_client_metadata", error_description: "The registration isn't JSON" }, NO_STORE);
  }
  const reply = registerClient(body);
  return json(c, reply.status, reply.body, NO_STORE);
}

/** POST /oauth/revoke: ends the connection a token belongs to (RFC 7009). Always 200, so a probe learns nothing. */
async function revoke(c: Context): Promise<Response> {
  if (!allowed(`oauth-revoke:${clientIp(c)}`, 120, MINUTE)) {
    return json(c, 429, { error: INVALID_REQUEST, error_description: "Too many requests: try again in a minute" }, NO_STORE);
  }
  const form = await formOf(c);
  if (form === "too_large") return json(c, 413, { error: INVALID_REQUEST, error_description: "The request is too large" }, NO_STORE);
  // an unreadable body counts as a token Rodeo doesn't know: the answer is the same either way
  revokeToken(form === "bad" ? "" : (form.get("token") ?? ""));
  return c.body(null, 200, { ...CORS, ...NO_STORE });
}

/** Adds the OAuth routes. Register them after registerMcp and before the editor's catch-all. */
export function registerOAuth(app: Hono): void {
  app.get("/.well-known/oauth-protected-resource/mcp", (c) => json(c, 200, protectedResourceMetadata(config.publicUrl, false), METADATA_HEADERS));
  app.get("/.well-known/oauth-protected-resource", (c) => json(c, 200, protectedResourceMetadata(config.publicUrl, true), METADATA_HEADERS));
  app.get("/.well-known/oauth-authorization-server", (c) => json(c, 200, authServerMetadata(config.publicUrl), METADATA_HEADERS));
  for (const path of OIDC_PATHS) app.get(path, (c) => json(c, 404, OIDC_ANSWER));
  for (const path of [...METADATA_PATHS, ...OIDC_PATHS, "/oauth/token", "/oauth/register", "/oauth/revoke"]) {
    app.options(path, preflight);
  }

  registerAuthorize(app);
  app.post("/oauth/token", token);
  app.all("/oauth/token", (c) => json(c, 405, { error: INVALID_REQUEST, error_description: "Use POST" }, { Allow: "POST" }));
  app.post("/oauth/register", register);
  app.post("/oauth/revoke", revoke);
  // last: anything else under /oauth is a page that doesn't exist
  app.all("/oauth/*", (c) => errorTo(c, 404, "Nothing here", "This isn't a Rodeo sign-in page."));
}

/** Removes what has run out: expired tokens and old codes, connections with no live refresh token, unused registrations, and sign-ins left waiting. */
export function pruneOAuth(): void {
  pruneTokens();
  pruneClients();
  prunePending();
}
