// What both engines do to their linear HDR picture before finish.ts: the lens's depth of field
// (Realistic: the path tracer's lens blurs its own picture) and the bloom, then the finish. The
// depth of field gathers each pixel's blur along a golden-angle spiral, as wide as the thin lens
// with the camera's f-stop and focus would make it, so it matches the path tracer's. A first pass
// takes the widest blur near each tile of the picture, so a sharp region stops gathering at once.
// The bloom runs at about 1080 px high, so it spreads alike in the view and in an 8K render.

import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Finisher } from "./finish.ts";
import type { RenderScene } from "./sceneBuilder.ts";
import type { RenderSettings } from "./settings.ts";

/** The bloom's working height: a bigger picture is blurred smaller and spread over it. */
const BLOOM_HEIGHT = 1080;
/** The widest blur, a radius in a share of the picture's height (the near ground would blur without end). */
const MAX_BLUR = 0.022;
/** A tile of the depth of field's first pass, px a side. */
const TILE = 16;
/** Taps along the spiral a pixel blurred the most takes in the view, at most, and the most for all of them together. */
const LIVE_TAPS = 160;
const LIVE_BUDGET = 4e8;
/** A finished picture's taps, at most (one per pixel of the blur's disc up to that), drawn in strips of about this many taps each. */
const FINISHED_TAPS = 512;
const STRIP_BUDGET = 3e8;

const VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** The blur radius in px a pixel at `depth` takes; uCoc is px for each unit of |z − focus| / z. */
const COC = `
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uCoc;
uniform float uMaxBlur;

float distanceAt(float depth) {
  return -perspectiveDepthToViewZ(depth, uNear, uFar);
}

float blurAt(float z) {
  return min(uMaxBlur, uCoc * abs(z - uFocus) / max(z, 1.0e-4));
}
`;

const TILE_FRAGMENT = `
#include <packing>
uniform sampler2D tDepth;
uniform vec2 uSize;
uniform float uReach;
varying vec2 vUv;
${COC}

// the widest blur within uReach px of this tile, from a sparse grid of the depth
void main() {
  float widest = 0.0;
  vec2 px = 1.0 / uSize;
  for (int y = -6; y <= 6; y++) {
    for (int x = -6; x <= 6; x++) {
      vec2 uv = vUv + vec2(float(x), float(y)) * (uReach / 6.0) * px;
      widest = max(widest, blurAt(distanceAt(texture2D(tDepth, clamp(uv, 0.0, 1.0)).x)));
    }
  }
  gl_FragColor = vec4(widest, 0.0, 0.0, 1.0);
}
`;

const DOF_FRAGMENT = `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tTiles;
uniform vec2 uSize;
uniform float uTaps;
varying vec2 vUv;
${COC}

const float GOLDEN_ANGLE = 2.39996323;

void main() {
  vec2 px = 1.0 / uSize;
  float centerZ = distanceAt(texture2D(tDepth, vUv).x);
  float centerBlur = blurAt(centerZ);
  vec3 color = texture2D(tColor, vUv).rgb;
  float reach = texture2D(tTiles, vUv).r;
  if (reach < 0.5) {
    gl_FragColor = vec4(color, 1.0);
    return;
  }
  // the spiral's rings: one tap per unit of area at full density, fewer when that would be too many
  float spacing = max(0.5, reach * reach / (2.0 * uTaps));
  float tot = 1.0;
  float radius = spacing;
  float angle = 0.0;
  for (int i = 0; i < 4096; i++) {
    if (radius >= reach) break;
    vec2 uv = vUv + vec2(cos(angle), sin(angle)) * radius * px;
    vec3 tap = texture2D(tColor, uv).rgb;
    float z = distanceAt(texture2D(tDepth, uv).x);
    float blur = blurAt(z);
    // what lies behind a sharper pixel does not spread over it
    if (z > centerZ) blur = min(blur, centerBlur * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, blur);
    color += mix(color / tot, tap, m);
    tot += 1.0;
    radius += spacing / radius;
    angle += GOLDEN_ANGLE;
  }
  gl_FragColor = vec4(color / tot, 1.0);
}
`;

const COPY_FRAGMENT = `
uniform sampler2D tColor;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(texture2D(tColor, vUv).rgb, 1.0);
}
`;

/** The lens a camera has for depth of field: a PhysicalCamera's (three-gpu-pathtracer), read without importing it. */
interface Lens {
  readonly fStop?: number;
  readonly focusDistance?: number;
  getFocalLength?(): number;
}

/** Whether the picture's finish reads the scene's depth: for fog, the outlines, and the depth of field when the engine blurs (`lensBlur`). */
export function needsDepth(settings: RenderSettings, lensBlur: boolean): boolean {
  return settings.fog.on || settings.effects.outlines > 0 || (lensBlur && settings.camera.dof);
}

function hdrTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, depthBuffer: false });
}

/** Depth of field and bloom over a linear HDR picture, then the finish (finish.ts). */
export class PostStack {
  private readonly finisher = new Finisher();
  private readonly cocUniforms = {
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uFocus: { value: 10 },
    uCoc: { value: 0 },
    uMaxBlur: { value: 0 },
  };
  private readonly tileMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...this.cocUniforms,
      tDepth: { value: null as THREE.Texture | null },
      uSize: { value: new THREE.Vector2() },
      uReach: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: TILE_FRAGMENT,
    depthTest: false,
    depthWrite: false,
  });
  private readonly dofMaterial = new THREE.ShaderMaterial({
    uniforms: {
      ...this.cocUniforms,
      tColor: { value: null as THREE.Texture | null },
      tDepth: { value: null as THREE.Texture | null },
      tTiles: { value: null as THREE.Texture | null },
      uSize: { value: new THREE.Vector2() },
      uTaps: { value: LIVE_TAPS },
    },
    vertexShader: VERTEX,
    fragmentShader: DOF_FRAGMENT,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  private readonly copyMaterial = new THREE.ShaderMaterial({
    uniforms: { tColor: { value: null as THREE.Texture | null } },
    vertexShader: VERTEX,
    fragmentShader: COPY_FRAGMENT,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  private readonly quad = new FullScreenQuad();
  /** the widest blur near each tile (nearest: a tile's own value, never its neighbour's) */
  private readonly tiles = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false });
  /** the picture the bloom is added to: the depth of field's, or a copy of the engine's */
  private readonly work = hdrTarget(1, 1);
  private readonly bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0.4, 1);
  private bloomSize = "";

  /**
   * Draws `color` (linear HDR) through the depth of field (when `lensBlur` and the lens asks for it)
   * and the bloom, finished, to `target` (null: the canvas). `depth` is the scene's depth through
   * `camera`, or null when needsDepth says it is not needed. `finished`: a picture to keep, which
   * takes every tap of the blur. Leaves the renderer's state as it found it.
   */
  render(
    renderer: THREE.WebGLRenderer,
    color: THREE.Texture,
    depth: THREE.DepthTexture | null,
    camera: THREE.Camera,
    scene: RenderScene,
    settings: RenderSettings,
    target: THREE.WebGLRenderTarget | null,
    lensBlur: boolean,
    finished = false,
  ): void {
    const size = target ? new THREE.Vector2(target.width, target.height) : renderer.getDrawingBufferSize(new THREE.Vector2());
    const width = Math.max(1, Math.floor(size.x));
    const height = Math.max(1, Math.floor(size.y));
    const saved = { target: renderer.getRenderTarget(), autoClear: renderer.autoClear, toneMapping: renderer.toneMapping };
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    let picture = color;
    try {
      if (lensBlur && depth && settings.camera.dof && this.focus(camera, height)) {
        this.blurByDepth(renderer, picture, depth, width, height, finished);
        picture = this.work.texture;
      }
      const fx = settings.effects;
      if (fx.bloom > 0) {
        if (picture !== this.work.texture) this.copy(renderer, picture, width, height);
        this.glow(renderer, fx, Math.pow(2, settings.exposure), width, height);
        picture = this.work.texture;
      }
    } finally {
      renderer.setRenderTarget(saved.target);
      renderer.autoClear = saved.autoClear;
      renderer.toneMapping = saved.toneMapping;
    }
    this.finisher.render(renderer, picture, depth, camera, scene, settings, target);
  }

  dispose(): void {
    this.finisher.dispose();
    this.tileMaterial.dispose();
    this.dofMaterial.dispose();
    this.copyMaterial.dispose();
    this.quad.dispose();
    this.tiles.dispose();
    this.work.dispose();
    this.bloom.dispose();
  }

  /**
   * Sets the blur's uniforms from `camera`'s lens for a picture `height` px high; false when it has no
   * aperture (an orthographic camera, or depth of field off). The blur on the picture of something
   * z metres away, focused at s, is A·|z − s| / z across at the focus (A the aperture, the focal
   * length over the f-number), which the picture's height spans 2·s·tan(fov / 2) of.
   */
  private focus(camera: THREE.Camera, height: number): boolean {
    if (!(camera instanceof THREE.PerspectiveCamera)) return false;
    const lens = camera as THREE.PerspectiveCamera & Lens;
    const fStop = lens.fStop ?? Infinity;
    if (!Number.isFinite(fStop) || fStop <= 0) return false;
    const focus = Math.max(lens.focusDistance ?? 10, 0.01);
    const aperture = camera.getFocalLength() / 1000 / fStop;
    // a view offset shows part of the lens's picture: the pixels span that part
    const part = camera.view?.enabled ? camera.view.height / camera.view.fullHeight : 1;
    const span = (2 * focus * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * part) / camera.zoom;
    const u = this.cocUniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocus.value = focus;
    // a radius: half the blur's width
    u.uCoc.value = (0.5 * aperture * height) / span;
    u.uMaxBlur.value = Math.max(2, MAX_BLUR * height);
    return true;
  }

  /** The depth of field of `color` into `work`. */
  private blurByDepth(renderer: THREE.WebGLRenderer, color: THREE.Texture, depth: THREE.DepthTexture, width: number, height: number, finished: boolean): void {
    const reach = this.cocUniforms.uMaxBlur.value;
    this.tiles.setSize(Math.ceil(width / TILE), Math.ceil(height / TILE));
    const t = this.tileMaterial.uniforms;
    t.tDepth.value = depth;
    t.uSize.value.set(width, height);
    // a tile gathers from as far as the widest blur reaches, and its own half-width beyond
    t.uReach.value = reach + TILE / 2;
    this.draw(renderer, this.tileMaterial, this.tiles);

    this.work.setSize(width, height);
    const d = this.dofMaterial.uniforms;
    d.tColor.value = color;
    d.tDepth.value = depth;
    d.tTiles.value = this.tiles.texture;
    d.uSize.value.set(width, height);
    if (!finished) {
      // a big view takes fewer taps, so a frame stays quick
      d.uTaps.value = Math.min(LIVE_TAPS, Math.max(24, LIVE_BUDGET / (width * height)));
      this.draw(renderer, this.dofMaterial, this.work);
      return;
    }
    const taps = Math.min(FINISHED_TAPS, Math.PI * reach * reach);
    d.uTaps.value = taps;
    // in strips, each waited for: one draw over a whole 8K picture could keep the GPU long enough for the system to reset it
    const rows = Math.max(16, Math.floor(STRIP_BUDGET / (taps * width)));
    const gl = renderer.getContext();
    this.work.scissorTest = true;
    try {
      for (let y = 0; y < height; y += rows) {
        this.work.scissor.set(0, y, width, Math.min(rows, height - y));
        this.draw(renderer, this.dofMaterial, this.work);
        gl.finish();
      }
    } finally {
      this.work.scissorTest = false;
      this.work.scissor.set(0, 0, width, height);
    }
  }

  /** Adds the bloom to `work`: what is brighter than the threshold (after exposure) glows. */
  private glow(renderer: THREE.WebGLRenderer, fx: RenderSettings["effects"], exposure: number, width: number, height: number): void {
    const scale = Math.min(1, BLOOM_HEIGHT / height);
    const key = `${Math.round(width * scale)}x${Math.round(height * scale)}`;
    if (key !== this.bloomSize) {
      this.bloomSize = key;
      this.bloom.setSize(Math.round(width * scale), Math.round(height * scale));
    }
    const threshold = Math.max(0, fx.bloomThreshold) / exposure;
    this.bloom.strength = fx.bloom;
    this.bloom.radius = fx.bloomSize;
    this.bloom.threshold = threshold;
    // a soft knee half the threshold wide, so the glow comes in gently
    (this.bloom.highPassUniforms as Record<string, THREE.IUniform<number>>).smoothWidth.value = Math.max(0.01, threshold * 0.5);
    this.bloom.render(renderer, null as unknown as THREE.WebGLRenderTarget, this.work, 0, false);
  }

  private copy(renderer: THREE.WebGLRenderer, color: THREE.Texture, width: number, height: number): void {
    this.work.setSize(width, height);
    this.copyMaterial.uniforms.tColor.value = color;
    this.draw(renderer, this.copyMaterial, this.work);
  }

  private draw(renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget): void {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }
}
