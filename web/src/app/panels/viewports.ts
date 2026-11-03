// Navigation > Viewports: every viewport in the drawing under the sheet layer it
// sits on, filterable by name. A click goes to it: its sheet becomes the active
// layer, the viewport is selected and the window zooms to it.

import type { ViewportInfo } from "../../core/index.ts";
import { setActiveLayer, setSelection, zoomToSelection } from "../commands.ts";
import { h } from "../dom.ts";
import { openContextMenu } from "../menu.ts";
import type { Scene } from "../scene.ts";
import { store } from "../state.ts";
import type { View } from "../view.ts";

interface Sheet {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly viewports: readonly ViewportInfo[];
}

/** Sheets that hold viewports, in layer order, each with its viewports in stacking order. */
function sheets(): Sheet[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return doc
    .layers()
    .filter((l) => l.kind === "sheet")
    .map((l) => ({
      id: l.id,
      name: l.name,
      title: l.kind === "sheet" ? l.title : "",
      viewports: doc
        .viewportIds(l.id)
        .map((id) => doc.viewport(id))
        .filter((v): v is ViewportInfo => v !== null),
    }))
    .filter((s) => s.viewports.length > 0);
}

export function mountViewports(root: HTMLElement, scene: Scene, view: View): void {
  let filter = "";
  /** read again only when the document changes, not on every selection */
  let cache: Sheet[] | null = null;
  const search = h("input", {
    cls: "search",
    attrs: { type: "search", placeholder: "Filter viewports", "aria-label": "Filter viewports" },
  });
  const list = h("div", { cls: "list" });
  root.replaceChildren(h("div", { cls: "toolbar" }, search), list);

  const goTo = (sheetId: string, id: string): void => {
    if (store.activeLayerId !== sheetId) setActiveLayer(sheetId);
    setSelection([id]);
    zoomToSelection(scene, view);
  };

  const row = (sheet: Sheet, vp: ViewportInfo, n: number): HTMLElement => {
    const selected = store.selection.has(vp.id);
    const el = h(
      "div",
      { cls: selected ? "row viewport-row selected" : "row viewport-row", attrs: { "data-id": vp.id }, title: "Go to this viewport" },
      h(
        "div",
        { cls: "names" },
        h("div", { cls: "name", text: vp.name || `Viewport ${n}` }),
        h("div", { cls: "sub", text: vp.plan ? "Plan" : "Section, elevation or 3D" }),
      ),
      h("span", { cls: "badge", text: `1:${Math.round(vp.scale * 1000) / 1000}` }),
    );
    el.addEventListener("click", () => goTo(sheet.id, vp.id));
    el.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openContextMenu(
        [
          { label: "Go to Viewport", run: () => goTo(sheet.id, vp.id) },
          {
            label: "Select",
            run: () => {
              if (store.activeLayerId !== sheet.id) setActiveLayer(sheet.id);
              setSelection([vp.id]);
            },
          },
        ],
        e.clientX,
        e.clientY,
      );
    });
    return el;
  };

  const render = (): void => {
    cache ??= sheets();
    const rows: HTMLElement[] = [];
    for (const sheet of cache) {
      const shown = sheet.viewports
        .map((vp, i) => ({ vp, n: i + 1 }))
        .filter(({ vp }) => filter === "" || vp.name.toLowerCase().includes(filter));
      if (shown.length === 0) continue;
      const active = sheet.id === store.activeLayerId;
      rows.push(
        h(
          "div",
          { cls: active ? "list-head active" : "list-head" },
          h("span", { cls: "name", text: sheet.name }),
          sheet.title ? h("span", { cls: "sub", text: sheet.title }) : null,
        ),
        ...shown.map(({ vp, n }) => row(sheet, vp, n)),
      );
    }
    if (rows.length === 0) {
      const any = cache.length > 0;
      rows.push(h("div", { cls: "empty", text: any ? "No matching viewports" : "No viewports" }));
    }
    list.replaceChildren(...rows);
  };

  search.addEventListener("input", () => {
    filter = search.value.trim().toLowerCase();
    render();
  });
  store.on("session", () => {
    cache = null;
    render();
  });
  store.on(["layer", "selection"], render);
  render();
}
