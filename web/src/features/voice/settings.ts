// Voice commands' settings, kept in this browser: whether voice is on, the key held to talk, the
// speech language, which model the agent uses, on-device recognition, who turns speech into text,
// and whether the first-use card has been answered. Also what this browser does with the voice
// (its name, and who turns speech into text there), and the dialog itself: Tools › Voice Commands….

import { h } from "../../app/dom.ts";
import { IS_MAC } from "../../app/menu.ts";
import { showDialog } from "../../app/menubar.ts";
import { currentUser, serverConfig } from "../../platform/api.ts";
import { formatCredit } from "../account/credit.ts";
import { accountsOn, chooseEngine, creditTermsOf, micTip, privacyLines, transcribeOn, type Engine, type EngineSetting } from "./engine.ts";
import { installOnDevice, onDeviceStatus, recognitionAvailable, type OnDevice } from "./listen.ts";

/** The key held to talk: Space, the right Option or Alt key, or none (the mic button only). */
export type VoiceKey = "Space" | "AltRight" | "none";

/** The voice settings, saved in this browser. */
export interface VoiceSettings {
  /** voice commands are on: holding the key listens */
  readonly enabled: boolean;
  /** the key held to talk ("none": the mic button only) */
  readonly key: VoiceKey;
  /** BCP 47, or "" for the browser's language */
  readonly lang: string;
  /** the agent's model for voice: the fast one, or the Agents panel's */
  readonly agentModel: "fast" | "full";
  /** recognise speech on this device where the browser can */
  readonly onDevice: boolean;
  /** who turns speech into text: automatic, this browser, or Rodeo's server */
  readonly engine: EngineSetting;
  /** this browser's speech service failed (Brave): automatic uses Rodeo's server from now on */
  readonly serviceFailed: boolean;
  /** the first-use card has been answered */
  readonly introSeen: boolean;
}

/** The settings a new visit starts with: voice on, Space to talk, the browser's language, the fast model. */
export const DEFAULT_VOICE: VoiceSettings = { enabled: true, key: "Space", lang: "", agentModel: "fast", onDevice: true, engine: "auto", serviceFailed: false, introSeen: false };

/** What the browser can do for voice, as voiceSupport() reads it. */
export interface Support {
  /** the browser has speech recognition */
  readonly recognition: boolean;
  readonly browser: "chrome" | "edge" | "safari" | "firefox" | "brave" | "other";
  /** who turns speech into text: "Google", "Microsoft", "Apple", or "your browser's speech service" */
  readonly service: string;
}

/** The languages the settings offer, by BCP 47 code. */
export const SPEECH_LANGS: readonly { readonly code: string; readonly name: string }[] = [
  { code: "en-GB", name: "English (UK)" },
  { code: "en-US", name: "English (US)" },
  { code: "en-AU", name: "English (Australia)" },
  { code: "en-IE", name: "English (Ireland)" },
  { code: "en-IN", name: "English (India)" },
  { code: "en-NZ", name: "English (New Zealand)" },
  { code: "de-DE", name: "Deutsch" },
  { code: "fr-FR", name: "Français" },
  { code: "es-ES", name: "Español" },
  { code: "it-IT", name: "Italiano" },
  { code: "nl-NL", name: "Nederlands" },
  { code: "pt-BR", name: "Português (Brasil)" },
  { code: "pt-PT", name: "Português" },
  { code: "sv-SE", name: "Svenska" },
  { code: "da-DK", name: "Dansk" },
  { code: "nb-NO", name: "Norsk" },
  { code: "fi-FI", name: "Suomi" },
  { code: "pl-PL", name: "Polski" },
  { code: "ja-JP", name: "日本語" },
  { code: "zh-CN", name: "中文" },
  { code: "ko-KR", name: "한국어" },
];

/** The examples the settings dialog lists under "Try saying". */
const EXAMPLES = [
  "Move this here",
  "Copy these three times along here, 1200 apart",
  "Rotate this 90",
  "Make it red",
  "Put these in the A-Wall class",
  "Make that wall 200 thicker",
  "What's on this layer?",
];

const STORAGE_KEY = "openvwx.voice.v1";

/** The settings in use; kept for the visit even where storage is blocked. */
let current: VoiceSettings | null = null;
const listeners = new Set<(s: VoiceSettings) => void>();

/** Whether `v` is a key the settings know. */
function isKey(v: unknown): v is VoiceKey {
  return v === "Space" || v === "AltRight" || v === "none";
}

/** The settings as stored, each field checked; a missing or wrong one takes its default. */
function load(): VoiceSettings {
  const d = DEFAULT_VOICE;
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Record<keyof VoiceSettings, unknown>> | null;
    return {
      enabled: typeof raw?.enabled === "boolean" ? raw.enabled : d.enabled,
      key: isKey(raw?.key) ? raw.key : d.key,
      lang: typeof raw?.lang === "string" ? raw.lang : d.lang,
      agentModel: raw?.agentModel === "full" ? "full" : d.agentModel,
      onDevice: typeof raw?.onDevice === "boolean" ? raw.onDevice : d.onDevice,
      engine: raw?.engine === "browser" || raw?.engine === "server" ? raw.engine : d.engine,
      serviceFailed: typeof raw?.serviceFailed === "boolean" ? raw.serviceFailed : d.serviceFailed,
      introSeen: typeof raw?.introSeen === "boolean" ? raw.introSeen : d.introSeen,
    };
  } catch {
    return { ...d };
  }
}

/** The voice settings as they are now. */
export function voiceSettings(): VoiceSettings {
  return (current ??= load());
}

/** Sets and keeps some of the voice settings, and tells those listening. */
export function saveVoiceSettings(change: Partial<VoiceSettings>): VoiceSettings {
  const next: VoiceSettings = { ...voiceSettings(), ...change };
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the settings last this visit
  }
  for (const fn of [...listeners]) fn(next);
  return next;
}

/** Calls `fn` with the settings whenever they are saved; returns a function that stops it. */
export function onVoiceSettings(fn: (s: VoiceSettings) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The language speech is recognised in: the setting, else the browser's, else en-GB. */
export function speechLang(s: VoiceSettings = voiceSettings()): string {
  return s.lang || navigator.language || "en-GB";
}

/** What this browser offers for voice: speech recognition, which browser it is, and who turns speech into text. */
export function voiceSupport(): Support {
  const ua = navigator.userAgent;
  const browser: Support["browser"] = (navigator as Navigator & { brave?: unknown }).brave
    ? "brave"
    : /Edg\//.test(ua)
      ? "edge"
      : /Firefox\//.test(ua)
        ? "firefox"
        : /Chrome\//.test(ua)
          ? "chrome"
          : /Safari\//.test(ua)
            ? "safari"
            : "other";
  // Brave runs Chrome's speech service, so it is named after Google too
  const service =
    browser === "chrome" || browser === "brave"
      ? "Google"
      : browser === "edge"
        ? "Microsoft"
        : browser === "safari"
          ? "Apple"
          : "your browser's speech service";
  return { recognition: recognitionAvailable(), browser, service };
}

/** "Space", "Right ⌥ Option" (Mac) or "Right Alt", or "the mic button". */
export function keyLabel(key: VoiceKey): string {
  if (key === "AltRight") return IS_MAC ? "Right ⌥ Option" : "Right Alt";
  return key === "Space" ? "Space" : "the mic button";
}

/** What the dialog says about on-device speech, by the browser's status. */
const DEVICE_TEXT: Record<OnDevice, string> = {
  available: "Ready: speech stays on this computer.",
  downloadable: "Needs a one-time download.",
  downloading: "Downloading…",
  unavailable: "Not available for this language.",
  unsupported: "",
};

/** Tools › Voice Commands…: the settings dialog. Saves what the user changed. */
export async function openVoiceSettings(): Promise<void> {
  const s = voiceSettings();
  const support = voiceSupport();
  const cfg = await serverConfig();
  const transcribe = transcribeOn(cfg);
  const terms = creditTermsOf(cfg);
  let ready = false;

  const check = (on: boolean, label: string): [HTMLInputElement, HTMLElement] => {
    const box = h("input", { checked: on, attrs: { type: "checkbox" } });
    return [box, h("label", { cls: "menu-dialog-check" }, box, label)];
  };
  const field = (label: string, control: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
  const note = (text: string): HTMLElement => h("p", { cls: "voice-set-note", text });
  const select = (label: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement => {
    const el = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } },
      ...options.map(([v, text]) => h("option", { value: v, text })),
    );
    el.value = value;
    return el;
  };

  const [enabled, enabledRow] = check(s.enabled, "Voice commands");
  const key = select(
    "Hold to talk",
    [
      ["Space", "Space (hold still)"],
      ["AltRight", keyLabel("AltRight")],
      ["none", "Mic button only"],
    ],
    s.key,
  );
  const lang = select(
    "Language",
    [["", `Browser language (${navigator.language})`], ...SPEECH_LANGS.map((l) => [l.code, l.name] as const)],
    s.lang,
  );
  const engine = select(
    "Speech to text",
    [
      ["auto", "Automatic"],
      ["browser", `This browser (${support.service})`],
      ["server", "Rodeo's server (uses AI credit)"],
    ],
    s.engine,
  );
  // a choice this browser or this server can't make is greyed out
  for (const o of Array.from(engine.options)) {
    if (o.value === "browser") o.disabled = !support.recognition;
    if (o.value === "server") o.disabled = !transcribe;
  }
  const engineNote = note(
    transcribe
      ? "Automatic uses this browser's speech recognition where it has one, and Rodeo's server where it doesn't (Firefox, or when Brave's service fails). Rodeo's server takes a little AI credit for each recording."
      : "This server doesn't turn speech into text, so voice needs a browser with speech recognition.",
  );
  const model = select(
    "Agent model",
    [
      ["fast", "Fast (quick replies, less credit)"],
      ["full", "The Agents panel's model (slower, stronger)"],
    ],
    s.agentModel,
  );

  // on-device recognition: shown only where the browser can say, and only for the browser's speech
  const [onDevice, onDeviceRow] = check(s.onDevice, "Recognise speech on this computer when it can");
  const deviceStatus = note("");
  const download = h("button", { cls: "btn", text: "Download", attrs: { type: "button" }, hidden: true });
  const device = h("div", { cls: "voice-set-device", hidden: true }, onDeviceRow, deviceStatus, download);
  const privacy = h("div", { cls: "voice-set-privacy" });

  const settingNow = (): EngineSetting => (engine.value === "browser" || engine.value === "server" ? engine.value : "auto");
  const engineNow = (): Engine => {
    const setting = settingNow();
    return chooseEngine(setting, support.recognition, setting === "browser" ? false : s.serviceFailed, transcribe) ?? "browser";
  };
  const renderPrivacy = (): void => {
    const eng = engineNow();
    // the browser's on-device speech means nothing when the server turns speech into text
    if (eng === "server") device.hidden = true;
    const lines = privacyLines({
      browser: support.browser,
      engine: eng,
      onDevice: eng === "browser" && onDevice.checked && ready,
      by: cfg?.voice?.by ?? null,
      under: terms ? formatCredit(0.01, terms.currency) : null,
    });
    const tip = micTip(support.browser, eng);
    privacy.replaceChildren(...[...lines, ...(tip ? [tip] : [])].map((t) => note(t)));
  };
  const langNow = (): string => speechLang({ ...s, lang: lang.value });
  let seq = 0;
  const paint = async (): Promise<void> => {
    const mine = ++seq;
    const status = await onDeviceStatus(langNow());
    if (mine !== seq) return;
    ready = status === "available";
    device.hidden = status === "unsupported";
    deviceStatus.textContent = DEVICE_TEXT[status];
    download.hidden = status !== "downloadable";
    renderPrivacy();
  };
  download.addEventListener("click", () => {
    download.disabled = true;
    download.textContent = "Downloading…";
    void installOnDevice(langNow()).then(() => {
      download.disabled = false;
      download.textContent = "Download";
      void paint();
    });
  });
  lang.addEventListener("change", () => void paint());
  engine.addEventListener("change", () => void paint());
  onDevice.addEventListener("change", renderPrivacy);
  void paint();

  const top: Node[] = [];
  if (!support.recognition) {
    top.push(
      note(
        transcribe
          ? "This browser has no speech recognition, so Rodeo's server turns your speech into text, using a little AI credit."
          : "Voice commands need Chrome, Edge or Safari: this browser has no speech recognition, and this server doesn't turn speech into text.",
      ),
    );
  }
  if (!accountsOn(cfg)) top.push(note("Voice commands need a Rodeo account, and this copy of Rodeo has no account server."));
  else if (!cfg?.ai) top.push(note("Voice commands need Rodeo's agent, which isn't set up on this server."));
  else if (!currentUser()) top.push(note("Sign in to use voice commands."));

  const body: Node[] = [
    ...top,
    enabledRow,
    field("Hold to talk", key),
    field("Language", lang),
    field("Speech to text", engine),
    engineNote,
    field("Agent model", model),
    device,
    privacy,
    h("p", { cls: "menu-dialog-label", text: "Try saying" }),
    h("ul", { cls: "voice-set-examples" }, ...EXAMPLES.map((t) => h("li", { text: t }))),
  ];

  const next = await showDialog<Partial<VoiceSettings>>({
    title: "Voice Commands",
    okLabel: "Save",
    cls: "voice-settings",
    body,
    check: () => {
      const chosen = settingNow();
      return {
        value: {
          enabled: enabled.checked,
          key: isKey(key.value) ? key.value : s.key,
          lang: lang.value,
          agentModel: model.value === "full" ? "full" : "fast",
          onDevice: onDevice.checked,
          engine: chosen,
          // choosing the browser's speech again is a fresh try of its service
          serviceFailed: chosen === "browser" ? false : s.serviceFailed,
          // turning voice on here counts as having read what it does
          introSeen: s.introSeen || (enabled.checked && !s.enabled),
        },
      };
    },
  });
  if (next) saveVoiceSettings(next);
}
