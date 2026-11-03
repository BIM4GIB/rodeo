// The 3D view's Realistic and Path Traced modes (View3D.setRenderHook). It builds the render scene
// from what the view shows, once the textures are decoded, and builds it again when the model, what
// is visible or the light objects change. Realistic rasterises each frame; Path Traced rasterises
// while the view moves and, once it rests, refines a path-traced picture a sample a frame up to the
// Render palette's preview samples. The view panes without the live view get a still Realistic
// picture each (picture), or a path-traced one refined on a renderer of their own (tracePane,
// paneTrace.ts). Loaded with the first realistic frame or picture, with three.js.

import * as THREE from "three";
import type { PhysicalCamera } from "three-gpu-pathtracer";
import { store } from "../../app/state.ts";
import type { RealisticMode, RenderHook, View3D } from "../../app/view3d.ts";
import type { Light3D } from "../../core/index.ts";
import { publishMaterials, publishStatus, type MaterialItem } from "./bridge.ts";
import { renderCamera, shotOfView, type ViewOffset } from "./camera.ts";
import { guessPreset } from "./materials.ts";
import { PaneTracer, type PaneResult } from "./paneTrace.ts";
import { PathEngine } from "./pathtrace.ts";
import { RasterEngine } from "./raster.ts";
import { buildScene, type RenderScene } from "./sceneBuilder.ts";
import { materialLabel, onRender, renderSettings } from "./settings.ts";

/** how long the view rests after moving before a Path Traced picture starts refining */
const SETTLE_MS = 180;

export class LiveRenderer implements RenderHook {
  private readonly view: View3D;
  private raster: RasterEngine | null = null;
  private path: PathEngine | null = null;
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

  constructor(view: View3D) {
    this.view = view;
    onRender(() => this.settingsChanged());
    store.on("viz3d", () => this.settingsChanged());
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
      this.raster ??= new RasterEngine(renderer);
      this.raster.render(scene, camera, settings);
      publishStatus("Realistic");
      return false;
    }

    const path = (this.path ??= new PathEngine(renderer));
    if (this.pathScene !== scene && !this.pathBuilding) this.givePath(path, scene, camera);
    if (moving || !path.ready || this.pathScene !== scene) {
      // a clean raster picture while the view moves or the path tracer builds
      this.raster ??= new RasterEngine(renderer);
      this.raster.render(scene, camera, settings);
      publishStatus(this.pathBuilding ? "Path traced · building the scene…" : "Path traced · moving");
      // keep frames coming until the view has rested
      return moving;
    }
    const target = settings.quality.previewSamples;
    path.sample(settings, false, null);
    publishStatus(`Path traced · ${Math.min(path.samples, target)} of ${target >= 100000 ? "∞" : target} samples`);
    return path.samples < target;
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

  /** The render scene for what the view shows now, with the settings taken up; null while one is being prepared. */
  private freshScene(): RenderScene | null {
    const scene = this.currentScene();
    if (!scene || !this.settingsStale) return scene;
    this.settingsStale = false;
    const settings = renderSettings();
    const change = scene.update(settings, store.viz3d);
    if (this.pathScene === scene) this.path?.updateScene(change, settings);
    this.panes?.updateScene(scene, change, settings);
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
    // the path tracers keep their copy of the old scene until they have the new one
    if (old) this.retire(old);
    this.publishMaterials(this.scene);
    this.view.redraw();
  }

  /** Gives the path tracer `scene`, building its BVH; the raster picture shows meanwhile. */
  private givePath(path: PathEngine, scene: RenderScene, camera: THREE.Camera): void {
    this.pathBuilding = true;
    const previous = this.pathScene;
    path
      .setScene(scene, camera)
      .then(() => {
        this.pathScene = scene;
        // settings changed while the BVH was building reach the path tracer now
        path.updateScene({ geometry: false, materials: true, lights: true, environment: true }, renderSettings());
        if (previous) this.retire(previous);
      })
      .catch((err: unknown) => console.error("openvwx: path tracer scene", err))
      .finally(() => {
        this.pathBuilding = false;
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
    this.path?.setCamera(this.camera);
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
      });
    }
    items.sort((a, b) => a.label.localeCompare(b.label));
    publishMaterials(items);
  }
}

/** What of the light objects the render scene is built from. */
function lightsKey(lights: readonly Light3D[]): string {
  return lights.map((l) => `${l.id}:${l.kind}:${l.color}:${l.brightness}:${l.position.join(",")}:${l.direction.join(",")}:${l.spread}:${l.beam}`).join(";");
}
