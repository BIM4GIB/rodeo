// AI credit for the agents (the Agents panel), pay as you go: the balance, top-ups through Stripe
// Checkout, what the agents used each day lately, and what a step costs. A top-up comes back
// with ?credit=success, and the balance grows when Stripe's webhook lands.

import { h } from "../../app/dom.ts";
import { errorMessage } from "../../app/toast.ts";
import { billing, currentUser } from "../../platform/api.ts";
import type { AiCreditInfo, AiCreditTerms } from "../../platform/protocol.ts";
import { config } from "./config.ts";
import { footButton, openModal, type Modal } from "./dialog.ts";
import { formatDate } from "./format.ts";
import { requireSignIn } from "./signin.ts";

/** The credit terms, when the server sells the agents or cloud renders by credit. */
export function creditTerms(): AiCreditTerms | null {
  const c = config();
  return c?.credit ?? c?.ai?.credit ?? null;
}

/** An amount of credit with pence: "£4.12"; below a penny, "<£0.01". */
export function formatCredit(n: number, currency: string): string {
  let f: Intl.NumberFormat;
  try {
    f = new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return `${currency.toUpperCase()} ${n.toFixed(2)}`;
  }
  if (n > 0 && n < 0.005) return `<${f.format(0.01)}`;
  return f.format(n);
}

/** "30%": a markup as the extra it adds. */
function extra(markup: number): string {
  return `${Math.round((markup - 1) * 100)}%`;
}

/** What a step costs, in a sentence; and a minute of a cloud render, when the server has them. */
export function pricing(t: AiCreditTerms): string {
  const plus = t.plusMarkup < t.markup ? ` (${extra(t.plusMarkup)} with Rodeo Plus)` : "";
  const render = config()?.render;
  const renders =
    render?.perMinute != null
      ? ` A cloud render costs about ${formatCredit(render.perMinute, t.currency)} a minute of GPU time${render.plusPerMinute != null && render.plusPerMinute < render.perMinute ? ` (${formatCredit(render.plusPerMinute, t.currency)} with Rodeo Plus)` : ""}.`
      : "";
  return `Each agent step costs what the model provider charges for it, plus ${extra(t.markup)}${plus} for card fees and running costs.${renders} You see the cost of every message as it runs, and credit doesn't expire.`;
}

const BEFORE_KEY = "openvwx.credit.before";

/** Sends the user to Stripe Checkout for a top-up of `amount`. */
export async function topUp(amount: number, onError: (message: string) => void): Promise<void> {
  if (!(await requireSignIn("Sign in to add AI credit"))) return;
  try {
    const url = await billing.topUp(amount);
    // the balance before, so the return can tell when the top-up has landed
    try {
      sessionStorage.setItem(BEFORE_KEY, String(currentUser()?.aiCredit ?? 0));
    } catch {
      // storage blocked: the return says what the balance is
    }
    location.href = url;
  } catch (err) {
    onError(errorMessage(err));
  }
}

/** The balance kept when the user left for a top-up, once (null when none was kept). */
export function balanceBeforeTopUp(): number | null {
  try {
    const v = sessionStorage.getItem(BEFORE_KEY);
    sessionStorage.removeItem(BEFORE_KEY);
    return v === null || !Number.isFinite(Number(v)) ? null : Number(v);
  } catch {
    return null;
  }
}

/** The top-up buttons: one per amount the server sells. */
export function topUpButtons(t: AiCreditTerms, onError: (message: string) => void): HTMLElement {
  const buttons = t.topups.map((amount) => {
    const b = h("button", { cls: "btn primary", text: `Add ${formatCredit(amount, t.currency).replace(/\.00$/, "")}`, attrs: { type: "button" }, disabled: !t.sold });
    b.addEventListener("click", () => {
      for (const x of buttons) x.disabled = true;
      void topUp(amount, (message) => {
        for (const x of buttons) x.disabled = !t.sold;
        onError(message);
      });
    });
    return b;
  });
  return h("div", { cls: "acct-buttons" }, ...buttons);
}

/** AI credit: the balance, the top-ups, the pricing and the recent use. */
export function openCreditDialog(): void {
  const t = creditTerms();
  if (!t) return;
  let modal: Modal | null = null;
  const balance = h("p", { cls: "acct-credit", text: formatCredit(currentUser()?.aiCredit ?? 0, t.currency) });
  const history = h("div", { cls: "acct-history" });
  const body: Node[] = [
    h("p", { cls: "acct-headline", text: "Balance" }),
    balance,
    h("p", { cls: "acct-lead", text: pricing(t) }),
    topUpButtons(t, (message) => modal?.error(message)),
    h("p", { cls: "acct-note", text: t.sold ? "Payment is handled by Stripe." : "AI credit can't be bought on this server yet." }),
    history,
  ];
  modal = openModal({ title: "AI Credit", cls: "supporter-dialog", body, actions: [footButton("Close", false, () => modal?.close())] });

  if (!currentUser()) return;
  billing
    .credit()
    .then((info) => {
      balance.textContent = formatCredit(info.balance, info.currency);
      history.replaceChildren(...historyRows(info));
    })
    .catch(() => {
      // the balance from the account is shown; the history is left out
    });
}

function historyRows(info: AiCreditInfo): Node[] {
  const rows = [
    ...info.days.map((d) => ({ at: d.at, text: `${d.steps} agent step${d.steps === 1 ? "" : "s"}`, amount: `−${formatCredit(d.amount, info.currency)}` })),
    ...(info.renders ?? []).map((d) => ({ at: d.at, text: `${d.count} cloud render${d.count === 1 ? "" : "s"}`, amount: `−${formatCredit(d.amount, info.currency)}` })),
    // an admin can take credit back too, as a negative grant
    ...info.moves.map((m) => ({
      at: m.at,
      text: m.kind === "topup" ? "Top-up" : (m.note ?? (m.amount < 0 ? "Taken off by Rodeo" : "Added by Rodeo")),
      amount: `${m.amount < 0 ? "−" : "+"}${formatCredit(Math.abs(m.amount), info.currency)}`,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if (!rows.length) return [];
  return [
    h("p", { cls: "acct-headline", text: "Recent" }),
    h(
      "ul",
      { cls: "acct-history-list" },
      ...rows.slice(0, 12).map((r) => h("li", {}, h("span", { text: formatDate(r.at) }), h("span", { text: r.text }), h("span", { cls: "acct-history-amount", text: r.amount }))),
    ),
  ];
}
