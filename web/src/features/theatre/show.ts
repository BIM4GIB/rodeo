// A show's data that belongs to no one object (its stage origin, linesets, scenes, looks), saved in the
// drawing. Each key is JSON in a "Rodeo Show Data" plug-in object that draws nothing, so it travels with
// the file, undo covers it and live collaboration shares it. Vectorworks keeps such an object as it is.

import { store } from "../../app/state.ts";
import { attempt } from "../../app/commands.ts";
import { registerPluginDrivers, type PluginDriver } from "../../app/ext.ts";
import type { EditSession, PluginFieldSpec, VwxDocument } from "../../core/index.ts";

export const SHOW_DATA = "Rodeo Show Data";
const KEY = "Key";
const JSON_FIELD = "Json";
const TEXT = 4;
const PLUGIN = 86;
const FIELDS: readonly PluginFieldSpec[] = [
  { name: KEY, type: TEXT, value: "" },
  { name: JSON_FIELD, type: TEXT, value: "" },
];

interface Stored {
  readonly id: string;
  readonly format: number;
  readonly json: string;
}

/** Each key's object in `doc`. */
function storedOf(doc: VwxDocument): Map<string, Stored> {
  const out = new Map<string, Stored>();
  for (const layer of doc.layers()) {
    if (layer.kind !== "design") continue;
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN) continue;
      const rec = doc.records(o.id).find((r) => r.parametric && r.name === SHOW_DATA);
      if (!rec) continue;
      const key = String(rec.fields.find((f) => f.name === KEY)?.value ?? "");
      out.set(key, { id: o.id, format: rec.format, json: String(rec.fields.find((f) => f.name === JSON_FIELD)?.value ?? "") });
    }
  }
  return out;
}

/** The stored objects, read once per change of the drawing. */
let memo: { session: EditSession; stored: Map<string, Stored> } | null = null;
const watched = new WeakSet<EditSession>();

function stored(s: EditSession): Map<string, Stored> {
  if (memo?.session === s) return memo.stored;
  if (!watched.has(s)) {
    watched.add(s);
    s.onChange(() => {
      if (memo?.session === s) memo = null;
    });
  }
  const map = storedOf(s.doc);
  memo = { session: s, stored: map };
  return map;
}

/** The value under `key` in the open drawing, or `fallback` when there's none (or no drawing). */
export function readShow<T>(key: string, fallback: T): T {
  const s = store.session;
  if (!s) return fallback;
  const json = stored(s).get(key)?.json;
  if (!json) return fallback;
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}

/** Sets `key` in session `s`, within the caller's batch (so it undoes with what it goes with). */
export function writeShowIn(s: EditSession, key: string, value: unknown): void {
  const json = JSON.stringify(value);
  const was = stored(s).get(key);
  if (was) {
    if (was.json !== json) s.setRecordField(was.id, was.format, JSON_FIELD, json);
    return;
  }
  const layer = s.doc.layers().find((l) => l.kind === "design");
  if (!layer) throw new Error("This drawing has no design layer to keep show data on.");
  const id = s.addPluginObject(layer.id, SHOW_DATA, FIELDS, { [KEY]: key, [JSON_FIELD]: json }, { x: 0, y: 0 }, 0);
  s.setPluginDrawing(id, []);
}

/** Sets `key` in the open drawing as one undo step named `label`; false if it couldn't. */
export function writeShow(label: string, key: string, value: unknown): boolean {
  return attempt(label, (s) => s.batch(() => writeShowIn(s, key, value))) !== null;
}

const driver: PluginDriver = {
  name: SHOW_DATA,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: () => true,
  choices: () => undefined,
  place: () => {},
  edit: () => {},
  reset: async () => null,
  layout: () => null,
  widgetStates: () => {},
  press: () => {},
};
registerPluginDrivers(() => [driver]);
