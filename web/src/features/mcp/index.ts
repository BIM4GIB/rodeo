// Agents from outside Rodeo (MCP): Claude Code, Claude Desktop, Cursor and others drive the open
// drawing through this tab; the Connect an Agent dialog makes their tokens. Registered with
// app/ext.ts when imported: the top bar's pill, the Window menu's row, and the bridge once the
// editor is running.

import "./pill.css";
import { onReady, registerMenu, registerTopBar } from "../../app/ext.ts";
import type { Row } from "../../app/menu.ts";
import { bridgeStatusText, startBridge } from "./bridge.ts";
import { openConnectDialog } from "./dialog.ts";
import { agentPill } from "./pill.ts";

/** Opens the Connect an Agent dialog, with this tab's connection state under its intro. */
export function openAgentsDialog(): void {
  void openConnectDialog(bridgeStatusText);
}

registerTopBar(agentPill, "right");
registerMenu("Window", (): Row[] => [{ label: "Connect an Agent…", run: openAgentsDialog }], { after: "Agents" });
onReady(() => startBridge());
