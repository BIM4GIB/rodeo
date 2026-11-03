// Tools > Class and Layer Mapping: a list of the drawing's classes, then of its design layers, each with the
// name it's to have. A new name renames it, another's name merges it with that one, and a blank deletes it with
// the objects on it. Load and Save read and write Vectorworks' mapping files. Vectorworks works it with
// Existing, Proposed and Merged lists; a name per row says the same. Objects inside symbols and plug-in objects
// aren't deleted with a class, they go to None.

import { mappingPlan, mappingText, parseMapping, type MappingKind, type MappingRow } from "./classLayerMappingShapes.ts";
import "./classLayerMapping.css";
import { attempt, setActiveLayer } from "./commands.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { confirmDialog, showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import type { EditSession } from "../core/index.ts";

const NONE = "None";

/** One list of the dialog: its rows, what fills them from a file, and what puts them back. */
interface MappingList {
  readonly kind: MappingKind;
  readonly el: HTMLElement;
  rows(): MappingRow[];
  fill(from: ReadonlyMap<string, string>): void;
  reset(): void;
}

function mappingList(kind: MappingKind, names: readonly string[], fixed: ReadonlySet<string>): MappingList {
  const noun = kind === "class" ? "Class" : "Layer";
  const inputs = new Map(
    names.map((name) => {
      const input = h("input", { cls: "menu-dialog-input", attrs: { "aria-label": `${name}, proposed name` } });
      input.value = name;
      input.disabled = fixed.has(name);
      return [name, input];
    }),
  );
  const el = h(
    "div",
    { cls: "mapping-table" },
    h("span", { cls: "mapping-head", text: `Existing ${noun}` }),
    h("span", { cls: "mapping-head", text: "Proposed Name" }),
    ...names.flatMap((name) => [h("span", { cls: "mapping-name", text: name, attrs: { title: name } }), inputs.get(name)!]),
  );
  return {
    kind,
    el,
    rows: () => names.map((existing) => ({ existing, proposed: inputs.get(existing)!.value })),
    fill(from) {
      for (const [name, input] of inputs) if (!fixed.has(name)) input.value = from.get(name) ?? "";
    },
    reset() {
      for (const [name, input] of inputs) input.value = name;
    },
  };
}

/** The objects a blank would delete: those on the design layers in the class, not inside a symbol or plug-in object. */
function objectsInClass(s: EditSession, index: number): string[] {
  const out: string[] = [];
  for (const layer of s.doc.layers()) {
    if (layer.kind === "sheet") continue;
    for (const o of s.doc.objects(layer.id)) {
      if (o.classIndex !== index || isDerivedId(o.id)) continue;
      let loose = true;
      for (let p = o.parentId; p && loose; p = s.doc.object(p)?.parentId ?? null) loose = s.doc.object(p)?.kind === "group";
      if (loose) out.push(o.id);
    }
  }
  return out;
}

const topLevel = (s: EditSession, layerId: string): string[] => s.doc.objects(layerId).filter((o) => o.parentId === null && !isDerivedId(o.id)).map((o) => o.id);

/** Renames in two steps, so one can take a name another is giving up. */
function renameAll(renames: readonly { from: string; to: string }[], rename: (from: string, to: string) => void): void {
  const parked = renames.map((r, i) => ({ ...r, at: `\u0001mapping ${i}` }));
  for (const r of parked) rename(r.from, r.at);
  for (const r of parked) rename(r.at, r.to);
}

function applyClasses(s: EditSession, rows: readonly MappingRow[]): void {
  const plan = mappingPlan(rows);
  const index = (name: string): number => {
    const found = s.doc.classes().find((c) => c.name === name);
    if (!found) throw new Error(`There's no class "${name}".`);
    return found.index;
  };
  for (const m of plan.merges) s.deleteClass(index(m.from), index(m.into));
  for (const name of plan.deletes) {
    const objects = objectsInClass(s, index(name));
    if (objects.length) s.deleteObjects(objects);
    s.deleteClass(index(name));
  }
  renameAll(plan.renames, (from, to) => s.renameClass(index(from), to));
}

function applyLayers(s: EditSession, rows: readonly MappingRow[]): void {
  const plan = mappingPlan(rows);
  const id = (name: string): string => {
    const found = s.doc.layers().find((l) => l.name === name);
    if (!found) throw new Error(`There's no layer "${name}".`);
    return found.id;
  };
  for (const m of plan.merges) {
    const objects = topLevel(s, id(m.from));
    if (objects.length) s.setObjectLayer(objects, id(m.into));
    s.deleteLayer(id(m.from));
  }
  for (const name of plan.deletes) s.deleteLayer(id(name));
  renameAll(plan.renames, (from, to) => s.renameLayer(id(from), to));
}

function deleteEmpty(s: EditSession): void {
  if (s.purgeable().classes.length) s.purge(["classes"]);
  const designs = s.doc.layers().filter((l) => l.kind !== "sheet");
  const empty = designs.filter((l) => topLevel(s, l.id).length === 0);
  // a drawing keeps one design layer
  for (const l of empty.length === designs.length ? empty.slice(1) : empty) s.deleteLayer(l.id);
}

export async function classLayerMappingDialog(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const lists: Record<MappingKind, MappingList> = {
    class: mappingList("class", s.doc.classes().map((c) => c.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), new Set([NONE])),
    layer: mappingList("layer", s.doc.layers().filter((l) => l.kind !== "sheet").map((l) => l.name), new Set()),
  };
  let showing: MappingKind = "class";
  const holder = h("div", {}, lists.class.el);
  const go = h("button", { cls: "btn small", text: "Go To Layers >", attrs: { type: "button" } });
  go.addEventListener("click", () => {
    showing = showing === "class" ? "layer" : "class";
    holder.replaceChildren(lists[showing].el);
    go.textContent = showing === "class" ? "Go To Layers >" : "Go To Classes >";
  });
  const reset = h("button", { cls: "btn small", text: "Reset All", attrs: { type: "button" } });
  reset.addEventListener("click", () => lists[showing].reset());
  const save = h("button", { cls: "btn small", text: "Save…", attrs: { type: "button" } });
  save.addEventListener("click", () => downloadBlob(`${showing} mapping.txt`, new Blob([mappingText(showing, lists[showing].rows())], { type: "text/plain" })));
  const file = h("input", { attrs: { type: "file", accept: ".txt,text/plain", hidden: "", "aria-label": "Mapping file" } });
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    void f.text().then((text) => {
      const read = parseMapping(showing, text);
      if (typeof read === "string") toast(read);
      else lists[showing].fill(read);
    });
  });
  const load = h("button", { cls: "btn small", text: "Load…", attrs: { type: "button" } });
  load.addEventListener("click", () => file.click());
  const empty = h("input", { attrs: { type: "checkbox" } });
  const v = await showDialog<{ classes: MappingRow[]; layers: MappingRow[]; empty: boolean }>({
    title: "Class and Layer Mapping",
    okLabel: "OK",
    cls: "mapping-dialog",
    body: [
      h("p", { cls: "muted", text: "A new name renames it, another's name merges it with that one, and a blank deletes it with the objects on it." }),
      holder,
      h("div", { cls: "mapping-buttons" }, go, reset, load, save, file),
      h("label", { cls: "menu-dialog-check" }, empty, "Delete empty classes and layers in the proposed drawing"),
    ],
    check: () => {
      const layers = lists.layer.rows();
      if (layers.every((r) => !r.proposed.trim())) return { error: "A drawing needs at least one design layer." };
      return { value: { classes: lists.class.rows(), layers, empty: empty.checked } };
    },
  });
  if (!v || store.session !== s) return;
  const goneClasses = mappingPlan(v.classes).deletes;
  const goneLayers = mappingPlan(v.layers).deletes;
  if (goneClasses.length || goneLayers.length) {
    const count =
      goneClasses.reduce((sum, name) => sum + objectsInClass(s, s.doc.classes().find((c) => c.name === name)?.index ?? -1).length, 0) +
      goneLayers.reduce((sum, name) => sum + topLevel(s, s.doc.layers().find((l) => l.name === name)?.id ?? "").length, 0);
    const what = [goneClasses.length ? `${goneClasses.length} class${goneClasses.length === 1 ? "" : "es"}` : "", goneLayers.length ? `${goneLayers.length} layer${goneLayers.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");
    if (!(await confirmDialog("Class and Layer Mapping", `This deletes ${what} and about ${count} object${count === 1 ? "" : "s"} on them.`, "Delete")) || store.session !== s) return;
  }
  const r = attempt("Class and Layer Mapping", (s2) =>
    s2.batch(() => {
      applyClasses(s2, v.classes);
      applyLayers(s2, v.layers);
      if (v.empty) deleteEmpty(s2);
    }),
  );
  if (!r) return;
  const layers = s.doc.layers();
  if (!layers.some((l) => l.id === store.activeLayerId)) setActiveLayer(layers.find((l) => l.kind !== "sheet")?.id ?? layers[0].id);
  const current = s.doc.classes().some((c) => c.index === store.activeClassIndex);
  if (!current) store.activeClassIndex = s.doc.classes().find((c) => c.name === NONE)?.index ?? store.activeClassIndex;
  store.emit("session");
  toast(`The drawing now has ${s.doc.classes().length} classes and ${layers.filter((l) => l.kind !== "sheet").length} design layers.`, "info");
}

