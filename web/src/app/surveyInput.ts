// AEC > Survey Input > Grid Method Entry… and Import Survey File…: site model source data, as 3D loci or as stakes,
// typed over a grid or read from a file (the sums are in surveyShapes.ts).

import type { EditSession, Pt } from "../core/index.ts";
import { decodeText, parseDelimited, readXlsx } from "../import/worksheet.ts";
import { attempt, setSelection, zoomToSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { errorMessage, toast } from "./toast.ts";
import { showDialog } from "./menubar.ts";
import { placeAtNextClick } from "./placeAt.ts";
import { layerScaleOf } from "./spaces.ts";
import { store } from "./state.ts";
import "./surveyInput.css";
import { gridPoints, guessDelimiter, guessFormat, idParts, pastedCells, readSurvey, surveyCentre, surveyFormatLabel, surveyRows, SURVEY_FORMATS, SURVEY_UNITS, type SurveyFormat, type SurveyPoint } from "./surveyShapes.ts";
import { addStakeGroups, newStakeSettings, STAKE_LABELS, stakeParts, type StakeLabel } from "./tools/paths.ts";
import { formatLength, formatLengthValue, parseLength } from "./units.ts";

const STAKES = "Stakes";
const LOCI = "3D Loci";
const MAX_GRID = 2500;
/** Survey coordinates further off than this are hard to work with: the option to bring them home starts on. */
const FAR_AWAY = 10_000_000;

const select = (options: readonly (readonly [string, string])[], value: string, label: string): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": label } }, ...options.map(([v, text]) => h("option", { text, attrs: { value: v } })));
  el.value = value;
  return el;
};
const input = (value: string, label: string): HTMLInputElement => h("input", { cls: "menu-dialog-input", value, attrs: { "aria-label": label } });
const row = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
const heading = (text: string): HTMLElement => h("p", { cls: "menu-dialog-heading", text });

/** Puts points on the active layer as loci or stakes, selected and in view. */
function placePoints(label: string, layerId: string, points: readonly SurveyPoint[], asStakes: boolean, stakeLabel: StakeLabel): boolean {
  const scale = layerScaleOf(layerId);
  const r = attempt(label, (s: EditSession) =>
    s.batch(() => {
      if (!asStakes) return s.add3DLoci(layerId, points.map((p) => [p.x, p.y, p.z]), store.activeClassIndex);
      const k = { ...newStakeSettings(), label: stakeLabel, autoId: false };
      const stakes = points.flatMap((p, i) => {
        const id = idParts(p.id) ?? { prefix: "", number: i + 1 };
        const at = { x: p.x, y: p.y };
        const parts = stakeParts({ ...k, z: p.z, description: p.description, prefix: id.prefix, idNumber: id.number }, at, null, 0, scale);
        return parts ? [{ parts, at, z: p.z }] : [];
      });
      return addStakeGroups(s, layerId, stakes);
    }),
  );
  if (!r) return false;
  setSelection(r.value);
  const ctx = appContext();
  if (ctx) {
    zoomToSelection(ctx.scene, ctx.view);
    ctx.requestDraw();
  }
  return true;
}

export function gridMethodEntry(): void {
  if (!store.activeLayerId) {
    toast("Make a design layer active first.", "error");
    return;
  }
  placeAtNextClick({ what: "The grid's upper left corner", place: (at) => void gridSetup(at) });
}

async function gridSetup(start: Pt): Promise<void> {
  const session = store.session;
  const layerId = store.activeLayerId;
  if (!session || !layerId) return;
  const units = session.doc.info.units;
  const rows = input("5", "Rows");
  const columns = input("5", "Columns");
  const spacing = input(formatLengthValue(3048, units), "Grid Spacing");
  const result = select([[LOCI, LOCI], [STAKES, STAKES]], LOCI, "Insert");
  const whole = (el: HTMLInputElement): number | null => {
    const v = Number(el.value);
    return Number.isInteger(v) && v >= 1 ? v : null;
  };
  const setup = await showDialog<{ rows: number; columns: number; spacing: number; stakes: boolean }>({
    title: "Point Entry Grid Setup",
    okLabel: "OK",
    body: [row("Rows", rows), row("Columns", columns), row("Grid Spacing", spacing), row("Insert", result)],
    check: () => {
      const [r, c] = [whole(rows), whole(columns)];
      if (r === null) return { error: "Rows: enter a whole number, 1 or more.", focus: rows };
      if (c === null) return { error: "Columns: enter a whole number, 1 or more.", focus: columns };
      if (r * c > MAX_GRID) return { error: `That's over ${MAX_GRID} points to type: Import Survey File takes any number from a file.`, focus: rows };
      const d = parseLength(spacing.value, units);
      if (d === null || d <= 0) return { error: "Grid Spacing: enter a length over zero.", focus: spacing };
      return { value: { rows: r, columns: c, spacing: d, stakes: result.value === STAKES } };
    },
  });
  if (!setup || store.session !== session) return;
  const cells: HTMLInputElement[][] = [];
  const table = h("table", { cls: "survey-z-table" });
  table.append(h("tr", {}, h("th", {}), ...Array.from({ length: setup.columns }, (_, i) => h("th", { text: String(i + 1) }))));
  for (let j = 0; j < setup.rows; j++) {
    const line: HTMLInputElement[] = [];
    for (let i = 0; i < setup.columns; i++) line.push(h("input", { cls: "menu-dialog-input", attrs: { "aria-label": `Row ${j + 1}, column ${i + 1}` } }));
    cells.push(line);
    table.append(h("tr", {}, h("th", { text: String(j + 1) }), ...line.map((el) => h("td", {}, el))));
  }
  // a block copied from a spreadsheet fills from the cell it lands on
  cells.forEach((line, j) =>
    line.forEach((el, i) =>
      el.addEventListener("paste", (e) => {
        const text = e.clipboardData?.getData("text") ?? "";
        if (!/[\t\n]/.test(text)) return;
        e.preventDefault();
        pastedCells(text).forEach((values, b) => values.forEach((value, a) => {
          const target = cells[j + b]?.[i + a];
          if (target) target.value = value.trim();
        }));
      }),
    ),
  );
  const heights = await showDialog<number[]>({
    title: "Enter Z Values",
    okLabel: "Done",
    cls: "survey-z-dialog",
    body: [h("p", { cls: "muted", text: "The elevation of each point, row 1 at the top and column 1 at the left. Tab moves across; a block pasted from a spreadsheet fills in from the cell it lands on." }), h("div", { cls: "survey-z-scroll" }, table)],
    check: () => {
      const out: number[] = [];
      for (let j = 0; j < setup.rows; j++) {
        for (let i = 0; i < setup.columns; i++) {
          const z = parseLength(cells[j][i].value, units);
          if (z === null) return { error: `Type an elevation for row ${j + 1}, column ${i + 1}.`, focus: cells[j][i] };
          out.push(z);
        }
      }
      return { value: out };
    },
  });
  if (!heights || store.session !== session) return;
  const points = gridPoints(start, setup.rows, setup.columns, setup.spacing).map((p, i): SurveyPoint => ({ id: "", x: p.x, y: p.y, z: heights[i], description: "" }));
  if (placePoints("Grid Method Entry", layerId, points, setup.stakes, "elevation")) toast(`${points.length} points placed. Site Model from Source Data makes a model from them while they're selected.`, "info");
}

export function chooseFile(accept = ".txt,.csv,.tsv,.xyz,.asc,.pts,.prn,.dat,.xlsx,.xlsm,.xls", label = "Survey file"): Promise<File | null> {
  return new Promise((resolve) => {
    const el = h("input", { attrs: { type: "file", accept, "aria-label": label }, hidden: true });
    document.body.append(el);
    el.addEventListener("change", () => {
      const file = el.files?.[0] ?? null;
      el.remove();
      resolve(file);
    });
    el.addEventListener("cancel", () => {
      el.remove();
      resolve(null);
    });
    el.click();
  });
}

/** A file's text, or its first sheet's rows if it's a workbook; null, having said why, if it can't be read. */
export async function loadTable(file: File, label: string): Promise<{ book: boolean; sheetRows: string[][] | null; text: string } | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const book = (bytes[0] === 0x50 && bytes[1] === 0x4b) || /\.xlsx?m?$/i.test(file.name);
  try {
    if (!book) return { book, sheetRows: null, text: decodeText(bytes) };
    if (/\.xls$/i.test(file.name) && bytes[0] !== 0x50) throw new Error("Excel 97–2004 workbooks (.xls) can't be read yet: save it from Excel as an .xlsx workbook, or as CSV.");
    return { book, sheetRows: (readXlsx(bytes)[0]?.rows ?? []).map((r) => r.map((c) => (c === null ? "" : String(c.value)))), text: "" };
  } catch (err) {
    toast(`${label} failed: ${errorMessage(err)}`, "error");
    return null;
  }
}

/** A file's lines, split with their blanks left in place, so that row numbers are the file's. */
export const surveyRowsOf = (text: string, delimiter: string): string[][] => (delimiter === " " ? text.split(/\r\n|\r|\n/).map((line) => line.trim().split(/\s+/)) : parseDelimited(text, delimiter));

const lines = (n: number): string => `${n} line${n === 1 ? "" : "s"}`;
const EXCEL = "Excel";
const TAB = "Tab delimited";
const OTHER = "Other";

export async function importSurveyFileDialog(): Promise<void> {
  const session = store.session;
  const layerId = store.activeLayerId;
  if (!session || !layerId) return;
  const file = await chooseFile();
  if (!file || store.session !== session) return;
  const loaded = await loadTable(file, "Import Survey File");
  if (!loaded) return;
  const { book, sheetRows, text } = loaded;
  const units = session.doc.info.units;
  const guessed = book ? "\t" : guessDelimiter(text);
  const fileType = select([...(book ? [[EXCEL, EXCEL] as const] : []), [TAB, TAB], [OTHER, OTHER]], book ? EXCEL : guessed === "\t" ? TAB : OTHER, "File Type");
  fileType.disabled = book;
  const delimiter = input(guessed === "\t" ? "," : guessed, "Delimiter Character");
  delimiter.maxLength = 1;
  const delimiterRow = row("Delimiter Character", delimiter);
  const rowsNow = (): string[][] => sheetRows ?? surveyRows(text, fileType.value === TAB ? "\t" : delimiter.value || " ");
  const format = select(SURVEY_FORMATS.map((f) => [f, surveyFormatLabel(f)] as const), guessFormat(rowsNow()), "Data Format");
  const unit = select(SURVEY_UNITS.map((u) => [u.label, u.label] as const), /met(er|re)/i.test(units) ? "Meters" : "Feet", "Units");
  const asked = select([[STAKES, "Create Stake Objects"], [LOCI, "Create 3D Locus Objects (imports only location)"]], LOCI, "Import as");
  const stakeLabel = select(STAKE_LABELS.map((l) => [l.id, l.label] as const), "elevation", "Stake Label");
  const stakeRow = row("Stake Label", stakeLabel);
  const centred = h("input", { attrs: { type: "checkbox", "aria-label": "Center on the internal origin" } });
  const lineShown = h("div", { cls: "survey-line" });
  const lineNumber = h("span", { cls: "survey-line-number" });
  const earlier = h("button", { cls: "btn small", text: "<", attrs: { type: "button", "aria-label": "Previous line" } });
  const later = h("button", { cls: "btn small", text: ">", attrs: { type: "button", "aria-label": "Next line" } });
  const summary = h("p", { cls: "muted" });
  let at = 0;
  const mm = (): number => SURVEY_UNITS.find((u) => u.label === unit.value)?.mm ?? 1;
  const refresh = (): void => {
    const rows = rowsNow();
    at = Math.min(at, Math.max(0, rows.length - 1));
    lineShown.replaceChildren(...(rows[at] ?? []).map((value) => h("span", { text: value || " " })));
    lineNumber.textContent = `Line ${rows.length ? at + 1 : 0} of ${rows.length}`;
    delimiterRow.style.display = fileType.value === OTHER ? "" : "none";
    stakeRow.style.display = asked.value === STAKES ? "" : "none";
    const read = readSurvey(rows, format.value as SurveyFormat, mm());
    const c = surveyCentre(read.points);
    summary.textContent = `${read.points.length} points read${read.skipped ? `, ${lines(read.skipped)} that don't fit this format skipped` : ""}.${read.points.length ? ` Their centre is ${formatLength(Math.hypot(c.x, c.y), units)} from the internal origin.` : ""}${asked.value === STAKES && read.points.length > 5000 ? " That many stakes will be slow: 3D loci are lighter." : ""}`;
  };
  earlier.addEventListener("click", () => {
    at = Math.max(0, at - 1);
    refresh();
  });
  later.addEventListener("click", () => {
    at += 1;
    refresh();
  });
  for (const el of [fileType, format, unit, asked]) el.addEventListener("change", refresh);
  delimiter.addEventListener("input", refresh);
  const first = readSurvey(rowsNow(), format.value as SurveyFormat, mm());
  const c0 = surveyCentre(first.points);
  centred.checked = Math.hypot(c0.x, c0.y) > FAR_AWAY;
  refresh();
  const done = await showDialog<{ points: SurveyPoint[]; skipped: number; stakes: boolean; label: StakeLabel; centred: boolean }>({
    title: "Import Survey File",
    okLabel: "OK",
    cls: "survey-import-dialog",
    body: [
      heading("Data from selected file"),
      lineShown,
      h("div", { cls: "survey-line-row" }, earlier, lineNumber, later),
      heading("Survey File format"),
      row("File Type", fileType),
      delimiterRow,
      heading("Survey Data"),
      row("Data Format", format),
      row("Units", unit),
      heading("Import Options"),
      row("Import as", asked),
      stakeRow,
      h("label", { cls: "menu-dialog-check" }, centred, "Center on the internal origin"),
      summary,
    ],
    check: () => {
      const read = readSurvey(rowsNow(), format.value as SurveyFormat, mm());
      if (!read.points.length) return { error: "No line of this file fits this format: check the delimiter and the data format.", focus: format };
      return { value: { ...read, stakes: asked.value === STAKES, label: stakeLabel.value as StakeLabel, centred: centred.checked } };
    },
  });
  if (!done || store.session !== session) return;
  const off = done.centred ? surveyCentre(done.points) : { x: 0, y: 0 };
  const points = done.points.map((p) => ({ ...p, x: p.x - off.x, y: p.y - off.y }));
  if (placePoints("Import Survey File", layerId, points, done.stakes, done.label)) {
    toast(`${points.length} points imported${done.skipped ? `, ${lines(done.skipped)} skipped` : ""}${done.centred ? `, moved by ${formatLength(off.x, units)} east and ${formatLength(off.y, units)} north to the origin` : ""}.`, "info");
  }
}
