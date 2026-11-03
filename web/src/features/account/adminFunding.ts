// Help > Funding and Sponsor Settings… (admins only): the month's hosting goal, what it has
// raised besides the Stripe donation link (which the server counts itself), the donation links
// (one per line, "Label | URL") and the start hub's sponsor. Saved to the server; the editor then takes the new config. The dialog stays open
// when a save fails, so nothing typed is lost.

import { h } from "../../app/dom.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { billing, currentUser } from "../../platform/api.ts";
import type { Funding, FundingLink, Sponsor } from "../../platform/protocol.ts";
import { config, reloadConfig } from "./config.ts";
import { field, footButton, openModal, type Modal } from "./dialog.ts";
import { isWebUrl } from "./format.ts";

/** The dialog's controls, read together when it is saved. */
interface Form {
  readonly currency: HTMLInputElement;
  readonly goal: HTMLInputElement;
  readonly raised: HTMLInputElement;
  readonly links: HTMLTextAreaElement;
  readonly noSponsor: HTMLInputElement;
  readonly name: HTMLInputElement;
  readonly text: HTMLTextAreaElement;
  readonly url: HTMLInputElement;
  readonly image: HTMLInputElement;
  readonly cta: HTMLInputElement;
}

export function openFundingSettings(): void {
  const cfg = config();
  if (!cfg || currentUser()?.admin !== true) return;
  const funding = cfg.funding;
  const sponsor = cfg.sponsor;
  let modal: Modal | null = null;

  const text = (value: string, attrs: Record<string, string> = {}): HTMLInputElement =>
    h("input", { cls: "acct-input", value, attrs: { type: "text", autocomplete: "off", spellcheck: "false", ...attrs } });
  const form: Form = {
    currency: text(funding?.currency ?? "GBP", { maxlength: "3" }),
    goal: text(String(funding?.goalMonthly ?? 0), { inputmode: "numeric" }),
    raised: text(String(funding?.raisedThisMonth ?? 0), { inputmode: "numeric" }),
    links: h("textarea", {
      cls: "acct-input acct-textarea",
      value: (funding?.links ?? []).map((l) => `${l.label} | ${l.url}`).join("\n"),
      attrs: { rows: "4", spellcheck: "false", "aria-label": "Donation links" },
    }),
    noSponsor: h("input", { checked: sponsor === null, attrs: { type: "checkbox" } }),
    name: text(sponsor?.name ?? ""),
    text: h("textarea", { cls: "acct-input acct-textarea", value: sponsor?.text ?? "", attrs: { rows: "2", "aria-label": "Sponsor text" } }),
    url: text(sponsor?.url ?? "", { type: "url", inputmode: "url", placeholder: "https://" }),
    image: text(sponsor?.image ?? "", { type: "url", inputmode: "url", placeholder: "https:// (optional)" }),
    cta: text(sponsor?.cta ?? "Visit"),
  };
  const sponsorControls: (HTMLInputElement | HTMLTextAreaElement)[] = [form.name, form.text, form.url, form.image, form.cta];
  const syncSponsor = (): void => {
    for (const c of sponsorControls) c.disabled = form.noSponsor.checked;
  };
  form.noSponsor.addEventListener("change", syncSponsor);
  syncSponsor();

  const saveButton = footButton("Save", true, () => void save());
  const save = async (): Promise<void> => {
    modal?.error(null);
    const next = readForm(form, sponsor);
    if (typeof next === "string") {
      modal?.error(next);
      return;
    }
    saveButton.disabled = true;
    try {
      await billing.setFunding(next.funding);
      await billing.setSponsor(next.sponsor);
      await reloadConfig();
      modal?.close();
      toast("Funding and sponsor settings saved.", "info");
    } catch (err) {
      saveButton.disabled = false;
      modal?.error(errorMessage(err));
    }
  };

  modal = openModal({
    title: "Funding and Sponsor Settings",
    cls: "admin-dialog",
    body: [
      h("p", { cls: "acct-section", text: "Hosting" }),
      field("Currency (a code, such as GBP)", form.currency),
      h("div", { cls: "acct-row" }, field("Goal per month", form.goal), field("Raised elsewhere this month", form.raised)),
      h("p", { cls: "acct-note", text: "Donations through a Stripe donation link are added on their own each month." }),
      field("Donation links, one per line: Label | https://…", form.links),
      h("p", { cls: "acct-section", text: "Sponsor" }),
      h("label", { cls: "menu-dialog-check" }, form.noSponsor, "No sponsor"),
      field("Name", form.name),
      field("Text", form.text),
      field("Link", form.url),
      field("Image (optional)", form.image),
      field("Button text", form.cta),
    ],
    actions: [footButton("Cancel", false, () => modal?.close()), saveButton],
  });
}

/** The settings typed, checked; or what is wrong with them. */
function readForm(form: Form, previous: Sponsor | null): { funding: Funding; sponsor: Sponsor | null } | string {
  const currency = form.currency.value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return "Currency: enter a three-letter code, such as GBP.";
  const goal = wholeNumber(form.goal.value);
  if (goal === null) return "Goal per month: enter a whole number of currency units.";
  const raised = wholeNumber(form.raised.value);
  if (raised === null) return "Raised this month: enter a whole number of currency units.";

  const links: FundingLink[] = [];
  const lines = form.links.value.split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== "");
  for (const [i, line] of lines.entries()) {
    const bar = line.indexOf("|");
    const label = bar < 0 ? "" : line.slice(0, bar).trim();
    const url = bar < 0 ? "" : line.slice(bar + 1).trim();
    if (!label || !isWebUrl(url)) return `Donation link ${i + 1}: write it as "Label | https://…".`;
    links.push({ label, url });
  }

  let sponsor: Sponsor | null = null;
  if (!form.noSponsor.checked) {
    const name = form.name.value.trim();
    const url = form.url.value.trim();
    const image = form.image.value.trim();
    if (!name) return "Sponsor name: enter the sponsor's name, or tick No sponsor.";
    if (!isWebUrl(url)) return "Sponsor link: enter the web address the card goes to.";
    if (image && !isWebUrl(image)) return "Sponsor image: enter a web address, or leave it empty.";
    sponsor = {
      id: sponsorId(previous, name, url),
      name,
      text: form.text.value.trim(),
      url,
      image: image || null,
      cta: form.cta.value.trim() || "Visit",
    };
  }
  return { funding: { currency, goalMonthly: goal, raisedThisMonth: raised, links }, sponsor };
}

/** A non-negative whole number, or null. */
function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/**
 * The sponsor's id. The one it had is kept while its name and link are unchanged, so a
 * visitor who hid the card stops seeing it; a new sponsor gets a new id, so its card shows.
 */
function sponsorId(previous: Sponsor | null, name: string, url: string): string {
  if (previous && previous.name === name && previous.url === url) return previous.id;
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
