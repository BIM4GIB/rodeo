// The admin page's Funding and sponsor: what hosting costs a month and what has come in toward it
// (the bar in Help > Support Rodeo), the donation links, and the sponsor card on the start hub.
// One Save writes both to the server. Each card shows how it will look to visitors, as it is typed.
// A save that fails keeps what was typed.

import "./manage.css";
import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { isWebUrl } from "../features/account/format.ts";
import { billing } from "../platform/api.ts";
import type { Funding, FundingLink, Sponsor } from "../platform/protocol.ts";
import type { AdminContext } from "./context.ts";
import { money } from "./format.ts";
import { card, section } from "./ui.ts";

/** The page's controls, read together when it is saved. */
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

function textInput(value: string, attrs: Record<string, string> = {}): HTMLInputElement {
  return h("input", { cls: "adm-input", value, attrs: { type: "text", autocomplete: "off", spellcheck: "false", ...attrs } });
}

/** A labelled control, the label above it. */
function field(label: string, control: HTMLElement): HTMLElement {
  return h("label", { cls: "adm-fund-field" }, h("span", { text: label }), control);
}

/** A non-negative whole number, or null. */
function wholeNumber(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** The donation links as typed, the lines that read "Label | https://…" and have a web address. */
function linksTyped(text: string): FundingLink[] {
  const out: FundingLink[] = [];
  for (const line of text.split(/\r?\n/)) {
    const sep = line.indexOf("|");
    if (sep < 0) continue;
    const label = line.slice(0, sep).trim();
    const url = line.slice(sep + 1).trim();
    if (label && isWebUrl(url)) out.push({ label, url });
  }
  return out;
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
    const sep = line.indexOf("|");
    const label = sep < 0 ? "" : line.slice(0, sep).trim();
    const url = sep < 0 ? "" : line.slice(sep + 1).trim();
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

/**
 * The sponsor's id. The one it had is kept while its name and link are unchanged, so a visitor who
 * hid the card stops seeing it; a new sponsor gets a new id, so its card shows.
 */
function sponsorId(previous: Sponsor | null, name: string, url: string): string {
  if (previous && previous.name === name && previous.url === url) return previous.id;
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The goal's bar: how much of it is covered, 0 to 100. */
function bar(covered: number, goal: number): HTMLElement {
  const pct = Math.min(100, (covered / goal) * 100);
  const fill = h("span", { cls: "adm-fund-fill" });
  fill.style.width = `${pct}%`;
  return h(
    "div",
    {
      cls: "adm-fund-bar",
      attrs: { role: "progressbar", "aria-label": "Hosting covered this month", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(Math.round(pct)) },
    },
    fill,
  );
}

/** The Support Rodeo dialog as visitors see it: the bar when there is a goal, then the donation links. */
function hostingPreview(form: Form, donated: number): Node[] {
  const currency = form.currency.value.trim().toUpperCase();
  const goal = wholeNumber(form.goal.value) ?? 0;
  const covered = (wholeNumber(form.raised.value) ?? 0) + donated;
  const out: Node[] = [h("p", { cls: "adm-fund-title", text: "Support Rodeo, as visitors see it" })];
  if (goal > 0) {
    out.push(bar(covered, goal), h("p", { cls: "adm-muted", text: `${money(covered, currency, true)} of ${money(goal, currency, true)} this month` }));
  } else {
    out.push(h("p", { cls: "adm-muted", text: "No goal set, so there is no bar." }));
  }
  const links = linksTyped(form.links.value);
  if (links.length > 0) out.push(h("div", { cls: "adm-fund-links" }, ...links.map((l) => h("span", { cls: "adm-btn small", text: l.label }))));
  return out;
}

/** The start hub's sponsor card as visitors see it, or what shows instead. */
function sponsorPreview(form: Form, carbon: boolean): Node[] {
  if (form.noSponsor.checked) {
    return [h("p", { cls: "adm-muted", text: carbon ? "No sponsor: Carbon's ad shows here instead." : "No sponsor: no ad shows here." })];
  }
  const image = form.image.value.trim();
  const url = form.url.value.trim();
  const text = form.text.value.trim();
  const out: Node[] = [
    h("p", { cls: "adm-fund-title", text: "On the start hub" }),
    h(
      "div",
      { cls: "adm-fund-ad" },
      isWebUrl(image) ? h("img", { cls: "adm-fund-ad-img", attrs: { src: image, alt: "", loading: "lazy", referrerpolicy: "no-referrer" } }) : null,
      h(
        "span",
        { cls: "adm-fund-ad-text" },
        h("strong", { text: form.name.value.trim() || "Sponsor name" }),
        text ? h("span", { text }) : null,
      ),
      h("span", { cls: "adm-btn small", text: form.cta.value.trim() || "Visit" }),
    ),
  ];
  if (!isWebUrl(url)) out.push(h("p", { cls: "adm-muted", text: "The card shows once its link is a web address." }));
  return out;
}

export function fundingView(ctx: AdminContext): HTMLElement {
  const funding = ctx.config.funding;
  const sponsor = ctx.config.sponsor ?? null;
  // Stripe donations counted by the server; the save doesn't return them, so the page keeps the figure it opened with
  const donated = funding?.donatedThisMonth ?? 0;
  const carbon = Boolean(ctx.config.carbon);
  // the sponsor last saved: the next save keeps its id while its name and link are unchanged
  let saved: Sponsor | null = sponsor;

  const form: Form = {
    currency: textInput(funding?.currency ?? "GBP", { maxlength: "3" }),
    goal: textInput(String(funding?.goalMonthly ?? 0), { inputmode: "numeric" }),
    raised: textInput(String(funding?.raisedThisMonth ?? 0), { inputmode: "numeric" }),
    links: h("textarea", {
      cls: "adm-input",
      value: (funding?.links ?? []).map((l) => `${l.label} | ${l.url}`).join("\n"),
      attrs: { rows: "4", spellcheck: "false" },
    }),
    noSponsor: h("input", { checked: sponsor === null, attrs: { type: "checkbox" } }),
    name: textInput(sponsor?.name ?? "", { maxlength: "80" }),
    text: h("textarea", { cls: "adm-input", value: sponsor?.text ?? "", attrs: { rows: "2", maxlength: "300" } }),
    url: textInput(sponsor?.url ?? "", { type: "url", inputmode: "url", placeholder: "https://" }),
    image: textInput(sponsor?.image ?? "", { type: "url", inputmode: "url", placeholder: "https:// (optional)" }),
    cta: textInput(sponsor?.cta ?? "Visit", { maxlength: "24" }),
  };
  const sponsorInputs: (HTMLInputElement | HTMLTextAreaElement)[] = [form.name, form.text, form.url, form.image, form.cta];

  const hostingBox = h("div", { cls: "adm-fund-preview" });
  const sponsorBox = h("div", { cls: "adm-fund-preview" });
  const drawPreviews = (): void => {
    hostingBox.replaceChildren(...hostingPreview(form, donated));
    sponsorBox.replaceChildren(...sponsorPreview(form, carbon));
  };
  const syncSponsor = (): void => {
    for (const c of sponsorInputs) c.disabled = form.noSponsor.checked;
  };

  const hosting = card(
    "Hosting",
    h("p", {
      cls: "adm-card-note",
      text: "What hosting costs a month, and what has come in toward it. Donations through a Stripe donation link are added on their own each month.",
    }),
    field("Currency (a code, such as GBP)", form.currency),
    h("div", { cls: "adm-fund-row" }, field("Goal per month", form.goal), field("Raised elsewhere this month", form.raised)),
    field("Donation links, one per line: Label | https://…", form.links),
    hostingBox,
  );
  const sponsorCard = card(
    "Sponsor",
    h("p", { cls: "adm-card-note", text: "The card under Recent on the start hub. Carbon Ads run only while there is no sponsor." }),
    h("label", { cls: "adm-check" }, form.noSponsor, "No sponsor"),
    field("Name", form.name),
    field("Text", form.text),
    field("Link", form.url),
    field("Image (optional)", form.image),
    field("Button text", form.cta),
    sponsorBox,
  );

  const status = h("p", { cls: "adm-muted", attrs: { role: "status" } });
  const error = h("p", { cls: "adm-error", attrs: { role: "alert" }, hidden: true });
  const saveButton = h("button", { cls: "adm-btn primary", text: "Save", attrs: { type: "button" } });

  const save = async (): Promise<void> => {
    error.hidden = true;
    status.textContent = "";
    const next = readForm(form, saved);
    if (typeof next === "string") {
      error.textContent = next;
      error.hidden = false;
      return;
    }
    saveButton.disabled = true;
    try {
      await billing.setFunding(next.funding);
      await billing.setSponsor(next.sponsor);
      saved = next.sponsor;
      status.textContent = "Saved";
    } catch (err) {
      error.textContent = errorMessage(err);
      error.hidden = false;
    } finally {
      saveButton.disabled = false;
    }
  };
  saveButton.addEventListener("click", () => void save());

  const body = h(
    "div",
    { cls: "adm-fund-wrap" },
    h("div", { cls: "adm-fund" }, hosting, sponsorCard),
    h("div", { cls: "adm-fund-save" }, error, h("div", { cls: "adm-actions" }, saveButton, status)),
  );
  // what is typed shows in the previews at once, and "Saved" goes once something changes
  body.addEventListener("input", () => {
    status.textContent = "";
    drawPreviews();
  });
  body.addEventListener("change", () => {
    status.textContent = "";
    syncSponsor();
    drawPreviews();
  });
  syncSponsor();
  drawPreviews();

  return section("Funding and sponsor", "What Rodeo costs a month, and the sponsor card on the start hub. One Save writes both.", body);
}
