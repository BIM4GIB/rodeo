// Merge requests and blame: their palettes and their rows in File › Branches. Registers on import.

// index.ts registers File › Branches first; this module's rows go after it, so it is imported here too.
import "./index.ts";
import { documentSource, registerMenu, registerPalette } from "../../app/ext.ts";
import { CAN_EDIT } from "../../platform/protocol.ts";
import { cloudOffered, isVersionSource, openCloudDrawing } from "../cloud/cloud.ts";
import { blameOn, blamePalette, toggleBlame } from "./blameView.ts";
import { familyState, onBranch } from "./family.ts";
import { updateFromMain } from "./mergeFlow.ts";
import { newMergeRequest, requestsPalette, showRequests } from "./requests.ts";
import "./review.css";

/** Whether the caller may change the open branch: an owner or editor, and the open drawing is not an old version. */
function canEditBranch(): boolean {
  const s = familyState();
  return !!s && CAN_EDIT.includes(s.family.role) && !isVersionSource(documentSource());
}

// The submenu exists only where cloud drawings are offered; without it these rows would land in File.
registerMenu("File › Branches", () =>
  cloudOffered()
    ? [
        { label: "New Merge Request…", enabled: () => onBranch() && canEditBranch(), run: () => void newMergeRequest() },
        { label: "Merge Requests", enabled: () => familyState() !== null, run: showRequests },
        { label: "Update from Main…", enabled: () => onBranch() && canEditBranch(), run: () => void updateFromMain() },
        "-",
        { label: "Blame", checked: blameOn, enabled: () => openCloudDrawing() !== null, run: toggleBlame },
      ]
    : [],
);

registerPalette(requestsPalette);
registerPalette(blamePalette);
