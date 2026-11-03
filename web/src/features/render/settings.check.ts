// Checks the render settings under Node: settings kept or sent by an older version made whole, and
// the looks. Run from web/:
//   npx tsx src/features/render/settings.check.ts
// Nothing is read or written (no drawing is open, so nothing is kept).

import { DEFAULT_RENDER, LOOKS, completeSettings, lookOf, withLook } from "./settings.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

console.log("completeSettings");
{
  // as an older version kept them: no clay section, effects without the new fields, a material
  const old = {
    environment: { ...DEFAULT_RENDER.environment, groundGloss: undefined, sky: "gradient" },
    effects: { ao: 0.3, bloom: 0.5, vignette: 0, contrast: 0.1, saturation: -0.2 },
    exposure: 1.5,
    materials: { "tex:Oak": { preset: "wood", roughness: 0.4 } },
  };
  const s = completeSettings(old);
  check(s.environment.sky === "gradient" && s.environment.groundGloss === 0, "a section keeps its values and gains the new fields' defaults");
  check(s.effects.ao === 0.3 && s.effects.bloom === 0.5 && s.effects.reflections === DEFAULT_RENDER.effects.reflections, "effects: old values kept, reflections and the rest at their defaults");
  check(s.effects.outlineColor === DEFAULT_RENDER.effects.outlineColor && s.effects.bloomThreshold === 1, "new string and number fields filled");
  check(s.clay.on === false && s.clay.color === DEFAULT_RENDER.clay.color, "a missing section takes its defaults");
  check(s.exposure === 1.5 && s.toneMap === DEFAULT_RENDER.toneMap, "top-level values kept or defaulted");
  check(s.materials["tex:Oak"]?.preset === "wood" && s.materials["tex:Oak"]?.roughness === 0.4, "materials kept whole (they have no defaults)");
  check(s.camera.blurScale === 1, "the lens gains its blur scale");

  const bad = completeSettings({ effects: { bloom: "lots", grain: null }, fog: 3, exposure: "bright" });
  check(bad.effects.bloom === DEFAULT_RENDER.effects.bloom && bad.effects.grain === 0, "a field of the wrong type takes the default");
  check(bad.fog === DEFAULT_RENDER.fog && bad.exposure === 0, "a section or value of the wrong type takes the default");
  check(completeSettings(null) === DEFAULT_RENDER && completeSettings("x") === DEFAULT_RENDER, "nothing usable: the defaults");
}

console.log("looks");
{
  check(lookOf(DEFAULT_RENDER.effects)?.id === "natural", "the defaults are the Natural look");
  check(new Set(LOOKS.map((l) => l.id)).size === LOOKS.length, "every look has its own id");
  for (const look of LOOKS) {
    const fx = withLook({ ...DEFAULT_RENDER.effects, ao: 0.9, outlines: 0.4 }, look);
    check(lookOf(fx)?.id === look.id && fx.ao === 0.9 && fx.outlines === 0.4, `${look.label}: picked, it is recognised, and AO and outlines stay`);
  }
  check(lookOf({ ...DEFAULT_RENDER.effects, contrast: 0.33 }) === null, "a tweaked look is Custom");
  const mono = LOOKS.find((l) => l.id === "mono");
  check(mono?.effects.saturation === -1, "Black and white takes the colour out");
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
