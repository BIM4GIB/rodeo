// Plug-ins > Plug-in Manager…: the installed plug-ins, each with its on/off switch,
// its menu items or load error, and Run, Edit, Export and Delete; plus New Plug-in,
// Import… (a .js file, shown with its header and a warning before it installs) and Help.

import { h } from "../../app/dom.ts";
import { confirmDialog, showDialog } from "../../app/menubar.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { parseHeader } from "./header.ts";
import { openEditor } from "./editor.ts";
import { openHelp } from "./help.ts";
import { activeState, describe as describeError, displayName, installed, newRecord, onPluginsChanged, removePlugin, savePluginRecord, setEnabled } from "./host.ts";
import { storageKind, type PluginRecord } from "./store.ts";

const WARNING = "Plug-ins run code you didn't write. Only install ones you trust.";
const MAX_IMPORT_BYTES = 1024 * 1024;

let managerEl: HTMLElement | null = null;
let stopListening: (() => void) | null = null;

/** Opens the Manager (or brings it back to the front). */
export function openManager(): void {
  if (managerEl) {
    managerEl.remove();
    managerEl = null;
  }
  const panel = new Manager();
  managerEl = panel.root;
  document.body.append(panel.root);
  panel.render();
  stopListening?.();
  stopListening = onPluginsChanged(() => panel.render());
}

class Manager {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly foot: HTMLElement;

  constructor() {
    this.list = h("div", { cls: "pi-list", attrs: { role: "list" } });
    this.foot = h("div", { cls: "pi-manager-note muted" });
    const newBtn = h("button", { cls: "btn", text: "New Plug-in…", attrs: { type: "button" } });
    const importBtn = h("button", { cls: "btn", text: "Import…", attrs: { type: "button" } });
    const helpBtn = h("button", { cls: "btn", text: "Help", attrs: { type: "button" } });
    const doneBtn = h("button", { cls: "btn primary", text: "Done", attrs: { type: "button" } });
    const box = h(
      "div",
      { cls: "menu-dialog pi-manager", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Plug-in Manager" } },
      h("h2", { cls: "menu-dialog-title", text: "Plug-ins" }),
      h("p", { cls: "pi-note", text: WARNING }),
      this.list,
      h("div", { cls: "pi-manager-actions" }, newBtn, importBtn, helpBtn, h("span", { cls: "pi-spacer" }), doneBtn),
      this.foot,
    );
    newBtn.addEventListener("click", () => this.edit(null));
    importBtn.addEventListener("click", () => this.importFile());
    helpBtn.addEventListener("click", () => void openHelp());
    doneBtn.addEventListener("click", () => this.close());
    this.root = h("div", { cls: "menu-dialog-backdrop pi-manager-backdrop" }, box);
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) this.close();
    });
    // every key stays in the Manager, so the window's shortcuts do not run under it
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        this.close();
      }
    });
    void storageKind().then((kind) => {
      const where = kind === "indexeddb" ? "in this browser (IndexedDB)" : kind === "localstorage" ? "in this browser (localStorage)" : "for this visit only (storage is blocked)";
      this.foot.textContent = `Stored ${where}. Nothing leaves this computer.`;
    });
  }

  close(): void {
    stopListening?.();
    stopListening = null;
    this.root.remove();
    if (managerEl === this.root) managerEl = null;
  }

  render(): void {
    const plugins = installed();
    if (plugins.length === 0) {
      this.list.replaceChildren(h("p", { cls: "pi-empty muted", text: "No plug-ins yet. Start a New Plug-in, or Import… a .js file." }));
      return;
    }
    this.list.replaceChildren(...plugins.map((rec) => this.row(rec)));
  }

  private row(rec: PluginRecord): HTMLElement {
    const state = activeState(rec.id);
    const toggle = h("input", { attrs: { type: "checkbox", "aria-label": `Enable ${displayName(rec)}` }, checked: rec.enabled });
    toggle.addEventListener("change", () => {
      toggle.disabled = true;
      void setEnabled(rec.id, toggle.checked).catch((err: unknown) => toast(`Could not change ${displayName(rec)}: ${errorMessage(err)}`));
    });
    const meta = [rec.version ? "v" + rec.version : "", rec.author].filter((x) => x !== "").join(" · ");
    return h(
      "div",
      { cls: `pi-row${rec.enabled ? "" : " off"}`, attrs: { role: "listitem" } },
      h("label", { cls: "pi-switch", attrs: { title: rec.enabled ? "On" : "Off" } }, toggle),
      h(
        "div",
        { cls: "pi-row-main" },
        h(
          "div",
          { cls: "pi-row-title" },
          h("span", { cls: "pi-row-name", text: displayName(rec) }),
          meta ? h("span", { cls: "pi-row-meta muted", text: meta }) : null,
        ),
        rec.description ? h("div", { cls: "pi-row-desc muted", text: rec.description }) : null,
        h("div", { cls: `pi-row-status${state.error ? " error" : ""}`, text: statusText(rec, state) }),
      ),
      h(
        "div",
        { cls: "pi-row-actions" },
        this.action("Run", () => this.run(rec)),
        this.action("Edit", () => this.edit(rec)),
        this.action("Export", () => exportFile(rec)),
        this.action("Delete", () => void this.remove(rec)),
      ),
    );
  }

  private action(label: string, run: () => void): HTMLButtonElement {
    const btn = h("button", { cls: "btn pi-small", text: label, attrs: { type: "button" } });
    btn.addEventListener("click", run);
    return btn;
  }

  private run(rec: PluginRecord): void {
    openEditor({ record: rec, autoRun: true, onSaved: () => this.render() });
  }

  private edit(rec: PluginRecord | null): void {
    openEditor({ record: rec, onSaved: () => this.render() });
  }

  private async remove(rec: PluginRecord): Promise<void> {
    const name = displayName(rec);
    const ok = await confirmDialog("Delete " + name + "?", "Its code is removed from this browser. Export it first to keep a copy.", "Delete");
    if (!ok) return;
    try {
      await removePlugin(rec.id);
    } catch (err) {
      toast(`Could not delete ${name}: ${errorMessage(err)}`);
    }
  }

  private importFile(): void {
    const input = h("input", { attrs: { type: "file", accept: ".js,.mjs,text/javascript", "aria-label": "Plug-in file" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void this.readImport(file);
    });
    input.click();
  }

  private async readImport(file: File): Promise<void> {
    if (file.size > MAX_IMPORT_BYTES) {
      toast("That file is too large to be a plug-in (over 1 MB).");
      return;
    }
    let code: string;
    try {
      code = await file.text();
    } catch (err) {
      toast(`Could not read ${file.name}: ${errorMessage(err)}`);
      return;
    }
    const header = parseHeader(code);
    const install = await showDialog<true>({
      title: "Import Plug-in",
      okLabel: "Install",
      cls: "pi-dialog",
      body: [
        h("p", { cls: "pi-import-name", text: header.name }),
        header.description ? h("p", { cls: "muted", text: header.description }) : null,
        h("p", { cls: "muted", text: [header.version ? "v" + header.version : "", header.author].filter(Boolean).join(" · ") || file.name }),
        h("p", { cls: "pi-warning", text: WARNING }),
        h("p", { cls: "muted", text: "It is installed turned off. Turn it on in the Manager to use its menu items." }),
      ].filter((n): n is HTMLParagraphElement => n !== null),
      check: () => ({ value: true }),
    });
    if (!install) return;
    try {
      const rec = newRecord(code);
      await savePluginRecord(rec);
      toast(`Installed ${rec.name}, turned off.`, "info");
    } catch (err) {
      toast(`Could not install ${header.name}: ${errorMessage(err)}`);
    }
  }
}

function statusText(rec: PluginRecord, state: ReturnType<typeof activeState>): string {
  if (!rec.enabled) return "Off";
  if (state.error) return `Did not start${state.error.line ? " (line " + state.error.line + ")" : ""}: ${describeError(state.error)}`;
  if (!state.loaded) return "Starting…";
  if (state.menus.length === 0) return "On. No menu items.";
  return "On. Menu: " + state.menus.map((m) => m.label).join(", ");
}

/** Export: the plug-in's code as a .js file the user downloads. */
function exportFile(rec: PluginRecord): void {
  const name = (rec.name || "plug-in").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "plug-in";
  const url = URL.createObjectURL(new Blob([rec.code], { type: "text/javascript" }));
  const a = h("a", { attrs: { href: url, download: name + ".js" } });
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
