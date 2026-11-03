// Stage > Lighting Paperwork: the Patch window, the console and patch-list files, and MVR in and out; and Stage >
// Lighting > DMX Patch…, Spotlight's patch dialog. The planning is in patch.ts, dmxPatch.ts, usitt.ts and mvr.ts;
// patchPanel.ts is the window, dmxPatchDialog.ts the dialog and exchange.ts the file actions. This file adds the
// rows to the menu.

import type { Row } from "../../../app/menu.ts";
import { store } from "../../../app/state.ts";
import { addStageRows } from "../registry.ts";
import { dmxPatch } from "./dmxPatchDialog.ts";
import { exportMvr, exportPatchCsv, exportUsitt, importMvr } from "./exchange.ts";
import { openPatchPanel } from "./patchPanel.ts";

const open = (): boolean => store.session !== null;

addStageRows("Lighting", (): readonly Row[] => [{ label: "DMX Patch…", enabled: open, run: () => void dmxPatch() }]);

addStageRows(
  "Lighting Paperwork",
  (): readonly Row[] => [
    { label: "Patch…", enabled: open, run: openPatchPanel },
    {
      label: "Export to Console",
      enabled: open,
      items: [
        { label: "USITT ASCII Patch (.asc)…", enabled: open, run: exportUsitt },
        { label: "Patch CSV…", enabled: open, run: exportPatchCsv },
      ],
    },
    "-",
    { label: "Export MVR…", enabled: open, run: exportMvr },
    { label: "Import MVR…", enabled: open, run: importMvr },
  ],
);
