// A title block border's right-click Duplicate on Layers…: Vectorworks' Select Layers dialog, the
// layers no title block border is on yet, each ticked to take a copy of the one clicked, where it
// stands; a sheet's copy takes its sheet's number and title (titleBlockData.ts). One undo step.

import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import "./duplicateOnLayers.css";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { duplicateTitleBlock, layersWithoutTitleBlock } from "./titleBlockData.ts";

export async function duplicateOnLayersDialog(id: string): Promise<void> {
  const session = store.session;
  if (!session) return;
  const layers = layersWithoutTitleBlock(session.doc);
  if (!layers.length) {
    toast("Every layer has a title block border already.", "info");
    return;
  }
  const boxes = layers.map((l) => h("input", { attrs: { type: "checkbox", "aria-label": l.name } }));
  const rows = layers.map((l, i) =>
    h(
      "label",
      { cls: "menu-dialog-check" },
      boxes[i],
      h("span", { text: l.kind === "sheet" ? [l.name, l.title].filter(Boolean).join(" ") : l.name }),
      h("span", { cls: "dol-kind", text: l.kind === "sheet" ? "Sheet" : "Design" }),
    ),
  );
  const toggle = h("button", { cls: "btn", text: "Select/Deselect All", attrs: { type: "button" } });
  toggle.addEventListener("click", () => {
    const on = !boxes.every((b) => b.checked);
    for (const b of boxes) b.checked = on;
  });
  const chosen = await showDialog<string[]>({
    title: "Select Layers",
    okLabel: "OK",
    body: [
      h("p", { cls: "menu-dialog-text", text: "Tick the layers to put a copy of this title block border on. Layers that have one already aren't listed." }),
      h("div", { cls: "dol-layers" }, ...rows),
      toggle,
    ],
    check: () => {
      const ids = layers.filter((_, i) => boxes[i].checked).map((l) => l.id);
      return ids.length ? { value: ids } : { error: "Tick at least one layer.", focus: boxes[0] };
    },
  });
  if (!chosen || store.session !== session) return;
  const r = attempt("Duplicate on Layers", (s) => s.batch(() => duplicateTitleBlock(s, id, chosen)));
  if (!r) return;
  const n = r.value.length;
  toast(`Title block border copied to ${n} ${n === 1 ? "layer" : "layers"}.`, "info");
}
