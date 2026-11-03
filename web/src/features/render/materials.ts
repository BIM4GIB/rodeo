// Material finishes, shared by the raster engine and the path tracer: the presets (roughness,
// metalness, transmission, clearcoat, sheen and the light a finish gives off), the guess of a
// face's preset from its texture's name, colour and opacity, and the MeshPhysicalMaterial a face
// group is drawn with, or its clay look. Both engines read that one material, so a finish looks the
// same in each.

import * as THREE from "three";
import type { ModelFace } from "../../app/view3d.ts";
import type { MaterialOverride, MaterialPresetId } from "./settings.ts";

export type PresetId = Exclude<MaterialPresetId, "auto">;

export interface MaterialPreset {
  readonly id: PresetId;
  /** 0 mirror .. 1 matte */
  readonly roughness: number;
  readonly metalness: number;
  /** 0 opaque .. 1 clear */
  readonly transmission: number;
  readonly ior: number;
  readonly clearcoat: number;
  /** 0..1, cloth's soft rim */
  readonly sheen: number;
  /** light given off, in multiples of the colour */
  readonly emissive: number;
  /** the preset's own colour (chrome, water), or null to keep the face's */
  readonly color: string | null;
}

/** The index of refraction of an ordinary dielectric (glass, stone, paint). */
const DIELECTRIC_IOR = 1.5;
/** a clay model's faces: about as matte as plaster */
const CLAY_ROUGHNESS = 0.82;

/** Every preset, in PRESET_LABELS' order (without "auto"). */
export const PRESETS: readonly MaterialPreset[] = [
  preset("matte", { roughness: 0.9 }),
  preset("plaster", { roughness: 0.85 }),
  preset("concrete", { roughness: 0.8 }),
  preset("wood", { roughness: 0.55, clearcoat: 0.1 }),
  preset("stone", { roughness: 0.6 }),
  preset("brick", { roughness: 0.85 }),
  preset("tile", { roughness: 0.25, clearcoat: 0.3 }),
  preset("metal", { roughness: 0.35, metalness: 1 }),
  preset("brushed-metal", { roughness: 0.45, metalness: 1 }),
  preset("chrome", { roughness: 0.05, metalness: 1, color: "#e8e8ea" }),
  preset("glass", { roughness: 0, transmission: 1 }),
  preset("frosted-glass", { roughness: 0.35, transmission: 1 }),
  preset("water", { roughness: 0.03, transmission: 0.9, ior: 1.33, color: "#6f9fb0" }),
  preset("plastic", { roughness: 0.35 }),
  preset("glossy-paint", { roughness: 0.15, clearcoat: 0.6 }),
  preset("fabric", { roughness: 0.95, sheen: 0.6 }),
  preset("foliage", { roughness: 0.7 }),
  preset("emissive", { roughness: 0.6, emissive: 4 }),
];

/** A preset from the values it sets; the rest are 0, except the index, where 0 would make every face a mirror. */
function preset(id: PresetId, values: Partial<Omit<MaterialPreset, "id">>): MaterialPreset {
  return { id, roughness: 0, metalness: 0, transmission: 0, ior: DIELECTRIC_IOR, clearcoat: 0, sheen: 0, emissive: 0, color: null, ...values };
}

/** Words that make a name a metal (so "brushed" with one of them is brushed metal, not concrete). */
const METAL_WORD = /steel|alumin|metal|zinc|copper|brass|\biron|bronze|titanium/;

/** The preset `face` is guessed to be from its texture's name, its colour and its opacity. */
export function guessPreset(face: Pick<ModelFace, "resource" | "color" | "opacity" | "alphaMap">): PresetId {
  // most specific first: the first word list the name holds decides
  const name = (face.resource?.name ?? "").toLowerCase();
  if (/frosted|obscure|etched|sandblast.*glass|glass.*sandblast/.test(name)) return "frosted-glass";
  if (/glass|glazing|window|\bpanes?\b/.test(name)) return "glass";
  if (/\b(water|pool|pond)/.test(name)) return "water";
  if (/chrome|mirror/.test(name)) return "chrome";
  if (/\b(brushed|satin)/.test(name) && METAL_WORD.test(name)) return "brushed-metal";
  if (METAL_WORD.test(name)) return "metal";
  if (/wood|timber|\boak|\bpine|walnut|\bash\b|birch|cedar|larch|veneer|parquet|\bdeck/.test(name)) return "wood";
  if (/concrete|cement|screed/.test(name)) return "concrete";
  if (/plaster|render|stucco|paint|drywall|gypsum/.test(name)) return "plaster";
  if (/brick|masonry/.test(name)) return "brick";
  if (/\btile|ceramic|porcelain/.test(name)) return "tile";
  if (/stone|marble|granite|slate|limestone|sandstone|travertine|gravel|pebble/.test(name)) return "stone";
  if (/fabric|carpet|textile|cloth|upholstery|curtain|\brugs?\b|felt/.test(name)) return "fabric";
  if (/\b(grass|lawn|leaf|leaves|foliage|tree|plant|hedge|shrub|bush)/.test(name)) return "foliage";
  if (/plastic|acrylic|vinyl|laminate/.test(name)) return "plastic";
  if (/light panel|led panel|lightbox|emissive|glow/.test(name)) return "emissive";
  // a cut-out picture (plants) is foliage; otherwise the colour's opacity decides
  if (face.alphaMap) return "foliage";
  return face.opacity < 0.95 ? "glass" : "matte";
}

/** The preset an override names, "auto" (or none) being the guessed one. */
export function presetFor(face: ModelFace, override?: MaterialOverride): MaterialPreset {
  const named = override?.preset;
  const id: PresetId = named && named !== "auto" ? named : guessPreset(face);
  // PRESETS[0] only answers a name this version does not know, from a setting kept by another one
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/** A new material for `face` with its finish; `clay` (a CSS colour) gives it the clay look instead. */
export function makeMaterial(face: ModelFace, override?: MaterialOverride, clay: string | null = null): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial();
  applyFinish(material, face, override, clay);
  return material;
}

/** Sets `material` to the finish again after the override or the clay look changed (same material object, needsUpdate set when its shader must change). */
export function updateMaterial(material: THREE.MeshPhysicalMaterial, face: ModelFace, override?: MaterialOverride, clay: string | null = null): void {
  const before = shaderKey(material);
  applyFinish(material, face, override, clay);
  if (shaderKey(material) !== before) material.needsUpdate = true;
}

/**
 * Writes a face's finish into `material`, every field, so a new material and an edited one come out
 * alike. Under `clay` every face takes that colour, matte and without its picture; glass stays
 * clear and a light panel still glows, and a cut-out keeps its outline.
 */
function applyFinish(material: THREE.MeshPhysicalMaterial, face: ModelFace, override: MaterialOverride | undefined, clay: string | null): void {
  const preset = presetFor(face, override);
  const transmission = override?.transmission ?? preset.transmission;
  const emissive = override?.emissive ?? preset.emissive;
  // a picture carries its own colour: a palette tint multiplies it, otherwise it shows as it is
  const own = override?.tint ?? (face.map ? "#ffffff" : (preset.color ?? face.color));
  const colour = clay === null ? own : transmission > 0 ? "#ffffff" : clay;

  material.color.set(colour);
  material.map = clay === null ? face.map : null;
  material.alphaMap = face.alphaMap;
  // a cut-out keeps its pixels above half the mask and drops the rest
  material.alphaTest = face.alphaMap ? 0.5 : 0;
  material.side = THREE.DoubleSide;
  material.roughness = clay === null ? (override?.roughness ?? preset.roughness) : transmission > 0 ? preset.roughness : CLAY_ROUGHNESS;
  material.metalness = clay === null ? (override?.metalness ?? preset.metalness) : 0;
  material.transmission = transmission;
  material.ior = preset.ior;
  material.clearcoat = clay === null ? preset.clearcoat : 0;
  material.clearcoatRoughness = 0.1;
  material.sheen = clay === null ? preset.sheen : 0;
  material.sheenRoughness = 0.8;
  material.sheenColor.copy(material.color);
  material.emissive.set(emissive > 0 ? colour : "#000000");
  material.emissiveIntensity = emissive;
  material.flatShading = false;
  // a recessed face (a wall's) is drawn behind faces lying exactly on it, as view3d.ts does
  material.polygonOffset = true;
  material.polygonOffsetFactor = face.recessed ? 2 : 1;
  material.polygonOffsetUnits = face.recessed ? 4 : 1;

  if (transmission > 0) {
    // thin glass: it is clear whatever its opacity, and bends the view by nothing
    material.opacity = 1;
    material.transparent = false;
    material.depthWrite = true;
    material.thickness = 0;
  } else if (face.opacity < 1) {
    material.opacity = face.opacity;
    material.transparent = true;
    material.depthWrite = false;
  } else {
    material.opacity = 1;
    material.transparent = false;
    material.depthWrite = true;
  }
}

/** What a material's shader is compiled with: a change in any of these needs a new program. */
function shaderKey(m: THREE.MeshPhysicalMaterial): string {
  return [m.map !== null, m.alphaMap !== null, m.transmission > 0, m.clearcoat > 0, m.sheen > 0, m.transparent].join();
}
