// Edit > Previous Selection, as Vectorworks Fundamentals has it: the selection before this one
// comes back, and again goes further back, through the last 20 selections of the front drawing.
// A selection whose objects have all gone, or are in a group that isn't open, is passed over; one
// on another layer makes that layer active. Bringing another drawing to the front starts afresh.

import type { EditSession, ObjectInfo } from "../core/index.ts";
import { setActiveLayer, setSelection } from "./commands.ts";
import { store } from "./state.ts";

const MAX_KEPT = 20;

/** the earlier selections, oldest first */
let history: (readonly string[])[] = [];
let current: readonly string[] = [];
let session: EditSession | null = null;
/** Previous Selection is setting the selection: the one it leaves isn't kept */
let restoring = false;

const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((id, i) => id === b[i]);

store.on(["selection", "session"], () => {
  if (store.session !== session) {
    session = store.session;
    history = [];
    current = [...store.selection];
    return;
  }
  const now = [...store.selection];
  if (same(now, current)) return;
  if (!restoring && current.length > 0) history = [...history.filter((h) => !same(h, current)), current].slice(-MAX_KEPT);
  current = now;
});

/** The latest earlier selection with objects still in the drawing, as those objects and their layer. */
function previous(): { at: number; ids: string[]; layerId: string } | null {
  const doc = store.session?.doc;
  if (!doc) return null;
  for (let at = history.length - 1; at >= 0; at--) {
    // what a click can select now: on a layer, or in the group being edited
    const objs = history[at].map((id) => doc.object(id)).filter((o): o is ObjectInfo => !!o && o.parentId === store.editGroupId);
    const layerId = objs[0]?.layerId;
    // a selection is of one layer's objects
    const ids = objs.filter((o) => o.layerId === layerId).map((o) => o.id);
    if (layerId && ids.length && !same(ids, current)) return { at, ids, layerId };
  }
  return null;
}

export function canPreviousSelection(): boolean {
  return previous() !== null;
}

export function previousSelection(): void {
  const p = previous();
  if (!p) return;
  history = history.slice(0, p.at);
  restoring = true;
  try {
    if (p.layerId !== store.activeLayerId) setActiveLayer(p.layerId);
    setSelection(p.ids);
  } finally {
    restoring = false;
  }
}
