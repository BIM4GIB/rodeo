// The Agents panel's model calls sent straight to Anthropic (AI_PROVIDER=anthropic, or an
// ANTHROPIC_API_KEY set): the editor speaks OpenAI's chat format, so its request is put into the
// Messages API's and the answer streamed back as OpenAI-style chunks, which the rest of ai.ts
// (metering, charging) and the editor read as they read OpenRouter's. The cost comes from the
// answer's token counts and Anthropic's prices, as OpenRouter's usage.cost would have said it.
//
// Thinking runs on every current model and is streamed as `reasoning`. Each finished block goes
// to the editor with its signature as `reasoning_details` (OpenRouter's form for it) and the
// editor keeps it on the answer. With AI_KEEP_THINKING on, it comes back as the block it was and
// the model goes on from its own reasoning. That is off by default: a kept block is read as input
// at its full length on every later step, and on a real run (a house made 3D) the steps wrote no
// less, so the run cost twice as much. A block is bound to the conversation before it; where the
// editor changed that (a batch of old pictures dropped), the request asks Anthropic to leave the
// block out rather than refuse, and the log says so.
//
// Tool calls are written into the answer as it streams and shown to the editor as `tool_input`
// while they are, so a long script shows as written rather than as a silence; the calls to run
// still come whole at the end.

import Anthropic from "@anthropic-ai/sdk";
import type { AiConfig } from "./config.ts";
import { env, envBool } from "./env.ts";
import { fail } from "./util.ts";

type Beta = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type MessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type Block = Anthropic.Beta.Messages.BetaContentBlockParam;
type Tool = Anthropic.Beta.Messages.BetaTool;

/** US dollars per million tokens: fresh input, output, and input read from the cache */
interface Price {
  in: number;
  out: number;
  read: number;
}
const PRICES: Readonly<Record<string, Price>> = {
  "claude-opus-5-5": { in: 4, out: 20, read: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.2 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, read: 0.01 },
};
/** Claude Haiku 5.5 costs five times as much for a prompt over this many tokens */
const HAIKU_LONG = 100_000;
/** writing the cache (five minutes) costs a quarter more than reading the input fresh */
const CACHE_WRITE = 1.25;
const MAX_TOKENS = 64_000;
/** a comment line sent when nothing else has gone for this long, so Cloudflare (which gives up on
 * a response silent for 100 seconds) waits while a long tool call is written */
const KEEPALIVE = 15_000;
/** models that can hand a refused request to another model of Anthropic's choosing */
const FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);
/** what an earlier answer's thinking is called in `reasoning_details` */
const FORMAT = "anthropic-claude-v1";

/** a thinking block as the editor keeps it, in OpenRouter's form */
interface Detail {
  type: "reasoning.text" | "reasoning.encrypted";
  text?: string;
  signature?: string;
  data?: string;
  format: string;
  index: number;
}

/** "anthropic/claude-opus-5.5", as OpenRouter names it, to "claude-opus-5-5" */
export function anthropicModel(model: string): string {
  return model.replace(/^anthropic\//, "").replace(/(\d)\.(\d)/g, "$1-$2");
}

function priceOf(model: string, prompt: number): Price | null {
  const p = PRICES[model];
  if (!p) return null;
  return model === "claude-haiku-5-5" && prompt > HAIKU_LONG ? { in: p.in * 5, out: p.out * 5, read: p.read * 5 } : p;
}

interface Tokens {
  fresh: number;
  written: number;
  read: number;
  out: number;
}

/** what an answer cost, US dollars, or null for a model whose price isn't known here */
function costOf(model: string, t: Tokens): number | null {
  const p = priceOf(model, t.fresh + t.written + t.read);
  if (!p) return null;
  return (t.fresh * p.in + t.written * p.in * CACHE_WRITE + t.read * p.read + t.out * p.out) / 1e6;
}

const toolId = (id: unknown): string => String(id ?? "").replace(/[^a-zA-Z0-9_-]/g, "_") || "call";

/** an OpenAI content part, or a plain string, as Messages API blocks */
function blocks(content: unknown): Block[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const out: Block[] = [];
  for (const p of content as Record<string, unknown>[]) {
    const cache = p.cache_control ? { cache_control: { type: "ephemeral" as const } } : {};
    if (p.type === "text" && typeof p.text === "string" && p.text) out.push({ type: "text", text: p.text, ...cache });
    else if (p.type === "image_url") {
      const url = String((p.image_url as { url?: unknown } | undefined)?.url ?? "");
      const data = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.*)$/s.exec(url);
      if (data) out.push({ type: "image", source: { type: "base64", media_type: data[1] as "image/jpeg", data: data[2] }, ...cache });
      else if (url) out.push({ type: "image", source: { type: "url", url }, ...cache });
    }
  }
  return out;
}

/** an answer's thinking blocks as it gave them, from what the editor kept of them */
function thinking(details: unknown): Block[] {
  if (!Array.isArray(details)) return [];
  return (details as Partial<Detail>[])
    .filter((d) => d && d.format === FORMAT)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((d): Block[] => {
      if (d.type === "reasoning.text" && typeof d.signature === "string" && d.signature) return [{ type: "thinking", thinking: d.text ?? "", signature: d.signature }];
      if (d.type === "reasoning.encrypted" && typeof d.data === "string" && d.data) return [{ type: "redacted_thinking", data: d.data }];
      return [];
    });
}

/**
 * The editor's OpenAI-style chat request as the Messages API's system, messages and tools, with
 * the answers' thinking put back when `keepThinking`.
 */
export function toMessages(body: Record<string, unknown>, keepThinking = false): Pick<Beta, "system" | "messages" | "tools"> {
  const system: Anthropic.Beta.Messages.BetaTextBlockParam[] = [];
  const messages: MessageParam[] = [];
  /** turns of one role in a row are one turn: tool results, then the pictures the tools took */
  const push = (role: "user" | "assistant", content: Block[]): void => {
    if (!content.length) return;
    const last = messages[messages.length - 1];
    if (last && last.role === role) (last.content as Block[]).push(...content);
    else messages.push({ role, content });
  };
  for (const m of (body.messages as Record<string, unknown>[]) ?? []) {
    if (m.role === "system") {
      const parts = blocks(m.content);
      // the first is the system prompt; any later one is read as the user's context
      if (!messages.length) system.push(...parts.filter((b) => b.type === "text"));
      else push("user", parts);
    } else if (m.role === "user") push("user", blocks(m.content));
    else if (m.role === "tool") {
      const content = typeof m.content === "string" ? m.content : blocks(m.content).filter((b) => b.type === "text" || b.type === "image");
      push("user", [{ type: "tool_result", tool_use_id: toolId(m.tool_call_id), content }]);
    } else if (m.role === "assistant") {
      // the thinking first, as it was given
      const content: Block[] = [...(keepThinking ? thinking(m.reasoning_details) : []), ...blocks(m.content).filter((b) => b.type === "text")];
      for (const call of (m.tool_calls as Record<string, unknown>[] | undefined) ?? []) {
        const fn = (call.function ?? {}) as { name?: unknown; arguments?: unknown };
        let input: unknown = {};
        try {
          input = JSON.parse(String(fn.arguments || "{}"));
        } catch {
          // a call cut off part way: sent as made of nothing, its result says what went wrong
        }
        content.push({ type: "tool_use", id: toolId(call.id), name: String(fn.name ?? ""), input: input && typeof input === "object" ? input : {} });
      }
      push("assistant", content.some((b) => b.type !== "thinking" && b.type !== "redacted_thinking") ? content : [...content, { type: "text", text: "(no answer)" }]);
    }
  }
  const tools = ((body.tools as Record<string, unknown>[] | undefined) ?? []).map((t): Tool => {
    const fn = (t.function ?? t) as { name?: unknown; description?: unknown; parameters?: unknown };
    return {
      name: String(fn.name ?? ""),
      description: typeof fn.description === "string" ? fn.description : undefined,
      input_schema: (fn.parameters ?? { type: "object", properties: {} }) as Tool["input_schema"],
      // streamed as written, not held until whole: the calls are checked once the answer ends
      eager_input_streaming: true,
    };
  });
  return { system, messages, ...(tools.length ? { tools } : {}) };
}

/** Logs the earlier thinking Anthropic left out of a request, and why. */
function dropped(model: string, transformations: unknown): void {
  if (!Array.isArray(transformations) || !transformations.length) return;
  const reasons = new Map<string, number>();
  for (const t of transformations as { type?: string; reason?: string }[]) {
    const key = `${t.type ?? "?"}: ${t.reason ?? "?"}`;
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }
  const first = (transformations as { path?: string }[])[0]?.path;
  console.log(`[ai] ${model}: earlier thinking left out, ${[...reasons].map(([k, n]) => `${n} × ${k}`).join(", ")}${first ? ` (from ${first})` : ""}`);
}

/** A failed request as the editor gets it (never 502/504, which Cloudflare swaps for a page of its own). */
function failure(model: string, err: unknown): never {
  if (!(err instanceof Anthropic.APIError)) {
    console.error(`[ai] ${model}: Anthropic could not be reached`, err instanceof Error ? err.message : err);
    return fail(503, "The model provider could not be reached. Try again in a minute.", "provider_down");
  }
  const status = err.status ?? 0;
  const reason = (err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message;
  console.error(`[ai] ${model}: Anthropic answered ${status}: ${reason}`);
  const said = `The model provider answered ${status}: ${reason}`;
  if (/credit balance/i.test(reason)) return fail(503, "The agents' model provider has run out of credit, so no model can answer until Rodeo's owner tops it up.", "provider_credit");
  if (status === 429) return fail(429, `${said}. Try again in a minute.`, "provider_busy");
  if (status >= 500 || status === 408 || status === 0) return fail(503, `${said}. Try again in a minute.`, "provider_down");
  if (status === 401 || status === 403) return fail(503, "The agents' model provider turned down this server's key. Rodeo's owner needs to check it.", "provider_key");
  return fail(422, said, "provider_refused");
}

/**
 * Asks Anthropic for the answer and returns it as the OpenAI-style event stream the editor reads,
 * ending in a usage chunk that carries its cost. Fails (an HttpError) when Anthropic turns the
 * request down; `estimate` is the cost of what was answered, for a stream stopped part way.
 */
export async function anthropicChat(
  ai: AiConfig,
  model: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ stream: ReadableStream<Uint8Array>; estimate: () => number | null }> {
  const name = anthropicModel(model);
  const client = new Anthropic({ apiKey: ai.apiKey, maxRetries: 1 });
  // medium is the models' own default; high thinks longer on every step, and thinking is most of
  // what a run costs
  const effort = env("AI_EFFORT");
  const params: Beta = {
    model: name,
    max_tokens: MAX_TOKENS,
    ...toMessages(body, envBool("AI_KEEP_THINKING", false)),
    // an earlier block whose conversation has changed since is left out, not refused
    thinking: { type: "adaptive", display: "summarized", block_binding: { prefix_mismatch_behavior: "drop_block" } },
    output_config: { effort: effort === "low" || effort === "high" || effort === "xhigh" || effort === "max" ? effort : "medium" },
    // the conversation so far read from the cache on the next step
    cache_control: { type: "ephemeral" },
    stream: true,
    betas: ["thinking-binding-controls-2026-08-01", ...(FALLBACK.has(name) ? ["server-side-fallback-2026-07-01"] : [])],
    ...(FALLBACK.has(name) ? { fallbacks: "default" as const } : {}),
  };
  let events: AsyncIterable<Anthropic.Beta.Messages.BetaRawMessageStreamEvent> & { controller: AbortController };
  try {
    events = await client.beta.messages.create(params, { signal });
  } catch (err) {
    return failure(model, err);
  }

  const encoder = new TextEncoder();
  const tokens: Tokens = { fresh: 0, written: 0, read: 0, out: 0 };
  let id = "";
  let outChars = 0;
  let stop: string | null = null;
  /** blocks by index: tool calls are held until the answer ends (a refusal part way can hand
   * the answer to another model, and the calls before that hand-over must not run) */
  const calls = new Map<number, { id: string; name: string; json: string }>();
  /** thinking blocks by index, kept with their signatures for the editor to send back */
  const thoughts = new Map<number, Detail>();
  let handedOver = -1;
  const chunk = (delta: Record<string, unknown>, extra: Record<string, unknown> = {}): Uint8Array =>
    encoder.encode(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`);
  const iterator = events[Symbol.asyncIterator]();
  let sent = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const send = (ctrl: ReadableStreamDefaultController<Uint8Array>, bytes: Uint8Array): void => {
    sent = Date.now();
    ctrl.enqueue(bytes);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      timer = setInterval(() => {
        if (Date.now() - sent < KEEPALIVE) return;
        sent = Date.now();
        try {
          ctrl.enqueue(encoder.encode(": still answering\n\n"));
        } catch {
          clearInterval(timer);
        }
      }, KEEPALIVE / 3);
    },
    async pull(ctrl) {
      const close = (): void => {
        clearInterval(timer);
        ctrl.close();
      };
      for (;;) {
        let r: IteratorResult<Anthropic.Beta.Messages.BetaRawMessageStreamEvent>;
        try {
          r = await iterator.next();
        } catch (err) {
          const message = err instanceof Anthropic.APIError ? ((err.error as { error?: { message?: string } } | undefined)?.error?.message ?? err.message) : err instanceof Error ? err.message : String(err);
          console.error(`[ai] ${model}: Anthropic's answer broke off: ${message}`);
          send(ctrl, encoder.encode(`data: ${JSON.stringify({ error: { message: `The model's answer broke off: ${message}` } })}\n\n`));
          close();
          return;
        }
        if (r.done) {
          close();
          return;
        }
        const ev = r.value;
        if (ev.type === "message_start") {
          id = ev.message.id;
          dropped(model, ev.message.input_transformations);
          const u = ev.message.usage;
          tokens.fresh = u.input_tokens ?? 0;
          tokens.written = u.cache_creation_input_tokens ?? 0;
          tokens.read = u.cache_read_input_tokens ?? 0;
          tokens.out = u.output_tokens ?? 0;
          continue;
        }
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          if (b.type === "tool_use") {
            calls.set(ev.index, { id: b.id, name: b.name, json: "" });
            send(ctrl, chunk({ tool_input: { index: ev.index, name: b.name } }));
            return;
          }
          if (b.type === "thinking") thoughts.set(ev.index, { type: "reasoning.text", text: "", signature: b.signature || undefined, format: FORMAT, index: ev.index });
          else if (b.type === "redacted_thinking") thoughts.set(ev.index, { type: "reasoning.encrypted", data: b.data, format: FORMAT, index: ev.index });
          else if ((b.type as string) === "fallback") handedOver = ev.index;
          continue;
        }
        if (ev.type === "content_block_delta") {
          const d = ev.delta;
          if (d.type === "text_delta" && d.text) {
            outChars += d.text.length;
            send(ctrl, chunk({ content: d.text }));
            return;
          }
          if (d.type === "thinking_delta" && d.thinking) {
            outChars += d.thinking.length;
            const t = thoughts.get(ev.index);
            if (t) t.text += d.thinking;
            send(ctrl, chunk({ reasoning: d.thinking }));
            return;
          }
          if (d.type === "signature_delta") {
            const t = thoughts.get(ev.index);
            if (t) t.signature = d.signature;
            continue;
          }
          if (d.type === "input_json_delta" && d.partial_json) {
            const call = calls.get(ev.index);
            if (call) call.json += d.partial_json;
            outChars += d.partial_json.length;
            send(ctrl, chunk({ tool_input: { index: ev.index, json: d.partial_json } }));
            return;
          }
          continue;
        }
        if (ev.type === "message_delta") {
          stop = ev.delta.stop_reason ?? stop;
          // after a hand-over to another model, what it couldn't read of the earlier thinking
          dropped(model, (ev as { input_transformations?: unknown }).input_transformations);
          const u = ev.usage;
          if (u.output_tokens != null) tokens.out = u.output_tokens;
          if (u.input_tokens != null) tokens.fresh = u.input_tokens;
          if (u.cache_creation_input_tokens != null) tokens.written = u.cache_creation_input_tokens;
          if (u.cache_read_input_tokens != null) tokens.read = u.cache_read_input_tokens;
          continue;
        }
        if (ev.type === "message_stop") {
          // a refusal or the token limit can cut a call off part way: none of that turn's run
          const cut = stop === "refusal" || stop === "max_tokens";
          const ready = cut ? [] : [...calls].filter(([i]) => i > handedOver).sort(([a], [b]) => a - b);
          // the answer's own thinking, whole and signed, for the editor to send back next time
          const details = [...thoughts.values()].filter((t) => t.index > handedOver && (t.signature || t.data)).sort((a, b) => a.index - b.index);
          if (details.length) send(ctrl, chunk({ reasoning_details: details }));
          if (ready.length) {
            send(ctrl, chunk({ tool_calls: ready.map(([, c], k) => ({ index: k, id: c.id, type: "function", function: { name: c.name, arguments: c.json || "{}" } })) }));
          }
          if (stop === "refusal") send(ctrl, chunk({ content: "\n\n(The model declined to go on with this request.)" }));
          const finish = stop === "tool_use" ? "tool_calls" : stop === "max_tokens" ? "length" : stop === "refusal" ? "content_filter" : "stop";
          const cost = costOf(name, tokens);
          if (cost === null) console.warn(`[ai] no price known for ${name}: the request isn't charged`);
          send(
            ctrl,
            encoder.encode(
              `data: ${JSON.stringify({ id, object: "chat.completion.chunk", model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage: { prompt_tokens: tokens.fresh + tokens.written + tokens.read, completion_tokens: tokens.out, prompt_tokens_details: { cached_tokens: tokens.read, cache_write_tokens: tokens.written }, ...(cost !== null ? { cost } : {}) } })}\n\ndata: [DONE]\n\n`,
            ),
          );
          continue;
        }
      }
    },
    cancel() {
      clearInterval(timer);
      events.controller.abort();
    },
  });

  // stopped part way: the prompt as counted, and the answer so far at about four characters a token
  const estimate = (): number | null => costOf(name, { ...tokens, out: Math.max(tokens.out, Math.ceil(outChars / 4)) });
  return { stream, estimate };
}
