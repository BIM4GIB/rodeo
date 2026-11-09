// What the mcp feature keeps in the database: agents' personal access tokens (only their
// hashes; the secret is shown once, when it is made) and the tools a user's Rodeo tab last
// offered; and the routes the Connect an Agent dialog calls, for its tokens and its connected
// apps (the OAuth grants, which server/src/oauth keeps). A token is found by its hash, so checking
// a call's token costs one indexed read.

import type { Hono } from "hono";
import { MAX_TOKENS, TOKEN_PREFIX, type AgentGrant, type AgentToken, type McpTool, type NewAgentToken } from "../../../web/src/features/mcp/wire.ts";
import { allowed, requireUser } from "../auth.ts";
import { config } from "../config.ts";
import { all, get, run } from "../db.ts";
import { readJson } from "../http.ts";
import { describeClient } from "../oauth/shared.ts";
import { listGrants, removeGrant, type GrantRow } from "../oauth/tokens.ts";
import { cleanLine, fail, HOUR, MINUTE, newId, newToken, nowIso, sha256Hex } from "../util.ts";

/** The tables this feature keeps. db.ts's schema version 9 runs the same SQL. */
export const MCP_SCHEMA = `
-- Agents (MCP): personal access tokens an outside agent (Claude Code, Cursor...) sends to /mcp.
-- Only the token's SHA-256 is kept; prefix is its first characters, shown to tell tokens apart.
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

-- The tools and instructions a user's Rodeo tab last offered agents, so an agent that connects
-- while no tab is open still sees them. Each user's own: a tab sets only its own account's.
CREATE TABLE IF NOT EXISTS mcp_tools (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tools_json TEXT NOT NULL,
  instructions TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** Who a token belongs to: what the endpoint needs to answer a call made with it. */
export interface TokenOwner {
  readonly tokenId: string;
  readonly userId: string;
  readonly name: string;
}

interface TokenRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  last_client: string | null;
}

const TOKEN_COLUMNS = "SELECT id, name, prefix, created_at, last_used_at, last_client FROM mcp_tokens";

// the shape newToken() makes: the prefix, then 32 random bytes in base64url (43 characters)
const TOKEN_FORMAT = new RegExp(`^${TOKEN_PREFIX}[A-Za-z0-9_-]{43}$`);

// when each token was last written as used, and by which client: a busy agent makes a call a
// second, and writing each one would be needless work
const touched = new Map<string, { at: number; client: string | null }>();

function toToken(r: TokenRow): AgentToken {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
    lastClient: r.last_client,
  };
}

/** A user's connected apps as the dialog shows them: how each one is named and where it sends the person back. */
function agentGrants(userId: string): AgentGrant[] {
  return listGrants(userId).map((g: GrantRow): AgentGrant => {
    const look = describeClient(g.clientId, g.redirectUri, g.clientName);
    return {
      id: g.id,
      name: look.name,
      where: look.where,
      verified: look.verified,
      createdAt: g.createdAt,
      lastUsedAt: g.lastUsedAt,
      lastClient: g.lastClient,
    };
  });
}

/** Makes a token named `name` for a user. Its secret comes back once; only the hash is kept. */
export function createToken(userId: string, name: unknown): NewAgentToken {
  const label = cleanLine(name, 60);
  if (!label) fail(400, "Give the connection a name", "bad_name");
  const count = get<{ n: number }>("SELECT COUNT(*) AS n FROM mcp_tokens WHERE user_id = ?", userId)?.n ?? 0;
  if (count >= MAX_TOKENS) fail(409, `You have ${MAX_TOKENS} connections: remove one first`, "too_many");
  const secret = TOKEN_PREFIX + newToken();
  const row: TokenRow = {
    id: newId(),
    name: label,
    prefix: secret.slice(0, TOKEN_PREFIX.length + 4),
    created_at: nowIso(),
    last_used_at: null,
    last_client: null,
  };
  run(
    "INSERT INTO mcp_tokens (id, user_id, name, token_hash, prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    row.id,
    userId,
    row.name,
    sha256Hex(secret),
    row.prefix,
    row.created_at,
  );
  return { token: toToken(row), secret };
}

/** A user's tokens, newest first. */
export function listTokens(userId: string): AgentToken[] {
  // the row id breaks ties, for tokens made within the same millisecond
  return all<TokenRow>(`${TOKEN_COLUMNS} WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`, userId).map(toToken);
}

/** Renames one of a user's tokens. A token that is not theirs is "not found", so ids cannot be probed. */
export function renameToken(userId: string, id: string, name: unknown): AgentToken {
  const label = cleanLine(name, 60);
  if (!label) fail(400, "Give the connection a name", "bad_name");
  if (run("UPDATE mcp_tokens SET name = ? WHERE id = ? AND user_id = ?", label, id, userId) === 0) {
    fail(404, "No such connection", "not_found");
  }
  const row = get<TokenRow>(`${TOKEN_COLUMNS} WHERE id = ?`, id);
  if (!row) fail(404, "No such connection", "not_found");
  return toToken(row);
}

/** Removes one of a user's tokens. Revocation is at once: the next call with it is refused. */
export function removeToken(userId: string, id: string): void {
  if (run("DELETE FROM mcp_tokens WHERE id = ? AND user_id = ?", id, userId) === 0) fail(404, "No such connection", "not_found");
  touched.delete(id);
}

/**
 * The token and owner an `Authorization: Bearer …` header names, or null: no such header, not
 * the shape of one of our tokens (checked before anything is hashed), unknown, or its account
 * is suspended.
 */
export function tokenOwner(authorization: string | undefined): TokenOwner | null {
  const m = /^bearer\s+(\S+)$/i.exec((authorization ?? "").trim());
  if (!m || !TOKEN_FORMAT.test(m[1])) return null;
  const row = get<{ id: string; user_id: string; name: string }>(
    "SELECT t.id, t.user_id, t.name FROM mcp_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ? AND u.suspended_at IS NULL",
    sha256Hex(m[1]),
  );
  return row ? { tokenId: row.id, userId: row.user_id, name: row.name } : null;
}

/** Records that a token was used now, by `client` (the agent's name, when it gave one). */
export function touchToken(tokenId: string, client: string | null): void {
  const name = cleanLine(client, 60) || null;
  const last = touched.get(tokenId);
  const now = Date.now();
  if (last && now - last.at < MINUTE && (name === null || name === last.client)) return;
  // a call that names no client keeps the last one named
  run("UPDATE mcp_tokens SET last_used_at = ?, last_client = COALESCE(?, last_client) WHERE id = ?", nowIso(), name, tokenId);
  touched.set(tokenId, { at: now, client: name ?? last?.client ?? null });
}

/** Keeps the tools a user's tab offered, and its instructions, for agents that connect while no tab is open. */
export function saveTools(userId: string, tools: readonly McpTool[], instructions: string): void {
  run(
    `INSERT INTO mcp_tools (user_id, tools_json, instructions, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET tools_json = excluded.tools_json, instructions = excluded.instructions, updated_at = excluded.updated_at`,
    userId,
    JSON.stringify(tools),
    instructions,
    nowIso(),
  );
}

/** What saveTools kept for a user, or null when nothing is kept or it does not read back. */
export function loadTools(userId: string): { readonly tools: McpTool[]; readonly instructions: string } | null {
  const row = get<{ tools_json: string; instructions: string }>("SELECT tools_json, instructions FROM mcp_tools WHERE user_id = ?", userId);
  if (!row) return null;
  try {
    const tools = JSON.parse(row.tools_json) as unknown;
    return Array.isArray(tools) ? { tools: tools as McpTool[], instructions: row.instructions } : null;
  } catch {
    return null;
  }
}

/** The routes the Connect an Agent dialog calls: list, make, rename and remove tokens, and remove connected apps. */
export function registerTokenRoutes(app: Hono): void {
  app.get("/api/mcp/tokens", (c) => {
    const user = requireUser(c);
    return c.json({ tokens: listTokens(user.id), grants: agentGrants(user.id), endpoint: `${config.publicUrl}/mcp` });
  });

  app.post("/api/mcp/tokens", async (c) => {
    const user = requireUser(c);
    if (!allowed(`mcp-token:${user.id}`, 20, HOUR)) fail(429, "You've made a lot of tokens: try again in an hour", "rate");
    const made = createToken(user.id, (await readJson(c, 16 * 1024)).name);
    return c.json(made, 201);
  });

  app.patch("/api/mcp/tokens/:id", async (c) => {
    const user = requireUser(c);
    const token = renameToken(user.id, c.req.param("id"), (await readJson(c, 16 * 1024)).name);
    return c.json({ token });
  });

  app.delete("/api/mcp/tokens/:id", (c) => {
    const user = requireUser(c);
    removeToken(user.id, c.req.param("id"));
    return c.body(null, 204);
  });

  // ending a connected app removes its tokens too: the app loses access at once
  app.delete("/api/mcp/grants/:id", (c) => {
    const user = requireUser(c);
    if (!removeGrant(user.id, c.req.param("id"))) fail(404, "That app is already disconnected", "not_found");
    return c.body(null, 204);
  });
}
