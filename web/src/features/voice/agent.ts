// The agent's side of a voice request: whether the agent can take it now (the server, the sign-in,
// the AI credit), the text that tells the agent what was said and where the user pointed, and the
// run itself, through the Agents panel's own loop and threads. A voice conversation is an Agents
// thread, so it shows in the panel's list; the next voice request in the same drawing carries on
// from it for a while. The agents' big modules load with the first request, not at start.

import { appContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { errorMessage } from "../../app/toast.ts";
import { refreshUser, serverConfig, userReady } from "../../platform/api.ts";
import type { AiCreditTerms } from "../../platform/protocol.ts";
import { pricing } from "../account/credit.ts";
import type { AgentEvent } from "../agents/agent.ts";
import { agentSettings, type AgentSettings } from "../agents/settings.ts";
import type { Thread } from "../agents/threads.ts";

/** A selected object, as the agent is told it. */
export interface AskSubject { readonly id: string; readonly label: string; readonly className: string; readonly layerName: string }
/** A point the user clicked while speaking. `at` is in millimetres; `snap` names what it snapped to, if anything. */
export interface AskPin {
  readonly n: number;
  readonly at: { readonly x: number; readonly y: number; readonly z?: number };
  readonly objectId: string | null;
  readonly label: string;
  readonly snap: string | null;
  readonly in3d: boolean;
}
/** What a voice request tells the agent: the words, the selection, the pins and the view. */
export interface AskInput {
  /** what was said, as heard */
  readonly transcript: string;
  readonly selection: readonly AskSubject[];
  readonly pins: readonly AskPin[];
  /** one line: what the editor shows ("the plan, showing x 0 to 20,000 and y 0 to 12,000 mm") */
  readonly view: string;
  /** what each pointing word points at ('"this" = pin 1'), from parse.ts's pointingLines */
  readonly pointing: readonly string[];
}
/** Whether the agent can take a voice request: ok with its models, or the reason it can't (and the terms, for credit). */
export type Gate =
  | { readonly kind: "ok"; readonly settings: AgentSettings }
  | { readonly kind: "none"; readonly message: string }
  | { readonly kind: "signin"; readonly message: string }
  | { readonly kind: "credit"; readonly message: string; readonly terms: AiCreditTerms };
/** The callbacks a voice request's run reports to. */
export interface AskHandlers {
  /** a line saying what the agent is doing now */
  status(text: string): void;
}
/** How a voice request's run ended: its reply, or the error that stopped it. */
export interface AskEnd {
  readonly reply: string;
  readonly error: string | null;
  /** the server's reason ("credit", "unauthorized") */
  readonly errorCode: string | null;
  readonly stopped: boolean;
  readonly threadId: string;
  /** what the run took from the AI credit, in its currency (0: free, or nothing charged) */
  readonly cost: number;
}

/** How long after its last request a voice conversation still carries on. */
const CARRY_MS = 10 * 60 * 1000;
/** How many selected objects the agent is told about by name. */
const LIST_MAX = 20;

/** The voice conversation in progress, with when it last ran and the drawing it was in. */
let kept: { thread: Thread; at: number; session: unknown } | null = null;

/** Whether the agent can take a voice request now, and on which models. */
export async function agentGate(model: "fast" | "full"): Promise<Gate> {
  const cfg = await serverConfig();
  if (!cfg) return { kind: "none", message: "Voice commands need Rodeo's agent: this copy of Rodeo has no server for it." };
  if (!cfg.ai) return { kind: "none", message: "Voice commands need Rodeo's agent, which isn't set up on this server." };
  const user = await userReady();
  if (!user) return { kind: "signin", message: "Sign in to use voice commands." };
  const t = cfg.ai.credit;
  if (t && (user.aiCredit ?? 0) < t.hold) return { kind: "credit", message: `Add AI credit to use voice commands. ${pricing(t)}`, terms: t };
  return { kind: "ok", settings: model === "fast" ? { planner: cfg.ai.worker, worker: cfg.ai.worker } : agentSettings(cfg.ai) };
}

/** A millimetre figure as the agent reads it: whole, with thousands separators, and never "-0". */
function mm(v: number): string {
  return (Math.round(v) || 0).toLocaleString("en-GB");
}

/** One clicked point, as one line of the context. */
function pinLine(p: AskPin): string {
  const z = p.at.z === undefined ? "" : `, z ${mm(p.at.z)}`;
  const where = `x ${mm(p.at.x)}, y ${mm(p.at.y)}${z} mm${p.in3d ? " in the 3D view" : ""}`;
  const snap = p.snap ? `, snapped to ${p.snap}` : "";
  const on = p.objectId ? `on ${p.objectId} ${p.label}${snap}` : `on nothing${snap}`;
  return `${p.n}. ${where} — ${on}`;
}

/** The note sent after the words: the editor's state (`now`, the agents' stateNote) and the voice context. DOM-free. */
export function voiceContext(input: AskInput, now: string): string {
  const lines: string[] = [
    now,
    "",
    "## Voice command",
    'The user said the message above aloud while holding the voice key, and may have clicked points ("pins") as they spoke. "This", "that", "these" and "it" mean the selected objects or the objects under the pins; "here" and "there" mean the pins, in the order they were clicked.',
    "The words come from speech recognition and may be misheard: read them for what the user most likely meant.",
    "Be quick: act at once, without looking or rendering unless the request needs it. Make the whole change in ONE edit or edit_batch call if you can: the user undoes a voice command in one step. Answer in one short sentence. If it is unclear, ask one short question instead of guessing.",
  ];
  if (input.selection.length) {
    lines.push(`Selected (${input.selection.length}):`);
    for (const s of input.selection.slice(0, LIST_MAX)) lines.push(`- ${s.id} ${s.label}, class ${s.className}, layer "${s.layerName}"`);
    if (input.selection.length > LIST_MAX) lines.push(`- …and ${input.selection.length - LIST_MAX} more`);
  } else {
    lines.push("Nothing is selected.");
  }
  if (input.pins.length) {
    lines.push("Pins:");
    for (const p of input.pins) lines.push(pinLine(p));
  } else {
    lines.push("No pins.");
  }
  if (input.pointing.length) lines.push(`Words: ${input.pointing.join("; ")}`);
  lines.push(`View: ${input.view}`);
  return lines.join("\n");
}

/** The last thing the agent said in a run, as text; "" when it said nothing. */
function lastReply(added: readonly { readonly role: string; readonly content: unknown }[]): string {
  for (let i = added.length - 1; i >= 0; i--) {
    const m = added[i];
    if (m.role === "assistant" && typeof m.content === "string" && m.content.trim()) return m.content.trim();
  }
  return "";
}

/** Sends a voice request to the agent and waits for its answer. Never throws. */
export async function askAgent(input: AskInput, settings: AgentSettings, signal: AbortSignal, on: AskHandlers): Promise<AskEnd> {
  let threadId = "";
  let cost = 0;
  try {
    const app = appContext();
    if (!app) return { reply: "", error: "The editor isn't ready.", errorCode: null, stopped: signal.aborted, threadId, cost };

    const [threads, prompt, engine] = await Promise.all([
      import("../agents/threads.ts"),
      import("../agents/prompt.ts"),
      import("../agents/agent.ts"),
    ]);
    const session = store.session;
    let t: Thread | null = null;
    if (kept && Date.now() - kept.at < CARRY_MS && kept.session === session) t = kept.thread;
    if (!t) {
      t = threads.newThread();
      t.title = threads.titleFrom(`Voice: ${input.transcript}`);
    }
    threadId = t.id;
    t.messages.push({
      role: "user",
      content: [
        { type: "text", text: input.transcript },
        { type: "text", text: voiceContext(input, prompt.stateNote()) },
      ],
    });

    let answering = false;
    const onEvent = (e: AgentEvent): void => {
      switch (e.kind) {
        case "tool":
          if (!e.sub) on.status(e.label);
          break;
        case "sub_start":
          on.status(`Helper: ${e.title}`);
          break;
        case "text":
          // the main agent's first words are its answer; a helper's are its own work
          if (!e.sub && !answering) {
            answering = true;
            on.status("Answering…");
          }
          break;
        case "usage":
          cost += e.usage.charged ?? 0;
          break;
      }
    };

    const end = await engine.runAgent({ app, settings, history: t.messages, attachments: new Map<string, File>(), signal, onEvent });
    t.messages.push(...end.added);
    t.updated = Date.now();
    t.cost += cost;
    await threads.saveThread(t);
    kept = { thread: t, at: Date.now(), session };
    // the balance moved: the account's figure is read again for the next start
    if (cost) void refreshUser();
    return { reply: lastReply(end.added), error: end.error, errorCode: end.errorCode, stopped: end.stopped, threadId, cost };
  } catch (err) {
    return { reply: "", error: errorMessage(err), errorCode: null, stopped: signal.aborted, threadId, cost };
  }
}

/** Starts the next voice request in a new conversation (a new drawing). */
export function forgetVoiceThread(): void {
  kept = null;
}

/** A reply as the card shows it: its first sentence or line as the title (≤ 140 characters), the rest as the body (≤ 400), Markdown marks removed. */
export function replyText(markdown: string): { readonly title: string; readonly body: string } {
  const text = markdown
    .replace(/\*\*|__|`/g, "")
    .replace(/^[ \t]*#+[ \t]*/gm, "")
    .replace(/^[ \t]*[-*][ \t]+/gm, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]*\n/g, "\n")
    .trim();
  // the title ends at the first sentence's full stop, mark or a line break
  const end = /[.?!](?=\s|$)|\n/.exec(text);
  const sentence = end ? text.slice(0, end.index + (end[0] === "\n" ? 0 : 1)).trim() : text;
  const rest = end ? text.slice(end.index + end[0].length).trim() : "";
  const cut = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
  // a sentence too long for the title keeps its overflow at the start of the body
  const overflow = sentence.length > 140 ? sentence.slice(139) : "";
  return {
    title: cut(sentence.replace(/\s+/g, " "), 140),
    body: cut([overflow, rest].filter(Boolean).join(" ").replace(/\s+/g, " "), 400),
  };
}
