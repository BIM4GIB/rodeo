// Checks the material finishes under Node: the presets, the guess of a face's preset, the material
// a face is drawn with, and that an edit updates it in place. Run from web/:
//   npx tsx src/features/render/materials.check.ts
// Faces are built by hand (no drawing, no textures decoded) and nothing is written.

import * as THREE from "three";
import type { ModelFace } from "../../app/view3d.ts";
import type { ResourceInfo } from "../../core/index.ts";
import { PRESET_LABELS, type MaterialOverride, type MaterialPresetId } from "./settings.ts";
import { PRESETS, guessPreset, makeMaterial, presetFor, updateMaterial, type PresetId } from "./materials.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

/** A face as view3d.ts merges it; `name` is its texture's name, null for a plain colour. */
function face(name: string | null, over: Partial<ModelFace> = {}): ModelFace {
  return {
    geometry: new THREE.BufferGeometry(),
    color: "#c8b89a",
    opacity: 1,
    texture: name === null ? -1 : 0,
    resource: name === null ? null : ({ index: 0, kind: "texture", name, folder: "", preview: null, previewMime: "" } as ResourceInfo),
    map: null,
    alphaMap: null,
    recessed: false,
    ...over,
  };
}

/** The fields a finish is judged by, as text: two materials with the same text look the same. */
function finishOf(m: THREE.MeshPhysicalMaterial): string {
  return JSON.stringify([
    m.color.getHexString(), m.emissive.getHexString(), m.emissiveIntensity,
    m.roughness, m.metalness, m.transmission, m.ior, m.clearcoat, m.sheen, m.sheenColor.getHexString(),
    m.opacity, m.transparent, m.depthWrite, m.alphaTest, m.polygonOffsetFactor, m.polygonOffsetUnits,
    m.map !== null, m.alphaMap !== null,
  ]);
}

/** Updates `m` in place and tells whether that asked for a new shader (needsUpdate bumps the material's version). */
function updateBumps(m: THREE.MeshPhysicalMaterial, f: ModelFace, o?: MaterialOverride): boolean {
  const v = m.version;
  updateMaterial(m, f, o);
  return m.version !== v;
}

const picture = new THREE.Texture();
const cutout = new THREE.Texture();
const auto: MaterialOverride = { preset: "auto" };

console.log("presets");
{
  const labelled = (Object.keys(PRESET_LABELS) as MaterialPresetId[]).filter((id) => id !== "auto");
  check(PRESETS.map((p) => p.id).join() === labelled.join(), "PRESETS lists every finish in PRESET_LABELS' order, without auto");
  check(PRESETS.every((p) => p.ior >= 1 && p.ior <= 2.4), "every preset has a real index of refraction (1 to 2.4)");

  const of = (id: PresetId) => presetFor(face(null), { preset: id });
  check(of("glass").transmission === 1 && of("glass").roughness === 0 && of("glass").ior === 1.5, "glass: clear, smooth, ior 1.5");
  check(of("chrome").metalness === 1 && of("chrome").roughness === 0.05 && of("chrome").color === "#e8e8ea", "chrome: polished metal in #e8e8ea");
  check(of("water").transmission === 0.9 && of("water").ior === 1.33 && of("water").color === "#6f9fb0", "water: clear, ior 1.33, tinted #6f9fb0");
  check(of("fabric").sheen === 0.6 && of("fabric").roughness === 0.95, "fabric: soft sheen");
  check(of("wood").clearcoat === 0.1 && of("tile").clearcoat === 0.3, "wood and tile: clearcoat");
  check(of("emissive").emissive === 4, "light panel: gives off 4 times its colour");
  check(of("matte").ior === 1.5 && of("matte").metalness === 0 && of("matte").transmission === 0, "matte: dielectric, not clear, not metal");
}

console.log("guessPreset by name");
{
  const byName: [string, PresetId][] = [
    ["Brushed Steel", "brushed-metal"],
    ["Brushed Aluminium", "brushed-metal"],
    ["Brushed Concrete", "concrete"],
    ["Light Oak", "wood"],
    ["Oak Floor Parquet", "wood"],
    ["Plywood Sheet", "wood"],
    ["Ash Board", "wood"],
    ["Frosted Glass", "frosted-glass"],
    ["Sandblasted Glass", "frosted-glass"],
    ["Sandblasted Stone", "stone"],
    ["Glass", "glass"],
    ["Window Glazing", "glass"],
    ["Panel Wall", "matte"],
    ["Concrete Smooth", "concrete"],
    ["Brick Common", "brick"],
    ["Ceramic Tile 300", "tile"],
    ["Splashback Tile", "tile"],
    ["Textile Weave", "fabric"],
    ["Carpet Grey", "fabric"],
    ["Marble White", "stone"],
    ["Chrome Tap", "chrome"],
    ["Mirror", "chrome"],
    ["Steel Stud", "metal"],
    ["Iron Gate", "metal"],
    ["Tree Canopy", "foliage"],
    ["Street Curb", "matte"],
    ["Water Pool", "water"],
    ["Plastic Sheet", "plastic"],
    ["Wall Paint", "plaster"],
    ["Light Panel 4000", "emissive"],
  ];
  for (const [name, want] of byName) {
    const got = guessPreset(face(name));
    check(got === want, got === want ? `"${name}" guesses ${want}` : `"${name}" should guess ${want}, got ${got}`);
  }
}

console.log("guessPreset without a name");
{
  check(guessPreset(face(null, { alphaMap: cutout })) === "foliage", "a cut-out picture with no name guesses foliage");
  check(guessPreset(face(null, { alphaMap: cutout, opacity: 0.5 })) === "foliage", "a cut-out wins over its opacity");
  check(guessPreset(face(null, { opacity: 0.5 })) === "glass", "a 50 % opaque colour guesses glass");
  check(guessPreset(face(null)) === "matte", "an opaque colour guesses matte");
  check(guessPreset(face(null, { opacity: 0.95 })) === "matte", "95 % opaque is still matte");
}

console.log("presetFor");
{
  check(presetFor(face("Glass"), { preset: "wood" }).id === "wood", "an override names the finish");
  check(presetFor(face("Glass"), auto).id === "glass", '"auto" guesses from the name');
  check(presetFor(face("Glass")).id === "glass", "no override guesses from the name");
}

console.log("makeMaterial");
{
  const clear = makeMaterial(face("Glass", { opacity: 0.3 }));
  check(clear instanceof THREE.MeshPhysicalMaterial, "a MeshPhysicalMaterial");
  check(clear.transmission === 1 && !clear.transparent && clear.opacity === 1 && clear.depthWrite && clear.thickness === 0 && clear.roughness === 0, "glass: clear and thin, not see-through by its opacity");
  check(clear.ior === 1.5 && clear.side === THREE.DoubleSide && !clear.flatShading, "glass: ior 1.5, double-sided, smooth normals");

  const chrome = makeMaterial(face("Chrome Tap"));
  check(chrome.metalness === 1 && chrome.roughness === 0.05 && chrome.color.getHexString() === "e8e8ea", "chrome: metal in the chrome colour");

  const oak = makeMaterial(face("Oak Floor", { map: picture }));
  check(oak.map === picture && oak.color.getHexString() === "ffffff", "a textured face shows its picture in white");
  check(oak.roughness === 0.55 && oak.clearcoat === 0.1 && oak.clearcoatRoughness === 0.1, "a textured oak floor has the wood finish");
  const tinted = makeMaterial(face("Oak Floor", { map: picture }), { preset: "auto", tint: "#ff0000" });
  check(tinted.map === picture && tinted.color.getHexString() === "ff0000", "a tint multiplies the picture: colour set, picture kept");

  const leafy = makeMaterial(face(null, { alphaMap: cutout }));
  check(leafy.alphaMap === cutout && leafy.alphaTest === 0.5 && leafy.map === null && leafy.roughness === 0.7, "a cut-out: mask at 0.5, no picture, foliage");

  const see = makeMaterial(face("Plastic Sheet", { opacity: 0.5 }));
  check(see.transparent && see.opacity === 0.5 && !see.depthWrite && see.transmission === 0, "see-through plastic: transparent at 50 %, no depth write");

  const brushed = makeMaterial(face("Brushed Steel"), { preset: "auto", roughness: 0.2, metalness: 0.5 });
  check(brushed.roughness === 0.2 && brushed.metalness === 0.5, "override roughness and metalness replace the preset's");

  const panel = makeMaterial(face("Light Panel"));
  check(panel.emissiveIntensity === 4 && panel.emissive.getHexString() === "c8b89a", "a light panel glows in its colour, four times over");
  const dark = makeMaterial(face("Light Panel"), { preset: "auto", emissive: 0 });
  check(dark.emissiveIntensity === 0 && dark.emissive.getHexString() === "000000", "emissive 0: no light, black emissive");

  const frame = makeMaterial(face("Oak Door", { recessed: true }));
  const wall = makeMaterial(face("Plaster Render"));
  check(frame.polygonOffset && frame.polygonOffsetFactor === 2 && frame.polygonOffsetUnits === 4, "a recessed face is offset 2 and 4, to win the depth test");
  check(wall.polygonOffset && wall.polygonOffsetFactor === 1 && wall.polygonOffsetUnits === 1, "a wall is offset 1 and 1");

  const carpet = makeMaterial(face("Carpet Grey"));
  check(carpet.sheen === 0.6 && carpet.sheenRoughness === 0.8 && carpet.sheenColor.getHexString() === "c8b89a", "fabric: sheen in the face's colour");
}

console.log("updateMaterial");
{
  const m = makeMaterial(face("Plaster Render"));
  check(!updateBumps(m, face("Plaster Render"), { preset: "auto", roughness: 0.3, tint: "#3366aa" }), "roughness and colour edited: values only, no recompile");
  check(m.roughness === 0.3 && m.color.getHexString() === "3366aa", "the same material object now shows the edit");
  check(updateBumps(m, face("Plaster Render", { map: picture }), auto), "a picture arrives: recompile");
  check(!updateBumps(m, face("Plaster Render", { map: picture }), { preset: "auto", roughness: 0.2 }), "the same picture, roughness edited: no recompile");
  check(updateBumps(m, face("Plaster Render"), auto), "the picture goes: recompile");

  const t = makeMaterial(face("Plaster Render"));
  check(updateBumps(t, face("Plaster Render"), { preset: "auto", transmission: 0.5 }), "transmission 0 to 0.5: recompile");
  check(!updateBumps(t, face("Plaster Render"), { preset: "auto", transmission: 0.8 }), "transmission 0.5 to 0.8: no recompile");
  check(updateBumps(t, face("Plaster Render"), { preset: "auto", transmission: 0 }), "transmission back to 0: recompile");

  const w = makeMaterial(face("Wood Floor"));
  check(updateBumps(w, face("Wood Floor"), { preset: "matte" }), "clearcoat 0.1 to 0: recompile");

  const f = makeMaterial(face("Carpet Grey"));
  check(updateBumps(f, face("Carpet Grey"), { preset: "plastic" }), "sheen 0.6 to 0: recompile");

  const o = makeMaterial(face("Plaster Render"));
  check(updateBumps(o, face("Plaster Render", { opacity: 0.5 }), auto), "a see-through face: transparent turns on, recompile");

  const cut = makeMaterial(face(null));
  check(updateBumps(cut, face(null, { alphaMap: cutout }), auto), "a cut-out mask added: recompile");

  const scenes: [string, ModelFace, MaterialOverride | undefined][] = [
    ["glass", face("Glass", { opacity: 0.3 }), undefined],
    ["chrome", face("Chrome Tap"), undefined],
    ["tinted picture", face("Oak Floor", { map: picture }), { preset: "auto", tint: "#ff0000" }],
    ["light panel", face("Light Panel"), { preset: "auto", emissive: 0 }],
    ["cut-out", face(null, { alphaMap: cutout }), undefined],
    ["see-through plastic", face("Plastic Sheet", { opacity: 0.5 }), undefined],
  ];
  const shared = makeMaterial(face("Carpet Grey"));
  for (const [label, f2, o2] of scenes) {
    updateMaterial(shared, f2, o2);
    check(finishOf(shared) === finishOf(makeMaterial(f2, o2)), `one material edited to ${label} matches a new ${label} material`);
  }
}

console.log("clay");
{
  const clay = "#ecebe7";
  const wood = makeMaterial(face("Oak Floor", { map: picture }), undefined, clay);
  check(wood.color.getHexString() === "ecebe7" && wood.map === null, "a pictured face takes the clay colour and loses its picture");
  check(wood.metalness === 0 && wood.clearcoat === 0 && wood.sheen === 0 && wood.roughness > 0.7, "clay is matte: no metal, clearcoat or sheen");
  const chrome = makeMaterial(face("Chrome Tap"), undefined, clay);
  check(chrome.metalness === 0 && chrome.roughness > 0.7, "chrome turns to clay");
  const glass = makeMaterial(face("Glass", { opacity: 0.3 }), undefined, clay);
  check(glass.transmission === 1 && glass.color.getHexString() === "ffffff", "glass stays clear glass");
  const panel = makeMaterial(face("Light Panel"), undefined, clay);
  check(panel.emissiveIntensity > 0, "a light panel still glows");
  const cut = makeMaterial(face(null, { alphaMap: cutout }), undefined, clay);
  check(cut.alphaMap === cutout && cut.alphaTest === 0.5, "a cut-out keeps its outline");

  const m = makeMaterial(face("Oak Floor", { map: picture }));
  const v = m.version;
  updateMaterial(m, face("Oak Floor", { map: picture }), undefined, clay);
  check(m.version !== v && m.map === null, "turning clay on drops the picture and recompiles");
  updateMaterial(m, face("Oak Floor", { map: picture }), undefined, null);
  check(finishOf(m) === finishOf(makeMaterial(face("Oak Floor", { map: picture }))), "turning clay off gives the finish back");
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
