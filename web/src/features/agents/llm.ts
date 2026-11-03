// Chat completions, streamed: OpenAI's chat format with tools, which OpenRouter and most
// providers speak. Every request goes to the Rodeo server (POST /api/ai/chat), which holds the
// key, needs the user signed in and, where the agents are sold by credit, charges for it. The
// answer streams in as server-sent events: text and tool calls arrive in pieces, handed to the
// caller as they come, and are put together for it; the server's last event says what it charged.
// The model's thinking comes back whole and signed (`reasoning_details`) and is kept on its answer,
// so the next request sends it back and the model goes on from it.

export type ContentPart = { readonly type: "text"; readonly text: string } | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

export interface ToolCall {
  readonly id: string;
  readonly type: "function";
  readonly function: { readonly name: string; readonly arguments: string };
}

/** a block of the model's thinking, as the provider gave it: sent back as it came, never changed */
export interface ReasoningDetail {
  readonly type: string;
  readonly text?: string;
  readonly signature?: string;
  readonly data?: string;
  readonly format?: string;
  readonly index?: number;
}

export type ChatMessage =
  | { readonly role: "system"; readonly content: string }
  | { readonly role: "user"; readonly content: string | readonly ContentPart[] }
  | { readonly role: "assistant"; readonly content: string | null; readonly tool_calls?: readonly ToolCall[]; readonly reasoning_details?: readonly ReasoningDetail[] }
  | { readonly role: "tool"; readonly tool_call_id: string; readonly content: string };

export interface ToolSpec {
  readonly type: "function";
  readonly function: { readonly name: string; readonly description: string; readonly parameters: Record<string, unknown> };
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly tools?: readonly ToolSpec[];
  readonly maxTokens?: number;
}

export interface StreamHandlers {
  text?(delta: string): void;
  reasoning?(delta: string): void;
  /** a tool call as it is written: its name, and each piece of its arguments as it comes */
  toolInput?(index: number, name: string, delta: string): void;
}

export interface Usage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  /** what the provider charged, in dollars, when it says (OpenRouter does) */
  readonly cost: number | null;
  /** what the Rodeo server took from the user's AI credit for it, and the credit left (null: free) */
  readonly charged: number | null;
  readonly balance: number | null;
}

export interface Completion {
  readonly content: string;
  readonly toolCalls: readonly ToolCall[];
  /** the model's thinking, to keep on the answer */
  readonly reasoning: readonly ReasoningDetail[];
  readonly finish: string | null;
  readonly usage: Usage | null;
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** the server's reason, such as "credit" (out of AI credit) */
    readonly code?: string,
  ) {
    super(message);
  }
}

/**
 * tries for a request that fails before any of its answer streamed (a busy or briefly unreachable
 * provider, or a stream that broke off while the model was still thinking: its reasoning shows
 * again, the answer only once)
 */
const TRIES = 3;
const RETRY_STATUS = new Set([0, 408, 429, 500, 502, 503, 504, 520, 521, 522, 523, 529]);
/** the server's reasons that asking again won't change */
const FINAL_CODES = new Set(["provider_credit", "provider_key", "provider_refused", "credit", "rate_limited"]);

/** Sends one request and streams the answer through `on`; resolves with the whole of it. */
export async function complete(req: ChatRequest, on: StreamHandlers, signal: AbortSignal): Promise<Completion> {
  for (let attempt = 1; ; attempt++) {
    let streamed = false;
    try {
      const res = await send(req, signal);
      return await read(res, on, signal, () => (streamed = true));
    } catch (err) {
      if (signal.aborted) throw err;
      const status = err instanceof ModelError ? err.status : 0;
      const final = err instanceof ModelError && !!err.code && FINAL_CODES.has(err.code);
      if (streamed || attempt >= TRIES || final || !RETRY_STATUS.has(status)) throw err;
      await pause(attempt * 1500, signal);
    }
  }
}

async function send(req: ChatRequest, signal: AbortSignal): Promise<Response> {
  const body = {
    model: req.model,
    messages: cached(req.model, req.messages),
    ...(req.tools?.length ? { tools: req.tools } : {}),
    max_tokens: req.maxTokens ?? 8192,
    stream: true,
  };
  let res: Response;
  try {
    res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Requested-With": "openvwx" },
      body: JSON.stringify(body),
      signal,
      credentials: "include",
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ModelError("The Rodeo server could not be reached", 0);
  }
  if (!res.ok) {
    const { message, code } = await errorOf(res);
    throw new ModelError(message, res.status, code);
  }
  if (!res.body) throw new ModelError("The answer had no body", 502);
  return res;
}

const EPHEMERAL = { type: "ephemeral" } as const;

/**
 * The messages as sent: for Anthropic's models, marked so the provider caches what it has read
 * (the tools and system prompt, and the conversation up to the latest user message). Each step
 * of a run sends the whole conversation again, and a cached read costs a tenth of a fresh one.
 */
function cached(model: string, messages: readonly ChatMessage[]): readonly unknown[] {
  if (!model.startsWith("anthropic/")) return messages;
  let last = -1;
  for (let i = messages.length - 1; i >= 0 && last < 0; i--) if (messages[i].role === "user") last = i;
  return messages.map((m, i) => {
    if (m.role === "system") return { role: "system", content: [{ type: "text", text: m.content, cache_control: EPHEMERAL }] };
    if (i !== last || m.role !== "user") return m;
    const parts: Record<string, unknown>[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content.map((p) => ({ ...p }));
    for (let k = parts.length - 1; k >= 0; k--) {
      if (parts[k].type === "text") {
        parts[k] = { ...parts[k], cache_control: EPHEMERAL };
        break;
      }
    }
    return { role: "user", content: parts };
  });
}

async function errorOf(res: Response): Promise<{ message: string; code?: string }> {
  const text = await res.text().catch(() => "");
  let message = "";
  let code: string | undefined;
  try {
    const j = JSON.parse(text) as { error?: string | { message?: string }; code?: string };
    message = typeof j.error === "string" ? j.error : (j.error?.message ?? "");
    code = typeof j.code === "string" ? j.code : undefined;
  } catch {
    // an error page from something in front of the server (Cloudflare's, in production): its
    // title says what happened, and its markup means nothing to the user
    const title = /<title[^>]*>([^<]*)<\/title>/i.exec(text)?.[1]?.replace(/\s+/g, " ").trim();
    message = /^\s*</.test(text) ? `The Rodeo server's gateway answered ${res.status}${title ? ` (${title})` : ""}` : text.slice(0, 300);
  }
  if (res.status === 401) return { message: "Sign in to use the agents.", code: "unauthorized" };
  return { message: message || `The model request failed (${res.status} ${res.statusText})`, code };
}

interface Delta {
  content?: string | null;
  reasoning?: string | null;
  reasoning_details?: ReasoningDetail[];
  tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
  /** the Rodeo server's view of a tool call being written (the calls themselves come at the end) */
  tool_input?: { index: number; name?: string; json?: string };
}

interface Chunk {
  choices?: { delta?: Delta; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: number };
  /** the Rodeo server's charge for the request, after the provider's last event */
  rodeo?: { charged?: number; balance?: number };
}

async function read(res: Response, on: StreamHandlers, signal: AbortSignal, started: () => void): Promise<Completion> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let finish: string | null = null;
  let usage: { promptTokens: number; completionTokens: number; cost: number | null } | null = null;
  let charge: { charged: number; balance: number } | null = null;
  const calls: { id: string; name: string; args: string }[] = [];
  const details: { -readonly [K in keyof ReasoningDetail]: ReasoningDetail[K] }[] = [];
  /** calls being written, by the server's index for them */
  const writing = new Map<number, string>();
  const abort = (): void => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
        // blank lines end events; ": ..." lines are keep-alive comments (OpenRouter's "PROCESSING")
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: Chunk;
        try {
          chunk = JSON.parse(data) as Chunk;
        } catch {
          continue;
        }
        if (chunk.error) throw new ModelError(chunk.error.message ?? "The model failed", chunk.error.code ?? 502);
        if (chunk.rodeo && typeof chunk.rodeo.charged === "number" && typeof chunk.rodeo.balance === "number") {
          charge = { charged: chunk.rodeo.charged, balance: chunk.rodeo.balance };
        }
        if (chunk.usage) {
          usage = {
            promptTokens: chunk.usage.prompt_tokens ?? 0,
            completionTokens: chunk.usage.completion_tokens ?? 0,
            cost: typeof chunk.usage.cost === "number" ? chunk.usage.cost : null,
          };
        }
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const d = choice.delta;
        if (!d) continue;
        if (d.content) {
          started();
          content += d.content;
          on.text?.(d.content);
        }
        if (d.reasoning) on.reasoning?.(d.reasoning);
        // in pieces from OpenRouter, a piece per block; whole from the Rodeo server
        for (const r of d.reasoning_details ?? []) {
          const at = details.find((x) => x.index === r.index && x.type === r.type);
          if (!at) details.push({ ...r });
          else {
            if (r.text) at.text = (at.text ?? "") + r.text;
            if (r.data) at.data = (at.data ?? "") + r.data;
            if (r.signature) at.signature = r.signature;
          }
        }
        if (d.tool_input) {
          started();
          const { index, name, json } = d.tool_input;
          if (name) writing.set(index, name);
          on.toolInput?.(index, writing.get(index) ?? "", json ?? "");
        }
        for (const t of d.tool_calls ?? []) {
          started();
          const i = t.index ?? calls.length;
          const call = (calls[i] ??= { id: "", name: "", args: "" });
          if (t.id) call.id = t.id;
          if (t.function?.name) call.name += t.function.name;
          if (t.function?.arguments) call.args += t.function.arguments;
          // a provider that streams its calls as written (the Rodeo server's come whole at the end)
          if (!writing.size && call.name && (t.function?.name || t.function?.arguments)) on.toolInput?.(i, call.name, t.function?.arguments ?? "");
        }
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  const toolCalls: ToolCall[] = calls
    .filter((c) => c && c.name)
    .map((c, i) => ({ id: c.id || `call_${Date.now().toString(36)}_${i}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
  const all: Usage | null =
    usage || charge ? { ...(usage ?? { promptTokens: 0, completionTokens: 0, cost: null }), charged: charge?.charged ?? null, balance: charge?.balance ?? null } : null;
  return { content, toolCalls, reasoning: details, finish, usage: all };
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(t);
        reject(new DOMException("Stopped", "AbortError"));
      },
      { once: true },
    );
  });
}
