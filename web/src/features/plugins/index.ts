// Plug-ins: JavaScript plug-ins users write, run, save and share, each in its own
// Web Worker with the openvwx API (see API.md). Registers the Plug-ins menu (the
// plug-ins' own commands) and the Help row, and starts the enabled plug-ins once the
// editor is ready. The Plug-in Manager and Script Console are in Tools > Plug-ins
// (python/index.ts), where Vectorworks keeps them.

import { onReady, registerMenu } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { attachEditor, loadInstalled, menuItemRows } from "./host.ts";
import { openHelp } from "./help.ts";
import "./plugins.css";

registerMenu("Plug-ins", menuItemRows);

registerMenu("Help", (): Row[] => [{ label: "Plug-in API…", run: () => void openHelp() }]);

onReady((ctx) => {
  attachEditor(ctx);
  void loadInstalled();
});
