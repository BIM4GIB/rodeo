// The sun and the sky of a render, in render space (metres, y up): sunState places the sun for the
// Heliodon's place, date and time, and skyTexture paints the environment as an equirectangular HDR
// texture that lights the model and shows behind it. The physical sky is Sky.js's Preetham model
// (three.js's examples) evaluated per texel, without its sun disc: the sun is a light of its own.

import * as THREE from "three";
import type { Viz3D } from "../../app/heliodon.ts";
import { sunPlace } from "../../core/sun.ts";
import type { RenderSettings } from "./settings.ts";
import { dirToRender } from "./space.ts";

export interface SunState {
  /** toward the sun, render space, unit length */
  readonly dir: THREE.Vector3;
  /** degrees above the horizon */
  readonly altitude: number;
  /** above the horizon */
  readonly up: boolean;
  /** its light's colour (linear), warmer near the horizon */
  readonly color: THREE.Color;
}

type Rgb = readonly [number, number, number];

const DEG = Math.PI / 180;
/** the sun sinks this many degrees below the horizon before the sky is all dusk */
const DUSK = 6;
/** how far the sky's blend into the ground runs below the horizon, degrees */
const BLEND = 3;
/**
 * scales the physical sky: a clear noon zenith of about 0.3 in linear luminance, so a level face in
 * the sun (sceneBuilder's SUN_LUX of 3) takes about four times the sky's light, as in daylight
 */
const PHYSICAL_SCALE = 0.28;
/** a physical sky's dusk and night: blue, about 5 % of a clear noon zenith, never black */
const TWILIGHT: Rgb = [0.012, 0.016, 0.028];

// Sky.js's constants (three/examples/jsm/objects/Sky.js), per channel where they are per channel
const TOTAL_RAYLEIGH: Rgb = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5];
const MIE_CONST: Rgb = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14];
/** the earth-shadow cut-off (pi / 1.95) and its steepness, and the sun's strength */
const CUTOFF = 1.6110731556870734;
const STEEPNESS = 1.5;
const SUN_STRENGTH = 1000;
const MIE_COEFFICIENT = 0.005;
const MIE_G = 0.8;
/** the optical lengths of the air at the zenith, metres: molecules and haze */
const RAYLEIGH_LENGTH = 8400;
const MIE_LENGTH = 1250;
const NIGHT: Rgb = [0, 0.0003, 0.00075];

// the studio: grey all round, a darker floor, and three soft boxes seen from the default camera
// (looking along -z, so front is +z and left is -x)
const STUDIO_GREY = 0.6;
const STUDIO_FLOOR = 0.15;
const STUDIO_BOX = 7;
const BOX_INNER = Math.cos(12 * DEG);
const BOX_OUTER = Math.cos(18 * DEG);
const SOFT_BOXES = [directionAt(135, 55), directionAt(0, 50), directionAt(0, 90)];

/** The sun the Visualization palette's Heliodon settings place, as render space sees it. */
export function sunState(viz: Pick<Viz3D, "latitude" | "dayOfYear" | "hour" | "north">, turbidity: number): SunState {
  const place = sunPlace(viz);
  return {
    dir: dirToRender(place.dir.x, place.dir.y, place.dir.z),
    altitude: place.altitude,
    up: place.altitude > 0,
    color: sunColour(place.altitude, turbidity),
  };
}

/**
 * The environment as an equirectangular, linear, RGBA float texture `width` × width/2 (y up,
 * mapping EquirectangularReflectionMapping): the physical sky for the sun (no sun disc: the sun is a
 * light of its own), a gradient, one colour or a studio's soft boxes, times env.intensity. Under a
 * physical sky lies the ground in env.ground, lit by that sky and by `sunLight`, the sun's light
 * on a face square to it (sceneBuilder's), 0 while it is off.
 */
export function skyTexture(env: RenderSettings["environment"], sun: SunState, width = 512, sunLight = 0): THREE.DataTexture {
  const height = Math.max(1, Math.round(width / 2));
  const painter = painterFor(env, sun, sunLight);
  const data = new Float32Array(width * height * 4);

  // per column: the sky at the horizon, and what lies below it, which the rows under it blend from
  const cosPhi = new Float64Array(width);
  const sinPhi = new Float64Array(width);
  const edge = new Float64Array(width * 3);
  const floor = new Float64Array(width * 3);
  const rgb = new Float64Array(3);
  const below = new Float64Array(3);
  for (let i = 0; i < width; i++) {
    const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
    cosPhi[i] = Math.cos(phi);
    sinPhi[i] = Math.sin(phi);
    painter.above(cosPhi[i], 0, sinPhi[i], rgb);
    edge.set(rgb, i * 3);
    painter.below(rgb, below);
    floor.set(below, i * 3);
  }

  for (let j = 0; j < height; j++) {
    const theta = ((j + 0.5) / height - 0.5) * Math.PI;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const drop = theta < 0 ? smoothstep(-theta / (BLEND * DEG)) : 0;
    for (let i = 0; i < width; i++) {
      if (theta >= 0) painter.above(cosTheta * cosPhi[i], sinTheta, cosTheta * sinPhi[i], rgb);
      else for (let c = 0; c < 3; c++) rgb[c] = edge[i * 3 + c] + (floor[i * 3 + c] - edge[i * 3 + c]) * drop;
      const k = (j * width + i) * 4;
      for (let c = 0; c < 3; c++) {
        const v = rgb[c] * env.intensity;
        data[k + c] = v > 0 ? v : 0;
      }
      data[k + 3] = 1;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  // azimuth wraps all the way round, so the seam at the back of the sky must not clamp
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * `sky` (a skyTexture) with the sun in it, for a path tracer: a disc `radius` degrees across, or a
 * texel and a half when that is more (so the texture holds it), whose light on a face square to it
 * is `irradiance` in the sun's colour. Sampled with the sky, the sun lights without the noise of
 * one light among many lamps, and casts shadows as soft as it is wide.
 */
export function skyWithSun(sky: THREE.DataTexture, sun: SunState, irradiance: number, radius: number): THREE.DataTexture {
  const { width, height, data } = sky.image as unknown as { width: number; height: number; data: Float32Array };
  const out = new Float32Array(data);
  if (sun.up && irradiance > 0) {
    const r = Math.max(radius * DEG, (1.5 * Math.PI) / height);
    const cosR = Math.cos(r);
    const texel = ((2 * Math.PI) / width) * (Math.PI / height);
    const { x: sx, y: sy, z: sz } = sun.dir;
    const at: number[] = [];
    const weights: number[] = [];
    let total = 0;
    for (let j = 0; j < height; j++) {
      const theta = ((j + 0.5) / height - 0.5) * Math.PI;
      const cosTheta = Math.cos(theta);
      const sinTheta = Math.sin(theta);
      for (let i = 0; i < width; i++) {
        const phi = ((i + 0.5) / width - 0.5) * 2 * Math.PI;
        const d = cosTheta * Math.cos(phi) * sx + sinTheta * sy + cosTheta * Math.sin(phi) * sz;
        if (d <= cosR) continue;
        // brightest at its centre, fading to nothing at its edge
        const a = Math.acos(Math.min(1, d)) / r;
        const w = 1 - a * a;
        at.push(j * width + i);
        weights.push(w);
        total += w * texel * cosTheta;
      }
    }
    const rgb = [sun.color.r, sun.color.g, sun.color.b];
    for (let n = 0; n < at.length && total > 0; n++) {
      const L = (irradiance * weights[n]) / total;
      for (let c = 0; c < 3; c++) out[at[n] * 4 + c] += L * rgb[c];
    }
  }
  const texture = new THREE.DataTexture(out, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.mapping = sky.mapping;
  texture.colorSpace = sky.colorSpace;
  texture.minFilter = sky.minFilter;
  texture.magFilter = sky.magFilter;
  texture.generateMipmaps = false;
  texture.wrapS = sky.wrapS;
  texture.needsUpdate = true;
  return texture;
}

/** What one kind paints: the sky above the horizon, and the ground below it. Colours are linear, unscaled. */
interface Painter {
  /** the sky in direction (x, y, z), y ≥ 0, into `out` */
  above(x: number, y: number, z: number, out: Float64Array): void;
  /** what lies below the horizon, into `out`, given the sky at the horizon in that direction (`edge`) */
  below(edge: Float64Array, out: Float64Array): void;
}

function painterFor(env: RenderSettings["environment"], sun: SunState, sunLight: number): Painter {
  const zenith = rgbOf(env.zenith);
  const horizon = rgbOf(env.horizon);
  const ground = rgbOf(env.ground);
  if (env.sky === "color") {
    return { above: (_x, _y, _z, out) => fill3(out, zenith), below: (_edge, out) => fill3(out, zenith) };
  }
  if (env.sky === "gradient") {
    return {
      above: (_x, y, _z, out) => {
        const k = Math.sqrt(Math.max(0, y));
        for (let c = 0; c < 3; c++) out[c] = horizon[c] + (zenith[c] - horizon[c]) * k;
      },
      below: (_edge, out) => fill3(out, ground),
    };
  }
  if (env.sky === "studio") {
    return {
      above: (x, y, z, out) => {
        let grey = STUDIO_GREY;
        for (const box of SOFT_BOXES) grey += STUDIO_BOX * softBox(x * box[0] + y * box[1] + z * box[2]);
        out.fill(grey);
      },
      below: (_edge, out) => out.fill(STUDIO_FLOOR),
    };
  }
  return physical(env.turbidity, sun, ground, sunLight);
}

function physical(turbidity: number, sun: SunState, ground: Rgb, sunLight: number): Painter {
  const model = preetham(turbidity, sun.dir);
  // all the sky while the sun is up, then the dusk's blue over DUSK degrees as it sinks
  const day = clamp((sun.altitude + DUSK) / DUSK, 0, 1);
  const above = (x: number, y: number, z: number, out: Float64Array): void => {
    if (day > 0) radiance(model, x, y, z, out);
    else out.fill(0);
    for (let c = 0; c < 3; c++) out[c] = day * PHYSICAL_SCALE * out[c] + (1 - day) * TWILIGHT[c];
  };
  // level ground gives back its colour times the light on it over pi: the sun's at its height, and
  // the sky's, pi times its mean, taken as halfway between the zenith and the horizon below
  const zenith = new Float64Array(3);
  above(0, 1, 0, zenith);
  const sunOnGround = sun.up ? (sunLight * Math.sin(sun.altitude * DEG)) / Math.PI : 0;
  const sunRgb: Rgb = [sun.color.r, sun.color.g, sun.color.b];
  return {
    above,
    below: (edge, out) => {
      for (let c = 0; c < 3; c++) out[c] = ground[c] * ((zenith[c] + edge[c]) / 2 + sunOnGround * sunRgb[c]);
    },
  };
}

/** Sky.js's constants for one sun and haze, worked out once for the whole texture. */
interface Preetham {
  readonly sun: THREE.Vector3;
  /** the sun's strength at its height (Sky.js's sunIntensity) */
  readonly sunE: number;
  /** extinction by air and by haze, per channel (vBetaR and vBetaM) */
  readonly betaR: Rgb;
  readonly betaM: Rgb;
  /** the weight of Sky.js's low-sun term: 1 with the sun on the horizon, 0 overhead */
  readonly lowSun: number;
  /** the exponent of Sky.js's tone curve, which lifts the sky as the sun sinks */
  readonly curve: number;
}

function preetham(turbidity: number, sun: THREE.Vector3): Preetham {
  const haze = clamp((turbidity - 2) / 8, 0, 1);
  // Sky.js's Rayleigh coefficient is 1 to 2, and haze takes some of it away
  const rayleigh = 1.5 - 0.5 * haze;
  // Sky.js fades the Rayleigh term as the sun sinks: its sunfade reads a sun 450000 units out, so exp(sin altitude)
  const fade = 1 - clamp(1 - Math.exp(sun.y), 0, 1);
  const rayleighNow = rayleigh - (1 - fade);
  const mie = 0.434 * 0.2 * turbidity * 1e-17 * MIE_COEFFICIENT;
  return {
    sun,
    sunE: sunIntensity(sun.y),
    betaR: [TOTAL_RAYLEIGH[0] * rayleighNow, TOTAL_RAYLEIGH[1] * rayleighNow, TOTAL_RAYLEIGH[2] * rayleighNow],
    betaM: [MIE_CONST[0] * mie, MIE_CONST[1] * mie, MIE_CONST[2] * mie],
    lowSun: clamp(Math.pow(1 - sun.y, 5), 0, 1),
    curve: 1 / (1.2 + 1.2 * fade),
  };
}

/** Sky.js's sky (linear RGB, without the sun disc) in direction (x, y, z), y ≥ 0, into `out`. */
function radiance(m: Preetham, x: number, y: number, z: number, out: Float64Array): void {
  const cosZenith = Math.max(0, y);
  // the air the ray crosses, bent at the horizon so it stays finite there
  const air = 1 / (cosZenith + 0.15 * Math.pow(93.885 - Math.acos(cosZenith) / DEG, -1.253));
  const cosSun = x * m.sun.x + y * m.sun.y + z * m.sun.z;
  const rayleighPhase = (3 / (16 * Math.PI)) * (1 + (0.5 * cosSun + 0.5) ** 2);
  const g2 = MIE_G * MIE_G;
  const miePhase = (1 - g2) / (4 * Math.PI * Math.pow(1 - 2 * MIE_G * cosSun + g2, 1.5));
  for (let c = 0; c < 3; c++) {
    const betaR = m.betaR[c];
    const betaM = m.betaM[c];
    const fex = Math.exp(-(betaR * RAYLEIGH_LENGTH + betaM * MIE_LENGTH) * air);
    const s = (m.sunE * (betaR * rayleighPhase + betaM * miePhase)) / (betaR + betaM);
    const inscatter = Math.pow(Math.max(0, s * (1 - fex)), 1.5) * (1 - m.lowSun + m.lowSun * Math.pow(Math.max(0, s * fex), 0.5));
    out[c] = Math.pow((inscatter + 0.1 * fex) * 0.04 + NIGHT[c], m.curve);
  }
}

/** Sky.js's sunIntensity: the sun's strength at the cosine of its zenith angle, with the earth's shadow below the horizon. */
function sunIntensity(cosZenith: number): number {
  const angle = Math.acos(clamp(cosZenith, -1, 1));
  return SUN_STRENGTH * Math.max(0, 1 - Math.exp(-((CUTOFF - angle) / STEEPNESS)));
}

/** The sun's light: red-orange on the horizon, near white from 25° up, warmer as the air is hazier. */
function sunColour(altitude: number, turbidity: number): THREE.Color {
  const t = clamp(altitude / 25, 0, 1);
  const haze = clamp((turbidity - 2) / 8, 0, 1);
  const g = lerp(0.45 - 0.05 * haze, 0.96 - 0.03 * haze, t);
  const b = lerp(0.2 - 0.05 * haze, 0.9 - 0.06 * haze, t);
  return new THREE.Color(1, g, b);
}

/** A soft box's brightness at the cosine of its angle from the box's centre: full inside 12°, none beyond 18°. */
function softBox(cosAngle: number): number {
  const t = clamp((cosAngle - BOX_OUTER) / (BOX_INNER - BOX_OUTER), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The unit direction at an azimuth (from +x toward +z, as the texture's columns run) and an elevation, degrees. */
function directionAt(azimuth: number, elevation: number): readonly [number, number, number] {
  const phi = azimuth * DEG;
  const theta = elevation * DEG;
  return [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
}

/** Eases a blend's progress across the horizon, from 0 at the horizon to 1 at BLEND degrees below it. */
function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function rgbOf(css: string): Rgb {
  const c = new THREE.Color(css);
  return [c.r, c.g, c.b];
}

function fill3(out: Float64Array, c: Rgb): void {
  out[0] = c[0];
  out[1] = c[1];
  out[2] = c[2];
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
