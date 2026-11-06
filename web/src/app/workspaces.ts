// Window > Workspaces: named palette arrangements, as Vectorworks keeps
// workspaces. Saving one keeps where every palette and bar is (docked, floating,
// tabbed, rolled up, shown), the tool sets, how the tool palettes show tools, the menus, the
// view panes and what Quick Preferences lists; choosing one puts them back. Kept in localStorage, per browser. A workspace file
// carries those and the tool and menu shortcuts to another browser or person:
// Export writes the current ones, Import adds the file's as a workspace and
// switches to it. Four arrangements are built in: Standard, the one openvwx
// starts with (one sidebar of tabbed palettes, the drawing taking the rest),
// Two Sidebars (Navigation on the left, Object Info and Attributes on the
// right, Spline's arrangement), Dense, Vectorworks' compact rows and
// tabbed palettes in narrower docks, and Classic, the tools in Tools and Tool
// Sets palettes down the left as Vectorworks keeps them, not in the top bar.

import type { Palettes } from "./dock.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import type { Row } from "./menu.ts";
import { confirmDialog, showDialog } from "./menubar.ts";
import { toast } from "./toast.ts";
import { allTools, readToolDisplay, readToolSets, setToolDisplay, setToolSets, toolDisplay, toolSetChanges, type ToolSetConfig } from "./toolbar.ts";
import { toolSetsDialog } from "./toolSetsDialog.ts";
import { applyToolKeyChanges, toolKeyChanges, toolKeysDialog } from "./toolKeys.ts";
import { applyMenuKeyChanges, menuKeyChanges, menuKeysDialog } from "./menuKeys.ts";
import { menuLayoutChanges, menuLayoutDialog, readMenuLayout, setMenuLayout, type MenuLayout } from "./menuLayout.ts";
import { paneArrangement, readPaneArrangement, setPaneArrangement, type PaneArrangement } from "./viewPanes.ts";
import { quickPrefsShown, readQuickPrefs, setQuickPrefsShown } from "./quickPrefs.ts";

const STORAGE_KEY = "openvwx.workspaces.v1";
/** what a workspace file says it is */
const FILE_FORMAT = "openvwx-workspace";
const FILE_VERSION = 1;

/** A workspace file's contents. */
interface WorkspaceFile {
  readonly format: typeof FILE_FORMAT;
  readonly version: number;
  readonly name: string;
  readonly layout: unknown;
  /** tool keys changed from the defaults (tool id to key, "" for none) */
  readonly toolKeys: Record<string, string>;
  /** menu shortcuts changed from the defaults ("Edit › Undo" to its combination, "" for none); absent in older files */
  readonly menuKeys?: Record<string, string>;
  /** the tool sets, null for the defaults; absent in older files */
  readonly toolSets?: ToolSetConfig[] | null;
  /** how the tool palettes show tools; absent in older files */
  readonly toolDisplay?: string;
  /** the menus as Menus… arranged them, null for the defaults; absent in older files */
  readonly menus?: MenuLayout | null;
  /** View > Multiple View Panes' arrangement; absent in older files */
  readonly panes?: PaneArrangement;
  /** the preferences the View bar's Quick Preferences lists; absent in older files */
  readonly quickPrefs?: string[];
}

interface Workspace {
  readonly name: string;
  readonly layout: unknown;
  /** absent in workspaces saved before tool sets could change */
  readonly toolSets?: ToolSetConfig[] | null;
  readonly toolDisplay?: string;
  readonly menus?: MenuLayout | null;
  readonly panes?: PaneArrangement;
  readonly quickPrefs?: string[];
}

/** What a workspace keeps besides the palette arrangement: the tool sets, the tool palettes' display, the menus, the view panes and Quick Preferences. */
function toolSettings(): { toolSets: ToolSetConfig[] | null; toolDisplay: string; menus: MenuLayout | null; panes: PaneArrangement; quickPrefs: string[] } {
  return { toolSets: toolSetChanges(), toolDisplay: toolDisplay(), menus: menuLayoutChanges(), panes: paneArrangement(), quickPrefs: quickPrefsShown() };
}

/** Puts a workspace's tool sets, display, menus, view panes and Quick Preferences back; ones saved before they were kept leave them as they are. */
function applyToolSettings(w: { toolSets?: unknown; toolDisplay?: unknown; menus?: unknown; panes?: unknown; quickPrefs?: unknown }): void {
  if (w.toolSets !== undefined) setToolSets(readToolSets(w.toolSets));
  const display = readToolDisplay(w.toolDisplay);
  if (display) setToolDisplay(display);
  if (w.menus !== undefined) setMenuLayout(readMenuLayout(w.menus));
  if (w.panes !== undefined) setPaneArrangement(readPaneArrangement(w.panes));
  const quick = readQuickPrefs(w.quickPrefs);
  if (quick) setQuickPrefsShown(quick);
}

interface Kept {
  workspaces: Workspace[];
  /** the workspace last chosen or saved, which the menu checks */
  current: string | null;
}

function load(): Kept {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Kept> | null;
    const workspaces = Array.isArray(raw?.workspaces)
      ? raw.workspaces.filter((w): w is Workspace => !!w && typeof w.name === "string" && w.name !== "")
      : [];
    const current = typeof raw?.current === "string" && workspaces.some((w) => w.name === raw.current) ? raw.current : null;
    return { workspaces, current };
  } catch {
    // unreadable or blocked storage: none
    return { workspaces: [], current: null };
  }
}

function store(kept: Kept): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // storage blocked: the workspaces last for this visit only
  }
}

/** Asks for a workspace's name, offering the next free "Workspace n". */
async function askName(taken: readonly string[]): Promise<string | null> {
  let n = 1;
  while (taken.includes(`Workspace ${n}`)) n++;
  const input = h("input", {
    cls: "menu-dialog-input",
    value: `Workspace ${n}`,
    attrs: { type: "text", "aria-label": "Workspace name", spellcheck: "false" },
  });
  return showDialog<string>({
    title: "Save Workspace",
    okLabel: "Save",
    body: [h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), input)],
    check: () => {
      const name = input.value.trim();
      return name ? { value: name } : { error: "Give the workspace a name.", focus: input };
    },
  });
}

/** The current arrangement and tool keys as a workspace file's text, named after the workspace in use. */
export function workspaceFileText(palettes: Palettes): string {
  const file: WorkspaceFile = {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    name: load().current ?? "Workspace",
    layout: palettes.snapshot(),
    toolKeys: toolKeyChanges(),
    menuKeys: menuKeyChanges(),
    ...toolSettings(),
  };
  return JSON.stringify(file, null, 2);
}

/**
 * Reads a workspace file's text: kept as a workspace under its name (replacing one of that name
 * when the user agrees), then put in place with its tool keys. Returns the name, or null when
 * the text is not a workspace file or the user kept the one they had.
 */
export async function importWorkspaceText(palettes: Palettes, text: string): Promise<string | null> {
  let file: Partial<WorkspaceFile> | null;
  try {
    file = JSON.parse(text) as Partial<WorkspaceFile> | null;
  } catch {
    file = null;
  }
  if (!file || file.format !== FILE_FORMAT || typeof file.layout !== "object" || file.layout === null) {
    toast("That isn't a Rodeo workspace file.", "info");
    return null;
  }
  const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : "Imported Workspace";
  const now = load();
  if (now.workspaces.some((w) => w.name === name)) {
    if (!(await confirmDialog("Import Workspace", `Replace the workspace "${name}"?`, "Replace"))) return null;
  }
  palettes.restore(file.layout);
  if (file.toolKeys) applyToolKeyChanges(file.toolKeys);
  if (file.menuKeys) applyMenuKeyChanges(file.menuKeys);
  applyToolSettings(file);
  // keep the arrangement as restore() understood it, so the menu entry matches what shows
  store({
    workspaces: [...now.workspaces.filter((w) => w.name !== name), { name, layout: palettes.snapshot(), ...toolSettings() }],
    current: name,
  });
  return name;
}

/** Asks for a workspace file and imports it. */
function pickWorkspaceFile(palettes: Palettes): void {
  const input = h("input", { attrs: { type: "file", accept: ".json,application/json" }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    void file.text().then(async (text) => {
      const name = await importWorkspaceText(palettes, text);
      if (name) toast(`Workspace "${name}" imported.`, "info");
    });
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/** A file name from a workspace's name. */
function fileNameOf(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Workspace";
  return `${base}.workspace.json`;
}

/** Save Workspace As…: the arrangement and tool settings kept under a name typed (replacing one of that name, asked first). */
async function saveWorkspaceAs(palettes: Palettes): Promise<void> {
  const name = await askName(load().workspaces.map((w) => w.name));
  if (!name) return;
  const now = load();
  if (now.workspaces.some((w) => w.name === name)) {
    const replace = await confirmDialog("Save Workspace", `Replace the workspace "${name}"?`, "Replace");
    if (!replace) return;
  }
  const workspaces = now.workspaces.filter((w) => w.name !== name);
  workspaces.push({ name, layout: palettes.snapshot(), ...toolSettings() });
  store({ workspaces, current: name });
}

/**
 * Window > Palettes > Save Palette Positions: where the palettes and bars are now kept in the
 * workspace in use; with a built-in one in use, Save Workspace As… names a new one.
 */
export function savePalettePositions(palettes: Palettes): void {
  const now = load();
  const name = now.current;
  if (!name || !now.workspaces.some((w) => w.name === name)) {
    void saveWorkspaceAs(palettes);
    return;
  }
  store({ ...now, workspaces: now.workspaces.map((w) => (w.name === name ? { ...w, layout: palettes.snapshot() } : w)) });
  toast(`Palette positions saved in the workspace "${name}".`, "info");
}

/** The Workspaces submenu: each kept workspace, then saving the arrangement and deleting one. */
export function workspaceRows(palettes: Palettes): Row[] {
  const kept = load();
  const names = kept.workspaces.map((w) => w.name);
  const builtIn = (label: string, layout: () => unknown): Row => ({
    label,
    run: () => {
      palettes.restore(layout());
      store({ ...load(), current: null });
    },
  });
  return [
    builtIn("Standard", () => null),
    builtIn("Two Sidebars", () => palettes.twoSidebars()),
    builtIn("Dense", () => palettes.dense()),
    builtIn("Classic", () => palettes.classic()),
    "-",
    ...kept.workspaces.map(
      (w): Row => ({
        label: w.name,
        checked: () => kept.current === w.name,
        run: () => {
          palettes.restore(w.layout);
          applyToolSettings(w);
          store({ ...load(), current: w.name });
        },
      }),
    ),
    ...(names.length === 0 ? [{ label: "No saved workspaces", enabled: () => false }] : []),
    "-",
    { label: "Save Workspace As…", run: () => void saveWorkspaceAs(palettes) },
    { label: "Menus…", run: () => void menuLayoutDialog() },
    { label: "Tool Sets…", run: () => void toolSetsDialog() },
    { label: "Tool Shortcuts…", run: () => void toolKeysDialog(allTools()) },
    { label: "Menu Shortcuts…", run: () => void menuKeysDialog() },
    "-",
    {
      label: "Export Workspace…",
      run: () =>
        downloadBlob(
          fileNameOf(load().current ?? "Workspace"),
          new Blob([workspaceFileText(palettes)], { type: "application/json" }),
        ),
    },
    { label: "Import Workspace…", run: () => pickWorkspaceFile(palettes) },
    {
      label: "Delete Workspace",
      enabled: () => names.length > 0,
      items: () =>
        load().workspaces.map(
          (w): Row => ({
            label: w.name,
            run: () =>
              void (async () => {
                if (!(await confirmDialog("Delete Workspace", `Delete the workspace "${w.name}"?`, "Delete"))) return;
                const now = load();
                store({
                  workspaces: now.workspaces.filter((x) => x.name !== w.name),
                  current: now.current === w.name ? null : now.current,
                });
              })(),
          }),
        ),
    },
  ];
}
