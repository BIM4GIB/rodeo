// The Look tab of the Render palette and Render Studio: the looks as picture tiles (a click applies
// a look's grading and lens effects; lookArt.ts draws them), then light (exposure, tone), colour
// (temperature, tint, contrast, highlights, shadows, saturation), effects (ambient occlusion,
// reflections, bloom), lens effects (vignette, fringing, grain, sharpen, folded until wanted) and
// style (the clay model, ink outlines). A double-click on a slider's label puts its default back.
// The AI card's rules sit in lookTab.css too. No three.js here.

import { h } from "../../../app/dom.ts";
import { DEFAULT_RENDER, LOOKS, lookOf, onRender, patchRender, renderSettings, setRender, withLook, type RenderSettings, type ToneMap } from "../settings.ts";
import { lookArt } from "./lookArt.ts";
import "./lookTab.css";
import { colour, evText, group, note, pct, select, signedPct, slider, tiles, toggle, toPct, type SliderRow } from "./ui.ts";

type Effects = RenderSettings["effects"];

const TONE_OPTIONS: readonly (readonly [ToneMap, string])[] = [
  ["agx", "AgX"],
  ["aces", "ACES Filmic"],
  ["neutral", "Neutral"],
];

/** An effect as a slider in display units (a percent of its value; -100..100 when `signed`), back to `def` on a double-click. */
function effect(label: string, put: (v: number) => Partial<Effects>, def: number, signed = false): SliderRow {
  return slider(label, {
    min: signed ? -100 : 0,
    max: 100,
    step: 1,
    format: signed ? signedPct : pct,
    reset: toPct(def),
    onInput: (n) => patchRender("effects", put(n / 100)),
  });
}

/** The Look tab's body: the looks, then the sliders under them, kept in step with the settings. */
export function lookTab(): HTMLElement {
  const d = DEFAULT_RENDER;

  // the looks: a click applies one (its grading and lens effects; the rest of the effects stay)
  const looks = tiles(
    "Looks",
    LOOKS.map((l) => ({ id: l.id, label: l.label, art: lookArt(l) })),
    (id) => {
      const picked = LOOKS.find((l) => l.id === id);
      if (picked) setRender({ effects: withLook(renderSettings().effects, picked) });
    },
    4,
  );
  looks.el.classList.add("rs-look-tiles");
  const custom = note("Custom: the sliders below differ from every look.");
  const looksGroup = group("Looks", { key: "look.looks" }, looks.el, custom);

  // light
  const exposure = slider("Exposure", { min: -4, max: 8, step: 0.1, format: evText, reset: d.exposure, onInput: (n) => setRender({ exposure: n }) });
  const tone = select<ToneMap>("Tone", TONE_OPTIONS, (t) => setRender({ toneMap: t }));
  const lightGroup = group("Exposure and tone", { key: "look.light" }, exposure.el, tone.el);

  // colour
  const temperature = effect("Temperature", (v) => ({ temperature: v }), d.effects.temperature, true);
  const tint = effect("Tint", (v) => ({ tint: v }), d.effects.tint, true);
  const contrast = effect("Contrast", (v) => ({ contrast: v }), d.effects.contrast, true);
  const highlights = effect("Highlights", (v) => ({ highlights: v }), d.effects.highlights, true);
  const shadows = effect("Shadows", (v) => ({ shadows: v }), d.effects.shadows, true);
  const saturation = effect("Saturation", (v) => ({ saturation: v }), d.effects.saturation, true);
  const colourGroup = group("Colour", { key: "look.colour" }, temperature.el, tint.el, contrast.el, highlights.el, shadows.el, saturation.el);

  // effects: what Realistic adds to its light (the path tracer finds the shading and reflections itself)
  const ao = effect("Ambient occlusion", (v) => ({ ao: v }), d.effects.ao);
  const reflections = effect("Reflections", (v) => ({ reflections: v }), d.effects.reflections);
  const reflectionsNote = note("Shiny faces mirror the model in Realistic; Path Traced finds both itself.");
  const bloom = effect("Bloom", (v) => ({ bloom: v }), d.effects.bloom);
  const threshold = slider("Threshold", {
    min: 0,
    max: 400,
    step: 5,
    format: (v) => (v / 100).toFixed(2),
    reset: toPct(d.effects.bloomThreshold),
    onInput: (n) => patchRender("effects", { bloomThreshold: n / 100 }),
  });
  const bloomSize = effect("Size", (v) => ({ bloomSize: v }), d.effects.bloomSize);
  const effectsGroup = group("Effects", { key: "look.effects" }, ao.el, reflections.el, reflectionsNote, bloom.el, threshold.el, bloomSize.el);

  // lens effects: folded until wanted
  const vignette = effect("Vignette", (v) => ({ vignette: v }), d.effects.vignette);
  const fringing = effect("Fringing", (v) => ({ aberration: v }), d.effects.aberration);
  const grain = effect("Grain", (v) => ({ grain: v }), d.effects.grain);
  const sharpen = effect("Sharpen", (v) => ({ sharpen: v }), d.effects.sharpen);
  const lensGroup = group("Lens effects", { key: "look.lens", folded: true }, vignette.el, fringing.el, grain.el, sharpen.el);

  // style: the clay model and ink outlines
  const clay = toggle("Clay model", (on) => patchRender("clay", { on }), "Every face in one matte colour; glass stays clear");
  const clayColour = colour("Clay colour", (css) => patchRender("clay", { color: css }));
  const outlines = effect("Outlines", (v) => ({ outlines: v }), d.effects.outlines);
  const outlineColour = colour("Line colour", (css) => patchRender("effects", { outlineColor: css }));
  const styleGroup = group("Style", { key: "look.style" }, clay.el, clayColour.el, outlines.el, outlineColour.el);

  // keeps every control in step with the settings
  const sync = (): void => {
    const s = renderSettings();
    const ef = s.effects;
    const chosen = lookOf(ef);
    looks.set(chosen?.id ?? null);
    custom.hidden = chosen !== null;

    exposure.set(s.exposure);
    tone.set(s.toneMap);

    temperature.set(toPct(ef.temperature));
    tint.set(toPct(ef.tint));
    contrast.set(toPct(ef.contrast));
    highlights.set(toPct(ef.highlights));
    shadows.set(toPct(ef.shadows));
    saturation.set(toPct(ef.saturation));

    ao.set(toPct(ef.ao));
    reflections.set(toPct(ef.reflections));
    bloom.set(toPct(ef.bloom));
    threshold.el.hidden = ef.bloom <= 0;
    threshold.set(toPct(ef.bloomThreshold));
    bloomSize.el.hidden = ef.bloom <= 0;
    bloomSize.set(toPct(ef.bloomSize));

    vignette.set(toPct(ef.vignette));
    fringing.set(toPct(ef.aberration));
    grain.set(toPct(ef.grain));
    sharpen.set(toPct(ef.sharpen));

    clay.set(s.clay.on);
    clayColour.el.hidden = !s.clay.on;
    clayColour.set(s.clay.color);
    outlines.set(toPct(ef.outlines));
    outlineColour.el.hidden = ef.outlines <= 0;
    outlineColour.set(ef.outlineColor);
  };
  onRender(sync);
  sync();

  return h("div", { cls: "rs-look" }, looksGroup.el, lightGroup.el, colourGroup.el, effectsGroup.el, lensGroup.el, styleGroup.el);
}
