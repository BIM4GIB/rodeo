// Tools > Utilities > List Symbols…, as the Vectorworks command does: a text file of the drawing's
// symbol folders, each with its definitions or the folders alone, saved where the browser saves
// downloads. A folder's contents are indented a tab under it, folders before definitions, each by
// name.

import { downloadBlob } from "./fileio.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

interface Folder {
  readonly folders: Map<string, Folder>;
  readonly symbols: string[];
}

const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The lines of the list: a folder's name ending in "/", what it holds a tab further in. */
export function symbolListText(defs: readonly { readonly name: string; readonly folder: string }[], foldersOnly: boolean): string {
  const root: Folder = { folders: new Map(), symbols: [] };
  for (const d of defs) {
    let at = root;
    for (const part of d.folder.split("/").filter(Boolean)) {
      let next = at.folders.get(part);
      if (!next) {
        next = { folders: new Map(), symbols: [] };
        at.folders.set(part, next);
      }
      at = next;
    }
    at.symbols.push(d.name);
  }
  const lines: string[] = [];
  const walk = (f: Folder, depth: number): void => {
    const indent = "\t".repeat(depth);
    for (const name of [...f.folders.keys()].sort(byName)) {
      lines.push(`${indent}${name}/`);
      walk(f.folders.get(name) as Folder, depth + 1);
    }
    if (!foldersOnly) for (const name of [...f.symbols].sort(byName)) lines.push(`${indent}${name}`);
  };
  walk(root, 0);
  return lines.join("\n") + "\n";
}

/** Opens List Symbols and saves the list. */
export async function listSymbolsDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const defs = doc.resources().filter((r) => r.kind === "symbol");
  if (defs.length === 0) {
    toast("This drawing has no symbol definitions.", "info");
    return;
  }
  const radio = (label: string, on: boolean): [HTMLInputElement, HTMLElement] => {
    const input = h("input", { checked: on, attrs: { type: "radio", name: "list-symbols" } });
    return [input, h("label", { cls: "menu-dialog-check" }, input, label)];
  };
  const [both, bothRow] = radio("List symbols and folders", true);
  const [, foldersRow] = radio("List folders only", false);
  const foldersOnly = await showDialog<boolean>({
    title: "List Symbols",
    okLabel: "Save",
    body: [h("p", { cls: "muted", text: `${defs.length} symbol definition${defs.length === 1 ? "" : "s"}, saved as a text file.` }), bothRow, foldersRow],
    check: () => ({ value: !both.checked }),
  });
  if (foldersOnly === null) return;
  const name = `${store.fileName.replace(/\.vwx$/i, "")} symbols.txt`;
  downloadBlob(name, new Blob([symbolListText(defs, foldersOnly)], { type: "text/plain" }));
}
