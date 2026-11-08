// What Render makes, as the Output tab sets it: the shots (the 3D view's current view, one camera or
// every camera), the picture's size, the engine and quality, the time limit, the format, and where it
// is made. Kept between renders in localStorage (the key Render Image used, so its last choices carry
// over), and with each batch render job (batch.ts). The HUD's frame reads the size's shape from here.
// No three.js and no DOM here: this loads with the editor.

import type { CameraInfo } from "../../../core/index.ts";

export type Quality = "draft" | "good" | "high" | "best";
/** this computer's GPU, or the server's cloud renders (cloud.ts) */
export type Where = "local" | "cloud";
export type SizePreset = "hd" | "qhd" | "uhd" | "dci" | "square" | "a4" | "portrait" | "wide";
export type SizeId = SizePreset | "shape" | "custom";
/** the built-in engines: Fast (Realistic) and Photoreal (path traced) */
export type BuiltInEngine = "realistic" | "pathtraced";
/** PNG and JPEG for Render; HDR only for Export HDRI */
export type OutputFormat = "png" | "jpeg" | "hdr";

/** The choices kept between renders (localStorage), and with each batch render job (batch.ts). */
export interface Prefs {
  /** VIEW, ALL, or CAMERA_PREFIX and a camera's id */
  readonly camera: string;
  readonly size: SizeId;
  /** the custom size's sides */
  readonly width: number;
  readonly height: number;
  readonly engine: BuiltInEngine;
  readonly quality: Quality;
  /** minutes a picture may take, 0 for no limit */
  readonly minutes: number;
  readonly denoise: boolean;
  readonly format: OutputFormat;
  readonly where: Where;
  /** "" for the built-in engine alone, else the id of the engine of engines.ts that makes the pictures */
  readonly via: string;
  /** each such engine's fields as last chosen, by its id */
  readonly options: Readonly<Record<string, Readonly<Record<string, string | number | boolean>>>>;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export type SizeCheck = { readonly size: Size } | { readonly error: string };

export const PREFS_KEY = "openvwx.renderImage.v1";
export const VIEW = "view";
export const ALL = "all";
export const CAMERA_PREFIX = "camera:";
export const MIN_SIDE = 16;
export const MAX_SIDE = 8192;
/** the camera's shape is drawn this wide */
export const SHAPE_WIDTH = 3840;
export const MAX_MINUTES = 600;

export const SIZE_PRESETS: Readonly<Record<SizePreset, { readonly label: string; readonly short: string; readonly width: number; readonly height: number }>> = {
  hd: { label: "HD 1920 × 1080", short: "HD", width: 1920, height: 1080 },
  qhd: { label: "QHD 2560 × 1440", short: "QHD", width: 2560, height: 1440 },
  uhd: { label: "4K UHD 3840 × 2160", short: "4K", width: 3840, height: 2160 },
  dci: { label: "4K DCI 4096 × 2160", short: "4K DCI", width: 4096, height: 2160 },
  wide: { label: "Cinema 21:9 3440 × 1440", short: "21:9", width: 3440, height: 1440 },
  square: { label: "Square 2160 × 2160", short: "Square", width: 2160, height: 2160 },
  portrait: { label: "Portrait 4:5 2160 × 2700", short: "4:5", width: 2160, height: 2700 },
  a4: { label: "A4 at 300 dpi 3508 × 2480", short: "A4", width: 3508, height: 2480 },
};
export const SIZE_PRESET_IDS: readonly SizePreset[] = ["hd", "qhd", "uhd", "dci", "wide", "square", "portrait", "a4"];
export const SIZE_IDS: readonly SizeId[] = [...SIZE_PRESET_IDS, "shape", "custom"];
export const ENGINE_IDS: readonly BuiltInEngine[] = ["realistic", "pathtraced"];
export const ENGINE_LABELS: Readonly<Record<BuiltInEngine, string>> = {
  realistic: "Fast — Realistic",
  pathtraced: "Photoreal — Path traced",
};
export const QUALITY_IDS: readonly Quality[] = ["draft", "good", "high", "best"];
export const QUALITY: Readonly<Record<Quality, { readonly label: string; readonly short: string; readonly samples: number }>> = {
  draft: { label: "Draft — 64 samples", short: "Draft", samples: 64 },
  good: { label: "Good — 256 samples", short: "Good", samples: 256 },
  high: { label: "High — 1024 samples", short: "High", samples: 1024 },
  best: { label: "Best — 4096 samples", short: "Best", samples: 4096 },
};
export const FORMAT_IDS: readonly OutputFormat[] = ["png", "jpeg"];
export const WHERE_IDS: readonly Where[] = ["local", "cloud"];
export const FORMAT_LABELS: Readonly<Record<OutputFormat, string>> = { png: "PNG", jpeg: "JPEG (92 %)", hdr: "Radiance HDR" };

export function defaultPrefs(): Prefs {
  return {
    camera: VIEW,
    size: "uhd",
    width: 1920,
    height: 1080,
    engine: "pathtraced",
    quality: "good",
    minutes: 0,
    denoise: true,
    format: "png",
    where: "local",
    via: "",
    options: {},
  };
}

/** A picture side the Output tab and the job accept: a whole number of pixels. */
export function isSide(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_SIDE && v <= MAX_SIDE;
}

export function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((o) => o === value) ?? fallback;
}

/** Choices as read back from storage, over `defaults`; anything unreadable or out of range falls back. */
export function prefsFrom(parsed: unknown, defaults: Prefs = defaultPrefs()): Prefs {
  const raw: Record<string, unknown> = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return {
    camera: typeof raw.camera === "string" ? raw.camera : defaults.camera,
    size: pick<SizeId>(raw.size, SIZE_IDS, defaults.size),
    width: isSide(raw.width) ? raw.width : defaults.width,
    height: isSide(raw.height) ? raw.height : defaults.height,
    engine: pick<BuiltInEngine>(raw.engine, ENGINE_IDS, defaults.engine),
    quality: pick<Quality>(raw.quality, QUALITY_IDS, defaults.quality),
    minutes: typeof raw.minutes === "number" && raw.minutes >= 0 && raw.minutes <= MAX_MINUTES ? raw.minutes : defaults.minutes,
    denoise: typeof raw.denoise === "boolean" ? raw.denoise : defaults.denoise,
    format: pick<OutputFormat>(raw.format, [...FORMAT_IDS, "hdr"], defaults.format),
    where: pick<Where>(raw.where, WHERE_IDS, defaults.where),
    via: typeof raw.via === "string" ? raw.via : defaults.via,
    options: optionsFrom(raw.options) ?? defaults.options,
  };
}

/** Engines' kept fields: an object of objects (each engine checks its own values when it reads them). */
function optionsFrom(v: unknown): Prefs["options"] | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, Record<string, string | number | boolean>> = {};
  for (const [id, values] of Object.entries(v)) if (typeof values === "object" && values !== null && !Array.isArray(values)) out[id] = values as Record<string, string | number | boolean>;
  return out;
}

/** The choices kept under `key`, over `defaults`. */
export function readPrefs(key = PREFS_KEY, defaults: Prefs = defaultPrefs()): Prefs {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    // storage blocked or not JSON: the defaults
  }
  return prefsFrom(parsed, defaults);
}

export function savePrefs(prefs: Prefs, key = PREFS_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // private windows and full storage: the choices last this session
  }
}

// ---- the Output tab's choices, live --------------------------------------------

let current: Prefs | null = null;
const listeners = new Set<(p: Prefs) => void>();

/** Render's choices as they stand (the last render's when the editor started). */
export function outputPrefs(): Prefs {
  current ??= readPrefs();
  return current;
}

/** Changes some of Render's choices, keeps them and tells the listeners. */
export function setOutput(patch: Partial<Prefs>): void {
  current = { ...outputPrefs(), ...patch };
  savePrefs(current);
  for (const fn of listeners) fn(current);
}

/** Calls `fn` after each change of Render's choices; returns a function that stops it. */
export function onOutput(fn: (p: Prefs) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The one camera `prefs.camera` names, or null (the current view, every camera, or a camera the drawing no longer has). */
export function chosenCamera(prefs: Pick<Prefs, "camera">, cams: readonly CameraInfo[]): CameraInfo | null {
  return cams.find((c) => CAMERA_PREFIX + c.id === prefs.camera) ?? null;
}

/** The picture's size `prefs` gives, or why it can't be made. */
export function sizeOf(prefs: Pick<Prefs, "size" | "width" | "height" | "camera">, cams: readonly CameraInfo[]): SizeCheck {
  const id = prefs.size;
  if (id === "custom") {
    if (!isSide(prefs.width)) return { error: `Width: a whole number of pixels from ${MIN_SIDE} to ${MAX_SIDE}.` };
    if (!isSide(prefs.height)) return { error: `Height: a whole number of pixels from ${MIN_SIDE} to ${MAX_SIDE}.` };
    return { size: { width: prefs.width, height: prefs.height } };
  }
  if (id === "shape") {
    const cam = chosenCamera(prefs, cams);
    const aspect = cam ? cam.aspect : 0;
    if (!(aspect > 0 && Number.isFinite(aspect))) return { error: "This camera has no shape to match: choose another size." };
    const height = Math.max(2, Math.round(SHAPE_WIDTH / aspect / 2) * 2);
    if (!isSide(height)) return { error: `The camera's shape at 4K is ${height} px high, outside ${MIN_SIDE} to ${MAX_SIDE} px: choose another size.` };
    return { size: { width: SHAPE_WIDTH, height } };
  }
  const p = SIZE_PRESETS[id];
  return { size: { width: p.width, height: p.height } };
}

/** The picture's shape, wide over high, as the HUD's frame draws it (16:9 while the size is not valid). */
export function outputAspect(cams: readonly CameraInfo[]): number {
  const s = sizeOf(outputPrefs(), cams);
  return "size" in s ? s.size.width / s.size.height : 16 / 9;
}

/** Megapixels of a picture, to one decimal place (two below a tenth). */
export function megapixels(width: number, height: number): string {
  const mp = (width * height) / 1e6;
  return mp < 0.1 ? mp.toFixed(2) : mp.toFixed(1);
}

/** "16:9", "4:5", "21:9", or "1.85:1" for a shape with no small whole ratio. */
export function ratioLabel(width: number, height: number): string {
  const r = width / height;
  const known: readonly [number, string][] = [
    [16 / 9, "16:9"],
    [4 / 3, "4:3"],
    [3 / 2, "3:2"],
    [1, "1:1"],
    [4 / 5, "4:5"],
    [9 / 16, "9:16"],
    [21 / 9, "21:9"],
    [43 / 18, "21:9"],
    [256 / 135, "1.9:1"],
    [Math.SQRT2, "A-series"],
  ];
  for (const [v, label] of known) if (Math.abs(r - v) < 0.012) return label;
  return `${r.toFixed(2)}:1`;
}

// ---- the frame: what of the 3D view the picture shows -----------------------------

/** A rectangle in the 3D view, CSS px from its top left corner. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The space Render Studio keeps clear round its frame, CSS px: the HUD's bars above and below, a margin at the sides. */
export const STUDIO_FRAME_PAD = { x: 28, y: 72 } as const;

/**
 * The part of the 3D view a picture `aspect` wide over high shows of its current view: the largest
 * rectangle of that shape in the clear part of the view (`clear`: what palettes cover at its sides),
 * less `pad` all round, centred on the camera's axis (the middle of the clear part). Render takes
 * exactly this (finalRender.ts currentShot), and Render Studio draws it (hud.ts).
 */
export function frameRect(viewWidth: number, viewHeight: number, clear: { left: number; right: number }, aspect: number, pad: { x: number; y: number } = { x: 0, y: 0 }): Rect {
  const clearWidth = Math.max(1, viewWidth - clear.left - clear.right);
  const roomW = Math.max(1, clearWidth - 2 * pad.x);
  const roomH = Math.max(1, viewHeight - 2 * pad.y);
  const width = Math.min(roomW, roomH * aspect);
  const height = width / aspect;
  const cx = clear.left + clearWidth / 2;
  const cy = viewHeight / 2;
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}
