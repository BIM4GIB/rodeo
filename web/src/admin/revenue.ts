// The admin page's Revenue: Rodeo Plus (paying, and given free), the AI credit's money a day
// (bought, taken for use, what the model providers charged, and the margin between them), the
// agents' use by model, cloud renders, and the accounts that used the most credit. Fetched each
// time the tab opens.

import { h } from "../app/dom.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminRevenue } from "../platform/protocol.ts";
import { lineChart, type Point } from "./charts.ts";
import { type AdminContext, updatedNow } from "./context.ts";
import { count, minutes, money, share, usd } from "./format.ts";
import { emptyView, loaded, periodName, section, tile, tiles } from "./ui.ts";
import "./revenue.css";

/** A fraction as a percentage, with the minus sign the rest of the page uses: "38%", "−3%". */
function percent(p: number): string {
  const r = Math.round(p * 100);
  return `${r < 0 ? "−" : ""}${Math.abs(r)}%`;
}

/** What use brought in over what the providers charged, as a share of what use brought in; null with nothing taken. */
function marginOf(charged: number, cost: number): number | null {
  return charged > 0 ? (charged - cost) / charged : null;
}

/**
 * The providers' dollars in the credit's currency, at the server's rate (the margin's cost over
 * the dollars it came from). Without a total to take the rate from, the dollars stay as they are.
 */
function rateOf(d: AdminRevenue): number {
  const dollars = d.daily.reduce((s, x) => s + x.costUsd, 0);
  return d.margin && dollars > 0 ? d.margin.cost / dollars : 1;
}

/** The period under a section's title: "Over the last week". */
function since(days: number): string {
  return `Over the last ${periodName(days)}`;
}

/** A tile whose value is in the bad colour when `bad`. */
function badValue(t: HTMLElement, bad: boolean): HTMLElement {
  if (bad) t.querySelector(".adm-tile-value")?.classList.add("adm-rev-bad");
  return t;
}

function plusSection(d: AdminRevenue): HTMLElement {
  const p = d.plus;
  return section(
    "Rodeo Plus",
    null,
    tiles(
      tile({ label: "Paying", value: count(p.paid), note: `${p.monthlyLabel} or ${p.yearlyLabel}` }),
      tile({ label: "Given by admins", value: count(p.given) }),
    ),
  );
}

function creditSection(d: AdminRevenue, cur: string): HTMLElement {
  const sum = (pick: (x: AdminRevenue["daily"][number]) => number): number => d.daily.reduce((s, x) => s + pick(x), 0);
  const bought = sum((x) => x.topups);
  const taken = sum((x) => x.charged);
  const dollars = sum((x) => x.costUsd);
  const rate = rateOf(d);
  const margin = d.margin ? marginOf(d.margin.charged, d.margin.cost) : null;
  const points: Point[] = d.daily.map((x) => ({ day: x.day, values: { bought: x.topups, taken: x.charged, cost: x.costUsd * rate } }));
  return section(
    "AI credit",
    since(d.days),
    tiles(
      tile({ label: "Bought", value: money(bought, cur), note: "top-ups through Stripe" }),
      tile({ label: "Taken for use", value: money(taken, cur) }),
      tile({ label: "Provider cost", value: usd(dollars), note: "what the model and GPU providers charged for that use" }),
      badValue(
        tile({
          label: "Margin",
          value: margin === null ? "–" : percent(margin),
          note: "what use brought in over what the providers charged, at the server's exchange rate",
        }),
        margin !== null && margin < 0,
      ),
    ),
    lineChart(
      "Credit a day",
      "Provider cost is shown in the credit's currency, at the server's exchange rate.",
      points,
      [
        { key: "bought", label: "Bought", color: "var(--series-1)" },
        { key: "taken", label: "Taken", color: "var(--series-2)" },
        { key: "cost", label: "Provider cost", color: "var(--adm-series-3)" },
      ],
      (n) => money(n, cur),
    ),
  );
}

function marginCell(margin: number | null): HTMLElement {
  return h("td", { cls: margin !== null && margin < 0 ? "num adm-rev-bad" : "num", text: margin === null ? "–" : percent(margin) });
}

function modelsSection(d: AdminRevenue, cur: string): HTMLElement {
  const rate = rateOf(d);
  const sum = (pick: (m: AdminRevenue["models"][number]) => number): number => d.models.reduce((s, m) => s + pick(m), 0);
  const charged = sum((m) => m.charged);
  const cost = sum((m) => m.costUsd);
  const rows = d.models.map((m) =>
    h(
      "tr",
      {},
      h("td", { text: m.model }),
      h("td", { cls: "num", text: count(m.steps) }),
      h("td", { cls: "num", text: count(m.users) }),
      h("td", { cls: "num", text: money(m.charged, cur) }),
      h("td", { cls: "num", text: usd(m.costUsd) }),
      h("td", { cls: "num adm-rev-tokens", text: `${count(m.tokensIn)} / ${count(m.tokensOut)}` }),
      marginCell(marginOf(m.charged, m.costUsd * rate)),
    ),
  );
  const total = h(
    "tr",
    { cls: "adm-rev-total" },
    h("td", { text: "All models" }),
    h("td", { cls: "num", text: count(sum((m) => m.steps)) }),
    // one account can use several models, so the accounts can't be added up
    h("td", { cls: "num", text: "–", title: "An account can use more than one model, so accounts are not added up" }),
    h("td", { cls: "num", text: money(charged, cur) }),
    h("td", { cls: "num", text: usd(cost) }),
    h("td", { cls: "num adm-rev-tokens", text: `${count(sum((m) => m.tokensIn))} / ${count(sum((m) => m.tokensOut))}` }),
    marginCell(marginOf(charged, cost * rate)),
  );
  const body =
    d.models.length === 0
      ? emptyView("No agent use in this period.")
      : h(
          "div",
          { cls: "adm-card adm-table-card" },
          h(
            "div",
            { cls: "adm-table-wrap" },
            h(
              "table",
              { cls: "adm-table" },
              h(
                "thead",
                {},
                h(
                  "tr",
                  {},
                  h("th", { text: "Model" }),
                  h("th", { cls: "num", text: "Steps" }),
                  h("th", { cls: "num", text: "Accounts" }),
                  h("th", { cls: "num", text: "Taken" }),
                  h("th", { cls: "num", text: "Provider cost" }),
                  h("th", { cls: "num adm-rev-tokens", text: "Tokens in / out" }),
                  h("th", { cls: "num", text: "Margin" }),
                ),
              ),
              h("tbody", {}, ...rows, total),
            ),
          ),
        );
  return section("By model", since(d.days), body);
}

function rendersSection(d: AdminRevenue, cur: string): HTMLElement {
  const r = d.renders;
  return section(
    "Cloud renders",
    since(d.days),
    tiles(
      tile({ label: "Jobs", value: count(r.jobs) }),
      tile({ label: "Finished", value: count(r.finished) }),
      tile({ label: "Failed", value: count(r.failed), note: r.jobs > 0 ? `${share(r.failed, r.jobs)} of jobs` : undefined }),
      tile({ label: "GPU time", value: r.gpuSeconds > 0 ? minutes(r.gpuSeconds / 60) : "–" }),
      tile({ label: "Taken", value: money(r.charged, cur) }),
    ),
  );
}

function spendersSection(d: AdminRevenue, cur: string): HTMLElement {
  const body =
    d.topSpenders.length === 0
      ? emptyView("Nobody used credit in this period.")
      : h(
          "div",
          { cls: "adm-card adm-table-card" },
          h(
            "div",
            { cls: "adm-table-wrap" },
            h(
              "table",
              { cls: "adm-table" },
              h("thead", {}, h("tr", {}, h("th", { text: "Name" }), h("th", { cls: "num", text: "Used" }), h("th", { cls: "num", text: "Bought" }))),
              h(
                "tbody",
                {},
                ...d.topSpenders.map((p) =>
                  h(
                    "tr",
                    {},
                    h(
                      "td",
                      {},
                      h(
                        "span",
                        { cls: "adm-rev-who" },
                        h("span", { text: p.name || p.email }),
                        p.name ? h("span", { cls: "adm-rev-email", text: p.email }) : null,
                      ),
                    ),
                    h("td", { cls: "num", text: money(p.spent, cur) }),
                    h("td", { cls: "num", text: money(p.bought, cur) }),
                  ),
                ),
              ),
            ),
          ),
        );
  return section("Top spenders", since(d.days), body);
}

function body(d: AdminRevenue): HTMLElement {
  const cur = d.currency;
  if (!cur) {
    return h("div", { cls: "adm-rev-body" }, plusSection(d), emptyView("This server has no AI credit, so there is nothing more to show here."));
  }
  return h("div", { cls: "adm-rev-body" }, plusSection(d), creditSection(d, cur), modelsSection(d, cur), rendersSection(d, cur), spendersSection(d, cur));
}

/** The Revenue tab: the period's money, fetched when the tab opens. */
export function revenueView(ctx: AdminContext): HTMLElement {
  return loaded(ctx.signal, () => adminApi.revenue(ctx.days), body, { onLoad: () => ctx.updated(updatedNow()) });
}
