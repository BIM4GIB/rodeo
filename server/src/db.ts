// The SQLite database (node:sqlite): schema, versioned with PRAGMA user_version,
// and small helpers. Transactions are synchronous, so nothing awaits inside tx().

import { mkdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { config } from "./config.ts";

export type Param = string | number | bigint | null;

const SCHEMA_V1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  supporter_until TEXT,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT
);
CREATE INDEX users_subscription ON users(stripe_subscription_id);

CREATE TABLE identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE magic_links (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  redirect TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  head_version_id TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  has_thumbnail INTEGER NOT NULL DEFAULT 0,
  thumbnail_blob TEXT
);
CREATE INDEX files_owner ON files(owner_id);
CREATE INDEX files_thumbnail ON files(thumbnail_blob);

CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  size INTEGER NOT NULL,
  label TEXT,
  blob TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  collab_seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX versions_file ON versions(file_id, created_at);
CREATE INDEX versions_author ON versions(author_id);
CREATE INDEX versions_blob ON versions(blob);

CREATE TABLE members (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (file_id, user_id)
);
CREATE INDEX members_user ON members(user_id);

CREATE TABLE invites (
  token TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX invites_file ON invites(file_id);
CREATE INDEX invites_created_by ON invites(created_by);
CREATE INDEX invites_accepted_by ON invites(accepted_by);

CREATE TABLE shares (
  token TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  allow_download INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX shares_file ON shares(file_id);
CREATE INDEX shares_created_by ON shares(created_by);

CREATE TABLE audio (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  blob TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX audio_file ON audio(file_id);
CREATE INDEX audio_author ON audio(author_id);
CREATE INDEX audio_blob ON audio(blob);

CREATE TABLE comments (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  anchor_json TEXT,
  strokes_json TEXT,
  audio_id TEXT REFERENCES audio(id) ON DELETE SET NULL,
  audio_ms INTEGER,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX comments_file ON comments(file_id, created_at);
CREATE INDEX comments_parent ON comments(parent_id);
CREATE INDEX comments_author ON comments(author_id);
CREATE UNIQUE INDEX comments_audio ON comments(audio_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

// bug reports and feature requests (feedback.ts)
const SCHEMA_V2 = `
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  email TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL
);
CREATE INDEX feedback_created ON feedback(created_at);
`;

// AI credit (credit.ts): each user's balance, and what went in and out, in millionths of the
// credit's currency. A Checkout session tops up once, however often Stripe tells of it.
const SCHEMA_V3 = `
ALTER TABLE users ADD COLUMN ai_credit INTEGER NOT NULL DEFAULT 0;

CREATE TABLE ai_ledger (
  id INTEGER PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  balance INTEGER NOT NULL,
  ref TEXT,
  model TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_usd REAL,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_ledger_user ON ai_ledger(user_id, id);
CREATE UNIQUE INDEX ai_ledger_topup ON ai_ledger(ref) WHERE kind = 'topup';
`;

// Cloud renders (render.ts): each job a user sent to the GPU worker, what it holds of their
// credit while it runs (millionths), its progress, and the pictures it made (kept on disk).
const SCHEMA_V4 = `
CREATE TABLE render_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  call_id TEXT,
  state TEXT NOT NULL,
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  samples INTEGER NOT NULL,
  shots INTEGER NOT NULL,
  gpu TEXT NOT NULL,
  limit_seconds REAL NOT NULL,
  hold INTEGER NOT NULL,
  progress TEXT,
  stop TEXT,
  seconds REAL,
  charged INTEGER,
  error TEXT,
  pictures TEXT,
  created_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX render_jobs_user ON render_jobs(user_id, created_at);
CREATE INDEX render_jobs_state ON render_jobs(state);
`;

// Error reports (reports.ts): reports of the same error share a group, which counts them all;
// only the latest few of each are kept in full.
const SCHEMA_V5 = `
CREATE TABLE error_groups (
  fingerprint TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  area TEXT NOT NULL,
  message TEXT NOT NULL,
  count INTEGER NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  notified_at TEXT
);
CREATE INDEX error_groups_last ON error_groups(last_seen);

CREATE TABLE error_reports (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL REFERENCES error_groups(fingerprint) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX error_reports_group ON error_reports(fingerprint, created_at);
`;

// Autosaves (files.ts): a big drawing's autosave replaces the autosave before it rather than
// piling up full copies.
const SCHEMA_V6 = `
ALTER TABLE versions ADD COLUMN autosave INTEGER NOT NULL DEFAULT 0;
`;

// The admin page (admin.ts, visits.ts): when each account was last seen, accounts an admin has
// suspended, a note on credit an admin gave, and the editor's visits, one row per visitor a day.
// A visitor is a hash of their address and browser with a salt that changes each day, so the
// same person is not known from one day to the next and nothing is kept on their device.
const SCHEMA_V7 = `
ALTER TABLE users ADD COLUMN last_seen_at TEXT;
ALTER TABLE users ADD COLUMN suspended_at TEXT;
ALTER TABLE ai_ledger ADD COLUMN note TEXT;

CREATE TABLE visits (
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  first_at TEXT NOT NULL,
  last_at TEXT NOT NULL,
  pings INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0,
  entry TEXT NOT NULL,
  referrer TEXT,
  campaign TEXT,
  country TEXT,
  device TEXT NOT NULL,
  browser TEXT NOT NULL,
  os TEXT NOT NULL,
  PRIMARY KEY (day, visitor)
);
CREATE INDEX visits_last ON visits(last_at);
CREATE INDEX visits_user ON visits(user_id);

CREATE TABLE visit_counts (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, name)
);
`;

// what a bug report carries beyond its words (feedback.ts): diagnostics, a screenshot and the
// file it is about, as blobs; file_received is how much of the file has arrived
const SCHEMA_V8 = `
ALTER TABLE feedback ADD COLUMN diagnostics_json TEXT;
ALTER TABLE feedback ADD COLUMN screenshot_blob TEXT;
ALTER TABLE feedback ADD COLUMN file_blob TEXT;
ALTER TABLE feedback ADD COLUMN file_name TEXT;
ALTER TABLE feedback ADD COLUMN file_size INTEGER;
ALTER TABLE feedback ADD COLUMN file_received INTEGER NOT NULL DEFAULT 0;
`;

// Branches, the gallery, link previews and agents (lineage.ts, merges.ts, gallery*.ts, embed.ts,
// mcp/store.ts).
//
// Where a drawing came from (a gallery fork or a branch shares its source version's blob), a branch's
// name and the drawing it and Main last agreed on (base_blob: the common ancestor a merge needs, kept
// here because Main's old versions are pruned); merge requests and approvals. A merge request's
// discussion is the branch drawing's comments.
//
// The gallery: drawings their owners published, one row per drawing ever (unpublishing keeps it),
// each pinning one version that is kept from pruning while it is there and shown through its own
// share link (shares, allow_download on); the tags; where each fork came from, with the title,
// credit and licence it was taken under, kept for its credit after the original goes; and reports.
//
// Link previews: each share link's preview pictures, a still (poster, PNG or JPEG, for Open Graph,
// oEmbed and Markdown) and a turning GIF (turntable), kept as blobs. No foreign key to shares:
// embed.ts sweeps the rows of revoked or deleted links and deletes their blobs itself, since
// blobs.ts's reference count does not look here.
//
// Agents (MCP): personal access tokens an outside agent (Claude Code, Cursor...) sends to /mcp; only
// the token's SHA-256 is kept, and prefix is its first characters, shown to tell tokens apart. And the
// tools and instructions a user's Rodeo tab last offered agents, so an agent that connects while no
// tab is open still sees them.
const SCHEMA_V9 = `
ALTER TABLE files ADD COLUMN parent_file_id TEXT REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE files ADD COLUMN parent_version_id TEXT;
ALTER TABLE files ADD COLUMN lineage TEXT;
ALTER TABLE files ADD COLUMN branch_name TEXT;
ALTER TABLE files ADD COLUMN base_blob TEXT;
ALTER TABLE files ADD COLUMN created_by TEXT REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX files_parent ON files(parent_file_id, lineage);
CREATE INDEX files_base_blob ON files(base_blob);

CREATE TABLE merge_requests (
  id TEXT PRIMARY KEY,
  source_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  target_file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  merged_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  merged_at TEXT,
  merged_version_id TEXT,
  source_version_id TEXT
);
CREATE UNIQUE INDEX merge_requests_open ON merge_requests(source_file_id) WHERE state = 'open';
CREATE INDEX merge_requests_target ON merge_requests(target_file_id, state, updated_at);

CREATE TABLE merge_approvals (
  request_id TEXT NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_version_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (request_id, user_id)
);

CREATE TABLE gallery_entries (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version_id TEXT REFERENCES versions(id) ON DELETE SET NULL,
  share_token TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  licence TEXT NOT NULL,
  credit_name TEXT NOT NULL,
  official INTEGER NOT NULL DEFAULT 0,
  featured_at TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  cover_blob TEXT,
  cover_type TEXT,
  published_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  unpublished_at TEXT,
  hidden_at TEXT,
  hidden_reason TEXT
);
CREATE INDEX gallery_entries_owner ON gallery_entries(owner_id);
CREATE INDEX gallery_entries_published ON gallery_entries(published_at);
CREATE INDEX gallery_entries_version ON gallery_entries(version_id);
CREATE UNIQUE INDEX gallery_entries_share ON gallery_entries(share_token) WHERE share_token IS NOT NULL;

CREATE TABLE gallery_tags (
  entry_id TEXT NOT NULL REFERENCES gallery_entries(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag)
);
CREATE INDEX gallery_tags_tag ON gallery_tags(tag);

CREATE TABLE gallery_forks (
  file_id TEXT PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  entry_id TEXT REFERENCES gallery_entries(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  credit_name TEXT NOT NULL,
  licence TEXT NOT NULL,
  forked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  forked_at TEXT NOT NULL
);
CREATE INDEX gallery_forks_entry ON gallery_forks(entry_id);
CREATE INDEX gallery_forks_by ON gallery_forks(forked_by);

CREATE TABLE gallery_reports (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES gallery_entries(id) ON DELETE CASCADE,
  reporter_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT,
  reason TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX gallery_reports_entry ON gallery_reports(entry_id, resolved_at);
CREATE INDEX gallery_reports_reporter ON gallery_reports(reporter_id);
CREATE UNIQUE INDEX gallery_reports_once ON gallery_reports(entry_id, reporter_id) WHERE reporter_id IS NOT NULL AND resolved_at IS NULL;

CREATE TABLE share_media (
  token TEXT NOT NULL,
  kind TEXT NOT NULL,
  blob TEXT NOT NULL,
  mime TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size INTEGER NOT NULL,
  version_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (token, kind)
);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  last_client TEXT
);
CREATE INDEX IF NOT EXISTS mcp_tokens_user ON mcp_tokens(user_id);

CREATE TABLE IF NOT EXISTS mcp_tools (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tools_json TEXT NOT NULL,
  instructions TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

// OAuth sign-in for agents: apps that registered themselves, the apps people allowed, codes and
// tokens (hashes only). The same SQL as OAUTH_SCHEMA in server/src/oauth/shared.ts: keep the two the same.
const SCHEMA_V10 = `
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

const MIGRATIONS: readonly string[] = [SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, SCHEMA_V5, SCHEMA_V6, SCHEMA_V7, SCHEMA_V8, SCHEMA_V9, SCHEMA_V10];

let conn: DatabaseSync | null = null;
const statements = new Map<string, StatementSync>();

/** Opens (and creates, and migrates) the database. Call once at start-up. */
export function openDatabase(): DatabaseSync {
  for (const dir of [config.dataDir, config.blobsDir, config.tmpDir]) mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  conn = db;
  return db;
}

export function database(): DatabaseSync {
  if (!conn) throw new Error("The database is not open");
  return conn;
}

function migrate(db: DatabaseSync): void {
  const current = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
}

function stmt(sql: string): StatementSync {
  let s = statements.get(sql);
  if (!s) {
    s = database().prepare(sql);
    statements.set(sql, s);
  }
  return s;
}

/** The first row, or undefined. */
export function get<T>(sql: string, ...params: Param[]): T | undefined {
  return stmt(sql).get(...params) as unknown as T | undefined;
}

export function all<T>(sql: string, ...params: Param[]): T[] {
  return stmt(sql).all(...params) as unknown as T[];
}

/** Runs a write; returns the number of rows changed. */
export function run(sql: string, ...params: Param[]): number {
  return Number(stmt(sql).run(...params).changes);
}

let txDepth = 0;

/** Runs fn in one immediate transaction; rolls back when it throws. fn must not await. */
export function tx<T>(fn: () => T): T {
  // inside a transaction already: fn is part of it
  if (txDepth > 0) return fn();
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  txDepth++;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    txDepth--;
  }
}
