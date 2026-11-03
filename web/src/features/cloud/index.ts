// cloud feature: registers itself with app/ext.ts when imported. It adds the File menu's
// cloud rows (Open from Cloud… after Open Recent, Save to Cloud… after Save As…, Version
// History and Share… after Revert), the Version History palette, the start hub's Open from
// Cloud… and its Recent cloud drawings, the links that open drawings (?file, ?invite, ?share, ?embed) and autosave for
// cloud drawings. Nothing shows unless the server offers cloud drawings (GET /api/config).

import { documentSource, registerMenu, registerPalette, registerRecentFiles, registerWelcome } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { serverConfig } from "../../platform/api.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { CAN_EDIT } from "../../platform/protocol.ts";
import { startAutosync } from "./autosync.ts";
import { openCloudBrowser } from "./browser.ts";
import { cloudOffered, openCloudDrawing, saveDrawingToCloud } from "./cloud.ts";
import { historyPalette, showHistory } from "./history.ts";
import { openShareDialog } from "./share.ts";
import { cloudOpenButton, watchCloudRecent } from "./welcome.ts";
import "./urls.ts";

/** Share… is for a cloud drawing its user can change: an owner or an editor. */
function canShare(): boolean {
  const s = documentSource();
  return isCloudSource(s) && CAN_EDIT.includes(s.role);
}

registerMenu(
  "File",
  () => (cloudOffered() ? [{ label: "Open from Cloud…", run: () => void openCloudBrowser() }] : []),
  { after: "Open Recent" },
);

registerMenu(
  "File",
  () =>
    cloudOffered()
      ? [
          {
            label: "Save to Cloud…",
            enabled: () => store.session !== null && !isCloudSource(documentSource()),
            run: () => void saveDrawingToCloud(),
          },
        ]
      : [],
  { after: "Save As…" },
);

registerMenu(
  "File",
  () =>
    cloudOffered()
      ? [
          { label: "Version History", run: showHistory },
          {
            label: "Share…",
            enabled: canShare,
            run: () => {
              const open = openCloudDrawing();
              if (open) openShareDialog(open.id);
            },
          },
        ]
      : [],
  { after: "Revert" },
);

registerPalette(historyPalette);
registerWelcome(cloudOpenButton, "open");
registerRecentFiles(watchCloudRecent);

void serverConfig().then((cfg) => {
  if (cfg) startAutosync();
});
