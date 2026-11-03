// Checks what a model is sent of a conversation. Run from web/:
//   npx tsx src/features/agents/history.check.ts
// Pictures go a batch at a time, so each request is the one before it plus what's new except at a
// batch's edge, and pruning what was already pruned changes nothing (a saved conversation is what
// was sent). Ids go out as handles numbered by first appearance, the same handle for the same id
// on every request, and the model's handles come back as the ids. The model's thinking goes back
// as it came.

import { Handles, PLANNER_PICTURES, prunePictures } from "./history.ts";
import type { ChatMessage, ContentPart } from "./llm.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const picture = (n: number): ChatMessage => ({ role: "user", content: [{ type: "text", text: `picture ${n}` }, { type: "image_url", image_url: { url: `data:image/jpeg;base64,${n}` } }] });
const shown = (ms: readonly ChatMessage[]): number =>
  ms.reduce((n, m) => n + (m.role === "user" && Array.isArray(m.content) ? (m.content as readonly ContentPart[]).filter((p) => p.type === "image_url").length : 0), 0);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

{
  const { keep, batch } = PLANNER_PICTURES;
  const conv: ChatMessage[] = [{ role: "user", content: "make this house 3d" }];
  let changes = 0;
  let most = 0;
  let before: ChatMessage[] = [];
  for (let n = 1; n <= 40; n++) {
    conv.push({ role: "assistant", content: null }, picture(n));
    const sent = prunePictures(conv, PLANNER_PICTURES);
    most = Math.max(most, shown(sent));
    if (!same(sent.slice(0, before.length), before)) changes++;
    before = sent;
    if (n === keep + batch - 1) check(shown(sent) === n, `${n} pictures are all shown`);
    if (n === keep + batch) check(shown(sent) === keep, `at ${n} the oldest ${batch} go together, leaving ${keep}`);
  }
  check(most === keep + batch - 1, `never more than ${keep + batch - 1} shown (${most})`);
  check(changes === 2, `over 40 pictures the earlier requests change only at the batch edges, 18 and 30 (${changes})`);
  check(same(prunePictures(before, PLANNER_PICTURES), before), "pruning what was pruned changes nothing");
}

{
  const a = "61fc6cce-f4e4-e24d-9636-5ff5dc1e7f88";
  const b = "976a7f42-841e-8d4a-a5c4-068af1332944";
  const conv: ChatMessage[] = [
    { role: "user", content: "make this house 3d" },
    { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "overview", arguments: "{}" } }] },
    { role: "tool", tool_call_id: "t1", content: JSON.stringify({ layers: [{ id: a, name: "Plan 03" }, { id: b, name: "Existing" }] }) },
  ];
  const h1 = new Handles();
  const sent1 = h1.messages(conv);
  check((sent1[2] as { content: string }).content === '{"layers":[{"id":"@1","name":"Plan 03"},{"id":"@2","name":"Existing"}]}', "ids go out as @1, @2 in the order they appear");
  // the model answers with handles; the conversation keeps the ids
  const call = h1.longCall({ id: "t2", type: "function", function: { name: "look_plan", arguments: '{"layerId":"@1"}' } });
  check(call.function.arguments === `{"layerId":"${a}"}`, "a handle in a tool call comes back as the id");
  check(h1.long("@01 @9 me@1 @12x @2.") === `@01 @9 me@1 @12x ${b}.`, "leading zeros, unknown handles and handles inside words are left as written");
  conv.push({ role: "assistant", content: h1.long("Looking at @1."), tool_calls: [call] });
  conv.push({ role: "tool", tool_call_id: "t2", content: `the plan of ${a} and ${"0d5b5e3a-8f6c-4f0e-9a11-2b7a7c1d9e00"}` });
  const h2 = new Handles();
  const sent2 = h2.messages(conv);
  check(same(sent2.slice(0, sent1.length), sent1), "the next request starts with the last one, unchanged");
  check((sent2[3] as { content: string }).content === "Looking at @1." && (sent2[4] as { content: string }).content === "the plan of @1 and @3", "the same id keeps its handle; a new one gets the next");
}

{
  // the model's thinking is signed as it wrote it: it goes back untouched, handles and all
  const a = "61fc6cce-f4e4-e24d-9636-5ff5dc1e7f88";
  const details = [{ type: "reasoning.text", text: `Measure @1 first (${a} is not mine to shorten).`, signature: "c2lnbmVk", format: "anthropic-claude-v1", index: 0 }];
  const conv: ChatMessage[] = [
    { role: "user", content: `make ${a} 3d` },
    { role: "assistant", content: "Measuring.", tool_calls: [{ id: "t1", type: "function", function: { name: "overview", arguments: "{}" } }], reasoning_details: details },
    { role: "tool", tool_call_id: "t1", content: "ok" },
    picture(1),
  ];
  const sent = new Handles().messages(prunePictures(conv, PLANNER_PICTURES));
  const answer = sent[1] as Extract<ChatMessage, { role: "assistant" }>;
  check(same(answer.reasoning_details, details), "an answer's thinking is sent back as it came");
}

if (failures) {
  console.log(`${failures} failed`);
  process.exit(1);
}
