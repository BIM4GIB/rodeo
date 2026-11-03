// Text > Find-Replace Text…: finds and replaces text, as the Vectorworks command does. Its Action
// finds the next place that holds the text (selecting the object, on its layer, and zooming to it),
// replaces it there, replaces it in the selected objects, or replaces it everywhere. It looks in text
// objects, record fields (the text fields of records attached to objects; a plug-in object's own
// parameters and the text it draws are left alone, as Rodeo can't redraw most plug-ins from them) and
// worksheets' text cells, on the active layer, every layer or the visible ones, optionally matching
// case and whole words. Each replace is one undo step, and the settings are kept from one use to the
// next. Text inside symbol definitions is left alone: it is shared by every instance and cannot be
// edited here.

import type { ObjectInfo, VwxDocument } from "../core/index.ts";
import { attempt, setActiveLayer, setEditGroup, zoomToSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { columnName } from "./worksheetEditor.ts";

type Action = "next" | "replaceNext" | "selected" | "all";
type Layers = "active" | "all" | "visible";

const ACTIONS: readonly { readonly id: Action; readonly label: string }[] = [
  { id: "next", label: "Find Next" },
  { id: "replaceNext", label: "Replace Next" },
  { id: "selected", label: "Replace All Selected" },
  { id: "all", label: "Replace All" },
];
const LAYERS: readonly { readonly id: Layers; readonly label: string }[] = [
  { id: "active", label: "Active Layer Only" },
  { id: "all", label: "All Layers" },
  { id: "visible", label: "Visible Layers Only" },
];
const PLUGIN_TYPE = 86;

interface Search {
  readonly action: Action;
  readonly texts: boolean;
  readonly fields: boolean;
  readonly sheets: boolean;
  readonly find: string;
  readonly replace: string;
  readonly layers: Layers;
  readonly matchCase: boolean;
  readonly wholeWords: boolean;
}

/** the settings, kept from one use to the next */
let kept: Search = {
  action: "all",
  texts: true,
  fields: false,
  sheets: false,
  find: "",
  replace: "",
  layers: "active",
  matchCase: false,
  wholeWords: false,
};
/** the last place Find Next or Replace Next stopped at (Spot.key), where the next search starts after */
let last: string | null = null;

/** A place that holds text: a text object, a record field or a worksheet cell. */
type Spot =
  | { readonly kind: "text"; readonly key: string; readonly text: string; readonly obj: ObjectInfo }
  | { readonly kind: "field"; readonly key: string; readonly text: string; readonly obj: ObjectInfo; readonly format: number; readonly record: string; readonly field: string }
  | { readonly kind: "cell"; readonly key: string; readonly text: string; readonly sheet: number; readonly name: string; readonly row: number; readonly col: number };

/** True when `o` is a plug-in object or sits in one (its drawing, which the plug-in owns). */
function inPlugin(doc: VwxDocument, o: ObjectInfo): boolean {
  for (let cur: ObjectInfo | null = o, guard = 0; cur && guard < 256; guard++) {
    if (cur.type === PLUGIN_TYPE) return true;
    cur = cur.parentId ? doc.object(cur.parentId) : null;
  }
  return false;
}

/** The text of `o` and of its attached records' text fields, as places, when the search looks in them. */
function spotsOf(doc: VwxDocument, o: ObjectInfo, s: Search): Spot[] {
  if (isDerivedId(o.id)) return [];
  const out: Spot[] = [];
  if (s.texts && o.shape?.kind === "text" && !inPlugin(doc, o)) out.push({ kind: "text", key: `t:${o.id}`, text: o.shape.text ?? "", obj: o });
  if (s.fields) {
    for (const r of doc.records(o.id)) {
      if (r.parametric) continue;
      for (const f of r.fields) {
        if (f.kind !== "text" || typeof f.value !== "string") continue;
        out.push({ kind: "field", key: `f:${o.id}:${r.format}:${f.name}`, text: f.value, obj: o, format: r.format, record: r.name, field: f.name });
      }
    }
  }
  return out;
}

/** The layers the search covers, in the drawing's order. */
function layersOf(doc: VwxDocument, layers: Layers): string[] {
  const active = store.activeLayerId;
  if (layers === "active") return active ? [active] : [];
  return doc
    .layers()
    .filter((l) => layers === "all" || l.id === active || l.visibility !== "hidden")
    .map((l) => l.id);
}

/** Every place the search covers, in order: each layer's objects, then the worksheets' cells. */
function spots(doc: VwxDocument, s: Search): Spot[] {
  const out = layersOf(doc, s.layers).flatMap((id) => doc.objects(id).flatMap((o) => spotsOf(doc, o, s)));
  if (!s.sheets) return out;
  const sheets = doc
    .resources()
    .filter((r) => r.kind === "worksheet")
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const r of sheets) {
    const sheet = doc.worksheetContents(r.index);
    if (!sheet) continue;
    const cells = sheet.cells.filter((c) => c.kind === "text" && !sheet.database[c.row]).sort((a, b) => a.row - b.row || a.col - b.col);
    for (const c of cells) out.push({ kind: "cell", key: `c:${r.index}:${c.row}:${c.col}`, text: c.display, sheet: r.index, name: r.name, row: c.row, col: c.col });
  }
  return out;
}

/** The places in the selected objects (and the objects inside them). */
function selectedSpots(doc: VwxDocument, s: Search): Spot[] {
  const picked = new Set(store.selection);
  const within = (o: ObjectInfo): boolean => {
    for (let cur: ObjectInfo | null = o, guard = 0; cur && guard < 256; guard++) {
      if (picked.has(cur.id)) return true;
      cur = cur.parentId ? doc.object(cur.parentId) : null;
    }
    return false;
  };
  const layer = store.activeLayerId;
  return layer ? doc.objects(layer).filter(within).flatMap((o) => spotsOf(doc, o, s)) : [];
}

/** The pattern a search looks for: the text itself, not a regular expression. */
function patternOf(s: Search): RegExp {
  const escaped = s.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // a whole word has no letter, digit or underscore either side
  const body = s.wholeWords ? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])` : escaped;
  return new RegExp(body, s.matchCase ? "gu" : "giu");
}

/** Where a place is, as a toast names it. */
function described(doc: VwxDocument, spot: Spot): string {
  if (spot.kind === "cell") return `worksheet “${spot.name}”, cell ${columnName(spot.col)}${spot.row + 1}`;
  const layer = doc.layers().find((l) => l.id === spot.obj.layerId)?.name ?? "its layer";
  return spot.kind === "text" ? `a text object on ${layer}` : `the “${spot.field}” field of record “${spot.record}”, on ${layer}`;
}

/** Selects the object holding `spot` (the outermost group it sits in, as a click picks), on its layer, and zooms to it. */
function show(spot: Spot): void {
  const ctx = appContext();
  if (spot.kind === "cell" || !ctx) return;
  if (store.view3d) ctx.show2d();
  setActiveLayer(spot.obj.layerId);
  setEditGroup(null, [ctx.scene.topOf(spot.obj)]);
  zoomToSelection(ctx.scene, ctx.view);
}

/** Puts `after` in place of each place's text, as one undo step; true when it went in. */
function write(label: string, changes: readonly { spot: Spot; after: string }[]): boolean {
  const r = attempt(label, (s) =>
    s.batch(() => {
      for (const { spot, after } of changes) {
        if (spot.kind === "text") s.setText(spot.obj.id, after);
        else if (spot.kind === "field") s.setRecordField(spot.obj.id, spot.format, spot.field, after);
        else s.setWorksheetCell(spot.sheet, spot.row, spot.col, after);
      }
    }),
  );
  return r !== null;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Find Next and Replace Next: the next place after the last one that holds the text, round to the first. */
function findNext(doc: VwxDocument, s: Search, pattern: RegExp): void {
  const all = spots(doc, s);
  const at = last === null ? -1 : all.findIndex((x) => x.key === last);
  const order = [...all.slice(at + 1), ...all.slice(0, at + 1)];
  const spot = order.find((x) => x.text.search(pattern) >= 0);
  if (!spot) {
    last = null;
    toast(`Nothing ${s.layers === "active" ? "on the active layer" : s.layers === "visible" ? "on the visible layers" : "in the drawing"} holds “${s.find}”.`, "info");
    return;
  }
  last = spot.key;
  if (s.action === "next") {
    show(spot);
    toast(`Found in ${described(doc, spot)}.`, "info");
    return;
  }
  // a function, so "$" in the replacement is kept as typed
  const after = spot.text.replace(pattern, () => s.replace);
  if (spot.kind === "text" && after === "") {
    toast(`Not replaced in ${described(doc, spot)}: a text object can't be left empty.`, "info");
    return;
  }
  if (after !== spot.text && !write("Replace text", [{ spot, after }])) return;
  show(spot);
  toast(`Replaced in ${described(doc, spot)}.`, "info");
}

/** Replace All and Replace All Selected: every place, as one undo step. */
function replaceAll(doc: VwxDocument, s: Search, pattern: RegExp): void {
  const changes: { spot: Spot; after: string }[] = [];
  let found = 0;
  let empty = 0;
  for (const spot of s.action === "selected" ? selectedSpots(doc, s) : spots(doc, s)) {
    const n = spot.text.match(pattern)?.length ?? 0;
    if (n === 0) continue;
    found += n;
    const after = spot.text.replace(pattern, () => s.replace);
    if (spot.kind === "text" && after === "") empty++;
    else if (after !== spot.text) changes.push({ spot, after });
  }
  if (found === 0) {
    toast(`Nothing ${s.action === "selected" ? "selected" : "searched"} holds “${s.find}”.`, "info");
    return;
  }
  const skipped = empty ? `; ${plural(empty, "text object")} left as ${empty === 1 ? "it was" : "they were"}: a text object can't be left empty` : "";
  if (changes.length === 0) {
    toast(`Found ${plural(found, "match", "matches")}${skipped || "; the replacement is the same text"}.`, "info");
    return;
  }
  if (!write("Replace text", changes)) return;
  const kinds = (k: Spot["kind"], one: string): string => {
    const n = changes.filter((c) => c.spot.kind === k).length;
    return n ? plural(n, one) : "";
  };
  const where = [kinds("text", "text object"), kinds("field", "record field"), kinds("cell", "worksheet cell")].filter(Boolean).join(", ");
  toast(`Replaced ${plural(found, "match", "matches")} in ${where}${skipped}.`, "info");
}

/** Opens Find-Replace Text and does what its Action says. */
export async function findReplaceDialog(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const select = <T extends string>(label: string, options: readonly { id: T; label: string }[], value: T): HTMLSelectElement => {
    const el = h(
      "select",
      { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } },
      ...options.map((o) => h("option", { value: o.id, text: o.label })),
    );
    el.value = value;
    return el;
  };
  const text = (label: string, value: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input fr-text", value, attrs: { type: "text", "aria-label": label, spellcheck: "false" } });
  const check = (on: boolean): HTMLInputElement => h("input", { checked: on, attrs: { type: "checkbox" } });
  const field = (label: string, input: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input);
  const box = (input: HTMLInputElement, label: string): HTMLElement => h("label", { cls: "menu-dialog-check" }, input, label);

  const action = select("Action", ACTIONS, kept.action);
  const texts = check(kept.texts);
  const fields = check(kept.fields);
  const sheets = check(kept.sheets);
  const find = text("Find String", kept.find);
  const replace = text("Replace With", kept.replace);
  const layers = select("Options", LAYERS, kept.layers);
  const matchCase = check(kept.matchCase);
  const wholeWords = check(kept.wholeWords);
  // Find Next replaces nothing; a worksheet has no selection to replace in
  const sync = (): void => {
    replace.disabled = action.value === "next";
    sheets.disabled = action.value === "selected";
  };
  action.addEventListener("change", sync);
  sync();

  const search = await showDialog<Search>({
    title: "Find-Replace Text",
    okLabel: "Find/Replace",
    cls: "fr-dialog",
    body: [
      field("Action", action),
      h("div", { cls: "menu-dialog-label", text: "Look in" }),
      box(texts, "Text Objects"),
      box(fields, "Record Fields"),
      box(sheets, "Worksheets"),
      field("Find String", find),
      field("Replace With", replace),
      field("Options", layers),
      box(matchCase, "Case-sensitive"),
      box(wholeWords, "Whole words only"),
    ],
    check: () => {
      const a = action.value as Action;
      const looks = { texts: texts.checked, fields: fields.checked, sheets: sheets.checked && a !== "selected" };
      if (find.value === "") return { error: "Find String: enter the text to look for.", focus: find };
      if (!looks.texts && !looks.fields && !looks.sheets) return { error: "Look in: tick text objects, record fields or worksheets.", focus: texts };
      if (a === "selected" && store.selection.size === 0) return { error: "Replace All Selected: select the objects to replace in first.", focus: action };
      return {
        value: {
          action: a,
          ...looks,
          find: find.value,
          replace: replace.value,
          layers: layers.value as Layers,
          matchCase: matchCase.checked,
          wholeWords: wholeWords.checked,
        },
      };
    },
  });
  if (!search) return;
  // a new search starts from the top
  if (search.find !== kept.find || search.layers !== kept.layers || search.matchCase !== kept.matchCase) last = null;
  kept = { ...search, sheets: sheets.checked };
  const pattern = patternOf(search);
  if (search.action === "next" || search.action === "replaceNext") findNext(doc, search, pattern);
  else replaceAll(doc, search, pattern);
}
