// Crit mode's switches: on or off (for a cloud drawing only), the crit tool
// (Pin, Redline, Select), the redline colour, and the comments of the drawing
// that is open. The View menu, the top bar and the toolbar all go through here.

import { appContext, documentSource } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { isCloudSource } from "../../platform/cloudSource.ts";
import { closePopover, popoverKind } from "./popover.ts";
import { crit, type CritTool } from "./state.ts";
import { loadComments, setPolling } from "./sync.ts";

export const CRIT_PALETTE_ID = "crit";

/** What turning crit mode on says for a drawing that is not in the cloud. */
export const NOT_IN_CLOUD = "Crit mode works on cloud drawings, so others can review them. Save the drawing to the cloud first.";

const HINTS: Record<CritTool, string> = {
  select: "",
  pin: "Click the drawing to pin a comment",
  redline: "Drag to draw a redline; Done adds a note",
};

export function toggleCrit(): void {
  setCritMode(!crit.active);
}

/** Turns crit mode on (for a cloud drawing) or off; the palette shows and hides with it. */
export function setCritMode(on: boolean): void {
  if (on) {
    if (!store.session) {
      toast("Open a drawing first.", "info");
      return;
    }
    if (!isCloudSource(documentSource())) {
      toast(NOT_IN_CLOUD, "info");
      return;
    }
  }
  if (crit.active === on) return;
  crit.active = on;
  if (!on) {
    closePopover();
    crit.tool = "select";
    crit.pinDraft = null;
    crit.strokes = [];
    crit.stroke = null;
    crit.selected = null;
  }
  document.body.classList.toggle("crit-mode", on);
  const palettes = appContext()?.palettes;
  if (palettes) {
    if (on && !palettes.isShown(CRIT_PALETTE_ID)) palettes.show(CRIT_PALETTE_ID);
    if (!on && palettes.isShown(CRIT_PALETTE_ID)) palettes.toggle(CRIT_PALETTE_ID);
  }
  setPolling(on);
  crit.changed();
  appContext()?.requestDraw();
}

/** Chooses the crit tool. Select hands the editor back to its own tool. */
export function setCritTool(tool: CritTool): void {
  if (!crit.active || crit.tool === tool) return;
  if (tool !== "select" && !crit.canComment) {
    toast("Your role lets you read comments, not add them.", "info");
    return;
  }
  if (tool === "redline" && store.view3d) {
    toast("Redlines are drawn on the 2D drawing.", "info");
    return;
  }
  crit.tool = tool;
  crit.stroke = null;
  if (crit.pinDraft && tool !== "pin") {
    crit.pinDraft = null;
    if (popoverKind() === "pin") closePopover();
  }
  if (tool === "select") appContext()?.setTool("select");
  store.setHint(HINTS[tool]);
  crit.changed();
  appContext()?.requestDraw();
}

export function setCritColour(value: string): void {
  if (crit.colour === value) return;
  crit.colour = value;
  crit.changed();
}

/** Drops the redlines drawn but not posted. */
export function clearStrokes(): void {
  if (crit.strokes.length === 0) return;
  crit.strokes = [];
  if (popoverKind() === "redline") closePopover();
  crit.changed();
  appContext()?.requestDraw();
}

/** A drawing opened (or closed): its comments are read when it is in the cloud; crit mode waits for one. */
export function documentOpened(): void {
  const source = documentSource();
  if (!store.session || !isCloudSource(source)) {
    setCritMode(false);
    crit.fileId = null;
    crit.role = null;
    crit.strokes = [];
    crit.pinDraft = null;
    closePopover();
    crit.replace([]);
    return;
  }
  if (crit.fileId !== source.id) {
    closePopover();
    crit.strokes = [];
    crit.pinDraft = null;
    crit.selected = null;
    crit.replace([]);
  }
  crit.fileId = source.id;
  crit.role = source.role;
  crit.changed();
  void loadComments(source.id);
  setPolling(crit.active);
}
