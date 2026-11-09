// The guide buffers of the moving view's filter (motion.ts): one pass over a render scene's surfaces
// through a camera, which gives each pixel its albedo, the colour that the picture's light is divided
// by, and its flat world normal with its linear depth in metres, which the filter reprojects and
// edge-stops on. Sky pixels are cleared: no albedo, and a depth of 0 means none. Like gbuffer.ts, one
// override material draws every mesh, each one's finish put into its uniforms just before it is drawn.

import * as THREE from "three";
import type { RenderScene } from "./sceneBuilder.ts";

const VERTEX = `
uniform mat3 uMapTransform;
uniform mat3 uAlphaTransform;
varying vec3 vWorld;
varying vec3 vView;
varying vec2 vMapUv;
varying vec2 vAlphaUv;

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vView = mv.xyz;
  vMapUv = (uMapTransform * vec3(uv, 1.0)).xy;
  vAlphaUv = (uAlphaTransform * vec3(uv, 1.0)).xy;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = `
uniform vec3 uColor;
uniform float uMetalness;
uniform float uGlass;
uniform float uSkip;
uniform float uHasMap;
uniform sampler2D uMap;
uniform float uAlphaTest;
uniform sampler2D uAlphaMap;
uniform vec3 uEye;
varying vec3 vWorld;
varying vec3 vView;
varying vec2 vMapUv;
varying vec2 vAlphaUv;

layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormalDepth;

void main() {
  // a see-through face that is not glass draws nothing, and a cut-out keeps what its mask keeps, as gbuffer.ts does
  if (uSkip > 0.5) discard;
  if (uAlphaTest > 0.0 && texture(uAlphaMap, vAlphaUv).g < uAlphaTest) discard;
  vec3 albedo = uColor;
  if (uHasMap > 0.5) albedo *= texture(uMap, vMapUv).rgb;
  // a metal reflects its own colour, so its albedo is the colour
  albedo = mix(albedo, uColor, uMetalness);
  // glass passes the light through, so it takes none of its colour
  if (uGlass > 0.5) albedo = vec3(1.0);
  // the face is flat: the triangle's own normal, turned toward the eye
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 toEye = isOrthographic ? uEye : cameraPosition - vWorld;
  if (dot(n, toEye) < 0.0) n = -n;
  gAlbedo = vec4(albedo, 1.0);
  gNormalDepth = vec4(n, -vView.z);
}
`;

/** What the guide buffers read of a mesh's own material. */
interface Finish {
  readonly color?: THREE.Color;
  readonly map?: THREE.Texture | null;
  readonly metalness?: number;
  readonly transmission?: number;
  readonly alphaMap?: THREE.Texture | null;
  readonly alphaTest: number;
  readonly transparent: boolean;
  readonly polygonOffset: boolean;
  readonly polygonOffsetFactor: number;
  readonly polygonOffsetUnits: number;
}

const WHITE = new THREE.Color(1, 1, 1);

/** The surfaces of a render scene drawn as guide buffers at a size: albedo, and normal with linear depth. */
export class GuidePass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  private readonly uniforms = {
    uColor: { value: new THREE.Color(1, 1, 1) },
    uMetalness: { value: 0 },
    uGlass: { value: 0 },
    uSkip: { value: 0 },
    uHasMap: { value: 0 },
    uMap: { value: this.blank as THREE.Texture },
    uMapTransform: { value: new THREE.Matrix3() },
    uAlphaTest: { value: 0 },
    uAlphaMap: { value: this.blank as THREE.Texture },
    uAlphaTransform: { value: new THREE.Matrix3() },
    uEye: { value: new THREE.Vector3(0, 0, 1) },
  };
  private readonly material: THREE.ShaderMaterial;
  /** the mesh whose finish the uniforms hold: meshes of one material in a row upload it once */
  private last: Finish | null = null;

  constructor(width: number, height: number) {
    this.blank.needsUpdate = true;
    // nearest: a pixel's albedo, normal and depth are never a blend of two surfaces'
    this.target = new THREE.WebGLRenderTarget(width, height, {
      count: 2,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
    });
    this.material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => this.take((object as THREE.Mesh).material as unknown as Finish);
  }

  /** The albedo in rgb, and 1 on a surface, 0 on sky. */
  get albedo(): THREE.Texture {
    return this.target.textures[0];
  }

  /** The flat world normal in xyz (not packed) and the linear view depth in metres in w; 0 on sky. */
  get normalDepth(): THREE.Texture {
    return this.target.textures[1];
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  /** Draws the surfaces of `scene` through `camera` at width × height, leaving the renderer's state as it was. */
  render(renderer: THREE.WebGLRenderer, scene: RenderScene, camera: THREE.Camera, width: number, height: number): void {
    if (this.target.width !== width || this.target.height !== height) this.target.setSize(width, height);
    const e = camera.matrixWorld.elements;
    this.uniforms.uEye.value.set(e[8], e[9], e[10]).normalize();

    const s = scene.scene;
    const saved = {
      background: s.background,
      overrideMaterial: s.overrideMaterial,
      target: renderer.getRenderTarget(),
      viewport: renderer.getViewport(new THREE.Vector4()),
      scissor: renderer.getScissor(new THREE.Vector4()),
      scissorTest: renderer.getScissorTest(),
      autoClear: renderer.autoClear,
      clearColor: renderer.getClearColor(new THREE.Color()),
      clearAlpha: renderer.getClearAlpha(),
      shadows: renderer.shadowMap.enabled,
    };
    // the sky is not a surface, and the lamps' shadow maps are not needed for the guides
    s.background = null;
    s.overrideMaterial = this.material;
    renderer.shadowMap.enabled = false;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    this.last = null;
    try {
      renderer.clear(true, true, false);
      renderer.render(s, camera);
    } finally {
      s.background = saved.background;
      s.overrideMaterial = saved.overrideMaterial;
      renderer.shadowMap.enabled = saved.shadows;
      // the viewport and scissor first, the target last: setting a target applies the viewport that belongs to it
      renderer.setViewport(saved.viewport);
      renderer.setScissor(saved.scissor);
      renderer.setScissorTest(saved.scissorTest);
      renderer.setRenderTarget(saved.target);
      renderer.autoClear = saved.autoClear;
      renderer.setClearColor(saved.clearColor, saved.clearAlpha);
    }
  }

  dispose(): void {
    this.target.dispose();
    this.material.dispose();
    this.blank.dispose();
  }

  /** Puts a mesh's finish into the uniforms, so the next mesh is drawn with it. */
  private take(m: Finish): void {
    if (m === this.last) return;
    this.last = m;
    const u = this.uniforms;
    const glass = (m.transmission ?? 0) > 0;
    // a see-through face that is not glass is left out, as gbuffer.ts leaves it out
    u.uSkip.value = m.transparent && !glass ? 1 : 0;
    u.uGlass.value = glass ? 1 : 0;
    u.uColor.value.copy(m.color ?? WHITE);
    u.uMetalness.value = m.metalness ?? 0;

    const map = m.map ?? null;
    if (map) {
      if (map.matrixAutoUpdate) map.updateMatrix();
      u.uMap.value = map;
      u.uHasMap.value = 1;
      u.uMapTransform.value.copy(map.matrix);
    } else {
      u.uMap.value = this.blank;
      u.uHasMap.value = 0;
    }

    const alpha = m.alphaMap ?? null;
    if (alpha && m.alphaTest > 0) {
      if (alpha.matrixAutoUpdate) alpha.updateMatrix();
      u.uAlphaMap.value = alpha;
      u.uAlphaTest.value = m.alphaTest;
      u.uAlphaTransform.value.copy(alpha.matrix);
    } else {
      u.uAlphaMap.value = this.blank;
      u.uAlphaTest.value = 0;
    }

    // a recessed face sits behind those lying on it, as in the picture
    this.material.polygonOffset = m.polygonOffset;
    this.material.polygonOffsetFactor = m.polygonOffsetFactor;
    this.material.polygonOffsetUnits = m.polygonOffsetUnits;
    this.material.uniformsNeedUpdate = true;
  }
}
