// Modify > Guides, as Vectorworks Fundamentals has them: guides are the objects in the class named
// Guides. Make Guide puts the selected objects in it (making the class when the drawing has none),
// Show Guides (a ticked toggle) shows or hides the class, Select Guides selects the guides on the
// active layer (or in the group being edited), and Delete All Guides deletes those on every layer.
// Each is one undo step.

import type { ClassInfo } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

const GUIDES = "Guides";

function guidesClass(): ClassInfo | null {
  return store.session?.doc.classes().find((c) => c.name.toLowerCase() === GUIDES.toLowerCase()) ?? null;
}

export function canMakeGuide(): boolean {
  const doc = store.session?.doc;
  const index = guidesClass()?.index;
  return !!doc && [...store.selection].some((id) => doc.object(id)?.classIndex !== index);
}

export function makeGuide(): void {
  const ids = [...store.selection];
  if (!ids.length) return;
  const r = attempt("Make Guide", (s) =>
    s.batch(() => {
      const index = guidesClass()?.index ?? s.createClass(GUIDES);
      s.setObjectClass(ids, index);
    }),
  );
  if (r) toast(`${ids.length} object${ids.length === 1 ? " is a guide" : "s are guides"} now, in the class ${GUIDES}.`, "info");
}

/** Whether the drawing has the Guides class, which Show Guides shows or hides. */
export function hasGuidesClass(): boolean {
  return guidesClass() !== null;
}

/** Whether the guides are shown: their class visible or grayed, not hidden. */
export function guidesShown(): boolean {
  const c = guidesClass();
  return !!c && c.visibility !== "hidden";
}

/** Shows the guides, or hides them. */
export function showGuides(on: boolean): void {
  const c = guidesClass();
  if (c) attempt(on ? "Show Guides" : "Hide Guides", (s) => s.setClassVisibility(c.index, on ? "visible" : "hidden"));
}

/** The guides a click could select now: on the active layer, or in the group being edited, and shown. */
function selectableGuides(scene: Scene): string[] {
  const doc = store.session?.doc;
  const c = guidesClass();
  const layerId = store.activeLayerId;
  if (!doc || !c || !layerId) return [];
  return scene
    .topLevelEntries(layerId, store.editGroupId)
    .filter((e) => e.visible && doc.object(e.id)?.classIndex === c.index)
    .map((e) => e.id);
}

export function canSelectGuides(scene: Scene): boolean {
  return selectableGuides(scene).length > 0;
}

export function selectGuides(scene: Scene): void {
  setSelection(selectableGuides(scene));
}

/** Every guide on the drawing's layers (not those a symbol's definition holds). */
function allGuides(): string[] {
  const doc = store.session?.doc;
  const c = guidesClass();
  if (!doc || !c) return [];
  return doc.layers().flatMap((l) => doc.objects(l.id).filter((o) => o.classIndex === c.index && !o.id.includes("/")).map((o) => o.id));
}

export function canDeleteAllGuides(): boolean {
  return allGuides().length > 0;
}

export function deleteAllGuides(): void {
  const ids = allGuides();
  if (!ids.length) return;
  const gone = new Set(ids);
  if (!attempt("Delete All Guides", (s) => s.deleteObjects(ids))) return;
  setSelection([...store.selection].filter((id) => !gone.has(id)));
  toast(`Deleted ${ids.length} guide${ids.length === 1 ? "" : "s"}.`, "info");
}
