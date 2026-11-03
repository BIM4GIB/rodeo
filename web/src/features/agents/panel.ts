// The Agents panel: a chat with the agent that works in the open drawing. The user's messages
// (with pictures and files attached) go to the planner; its reply streams in as it is written,
// each tool it calls shows as a card that fills in as it runs (pictures and files on it), and
// subagents show as cards of their own inside the delegate card that started them. Conversations
// are kept (threads.ts) and can be picked up again. The agents run through the Rodeo server
// only, on the models it picks: the user signs in, and where the server sells them by AI credit
// the panel shows the balance, what each message cost, and the top-ups when it runs low.
// The engine (agent.ts, the tools, the API's docs) loads with the first message.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { openContextMenu, type Row } from "../../app/menu.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { currentUser, onUser, refreshUser, serverConfig } from "../../platform/api.ts";
import type { ServerConfig } from "../../platform/protocol.ts";
import { formatCredit, openCreditDialog, pricing, topUpButtons } from "../account/credit.ts";
import { requireSignIn } from "../account/signin.ts";
import type { AgentEvent } from "./agent.ts";
import type { ContentPart, Usage } from "./llm.ts";
import type { Picture } from "./look.ts";
import { renderMarkdown } from "./markdown.ts";
import { agentSettings, shortModel } from "./settings.ts";
import { deleteThread, listThreads, newThread, saveThread, titleFrom, type Thread } from "./threads.ts";
import type { OutFile } from "./tools.ts";

const ICONS = {
  send: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3.5M3.5 8 8 3.5 12.5 8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  stop: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4.5" y="4.5" width="7" height="7" rx="1.2" fill="currentColor"/></svg>',
  attach: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 5.5 6 10a1.4 1.4 0 0 0 2 2l4.6-4.6a2.8 2.8 0 0 0-4-4L4 8a4.2 4.2 0 0 0 6 6l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  chevron: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.8 6.3 5 8.4l4.2-4.8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.8 3.8 8.2 8.2M8.2 3.8 3.8 8.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  file: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5h4l2.5 2.5v6.5H3z M7 1.5V4h2.5" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>',
};

const SUGGESTIONS = [
  "What's in this drawing?",
  "Render the model from the south-east, then tell me what you see",
  "Check the class names for typos and inconsistencies",
  "Export the sheet layers as a PDF",
  "Write a plug-in that numbers the selected objects",
];

/** characters of a tool's input and result shown on its card */
const DETAIL_CHARS = 6000;
/** how the editor's state at the end of each message the user sent begins (prompt.ts stateNote) */
const NOW = "## Now\n";
/** how often streamed text is re-laid out */
const TEXT_MS = 60;
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif)$/;

interface Card {
  readonly el: HTMLElement;
  readonly status: HTMLElement;
  readonly progress: HTMLElement;
  readonly pics: HTMLElement;
  readonly files: HTMLElement;
  readonly detail: HTMLElement;
  readonly subs: HTMLElement;
  readonly args: Record<string, unknown>;
}

/** Where one model's output goes: the reply's body, or a subagent's log. */
interface Sink {
  readonly el: HTMLElement;
  text: { el: HTMLElement; src: string; timer: number } | null;
  reasoning: { el: HTMLElement; body: HTMLElement; src: string } | null;
  waiting: HTMLElement | null;
  /** a tool call being written: its size so far and the line it is on */
  writing: { el: HTMLElement; label: HTMLElement; tail: HTMLElement; index: number; name: string; chars: number; lines: number; line: string } | null;
  /** a subagent's card, its status mark, and the line showing what it is doing */
  readonly card?: HTMLElement;
  readonly status?: HTMLElement;
  readonly now?: HTMLElement;
}

export function agentsPanel(): HTMLElement {
  let thread: Thread = newThread();
  let running: AbortController | null = null;
  /** files attached in this conversation, by name, for import_file */
  const files = new Map<string, File>();
  let pending: File[] = [];
  /** whether the server's config is in, whether there is a server, and its models and credit terms */
  let loaded = false;
  let hasServer = false;
  let serverAi: ServerConfig["ai"] = null;
  /** the user's AI credit, kept up to date by each request's charge */
  let balance: number | null = null;
  void serverConfig().then((cfg) => {
    loaded = true;
    hasServer = cfg !== null;
    serverAi = cfg?.ai ?? null;
    refreshModel();
    refreshCredit();
    if (!thread.messages.length) showEmpty();
  });

  // ---- chrome ----------------------------------------------------------------------

  const title = h("button", { cls: "ag-title", attrs: { type: "button", title: "Conversations" } }, h("span", { cls: "ag-title-text", text: thread.title }), h("span", { cls: "ag-chev", html: ICONS.chevron }));
  const newBtn = iconButton(ICONS.plus, "New chat");
  const creditBtn = h("button", { cls: "ag-credit", attrs: { type: "button", title: "AI credit: top up and see what was used" }, hidden: true });
  const head = h("div", { cls: "ag-head" }, title, h("span", { cls: "ag-spacer" }), creditBtn, newBtn);

  const log = h("div", { cls: "ag-log", attrs: { "aria-live": "polite" } });
  const body = h("div", { cls: "ag-body" }, log);

  const chips = h("div", { cls: "ag-chips", hidden: true });
  const input = h("textarea", { cls: "ag-input", placeholder: "Ask the agent to do anything in this drawing…", attrs: { rows: "1", "aria-label": "Message the agent" } });
  const picker = h("input", { attrs: { type: "file", multiple: "", hidden: "" } });
  const attachBtn = iconButton(ICONS.attach, "Attach pictures or files");
  const modelLabel = h("span", { cls: "ag-model", attrs: { title: "The models the agents run on" } });
  const costLabel = h("span", { cls: "ag-cost" });
  const sendBtn = h("button", { cls: "ag-send", html: ICONS.send, attrs: { type: "button", title: "Send (Enter)", "aria-label": "Send" } });
  const composer = h("div", { cls: "ag-composer" }, chips, input, h("div", { cls: "ag-row" }, attachBtn, picker, modelLabel, h("span", { cls: "ag-spacer" }), costLabel, sendBtn));
  const root = h("div", { cls: "pal-fill ag" }, head, body, composer);

  // ---- the log ------------------------------------------------------------------------

  const nearBottom = (): boolean => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
  let stick = true;
  log.addEventListener("scroll", () => (stick = nearBottom()));
  const follow = (): void => {
    if (stick) log.scrollTop = log.scrollHeight;
  };

  /** What stands between the user and a first message, with what to do about it; null when nothing does. */
  function gate(): HTMLElement | null {
    if (!loaded) return null;
    const box = (text: string, ...actions: HTMLElement[]): HTMLElement => h("div", { cls: "ag-setup" }, h("p", { text }), ...actions);
    if (!serverAi) {
      return box(hasServer ? "The agents aren't set up on this server yet." : "The agents run through the Rodeo server, and this copy of the editor has none.");
    }
    if (!currentUser()) return box("Sign in to use the agents.", button("Sign In…", "primary", () => void requireSignIn("Sign in to use the agents")));
    const t = serverAi.credit;
    if (t && (balance ?? 0) < t.hold) {
      const lead = (balance ?? 0) > 0 ? `You have ${formatCredit(balance ?? 0, t.currency)} of AI credit: add some to start.` : "Add AI credit to start.";
      return box(`${lead} ${pricing(t)}`, topUpButtons(t, (message) => toast(message)));
    }
    return null;
  }

  function showEmpty(): void {
    const setup = gate();
    log.replaceChildren(
      h(
        "div",
        { cls: "ag-empty" },
        h("div", { cls: "ag-empty-title", text: "Agents" }),
        h("p", {
          text: "Ask for anything in this drawing: questions, edits, renders, exports or plug-ins. The agent reads, looks at and changes the drawing while you watch, and can hand parts of the work to a team of subagents.",
        }),
        setup,
        h(
          "div",
          { cls: "ag-suggest" },
          ...SUGGESTIONS.map((t) =>
            button(t, "ag-sugg", () => {
              input.value = t;
              autosize();
              input.focus();
            }),
          ),
        ),
      ),
    );
  }

  function userBubble(text: string, pics: readonly string[], names: readonly string[]): void {
    log.querySelector(".ag-empty")?.remove();
    const el = h("div", { cls: "ag-user" });
    if (pics.length) el.append(h("div", { cls: "ag-user-pics" }, ...pics.map((url) => thumb(url, null, "Attached picture"))));
    if (names.length) el.append(h("div", { cls: "ag-user-files" }, ...names.map((n) => h("span", { cls: "ag-file", html: ICONS.file }, n))));
    if (text) el.append(h("div", { cls: "ag-user-text", text }));
    log.append(el);
    stick = true;
    follow();
  }

  function newSink(el: HTMLElement, sub?: { card: HTMLElement; status: HTMLElement; now: HTMLElement }): Sink {
    return { el, text: null, reasoning: null, waiting: null, writing: null, ...sub };
  }

  function settle(s: Sink): void {
    s.waiting?.remove();
    s.waiting = null;
    s.writing?.el.remove();
    s.writing = null;
  }

  function flushText(s: Sink): void {
    const t = s.text;
    if (!t) return;
    window.clearTimeout(t.timer);
    t.timer = 0;
    t.el.replaceChildren(...Array.from(renderMarkdown(t.src).childNodes));
    follow();
  }

  function addText(s: Sink, delta: string): void {
    settle(s);
    s.reasoning = null;
    if (!s.text) {
      const el = h("div", { cls: "ag-md" });
      s.el.append(el);
      s.text = { el, src: "", timer: 0 };
    }
    s.text.src += delta;
    if (s.now) s.now.textContent = s.text.src.replace(/\s+/g, " ").trim().slice(-90);
    if (!s.text.timer) s.text.timer = window.setTimeout(() => flushText(s), TEXT_MS);
  }

  function addReasoning(s: Sink, delta: string): void {
    settle(s);
    if (!s.reasoning) {
      const body = h("div", { cls: "ag-reason-body" });
      const el = h("details", { cls: "ag-reason" }, h("summary", { text: "Thinking" }), body);
      s.el.append(el);
      s.reasoning = { el, body, src: "" };
    }
    s.reasoning.src += delta;
    s.reasoning.body.textContent = s.reasoning.src;
    follow();
  }

  /**
   * A tool call as the model writes it: one line naming it, its size so far and the end of what it
   * has written, until its card takes the line's place. Arguments come as JSON pieces, so a
   * script's lines are its escaped newlines.
   */
  function addWriting(s: Sink, index: number, name: string, delta: string): void {
    let w = s.writing;
    if (!w || w.index !== index) {
      if (s.text) flushText(s);
      s.text = null;
      s.reasoning = null;
      settle(s);
      const label = h("span", { cls: "ag-writing-label" });
      const tail = h("code", { cls: "ag-writing-tail" });
      const el = h("div", { cls: "ag-writing" }, h("i"), label, tail);
      s.el.append(el);
      w = s.writing = { el, label, tail, index, name, chars: 0, lines: 1, line: "" };
      follow();
    }
    if (name) w.name = name;
    w.chars += delta.length;
    const parts = (w.line + delta).split("\\n");
    w.lines += parts.length - 1;
    w.line = parts[parts.length - 1].slice(-240);
    const size = w.lines > 1 ? `${w.lines} lines` : w.chars >= 1000 ? `${(w.chars / 1000).toFixed(1)} KB` : "";
    const text = `Writing ${w.name.replace(/_/g, " ")}${size ? ` · ${size}` : ""}`;
    w.label.textContent = text;
    w.tail.textContent = w.line.replace(/\\(["\\/])/g, "$1").replace(/\\t/g, "  ").trim().slice(-120);
    if (s.now) s.now.textContent = text;
  }

  function waiting(s: Sink): void {
    if (s.text) flushText(s);
    s.text = null;
    s.reasoning = null;
    s.writing?.el.remove();
    s.writing = null;
    if (s.waiting) return;
    s.waiting = h("div", { cls: "ag-waiting" }, h("i"), h("i"), h("i"));
    s.el.append(s.waiting);
    follow();
  }

  const cards = new Map<string, Card>();
  const subs = new Map<string, Sink>();

  function toolCard(s: Sink, id: string, label: string, args: Record<string, unknown>, nested: boolean): Card {
    if (s.text) flushText(s);
    s.text = null;
    s.reasoning = null;
    settle(s);
    const status = h("span", { cls: "ag-status" });
    const detail = h("div", { cls: "ag-detail", hidden: true });
    const toggle = h("button", { cls: "ag-tool-head", attrs: { type: "button", "aria-expanded": "false" } }, status, h("span", { cls: "ag-tool-label", text: label }), h("span", { cls: "ag-chev", html: ICONS.chevron }));
    const el = h("div", { cls: `ag-tool${nested ? " nested" : ""}`, attrs: { "data-state": "running" } }, toggle);
    const progress = h("div", { cls: "ag-progress", hidden: true });
    const pics = h("div", { cls: "ag-pics" });
    const filesEl = h("div", { cls: "ag-files" });
    const subsEl = h("div", { cls: "ag-subs" });
    el.append(progress, pics, filesEl, subsEl, detail);
    const input = Object.keys(args).length ? JSON.stringify(args, null, 1) : "";
    if (input) detail.append(h("div", { cls: "ag-detail-k", text: "Input" }), h("pre", { text: clip(input) }));
    toggle.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      toggle.setAttribute("aria-expanded", String(!detail.hidden));
      el.classList.toggle("open", !detail.hidden);
    });
    s.el.append(el);
    if (s.now) s.now.textContent = label;
    follow();
    const card: Card = { el, status, progress, pics, files: filesEl, detail, subs: subsEl, args };
    cards.set(id, card);
    return card;
  }

  function finishCard(card: Card, ok: boolean, text: string, images: readonly Picture[], out: readonly OutFile[]): void {
    card.el.setAttribute("data-state", ok ? "done" : "error");
    card.status.innerHTML = ok ? ICONS.check : ICONS.cross;
    card.progress.hidden = true;
    card.detail.append(h("div", { cls: "ag-detail-k", text: ok ? "Result" : "Error" }), h("pre", { text: clip(text) }));
    if (!ok) card.el.append(h("div", { cls: "ag-error-line", text: text.replace(/^Error:\s*/, "").slice(0, 220) }));
    for (const p of images) card.pics.append(thumb(p.url, p.full ?? null, p.caption));
    for (const f of out) card.files.append(fileChip(f));
    follow();
  }

  function subCard(parent: Card | undefined, sub: string, titleText: string, model: string): Sink {
    const status = h("span", { cls: "ag-status" });
    const now = h("span", { cls: "ag-sub-now", text: "Starting…" });
    const logEl = h("div", { cls: "ag-sub-log", hidden: true });
    const toggle = h(
      "button",
      { cls: "ag-sub-head", attrs: { type: "button", "aria-expanded": "false" } },
      status,
      h("span", { cls: "ag-sub-text" }, h("span", { cls: "ag-sub-title", text: titleText }), now),
      h("span", { cls: "ag-badge", text: shortModel(model) }),
      h("span", { cls: "ag-chev", html: ICONS.chevron }),
    );
    const el = h("div", { cls: "ag-sub", attrs: { "data-state": "running" } }, toggle, logEl);
    toggle.addEventListener("click", () => {
      logEl.hidden = !logEl.hidden;
      toggle.setAttribute("aria-expanded", String(!logEl.hidden));
      el.classList.toggle("open", !logEl.hidden);
    });
    (parent?.subs ?? log).append(el);
    const sink = newSink(logEl, { card: el, status, now });
    subs.set(sub, sink);
    follow();
    return sink;
  }

  // ---- a run ------------------------------------------------------------------------

  function setRunning(on: boolean): void {
    sendBtn.innerHTML = on ? ICONS.stop : ICONS.send;
    sendBtn.title = on ? "Stop" : "Send (Enter)";
    sendBtn.setAttribute("aria-label", on ? "Stop" : "Send");
    sendBtn.classList.toggle("stop", on);
    root.classList.toggle("running", on);
  }

  async function send(): Promise<void> {
    if (running) {
      running.abort();
      return;
    }
    const text = input.value.trim();
    const attached = pending;
    if (!text && !attached.length) return;
    const blocked = gate();
    if (blocked) {
      // the message stays in the box for when the way is clear
      if (thread.messages.length) log.append(blocked);
      else showEmpty();
      stick = true;
      follow();
      return;
    }
    const settings = agentSettings(serverAi);
    const app = appContext();
    if (!app) return;
    input.value = "";
    pending = [];
    renderChips();
    autosize();

    // pictures go to the model to see; other files wait for import_file
    const parts: ContentPart[] = [];
    const urls: string[] = [];
    const names: string[] = [];
    for (const f of attached) {
      files.set(f.name, f);
      if (IMAGE_TYPES.test(f.type)) {
        try {
          const { blobPicture } = await import("./look.ts");
          const pic = await blobPicture(f);
          parts.push({ type: "text", text: `Attached picture ${f.name}:` }, { type: "image_url", image_url: { url: pic.url } });
          urls.push(pic.url);
        } catch {
          names.push(f.name);
        }
      } else names.push(f.name);
    }
    const note = names.length ? `\n\n[Attached for import_file: ${names.map((n) => `${n} (${kb(files.get(n)!.size)})`).join(", ")}]` : "";
    const { stateNote } = await import("./prompt.ts");
    const content: ContentPart[] = [{ type: "text", text: (parts.length ? text || "(see the attached pictures)" : text) + note }, ...parts, { type: "text", text: stateNote() }];
    thread.messages.push({ role: "user", content });
    if (thread.messages.length === 1) {
      thread.title = titleFrom(text || attached[0]?.name || "");
      refreshTitle();
    }
    userBubble(text, urls, names);

    const turn = h("div", { cls: "ag-turn" });
    log.append(turn);
    const main = newSink(turn);
    let cost = 0;
    let tokens = 0;
    let steps = 0;
    const onEvent = (e: AgentEvent): void => {
      const s = e.sub ? subs.get(e.sub) : main;
      switch (e.kind) {
        case "turn":
          if (!e.sub) steps++;
          if (s) waiting(s);
          break;
        case "text":
          if (s) addText(s, e.delta);
          break;
        case "reasoning":
          if (s) addReasoning(s, e.delta);
          break;
        case "writing":
          if (s) addWriting(s, e.index, e.name, e.delta);
          break;
        case "tool":
          if (s) toolCard(s, e.id, e.label, e.args, !!e.sub);
          break;
        case "progress": {
          const c = cards.get(e.id);
          if (c) {
            c.progress.hidden = false;
            c.progress.textContent = e.text;
          }
          break;
        }
        case "result": {
          const c = cards.get(e.id);
          if (c) finishCard(c, e.ok, e.text, e.images, e.files);
          break;
        }
        case "sub_start":
          subCard(cards.get(e.parent), e.sub, e.title, e.model);
          break;
        case "sub_end": {
          const sink = subs.get(e.sub);
          if (!sink) break;
          if (sink.text) flushText(sink);
          settle(sink);
          sink.card?.setAttribute("data-state", e.ok ? "done" : "error");
          if (sink.status) sink.status.innerHTML = e.ok ? ICONS.check : ICONS.cross;
          if (sink.now) sink.now.textContent = e.report.replace(/\s+/g, " ").trim().slice(0, 120) || "Done";
          break;
        }
        case "usage":
          cost += e.usage.charged ?? 0;
          tokens += usageTokens(e.usage);
          if (e.usage.balance !== null) {
            balance = e.usage.balance;
            refreshCredit();
          }
          costLabel.textContent = costText(thread.cost + cost);
          break;
      }
    };

    running = new AbortController();
    setRunning(true);
    try {
      const { runAgent } = await import("./agent.ts");
      const end = await runAgent({ app, settings, history: thread.messages, attachments: files, signal: running.signal, onEvent });
      thread.messages.push(...end.added);
      if (main.text) flushText(main);
      settle(main);
      for (const sink of subs.values()) settle(sink);
      if (end.error) turn.append(errorNote(end.error, end.errorCode));
      // refused for want of credit: the balance shown is out of date
      if (end.errorCode === "credit") void refreshUser();
      else if (end.stopped) turn.append(h("div", { cls: "ag-note", text: "Stopped." }));
      turn.append(h("div", { cls: "ag-meta", text: [shortModel(settings.planner), `${steps} step${steps === 1 ? "" : "s"}`, tokens ? `${Math.round(tokens / 100) / 10}k tokens` : "", cost ? costText(cost) : ""].filter(Boolean).join(" · ") }));
    } catch (err) {
      settle(main);
      turn.append(errorNote(errorMessage(err), null));
    } finally {
      running = null;
      setRunning(false);
      thread.cost += cost;
      thread.updated = Date.now();
      costLabel.textContent = costText(thread.cost);
      follow();
      void saveThread(thread);
      // the account's balance, for the account dialog and the next start
      if (cost) void refreshUser();
    }
  }

  function errorNote(message: string, code: string | null): HTMLElement {
    const el = h("div", { cls: "ag-error" }, h("span", { text: message }));
    const t = serverAi?.credit;
    if (code === "credit" && t) el.append(topUpButtons(t, (m) => toast(m)));
    else if (code === "unauthorized") el.append(button("Sign In…", "", () => void requireSignIn("Sign in to use the agents")));
    return el;
  }

  // ---- conversations ----------------------------------------------------------------

  function refreshTitle(): void {
    (title.firstChild as HTMLElement).textContent = thread.title;
  }

  async function showThread(t: Thread): Promise<void> {
    if (running) return;
    thread = t;
    files.clear();
    cards.clear();
    subs.clear();
    refreshTitle();
    costLabel.textContent = costText(t.cost);
    if (!t.messages.length) {
      showEmpty();
      return;
    }
    log.replaceChildren();
    const { toolsFor } = await import("./tools.ts");
    const app = appContext();
    const tools = app ? new Map(toolsFor(true, app).map((x) => [x.spec.function.name, x])) : new Map();
    let sink: Sink | null = null;
    const withPicture: string[] = [];
    for (const m of t.messages) {
      if (m.role === "user") {
        const parts = typeof m.content === "string" ? [{ type: "text" as const, text: m.content }] : m.content;
        const first = parts[0];
        if (first?.type === "text" && first.text.startsWith("Pictures from the tools above:")) {
          const pics = parts.filter((p): p is Extract<ContentPart, { type: "image_url" }> => p.type === "image_url");
          for (const p of pics) {
            const id = withPicture.shift();
            const c = id ? cards.get(id) : undefined;
            if (c) c.pics.append(thumb(p.image_url.url, null, ""));
          }
          continue;
        }
        const text = parts
          .filter((p) => p.type === "text" && !p.text.startsWith(NOW))
          .map((p) => (p as { text: string }).text)
          .join("\n").replace(/\n\n\[Attached for import_file:[^\]]*\]$/, "");
        const pics = parts.filter((p): p is Extract<ContentPart, { type: "image_url" }> => p.type === "image_url").map((p) => p.image_url.url);
        userBubble(text.replace(/^Attached picture .*:$/gm, "").trim(), pics, []);
        const turn = h("div", { cls: "ag-turn" });
        log.append(turn);
        sink = newSink(turn);
      } else if (m.role === "assistant" && sink) {
        for (const r of m.reasoning_details ?? []) if (r.text) addReasoning(sink, r.text);
        sink.reasoning = null;
        if (m.content) {
          addText(sink, m.content);
          flushText(sink);
          sink.text = null;
        }
        for (const c of m.tool_calls ?? []) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(c.function.arguments) as Record<string, unknown>;
          } catch {
            // shown without its input
          }
          const tool = tools.get(c.function.name);
          let label = c.function.name;
          try {
            label = tool ? tool.label(args) : label;
          } catch {
            // the bare name
          }
          toolCard(sink, c.id, label, args, false);
        }
      } else if (m.role === "tool") {
        const c = cards.get(m.tool_call_id);
        if (!c) continue;
        const ok = !/^(Error:|Stopped by the user)/.test(m.content);
        finishCard(c, ok, m.content, [], []);
        if (m.content.endsWith("(The picture follows.)")) withPicture.push(m.tool_call_id);
      }
    }
    stick = true;
    follow();
  }

  async function threadMenu(): Promise<void> {
    const all = (await listThreads()).filter((t) => t.messages.length);
    const rows: Row[] = [
      { label: "New chat", run: () => void showThread(newThread()) },
      ...(all.length ? (["-"] as Row[]) : []),
      ...all.slice(0, 30).map((t): Row => ({ label: t.title, checked: () => t.id === thread.id, run: () => void showThread(t) })),
    ];
    if (thread.messages.length) {
      rows.push("-", {
        label: "Delete This Chat",
        run: () => {
          const gone = thread.id;
          void deleteThread(gone).then(() => showThread(newThread()));
        },
      });
    }
    const r = title.getBoundingClientRect();
    openContextMenu(rows, r.left, r.bottom + 4, title);
  }

  // ---- models and credit ----------------------------------------------------------------

  function refreshModel(): void {
    const s = agentSettings(serverAi);
    modelLabel.textContent = `${shortModel(s.planner)} + ${shortModel(s.worker)}`;
  }

  /** What was charged, in the credit's currency; nothing where the agents are free. */
  function costText(amount: number): string {
    const t = serverAi?.credit;
    return amount && t ? formatCredit(amount, t.currency) : "";
  }

  function refreshCredit(): void {
    const t = serverAi?.credit;
    creditBtn.hidden = !t || balance === null;
    if (!t || balance === null) return;
    creditBtn.textContent = formatCredit(balance, t.currency);
    creditBtn.classList.toggle("low", balance < t.hold);
  }

  // ---- composer -------------------------------------------------------------------------

  function autosize(): void {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function renderChips(): void {
    chips.hidden = pending.length === 0;
    chips.replaceChildren(
      ...pending.map((f, i) => {
        const x = h("button", { cls: "ag-chip-x", html: ICONS.cross, attrs: { type: "button", title: "Remove", "aria-label": `Remove ${f.name}` } });
        x.addEventListener("click", () => {
          pending.splice(i, 1);
          renderChips();
        });
        return h("span", { cls: "ag-chip" }, h("span", { cls: "ag-chip-name", text: f.name }), x);
      }),
    );
  }

  function attach(list: Iterable<File>): void {
    for (const f of list) if (!pending.some((p) => p.name === f.name && p.size === f.size)) pending.push(f);
    renderChips();
  }

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
    // the editor's shortcuts stay out of the chat
    e.stopPropagation();
  });
  input.addEventListener("paste", (e) => {
    const pics = [...(e.clipboardData?.files ?? [])];
    if (pics.length) {
      e.preventDefault();
      attach(pics);
    }
  });
  sendBtn.addEventListener("click", () => void send());
  attachBtn.addEventListener("click", () => picker.click());
  picker.addEventListener("change", () => {
    attach(picker.files ?? []);
    picker.value = "";
  });
  // files dropped on the panel are attached here, not opened as the drawing (the window's drop handler)
  for (const type of ["dragenter", "dragover", "dragleave", "drop"] as const) {
    root.addEventListener(type, (e) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.stopPropagation();
      root.classList.toggle("drop", type === "dragenter" || type === "dragover");
      if (type === "drop") attach(e.dataTransfer.files);
    });
  }
  title.addEventListener("click", () => void threadMenu());
  newBtn.addEventListener("click", () => void showThread(newThread()));
  creditBtn.addEventListener("click", openCreditDialog);
  // a new drawing keeps the chat: the agent reads the drawing afresh each run
  store.on("session", () => {
    if (!thread.messages.length && !running) showEmpty();
  });

  // signing in or out, and a top-up, change what the panel offers
  onUser((u) => {
    balance = u?.aiCredit ?? null;
    refreshCredit();
    if (!thread.messages.length && !running) showEmpty();
  });

  refreshModel();
  showEmpty();
  return root;
}

// ---- small parts ---------------------------------------------------------------------

function iconButton(svg: string, label: string): HTMLButtonElement {
  return h("button", { cls: "ag-icon", html: svg, attrs: { type: "button", title: label, "aria-label": label } });
}

function button(text: string, cls: string, run: () => void): HTMLButtonElement {
  const b = h("button", { cls: `btn small ${cls}`.trim(), text, attrs: { type: "button" } });
  b.addEventListener("click", run);
  return b;
}

function thumb(url: string, full: Blob | null, caption: string): HTMLElement {
  const img = h("img", { attrs: { src: url, alt: caption || "Picture", loading: "lazy" } });
  const b = h("button", { cls: "ag-thumb", attrs: { type: "button", title: caption || "Open the picture" } }, img);
  b.addEventListener("click", () => lightbox(url, full, caption));
  return b;
}

function lightbox(url: string, full: Blob | null, caption: string): void {
  const shown = full ? URL.createObjectURL(full) : url;
  const close = (): void => {
    back.remove();
    document.removeEventListener("keydown", key, true);
    if (full) URL.revokeObjectURL(shown);
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
    }
  };
  const save = button("Download", "", () => {
    if (full) downloadBlob("render.png", full);
    else {
      const a = h("a", { attrs: { href: url, download: "picture.jpg" }, hidden: true });
      document.body.append(a);
      a.click();
      a.remove();
    }
  });
  const back = h(
    "div",
    { cls: "ag-lightbox", attrs: { role: "dialog", "aria-label": caption || "Picture" } },
    h("img", { attrs: { src: shown, alt: caption } }),
    h("div", { cls: "ag-lightbox-bar" }, h("span", { cls: "ag-lightbox-cap", text: caption }), save, button("Close", "", close)),
  );
  back.addEventListener("click", (e) => {
    if (e.target === back) close();
  });
  document.addEventListener("keydown", key, true);
  document.body.append(back);
}

function fileChip(f: OutFile): HTMLElement {
  const b = h("button", { cls: "ag-file dl", html: ICONS.file, attrs: { type: "button", title: `Download ${f.name}` } }, `${f.name} · ${kb(f.blob.size)}`);
  b.addEventListener("click", () => downloadBlob(f.name, f.blob));
  return b;
}

function kb(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function clip(s: string): string {
  return s.length > DETAIL_CHARS ? `${s.slice(0, DETAIL_CHARS)}…` : s;
}

function usageTokens(u: Usage): number {
  return u.promptTokens + u.completionTokens;
}



