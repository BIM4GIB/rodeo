// The last step of both engines: over the linear HDR picture, the lens's colour fringes and
// sharpening, fog by depth (thinning with height, glowing toward the sun), exposure, white balance,
// tone mapping, contrast, highlights and shadows, saturation, ink outlines along edges and creases
// (from the depth), vignette, then sRGB out with film grain. And a depth pre-pass for the path
// tracer's fog and outlines. A float target (Export HDRI) takes the picture linear instead, after
// the fog, exposure and white balance.

import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import type { RenderScene } from "./sceneBuilder.ts";
import type { RenderSettings, ToneMap } from "./settings.ts";

/** Outlines are a pixel wide, and grain a pixel across, on a picture this many pixels high; on a bigger one, wider. */
const OUTLINE_HEIGHT = 1200;

/** The value of the TONE_MAPPING define that picks each curve in the finish's shader. */
const TONE_MAPPING_DEFINE: Readonly<Record<ToneMap, number>> = { agx: 0, aces: 1, neutral: 2 };

const VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = `
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform float uFogOn;
uniform float uFogDensity;
uniform float uFogHeight;
uniform float uFogBase;
uniform vec3 uFogColor;
uniform float uFogGlow;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform float uOrtho;
uniform mat4 uCamWorld;
uniform mat4 uProjInv;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunUp;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform vec2 uTexel;
uniform float uAberration;
uniform float uSharpen;
uniform vec3 uWhite;
uniform float uHighlights;
uniform float uShadows;
uniform float uGrain;
uniform float uGrainCell;
uniform float uOutlines;
uniform vec3 uOutlineColor;
uniform float uOutlineWidth;
uniform float uNear;
uniform float uFar;
uniform float uDepthNoise;
uniform float uOutlineFar;

varying vec2 vUv;

#include <packing>
#include <tonemapping_pars_fragment>

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// the picture through the lens: red and blue drawn apart toward the edges
vec3 lensAt(vec2 uv) {
  if (uAberration <= 0.0) return texture2D(tColor, uv).rgb;
  vec2 shift = (uv - 0.5) * uAberration * 0.006;
  return vec3(texture2D(tColor, uv + shift).r, texture2D(tColor, uv).g, texture2D(tColor, uv - shift).b);
}

// A pixel's depth in a measure that runs straight across a flat face on the picture: one over the
// distance in perspective (0 for the sky), the distance itself in an orthogonal view.
float lineDepth(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  if (uOrtho > 0.5) return -orthographicDepthToViewZ(d, uNear, uFar);
  return d >= 1.0 ? 0.0 : -1.0 / perspectiveDepthToViewZ(d, uNear, uFar);
}

// 0..1, how much the pixel lies on an edge or a crease: across a flat face lineDepth's second
// difference is nothing beside its first; at an edge or a crease it is about as large.
float edgeAt(vec2 uv) {
  vec2 o = uTexel * uOutlineWidth;
  float c = lineDepth(uv);
  float l = lineDepth(uv - vec2(o.x, 0.0));
  float r = lineDepth(uv + vec2(o.x, 0.0));
  float b = lineDepth(uv - vec2(0.0, o.y));
  float t = lineDepth(uv + vec2(0.0, o.y));
  float eps = uOrtho > 0.5 ? 0.02 : 0.0015 * c + uDepthNoise;
  float ex = abs(l + r - 2.0 * c) / (abs(r - l) + eps);
  float ey = abs(b + t - 2.0 * c) / (abs(t - b) + eps);
  // lines fade out past the model, so the ground plane's far edge draws no horizon
  float nearest = uOrtho > 0.5 ? min(c, min(min(l, r), min(b, t))) : 1.0 / max(max(c, max(max(l, r), max(b, t))), 1.0e-6);
  return smoothstep(0.3, 0.7, max(ex, ey)) * (1.0 - smoothstep(uOutlineFar, 1.5 * uOutlineFar, nearest));
}

// white noise from a pixel cell
float hash(vec2 p) {
  uvec2 q = uvec2(ivec2(p) + 4096) * uvec2(1597334673u, 3812015801u);
  uint n = (q.x ^ q.y) * 1597334673u;
  return float(n) * (1.0 / 4294967295.0);
}

// Stands in for the sky's infinite distance (metres): the haze above the horizon still thins with height.
const float SKY_DISTANCE = 1.0e5;

// The fog's optical depth over a ray t metres long, from height y0 with slope ry. The density is
// uniform below the base and thins exponentially above it, so the integral splits at the base.
float fogDepth(float y0, float ry, float t) {
  if (uFogHeight <= 0.0) return uFogDensity * t;
  float k = 1.0 / uFogHeight;
  if (abs(ry) < 1.0e-6) return uFogDensity * t * exp(-k * max(y0 - uFogBase, 0.0));
  float split = clamp((uFogBase - y0) / ry, 0.0, t);
  float s0 = ry > 0.0 ? split : 0.0;
  float s1 = ry > 0.0 ? t : split;
  float below = ry > 0.0 ? split : t - split;
  float c = k * ry;
  float e0 = exp(-k * max(y0 + ry * s0 - uFogBase, 0.0));
  float above;
  if (abs(c) * (s1 - s0) < 1.0e-4) {
    above = (s1 - s0) * e0;
  } else {
    above = (e0 - exp(-k * max(y0 + ry * s1 - uFogBase, 0.0))) / c;
  }
  return uFogDensity * (below + above);
}

void main() {
  vec3 color = lensAt(vUv);
  if (uSharpen > 0.0) {
    vec3 n = lensAt(vUv + vec2(0.0, uTexel.y));
    vec3 s = lensAt(vUv - vec2(0.0, uTexel.y));
    vec3 e = lensAt(vUv + vec2(uTexel.x, 0.0));
    vec3 w = lensAt(vUv - vec2(uTexel.x, 0.0));
    // never past its neighbours' range, so an edge gains no halo
    vec3 lo = min(color, min(min(n, s), min(e, w)));
    vec3 hi = max(color, max(max(n, s), max(e, w)));
    color = clamp(color + uSharpen * 0.5 * (4.0 * color - n - s - e - w), lo, hi);
  }

  if (uFogOn > 0.5) {
    float depth = texture2D(tDepth, vUv).x;
    vec4 view = uProjInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    view /= view.w;
    vec3 world = (uCamWorld * vec4(view.xyz, 1.0)).xyz;
    vec3 toPoint = world - uCamPos;

    // a perspective camera's rays leave the eye; an orthogonal camera's run parallel, so a pixel's
    // distance is along the view and its ray starts in the plane of the eye
    vec3 rd;
    float dist;
    vec3 origin;
    if (uOrtho > 0.5) {
      rd = uCamForward;
      dist = dot(toPoint, rd);
      origin = world - rd * dist;
    } else {
      dist = length(toPoint);
      rd = toPoint / max(dist, 1.0e-6);
      origin = uCamPos;
    }

    float reach = depth >= 0.99999 ? SKY_DISTANCE : max(dist, 0.0);
    float transmittance = exp(-fogDepth(origin.y, rd.y, reach));

    vec3 inscatter = uFogColor;
    if (uSunUp > 0.5) {
      float towardSun = pow(max(dot(rd, uSunDir), 0.0), 8.0);
      inscatter = mix(uFogColor, uSunColor * 2.0, uFogGlow * towardSun);
    }
    color = mix(color, inscatter, 1.0 - transmittance);
  }

  color *= uExposure * uWhite;

#if LINEAR == 1
  // a float target keeps the picture linear and unclipped (Export HDRI): the grading is the imaging program's
  gl_FragColor = vec4(max(color, 0.0), 1.0);
  return;
#endif

#if TONE_MAPPING == 0
  color = AgXToneMapping(color);
#elif TONE_MAPPING == 1
  color = ACESFilmicToneMapping(color);
#else
  color = NeutralToneMapping(color);
#endif

  color = (color - 0.5) * (1.0 + uContrast) + 0.5;
  if (uHighlights != 0.0 || uShadows != 0.0) {
    // on the brightness as the eye reads it (gamma 2.2): shadows move the darker third most, highlights the lighter
    float p = pow(clamp(dot(color, LUMA), 0.0, 1.0), 1.0 / 2.2);
    float q = 1.0 - p;
    float moved = clamp(p + 1.6 * (uShadows * p * q * q + uHighlights * p * p * q), 0.0, 1.0);
    if (p > 1.0e-4) color *= pow(moved / p, 2.2);
  }
  float luma = dot(color, LUMA);
  color = mix(vec3(luma), color, 1.0 + uSaturation);
  if (uOutlines > 0.0) color = mix(color, uOutlineColor, uOutlines * edgeAt(vUv));
  // 1 at the corners, so the darkening reaches 45 % there at full strength
  float radius = length(vUv - 0.5) / 0.70710678;
  color *= 1.0 - 0.45 * uVignette * smoothstep(0.3, 1.0, radius);
  color = clamp(color, 0.0, 1.0);

  // the prefix already carries sRGBTransferOETF for a ShaderMaterial
  vec3 encoded = sRGBTransferOETF(vec4(color, 1.0)).rgb;
  if (uGrain > 0.0) {
    // on the encoded picture, so the grain is as plain in the shadows as in the light; strongest in the midtones
    float l = dot(encoded, LUMA);
    encoded += (hash(floor(gl_FragCoord.xy / uGrainCell)) - 0.5) * uGrain * 0.14 * (0.35 + 2.6 * l * (1.0 - l));
  }
  // interleaved gradient noise, half an 8-bit level either way, so slow gradients do not band
  float dither = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  encoded += (dither - 0.5) / 255.0;
  gl_FragColor = vec4(clamp(encoded, 0.0, 1.0), 1.0);
}
`;

/** Fog, exposure, tone mapping, grading and sRGB out, as one screen pass over a linear HDR picture. */
export class Finisher {
  private readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.DepthTexture | null },
    uFogOn: { value: 0 },
    uFogDensity: { value: 0 },
    uFogHeight: { value: 0 },
    uFogBase: { value: 0 },
    uFogColor: { value: new THREE.Color() },
    uFogGlow: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uCamForward: { value: new THREE.Vector3() },
    uOrtho: { value: 0 },
    uCamWorld: { value: new THREE.Matrix4() },
    uProjInv: { value: new THREE.Matrix4() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunUp: { value: 0 },
    uExposure: { value: 1 },
    uContrast: { value: 0 },
    uSaturation: { value: 0 },
    uVignette: { value: 0 },
    uTexel: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 0 },
    uSharpen: { value: 0 },
    uWhite: { value: new THREE.Vector3(1, 1, 1) },
    uHighlights: { value: 0 },
    uShadows: { value: 0 },
    uGrain: { value: 0 },
    uGrainCell: { value: 1 },
    uOutlines: { value: 0 },
    uOutlineColor: { value: new THREE.Color() },
    uOutlineWidth: { value: 1 },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uDepthNoise: { value: 0 },
    uOutlineFar: { value: 1000 },
    // the tone-mapping chunk reads this; the picture's exposure is uExposure, so it stays at 1
    toneMappingExposure: { value: 1 },
  };

  private readonly material = new THREE.ShaderMaterial({
    uniforms: this.uniforms,
    defines: { TONE_MAPPING: TONE_MAPPING_DEFINE.agx, LINEAR: 0 },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    // three's own tone mapping would be added on top of ours
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });

  private readonly quad = new FullScreenQuad(this.material);

  /**
   * Draws `color` (linear HDR) finished to `target` (null: the canvas), at the target's (or the
   * drawing buffer's) size; a float target takes it linear, before tone mapping (setLinear). `depth` is the scene's depth through `camera` (null: no fog and no
   * outlines). Leaves the renderer's state as it found it.
   */
  render(
    renderer: THREE.WebGLRenderer,
    color: THREE.Texture,
    depth: THREE.DepthTexture | null,
    camera: THREE.Camera,
    scene: RenderScene,
    settings: RenderSettings,
    target: THREE.WebGLRenderTarget | null,
  ): void {
    const height = target ? target.height : renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    this.setUniforms(color, depth, camera, scene, settings, height);
    this.setToneMap(settings.toneMap);
    this.setLinear(target?.texture.type === THREE.FloatType);

    const saved = {
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
      toneMapping: renderer.toneMapping,
      toneMappingExposure: renderer.toneMappingExposure,
      outputColorSpace: renderer.outputColorSpace,
    };
    renderer.setRenderTarget(target);
    // every pixel is written, so there is nothing to clear first
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    try {
      this.quad.render(renderer);
    } finally {
      renderer.setRenderTarget(saved.target);
      renderer.autoClear = saved.autoClear;
      renderer.toneMapping = saved.toneMapping;
      renderer.toneMappingExposure = saved.toneMappingExposure;
      renderer.outputColorSpace = saved.outputColorSpace;
    }
  }

  dispose(): void {
    this.material.dispose();
    this.quad.dispose();
  }

  private setUniforms(
    color: THREE.Texture,
    depth: THREE.DepthTexture | null,
    camera: THREE.Camera,
    scene: RenderScene,
    settings: RenderSettings,
    height: number,
  ): void {
    const u = this.uniforms;
    const { fog, effects } = settings;
    u.tColor.value = color;
    u.tDepth.value = depth;
    u.uFogOn.value = fog.on && depth !== null ? 1 : 0;
    // ln 20: fog this dense hides 95 % of what lies at `distance`
    u.uFogDensity.value = Math.log(20) / Math.max(fog.distance, 1);
    u.uFogHeight.value = Math.max(fog.height, 0);
    const floor = scene.bounds.min.y;
    u.uFogBase.value = (Number.isFinite(floor) ? floor : 0) + fog.base;
    u.uFogColor.value.set(fog.color);
    u.uFogGlow.value = fog.glow;

    // read the camera's matrices as they stand: the lens shifts live in them
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uOrtho.value = camera instanceof THREE.OrthographicCamera ? 1 : 0;
    camera.getWorldDirection(u.uCamForward.value);

    u.uSunDir.value.copy(scene.sun.dir);
    u.uSunColor.value.copy(scene.sun.color);
    u.uSunUp.value = scene.sun.up ? 1 : 0;

    u.uExposure.value = Math.pow(2, settings.exposure);
    u.uContrast.value = effects.contrast;
    u.uSaturation.value = effects.saturation;
    u.uVignette.value = effects.vignette;

    const image = color.image as { width?: number; height?: number } | null;
    u.uTexel.value.set(1 / Math.max(1, image?.width ?? 1), 1 / Math.max(1, image?.height ?? 1));
    u.uAberration.value = effects.aberration;
    u.uSharpen.value = effects.sharpen;
    whiteBalance(effects.temperature, effects.tint, u.uWhite.value);
    u.uHighlights.value = effects.highlights;
    u.uShadows.value = effects.shadows;
    // grain and lines keep their size on the picture whatever its pixel count
    const scale = Math.max(1, height / OUTLINE_HEIGHT);
    u.uGrain.value = effects.grain;
    u.uGrainCell.value = scale;
    u.uOutlines.value = depth ? effects.outlines : 0;
    u.uOutlineColor.value.set(effects.outlineColor);
    u.uOutlineWidth.value = scale;
    const lens = camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    u.uNear.value = lens.near;
    u.uFar.value = lens.far;
    // a few steps of a float depth near 1, as one over the distance: what a flat face's depth wavers by
    u.uDepthNoise.value = (3 * 1.2e-7) / Math.max(lens.near, 1e-4);
    // as far as the far side of the model (an orthogonal view measures along its view, a perspective one from its eye)
    const diagonal = scene.bounds.getSize(new THREE.Vector3()).length();
    const toCentre = scene.bounds.getCenter(new THREE.Vector3()).sub(u.uCamPos.value);
    u.uOutlineFar.value = (u.uOrtho.value > 0.5 ? u.uCamForward.value.dot(toCentre) : toCentre.length()) + diagonal;
  }

  /** Recompiles only when the curve changes. */
  private setToneMap(map: ToneMap): void {
    const id = TONE_MAPPING_DEFINE[map];
    if (this.material.defines.TONE_MAPPING === id) return;
    this.material.defines.TONE_MAPPING = id;
    this.material.needsUpdate = true;
  }

  /** Linear out (a float target): fog, exposure and white balance only, no tone mapping, grading, vignette, grain or sRGB. */
  private setLinear(on: boolean): void {
    const v = on ? 1 : 0;
    if (this.material.defines.LINEAR === v) return;
    this.material.defines.LINEAR = v;
    this.material.needsUpdate = true;
  }
}

/**
 * The white balance's gain per channel: warmer (`temperature` up to 1) adds red and takes blue, a
 * magenta `tint` (up to 1) takes green, -1 the other way; the brightness stays.
 */
function whiteBalance(temperature: number, tint: number, out: THREE.Vector3): void {
  const r = 1 + 0.3 * temperature + 0.06 * tint;
  const g = 1 - 0.12 * tint;
  const b = 1 - 0.3 * temperature + 0.06 * tint;
  const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  out.set(r / luma, g / luma, b / luma);
}

/** The scene's depth through a camera, for fog and outlines over a path-traced picture. */
export class DepthPrepass {
  private readonly material = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
  private current: { readonly target: THREE.WebGLRenderTarget; readonly depth: THREE.DepthTexture } | null = null;

  /** Renders the depth at width × height (kept until the size or a call with changed: true) and returns it. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, width: number, height: number): THREE.DepthTexture {
    const { target, depth } = this.targetFor(width, height);
    const saved = {
      background: scene.background,
      overrideMaterial: scene.overrideMaterial,
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
    };
    // the sky is not a surface: it stays at the far end of the depth
    scene.background = null;
    scene.overrideMaterial = this.material;
    renderer.setRenderTarget(target);
    renderer.autoClear = true;
    try {
      renderer.render(scene, camera);
    } finally {
      scene.background = saved.background;
      scene.overrideMaterial = saved.overrideMaterial;
      renderer.setRenderTarget(saved.target);
      renderer.autoClear = saved.autoClear;
    }
    return depth;
  }

  dispose(): void {
    this.free();
    this.material.dispose();
  }

  private targetFor(width: number, height: number): { target: THREE.WebGLRenderTarget; depth: THREE.DepthTexture } {
    if (this.current && this.current.target.width === width && this.current.target.height === height) {
      return { target: this.current.target, depth: this.current.depth };
    }
    this.free();
    const depth = new THREE.DepthTexture(width, height, THREE.FloatType);
    const target = new THREE.WebGLRenderTarget(width, height, { depthTexture: depth });
    this.current = { target, depth };
    return { target, depth };
  }

  private free(): void {
    if (!this.current) return;
    this.current.target.dispose();
    this.current.depth.dispose();
    this.current = null;
  }
}
