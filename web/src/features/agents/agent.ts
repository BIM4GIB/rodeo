// The agent loop: the planner model is sent the conversation and its tools, calls tools, sees
// their results (pictures included) and goes on until it answers without a tool call. Its delegate
// tool starts subagents on the worker model, each with its own brief and the same tools, at the
// same time; their reports come back as delegate's result. Everything that happens is told to the
// panel as events, as it happens, so the user watches the text stream in and the tools work.

import type { AppContext } from "../../app/ext.ts";
import { errorMessage } from "../../app/toast.ts";
import { Handles, PLANNER_PICTURES, prunePictures, WORKER_PICTURES, type PictureRule } from "./history.ts";
import { complete, ModelError, type ChatMessage, type ContentPart, type ToolCall, type Usage } from "./llm.ts";
import type { Picture } from "./look.ts";
import { plannerPrompt, workerPrompt } from "./prompt.ts";
import type { AgentSettings } from "./settings.ts";
import { toolsFor, type OutFile, type SubTask, type Tool, type ToolContext, type ToolOutput } from "./tools.ts";

/** Each event names the subagent it comes from (`sub`), or none for the planner. */
export type AgentEvent =
  | { readonly kind: "turn"; readonly sub?: string }
  | { readonly kind: "text"; readonly sub?: string; readonly delta: string }
  | { readonly kind: "reasoning"; readonly sub?: string; readonly delta: string }
  /** a tool call being written: its name and the next piece of its arguments (JSON) */
  | { readonly kind: "writing"; readonly sub?: string; readonly index: number; readonly name: string; readonly delta: string }
  | { readonly kind: "tool"; readonly sub?: string; readonly id: string; readonly name: string; readonly label: string; readonly args: Record<string, unknown> }
  | { readonly kind: "progress"; readonly sub?: string; readonly id: string; readonly text: string }
  | {
      readonly kind: "result";
      readonly sub?: string;
      readonly id: string;
      readonly ok: boolean;
      readonly text: string;
      readonly images: readonly Picture[];
      readonly files: readonly OutFile[];
    }
  | { readonly kind: "sub_start"; readonly sub: string; readonly parent: string; readonly title: string; readonly model: string }
  | { readonly kind: "sub_end"; readonly sub: string; readonly ok: boolean; readonly report: string }
  | { readonly kind: "usage"; readonly sub?: string; readonly model: string; readonly usage: Usage };

export interface RunOptions {
  readonly app: AppContext;
  readonly settings: AgentSettings;
  /** the conversation so far, ending with the user's new message */
  readonly history: readonly ChatMessage[];
  readonly attachments: ReadonlyMap<string, File>;
  readonly signal: AbortSignal;
  onEvent(e: AgentEvent): void;
}

const WORKER_STEPS = 40;
const MAX_TOKENS = 16_000;

interface Loop {
  readonly model: string;
  readonly system: string;
  readonly messages: ChatMessage[];
  readonly tools: readonly Tool[];
  /** model requests it may take before it stops and reports; the planner has no limit */
  readonly maxSteps?: number;
  readonly pictures: PictureRule;
  readonly sub?: string;
  readonly delegate?: (callId: string, tasks: readonly SubTask[]) => Promise<string>;
}

/** What a run added to the conversation, and how it ended. */
export interface RunEnd {
  readonly added: ChatMessage[];
  readonly stopped: boolean;
  /** the error that ended it, if one did, and the server's reason for it ("credit": out of AI credit) */
  readonly error: string | null;
  readonly errorCode: string | null;
}

/** Runs the planner on the conversation. Never throws: a stop or an error still keeps what was done. */
export async function runAgent(opts: RunOptions): Promise<RunEnd> {
  const { settings, app } = opts;
  const messages: ChatMessage[] = [...opts.history];
  const start = messages.length;
  const delegate = async (callId: string, tasks: readonly SubTask[]): Promise<string> => {
    const reports = await Promise.all(tasks.map((t, i) => runWorker(opts, `${callId}:${i}`, callId, t)));
    return reports.join("\n\n");
  };
  let error: string | null = null;
  let errorCode: string | null = null;
  try {
    await loop(opts, {
      model: settings.planner,
      system: plannerPrompt(),
      messages,
      tools: toolsFor(true, app),
      pictures: PLANNER_PICTURES,
      delegate,
    });
  } catch (err) {
    if (!opts.signal.aborted) {
      error = errorMessage(err);
      errorCode = err instanceof ModelError ? (err.code ?? null) : null;
    }
  }
  closeCalls(messages);
  return { added: messages.slice(start), stopped: opts.signal.aborted, error, errorCode };
}

async function runWorker(opts: RunOptions, sub: string, parent: string, task: SubTask): Promise<string> {
  const model = opts.settings.worker;
  opts.onEvent({ kind: "sub_start", sub, parent, title: task.title, model });
  const messages: ChatMessage[] = [{ role: "user", content: task.instructions }];
  try {
    const report = await loop(opts, {
      model,
      system: workerPrompt(),
      messages,
      tools: toolsFor(false, opts.app),
      maxSteps: WORKER_STEPS,
      pictures: WORKER_PICTURES,
      sub,
    });
    opts.onEvent({ kind: "sub_end", sub, ok: true, report });
    return `## ${task.title}\n${report || "(no report)"}`;
  } catch (err) {
    if (opts.signal.aborted) throw err;
    const report = `failed: ${errorMessage(err)}`;
    opts.onEvent({ kind: "sub_end", sub, ok: false, report });
    return `## ${task.title}\n${report}`;
  }
}

/** One model's run: requests and tool calls until it answers. Resolves with its last text. */
async function loop(opts: RunOptions, l: Loop): Promise<string> {
  const { signal, onEvent } = opts;
  const byName = new Map(l.tools.map((t) => [t.spec.function.name, t]));
  const specs = l.tools.map((t) => t.spec);
  const maxSteps = l.maxSteps ?? Infinity;
  for (let step = 0; step < maxSteps; step++) {
    onEvent({ kind: "turn", sub: l.sub });
    const handles = new Handles();
    const sent = handles.messages([{ role: "system", content: l.system }, ...prunePictures(l.messages, l.pictures)]);
    const answer = await complete(
      { model: l.model, messages: sent, tools: specs, maxTokens: MAX_TOKENS },
      {
        text: (delta) => onEvent({ kind: "text", sub: l.sub, delta }),
        reasoning: (delta) => onEvent({ kind: "reasoning", sub: l.sub, delta }),
        toolInput: (index, name, delta) => onEvent({ kind: "writing", sub: l.sub, index, name, delta }),
      },
      signal,
    );
    if (answer.usage) onEvent({ kind: "usage", sub: l.sub, model: l.model, usage: answer.usage });
    // the conversation keeps the real ids: the model's handles are put back
    const content = handles.long(answer.content);
    const calls = answer.toolCalls.map((c) => handles.longCall(c));
    l.messages.push({
      role: "assistant",
      content: content || null,
      ...(calls.length ? { tool_calls: calls } : {}),
      // sent back next step, so the model goes on from its thinking rather than redoing it
      ...(answer.reasoning.length ? { reasoning_details: answer.reasoning } : {}),
    });
    if (!calls.length) return content;
    const pictures: Picture[] = [];
    // in order: edits depend on the ones before them
    for (const call of calls) {
      if (signal.aborted) break;
      const out = await runTool(opts, l, byName, call);
      l.messages.push({ role: "tool", tool_call_id: call.id, content: out.images?.length ? `${out.text}\n(The picture follows.)` : out.text });
      pictures.push(...(out.images ?? []));
    }
    if (pictures.length) {
      const parts: ContentPart[] = [{ type: "text", text: "Pictures from the tools above:" }];
      for (const p of pictures) parts.push({ type: "text", text: p.caption }, { type: "image_url", image_url: { url: p.url } });
      l.messages.push({ role: "user", content: parts });
    }
    if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  }
  const note = `I stopped after ${maxSteps} steps, the limit for a subagent, before finishing the task.`;
  l.messages.push({ role: "assistant", content: note });
  onEvent({ kind: "text", sub: l.sub, delta: `\n\n${note}` });
  return note;
}

async function runTool(opts: RunOptions, l: Loop, byName: ReadonlyMap<string, Tool>, call: ToolCall): Promise<ToolOutput> {
  const { onEvent } = opts;
  const tool = byName.get(call.function.name);
  let args: Record<string, unknown> = {};
  let bad: string | null = null;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
    else bad = "the arguments must be a JSON object";
  } catch {
    bad = "the arguments weren't valid JSON";
  }
  const label = tool ? safeLabel(tool, args) : call.function.name;
  onEvent({ kind: "tool", sub: l.sub, id: call.id, name: call.function.name, label, args });
  let out: ToolOutput;
  if (!tool) out = { text: `There is no tool called ${call.function.name}.`, error: true };
  else if (bad) out = { text: `Error: ${bad}.`, error: true };
  else {
    const ctx: ToolContext = {
      app: opts.app,
      signal: opts.signal,
      attachments: opts.attachments,
      progress: (text) => onEvent({ kind: "progress", sub: l.sub, id: call.id, text }),
      delegate: l.delegate ? (tasks) => l.delegate!(call.id, tasks) : undefined,
    };
    try {
      out = await tool.run(args, ctx);
    } catch (err) {
      if (opts.signal.aborted) out = { text: "Stopped by the user.", error: true };
      else out = { text: `Error: ${errorMessage(err)}`, error: true };
    }
    // a tool Stop cuts short can still return (a killed script's worker answers), so it says it stopped
    if (opts.signal.aborted) out = { text: "Stopped by the user.", error: true };
  }
  onEvent({ kind: "result", sub: l.sub, id: call.id, ok: !out.error, text: out.text, images: out.images ?? [], files: out.files ?? [] });
  return out;
}

function safeLabel(tool: Tool, args: Record<string, unknown>): string {
  try {
    return tool.label(args);
  } catch {
    return tool.spec.function.name;
  }
}

/** A run stopped between a tool call and its result still leaves every call answered, so the conversation can go on. */
function closeCalls(messages: ChatMessage[]): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant" || !m.tool_calls?.length) continue;
    const answered = new Set(messages.slice(i + 1).flatMap((x) => (x.role === "tool" ? [x.tool_call_id] : [])));
    const missing = m.tool_calls.filter((c) => !answered.has(c.id));
    if (!missing.length) return;
    // the results go straight after the calls, before any pictures
    let at = i + 1;
    while (at < messages.length && messages[at].role === "tool") at++;
    messages.splice(at, 0, ...missing.map((c): ChatMessage => ({ role: "tool", tool_call_id: c.id, content: "Stopped by the user before this ran." })));
    return;
  }
}
