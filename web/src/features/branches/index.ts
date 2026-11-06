// Branches in the editor: the File › Branches submenu, the branch chip beside a cloud drawing's
// name in the top bar, and the dialogs that start, switch, rename and delete branches. Compare
// is in the same menu (compare.ts). The review tools add their rows to the submenu from their own
// module. Registers itself on import.

import { h } from "../../app/dom.ts";
import { appContext, documentSource, registerFileBadge, registerMenu } from "../../app/ext.ts";
import { menuButton, type Row } from "../../app/menu.ts";
import { type DialogCheck, confirmDialog, showDialog } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { STEP, whyNot } from "../../app/menuReasons.ts";
import { currentUser } from "../../platform/api.ts";
import { CAN_EDIT } from "../../platform/protocol.ts";
import { cloudChanged, cloudCall, cloudOffered, isVersionSource, openCloudFile } from "../cloud/cloud.ts";
import { field } from "../cloud/ui.ts";
import { branches } from "./api.ts";
import { openCompareDialog } from "./compare.ts";
import { familyState, loadFamily, onBranch, onFamily } from "./family.ts";
import { BRANCH } from "./glyphs.ts";
import { BRANCH_NAME_MAX, cleanBranchName, MAIN_NAME } from "./wire.ts";
import "./branches.css";

/** Whether the caller may start a branch here: an owner or editor, with the open drawing not an old version. */
function canStart(): boolean {
  const s = familyState();
  return !!s && CAN_EDIT.includes(s.family.role) && !isVersionSource(documentSource());
}

/** Whether the caller may rename the open branch: an owner or editor. */
function canEdit(): boolean {
  const s = familyState();
  return !!s && CAN_EDIT.includes(s.family.role);
}

/** Whether the caller may delete the open branch: its owner, or whoever made it (the server checks again). */
function canDelete(): boolean {
  const s = familyState();
  if (!s || s.current.main) return false;
  const me = currentUser()?.id;
  return s.family.role === "owner" || (!!me && s.current.createdBy?.id === me);
}

/** The rows of File › Branches, in order. */
function branchRows(): Row[] {
  return [
    newRow(),
    { label: "Switch Branch", why: whyNot([() => familyState() !== null, STEP.cloud]), enabled: () => familyState() !== null, items: () => switchRows() },
    "-",
    compareRow(),
    "-",
    { label: "Rename Branch…", why: whyNot([() => familyState() !== null, STEP.cloud], [onBranch, "Switch to a branch first: File › Branches › Switch Branch"], [canEdit, "Only the owner or an editor can rename it"]), enabled: () => onBranch() && canEdit(), run: () => void renameBranch() },
    { label: "Delete Branch…", why: whyNot([() => familyState() !== null, STEP.cloud], [onBranch, "Switch to a branch first: File › Branches › Switch Branch"], [canDelete, "Only the drawing's owner or the branch's maker can delete it"]), enabled: () => onBranch() && canDelete(), run: () => void deleteBranch() },
  ];
}

/** New Branch…, which the menu and the chip both offer. */
function newRow(): Row {
  return { label: "New Branch…", why: whyNot([() => familyState() !== null, STEP.cloud], [() => !isVersionSource(documentSource()), "Go back to the latest version first"], [canStart, "Only the owner or an editor can branch it"]), enabled: canStart, run: () => void newBranch() };
}

/** Compare…, which the menu and the chip both offer. */
function compareRow(): Row {
  return { label: "Compare…", enabled: () => store.session !== null, run: () => void openCompareDialog() };
}

/** One row per drawing of the family, Main first. The open one is checked; another opens. */
function switchRows(): Row[] {
  const s = familyState();
  if (!s) return [];
  return [s.family.main, ...s.family.branches].map((b) => ({
    label: b.main ? MAIN_NAME : b.name,
    checked: () => familyState()?.fileId === b.fileId,
    run: () => {
      if (familyState()?.fileId !== b.fileId) void openCloudFile(b.fileId);
    },
  }));
}

const chipName = h("span", { cls: "br-chip-name" });
const chip = h("button", { cls: "br-chip", hidden: true, attrs: { type: "button", title: "Branches" } }, h("span", { cls: "br-chip-icon", html: BRANCH }), chipName);
menuButton(chip, () => [...switchRows(), "-", newRow(), compareRow()]);

/** Shows the chip, with the open drawing's name, while the family has branches or the open drawing is one. */
function updateChip(): void {
  const s = familyState();
  chip.hidden = !s || (s.family.branches.length === 0 && s.current.main);
  if (s) chipName.textContent = s.current.main ? MAIN_NAME : s.current.name;
}

/** The dialog check for a branch name: Main's own name gets its own message. */
function nameCheck(input: HTMLInputElement): DialogCheck<string> {
  const name = cleanBranchName(input.value);
  if (name) return { value: name };
  if (input.value.trim().toLowerCase() === MAIN_NAME.toLowerCase()) return { error: "Main is the name of the drawing itself.", focus: input };
  return { error: "Enter a name for the branch.", focus: input };
}

/** File › Branches › New Branch…: names the branch, saves the open drawing if it has changes, and starts it. */
async function newBranch(): Promise<void> {
  const s = familyState();
  const ctx = appContext();
  if (!s || !ctx) return;
  const input = h("input", {
    cls: "menu-dialog-input",
    attrs: { type: "text", maxlength: String(BRANCH_NAME_MAX), placeholder: "e.g. Option B: bigger kitchen", "aria-label": "Name" },
  });
  const name = await showDialog<string>({
    title: "New Branch",
    okLabel: "Start Branch",
    body: [
      field("Name", input),
      h("p", {
        cls: "menu-dialog-text",
        text: onBranch() ? "The branch starts from this branch's latest version." : "The branch starts from Main's latest saved version.",
      }),
    ],
    check: () => nameCheck(input),
  });
  if (name === null) return;
  // the branch starts from the saved head, so unsaved changes are saved first
  if (store.session?.dirty) {
    try {
      await ctx.save();
    } catch (err) {
      toast(`The branch was not started, because the drawing was not saved: ${errorMessage(err)}`);
      return;
    }
  }
  const made = await cloudCall("Starting the branch…", "New branch", () => branches.create(s.fileId, name));
  if (!made) return;
  await loadFamily(true);
  await openCloudFile(made.file.id);
  toast(`Branch "${name}" started.`, "info");
}

/** File › Branches › Rename Branch…: renames the open branch. */
async function renameBranch(): Promise<void> {
  const s = familyState();
  if (!s || s.current.main) return;
  const input = h("input", {
    cls: "menu-dialog-input",
    value: s.current.name,
    attrs: { type: "text", maxlength: String(BRANCH_NAME_MAX), "aria-label": "Name" },
  });
  const name = await showDialog<string>({
    title: "Rename Branch",
    okLabel: "Rename",
    body: [field("Name", input)],
    check: () => nameCheck(input),
  });
  if (name === null || name === s.current.name) return;
  const renamed = await cloudCall("Renaming…", "Rename branch", () => branches.rename(s.fileId, name));
  // the drawing's name in the top bar follows on its next open; the family reads again with the change
  if (renamed) cloudChanged();
}

/** File › Branches › Delete Branch…: deletes the open branch and its versions; Main is left as it is. */
async function deleteBranch(): Promise<void> {
  const s = familyState();
  if (!s || s.current.main) return;
  const ok = await confirmDialog("Delete branch", `Delete the branch "${s.current.name}" and its versions? Main isn't changed.`, "Delete Branch");
  if (!ok) return;
  const removed = await cloudCall("Deleting the branch…", "Delete branch", () => branches.remove(s.fileId).then(() => true));
  if (!removed) return;
  // Main takes the deleted branch's tab, so no tab is left on a drawing that's gone
  await openCloudFile(s.family.rootId, { replace: true });
  await loadFamily(true);
}

registerMenu("File", () => (cloudOffered() ? [{ label: "Branches", items: () => branchRows() }] : []), { after: "Version History" });
registerFileBadge(() => chip);
onFamily(updateChip);
