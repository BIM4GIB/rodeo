// The Connect an Agent dialog's calls to the server (/api/mcp/tokens and the connected apps under
// /api/mcp/grants), and word to whoever listens (the tab's bridge to agents) when the number of
// connections changes: tokens and connected apps. Calls go through a small fetch of their own:
// platform/api.ts keeps its request helper private.

import { ApiError } from "../../platform/api.ts";
import type { AgentToken, AgentTokenList, NewAgentToken } from "./wire.ts";

const listeners = new Set<(count: number) => void>();
// the last count told: holdConnection repeats it, so the listeners that read the number see the real one
let lastCount = 0;
// set once the dialog asks for this tab to stay connected for agents
let held = false;

function tell(count: number): void {
  lastCount = count;
  for (const fn of [...listeners]) fn(count);
}

/** How many connections a list holds: its tokens and its connected apps. The bridge connects while there is one. */
export function connectionCount(list: AgentTokenList): number {
  return list.tokens.length + (list.grants?.length ?? 0);
}

/**
 * Keeps this tab connected for agents from now on, with or without a connection yet. The dialog calls
 * it, so the tab's tools reach the server before the person connects an app from another window.
 */
export function holdConnection(): void {
  held = true;
  tell(Math.max(lastCount, 1));
}

/** Whether holdConnection was called in this page. */
export function connectionHeld(): boolean {
  return held;
}

/** One call to /api; errors come back as ApiError with the server's message and code. */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: "include",
      headers: { "X-Requested-With": "openvwx", ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("The Rodeo server could not be reached", 0, "network");
  }
  if (!res.ok) {
    let error: string | undefined;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; code?: string };
      error = j.error;
      code = j.code;
    } catch {
      // not JSON: a proxy in front answered
    }
    throw new ApiError(error ?? `The server answered ${res.status}`, res.status, code);
  }
  // a removal answers 204 with no body
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Fetches the list again without failing: it only refreshes the count the listeners hear. */
async function relist(): Promise<void> {
  try {
    tell(connectionCount(await call<AgentTokenList>("GET", "/mcp/tokens")));
  } catch {
    // the count stays as it was; the dialog shows its own errors
  }
}

export const tokensApi = {
  /** The user's tokens, connected apps and the endpoint agents connect to. */
  async list(): Promise<AgentTokenList> {
    const list = await call<AgentTokenList>("GET", "/mcp/tokens");
    tell(connectionCount(list));
    return list;
  },

  /** Makes a token; the secret in the answer is shown once and never stored here. */
  async create(name: string): Promise<NewAgentToken> {
    const made = await call<NewAgentToken>("POST", "/mcp/tokens", { name });
    await relist();
    return made;
  },

  /** Renames a token. */
  async rename(id: string, name: string): Promise<AgentToken> {
    const { token } = await call<{ token: AgentToken }>("PATCH", `/mcp/tokens/${encodeURIComponent(id)}`, { name });
    return token;
  },

  /** Removes a token: agents using it lose access at once. */
  async remove(id: string): Promise<void> {
    await call<void>("DELETE", `/mcp/tokens/${encodeURIComponent(id)}`);
    await relist();
  },

  /** Disconnects an app that signed in with OAuth: it loses access at once. */
  async removeGrant(id: string): Promise<void> {
    await call<void>("DELETE", `/mcp/grants/${encodeURIComponent(id)}`);
    await relist();
  },
};

/** Calls fn with how many connections the user has (tokens and connected apps), after each list, create and remove. Returns a function that stops it. */
export function onTokensChanged(fn: (count: number) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
