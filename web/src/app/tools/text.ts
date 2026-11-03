// Text tool and the in-place text editor overlay. The editor is a positioned
// <textarea> in the canvas host; it commits on Enter or blur, cancels on Escape.

import type { NewShape, ObjectInfo, Pt } from "../../core/index.ts";
import { h } from "../dom.ts";
import { addAndSelect } from "../commands.ts";
import { clamp } from "../geom.ts";
import { store } from "../state.ts";
import { H_ALIGN, V_ALIGN } from "../textMenu.ts";
import type { View } from "../view.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";

/** How text lines up on the point it is placed at: Vectorworks' justification (1 left, 2 centre, 3 right) and vertical alignment (1 top … 5 bottom). */
export interface TextAlign {
  readonly h: number;
  readonly v: number;
}

export interface TextEditRequest {
  /** document coordinates of the text's anchor: its top-left corner, unless `align` says otherwise */
  readonly at: Pt;
  /** how the text lines up on `at` (left and top when left out) */
  readonly align?: TextAlign;
  readonly text: string;
  /** line height in document units; sets the editor's on-screen size */
  readonly heightWorld: number;
  readonly onCommit: (text: string) => void;
  /** runs once the editor closes, committed or not */
  readonly onClose?: () => void;
}

export class TextEditor {
  private readonly el: HTMLTextAreaElement;
  private req: TextEditRequest | null = null;

  constructor(
    host: HTMLElement,
    private readonly view: View,
  ) {
    this.el = h("textarea", { cls: "text-editor", attrs: { spellcheck: "false", rows: "1", "aria-label": "Text" } });
    this.el.hidden = true;
    host.append(this.el);
    this.el.addEventListener("keydown", (e) => this.onKey(e));
    this.el.addEventListener("input", () => this.autosize());
    this.el.addEventListener("blur", () => this.close(true));
  }

  get isOpen(): boolean {
    return this.req !== null;
  }

  open(req: TextEditRequest): void {
    this.close(true);
    this.req = req;
    this.el.value = req.text;
    this.el.hidden = false;
    this.reposition();
    this.el.focus();
    this.el.select();
  }

  /** Commits (if non-empty) or cancels the open editor. */
  close(commit: boolean): void {
    const req = this.req;
    if (!req) return;
    const text = this.el.value;
    // clear state before hiding: hiding can fire blur synchronously
    this.req = null;
    this.el.hidden = true;
    if (commit && text.trim() !== "") req.onCommit(text);
    req.onClose?.();
  }

  reposition(): void {
    const req = this.req;
    if (!req) return;
    const s = this.view.toScreen(req.at);
    const fontPx = clamp(req.heightWorld * this.view.scale * 0.8, 10, 96);
    this.el.style.left = `${s.x}px`;
    this.el.style.top = `${s.y}px`;
    this.el.style.fontSize = `${fontPx}px`;
    // the editor lines up on the anchor as the text will (a baseline about 0.85 em below a line's top)
    const h = req.align?.h ?? 1;
    const v = req.align?.v ?? 1;
    const x = h === 2 ? "-50%" : h === 3 ? "-100%" : "0px";
    const y = ["0px", "-0.85em", "-50%", "calc(-100% + 0.3em)", "-100%"][v - 1] ?? "0px";
    this.el.style.transform = `translate(${x}, ${y})`;
    this.el.style.textAlign = h === 2 ? "center" : h === 3 ? "right" : "left";
    this.autosize();
  }

  private autosize(): void {
    const lines = this.el.value.split("\n");
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    this.el.rows = Math.max(1, lines.length);
    this.el.cols = Math.max(12, longest + 2);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close(false);
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
    }
  }
}

export class TextTool extends BaseTool {
  readonly id = "text";
  readonly cursor = "text";

  private align: TextAlign = { h: 1, v: 1 };
  /** how high new text stands on paper, mm, whatever the layer's scale */
  private paperHeight = 2.5;

  modes(): ToolModes[] {
    return [
      {
        label: "Justification",
        options: H_ALIGN.map((a) => ({ id: `h${a.value}`, label: a.label, key: a.value })),
        active: `h${this.align.h}`,
      },
      { label: "Vertical alignment", options: V_ALIGN.map((a) => ({ id: `v${a.value}`, label: a.label })), active: `v${this.align.v}` },
    ];
  }

  setMode(id: string): void {
    const n = Number(id.slice(1));
    if (id.startsWith("h")) this.align = { ...this.align, h: n };
    else if (id.startsWith("v")) this.align = { ...this.align, v: n };
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  /** Create Similar Object: new text is justified as this text is, and as high on paper. */
  takeFrom(obj: ObjectInfo): boolean {
    const s = obj.shape;
    if (s?.kind !== "text") return false;
    this.align = { h: s.hAlign ?? this.align.h, v: s.vAlign ?? this.align.v };
    const scale = this.env.scene.layer(obj.layerId)?.scale;
    if (s.textSize && scale) this.paperHeight = s.textSize / scale;
    return true;
  }

  hint(): string {
    return "Click to place text · Enter commits · Shift+Enter new line · 1–3 justification";
  }

  down(p: PointerInfo): void {
    const layerId = store.activeLayerId;
    const layer = layerId ? this.env.scene.layer(layerId) : undefined;
    if (!layer) return;
    // text height is set on paper (2.5 mm until Create Similar Object takes another's), so in model units it is that x scale
    const height = this.paperHeight * layer.scale;
    const at = p.pos;
    const align = this.align;
    this.env.text.open({
      at,
      align,
      text: "",
      heightWorld: height,
      onCommit: (text) => {
        // level on screen, in a rotated plan too
        const turned = this.env.view.rotation;
        const shape: NewShape = { kind: "text", at, text, height, ...(turned === 0 ? {} : { angle: (-turned * 180) / Math.PI }) };
        // justifying moves the origin so the text stays put, so the origin goes back on the click after
        addAndSelect(shape, undefined, (s, id) => {
          s.setTextStyle([id], { hAlign: align.h, vAlign: align.v });
          s.setGeometry(id, shape);
        });
      },
    });
  }
}
