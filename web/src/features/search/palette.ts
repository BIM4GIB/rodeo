// Search Everything: a centred command palette over the editor, and Vectorworks' Quick
// Search. One box searches menu commands, tools, Quick Preferences, palettes, layers,
// classes, saved views, symbol definitions and objects (by name, kind, class, layer and
// text). A Quick Preference is a check box, turned on or off in place, the palette
// staying open. With the box empty it lists the recent picks first. ↑/↓ move, Enter runs, ⌘Enter (Ctrl elsewhere) runs Find Usages
// for a symbol or a class, Esc closes. Typing = as the first character switches to
// the Query Bar.

import { h } from "../../app/dom.ts";
import { appContext, type AppContext } from "../../app/ext.ts";
import { IS_MAC } from "../../app/menu.ts";
import { store } from "../../app/state.ts";
import { namesOf } from "./describe.ts";
import { openQuery } from "./queryBar.ts";
import { loadRecent, rememberRecent } from "./recent.ts";
import { BROWSE_GROUPS, GROUP_ORDER, objectItem, objectSearch, scoreItem, staticItems, type GroupName, type Item, type Scored } from "./items.ts";
import { SEARCH_ICON } from "./glyphs.ts";
import { showUsages } from "./usagesDialog.ts";

/** How many objects a query lists at most. */
const OBJECT_LIMIT = 200;
/** How many rows the list shows at most. */
const ROW_LIMIT = 600;
/** Rows a PageUp or PageDown moves over. */
const PAGE = 8;

interface Section {
  readonly title: GroupName;
  readonly hits: readonly Scored[];
}

interface Session {
  readonly ctx: AppContext;
  readonly root: HTMLElement;
  readonly input: HTMLInputElement;
  readonly list: HTMLElement;
  /** every item but objects, built when the palette opens */
  readonly statics: readonly Item[];
  /** the rows on screen, in order, and their elements */
  rows: Scored[];
  els: HTMLElement[];
  active: number;
}

let session: Session | null = null;

/** Opens Search Everything (with `initial` in the box), or brings the open one to the front. */
export function openSearch(initial = ""): void {
  if (session) {
    session.input.focus();
    return;
  }
  const ctx = appContext();
  if (!ctx) return;
  const input = h("input", {
    cls: "sx-input",
    attrs: {
      type: "text",
      spellcheck: "false",
      autocomplete: "off",
      role: "combobox",
      "aria-expanded": "true",
      "aria-label": "Search everything",
      placeholder: "Search commands, tools, preferences, layers, classes, symbols and objects",
    },
  });
  const list = h("div", { cls: "sx-list", attrs: { role: "listbox", "aria-label": "Results" } });
  const cmd = IS_MAC ? "⌘" : "Ctrl+";
  const foot = h(
    "div",
    { cls: "sx-foot" },
    hint("↑↓", "move"),
    hint("↵", "run"),
    hint(`${cmd}↵`, "find usages"),
    hint("=", "query"),
    hint("esc", "close"),
  );
  const root = h(
    "div",
    { cls: "sx-backdrop" },
    h(
      "div",
      { cls: "sx-palette", attrs: { role: "dialog", "aria-label": "Search Everything" } },
      h("div", { cls: "sx-input-row" }, h("span", { cls: "sx-search-icon", html: SEARCH_ICON }), input),
      list,
      foot,
    ),
  );
  document.body.append(root);
  session = { ctx, root, input, list, statics: staticItems(ctx), rows: [], els: [], active: 0 };

  root.addEventListener("pointerdown", (e) => {
    if (e.target === root) close();
  });
  input.addEventListener("keydown", onKey);
  input.addEventListener("input", onInput);
  input.value = initial;
  render();
  input.focus();
}

function hint(keys: string, label: string): HTMLElement {
  return h("span", { cls: "sx-hint" }, h("kbd", { text: keys }), h("span", { text: label }));
}

function close(): void {
  if (!session) return;
  session.root.remove();
  session = null;
}

function onInput(): void {
  const s = session;
  if (!s) return;
  // a query starts with =: the Query Bar takes what follows it
  if (s.input.value.startsWith("=")) {
    const rest = s.input.value.slice(1);
    close();
    openQuery(rest);
    return;
  }
  s.active = 0;
  render();
}

function onKey(e: KeyboardEvent): void {
  const s = session;
  if (!s) return;
  switch (e.key) {
    case "ArrowDown":
      e.preventDefault();
      move(1);
      return;
    case "ArrowUp":
      e.preventDefault();
      move(-1);
      return;
    case "PageDown":
      e.preventDefault();
      move(PAGE);
      return;
    case "PageUp":
      e.preventDefault();
      move(-PAGE);
      return;
    case "Enter": {
      e.preventDefault();
      const row = s.rows[s.active];
      if (!row) return;
      if ((e.metaKey || e.ctrlKey) && row.item.usage) usage(row.item);
      else run(row.item);
      return;
    }
    case "Escape":
      e.preventDefault();
      close();
      return;
  }
}

function move(by: number): void {
  const s = session;
  if (!s || s.rows.length === 0) return;
  const n = s.rows.length;
  setActive((((s.active + by) % n) + n) % n, true);
}

function setActive(index: number, scroll: boolean): void {
  const s = session;
  if (!s) return;
  if (index === s.active && !scroll) return;
  s.els[s.active]?.classList.remove("active");
  s.els[s.active]?.setAttribute("aria-selected", "false");
  s.active = index;
  const el = s.els[index];
  if (el) {
    el.classList.add("active");
    el.setAttribute("aria-selected", "true");
    if (scroll) el.scrollIntoView({ block: "nearest" });
  }
  s.input.setAttribute("aria-activedescendant", el?.id ?? "");
}

/** Runs an item: the palette closes first, since the item may open a dialog or the Query Bar; a Quick Preference is set in place. */
function run(item: Item): void {
  const s = session;
  if (!s) return;
  rememberRecent(item.id);
  if (item.checked) {
    item.run();
    const el = s.els[s.rows.findIndex((r) => r.item === item)];
    const box = el?.querySelector<HTMLInputElement>(".sx-check");
    if (box) box.checked = item.checked();
    el?.setAttribute("aria-checked", String(item.checked()));
    s.input.focus();
    return;
  }
  close();
  item.run();
}

/** Find Usages for a symbol or class item: the palette closes, then the results open. */
function usage(item: Item): void {
  const s = session;
  if (!s || !item.usage) return;
  const ctx = s.ctx;
  const target = item.usage;
  close();
  void showUsages(ctx, target);
}

/** The sections the box shows: recent picks and the browsable groups when the box is empty, else every group's matches. */
function sectionsFor(s: Session, query: string): Section[] {
  const doc = store.session?.doc ?? null;
  if (query === "") {
    const byId = new Map(s.statics.map((item) => [item.id, item] as const));
    const names = doc ? namesOf(doc) : null;
    const recent: Scored[] = [];
    for (const id of loadRecent()) {
      let item: Item | undefined;
      if (id.startsWith("object:")) {
        const o = doc?.object(id.slice("object:".length)) ?? null;
        if (o && names) item = objectItem(s.ctx, names, o);
      } else {
        item = byId.get(id);
      }
      if (item) recent.push({ item, score: 0, ranges: [] });
    }
    const out: Section[] = [{ title: "Recent", hits: recent }];
    for (const title of GROUP_ORDER) {
      if (title === "Recent" || BROWSE_GROUPS.has(title)) continue;
      const hits = s.statics.filter((item) => item.group === title).map((item): Scored => ({ item, score: 0, ranges: [] }));
      out.push({ title, hits });
    }
    return out;
  }
  const byGroup = new Map<GroupName, Scored[]>();
  const add = (hit: Scored): void => {
    const list = byGroup.get(hit.item.group);
    if (list) list.push(hit);
    else byGroup.set(hit.item.group, [hit]);
  };
  for (const item of s.statics) {
    const hit = scoreItem(query, item);
    if (hit) add(hit);
  }
  if (doc) for (const hit of objectSearch(s.ctx, doc, query, OBJECT_LIMIT)) add(hit);
  return GROUP_ORDER.filter((title) => title !== "Recent").map((title) => ({
    title,
    hits: (byGroup.get(title) ?? []).sort((a, b) => b.score - a.score),
  }));
}

/** The label with the matched characters marked. */
function highlight(text: string, ranges: readonly (readonly [number, number])[]): (string | Node)[] {
  if (ranges.length === 0) return [text];
  const out: (string | Node)[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) out.push(text.slice(at, start));
    out.push(h("mark", { text: text.slice(start, end) }));
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function render(): void {
  const s = session;
  if (!s) return;
  const query = s.input.value.trim();
  const nodes: Node[] = [];
  const rows: Scored[] = [];
  const els: HTMLElement[] = [];
  for (const section of sectionsFor(s, query)) {
    if (section.hits.length === 0) continue;
    if (rows.length >= ROW_LIMIT) break;
    nodes.push(h("div", { cls: "sx-group", text: section.title, attrs: { role: "presentation" } }));
    for (const hit of section.hits) {
      if (rows.length >= ROW_LIMIT) break;
      const index = rows.length;
      rows.push(hit);
      const el = itemElement(hit, index);
      els.push(el);
      nodes.push(el);
    }
  }
  if (rows.length === 0) {
    nodes.push(
      h("div", {
        cls: "sx-empty",
        text: query === "" ? "Nothing to show yet. Type to search." : `Nothing matches "${query}".`,
      }),
    );
  }
  s.rows = rows;
  s.els = els;
  s.list.replaceChildren(...nodes);
  s.active = Math.min(s.active, Math.max(0, rows.length - 1));
  const current = els[s.active];
  if (current) {
    current.classList.add("active");
    current.setAttribute("aria-selected", "true");
  }
  s.input.setAttribute("aria-activedescendant", current?.id ?? "");
}

function itemElement(hit: Scored, index: number): HTMLElement {
  const { item } = hit;
  const el = h(
    "div",
    {
      cls: "sx-item",
      attrs: {
        role: "option",
        id: `sx-row-${index}`,
        "aria-selected": "false",
        "data-index": String(index),
        ...(item.checked ? { "aria-checked": String(item.checked()) } : {}),
      },
    },
    h("span", { cls: "sx-icon", html: item.icon }),
    h(
      "span",
      { cls: "sx-text" },
      h("span", { cls: "sx-label" }, ...highlight(item.label, hit.ranges)),
      item.detail ? h("span", { cls: "sx-detail", text: item.detail }) : null,
    ),
    item.keys ? h("kbd", { cls: "sx-keys", text: item.keys }) : null,
    item.checked ? h("input", { cls: "sx-check", checked: item.checked(), attrs: { type: "checkbox", tabindex: "-1", "aria-hidden": "true" } }) : null,
    item.usage ? h("span", { cls: "sx-usage-hint", text: `${IS_MAC ? "⌘" : "Ctrl+"}↵ usages` }) : null,
  );
  el.addEventListener("pointermove", () => {
    if (session && session.active !== index) setActive(index, false);
  });
  el.addEventListener("click", () => run(hit.item));
  return el;
}
