// The Run Script window: a Python script or a Vectorscript to edit, open from a file or save as
// one, run on the open drawing (⌘↩) and stop; what it prints and how it ended show under it. The
// script and its file name are kept in this browser. The window floats, so the drawing stays usable
// beside it.

import { h } from "../../app/dom.ts";
import { isVectorscript, runScript, scriptRunning, stopScript } from "./runner.ts";
import { VS_SOURCE } from "./vsModule.ts";

const KEY = "openvwx.pythonScript";

const EXAMPLE = `# A Python script as Vectorworks runs them: import vs and call it on the open drawing.
# Run (Cmd+Return) applies what the script changes as one undo step.
import vs

step = vs.GetUnits()[3] * 40  # 40 inches in the drawing's units
vs.FillPat(0)
for i in range(5):
    x = i * step
    vs.Oval(x - step / 4, step / 4, x + step / 4, -step / 4)
vs.Message("Drew 5 circles")
`;

interface Kept {
  code: string;
  file: string;
}

function load(): Kept {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<Kept>;
      if (typeof v.code === "string") return { code: v.code, file: typeof v.file === "string" && v.file ? v.file : "script.py" };
    }
  } catch {
    // storage blocked: the example, for this visit
  }
  return { code: EXAMPLE, file: "script.py" };
}

function keep(k: Kept): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(k));
  } catch {
    // storage blocked: kept for this visit only
  }
}

let panel: HTMLElement | null = null;
let code: HTMLTextAreaElement | null = null;
let output: HTMLElement | null = null;
let fileLabel: HTMLElement | null = null;
let runBtn: HTMLButtonElement | null = null;
let stopBtn: HTMLButtonElement | null = null;
let file = "script.py";

function write(kind: "print" | "warn" | "error" | "system" | "result", text: string, line: number | null = null): void {
  if (!output) return;
  const row = h("div", { cls: `pi-repl-line pi-${kind === "print" ? "log" : kind}` });
  if (line !== null) {
    const go = h("button", { cls: "pi-line-no", text: `Line ${line}`, attrs: { type: "button", title: "Go to the line" } });
    go.addEventListener("click", () => goToLine(line));
    row.append(go);
  }
  row.append(h("span", { cls: "pi-repl-text", text: text.replace(/\n$/, "") }));
  output.append(row);
  output.scrollTop = output.scrollHeight;
}

/** The vs calls the module has, as Vectorworks names them. */
function listCalls(): void {
  const names = [...VS_SOURCE.matchAll(/^def ([A-Z]\w*)\(/gm)].map((m) => m[1]);
  names.push("GetType");
  names.sort();
  write("system", `${names.length} vs calls: ${names.join(", ")}. Handles also have .type, .name, .next, .prev, .parent and .selected. A Vectorscript calls them by the same names, without vs.`);
}

function goToLine(line: number): void {
  if (!code) return;
  const lines = code.value.split("\n");
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  code.focus();
  code.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
}

function setRunning(on: boolean): void {
  if (runBtn) runBtn.disabled = on;
  if (stopBtn) stopBtn.hidden = !on;
}

async function run(): Promise<void> {
  if (!code || scriptRunning()) return;
  keep({ code: code.value, file });
  setRunning(true);
  write("system", `Running ${file}${isVectorscript(code.value, file) ? " (Vectorscript)" : ""}…`);
  try {
    const outcome = await runScript(code.value, file, { print: (kind, text) => write(kind, text) });
    if (outcome.error) {
      write("error", outcome.error.name === "Stopped" || outcome.error.name === "Busy" ? outcome.error.message : `${outcome.error.name}: ${outcome.error.message}`, outcome.error.line);
    } else {
      write("result", outcome.steps > 0 ? `Done: ${outcome.steps} ${outcome.steps === 1 ? "change" : "changes"}, one undo step.` : "Done: the drawing wasn't changed.");
    }
  } finally {
    setRunning(false);
  }
}

function openFile(): void {
  const input = h("input", { attrs: { type: "file", accept: ".py,.vs,.px,.txt,text/x-python,text/plain" } });
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (!f) return;
    void f.text().then((text) => {
      if (!code) return;
      code.value = text;
      file = f.name;
      if (fileLabel) fileLabel.textContent = file;
      keep({ code: text, file });
      write("system", `Opened ${f.name}${isVectorscript(text, f.name) ? " (Vectorscript)" : ""}.`);
    });
  });
  input.click();
}

function saveFile(): void {
  if (!code) return;
  // a Vectorscript is saved as .vs, anything else as .py
  const ext = isVectorscript(code.value, file) ? (/\.(vs|px)$/i.test(file) ? "" : ".vs") : /\.py$/i.test(file) ? "" : ".py";
  const url = URL.createObjectURL(new Blob([code.value], { type: "text/plain" }));
  const a = h("a", { attrs: { href: url, download: ext ? `${file.replace(/\.[^.]*$/, "")}${ext}` : file } });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File > Import > Import Script…: the script of a file in the window, run on the drawing. */
export function runScriptFile(name: string, text: string): void {
  openRunScript();
  if (!code) return;
  code.value = text;
  file = name;
  if (fileLabel) fileLabel.textContent = file;
  keep({ code: text, file });
  write("system", `Opened ${name}${isVectorscript(text, name) ? " (Vectorscript)" : ""}.`);
  void run();
}

/** Plug-ins > Run Script…: opens the window, or brings it forward. */
export function openRunScript(): void {
  if (!panel) build();
  if (panel) panel.hidden = false;
  code?.focus();
}

function build(): void {
  const kept = load();
  file = kept.file;
  output = h("div", { cls: "pi-repl-output py-output", attrs: { role: "log", "aria-live": "polite" } });
  code = h("textarea", {
    cls: "py-code",
    attrs: { spellcheck: "false", autocapitalize: "off", autocomplete: "off", wrap: "off", "aria-label": "Script" },
  });
  code.value = kept.code;
  fileLabel = h("span", { cls: "py-file", text: file });
  const openBtn = h("button", { cls: "pi-link", text: "Open…", attrs: { type: "button", title: "Open a .py or .vs file" } });
  const saveBtn = h("button", { cls: "pi-link", text: "Save", attrs: { type: "button", title: "Save the script as a .py or .vs file" } });
  const callsBtn = h("button", { cls: "pi-link", text: "Calls", attrs: { type: "button", title: "List the vs calls Rodeo has" } });
  runBtn = h("button", { cls: "btn small primary", text: "Run", attrs: { type: "button", title: "Run the script on the drawing (⌘↩)" } });
  stopBtn = h("button", { cls: "btn small", text: "Stop", attrs: { type: "button", title: "Stop the script: nothing is changed" }, hidden: true });
  const closeBtn = h("button", { cls: "pi-link pi-close", text: "×", attrs: { type: "button", "aria-label": "Close Run Script" } });
  panel = h(
    "div",
    { cls: "pi-repl py-panel", attrs: { role: "dialog", "aria-label": "Run Script" } },
    h("div", { cls: "pi-repl-head" }, h("span", { cls: "pi-repl-title", text: "Run Script" }), fileLabel, h("span", { cls: "pi-spacer" }), callsBtn, openBtn, saveBtn, stopBtn, runBtn, closeBtn),
    code,
    output,
  );
  document.body.append(panel);
  write("system", "Python with Vectorworks' vs module, or a Vectorscript: what the script changes is applied when it ends, as one undo step.");

  callsBtn.addEventListener("click", listCalls);
  openBtn.addEventListener("click", openFile);
  saveBtn.addEventListener("click", saveFile);
  runBtn.addEventListener("click", () => void run());
  stopBtn.addEventListener("click", stopScript);
  closeBtn.addEventListener("click", () => {
    if (panel) panel.hidden = true;
  });
  code.addEventListener("input", () => {
    if (code) keep({ code: code.value, file });
  });
  panel.addEventListener("keydown", (e) => {
    // the window's shortcuts stay out of the script
    e.stopPropagation();
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (panel) panel.hidden = true;
    } else if (e.key === "Tab" && e.target === code && code && !e.metaKey && !e.ctrlKey && !e.altKey) {
      // a tab indents, as Python wants: four spaces
      e.preventDefault();
      if (!e.shiftKey) code.setRangeText("    ", code.selectionStart, code.selectionEnd, "end");
    }
  });
}
