// Stage > Scene Shop > Model Box Cut Sheet…: the shop's flats and platforms as a model at a chosen scale, on sheets of
// card for a laser cutter. modelBox.ts lays them out; this window shows each sheet and saves them: one SVG for a
// single sheet, or a zip with one SVG per sheet.

import { downloadBlob } from "../../../app/fileio.ts";
import { h } from "../../../app/dom.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { zipFiles } from "../../../export/zip.ts";
import { downloadText, noteLine, openPanel, type OpenPanel } from "../ui.ts";
import { MODEL_SCALES, MODEL_SHEETS, modelBoxSheets, svgUrl, type ModelSheets } from "./modelBox.ts";
import { shopPieces } from "./pieces.ts";

let panel: OpenPanel | null = null;

/** Asks for the scale, card and sheet, then shows the cut sheets for saving. */
export async function openModelBox(): Promise<void> {
  const pieces = shopPieces();
  if (pieces.length === 0) {
    toast("No pieces to draw yet: make a flat or platform first.", "info");
    return;
  }
  const v = await toolPrefs(
    "Model Box Cut Sheet",
    [
      { kind: "choice", key: "scale", label: "Scale", value: "25", options: MODEL_SCALES.map((n) => ({ value: String(n), label: `1:${n}` })) },
      { kind: "length", key: "thick", label: "Card Thickness", value: 3 },
      { kind: "choice", key: "sheet", label: "Sheet", value: "A3", options: MODEL_SHEETS.map((s) => ({ value: s.name, label: `${s.name} (${s.widthMm} x ${s.heightMm} mm)` })) },
    ],
    "A flat is one rectangle at the scale, its openings not modelled. A platform is a box: its top and four sides, with tabs of the card's thickness along the joints. Cut lines are red hairlines and names are blue text, in mm, ready for a laser cutter.",
  );
  if (!v) return;
  const sheet = MODEL_SHEETS.find((s) => s.name === v.choice("sheet")) ?? MODEL_SHEETS[0];
  const scale = Number(v.choice("scale"));
  const result = modelBoxSheets(pieces, { scale, thickMm: v.num("thick"), sheetWidthMm: sheet.widthMm, sheetHeightMm: sheet.heightMm });
  showSheets(result, scale, sheet.name);
}

function showSheets(result: ModelSheets, scale: number, sheetName: string): void {
  panel?.close();
  const n = result.svgs.length;
  const body: HTMLElement[] = [
    noteLine(`${result.pieceCount} piece${result.pieceCount === 1 ? "" : "s"} at 1:${scale}, on ${n} ${sheetName} sheet${n === 1 ? "" : "s"}.`),
  ];
  if (result.tooBig.length) body.push(noteLine(`Too big for a ${sheetName} sheet at 1:${scale}: ${result.tooBig.join(", ")}. Try a bigger sheet or a smaller scale.`, "th-bad"));
  result.svgs.forEach((svg, i) => {
    body.push(h("div", { cls: "shop-sheet" }, h("p", { cls: "th-note", text: `Sheet ${i + 1}` }), h("img", { attrs: { src: svgUrl(svg), alt: `Sheet ${i + 1}` } })));
  });
  const base = `model-box-1-${scale}`;
  const save = (): void => {
    if (n === 1) {
      downloadText(`${base}.svg`, result.svgs[0], "image/svg+xml");
      return;
    }
    const enc = new TextEncoder();
    const files: [string, Uint8Array][] = result.svgs.map((svg, i) => [`${base}-sheet-${i + 1}.svg`, enc.encode(svg)]);
    downloadBlob(`${base}.zip`, new Blob([zipFiles(files) as BlobPart], { type: "application/zip" }));
  };
  panel = openPanel({
    key: "shop.modelbox",
    title: `Model Box · 1:${scale}`,
    body: h("div", { cls: "shop-tab" }, ...body),
    width: 760,
    height: 580,
    actions: n ? [{ label: n === 1 ? "Save SVG" : "Save Zip", run: save, primary: true }] : undefined,
    onClose: () => (panel = null),
  });
}
