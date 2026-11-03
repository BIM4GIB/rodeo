// Checks the sun and the sky under Node. Run from web/:
//   npx tsx src/features/render/sky.check.ts
// Reads the textures back and checks their layout, their values and the equirectangular convention
// three.js samples them with (its equirectUv: u = atan2(z, x) / 2π + ½, v = asin(y) / π + ½, row 0 at
// the bottom). Nothing is drawn.

import * as THREE from "three";
import type { RenderSettings } from "./settings.ts";
import { skyTexture, skyWithSun, sunState, type SunState } from "./sky.ts";

let failures = 0;
function check(ok: boolean, what: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`);
}

const DEG = Math.PI / 180;
type Env = RenderSettings["environment"];
type Kind = Env["sky"];
const BASE: Env = {
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
};
const KINDS: readonly Kind[] = ["physical", "gradient", "color", "studio"];
const JUNE_NOON = { latitude: 51.5, dayOfYear: 172, hour: 12, north: 0 };
const JUNE_MIDNIGHT = { ...JUNE_NOON, hour: 0 };
const W = 512;
const H = W / 2;

type Floats = Float32Array;
const data = (t: THREE.DataTexture): Floats => (t.image as unknown as { data: Floats }).data;
const lum = (r: number, g: number, b: number): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const fmt = (c: THREE.Color): string => `(${c.r.toFixed(3)}, ${c.g.toFixed(3)}, ${c.b.toFixed(3)})`;

/** The texel (column, row) a direction falls in, as three.js's equirectUv puts it. */
function texelOf(x: number, y: number, z: number, w: number, h: number): [number, number] {
  const u = Math.atan2(z, x) / (2 * Math.PI) + 0.5;
  const v = Math.asin(Math.max(-1, Math.min(1, y))) / Math.PI + 0.5;
  return [Math.min(w - 1, Math.floor(u * w)), Math.min(h - 1, Math.floor(v * h))];
}

/** The unit direction of a texel's centre. */
function directionOfTexel(i: number, j: number, w: number, h: number): [number, number, number] {
  const phi = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
  const theta = ((j + 0.5) / h - 0.5) * Math.PI;
  return [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
}

/** The texel's values, as an RGB triple. */
function at(d: Floats, w: number, i: number, j: number): [number, number, number] {
  const k = (j * w + i) * 4;
  return [d[k], d[k + 1], d[k + 2]];
}

/** The average of a row's RGB. */
function rowMean(d: Floats, w: number, j: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < w; i++) {
    const [R, G, B] = at(d, w, i, j);
    r += R;
    g += G;
    b += B;
  }
  return [r / w, g / w, b / w];
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the sun -----------------------------------------------------------------

console.log("sun");
const noon: SunState = sunState(JUNE_NOON, 3);
check(Math.abs(noon.altitude - 62) < 0.5, `21 June noon at latitude 51.5: altitude ${noon.altitude.toFixed(2)}° (about 62°)`);
check(Math.abs(noon.dir.y - Math.sin(noon.altitude * DEG)) < 1e-9, "dir.y is sin(altitude)");
check(Math.abs(noon.dir.length() - 1) < 1e-9, "dir is unit length");
check(Math.abs(noon.dir.x) < 1e-6 && Math.abs(noon.dir.z - Math.cos(noon.altitude * DEG)) < 1e-6, "at noon in June the sun is due south (render +z)");
check(noon.up, "up above the horizon at noon");
check(noon.color.r === 1 && noon.color.g > 0.9 && noon.color.b > 0.85, `near white high up: ${fmt(noon.color)}`);
const night: SunState = sunState(JUNE_MIDNIGHT, 3);
check(!night.up && night.altitude < 0, `midnight is below the horizon (${night.altitude.toFixed(1)}°)`);
check(Math.abs(night.color.g - 0.444) < 0.01 && Math.abs(night.color.b - 0.194) < 0.01, `below the horizon keeps the horizon colour: ${fmt(night.color)}`);

// ---- the convention -----------------------------------------------------------

console.log("texel convention");
{
  const w = 64, h = 32;
  let exact = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const [x, y, z] = directionOfTexel(i, j, w, h);
    const [ti, tj] = texelOf(x, y, z, w, h);
    if (ti === i && tj === j) exact++;
  }
  check(exact === w * h, `every texel's centre direction maps back to its own texel (${exact} of ${w * h})`);

  const rnd = seeded(7);
  const bound = (2 * Math.PI) / W + Math.PI / H;
  let worst = 0;
  for (let n = 0; n < 4000; n++) {
    const z = rnd() * 2 - 1, phi = rnd() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
    const x = s * Math.cos(phi), y = z, zz = s * Math.sin(phi);
    const [i, j] = texelOf(x, y, zz, W, H);
    const [cx, cy, cz] = directionOfTexel(i, j, W, H);
    worst = Math.max(worst, Math.acos(Math.min(1, x * cx + y * cy + zz * cz)));
  }
  check(worst <= bound, `random directions land within a texel of their centre (worst ${(worst / DEG).toFixed(3)}°)`);
}

// ---- layout ---------------------------------------------------------------------

console.log("texture");
const tex = skyTexture(BASE, noon, W);
const img = tex.image as unknown as { data: Floats; width: number; height: number };
check(img.width === W && img.height === H, `${W} × ${H} texels (got ${img.width} × ${img.height})`);
check(img.data instanceof Float32Array && img.data.length === W * H * 4, "Float32Array of RGBA");
check(tex.format === THREE.RGBAFormat && tex.type === THREE.FloatType, "RGBA format, float type");
check(tex.mapping === THREE.EquirectangularReflectionMapping, "equirectangular reflection mapping");
check(tex.colorSpace === THREE.LinearSRGBColorSpace, "linear sRGB colour space");
check(tex.minFilter === THREE.LinearFilter && tex.magFilter === THREE.LinearFilter && tex.generateMipmaps === false, "linear filters, no mipmaps");
check(tex.version > 0, "marked for upload (needsUpdate)");

// ---- values ----------------------------------------------------------------------

console.log("values");
for (const sky of KINDS) {
  for (const [label, sun] of [["noon", noon], ["midnight", night]] as const) {
    const d = data(skyTexture({ ...BASE, sky }, sun, 256));
    let bad = 0, max = 0;
    for (let k = 0; k < d.length; k++) {
      const v = d[k];
      if (!Number.isFinite(v) || v < 0) bad++;
      else if (k % 4 !== 3 && v > max) max = v;
    }
    check(bad === 0, `${sky} at ${label}: every value finite and ≥ 0 (largest ${max.toFixed(2)})`);
  }
}
{
  const a = data(skyTexture({ ...BASE, sky: "studio", intensity: 1 }, noon, 64));
  const b = data(skyTexture({ ...BASE, sky: "studio", intensity: 2.5 }, noon, 64));
  let scaled = true;
  for (let k = 0; k < a.length; k++) if (k % 4 !== 3 && Math.abs(b[k] - 2.5 * a[k]) > 1e-4 * (1 + a[k])) scaled = false;
  check(scaled, "env.intensity multiplies the whole sky");
}

// ---- the physical sky ----------------------------------------------------------

console.log("physical sky");
{
  const d = data(skyTexture(BASE, noon, W));
  const [r, g, b] = rowMean(d, W, H - 1);
  const y = lum(r, g, b);
  check(y >= 0.2 && y <= 0.45, `clear noon zenith is ${y.toFixed(3)} linear (luminance; 0.2 to 0.45)`);
  const dn = data(skyTexture(BASE, night, W));
  const [nr, ng, nb] = rowMean(dn, W, H - 1);
  const ny = lum(nr, ng, nb);
  check(ny < y / 10, `night zenith (${ny.toFixed(3)}) is far darker than noon (${y.toFixed(3)})`);
  check(nb > nr && nb > 0 && nr > 0 && ng > 0, `night is a dim blue, never black: (${nr.toFixed(3)}, ${ng.toFixed(3)}, ${nb.toFixed(3)})`);
  const [br, bg, bb] = rowMean(dn, W, 0);
  check(br > 0 && bg > 0 && bb > 0, "below the horizon at night is not black either");

  // the ground: its colour times the light on it over pi, in the sun much brighter than out of it
  const lit = rowMean(data(skyTexture(BASE, noon, W, 3)), W, 0);
  const shade = rowMean(d, W, 0);
  const gy = lum(lit[0], lit[1], lit[2]);
  check(gy >= 0.05 && gy <= 0.4, `the ground at noon in the sun is ${gy.toFixed(3)} linear (0.05 to 0.4)`);
  check(lum(shade[0], shade[1], shade[2]) < gy / 2, "the ground with the sun off is lit by the sky alone, far less");
}

console.log("the path tracer's sun");
{
  const sky = skyTexture(BASE, noon, W);
  /** what the sun adds, summed as light on a face square to it, per channel */
  const added = (radius: number): number[] => {
    const withSun = skyWithSun(sky, noon, 3, radius);
    const a = data(withSun);
    const b = data(sky);
    const sum = [0, 0, 0];
    const texel = ((2 * Math.PI) / W) * (Math.PI / H);
    for (let j = 0; j < H; j++) {
      const theta = ((j + 0.5) / H - 0.5) * Math.PI;
      for (let i = 0; i < W; i++) {
        const k = (j * W + i) * 4;
        const [x, y, z] = directionOfTexel(i, j, W, H);
        const facing = Math.max(0, x * noon.dir.x + y * noon.dir.y + z * noon.dir.z);
        for (let c = 0; c < 3; c++) sum[c] += (a[k + c] - b[k + c]) * texel * Math.cos(theta) * facing;
      }
    }
    return sum;
  };
  for (const radius of [0.27, 2]) {
    const sum = added(radius);
    const want = [noon.color.r * 3, noon.color.g * 3, noon.color.b * 3];
    const worst = Math.max(...sum.map((v, c) => Math.abs(v / want[c] - 1)));
    check(worst < 0.02, `a sun ${radius}° wide lights a face square to it with 3 in its colour (worst ${(100 * worst).toFixed(2)} % off)`);
  }
  const dark = skyTexture(BASE, night, W);
  const plain = data(dark);
  check(data(skyWithSun(dark, night, 3, 1)).every((v, k) => v === plain[k]), "a sun below the horizon adds nothing");
}

// ---- the gradient --------------------------------------------------------------

console.log("gradient");
{
  const zen = new THREE.Color(BASE.zenith), hor = new THREE.Color(BASE.horizon), gnd = new THREE.Color(BASE.ground);
  const d = data(skyTexture({ ...BASE, sky: "gradient" }, noon, W));
  const want = (theta: number, c: number): number => {
    if (theta >= 0) {
      const hc = [hor.r, hor.g, hor.b][c], zc = [zen.r, zen.g, zen.b][c];
      return hc + (zc - hc) * Math.sqrt(Math.sin(theta));
    }
    const hc = [hor.r, hor.g, hor.b][c], gc = [gnd.r, gnd.g, gnd.b][c];
    return hc + (gc - hc) * smooth(-theta / (3 * DEG));
  };
  let worst = 0;
  for (let j = 0; j < H; j += 7) {
    const theta = ((j + 0.5) / H - 0.5) * Math.PI;
    for (const i of [0, 97, 301]) {
      const got = at(d, W, i, j);
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(got[c] - want(theta, c)));
    }
  }
  check(worst < 1e-4, `rows follow zenith to horizon to ground as the convention places them (worst error ${worst.toExponential(1)})`);
  const top = at(d, W, 0, H - 1), bottom = at(d, W, 0, 0);
  check(Math.abs(top[1] - zen.g) < 0.002, `the top row is the zenith: ${top[1].toFixed(4)} against ${zen.g.toFixed(4)}`);
  check(Math.abs(bottom[1] - gnd.g) < 0.002, `the bottom row is the ground: ${bottom[1].toFixed(4)} against ${gnd.g.toFixed(4)}`);

  // continuous across the horizon: the rows either side of it at a finer size differ by a small step
  const fine = data(skyTexture({ ...BASE, sky: "gradient" }, noon, 2048));
  const fw = 2048, fh = 1024;
  let jump = 0;
  for (let i = 0; i < fw; i += 61) {
    const up = at(fine, fw, i, fh / 2), down = at(fine, fw, i, fh / 2 - 1);
    for (let c = 0; c < 3; c++) jump = Math.max(jump, Math.abs(up[c] - down[c]));
  }
  check(jump < 0.05, `continuous across the horizon: the largest step between the two rows is ${jump.toFixed(4)}`);
}

// ---- colour and studio ---------------------------------------------------------

console.log("colour and studio");
{
  const d = data(skyTexture({ ...BASE, sky: "color" }, noon, 64));
  const zen = new THREE.Color(BASE.zenith);
  let same = true;
  for (let k = 0; k < d.length; k += 4) {
    if (Math.abs(d[k] - zen.r) > 1e-6 || Math.abs(d[k + 1] - zen.g) > 1e-6 || Math.abs(d[k + 2] - zen.b) > 1e-6) same = false;
  }
  check(same, "a colour sky is the zenith colour in every direction");
}
{
  const d = data(skyTexture({ ...BASE, sky: "studio" }, noon, W));
  /** the red of the texel a direction (azimuth from +x toward +z, elevation; degrees) falls in */
  const redAt = (azimuth: number, elevation: number): number => {
    const phi = azimuth * DEG, theta = elevation * DEG;
    const [i, j] = texelOf(Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi), W, H);
    return at(d, W, i, j)[0];
  };
  check(redAt(0, 89) > 5, `the overhead soft box is bright (${redAt(0, 89).toFixed(2)})`);
  check(Math.abs(at(d, W, 0, 0)[0] - 0.15) < 0.002, `the floor is 0.15 (${at(d, W, 0, 0)[0].toFixed(4)})`);
  check(Math.abs(redAt(-90, 10) - 0.6) < 0.01, `away from the boxes it is the 0.6 grey (${redAt(-90, 10).toFixed(3)})`);
  check(redAt(135, 55) > 5, `the front-left soft box is bright (${redAt(135, 55).toFixed(2)})`);
  check(redAt(0, 50) > 5, `the high right soft box is bright (${redAt(0, 50).toFixed(2)})`);
  let soft = 0;
  for (let k = 0; k < d.length; k += 4) if (d[k] > 1 && d[k] < 7) soft++;
  check(soft > 50, `the boxes have soft edges (${soft} texels between the grey and the box)`);
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
