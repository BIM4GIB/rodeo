// The material library's entries: CC0 textures from Poly Haven (polyhaven.com) and ambientCG
// (ambientcg.com), fetched and made into WebP by scripts/materials.ts, kept under public/materials/<id>/
// (color, normal, rough and sometimes metal, plus a thumb). Written by that script: edit the script's
// list, not this file.

import type { PresetId } from "./materials.ts";

export type LibraryCategory = "Wood" | "Brick" | "Stone" | "Concrete" | "Plaster" | "Tile" | "Metal" | "Paving" | "Ground" | "Roofing" | "Fabric";

export interface LibraryEntry {
  /** its id at its source (Poly Haven or ambientCG), also its folder under public/materials */
  readonly id: string;
  /** its name in the palette, in English */
  readonly label: string;
  readonly category: LibraryCategory;
  /** the finish whose physical values it takes (metalness, clearcoat, sheen, transmission) */
  readonly finish: PresetId;
  /** metres the image spans across and up */
  readonly size: readonly [number, number];
  /** which maps its folder holds besides color.webp and thumb.webp */
  readonly maps: { readonly normal: boolean; readonly rough: boolean; readonly metal: boolean };
  /** who made it, for the credits */
  readonly author: string;
}

export const LIBRARY: readonly LibraryEntry[] = [
  { id: "wood_floor_deck", label: "Dark Deck Boards", category: "Wood", finish: "wood", size: [1.8, 1.8], maps: { normal: true, rough: true, metal: false }, author: "Dimitrios Savva" },
  { id: "exterior_wall_cladding", label: "Grey Board Cladding", category: "Wood", finish: "plaster", size: [2, 2], maps: { normal: true, rough: true, metal: false }, author: "Charlotte Baglioni" },
  { id: "herringbone_parquet", label: "Herringbone Parquet", category: "Wood", finish: "wood", size: [3.4, 3.4], maps: { normal: true, rough: true, metal: false }, author: "Jenelle van Heerden" },
  { id: "laminate_floor_02", label: "Light Oak Floor", category: "Wood", finish: "wood", size: [1.7, 1.7], maps: { normal: true, rough: true, metal: false }, author: "Dario Barresi" },
  { id: "oak_veneer_01", label: "Oak Veneer", category: "Wood", finish: "wood", size: [1.83, 1.83], maps: { normal: true, rough: true, metal: false }, author: "Jenelle van Heerden" },
  { id: "weathered_brown_planks", label: "Weathered Cladding", category: "Wood", finish: "wood", size: [1.8, 1.8], maps: { normal: true, rough: true, metal: false }, author: "Dimitrios Savva" },
  { id: "dark_brick_wall", label: "Dark Engineering Brick", category: "Brick", finish: "brick", size: [1.05, 1.05], maps: { normal: true, rough: true, metal: false }, author: "Dario Barresi" },
  { id: "whitewashed_brick", label: "Pale Brick", category: "Brick", finish: "brick", size: [2, 2], maps: { normal: true, rough: true, metal: false }, author: "Charlotte Baglioni" },
  { id: "red_brick", label: "Red Brick", category: "Brick", finish: "brick", size: [1.4, 1.4], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "yellow_brick", label: "Yellow Stock Brick", category: "Brick", finish: "brick", size: [2, 2], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "stone_tiles_02", label: "Flagstone", category: "Stone", finish: "stone", size: [2, 2], maps: { normal: true, rough: true, metal: false }, author: "Charlotte Baglioni" },
  { id: "rustic_stone_wall_02", label: "Rough Stone Wall", category: "Stone", finish: "stone", size: [1.5, 1.5], maps: { normal: true, rough: true, metal: false }, author: "Amal Kumar" },
  { id: "sandstone_blocks_05", label: "Sandstone Blocks", category: "Stone", finish: "stone", size: [3, 3], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "concrete_wall_008", label: "Fair-Faced Concrete", category: "Concrete", finish: "concrete", size: [2.71, 2.71], maps: { normal: true, rough: true, metal: false }, author: "Dario Barresi" },
  { id: "concrete_floor_worn_001", label: "Polished Concrete", category: "Concrete", finish: "concrete", size: [3, 3], maps: { normal: true, rough: true, metal: false }, author: "Dimitrios Savva" },
  { id: "concrete_wall_007", label: "Precast Concrete Panel", category: "Concrete", finish: "concrete", size: [2.16, 2.16], maps: { normal: true, rough: true, metal: false }, author: "Dario Barresi" },
  { id: "white_plaster_02", label: "Rough Render", category: "Plaster", finish: "plaster", size: [1, 1], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "white_stucco", label: "Smooth White Plaster", category: "Plaster", finish: "plaster", size: [1.998, 1.998], maps: { normal: true, rough: true, metal: false }, author: "Amal Kumar" },
  { id: "floor_tiles_06", label: "Chequered Floor Tile", category: "Tile", finish: "tile", size: [3, 3], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "marble_01", label: "Limestone Floor Tile", category: "Tile", finish: "tile", size: [1.5, 1.5], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "long_white_tiles", label: "White Wall Tile", category: "Tile", finish: "tile", size: [1.27, 1.27], maps: { normal: true, rough: true, metal: false }, author: "Jenelle van Heerden" },
  { id: "corrugated_iron", label: "Corrugated Iron", category: "Metal", finish: "metal", size: [1.12, 1.12], maps: { normal: true, rough: true, metal: true }, author: "Jenelle van Heerden" },
  { id: "blue_metal_plate", label: "Painted Metal Plate", category: "Metal", finish: "plastic", size: [2.5, 2.5], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "asphalt_02", label: "Asphalt", category: "Paving", finish: "concrete", size: [3, 3], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "cobblestone_floor_04", label: "Cobblestones", category: "Paving", finish: "stone", size: [1.5, 1.5], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "concrete_pavers", label: "Concrete Pavers", category: "Paving", finish: "stone", size: [1.92, 1.92], maps: { normal: true, rough: true, metal: false }, author: "Amal Kumar" },
  { id: "gravel_floor_02", label: "Gravel", category: "Ground", finish: "matte", size: [2, 2], maps: { normal: true, rough: true, metal: false }, author: "Jenelle van Heerden" },
  { id: "Grass004", label: "Lawn", category: "Ground", finish: "matte", size: [1.4, 1.4], maps: { normal: true, rough: false, metal: false }, author: "ambientCG" },
  { id: "leafy_grass", label: "Leafy Grass", category: "Ground", finish: "matte", size: [2, 2], maps: { normal: true, rough: true, metal: false }, author: "Charlotte Baglioni" },
  { id: "sand_01", label: "Sand", category: "Ground", finish: "matte", size: [1.5, 1.5], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "clay_roof_tiles_02", label: "Clay Roof Tiles", category: "Roofing", finish: "tile", size: [2.5, 2.5], maps: { normal: true, rough: true, metal: false }, author: "Amal Kumar" },
  { id: "roof_slates_03", label: "Roof Slates", category: "Roofing", finish: "tile", size: [3, 3], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
  { id: "cotton_jersey", label: "Cotton", category: "Fabric", finish: "fabric", size: [0.264, 0.264], maps: { normal: true, rough: true, metal: false }, author: "colormass" },
  { id: "fabric_leather_02", label: "Tan Leather", category: "Fabric", finish: "matte", size: [0.5, 0.5], maps: { normal: true, rough: true, metal: false }, author: "Rob Tuytel" },
];
