// Checks the material finishes under Node: the presets, the guess of a face's preset, the material
// a face is drawn with, and that an edit updates it in place. Run from web/:
//   npx tsx src/features/render/materials.check.ts
// Faces are built by hand (no drawing, no textures decoded) and nothing is written.

import * as THREE from "three";
import type { ModelFace } from "../../app/view3d.ts";
import type { ResourceInfo } from "../../core/index.ts";
import type { LibraryEntry, LibraryTextures } from "./library.ts";
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
function updateBumps(m: THREE.MeshPhysicalMaterial, f: ModelFace, o?: MaterialOverride, lib: LibraryTextures | null = null): boolean {
  const v = m.version;
  updateMaterial(m, f, o, null, lib);
  return m.version !== v;
}

/** A textured face of a drawing's picture `mm` wide, its UVs in units of that picture as view3d.ts makes them. */
function drawnFace(mm: number): ModelFace {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const f = face("Oak Floor", { geometry, map: picture });
  return { ...f, resource: { ...(f.resource as ResourceInfo), imageSize: mm } };
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

console.log("library");
{
  // a library material 2 m across and 1 m up, with all four maps
  const entry: LibraryEntry = { id: "test-oak", label: "Test oak", category: "Wood", finish: "wood", size: [2, 1], maps: { normal: true, rough: true, metal: true }, author: "test" };
  const lib: LibraryTextures = { entry, color: new THREE.Texture(), normal: new THREE.Texture(), rough: new THREE.Texture(), metal: new THREE.Texture() };
  const oak: MaterialOverride = { preset: "auto", library: "test-oak" };
  const repeatIs = (t: THREE.Texture | null, x: number, y: number) => t !== null && Math.abs(t.repeat.x - x) < 1e-9 && Math.abs(t.repeat.y - y) < 1e-9;

  const m = makeMaterial(face(null), oak, null, lib);
  check(m.map !== null && m.map !== lib.color && m.map.source === lib.color.source, "the colour map is a clone of the library's, over the same image");
  check(m.normalMap !== null && m.normalMap !== lib.normal && m.normalMap.source === lib.normal?.source, "the normal map is a clone too");
  check(m.roughnessMap !== null && m.roughnessMap.source === lib.rough?.source && m.metalnessMap !== null && m.metalnessMap.source === lib.metal?.source, "the roughness and metal maps are clones");
  check(m.color.getHexString() === "ffffff", "a library material is drawn in white: its colour map carries the colour");
  check(makeMaterial(face(null), { ...oak, tint: "#ff0000" }, null, lib).color.getHexString() === "ff0000", "a tint multiplies the colour map");

  check(m.normalScale.x === 1 && m.normalScale.y === 1, "bump as it is: normal scale 1");
  const flat = makeMaterial(face(null), { ...oak, bump: 0.5 }, null, lib);
  check(flat.normalScale.x === 0.5 && flat.normalScale.y === 0.5, "bump 0.5: normal scale 0.5 both ways");

  check(m.roughness === 1, "a roughness map sets roughness: 1 as it is");
  check(makeMaterial(face(null), { ...oak, roughness: 0.3 }, null, lib).roughness === 0.3, "a roughness set multiplies the map: 0.3");
  const noRough = makeMaterial(face(null), oak, null, { ...lib, rough: null });
  check(noRough.roughnessMap === null && noRough.roughness === 0.9, "without a roughness map: the finish's roughness (matte 0.9)");

  // the repeat: metres for a face with no picture, the picture's size for a face with one, both over the library's size and scale
  check(repeatIs(m.map, 0.5, 1) && repeatIs(m.normalMap, 0.5, 1), "untextured face: one tile is 2 m by 1 m, repeat 0.5 by 1");
  check(repeatIs(makeMaterial(drawnFace(500), oak, null, lib).map, 0.25, 0.5), "a picture 500 mm wide: repeat 0.25 by 0.5");
  check(repeatIs(makeMaterial(drawnFace(500), { ...oak, scale: 2 }, null, lib).map, 0.125, 0.25), "the same at scale 2: repeat 0.125 by 0.25");
  check(repeatIs(makeMaterial(drawnFace(0), oak, null, lib).map, 0.5, 1), "a picture of unknown size takes 1000 mm");
  check(repeatIs(makeMaterial(face("Oak Floor"), oak, null, lib).map, 0.5, 1), "a textured face with no UVs of its own has metre UVs");

  const shiny = makeMaterial(face(null), { preset: "matte", library: "test-oak" }, null, lib);
  check(shiny.metalness === 1 && shiny.metalnessMap !== null && shiny.metalnessMap.source === lib.metal?.source, "a metal map: metalness 1 whatever the finish");
  const metalNoMap = makeMaterial(face(null), { preset: "metal", library: "test-oak" }, null, { ...lib, metal: null });
  check(metalNoMap.metalness === 1 && metalNoMap.metalnessMap === null, "without a metal map: the finish's metalness (metal: 1)");
  check(makeMaterial(face(null), { preset: "matte", library: "test-oak", metalness: 0.5 }, null, lib).metalness === 0.5, "a metalness set multiplies the metal map: 0.5");

  const loading = makeMaterial(face("Oak Floor", { map: picture }), oak, null, null);
  check(loading.map === picture && loading.normalMap === null && loading.roughnessMap === null && loading.metalnessMap === null, "while the library loads, the face keeps its own look");

  const clayed = makeMaterial(face(null), oak, "#ecebe7", lib);
  check(clayed.map === null && clayed.normalMap === null && clayed.roughnessMap === null && clayed.metalnessMap === null && clayed.color.getHexString() === "ecebe7", "clay: the library's maps are dropped");

  // removing the library clears the maps and disposes the clones, never the library's own textures
  const gone = makeMaterial(face(null), oak, null, lib);
  const clones = [gone.map, gone.normalMap, gone.roughnessMap, gone.metalnessMap].filter((t): t is THREE.Texture => t !== null);
  let disposed = 0;
  let libDisposed = 0;
  for (const t of clones) t.addEventListener("dispose", () => disposed++);
  lib.color.addEventListener("dispose", () => libDisposed++);
  updateMaterial(gone, face(null), { preset: "auto" }, null, null);
  check(gone.map === null && gone.normalMap === null && gone.roughnessMap === null && gone.metalnessMap === null, "library removed: its maps cleared");
  check(disposed === clones.length && clones.length === 4, `library removed: its ${clones.length} clones disposed (${disposed})`);
  check(libDisposed === 0, "the library's own textures are not disposed");

  // a different library textures object (the same material, loaded again): new clones, the old ones disposed
  const swapped = makeMaterial(face(null), oak, null, lib);
  const oldMap = swapped.map;
  let oldDisposed = 0;
  oldMap?.addEventListener("dispose", () => oldDisposed++);
  updateMaterial(swapped, face(null), oak, null, { ...lib });
  check(swapped.map !== oldMap && oldDisposed === 1, "textures swapped: new clones, the old colour clone disposed");

  // shaders: a library adds maps (a new program), its values alone do not
  const k = makeMaterial(face(null));
  check(updateBumps(k, face(null), oak, lib), "a library added: a new shader");
  check(!updateBumps(k, face(null), { ...oak, bump: 0.3 }, lib), "bump edited: values only, no new shader");
  check(!updateBumps(k, face(null), { ...oak, scale: 2 }, lib), "scale edited: the repeat only, no new shader");
  check(updateBumps(k, face(null), { ...oak, bump: 0.3 }, null), "library removed: a new shader");
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
