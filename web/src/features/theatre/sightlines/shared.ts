// What the Sightlines windows share: the venue's dimensions as the show keeps them, the active layer's
// scale for label sizes on paper, and the small SVG sketches the solvers draw in their windows. A sketch
// maps model millimetres into pixels so its text and lines read at window size.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { readShow } from "../show.ts";
import { VENUE_KEY, type VenueInfo } from "../showTypes.ts";
import "./sightlines.css";

/** The venue the show keeps, or null. */
export function venue(): VenueInfo | null {
  return readShow<VenueInfo | null>(VENUE_KEY, null);
}

/** The active design layer's scale (1:n gives n); 1 without a layer. */
export function activeScale(): number {
  const layer = store.session?.doc.layers().find((l) => l.id === store.activeLayerId);
  return layer?.scale || 1;
}

/** A point in a sketch, in pixels. */
export type Px = readonly [number, number];

export interface Fit {
  /** a model point (x right, y up, mm) in sketch pixels */
  readonly at: (x: number, y: number) => Px;
  readonly width: number;
  readonly height: number;
  /** pixels per mm */
  readonly scale: number;
}

/** A map fitting the model box x0..x1, y0..y1 into a sketch `width` pixels wide and at most `maxHeight` tall. */
export function fitBox(x0: number, x1: number, y0: number, y1: number, width = 480, maxHeight = 320): Fit {
  const m = 24;
  const spanX = Math.max(1, x1 - x0);
  const spanY = Math.max(1, y1 - y0);
  const k = Math.min((width - 2 * m) / spanX, (maxHeight - 2 * m) / spanY);
  const height = spanY * k + 2 * m;
  const left = (width - spanX * k) / 2;
  return { at: (x, y) => [left + (x - x0) * k, height - m - (y - y0) * k], width, height, scale: k };
}

export const svgLine = (a: Px, b: Px, cls: string): string => `<line class="${cls}" x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;

export const svgPoly = (pts: readonly Px[], cls: string): string => `<polyline class="${cls}" points="${pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ")}"/>`;

export const svgDot = (at: Px, r: number, cls: string): string => `<circle class="${cls}" cx="${at[0].toFixed(1)}" cy="${at[1].toFixed(1)}" r="${r}"/>`;

export const svgText = (at: Px, text: string, anchor: "start" | "middle" | "end", cls: string): string =>
  `<text class="${cls}" x="${at[0].toFixed(1)}" y="${at[1].toFixed(1)}" text-anchor="${anchor}">${text}</text>`;

/** A sketch figure of `body` (SVG elements) in `fit`'s box, labelled for screen readers. */
export function sketch(fit: Fit, body: string, label: string): HTMLElement {
  return h("figure", {
    cls: "sightlines-sketch",
    attrs: { role: "img", "aria-label": label },
    html: `<svg viewBox="0 0 ${fit.width} ${Math.round(fit.height)}">${body}</svg>`,
  });
}
