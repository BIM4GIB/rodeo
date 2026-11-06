// The admin page's Feedback tab: the bug reports and feature requests people have sent, newest
// first (they used to be read in the editor's Help menu). Each shows its kind and whether it is
// new or done, what it says (a long one folds to its first lines), who sent it and when, the details
// it carried, its screenshot (a click opens it whole) and its file (once all of it has arrived), and
// its diagnostics folded away. An admin can reply by email, mark it done or new, or delete it for good.
// Filters pick a status and a kind; the search looks through the messages and the emails.

import "./inbox.css";
import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { feedback } from "../platform/api.ts";
import type { Feedback, FeedbackDiagnostics, FeedbackKind, ReportValue } from "../platform/protocol.ts";
import { updatedNow, type AdminContext } from "./context.ts";
import { ago, bytes, dateTime } from "./format.ts";
import { emptyView, loaded } from "./ui.ts";

type Status = "new" | "done" | "all";
type Kind = "all" | FeedbackKind;

const STATUSES: readonly { readonly id: Status; readonly label: string }[] = [
  { id: "new", label: "New" },
  { id: "done", label: "Done" },
  { id: "all", label: "All" },
];

const KINDS: readonly { readonly id: Kind; readonly label: string }[] = [
  { id: "all", label: "All" },
  { id: "bug", label: "Bugs" },
  { id: "idea", label: "Ideas" },
  { id: "other", label: "Other" },
];

const KIND_LABEL: Record<FeedbackKind, string> = { bug: "Bug", idea: "Idea", other: "Other" };

/** what each detail a report carries is called (the editor's names, from features/feedback/report.ts) */
const DETAIL_LABEL: Readonly<Record<string, string>> = {
  version: "Build",
  browser: "Browser",
  platform: "System",
  screen: "Window",
  language: "Language",
  theme: "Theme",
  view: "View",
  drawing: "Drawing",
  file: "File",
};

/** a message longer than this many lines or characters folds to its first lines */
const FOLD_LINES = 6;
const FOLD_CHARS = 480;

export function feedbackView(ctx: AdminContext): HTMLElement {
  let all: Feedback[] = [];
  let status: Status = "new";
  let kind: Kind = "all";
  let query = "";
  /** the reports on screen, by id, so one can be swapped for its new state */
  const rows = new Map<string, HTMLElement>();
  /** the reports whose long message is open; kept when the list is drawn again */
  const expanded = new Set<string>();

  const search = h("input", {
    cls: "adm-input adm-search",
    placeholder: "Search messages and emails",
    attrs: { type: "search", "aria-label": "Search reports" },
  });
  const statusChips = h("div", { cls: "adm-chips", attrs: { role: "group", "aria-label": "Status" } });
  const kindChips = h("div", { cls: "adm-chips", attrs: { role: "group", "aria-label": "Kind" } });
  const list = h("div", { cls: "adm-fb-list" });

  const countOf = (s: Status): number => (s === "all" ? all.length : all.filter((f) => f.status === s).length);

  const chip = (label: string, on: boolean, pick: () => void): HTMLElement => {
    const b = h("button", { cls: on ? "adm-chip on" : "adm-chip", text: label, attrs: { type: "button", "aria-pressed": String(on) } });
    b.addEventListener("click", pick);
    return b;
  };

  const renderChips = (): void => {
    statusChips.replaceChildren(
      ...STATUSES.map((s) =>
        chip(`${s.label} ${countOf(s.id)}`, s.id === status, () => {
          status = s.id;
          renderChips();
          renderList();
        }),
      ),
    );
    kindChips.replaceChildren(
      ...KINDS.map((k) =>
        chip(k.label, k.id === kind, () => {
          kind = k.id;
          renderChips();
          renderList();
        }),
      ),
    );
  };

  const matches = (f: Feedback): boolean => {
    if (status !== "all" && f.status !== status) return false;
    if (kind !== "all" && f.kind !== kind) return false;
    return query === "" || f.message.toLowerCase().includes(query) || (f.email ?? "").toLowerCase().includes(query);
  };

  const renderList = (): void => {
    rows.clear();
    const shown = all.filter(matches);
    if (shown.length === 0) {
      const filtered = status !== "new" || kind !== "all" || query !== "";
      const text =
        all.length === 0
          ? "No reports yet. Bug reports and ideas people send show up here."
          : filtered
            ? "Nothing matches these filters."
            : "Nothing new. Reports people send show up here.";
      list.replaceChildren(emptyView(text));
      return;
    }
    list.replaceChildren(
      ...shown.map((f) => {
        const el = itemOf(f);
        rows.set(f.id, el);
        return el;
      }),
    );
  };

  /** The counts on the chips and the side bar's badge, after a report changes. */
  const changed = (): void => {
    renderChips();
    ctx.badge("feedback", countOf("new"));
  };

  /** Swaps a report's row for one showing its new state. It stays where it is, even if the filters no longer match it. */
  const replaceItem = (f: Feedback): void => {
    const old = rows.get(f.id);
    if (!old) return;
    const el = itemOf(f);
    old.replaceWith(el);
    rows.set(f.id, el);
  };

  const itemOf = (f: Feedback): HTMLElement => {
    const note = h("p", { cls: "adm-error", hidden: true, attrs: { role: "alert" } });
    const fail = (err: unknown): void => {
      note.textContent = errorMessage(err);
      note.hidden = false;
    };

    const actions = h("div", { cls: "adm-fb-actions" });
    if (f.email) {
      const subject = encodeURIComponent(`Re: your Rodeo ${f.kind === "idea" ? "idea" : "report"}`);
      actions.append(h("a", { cls: "adm-btn small", text: "Reply by email", attrs: { href: `mailto:${f.email}?subject=${subject}` } }));
    }
    const toggle = h("button", { cls: "adm-btn small", text: f.status === "new" ? "Mark done" : "Mark new", attrs: { type: "button" } });
    toggle.addEventListener("click", () => {
      toggle.disabled = true;
      feedback
        .setStatus(f.id, f.status === "new" ? "done" : "new")
        .then((next) => {
          all = all.map((x) => (x.id === next.id ? next : x));
          replaceItem(next);
          changed();
        })
        .catch(fail)
        .finally(() => {
          toggle.disabled = false;
        });
    });
    const del = h("button", { cls: "adm-btn small danger", text: "Delete", attrs: { type: "button" } });
    del.addEventListener("click", () => {
      if (!window.confirm("Delete this report for good? Its screenshot and file go too.")) return;
      del.disabled = true;
      feedback
        .remove(f.id)
        .then(() => {
          all = all.filter((x) => x.id !== f.id);
          expanded.delete(f.id);
          rows.get(f.id)?.remove();
          rows.delete(f.id);
          if (rows.size === 0) renderList();
          changed();
        })
        .catch((err: unknown) => {
          del.disabled = false;
          fail(err);
        });
    });
    actions.append(toggle, del);

    const pairs = detailPairs(f.context ?? {});
    return h(
      "article",
      { cls: f.status === "done" ? "adm-fb-item done" : "adm-fb-item" },
      h(
        "div",
        { cls: "adm-fb-head" },
        h("span", { cls: `adm-badge adm-fb-kind-${f.kind}`, text: KIND_LABEL[f.kind] }),
        h("span", { cls: `adm-badge adm-fb-status-${f.status}`, text: f.status === "new" ? "New" : "Done" }),
        h("span", { cls: "adm-fb-who", text: who(f), attrs: { title: f.email ?? "" } }),
        h("time", { cls: "adm-fb-when", text: ago(f.createdAt), attrs: { datetime: f.createdAt, title: dateTime(f.createdAt) } }),
      ),
      messageBox(f.id, f.message, expanded),
      pairs.length > 0 ? factList(pairs) : null,
      attachments(f),
      ...diagnostics(f.diagnostics),
      actions,
      note,
    );
  };

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    renderList();
  });

  return loaded(
    ctx.signal,
    () => feedback.list(),
    (data) => {
      all = data;
      renderChips();
      renderList();
      return h(
        "div",
        { cls: "adm-fb-root" },
        h("div", { cls: "adm-toolbar" }, search),
        h("div", { cls: "adm-fb-filters" }, statusChips, kindChips),
        list,
      );
    },
    {
      onLoad: () => {
        ctx.badge("feedback", countOf("new"));
        ctx.updated(updatedNow());
      },
    },
  );
}

/** Who sent it: the account's name and the email, or no one signed in. */
function who(f: Feedback): string {
  const parts = [f.userName, f.email].filter((v): v is string => Boolean(v));
  return parts.length > 0 ? parts.join(" · ") : "Someone not signed in";
}

/** A message as sent, or its first lines with a button for the rest. */
function messageBox(id: string, text: string, expanded: Set<string>): HTMLElement {
  const long = text.split("\n").length > FOLD_LINES || text.length > FOLD_CHARS;
  const open = expanded.has(id);
  const p = h("p", { cls: "adm-fb-text", text: long && !open ? foldedText(text) : text });
  if (!long) return p;
  const more = h("button", {
    cls: "adm-btn small ghost",
    text: open ? "Show less" : "Show more",
    attrs: { type: "button", "aria-expanded": String(open) },
  });
  more.addEventListener("click", () => {
    const nowOpen = !expanded.has(id);
    if (nowOpen) expanded.add(id);
    else expanded.delete(id);
    p.textContent = nowOpen ? text : foldedText(text);
    more.textContent = nowOpen ? "Show less" : "Show more";
    more.setAttribute("aria-expanded", String(nowOpen));
  });
  return h("div", { cls: "adm-fb-message" }, p, more);
}

function foldedText(text: string): string {
  return `${text.split("\n").slice(0, FOLD_LINES).join("\n").slice(0, FOLD_CHARS).trimEnd()}…`;
}

/** The details a report carries that have a value, in the editor's names. */
function detailPairs(context: Readonly<Record<string, string | undefined>>): [string, string][] {
  return Object.keys(DETAIL_LABEL).flatMap((key) => {
    const value = context[key];
    return value ? [[DETAIL_LABEL[key] ?? key, value] as [string, string]] : [];
  });
}

function factList(pairs: readonly [string, string][]): HTMLElement {
  return h("dl", { cls: "adm-fb-facts" }, ...pairs.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: v })]));
}

/** The screenshot as a thumbnail, and the file to download once all of it has come (or how much has). */
function attachments(f: Feedback): HTMLElement | null {
  if (!f.screenshot && !f.file) return null;
  const box = h("div", { cls: "adm-fb-attach" });
  if (f.screenshot) {
    const url = feedback.screenshotUrl(f.id);
    box.append(
      h(
        "a",
        { cls: "adm-fb-shot", attrs: { href: url, target: "_blank", rel: "noopener", title: "Open the screenshot whole" } },
        h("img", { attrs: { src: url, alt: "Screenshot", loading: "lazy" } }),
      ),
    );
  }
  if (f.file) {
    const { name, size, received } = f.file;
    box.append(
      received >= size
        ? h("a", { cls: "adm-btn small", text: `Download ${name} (${bytes(size)})`, attrs: { href: feedback.fileUrl(f.id), download: name } })
        : h("span", { cls: "adm-muted", text: `${name}: ${bytes(received)} of ${bytes(size)} arrived (still coming, or it stopped)` }),
    );
  }
  return box;
}

/** The diagnostics folded away: where it ran and the drawing, then what happened just before (oldest first). */
function diagnostics(d: FeedbackDiagnostics | null | undefined): (HTMLElement | null)[] {
  if (!d) return [];
  const where = [...recordLines("Where", d.env), ...recordLines("Drawing", d.workspace)].join("\n").trim();
  const trail = d.trail ?? [];
  return [
    where ? h("details", { cls: "adm-fb-diag" }, h("summary", { text: "Diagnostics" }), h("pre", { cls: "adm-fb-pre", text: where })) : null,
    trail.length > 0
      ? h("details", { cls: "adm-fb-diag" }, h("summary", { text: `Just before (${trail.length})` }), h("pre", { cls: "adm-fb-pre", text: trail.join("\n") }))
      : null,
  ];
}

/** A record's lines under its title: "Where:", then "  build: 1.2.3" for each entry. */
function recordLines(title: string, rec: Readonly<Record<string, ReportValue>> | undefined): string[] {
  return rec && Object.keys(rec).length > 0 ? [`${title}:`, ...Object.entries(rec).map(([k, v]) => `  ${k}: ${String(v)}`), ""] : [];
}
