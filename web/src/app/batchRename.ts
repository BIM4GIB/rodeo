// Tools > Utilities > Batch Rename…: renames many classes, design layers, sheet layers, stories or
// resources at once, as Vectorworks' Batch Rename does. Find and replace, a change of case, a
// prefix and suffix and a running number apply to every ticked row the list shows, previewed as
// they are typed; a new name that is empty or already used is marked and stops OK. The rows that
// change are renamed together on OK, as one undo step.

import type { Rename, ResourceKind } from "../core/index.ts";
import "./batchRename.css";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { KIND_LABEL } from "./panels/resources.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

type TabId = "classes" | "design" | "sheet" | "stories" | "resources";
type CaseTo = "same" | "upper" | "lower" | "title";
type NumberAt = "none" | "before" | "after" | "instead";

const TABS: readonly { readonly id: TabId; readonly label: string; readonly one: string; readonly many: string }[] = [
  { id: "classes", label: "Classes", one: "class", many: "classes" },
  { id: "design", label: "Design Layers", one: "design layer", many: "design layers" },
  { id: "sheet", label: "Sheet Layers", one: "sheet layer", many: "sheet layers" },
  { id: "stories", label: "Stories", one: "story", many: "stories" },
  { id: "resources", label: "Resources", one: "resource", many: "resources" },
];
/** the class that cannot be renamed */
const NONE_CLASS = "None";

interface Item {
  /** name index, or a layer's id */
  readonly key: number | string;
  readonly name: string;
  /** a sheet layer's title */
  readonly title: string;
  readonly kind?: ResourceKind;
}

export interface RenameRules {
  find: string;
  replace: string;
  matchCase: boolean;
  caseTo: CaseTo;
  prefix: string;
  suffix: string;
  number: NumberAt;
  /** the first number, as typed: "001" counts 001, 002, … */
  start: string;
  step: number;
  /** between the number and the name */
  separator: string;
}

/** The name the rules make of `name`, the `i`th renamed row (from 0). */
export function renamed(name: string, i: number, r: RenameRules): string {
  let s = name;
  if (r.find) {
    const pattern = new RegExp(r.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), r.matchCase ? "g" : "gi");
    s = s.replace(pattern, () => r.replace);
  }
  if (r.caseTo === "upper") s = s.toUpperCase();
  else if (r.caseTo === "lower") s = s.toLowerCase();
  else if (r.caseTo === "title") s = s.toLowerCase().replace(/(^|[^\p{L}\p{N}'])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
  if (r.number !== "none") {
    const n = numberText(r.start, r.step, i);
    s = r.number === "instead" ? n : r.number === "before" ? n + r.separator + s : s + r.separator + n;
  }
  return r.prefix + s + r.suffix;
}

/** The `i`th number counting from `start` by `step`, as wide as `start` was typed. */
function numberText(start: string, step: number, i: number): string {
  const typed = start.trim();
  const first = /^-?\d+$/.test(typed) ? Number(typed) : 1;
  const n = first + i * (Number.isFinite(step) ? Math.trunc(step) : 1);
  const digits = String(Math.abs(n)).padStart(typed.replace(/^-/, "").length, "0");
  return n < 0 ? `-${digits}` : digits;
}

/** Asks for the rules and the rows, then renames the ticked rows that change. */
export async function batchRenameDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = session.doc;
  const layers = doc.layers();
  const stories = doc.stories();
  // a plug-in's parameters are named after it: only data record formats rename
  const dataFormats = new Set(doc.recordFormats().map((f) => f.format));
  const items: Record<TabId, Item[]> = {
    classes: doc.classes().filter((c) => c.name !== NONE_CLASS).map((c) => ({ key: c.index, name: c.name, title: "" })),
    design: layers.filter((l) => l.kind === "design").map((l) => ({ key: l.id, name: l.name, title: "" })),
    sheet: layers.filter((l) => l.kind === "sheet").map((l) => ({ key: l.id, name: l.name, title: l.title })),
    stories: stories.map((s) => ({ key: s.index, name: s.name, title: "" })),
    resources: doc
      .resources()
      .filter((r) => r.kind !== "record-format" || dataFormats.has(r.index))
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
      .map((r) => ({ key: r.index, name: r.name, title: "", kind: r.kind })),
  };
  // every name the drawing's classes, layers, stories and resources hold (names are shared by all)
  const used = [NONE_CLASS, ...Object.values(items).flatMap((list) => list.map((it) => it.name))];

  let tab: TabId = "classes";
  const unticked = new Set<string>();
  const tickKey = (it: Item): string => `${tab}:${it.key}`;

  const tabButtons = TABS.map((t) => {
    const btn = h("button", { cls: "seg-btn", text: t.label, attrs: { type: "button", role: "tab" } });
    btn.hidden = items[t.id].length === 0;
    btn.addEventListener("click", () => {
      tab = t.id;
      render();
    });
    return btn;
  });
  const search = h("input", {
    cls: "menu-dialog-input org-search",
    placeholder: "Search",
    attrs: { type: "search", "aria-label": "Search the list", autocomplete: "off", spellcheck: "false" },
  });
  const text = (label: string, value = ""): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input br-input", value, attrs: { type: "text", "aria-label": label, autocomplete: "off", spellcheck: "false" } });
  const select = (label: string, options: readonly (readonly [string, string])[]): HTMLSelectElement =>
    h("select", { cls: "menu-dialog-input menu-dialog-select br-input", attrs: { "aria-label": label } }, ...options.map(([value, text]) => h("option", { value, text })));
  const field = (label: string, input: HTMLElement): HTMLElement => h("label", { cls: "br-field" }, h("span", { cls: "br-label", text: label }), input);

  const target = select("Rename", [
    ["name", "Sheet number"],
    ["title", "Sheet title"],
  ]);
  const kindFilter = select("Kind", [
    ["", "All kinds"],
    ...[...new Set(items.resources.map((r) => r.kind!))].map((k) => [k, KIND_LABEL[k]] as const),
  ]);
  const find = text("Find");
  const replace = text("Replace with");
  const matchCase = h("input", { attrs: { type: "checkbox", "aria-label": "Match case" } });
  const prefix = text("Prefix");
  const suffix = text("Suffix");
  const caseTo = select("Case", [
    ["same", "Unchanged"],
    ["upper", "UPPERCASE"],
    ["lower", "lowercase"],
    ["title", "Title Case"],
  ]);
  const number = select("Number", [
    ["none", "None"],
    ["before", "Before the name"],
    ["after", "After the name"],
    ["instead", "Instead of the name"],
  ]);
  const start = text("Start at", "1");
  const step = h("input", { cls: "menu-dialog-input br-input br-num", value: "1", attrs: { type: "number", step: "1", "aria-label": "Step" } });
  const separator = text("Separator", " ");
  const scope = h("div", { cls: "br-scope" }, field("Rename", target), field("Kind", kindFilter));
  const numberFields = [field("Start at", start), field("Step", step), field("Separator", separator)];

  const table = h("div", { cls: "org-table br-table", attrs: { role: "table" } });
  const note = h("p", { cls: "muted br-note" });

  const rules = (): RenameRules => ({
    find: find.value,
    replace: replace.value,
    matchCase: matchCase.checked,
    caseTo: caseTo.value as CaseTo,
    prefix: prefix.value,
    suffix: suffix.value,
    number: number.value as NumberAt,
    start: start.value,
    step: Number(step.value),
    separator: separator.value,
  });
  const renamingTitles = (): boolean => tab === "sheet" && target.value === "title";

  /** the rows the list shows, each with its new name (null when untouched) and why that can't be */
  function plan(): { it: Item; ticked: boolean; next: string | null; problem: string }[] {
    const q = search.value.trim().toLowerCase();
    const shown = items[tab].filter(
      (it) =>
        (!q || it.name.toLowerCase().includes(q) || it.title.toLowerCase().includes(q)) &&
        (tab !== "resources" || !kindFilter.value || it.kind === kindFilter.value),
    );
    const r = rules();
    const titles = renamingTitles();
    let i = 0;
    const rows = shown.map((it) => {
      const ticked = !unticked.has(tickKey(it));
      const was = titles ? it.title : it.name;
      const next = ticked ? renamed(was, i++, r) : null;
      return { it, ticked, next: next === was ? null : next, problem: "" };
    });
    if (titles) return rows;
    // a name is used once: count each as it would be after the renames
    const gone = new Map<string, number>();
    for (const row of rows) if (row.next !== null) gone.set(row.it.name, (gone.get(row.it.name) ?? 0) + 1);
    const count = new Map<string, number>();
    for (const n of used) count.set(n, (count.get(n) ?? 0) + 1);
    for (const [n, k] of gone) count.set(n, count.get(n)! - k);
    for (const row of rows) if (row.next !== null) count.set(row.next, (count.get(row.next) ?? 0) + 1);
    for (const row of rows) {
      if (row.next === null) continue;
      if (!row.next.trim()) row.problem = "A name can't be empty.";
      else if (count.get(row.next)! > 1) row.problem = `“${row.next}” is used more than once.`;
    }
    return rows;
  }

  function render(focusKey?: string): void {
    const def = TABS.find((t) => t.id === tab)!;
    tabButtons.forEach((b, i) => {
      const on = TABS[i].id === tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", String(on));
    });
    scope.hidden = tab !== "sheet" && tab !== "resources";
    target.parentElement!.hidden = tab !== "sheet";
    kindFilter.parentElement!.hidden = tab !== "resources";
    for (const f of numberFields) f.hidden = number.value === "none";
    separator.parentElement!.hidden = number.value === "none" || number.value === "instead";

    const rows = plan();
    const all = h("input", { attrs: { type: "checkbox", "aria-label": "Tick every listed row" } });
    all.checked = rows.length > 0 && rows.every((r) => r.ticked);
    all.indeterminate = !all.checked && rows.some((r) => r.ticked);
    all.addEventListener("change", () => {
      for (const r of rows) {
        if (all.checked) unticked.delete(tickKey(r.it));
        else unticked.add(tickKey(r.it));
      }
      render("all");
    });
    const label = renamingTitles() ? "title" : tab === "sheet" ? "number" : "name";
    table.replaceChildren(
      h(
        "div",
        { cls: "org-row org-head", attrs: { role: "row" } },
        h("label", { cls: "org-check" }, all),
        h("span", { text: `Current ${label}` }),
        h("span", { text: `New ${label}` }),
      ),
      ...rows.map((r) => {
        const box = h("input", { attrs: { type: "checkbox", "aria-label": `Rename ${r.it.name}` } });
        box.checked = r.ticked;
        box.addEventListener("change", () => {
          if (box.checked) unticked.delete(tickKey(r.it));
          else unticked.add(tickKey(r.it));
          render(tickKey(r.it));
        });
        const was = renamingTitles() ? r.it.title : r.it.name;
        const shown = r.next ?? was;
        const kind = r.it.kind ? ` (${KIND_LABEL[r.it.kind]})` : "";
        const el = h(
          "div",
          { cls: "org-row", attrs: { role: "row", "data-key": tickKey(r.it) } },
          h("label", { cls: "org-check" }, box),
          h("span", { cls: "org-text", text: was, title: was + kind }),
          h("span", {
            cls: `org-text br-new${r.next !== null ? " changed" : ""}${r.problem ? " bad" : ""}`,
            text: shown || "(empty)",
            title: r.problem || shown,
          }),
        );
        return el;
      }),
    );
    if (focusKey === "all") all.focus();
    else if (focusKey) table.querySelector<HTMLInputElement>(`[data-key="${CSS.escape(focusKey)}"] input`)?.focus();

    const changing = rows.filter((r) => r.next !== null).length;
    const bad = rows.filter((r) => r.problem).length;
    note.textContent = bad
      ? `${bad} of the new ${bad === 1 ? "name is" : "names are"} empty or already used.`
      : changing
        ? `${changing} of ${rows.length} ${rows.length === 1 ? def.one : def.many} will be renamed.`
        : rows.length
          ? `Nothing changes yet: type a rule above.`
          : `No ${def.many} match the search.`;
    note.classList.toggle("br-bad", bad > 0);
  }

  for (const el of [search, find, replace, prefix, suffix, start, step, separator]) el.addEventListener("input", () => render());
  for (const el of [matchCase, caseTo, number, target, kindFilter]) el.addEventListener("change", () => render());
  render();

  const done = await showDialog<{ n: number; tab: TabId }>({
    title: "Batch Rename",
    okLabel: "Rename",
    cls: "br-dialog",
    body: [
      h("div", { cls: "org-top" }, h("div", { cls: "seg org-tabs", attrs: { role: "tablist" } }, ...tabButtons), search),
      scope,
      h(
        "div",
        { cls: "br-rules" },
        field("Find", find),
        field("Replace with", replace),
        field("Prefix", prefix),
        field("Suffix", suffix),
        field("Case", caseTo),
        h("label", { cls: "br-field br-check" }, matchCase, h("span", { text: "Match case" })),
        field("Number", number),
        ...numberFields,
      ),
      table,
      note,
    ],
    check: () => {
      const rows = plan().filter((r) => r.next !== null);
      const bad = rows.find((r) => r.problem);
      if (bad) return { error: bad.problem };
      if (!rows.length) return { value: { n: 0, tab } };
      const titles = renamingTitles();
      const renames: Rename[] = rows.map((r) =>
        typeof r.it.key === "string"
          ? titles
            ? { kind: "layer", id: r.it.key, name: r.it.name, title: r.next! }
            : { kind: "layer", id: r.it.key, name: r.next! }
          : { kind: tab === "classes" ? "class" : tab === "stories" ? "story" : "resource", index: r.it.key, name: r.next! },
      );
      try {
        session.renameMany(renames);
      } catch (err) {
        return { error: errorMessage(err) };
      }
      return { value: { n: rows.length, tab } };
    },
  });
  if (!done?.n) return;
  const t = TABS.find((x) => x.id === done.tab)!;
  toast(`Renamed ${done.n} ${done.n === 1 ? t.one : t.many}.`, "info");
}
