// The server's config as the editor holds it: taken once at start-up (serverConfig),
// and taken again after an admin saves the funding or the sponsor, so the change shows
// without a reload. null with no server, and then nothing here is shown.

import { serverConfig } from "../../platform/api.ts";
import type { ServerConfig } from "../../platform/protocol.ts";

let current: ServerConfig | null = null;
const listeners = new Set<() => void>();

/** What the server offers (null with no server, or before start-up has asked). */
export function config(): ServerConfig | null {
  return current;
}

/** Calls `fn` now and whenever the config changes; returns a function that stops it. */
export function onConfig(fn: () => void): () => void {
  listeners.add(fn);
  fn();
  return () => listeners.delete(fn);
}

function set(next: ServerConfig | null): void {
  current = next;
  for (const fn of [...listeners]) fn();
}

/** Takes the config at start-up. */
export async function loadConfig(): Promise<ServerConfig | null> {
  set(await serverConfig());
  return current;
}

/**
 * Fetches /api/config again. The api.ts client keeps the first answer, and only the admin's
 * funding and sponsor settings change it while the editor runs.
 */
export async function reloadConfig(): Promise<void> {
  const res = await fetch("/api/config", { credentials: "include" });
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  set((await res.json()) as ServerConfig);
}
