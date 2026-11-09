// The admin page's building blocks, shared by its tabs: sections, number tiles, cards, and what a
// tab shows while it loads, when it fails, and when there is nothing to show. Their styles are
// in admin.css.

import { h } from "../app/dom.ts";
import { errorMessage } from "../app/toast.ts";
import { change } from "./format.ts";

/** A titled part of a tab, with an optional line under the title. */
export function section(title: string, note: string | null, ...children: (Node | null)[]): HTMLElement {
  return h(
    "section",
    { cls: "adm-section" },
    h("h2", { cls: "adm-section-title", text: title }),
    note ? h("p", { cls: "adm-section-note", text: note }) : null,
    ...children,
  );
}

export interface TileSpec {
  readonly label: string;
  readonly value: string;
  /** what it is, under the value */
  readonly note?: string;
  /** the change on the period before; `good` says whether up is good */
  readonly delta?: { readonly now: number; readonly before: number; readonly good?: "up" | "down" };
  readonly hero?: boolean;
}

/** A number in a box; `period` names the period before for the change ("week", "30 days"). */
export function tile(t: TileSpec, period = ""): HTMLElement {
  const d = t.delta ? change(t.delta.now, t.delta.before) : null;
  const good = t.delta?.good ?? "up";
  const tone = d === null || d.text.startsWith("±") ? "flat" : d.up === (good === "up") ? "good" : "bad";
  return h(
    "div",
    { cls: t.hero ? "adm-tile hero" : "adm-tile" },
    h("span", { cls: "adm-tile-label", text: t.label }),
    h("span", { cls: "adm-tile-value", text: t.value }),
    d ? h("span", { cls: `adm-delta ${tone}`, text: `${d.up ? "▲" : "▼"} ${d.text} on the ${period} before` }) : null,
    t.note ? h("span", { cls: "adm-tile-note", text: t.note }) : null,
  );
}

/** A row of tiles. */
export function tiles(...items: HTMLElement[]): HTMLElement {
  return h("div", { cls: "adm-tiles" }, ...items);
}

/** A card with a title, for forms and lists. */
export function card(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", { cls: "adm-card" }, h("h3", { cls: "adm-card-title", text: title }), ...children);
}

/** "week", "30 days", "year": the period's name for "on the … before". */
export function periodName(days: number): string {
  return days === 1 ? "day" : days === 7 ? "week" : days === 365 ? "year" : `${days} days`;
}

export function loadingView(): HTMLElement {
  return h("p", { cls: "adm-empty", text: "Loading…" });
}

export function errorView(err: unknown): HTMLElement {
  return h("p", { cls: "adm-error", text: errorMessage(err) });
}

export function emptyView(text: string): HTMLElement {
  return h("p", { cls: "adm-empty", text });
}

/**
 * A tab's body that fetches its data, shows Loading… meanwhile and the error if it fails, then
 * `render`s it. With `refresh` (ms), it fetches again that often while shown, keeping what is shown
 * (and the page's scroll) until the new data is in. Stops when `signal` is aborted.
 */
export function loaded<T>(
  signal: AbortSignal,
  fetch: () => Promise<T>,
  render: (data: T) => Node,
  opts: { readonly refresh?: number; readonly onLoad?: () => void } = {},
): HTMLElement {
  const box = h("div", { cls: "adm-loaded" }, loadingView());
  let first = true;
  const load = async (): Promise<void> => {
    try {
      const data = await fetch();
      if (signal.aborted) return;
      const y = window.scrollY;
      box.replaceChildren(render(data));
      if (!first) window.scrollTo(0, y);
      first = false;
      opts.onLoad?.();
    } catch (err) {
      if (signal.aborted) return;
      if (first) box.replaceChildren(errorView(err));
    }
  };
  void load();
  if (opts.refresh) {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, opts.refresh);
    signal.addEventListener("abort", () => clearInterval(timer));
  }
  return box;
}
