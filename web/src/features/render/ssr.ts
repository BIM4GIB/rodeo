// Screen-space reflections for the Realistic engine: each shiny pixel's reflected ray is marched
// across the G-buffer's depth; where it meets a face on screen, that face's colour takes the place
// of the sky the material reflected there, weighed as three.js weighs a reflection (its F0, the
// angle and the roughness). A rougher face reads the hit from a blurrier copy of the picture, and
// the reflection fades off where the screen runs out. The path tracer's reflections are exact.

import * as THREE from "three";
import { FullScreenQuad, Pass } from "three/examples/jsm/postprocessing/Pass.js";
import type { GBufferPass } from "./gbuffer.ts";

/** Steps along a ray at most, and the binary search's at each crossing. */
const MAX_STEPS = 80;
const REFINE_STEPS = 7;
/** a ray steps at least this many pixels */
const STRIDE_PX = 2;
/** above this roughness a face reflects only the sky (the environment map does it) */
const MAX_ROUGHNESS = 0.6;

const VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COPY_FRAGMENT = `
uniform sampler2D tColor;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0);
}
`;

const FRAGMENT = `
uniform sampler2D tColor;
uniform sampler2D tBlurred;
uniform sampler2D tNormal;
uniform sampler2D tReflect;
uniform sampler2D tDepth;
uniform sampler2D tEnv;
uniform float uHasEnv;
uniform mat4 uProj;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform float uNear;
uniform float uFar;
uniform float uOrtho;
uniform vec2 uSize;
uniform float uStrength;
uniform float uReach;
uniform float uFrame;
varying vec2 vUv;

#include <common>
#include <packing>
#include <cube_uv_reflection_fragment>

float viewZAt(float depth) {
  return uOrtho > 0.5 ? orthographicDepthToViewZ(depth, uNear, uFar) : perspectiveDepthToViewZ(depth, uNear, uFar);
}

vec3 viewAt(vec2 uv, float depth) {
  vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}

// three.js's split-sum fit of a GGX reflection's scale and bias (DFGApprox)
vec2 envBRDF(float dotNV, float roughness) {
  const vec4 c0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 c1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 r = roughness * c0 + c1;
  float a004 = min(r.x * r.x, exp2(-9.28 * dotNV)) * r.x + r.y;
  return vec2(-1.04, 1.04) * a004 + r.zw;
}

// interleaved gradient noise: where along its first step each pixel's ray starts
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

void main() {
  vec3 base = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).x;
  vec4 nr = texture2D(tNormal, vUv);
  float roughness = nr.a;
  if (depth >= 1.0 || roughness > ${MAX_ROUGHNESS.toFixed(2)}) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }

  vec3 n = normalize(nr.rgb * 2.0 - 1.0);
  vec3 p = viewAt(vUv, depth);
  vec3 v = uOrtho > 0.5 ? vec3(0.0, 0.0, -1.0) : normalize(p);
  vec3 r = normalize(reflect(v, n));
  float dotNV = clamp(dot(n, -v), 0.0, 1.0);

  // off the face a little, so the ray does not meet the face it leaves
  vec3 start = p + n * (0.01 + 0.002 * abs(p.z));
  float reach = uReach;
  // a ray toward the eye ends before the near plane
  if (uOrtho < 0.5 && r.z > 0.0) reach = min(reach, (-uNear * 1.01 - start.z) / r.z);
  vec3 end = start + r * max(reach, 0.0);

  vec4 h0 = uProj * vec4(start, 1.0);
  vec4 h1 = uProj * vec4(end, 1.0);
  float k0 = 1.0 / h0.w;
  float k1 = 1.0 / h1.w;
  vec2 s0 = (h0.xy * k0 * 0.5 + 0.5) * uSize;
  vec2 s1 = (h1.xy * k1 * 0.5 + 0.5) * uSize;
  // the ray's depth is interpolated as z / w and 1 / w, which run straight across the screen
  float q0 = start.z * k0;
  float q1 = end.z * k1;
  float steps = clamp(length(s1 - s0) / float(${STRIDE_PX}), 1.0, float(${MAX_STEPS}));
  float jitter = ign(gl_FragCoord.xy + uFrame * vec2(17.0, 29.0));

  // A step that lands behind the depth is searched back to where the ray crosses it. On a face the
  // crossing is close to the face's depth; at a silhouette the depth jumps there and the ray passed
  // behind the object, so the march goes on. A hit so does not hang on where the steps fell.
  float lo = 0.0;
  float hi = -1.0;
  for (int i = 0; i < ${MAX_STEPS}; i++) {
    if (float(i) >= steps) break;
    float t = (float(i) + jitter) / steps;
    vec2 uv = mix(s0, s1, t) / uSize;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float rayZ = mix(q0, q1, t) / mix(k0, k1, t);
    float sceneDepth = texture2D(tDepth, uv).x;
    if (sceneDepth < 1.0 && viewZAt(sceneDepth) > rayZ) {
      float a = lo;
      float b = t;
      for (int k = 0; k < ${REFINE_STEPS}; k++) {
        float m = 0.5 * (a + b);
        vec2 mu = mix(s0, s1, m) / uSize;
        float d = texture2D(tDepth, mu).x;
        if (d < 1.0 && viewZAt(d) > mix(q0, q1, m) / mix(k0, k1, m)) b = m;
        else a = m;
      }
      vec2 bu = mix(s0, s1, b) / uSize;
      float bz = mix(q0, q1, b) / mix(k0, k1, b);
      float gap = viewZAt(texture2D(tDepth, bu).x) - bz;
      if (gap < 0.03 + 0.01 * abs(bz)) {
        hi = b;
        break;
      }
    }
    lo = t;
  }
  if (hi < 0.0) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }

  vec2 hitPx = mix(s0, s1, hi);
  vec2 hitUv = hitPx / uSize;

  // a face the ray meets from behind is not on screen: its colour there is another face's
  vec3 hitNormal = normalize(texture2D(tNormal, hitUv).rgb * 2.0 - 1.0);
  float facing = 1.0 - smoothstep(-0.1, 0.25, dot(hitNormal, r));
  vec2 edge = min(hitUv, 1.0 - hitUv);
  float onScreen = smoothstep(0.0, 0.06, min(edge.x, edge.y));
  float within = 1.0 - smoothstep(0.7, 1.0, hi);
  float glossy = 1.0 - smoothstep(${(MAX_ROUGHNESS * 0.6).toFixed(2)}, ${MAX_ROUGHNESS.toFixed(2)}, roughness);
  float fade = facing * onScreen * within * glossy;
  if (fade <= 0.0) {
    gl_FragColor = vec4(base, 1.0);
    return;
  }

  // a rough face blurs what it reflects the more, the farther it lies: a cone through the mips
  float cone = roughness * roughness * 1.5;
  float lod = log2(max(1.0, 2.0 * length(hitPx - s0) * cone));
  vec3 hit = textureLod(tBlurred, hitUv, lod).rgb;

  // what the material reflected there already: the sky, as three.js blurs it for this roughness
  vec3 sky = vec3(0.0);
  if (uHasEnv > 0.5) {
    vec3 dir = normalize(mix(r, n, pow4(roughness)));
    sky = textureCubeUV(tEnv, normalize(mat3(uCamWorld) * dir), roughness).rgb;
  }
  vec2 fab = envBRDF(dotNV, roughness);
  vec3 weight = texture2D(tReflect, vUv).rgb * fab.x + fab.y;
  gl_FragColor = vec4(max(base + uStrength * fade * weight * (hit - sky), 0.0), 1.0);
}
`;

/** The picture's colour with mipmaps, read for a rough face's blurred reflection. */
function blurTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
}

/** The reflections as a composer pass: the picture in, the picture with its reflections out. */
export class ReflectionPass extends Pass {
  camera: THREE.Camera = new THREE.PerspectiveCamera();
  /** 0..1 */
  strength = 1;
  /** metres a ray travels at most */
  reach = 100;
  /** bumped per frame of a still, so each frame's rays start at other points and their average is smooth */
  frame = 0;
  private readonly gbuffer: GBufferPass;
  private readonly blurred: THREE.WebGLRenderTarget;
  private readonly copyMaterial = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null as THREE.Texture | null } },
    vertexShader: VERTEX,
    fragmentShader: COPY_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  private readonly copyQuad = new FullScreenQuad(this.copyMaterial);
  private readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tBlurred: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    tReflect: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    tEnv: { value: null as THREE.Texture | null },
    uHasEnv: { value: 0 },
    uProj: { value: new THREE.Matrix4() },
    uProjInv: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uOrtho: { value: 0 },
    uSize: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 1 },
    uReach: { value: 100 },
    uFrame: { value: 0 },
  };
  private readonly material = new THREE.ShaderMaterial({
    uniforms: this.uniforms,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    defines: { ENVMAP_TYPE_CUBE_UV: "" },
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  private readonly quad = new FullScreenQuad(this.material);
  /** the sky as three.js prefilters it for rough reflections, made again when the sky changes */
  private env: { readonly sky: THREE.Texture; readonly target: THREE.WebGLRenderTarget } | null = null;
  private envHeight = 0;

  constructor(gbuffer: GBufferPass, width: number, height: number) {
    super();
    this.gbuffer = gbuffer;
    this.blurred = blurTarget(width, height);
    // compiled for some size until a sky is prefiltered, as the shader reads the defines either way
    this.sizeCubeUv(256);
  }

  /** Takes up the scene's sky (null: none), prefiltering it when it is new. */
  setSky(renderer: THREE.WebGLRenderer, sky: THREE.Texture | null): void {
    if (this.env?.sky === sky) return;
    this.env?.target.dispose();
    this.env = null;
    if (!sky) return;
    const generator = new THREE.PMREMGenerator(renderer);
    try {
      this.env = { sky, target: generator.fromEquirectangular(sky) };
    } finally {
      generator.dispose();
    }
    this.sizeCubeUv(this.env.target.texture.image.height as number);
  }

  /** Compiles the cube-UV lookup for a prefiltered map `height` px high, as three.js does (WebGLProgram's generateCubeUVSize). */
  private sizeCubeUv(height: number): void {
    if (height === this.envHeight) return;
    this.envHeight = height;
    const maxMip = Math.log2(height) - 2;
    this.material.defines.CUBEUV_TEXEL_WIDTH = String(1 / (3 * Math.max(2 ** maxMip, 7 * 16)));
    this.material.defines.CUBEUV_TEXEL_HEIGHT = String(1 / height);
    this.material.defines.CUBEUV_MAX_MIP = `${maxMip}.0`;
    this.material.needsUpdate = true;
  }

  setSize(width: number, height: number): void {
    this.blurred.setSize(width, height);
  }

  render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    // the blurred copy: rendering into a target with mipmaps makes them
    this.copyMaterial.uniforms.tColor.value = readBuffer.texture;
    renderer.setRenderTarget(this.blurred);
    this.copyQuad.render(renderer);

    const u = this.uniforms;
    const cam = this.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    u.tColor.value = readBuffer.texture;
    u.tBlurred.value = this.blurred.texture;
    u.tNormal.value = this.gbuffer.normal;
    u.tReflect.value = this.gbuffer.reflectance;
    u.tDepth.value = this.gbuffer.depth;
    u.tEnv.value = this.env?.target.texture ?? null;
    u.uHasEnv.value = this.env ? 1 : 0;
    u.uProj.value.copy(cam.projectionMatrix);
    u.uProjInv.value.copy(cam.projectionMatrixInverse);
    u.uCamWorld.value.copy(cam.matrixWorld);
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    u.uOrtho.value = cam instanceof THREE.OrthographicCamera ? 1 : 0;
    u.uSize.value.set(readBuffer.width, readBuffer.height);
    u.uStrength.value = this.strength;
    u.uReach.value = this.reach;
    u.uFrame.value = this.frame;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.blurred.dispose();
    this.copyMaterial.dispose();
    this.copyQuad.dispose();
    this.material.dispose();
    this.quad.dispose();
    this.env?.target.dispose();
    this.env = null;
  }
}
