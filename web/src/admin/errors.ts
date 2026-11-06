// The admin page's Errors tab: what the editor reported on its own (a crash nothing caught, a failure
// the user was told of, work that crawled) and the server's own errors. One row per error, with its
// kind, where it happened, how often it came and when it was first and last seen, latest first; a
// filter keeps the ones seen lately. Details loads the reports kept of an error (the latest in full):
// when, who, build and browser, the details, the stack and what happened just before. Copy puts the
// latest report on the clipboard as text; Clear drops the error once it is fixed (a report of it
// after that starts afresh).

import "./inbox.css";
import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { errorReports } from "../platform/api.ts";
import type { ErrorReport, ErrorReportGroup, ErrorReportKind, ReportValue } from "../platform/protocol.ts";
import { updatedNow, type AdminContext } from "./context.ts";
import { ago, dateTime } from "./format.ts";
import { emptyView, errorView, loaded } from "./ui.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

type Range = "day" | "week" | "all";

/** how far back "last seen" counts for each filter (null: every error) */
const RANGES: readonly { readonly id: Range; readonly label: string; readonly ms: number | null }[] = [
  { id: "day", label: "Last day", ms: DAY_MS },
  { id: "week", label: "Last week", ms: 7 * DAY_MS },
  { id: "all", label: "All", ms: null },
];

const KIND_LABEL: Record<ErrorReportKind, string> = { crash: "Crash", failure: "Failure", slow: "Slow", server: "Server" };

export function errorsView(ctx: AdminContext): HTMLElement {
  let groups: ErrorReportGroup[] = [];
  let range: Range = "all";
  /** the groups on screen, by fingerprint, so Clear can take one off */
  const rows = new Map<string, HTMLElement>();
  const chips = h("div", { cls: "adm-chips", attrs: { role: "group", "aria-label": "Last seen" } });
  const list = h("div", { cls: "adm-err-list" });

  const seenWithin = (g: ErrorReportGroup, ms: number | null): boolean => ms === null || Date.parse(g.lastSeen) >= Date.now() - ms;
  const rangeMs = (): number | null => RANGES.find((r) => r.id === range)?.ms ?? null;
  const dayCount = (): number => groups.filter((g) => seenWithin(g, DAY_MS)).length;

  const renderChips = (): void => {
    chips.replaceChildren(
      ...RANGES.map((r) => {
        const b = h("button", {
          cls: r.id === range ? "adm-chip on" : "adm-chip",
          text: r.label,
          attrs: { type: "button", "aria-pressed": String(r.id === range) },
        });
        b.addEventListener("click", () => {
          range = r.id;
          renderChips();
          renderList();
        });
        return b;
      }),
    );
  };

  const renderList = (): void => {
    rows.clear();
    const shown = groups.filter((g) => seenWithin(g, rangeMs()));
    if (shown.length === 0) {
      list.replaceChildren(emptyView(groups.length === 0 ? "No errors reported. What the editor reports on its own shows up here." : "No errors seen in this time."));
      return;
    }
    list.replaceChildren(
      ...shown.map((g) => {
        const el = itemOf(g);
        rows.set(g.fingerprint, el);
        return el;
      }),
    );
  };

  const itemOf = (g: ErrorReportGroup): HTMLElement => {
    const note = h("p", { cls: "adm-error", hidden: true, attrs: { role: "alert" } });
    const fail = (err: unknown): void => {
      note.textContent = errorMessage(err);
      note.hidden = false;
    };
    const latest = g.latest;
    const where = [latest.env?.build, latest.env?.browser, latest.env?.platform, latest.env?.gpu].filter((v) => v !== undefined && v !== null && v !== "");

    // the kept reports load the first time the details open, and again after a failure
    const reports = h("div", { cls: "adm-err-reports" });
    const details = h("details", { cls: "adm-err-details" }, h("summary", { text: "Details" }), reports);
    let fetched = false;
    details.addEventListener("toggle", () => {
      if (!details.open || fetched) return;
      fetched = true;
      reports.replaceChildren(h("p", { cls: "adm-muted", text: "Loading…" }));
      errorReports
        .group(g.fingerprint)
        .then((kept) => reports.replaceChildren(...(kept.length > 0 ? kept.map((r) => reportOf(r)) : [emptyView("No reports kept of this error.")])))
        .catch((err: unknown) => {
          fetched = false;
          reports.replaceChildren(errorView(err));
        });
    });

    const copy = h("button", {
      cls: "adm-btn small",
      text: "Copy",
      attrs: { type: "button", title: "Copy the latest report as text, to paste into a bug or a chat" },
    });
    copy.addEventListener("click", () => {
      navigator.clipboard
        .writeText(asText(g))
        .then(() => {
          copy.textContent = "Copied";
          window.setTimeout(() => {
            copy.textContent = "Copy";
          }, 1600);
        })
        .catch(fail);
    });
    const clear = h("button", {
      cls: "adm-btn small danger",
      text: "Clear",
      attrs: { type: "button", title: "Drop this error, once it is fixed" },
    });
    clear.addEventListener("click", () => {
      if (!window.confirm("Clear this error and its reports?")) return;
      clear.disabled = true;
      errorReports
        .clear(g.fingerprint)
        .then(() => {
          groups = groups.filter((x) => x.fingerprint !== g.fingerprint);
          rows.get(g.fingerprint)?.remove();
          rows.delete(g.fingerprint);
          if (rows.size === 0) renderList();
          ctx.badge("errors", dayCount());
        })
        .catch((err: unknown) => {
          clear.disabled = false;
          fail(err);
        });
    });

    return h(
      "article",
      { cls: "adm-err-item" },
      h(
        "div",
        { cls: "adm-err-head" },
        h("span", { cls: `adm-badge adm-err-kind-${g.kind}`, text: KIND_LABEL[g.kind] }),
        h("span", { cls: "adm-err-area", text: g.area }),
        h("span", { cls: "adm-err-count", text: `${g.count} ${g.count === 1 ? "time" : "times"}` }),
      ),
      h("p", { cls: "adm-err-message", text: g.message }),
      h(
        "p",
        { cls: "adm-err-meta" },
        "First seen ",
        h("time", { text: dateTime(g.firstSeen), attrs: { datetime: g.firstSeen } }),
        ". Last seen ",
        h("time", { text: ago(g.lastSeen), attrs: { datetime: g.lastSeen, title: dateTime(g.lastSeen) } }),
        ".",
      ),
      h("p", { cls: "adm-err-meta", text: `Latest from ${latest.userName ?? "signed out"}${where.length > 0 ? ` · ${where.join(" · ")}` : ""}` }),
      details,
      h("div", { cls: "adm-err-actions" }, copy, clear),
      note,
    );
  };

  return loaded(
    ctx.signal,
    () => errorReports.list().then(latestFirst),
    (data) => {
      groups = data;
      renderChips();
      renderList();
      return h("div", { cls: "adm-err-root" }, h("div", { cls: "adm-err-filters" }, chips), list);
    },
    {
      onLoad: () => {
        ctx.badge("errors", dayCount());
        ctx.updated(updatedNow());
      },
    },
  );
}

function latestFirst(gs: ErrorReportGroup[]): ErrorReportGroup[] {
  return [...gs].sort((a, b) => Date.parse(b.lastSeen) - Date.parse(a.lastSeen));
}

/** One kept report: when, who, what it said, its details and where it ran, what happened just before, and the stack. */
function reportOf(r: ErrorReport): HTMLElement {
  const trail = r.trail ?? [];
  return h(
    "section",
    { cls: "adm-err-report" },
    h(
      "div",
      { cls: "adm-err-report-head" },
      h("time", { text: dateTime(r.createdAt), attrs: { datetime: r.createdAt } }),
      h("span", { cls: "adm-muted", text: r.userName ?? "signed out" }),
    ),
    h("p", { cls: "adm-err-report-message", text: r.message }),
    recordBlock("Details", r.details),
    recordBlock("Where", r.env),
    trail.length > 0
      ? h("details", { cls: "adm-err-details" }, h("summary", { text: `Just before (${trail.length})` }), h("pre", { cls: "adm-err-pre", text: trail.join("\n") }))
      : null,
    r.stack ? h("div", { cls: "adm-err-block" }, h("p", { cls: "adm-err-label", text: "Stack" }), h("pre", { cls: "adm-err-pre", text: r.stack })) : null,
  );
}

/** A record's entries as a list of name and value; nothing when it is empty. */
function recordBlock(title: string, rec: Readonly<Record<string, ReportValue>> | undefined): HTMLElement | null {
  const entries = Object.entries(rec ?? {});
  if (entries.length === 0) return null;
  return h(
    "div",
    { cls: "adm-err-block" },
    h("p", { cls: "adm-err-label", text: title }),
    h("dl", { cls: "adm-err-facts" }, ...entries.flatMap(([k, v]) => [h("dt", { text: k }), h("dd", { text: String(v) })])),
  );
}

/** The latest report as plain text, to paste into a bug or a chat: what it was, what bore on it, where, the trail and the stack. */
function asText(g: ErrorReportGroup): string {
  const r = g.latest;
  const block = (title: string, rec: Readonly<Record<string, ReportValue>> | undefined): string[] =>
    rec && Object.keys(rec).length > 0 ? ["", `${title}:`, ...Object.entries(rec).map(([k, v]) => `  ${k}: ${String(v)}`)] : [];
  return [
    `${KIND_LABEL[g.kind]} in ${g.area}: ${r.message}`,
    `${g.count} ${g.count === 1 ? "time" : "times"}, first ${g.firstSeen}, last ${g.lastSeen} (group ${g.fingerprint})`,
    `This one: ${r.createdAt}, ${r.userName ?? "signed out"}`,
    ...block("Details", r.details),
    ...block("Where", r.env),
    ...(r.trail && r.trail.length > 0 ? ["", "Just before:", ...r.trail.map((t) => `  ${t}`)] : []),
    ...(r.stack ? ["", "Stack:", r.stack] : []),
  ].join("\n");
}
