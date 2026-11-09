// Checks the OAuth token store (tokens.ts) on a fresh database: PKCE, the redirect and resource rules,
// the metadata documents, codes and their refusals, token pairs, refresh rotation with reuse
// detection, revocation, the grant list, the last-used write and pruning. Prints an ok line per check;
// exits 1 on any failure.
//
// Run: cd server && node src/oauth/tokens.check.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Granted } from "./tokens.ts";

// the data folder and the site must be chosen before config.ts reads the environment, so the server modules load late
const dir = mkdtempSync(join(tmpdir(), "oauth-tokens-"));
process.env.DATA_DIR = dir;
process.env.PUBLIC_URL = "https://rodeo.build";

const { database, get, all, openDatabase, run } = await import("../db.ts");
const { DAY, inMs, nowIso, sha256Hex } = await import("../util.ts");
const shared = await import("./shared.ts");
const tokens = await import("./tokens.ts");

const SITE = "https://rodeo.build";
const RESOURCE = "https://rodeo.build/mcp";
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
// the RFC 7636 Appendix B pair
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const DCR_ID = `rodeo_dcr_${"A".repeat(22)}`;

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function addUser(id: string, email: string): void {
  run("INSERT INTO users (id, email, name, avatar_url, created_at, plan) VALUES (?, ?, ?, ?, ?, 'free')", id, email, "Check", null, nowIso());
}

/** How many grant rows have this id: 1 while it exists, 0 once it is gone. */
function grantRows(id: string): number {
  return get<{ n: number }>("SELECT COUNT(*) AS n FROM oauth_grants WHERE id = ?", id)?.n ?? 0;
}

/** Whether a row of a table exists with this hash. */
function hasRow(table: string, hash: string): boolean {
  return get<{ hash: string }>(`SELECT hash FROM ${table} WHERE hash = ?`, hash) !== undefined;
}

/** True when a granted answer is an OAuth refusal with this error. */
function refusedAs(g: Granted, error: string): boolean {
  return !g.ok && g.error === error;
}

/** A code for a user, as the consent page makes it for Claude. */
function codeFor(userId: string, clientName = "Claude", clientId = CLAUDE, redirectUri = CALLBACK): string {
  return tokens.createCode({ userId, clientId, clientName, redirectUri, challenge: CHALLENGE, resource: RESOURCE });
}

/** Redeems a code with the values Claude sends back. */
function redeem(code: string): Granted {
  return tokens.redeemCode({ code, clientId: CLAUDE, redirectUri: CALLBACK, verifier: VERIFIER, resource: RESOURCE });
}

/** Signs a user in: a code, then its redemption. Throws when the redemption is refused. */
function connect(userId: string, clientName = "Claude"): Extract<Granted, { ok: true }> {
  const g = redeem(codeFor(userId, clientName));
  if (!g.ok) throw new Error(`connect refused: ${g.description}`);
  return g;
}

/** Trades a refresh token for a new pair, as the token endpoint does. */
function refresh(token: string, clientId = CLAUDE, resource: string | null = RESOURCE): Granted {
  return tokens.refreshGrant({ refreshToken: token, clientId, resource });
}

try {
  openDatabase();
  database().exec(shared.OAUTH_SCHEMA);
  const user = "check-user";
  const other = "check-other";
  const banned = "check-suspended";
  addUser(user, "check@example.com");
  addUser(other, "other@example.com");
  addUser(banned, "banned@example.com");
  run("UPDATE users SET suspended_at = ? WHERE id = ?", nowIso(), banned);

  // PKCE (RFC 7636)
  expect("the RFC 7636 example challenge comes out", shared.challengeOf(VERIFIER) === CHALLENGE);
  expect("pkceMatches accepts the pair", shared.pkceMatches(VERIFIER, CHALLENGE));
  expect("pkceMatches refuses another verifier", !shared.pkceMatches("a".repeat(43), CHALLENGE));
  expect("pkceMatches refuses a 42-character verifier", !shared.pkceMatches(VERIFIER.slice(0, 42), CHALLENGE));
  expect("pkceMatches refuses a 42-character challenge", !shared.pkceMatches(VERIFIER, CHALLENGE.slice(0, 42)));

  // redirect addresses
  const goodRedirects = [CALLBACK, "http://127.0.0.1:6276/oauth/callback", "http://localhost/callback", "http://[::1]:8080/cb", "cursor://anysphere.cursor-mcp/oauth/callback"];
  expect("good redirect addresses pass", goodRedirects.every((u) => shared.redirectProblem(u) === null));
  const badRedirects = [
    "http://example.com/cb",
    "javascript:alert(1)",
    "data:text/html,x",
    "https://a.example/cb#x",
    "https://u:p@a.example/cb",
    "relative/cb",
    "",
    `https://a.example/${"a".repeat(2000)}`,
  ];
  expect("bad redirect addresses are named", badRedirects.every((u) => typeof shared.redirectProblem(u) === "string"));

  // redirect matching: a loopback port is free, everything else is exact
  expect("a loopback redirect matches on another port", shared.redirectMatches("http://localhost/callback", "http://localhost:54321/callback"));
  expect("…but not on another host", !shared.redirectMatches("http://localhost/callback", "http://127.0.0.1:54321/callback"));
  expect("…nor on another path", !shared.redirectMatches("http://localhost/callback", "http://localhost:5/other"));
  expect("…nor with a fragment", !shared.redirectMatches("http://localhost/callback", "http://localhost:5/callback#x"));
  expect("the https callback matches itself", shared.redirectMatches(CALLBACK, CALLBACK));
  expect("…but not with a trailing slash", !shared.redirectMatches(CALLBACK, `${CALLBACK}/`));
  expect("…nor on another port", !shared.redirectMatches(CALLBACK, "https://claude.ai:8443/api/mcp/auth_callback"));

  // the resource
  expect("no resource named gives null", shared.checkResource([], SITE) === null);
  const endpointForms = [RESOURCE, "https://RODEO.build/mcp/", "https://rodeo.build", "https://rodeo.build/", "https://rodeo.build:443/mcp"];
  expect("the endpoint and the bare origin all name the resource", endpointForms.every((r) => shared.checkResource([r], SITE) === RESOURCE));
  const badResources: string[][] = [
    ["https://rodeo.build/api"],
    ["https://evil.example/mcp"],
    [RESOURCE, "https://evil.example/mcp"],
    ["https://rodeo.build/mcp?x=1"],
    ["https://rodeo.build/mcp#a"],
    ["not a url"],
  ];
  expect("anything else is bad", badResources.every((rs) => shared.checkResource(rs, SITE) === "bad"));

  // client ids that are metadata document addresses
  expect("the known apps' addresses pass", Object.keys(shared.KNOWN_APPS).every((id) => shared.cimdUrlProblem(id) === null));
  const badCimd = [
    "http://a.example/c.json",
    "https://a.example/",
    "https://a.example",
    "https://a.example/c#f",
    "https://a.example:8443/c",
    "https://a.example/a/../c",
    "https://a.example/a/%2e%2e/c",
    "https://A.example/c",
    "https://u@a.example/c",
  ];
  expect("and these are refused", badCimd.every((id) => typeof shared.cimdUrlProblem(id) === "string"));

  // how an app is shown
  const claude = shared.describeClient(CLAUDE, CALLBACK, "");
  expect(
    "Claude's own app is Claude, verified, sent back to claude.ai",
    isDeepStrictEqual(claude, { name: "Claude", verified: true, where: "claude.ai", local: false, detailsFrom: null }),
    JSON.stringify(claude),
  );
  const claudeCode = shared.describeClient("https://claude.ai/oauth/claude-code-client-metadata", "http://localhost:5000/callback", "");
  expect("Claude Code on this computer is not verified", claudeCode.name === "Claude Code" && !claudeCode.verified && claudeCode.local && claudeCode.where === "this computer");
  const chatgpt = shared.describeClient(DCR_ID, "https://chatgpt.com/connector_platform_oauth_redirect", "Anything");
  expect("ChatGPT's own site is verified", chatgpt.name === "ChatGPT" && chatgpt.verified);
  const cursor = shared.describeClient(DCR_ID, "cursor://anysphere.cursor-mcp/oauth/callback", "Cursor");
  expect(
    "Cursor names itself, is not verified, and is shown by its scheme",
    cursor.name === "Cursor" && !cursor.verified && cursor.where === "cursor://anysphere.cursor-mcp",
  );
  const tools = shared.describeClient("https://tools.example/client.json", "https://tools.example/cb", "");
  expect("an unnamed app is named by its document's host", tools.name === "tools.example" && tools.detailsFrom === "tools.example");

  // metadata documents (§2.3)
  const authDoc = {
    issuer: "https://rodeo.build",
    authorization_endpoint: "https://rodeo.build/oauth/authorize",
    token_endpoint: "https://rodeo.build/oauth/token",
    registration_endpoint: "https://rodeo.build/oauth/register",
    revocation_endpoint: "https://rodeo.build/oauth/revoke",
    scopes_supported: ["drawings"],
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: "https://github.com/rodeobuild/rodeo/blob/main/docs/guide/workspace.md#connect-an-agent",
  };
  expect("the authorization server metadata is the document", isDeepStrictEqual(shared.authServerMetadata(SITE), authDoc));
  const resourceDoc = {
    resource: RESOURCE,
    authorization_servers: ["https://rodeo.build"],
    scopes_supported: ["drawings"],
    bearer_methods_supported: ["header"],
    resource_name: "Rodeo",
    resource_documentation: "https://github.com/rodeobuild/rodeo/blob/main/docs/guide/workspace.md#connect-an-agent",
  };
  expect("the endpoint's resource metadata is the document", isDeepStrictEqual(shared.protectedResourceMetadata(SITE, false), resourceDoc));
  expect(
    "the root resource metadata is the same with the bare origin",
    isDeepStrictEqual(shared.protectedResourceMetadata(SITE, true), { ...resourceDoc, resource: "https://rodeo.build" }),
  );
  expect("originOf drops the trailing slash", shared.originOf("https://rodeo.build/") === "https://rodeo.build");

  // the 401 header (§2.4)
  expect(
    "a 401 with no token names the metadata and the scope",
    shared.wwwAuthenticate(SITE, false) ===
      'Bearer realm="Rodeo", resource_metadata="https://rodeo.build/.well-known/oauth-protected-resource/mcp", scope="drawings"',
  );
  expect(
    "a 401 for a token that doesn't work says invalid_token",
    shared.wwwAuthenticate(SITE, true) ===
      'Bearer realm="Rodeo", error="invalid_token", error_description="The token is unknown, expired or revoked", resource_metadata="https://rodeo.build/.well-known/oauth-protected-resource/mcp", scope="drawings"',
  );

  // codes
  const code = codeFor(user);
  expect("a code has the code shape", shared.CODE_FORMAT.test(code));
  expect("only the code's hash is stored", hasRow("oauth_codes", sha256Hex(code)) && !JSON.stringify(all("SELECT * FROM oauth_codes")).includes(code));

  const first = redeem(code);
  expect("a code redeems for a pair", first.ok);
  expect("the access token has its shape", first.ok && shared.ACCESS_FORMAT.test(first.pair.access_token));
  expect("the refresh token has its shape", first.ok && shared.REFRESH_FORMAT.test(first.pair.refresh_token));
  expect("the pair lasts an hour and is for drawings", first.ok && first.pair.expires_in === 3600 && first.pair.scope === "drawings" && first.pair.token_type === "Bearer");
  expect("one grant exists, named for the app", get<{ n: number }>("SELECT COUNT(*) AS n FROM oauth_grants WHERE client_name = ?", "Claude")?.n === 1);
  const secrets = first.ok ? [first.pair.access_token, first.pair.refresh_token] : [];
  const tokenDump = JSON.stringify(all("SELECT * FROM oauth_tokens"));
  expect("the tokens are stored by hash, and no column holds a secret", secrets.length === 2 && hasRow("oauth_tokens", shared.hashOf(secrets[0])) && hasRow("oauth_tokens", shared.hashOf(secrets[1])) && !secrets.some((s) => tokenDump.includes(s)));
  expect(
    "the first access token has its owner",
    first.ok && isDeepStrictEqual(tokens.oauthOwner(first.pair.access_token, RESOURCE), { grantId: first.grantId, userId: user, name: "Claude" }),
  );

  const again = redeem(code);
  expect("the same code again is refused as used", refusedAs(again, "invalid_grant") && !again.ok && again.description === "The code was already used");
  expect("…and the grant it made is removed", get<{ n: number }>("SELECT COUNT(*) AS n FROM oauth_grants")?.n === 0);
  expect("…so the first access token has no owner", first.ok && tokens.oauthOwner(first.pair.access_token, RESOURCE) === null);

  // refusals: each code is used up by its refusal
  const wrongClient = codeFor(user);
  expect(
    "a code sent by another app is refused",
    refusedAs(tokens.redeemCode({ code: wrongClient, clientId: "https://other.example/c.json", redirectUri: CALLBACK, verifier: VERIFIER, resource: RESOURCE }), "invalid_grant"),
  );
  expect("…and the right request with that code is then refused as used", refusedAs(redeem(wrongClient), "invalid_grant"));
  expect(
    "a code sent to another redirect address is refused",
    refusedAs(tokens.redeemCode({ code: codeFor(user), clientId: CLAUDE, redirectUri: "http://localhost/callback", verifier: VERIFIER, resource: RESOURCE }), "invalid_grant"),
  );
  expect(
    "a code with the wrong verifier is refused",
    refusedAs(tokens.redeemCode({ code: codeFor(user), clientId: CLAUDE, redirectUri: CALLBACK, verifier: "b".repeat(43), resource: RESOURCE }), "invalid_grant"),
  );
  expect(
    "a code for another resource is invalid_target",
    refusedAs(tokens.redeemCode({ code: codeFor(user), clientId: CLAUDE, redirectUri: CALLBACK, verifier: VERIFIER, resource: "https://other.example/mcp" }), "invalid_target"),
  );
  const expiring = codeFor(user);
  run("UPDATE oauth_codes SET expires_at = ? WHERE hash = ?", inMs(-1000), sha256Hex(expiring));
  expect("an expired code is refused", refusedAs(redeem(expiring), "invalid_grant"));
  expect("a code for a suspended account is refused", refusedAs(redeem(codeFor(banned)), "invalid_grant"));
  const noRedirect = tokens.redeemCode({ code: codeFor(user), clientId: CLAUDE, redirectUri: null, verifier: VERIFIER, resource: RESOURCE });
  expect("no redirect address in the request is allowed", noRedirect.ok);
  const noResource = tokens.redeemCode({ code: codeFor(user), clientId: CLAUDE, redirectUri: CALLBACK, verifier: VERIFIER, resource: null });
  expect("no resource in the request is allowed", noResource.ok);

  // access tokens
  const access = connect(user);
  const owner = tokens.oauthOwner(access.pair.access_token, RESOURCE);
  expect("a live access token gives its owner", isDeepStrictEqual(owner, { grantId: access.grantId, userId: user, name: "Claude" }), JSON.stringify(owner));
  expect("another resource gives no owner", tokens.oauthOwner(access.pair.access_token, "https://rodeo.build/other") === null);
  expect("a refresh token is not an access token", tokens.oauthOwner(access.pair.refresh_token, RESOURCE) === null);
  expect("a personal access token is not one", tokens.oauthOwner(`rodeo_pat_${"A".repeat(43)}`, RESOURCE) === null);
  const expired = connect(user);
  run("UPDATE oauth_tokens SET expires_at = ? WHERE hash = ?", inMs(-1000), shared.hashOf(expired.pair.access_token));
  expect("an expired access token has no owner", tokens.oauthOwner(expired.pair.access_token, RESOURCE) === null);
  const suspendedLater = connect(other);
  run("UPDATE users SET suspended_at = ? WHERE id = ?", nowIso(), other);
  expect("a suspended account's access token has no owner", tokens.oauthOwner(suspendedLater.pair.access_token, RESOURCE) === null);
  run("UPDATE users SET suspended_at = NULL WHERE id = ?", other);
  expect("reinstating the account restores it", tokens.oauthOwner(suspendedLater.pair.access_token, RESOURCE) !== null);

  // refresh rotation (RFC 9700 §4.14)
  const rg = connect(user);
  const p1Refresh = rg.pair.refresh_token;
  const p2 = refresh(p1Refresh);
  expect("a refresh token trades for a new pair", p2.ok);
  expect("the old access token still has its owner", tokens.oauthOwner(rg.pair.access_token, RESOURCE) !== null);
  const p3 = refresh(p1Refresh);
  expect("the old refresh token again at once is a retry: a new pair", p3.ok);
  const p3Refresh = p3.ok ? p3.pair.refresh_token : "";
  expect("…and the connection is still there", grantRows(rg.grantId) === 1);
  const p4 = refresh(p3Refresh);
  expect("p3 trades for p4", p4.ok);
  const p4Refresh = p4.ok ? p4.pair.refresh_token : "";
  const p5 = refresh(p4Refresh);
  expect("p4 trades for p5", p5.ok);
  const p5Access = p5.ok ? p5.pair.access_token : "";
  expect("p3 used a second time is theft: refused", refusedAs(refresh(p3Refresh), "invalid_grant"));
  expect("…the connection is removed", grantRows(rg.grantId) === 0);
  expect("…and p5's access token has no owner", tokens.oauthOwner(p5Access, RESOURCE) === null);

  // a "retry" by someone else: the token it replaced, used later, ends the connection
  const rt = connect(user);
  const q2 = refresh(rt.pair.refresh_token);
  const q3 = refresh(rt.pair.refresh_token);
  expect("a second use at once trades for another pair", q2.ok && q3.ok);
  expect("the replaced token, q2, used later is theft: refused", refusedAs(refresh(q2.ok ? q2.pair.refresh_token : ""), "invalid_grant"));
  expect("…the connection is removed", grantRows(rt.grantId) === 0);
  expect("…and the retry's refresh token is refused too", refusedAs(refresh(q3.ok ? q3.pair.refresh_token : ""), "invalid_grant"));

  const late = connect(user);
  expect("a second connection refreshes once", refresh(late.pair.refresh_token).ok);
  run("UPDATE oauth_tokens SET used_at = ? WHERE hash = ?", inMs(-31_000), shared.hashOf(late.pair.refresh_token));
  expect("a used token 31 seconds on is theft: refused, connection removed", refusedAs(refresh(late.pair.refresh_token), "invalid_grant") && grantRows(late.grantId) === 0);

  const strict = connect(user);
  expect("a refresh for another app is refused", refusedAs(refresh(strict.pair.refresh_token, "https://other.example/c.json"), "invalid_grant"));
  expect("a refresh for another resource is invalid_target", refusedAs(refresh(strict.pair.refresh_token, CLAUDE, "https://other.example/mcp"), "invalid_target"));
  run("UPDATE oauth_tokens SET expires_at = ? WHERE hash = ?", inMs(-1000), shared.hashOf(strict.pair.refresh_token));
  expect("an expired refresh token is refused", refusedAs(refresh(strict.pair.refresh_token), "invalid_grant"));

  // revocation
  const revokedAccess = connect(user);
  expect("revoking an access token ends its connection", tokens.revokeToken(revokedAccess.pair.access_token) === true && grantRows(revokedAccess.grantId) === 0);
  const revokedRefresh = connect(user);
  expect("revoking a refresh token ends its connection too", tokens.revokeToken(revokedRefresh.pair.refresh_token) === true && grantRows(revokedRefresh.grantId) === 0);
  expect("a string that is not one of ours revokes nothing", tokens.revokeToken("junk") === false);

  // the list, removal and the count
  const older = connect(other, "First");
  const newer = connect(other, "Second");
  const listed = tokens.listGrants(other);
  expect("the connections are listed newest first", listed[0]?.clientName === "Second" && listed[1]?.clientName === "First", listed.map((g) => g.clientName).join(", "));
  expect("the list says where each app is sent back", listed[1]?.redirectUri === CALLBACK && listed[0]?.redirectUri === CALLBACK);
  expect("another user cannot remove it", tokens.removeGrant(user, newer.grantId) === false && grantRows(newer.grantId) === 1);
  expect("its owner can", tokens.removeGrant(other, newer.grantId) === true);
  expect("removing it ends its access at once", tokens.oauthOwner(newer.pair.access_token, RESOURCE) === null);
  expect("the count goes down by one", tokens.grantCount(other) === listed.length - 1, `${tokens.grantCount(other)} of ${listed.length}`);
  expect("the first connection is still there", grantRows(older.grantId) === 1);

  // the last-used write
  const touchedGrant = connect(other, "Touched");
  tokens.touchGrant(touchedGrant.grantId, "claude-ai");
  const touchedRow = get<{ last_used_at: string | null; last_client: string | null }>("SELECT last_used_at, last_client FROM oauth_grants WHERE id = ?", touchedGrant.grantId);
  expect("a call records the time and the client", typeof touchedRow?.last_used_at === "string" && touchedRow.last_client === "claude-ai");
  run("UPDATE oauth_grants SET last_used_at = ? WHERE id = ?", "2000-01-01T00:00:00.000Z", touchedGrant.grantId);
  tokens.touchGrant(touchedGrant.grantId, "claude-ai");
  expect(
    "a second call within the minute from the same client writes nothing",
    get<{ last_used_at: string | null }>("SELECT last_used_at FROM oauth_grants WHERE id = ?", touchedGrant.grantId)?.last_used_at === "2000-01-01T00:00:00.000Z",
  );
  tokens.touchGrant(touchedGrant.grantId, "cursor");
  expect("a call from another client writes", get<{ last_client: string | null }>("SELECT last_client FROM oauth_grants WHERE id = ?", touchedGrant.grantId)?.last_client === "cursor");

  // pruning
  const expiredAccess = connect(user);
  run("UPDATE oauth_tokens SET expires_at = ? WHERE hash = ?", inMs(-1000), shared.hashOf(expiredAccess.pair.access_token));
  const usedRefresh = connect(user);
  expect("a refresh for the pruning check works", refresh(usedRefresh.pair.refresh_token).ok);
  const usedRefreshHash = shared.hashOf(usedRefresh.pair.refresh_token);
  const oldCode = codeFor(user);
  run("UPDATE oauth_codes SET created_at = ? WHERE hash = ?", inMs(-2 * DAY), sha256Hex(oldCode));
  const dead = connect(user);
  const deadNext = refresh(dead.pair.refresh_token);
  const deadNextHash = deadNext.ok ? shared.hashOf(deadNext.pair.refresh_token) : "";
  run("DELETE FROM oauth_tokens WHERE hash = ?", deadNextHash);
  tokens.pruneTokens();
  expect("an expired access token is deleted", !hasRow("oauth_tokens", shared.hashOf(expiredAccess.pair.access_token)));
  expect("a used but unexpired refresh token is kept", hasRow("oauth_tokens", usedRefreshHash));
  expect("a code from two days ago is deleted", !hasRow("oauth_codes", sha256Hex(oldCode)));
  expect("a connection with a live refresh token is kept", grantRows(usedRefresh.grantId) === 1 && grantRows(expiredAccess.grantId) === 1);
  expect("a connection whose only refresh token is used is deleted", grantRows(dead.grantId) === 0);

  database().close();
} catch (err) {
  failures++;
  console.log(`FAIL the check stopped: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all good");
