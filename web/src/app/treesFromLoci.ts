// AEC > Existing Trees > Create Existing Trees from Loci: each selected locus, 2D or 3D, or symbol becomes
// an existing tree at its place, its survey record's fields mapped to the tree's parameters. Without a
// record the trees take the Existing Tree tool's settings. A tree here is the plain group that tool draws,
// so a field goes into a parameter only if it has one (a tree's Height or Condition doesn't), and Preserve
// Record keeps all of it. A symbol's tree goes at its insertion point, not at the locus inside it. The
// mapping is remembered while the page is open; Vectorworks also has saved sets.

import type { ObjectInfo, ObjectRecord, Pt } from "../core/index.ts";
import { attempt, setEditGroup } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { addPart } from "./tools/detailing.ts";
import { nextTreeNumber, treeName, treeParts, treeSettings } from "./tools/existingTree.ts";
import { FIELD_UNITS, guessParameter, mappedTree, TREE_PARAMETERS, type FieldMapping, type FieldUnit, type TreeParameter } from "./treeMapping.ts";
import "./treesFromLoci.css";

const LOCUS3D = 9;

/** the mapping last used for each record */
const remembered = new Map<string, FieldMapping[]>();
const last = { use: true, preserve: true, record: "" };

function selectedItems(): ObjectInfo[] {
  const s = store.session;
  const layer = store.activeLayerId;
  if (!s || !layer) return [];
  return s.doc.objects(layer).filter((o) => store.selection.has(o.id) && o.parentId === store.editGroupId && !isDerivedId(o.id) && placeOf(o) !== null);
}

/** Where a selected thing's tree goes; null when it isn't a locus or a symbol. */
function placeOf(o: ObjectInfo): Pt | null {
  if (o.shape?.kind === "locus") return o.shape.points[0] ?? null;
  if (o.type === LOCUS3D) {
    const p = store.session?.curvePoints(o.id)?.points[0];
    return p ? { x: p[0], y: p[1] } : null;
  }
  return o.symbol !== undefined && o.insertion ? o.insertion : null;
}

export const canCreateTreesFromLoci = (): boolean => selectedItems().length > 0;

const dataRecords = (o: ObjectInfo): ObjectRecord[] => store.session?.doc.records(o.id).filter((r) => !r.parametric) ?? [];

const select = (label: string, cls: string, options: readonly { readonly id: string; readonly label: string }[], value: string): HTMLSelectElement => {
  const el = h("select", { cls: `menu-dialog-input menu-dialog-select ${cls}`, attrs: { "aria-label": label } }, ...options.map((o) => h("option", { text: o.label, attrs: { value: o.id } })));
  el.value = value;
  return el;
};

export async function treesFromLociDialog(): Promise<void> {
  const s = store.session;
  const items = selectedItems();
  if (!s || !items.length) return;
  const records = new Map<string, ObjectRecord>();
  for (const o of items) for (const r of dataRecords(o)) if (!records.has(r.name)) records.set(r.name, r);
  const names = [...records.keys()];
  const use = h("input", { attrs: { type: "checkbox", "aria-label": "Use Attached Record" } });
  use.checked = last.use && names.length > 0;
  use.disabled = !names.length;
  const preserve = h("input", { attrs: { type: "checkbox", "aria-label": "Preserve Record in new Existing Trees" } });
  preserve.checked = last.preserve;
  const record = select("Record", "wide", names.map((n) => ({ id: n, label: n })), names.includes(last.record) ? last.record : (names[0] ?? ""));
  const table = h("div", { cls: "trees-loci-table" });
  let rows: { field: string; parameter: HTMLSelectElement; unit: HTMLSelectElement }[] = [];
  const buildTable = (): void => {
    const r = records.get(record.value);
    const known = remembered.get(record.value);
    rows = (r?.fields ?? []).map((f) => {
      const was = known?.find((m) => m.field === f.name);
      return {
        field: f.name,
        parameter: select(`${f.name} Parameter`, "", TREE_PARAMETERS, was?.parameter ?? guessParameter(f.name)),
        unit: select(`${f.name} Unit`, "", FIELD_UNITS, was?.unit ?? "auto"),
      };
    });
    table.replaceChildren(
      ...["Field Name", "Parameter", "Unit", "Field Type"].map((text) => h("span", { cls: "trees-loci-head", text })),
      ...rows.flatMap((row) => {
        const f = r!.fields.find((x) => x.name === row.field)!;
        return [h("span", { cls: "trees-loci-name", text: f.name, attrs: { title: f.name } }), row.parameter, row.unit, h("span", { cls: "muted", text: f.kind })];
      }),
    );
  };
  const showing = (): void => {
    const on = use.checked;
    record.disabled = !on;
    preserve.disabled = !on;
    table.hidden = !on;
  };
  record.addEventListener("change", buildTable);
  use.addEventListener("change", showing);
  buildTable();
  showing();
  const count = `${items.length} ${items.length === 1 ? "tree" : "trees"}`;
  const v = await showDialog<{ mappings: FieldMapping[] | null; preserve: boolean; record: string }>({
    title: "Create Existing Trees from Loci",
    okLabel: "OK",
    cls: "trees-loci-dialog",
    body: [
      h("p", { cls: "muted", text: names.length ? `Makes ${count} and removes what's selected. A field with nothing in it leaves the tool's setting.` : `Makes ${count} with the Existing Tree tool's settings and removes what's selected: nothing selected has a record.` }),
      h("label", { cls: "menu-dialog-check" }, use, "Use Attached Record"),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Record" }), record),
      h("label", { cls: "menu-dialog-check" }, preserve, "Preserve Record in new Existing Trees"),
      table,
    ],
    check: () => ({
      value: {
        mappings: use.checked ? rows.map((r) => ({ field: r.field, parameter: r.parameter.value as TreeParameter, unit: r.unit.value as FieldUnit })) : null,
        preserve: preserve.checked,
        record: record.value,
      },
    }),
  });
  if (!v || store.session !== s) return;
  last.use = v.mappings !== null;
  last.preserve = v.preserve;
  last.record = v.record;
  if (v.mappings) remembered.set(v.record, v.mappings);
  const units = s.doc.info.units;
  let skipped = 0;
  const r = attempt("Create Existing Trees from Loci", (session) =>
    session.batch(() => {
      const taken = new Set<string>();
      const trees: { item: ObjectInfo; rec: ObjectRecord | undefined; number: string; parts: string[] }[] = [];
      for (const o of items) {
        const at = placeOf(o)!;
        const rec = v.mappings ? dataRecords(o).find((x) => x.name === v.record) : undefined;
        const values = mappedTree({ tree: treeSettings.tree, botanical: treeSettings.botanical, common: treeSettings.common, significance: treeSettings.significance, number: null }, rec?.fields ?? [], v.mappings ?? [], units);
        const number = values.number ?? nextTreeNumber();
        const scale = session.doc.layers().find((l) => l.id === o.layerId)?.scale || 1;
        const parts = treeParts({ ...values, number }, at, 0, scale);
        if (!parts) {
          skipped++;
          continue;
        }
        if (values.number === null && treeSettings.auto) treeSettings.next++;
        trees.push({ item: o, rec, number, parts: parts.map((part) => addPart(session, o.layerId, part)) });
      }
      const made = session.groupEach(trees.map((t) => t.parts));
      trees.forEach(({ rec, number }, i) => {
        const name = treeName(number, taken);
        if (name) {
          session.setObjectName(made[i], name);
          taken.add(name);
        }
        if (rec && v.preserve) {
          session.attachRecord([made[i]], rec.format);
          session.setRecordFields(rec.format, [{ id: made[i], fields: Object.fromEntries(rec.fields.map((f) => [f.name, f.value])) }]);
        }
      });
      session.deleteObjects(trees.map((t) => t.item.id));
      return made;
    }),
  );
  if (!r) return;
  setEditGroup(null, r.value);
  const said = `Made ${r.value.length} existing ${r.value.length === 1 ? "tree" : "trees"}`;
  toast(skipped ? `${said}; ${skipped} left as ${skipped === 1 ? "it was" : "they were"}, with a canopy or DBH of nothing.` : `${said}.`, "info");
}
