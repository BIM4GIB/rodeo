// Rodeo Plus, the paid plan (plan id "supporter"). openSupporterDialog sells it to a signed-in
// user (through Stripe Checkout), or for a member shows the plan and opens the billing portal,
// where it is changed or ended (managePlan).

import { h } from "../../app/dom.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { billing, currentUser } from "../../platform/api.ts";
import type { ServerConfig } from "../../platform/protocol.ts";
import { config } from "./config.ts";
import { footButton, openModal, type Modal } from "./dialog.ts";
import { formatBytes, formatDate } from "./format.ts";
import { requireSignIn } from "./signin.ts";

type Interval = "month" | "year";

/** Rodeo Plus: its perks and both prices, or a member's plan and its billing. */
export function openSupporterDialog(): void {
  const cfg = config();
  if (!cfg) return;
  const user = currentUser();
  const supporter = user?.plan === "supporter";
  const prices = cfg.plans.supporter;
  let modal: Modal | null = null;
  const buyButtons: HTMLButtonElement[] = [];

  const setBusy = (busy: boolean): void => {
    for (const b of buyButtons) b.disabled = busy || !cfg.billing;
  };

  const pay = (interval: Interval): void => {
    void (async () => {
      if (!(await requireSignIn("Sign in to get Rodeo Plus"))) return;
      setBusy(true);
      modal?.error(null);
      try {
        location.href = await billing.checkout(interval);
      } catch (err) {
        setBusy(false);
        modal?.error(errorMessage(err));
      }
    })();
  };

  const priceButton = (label: string, interval: Interval): HTMLButtonElement => {
    const btn = h("button", { cls: "btn primary", text: label, attrs: { type: "button" }, disabled: !cfg.billing });
    btn.addEventListener("click", () => pay(interval));
    buyButtons.push(btn);
    return btn;
  };

  const body: Node[] = [
    h("p", { cls: "acct-headline", text: "Keep Rodeo free for students." }),
    h("p", {
      cls: "acct-lead",
      text: "Rodeo Plus helps pay for the hosting that keeps Rodeo free for students, and gives you more room in the cloud.",
    }),
    h("ul", { cls: "acct-perks" }, ...perksOf(cfg).map((text) => h("li", { text }))),
  ];
  const actions: Node[] = [footButton("Close", false, () => modal?.close())];

  if (supporter) {
    const until = user?.supporterUntil ? formatDate(user.supporterUntil) : "";
    body.push(h("p", { cls: "acct-status", text: until ? `You're on Rodeo Plus until ${until}.` : "You're on Rodeo Plus." }));
    if (cfg.billing) actions.unshift(footButton("Manage Plan…", true, () => void managePlan()));
  } else {
    body.push(h("div", { cls: "acct-buttons" }, priceButton(prices.monthly, "month"), priceButton(prices.yearly, "year")));
    body.push(
      h("p", {
        cls: "acct-note",
        text: cfg.billing
          ? "Payment is handled by Stripe. Manage the plan from the account menu afterwards."
          : "Rodeo Plus payments are not set up on this server.",
      }),
    );
  }

  modal = openModal({ title: "Rodeo Plus", cls: "supporter-dialog", body, actions });
}

/** Opens Stripe's billing portal, where a supporter changes or ends the plan. */
export async function managePlan(): Promise<void> {
  try {
    location.href = await billing.portal();
  } catch (err) {
    toast(errorMessage(err));
  }
}

/** What Rodeo Plus gives, against the free plan where it is set. */
export function perksOf(cfg: ServerConfig): string[] {
  const sup = cfg.plans.supporter;
  const free = cfg.plans.free;
  const perks = [
    free.bytes > 0 ? `${formatBytes(sup.bytes)} of cloud storage, against ${formatBytes(free.bytes)} free` : `${formatBytes(sup.bytes)} of cloud storage`,
    sup.versions === 0 ? "Every version of each drawing kept" : `${sup.versions} versions of each drawing kept`,
    sup.files === 0 ? "No limit on the number of drawings" : `Up to ${sup.files} drawings`,
  ];
  if (sup.shareLinks) perks.push("Public share links and embeds");
  perks.push("No ads on the start screen", "A Rodeo Plus badge");
  return perks;
}
