// Path Traced view panes (the panes without the live 3D view): each refines a path-traced picture of
// its own through its camera, a sample a call, on a WebGL renderer the panes share (as Render Image
// has one of its own), so the live view's renderer, camera and path tracer stay as they are. One
// pane refines at a time, to the Render palette's preview samples (at most PANE_SAMPLES); the others
// keep the picture they have, a Realistic one to begin with, until their turn. A pane whose camera,
// size, scene or settings change starts over.

import * as THREE from "three";
import type { PhysicalCamera } from "three-gpu-pathtracer";
import { PathEngine } from "./pathtrace.ts";
import { RasterEngine } from "./raster.ts";
import type { RenderScene, SceneChange } from "./sceneBuilder.ts";
import { renderSettings, type RenderSettings } from "./settings.ts";

/** most samples a pane takes: an endless preview would keep the other panes waiting for ever */
const PANE_SAMPLES = 512;
/** the pane refining that hasn't asked for a sample in this long has gone (closed, or no longer Path Traced): the next takes its turn */
const STALE_MS = 1000;

export type PaneResult = "refining" | "done" | "unable";

interface Pane {
  /** what its picture is made from: size, camera, scene and settings */
  key: string;
  /** samples in its picture, 0 for a still Realistic one, -1 for none yet */
  samples: number;
}

/** Each scene's number, for the panes' keys. */
const sceneIds = new WeakMap<RenderScene, number>();
let nextSceneId = 1;

function sceneId(scene: RenderScene): number {
  let id = sceneIds.get(scene);
  if (id === undefined) {
    id = nextSceneId++;
    sceneIds.set(scene, id);
  }
  return id;
}

/** Puts the pane renderer's picture on the pane's canvas, at its pixel size. */
function copy(canvas: HTMLCanvasElement, from: HTMLCanvasElement, w: number, h: number): void {
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.getContext("2d")?.drawImage(from, 0, 0, w, h);
}

export class PaneTracer {
  private renderer: THREE.WebGLRenderer | null = null;
  private engine: PathEngine | null = null;
  private raster: RasterEngine | null = null;
  /** the scene the path tracer has (built), and one whose build failed, not tried again */
  private traced: RenderScene | null = null;
  private failed: RenderScene | null = null;
  private building = false;
  /** the renderer's context went (a GPU reset): the panes get still pictures from then on */
  private lost = false;
  private readonly panes = new WeakMap<HTMLCanvasElement, Pane>();
  /** the pane refining now, and when it last took a sample */
  private active: HTMLCanvasElement | null = null;
  private activeAt = 0;
  /** lets go of a scene the path tracer no longer has, if nothing else draws it */
  private readonly retire: (scene: RenderScene) => void;
  private readonly onLost = (): void => {
    this.lost = true;
  };

  constructor(retire: (scene: RenderScene) => void) {
    this.retire = retire;
  }

  /** The scene the path tracer has, which the live renderer mustn't dispose of. */
  get scene(): RenderScene | null {
    return this.traced;
  }

  /**
   * A sample more of the picture on `canvas` (`w` × `h` px) through `camera` when it is this pane's
   * turn; a still Realistic picture the first time while it waits. `settingsVersion` changes with
   * the Render palette's settings and the sun.
   */
  trace(canvas: HTMLCanvasElement, scene: RenderScene, camera: PhysicalCamera | THREE.OrthographicCamera, settings: RenderSettings, settingsVersion: number, w: number, h: number): PaneResult {
    const r = this.lost || this.failed === scene ? null : this.ensureRenderer();
    if (!r) return "unable";
    camera.updateMatrixWorld();
    const key = `${w}x${h}|${camera.matrixWorld.elements.join(",")}|${camera.projectionMatrix.elements.join(",")}|${sceneId(scene)}|${settingsVersion}`;
    let pane = this.panes.get(canvas);
    if (!pane || pane.key !== key) {
      pane = { key, samples: -1 };
      this.panes.set(canvas, pane);
      if (this.active === canvas) this.active = null;
    }
    const target = Math.min(settings.quality.previewSamples, PANE_SAMPLES);
    if (pane.samples >= target) return "done";
    const now = performance.now();
    if (this.active !== null && this.active !== canvas && now - this.activeAt > STALE_MS) this.active = null;
    if (this.traced !== scene && !this.building) this.give(scene, camera);
    const engine = this.engine;
    if ((this.active !== null && this.active !== canvas) || this.building || !engine?.ready) {
      // waiting its turn, or for the scene's BVH: a still picture to show meanwhile
      if (pane.samples < 0) {
        this.still(r, canvas, scene, camera, settings, w, h);
        pane.samples = 0;
      }
      return "refining";
    }
    if (this.active !== canvas) {
      this.active = canvas;
      engine.setCamera(camera);
      engine.reset();
    }
    this.activeAt = now;
    if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
    engine.sample(settings, false, null);
    // a first sample draws nothing on a lost context: the still picture stays
    if (this.lost) return "unable";
    pane.samples = Math.max(1, engine.samples);
    copy(canvas, r.domElement, w, h);
    if (pane.samples < target) return "refining";
    this.active = null;
    return "done";
  }

  /** After RenderScene.update: the path tracer takes up what changed (the panes start over by their keys). */
  updateScene(scene: RenderScene, change: SceneChange, settings: RenderSettings): void {
    if (this.traced === scene && this.engine?.ready) this.engine.updateScene(change, settings);
  }

  dispose(): void {
    this.engine?.dispose();
    this.raster?.dispose();
    this.engine = null;
    this.raster = null;
    if (this.renderer) {
      this.renderer.domElement.removeEventListener("webglcontextlost", this.onLost);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    const scene = this.traced;
    this.traced = null;
    this.active = null;
    if (scene) this.retire(scene);
  }

  /** The panes' renderer, made the first time; null when the browser won't give one. */
  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas"), antialias: false, preserveDrawingBuffer: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      // after a GPU reset the browser may refuse WebGL until the page reloads
      this.lost = true;
      return null;
    }
    this.renderer.setPixelRatio(1);
    this.renderer.domElement.addEventListener("webglcontextlost", this.onLost);
    return this.renderer;
  }

  /** A still Realistic picture of the pane, while it waits. */
  private still(r: THREE.WebGLRenderer, canvas: HTMLCanvasElement, scene: RenderScene, camera: THREE.Camera, settings: RenderSettings, w: number, h: number): void {
    if (r.domElement.width !== w || r.domElement.height !== h) r.setSize(w, h, false);
    this.raster ??= new RasterEngine(r);
    this.raster.render(scene, camera, settings);
    copy(canvas, r.domElement, w, h);
  }

  /** Gives the path tracer `scene`, building its BVH in a worker; the panes wait meanwhile. */
  private give(scene: RenderScene, camera: THREE.Camera): void {
    const r = this.renderer;
    if (!r) return;
    const engine = (this.engine ??= new PathEngine(r));
    const previous = this.traced;
    this.building = true;
    engine
      .setScene(scene, camera)
      .then(() => {
        if (!engine.ready) return;
        this.traced = scene;
        // settings changed while the BVH was building reach the path tracer now
        engine.updateScene({ geometry: false, materials: true, lights: true, environment: true }, renderSettings());
        if (previous && previous !== scene) this.retire(previous);
      })
      .catch((err: unknown) => {
        this.failed = scene;
        console.error("openvwx: view pane path tracer", err);
      })
      .finally(() => {
        this.building = false;
      });
  }
}
