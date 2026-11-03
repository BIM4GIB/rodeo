// The Agents panel's model calls (POST /api/ai/chat): the editor sends an OpenAI-style chat
// request and the server passes it on to AI_BASE_URL (OpenRouter by default) with its own key,
// or puts it to Anthropic (anthropic.ts), streaming the answer back as it comes. Signed in only, to the models AI_MODELS allows, within
// a number of requests per user an hour and a day. The key never reaches the browser.
//
// With AI credit on (credit.ts), a request needs credit to start and is charged what OpenRouter
// says it cost: the stream's last usage report, or, for an answer stopped part way, OpenRouter's
// record of it looked up a moment later. Anthropic's answers are priced from their tokens. The charge and the balance left go to the editor as one
// more event, {"rodeo": {charged, balance, currency}}, just before the stream's [DONE].

import type { Hono } from "hono";
import { anthropicChat } from "./anthropic.ts";
import { allowed, isAdmin, planOf, requireUser } from "./auth.ts";
import { config, type AiConfig } from "./config.ts";
import { chargeUsage, holdCredit } from "./credit.ts";
import { readJson } from "./http.ts";
import { DAY, fail, HOUR, MB } from "./util.ts";

/** pictures of the drawing ride in the request, so it may be large */
const MAX_REQUEST = 24 * MB;
const MAX_TOKENS = 32_000;
/** waits before asking OpenRouter what a stopped answer cost: its record takes a moment to appear */
const LOOKUP_WAITS = [1000, 2000, 4000, 8000, 16000];

/** What a streamed answer says of itself: the provider's id for it, its cost (dollars) and tokens. */
interface Seen {
  id: string | null;
  usd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** of tokensIn, read from and written to the provider's cache */
  cached: number | null;
  written: number | null;
}

function isOpenRouter(ai: AiConfig): boolean {
  try {
    return new URL(ai.baseUrl).hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
}

export function registerAi(app: Hono): void {
  const ai = config.ai;
  if (ai?.credit && ai.provider === "openai" && !isOpenRouter(ai)) {
    console.warn("[ai] AI credit charges what OpenRouter reports each request cost; AI_BASE_URL isn't OpenRouter, so requests will go uncharged. Set AI_CREDIT=off to make that plain.");
  }

  app.post("/api/ai/chat", async (c) => {
    const ai = config.ai;
    if (!ai) fail(503, "The agents aren't set up on this server", "not_configured");
    const user = requireUser(c);
    if (ai.access === "admins" && !isAdmin(user)) fail(403, "The agents are open to admins only on this server", "forbidden");
    if (ai.access === "supporters" && !isAdmin(user) && planOf(user) !== "supporter") fail(403, "The agents come with Rodeo Plus", "plan");
    const body = await readJson(c, MAX_REQUEST);
    const model = typeof body.model === "string" ? body.model : "";
    if (!ai.models.includes(model)) fail(400, `This server doesn't offer the model ${model || "(none)"}: it offers ${ai.models.join(", ")}`);
    if (!Array.isArray(body.messages) || body.messages.length === 0) fail(400, "messages must be a non-empty list");
    if (body.tools !== undefined && !Array.isArray(body.tools)) fail(400, "tools must be a list");
    if (!allowed(`ai-hour:${user.id}`, ai.perHour, HOUR) || !allowed(`ai-day:${user.id}`, ai.perDay, DAY)) {
      fail(429, "That's as many agent steps as one account may take for now: try again later", "rate_limited");
    }
    const credit = ai.credit;
    const openRouter = isOpenRouter(ai);
    const maxTokens = typeof body.max_tokens === "number" && body.max_tokens > 0 ? Math.min(body.max_tokens, MAX_TOKENS) : 8192;
    // only the fields the panel sends go on, so a request can't reach the provider's other options
    const upstream = {
      model,
      // the thinking kept from Anthropic's answers goes back to Anthropic only (anthropic.ts)
      messages: Array.isArray(body.messages) ? (body.messages as Record<string, unknown>[]).map(({ reasoning_details: _, ...m }) => m) : body.messages,
      ...(body.tools ? { tools: body.tools } : {}),
      ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
      ...(typeof body.temperature === "number" ? { temperature: body.temperature } : {}),
      max_tokens: maxTokens,
      stream: true,
      // OpenRouter ends the stream with the request's cost
      ...(openRouter ? { usage: { include: true } } : {}),
    };
    const release = credit ? holdCredit(user, credit) : () => {};
    // an answer stopped part way: what it cost so far, for a provider with no record to look up
    let estimate: (() => number | null) | null = null;
    let answer: ReadableStream<Uint8Array>;
    if (ai.provider === "anthropic") {
      try {
        ({ stream: answer, estimate } = await anthropicChat(ai, model, body, c.req.raw.signal));
      } catch (e) {
        release();
        throw e;
      }
    } else {
      let res: Response;
      try {
        res = await fetch(`${ai.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ai.apiKey}`,
            "Content-Type": "application/json",
            // OpenRouter shows these on its dashboard
            "HTTP-Referer": config.publicUrl,
            "X-Title": "Rodeo",
          },
          body: JSON.stringify(upstream),
          signal: c.req.raw.signal,
        });
      } catch {
        release();
        console.error(`[ai] ${model}: the model provider could not be reached`);
        return fail(503, "The model provider could not be reached. Try again in a minute.", "provider_down");
      }
      if (!res.ok || !res.body) {
        release();
        const text = await res.text().catch(() => "");
        let reason = "";
        try {
          reason = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
        } catch {
          // not JSON: the status alone
        }
        console.error(`[ai] ${model}: the model provider answered ${res.status}${reason ? `: ${reason}` : ""}`);
        const said = `The model provider answered ${res.status}${reason ? `: ${reason}` : ""}`;
        // the server's own provider account out of credit: the user's Rodeo credit isn't the matter
        if (res.status === 402) return fail(503, "The agents' model provider has run out of credit, so no model can answer until Rodeo's owner tops it up.", "provider_credit");
        if (res.status === 429) return fail(429, `${said}. Try again in a minute.`, "provider_busy");
        if (res.status >= 500 || res.status === 408) return fail(503, `${said}. Try again in a minute.`, "provider_down");
        // turned down as it stands (too long, a picture it can't take): asking again won't help
        return fail(422, said, "provider_refused");
      }
      answer = res.body;
    }

    // the answer's cost off the balance, when the stream ends however it ends
    const settle = async (seen: Seen): Promise<string | null> => {
      if (!credit) {
        release();
        // no ledger to look in: what each request cost goes to the log instead
        console.log(`[ai] ${model}: ${seen.tokensIn ?? "?"} in (${seen.cached ?? 0} cached, ${seen.written ?? 0} written), ${seen.tokensOut ?? "?"} out, $${seen.usd?.toFixed(4) ?? "?"}`);
        return null;
      }
      const entry = { ref: seen.id, model, tokensIn: seen.tokensIn, tokensOut: seen.tokensOut };
      if (seen.usd !== null) {
        try {
          const r = chargeUsage(user, credit, seen.usd, entry);
          return `data: ${JSON.stringify({ rodeo: { charged: r.charged, balance: r.balance, currency: credit.currency } })}\n\n`;
        } catch (e) {
          console.error("[ai] could not charge a request", e instanceof Error ? e.message : e);
          return null;
        } finally {
          release();
        }
      }
      // stopped part way, or no usage at the end: charged what was answered (Anthropic), or once
      // OpenRouter has its record, still held till then
      void (async () => {
        try {
          const usd = estimate ? estimate() : seen.id && openRouter ? await lookupCost(ai, seen.id) : null;
          if (usd !== null) chargeUsage(user, credit, usd, entry);
          else console.warn(`[ai] no cost known for request ${seen.id ?? "(no id)"} on ${model}: not charged`);
        } catch (e) {
          console.error("[ai] could not charge a request", e instanceof Error ? e.message : e);
        } finally {
          release();
        }
      })();
      return null;
    };
    return new Response(metered(answer, settle), {
      status: 200,
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
    });
  });
}

/**
 * The answer's stream passed on line by line, read on the way for its id and usage. Its [DONE]
 * is held back until `end` has had the chance to add its line; `end` runs once, also when the
 * editor goes away or the provider's stream breaks.
 */
function metered(body: ReadableStream<Uint8Array>, end: (seen: Seen) => Promise<string | null>): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const seen: Seen = { id: null, usd: null, tokensIn: null, tokensOut: null, cached: null, written: null };
  let buf = "";
  let done = false;
  let ended = false;
  const finish = (): Promise<string | null> => {
    if (ended) return Promise.resolve(null);
    ended = true;
    return end(seen);
  };
  const read = (line: string): void => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!seen.id) seen.id = /"id"\s*:\s*"([^"]+)"/.exec(data)?.[1] ?? null;
    if (!data.includes('"usage"')) return;
    try {
      type Details = { cached_tokens?: unknown; cache_write_tokens?: unknown };
      const u = (JSON.parse(data) as { usage?: { cost?: unknown; prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: Details } }).usage;
      if (!u) return;
      if (typeof u.cost === "number") seen.usd = u.cost;
      if (typeof u.prompt_tokens === "number") seen.tokensIn = u.prompt_tokens;
      if (typeof u.completion_tokens === "number") seen.tokensOut = u.completion_tokens;
      const d = u.prompt_tokens_details;
      if (typeof d?.cached_tokens === "number") seen.cached = d.cached_tokens;
      if (typeof d?.cache_write_tokens === "number") seen.written = d.cache_write_tokens;
    } catch {
      // not JSON: passed on as it is
    }
  };
  /** the complete lines in `text`, read, with [DONE] taken out */
  const pass = (text: string): string => {
    const out: string[] = [];
    for (const raw of text.split("\n")) {
      const line = raw.replace(/\r$/, "");
      if (line.startsWith("data:") && line.slice(5).trim() === "[DONE]") {
        done = true;
        continue;
      }
      read(line);
      out.push(raw);
    }
    return out.join("\n");
  };
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      // reads until it has a whole line to pass on: a pull that returns having added nothing
      // isn't called again, and the stream would hang with the answer half sent and never charged
      for (;;) {
        let r: ReadableStreamReadResult<Uint8Array>;
        try {
          r = await reader.read();
        } catch (e) {
          void finish();
          ctrl.error(e);
          return;
        }
        if (r.done) {
          const rest = buf + decoder.decode();
          buf = "";
          const tail = rest ? pass(rest) : "";
          const extra = await finish();
          // a blank line first, so the charge is an event of its own
          const out = `${tail}${tail && !tail.endsWith("\n") ? "\n" : ""}${extra ? `\n${extra}` : ""}${done ? "data: [DONE]\n\n" : ""}`;
          if (out) ctrl.enqueue(encoder.encode(out));
          ctrl.close();
          return;
        }
        buf += decoder.decode(r.value, { stream: true });
        const cut = buf.lastIndexOf("\n");
        if (cut < 0) continue;
        const lines = buf.slice(0, cut);
        buf = buf.slice(cut + 1);
        ctrl.enqueue(encoder.encode(`${pass(lines)}\n`));
        return;
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {});
      void finish();
    },
  });
}

/** What OpenRouter charged for a generation, in dollars, once its record is there; null when it never is. */
async function lookupCost(ai: AiConfig, id: string): Promise<number | null> {
  for (const wait of LOOKUP_WAITS) {
    await new Promise((resolve) => setTimeout(resolve, wait));
    try {
      const res = await fetch(`${ai.baseUrl}/generation?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${ai.apiKey}` } });
      if (!res.ok) continue;
      const cost = ((await res.json()) as { data?: { total_cost?: unknown } }).data?.total_cost;
      if (typeof cost === "number") return cost;
    } catch {
      // try again after the next wait
    }
  }
  return null;
}
