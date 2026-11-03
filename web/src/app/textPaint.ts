// A text object's characters drawn on a 2D canvas as the drawing shows them: Vectorworks' line
// spacing and justification about the text's anchor, its rotation, its font (a narrow font this
// machine lacks drawn in the fallback, squeezed to its width), bold, italic and underline. The
// renderer draws text with it, and Text > Convert Text to Polylines traces what it draws.

import { isNarrowFont, TEXT_ASCENT, TEXT_LINE_HEIGHT, textTop, type BBox, type Shape } from "../core/index.ts";
import { textLines } from "./shapes.ts";

export const FONT = `Arial, "Helvetica Neue", Helvetica, sans-serif`;
/** How much narrower Arial Narrow sets than Arial; a missing narrow font is drawn squeezed by it. */
const NARROW_SQUEEZE = 0.82;
const SQUEEZE_SAMPLE = "abcdefghijklmnopqrstuvwxyz";
/** An underline's top below the baseline and its thickness, as shares of the size (Arial's). */
const UNDERLINE_AT = 0.1;
const UNDERLINE_WEIGHT = 0.07;

/** how much text in each narrow font is squeezed (squeeze) */
const squeezes = new Map<string, number>();

/**
 * How much to squeeze text in `font` across: NARROW_SQUEEZE for a narrow font (isNarrowFont)
 * that draws no narrower than the fallback here, so it is missing; else 1.
 */
function squeeze(ctx: CanvasRenderingContext2D, font: string | undefined): number {
  if (!isNarrowFont(font) || !font) return 1;
  let k = squeezes.get(font);
  if (k === undefined) {
    ctx.save();
    ctx.font = `100px "${font}", ${FONT}`;
    const own = ctx.measureText(SQUEEZE_SAMPLE).width;
    ctx.font = `100px ${FONT}`;
    const fallback = ctx.measureText(SQUEEZE_SAMPLE).width;
    ctx.restore();
    k = own > 0.95 * fallback ? NARROW_SQUEEZE : 1;
    squeezes.set(font, k);
  }
  return k;
}

/** The CSS font a text like `shape` is drawn in at `size`, its font named `name` (quotes taken out). */
function cssFont(shape: Shape, size: number, name: string | undefined): string {
  return `${shape.italic ? "italic " : ""}${shape.bold ? "bold " : ""}${size}px ${name ? `"${name}", ${FONT}` : FONT}`;
}

/** How far `line` runs, in world units, set as a text like `shape` (its size, font, bold, italic). */
export function lineWidth(ctx: CanvasRenderingContext2D, line: string, shape: Shape, font: string | undefined): number {
  const size = shape.textSize;
  if (!size || !(size > 0)) return 0;
  const name = font?.replace(/["\\]/g, "");
  ctx.save();
  ctx.font = cssFont(shape, size, name);
  const w = ctx.measureText(line).width * squeeze(ctx, name);
  ctx.restore();
  return w;
}

/**
 * Draws a text's characters in world coordinates (y up) in the context's fill style: `box` is
 * where the text lies, for one without an anchor, and `font` its font's name.
 */
export function paintText(ctx: CanvasRenderingContext2D, shape: Shape, box: BBox, font: string | undefined): void {
  const text = shape.text;
  if (!text) return;
  const lines = shape.lines ?? textLines(text);
  ctx.save();
  ctx.textBaseline = "alphabetic";
  const size = shape.textSize;
  if (shape.anchor && size && size > 0) {
    // lay out like Vectorworks: lines 1.14 x size apart, justified about the anchor
    ctx.translate(shape.anchor.x, shape.anchor.y);
    ctx.rotate(((shape.textAngle ?? 0) * Math.PI) / 180);
    ctx.scale(1, -1);
    const name = font?.replace(/["\\]/g, "");
    ctx.font = cssFont(shape, size, name);
    // a narrow font this machine lacks is drawn in the fallback, squeezed to its width
    const k = squeeze(ctx, name);
    if (k !== 1) ctx.scale(k, 1);
    const align = shape.hAlign === 2 ? 0.5 : shape.hAlign === 3 ? 1 : 0;
    ctx.textAlign = align === 0.5 ? "center" : align === 1 ? "right" : "left";
    const top = -textTop({ size, lines: lines.length, h: lines.length * TEXT_LINE_HEIGHT * size, vAlign: shape.vAlign ?? 1 });
    lines.forEach((line, i) => {
      const y = top + (i * TEXT_LINE_HEIGHT + TEXT_ASCENT) * size;
      ctx.fillText(line, 0, y);
      if (shape.underline && line !== "") {
        const w = ctx.measureText(line).width;
        ctx.fillRect(-align * w, y + UNDERLINE_AT * size, w, UNDERLINE_WEIGHT * size);
      }
    });
  } else {
    const height = box.y1 - box.y0;
    const fallback = Math.max((height / lines.length) * 0.8, 1e-3);
    if (height > 0) {
      ctx.translate(box.x0, box.y1);
      ctx.scale(1, -1);
      ctx.font = `${fallback}px ${FONT}`;
      ctx.textAlign = "left";
      lines.forEach((line, i) => ctx.fillText(line, 0, fallback * (i + 1)));
    }
  }
  ctx.restore();
}
