// Spotlight's scenes (Stage > Visualization > Manage Scenes… and Animate Scenes…): a scene keeps every
// lighting device's colour, place, height and focus with each channel's level, under a name and number with
// an Up Time and Down Time. Going to a scene puts them back; a movie fades from one scene to another, each
// channel rising over the end scene's Up Time and falling over its Down Time, in a straight line as a
// console's timed fade runs. Pure: manageScenes.ts and animateScenes.ts show and play them.

import type { FixtureEdit, Fixture, FocusPoint } from "../fixture.ts";

/** the show data key the scenes are kept under (show.ts) */
export const LIGHT_SCENES_KEY = "lightScenes";

/** the longest Up or Down Time, seconds */
export const MAX_FADE_S = 999;

/** One lighting device as a scene keeps it. */
export interface DeviceState {
  readonly id: string;
  /** its hanging point in plan */
  readonly x: number;
  readonly y: number;
  readonly heightMm: number;
  readonly aimDeg: number;
  readonly focus: FocusPoint | null;
  readonly color: string;
}

export interface LightScene {
  readonly name: string;
  /** as a cue is numbered: "1", "2.5" */
  readonly number: string;
  readonly upS: number;
  readonly downS: number;
  /** each channel's level, 0 to 1; null when no look was shown (every channel at full) */
  readonly levels: Readonly<Record<string, number>> | null;
  readonly devices: readonly DeviceState[];
}

export function deviceStateOf(f: Fixture): DeviceState {
  return { id: f.id, x: f.at.x, y: f.at.y, heightMm: f.heightMm, aimDeg: f.aimDeg, focus: f.focus, color: f.color };
}

/** What going to `scene` changes on the devices there now; `missing` counts its devices deleted since. */
export interface SceneChanges {
  readonly edits: readonly { readonly id: string; readonly edit: FixtureEdit }[];
  readonly moves: readonly { readonly id: string; readonly dx: number; readonly dy: number }[];
  readonly missing: number;
}

const samePoint = (a: FocusPoint | null, b: FocusPoint | null): boolean => (a === null || b === null ? a === b : a.x === b.x && a.y === b.y && a.z === b.z);

export function sceneChanges(scene: LightScene, now: readonly Fixture[]): SceneChanges {
  const byId = new Map(now.map((f) => [f.id, f]));
  const edits: { id: string; edit: FixtureEdit }[] = [];
  const moves: { id: string; dx: number; dy: number }[] = [];
  let missing = 0;
  for (const d of scene.devices) {
    const f = byId.get(d.id);
    if (!f) {
      missing++;
      continue;
    }
    const edit: { -readonly [K in keyof FixtureEdit]: FixtureEdit[K] } = {};
    if (f.color !== d.color) edit.color = d.color;
    if (f.heightMm !== d.heightMm) edit.heightMm = d.heightMm;
    if (f.aimDeg !== d.aimDeg) edit.aimDeg = d.aimDeg;
    if (!samePoint(f.focus, d.focus)) edit.focus = d.focus;
    if (Object.keys(edit).length) edits.push({ id: d.id, edit });
    const dx = d.x - f.at.x;
    const dy = d.y - f.at.y;
    if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) moves.push({ id: d.id, dx, dy });
  }
  return { edits, moves, missing };
}

/** A channel's level `t` seconds into a fade from `from` to `to`: rising over `upS`, falling over `downS`, none of either at once. */
export function levelAt(from: number, to: number, upS: number, downS: number, t: number): number {
  const time = to > from ? upS : downS;
  if (to === from || time <= 0 || t >= time) return to;
  if (t <= 0) return from;
  return from + ((to - from) * t) / time;
}

/** A scene's level for a channel: its own, off when it leaves the channel out, full when it kept no levels. */
export const sceneLevel = (scene: LightScene, channel: string): number => (scene.levels ? (scene.levels[channel] ?? 0) : 1);

/** Every channel's level `t` seconds into the fade from `start` to `end`, by `end`'s Up and Down Times. */
export function fadeLevels(start: LightScene, end: LightScene, channels: readonly string[], t: number): Map<string, number> {
  return new Map(channels.map((c) => [c, levelAt(sceneLevel(start, c), sceneLevel(end, c), end.upS, end.downS, t)]));
}

/** How long the fade into `end` runs: the longer of its times that some channel uses. */
export function fadeSeconds(start: LightScene, end: LightScene, channels: readonly string[]): number {
  let s = 0;
  for (const c of channels) {
    const a = sceneLevel(start, c);
    const b = sceneLevel(end, c);
    if (b > a) s = Math.max(s, end.upS);
    else if (b < a) s = Math.max(s, end.downS);
  }
  return s;
}

/** The movie: the start held, the fade, the end held, at `fps`; each frame's seconds into the fade (negative while the start holds). */
export function movieTimes(holdStartS: number, fadeS: number, holdEndS: number, fps: number): number[] {
  const total = holdStartS + fadeS + holdEndS;
  const frames = Math.max(1, Math.round(total * fps));
  return Array.from({ length: frames }, (_, i) => i / fps - holdStartS);
}

/** A typed Up or Down Time, seconds, or why it isn't one. */
export function parseSeconds(text: string): number | string {
  const t = text.trim();
  const v = Number(t.replace(",", "."));
  if (!t || !Number.isFinite(v) || v < 0 || v > MAX_FADE_S) return `a time from 0 to ${MAX_FADE_S} seconds`;
  return v;
}

/** Scenes in their saved order, as Vectorworks lists them; read from the show data, whatever it holds. */
export function scenesOf(data: unknown): LightScene[] {
  if (!Array.isArray(data)) return [];
  return data.filter((s): s is LightScene => !!s && typeof s === "object" && typeof (s as LightScene).name === "string" && Array.isArray((s as LightScene).devices));
}
