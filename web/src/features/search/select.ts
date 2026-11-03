// Selecting what a search or a usage search found: the object's top-level object
// goes on its layer's selection, and the view zooms to it, as Zoom to Selection does.

import type { AppContext } from "../../app/ext.ts";
import { setActiveLayer, setEditGroup, zoomToSelection } from "../../app/commands.ts";
import { store } from "../../app/state.ts";
import { topLevelId } from "./describe.ts";

/** Selects top-level objects on one layer (leaving any group being edited) and zooms to them. */
export function selectAndZoom(ctx: AppContext, layerId: string, ids: readonly string[]): void {
  setActiveLayer(layerId);
  setEditGroup(null, ids);
  zoomToSelection(ctx.scene, ctx.view);
}

/** Opens an object: its layer becomes active, it is selected (a part of a symbol selects its instance) and the view zooms to it. */
export function revealObject(ctx: AppContext, id: string): void {
  const doc = store.session?.doc;
  if (!doc) return;
  const top = topLevelId(doc, id);
  const obj = doc.object(top);
  if (!obj) return;
  selectAndZoom(ctx, obj.layerId, [top]);
}
