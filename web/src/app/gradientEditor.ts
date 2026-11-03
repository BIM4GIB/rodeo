// Resources > Edit Gradient, New Gradient and Duplicate Gradient: a gradient's name and its colour
// stops, as Vectorworks' Edit Gradient dialog sets them. Each stop has a position along the
// gradient, a colour, an opacity, and a midpoint: where the blend to the next stop is half way, as
// a share of the gap. A preview bar follows every change, and the gradient's own previews are
// drawn anew from it on OK. The change is one undo step.

import type { GradientStop, ResourceInfo, VwxDocument } from "../core/index.ts";
import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { addGradientStops } from "./renderer.ts";
import { previewPngs, previewSizes } from "./resourcePreview.ts";
import { store } from "./state.ts";
import "./resourceEditor.css";

/** the most stops a gradient record has room for */
const MAX_STOPS = 255;
/** the checkerboard's squares behind the preview bar, CSS px */
const CHECK_PX = 6;

/** One stop as the dialog edits it, in percent; `orig` is the stop as the file has it, kept while it doesn't change. */
interface Row {
  at: number;
  color: string;
  opacity: number;
  midpoint: number;
  orig: GradientStop | null;
}

function rowOf(s: GradientStop): Row {
  return { at: s.at * 100, color: s.color, opacity: s.opacity * 100, midpoint: s.midpoint * 100, orig: s };
}

function stopOf(r: Row): GradientStop {
  return r.orig ?? { at: r.at / 100, color: r.color.toLowerCase(), opacity: r.opacity / 100, midpoint: r.midpoint / 100 };
}

/** Paints `stops` left to right across the canvas, over a checkerboard when `checks` so clear stops show. */
function paintGradient(canvas: HTMLCanvasElement, stops: readonly GradientStop[], checks: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  if (checks > 0) {
    ctx.fillStyle = "#d9d9d9";
    for (let y = 0; y * checks < height; y++) for (let x = y % 2; x * checks < width; x += 2) ctx.fillRect(x * checks, y * checks, checks, checks);
  }
  const ramp = ctx.createLinearGradient(0, 0, width, 0);
  addGradientStops(ramp, [...stops].sort((a, b) => a.at - b.at));
  ctx.fillStyle = ramp;
  ctx.fillRect(0, 0, width, height);
}

/** A gradient's previews, at the sizes `own` (the gradient edited or copied) or the drawing's gradients have. */
export function gradientPreviews(doc: VwxDocument, stops: readonly GradientStop[], own?: ResourceInfo): Map<number, Uint8Array> {
  // a drawing's first gradient is copied from one of its hatches
  const sizes = previewSizes(doc, own || doc.resources().some((r) => r.kind === "gradient") ? "gradient" : "hatch", own);
  return previewPngs(sizes, (c) => paintGradient(c, stops, 0));
}

/** New Gradient…: black to white. */
export function newGradient(): Promise<void> {
  return openEditor(null, "Gradient", [
    { at: 0, color: "#000000", opacity: 1, midpoint: 0.5 },
    { at: 1, color: "#ffffff", opacity: 1, midpoint: 0.5 },
  ]);
}

/** Edit Gradient…: the gradient with name index `index`. */
export function editGradient(index: number): Promise<void> {
  const res = store.session?.doc.resources().find((r) => r.kind === "gradient" && r.index === index);
  if (!res?.gradient) return Promise.resolve();
  return openEditor(index, res.name, res.gradient);
}

/** Duplicate…: a copy of the gradient to change. */
export function duplicateGradient(index: number): Promise<void> {
  const res = store.session?.doc.resources().find((r) => r.kind === "gradient" && r.index === index);
  if (!res?.gradient) return Promise.resolve();
  return openEditor(null, res.name, res.gradient, index);
}

/** The drawing's names, but `own`'s: a resource can't take one of them. */
function takenNames(doc: VwxDocument, own: number | null): Set<string> {
  return new Set([
    ...doc.classes().map((c) => c.name),
    ...doc.layers().map((l) => l.name),
    ...doc.stories().map((s) => s.name),
    ...doc.resources().filter((r) => r.index !== own).map((r) => r.name),
  ]);
}

/** `base`-n, the first n from `from` the drawing doesn't use. */
function freeName(taken: ReadonlySet<string>, base: string, from: number): string {
  let n = from;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** The dialog: `index` is the gradient edited (null for a new one); `like`, the one a duplicate copies. */
async function openEditor(index: number | null, name: string, start: readonly GradientStop[], like?: number): Promise<void> {
  const doc = store.session?.doc;
  if (!doc) return;
  const taken = takenNames(doc, index);
  const firstName = index !== null ? name : like === undefined ? freeName(taken, name, 1) : freeName(taken, name.replace(/-\d+$/, ""), 2);
  const rows = start.map(rowOf);
  const bad = new Set<HTMLInputElement>();

  const nameInput = h("input", { cls: "menu-dialog-input re-name", value: firstName, attrs: { type: "text", "aria-label": "Name", spellcheck: "false" } });
  const bar = h("canvas", { cls: "re-bar", attrs: { "aria-label": "Preview", role: "img" } });
  const list = h("div", { cls: "re-list" });
  const add = h("button", { cls: "btn small re-add", text: "Add Stop", attrs: { type: "button" } });

  const redraw = (): void => {
    const dpr = window.devicePixelRatio || 1;
    bar.width = Math.max(1, Math.round(bar.clientWidth * dpr));
    bar.height = Math.max(1, Math.round(bar.clientHeight * dpr));
    paintGradient(bar, rows.map(stopOf), Math.round(CHECK_PX * dpr));
  };

  const render = (): void => {
    bad.clear();
    list.replaceChildren(
      h("div", { cls: "re-head grad-row" }, h("span", { text: "Position %" }), h("span", { text: "Colour" }), h("span", { text: "Opacity %" }), h("span", { text: "Midpoint %" }), h("span")),
      ...rows.map((r, i) => {
        const changed = (): void => {
          r.orig = null;
          redraw();
        };
        const num = (label: string, get: () => number, set: (v: number) => void): HTMLInputElement => {
          const shown = String(Math.round(get() * 100) / 100);
          const input = h("input", { cls: "re-input", value: shown, attrs: { type: "text", inputmode: "decimal", "aria-label": `${label}, stop ${i + 1}`, spellcheck: "false" } });
          input.addEventListener("input", () => {
            // left as shown, it keeps its exact value (the field rounds it)
            if (input.value === shown) {
              bad.delete(input);
              input.classList.remove("bad");
              return;
            }
            const v = Number(input.value.trim().replace(",", "."));
            const ok = input.value.trim() !== "" && v >= 0 && v <= 100;
            input.classList.toggle("bad", !ok);
            if (!ok) {
              bad.add(input);
              return;
            }
            bad.delete(input);
            set(v);
            changed();
          });
          return input;
        };
        const colour = h("input", { cls: "re-colour", value: r.color, attrs: { type: "color", "aria-label": `Colour, stop ${i + 1}` } });
        colour.addEventListener("input", () => {
          r.color = colour.value;
          changed();
        });
        const remove = h("button", { cls: "re-btn", text: "×", title: "Remove this stop", attrs: { type: "button", "aria-label": `Remove stop ${i + 1}` } });
        remove.disabled = rows.length <= 2;
        remove.addEventListener("click", () => {
          rows.splice(i, 1);
          render();
          redraw();
        });
        // the last stop has no gap after it, so no midpoint
        const mid = i < rows.length - 1 ? num("Midpoint", () => r.midpoint, (v) => (r.midpoint = v)) : h("span", { cls: "muted", text: "–" });
        return h(
          "div",
          { cls: "grad-row" },
          num("Position", () => r.at, (v) => (r.at = v)),
          colour,
          num("Opacity", () => r.opacity, (v) => (r.opacity = v)),
          mid,
          remove,
        );
      }),
    );
    add.disabled = rows.length >= MAX_STOPS;
  };

  // a new stop goes in the middle of the widest gap, in the colour half way across it
  add.addEventListener("click", () => {
    const sorted = rows.map((r, i) => ({ r, i })).sort((a, b) => a.r.at - b.r.at);
    let k = 0;
    for (let j = 1; j < sorted.length - 1; j++) if (sorted[j + 1].r.at - sorted[j].r.at > sorted[k + 1].r.at - sorted[k].r.at) k = j;
    const a = sorted[k].r;
    const b = sorted[k + 1]?.r ?? a;
    const mix = (x: string, y: string): string => {
      const p = parseInt(x.slice(1), 16);
      const q = parseInt(y.slice(1), 16);
      const ch = (s: number): number => Math.round((((p >> s) & 255) + ((q >> s) & 255)) / 2);
      return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
    };
    rows.splice(sorted[k].i + 1, 0, { at: (a.at + b.at) / 2, color: mix(a.color, b.color), opacity: (a.opacity + b.opacity) / 2, midpoint: 50, orig: null });
    render();
    redraw();
  });

  render();
  const result = showDialog<{ name: string; stops: GradientStop[] }>({
    title: index === null ? (like === undefined ? "New Gradient" : "Duplicate Gradient") : `Edit Gradient: ${name}`,
    okLabel: "OK",
    cls: "re-dialog",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Name" }), nameInput),
      bar,
      list,
      add,
      h("p", { cls: "muted", text: "Stops run left to right by position. The midpoint is where the blend to the next stop is half way across the gap." }),
    ],
    check: () => {
      const n = nameInput.value.trim();
      if (!n) return { error: "Enter a name for the gradient.", focus: nameInput };
      if ((index === null || n !== name) && taken.has(n)) return { error: `"${n}" is already used in this drawing.`, focus: nameInput };
      const wrong = [...bad][0];
      if (wrong) return { error: `${wrong.getAttribute("aria-label")} takes a number from 0 to 100.`, focus: wrong };
      // stored by position, as the file keeps them
      const stops = [...rows].sort((a, b) => a.at - b.at).map(stopOf);
      return { value: { name: n, stops } };
    },
  });
  // the bar takes its size from the laid-out dialog
  requestAnimationFrame(redraw);
  nameInput.focus();
  nameInput.select();
  const value = await result;
  if (!value) return;
  const own = doc.resources().find((r) => r.kind === "gradient" && r.index === (index ?? like));
  const pngs = gradientPreviews(doc, value.stops, own);
  if (index === null) {
    attempt(like === undefined ? "New gradient" : "Duplicate gradient", (s) => s.createGradient(value.name, value.stops, pngs, like));
    return;
  }
  attempt("Edit gradient", (s) =>
    s.batch(() => {
      s.editGradient(index, value.stops, pngs);
      if (value.name !== name) s.renameResource(index, value.name);
    }),
  );
}
