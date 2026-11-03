// Leaving a group being edited, as Vectorworks Fundamentals offers it: an Exit Group button over the
// drawing while a group is open, and Window > Edit Group and Object Visibility Options (Vectorworks
// 2025's name for Exit Group Options). That sets whether pressing Esc twice in quick succession leaves
// the group (the first clears the selection) or Esc never does, and whether the buttons over the
// drawing (Exit Group, Exit Symbol and Unhide Objects) are large, an icon and their label, or small,
// the icon alone. The options are kept in this browser.

import { exitEditGroup } from "./commands.ts";
import { h } from "./dom.ts";
import { UI_ICON } from "./icons.ts";
import type { Row } from "./menu.ts";
import { store } from "./state.ts";
import { editBars } from "./symbolEdit.ts";

interface Options {
  readonly escEsc: boolean;
  /** the buttons over the drawing show their icon alone */
  readonly small: boolean;
}

const STORAGE_KEY = "openvwx.exitGroup";
/** the most time between the two presses of Esc Esc, ms */
const ESC_ESC_MS = 700;

let options: Options = load();
let lastEscape = 0;
const listeners = new Set<() => void>();

function load(): Options {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    // before Large and Small, an icon-only button was "icon"
    return { escEsc: r.escEsc !== false, small: r.small === true || r.button === "icon" };
  } catch {
    return { escEsc: true, small: false };
  }
}

function set(next: Partial<Options>): void {
  options = { ...options, ...next };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // storage full or blocked: the options last for this visit
  }
  for (const fn of listeners) fn();
}

/**
 * Esc pressed with a group open and nothing else to cancel: true when it is the second of two in
 * quick succession and Esc Esc leaves the group.
 */
export function escapeLeavesGroup(): boolean {
  if (!options.escEsc) return false;
  const now = performance.now();
  const twice = now - lastEscape < ESC_ESC_MS;
  lastEscape = twice ? 0 : now;
  return twice;
}

/** A button over the drawing that follows Use Large Buttons and Use Small Buttons; `sync` redraws it (its label changed). */
export interface EditModeButton {
  readonly el: HTMLButtonElement;
  readonly sync: () => void;
}

/**
 * A button over the drawing with `icon` and `label`, large (both) or small (the icon alone, the label
 * its name) as the options say, following them as they change. Its tooltip is `title`, else the label.
 */
export function editModeButton(icon: string, label: () => string, onClick: () => void, cls: string, title?: string): EditModeButton {
  const el = h("button", { cls, attrs: { type: "button" } });
  el.addEventListener("click", onClick);
  const sync = (): void => {
    const text = label();
    el.innerHTML = icon;
    if (!options.small) el.append(h("span", { text }));
    el.classList.toggle("icon-only", options.small);
    el.setAttribute("aria-label", text);
    el.title = title ?? text;
  };
  listeners.add(sync);
  sync();
  return { el, sync };
}

/** Window > Edit Group and Object Visibility Options. */
export function exitGroupOptionRows(): Row[] {
  return [
    { label: "Use Large Buttons", checked: () => !options.small, run: () => set({ small: false }) },
    { label: "Use Small Buttons", checked: () => options.small, run: () => set({ small: true }) },
    "-",
    { label: "<Esc><Esc> Exits Group", checked: () => options.escEsc, run: () => set({ escEsc: true }) },
    { label: "<Esc><Esc> Does Not Exit Group", checked: () => !options.escEsc, run: () => set({ escEsc: false }) },
  ];
}

/** The bar over the drawing while a group is being edited: its name, when it has one, and Exit Group. */
export function mountGroupBar(wrap: HTMLElement): void {
  const name = h("span", { cls: "symbol-bar-name" });
  const exit = editModeButton(UI_ICON.exitGroup, () => "Exit Group", exitEditGroup, "btn small primary exit-group-btn", "Exit Group (⌘])");
  const bar = h("div", { cls: "symbol-bar", hidden: true, attrs: { role: "status" } }, h("span", { cls: "symbol-bar-label", text: "Editing group" }), name, exit.el);
  editBars(wrap).append(bar);
  const sync = (): void => {
    const id = store.editGroupId;
    const group = id ? store.session?.doc.object(id) : null;
    bar.hidden = !group;
    name.textContent = group?.name ?? "";
    name.hidden = !group?.name;
  };
  store.on(["session", "selection", "layer"], sync);
  sync();
}
