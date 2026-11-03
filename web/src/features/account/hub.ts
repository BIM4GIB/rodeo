// The start hub's Donate link, in its footer: shown once the server has answered with donation
// links or a goal, it opens the funding dialog (this month's hosting and the links).

import { h } from "../../app/dom.ts";
import { config, onConfig } from "./config.ts";
import { openFundingDialog } from "./funding.ts";

export function donateLink(): HTMLElement {
  const link = h("button", { cls: "hub-link", text: "Donate", hidden: true, attrs: { type: "button" } });
  link.addEventListener("click", openFundingDialog);
  onConfig(() => {
    link.hidden = !config()?.funding;
  });
  return link;
}
