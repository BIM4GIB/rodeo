// View > Unhide Objects, Show Selected Objects Only, Hide Selected Objects and Object Visibility…, as
// Vectorworks has them: hidden objects aren't drawn, selected or snapped to, in plan, 3D or viewports,
// nor exported or printed, until Unhide Objects (or the button the drawing shows while any are hidden)
// shows them again. Object Visibility shows, shows only or hides the objects that meet every
// criterion, as Custom Selection finds them. Not while a symbol is being edited.

import "./objectVisibility.css";
import { setSelection } from "./commands.ts";
import { criteriaEditor } from "./customSelection.ts";
import { h } from "./dom.ts";
import { editModeButton } from "./exitGroup.ts";
import { changeHidden, hiddenObjects, onHiddenChange } from "./hiddenObjects.ts";
import { TOOL_ICON } from "./icons.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId, type Scene } from "./scene.ts";
import { store } from "./state.ts";
import { editBars } from "./symbolEdit.ts";
import { toast } from "./toast.ts";

type Mode = "show" | "show-only" | "hide";

const MODES: readonly { readonly id: Mode; readonly label: string }[] = [
  { id: "show", label: "Show" },
  { id: "show-only", label: "Show Only" },
  { id: "hide", label: "Hide" },
];

export function canHideObjects(): boolean {
  return store.session !== null && store.symbolEdit === null;
}

export function canHideSelected(): boolean {
  return canHideObjects() && store.selection.size > 0;
}

export function canUnhide(): boolean {
  return hiddenObjects().size > 0;
}

/** Hides the selection. */
export function hideSelectedObjects(): void {
  if (!canHideSelected()) return;
  const n = store.selection.size;
  changeHidden([...store.selection], []);
  setSelection([]);
  toast(`${n} ${n === 1 ? "object" : "objects"} hidden · View > Unhide Objects shows them`, "info");
}

/**
 * Hides everything but the selection: the other objects at the top level of every layer, and in a
 * group being edited, the selection's neighbours. Objects already out of sight (a hidden layer or
 * class) are left as they are.
 */
export function showSelectedObjectsOnly(scene: Scene): void {
  const doc = store.session?.doc;
  if (!doc || !canHideSelected()) return;
  const selected = new Set(store.selection);
  // the selected objects and the groups they are in
  const path = new Set<string>();
  for (const id of selected) {
    for (let o = doc.object(id); o; o = o.parentId === null ? null : doc.object(o.parentId)) path.add(o.id);
  }
  const hide: string[] = [];
  for (const layer of doc.layers()) {
    if (layer.visibility === "hidden") continue;
    for (const o of doc.objects(layer.id)) {
      if (path.has(o.id) || isDerivedId(o.id)) continue;
      const beside = o.parentId === null || (path.has(o.parentId) && !selected.has(o.parentId));
      if (beside && scene.classVisibility(o.classIndex) !== "hidden") hide.push(o.id);
    }
  }
  changeHidden(hide, []);
}

/** Shows every hidden object. */
export function unhideObjects(): void {
  if (canUnhide()) changeHidden([], null);
}

/** Object Visibility…: shows, shows only or hides the top-level objects that meet every criterion. */
export async function objectVisibilityDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc || !canHideObjects()) return;
  const objects = doc.layers().flatMap((l) => doc.objects(l.id).filter((o) => o.parentId === null && !isDerivedId(o.id)));
  if (objects.length === 0) {
    toast("The drawing has no objects.", "info");
    return;
  }
  const criteria = criteriaEditor(doc, objects);
  const mode = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select cs-action", attrs: { "aria-label": "Visibility" } },
    ...MODES.map((m) => h("option", { value: m.id, text: m.label })),
  );
  const result = await showDialog<{ ids: string[]; mode: Mode }>({
    title: "Object Visibility",
    okLabel: "OK",
    cls: "cs-dialog",
    body: [
      h("p", { cls: "muted", text: "Objects in the drawing that meet every criterion:" }),
      ...criteria.body,
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Visibility" }), mode),
    ],
    check: () => {
      const found = criteria.matches();
      return "error" in found ? found : { value: { ids: found.ids, mode: mode.value as Mode } };
    },
  });
  if (!result) return;
  const ids = new Set(result.ids);
  if (result.mode === "show") changeHidden([], ids);
  else if (result.mode === "hide") changeHidden(ids, []);
  else changeHidden(objects.filter((o) => !ids.has(o.id)).map((o) => o.id), ids);
  if (result.mode !== "show") setSelection([...store.selection].filter((id) => !hiddenObjects().has(id)));
  const n = ids.size;
  toast(n === 0 ? "No objects meet those criteria." : `${n} ${n === 1 ? "object meets" : "objects meet"} the criteria`, "info");
}

/** The drawing's Unhide Objects button, shown while any object is hidden. */
export function mountUnhideButton(host: HTMLElement): void {
  // small or large, as Window > Edit Group and Object Visibility Options says (exitGroup.ts)
  const btn = editModeButton(TOOL_ICON.visibility, () => `Unhide Objects (${hiddenObjects().size})`, () => unhideObjects(), "unhide-objects");
  btn.el.hidden = true;
  // in the stack with the Exit Group and Exit Symbol bars, clear of the View bar
  editBars(host).append(btn.el);
  const render = (): void => {
    btn.el.hidden = hiddenObjects().size === 0;
    btn.sync();
  };
  onHiddenChange(render);
  store.on("session", render);
  render();
}
