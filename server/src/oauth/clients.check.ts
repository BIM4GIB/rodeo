// Checks the app registry and the metadata fetch (clients.ts, fetch.ts) without a network: which
// addresses are refused, the guarded lookup, the refusals before any connection, reading a document
// from a local HTTP server (status, type, size, JSON), the cache-header rules, how an app's id
// resolves (documents through a stub fetcher, registrations in the database), registration rules and
// pruning. Prints an ok line per check; exits 1 on any failure.
//
// Run: cd server && node src/oauth/clients.check.ts

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, get as httpGet, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// the data folder and the public address must be chosen before config.ts reads the environment, so the server modules load late
const dir = mkdtempSync(join(tmpdir(), "oauth-clients-"));
process.env.DATA_DIR = dir;
process.env.PUBLIC_URL = "https://rodeo.build";

const { database, get, openDatabase, run } = await import("../db.ts");
const { DAY, KB, MINUTE, inMs, nowIso } = await import("../util.ts");
const { DCR_FORMAT, DCR_PREFIX, OAUTH_SCHEMA, PINNED_DOCS } = await import("./shared.ts");
const fetchMod = await import("./fetch.ts");
const clients = await import("./clients.ts");

let failures = 0;

function expect(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures++;
}

/** The items fn does not hold for, joined for a message: "" when it holds for all of them. */
function whichFail<T>(items: readonly T[], fn: (item: T) => boolean): string {
  return items.filter((item) => !fn(item)).map(String).join(", ");
}

/** The message a promise rejected with, or null when it resolved. */
async function refusalOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Answers a request with a body of a known length, so the reader sees a content-length header. */
function send(res: ServerResponse, status: number, body: string, type = "application/json"): void {
  res.writeHead(status, { "content-type": type, "content-length": Buffer.byteLength(body) });
  res.end(body);
}

/** A JSON text of exactly `size` bytes. */
function jsonOfSize(size: number): string {
  const empty = JSON.stringify({ pad: "" }).length;
  return JSON.stringify({ pad: "x".repeat(size - empty) });
}

// the names used below are reserved examples (RFC 2606), so no check reaches a real host
const CLAUDE = "https://claude.ai/oauth/mcp-oauth-client-metadata";
const CLAUDE_CODE = "https://claude.ai/oauth/claude-code-client-metadata";
const TOOLS = "https://tools.example/app.json";

let server: Server | null = null;
try {
  // ---- addresses ----
  const blocked = [
    "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "255.255.255.255", "192.0.2.1", "198.18.0.1", "224.0.0.1",
    "::", "::1", "fc00::1", "fd00::1", "fe80::1", "2001:db8::1", "64:ff9b::808:808", "2002::1",
    "::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.1.1", "::ffff:8.8.8.8", "not-an-ip",
  ];
  const reachable = ["8.8.8.8", "1.1.1.1", "160.79.104.10", "2606:4700:4700::1111", "172.32.0.1"];
  const notBlocked = whichFail(blocked, (a) => fetchMod.isBlockedAddress(a));
  expect("private, loopback, link-local, unique-local, mapped and reserved addresses are refused", notBlocked === "", notBlocked);
  const wrongBlocked = whichFail(reachable, (a) => !fetchMod.isBlockedAddress(a));
  expect("public addresses are not refused", wrongBlocked === "", wrongBlocked);

  // ---- the guarded lookup: localhost resolves from the hosts file, so no network request is made ----
  const codes = await Promise.all(
    [{}, { all: true }].map(
      (options) =>
        new Promise<string | null>((resolve) => {
          fetchMod.guardedLookup("localhost", options, (err) => resolve(err?.code ?? null));
        }),
    ),
  );
  expect("a name that resolves to this computer is refused by the lookup, in both shapes", codes.every((c) => c === "EBLOCKED"), codes.join(" "));

  // ---- fetching refuses before any connection ----
  for (const url of [
    "https://127.0.0.1/c.json",
    "https://[::1]/c.json",
    "https://10.0.0.1/c.json",
    "http://a.example/c.json",
    "https://a.example:8443/c.json",
  ]) {
    const reason = await refusalOf(fetchMod.fetchClientDoc(url, "check"));
    expect(`fetching ${url} is refused without a connection`, reason !== null && !reason.startsWith("it couldn't be reached"), reason ?? "it was fetched");
  }
  const local = await refusalOf(fetchMod.fetchClientDoc("https://localhost/c.json", "check"));
  expect("a name that resolves to this computer is refused", local === "localhost isn't a public address", local ?? "it was fetched");

  // ---- reading a document, against a local server ----
  const exact = jsonOfSize(5 * KB);
  const over = jsonOfSize(5 * KB + 1);
  const big = jsonOfSize(6 * KB);
  const srv = createServer((req, res) => {
    switch (req.url) {
      case "/ok":
        send(res, 200, '{"a":1}');
        break;
      case "/exact":
        send(res, 200, exact);
        break;
      case "/over":
        send(res, 200, over);
        break;
      case "/big":
        send(res, 200, big);
        break;
      case "/bigstream":
        // no length header: the reader must count the bytes itself
        res.writeHead(200, { "content-type": "application/json" });
        res.write(big.slice(0, Math.floor(big.length / 2)));
        res.end(big.slice(Math.floor(big.length / 2)));
        break;
      case "/html":
        send(res, 200, "<p>hi</p>", "text/html");
        break;
      case "/moved":
        res.writeHead(302, { location: "/ok" });
        res.end();
        break;
      case "/bad":
        send(res, 200, "nope");
        break;
      default:
        send(res, 404, "not here", "text/plain");
    }
  });
  server = srv;
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", () => resolve()));
  const port = (srv.address() as AddressInfo).port;

  /** Fetches a path the way the document fetch reads a response, and says what it made of it. */
  const readPath = (path: string): Promise<{ readonly body?: unknown; readonly error?: string }> =>
    new Promise((resolve) => {
      const req = httpGet(`http://127.0.0.1:${port}${path}`, { agent: false }, (res) => {
        fetchMod.readDoc(res, 5 * KB).then(
          (body) => resolve({ body }),
          (err: Error) => resolve({ error: err.message }),
        );
      });
      req.on("error", (err) => resolve({ error: err.message }));
    });

  const ok = await readPath("/ok");
  expect("a 200 JSON answer is read", JSON.stringify(ok.body) === '{"a":1}', ok.error);
  const edge = await readPath("/exact");
  expect("a document of exactly 5 KB is read", edge.error === undefined, edge.error);
  const refusedRead = async (label: string, path: string, message: string): Promise<void> => {
    const got = await readPath(path);
    expect(label, got.error === message, got.error ?? "it was read");
  };
  await refusedRead("a document one byte over 5 KB is refused by its length", "/over", "it's larger than 5 KB");
  await refusedRead("a 6 KB document is refused by its length", "/big", "it's larger than 5 KB");
  await refusedRead("a 6 KB chunked document is refused by its bytes", "/bigstream", "it's larger than 5 KB");
  await refusedRead("an HTML page is refused", "/html", "it isn't JSON");
  await refusedRead("a redirect is not followed", "/moved", "it answered 302");
  await refusedRead("a 404 is refused", "/gone", "it answered 404");
  await refusedRead("invalid JSON is refused", "/bad", "it isn't valid JSON");

  // ---- cache headers ----
  expect("max-age=600 keeps a document for 600 seconds", fetchMod.maxAgeOf("public, max-age=600") === 600_000);
  expect("no-store keeps nothing", fetchMod.maxAgeOf("no-store") === 0);
  expect("no-cache keeps nothing", fetchMod.maxAgeOf("no-cache") === 0);
  expect("no header says nothing", fetchMod.maxAgeOf(undefined) === null);
  expect("a bad max-age says nothing", fetchMod.maxAgeOf("max-age=abc") === null);

  // ---- the database: registrations, and the grants pruning looks at ----
  openDatabase();
  database().exec(OAUTH_SCHEMA);

  // ---- resolving an app's id: documents through a stub fetcher ----
  const served = new Map<string, unknown>();
  const broken = new Set<string>();
  const fetched: string[] = [];
  clients.setDocFetcher(async (url) => {
    fetched.push(url);
    if (broken.has(url)) throw new Error("it couldn't be reached (ECONNREFUSED)");
    if (!served.has(url)) throw new Error("it answered 404");
    return { body: served.get(url), maxAgeMs: null };
  });
  const fetchesOf = (url: string): number => fetched.filter((u) => u === url).length;

  served.set(CLAUDE, PINNED_DOCS[CLAUDE]);
  const claude = await clients.resolveClient(CLAUDE);
  expect(
    "Claude's document resolves to Claude",
    claude.ok && claude.client.kind === "cimd" && claude.client.name === "Claude",
    claude.ok ? claude.client.name : claude.message,
  );
  await clients.resolveClient(CLAUDE);
  expect("a second resolve of Claude's document is answered from the cache", fetchesOf(CLAUDE) === 1, `fetched ${fetchesOf(CLAUDE)} times`);

  const doc = (overrides: Record<string, unknown>): Record<string, unknown> => ({
    client_id: TOOLS,
    client_name: "Tools\nApp for tests",
    redirect_uris: ["https://tools.example/callback"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    ...overrides,
  });
  const badDocs: readonly (readonly [string, Record<string, unknown>])[] = [
    ["a document naming another app is refused", { client_id: "https://tools.example/other.json" }],
    ["a document with a client secret is refused", { client_secret: "not-for-public-apps" }],
    ["a document with an http redirect off this computer is refused", { redirect_uris: ["http://example.com/cb"] }],
    ["a document asking for a client secret method is refused", { token_endpoint_auth_method: "client_secret_basic" }],
    ["a document without the authorization_code grant is refused", { grant_types: ["refresh_token"] }],
    ["a document with no redirect address is refused", { redirect_uris: [] }],
  ];
  for (const [label, overrides] of badDocs) {
    served.set(TOOLS, doc(overrides));
    const got = await clients.resolveClient(TOOLS);
    expect(label, !got.ok, got.ok ? "accepted" : got.message);
  }
  served.set(TOOLS, doc({}));
  const good = await clients.resolveClient(TOOLS);
  expect("a valid document resolves, with its name cleaned", good.ok && good.client.name === "Tools App for tests", good.ok ? good.client.name : good.message);
  const seen = fetchesOf(TOOLS);
  await clients.resolveClient(TOOLS);
  expect("a valid document is kept: the next resolve doesn't fetch it", fetchesOf(TOOLS) === seen);

  const LONG = "https://tools.example/long.json";
  served.set(LONG, doc({ client_id: LONG, client_name: "L".repeat(200) }));
  const long = await clients.resolveClient(LONG);
  expect("a name longer than 80 characters is cut to 80", long.ok && long.client.name.length === 80, long.ok ? String(long.client.name.length) : long.message);

  const DOWN = "https://tools.example/down.json";
  broken.add(DOWN);
  const down = await clients.resolveClient(DOWN);
  expect("a document that can't be fetched says which host it failed on", !down.ok && down.message.includes("tools.example"), down.ok ? "resolved" : down.message);

  const before = fetched.length;
  const plain = await clients.resolveClient("http://tools.example/c.json");
  expect("an http document address is refused without a fetch", !plain.ok && fetched.length === before, plain.ok ? "resolved" : plain.message);

  served.set(CLAUDE_CODE, "junk");
  const junk = await clients.resolveClient(CLAUDE_CODE);
  expect("a live document that isn't usable is refused, not swapped for Rodeo's copy", !junk.ok, junk.ok ? "accepted" : junk.message);

  broken.add(CLAUDE_CODE);
  const copy = await clients.resolveClient(CLAUDE_CODE);
  expect(
    "Claude Code resolves from Rodeo's copy when its document can't be fetched",
    copy.ok && copy.client.name === "Claude Code",
    copy.ok ? copy.client.name : copy.message,
  );

  const notAnId = await clients.resolveClient("junk");
  expect("a made-up id is refused", !notAnId.ok, notAnId.ok ? "resolved" : notAnId.message);
  const unknownDcr = await clients.resolveClient(DCR_PREFIX + "x".repeat(22));
  expect(
    "a registration id nobody holds is refused, with a plain reason",
    !unknownDcr.ok && unknownDcr.message.startsWith("Rodeo doesn't know this app any more"),
    unknownDcr.ok ? "resolved" : unknownDcr.message,
  );
  const overlong = await clients.resolveClient(`https://tools.example/${"a".repeat(2000)}`);
  expect("an id over 2000 characters is refused", !overlong.ok, overlong.ok ? "resolved" : overlong.message);

  // ---- registration (RFC 7591) ----
  const cursor = clients.registerClient({ client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"] });
  expect("a registration with an app's own scheme is accepted (201)", cursor.status === 201, JSON.stringify(cursor.body));
  const cursorId = String(cursor.body.client_id);
  expect("the new id has the registration shape", DCR_FORMAT.test(cursorId));
  expect(
    "the reply says none, the two grants and the one scope",
    cursor.body.token_endpoint_auth_method === "none" &&
      JSON.stringify(cursor.body.grant_types) === JSON.stringify(["authorization_code", "refresh_token"]) &&
      cursor.body.scope === "drawings",
  );
  const cursorApp = await clients.resolveClient(cursorId);
  expect(
    "the new id resolves to the app as a registration",
    cursorApp.ok && cursorApp.client.kind === "dcr" && cursorApp.client.name === "Cursor",
    cursorApp.ok ? cursorApp.client.name : cursorApp.message,
  );

  /** Expects a registration to be refused with this status and error code. */
  const refusedReg = (label: string, body: unknown, error: string): void => {
    const got = clients.registerClient(body);
    const ok = got.status === 400 && got.body.error === error;
    expect(label, ok, ok ? "" : `${got.status} ${String(got.body.error)}`);
  };
  refusedReg("a registration with no redirect address is refused", { client_name: "x" }, "invalid_redirect_uri");
  refusedReg("a javascript: redirect is refused", { redirect_uris: ["javascript:alert(1)"] }, "invalid_redirect_uri");
  refusedReg(
    "eleven redirect addresses are refused",
    { redirect_uris: Array.from({ length: 11 }, (_, i) => `cursor://app/cb${i}`) },
    "invalid_redirect_uri",
  );
  refusedReg("an http address off this computer is refused", { redirect_uris: ["http://example.com/cb"] }, "invalid_redirect_uri");
  refusedReg(
    "a grant_types without authorization_code is refused",
    { redirect_uris: ["cursor://x/cb"], grant_types: ["client_credentials"] },
    "invalid_client_metadata",
  );
  const notObjects = ["not an object", null, ["cursor://x/cb"]].every((body) => {
    const got = clients.registerClient(body);
    return got.status === 400 && got.body.error === "invalid_client_metadata";
  });
  expect("a registration body that isn't a JSON object is refused", notObjects);

  /** Expects a registration to be accepted, and the reply to pass this check. */
  const accepted = (label: string, body: unknown, check: (reply: Record<string, unknown>) => boolean): void => {
    const got = clients.registerClient(body);
    const ok = got.status === 201 && check(got.body);
    expect(label, ok, ok ? "" : JSON.stringify(got.body));
  };
  accepted(
    "a jwt-bearer grant next to authorization_code is accepted",
    { redirect_uris: ["cursor://x/cb"], grant_types: ["urn:ietf:params:oauth:grant-type:jwt-bearer", "authorization_code"] },
    () => true,
  );
  accepted(
    "a client_secret_basic request is accepted, and the reply says none",
    { redirect_uris: ["cursor://x/cb"], token_endpoint_auth_method: "client_secret_basic" },
    (reply) => reply.token_endpoint_auth_method === "none",
  );
  accepted("a localhost http redirect on any port is accepted", { redirect_uris: ["http://localhost:33418/callback"] }, () => true);

  const longReg = clients.registerClient({ client_name: `first line\nsecond line ${"z".repeat(200)}`, redirect_uris: ["cursor://x/long"] });
  const longName = longReg.status === 201 ? String(longReg.body.client_name ?? "") : String(longReg.status);
  expect("a long name with a line break is cleaned and cut to 80 characters", longReg.status === 201 && longName.length === 80 && !longName.includes("\n"), longName);

  const withUri = clients.registerClient({ client_name: "Site", client_uri: "https://cursor.com", redirect_uris: ["cursor://x/site"] });
  const plainUri = clients.registerClient({ client_name: "Plain", client_uri: "http://cursor.com", redirect_uris: ["cursor://x/plain"] });
  const uriOf = (id: unknown): string | null =>
    get<{ client_uri: string | null }>("SELECT client_uri FROM oauth_clients WHERE id = ?", String(id))?.client_uri ?? null;
  expect("an https client_uri is kept, an http one is dropped", uriOf(withUri.body.client_id) === "https://cursor.com" && uriOf(plainUri.body.client_id) === null);

  // ---- clientKnown and markClientUsed ----
  expect("a registered id is known", clients.clientKnown(cursorId));
  expect("an unknown registration id is not", !clients.clientKnown(DCR_PREFIX + "y".repeat(22)));
  expect("Claude's metadata address is known", clients.clientKnown(CLAUDE));
  expect("an http address is not", !clients.clientKnown("http://x/y"));
  clients.markClientUsed(cursorId);
  const usedAt = get<{ last_used_at: string | null }>("SELECT last_used_at FROM oauth_clients WHERE id = ?", cursorId)?.last_used_at ?? null;
  expect("marking a registration used writes its time", usedAt !== null);

  // ---- pruning ----
  const addClient = (id: string, createdAt: string, usedAt: string | null): void => {
    run(
      "INSERT INTO oauth_clients (id, name, client_uri, redirect_uris_json, created_at, last_used_at) VALUES (?, ?, NULL, ?, ?, ?)",
      id,
      "",
      '["cursor://x/cb"]',
      createdAt,
      usedAt,
    );
  };
  run(
    "INSERT INTO users (id, email, name, avatar_url, created_at, plan) VALUES ('prune-user', 'prune@example.com', 'Check', NULL, ?, 'free')",
    nowIso(),
  );
  const grantFor = (clientId: string): void => {
    run(
      "INSERT INTO oauth_grants (id, user_id, client_id, client_name, redirect_uri, scope, resource, created_at, last_used_at, last_client) VALUES (?, 'prune-user', ?, 'Check app', 'cursor://x/cb', 'drawings', 'https://rodeo.build/mcp', ?, NULL, NULL)",
      `grant-${clientId}`,
      clientId,
      nowIso(),
    );
  };
  addClient("prune-never-used", inMs(-2 * DAY), null);
  addClient("prune-fresh", inMs(-2 * MINUTE), null);
  addClient("prune-used-today", inMs(-30 * DAY), inMs(-MINUTE));
  addClient("prune-idle", inMs(-200 * DAY), inMs(-100 * DAY));
  addClient("prune-granted", inMs(-200 * DAY), inMs(-100 * DAY));
  grantFor("prune-granted");
  addClient("prune-granted-unused", inMs(-2 * DAY), null);
  grantFor("prune-granted-unused");

  clients.pruneClients();
  const kept = (id: string): boolean => get<{ id: string }>("SELECT id FROM oauth_clients WHERE id = ?", id) !== undefined;
  expect("a registration never used and older than a day is removed", !kept("prune-never-used"));
  expect("a registration made minutes ago is kept", kept("prune-fresh"));
  expect("a registration used today is kept", kept("prune-used-today"));
  expect("a registration unused for 100 days with no grant is removed", !kept("prune-idle"));
  expect("a registration unused for 100 days with a grant is kept", kept("prune-granted"));
  expect("a registration with a grant is kept even when never marked used", kept("prune-granted-unused"));
} catch (err) {
  failures++;
  console.log(`FAIL the check stopped: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
} finally {
  server?.close();
  try {
    database().close();
  } catch {
    // the database was never opened
  }
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`${failures} failed`);
  process.exit(1);
}
console.log("all good");
