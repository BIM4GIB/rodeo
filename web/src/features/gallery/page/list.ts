// The gallery's listing: what it is for, tag chips, the sort, and a grid of cards that loads more as
// asked; search results and one author's drawings use it too. Admins get a Reported chip listing
// what is reported or hidden.

import { h } from "../../../app/dom.ts";
import { errorMessage } from "../../../app/toast.ts";
import { currentUser } from "../../../platform/api.ts";
import type { User } from "../../../platform/protocol.ts";
import { galleryApi } from "../api.ts";
import { LIMITS, SORTS, SUGGESTED_TAGS, isSort, licenceOf, normalizeTag } from "../rules.ts";
import type { GalleryCard, GallerySort, ModerationItem } from "../rules.ts";
import { button, forkIcon, navigate } from "./main.ts";

/** Most tags past the suggested ones that the chips offer. */
const EXTRA_TAGS = 8;

/** The listing's own state, read from the address. */
interface View {
  readonly q: string;
  readonly tag: string | null;
  readonly author: string | null;
  readonly featured: boolean;
  readonly reported: boolean;
  readonly sort: GallerySort;
}

/** The first letter of a title, for a tile with no cover yet. */
function initialOf(title: string): string {
  return Array.from(title.trim())[0]?.toUpperCase() ?? "R";
}

/** A drawing's picture: its cover, or the title's first letter on a plain tile until there is one. */
export function coverOf(c: { readonly title: string; readonly coverUrl: string | null }): HTMLElement {
  if (c.coverUrl) {
    return h("img", { attrs: { src: c.coverUrl, alt: "", loading: "lazy", decoding: "async", width: "1200", height: "630" } });
  }
  return h("div", { cls: "gal-placeholder", text: initialOf(c.title), attrs: { "aria-hidden": "true" } });
}

/** A listing address with `patch` applied (null or "" takes a parameter out); the page and the default sort are left out. */
function listUrl(base: URLSearchParams, patch: Record<string, string | null>): string {
  const p = new URLSearchParams(base);
  p.delete("page");
  for (const [k, v] of Object.entries(patch)) {
    if (v) p.set(k, v);
    else p.delete(k);
  }
  if (p.get("sort") === "trending") p.delete("sort");
  const s = p.toString();
  return `/gallery${s ? `?${s}` : ""}`;
}

/** One card: the cover, title, credit, licence and forks; a link to its page. */
export function card(c: GalleryCard, badge?: string): HTMLElement {
  const licence = licenceOf(c.licence);
  const credit = c.official
    ? h("p", { cls: "gal-credit" }, h("img", { cls: "gal-mark", attrs: { src: "/icon.svg", alt: "" } }), "Rodeo")
    : h("p", { cls: "gal-credit", text: `by ${c.creditName}` });
  const forks =
    c.forks > 0
      ? h("span", { cls: "gal-forks", title: `${c.forks} ${c.forks === 1 ? "fork" : "forks"}` }, forkIcon(), String(c.forks))
      : null;
  return h(
    "a",
    { cls: "gal-card", attrs: { href: c.path, "data-nav": "" } },
    h("div", { cls: "gal-cover" }, coverOf(c), badge ? h("span", { cls: "gal-badge", text: badge }) : null),
    h(
      "div",
      { cls: "gal-card-body" },
      h("h3", { text: c.title, attrs: { translate: "no" } }),
      credit,
      h(
        "p",
        { cls: "gal-card-meta" },
        h("span", { cls: "gal-licence", text: licence?.short ?? c.licence, title: licence?.name ?? c.licence }),
        forks,
        c.featured ? h("span", { cls: "gal-picked", text: "Picked" }) : null,
      ),
      c.forkedFrom ? h("p", { cls: "gal-forkof", text: `Fork of ${c.forkedFrom.title}` }) : null,
    ),
  );
}

/** The badge a reported drawing carries in the admins' view: hidden wins over a count. */
function badgeOf(item: ModerationItem): string {
  if (item.entry.state === "hidden") return "Hidden";
  const n = item.reports.length;
  return `${n} ${n === 1 ? "report" : "reports"}`;
}

/** The chips: the filters a reader can switch to, with the current one marked. */
function chipsFor(view: View, me: User | null, extra: readonly string[]): { label: string; href: string; on: boolean }[] {
  const sortOnly = new URLSearchParams();
  if (view.sort !== "trending") sortOnly.set("sort", view.sort);
  const href = (patch: Record<string, string | null>): string => listUrl(sortOnly, patch);
  const filtered = Boolean(view.q || view.tag || view.author || view.featured || view.reported);
  const chips = [
    { label: "All", href: href({}), on: !filtered },
    { label: "Picked by Rodeo", href: href({ featured: "1" }), on: view.featured },
    ...SUGGESTED_TAGS.map((t) => ({ label: t.label, href: href({ tag: t.tag }), on: view.tag === t.tag })),
    ...extra.map((t) => ({ label: `#${t}`, href: href({ tag: t }), on: view.tag === t })),
  ];
  if (me) chips.push({ label: "Yours", href: href({ author: me.id }), on: view.author === me.id });
  if (me?.admin) chips.push({ label: "Reported", href: href({ view: "reported" }), on: view.reported });
  return chips;
}

/** The page of drawings: its heading and chips, the sort and the grid, with more loaded on request. */
export function showList(main: HTMLElement, params: URLSearchParams): void {
  const me = currentUser();
  const sortParam = params.get("sort");
  const view: View = {
    q: (params.get("q") ?? "").trim().slice(0, LIMITS.query),
    tag: normalizeTag(params.get("tag") ?? "") || null,
    author: (params.get("author") ?? "").trim() || null,
    featured: params.get("featured") === "1",
    reported: params.get("view") === "reported" && me?.admin === true,
    sort: isSort(sortParam) ? sortParam : "trending",
  };
  const filtered = Boolean(view.q || view.tag || view.author || view.featured || view.reported);

  const heading = h("h1", { cls: "gal-h1", text: "Fork a building." });
  const lede = h("p", {
    cls: "gal-lede",
    text: "Open drawings of houses, furniture and student work. Look round them in 3D, download them, or fork one into your own drawings and make it yours.",
  });
  const note = h("p", { cls: "gal-note", text: "Publish yours from Rodeo: File › Share › Publish to Gallery…" });
  lede.hidden = filtered;
  note.hidden = filtered;
  const chips = h("nav", { cls: "gal-chips", attrs: { "aria-label": "Filter drawings" } });
  const sortSelect = h(
    "select",
    { cls: "gal-sort", attrs: { "aria-label": "Sort drawings" } },
    ...SORTS.map((s) => h("option", { text: s.label, value: s.id })),
  );
  sortSelect.value = view.sort;
  sortSelect.addEventListener("change", () => navigate(listUrl(new URLSearchParams(location.search), { sort: sortSelect.value })));
  const grid = h("div", { cls: "gal-grid" });
  const status = h("p", { cls: "gal-status", attrs: { role: "status" }, hidden: true });
  let nextPage = 1;
  let busy = false;
  const more = button("Load more", "plain", () => void fetchPage(nextPage));
  more.hidden = true;
  const moreRow = h("div", { cls: "gal-more" }, more);
  const listing = h(
    "section",
    { cls: "gal-listing" },
    heading,
    lede,
    note,
    chips,
    h("div", { cls: "gal-bar" }, sortSelect),
    grid,
    status,
    moreRow,
  );
  main.replaceChildren(listing);

  const say = (text: string): void => {
    status.textContent = text;
    status.hidden = text === "";
  };
  const retry = (err: unknown, again: () => void): void => {
    status.hidden = false;
    status.replaceChildren(h("span", { text: `Could not load the gallery: ${errorMessage(err)}` }), button("Try Again", "plain", again));
  };
  const emptyText = (): string => {
    if (view.reported) return "Nothing is reported or hidden.";
    if (view.q) return `No drawings match “${view.q}”.`;
    if (!filtered) return "Nothing here yet. Be the first: open a cloud drawing in Rodeo and choose File › Share › Publish to Gallery…";
    return "No drawings here yet.";
  };
  const setHeading = (): void => {
    if (view.reported) heading.textContent = "Reported and hidden";
    else if (view.q) heading.textContent = `Results for “${view.q}”`;
    else if (view.tag) heading.textContent = SUGGESTED_TAGS.find((t) => t.tag === view.tag)?.label ?? `#${view.tag}`;
    else if (view.featured) heading.textContent = "Picked by Rodeo";
    else if (view.author) heading.textContent = me && view.author === me.id ? "Your drawings" : "Drawings";
  };
  setHeading();

  const renderChips = (extra: readonly string[]): void => {
    chips.replaceChildren(
      ...chipsFor(view, me, extra).map((c) => {
        const a = h("a", { cls: c.on ? "gal-chip on" : "gal-chip", text: c.label, attrs: { href: c.href, "data-nav": "" } });
        if (c.on) a.setAttribute("aria-current", "page");
        return a;
      }),
    );
  };
  renderChips([]);

  // the chips' extra tags come in when the list of tags does; a failure just leaves them out
  void galleryApi
    .tags()
    .then((tags) => {
      if (!listing.isConnected) return;
      const suggested = new Set(SUGGESTED_TAGS.map((t) => t.tag));
      const extra = tags.map((t) => t.tag).filter((t) => !suggested.has(t)).slice(0, EXTRA_TAGS);
      if (view.tag && !suggested.has(view.tag) && !extra.includes(view.tag)) extra.unshift(view.tag);
      renderChips(extra);
    })
    .catch(() => undefined);

  const fetchPage = async (n: number): Promise<void> => {
    if (busy) return;
    busy = true;
    more.disabled = true;
    if (n === 1) grid.replaceChildren();
    say("Loading…");
    try {
      const res = await galleryApi.list({
        q: view.q,
        tag: view.tag ?? undefined,
        author: view.author ?? undefined,
        featured: view.featured,
        sort: view.sort,
        page: n,
      });
      if (!listing.isConnected) return;
      grid.append(...res.entries.map((c) => card(c)));
      if (n === 1 && view.author && res.entries[0]) {
        heading.textContent = me && view.author === me.id ? "Your drawings" : `Drawings by ${res.entries[0].creditName}`;
      }
      nextPage = n + 1;
      more.hidden = !res.hasMore;
      say(n === 1 && res.entries.length === 0 ? emptyText() : "");
    } catch (err) {
      if (!listing.isConnected) return;
      retry(err, () => void fetchPage(n));
    } finally {
      busy = false;
      more.disabled = false;
    }
  };

  // admins' view: what is reported or hidden, with no paging (the list is short by nature)
  const fetchReported = async (): Promise<void> => {
    more.hidden = true;
    say("Loading…");
    try {
      const items = await galleryApi.moderation();
      if (!listing.isConnected) return;
      grid.replaceChildren(...items.map((item) => card(item.entry, badgeOf(item))));
      say(items.length === 0 ? emptyText() : "");
    } catch (err) {
      if (!listing.isConnected) return;
      retry(err, () => void fetchReported());
    }
  };

  if (view.reported) void fetchReported();
  else void fetchPage(1);
}
