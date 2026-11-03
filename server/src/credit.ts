// AI credit, pay as you go: each user's balance and its ledger (top-ups, admin grants, and what
// each model request and cloud render cost). A request starts only with enough credit to hold
// while it runs (AI_HOLD; a render holds what its time limit could cost, render.ts), and is charged
// what the provider says it cost, in dollars, turned into the credit's currency with the markup (smaller for Rodeo Plus). Amounts are kept in millionths of the
// currency. GET /api/ai/credit shows the balance and its recent history; admins grant credit
// with POST /api/admin/ai-credit. Top-ups are bought through Stripe (billing.ts).

import type { Hono } from "hono";
import type { AiCreditInfo, AiCreditTerms } from "../../web/src/platform/protocol.ts";
import { isAdmin, planOf, requireUser, type UserRow } from "./auth.ts";
import { config, type AiCredit } from "./config.ts";
import { all, get, run, tx } from "./db.ts";
import { readJson } from "./http.ts";
import { sendMail } from "./mail.ts";
import { cleanLine, fail, nowIso } from "./util.ts";

export const MICRO = 1_000_000;

type Kind = "topup" | "usage" | "grant";

/** "£5.00": an amount of credit for an email. */
export function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: currency.toUpperCase() }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** The terms the editor is told of (GET /api/config). */
export function creditTerms(): AiCreditTerms | null {
  const c = config.credit;
  if (!c) return null;
  return { currency: c.currency, topups: c.topups, hold: c.hold, markup: c.markup, plusMarkup: c.plusMarkup, sold: config.stripe !== null };
}

function balanceOf(userId: string): number {
  return get<{ ai_credit: number }>("SELECT ai_credit FROM users WHERE id = ?", userId)?.ai_credit ?? 0;
}

/** Credit the user's cloud renders hold while they run, millionths. */
function renderHeld(userId: string): number {
  return get<{ held: number | null }>("SELECT SUM(hold) AS held FROM render_jobs WHERE user_id = ? AND state IN ('starting', 'running')", userId)?.held ?? 0;
}

/** The balance less what the user's requests and renders in flight hold, millionths. */
export function freeCredit(userId: string): number {
  return balanceOf(userId) - (held.get(userId) ?? 0) - renderHeld(userId);
}

interface Entry {
  readonly ref?: string | null;
  /** an admin's word on a grant, which the user sees ("Welcome credit", "Sorry about Tuesday") */
  readonly note?: string | null;
  readonly model?: string | null;
  readonly tokensIn?: number | null;
  readonly tokensOut?: number | null;
  readonly costUsd?: number | null;
}

/**
 * Adds `amount` (millionths; negative takes) to the user's balance and writes it in the ledger,
 * as one step. Resolves with the new balance, or null for a top-up already counted.
 */
export function addCredit(userId: string, kind: Kind, amount: number, e: Entry = {}): number | null {
  return tx(() => {
    if (kind === "topup" && e.ref && get("SELECT 1 AS x FROM ai_ledger WHERE kind = 'topup' AND ref = ?", e.ref)) return null;
    if (run("UPDATE users SET ai_credit = ai_credit + ? WHERE id = ?", amount, userId) === 0) return null;
    const balance = balanceOf(userId);
    run(
      "INSERT INTO ai_ledger (user_id, kind, amount, balance, ref, note, model, tokens_in, tokens_out, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      userId,
      kind,
      amount,
      balance,
      e.ref ?? null,
      e.note ?? null,
      e.model ?? null,
      e.tokensIn ?? null,
      e.tokensOut ?? null,
      e.costUsd ?? null,
      nowIso(),
    );
    return balance;
  });
}

/** credit held for each user's requests in flight, millionths */
const held = new Map<string, number>();

/**
 * Holds the credit one request needs while it runs, or refuses it (402) when the balance, less
 * what the user's other requests hold, is short. Returns the function that lets it go.
 */
export function holdCredit(user: UserRow, c: AiCredit): () => void {
  const need = Math.round(c.hold * MICRO);
  const balance = balanceOf(user.id);
  const busy = (held.get(user.id) ?? 0) + renderHeld(user.id);
  if (balance - busy < need) {
    fail(
      402,
      balance < need ? "You're out of AI credit. Top up to use the agents." : "There isn't enough AI credit for this many agent steps at once. Top up to carry on.",
      "credit",
    );
  }
  held.set(user.id, busy + need);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (held.get(user.id) ?? need) - need;
    if (left > 0) held.set(user.id, left);
    else held.delete(user.id);
  };
}

/** What a request the provider charged `usd` for costs the user, millionths. */
export function priceOf(user: UserRow, c: AiCredit, usd: number): number {
  const markup = planOf(user) === "supporter" ? c.plusMarkup : c.markup;
  return Math.ceil(Math.max(0, usd) * c.usdRate * markup * MICRO);
}

/** Takes a request's cost from the balance; resolves with it and the balance left, in the currency. */
export function chargeUsage(user: UserRow, c: AiCredit, usd: number, e: Entry): { charged: number; balance: number } {
  const amount = priceOf(user, c, usd);
  const balance = addCredit(user.id, "usage", -amount, { ...e, costUsd: usd }) ?? balanceOf(user.id);
  return { charged: amount / MICRO, balance: balance / MICRO };
}

export function registerCredit(app: Hono): void {
  app.get("/api/ai/credit", (c) => {
    const user = requireUser(c);
    const credit = config.credit;
    if (!credit) fail(404, "The agents are free on this server: there is no credit to show", "not_found");
    // top-ups and grants one by one; what the agents used, a day at a time
    const moves = all<{ kind: "topup" | "grant"; amount: number; note: string | null; at: string }>(
      "SELECT kind, amount, note, created_at AS at FROM ai_ledger WHERE user_id = ? AND kind != 'usage' ORDER BY id DESC LIMIT 10",
      user.id,
    );
    const daily = (renders: boolean) =>
      all<{ amount: number; n: number; at: string }>(
        `SELECT SUM(amount) AS amount, COUNT(*) AS n, MAX(created_at) AS at FROM ai_ledger WHERE user_id = ? AND kind = 'usage' AND ${renders ? "" : "NOT "}coalesce(model, '') LIKE 'render %' GROUP BY substr(created_at, 1, 10) ORDER BY at DESC LIMIT 14`,
        user.id,
      );
    const days = daily(false);
    const renders = daily(true);
    const body: AiCreditInfo = {
      balance: balanceOf(user.id) / MICRO,
      currency: credit.currency,
      moves: moves.map((m) => ({ kind: m.kind, amount: m.amount / MICRO, at: m.at, ...(m.note ? { note: m.note } : {}) })),
      days: days.map((d) => ({ amount: -d.amount / MICRO, steps: d.n, at: d.at })),
      renders: renders.map((d) => ({ amount: -d.amount / MICRO, count: d.n, at: d.at })),
    };
    return c.json(body);
  });

  // an admin gives (or, negative, takes back) credit: for testing, refunds and goodwill. The
  // account is named by userId or email; a note goes on the user's history, and with notify
  // they get an email of it.
  app.post("/api/admin/ai-credit", async (c) => {
    const admin = requireUser(c);
    if (!isAdmin(admin)) fail(403, "Only admins can grant credit", "forbidden");
    const credit = config.credit;
    if (!credit) fail(404, "The agents are free on this server", "not_found");
    const body = await readJson(c);
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const amount = typeof body.amount === "number" ? body.amount : NaN;
    if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 1000) fail(400, "Give an amount, up to 1000 either way");
    const note = cleanLine(body.note, 120) || null;
    const user =
      typeof body.userId === "string" ? get<UserRow>("SELECT * FROM users WHERE id = ?", body.userId) : get<UserRow>("SELECT * FROM users WHERE email = ?", email);
    if (!user) fail(404, typeof body.userId === "string" ? "No such account" : "No account has that email", "not_found");
    const micro = Math.round(amount * MICRO);
    if (micro < 0 && balanceOf(user.id) + micro < 0) fail(400, "That would take their balance below nothing");
    const balance = addCredit(user.id, "grant", micro, { ref: admin.email, note });
    if (body.notify === true && micro > 0) {
      const given = formatMoney(amount, credit.currency);
      const text = [
        `You've been given ${given} of AI credit in Rodeo${note ? `: ${note}` : "."}`,
        "",
        `Spend it on the agents and cloud renders; it doesn't expire. Your balance is now ${formatMoney((balance ?? 0) / MICRO, credit.currency)}.`,
        "",
        config.publicUrl,
      ].join("\n");
      sendMail(user.email, `${given} of AI credit for you in Rodeo`, text).catch((e: unknown) => console.error("[credit] could not email a grant:", e));
    }
    return c.json({ balance: (balance ?? 0) / MICRO });
  });
}
