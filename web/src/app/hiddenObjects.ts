// The objects View > Hide Selected Objects, Show Selected Objects Only and Object Visibility hide,
// for each open drawing: not drawn, selected or snapped to, in plan or in 3D, nor shown in viewports,
// exported or printed, until Unhide Objects. Kept while the drawing is open; not saved with it (how
// Vectorworks marks a hidden object isn't known).

import type { ObjectInfo, VwxDocument } from "../core/types.ts";
import { store } from "./state.ts";

const bySession = new WeakMap<object, Set<string>>();
const listeners: (() => void)[] = [];
let version = 0;

const NONE: ReadonlySet<string> = new Set();

/** The ids hidden in the open drawing (an object inside one is hidden with it). */
export function hiddenObjects(): ReadonlySet<string> {
  const s = store.session;
  return (s && bySession.get(s)) ?? NONE;
}

/** Bumped on every change, for what keeps a drawn picture. */
export function hiddenVersion(): number {
  return version;
}

/** Hides or shows objects in the open drawing: `hide` added, `show` taken out (all, with `show` null). */
export function changeHidden(hide: Iterable<string>, show: Iterable<string> | null): void {
  const s = store.session;
  if (!s) return;
  const set = bySession.get(s) ?? new Set<string>();
  if (show === null) set.clear();
  else for (const id of show) set.delete(id);
  for (const id of hide) set.add(id);
  bySession.set(s, set);
  version++;
  for (const f of listeners) f();
  store.emit("display");
}

/** Calls `f` whenever objects are hidden or shown. */
export function onHiddenChange(f: () => void): void {
  listeners.push(f);
}

/**
 * `doc` as exports and printing see it: without the hidden objects and what they hold, in its
 * objects and its 3D model. The drawing itself when nothing is hidden.
 */
export function withoutHidden(doc: VwxDocument): VwxDocument {
  const hidden = hiddenObjects();
  if (hidden.size === 0) return doc;
  const known = new Map<string, boolean>();
  const isHidden = (o: ObjectInfo): boolean => {
    let v = known.get(o.id);
    if (v === undefined) {
      const parent = o.parentId === null ? null : doc.object(o.parentId);
      v = hidden.has(o.id) || (parent !== null && isHidden(parent));
      known.set(o.id, v);
    }
    return v;
  };
  return new Proxy(doc, {
    get(target, prop) {
      if (prop === "objects") return (layerId: string) => target.objects(layerId).filter((o) => !isHidden(o));
      if (prop === "model3d") return () => target.model3d().filter((m) => !hidden.has(m.objectId));
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
}
