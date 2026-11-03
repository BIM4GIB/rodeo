// The Stage menu's paperwork and audit: Lighting Paperwork's Focus Cards…, Magic Sheet…, Create Labels…
// (ConnectCAD's, connectcad/labels.ts) and Inventory and Equipment List… (inventoryDialog.ts), and Show Audit…
// under Audit. Each reads the instruments and the show's data, then shows a window or draws a sheet.

import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { openAudit } from "./auditPanel.ts";
import { openFocusCards } from "./focusCardsPanel.ts";
import { openMagicSheet } from "./magicSheetDialog.ts";
import { inventoryAndEquipmentList } from "./inventoryDialog.ts";
import { createLabels } from "../connectcad/labels.ts";
import { errorMessage, toast } from "../../../app/toast.ts";

const open = (): boolean => store.session !== null;

addStageRows("Lighting Paperwork", () => [
  { label: "Focus Cards…", enabled: open, run: () => openFocusCards() },
  { label: "Magic Sheet…", enabled: open, run: () => void openMagicSheet() },
  { label: "Create Labels…", enabled: open, run: () => void createLabels().catch((err: unknown) => toast(errorMessage(err))) },
  { label: "Inventory and Equipment List…", enabled: open, run: () => void inventoryAndEquipmentList() },
]);
addStageRows("Audit", () => [{ label: "Show Audit…", enabled: open, run: () => openAudit() }]);
