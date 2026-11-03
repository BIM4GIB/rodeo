// The drawing's title blocks and their data, for File > Title Block Manager (titleBlockManager.ts).
//
// A title block is a Title Block Border plug-in object; its data is in the records attached to
// it: Title Block Project Data (the same on every title block of a drawing) and Title Block Sheet
// Data (its sheet's). Vectorworks keeps a sheet title block's Sheet Number and Sheet Title the
// same as its sheet layer's number and title (as all the samples' are).
//
// Its drawing is cached in its children, the data shown as plain text in the groups laid out as
// the title block (layoutTexts). Rodeo can't redraw a plug-in from its parameters, so a change
// also changes the texts of those groups that show the old value exactly; a value shown
// otherwise (a date in another format) is redrawn by Vectorworks when the title block is reset.
// A value another field of the title block also holds is left drawn as it is, since its texts
// can't be told apart. Kept apart from the dialog so it runs without the page.

import type { EditSession, ObjectInfo, ObjectRecord, RecordValue, VwxDocument } from "../core/index.ts";

export const BORDER = "Title Block Border";
export const PROJECT_DATA = "Title Block Project Data";
export const SHEET_DATA = "Title Block Sheet Data";
const SHEET_NUMBER = "Sheet Number";
const SHEET_TITLE = "Sheet Title";
/** Vectorworks' plug-in object type */
const PLUGIN = 86;

export interface TitleBlock {
  readonly id: string;
  readonly layerId: string;
  /** on a sheet layer: its number and title follow the sheet data */
  readonly sheet: boolean;
  /** "A-101 Floor Plan": its sheet's number and title, or its design layer's name */
  readonly label: string;
}

export interface FieldChange {
  /** the record format's name: PROJECT_DATA or SHEET_DATA */
  readonly format: string;
  readonly field: string;
  readonly value: RecordValue;
}

/** The drawing's title blocks, sheets first in their order, then those on design layers. */
export function findTitleBlocks(doc: VwxDocument): TitleBlock[] {
  const out: TitleBlock[] = [];
  const layers = doc.layers();
  for (const kind of ["sheet", "design"] as const) {
    for (const l of layers) {
      if (l.kind !== kind) continue;
      for (const o of doc.objects(l.id)) {
        if (o.type !== PLUGIN || o.id.includes("/")) continue;
        if (!doc.records(o.id).some((r) => r.parametric && r.name === BORDER)) continue;
        out.push({ id: o.id, layerId: l.id, sheet: kind === "sheet", label: kind === "sheet" ? [l.name, l.title].filter(Boolean).join(" ") : l.name });
      }
    }
  }
  return out;
}

/** The title block's data record of `format`, if it has one. */
export function dataRecord(doc: VwxDocument, id: string, format: string): ObjectRecord | null {
  return doc.records(id).find((r) => !r.parametric && r.name === format) ?? null;
}

/** The values of its data records' fields, trimmed and not empty. */
function shownValues(records: readonly ObjectRecord[]): string[] {
  return records.filter((r) => !r.parametric).flatMap((r) => r.fields.map((f) => String(f.value).trim()).filter(Boolean));
}

/**
 * The texts of the groups laid out as the title block (a border may draw it twice): its child
 * groups showing two or more of its data values, or the one showing most when none shows two. A
 * group of the border's own labels showing one short value by chance ("1") is left out.
 */
export function layoutTexts(doc: VwxDocument, id: string): ObjectInfo[] {
  const o = doc.object(id);
  if (!o) return [];
  const values = new Set(shownValues(doc.records(id)));
  const all = doc.objects(o.layerId);
  const children = new Map<string, ObjectInfo[]>();
  for (const x of all) if (x.parentId) (children.get(x.parentId) ?? children.set(x.parentId, []).get(x.parentId)!).push(x);
  const textsUnder = (root: string): ObjectInfo[] => {
    const out: ObjectInfo[] = [];
    const stack = [...(children.get(root) ?? [])];
    while (stack.length) {
      const x = stack.pop()!;
      if (x.shape?.kind === "text") out.push(x);
      stack.push(...(children.get(x.id) ?? []));
    }
    return out;
  };
  const groups = (children.get(id) ?? []).map((c) => {
    const texts = c.shape?.kind === "text" ? [c] : textsUnder(c.id);
    const shown = new Set(texts.map((t) => (t.shape?.text ?? "").trim()).filter((t) => values.has(t)));
    return { texts, shown: shown.size };
  });
  const best = Math.max(0, ...groups.map((g) => g.shown));
  const least = Math.min(best, 2);
  return least > 0 ? groups.filter((g) => g.shown >= least).flatMap((g) => g.texts) : [];
}

/**
 * Makes `changes` on the title blocks `ids`: each field in its record, the layout's texts showing
 * its old value exactly showing the new one, and a sheet's number and title following Sheet
 * Number and Sheet Title. Run it inside a batch. Returns how many fields, texts and sheets changed.
 */
export function applyTitleBlockChanges(
  s: EditSession,
  ids: readonly string[],
  changes: readonly FieldChange[],
): { fields: number; texts: number; sheets: number } {
  const done = { fields: 0, texts: 0, sheets: 0 };
  for (const id of ids) {
    const records = s.doc.records(id);
    const texts = layoutTexts(s.doc, id);
    let number: string | null = null;
    let title: string | null = null;
    for (const c of changes) {
      const rec = records.find((r) => !r.parametric && r.name === c.format);
      const field = rec?.fields.find((f) => f.name === c.field);
      if (!rec || !field) continue;
      if (field.value === c.value) continue;
      s.setRecordField(id, rec.format, c.field, c.value);
      done.fields++;
      if (c.format === SHEET_DATA && c.field === SHEET_NUMBER) number = String(c.value);
      if (c.format === SHEET_DATA && c.field === SHEET_TITLE) title = String(c.value);
      const old = String(field.value).trim();
      // a value another field holds too: its texts can't be told apart
      const shared = records.some((r) => !r.parametric && r.fields.some((f) => !(r === rec && f.name === c.field) && String(f.value).trim() === old));
      if (!old || shared) continue;
      for (const t of texts) {
        if ((t.shape?.text ?? "").trim() !== old) continue;
        s.setText(t.id, String(c.value));
        done.texts++;
      }
    }
    const o = s.doc.object(id);
    const layer = o && s.doc.layers().find((l) => l.id === o.layerId);
    if (layer?.kind === "sheet" && (number !== null || title !== null)) {
      const name = number ?? layer.name;
      const sheetTitle = title ?? layer.title;
      if (name !== layer.name || sheetTitle !== layer.title) {
        s.renameLayer(layer.id, name, sheetTitle);
        done.sheets++;
      }
    }
  }
  return done;
}
