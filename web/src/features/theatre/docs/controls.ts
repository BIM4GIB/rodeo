// What the Stage paperwork windows share: a row of toggle buttons, and printing an HTML document from a hidden
// frame the way File > Print prints a PDF (exportDialog.ts), so the sheet never shows in the window.

import { h } from "../../../app/dom.ts";
import { toast } from "../../../app/toast.ts";
import "./docs.css";

/** how long the print frame lives after printing starts: the print dialog may still read it */
const RELEASE_MS = 60000;
/** how long the frame may take to load before printing gives up */
const LOAD_MS = 15000;

export interface Choice<T extends string> {
  readonly value: T;
  readonly label: string;
}

/** A row of toggles with one on, `value` at first; picking one calls `onPick` with its value. */
export function segmented<T extends string>(choices: readonly Choice<T>[], value: T, onPick: (v: T) => void): HTMLElement {
  let current = value;
  const buttons = choices.map((c) => ({ value: c.value, el: h("button", { cls: "th-tab", text: c.label, attrs: { type: "button" } }) }));
  const paint = (): void => {
    for (const b of buttons) {
      b.el.classList.toggle("on", b.value === current);
      b.el.setAttribute("aria-pressed", String(b.value === current));
    }
  };
  for (const b of buttons) {
    b.el.addEventListener("click", () => {
      current = b.value;
      paint();
      onPick(b.value);
    });
  }
  paint();
  return h("div", { cls: "th-tabs", attrs: { role: "group" } }, ...buttons.map((b) => b.el));
}

/** Prints an HTML document from a hidden frame; the browser's print dialog opens for it. */
export function printDocument(html: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const frame = h("iframe", { cls: "docs-print-frame", attrs: { src: url, title: "Print" } });
  const release = (): void => {
    window.setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, RELEASE_MS);
  };
  // set once either route has started, so the load and the timeout never both print
  let started = false;
  frame.addEventListener(
    "load",
    () => {
      if (started) return;
      started = true;
      try {
        const win = frame.contentWindow;
        if (!win) throw new Error("the print frame has no window");
        win.focus();
        win.print();
      } catch {
        toast("The sheet could not be printed from here. Export the HTML and print that.", "error");
      }
      release();
    },
    { once: true },
  );
  window.setTimeout(() => {
    if (started) return;
    started = true;
    frame.remove();
    URL.revokeObjectURL(url);
    toast("The print sheet did not load in time, so nothing was printed.", "error");
  }, LOAD_MS);
  document.body.append(frame);
}
