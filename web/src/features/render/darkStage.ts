// Dark Stage (Stage > Lighting): the 3D view and the renders lit as a stage at night, so the drawing's
// lights show. Light objects are weighed against the sun (a fixture 6 m away gives about 3 % of it), so
// in daylight they hardly show. Dark Stage puts the sun out in both, darkens the sky, keeps a little
// ambient light for the set, opens the renders' exposure by five stops, as the 3D view brightens its
// lamps with the sun off (view3d.ts NIGHT_LAMP_GAIN), and fills the air with haze so the spots show as
// beams. Turning it off puts back what was there before.

import { setViz, store } from "../../app/state.ts";
import type { Viz3D } from "../../app/heliodon.ts";
import { DEFAULT_RENDER, renderSettings, setRender, type RenderSettings } from "./settings.ts";

/** stops the renders' exposure opens by: 2^5 = 32, the 3D view's night gain */
const EXPOSURE = 5;
/** what's left of the 3D view's ambient light */
const AMBIENT = 0.12;
/** the night sky, all round: a blue-black that, at five stops up, lifts the set just out of black */
const SKY = "#020204";
/** the sky's light on the set: the colour alone sets it, so the backdrop stays as dark */
const SKY_LIGHT = 1;
/** the beams' haze, in the 3D view and the renders */
const HAZE = 0.5;
const FLOOR = "#2a2a2a";
const BLOOM = 0.35;

type Before = { viz: Pick<Viz3D, "sun" | "ambient" | "lights" | "haze">; render: Pick<RenderSettings, "sun" | "environment" | "lights" | "exposure" | "effects"> };
let before: Before | null = null;

/** Whether the 3D view and the renders are lit as Dark Stage lights them. */
export function darkStageOn(): boolean {
  const r = renderSettings();
  return store.viz3d.sun === "off" && !r.sun.on && r.exposure >= EXPOSURE - 1e-6;
}

/** Lights the 3D view and the renders as a stage at night, or puts back how they were lit before. */
export function setDarkStage(on: boolean): void {
  if (on === darkStageOn()) return;
  const r = renderSettings();
  if (on) {
    const v = store.viz3d;
    before = { viz: { sun: v.sun, ambient: v.ambient, lights: v.lights, haze: v.haze }, render: { sun: r.sun, environment: r.environment, lights: r.lights, exposure: r.exposure, effects: r.effects } };
    setViz({ sun: "off", ambient: AMBIENT, lights: true, haze: Math.max(v.haze, HAZE) });
    setRender({
      sun: { ...r.sun, on: false },
      environment: { ...r.environment, sky: "color", zenith: SKY, horizon: SKY, ground: SKY, intensity: SKY_LIGHT, visible: true, groundColor: FLOOR, groundGloss: Math.max(r.environment.groundGloss, 0.25) },
      lights: { on: true, intensity: Math.max(r.lights.intensity, 1), haze: Math.max(r.lights.haze, HAZE) },
      exposure: EXPOSURE,
      effects: { ...r.effects, bloom: Math.max(r.effects.bloom, BLOOM) },
    });
    return;
  }
  const was = before ?? {
    viz: { sun: "view" as const, ambient: 1, lights: store.viz3d.lights, haze: 0 },
    render: { sun: DEFAULT_RENDER.sun, environment: DEFAULT_RENDER.environment, lights: r.lights, exposure: DEFAULT_RENDER.exposure, effects: r.effects },
  };
  before = null;
  setViz(was.viz);
  setRender(was.render);
}
