// Vectorworks' image effects worked on a picture's pixels (imageEffects.ts is the dialog): Exposure,
// Contrast, Highlights, Shadows, Saturation, Temperature, Blur and Sharpness, Sepia, Soft Edges and
// Invert Colors, and Auto-Level, which picks Exposure and Contrast from the picture. The sliders run
// −100 to 100 (Sepia and Soft Edges 0 to 100), 0 leaving the picture as it is. Vectorworks doesn't
// publish its formulas; these are Rodeo's readings of its help: exposure in stops, contrast about
// middle grey, highlights and shadows weighted by lightness, temperature as red against blue, blur and
// sharpening and soft edges sized to the picture, so a small preview looks as the whole will. Pure.

export interface ImageEffects {
  readonly exposure: number;
  readonly contrast: number;
  readonly highlights: number;
  readonly shadows: number;
  readonly saturation: number;
  readonly temperature: number;
  /** Blur and Sharpness: below 0 blurs, above 0 sharpens */
  readonly sharpness: number;
  readonly sepia: number;
  readonly softEdges: number;
  readonly invert: boolean;
}

export const NO_EFFECTS: ImageEffects = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  temperature: 0,
  sharpness: 0,
  sepia: 0,
  softEdges: 0,
  invert: false,
};

/** stops of light at Exposure ±100 */
const STOPS = 2;
/** how far Highlights and Shadows at ±100 move the light or dark parts (of 1) */
const TONE = 0.35;
/** how far Temperature at ±100 moves red up and blue down (of 1) */
const WARM = 0.12;
/** Blur at −100: the blur's reach, of the picture's longer side */
const BLUR_REACH = 0.01;
/** Sharpness: the reach of the blur sharpening takes away, of the longer side, and its strength at 100 */
const SHARP_REACH = 0.003;
const SHARP_AMOUNT = 1.5;
/** Soft Edges at 100: how far in the fade reaches, of half the shorter side */
const SOFT_REACH = 0.6;

/** True when the effects leave a picture as it is. */
export function isPlain(e: ImageEffects): boolean {
  return !e.invert && !e.exposure && !e.contrast && !e.highlights && !e.shadows && !e.saturation && !e.temperature && !e.sharpness && !e.sepia && !e.softEdges;
}

/** True when the effects make some pixels see-through, so the picture needs a format that keeps them. */
export function needsAlpha(e: ImageEffects): boolean {
  return e.softEdges > 0;
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Contrast's slope about middle grey at slider `v`. */
function contrastSlope(v: number): number {
  return v >= 0 ? 1 + (v / 100) * 2 : 1 + (v / 100) * 0.75;
}

/** Applies `e` to the RGBA pixels `px` of a `w` × `h` picture, in place. */
export function applyEffects(px: Uint8ClampedArray, w: number, h: number, e: ImageEffects): void {
  if (isPlain(e)) return;
  tone(px, e);
  if (e.sharpness) sharpen(px, w, h, e.sharpness, Math.max(w, h));
  if (e.softEdges > 0) soften(px, w, h, e.softEdges);
}

/** The colour effects, pixel by pixel. */
function tone(px: Uint8ClampedArray, e: ImageEffects): void {
  const gain = 2 ** ((e.exposure / 100) * STOPS);
  const k = contrastSlope(e.contrast);
  const hi = (e.highlights / 100) * TONE;
  const lo = (e.shadows / 100) * TONE;
  const sat = 1 + e.saturation / 100;
  const warm = (e.temperature / 100) * WARM;
  const sepia = e.sepia / 100;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i] / 255;
    let g = px[i + 1] / 255;
    let b = px[i + 2] / 255;
    if (e.invert) {
      r = 1 - r;
      g = 1 - g;
      b = 1 - b;
    }
    r = (r * gain - 0.5) * k + 0.5;
    g = (g * gain - 0.5) * k + 0.5;
    b = (b * gain - 0.5) * k + 0.5;
    if (hi || lo) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      // Highlights lifts (or lowers) the light parts; Shadows to the right darkens the dark ones
      const d = hi * smoothstep(0.5, 1, l) - lo * (1 - smoothstep(0, 0.5, l));
      r += d;
      g += d;
      b += d;
    }
    if (sat !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      b = l + (b - l) * sat;
    }
    r += warm;
    b -= warm;
    if (sepia) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r += (sr - r) * sepia;
      g += (sg - g) * sepia;
      b += (sb - b) * sepia;
    }
    // the clamped array rounds and clamps
    px[i] = r * 255;
    px[i + 1] = g * 255;
    px[i + 2] = b * 255;
  }
}

/** One box blur of `radius` across rows (`across`) or down columns, from `src` into `dst`, edges held. */
function boxPass(src: Uint8ClampedArray, dst: Uint8ClampedArray, w: number, h: number, radius: number, across: boolean): void {
  const lines = across ? h : w;
  const len = across ? w : h;
  const step = across ? 4 : w * 4;
  const span = 2 * radius + 1;
  for (let line = 0; line < lines; line++) {
    const start = across ? line * w * 4 : line * 4;
    for (let c = 0; c < 4; c++) {
      const first = start + c;
      const last = first + (len - 1) * step;
      let sum = 0;
      for (let n = -radius; n <= radius; n++) sum += src[n <= 0 ? first : n >= len ? last : first + n * step];
      for (let n = 0; n < len; n++) {
        dst[first + n * step] = sum / span;
        const add = n + radius + 1;
        const drop = n - radius;
        sum += src[add >= len ? last : first + add * step] - src[drop <= 0 ? first : first + drop * step];
      }
    }
  }
}

/** `px` blurred: three box blurs each way, near enough a Gaussian of about `reach` pixels. */
function blurred(px: Uint8ClampedArray, w: number, h: number, reach: number): Uint8ClampedArray {
  const radius = Math.max(1, Math.round(reach / 2));
  const a = new Uint8ClampedArray(px);
  const b = new Uint8ClampedArray(px.length);
  for (let n = 0; n < 3; n++) {
    boxPass(a, b, w, h, radius, true);
    boxPass(b, a, w, h, radius, false);
  }
  return a;
}

/** Whether any pixel is less than solid. */
function hasAlpha(px: Uint8ClampedArray): boolean {
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  return false;
}

/** Blur and Sharpness: `v` below 0 blurs the picture, above 0 sharpens its edges (an unsharp mask). */
function sharpen(px: Uint8ClampedArray, w: number, h: number, v: number, longer: number): void {
  // see-through pixels are blurred weighted by how solid they are, so clear ones don't darken edges
  const clear = hasAlpha(px);
  if (clear)
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255;
      px[i] *= a;
      px[i + 1] *= a;
      px[i + 2] *= a;
    }
  if (v < 0) {
    const reach = (-v / 100) * BLUR_REACH * longer;
    if (reach >= 0.5) px.set(blurred(px, w, h, reach));
  } else {
    const soft = blurred(px, w, h, Math.max(1, SHARP_REACH * longer));
    const amount = (v / 100) * SHARP_AMOUNT;
    for (let i = 0; i < px.length; i++) if ((i & 3) !== 3) px[i] = px[i] + (px[i] - soft[i]) * amount;
  }
  if (clear)
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3] / 255;
      if (!a) continue;
      px[i] /= a;
      px[i + 1] /= a;
      px[i + 2] /= a;
    }
}

/** Soft Edges: the picture faded out toward its sides, as an old photograph's. */
function soften(px: Uint8ClampedArray, w: number, h: number, v: number): void {
  const reach = (v / 100) * SOFT_REACH * (Math.min(w, h) / 2);
  if (reach < 0.5) return;
  const fade = (n: number, len: number): number => smoothstep(0, reach, Math.min(n + 0.5, len - n - 0.5));
  const across = Float32Array.from({ length: w }, (_, x) => fade(x, w));
  for (let y = 0; y < h; y++) {
    const down = fade(y, h);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4 + 3;
      px[i] = px[i] * down * across[x];
    }
  }
}

/** Auto-Level: the Exposure and Contrast that stretch the picture's lightness (its darkest and lightest half percent left out) to nearly black and white; zero for a flat picture. */
export function autoLevel(px: Uint8ClampedArray): { exposure: number; contrast: number } {
  const counts = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    counts[Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])]++;
    n++;
  }
  if (!n) return { exposure: 0, contrast: 0 };
  const at = (fraction: number): number => {
    let seen = 0;
    for (let v = 0; v < 256; v++) {
      seen += counts[v];
      if (seen >= fraction * n) return v / 255;
    }
    return 1;
  };
  const lo = at(0.005);
  const hi = at(0.995);
  if (hi - lo < 0.02) return { exposure: 0, contrast: 0 };
  // (c·gain − ½)·k + ½ takes lo to `black` and hi to `white`
  const black = 0.02;
  const white = 0.98;
  const gk = (white - black) / (hi - lo);
  const k = 2 * (lo * gk - black + 0.5);
  if (!(k > 0)) return { exposure: 0, contrast: 0 };
  const gain = gk / k;
  const clamp = (x: number): number => Math.round(Math.min(100, Math.max(-100, x)));
  return {
    exposure: clamp((Math.log2(gain) / STOPS) * 100),
    contrast: clamp(k >= 1 ? ((k - 1) / 2) * 100 : ((k - 1) / 0.75) * 100),
  };
}
