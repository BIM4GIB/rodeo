// Stage > Scene Shop > Cut List…: the shop's pieces and how many are built, every part's cut list, the lumber sticks
// and sheets those parts pack into, and what it costs. flats.ts works out the parts and cutlist.ts packs them; this
// window reads both from the drawing, and writes back the counts and prices typed in it. Each tab exports CSV.

import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { parseLength } from "../../../app/units.ts";
import type { ShopPiece } from "../showTypes.ts";
import { lengthText } from "../stageTool.ts";
import { writeShow } from "../show.ts";
import { csvOf, csvText, dataTable, downloadText, noteLine, openPanel, tabs, type Column, type OpenPanel } from "../ui.ts";
import { costOf, cutStock, nestSheets, type CutPiece, type CutResult, type NestRect, type Placed, type Stick } from "./cutlist.ts";
import { flatParts, isFlat, platformParts, type ShopPart } from "./flats.ts";
import { removePieceIn, setCountIn, shopPieces, shopPrices, shopSpecs, PRICES_KEY } from "./pieces.ts";
import { svgUrl, xmlEscape } from "./modelBox.ts";
import "./shop.css";

/** A part as the cut list shows it: its piece's tag (F1 a flat, P1 a platform) and its mark, and how many are built. */
interface Row {
  readonly piece: ShopPiece;
  readonly mark: string;
  readonly part: ShopPart;
  readonly qty: number;
}

/** What the lumber and sheet tabs were last set to, as typed; kept while the window is open. */
const inputs = { stocks: "8', 10', 12', 16'", kerf: "3 mm", sheetWidth: "1219 mm", sheetLength: "2438 mm" };

const units = (): string | undefined => store.session?.doc.info.units;

/** A length typed as text, in mm, rounded; null when it isn't a length above 0 (or 0 with `zero`). */
function mmOf(text: string, zero = false): number | null {
  const mm = parseLength(text, units());
  return mm !== null && (mm > 0 || (zero && mm === 0)) ? Math.round(mm) : null;
}

/** Every part of every piece, its tag and mark; pieces without details are left out. */
function rowsOf(): Row[] {
  const specs = shopSpecs();
  const pieces = shopPieces();
  const out: Row[] = [];
  let flats = 0;
  let platforms = 0;
  for (const piece of pieces) {
    const tag = piece.kind === "flat" ? `F${++flats}` : `P${++platforms}`;
    const spec = specs[piece.id];
    if (!spec) continue;
    const parts = isFlat(spec) ? flatParts(spec) : platformParts(spec);
    for (const part of parts) out.push({ piece, mark: `${tag}-${part.mark}`, part, qty: part.qty * piece.count });
  }
  return out;
}

/** The stock parts (no width: solid stock) packed into the sticks the lengths in the window make. */
function lumberOf(rows: readonly Row[]): { result: CutResult; stocks: number[]; kerfMm: number } {
  const stocks = inputs.stocks
    .split(/[,;]/)
    .map((t) => mmOf(t))
    .filter((n): n is number => n !== null);
  const kerfMm = mmOf(inputs.kerf, true) ?? 0;
  const pieces: CutPiece[] = rows
    .filter((r) => r.part.widthMm === undefined)
    .map((r) => ({ mark: r.mark, material: r.part.material, lengthMm: r.part.lengthMm, qty: r.qty }));
  return { result: cutStock(pieces, stocks, kerfMm), stocks, kerfMm };
}

/** The sheet parts (with a width) nested on the sheet size in the window. Null when that size doesn't read. */
function sheetsOf(rows: readonly Row[], kerfMm: number): { nest: ReturnType<typeof nestSheets>; W: number; H: number } | null {
  const W = mmOf(inputs.sheetWidth);
  const H = mmOf(inputs.sheetLength);
  if (W === null || H === null) return null;
  const rects: NestRect[] = [];
  for (const r of rows) {
    if (r.part.widthMm === undefined) continue;
    for (let i = 0; i < r.qty; i++) rects.push({ mark: r.qty > 1 ? `${r.mark}.${i + 1}` : r.mark, widthMm: r.part.widthMm, heightMm: r.part.lengthMm });
  }
  return { nest: nestSheets(rects, W, H, kerfMm), W, H };
}

const stickCsv = (sticks: readonly Stick[]) =>
  sticks.map((s, i) => [i + 1, s.material, lengthText(s.stockMm), s.cuts.map((c) => `${c.mark} ${lengthText(c.lengthMm)}`).join("; "), lengthText(s.offcutMm)]);

/** A tab's body, with a row of its own export button above it. */
function exportable(body: HTMLElement, csv: () => string, name: string): HTMLElement {
  const button = h("button", { cls: "btn", text: "Export CSV", attrs: { type: "button" } });
  button.addEventListener("click", () => downloadText(name, csv(), "text/csv"));
  return h("div", { cls: "shop-tab" }, h("div", { cls: "th-toolbar" }, h("span", { cls: "th-spacer" }), button), body);
}

/** A text field that reports each change, for the lumber and sheet sizes. */
function textField(label: string, value: string, onChange: (text: string) => void): HTMLElement {
  const input = h("input", { value, attrs: { type: "text", "aria-label": label } });
  input.addEventListener("change", () => onChange(input.value.trim()));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") input.blur();
  });
  return h("label", { cls: "shop-field" }, h("span", { text: label }), input);
}

function pieceColumns(refresh: () => void): Column<ShopPiece>[] {
  return [
    { label: "Name", value: (p) => p.name, width: 180 },
    { label: "Kind", value: (p) => (p.kind === "flat" ? "Flat" : "Platform") },
    { label: "Size", value: (p) => `${lengthText(p.widthMm)} x ${lengthText(p.heightMm)}` },
    { label: "Top", value: (p) => (p.kind === "platform" ? lengthText(p.standMm) : ""), numeric: true },
    {
      label: "Built",
      value: (p) => p.count,
      numeric: true,
      edit: (p, text) => {
        if (!/^\s*\d+\s*$/.test(text) || Number(text) < 1) {
          toast("Built is a whole number, 1 or more.", "info");
          refresh();
          return;
        }
        const count = Number(text);
        attempt("Piece Count", (s) => s.batch(() => setCountIn(s, p.id, count)));
        refresh();
      },
    },
  ];
}

function piecesTab(): HTMLElement {
  let picked: string | null = null;
  const table = dataTable<ShopPiece>(pieceColumns(() => table.refresh()), () => shopPieces(), {
    empty: "No pieces yet. Use Stage > Scene Shop > New Flat… or New Platform….",
    rowClass: (p) => (p.id === picked ? "shop-picked" : undefined),
    onRow: (p) => {
      picked = p.id;
      table.refresh();
    },
  });
  const remove = h("button", { cls: "btn", text: "Delete Piece", attrs: { type: "button" } });
  remove.addEventListener("click", () => {
    const p = shopPieces().find((x) => x.id === picked);
    if (!p) {
      toast("Click a piece in the list first.", "info");
      return;
    }
    if (attempt(`Delete ${p.name}`, (s) => s.batch(() => removePieceIn(s, p.id)))) {
      picked = null;
      table.refresh();
      toast(`${p.name} is out of the cut list. Its drawing stays where it is.`, "info");
    }
  });
  const tail = h("div", { cls: "th-toolbar" }, remove, h("span", { cls: "th-spacer" }));
  const csv = () => csvOf(pieceColumns(() => undefined), shopPieces());
  return exportable(h("div", { cls: "shop-tab" }, table.element, tail), csv, "shop-pieces.csv");
}

const CUT_COLUMNS: readonly Column<Row>[] = [
  { label: "Mark", value: (r) => r.mark, width: 90 },
  { label: "Piece", value: (r) => r.piece.name },
  { label: "Part", value: (r) => r.part.name },
  { label: "Material", value: (r) => r.part.material },
  { label: "Length", value: (r) => lengthText(r.part.lengthMm), numeric: true },
  { label: "Width", value: (r) => (r.part.widthMm === undefined ? "" : lengthText(r.part.widthMm)), numeric: true },
  { label: "Qty", value: (r) => r.qty, numeric: true },
];

function cutListTab(): HTMLElement {
  const table = dataTable(CUT_COLUMNS, rowsOf, { empty: "No parts yet. Make a flat or platform first." });
  return exportable(table.element, () => csvOf(CUT_COLUMNS, rowsOf()), "shop-cut-list.csv");
}

/** One stick as a bar: each cut in solid colour, its kerf between, the offcut at the end. */
function stickView(s: Stick, kerfMm: number): HTMLElement {
  const bar = h("div", { cls: "shop-bar" });
  const part = (cls: string, mm: number, title?: string): void => {
    const el = h("div", { cls, title });
    el.style.width = `${(mm / s.stockMm) * 100}%`;
    bar.append(el);
  };
  s.cuts.forEach((c, i) => {
    if (i > 0 && kerfMm > 0) part("shop-kerf", kerfMm);
    part("shop-cut", c.lengthMm, `${c.mark} ${lengthText(c.lengthMm)}`);
  });
  if (s.offcutMm > 0) part("shop-offcut", s.offcutMm, `Offcut ${lengthText(s.offcutMm)}`);
  const cuts = s.cuts.map((c) => `${c.mark} ${lengthText(c.lengthMm)}`).join(", ");
  return h(
    "div",
    { cls: "shop-stick" },
    h("div", { cls: "shop-stick-head", text: `${s.material}: ${lengthText(s.stockMm)} stick` }),
    bar,
    h("div", { cls: "shop-cuts", text: `${cuts}. Offcut ${lengthText(s.offcutMm)}.` }),
  );
}

function lumberTab(): HTMLElement {
  const results = h("div", { cls: "shop-results" });
  const draw = (): void => {
    const { result, stocks, kerfMm } = lumberOf(rowsOf());
    const parts = rowsOf().filter((r) => r.part.widthMm === undefined);
    if (parts.length === 0) {
      results.replaceChildren(noteLine("No stock parts yet: a flat's frame or a platform's frame and legs are cut from sticks."));
      return;
    }
    if (stocks.length === 0) {
      results.replaceChildren(noteLine("Enter stock lengths such as 8', 10', 12', 16'.", "th-bad"));
      return;
    }
    const totals = result.byLength.map((b) => `${b.count} x ${lengthText(b.stockMm)} ${b.material}`);
    const children: HTMLElement[] = result.sticks.map((s) => stickView(s, kerfMm));
    children.push(noteLine(`Sticks: ${totals.join("; ")}. ${result.sticks.length} in all, ${Math.round(result.wastePct)}% waste.`));
    if (result.tooLong.length) {
      const marks = result.tooLong.map((p) => `${p.mark} ${lengthText(p.lengthMm)}`).join(", ");
      children.push(noteLine(`Longer than the longest stick, so not cut: ${marks}. Add a longer stock length or join the piece.`, "th-bad"));
    }
    results.replaceChildren(...children);
  };
  const bar = h(
    "div",
    { cls: "th-toolbar" },
    textField("Stock lengths", inputs.stocks, (t) => {
      inputs.stocks = t;
      draw();
    }),
    textField("Saw kerf", inputs.kerf, (t) => {
      inputs.kerf = t;
      draw();
    }),
  );
  draw();
  const csv = (): string => {
    const { result } = lumberOf(rowsOf());
    return csvText(["Stick", "Material", "Length", "Cuts", "Offcut"], stickCsv(result.sticks));
  };
  return exportable(h("div", { cls: "shop-tab" }, bar, results), csv, "shop-lumber.csv");
}

/** A sheet as a picture: its outline, each piece's rectangle in solid colour, its name and size where they fit. */
function sheetSvg(placed: readonly Placed[], W: number, H: number): string {
  const stroke = Math.max(W, H) / 400;
  const size = Math.max(W, H) / 45;
  const shapes = placed.map((p) => {
    const y = H - p.yMm - p.heightMm;
    const label = `${p.mark} ${lengthText(p.widthMm)} x ${lengthText(p.heightMm)}`;
    const fits = p.widthMm > label.length * size * 0.55;
    const text = fits ? label : p.mark;
    const show = p.widthMm > text.length * size * 0.55 && p.heightMm > size * 1.4;
    return [
      `<rect x="${p.xMm}" y="${y}" width="${p.widthMm}" height="${p.heightMm}" fill="#dbe7f5" stroke="#2b5c8a" stroke-width="${stroke}"/>`,
      show ? `<text x="${p.xMm + p.widthMm / 2}" y="${y + p.heightMm / 2 + size * 0.35}" font-size="${size}" fill="#1d1d1d" text-anchor="middle" font-family="sans-serif">${xmlEscape(text)}</text>` : "",
    ].join("");
  });
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" stroke="#888888" stroke-width="${stroke}"/>`,
    ...shapes,
    "</svg>",
  ].join("");
}

function sheetsTab(): HTMLElement {
  const out = h("div", { cls: "shop-results" });
  const draw = (): void => {
    const rows = rowsOf();
    const kerfMm = mmOf(inputs.kerf, true) ?? 0;
    const sheets = sheetsOf(rows, kerfMm);
    if (!sheets) {
      out.replaceChildren(noteLine("Enter the sheet's size, such as 1219 mm by 2438 mm.", "th-bad"));
      return;
    }
    if (!rows.some((r) => r.part.widthMm !== undefined)) {
      out.replaceChildren(noteLine("No sheet parts yet: a flat's skin and a platform's lid are cut from sheets."));
      return;
    }
    const { nest, W, H } = sheets;
    const children: HTMLElement[] = [noteLine(`${nest.sheets.length} sheet${nest.sheets.length === 1 ? "" : "s"}, ${Math.round(nest.wastePct)}% waste. Uses the saw kerf from Lumber.`)];
    if (nest.tooBig.length) children.push(noteLine(`Too big for one sheet: ${nest.tooBig.map((r) => r.mark).join(", ")}. Cut those from more than one sheet.`, "th-bad"));
    nest.sheets.forEach((placed, i) => {
      children.push(
        h(
          "div",
          { cls: "shop-sheet" },
          h("p", { cls: "th-note", text: `Sheet ${i + 1}: ${placed.length} piece${placed.length === 1 ? "" : "s"}` }),
          h("img", { attrs: { src: svgUrl(sheetSvg(placed, W, H)), alt: `Sheet ${i + 1}` } }),
        ),
      );
    });
    out.replaceChildren(...children);
  };
  const bar = h(
    "div",
    { cls: "th-toolbar" },
    textField("Sheet width", inputs.sheetWidth, (t) => {
      inputs.sheetWidth = t;
      draw();
    }),
    textField("Sheet length", inputs.sheetLength, (t) => {
      inputs.sheetLength = t;
      draw();
    }),
  );
  draw();
  const csv = (): string => {
    const sheets = sheetsOf(rowsOf(), mmOf(inputs.kerf, true) ?? 0);
    const lines = sheets ? sheets.nest.sheets.flatMap((placed, i) => placed.map((p) => [i + 1, p.mark, lengthText(p.xMm), lengthText(p.yMm), lengthText(p.widthMm), lengthText(p.heightMm), p.turned ? "yes" : "no"])) : [];
    return csvText(["Sheet", "Mark", "Across", "Up", "Width", "Length", "Turned"], lines);
  };
  return exportable(h("div", { cls: "shop-tab" }, bar, out), csv, "shop-sheets.csv");
}

interface CostRow {
  readonly key: string;
  readonly item: string;
  readonly count: number;
  readonly unit: number;
}

/** The stick lengths used (all materials together) and the sheets, each with its count and its price. */
function costRows(): CostRow[] {
  const rows = rowsOf();
  const prices = shopPrices();
  const { result } = lumberOf(rows);
  const byLength = new Map<number, number>();
  for (const b of result.byLength) byLength.set(b.stockMm, (byLength.get(b.stockMm) ?? 0) + b.count);
  const out: CostRow[] = [...byLength]
    .sort((a, b) => a[0] - b[0])
    .map(([mm, count]) => ({ key: `stick:${mm}`, item: `Stick ${lengthText(mm)}`, count, unit: prices[`stick:${mm}`] ?? 0 }));
  const sheets = sheetsOf(rows, mmOf(inputs.kerf, true) ?? 0);
  if (sheets && sheets.nest.sheets.length) {
    out.push({ key: "sheet", item: `Sheet ${lengthText(sheets.W)} x ${lengthText(sheets.H)}`, count: sheets.nest.sheets.length, unit: prices.sheet ?? 0 });
  }
  return out;
}

const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

function costTab(): HTMLElement {
  const total = h("p", { cls: "th-note" });
  const showTotal = (): void => {
    total.textContent = `Total ${money(costOf(costRows()))}`;
  };
  const columns = (): Column<CostRow>[] => [
    { label: "Item", value: (r) => r.item },
    { label: "Count", value: (r) => r.count, numeric: true },
    {
      label: "Price Each",
      value: (r) => money(r.unit),
      numeric: true,
      edit: (r, text) => {
        const t = text.trim();
        const price = t === "" ? 0 : Number(t.replace(",", "."));
        if (!(price >= 0) || !Number.isFinite(price)) {
          toast("A price is a number, 0 or more.", "info");
          table.refresh();
          return;
        }
        writeShow("Prices", PRICES_KEY, { ...shopPrices(), [r.key]: price });
        table.refresh();
        showTotal();
      },
    },
    { label: "Cost", value: (r) => money(r.count * r.unit), numeric: true },
  ];
  const table = dataTable<CostRow>(columns(), costRows, { empty: "Nothing to price yet. Make a flat or platform first." });
  showTotal();
  const csv = (): string => csvOf(columns(), costRows());
  return exportable(
    h(
      "div",
      { cls: "shop-tab" },
      h("p", { cls: "th-note", text: "The prices are yours: Rodeo doesn't know what lumber or ply costs. Type them in; they're kept in this drawing." }),
      table.element,
      total,
    ),
    csv,
    "shop-cost.csv",
  );
}

let panel: OpenPanel | null = null;

/** Opens the Cut List window, or brings it forward with the parts as they are now. */
export function openCutList(): void {
  const body = tabs([
    { id: "pieces", label: "Pieces", build: piecesTab },
    { id: "cut", label: "Cut List", build: cutListTab },
    { id: "lumber", label: "Lumber", build: lumberTab },
    { id: "sheets", label: "Sheets", build: sheetsTab },
    { id: "cost", label: "Cost", build: costTab },
  ]);
  panel?.close();
  panel = openPanel({ key: "shop.cutlist", title: "Cut List", body: body.element, width: 860, height: 620, onClose: () => (panel = null) });
}
