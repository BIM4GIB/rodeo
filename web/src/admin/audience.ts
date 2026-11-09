// The admin page's Audience tab: where visitors are (a globe with a dot a place, the countries and
// the cities), the accounts in Rodeo each day, when visits happen and how long they last, the
// steps from a visit to paying, whether sign-up weeks come back, and the signed-in visitors a day.
// It is fetched when the tab opens, for the period picked in the header.

import "./audience.css";
import { h } from "../app/dom.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminCountry, AdminEngagement, AdminGeo, AdminPlace, Tally } from "../platform/protocol.ts";
import { barList, columnChart, lineChart, type Point } from "./charts.ts";
import { cohortTable, funnel, heatmap } from "./audienceCharts.ts";
import { type AdminContext, updatedNow } from "./context.ts";
import { count, country, minutes, share } from "./format.ts";
import { countryCentre, globe, type Globe, type GlobeDot } from "./globe.ts";
import { card, emptyView, loaded, section, tile, tiles } from "./ui.ts";

const NO_VISITS = "No visits in this period yet.";
const CITY_NOTE =
  "Cities show once Cloudflare's visitor location headers are on (Cloudflare dashboard › Rules › Settings › Managed Transforms › Add visitor location headers). Until then, each country's visitors sit at its middle.";

/** the countries table shows this many until "Show all" */
const TOP_COUNTRIES = 15;
const TOP_CITIES = 10;
/** the lines draw each day up to this many; past it, one day a week (the latest kept) */
const LINE_DAYS = 92;
/** the hours grid is Sunday first; the heatmap shows Monday first */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

/** "12 visits, 3 signed in" */
function visitsText(p: { readonly visits: number; readonly members: number }): string {
  return `${count(p.visits)} ${p.visits === 1 ? "visit" : "visits"}, ${count(p.members)} signed in`;
}

/** "Leeds, England, GB", or the country's name where only the country is known. */
function placeName(p: AdminPlace): string {
  return p.city ? [p.city, p.region, p.country].filter(Boolean).join(", ") : country(p.country);
}

/**
 * One dot a place: at its city, else at its country's middle. A place with neither is left off.
 * Sizes are against the busiest place, which gets the biggest dot, so they still differ when every
 * place has had many visits.
 */
function dotsFor(places: readonly AdminPlace[]): GlobeDot[] {
  const dots: GlobeDot[] = [];
  const most = Math.max(1, ...places.map((p) => p.visits));
  for (const p of places) {
    const at: readonly [number, number] | null = p.lat !== null && p.lon !== null ? [p.lat, p.lon] : countryCentre(p.country);
    if (!at) continue;
    dots.push({
      lat: at[0],
      lon: at[1],
      weight: Math.min(p.visits, (20 * p.visits) / most),
      tone: "series-1",
      label: `${placeName(p)} · ${visitsText(p)}`,
      key: `${p.country}|${p.city ?? ""}`,
    });
  }
  return dots;
}

/** The cities' visits, by "city, country", most first. */
function citiesOf(places: readonly AdminPlace[]): Tally[] {
  const byName = new Map<string, number>();
  for (const p of places) {
    if (!p.city) continue;
    const name = `${p.city}, ${p.country}`;
    byName.set(name, (byName.get(name) ?? 0) + p.visits);
  }
  return [...byName]
    .map(([label, n]) => ({ label, count: n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_CITIES);
}

/** A country's row: turns the globe to it when it has a middle to turn to. */
function countryRow(c: AdminCountry, total: number, g: Globe): HTMLElement {
  const row = h(
    "tr",
    {},
    h("td", { text: country(c.code) }),
    h(
      "td",
      { cls: "num" },
      h(
        "span",
        { cls: "adm-aud-visits" },
        h("span", { text: count(c.visits) }),
        h("span", { cls: "adm-aud-share", attrs: { title: `${share(c.visits, total)} of visits` } }, h("span", { attrs: { style: `width:${(c.visits / total) * 100}%` } })),
      ),
    ),
    h("td", { cls: "num", text: count(c.members) }),
    h("td", { cls: "num", text: count(c.signups) }),
    h("td", { cls: "num", text: count(c.opens) }),
    h("td", { cls: "num", text: minutes(c.medianMinutes) }),
  );
  const at = countryCentre(c.code);
  if (at) {
    row.classList.add("adm-aud-row");
    row.tabIndex = 0;
    row.title = "Turn the globe to it";
    const turn = (): void => g.focus(at[0], at[1]);
    row.addEventListener("click", turn);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        turn();
      }
    });
  }
  return row;
}

/** The countries table: the top rows, and a button for the rest. */
function countriesCard(geo: AdminGeo, g: Globe): HTMLElement {
  const all = geo.countries;
  const body = h("tbody", {});
  const more = h("button", { cls: "adm-btn small ghost", attrs: { type: "button" } });
  let open = false;
  const draw = (): void => {
    body.replaceChildren(...(open ? all : all.slice(0, TOP_COUNTRIES)).map((c) => countryRow(c, geo.total, g)));
    more.textContent = open ? `Show top ${TOP_COUNTRIES}` : `Show all ${all.length}`;
  };
  more.addEventListener("click", () => {
    open = !open;
    draw();
  });
  draw();
  return card(
    "Countries",
    h("p", { cls: "adm-aud-note", text: "Select a country to turn the globe to it." }),
    h(
      "div",
      { cls: "adm-table-wrap" },
      h(
        "table",
        { cls: "adm-table compact" },
        h(
          "thead",
          {},
          h(
            "tr",
            {},
            h("th", { text: "Country" }),
            h("th", { cls: "num", text: "Visits" }),
            h("th", { cls: "num", text: "Signed in" }),
            h("th", { cls: "num", text: "Sign-ups" }),
            h("th", { cls: "num", text: "Drawings" }),
            h("th", { cls: "num", text: "Typical visit" }),
          ),
        ),
        body,
      ),
    ),
    all.length > TOP_COUNTRIES ? h("div", { cls: "adm-aud-more" }, more) : null,
  );
}

function whereSection(geo: AdminGeo, signal: AbortSignal): HTMLElement {
  if (geo.total === 0) return section("Where visitors are", null, emptyView(NO_VISITS));
  const g = globe({ signal, maxSize: 440, spin: true });
  g.setDots(dotsFor(geo.places));
  const cityless = geo.total > 0 && geo.located / geo.total < 0.5;
  return section(
    "Where visitors are",
    null,
    h(
      "div",
      { cls: "adm-aud-where" },
      h("div", { cls: "adm-aud-globe" }, g.el, cityless ? h("p", { cls: "adm-aud-note", text: CITY_NOTE }) : null),
      countriesCard(geo, g),
    ),
    barList("Top cities", citiesOf(geo.places), undefined, "No cities yet"),
  );
}

function accountsSection(eng: AdminEngagement, quiet: boolean): HTMLElement {
  if (quiet) return section("Accounts in Rodeo", null, emptyView(NO_VISITS));
  const days = eng.active;
  const last = days.length ? days[days.length - 1] : undefined;
  const average = days.length ? days.reduce((s, d) => s + d.dau, 0) / days.length : 0;
  const long = days.length > LINE_DAYS;
  const shown = long ? days.filter((_, i) => (days.length - 1 - i) % 7 === 0) : days;
  const points: Point[] = shown.map((d) => ({ day: d.day, values: { dau: d.dau, wau: d.wau, mau: d.mau } }));
  return section(
    "Accounts in Rodeo",
    null,
    tiles(
      tile({ label: "Daily", value: count(Math.round(average)), note: "accounts in the editor on an average day" }),
      tile({ label: "Weekly", value: count(last?.wau ?? 0), note: "in the 7 days to the period's end" }),
      tile({ label: "Monthly", value: count(last?.mau ?? 0), note: "in the 30 days to the period's end" }),
      tile({ label: "Stickiness", value: share(average, last?.mau ?? 0), note: "how many of the month's accounts come on a typical day" }),
    ),
    lineChart(
      "Accounts a day",
      long ? "One day a week, the period's last day included: the period is longer than 92 days." : null,
      points,
      [
        { key: "dau", label: "Each day", color: "var(--series-1)" },
        { key: "wau", label: "7 days to it", color: "var(--series-2)" },
        { key: "mau", label: "30 days to it", color: "var(--text-2)" },
      ],
      (n) => count(Math.round(n)),
    ),
  );
}

function hoursSection(eng: AdminEngagement, quiet: boolean): HTMLElement {
  if (quiet) return section("When people come", null, emptyView(NO_VISITS));
  const grid = WEEK_ORDER.map((d) => eng.hours[d] ?? []);
  return section("When people come", null, heatmap("Visits by day and hour", "Hours in UTC", grid, WEEKDAYS, HOURS, count));
}

function visitsSection(eng: AdminEngagement, quiet: boolean): HTMLElement {
  return section(
    "Visits",
    null,
    quiet
      ? emptyView(NO_VISITS)
      : h(
          "div",
          { cls: "adm-lists" },
          barList("How long visits last", eng.lengths, undefined, NO_VISITS),
          barList("Drawings opened in a visit", eng.opensPerVisit, undefined, NO_VISITS),
        ),
  );
}

function funnelSection(eng: AdminEngagement, quiet: boolean): HTMLElement {
  return section(
    "From visit to paying",
    null,
    quiet
      ? emptyView(NO_VISITS)
      : funnel(
          "Visitors who got that far",
          "Each step counts the people who reached it. As far as can be known, each step is part of the one before.",
          eng.funnel,
          count,
        ),
  );
}

function returnSection(eng: AdminEngagement): HTMLElement {
  return section(
    "Do they come back?",
    null,
    eng.cohorts.length
      ? cohortTable("Sign-up weeks", "Accounts by the week they joined, and the share in Rodeo each week after", eng.cohorts)
      : emptyView("No sign-ups yet."),
  );
}

function signedInSection(eng: AdminEngagement, quiet: boolean): HTMLElement {
  if (quiet) return section("Signed-in visitors", null, emptyView(NO_VISITS));
  const points: Point[] = eng.members.map((m) => ({ day: m.day, values: { fresh: m.fresh, returning: m.returning } }));
  return section(
    "Signed-in visitors",
    null,
    columnChart(
      "Signed-in visitors a day",
      "New this week: accounts made in the last 7 days. Returning: older accounts.",
      points,
      [
        { key: "fresh", label: "New this week", color: "var(--series-1)" },
        { key: "returning", label: "Returning", color: "var(--series-2)" },
      ],
      (n) => count(Math.round(n)),
    ),
  );
}

/** The tab's sections for one period's numbers. */
function audienceBody(geo: AdminGeo, eng: AdminEngagement, signal: AbortSignal): HTMLElement {
  const visits = eng.hours.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  const quiet = visits === 0;
  return h(
    "div",
    { cls: "adm-aud-body" },
    whereSection(geo, signal),
    accountsSection(eng, quiet),
    hoursSection(eng, quiet),
    visitsSection(eng, quiet),
    funnelSection(eng, quiet),
    returnSection(eng),
    signedInSection(eng, quiet),
  );
}

export function audienceView(ctx: AdminContext): HTMLElement {
  return h(
    "div",
    { cls: "adm-aud" },
    loaded(ctx.signal, () => Promise.all([adminApi.geo(ctx.days), adminApi.engagement(ctx.days)]), ([geo, eng]) => audienceBody(geo, eng, ctx.signal), {
      onLoad: () => ctx.updated(updatedNow()),
    }),
  );
}
