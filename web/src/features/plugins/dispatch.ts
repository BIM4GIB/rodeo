// The host side of the plug-in API as pure functions: a call (a method name and
// its arguments) against an open session, with no DOM, so check.ts can run them
// under Node. What needs the editor's window (selection, zoom, the active layer)
// comes in through `effects`; the menus, dialogs and fetch live in host.ts.

import type { BBox, EditSession, ObjectInfo, VwxDocument } from "../../core/index.ts";

/** The EditSession mutations plug-ins may call as openvwx.edit.<name>(...args). Nothing else is reachable. */
export const EDIT_METHODS = [
  "addObject",
  "deleteObjects",
  "moveObjects",
  "duplicateObjects",
  "setGeometry",
  "setText",
  "setTextStyle",
  "setObjectClass",
  "setObjectName",
  "setObjectLayer",
  "setAttributes",
  "transformObjects",
  "arrangeObjects",
  "groupObjects",
  "ungroupObjects",
  "createLayer",
  "renameLayer",
  "setLayerVisibility",
  "createClass",
  "renameClass",
  "setClassVisibility",
  "insertSymbol",
  "replaceSymbol",
  "setRecordField",
] as const;

/** The reads under openvwx.doc.<name>(...args). */
export const DOC_METHODS = ["info", "layers", "classes", "objects", "object", "selection", "records", "symbols", "lineTypes", "colors"] as const;

/** Editor effects a call can have; the host supplies them, check.ts supplies its own. */
export interface Effects {
  /** selects the ids that are on the active layer (in the group being edited); returns those selected */
  select(ids: string[]): string[];
  /** fits the window to a box in drawing units */
  zoomTo(box: BBox): void;
  setActiveLayer(id: string): void;
}

/** What a call can see: the open drawing, the active layer, the selection and the editor's effects. */
export interface CallEnv {
  readonly session: EditSession | null;
  readonly activeLayerId: string | null;
  readonly selection: readonly string[];
  readonly effects?: Effects;
}

const EDIT_SET: ReadonlySet<string> = new Set<string>(EDIT_METHODS);

export function isEditMethod(name: string): boolean {
  return EDIT_SET.has(name);
}

/** Thrown for a method the API does not offer, so a plug-in cannot reach the rest of the session. */
export class RefusedCall extends Error {
  constructor(what: string) {
    super(what);
    this.name = "RefusedCall";
  }
}

function drawing(env: CallEnv): EditSession {
  if (!env.session) throw new Error("No drawing is open. Open or create one first.");
  return env.session;
}

function text(v: unknown, what: string): string {
  if (typeof v !== "string") throw new TypeError(`${what} must be text`);
  return v;
}

function ids(v: unknown, what: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new TypeError(`${what} must be a list of object ids`);
  return v as string[];
}

/** A copy of a value that holds only data: no functions, Maps become objects, Sets lists, typed arrays copied. */
export function plain<T>(value: T): T {
  return copy(value, new WeakMap()) as T;
}

function copy(v: unknown, seen: WeakMap<object, unknown>): unknown {
  if (typeof v === "function" || typeof v === "symbol") return undefined;
  if (v === null || typeof v !== "object") return v;
  const known = seen.get(v);
  if (known !== undefined) return known;
  if (ArrayBuffer.isView(v)) {
    const typed = (v as unknown as { slice(): unknown }).slice();
    seen.set(v, typed);
    return typed;
  }
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    seen.set(v, out);
    for (const x of v) out.push(copy(x, seen) ?? null);
    return out;
  }
  if (v instanceof Set) {
    const out: unknown[] = [];
    seen.set(v, out);
    for (const x of v) out.push(copy(x, seen) ?? null);
    return out;
  }
  const out: Record<string, unknown> = {};
  seen.set(v, out);
  const entries: [string, unknown][] = v instanceof Map ? [...v.entries()].map(([k, x]) => [String(k), x]) : Object.entries(v);
  for (const [k, x] of entries) {
    const c = copy(x, seen);
    if (c !== undefined) out[k] = c;
  }
  return out;
}

function union(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/** Bounds of an object and, for a group or symbol, of everything inside it; null when it has no geometry. */
export function boundsOf(doc: VwxDocument, id: string, depth = 0): BBox | null {
  const o = doc.object(id);
  if (!o || depth > 32) return null;
  let box: BBox | null = o.shape?.bbox ?? null;
  if (o.shape === null || o.kind === "group" || o.kind === "symbol") {
    for (const child of doc.objects(o.layerId)) {
      if (child.parentId === id) box = union(box, boundsOf(doc, child.id, depth + 1));
    }
  }
  return box;
}

/** Bounds of several objects together, or null when none has geometry. */
export function boundsOfAll(doc: VwxDocument, idList: readonly string[]): BBox | null {
  let box: BBox | null = null;
  for (const id of idList) box = union(box, boundsOf(doc, id));
  return box;
}

/** One edit as a [method, ...args] step, checked against the allow-list. */
function editStep(s: EditSession, method: unknown, args: unknown[]): unknown {
  if (typeof method !== "string" || !EDIT_SET.has(method)) throw new RefusedCall(`openvwx.edit.${String(method)} is not available to plug-ins.`);
  const fn = (s as unknown as Record<string, (...a: unknown[]) => unknown>)[method];
  if (typeof fn !== "function") throw new RefusedCall(`openvwx.edit.${method} is not available to plug-ins.`);
  return fn.apply(s, args);
}

function editBatch(env: CallEnv, steps: unknown): unknown[] {
  if (!Array.isArray(steps)) throw new TypeError("openvwx.edit.batch takes a list of [method, ...args] steps");
  const s = drawing(env);
  for (const step of steps) {
    if (!Array.isArray(step) || !isEditMethod(String(step[0]))) {
      throw new RefusedCall(`openvwx.edit.batch: ${Array.isArray(step) ? String(step[0]) : "a step"} is not available to plug-ins.`);
    }
  }
  // one undo step; if any step throws, session.batch rolls every change back
  return s.batch(() => (steps as unknown[][]).map((step) => editStep(s, step[0], step.slice(1))));
}

function layerOrActive(env: CallEnv, layerId: unknown): string {
  if (layerId === undefined || layerId === null) {
    if (!env.activeLayerId) throw new Error("No layer is active.");
    return env.activeLayerId;
  }
  return text(layerId, "the layer id");
}

/**
 * Runs one call. `method` is "doc.<read>", "edit.<mutation>", "edit.batch", "select",
 * "zoomTo", "activeLayer" or "setActiveLayer". Returns plain data; throws for anything else.
 */
export function dispatch(method: string, args: readonly unknown[], env: CallEnv): unknown {
  const a = Array.isArray(args) ? args : [];
  if (method.startsWith("doc.")) return readDoc(method.slice(4), a, env);
  if (method.startsWith("edit.")) {
    const name = method.slice(5);
    if (name === "batch") return editBatch(env, a[0]);
    if (!isEditMethod(name)) throw new RefusedCall(`openvwx.edit.${name} is not available to plug-ins.`);
    return editStep(drawing(env), name, a);
  }
  switch (method) {
    case "select": {
      const list = ids(a[0], "select(ids)");
      const effects = requireEffects(env);
      return plain(effects.select(list));
    }
    case "zoomTo": {
      const list = ids(a[0], "zoomTo(ids)");
      const box = boundsOfAll(drawing(env).doc, list);
      if (!box) return false;
      requireEffects(env).zoomTo(box);
      return true;
    }
    case "activeLayer":
      return env.activeLayerId;
    case "setActiveLayer": {
      const id = text(a[0], "setActiveLayer(id)");
      const layer = drawing(env).doc.layers().find((l) => l.id === id);
      if (!layer) throw new Error(`No layer has the id ${id}.`);
      requireEffects(env).setActiveLayer(id);
      return undefined;
    }
    default:
      throw new RefusedCall(`openvwx.${method} is not part of the plug-in API.`);
  }
}

function requireEffects(env: CallEnv): Effects {
  if (!env.effects) throw new Error("This call needs the editor window.");
  return env.effects;
}

function readDoc(name: string, a: readonly unknown[], env: CallEnv): unknown {
  switch (name) {
    case "info":
      return plain(drawing(env).doc.info);
    case "layers":
      return plain(drawing(env).doc.layers());
    case "classes":
      return plain(drawing(env).doc.classes());
    case "objects":
      return plain(drawing(env).doc.objects(layerOrActive(env, a[0])));
    case "object":
      return plain(drawing(env).doc.object(text(a[0], "the object id")));
    case "selection": {
      const doc = drawing(env).doc;
      const out: ObjectInfo[] = [];
      for (const id of env.selection) {
        const o = doc.object(id);
        if (o) out.push(o);
      }
      return plain(out);
    }
    case "records":
      return plain(drawing(env).doc.records(text(a[0], "the object id")));
    case "symbols":
      return plain(drawing(env).doc.symbolDefs());
    case "lineTypes":
      return plain(drawing(env).doc.lineTypes());
    case "colors":
      return plain(drawing(env).doc.colors());
    default:
      throw new RefusedCall(`openvwx.doc.${name} is not part of the plug-in API.`);
  }
}
