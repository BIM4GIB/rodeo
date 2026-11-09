// Server configuration from the environment (docs/PLATFORM.md, "Environment").

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CarbonAd, Funding, FundingLink, Limits } from "../../web/src/platform/protocol.ts";
import { env, envBool, envBytes, envInt, envList, envNumber } from "./env.ts";
import { GB, MB } from "./util.ts";

export type Provider = "google" | "microsoft" | "github";

export interface OAuthApp {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface StripeConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly monthly: string | null;
  readonly yearly: string | null;
}

const production = env("NODE_ENV") === "production";
const port = envInt("PORT", 8080);
const publicUrl = (env("PUBLIC_URL") ?? `http://localhost:${port}`).replace(/\/+$/, "");
const dataDir = resolve(env("DATA_DIR") ?? "/data");
const smtpUrl = env("SMTP_URL") ?? null;

function pair(idName: string, secretName: string): OAuthApp | null {
  const clientId = env(idName);
  const clientSecret = env(secretName);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

const oauth: Partial<Record<Provider, OAuthApp>> = {};
const google = pair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
const microsoft = pair("MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET");
const github = pair("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET");
if (google) oauth.google = google;
if (microsoft) oauth.microsoft = microsoft;
if (github) oauth.github = github;

const stripeKey = env("STRIPE_SECRET_KEY");
const stripeHookSecret = env("STRIPE_WEBHOOK_SECRET");
const priceMonthly = env("STRIPE_PRICE_MONTHLY") ?? null;
const priceYearly = env("STRIPE_PRICE_YEARLY") ?? null;
const stripe: StripeConfig | null =
  stripeKey && stripeHookSecret && (priceMonthly || priceYearly)
    ? { secretKey: stripeKey, webhookSecret: stripeHookSecret, monthly: priceMonthly, yearly: priceYearly }
    : null;

const gClient = env("DRIVE_GOOGLE_CLIENT_ID");
const gKey = env("DRIVE_GOOGLE_API_KEY");
const gApp = env("DRIVE_GOOGLE_APP_ID");
const msDrive = env("DRIVE_MICROSOFT_CLIENT_ID");

/** The start hub's Carbon ad: the serve and placement codes Carbon gives the site (both, or none). */
function carbonFromEnv(): CarbonAd | null {
  const serve = env("CARBON_SERVE");
  const placement = env("CARBON_PLACEMENT");
  if (!serve || !placement) return null;
  const code = /^[A-Za-z0-9_.-]{1,64}$/;
  if (!code.test(serve) || !code.test(placement)) throw new Error("CARBON_SERVE and CARBON_PLACEMENT must be Carbon's codes (letters, digits, _ . -)");
  return { serve, placement };
}

/** Who may use the server's model key: anyone signed in, Rodeo Plus supporters, or ADMIN_EMAILS alone. */
export type AiAccess = "all" | "supporters" | "admins";

/**
 * Pay as you go: users buy credit (Stripe Checkout) and each model request or cloud render takes
 * from it what the provider charged for it (OpenRouter says, in dollars; a render's GPU seconds at
 * RenderConfig.usdPerHour), turned into the currency, plus a margin for card fees and running costs.
 */
export interface AiCredit {
  /** what credit is sold and kept in (Stripe's lower-case code), a currency with pence or cents */
  readonly currency: string;
  /** one US dollar in that currency */
  readonly usdRate: number;
  /** what a request costs the user against what the provider charged: 1.3 is 30% more */
  readonly markup: number;
  /** the same for Rodeo Plus members */
  readonly plusMarkup: number;
  /** the amounts a top-up may be */
  readonly topups: readonly number[];
  /** the credit a request needs to start, held from the balance while it runs */
  readonly hold: number;
}

/**
 * The Agents panel's models, reached through one OpenAI-compatible endpoint (OpenRouter by default),
 * or straight at Anthropic (anthropic.ts) when ANTHROPIC_API_KEY is set. Models are named as
 * OpenRouter names them either way ("anthropic/claude-opus-5.5").
 */
export interface AiConfig {
  readonly provider: "openai" | "anthropic";
  /** the OpenAI-compatible endpoint; not used for Anthropic */
  readonly baseUrl: string;
  readonly apiKey: string;
  /** the model that plans and talks to the user */
  readonly planner: string;
  /** the model its subagents run on */
  readonly worker: string;
  /** the models a request may name; the planner and worker are always among them */
  readonly models: readonly string[];
  readonly access: AiAccess;
  /** model requests each user may make in an hour, and in a day */
  readonly perHour: number;
  readonly perDay: number;
  /** null when the agents are free to use, within the request limits (AI_CREDIT=off) */
  readonly credit: AiCredit | null;
}

/**
 * Cloud renders (render.ts): Render Image's jobs run on a GPU at Modal (cloudrender/worker.py),
 * which RENDER_URL and RENDER_SECRET reach. Each is charged from the credit for the seconds it ran.
 */
export interface RenderConfig {
  /** the worker's endpoint (modal deploy prints it) */
  readonly url: string;
  readonly secret: string;
  /** the GPU a job runs on, as Modal names it */
  readonly gpu: string;
  /** what an hour of it costs at Modal, with the CPU and memory beside it, US dollars */
  readonly usdPerHour: number;
  /** seconds of a container's start Modal bills before the worker's clock starts */
  readonly startupSeconds: number;
  /** the longest a job may run, minutes */
  readonly maxMinutes: number;
  /** jobs one user may have running at once */
  readonly perUser: number;
  /** days the pictures are kept */
  readonly keepDays: number;
}

/**
 * Voice commands' speech to text (voice.ts), for browsers with no speech recognition of their own:
 * an audio model at the agents' OpenAI-compatible endpoint (OpenRouter), with the same key. Not
 * offered with only ANTHROPIC_API_KEY: Anthropic's models don't take audio.
 */
export interface VoiceConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** the model that writes down what was said */
  readonly model: string;
  /** "chat": an audio-capable chat model, given a prompt and the drawing's names; "transcriptions": OpenRouter's speech-to-text endpoint (Whisper and the like), without them */
  readonly api: "chat" | "transcriptions";
  /** the chat model's reasoning effort ("" sends none) */
  readonly effort: string;
  /** recordings each user may send in an hour, and in a day */
  readonly perHour: number;
  readonly perDay: number;
}

/**
 * AI renders (image.ts): an image model paints a picture of the model, rendered in the editor, as a
 * finished render. Offered with an OpenRouter-style key unless AI_IMAGES=off.
 */
export interface ImageConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** the model that paints Render Image's AI pictures */
  readonly model: string;
  /** the quicker model the 3D view's AI mode paints with */
  readonly liveModel: string;
  /** about what a picture costs at the provider, dollars: the estimate the editor shows before it asks */
  readonly usdPerPicture: number;
  /** pictures each user may ask for in an hour, and in a day */
  readonly perHour: number;
  readonly perDay: number;
}

/** Modal's price of an hour of each GPU, US dollars (modal.com/pricing, October 2026) */
const GPU_USD_PER_HOUR: Readonly<Record<string, number>> = {
  T4: 0.59,
  L4: 0.8,
  A10: 1.1,
  L40S: 1.95,
  A100: 2.1,
  "A100-80GB": 2.5,
  H100: 3.95,
};
/** the worker's 2 CPU cores and 8 GiB beside the GPU, an hour */
const WORKER_USD_PER_HOUR = 2 * 0.0472 + 8 * 0.008;

/** a positive number from the environment, or the fallback */
function positive(name: string, fallback: number): number {
  const v = envNumber(name);
  return v !== undefined && v > 0 ? v : fallback;
}

function aiFromEnv(): AiConfig | null {
  const apiKey = aiKey;
  if (!apiKey) return null;
  const provider = apiKey === anthropicKey ? "anthropic" : "openai";
  const planner = env("AI_PLANNER_MODEL") ?? "anthropic/claude-opus-5.5";
  const worker = env("AI_WORKER_MODEL") ?? "anthropic/claude-haiku-5.5";
  const access = env("AI_ACCESS");
  const extra = envList("AI_MODELS");
  return {
    provider,
    baseUrl: (env("AI_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    apiKey,
    planner,
    worker,
    // a cheaper planner to choose, unless the list is set
    models: [...new Set([planner, worker, ...(extra.length ? extra : ["anthropic/claude-sonnet-5.5"])])],
    access: access === "supporters" || access === "admins" ? access : "all",
    perHour: envInt("AI_REQUESTS_PER_HOUR", 300),
    perDay: envInt("AI_REQUESTS_PER_DAY", 2000),
    credit,
  };
}

function renderFromEnv(): RenderConfig | null {
  const url = env("RENDER_URL");
  const secret = env("RENDER_SECRET");
  if (!url || !secret) return null;
  const gpu = env("RENDER_GPU") ?? "L40S";
  return {
    url: url.replace(/\/+$/, ""),
    secret,
    gpu,
    usdPerHour: positive("RENDER_USD_PER_HOUR", (GPU_USD_PER_HOUR[gpu] ?? GPU_USD_PER_HOUR.L40S) + WORKER_USD_PER_HOUR),
    startupSeconds: positive("RENDER_STARTUP_SECONDS", 15),
    maxMinutes: positive("RENDER_MAX_MINUTES", 60),
    perUser: envInt("RENDER_JOBS_PER_USER", 2),
    keepDays: positive("RENDER_KEEP_DAYS", 7),
  };
}

const render = renderFromEnv();
const anthropicKey = env("ANTHROPIC_API_KEY");
const openAiKey = env("AI_API_KEY") ?? env("OPENROUTER_API_KEY");
/** Anthropic's key when it's set, unless AI_PROVIDER=openrouter keeps the agents on the other */
const aiKey = anthropicKey && (env("AI_PROVIDER") !== "openrouter" || !openAiKey) ? anthropicKey : openAiKey;

/** The credit, when the agents or cloud renders are set up and AI_CREDIT is not off. */
function creditFromEnv(): AiCredit | null {
  if ((!aiKey && !render) || !envBool("AI_CREDIT", true)) return null;
  const markup = positive("AI_MARKUP", 1.3);
  const topups = envList("AI_TOPUPS")
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 1);
  return {
    currency: (env("AI_CURRENCY") ?? "gbp").toLowerCase(),
    usdRate: positive("AI_USD_RATE", 0.8),
    markup,
    plusMarkup: positive("AI_MARKUP_PLUS", Math.min(markup, 1.15)),
    topups: topups.length ? [...new Set(topups)].sort((a, b) => a - b) : [5, 10, 20],
    hold: positive("AI_HOLD", 0.25),
  };
}

const credit = creditFromEnv();

/** Speech to text for voice commands: on with an OpenRouter-style key unless VOICE_TRANSCRIBE=off. */
function voiceFromEnv(): VoiceConfig | null {
  if (!openAiKey || !envBool("VOICE_TRANSCRIBE", true)) return null;
  const api = env("VOICE_API") === "transcriptions" ? "transcriptions" : "chat";
  const effort = env("VOICE_EFFORT") ?? "none";
  return {
    baseUrl: (env("AI_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    apiKey: openAiKey,
    model: env("VOICE_MODEL") ?? (api === "transcriptions" ? "openai/whisper-large-v3-turbo" : "google/gemini-3.1-flash-lite"),
    api,
    effort: effort === "off" ? "" : effort,
    perHour: envInt("VOICE_REQUESTS_PER_HOUR", 120),
    perDay: envInt("VOICE_REQUESTS_PER_DAY", 600),
  };
}

const voice = voiceFromEnv();

/** AI renders: on with an OpenRouter-style key unless AI_IMAGES=off. */
function imageFromEnv(): ImageConfig | null {
  if (!openAiKey || !envBool("AI_IMAGES", true)) return null;
  return {
    baseUrl: (env("AI_BASE_URL") ?? "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
    apiKey: openAiKey,
    model: env("AI_IMAGE_MODEL") ?? "google/gemini-nano-banana-2.1",
    liveModel: env("AI_IMAGE_LIVE_MODEL") ?? "google/gemini-3.1-flash-lite-image",
    usdPerPicture: positive("AI_IMAGE_USD", 0.04),
    perHour: envInt("AI_IMAGES_PER_HOUR", 120),
    perDay: envInt("AI_IMAGES_PER_DAY", 400),
  };
}

const image = imageFromEnv();

const free: Limits = {
  files: envInt("FREE_FILES", 5),
  bytes: envBytes("FREE_BYTES", 250 * MB),
  versions: envInt("FREE_VERSIONS", 10),
  // share links and embeds are how drawings travel, so they are free (FREE_SHARE_LINKS=0 makes them Plus only)
  shareLinks: envBool("FREE_SHARE_LINKS", true),
};

const supporter: Limits = {
  files: envInt("SUPPORTER_FILES", 0),
  bytes: envBytes("SUPPORTER_BYTES", 20 * GB),
  versions: envInt("SUPPORTER_VERSIONS", 0),
  shareLinks: true,
};

function fundingFromEnv(): Funding | null {
  const goal = envNumber("FUNDING_GOAL");
  const raised = envNumber("FUNDING_RAISED");
  const links: FundingLink[] = [];
  for (const item of envList("FUNDING_LINKS")) {
    const bar = item.indexOf("|");
    if (bar < 0) continue;
    const label = item.slice(0, bar).trim();
    const url = item.slice(bar + 1).trim();
    if (label && /^https?:\/\//.test(url)) links.push({ label, url });
  }
  if (goal === undefined && raised === undefined && links.length === 0) return null;
  return {
    currency: env("FUNDING_CURRENCY") ?? "GBP",
    goalMonthly: goal ?? 0,
    raisedThisMonth: raised ?? 0,
    links,
  };
}

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;

export const config = {
  version,
  production,
  port,
  publicUrl,
  /** cookies get the Secure flag when the site is served over https */
  secureCookies: publicUrl.startsWith("https://"),
  dataDir,
  dbPath: join(dataDir, "openvwx.db"),
  blobsDir: join(dataDir, "blobs"),
  tmpDir: join(dataDir, "tmp"),
  /** the built editor (web/dist) */
  webDist: resolve(env("WEB_DIST") ?? resolve(import.meta.dirname, "../../web/dist")),
  corsOrigins: envList("CORS_ORIGINS").map((o) => o.replace(/\/+$/, "")),
  /**
   * the header a proxy in front puts the visitor's address in (cf-connecting-ip behind
   * Cloudflare); without it the last X-Forwarded-For hop is used, which behind Cloudflare is
   * an edge server many visitors share
   */
  clientIpHeader: env("CLIENT_IP_HEADER")?.toLowerCase() ?? null,
  /** old or alternative hostnames (an earlier domain, www.) whose requests move to PUBLIC_URL */
  redirectHosts: new Set(envList("REDIRECT_HOSTS").map((h) => h.toLowerCase())),
  admins: new Set(envList("ADMIN_EMAILS").map((e) => e.toLowerCase())),
  smtpUrl,
  mailFrom: env("MAIL_FROM") ?? "Rodeo <noreply@localhost>",
  /** email sign-in is offered with SMTP, or in development (the links go to the log) */
  emailAuth: smtpUrl !== null || !production,
  oauth,
  stripe,
  drives: {
    google: gClient && gKey && gApp ? { clientId: gClient, apiKey: gKey, appId: gApp } : null,
    microsoft: msDrive ? { clientId: msDrive } : null,
  },
  carbon: carbonFromEnv(),
  limits: { free, supporter },
  labels: {
    monthly: env("SUPPORTER_MONTHLY_LABEL") ?? "£2/month",
    yearly: env("SUPPORTER_YEARLY_LABEL") ?? "£15/year",
  },
  maxUploadBytes: envBytes("MAX_UPLOAD_BYTES", GB),
  /** what the files and screenshots sent with feedback may take on disk in all; past it, reports go without them */
  feedbackFilesMax: envBytes("FEEDBACK_FILES_MAX", 10 * GB),
  /** a bearer token that may read and clear error reports without an admin's sign-in (scripts) */
  reportsToken: env("REPORTS_TOKEN") ?? null,
  fundingEnv: fundingFromEnv(),
  ai: aiFromEnv(),
  /** voice commands' speech to text (null: not offered; Firefox can't use voice) */
  voice,
  /** AI renders (null: not offered) */
  image,
  /** the credit the agents and cloud renders take from (null: they are free, or neither is set up) */
  credit,
  render,
};
