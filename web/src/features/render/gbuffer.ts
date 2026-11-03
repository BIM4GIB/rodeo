// The Realistic engine's G-buffer: one pass over the render scene that writes each pixel's depth,
// its normal in view space with its roughness, and how much it reflects head on (F0). Ambient
// occlusion, the screen-space reflections, depth of field, fog and the outlines all read it. Glass
// is in it, as it reflects; a see-through face that is not glass writes no depth, so it is left out.

import * as THREE from "three";
import { Pass } from "three/examples/jsm/postprocessing/Pass.js";

const VERTEX = `
uniform mat3 uAlphaTransform;
varying vec3 vViewPosition;
varying vec2 vAlphaUv;

void main() {
  vAlphaUv = (uAlphaTransform * vec3(uv, 1.0)).xy;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = `
uniform float uRoughness;
uniform vec3 uF0;
uniform sampler2D uAlphaMap;
uniform float uAlphaTest;
varying vec3 vViewPosition;
varying vec2 vAlphaUv;

layout(location = 0) out vec4 gNormal;
layout(location = 1) out vec4 gReflect;

void main() {
  // a cut-out (a plant's picture) as the render material keeps it: the mask's green over the test
  if (uAlphaTest > 0.0 && texture(uAlphaMap, vAlphaUv).g < uAlphaTest) discard;
  // the faces are flat: the triangle's own normal, turned toward the eye as a two-sided face is lit
  vec3 n = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
  vec3 toEye = isOrthographic ? vec3(0.0, 0.0, 1.0) : -vViewPosition;
  if (dot(n, toEye) < 0.0) n = -n;
  gNormal = vec4(n * 0.5 + 0.5, uRoughness);
  gReflect = vec4(uF0, 1.0);
}
`;

/** What the G-buffer reads of a mesh's own material. */
interface Finish {
  readonly roughness?: number;
  readonly metalness?: number;
  readonly color?: THREE.Color;
  readonly ior?: number;
  readonly specularIntensity?: number;
  readonly transmission?: number;
  readonly alphaMap?: THREE.Texture | null;
  readonly alphaTest: number;
  readonly transparent: boolean;
  readonly polygonOffset: boolean;
  readonly polygonOffsetFactor: number;
  readonly polygonOffsetUnits: number;
}

/** The G-buffer as a composer pass: it draws into its own target and leaves the picture alone. */
export class GBufferPass extends Pass {
  scene: THREE.Scene = new THREE.Scene();
  camera: THREE.Camera = new THREE.PerspectiveCamera();
  private readonly target: THREE.WebGLRenderTarget;
  private readonly blank = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  private readonly uniforms = {
    uRoughness: { value: 1 },
    uF0: { value: new THREE.Vector3() },
    uAlphaMap: { value: this.blank as THREE.Texture },
    uAlphaTest: { value: 0 },
    uAlphaTransform: { value: new THREE.Matrix3() },
  };
  private readonly material: THREE.ShaderMaterial;
  /** the material whose finish the uniforms hold: meshes of one material in a row upload it once */
  private last: Finish | null = null;

  constructor(width: number, height: number) {
    super();
    this.needsSwap = false;
    this.blank.needsUpdate = true;
    const depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
    // nearest: a pixel's normal or depth is never a blend of two surfaces'
    this.target = new THREE.WebGLRenderTarget(width, height, {
      count: 2,
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture,
    });
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      glslVersion: THREE.GLSL3,
      side: THREE.DoubleSide,
    });
    // one material draws every mesh: each one's finish is put into the uniforms just before it is drawn
    this.material.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => this.take((object as THREE.Mesh).material as unknown as Finish);
  }

  /** The depth, as the render scene's camera drew it. */
  get depth(): THREE.DepthTexture {
    return this.target.depthTexture as THREE.DepthTexture;
  }

  /** The normal in view space (packed into 0..1, as GTAOPass reads it) and the roughness in alpha. */
  get normal(): THREE.Texture {
    return this.target.textures[0];
  }

  /** F0, the share of light a face reflects head on, per channel. */
  get reflectance(): THREE.Texture {
    return this.target.textures[1];
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
  }

  render(renderer: THREE.WebGLRenderer): void {
    this.draw(renderer, this.scene, this.camera);
  }

  /** Draws the G-buffer of `scene` through `camera` (also outside a composer); leaves the renderer's target as it was. */
  draw(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
    const saved = {
      background: scene.background,
      overrideMaterial: scene.overrideMaterial,
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
      clearColor: renderer.getClearColor(new THREE.Color()),
      clearAlpha: renderer.getClearAlpha(),
    };
    // the sky is not a surface: its pixels keep the far depth and a zero normal
    scene.background = null;
    scene.overrideMaterial = this.material;
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.autoClear = false;
    this.last = null;
    try {
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
    } finally {
      scene.background = saved.background;
      scene.overrideMaterial = saved.overrideMaterial;
      renderer.setRenderTarget(saved.target);
      renderer.autoClear = saved.autoClear;
      renderer.setClearColor(saved.clearColor, saved.clearAlpha);
    }
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.material.dispose();
    this.blank.dispose();
  }

  /** Puts a mesh's finish into the uniforms; a see-through face that is not glass draws nothing. */
  private take(m: Finish): void {
    if (m === this.last) return;
    this.last = m;
    const u = this.uniforms;
    const material = this.material;
    const glass = (m.transmission ?? 0) > 0;
    const drawn = !m.transparent || glass;
    material.colorWrite = drawn;
    material.depthWrite = drawn;
    // a recessed face sits behind those lying on it, as in the picture
    material.polygonOffset = m.polygonOffset;
    material.polygonOffsetFactor = m.polygonOffsetFactor;
    material.polygonOffsetUnits = m.polygonOffsetUnits;

    u.uRoughness.value = m.roughness ?? 1;
    // a dielectric reflects ((n - 1) / (n + 1))² head on; a metal its own colour
    const ior = m.ior ?? 1.5;
    const dielectric = ((ior - 1) / (ior + 1)) ** 2 * (m.specularIntensity ?? 1);
    const metal = m.metalness ?? 0;
    const c = m.color;
    u.uF0.value.set(
      dielectric + ((c?.r ?? 1) - dielectric) * metal,
      dielectric + ((c?.g ?? 1) - dielectric) * metal,
      dielectric + ((c?.b ?? 1) - dielectric) * metal,
    );

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
    material.uniformsNeedUpdate = true;
  }
}
