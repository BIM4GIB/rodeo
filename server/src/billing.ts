// The supporter plan through Stripe (fetch, form-encoded): Checkout, the customer portal,
// and the webhook that keeps each user's supporter_until in step with their subscription.
// AI credit top-ups are one-off Checkout payments, credited when the webhook says they are paid.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { Hono } from "hono";
import { isAdmin, planOf, requireUser, type UserRow } from "./auth.ts";
import { config } from "./config.ts";
import { addCredit, MICRO } from "./credit.ts";
import { get, run } from "./db.ts";
import { readJson } from "./http.ts";
import { recordDonation } from "./settings.ts";
import { fail } from "./util.ts";

const STRIPE_API = "https://api.stripe.com/v1";
const ACTIVE = new Set(["active", "trialing", "past_due"]);

/** The parts of a Stripe subscription this server reads. */
interface StripeSubscription {
  id: string;
  status: string;
  customer?: unknown;
  current_period_end?: number;
  items?: { data?: { current_period_end?: number }[] };
}

function stripeKey(): string {
  if (!config.stripe) fail(404, "Billing is not set up on this server", "not_found");
  return config.stripe.secretKey;
}

async function stripeCall(method: "GET" | "POST" | "DELETE", path: string, form?: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    console.error(`[stripe] ${method} ${path} answered ${res.status}`, JSON.stringify(json.error ?? {}));
    fail(502, "The payment provider did not accept the request");
  }
  return json;
}

/** Cancels a subscription at once (used when the account is deleted). */
export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await stripeCall("DELETE", `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

function periodEnd(sub: StripeSubscription): string | null {
  const seconds = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

/** Records a subscription's state on its user: supporter until the period ends while it is active. */
function storeSubscription(user: UserRow, sub: StripeSubscription, ended: boolean, customerId: string | null): void {
  const active = !ended && ACTIVE.has(sub.status);
  // An older subscription ending must not cancel the one the user has now.
  if (!active && user.stripe_subscription_id && user.stripe_subscription_id !== sub.id) return;
  const customer = typeof sub.customer === "string" ? sub.customer : customerId;
  const until = active ? (periodEnd(sub) ?? user.supporter_until) : null;
  run(
    "UPDATE users SET stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = ?, supporter_until = ?, plan = ? WHERE id = ?",
    customer,
    sub.id,
    until,
    active ? "supporter" : "free",
    user.id,
  );
}

function findByCustomer(customer: string | null): UserRow | undefined {
  return customer ? get<UserRow>("SELECT * FROM users WHERE stripe_customer_id = ?", customer) : undefined;
}

/** A paid top-up's Checkout session: its amount goes on the user's AI credit, once. */
function creditTopUp(session: Record<string, unknown>): void {
  const credit = config.credit;
  if (session.payment_status !== "paid") return;
  const userId = typeof session.client_reference_id === "string" ? session.client_reference_id : null;
  const user = userId ? get<UserRow>("SELECT * FROM users WHERE id = ?", userId) : undefined;
  const pence = typeof session.amount_total === "number" ? session.amount_total : 0;
  const id = typeof session.id === "string" ? session.id : null;
  if (!user || !id || pence <= 0) {
    console.error(`[billing] a paid top-up (${id ?? "no id"}) has no account or amount to credit`);
    return;
  }
  if (credit && session.currency !== credit.currency) {
    console.error(`[billing] top-up ${id} was paid in ${String(session.currency)}, not ${credit.currency}: credit it by hand`);
    return;
  }
  // amounts in pence or cents: a hundredth of the currency
  const balance = addCredit(user.id, "topup", pence * (MICRO / 100), { ref: id });
  if (balance !== null) console.log(`[billing] top-up ${id}: ${pence / 100} ${String(session.currency)} of AI credit`);
}

/** A paid donation through the donation link (a Payment Link with metadata kind "donation"), counted toward this month's hosting. */
function donation(session: Record<string, unknown>): void {
  if (session.payment_status !== "paid") return;
  const id = typeof session.id === "string" ? session.id : null;
  const amount = typeof session.amount_total === "number" ? session.amount_total : 0;
  if (!id || amount <= 0 || typeof session.currency !== "string") return;
  if (recordDonation(id, amount, session.currency)) console.log(`[billing] donation ${id}: ${amount / 100} ${session.currency}`);
}

/** Stripe's signature: HMAC-SHA256 of "t.body", 5 minutes of tolerance. */
function verifySignature(raw: Buffer, header: string, secret: string): boolean {
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") signatures.push(value);
  }
  const t = Number(timestamp);
  if (!timestamp || !Number.isFinite(t) || signatures.length === 0 || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(Buffer.concat([Buffer.from(`${timestamp}.`), raw])).digest("hex"));
  return signatures.some((s) => {
    const b = Buffer.from(s);
    return b.length === expected.length && timingSafeEqual(b, expected);
  });
}

export function registerBilling(app: Hono): void {
  app.post("/api/billing/checkout", async (c) => {
    const user = requireUser(c);
    const s = config.stripe;
    if (!s) fail(404, "Billing is not set up on this server", "not_found");
    const body = await readJson(c);
    if (body.interval !== "month" && body.interval !== "year") fail(400, "Choose a monthly or a yearly plan");
    const price = body.interval === "year" ? s.yearly : s.monthly;
    if (!price) fail(404, "That plan is not set up on this server", "not_found");
    if (planOf(user) === "supporter") {
      fail(409, "You already have Rodeo Plus. Manage it from the billing portal.", "conflict");
    }
    const form: Record<string, string> = {
      mode: "subscription",
      client_reference_id: user.id,
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      success_url: `${config.publicUrl}/?billing=success`,
      cancel_url: `${config.publicUrl}/?billing=cancel`,
    };
    if (user.stripe_customer_id) form.customer = user.stripe_customer_id;
    else form.customer_email = user.email;
    const session = await stripeCall("POST", "/checkout/sessions", form);
    if (typeof session.url !== "string") fail(502, "The payment provider did not give a checkout page");
    return c.json({ url: session.url });
  });

  // AI credit: one of the amounts the server sells, paid once (no subscription)
  app.post("/api/billing/credit", async (c) => {
    const user = requireUser(c);
    stripeKey();
    const ai = config.ai;
    const credit = config.credit;
    if (!credit) fail(404, "AI credit is not sold on this server", "not_found");
    // with cloud renders on the server, credit is for them as well, whoever may use the agents
    if (ai && !config.render) {
      if (ai.access === "admins" && !isAdmin(user)) fail(403, "The agents are open to admins only on this server", "forbidden");
      if (ai.access === "supporters" && !isAdmin(user) && planOf(user) !== "supporter") fail(403, "The agents come with Rodeo Plus", "plan");
    }
    const amount = (await readJson(c)).amount;
    if (typeof amount !== "number" || !credit.topups.includes(amount)) fail(400, `Choose a top-up of ${credit.topups.join(", ")}`);
    const form: Record<string, string> = {
      mode: "payment",
      client_reference_id: user.id,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": credit.currency,
      "line_items[0][price_data][unit_amount]": String(Math.round(amount * 100)),
      "line_items[0][price_data][product_data][name]": "Rodeo AI credit",
      "line_items[0][price_data][product_data][description]": "For the agents in Rodeo's Agents panel. Credit doesn't expire.",
      "metadata[kind]": "ai_credit",
      success_url: `${config.publicUrl}/?credit=success`,
      cancel_url: `${config.publicUrl}/?credit=cancel`,
    };
    if (user.stripe_customer_id) form.customer = user.stripe_customer_id;
    else form.customer_email = user.email;
    const session = await stripeCall("POST", "/checkout/sessions", form);
    if (typeof session.url !== "string") fail(502, "The payment provider did not give a checkout page");
    return c.json({ url: session.url });
  });

  app.post("/api/billing/portal", async (c) => {
    const user = requireUser(c);
    stripeKey();
    if (!user.stripe_customer_id) fail(404, "You have no subscription to manage", "not_found");
    const session = await stripeCall("POST", "/billing_portal/sessions", {
      customer: user.stripe_customer_id,
      return_url: `${config.publicUrl}/`,
    });
    if (typeof session.url !== "string") fail(502, "The payment provider did not give a portal page");
    return c.json({ url: session.url });
  });

  // Stripe posts here without the openvwx header, so the CSRF guard skips this path.
  app.post("/api/billing/webhook", async (c) => {
    const s = config.stripe;
    if (!s) fail(404, "Billing is not set up on this server", "not_found");
    const raw = Buffer.from(await c.req.arrayBuffer());
    if (!verifySignature(raw, c.req.header("stripe-signature") ?? "", s.webhookSecret)) {
      fail(400, "The signature is not valid");
    }
    let event: { type?: unknown; data?: { object?: Record<string, unknown> } };
    try {
      event = JSON.parse(raw.toString("utf8")) as typeof event;
    } catch {
      return fail(400, "The event is not valid JSON");
    }
    const object = event.data?.object ?? {};

    const metadata = (object.metadata ?? {}) as Record<string, unknown>;
    if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && metadata.kind === "ai_credit") {
      creditTopUp(object);
    } else if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && metadata.kind === "donation") {
      donation(object);
    } else if (event.type === "checkout.session.completed") {
      const subscriptionId = typeof object.subscription === "string" ? object.subscription : null;
      if (object.mode === "subscription" && subscriptionId) {
        const sub = (await stripeCall("GET", `/subscriptions/${encodeURIComponent(subscriptionId)}`)) as unknown as StripeSubscription;
        const customer = typeof object.customer === "string" ? object.customer : null;
        const userId = typeof object.client_reference_id === "string" ? object.client_reference_id : null;
        const user = (userId ? get<UserRow>("SELECT * FROM users WHERE id = ?", userId) : undefined) ?? findByCustomer(customer);
        if (user) storeSubscription(user, sub, false, customer);
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = object as unknown as StripeSubscription;
      if (typeof sub.id === "string") {
        const customer = typeof sub.customer === "string" ? sub.customer : null;
        const user = get<UserRow>("SELECT * FROM users WHERE stripe_subscription_id = ?", sub.id) ?? findByCustomer(customer);
        if (user) storeSubscription(user, sub, event.type === "customer.subscription.deleted", customer);
      }
    }
    return c.json({ received: true });
  });
}
