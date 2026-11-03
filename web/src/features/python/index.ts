// Python scripts: Run Script… (the Plug-ins menu, and Tools > Plug-ins where Vectorworks keeps it)
// opens a window that runs Python or Vectorscript written for Vectorworks on the open drawing.
// File > Import > Import Script… runs a script file in it; File > Export > Export Script writes the
// drawing as a Vectorscript that draws it again. Python and the window load when first asked for.
// Window > Script Palettes keeps named palettes of scripts to run with a double-click (scriptPalettes.ts).

import { registerMenu, registerPalette } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { h } from "../../app/dom.ts";
import { store } from "../../app/state.ts";
import { openManager } from "../plugins/manager.ts";
import { openConsole } from "../plugins/repl.ts";
import { SCRIPT_PALETTES, scriptPaletteMenuRows, scriptPalettesBody, scriptPalettesMenu } from "./scriptPalettes.ts";
import "./python.css";

/** a page of code: the script palettes */
const SCRIPTS_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h5"/><path d="M10.5 12l-2 2 2 2M14.5 12l2 2-2 2"/></svg>';

registerPalette({ id: SCRIPT_PALETTES, title: "Script Palettes", side: "right", icon: SCRIPTS_ICON, hidden: true, body: scriptPalettesBody(), menu: scriptPalettesMenu });
registerMenu("Window", (): Row[] => [{ label: "Script Palettes", items: scriptPaletteMenuRows }]);

const runScript = (): void => void import("./panel.ts").then((m) => m.openRunScript());
const run: Row = { label: "Run Script…", enabled: () => !!store.session, run: runScript };

registerMenu("Plug-ins", () => [run], { after: "Script Console…" });

/** Asks for a .vs, .px or .py file and runs it in the Run Script window. */
function importScript(): void {
  const input = h("input", { attrs: { type: "file", accept: ".vs,.px,.py,.txt,text/x-python,text/plain" } });
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (!f) return;
    void Promise.all([f.text(), import("./panel.ts")]).then(([text, m]) => m.runScriptFile(f.name, text));
  });
  input.click();
}

registerMenu("File › Import", () => [{ label: "Import Script…", enabled: () => !!store.session, run: importScript }], { after: "Import Worksheet…" });
registerMenu(
  "File › Export",
  () => [{ label: "Export Script", enabled: () => !!store.session, run: () => void import("./exportScript.ts").then((m) => m.exportScript()) }],
  { after: "Export Database…" },
);

registerMenu("Tools", () => [
  {
    label: "Plug-ins",
    items: [run, { label: "Plug-in Manager…", run: openManager }, { label: "Script Console…", run: openConsole }],
  },
]);
