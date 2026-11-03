// Modify > Edit Symbol: a symbol definition's contents open in the drawing area in place of the
// layers, at the definition's insertion point (0,0), and every tool edits them as it would a
// layer's. Each change reaches every instance at once and undoes as usual. A bar over the drawing
// names the symbol; Exit Symbol goes back to the layer and view it was opened from. The app does
// the switching (registerSymbolEditor), so tools, panels and menus only ask for it here.

import { h } from "./dom.ts";
import { editModeButton } from "./exitGroup.ts";
import { UI_ICON } from "./icons.ts";
import { symbolNameOf } from "./panels/resources.ts";
import { store } from "./state.ts";
import "./symbolEdit.css";

/** a viewport's record type */
const VIEWPORT = 122;

interface SymbolEditor {
  enter(index: number): void;
  annotate(viewportId: string): void;
  exit(): void;
}

let editor: SymbolEditor | null = null;

/** The app opens and leaves definitions; called once at start-up. */
export function registerSymbolEditor(e: SymbolEditor): void {
  editor = e;
}

/** Opens definition `index` (a name index) for editing. */
export function editSymbol(index: number): void {
  editor?.enter(index);
}

/** Edit Annotations: opens the annotations of sheet viewport `viewportId` for editing. */
export function editAnnotations(viewportId: string): void {
  editor?.annotate(viewportId);
}

/** The sheet viewport `id` is, when its annotations can be opened (no symbol or annotations are open); else null. */
export function annotatableViewport(id: string | null): string | null {
  const doc = store.session?.doc;
  if (!doc || id === null || store.symbolEdit) return null;
  return doc.object(id)?.type === VIEWPORT && doc.viewport(id) ? id : null;
}

/** Leaves the symbol or viewport annotations being edited, if there are some. */
export function exitSymbol(): void {
  if (!store.symbolEdit) return;
  if (editor) editor.exit();
  else store.symbolEdit = null;
}

/** The definition of the one selected symbol instance, which Edit Symbol opens; null otherwise. */
export function selectedSymbol(): number | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  const o = doc.object(id);
  return o?.kind === "symbol" && o.symbol !== undefined ? o.symbol : null;
}

/** The stack over the drawing that holds the Unhide Objects button and the Exit Symbol and Exit Group bars, made the first time it is asked for. */
export function editBars(wrap: HTMLElement): HTMLElement {
  const found = wrap.querySelector<HTMLElement>(":scope > .edit-bars");
  if (found) return found;
  const stack = h("div", { cls: "edit-bars" });
  wrap.append(stack);
  return stack;
}

/** The bar over the drawing while a symbol is being edited: its name and Exit Symbol. */
export function mountSymbolBar(wrap: HTMLElement): void {
  const name = h("span", { cls: "symbol-bar-name" });
  // small or large, as Window > Edit Group and Object Visibility Options says (exitGroup.ts)
  const exit = editModeButton(UI_ICON.exitGroup, () => (store.symbolEdit?.viewport ? "Exit Viewport Annotation" : "Exit Symbol"), exitSymbol, "btn small primary exit-group-btn");
  const label = h("span", { cls: "symbol-bar-label", text: "Editing symbol" });
  const bar = h("div", { cls: "symbol-bar", hidden: true, attrs: { role: "status" } }, label, name, exit.el);
  editBars(wrap).append(bar);
  const sync = (): void => {
    const e = store.symbolEdit;
    const doc = store.session?.doc;
    bar.hidden = !e || !doc;
    if (!e || !doc) return;
    label.textContent = e.viewport ? "Annotating viewport" : "Editing symbol";
    exit.sync();
    name.textContent = e.viewport ? e.layer.name : symbolNameOf(doc, e.index);
  };
  store.on(["session", "layer"], sync);
  sync();
}
