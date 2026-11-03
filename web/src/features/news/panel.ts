// What's new: every announcement and release, newest first (news.ts's list), each with its date,
// its drawing (banners.ts), its title and what changed, in a window whose list scrolls under a fixed title. It opens from
// the start hub's "What's new" link and from Help > What's New…, with or without a server, and marks the list seen.

import { h } from "../../app/dom.ts";
import { footButton, openModal, type Modal } from "../account/dialog.ts";
import { banner } from "./banners.ts";
import { bodyNodes, markNewsSeen, newsList, readMore, shortDate, type NewsItem } from "./news.ts";

export function openNewsPanel(): void {
  markNewsSeen();
  let modal: Modal | null = null;
  const log = h(
    "div",
    { cls: "news-log", attrs: { tabindex: "0", role: "region", "aria-label": "Releases and announcements" } },
    ...newsList().map(entry),
  );
  modal = openModal({
    title: "What's new",
    cls: "news-dialog",
    body: [h("p", { cls: "news-log-lede", text: "Every release and announcement, newest first." }), log],
    actions: [footButton("Close", true, () => modal?.close())],
  });
  // the list takes the keys, so the arrows and Page Down scroll it straight away
  log.focus({ preventScroll: true });
}

function entry(a: NewsItem): HTMLElement {
  return h(
    "article",
    { cls: "news-entry" },
    h("time", { cls: "news-entry-date", text: shortDate(a.date), attrs: { datetime: a.date } }),
    h("div", { cls: "news-entry-text" }, banner(a.art), h("h3", { cls: "news-entry-title", text: a.title }), ...bodyNodes(a.body), readMore(a)),
  );
}
