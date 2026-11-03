// Help > Support Rodeo… and the start hub's Donate link: what Rodeo costs a month, how much of
// this month is covered, and the donation links the server holds. Kept low-key: it opens only
// when asked for. Shown only when the server has funding set up.

import { h } from "../../app/dom.ts";
import { currentUser } from "../../platform/api.ts";
import type { Funding } from "../../platform/protocol.ts";
import { config } from "./config.ts";
import { footButton, openModal, type Modal } from "./dialog.ts";
import { isWebUrl, moneyFormatter } from "./format.ts";
import { openSupporterDialog } from "./supporter.ts";

/** What this month's donations come to: those an admin put down and those through the Stripe link. */
function covered(funding: Funding): number {
  return funding.raisedThisMonth + (funding.donatedThisMonth ?? 0);
}

/** How much of this month's hosting goal is covered, 0 to 100. */
function coveredPercent(funding: Funding): number {
  return funding.goalMonthly > 0 ? Math.min(100, (covered(funding) / funding.goalMonthly) * 100) : 0;
}

/** The bar of coveredPercent. Shown only when there is a goal (a goal of 0 has no bar). */
function hostingBar(funding: Funding): HTMLElement {
  const covered = coveredPercent(funding);
  const fill = h("div", { cls: "acct-bar-fill" });
  fill.style.width = `${covered}%`;
  return h(
    "div",
    {
      cls: "acct-bar",
      attrs: {
        role: "progressbar",
        "aria-label": "Hosting covered this month",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round(covered)),
      },
    },
    fill,
  );
}

export function openFundingDialog(): void {
  const cfg = config();
  const funding = cfg?.funding;
  if (!cfg || !funding) return;
  let modal: Modal | null = null;

  const money = moneyFormatter(funding.currency);
  const goal = funding.goalMonthly;
  const body: Node[] = [h("p", { cls: "acct-lead", text: "If Rodeo is useful to you, you can chip in toward its running costs." })];
  if (goal > 0) body.push(hostingBar(funding), h("p", { cls: "acct-note", text: `${money(covered(funding))} of ${money(goal)} this month` }));

  const links = funding.links
    .filter((l) => isWebUrl(l.url))
    .map((l, i) => h("a", { cls: i === 0 ? "btn primary" : "btn", text: l.label, attrs: { href: l.url, target: "_blank", rel: "noopener" } }));
  if (links.length) body.push(h("div", { cls: "acct-links" }, ...links));

  const actions = [footButton("Close", false, () => modal?.close())];
  // Rodeo Plus also pays for the hosting, so it is offered here too, quietly
  if (cfg.billing && currentUser()?.plan !== "supporter") {
    actions.unshift(
      footButton("Rodeo Plus…", false, () => {
        modal?.close();
        openSupporterDialog();
      }),
    );
  }
  modal = openModal({ title: "Support Rodeo", body, actions });
}
