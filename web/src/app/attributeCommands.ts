// Modify > Attributes, as Vectorworks Fundamentals has it: Make All Attributes by Class gives the
// selected objects every attribute group (fill, pen colour, line style, line weight, opacity)
// from their classes, Remove by Class Settings keeps what each draws with as its own, Set
// Default Attributes saves a default set (the one selected object's attributes, which new objects
// are then drawn with, or with nothing selected what the Attributes palette sets for new objects,
// its markers and drop shadow too), and Use Default Attributes gives the selected objects that set
// or, with nothing selected, puts the palette back to it. The set is kept while the drawing is
// open (Vectorworks saves it in the file; where isn't known).

import type { Attributes, ByClassGroup, ObjectInfo } from "../core/index.ts";
import { attempt } from "./commands.ts";
import type { Row } from "./menu.ts";
import { store, type DrawEffects } from "./state.ts";
import { toast } from "./toast.ts";

/** The default set Set Default Attributes saved, for the drawing it was saved in. */
let defaults: { session: unknown; attrs: Partial<Attributes>; effects: DrawEffects } | null = null;

function savedSet(): { attrs: Partial<Attributes>; effects: DrawEffects } | null {
  return defaults && defaults.session === store.session ? defaults : null;
}

const GROUPS: readonly ByClassGroup[] = ["fill", "lineStyle", "penColor", "lineWeight", "opacity"];

/** The selected objects that draw with attributes of their own (not groups, symbols or plug-ins). */
function selectedWithAttrs(): ObjectInfo[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].flatMap((id) => {
    const o = doc.object(id);
    return o?.attrs ? [o] : [];
  });
}

export function canMakeAllByClass(): boolean {
  return selectedWithAttrs().some((o) => (o.byClass?.length ?? 0) < GROUPS.length);
}

export function canRemoveByClass(): boolean {
  return selectedWithAttrs().some((o) => (o.byClass?.length ?? 0) > 0);
}

/** Every attribute group of the selected objects from their classes (`on`), or none of them. One undo step. */
export function setAllByClass(on: boolean): void {
  const objs = selectedWithAttrs().filter((o) => (on ? (o.byClass?.length ?? 0) < GROUPS.length : (o.byClass?.length ?? 0) > 0));
  if (!objs.length) return;
  const ids = objs.map((o) => o.id);
  const r = attempt(on ? "Make All Attributes by Class" : "Remove by Class Settings", (s) =>
    s.batch(() => {
      for (const g of GROUPS) s.setAttributesByClass(ids, g, on);
    }),
  );
  if (!r) return;
  const n = ids.length;
  toast(on ? `${n} object${n === 1 ? " takes" : "s take"} all ${n === 1 ? "its" : "their"} attributes from ${n === 1 ? "its class" : "their classes"}.` : `${n} object${n === 1 ? " keeps" : "s keep"} ${n === 1 ? "its" : "their"} attributes as ${n === 1 ? "its" : "their"} own.`, "info");
}

export function canSetDefaultAttributes(): boolean {
  return !!store.session && (store.selection.size === 0 || selectedWithAttrs().length === 1);
}

/**
 * With one object selected, its attributes as those new objects are drawn with, saved as the
 * default set; with nothing selected, what the Attributes palette sets for new objects saved so.
 */
export function setDefaultAttributes(): void {
  if (!store.session) return;
  if (store.selection.size === 0) {
    defaults = { session: store.session, attrs: { ...store.drawAttrs }, effects: { ...store.drawEffects } };
    toast("The Attributes palette's settings are the default attributes.", "info");
    return;
  }
  const [o] = selectedWithAttrs();
  if (!o?.attrs) return;
  store.drawAttrs = { ...o.attrs };
  defaults = { session: store.session, attrs: { ...o.attrs }, effects: { ...store.drawEffects } };
  store.emit("attrs");
  toast("New objects draw with the selected object's attributes, now the default attributes.", "info");
}

/** True when there is a default set to use: on the selected objects, or to put the palette back to. */
export function canUseDefaultAttributes(): boolean {
  const set = savedSet();
  if (!set) return false;
  return store.selection.size === 0 || selectedWithAttrs().length > 0;
}

/**
 * The default set given to the selected objects that draw with attributes of their own (markers to
 * lines, arcs, polygons and polylines; the drop shadow to all), one undo step; with nothing
 * selected, the Attributes palette's settings for new objects put back to it.
 */
export function useDefaultAttributes(): void {
  const set = savedSet();
  if (!set) return;
  if (store.selection.size === 0) {
    store.drawAttrs = { ...set.attrs };
    store.drawEffects = { ...set.effects };
    store.emit("attrs");
    toast("The Attributes palette is back to the default attributes.", "info");
    return;
  }
  const objs = selectedWithAttrs();
  if (!objs.length) return;
  const ids = objs.map((o) => o.id);
  const { start, end, shadow } = set.effects;
  const r = attempt("Use Default Attributes", (s) =>
    s.batch(() => {
      if (Object.keys(set.attrs).length) s.setAttributes(ids, set.attrs);
      // the session passes over objects that take no markers
      s.setLineMarkers(ids, { start: start ?? null, end: end ?? null });
      s.setDropShadow(ids, shadow ?? null);
    }),
  );
  if (!r) return;
  const n = ids.length;
  toast(`${n} object${n === 1 ? " takes" : "s take"} the default attributes.`, "info");
}

/** The Attributes palette's title bar menu: the four Modify > Attributes commands, as Vectorworks' palette has them. */
export function attributeUtilityRows(): Row[] {
  return [
    { label: "Use Default Attributes", enabled: canUseDefaultAttributes, run: useDefaultAttributes },
    { label: "Set Default Attributes", enabled: canSetDefaultAttributes, run: setDefaultAttributes },
    { label: "Make All Attributes by Class", enabled: canMakeAllByClass, run: () => setAllByClass(true) },
    { label: "Remove by Class Settings", enabled: canRemoveByClass, run: () => setAllByClass(false) },
  ];
}
