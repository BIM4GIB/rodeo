// The render settings (the Render palette's): the sky, the sun and the light objects' strength,
// exposure and tone, fog, the camera's lens, effects, the clay look, quality and each material's
// finish, and the looks (grading presets) the palette offers. They
// belong to the drawing on this machine: kept in localStorage under the file's name, never written
// into the .vwx. No three.js here: the palette loads with the editor, the renderers when first used.

import type { ModelFace } from "../../app/view3d.ts";
import { store } from "../../app/state.ts";

export type SkyKind = "physical" | "gradient" | "color" | "studio";
export type ToneMap = "agx" | "aces" | "neutral";

/** A finish a material can take (materials.ts PRESETS); "auto" guesses one from its texture's name and colour. */
export type MaterialPresetId =
  | "auto"
  | "matte"
  | "plaster"
  | "concrete"
  | "wood"
  | "stone"
  | "brick"
  | "tile"
  | "metal"
  | "brushed-metal"
  | "chrome"
  | "glass"
  | "frosted-glass"
  | "water"
  | "plastic"
  | "glossy-paint"
  | "fabric"
  | "foliage"
  | "emissive";

/** What the palette changes of one material; a field left out keeps the preset's. */
export interface MaterialOverride {
  readonly preset: MaterialPresetId;
  /** 0 mirror .. 1 matte */
  readonly roughness?: number;
  /** 0 dielectric .. 1 metal */
  readonly metalness?: number;
  /** 0 opaque .. 1 clear glass */
  readonly transmission?: number;
  /** light it gives off, in multiples of its colour (0 none) */
  readonly emissive?: number;
  /** a CSS colour in place of the face's */
  readonly tint?: string;
}

/** The finishes the palette offers, in its order ("auto" first). */
export const PRESET_LABELS: Readonly<Record<MaterialPresetId, string>> = {
  auto: "Auto",
  matte: "Matte",
  plaster: "Plaster",
  concrete: "Concrete",
  wood: "Wood",
  stone: "Stone",
  brick: "Brick",
  tile: "Tile",
  metal: "Metal",
  "brushed-metal": "Brushed Metal",
  chrome: "Chrome",
  glass: "Glass",
  "frosted-glass": "Frosted Glass",
  water: "Water",
  plastic: "Plastic",
  "glossy-paint": "Glossy Paint",
  fabric: "Fabric",
  foliage: "Foliage",
  emissive: "Light Panel",
};

export interface RenderSettings {
  readonly environment: {
    readonly sky: SkyKind;
    /** the gradient's top and the "color" sky's colour, CSS */
    readonly zenith: string;
    readonly horizon: string;
    /** below the horizon (the sky's lower half), CSS */
    readonly ground: string;
    /** multiplies the sky's light */
    readonly intensity: number;
    /** haze of the physical sky: 2 clear .. 10 hazy */
    readonly turbidity: number;
    /** the sky shows behind the model (else a flat horizon colour) */
    readonly visible: boolean;
    /** a ground plane under the model that takes its shadows */
    readonly groundPlane: boolean;
    readonly groundColor: string;
    /** 0 matte .. 1 a mirror: a polished floor or a wet street */
    readonly groundGloss: number;
  };
  readonly sun: {
    readonly on: boolean;
    /** 1 = the usual */
    readonly intensity: number;
    /** 0 crisp .. 1 soft shadow edges (the sun's width, to the path tracer) */
    readonly softness: number;
  };
  /** the drawing's light objects; haze 0 none .. 1 thick shows their spots as beams in the air (Realistic) */
  readonly lights: { readonly on: boolean; readonly intensity: number; readonly haze: number };
  /** exposure in stops, 0 as it is */
  readonly exposure: number;
  readonly toneMap: ToneMap;
  readonly fog: {
    readonly on: boolean;
    readonly color: string;
    /** metres at which fog hides 95 % of what lies behind it */
    readonly distance: number;
    /** metres over which fog thins to a third going up (0: the same at every height) */
    readonly height: number;
    /** metres above the model's lowest point where it is thickest */
    readonly base: number;
    /** glow toward the sun, 0..1 */
    readonly glow: number;
  };
  readonly camera: {
    /** vertical lines stay vertical (two-point perspective, a shifted lens) */
    readonly twoPoint: boolean;
    readonly dof: boolean;
    readonly fStop: number;
    /** widens the aperture: 1 as a real lens at the f-stop, more for the blur a real lens gives only up close */
    readonly blurScale: number;
    /** metres from the eye to what is sharp; 0: the point the view orbits */
    readonly focus: number;
  };
  readonly effects: {
    /** ambient occlusion, 0..1 (Realistic) */
    readonly ao: number;
    /** screen-space reflections of the model in shiny faces, 0..1 (Realistic; the path tracer's are exact) */
    readonly reflections: number;
    readonly bloom: number;
    /** the brightness, after exposure, above which a pixel glows (1: brighter than white) */
    readonly bloomThreshold: number;
    /** 0 a tight glow .. 1 a wide one */
    readonly bloomSize: number;
    readonly vignette: number;
    /** colour fringes toward the picture's edges, 0..1 */
    readonly aberration: number;
    /** film grain, 0..1 */
    readonly grain: number;
    /** 0..1 */
    readonly sharpen: number;
    /** -1..1, 0 as it is */
    readonly contrast: number;
    readonly saturation: number;
    /** white balance: -1 cool (blue) .. 1 warm (amber) */
    readonly temperature: number;
    /** -1 green .. 1 magenta */
    readonly tint: number;
    /** -1..1: darkens or lifts the brightest tones, then the darkest */
    readonly highlights: number;
    readonly shadows: number;
    /** ink lines along edges and creases, 0..1 */
    readonly outlines: number;
    readonly outlineColor: string;
  };
  /** every face in one matte colour (glass stays glass, light panels glow): a massing or clay model */
  readonly clay: { readonly on: boolean; readonly color: string };
  readonly quality: {
    /** samples a Path Traced view refines to, then stops */
    readonly previewSamples: number;
    /** light bounces the path tracer follows */
    readonly bounces: number;
    readonly denoise: boolean;
  };
  /** each material's finish, by materialKey */
  readonly materials: Readonly<Record<string, MaterialOverride>>;
}

export const DEFAULT_RENDER: RenderSettings = {
  environment: {
    sky: "physical",
    zenith: "#5a8fd6",
    horizon: "#dfe8f2",
    ground: "#6f6a62",
    intensity: 1,
    turbidity: 3,
    visible: true,
    groundPlane: true,
    groundColor: "#9a968e",
    groundGloss: 0,
  },
  sun: { on: true, intensity: 1, softness: 0.3 },
  lights: { on: true, intensity: 1, haze: 0 },
  exposure: 0,
  toneMap: "agx",
  fog: { on: false, color: "#c9d3dd", distance: 400, height: 30, base: 0, glow: 0.3 },
  camera: { twoPoint: false, dof: false, fStop: 5.6, blurScale: 1, focus: 0 },
  effects: {
    ao: 0.6,
    reflections: 1,
    bloom: 0.15,
    bloomThreshold: 1,
    bloomSize: 0.4,
    vignette: 0.2,
    aberration: 0,
    grain: 0,
    sharpen: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    outlines: 0,
    outlineColor: "#24262b",
  },
  clay: { on: false, color: "#ecebe7" },
  quality: { previewSamples: 256, bounces: 5, denoise: true },
  materials: {},
};

/** The effects a look sets: the grading, the lens's and the glow's; the rest are left as they are. */
type LookFields = Pick<
  RenderSettings["effects"],
  "bloom" | "vignette" | "aberration" | "grain" | "sharpen" | "contrast" | "saturation" | "temperature" | "tint" | "highlights" | "shadows"
>;

export interface Look {
  readonly id: string;
  readonly label: string;
  readonly effects: LookFields;
}

const NATURAL: LookFields = {
  bloom: 0.15,
  vignette: 0.2,
  aberration: 0,
  grain: 0,
  sharpen: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
};

/** The looks the palette offers: each a set of the grading and lens effects. */
export const LOOKS: readonly Look[] = [
  { id: "natural", label: "Natural", effects: NATURAL },
  { id: "crisp", label: "Crisp", effects: { ...NATURAL, sharpen: 0.45, contrast: 0.12, saturation: 0.08, highlights: -0.15, vignette: 0.1 } },
  { id: "warm", label: "Warm afternoon", effects: { ...NATURAL, temperature: 0.35, contrast: 0.08, saturation: 0.12, bloom: 0.25, shadows: 0.1 } },
  { id: "cool", label: "Cool morning", effects: { ...NATURAL, temperature: -0.3, tint: -0.05, contrast: 0.05, saturation: -0.05, highlights: -0.1 } },
  { id: "soft", label: "Soft and airy", effects: { ...NATURAL, contrast: -0.15, highlights: -0.3, shadows: 0.35, bloom: 0.35, saturation: -0.08, vignette: 0 } },
  { id: "moody", label: "Moody", effects: { ...NATURAL, contrast: 0.25, saturation: -0.3, temperature: -0.1, shadows: -0.2, vignette: 0.55, grain: 0.15 } },
  { id: "film", label: "Film", effects: { ...NATURAL, grain: 0.35, aberration: 0.25, vignette: 0.4, highlights: -0.25, temperature: 0.12, contrast: 0.1, bloom: 0.3 } },
  { id: "mono", label: "Black and white", effects: { ...NATURAL, saturation: -1, contrast: 0.2, grain: 0.2, vignette: 0.3 } },
];

/** The look the effects match exactly, or null (the palette's "Custom"). */
export function lookOf(effects: RenderSettings["effects"]): Look | null {
  return LOOKS.find((look) => (Object.keys(look.effects) as (keyof LookFields)[]).every((k) => look.effects[k] === effects[k])) ?? null;
}

/** The effects with `look`'s fields in place of theirs. */
export function withLook(effects: RenderSettings["effects"], look: Look): RenderSettings["effects"] {
  return { ...effects, ...look.effects };
}

/**
 * The key a material's finish is kept under: its texture's name when it has one (so every object
 * with that texture shares it), else its colour and opacity.
 */
export function materialKey(face: Pick<ModelFace, "texture" | "resource" | "color" | "opacity">): string {
  if (face.texture >= 0 && face.resource) return `tex:${face.resource.name}`;
  return `col:${face.color.toLowerCase()}|${Math.round(face.opacity * 100)}`;
}

/** What the palette calls a material: its texture's name, or its colour (and opacity when see-through). */
export function materialLabel(face: Pick<ModelFace, "texture" | "resource" | "color" | "opacity">): string {
  if (face.texture >= 0 && face.resource) return face.resource.name;
  const pct = Math.round(face.opacity * 100);
  return pct < 100 ? `${face.color.toLowerCase()} at ${pct} %` : face.color.toLowerCase();
}

// ---- the store ----------------------------------------------------------------

const KEY_PREFIX = "openvwx.render.v1:";

let current: RenderSettings = DEFAULT_RENDER;
let loadedFor: string | null = null;
const listeners = new Set<(s: RenderSettings) => void>();

/** The open drawing's render settings. */
export function renderSettings(): RenderSettings {
  syncWithDrawing();
  return current;
}

/** Changes some sections (a section given replaces that one whole: spread the old one in). */
export function setRender(patch: Partial<RenderSettings>): void {
  syncWithDrawing();
  current = { ...current, ...patch };
  save();
  for (const fn of listeners) fn(current);
}

/** Changes some fields of one section. */
export function patchRender<K extends Exclude<keyof RenderSettings, "materials" | "exposure" | "toneMap">>(section: K, patch: Partial<RenderSettings[K]>): void {
  setRender({ [section]: { ...renderSettings()[section], ...patch } } as Partial<RenderSettings>);
}

/** Sets one material's finish (null: back to "auto"). */
export function setMaterial(key: string, override: MaterialOverride | null): void {
  const materials = { ...renderSettings().materials };
  if (override) materials[key] = override;
  else delete materials[key];
  setRender({ materials });
}

/** Calls `fn` with the settings after each change (and when another drawing opens); returns a function that stops it. */
export function onRender(fn: (s: RenderSettings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Back to the defaults, materials included. */
export function resetRender(): void {
  setRender(DEFAULT_RENDER);
}

/** Takes up the settings kept for the open drawing when another one has opened. */
function syncWithDrawing(): void {
  const name = store.session ? store.fileName : null;
  if (name === loadedFor) return;
  loadedFor = name;
  current = name ? load(name) : DEFAULT_RENDER;
}

function load(name: string): RenderSettings {
  try {
    return completeSettings(JSON.parse(localStorage.getItem(KEY_PREFIX + name) ?? "null"));
  } catch {
    return DEFAULT_RENDER;
  }
}

/**
 * Settings kept or sent by any version, made whole: section by section over the defaults, so ones
 * from an older version gain the fields added since and a value of the wrong type takes the default.
 */
export function completeSettings(raw: unknown): RenderSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_RENDER;
  const out: Record<string, unknown> = { ...DEFAULT_RENDER };
  for (const [k, def] of Object.entries(DEFAULT_RENDER)) {
    const v = (raw as Record<string, unknown>)[k];
    if (v === undefined) continue;
    out[k] = def && typeof def === "object" && v && typeof v === "object" ? mergeSection(def as Record<string, unknown>, v as Record<string, unknown>, k === "materials") : typeof v === typeof def ? v : def;
  }
  return out as unknown as RenderSettings;
}

/** A section over its defaults, field by field (materials: every key kept, they have no defaults). */
function mergeSection(def: Record<string, unknown>, v: Record<string, unknown>, open: boolean): Record<string, unknown> {
  if (open) return { ...v };
  const out: Record<string, unknown> = { ...def };
  for (const [k, d] of Object.entries(def)) if (typeof v[k] === typeof d) out[k] = v[k];
  return out;
}

function save(): void {
  if (!loadedFor) return;
  try {
    localStorage.setItem(KEY_PREFIX + loadedFor, JSON.stringify(current));
  } catch {
    // private windows and full storage: the settings last this session
  }
}

store.on("session", () => {
  const before = loadedFor;
  syncWithDrawing();
  if (loadedFor !== before) for (const fn of listeners) fn(current);
});
