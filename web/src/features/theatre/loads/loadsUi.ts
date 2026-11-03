// What the Load Check and Power Balance windows share: weights in kg (with lb beside them for a drawing in feet and
// inches), a weight typed in kg, the drawing's units, a window kept up to date while the drawing changes, and the
// SVG elements the batten drawings are made of. Their styles are in loads.css.

import { store } from "../../../app/state.ts";
import "./loads.css";

/** Pounds in a kilogram. */
export const LB_PER_KG = 2.20462;

/** Whether the drawing is in feet and inches: weights then also read in pounds, and supplies are 120 V. */
export function imperial(): boolean {
  return /feet|inch/i.test(store.session?.doc.info.units ?? "");
}

/** A weight in kg, with lb in brackets for a drawing in feet and inches. */
export function kgText(kg: number): string {
  const text = `${kg.toFixed(1)} kg`;
  return imperial() ? `${text} (${(kg * LB_PER_KG).toFixed(1)} lb)` : text;
}

/** The lines a weight takes on a drawing: kg, and lb under it in feet and inches. */
export function weightLines(kg: number): string[] {
  const kgLine = `${kg.toFixed(1)} kg`;
  return imperial() ? [kgLine, `(${(kg * LB_PER_KG).toFixed(1)} lb)`] : [kgLine];
}

/** A weight typed in kg, 0 or more; blank is 0. Null when the text isn't a weight. */
export function kgOf(text: string): number | null {
  const t = text.trim();
  if (t === "") return 0;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Calls `redraw` whenever the open drawing changes, until the returned function is called. */
export function watchDrawing(redraw: () => void): () => void {
  let s = store.session;
  let off = s?.onChange(() => redraw()) ?? (() => {});
  const offSession = store.on("session", () => {
    if (store.session === s) {
      redraw();
      return;
    }
    off();
    s = store.session;
    off = s?.onChange(() => redraw()) ?? (() => {});
    redraw();
  });
  return () => {
    off();
    offSession();
  };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** An SVG element with its attributes (and text) set. */
export function svgNode(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}
