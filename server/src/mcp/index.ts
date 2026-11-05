// The mcp feature on the server: the token and connected-app routes, the MCP endpoint at /mcp, and
// the live relay that Rodeo tabs connect to. The endpoint's bearer tokens come from personal access
// tokens or from OAuth sign-in, which lives in server/src/oauth. The server's entry calls registerMcp
// before the editor's catch-all, and attachMcp once it has the HTTP server.

import type { IncomingMessage, Server } from "node:http";
import type { Hono } from "hono";
import { config } from "../config.ts";
import { allowedOrigin, registerEndpoint } from "./endpoint.ts";
import { attachRelay, type Relay } from "./relay.ts";
import { loadTools, registerTokenRoutes, saveTools } from "./store.ts";

export { allowedOrigin } from "./endpoint.ts";

/** The signed-in account of a WebSocket upgrade: a Rodeo tab's session cookie, or null. */
export interface McpDeps {
  userFromRequest(req: IncomingMessage): { readonly id: string; readonly name: string } | null;
}

/** The live relay, once attachMcp has attached it to the HTTP server. */
let relay: Relay | null = null;

/** Adds the mcp feature's routes to the app. Register them before the editor's catch-all (registerStatic). */
export function registerMcp(app: Hono): void {
  registerTokenRoutes(app);
  registerEndpoint(app, { relay: () => relay, siteUrl: config.publicUrl, version: config.version });
}

/** Attaches the live relay to the HTTP server, so Rodeo tabs can connect to /api/mcp/live. */
export function attachMcp(server: Server, deps: McpDeps): void {
  const live = attachRelay(server, {
    userFromRequest: deps.userFromRequest,
    allowedOrigin,
    siteUrl: config.publicUrl,
    saveTools,
    loadTools,
  });
  relay = live;
  server.on("close", () => live.close());
}
