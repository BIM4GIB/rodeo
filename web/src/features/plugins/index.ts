// Plug-ins: JavaScript plug-ins users write, run, save and share, each in its own
// Web Worker with the openvwx API (see API.md). Registers the Plug-ins menu, the
// Window and Help rows, and starts the enabled plug-ins once the editor is ready.

import { onReady, registerMenu } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { attachEditor, loadInstalled, menuItemRows } from "./host.ts";
import { openConsole } from "./repl.ts";
import { openManager } from "./manager.ts";
import { openHelp } from "./help.ts";
import "./plugins.css";

registerMenu("Plug-ins", () => {
  const items: Row[] = menuItemRows();
  return [...items, ...(items.length > 0 ? (["-"] as Row[]) : []), { label: "Plug-in Manager…", run: openManager }, { label: "Script Console…", run: openConsole }];
});

registerMenu("Window", (): Row[] => [
  { label: "Plug-in Manager…", run: openManager },
  { label: "Script Console…", run: openConsole },
]);

registerMenu("Help", (): Row[] => [{ label: "Plug-in API…", run: () => void openHelp() }]);

onReady((ctx) => {
  attachEditor(ctx);
  void loadInstalled();
});
