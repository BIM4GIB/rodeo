// The Render palette's Scene tab: the presets at the top (a picture of each look; one click sets its
// sky, sun, light objects and fog), then the sky, the sun (where the Heliodon puts it, by the date and
// the solar time), the ground plane, the light objects and the fog. Each control shows the setting it
// stands for, and one sync keeps them all in step with the settings and the 3D view. No three.js here.

import { h } from "../../../app/dom.ts";
import { dayLabel, hourLabel } from "../../../app/heliodon.ts";
import { setViz, store } from "../../../app/state.ts";
import { DEFAULT_RENDER, onRender, patchRender, renderSettings, type SkyKind } from "../settings.ts";
import { SCENE_PRESETS, applyScenePreset, presetArt, presetHolds, type ScenePresetId } from "./scenePresets.ts";
import { colour, group, note, number, pct, select, slider, switchBox, tiles, toggle, toPct } from "./ui.ts";
import "./sceneTab.css";

const SKY_OPTIONS: readonly (readonly [SkyKind, string])[] = [
  ["physical", "Physical sky"],
  ["gradient", "Gradient"],
  ["color", "Solid colour"],
  ["studio", "Studio"],
];

/** Greys a colour or number row out while `off`: its box takes no input and its label fades. */
function greyOut(row: { readonly el: HTMLElement; readonly input: HTMLInputElement }, off: boolean): void {
  row.input.disabled = off;
  row.el.classList.toggle("is-disabled", off);
}

/** The Scene tab (the Render palette's, and Render Studio's). */
export function sceneTab(): HTMLElement {
  // presets: a tile each, the one whose settings still hold chosen
  const presets = tiles<ScenePresetId>(
    "Presets",
    SCENE_PRESETS.map((p) => ({ id: p.id, label: p.label, art: h("span", { cls: "rs-scene-art", html: presetArt(p) }) })),
    (id) => {
      const p = SCENE_PRESETS.find((x) => x.id === id);
      if (p) applyScenePreset(p);
    },
  );
  const presetGroup = group("Presets", { key: "scene.presets" }, presets.el);

  // sky: the physical sky's haze, the gradient's colours, the solid colour, the intensity
  const sky = select("Sky", SKY_OPTIONS, (k) => patchRender("environment", { sky: k }));
  const haze = slider("Haze", {
    min: 2,
    max: 10,
    step: 0.1,
    format: (v) => v.toFixed(1),
    onInput: (n) => patchRender("environment", { turbidity: n }),
    reset: DEFAULT_RENDER.environment.turbidity,
  });
  const zenith = colour("Zenith", (c) => patchRender("environment", { zenith: c }));
  const horizon = colour("Horizon", (c) => patchRender("environment", { horizon: c }));
  const groundSky = colour("Ground colour", (c) => patchRender("environment", { ground: c }));
  const solid = colour("Colour", (c) => patchRender("environment", { zenith: c }));
  const skyStrength = slider("Intensity", {
    min: 0,
    max: 300,
    step: 1,
    format: pct,
    onInput: (n) => patchRender("environment", { intensity: n / 100 }),
    reset: toPct(DEFAULT_RENDER.environment.intensity),
  });
  const behind = toggle("Show the sky behind the model", (on) => patchRender("environment", { visible: on }));
  behind.el.classList.add("rs-scene-wide");
  const skyGroup = group("Sky", { key: "scene.sky" }, sky.el, haze.el, zenith.el, horizon.el, groundSky.el, solid.el, skyStrength.el, behind.el);

  // sun: its switch in the title's row, the Heliodon's date and solar time, then the sun's strength and softness
  const sunOn = switchBox("Sunlight", (on) => patchRender("sun", { on }));
  const day = slider("Date", {
    min: 1,
    max: 365,
    step: 1,
    format: dayLabel,
    onInput: (n) => setViz({ dayOfYear: n }),
    reset: 172,
  });
  const solarTime = slider("Solar time", {
    min: 0,
    max: 24,
    step: 0.25,
    format: hourLabel,
    onInput: (n) => setViz({ hour: n }),
    reset: 12,
  });
  const sunStrength = slider("Intensity", {
    min: 0,
    max: 300,
    step: 1,
    format: pct,
    onInput: (n) => patchRender("sun", { intensity: n / 100 }),
    reset: toPct(DEFAULT_RENDER.sun.intensity),
  });
  const sunSoft = slider("Softness", {
    min: 0,
    max: 100,
    step: 1,
    format: pct,
    onInput: (n) => patchRender("sun", { softness: n / 100 }),
    reset: toPct(DEFAULT_RENDER.sun.softness),
  });
  const sunGroup = group(
    "Sun",
    { key: "scene.sun", aside: sunOn.el },
    day.el,
    solarTime.el,
    sunStrength.el,
    sunSoft.el,
    note("The sun stands where the Heliodon places it (Visualization palette)."),
  );

  // ground: the plane under a model that stands on level ground, its colour and its gloss
  const plane = switchBox("Ground plane", (on) => patchRender("environment", { groundPlane: on }));
  plane.box.title = "A plane under a model that stands on level ground; a sloping site model is its own ground";
  const planeColour = colour("Plane colour", (c) => patchRender("environment", { groundColor: c }));
  const gloss = slider("Gloss", {
    min: 0,
    max: 100,
    step: 1,
    format: pct,
    onInput: (n) => patchRender("environment", { groundGloss: n / 100 }),
    reset: toPct(DEFAULT_RENDER.environment.groundGloss),
    hint: "Matte to a mirror: a polished floor or a wet street",
  });
  const groundGroup = group("Ground", { key: "scene.ground", aside: plane.el }, planeColour.el, gloss.el);

  // light objects: on or off, their strength, and the haze that shows their spots as beams
  const lightsOn = switchBox("Light objects", (on) => patchRender("lights", { on }));
  const lampStrength = slider("Intensity", {
    min: 0,
    max: 500,
    step: 1,
    format: pct,
    onInput: (n) => patchRender("lights", { intensity: n / 100 }),
    reset: toPct(DEFAULT_RENDER.lights.intensity),
  });
  const lampHaze = slider("Haze", {
    min: 0,
    max: 100,
    step: 1,
    format: pct,
    onInput: (n) => patchRender("lights", { haze: n / 100 }),
    reset: toPct(DEFAULT_RENDER.lights.haze),
    hint: "Haze in the air: the spots show as beams (Realistic)",
  });
  const lightsGroup = group("Lights", { key: "scene.lights", aside: lightsOn.el }, lampStrength.el, lampHaze.el);

  // fog: folded at first, its switch in the title's row
  const fogOn = switchBox("Fog", (on) => patchRender("fog", { on }));
  const fogColour = colour("Colour", (c) => patchRender("fog", { color: c }));
  const visibility = number("Visibility (m)", "", 5, 20000, (n) => patchRender("fog", { distance: n }));
  const fogHeight = number("Height (m)", "", 0, 500, (n) => patchRender("fog", { height: n }));
  const fogBase = number("Base (m)", "", 0, 1000, (n) => patchRender("fog", { base: n }));
  const glow = slider("Glow", {
    min: 0,
    max: 100,
    step: 1,
    format: pct,
    onInput: (n) => patchRender("fog", { glow: n / 100 }),
    reset: toPct(DEFAULT_RENDER.fog.glow),
  });
  const fogGroup = group(
    "Fog",
    { key: "scene.fog", folded: true, aside: fogOn.el },
    fogColour.el,
    visibility.el,
    fogHeight.el,
    fogBase.el,
    glow.el,
    note("Height 0: the same fog at every height. Base: metres above the lowest point, where fog is thickest."),
  );

  // keeps every control in step with the settings and the 3D view
  const sync = (): void => {
    const s = renderSettings();
    const vz = store.viz3d;

    presets.set(SCENE_PRESETS.find((p) => presetHolds(p, s, vz))?.id ?? null);

    const e = s.environment;
    sky.set(e.sky);
    haze.el.hidden = e.sky !== "physical";
    haze.set(e.turbidity);
    for (const row of [zenith, horizon, groundSky]) row.el.hidden = e.sky !== "gradient";
    solid.el.hidden = e.sky !== "color";
    zenith.set(e.zenith);
    solid.set(e.zenith);
    horizon.set(e.horizon);
    groundSky.set(e.ground);
    skyStrength.set(toPct(e.intensity));
    behind.set(e.visible);

    // the date and the time stay live with the sun off: they also set the physical sky's light
    const sn = s.sun;
    sunOn.set(sn.on);
    day.set(vz.dayOfYear);
    solarTime.set(vz.hour);
    sunStrength.set(toPct(sn.intensity));
    sunSoft.set(toPct(sn.softness));
    sunStrength.setDisabled(!sn.on);
    sunSoft.setDisabled(!sn.on);

    plane.set(e.groundPlane);
    planeColour.set(e.groundColor);
    greyOut(planeColour, !e.groundPlane);
    gloss.set(toPct(e.groundGloss));
    gloss.setDisabled(!e.groundPlane);

    lightsOn.set(s.lights.on);
    lampStrength.set(toPct(s.lights.intensity));
    lampHaze.set(toPct(s.lights.haze));
    lampStrength.setDisabled(!s.lights.on);
    lampHaze.setDisabled(!s.lights.on);

    const f = s.fog;
    fogOn.set(f.on);
    fogColour.set(f.color);
    visibility.set(f.distance);
    fogHeight.set(f.height);
    fogBase.set(f.base);
    glow.set(toPct(f.glow));
    for (const row of [fogColour, visibility, fogHeight, fogBase]) greyOut(row, !f.on);
    glow.setDisabled(!f.on);
  };
  onRender(sync);
  store.on(["viz3d", "session"], sync);
  sync();

  return h("div", { cls: "rs-scene-tab" }, presetGroup.el, skyGroup.el, sunGroup.el, groundGroup.el, lightsGroup.el, fogGroup.el);
}
