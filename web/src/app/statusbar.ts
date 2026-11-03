// The pills at the foot of the drawing: the cursor's position, and the snap
// and grid toggles with the Notification Center's bell. The tool's hint is in
// the Mode bar.

import { byId } from "./dom.ts";
import { UI_ICON } from "./icons.ts";
import { mountNotifications } from "./notifications.ts";
import { setGrid, store } from "./state.ts";
import { formatLength } from "./units.ts";

export function mountStatusBar(): void {
  const cursorEl = byId("sb-cursor");
  const snapObjects = byId<HTMLInputElement>("snap-objects");
  const gridShow = byId<HTMLInputElement>("grid-show");
  const snapGrid = byId<HTMLInputElement>("snap-grid");

  const icons: Record<string, string> = {
    "snap-objects": UI_ICON.snapObjects,
    "grid-show": UI_ICON.gridShow,
    "snap-grid": UI_ICON.snapGrid,
  };
  for (const el of document.querySelectorAll<HTMLElement>(".sb-icon[data-icon]")) {
    el.innerHTML = icons[el.dataset.icon ?? ""] ?? "";
  }
  byId("btn-snapping").innerHTML = UI_ICON.more;
  mountNotifications(byId("snapbar"));

  // the checkboxes follow the store, so a keyboard shortcut updates them too
  const syncToggles = (): void => {
    snapObjects.checked = store.snapObjects;
    gridShow.checked = store.showGrid;
    snapGrid.checked = store.snapGrid;
  };
  syncToggles();
  store.on("snap", syncToggles);
  snapObjects.addEventListener("change", () => {
    store.snapObjects = snapObjects.checked;
    store.emit("snap");
  });
  gridShow.addEventListener("change", () => setGrid({ show: gridShow.checked }));
  snapGrid.addEventListener("change", () => setGrid({ snap: snapGrid.checked }));

  // shown while the pointer is over the drawing; measured from the datum while one is set
  const renderCursor = (): void => {
    const s = store.session;
    const c = store.cursor;
    cursorEl.hidden = !s || !c;
    if (!s || !c) return;
    const units = s.doc.info.units;
    const d = store.datum;
    const xy = `X ${formatLength(c.x - (d?.x ?? 0), units)}   Y ${formatLength(c.y - (d?.y ?? 0), units)}`;
    cursorEl.textContent = d ? `Datum  ${xy}` : xy;
  };
  store.on(["cursor", "session", "datum"], renderCursor);
}
