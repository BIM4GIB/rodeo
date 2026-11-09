// Checks the whole OAuth sign-in over real HTTP, the way claude.ai, Claude Code and a browser use it:
// the discovery documents, registration, the authorize and consent pages with their refusals, codes
// at the token endpoint, refresh rotation with reuse detection, revocation, the Connect an Agent list,
// the metadata documents of apps that name themselves by address, expiry and pruning. The steps marked
// (mcp) call /mcp and the Connect an Agent routes with OAuth tokens. FLOW_SKIP_MCP=1 skips them and
// prints each as skip. Prints an ok line per check; exits 1 on any failure.
//
// Run: cd server && node src/oauth/flow.check.ts
//      cd server && FLOW_SKIP_MCP=1 node src/oauth/flow.check.ts

import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocket } from "ws";

// the data folder, the public address and the environment must be set before config.ts reads them, so the server modules load late
const dir = mkdtempSync(join(tmpdir(), "oauth-flow-"));
process.env.DATA_DIR = dir;
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.NODE_ENV = "development";

const { database, get, openDatabase, run } = await import("../db.ts");
const { DAY, inMs, nowIso, sha256Hex } = await import("../util.ts");
const shared = await import("./shared.ts");
const tokens = await import("./tokens.ts");
const clients = await import("./clients.ts");
const oauth = await import("./index.ts");
const { onError } = await import("../http.ts");

const SKIP_MCP = process.env.FLOW_SKIP_MCP === "1";
const mcp = SKIP_MCP ? null : await import("../mcp/index.ts");
const store = SKIP_MCP ? null : await import("../mcp/store.ts");

const PUBLIC = "http://127.0.0.1";
const RESOURCE = "http://127.0.0.1/mcp";
// another port than the one registered below: the loopback rule (RFC 8252 §7.3)
const LOOPBACK = "http://127.0.0.1:43123/callback";
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const BINDER = "ovx_oauth_req";

/** A JSON answer read loosely: the checks look at a few fields. */
type Obj = Record<string, any>;

/** The cookies one browser holds for the site, by name. */
type Jar = Record<string, string>;

/** One HTTP answer, read to the end. */
interface Got {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly location: string | null;
  readonly setCookies: readonly string[];
}

/** A request's parts: a form, a JSON body, extra headers and the cookies sent. */
interface Req {
  readonly form?: URLSearchParams;
  readonly json?: unknown;
  readonly headers?: Record<string, string>;
  readonly cookies?: Jar;
}

/** An authorize request as the check made it: the answer, and the verifier and state it used. */
interface Asked {
  readonly got: Got;
  readonly verifier: string;
  readonly state: string;
}

/** A fake Rodeo tab: it welcomes, answers echo, and keeps the calls it was sent. */
interface FakeTab {
  readonly ws: WebSocket;
  readonly calls: { readonly id: string; readonly tool: string; readonly agent: string }[];
}

let failures = 0;
let port = 0;
let BASE = "";
let DCR = "";
let meta: Obj = {};
let nextId = 1;
let stateN = 0;
/** The browser the person uses: signed in as u1, and it picks up the binder cookie on the first authorize. */
const browser: Jar = { ovx_session: "sess" };

/** Prints one check's line. The detail is shown only when the check fails, so a passing run stays short. */
function expect(label: string, ok: boolean, detail = ""): void {
  console.log(ok ? `ok   ${label}` : `FAIL ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

function skip(label: string): void {
  console.log(`skip ${label}`);
}

/** A path on the server, or a full address Rodeo gave out, with its host swapped for the check's port. */
function at(address: string): string {
  if (address.startsWith("/")) return `${BASE}${address}`;
  const u = new URL(address);
  return `${BASE}${u.pathname}${u.search}`;
}

/** The cookies a response sets, name to value; a cookie being cleared has an empty value. */
function cookiesOf(setCookies: readonly string[]): Jar {
  const jar: Jar = {};
  for (const line of setCookies) {
    const pair = line.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) jar[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return jar;
}

/** Sends a request to the server and reads the answer to the end. Redirects are not followed. */
async function http(method: string, address: string, req: Req = {}): Promise<Got> {
  const headers: Record<string, string> = { ...req.headers };
  if (req.cookies && Object.keys(req.cookies).length > 0) {
    headers.cookie = Object.entries(req.cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }
  let body: string | undefined;
  if (req.form) {
    body = req.form.toString();
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  if (req.json !== undefined) {
    body = JSON.stringify(req.json);
    headers["content-type"] = "application/json";
  }
  const res = await fetch(at(address), { method, headers, body, redirect: "manual" });
  return {
    status: res.status,
    headers: res.headers,
    text: await res.text(),
    location: res.headers.get("location"),
    setCookies: res.headers.getSetCookie(),
  };
}

/** An answer's body as JSON. */
function parse(got: Got): Obj {
  return JSON.parse(got.text) as Obj;
}

/** The MCP calls' headers: a bearer token, and the JSON answers the endpoint gives. */
function bearer(token: string): Record<string, string> {
  return { accept: "application/json", authorization: `Bearer ${token}` };
}

/** A JSON-RPC request with a fresh id. */
function rpc(method: string, params: Record<string, unknown> = {}): Record<string, unknown> {
  return { jsonrpc: "2.0", id: nextId++, method, params };
}

/** The names of the tools in a tools/list answer. */
function namesOf(got: Got): string[] {
  return ((parse(got).result?.tools ?? []) as { name: string }[]).map((t) => t.name);
}

/** A verifier (43 characters, as an app makes one) and its S256 challenge. */
function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: shared.challengeOf(verifier) };
}

/** The consent page's csrf value, read from its HTML. */
function csrfOf(text: string): string {
  return /name="csrf" value="([^"]+)"/.exec(text)?.[1] ?? "";
}

/**
 * Sends the browser to the authorize step. `extra` changes the parameters: null drops one, an array
 * repeats it. Returns the answer with the verifier and state it used. Cookies it sets go to the browser.
 */
async function authorize(clientId: string, redirectUri: string, extra: Record<string, string | string[] | null> = {}): Promise<Asked> {
  const { verifier, challenge } = pkce();
  const state = `st-${++stateN}`;
  const params: Record<string, string | string[] | null> = {
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    scope: "drawings offline_access",
    resource: RESOURCE,
    ...extra,
  };
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === null) continue;
    for (const v of Array.isArray(value) ? value : [value]) query.append(name, v);
  }
  const got = await http("GET", `${at(meta.authorization_endpoint as string)}?${query}`, { cookies: browser });
  Object.assign(browser, cookiesOf(got.setCookies));
  return { got, verifier, state };
}

/** True when an authorize answer is a redirect to the app's address with this error, the state the app sent, and Rodeo's issuer. */
function backWith(asked: Asked, error: string): boolean {
  const loc = asked.got.location ?? "";
  if (asked.got.status !== 302 || !loc.startsWith(`${LOOPBACK}?`)) return false;
  const u = new URL(loc);
  return (
    u.searchParams.get("error") === error &&
    u.searchParams.get("state") === asked.state &&
    u.searchParams.get("iss") === PUBLIC &&
    loc.includes("iss=http%3A%2F%2F127.0.0.1")
  );
}

/** Opens the consent page of a request the browser just started: its request id and csrf value. */
async function consentOf(got: Got, cookies: Jar = browser): Promise<{ id: string; csrf: string; page: Got }> {
  const id = new URL(got.location ?? "", PUBLIC).searchParams.get("request") ?? "";
  const page = await http("GET", `/oauth/consent?request=${id}`, { cookies });
  return { id, csrf: csrfOf(page.text), page };
}

/** The person's side of a connect: authorize, then Allow (or Cancel) on the consent page. Returns the code made and the verifier it belongs to. */
async function approve(clientId: string, redirectUri: string, decision = "allow"): Promise<{ code: string; verifier: string }> {
  const asked = await authorize(clientId, redirectUri);
  const consent = await consentOf(asked.got);
  const posted = await http("POST", "/oauth/consent", {
    form: new URLSearchParams({ request: consent.id, csrf: consent.csrf, decision }),
    headers: { origin: PUBLIC },
    cookies: browser,
  });
  const code = new URL(posted.location ?? "http://invalid/").searchParams.get("code") ?? "";
  return { code, verifier: asked.verifier };
}

/** A form post to the token endpoint. */
function tokenReq(form: Record<string, string>): Promise<Got> {
  return http("POST", meta.token_endpoint as string, { form: new URLSearchParams(form) });
}

/** Trades a code for a pair of tokens, as the app does. */
function exchange(code: string, verifier: string, clientId = DCR): Promise<Got> {
  return tokenReq({ grant_type: "authorization_code", code, redirect_uri: LOOPBACK, client_id: clientId, code_verifier: verifier, resource: RESOURCE });
}

/** Trades a refresh token for a new pair. */
function refresh(token: string): Promise<Got> {
  return tokenReq({ grant_type: "refresh_token", refresh_token: token, client_id: DCR });
}

/** The access token an OAuth connection's owner check finds, or null. */
function ownerOf(token: string | undefined): string | null {
  return token ? (tokens.oauthOwner(token, RESOURCE)?.name ?? null) : null;
}

/** A fake Rodeo tab for alice: it welcomes, answers echo, and keeps the calls it was sent. */
async function openTab(): Promise<FakeTab> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/mcp/live`, { headers: { cookie: "u=alice", origin: `http://127.0.0.1:${port}` } });
  ws.on("error", () => {});
  const calls: { id: string; tool: string; agent: string }[] = [];
  const welcomed = new Promise<void>((resolve) => {
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString()) as { t: string; id: string; tool: string; agent: string; args: unknown };
      if (m.t === "welcome") resolve();
      else if (m.t === "call") {
        calls.push({ id: m.id, tool: m.tool, agent: m.agent });
        if (m.tool === "echo") {
          ws.send(JSON.stringify({ t: "result", id: m.id, result: { content: [{ type: "text", text: JSON.stringify(m.args) }], isError: false } }));
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  ws.send(
    JSON.stringify({
      t: "hello",
      tabId: "oauth-flow-tab",
      focused: true,
      visible: true,
      drawing: { name: "Flow drawing", fileId: null, readOnly: false },
      tools: [{ name: "echo", description: "Echoes its arguments.", inputSchema: { type: "object", properties: {} } }],
      instructions: "Test tab for the OAuth flow check.",
    }),
  );
  await welcomed;
  return { ws, calls };
}

function addUser(id: string, email: string, name: string): void {
  run("INSERT INTO users (id, email, name, avatar_url, created_at, plan) VALUES (?, ?, ?, ?, ?, 'free')", id, email, name, null, nowIso());
}

/** Starts a session row for a user and returns the cookie value that reaches it. */
function addSession(value: string, userId: string): void {
  run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256Hex(value), userId, nowIso(), inMs(30 * DAY));
}

let server: Server | null = null;
let tab: FakeTab | null = null;

try {
  openDatabase();
  database().exec(shared.OAUTH_SCHEMA);
  if (store) database().exec(store.MCP_SCHEMA);
  addUser("u1", "alice@example.com", "Alice");
  addSession("sess", "u1");

  const app = new Hono();
  app.onError(onError);
  if (mcp) mcp.registerMcp(app);
  oauth.registerOAuth(app);
  server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }) as Server;
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
  BASE = `http://127.0.0.1:${port}`;
  if (mcp) {
    mcp.attachMcp(server, {
      userFromRequest: (req) => (req.headers.cookie === "u=alice" ? { id: "u1", name: "Alice" } : null),
    });
  }

  // 1. discovery: a call to /mcp with no token is told where the metadata is
  if (SKIP_MCP) {
    skip("discovery: /mcp answers 401 with the metadata address (mcp)");
  } else {
    const noAuth = await http("POST", "/mcp", { json: rpc("tools/list"), headers: { accept: "application/json" } });
    const challenge = noAuth.headers.get("www-authenticate") ?? "";
    expect("no token: /mcp answers 401 with Rodeo's challenge", noAuth.status === 401 && challenge === shared.wwwAuthenticate(PUBLIC, false), challenge);
    expect("the challenge names the metadata address", challenge.includes(`resource_metadata="${shared.metadataUrlOf(PUBLIC)}"`));
  }

  // 2. protected resource metadata, for the endpoint and for the bare origin
  const prm = await http("GET", new URL(shared.metadataUrlOf(PUBLIC)).pathname);
  const prmBody = parse(prm);
  expect(
    "protected resource metadata: 200, the endpoint as resource, the origin as its authorization server, CORS",
    prm.status === 200 &&
      prmBody.resource === RESOURCE &&
      prmBody.authorization_servers?.[0] === PUBLIC &&
      prm.headers.get("access-control-allow-origin") === "*",
  );
  const root = await http("GET", "/.well-known/oauth-protected-resource");
  expect("the root form names the origin as its resource", root.status === 200 && parse(root).resource === PUBLIC);

  // 3. authorization server metadata, and the paths that must say there is no OpenID Connect
  const asRes = await http("GET", "/.well-known/oauth-authorization-server");
  meta = parse(asRes);
  expect("AS metadata: 200, and its issuer is the server the endpoint names", asRes.status === 200 && meta.issuer === prmBody.authorization_servers[0]);
  expect(
    "AS metadata: S256 PKCE, client metadata documents, no client authentication, iss in responses",
    (meta.code_challenge_methods_supported ?? []).includes("S256") &&
      meta.client_id_metadata_document_supported === true &&
      JSON.stringify(meta.token_endpoint_auth_methods_supported) === JSON.stringify(["none"]) &&
      meta.authorization_response_iss_parameter_supported === true,
  );
  expect("AS metadata: no offline_access scope", !(meta.scopes_supported ?? []).includes("offline_access"));
  const oidc = await http("GET", "/.well-known/openid-configuration");
  expect("OpenID Connect discovery answers 404 JSON", oidc.status === 404 && parse(oidc).error === "not_found");
  const preflight = await http("OPTIONS", "/oauth/token");
  expect("OPTIONS /oauth/token answers 204 with CORS", preflight.status === 204 && preflight.headers.get("access-control-allow-origin") === "*");

  // 4. registration: an app registers its redirect addresses, and unsafe ones are refused
  const reg = await http("POST", meta.registration_endpoint as string, {
    json: {
      client_name: "Flow Check",
      redirect_uris: ["http://127.0.0.1/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    },
  });
  DCR = parse(reg).client_id ?? "";
  expect("registration: 201 with a rodeo_dcr_ client id", reg.status === 201 && DCR.startsWith("rodeo_dcr_"), reg.text);
  const js = await http("POST", meta.registration_endpoint as string, { json: { redirect_uris: ["javascript:alert(1)"] } });
  expect("registration: a javascript: redirect is refused", js.status === 400 && parse(js).error === "invalid_redirect_uri");
  const plain = await http("POST", meta.registration_endpoint as string, { json: { redirect_uris: ["http://example.com/cb"] } });
  expect("registration: a plain http redirect off this computer is refused", plain.status === 400);

  // 5. the authorize step refuses what it must, and sends back what it can
  const unknown = await authorize(`rodeo_dcr_${"A".repeat(22)}`, LOOPBACK);
  expect("an unknown client_id: an error page, no redirect", unknown.got.status === 400 && unknown.got.location === null && unknown.got.text.includes("<!doctype html>"));
  const wrongRedirect = await authorize(DCR, "http://127.0.0.1:43123/other");
  expect("an unregistered redirect_uri: an error page, no redirect", wrongRedirect.got.status === 400 && wrongRedirect.got.location === null);
  const twice = await authorize(DCR, LOOPBACK, { client_id: [DCR, DCR] });
  expect("client_id given twice: an error page, no redirect", twice.got.status === 400 && twice.got.location === null);
  const noChallenge = await authorize(DCR, LOOPBACK, { code_challenge: null });
  expect("no code_challenge: back to the app with invalid_request, its state and iss", backWith(noChallenge, "invalid_request"));
  const plainMethod = await authorize(DCR, LOOPBACK, { code_challenge_method: "plain" });
  expect("code_challenge_method=plain: invalid_request", backWith(plainMethod, "invalid_request"));
  const elsewhere = await authorize(DCR, LOOPBACK, { resource: "https://evil.example/mcp" });
  expect("a resource elsewhere: invalid_target", backWith(elsewhere, "invalid_target"));
  const tokenType = await authorize(DCR, LOOPBACK, { response_type: "token" });
  expect("response_type=token: unsupported_response_type", backWith(tokenType, "unsupported_response_type"));
  const promptNone = await authorize(DCR, LOOPBACK, { prompt: "none" });
  expect("prompt=none: interaction_required, back to the app", backWith(promptNone, "interaction_required"));
  // an app on a web address Rodeo can't vouch for gets its errors on Rodeo's page, never a redirect
  const webReg = await http("POST", meta.registration_endpoint as string, {
    json: { client_name: "Web App", redirect_uris: ["https://app.example/callback"], token_endpoint_auth_method: "none" },
  });
  const WEB = parse(webReg).client_id ?? "";
  const webToken = await authorize(WEB, "https://app.example/callback", { response_type: "token" });
  expect(
    "an unverified web app's bad request: an error page, no redirect",
    webReg.status === 201 && webToken.got.status === 400 && webToken.got.location === null && webToken.got.text.includes("unsupported_response_type"),
    webToken.got.text.slice(0, 200),
  );
  const longState = await authorize(DCR, LOOPBACK, { state: "s".repeat(4097) });
  const longStateUrl = new URL(longState.got.location ?? "http://invalid/");
  expect(
    "a state over 4096 characters: invalid_request, and the state isn't echoed",
    longState.got.status === 302 && longStateUrl.searchParams.get("error") === "invalid_request" && longStateUrl.searchParams.get("state") === null,
  );

  // 6. the consent page: signed in it shows the request, signed out it asks to sign in, and it is bound to its browser
  const first = await authorize(DCR, LOOPBACK);
  const firstLoc = first.got.location ?? "";
  expect("a valid request: 302 to the consent page", first.got.status === 302 && firstLoc.startsWith("/oauth/consent?request="));
  const binderSet = first.got.setCookies.find((line) => line.startsWith(`${BINDER}=`)) ?? "";
  expect("the binder cookie is HttpOnly and scoped to /oauth", binderSet.includes("Path=/oauth") && /HttpOnly/i.test(binderSet), binderSet);
  // without redirect_uri, a client with one registered address is sent to that one
  const noRedirect = await authorize(DCR, LOOPBACK, { redirect_uri: null });
  expect("no redirect_uri and one registered: straight to the consent page", noRedirect.got.status === 302 && (noRedirect.got.location ?? "").startsWith("/oauth/consent?request="));
  const consent = await consentOf(first.got);
  const h = consent.page.headers;
  expect(
    "the consent page: 200 with the app, this computer, and the warning",
    consent.page.status === 200 &&
      consent.page.text.includes("Flow Check") &&
      consent.page.text.includes("this computer") &&
      consent.page.text.includes("allow it only if"),
  );
  expect(
    "the consent page has its strict headers",
    (h.get("content-security-policy") ?? "").includes("frame-ancestors 'none'") &&
      h.get("x-frame-options") === "DENY" &&
      h.get("cache-control") === "no-store" &&
      h.get("x-openvwx-page") === "oauth" &&
      h.get("content-type") === "text/html; charset=utf-8",
  );
  expect("the consent page carries a csrf value", consent.csrf.length > 0);
  const signedOut = await http("GET", `/oauth/consent?request=${consent.id}`, { cookies: { [BINDER]: browser[BINDER] ?? "" } });
  expect("signed out: the sign-in page (200)", signedOut.status === 200 && signedOut.text.includes("Sign in to Rodeo"));
  const otherBrowser = await http("GET", `/oauth/consent?request=${consent.id}`, { cookies: { ovx_session: "sess" } });
  expect("without the binder cookie: 400, another browser", otherBrowser.status === 400 && otherBrowser.text.includes("another browser"));
  const nope = await http("GET", "/oauth/consent?request=nope", { cookies: browser });
  expect("an unknown request: 400, expired", nope.status === 400 && nope.text.includes("expired"));

  // 7. the consent post: refused without the csrf value or from another site, then Allow gives a code once
  const wrongCsrf = await http("POST", "/oauth/consent", {
    form: new URLSearchParams({ request: consent.id, csrf: "wrong", decision: "allow" }),
    headers: { origin: PUBLIC },
    cookies: browser,
  });
  expect("a wrong csrf value: 403", wrongCsrf.status === 403);
  const evilOrigin = await http("POST", "/oauth/consent", {
    form: new URLSearchParams({ request: consent.id, csrf: consent.csrf, decision: "allow" }),
    headers: { origin: "https://evil.example" },
    cookies: browser,
  });
  expect("a post from another site: 403", evilOrigin.status === 403);
  const allow = await http("POST", "/oauth/consent", {
    form: new URLSearchParams({ request: consent.id, csrf: consent.csrf, decision: "allow" }),
    cookies: browser,
  });
  const allowLoc = allow.location ?? "";
  expect("Allow: 303 back to the app with a code, the state and iss", allow.status === 303 && allowLoc.startsWith(`${LOOPBACK}?code=rodeo_ac_`), allowLoc);
  const back = new URL(allowLoc || "http://invalid/");
  expect(
    "the code redirect carries the state, and iss in the form RFC 9207 expects",
    back.searchParams.get("state") === first.state && back.searchParams.get("iss") === PUBLIC && allowLoc.includes("iss=http%3A%2F%2F127.0.0.1"),
  );
  const firstCode = back.searchParams.get("code") ?? "";
  const replay = await http("POST", "/oauth/consent", {
    form: new URLSearchParams({ request: consent.id, csrf: consent.csrf, decision: "allow" }),
    cookies: browser,
  });
  expect("the same consent post again: 400, the sign-in is used up", replay.status === 400);

  const denyAsk = await authorize(DCR, LOOPBACK);
  const denyConsent = await consentOf(denyAsk.got);
  const denied = await http("POST", "/oauth/consent", {
    form: new URLSearchParams({ request: denyConsent.id, csrf: denyConsent.csrf, decision: "deny" }),
    headers: { origin: PUBLIC },
    cookies: browser,
  });
  const deniedUrl = new URL(denied.location ?? "http://invalid/");
  expect(
    "Cancel: 303 back with access_denied and the state",
    denied.status === 303 && deniedUrl.searchParams.get("error") === "access_denied" && deniedUrl.searchParams.get("state") === denyAsk.state,
  );

  // signing out on the consent page ends the session and keeps the sign-in waiting
  addSession("sess-s", "u1");
  const outAsk = await authorize(DCR, LOOPBACK);
  const outCookies: Jar = { ovx_session: "sess-s", [BINDER]: browser[BINDER] ?? "" };
  const outConsent = await consentOf(outAsk.got, outCookies);
  const outPost = await http("POST", "/oauth/consent/signout", {
    form: new URLSearchParams({ request: outConsent.id, csrf: outConsent.csrf }),
    headers: { origin: PUBLIC },
    cookies: outCookies,
  });
  expect("sign out on the consent page: 303 back to the same sign-in", outPost.status === 303 && outPost.location === `/oauth/consent?request=${outConsent.id}`);
  const gone = get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?", sha256Hex("sess-s"))?.n === 0;
  expect("sign out removes the session", gone);
  const signedBack = await http("GET", `/oauth/consent?request=${outConsent.id}`, { cookies: { [BINDER]: browser[BINDER] ?? "" } });
  expect("the same sign-in now shows the sign-in page", signedBack.status === 200 && signedBack.text.includes("Sign in to Rodeo"));

  // 8. codes at the token endpoint
  const A = await exchange(firstCode, first.verifier);
  const aPair = parse(A);
  expect(
    "a code redeemed: a Bearer pair for drawings, no-store",
    A.status === 200 &&
      aPair.token_type === "Bearer" &&
      aPair.expires_in === 3600 &&
      aPair.scope === "drawings" &&
      String(aPair.access_token).startsWith("rodeo_at_") &&
      String(aPair.refresh_token).startsWith("rodeo_rt_") &&
      A.headers.get("cache-control") === "no-store",
    A.text,
  );
  const aAgain = await exchange(firstCode, first.verifier);
  expect("the same code again: invalid_grant", aAgain.status === 400 && parse(aAgain).error === "invalid_grant");

  const b = await approve(DCR, LOOPBACK);
  const bWrong = await exchange(b.code, pkce().verifier);
  expect("a wrong code_verifier: invalid_grant", bWrong.status === 400 && parse(bWrong).error === "invalid_grant");
  const bRight = await exchange(b.code, b.verifier);
  expect("then the right verifier: still invalid_grant, the code is used up", bRight.status === 400 && parse(bRight).error === "invalid_grant");

  const c = await approve(DCR, LOOPBACK);
  const basic = Buffer.from(`${encodeURIComponent(DCR)}:`).toString("base64");
  const C = await http("POST", meta.token_endpoint as string, {
    form: new URLSearchParams({ grant_type: "authorization_code", code: c.code, redirect_uri: LOOPBACK, code_verifier: c.verifier, resource: RESOURCE }),
    headers: { authorization: `Basic ${basic}` },
  });
  expect("client_id in HTTP Basic only: 200", C.status === 200, C.text);

  const d = await approve(DCR, LOOPBACK);
  const D = await http("POST", meta.token_endpoint as string, {
    json: { grant_type: "authorization_code", code: d.code, redirect_uri: LOOPBACK, client_id: DCR, code_verifier: d.verifier, resource: RESOURCE },
  });
  expect("a JSON body: 200", D.status === 200, D.text);
  const dPair = parse(D);
  expect("the JSON connection is named for the app and found by its owner check", ownerOf(dPair.access_token) === "Flow Check");

  const pw = await tokenReq({ grant_type: "password", client_id: DCR, username: "x", password: "y" });
  expect("grant_type=password: 400 unsupported_grant_type", pw.status === 400 && parse(pw).error === "unsupported_grant_type");
  const noClient = await http("POST", meta.token_endpoint as string, {
    form: new URLSearchParams({ grant_type: "authorization_code", code: "x", code_verifier: "y" }),
  });
  expect("no client_id anywhere: 401 invalid_client", noClient.status === 401 && parse(noClient).error === "invalid_client");

  // 9. the tokens at /mcp, and the Connect an Agent list (mcp)
  if (SKIP_MCP) {
    skip("A's access token, its code used twice: 401 invalid_token (mcp)");
    skip("D's access token: initialize, tools/list and a call reach the tab as the app (mcp)");
    skip("the dialog's list shows the connection: where, not verified, last used (mcp)");
  } else {
    tab = await openTab();
    const aGone = await http("POST", "/mcp", { json: rpc("tools/list"), headers: bearer(aPair.access_token) });
    expect("A's access token, its code used twice: 401 invalid_token", aGone.status === 401 && (aGone.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'));
    const init = await http("POST", "/mcp", {
      json: rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check-oauth", version: "1" } }),
      headers: bearer(dPair.access_token),
    });
    expect("D's token: initialize echoes the protocol version", parse(init).result?.protocolVersion === "2025-06-18");
    const list = await http("POST", "/mcp", { json: rpc("tools/list"), headers: bearer(dPair.access_token) });
    const names = namesOf(list);
    expect("tools/list names echo and list_drawings", names.includes("echo") && names.includes("list_drawings"), names.join(","));
    await http("POST", "/mcp", { json: rpc("tools/call", { name: "echo", arguments: { hello: "oauth" } }), headers: bearer(dPair.access_token) });
    expect("tools/call reaches the tab, named for the app", tab.calls.some((x) => x.tool === "echo" && x.agent === "Flow Check"));
    const listed = await http("GET", "/api/mcp/tokens", { cookies: browser, headers: { "x-requested-with": "openvwx" } });
    const grants = (parse(listed).grants ?? []) as Obj[];
    const mine = grants.find((g) => g.name === "Flow Check");
    expect(
      "the dialog's list shows the connection: this computer, not verified, last used",
      !!mine && mine.where === "this computer" && mine.verified === false && mine.lastUsedAt !== null,
      JSON.stringify(mine ?? grants),
    );
  }
  // 10. refresh rotation, and reuse detection
  const dRefresh = await refresh(dPair.refresh_token);
  const E = parse(dRefresh);
  expect("refresh: 200 with a new pair", dRefresh.status === 200 && E.refresh_token !== dPair.refresh_token && E.access_token !== dPair.access_token, dRefresh.text);
  const eRefresh = await refresh(E.refresh_token);
  const G = parse(eRefresh);
  expect("refreshing the new pair: 200", eRefresh.status === 200, eRefresh.text);
  const dAgain = await refresh(dPair.refresh_token);
  expect("a used refresh token whose replacement was used too: invalid_grant", dAgain.status === 400 && parse(dAgain).error === "invalid_grant");
  const gAgain = await refresh(G.refresh_token);
  expect("the connection was removed: G's refresh is invalid_grant", gAgain.status === 400 && parse(gAgain).error === "invalid_grant");
  expect("the connection was removed: G's access is no longer its owner's", ownerOf(G.access_token) === null);
  if (SKIP_MCP) skip("G's access token at /mcp: 401 after reuse (mcp)");
  else {
    const gMcp = await http("POST", "/mcp", { json: rpc("tools/list"), headers: bearer(G.access_token) });
    expect("G's access token at /mcp: 401 after reuse", gMcp.status === 401);
  }

  const h1 = await approve(DCR, LOOPBACK);
  const H = parse(await exchange(h1.code, h1.verifier));
  const hFirst = await refresh(H.refresh_token);
  const I = parse(hFirst);
  const hRetry = await refresh(H.refresh_token);
  const J = parse(hRetry);
  expect("a refresh repeated at once is a lost answer: 200 with a fresh pair", hRetry.status === 200 && J.refresh_token !== I.refresh_token, hRetry.text);
  const jRefresh = await refresh(J.refresh_token);
  expect("the retry's pair refreshes: 200", jRefresh.status === 200, jRefresh.text);
  const iRefresh = await refresh(I.refresh_token);
  expect("the replaced token from the first answer, used later: invalid_grant", iRefresh.status === 400 && parse(iRefresh).error === "invalid_grant");
  const jNext = await refresh(parse(jRefresh).refresh_token);
  expect("…and it ended the connection: the retry's newest token is refused", jNext.status === 400 && parse(jNext).error === "invalid_grant");

  // 11. revocation
  const k = await approve(DCR, LOOPBACK);
  const K = parse(await exchange(k.code, k.verifier));
  const revoked = await http("POST", meta.revocation_endpoint as string, { form: new URLSearchParams({ token: K.access_token }) });
  expect("revocation: 200", revoked.status === 200);
  expect("revoked: the access token has no owner", ownerOf(K.access_token) === null);
  const kRefresh = await refresh(K.refresh_token);
  expect("revoked: the refresh token is invalid_grant", kRefresh.status === 400 && parse(kRefresh).error === "invalid_grant");
  const junk = await http("POST", meta.revocation_endpoint as string, { form: new URLSearchParams({ token: "junk" }) });
  expect("revoking a token that isn't ours: still 200", junk.status === 200);
  if (SKIP_MCP) skip("K's access token at /mcp: 401 once revoked (mcp)");
  else {
    const kMcp = await http("POST", "/mcp", { json: rpc("tools/list"), headers: bearer(K.access_token) });
    expect("K's access token at /mcp: 401 once revoked", kMcp.status === 401);
  }

  // 12. removing a connection from the dialog (mcp)
  if (SKIP_MCP) {
    skip("Remove in the dialog: 204, then the token is refused and the second remove is 404 (mcp)");
  } else {
    const l = await approve(DCR, LOOPBACK);
    const L = parse(await exchange(l.code, l.verifier));
    const lId = tokens.oauthOwner(L.access_token, RESOURCE)?.grantId ?? "";
    const removed = await http("DELETE", `/api/mcp/grants/${lId}`, { cookies: browser, headers: { "x-requested-with": "openvwx" } });
    expect("Remove in the dialog: 204", removed.status === 204, removed.text);
    const lMcp = await http("POST", "/mcp", { json: rpc("tools/list"), headers: bearer(L.access_token) });
    expect("the removed connection's token is refused at /mcp", lMcp.status === 401);
    const removedAgain = await http("DELETE", `/api/mcp/grants/${lId}`, { cookies: browser, headers: { "x-requested-with": "openvwx" } });
    expect("removing it again: 404", removedAgain.status === 404);
  }

  // 13. apps that name themselves by a metadata address
  clients.setDocFetcher(async (url) => {
    const doc = shared.PINNED_DOCS[url];
    if (doc) return { body: doc, maxAgeMs: null };
    throw new Error("the check has no copy of this document");
  });
  const claude = await authorize(CLAUDE, CLAUDE_CALLBACK);
  expect("Claude's document: 302 to the consent page", claude.got.status === 302 && (claude.got.location ?? "").startsWith("/oauth/consent?request="));
  const claudePage = await http("GET", claude.got.location ?? "/", { cookies: browser });
  expect(
    "Claude's consent page names Claude and claude.ai, and isn't marked not verified",
    claudePage.status === 200 && claudePage.text.includes("Claude") && claudePage.text.includes("claude.ai") && !claudePage.text.includes("Not verified"),
  );
  const tools = await authorize("https://tools.example/c.json", LOOPBACK);
  expect("a document that can't be read: an error page naming its host, no redirect", tools.got.status === 400 && tools.got.location === null && tools.got.text.includes("tools.example"));
  const evilCallback = await authorize(CLAUDE, "https://evil.example/cb");
  expect("Claude asking for a redirect it didn't register: 400, no redirect", evilCallback.got.status === 400 && evilCallback.got.location === null);

  // 14. personal access tokens still work (mcp)
  if (SKIP_MCP || !store) {
    skip("a personal access token still reaches /mcp (mcp)");
  } else {
    const pat = store.createToken("u1", "PAT").secret;
    const patList = await http("POST", "/mcp", { json: rpc("tools/list"), headers: bearer(pat) });
    expect("a personal access token still works: tools/list 200", patList.status === 200 && namesOf(patList).includes("echo"));
  }

  // 15. expiry: an expired access token is no longer its owner's, and /mcp refuses it
  run("UPDATE oauth_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE kind = 'access'");
  expect("an expired access token has no owner", ownerOf(J.access_token) === null);
  if (SKIP_MCP) skip("an expired access token at /mcp: 401 invalid_token (mcp)");
  else {
    const jMcp = await http("POST", "/mcp", { json: rpc("tools/list"), headers: bearer(J.access_token) });
    expect("an expired access token at /mcp: 401 invalid_token", jMcp.status === 401 && (jMcp.headers.get("www-authenticate") ?? "").includes('error="invalid_token"'));
  }

  // 15a. the limit of connected apps: with 50 connections, Allow answers with a page and no code
  const have = tokens.grantCount("u1");
  for (let i = have; i < shared.MAX_GRANTS; i++) {
    run(
      "INSERT INTO oauth_grants (id, user_id, client_id, client_name, redirect_uri, scope, resource, created_at) VALUES (?, 'u1', ?, 'Filler', ?, 'drawings', ?, ?)",
      `cap-${i}`,
      DCR,
      LOOPBACK,
      RESOURCE,
      nowIso(),
    );
  }
  const capAsk = await authorize(DCR, LOOPBACK);
  const capConsent = await consentOf(capAsk.got);
  const capPost = await http("POST", "/oauth/consent", {
    form: new URLSearchParams({ request: capConsent.id, csrf: capConsent.csrf, decision: "allow" }),
    headers: { origin: PUBLIC },
    cookies: browser,
  });
  expect("at 50 connections, Allow answers with a page and no code", capPost.status === 409 && capPost.text.includes("50 connected apps"), String(capPost.status));
  run("DELETE FROM oauth_grants WHERE id LIKE ?", "cap-%");

  // 15b. the other routes: a GET on the token endpoint, the size caps, and an unknown page under /oauth
  const getToken = await http("GET", "/oauth/token");
  expect("GET /oauth/token: 405 JSON that says to use POST", getToken.status === 405 && getToken.headers.get("allow") === "POST" && parse(getToken).error === "invalid_request");
  const bigForm = await http("POST", "/oauth/token", { form: new URLSearchParams({ grant_type: "authorization_code", pad: "x".repeat(17 * 1024) }) });
  expect("a token request over 16 KB: 413 invalid_request", bigForm.status === 413 && parse(bigForm).error === "invalid_request");
  const bigReg = await http("POST", "/oauth/register", { json: { client_name: "x".repeat(17 * 1024), redirect_uris: ["http://127.0.0.1/callback"] } });
  expect("a registration over 16 KB: 413 invalid_client_metadata", bigReg.status === 413 && parse(bigReg).error === "invalid_client_metadata");
  const unknownPage = await http("GET", "/oauth/nothing-here");
  expect("an unknown page under /oauth: 404 with the error page", unknownPage.status === 404 && unknownPage.text.includes("Nothing here"));

  // 16. pruning removes the expired access tokens
  const expiredBefore = get<{ n: number }>("SELECT COUNT(*) AS n FROM oauth_tokens WHERE kind = 'access' AND expires_at <= ?", nowIso())?.n ?? 0;
  expect("before pruning, expired access tokens are stored", expiredBefore > 0, String(expiredBefore));
  oauth.pruneOAuth();
  const expiredAfter = get<{ n: number }>("SELECT COUNT(*) AS n FROM oauth_tokens WHERE kind = 'access' AND expires_at <= ?", nowIso())?.n ?? 0;
  expect("after pruning, no expired access token remains", expiredAfter === 0, String(expiredAfter));
} catch (err) {
  console.error(err);
  failures++;
} finally {
  clients.setDocFetcher(null);
  tab?.ws.close();
  server?.close();
  try {
    database().close();
  } catch {
    // already closed
  }
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "all good" : `${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
