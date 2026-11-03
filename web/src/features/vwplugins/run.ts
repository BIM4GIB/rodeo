// Running an installed Vectorworks plug-in's script (python/runner.ts): a command or tool on the
// drawing, an object placed or drawn again. Parameters start at their defaults, a dimension's from
// its imperial or metric default by the drawing's units. A linear object's record also holds
// LineLength, a rectangular one's BoxWidth and BoxHeight (P LineLength... in its script), as the
// plug-ins that declare them show Vectorworks keeping them. An object's script also runs for the
// events of its own Object Info layout: setting it up, greying and hiding its widgets for an object,
// and a button clicked. Plug-in runs go one at a time.

import { fieldKind, type PluginFieldSpec, type Pt, type RecordValue } from "../../core/index.ts";
import { setEditGroup, setSelection } from "../../app/commands.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { parseLength } from "../../app/units.ts";
import type { VwObjectShape, VwParam, VwPlugin } from "../../import/vwplugin.ts";
import { showAlert } from "../plugins/ui.ts";
import { runScript, type PluginRun, type PluginUi, type RunEvents, type RunOutcome } from "../python/runner.ts";

/** A plug-in as installed, read. */
export interface Installed {
  readonly id: string;
  readonly file: string;
  readonly plugin: VwPlugin;
  readonly modules: Readonly<Record<string, string>>;
  /** how an object is placed (a command's or tool's is "point") */
  readonly shape: VwObjectShape;
}

/** a new object's length, or its rectangle's sides, when a click places it: mm */
const CLICK_SIZE = 1000;
const TEXT = 4;
const DIMENSION = 7;
const SIZE_FIELDS: Readonly<Record<VwObjectShape, readonly string[]>> = { point: [], path: [], linear: ["LineLength"], rect: ["BoxWidth", "BoxHeight"] };

function imperial(units: string | undefined): boolean {
  return /inch|feet|foot|yard|mile/i.test(units ?? "");
}

/** A parameter's default as its record holds it: a dimension in mm. */
function defaultValue(p: VwParam, units: string | undefined): RecordValue {
  const text = p.default.trim();
  switch (fieldKind(p.type)) {
    case "integer":
    case "color": {
      const n = parseInt(text, 10);
      return Number.isFinite(n) ? n : 0;
    }
    case "boolean":
      return /^true$/i.test(text);
    case "number":
    case "angle":
    case "area":
    case "volume": {
      const n = parseFloat(text);
      return Number.isFinite(n) ? n : 0;
    }
    case "dimension": {
      const [first, second] = imperial(units) ? [p.default, p.metricDefault] : [p.metricDefault, p.default];
      const t = (first.trim() || second).trim();
      return (t ? parseLength(t, units) : null) ?? 0;
    }
    default:
      return p.default;
  }
}

/**
 * The plug-in's fields with their defaults, the size fields of its shape first when it doesn't
 * declare them, and those set from a drag's `size`. A parameter of a type Rodeo doesn't read is
 * kept as text.
 */
export function fieldSpecs(it: Installed, units: string | undefined, size: { readonly width: number; readonly height: number } | null): PluginFieldSpec[] {
  const sizes = SIZE_FIELDS[it.shape];
  const sized = (name: string): number | undefined => {
    const i = sizes.findIndex((n) => n.toLowerCase() === name.toLowerCase());
    return i < 0 ? undefined : size ? [size.width, size.height][i] : undefined;
  };
  const declared = new Set(it.plugin.params.map((p) => p.name.toLowerCase()));
  const out: PluginFieldSpec[] = sizes.filter((n) => !declared.has(n.toLowerCase())).map((name) => ({ name, type: DIMENSION, value: sized(name) ?? CLICK_SIZE }));
  for (const p of it.plugin.params) {
    const known = fieldKind(p.type) !== null;
    out.push({ name: p.name, type: known ? p.type : TEXT, value: sized(p.name) ?? (known ? defaultValue(p, units) : p.default) });
  }
  return out;
}

/** The events Vectorworks sends an object's script for its Object Info layout (vsoGetEventInfo's). */
const INIT_PROPERTIES = 5;
const WIDGET_PREP = 41;
const BUTTON_HIT = 35;

function events(name: string): RunEvents {
  return {
    print(kind, text) {
      if (kind === "system") toast(text, "info");
      else (kind === "warn" ? console.warn : console.info)(`${name}: ${text}`);
    },
  };
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` once the plug-in runs before it have finished, so that none is refused as busy. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

function scriptFile(it: Installed): string {
  return `${it.plugin.name}.${it.plugin.language === "vectorscript" ? "vs" : "py"}`;
}

function problem(r: RunOutcome): string {
  return r.error ? `${r.error.message}${r.error.line ? ` (line ${r.error.line} of its script)` : ""}` : "";
}

/** Runs the plug-in's script (after those before it); its outcome, with any error unshown. */
function outcome(it: Installed, extra: Partial<PluginRun>): Promise<RunOutcome> {
  const units = store.session?.doc.info.units;
  const plugin: PluginRun = { name: it.plugin.name, fields: fieldSpecs(it, units, null), modules: it.modules, ...extra };
  return serial(() => runScript(it.plugin.script, scriptFile(it), events(it.plugin.name), plugin));
}

/** Runs the plug-in's script; false when it failed, the reason shown. */
async function run(it: Installed, extra: Partial<PluginRun>): Promise<RunOutcome | false> {
  const r = await outcome(it, extra);
  if (r.error) {
    await showAlert(it.plugin.name, problem(r));
    return false;
  }
  return r;
}

/** A menu command's or tool's script, run on the drawing. */
export async function runCommand(it: Installed): Promise<void> {
  await run(it, {});
}

/** Places a new object of the plug-in, drawn by its script, and selects it. */
export async function placeObject(it: Installed, layer: string, at: Pt, angle: number, size: { readonly width: number; readonly height: number } | null): Promise<void> {
  const fields = fieldSpecs(it, store.session?.doc.info.units, size);
  const r = await run(it, { fields, place: { layer, at, angle, classIndex: store.activeClassIndex } });
  // the new object goes on the layer, not into the group being edited
  if (r && r.object) setEditGroup(null, [r.object]);
}

/** Sets fields of an object of the plug-in and draws it again; Object Info shows the old values when that fails. */
export async function editObject(it: Installed, id: string, values: Readonly<Record<string, RecordValue>>): Promise<void> {
  if ((await run(it, { object: id, set: values })) === false) setSelection([...store.selection]);
}

/** Draws an object of the plug-in again from its parameters (Reset All Plug-Ins): null when done, else why it failed, unshown. */
export async function resetObject(it: Installed, id: string): Promise<string | null> {
  const r = await outcome(it, { object: id, set: {} });
  return r.error ? problem(r) : null;
}

/**
 * What the plug-in sets up for its Object Info layout: its script run for that event, with no object.
 * Null when that run fails (the plug-in's fields are then listed as they are), the reason logged.
 */
export async function setUpLayout(it: Installed): Promise<PluginUi | null> {
  const r = await outcome(it, { event: INIT_PROPERTIES });
  if (r.error) console.warn(`${it.plugin.name}: its Object Info layout couldn't be set up: ${problem(r)}`);
  return r.error ? null : (r.ui ?? null);
}

/** Which widgets of its layout object `id` greys or hides, as its script says; null when that run fails. */
export async function prepareWidgets(it: Installed, id: string): Promise<PluginUi["states"] | null> {
  const r = await outcome(it, { object: id, event: WIDGET_PREP });
  if (r.error) console.warn(`${it.plugin.name}: its widgets couldn't be updated: ${problem(r)}`);
  return r.error ? null : (r.ui?.states ?? {});
}

/** A button of its layout clicked on object `id`: the script runs for it, then draws the object again with what it set. */
export async function pressButton(it: Installed, id: string, widget: number): Promise<void> {
  const r = await run(it, { object: id, event: BUTTON_HIT, eventData: widget });
  if (!r) return;
  if (r.ignored) console.warn(`${it.plugin.name}: its button made ${r.ignored} change${r.ignored === 1 ? "" : "s"} besides its parameters, which weren't applied`);
  const set = r.set ?? {};
  if (Object.keys(set).length || r.reset) await editObject(it, id, set);
}
