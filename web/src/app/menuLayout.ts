// Window > Workspaces > Menus…: Vectorworks' workspace editor for menus. Menus can be added,
// renamed, reordered and deleted, and commands or whole submenus moved between them, up and
// down in them, or taken out of the menus; a command taken out still runs from its shortcut.
// A command is named by its path in the menus as built ("Modify › Convert › Convert to
// Group"), so its shortcut and the drawing's context menu follow it wherever it goes, and a
// command moved out of a submenu leaves that submenu. Kept in this browser (localStorage) and
// with saved and exported workspaces.

import "./toolSetsDialog.css";
import { h } from "./dom.ts";
import { UI_ICON } from "./icons.ts";
import type { Item, Row } from "./menu.ts";
import { showDialog } from "./menubar.ts";

const STORAGE_KEY = "openvwx.menulayout.v1";
const SEP = " › ";
/** the submenu holding this editor, which has to stay in a menu */
const WORKSPACES = `Window${SEP}Workspaces`;

interface Menu {
  readonly title: string;
  readonly rows: readonly Row[];
}

export interface MenuConfig {
  /** the title of the menu it was built as, or a made-up id for a new one */
  id: string;
  title: string;
  /** command and submenu paths, "-" for a separator */
  rows: string[];
}

export interface MenuLayout {
  menus: MenuConfig[];
  /** commands taken out of the menus */
  hidden: string[];
}

/** A command or submenu in the menus as built. */
interface Entry {
  readonly item: Item;
  /** the menu, or menu and submenus, it was built in: "Modify › Convert" */
  readonly parent: string;
}

/** the menus as built, which the editor lists */
let built: readonly Menu[] = [];
let layout: MenuLayout | null = readMenuLayout(stored());

function stored(): unknown {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    return null;
  }
}

/** A kept or imported layout with anything malformed dropped; null for the defaults. */
export function readMenuLayout(raw: unknown): MenuLayout | null {
  if (!raw || typeof raw !== "object") return null;
  const { menus, hidden } = raw as { menus?: unknown; hidden?: unknown };
  if (!Array.isArray(menus)) return null;
  const ids = new Set<string>();
  const out: MenuConfig[] = [];
  for (const m of menus) {
    if (!m || typeof m !== "object") continue;
    const { id, title, rows } = m as Record<string, unknown>;
    if (typeof id !== "string" || ids.has(id) || typeof title !== "string" || !title.trim() || !Array.isArray(rows)) continue;
    ids.add(id);
    out.push({ id, title: title.trim(), rows: rows.filter((r): r is string => typeof r === "string") });
  }
  if (!out.length) return null;
  return { menus: out, hidden: Array.isArray(hidden) ? hidden.filter((p): p is string => typeof p === "string") : [] };
}

/** Every command and submenu in `menus` by path, submenus' own rows included; rows read when opened are not listed. */
function entriesOf(menus: readonly Menu[]): Map<string, Entry> {
  const out = new Map<string, Entry>();
  const walk = (parent: string, rows: readonly Row[]): void => {
    for (const row of rows) {
      if (row === "-") continue;
      const path = `${parent}${SEP}${row.label}`;
      out.set(path, { item: row, parent });
      if (row.items && typeof row.items !== "function") walk(path, row.items);
    }
  };
  for (const m of menus) walk(m.title, m.rows);
  return out;
}

function defaults(menus: readonly Menu[]): MenuLayout {
  return {
    menus: menus.map((m) => ({ id: m.title, title: m.title, rows: m.rows.map((r) => (r === "-" ? r : `${m.title}${SEP}${r.label}`)) })),
    hidden: [],
  };
}

/**
 * The layout as it applies to `menus`: paths no longer there and second placings dropped, and
 * commands added since it was made put at the end of the menu they were built in.
 */
function effective(menus: readonly Menu[], entries: Map<string, Entry>): MenuLayout {
  if (!layout) return defaults(menus);
  const placed = new Set<string>();
  const out: MenuConfig[] = layout.menus.map((m) => ({
    id: m.id,
    title: m.title,
    rows: m.rows.filter((p) => {
      if (p === "-") return true;
      if (!entries.has(p) || placed.has(p)) return false;
      placed.add(p);
      return true;
    }),
  }));
  const hidden = layout.hidden.filter((p) => entries.has(p) && !placed.has(p));
  for (const m of menus) {
    for (const r of m.rows) {
      const p = r === "-" ? null : `${m.title}${SEP}${r.label}`;
      if (p === null || placed.has(p) || hidden.includes(p)) continue;
      (out.find((x) => x.id === m.title) ?? out[out.length - 1]).rows.push(p);
      placed.add(p);
    }
  }
  return { menus: out, hidden };
}

/** Rows without separators at either end or two in a row. */
function tidy(rows: readonly Row[]): Row[] {
  const out: Row[] = [];
  for (const r of rows) if (r !== "-" || (out.length && out[out.length - 1] !== "-")) out.push(r);
  while (out[out.length - 1] === "-") out.pop();
  return out;
}

/** The menus as Menus… arranged them, from the menus as built (their shortcuts already set). */
export function arrangeMenus(menus: readonly Menu[]): Menu[] {
  if (!layout) return [...menus];
  const entries = entriesOf(menus);
  const { menus: arranged, hidden } = effective(menus, entries);
  const elsewhere = new Set([...hidden, ...arranged.flatMap((m) => m.rows)]);
  // a submenu keeps the rows not placed elsewhere or taken out; one left empty goes
  const take = (path: string, item: Item): Item | null => {
    if (!item.items || typeof item.items === "function") return item;
    const rows = tidy(
      item.items.flatMap((r): Row[] => {
        if (r === "-") return [r];
        const p = `${path}${SEP}${r.label}`;
        if (elsewhere.has(p)) return [];
        const kept = take(p, r);
        return kept ? [kept] : [];
      }),
    );
    return rows.length ? { ...item, items: rows } : null;
  };
  return arranged
    .map((m) => ({
      title: m.title,
      rows: tidy(
        m.rows.flatMap((p): Row[] => {
          if (p === "-") return [p];
          const kept = take(p, entries.get(p)!.item);
          return kept ? [kept] : [];
        }),
      ),
    }))
    .filter((m) => m.rows.length > 0);
}

/** Takes the menus as built, so the editor can list their commands. */
export function registerMenuLayout(menus: readonly Menu[]): void {
  built = menus;
}

/** The layout as changed, as workspaces keep it; null for the defaults. */
export function menuLayoutChanges(): MenuLayout | null {
  return layout;
}

/** Sets the layout (null for the defaults) and keeps it in this browser. */
export function setMenuLayout(next: MenuLayout | null): void {
  layout = next;
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage blocked: the layout lasts for this visit only
  }
}

function smallButton(text: string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const btn = h("button", { cls: "btn small ts-btn", text, title: label, attrs: { type: "button", "aria-label": label } });
  btn.disabled = disabled;
  btn.addEventListener("click", onClick);
  return btn;
}

function move<T>(list: T[], i: number, by: number): void {
  const j = i + by;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

/** A path without its menu: "Convert › Convert to Group". */
function inMenu(path: string): string {
  return path.split(SEP).slice(1).join(SEP);
}

/** Window > Workspaces > Menus…: each menu with its commands, in order. Nothing changes until OK. */
export async function menuLayoutDialog(): Promise<void> {
  const entries = entriesOf(built);
  const clone = (l: MenuLayout): MenuLayout => ({ menus: l.menus.map((m) => ({ ...m, rows: [...m.rows] })), hidden: [...l.hidden] });
  let draft = clone(effective(built, entries));
  const open = new Set<string>();
  const list = h("div", { cls: "ts-list" });
  let fresh = 0;

  /** Puts `path` at the end of `menu`, out of wherever it was. */
  const place = (menu: MenuConfig, path: string): void => {
    for (const m of draft.menus) m.rows = m.rows.filter((p) => p !== path);
    draft.hidden = draft.hidden.filter((p) => p !== path);
    menu.rows.push(path);
  };

  const render = (): void => {
    const where = new Map<string, string>();
    for (const m of draft.menus) for (const p of m.rows) if (p !== "-") where.set(p, m.title);
    list.replaceChildren(
      ...draft.menus.map((menu, i) => {
        const shown = open.has(menu.id);
        const name = h("input", {
          cls: "menu-dialog-input ts-name",
          value: menu.title,
          attrs: { type: "text", "aria-label": "Menu name", spellcheck: "false" },
        });
        name.addEventListener("input", () => (menu.title = name.value));
        const holdsEditor = menu.rows.includes(WORKSPACES);
        const count = menu.rows.filter((p) => p !== "-").length;
        const fold = smallButton("", `${shown ? "Hide" : "Show"} the commands in ${menu.title}`, () => {
          if (shown) open.delete(menu.id);
          else open.add(menu.id);
          render();
        });
        fold.innerHTML = UI_ICON.caret;
        fold.classList.add("ts-fold");
        fold.setAttribute("aria-expanded", String(shown));
        const head = h(
          "div",
          { cls: "ts-head" },
          fold,
          name,
          h("span", { cls: "ts-count muted", text: String(count), title: `${count} commands and submenus` }),
          smallButton("↑", `Move ${menu.title} up`, () => (move(draft.menus, i, -1), render()), i === 0),
          smallButton("↓", `Move ${menu.title} down`, () => (move(draft.menus, i, 1), render()), i === draft.menus.length - 1),
          smallButton(
            "Delete",
            holdsEditor ? `${menu.title} holds Workspaces, which has to stay in a menu` : `Delete ${menu.title}; its commands leave the menus`,
            () => {
              draft.hidden.push(...menu.rows.filter((p) => p !== "-"));
              draft.menus.splice(i, 1);
              render();
            },
            holdsEditor,
          ),
        );
        if (!shown) return h("section", { cls: "ts-set" }, head);
        const rows = menu.rows.map((path, k) => {
          const entry = path === "-" ? null : entries.get(path);
          const label = entry ? `${entry.item.label}${entry.item.items ? " ›" : ""}` : "Separator";
          const from = entry && entry.parent !== menu.id ? entry.parent : "";
          return h(
            "div",
            { cls: "ts-tool" },
            h("span", { cls: entry ? "ts-label" : "ts-label muted", text: label, title: entry ? path : "" }, from && h("span", { cls: "ts-origin", text: ` ${from}` })),
            smallButton("↑", "Move up", () => (move(menu.rows, k, -1), render()), k === 0),
            smallButton("↓", "Move down", () => (move(menu.rows, k, 1), render()), k === menu.rows.length - 1),
            smallButton(
              "×",
              path === WORKSPACES ? "Workspaces holds this editor, so it stays in a menu" : `Take ${entry?.item.label ?? "the separator"} out`,
              () => {
                menu.rows.splice(k, 1);
                if (path !== "-") draft.hidden.push(path);
                render();
              },
              path === WORKSPACES,
            ),
          );
        });
        const groups = new Map<string, HTMLOptGroupElement>();
        for (const [path, entry] of entries) {
          if (menu.rows.includes(path)) continue;
          const top = path.split(SEP)[0];
          let group = groups.get(top);
          if (!group) groups.set(top, (group = h("optgroup", { attrs: { label: top } })));
          const now = where.get(path);
          const text = `${inMenu(path)}${entry.item.items ? " ›" : ""}${now ? ` (in ${now})` : ""}`;
          group.append(h("option", { text, attrs: { value: path } }));
        }
        const add = h(
          "select",
          { cls: "select ts-add", attrs: { "aria-label": `Add a command to ${menu.title}` } },
          h("option", { text: "Add a command…", disabled: true, attrs: { value: "", selected: "" } }),
          h("option", { text: "Separator", attrs: { value: "-" } }),
          ...groups.values(),
        );
        add.addEventListener("change", () => {
          if (add.value === "-") menu.rows.push("-");
          else place(menu, add.value);
          render();
        });
        return h("section", { cls: "ts-set" }, head, ...rows, add);
      }),
    );
  };

  const addMenu = smallButton("New Menu", "Add a menu", () => {
    let n = draft.menus.length + 1;
    while (draft.menus.some((m) => m.title === `Menu ${n}`)) n++;
    const id = `custom-${Date.now().toString(36)}-${fresh++}`;
    draft.menus.push({ id, title: `Menu ${n}`, rows: [] });
    open.add(id);
    render();
  });
  const restore = smallButton("Restore Defaults", "Put back the menus Rodeo starts with", () => {
    draft = defaults(built);
    render();
  });
  render();

  const next = await showDialog<MenuLayout>({
    title: "Menus",
    okLabel: "OK",
    cls: "ts-dialog",
    body: [
      h("p", {
        cls: "muted",
        text: "The menu bar shows these menus in this order. Choose a command in a menu's list to move it there; one taken out of the menus still runs from its shortcut.",
      }),
      list,
      h("div", { cls: "ts-actions" }, addMenu, restore),
    ],
    check: () => {
      const names = new Set<string>();
      for (const m of draft.menus) {
        const title = m.title.trim();
        if (!title) return { error: "Give every menu a name." };
        if (names.has(title)) return { error: `Two menus are called "${title}".` };
        if (!m.rows.some((p) => p !== "-")) return { error: `"${title}" has no commands: add one, or delete it.` };
        names.add(title);
      }
      if (!draft.menus.some((m) => m.rows.includes(WORKSPACES))) return { error: "Window › Workspaces holds this editor, so keep it in a menu." };
      return { value: { menus: draft.menus.map((m) => ({ ...m, title: m.title.trim() })), hidden: [...new Set(draft.hidden)] } };
    },
  });
  if (!next) return;
  setMenuLayout(JSON.stringify(next) === JSON.stringify(defaults(built)) ? null : next);
}
