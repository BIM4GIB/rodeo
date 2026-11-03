// The render scene: the 3D view's visible faces (compacted, with normals) in their materials (or
// the clay look), the features' content, the sun, the drawing's light objects, a ground plane (matte
// to mirror-like) and the sky, all in
// render space (metres, y up) under one root that RENDER_SPACE places. update() applies what the
// settings change without new geometry and says what it touched, so a path tracer does no more.

import * as THREE from "three";
import { PhysicalSpotLight } from "three-gpu-pathtracer";
import { beamGroup, boxReach, disposeBeams, surfaceReaches } from "../../app/beams.ts";
import { MAX_LAMPS, type Viz3D } from "../../app/heliodon.ts";
import type { ModelFace } from "../../app/view3d.ts";
import type { Light3D } from "../../core/index.ts";
import { makeMaterial, updateMaterial } from "./materials.ts";
import { materialKey, type RenderSettings } from "./settings.ts";
import { skyTexture, skyWithSun, sunState, type SunState } from "./sky.ts";
import { MM, RENDER_SPACE, dirToRender, toRender } from "./space.ts";

export interface SceneSource {
  readonly faces: readonly ModelFace[];
  /** features' content (Site Context), world mm, z up */
  readonly content: readonly THREE.Object3D[];
  /** the drawing's light objects that are on, on visible layers */
  readonly lights: readonly Light3D[];
}

/** What RenderScene.update changed, so a path tracer redoes no more than it must. */
export interface SceneChange {
  /** meshes shown or hidden (the ground plane): a path tracer builds its BVH again */
  readonly geometry: boolean;
  readonly materials: boolean;
  readonly lights: boolean;
  readonly environment: boolean;
}

export interface RenderScene {
  readonly scene: THREE.Scene;
  /** the model's (and content's) box in render space, ground plane left out */
  readonly bounds: THREE.Box3;
  readonly sun: SunState;
  /** the sun as a light (intensity 0 when it is down or off) */
  readonly sunLight: THREE.DirectionalLight;
  /**
   * the sky with the sun in it (sky.ts skyWithSun), which a path tracer lights with in place of
   * scene.environment and sunLight: one light among many lamps, the sun would be sampled seldom
   */
  readonly pathSky: THREE.Texture;
  /**
   * the light objects' lights; those with userData.rasterSkip set are left out by the Realistic
   * engine (it lights with at most MAX_LAMPS), the path tracer takes them all
   */
  readonly lamps: readonly THREE.Light[];
  /**
   * the spots' beams in haze (RenderSettings.lights.haze), a scene of its own that the Realistic
   * engine draws over the picture; the path tracer leaves it out
   */
  readonly beams: THREE.Scene;
  /** the materials by materialKey, with the faces each is on */
  readonly materials: ReadonlyMap<string, { readonly material: THREE.MeshPhysicalMaterial; readonly faces: readonly ModelFace[] }>;
  /** Applies new settings that need no new geometry; says what changed. */
  update(settings: RenderSettings, viz: Viz3D): SceneChange;
  /** Frees the compacted geometry, materials and sky (not the 3D view's own geometry or textures). */
  dispose(): void;
}

/**
 * The sun's strength in render space: about the 3D view's sun (SUN_INTENSITY, 2.6 there), against
 * a sky's light of about 1 here.
 */
const SUN_LUX = 3;
/** What a light object at 100 % gives at 1 m, in candela: as much as the sun (the 3D view's convention, now in metres). */
const LAMP_CD = SUN_LUX;
/** how far the sun, and a directional lamp, stand from the model's centre, in the model's radii */
const SUN_DISTANCE = 4;
const SUN_MAP = 4096;
/** the sun's radius in degrees, and what the softness adds to it at 1 (the path tracer's sun) */
const SUN_RADIUS = 0.27;
const SUN_SOFT_RADIUS = 2;
const LAMP_MAP = 2048;
const POINT_MAP = 1024;
/** the lamps that cast shadows, as the 3D view's SHADOW_LAMPS: among the ones the Realistic engine lights with */
const SHADOW_LAMPS: Readonly<Record<Light3D["kind"], number>> = { directional: 1, spot: 2, point: 1 };
/** a wider spot's shadow takes in the middle of its cone only: this far (radians) from its axis */
const SPOT_SHADOW_HALF_ANGLE = (75 * Math.PI) / 180;
const CONTENT_COLOR = "#b0b0b0";
const CONTENT_ROUGHNESS = 0.9;
/** isSloping's grid, cells a side */
const FOOTPRINT_GRID = 48;
/** a site covers at least this share of its footprint's cells */
const SLOPE_COVER = 0.6;
/** the share of the cells one level holds on level ground, at least */
const SLOPE_LEVEL = 0.4;
/** what counts as one level: within this share of the footprint's diagonal, and at least this many mm */
const SLOPE_TOLERANCE = 0.001;
const SLOPE_TOLERANCE_MM = 50;

/**
 * three's shadowmap_vertex with each light's normal offset turned toward that light. The drawing's
 * faces wind either way and are drawn from both sides, so a face's normal may point away from a
 * light that shines on it; offset that way, the shadow is looked up under the face and it shadows
 * itself. A directional light lies against its shadow matrix's depth row, a point light at minus
 * its translation, and a spot light where its projection's w is 0.
 */
const FACING_SHADOWMAP_VERTEX = /* glsl */ `
#if ( defined( USE_SHADOWMAP ) && ( NUM_DIR_LIGHT_SHADOWS > 0 || NUM_POINT_LIGHT_SHADOWS > 0 ) ) || ( NUM_SPOT_LIGHT_COORDS > 0 )
	vec3 shadowWorldNormal = inverseTransformDirection( transformedNormal, viewMatrix );
	vec4 shadowWorldPosition;
	vec3 shadowToLight;
	vec4 shadowSpotEye;
#endif
#if defined( USE_SHADOWMAP )
	#if NUM_DIR_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_DIR_LIGHT_SHADOWS; i ++ ) {
			shadowToLight = - vec3( directionalShadowMatrix[ i ][ 0 ].z, directionalShadowMatrix[ i ][ 1 ].z, directionalShadowMatrix[ i ][ 2 ].z );
			shadowWorldPosition = worldPosition + vec4( faceforward( shadowWorldNormal, - shadowToLight, shadowWorldNormal ) * directionalLightShadows[ i ].shadowNormalBias, 0 );
			vDirectionalShadowCoord[ i ] = directionalShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
	#if NUM_POINT_LIGHT_SHADOWS > 0
		#pragma unroll_loop_start
		for ( int i = 0; i < NUM_POINT_LIGHT_SHADOWS; i ++ ) {
			shadowToLight = - pointShadowMatrix[ i ][ 3 ].xyz - worldPosition.xyz;
			shadowWorldPosition = worldPosition + vec4( faceforward( shadowWorldNormal, - shadowToLight, shadowWorldNormal ) * pointLightShadows[ i ].shadowNormalBias, 0 );
			vPointShadowCoord[ i ] = pointShadowMatrix[ i ] * shadowWorldPosition;
		}
		#pragma unroll_loop_end
	#endif
#endif
#if NUM_SPOT_LIGHT_COORDS > 0
	#pragma unroll_loop_start
	for ( int i = 0; i < NUM_SPOT_LIGHT_COORDS; i ++ ) {
		shadowWorldPosition = worldPosition;
		#if ( defined( USE_SHADOWMAP ) && UNROLLED_LOOP_INDEX < NUM_SPOT_LIGHT_SHADOWS )
			shadowSpotEye = inverse( spotLightMatrix[ i ] ) * vec4( 0.0, 0.0, 1.0, 0.0 );
			shadowToLight = shadowSpotEye.xyz / shadowSpotEye.w - worldPosition.xyz;
			shadowWorldPosition.xyz += faceforward( shadowWorldNormal, - shadowToLight, shadowWorldNormal ) * spotLightShadows[ i ].shadowNormalBias;
		#endif
		vSpotLightCoord[ i ] = spotLightMatrix[ i ] * shadowWorldPosition;
	}
	#pragma unroll_loop_end
#endif
`;

/** Has `material` look its shadows up off whichever side of a face its light is on (FACING_SHADOWMAP_VERTEX). */
function shadowsFaceLights<M extends THREE.Material>(material: M): M {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace("#include <shadowmap_vertex>", FACING_SHADOWMAP_VERTEX);
  };
  material.customProgramCacheKey = () => "openvwx-facing-shadows";
  return material;
}

/** One material with the faces it is on, and their meshes (meshes[i] is faces[i]'s). */
interface FaceGroup {
  readonly material: THREE.MeshPhysicalMaterial;
  readonly faces: ModelFace[];
  readonly meshes: THREE.Mesh[];
}

/** Geometry where it stands in world mm: `matrix` places it, null when it is there already. */
interface Placed {
  readonly geometry: THREE.BufferGeometry;
  readonly matrix: THREE.Matrix4 | null;
}

interface Lamp {
  readonly light: THREE.Light;
  readonly source: Light3D;
}

/** Builds the render scene of the model as the 3D view shows it, with the sun, the sky and the drawing's lights. */
export function buildScene(src: SceneSource, settings: RenderSettings, viz: Viz3D): RenderScene {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.matrixAutoUpdate = false;
  root.matrix.copy(RENDER_SPACE);
  scene.add(root);

  // the model's and the content's boxes, in world mm
  const world = new THREE.Box3();
  const compacted: THREE.BufferGeometry[] = [];
  /** the content's geometry where it stands, for the footprint (the faces' are compacted) */
  const placed: Placed[] = [];
  const ownMaterials: THREE.Material[] = [];
  const groups = new Map<string, FaceGroup>();

  for (const face of src.faces) {
    if (face.geometry.drawRange.count <= 0 || face.opacity < 0.01) continue;
    const geometry = compact(face);
    compacted.push(geometry);
    if (geometry.boundingBox) world.union(geometry.boundingBox);
    const key = materialKey(face);
    let group = groups.get(key);
    if (!group) {
      const material = shadowsFaceLights(makeMaterial(face, settings.materials[key], clayOf(settings)));
      ownMaterials.push(material);
      group = { material, faces: [], meshes: [] };
      groups.set(key, group);
    }
    const mesh = new THREE.Mesh(geometry, group.material);
    mesh.castShadow = castsShadow(face.opacity, group.material);
    mesh.receiveShadow = true;
    root.add(mesh);
    group.faces.push(face);
    group.meshes.push(mesh);
  }

  /** the content's materials, with the colour and picture each takes off the clay look */
  const contentLooks: { readonly material: THREE.MeshPhysicalMaterial; readonly color: THREE.Color; readonly map: THREE.Texture | null }[] = [];
  for (const obj of src.content) {
    obj.updateWorldMatrix(true, true);
    obj.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      const from = Array.isArray(o.material) ? o.material[0] : o.material;
      const color = from && "color" in from && from.color instanceof THREE.Color ? from.color.clone() : new THREE.Color(CONTENT_COLOR);
      const map = from && "map" in from && from.map instanceof THREE.Texture ? from.map : null;
      const material = shadowsFaceLights(new THREE.MeshPhysicalMaterial({ roughness: CONTENT_ROUGHNESS, side: THREE.DoubleSide }));
      const look = { material, color, map };
      contentLook(look, clayOf(settings));
      contentLooks.push(look);
      ownMaterials.push(material);
      const mesh = new THREE.Mesh(o.geometry, material);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(o.matrixWorld);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
      const pos = o.geometry.attributes.position;
      if (pos) world.union(new THREE.Box3().setFromBufferAttribute(pos).applyMatrix4(o.matrixWorld));
      placed.push({ geometry: o.geometry, matrix: o.matrixWorld.clone() });
    });
  }

  // a sloping site model is its own ground: a plane under its lowest point would show under the rest
  const sloping = isSloping([...compacted.map((geometry) => ({ geometry, matrix: null })), ...placed], world);
  const bounds = world.isEmpty() ? new THREE.Box3(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5)) : world.applyMatrix4(RENDER_SPACE);
  const size = bounds.getSize(new THREE.Vector3());
  const centre = bounds.getCenter(new THREE.Vector3());
  const r = Math.max(1, size.length() / 2);

  // at least a kilometre, else 50 diagonals of the model
  const extent = Math.max(1000, 50 * size.length());
  const groundGeometry = new THREE.PlaneGeometry(extent, extent).rotateX(-Math.PI / 2);
  const groundMaterial = shadowsFaceLights(new THREE.MeshPhysicalMaterial({ color: settings.environment.groundColor, roughness: groundRoughness(settings.environment.groundGloss) }));
  ownMaterials.push(groundMaterial);
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.position.set(centre.x, bounds.min.y - 0.002, centre.z);
  ground.receiveShadow = true;
  ground.visible = settings.environment.groundPlane && !sloping;
  scene.add(ground);

  let sun = sunState(viz, settings.environment.turbidity);
  const sunLight = new THREE.DirectionalLight(sun.color, 0);
  sunLight.target.position.copy(centre);
  fitShadow(sunLight, r, SUN_MAP, -0.0002);
  applySun(sunLight, sun, settings, centre, r);
  scene.add(sunLight, sunLight.target);

  // the lamps the Realistic engine lights with come first: directional ones, then the brightest
  const ranked = [...src.lights].sort((a, b) => kindRank(a) - kindRank(b) || b.brightness - a.brightness);
  const left: Record<Light3D["kind"], number> = { ...SHADOW_LAMPS };
  const lamps: THREE.Light[] = [];
  const parts: Lamp[] = [];
  ranked.forEach((source, i) => {
    const kept = i < MAX_LAMPS;
    const shadows = kept && left[source.kind] > 0;
    if (shadows) left[source.kind]--;
    const { light, target } = makeLamp(source, lampStrength(source, settings), centre, r, shadows);
    light.visible = settings.lights.on;
    light.userData.rasterSkip = !kept;
    scene.add(light);
    if (target) scene.add(target);
    lamps.push(light);
    parts.push({ light, source });
  });

  const beams = new THREE.Scene();
  const spots = src.lights.filter((l) => l.kind === "spot");
  const clearBeams = (): void => {
    for (const group of beams.children) disposeBeams(group as THREE.Group);
    beams.clear();
  };
  const placeBeams = (s: RenderSettings): void => {
    clearBeams();
    if (!s.lights.on || !(s.lights.haze > 0) || !spots.length) return;
    const lights = spots.map((l) => ({ at: toRender(...l.position), aim: dirToRender(...l.direction), spread: l.spread, beam: l.beam, color: l.color, strength: lampStrength(l, s) }));
    // each beam stops at the first face its axis meets, found in the model's world (mm)
    const reaches = surfaceReaches(
      spots.map((l, i) => ({ at: l.position, aim: new THREE.Vector3(...l.direction).normalize().toArray(), far: boxReach(lights[i].at, lights[i].aim, bounds) / MM })),
      src.faces.map((f) => f.geometry),
    );
    const hits = reaches.map((t) => (t === null ? null : t * MM));
    beams.add(beamGroup(lights.map((l, i) => ({ ...l, reach: hits[i] })), bounds, 1, s.lights.haze));
  };
  placeBeams(settings);

  let sky = skyTexture(settings.environment, sun, undefined, sunGround(sun, settings));
  let pathSky = skyWithSun(sky, sun, sunStrength(sun, settings), sunRadius(settings));
  scene.environment = sky;
  scene.background = backdrop(settings.environment, sky);
  scene.updateMatrixWorld(true);

  let applied = settings;

  return {
    scene,
    bounds,
    get sun(): SunState {
      return sun;
    },
    sunLight,
    get pathSky(): THREE.Texture {
      return pathSky;
    },
    lamps,
    beams,
    materials: groups,
    update(next, nextViz) {
      const prev = applied;
      const sunNext = sunState(nextViz, next.environment.turbidity);
      const placed = !sameSun(sun, sunNext);
      let geometry = false;
      let materials = false;
      let lights = false;
      let environment = false;

      const clay = clayOf(next);
      const clayChanged = clay !== clayOf(prev);
      for (const [key, group] of groups) {
        const override = next.materials[key];
        if (!clayChanged && sameValues(prev.materials[key], override)) continue;
        updateMaterial(group.material, group.faces[0], override, clay);
        group.meshes.forEach((mesh, i) => {
          mesh.castShadow = castsShadow(group.faces[i].opacity, group.material);
        });
        materials = true;
      }
      if (clayChanged) {
        for (const look of contentLooks) contentLook(look, clay);
        materials = true;
      }

      if (placed || prev.sun.on !== next.sun.on || prev.sun.intensity !== next.sun.intensity || prev.sun.softness !== next.sun.softness) {
        applySun(sunLight, sunNext, next, centre, r);
        lights = true;
      }
      if (prev.lights.on !== next.lights.on || prev.lights.intensity !== next.lights.intensity || prev.sun.on !== next.sun.on || prev.exposure !== next.exposure) {
        for (const { light, source } of parts) {
          light.visible = next.lights.on;
          light.intensity = lampStrength(source, next);
        }
        lights = true;
      }
      if (prev.lights.on !== next.lights.on || prev.lights.intensity !== next.lights.intensity || prev.lights.haze !== next.lights.haze) placeBeams(next);

      // the sky shows the sun's place, and the ground under a physical one its light, so it is made again when they change
      const skyChanged = placed || !sameValues(prev.environment, next.environment, ["groundPlane", "groundColor", "groundGloss"]) || sunGround(sun, prev) !== sunGround(sunNext, next);
      if (skyChanged) {
        sky.dispose();
        sky = skyTexture(next.environment, sunNext, undefined, sunGround(sunNext, next));
        scene.environment = sky;
        scene.background = backdrop(next.environment, sky);
        environment = true;
      }
      if (skyChanged || sunStrength(sun, prev) !== sunStrength(sunNext, next) || sunRadius(prev) !== sunRadius(next)) {
        pathSky.dispose();
        pathSky = skyWithSun(sky, sunNext, sunStrength(sunNext, next), sunRadius(next));
        environment = true;
      }

      if (ground.visible !== (next.environment.groundPlane && !sloping)) {
        ground.visible = next.environment.groundPlane && !sloping;
        geometry = true;
      }
      if (prev.environment.groundColor !== next.environment.groundColor || prev.environment.groundGloss !== next.environment.groundGloss) {
        groundMaterial.color.set(next.environment.groundColor);
        groundMaterial.roughness = groundRoughness(next.environment.groundGloss);
        materials = true;
      }

      applied = next;
      sun = sunNext;
      return { geometry, materials, lights, environment };
    },
    dispose() {
      for (const g of compacted) g.dispose();
      for (const m of ownMaterials) m.dispose();
      groundGeometry.dispose();
      sky.dispose();
      pathSky.dispose();
      sunLight.dispose();
      for (const light of lamps) light.dispose();
      clearBeams();
    },
  };
}

/** A face's triangles only, as a non-indexed geometry with flat normals and its box, in world mm. */
function compact(face: ModelFace): THREE.BufferGeometry {
  const src = face.geometry;
  const index = src.index;
  const pos = src.attributes.position;
  const uv = src.attributes.uv;
  const count = Math.min(src.drawRange.count, index ? index.count : pos.count);
  const positions = new Float32Array(count * 3);
  const uvs = uv ? new Float32Array(count * 2) : null;
  for (let k = 0; k < count; k++) {
    const v = index ? index.getX(k) : k;
    positions[3 * k] = pos.getX(v);
    positions[3 * k + 1] = pos.getY(v);
    positions[3 * k + 2] = pos.getZ(v);
    if (uv && uvs) {
      uvs[2 * k] = uv.getX(v);
      uvs[2 * k + 1] = uv.getY(v);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  if (uvs) out.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return out;
}

/**
 * Whether the model is a sloping site: a grid over its footprint takes each cell's lowest point (of
 * the triangles over it), and on a slope those points spread out, with no one level holding 40 %
 * of the cells, as a building's floor or a chair's seat does. A sheet of terrain
 * covers most of its footprint, so a sparse model is never taken for one.
 */
function isSloping(parts: readonly Placed[], box: THREE.Box3): boolean {
  if (box.isEmpty()) return false;
  const n = FOOTPRINT_GRID;
  const x0 = box.min.x;
  const y0 = box.min.y;
  const cw = (box.max.x - x0) / n || 1;
  const ch = (box.max.y - y0) / n || 1;
  const low = new Float64Array(n * n).fill(Infinity);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] as const;
  const cell = (c: number) => Math.min(n - 1, Math.max(0, Math.floor(c)));
  for (const { geometry, matrix } of parts) {
    const pos = geometry.attributes.position;
    const index = geometry.index;
    if (!pos) continue;
    const count = index ? index.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      for (let k = 0; k < 3; k++) {
        v[k].fromBufferAttribute(pos, index ? index.getX(t + k) : t + k);
        if (matrix) v[k].applyMatrix4(matrix);
      }
      const z = Math.min(v[0].z, v[1].z, v[2].z);
      const ix0 = cell((Math.min(v[0].x, v[1].x, v[2].x) - x0) / cw);
      const ix1 = cell((Math.max(v[0].x, v[1].x, v[2].x) - x0) / cw);
      const iy0 = cell((Math.min(v[0].y, v[1].y, v[2].y) - y0) / ch);
      const iy1 = cell((Math.max(v[0].y, v[1].y, v[2].y) - y0) / ch);
      for (let iy = iy0; iy <= iy1; iy++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          const i = iy * n + ix;
          if (z < low[i]) low[i] = z;
        }
      }
    }
  }
  const lows = Array.from(low).filter(Number.isFinite).sort((a, b) => a - b);
  if (lows.length < SLOPE_COVER * n * n) return false;
  // the most cells whose lowest points lie within one band
  const band = 2 * Math.max(SLOPE_TOLERANCE_MM, SLOPE_TOLERANCE * Math.hypot(box.max.x - x0, box.max.y - y0));
  let most = 0;
  for (let i = 0, j = 0; i < lows.length; i++) {
    while (lows[i] - lows[j] > band) j++;
    most = Math.max(most, i - j + 1);
  }
  return most < SLOPE_LEVEL * lows.length;
}

/** The clay colour when the settings ask for the clay look, else null. */
function clayOf(s: RenderSettings): string | null {
  return s.clay.on ? s.clay.color : null;
}

/** A content material's colour and picture, or the clay colour without a picture. */
function contentLook(look: { material: THREE.MeshPhysicalMaterial; color: THREE.Color; map: THREE.Texture | null }, clay: string | null): void {
  const { material } = look;
  const hadMap = material.map !== null;
  if (clay === null) material.color.copy(look.color);
  else material.color.set(clay);
  material.map = clay === null ? look.map : null;
  if (hadMap !== (material.map !== null)) material.needsUpdate = true;
}

/** The ground plane's roughness for a gloss of 0 (matte) .. 1 (nearly a mirror), eased so the middle reads as satin. */
function groundRoughness(gloss: number): number {
  return 0.02 + 0.93 * Math.pow(1 - Math.min(1, Math.max(0, gloss)), 1.5);
}

/** Whether a face casts shadows: opaque, and not glass (the sun's shadow map has no colour). */
function castsShadow(opacity: number, material: THREE.MeshPhysicalMaterial): boolean {
  return opacity >= 0.95 && material.transmission < 0.5;
}

function backdrop(env: RenderSettings["environment"], sky: THREE.Texture): THREE.Texture | THREE.Color {
  return env.visible ? sky : new THREE.Color(env.horizon);
}

/** The sun's light: placed SUN_DISTANCE radii out toward it, aimed at the centre; dark when down or off. */
function applySun(light: THREE.DirectionalLight, sun: SunState, s: RenderSettings, centre: THREE.Vector3, r: number): void {
  light.position.copy(centre).addScaledVector(sun.dir, SUN_DISTANCE * r);
  light.color.copy(sun.color);
  light.intensity = sun.up && s.sun.on ? SUN_LUX * s.sun.intensity : 0;
  light.shadow.radius = 1 + s.sun.softness * 4;
  light.shadow.normalBias = normalBias(light);
}

/**
 * How far along the normal a directional light's shadow is looked up, against shadow acne: a texel
 * and a half past the filter's reach, which softer edges widen.
 */
function normalBias(light: THREE.DirectionalLight): number {
  const cam = light.shadow.camera;
  const texel = (cam.right - cam.left) / light.shadow.mapSize.x;
  return texel * (1.5 + light.shadow.radius);
}

/** The sun's light on a face square to it, 0 while it is down or off. */
function sunStrength(sun: SunState, s: RenderSettings): number {
  return sun.up && s.sun.on ? SUN_LUX * s.sun.intensity : 0;
}

/** The sun's light on the ground under a physical sky (skyTexture's sunLight): none under the other kinds, which do not show it. */
function sunGround(sun: SunState, s: RenderSettings): number {
  return s.environment.sky === "physical" ? sunStrength(sun, s) : 0;
}

/** The sun's radius in the path tracer's sky, degrees: the real sun's, widened by the softness. */
function sunRadius(s: RenderSettings): number {
  return SUN_RADIUS + SUN_SOFT_RADIUS * s.sun.softness;
}

function sameSun(a: SunState, b: SunState): boolean {
  return a.up === b.up && a.dir.equals(b.dir) && a.color.equals(b.color);
}

function kindRank(l: Light3D): number {
  return l.kind === "directional" ? 0 : 1;
}

/**
 * A lamp's strength: candela at 1 m (a point or spot), or lux (a directional lamp), as its brightness
 * and the settings give it. With the sun out the exposure opens for the light objects (Dark Stage's
 * five stops, as the 3D view gains its lamps at night), but a directional light is a sun of the
 * drawing's own, which the 3D view doesn't gain: it keeps the strength it has at no exposure, or a
 * fill light at a quarter would light the set as eight suns.
 */
function lampStrength(l: Light3D, s: RenderSettings): number {
  if (l.kind !== "directional") return LAMP_CD * l.brightness * s.lights.intensity;
  return SUN_LUX * l.brightness * s.lights.intensity * (s.sun.on ? 1 : 2 ** -Math.max(0, s.exposure));
}

/**
 * A light object as a three.js light in render space: a point light where it is, a spot aimed along
 * its direction, a directional light standing back along its direction from the centre. Shadows are
 * cast only where `shadows` says.
 */
function makeLamp(l: Light3D, strength: number, centre: THREE.Vector3, r: number, shadows: boolean): { light: THREE.Light; target: THREE.Object3D | null } {
  const color = new THREE.Color(l.color);
  const aim = dirToRender(...l.direction);
  if (l.kind === "point") {
    const light = new THREE.PointLight(color, strength, 0, 2);
    toRender(...l.position, light.position);
    if (shadows) fitNearShadow(light, centre, r, POINT_MAP, Math.PI / 4);
    return { light, target: null };
  }
  if (l.kind === "directional") {
    const light = new THREE.DirectionalLight(color, strength);
    light.position.copy(centre).addScaledVector(aim, -SUN_DISTANCE * r);
    light.target.position.copy(centre);
    if (shadows) fitShadow(light, r, LAMP_MAP, -0.0003);
    return { light, target: light.target };
  }
  const light = new PhysicalSpotLight(
    color,
    strength,
    0,
    Math.min(l.spread / 2, Math.PI / 2 - 0.01),
    l.spread > 0 ? 1 - l.beam / l.spread : 0,
    2,
  );
  light.radius = 0.05;
  toRender(...l.position, light.position);
  light.target.position.copy(light.position).add(aim);
  if (shadows) {
    light.shadow.focus = Math.min(1, SPOT_SHADOW_HALF_ANGLE / Math.max(light.angle, 1e-6));
    fitNearShadow(light, centre, r, LAMP_MAP, light.angle * light.shadow.focus);
  }
  return { light, target: light.target };
}

/** A directional light's shadow camera, fitted round the model's sphere (the light stands SUN_DISTANCE radii out). */
function fitShadow(light: THREE.DirectionalLight, r: number, map: number, bias: number): void {
  const cam = light.shadow.camera;
  cam.left = -1.05 * r;
  cam.right = 1.05 * r;
  cam.top = 1.05 * r;
  cam.bottom = -1.05 * r;
  cam.near = Math.max(0.1, (SUN_DISTANCE - 1.1) * r);
  cam.far = (SUN_DISTANCE + 1.1) * r;
  cam.updateProjectionMatrix();
  light.shadow.mapSize.set(map, map);
  light.shadow.bias = bias;
  light.shadow.normalBias = normalBias(light);
  light.castShadow = true;
}

/** A spot's or point light's shadow camera reaches from the lamp to the far side of the model; `half` is what it sees either side of its axis. */
function fitNearShadow(light: THREE.SpotLight | THREE.PointLight, centre: THREE.Vector3, r: number, map: number, half: number): void {
  const dist = light.position.distanceTo(centre);
  const cam = light.shadow.camera;
  cam.far = (dist + r) * 1.05;
  cam.near = Math.max(0.01, cam.far / 2000);
  cam.updateProjectionMatrix();
  light.shadow.mapSize.set(map, map);
  light.shadow.bias = -0.0003;
  light.shadow.normalBias = (3 * Math.max(1, dist) * Math.tan(half)) / map;
  light.castShadow = true;
}

/** Whether two records hold equal values under every key, but those `skip` names. */
function sameValues<T extends object>(a: T | undefined, b: T | undefined, skip: readonly (keyof T)[] = []): boolean {
  if (!a || !b) return a === b;
  const keys = new Set<keyof T>([...(Object.keys(a) as (keyof T)[]), ...(Object.keys(b) as (keyof T)[])]);
  return [...keys].every((k) => skip.includes(k) || a[k] === b[k]);
}
