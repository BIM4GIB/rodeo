// The signed-in account: /api/health, /api/me (read, rename, delete).

import type { Hono } from "hono";
import { cancelSubscription } from "./billing.ts";
import { currentUser, requireUser, signOut, userOut, type UserRow } from "./auth.ts";
import { releaseBlobs } from "./blobs.ts";
import { config } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { fileBlobs } from "./files.ts";
import { readJson } from "./http.ts";
import { getHub } from "./hub.ts";
import { cleanLine, fail } from "./util.ts";

export function registerAccount(app: Hono): void {
  app.get("/api/health", (c) => c.json({ ok: true, version: config.version }));

  app.get("/api/me", (c) => {
    const user = currentUser(c);
    return c.json({ user: user ? userOut(user) : null });
  });

  app.patch("/api/me", async (c) => {
    const user = requireUser(c);
    const name = cleanLine((await readJson(c)).name, 80);
    if (!name) fail(400, "Enter a name");
    run("UPDATE users SET name = ? WHERE id = ?", name, user.id);
    return c.json({ user: userOut(get<UserRow>("SELECT * FROM users WHERE id = ?", user.id) ?? user) });
  });

  app.delete("/api/me", async (c) => {
    await deleteAccount(requireUser(c));
    signOut(c);
    return c.body(null, 204);
  });
}

/**
 * Deletes an account and what it owns: its drawings (with their versions, voice notes and
 * comments), its memberships and sessions. Its comments and versions on others' drawings stay,
 * shown as "Former member", and its voice notes are removed. A subscription is cancelled.
 */
export async function deleteAccount(user: UserRow): Promise<void> {
  const owned = all<{ id: string }>("SELECT id FROM files WHERE owner_id = ?", user.id).map((r) => r.id);
  const joined = all<{ file_id: string }>(
    "SELECT file_id FROM members WHERE user_id = ? AND file_id NOT IN (SELECT id FROM files WHERE owner_id = ?)",
    user.id,
    user.id,
  ).map((r) => r.file_id);
  const blobs = owned.flatMap((f) => fileBlobs(f));
  blobs.push(...all<{ blob: string }>("SELECT blob FROM audio WHERE author_id = ?", user.id).map((r) => r.blob));

  tx(() => {
    for (const f of owned) run("DELETE FROM files WHERE id = ?", f);
    run("DELETE FROM audio WHERE author_id = ?", user.id);
    run("DELETE FROM users WHERE id = ?", user.id);
  });
  await releaseBlobs(blobs);

  // Stop a subscription that would otherwise keep billing a deleted account.
  if (user.stripe_subscription_id) {
    try {
      await cancelSubscription(user.stripe_subscription_id);
    } catch (e) {
      console.error("[account] could not cancel the subscription", e instanceof Error ? e.message : e);
    }
  }
  const hub = getHub();
  for (const f of owned) hub.kick(f);
  for (const f of joined) hub.kick(f, user.id);
}
