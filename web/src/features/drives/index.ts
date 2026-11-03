// drives feature: opens and saves drawings in the user's Google Drive and
// OneDrive, with no openvwx account. Registers its File menu rows and welcome
// screen buttons with app/ext.ts when imported; a provider appears only when
// the server offers it (GET /api/config, drives). The open rows go after Open
// Recent and the save rows after Save As….

import "./drives.css";
import { registerMenu, registerWelcome } from "../../app/ext.ts";
import type { Item, Row } from "../../app/menu.ts";
import { driveConfig } from "./config.ts";
import { fileRows, welcomeBlock } from "./ui.ts";

/** The File rows of fileRows() whose labels start with `verb` ("Open ", "Save "). */
function rowsStarting(verb: string): () => Row[] {
  return () => fileRows().filter((r): r is Item => r !== "-" && r.label.startsWith(verb));
}

registerMenu("File", rowsStarting("Open "), { after: "Open Recent" });
registerMenu("File", rowsStarting("Save "), { after: "Save As…" });
registerWelcome(welcomeBlock, "open");
// read what the server offers now, so the menu rows are ready when the menu opens
void driveConfig();
