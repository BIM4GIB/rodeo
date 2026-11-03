// Help > Error Reports… (admins only): what the editor reported on its own (app/reports.ts) and
// the server's own errors, one row per error with how often it came and when, latest first.
// Details shows the latest report in full; Copy puts it on the clipboard as text to paste into a
// bug or a chat; Clear drops the error once it is fixed (a report of it after that starts afresh).

import { h } from "../../app/dom.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { currentUser, errorReports } from "../../platform/api.ts";
import type { ErrorReport, ErrorReportGroup } from "../../platform/protocol.ts";
import { config } from "../account/config.ts";
import { footButton, openModal, type Modal } from "../account/dialog.ts";

const KIND_LABEL: Record<ErrorReportGroup["kind"], string> = { crash: "Crash", failure: "Failure", slow: "Slow", server: "Server" };

/** "3 min ago", "5 h ago", "2 Nov": when an error was last seen. */
function ago(iso: string): string {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** A report as plain text: what it was, what bore on it, where, the trail and the stack. */
export function reportText(g: ErrorReportGroup, r: ErrorReport = g.latest): string {
  const block = (title: string, rec: Readonly<Record<string, unknown>> | undefined): string[] =>
    rec && Object.keys(rec).length ? ["", `${title}:`, ...Object.entries(rec).map(([k, v]) => `  ${k}: ${String(v)}`)] : [];
  return [
    `${KIND_LABEL[g.kind]} in ${g.area}: ${r.message}`,
    `${g.count} ${g.count === 1 ? "time" : "times"}, first ${g.firstSeen}, last ${g.lastSeen} (group ${g.fingerprint})`,
    `This one: ${r.createdAt}, ${r.userName ?? "signed out"}`,
    ...block("Details", r.details),
    ...block("Where", r.env),
    ...(r.trail?.length ? ["", "Just before:", ...r.trail.map((t) => `  ${t}`)] : []),
    ...(r.stack ? ["", "Stack:", r.stack] : []),
  ].join("\n");
}

export function openErrorReports(): void {
  if (!config() || currentUser()?.admin !== true) return;
  let list: ErrorReportGroup[] = [];
  let loaded = false;
  let modal: Modal | null = null;
  const open = new Set<string>();
  const listHost = h("div", { cls: "fb-inbox-list" }, h("p", { cls: "fb-inbox-empty", text: "Loading…" }));

  const item = (g: ErrorReportGroup): HTMLElement => {
    const r = g.latest;
    const actions = h("div", { cls: "fb-item-actions" });
    const more = h("button", { cls: "btn small", text: open.has(g.fingerprint) ? "Hide" : "Details", attrs: { type: "button" } });
    more.addEventListener("click", () => {
      if (open.has(g.fingerprint)) open.delete(g.fingerprint);
      else open.add(g.fingerprint);
      render();
    });
    const copy = h("button", { cls: "btn small", text: "Copy", attrs: { type: "button" } });
    copy.addEventListener("click", () => {
      navigator.clipboard
        .writeText(reportText(g))
        .then(() => toast("Copied the report.", "info"))
        .catch((err: unknown) => modal?.error(errorMessage(err)));
    });
    const clear = h("button", { cls: "btn small danger", text: "Clear", attrs: { type: "button", title: "Drop this error, once it is fixed" } });
    clear.addEventListener("click", () => {
      if (clear.dataset.armed !== "1") {
        clear.dataset.armed = "1";
        clear.textContent = "Clear for good?";
        return;
      }
      modal?.error(null);
      listHost.toggleAttribute("inert", true);
      errorReports
        .clear(g.fingerprint)
        .then(() => {
          list = list.filter((x) => x.fingerprint !== g.fingerprint);
        })
        .catch((err: unknown) => modal?.error(errorMessage(err)))
        .finally(() => {
          listHost.toggleAttribute("inert", false);
          render();
        });
    });
    actions.append(more, copy, clear);
    const where = [r.env?.build, r.env?.browser, r.env?.platform, r.env?.gpu].filter((v) => v !== undefined && v !== null && v !== "").join(" · ");
    return h(
      "article",
      { cls: "fb-item" },
      h(
        "div",
        { cls: "fb-item-head" },
        h("span", { cls: `fb-kind er-kind-${g.kind}`, text: KIND_LABEL[g.kind] }),
        h("span", { cls: "fb-item-from", text: `${g.area} · ${g.count} ${g.count === 1 ? "time" : "times"}`, attrs: { title: `first ${g.firstSeen}` } }),
        h("time", { cls: "fb-item-date", text: ago(g.lastSeen), attrs: { datetime: g.lastSeen, title: g.lastSeen } }),
      ),
      h("p", { cls: "fb-item-text", text: r.message }),
      where ? h("p", { cls: "fb-item-details", text: `${where}${r.userName ? ` · ${r.userName}` : ""}` }) : null,
      open.has(g.fingerprint) ? h("pre", { cls: "er-report", text: reportText(g) }) : null,
      actions,
    );
  };

  const render = (): void => {
    if (!loaded) return;
    listHost.replaceChildren(
      ...(list.length === 0 ? [h("p", { cls: "fb-inbox-empty", text: "No errors reported. What the editor reports on its own shows up here." })] : list.map(item)),
    );
  };

  modal = openModal({
    title: "Error Reports",
    cls: "admin-dialog fb-inbox-dialog",
    body: [listHost],
    actions: [footButton("Close", false, () => modal?.close())],
  });

  errorReports
    .list()
    .then((all) => {
      list = all;
      loaded = true;
      render();
    })
    .catch((err: unknown) => {
      listHost.replaceChildren();
      modal?.error(errorMessage(err));
    });
}
