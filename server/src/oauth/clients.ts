// The apps that ask to connect to Rodeo's MCP endpoint, by their client_id. Two kinds: apps that
// registered themselves at /oauth/register (kept in oauth_clients), and apps named by the address of
// their metadata document (claude.ai, ChatGPT, any https address). Rodeo fetches those documents
// itself, checks them and keeps them for a while, so an app can't name a redirect Rodeo wasn't told
// about, or ask for a client secret.

import { allowed } from "../auth.ts";
import { config } from "../config.ts";
import { get, run } from "../db.ts";
import { cleanLine, DAY, HOUR, inMs, MINUTE, newId, nowIso } from "../util.ts";
import { type FetchedDoc, fetchClientDoc } from "./fetch.ts";
import {
  type Client,
  cimdUrlProblem,
  DCR_FORMAT,
  DCR_PREFIX,
  MAX_URL,
  PINNED_DOCS,
  redirectProblem,
  SCOPE,
} from "./shared.ts";

/** What resolving an app's id gave: the app, or the reason Rodeo doesn't know it. */
export type Resolved = { readonly ok: true; readonly client: Client } | { readonly ok: false; readonly message: string };

/** A document kept after it was read: the app it describes, and when to read it again. */
interface Cached {
  readonly client: Client;
  readonly expires: number;
}

const UNKNOWN = "This isn't an app id Rodeo knows";
/** Documents kept at once; past this the oldest is dropped, so a stranger can't fill memory. */
const MAX_CACHED = 1000;
/** How long a document Rodeo copied from its pinned copy is kept: it is a fallback, so it is re-read soon. */
const PINNED_TTL_MS = 5 * MINUTE;

const cache = new Map<string, Cached>();
/** Concurrent resolutions of one document share one fetch. */
const inFlight = new Map<string, Promise<Resolved>>();
let fetcher: ((url: string) => Promise<FetchedDoc>) | null = null;

/** Checks only: replaces the document fetch (null puts the real one back). */
export function setDocFetcher(fn: ((url: string) => Promise<FetchedDoc>) | null): void {
  fetcher = fn;
}

function refused(message: string): Resolved {
  return { ok: false, message };
}

/** The fetch itself: the test seam when one is set, else the guarded fetch. Async, so a throw is a rejection. */
async function fetchDoc(url: string): Promise<FetchedDoc> {
  if (fetcher) return fetcher(url);
  return fetchClientDoc(url, `Rodeo/${config.version} (+${config.publicUrl})`);
}

/** Keeps a document for a while, dropping the oldest when the cache is full. */
function remember(url: string, client: Client, ms: number): void {
  cache.delete(url);
  while (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  cache.set(url, { client, expires: Date.now() + ms });
}

/** Checks a metadata document against the app's id: its redirects, no client secret, the grants it needs. */
function validateDoc(body: unknown, clientId: string): Client | string {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return "it isn't a JSON object";
  const doc = body as Record<string, unknown>;
  if (doc.client_id !== clientId) return "its client_id doesn't match its address";
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10) return "it needs 1 to 10 redirect addresses";
  for (const uri of uris) {
    if (typeof uri !== "string") return "a redirect address isn't text";
    const problem = redirectProblem(uri);
    if (problem) return problem;
  }
  // Rodeo treats every app as public: a secret in the document is refused, not ignored
  if ("client_secret" in doc || "client_secret_expires_at" in doc) return "it carries a client secret";
  const auth = doc.token_endpoint_auth_method;
  if (auth === "client_secret_post" || auth === "client_secret_basic" || auth === "client_secret_jwt") return "it asks for a client secret";
  if (doc.grant_types !== undefined && !(Array.isArray(doc.grant_types) && doc.grant_types.includes("authorization_code"))) {
    return "it must allow the authorization_code grant";
  }
  if (doc.response_types !== undefined && !(Array.isArray(doc.response_types) && doc.response_types.includes("code"))) {
    return "it must allow the code response type";
  }
  return { id: clientId, kind: "cimd", name: cleanLine(doc.client_name, 80), redirectUris: uris as string[] };
}

/** Checks a document Rodeo read and keeps it when it is usable; otherwise says why. */
function accept(url: string, body: unknown, ms: number): Resolved {
  const checked = validateDoc(body, url);
  if (typeof checked === "string") return refused(`This app's details at ${new URL(url).host} aren't usable: ${checked}`);
  remember(url, checked, ms);
  return { ok: true, client: checked };
}

/** Reads a document from its address, then checks and keeps it. A failed read falls back to Rodeo's pinned copy when there is one. */
async function loadDocument(url: string): Promise<Resolved> {
  const host = new URL(url).host;
  if (!allowed("oauth-cimd", 120, MINUTE)) return refused("Rodeo is reading a lot of app details right now: try again in a minute");
  let fetched: FetchedDoc;
  try {
    fetched = await fetchDoc(url);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const pinned = PINNED_DOCS[url];
    if (!pinned) return refused(`Rodeo couldn't read this app's details from ${host}: ${reason}`);
    console.warn(`[oauth] couldn't fetch ${url} (${reason}): using Rodeo's copy`);
    return accept(url, pinned, PINNED_TTL_MS);
  }
  // a document says how long it may be kept; Rodeo keeps it between five minutes and a day
  const ms = Math.min(Math.max(fetched.maxAgeMs ?? HOUR, 5 * MINUTE), DAY);
  return accept(url, fetched.body, ms);
}

/** An https app id: a cached document, one fetch shared by concurrent callers, or a new fetch. */
async function resolveDocument(url: string): Promise<Resolved> {
  const problem = cimdUrlProblem(url);
  if (problem) return refused(problem);
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return { ok: true, client: hit.client };
  const running = inFlight.get(url);
  if (running) return running;
  const job = loadDocument(url).finally(() => inFlight.delete(url));
  inFlight.set(url, job);
  return job;
}

/** Resolves an app's client_id to the app Rodeo shows and sends codes to, or says why it can't. */
export async function resolveClient(clientId: string): Promise<Resolved> {
  if (clientId.length > MAX_URL) return refused(UNKNOWN);
  if (DCR_FORMAT.test(clientId)) {
    const row = get<{ name: string; redirect_uris_json: string }>(
      "SELECT name, redirect_uris_json FROM oauth_clients WHERE id = ?",
      clientId,
    );
    if (!row) return refused("Rodeo doesn't know this app any more. Remove Rodeo from the app and add it again.");
    return {
      ok: true,
      client: { id: clientId, kind: "dcr", name: row.name, redirectUris: JSON.parse(row.redirect_uris_json) as string[] },
    };
  }
  if (clientId.startsWith("https://")) return resolveDocument(clientId);
  return refused(UNKNOWN);
}

/** A refused registration: the 400 answer with its RFC 7591 error code and a short reason. */
function rejectRegistration(error: string, description: string): { readonly status: 400; readonly body: Record<string, unknown> } {
  return { status: 400, body: { error, error_description: description } };
}

/** An https address up to MAX_URL long, or null: how client_uri is kept. */
function httpsUri(v: unknown): string | null {
  if (typeof v !== "string" || v.length > MAX_URL) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

/**
 * Registers an app that asked for a client_id at /oauth/register (RFC 7591). Returns 201 with the
 * registration, or 400 with the reason. The caller checks the body's size and the rate limits.
 */
export function registerClient(body: unknown): { readonly status: 201 | 400; readonly body: Record<string, unknown> } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return rejectRegistration("invalid_client_metadata", "The registration must be a JSON object");
  }
  const doc = body as Record<string, unknown>;
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > 10) {
    return rejectRegistration("invalid_redirect_uri", "Give 1 to 10 redirect addresses");
  }
  for (const uri of uris) {
    if (typeof uri !== "string") return rejectRegistration("invalid_redirect_uri", "A redirect address must be text");
    const problem = redirectProblem(uri);
    if (problem) return rejectRegistration("invalid_redirect_uri", problem);
  }
  if (doc.grant_types !== undefined && !(Array.isArray(doc.grant_types) && doc.grant_types.includes("authorization_code"))) {
    return rejectRegistration("invalid_client_metadata", "grant_types must include authorization_code");
  }
  if (doc.response_types !== undefined && !(Array.isArray(doc.response_types) && doc.response_types.includes("code"))) {
    return rejectRegistration("invalid_client_metadata", "response_types must include code");
  }
  // every app is public: token_endpoint_auth_method and scope are ignored, and the reply says so
  const name = cleanLine(doc.client_name, 80);
  const clientUri = httpsUri(doc.client_uri);
  const redirects = uris as string[];
  const id = DCR_PREFIX + newId();
  run(
    "INSERT INTO oauth_clients (id, name, client_uri, redirect_uris_json, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, NULL)",
    id,
    name,
    clientUri,
    JSON.stringify(redirects),
    nowIso(),
  );
  const reply: Record<string, unknown> = {
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(name ? { client_name: name } : {}),
    redirect_uris: redirects,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: SCOPE,
  };
  return { status: 201, body: reply };
}

/** Whether Rodeo knows an app id: a registration that exists, or a well-formed metadata address. */
export function clientKnown(clientId: string): boolean {
  if (DCR_FORMAT.test(clientId) && get<{ id: string }>("SELECT id FROM oauth_clients WHERE id = ?", clientId)) return true;
  return cimdUrlProblem(clientId) === null;
}

/** Records that a registered app was used now. A metadata address has no row, so nothing is written for it. */
export function markClientUsed(clientId: string): void {
  if (!DCR_FORMAT.test(clientId)) return;
  run("UPDATE oauth_clients SET last_used_at = ? WHERE id = ?", nowIso(), clientId);
}

/**
 * Removes registrations nobody uses: one never used within a day, or one unused for 90 days with no
 * grant left. Also drops cached documents whose time is up.
 */
export function pruneClients(): void {
  // a registration that still has a grant is kept, even if it was never marked used
  run(
    "DELETE FROM oauth_clients WHERE last_used_at IS NULL AND created_at <= ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id)",
    inMs(-DAY),
  );
  run(
    "DELETE FROM oauth_clients WHERE last_used_at IS NOT NULL AND last_used_at <= ? AND NOT EXISTS (SELECT 1 FROM oauth_grants g WHERE g.client_id = oauth_clients.id)",
    inMs(-90 * DAY),
  );
  const now = Date.now();
  for (const [url, hit] of cache) {
    if (hit.expires <= now) cache.delete(url);
  }
}
