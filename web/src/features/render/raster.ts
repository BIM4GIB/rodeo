// Realistic: the render scene rasterised at once: a G-buffer (depth, normals, roughness and F0),
// then PBR with soft sun shadows and the sky's light into a linear HDR target, ambient occlusion and
// screen-space reflections from the G-buffer, then post.ts (depth of field, bloom and the finish).
// Fast enough to orbit.

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { GBufferPass } from "./gbuffer.ts";
import { PostStack, needsDepth } from "./post.ts";
import type { RenderScene } from "./sceneBuilder.ts";
import type { RenderSettings } from "./settings.ts";
import { ReflectionPass } from "./ssr.ts";

/** Samples a pixel's HDR buffers resolve from, where the GPU has that many. */
const MSAA_SAMPLES = 4;
/** How far, in metres of render space, ambient occlusion looks for what shades a point. */
const AO_RADIUS = 0.5;
/** How far a reflected ray travels, in the model's diagonals, at least REFLECT_MIN metres. */
const REFLECT_REACH = 3;
const REFLECT_MIN = 20;

const SCREEN_VERTEX = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const ACCUM_FRAGMENT = `
uniform sampler2D tFrame;
uniform sampler2D tPrev;
uniform float uWeight;
varying vec2 vUv;

void main() {
  gl_FragColor = vec4(mix(texture2D(tPrev, vUv).rgb, texture2D(tFrame, vUv).rgb, uWeight), 1.0);
}
`;

/** What a frame changes on the renderer and its shadow maps, put back afterwards. */
interface SavedState {
  readonly target: THREE.WebGLRenderTarget | null;
  readonly autoClear: boolean;
  readonly toneMapping: THREE.ToneMapping;
  readonly toneMappingExposure: number;
  readonly outputColorSpace: string;
  readonly clearColor: THREE.Color;
  readonly clearAlpha: number;
  readonly shadowEnabled: boolean;
  readonly shadowType: THREE.ShadowMapType;
  readonly shadowAutoUpdate: boolean;
  readonly shadowNeedsUpdate: boolean;
}

export class RasterEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly gbuffer: GBufferPass;
  private readonly renderPass: RenderPass;
  /** the spots' beams in haze, added over the lit picture in its depth (RenderScene.beams) */
  private readonly beamPass: RenderPass;
  private readonly ao: GTAOPass;
  private readonly reflections: ReflectionPass;
  private readonly post = new PostStack();
  private readonly accumUniforms = {
    tFrame: { value: null as THREE.Texture | null },
    tPrev: { value: null as THREE.Texture | null },
    uWeight: { value: 1 },
  };
  private readonly accumMaterial = new THREE.ShaderMaterial({
    uniforms: this.accumUniforms,
    vertexShader: SCREEN_VERTEX,
    fragmentShader: ACCUM_FRAGMENT,
    blending: THREE.NoBlending,
    toneMapped: false,
    depthTest: false,
    depthWrite: false,
  });
  private readonly accumQuad = new FullScreenQuad(this.accumMaterial);
  /** Two float buffers the stills' running average ping-pongs between (a float blend is not guaranteed). */
  private accum: { readonly a: THREE.WebGLRenderTarget; readonly b: THREE.WebGLRenderTarget } | null = null;
  private width = 0;
  private height = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    const { width, height } = sizeOf(renderer, null);
    this.width = width;
    this.height = height;

    const samples = renderer.capabilities.maxSamples >= MSAA_SAMPLES ? MSAA_SAMPLES : 0;
    const buffer = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, buffer);
    // the picture stays in the composer's read buffer for the finisher; nothing draws to the canvas here
    this.composer.renderToScreen = false;
    this.composer.setPixelRatio(1);

    // stand-ins until the first render gives the passes the scene and camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    this.gbuffer = new GBufferPass(width, height);
    this.renderPass = new RenderPass(scene, camera);
    this.beamPass = new RenderPass(scene, camera);
    this.beamPass.clear = false;
    this.ao = new GTAOPass(scene, camera, width, height);
    // the AO reads the G-buffer's depth and normals instead of drawing its own
    this.ao.setGBuffer(this.gbuffer.depth, this.gbuffer.normal);
    this.ao.updateGtaoMaterial({ radius: AO_RADIUS, distanceExponent: 1, thickness: 1, scale: 1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 16 });
    this.reflections = new ReflectionPass(this.gbuffer, width, height);

    // the G-buffer first: the sun's shadow maps are drawn with it, and the picture reuses them
    this.composer.addPass(this.gbuffer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.beamPass);
    this.composer.addPass(this.ao);
    this.composer.addPass(this.reflections);
  }

  /** Draws a frame through `camera` (render space) to `target` (null: the canvas, at the drawing buffer's size). Leaves the renderer's state as it found it. */
  render(scene: RenderScene, camera: THREE.Camera, settings: RenderSettings, target: THREE.WebGLRenderTarget | null = null): void {
    const { width, height } = sizeOf(this.renderer, target);
    this.configure(scene, camera, settings, width, height);
    const leave = this.enter(scene);
    try {
      this.reflections.frame = 0;
      this.composer.render(0);
      const depth = needsDepth(settings, true) ? this.gbuffer.depth : null;
      this.post.render(this.renderer, this.composer.readBuffer.texture, depth, camera, scene, settings, target, true);
    } finally {
      leave();
    }
  }

  /** A still: `samples` frames, each with the camera jittered under a pixel, averaged (anti-aliasing for finished renders). */
  renderStill(scene: RenderScene, camera: THREE.Camera, settings: RenderSettings, samples: number, target: THREE.WebGLRenderTarget | null = null): void {
    const { width, height } = sizeOf(this.renderer, target);
    this.configure(scene, camera, settings, width, height);
    const leave = this.enter(scene);
    try {
      const mean = this.average(camera, Math.max(1, Math.floor(samples)), width, height);
      // the depth of field, fog and outlines read depth through the camera as it is, not jittered
      let depth: THREE.DepthTexture | null = null;
      if (needsDepth(settings, true)) {
        this.gbuffer.draw(this.renderer, scene.scene, camera);
        depth = this.gbuffer.depth;
      }
      this.post.render(this.renderer, mean.texture, depth, camera, scene, settings, target, true, true);
    } finally {
      leave();
    }
  }

  dispose(): void {
    this.composer.dispose();
    this.gbuffer.dispose();
    this.renderPass.dispose();
    this.beamPass.dispose();
    this.ao.dispose();
    this.reflections.dispose();
    this.post.dispose();
    this.accumQuad.dispose();
    this.accumMaterial.dispose();
    if (this.accum) {
      this.accum.a.dispose();
      this.accum.b.dispose();
      this.accum = null;
    }
  }

  /** Points the passes at this frame's scene and camera, and sizes them. */
  private configure(scene: RenderScene, camera: THREE.Camera, settings: RenderSettings, width: number, height: number): void {
    const { effects } = settings;
    this.gbuffer.scene = scene.scene;
    this.gbuffer.camera = camera;
    this.renderPass.scene = scene.scene;
    this.renderPass.camera = camera;
    this.beamPass.scene = scene.beams;
    this.beamPass.camera = camera;
    this.beamPass.enabled = scene.beams.children.length > 0;
    this.ao.scene = scene.scene;
    this.ao.camera = camera;
    this.reflections.camera = camera;

    // the ambient occlusion shader is compiled for one kind of camera; a switch needs a recompile
    const perspective = camera instanceof THREE.PerspectiveCamera ? 1 : 0;
    if (this.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== perspective) {
      this.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = perspective;
      this.ao.gtaoMaterial.needsUpdate = true;
    }
    this.ao.enabled = effects.ao > 0;
    this.ao.blendIntensity = effects.ao;
    this.reflections.enabled = effects.reflections > 0;
    this.reflections.strength = effects.reflections;
    this.reflections.reach = Math.max(REFLECT_MIN, REFLECT_REACH * scene.bounds.getSize(new THREE.Vector3()).length());
    if (this.reflections.enabled) this.reflections.setSky(this.renderer, scene.scene.environment);
    this.gbuffer.enabled = this.ao.enabled || this.reflections.enabled || needsDepth(settings, true);

    this.resize(width, height);
  }

  private resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.composer.setSize(width, height);
  }

  /**
   * Sets the renderer for a frame and returns what puts it back. The shadow maps are drawn once per
   * frame: the first pass draws them and the rest reuse them.
   */
  private enter(scene: RenderScene): () => void {
    const renderer = this.renderer;
    const saved = saveState(renderer);
    const shadows = renderer.shadowMap;
    shadows.enabled = true;
    shadows.type = THREE.PCFShadowMap;
    shadows.autoUpdate = false;
    shadows.needsUpdate = true;
    renderer.toneMapping = THREE.NoToneMapping;

    // lamps past the raster's limit are left out; a lamp already hidden stays hidden
    const hidden = scene.lamps.filter((lamp) => lamp.userData.rasterSkip && lamp.visible);
    for (const lamp of hidden) lamp.visible = false;

    return () => {
      for (const lamp of hidden) lamp.visible = true;
      restoreState(renderer, saved);
    };
  }

  /**
   * The mean of `count` jittered frames, each composed as a frame and blended in. The camera's
   * matrices are put back as they were.
   */
  private average(camera: THREE.Camera, count: number, width: number, height: number): THREE.WebGLRenderTarget {
    const buffers = this.accumulation(width, height);
    const base = camera.projectionMatrix.clone();
    const baseInverse = camera.projectionMatrixInverse.clone();
    let mean = buffers.a;
    let spare = buffers.b;
    try {
      for (let i = 0; i < count; i++) {
        jitter(camera, base, halton(i + 1, 2) - 0.5, halton(i + 1, 3) - 0.5, width, height);
        this.reflections.frame = i;
        this.composer.render(0);
        const frame = this.composer.readBuffer.texture;
        // the first frame starts the mean, so the buffer it would blend with is never read
        this.blend(frame, i === 0 ? frame : mean.texture, 1 / (i + 1), spare);
        [mean, spare] = [spare, mean];
      }
    } finally {
      camera.projectionMatrix.copy(base);
      camera.projectionMatrixInverse.copy(baseInverse);
    }
    return mean;
  }

  /** out = prev + (frame − prev) × weight. */
  private blend(frame: THREE.Texture, prev: THREE.Texture, weight: number, out: THREE.WebGLRenderTarget): void {
    this.accumUniforms.tFrame.value = frame;
    this.accumUniforms.tPrev.value = prev;
    this.accumUniforms.uWeight.value = weight;
    this.renderer.setRenderTarget(out);
    this.renderer.autoClear = false;
    this.accumQuad.render(this.renderer);
  }

  private accumulation(width: number, height: number): { readonly a: THREE.WebGLRenderTarget; readonly b: THREE.WebGLRenderTarget } {
    if (!this.accum) {
      // nearest sampling: a float texture is not filterable without an extension, and a pixel reads itself
      const make = () =>
        new THREE.WebGLRenderTarget(width, height, {
          type: THREE.FloatType,
          minFilter: THREE.NearestFilter,
          magFilter: THREE.NearestFilter,
          depthBuffer: false,
        });
      this.accum = { a: make(), b: make() };
    } else {
      this.accum.a.setSize(width, height);
      this.accum.b.setSize(width, height);
    }
    return this.accum;
  }
}

/** The size a frame draws at: the target's, else the drawing buffer's. */
function sizeOf(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget | null): { width: number; height: number } {
  if (target) return { width: Math.max(1, target.width), height: Math.max(1, target.height) };
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  return { width: Math.max(1, size.x), height: Math.max(1, size.y) };
}

function saveState(renderer: THREE.WebGLRenderer): SavedState {
  const shadows = renderer.shadowMap;
  return {
    target: renderer.getRenderTarget(),
    autoClear: renderer.autoClear,
    toneMapping: renderer.toneMapping,
    toneMappingExposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    clearColor: renderer.getClearColor(new THREE.Color()),
    clearAlpha: renderer.getClearAlpha(),
    shadowEnabled: shadows.enabled,
    shadowType: shadows.type,
    shadowAutoUpdate: shadows.autoUpdate,
    shadowNeedsUpdate: shadows.needsUpdate,
  };
}

function restoreState(renderer: THREE.WebGLRenderer, s: SavedState): void {
  renderer.setRenderTarget(s.target);
  renderer.autoClear = s.autoClear;
  renderer.toneMapping = s.toneMapping;
  renderer.toneMappingExposure = s.toneMappingExposure;
  renderer.outputColorSpace = s.outputColorSpace;
  renderer.setClearColor(s.clearColor, s.clearAlpha);
  const shadows = renderer.shadowMap;
  shadows.enabled = s.shadowEnabled;
  shadows.type = s.shadowType;
  shadows.autoUpdate = s.shadowAutoUpdate;
  shadows.needsUpdate = s.shadowNeedsUpdate;
}

/** The Halton sequence's `index`th value in `base`: sub-pixel offsets spread evenly. */
function halton(index: number, base: number): number {
  let f = 1;
  let r = 0;
  for (let i = index; i > 0; i = Math.floor(i / base)) {
    f /= base;
    r += f * (i % base);
  }
  return r;
}

/** Shifts `base` by (dx, dy) pixels into the camera's projection, and its inverse with it. */
function jitter(camera: THREE.Camera, base: THREE.Matrix4, dx: number, dy: number, width: number, height: number): void {
  camera.projectionMatrix.copy(base);
  // the shift is in the third column of a perspective matrix and the fourth of an orthogonal one
  const i = camera instanceof THREE.PerspectiveCamera ? 8 : 12;
  const e = camera.projectionMatrix.elements;
  e[i] += (2 * dx) / width;
  e[i + 1] += (2 * dy) / height;
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
