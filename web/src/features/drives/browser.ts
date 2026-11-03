// The OneDrive browser: a dialog over the page. Open from OneDrive lists folders
// and drawings and resolves with the drawing clicked. Save to OneDrive lists
// folders, and resolves with the folder being shown and the file name typed.
// Breadcrumbs go back up, and the search box finds items across the drive.

import { h } from "../../app/dom.ts";
import { errorMessage } from "../../app/toast.ts";
import { drawingName, isDrawing } from "./names.ts";
import { ICON_FILE, ICON_FOLDER } from "./icons.ts";
import { type OneDriveItem, listFolder, rootId, searchOneDrive } from "./onedrive.ts";

/** Where a drawing is to be saved: a folder in the OneDrive, and the file name. */
export interface SaveTarget {
  readonly folderId: string;
  /** the folder's path for display, "OneDrive › Folder" */
  readonly folderPath: string;
  readonly name: string;
}

type Result = { readonly item: OneDriveItem } | { readonly target: SaveTarget };

interface Crumb {
  readonly id: string;
  readonly name: string;
}

/** Lets the person pick a drawing in OneDrive; resolves with it, or null when cancelled. */
export async function chooseDrawing(clientId: string): Promise<OneDriveItem | null> {
  const result = await browse({ clientId, save: false, defaultName: "" });
  return result && "item" in result ? result.item : null;
}

/** Lets the person pick a folder and type a file name to save a drawing as; null when cancelled. */
export async function chooseFolder(clientId: string, defaultName: string): Promise<SaveTarget | null> {
  const result = await browse({ clientId, save: true, defaultName });
  return result && "target" in result ? result.target : null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Folders first, then by name. */
function byKind(a: OneDriveItem, b: OneDriveItem): number {
  return Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}

function browse(spec: { clientId: string; save: boolean; defaultName: string }): Promise<Result | null> {
  return new Promise<Result | null>((resolve) => {
    const { clientId, save } = spec;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const title = save ? "Save to OneDrive" : "Open from OneDrive";
    /** the folders from the root to the one shown */
    let crumbs: Crumb[] = [];
    let items: OneDriveItem[] = [];
    /** the search text in use, or null while a folder is shown */
    let query: string | null = null;
    /** counts the loads, so an answer that arrives late does not replace a newer one */
    let loadNo = 0;

    const path = h("nav", { cls: "drives-crumbs", attrs: { "aria-label": "Folder" } });
    const searchBox = h("input", {
      cls: "menu-dialog-input drives-search",
      attrs: { type: "search", "aria-label": "Search OneDrive", placeholder: "Search", spellcheck: "false" },
    });
    const list = h("div", { cls: "drives-list" });
    const status = h("p", { cls: "drives-status", attrs: { role: "status" } });
    const target = h("p", { cls: "drives-target" });
    const nameBox = h("input", {
      cls: "menu-dialog-input drives-name",
      value: spec.defaultName,
      attrs: { type: "text", "aria-label": "File name", spellcheck: "false", autocomplete: "off" },
    });
    const error = h("p", { cls: "menu-dialog-error", attrs: { role: "alert" }, hidden: true });
    const cancel = h("button", { cls: "btn", text: "Cancel", attrs: { type: "button" } });

    const form = h(
      "form",
      { cls: "menu-dialog drives-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": title } },
      h("h2", { cls: "menu-dialog-title", text: title }),
      h("div", { cls: "drives-bar" }, path, searchBox),
      list,
      status,
      save ? target : null,
      save ? h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "File name" }), nameBox) : null,
      error,
      h(
        "div",
        { cls: "menu-dialog-actions" },
        cancel,
        save ? h("button", { cls: "btn primary", text: "Save", attrs: { type: "submit" } }) : null,
      ),
    );
    const backdrop = h("div", { cls: "menu-dialog-backdrop" }, form);

    const finish = (result: Result | null): void => {
      backdrop.remove();
      returnFocus?.focus();
      resolve(result);
    };

    const folderPath = (): string => ["OneDrive", ...crumbs.slice(1).map((c) => c.name)].join(" › ");

    const showPath = (): void => {
      path.replaceChildren(
        ...crumbs.flatMap((c, i) => {
          const btn = h("button", { cls: "drives-crumb", text: c.name, attrs: { type: "button" } });
          btn.disabled = i === crumbs.length - 1 && query === null;
          btn.addEventListener("click", () => go(crumbs.slice(0, i + 1)));
          const sep = h("span", { cls: "drives-sep", text: "›", attrs: { "aria-hidden": "true" } });
          return i === 0 ? [btn] : [sep, btn];
        }),
      );
      if (save) target.textContent = `Saves into ${folderPath()}`;
    };

    const showItems = (): void => {
      const shown = items.filter((it) => it.folder || (!save && isDrawing(it.name)));
      list.replaceChildren(
        ...shown.map((it) => {
          const details = [query !== null ? it.location : "", it.folder ? "" : formatSize(it.size), formatWhen(it.modified)];
          const row = h(
            "button",
            { cls: "drives-row", attrs: { type: "button", title: it.name } },
            h("span", { cls: "drives-icon", html: it.folder ? ICON_FOLDER : ICON_FILE }),
            h("span", { cls: "drives-name-text", text: it.name }),
            h("span", { cls: "drives-meta", text: details.filter(Boolean).join(" · ") }),
          );
          row.addEventListener("click", () => activate(it));
          return row;
        }),
      );
      if (!status.textContent) {
        if (shown.length > 0) return;
        status.textContent =
          query !== null
            ? `Nothing matches “${query}”.`
            : save
              ? "This folder has no folders in it."
              : "This folder has no drawings or folders in it.";
      }
    };

    /** Loads the folder shown, or the search results, and draws them. */
    const load = async (): Promise<void> => {
      const mine = ++loadNo;
      const folder = crumbs.at(-1);
      if (!folder) return;
      status.textContent = "Loading…";
      list.replaceChildren();
      showPath();
      try {
        const found = query !== null ? await searchOneDrive(clientId, query) : await listFolder(clientId, folder.id);
        if (mine !== loadNo) return;
        items = found.sort(byKind);
        status.textContent = "";
      } catch (err) {
        if (mine !== loadNo) return;
        items = [];
        status.textContent = errorMessage(err);
      }
      showItems();
    };

    /** Shows a folder (and clears the search). */
    const go = (next: Crumb[]): void => {
      crumbs = next;
      query = null;
      searchBox.value = "";
      void load();
    };

    /** A click on a row: a folder is entered; a drawing is picked (Open) or a no-op (Save). */
    const activate = (it: OneDriveItem): void => {
      if (it.folder) {
        // a folder found by search has no path here, so the breadcrumbs start at the root
        const base = query !== null ? crumbs.slice(0, 1) : crumbs;
        go([...base, { id: it.id, name: it.name }]);
        return;
      }
      if (!save) finish({ item: it });
    };

    const submit = (e: Event): void => {
      e.preventDefault();
      if (!save) return;
      const folder = crumbs.at(-1);
      const named = drawingName(nameBox.value);
      if (!folder) {
        error.textContent = "OneDrive is still loading. Try again in a moment.";
        error.hidden = false;
        return;
      }
      if (!("name" in named)) {
        error.textContent = named.error;
        error.hidden = false;
        nameBox.focus();
        return;
      }
      finish({ target: { folderId: folder.id, folderPath: folderPath(), name: named.name } });
    };

    form.addEventListener("submit", submit);
    form.addEventListener("input", () => {
      error.hidden = true;
    });
    cancel.addEventListener("click", () => finish(null));

    searchBox.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      // Enter searches; it must not submit the form
      e.preventDefault();
      const text = searchBox.value.trim();
      query = text === "" ? null : text;
      void load();
    });
    searchBox.addEventListener("input", () => {
      if (searchBox.value === "" && query !== null) {
        query = null;
        void load();
      }
    });

    // every key stays inside the dialog, so the window shortcuts do not run under it
    backdrop.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      }
    });
    backdrop.addEventListener("pointerdown", (e) => {
      if (e.target === backdrop) finish(null);
    });

    document.body.append(backdrop);
    (save ? nameBox : searchBox).focus();

    rootId(clientId).then(
      (id) => {
        crumbs = [{ id, name: "OneDrive" }];
        void load();
      },
      (err: unknown) => {
        status.textContent = errorMessage(err);
      },
    );
  });
}
