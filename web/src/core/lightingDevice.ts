// A Spotlight lighting device's light. The light object a Vectorworks Lighting Device holds is a stand-in
// that Vectorworks switches on, colours and aims only when it redraws the device, so in a saved drawing it
// is off and points nowhere in particular. Rodeo reads the device's own parameters instead (Light On,
// RGBColor, Brightness, Field Angle, Beam Angle, Pan and Tilt) and writes them when the light is changed.
// Pure: angles are degrees in the parameters and radians in Light3D; a direction here is in the device's
// own frame, where a fixture hung with no tilt shines straight down (-z), Tilt turning the beam about x
// and Pan turning that about z.

import type { RecordValue, Vec3 } from "./types.ts";

/** the plug-in formats Spotlight keeps its lighting devices under (lower case) */
const DEVICE_PLUGINS: ReadonlySet<string> = new Set(["lighting device", "light instrument", "lighting instrument"]);

/** The parameters a device's light is read from and written to. */
export const DEVICE_FIELD = {
  on: "Light On",
  color: "RGBColor",
  brightness: "Brightness",
  field: "Field Angle",
  beam: "Beam Angle",
  pan: "Pan",
  tilt: "Tilt",
  invertPan: "Invert pan",
  invertTilt: "Invert tilt",
  fog: "Lit Fog",
} as const;

const DEG = Math.PI / 180;

export function isLightingDevice(pluginName: string | null | undefined): boolean {
  return !!pluginName && DEVICE_PLUGINS.has(pluginName.toLowerCase());
}

/** A device's light as its parameters say; a part they don't hold (an older format) is left undefined. */
export interface DeviceLight {
  readonly on?: boolean;
  /** #rrggbb */
  readonly color?: string;
  /** 1 = 100 % */
  readonly brightness?: number;
  /** full angles, radians */
  readonly spread?: number;
  readonly beam?: number;
  /** degrees, as the parameters hold them (before Invert) */
  readonly pan: number;
  readonly tilt: number;
  readonly invertPan: boolean;
  readonly invertTilt: boolean;
  /** Lit Fog: the beam shows in haze */
  readonly fog: boolean;
}

/** Reads a device's light from its parameters (its parametric record's fields). */
export function readDeviceLight(fields: readonly { readonly name: string; readonly value: RecordValue }[]): DeviceLight {
  const by = new Map(fields.map((f) => [f.name.toLowerCase(), f.value] as const));
  const get = (name: string): RecordValue | undefined => by.get(name.toLowerCase());
  const num = (name: string): number | undefined => {
    const v = get(name);
    const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number.parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const bool = (name: string): boolean | undefined => {
    const v = get(name);
    return typeof v === "boolean" ? v : undefined;
  };
  const field = num(DEVICE_FIELD.field);
  const beam = num(DEVICE_FIELD.beam);
  const brightness = num(DEVICE_FIELD.brightness);
  const rgb = get(DEVICE_FIELD.color);
  return {
    on: bool(DEVICE_FIELD.on),
    color: typeof rgb === "string" ? (colorOfRgb(rgb) ?? undefined) : undefined,
    brightness: brightness !== undefined && brightness >= 0 ? brightness : undefined,
    spread: field !== undefined && field > 0 ? Math.min(field, 179) * DEG : undefined,
    beam: beam !== undefined && beam > 0 ? Math.min(beam, field ?? beam, 179) * DEG : undefined,
    pan: num(DEVICE_FIELD.pan) ?? 0,
    tilt: num(DEVICE_FIELD.tilt) ?? 0,
    invertPan: bool(DEVICE_FIELD.invertPan) ?? false,
    invertTilt: bool(DEVICE_FIELD.invertTilt) ?? false,
    fog: bool(DEVICE_FIELD.fog) ?? false,
  };
}

/** "65535,32768,0" (16 bits a channel, as RGBColor keeps it) as #rrggbb; null when it doesn't read. */
export function colorOfRgb(text: string): string | null {
  const parts = text.split(",").map((s) => Number(s.trim()));
  if (parts.length !== 3 || !parts.every((n) => Number.isFinite(n) && n >= 0)) return null;
  return `#${parts.map((n) => Math.round(Math.min(n, 65535) / 257).toString(16).padStart(2, "0")).join("")}`;
}

/** #rrggbb as RGBColor keeps it, 16 bits a channel; null when it isn't one. */
export function rgbOfColor(color: string): string | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  return m ? [m[1], m[2], m[3]].map((h) => String(Number.parseInt(h, 16) * 257)).join(",") : null;
}

/** Where a device with this pan and tilt (degrees, Invert applied) shines, in its own frame. */
export function deviceAxis(pan: number, tilt: number): Vec3 {
  const p = pan * DEG;
  const t = tilt * DEG;
  // straight down, tilted about x, then panned about z
  return [-Math.sin(t) * Math.sin(p), Math.sin(t) * Math.cos(p), -Math.cos(t)];
}

/** The pan and tilt (degrees, Invert applied) that shine a device along `dir` in its own frame: tilt 0 to 180, pan -180 to 180. */
export function panTiltFor(dir: Vec3): { pan: number; tilt: number } {
  const n = Math.hypot(...dir);
  if (!(n > 0)) throw new Error("a direction is three numbers, not all 0");
  const [x, y, z] = [dir[0] / n, dir[1] / n, dir[2] / n];
  const tilt = Math.acos(Math.max(-1, Math.min(1, -z))) / DEG;
  // straight down or up, any pan does
  const pan = Math.hypot(x, y) < 1e-9 ? 0 : Math.atan2(-x, y) / DEG;
  return { pan: round(pan), tilt: round(tilt) };
}

/** The device's own-frame beam for its parameters. */
export function axisOf(d: DeviceLight): Vec3 {
  return deviceAxis(d.invertPan ? -d.pan : d.pan, d.invertTilt ? -d.tilt : d.tilt);
}

/** What changes a device's light: a direction is in the device's own frame. Angles are radians, as Light3D has them. */
export interface DeviceLightChange {
  readonly on?: boolean;
  readonly color?: string;
  readonly brightness?: number;
  readonly spread?: number;
  readonly beam?: number;
  readonly direction?: Vec3;
  readonly fog?: boolean;
}

/** The parameters to write for `change` to a device now `now`; throws on a value it can't take. */
export function deviceLightValues(now: DeviceLight, change: DeviceLightChange): Record<string, RecordValue> {
  const out: Record<string, RecordValue> = {};
  if (change.on !== undefined) out[DEVICE_FIELD.on] = change.on;
  if (change.fog !== undefined) out[DEVICE_FIELD.fog] = change.fog;
  if (change.color !== undefined) {
    const rgb = rgbOfColor(change.color);
    if (!rgb) throw new Error("a light's colour is #rrggbb");
    out[DEVICE_FIELD.color] = rgb;
  }
  for (const v of [change.brightness, change.spread, change.beam]) {
    if (v !== undefined && !(Number.isFinite(v) && v >= 0)) throw new Error("a light's brightness and angles are numbers of 0 or more");
  }
  if (change.brightness !== undefined) out[DEVICE_FIELD.brightness] = change.brightness;
  const spread = change.spread ?? now.spread;
  if (change.spread !== undefined) out[DEVICE_FIELD.field] = round(change.spread / DEG);
  // a field narrowed past the beam takes the beam with it, as a light object's spread does
  const beam = change.beam ?? (change.spread !== undefined && now.beam !== undefined && spread !== undefined && now.beam > spread ? spread : undefined);
  if (beam !== undefined) out[DEVICE_FIELD.beam] = round(Math.min(beam, spread ?? beam) / DEG);
  if (change.direction) {
    const { pan, tilt } = panTiltFor(change.direction);
    out[DEVICE_FIELD.pan] = now.invertPan ? -pan : pan;
    out[DEVICE_FIELD.tilt] = now.invertTilt ? -tilt : tilt;
  }
  return out;
}

function round(deg: number): number {
  return Math.round(deg * 1000) / 1000 || 0;
}
