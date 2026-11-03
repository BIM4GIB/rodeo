// AEC > Existing Trees > Import Tree Survey File…: a survey's rows as existing trees, or as 2D or 3D loci, each column
// mapped to a parameter and, if asked, kept in a custom record. A row can also give an area: a polygon. A tree here is the
// plain group the Existing Tree tool draws, so a column goes into a parameter only if it has one, and the record keeps the
// rest. Settings can be kept by name in this browser.

import type { EditSession, Pt, RecordFieldSpec } from "../core/index.ts";
import { attempt, setSelection, zoomToSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { geoToDrawing } from "./geoShapes.ts";
import { ensureGeoref } from "./georef.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { chooseFile, loadTable, surveyRowsOf } from "./surveyInput.ts";
import { guessDelimiter } from "./surveyShapes.ts";
import { toast } from "./toast.ts";
import { addPart } from "./tools/detailing.ts";
import { nextTreeNumber, treeName, treeParts, treeSettings } from "./tools/existingTree.ts";
import { FIELD_UNITS, mappedTree, type FieldUnit } from "./treeMapping.ts";
import {
  guessSurveyParameter,
  guessSurveyUnit,
  isUnit,
  locates,
  rowFields,
  siteOf,
  surveyTable,
  SURVEY_PARAMETERS,
  treeMappings,
  usesDegrees,
  type ColumnMapping,
  type SurveyParameter,
  type SurveyTable,
  type TreeSite,
} from "./treeSurveyShapes.ts";
import "./treeSurveyImport.css";

const AS_TREES = "trees";
const AS_2D = "2d";
const AS_3D = "3d";
const SETS_KEY = "rodeo.treeSurveySets";
const EXCEL = "Excel";
const TAB = "Tab delimited";
const OTHER = "Other";
const AREA_COLOUR = "#2f7d32";

interface KeptSet {
  readonly startRow: number;
  readonly headers: boolean;
  readonly useRecord: boolean;
  readonly record: string;
  readonly makes: string;
  readonly columns: Readonly<Record<string, { readonly parameter: string; readonly unit: string; readonly add: boolean }>>;
}

const readSets = (): Record<string, KeptSet> => {
  try {
    return JSON.parse(localStorage.getItem(SETS_KEY) ?? "{}") as Record<string, KeptSet>;
  } catch {
    return {};
  }
};

const writeSets = (sets: Readonly<Record<string, KeptSet>>): void => {
  try {
    localStorage.setItem(SETS_KEY, JSON.stringify(sets));
  } catch {
    toast("This browser won't keep saved settings.", "error");
  }
};

const select = (label: string, options: readonly { readonly value: string; readonly label: string }[], value: string, wide = false): HTMLSelectElement => {
  const el = h("select", { cls: `menu-dialog-input menu-dialog-select${wide ? " wide" : ""}`, attrs: { "aria-label": label } }, ...options.map((o) => h("option", { value: o.value, text: o.label })));
  el.value = value;
  return el;
};
const row = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
const heading = (text: string): HTMLElement => h("p", { cls: "menu-dialog-heading", text });

interface ColumnRow {
  readonly column: string;
  readonly parameter: HTMLSelectElement;
  readonly unit: HTMLSelectElement;
  readonly add: HTMLInputElement;
}

interface Answer {
  readonly table: SurveyTable;
  readonly mappings: readonly ColumnMapping[];
  readonly record: string | null;
  readonly kept: readonly string[];
  readonly makes: string;
}

/** The rows as objects on a layer; what was made, how many rows had no place and how many no tree. */
function placeTrees(s: EditSession, layerId: string, a: Answer, sites: readonly (TreeSite | null)[]): { made: string[]; noPlace: number; noTree: number } {
  const scale = s.doc.layers().find((l) => l.id === layerId)?.scale || 1;
  const units = s.doc.info.units;
  const mapped = treeMappings(a.mappings);
  const values = a.table.data.map((cells) => Object.fromEntries(a.table.columns.map((c, i) => [c, String(cells[i] ?? "").trim()])));
  let noPlace = 0;
  let noTree = 0;
  const trees: { number: string; parts: string[]; index: number }[] = [];
  const others: { id: string; index: number }[] = [];
  const colour = s.doc.colors().find((c) => c.css.toLowerCase() === AREA_COLOUR)?.index;
  sites.forEach((site, index) => {
    if (!site) {
      noPlace++;
      return;
    }
    if (site.kind === "area") {
      const id = s.addObject(layerId, { kind: "polygon", points: [...site.ring], closed: true }, store.activeClassIndex, { ...store.drawAttrs, fillPattern: 0, ...(colour === undefined ? {} : { penFore: colour }) });
      others.push({ id, index });
      return;
    }
    if (a.makes === AS_2D) {
      others.push({ id: s.addObject(layerId, { kind: "locus", at: site.at }, store.activeClassIndex, store.drawAttrs), index });
      return;
    }
    if (a.makes === AS_3D) {
      others.push({ id: s.add3DLoci(layerId, [[site.at.x, site.at.y, site.z ?? 0]], store.activeClassIndex)[0], index });
      return;
    }
    const tree = mappedTree({ tree: treeSettings.tree, botanical: treeSettings.botanical, common: treeSettings.common, significance: treeSettings.significance, number: null }, rowFields(values[index]), mapped, units);
    const number = tree.number ?? nextTreeNumber();
    const parts = treeParts({ ...tree, number }, site.at, 0, scale);
    if (!parts) {
      noTree++;
      return;
    }
    if (tree.number === null && treeSettings.auto) treeSettings.next++;
    trees.push({ number, parts: parts.map((part) => addPart(s, layerId, part)), index });
  });
  const groups = trees.length ? s.groupEach(trees.map((t) => t.parts)) : [];
  const taken = new Set<string>();
  trees.forEach((t, i) => {
    const name = treeName(t.number, taken);
    if (name) {
      s.setObjectName(groups[i], name);
      taken.add(name);
    }
  });
  const placed = [...trees.map((t, i) => ({ id: groups[i], index: t.index })), ...others];
  if (a.record && a.kept.length && placed.length) {
    const specs: RecordFieldSpec[] = a.kept.map((name) => ({ name, kind: "text", value: "" }));
    const had = s.doc.recordFormats().find((f) => f.name === a.record);
    const fits = had ? a.kept.every((name) => s.doc.recordFormatFields(had.format)?.some((f) => f.name === name)) : false;
    const names = new Set(s.doc.recordFormats().map((f) => f.name));
    let free = a.record;
    for (let n = 2; names.has(free); n++) free = `${a.record} ${n}`;
    const format = had && fits ? had.format : s.createRecordFormat(free, specs);
    const ids = placed.map((p) => p.id);
    s.attachRecord(ids, format);
    s.setRecordFields(format, placed.map((p) => ({ id: p.id, fields: Object.fromEntries(a.kept.map((name) => [name, values[p.index][name] ?? ""])) })));
  }
  return { made: placed.map((p) => p.id), noPlace, noTree };
}

export async function importTreeSurveyDialog(): Promise<void> {
  const session = store.session;
  const layerId = store.activeLayerId;
  if (!session || !layerId) return;
  const file = await chooseFile();
  if (!file || store.session !== session) return;
  const loaded = await loadTable(file, "Import Tree Survey File");
  if (!loaded || store.session !== session) return;
  const { sheetRows, text, book } = loaded;
  const guessed = book ? "\t" : guessDelimiter(text);
  const fileType = select(
    "File Type",
    [...(book ? [{ value: EXCEL, label: EXCEL }] : []), { value: TAB, label: TAB }, { value: OTHER, label: OTHER }],
    book ? EXCEL : guessed === "\t" ? TAB : OTHER,
    true,
  );
  fileType.disabled = book;
  const delimiter = h("input", { cls: "menu-dialog-input", value: guessed === "\t" ? "," : guessed, attrs: { "aria-label": "Delimiter Character", maxlength: "1" } });
  const delimiterRow = row("Delimiter Character", delimiter);
  const startRow = h("input", { cls: "menu-dialog-input", value: "1", attrs: { "aria-label": "Data Starts at Row Number", inputmode: "numeric" } });
  const headers = h("input", { attrs: { type: "checkbox", "aria-label": "Data has column headers" } });
  headers.checked = true;
  const useRecord = h("input", { attrs: { type: "checkbox", "aria-label": "Create custom record with name" } });
  useRecord.checked = true;
  const recordName = h("input", { cls: "menu-dialog-input", value: "Tree Survey", attrs: { "aria-label": "Record name" } });
  const makes = select(
    "Import as",
    [
      { value: AS_TREES, label: "Create existing tree objects" },
      { value: AS_2D, label: "Create 2D locus objects" },
      { value: AS_3D, label: "Create 3D locus objects" },
    ],
    AS_TREES,
    true,
  );
  const grid = h("div", { cls: "tree-survey-table" });
  const summary = h("p", { cls: "muted" });
  const rowsNow = (): string[][] => sheetRows ?? surveyRowsOf(text, fileType.value === TAB ? "\t" : delimiter.value || " ");
  const tableNow = (): SurveyTable => surveyTable(rowsNow(), Number(startRow.value) || 1, headers.checked);
  let rows: ColumnRow[] = [];
  let kept: KeptSet | null = null;
  const mappingsNow = (): ColumnMapping[] => rows.map((r) => ({ column: r.column, parameter: r.parameter.value as SurveyParameter, unit: r.unit.value as FieldUnit }));
  const refreshSummary = (): void => {
    const t = tableNow();
    const m = mappingsNow();
    const located = locates(m);
    summary.textContent = `${t.data.length} ${t.data.length === 1 ? "row" : "rows"} of data. ${located ? "" : "Map a column or two to its location: X and Y, a pair of coordinates, or latitude and longitude."}`.trim();
  };
  const build = (): void => {
    const t = tableNow();
    const was = new Map(rows.map((r) => [r.column, r]));
    const first = t.data[0] ?? [];
    rows = t.columns.map((column) => {
      const old = was.get(column);
      const set = kept?.columns[column];
      const parameter = select(`${column} Parameter`, SURVEY_PARAMETERS.map((p) => ({ value: p.id, label: p.label })), set?.parameter ?? old?.parameter.value ?? guessSurveyParameter(column));
      const unit = select(`${column} Unit`, FIELD_UNITS.map((u) => ({ value: u.id, label: u.label })), set && isUnit(set.unit) ? set.unit : (old?.unit.value ?? guessSurveyUnit(column)));
      const add = h("input", { attrs: { type: "checkbox", "aria-label": `${column} Add to Record` } });
      add.checked = set?.add ?? old?.add.checked ?? true;
      parameter.addEventListener("change", refreshSummary);
      return { column, parameter, unit, add };
    });
    grid.replaceChildren(
      ...["Survey Column", "First Row", "Parameter", "Unit", "Add to Record"].map((text) => h("span", { cls: "tree-survey-head", text })),
      ...rows.flatMap((r, i) => [
        h("span", { cls: "tree-survey-name", text: r.column, attrs: { title: r.column } }),
        h("span", { cls: "tree-survey-name muted", text: String(first[i] ?? ""), attrs: { title: String(first[i] ?? "") } }),
        r.parameter,
        r.unit,
        h("label", { cls: "tree-survey-add" }, r.add),
      ]),
    );
    delimiterRow.style.display = fileType.value === OTHER ? "" : "none";
    recordName.disabled = !useRecord.checked;
    refreshSummary();
  };
  for (const el of [fileType, headers, useRecord]) el.addEventListener("change", build);
  for (const el of [startRow, delimiter]) el.addEventListener("input", build);

  // saved settings
  const setChoice = select("Saved Settings", [], "", true);
  const fillSets = (name = ""): void => {
    const sets = Object.keys(readSets());
    setChoice.replaceChildren(h("option", { value: "", text: sets.length ? "Choose a set…" : "No saved sets" }), ...sets.map((n) => h("option", { value: n, text: n })));
    setChoice.value = name;
  };
  fillSets();
  const setName = h("input", { cls: "menu-dialog-input", value: "", attrs: { "aria-label": "Set name", placeholder: "Name" } });
  const saveSet = h("button", { cls: "btn small", text: "Save", attrs: { type: "button" } });
  const dropSet = h("button", { cls: "btn small", text: "Delete", attrs: { type: "button" } });
  saveSet.addEventListener("click", () => {
    const name = setName.value.trim();
    if (!name) {
      setName.focus();
      return;
    }
    writeSets({
      ...readSets(),
      [name]: {
        startRow: Number(startRow.value) || 1,
        headers: headers.checked,
        useRecord: useRecord.checked,
        record: recordName.value,
        makes: makes.value,
        columns: Object.fromEntries(rows.map((r) => [r.column, { parameter: r.parameter.value, unit: r.unit.value, add: r.add.checked }])),
      },
    });
    fillSets(name);
  });
  dropSet.addEventListener("click", () => {
    const sets = readSets();
    delete sets[setChoice.value];
    writeSets(sets);
    fillSets();
  });
  setChoice.addEventListener("change", () => {
    const set = readSets()[setChoice.value];
    if (!set) return;
    startRow.value = String(set.startRow);
    headers.checked = set.headers;
    useRecord.checked = set.useRecord;
    recordName.value = set.record;
    makes.value = set.makes;
    setName.value = setChoice.value;
    kept = set;
    build();
    kept = null;
  });
  build();

  const answer = await showDialog<Answer>({
    title: "Import Tree Survey",
    okLabel: "OK",
    cls: "tree-survey-dialog",
    body: [
      row("Saved Settings", setChoice),
      h("div", { cls: "tree-survey-sets" }, setName, saveSet, dropSet),
      heading("Survey File Format"),
      row("File Type", fileType),
      delimiterRow,
      heading("Survey Data"),
      row("Data Starts at Row Number", startRow),
      h("label", { cls: "menu-dialog-check" }, headers, "Data has column headers"),
      h("label", { cls: "menu-dialog-check" }, useRecord, "Create custom record with name"),
      row("Record", recordName),
      heading("Survey Mapping"),
      grid,
      summary,
      heading("Import Options"),
      row("Import as", makes),
      h("p", { cls: "muted", text: "A tree takes the columns it has a parameter for, and the Existing Tree tool's settings for the rest. Loci take only their place and the record." }),
    ],
    check: () => {
      const t = tableNow();
      const mappings = mappingsNow();
      if (!t.data.length) return { error: "There's no data from that row on.", focus: startRow };
      if (!locates(mappings)) return { error: "Map a column or two to its location: X and Y, a pair of coordinates, or latitude and longitude." };
      const name = useRecord.checked ? recordName.value.trim() : null;
      if (useRecord.checked && !name) return { error: "Give the record a name.", focus: recordName };
      return { value: { table: t, mappings, record: name, kept: rows.filter((r) => r.add.checked).map((r) => r.column), makes: makes.value } };
    },
  });
  if (!answer || store.session !== session) return;
  const georef = usesDegrees(answer.mappings) ? await ensureGeoref() : null;
  if (usesDegrees(answer.mappings) && !georef) return;
  if (store.session !== session) return;
  const units = session.doc.info.units;
  const toDrawing = (p: { lat: number; lon: number }): Pt | null => (georef ? geoToDrawing(georef, p) : null);
  const sites = answer.table.data.map((cells) => siteOf(Object.fromEntries(answer.table.columns.map((c, i) => [c, String(cells[i] ?? "")])), answer.mappings, units, toDrawing));
  const r = attempt("Import Tree Survey File", (s) => s.batch(() => placeTrees(s, layerId, answer, sites)));
  if (!r) return;
  const { made, noPlace, noTree } = r.value;
  setSelection(made);
  const ctx = appContext();
  if (ctx && made.length) {
    zoomToSelection(ctx.scene, ctx.view);
    ctx.requestDraw();
  }
  const what = answer.makes === AS_TREES ? "existing tree" : answer.makes === AS_2D ? "2D locus" : "3D locus";
  const plural = answer.makes === AS_TREES ? "existing trees" : answer.makes === AS_2D ? "2D loci" : "3D loci";
  const notes = [noPlace ? `${noPlace} with no location skipped` : "", noTree ? `${noTree} with a canopy or DBH of nothing skipped` : ""].filter(Boolean).join("; ");
  toast(`Made ${made.length} ${made.length === 1 ? what : plural}${notes ? `; ${notes}` : ""}.`, made.length ? "info" : "error");
}
