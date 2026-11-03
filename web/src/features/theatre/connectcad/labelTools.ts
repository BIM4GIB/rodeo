// The Color-Coded Linked Text and Linked QR Code tools: a click in a label of a label format
// (labels.ts) on the active layer adds a color code or a QR code of a worksheet column to what every
// label of that format shows, its top left where the click was. Preferences: the column, and the
// color code's digits and size or the QR code's size.

import type { Pt } from "../../../core/index.ts";
import { store } from "../../../app/state.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { BaseTool, strokeScreen, withPreview, type Painter, type PointerInfo } from "../../../app/tools.ts";
import { addLabelItem, columnNamesOf, labelCellAt } from "./labels.ts";
import type { LabelItem } from "./labelShapes.ts";

export const labelToolSettings = { column: 1, digits: 3, codeWidth: 15, codeHeight: 5, qrSize: 15 };

/** The tools' shared clicks: what they add, and how big it is. */
abstract class LabelItemTool extends BaseTool {
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;
  protected abstract readonly what: string;
  /** the item's width and height, mm */
  protected abstract size(): { width: number; height: number };
  protected abstract item(x: number, y: number): LabelItem;

  /** the column field, with the worksheet's headings when a label format is selected */
  protected columnField() {
    const s = store.session;
    const id = s ? [...store.selection].find((x) => columnNamesOf(s.doc, x).length) : undefined;
    const names = s && id ? columnNamesOf(s.doc, id) : [];
    const k = labelToolSettings;
    return names.length
      ? { kind: "choice" as const, key: "column", label: "Selected Column", value: String(k.column), options: names.map((n, i) => ({ value: String(i + 1), label: n })) }
      : { kind: "number" as const, key: "column", label: "Selected Column", value: k.column, min: 1, max: 999, integer: true };
  }

  hint(): string {
    const s = store.session;
    const cell = s && this.pointer && store.activeLayerId ? labelCellAt(s.doc, store.activeLayerId, this.pointer) : null;
    return cell ? `Click to add ${this.what} of column ${labelToolSettings.column} to every label here` : `Click in a label of a label format to add ${this.what} of a worksheet column`;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
    this.env.requestDraw();
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const s = store.session;
    const layerId = store.activeLayerId;
    const cell = s && layerId ? labelCellAt(s.doc, layerId, p.pos) : null;
    if (!cell) {
      store.setHint("Click in a label: make labels with Create Labels, in Stage > ConnectCAD");
      return;
    }
    // kept inside the label
    const { width, height } = this.size();
    const x = Math.max(0, Math.min(cell.x, cell.width - width));
    const y = Math.max(0, Math.min(cell.y, cell.height - height));
    addLabelItem(cell.id, this.item(Math.round(x * 10) / 10, Math.round(y * 10) / 10));
  }

  overlay(g: Painter): void {
    const p = this.pointer;
    if (!p) return;
    const { width, height } = this.size();
    withPreview(g, () =>
      strokeScreen(
        g,
        [
          { x: p.x, y: p.y },
          { x: p.x + width, y: p.y },
          { x: p.x + width, y: p.y - height },
          { x: p.x, y: p.y - height },
        ],
        true,
      ),
    );
  }
}

export class ColorCodedTextTool extends LabelItemTool {
  readonly id = "cclabelcolor";
  protected readonly what = "colour-coded digits";

  protected size() {
    return { width: labelToolSettings.codeWidth, height: labelToolSettings.codeHeight };
  }

  protected item(x: number, y: number): LabelItem {
    const k = labelToolSettings;
    return { kind: "color", x, y, width: k.codeWidth, height: k.codeHeight, column: k.column, digits: k.digits };
  }

  async preferences(): Promise<void> {
    const k = labelToolSettings;
    const v = await toolPrefs(
      "Color-Coded Linked Text Preferences",
      [
        this.columnField(),
        { kind: "number", key: "digits", label: "Digits", value: k.digits, min: 1, max: 12, integer: true },
        { kind: "length", key: "width", label: "Width", value: k.codeWidth },
        { kind: "length", key: "height", label: "Height", value: k.codeHeight },
      ],
      "Each digit of the column's value shows on its colour in the resistor colour code (0 black, 1 brown, 2 red, 3 orange, 4 yellow, 5 green, 6 blue, 7 violet, 8 grey, 9 white), the last ones when it has more, 0 in front when it has fewer. Width and height are on paper.",
    );
    if (!v) return;
    k.column = Math.max(1, Math.round(v.num("column")));
    k.digits = v.num("digits");
    k.codeWidth = Math.max(1, v.num("width"));
    k.codeHeight = Math.max(0.5, v.num("height"));
  }
}

export class LinkedQrTool extends LabelItemTool {
  readonly id = "cclabelqr";
  protected readonly what = "a QR code";

  protected size() {
    return { width: labelToolSettings.qrSize, height: labelToolSettings.qrSize };
  }

  protected item(x: number, y: number): LabelItem {
    return { kind: "qr", x, y, size: labelToolSettings.qrSize, column: labelToolSettings.column };
  }

  async preferences(): Promise<void> {
    const k = labelToolSettings;
    const v = await toolPrefs("Linked QR Code Preferences", [this.columnField(), { kind: "length", key: "size", label: "Draw Size", value: k.qrSize }], "The QR code holds the column's value, its margin included in the size, on paper.");
    if (!v) return;
    k.column = Math.max(1, Math.round(v.num("column")));
    k.qrSize = Math.max(2, v.num("size"));
  }
}
