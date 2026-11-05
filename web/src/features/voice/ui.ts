// The voice bubble, the numbered pins on the drawing and the microphone buttons: what the
// user sees while they speak. This file is only the look. voice.ts decides what happens and
// drives these classes; the bubble reports its buttons and its own timeouts back through
// callbacks. It reads no editor state and imports nothing from the rest of features/.

import { h } from "../../app/dom.ts";
import { shortcutText } from "../../app/menu.ts";

/** One word of the transcript, with what it means to the command. */
export interface UiWord {
  readonly text: string;
  /** plain or still being guessed (grey); a chip for a pin, the selection or what the clause before made; a dashed warning for a place with no pin */
  readonly tag: "plain" | "interim" | "pin" | "selection" | "previous" | "missing";
  readonly pin?: number;
}

/** A pin on the drawing: its number, and what is under it. */
export interface UiPin {
  readonly n: number;
  readonly label: string;
  readonly detail: string;
}

/** What the next step will do, shown at the foot of the bubble; null for nothing yet. */
export type UiPreview = { readonly kind: "agent"; readonly text: string } | null;

/** A button on a card. `run` is called on click; the caller decides what the card does next. */
export interface UiAction {
  readonly label: string;
  readonly primary?: boolean;
  run(): void;
}

/** The result card: a tone, a title, and what the user can do next. */
export interface UiOutcome {
  readonly tone: "done" | "error" | "agent" | "info";
  readonly title: string;
  readonly body?: string;
  /** right-aligned small text, e.g. "⌘Z undoes it" */
  readonly hint?: string;
  readonly actions: readonly UiAction[];
  /** extra content under the actions (the top-up buttons) */
  readonly extra?: HTMLElement;
}

/** The microphone button's state. */
export type MicState = "idle" | "listening" | "working" | "unsupported" | "hidden";

type Mode = "hidden" | "listen" | "working" | "outcome" | "intro";
type Point = { readonly x: number; readonly y: number };

interface PinView {
  readonly key: string;
  readonly el: HTMLElement;
}

// The bubble sits 16 px right and 20 px below the point it opens at, and never nearer than
// 8 px to the window's edge, so a click near the edge still shows the whole card.
const GAP_X = 16;
const GAP_Y = 20;
const EDGE = 8;
/** With no point to open at, the bubble sits this far above the foot of the drawing. */
const FOOT_LIFT = 96;
/** Matches the fade in voice.css; the bubble is display: none once it has run. */
const LEAVE_MS = 160;
/** After this long with no new level the ring pulses by CSS, as it does without a level meter. */
const PULSE_AFTER_MS = 400;
const UNSUPPORTED = "Voice commands need Chrome, Edge or Safari";

/** An outline icon in the editor's stroke style; voice.css sets the size where it is shown smaller. */
function svg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** The microphone: a capsule on its stand. */
export const MIC_ICON = svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/>');

const CHECK_ICON = svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>');
const CROSS_ICON = svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>');
/** A filled four-point spark: the agent's mark. */
const SPARK_ICON = svg('<path d="M12 3Q13.2 10.8 21 12Q13.2 13.2 12 21Q10.8 13.2 3 12Q10.8 10.8 12 3Z" fill="currentColor" stroke="none"/>');
const INFO_ICON = svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r=".6" fill="currentColor"/>');
/** Four squares: the selection. */
const SELECTION_ICON = svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2"/>');
/** A curved arrow turning back: what the clause before made. */
const PREVIOUS_ICON = svg('<path d="M9 6L4.5 10.5 9 15"/><path d="M4.5 10.5H14a5.5 5.5 0 0 1 0 11h-3"/>');

const TONE_ICON: Record<UiOutcome["tone"], string> = {
  done: CHECK_ICON,
  error: CROSS_ICON,
  agent: SPARK_ICON,
  info: INFO_ICON,
};

// <kbd>…</kbd> marks a key explicitly. Key names are keys wherever they appear in a line the
// bubble shows, so "Release Space to send" gets its key styled without the caller marking it.
const KEY_PART = /<kbd>(.*?)<\/kbd>|(⌘\S+|Ctrl\+\S+|\bEscape\b|\bEsc\b|\bSpace\b|\bEnter\b)/g;

/** Appends text to `into`, with key names as <kbd> elements (⌘ reads as Ctrl off the Mac). */
function keyed(into: HTMLElement, text: string): void {
  let last = 0;
  for (const m of text.matchAll(KEY_PART)) {
    const at = m.index ?? 0;
    if (at > last) into.append(text.slice(last, at));
    into.append(h("kbd", { text: shortcutText(m[1] ?? m[2] ?? "") }));
    last = at + m[0].length;
  }
  if (last < text.length) into.append(text.slice(last));
}

/** The first letter upper-cased: the transcript reads as a sentence. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A value kept between 0 and 1. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Keeps a position inside [lo, hi]; a window too narrow for the card pins it to lo. */
function clampTo(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** The hover text for the microphone, naming the key that holds voice on. */
function keyTitle(key: string): string {
  return `Voice commands: hold ${key} and speak, or click here`;
}

/** The "Listening…" placeholder shown before the first word. */
function emptyLine(): HTMLElement {
  return h("span", { cls: "voice-empty", text: "Listening…" });
}

/** One transcript word as its element: plain, grey while guessed, a chip, or a dashed warning. */
function wordNode(w: UiWord, first: boolean): HTMLElement {
  const text = first ? capitalise(w.text) : w.text;
  switch (w.tag) {
    case "pin":
      return h("span", { cls: "voice-chip" }, h("span", { cls: "voice-chip-n", text: w.pin === undefined ? "" : String(w.pin) }), text);
    case "selection":
      return h("span", { cls: "voice-chip is-selection" }, h("span", { cls: "voice-chip-n", html: SELECTION_ICON }), text);
    case "previous":
      return h("span", { cls: "voice-chip is-previous" }, h("span", { cls: "voice-chip-n", html: PREVIOUS_ICON }), text);
    case "missing":
      return h("span", { cls: "voice-word is-missing", text });
    case "interim":
      return h("span", { cls: "voice-word is-interim", text });
    default:
      return h("span", { cls: "voice-word", text });
  }
}

/** Identifies a pin for setPins: the same number, label and detail keep their element. */
function pinKey(p: UiPin): string {
  return `${p.n}\u0001${p.label}\u0001${p.detail}`;
}

/** One pin: a stem to the point, a dot on the point, the numbered badge, and the label. Hidden until placed. */
function pinElement(p: UiPin): HTMLElement {
  const label = h("span", { cls: "voice-pin-label", text: p.label });
  if (p.detail) label.append(h("span", { cls: "voice-pin-detail", text: ` · ${p.detail}` }));
  // the stem comes first so the dot paints over where it starts
  return h(
    "div",
    { cls: "voice-pin", hidden: true },
    h("span", { cls: "voice-pin-stem" }),
    h("span", { cls: "voice-pin-dot" }),
    h("span", { cls: "voice-pin-n", text: String(p.n) }),
    label,
  );
}

/** The voice bubble by the cursor (listening, working, the result card, the first-use card) and the pins on the drawing. */
export class VoiceUi {
  /** Called when the result card closes itself: its timeout, or a press outside it. */
  onClose: (() => void) | null = null;

  private root: HTMLDivElement | null = null;
  private mode: Mode = "hidden";
  /** The point the bubble opens at; null puts it over the foot of the drawing. */
  private anchor: Point | null = null;
  private ringEl: HTMLElement | null = null;
  private textEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private keysEl: HTMLElement | null = null;
  /** the foot's status line while work goes on (null: the status is the text line) */
  private statusEl: HTMLElement | null = null;
  private pins: PinView[] = [];
  /** The result card's timer: its id (0 when not running), the time left, and when this run began. */
  private closeTimer = 0;
  private closeLeft = 0;
  private closeStart = 0;
  private hovered = false;
  private leaveTimer = 0;
  private pulseTimer = 0;

  /** True while the bubble is open; a bubble that is fading out counts as closed. */
  get visible(): boolean {
    return this.mode !== "hidden";
  }

  /** Opens the bubble in its listening look at `anchor`, or over the foot of the drawing; `keys` says how to finish. */
  listen(anchor: Point | null, keys: string): void {
    this.clearTimers();
    this.anchor = anchor;
    this.mode = "listen";
    const root = this.box();
    root.className = "voice-bubble";
    root.removeAttribute("data-tone");
    this.ringEl = h("span", { cls: "voice-ring", html: MIC_ICON });
    this.textEl = h("div", { cls: "voice-text" }, emptyLine());
    this.previewEl = h("span", { cls: "voice-preview" });
    this.keysEl = h("span", { cls: "voice-keys" });
    keyed(this.keysEl, keys);
    root.replaceChildren(
      h("div", { cls: "voice-row" }, this.ringEl, this.textEl),
      h("div", { cls: "voice-foot" }, this.previewEl, this.keysEl),
    );
    this.show();
    this.place();
  }

  /** The microphone is live: the ring turns accent and its halo follows level(). */
  live(): void {
    if (this.mode !== "listen" || !this.root) return;
    this.root.classList.add("is-live");
    this.armPulse();
  }

  /** The voice's loudness, 0 to 1: sets the ring's halo. */
  level(v: number): void {
    if (!this.root) return;
    this.root.style.setProperty("--voice-level", String(clamp01(v)));
    if (this.mode === "listen") this.armPulse();
  }

  /** The words heard so far, each with what it means; "this" and "here" show as chips carrying their pin's number. */
  words(words: readonly UiWord[]): void {
    if (this.mode !== "listen" || !this.textEl) return;
    if (words.length === 0) {
      this.textEl.replaceChildren(emptyLine());
    } else {
      const nodes: (Node | string)[] = [];
      words.forEach((w, i) => {
        if (i > 0) nodes.push(" ");
        nodes.push(wordNode(w, i === 0));
      });
      this.textEl.replaceChildren(...nodes);
    }
    this.place();
  }

  /** Replaces the listening bubble's line saying how to finish (a mic press that became a hold). */
  setKeys(keys: string): void {
    if (this.mode !== "listen" || !this.keysEl) return;
    this.keysEl.replaceChildren();
    keyed(this.keysEl, keys);
  }

  /** The foot's line: the agent takes the words on letting go; null for nothing yet. */
  preview(p: UiPreview): void {
    if (this.mode !== "listen" || !this.previewEl) return;
    const el = this.previewEl;
    if (!p) {
      el.className = "voice-preview";
      el.replaceChildren();
    } else {
      el.className = "voice-preview is-agent";
      el.replaceChildren(h("span", { cls: "voice-glyph", html: SPARK_ICON }), p.text);
    }
    this.place();
  }

  /** Shows the pins in this order. A pin already shown with the same number, label and detail keeps its element, so it does not pop again. */
  setPins(pins: readonly UiPin[]): void {
    const old = new Map(this.pins.map((p) => [p.key, p] as const));
    const next: PinView[] = [];
    for (const pin of pins) {
      const key = pinKey(pin);
      const kept = old.get(key);
      if (kept) {
        old.delete(key);
        next.push(kept);
        continue;
      }
      const el = pinElement(pin);
      document.body.append(el);
      next.push({ key, el });
    }
    for (const gone of old.values()) gone.el.remove();
    this.pins = next;
  }

  /** Each pin's client point, in the order given to setPins; null hides that pin. Call every frame while pins show. */
  placePins(at: readonly (Point | null)[]): void {
    this.pins.forEach((p, i) => {
      const q = at[i];
      p.el.hidden = !q;
      if (q) p.el.style.transform = `translate(${q.x}px, ${q.y}px)`;
    });
  }

  /** Work in progress (speech being turned into text, or the agent): a spinner, the status line and a Stop button. `said` shows above the status, quoted. */
  working(text: string, onStop: () => void, said?: string): void {
    this.clearTimers();
    this.mode = "working";
    const root = this.box();
    root.className = "voice-bubble is-working";
    root.removeAttribute("data-tone");
    this.ringEl = h("span", { cls: "voice-ring" });
    this.previewEl = null;
    this.keysEl = h("span", { cls: "voice-keys" });
    keyed(this.keysEl, "Esc to stop");
    const stop = this.button({ label: "Stop", run: onStop });
    let foot: HTMLElement;
    if (said) {
      this.textEl = h("div", { cls: "voice-text voice-said", text: `“${said}”` });
      this.statusEl = h("span", { cls: "voice-preview", text });
      foot = this.statusEl;
    } else {
      this.textEl = h("div", { cls: "voice-text", text });
      this.statusEl = null;
      foot = h("span", { cls: "voice-preview" });
    }
    root.replaceChildren(h("div", { cls: "voice-row" }, this.ringEl, this.textEl, stop), h("div", { cls: "voice-foot" }, foot, this.keysEl));
    this.show();
    this.place();
  }

  /** Changes the status line while work goes on, e.g. to the tool the agent is using. */
  status(text: string): void {
    if (this.mode !== "working") return;
    const el = this.statusEl ?? this.textEl;
    if (el) el.textContent = text;
  }

  /** The result card. It closes itself after `ms` (0 keeps it), pausing while the pointer is on it. */
  outcome(o: UiOutcome, ms: number): void {
    this.clearTimers();
    this.mode = "outcome";
    const root = this.box();
    root.className = "voice-bubble is-outcome";
    root.dataset.tone = o.tone;
    this.ringEl = null;
    this.textEl = null;
    this.previewEl = null;
    this.keysEl = null;
    const text = h("div", { cls: "voice-outcome-text" }, h("div", { cls: "voice-outcome-title", text: o.title }));
    if (o.body) {
      const body = h("div", { cls: "voice-outcome-body" });
      keyed(body, o.body);
      text.append(body);
    }
    const kids: Node[] = [h("div", { cls: "voice-row" }, h("span", { cls: "voice-tone", html: TONE_ICON[o.tone] }), text)];
    if (o.actions.length > 0 || o.hint) {
      const actions = h("div", { cls: "voice-actions" }, ...o.actions.map((a) => this.button(a)));
      if (o.hint) {
        const hint = h("span", { cls: "voice-hint" });
        keyed(hint, o.hint);
        actions.append(hint);
      }
      kids.push(actions);
    }
    if (o.extra) kids.push(o.extra);
    root.replaceChildren(...kids);
    this.show();
    // a card that opens under the pointer waits for the pointer to leave before it counts down
    this.hovered = root.matches(":hover");
    this.closeLeft = ms;
    this.runClose();
    this.place();
  }

  /** The first-use card: a title, lines of text and buttons. It stays until a button or Escape closes it. */
  intro(title: string, lines: readonly string[], actions: readonly UiAction[]): void {
    this.clearTimers();
    // the first-use card is not tied to a press, so it sits over the drawing's foot
    this.anchor = null;
    this.mode = "intro";
    const root = this.box();
    root.className = "voice-bubble is-intro";
    root.removeAttribute("data-tone");
    this.ringEl = null;
    this.textEl = null;
    this.previewEl = null;
    this.keysEl = null;
    const paragraphs = lines.map((line) => {
      const p = h("p", { cls: "voice-intro-line" });
      keyed(p, line);
      return p;
    });
    root.replaceChildren(
      h("div", { cls: "voice-intro-title", text: title }),
      ...paragraphs,
      h("div", { cls: "voice-actions" }, ...actions.map((a) => this.button(a))),
    );
    this.show();
    this.place();
  }

  /** Fades the bubble out and takes the pins away. */
  hide(): void {
    this.clearTimers();
    for (const p of this.pins) p.el.remove();
    this.pins = [];
    this.ringEl = null;
    this.textEl = null;
    this.previewEl = null;
    this.keysEl = null;
    this.hovered = false;
    this.mode = "hidden";
    const root = this.root;
    if (!root || root.hidden) return;
    root.classList.add("is-leaving");
    this.leaveTimer = window.setTimeout(() => {
      this.leaveTimer = 0;
      root.hidden = true;
      root.classList.remove("is-leaving");
    }, LEAVE_MS);
  }

  /** The bubble element, made on first use and kept in the page. */
  private box(): HTMLDivElement {
    if (this.root) return this.root;
    const root = h("div", { cls: "voice-bubble", hidden: true, attrs: { role: "status", "aria-live": "polite" } });
    // a press on the bubble is for its buttons, not for the drawing under it
    root.addEventListener("pointerdown", (e) => e.stopPropagation());
    root.addEventListener("pointerenter", () => this.pauseClose());
    root.addEventListener("pointerleave", () => this.resumeClose());
    // capture, so a press the drawing stops still closes the result card
    window.addEventListener(
      "pointerdown",
      (e) => {
        if (this.mode === "outcome" && !root.contains(e.target as Node | null)) this.close();
      },
      true,
    );
    document.body.append(root);
    this.root = root;
    // the bubble grows as words and chips arrive, after it was placed: keep it inside the window as it grows
    new ResizeObserver(() => this.place()).observe(root);
    return root;
  }

  /** Makes the bubble visible; its enter animation plays because it was display: none. */
  private show(): void {
    const root = this.box();
    root.classList.remove("is-leaving");
    root.hidden = false;
  }

  /** Positions the bubble by its anchor, or over the foot of the drawing, and keeps it inside the window. */
  private place(): void {
    const root = this.root;
    if (!root || root.hidden) return;
    const w = root.offsetWidth;
    const hgt = root.offsetHeight;
    const stage = document.getElementById("stage")?.getBoundingClientRect();
    let x: number;
    let y: number;
    if (this.anchor) {
      x = this.anchor.x + GAP_X;
      y = this.anchor.y + GAP_Y;
    } else if (stage) {
      x = stage.left + stage.width / 2 - w / 2;
      y = stage.bottom - FOOT_LIFT - hgt;
    } else {
      x = (window.innerWidth - w) / 2;
      y = window.innerHeight - FOOT_LIFT - hgt;
    }
    x = clampTo(x, EDGE, window.innerWidth - w - EDGE);
    y = clampTo(y, EDGE, window.innerHeight - hgt - EDGE);
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
  }

  /** A card's button. A click blurs it first, so the next Space doesn't press it again. */
  private button(a: UiAction): HTMLButtonElement {
    const b = h("button", { cls: a.primary ? "btn primary" : "btn", text: a.label, attrs: { type: "button" } });
    b.addEventListener("click", () => {
      b.blur();
      a.run();
    });
    return b;
  }

  /** Closes the result card by itself, from its timeout or a press outside it. */
  private close(): void {
    if (this.mode !== "outcome") return;
    this.hide();
    this.onClose?.();
  }

  /** Starts the result card's timer for the time left, unless the pointer is on it. */
  private runClose(): void {
    if (this.closeLeft <= 0 || this.hovered) return;
    this.closeStart = Date.now();
    this.closeTimer = window.setTimeout(() => {
      this.closeTimer = 0;
      this.closeLeft = 0;
      this.close();
    }, this.closeLeft);
  }

  /** Stops the result card's timer while the pointer is on it, keeping the time left. */
  private pauseClose(): void {
    this.hovered = true;
    if (!this.closeTimer) return;
    window.clearTimeout(this.closeTimer);
    this.closeTimer = 0;
    this.closeLeft = Math.max(0, this.closeLeft - (Date.now() - this.closeStart));
  }

  /** Runs the result card's timer again once the pointer leaves it. */
  private resumeClose(): void {
    this.hovered = false;
    this.runClose();
  }

  /** Restarts the quiet timer: after a while with no level the ring pulses by CSS instead. */
  private armPulse(): void {
    window.clearTimeout(this.pulseTimer);
    this.ringEl?.classList.remove("is-pulsing");
    this.pulseTimer = window.setTimeout(() => {
      this.pulseTimer = 0;
      this.ringEl?.classList.add("is-pulsing");
    }, PULSE_AFTER_MS);
  }

  /** Cancels every timer the bubble runs. */
  private clearTimers(): void {
    window.clearTimeout(this.closeTimer);
    window.clearTimeout(this.leaveTimer);
    window.clearTimeout(this.pulseTimer);
    this.closeTimer = 0;
    this.closeLeft = 0;
    this.leaveTimer = 0;
    this.pulseTimer = 0;
  }
}

/** A microphone button: the top bar's, or the round one over a touch drawing. */
export class MicButton {
  /** The button; the caller puts it in the page. */
  readonly el: HTMLButtonElement;
  /** Pointer down (true) and up (false) on the button. A press with no pointer (Enter or Space on the focused button) counts as a down only. */
  onPress: ((down: boolean) => void) | null = null;
  private state: MicState = "idle";
  private idleTitle = keyTitle("Space");
  /** what a greyed-out button says on hover: why voice can't work here */
  private reason = UNSUPPORTED;

  /** cls: "tb-icon voice-mic" for the top bar, "voice-fab" for the touch button */
  constructor(cls: string) {
    this.el = h("button", { cls, html: MIC_ICON, attrs: { type: "button", "aria-label": "Voice commands", "data-state": "idle" } });
    this.el.title = this.idleTitle;
    // no focus on a press: a focused button would take the next Space
    this.el.addEventListener("mousedown", (e) => e.preventDefault());
    this.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || this.state === "unsupported") return;
      // keeps the release on the button when the pointer strays off it
      this.el.setPointerCapture(e.pointerId);
      this.onPress?.(true);
    });
    this.el.addEventListener("pointerup", (e) => {
      if (e.button === 0) this.onPress?.(false);
    });
    this.el.addEventListener("pointercancel", () => this.onPress?.(false));
    this.el.addEventListener("click", (e) => {
      this.el.blur();
      if (e.detail === 0 && this.state !== "unsupported") this.onPress?.(true);
    });
  }

  /** Shows the state: idle, listening (lit), working (a Stop), unsupported (greyed out, `reason` as its hover text) or hidden. */
  set(state: MicState, reason?: string): void {
    if (reason !== undefined) this.reason = reason;
    this.state = state;
    this.el.dataset.state = state;
    this.el.hidden = state === "hidden";
    // aria-disabled, not disabled: a disabled button takes no pointer, so its hover text would not show
    this.el.setAttribute("aria-disabled", String(state === "unsupported"));
    this.el.title = state === "unsupported" ? this.reason : state === "working" ? "Stop the agent" : this.idleTitle;
  }

  /** Names the key in the hover text, e.g. "Right Option" when that is the voice key. */
  setKey(key: string): void {
    this.idleTitle = keyTitle(key);
    this.set(this.state);
  }

  /** The voice's loudness, 0 to 1: the halo around a listening button follows it. */
  level(v: number): void {
    this.el.style.setProperty("--voice-level", String(clamp01(v)));
  }
}
