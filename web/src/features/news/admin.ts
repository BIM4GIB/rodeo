// Help > Announcements… (admins only): the announcements the What's new list (and the start
// hub's link to it) shows, each with a Delete, and a form that posts a new one at the top. Each change sends the
// whole list to the server, then the editor takes the new config. The dialog stays open when a
// save fails, so nothing typed is lost.

import { h } from "../../app/dom.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { billing, currentUser } from "../../platform/api.ts";
import type { Announcement } from "../../platform/protocol.ts";
import { config, reloadConfig } from "../account/config.ts";
import { field, footButton, openModal, type Modal } from "../account/dialog.ts";
import { isWebUrl } from "../account/format.ts";
import { shortDate } from "./news.ts";

export function openAnnouncementsEditor(): void {
  const cfg = config();
  if (!cfg || currentUser()?.admin !== true) return;
  let list: readonly Announcement[] = cfg.announcements;
  let busy = false;
  let modal: Modal | null = null;

  const listHost = h("div", { cls: "news-admin-list" });
  const titleInput = h("input", {
    cls: "acct-input",
    attrs: { type: "text", autocomplete: "off", maxlength: "100", "aria-label": "Title" },
  });
  const textInput = h("textarea", {
    cls: "acct-input acct-textarea",
    attrs: { rows: "3", maxlength: "1000", "aria-label": "Text" },
  });
  const linkInput = h("input", {
    cls: "acct-input",
    attrs: { type: "url", inputmode: "url", placeholder: "https:// (optional)", maxlength: "500", "aria-label": "Link" },
  });
  const postButton = footButton("Post", true, () => post());

  const setBusy = (on: boolean): void => {
    busy = on;
    postButton.disabled = on;
    listHost.toggleAttribute("inert", on);
  };

  /** Sends the whole list; `saved` runs once the server has it. */
  const save = async (next: readonly Announcement[], saved?: () => void): Promise<void> => {
    if (busy) return;
    modal?.error(null);
    setBusy(true);
    try {
      await billing.setAnnouncements(next);
      // the server has the list, so it is the list here even if the reload below fails
      list = next;
      saved?.();
      renderList();
      await reloadConfig();
      toast("Announcements saved", "info");
    } catch (err) {
      modal?.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const post = (): void => {
    const headline = titleInput.value.trim();
    if (!headline) {
      modal?.error("Title: enter a title for the announcement.");
      return;
    }
    const link = linkInput.value.trim();
    if (link && !isWebUrl(link)) {
      modal?.error("Link: enter a web address, or leave it empty.");
      return;
    }
    const item: Announcement = {
      id: newAnnouncementId(),
      title: headline,
      body: textInput.value.trim(),
      url: link || null,
      date: new Date().toISOString(),
    };
    void save([item, ...list], () => {
      titleInput.value = "";
      textInput.value = "";
      linkInput.value = "";
    });
  };

  const row = (a: Announcement): HTMLElement => {
    const del = h("button", { cls: "btn small danger", text: "Delete", attrs: { type: "button" } });
    del.addEventListener("click", () => void save(list.filter((x) => x.id !== a.id)));
    return h(
      "div",
      { cls: "news-admin-row" },
      h(
        "div",
        { cls: "news-admin-text" },
        h("span", { cls: "news-admin-title", text: a.title }),
        h("span", { cls: "news-admin-date", text: shortDate(a.date) }),
      ),
      del,
    );
  };

  const renderList = (): void => {
    listHost.replaceChildren(...(list.length === 0 ? [h("p", { cls: "news-admin-empty", text: "No announcements yet." })] : list.map(row)));
  };

  renderList();
  modal = openModal({
    title: "Announcements",
    cls: "admin-dialog",
    body: [
      h("p", { cls: "acct-section", text: "Posted" }),
      listHost,
      h("p", { cls: "acct-section", text: "New announcement" }),
      field("Title", titleInput),
      field("Text", textInput),
      field("Link (optional)", linkInput),
    ],
    actions: [footButton("Close", false, () => modal?.close()), postButton],
  });
}

/** A new id for an announcement. */
function newAnnouncementId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
