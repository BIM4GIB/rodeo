// AI renders (POST /api/ai/image): Render Image's AI engine and the 3D view's AI mode send a picture
// of the model, rendered in the editor, with a style and how far the model may go from it; an image
// model at AI_BASE_URL (OpenRouter by default) paints it as a finished render, keeping the building,
// the camera and the framing. Signed in only, within a number of pictures per user a minute, an hour
// and a day (the live view's count too). With AI credit on, a request holds credit while it runs and
// is charged what the provider says it cost, as the agents are. The picture is passed on once and
// never kept, and the log has no prompt.

import type { Hono } from "hono";
import { AI_ASPECTS, type AiAspect, type AiImage, type AiStrength, type ImageTerms } from "../../web/src/platform/protocol.ts";
import { lookupCost } from "./ai.ts";
import { allowed, isAdmin, planOf, requireUser } from "./auth.ts";
import { config, type ImageConfig } from "./config.ts";
import { chargeUsage, holdCredit } from "./credit.ts";
import { readJson } from "./http.ts";
import { DAY, fail, HOUR, MINUTE } from "./util.ts";
import { speechBy } from "./voice.ts";

/** A 2048 px JPEG is well under 3 MB; its base64 is a third larger. */
const MAX_BODY = 6_000_000;
const MAX_IMAGE_BYTES = 4_000_000;
const MAX_PROMPT = 1000;
/** The longest a model may take: a still waits, the live view moves on sooner. */
const STILL_MS = 120_000;
const LIVE_MS = 60_000;
/** Pictures one user may ask for in a minute. */
const PER_MINUTE = 12;
const STRENGTHS: readonly AiStrength[] = ["subtle", "balanced", "creative"];

const KEEP = [
  "The picture is a 3D view of a building model drawn in Rodeo, a CAD editor. Paint it as a finished architectural visualisation.",
  "Keep exactly: the camera, its framing and perspective; every wall, roof, floor, opening and object, with its outline, size and position; the number of storeys, windows and doors. Do not add, remove, move or reshape any part of the building.",
  "No text, labels, logos, frames or watermarks.",
].join("\n");

const HOW_FAR: Readonly<Record<AiStrength, string>> = {
  subtle: "Keep the materials and colours the model shows, and make them real: texture, wear, reflections. Improve the light and shadow. Leave the surroundings as they are.",
  balanced: "Make the materials real, choosing finishes that suit how each surface looks. Light the scene to suit the style. Where the model shows empty ground or sky, you may add a ground, a sky and planting.",
  creative: "You may reinterpret the materials, the light and the surroundings to suit the style, and add landscape, people and context, keeping the building's form, its openings and the camera.",
};

/** The image model's instructions for a picture: what it keeps, how far it may go, and the style asked for. */
export function paintPrompt(prompt: string, strength: AiStrength): string {
  return `${KEEP}\n${HOW_FAR[strength]}\nStyle: ${prompt || "a photographic daylight render"}`;
}

/** The painted picture, its generation id, and its cost (dollars) and tokens where the answer says them. */
export interface ModelPainted {
  readonly image: string;
  readonly mime: string;
  /** what the model said with it (or instead of it) */
  readonly text: string;
  readonly id: string | null;
  readonly usd: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

/** The provider turned the request down: its status and its reason. */
class ProviderError extends Error {
  readonly status: number;
  constructor(status: number, reason: string) {
    super(reason);
    this.status = status;
  }
}

function onOpenRouter(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith("openrouter.ai");
  } catch {
    return false;
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** "image/png" or "image/jpeg" when `b` starts as one, else null. */
export function imageType(b: Uint8Array): "image/png" | "image/jpeg" | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** What /api/config says of AI renders here. */
export function imageTerms(): ImageTerms | null {
  const m = config.image;
  if (!m) return null;
  const c = config.credit;
  return {
    by: speechBy(m.model, m.baseUrl),
    perPicture: c ? m.usdPerPicture * c.usdRate * c.markup : null,
    plusPerPicture: c ? m.usdPerPicture * c.usdRate * c.plusMarkup : null,
    perHour: m.perHour,
  };
}

/** A provider's answer as JSON; throws ProviderError for a refusal. */
async function answer(res: Response): Promise<Record<string, unknown>> {
  const raw = await res.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    const j = JSON.parse(raw) as unknown;
    if (j && typeof j === "object" && !Array.isArray(j)) body = j as Record<string, unknown>;
  } catch {
    // not JSON: the status alone
  }
  if (!res.ok) {
    const reason = ((body.error ?? {}) as { message?: unknown }).message;
    throw new ProviderError(res.status, typeof reason === "string" ? reason : "");
  }
  return body;
}

/** The first picture in a chat answer's message, as a data URL's type and base64; null when it has none. */
export function pictureOf(message: unknown): { mime: string; image: string } | null {
  const images = (message as { images?: unknown } | undefined)?.images;
  if (!Array.isArray(images)) return null;
  for (const item of images) {
    const url = (item as { image_url?: { url?: unknown } } | undefined)?.image_url?.url;
    if (typeof url !== "string") continue;
    const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/is.exec(url);
    if (m) return { mime: m[1].toLowerCase(), image: m[2] };
  }
  return null;
}

/** Has the model paint `image64`. Throws ProviderError, or a fetch error when unreachable. */
export async function askPainter(
  m: ImageConfig,
  model: string,
  image64: string,
  mime: string,
  prompt: string,
  aspect: AiAspect,
  signal: AbortSignal,
): Promise<ModelPainted> {
  const res = await fetch(`${m.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${m.apiKey}`,
      "Content-Type": "application/json",
      // OpenRouter shows these on its dashboard
      "HTTP-Referer": config.publicUrl,
      "X-Title": "Rodeo",
    },
    signal,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${mime};base64,${image64}` } },
          ],
        },
      ],
      modalities: ["image", "text"],
      image_config: { aspect_ratio: aspect },
      usage: { include: true },
      stream: false,
    }),
  });
  const body = await answer(res);
  const choice = (Array.isArray(body.choices) ? body.choices[0] : undefined) as { message?: { content?: unknown } } | undefined;
  const content = choice?.message?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : "")).join("")
        : "";
  const picture = pictureOf(choice?.message);
  const usage = (body.usage ?? {}) as Record<string, unknown>;
  return {
    image: picture?.image ?? "",
    mime: picture?.mime ?? "",
    text: text.trim(),
    id: typeof body.id === "string" ? body.id : null,
    usd: num(usage.cost),
    tokensIn: num(usage.prompt_tokens),
    tokensOut: num(usage.completion_tokens),
  };
}

export function registerImage(app: Hono): void {
  const m0 = config.image;
  if (m0 && config.credit && !onOpenRouter(m0.baseUrl)) {
    console.warn("[image] AI credit charges what OpenRouter reports each picture cost; AI_BASE_URL isn't OpenRouter, so an answer without a cost goes uncharged.");
  }

  app.post("/api/ai/image", async (c) => {
    const m = config.image;
    if (!m) fail(503, "AI renders aren't set up on this server.", "not_configured");
    const user = requireUser(c);
    const access = config.ai?.access ?? "all";
    if (access === "admins" && !isAdmin(user)) fail(403, "AI renders are open to admins only on this server.", "forbidden");
    if (access === "supporters" && !isAdmin(user) && planOf(user) !== "supporter") fail(403, "AI renders on this server come with Rodeo Plus.", "plan");
    if (!allowed(`image-min:${user.id}`, PER_MINUTE, MINUTE) || !allowed(`image-hour:${user.id}`, m.perHour, HOUR) || !allowed(`image-day:${user.id}`, m.perDay, DAY)) {
      fail(429, "That's as many AI pictures as one account may ask for for now: try again later.", "rate_limited");
    }
    const body = await readJson(c, MAX_BODY);
    const image64 = typeof body.image === "string" ? body.image.replace(/^data:[^,]*,/, "") : "";
    if (!image64) fail(400, "Send the picture as image (base64 PNG or JPEG).", "bad_image");
    const bytes = Buffer.from(image64, "base64");
    if (bytes.length > MAX_IMAGE_BYTES) fail(413, "The picture is too large: send one under 4 MB.", "too_large");
    const mime = imageType(bytes);
    if (!mime) fail(400, "The picture must be a PNG or a JPEG.", "bad_image");
    const strength = STRENGTHS.includes(body.strength as AiStrength) ? (body.strength as AiStrength) : "balanced";
    const aspect = AI_ASPECTS.includes(body.aspect as AiAspect) ? (body.aspect as AiAspect) : "16:9";
    const prompt = typeof body.prompt === "string" ? Array.from(body.prompt.replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, " ").trim()).slice(0, MAX_PROMPT).join("") : "";
    const live = body.live === true;
    const model = live ? m.liveModel : m.model;

    const credit = config.credit;
    const release = credit ? holdCredit(user, credit) : () => {};
    let painted: ModelPainted;
    try {
      painted = await askPainter(m, model, bytes.toString("base64"), mime, paintPrompt(prompt, strength), aspect, AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(live ? LIVE_MS : STILL_MS)]));
    } catch (e) {
      release();
      if (e instanceof ProviderError) {
        const said = `The image model's provider answered ${e.status}${e.message ? `: ${e.message}` : ""}`;
        console.error(`[image] ${model}: ${said}`);
        // the server's own provider account out of credit: the user's Rodeo credit isn't the matter
        if (e.status === 402) fail(503, "Rodeo's model provider has run out of credit, so AI pictures can't be painted until Rodeo's owner tops it up.", "provider_credit");
        if (e.status === 429) fail(429, `${said}. Try again in a minute.`, "provider_busy");
        if (e.status >= 500 || e.status === 408) fail(503, `${said}. Try again in a minute.`, "provider_down");
        fail(422, said, "provider_refused");
      }
      if (c.req.raw.signal.aborted) fail(499, "The request was cancelled.", "cancelled");
      console.error(`[image] ${model}: the model provider could not be reached or took too long`);
      fail(503, "The image model didn't answer in time. Try again in a minute.", "provider_down");
    }

    const charge = (): { charged: number | null; balance: number | null } => {
      if (!credit) {
        // no ledger to look in: what each picture cost goes to the log instead (never its prompt)
        console.log(`[image] ${model}: ${painted.tokensIn ?? "?"} in, ${painted.tokensOut ?? "?"} out, $${painted.usd?.toFixed(5) ?? "?"}`);
        return { charged: null, balance: null };
      }
      const entry = { ref: painted.id, model: `image ${model}`, tokensIn: painted.tokensIn, tokensOut: painted.tokensOut };
      if (painted.usd !== null) return chargeUsage(user, credit, painted.usd, entry);
      // no cost in the answer: OpenRouter's record of it, a moment later
      const id = painted.id;
      if (id && onOpenRouter(m.baseUrl)) {
        void lookupCost(m, id)
          .then((usd) => {
            if (usd !== null) chargeUsage(user, credit, usd, entry);
            else console.warn(`[image] ${model}: no cost found for ${id}; not charged`);
          })
          .catch((err: unknown) => console.error("[image] charging a picture failed", err));
      } else {
        console.warn(`[image] ${model}: the answer gave no cost; not charged`);
      }
      return { charged: null, balance: null };
    };
    let spent: { charged: number | null; balance: number | null };
    try {
      // a model that answers in words alone is still paid for
      spent = charge();
    } finally {
      release();
    }
    if (!painted.image) {
      const said = painted.text ? `: ${painted.text.slice(0, 300)}` : "";
      fail(422, `The image model sent back no picture${said}`, "no_picture");
    }
    return c.json({ image: painted.image, mime: painted.mime, ...spent } satisfies AiImage);
  });
}
