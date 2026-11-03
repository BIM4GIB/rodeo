// Beams in haze: each spot light drawn as a glowing cone from its lamp, so a stage's lights read in the
// air and not only where they land (on a black deck, hardly at all). A beam is added onto the picture:
// it hides nothing, casts nothing and is never picked. It is brightest near the lamp and down its
// middle, as a beam seen through haze is, and fades toward its edges and its far end. A narrow beam in
// a wide field (a beam angle well inside the field angle) is a bright core in a faint halo. The 3D view
// and the Realistic render both draw them, each in its own space: `unit` says what a unit is in metres.
// A beam ends where its axis first meets the model (surfaceReaches), else where it leaves the model's box.

import * as THREE from "three";

/** A spot as a beam: where it is and points (scene units), its full angles (radians), colour and strength. */
export interface BeamLight {
  readonly at: THREE.Vector3;
  readonly aim: THREE.Vector3;
  readonly spread: number;
  readonly beam: number;
  readonly color: string;
  /** the lamp's candela at 1 m in the scene's light units, haze already in it */
  readonly strength: number;
  /** how far it shines before it meets something (scene units); else to the edge of the box */
  readonly reach?: number | null;
}

/** how bright a beam is against what its lamp lights: haze 1 at about this fraction */
const SCATTER = 0.03;
/** a beam this much narrower than its field is a core in a halo; the halo is this bright beside it */
const CORE_RATIO = 0.6;
const HALO = 0.05;
/** metres from the lamp at which a beam's brightness halves (it doesn't climb without bound at the lens) */
const NEAR = 0.5;
/** a beam's shortest reach, metres */
const MIN_REACH = 1;
/** what lies this near the lamp along its axis (mm: its own lens, the bar it hangs from) doesn't stop the beam */
const NEAR_MISS = 300;
const SEGMENTS = 40;

const VERTEX = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uApex;
uniform vec3 uAxis;
uniform float uLength;
uniform float uUnit;
uniform float uNear;
uniform bool uOrtho;
uniform vec3 uViewDir;
varying vec3 vWorld;
varying vec3 vNormal;

void main() {
  vec3 toEye = uOrtho ? -uViewDir : normalize(cameraPosition - vWorld);
  // looking through the beam's middle its surface faces the eye; at its edges it is seen edge on
  float facing = abs(dot(normalize(vNormal), toEye));
  float along = max(dot(vWorld - uApex, uAxis), 0.0);
  float fade = 1.0 - smoothstep(0.55, 1.0, along / uLength);
  float near = uNear / (uNear + along * uUnit);
  gl_FragColor = vec4(uColor * facing * facing * fade * near, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/**
 * The beams of `lights` as a group of cones, each reaching where its axis leaves `box` (the model's
 * box, scene units), so a beam ends at the floor or beyond the set; `unit` is metres a scene unit.
 * `haze` 0 .. 1 is how thick the air is.
 */
export function beamGroup(lights: readonly BeamLight[], box: THREE.Box3, unit: number, haze: number): THREE.Group {
  const group = new THREE.Group();
  group.name = "beams";
  if (!(haze > 0)) return group;
  for (const l of lights) {
    if (!(l.strength > 0) || !(l.spread > 0)) continue;
    const aim = l.aim.clone().normalize();
    const reach = Math.max(l.reach ?? boxReach(l.at, aim, box), MIN_REACH / unit);
    const beam = Math.min(l.beam > 0 ? l.beam : l.spread, l.spread);
    const strength = l.strength * haze * SCATTER;
    // a narrow beam in a wide field: a core, and a faint halo round it
    const cones = beam < l.spread * CORE_RATIO ? [{ angle: beam, weight: 1 }, { angle: l.spread, weight: HALO }] : [{ angle: (beam + l.spread) / 2, weight: 1 }];
    for (const { angle, weight } of cones) group.add(cone(l.at, aim, angle, reach, l.color, strength * weight, unit));
  }
  return group;
}

/** How far a ray from `at` along unit `aim` goes in `box`: from inside, to where it leaves; from outside, to where it enters; 0 when it misses. */
export function boxReach(at: THREE.Vector3, aim: THREE.Vector3, box: THREE.Box3): number {
  const end = new THREE.Ray(at, aim).intersectBox(box, new THREE.Vector3());
  return end ? end.distanceTo(at) : 0;
}

/** the model's geometry the last reaches were found in, and what each beam's axis met there */
let found: { geometries: readonly THREE.BufferGeometry[]; counts: readonly number[]; hits: Map<string, number | null> } = { geometries: [], counts: [], hits: new Map() };

/**
 * How far along each ray (world mm, from `at` along unit `aim`, no further than `far`) the first of
 * the drawn triangles of `geometries` (world mm; those of visible layers, drawRange) lies, or null when
 * none does. A model of millions of triangles takes a moment, so what each ray met is kept until the
 * geometry changes: switching or colouring lights costs nothing, and moving one looks again for it alone.
 */
export function surfaceReaches(rays: readonly { readonly at: readonly number[]; readonly aim: readonly number[]; readonly far: number }[], geometries: readonly THREE.BufferGeometry[]): (number | null)[] {
  const counts = geometries.map(drawn);
  if (geometries.length !== found.geometries.length || geometries.some((g, i) => g !== found.geometries[i] || counts[i] !== found.counts[i])) {
    found = { geometries: [...geometries], counts, hits: new Map() };
  }
  const key = (r: (typeof rays)[number]): string => `${r.at.map(Math.round).join(",")} ${r.aim.map((n) => n.toFixed(4)).join(",")} ${Math.round(r.far)}`;
  const todo = rays.filter((r) => !found.hits.has(key(r)));
  if (todo.length) {
    const hits = firstHits(todo, geometries, counts);
    todo.forEach((r, i) => found.hits.set(key(r), hits[i]));
  }
  return rays.map((r) => found.hits.get(key(r)) ?? null);
}

function drawn(g: THREE.BufferGeometry): number {
  const all = g.index ? g.index.count : g.attributes.position.count;
  return Math.min(g.drawRange.count, all) - (Math.min(g.drawRange.count, all) % 3);
}

/** One pass over the triangles for every ray, each ray's box shrinking to its nearest hit so far. */
function firstHits(rays: readonly { readonly at: readonly number[]; readonly aim: readonly number[]; readonly far: number }[], geometries: readonly THREE.BufferGeometry[], counts: readonly number[]): (number | null)[] {
  const n = rays.length;
  const best = new Float64Array(n);
  const lo = new Float64Array(n * 3);
  const hi = new Float64Array(n * 3);
  const box = (r: number): void => {
    const { at, aim } = rays[r];
    for (let k = 0; k < 3; k++) {
      const a = at[k] + aim[k] * NEAR_MISS;
      const b = at[k] + aim[k] * best[r];
      lo[r * 3 + k] = Math.min(a, b);
      hi[r * 3 + k] = Math.max(a, b);
    }
  };
  for (let r = 0; r < n; r++) {
    best[r] = rays[r].far;
    box(r);
  }
  geometries.forEach((g, gi) => {
    const pos = g.attributes.position.array as ArrayLike<number>;
    const index = g.index?.array as ArrayLike<number> | undefined;
    const count = counts[gi];
    for (let k = 0; k < count; k += 3) {
      const a = (index ? index[k] : k) * 3;
      const b = (index ? index[k + 1] : k + 1) * 3;
      const c = (index ? index[k + 2] : k + 2) * 3;
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const bx = pos[b], by = pos[b + 1], bz = pos[b + 2];
      const cx = pos[c], cy = pos[c + 1], cz = pos[c + 2];
      const x0 = Math.min(ax, bx, cx), x1 = Math.max(ax, bx, cx);
      const y0 = Math.min(ay, by, cy), y1 = Math.max(ay, by, cy);
      const z0 = Math.min(az, bz, cz), z1 = Math.max(az, bz, cz);
      for (let r = 0; r < n; r++) {
        const o = r * 3;
        if (x1 < lo[o] || x0 > hi[o] || y1 < lo[o + 1] || y0 > hi[o + 1] || z1 < lo[o + 2] || z0 > hi[o + 2]) continue;
        // Möller–Trumbore
        const { at, aim } = rays[r];
        const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
        const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
        const px = aim[1] * e2z - aim[2] * e2y, py = aim[2] * e2x - aim[0] * e2z, pz = aim[0] * e2y - aim[1] * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det;
        const tx = at[0] - ax, ty = at[1] - ay, tz = at[2] - az;
        const u = (tx * px + ty * py + tz * pz) * inv;
        if (u < 0 || u > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
        const v = (aim[0] * qx + aim[1] * qy + aim[2] * qz) * inv;
        if (v < 0 || u + v > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
        if (t > NEAR_MISS && t < best[r]) {
          best[r] = t;
          box(r);
        }
      }
    }
  });
  return rays.map((ray, r) => (best[r] < ray.far ? best[r] : null));
}

/** Frees the beams' geometry and materials. */
export function disposeBeams(group: THREE.Group): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
  }
  group.clear();
}

function cone(at: THREE.Vector3, aim: THREE.Vector3, angle: number, reach: number, color: string, strength: number, unit: number): THREE.Mesh {
  const half = Math.min(angle / 2, (80 * Math.PI) / 180);
  const geometry = new THREE.ConeGeometry(reach * Math.tan(half), reach, SEGMENTS, 1, true);
  // the apex at the origin, opening down -y
  geometry.translate(0, -reach / 2, 0);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color).multiplyScalar(strength) },
      uApex: { value: at.clone() },
      uAxis: { value: aim.clone() },
      uLength: { value: reach },
      uUnit: { value: unit },
      uNear: { value: NEAR },
      uOrtho: { value: false },
      uViewDir: { value: new THREE.Vector3(0, 0, -1) },
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(at);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), aim);
  // an orthographic camera looks the same way at every point of the beam
  mesh.onBeforeRender = (_renderer, _scene, camera) => {
    const ortho = (camera as THREE.OrthographicCamera).isOrthographicCamera === true;
    material.uniforms.uOrtho.value = ortho;
    if (ortho) camera.getWorldDirection(material.uniforms.uViewDir.value);
  };
  mesh.raycast = () => {};
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return mesh;
}
