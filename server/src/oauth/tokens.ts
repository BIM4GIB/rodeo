// The OAuth token store: the authorization codes, the grants (one per app a person allowed) and
// their access and refresh tokens, all kept as SHA-256 hashes. The rules that decide whether a code
// or a refresh token is still good live here, so the token endpoint and the bearer check only ask
// and answer. An OAuth refusal is returned, never thrown, inside a transaction: a code's "used"
// mark has to commit even when the answer is an error.

import { all, get, run, tx } from "../db.ts";
import { cleanLine, DAY, HOUR, inMs, MINUTE, newId, nowIso } from "../util.ts";
import {
  ACCESS_FORMAT,
  ACCESS_PREFIX,
  ACCESS_TTL_S,
  CODE_FORMAT,
  CODE_PREFIX,
  CODE_TTL_MS,
  hashOf,
  newSecret,
  pkceMatches,
  REFRESH_FORMAT,
  REFRESH_GRACE_MS,
  REFRESH_PREFIX,
  REFRESH_TTL_MS,
  SCOPE,
  type TokenPair,
} from "./shared.ts";

/** What a code is bound to: who allowed it, for which app, back to where, with which challenge and resource. */
export interface CodeRequest {
  readonly userId: string;
  readonly clientId: string;
  /** how the app was shown on the consent page (ClientLook.name), kept on the grant */
  readonly clientName: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly resource: string;
}

/** A token request's outcome: a new pair, or an OAuth error to answer with. */
export type Granted =
  | { readonly ok: true; readonly pair: TokenPair; readonly grantId: string }
  | { readonly ok: false; readonly error: "invalid_grant" | "invalid_target"; readonly description: string };

/** Who an access token acts for: what the endpoint needs. */
export interface OAuthOwner {
  readonly grantId: string;
  readonly userId: string;
  readonly name: string;
}

/** A connected app as its owner's list shows it. */
export interface GrantRow {
  readonly id: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly redirectUri: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly lastClient: string | null;
}

interface CodeRow {
  hash: string;
  user_id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  challenge: string;
  scope: string;
  resource: string;
  expires_at: string;
  used_at: string | null;
  grant_id: string | null;
}

interface RefreshRow {
  hash: string;
  expires_at: string;
  used_at: string | null;
  next_hash: string | null;
  grant_id: string;
  client_id: string;
  resource: string;
  suspended_at: string | null;
}

interface GrantDbRow {
  id: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  created_at: string;
  last_used_at: string | null;
  last_client: string | null;
}

const CODE_COLUMNS =
  "SELECT hash, user_id, client_id, client_name, redirect_uri, challenge, scope, resource, expires_at, used_at, grant_id FROM oauth_codes";
const GRANT_COLUMNS = "SELECT id, client_id, client_name, redirect_uri, created_at, last_used_at, last_client FROM oauth_grants";

// when each grant was last written as used, and by which client: a busy agent makes a call a second,
// and writing each one would be needless work (the same idea as store.ts's touched map)
const touched = new Map<string, { at: number; client: string | null }>();

/** An OAuth refusal, to be returned from a transaction (never thrown: see the top of this file). */
function refused(error: "invalid_grant" | "invalid_target", description: string): Granted {
  return { ok: false, error, description };
}

/** Whether an account exists and isn't suspended. */
function accountOk(userId: string): boolean {
  const u = get<{ suspended_at: string | null }>("SELECT suspended_at FROM users WHERE id = ?", userId);
  return u !== undefined && u.suspended_at === null;
}

function insertToken(grantId: string, hash: string, kind: "access" | "refresh", expiresAt: string): void {
  run("INSERT INTO oauth_tokens (hash, grant_id, kind, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", hash, grantId, kind, nowIso(), expiresAt);
}

/** Issues an access token and a refresh token for a grant; returns the answer and the refresh token's hash. */
function issuePair(grantId: string): { pair: TokenPair; refreshHash: string } {
  const access = newSecret(ACCESS_PREFIX);
  const refresh = newSecret(REFRESH_PREFIX);
  const refreshHash = hashOf(refresh);
  insertToken(grantId, hashOf(access), "access", inMs(ACCESS_TTL_S * 1000));
  insertToken(grantId, refreshHash, "refresh", inMs(REFRESH_TTL_MS));
  return {
    pair: { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope: SCOPE },
    refreshHash,
  };
}

/** Makes a code for a request the person allowed. The secret goes to the app once; only its hash is kept. */
export function createCode(r: CodeRequest): string {
  const code = newSecret(CODE_PREFIX);
  run(
    `INSERT INTO oauth_codes (hash, user_id, client_id, client_name, redirect_uri, challenge, scope, resource, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    hashOf(code),
    r.userId,
    r.clientId,
    r.clientName,
    r.redirectUri,
    r.challenge,
    SCOPE,
    r.resource,
    nowIso(),
    inMs(CODE_TTL_MS),
  );
  return code;
}

/**
 * Redeems a code once: the app's client, redirect address, PKCE verifier and resource must all be
 * the ones the person allowed, and the account must be in good standing. Making the grant and its
 * first pair happens only here. A code redeemed a second time ends the connection its first redemption made.
 */
export function redeemCode(r: {
  readonly code: string;
  readonly clientId: string;
  readonly redirectUri: string | null;
  readonly verifier: string;
  readonly resource: string | null;
}): Granted {
  return tx((): Granted => {
    if (!CODE_FORMAT.test(r.code)) return refused("invalid_grant", "The code is not one of Rodeo's");
    const hash = hashOf(r.code);
    const row = get<CodeRow>(`${CODE_COLUMNS} WHERE hash = ?`, hash);
    if (!row) return refused("invalid_grant", "The code is unknown");
    if (row.used_at !== null) {
      if (row.grant_id) {
        run("DELETE FROM oauth_grants WHERE id = ?", row.grant_id);
        console.warn(`[oauth] a code was used twice: connection ${row.grant_id} removed`);
      }
      return refused("invalid_grant", "The code was already used");
    }
    // marked before any other check, so a code that fails once can't be tried again
    const now = nowIso();
    run("UPDATE oauth_codes SET used_at = ? WHERE hash = ? AND used_at IS NULL", now, hash);
    if (row.expires_at <= now) return refused("invalid_grant", "The code has expired");
    if (row.client_id !== r.clientId) return refused("invalid_grant", "The code was issued to another app");
    if (r.redirectUri !== null && r.redirectUri !== row.redirect_uri) {
      return refused("invalid_grant", "redirect_uri differs from the one used to sign in");
    }
    if (!pkceMatches(r.verifier, row.challenge)) return refused("invalid_grant", "code_verifier doesn't match the code_challenge");
    if (r.resource !== null && r.resource !== row.resource) return refused("invalid_target", "The code is for another resource");
    if (!accountOk(row.user_id)) return refused("invalid_grant", "This Rodeo account can't sign in");

    const grantId = newId();
    run(
      "INSERT INTO oauth_grants (id, user_id, client_id, client_name, redirect_uri, scope, resource, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      grantId,
      row.user_id,
      row.client_id,
      row.client_name,
      row.redirect_uri,
      row.scope,
      row.resource,
      now,
    );
    run("UPDATE oauth_codes SET grant_id = ? WHERE hash = ?", grantId, hash);
    const { pair } = issuePair(grantId);
    console.log(`[oauth] ${row.client_name} connected (connection ${grantId})`);
    return { ok: true, pair, grantId };
  });
}

/**
 * Trades a refresh token for a new pair, and replaces it (RFC 9700 §4.14). A token used again moments
 * after its use is a retry whose answer was lost; any other reuse means someone else holds the old
 * token, so the whole connection is removed.
 */
export function refreshGrant(r: { readonly refreshToken: string; readonly clientId: string; readonly resource: string | null }): Granted {
  return tx((): Granted => {
    if (!REFRESH_FORMAT.test(r.refreshToken)) return refused("invalid_grant", "The refresh token is not one of Rodeo's");
    const row = get<RefreshRow>(
      `SELECT t.hash, t.expires_at, t.used_at, t.next_hash, g.id AS grant_id, g.client_id, g.resource, u.suspended_at
       FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
       WHERE t.hash = ? AND t.kind = 'refresh'`,
      hashOf(r.refreshToken),
    );
    if (!row) return refused("invalid_grant", "The refresh token is unknown or was revoked");
    if (row.expires_at <= nowIso()) return refused("invalid_grant", "The refresh token has expired");
    if (row.client_id !== r.clientId) return refused("invalid_grant", "The refresh token was issued to another app");
    if (r.resource !== null && r.resource !== row.resource) return refused("invalid_target", "The refresh token is for another resource");
    if (row.suspended_at !== null) return refused("invalid_grant", "This Rodeo account can't sign in");

    if (row.used_at !== null) {
      const next = row.next_hash;
      const recent = Date.now() - Date.parse(row.used_at) < REFRESH_GRACE_MS;
      // the token that replaced it, if it has never been used: the app never got that one either
      const replacementUnused =
        next !== null && get<{ hash: string }>("SELECT hash FROM oauth_tokens WHERE hash = ? AND used_at IS NULL", next) !== undefined;
      if (next !== null && recent && replacementUnused) {
        // the replacement is kept, marked used with nothing after it, so whoever holds it ends the
        // connection by using it: if a thief made this "retry", the app's next refresh exposes them
        run("UPDATE oauth_tokens SET used_at = ?, next_hash = NULL WHERE hash = ?", nowIso(), next);
        const { pair, refreshHash } = issuePair(row.grant_id);
        run("UPDATE oauth_tokens SET next_hash = ? WHERE hash = ?", refreshHash, row.hash);
        return { ok: true, pair, grantId: row.grant_id };
      }
      run("DELETE FROM oauth_grants WHERE id = ?", row.grant_id);
      console.warn(`[oauth] a refresh token was used twice: connection ${row.grant_id} removed`);
      return refused("invalid_grant", "This connection was ended because its refresh token was used twice: connect again");
    }

    const { pair, refreshHash } = issuePair(row.grant_id);
    run("UPDATE oauth_tokens SET used_at = ?, next_hash = ? WHERE hash = ?", nowIso(), refreshHash, row.hash);
    return { ok: true, pair, grantId: row.grant_id };
  });
}

/** Ends the connection a token belongs to (RFC 7009). True when one was removed; a token of ours that is unknown, or any other string, gives false. */
export function revokeToken(token: string): boolean {
  if (!ACCESS_FORMAT.test(token) && !REFRESH_FORMAT.test(token)) return false;
  const row = get<{ grant_id: string }>("SELECT grant_id FROM oauth_tokens WHERE hash = ?", hashOf(token));
  return row !== undefined && run("DELETE FROM oauth_grants WHERE id = ?", row.grant_id) === 1;
}

/** Who an access token acts for, when it is ours, unexpired, for this resource and its account is in good standing; else null. */
export function oauthOwner(token: string, resource: string): OAuthOwner | null {
  if (!ACCESS_FORMAT.test(token)) return null;
  const row = get<{ id: string; user_id: string; client_name: string; resource: string; expires_at: string }>(
    `SELECT g.id, g.user_id, g.client_name, g.resource, t.expires_at
     FROM oauth_tokens t JOIN oauth_grants g ON g.id = t.grant_id JOIN users u ON u.id = g.user_id
     WHERE t.hash = ? AND t.kind = 'access' AND u.suspended_at IS NULL`,
    hashOf(token),
  );
  if (!row || row.expires_at <= nowIso() || resource !== row.resource) return null;
  return { grantId: row.id, userId: row.user_id, name: row.client_name };
}

/** Records that a connection was used now, by `client` (the app's name, when it gave one). */
export function touchGrant(grantId: string, client: string | null): void {
  const name = cleanLine(client, 60) || null;
  const last = touched.get(grantId);
  const now = Date.now();
  if (last && now - last.at < MINUTE && (name === null || name === last.client)) return;
  // a call that names no client keeps the last one named
  run("UPDATE oauth_grants SET last_used_at = ?, last_client = COALESCE(?, last_client) WHERE id = ?", nowIso(), name, grantId);
  touched.set(grantId, { at: now, client: name ?? last?.client ?? null });
}

/** A user's connected apps, newest first. */
export function listGrants(userId: string): GrantRow[] {
  // the row id breaks ties, for connections made within the same millisecond
  return all<GrantDbRow>(`${GRANT_COLUMNS} WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`, userId).map(toGrant);
}

function toGrant(r: GrantDbRow): GrantRow {
  return {
    id: r.id,
    clientId: r.client_id,
    clientName: r.client_name,
    redirectUri: r.redirect_uri,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    lastClient: r.last_client,
  };
}

/** Removes one of a user's connections, and with it every token it holds. False when it isn't theirs or doesn't exist. */
export function removeGrant(userId: string, grantId: string): boolean {
  return run("DELETE FROM oauth_grants WHERE id = ? AND user_id = ?", grantId, userId) === 1;
}

/** How many connections a user has. */
export function grantCount(userId: string): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM oauth_grants WHERE user_id = ?", userId)?.n ?? 0;
}

/** Deletes what has expired or is no longer used: tokens past their time, codes older than a day, connections with no live refresh token. */
export function pruneTokens(): void {
  const now = nowIso();
  run("DELETE FROM oauth_tokens WHERE expires_at <= ?", now);
  run("DELETE FROM oauth_codes WHERE created_at <= ?", inMs(-DAY));
  run(
    `DELETE FROM oauth_grants WHERE NOT EXISTS (
       SELECT 1 FROM oauth_tokens t WHERE t.grant_id = oauth_grants.id AND t.kind = 'refresh' AND t.used_at IS NULL AND t.expires_at > ?
     )`,
    now,
  );
  const cutoff = Date.now() - HOUR;
  for (const [id, last] of touched) {
    if (last.at < cutoff) touched.delete(id);
  }
}
