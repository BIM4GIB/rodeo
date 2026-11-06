// The admin page's Announcements tab: a form that posts one, with a preview of how it reads in
// What's new and as the bar across the editor (a bar runs 1, 3, 7 or 14 days), and the posted
// ones, each with Edit and Delete. Every change sends the whole list (billing.setAnnouncements):
// the list shown changes only once the server has it, and what was typed stays when a save fails.
// The tab is kept while the page is open, so its form and list survive a look at another tab.

import "../features/news/news.css";
import "./announcements.css";
import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { isWebUrl } from "../features/account/format.ts";
import { banner } from "../features/news/banners.ts";
import { billing } from "../platform/api.ts";
import type { Announcement } from "../platform/protocol.ts";
import type { AdminContext } from "./context.ts";
import { day } from "./format.ts";
import { card, emptyView } from "./ui.ts";

/** the most the server keeps */
const MAX_POSTED = 20;
const TITLE_MAX = 100;
const TEXT_MAX = 1000;
/** how much of a posted text the list shows */
const EXCERPT = 140;
const DAY_MS = 24 * 60 * 60 * 1000;
const BAR_DAYS = [1, 3, 7, 14];
const DEFAULT_BAR_DAYS = 7;
/** the bar period that keeps an edited announcement's bar as it is */
const KEEP = "keep";

/** An announcement as the form says it, checked. */
interface Draft {
  readonly title: string;
  readonly body: string;
  readonly url: string | null;
  readonly bannerUntil: string | null;
}

/** An announcement's form controls: empty for a new one, filled from the one being edited. */
interface Fields {
  readonly nodes: HTMLElement[];
  readonly title: HTMLInputElement;
  readonly text: HTMLTextAreaElement;
  readonly link: HTMLInputElement;
  readonly bar: HTMLInputElement;
  readonly period: HTMLSelectElement;
  /** the bar's end the edited announcement has (null: no bar) */
  readonly keep: string | null;
  readonly clear: () => void;
}

let made: HTMLElement | null = null;

/** The tab, made the first time it is shown and the same one after. */
export function announcementsView(ctx: AdminContext): HTMLElement {
  made ??= build(ctx);
  return made;
}

function build(ctx: AdminContext): HTMLElement {
  let list: Announcement[] = [...ctx.config.announcements];
  let busy = false;
  let editing: { readonly id: string; readonly el: HTMLElement } | null = null;

  // a disabled fieldset disables every control in it, so nothing is sent twice while a save runs
  const root = h("fieldset", { cls: "adm-ann" });

  const newErr = errorSlot();
  const post = h("button", { cls: "adm-btn primary", text: "Post", attrs: { type: "button" } });
  const fullNote = h("p", {
    cls: "adm-card-note",
    text: `There are ${MAX_POSTED} announcements, the most the server keeps. Delete one to post another.`,
    hidden: true,
  });
  const itemHost = h("div", { cls: "adm-ann-preview-box" });
  const barHost = h("div");
  const barPart = h("div", { cls: "adm-ann-preview-part" }, h("span", { cls: "adm-ann-label", text: "As the bar across the top of the editor" }), barHost);
  const previewCol = h(
    "div",
    { cls: "adm-ann-preview" },
    h("span", { cls: "adm-ann-label", text: "As it appears in What's new" }),
    itemHost,
    barPart,
  );

  const refresh = (): void => {
    const title = f.title.value.trim();
    const body = f.text.value.trim();
    itemHost.replaceChildren(entryPreview(title, body, f.link.value.trim()));
    barHost.replaceChildren(barPreview(title, body));
    barPart.hidden = !f.bar.checked;
  };
  const f = fieldsOf(null, () => refresh());

  const listErr = errorSlot();
  const count = h("p", { cls: "adm-card-note" });
  const listHost = h("div", { cls: "adm-ann-list" });

  /** Sends the whole list. On success it is the list shown, then `done` runs; on failure `where` shows why. */
  const send = async (next: Announcement[], where: (msg: string | null) => void, done?: () => void): Promise<void> => {
    if (busy) return;
    busy = true;
    root.disabled = true;
    where(null);
    try {
      await billing.setAnnouncements(next);
      list = [...next].sort(newestFirst);
      done?.();
      renderList();
    } catch (err) {
      where(errorMessage(err));
    } finally {
      busy = false;
      root.disabled = false;
    }
  };

  post.addEventListener("click", () => {
    const d = draftOf(f, newErr.set);
    if (!d) return;
    const item: Announcement = { id: newAnnouncementId(), date: new Date().toISOString(), ...d };
    void send([item, ...list], newErr.set, () => {
      f.clear();
      refresh();
    });
  });

  const remove = (a: Announcement): void => {
    if (!window.confirm(`Delete “${a.title}”?`)) return;
    void send(
      list.filter((x) => x.id !== a.id),
      listErr.set,
    );
  };

  const startEdit = (a: Announcement): void => {
    const fields = fieldsOf(a);
    const err = errorSlot();
    const save = h("button", { cls: "adm-btn primary", text: "Save", attrs: { type: "button" } });
    const cancel = h("button", { cls: "adm-btn ghost", text: "Cancel", attrs: { type: "button" } });
    save.addEventListener("click", () => {
      const d = draftOf(fields, err.set);
      if (!d) return;
      // the id and the date stay as they were
      const next = list.map((x) => (x.id === a.id ? { ...x, ...d } : x));
      void send(next, err.set, () => {
        editing = null;
      });
    });
    cancel.addEventListener("click", () => {
      editing = null;
      renderList();
    });
    editing = {
      id: a.id,
      el: h("div", { cls: "adm-ann-item adm-ann-editing" }, h("div", { cls: "adm-ann-form" }, ...fields.nodes), err.el, h("div", { cls: "adm-actions" }, save, cancel)),
    };
    renderList();
  };

  const row = (a: Announcement): HTMLElement => {
    if (editing?.id === a.id) return editing.el;
    const edit = h("button", { cls: "adm-btn small", text: "Edit", attrs: { type: "button" }, disabled: editing !== null });
    edit.addEventListener("click", () => startEdit(a));
    const del = h("button", { cls: "adm-btn small danger", text: "Delete", attrs: { type: "button" } });
    del.addEventListener("click", () => remove(a));
    const state = barState(a);
    return h(
      "div",
      { cls: "adm-ann-item" },
      h(
        "div",
        { cls: "adm-ann-head" },
        h("span", { cls: "adm-ann-item-title", text: a.title }),
        h("time", { cls: "adm-ann-date", text: day(a.date), attrs: { datetime: a.date } }),
      ),
      a.body ? h("p", { cls: "adm-ann-excerpt", text: excerpt(a.body) }) : null,
      state ? h("span", { cls: "adm-ann-state", text: state }) : null,
      h("div", { cls: "adm-actions" }, edit, del),
    );
  };

  const renderList = (): void => {
    const full = list.length >= MAX_POSTED;
    post.disabled = full;
    fullNote.hidden = !full;
    count.textContent = `${list.length} of ${MAX_POSTED} posted.`;
    listHost.replaceChildren(...(list.length === 0 ? [emptyView("No announcements yet.")] : list.map(row)));
  };

  renderList();
  refresh();
  root.append(
    card(
      "New announcement",
      h(
        "div",
        { cls: "adm-ann-new" },
        h("div", { cls: "adm-ann-form" }, ...f.nodes, newErr.el, h("div", { cls: "adm-actions" }, post), fullNote),
        previewCol,
      ),
    ),
    card("Posted", count, listErr.el, listHost),
  );
  return root;
}

/** The form's fields for an announcement, or null with the problem said in `where`. */
function draftOf(f: Fields, where: (msg: string) => void): Draft | null {
  const title = f.title.value.trim();
  const link = f.link.value.trim();
  const problem = !title
    ? "Title: enter a title for the announcement."
    : link && !isWebUrl(link)
      ? "Link: enter a web address, or leave it empty."
      : null;
  if (problem) {
    where(problem);
    return null;
  }
  return { title, body: f.text.value.trim(), url: link || null, bannerUntil: barUntil(f) };
}

/** When the bar runs out, from the form: null with no bar, the edited one's end when it keeps it. */
function barUntil(f: Fields): string | null {
  if (!f.bar.checked) return null;
  if (f.period.value === KEEP) return f.keep;
  return new Date(Date.now() + Number(f.period.value) * DAY_MS).toISOString();
}

/** The controls: title, text, link, and the bar's tick box with its period. */
function fieldsOf(from: Announcement | null, onInput: () => void = () => undefined): Fields {
  const keep = from?.bannerUntil ?? null;
  const title = h("input", { cls: "adm-input", value: from?.title ?? "", attrs: { type: "text", autocomplete: "off", maxlength: String(TITLE_MAX) } });
  const text = h("textarea", { cls: "adm-input adm-ann-text", value: from?.body ?? "", attrs: { rows: "4", maxlength: String(TEXT_MAX) } });
  const link = h("input", {
    cls: "adm-input",
    value: from?.url ?? "",
    attrs: { type: "url", inputmode: "url", placeholder: "https://", maxlength: "500", autocomplete: "off" },
  });
  const bar = h("input", { checked: keep !== null, attrs: { type: "checkbox" } });
  const period = h(
    "select",
    { cls: "adm-input", attrs: { "aria-label": "How long the bar shows" } },
    ...(keep === null ? [] : [h("option", { text: `Until ${day(keep)}`, value: KEEP })]),
    ...BAR_DAYS.map((n) => h("option", { text: n === 1 ? "1 day" : `${n} days`, value: String(n) })),
  );
  const syncPeriod = (): void => {
    period.disabled = !bar.checked;
  };
  period.value = keep === null ? String(DEFAULT_BAR_DAYS) : KEEP;
  syncPeriod();

  for (const el of [title, text, link]) el.addEventListener("input", onInput);
  bar.addEventListener("change", () => {
    syncPeriod();
    onInput();
  });
  period.addEventListener("change", onInput);

  const clear = (): void => {
    title.value = "";
    text.value = "";
    link.value = "";
    bar.checked = false;
    period.value = String(DEFAULT_BAR_DAYS);
    syncPeriod();
  };
  const barRow = h(
    "div",
    { cls: "adm-ann-bar-row" },
    h("label", { cls: "adm-check" }, bar, "Also show it as a bar across the top of the editor"),
    period,
  );
  return {
    nodes: [field("Title", title), field("Text", text), field("Link (optional)", link), barRow],
    title,
    text,
    link,
    bar,
    period,
    keep,
    clear,
  };
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h("label", { cls: "adm-ann-field" }, h("span", { cls: "adm-ann-label", text: label }), control);
}

/** A line that shows an error, and takes no room until one comes. */
function errorSlot(): { readonly el: HTMLElement; readonly set: (msg: string | null) => void } {
  const el = h("p", { cls: "adm-error", attrs: { role: "alert" }, hidden: true });
  return {
    el,
    set: (msg) => {
      el.textContent = msg ?? "";
      el.hidden = msg === null;
    },
  };
}

/** The item as What's new shows it (features/news/panel.ts): the date, the drawing, the title, the text and "Read more" when linked. */
function entryPreview(title: string, body: string, link: string): HTMLElement {
  const now = new Date();
  return h(
    "article",
    { cls: "news-entry" },
    h("time", { cls: "news-entry-date", text: shortDate(now), attrs: { datetime: now.toISOString() } }),
    h(
      "div",
      { cls: "news-entry-text" },
      banner(undefined),
      h("h3", { cls: "news-entry-title", text: title || "Untitled" }),
      ...textNodes(body),
      isWebUrl(link) ? h("span", { cls: "news-link", text: "Read more" }) : null,
    ),
  );
}

/** The bar as the editor draws it (features/news/banner.ts), in place here. */
function barPreview(title: string, body: string): HTMLElement {
  const first = body.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  return h(
    "div",
    { cls: "adm-ann-bar" },
    h(
      "div",
      { cls: "adm-ann-bar-text" },
      h("strong", { cls: "adm-ann-bar-title", text: title || "Untitled" }),
      first ? h("span", { cls: "adm-ann-bar-body", text: first }) : null,
    ),
    h("span", { cls: "adm-ann-bar-link", text: "Read more" }),
    h("span", { cls: "adm-ann-bar-close", text: "×", attrs: { "aria-hidden": "true" } }),
  );
}

/** The text as What's new sets it: paragraphs, and runs of "- " lines as bullets (news.ts's bodyNodes). */
function textNodes(body: string): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  let points: HTMLElement | null = null;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("- ")) {
      if (!points) nodes.push((points = h("ul", { cls: "news-points" })));
      points.append(h("li", { text: line.slice(2) }));
    } else {
      points = null;
      if (line) nodes.push(h("p", { cls: "news-body", text: line }));
    }
  }
  return nodes;
}

/** "3 Mar 2027", as What's new writes a date. */
function shortDate(d: Date): string {
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** The start of a text, on one line. */
function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT ? `${flat.slice(0, EXCERPT).trimEnd()}…` : flat;
}

/** "Bar showing until 12 Nov", "Bar ended", or null for an announcement with no bar. */
function barState(a: Announcement): string | null {
  if (!a.bannerUntil) return null;
  return Date.parse(a.bannerUntil) > Date.now() ? `Bar showing until ${day(a.bannerUntil)}` : "Bar ended";
}

const newestFirst = (a: Announcement, b: Announcement): number => Date.parse(b.date) - Date.parse(a.date);

/** A new id for an announcement. */
function newAnnouncementId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
