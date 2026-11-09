// Checks the token store (store.ts) on a fresh database: making, listing, renaming and removing
// tokens, the bearer lookup, the last-used write, the saved tools, suspended accounts, the routes
// through a Hono app, and the connected apps (OAuth grants) the dialog lists and removes. Prints an
// ok line per check; exits 1 on any failure.
//
// Run: cd server && node src/mcp/store.check.ts

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { MAX_TOKENS, type McpTool } from "../../../web/src/features/mcp/wire.ts";

// the data folder must be chosen before config.ts reads the environment, so the server modules load late
const dir = mkdtempSync(join(tmpdir(), "mcp-store-"));
process.env.DATA_DIR = dir;

const { config } = await import("../config.ts");
const { database, get, openDatabase, run } = await import("../db.ts");
const { onError } = await import("../http.ts");
const { HttpError, nowIso, sha256Hex } = await import("../util.ts");
const store = await import("./store.ts");
const { OAUTH_SCHEMA, challengeOf, resourceOf } = await import("../oauth/shared.ts");
const oauth = await import("../oauth/tokens.ts");

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

/** True when fn throws an HttpError with this status. */
function failsWith(fn: () => unknown, status: number): boolean {
  try {
    fn();
    return false;
  } catch (err) {
    return err instanceof HttpError && err.status === status;
  }
}

function addUser(id: string, email: string): void {
  run("INSERT INTO users (id, email, name, avatar_url, created_at, plan) VALUES (?, ?, ?, ?, ?, 'free')", id, email, "Check", null, nowIso());
}

// the PKCE verifier the connected-app checks sign in with; any 43 characters will do
const GRANT_VERIFIER = "v".repeat(43);
const GRANT_CLIENT = `rodeo_dcr_${"B".repeat(22)}`;
const GRANT_REDIRECT = "http://127.0.0.1/cb";

/** Connects an app for a user the way the consent page does: a code, then its redemption. Returns the connection's id. */
function connectApp(userId: string, clientName: string): string {
  const resource = resourceOf(config.publicUrl);
  const code = oauth.createCode({
    userId,
    clientId: GRANT_CLIENT,
    clientName,
    redirectUri: GRANT_REDIRECT,
    challenge: challengeOf(GRANT_VERIFIER),
    resource,
  });
  const granted = oauth.redeemCode({ code, clientId: GRANT_CLIENT, redirectUri: GRANT_REDIRECT, verifier: GRANT_VERIFIER, resource });
  if (!granted.ok) throw new Error(`the connection was refused: ${granted.description}`);
  return granted.grantId;
}

try {
  openDatabase();
  database().exec(store.MCP_SCHEMA);
  database().exec(OAUTH_SCHEMA);
  const userId = "check-user";
  const otherId = "check-other";
  addUser(userId, "check@example.com");
  addUser(otherId, "other@example.com");

  // making a token
  const made = store.createToken(userId, "Claude Code");
  const secret = made.secret;
  expect("the secret is a rodeo_pat_ token", /^rodeo_pat_[A-Za-z0-9_-]{43}$/.test(secret));
  const [listed] = store.listTokens(userId);
  expect("the list shows it with a 14-character prefix, never used", listed?.id === made.token.id && listed.prefix === secret.slice(0, 14) && listed.prefix.length === 14 && listed.lastUsedAt === null);
  const stored = get<{ token_hash: string }>("SELECT token_hash FROM mcp_tokens WHERE id = ?", made.token.id);
  expect("only the hash is stored", stored?.token_hash === sha256Hex(secret) && stored.token_hash !== secret);
  expect("an empty name is refused with 400", failsWith(() => store.createToken(userId, "   "), 400));

  // the bearer lookup
  expect("a Bearer header finds its owner", store.tokenOwner(`Bearer ${secret}`)?.userId === userId && store.tokenOwner(`Bearer ${secret}`)?.tokenId === made.token.id);
  expect("the scheme is case-insensitive", store.tokenOwner(`bearer ${secret}`)?.userId === userId);
  expect("a wrong secret finds nothing", store.tokenOwner(`Bearer rodeo_pat_${"A".repeat(43)}`) === null);
  expect("another scheme finds nothing", store.tokenOwner("Basic x") === null);
  expect("no header finds nothing", store.tokenOwner(undefined) === null);

  // last used
  store.touchToken(made.token.id, "claude-code");
  const used = store.listTokens(userId)[0];
  expect("a call records the time and the client", used?.lastUsedAt !== null && used?.lastClient === "claude-code");
  store.touchToken(made.token.id, "cursor");
  expect("a call from another client records that client", store.listTokens(userId)[0]?.lastClient === "cursor");
  store.touchToken(made.token.id, null);
  expect("a call that names no client keeps the last one", store.listTokens(userId)[0]?.lastClient === "cursor");

  // renaming
  const renamed = store.renameToken(userId, made.token.id, "  Laptop agent  ");
  expect("a rename trims the name", renamed.name === "Laptop agent");
  expect("an empty rename is refused with 400", failsWith(() => store.renameToken(userId, made.token.id, ""), 400));
  expect("a rename of an unknown token is 404", failsWith(() => store.renameToken(userId, "nope", "x"), 404));
  expect("another user's token is 404, not renamed", failsWith(() => store.renameToken(otherId, made.token.id, "x"), 404));

  // the limit: MAX_TOKENS a user, then 409
  const kept = store.createToken(userId, "Kept");
  for (let i = store.listTokens(userId).length; i < MAX_TOKENS; i++) store.createToken(userId, `Agent ${i}`);
  expect(`${MAX_TOKENS} connections are kept`, store.listTokens(userId).length === MAX_TOKENS);
  expect("one more is refused with 409", failsWith(() => store.createToken(userId, "Extra"), 409));
  expect("the list is newest first", store.listTokens(userId)[0]?.name === `Agent ${MAX_TOKENS - 1}`, store.listTokens(userId)[0]?.name);

  // removing
  store.removeToken(userId, made.token.id);
  expect("a removed token is refused at once", store.tokenOwner(`Bearer ${secret}`) === null);
  expect("removing it again is 404", failsWith(() => store.removeToken(userId, made.token.id), 404));
  expect("the list shrinks by one", store.listTokens(userId).length === MAX_TOKENS - 1);

  // the tools a tab offered
  expect("no saved tools before a tab connects", store.loadTools(userId) === null);
  const tools: McpTool[] = [
    { name: "look_plan", description: "Pictures of the plan.", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
  ];
  store.saveTools(userId, tools, "Be kind to the drawing.");
  const back = store.loadTools(userId);
  expect("saved tools read back", JSON.stringify(back?.tools) === JSON.stringify(tools) && back?.instructions === "Be kind to the drawing.");
  store.saveTools(userId, [], "Newer");
  const newer = store.loadTools(userId);
  expect("saving again replaces them", newer?.tools.length === 0 && newer.instructions === "Newer");
  expect("another user has none", store.loadTools(otherId) === null);

  // suspended accounts
  run("UPDATE users SET suspended_at = ? WHERE id = ?", nowIso(), userId);
  expect("a suspended account's token is refused", store.tokenOwner(`Bearer ${kept.secret}`) === null);
  run("UPDATE users SET suspended_at = NULL WHERE id = ?", userId);
  expect("reinstating the account restores the token", store.tokenOwner(`Bearer ${kept.secret}`)?.userId === userId);

  // the routes, as the dialog calls them: a session cookie, then the token in each request
  const app = new Hono();
  app.onError(onError);
  store.registerTokenRoutes(app);
  const session = "check-session";
  run(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    sha256Hex(session),
    userId,
    nowIso(),
    new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  );
  const cookie = `ovx_session=${session}`;
  const json = { "content-type": "application/json", "x-requested-with": "openvwx" };
  // the routes below and the connected-app checks at the end run as the same user

  const anon = await app.request("/api/mcp/tokens");
  expect("the list needs a session (401)", anon.status === 401);

  const list = await app.request("/api/mcp/tokens", { headers: { cookie } });
  const listBody = (await list.json()) as { tokens: unknown[]; grants: unknown[]; endpoint: string };
  expect(
    "the list answers with the tokens, no connected apps yet, and the endpoint",
    list.status === 200 && listBody.tokens.length === MAX_TOKENS - 1 && Array.isArray(listBody.grants) && listBody.grants.length === 0 && listBody.endpoint === `${config.publicUrl}/mcp`,
  );

  const post = await app.request("/api/mcp/tokens", { method: "POST", headers: { cookie, ...json }, body: JSON.stringify({ name: "Route token" }) });
  const postBody = (await post.json()) as { token: { id: string; name: string }; secret: string };
  expect("POST makes a token (201) with its secret", post.status === 201 && postBody.secret.startsWith("rodeo_pat_") && postBody.token.name === "Route token");

  const badPost = await app.request("/api/mcp/tokens", { method: "POST", headers: { cookie, ...json }, body: JSON.stringify({ name: "" }) });
  expect("POST with no name is 400", badPost.status === 400 && ((await badPost.json()) as { code?: string }).code === "bad_name");

  const patch = await app.request(`/api/mcp/tokens/${postBody.token.id}`, { method: "PATCH", headers: { cookie, ...json }, body: JSON.stringify({ name: "Renamed by route" }) });
  const patchBody = (await patch.json()) as { token: { name: string } };
  expect("PATCH renames it (200)", patch.status === 200 && patchBody.token.name === "Renamed by route");

  const del = await app.request(`/api/mcp/tokens/${postBody.token.id}`, { method: "DELETE", headers: { cookie, ...json } });
  expect("DELETE removes it (204) and it stops working", del.status === 204 && store.tokenOwner(`Bearer ${postBody.secret}`) === null);

  // connected apps: an OAuth connection shows in the list as the dialog wants it, and can be removed
  const appId = connectApp(userId, "Check App");
  const withApp = await app.request("/api/mcp/tokens", { headers: { cookie } });
  const withAppBody = (await withApp.json()) as { grants: { id: string; name: string; where: string; verified: boolean; lastUsedAt: string | null }[] };
  const shown = withAppBody.grants[0];
  expect(
    "a connected app is listed: its name, not verified, sent back to this computer",
    withApp.status === 200 && withAppBody.grants.length === 1 && shown?.id === appId && shown.name === "Check App" && shown.verified === false && shown.where === "this computer",
  );
  const tokenList = (await (await app.request("/api/mcp/tokens", { headers: { cookie } })).json()) as { tokens: unknown[] };
  expect("a connected app is not counted among the tokens", tokenList.tokens.length === MAX_TOKENS - 1);

  const otherAppId = connectApp(otherId, "Other's App");
  const notMine = await app.request(`/api/mcp/grants/${otherAppId}`, { method: "DELETE", headers: { cookie, ...json } });
  expect("another user's connected app is 404, not removed", notMine.status === 404 && oauth.listGrants(otherId).length === 1);

  const gone = await app.request(`/api/mcp/grants/${appId}`, { method: "DELETE", headers: { cookie, ...json } });
  expect("DELETE removes a connected app (204)", gone.status === 204 && oauth.listGrants(userId).length === 0);
  const goneAgain = await app.request(`/api/mcp/grants/${appId}`, { method: "DELETE", headers: { cookie, ...json } });
  expect("removing it again is 404", goneAgain.status === 404);

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
