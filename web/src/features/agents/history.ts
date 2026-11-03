// What a model is sent of a conversation, and how its answer is read back. Two things keep each
// request the one before it plus what's new, so the provider's cache and the model's earlier
// thinking (which is bound to everything before it) hold: old pictures are dropped in batches, not
// one a step, and object ids are sent as short handles numbered in the order they first appear.
//
// A UUID is about 24 tokens and a handle like @12 is two; a plan of a few hundred walls is mostly
// ids. The conversation keeps the real ids: they are shortened on the way out and the model's
// handles put back on the way in, so a handle means the same object for the whole conversation.

import type { ChatMessage, ContentPart, ToolCall } from "./llm.ts";

/** pictures shown after a drop, and how many more may come before the oldest of them go together */
export interface PictureRule {
  readonly keep: number;
  readonly batch: number;
}

export const PLANNER_PICTURES: PictureRule = { keep: 6, batch: 12 };
export const WORKER_PICTURES: PictureRule = { keep: 4, batch: 8 };

const DROPPED = "(an earlier picture, no longer shown)";

/**
 * The messages with the oldest pictures replaced by a note, a whole batch at a time: from
 * keep + batch pictures on, the oldest batch (or batches) go, leaving keep to keep + batch − 1.
 * Running it again on its own result changes nothing, so a saved conversation is what was sent.
 */
export function prunePictures(messages: readonly ChatMessage[], rule: PictureRule): ChatMessage[] {
  let total = 0;
  for (const m of messages) if (m.role === "user" && Array.isArray(m.content)) for (const p of m.content as readonly ContentPart[]) if (p.type === "image_url") total++;
  let drop = total >= rule.keep + rule.batch ? Math.floor((total - rule.keep) / rule.batch) * rule.batch : 0;
  if (!drop) return [...messages];
  return messages.map((m): ChatMessage => {
    if (drop <= 0 || m.role !== "user" || !Array.isArray(m.content)) return m;
    const parts = (m.content as readonly ContentPart[]).map((p): ContentPart => {
      if (p.type !== "image_url" || drop <= 0) return p;
      drop--;
      return { type: "text", text: DROPPED };
    });
    return { role: "user", content: parts };
  });
}

export const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
/** about how long a handle is, for sizing text by what the model is sent */
export const HANDLE_LENGTH = 4;
/** a handle as written: no leading zero, so putting it back and shortening again gives the same text */
const HANDLE = /(?<![\w@])@([1-9]\d*)(?!\d)/g;

/** Short handles for the ids in one request, numbered in the order they first appear. */
export class Handles {
  private readonly numbers = new Map<string, number>();
  private readonly ids: string[] = [];

  /** the text with every id as its handle */
  short(text: string): string {
    return text.replace(UUID, (id) => {
      const key = id.toLowerCase();
      let n = this.numbers.get(key);
      if (n === undefined) {
        this.ids.push(id);
        n = this.ids.length;
        this.numbers.set(key, n);
      }
      return `@${n}`;
    });
  }

  /** the text with every known handle as its id; unknown ones are left as written */
  long(text: string): string {
    return text.replace(HANDLE, (h, n: string) => this.ids[Number(n) - 1] ?? h);
  }

  /** the messages as the model is sent them */
  messages(messages: readonly ChatMessage[]): ChatMessage[] {
    return messages.map((m): ChatMessage => {
      switch (m.role) {
        case "system":
          return { role: "system", content: this.short(m.content) };
        case "user":
          return typeof m.content === "string"
            ? { role: "user", content: this.short(m.content) }
            : { role: "user", content: m.content.map((p): ContentPart => (p.type === "text" ? { type: "text", text: this.short(p.text) } : p)) };
        case "assistant":
          return {
            role: "assistant",
            content: m.content === null ? null : this.short(m.content),
            ...(m.tool_calls ? { tool_calls: m.tool_calls.map((c) => this.call(c, (s) => this.short(s))) } : {}),
            // signed as the model wrote it, handles and all
            ...(m.reasoning_details ? { reasoning_details: m.reasoning_details } : {}),
          };
        case "tool":
          return { role: "tool", tool_call_id: m.tool_call_id, content: this.short(m.content) };
      }
    });
  }

  /** a tool call the model made, with its handles as ids */
  longCall(c: ToolCall): ToolCall {
    return this.call(c, (s) => this.long(s));
  }

  private call(c: ToolCall, f: (s: string) => string): ToolCall {
    return { ...c, function: { ...c.function, arguments: f(c.function.arguments) } };
  }
}
