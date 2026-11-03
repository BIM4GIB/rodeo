// Resources > Edit Line Type, New Line Type and Duplicate Line Type: a dash style's name and its
// dash and gap lengths, as Vectorworks' Edit Line Type dialog sets them for a simple line type.
// Lengths are on the printed page (a layer at 1:n draws them n times longer), in millimetres or,
// in an imperial drawing, inches. A preview follows every change, and the line type's own
// previews are drawn anew from it on OK. The change is one undo step.

import type { LineType, ResourceInfo, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { previewPngs, previewSizes } from "./resourcePreview.ts";
import { store } from "./state.ts";
import { unitLabel } from "./units.ts";
import "./resourceEditor.css";

const MM_PER_INCH = 25.4;
/** dash and gap pairs a line type record has room for */
const MAX_PAIRS = 5;
/** the previews' scale: Vectorworks' own draw about this many pixels to the printed inch */
const PREVIEW_PX_PER_INCH = 36;
const IMPERIAL = new Set(["in", "ft", "yd", "mi"]);

/** Strokes `dashes` (paper inches) along the canvas's middle at `pxPerInch`, `width` px thick. */
function paintDashes(canvas: HTMLCanvasElement, dashes: readonly number[], pxPerInch: number, width: number, ink: string, ground: string | null): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const y = Math.floor(canvas.height / 2) + (width % 2 ? 0.5 : 0);
  ctx.clearRect(0, 0, w, canvas.height);
  if (ground) {
    ctx.fillStyle = ground;
    ctx.fillRect(0, 0, w, canvas.height);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  const period = dashes.reduce((a, b) => a + b, 0) * pxPerInch;
  if (!(period > 0)) return;
  let x = 0;
  for (let i = 0; x < w; i = (i + 1) % dashes.length) {
    const len = dashes[i] * pxPerInch;
    if (i % 2 === 0 && len > 0) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(Math.min(w, x + len), y);
      ctx.stroke();
    }
    x += len;
  }
}

/** A line type's previews, at the sizes `own` (the line type edited or copied) or the drawing's line types have. */
export function lineTypePreviews(doc: VwxDocument, dashes: readonly number[], own?: ResourceInfo): Map<number, Uint8Array> {
  return previewPngs(previewSizes(doc, "line-type", own), (c) => paintDashes(c, dashes, PREVIEW_PX_PER_INCH, 1, "#000000", null));
}

/** New Line Type…: an even dash. */
export function newLineType(): Promise<void> {
  return openEditor(null, "Line Type", [0.15, 0.1]);
}

/** Edit Line Type…: the line type with name index `index`. */
export function editLineType(index: number): Promise<void> {
  const lt = lineType(index);
  if (!lt?.dashes.length) return Promise.resolve();
  return openEditor(index, lt.name, lt.dashes);
}

/** Duplicate…: a copy of the line type to change. */
export function duplicateLineType(index: number): Promise<void> {
  const lt = lineType(index);
  if (!lt?.dashes.length) return Promise.resolve();
  return openEditor(null, lt.name, lt.dashes, index);
}

/** True when the line type's dashes can be read, so it can be edited here. */
export function canEditLineType(index: number): boolean {
  return !!lineType(index)?.dashes.length;
}

function lineType(index: number): LineType | undefined {
  return store.session?.doc.lineTypes().find((t) => t.style === -index);
}

/** The dialog: `index` is the line type edited (null for a new one); `like`, the one a duplicate copies. */
async function openEditor(index: number | null, name: string, start: readonly number[], like?: number): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const unit = IMPERIAL.has(unitLabel(doc.info.units)) ? "in" : "mm";
  const perUnit = unit === "in" ? 1 : 1 / MM_PER_INCH;
  const taken = new Set([
    ...doc.classes().map((c) => c.name),
    ...doc.layers().map((l) => l.name),
    ...doc.stories().map((s) => s.name),
    ...doc.resources().filter((r) => r.index !== index).map((r) => r.name),
  ]);
  let firstName = name;
  if (index === null) {
    const base = like === undefined ? name : name.replace(/-\d+$/, "");
    let n = like === undefined ? 1 : 2;
    while (taken.has(`${base}-${n}`)) n++;
    firstName = `${base}-${n}`;
  }
  // lengths in paper inches; a field left as shown keeps its exact length
  const dashes = [...start];
  const bad = new Set<HTMLInputElement>();

  const nameInput = h("input", { cls: "menu-dialog-input re-name", value: firstName, attrs: { type: "text", "aria-label": "Name", spellcheck: "false" } });
  const bar = h("canvas", { cls: "re-bar re-line", attrs: { "aria-label": "Preview", role: "img" } });
  const list = h("div", { cls: "re-list" });
  const add = h("button", { cls: "btn small re-add", text: "Add Dash", attrs: { type: "button" } });

  const redraw = (): void => {
    const dpr = window.devicePixelRatio || 1;
    bar.width = Math.max(1, Math.round(bar.clientWidth * dpr));
    bar.height = Math.max(1, Math.round(bar.clientHeight * dpr));
    // a few repeats across the bar, whatever their length
    const period = dashes.reduce((a, b) => a + b, 0);
    const k = period > 0 ? Math.min(PREVIEW_PX_PER_INCH * 4 * dpr, bar.width / 4 / period) : 1;
    const ink = getComputedStyle(bar).color || "#000000";
    paintDashes(bar, dashes, k, Math.max(1, Math.round(2 * dpr)), ink, null);
  };

  const render = (): void => {
    bad.clear();
    list.replaceChildren(
      h("div", { cls: "re-head lt-row" }, h("span", { text: `Dash (${unit})` }), h("span", { text: `Gap (${unit})` }), h("span")),
      ...Array.from({ length: dashes.length / 2 }, (_, p) => {
        const field = (i: number, label: string): HTMLInputElement => {
          const shown = String(Math.round((dashes[i] / perUnit) * 10000) / 10000);
          const input = h("input", { cls: "re-input", value: shown, attrs: { type: "text", inputmode: "decimal", "aria-label": `${label} ${p + 1}`, spellcheck: "false" } });
          input.addEventListener("input", () => {
            if (input.value === shown) {
              bad.delete(input);
              input.classList.remove("bad");
              return;
            }
            const v = Number(input.value.trim().replace(",", "."));
            const ok = input.value.trim() !== "" && v >= 0 && Number.isFinite(v);
            input.classList.toggle("bad", !ok);
            if (!ok) {
              bad.add(input);
              return;
            }
            bad.delete(input);
            dashes[i] = v * perUnit;
            redraw();
          });
          return input;
        };
        const remove = h("button", { cls: "re-btn", text: "×", title: "Remove this dash and its gap", attrs: { type: "button", "aria-label": `Remove dash ${p + 1}` } });
        remove.disabled = dashes.length <= 2;
        remove.addEventListener("click", () => {
          dashes.splice(2 * p, 2);
          render();
          redraw();
        });
        return h("div", { cls: "lt-row" }, field(2 * p, "Dash"), field(2 * p + 1, "Gap"), remove);
      }),
    );
    add.disabled = dashes.length / 2 >= MAX_PAIRS;
  };

  add.addEventListener("click", () => {
    // a dot and its gap after the last dash, as a dash-dot style starts
    const gap = dashes[dashes.length - 1];
    dashes.push(Math.max(gap / 4, 0.01), gap);
    render();
    redraw();
  });

  render();
  const result = showDialog<{ name: string; dashes: number[] }>({
    title: index === null ? (like === undefined ? "New Line Type" : "Duplicate Line Type") : `Edit Line Type: ${name}`,
    okLabel: "OK",
    cls: "re-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), nameInput),
      bar,
      list,
      add,
      h("p", { cls: "muted", text: "Lengths are on the printed page, so a layer at 1:100 draws them a hundred times longer." }),
    ],
    check: () => {
      const n = nameInput.value.trim();
      if (!n) return { error: "Enter a name for the line type.", focus: nameInput };
      if ((index === null || n !== name) && taken.has(n)) return { error: `"${n}" is already used in this drawing.`, focus: nameInput };
      const wrong = [...bad][0];
      if (wrong) return { error: `${wrong.getAttribute("aria-label")} takes a length of 0 or more.`, focus: wrong };
      if (!dashes.some((v, i) => i % 2 === 0 && v > 0)) return { error: "At least one dash needs a length." };
      return { value: { name: n, dashes: [...dashes] } };
    },
  });
  requestAnimationFrame(redraw);
  nameInput.focus();
  nameInput.select();
  const value = await result;
  if (!value) return;
  const own = doc.resources().find((r) => r.kind === "line-type" && r.index === (index ?? like));
  const pngs = lineTypePreviews(doc, value.dashes, own);
  if (index === null) {
    attempt(like === undefined ? "New line type" : "Duplicate line type", (s) => s.createLineType(value.name, value.dashes, pngs, like));
    return;
  }
  attempt("Edit line type", (s) =>
    s.batch(() => {
      s.editLineType(index, value.dashes, pngs);
      if (value.name !== name) s.renameResource(index, value.name);
    }),
  );
}
