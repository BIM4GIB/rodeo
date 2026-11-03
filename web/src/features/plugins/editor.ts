// The plug-in editor: a code area with a line-number gutter, a console pane for
// what the code logs and the errors it raises (with their line numbers), Run and
// Stop with the elapsed time, and Save. Run uses the code as it is in the text
// area, saved or not; Save stores it and starts the plug-in again when it is on.

import { h } from "../../app/dom.ts";
import { shortcutText } from "../../app/menu.ts";
import { confirmDialog } from "../../app/menubar.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { headerTemplate, parseHeader } from "./header.ts";
import { grantsFor, memoryGrants, newRecord, runPlugin, savePluginRecord, type RunHandle, type RunResult } from "./host.ts";
import { openHelp } from "./help.ts";
import { type PluginRecord } from "./store.ts";
import type { LogLevel } from "./worker.ts";

/** What a new plug-in starts with. */
export function starterCode(): string {
  return (
    headerTemplate("New Plug-in") +
    [
      "// Run (" + shortcutText("⌘↩") + ") runs this code once. Menu items it adds with openvwx.menu.add",
      "// appear in the Plug-ins menu once the plug-in is turned on.",
      'openvwx.menu.add("Say Hello", async () => {',
      "  const selected = await openvwx.doc.selection();",
      '  await openvwx.ui.alert("Hello", "You have " + selected.length + " objects selected.");',
      "});",
      "",
    ].join("\n")
  );
}

interface Options {
  /** the saved plug-in to edit, or null for a new one */
  readonly record: PluginRecord | null;
  /** run the code as soon as the editor opens (Run in the Manager) */
  readonly autoRun?: boolean;
  /** called after a save, so the Manager can list the change */
  readonly onSaved?: () => void;
}

let open: HTMLElement | null = null;

/** Opens the editor on a plug-in (or a new one). One editor is open at a time: a second one replaces it. */
export function openEditor(opts: Options): void {
  if (open) {
    open.remove();
    open = null;
  }
  const editor = new Editor(opts);
  open = editor.root;
  editor.mount();
  if (opts.autoRun) editor.run();
}

const LINE_HEIGHT_PX = 18;

class Editor {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly elapsed: HTMLElement;
  private readonly text: HTMLTextAreaElement;
  private readonly gutter: HTMLElement;
  private readonly pane: HTMLElement;
  private readonly runBtn: HTMLButtonElement;
  private readonly stopBtn: HTMLButtonElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly helpBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private record: PluginRecord | null;
  private saved: string;
  private handle: RunHandle | null = null;
  private startedAt = 0;
  private timer = 0;
  private lines = 0;
  private closed = false;
  private readonly onSaved: (() => void) | undefined;

  constructor(opts: Options) {
    this.record = opts.record;
    this.onSaved = opts.onSaved;
    this.saved = opts.record ? opts.record.code : starterCode();
    this.title = h("h2", { cls: "menu-dialog-title pi-editor-title" });
    this.status = h("span", { cls: "pi-status" });
    this.elapsed = h("span", { cls: "pi-elapsed", text: "" });
    this.gutter = h("div", { cls: "pi-gutter", attrs: { "aria-hidden": "true" } });
    this.text = h("textarea", {
      cls: "pi-text",
      attrs: { spellcheck: "false", autocapitalize: "off", autocomplete: "off", wrap: "off", "aria-label": "Plug-in code" },
    });
    this.text.value = this.saved;
    this.pane = h("div", { cls: "pi-console-lines", attrs: { role: "log", "aria-live": "polite" } });
    this.runBtn = h("button", { cls: "btn primary", text: "Run", attrs: { type: "button", title: `Run (${shortcutText("⌘↩")})` } });
    this.stopBtn = h("button", { cls: "btn", text: "Stop", attrs: { type: "button" }, disabled: true });
    this.saveBtn = h("button", { cls: "btn", text: "Save", attrs: { type: "button", title: `Save (${shortcutText("⌘S")})` } });
    this.helpBtn = h("button", { cls: "btn", text: "Help", attrs: { type: "button" } });
    this.closeBtn = h("button", { cls: "btn", text: "Close", attrs: { type: "button" } });
    this.clearBtn = h("button", { cls: "pi-link", text: "Clear", attrs: { type: "button" } });
    this.root = h(
      "div",
      { cls: "pi-editor-backdrop menu-dialog-backdrop" },
      h(
        "div",
        { cls: "menu-dialog pi-editor", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Plug-in editor" } },
        h("div", { cls: "pi-editor-head" }, this.title, this.status, this.elapsed),
        h(
          "div",
          { cls: "pi-code" },
          this.gutter,
          this.text,
        ),
        h(
          "div",
          { cls: "pi-console" },
          h("div", { cls: "pi-console-head" }, h("span", { text: "Console" }), this.clearBtn),
          this.pane,
        ),
        h(
          "div",
          { cls: "menu-dialog-actions pi-editor-foot" },
          this.helpBtn,
          h("span", { cls: "pi-spacer" }),
          this.stopBtn,
          this.runBtn,
          this.saveBtn,
          this.closeBtn,
        ),
      ),
    );
    this.wire();
    this.renderHead();
    this.renderGutter();
  }

  mount(): void {
    document.body.append(this.root);
    this.text.focus();
    this.text.setSelectionRange(0, 0);
  }

  private wire(): void {
    this.helpBtn.addEventListener("click", () => openHelp());
    this.closeBtn.addEventListener("click", () => void this.close());
    this.clearBtn.addEventListener("click", () => this.pane.replaceChildren());
    this.runBtn.addEventListener("click", () => this.run());
    this.stopBtn.addEventListener("click", () => this.stop());
    this.saveBtn.addEventListener("click", () => void this.save());

    this.text.addEventListener("input", () => {
      this.renderGutter();
      this.renderHead();
    });
    this.text.addEventListener("scroll", () => {
      this.gutter.scrollTop = this.text.scrollTop;
    });
    this.text.addEventListener("keydown", (e) => this.onKey(e));
    // every key stays in the editor, so the window's shortcuts do not run under it
    this.root.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        void this.close(); // unsaved changes are asked about first
      }
    });
    this.root.addEventListener("pointerdown", (e) => {
      if (e.target === this.root) void this.close();
    });
    this.pane.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-line]");
      if (btn) this.goToLine(Number(btn.dataset.line));
    });
  }

  private onKey(e: KeyboardEvent): void {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      this.insert("  ");
    } else if (mod && e.key === "Enter") {
      e.preventDefault();
      this.run();
    } else if (mod && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      void this.save();
    }
  }

  /** Inserts text at the caret, keeping the browser's undo history where it can. */
  private insert(s: string): void {
    const ok = document.execCommand?.("insertText", false, s);
    if (!ok) {
      const { selectionStart: a, selectionEnd: b, value } = this.text;
      this.text.value = value.slice(0, a) + s + value.slice(b);
      this.text.setSelectionRange(a + s.length, a + s.length);
      this.text.dispatchEvent(new Event("input"));
    }
  }

  private dirty(): boolean {
    return this.text.value !== this.saved;
  }

  private renderHead(): void {
    const header = parseHeader(this.text.value);
    this.title.textContent = header.name;
    this.status.textContent = this.dirty() ? "Unsaved changes" : this.record ? "Saved" : "Not saved yet";
    this.status.classList.toggle("dirty", this.dirty());
  }

  private renderGutter(): void {
    const n = this.text.value.split("\n").length;
    if (n === this.lines) return;
    this.lines = n;
    let out = "";
    for (let i = 1; i <= n; i++) out += i + "\n";
    this.gutter.textContent = out.slice(0, -1);
  }

  private goToLine(line: number): void {
    const lines = this.text.value.split("\n");
    if (!Number.isFinite(line) || line < 1 || line > lines.length) return;
    let start = 0;
    for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
    this.text.focus();
    this.text.setSelectionRange(start, start + lines[line - 1].length);
    this.text.scrollTop = Math.max(0, (line - 3) * LINE_HEIGHT_PX);
    this.gutter.scrollTop = this.text.scrollTop;
  }

  private log(level: LogLevel | "system", text: string, line: number | null = null): void {
    const row = h("div", { cls: `pi-line pi-${level}` });
    if (line !== null) row.append(h("button", { cls: "pi-line-no", text: `Line ${line}`, attrs: { type: "button", "data-line": String(line) } }));
    row.append(h("span", { cls: "pi-line-text", text }));
    this.pane.append(row);
    this.pane.scrollTop = this.pane.scrollHeight;
  }

  private tick(): void {
    this.elapsed.textContent = formatElapsed(performance.now() - this.startedAt);
  }

  private setRunning(on: boolean): void {
    this.runBtn.disabled = on;
    this.stopBtn.disabled = !on;
    this.root.classList.toggle("running", on);
  }

  run(): void {
    if (this.handle || this.closed) return;
    const code = this.text.value;
    const header = parseHeader(code);
    this.log("system", `Running ${header.name}.`);
    this.setRunning(true);
    this.startedAt = performance.now();
    this.tick();
    this.timer = window.setInterval(() => this.tick(), 100);
    // a saved plug-in's grants live on its record; a new one's last until the page reloads
    const grants = this.record ? grantsFor(this.record) : memoryGrants();
    const handle = runPlugin({
      name: header.name,
      code,
      grants,
      invokeMenus: true,
      sink: { log: (level, text, line) => this.log(level, text, line) },
    });
    this.handle = handle;
    void handle.finished.then((result) => this.finish(result));
  }

  stop(): void {
    this.handle?.stop();
  }

  private finish(result: RunResult): void {
    this.handle = null;
    window.clearInterval(this.timer);
    this.setRunning(false);
    const secs = formatElapsed(performance.now() - this.startedAt);
    this.elapsed.textContent = secs;
    if (result.stopped) this.log("system", `Stopped after ${secs}.`);
    else if (result.ok) this.log("system", `Finished in ${secs}${result.menuItems ? `; ${result.menuItems} menu item${result.menuItems === 1 ? "" : "s"} added` : ""}.`);
    else this.log("system", `Stopped with an error after ${secs}.`);
    if (this.closed) this.root.remove();
  }

  async save(): Promise<void> {
    const code = this.text.value;
    try {
      const rec = this.record ? { ...this.record, code } : newRecord(code);
      await savePluginRecord(rec);
      this.record = rec;
      this.saved = code;
      this.renderHead();
      this.log("system", `Saved ${rec.name}${rec.enabled ? ", and started it again." : "."}`);
      this.onSaved?.();
    } catch (err) {
      toast(`Could not save the plug-in: ${errorMessage(err)}`);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    if (this.dirty()) {
      const discard = await confirmDialog("Discard changes?", "The code changed since it was last saved. The changes are lost.", "Discard");
      if (!discard) return;
    }
    this.closed = true;
    this.handle?.stop();
    window.clearInterval(this.timer);
    if (open === this.root) open = null;
    this.root.remove();
  }
}

/** 0.0 s, or m:ss.s past a minute. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`;
}
