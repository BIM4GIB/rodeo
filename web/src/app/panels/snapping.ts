// The Snapping palette: snapping to objects at all, then each kind of object
// snap on its own, then the grid, as Vectorworks' Snapping palette offers them,
// and a button for the snap radius and the grid spacing. A right-click or double-click on the
// Smart points button opens Smart Point Settings, as Vectorworks' Smart Point Snap Settings
// popover opens from its tool: how long a rest acquires a smart point or sets a datum, and the
// datum offset.

import { h } from "../dom.ts";
import { keyTitle } from "../menuKeys.ts";
import { SNAP_ICON, UI_ICON } from "../icons.ts";
import { DEFAULT_SNAP_SETTINGS, setGrid, setSnapKind, setSnapSettings, store, type ObjectSnapKind } from "../state.ts";
import { toolPrefs } from "../toolPrefs.ts";

/** Snap Settings…: how near the cursor must come to snap, and a fixed grid spacing or one that follows the zoom. */
export async function snapSettingsDialog(): Promise<void> {
  const now = store.snapSettings;
  const v = await toolPrefs(
    "Snap Settings",
    [
      { kind: "number", key: "radius", label: "Snap radius", value: now.radiusPx, min: 2, max: 40, integer: true, unit: "px" },
      { kind: "check", key: "fixed", label: "Fixed grid spacing", value: now.gridSpacing !== null },
      { kind: "length", key: "spacing", label: "Grid spacing", value: now.gridSpacing ?? 1000 },
    ],
    `Without a fixed spacing the grid follows the zoom. The snap radius is ${DEFAULT_SNAP_SETTINGS.radiusPx} px at first.`,
  );
  if (!v) return;
  setSnapSettings({ ...store.snapSettings, radiusPx: v.num("radius"), gridSpacing: v.flag("fixed") ? v.num("spacing") : null });
}

/** Smart Point Settings…: how long the pointer rests to acquire a smart point or set a datum, and the datum offset. */
export async function smartPointSettingsDialog(): Promise<void> {
  const now = store.snapSettings;
  const v = await toolPrefs(
    "Smart Point Settings",
    [
      { kind: "number", key: "acquire", label: "Acquire smart point if mouse stops for", value: now.acquireSec, min: 0.1, max: 5, unit: "sec" },
      { kind: "check", key: "datum", label: "Set datum if mouse stops", value: now.datumSec !== null },
      { kind: "number", key: "datumSec", label: "Set datum if mouse stops for", value: now.datumSec ?? 1.5, min: 0.2, max: 10, unit: "sec" },
      { kind: "check", key: "offset", label: "Use datum offset", value: now.datumOffset !== null },
      { kind: "length", key: "offsetBy", label: "Datum offset", value: now.datumOffset ?? 300 },
    ],
    "G over the drawing sets or releases a datum whatever these say. Set the datum's rest longer than the smart point's. The datum offset marks the points that far from the datum along its extensions, to snap to.",
  );
  if (!v) return;
  setSnapSettings({
    ...store.snapSettings,
    acquireSec: v.num("acquire"),
    datumSec: v.flag("datum") ? v.num("datumSec") : null,
    datumOffset: v.flag("offset") ? v.num("offsetBy") : null,
  });
}

interface Toggle {
  readonly label: string;
  readonly icon: string;
  readonly on: () => boolean;
  readonly set: (on: boolean) => void;
  /** greyed while snapping to objects is off */
  readonly needsObjects?: boolean;
  readonly separatorBefore?: boolean;
  /** the menu command whose shortcut the tooltip names */
  readonly menuKey?: string;
  /** opened by a right-click or double-click on the button: the snap's own settings */
  readonly settings?: () => Promise<void>;
}

function kind(k: ObjectSnapKind, label: string): Toggle {
  return { label, icon: SNAP_ICON[k], on: () => store.snapKinds[k], set: (on) => setSnapKind(k, on), needsObjects: true };
}

const TOGGLES: readonly Toggle[] = [
  {
    label: "Snap to Objects",
    icon: SNAP_ICON.objects,
    on: () => store.snapObjects,
    set: (on) => {
      store.snapObjects = on;
      store.emit("snap");
    },
  },
  kind("end", "Endpoints and vertices"),
  kind("mid", "Midpoints"),
  kind("center", "Centres"),
  kind("intersection", "Intersections"),
  kind("nearest", "Points on edges"),
  kind("tangent", "Tangents and perpendiculars, from the point a line is drawn from"),
  { ...kind("smart", "Smart points: pause on a point, then line up with it (right-click for Smart Point Settings)"), settings: smartPointSettingsDialog },
  { label: "Snap to Grid", menuKey: "View › Snap to Grid", icon: UI_ICON.snapGrid, on: () => store.snapGrid, set: (on) => setGrid({ snap: on }), separatorBefore: true },
  { label: "Show Grid", menuKey: "View › Show Grid", icon: UI_ICON.gridShow, on: () => store.showGrid, set: (on) => setGrid({ show: on }) },
];

export function snappingPalette(): HTMLElement {
  const grid = h("div", { cls: "tool-grid", attrs: { role: "toolbar", "aria-label": "Snapping" } });
  const buttons = TOGGLES.map((t) => {
    if (t.separatorBefore) grid.append(h("div", { attrs: { role: "separator" } }));
    const btn = h("button", { cls: "tool", html: t.icon, title: t.label, attrs: { type: "button", "aria-label": t.label } });
    if (t.menuKey) keyTitle(btn, t.label, t.menuKey);
    btn.addEventListener("click", () => {
      btn.blur();
      t.set(!t.on());
    });
    const settings = t.settings;
    if (settings) {
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        void settings();
      });
      // a double-click's two clicks leave the snap as it was
      btn.addEventListener("dblclick", () => void settings());
    }
    grid.append(btn);
    return btn;
  });
  const settings = h("button", { cls: "tool", html: UI_ICON.prefs, title: "Snap Settings…", attrs: { type: "button", "aria-label": "Snap Settings…" } });
  settings.addEventListener("click", () => {
    settings.blur();
    void snapSettingsDialog();
  });
  grid.append(settings);
  const sync = (): void => {
    TOGGLES.forEach((t, i) => {
      const on = t.on();
      buttons[i].classList.toggle("active", on);
      buttons[i].setAttribute("aria-pressed", String(on));
      buttons[i].classList.toggle("dimmed", !!t.needsObjects && !store.snapObjects);
    });
  };
  store.on("snap", sync);
  sync();
  return grid;
}
