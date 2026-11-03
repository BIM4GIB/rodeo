// Quick Preferences, as Vectorworks' View bar keeps them: a pop-up of the preferences turned on and
// off most often, each a row checked while it is on, so they change without the Preferences dialog.
// Customize… chooses which of them it lists; the choice is kept in this browser and with saved
// workspaces.

import "./quickPrefs.css";
import { toggleGrid, toggleSnapGrid, toggleSnapObjects } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import type { Row } from "./menu.ts";
import { showDialog } from "./menubar.ts";
import { prefs, setPrefs, type Prefs } from "./prefs.ts";
import { preferencesDialog } from "./prefsDialog.ts";
import { setZoomLineThickness, store } from "./state.ts";
import { darkCanvas, setDarkCanvas } from "./theme.ts";

const STORAGE_KEY = "openvwx.quickPrefs";

interface QuickPref {
  readonly id: string;
  readonly label: string;
  on(): boolean;
  set(on: boolean): void;
}

/** One of the Preferences dialog's own switches. */
function pref(id: keyof Prefs & string, label: string): QuickPref {
  return {
    id,
    label,
    on: () => prefs()[id] === true,
    set: (on) => setPrefs({ ...prefs(), [id]: on }),
  };
}

/** Every preference the pop-up can list, in its order. */
export const QUICK_PREFS: readonly QuickPref[] = [
  { id: "blackBackground", label: "Black Background", on: darkCanvas, set: setDarkCanvas },
  { id: "zoomLineThickness", label: "Zoom Line Thickness", on: () => store.zoomLineThickness, set: setZoomLineThickness },
  { id: "showGrid", label: "Show Grid", on: () => store.showGrid, set: (on) => on !== store.showGrid && toggleGrid() },
  { id: "snapGrid", label: "Snap to Grid", on: () => store.snapGrid, set: (on) => on !== store.snapGrid && toggleSnapGrid() },
  { id: "snapObjects", label: "Snap to Objects", on: () => store.snapObjects, set: (on) => on !== store.snapObjects && toggleSnapObjects() },
  pref("fullCursor", "Full-Screen Cursor"),
  pref("offsetDuplicates", "Offset Duplicates"),
  pref("preselect", "Pre-selection Highlighting"),
  pref("selectBox", "Selection Box"),
  pref("snapBox", "Snap Box"),
  pref("animateViews", "Animate View Transitions"),
  pref("wheelZooms", "Mouse Wheel Zooms"),
  pref("showOthersEditing", "Show Other Objects While Editing"),
  pref("toolHelp", "Tool Help in the Mode Bar"),
  pref("remember3d", "Keep the 3D Render Mode"),
  pref("autosave", "Autosave"),
  {
    id: "compact",
    label: "Compact Interface",
    on: () => appContext()?.palettes.density === "compact",
    set: (on) => {
      const palettes = appContext()?.palettes;
      if (palettes && (palettes.density === "compact") !== on) palettes.toggleDensity();
    },
  },
];

/** What the pop-up lists to start with. */
const DEFAULT_SHOWN = ["blackBackground", "zoomLineThickness", "showGrid", "snapGrid", "fullCursor", "offsetDuplicates", "preselect"];

let shown = load();

/** A list read from storage or a workspace: the known ids in it, in the pop-up's order; null when it isn't one. */
export function readQuickPrefs(data: unknown): string[] | null {
  if (!Array.isArray(data)) return null;
  return QUICK_PREFS.filter((p) => data.includes(p.id)).map((p) => p.id);
}

function load(): string[] {
  try {
    return readQuickPrefs(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")) ?? [...DEFAULT_SHOWN];
  } catch {
    // no storage: the usual ones
    return [...DEFAULT_SHOWN];
  }
}

/** The preferences the pop-up lists, as a workspace keeps them. */
export function quickPrefsShown(): string[] {
  return [...shown];
}

/** Lists these preferences in the pop-up (a workspace chosen, or Customize…). */
export function setQuickPrefsShown(ids: readonly string[]): void {
  shown = readQuickPrefs(ids) ?? [...DEFAULT_SHOWN];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shown));
  } catch {
    // kept for this visit only
  }
}

/** The pop-up's rows: each listed preference, checked while on, then Customize… and Preferences…. */
export function quickPrefRows(): Row[] {
  const rows: Row[] = QUICK_PREFS.filter((p) => shown.includes(p.id)).map((p) => ({ label: p.label, checked: () => p.on(), run: () => p.set(!p.on()) }));
  if (rows.length === 0) rows.push({ label: "No preferences listed", enabled: () => false });
  return [...rows, "-", { label: "Customize…", run: () => void customize() }, { label: "Preferences…", run: () => void preferencesDialog() }];
}

/** Customize Quick Preferences: a box for each preference the pop-up can list. */
async function customize(): Promise<void> {
  const boxes = QUICK_PREFS.map((p) => {
    const box = h("input", { checked: shown.includes(p.id), attrs: { type: "checkbox" } });
    return { id: p.id, box, row: h("label", { cls: "menu-dialog-check" }, box, p.label) };
  });
  const chosen = await showDialog<string[]>({
    title: "Customize Quick Preferences",
    okLabel: "OK",
    cls: "quick-prefs-dialog",
    body: [h("p", { cls: "muted", text: "The preferences the View bar's Quick Preferences pop-up lists:" }), h("div", { cls: "quick-prefs-list" }, ...boxes.map((b) => b.row))],
    check: () => ({ value: boxes.filter((b) => b.box.checked).map((b) => b.id) }),
  });
  if (chosen) setQuickPrefsShown(chosen);
}
