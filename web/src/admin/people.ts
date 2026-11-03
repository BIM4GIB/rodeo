// The admin page's People: every account, searched by name or email, filtered and sorted, 50 at a
// time, and a CSV of them all. A row opens the account's panel: what it has done (days in the
// editor, drawings, renders, its credit history), and the admin's steps on it: give or take back
// AI credit with a note it sees (and an email, if wanted), give Rodeo Plus for a while or end it,
// sign it out everywhere, suspend it or let it back, or delete it for good.

import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { adminApi } from "../platform/api.ts";
import type { AdminLedgerRow, AdminUser, AdminUserDetail, AdminUserFilter, AdminUserSort } from "../platform/protocol.ts";
import { ago, bytes, count, country, dateTime, day, money } from "./format.ts";

const FILTERS: readonly { id: AdminUserFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "plus", label: "Rodeo Plus" },
  { id: "credit", label: "Has credit" },
  { id: "spenders", label: "Used or bought credit" },
  { id: "suspended", label: "Suspended" },
];

const SORTS: readonly { id: AdminUserSort; label: string }[] = [
  { id: "joined", label: "Newest" },
  { id: "seen", label: "Last seen" },
  { id: "credit", label: "Most credit" },
  { id: "spent", label: "Most used" },
  { id: "files", label: "Most storage" },
  { id: "name", label: "Name" },
];

const PROVIDER_LABEL: Record<string, string> = { google: "Google", github: "GitHub", microsoft: "Microsoft", email: "Email link" };

function avatar(u: Pick<AdminUser, "name" | "email" | "avatarUrl">, big = false): HTMLElement {
  const cls = big ? "adm-avatar big" : "adm-avatar";
  if (u.avatarUrl) return h("img", { cls, attrs: { src: u.avatarUrl, alt: "", referrerpolicy: "no-referrer", loading: "lazy" } });
  return h("span", { cls, text: (u.name || u.email).slice(0, 1).toUpperCase(), attrs: { "aria-hidden": "true" } });
}

function planBadge(u: AdminUser): HTMLElement | null {
  if (u.plan !== "supporter") return null;
  return h("span", { cls: "adm-badge plus", text: u.paidPlus ? "Plus" : "Plus, given", title: u.supporterUntil ? `until ${day(u.supporterUntil)}` : undefined });
}

function badges(u: AdminUser): HTMLElement[] {
  return [
    u.admin ? h("span", { cls: "adm-badge", text: "Admin" }) : null,
    planBadge(u),
    u.suspended ? h("span", { cls: "adm-badge danger", text: "Suspended" }) : null,
  ].filter((b): b is HTMLElement => b !== null);
}

export function peopleView(currency: string | null): HTMLElement {
  let q = "";
  let filter: AdminUserFilter = "all";
  let sort: AdminUserSort = "joined";
  let users: AdminUser[] = [];
  let total = 0;
  let loading = false;
  let openId: string | null = null;
  let seq = 0;

  const search = h("input", { cls: "adm-input adm-search", placeholder: "Search by name or email", attrs: { type: "search", "aria-label": "Search accounts" } });
  const sortSelect = h("select", { cls: "adm-input", attrs: { "aria-label": "Sort by" } }, ...SORTS.map((s) => h("option", { text: s.label, value: s.id })));
  const chips = h("div", { cls: "adm-chips", attrs: { role: "group", "aria-label": "Show" } });
  const summary = h("p", { cls: "adm-count" });
  const tbody = h("tbody");
  const more = h("button", { cls: "adm-btn", text: "Show more", hidden: true, attrs: { type: "button" } });
  const listError = h("p", { cls: "adm-error", hidden: true, attrs: { role: "alert" } });
  const panel = h("aside", { cls: "adm-panel", hidden: true, attrs: { "aria-label": "Account" } });
  const scrim = h("div", { cls: "adm-scrim", hidden: true });

  const renderChips = (): void => {
    chips.replaceChildren(
      ...FILTERS.map((f) => {
        const b = h("button", { cls: f.id === filter ? "adm-chip on" : "adm-chip", text: f.label, attrs: { type: "button", "aria-pressed": String(f.id === filter) } });
        b.addEventListener("click", () => {
          filter = f.id;
          renderChips();
          void load(false);
        });
        return b;
      }),
    );
  };

  const row = (u: AdminUser): HTMLElement => {
    const tr = h(
      "tr",
      { cls: u.id === openId ? "adm-row on" : "adm-row", attrs: { tabindex: "0", "data-id": u.id } },
      h(
        "td",
        { cls: "adm-person" },
        avatar(u),
        h("span", { cls: "adm-person-text" }, h("span", { cls: "adm-person-name" }, u.name, ...badges(u)), h("span", { cls: "adm-person-email", text: u.email })),
      ),
      h("td", { cls: "col-joined", text: day(u.createdAt), title: dateTime(u.createdAt) }),
      h("td", { cls: "col-seen", text: ago(u.lastSeenAt), title: u.lastSeenAt ? dateTime(u.lastSeenAt) : "" }),
      h("td", { cls: "col-signin", text: u.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(", ") }),
      currency ? h("td", { cls: "num col-credit", text: u.credit === null ? "–" : money(u.credit, currency) }) : null,
      currency ? h("td", { cls: "num col-used", text: u.spent > 0 ? money(u.spent, currency) : "–" }) : null,
      h("td", { cls: "num col-files", text: u.files ? `${u.files} · ${bytes(u.bytes)}` : "–" }),
    );
    const open = (): void => void openPanel(u.id);
    tr.addEventListener("click", open);
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
    return tr;
  };

  const renderRows = (): void => {
    tbody.replaceChildren(...users.map(row));
    summary.textContent = loading && users.length === 0 ? "Loading…" : `${count(total)} ${total === 1 ? "account" : "accounts"}${users.length < total ? `, ${users.length} shown` : ""}`;
    more.hidden = users.length >= total;
  };

  async function load(append: boolean): Promise<void> {
    const mine = ++seq;
    loading = true;
    listError.hidden = true;
    if (!append) renderRows();
    try {
      const page = await adminApi.users(q, filter, sort, append ? users.length : 0);
      if (mine !== seq) return;
      users = append ? [...users, ...page.users] : page.users;
      total = page.total;
    } catch (err) {
      if (mine !== seq) return;
      listError.textContent = errorMessage(err);
      listError.hidden = false;
    } finally {
      if (mine === seq) {
        loading = false;
        renderRows();
      }
    }
  }

  /** Puts a changed account back in the list where it is. */
  const replaceUser = (u: AdminUser): void => {
    users = users.map((x) => (x.id === u.id ? u : x));
    renderRows();
  };

  const closePanel = (): void => {
    openId = null;
    panel.hidden = true;
    scrim.hidden = true;
    renderRows();
  };

  async function openPanel(id: string): Promise<void> {
    openId = id;
    renderRows();
    panel.hidden = false;
    scrim.hidden = false;
    panel.replaceChildren(h("p", { cls: "adm-empty", text: "Loading…" }));
    const hooks: PanelHooks = {
      show: (d) => {
        replaceUser(d.user);
        if (openId === d.user.id) panel.replaceChildren(...accountPanel(d, currency, hooks));
      },
      closePanel,
      removed: () => removed(id),
    };
    try {
      const d = await adminApi.user(id);
      if (openId === id) panel.replaceChildren(...accountPanel(d, currency, hooks));
    } catch (err) {
      if (openId === id) panel.replaceChildren(h("p", { cls: "adm-error", text: errorMessage(err) }));
    }
  }

  const removed = (id: string): void => {
    users = users.filter((u) => u.id !== id);
    total = Math.max(0, total - 1);
    closePanel();
  };

  let typing = 0;
  search.addEventListener("input", () => {
    clearTimeout(typing);
    typing = window.setTimeout(() => {
      q = search.value.trim();
      void load(false);
    }, 250);
  });
  sortSelect.addEventListener("change", () => {
    sort = sortSelect.value as AdminUserSort;
    void load(false);
  });
  more.addEventListener("click", () => void load(true));
  scrim.addEventListener("click", closePanel);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePanel();
  });

  renderChips();
  void load(false);

  const head = h(
    "tr",
    {},
    h("th", { text: "Person" }),
    h("th", { cls: "col-joined", text: "Joined" }),
    h("th", { cls: "col-seen", text: "Last seen" }),
    h("th", { cls: "col-signin", text: "Signs in with" }),
    currency ? h("th", { cls: "num col-credit", text: "Credit" }) : null,
    currency ? h("th", { cls: "num col-used", text: "Used" }) : null,
    h("th", { cls: "num col-files", text: "Drawings" }),
  );
  return h(
    "div",
    { cls: "adm-people" },
    h(
      "div",
      { cls: "adm-toolbar" },
      search,
      sortSelect,
      h("a", { cls: "adm-btn", text: "Download CSV", attrs: { href: "/api/admin/users.csv", download: "" } }),
    ),
    chips,
    summary,
    listError,
    h("div", { cls: "adm-card adm-table-card" }, h("div", { cls: "adm-table-wrap" }, h("table", { cls: "adm-table adm-people-table" }, h("thead", {}, head), tbody))),
    more,
    scrim,
    panel,
  );
}

interface PanelHooks {
  /** shows the account as it is after a step, in the panel and the list */
  show(d: AdminUserDetail): void;
  closePanel(): void;
  removed(): void;
}

function fact(label: string, value: string | Node): HTMLElement {
  return h("div", { cls: "adm-fact" }, h("span", { cls: "adm-fact-label", text: label }), h("span", { cls: "adm-fact-value" }, value));
}

function ledgerText(r: AdminLedgerRow): string {
  if (r.kind === "topup") return "Top-up";
  if (r.kind === "grant") {
    const what = r.note ?? (r.by === "welcome" ? "Welcome credit" : r.amount < 0 ? "Taken back" : "Given");
    return r.by && r.by !== "welcome" ? `${what} · ${r.by}` : what;
  }
  return r.note ?? (r.kind === "renders" ? "Cloud renders" : "Agent steps");
}

/** The account's panel: its facts, credit, plan and the steps on it. Rebuilt after each step. */
function accountPanel(d: AdminUserDetail, currency: string | null, hooks: PanelHooks): Node[] {
  const u = d.user;
  const error = h("p", { cls: "adm-error", hidden: true, attrs: { role: "alert" } });
  const fail = (err: unknown): void => {
    error.textContent = errorMessage(err);
    error.hidden = false;
  };
  const host = h("div", { cls: "adm-panel-body" });
  /** Runs a step with the panel's buttons off, then shows the account as it is after it. */
  const step = async (run: () => Promise<AdminUserDetail | void>): Promise<void> => {
    error.hidden = true;
    host.toggleAttribute("inert", true);
    try {
      hooks.show((await run()) ?? (await adminApi.user(u.id)));
    } catch (err) {
      fail(err);
    } finally {
      host.toggleAttribute("inert", false);
    }
  };

  const close = h("button", { cls: "adm-btn small ghost adm-panel-close", text: "Close", attrs: { type: "button" } });
  close.addEventListener("click", hooks.closePanel);
  const head = h(
    "div",
    { cls: "adm-panel-head" },
    avatar(u, true),
    h("div", { cls: "adm-panel-who" }, h("h2", { cls: "adm-panel-name", text: u.name }), h("a", { cls: "adm-panel-email", text: u.email, attrs: { href: `mailto:${u.email}` } }), h("div", { cls: "adm-badges" }, ...badges(u))),
    close,
  );

  const v = d.lastVisit;
  const facts = h(
    "div",
    { cls: "adm-facts" },
    fact("Joined", dateTime(u.createdAt)),
    fact("Last seen", u.lastSeenAt ? `${ago(u.lastSeenAt)}` : "not since visits were counted"),
    fact("Days in Rodeo", `${d.daysActive} of the last 30`),
    fact("Last on", v ? `${v.browser} on ${v.os}, ${v.device}${v.country ? ` · ${country(v.country)}` : ""}` : "–"),
    fact("Signs in with", u.providers.map((p) => PROVIDER_LABEL[p] ?? p).join(", ")),
    fact("Cloud drawings", u.files ? `${u.files} · ${bytes(u.bytes)}` : "none"),
    fact("Cloud renders", String(d.renders)),
    fact("Feedback sent", String(d.feedback)),
  );

  const sections: Node[] = [facts];
  if (currency && u.credit !== null) sections.push(creditSection(d, currency, step));
  sections.push(plusSection(u, step), accountSection(u, step, hooks, fail));
  host.append(error, ...sections);
  return [head, host];
}

type Step = (run: () => Promise<AdminUserDetail | void>) => Promise<void>;

function creditSection(d: AdminUserDetail, currency: string, step: Step): HTMLElement {
  const u = d.user;
  let amount = 5;
  const amountInput = h("input", { cls: "adm-input adm-amount", value: "5", attrs: { type: "number", min: "0.01", max: "1000", step: "0.01", inputmode: "decimal", "aria-label": "Amount" } });
  const note = h("input", { cls: "adm-input", placeholder: "A note they'll see, e.g. Thanks for the bug report", attrs: { type: "text", maxlength: "120", "aria-label": "Note" } });
  const notify = h("input", { attrs: { type: "checkbox" } });
  const give = h("button", { cls: "adm-btn primary", attrs: { type: "button" } });
  const take = h("button", { cls: "adm-btn", attrs: { type: "button" } });
  const label = (): void => {
    const ok = Number.isFinite(amount) && amount > 0 && amount <= 1000;
    give.textContent = ok ? `Give ${money(amount, currency, true)}` : "Give";
    take.textContent = ok ? `Take back ${money(amount, currency, true)}` : "Take back";
    give.disabled = !ok;
    take.disabled = !ok || (u.credit ?? 0) < amount;
  };
  const quick = [1, 5, 10, 20].map((n) => {
    const b = h("button", { cls: "adm-chip", text: money(n, currency, true), attrs: { type: "button" } });
    b.addEventListener("click", () => {
      amount = n;
      amountInput.value = String(n);
      label();
      give.focus();
    });
    return b;
  });
  amountInput.addEventListener("input", () => {
    amount = Number(amountInput.value);
    label();
  });
  give.addEventListener("click", () => void step(async () => void (await adminApi.grant(u.id, amount, note.value.trim(), notify.checked))));
  take.addEventListener("click", () => void step(async () => void (await adminApi.grant(u.id, -amount, note.value.trim(), false))));
  label();

  return h(
    "section",
    { cls: "adm-panel-section" },
    h("h3", { cls: "adm-panel-title", text: "AI credit" }),
    h("p", { cls: "adm-balance", text: money(u.credit ?? 0, currency) }),
    h("p", { cls: "adm-muted", text: `Used ${money(u.spent, currency)} · bought ${money(u.bought, currency)} · given ${money(u.granted, currency)}` }),
    h("div", { cls: "adm-chips" }, ...quick, amountInput),
    note,
    h("label", { cls: "adm-check" }, notify, " Email them about it"),
    h("div", { cls: "adm-actions" }, give, take),
    d.ledger.length
      ? h(
          "ul",
          { cls: "adm-ledger" },
          ...d.ledger.map((r) =>
            h(
              "li",
              {},
              h("span", { cls: "adm-ledger-when", text: day(r.at), title: dateTime(r.at) }),
              h("span", { cls: "adm-ledger-what", text: ledgerText(r) }),
              h("span", { cls: r.amount < 0 ? "adm-ledger-amount out" : "adm-ledger-amount in", text: `${r.amount < 0 ? "−" : "+"}${money(Math.abs(r.amount), currency)}` }),
            ),
          ),
        )
      : h("p", { cls: "adm-muted", text: "No credit history yet." }),
  );
}

function plusSection(u: AdminUser, step: Step): HTMLElement {
  const give = (months: number, text: string): HTMLButtonElement => {
    const b = h("button", { cls: "adm-btn", text, attrs: { type: "button" }, disabled: u.paidPlus });
    b.addEventListener("click", () => void step(() => adminApi.plus(u.id, months)));
    return b;
  };
  const end = h("button", { cls: "adm-btn", text: "End it now", attrs: { type: "button" }, hidden: u.plan !== "supporter" || u.paidPlus });
  end.addEventListener("click", () => void step(() => adminApi.plus(u.id, 0)));
  const status =
    u.plan !== "supporter"
      ? "Free plan."
      : u.paidPlus
        ? `Pays for Rodeo Plus through Stripe, to ${u.supporterUntil ? day(u.supporterUntil) : "the period's end"}. Change it in Stripe's dashboard.`
        : `Rodeo Plus, given, until ${u.supporterUntil ? day(u.supporterUntil) : "–"}.`;
  return h(
    "section",
    { cls: "adm-panel-section" },
    h("h3", { cls: "adm-panel-title", text: "Rodeo Plus" }),
    h("p", { cls: "adm-muted", text: status }),
    h("div", { cls: "adm-actions" }, give(1, u.plan === "supporter" ? "1 more month" : "Give 1 month"), give(3, "3 months"), give(12, "1 year"), end),
  );
}

function accountSection(u: AdminUser, step: Step, hooks: PanelHooks, fail: (err: unknown) => void): HTMLElement {
  const signOut = h("button", { cls: "adm-btn", text: "Sign out everywhere", attrs: { type: "button" } });
  signOut.addEventListener("click", () => void step(() => adminApi.signOut(u.id)));
  const suspend = h("button", { cls: u.suspended ? "adm-btn" : "adm-btn danger", text: u.suspended ? "Let back in" : "Suspend", attrs: { type: "button" }, disabled: u.admin });
  suspend.addEventListener("click", () => {
    if (!u.suspended && suspend.dataset.armed !== "1") {
      suspend.dataset.armed = "1";
      suspend.textContent = "Suspend: sure?";
      return;
    }
    void step(() => adminApi.suspend(u.id, !u.suspended));
  });

  const typed = h("input", { cls: "adm-input", placeholder: u.email, attrs: { type: "email", "aria-label": "Type the email to confirm", autocomplete: "off" } });
  const remove = h("button", { cls: "adm-btn danger", text: "Delete for good", attrs: { type: "button" }, disabled: true });
  typed.addEventListener("input", () => {
    remove.disabled = typed.value.trim().toLowerCase() !== u.email;
  });
  const deleteBox = h(
    "div",
    { cls: "adm-delete", hidden: true },
    h("p", { cls: "adm-muted", text: "This deletes the account, its cloud drawings with their versions, and its voice notes. Type the email to confirm." }),
    typed,
    h("div", { cls: "adm-actions" }, remove),
  );
  const startDelete = h("button", { cls: "adm-btn ghost", text: "Delete account…", attrs: { type: "button" }, disabled: u.admin });
  startDelete.addEventListener("click", () => {
    deleteBox.hidden = false;
    startDelete.hidden = true;
    typed.focus();
  });
  remove.addEventListener("click", () => {
    remove.disabled = true;
    adminApi
      .remove(u.id, typed.value.trim())
      .then(hooks.removed)
      .catch((err: unknown) => {
        remove.disabled = false;
        fail(err);
      });
  });

  return h(
    "section",
    { cls: "adm-panel-section" },
    h("h3", { cls: "adm-panel-title", text: "Account" }),
    u.suspended ? h("p", { cls: "adm-muted", text: "Suspended: it can't sign in, and the editor treats it as signed out." }) : null,
    h("div", { cls: "adm-actions" }, signOut, suspend, startDelete),
    deleteBox,
  );
}
