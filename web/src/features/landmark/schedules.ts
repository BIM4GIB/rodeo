// Tools > Reports > Plant Schedule, Existing Tree Schedule and Landscape Quantities: what a drawing's
// Landmark objects hold (scheduleRows.ts), as a worksheet made from one the drawing has, as Create
// Report makes one, or in a drawing with none a CSV file.

import type { NewSheetCell, VwxDocument } from "../../core/index.ts";
import { attempt } from "../../app/commands.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { store } from "../../app/state.ts";
import { toast } from "../../app/toast.ts";
import { editWorksheet } from "../../app/worksheetEditor.ts";
import { scheduleCsv, type Schedule } from "./scheduleRows.ts";

/** The first of the title, "Title 2" and so on that no resource or layer has. */
function freeName(doc: VwxDocument, title: string): string {
  const taken = new Set([...doc.resources().map((r) => r.name), ...doc.layers().map((l) => l.name)]);
  for (let n = 1; ; n++) {
    const name = n === 1 ? title : `${title} ${n}`;
    if (!taken.has(name)) return name;
  }
}

/** Makes the schedule a worksheet and opens it, or downloads it as CSV in a drawing without one. */
export function makeSchedule(build: (doc: VwxDocument) => Schedule): void {
  const doc = store.session?.doc;
  if (!doc) return;
  const s = build(doc);
  if (!s.rows.length) {
    toast(`This drawing has nothing for a ${s.title.toLowerCase()}.`, "info");
    return;
  }
  if (!doc.resources().some((r) => r.kind === "worksheet")) {
    const base = (store.fileName || "Drawing").replace(/\.[^.]+$/, "");
    downloadBlob(`${base} ${s.title}.csv`, new Blob([scheduleCsv(s)], { type: "text/csv" }));
    toast(`${s.title} saved as a CSV file: this drawing has no worksheet to make one from.`, "info");
    return;
  }
  const head: NewSheetCell[] = s.head.map((value) => ({ value, bold: true, align: "center" }));
  const rows = s.rows.map((row) => row.map((value): NewSheetCell => ({ value, align: typeof value === "number" ? "right" : "left" })));
  const widths = s.head.map((_, i) => Math.min(180, Math.max(48, 6 * Math.max(...[s.head[i], ...s.rows.map((r) => String(r[i]))].map((v) => v.length)))));
  const made = attempt(s.title, (session) => session.createWorksheet({ name: freeName(doc, s.title), widths, rowHeight: 14, rows: [head, ...rows] }));
  if (made) void editWorksheet(made.value);
}

/** Whether the drawing has any of these Landmark objects. */
export const hasAny = (doc: VwxDocument | undefined, ...names: string[]): boolean => !!doc && names.some((n) => doc.hasPluginFormat(n));
