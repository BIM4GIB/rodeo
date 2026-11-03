// PNG export of a drawing. svgToPng draws the SVG on a canvas at the pixel size asked for
// (svgToCanvas leaves it on the canvas, for other image types); svgPaperMm and pngPixelSize work
// out that size from the drawing's size on paper.

/** The longer side of a PNG, in pixels: larger images are scaled down to it. */
export const MAX_PNG_SIDE = 8000;

const MM_PER_INCH = 25.4;
/** CSS pixels per inch, for SVG lengths written in px (and unitless ones). */
const PX_PER_INCH = 96;

/** A size on paper, in millimetres. */
export interface PaperSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Renders an SVG document to a PNG blob of widthPx by heightPx. The background is filled first
 * (white by default; "" leaves it transparent).
 */
export async function svgToPng(svgText: string, widthPx: number, heightPx: number, background = "#ffffff"): Promise<Blob> {
  return canvasBlob(await svgToCanvas(svgText, widthPx, heightPx, background), "image/png");
}

/** The canvas encoded as `type` (PNG, JPEG or WebP; `quality` 0–1 for the lossy ones). */
export function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("the image could not be encoded"));
      },
      type,
      quality,
    ),
  );
}

/** Draws an SVG document on a new canvas of widthPx by heightPx, over `background` ("" leaves it transparent). */
export function svgToCanvas(svgText: string, widthPx: number, heightPx: number, background = "#ffffff"): Promise<HTMLCanvasElement> {
  const width = Math.max(1, Math.round(widthPx));
  const height = Math.max(1, Math.round(heightPx));
  let sized: string;
  try {
    sized = withSize(svgText, width, height);
  } catch (err) {
    return Promise.reject(err);
  }
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml" }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("the browser has no 2D canvas");
        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas);
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("the drawing could not be loaded as an image"));
    };
    img.src = url;
  });
}

/** The SVG looking at `box` (world millimetres, y up) instead of the whole drawing. */
export function svgViewing(svgText: string, box: { x0: number; y0: number; x1: number; y1: number }): string {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg") throw new Error("the drawing is not an SVG document");
  // the SVG's y runs down: world y is negated
  root.setAttribute("viewBox", [box.x0, -box.y1, box.x1 - box.x0, box.y1 - box.y0].join(" "));
  return new XMLSerializer().serializeToString(root);
}

/** The SVG with its root width and height set to the pixel size, so it is drawn at that size. */
function withSize(svgText: string, width: number, height: number): string {
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg") throw new Error("the drawing is not an SVG document");
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  return new XMLSerializer().serializeToString(root);
}

/**
 * The drawing's size on paper in millimetres. The SVG's width and height win when they are lengths
 * with a unit; otherwise its viewBox is taken in document units, each `mmPerUnit` millimetres.
 * Throws when the SVG gives neither.
 */
export function svgPaperMm(svgText: string, mmPerUnit: number): PaperSize {
  const tag = /<svg\b[^>]*>/i.exec(svgText)?.[0] ?? "";
  const width = lengthMm(attrOf(tag, "width") ?? "");
  const height = lengthMm(attrOf(tag, "height") ?? "");
  if (width !== null && height !== null && width > 0 && height > 0) return { width, height };
  const box = (attrOf(tag, "viewBox") ?? "").trim().split(/[\s,]+/).map(Number);
  if (box.length !== 4 || !box.every((v) => Number.isFinite(v))) throw new Error("the drawing has no size");
  return { width: box[2] * mmPerUnit, height: box[3] * mmPerUnit };
}

/** The value of an attribute in a tag, or null. */
function attrOf(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return m ? m[1] : null;
}

/** A length such as "210mm", "8.5in" or "720" (px) in millimetres; null when it is not an absolute length. */
function lengthMm(text: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*(mm|cm|in|pt|pc|px)?\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  switch ((m[2] ?? "px").toLowerCase()) {
    case "mm":
      return n;
    case "cm":
      return n * 10;
    case "in":
      return n * MM_PER_INCH;
    case "pt":
      return (n * MM_PER_INCH) / 72;
    case "pc":
      return (n * MM_PER_INCH) / 6;
    default:
      return (n * MM_PER_INCH) / PX_PER_INCH;
  }
}

/**
 * Pixels for a paper size at a resolution in dpi. A size whose longer side would pass maxSide is
 * scaled down to it; `capped` says so.
 */
export function pngPixelSize(
  paper: PaperSize,
  dpi: number,
  maxSide = MAX_PNG_SIDE,
): { readonly width: number; readonly height: number; readonly capped: boolean } {
  const perMm = dpi / MM_PER_INCH;
  let width = paper.width * perMm;
  let height = paper.height * perMm;
  const capped = Math.max(width, height) > maxSide;
  if (capped) {
    const k = maxSide / Math.max(width, height);
    width *= k;
    height *= k;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)), capped };
}
