// What the mcp feature's parts say to each other: the MCP shapes tools take and return (the
// HTTP endpoint, the stdio server and a Rodeo tab all use them), the live socket's messages
// between a tab and the server (/api/mcp/live), and the token and connected-app lists the
// Connect an Agent dialog shows. Free of the DOM and of Node: the server, the CLI and the editor
// all import it.

/** A tool as MCP lists it (tools/list). */
export interface McpTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
    readonly destructiveHint?: boolean;
    readonly idempotentHint?: boolean;
    readonly openWorldHint?: boolean;
  };
}

/** A piece of a tool's result: text, or a picture as base64. */
export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly data: string; readonly mimeType: string };

/** A tool's result. isError: the tool failed and the text says why, so the model can recover. */
export interface McpCallResult {
  readonly content: readonly McpContent[];
  readonly isError: boolean;
}

/** What a tool call is given besides its arguments. */
export interface CallContext {
  /** aborted when the client cancels the call or goes away */
  readonly signal: AbortSignal;
  /** a line of progress, passed on to the client when it asked for progress */
  progress(message: string): void;
  /** the client's name (its clientInfo.name), when it gave one */
  readonly client: string | null;
}

/** An MCP server as rpc.ts serves it, over HTTP or stdio. */
export interface McpServer {
  readonly name: string;
  readonly title: string;
  readonly version: string;
  instructions(): string;
  listTools(): Promise<readonly McpTool[]>;
  callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<McpCallResult>;
}

// ---- the live socket between a Rodeo tab and the server ----------------------------

export const LIVE_PATH = "/api/mcp/live";
/** close code: a newer connection with the same tab id took this one's place */
export const CLOSE_REPLACED = 4000;
/** close code: the account has too many tabs connected */
export const CLOSE_TOO_MANY = 4001;

/** The drawing in front in a tab. */
export interface TabDrawing {
  readonly name: string;
  /** a cloud drawing's file id; null for a file from disk */
  readonly fileId: string | null;
  /** opened view only: Rodeo refuses edits to it */
  readonly readOnly: boolean;
}

/** What a tab sends the server. */
export type TabMessage =
  | {
      readonly t: "hello";
      readonly tabId: string;
      readonly focused: boolean;
      readonly visible: boolean;
      readonly drawing: TabDrawing | null;
      readonly tools: readonly McpTool[];
      readonly instructions: string;
    }
  | { readonly t: "focus"; readonly focused: boolean; readonly visible: boolean }
  | { readonly t: "drawing"; readonly drawing: TabDrawing | null }
  | { readonly t: "progress"; readonly id: string; readonly text: string }
  | { readonly t: "result"; readonly id: string; readonly result: McpCallResult };

/** What the server sends a tab. */
export type RelayMessage =
  | { readonly t: "welcome" }
  | { readonly t: "call"; readonly id: string; readonly tool: string; readonly args: Record<string, unknown>; readonly agent: string }
  | { readonly t: "cancel"; readonly id: string };

// ---- personal access tokens (/api/mcp/tokens) --------------------------------------

export const TOKEN_PREFIX = "rodeo_pat_";
export const MAX_TOKENS = 20;

/** A token as its owner's list shows it; the secret itself is shown once, when it is made. */
export interface AgentToken {
  readonly id: string;
  readonly name: string;
  /** its first characters, e.g. "rodeo_pat_Ab3x", to tell tokens apart */
  readonly prefix: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** the agent app that last used it, as it names itself ("claude-code") */
  readonly lastClient: string | null;
}

/** An app the person allowed to sign in with OAuth (claude.ai, Claude Code, Cursor…), as the dialog lists it. */
export interface AgentGrant {
  readonly id: string;
  /** "Claude", or the name the app gave itself */
  readonly name: string;
  /** where Rodeo sends the person back: "claude.ai", "this computer", "cursor://anysphere.cursor-mcp" */
  readonly where: string;
  /** false: Rodeo couldn't check the app is what it says */
  readonly verified: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  /** the agent app that last used it, as it names itself ("claude-ai") */
  readonly lastClient: string | null;
}

/** GET /api/mcp/tokens */
export interface AgentTokenList {
  readonly tokens: readonly AgentToken[];
  /** the apps connected by OAuth sign-in */
  readonly grants: readonly AgentGrant[];
  /** the MCP endpoint's address, e.g. https://rodeo.build/mcp */
  readonly endpoint: string;
}

/** POST /api/mcp/tokens: the new token and, this once, its secret. */
export interface NewAgentToken {
  readonly token: AgentToken;
  readonly secret: string;
}
