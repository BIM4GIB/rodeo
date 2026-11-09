// A plug-in's render engine (openvwx.render.engine) as Render Image takes it (render/engines.ts):
// its spec checked, as nothing a plug-in sends is trusted; each picture asked of its worker with
// the job as plain data (the built-in picture's bytes, or the model as binary glTF), and what comes
// back checked to be pictures. A plug-in that fails says so in Render Image; it isn't reported as a
// fault of Rodeo's. Cancel stops waiting; the plug-in's own work runs on to its end.

import { EngineRefusal, type EngineOption, type EngineOutput, type EngineRequest, type RenderEngine } from "../render/engines.ts";
import type { PluginWorker } from "./worker.ts";

const MAX_NAME = 60;
const MAX_TEXT = 200;
const MAX_OPTIONS = 12;
const MAX_CHOICES = 40;
const MAX_PICTURES = 8;
/** the most one picture a plug-in returns may take */
const MAX_PICTURE_BYTES = 64 * 1024 * 1024;
const PICTURE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/webp"]);
const KINDS: ReadonlySet<string> = new Set(["choice", "text", "number", "check"]);

/** What a plug-in's engine is given for one picture: the engine request as plain data. */
export interface PluginJob {
  readonly width: number;
  readonly height: number;
  readonly name: string;
  readonly camera: EngineRequest["camera"];
  readonly sun: EngineRequest["sun"];
  readonly options: EngineRequest["options"];
  /** the built-in picture's bytes and type (an engine that takes a picture) */
  readonly picture: Uint8Array | null;
  readonly pictureType: string | null;
  /** the visible design layers as binary glTF, y up in metres (an engine that takes the scene) */
  readonly scene: Uint8Array | null;
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** One field of a plug-in's spec, checked; null when it can't be shown. */
function optionOf(raw: unknown): EngineOption | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = text(o.key, 40);
  const label = text(o.label, MAX_NAME) || key;
  const kind = typeof o.kind === "string" && KINDS.has(o.kind) ? (o.kind as EngineOption["kind"]) : null;
  if (!key || !kind) return null;
  const initial = o.initial ?? o.default;
  const base = { key, label, kind, ...(text(o.hint, MAX_TEXT) ? { hint: text(o.hint, MAX_TEXT) } : {}) };
  switch (kind) {
    case "choice": {
      const choices = (Array.isArray(o.choices) ? o.choices : [])
        .slice(0, MAX_CHOICES)
        .map((c): [string, string] | null => {
          if (typeof c === "string") return [c, c];
          if (Array.isArray(c) && typeof c[0] === "string") return [c[0], text(c[1], MAX_NAME) || c[0]];
          return null;
        })
        .filter((c): c is [string, string] => c !== null);
      if (choices.length === 0) return null;
      return { ...base, choices, initial: choices.some(([v]) => v === initial) ? (initial as string) : choices[0][0] };
    }
    case "text":
      return { ...base, initial: typeof initial === "string" ? initial : "", max: Math.min(2000, num(o.max) ?? 500), ...(text(o.placeholder, MAX_TEXT) ? { placeholder: text(o.placeholder, MAX_TEXT) } : {}) };
    case "number": {
      const min = num(o.min);
      const max = num(o.max);
      const start = num(initial) ?? min ?? 0;
      return { ...base, initial: start, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    }
    case "check":
      return { ...base, initial: initial === true };
  }
}

/**
 * The render engine plug-in `pluginName` described with `spec` and serves from `worker()` as engine
 * `localId`, or why the spec can't be one.
 */
export function pluginEngine(pluginId: string, pluginName: string, localId: string, spec: unknown, worker: () => PluginWorker | null): RenderEngine | string {
  if (!spec || typeof spec !== "object") return "its render engine has no spec";
  const s = spec as Record<string, unknown>;
  const name = text(s.name, MAX_NAME);
  if (!name) return "its render engine has no name";
  const takes = s.takes === "scene" ? "scene" : "picture";
  const options = (Array.isArray(s.options) ? s.options : []).slice(0, MAX_OPTIONS).map(optionOf).filter((o): o is EngineOption => o !== null);
  const maxSide = num(s.maxSide);
  const blurb = text(s.description, MAX_TEXT);
  return {
    id: `plugin:${pluginId}:${localId}`,
    label: `${name} · plug-in`,
    short: text(s.short, 24) || name,
    takes,
    from: "plug-in",
    options,
    ...(maxSide !== undefined && maxSide >= 64 ? { maxSide: Math.min(8192, Math.round(maxSide)) } : {}),
    unavailable: () => (worker()?.alive ? null : `${pluginName} isn't running`),
    ...(blurb ? { describe: () => `${blurb} From the plug-in ${pluginName}.` } : { describe: () => `From the plug-in ${pluginName}.` }),
    async render(req: EngineRequest): Promise<readonly EngineOutput[]> {
      const w = worker();
      if (!w?.alive) throw new EngineRefusal(`${pluginName} isn't running: turn it on again in the Plug-in Manager.`);
      req.progress(`${req.name} · ${name}…`, null);
      const job: PluginJob = {
        width: req.width,
        height: req.height,
        name: req.name,
        camera: req.camera,
        sun: req.sun,
        options: req.options,
        picture: req.picture ? new Uint8Array(await req.picture.arrayBuffer()) : null,
        pictureType: req.picture?.type ?? null,
        scene: takes === "scene" ? await req.scene() : null,
      };
      const stopped = new Promise<null>((done) => req.signal.addEventListener("abort", () => done(null), { once: true }));
      const outcome = await Promise.race([w.render(localId, job), stopped]);
      if (!outcome) return [];
      if (!outcome.ok) throw new EngineRefusal(`${pluginName}${outcome.error.line ? `, line ${outcome.error.line}` : ""}: ${outcome.error.message}`);
      return picturesOf(outcome.value, pluginName);
    },
  };
}

/** What the worker sent back, checked to be pictures. */
function picturesOf(value: unknown, pluginName: string): EngineOutput[] {
  if (!Array.isArray(value) || value.length === 0) throw new EngineRefusal(`${pluginName} returned no picture.`);
  return value.slice(0, MAX_PICTURES).map((p) => {
    const o = (p ?? {}) as { bytes?: unknown; type?: unknown; note?: unknown };
    if (!(o.bytes instanceof Uint8Array) || o.bytes.length === 0) throw new EngineRefusal(`${pluginName} returned a picture with no bytes.`);
    if (o.bytes.length > MAX_PICTURE_BYTES) throw new EngineRefusal(`${pluginName} returned a picture larger than 64 MB.`);
    const type = typeof o.type === "string" && PICTURE_TYPES.has(o.type) ? o.type : null;
    if (!type) throw new EngineRefusal(`${pluginName} returned a picture that isn't a PNG, JPEG or WebP.`);
    const note = text(o.note, MAX_NAME);
    return { blob: new Blob([o.bytes as Uint8Array<ArrayBuffer>], { type }), ...(note ? { note } : {}) };
  });
}
