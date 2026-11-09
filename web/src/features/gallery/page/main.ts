// The gallery page (rodeo.build/gallery, gallery.html): a page of its own, without the editor, so
// it opens fast on a phone and search engines and link previews read it. It routes between the
// listing (list.ts) and one drawing (detail.ts) in the page, and holds the header, the sign-in box
// and the dialogs both use.

import { h } from "../../../app/dom.ts";
import { startLanguage } from "../../../app/i18n.ts";
import { errorMessage } from "../../../app/toast.ts";
import { account, onUser, refreshUser, serverConfig } from "../../../platform/api.ts";
import type { ServerConfig, User } from "../../../platform/protocol.ts";
import { LIMITS, homeMeta, missingMeta, parseGalleryPath } from "../rules.ts";
import { showEntry } from "./detail.ts";
import { showList } from "./list.ts";

// the interface in the language chosen in the editor (or the browser's), as the page builds
void startLanguage();

/** Two branches meeting in a stem: static markup, so it may be set as HTML. */
const FORK_ICON = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="4" cy="3.2" r="1.7"/><circle cx="12" cy="3.2" r="1.7"/><circle cx="8" cy="12.8" r="1.7"/><path d="M4 4.9v1.2c0 1.9 4 2.1 4 4.4M12 4.9v1.2c0 1.9-4 2.1-4 4.4"/></svg>`;

const PROVIDER_NAME: Record<string, string> = { google: "Google", github: "GitHub", microsoft: "Microsoft" };

/** A dialog over the page, as openPageModal returns it. */
export interface PageModal {
  /** the dialog's body: its controls go here */
  readonly body: HTMLElement;
  /** closes the dialog, as Esc or a press outside it does */
  close(): void;
}

const root = document.getElementById("gallery") as HTMLElement;
/** Where the listing or a drawing is shown. */
const main = h("main", { cls: "gal-wrap gal-main" });
const searchInput = h("input", {
  attrs: { type: "search", placeholder: "Search drawings", maxlength: String(LIMITS.query), "aria-label": "Search drawings", autocomplete: "off" },
});
const accountBox = h("div", { cls: "gal-account" });
let config: ServerConfig | null = null;
let modalSeq = 0;

/** Goes to a gallery address in the page (pushState), or loads it when it isn't the gallery's. */
export function navigate(url: string, replace = false): void {
  const target = new URL(url, location.href);
  const inGallery = target.origin === location.origin && (target.pathname === "/gallery" || target.pathname.startsWith("/gallery/"));
  if (!inGallery) {
    location.assign(target.href);
    return;
  }
  const next = target.pathname + target.search + target.hash;
  const here = location.pathname + location.search + location.hash;
  // the same address again is not a new step back in the history
  if (replace || next === here) history.replaceState(null, "", next);
  else history.pushState(null, "", next);
  route();
  window.scrollTo(0, 0);
}

/** A dialog over the page: Esc or a press outside closes it; focus goes back where it was. */
export function openPageModal(title: string): PageModal {
  const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  modalSeq += 1;
  const titleId = `gal-modal-title-${modalSeq}`;
  const body = h("div", { cls: "gal-modal-body" });
  const modal = h(
    "div",
    { cls: "gal-modal", attrs: { role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1" } },
    h("h2", { text: title, attrs: { id: titleId } }),
    body,
  );
  const backdrop = h("div", { cls: "gal-backdrop" }, modal);
  let isOpen = true;

  const focusable = (): HTMLElement[] =>
    Array.from(modal.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href]")).filter((el) => !el.matches(":disabled"));

  // Tab stays inside the dialog, so the page behind cannot take the keyboard while it is open
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = focusable();
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === modal)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const close = (): void => {
    if (!isOpen) return;
    isOpen = false;
    document.removeEventListener("keydown", onKey);
    backdrop.remove();
    returnFocus?.focus();
  };

  backdrop.addEventListener("pointerdown", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.append(backdrop);
  (focusable()[0] ?? modal).focus();
  return { body, close };
}

/** The sign-in box: each provider, and an email link, coming back to `redirect`. */
export function openSignIn(reason: string, redirect: string): void {
  const modal = openPageModal("Sign in");
  const providers = config?.auth.oauth ?? [];
  const email = config?.auth.email ?? false;
  modal.body.append(h("p", { text: reason }));
  if (providers.length > 0) {
    modal.body.append(
      h(
        "div",
        { cls: "gal-signin" },
        ...providers.map((p) =>
          h("a", { cls: "gal-btn primary", text: `Sign in with ${PROVIDER_NAME[p] ?? p}`, attrs: { href: account.oauthUrl(p, redirect) } }),
        ),
      ),
    );
  }
  if (email) {
    const address = h("input", {
      cls: "gal-input",
      placeholder: "you@example.com",
      attrs: { type: "email", "aria-label": "Email", autocomplete: "email", required: "" },
    });
    const send = h("button", { cls: "gal-btn", text: "Email me a link", attrs: { type: "submit" } });
    const note = h("p", { cls: "gal-muted", attrs: { role: "status" } });
    const form = h("form", { cls: "gal-email" }, address, send);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      send.disabled = true;
      account
        .emailSignIn(address.value.trim(), redirect)
        .then(() => (note.textContent = "Check your email for the sign-in link."))
        .catch((err: unknown) => (note.textContent = errorMessage(err)))
        .finally(() => (send.disabled = false));
    });
    modal.body.append(form, note);
  }
  if (providers.length === 0 && !email) modal.body.append(h("p", { cls: "gal-muted", text: "No sign-in is set up on this server." }));
}

/** A small button in the page's style: "primary" for the one thing to do, "danger" for what cannot be undone. */
export function button(label: string, kind: "primary" | "plain" | "danger", onClick: () => void): HTMLButtonElement {
  const b = h("button", { cls: kind === "plain" ? "gal-btn" : `gal-btn ${kind}`, text: label, attrs: { type: "button" } });
  b.addEventListener("click", onClick);
  return b;
}

/** A page's message in place of its content: a title, a line, and what to do next. */
export function notice(title: string, text?: string, ...more: Node[]): HTMLElement {
  return h(
    "div",
    { cls: "gal-message" },
    h("img", { cls: "gal-message-mark", attrs: { src: "/icon.svg", alt: "" } }),
    h("h1", { text: title }),
    text ? h("p", { text }) : null,
    ...more,
  );
}

/** The fork icon, for the buttons and counts that mean a fork. */
export function forkIcon(): HTMLElement {
  return h("span", { cls: "gal-icon", html: FORK_ICON, attrs: { "aria-hidden": "true" } });
}

/** Shows the route the address names: the listing, one drawing, or the "not in the gallery" message. */
function route(): void {
  const params = new URLSearchParams(location.search);
  const found = parseGalleryPath(location.pathname);
  if (found === null || found.kind === "home") {
    searchInput.value = (params.get("q") ?? "").slice(0, LIMITS.query);
    document.title = homeMeta(location.origin, { tag: params.get("tag"), q: params.get("q") }).title;
    showList(main, params);
    return;
  }
  searchInput.value = "";
  if (found.kind === "entry") {
    showEntry(main, found.id, params);
    return;
  }
  document.title = missingMeta(location.origin).title;
  main.replaceChildren(
    notice("This drawing is no longer in the gallery.", undefined, h("a", { cls: "gal-btn", text: "Browse the gallery", attrs: { href: "/gallery", "data-nav": "" } })),
  );
}

/** The header's account part: the name's initial and name when signed in, else a Sign in button. */
function renderAccount(u: User | null): void {
  if (u) {
    const initial = Array.from(u.name.trim() || u.email)[0]?.toUpperCase() ?? "?";
    accountBox.replaceChildren(
      h(
        "span",
        { cls: "gal-me", title: u.email },
        h("span", { cls: "gal-avatar", text: initial, attrs: { "aria-hidden": "true" } }),
        h("span", { cls: "gal-me-name", text: u.name || u.email, attrs: { translate: "no" } }),
      ),
    );
    return;
  }
  accountBox.replaceChildren(
    button("Sign in", "plain", () => openSignIn("Sign in to fork drawings into your account.", location.pathname + location.search)),
  );
}

/** Sends left clicks on gallery links through the page, unless a modifier key asks for a new tab. */
function onNavClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const link = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>("a[data-nav]") : null;
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute("href") ?? "/gallery");
}

function layout(): void {
  const search = h("form", { cls: "gal-search", attrs: { role: "search" } }, searchInput);
  search.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    navigate(q ? `/gallery?q=${encodeURIComponent(q)}` : "/gallery");
  });
  const header = h(
    "header",
    { cls: "gal-head" },
    h(
      "div",
      { cls: "gal-wrap gal-head-inner" },
      h("a", { cls: "gal-brand", attrs: { href: "/gallery", "data-nav": "" } }, h("img", { attrs: { src: "/icon.svg", alt: "" } }), h("span", { text: "Gallery" })),
      search,
      h("div", { cls: "gal-head-end" }, h("a", { cls: "gal-btn", text: "Open Rodeo", attrs: { href: "/" } }), accountBox),
    ),
  );
  const footer = h(
    "footer",
    { cls: "gal-foot" },
    h(
      "div",
      { cls: "gal-wrap gal-foot-inner" },
      h("p", { text: "Each drawing here is shared by the person who made it, under the licence on its page." }),
      h(
        "nav",
        { cls: "gal-foot-links", attrs: { "aria-label": "More" } },
        h("a", { text: "Open Rodeo", attrs: { href: "/" } }),
        h("a", { text: "Source code", attrs: { href: "https://github.com/rodeobuild/rodeo", target: "_blank", rel: "noopener" } }),
      ),
    ),
  );
  root.replaceChildren(header, main, footer);
}

async function boot(): Promise<void> {
  const cfg = await serverConfig();
  if (!cfg) {
    root.replaceChildren(notice("The gallery needs the Rodeo server.", "This copy of Rodeo has no server, so there is nothing to show here."));
    return;
  }
  config = cfg;
  await refreshUser();
  // a sign-in brings the reader back with signed-in=1 in the address: that has done its job, so it goes
  const address = new URL(location.href);
  if (address.searchParams.has("signed-in")) {
    address.searchParams.delete("signed-in");
    history.replaceState(null, "", address.pathname + address.search + address.hash);
  }
  layout();
  onUser(renderAccount);
  document.addEventListener("click", onNavClick);
  window.addEventListener("popstate", route);
  route();
}

boot().catch((err: unknown) => root.replaceChildren(notice("The gallery couldn't load", errorMessage(err))));
