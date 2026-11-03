// Path Traced: three-gpu-pathtracer's WebGLPathTracer over the render scene, a sample at a time.
// A full-resolution stage accumulates while the view rests. A quarter-size stage takes one sample a
// frame while the view moves, and stands in until the full one has its first sample. Each picture
// shown is denoised while it has few samples, smoothed up to the output size, then bloomed, fogged
// and finished (post.ts, finish.ts); the lens's depth of field is its own.

import * as THREE from "three";
import { DenoiseMaterial, WebGLPathTracer } from "three-gpu-pathtracer";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { BvhBuilder } from "./bvhBuilder.ts";
import { DepthPrepass } from "./finish.ts";
import { PostStack, needsDepth } from "./post.ts";
import type { RenderScene, SceneChange } from "./sceneBuilder.ts";
import type { RenderSettings } from "./settings.ts";

/** The moving view's picture, as a share of the output's size on each side. */
const LOW_RES = 0.25;
/** The denoiser works on pictures with fewer samples than this, and eases off as they gain them. */
const DENOISE_SAMPLES = 2000;
const DENOISE_SIGMA = 5;
const DENOISE_THRESHOLD = 0.03;
/** Above zero: the denoiser divides by the threshold. */
const MIN_THRESHOLD = 1e-4;
/** The lamps' share of the direct-light samples (LIGHT_SHARE): by day the sky holds the sun, by night the lamps light. */
const DAY_LAMP_SHARE = 0.2;
const NIGHT_LAMP_SHARE = 0.8;

/**
 * The path tracer picks the sky or one lamp for each direct-light sample, the sky as one lamp more:
 * among 80 lamps the sky (and the sun in it) gets one sample in 81, and a daylight picture stays
 * grainy. These edits of its shader take the lamps' share from a uniform, lightShare, and weigh
 * each pick by its own chance, so the picture is still unbiased. They match 0.0.23 (pinned), each
 * as many times as it says; if one does not, the shader is left as it was.
 */
const LIGHT_SHARE: readonly (readonly [RegExp, string, number])[] = [
  [/float lightsDenom;/g, "float lightsDenom;\nfloat lightPick;\nuniform float lightShare;", 1],
  [/(lightsDenom\s*=[^;]*;)/g, "$1\nlightPick = lights.count == 0u ? 0.0 : ( environmentIntensity == 0.0 || envMapInfo.totalSum == 0.0 ) ? 1.0 : lightShare;", 1],
  [/rand\(\s*5\s*\)\s*<\s*float\(\s*lights\.count\s*\)\s*\/\s*lightsDenom/g, "rand( 5 ) < lightPick", 1],
  [/lightRec\.pdf\s*\/\s*lightsDenom/g, "lightRec.pdf * lightPick / float( lights.count )", 2],
  [/envPdf\s*\/=\s*lightsDenom;/g, "envPdf *= 1.0 - lightPick;", 2],
];

/** Applies LIGHT_SHARE to the path tracer's material; says whether it did. */
function shareLights(material: THREE.ShaderMaterial): boolean {
  let shader = material.fragmentShader;
  for (const [pattern, replacement, count] of LIGHT_SHARE) {
    if ((shader.match(pattern) ?? []).length !== count) {
      console.warn("openvwx: the path tracer's shader has changed; lamps and sky are sampled as it does");
      return false;
    }
    shader = shader.replace(pattern, replacement);
  }
  material.fragmentShader = shader;
  material.uniforms.lightShare = { value: DAY_LAMP_SHARE };
  material.needsUpdate = true;
  return true;
}

/**
 * A sample stage of WebGLPathTracer (a PathTracingRenderer), which its typings leave out. Both stages
 * share one material, so one BVH and one set of textures serve the full and the low-res picture.
 */
interface Stage {
  material: THREE.ShaderMaterial & { resolution: THREE.Vector2 };
  readonly samples: number;
  readonly target: THREE.WebGLRenderTarget;
  setSize(width: number, height: number): void;
  update(): void;
  dispose(): void;
}

/**
 * The parts of WebGLPathTracer that its typings leave out. Its dispose() reads a quad it never makes
 * (_renderQuad), so it throws: the parts are freed by PathEngine.dispose instead.
 */
interface TracerParts {
  readonly _pathTracer: Stage;
  readonly _lowResPathTracer: Stage;
  readonly _quad: FullScreenQuad;
}

/** The renderer state a sample changes, as it was found. */
interface RendererState {
  readonly target: THREE.WebGLRenderTarget | null;
  readonly autoClear: boolean;
  readonly scissorTest: boolean;
  readonly viewport: THREE.Vector4;
  readonly scissor: THREE.Vector4;
  readonly clear: THREE.Color;
  readonly clearAlpha: number;
  readonly toneMapping: THREE.ToneMapping;
  readonly exposure: number;
  readonly colorSpace: string;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }
`;

/** Bilinear weights read with texelFetch: the path tracer's float pictures are not filtered on every GPU. */
const UPSCALE = /* glsl */ `
  uniform sampler2D map;
  varying vec2 vUv;
  void main() {
    ivec2 size = textureSize( map, 0 );
    ivec2 last = size - 1;
    vec2 p = vUv * vec2( size ) - 0.5;
    ivec2 i = ivec2( floor( p ) );
    vec2 f = p - floor( p );
    vec4 a = texelFetch( map, clamp( i, ivec2( 0 ), last ), 0 );
    vec4 b = texelFetch( map, clamp( i + ivec2( 1, 0 ), ivec2( 0 ), last ), 0 );
    vec4 c = texelFetch( map, clamp( i + ivec2( 0, 1 ), ivec2( 0 ), last ), 0 );
    vec4 d = texelFetch( map, clamp( i + ivec2( 1, 1 ), ivec2( 0 ), last ), 0 );
    gl_FragColor = mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
  }
`;

/** Half floats: the denoiser and the upscaler read and write them alike, and they need no depth. */
function makeTarget(): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
}

function sized(target: THREE.WebGLRenderTarget, w: number, h: number): THREE.WebGLRenderTarget {
  if (target.width !== w || target.height !== h) target.setSize(w, h);
  return target;
}

function lowSize(n: number): number {
  return Math.max(1, Math.floor(n * LOW_RES));
}

function saveRenderer(r: THREE.WebGLRenderer): RendererState {
  return {
    target: r.getRenderTarget(),
    autoClear: r.autoClear,
    scissorTest: r.getScissorTest(),
    viewport: r.getViewport(new THREE.Vector4()),
    scissor: r.getScissor(new THREE.Vector4()),
    clear: r.getClearColor(new THREE.Color()),
    clearAlpha: r.getClearAlpha(),
    toneMapping: r.toneMapping,
    exposure: r.toneMappingExposure,
    colorSpace: r.outputColorSpace,
  };
}

function restoreRenderer(r: THREE.WebGLRenderer, s: RendererState): void {
  // the target last: setting it applies the viewport and scissor that belong to it
  r.setViewport(s.viewport);
  r.setScissor(s.scissor);
  r.setScissorTest(s.scissorTest);
  r.setClearColor(s.clear, s.clearAlpha);
  r.autoClear = s.autoClear;
  r.toneMapping = s.toneMapping;
  r.toneMappingExposure = s.exposure;
  r.outputColorSpace = s.colorSpace;
  r.setRenderTarget(s.target);
}

/** Path Traced: samples the render scene a frame at a time and shows each picture finished. */
export class PathEngine {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly tracer: WebGLPathTracer;
  private readonly full: Stage;
  private readonly low: Stage;
  private readonly libraryQuad: FullScreenQuad;
  private readonly denoise = new DenoiseMaterial({ sigma: DENOISE_SIGMA, kSigma: 1, threshold: DENOISE_THRESHOLD });
  private readonly denoiseQuad = new FullScreenQuad(this.denoise);
  private readonly denoised = makeTarget();
  private readonly upscale = new THREE.ShaderMaterial({
    uniforms: { map: { value: null as THREE.Texture | null } },
    vertexShader: VERTEX,
    fragmentShader: UPSCALE,
    depthTest: false,
    depthWrite: false,
  });
  private readonly upscaleQuad = new FullScreenQuad(this.upscale);
  private readonly upscaled = makeTarget();
  private readonly post = new PostStack();
  private readonly depthPass = new DepthPrepass();
  private readonly size = new THREE.Vector2();
  /** a pixel read back to wait for the GPU (accumulate) */
  private readonly probe = new Float32Array(4);
  private scene: RenderScene | null = null;
  private camera: THREE.Camera | null = null;
  /** the scene's BVH is built and the stages have it */
  private built = false;
  /** counts the setScene calls, so a build that has been overtaken does nothing */
  private builds = 0;
  /** the scene's depth through the camera, kept until the camera, the geometry or the size changes */
  private depth: THREE.DepthTexture | null = null;
  private depthW = 0;
  private depthH = 0;
  /** the shader takes the lamps' share from lightShare (shareLights) */
  private readonly shared: boolean;
  /** builds the scene's BVH off the page's thread */
  private readonly bvh = new BvhBuilder();
  /** the build running now (the library takes one at a time) */
  private building: Promise<void> | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    this.tracer = new WebGLPathTracer(renderer);
    // the typings have neither stage nor a way to size the pictures, so they are reached through a cast
    const parts = this.tracer as unknown as TracerParts;
    this.full = parts._pathTracer;
    this.low = parts._lowResPathTracer;
    this.libraryQuad = parts._quad;

    const t = this.tracer;
    // the pictures are shown through finish.ts, not the canvas
    t.renderToCanvas = false;
    t.rasterizeScene = false;
    t.multipleImportanceSampling = true;
    t.transmissiveBounces = 10;
    t.filterGlossyFactor = 0.5;
    t.minSamples = 1;
    t.fadeDuration = 0;
    t.renderDelay = 0;
    // sizes come from sample(): the library would size them from the drawing buffer, and a target may differ
    t.synchronizeRenderSize = false;
    t.tiles.set(1, 1);
    // one material for both stages, so one BVH and one set of textures
    const own = this.low.material;
    this.low.material = this.full.material;
    own.dispose();
    this.shared = shareLights(this.full.material);
    t.setBVHWorker(this.bvh);
  }

  /** Samples taken of the current picture (the full-resolution stage's). */
  get samples(): number {
    return this.tracer.samples;
  }

  /** The scene is set and its BVH built. */
  get ready(): boolean {
    return this.built;
  }

  /** Splits each sample into tiles × tiles parts (a large still on a slow GPU), 1 for none. */
  get tiles(): number {
    return this.tracer.tiles.x;
  }

  set tiles(n: number) {
    this.tracer.tiles.set(n, n);
  }

  /** Sets the scene and builds its BVH, in a worker (seconds on a large model). */
  async setScene(scene: RenderScene, camera: THREE.Camera, onProgress?: (fraction: number) => void): Promise<void> {
    this.scene = scene;
    this.camera = camera;
    this.built = false;
    this.depth = null;
    const build = ++this.builds;
    onProgress?.(0);
    // one build at a time: a newer call waits for the one running, and one overtaken meanwhile stops
    while (this.building) await this.building.catch(() => undefined);
    if (build !== this.builds || !this.camera) return;
    const run = this.tracer.setSceneAsync(scene.scene, this.camera, { onProgress });
    this.building = run;
    try {
      await run;
    } finally {
      if (this.building === run) this.building = null;
    }
    if (build !== this.builds || !this.camera) return;
    // the build took the sky and lights as the raster draws them, and the camera it began with
    this.traced(scene, () => {
      this.tracer.updateEnvironment();
      this.tracer.updateLights();
    });
    this.tracer.setCamera(this.camera);
    this.built = true;
    onProgress?.(1);
  }

  /** After RenderScene.update: takes up what changed and starts over. */
  updateScene(change: SceneChange, settings: RenderSettings): void {
    this.syncBounces(settings);
    if (change.geometry) {
      // the build takes the materials, lights and sky as they are now, so the other changes need no more
      const scene = this.scene;
      const camera = this.camera;
      if (scene && camera) {
        this.setScene(scene, camera).catch((err: unknown) => console.error("openvwx: path tracer scene", err));
      }
      return;
    }
    // a build still to come takes the scene as it is when it runs; each update below starts the picture over
    const scene = this.scene;
    if (!this.built || !scene) return;
    this.traced(scene, () => {
      if (change.materials) this.tracer.updateMaterials();
      if (change.lights) this.tracer.updateLights();
      if (change.environment) this.tracer.updateEnvironment();
    });
  }

  /** The camera moved, or another one is used: starts over. */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.depth = null;
    this.tracer.setCamera(camera);
  }

  /** Starts the picture over. */
  reset(): void {
    this.tracer.reset();
  }

  /**
   * Takes one more sample and shows the picture finished to `target` (null: the canvas). While
   * `interactive`, samples at a quarter of the size, so a moving view keeps up.
   */
  sample(settings: RenderSettings, interactive: boolean, target: THREE.WebGLRenderTarget | null = null): void {
    this.frame(target, (w, h) => {
      this.trace(settings, interactive, w, h);
      this.finish(settings, interactive, target, w, h);
    });
  }

  /**
   * Takes one more sample (one tile of one, when tiled) at `target`'s size without showing it, and
   * waits for the GPU to draw it, so a run of them never queues more than one. show() shows the
   * picture: a still shows it only now and then, as finishing it costs more than a tile.
   */
  accumulate(settings: RenderSettings, target: THREE.WebGLRenderTarget | null = null): void {
    this.frame(target, (w, h) => {
      this.trace(settings, false, w, h);
      this.renderer.readRenderTargetPixels(this.full.target, 0, 0, 1, 1, this.probe);
    });
  }

  /** Shows the picture as it stands, finished, to `target` (null: the canvas). */
  show(settings: RenderSettings, target: THREE.WebGLRenderTarget | null = null): void {
    this.frame(target, (w, h) => this.finish(settings, false, target, w, h));
  }

  /** Runs `draw` with `target`'s size (else the drawing buffer's), the renderer's state put back after. */
  private frame(target: THREE.WebGLRenderTarget | null, draw: (w: number, h: number) => void): void {
    if (!this.built || !this.scene || !this.camera) return;
    const r = this.renderer;
    const size = target ? this.size.set(target.width, target.height) : r.getDrawingBufferSize(this.size);
    const state = saveRenderer(r);
    try {
      draw(Math.max(1, Math.floor(size.x)), Math.max(1, Math.floor(size.y)));
    } finally {
      restoreRenderer(r, state);
    }
  }

  /** One sample of the full picture at w × h, or only of the low-res one while `interactive`. */
  private trace(settings: RenderSettings, interactive: boolean, w: number, h: number): void {
    const scene = this.scene;
    if (!scene) return;
    this.syncBounces(settings);
    if (this.shared) this.full.material.uniforms.lightShare.value = scene.sun.up && settings.sun.on && settings.sun.intensity > 0 ? DAY_LAMP_SHARE : NIGHT_LAMP_SHARE;
    this.full.setSize(w, h);
    this.low.setSize(lowSize(w), lowSize(h));
    // while the view moves only the low-res stage samples; the full one waits where it is
    this.tracer.pausePathTracing = interactive;
    this.tracer.renderSample();
  }

  /** Denoises, smooths up, fogs and finishes the picture to `target`. */
  private finish(settings: RenderSettings, interactive: boolean, target: THREE.WebGLRenderTarget | null, w: number, h: number): void {
    const scene = this.scene;
    const camera = this.camera;
    if (!scene || !camera) return;
    let picture: THREE.WebGLRenderTarget;
    let samples: number;
    if (!interactive && this.full.samples >= 1) {
      picture = this.full.target;
      samples = this.full.samples;
    } else {
      // the low-res picture shows while the view moves, and until the full one has its first sample
      if (interactive || this.low.samples < 1) this.sampleLow(w, h);
      picture = this.low.target;
      samples = this.low.samples;
    }
    let color: THREE.Texture = picture.texture;
    if (settings.quality.denoise && samples < DENOISE_SAMPLES) color = this.denoisePass(picture, samples).texture;
    if (picture.width !== w || picture.height !== h) color = this.upscalePass(color, w, h).texture;
    const depth = needsDepth(settings, false) ? this.depthAt(scene, camera, w, h) : null;
    this.post.render(this.renderer, color, depth, camera, scene, settings, target, false);
  }

  dispose(): void {
    // WebGLPathTracer.dispose() would throw (see TracerParts), so its stages and quad are freed here
    this.full.dispose();
    this.low.dispose();
    this.full.material.dispose();
    this.libraryQuad.material.dispose();
    this.libraryQuad.dispose();
    this.denoise.dispose();
    this.denoiseQuad.dispose();
    this.denoised.dispose();
    this.upscale.dispose();
    this.upscaleQuad.dispose();
    this.upscaled.dispose();
    this.post.dispose();
    this.depthPass.dispose();
    this.bvh.dispose();
    this.scene = null;
    this.camera = null;
    this.depth = null;
    this.built = false;
  }

  /**
   * Runs `fn` on the scene as the path tracer takes it: lit by the sky with the sun in it
   * (RenderScene.pathSky), the sun's light left out. The background stays the sky without it.
   */
  private traced(scene: RenderScene, fn: () => void): void {
    const s = scene.scene;
    const environment = s.environment;
    const sunShown = scene.sunLight.visible;
    s.environment = scene.pathSky;
    scene.sunLight.visible = false;
    try {
      fn();
    } finally {
      s.environment = environment;
      scene.sunLight.visible = sunShown;
    }
  }

  /** One sample at low resolution. The stages share a material whose resolution each sample sets, so the full stage's is set back for its next tile. */
  private sampleLow(w: number, h: number): void {
    this.low.update();
    this.full.material.resolution.set(w, h);
  }

  /** The picture with its noise smoothed and its edges kept. The colour tolerance eases to nothing as samples grow. */
  private denoisePass(picture: THREE.WebGLRenderTarget, samples: number): THREE.WebGLRenderTarget {
    const out = sized(this.denoised, picture.width, picture.height);
    this.denoise.threshold = Math.max(MIN_THRESHOLD, DENOISE_THRESHOLD * (1 - samples / DENOISE_SAMPLES));
    this.denoise.map = picture.texture;
    this.renderer.setRenderTarget(out);
    this.denoiseQuad.render(this.renderer);
    return out;
  }

  /** A low-res picture stretched to w × h with bilinear weights. */
  private upscalePass(color: THREE.Texture, w: number, h: number): THREE.WebGLRenderTarget {
    const out = sized(this.upscaled, w, h);
    this.upscale.uniforms.map.value = color;
    this.renderer.setRenderTarget(out);
    this.upscaleQuad.render(this.renderer);
    return out;
  }

  /** The scene's depth through the camera at w × h, drawn again only when the camera, the geometry or the size has changed. */
  private depthAt(scene: RenderScene, camera: THREE.Camera, w: number, h: number): THREE.DepthTexture {
    if (this.depth && this.depthW === w && this.depthH === h) return this.depth;
    this.depth = this.depthPass.render(this.renderer, scene.scene, camera, w, h);
    this.depthW = w;
    this.depthH = h;
    return this.depth;
  }

  /** The light bounces the settings ask for. A change starts the picture over. */
  private syncBounces(settings: RenderSettings): void {
    if (this.tracer.bounces === settings.quality.bounces) return;
    this.tracer.bounces = settings.quality.bounces;
    this.tracer.reset();
  }
}
