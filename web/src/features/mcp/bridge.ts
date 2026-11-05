// The live agent bridge: connects this tab to Rodeo's server (/api/mcp/live) while the user has
// agent tokens or connected apps, offers the Agents panel's tools, and runs the calls outside agents
// send, one at a time, in the drawing in front, as the Agents panel would. Stop refuses calls until Resume.
//
// This file runs in the browser. The agent engine (its tools and prompt) loads on the first
// connect, so a user with no token never fetches it, and nothing here imports the Node-only parts
// of the feature (rpc, headless, cli).

import { appContext, documentSource, onDocument, type AppContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { currentUser, onUser, serverConfig, userReady } from "../../platform/api.ts";
import type { Picture } from "../agents/look.ts";
import type { OutFile, Tool, ToolContext, ToolOutput } from "../agents/tools.ts";
import { connectionCount, connectionHeld, onTokensChanged, tokensApi } from "./api.ts";
import {
  CLOSE_REPLACED,
  CLOSE_TOO_MANY,
  LIVE_PATH,
  type McpCallResult,
  type McpContent,
  type McpTool,
  type RelayMessage,
  type TabDrawing,
  type TabMessage,
} from "./wire.ts";

export type BridgeStatus = "off" | "connecting" | "ready" | "offline";

/** One call an agent made, as the pill's menu lists it; ok is null while the call runs. */
export interface CallLog {
  readonly id: string;
  readonly at: number;
  readonly agent: string;
  readonly label: string;
  readonly ok: boolean | null;
}

export interface BridgeState {
  readonly status: BridgeStatus;
  readonly paused: boolean;
  /** the call running now */
  readonly running: { readonly agent: string; readonly label: string; readonly progress: string } | null;
  readonly queued: number;
  /** when an agent's call last came, 0 for never */
  readonly lastCallAt: number;
  readonly lastAgent: string;
  /** newest first, at most 30 */
  readonly log: readonly CallLog[];
  /** files agents made (exports, full-size renders), newest first, at most 10 */
  readonly files: readonly OutFile[];
}

type CallMessage = Extract<RelayMessage, { readonly t: "call" }>;

/** What the tools and the offer to agents are built from, loaded once on the first connect. */
interface Toolset {
  readonly app: AppContext;
  readonly byName: ReadonlyMap<string, Tool>;
  readonly offer: readonly McpTool[];
  readonly instructions: string;
}

const LOG_MAX = 30;
const FILES_MAX = 10;
/** automatic downloads a minute, so a burst of exports does not flood the browser */
const DOWNLOADS_PER_MINUTE = 10;
const MINUTE = 60_000;
// a tab that comes back into focus re-checks its connections at most this often
const RECHECK_MS = 30_000;
/** the wait before each reconnect, the last one repeating */
const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
const ATTACH_TOOL = "attach_file";
const ATTACH_MAX = 4 * 1024 * 1024;
const ATTACH_FILES_MAX = 20;
const ATTACH_BYTES_MAX = 50 * 1024 * 1024;
const ATTACH_NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,120}$/;

const PAUSED_TEXT = "The user pressed Stop in Rodeo, so Rodeo isn't taking calls. Stop here and ask the user what they want; they can press Resume in Rodeo's top bar.";
const STOPPED_TEXT = "Stopped by the user in Rodeo before it ran.";
const VIEW_ONLY_TEXT = "The drawing in front is open view only, so Rodeo won't change it. Ask the user to open a copy they can edit.";
const EXPORT_DONE = "it is in the chat for the user to download";

/** What an agent reads first: how the bridge works, before the agents' shared notes. */
const LIVE_INTRO =
  "You are working in the user's open drawing in Rodeo, a browser CAD editor for Vectorworks files, through their Rodeo tab: they watch each change as you make it, and Rodeo's top bar shows what you are doing. Tools act on the drawing in front in the tab list_drawings marks current; use_drawing picks another tab. If a tool says no Rodeo tab is open, ask the user to open Rodeo and sign in. If the user presses Stop in Rodeo, your calls are refused: stop and ask them what they want. Rodeo draws only while its tab is visible, so looks and renders need it on screen. Exported files are downloaded in the user's browser; give Rodeo files to import with attach_file, then import_file. Your own model does the thinking: Rodeo's AI credit isn't used.";

/** Tool titles the connecting app shows. */
const TITLES: Record<string, string> = {
  overview: "Drawing overview",
  doc: "Read the document",
  edit: "Edit",
  edit_batch: "Edit as one step",
  api_docs: "API reference",
  look_plan: "Look at the plan",
  look_3d: "Look in 3D",
  check_3d: "Check solids",
  render: "Render",
  lighting: "Lighting",
  editor: "Editor",
  commands: "Find menu commands",
  run_command: "Run a menu command",
  export_file: "Export a file",
  import_file: "Import a file",
  axo_to_3d: "3D from axonometric line work",
  measure_axo: "Measure an axonometric",
  read_plan: "Read a floor plan",
  build: "Build in 3D",
  run_script: "Run a script",
  plugins: "Plug-ins",
};

/** Tools that only look: a view-only drawing still lets them run. */
const READ_ONLY = new Set(["overview", "doc", "api_docs", "look_plan", "look_3d", "check_3d", "render", "commands", "read_plan", "measure_axo"]);

/** Tools that can undo little or change a lot: their hints say so to the agent. */
const DESTRUCTIVE = new Set(["edit", "edit_batch", "run_script", "run_command", "import_file", "plugins", "editor"]);

/** Words in a tool's description that differ outside Rodeo's own panel: each pair is replaced once. */
const DESCRIPTION_PATCHES: Record<string, readonly [string, string]> = {
  export_file: [
    "Exports the drawing as a file the user can download from the chat:",
    "Exports the drawing as a file, which Rodeo downloads in the user's browser (normally to their Downloads folder):",
  ],
  import_file: ["Imports a file the user attached to the chat, by its name:", "Imports a file given with attach_file, by its name:"],
  render: [
    "The user gets the full-size picture to download; you get a smaller copy.",
    "The full-size picture waits in Rodeo's agent menu (top bar) for the user to download; you get a smaller copy.",
  ],
};

/** The attach_file tool, which only the bridge offers: it gives Rodeo a file for import_file. */
const ATTACH_SPEC: McpTool = {
  name: ATTACH_TOOL,
  title: "Give Rodeo a file",
  description:
    "Gives Rodeo a file for import_file to bring into the drawing: as text (an OBJ, DXF, SVG or other text format you wrote) or as base64 (a small binary file, at most 4 MB). Rodeo can't read files on the user's computer or fetch URLs. Giving a name again replaces that file; files stay until the user reloads Rodeo.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "the file's name with its extension, e.g. part.obj" },
      text: { type: "string" },
      base64: { type: "string" },
    },
    required: ["name"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

let state: BridgeState = { status: "off", paused: false, running: null, queued: 0, lastCallAt: 0, lastAgent: "", log: [], files: [] };
const listeners = new Set<(s: BridgeState) => void>();

/** A tab's id for the server: one per page, so a reload is a new tab. */
const tabId = newTabId();
let toolset: Toolset | null = null;
let socket: WebSocket | null = null;
/** true while the tools load before a socket is made */
let opening = false;
/** bumped by each disconnect, so a connect that was still loading gives up */
let generation = 0;
let started = false;
let retries = 0;
let retryTimer: number | undefined;
const queue: CallMessage[] = [];
let current: { readonly id: string; readonly ctl: AbortController } | null = null;
let pumping = false;
const attachments = new Map<string, File>();
/** the drawing the last call worked in: undefined before any call, null for none */
let lastFile: string | null | undefined;
let downloadTimes: number[] = [];

/** Starts the bridge once. It connects while the user is signed in and has a token or a connected app, and drops when they have neither. */
export function startBridge(): void {
  if (started) return;
  started = true;
  onUser(() => void check());
  onTokensChanged((n) => (n > 0 || connectionHeld() ? connect() : disconnect()));
  void userReady().then(() => check());
  onDocument(() => send({ t: "drawing", drawing: drawingNow() }));
  window.addEventListener("focus", sendFocus);
  window.addEventListener("focus", recheck);
  window.addEventListener("blur", sendFocus);
  document.addEventListener("visibilitychange", sendFocus);
  window.addEventListener("pagehide", disconnect);
}

/** What the bridge is doing now, as the pill and its menu show it. */
export function bridgeState(): BridgeState {
  return state;
}

/** Calls fn with the state each time it changes; returns a function that stops it. */
export function onBridge(fn: (s: BridgeState) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** A line for the Connect an Agent dialog about this tab's side of the connection. */
export function bridgeStatusText(): string {
  switch (state.status) {
    case "ready":
      return "This tab is ready: agents' calls go to the drawing in front of the Rodeo tab you used last.";
    case "connecting":
      return "Connecting this tab for agents…";
    case "offline":
      return "This tab lost its connection to Rodeo's server and keeps trying.";
    default:
      return "This tab connects for agents once you connect one.";
  }
}

/** Stop: the running call is aborted, the queued calls are refused, and new calls are refused until Resume. */
export function stopAgents(): void {
  set({ paused: true });
  current?.ctl.abort();
  for (const call of queue.splice(0)) send({ t: "result", id: call.id, result: text(STOPPED_TEXT, true) });
  set({ queued: 0 });
}

/** Resume: calls are taken again. */
export function resumeAgents(): void {
  set({ paused: false });
}

// ---- state ----------------------------------------------------------------------

/** Replaces the state and tells the listeners. */
function set(patch: Partial<BridgeState>): void {
  state = { ...state, ...patch };
  for (const fn of [...listeners]) fn(state);
}

/** A tab id: randomUUID where the page is secure, a random string where it is not (a plain http address on a LAN). */
function newTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** The drawing in front, as the server and the agents are told of it (null with none open). */
function drawingNow(): TabDrawing | null {
  const s = store.session;
  if (!s) return null;
  const src = documentSource();
  return { name: s.doc.info.fileName, fileId: src?.kind === "cloud" ? (src.id ?? null) : null, readOnly: !!src?.readOnly };
}

// ---- connecting -----------------------------------------------------------------

/** Connects when the user is signed in and has a connection (a token or an app); disconnects when they have none. */
async function check(): Promise<void> {
  if (!(await serverConfig()) || !currentUser()) {
    disconnect();
    return;
  }
  try {
    const list = await tokensApi.list();
    if (connectionCount(list) > 0 || connectionHeld()) connect();
    else disconnect();
  } catch {
    // the dialog shows its own errors; the bridge keeps what it had
  }
}

// when the tab last re-checked on focus
let lastRecheck = 0;

/** Coming back to this tab re-checks its connections, so one made in another tab (say, in claude.ai) brings this tab up too. */
function recheck(): void {
  if (state.status !== "off" || !currentUser()) return;
  const now = Date.now();
  if (now - lastRecheck < RECHECK_MS) return;
  lastRecheck = now;
  void check();
}

/** Opens the socket, unless one is open or opening already. */
function connect(): void {
  if (socket || opening) return;
  opening = true;
  clearRetry();
  set({ status: "connecting" });
  void open(generation);
}

/** Loads the tools, then opens the socket. A connect that disconnect overtook gives up quietly. */
async function open(gen: number): Promise<void> {
  let tools: Toolset;
  try {
    tools = await loadTools();
  } catch {
    if (gen !== generation) return;
    opening = false;
    set({ status: "offline" });
    scheduleRetry();
    return;
  }
  if (gen !== generation) return;
  opening = false;
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${LIVE_PATH}`);
  socket = ws;
  ws.onopen = () => send(hello(tools));
  ws.onmessage = (e) => onRelay(e.data);
  ws.onclose = (e) => onClose(ws, e);
}

/** Closes the socket, drops the calls and stops retrying. */
function disconnect(): void {
  generation++;
  opening = false;
  clearRetry();
  retries = 0;
  const ws = socket;
  socket = null;
  dropCalls();
  ws?.close(1000);
  set({ status: "off" });
}

/** The socket closed: calls in flight are lost, and the bridge retries unless the server said not to. */
function onClose(ws: WebSocket, e: CloseEvent): void {
  if (ws !== socket) return;
  socket = null;
  dropCalls();
  if (e.code === CLOSE_REPLACED) {
    set({ status: "off" });
    return;
  }
  if (e.code === CLOSE_TOO_MANY) {
    toast("Too many Rodeo tabs are connected for agents: close some, then reload this one.");
    set({ status: "off" });
    return;
  }
  set({ status: "offline" });
  scheduleRetry();
}

/** Waits, then tries again: the token list is read first, so a user who removed their last token stays off. */
function scheduleRetry(): void {
  clearRetry();
  const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
  retries++;
  retryTimer = window.setTimeout(() => {
    retryTimer = undefined;
    void reconnect();
  }, wait);
}

/** The retry itself: a signed-out user stops; otherwise the token list's answer decides whether the bridge connects. */
async function reconnect(): Promise<void> {
  if (!currentUser()) {
    set({ status: "off" });
    return;
  }
  try {
    // the list tells the connection listener, which connects while there is one
    await tokensApi.list();
  } catch {
    scheduleRetry();
  }
}

function clearRetry(): void {
  if (retryTimer !== undefined) {
    window.clearTimeout(retryTimer);
    retryTimer = undefined;
  }
}

/** What a tab says when it opens its socket: who it is, what is in front, and the tools and instructions. */
function hello(tools: Toolset): TabMessage {
  return {
    t: "hello",
    tabId,
    focused: document.hasFocus(),
    visible: document.visibilityState === "visible",
    drawing: drawingNow(),
    tools: tools.offer,
    instructions: tools.instructions,
  };
}

/** Tells the server whether this tab is focused and visible, so it knows which tab an agent should use. */
function sendFocus(): void {
  send({ t: "focus", focused: document.hasFocus(), visible: document.visibilityState === "visible" });
}

/** Sends one message to the server, if the socket is open. */
function send(msg: TabMessage): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
}

/** Reads what the server sent: welcome, a call to run, or a cancel. */
function onRelay(data: unknown): void {
  let msg: RelayMessage | null = null;
  try {
    msg = JSON.parse(String(data)) as RelayMessage;
  } catch {
    return;
  }
  if (!msg || typeof msg !== "object") return;
  if (msg.t === "welcome") {
    retries = 0;
    set({ status: "ready" });
  } else if (msg.t === "call") {
    enqueue(msg);
  } else if (msg.t === "cancel") {
    cancel(msg.id);
  }
}

// ---- the tools ------------------------------------------------------------------

/** Loads the Agents panel's tools and the instructions for agents, once. Throws when the editor is not running yet. */
async function loadTools(): Promise<Toolset> {
  if (toolset) return toolset;
  const app = appContext();
  if (!app) throw new Error("Rodeo isn't running yet");
  const [tools, prompt, docs] = await Promise.all([import("../agents/tools.ts"), import("../agents/prompt.ts"), import("../agents/apidocs.ts")]);
  const list = tools.toolsFor(false, app);
  const byName = new Map(list.map((t) => [t.spec.function.name, t]));
  const reads = tools.docMembers().filter((n) => docs.methodNames("VwxDocument").includes(n) || n === "info");
  const instructions = [
    LIVE_INTRO,
    patchCommon(prompt.COMMON),
    `## API\ndoc reads: ${reads.join(", ")}.\nedit methods: ${tools.editMethods().join(", ")}.`,
  ].join("\n");
  toolset = { app, byName, offer: [...list.map(mcpTool), ATTACH_SPEC], instructions };
  return toolset;
}

/** A tool as MCP lists it: its title, its description with the few words that differ outside the panel, and its hints. */
function mcpTool(tool: Tool): McpTool {
  const name = tool.spec.function.name;
  const annotations = READ_ONLY.has(name)
    ? { readOnlyHint: true, openWorldHint: false }
    : { readOnlyHint: false, destructiveHint: DESTRUCTIVE.has(name), openWorldHint: false };
  return {
    name,
    title: TITLES[name],
    description: patchDescription(name, tool.spec.function.description),
    inputSchema: tool.spec.function.parameters,
    annotations,
  };
}

/** A tool's description with its patch applied, if it has one. */
function patchDescription(name: string, description: string): string {
  const patch = DESCRIPTION_PATCHES[name];
  return patch ? description.replace(patch[0], patch[1]) : description;
}

/** The agents' shared notes, with the lines that assume the in-panel chat: ids are the real ones here, and files travel by attach_file. */
function patchCommon(common: string): string {
  return common
    .split("\n")
    .map((line) =>
      line.startsWith("- Ids are strings")
        ? "- Ids are strings from the document (doc.objects, doc.layers, ...). A group's contents are listed on their own with parentId set to the group."
        : line,
    )
    .join("\n")
    .replace(
      "Export files with export_file; the user downloads them from the chat. Import files the user attached with import_file.",
      "Export files with export_file: Rodeo downloads them in the user's browser. Give Rodeo files to import with attach_file, then import_file.",
    );
}

// ---- running calls --------------------------------------------------------------

/** Takes a call from the server: refused at once while Stopped, else queued behind the calls before it. */
function enqueue(call: CallMessage): void {
  set({ lastCallAt: Date.now(), lastAgent: call.agent });
  if (state.paused) {
    send({ t: "result", id: call.id, result: text(PAUSED_TEXT, true) });
    return;
  }
  queue.push(call);
  set({ queued: queue.length });
  void pump();
}

/** Runs the queued calls one after another. Edits depend on the ones before them, so no two run at once. */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    let call = queue.shift();
    while (call) {
      set({ queued: queue.length });
      await runOne(call);
      call = queue.shift();
    }
  } finally {
    pumping = false;
  }
}

/** Runs one call: logs it, shows it as running, sends its result back, and logs how it ended. */
async function runOne(call: CallMessage): Promise<void> {
  const ctl = new AbortController();
  current = { id: call.id, ctl };
  const label = labelOf(call);
  set({
    running: { agent: call.agent, label, progress: "" },
    log: [{ id: call.id, at: Date.now(), agent: call.agent, label, ok: null }, ...state.log].slice(0, LOG_MAX),
  });
  const progress = (line: string): void => {
    send({ t: "progress", id: call.id, text: line });
    if (current?.id === call.id && state.running) set({ running: { ...state.running, progress: line } });
  };
  let result: McpCallResult;
  try {
    result = await run(call, ctl.signal, progress);
  } catch (err) {
    result = text(`Error: ${errorMessage(err)}`, true);
  }
  current = null;
  send({ t: "result", id: call.id, result });
  set({ running: null, log: state.log.map((e) => (e.id === call.id ? { ...e, ok: !result.isError } : e)) });
}

/** What the pill and the log call a call: the tool's own label for its arguments, or its name. */
function labelOf(call: CallMessage): string {
  if (call.tool === ATTACH_TOOL) return "Giving Rodeo a file";
  const tool = toolset?.byName.get(call.tool);
  if (!tool) return call.tool;
  try {
    return tool.label(call.args);
  } catch {
    return call.tool;
  }
}

/** Does the work of one call and turns what the tool said into an MCP result. Nothing here throws. */
async function run(call: CallMessage, signal: AbortSignal, progress: (line: string) => void): Promise<McpCallResult> {
  if (call.tool === ATTACH_TOOL) return attach(call.args);
  const t = toolset;
  if (!t) return text("Rodeo's tools aren't loaded yet: ask the user to wait a moment and try again.", true);
  const tool = t.byName.get(call.tool);
  if (!tool) return text(`There is no tool called ${call.tool} in this Rodeo.`, true);
  if (documentSource()?.readOnly && changesDrawing(call.tool, call.args)) return text(VIEW_ONLY_TEXT, true);

  // the agent's last call worked in another drawing: say so, so it checks before it goes on
  const drawing = store.session?.doc.info.fileName ?? null;
  const note =
    lastFile !== undefined && drawing !== lastFile
      ? `(The drawing in front is now ${drawing ? `"${drawing}"` : "none"}; your last call worked in ${lastFile ? `"${lastFile}"` : "no drawing"}.)\n`
      : "";

  const ctx: ToolContext = { app: t.app, signal, attachments, progress };
  let out: ToolOutput;
  try {
    out = await tool.run(call.args, ctx);
  } catch (err) {
    out = signal.aborted ? { text: "Stopped by the user in Rodeo.", error: true } : { text: `Error: ${errorMessage(err)}`, error: true };
  }
  // some tools return normally when aborted (run_script answers "Stopped: Stopped."): the agent
  // should still hear that the user pressed Stop, not a script error
  if (signal.aborted) out = { text: "Stopped by the user in Rodeo.", error: true };
  lastFile = store.session?.doc.info.fileName ?? null;

  let body = out.text;
  const files = out.files ?? [];
  if (call.tool === "export_file" && files.length) {
    // the export is downloaded here, so the text says so; past the limit it waits in the pill's menu
    const sent = files.every((f) => autoDownload(f));
    body = body.replace(
      EXPORT_DONE,
      sent
        ? "Rodeo downloaded it in the user's browser (normally to their Downloads folder)"
        : "Rodeo didn't download it, as too many files came down in a minute: it waits in Rodeo's agent menu (top bar) for the user",
    );
  }
  if (files.length) set({ files: [...files, ...state.files].slice(0, FILES_MAX) });

  const content: McpContent[] = [{ type: "text", text: note + body }];
  for (const p of out.images ?? []) {
    const picture = pictureParts(p);
    if (picture) content.push({ type: "text", text: p.caption }, picture);
  }
  return { content, isError: !!out.error };
}

/** Whether a tool can change the drawing. The editor's save writes the file; its other actions only look at it. */
function changesDrawing(name: string, args: Record<string, unknown>): boolean {
  if (READ_ONLY.has(name) || name === "export_file") return false;
  return !(name === "editor" && args.action !== "save");
}

/** A file downloaded in the browser, unless ten have come down in the last minute; true when it was. */
function autoDownload(file: OutFile): boolean {
  const now = Date.now();
  downloadTimes = downloadTimes.filter((at) => now - at < MINUTE);
  if (downloadTimes.length >= DOWNLOADS_PER_MINUTE) return false;
  downloadTimes.push(now);
  downloadBlob(file.name, file.blob);
  return true;
}

/** A picture as MCP image content: its base64 and type from the JPEG data URL, or null when it isn't one. */
function pictureParts(p: Picture): McpContent | null {
  if (!p.url.startsWith("data:")) return null;
  const comma = p.url.indexOf(",");
  const semi = p.url.indexOf(";");
  const mimeType = semi > 5 ? p.url.slice(5, semi) : "image/jpeg";
  return { type: "image", data: p.url.slice(comma + 1), mimeType };
}

/** Gives Rodeo a file for import_file: text or base64, by name. Giving a name again replaces it. */
function attach(args: Record<string, unknown>): McpCallResult {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!ATTACH_NAME.test(name)) return text("Give the file a plain name with its extension, such as part.obj.", true);
  const hasText = typeof args.text === "string";
  const hasBase64 = typeof args.base64 === "string";
  if (hasText === hasBase64) return text("Give the file's contents as text or as base64.", true);

  let bytes: Uint8Array<ArrayBuffer>;
  if (hasText) {
    bytes = new TextEncoder().encode(args.text as string);
  } else {
    try {
      bytes = decodeBase64(args.base64 as string);
    } catch {
      return text("That base64 doesn't decode.", true);
    }
  }
  if (bytes.length > ATTACH_MAX) return text(`${name} is ${(bytes.length / 1048576).toFixed(1)} MB: Rodeo takes files up to 4 MB here.`, true);

  attachments.delete(name);
  attachments.set(name, new File([bytes], name));
  // the oldest go first, so a session that attaches many files keeps the latest ones
  while (attachments.size > ATTACH_FILES_MAX || attachedBytes() > ATTACH_BYTES_MAX) {
    const oldest = attachments.keys().next().value;
    if (oldest === undefined || oldest === name) break;
    attachments.delete(oldest);
  }
  return text(`Rodeo has ${name} (${Math.ceil(bytes.length / 1024)} KB): import it with import_file.`);
}

/** The bytes of every attached file together. */
function attachedBytes(): number {
  let total = 0;
  for (const f of attachments.values()) total += f.size;
  return total;
}

/** Base64 to bytes; whitespace is allowed, as mail and copy-paste add it. */
function decodeBase64(s: string): Uint8Array<ArrayBuffer> {
  const binary = atob(s.replace(/\s+/g, ""));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Cancels a call: the running one is aborted; a queued one is dropped without a reply. */
function cancel(id: string): void {
  if (current?.id === id) {
    current.ctl.abort();
    return;
  }
  const at = queue.findIndex((c) => c.id === id);
  if (at >= 0) {
    queue.splice(at, 1);
    set({ queued: queue.length });
  }
}

/** Drops the calls waiting and aborts the one running, when the socket goes. */
function dropCalls(): void {
  current?.ctl.abort();
  queue.splice(0);
  set({ queued: 0 });
}

function text(message: string, error = false): McpCallResult {
  return { content: [{ type: "text", text: message }], isError: error };
}
