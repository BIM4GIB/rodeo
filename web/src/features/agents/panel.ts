// The Agents panel: a chat with the agent that works in the open drawing. The user's messages
// (with pictures and files attached) go to the planner; its reply streams in as it is written,
// each tool it calls shows as a card that fills in as it runs (pictures and files on it), and
// subagents show as cards of their own inside the delegate card that started them. Conversations
// are kept (threads.ts) and can be picked up again. The agents run through the Rodeo server
// only, on the models it picks: the user signs in, and where the server sells them by AI credit
// the panel shows the balance, what each message cost, and the top-ups when it runs low.
// The engine (agent.ts, the tools, the API's docs) loads with the first message.
// Each open drawing has a chat of its own, and the panel shows the one in front: an agent goes on
// working in its drawing when another tab comes to the front, so several work at once. Each
// drawing's tab shows what its agent is doing (at work, waiting for its tab, finished), and the
// panel's top line names the drawing its chat works in and the other agents at work.

import { h } from "../../app/dom.ts";
import { appContext, onDrawingClosed, redrawTabs, registerCloseGuard, registerTabMark, type DrawingRef, type TabMark } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { openContextMenu, type Row } from "../../app/menu.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { currentUser, onUser, refreshUser, serverConfig } from "../../platform/api.ts";
import type { ServerConfig } from "../../platform/protocol.ts";
import { formatCredit, openCreditDialog, pricing, topUpButtons } from "../account/credit.ts";
import { requireSignIn } from "../account/signin.ts";
import type { AgentEvent, RunTarget } from "./agent.ts";
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
  /** marks on a drawing's tab: its agent at work, waiting for the tab, finished, stopped by an error */
  working: '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-opacity=".25" stroke-width="1.6"/><path d="M7 2a5 5 0 0 1 5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
  waiting: '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="currentColor"/><path d="M5.6 4.8v4.4M8.4 4.8v4.4" style="stroke:var(--surface)" stroke-width="1.5" stroke-linecap="round"/></svg>',
  done: '<svg viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.2l1.5 4.3 4.3 1.5-4.3 1.5L7 12.8 5.5 8.5 1.2 7l4.3-1.5z" fill="currentColor"/></svg>',
  failed: '<svg viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="currentColor"/><path d="M7 4.2v3.4" style="stroke:var(--surface)" stroke-width="1.6" stroke-linecap="round"/><circle cx="7" cy="9.9" r=".95" style="fill:var(--surface)"/></svg>',
};

/** How a chat's last run ended, until the user has seen it, or what its run is doing now. */
type ChatState = "idle" | "working" | "waiting" | "done" | "failed";

/** A drawing's conversation with its agent, as the panel shows it while that drawing is in front. */
interface Chat {
  readonly root: HTMLElement;
  /** the drawing it works in; null while none is open */
  drawing(): DrawingRef | null;
  state(): ChatState;
  /** what its run waits to do once its drawing is in front, while the state is "waiting" */
  waitingFor(): string;
  /** whether it has nothing in it yet */
  empty(): boolean;
  stop(): void;
  /** the conversation goes on in `d` (its drawing opened again in its place) */
  rebind(d: DrawingRef): void;
  /** its drawing is in front: how its last run ended has been seen */
  seen(): void;
  /** the server's terms or the user's credit changed */
  refresh(): void;
  /** draws the top line again: its drawing and the agents at work in others */
  where(): void;
  showThread(t: Thread): Promise<void>;
  /** its root left the panel for good (its drawing closed) */
  dispose(): void;
}

/** The server's agents and the user's credit, shared by every drawing's chat. */
const shared: { loaded: boolean; hasServer: boolean; serverAi: ServerConfig["ai"]; balance: number | null } = { loaded: false, hasServer: false, serverAi: null, balance: null };

/** Each open drawing's chat, by drawing; the key null holds the one shown while none is open. */
const chats = new Map<DrawingRef | null, Chat>();
let host: HTMLElement | null = null;

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

/** The last line of streamed thinking, for a closed Thinking block's summary. */
function lastLine(src: string): string {
  const lines = src.trimEnd().split("\n");
  return (lines[lines.length - 1] ?? "").replace(/\*\*/g, "").trim().slice(-140);
}

/** Where one model's output goes: the reply's body, or a subagent's log. */
interface Sink {
  readonly el: HTMLElement;
  text: { el: HTMLElement; src: string; timer: number } | null;
  /** a Thinking block: its label, the line it shows while closed, and when it began */
  reasoning: { el: HTMLElement; body: HTMLElement; label: HTMLElement; line: HTMLElement; src: string; started: number; timer: number } | null;
  waiting: HTMLElement | null;
  /** a tool call being written: its size so far and the line it is on */
  writing: { el: HTMLElement; label: HTMLElement; tail: HTMLElement; index: number; name: string; chars: number; lines: number; line: string } | null;
  /** a subagent's card, its status mark, and the line showing what it is doing */
  readonly card?: HTMLElement;
  readonly status?: HTMLElement;
  readonly now?: HTMLElement;
}

/** Opens the saved conversation `id` in the Agents panel, in the chat of the drawing in front; false when the panel isn't built or the conversation is gone. */
export async function openAgentsThread(id: string): Promise<boolean> {
  const t = (await listThreads()).find((x) => x.id === id);
  if (!t || !host) return false;
  appContext()?.palettes.show("agents");
  await frontChat().showThread(t);
  return true;
}

/** The panel: the chat of the drawing in front, swapped for another drawing's as its tab comes to the front. */
export function agentsPanel(): HTMLElement {
  const panel = h("div", { cls: "pal-fill ag-host" });
  host = panel;
  void serverConfig().then((cfg) => {
    shared.loaded = true;
    shared.hasServer = cfg !== null;
    shared.serverAi = cfg?.ai ?? null;
    for (const c of chats.values()) c.refresh();
  });
  // signing in or out, and a top-up, change what the panel offers
  onUser((u) => {
    shared.balance = u?.aiCredit ?? null;
    for (const c of chats.values()) c.refresh();
  });
  store.on("session", showFront);
  onDrawingClosed(drawingClosed);
  registerTabMark(tabMark);
  registerCloseGuard((d) => (chats.get(d)?.state() === "working" || chats.get(d)?.state() === "waiting" ? "An agent is at work in this drawing: closing it stops the agent." : null));
  showFront();
  return panel;
}

/** The chat of the drawing in front, made when first asked for; one begun with no drawing open goes on in the first drawing opened. */
function frontChat(): Chat {
  const d = appContext()?.frontDrawing() ?? null;
  const chat = chats.get(d);
  if (chat) return chat;
  const loose = d ? chats.get(null) : undefined;
  if (d && loose) {
    loose.rebind(d);
    return loose;
  }
  const made = chatView(d);
  chats.set(d, made);
  return made;
}

/** Shows the chat of the drawing in front (on every change to the open drawing: cheap when it is shown already). */
function showFront(): void {
  if (!host) return;
  const chat = frontChat();
  if (host.firstChild !== chat.root) host.replaceChildren(chat.root);
  chat.seen();
  chat.where();
}

/** A chat's drawing changed (opened in a tab of its own by its run, or again in its place): it is kept under the new one. */
function chatMoved(chat: Chat, d: DrawingRef): void {
  for (const [k, c] of chats) if (c === chat) chats.delete(k);
  const there = chats.get(d);
  // the empty chat made as the drawing came to the front gives way
  if (there && there !== chat) there.dispose();
  chats.set(d, chat);
  showFront();
  stateChanged();
}

/** A drawing's tab closed, or the drawing opened again in its place (`next`): its agent stops, and its chat goes or follows it. */
function drawingClosed(d: DrawingRef, next: DrawingRef | null): void {
  const chat = chats.get(d);
  if (!chat) return;
  chat.stop();
  chats.delete(d);
  if (next) chat.rebind(next);
  else chat.dispose();
  stateChanged();
}

/** What an agent does shows on its drawing's tab, and on the panel's top line. */
function stateChanged(): void {
  redrawTabs();
  const d = appContext()?.frontDrawing() ?? null;
  chats.get(d)?.where();
}

const MARK_TITLES: Record<Exclude<ChatState, "idle">, string> = {
  working: "An agent is at work in this drawing",
  waiting: "",
  done: "The agent has finished: its answer is in Agents",
  failed: "The agent stopped with an error: see Agents",
};

function tabMark(d: DrawingRef): TabMark | null {
  const chat = chats.get(d);
  const state = chat?.state() ?? "idle";
  if (!chat || state === "idle") return null;
  const title = state === "waiting" ? `The agent is waiting for this drawing to be in front, to go on with: ${chat.waitingFor()}` : MARK_TITLES[state];
  return { html: ICONS[state], title, cls: `ag-tab ${state}` };
}

const fileBase = (name: string): string => name.replace(/\.[^.]+$/, "") || name;

/** A drawing's conversation with its agent: everything the panel shows while that drawing is in front. */
function chatView(start: DrawingRef | null): Chat {
  let thread: Thread = newThread();
  let running: AbortController | null = null;
  /** files attached in this conversation, by name, for import_file */
  const files = new Map<string, File>();
  let pending: File[] = [];
  /** the drawing its runs work in; made with the engine at the first message */
  let target: RunTarget | null = null;
  let bound: DrawingRef | null = start;
  /** calls waiting for the drawing to come to the front, by call id: what each will do */
  const waits = new Map<string, string>();
  /** how the last run ended while its drawing was behind, until the drawing is in front */
  let unseen: "done" | "failed" | null = null;
  let self: Chat;

  // ---- chrome ----------------------------------------------------------------------

  const title = h("button", { cls: "ag-title", attrs: { type: "button", title: "Conversations" } }, h("span", { cls: "ag-title-text", text: thread.title }), h("span", { cls: "ag-chev", html: ICONS.chevron }));
  const newBtn = iconButton(ICONS.plus, "New chat");
  const creditBtn = h("button", { cls: "ag-credit", attrs: { type: "button", title: "AI credit: top up and see what was used" }, hidden: true });
  const head = h("div", { cls: "ag-head" }, title, h("span", { cls: "ag-spacer" }), creditBtn, newBtn);
  // the drawing this chat works in, and the agents at work in other tabs
  const whereEl = h("div", { cls: "ag-where" });

  // the conversation, in a scroller of its own so a change in its size (text streaming in, a
  // picture loading, a card or Thinking opened) can keep the newest of it in view
  const log = h("div", { cls: "ag-feed" });
  const scroller = h("div", { cls: "ag-log", attrs: { "aria-live": "polite" } }, log);
  const jumpBtn = h("button", { cls: "ag-jump", html: ICONS.chevron, attrs: { type: "button", title: "Jump to the latest", "aria-label": "Jump to the latest" }, hidden: true });
  const body = h("div", { cls: "ag-body" }, scroller, jumpBtn);

  const chips = h("div", { cls: "ag-chips", hidden: true });
  const input = h("textarea", { cls: "ag-input", placeholder: "Ask the agent to do anything in this drawing…", attrs: { rows: "1", "aria-label": "Message the agent" } });
  const picker = h("input", { attrs: { type: "file", multiple: "", hidden: "" } });
  const attachBtn = iconButton(ICONS.attach, "Attach pictures or files");
  const modelLabel = h("span", { cls: "ag-model", attrs: { title: "The models the agents run on" } });
  const costLabel = h("span", { cls: "ag-cost" });
  const sendBtn = h("button", { cls: "ag-send", html: ICONS.send, attrs: { type: "button", title: "Send (Enter)", "aria-label": "Send" } });
  const composer = h("div", { cls: "ag-composer" }, chips, input, h("div", { cls: "ag-row" }, attachBtn, picker, modelLabel, h("span", { cls: "ag-spacer" }), costLabel, sendBtn));
  const root = h("div", { cls: "pal-fill ag" }, head, whereEl, body, composer);

  // ---- the log ------------------------------------------------------------------------

  // The log keeps to its newest line while `stick` holds. Only the reader lets go of it, by
  // scrolling up (the wheel, a drag, a key); growth, pictures loading and blocks opening never do,
  // and scrolling back down to the end takes hold again.
  const nearBottom = (): boolean => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
  let stick = true;
  let lastTop = 0;
  const showJump = (): void => {
    jumpBtn.hidden = stick || nearBottom();
  };
  scroller.addEventListener("scroll", () => {
    const top = scroller.scrollTop;
    if (nearBottom()) stick = true;
    else if (top < lastTop - 1) stick = false;
    lastTop = top;
    showJump();
  });
  scroller.addEventListener("wheel", (e) => {
    if (e.deltaY < 0 && scroller.scrollHeight > scroller.clientHeight) stick = false;
  }, { passive: true });
  const follow = (): void => {
    if (stick) {
      scroller.scrollTop = scroller.scrollHeight;
      lastTop = scroller.scrollTop;
    }
    showJump();
  };
  new ResizeObserver(() => follow()).observe(log);
  jumpBtn.addEventListener("click", () => {
    stick = true;
    follow();
  });
  // a Thinking block opened shows its latest lines, as it would while streaming
  log.addEventListener(
    "toggle",
    (e) => {
      const el = e.target as HTMLElement;
      if (!el.classList?.contains("ag-reason") || !(el as HTMLDetailsElement).open) return;
      const body = el.querySelector<HTMLElement>(".ag-reason-body");
      if (body) drawReason(body);
      pinInner(body, true);
    },
    true,
  );

  /** What each Thinking block's body says, drawn when it is open (closed, only its latest line shows). */
  const reasons = new WeakMap<HTMLElement, string>();

  /** A Thinking block's body drawn as Markdown, if it has changed since it was last drawn. */
  function drawReason(body: HTMLElement): void {
    const src = reasons.get(body) ?? "";
    if (body.dataset.drawn === String(src.length)) return;
    body.dataset.drawn = String(src.length);
    body.replaceChildren(...Array.from(renderMarkdown(src).childNodes));
  }

  /** A box that scrolls on its own (a Thinking block) kept at its end while it grows, unless the reader scrolled it up. */
  function pinInner(box: HTMLElement | null, force = false): void {
    if (!box) return;
    if (force || box.dataset.pinned !== "0") box.scrollTop = box.scrollHeight;
  }

  /** What stands between the user and a first message, with what to do about it; null when nothing does. */
  function gate(): HTMLElement | null {
    if (!shared.loaded) return null;
    const box = (text: string, ...actions: HTMLElement[]): HTMLElement => h("div", { cls: "ag-setup" }, h("p", { text }), ...actions);
    if (!shared.serverAi) {
      return box(shared.hasServer ? "The agents aren't set up on this server yet." : "The agents run through the Rodeo server, and this copy of the editor has none.");
    }
    if (!currentUser()) return box("Sign in to use the agents.", button("Sign In…", "primary", () => void requireSignIn("Sign in to use the agents")));
    const t = shared.serverAi.credit;
    if (t && (shared.balance ?? 0) < t.hold) {
      const lead = (shared.balance ?? 0) > 0 ? `You have ${formatCredit(shared.balance ?? 0, t.currency)} of AI credit: add some to start.` : "Add AI credit to start.";
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
          text: `Ask for anything in ${bound ? fileBase(bound.name()) : "this drawing"}: questions, edits, renders, exports or plug-ins. The agent reads, looks at and changes the drawing while you watch, and can hand parts of the work to a team of subagents.`,
        }),
        h("p", {
          cls: "ag-empty-note",
          text: "Each open drawing has an agent of its own. Bring another tab to the front and this one keeps working; its tab shows how it is getting on.",
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
    endReasoning(s);
    if (!s.text) {
      const el = h("div", { cls: "ag-md" });
      s.el.append(el);
      s.text = { el, src: "", timer: 0 };
    }
    s.text.src += delta;
    if (s.now) s.now.textContent = s.text.src.replace(/\s+/g, " ").trim().slice(-90);
    if (!s.text.timer) s.text.timer = window.setTimeout(() => flushText(s), TEXT_MS);
  }

  function addReasoning(s: Sink, delta: string, live = true): void {
    settle(s);
    if (!s.reasoning) {
      const body = h("div", { cls: "ag-reason-body" });
      body.addEventListener("scroll", () => (body.dataset.pinned = body.scrollHeight - body.scrollTop - body.clientHeight < 24 ? "1" : "0"));
      const label = h("span", { cls: "ag-reason-label", text: live ? "Thinking" : "Thought" });
      const line = h("span", { cls: "ag-reason-line" });
      const el = h("details", { cls: `ag-reason${live ? " live" : ""}` }, h("summary", {}, label, line), body);
      s.el.append(el);
      s.reasoning = { el, body, label, line, src: "", started: Date.now(), timer: 0 };
    }
    const r = s.reasoning;
    r.src += delta;
    reasons.set(r.body, r.src);
    // closed, it shows the line it is on; open, its text, a few times a second
    if (live) r.line.textContent = lastLine(r.src);
    if ((r.el as HTMLDetailsElement).open && !r.timer) {
      r.timer = window.setTimeout(() => {
        r.timer = 0;
        drawReason(r.body);
        pinInner(r.body);
        follow();
      }, TEXT_MS);
    }
  }

  /** The Thinking block done with: it says how long it took and stops showing a line. */
  function endReasoning(s: Sink): void {
    const r = s.reasoning;
    s.reasoning = null;
    if (!r) return;
    window.clearTimeout(r.timer);
    if ((r.el as HTMLDetailsElement).open) {
      drawReason(r.body);
      pinInner(r.body);
    }
    if (!r.el.classList.contains("live")) return;
    r.el.classList.remove("live");
    const secs = Math.round((Date.now() - r.started) / 1000);
    r.label.textContent = secs >= 2 ? `Thought for ${secs} s` : "Thought";
    r.line.textContent = "";
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
      endReasoning(s);
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
    endReasoning(s);
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
    endReasoning(s);
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
    stateChanged();
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
    const settings = agentSettings(shared.serverAi);
    const app = appContext();
    if (!app) return;
    const { RunTarget } = await import("./agent.ts");
    target ??= new RunTarget(bound, app, (d) => {
      bound = d;
      chatMoved(self, d);
    });
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
    if (bound) thread.drawing = bound.name();
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
          if (waits.delete(e.id)) stateChanged();
          break;
        }
        case "wait": {
          const c = cards.get(e.id);
          const label = c?.el.querySelector(".ag-tool-label")?.textContent ?? "its next step";
          if (c) {
            c.progress.hidden = false;
            c.progress.textContent = `Waiting for ${bound ? fileBase(bound.name()) : "the drawing"} to be in front: ${e.why}`;
          }
          waits.set(e.id, label);
          stateChanged();
          // behind another tab: the user is told where to go to let it on
          if (bound && !bound.isShown()) toast(`The agent in ${fileBase(bound.name())} is waiting for its tab to be in front, to go on with: ${label}.`, "info");
          break;
        }
        case "resume": {
          const c = cards.get(e.id);
          if (c) c.progress.hidden = true;
          waits.delete(e.id);
          stateChanged();
          break;
        }
        case "sub_start":
          subCard(cards.get(e.parent), e.sub, e.title, e.model);
          break;
        case "sub_end": {
          const sink = subs.get(e.sub);
          if (!sink) break;
          if (sink.text) flushText(sink);
          endReasoning(sink);
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
            shared.balance = e.usage.balance;
            for (const c of chats.values()) c.refresh();
          }
          costLabel.textContent = costText(thread.cost + cost);
          break;
      }
    };

    running = new AbortController();
    setRunning(true);
    try {
      const { runAgent } = await import("./agent.ts");
      const end = await runAgent({ app, target, settings, history: thread.messages, attachments: files, signal: running.signal, onEvent });
      thread.messages.push(...end.added);
      if (main.text) flushText(main);
      endReasoning(main);
      settle(main);
      for (const sink of subs.values()) {
        endReasoning(sink);
        settle(sink);
      }
      if (end.error) turn.append(errorNote(end.error, end.errorCode));
      // finished behind another tab: its tab says so until it is brought to the front
      if (!end.stopped && bound?.isOpen() && !bound.isShown()) {
        unseen = end.error ? "failed" : "done";
        toast(end.error ? `The agent in ${fileBase(bound.name())} stopped with an error.` : `The agent in ${fileBase(bound.name())} has finished.`, end.error ? "error" : "info");
      }
      // refused for want of credit: the balance shown is out of date
      if (end.errorCode === "credit") void refreshUser();
      else if (end.stopped) turn.append(h("div", { cls: "ag-note", text: "Stopped." }));
      turn.append(h("div", { cls: "ag-meta", text: [shortModel(settings.planner), `${steps} step${steps === 1 ? "" : "s"}`, tokens ? `${Math.round(tokens / 100) / 10}k tokens` : "", cost ? costText(cost) : ""].filter(Boolean).join(" · ") }));
    } catch (err) {
      settle(main);
      turn.append(errorNote(errorMessage(err), null));
    } finally {
      running = null;
      waits.clear();
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
    const t = shared.serverAi?.credit;
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
    const tools = new Map(toolsFor(true).map((x) => [x.spec.function.name, x]));
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
        for (const r of m.reasoning_details ?? []) if (r.text) addReasoning(sink, r.text, false);
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
      ...all.slice(0, 30).map((t): Row => ({ label: t.drawing ? `${t.title} · ${fileBase(t.drawing)}` : t.title, checked: () => t.id === thread.id, run: () => void showThread(t) })),
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
    const s = agentSettings(shared.serverAi);
    modelLabel.textContent = `${shortModel(s.planner)} + ${shortModel(s.worker)}`;
  }

  /** What was charged, in the credit's currency; nothing where the agents are free. */
  function costText(amount: number): string {
    const t = shared.serverAi?.credit;
    return amount && t ? formatCredit(amount, t.currency) : "";
  }

  function refreshCredit(): void {
    const t = shared.serverAi?.credit;
    creditBtn.hidden = !t || shared.balance === null;
    if (!t || shared.balance === null) return;
    creditBtn.textContent = formatCredit(shared.balance, t.currency);
    creditBtn.classList.toggle("low", shared.balance < t.hold);
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

  // ---- where it works ---------------------------------------------------------------

  let whereKey = "";

  /** The top line: the drawing this chat works in, and the agents at work (or done) in the others, each a way to its tab. */
  function where(): void {
    const others = [...chats.values()].filter((c) => c !== self && c.drawing()?.isOpen() && c.state() !== "idle");
    const name = bound ? fileBase(bound.name()) : "";
    const key = JSON.stringify([name, others.map((c) => [c.drawing()!.name(), c.state()])]);
    if (key === whereKey) return;
    whereKey = key;
    const here = h(
      "span",
      { cls: "ag-where-here", attrs: { title: bound ? `This chat's agent works in ${bound.name()}, whichever tab is in front` : "Open or start a drawing for the agent to work in" } },
      h("span", { cls: "ag-where-icon", html: ICONS.file }),
      h("span", { cls: "ag-where-name", text: name || "No drawing open" }),
    );
    const chipsEl = others.map((c) => {
      const d = c.drawing()!;
      const state = c.state() as Exclude<ChatState, "idle">;
      const b = h(
        "button",
        { cls: `ag-where-other ${state}`, attrs: { type: "button", title: `${tabMark(d)?.title ?? ""}. Bring ${d.name()} to the front.` } },
        h("span", { cls: "ag-where-mark", html: ICONS[state] }),
        h("span", { cls: "ag-where-name", text: fileBase(d.name()) }),
      );
      b.addEventListener("click", () => d.show());
      return b;
    });
    whereEl.replaceChildren(here, ...(chipsEl.length ? [h("span", { cls: "ag-where-also", text: "Also:" }), ...chipsEl] : []));
  }

  refreshModel();
  refreshCredit();
  showEmpty();
  self = {
    root,
    drawing: () => bound,
    state: () => (running ? (waits.size ? "waiting" : "working") : (unseen ?? "idle")),
    waitingFor: () => [...waits.values()][0] ?? "",
    empty: () => !thread.messages.length && !running,
    stop: () => running?.abort(),
    rebind: (d) => {
      // a run's target says when it moves; the chat follows it there
      if (target && target.current !== d) target.follow(d);
      else {
        bound = d;
        chatMoved(self, d);
      }
      if (!thread.messages.length && !running) showEmpty();
    },
    seen: () => {
      if (!unseen || !bound?.isShown()) return;
      unseen = null;
      stateChanged();
    },
    refresh: () => {
      refreshModel();
      refreshCredit();
      if (!thread.messages.length && !running) showEmpty();
    },
    where,
    showThread,
    dispose: () => {
      running?.abort();
      root.remove();
    },
  };
  return self;
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



