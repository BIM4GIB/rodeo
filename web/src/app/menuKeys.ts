// Menu shortcuts: the key combination that runs each menu command, which Window >
// Workspaces > Menu Shortcuts… changes, as Vectorworks' Workspace Editor does for
// menu commands. A command is named by its path ("Modify › Group"); its default is
// the key its menu row was given. Only combinations with ⌘ (Ctrl elsewhere) can be
// set: plain keys pick tools. Changes are kept in this browser (localStorage) and
// travel in workspace files.

import { h } from "./dom.ts";
import { shortcutText, type Item, type Row } from "./menu.ts";
import { showDialog } from "./menubar.ts";
import { onLanguage, t } from "./i18n.ts";

const STORAGE_KEY = "openvwx.menukeys.v1";
const SEP = " › ";

/** Combinations the browser keeps for itself: a page never sees them. */
const BROWSER_KEYS = new Set(["⌘W", "⌘T", "⌘N", "⌘Q", "⇧⌘W", "⇧⌘T", "⇧⌘N"]);

/** Keys named by their physical position, so ⇧ and ⌥ do not change them. */
const CODE_KEYS = new Map<string, string>([
  ["Equal", "="],
  ["Minus", "-"],
  ["Quote", "'"],
  ["Comma", ","],
  ["Period", "."],
  ["Slash", "/"],
  ["Semicolon", ";"],
  ["Backslash", "\\"],
  ["BracketLeft", "["],
  ["BracketRight", "]"],
  ["Backquote", "`"],
]);

/** A menu command that a shortcut can run. */
export interface MenuCommand {
  /** "Edit › Undo" */
  readonly path: string;
  readonly label: string;
  /** the menu row's own key, "" for none */
  readonly defaultKeys: string;
  /** false for rows whose key is not a ⌘ combination (⌫, Esc, 3): the window handles those */
  readonly editable: boolean;
}

/** Changes from the defaults: command path to its combination, "" for none. */
type Changes = Record<string, string>;

const listeners = new Set<() => void>();
let changes: Changes = load();
/** the menus' commands, known once the menu bar is built */
let commands: readonly MenuCommand[] = [];

function load(): Changes {
  try {
    return clean(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"));
  } catch {
    return {};
  }
}

/** Kept or imported changes with anything that is not a path and a ⌘ combination (or "") dropped. */
function clean(raw: unknown): Changes {
  const out: Changes = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [path, keys] of Object.entries(raw)) {
    if (typeof keys !== "string") continue;
    if (keys === "" || isCombination(keys)) out[path] = keys;
  }
  return out;
}

function isCombination(keys: string): boolean {
  return /^⌥?⇧?⌘.$/u.test(keys);
}

function save(next: Changes): void {
  changes = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the keys last for this visit only
  }
  syncTitles();
  for (const fn of listeners) fn();
}

/** A tooltip naming the command's shortcut, "Undo (⌘Z)", or the label alone when it has none, in the interface's language. */
function titleWithKey(el: HTMLElement): void {
  const label = (el.dataset.keyLabel ??= el.title.replace(/\s*\([^)]*\)$/, ""));
  const keys = menuKeyOf(el.dataset.menuKey ?? "");
  el.title = keys ? `${t(label)} (${shortcutText(keys)})` : t(label);
}

/** Re-titles every element that names a command's shortcut (data-menu-key). */
function syncTitles(): void {
  for (const el of document.querySelectorAll<HTMLElement>("[data-menu-key]")) titleWithKey(el);
}

onLanguage(syncTitles);

/** Gives `el` the tooltip `label` with the shortcut of the command at `path`, kept in step with Menu Shortcuts…. */
export function keyTitle(el: HTMLElement, label: string, path: string): void {
  el.dataset.menuKey = path;
  el.dataset.keyLabel = label;
  titleWithKey(el);
}

function isEditable(keys: string | undefined): boolean {
  return keys === undefined || keys.includes("⌘");
}

/** The commands in a menu's rows, submenus included; rows read when opened (Open Recent, Workspaces) are not commands. */
function commandsIn(prefix: string, rows: readonly Row[]): MenuCommand[] {
  const out: MenuCommand[] = [];
  for (const row of rows) {
    if (row === "-") continue;
    const path = `${prefix}${SEP}${row.label}`;
    if (row.items) {
      if (typeof row.items !== "function") out.push(...commandsIn(path, row.items));
    } else if (row.run) {
      out.push({ path, label: row.label, defaultKeys: row.keys ?? "", editable: isEditable(row.keys) });
    }
  }
  return out;
}

/** Takes the menus as built, so the dialog can list their commands. */
export function registerMenus(menus: readonly { readonly title: string; readonly rows: readonly Row[] }[]): void {
  commands = menus.flatMap((m) => commandsIn(m.title, m.rows));
  syncTitles();
}

/** A command's combination now, or undefined when it has none. */
export function menuKeyOf(path: string): string | undefined {
  const changed = changes[path];
  if (changed !== undefined) return changed || undefined;
  return commands.find((c) => c.path === path)?.defaultKeys || undefined;
}

/** A menu's rows with each command's key as changed. */
export function withMenuKeys(prefix: string, rows: readonly Row[]): Row[] {
  return rows.map((row): Row => {
    if (row === "-") return row;
    const path = `${prefix}${SEP}${row.label}`;
    if (row.items) return typeof row.items === "function" ? row : { ...row, items: withMenuKeys(path, row.items) };
    if (!row.run || !isEditable(row.keys)) return row;
    const changed = changes[path];
    if (changed === undefined) return row;
    return { ...row, keys: changed || undefined };
  });
}

/** The combination a key press makes, in menu notation ("⇧⌘Z"); null without ⌘ or Ctrl, or for a lone modifier. */
export function combinationOf(e: KeyboardEvent): string | null {
  if (!e.metaKey && !e.ctrlKey) return null;
  let key: string | undefined;
  if (e.code.startsWith("Key")) key = e.code.slice(3);
  else if (e.code.startsWith("Digit")) key = e.code.slice(5);
  else key = CODE_KEYS.get(e.code);
  // a layout without the code: the typed character, when it is one
  if (key === undefined && e.key.length === 1) key = e.key.toUpperCase();
  if (key === undefined) return null;
  return `${e.altKey ? "⌥" : ""}${e.shiftKey ? "⇧" : ""}⌘${key}`;
}

/** The row in `rows` (submenus included) whose key is `keys`. */
export function rowForKeys(rows: readonly Row[], keys: string): Item | null {
  for (const row of rows) {
    if (row === "-") continue;
    if (row.items) {
      const inner = typeof row.items === "function" ? null : rowForKeys(row.items, keys);
      if (inner) return inner;
    } else if (row.run && row.keys === keys) {
      return row;
    }
  }
  return null;
}

/** The changed keys, as a workspace file keeps them. */
export function menuKeyChanges(): Changes {
  return { ...changes };
}

/** Takes the keys a workspace file kept. */
export function applyMenuKeyChanges(raw: unknown): void {
  save(clean(raw));
}

/** Calls `fn` whenever the keys change. */
export function onMenuKeys(fn: () => void): void {
  listeners.add(fn);
}

/** Window > Workspaces > Menu Shortcuts…: a combination for each command, typed into its field, checked for clashes. */
export async function menuKeysDialog(): Promise<void> {
  const current = new Map<string, string>(commands.map((c) => [c.path, menuKeyOf(c.path) ?? ""]));
  const filter = h("input", {
    cls: "menu-dialog-input mk-filter",
    attrs: { type: "search", placeholder: "Filter commands", "aria-label": "Filter commands", spellcheck: "false" },
  });
  const rows = commands.map((c) => {
    const field = h("input", {
      cls: "menu-dialog-input mk-input",
      value: shortcutText(current.get(c.path) ?? ""),
      attrs: { type: "text", readonly: "", "aria-label": `${c.path} shortcut`, placeholder: c.editable ? "None" : "" },
    });
    field.disabled = !c.editable;
    field.addEventListener("keydown", (e) => {
      if (e.key === "Tab" || e.key === "Escape") return;
      e.preventDefault();
      if ((e.key === "Backspace" || e.key === "Delete") && !e.metaKey && !e.ctrlKey) {
        current.set(c.path, "");
        field.value = "";
        return;
      }
      const keys = combinationOf(e);
      if (!keys) return;
      current.set(c.path, keys);
      field.value = shortcutText(keys);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const label = c.path.split(SEP);
    const row = h(
      "label",
      { cls: "mk-row" },
      h("span", { cls: "mk-label", attrs: { title: c.path } }, h("span", { cls: "mk-menu", text: label.slice(0, -1).join(SEP) + SEP }), label.at(-1) ?? ""),
      field,
    );
    return { command: c, field, row };
  });
  filter.addEventListener("input", () => {
    const words = filter.value.toLowerCase().split(/\s+/).filter(Boolean);
    for (const r of rows) r.row.hidden = !words.every((w) => r.command.path.toLowerCase().includes(w));
  });
  const restore = h("button", { cls: "btn small", text: "Restore Defaults", attrs: { type: "button" } });
  restore.addEventListener("click", () => {
    for (const r of rows) {
      current.set(r.command.path, r.command.defaultKeys);
      r.field.value = shortcutText(r.command.defaultKeys);
    }
  });
  const next = await showDialog<Changes>({
    title: "Menu Shortcuts",
    okLabel: "OK",
    cls: "mk-dialog",
    body: [
      h("p", { cls: "muted", text: "Click a command's field and press the combination, with ⌘ (Ctrl), and ⇧ or ⌥ if wanted. Delete clears it." }),
      filter,
      h("div", { cls: "mk-list" }, ...rows.map((r) => r.row)),
      h("div", { cls: "tk-actions" }, restore),
    ],
    check: () => {
      const owner = new Map<string, string>();
      const out: Changes = {};
      for (const r of rows) {
        const keys = current.get(r.command.path) ?? "";
        if (keys === "") {
          if (r.command.defaultKeys !== "" && r.command.editable) out[r.command.path] = "";
          continue;
        }
        if (BROWSER_KEYS.has(keys)) return { error: `${shortcutText(keys)} belongs to the browser; choose another for ${r.command.path}.`, focus: r.field };
        const other = owner.get(keys);
        if (other) {
          filter.value = "";
          for (const x of rows) x.row.hidden = false;
          return { error: `${shortcutText(keys)} is the shortcut of both ${other} and ${r.command.path}.`, focus: r.field };
        }
        owner.set(keys, r.command.path);
        if (r.command.editable && keys !== r.command.defaultKeys) out[r.command.path] = keys;
      }
      return { value: out };
    },
  });
  if (next) save(next);
}
