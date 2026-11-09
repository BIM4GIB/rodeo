// The admin page's Settings: the AI credit each new account starts with, a maker of tagged links
// (?ref=) whose visits show under Campaigns, and how visits are counted.

import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminContext } from "./context.ts";
import { money } from "./format.ts";

function card(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", { cls: "adm-card adm-settings-card" }, h("h3", { cls: "adm-card-title", text: title }), ...children);
}

function welcomeCard(currency: string): HTMLElement {
  const input = h("input", { cls: "adm-input adm-amount", attrs: { type: "number", min: "0", max: "50", step: "0.5", inputmode: "decimal", "aria-label": "Welcome credit" }, disabled: true });
  const save = h("button", { cls: "adm-btn primary", text: "Save", attrs: { type: "button" }, disabled: true });
  const status = h("p", { cls: "adm-muted", attrs: { role: "status" } });
  const shown = (n: number): void => {
    input.value = String(n);
    status.textContent = n > 0 ? `New accounts start with ${money(n, currency)}.` : "New accounts start with no credit.";
  };
  adminApi
    .settings()
    .then((s) => {
      shown(s.welcomeCredit);
      input.disabled = false;
      save.disabled = false;
    })
    .catch((err: unknown) => (status.textContent = errorMessage(err)));
  save.addEventListener("click", () => {
    save.disabled = true;
    adminApi
      .saveSettings({ welcomeCredit: Number(input.value) || 0 })
      .then((s) => shown(s.welcomeCredit))
      .catch((err: unknown) => (status.textContent = errorMessage(err)))
      .finally(() => (save.disabled = false));
  });
  return card(
    "Welcome credit",
    h("p", { cls: "adm-card-note", text: "AI credit each new account starts with, so people can try the agents before they buy any. It shows in their history as Welcome credit. Anyone can make an account with a new email address, so keep it small." }),
    h("div", { cls: "adm-actions" }, input, save),
    status,
  );
}

function linkCard(): HTMLElement {
  const name = h("input", { cls: "adm-input", placeholder: "e.g. newsletter, reddit, talk-nov", attrs: { type: "text", maxlength: "40", "aria-label": "Campaign name" } });
  const out = h("code", { cls: "adm-link-out" });
  const copy = h("button", { cls: "adm-btn", text: "Copy", attrs: { type: "button" }, disabled: true });
  const update = (): void => {
    const tag = name.value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    out.textContent = tag ? `${location.origin}/?ref=${tag}` : "";
    copy.disabled = !tag;
  };
  name.addEventListener("input", update);
  copy.addEventListener("click", () => {
    void navigator.clipboard.writeText(out.textContent ?? "").then(() => {
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 1500);
    });
  });
  return card(
    "Tagged links",
    h("p", { cls: "adm-card-note", text: "Share a link with a tag on it, and the visits it brings show under Campaigns on the Overview. Links tagged ?utm_source= count too." }),
    name,
    h("div", { cls: "adm-actions" }, out, copy),
  );
}

function aboutCard(): HTMLElement {
  return card(
    "How visits are counted",
    h(
      "p",
      { cls: "adm-card-note", text: "The editor tells the server when it opens, each minute while it's in front, and when a drawing opens (its kind, never its name). No cookie is set and nothing is kept on the visitor's device. The server knows a visitor by a hash of their address and browser with a salt that changes every day, so each person counts once a day and can't be followed from one day to the next; addresses aren't kept. Where a visit came from is Cloudflare's guess from the address: the country, and with Cloudflare's visitor location headers on, the city and a position rounded to about 10 km. Test browsers and crawlers aren't counted, and neither are admins when signed in." },
    ),
  );
}

export function settingsView(ctx: AdminContext): HTMLElement {
  return h("div", { cls: "adm-settings" }, ctx.currency ? welcomeCard(ctx.currency) : null, linkCard(), aboutCard());
}
