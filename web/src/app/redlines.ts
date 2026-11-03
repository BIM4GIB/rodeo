// Text > Redlines: a redline's state, for the Redline tool's groups (tools/notes.ts). Picking one up
// closes it: it turns yellow and shows the date it was picked up. Restoring it opens it again: red,
// with the date it was made. Redlines live in the Notes-Redlines class, which Show or Hide Redlines
// switches, and Create Redline Status WS lists them all by state. Vectorworks keeps these on its
// Redline plug-in object; Rodeo's redline is a group, so its name says it is one and holds the date
// it was made ("Redline 3 (11/2/26)"), and its red pen says it is open. Vectorworks' own Redline
// objects in an opened drawing aren't these.

import type { NewSheetCell, ObjectInfo } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { colorMatcher } from "./pdfImport.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { editWorksheet } from "./worksheetEditor.ts";

const REDLINE_CLASS = "Notes-Redlines";
const REPORT_NAME = "Redlines Status Report";
const NAMED = /^Redline \d+ \((.*)\)$/;

export const redlineRed = (): number => colorMatcher()({ r: 1, g: 0, b: 0 });
const redlineYellow = (): number => colorMatcher()({ r: 1, g: 1, b: 0 });
export const redlineDate = (): string => new Date().toLocaleDateString(undefined, { year: "2-digit", month: "numeric", day: "numeric" });

interface Redline {
  readonly id: string;
  readonly layer: string;
  /** the date it was made */
  readonly made: string;
  /** it and everything in it */
  readonly parts: readonly string[];
  /** its date's text */
  readonly dateId: string | null;
  readonly date: string;
  readonly comment: string;
  readonly closed: boolean;
}

/** `obj` as a redline, when it is one of the Redline tool's groups. */
function readRedline(obj: ObjectInfo | undefined | null): Redline | null {
  const doc = store.session?.doc;
  const made = obj?.name?.match(NAMED)?.[1];
  if (!doc || !obj || made === undefined) return null;
  const kids = doc.objects(obj.layerId).filter((o) => o.parentId === obj.id);
  const outline = kids.find((o) => o.shape?.kind === "polygon");
  const texts = kids.filter((o) => o.shape?.kind === "text");
  const date = texts[0];
  // under the date, the names over the line and the notation under it
  const comment = texts
    .slice(1)
    .map((o) => o.shape?.text ?? "")
    .filter((t) => !/^(Auth By|Assigned To): /.test(t))
    .join(" ");
  return {
    id: obj.id,
    layer: doc.layers().find((l) => l.id === obj.layerId)?.name ?? "",
    made,
    parts: kids.map((o) => o.id),
    dateId: date?.id ?? null,
    date: date?.shape?.text ?? made,
    comment,
    closed: outline?.attrs?.penFore !== redlineRed(),
  };
}

function selectedRedlines(): Redline[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return [...store.selection].flatMap((id) => readRedline(doc.object(id)) ?? []);
}

export const canPickUpRedline = (): boolean => selectedRedlines().some((r) => !r.closed);
export const canRestoreRedline = (): boolean => selectedRedlines().some((r) => r.closed);

function allRedlines(): Redline[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  return doc.layers().flatMap((l) => doc.objects(l.id).flatMap((o) => readRedline(o) ?? []));
}

/** The name for a redline made on `date`: the first number no redline has. */
export function redlineName(date: string): string {
  const taken = new Set(allRedlines().map((r) => Number(store.session?.doc.object(r.id)?.name?.match(/^Redline (\d+)/)?.[1])));
  let n = 1;
  while (taken.has(n)) n++;
  return `Redline ${n} (${date})`;
}

/** The redlines' class, made if the drawing hasn't got it and shown if it was hidden: a new redline brings them all back. */
export function redlineClass(): number | undefined {
  const c = store.session?.doc.classes().find((k) => k.name === REDLINE_CLASS);
  if (!c) return attempt("Redline class", (s) => s.createClass(REDLINE_CLASS))?.value;
  if (c.visibility !== "visible") attempt("Show redlines", (s) => s.setClassVisibility(c.index, "visible"));
  return c.index;
}

/** Text > Redlines > Pick up Redline: the selected open ones closed. */
export function pickUpRedlines(): void {
  const open = selectedRedlines().filter((r) => !r.closed);
  if (!open.length) return;
  const yellow = redlineYellow();
  const today = redlineDate();
  const r = attempt("Pick up Redline", (s) =>
    s.batch(() => {
      for (const l of open) {
        s.setAttributes([...l.parts], { penFore: yellow });
        if (l.dateId) s.setText(l.dateId, today);
      }
    }),
  );
  if (r) toast(`${open.length} ${open.length === 1 ? "redline" : "redlines"} picked up on ${today}.`, "info");
}

/** Text > Redlines > Restore Redline: the selected closed ones open again, with the dates they were made. */
export function restoreRedlines(): void {
  const closed = selectedRedlines().filter((r) => r.closed);
  if (!closed.length) return;
  const red = redlineRed();
  const r = attempt("Restore Redline", (s) =>
    s.batch(() => {
      for (const l of closed) {
        s.setAttributes([...l.parts], { penFore: red });
        if (l.dateId) s.setText(l.dateId, l.made);
      }
    }),
  );
  if (r) toast(`${closed.length} ${closed.length === 1 ? "redline" : "redlines"} restored.`, "info");
}

export const hasRedlineClass = (): boolean => !!store.session?.doc.classes().some((c) => c.name === REDLINE_CLASS);

/** Text > Redlines > Show or Hide Redlines. */
export function toggleRedlines(): void {
  const c = store.session?.doc.classes().find((k) => k.name === REDLINE_CLASS);
  if (!c) return;
  const hiding = c.visibility === "visible";
  attempt(hiding ? "Hide redlines" : "Show redlines", (s) => s.setClassVisibility(c.index, hiding ? "hidden" : "visible"));
  // what can't be seen isn't left selected
  if (hiding) setSelection([...store.selection].filter((id) => !readRedline(store.session?.doc.object(id))));
}

const HEAD = ["Design Layer", "Date", "Comment"];

/** The report's rows: each section's title and its redlines. */
function reportRows(all: readonly Redline[]): (NewSheetCell | null)[][] {
  const title = (value: string): (NewSheetCell | null)[] => [{ value, bold: true }, null, null];
  const section = (name: string, list: readonly Redline[]): (NewSheetCell | null)[][] => [
    title(name),
    HEAD.map((value): NewSheetCell => ({ value, bold: true })),
    ...list.map((r): NewSheetCell[] => [{ value: r.layer }, { value: r.date }, { value: r.comment }]),
    [null, null, null],
  ];
  return [...section("Open Redlines", all.filter((r) => !r.closed)), ...section("Closed Redlines", all.filter((r) => r.closed))];
}

/** Without a worksheet to make one from, the report in a dialog. */
async function showReport(all: readonly Redline[]): Promise<void> {
  const list = (name: string, rows: readonly Redline[]): HTMLElement[] => [
    h("p", { text: `${name}: ${rows.length}` }),
    ...(rows.length ? [h("dl", { cls: "props-list" }, ...rows.flatMap((r) => [h("dt", { text: `${r.layer}, ${r.date}` }), h("dd", { text: r.comment || "No comment" })]))] : []),
  ];
  await showDialog<boolean>({
    title: REPORT_NAME,
    okLabel: "Close",
    cls: "props-dialog",
    body: [
      ...list("Open Redlines", all.filter((r) => !r.closed)),
      ...list("Closed Redlines", all.filter((r) => r.closed)),
      h("p", { cls: "muted", text: "This drawing has no worksheet to make the report from, so it shows here." }),
    ],
    check: () => ({ value: true }),
  });
}

/** Text > Redlines > Create Redline Status WS: the Redlines Status Report made afresh and opened. */
export async function redlineStatusWorksheet(): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const all = allRedlines();
  const sheets = doc.resources().filter((r) => r.kind === "worksheet");
  if (!sheets.length) return showReport(all);
  const was = sheets.find((r) => r.name === REPORT_NAME);
  const made = attempt("Create Redline Status WS", (s) =>
    s.batch(() => {
      if (was) s.deleteWorksheet(was.index);
      return s.createWorksheet({ name: REPORT_NAME, widths: [120, 72, 280], rowHeight: 14, rows: reportRows(all) });
    }),
  );
  if (made) await editWorksheet(made.value);
}
