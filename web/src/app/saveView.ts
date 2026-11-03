// View > Save View…, as Vectorworks has it: the current view saved under a name, and whether
// opening it again restores the layers' and classes' visibility. It joins the drawing's saved views
// (Navigation > Views and the View bar list them), which are kept on this computer for the
// drawing's file name rather than in the file.

import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import type { SavedViews } from "./panels/views.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

export async function saveViewDialog(views: SavedViews): Promise<void> {
  if (!store.session) return;
  const taken = new Set(views.names());
  let n = 1;
  while (taken.has(`View ${n}`)) n++;
  const name = h("input", { cls: "menu-dialog-input", value: `View ${n}`, attrs: { type: "text", "aria-label": "View name", spellcheck: "false" } });
  const visibility = h("input", { attrs: { type: "checkbox", "aria-label": "Restore layer and class visibility" } });
  const r = await showDialog<{ name: string; visibility: boolean }>({
    title: "Save View",
    okLabel: "Save",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "View name" }), name),
      h("label", { cls: "menu-dialog-check" }, visibility, "Restore layer and class visibility"),
      h("p", { cls: "muted", text: "The view keeps where the window looks and how far it is zoomed, the active layer and class, and the layer and class options." }),
    ],
    check: () => {
      const v = name.value.trim();
      if (!v) return { error: "Name the view.", focus: name };
      if (taken.has(v)) return { error: `There is a saved view named "${v}" already.`, focus: name };
      return { value: { name: v, visibility: visibility.checked } };
    },
  });
  if (!r) return;
  views.rewrite([...views.entries().map((e, index) => ({ index, name: e.name, restoreVisibility: e.restoreVisibility })), { index: -1, name: r.name, restoreVisibility: r.visibility }]);
  toast(`View "${r.name}" saved.`, "info");
}
