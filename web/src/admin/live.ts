// The admin page's Live tab: who is in Rodeo right now, asked for every 10 s while shown. A globe
// has a dot for each visitor, beside the headline, today's counts, the drawings open in live
// sessions and the last hour; under them, a table of visitors, newest activity first. The card at
// the top of the Overview shows the same people smaller, asked for every 30 s.

import { h } from "../app/dom.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminLive, AdminLiveVisitor, VisitEntry } from "../platform/protocol.ts";
import { type AdminContext, every, updatedNow } from "./context.ts";
import { ago, count, country, minutes } from "./format.ts";
import { countryCentre, type GlobeDot, globe } from "./globe.ts";
import { card, emptyView, errorView, loadingView, section, tile, tiles } from "./ui.ts";
import "./live.css";

/** the Live tab is asked again this often while it is in front */
const TAB_MS = 10_000;
/** the Overview's card is asked again this often */
const CARD_MS = 30_000;
/** the chart's columns: the last hour, a minute each */
const SLOTS = 60;
const CHART_H = 56;
/** how far, in degrees, a visitor without a place of their own is moved from their country's middle */
const JITTER = 1.2;

// the same words as the Overview's
const ENTRY_LABEL: Record<VisitEntry, string> = {
  editor: "Opened Rodeo",
  share: "A share link",
  invite: "An invite",
  embed: "An embedded drawing",
  app: "The installed app",
  convert: "The converter",
};

const DEVICE_LABEL: Record<string, string> = { desktop: "Computer", tablet: "Tablet", phone: "Phone" };

const COLUMNS: readonly { readonly label: string; readonly num?: boolean }[] = [
  { label: "Who" },
  { label: "Where" },
  { label: "Device" },
  { label: "Came from" },
  { label: "In for" },
  { label: "Drawings", num: true },
  { label: "Last heard" },
];

const SVG = "http://www.w3.org/2000/svg";

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/** "🇬🇧" for "GB"; nothing for a missing code. */
function flag(code: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}

/** The city, else the region, when Cloudflare named one. */
function placeName(v: AdminLiveVisitor): string | null {
  return v.city || v.region || null;
}

/** "🇬🇧 Leeds", or the country's name when there is no city or region. */
function where(v: AdminLiveVisitor): string {
  const place = placeName(v);
  if (place) return `${flag(v.country)} ${place}`.trim();
  return v.country ? country(v.country) : "Unknown";
}

function who(v: AdminLiveVisitor): string {
  return v.member ? v.member.name || v.member.email : "Guest";
}

/** "Leeds, GB". */
function placeCode(v: AdminLiveVisitor): string {
  return [placeName(v), v.country].filter(Boolean).join(", ");
}

/** "Chrome on macOS". */
function system(v: AdminLiveVisitor): string {
  return [v.browser, v.os].filter(Boolean).join(" on ");
}

/** "news.ycombinator.com" from a referrer address (or the text itself when it isn't an address). */
function referrerHost(ref: string | null): string | null {
  if (!ref) return null;
  try {
    return new URL(ref).hostname.replace(/^www\./, "") || ref;
  } catch {
    return ref;
  }
}

function cameFrom(v: AdminLiveVisitor): string {
  const label = ENTRY_LABEL[v.entry] ?? v.entry;
  const site = referrerHost(v.referrer);
  return site ? `${label} · ${site}` : label;
}

/** A number from 0 up to 1 that is the same every time for the same key (FNV-1a). */
function hashUnit(key: string, salt: string): number {
  const s = `${salt}:${key}`;
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 0x01000193);
  return (x >>> 0) / 0x100000000;
}

/**
 * Where a visitor sits on the globe: their own place, else their country's middle, moved by a
 * hash of their key so that several in one country don't stack. Null when neither is known.
 */
function placeOf(v: AdminLiveVisitor): [number, number] | null {
  if (v.lat !== null && v.lon !== null) return [v.lat, v.lon];
  const mid = v.country ? countryCentre(v.country) : null;
  if (!mid) return null;
  const nudge = (salt: string): number => (hashUnit(v.key, salt) * 2 - 1) * JITTER;
  const lat = Math.max(-89, Math.min(89, mid[0] + nudge("lat")));
  const lon = ((mid[1] + nudge("lon") + 540) % 360) - 180;
  return [lat, lon];
}

function dotsOf(visitors: readonly AdminLiveVisitor[]): GlobeDot[] {
  const dots: GlobeDot[] = [];
  for (const v of visitors) {
    const at = placeOf(v);
    if (!at) continue;
    dots.push({
      lat: at[0],
      lon: at[1],
      weight: 1,
      live: true,
      tone: v.member ? "series-2" : "series-1",
      label: [who(v), placeCode(v), system(v)].filter(Boolean).join(" · "),
      key: v.key,
    });
  }
  return dots;
}

/** The three countries with the most people in them now, most first. */
function topCountries(visitors: readonly AdminLiveVisitor[]): [string, number][] {
  const tally = new Map<string, number>();
  for (const v of visitors) {
    if (v.country) tally.set(v.country, (tally.get(v.country) ?? 0) + 1);
  }
  return [...tally].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

/**
 * Asks for who is in Rodeo now, at once and every `ms` while shown. An answer that comes back
 * after a newer one has been shown is dropped, so the page never goes back to older numbers.
 */
function poll(ctx: AdminContext, ms: number, show: (data: AdminLive) => void, fail: (err: unknown) => void): void {
  let asked = 0;
  let applied = 0;
  const load = async (): Promise<void> => {
    const id = ++asked;
    try {
      const data = await adminApi.live();
      if (ctx.signal.aborted || id < applied) return;
      applied = id;
      show(data);
    } catch (err) {
      if (!ctx.signal.aborted) fail(err);
    }
  };
  void load();
  every(ctx.signal, ms, () => void load());
}

/** The headline: a dot that pulses while anyone is in Rodeo, then the counts. Kept between loads, so the pulse doesn't restart. */
function nowLine(): { readonly el: HTMLElement; set(visitors: readonly AdminLiveVisitor[]): void } {
  const dot = h("span", { cls: "adm-live", attrs: { "aria-hidden": "true" } });
  const total = h("strong");
  const split = h("span");
  const el = h("div", { cls: "adm-now adm-livev-now" }, dot, h("span", {}, total, " ", split));
  return {
    el,
    set(visitors) {
      const members = visitors.filter((v) => v.member !== null).length;
      const guests = visitors.length - members;
      dot.classList.toggle("on", visitors.length > 0);
      total.textContent = `${visitors.length} ${visitors.length === 1 ? "person" : "people"} in Rodeo now`;
      split.textContent = `· ${guests} ${guests === 1 ? "guest" : "guests"}, ${members} signed in`;
    },
  };
}

function note(text: string): HTMLElement {
  return h("p", { cls: "adm-card-note", text });
}

function fact(label: string, n: number): HTMLElement {
  return h("div", {}, h("dt", { text: label }), h("dd", { text: count(n) }));
}

function legend(): HTMLElement {
  return h(
    "p",
    { cls: "adm-livev-key" },
    h("span", {}, h("i", { cls: "adm-livev-swatch" }), "Guests"),
    h("span", {}, h("i", { cls: "adm-livev-swatch members" }), "Signed in"),
  );
}

/** The last hour as columns, a minute each, the newest on the right: guests at the foot, signed-in people on top. */
function hourChart(recent: AdminLive["recent"]): SVGSVGElement {
  const rows = recent.slice(-SLOTS);
  const peak = Math.max(1, ...rows.map((r) => r.guests + r.members));
  const chart = svgNode("svg", {
    class: "adm-livev-chart",
    viewBox: `0 0 ${SLOTS} ${CHART_H}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": "People in Rodeo, a minute at a time, over the last hour",
  });
  const first = SLOTS - rows.length;
  rows.forEach((r, i) => {
    const x = first + i + 0.2;
    const guests = (r.guests / peak) * CHART_H;
    const members = (r.members / peak) * CHART_H;
    if (guests > 0) chart.append(svgNode("rect", { x, y: CHART_H - guests, width: 0.6, height: guests, class: "adm-livev-bar-guests" }));
    if (members > 0) chart.append(svgNode("rect", { x, y: CHART_H - guests - members, width: 0.6, height: members, class: "adm-livev-bar-members" }));
  });
  return chart;
}

function visitorRow(v: AdminLiveVisitor, at: number, fresh: boolean, focus: (lat: number, lon: number) => void): HTMLElement {
  const spot = placeOf(v);
  const tr = h(
    "tr",
    { cls: [fresh ? "adm-livev-new" : "", spot ? "adm-livev-go" : ""].filter(Boolean).join(" "), attrs: spot ? { tabindex: "0" } : {} },
    h("td", { text: who(v), title: v.member?.email }),
    h("td", { text: where(v) }),
    h("td", { text: [DEVICE_LABEL[v.device] ?? v.device, v.browser, v.os].filter(Boolean).join(" · ") }),
    h("td", { text: cameFrom(v) }),
    h("td", { text: minutes((at - Date.parse(v.firstAt)) / 60_000) }),
    h("td", { cls: "num", text: String(v.opens) }),
    h("td", { text: ago(v.lastAt) }),
  );
  if (spot) {
    const [lat, lon] = spot;
    tr.addEventListener("click", () => focus(lat, lon));
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter") focus(lat, lon);
    });
  }
  return tr;
}

function visitorTable(rows: readonly HTMLElement[]): HTMLElement {
  return h(
    "div",
    { cls: "adm-card adm-table-card" },
    h(
      "div",
      { cls: "adm-table-wrap" },
      h(
        "table",
        { cls: "adm-table adm-livev-table" },
        h("thead", {}, h("tr", {}, ...COLUMNS.map((c) => h("th", { text: c.label, cls: c.num ? "num" : undefined })))),
        h("tbody", {}, ...rows),
      ),
    ),
  );
}

/** The Live tab: who is in Rodeo now. */
export function liveView(ctx: AdminContext): HTMLElement {
  const root = h("div", { cls: "adm-livev" }, loadingView());
  const map = globe({ signal: ctx.signal, maxSize: 520 });
  const now = nowLine();
  const today = h("div");
  const sessions = h("dl", { cls: "adm-livev-facts" });
  const hour = h("div");
  const visitorsBox = h("div");
  let seen: Set<string> | null = null;
  let attached = false;

  const top = h(
    "div",
    { cls: "adm-livev-top" },
    h("div", { cls: "adm-livev-globe" }, map.el),
    h(
      "div",
      { cls: "adm-livev-side" },
      now.el,
      today,
      card("Live sessions", note("Cloud drawings with people in them. Together means two or more people in one."), sessions),
      card("Last hour", note("People in Rodeo, a minute at a time."), hour, legend()),
    ),
  );
  const visitorsSection = section(
    "In Rodeo now",
    "Heard from in the last 3 minutes. Select a row with a place to turn the globe to it.",
    visitorsBox,
  );

  poll(
    ctx,
    TAB_MS,
    (data) => {
      if (!attached) {
        root.replaceChildren(top, visitorsSection);
        attached = true;
      }
      const visitors = [...data.visitors].sort((a, b) => Date.parse(b.lastAt) - Date.parse(a.lastAt));

      const keys = new Set(visitors.map((v) => v.key));
      const before = seen;
      seen = keys;
      // the first answer marks nobody as new
      const fresh = before ? new Set([...keys].filter((k) => !before.has(k))) : new Set<string>();

      now.set(visitors);
      const t = data.today;
      today.replaceChildren(
        tiles(
          tile({ label: "Visitors today", value: count(t.visitors) }),
          tile({ label: "Signed in today", value: count(t.members) }),
          tile({ label: "Sign-ups today", value: count(t.signups) }),
          tile({ label: "Drawings opened today", value: count(t.opens) }),
        ),
      );
      sessions.replaceChildren(
        fact("Drawings open", data.sessions.drawings),
        fact("People in them", data.sessions.people),
        fact("Together", data.sessions.together),
      );
      hour.replaceChildren(data.recent.length >= 2 ? hourChart(data.recent) : emptyView("Shows once the server has been up a few minutes"));
      map.setDots(dotsOf(visitors));

      const at = Date.parse(data.at);
      visitorsBox.replaceChildren(
        visitors.length
          ? visitorTable(visitors.map((v) => visitorRow(v, at, fresh.has(v.key), (lat, lon) => map.focus(lat, lon))))
          : emptyView("Nobody is in Rodeo right now. Visitors show here within a minute of opening it."),
      );
      ctx.updated(updatedNow());
    },
    (err) => {
      if (!attached) root.replaceChildren(errorView(err));
    },
  );
  return root;
}

/** The Overview's card: a small globe, the headline, the countries with most people in them, and a link to the Live tab. */
export function liveCard(ctx: AdminContext): HTMLElement {
  const map = globe({ signal: ctx.signal, maxSize: 180, interactive: false });
  const now = nowLine();
  const countries = h("ul", { cls: "adm-livev-countries" });
  const info = h("div", { cls: "adm-livev-card-info" }, loadingView());
  let attached = false;

  const el = h(
    "section",
    { cls: "adm-card adm-livev-card" },
    h("div", { cls: "adm-livev-card-globe" }, map.el),
    h("div", { cls: "adm-livev-card-text" }, info, h("a", { cls: "adm-btn small", text: "Open Live", attrs: { href: "#live" } })),
  );

  poll(
    ctx,
    CARD_MS,
    (data) => {
      map.setDots(dotsOf(data.visitors));
      now.set(data.visitors);
      countries.replaceChildren(...topCountries(data.visitors).map(([code, n]) => h("li", { text: `${country(code)} ${n}` })));
      if (!attached) {
        info.replaceChildren(now.el, countries);
        attached = true;
      }
    },
    (err) => {
      if (!attached) info.replaceChildren(errorView(err));
    },
  );
  return el;
}
