// The lighting tool: the 3D view's light (Visualization) and the renders' (the Render palette), read
// and changed together, with Dark Stage as a preset, and the drawing's light objects switched, coloured,
// dimmed and aimed many at a time. Light objects are weighed against the sun as real lamps are, so a
// model that only sees daylight settings can't make a stage's lights show; this is how it does.

import { setViz, store } from "../../app/state.ts";
import type { Viz3D } from "../../app/heliodon.ts";
import type { EditSession, Light3D, LightChange, Vec3 } from "../../core/index.ts";
import { darkStageOn, setDarkStage } from "../render/darkStage.ts";
import { completeSettings, renderSettings, setRender, type RenderSettings } from "../render/settings.ts";

const DEG = Math.PI / 180;
const SUNS: readonly Viz3D["sun"][] = ["view", "heliodon", "off"];
/** light objects listed by name in what the tool reads, at most */
const LISTED = 40;

export interface LightingArgs {
  readonly preset?: unknown;
  readonly viz?: unknown;
  readonly render?: unknown;
  readonly lights?: unknown;
}

/** Applies what `a` asks (preset first, then viz, render and lights) and reads the lighting as it then is. */
export function lighting(s: EditSession, a: LightingArgs): Record<string, unknown> {
  const done: string[] = [];
  if (a.preset === "dark_stage" || a.preset === "daylight") {
    setDarkStage(a.preset === "dark_stage");
    done.push(a.preset === "dark_stage" ? "Dark Stage: sun off, night sky, exposure +5, haze" : "daylight again: the settings from before Dark Stage");
  } else if (a.preset !== undefined) throw new Error('preset is "dark_stage" or "daylight"');
  if (a.viz !== undefined) done.push(patchViz(a.viz));
  if (a.render !== undefined) done.push(patchRenderSettings(a.render));
  if (a.lights !== undefined) done.push(changeLights(s, a.lights));
  return { ...(done.length ? { done } : {}), ...readLighting(s) };
}

function readLighting(s: EditSession): Record<string, unknown> {
  const v = store.viz3d;
  const r = renderSettings();
  const all = s.doc.lights3d();
  const on = all.filter((l) => l.on);
  return {
    darkStage: darkStageOn(),
    view3d: { projection: v.projection, lens: v.lens, sun: v.sun, ambient: v.ambient, lights: v.lights, haze: v.haze },
    render: { sun: r.sun, environment: r.environment, lights: r.lights, exposure: r.exposure, toneMap: r.toneMap, fog: r.fog, bloom: r.effects.bloom },
    lightObjects: {
      total: all.length,
      on: on.length,
      spots: all.filter((l) => l.kind === "spot").length,
      lightingDevices: all.filter((l) => l.device).length,
      listed: all.slice(0, LISTED).map((l) => ({
        id: l.id,
        ...(l.device ? { device: l.objectId } : {}),
        ...(l.name ? { name: l.name } : {}),
        kind: l.kind,
        on: l.on,
        color: l.color,
        brightness: l.brightness,
        at: l.position.map(Math.round),
        ...(l.kind !== "point" ? { direction: l.direction.map((n) => Math.round(n * 1000) / 1000) } : {}),
        ...(l.kind === "spot" ? { spreadDeg: Math.round(l.spread / DEG), beamDeg: Math.round(l.beam / DEG) } : {}),
      })),
      ...(all.length > LISTED ? { more: `${all.length - LISTED} more: doc lights3d() pages them` } : {}),
    },
  };
}

function patchViz(raw: unknown): string {
  if (!raw || typeof raw !== "object") throw new Error("viz is an object: sun, ambient, lights, haze");
  const p = raw as Record<string, unknown>;
  const patch: { -readonly [K in keyof Viz3D]?: Viz3D[K] } = {};
  if (p.sun !== undefined) {
    if (!SUNS.includes(p.sun as Viz3D["sun"])) throw new Error(`viz.sun is one of ${SUNS.join(", ")}`);
    patch.sun = p.sun as Viz3D["sun"];
  }
  if (p.ambient !== undefined) patch.ambient = clamp(p.ambient, 0, 2, "viz.ambient");
  if (p.haze !== undefined) patch.haze = clamp(p.haze, 0, 1, "viz.haze");
  if (p.lights !== undefined) {
    if (typeof p.lights !== "boolean") throw new Error("viz.lights is true or false");
    patch.lights = p.lights;
  }
  setViz(patch);
  return `3D view: ${Object.keys(patch).join(", ") || "nothing"} set`;
}

/** The Render palette's settings with `raw`'s sections laid over them, field by field. */
function patchRenderSettings(raw: unknown): string {
  if (!raw || typeof raw !== "object") throw new Error("render is an object of the Render palette's sections: sun, environment, lights, exposure, fog, effects, camera");
  const now = renderSettings() as unknown as Record<string, unknown>;
  const p = raw as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...now };
  const unknown: string[] = [];
  for (const [k, v] of Object.entries(p)) {
    if (!(k in now) || k === "materials") {
      unknown.push(k);
      continue;
    }
    const was = now[k];
    merged[k] = was && typeof was === "object" && v && typeof v === "object" ? { ...(was as object), ...(v as object) } : v;
  }
  if (unknown.length) throw new Error(`render has no ${unknown.join(", ")}; its sections are ${Object.keys(now).filter((k) => k !== "materials").join(", ")}`);
  const next: RenderSettings = completeSettings(merged);
  setRender(next);
  return `renders: ${Object.keys(p).join(", ")} set`;
}

/** Switches, colours, dims, widens and aims light objects (ids, or all of them), as one undo step. */
function changeLights(s: EditSession, raw: unknown): string {
  if (!raw || typeof raw !== "object") throw new Error("lights is an object: ids, on, color, brightness, aimAt, spread, beam");
  const p = raw as Record<string, unknown>;
  const all = s.doc.lights3d();
  const wanted = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === "string") : null;
  // a lighting device's own id stands for its light
  const chosen = wanted ? all.filter((l) => wanted.includes(l.id) || (l.device && wanted.includes(l.objectId))) : all;
  if (wanted) {
    const found = new Set(chosen.flatMap((l) => [l.id, l.objectId]));
    const missing = wanted.filter((id) => !found.has(id));
    if (missing.length) throw new Error(`no light object ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` and ${missing.length - 5} more` : ""}: doc lights3d() lists them`);
  }
  if (!chosen.length) throw new Error("the drawing has no light objects");
  const base: LightChange = {};
  if (p.on !== undefined) {
    if (typeof p.on !== "boolean") throw new Error("lights.on is true or false");
    base.on = p.on;
  }
  if (p.color !== undefined) {
    if (typeof p.color !== "string" || !/^#[0-9a-f]{6}$/i.test(p.color)) throw new Error("lights.color is #rrggbb");
    base.color = p.color;
  }
  if (p.brightness !== undefined) base.brightness = clamp(p.brightness, 0, 10, "lights.brightness");
  if (p.spread !== undefined) base.spread = clamp(p.spread, 0.5, 179, "lights.spread") * DEG;
  if (p.beam !== undefined) base.beam = clamp(p.beam, 0.5, 179, "lights.beam") * DEG;
  const aimAt = p.aimAt === undefined ? undefined : point(p.aimAt);
  const aimed = (l: Light3D): Vec3 | undefined => {
    if (!aimAt || l.kind === "point") return undefined;
    const d: Vec3 = [aimAt[0] - l.position[0], aimAt[1] - l.position[1], aimAt[2] - l.position[2]];
    return Math.hypot(...d) > 1 ? d : undefined;
  };
  // the same light twice (by its own id and its device's) is changed once
  const lights = [...new Map(chosen.map((l) => [l.id, l])).values()];
  const skipped = { notSpot: 0, fixed: 0 };
  s.batch(() => {
    for (const l of lights) {
      const change: { -readonly [K in keyof LightChange]: LightChange[K] } = { ...base };
      if (l.kind !== "spot") {
        if (change.spread !== undefined || change.beam !== undefined) skipped.notSpot++;
        delete change.spread;
        delete change.beam;
      }
      const direction = aimed(l);
      if (direction) change.direction = direction;
      // a light a plug-in other than a lighting device places, or one in a symbol, doesn't change here
      if (l.placedBy !== "drawing" && !l.device) {
        skipped.fixed++;
        continue;
      }
      if (Object.keys(change).length) s.setLight(l.id, change);
    }
  });
  const notes = [
    skipped.fixed ? `${skipped.fixed} left as they are: in symbols (change them in Edit Symbol) or placed by plug-ins other than lighting devices` : "",
    skipped.notSpot ? `${skipped.notSpot} aren't spots, so took no spread or beam` : "",
  ].filter(Boolean);
  return `${lights.length - skipped.fixed} light object${lights.length - skipped.fixed === 1 ? "" : "s"} changed${notes.length ? ` (${notes.join("; ")})` : ""}`;
}

function clamp(v: unknown, lo: number, hi: number, name: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${name} is a number, ${lo} to ${hi}`);
  return Math.min(hi, Math.max(lo, v));
}

function point(v: unknown): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === "number" && Number.isFinite(x))) throw new Error("lights.aimAt is [x, y, z], world mm");
  return [v[0], v[1], v[2]];
}
