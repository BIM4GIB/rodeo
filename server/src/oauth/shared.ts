// OAuth 2.1 sign-in for Rodeo's MCP endpoint: what its parts share. Rodeo is its own authorization
// server on its own origin: an agent app (claude.ai, Claude Code, Cursor, ChatGPT…) sends the person
// to Rodeo's consent page, they sign in with their Rodeo session and press Allow, and the app gets
// short-lived tokens for /mcp. Here: the constants, the tables, the token shapes, the metadata
// documents, and the small checks (PKCE, redirect addresses, the resource) that the authorize, token
// and endpoint code all use. It reads no config and no database, so checks can call it as it is.

import { createHash } from "node:crypto";
import { DAY, MINUTE, newToken, safeEqual, sha256Hex } from "../util.ts";

/** The one scope: work in the person's drawings, as them. Whatever scope is asked for is granted as this. */
export const SCOPE = "drawings";

export const ACCESS_PREFIX = "rodeo_at_";
export const REFRESH_PREFIX = "rodeo_rt_";
export const CODE_PREFIX = "rodeo_ac_";
export const DCR_PREFIX = "rodeo_dcr_";

/** An access token lasts an hour; agents refresh it before then. */
export const ACCESS_TTL_S = 3600;
/** A refresh token lasts 60 days; each use replaces it, so a connection used once in 60 days stays. */
export const REFRESH_TTL_MS = 60 * DAY;
/** A code lasts five minutes and works once. */
export const CODE_TTL_MS = 5 * MINUTE;
/** A replaced refresh token used again this soon, before its replacement was used, is a retry after a lost answer. */
export const REFRESH_GRACE_MS = 30_000;
/** A sign-in waiting on the consent page lasts half an hour. */
export const PENDING_TTL_MS = 30 * MINUTE;
/** Connected apps a person may have at once. */
export const MAX_GRANTS = 50;
/** The cookie that ties a sign-in to the browser it began in. */
export const BINDER_COOKIE = "ovx_oauth_req";
/** Longest address (client_id, redirect_uri, resource) and longest state Rodeo takes. */
export const MAX_URL = 2000;
export const MAX_STATE = 4096;

export const DOCS_URL = "https://github.com/rodeobuild/rodeo/blob/main/docs/guide/workspace.md#connect-an-agent";

// the shape newToken() makes after each prefix: 32 random bytes as base64url, 43 characters
const SECRET = "[A-Za-z0-9_-]{43}";
export const ACCESS_FORMAT = new RegExp(`^${ACCESS_PREFIX}${SECRET}$`);
export const REFRESH_FORMAT = new RegExp(`^${REFRESH_PREFIX}${SECRET}$`);
export const CODE_FORMAT = new RegExp(`^${CODE_PREFIX}${SECRET}$`);
/** newId() is 16 bytes as base64url: 22 characters. */
export const DCR_FORMAT = new RegExp(`^${DCR_PREFIX}[A-Za-z0-9_-]{22}$`);
/** RFC 7636 §4.1: a verifier is 43 to 128 unreserved characters; an S256 challenge is 43 base64url characters. */
export const VERIFIER_FORMAT = /^[A-Za-z0-9\-._~]{43,128}$/;
export const CHALLENGE_FORMAT = /^[A-Za-z0-9_-]{43}$/;

/** The tables. db.ts's schema version 10 runs the same SQL: keep the two the same. */
export const OAUTH_SCHEMA = `
-- OAuth sign-in for agents (server/src/oauth). Apps that registered themselves at /oauth/register
-- (dynamic client registration). Apps named by a metadata document's address (claude.ai, ChatGPT)
-- aren't stored: Rodeo fetches their document.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  client_uri TEXT,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS oauth_clients_created ON oauth_clients(created_at);

-- An app a person allowed: one row per Allow whose code was redeemed. Deleting it deletes its tokens.
CREATE TABLE IF NOT EXISTS oauth_grants (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  last_client TEXT
);
CREATE INDEX IF NOT EXISTS oauth_grants_user ON oauth_grants(user_id);
CREATE INDEX IF NOT EXISTS oauth_grants_client ON oauth_grants(client_id);

-- Authorization codes, by SHA-256: single use, five minutes, bound to the app, the redirect address,
-- the PKCE challenge and the resource. grant_id is set when the code is redeemed, so a second
-- redemption can remove what the first one made.
CREATE TABLE IF NOT EXISTS oauth_codes (
  hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  grant_id TEXT REFERENCES oauth_grants(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS oauth_codes_created ON oauth_codes(created_at);

-- Access and refresh tokens, by SHA-256 only. A used refresh token keeps the hash of the one that
-- replaced it (next_hash), so a second use can be told from a retry.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  hash TEXT PRIMARY KEY,
  grant_id TEXT NOT NULL REFERENCES oauth_grants(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  next_hash TEXT
);
CREATE INDEX IF NOT EXISTS oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX IF NOT EXISTS oauth_tokens_expires ON oauth_tokens(expires_at);
`;

/** An OAuth error answer (RFC 6749 §5.2, §4.1.2.1). */
export interface OAuthError {
  readonly error: string;
  readonly error_description: string;
}

/** The token endpoint's answer (RFC 6749 §5.1). */
export interface TokenPair {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly scope: string;
}

/** An app as Rodeo resolved it from its client_id. */
export interface Client {
  readonly id: string;
  /** "cimd": named by a metadata document's address; "dcr": registered at /oauth/register */
  readonly kind: "cimd" | "dcr";
  /** the name it gave itself, cleaned; "" when it gave none */
  readonly name: string;
  readonly redirectUris: readonly string[];
}

/** A client metadata document, as far as Rodeo reads one. */
export interface ClientDoc {
  readonly client_id: string;
  readonly client_name?: string;
  readonly client_uri?: string;
  readonly redirect_uris: readonly string[];
  readonly grant_types?: readonly string[];
  readonly response_types?: readonly string[];
  readonly token_endpoint_auth_method?: string;
}

/**
 * Copies of the documents Claude publishes (claude.com/docs/connectors/building/authentication),
 * used only when fetching the live one fails, so a hiccup between Rodeo and claude.ai doesn't stop
 * people connecting. The live document always wins.
 */
export const PINNED_DOCS: Readonly<Record<string, ClientDoc>> = {
  "https://claude.ai/oauth/mcp-oauth-client-metadata": {
    client_id: "https://claude.ai/oauth/mcp-oauth-client-metadata",
    client_name: "Claude",
    client_uri: "https://claude.ai",
    redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
    grant_types: ["authorization_code", "refresh_token", "urn:ietf:params:oauth:grant-type:jwt-bearer"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
  "https://claude.ai/oauth/claude-code-client-metadata": {
    client_id: "https://claude.ai/oauth/claude-code-client-metadata",
    client_name: "Claude Code",
    client_uri: "https://claude.ai",
    redirect_uris: ["http://localhost/callback", "http://127.0.0.1/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  },
};

/** Apps Rodeo knows by their metadata document's address (their client_id). */
export const KNOWN_APPS: Readonly<Record<string, string>> = {
  "https://claude.ai/oauth/mcp-oauth-client-metadata": "Claude",
  "https://claude.ai/oauth/claude-code-client-metadata": "Claude Code",
  "https://chatgpt.com/oauth/client.json": "ChatGPT",
};

/** Sites Rodeo knows by the origin it sends the person back to: only that site can receive the code. */
export const KNOWN_ORIGINS: Readonly<Record<string, string>> = {
  "https://claude.ai": "Claude",
  "https://claude.com": "Claude",
  "https://chatgpt.com": "ChatGPT",
};

/** A new secret of a kind: its prefix and 32 random bytes. */
export function newSecret(prefix: string): string {
  return prefix + newToken();
}

/** What is kept of a token or a code: its SHA-256, so a copy of the database holds no working secret. */
export function hashOf(secret: string): string {
  return sha256Hex(secret);
}

/** The S256 challenge of a verifier (RFC 7636 §4.2). */
export function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** Whether a verifier answers a challenge, compared in constant time. */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!VERIFIER_FORMAT.test(verifier) || !CHALLENGE_FORMAT.test(challenge)) return false;
  return safeEqual(challengeOf(verifier), challenge);
}

/** The token in an `Authorization: Bearer …` header; null when there is none or it is another scheme. */
export function bearerOf(authorization: string | undefined): string | null {
  const m = /^bearer\s+(\S+)$/i.exec((authorization ?? "").trim());
  return m ? m[1] : null;
}

/** The site's origin, from PUBLIC_URL ("https://rodeo.build"): the issuer, and the base of every address here. */
export function originOf(site: string): string {
  return new URL(site).origin;
}

/** The one protected resource: the MCP endpoint. */
export function resourceOf(site: string): string {
  return `${originOf(site)}/mcp`;
}

/** Where the endpoint's metadata is (RFC 9728 §3.1: the well-known name goes before the resource's path). */
export function metadataUrlOf(site: string): string {
  return `${originOf(site)}/.well-known/oauth-protected-resource/mcp`;
}

/**
 * The resource a request names (RFC 8707), as Rodeo's one resource: null when it names none, "bad"
 * when any value is something else. The endpoint's address and the bare origin both count, with case,
 * a default port and trailing slashes forgiven.
 */
export function checkResource(values: readonly string[], site: string): string | null | "bad" {
  if (values.length === 0) return null;
  const origin = originOf(site);
  for (const raw of values) {
    if (raw.length > MAX_URL || raw.includes("#")) return "bad";
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return "bad";
    }
    if (u.search !== "" || u.username !== "" || u.password !== "") return "bad";
    const path = u.pathname.replace(/\/+$/, "");
    if (u.origin !== origin || (path !== "" && path !== "/mcp")) return "bad";
  }
  return resourceOf(site);
}

/** Schemes an app may never send the person back to: ones a browser runs, shows or hands elsewhere. */
const DENIED_SCHEMES = new Set([
  "javascript:", "data:", "vbscript:", "file:", "about:", "blob:", "filesystem:", "ftp:",
  "ws:", "wss:", "mailto:", "tel:", "sms:", "intent:", "view-source:",
]);

/** Whether a URL's hostname is this computer's loopback, as RFC 8252 §7.3 means it. */
export function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * What is wrong with a redirect address an app registers or uses, or null: https anywhere; http only
 * to this computer; an app's own scheme (cursor://…) unless it is one in DENIED_SCHEMES; never a
 * fragment or a user name.
 */
export function redirectProblem(raw: string): string | null {
  if (raw.length === 0 || raw.length > MAX_URL) return "a redirect address must be 1 to 2000 characters";
  if (raw.includes("#")) return "a redirect address can't have a fragment";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "a redirect address must be an absolute URL";
  }
  if (u.username !== "" || u.password !== "") return "a redirect address can't carry a user name";
  if (u.protocol === "https:") return u.hostname ? null : "an https redirect address needs a host";
  if (u.protocol === "http:") return isLoopbackHost(u.hostname) ? null : "http redirect addresses must be on localhost";
  if (!/^[a-z][a-z0-9+.-]*:$/.test(u.protocol) || DENIED_SCHEMES.has(u.protocol)) return `redirects to ${u.protocol} aren't allowed`;
  return null;
}

/**
 * Whether a redirect address in a request is one the app registered: the same string, or for http
 * on this computer the same host, path and query on any port (RFC 8252 §7.3; Claude Code and other
 * command-line agents pick a free port each time).
 */
export function redirectMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  if (requested.includes("#")) return false;
  let a: URL;
  let b: URL;
  try {
    a = new URL(registered);
    b = new URL(requested);
  } catch {
    return false;
  }
  return (
    a.protocol === "http:" &&
    b.protocol === "http:" &&
    isLoopbackHost(a.hostname) &&
    a.hostname === b.hostname &&
    a.pathname === b.pathname &&
    a.search === b.search &&
    b.username === "" &&
    b.password === ""
  );
}

/**
 * What is wrong with a client_id that is a metadata document's address, or null (the CIMD draft, §3):
 * https on the default port, a path other than "/", no fragment, no user name, and written in its
 * own normal form. The normal-form test also refuses dot segments (".", "..", "%2e"), an upper-case
 * host and an explicit :443, all of which the URL parser rewrites.
 */
export function cimdUrlProblem(raw: string): string | null {
  if (raw.length > MAX_URL) return "the app's id is too long";
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return "the app's id isn't a valid address";
  }
  if (u.protocol !== "https:") return "the app's id must be an https address";
  if (u.username !== "" || u.password !== "" || raw.includes("#")) return "the app's id can't have a user name or a fragment";
  if (u.port !== "") return "the app's id must use the default https port";
  if (u.pathname === "/" || u.pathname === "") return "the app's id must have a path";
  if (u.href !== raw) return "the app's id must be written in its normal form";
  return null;
}

/** How the consent page and the Connect an Agent dialog show an app. */
export interface ClientLook {
  /** "Claude", or the name the app gave itself (unchecked when verified is false) */
  readonly name: string;
  /** Rodeo knows who this is: the code can only reach that app's own site */
  readonly verified: boolean;
  /** where Rodeo sends the person back: "claude.ai", "this computer", "cursor://anysphere.cursor-mcp" */
  readonly where: string;
  /** the redirect goes to a program on this computer, which any program could be */
  readonly local: boolean;
  /** for an unknown app described by a document on the web, that document's host; else null */
  readonly detailsFrom: string | null;
}

/** How to show an app: its client_id, the redirect address it uses, and the name it gave itself (cleaned). */
export function describeClient(clientId: string, redirectUri: string, selfName: string): ClientLook {
  let where = "an address Rodeo can't read";
  let local = false;
  let origin = "";
  try {
    const u = new URL(redirectUri);
    if (u.protocol === "https:") {
      where = u.host;
      origin = u.origin;
    } else if (u.protocol === "http:" && isLoopbackHost(u.hostname)) {
      where = "this computer";
      local = true;
    } else {
      where = u.host ? `${u.protocol}//${u.host}` : u.protocol;
    }
  } catch {
    // stays as it is: the authorize step refuses an address like this long before it is shown
  }
  let docHost: string | null = null;
  if (clientId.startsWith("https://")) {
    try {
      docHost = new URL(clientId).host;
    } catch {
      docHost = null;
    }
  }
  const known = KNOWN_APPS[clientId];
  if (known) return { name: known, verified: !local, where, local, detailsFrom: null };
  const site = origin ? KNOWN_ORIGINS[origin] : undefined;
  if (site) return { name: site, verified: true, where, local, detailsFrom: null };
  return { name: selfName || docHost || "An app", verified: false, where, local, detailsFrom: docHost };
}

/** The protected resource metadata (RFC 9728): for the endpoint, or (atRoot) for the bare origin. */
export function protectedResourceMetadata(site: string, atRoot: boolean): Record<string, unknown> {
  return {
    resource: atRoot ? originOf(site) : resourceOf(site),
    authorization_servers: [originOf(site)],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Rodeo",
    resource_documentation: DOCS_URL,
  };
}

/** The authorization server metadata (RFC 8414) at /.well-known/oauth-authorization-server. */
export function authServerMetadata(site: string): Record<string, unknown> {
  const o = originOf(site);
  return {
    issuer: o,
    authorization_endpoint: `${o}/oauth/authorize`,
    token_endpoint: `${o}/oauth/token`,
    registration_endpoint: `${o}/oauth/register`,
    revocation_endpoint: `${o}/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: DOCS_URL,
  };
}

/**
 * The WWW-Authenticate header of a 401 from /mcp (RFC 6750 §3, RFC 9728 §5.1): where the metadata is
 * and the scope to ask for; when a token was sent and didn't work, also invalid_token. No error is
 * named when no token was sent, as RFC 6750 §3.1 asks.
 */
export function wwwAuthenticate(site: string, tokenSent: boolean): string {
  const parts = ['Bearer realm="Rodeo"'];
  if (tokenSent) parts.push('error="invalid_token"', 'error_description="The token is unknown, expired or revoked"');
  parts.push(`resource_metadata="${metadataUrlOf(site)}"`, `scope="${SCOPE}"`);
  return parts.join(", ");
}
