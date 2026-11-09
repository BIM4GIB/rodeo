// Fetches the material library's textures at 1K from Poly Haven and ambientCG (both CC0), makes them
// into WebP under public/materials/<id>/, and writes their entries into src/features/render/library.data.ts
// and their credits into public/licences/poly-haven.txt and public/licences/ambientcg.txt. Each entry below
// is one texture, chosen for the look its label names and for how often it is downloaded. A texture
// without a 1K colour, normal and roughness map is refused before the library is written. Files already
// made are kept, so a run only fills in what is missing; over the size budget the colour and normal maps
// are made at a lower quality.
//
//   cd web && npx tsx scripts/materials.ts
//
// Needs the network, cwebp (brew install webp) and unzip (built into macOS). Neither site needs a key.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { LibraryCategory, LibraryEntry } from "../src/features/render/library.data.ts";
import type { PresetId } from "../src/features/render/materials.ts";

const WEB = resolve(import.meta.dirname, "..");
const MATERIALS = join(WEB, "public", "materials");
const LICENCE = join(WEB, "public", "licences", "poly-haven.txt");
const LICENCE_AMBIENTCG = join(WEB, "public", "licences", "ambientcg.txt");
const LIBRARY_FILE = join(WEB, "src", "features", "render", "library.data.ts");
const CACHE = join(tmpdir(), "rodeo-materials");
const CWEBP = "cwebp";
const API = "https://api.polyhaven.com";
const AMBIENTCG = "https://ambientcg.com/api/v2";
const USER_AGENT = "rodeo.build materials script";
/** The most the materials folder may hold: over it, the colour and normal maps are made at a lower quality. */
const BUDGET = 20 * 1024 * 1024;
/** The lowest quality the colour and normal maps are made at. */
const QUALITY_FLOOR = 75;
/** The categories in the order the library lists them. */
const CATEGORIES: readonly LibraryCategory[] = ["Wood", "Brick", "Stone", "Concrete", "Plaster", "Tile", "Metal", "Paving", "Ground", "Roofing", "Fabric"];

/** One slot of the library: a texture from Poly Haven or ambientCG, the label it has in the palette and the finish it takes. */
interface Pick {
  readonly id: string;
  readonly label: string;
  readonly category: LibraryCategory;
  readonly finish: PresetId;
  /** where it is from: Poly Haven unless it says ambientcg */
  readonly source?: "polyhaven" | "ambientcg";
  /** false leaves its roughness map out, so the finish's own roughness holds (a map that reads too glossy) */
  readonly rough?: false;
}

/** One file of a texture: where to get it and its md5. ambientCG gives no md5, and its JPGs come out of one zip: `member` names the JPG in it. */
interface Source {
  readonly url: string;
  readonly md5?: string;
  readonly member?: string;
}

/** Poly Haven's files for a texture: each map by name, then resolution, then format. */
type Files = Readonly<Record<string, Readonly<Record<string, Readonly<Record<string, Source | undefined>> | undefined>>>>;

/** Poly Haven's texture list, by id: the size in mm and the authors by name. */
interface Assets {
  readonly [id: string]: { readonly dimensions?: readonly number[]; readonly authors?: Readonly<Record<string, string>> } | undefined;
}

/** ambientCG's answer for one texture: its size in cm and its downloads, each zip under its attribute such as "1K-JPG". */
interface AmbientCG {
  readonly foundAssets: readonly {
    readonly dimensionX: number;
    readonly dimensionY: number;
    readonly downloadFolders: {
      readonly default: {
        readonly downloadFiletypeCategories: { readonly zip: { readonly downloads: readonly { readonly attribute: string; readonly downloadLink: string }[] } };
      };
    };
  }[];
}

/** The JPG of each map a texture is made from; roughness unless its pick leaves it out, metal only where it has one. */
interface Maps {
  readonly color: Source;
  readonly normal: Source;
  readonly rough: Source | undefined;
  readonly metal: Source | undefined;
}

/** What a source gives for a texture: its maps, its size in metres and its author. */
interface Found {
  readonly maps: Maps;
  readonly size: readonly [number, number];
  readonly author: string;
}

interface Plan {
  readonly pick: Pick;
  readonly entry: LibraryEntry;
  readonly maps: Maps;
}

interface Quality {
  readonly color: number;
  readonly normal: number;
}

const PICKS: readonly Pick[] = [
  { id: "laminate_floor_02", label: "Light Oak Floor", category: "Wood", finish: "wood" },
  { id: "wood_floor_deck", label: "Dark Deck Boards", category: "Wood", finish: "wood" },
  { id: "herringbone_parquet", label: "Herringbone Parquet", category: "Wood", finish: "wood" },
  { id: "weathered_brown_planks", label: "Weathered Cladding", category: "Wood", finish: "wood" },
  { id: "oak_veneer_01", label: "Oak Veneer", category: "Wood", finish: "wood" },
  { id: "exterior_wall_cladding", label: "Grey Board Cladding", category: "Wood", finish: "plaster" },
  { id: "red_brick", label: "Red Brick", category: "Brick", finish: "brick" },
  { id: "whitewashed_brick", label: "Pale Brick", category: "Brick", finish: "brick" },
  { id: "yellow_brick", label: "Yellow Stock Brick", category: "Brick", finish: "brick" },
  { id: "dark_brick_wall", label: "Dark Engineering Brick", category: "Brick", finish: "brick" },
  { id: "rustic_stone_wall_02", label: "Rough Stone Wall", category: "Stone", finish: "stone" },
  { id: "sandstone_blocks_05", label: "Sandstone Blocks", category: "Stone", finish: "stone" },
  { id: "stone_tiles_02", label: "Flagstone", category: "Stone", finish: "stone" },
  { id: "concrete_floor_worn_001", label: "Polished Concrete", category: "Concrete", finish: "concrete" },
  { id: "concrete_wall_008", label: "Fair-Faced Concrete", category: "Concrete", finish: "concrete" },
  { id: "concrete_wall_007", label: "Precast Concrete Panel", category: "Concrete", finish: "concrete" },
  { id: "white_stucco", label: "Smooth White Plaster", category: "Plaster", finish: "plaster" },
  { id: "white_plaster_02", label: "Rough Render", category: "Plaster", finish: "plaster" },
  { id: "long_white_tiles", label: "White Wall Tile", category: "Tile", finish: "tile" },
  { id: "floor_tiles_06", label: "Chequered Floor Tile", category: "Tile", finish: "tile" },
  { id: "marble_01", label: "Limestone Floor Tile", category: "Tile", finish: "tile" },
  { id: "corrugated_iron", label: "Corrugated Iron", category: "Metal", finish: "metal" },
  { id: "blue_metal_plate", label: "Painted Metal Plate", category: "Metal", finish: "plastic" },
  { id: "concrete_pavers", label: "Concrete Pavers", category: "Paving", finish: "stone" },
  { id: "cobblestone_floor_04", label: "Cobblestones", category: "Paving", finish: "stone" },
  { id: "asphalt_02", label: "Asphalt", category: "Paving", finish: "concrete" },
  // its roughness map averages 0.26, a wet shine: the matte finish's 0.9 reads as a lawn
  { id: "Grass004", label: "Lawn", category: "Ground", finish: "matte", source: "ambientcg", rough: false },
  { id: "leafy_grass", label: "Leafy Grass", category: "Ground", finish: "matte" },
  { id: "gravel_floor_02", label: "Gravel", category: "Ground", finish: "matte" },
  { id: "sand_01", label: "Sand", category: "Ground", finish: "matte" },
  { id: "clay_roof_tiles_02", label: "Clay Roof Tiles", category: "Roofing", finish: "tile" },
  { id: "roof_slates_03", label: "Roof Slates", category: "Roofing", finish: "tile" },
  { id: "cotton_jersey", label: "Cotton", category: "Fabric", finish: "fabric" },
  { id: "fabric_leather_02", label: "Tan Leather", category: "Fabric", finish: "matte" },
];

async function getJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const data: unknown = await response.json();
  return data;
}

/** The 1K JPG of a map Poly Haven has for the texture; a texture without one is refused. */
function jpgOf(files: Files, id: string, map: string): Source {
  const jpg = files[map]?.["1k"]?.jpg;
  if (!jpg) throw new Error(`${id}: Poly Haven has no 1K JPG of ${map}`);
  return jpg;
}

/** Poly Haven's maps, size and author for a texture. */
async function fromPolyHaven(pick: Pick, assets: Assets): Promise<Found> {
  const asset = assets[pick.id];
  if (!asset) throw new Error(`${pick.id}: not one of Poly Haven's textures`);
  const dims = asset.dimensions;
  if (!dims || dims.length !== 2 || dims.some((mm) => !(mm > 0))) throw new Error(`${pick.id}: Poly Haven gives no size`);
  const files = (await getJson(`${API}/files/${pick.id}`)) as Files;
  const color = jpgOf(files, pick.id, "Diffuse");
  const normal = jpgOf(files, pick.id, "nor_gl");
  const rough = jpgOf(files, pick.id, "Rough");
  // only metals take a metal map: some fabrics ship an empty one
  const metal = pick.finish === "metal" || pick.finish === "brushed-metal" ? files.Metal?.["1k"]?.jpg : undefined;
  const size: readonly [number, number] = [Math.round(dims[0]) / 1000, Math.round(dims[1]) / 1000];
  const author = Object.keys(asset.authors ?? {})[0] ?? "Poly Haven";
  return { maps: { color, normal, rough, metal }, size, author };
}

/** ambientCG's maps, size and author for a texture: its size is in cm, and its 1K JPGs come in one zip as <id>_1K-JPG_<map>.jpg. */
async function fromAmbientCG(pick: Pick): Promise<Found> {
  const found = (await getJson(`${AMBIENTCG}/full_json?id=${pick.id}&include=downloadData,dimensionsData`)) as AmbientCG;
  const asset = found.foundAssets[0];
  const zip = asset?.downloadFolders.default.downloadFiletypeCategories.zip.downloads.find((d) => d.attribute === "1K-JPG");
  if (!asset || !zip) throw new Error(`${pick.id}: ambientCG has no 1K JPG zip`);
  if (!(asset.dimensionX > 0) || !(asset.dimensionY > 0)) throw new Error(`${pick.id}: ambientCG gives no size`);
  const map = (name: string): Source => ({ url: zip.downloadLink, member: `${pick.id}_1K-JPG_${name}.jpg` });
  const size: readonly [number, number] = [Math.round(asset.dimensionX) / 100, Math.round(asset.dimensionY) / 100];
  // ambientCG's metal map is not read: no ambientCG texture is a metal yet
  return { maps: { color: map("Color"), normal: map("NormalGL"), rough: map("Roughness"), metal: undefined }, size, author: "ambientCG" };
}

async function plan(pick: Pick, assets: Assets): Promise<Plan> {
  const found = pick.source === "ambientcg" ? await fromAmbientCG(pick) : await fromPolyHaven(pick, assets);
  const { size, author } = found;
  const maps: Maps = pick.rough === false ? { ...found.maps, rough: undefined } : found.maps;
  return {
    pick,
    entry: {
      id: pick.id,
      label: pick.label,
      category: pick.category,
      finish: pick.finish,
      size,
      maps: { normal: true, rough: maps.rough !== undefined, metal: maps.metal !== undefined },
      author,
    },
    maps,
  };
}

/** Downloads a URL with the script's User-Agent: its bytes, or an error when the server refuses. */
async function download(url: string, what: string): Promise<Buffer> {
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`${what}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** A texture's ambientCG zip, downloaded the first time and kept in its cache folder. */
async function cachedZip(id: string, url: string): Promise<string> {
  const file = join(CACHE, id, "archive.zip");
  if (existsSync(file)) return file;
  const bytes = await download(url, `${id} zip`);
  if (bytes.length === 0) throw new Error(`${id}: the ambientCG zip is empty`);
  writeFileSync(`${file}.part`, bytes);
  renameSync(`${file}.part`, file);
  return file;
}

/** The cached JPG of one map of a texture: downloaded and checked against Poly Haven's md5 the first time, or unzipped from ambientCG's zip. */
async function cached(id: string, map: string, source: Source): Promise<string> {
  const dir = join(CACHE, id);
  const file = join(dir, `${map}.jpg`);
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  if (source.member !== undefined) {
    // ambientCG gives no md5, so the JPG is checked by coming out of the zip non-empty
    const zip = await cachedZip(id, source.url);
    execFileSync("unzip", ["-o", "-j", zip, source.member, "-d", dir]);
    const out = join(dir, source.member);
    if (!existsSync(out) || statSync(out).size === 0) throw new Error(`${id} ${map}: ${source.member} is not in the zip`);
    renameSync(out, file);
    return file;
  }
  const bytes = await download(source.url, `${id} ${map}`);
  const sum = createHash("md5").update(bytes).digest("hex");
  if (sum !== source.md5) throw new Error(`${id} ${map}: md5 ${sum}, Poly Haven has ${source.md5}`);
  writeFileSync(`${file}.part`, bytes);
  renameSync(`${file}.part`, file);
  return file;
}

/** Makes the WebP files a texture is missing; the colour and normal maps are made at the given quality. */
async function encodePlan(p: Plan, quality: Quality): Promise<void> {
  const id = p.pick.id;
  const dir = join(MATERIALS, id);
  const { color, normal, rough, metal } = p.maps;
  const outputs: readonly (readonly [string, string, Source | undefined, string[]])[] = [
    ["color.webp", "color", color, ["-q", String(quality.color), "-m", "6"]],
    ["normal.webp", "normal", normal, ["-q", String(quality.normal), "-m", "6"]],
    ["rough.webp", "rough", rough, ["-q", "80", "-m", "6"]],
    ["metal.webp", "metal", metal, ["-q", "80", "-m", "6"]],
    ["thumb.webp", "color", color, ["-resize", "128", "128", "-q", "80", "-m", "6"]],
  ];
  mkdirSync(dir, { recursive: true });
  for (const [name, map, source, args] of outputs) {
    const file = join(dir, name);
    if (!source || existsSync(file)) continue;
    const jpg = await cached(id, map, source);
    execFileSync(CWEBP, ["-quiet", ...args, jpg, "-o", `${file}.part`]);
    renameSync(`${file}.part`, file);
  }
}

function folderBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? folderBytes(path) : statSync(path).size;
  }
  return total;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

function writeLibrary(entries: readonly LibraryEntry[]): void {
  const source = readFileSync(LIBRARY_FILE, "utf8");
  const at = source.indexOf("export const LIBRARY");
  if (at < 0) throw new Error(`${LIBRARY_FILE}: no LIBRARY array to replace`);
  const rows = entries.map(
    (e) =>
      `  { id: ${JSON.stringify(e.id)}, label: ${JSON.stringify(e.label)}, category: ${JSON.stringify(e.category)}, finish: ${JSON.stringify(e.finish)}, size: [${e.size[0]}, ${e.size[1]}], maps: { normal: ${e.maps.normal}, rough: ${e.maps.rough}, metal: ${e.maps.metal} }, author: ${JSON.stringify(e.author)} },`,
  );
  writeFileSync(LIBRARY_FILE, `${source.slice(0, at)}export const LIBRARY: readonly LibraryEntry[] = [\n${rows.join("\n")}\n];\n`);
}

/** Writes one source's credits: its header, a blank line, then one line per texture from that source. */
function writeLicence(file: string, header: readonly string[], plans: readonly Plan[], pageUrl: (id: string) => string): void {
  const lines = plans.map((p) => `${p.entry.label} | ${p.entry.id} | ${p.entry.author} | ${pageUrl(p.entry.id)}`);
  writeFileSync(file, `${[...header, "", ...lines].join("\n")}\n`);
}

/** The credits: Poly Haven's textures in poly-haven.txt, ambientCG's in ambientcg.txt. */
function writeLicences(plans: readonly Plan[]): void {
  writeLicence(
    LICENCE,
    [
      "The textures in public/materials are from Poly Haven (https://polyhaven.com), released under the CC0 licence",
      "(https://polyhaven.com/license): free to use, change and share, commercially or not, with no credit needed.",
    ],
    plans.filter((p) => p.pick.source !== "ambientcg"),
    (id) => `https://polyhaven.com/a/${id}`,
  );
  writeLicence(
    LICENCE_AMBIENTCG,
    [
      "The textures in public/materials are from ambientCG (https://ambientcg.com), released under the CC0 1.0 licence",
      "(https://docs.ambientcg.com/license/): free to use, change and share, commercially or not, with no credit needed.",
    ],
    plans.filter((p) => p.pick.source === "ambientcg"),
    (id) => `https://ambientcg.com/a/${id}`,
  );
}

async function main(): Promise<void> {
  const assets = (await getJson(`${API}/assets?t=textures`)) as Assets;
  const plans: Plan[] = [];
  for (const pick of PICKS) plans.push(await plan(pick, assets));

  // A folder for a texture that has left the list is no longer shipped.
  mkdirSync(MATERIALS, { recursive: true });
  const ids = new Set(PICKS.map((p) => p.id));
  for (const name of readdirSync(MATERIALS)) {
    if (!ids.has(name) && statSync(join(MATERIALS, name)).isDirectory()) rmSync(join(MATERIALS, name), { recursive: true });
  }

  let quality: Quality = { color: 82, normal: 90 };
  for (;;) {
    for (const p of plans) await encodePlan(p, quality);
    if (folderBytes(MATERIALS) <= BUDGET) break;
    if (quality.color <= QUALITY_FLOOR && quality.normal <= QUALITY_FLOOR) {
      console.log(`still over ${mb(BUDGET)} MB at the lowest quality (${QUALITY_FLOOR})`);
      break;
    }
    quality = { color: Math.max(QUALITY_FLOOR, quality.color - 4), normal: Math.max(QUALITY_FLOOR, quality.normal - 4) };
    console.log(`over ${mb(BUDGET)} MB: making colour and normal maps again at quality ${quality.color} and ${quality.normal}`);
    for (const p of plans) {
      rmSync(join(MATERIALS, p.pick.id, "color.webp"), { force: true });
      rmSync(join(MATERIALS, p.pick.id, "normal.webp"), { force: true });
    }
  }

  const sorted = [...plans].sort(
    (a, b) => CATEGORIES.indexOf(a.entry.category) - CATEGORIES.indexOf(b.entry.category) || a.entry.label.localeCompare(b.entry.label, "en"),
  );
  const entries = sorted.map((p) => p.entry);
  writeLibrary(entries);
  writeLicences(sorted);

  for (const e of entries) {
    const kb = Math.round(folderBytes(join(MATERIALS, e.id)) / 1024);
    console.log(`${e.id.padEnd(26)} ${e.label.padEnd(24)} ${e.size[0]} x ${e.size[1]} m  ${kb} KB  ${e.author}`);
  }
  console.log(`${entries.length} textures, ${mb(folderBytes(MATERIALS))} MB in public/materials (budget ${mb(BUDGET)} MB)`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
