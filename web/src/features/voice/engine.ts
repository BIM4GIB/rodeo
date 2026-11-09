// Which speech to text a voice command uses, and whether voice can start at all: the browser's own
// recogniser (listen.ts) or Rodeo's server (record.ts); the account, the agent and the credit every
// command needs; and the sentences that say so (privacy, cost, the microphone tip). DOM-free, so
// engine.check.ts runs it in node.

import type { AiCreditTerms, ServerConfig } from "../../platform/protocol.ts";
import type { Support, VoiceSettings } from "./settings.ts";

/** Who turns speech into text: this browser's recogniser, or Rodeo's server. */
export type Engine = "browser" | "server";
/** The setting: automatic (the browser's where it has one that works), or one of them. */
export type EngineSetting = "auto" | Engine;

/** The server has sign-in: email links, or a provider. */
export function accountsOn(cfg: ServerConfig | null | undefined): boolean {
  return !!cfg && (cfg.auth.email || cfg.auth.oauth.length > 0);
}

/** The server turns recordings into text (POST /api/voice/transcribe). */
export function transcribeOn(cfg: ServerConfig | null | undefined): boolean {
  return cfg?.voice?.transcribe === true;
}

/** The agent's credit terms, or null when the agent is free (or not set up). */
export function creditTermsOf(cfg: ServerConfig | null | undefined): AiCreditTerms | null {
  return cfg?.ai?.credit ?? null;
}

/** Who turns this command's speech into text; null when nobody can here. */
export function chooseEngine(setting: EngineSetting, recognition: boolean, serviceFailed: boolean, transcribe: boolean): Engine | null {
  const wantServer = setting === "server" || (setting === "auto" && (!recognition || serviceFailed));
  if (wantServer && transcribe) return "server";
  if (recognition) return "browser";
  return transcribe ? "server" : null;
}

/** What readiness() reads. */
export interface Situation {
  readonly support: Pick<Support, "recognition">;
  readonly settings: Pick<VoiceSettings, "engine" | "serviceFailed" | "introSeen">;
  /** the server's config: undefined while it loads, null with no server */
  readonly config: ServerConfig | null | undefined;
  /** the signed-in user: undefined until known, null when signed out */
  readonly user: { readonly aiCredit: number | null } | null | undefined;
}

/** Whether voice can start now, and if not, why; with the engine once it can. */
export type Readiness =
  | { readonly kind: "loading" }
  | { readonly kind: "no-accounts" }
  | { readonly kind: "no-agent" }
  | { readonly kind: "no-speech" }
  | { readonly kind: "signin" }
  | { readonly kind: "intro"; readonly engine: Engine }
  | { readonly kind: "credit"; readonly engine: Engine; readonly terms: AiCreditTerms; readonly balance: number }
  | { readonly kind: "ok"; readonly engine: Engine };

/** Whether voice can start, in this order: the server, sign-in at all, the agent, speech to text, the user, the first-use card, the credit. */
export function readiness(s: Situation): Readiness {
  const cfg = s.config;
  if (cfg === undefined) return { kind: "loading" };
  if (!cfg || !accountsOn(cfg)) return { kind: "no-accounts" };
  if (!cfg.ai) return { kind: "no-agent" };
  const engine = chooseEngine(s.settings.engine, s.support.recognition, s.settings.serviceFailed, transcribeOn(cfg));
  if (!engine) return { kind: "no-speech" };
  if (s.user === undefined) return { kind: "loading" };
  if (!s.user) return { kind: "signin" };
  if (!s.settings.introSeen) return { kind: "intro", engine };
  const terms = creditTermsOf(cfg);
  const balance = s.user.aiCredit ?? 0;
  if (terms && balance < terms.hold) return { kind: "credit", engine, terms, balance };
  return { kind: "ok", engine };
}

/** What the privacy sentences depend on. */
export interface PrivacyInput {
  readonly browser: Support["browser"];
  readonly engine: Engine;
  /** the browser recognises speech on this computer */
  readonly onDevice: boolean;
  /** who turns speech into text on the server ("Google, through OpenRouter"), from the config */
  readonly by: string | null;
  /** a small amount in the credit's currency ("£0.01"); null when speech to text is free here */
  readonly under: string | null;
}

/** The privacy sentences for the first-use card and the settings dialog. */
export function privacyLines(p: PrivacyInput): string[] {
  const lines: string[] = [];
  if (p.engine === "server") {
    lines.push(
      `While you hold the key, this browser records your voice and sends it to Rodeo's server, which has an AI model turn it into text (${p.by ?? "an AI model provider"}). The names of the drawing's classes and layers go with it, so they're spelled right.`,
    );
    lines.push(
      `Rodeo doesn't keep the recording: it's passed on once and dropped. ${p.under ? `Turning it into text uses a little AI credit, usually under ${p.under}.` : "Turning it into text is free on this server."}`,
    );
  } else {
    if (p.onDevice) {
      lines.push("Speech is recognised on this computer: your voice doesn't leave it.");
    } else {
      switch (p.browser) {
        case "chrome":
          lines.push("Chrome sends your voice to Google to turn it into text while you hold the key.");
          break;
        case "edge":
          lines.push("Edge sends your voice to Microsoft to turn it into text while you hold the key.");
          break;
        case "safari":
          lines.push("Safari turns your voice into text with Apple's speech recognition, on this device or on Apple's servers.");
          break;
        default:
          lines.push("Your browser's speech service turns your voice into text while you hold the key.");
      }
    }
    lines.push("Rodeo gets only the words, and never records or keeps your voice.");
  }
  lines.push(
    "Rodeo's agent then does what you said: your words, the selected objects and the points you clicked go to it as an Agents panel message does, and it uses AI credit as the panel does.",
  );
  return lines;
}

/** The card's cost line: "Speech and agent £0.02", "Agent £0.01", "Speech to text <£0.01"; "" when nothing was charged. */
export function costLine(speech: number | null, agent: number, currency: string | null, format: (n: number, currency: string) => string): string {
  if (!currency) return "";
  const s = speech ?? 0;
  if (s > 0 && agent > 0) return `Speech and agent ${format(s + agent, currency)}`;
  if (s > 0) return `Speech to text ${format(s, currency)}`;
  if (agent > 0) return `Agent ${format(agent, currency)}`;
  return "";
}

/** The drawing's class and layer names for the server's model to spell: trimmed, no "None", no repeats, at most 80 of 64 characters. */
export function speechHints(names: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim().slice(0, 64);
    const key = name.toLowerCase();
    if (!name || key === "none" || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 80) break;
  }
  return out;
}

/** Firefox asks for the microphone each time unless told to remember: the tip that says so, or null. */
export function micTip(browser: Support["browser"], engine: Engine): string | null {
  return browser === "firefox" && engine === "server"
    ? "When Firefox asks for the microphone, tick “Remember this decision”, or it asks again each time you speak."
    : null;
}
