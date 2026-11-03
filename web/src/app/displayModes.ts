// Layer Options and Class Options as Vectorworks offers them: the six options and their menu rows,
// shared by the View menu, the View bar, the drawing's right-click menu and the Navigation palette.

import type { Item } from "./menu.ts";
import { store, type DisplayMode } from "./state.ts";

/** Layer and class options, in the order Vectorworks lists them, each with the digit of its key. */
export const DISPLAY_MODES: readonly { readonly value: DisplayMode; readonly label: string; readonly digit: number }[] = [
  { value: "active-only", label: "Active Only", digit: 3 },
  { value: "gray-others", label: "Gray Others", digit: 4 },
  { value: "gray-snap-others", label: "Gray/Snap Others", digit: 5 },
  { value: "show-others", label: "Show Others", digit: 6 },
  { value: "show-snap-others", label: "Show/Snap Others", digit: 7 },
  { value: "modify-others", label: "Show/Snap/Modify Others", digit: 8 },
];

/**
 * View > Layer Options or Class Options (and the View bar's pop-ups, and the drawing's right-click
 * menu): the options, keyed ⌥⌘3 to ⌥⌘8 and, for classes, with ⇧ too, as Vectorworks keys them.
 */
export function displayModeRows(key: "layerMode" | "classMode"): Item[] {
  return DISPLAY_MODES.map((m) => ({
    label: m.label,
    keys: `⌥${key === "classMode" ? "⇧" : ""}⌘${m.digit}`,
    checked: () => store[key] === m.value,
    run: () => {
      store[key] = m.value;
      store.emit("display");
    },
  }));
}
