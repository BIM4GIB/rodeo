// How the 3D view is looked at and lit (the Visualization palette): the projection, the sun
// (following the view as a headlight, or placed by a Heliodon from the latitude, the date and the
// solar time, core/sun.ts), shadows, ambient light and the clip cube; and how its render modes draw
// (View > Rendering's Shaded Options and Line Render Options).

export { dayOfYear, equationOfTime, MONTHS, sunPlace, type SunPlace } from "../core/sun.ts";

export type Projection = "perspective" | "orthogonal";

/** A range along one axis of the model's box, as fractions from its low end (0) to its high end (1). */
export type ClipRange = readonly [number, number];

/** the sun's and light objects' shadow maps: a quarter, a half, the usual size (4096 px for the sun) or twice it */
export type ShadowQuality = "low" | "medium" | "high" | "veryHigh";

/** View > Rendering > Shaded Options: how Shaded (and Textured) draw. */
export interface ShadedOptions {
  /** Shaded draws the objects' textures, as Textured does */
  readonly textures: boolean;
  /** off, faces are drawn white (and untextured) */
  readonly colors: boolean;
  /** shadows fall only on the ground under the model, not on the objects */
  readonly groundOnly: boolean;
  /** the objects' edges outline their faces */
  readonly edges: boolean;
  readonly shadowQuality: ShadowQuality;
}

/** View > Rendering > Line Render Options: how Dashed Hidden Line draws the hidden edges. */
export interface LineRenderOptions {
  /** a dash style ("line type") of the document by its style number (negative), or 0 for the view's own dashes */
  readonly dashStyle: number;
  /** the hidden edges' shade: 0 the edges' own dark grey, 1 white */
  readonly dashShade: number;
}

/**
 * An oblique projection: the view drawn orthogonally, then what lies further back than the orbit
 * point slid up and to the right along `angle` degrees from the horizontal, by `depth` of its depth
 * (cavalier 1, cabinet a half).
 */
export interface Oblique {
  readonly angle: number;
  readonly depth: number;
}

export interface Viz3D {
  readonly projection: Projection;
  /** the perspective's view angle, degrees from the picture's top to its bottom (View > Projection) */
  readonly lens: number;
  /** an orthogonal view drawn obliquely, or null */
  readonly oblique: Oblique | null;
  /** a perspective kept level, so upright lines stay upright (Two-Point Perspective) */
  readonly twoPoint: boolean;
  /**
   * "view": a headlight from the camera; "heliodon": the sun for the place, date and time below; "off":
   * no sun, only the ambient light and the light objects (a stage at night), which then show brighter
   */
  readonly sun: "view" | "heliodon" | "off";
  /** degrees north (negative south) */
  readonly latitude: number;
  /** 1 (1 January) to 365 */
  readonly dayOfYear: number;
  /** solar time in hours, 12 at noon */
  readonly hour: number;
  /** the drawing's north, degrees counter-clockwise from its +y axis */
  readonly north: number;
  readonly shadows: boolean;
  /** ambient light as a fraction of the usual (1) */
  readonly ambient: number;
  /** the drawing's light objects light the model */
  readonly lights: boolean;
  /** haze in the air, 0 none .. 1 thick: the light objects' spots show as beams in it (beams.ts) */
  readonly haze: number;
  readonly clip: { readonly on: boolean; readonly x: ClipRange; readonly y: ClipRange; readonly z: ClipRange };
  readonly shaded: ShadedOptions;
  readonly lineRender: LineRenderOptions;
}

/** light objects the 3D view lights the model with at most (each one is worked into every face's shading) */
export const MAX_LAMPS = 16;

export const DEFAULT_VIZ: Viz3D = {
  projection: "perspective",
  lens: 35,
  oblique: null,
  twoPoint: false,
  sun: "view",
  latitude: 51.5,
  dayOfYear: 172,
  hour: 15,
  north: 0,
  shadows: false,
  ambient: 1,
  lights: true,
  haze: 0,
  clip: { on: false, x: [0, 1], y: [0, 1], z: [0, 1] },
  shaded: { textures: false, colors: true, groundOnly: false, edges: true, shadowQuality: "high" },
  // dashes drawn at 55 % over the white faces that hide them
  lineRender: { dashStyle: 0, dashShade: 0.45 },
};

/** "21 Jun" for a day of the year (a year of 365 days). */
export function dayLabel(day: number): string {
  const d = new Date(Date.UTC(2025, 0, day));
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

/** "15:30" for a solar time in hours. */
export function hourLabel(hour: number): string {
  const m = Math.round(hour * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Hours from "9:30" (0:00 to 23:59), null when it isn't a time. */
export function readHour(text: string): number | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*$/.exec(text);
  if (!m || +m[1] > 23 || +(m[2] ?? 0) > 59) return null;
  return +m[1] + +(m[2] ?? 0) / 60;
}
