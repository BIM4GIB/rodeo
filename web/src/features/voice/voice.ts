// The voice controller: what the voice is doing (idle, the first-use card, listening, sending the
// words, the agent working, a result card) and what each step does. gesture.ts sends it the keys
// and pointers; listen.ts (the browser's speech recognition) or record.ts (Rodeo's server) the
// words. Every command goes to the agent (agent.ts). engine.ts says whether voice can start (the
// account, the agent, speech to text, the credit); ui.ts draws the bubble, pins and mic buttons.

import { undo } from "../../app/commands.ts";
import type { AppContext } from "../../app/ext.ts";
import { IS_MAC } from "../../app/menu.ts";
import { layerInfo, store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import type { FaceHit, View3D } from "../../app/view3d.ts";
import { currentUser, onUser, refreshUser, serverConfig, userLoaded, userReady } from "../../platform/api.ts";
import type { AiCreditTerms, ServerConfig } from "../../platform/protocol.ts";
import { formatCredit, topUpButtons } from "../account/credit.ts";
import { requireSignIn } from "../account/signin.ts";
import { askAgent, agentGate, forgetVoiceThread, replyText, type AskInput, type AskSubject } from "./agent.ts";
import type { Pin, Word } from "./command.ts";
import { costLine, creditTermsOf, micTip, privacyLines, readiness, speechHints, transcribeOn, type Engine, type Readiness } from "./engine.ts";
import { installGesture } from "./gesture.ts";
import { Listener, onDeviceStatus, warmMicrophone, type Heard } from "./listen.ts";
import { pointingLines, readWords, splitWords, type WordOptions } from "./parse.ts";
import { objectNoun, pinAt2d, pinAt3d, pinClient, uiPin } from "./pins.ts";
import { Recorder, type Hearing, type RecordError, type RecordHandlers } from "./record.ts";
import { keyLabel, onVoiceSettings, openVoiceSettings, saveVoiceSettings, speechLang, voiceSettings, voiceSupport } from "./settings.ts";
import { MicButton, VoiceUi, type MicState, type UiAction, type UiOutcome, type UiWord } from "./ui.ts";

/** Where the voice is. "sending" is the short wait for the recogniser's last words, and the agent's gate. */
type State = "idle" | "intro" | "listening" | "sending" | "busy" | "outcome";
/** hold: the voice key is down, and letting it go sends. toggle: the mic button started it; a tap sends. */
type Mode = "hold" | "toggle";
type Point = { readonly x: number; readonly y: number };
/** Why voice can't start, as a card. */
type Block = Extract<Readiness, { readonly kind: "no-accounts" | "no-agent" | "no-speech" | "signin" | "credit" }>;

/** The longest one listening runs before it is sent by itself, in ms. */
const MAX_LISTEN_MS = 30_000;
/** A press on the mic at least this long is a hold: letting go sends, as Space does. */
const MIC_HOLD_MS = 350;
const OUT_OF_CREDIT = "You're out of AI credit. Top up to use voice commands.";
/** How long each kind of card stays, in ms; a card waits while the pointer is on it. */
const DONE_MS = 6_000;
const INFO_MS = 5_000;
const ERROR_MS = 9_000;
const AGENT_MS = 15_000;
/** How many selected objects the agent is told by name; the rest are counted. */
const NAMED = 20;
/** What a greyed-out mic says, and its card's title, where voice can't work here. */
const BLOCK_TITLE = {
  "no-accounts": "Voice commands need a Rodeo account",
  "no-agent": "Voice commands need Rodeo's agent",
  "no-speech": "Voice commands need Chrome, Edge or Safari here",
} as const;

/** A number in millimetres, whole, with thousands separators and never "-0". */
function mm(v: number): string {
  return (Math.round(v) || 0).toLocaleString("en-GB");
}

/** The first letter upper-cased: the transcript reads as a sentence. */
function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** A word as the bubble shows it: a chip for a pin, the selection or what the clause before made; grey while guessed. */
function toUiWord(w: Word, interim: boolean): UiWord {
  // "this" and "here" show what they point at while they're still being heard; other guesses are grey
  const r = w.ref;
  if (r === null) return { text: w.text, tag: interim ? "interim" : "plain" };
  switch (r.kind) {
    case "pin":
      return { text: w.text, tag: "pin", pin: r.n };
    case "selection":
      return { text: w.text, tag: "selection" };
    case "previous":
      return { text: w.text, tag: "previous" };
    case "missing":
      return { text: w.text, tag: "missing" };
  }
}

/** Starts the voice: the gesture, the bubble, and the microphone buttons. Called once the editor is ready. */
export function installVoice(ctx: AppContext, mics: readonly MicButton[]): void {
  const support = voiceSupport();
  const ui = new VoiceUi();
  let state: State = "idle";
  let mode: Mode = "hold";
  /** the pins dropped during this utterance, and kept for its result card */
  let pins: Pin[] = [];
  let heardLast: Heard | null = null;
  /** the agent run in progress, for Escape */
  let run: AbortController | null = null;
  /** Space was pressed down by the voice (the toggle and Right Option): it comes up when listening ends */
  let spaceByVoice = false;
  /** the 3D view whose face pick the voice took over, and the pick it replaced */
  let pickedView: View3D | null = null;
  let savedPick: View3D["onFacePick"] = null;
  let maxTimer = 0;
  let pinFrame = 0;
  let pressAt = 0;
  /** the timer that turns a mic press into a hold, while the button is down */
  let micHeld: ReturnType<typeof setTimeout> | null = null;
  /** bumped when a listening starts or is cancelled, so a send or a gate that finishes late does nothing */
  let epoch = 0;
  let lastSession = store.session;
  /** the server's config once read (undefined until then, null with no server) */
  let cfg: ServerConfig | null | undefined = undefined;
  /** who turns this listening's speech into text */
  let engine: Engine = "browser";
  /** what turning this command's speech into text was charged (null: free, the browser's, or not known) */
  let speechCost: number | null = null;
  /** a sign-in card was shown: signing in carries on from it */
  let pendingSignIn = false;
  /** the cards a held key has shown this visit: each shows once, then the key just pans */
  const shown = new Set<Readiness["kind"]>();

  const handlers: RecordHandlers = {
    audio: () => ui.live(),
    heard: (heard) => {
      heardLast = heard;
      annotate();
    },
    level: (v) => {
      ui.level(v);
      for (const m of mics) m.level(v);
    },
    // the recogniser stopped and could not go on: what was heard is sent
    ended: () => send(),
    error: (kind, message) => failListening(kind, message),
    // the recording is on its way to Rodeo's server: the bubble says so until the words come back
    transcribing: () => {
      if (state === "sending") ui.working("Turning speech into text…", cancel);
    },
  };
  const listener = new Listener(handlers);
  const recorder = new Recorder(handlers);
  /** the one listening now: the browser's recogniser or the recorder */
  let hearing: Hearing = listener;

  // ---- state and the microphone buttons -----------------------------------------------------

  /** The voice can take a key press or a mic press now: it is on, a drawing is open, and it is not sending or working. */
  function ready(): boolean {
    return voiceSettings().enabled && store.session !== null && state !== "busy" && state !== "sending";
  }

  /** What gesture.ts is told: a send that is waiting still counts as listening, so Escape cancels it. */
  function gestureState(): "idle" | "intro" | "listening" | "busy" | "outcome" {
    return state === "sending" ? "listening" : state;
  }

  /** Back to idle: nothing held, no pins, the buttons at rest. The caller has hidden the bubble. */
  function idle(): void {
    state = "idle";
    pins = [];
    heardLast = null;
    paintMics();
  }

  /** Shows a result card and makes the card the voice's state. */
  function card(o: UiOutcome, ms: number): void {
    state = "outcome";
    ui.outcome(o, ms);
  }

  /** Whether voice can start now, and on which speech to text. */
  function readinessNow(): Readiness {
    return readiness({ support, settings: voiceSettings(), config: cfg, user: userLoaded() ? currentUser() : undefined });
  }

  /** The microphone buttons: hidden when voice is off, greyed where it can't work here (the reason as hover text), lit while listening, a Stop while the agent works. */
  function paintMics(): void {
    const s = voiceSettings();
    const r = readinessNow().kind;
    let st: MicState = "idle";
    let reason: string | undefined;
    if (!s.enabled) {
      st = "hidden";
    } else if (r === "no-accounts" || r === "no-agent" || r === "no-speech") {
      st = "unsupported";
      reason = BLOCK_TITLE[r];
    } else if (state === "listening") {
      st = "listening";
    } else if (state === "busy") {
      st = "working";
    }
    for (const m of mics) m.set(st, reason);
  }

  /** The bubble opens at a top-bar mic's bottom-left corner; the touch button has no anchor. */
  function anchorOf(m: MicButton): Point | null {
    if (m.el.classList.contains("voice-fab")) return null;
    const r = m.el.getBoundingClientRect();
    return { x: r.left, y: r.bottom };
  }

  // ---- pins and the drawing -----------------------------------------------------------------

  /** The drawing's units, for the pins' coordinates and the summaries. */
  function units(): string | undefined {
    return store.session?.doc.info.units;
  }

  /** Shows the pins as they are, and keeps them on their points while any show. */
  function pushPins(): void {
    ui.setPins(pins.map((p) => uiPin(p, units())));
    frameLoop();
  }

  /** Places the pins on their points each frame, for as long as the bubble shows them. */
  function frameLoop(): void {
    if (pinFrame) return;
    const tick = (): void => {
      pinFrame = 0;
      if (pins.length === 0 || !ui.visible) return;
      ui.placePins(pins.map((p) => pinClient(ctx, p)));
      pinFrame = requestAnimationFrame(tick);
    };
    pinFrame = requestAnimationFrame(tick);
  }

  /** A click on the 2D drawing while listening drops a pin at the press point. */
  function click2d(at: Point): void {
    if (state !== "listening") return;
    const rect = ctx.canvas.getBoundingClientRect();
    pins.push(pinAt2d(ctx, { x: at.x - rect.left, y: at.y - rect.top }, pins.length + 1));
    pushPins();
    annotate();
  }

  /** A click in the 3D view while listening drops a pin where it met the model. */
  function addPin3d(hit: FaceHit | null): void {
    if (state !== "listening" || !hit) return;
    pins.push(pinAt3d(ctx, hit, pins.length + 1));
    pushPins();
    annotate();
  }

  /** Backspace or Delete while listening takes the last pin away. */
  function unpin(): void {
    if (state !== "listening" || pins.length === 0) return;
    pins.pop();
    pushPins();
    annotate();
  }

  /** What the pointing words are read against: the pins and how many objects are selected. */
  function wordOptions(): WordOptions {
    return { pins: pins.map((p) => ({ n: p.n })), selected: store.selection.size };
  }

  /** Shows the words heard so far, each with what it points at, and that the agent takes them. */
  function annotate(): void {
    if (state !== "listening" || !heardLast) return;
    const heard = heardLast;
    const words = readWords(`${heard.final} ${heard.interim}`.trim(), wordOptions());
    // words past the final ones are still being guessed, so they show grey
    const finals = splitWords(heard.final).length;
    ui.words(words.map((w, i) => toUiWord(w, i >= finals)));
    ui.preview(words.length ? { kind: "agent", text: "Ask the agent" } : null);
  }

  // ---- listening ----------------------------------------------------------------------------

  /** Stops the 30 s timer and gives the 3D view its face pick back. */
  function endPick(): void {
    window.clearTimeout(maxTimer);
    maxTimer = 0;
    if (pickedView) pickedView.onFacePick = savedPick;
    pickedView = null;
    savedPick = null;
  }

  /** Puts Space back up when the voice pressed it down. */
  function releaseSpace(): void {
    if (!spaceByVoice) return;
    spaceByVoice = false;
    ctx.controller.setSpace(false);
  }

  /** Everything listening set up: the timer, the 3D pick and any Space the voice pressed. */
  function endExtras(): void {
    endPick();
    releaseSpace();
  }

  /** Starts talking: a card when voice can't start here (each once a visit for a held key), the first-use card the first time, else listening. */
  function start(how: Mode, anchor: Point | null): void {
    if (state !== "idle" || !ready()) return;
    const r = readinessNow();
    switch (r.kind) {
      case "loading":
        // the server or the account is still being read: this press pans, and the buttons repaint once both are known
        void Promise.all([serverConfig(), userReady()]).then(([c]) => {
          cfg = c;
          paintMics();
        });
        return;
      case "ok":
        listen(how, anchor, r.engine);
        return;
      case "intro":
        showIntro(r.engine);
        return;
      default:
        // signed in in another tab: the next hold finds out
        if (r.kind === "signin") void refreshUser();
        // a held key says why once a visit and then just pans; the mic button says it each time
        if (how === "hold" && shown.has(r.kind)) return;
        shown.add(r.kind);
        showBlock(r);
    }
  }

  /** The card for why voice can't start: no accounts, no agent, no speech to text, signed out, or out of credit. */
  function showBlock(r: Block): void {
    switch (r.kind) {
      case "no-accounts":
        card({ tone: "info", title: BLOCK_TITLE["no-accounts"], body: "This copy of Rodeo has no account server, so voice commands are off here.", actions: [] }, INFO_MS);
        return;
      case "no-agent":
        card({ tone: "info", title: BLOCK_TITLE["no-agent"], body: "The agent isn't set up on this server, so voice commands are off here.", actions: [] }, INFO_MS);
        return;
      case "no-speech":
        card(
          {
            tone: "info",
            title: BLOCK_TITLE["no-speech"],
            body:
              support.browser === "firefox"
                ? "Firefox has no speech recognition of its own, and this server doesn't turn speech into text."
                : "This browser has no speech recognition, and this server doesn't turn speech into text.",
            actions: [{ label: "Settings…", run: () => void openVoiceSettings() }],
          },
          INFO_MS,
        );
        return;
      case "signin":
        card(
          {
            tone: "info",
            title: "Sign in to use voice commands",
            body: "Rodeo's agent carries out what you say, and it needs an account. Signing in is free.",
            actions: [signInAction()],
          },
          ERROR_MS,
        );
        return;
      case "credit":
        card(creditCard(r.terms, r.balance), ERROR_MS);
        return;
    }
  }

  /** The Sign In… button: signing in carries on from where voice stopped. */
  function signInAction(): UiAction {
    return {
      label: "Sign In…",
      primary: true,
      run: () => {
        pendingSignIn = true;
        void requireSignIn("Sign in to use voice commands");
      },
    };
  }

  /** The out-of-credit card, before anything is recorded. */
  function creditCard(terms: AiCreditTerms, balance: number): UiOutcome {
    return {
      tone: "info",
      title: "Add AI credit to use voice commands",
      body: `Rodeo's agent carries out what you say, using AI credit as the Agents panel does. You have ${formatCredit(balance, terms.currency)}, and a command needs ${formatCredit(terms.hold, terms.currency)} to start.`,
      actions: [],
      extra: topUpButtons(terms, (m) => toast(m)),
    };
  }

  /** The drawing's class and design layer names, for the server's model to spell. */
  function hintsNow(): string[] {
    const doc = store.session?.doc;
    if (!doc) return [];
    return speechHints([...doc.classes().map((c) => c.name), ...doc.layers().filter((l) => l.kind === "design").map((l) => l.name)]);
  }

  /** Listens with the browser's recogniser or the recorder (`eng`): the bubble opens at `anchor`, and clicks drop pins until the words are sent. */
  function listen(how: Mode, anchor: Point | null, eng: Engine): void {
    epoch++;
    mode = how;
    state = "listening";
    engine = eng;
    hearing = eng === "server" ? recorder : listener;
    speechCost = null;
    pins = [];
    heardLast = null;
    ui.setPins([]);
    const s = voiceSettings();
    const keys =
      how === "hold"
        ? `Release ${keyLabel(s.key)} to send · Esc cancels · Click to point`
        : "Tap the mic to send · Esc cancels · Click to point";
    ui.listen(anchor, keys);
    // the toggle and Right Option take the pan key, so clicks pin and drags pan (Space is already down for its hold)
    if (how === "toggle" || s.key === "AltRight") {
      ctx.controller.setSpace(true);
      spaceByVoice = true;
    }
    const v3 = ctx.view3d();
    if (v3) {
      pickedView = v3;
      savedPick = v3.onFacePick;
      v3.onFacePick = (hit) => addPin3d(hit);
    }
    maxTimer = window.setTimeout(() => {
      maxTimer = 0;
      send();
    }, MAX_LISTEN_MS);
    paintMics();
    // the meter is skipped in Safari, where a second capture clashes with the recogniser
    hearing.start({ lang: speechLang(s), onDevice: s.onDevice, meter: support.browser !== "safari", hints: eng === "server" ? hintsNow() : [] });
  }

  /** Listening failed: it stops, and the error is the card, with what can be done about it. */
  function failListening(kind: RecordError, message: string): void {
    if (state !== "listening" && state !== "sending") return;
    epoch++;
    hearing.abort();
    endExtras();
    const settings: UiAction = { label: "Settings…", run: () => void openVoiceSettings() };
    // Brave's (or another Chromium's) speech service didn't answer: Rodeo's server can do it instead
    if (kind === "network" && engine === "browser" && transcribeOn(cfg)) {
      if (support.browser === "brave") {
        saveVoiceSettings({ serviceFailed: true });
        const key = voiceSettings().key;
        card(
          {
            tone: "info",
            title: "Brave's speech service didn't answer",
            body: `Rodeo's server will turn your speech into text from now on, using a little AI credit each time. ${key === "none" ? "Tap the mic" : `Hold ${keyLabel(key)}`} and speak again.`,
            actions: [settings],
          },
          ERROR_MS,
        );
      } else {
        const useServer: UiAction = {
          label: "Use Rodeo's speech to text",
          primary: true,
          run: () => {
            saveVoiceSettings({ engine: "server" });
            card({ tone: "info", title: "Rodeo's server will turn your speech into text, using a little AI credit each time.", actions: [] }, INFO_MS);
          },
        };
        card({ tone: "error", title: message, actions: [useServer, settings] }, ERROR_MS);
      }
      paintMics();
      return;
    }
    const actions: UiAction[] = [];
    let extra: HTMLElement | undefined;
    if (kind === "language" || kind === "service") actions.push(settings);
    if (kind === "signin") actions.push(signInAction());
    if (kind === "credit") {
      const terms = creditTermsOf(cfg);
      if (terms) extra = topUpButtons(terms, (m) => toast(m));
      void refreshUser();
    }
    // the server's out-of-credit sentence names the agents; here it is about voice
    card({ tone: "error", title: kind === "credit" ? OUT_OF_CREDIT : message, actions, extra }, ERROR_MS);
    paintMics();
  }

  /** The key came up or the mic was tapped again: listening stops, and what was heard is read. */
  function send(): void {
    if (state !== "listening") {
      releaseSpace();
      return;
    }
    state = "sending";
    const my = epoch;
    endExtras();
    paintMics();
    void finish(my);
  }

  /** Reads the words once the recogniser has let go of them, or the server has turned the recording into text, and sends them to the agent. */
  async function finish(my: number): Promise<void> {
    const heard = await hearing.finish();
    if (my !== epoch || state !== "sending") return;
    if (engine === "server") {
      speechCost = recorder.charge?.charged ?? null;
      // the balance moved: read it again for the agent's gate
      if (speechCost) await refreshUser();
      if (my !== epoch || state !== "sending") return;
    }
    const text = (heard.alternatives.find((t) => t.trim() !== "") ?? heard.final).trim();
    if (!text) {
      if (speechCost) {
        card({ tone: "info", title: "No words were heard.", hint: hintOf(costHint(0)), actions: [] }, INFO_MS);
        return;
      }
      ui.hide();
      idle();
      return;
    }
    void agent(text);
  }

  /** The card's cost line: what the speech to text and the agent took ("" when nothing, or free). */
  function costHint(agentCost: number): string {
    return costLine(speechCost, agentCost, creditTermsOf(cfg)?.currency ?? null, formatCredit);
  }

  /** Joins the card's hints ("⌘Z undoes it · Agent £0.01"); undefined when there are none. */
  function hintOf(...parts: (string | undefined)[]): string | undefined {
    return parts.filter((p): p is string => !!p).join(" · ") || undefined;
  }

  /** The Undo button on a result card: one step back, then a short "Undone.". */
  function undoAction(): UiAction {
    return {
      label: "Undo",
      run: () => {
        undo();
        card({ tone: "info", title: "Undone.", actions: [] }, INFO_MS);
      },
    };
  }

  // ---- the agent ----------------------------------------------------------------------------

  /** The view as the agent is told it: the 3D view, or the plan's visible range in millimetres. */
  function viewLine(): string {
    if (store.view3d && ctx.view3d()) return "the 3D view";
    const { width, height } = ctx.view;
    const corners = [ctx.view.toWorld(0, 0), ctx.view.toWorld(width, 0), ctx.view.toWorld(0, height), ctx.view.toWorld(width, height)];
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    let line = `the plan, showing x ${mm(Math.min(...xs))} to ${mm(Math.max(...xs))} and y ${mm(Math.min(...ys))} to ${mm(Math.max(...ys))} mm`;
    if (ctx.view.rotation !== 0) line += `, turned ${Math.round((ctx.view.rotation * 180) / Math.PI)}°`;
    return line;
  }

  /** What the agent is told: the words, the selection, the pins, the view and what the pointing words point at. */
  function askInput(text: string): AskInput {
    const doc = store.session?.doc ?? null;
    const selection: AskSubject[] = [];
    for (const id of store.selection) {
      const o = doc?.object(id);
      if (!doc || !o) continue;
      // the agent names the first few; the rest are counted, so they get no label
      if (selection.length >= NAMED) {
        selection.push({ id, label: "", className: "", layerName: "" });
        continue;
      }
      const name = o.name ? ` "${o.name}"` : "";
      selection.push({ id, label: `${objectNoun(doc, o)}${name}`, className: o.className, layerName: layerInfo(o.layerId)?.name ?? "" });
    }
    const pointing = pointingLines(readWords(text, wordOptions()));
    return { transcript: capitalise(text), selection, pins, view: viewLine(), pointing };
  }

  /** Sends the words to the agent after the gate (the server, sign-in and credit), then shows its reply and what it cost, with Undo when it made one step. */
  async function agent(text: string): Promise<void> {
    const my = epoch;
    state = "sending";
    const gate = await agentGate(voiceSettings().agentModel);
    if (my !== epoch) return;
    // what the speech took so far is shown on the gate's cards too
    const spent = hintOf(costHint(0));
    if (gate.kind === "none") {
      card({ tone: "info", title: gate.message, hint: spent, actions: [] }, INFO_MS);
      return;
    }
    if (gate.kind === "signin") {
      card({ tone: "info", title: gate.message, hint: spent, actions: [signInAction()] }, ERROR_MS);
      return;
    }
    if (gate.kind === "credit") {
      card({ tone: "info", title: gate.message, hint: spent, actions: [], extra: topUpButtons(gate.terms, (m) => toast(m)) }, ERROR_MS);
      return;
    }
    const s = store.session;
    if (!s) {
      ui.hide();
      idle();
      return;
    }
    state = "busy";
    paintMics();
    const ctl = new AbortController();
    run = ctl;
    ui.working("Asking the agent…", stop, capitalise(text));
    const depth = s.undoDepth;
    // a change from someone else, or an undo or redo during the run, means the run's steps can't be joined
    let broken = false;
    const off = s.onChange((e) => {
      if (e.origin) broken = true;
    });
    const end = await askAgent(askInput(text), gate.settings, ctl.signal, { status: (t) => ui.status(t) });
    off();
    run = null;

    const same = store.session === s;
    const edits = same ? s.undoDepth - depth : 0;
    let undoable = false;
    if (same && edits > 0 && !broken) {
      if (edits > 1) s.joinSince(depth);
      undoable = s.undoDepth - depth === 1;
    }
    const z = IS_MAC ? "⌘Z" : "Ctrl+Z";
    const undoHint = undoable ? `${z} undoes it` : edits > 0 ? `${z} undoes the agent's changes one at a time` : undefined;
    const hint = hintOf(undoHint, costHint(end.cost));
    const undo1: UiAction[] = undoable ? [undoAction()] : [];

    if (end.stopped) {
      card({ tone: "info", title: "Stopped.", hint, actions: undo1 }, DONE_MS);
      paintMics();
      return;
    }
    if (end.error) {
      const actions: UiAction[] = [...undo1];
      let extra: HTMLElement | undefined;
      if (end.errorCode === "unauthorized") {
        actions.push(signInAction());
      }
      if (end.errorCode === "credit") {
        // the balance has moved: read it again, then offer the top-up
        await refreshUser();
        const terms = (await serverConfig())?.ai?.credit;
        if (terms) extra = topUpButtons(terms, (m) => toast(m));
      }
      card({ tone: "error", title: end.errorCode === "credit" ? OUT_OF_CREDIT : end.error, hint, actions, extra }, ERROR_MS);
      paintMics();
      return;
    }
    const reply = replyText(end.reply);
    const open: UiAction = { label: "Continue in Agents", run: () => void openThread(end.threadId) };
    card(
      { tone: "agent", title: reply.title || "Done.", body: reply.body || undefined, hint, actions: [...undo1, open] },
      AGENT_MS,
    );
    paintMics();
  }

  /** Opens the voice conversation in the Agents panel; if it is not there, the panel is shown and the user is told where to look. */
  async function openThread(id: string): Promise<void> {
    const panel = await import("../agents/panel.ts");
    if (await panel.openAgentsThread(id)) return;
    ctx.palettes.show("agents");
    toast("Pick the voice conversation from the Agents panel's list.", "info");
  }

  /** Stops the agent's run; its edits so far stay, and its card says "Stopped.". */
  function stop(): void {
    run?.abort();
  }

  // ---- cancel, dismiss, drags -----------------------------------------------------------------

  /** Abandons listening, the first-use card or a pending send: nothing is sent, the pins go. */
  function cancel(): void {
    if (state === "busy") return;
    epoch++;
    hearing.abort();
    endExtras();
    ui.hide();
    idle();
  }

  /** Closes a result card: Escape, the voice key, or a new start. */
  function dismiss(): void {
    if (state !== "outcome") return;
    ui.hide();
    idle();
  }

  /** A drag while the key is held, with nothing said and no pins, is a pan: the bubble goes quietly and the key stays down for it. */
  function dragged(): void {
    if (state !== "listening" || mode !== "hold" || hearing.heardSomething || pins.length > 0) return;
    // the Space the voice pressed (Right Option) stays down: the pan goes on until the key comes up
    endPick();
    hearing.abort();
    ui.hide();
    idle();
  }

  // ---- the first-use card and the mic ---------------------------------------------------------

  /** The first-use card: what voice does, where the speech goes, and whether to turn it on. */
  function showIntro(eng: Engine): void {
    state = "intro";
    const s = voiceSettings();
    void onDeviceStatus(speechLang(s)).then((status) => {
      if (state !== "intro") return;
      const onDevice = eng === "browser" && s.onDevice && status === "available";
      const first =
        s.key === "none"
          ? "Tap the mic, say what to do, and tap it again. Click while you speak to point at things and places: “move this here”."
          : `Hold ${keyLabel(s.key)}, say what to do, and let go. Click while you speak to point at things and places: “move this here”.`;
      const terms = creditTermsOf(cfg);
      const lines = privacyLines({
        browser: support.browser,
        engine: eng,
        onDevice,
        by: cfg?.voice?.by ?? null,
        under: terms ? formatCredit(0.01, terms.currency) : null,
      });
      const tip = micTip(support.browser, eng);
      ui.intro("Talk to Rodeo", [first, ...lines, ...(tip ? [tip] : [])], [
        { label: "Turn on voice", primary: true, run: () => void turnOn() },
        { label: "Not now", run: notNow },
      ]);
    });
  }

  /** The first-use card's "Turn on voice": asks for the microphone now, from the click, and turns voice on (or says credit is needed first). */
  async function turnOn(): Promise<void> {
    await warmMicrophone();
    saveVoiceSettings({ introSeen: true, enabled: true });
    if (state !== "intro") return;
    const r = readinessNow();
    if (r.kind === "credit") {
      card(creditCard(r.terms, r.balance), ERROR_MS);
      return;
    }
    const key = voiceSettings().key;
    card(
      { tone: "info", title: key === "none" ? "Voice is on. Tap the mic and speak." : `Voice is on. Hold ${keyLabel(key)} and speak.`, actions: [] },
      INFO_MS,
    );
  }

  /** The first-use card's "Not now": voice is turned off, and Tools › Voice Commands… turns it back on. */
  function notNow(): void {
    saveVoiceSettings({ introSeen: true, enabled: false });
    card({ tone: "info", title: "Voice is off. Tools › Voice Commands… turns it on.", actions: [] }, DONE_MS);
  }

  /** A press on a microphone button: start in toggle mode, stop the agent, send, or send a hold on release. */
  function micPress(m: MicButton, down: boolean): void {
    if (!down) {
      if (micHeld !== null) clearTimeout(micHeld);
      micHeld = null;
      if (state === "listening" && mode === "toggle" && Date.now() - pressAt >= MIC_HOLD_MS) send();
      return;
    }
    if (state === "busy") {
      stop();
      return;
    }
    if (state === "listening") {
      if (mode === "toggle") send();
      return;
    }
    if (state !== "idle" && state !== "outcome") return;
    if (store.session === null) {
      card({ tone: "info", title: "Open a drawing to talk to it.", actions: [] }, INFO_MS);
      return;
    }
    if (state === "outcome") {
      ui.hide();
      idle();
    }
    pressAt = Date.now();
    start("toggle", anchorOf(m));
    // still pressed once it counts as a hold: letting go sends, so the foot says that instead of tapping
    micHeld = setTimeout(() => {
      micHeld = null;
      if (state === "listening" && mode === "toggle") ui.setKeys("Let go to send · Esc cancels · Click to point");
    }, MIC_HOLD_MS);
  }

  // ---- wiring -------------------------------------------------------------------------------

  for (const m of mics) {
    m.onPress = (down) => micPress(m, down);
    m.setKey(keyLabel(voiceSettings().key));
  }
  // a card that closes itself (its timer, or a press outside it) leaves the idle state
  ui.onClose = () => {
    if (state === "outcome") idle();
  };
  paintMics();

  // the server's config decides what voice can do here; the buttons repaint once it and the account are known
  void serverConfig().then((c) => {
    cfg = c;
    paintMics();
  });
  void userReady().then(() => paintMics());

  // signing in carries on from a sign-in card: the first-use card, the credit card, or "Hold Space and speak"
  onUser((u) => {
    paintMics();
    if (!u || !pendingSignIn) return;
    pendingSignIn = false;
    if (state !== "idle" && state !== "outcome") return;
    const r = readinessNow();
    if (r.kind === "intro") {
      showIntro(r.engine);
    } else if (r.kind === "credit") {
      card(creditCard(r.terms, r.balance), ERROR_MS);
    } else if (r.kind === "ok") {
      const key = voiceSettings().key;
      card(
        { tone: "info", title: key === "none" ? "You're signed in. Tap the mic and speak." : `You're signed in. Hold ${keyLabel(key)} and speak.`, actions: [] },
        INFO_MS,
      );
    }
  });

  // a different drawing ends a listening and starts a new voice conversation (the same drawing's saves don't)
  store.on("session", () => {
    if (store.session === lastSession) return;
    lastSession = store.session;
    forgetVoiceThread();
    if (state === "listening") cancel();
    else if (state === "outcome") dismiss();
  });

  onVoiceSettings((s) => {
    if (!s.enabled && (state === "listening" || state === "sending")) cancel();
    for (const m of mics) m.setKey(keyLabel(s.key));
    paintMics();
  });

  // the editor's own Space keyup clears Space-pan, and it runs after this listener: a Space tapped
  // while the voice holds the pan key puts it back once the editor has let go
  window.addEventListener("keyup", (e) => {
    if (e.code !== "Space" || !spaceByVoice) return;
    window.setTimeout(() => {
      if (spaceByVoice) ctx.controller.setSpace(true);
    }, 0);
  });

  installGesture(ctx, {
    ready,
    state: gestureState,
    start: (anchor) => start("hold", anchor),
    send,
    cancel,
    stop,
    dismiss,
    click2d,
    dragged,
    unpin,
  });
}
