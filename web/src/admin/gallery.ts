// The admin page's Gallery: the drawings readers have reported, and the drawings an admin has taken
// out. Each drawing is a card with its open reports and the moves an admin can make on it: hide it
// with a reason (its owner is emailed the reason), restore it, dismiss its reports, or pick it for
// the front of the gallery. Each move loads the queue again.

import "./manage.css";
import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { galleryApi } from "../features/gallery/api.ts";
import { LIMITS, REPORT_REASONS, entryPath, type ModerationItem, type ModerationReport } from "../features/gallery/rules.ts";
import type { AdminContext } from "./context.ts";
import { ago, dateTime } from "./format.ts";
import { emptyView, errorView, loadingView, section } from "./ui.ts";

/** Runs one move for a card: the card's controls wait while it runs, and the queue is loaded again after. */
type Mover = (card: HTMLElement, err: HTMLElement, task: () => Promise<void>, done: string) => Promise<void>;

/** A button for a move: danger for hiding, plain for the rest. */
function button(label: string, kind: "danger" | "", onClick: () => void): HTMLButtonElement {
  const b = h("button", { cls: kind ? `adm-btn ${kind}` : "adm-btn", text: label, attrs: { type: "button" } });
  b.addEventListener("click", onClick);
  return b;
}

/** Turns the card's buttons and inputs off, or back on. */
function setBusy(card: HTMLElement, busy: boolean): void {
  for (const el of card.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")) el.disabled = busy;
}

/** The label of a report's reason. */
function reasonOf(id: string): string {
  return REPORT_REASONS.find((r) => r.id === id)?.label ?? id;
}

/** Who sent a report: the name and email that were given, or "anonymous". */
function reporterOf(r: ModerationReport): string {
  if (r.reporterName && r.email) return `${r.reporterName} (${r.email})`;
  return r.reporterName ?? r.email ?? "anonymous";
}

/** One open report: its reason, its note, who sent it and when. */
function reportItem(r: ModerationReport): HTMLElement {
  return h(
    "li",
    { cls: "adm-mod-report" },
    h("strong", { text: reasonOf(r.reason) }),
    r.note ? h("p", { cls: "adm-mod-note", text: r.note }) : null,
    h("span", { cls: "adm-mod-meta", text: `From ${reporterOf(r)} · ${ago(r.createdAt)}`, title: dateTime(r.createdAt) }),
  );
}

/** A drawing's picture: its cover, or its title's first letter until it has one. */
function coverOf(item: ModerationItem): HTMLElement {
  const e = item.entry;
  if (e.coverUrl) return h("img", { cls: "adm-mod-cover", attrs: { src: e.coverUrl, alt: "", loading: "lazy", decoding: "async" } });
  const initial = Array.from(e.title.trim())[0]?.toUpperCase() ?? "R";
  return h("span", { cls: "adm-mod-cover adm-mod-plain", text: initial, attrs: { "aria-hidden": "true" } });
}

/** One drawing in the queue: its cover and title, its open reports, and the moves on it. */
function itemCard(item: ModerationItem, move: Mover): HTMLElement {
  const e = item.entry;
  const hidden = e.state === "hidden";
  const card = h("section", { cls: "adm-card adm-mod-card" });
  const err = h("p", { cls: "adm-error", attrs: { role: "alert" }, hidden: true });
  const go = (task: () => Promise<void>, done: string): Promise<void> => move(card, err, task, done);

  const info = h(
    "div",
    { cls: "adm-mod-info" },
    h("h3", { cls: "adm-mod-title" }, h("a", { text: e.title, attrs: { href: entryPath(e.id, e.title), target: "_blank", rel: "noopener" } })),
    h("p", { cls: "adm-mod-line", text: `By ${e.creditName}` }),
    h("p", { cls: "adm-mod-line", text: `Owner: ${item.ownerEmail || "unknown"}` }),
    h(
      "div",
      { cls: "adm-badges" },
      hidden ? h("span", { cls: "adm-badge danger", text: "Hidden" }) : null,
      e.featured ? h("span", { cls: "adm-badge plus", text: "Picked" }) : null,
    ),
    hidden ? h("p", { cls: "adm-mod-reason", text: `Reason: ${e.hiddenReason ?? "none was given"}` }) : null,
  );

  const reports =
    item.reports.length > 0
      ? h("ul", { cls: "adm-mod-reports" }, ...item.reports.map(reportItem))
      : h("p", { cls: "adm-muted", text: "No open reports." });

  const actions = h("div", { cls: "adm-actions" });
  if (hidden) {
    actions.append(
      button("Restore", "", () => void go(() => galleryApi.restore(e.id), `“${e.title}” is back in the gallery. Its owner has been emailed.`)),
    );
  }
  if (item.reports.length > 0) {
    actions.append(button("Dismiss reports", "", () => void go(() => galleryApi.dismiss(e.id), `The reports on “${e.title}” are dismissed.`)));
  }
  actions.append(
    button(e.featured ? "Unfeature" : "Feature", "", () =>
      void go(
        () => galleryApi.feature(e.id, !e.featured),
        e.featured ? `“${e.title}” is no longer picked for the front.` : `“${e.title}” is picked for the front of the gallery.`,
      ),
    ),
  );

  const moves: Node[] = [];
  if (!hidden) {
    const reason = h("input", {
      cls: "adm-input adm-mod-input",
      attrs: { type: "text", maxlength: String(LIMITS.hideReason), "aria-label": "Reason for hiding", placeholder: "Reason" },
    });
    const hide = button("Hide", "danger", () => {
      const text = reason.value.trim();
      if (!text) {
        err.textContent = "Give a reason. The owner is emailed it.";
        err.hidden = false;
        reason.focus();
        return;
      }
      void go(() => galleryApi.hide(e.id, text), `Hidden “${e.title}”. Its owner has been emailed the reason.`);
    });
    reason.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") hide.click();
    });
    moves.push(
      h(
        "div",
        { cls: "adm-mod-hide" },
        h("p", { cls: "adm-card-note", text: "Hiding takes it out of the gallery at once, and emails its owner the reason." }),
        h("div", { cls: "adm-actions" }, reason, hide),
      ),
    );
  }

  card.append(h("div", { cls: "adm-mod-top" }, coverOf(item), info), reports, ...moves, actions, err);
  return card;
}

export function galleryView(ctx: AdminContext): HTMLElement {
  const notice = h("p", { cls: "adm-mod-notice", attrs: { role: "status" }, hidden: true });
  const pageError = h("p", { cls: "adm-error", attrs: { role: "alert" }, hidden: true });
  const list = h("div", { cls: "adm-mod-list" }, loadingView());
  let shown = false;

  /** Runs a move: its card waits while it runs; a failure is shown on the card, a success is said and the queue reloaded. */
  const move: Mover = async (card, err, task, done) => {
    err.hidden = true;
    notice.hidden = true;
    setBusy(card, true);
    try {
      await task();
    } catch (caught) {
      if (ctx.signal.aborted) return;
      setBusy(card, false);
      err.textContent = errorMessage(caught);
      err.hidden = false;
      return;
    }
    if (ctx.signal.aborted) return;
    notice.textContent = done;
    notice.hidden = false;
    await load();
  };

  /** Fetches the queue and puts it in the list; the badge counts the drawings with open reports. */
  const load = async (): Promise<void> => {
    try {
      const items = await galleryApi.moderation();
      if (ctx.signal.aborted) return;
      ctx.badge("gallery", items.filter((item) => item.reports.length > 0).length);
      list.replaceChildren(
        ...(items.length > 0
          ? items.map((item) => itemCard(item, move))
          : [emptyView("Nothing to review. Reported drawings show here.")]),
      );
      shown = true;
      pageError.hidden = true;
    } catch (err) {
      if (ctx.signal.aborted) return;
      if (shown) {
        pageError.textContent = errorMessage(err);
        pageError.hidden = false;
      } else {
        list.replaceChildren(errorView(err));
      }
    }
  };

  void load();
  return section(
    "Reported and hidden",
    "Drawings readers have reported, and drawings taken out of the gallery. Hiding one emails its owner the reason.",
    notice,
    pageError,
    list,
  );
}
