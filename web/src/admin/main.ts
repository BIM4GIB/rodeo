// The admin page (rodeo.build/admin, admin.html): Overview, People and Settings for the accounts in
// ADMIN_EMAILS (server/src/admin.ts). It is a page of its own, without the editor, so it opens
// fast on a phone. The tab shows in the address (#people); the overview's period is remembered.

import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { account, adminApi, refreshUser, serverConfig } from "../platform/api.ts";
import type { ServerConfig, User } from "../platform/protocol.ts";
import { overviewView } from "./overview.ts";
import { peopleView } from "./people.ts";
import { settingsView } from "./settings.ts";

type Tab = "overview" | "people" | "settings";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "people", label: "People" },
  { id: "settings", label: "Settings" },
];

const PERIODS: readonly { days: number; label: string }[] = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
];

const PERIOD_KEY = "openvwx.admin.days";
/** the overview is fetched again this often while it is in front */
const REFRESH_MS = 60_000;

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

function start(user: User, currency: string | null): void {
  let tab = tabOf(location.hash);
  let days = storedDays();
  let timer = 0;
  let people: HTMLElement | null = null;

  const content = h("main", { cls: "adm-main" });
  const period = h("select", { cls: "adm-input", attrs: { "aria-label": "Period" } }, ...PERIODS.map((p) => h("option", { text: p.label, value: String(p.days) })));
  period.value = String(days);
  const updated = h("span", { cls: "adm-updated", attrs: { "aria-live": "polite" } });
  const tabs = h("nav", { cls: "adm-tabs", attrs: { "aria-label": "Admin" } });

  const renderTabs = (): void => {
    tabs.replaceChildren(
      ...TABS.map((t) => {
        const a = h("a", { cls: t.id === tab ? "adm-tab on" : "adm-tab", text: t.label, attrs: { href: `#${t.id}` } });
        if (t.id === tab) a.setAttribute("aria-current", "page");
        return a;
      }),
    );
    period.hidden = tab !== "overview";
    updated.hidden = tab !== "overview";
  };

  /** Fetches the overview; `quiet` keeps what is shown until the new one is in (the minute's refresh). */
  const loadOverview = async (quiet: boolean): Promise<void> => {
    if (!quiet) content.replaceChildren(h("p", { cls: "adm-empty", text: "Loading…" }));
    try {
      const o = await adminApi.overview(days);
      if (tab !== "overview") return;
      const y = window.scrollY;
      content.replaceChildren(overviewView(o));
      if (quiet) window.scrollTo(0, y);
      updated.textContent = `Updated ${new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
    } catch (err) {
      if (!quiet) content.replaceChildren(h("p", { cls: "adm-error", text: errorMessage(err) }));
    }
  };

  const show = (): void => {
    clearInterval(timer);
    renderTabs();
    if (tab === "overview") {
      void loadOverview(false);
      timer = window.setInterval(() => {
        if (document.visibilityState === "visible") void loadOverview(true);
      }, REFRESH_MS);
    } else if (tab === "people") {
      // kept while the page is open, so its search and place survive a look at the overview
      people ??= peopleView(currency);
      content.replaceChildren(people);
    } else {
      content.replaceChildren(settingsView(currency));
    }
  };

  period.addEventListener("change", () => {
    days = Number(period.value);
    try {
      localStorage.setItem(PERIOD_KEY, String(days));
    } catch {
      // not remembered
    }
    void loadOverview(false);
  });
  window.addEventListener("hashchange", () => {
    tab = tabOf(location.hash);
    show();
  });

  root.replaceChildren(
    h(
      "header",
      { cls: "adm-header" },
      h("a", { cls: "adm-brand", attrs: { href: "/", title: "Open the editor" } }, h("img", { attrs: { src: "/icon.svg", alt: "" } }), h("span", { text: "Rodeo" }), h("span", { cls: "adm-brand-sub", text: "Admin" })),
      tabs,
      h("div", { cls: "adm-header-end" }, updated, period, h("span", { cls: "adm-me", text: user.name, title: user.email })),
    ),
    content,
  );
  show();
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
  start(user, terms?.currency ?? null);
}

boot().catch((err: unknown) => message("The admin page couldn't load", errorMessage(err)));
