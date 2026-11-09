// Tools > Utilities > Reset All Plug-Ins, Vectorworks' refresh of the drawing's plug-in objects: each
// one whose plug-in Rodeo can draw (an installed Vectorworks plug-in, or one Rodeo draws itself, such
// as Hyperlink) is drawn again from its parameters by its plug-in's current script, one after
// another, each its own undo step; then the result is reported. Those whose plug-ins Rodeo can't
// draw (Vectorworks' own: doors, windows, stairs…, or plug-ins not installed here) stay as they were
// last drawn, counted by plug-in in the report.

import { h } from "./dom.ts";
import { pluginDriver, type PluginDriver } from "./ext.ts";
import { confirmDialog, showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** Vectorworks' object type of a plug-in object */
const PLUGIN = 86;

interface PluginObject {
  readonly id: string;
  /** its plug-in: the name of its parameters' record */
  readonly name: string;
}

/** The plug-in objects on the drawing's layers, leaving out those a plug-in object draws (redrawing it replaces them). */
function pluginObjects(): PluginObject[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const inPlugin = (parentId: string | null): boolean => {
    for (let p = parentId; p; p = doc.object(p)?.parentId ?? null) if (doc.object(p)?.type === PLUGIN) return true;
    return false;
  };
  const seen = new Set<string>();
  const out: PluginObject[] = [];
  for (const layer of doc.layers()) {
    for (const o of doc.objects(layer.id)) {
      if (o.type !== PLUGIN || seen.has(o.id) || inPlugin(o.parentId)) continue;
      seen.add(o.id);
      const rec = doc.records(o.id).find((r) => r.parametric);
      if (rec) out.push({ id: o.id, name: rec.name });
    }
  }
  return out;
}

/** "Door (12), Window (4)": how many objects of each plug-in, most first. */
function byPlugin(objects: readonly PluginObject[]): string {
  const counts = new Map<string, number>();
  for (const o of objects) counts.set(o.name, (counts.get(o.name) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => `${name} (${n})`)
    .join(", ");
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Tools > Utilities > Reset All Plug-Ins: asks, draws each plug-in object Rodeo can draw again, and reports. */
export async function resetAllPluginsDialog(): Promise<void> {
  const all = pluginObjects();
  if (all.length === 0) {
    toast("This drawing has no plug-in objects to reset.", "info");
    return;
  }
  const drivers = new Map<string, PluginDriver | undefined>();
  const driverOf = (name: string): PluginDriver | undefined => {
    if (!drivers.has(name)) drivers.set(name, pluginDriver(name));
    return drivers.get(name);
  };
  const resets = (o: PluginObject): boolean => (driverOf(o.name)?.resets ?? true) && driverOf(o.name) !== undefined;
  const drawable = all.filter(resets);
  const other = all.filter((o) => !resets(o));
  const otherNote = other.length
    ? ` ${plural(other.length, "object")} of plug-ins Rodeo can't draw (Vectorworks' own, or ones not installed here) will stay as they were last drawn: ${byPlugin(other)}.`
    : "";
  if (drawable.length === 0) {
    await showDialog({
      title: "Reset All Plug-Ins",
      okLabel: "Close",
      body: [h("p", { cls: "menu-dialog-text", text: `None of this drawing's plug-in objects can be drawn here.${otherNote} Install a plug-in (Plug-ins > Vectorworks Plug-ins > Install…) to draw its objects.` })],
      check: () => ({ value: true }),
    });
    return;
  }
  const ok = await confirmDialog(
    "Reset All Plug-Ins",
    `Draw this drawing's ${plural(drawable.length, "plug-in object")} again from ${drawable.length === 1 ? "its" : "their"} parameters, with ${drawable.length === 1 ? "its plug-in's" : "their plug-ins'"} current scripts: ${byPlugin(drawable)}?${otherNote} Each is its own undo step.`,
    "Reset",
  );
  if (!ok) return;
  if (drawable.length > 1) toast(`Resetting ${plural(drawable.length, "plug-in object")}…`, "info");
  let done = 0;
  const failed: { readonly o: PluginObject; readonly why: string }[] = [];
  for (const o of drawable) {
    // a drawing closed or swapped, or an object gone, ends or skips the run
    if (!store.session?.doc.object(o.id)) continue;
    const why = await driverOf(o.name)!.reset(o.id);
    if (why === null) done++;
    else failed.push({ o, why });
  }
  const body: Node[] = [h("p", { cls: "menu-dialog-text", text: `${plural(done, "plug-in object")} reset.` })];
  if (failed.length) {
    body.push(
      h("p", {
        cls: "menu-dialog-text",
        text: `${plural(failed.length, "object")} couldn't be drawn: ${byPlugin(failed.map((f) => f.o))}. ${failed[0].o.name}: ${failed[0].why}`,
      }),
    );
  }
  if (other.length) body.push(h("p", { cls: "menu-dialog-text muted", text: `Left as they were last drawn: ${byPlugin(other)}.` }));
  await showDialog({ title: "Reset All Plug-Ins", okLabel: "Close", body, check: () => ({ value: true }) });
}
