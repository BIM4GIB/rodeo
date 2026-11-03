// The start hub's "What's new" link, in its footer, over the news: the announcements an admin has
// posted (Help > Announcements…) and the release log that ships with the editor (releases.ts). It
// opens the whole list (panel.ts), and a dot marks an item posted since the list was last opened
// in this browser (on a first visit, one from the last two weeks). The newest date seen is kept
// in localStorage.

import { h } from "../../app/dom.ts";
import type { Announcement } from "../../platform/protocol.ts";
import { config, onConfig } from "../account/config.ts";
import { isWebUrl } from "../account/format.ts";
import type { Art } from "./banners.ts";
import { RELEASES } from "./releases.ts";

const SEEN_KEY = "openvwx.news.seen";

/** An announcement or a release; a release names the drawing at its head (banners.ts). */
export type NewsItem = Announcement & { readonly art?: Art };

/** The server's announcements and the release log, newest first; a posted item replaces a release with its id. */
export function newsList(): NewsItem[] {
  const posted = config()?.announcements ?? [];
  const ids = new Set(posted.map((a) => a.id));
  return [...posted, ...RELEASES.filter((r) => !ids.has(r.id))].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

/** The footer link; `seeAll` opens the whole list (and marks it seen). */
export function newsLink(seeAll: () => void): HTMLElement {
  const dot = h("span", { cls: "news-dot", hidden: true, attrs: { title: "Something new since you last looked" } });
  const link = h("button", { cls: "hub-link", hidden: true, attrs: { type: "button" } }, "What's new", dot);
  const paint = (): void => {
    const newest = newsList()[0]?.date ?? null;
    link.hidden = newest === null;
    dot.hidden = newest === null || !isFresh(Date.parse(newest), readSeen());
  };
  link.addEventListener("click", () => {
    seeAll();
    paint();
  });
  onConfig(paint);
  return link;
}

/** Notes the newest item as seen, so the link's dot goes until a newer one is posted. */
export function markNewsSeen(): void {
  const newest = newsList()[0]?.date;
  if (newest) writeSeen(newest);
}

/** An ISO time as a short day: "3 Mar 2027". */
export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** An item's text as paragraphs, its runs of "- " lines as bulleted lists. */
export function bodyNodes(body: string): HTMLElement[] {
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

/** An item's "Read more" link, or null when it has none. */
export function readMore(a: Announcement): HTMLElement | null {
  if (!a.url || !isWebUrl(a.url)) return null;
  return h("a", { cls: "news-link", text: "Read more", attrs: { href: a.url, target: "_blank", rel: "noopener" } });
}

/** on a first visit, items posted this recently count as new */
const FRESH_MS = 14 * 24 * 60 * 60 * 1000;

/** Whether an item posted at `posted` (ms) is new, given the newest date seen (ms, or null for none). */
function isFresh(posted: number, seen: number | null): boolean {
  return seen === null ? Date.now() - posted < FRESH_MS : posted > seen;
}

/** The newest announcement date this browser has shown (ms), or null. */
function readSeen(): number | null {
  try {
    const t = Date.parse(localStorage.getItem(SEEN_KEY) ?? "");
    return Number.isNaN(t) ? null : t;
  } catch {
    return null;
  }
}

function writeSeen(iso: string): void {
  try {
    localStorage.setItem(SEEN_KEY, iso);
  } catch {
    // storage blocked: the badges come back on the next visit
  }
}
