// The admin page's Overview: who is in the editor now (with a small globe of where), the period's
// visitors, sign-ups and use against the period before, the money (credit bought, given and used,
// what it cost, and what is still owed), charts a day, and where visitors came from. It refreshes
// each minute while shown.

import { h } from "../app/dom.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminOverview, AdminPeriod, Tally } from "../platform/protocol.ts";
import { barList, columnChart, lineChart, type Point } from "./charts.ts";
import { type AdminContext, updatedNow } from "./context.ts";
import { bytes, count, country, minutes, money, share, usd } from "./format.ts";
import { liveCard } from "./live.ts";
import { loaded, periodName, tile } from "./ui.ts";

/** the overview is fetched again this often while it is in front */
const REFRESH_MS = 60_000;

const ENTRY_LABEL: Record<string, string> = {
  editor: "Opened Rodeo",
  share: "A share link",
  invite: "An invite",
  embed: "An embedded drawing",
  app: "The installed app",
  convert: "The converter",
};

const DEVICE_LABEL: Record<string, string> = { desktop: "Computer", tablet: "Tablet", phone: "Phone" };

/** the check after a file comes in (feedback/check.ts): asked, then answered, or never */
const CHECK_LABEL: Record<string, string> = {
  asked: "Asked if it looked right",
  ok: "Said it looked right",
  report: "Opened a report",
  closed: "Closed the question",
  failed: "Didn't come in",
};

function points(o: AdminOverview, keys: readonly (keyof AdminOverview["series"][number])[]): Point[] {
  return o.series.map((d) => ({ day: d.day, values: Object.fromEntries(keys.map((k) => [k, Number(d[k])])) }));
}

function visitorTiles(o: AdminOverview): HTMLElement[] {
  const p: AdminPeriod = o.period;
  const b: AdminPeriod = o.previous;
  const name = periodName(o.days);
  return [
    tile({ label: "Visitors", value: count(p.visits), note: `${count(p.guestVisits)} as guests (${share(p.guestVisits, p.visits)}), counted once a day`, delta: { now: p.visits, before: b.visits }, hero: true }, name),
    tile({ label: "Sign-ups", value: count(p.signups), note: p.converted ? `${count(p.converted)} signed up the day they first came` : undefined, delta: { now: p.signups, before: b.signups } }, name),
    tile({ label: "Guests who signed up", value: share(p.converted, p.guestVisits + p.converted), note: "of guests, the same day" }, name),
    tile({ label: "Members who came", value: count(p.activeMembers), note: `of ${count(o.accounts.total)} accounts`, delta: { now: p.activeMembers, before: b.activeMembers } }, name),
    tile({ label: "Typical visit", value: minutes(p.medianMinutes), note: "the middle visit's length", delta: { now: p.medianMinutes, before: b.medianMinutes } }, name),
    tile({ label: "Drawings opened", value: count(p.opens), delta: { now: p.opens, before: b.opens } }, name),
  ];
}

function moneySection(o: AdminOverview): HTMLElement | null {
  const m = o.money;
  const cur = o.currency;
  if (!m || !cur) return null;
  const name = periodName(o.days);
  const used = m.agents + m.renders;
  // what using it cost, in the credit's currency at the rate the server charges by, is unknown
  // here; the providers' dollars are shown as they are
  return h(
    "div",
    { cls: "adm-section" },
    h("h2", { cls: "adm-section-title", text: "AI credit" }),
    h(
      "div",
      { cls: "adm-tiles" },
      tile({ label: "Owed in credit", value: money(m.owed, cur), note: "every balance left: the model provider's balance must cover it" }, name),
      tile({ label: "Bought", value: money(m.topups, cur), note: "top-ups through Stripe" }, name),
      tile({ label: "Given", value: money(m.granted, cur), note: "by admins and welcome credit" }, name),
      tile({ label: "Used", value: money(used, cur), note: `${money(m.agents, cur)} agents · ${money(m.renders, cur)} renders` }, name),
      tile({ label: "Provider cost", value: usd(m.providerUsd), note: "what the model and GPU providers charged for that use" }, name),
    ),
    lineChart(
      "Credit a day",
      null,
      points(o, ["topups", "usage"]),
      [
        { key: "topups", label: "Bought", color: "var(--series-1)" },
        { key: "usage", label: "Used", color: "var(--series-2)" },
      ],
      (n) => money(n, cur),
    ),
  );
}

function lists(o: AdminOverview): HTMLElement {
  const b = o.breakdowns;
  const named = (map: Record<string, string>) => (t: Tally) => map[t.label] ?? t.label;
  return h(
    "div",
    { cls: "adm-lists" },
    barList("Came from", b.referrers, undefined, "No other site has sent anyone yet"),
    barList("How they arrived", b.entries, named(ENTRY_LABEL)),
    barList("Countries", b.countries, (t) => country(t.label)),
    barList("Devices", b.devices, named(DEVICE_LABEL)),
    barList("Browsers", b.browsers),
    barList("Systems", b.systems),
    barList("Drawings opened", b.formats, (t) => (t.label === "blank" ? "New drawing" : `.${t.label}`)),
    barList("After a file came in", b.checks, named(CHECK_LABEL), "Nobody has been asked yet"),
    barList("Campaigns", b.campaigns, undefined, "Tag a link with ?ref=name to see it here"),
  );
}

function inbox(o: AdminOverview): HTMLElement {
  const link = (text: string, href: string, n: number, what: string): HTMLElement =>
    h("a", { cls: n > 0 ? "adm-inbox-item busy" : "adm-inbox-item", attrs: { href } }, h("strong", { text: String(n) }), ` ${what}`, h("span", { cls: "adm-inbox-go", text: text }));
  return h(
    "div",
    { cls: "adm-inbox" },
    link("Open feedback", "#feedback", o.inbox.feedback, o.inbox.feedback === 1 ? "new bug report or idea" : "new bug reports and ideas"),
    link("Open errors", "#errors", o.inbox.errors, o.inbox.errors === 1 ? "error in the last day" : "errors in the last day"),
  );
}

/** The Overview tab: the live card (which keeps itself up to date), then the period's numbers, fetched again each minute. */
export function overviewTab(ctx: AdminContext): HTMLElement {
  return h(
    "div",
    { cls: "adm-overview" },
    liveCard(ctx),
    loaded(ctx.signal, () => adminApi.overview(ctx.days), overviewView, { refresh: REFRESH_MS, onLoad: () => ctx.updated(updatedNow()) }),
  );
}

/** The Overview's numbers for `o`. */
export function overviewView(o: AdminOverview): HTMLElement {
  const a = o.accounts;
  return h(
    "div",
    { cls: "adm-overview-body" },
    h("div", { cls: "adm-tiles" }, ...visitorTiles(o)),
    h(
      "div",
      { cls: "adm-charts" },
      columnChart(
        "Visitors a day",
        "A visitor is counted once a day; signed in means at any point that day.",
        points(o, ["guests", "members"]),
        [
          { key: "guests", label: "Guests", color: "var(--series-1)" },
          { key: "members", label: "Signed in", color: "var(--series-2)" },
        ],
        (n) => count(Math.round(n)),
      ),
      columnChart("Sign-ups a day", null, points(o, ["signups"]), [{ key: "signups", label: "Sign-ups", color: "var(--series-1)" }], (n) => count(Math.round(n))),
    ),
    h(
      "div",
      { cls: "adm-section" },
      h("h2", { cls: "adm-section-title", text: "Accounts" }),
      h(
        "div",
        { cls: "adm-tiles" },
        tile({ label: "Accounts", value: count(a.total), note: a.suspended ? `${a.suspended} suspended` : undefined }, ""),
        tile({ label: "Rodeo Plus", value: count(a.plus), note: `${a.plusPaid} paying, ${a.plus - a.plusPaid} given` }, ""),
        tile({ label: "Cloud drawings", value: count(a.files), note: `${bytes(a.bytes)} with every version` }, ""),
      ),
      inbox(o),
    ),
    moneySection(o),
    h("div", { cls: "adm-section" }, h("h2", { cls: "adm-section-title", text: "Where visitors come from" }), lists(o)),
  );
}
