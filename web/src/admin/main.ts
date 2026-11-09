// The admin page (rodeo.build/admin, admin.html), for the accounts in ADMIN_EMAILS
// (server/src/admin.ts and its neighbours). It is a page of its own, without the editor, so it opens
// fast on a phone. A side bar (a strip along the top on narrow screens) holds its tabs in three
// groups: what is happening (Live, Overview, Audience, Revenue, Usage), what admins look after
// (People, Feedback, Errors, Gallery, Announcements, Funding), and the server (Settings, System).
// The tab shows in the address (#people); the period the analytics tabs show is remembered.

import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { account, adminApi, refreshUser, serverConfig } from "../platform/api.ts";
import type { ServerConfig, User } from "../platform/protocol.ts";
import { announcementsView } from "./announcements.ts";
import { audienceView } from "./audience.ts";
import type { AdminContext, Tab } from "./context.ts";
import { errorsView } from "./errors.ts";
import { feedbackView } from "./feedback.ts";
import { fundingView } from "./funding.ts";
import { galleryView } from "./gallery.ts";
import { liveView } from "./live.ts";
import { overviewTab } from "./overview.ts";
import { peopleView } from "./people.ts";
import { revenueView } from "./revenue.ts";
import { settingsView } from "./settings.ts";
import { systemView } from "./system.ts";
import { usageView } from "./usage.ts";

interface TabSpec {
  readonly id: Tab;
  readonly label: string;
  /** shows the period picker */
  readonly period?: boolean;
  readonly view: (ctx: AdminContext) => HTMLElement;
}

const GROUPS: readonly { readonly label: string; readonly tabs: readonly TabSpec[] }[] = [
  {
    label: "Analytics",
    tabs: [
      { id: "live", label: "Live", view: liveView },
      { id: "overview", label: "Overview", period: true, view: overviewTab },
      { id: "audience", label: "Audience", period: true, view: audienceView },
      { id: "revenue", label: "Revenue", period: true, view: revenueView },
      { id: "usage", label: "Usage", period: true, view: usageView },
    ],
  },
  {
    label: "Manage",
    tabs: [
      // made once and kept while the page is open, so its search and place survive a look elsewhere
      { id: "people", label: "People", view: (ctx) => (people ??= peopleView(ctx.currency)) },
      { id: "feedback", label: "Feedback", view: feedbackView },
      { id: "errors", label: "Errors", view: errorsView },
      { id: "gallery", label: "Gallery", view: galleryView },
      { id: "announcements", label: "Announcements", view: announcementsView },
      { id: "funding", label: "Funding and sponsor", view: fundingView },
    ],
  },
  {
    label: "Server",
    tabs: [
      { id: "settings", label: "Settings", view: settingsView },
      { id: "system", label: "System", view: systemView },
    ],
  },
];

const TABS: readonly TabSpec[] = GROUPS.flatMap((g) => g.tabs);

let people: HTMLElement | null = null;

const PERIODS: readonly { days: number; label: string }[] = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
];

const PERIOD_KEY = "openvwx.admin.days";
/** the side bar's counts (new feedback, the day's errors) are fetched again this often */
const BADGES_MS = 120_000;

const root = document.getElementById("admin") as HTMLElement;

function message(title: string, text: string, ...more: (Node | null)[]): void {
  root.replaceChildren(
    h("div", { cls: "adm-message" }, h("img", { cls: "adm-message-mark", attrs: { src: "/icon.svg", alt: "" } }), h("h1", { text: title }), h("p", { text }), ...more),
  );
}

const PROVIDER_NAME: Record<string, string> = { google: "Google", github: "GitHub", microsoft: "Microsoft" };

/** Sign-in ways the server offers, each coming back to this page. */
function signIn(cfg: ServerConfig): HTMLElement {
  const box = h(
    "div",
    { cls: "adm-signin" },
    ...cfg.auth.oauth.map((p) => h("a", { cls: "adm-btn primary", text: `Sign in with ${PROVIDER_NAME[p] ?? p}`, attrs: { href: account.oauthUrl(p) } })),
  );
  if (cfg.auth.email) {
    const email = h("input", { cls: "adm-input", placeholder: "you@example.com", attrs: { type: "email", "aria-label": "Email", autocomplete: "email" } });
    const send = h("button", { cls: "adm-btn", text: "Email me a link", attrs: { type: "submit" } });
    const note = h("p", { cls: "adm-muted", attrs: { role: "status" } });
    const form = h("form", { cls: "adm-actions" }, email, send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      send.disabled = true;
      account
        .emailSignIn(email.value.trim())
        .then(() => (note.textContent = "Check your email for the sign-in link."))
        .catch((err: unknown) => (note.textContent = errorMessage(err)))
        .finally(() => (send.disabled = false));
    });
    box.append(form, note);
  }
  return box;
}

function storedDays(): number {
  try {
    const n = Number(localStorage.getItem(PERIOD_KEY));
    return PERIODS.some((p) => p.days === n) ? n : 30;
  } catch {
    return 30;
  }
}

function tabOf(hash: string): Tab {
  const id = hash.replace(/^#/, "");
  return TABS.some((t) => t.id === id) ? (id as Tab) : "overview";
}

function start(user: User, cfg: ServerConfig, currency: string | null): void {
  let tab = tabOf(location.hash);
  let days = storedDays();
  let shown: AbortController | null = null;
  const counts = new Map<Tab, number>();

  const content = h("main", { cls: "adm-main" });
  const period = h("select", { cls: "adm-input", attrs: { "aria-label": "Period" } }, ...PERIODS.map((p) => h("option", { text: p.label, value: String(p.days) })));
  period.value = String(days);
  const updated = h("span", { cls: "adm-updated", attrs: { "aria-live": "polite" } });
  const nav = h("nav", { cls: "adm-nav", attrs: { "aria-label": "Admin" } });

  const renderNav = (): void => {
    nav.replaceChildren(
      ...GROUPS.map((g) =>
        h(
          "div",
          { cls: "adm-nav-group" },
          h("span", { cls: "adm-nav-label", text: g.label }),
          ...g.tabs.map((t) => {
            const n = counts.get(t.id) ?? 0;
            const a = h(
              "a",
              { cls: t.id === tab ? "adm-nav-item on" : "adm-nav-item", attrs: { href: `#${t.id}` } },
              h("span", { text: t.label }),
              n > 0 ? h("span", { cls: "adm-nav-count", text: n > 99 ? "99+" : String(n) }) : null,
            );
            if (t.id === tab) a.setAttribute("aria-current", "page");
            return a;
          }),
        ),
      ),
    );
  };

  const badge = (t: Tab, n: number): void => {
    if ((counts.get(t) ?? 0) === n) return;
    counts.set(t, n);
    renderNav();
  };

  const show = (): void => {
    shown?.abort();
    shown = new AbortController();
    const spec = TABS.find((t) => t.id === tab) ?? TABS[1];
    renderNav();
    nav.querySelector(".adm-nav-item.on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
    period.hidden = !spec.period;
    updated.textContent = "";
    const signal = shown.signal;
    const ctx: AdminContext = {
      user,
      config: cfg,
      currency,
      days,
      signal,
      badge,
      updated: (text) => {
        if (!signal.aborted) updated.textContent = text ?? "";
      },
    };
    try {
      content.replaceChildren(spec.view(ctx));
    } catch (err) {
      content.replaceChildren(h("p", { cls: "adm-error", text: errorMessage(err) }));
    }
    document.title = `${spec.label} · Rodeo Admin`;
  };

  const loadBadges = (): void => {
    adminApi
      .overview(1)
      .then((o) => {
        badge("feedback", o.inbox.feedback);
        badge("errors", o.inbox.errors);
      })
      .catch(() => {
        // the counts wait for the next turn
      });
  };

  period.addEventListener("change", () => {
    days = Number(period.value);
    try {
      localStorage.setItem(PERIOD_KEY, String(days));
    } catch {
      // not remembered
    }
    show();
  });
  window.addEventListener("hashchange", () => {
    tab = tabOf(location.hash);
    show();
    window.scrollTo(0, 0);
  });

  root.replaceChildren(
    h(
      "header",
      { cls: "adm-header" },
      h("a", { cls: "adm-brand", attrs: { href: "/", title: "Open the editor" } }, h("img", { attrs: { src: "/icon.svg", alt: "" } }), h("span", { text: "Rodeo" }), h("span", { cls: "adm-brand-sub", text: "Admin" })),
      h("div", { cls: "adm-header-end" }, updated, period, h("span", { cls: "adm-me", text: user.name, title: user.email })),
    ),
    h("div", { cls: "adm-shell" }, nav, content),
  );
  show();
  loadBadges();
  window.setInterval(() => {
    if (document.visibilityState === "visible") loadBadges();
  }, BADGES_MS);
}

async function boot(): Promise<void> {
  const cfg = await serverConfig();
  if (!cfg) {
    message("No Rodeo server here", "The admin page needs the Rodeo server, which this site doesn't have.");
    return;
  }
  const user = await refreshUser();
  if (!user) {
    message("Sign in to continue", "Sign in with an admin account.", signIn(cfg));
    return;
  }
  if (!user.admin) {
    message(
      "Admins only",
      `${user.email} isn't an admin account. Admins are the addresses in the server's ADMIN_EMAILS.`,
      h("a", { cls: "adm-btn primary", text: "Open the editor", attrs: { href: "/" } }),
    );
    return;
  }
  const terms = cfg.credit ?? cfg.ai?.credit ?? null;
  start(user, cfg, terms?.currency ?? null);
}

boot().catch((err: unknown) => message("The admin page couldn't load", errorMessage(err)));
