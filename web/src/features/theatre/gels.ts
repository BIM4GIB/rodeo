// Colour filters by their catalogue numbers, as a light's Color field names them ("R80", "L201"), with
// the colour each roughly gives a white beam. These are Rodeo's approximate sRGB readings for preview
// and paperwork, not the makers' published spectra. A Color field can also hold "#rrggbb" for an LED
// colour, and several gels as "L201+L119". Kept apart so it runs without the page.

export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface Gel {
  /** what a Color field holds, upper case */
  readonly code: string;
  readonly name: string;
  readonly hex: string;
}

export const GELS: readonly Gel[] = [
  { code: "L101", name: "Yellow", hex: "#ffe600" },
  { code: "L106", name: "Primary Red", hex: "#e6001e" },
  { code: "L119", name: "Dark Blue", hex: "#0030a0" },
  { code: "L120", name: "Deep Blue", hex: "#0035c4" },
  { code: "L124", name: "Dark Green", hex: "#00a060" },
  { code: "L126", name: "Mauve", hex: "#8a1e7e" },
  { code: "L132", name: "Medium Blue", hex: "#0070c8" },
  { code: "L136", name: "Pale Lavender", hex: "#d6c8f5" },
  { code: "L137", name: "Special Lavender", hex: "#b8a8ee" },
  { code: "L138", name: "Pale Green", hex: "#e4f5b0" },
  { code: "L139", name: "Primary Green", hex: "#008a2e" },
  { code: "L147", name: "Apricot", hex: "#ffa874" },
  { code: "L151", name: "Gold Tint", hex: "#ffd9c4" },
  { code: "L152", name: "Pale Gold", hex: "#ffddbe" },
  { code: "L153", name: "Pale Salmon", hex: "#ffc6c0" },
  { code: "L154", name: "Pale Rose", hex: "#ffd6cf" },
  { code: "L161", name: "Slate Blue", hex: "#7ab4e4" },
  { code: "L164", name: "Flame Red", hex: "#f0301e" },
  { code: "L180", name: "Dark Lavender", hex: "#5a3cc8" },
  { code: "L181", name: "Congo Blue", hex: "#200a8c" },
  { code: "L195", name: "Zenith Blue", hex: "#2840c0" },
  { code: "L201", name: "Full CT Blue", hex: "#8fb6ff" },
  { code: "L202", name: "1/2 CT Blue", hex: "#bbd2ff" },
  { code: "L203", name: "1/4 CT Blue", hex: "#d9e4ff" },
  { code: "L204", name: "Full CT Orange", hex: "#ffb26b" },
  { code: "L205", name: "1/2 CT Orange", hex: "#ffcf9b" },
  { code: "L206", name: "1/4 CT Orange", hex: "#ffe3c4" },
  { code: "R02", name: "Bastard Amber", hex: "#ffc8a0" },
  { code: "R08", name: "Pale Gold", hex: "#ffdfc0" },
  { code: "R09", name: "Pale Amber Gold", hex: "#ffd0a0" },
  { code: "R20", name: "Medium Amber", hex: "#ffa830" },
  { code: "R21", name: "Golden Amber", hex: "#ff8020" },
  { code: "R26", name: "Light Red", hex: "#e8102a" },
  { code: "R27", name: "Medium Red", hex: "#c4001e" },
  { code: "R33", name: "No Color Pink", hex: "#ffc8d0" },
  { code: "R54", name: "Special Lavender", hex: "#e0d0f0" },
  { code: "R58", name: "Deep Lavender", hex: "#7a40b8" },
  { code: "R60", name: "No Color Blue", hex: "#b4d4f0" },
  { code: "R68", name: "Parry Sky Blue", hex: "#3ca0e8" },
  { code: "R80", name: "Primary Blue", hex: "#0050c8" },
  { code: "R83", name: "Medium Blue", hex: "#0038a0" },
  { code: "R90", name: "Dark Yellow Green", hex: "#2e8c1e" },
  { code: "R99", name: "Chocolate", hex: "#a87850" },
];

const BY_CODE = new Map(GELS.map((g) => [g.code, g]));
const WHITE: Rgb = { r: 1, g: 1, b: 1 };

function fromHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

/** The gel a catalogue code names, however it's typed ("r80", "Lee 201", "L 201"). */
export function gelOf(code: string): Gel | undefined {
  const t = code.trim().toUpperCase().replace(/^LEE\s*/, "L").replace(/^ROSCO\s*/, "R").replace(/\s+/g, "");
  return BY_CODE.get(t);
}

/**
 * The colour (each channel 0 to 1) a white beam takes through the Color field's filters: gels joined
 * by + multiply, "#rrggbb" is that colour, and blank, N/C, Open or an unknown name stays white.
 */
export function colorOf(field: string): Rgb {
  let out = WHITE;
  for (const part of field.split("+")) {
    const hex = part.trim().startsWith("#") ? fromHex(part) : null;
    const gel = hex ? null : gelOf(part);
    const c = hex ?? (gel ? fromHex(gel.hex) : null);
    if (c) out = multiply(out, c);
  }
  return out;
}

/** What a surface of colour `paint` looks like lit by `light` (both 0 to 1), each channel multiplied. */
export function multiply(a: Rgb, b: Rgb): Rgb {
  return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b };
}

/** "#rrggbb" for a colour with channels 0 to 1. */
export function hexOf(c: Rgb): string {
  const two = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${two(c.r)}${two(c.g)}${two(c.b)}`;
}
