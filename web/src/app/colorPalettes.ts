// The colour palettes Vectorworks keeps beside a drawing's own colours: custom palettes made in the
// Color Palette Manager (colorPaletteManager.ts), kept in this browser as Vectorworks keeps them in
// the user folder, and offered in every colour picker while they are active. The drawing's own
// colours (Colors in Active Document) are always there; a colour taken from another palette is
// added to them. Also the colour sums the Edit Palette dialog uses: lighten, darken and the RGB
// and HSV blends.

export interface PaletteColor {
  /** #rrggbb */
  readonly css: string;
  readonly name: string;
}

export interface ColorPalette {
  readonly name: string;
  readonly colors: readonly PaletteColor[];
  /** shown in the colour pickers */
  readonly active: boolean;
}

/** the drawing's own colours, as Vectorworks names them */
export const DOCUMENT_PALETTE = "Colors in Active Document";
/** the most colours a blend makes, as Vectorworks allows */
export const MOST_BLENDED = 1000;
/** how far Lighten and Darken move a colour towards white or black each time */
const STEP = 0.1;

const STORAGE_KEY = "openvwx.colorPalettes.v1";
const HEX = /^#[0-9a-f]{6}$/;

const listeners = new Set<() => void>();
let palettes: readonly ColorPalette[] = load();

/** The palettes kept in `raw`; bad entries and colours are left out. */
function fromStored(raw: unknown): ColorPalette[] {
  if (!Array.isArray(raw)) return [];
  const out: ColorPalette[] = [];
  for (const p of raw as unknown[]) {
    if (!p || typeof p !== "object") continue;
    const { name, colors, active } = p as Record<string, unknown>;
    if (typeof name !== "string" || !name.trim() || name === DOCUMENT_PALETTE || out.some((q) => q.name === name)) continue;
    const list = Array.isArray(colors) ? (colors as unknown[]) : [];
    out.push({
      name,
      active: active !== false,
      colors: list.flatMap((c) => {
        const { css, name: label } = (c ?? {}) as Record<string, unknown>;
        return typeof css === "string" && HEX.test(css.toLowerCase()) ? [{ css: css.toLowerCase(), name: typeof label === "string" ? label : "" }] : [];
      }),
    });
  }
  return out;
}

function load(): ColorPalette[] {
  try {
    return fromStored(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

/** The custom palettes, in the order they were made. */
export const customPalettes = (): readonly ColorPalette[] => palettes;

/** The custom palettes the colour pickers offer. */
export const activePalettes = (): ColorPalette[] => palettes.filter((p) => p.active);

/** Keeps `next` as the custom palettes, in this browser when it lets us. */
export function setCustomPalettes(next: readonly ColorPalette[]): void {
  palettes = fromStored(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(palettes));
  } catch {
    // storage blocked: the palettes last for this visit only
  }
  for (const fn of listeners) fn();
}

/** Calls `fn` whenever the custom palettes change. */
export function onPalettesChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** `base` or, when a name in `taken` has it, `base 2`, `base 3` and so on. */
export function freePaletteName(base: string, taken: readonly string[]): string {
  const used = new Set([...taken, DOCUMENT_PALETTE]);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base} ${n}`)) return `${base} ${n}`;
}

const rgbOf = (css: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16) || 0) as [number, number, number];

const cssOf = (rgb: readonly number[]): string => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;

/** `css` a step nearer white. */
export const lighten = (css: string): string => cssOf(rgbOf(css).map((v) => v + (255 - v) * STEP));

/** `css` a step nearer black. */
export const darken = (css: string): string => cssOf(rgbOf(css).map((v) => v * (1 - STEP)));

/** Hue (0 to 360), saturation and value (0 to 1). */
function hsv([r, g, b]: readonly number[]): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  let hue = 0;
  if (d > 0) {
    if (max === R) hue = 60 * (((G - B) / d + 6) % 6);
    else if (max === G) hue = 60 * ((B - R) / d + 2);
    else hue = 60 * ((R - G) / d + 4);
  }
  return [hue, max > 0 ? d / max : 0, max];
}

function rgbFromHsv([hue, s, v]: readonly number[]): number[] {
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((u) => u * 255);
}

/**
 * `count` colours evenly between `a` and `b` (neither of them), mixed by their red, green and blue,
 * or by hue (the short way round the colour wheel), saturation and value.
 */
export function blend(a: string, b: string, count: number, by: "rgb" | "hsv"): string[] {
  const n = Math.max(0, Math.min(MOST_BLENDED, Math.floor(count)));
  const out: string[] = [];
  if (by === "rgb") {
    const [p, q] = [rgbOf(a), rgbOf(b)];
    for (let k = 1; k <= n; k++) out.push(cssOf(p.map((v, i) => v + ((q[i] - v) * k) / (n + 1))));
    return out;
  }
  const [p, q] = [hsv(rgbOf(a)), hsv(rgbOf(b))];
  // a grey has no hue of its own and black no saturation either: they take the other colour's,
  // so the blend doesn't swing through red or grey out
  for (const [x, y] of [
    [p, q],
    [q, p],
  ]) {
    if (x[2] === 0) x[1] = y[1];
    if (x[1] === 0 || x[2] === 0) x[0] = y[0];
  }
  let turn = q[0] - p[0];
  if (turn > 180) turn -= 360;
  if (turn < -180) turn += 360;
  for (let k = 1; k <= n; k++) {
    const t = k / (n + 1);
    out.push(cssOf(rgbFromHsv([(p[0] + turn * t + 360) % 360, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t])));
  }
  return out;
}
