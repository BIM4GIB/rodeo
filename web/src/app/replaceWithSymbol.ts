// Modify > Convert > Replace with Symbol…, as Vectorworks Fundamentals has it: the selected objects
// become instances of a symbol chosen from the drawing's definitions. A locus's instance goes on its
// point, a symbol instance keeps its placement and takes the new definition, and any other object's
// instance goes on the centre of its bounds, upright and at full size. Each instance keeps the
// layer and class of the object it replaces. The dialog says whether the objects' data records go
// with them (plug-in parameters never do) and whether the definition's own records are added, with
// the definition's values; an object's record wins over the definition's record of the same format.
// It asks to confirm, then the whole command is one undo step and the new instances are selected.

import type { BBox, ObjectInfo, Pt, RecordValue } from "../core/index.ts";
import { attempt, selectionEntries, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { confirmDialog, showDialog } from "./menubar.ts";
import { groupByFolder, symbolDefsOf } from "./panels/resources.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";

/** what the dialog chose last, while the page is open */
const last = { symbol: null as number | null, retain: true, addSymbol: true };

/** The selected objects at the level being edited. */
function selected(): ObjectInfo[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return s.doc.objects(layerId).filter((o) => store.selection.has(o.id) && o.parentId === scope && !isDerivedId(o.id));
}

export function canReplaceWithSymbol(): boolean {
  const doc = store.session?.doc;
  return !!doc && symbolDefsOf(doc).length > 0 && selected().length > 0;
}

/** Where an object's instance goes: a locus's point, else the centre of its bounds (as the drawing shows it). */
function placeOf(o: ObjectInfo, boxes: ReadonlyMap<string, BBox>): Pt | null {
  if (o.shape?.kind === "locus" && o.shape.points[0]) return o.shape.points[0];
  const b = boxes.get(o.id) ?? o.bounds;
  return b ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : null;
}

type Fields = Readonly<Record<string, RecordValue>>;

export async function replaceWithSymbolDialog(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return;
  const defs = symbolDefsOf(s.doc);
  const objs = selected();
  if (!defs.length || !objs.length) {
    toast(defs.length ? "Select the objects to replace first." : "This drawing has no symbols to replace objects with.", "info");
    return;
  }
  const select = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Symbol" } },
    ...[...groupByFolder(defs)].map(([folder, list]) => {
      const options = list.map((d) => h("option", { attrs: { translate: "no" }, value: String(d.index), text: d.name }));
      return folder ? h("optgroup", { attrs: { label: folder } }, ...options) : options;
    }).flat(),
  );
  if (last.symbol !== null && defs.some((d) => d.index === last.symbol)) select.value = String(last.symbol);
  const retain = h("input", { checked: last.retain, attrs: { type: "checkbox" } });
  const addSymbol = h("input", { checked: last.addSymbol, attrs: { type: "checkbox" } });
  const v = await showDialog<{ symbol: number; retain: boolean; addSymbol: boolean }>({
    title: "Choose a Symbol",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Symbol" }), select),
      h("label", { cls: "menu-dialog-check" }, retain, "Retain the objects' records"),
      h("label", { cls: "menu-dialog-check" }, addSymbol, "Add the symbol definition's records"),
    ],
    check: () => ({ value: { symbol: Number(select.value), retain: retain.checked, addSymbol: addSymbol.checked } }),
  });
  if (!v) return;
  Object.assign(last, v);
  const n = objs.length;
  const sure = await confirmDialog("Replace with Symbol", `Replace ${n === 1 ? "the selected object" : `all ${n} selected objects`} with the symbol?`, "Replace");
  if (!sure) return;
  const scene = appContext()?.scene;
  const boxes = new Map(scene ? selectionEntries(scene).map((e) => [e.id, e.box]) : []);
  const r = attempt("Replace with Symbol", (s) =>
    s.batch(() => {
      const made: string[] = [];
      // format → the new instances that take a record of it, with their values
      const records = new Map<number, { id: string; fields: Fields }[]>();
      const add = (format: number, id: string, fields: Fields): void => {
        const list = records.get(format) ?? [];
        if (!list.some((e) => e.id === id)) list.push({ id, fields });
        records.set(format, list);
      };
      const replaced: string[] = [];
      for (const o of objs) {
        const kept = s.doc.records(o.id).filter((rec) => !rec.parametric);
        let id: string;
        if (o.kind === "symbol") {
          s.replaceSymbol([o.id], v.symbol);
          id = o.id;
          // an instance carries its records over; discarding them takes them off
          if (!v.retain) for (const rec of kept) s.detachRecord([id], rec.format);
        } else {
          const at = placeOf(o, boxes);
          if (!at) continue;
          id = s.insertSymbol(o.layerId, v.symbol, at, o.classIndex);
          if (v.retain) for (const rec of kept) add(rec.format, id, Object.fromEntries(rec.fields.map((f) => [f.name, f.value])));
          replaced.push(o.id);
        }
        made.push(id);
      }
      if (v.addSymbol) {
        for (const rec of s.doc.symbolRecords(v.symbol)) {
          if (rec.parametric) continue;
          const fields = Object.fromEntries(rec.fields.map((f) => [f.name, f.value]));
          for (const id of made) {
            const has = records.get(rec.format)?.some((e) => e.id === id) || s.doc.records(id).some((x) => x.format === rec.format);
            if (!has) add(rec.format, id, fields);
          }
        }
      }
      for (const [format, values] of records) {
        s.attachRecord(values.map((e) => e.id), format);
        s.setRecordFields(format, values);
      }
      if (replaced.length) s.deleteObjects(replaced);
      return made;
    }),
  );
  if (!r) return;
  setSelection(r.value);
  const skipped = n - r.value.length;
  toast(`Replaced ${r.value.length} object${r.value.length === 1 ? "" : "s"} with the symbol${skipped ? ` (${skipped} without bounds left as they were)` : ""}.`, "info");
}
