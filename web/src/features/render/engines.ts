// Render engines beyond the two built in (Realistic and Path traced, which still.ts draws): what else
// can make Render Image's pictures. AI (ai.ts) paints a built-in picture as a finished render; a
// plug-in's engine (plugins/host.ts) may hand the picture, or the model and its camera, to another
// renderer — Blender, D5, Enscape or a service — and return what it made. Render Image lists them
// after the built-in ones, with the fields each asks for, and shows what each made beside the
// picture it started from. No three.js or DOM here: the registry loads with the editor.

import type { Vec3 } from "../../core/index.ts";

/** One field an engine asks for in Render Image, under the Engine. */
export interface EngineOption {
  /** what its value is kept under, in the engine's values */
  readonly key: string;
  readonly label: string;
  readonly kind: "choice" | "text" | "number" | "check";
  /** a choice's (value, label) pairs */
  readonly choices?: readonly (readonly [string, string])[];
  readonly initial: string | number | boolean;
  /** a number's range; a text's longest */
  readonly min?: number;
  readonly max?: number;
  readonly placeholder?: string;
  /** a tooltip */
  readonly hint?: string;
  /** shown only while this other field holds one of these values */
  readonly when?: { readonly key: string; readonly is: readonly (string | number | boolean)[] };
}

export type OptionValue = string | number | boolean;
export type OptionValues = Readonly<Record<string, OptionValue>>;

/** Where the picture is seen from: the eye and the point it looks at (world mm, z up), and its lens. */
export interface EngineCamera {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly perspective: boolean;
  /** vertical field of view, degrees (perspective) */
  readonly fov: number;
  /** half the picture's height, mm (orthogonal) */
  readonly halfHeight: number;
}

/** One picture an engine is asked for. */
export interface EngineRequest {
  readonly width: number;
  readonly height: number;
  /** what it shows: "Current view" or a camera's name */
  readonly name: string;
  readonly camera: EngineCamera;
  /** toward the sun, a unit vector (world, z up), or null with the sun off */
  readonly sun: Vec3 | null;
  readonly options: OptionValues;
  /** the built-in picture to start from (an engine that takes a picture), at width × height */
  readonly picture: Blob | null;
  /** the visible design layers as binary glTF, made when first asked for (an engine that takes the scene) */
  scene(): Promise<Uint8Array>;
  /** Cancel in the progress window */
  readonly signal: AbortSignal;
  progress(text: string, fraction: number | null): void;
}

/** A picture an engine made, and what to say of it in the viewer ("Golden hour"). */
export interface EngineOutput {
  readonly blob: Blob;
  readonly note?: string;
}

export interface RenderEngine {
  /** "ai", or "plugin:<plug-in id>:<n>" */
  readonly id: string;
  /** in the Engine list: "AI — painted by an image model" */
  readonly label: string;
  /** in the viewer's line under a picture: "AI" */
  readonly short: string;
  /** "picture": it starts from a built-in picture (Start from asks which); "scene": from the model and the camera */
  readonly takes: "picture" | "scene";
  /** who made it, for the Engine list's groups */
  readonly from: "rodeo" | "plug-in";
  readonly options: readonly EngineOption[];
  /** the longest side of the picture it starts from: a larger one is drawn at this size instead */
  readonly maxSide?: number;
  /** why it can't make pictures here now (not set up, no drawing), or null */
  unavailable(): string | null;
  /** a line under its fields for these values and this many pictures: what they cost, how long they take */
  describe?(values: OptionValues, pictures: number): string;
  /** before the job starts: sign-in, credit; false stops it */
  prepare?(values: OptionValues, pictures: number): Promise<boolean>;
  /** the pictures for one shot (several for variations); none when cancelled */
  render(req: EngineRequest): Promise<readonly EngineOutput[]>;
}

/** An engine's own refusal (not signed in, out of credit, its provider's no): Render Image says it and doesn't report it as a fault. */
export class EngineRefusal extends Error {}

const engines = new Map<string, RenderEngine>();
const listeners = new Set<() => void>();

/** Adds an engine to Render Image (the same id replaces it); the function returned takes it away. */
export function registerRenderEngine(engine: RenderEngine): () => void {
  engines.set(engine.id, engine);
  for (const fn of listeners) fn();
  return () => {
    if (engines.get(engine.id) !== engine) return;
    engines.delete(engine.id);
    for (const fn of listeners) fn();
  };
}

/** The engines beyond the built-in ones: Rodeo's first, then the plug-ins', each in the order added. */
export function renderEngines(): readonly RenderEngine[] {
  const all = [...engines.values()];
  return [...all.filter((e) => e.from === "rodeo"), ...all.filter((e) => e.from === "plug-in")];
}

export function renderEngine(id: string): RenderEngine | undefined {
  return engines.get(id);
}

export function onEngines(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** An engine's values: what was kept for it, each checked against its field, else the field's initial value. */
export function optionValues(engine: RenderEngine, kept: unknown): OptionValues {
  const raw = typeof kept === "object" && kept !== null ? (kept as Record<string, unknown>) : {};
  const out: Record<string, OptionValue> = {};
  for (const o of engine.options) out[o.key] = optionValue(o, raw[o.key]);
  return out;
}

/** `v` as field `o` takes it, or its initial value. */
export function optionValue(o: EngineOption, v: unknown): OptionValue {
  switch (o.kind) {
    case "choice":
      return typeof v === "string" && (o.choices ?? []).some(([c]) => c === v) ? v : o.initial;
    case "text":
      return typeof v === "string" ? v.slice(0, o.max ?? 2000) : o.initial;
    case "number":
      return typeof v === "number" && Number.isFinite(v) && v >= (o.min ?? -Infinity) && v <= (o.max ?? Infinity) ? v : o.initial;
    case "check":
      return typeof v === "boolean" ? v : o.initial;
  }
}
