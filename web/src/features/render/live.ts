// The 3D view's Realistic and Path Traced modes (View3D.setRenderHook). It builds the render scene
// from what the view shows, once the textures are decoded, and builds it again when the model, what
// is visible, the light objects or a library material change. Realistic rasterises each frame.
// Path Traced traces with WebGPU where the browser has it (gpuEngine.ts), else with WebGL
// (pathtrace.ts): while the view moves, a small noisy frame each time, made steady over frames by
// motion.ts; once it rests, a picture refined a sample a frame up to the Render palette's preview
// samples, which takes over from the moving view's last picture once it has a few samples. The view
// panes without the live view get a still Realistic picture each (picture), or a path-traced one
// refined on a renderer of their own (tracePane, paneTrace.ts). Loaded with the first realistic
// frame or picture, with three.js.

import * as THREE from "three";
import type { PhysicalCamera } from "three-gpu-pathtracer";
import { store } from "../../app/state.ts";
import type { RealisticMode, RenderHook, View3D } from "../../app/view3d.ts";
import type { Light3D } from "../../core/index.ts";
import { publishMaterials, publishStatus, type MaterialItem } from "./bridge.ts";
import { renderCamera, shotOfView, type ViewOffset } from "./camera.ts";
import { webgpuAvailable, webgpuKnown } from "./gpuSupport.ts";
import { onLibraryLoaded } from "./library.ts";
import { guessPreset } from "./materials.ts";
import { MotionFilter } from "./motion.ts";
import { PaneTracer, type PaneResult } from "./paneTrace.ts";
import { PathEngine, TraceFinisher, frameSize } from "./pathtrace.ts";
import { RasterEngine } from "./raster.ts";
import { buildScene, type RenderScene } from "./sceneBuilder.ts";
import { materialLabel, onRender, renderSettings, type RenderSettings } from "./settings.ts";
import type { EngineKind, MotionFrame, TraceEngine } from "./traceEngine.ts";

/** how long the view rests after moving before a Path Traced picture starts refining */
const SETTLE_MS = 180;
/** the moving view's frames, as a share of the output's size on each side: to begin with, at least and at most */
const MOTION_SCALE = 0.35;
const MOTION_MIN = 0.15;
const MOTION_MAX = 0.6;
/** the most pixels a moving view's frame has, however large the view */
const MOTION_PIXELS = 600_000;
/** the time between frames a moving view aims for, ms: the frames' size follows it */
const MOTION_FRAME_MS = 28;
/** a gap between frames longer than this is a pause, not a slow frame, and leaves the size alone */
const MOTION_GAP_MS = 250;
/** samples the resting picture takes before it shows in place of the moving view's last picture */
const HANDOVER_SAMPLES = 6;

type GpuModule = typeof import("./gpuEngine.ts");

export class LiveRenderer implements RenderHook {
  private readonly view: View3D;
  private raster: RasterEngine | null = null;
  /** the path tracer the view traces with, WebGL's or WebGPU's */
  private engine: TraceEngine | null = null;
  private scene: RenderScene | null = null;
  /** what the scene was built from: the view's model and texture versions and the lights */
  private builtFrom = "";
  /** a build waiting on the textures, by what it is built from */
  private building: string | null = null;
  private camera: PhysicalCamera | THREE.OrthographicCamera | null = null;
  /** the view camera's matrices the render camera was made from, to see it move */
  private readonly lastWorld = new THREE.Matrix4();
  private readonly lastProjection = new THREE.Matrix4();
  private movedAt = 0;
  /** the lens settings the render camera was made with */
  private lens = "";
  /** the path tracer has the current scene */
  private pathScene: RenderScene | null = null;
  private pathBuilding = false;
  private settingsStale = true;
  /** bumped as the settings or the sun change, so the Path Traced panes start over */
  private settingsVersion = 0;
  /** the Path Traced view panes' own renderer and path tracer, while a pane shows Path Traced */
  private panes: PaneTracer | null = null;
  /** makes the moving view's frames steady, and shows their picture finished */
  private motion: MotionFilter | null = null;
  private finisher: TraceFinisher | null = null;
  /** the moving view's last steady picture and the frame it came from, shown until the resting picture takes over */
  private still: { readonly texture: THREE.Texture; readonly frame: MotionFrame } | null = null;
  private motionScale = MOTION_SCALE;
  private lastMotionAt = 0;
  /** the WebGPU engine's code, once loaded (it comes with three's WebGPU build) */
  private gpu: GpuModule | null = null;
  private gpuLoading = false;
  /** WebGPU failed this session (no adapter, a lost device, a scene it couldn't take): WebGL traces from then on */
  private gpuFailed = false;

  constructor(view: View3D) {
    this.view = view;
    onRender(() => this.settingsChanged());
    store.on("viz3d", () => this.settingsChanged());
    // a library material's textures arrived: the materials that use it take them up
    onLibraryLoaded(() => this.settingsChanged());
  }

  draw(mode: RealisticMode, renderer: THREE.WebGLRenderer, viewCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera): boolean {
    const scene = this.freshScene();
    if (!scene) {
      // the textures are decoding: the view's own picture meanwhile
      renderer.render(this.view.threeScene, viewCamera);
      publishStatus("Preparing the render…");
      return false;
    }
    const settings = renderSettings();
    const camera = this.cameraFor(renderer, viewCamera);
    const moving = performance.now() - this.movedAt < SETTLE_MS;

    if (mode === "realistic") {
      this.rasterise(renderer, scene, camera, settings);
      publishStatus("Realistic");
      return false;
    }

    const engine = this.engineFor(renderer, settings);
    if (engine && this.pathScene !== scene && !this.pathBuilding) this.givePath(engine, scene, camera);
    if (!engine || !engine.ready || this.pathScene !== scene) {
      // a clean raster picture while the path tracer loads or builds
      this.rasterise(renderer, scene, camera, settings);
      publishStatus(!engine ? "Path traced · starting…" : this.pathBuilding ? "Path traced · building the scene…" : "Path traced · moving");
      // keep frames coming until the view has rested
      return moving;
    }

    if (moving) {
      this.still = null;
      if (settings.quality.motion === "raster" || !this.drawMotion(renderer, engine, scene, settings)) {
        this.rasterise(renderer, scene, camera, settings);
      }
      publishStatus(`Path traced · moving${engine.kind === "webgpu" ? " · WebGPU" : ""}`);
      return true;
    }

    const target = settings.quality.previewSamples;
    engine.sample(settings, false, null);
    // the moving view's last picture shows until the resting one has a few samples, else the raster one until it has a picture at all
    const still = this.still;
    if (still && (!engine.hasPicture || engine.samples < Math.min(HANDOVER_SAMPLES, target))) this.showStill(renderer, scene, still, settings);
    else if (!engine.hasPicture) this.rasterise(renderer, scene, camera, settings);
    else this.still = null;
    publishStatus(`Path traced · ${Math.min(Math.floor(engine.samples), target)} of ${target >= 100000 ? "∞" : target} samples${engine.kind === "webgpu" ? " · WebGPU" : ""}`);
    return engine.samples < target;
  }

  /**
   * A still Realistic picture through `viewCamera` for a view pane (a Path Traced pane's when it
   * can't be traced), with a render camera of its own: the live view's camera and path tracer stay
   * as they are. False while the scene is being prepared.
   */
  picture(renderer: THREE.WebGLRenderer, viewCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera): boolean {
    const scene = this.freshScene();
    if (!scene) return false;
    const settings = renderSettings();
    viewCamera.updateMatrixWorld();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const camera = renderCamera(shotOfView(viewCamera, this.view.orbitTarget), size.x / Math.max(1, size.y), settings.camera);
    this.raster ??= new RasterEngine(renderer);
    this.raster.render(scene, camera, settings);
    return true;
  }

  /**
   * A Path Traced view pane's picture through `viewCamera`, `width` × `height` px, refined a sample a
   * call on the panes' own renderer and drawn onto `canvas`; "unable" while the scene is first
   * prepared (the pane gets a still picture meanwhile).
   */
  tracePane(canvas: HTMLCanvasElement, viewCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number): PaneResult {
    const scene = this.freshScene();
    if (!scene) return "unable";
    const settings = renderSettings();
    viewCamera.updateMatrixWorld();
    const camera = renderCamera(shotOfView(viewCamera, this.view.orbitTarget), width / Math.max(1, height), settings.camera);
    this.panes ??= new PaneTracer((s) => this.retire(s));
    return this.panes.trace(canvas, scene, camera, settings, this.settingsVersion, width, height);
  }

  /** No pane shows Path Traced: the panes' renderer and path tracer go. */
  releasePanes(): void {
    const panes = this.panes;
    this.panes = null;
    panes?.dispose();
  }

  private rasterise(renderer: THREE.WebGLRenderer, scene: RenderScene, camera: THREE.Camera, settings: RenderSettings): void {
    this.raster ??= new RasterEngine(renderer);
    this.raster.render(scene, camera, settings);
  }

  /**
   * The moving view: a new noisy frame from the path tracer, made steady with the frames before it,
   * finished to the canvas. False when no frame is ready yet (the caller rasterises instead). The
   * frames' size follows how fast they come.
   */
  private drawMotion(renderer: THREE.WebGLRenderer, engine: TraceEngine, scene: RenderScene, settings: RenderSettings): boolean {
    const { width, height } = frameSize(renderer, null);
    const now = performance.now();
    const gap = now - this.lastMotionAt;
    this.lastMotionAt = now;
    if (gap < MOTION_GAP_MS) {
      // a slow frame shrinks the next ones, a quick one grows them, by a little each time
      if (gap > MOTION_FRAME_MS * 1.15) this.motionScale = Math.max(MOTION_MIN, this.motionScale * 0.9);
      else if (gap < MOTION_FRAME_MS * 0.8) this.motionScale = Math.min(MOTION_MAX, this.motionScale * 1.05);
    }
    const scale = Math.min(this.motionScale, Math.sqrt(MOTION_PIXELS / (width * height)));
    const frame = engine.motionFrame(settings, scale, width, height);
    if (!frame) return false;
    this.motion ??= new MotionFilter(renderer);
    const texture = this.motion.render(scene, frame, width, height);
    this.still = { texture, frame };
    this.showStill(renderer, scene, this.still, settings);
    return true;
  }

  /** The moving view's steady picture, finished to the canvas through the camera it was traced with. */
  private showStill(renderer: THREE.WebGLRenderer, scene: RenderScene, still: { readonly texture: THREE.Texture; readonly frame: MotionFrame }, settings: RenderSettings): void {
    const { width, height } = frameSize(renderer, null);
    const camera = frameCamera(still.frame, this.camera);
    this.finisher ??= new TraceFinisher();
    // the depth of field, fog and outlines read the depth through the frame's camera
    this.finisher.forgetDepth();
    this.finisher.render(renderer, still.texture, width, height, Infinity, false, scene, camera, settings, null, width, height);
  }

  /**
   * The path tracer the settings ask for: WebGPU's where the browser has it (unless WebGL is asked
   * for, or WebGPU failed this session), else WebGL's. Null while WebGPU's code loads or the
   * browser is asked whether it has WebGPU. A change of engine starts the path tracer over.
   */
  private engineFor(renderer: THREE.WebGLRenderer, settings: RenderSettings): TraceEngine | null {
    const kind = this.wantedEngine(settings);
    if (kind === null) return null;
    if (this.engine?.kind === kind) return this.engine;
    if (kind === "webgpu" && !this.gpu) {
      this.loadGpu();
      return null;
    }
    this.dropEngine();
    this.engine = kind === "webgpu" && this.gpu ? new this.gpu.GpuEngine(renderer) : new PathEngine(renderer);
    return this.engine;
  }

  /** Which engine to trace with, or null while the browser is asked whether it has WebGPU. */
  private wantedEngine(settings: RenderSettings): EngineKind | null {
    if (settings.quality.engine === "webgl" || this.gpuFailed) return "webgl";
    const known = webgpuKnown();
    if (known === null) {
      webgpuAvailable().then(() => this.view.redraw(), () => this.view.redraw());
      return null;
    }
    return known ? "webgpu" : "webgl";
  }

  private loadGpu(): void {
    if (this.gpuLoading) return;
    this.gpuLoading = true;
    import("./gpuEngine.ts")
      .then((m) => {
        this.gpu = m;
      })
      .catch((err: unknown) => {
        console.error("openvwx: the WebGPU path tracer", err);
        this.gpuFailed = true;
      })
      .finally(() => {
        this.gpuLoading = false;
        this.view.redraw();
      });
  }

  /** Lets go of the path tracer and what it showed: another engine takes over. */
  private dropEngine(): void {
    const engine = this.engine;
    this.engine = null;
    const scene = this.pathScene;
    this.pathScene = null;
    this.pathBuilding = false;
    this.still = null;
    this.motion?.reset();
    engine?.dispose();
    if (scene) this.retire(scene);
  }

  /** The render scene for what the view shows now, with the settings taken up; null while one is being prepared. */
  private freshScene(): RenderScene | null {
    const scene = this.currentScene();
    if (!scene || !this.settingsStale) return scene;
    this.settingsStale = false;
    const settings = renderSettings();
    const change = scene.update(settings, store.viz3d);
    if (this.pathScene === scene) this.engine?.updateScene(change, settings);
    this.panes?.updateScene(scene, change, settings);
    // what the frames showed has changed: the moving view's history starts over
    if (change.geometry || change.materials || change.lights || change.environment) {
      this.motion?.reset();
      this.still = null;
    }
    return scene;
  }

  /** Disposes of a scene nothing draws any longer: not the view's, the live path tracer's nor the panes'. */
  private retire(scene: RenderScene): void {
    if (scene !== this.scene && scene !== this.pathScene && scene !== this.panes?.scene) scene.dispose();
  }

  /** The render scene for what the view shows now, or null while one is being prepared. */
  private currentScene(): RenderScene | null {
    const lights = this.view.visibleLights();
    const from = `${this.view.modelVersion}|${this.view.textureVersion}|${lightsKey(lights)}`;
    if (from === this.builtFrom && this.scene) return this.scene;
    if (this.building !== from) {
      this.building = from;
      this.view
        .ensureTextures()
        .then(() => {
          if (this.building !== from) return;
          this.building = null;
          this.rebuild();
        })
        .catch((err: unknown) => console.error("openvwx: render textures", err));
    }
    // the previous scene stands in until the new one is ready
    return this.scene;
  }

  /** Builds the render scene from the view's model as it is now. */
  private rebuild(): void {
    const lights = this.view.visibleLights();
    const old = this.scene;
    this.scene = buildScene({ faces: this.view.modelFaces(), content: this.view.visibleContent(), lights }, renderSettings(), store.viz3d);
    // the textures may have finished decoding since the build was asked for
    this.builtFrom = `${this.view.modelVersion}|${this.view.textureVersion}|${lightsKey(lights)}`;
    this.settingsStale = false;
    this.motion?.reset();
    this.still = null;
    // the path tracers keep their copy of the old scene until they have the new one
    if (old) this.retire(old);
    this.publishMaterials(this.scene);
    this.view.redraw();
  }

  /**
   * Gives the path tracer `scene`, building what it traces against; the raster picture shows
   * meanwhile. A WebGPU engine that can't take it hands over to WebGL for the rest of the session.
   */
  private givePath(engine: TraceEngine, scene: RenderScene, camera: THREE.Camera): void {
    this.pathBuilding = true;
    const previous = this.pathScene;
    engine
      .setScene(scene, camera)
      .then(() => {
        if (this.engine !== engine) return;
        this.pathScene = scene;
        // settings changed while the BVH was building reach the path tracer now
        engine.updateScene({ geometry: false, materials: true, lights: true, environment: true }, renderSettings());
        if (previous) this.retire(previous);
      })
      .catch((err: unknown) => {
        if (engine.kind === "webgpu" && this.engine === engine) {
          console.warn("openvwx: WebGPU could not trace the scene; WebGL traces it instead", err);
          this.gpuFailed = true;
          this.dropEngine();
          return;
        }
        console.error("openvwx: path tracer scene", err);
      })
      .finally(() => {
        if (this.engine === engine || this.engine === null) this.pathBuilding = false;
        this.view.redraw();
      });
  }

  /** The render camera for the view's camera, made again (and the path tracer started over) when the view has moved. */
  private cameraFor(renderer: THREE.WebGLRenderer, viewCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera): PhysicalCamera | THREE.OrthographicCamera {
    viewCamera.updateMatrixWorld();
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const lens = JSON.stringify(renderSettings().camera);
    const moved = !this.camera || !viewCamera.matrixWorld.equals(this.lastWorld) || !viewCamera.projectionMatrix.equals(this.lastProjection);
    if (!moved && this.camera && lens === this.lens) return this.camera;
    this.lens = lens;
    this.lastWorld.copy(viewCamera.matrixWorld);
    this.lastProjection.copy(viewCamera.projectionMatrix);
    // a new lens, or the first camera, is no move: a picture refines from the start
    if (this.camera && moved) this.movedAt = performance.now();
    const v = viewCamera.view;
    const offset: ViewOffset | null = v?.enabled ? { fullWidth: v.fullWidth, fullHeight: v.fullHeight, x: v.offsetX, y: v.offsetY, width: v.width, height: v.height } : null;
    this.camera = renderCamera(shotOfView(viewCamera, this.view.orbitTarget), size.x / Math.max(1, size.y), renderSettings().camera, this.camera, offset);
    this.engine?.setCamera(this.camera);
    return this.camera;
  }

  /** A render setting or the Heliodon changed: the next frame takes it up. */
  private settingsChanged(): void {
    this.settingsStale = true;
    this.settingsVersion++;
    this.view.restyled();
  }

  /** Tells the Render palette the scene's materials. */
  private publishMaterials(scene: RenderScene): void {
    const items: MaterialItem[] = [];
    for (const [key, { faces }] of scene.materials) {
      const face = faces[0];
      if (!face) continue;
      const res = face.resource;
      items.push({
        key,
        label: materialLabel(face),
        color: face.color,
        preview: res?.preview?.length ? { bytes: res.preview, mime: res.previewMime } : null,
        guess: guessPreset(face),
        count: faces.length,
        textured: face.map !== null,
      });
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    publishMaterials(items);
  }
}

/**
 * A camera with the matrices `frame` was traced through, for the finish's depth: the render
 * camera itself when it hasn't moved since, else a copy of it (its lens and range) put where the
 * frame was traced from.
 */
function frameCamera(frame: MotionFrame, current: THREE.Camera | null): THREE.Camera {
  if (current && current.matrixWorld.equals(frame.matrixWorld) && current.projectionMatrix.equals(frame.projectionMatrix)) return current;
  const camera: THREE.Camera = current ? current.clone() : frame.projectionMatrix.elements[15] === 0 ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera();
  camera.matrixAutoUpdate = false;
  camera.matrixWorld.copy(frame.matrixWorld);
  camera.matrixWorldInverse.copy(frame.matrixWorld).invert();
  camera.projectionMatrix.copy(frame.projectionMatrix);
  camera.projectionMatrixInverse.copy(frame.projectionMatrix).invert();
  return camera;
}

/** What of the light objects the render scene is built from. */
function lightsKey(lights: readonly Light3D[]): string {
  return lights.map((l) => `${l.id}:${l.kind}:${l.color}:${l.brightness}:${l.position.join(",")}:${l.direction.join(",")}:${l.spread}:${l.beam}`).join(";");
}
