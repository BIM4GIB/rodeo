// File > Title Block Manager…: the drawing's title blocks' data, as Vectorworks' Title Block
// Manager edits it. Project Data goes to every title block; Sheet Data to the sheets ticked, one
// or several at once (a field their values differ in shows "Varies" and stays as each has it
// unless edited). Sheet Number and Sheet Title rename the sheet too. Every change goes in as one
// undo step, with the title blocks' drawn text where it shows a changed value exactly
// (titleBlockData.ts). Revision and issue data aren't edited here yet.

import type { ObjectRecord, RecordField, RecordValue, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { applyTitleBlockChanges, dataRecord, findTitleBlocks, PROJECT_DATA, SHEET_DATA, type FieldChange, type TitleBlock } from "./titleBlockData.ts";
import "./titleBlockManager.css";

/** what a field shows when the title blocks it edits differ */
const VARIES = "Varies";

interface FieldEditor {
  readonly field: string;
  readonly row: HTMLElement;
  /** shows what the title blocks hold of it (one value, or "Varies"), unless it was edited */
  show(values: readonly RecordValue[]): void;
  /** the value entered: null when untouched */
  read(): { value: RecordValue } | { error: string; focus: HTMLElement } | null;
}

function fieldEditor(f: RecordField): FieldEditor | null {
  if (f.name.startsWith("__")) return null;
  const label = h("span", { cls: "tb-label", text: f.name });
  let edited = false;
  if (f.kind === "boolean") {
    const box = h("input", { attrs: { type: "checkbox", "aria-label": f.name } });
    box.addEventListener("change", () => (edited = true));
    return {
      field: f.name,
      row: h("label", { cls: "tb-row" }, label, h("span", { cls: "tb-check" }, box)),
      show: (values) => {
        if (edited) return;
        const on = values.filter((v) => v === true).length;
        box.checked = on > 0 && on === values.length;
        box.indeterminate = on > 0 && on < values.length;
      },
      read: () => (edited ? { value: box.checked } : null),
    };
  }
  const numeric = f.kind === "integer" || f.kind === "number";
  if (!numeric && f.kind !== "text" && f.kind !== "choice") return null;
  const input = h("input", { cls: `menu-dialog-input tb-input${numeric ? " num" : ""}`, attrs: { type: "text", "aria-label": f.name, spellcheck: "false" } });
  input.addEventListener("input", () => (edited = true));
  return {
    field: f.name,
    row: h("label", { cls: "tb-row" }, label, input),
    show: (values) => {
      if (edited) return;
      const same = values.every((v) => v === values[0]);
      input.value = same && values.length ? String(values[0]) : "";
      input.placeholder = same ? "" : VARIES;
    },
    read: () => {
      if (!edited) return null;
      if (!numeric) return { value: input.value };
      const t = input.value.trim();
      const n = Number(t);
      if (t === "" || !Number.isFinite(n) || (f.kind === "integer" && !Number.isInteger(n))) {
        return { error: `${f.name} takes ${f.kind === "integer" ? "a whole number" : "a number"}.`, focus: input };
      }
      return { value: n };
    },
  };
}

/** Editors for the fields of `format` the title blocks have, from the first that has the record. */
function editorsFor(doc: VwxDocument, blocks: readonly TitleBlock[], format: string): FieldEditor[] {
  const rec = blocks.map((b) => dataRecord(doc, b.id, format)).find((r): r is ObjectRecord => r !== null);
  return rec ? rec.fields.flatMap((f) => fieldEditor(f) ?? []) : [];
}

/** Shows each editor the values of the title blocks `ids` hold. */
function showValues(doc: VwxDocument, editors: readonly FieldEditor[], ids: readonly string[], format: string): void {
  const records = ids.map((id) => dataRecord(doc, id, format)).filter((r): r is ObjectRecord => r !== null);
  for (const e of editors) e.show(records.flatMap((r) => r.fields.filter((f) => f.name === e.field).map((f) => f.value)));
}

/** The changes entered in `editors`, or the first error. */
function changesOf(editors: readonly FieldEditor[], format: string): FieldChange[] | { error: string; focus: HTMLElement } {
  const out: FieldChange[] = [];
  for (const e of editors) {
    const r = e.read();
    if (!r) continue;
    if ("error" in r) return r;
    out.push({ format, field: e.field, value: r.value });
  }
  return out;
}

/** Opens the Title Block Manager, then makes its changes. */
export async function titleBlockManager(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const blocks = findTitleBlocks(doc);
  if (blocks.length === 0) {
    toast("This drawing has no title block (a Title Block Border) to manage.", "info");
    return;
  }
  const project = editorsFor(doc, blocks, PROJECT_DATA);
  const sheet = editorsFor(doc, blocks, SHEET_DATA);
  showValues(
    doc,
    project,
    blocks.map((b) => b.id),
    PROJECT_DATA,
  );

  const start = blocks.find((b) => b.layerId === store.activeLayerId) ?? blocks[0];
  const ticks = blocks.map((b) => {
    const box = h("input", { attrs: { type: "checkbox" }, checked: b === start });
    return { block: b, box, row: h("label", { cls: "menu-dialog-check" }, box, h("span", { text: b.label || "Untitled" })) };
  });
  const ticked = (): TitleBlock[] => ticks.filter((t) => t.box.checked).map((t) => t.block);
  const refresh = (): void =>
    showValues(
      doc,
      sheet,
      ticked().map((b) => b.id),
      SHEET_DATA,
    );
  for (const t of ticks) t.box.addEventListener("change", refresh);
  refresh();
  const all = h("button", { cls: "btn small", text: "Tick All", attrs: { type: "button" } });
  all.addEventListener("click", () => {
    for (const t of ticks) t.box.checked = true;
    refresh();
  });

  const section = (title: string, note: string, editors: readonly FieldEditor[]): HTMLElement[] =>
    editors.length
      ? [h("p", { cls: "tb-head" }, h("strong", { text: title }), h("span", { cls: "muted", text: ` · ${note}` })), h("div", { cls: "tb-fields" }, ...editors.map((e) => e.row))]
      : [];

  const result = await showDialog<{ project: FieldChange[]; sheet: FieldChange[]; sheets: TitleBlock[] }>({
    title: "Title Block Manager",
    okLabel: "Apply",
    cls: "tb-dialog",
    body: [
      ...section("Project Data", blocks.length === 1 ? "this title block" : `all ${blocks.length} title blocks`, project),
      h("p", { cls: "tb-head" }, h("strong", { text: "Sheet Data" }), h("span", { cls: "muted", text: " · the title blocks ticked" })),
      h("div", { cls: "tb-sheets", attrs: { role: "group", "aria-label": "Title blocks" } }, ...ticks.map((t) => t.row)),
      ...(ticks.length > 1 ? [h("div", { cls: "tb-all" }, all)] : []),
      h("div", { cls: "tb-fields" }, ...sheet.map((e) => e.row)),
      h("p", {
        cls: "muted",
        text: "Changes go into each title block's data and its drawn text where it shows a value as entered; Vectorworks redraws the rest when the title block is reset. Sheet Number and Sheet Title rename the sheet too.",
      }),
    ],
    check: () => {
      const p = changesOf(project, PROJECT_DATA);
      if ("error" in p) return p;
      const sh = changesOf(sheet, SHEET_DATA);
      if ("error" in sh) return sh;
      const sheets = ticked();
      if (sh.length && sheets.length === 0) return { error: "Tick the title blocks the sheet data goes to.", focus: ticks[0].box };
      const number = sh.find((c) => c.field === "Sheet Number");
      if (number && sheets.length > 1) return { error: "Sheets each have their own number: tick one to renumber it.", focus: ticks[0].box };
      if (number && String(number.value).trim() === "") return { error: "A sheet needs a number.", focus: ticks[0].box };
      if (p.length === 0 && sh.length === 0) return { error: "Nothing has been changed." };
      return { value: { project: p, sheet: sh, sheets } };
    },
  });
  if (!result) return;
  const made = attempt("Title Block Manager", (s) =>
    s.batch(() => {
      const a = applyTitleBlockChanges(
        s,
        blocks.map((b) => b.id),
        result.project,
      );
      const b = applyTitleBlockChanges(
        s,
        result.sheets.map((x) => x.id),
        result.sheet,
      );
      return { fields: a.fields + b.fields, texts: a.texts + b.texts, sheets: a.sheets + b.sheets };
    }),
  );
  if (!made) return;
  const { fields, texts, sheets } = made.value;
  const parts = [`${fields} ${fields === 1 ? "field" : "fields"}`, `${texts} drawn ${texts === 1 ? "text" : "texts"}`];
  if (sheets) parts.push(`${sheets} ${sheets === 1 ? "sheet" : "sheets"} renamed`);
  toast(fields ? `Title blocks updated: ${parts.join(", ")}.` : "The title blocks already had those values.", "info");
}
