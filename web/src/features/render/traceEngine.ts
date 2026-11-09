// What a path tracer offers the Path Traced view, the view panes and Render Image, whichever GPU
// API draws it: three-gpu-pathtracer's WebGL tracer (pathtrace.ts) or its WebGPU one (gpuEngine.ts).
// Both draw their finished pictures with the WebGL renderer they are given, through post.ts, so
// a picture looks the same from either. Motion frames feed the temporal filter (motion.ts) while
// the view moves.

import type * as THREE from "three";
import type { RenderScene, SceneChange } from "./sceneBuilder.ts";
import type { RenderSettings } from "./settings.ts";

export type EngineKind = "webgl" | "webgpu";

/**
 * One fresh noisy path-traced frame (a sample a pixel, or a few) of what a camera saw, linear HDR
 * in a texture of the WebGL renderer, and the camera it was traced through: a WebGPU frame arrives
 * a frame or two after it was asked for, so the camera may since have moved.
 */
export interface MotionFrame {
  readonly color: THREE.Texture;
  readonly width: number;
  readonly height: number;
  /** the camera's matrices when the frame was traced (render space) */
  readonly matrixWorld: THREE.Matrix4;
  readonly projectionMatrix: THREE.Matrix4;
  /** bumped for each new frame, so a frame is taken into the history once */
  readonly serial: number;
}

export interface TraceEngine {
  readonly kind: EngineKind;
  /** the scene is set and built */
  readonly ready: boolean;
  /** samples a pixel in the resting picture so far */
  readonly samples: number;
  /** sample() has a picture to show (WebGPU's arrive a frame or more after they are traced) */
  readonly hasPicture: boolean;
  /** splits each still sample into tiles × tiles parts (the WebGL tracer; 1 elsewhere) */
  tiles: number;
  /** Sets the scene and builds what it traces against, off the page's thread where it can. */
  setScene(scene: RenderScene, camera: THREE.Camera, onProgress?: (fraction: number) => void): Promise<void>;
  /** After RenderScene.update: takes up what changed and starts over. */
  updateScene(change: SceneChange, settings: RenderSettings): void;
  /** The camera moved, or another one is used: starts over. */
  setCamera(camera: THREE.Camera): void;
  /** Starts the resting picture over. */
  reset(): void;
  /** One more sample of the resting picture, then shows it finished to `target` (null: the canvas). */
  sample(settings: RenderSettings, interactive: boolean, target?: THREE.WebGLRenderTarget | null): void;
  /**
   * While the view moves: traces a new noisy frame through the current camera at about `scale` of
   * `width` × `height` and returns the newest frame ready (null while none is). Starts the resting
   * picture over.
   */
  motionFrame(settings: RenderSettings, scale: number, width: number, height: number): MotionFrame | null;
  /** One more sample (one tile of one, when tiled) without showing it, waiting for the GPU (stills). */
  accumulate(settings: RenderSettings, target?: THREE.WebGLRenderTarget | null): void | Promise<void>;
  /** Shows the picture as it stands, finished, to `target` (null: the canvas). */
  show(settings: RenderSettings, target?: THREE.WebGLRenderTarget | null): void | Promise<void>;
  dispose(): void;
}
