// View > Renderworks Style, as Vectorworks offers its default Renderworks styles: each one a render
// mode (Realistic for the Preview and Fast styles, Path Traced for the Final ones) and the lighting,
// background and quality the Render palette sets, applied at once. Vectorworks doesn't publish its
// library styles' settings, so these are Rodeo's readings of their names: Exterior lights the model
// with the sky and the sun, Interior opens the exposure a stop for rooms the sky reaches through
// windows, Night swaps the sky for a dark one and the sun for the drawing's light objects, Preview
// leaves out the costly effects (ambient occlusion, reflections, glow), Final traces the light with
// the bounces Lighting Options names (Exterior 3, Interior 16) to a cleaner picture, and White
// Model is the clay look in white. A style checks while the mode and every setting it applied are
// unchanged. The materials' finishes, the fog, the lens and the grading are left as they are.

import type { Row } from "../../app/menu.ts";
import type { RenderMode } from "../../app/view3d.ts";
import { DEFAULT_RENDER, renderSettings, setRender, type RenderSettings } from "./settings.ts";

/** What a style sets: whole sections, or some fields of one. */
interface StylePatch {
  readonly environment?: Partial<RenderSettings["environment"]>;
  readonly sun?: Partial<RenderSettings["sun"]>;
  readonly lights?: Partial<RenderSettings["lights"]>;
  readonly exposure?: number;
  readonly effects?: Partial<RenderSettings["effects"]>;
  readonly clay?: Partial<RenderSettings["clay"]>;
  readonly quality?: Partial<RenderSettings["quality"]>;
}

interface RenderStyle {
  readonly label: string;
  readonly mode: Extract<RenderMode, "realistic" | "pathtraced">;
  readonly patch: StylePatch;
}

/** the sky, the sun and the light objects as the defaults have them, the clay look off */
const EXTERIOR: StylePatch = {
  environment: { ...DEFAULT_RENDER.environment },
  sun: { ...DEFAULT_RENDER.sun },
  lights: { on: true, intensity: 1 },
  exposure: 0,
  clay: { on: false },
};
/** a stop brighter, for rooms lit through their windows */
const INTERIOR: StylePatch = { ...EXTERIOR, exposure: 1 };
/** a dark sky, no sun, the light objects up, and a stop brighter so they carry the picture */
const NIGHT: StylePatch = {
  ...EXTERIOR,
  environment: { ...DEFAULT_RENDER.environment, sky: "gradient", zenith: "#05070d", horizon: "#1a2130", ground: "#0b0b0d", intensity: 0.15 },
  sun: { ...DEFAULT_RENDER.sun, on: false },
  lights: { on: true, intensity: 2 },
  exposure: 1,
};
/** Realistic with its costly effects off */
const PREVIEW: StylePatch["effects"] = { ao: 0, reflections: 0, bloom: 0 };
/** Realistic with its effects as the defaults have them */
const FAST: StylePatch["effects"] = { ao: DEFAULT_RENDER.effects.ao, reflections: DEFAULT_RENDER.effects.reflections, bloom: DEFAULT_RENDER.effects.bloom };
/** Fast's, the light objects glowing more */
const NIGHT_GLOW: StylePatch["effects"] = { ...FAST, bloom: 0.35 };
/** Path Traced to `bounces` after the first hit (the tracer counts that hit too), refined further than the default */
const final = (bounces: number): StylePatch["quality"] => ({ bounces: bounces + 1, previewSamples: 1024, denoise: true });

/** Vectorworks' default Renderworks styles, as its menu lists them. */
const STYLES: readonly RenderStyle[] = [
  { label: "Preview Exterior", mode: "realistic", patch: { ...EXTERIOR, effects: PREVIEW } },
  { label: "Preview Interior", mode: "realistic", patch: { ...INTERIOR, effects: PREVIEW } },
  { label: "Realistic Exterior Fast", mode: "realistic", patch: { ...EXTERIOR, effects: FAST } },
  { label: "Realistic Exterior Final", mode: "pathtraced", patch: { ...EXTERIOR, effects: FAST, quality: final(3) } },
  { label: "Realistic Exterior Night Fast", mode: "realistic", patch: { ...NIGHT, effects: NIGHT_GLOW } },
  { label: "Realistic Exterior Night Final", mode: "pathtraced", patch: { ...NIGHT, effects: NIGHT_GLOW, quality: final(3) } },
  { label: "Realistic Interior Fast", mode: "realistic", patch: { ...INTERIOR, effects: FAST } },
  { label: "Realistic Interior Final", mode: "pathtraced", patch: { ...INTERIOR, effects: FAST, quality: final(16) } },
  { label: "Render Style White Model", mode: "realistic", patch: { ...EXTERIOR, effects: FAST, clay: { on: true, color: "#f4f4f2" } } },
];

/** The settings with `patch` applied, section by section. */
function patched(s: RenderSettings, patch: StylePatch): Partial<RenderSettings> {
  const out: { -readonly [K in keyof RenderSettings]?: RenderSettings[K] } = {};
  if (patch.environment) out.environment = { ...s.environment, ...patch.environment };
  if (patch.sun) out.sun = { ...s.sun, ...patch.sun };
  if (patch.lights) out.lights = { ...s.lights, ...patch.lights };
  if (patch.exposure !== undefined) out.exposure = patch.exposure;
  if (patch.effects) out.effects = { ...s.effects, ...patch.effects };
  if (patch.clay) out.clay = { ...s.clay, ...patch.clay };
  if (patch.quality) out.quality = { ...s.quality, ...patch.quality };
  return out;
}

/** True while every field `patch` sets has that value. */
function holds(s: RenderSettings, patch: StylePatch): boolean {
  const same = (section: object | undefined, want: object): boolean =>
    section !== undefined && Object.entries(want).every(([k, v]) => (section as Record<string, unknown>)[k] === v);
  return (
    (!patch.environment || same(s.environment, patch.environment)) &&
    (!patch.sun || same(s.sun, patch.sun)) &&
    (!patch.lights || same(s.lights, patch.lights)) &&
    (patch.exposure === undefined || s.exposure === patch.exposure) &&
    (!patch.effects || same(s.effects, patch.effects)) &&
    (!patch.clay || same(s.clay, patch.clay)) &&
    (!patch.quality || same(s.quality, patch.quality))
  );
}

/** What the rows need of the 3D view: its render mode. */
export interface StyleActions {
  renderMode(): RenderMode;
  setRenderMode(mode: RenderMode): void;
}

/** View > Renderworks Style and the View bar's: a row for each style, the one in effect checked. */
export function renderStyleRows(actions: StyleActions): Row[] {
  return STYLES.map((style) => ({
    label: style.label,
    checked: () => actions.renderMode() === style.mode && holds(renderSettings(), style.patch),
    run: () => {
      setRender(patched(renderSettings(), style.patch));
      actions.setRenderMode(style.mode);
    },
  }));
}
