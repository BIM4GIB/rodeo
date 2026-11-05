// Checks voice's engine choice, readiness, privacy and cost lines (engine.ts) in node.
//
//   cd web && npx tsx src/features/voice/engine.check.ts

import type { AiCreditTerms, ServerConfig } from "../../platform/protocol.ts";
import {
  accountsOn,
  chooseEngine,
  costLine,
  creditTermsOf,
  micTip,
  privacyLines,
  readiness,
  speechHints,
  transcribeOn,
  type Engine,
  type EngineSetting,
  type PrivacyInput,
  type Readiness,
  type Situation,
} from "./engine.ts";

const terms = { currency: "gbp", topups: [5], hold: 0.25, markup: 1.3, plusMarkup: 1.15, sold: true } as unknown as AiCreditTerms;
const cfg = (over: Record<string, unknown> = {}) =>
  ({ auth: { email: true, oauth: [] }, ai: { planner: "p", worker: "w", models: [], credit: terms }, voice: { transcribe: true, by: "Google, through OpenRouter" }, ...over }) as unknown as ServerConfig;
const set = (over = {}) => ({ engine: "auto", serviceFailed: false, introSeen: true, ...over }) as Situation["settings"];

/** A situation: a server with everything, a signed-in user with credit, and recognition on or off in the browser. */
function situation(recognition: boolean, over: Partial<Omit<Situation, "support">> = {}): Situation {
  return { support: { recognition }, settings: set(), config: cfg(), user: { aiCredit: 5 }, ...over };
}

/** A readiness as "kind", or "kind engine" when it has an engine, for the check lines. */
function kindOf(r: Readiness): string {
  return "engine" in r ? `${r.kind} ${r.engine}` : r.kind;
}

/** Runs every engine check, printing one line each; returns how many failed. */
export function checkEngine(): number {
  let failures = 0;
  const expect = (label: string, ok: boolean, detail = ""): void => {
    console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
    if (!ok) failures++;
  };

  // setting, browser recognition, its service failed, server transcribes, the engine
  const ENGINE: readonly (readonly [EngineSetting, boolean, boolean, boolean, Engine | null])[] = [
    ["auto", true, false, true, "browser"],
    ["auto", true, true, true, "server"],
    ["auto", true, true, false, "browser"],
    ["auto", false, false, true, "server"],
    ["auto", false, false, false, null],
    ["browser", false, false, true, "server"],
    ["browser", true, true, true, "browser"],
    ["server", true, false, false, "browser"],
    ["server", true, false, true, "server"],
  ];
  for (const [setting, recognition, failed, transcribe, want] of ENGINE) {
    const got = chooseEngine(setting, recognition, failed, transcribe);
    expect(`engine: ${setting}, recognition ${recognition}, service failed ${failed}, server ${transcribe}`, got === want, `got ${got}`);
  }

  const READY: readonly (readonly [string, Situation, string])[] = [
    ["no config yet is loading", situation(true, { config: undefined }), "loading"],
    ["no server is no accounts", situation(true, { config: null }), "no-accounts"],
    ["no email and no provider is no accounts", situation(true, { config: cfg({ auth: { email: false, oauth: [] } }) }), "no-accounts"],
    ["a provider alone is enough", situation(true, { config: cfg({ auth: { email: false, oauth: ["google"] } }) }), "ok browser"],
    ["no agent is no agent", situation(true, { config: cfg({ ai: null }) }), "no-agent"],
    ["no recognition and voice null is no speech", situation(false, { config: cfg({ voice: null }) }), "no-speech"],
    ["no recognition and voice missing is no speech", situation(false, { config: cfg({ voice: undefined }) }), "no-speech"],
    ["user not known yet is loading", situation(true, { user: undefined }), "loading"],
    ["signed out is sign-in", situation(true, { user: null }), "signin"],
    ["first use not answered is intro", situation(true, { settings: set({ introSeen: false }) }), "intro browser"],
    ["no recognition uses the server", situation(false), "ok server"],
    ["credit below the hold is credit", situation(true, { user: { aiCredit: 0.1 } }), "credit browser"],
    ["credit at the hold is ok", situation(true, { user: { aiCredit: 0.25 } }), "ok browser"],
    ["credit not sold is ok with no balance", situation(true, { config: cfg({ ai: { planner: "p", worker: "w", models: [], credit: null } }), user: { aiCredit: null } }), "ok browser"],
    ["a service failure uses the server", situation(true, { settings: set({ serviceFailed: true }) }), "ok server"],
  ];
  for (const [label, s, want] of READY) {
    const got = kindOf(readiness(s));
    expect(`readiness: ${label}`, got === want, `got ${got}`);
  }
  const low = readiness(situation(true, { user: { aiCredit: 0.1 } }));
  expect("readiness: credit carries the balance and the agent's terms", low.kind === "credit" && low.balance === 0.1 && low.terms === terms, kindOf(low));

  const chrome: PrivacyInput = { browser: "chrome", engine: "browser", onDevice: false, by: null, under: null };
  const chromeLines = privacyLines(chrome);
  expect("privacy: chrome sends the voice to Google, three lines", chromeLines.length === 3 && !!chromeLines[0]?.includes("Google"), `${chromeLines.length} lines`);
  expect("privacy: only the words, never the voice", chromeLines[1] === "Rodeo gets only the words, and never records or keeps your voice.", chromeLines[1]);
  expect("privacy: the agent's line last", !!chromeLines[2]?.startsWith("Rodeo's agent then"), chromeLines[2]);
  expect("privacy: on this computer", privacyLines({ ...chrome, onDevice: true })[0] === "Speech is recognised on this computer: your voice doesn't leave it.");

  const serverIn: PrivacyInput = { browser: "chrome", engine: "server", onDevice: false, by: "Google, through OpenRouter", under: "£0.01" };
  const serverLines = privacyLines(serverIn);
  expect("privacy: the server names who turns speech into text", !!serverLines[0]?.includes("(Google, through OpenRouter)"), serverLines[0]);
  expect("privacy: the server's cost is under the stated amount", !!serverLines[1]?.endsWith("usually under £0.01."), serverLines[1]);
  expect("privacy: the server is free with no amount", !!privacyLines({ ...serverIn, under: null })[1]?.endsWith("Turning it into text is free on this server."));

  const fmt = (n: number, c: string): string => `${c}:${n.toFixed(4)}`;
  // speech, agent, currency, the line
  const COST: readonly (readonly [number | null, number, string | null, string])[] = [
    [null, 0, "gbp", ""],
    [0.0003, 0.012, "gbp", "Speech and agent gbp:0.0123"],
    [0.0003, 0, "gbp", "Speech to text gbp:0.0003"],
    [null, 0.012, "gbp", "Agent gbp:0.0120"],
    [0.0003, 0.012, null, ""],
  ];
  for (const [speech, agent, currency, want] of COST) {
    const got = costLine(speech, agent, currency, fmt);
    expect(`cost: speech ${speech}, agent ${agent}, currency ${currency}`, got === want, `got "${got}"`);
  }

  const hints = speechHints(["None", "A-Wall", " a-wall ", "", "Ground Floor", "x".repeat(70)]);
  expect("hints: trimmed, no None, no repeats, 64 characters", JSON.stringify(hints) === JSON.stringify(["A-Wall", "Ground Floor", "x".repeat(64)]), JSON.stringify(hints));
  expect("hints: at most 80", speechHints(Array.from({ length: 100 }, (_, i) => `Class ${i}`)).length === 80);

  expect("mic tip: Firefox on the server asks to remember", !!micTip("firefox", "server")?.includes("Remember this decision"));
  expect("mic tip: Chrome on the server has none", micTip("chrome", "server") === null);
  expect("mic tip: Firefox on the browser has none", micTip("firefox", "browser") === null);

  expect("accounts: off with no server", accountsOn(null) === false);
  expect("accounts: on with email sign-in", accountsOn(cfg()) === true);
  expect("transcribe: off with no server", transcribeOn(null) === false);
  expect("transcribe: on when the server says so", transcribeOn(cfg()) === true);
  expect("credit terms: none with no server", creditTermsOf(null) === null);
  expect("credit terms: the agent's", creditTermsOf(cfg()) === terms);

  return failures;
}

if (process.argv[1]?.endsWith("engine.check.ts")) {
  const count = checkEngine();
  console.log(count === 0 ? "\nall checks passed" : `\n${count} check(s) failed`);
  process.exit(count > 0 ? 1 : 0);
}
