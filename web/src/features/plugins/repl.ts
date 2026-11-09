// Tools > Plug-ins > Script Console…: a line-at-a-time REPL on the same API, in one persistent
// worker. A line that is an expression gives its value (printed as truncated JSON);
// anything else runs as the body of an async function. Up and Down walk the history.
// The panel floats and does not block the drawing, so a selection made in the
// drawing is there for openvwx.doc.selection().

import { h } from "../../app/dom.ts";
import { draftCalls, describe, memoryGrants } from "./host.ts";
import { PluginWorker, type PluginError } from "./worker.ts";

const NAME = "Script Console";
const grants = memoryGrants();

let panel: HTMLElement | null = null;
let output: HTMLElement | null = null;
let input: HTMLInputElement | null = null;
let worker: PluginWorker | null = null;
/** each line waits for the one before it */
let chain: Promise<void> = Promise.resolve();
const history: string[] = [];
let cursor = -1;

function write(kind: "in" | "result" | "log" | "warn" | "error" | "system", text: string, line: number | null = null): void {
  if (!output) return;
  const row = h("div", { cls: `pi-repl-line pi-${kind}` });
  if (line !== null) row.append(h("span", { cls: "pi-line-no", text: `Line ${line}` }));
  row.append(h("span", { cls: "pi-repl-text", text }));
  output.append(row);
  output.scrollTop = output.scrollHeight;
}

function ensureWorker(): PluginWorker {
  if (worker?.alive) return worker;
  const w: PluginWorker = new PluginWorker(null, {
    call: draftCalls(NAME, grants),
    log: (level, text, line) => write(level, text, line),
    // menu items belong to plug-ins, not to the console
    menu: () => undefined,
    uncaught: (err: PluginError) => write("error", describe(err), err.line),
  });
  worker = w;
  return w;
}

function submit(code: string): void {
  if (code.trim() === "") return;
  write("in", "› " + code);
  chain = chain.then(async () => {
    const outcome = await ensureWorker().evaluate(code);
    if (outcome.ok) {
      if (outcome.text !== undefined && outcome.text !== "undefined") write("result", outcome.text);
    } else if (outcome.error.name !== "Stopped") {
      write("error", describe(outcome.error));
    }
  });
}

function restart(): void {
  worker?.kill();
  worker = null;
  write("system", "Restarted. Variables from before are gone.");
}

/** Tools > Plug-ins > Script Console…: opens the panel, or brings it forward. */
export function openConsole(): void {
  if (!panel) build();
  if (panel) panel.hidden = false;
  input?.focus();
}

function build(): void {
  output = h("div", { cls: "pi-repl-output", attrs: { role: "log", "aria-live": "polite" } });
  input = h("input", {
    cls: "pi-repl-input",
    attrs: { type: "text", spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-label": "Script Console input", placeholder: "await openvwx.doc.info()" },
  });
  const clearBtn = h("button", { cls: "pi-link", text: "Clear", attrs: { type: "button" } });
  const restartBtn = h("button", { cls: "pi-link", text: "Restart", attrs: { type: "button", title: "Stop the worker and forget its variables" } });
  const closeBtn = h("button", { cls: "pi-link pi-close", text: "×", attrs: { type: "button", "aria-label": "Close the Script Console" } });
  panel = h(
    "div",
    { cls: "pi-repl", attrs: { role: "dialog", "aria-label": "Script Console" } },
    h("div", { cls: "pi-repl-head" }, h("span", { cls: "pi-repl-title", text: "Script Console" }), h("span", { cls: "pi-spacer" }), clearBtn, restartBtn, closeBtn),
    output,
    h("div", { cls: "pi-repl-row" }, h("span", { cls: "pi-repl-prompt", text: "›" }), input),
  );
  document.body.append(panel);
  write("system", "Each line runs with the plug-in API: openvwx.doc, openvwx.edit, openvwx.ui. Up and Down show earlier lines.");

  clearBtn.addEventListener("click", () => output?.replaceChildren());
  restartBtn.addEventListener("click", restart);
  closeBtn.addEventListener("click", () => {
    if (panel) panel.hidden = true;
  });
  input.addEventListener("keydown", (e) => {
    // the window's shortcuts stay out of the console
    e.stopPropagation();
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      const line = input?.value ?? "";
      if (line.trim() !== "") {
        if (history[history.length - 1] !== line) history.push(line);
      }
      cursor = -1;
      if (input) input.value = "";
      submit(line);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      cursor = cursor < 0 ? history.length - 1 : Math.max(0, cursor - 1);
      if (input) input.value = history[cursor];
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (cursor < 0) return;
      cursor++;
      if (cursor >= history.length) {
        cursor = -1;
        if (input) input.value = "";
      } else if (input) input.value = history[cursor];
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (panel) panel.hidden = true;
    }
  });
}
