// The start hub's one ad, under Recent: the sponsor an admin set (Help > Funding and Sponsor
// Settings), or else Carbon's ad when the server has a Carbon placement (CARBON_SERVE and
// CARBON_PLACEMENT). Never for Rodeo Plus members; where billing is set up its head offers them
// Plus with "Remove ads". The hub is never over a drawing unless asked for, so the ad never is.
// Carbon's script loads the first time the slot has it to show, and the slot stays hidden until
// Carbon fills it (no ad to show, or a blocker, leaves it hidden). Carbon refreshes an ad only
// on a new page, so the one it gives stays until the page reloads.

import { h } from "../../app/dom.ts";
import { currentUser, onUser, userLoaded } from "../../platform/api.ts";
import type { CarbonAd, Sponsor } from "../../platform/protocol.ts";
import { config, onConfig } from "./config.ts";
import { isWebUrl } from "./format.ts";
import { openSupporterDialog } from "./supporter.ts";

export function adCard(): HTMLElement {
  const remove = h("button", { cls: "hub-link hub-ad-remove", text: "Remove ads", hidden: true, attrs: { type: "button" } });
  remove.addEventListener("click", () => openSupporterDialog());
  const body = h("div", { cls: "hub-ad-body" });
  const card = h(
    "aside",
    { cls: "hub-ad", hidden: true, attrs: { "aria-label": "Sponsored" } },
    h("div", { cls: "hub-ad-head" }, h("span", { cls: "hub-heading", text: "Sponsored" }), remove),
    body,
  );

  // Carbon's block, made once; it is filled when Carbon's script adds its ad to it
  let carbon: HTMLElement | null = null;
  let carbonFilled = false;

  const render = (): void => {
    const cfg = config();
    const shown = cfg !== null && userLoaded() && currentUser()?.plan !== "supporter";
    const sponsor = shown && cfg.sponsor && isWebUrl(cfg.sponsor.url) ? cfg.sponsor : null;
    remove.hidden = !cfg?.billing;
    if (sponsor) {
      card.hidden = false;
      body.replaceChildren(sponsorRow(sponsor));
    } else if (shown && cfg.carbon) {
      if (!carbon) {
        carbon = carbonBlock(cfg.carbon, () => {
          carbonFilled = true;
          render();
        });
      }
      card.hidden = !carbonFilled;
      body.replaceChildren(carbon);
    } else {
      card.hidden = true;
      body.replaceChildren();
    }
  };
  onConfig(render);
  onUser(render);
  return card;
}

/** The sponsor: its picture, name and line, and its link. */
function sponsorRow(s: Sponsor): HTMLElement {
  const picture = s.image && isWebUrl(s.image) ? h("img", { cls: "hub-ad-img", attrs: { src: s.image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }) : null;
  return h(
    "a",
    { cls: "hub-ad-sponsor", attrs: { href: s.url, target: "_blank", rel: "noopener sponsored" } },
    picture,
    h("span", { cls: "hub-ad-text" }, h("strong", { text: s.name }), s.text ? h("span", { text: s.text }) : null),
    h("span", { cls: "btn small", text: s.cta || "Visit" }),
  );
}

/** A block holding Carbon's script, which puts its ad (#carbonads) beside itself; `filled` runs when it has. */
function carbonBlock(c: CarbonAd, filled: () => void): HTMLElement {
  const block = h("div", { cls: "hub-ad-carbon" });
  const watch = new MutationObserver(() => {
    if (!block.querySelector("#carbonads")) return;
    watch.disconnect();
    filled();
  });
  watch.observe(block, { childList: true, subtree: true });
  const script = document.createElement("script");
  script.async = true;
  script.id = "_carbonads_js";
  script.src = `https://cdn.carbonads.com/carbon.js?serve=${encodeURIComponent(c.serve)}&placement=${encodeURIComponent(c.placement)}`;
  block.append(script);
  return block;
}
