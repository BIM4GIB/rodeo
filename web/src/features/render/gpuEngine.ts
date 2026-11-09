// Path Traced on WebGPU: three-gpu-pathtracer's WebGPU tracer over the render scene, on a WebGPU
// renderer of its own. Its pictures are read back into WebGL textures and finished by TraceFinisher
// (pathtrace.ts), so a picture looks the same as the WebGL tracer's. Open Image Denoise runs at each
// milestone of samples; the picture shown is the last one denoised until the next is read back.

import * as THREE from "three";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
import { MeshBasicNodeMaterial, WebGPURenderer } from "three/webgpu";
import { int, ivec2, screenCoordinate, texture, uniform } from "three/tsl";
import { OIDNDenoiser, TRANSMISSIVE_BACKGROUND_ENVIRONMENT, WebGPUPathTracer } from "three-gpu-pathtracer/webgpu";
import { initUNetFromURL } from "oidn-webgpu";
import { BvhBuilder } from "./bvhBuilder.ts";
import { asTraced, frameSize, TraceFinisher } from "./pathtrace.ts";
import { webgpuAvailable } from "./gpuSupport.ts";
import type { RenderScene, SceneChange } from "./sceneBuilder.ts";
import type { RenderSettings } from "./settings.ts";
import type { EngineKind, MotionFrame, TraceEngine } from "./traceEngine.ts";

/** The most pixels a live resting picture is traced at: a larger output is traced at this share and smoothed up to its size. */
const REST_PIXELS = 2_100_000;
/** The sample counts at which the denoiser runs, before the preview's own count (the last milestone). */
const MILESTONES = [8, 32, 128];
/** The least time between raw readbacks while a picture refines, ms. */
const RAW_EVERY = 200;
/** How often the pump runs, ms: it finishes a picture the view has stopped asking for. */
const PUMP_EVERY = 60;
/** The view counts as having stopped asking for samples after this long, ms. */
const IDLE_AFTER = 250;
/** How long a still waits for its denoiser to finish, ms; the still is shown raw after that. */
const STILL_DENOISE_WAIT = 120_000;
/** The live view denoises with the small model (faster); a still with the full one (better). */
const WEIGHTS = { live: "rt_hdr_alb_nrm_small.tza", still: "rt_hdr_alb_nrm.tza" } as const;
/** The lowest number of light bounces the wavefront's preview steps every path by (LOW_RES_ITERATIONS in the library). */
const PREVIEW_STEPS = 5;

/** The sample counts a plan runs to: the denoiser's milestones below the preview's count, then the count itself. */
function milestonesFor(preview: number, denoise: boolean): number[] {
  if (!denoise) return [preview];
  return [...MILESTONES.filter((n) => n < preview), preview];
}

/** The pixels a motion frame may trace whole: the library's preview budget, or the frame budget over the preview's steps. */
function previewPixels(tracer: WebGPUPathTracer): number {
  // the wavefront's own budget is not in the typings, so it is reached through a cast and worked out when absent
  const inner = (tracer as unknown as { _pathTracer?: { getPreviewPixelBudget?: () => number } })._pathTracer;
  const budget = inner?.getPreviewPixelBudget?.();
  if (budget !== undefined && budget > 0) return budget;
  return tracer.frameBudget / Math.max(1, Math.min(tracer.maxBounces, PREVIEW_STEPS));
}

/** How many textures the tracer's atlas places (its textureInfo, which the typings leave out). */
function textureSlots(tracer: WebGPUPathTracer): number {
  return (tracer.textureAtlas as unknown as { textureInfo: readonly unknown[] }).textureInfo.length;
}

/** The renderer's target, viewport, clear and tone state as they are now; the function it returns puts them back. */
function keepRenderer(r: THREE.WebGLRenderer): () => void {
  const target = r.getRenderTarget();
  const autoClear = r.autoClear;
  const viewport = r.getViewport(new THREE.Vector4());
  const scissor = r.getScissor(new THREE.Vector4());
  const scissorTest = r.getScissorTest();
  const clear = r.getClearColor(new THREE.Color());
  const clearAlpha = r.getClearAlpha();
  const toneMapping = r.toneMapping;
  const exposure = r.toneMappingExposure;
  const colorSpace = r.outputColorSpace;
  return () => {
    // the target last: setting it applies the viewport and scissor that belong to it
    r.setViewport(viewport);
    r.setScissor(scissor);
    r.setScissorTest(scissorTest);
    r.setClearColor(clear, clearAlpha);
    r.autoClear = autoClear;
    r.toneMapping = toneMapping;
    r.toneMappingExposure = exposure;
    r.outputColorSpace = colorSpace;
    r.setRenderTarget(target);
  };
}

/**
 * A WebGL texture holding `data` (w × h RGBA, half floats or floats), reusing `held` when its size
 * and type still hold. Nearest filtering: the finish reads its texels, not a filtered sample.
 */
function holdPicture(held: THREE.DataTexture | null, data: Uint16Array | Float32Array, w: number, h: number): THREE.DataTexture {
  const type = data instanceof Uint16Array ? THREE.HalfFloatType : THREE.FloatType;
  if (held && held.image.width === w && held.image.height === h && held.type === type) {
    held.image.data = data;
    held.needsUpdate = true;
    return held;
  }
  held?.dispose();
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, type);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Copies a finished picture (the path tracer's accumulation or the denoiser's result) into a
 * half-float target and reads its rows back. The library keeps its rows top down, so the copy takes
 * each row from the mirrored one: the first row read is the bottom of the picture, as a WebGL
 * texture takes its rows.
 */
class Blit {
  private readonly target = new THREE.RenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  private readonly source = texture();
  private readonly rows = uniform(1);
  private readonly material = new MeshBasicNodeMaterial();
  private readonly quad = new FullScreenQuad(this.material);
  /** the readbacks not yet settled: the renderer is freed only after them */
  private readonly reads = new Set<Promise<Uint16Array>>();

  constructor() {
    const x = int(screenCoordinate.x);
    const y = int(this.rows.sub(1)).sub(int(screenCoordinate.y));
    this.material.colorNode = this.source.load(ivec2(x, y));
    this.material.toneMapped = false;
    this.material.blending = THREE.NoBlending;
  }

  /** Copies the w × h top of `source` and reads it back; the promise gives the rows bottom first. */
  read(renderer: WebGPURenderer, source: THREE.Texture, w: number, h: number): Promise<Uint16Array> {
    this.target.setSize(w, h);
    this.source.value = source;
    this.rows.value = h;
    renderer.setRenderTarget(this.target);
    this.quad.render(renderer as unknown as THREE.WebGLRenderer);
    renderer.setRenderTarget(null);
    const read = renderer.readRenderTargetPixelsAsync(this.target, 0, 0, w, h) as Promise<Uint16Array>;
    this.reads.add(read);
    const done = () => {
      this.reads.delete(read);
    };
    void read.then(done, done);
    return read;
  }

  /** Resolves once every read begun so far has settled, read or failed. */
  settled(): Promise<void> {
    return Promise.all([...this.reads].map((p) => p.then(() => undefined, () => undefined))).then(() => undefined);
  }

  dispose(): void {
    this.quad.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}

/** Path Traced on WebGPU: samples the render scene a frame at a time and shows each picture finished. */
export class GpuEngine implements TraceEngine {
  readonly kind: EngineKind = "webgpu";
  private readonly gl: THREE.WebGLRenderer;
  /** a still: traced at the full size, denoised with the full model, and drawn by accumulate and show */
  private readonly still: boolean;
  /** the samples a still takes, denoised once they are in (a live view's milestones are the preview's) */
  private readonly stillSamples: number;
  private renderer: WebGPURenderer | null = null;
  /** the library's reads not yet settled (frame timings, sample counts): the renderer is freed only after them */
  private readonly libraryReads = new Set<Promise<unknown>>();
  private tracer: WebGPUPathTracer | null = null;
  private device: GPUDevice | null = null;
  private starting: Promise<void> | null = null;
  private denoiser: OIDNDenoiser | null = null;
  /** the weights would not load: pictures are denoised by the finish instead */
  private denoiserFailed = false;
  private readonly finisher = new TraceFinisher();
  private readonly restBlit = new Blit();
  private readonly motionBlit = new Blit();
  private scene: RenderScene | null = null;
  private camera: THREE.Camera | null = null;
  /** the camera the path tracer takes its rays from */
  private tracerCamera: THREE.Camera | null = null;
  private built = false;
  private lost = false;
  private disposed = false;
  /** counts the setScene calls, so a build that has been overtaken does nothing */
  private builds = 0;
  /** the build running now (the library takes one at a time) */
  private building: Promise<void> | null = null;
  private onBuild: ((fraction: number) => void) | undefined;
  /** the library's measured average samples per pixel of the resting picture */
  private avg = 0;
  /** the sample counts the resting picture runs to, milestone by milestone */
  private targets: number[] = [];
  private planKey = "";
  /** the milestone now aimed at, an index into targets */
  private stage = 0;
  /** counts the restarts, so a readback from an earlier run is dropped */
  private run = 0;
  /** a denoised picture has been read back in this run: raw ones do not replace it until the next */
  private denoisedRun = false;
  /** the milestone whose denoised picture has been read back */
  private readStage = -1;
  /** the resting picture, as the finish draws it */
  private picture: THREE.DataTexture | null = null;
  private pictureW = 0;
  private pictureH = 0;
  private pictureSamples = 0;
  private pictureDenoised = false;
  /** the size the resting picture is traced at */
  private restW = 0;
  private restH = 0;
  private restReading = false;
  private rawAt = -Infinity;
  private rawAvg = -1;
  /** a picture arrived since the view last drew one */
  private dirty = false;
  private lastSettings: RenderSettings | null = null;
  private lastTarget: THREE.WebGLRenderTarget | null = null;
  private lastSampleAt = -Infinity;
  private pumping: ReturnType<typeof setTimeout> | null = null;
  /** the view is moving: its frames come from motionFrame until a sample starts the resting picture over */
  private moving = false;
  /** motion frames alternate between two textures, so the one before stays whole for the planner */
  private motionTex: (THREE.DataTexture | null)[] = [null, null];
  private motionSlot = 0;
  private motionReading = false;
  private motion: MotionFrame | null = null;
  private motionSerial = 0;

  /** `stillSamples` makes a still of that many samples; without it, the live view's engine. */
  constructor(gl: THREE.WebGLRenderer, opts: { stillSamples?: number } = {}) {
    this.gl = gl;
    this.still = opts.stillSamples !== undefined;
    this.stillSamples = Math.max(1, Math.round(opts.stillSamples ?? 1));
  }

  /** The samples per pixel of the resting picture, whole, as the library measured them (its average is fractional). */
  get samples(): number {
    return Math.floor(this.avg);
  }

  /** The scene is set and built, and the device has not been lost. */
  get ready(): boolean {
    return this.built && !this.lost;
  }

  /** A resting picture has been read back. */
  get hasPicture(): boolean {
    return this.picture !== null;
  }

  /** The WebGPU tracer takes whole samples, so there are no tiles. */
  get tiles(): number {
    return 1;
  }

  set tiles(_n: number) {
    // no tiles here: a sample is a whole pass of the tracer
  }

  /** Sets the scene and builds its BVHs in workers, then the tracer's scene; rejects with a clear error when WebGPU cannot trace it. */
  async setScene(scene: RenderScene, camera: THREE.Camera, onProgress?: (fraction: number) => void): Promise<void> {
    await this.start();
    const tracer = this.tracer;
    if (!tracer || this.disposed) throw new Error("the WebGPU path tracer has been disposed");
    this.scene = scene;
    this.camera = camera;
    this.built = false;
    this.finisher.forgetDepth();
    const build = ++this.builds;
    onProgress?.(0);
    // one build at a time: a newer call waits for the one running, and one overtaken meanwhile stops
    while (this.building) await this.building.catch(() => undefined);
    if (build !== this.builds || this.disposed) return;
    this.onBuild = onProgress;
    const run = tracer.setSceneAsync(scene.scene, camera);
    this.building = run;
    try {
      await run;
    } catch (err) {
      throw new Error(`WebGPU could not build the scene: ${describe(err)}`);
    } finally {
      if (this.building === run) this.building = null;
      if (build === this.builds) this.onBuild = undefined;
    }
    if (build !== this.builds || this.disposed) return;
    // the build read the sky and the lights as the raster draws them: the path tracer takes them as traced
    asTraced(scene, () => {
      tracer.updateEnvironment();
      tracer.updateLights();
    });
    this.tracerCamera = camera;
    this.built = true;
    this.restart();
    onProgress?.(1);
  }

  /** After RenderScene.update: takes up what changed and starts over. */
  updateScene(change: SceneChange, settings: RenderSettings): void {
    this.syncSettings(settings);
    const tracer = this.tracer;
    const scene = this.scene;
    const camera = this.camera;
    if (!tracer || !scene || !camera) return;
    if (change.geometry) {
      this.setScene(scene, camera).catch((err: unknown) => console.error("openvwx: path tracer scene", err));
      return;
    }
    // a build still to come takes the scene as it is when it runs; each update below starts the picture over
    if (!this.built) return;
    if (change.materials) {
      const slots = textureSlots(tracer);
      tracer.updateMaterials();
      // the kernels size their table of textures when they compile, and updateMaterials does not
      // recompile them: a texture past that table (a library material just loaded) needs a new build
      if (textureSlots(tracer) > slots) {
        this.setScene(scene, camera).catch((err: unknown) => console.error("openvwx: path tracer scene", err));
        return;
      }
    }
    if (change.lights || change.environment) {
      asTraced(scene, () => {
        if (change.lights) tracer.updateLights();
        if (change.environment) tracer.updateEnvironment();
      });
    }
    this.restart();
  }

  /** The camera moved, or another one is used: starts over. */
  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.finisher.forgetDepth();
    const tracer = this.tracer;
    if (!tracer || !this.built) return;
    if (camera === this.tracerCamera) {
      tracer.updateCamera();
    } else {
      tracer.setCamera(camera);
      this.tracerCamera = camera;
    }
    this.restart();
  }

  /** Starts the resting picture over. */
  reset(): void {
    this.tracer?.reset();
    this.restart();
  }

  /**
   * Takes one more sample of the resting picture and draws it finished to `target` (null: the
   * canvas). Until the first picture has been read back nothing is drawn. While `interactive` no
   * sample is taken: the picture as it stands is drawn.
   */
  sample(settings: RenderSettings, interactive: boolean, target: THREE.WebGLRenderTarget | null = null): void {
    const tracer = this.tracer;
    if (!this.ready || !tracer || !this.scene || !this.camera) return;
    this.lastSampleAt = performance.now();
    this.lastSettings = settings;
    this.lastTarget = target;
    this.syncSettings(settings);
    if (this.moving) {
      this.moving = false;
      this.restart();
    }
    if (!interactive) {
      this.traceSize(target);
      tracer.renderSample();
      this.advance();
    }
    this.dirty = false;
    this.draw(settings, target);
    this.pump();
  }

  /**
   * While the view moves: traces one frame through the current camera, at `scale` of `width` ×
   * `height` and no more pixels than the wavefront traces whole in one call, and returns the newest
   * frame read back (null while none is). Starts the resting picture over, and turns the denoiser's
   * milestones off until it is sampled again.
   */
  motionFrame(settings: RenderSettings, scale: number, width: number, height: number): MotionFrame | null {
    const tracer = this.tracer;
    const camera = this.camera;
    const renderer = this.renderer;
    if (!this.ready || !tracer || !camera || !renderer) return null;
    this.syncSettings(settings);
    if (!this.moving) {
      this.moving = true;
      this.run++;
      tracer.maxSamples = 0;
    }
    const budget = previewPixels(tracer);
    let w = Math.max(1, Math.floor(width * scale));
    let h = Math.max(1, Math.floor(height * scale));
    if (w * h > budget) {
      const k = Math.sqrt(budget / (w * h));
      w = Math.max(1, Math.floor(w * k));
      h = Math.max(1, Math.floor(h * k));
    }
    tracer.setSize(w, h);
    // the tracer is at the motion size now: the resting size is set again when the view rests
    this.restW = 0;
    this.restH = 0;
    if (camera === this.tracerCamera) {
      tracer.updateCamera();
    } else {
      tracer.setCamera(camera);
      this.tracerCamera = camera;
    }
    // the matrices are the camera's as this frame is traced, which the readback below shows
    const matrixWorld = camera.matrixWorld.clone();
    const projectionMatrix = camera.projectionMatrix.clone();
    tracer.renderSample();
    const source = tracer.target;
    if (source && !this.motionReading) {
      this.motionReading = true;
      this.motionBlit
        .read(renderer, source, w, h)
        .then((data) => {
          if (this.disposed) return;
          this.motionSlot ^= 1;
          const color = holdPicture(this.motionTex[this.motionSlot], data, w, h);
          this.motionTex[this.motionSlot] = color;
          this.motion = { color, width: w, height: h, matrixWorld, projectionMatrix, serial: ++this.motionSerial };
        })
        .catch((err: unknown) => console.warn("openvwx: motion frame", describe(err)))
        .finally(() => {
          this.motionReading = false;
        });
    }
    return this.motion;
  }

  /** One more sample, waiting for the GPU to draw it, so a run of them never queues more than one. */
  accumulate(settings: RenderSettings): Promise<void> {
    const tracer = this.tracer;
    const device = this.device;
    if (!this.ready || !tracer || !device) return Promise.resolve();
    this.syncSettings(settings);
    this.traceSize(null);
    tracer.renderSample();
    return device.queue.onSubmittedWorkDone();
  }

  /**
   * Shows the picture as it stands, finished, to `target` (null: the canvas). A still waits for its
   * denoiser, which runs once every pixel has its samples, and shows the denoised picture when it can.
   */
  async show(settings: RenderSettings, target: THREE.WebGLRenderTarget | null = null): Promise<void> {
    const tracer = this.tracer;
    const renderer = this.renderer;
    if (!this.ready || !tracer || !renderer) return;
    this.syncSettings(settings);
    this.traceSize(target);
    // the denoiser runs once every pixel has the stage's samples: a picture shown before then (progress,
    // Finish now, the time limit) is the raw one, else it would wait for all the samples here
    const samplesIn = this.avg >= (this.targets[this.stage] ?? Infinity);
    const deadline = performance.now() + STILL_DENOISE_WAIT;
    while (samplesIn && this.denoiser && !this.denoiser.complete && !this.denoiserFailed && !this.disposed && performance.now() < deadline) {
      tracer.renderSample();
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    if (this.disposed) return;
    const denoiser = this.denoiser;
    const denoised = denoiser !== null && denoiser.complete && denoiser.texture !== null;
    const source = denoised ? denoiser.texture : tracer.target;
    if (!source) return;
    const w = this.restW;
    const h = this.restH;
    const data = await this.restBlit.read(renderer, source, w, h);
    if (this.disposed) return;
    this.picture = holdPicture(this.picture, data, w, h);
    this.pictureW = w;
    this.pictureH = h;
    this.pictureDenoised = denoised;
    this.pictureSamples = denoised ? (this.targets[this.stage] ?? this.avg) : this.avg;
    this.draw(settings, target);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pumping !== null) clearTimeout(this.pumping);
    this.pumping = null;
    const { tracer, renderer, restBlit, motionBlit } = this;
    this.tracer = null;
    this.denoiser = null;
    this.renderer = null;
    this.device = null;
    // a read still in flight (a picture, a motion frame, a frame timing or a sample count) holds its
    // buffer mapped: freeing the renderer under it rejects the library's own promise, so the teardown waits for them
    const timing = [...this.libraryReads].map((p) => p.then(() => undefined, () => undefined));
    void Promise.all([restBlit.settled(), motionBlit.settled(), ...timing]).then(() => {
      // the tracer frees an attached denoiser with itself
      tracer?.dispose();
      renderer?.dispose();
      restBlit.dispose();
      motionBlit.dispose();
    });
    this.picture?.dispose();
    this.picture = null;
    for (const tex of this.motionTex) tex?.dispose();
    this.motionTex = [null, null];
    this.motion = null;
    this.finisher.dispose();
    this.scene = null;
    this.camera = null;
    this.tracerCamera = null;
    this.built = false;
  }

  /** Makes the WebGPU renderer and tracer once; rejects when WebGPU cannot start. */
  private start(): Promise<void> {
    this.starting ??= this.makeTracer();
    return this.starting;
  }

  /** Keeps a read of the library's until it settles, so that the teardown can wait for it. */
  private keep<T>(read: Promise<T>): Promise<T> {
    this.libraryReads.add(read);
    const done = () => {
      this.libraryReads.delete(read);
    };
    void read.then(done, done);
    return read;
  }

  private async makeTracer(): Promise<void> {
    if (!(await webgpuAvailable())) throw new Error("this browser has no WebGPU adapter");
    const renderer = new WebGPURenderer({ canvas: document.createElement("canvas"), antialias: false, trackTimestamp: true });
    // the library reads its frame timings back through this call: each read is kept until it settles
    const timed = renderer as unknown as { resolveTimestampsAsync(type: unknown): Promise<unknown> };
    const resolve = timed.resolveTimestampsAsync.bind(renderer);
    timed.resolveTimestampsAsync = (type) => this.keep(resolve(type));
    try {
      await renderer.init();
    } catch (err) {
      renderer.dispose();
      throw new Error(`WebGPU could not start: ${describe(err)}`);
    }
    if (this.disposed) {
      renderer.dispose();
      throw new Error("the WebGPU path tracer has been disposed");
    }
    const device = (renderer.backend as unknown as { device: GPUDevice }).device;
    device.lost.then((info) => {
      if (this.disposed) return;
      this.lost = true;
      this.built = false;
      console.warn(`openvwx: the WebGPU device was lost (${info.reason}): ${info.message}`);
    });
    const tracer = new WebGPUPathTracer(renderer);
    // the sample counts come back through getSampleCountsAsync, which the library does not always await: kept like the rest
    const counted = tracer as unknown as { getSampleCountsAsync(): Promise<unknown> };
    const counts = counted.getSampleCountsAsync.bind(tracer);
    counted.getSampleCountsAsync = () => this.keep(counts());
    // pictures are read back and finished through finish.ts, not drawn to a canvas
    tracer.renderToCanvas = false;
    // sizes come from sample() and show(): the library would size them from the canvas
    tracer.synchronizeRenderSize = false;
    tracer.dynamicLowRes = false;
    tracer.renderDelay = 0;
    tracer.fadeDuration = 0;
    tracer.minSamples = 1;
    tracer.transmissiveBackground = TRANSMISSIVE_BACKGROUND_ENVIRONMENT;
    tracer.filterGlossyFactor = 0.5;
    tracer.multipleImportanceSampling = true;
    // the library takes a worker class and builds one per geometry in parallel; BvhBuilder has the same shape
    tracer.setBVHWorker(BvhBuilder);
    tracer.addEventListener("progress", (e) => {
      if (e.stage === "building") this.onBuild?.(e.progress ?? 0);
      else if (e.stage === "rendering" && e.samples) this.avg = e.samples.avg;
    });
    this.renderer = renderer;
    this.device = device;
    this.tracer = tracer;
  }

  /** Takes the settings: bounces, the denoiser, and the sample plan they make. A change starts the picture over. */
  private syncSettings(settings: RenderSettings): void {
    const tracer = this.tracer;
    if (!tracer) return;
    let reset = false;
    if (tracer.maxBounces !== settings.quality.bounces) {
      tracer.maxBounces = settings.quality.bounces;
      reset = true;
    }
    const wantDenoiser = settings.quality.denoise && !this.denoiserFailed;
    if (wantDenoiser && !this.denoiser) {
      this.attachDenoiser();
      reset = true;
    } else if (!wantDenoiser && this.denoiser) {
      tracer.setDenoiser(null);
      this.denoiser = null;
      reset = true;
    }
    // a still runs to its own count in one stage, nothing moving it on between milestones
    const preview = this.still ? this.stillSamples : Math.max(1, Math.round(settings.quality.previewSamples));
    const key = `${preview}|${this.denoiser ? "denoised" : "raw"}`;
    if (key !== this.planKey) {
      this.planKey = key;
      this.targets = this.still ? [preview] : milestonesFor(preview, this.denoiser !== null);
      reset = true;
    }
    if (reset) this.restart();
  }

  private attachDenoiser(): void {
    const tracer = this.tracer;
    if (!tracer) return;
    const file = this.still ? WEIGHTS.still : WEIGHTS.live;
    const denoiser = new OIDNDenoiser({ initUNetFromURL, auxWeightsUrl: `${import.meta.env.BASE_URL}oidn/${file}` });
    denoiser.addEventListener("error", (e) => {
      if (this.denoiser !== denoiser || this.disposed) return;
      console.warn("openvwx: the denoiser's weights did not load; pictures are denoised by the finish instead", e.error);
      this.denoiserFailed = true;
      this.denoiser = null;
      this.tracer?.setDenoiser(null);
      this.planKey = "";
      if (this.lastSettings) this.syncSettings(this.lastSettings);
    });
    this.denoiser = denoiser;
    tracer.setDenoiser(denoiser);
  }

  /** Starts the resting picture over: the first milestone, no denoised picture shown in this run. */
  private restart(): void {
    this.run++;
    this.stage = 0;
    this.readStage = -1;
    this.denoisedRun = false;
    this.avg = 0;
    this.rawAvg = -1;
    this.rawAt = -Infinity;
    const tracer = this.tracer;
    if (tracer && this.built && this.targets.length > 0) tracer.maxSamples = this.targets[0];
  }

  /** Moves on to the next milestone once its denoised picture is read back: the library keeps the samples and raises the count. */
  private nextStage(): void {
    const tracer = this.tracer;
    if (!tracer || this.stage + 1 >= this.targets.length) return;
    this.stage++;
    tracer.maxSamples = this.targets[this.stage];
  }

  /** The size the resting picture is traced at: the output's, scaled to REST_PIXELS for a live view, whole for a still. A change starts it over. */
  private traceSize(target: THREE.WebGLRenderTarget | null): void {
    const tracer = this.tracer;
    if (!tracer) return;
    const out = frameSize(this.gl, target);
    let w = out.width;
    let h = out.height;
    if (!this.still && w * h > REST_PIXELS) {
      const k = Math.sqrt(REST_PIXELS / (w * h));
      w = Math.max(1, Math.floor(w * k));
      h = Math.max(1, Math.floor(h * k));
    }
    if (w === this.restW && h === this.restH) return;
    this.restW = w;
    this.restH = h;
    tracer.setSize(w, h);
    this.restart();
  }

  /** Starts the readbacks the resting picture needs: the denoised one once its pass is complete, else a raw one as it refines. */
  private advance(): void {
    const tracer = this.tracer;
    const denoiser = this.denoiser;
    // while a motion frame is traced the target is at the motion's size, so nothing is read back
    if (!tracer || this.restReading || this.moving || this.restW === 0) return;
    if (denoiser && denoiser.complete && this.readStage !== this.stage) {
      const source = denoiser.texture;
      if (source) this.readRest(source, true);
      return;
    }
    // the last denoised picture stays until the next one is read back
    if (denoiser && this.denoisedRun) return;
    const avg = this.avg;
    if (avg === this.rawAvg && !tracer.complete) return;
    if (performance.now() - this.rawAt < RAW_EVERY && !tracer.complete) return;
    if (tracer.target) this.readRest(tracer.target, false);
  }

  /** Reads `source` back as the resting picture; a denoised one moves the milestone on. A read from an earlier run is dropped. */
  private readRest(source: THREE.Texture, denoised: boolean): void {
    const renderer = this.renderer;
    if (!renderer) return;
    const run = this.run;
    const stage = this.stage;
    const avg = this.avg;
    const w = this.restW;
    const h = this.restH;
    this.restReading = true;
    this.rawAt = performance.now();
    this.rawAvg = avg;
    this.restBlit
      .read(renderer, source, w, h)
      .then((data) => {
        if (this.disposed || run !== this.run) return;
        this.picture = holdPicture(this.picture, data, w, h);
        this.pictureW = w;
        this.pictureH = h;
        this.pictureDenoised = denoised;
        this.pictureSamples = denoised ? (this.targets[stage] ?? avg) : avg;
        this.dirty = true;
        if (denoised) {
          this.readStage = stage;
          this.denoisedRun = true;
          this.nextStage();
        }
      })
      .catch((err: unknown) => console.warn("openvwx: path tracer picture", describe(err)))
      .finally(() => {
        this.restReading = false;
        this.pump();
      });
  }

  /** Draws the resting picture finished to `target`, if one has been read back. */
  private draw(settings: RenderSettings, target: THREE.WebGLRenderTarget | null): void {
    const scene = this.scene;
    const camera = this.camera;
    if (!this.picture || !scene || !camera) return;
    const { width, height } = frameSize(this.gl, target);
    const restore = keepRenderer(this.gl);
    try {
      // a denoised picture is not denoised again: the finish denoises only what is raw
      this.finisher.render(this.gl, this.picture, this.pictureW, this.pictureH, this.pictureSamples, !this.pictureDenoised, scene, camera, settings, target, width, height);
    } finally {
      restore();
    }
  }

  /** Starts the timer that finishes a picture the view has stopped asking for, while one is due. */
  private pump(): void {
    if (this.pumping !== null || this.disposed || this.still || !this.needsPump()) return;
    this.pumping = setTimeout(() => this.tick(), PUMP_EVERY);
  }

  /** Whether a readback, a denoiser pass or a new raw count is still to be taken up. */
  private needsPump(): boolean {
    if (!this.ready || this.moving) return false;
    if (this.restReading) return true;
    const denoiser = this.denoiser;
    if (denoiser) return !denoiser.complete || this.readStage !== this.stage;
    return this.avg !== this.rawAvg;
  }

  /** One pump step: when the view has stopped asking, it takes the samples the denoiser needs; it reads back what is due and draws what arrived. */
  private tick(): void {
    this.pumping = null;
    const tracer = this.tracer;
    if (!tracer || this.disposed || !this.ready) return;
    const idle = performance.now() - this.lastSampleAt > IDLE_AFTER;
    if (idle && !this.moving && this.restW > 0) {
      // the view has stopped asking: this drives the denoiser at the last milestone, and measures
      tracer.renderSample();
    }
    this.advance();
    if (idle && this.dirty && this.lastSettings) {
      this.dirty = false;
      this.draw(this.lastSettings, this.lastTarget);
    }
    this.pump();
  }
}
