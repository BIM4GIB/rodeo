// Help > Feedback Inbox… (admins only): the reports people have sent, newest first, as New,
// Done or All. Each shows who sent it and the details it carried, its screenshot (a click opens
// it whole) and file to download when it came with them, and its diagnostics folded away, with
// Reply (an email to the sender, when they gave an address), Mark Done or Reopen, and Delete,
// which asks once more.

import { h } from "../../app/dom.ts";
import { errorMessage } from "../../app/toast.ts";
import { currentUser, feedback } from "../../platform/api.ts";
import type { Feedback, FeedbackDiagnostics } from "../../platform/protocol.ts";
import { config } from "../account/config.ts";
import { footButton, openModal, type Modal } from "../account/dialog.ts";
import { shortDate } from "../news/news.ts";
import { sizeText } from "./brought.ts";
import { contextText } from "./report.ts";

type Filter = "new" | "done" | "all";

const KIND_LABEL: Record<Feedback["kind"], string> = { bug: "Bug", idea: "Idea", other: "Other" };

export function openFeedbackInbox(): void {
  if (!config() || currentUser()?.admin !== true) return;
  let list: Feedback[] = [];
  let filter: Filter = "new";
  let loaded = false;
  let modal: Modal | null = null;

  const listHost = h("div", { cls: "fb-inbox-list" }, h("p", { cls: "fb-inbox-empty", text: "Loading…" }));
  const tabs = h("div", { cls: "seg fb-tabs", attrs: { role: "tablist", "aria-label": "Show" } });

  const replace = (next: Feedback): void => {
    list = list.map((f) => (f.id === next.id ? next : f));
  };

  /** Runs an action on one report; the list redraws after, and a failure shows in the dialog. */
  const act = async (work: () => Promise<void>): Promise<void> => {
    modal?.error(null);
    listHost.toggleAttribute("inert", true);
    try {
      await work();
    } catch (err) {
      modal?.error(errorMessage(err));
    } finally {
      listHost.toggleAttribute("inert", false);
      render();
    }
  };

  const item = (f: Feedback): HTMLElement => {
    const from = f.userName ?? f.email ?? "Someone not signed in";
    const actions = h("div", { cls: "fb-item-actions" });
    if (f.email) {
      const subject = encodeURIComponent(`Re: your Rodeo ${f.kind === "idea" ? "idea" : "report"}`);
      actions.append(h("a", { cls: "btn small", text: "Reply", attrs: { href: `mailto:${f.email}?subject=${subject}` } }));
    }
    const toggle = h("button", { cls: "btn small", text: f.status === "new" ? "Mark Done" : "Reopen", attrs: { type: "button" } });
    toggle.addEventListener("click", () => void act(async () => replace(await feedback.setStatus(f.id, f.status === "new" ? "done" : "new"))));
    const del = h("button", { cls: "btn small danger", text: "Delete", attrs: { type: "button" } });
    del.addEventListener("click", () => {
      if (del.dataset.armed !== "1") {
        del.dataset.armed = "1";
        del.textContent = "Delete for good?";
        return;
      }
      void act(async () => {
        await feedback.remove(f.id);
        list = list.filter((x) => x.id !== f.id);
      });
    });
    actions.append(toggle, del);
    return h(
      "article",
      { cls: f.status === "done" ? "fb-item done" : "fb-item" },
      h(
        "div",
        { cls: "fb-item-head" },
        h("span", { cls: `fb-kind fb-kind-${f.kind}`, text: KIND_LABEL[f.kind] }),
        h("span", { cls: "fb-item-from", text: from, attrs: { title: f.email ?? "" } }),
        h("time", { cls: "fb-item-date", text: shortDate(f.createdAt), attrs: { datetime: f.createdAt } }),
      ),
      h("p", { cls: "fb-item-text", text: f.message }),
      f.context && Object.keys(f.context).length > 0 ? h("p", { cls: "fb-item-details", text: contextText(f.context) }) : null,
      attachments(f),
      f.diagnostics ? h("details", { cls: "fb-diag" }, h("summary", { text: "Diagnostics" }), h("pre", { cls: "er-report", text: diagnosticsText(f.diagnostics) })) : null,
      actions,
    );
  };

  const render = (): void => {
    const counts = { new: list.filter((f) => f.status === "new").length, done: list.filter((f) => f.status === "done").length, all: list.length };
    tabs.replaceChildren(
      ...(["new", "done", "all"] as const).map((key) => {
        const label = { new: "New", done: "Done", all: "All" }[key];
        const tab = h("button", {
          cls: filter === key ? "seg-btn active" : "seg-btn",
          text: loaded ? `${label} ${counts[key]}` : label,
          attrs: { type: "button", role: "tab", "aria-selected": String(filter === key) },
        });
        tab.addEventListener("click", () => {
          filter = key;
          render();
        });
        return tab;
      }),
    );
    if (!loaded) return;
    const shown = list.filter((f) => filter === "all" || f.status === filter);
    const empty = filter === "new" ? "Nothing new. Reports people send show up here." : "Nothing here.";
    listHost.replaceChildren(...(shown.length === 0 ? [h("p", { cls: "fb-inbox-empty", text: empty })] : shown.map(item)));
  };

  render();
  modal = openModal({
    title: "Feedback Inbox",
    cls: "admin-dialog fb-inbox-dialog",
    body: [tabs, listHost],
    actions: [footButton("Close", false, () => modal?.close())],
  });

  feedback
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

/** A report's screenshot, and its file to download, or how much of it arrived. */
function attachments(f: Feedback): HTMLElement | null {
  if (!f.screenshot && !f.file) return null;
  const box = h("div", { cls: "fb-item-attach" });
  if (f.screenshot) {
    const url = feedback.screenshotUrl(f.id);
    box.append(
      h(
        "a",
        { cls: "fb-item-shot", attrs: { href: url, target: "_blank", rel: "noopener", title: "Open the screenshot" } },
        h("img", { attrs: { src: url, alt: "Screenshot", loading: "lazy" } }),
      ),
    );
  }
  if (f.file) {
    const whole = f.file.received >= f.file.size;
    box.append(
      whole
        ? h("a", { cls: "btn small", text: `Download ${f.file.name} (${sizeText(f.file.size)})`, attrs: { href: feedback.fileUrl(f.id), download: f.file.name } })
        : h("span", { cls: "fb-item-details", text: `${f.file.name}: ${sizeText(f.file.received)} of ${sizeText(f.file.size)} arrived (still coming, or it stopped)` }),
    );
  }
  return box;
}

/** The diagnostics as lines: where it ran, the drawing on screen, then what happened just before. */
function diagnosticsText(d: FeedbackDiagnostics): string {
  const block = (title: string, rec: Readonly<Record<string, unknown>> | undefined): string[] =>
    rec && Object.keys(rec).length > 0 ? [`${title}:`, ...Object.entries(rec).map(([k, v]) => `  ${k}: ${String(v)}`), ""] : [];
  return [...block("Where", d.env), ...block("Drawing", d.workspace), ...(d.trail?.length ? ["Just before:", ...d.trail.map((t) => `  ${t}`)] : [])]
    .join("\n")
    .trim();
}
