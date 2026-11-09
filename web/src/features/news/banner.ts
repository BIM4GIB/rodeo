// The editor's announcement bar: a card across the top of the window, under the top bar, for the
// newest announcement an admin posted with a bar (bannerUntil) that is still running and that this
// browser has not closed. Its × stores the id in localStorage, so it stays away. One bar a visit:
// the first config with a server behind it decides, so a later config brings no second bar and
// does not bring back one that was closed. With no server there is no bar.

import { h } from "../../app/dom.ts";
import type { Announcement } from "../../platform/protocol.ts";
import { config, onConfig } from "../account/config.ts";
import { isWebUrl } from "../account/format.ts";
import { openNewsPanel } from "./panel.ts";

const BARS_KEY = "openvwx.news.bars";

let decided = false;

onConfig(() => {
  const cfg = config();
  if (!cfg || decided) return;
  decided = true;
  const now = Date.now();
  const closed = closedBars();
  const pick = [...cfg.announcements]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .find((a) => a.bannerUntil && Date.parse(a.bannerUntil) > now && !closed.includes(a.id));
  if (pick) document.body.append(bar(pick));
});

/** The bar for an announcement: its title, the start of its text, "Read more" and the ×. */
function bar(a: Announcement): HTMLElement {
  const text = a.body.split("\n").map((line) => line.trim().replace(/^- /, "")).find(Boolean) ?? "";
  const close = h("button", { cls: "news-bar-close", text: "×", attrs: { type: "button", "aria-label": "Dismiss" } });
  const el = h(
    "div",
    { cls: "news-bar", attrs: { role: "region", "aria-label": "Announcement" } },
    h(
      "div",
      { cls: "news-bar-text" },
      h("strong", { cls: "news-bar-title", text: a.title }),
      text ? h("span", { cls: "news-bar-body", text }) : null,
    ),
    readMore(a),
    close,
  );
  close.addEventListener("click", () => {
    rememberClosed(a.id);
    el.remove();
  });
  return el;
}

/** A link to the announcement's page in a new tab, or (with none) the What's new list. */
function readMore(a: Announcement): HTMLElement {
  if (a.url && isWebUrl(a.url)) {
    return h("a", { cls: "news-bar-link", text: "Read more", attrs: { href: a.url, target: "_blank", rel: "noopener" } });
  }
  const button = h("button", { cls: "news-bar-link", text: "Read more", attrs: { type: "button" } });
  button.addEventListener("click", () => openNewsPanel());
  return button;
}

/** The ids of the bars this browser has closed. */
function closedBars(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(BARS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function rememberClosed(id: string): void {
  try {
    localStorage.setItem(BARS_KEY, JSON.stringify([...closedBars(), id]));
  } catch {
    // storage blocked: the bar comes back on the next visit
  }
}
