// Search feature: Search Everything (⇧⌘K), Find Usages and the Query Bar. Registers
// its Edit menu rows, Tools > Quick Search… (F, as Vectorworks keys it), the top bar's
// magnifier and the highlights the Query Bar draws, with app/ext.ts. The modules beside this file do the work; they read the editor
// through appContext() once it has started.

import { h } from "../../app/dom.ts";
import { appContext, registerMenu, registerOverlay, registerTopBar } from "../../app/ext.ts";
import { shortcutText } from "../../app/menu.ts";
import { allMenus } from "../../app/menubar.ts";
import { onMenuKeys } from "../../app/menuKeys.ts";
import { store } from "../../app/state.ts";
import { need } from "../../app/menuReasons.ts";
import { SEARCH_ICON } from "./glyphs.ts";
import { openSearch } from "./palette.ts";
import { drawQueryHighlights, openQuery } from "./queryBar.ts";
import { findUsagesOfSelection } from "./usagesDialog.ts";
import "./search.css";

const SEARCH_ROW = "Search Everything…";

// Vectorworks' Quick Search (Tools menu, F over the window: shortcuts.ts) is this palette
registerMenu("Tools", () => [{ label: "Quick Search…", keys: "F", run: () => openSearch() }], { after: "Find and Modify…" });

registerMenu("Edit", () => [
  { label: SEARCH_ROW, keys: "⇧⌘K", run: () => openSearch() },
  { label: "Select by Query…", enabled: () => store.session !== null, run: () => openQuery() },
  {
    label: "Find Usages…",
    why: need.selection,
    enabled: () => store.session !== null && store.selection.size > 0,
    run: () => {
      const ctx = appContext();
      if (ctx) void findUsagesOfSelection(ctx);
    },
  },
]);

/** The shortcut the Edit menu shows for a row, as Menu Shortcuts… set it; "" for none. */
function editKeys(label: string): string {
  for (const menu of allMenus()) {
    if (menu.title !== "Edit") continue;
    for (const row of menu.rows) {
      if (row !== "-" && row.label === label && row.keys) return shortcutText(row.keys);
    }
  }
  return "";
}

registerTopBar(() => {
  const button = h("button", {
    cls: "tb-icon",
    html: SEARCH_ICON,
    attrs: { type: "button", "aria-label": "Search Everything" },
  });
  const title = (): void => {
    const keys = editKeys(SEARCH_ROW);
    button.title = keys ? `Search Everything (${keys})` : "Search Everything";
  };
  title();
  onMenuKeys(title);
  button.addEventListener("click", () => {
    button.blur();
    openSearch();
  });
  return button;
}, "left");

registerOverlay(drawQueryHighlights);
