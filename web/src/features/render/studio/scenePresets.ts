// Render Studio's scene presets, the Scene tab's picture tiles: one click sets the sky, the sun, the
// light objects and the fog of a look, as D5's and Twinmotion's sky presets do. A preset is data: the
// settings it sets (the ground plane and the glow only where a preset needs them), where the sun
// stands (a target altitude on the morning or afternoon side of noon, turned into the solar hour for
// the drawing's date and latitude), the 3D view's sun, and its picture, an inline SVG drawn from its
// colours. A tile shows as chosen while the settings still hold what the preset set (the solar hour
// aside). No three.js here: this loads with the editor.

import { sunPlace, type Viz3D } from "../../../app/heliodon.ts";
import { setViz, store } from "../../../app/state.ts";
import { renderSettings, setRender, type RenderSettings } from "../settings.ts";

export type ScenePresetId = "clear" | "morning" | "golden" | "overcast" | "dusk" | "night" | "studio" | "foggy";

/** Where a preset's sun stands: `altitude` degrees above the horizon (below it when negative), on the morning or the afternoon side of noon. */
export interface SunTarget {
  readonly altitude: number;
  readonly side: "morning" | "afternoon";
}

/** What a preset's picture shows: its colours, and what is in it. */
interface Picture {
  /** the sky's top and its colour at the horizon */
  readonly sky: readonly [string, string];
  readonly ground: string;
  /** a plain seamless backdrop (top, bottom) in place of the sky and the ground */
  readonly backdrop?: readonly [string, string];
  /** clouds in place of the sun */
  readonly clouds?: boolean;
  readonly moon?: boolean;
  /** the house's colour, its windows lit when `lit` */
  readonly house?: { readonly wall: string; readonly lit: boolean };
  /** a band of fog over the horizon, in this colour */
  readonly fog?: string;
}

export interface ScenePreset {
  readonly id: ScenePresetId;
  readonly label: string;
  /** the sky fields it sets (the ground plane's only where a preset needs one) */
  readonly environment: Partial<RenderSettings["environment"]>;
  readonly sun: Partial<RenderSettings["sun"]>;
  readonly lights: Partial<RenderSettings["lights"]>;
  readonly exposure: number;
  readonly fog: Partial<RenderSettings["fog"]>;
  /** the glow, for the presets that set it (the others keep the Look's) */
  readonly bloom?: number;
  /** where the sun stands, or null to keep the solar time */
  readonly sunTarget: SunTarget | null;
  /** the 3D view's sun: the Heliodon's, or none for a night stage */
  readonly viewSun: Viz3D["sun"];
  readonly picture: Picture;
}

const NO_FOG: Partial<RenderSettings["fog"]> = { on: false };

/** The presets, in the order their tiles show: three to a row. */
export const SCENE_PRESETS: readonly ScenePreset[] = [
  {
    id: "clear",
    label: "Clear day",
    environment: { sky: "physical", turbidity: 2.5, visible: true },
    sun: { on: true, intensity: 1, softness: 0.3 },
    lights: { on: true, intensity: 1 },
    exposure: 0,
    fog: NO_FOG,
    sunTarget: { altitude: 58, side: "afternoon" },
    viewSun: "heliodon",
    picture: { sky: ["#3f78c9", "#cfe2f5"], ground: "#6f6a5e", house: { wall: "#3d424b", lit: false } },
  },
  {
    id: "morning",
    label: "Morning",
    environment: { sky: "physical", turbidity: 4, visible: true },
    sun: { on: true, intensity: 0.9, softness: 0.4 },
    lights: { on: true, intensity: 1 },
    exposure: 0,
    fog: NO_FOG,
    sunTarget: { altitude: 14, side: "morning" },
    viewSun: "heliodon",
    picture: { sky: ["#7f9fd0", "#f6d4a8"], ground: "#6c6558", house: { wall: "#3d424b", lit: false } },
  },
  {
    id: "golden",
    label: "Golden hour",
    environment: { sky: "physical", turbidity: 3, visible: true },
    sun: { on: true, intensity: 1.1, softness: 0.2 },
    lights: { on: true, intensity: 1 },
    exposure: 0.3,
    fog: NO_FOG,
    sunTarget: { altitude: 7, side: "afternoon" },
    viewSun: "heliodon",
    picture: { sky: ["#4d6fa8", "#f7a85a"], ground: "#5f5448", house: { wall: "#3d424b", lit: false } },
  },
  {
    id: "overcast",
    label: "Overcast",
    environment: { sky: "gradient", zenith: "#8e99a6", horizon: "#dfe4ea", ground: "#6e706f", intensity: 1.1, visible: true },
    sun: { on: true, intensity: 0.15, softness: 1 },
    lights: { on: true, intensity: 1 },
    exposure: 0.2,
    fog: NO_FOG,
    sunTarget: { altitude: 40, side: "afternoon" },
    viewSun: "heliodon",
    picture: { sky: ["#8e99a6", "#dfe4ea"], ground: "#6e706f", clouds: true, house: { wall: "#3d424b", lit: false } },
  },
  {
    id: "dusk",
    label: "Dusk",
    environment: { sky: "gradient", zenith: "#1c2b52", horizon: "#f08a4b", ground: "#2b2a33", intensity: 0.8, visible: true },
    sun: { on: false },
    lights: { on: true, intensity: 1.5 },
    exposure: 0.5,
    fog: NO_FOG,
    bloom: 0.3,
    sunTarget: { altitude: -3, side: "afternoon" },
    viewSun: "heliodon",
    picture: { sky: ["#1c2b52", "#f08a4b"], ground: "#2b2a33", house: { wall: "#15161c", lit: true } },
  },
  {
    id: "night",
    label: "Night",
    environment: { sky: "gradient", zenith: "#0b1224", horizon: "#1f2a44", ground: "#15151a", intensity: 1, visible: true },
    sun: { on: false },
    lights: { on: true, intensity: 2 },
    exposure: 1,
    fog: NO_FOG,
    bloom: 0.35,
    sunTarget: null,
    viewSun: "off",
    picture: { sky: ["#0b1224", "#1f2a44"], ground: "#15151a", moon: true, house: { wall: "#07080b", lit: true } },
  },
  {
    id: "studio",
    label: "Studio",
    environment: { sky: "studio", visible: true, groundPlane: true, groundGloss: 0.2 },
    sun: { on: true, intensity: 0.6, softness: 0.8 },
    lights: { on: true, intensity: 1 },
    exposure: 0,
    fog: NO_FOG,
    sunTarget: { altitude: 50, side: "afternoon" },
    viewSun: "heliodon",
    picture: { sky: ["#f4f5f7", "#c8cdd4"], ground: "#c8cdd4", backdrop: ["#f4f5f7", "#c8cdd4"] },
  },
  {
    id: "foggy",
    label: "Foggy",
    environment: { sky: "physical", turbidity: 8, visible: true },
    sun: { on: true, intensity: 0.7, softness: 0.6 },
    lights: { on: true, intensity: 1 },
    exposure: 0.2,
    fog: { on: true, color: "#cfd6dd", distance: 150, glow: 0.6 },
    sunTarget: { altitude: 10, side: "morning" },
    viewSun: "heliodon",
    picture: { sky: ["#9aa6b2", "#d7dde3"], ground: "#7a7d80", fog: "#dfe5ea", house: { wall: "#3d424b", lit: false } },
  },
];

/** The solar hour (quarter hours, as the Heliodon's slider runs) on `target`'s side of noon whose sun stands nearest its altitude, for the drawing's date and latitude. */
export function solarHourFor(target: SunTarget, viz: Pick<Viz3D, "latitude" | "dayOfYear" | "north">): number {
  const [from, to] = target.side === "morning" ? [0, 12] : [12, 23.75];
  let best = from;
  let gap = Infinity;
  for (let hour = from; hour <= to; hour += 0.25) {
    const off = Math.abs(sunPlace({ ...viz, hour }).altitude - target.altitude);
    if (off < gap) {
      gap = off;
      best = hour;
    }
  }
  return best;
}

/** Sets the preset's sky, sun, light objects, fog and glow, and places the sun for the drawing's date and latitude. */
export function applyScenePreset(p: ScenePreset): void {
  const viz = store.viz3d;
  setViz(p.sunTarget ? { sun: p.viewSun, hour: solarHourFor(p.sunTarget, viz) } : { sun: p.viewSun });
  const s = renderSettings();
  setRender({
    environment: { ...s.environment, ...p.environment },
    sun: { ...s.sun, ...p.sun },
    lights: { ...s.lights, ...p.lights },
    exposure: p.exposure,
    fog: { ...s.fog, ...p.fog },
    effects: p.bloom === undefined ? s.effects : { ...s.effects, bloom: p.bloom },
  });
}

/** Whether the settings still hold what `p` set (the solar hour aside): its tile shows as chosen while they do. */
export function presetHolds(p: ScenePreset, s: RenderSettings, viz: Pick<Viz3D, "sun">): boolean {
  return (
    fieldsHold(s.environment, p.environment) &&
    fieldsHold(s.sun, p.sun) &&
    fieldsHold(s.lights, p.lights) &&
    fieldsHold(s.fog, p.fog) &&
    s.exposure === p.exposure &&
    (p.bloom === undefined || s.effects.bloom === p.bloom) &&
    viz.sun === p.viewSun
  );
}

function fieldsHold<T extends object>(have: T, want: Partial<T>): boolean {
  return (Object.keys(want) as (keyof T)[]).every((k) => have[k] === want[k]);
}

// ---- the pictures ----------------------------------------------------------------

const GROUND_Y = 70;

/** The preset's picture: a 160 by 100 SVG (its sky, sun or moon, ground, house and fog), for its tile. */
export function presetArt(p: ScenePreset): string {
  const pic = p.picture;
  const id = `rs-scene-${p.id}`;
  if (pic.backdrop) {
    const defs = `<linearGradient id="${id}-bd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pic.backdrop[0]}"/><stop offset="1" stop-color="${pic.backdrop[1]}"/></linearGradient>`;
    return svgOf(defs, `<rect width="160" height="100" fill="url(#${id}-bd)"/>`);
  }
  const defs: string[] = [
    `<linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pic.sky[0]}"/><stop offset="1" stop-color="${pic.sky[1]}"/></linearGradient>`,
  ];
  const parts: string[] = [`<rect width="160" height="${GROUND_Y}" fill="url(#${id}-sky)"/>`];
  if (pic.moon) {
    parts.push(
      `<circle cx="22" cy="14" r=".6" fill="#dfe6f5"/><circle cx="58" cy="26" r=".5" fill="#dfe6f5"/><circle cx="132" cy="10" r=".6" fill="#dfe6f5"/><circle cx="150" cy="32" r=".5" fill="#dfe6f5"/>`,
      `<circle cx="46" cy="22" r="6" fill="#e9edf5"/><circle cx="48.4" cy="20" r="5.3" fill="${pic.sky[0]}"/>`,
    );
  }
  if (pic.clouds) {
    parts.push(`<ellipse cx="34" cy="22" rx="24" ry="7" fill="#f4f6f8" opacity=".85"/><ellipse cx="98" cy="30" rx="30" ry="8" fill="#eef1f4" opacity=".85"/><ellipse cx="136" cy="16" rx="18" ry="6" fill="#f4f6f8" opacity=".8"/>`);
  }
  // the sun stands behind the ground, so one low on the horizon is half set
  if (p.sunTarget && p.sunTarget.altitude > 0 && !pic.clouds) {
    const x = p.sunTarget.side === "morning" ? 44 : 116;
    const y = GROUND_Y - 2 - p.sunTarget.altitude * 0.5;
    const disc = p.sunTarget.altitude < 12 ? "#ffb46b" : "#fff4d8";
    parts.push(`<circle cx="${x}" cy="${y}" r="12" fill="${disc}" opacity=".28"/><circle cx="${x}" cy="${y}" r="5" fill="${disc}"/>`);
  }
  parts.push(`<rect y="${GROUND_Y}" width="160" height="${100 - GROUND_Y}" fill="${pic.ground}"/>`);
  if (pic.house) {
    const wall = pic.house.wall;
    parts.push(`<rect x="98" y="54" width="34" height="16" fill="${wall}"/><path d="M95 55 L115 39 L135 55 Z" fill="${wall}"/>`);
    if (pic.house.lit) parts.push(`<rect x="103" y="59" width="5" height="5" fill="#ffd27a"/><rect x="121" y="59" width="5" height="5" fill="#ffd27a"/>`);
  }
  if (pic.fog) {
    defs.push(
      `<linearGradient id="${id}-fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pic.fog}" stop-opacity="0"/><stop offset=".5" stop-color="${pic.fog}" stop-opacity=".9"/><stop offset="1" stop-color="${pic.fog}" stop-opacity=".95"/></linearGradient>`,
    );
    parts.push(`<rect y="44" width="160" height="56" fill="url(#${id}-fog)"/>`);
  }
  return svgOf(defs.join(""), parts.join(""));
}

function svgOf(defs: string, body: string): string {
  return `<svg viewBox="0 0 160 100" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false"><defs>${defs}</defs>${body}</svg>`;
}
