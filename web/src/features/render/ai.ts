// AI renders: an image model on Rodeo's server (POST /api/ai/image) paints a Realistic or path-traced
// picture of the model as a finished render, in a style, going as far from the picture as the
// strength lets it. Render Image's AI engine (registered here), the viewer's Restyle with AI and the
// 3D view's AI mode (aiLive.ts) all paint through paintPicture. Each picture is paid for from the
// AI credit where the server sells it. No three.js here: this loads with the editor.

import { currentUser, refreshUser } from "../../platform/api.ts";
import { AI_ASPECTS, type AiAspect, type AiImage, type AiStrength, type ImageTerms } from "../../platform/protocol.ts";
import { config } from "../account/config.ts";
import { creditTerms, formatCredit, openCreditDialog } from "../account/credit.ts";
import { requireSignIn } from "../account/signin.ts";
import { EngineRefusal, type EngineOption, type EngineOutput, type EngineRequest, type OptionValues, type RenderEngine } from "./engines.ts";

/** One of the looks the AI paints in: its name, and what the model is asked for. */
export interface AiStyle {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

export const AI_STYLES: readonly AiStyle[] = [
  { id: "daylight", label: "Photoreal daylight", prompt: "a photographic daylight render: clear sky, soft natural shadows, true-to-life materials" },
  { id: "golden", label: "Golden hour", prompt: "golden hour: warm low evening sun, long soft shadows, a glowing sky" },
  { id: "overcast", label: "Overcast", prompt: "an overcast day: soft even light, muted natural colours, a pale grey sky" },
  { id: "dusk", label: "Dusk, lights on", prompt: "blue-hour dusk: warm lights glowing in the windows, a deep blue sky, soft exterior lighting" },
  { id: "night", label: "Night", prompt: "night: the building lit from within and by exterior lighting, a dark sky" },
  { id: "rain", label: "After the rain", prompt: "just after rain: wet reflective ground, puddles, a moody grey sky" },
  { id: "snow", label: "Winter snow", prompt: "a winter's day: fresh snow on the ground and roofs, cold clear light" },
  { id: "interior", label: "Warm interior", prompt: "a warm, inviting interior: soft daylight through the windows, styled furniture, plants and props" },
  { id: "competition", label: "Competition render", prompt: "a polished architecture competition render: atmospheric light, people, trees and context, cinematic" },
  { id: "watercolour", label: "Watercolour", prompt: "a loose watercolour architectural illustration on textured paper, ink outlines" },
  { id: "sketch", label: "Hand sketch", prompt: "a hand-drawn architect's sketch in ink and marker on white paper" },
  { id: "model", label: "White card model", prompt: "a white card architectural model on a plinth, photographed in a studio, soft shadows" },
  { id: "own", label: "My own words only", prompt: "" },
];

export const AI_STRENGTHS: readonly (readonly [AiStrength, string])[] = [
  ["subtle", "Subtle — materials and light"],
  ["balanced", "Balanced — and the setting"],
  ["creative", "Creative — a free reading"],
];

/** The longest side of the picture sent: the models paint at about 1 K. */
const SEND_SIDE = 1536;
const JPEG_QUALITY = 0.9;
/** the most variations of one shot */
const MAX_VARIATIONS = 4;
const MAX_WORDS = 600;

export type AiFailureKind = "signin" | "credit" | "busy" | "service" | "network";

/** Why a picture couldn't be painted, said for the person. */
export class AiFailure extends EngineRefusal {
  readonly kind: AiFailureKind;
  constructor(kind: AiFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/** AI renders on this server, or null when it has none. */
export function aiTerms(): ImageTerms | null {
  return config()?.image ?? null;
}

/** What one picture takes from the credit for this user, or null when free (or no AI renders). */
export function pricePerPicture(): number | null {
  const t = aiTerms();
  if (!t) return null;
  return currentUser()?.plan === "supporter" ? t.plusPerPicture : t.perPicture;
}

/** "About £0.03 a picture, from your credit (£4.20 left)", or "Free on this server" — for `pictures` pictures. */
export function aiCostLine(pictures: number): string {
  const price = pricePerPicture();
  const credit = creditTerms();
  if (price === null || !credit) return "Free on this server.";
  const balance = currentUser()?.aiCredit;
  const left = typeof balance === "number" ? ` (${formatCredit(balance, credit.currency)} left)` : "";
  if (pictures <= 1) return `About ${formatCredit(price, credit.currency)} a picture, from your credit${left}.`;
  return `About ${formatCredit(price * pictures, credit.currency)} for ${pictures} pictures, from your credit${left}.`;
}

/** The style's words with the person's own, as the server takes them. */
export function aiPrompt(styleId: string, words: string): string {
  const style = AI_STYLES.find((s) => s.id === styleId)?.prompt ?? "";
  const own = words.trim().slice(0, MAX_WORDS);
  return [style, own].filter(Boolean).join(". ");
}

/** The image models' aspect nearest `width` × `height`. */
export function aspectOf(width: number, height: number): AiAspect {
  const want = Math.log(width / Math.max(1, height));
  let best: AiAspect = "16:9";
  let gap = Infinity;
  for (const a of AI_ASPECTS) {
    const [w, h] = a.split(":").map(Number);
    const d = Math.abs(Math.log(w / h) - want);
    if (d < gap) {
      gap = d;
      best = a;
    }
  }
  return best;
}

/** Signs in if need be, and checks there's credit for `pictures`; false (having said why) when not. */
export async function readyToPaint(pictures: number): Promise<boolean> {
  if (!aiTerms()) return false;
  if (!(await requireSignIn("Sign in to make AI renders."))) return false;
  const price = pricePerPicture();
  const credit = creditTerms();
  const balance = currentUser()?.aiCredit ?? 0;
  if (price !== null && credit && balance < Math.max(credit.hold, price * pictures)) {
    openCreditDialog();
    return false;
  }
  return true;
}

/** `picture` as a JPEG no more than SEND_SIDE px a side, base64. */
async function sendable(picture: Blob): Promise<{ data: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(picture);
  const scale = Math.min(1, SEND_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AiFailure("service", "This browser couldn't prepare the picture.");
  // JPEG has no transparency: a transparent sky becomes white
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const jpeg = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  const bytes = new Uint8Array(await jpeg.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(binary), width, height };
}

/** What a painting asks for. */
export interface PaintSpec {
  readonly style: string;
  readonly words: string;
  readonly strength: AiStrength;
  /** the 3D view's AI mode: the quicker model */
  readonly live: boolean;
  readonly signal?: AbortSignal;
}

/** A painted picture, and what it took from the credit (null: free, or not known yet). */
export interface Painted {
  readonly blob: Blob;
  readonly charged: number | null;
}

/** Has the server's image model paint `picture`. Throws AiFailure when it can't, an AbortError when stopped. */
export async function paintPicture(picture: Blob, spec: PaintSpec): Promise<Painted> {
  const { data, width, height } = await sendable(picture);
  let res: Response;
  try {
    res = await fetch("/api/ai/image", {
      method: "POST",
      headers: { "X-Requested-With": "openvwx", "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ image: data, mime: "image/jpeg", prompt: aiPrompt(spec.style, spec.words), strength: spec.strength, aspect: aspectOf(width, height), live: spec.live }),
      signal: spec.signal,
    });
  } catch (err) {
    if (spec.signal?.aborted) throw err;
    throw new AiFailure("network", "Rodeo's server couldn't be reached. Check the connection and try again.");
  }
  let body: Partial<AiImage> & { error?: unknown; code?: unknown } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    // not JSON: the status alone
  }
  if (res.ok && typeof body.image === "string" && body.image) {
    const bytes = Uint8Array.from(atob(body.image), (c) => c.charCodeAt(0));
    const charged = typeof body.charged === "number" ? body.charged : null;
    // the balance moved: the account's figure is read again
    if (charged) void refreshUser();
    return { blob: new Blob([bytes], { type: typeof body.mime === "string" && body.mime ? body.mime : "image/png" }), charged };
  }
  const said = typeof body.error === "string" ? body.error : `The AI render failed (${res.status}).`;
  if (res.status === 401) throw new AiFailure("signin", "Sign in to make AI renders.");
  if (res.status === 402 || body.code === "credit") throw new AiFailure("credit", "You're out of AI credit. Top up to make AI renders.");
  if (res.status === 429) throw new AiFailure("busy", said);
  throw new AiFailure("service", said);
}

// ---- Render Image's AI engine ----

const STYLE_CHOICES = AI_STYLES.map((s): [string, string] => [s.id, s.label]);

const OPTIONS: readonly EngineOption[] = [
  { key: "style", label: "Style", kind: "choice", choices: STYLE_CHOICES, initial: "daylight" },
  {
    key: "words",
    label: "Describe it",
    kind: "text",
    initial: "",
    max: MAX_WORDS,
    placeholder: "Oak cladding, a birch grove behind, people on the terrace…",
    hint: "Your own words, added to the style's",
  },
  { key: "strength", label: "Strength", kind: "choice", choices: AI_STRENGTHS, initial: "balanced", hint: "How far the AI may go from the picture: the building, its openings and the camera always stay" },
  { key: "variations", label: "Variations", kind: "number", initial: 1, min: 1, max: MAX_VARIATIONS, hint: `Different paintings of each picture, 1 to ${MAX_VARIATIONS}` },
];

function styleLabel(id: unknown): string {
  return AI_STYLES.find((s) => s.id === id)?.label ?? "AI";
}

function strengthOf(v: unknown): AiStrength {
  return AI_STRENGTHS.some(([s]) => s === v) ? (v as AiStrength) : "balanced";
}

function variationsOf(values: OptionValues): number {
  const n = Number(values.variations);
  return Number.isInteger(n) ? Math.min(MAX_VARIATIONS, Math.max(1, n)) : 1;
}

export const AI_ENGINE: RenderEngine = {
  id: "ai",
  label: "AI — painted by an image model",
  short: "AI",
  takes: "picture",
  from: "rodeo",
  options: OPTIONS,
  maxSide: SEND_SIDE,
  unavailable: () => (aiTerms() ? null : "AI renders aren't set up on this server."),
  describe: (values, pictures) => {
    const terms = aiTerms();
    const n = pictures * variationsOf(values);
    return `${aiCostLine(n)} Painted at about 1 K by ${terms?.by ?? "an image model"}; it may change small details.`;
  },
  prepare: (values, pictures) => readyToPaint(pictures * variationsOf(values)),
  async render(req: EngineRequest): Promise<readonly EngineOutput[]> {
    if (!req.picture) return [];
    return paintAll(req.picture, req.options, req.signal, (i, n) => req.progress(n > 1 ? `${req.name} · painting variation ${i + 1} of ${n}…` : `${req.name} · painting…`, null));
  },
};

/**
 * Paints `picture` as the AI engine's `values` ask, each variation in turn (`step` says which is
 * under way). Stops at `signal` with those painted so far; throws AiFailure when one can't be painted.
 */
export async function paintAll(picture: Blob, values: OptionValues, signal: AbortSignal, step: (i: number, n: number) => void): Promise<EngineOutput[]> {
  const out: EngineOutput[] = [];
  const n = variationsOf(values);
  for (let i = 0; i < n && !signal.aborted; i++) {
    step(i, n);
    const painted = await paintPicture(picture, {
      style: String(values.style),
      words: String(values.words ?? ""),
      strength: strengthOf(values.strength),
      live: false,
      signal,
    });
    out.push({ blob: painted.blob, note: n > 1 ? `${styleLabel(values.style)} ${i + 1}` : styleLabel(values.style) });
  }
  return out;
}

/** Variations the AI engine's `values` ask for: 1 to 4. */
export function aiVariations(values: OptionValues): number {
  return variationsOf(values);
}
