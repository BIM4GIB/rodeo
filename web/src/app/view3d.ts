// 3D view: the design layers' objects as a WebGL scene (three.js), z up, in world
// millimetres. Objects are merged into one geometry per colour, opacity and texture,
// and into one edge set per colour, so a model of millions of triangles is a few draw
// calls. Each merged array keeps the runs of triangles (or segments) that belong to
// each object: a click maps the hit triangle back to its object, and layer visibility
// rewrites the index buffers. The scene is drawn on demand (camera moves, resizes,
// edits), never in a loop. The Visualization palette's settings (heliodon.ts) choose a
// perspective or orthogonal camera, where the sun stands and whether it casts shadows,
// and the clip cube that cuts the model open; View > Rendering's options how Shaded draws
// (textures, colours, edges, shadows on the ground only, their quality) and the dashes of
// Dashed Hidden Line. The selected objects are drawn over the model in the selection's colour
// (setSelected).

import "./view3d.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Light3D, Mesh3D, ResourceInfo, Vec3 } from "../core/index.ts";
import { beamGroup, boxReach, disposeBeams, surfaceReaches } from "./beams.ts";
import { h } from "./dom.ts";
import { DEFAULT_VIZ, MAX_LAMPS, sunPlace, type ShadowQuality, type Viz3D } from "./heliodon.ts";
import { ACCENT } from "./renderer.ts";

/**
 * Hidden Line: white faces hide the edges behind them; Dashed Hidden Line also dashes those edges.
 * Realistic and Path Traced are drawn by the render feature (setRenderHook); Shaded without one.
 */
export type RenderMode = "shaded" | "textured" | "wireframe" | "hidden" | "dashed" | "sketch" | RealisticMode;
export type RealisticMode = "realistic" | "pathtraced";
/** the standard views; "iso" is Right Isometric */
export type ViewPreset =
  | "top"
  | "bottom"
  | "front"
  | "back"
  | "left"
  | "right"
  | "iso"
  | "leftIso"
  | "rightRearIso"
  | "leftRearIso"
  | "lowerRightIso"
  | "lowerLeftIso"
  | "lowerRightRearIso"
  | "lowerLeftRearIso";

export function isRealistic(mode: RenderMode): mode is RealisticMode {
  return mode === "realistic" || mode === "pathtraced";
}

/** What draws the Realistic and Path Traced modes (features/render), with the view's renderer and camera. */
export interface RenderHook {
  /** Draws a frame of `mode` onto the view's canvas; true asks for another frame (a picture still refining). */
  draw(mode: RealisticMode, renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): boolean;
  /**
   * Draws a still Realistic picture through `camera` for a view pane, leaving the live view's render
   * as it is; false while it can't yet (loading, the scene being prepared).
   */
  picture?(renderer: THREE.WebGLRenderer, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera): boolean;
  /**
   * Draws a view pane's Path Traced picture through `camera` straight onto `canvas`, `width` × `height`
   * px, with a renderer of its own (the live view's renderer and camera aren't touched): a sample
   * more each call, the panes refined one at a time. "refining" while it is still refining or
   * waiting its turn (call again), "done" once it has its samples, "unable" when it can't trace
   * (the pane then gets a still Realistic picture).
   */
  tracePane?(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, width: number, height: number): "refining" | "done" | "unable";
  /** No view pane shows Path Traced: what tracePane holds can go. */
  releasePanes?(): void;
}

/** A plane in the model (the working plane): a point on it and its x and y axes, unit and square; x × y is up from it. */
export interface PlaneFrame {
  readonly origin: Vec3;
  readonly x: Vec3;
  readonly y: Vec3;
}

/** A point on a face of the model and the face's normal there, turned toward the viewer, with the object it belongs to. */
export interface FaceHit {
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly objectId: string | null;
}

/** One merged face group of the model, as a renderer of its own takes it (modelFaces). */
export interface ModelFace {
  /**
   * positions (3 floats a corner, world mm, z up) and uvs when textured, indexed: the first
   * drawRange.count indices are the triangles of the objects on visible layers
   */
  readonly geometry: THREE.BufferGeometry;
  /** CSS hex colour */
  readonly color: string;
  /** 0..1 */
  readonly opacity: number;
  /** ResourceInfo.index of its texture, or -1 */
  readonly texture: number;
  readonly resource: ResourceInfo | null;
  /** its texture's image (sRGB) and transparency mask, once decoded (ensureTextures) */
  readonly map: THREE.Texture | null;
  readonly alphaMap: THREE.Texture | null;
  /** a wall's faces, drawn behind faces lying exactly on them */
  readonly recessed: boolean;
}

/** Where the camera stands, as a view pane keeps it to come back to: its eye, the point it orbits, its lens and ortho size. */
export interface CameraState {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly zoom: number;
  readonly half: number;
  readonly fov: number;
}

/**
 * What a drag with the left button does to the view, as the 3D viewing tools set it: orbit about the
 * centre (Flyover), orbit with a click setting the centre (its Interactive Origin), slide across the
 * screen or along the sightline (Translate View), or walk, look around or ride up and down
 * (Walkthrough).
 */
export type Navigation = "orbit" | "origin" | "pan" | "move" | "walk" | "look" | "elevator";

/** How a view pane draws the model: its render mode and projection. */
export interface PaneLook {
  readonly mode: RenderMode;
  readonly projection: Viz3D["projection"];
}

/** A view as a design layer saves it (LayerView): along `toward` (to the viewer), from or at `at`. */
export interface SavedView {
  toward: Vec3;
  at: Vec3;
  perspective: boolean;
}

/** light grey in both themes; the lights and the edge colour are tuned for it */
const BACKGROUND = 0xe6e7ea;
/** behind the model with the sun off: a stage at night */
const NIGHT_BACKGROUND = 0x0b0d12;
const EDGE_COLOR = 0x2a2e36;
/** Sketch: a pencil grey on paper, each edge drawn twice, each stroke's ends moved up to this many CSS px */
const PAPER = 0xfbfaf6;
const PENCIL = 0x34373d;
const SKETCH_WOBBLE = [2.2, 1.6];
const CLIP_COLOR = 0x2f6fdb;
const SUN_INTENSITY = 2.6;
const SKY_INTENSITY = 2.2;
/** how long the view rests before the light objects nearest it are chosen again */
const LAMP_SETTLE_MS = 250;
/** what a light object at 100 % gives at 1 m, as candela (distances are mm): the sun's light, a quarter of it at 2 m */
const LAMP_CANDELA = SUN_INTENSITY * 1000 ** 2;
/**
 * With the sun off, light objects are drawn this much brighter (5 stops), as a camera opens up at night:
 * a fixture 6 m away, about 3 % of the sun, then lights what it hits about as the sun would.
 */
const NIGHT_LAMP_GAIN = 32;
/** the beams in haze against what their lamps light: the view draws without a tone curve, so less than a render's */
const VIEW_BEAMS = 0.35;
/**
 * while the sun casts shadows, so do this many light objects of each kind: a directional one and the
 * spots and point light nearest where the view looks (a shadow map each, a point light's six)
 */
const SHADOW_LAMPS: Readonly<Record<Light3D["kind"], number>> = { directional: 1, spot: 2, point: 1 };
const SUN_SHADOW_MAP = 4096;
const LAMP_SHADOW_MAP = 2048;
const POINT_SHADOW_MAP = 1024;
/** the shadow maps at each Shaded Options shadow quality, as a share of the sizes above */
const SHADOW_SCALE: Readonly<Record<ShadowQuality, number>> = { low: 0.25, medium: 0.5, high: 1, veryHigh: 2 };
/** On ground only: the ground's shadows, over the background */
const GROUND_SHADOW = 0.3;
/** the most dashes and gaps of a dash style Dashed Hidden Line takes */
const MAX_DASHES = 8;
/** a wider spot's shadow takes in the middle of its cone, this many radians from its axis */
const SPOT_SHADOW_HALF_ANGLE = (75 * Math.PI) / 180;
/** image size assumed for a texture that does not give one (mm) */
const DEFAULT_IMAGE_MM = 1000;
/** where a texture's mask is grey enough to cut the face away (0 black, 1 white) */
const CUTOUT_ALPHA = 0.5;
/** pointer travel (CSS px) that still counts as a click rather than a drag: a mouse's, and a finger's, which wobbles more */
const CLICK_SLOP = 4;
/** the navigations whose left drag the view steers itself */
const STEERED: ReadonlySet<Navigation> = new Set(["move", "walk", "look", "elevator"]);
/** a steered drag goes the model's radius in this many CSS px */
const STEER_PX = 300;
/** and turns this many radians a px */
const TURN_PER_PX = 0.005;
/** looking round tilts no nearer straight up or down than this, radians */
const MAX_PITCH = THREE.MathUtils.degToRad(85);
const TAP_SLOP = 10;
/** two taps this close in time (ms) and space (CSS px) are a double tap, which orbits about the point as a double-click does */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;
const EMPTY = new Float32Array(0);

/** camera direction from the model centre for each preset (z up). Top is a hair off vertical so the look-at stays defined; screen up is then +y. */
/** the working plane's grid, x axis and y axis */
const PLANE_GRID_COLOR = 0x7f8a99;
/** the edges and faces a tool has chosen */
const HIGHLIGHT_LINE_COLOR = 0xff6a00;
/** how strongly the selection's colour tints its faces, and shows its edges where faces hide them */
const SELECTION_TINT = 0.18;
const SELECTION_THROUGH = 0.35;
/** past this many triangles (or edge segments) the selection's faces go untinted (its edges unmarked), so selecting all of a huge model stays quick */
const SELECTION_CAP = 1_000_000;
const PLANE_X_COLOR = 0xe5484d;
const PLANE_Y_COLOR = 0x30a46c;

const VIEW_DIRS: Record<ViewPreset, [number, number, number]> = {
  top: [0, -0.001, 1],
  // from below, x to the right and the front at the top
  bottom: [0, -0.001, -1],
  front: [0, -1, 0],
  back: [0, 1, 0],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  // the isometrics: from above (or below) a corner, seeing the sides named
  iso: [1, -1, 1],
  leftIso: [-1, -1, 1],
  rightRearIso: [1, 1, 1],
  leftRearIso: [-1, 1, 1],
  lowerRightIso: [1, -1, -1],
  lowerLeftIso: [-1, -1, -1],
  lowerRightRearIso: [1, 1, -1],
  lowerLeftRearIso: [-1, 1, -1],
};

/** A run of consecutive triangles (or edge segments) of one object inside a merged array. */
interface Run {
  readonly start: number;
  readonly end: number;
  readonly obj: number;
  /** the object inside a top-level group they belong to (Mesh3D.partId), as an index into partIds; -1 for none */
  readonly part: number;
}

/** One merged shaded mesh: every triangle of one colour, opacity and texture. */
interface FaceGroup {
  readonly mesh: THREE.Mesh;
  readonly index: THREE.BufferAttribute;
  readonly runs: Run[];
  readonly texture: number;
  readonly recessed: boolean;
  /** its texture is cut out by a mask (plants, image props): drawn textured in Shaded too, as a card it would be wrong */
  readonly cutout: boolean;
  readonly shaded: THREE.MeshLambertMaterial;
  /** only when the texture has an image; its map is set once the image decodes */
  readonly textured: THREE.MeshLambertMaterial | null;
  /** white, for Shaded without colours; made when first needed */
  plain: THREE.MeshLambertMaterial | null;
}

/** One merged edge set: every edge segment of one colour. */
interface EdgeGroup {
  readonly lines: THREE.LineSegments;
  readonly index: THREE.BufferAttribute;
  readonly runs: Run[];
  /** the same segments drawn dashed where faces hide them (Dashed Hidden Line), made when first needed */
  dashed: THREE.LineSegments | null;
  /** the same segments as Sketch's pencil strokes, one per pass, made when first needed */
  sketch: THREE.LineSegments[] | null;
}

interface FaceBuild {
  readonly color: string;
  readonly opacity: number;
  readonly recessed: boolean;
  readonly texture: number;
  readonly imageSize: number;
  tris: number;
  fill: number;
  positions: Float32Array;
  uvs: Float32Array | null;
  readonly runs: Run[];
}

interface EdgeBuild {
  segs: number;
  fill: number;
  positions: Float32Array;
  readonly runs: Run[];
}

export class View3D {
  /** Called on a click: the object under the pointer (null for empty space) and whether Shift was held. */
  onPick: ((objectId: string | null, additive: boolean) => void) | null = null;
  /** While set, a click on the model calls this with the face under it (null over empty space) instead of picking. */
  onFacePick: ((hit: FaceHit | null, shift: boolean, e: MouseEvent) => void) | null = null;
  /** the working plane's grid and axes, when one is shown */
  private planeGrid: THREE.Group | null = null;

  private readonly host: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly empty: HTMLElement;
  private readonly scene = new THREE.Scene();
  private readonly persp = new THREE.PerspectiveCamera(DEFAULT_VIZ.lens, 1, 1, 1000);
  private readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
  /** the camera in use, as the projection chooses */
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.persp;
  /** half the orthogonal camera's height at zoom 1, world mm */
  private orthoHalf = 1000;
  private aspect = 1;
  private readonly sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
  private readonly sky = new THREE.HemisphereLight(0xffffff, 0x9ea4ae, SKY_INTENSITY);
  /** the drawing's light objects, as the Visualization palette lets them light the model */
  private readonly lamps = new THREE.Group();
  /** the spots' beams in haze (Viz3D.haze) */
  private readonly beams = new THREE.Group();
  private beamKey = "";
  private beamLights: readonly Light3D[] = [];
  private lights: readonly Light3D[] = [];
  /** the light objects lighting the model now, by id, so moving the view rebuilds them only when that changes */
  private lampIds = "";
  private lampTimer = 0;
  /** white faces for the hidden-line modes, a recessed face's set further back */
  private readonly hiddenFaces = [hiddenMaterial(false), hiddenMaterial(true)];
  /** the same in the paper's colour, for Sketch */
  private readonly paperFaces = [hiddenMaterial(false, PAPER), hiddenMaterial(true, PAPER)];
  /** Sketch's strokes: the edges with their ends wobbled, differently in each pass */
  private readonly sketchMaterials = SKETCH_WOBBLE.map((px, pass) => sketchMaterial(px, pass));
  private readonly dashedMaterial = new THREE.LineDashedMaterial({
    color: EDGE_COLOR,
    dashSize: 50,
    gapSize: 40,
    // only where something nearer hides the edge
    depthFunc: THREE.GreaterDepth,
    depthWrite: false,
    transparent: true,
  });
  /** the dashes and gaps the dashed edges' shader steps through (mm, alternating), and how many */
  private readonly dashUniforms = { dashes: { value: new Array<number>(MAX_DASHES).fill(0) }, dashCount: { value: 0 } };
  /** On ground only: a plane under the visible model that shows only the shadows falling on it */
  /** Dashed Hidden Line's dash style's dashes and gaps (mm), or null for dashes a share of the model's size */
  private dashes: readonly number[] | null = null;
  private readonly ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: GROUND_SHADOW }));
  private readonly clipPlanes = Array.from({ length: 6 }, () => new THREE.Plane());
  private readonly clipBox = new THREE.Box3();
  private readonly clipHelper = new THREE.Box3Helper(this.clipBox, CLIP_COLOR);
  private viz: Viz3D = DEFAULT_VIZ;
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly edgeMaterial = new THREE.LineBasicMaterial({ color: EDGE_COLOR });
  private readonly resizeObserver: ResizeObserver;
  private readonly layerBoxes = new Map<string, THREE.Box3>();
  private readonly modelBox = new THREE.Box3();
  /** features' geometry shown with the model (Site Context), each with its design layer and box */
  private readonly content = new Map<THREE.Object3D, { layer: string; box: THREE.Box3 }>();
  private readonly textures = new Map<number, THREE.Texture>();
  /** the textures' transparency masks, by the same index */
  private readonly masks = new Map<number, THREE.Texture>();
  private readonly loading = new Set<number>();
  private readonly faceByMesh = new Map<THREE.Object3D, FaceGroup>();
  private resourceByIndex = new Map<number, ResourceInfo>();
  private faces: FaceGroup[] = [];
  private edges: EdgeGroup[] = [];
  private objectIds: string[] = [];
  /** the objects inside top-level groups the model draws (Mesh3D.partId), numbered as Run.part numbers them */
  private partIds: string[] = [];
  private highlightLines: THREE.LineSegments[] = [];
  private objectLayer: string[] = [];
  private objectVisible = new Uint8Array(0);
  /** the objects selected, with the objects inside them (setSelected) */
  private selected: ReadonlySet<string> = new Set();
  /** the highlight is to be gathered again before it is drawn: the selection, the model or the layers shown have changed */
  private selectionStale = false;
  /** whether the highlight has faces to tint, and edges to draw */
  private selectionHasFaces = false;
  private selectionHasEdges = false;
  /** the selection's highlight, drawn after the model in every mode: its faces tinted, its edges faint where faces hide them, its edges */
  private readonly selectionScene = new THREE.Scene();
  private readonly selectionFaces = new THREE.MeshBasicMaterial({ transparent: true, opacity: SELECTION_TINT, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
  private readonly selectionThrough = new THREE.LineBasicMaterial({ transparent: true, opacity: SELECTION_THROUGH, depthTest: false, depthWrite: false, toneMapped: false });
  private readonly selectionLines = new THREE.LineBasicMaterial({ transparent: true, toneMapped: false });
  private readonly selectionTint = new THREE.Mesh(new THREE.BufferGeometry(), this.selectionFaces);
  private readonly selectionEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.selectionLines);
  /** the same segments as selectionEdges, drawn through the faces */
  private readonly selectionHidden = new THREE.LineSegments(this.selectionEdges.geometry, this.selectionThrough);
  /** the visible layers; null until setVisibleLayers is called, meaning all of them */
  private visibleLayers: ReadonlySet<string> | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private mode: RenderMode = "shaded";
  private shown = false;
  private disposed = false;
  private framed = false;
  /** bumped on every rebuild and on dispose, so late texture decodes are dropped */
  private serial = 0;
  private frameId = 0;
  /** the press under way: where its first pointer went down, and whether another came down since (then it is no click) */
  private press: { id: number; x: number; y: number; touch: boolean; more: boolean } | null = null;
  /** the pointers down now */
  private readonly down = new Set<number>();
  /** what a left drag does (setNavigation) */
  private nav: Navigation = "orbit";
  /** a left drag the view steers itself (walk, look, ride, move along the sightline): its pointer and where it was last */
  private steer: { id: number; x: number; y: number } | null = null;
  /** the last tap of a finger, for a double tap */
  private lastTap: { x: number; y: number; at: number } | null = null;
  /** the pointer that came down last is a finger (a double click from one is a double tap, counted here) */
  private fingerDown = false;
  /** what the docked palettes cover of the canvas's sides, in CSS px; the view centres in the rest */
  private insets = { left: 0, right: 0 };
  private hook: RenderHook | null = null;
  private modelSerial = 0;
  private textureSerial = 0;
  /** bumped by render mode, light and Visualization changes (lookVersion) */
  private lookSerial = 0;
  /** a pane's realistic picture drew as Shaded while its renderer got ready: the next frame asks for it again */
  private pictureWaits = false;
  /** the texture decodes under way, by index */
  private readonly decoding = new Map<number, Promise<void>>();

  constructor(host: HTMLElement) {
    this.host = host;
    this.persp.up.set(0, 0, 1);
    this.ortho.up.set(0, 0, 1);
    this.sun.shadow.mapSize.set(SUN_SHADOW_MAP, SUN_SHADOW_MAP);
    this.sun.shadow.bias = -0.0003;
    this.clipHelper.visible = false;
    this.ground.receiveShadow = true;
    this.ground.visible = false;
    this.scene.add(this.sky, this.sun, this.sun.target, this.lamps, this.beams, this.clipHelper, this.ground);
    // the selection's highlight: tint, then the faint edges, then the edges; never culled, as its geometry is swapped
    this.selectionTint.renderOrder = 0;
    this.selectionHidden.renderOrder = 1;
    this.selectionEdges.renderOrder = 2;
    for (const o of [this.selectionTint, this.selectionHidden, this.selectionEdges]) o.frustumCulled = false;
    this.selectionScene.add(this.selectionTint, this.selectionHidden, this.selectionEdges);
    this.dashedMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.dashes = this.dashUniforms.dashes;
      shader.uniforms.dashCount = this.dashUniforms.dashCount;
      shader.fragmentShader = dashedShader(shader.fragmentShader);
    };
    this.applyDashes();
    this.applyLineRender();

    this.canvas = h("canvas", {
      cls: "view3d-canvas",
      title: "Drag to orbit · right-drag pans · wheel zooms · double-click a point to orbit about it · W A S D or arrows walk, Q E down and up (Shift: faster)",
      // focusable, so the walk keys reach it
      attrs: { tabindex: "0" },
    });
    this.controls = new OrbitControls(this.camera, this.canvas);
    // the wheel zooms towards the point under the cursor, as in the plan
    this.controls.zoomToCursor = true;
    // one finger orbits; two pinch to zoom and drag to pan (the defaults, written out so the touch layout is plain)
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => {
      this.requestRender();
      this.queueLamps();
    });
    this.canvas.addEventListener("pointerdown", (e) => {
      if (this.down.size === 0) {
        this.press = e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY, touch: e.pointerType === "touch", more: false } : null;
      } else if (this.press) {
        // a second finger (or pointer) makes the press a gesture, not a click
        this.press.more = true;
      }
      this.down.add(e.pointerId);
      this.steer = e.button === 0 && this.down.size === 1 && STEERED.has(this.nav) ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
      this.fingerDown = e.pointerType === "touch";
      // every finger reports its lift here, even one that slides off the canvas before it lifts
      this.canvas.setPointerCapture(e.pointerId);
      this.canvas.focus({ preventScroll: true });
    });
    // Flyover: a double-click makes the point under it the centre the view orbits about (a finger's double tap does too, see release)
    this.canvas.addEventListener("dblclick", (e) => {
      if (!this.fingerDown) this.orbitAbout(e);
    });
    this.canvas.addEventListener("keydown", (e) => {
      if (this.walk(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const steer = this.steer;
      if (!steer || steer.id !== e.pointerId) return;
      this.steerBy(e.clientX - steer.x, e.clientY - steer.y);
      steer.x = e.clientX;
      steer.y = e.clientY;
    });
    this.canvas.addEventListener("pointerup", (e) => this.release(e, false));
    this.canvas.addEventListener("pointercancel", (e) => this.release(e, true));

    this.empty = h("div", {
      cls: "view3d-empty",
      text: "No 3D objects on visible layers",
      attrs: { role: "status" },
    });
    this.stage = h("div", { cls: "view3d-stage" }, this.canvas, this.empty);
    host.append(this.stage);
    // hidden until show(), so the 2D canvas under the host stays in view
    host.hidden = true;

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.updateClipping();
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Shows the view, creating the WebGL context on first use. Throws when WebGL is unavailable. */
  show(): void {
    if (this.disposed) return;
    this.ensureRenderer();
    this.shown = true;
    this.host.hidden = false;
    this.resize();
    this.requestRender();
  }

  /** Creates the WebGL context without showing the view, so pictures can be drawn (a floating view pane). Throws when WebGL is unavailable. */
  prepare(): void {
    if (!this.disposed) this.ensureRenderer();
  }

  hide(): void {
    this.shown = false;
    this.host.hidden = true;
    if (this.frameId !== 0) {
      cancelAnimationFrame(this.frameId);
      this.frameId = 0;
    }
  }

  /** Replaces the whole model and frees the GPU memory of the old one. The camera keeps its place after the first model. */
  setModel(meshes: Mesh3D[], resources: ResourceInfo[]): void {
    if (this.disposed) return;
    this.clearModel();
    // the light objects' shadows are fitted to the model: they come again with its lights
    this.lampIds = "";
    this.resourceByIndex = new Map(resources.map((r): [number, ResourceInfo] => [r.index, r]));
    this.build(meshes);
    this.applyDashes();
    this.applyClip();
    this.updateClipping();
    if (!this.framed && meshes.length > 0) this.setView("iso");
    this.applyVisibility();
    this.loadTextures();
    this.applyMode();
    this.selectionStale = true;
  }

  /** Hides the objects on layers that are not in `ids`. */
  setVisibleLayers(ids: ReadonlySet<string>): void {
    this.visibleLayers = new Set(ids);
    // what is visible is what the light objects' shadows are fitted to
    this.lampIds = "";
    this.applyVisibility();
    this.applyLights();
  }

  /** The drawing's light objects (Light3D), which light the model while the Visualization palette says so. */
  setLights(lights: readonly Light3D[]): void {
    // an edited drawing's lights come anew, changed or moved: light the model with them again
    if (lights !== this.lights) this.lampIds = "";
    this.lights = lights;
    this.lookSerial++;
    this.applyLights();
  }

  /** How the model is drawn (View > Rendering, the View bar's Render pop-up). */
  get renderMode(): RenderMode {
    return this.mode;
  }

  setMode(mode: RenderMode): void {
    this.mode = mode;
    this.lookSerial++;
    this.loadTextures(isRealistic(mode));
    this.applyMode();
    this.requestRender();
  }

  /** Gives the Realistic and Path Traced modes their renderer (null: they draw as Shaded). */
  setRenderHook(hook: RenderHook | null): void {
    this.hook = hook;
    this.requestRender();
  }

  /** Bumped when the model's geometry or what of it is visible changes. */
  get modelVersion(): number {
    return this.modelSerial;
  }

  /** Bumped when a texture's image decodes. */
  get textureVersion(): number {
    return this.textureSerial;
  }

  /** Bumped when anything a picture of the model shows changes: the model, what is visible, textures, render mode, lights, the Visualization settings. */
  get lookVersion(): number {
    return this.modelSerial + this.textureSerial + this.lookSerial;
  }

  /** The model's face groups, with what each draws of the visible objects. */
  modelFaces(): ModelFace[] {
    return this.faces.map((g) => ({
      geometry: g.mesh.geometry,
      // a texture without an image (a procedural shader) shows its preview's average colour
      color: `#${(g.textured?.userData.ready && !this.textures.has(g.texture) ? g.textured.color : g.shaded.color).getHexString()}`,
      opacity: g.shaded.opacity,
      texture: g.texture,
      resource: this.resourceByIndex.get(g.texture) ?? null,
      map: this.textures.get(g.texture) ?? null,
      alphaMap: this.masks.get(g.texture) ?? null,
      recessed: g.recessed,
    }));
  }

  /** The features' geometry shown with the model (Site Context) on visible layers. */
  visibleContent(): THREE.Object3D[] {
    return [...this.content].filter(([, c]) => this.isLayerVisible(c.layer)).map(([obj]) => obj);
  }

  /** The drawing's light objects that are on, on visible layers, whatever the Visualization palette says. */
  visibleLights(): Light3D[] {
    return this.lights.filter((l) => l.on && l.brightness > 0 && this.isLayerVisible(l.layerId));
  }

  /** Decodes every texture's image and mask, whatever the mode; resolves once they are done (or failed). */
  async ensureTextures(): Promise<void> {
    this.loadTextures(true);
    await Promise.all(this.decoding.values());
  }

  setView(preset: ViewPreset): void {
    this.frameView(new THREE.Vector3(...VIEW_DIRS[preset]));
  }

  /**
   * Looks as a saved view does, along `toward` (from the view to the viewer): a perspective from its
   * eye `at`, an orthogonal view centred on `at` when that lies near the model (else fitted). The
   * projection is set apart (setViz).
   */
  lookAs(view: SavedView): void {
    const toward = new THREE.Vector3(...view.toward);
    if (!(toward.lengthSq() > 0)) return;
    toward.normalize();
    const at = new THREE.Vector3(...view.at);
    this.frameView(toward.clone());
    const box = this.visibleBox();
    if (view.perspective) {
      // look ahead as far as the model's centre lies, so orbiting turns about it
      const ahead = Math.max(box.getCenter(new THREE.Vector3()).sub(at).dot(toward) * -1, 1000);
      this.camera.position.copy(at);
      this.controls.target.copy(at).addScaledVector(toward, -ahead);
    } else if (box.clone().expandByScalar(box.getSize(new THREE.Vector3()).length() / 2).containsPoint(at)) {
      const shift = at.clone().sub(this.controls.target);
      this.camera.position.add(shift);
      this.controls.target.add(shift);
    }
    this.controls.update();
    this.requestRender();
  }

  /**
   * Looks through a camera (the Visualization palette's Cameras): in perspective from `eye` toward
   * `target`, seeing `angle`° across a picture `aspect` times as wide as it is high. Orbiting then
   * turns about the target; a standard view or fit goes back to the usual lens.
   */
  lookThrough(eye: Vec3, target: Vec3, angle: number, aspect: number): void {
    if (this.camera !== this.persp) return;
    this.framed = true;
    this.updateClipping();
    const half = THREE.MathUtils.degToRad(Math.min(Math.max(angle, 1), 170) / 2);
    this.persp.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) / Math.max(aspect, 0.1)));
    this.persp.updateProjectionMatrix();
    this.persp.position.set(...eye);
    this.controls.target.set(...target);
    this.controls.update();
    this.requestRender();
  }

  /** The view as a layer saves it: the screen's axes in the model, and the eye (perspective) or the centre (orthogonal). */
  currentView(): SavedView & { right: Vec3; up: Vec3 } {
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3();
    const up = new THREE.Vector3();
    const toward = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(right, up, toward);
    // exactly at right angles, whatever the float error
    toward.normalize();
    right.addScaledVector(toward, -right.dot(toward)).normalize();
    up.crossVectors(toward, right);
    const at = this.camera === this.persp ? this.camera.position : this.controls.target;
    const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
    return { right: v3(right), up: v3(up), toward: v3(toward), at: v3(at), perspective: this.camera === this.persp };
  }

  /** The camera as it stands now (a view pane keeps it while another pane has the view). */
  cameraState(): CameraState {
    const v3 = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];
    return { position: v3(this.camera.position), target: v3(this.controls.target), zoom: this.ortho.zoom, half: this.orthoHalf, fov: this.persp.fov };
  }

  /** Puts the camera where `state` says, in the projection the view has now. */
  setCameraState(state: CameraState): void {
    this.placeCamera(state);
    this.controls.update();
    this.requestRender();
  }

  /** Where the camera would stand for a standard view framing the visible model in a picture `width` × `height`; the view stays as it is. */
  presetState(preset: ViewPreset, width: number, height: number): CameraState {
    return this.framedState(VIEW_DIRS[preset], width, height);
  }

  /** Where the camera would stand looking along `toward` (from the model to the eye), framing the visible model in a picture `width` × `height`; the view stays as it is. */
  framedState(toward: Vec3, width: number, height: number): CameraState {
    const was = this.cameraState();
    const aspect = this.aspect;
    this.aspect = width > 0 && height > 0 ? width / height : aspect;
    this.frameView(new THREE.Vector3(...toward));
    const framed = this.cameraState();
    // the ortho size that frames it too, as frameView gives it, whichever projection the view has
    const distance = Math.hypot(...framed.position.map((v, i) => v - framed.target[i]));
    const state = { ...framed, half: distance * Math.tan(THREE.MathUtils.degToRad(this.viz.lens / 2)), zoom: 1 };
    this.aspect = aspect;
    this.placeCamera(was);
    this.controls.update();
    return state;
  }

  /**
   * Draws the model as seen from `state` onto `canvas` (a 2D canvas, at its own size, or `size` px
   * exactly when given: a movie's frame), in `look`'s render mode and projection (Realistic as Shaded
   * while the render feature gets ready); the view itself is drawn again as it was. Path Traced
   * refines a sample a call with the render feature's own renderer, the view left alone: true while
   * it wants calling again. `clear` draws it on that colour in place of the view's own background
   * (Render Bitmap's alpha, from a picture on black and one on white).
   */
  picture(
    state: CameraState,
    canvas: HTMLCanvasElement,
    look: PaneLook = { mode: this.mode, projection: this.viz.projection },
    size?: { readonly width: number; readonly height: number },
    clear?: number,
  ): boolean {
    const renderer = this.renderer;
    const w = size?.width ?? canvas.clientWidth;
    const h = size?.height ?? canvas.clientHeight;
    // drawn while the view is hidden too, for a floating view pane
    if (!renderer || w === 0 || h === 0) return false;
    if (look.mode === "pathtraced" && this.hook?.tracePane) {
      const traced = this.tracePane(state, canvas, look, w, h);
      if (traced !== "unable") return traced === "refining";
    }
    const was = this.cameraState();
    const live = this.camera;
    const mode = this.mode;
    // the picture's own projection and render mode, for this picture only
    this.camera = look.projection === "orthogonal" ? this.ortho : this.persp;
    if (look.mode !== mode) {
      this.mode = look.mode;
      // its textures load once, a picture drawn again as each arrives
      if (look.mode === "textured" || look.mode === "shaded") this.loadTextures();
      this.applyMode();
    }
    const ratio = renderer.getPixelRatio();
    // a picture of a given size is drawn at that size, not the screen's pixel ratio times it
    const scale = size ? 1 : ratio;
    if (size) renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    this.setAspect(w / h);
    this.placeCamera(state);
    this.camera.updateMatrixWorld();
    renderer.setClearColor(clear ?? this.background());
    this.placeSun();
    // Realistic and Path Traced from the render feature, the view's own Shaded picture until it is ready
    const realistic = isRealistic(this.mode) && this.hook !== null;
    if (!(realistic && this.hook?.picture?.(renderer, this.camera))) {
      if (realistic) this.pictureWaits = true;
      renderer.render(this.scene, this.camera);
    }
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")?.drawImage(renderer.domElement, 0, 0, canvas.width, canvas.height);
    if (clear !== undefined) renderer.setClearColor(this.background());
    if (this.mode !== mode) {
      this.mode = mode;
      this.applyMode();
    }
    if (size) renderer.setPixelRatio(ratio);
    this.camera = live;
    this.placeCamera(was);
    this.resize();
    this.draw();
    return false;
  }

  /**
   * Square pictures `size` px a side, 90° across, from `eye` along each of `faces` (its direction and
   * the picture's up, world z up), in Shaded as the Shaded Options have it: a cube of them round the
   * eye for Export Panorama. Lit as the view is lit now; the view is drawn again as it was.
   */
  cubePictures(eye: Vec3, faces: readonly { readonly dir: Vec3; readonly up: Vec3 }[], size: number): HTMLCanvasElement[] {
    const renderer = this.renderer;
    if (!renderer) return [];
    const mode = this.mode;
    if (mode !== "shaded") {
      this.mode = "shaded";
      this.applyMode();
    }
    const cam = new THREE.PerspectiveCamera(90, 1, this.persp.near, this.persp.far);
    cam.position.set(...eye);
    const ratio = renderer.getPixelRatio();
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(BACKGROUND);
    this.placeSun();
    const out = faces.map((f) => {
      cam.up.set(...f.up);
      cam.lookAt(eye[0] + f.dir[0], eye[1] + f.dir[1], eye[2] + f.dir[2]);
      cam.updateMatrixWorld();
      renderer.render(this.scene, cam);
      const canvas = h("canvas", { attrs: { width: String(size), height: String(size) } });
      canvas.getContext("2d")?.drawImage(renderer.domElement, 0, 0, size, size);
      return canvas;
    });
    if (this.mode !== mode) {
      this.mode = mode;
      this.applyMode();
    }
    renderer.setPixelRatio(ratio);
    this.resize();
    this.draw();
    return out;
  }

  /** A Path Traced pane's picture through `state`'s camera, by the render feature; the view's canvas, camera and mode stay as they are. */
  private tracePane(state: CameraState, canvas: HTMLCanvasElement, look: PaneLook, w: number, h: number): "refining" | "done" | "unable" {
    const hook = this.hook;
    if (!hook?.tracePane) return "unable";
    const was = this.cameraState();
    const live = this.camera;
    this.camera = look.projection === "orthogonal" ? this.ortho : this.persp;
    this.setAspect(w / h);
    this.placeCamera(state);
    this.camera.updateMatrixWorld();
    try {
      return hook.tracePane(canvas, this.camera, Math.round(w * (this.renderer?.getPixelRatio() ?? 1)), Math.round(h * (this.renderer?.getPixelRatio() ?? 1)));
    } finally {
      this.camera = live;
      this.placeCamera(was);
      this.fitCameras(this.host.clientWidth, this.host.clientHeight);
    }
  }

  /** No pane shows Path Traced now: the render feature lets go of what it traced them with. */
  releasePanes(): void {
    this.hook?.releasePanes?.();
  }

  /** Sets the eye, looking at the orbit point, the lens and ortho size (not the controls, nor a frame). */
  private placeCamera(state: CameraState): void {
    this.camera.position.set(...state.position);
    this.controls.target.set(...state.target);
    this.camera.lookAt(this.controls.target);
    this.ortho.zoom = state.zoom;
    this.orthoHalf = state.half;
    this.persp.fov = state.fov;
    this.setOrthoFrustum();
    this.ortho.updateProjectionMatrix();
    this.persp.updateProjectionMatrix();
    this.updateClipping();
  }

  /** Gives both cameras the picture's shape. */
  private setAspect(aspect: number): void {
    this.aspect = aspect;
    this.persp.aspect = aspect;
    this.setOrthoFrustum();
    for (const cam of [this.persp, this.ortho]) {
      cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
  }

  /** Takes the Visualization palette's settings: projection, sun, shadows, ambient light and clip cube. */
  setViz(v: Viz3D): void {
    const projection = v.projection !== this.viz.projection;
    const lens = v.lens !== this.viz.lens;
    const level = v.twoPoint !== this.viz.twoPoint;
    const oblique = v.oblique !== this.viz.oblique;
    const quality = v.shaded.shadowQuality !== this.viz.shaded.shadowQuality;
    const lamps = v.lights !== this.viz.lights || v.shadows !== this.viz.shadows || quality || (v.sun === "off") !== (this.viz.sun === "off") || v.haze !== this.viz.haze;
    const look = v.shaded !== this.viz.shaded || v.shadows !== this.viz.shadows;
    const lineRender = v.lineRender !== this.viz.lineRender;
    this.viz = v;
    if (quality) {
      const size = this.shadowMap(SUN_SHADOW_MAP);
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
      // the light objects' shadows are made again at their new size
      this.lampIds = "";
    }
    this.lookSerial++;
    if (lens) this.setLens(v.lens);
    if (projection) this.setProjection(v.projection);
    if (projection || level) this.keepLevel();
    if (oblique) {
      // the plain orthogonal frustum again, sheared afresh as it is drawn
      this.ortho.updateProjectionMatrix();
      this.requestRender();
    }
    if (lamps) this.applyLights();
    this.sky.intensity = SKY_INTENSITY * v.ambient;
    this.sun.castShadow = v.shadows;
    if (v.shadows) for (const f of this.faces) this.giveNormals(f.mesh.geometry);
    if (look) {
      this.loadTextures();
      this.applyMode();
    }
    if (lineRender) this.applyLineRender();
    this.applyClip();
    this.requestRender();
  }

  /**
   * Dashed Hidden Line's dashes and gaps in mm, alternating (a dash style's, at the scale it is drawn
   * at), or null for the view's own. The first MAX_DASHES are used; an odd number runs twice.
   */
  setDashes(dashes: readonly number[] | null): void {
    this.dashes = dashes;
    this.applyDashes();
    this.lookSerial++;
    this.requestRender();
  }

  /** Gives the dashed edges' shader the dash style's dashes, or dashes a fixed share of the model's size. */
  private applyDashes(): void {
    const radius = this.modelRadius();
    const own = [radius / 120, radius / 200];
    let d = this.dashes && this.dashes.length > 0 && this.dashes.every((v) => v >= 0) ? [...this.dashes] : own;
    if (d.length % 2 === 1) d = [...d, ...d];
    d = d.slice(0, MAX_DASHES);
    if (!(d.reduce((a, b) => a + b, 0) > 0)) d = own;
    // a dot (a dash of no length) still shows, as a short dash
    const dot = Math.max(...d) * 0.05;
    d = d.map((v, i) => (i % 2 === 0 ? Math.max(v, dot) : v));
    const u = this.dashUniforms;
    d.forEach((v, i) => (u.dashes.value[i] = v));
    u.dashCount.value = d.length;
    // the shader's period is dashSize + gapSize
    this.dashedMaterial.dashSize = d[0];
    this.dashedMaterial.gapSize = d.reduce((a, b) => a + b, 0) - d[0];
  }

  /** Dashed Hidden Line's hidden edges in Line Render Options' shade: from the edges' own grey towards white. */
  private applyLineRender(): void {
    const shade = Math.max(0, Math.min(1, this.viz.lineRender.dashShade));
    // mixed as the screen mixes them, in sRGB
    const e = new THREE.Color(EDGE_COLOR).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
    const mix = (c: number) => c + (1 - c) * shade;
    this.dashedMaterial.color.setRGB(mix(e.r), mix(e.g), mix(e.b), THREE.SRGBColorSpace);
    this.lookSerial++;
  }

  /** A shadow map's size at Shaded Options' shadow quality, `base` px at High, as far as the graphics card allows. */
  private shadowMap(base: number): number {
    return Math.min(base * SHADOW_SCALE[this.viz.shaded.shadowQuality], this.renderer?.capabilities.maxTextureSize ?? base * 2);
  }

  /** A face group's white material, for Shaded without colours, cut by the clip cube as the others are. */
  private plainOf(g: FaceGroup): THREE.MeshLambertMaterial {
    if (!g.plain) {
      g.plain = faceMaterial("#ffffff", g.shaded.opacity, g.recessed);
      g.plain.clippingPlanes = g.shaded.clippingPlanes;
    }
    return g.plain;
  }

  /** Keeps the view's centre, and fitting, in the part of the canvas the docked palettes leave clear. */
  setInsets(insets: { left: number; right: number }): void {
    this.insets = { left: insets.left, right: insets.right };
    this.resize();
  }

  /** Frames the visible geometry from the current direction. */
  fit(): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.frameView(dir.lengthSq() > 0 ? dir : new THREE.Vector3(...VIEW_DIRS.iso));
  }

  dispose(): void {
    if (this.disposed) return;
    this.hide();
    this.disposed = true;
    clearTimeout(this.lampTimer);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clearModel();
    this.edgeMaterial.dispose();
    this.dashedMaterial.dispose();
    for (const m of [...this.hiddenFaces, ...this.paperFaces, ...this.sketchMaterials]) m.dispose();
    this.selectionTint.geometry.dispose();
    this.selectionEdges.geometry.dispose();
    for (const m of [this.selectionFaces, this.selectionThrough, this.selectionLines]) m.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer = null;
    }
    this.stage.remove();
  }

  private ensureRenderer(): void {
    if (this.renderer) return;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(BACKGROUND);
    renderer.localClippingEnabled = true;
    renderer.shadowMap.enabled = true;
    this.renderer = renderer;
  }

  private resize(): void {
    const w = this.host.clientWidth;
    const height = this.host.clientHeight;
    if (!this.renderer || w === 0 || height === 0) return;
    this.renderer.setSize(w, height, false);
    this.fitCameras(w, height);
    this.requestRender();
  }

  /** Gives both cameras the view's shape, `w` × `height` px (the drawing buffer is left as it is). */
  private fitCameras(w: number, height: number): void {
    if (w === 0 || height === 0) return;
    this.aspect = w / height;
    // a CSS pixel in clip space, for Sketch's wobble
    for (const m of this.sketchMaterials) (m.userData.px as THREE.Vector2).set(2 / w, 2 / height);
    this.persp.aspect = this.aspect;
    this.setOrthoFrustum();
    // shift the picture so the camera's axis meets the middle of the clear part of the canvas
    const shift = this.clearInsets(w);
    for (const cam of [this.persp, this.ortho]) {
      if (shift.left !== shift.right) cam.setViewOffset(w, height, (shift.right - shift.left) / 2, 0, w, height);
      else cam.clearViewOffset();
      cam.updateProjectionMatrix();
    }
  }

  private setOrthoFrustum(): void {
    this.ortho.left = -this.orthoHalf * this.aspect;
    this.ortho.right = this.orthoHalf * this.aspect;
    this.ortho.top = this.orthoHalf;
    this.ortho.bottom = -this.orthoHalf;
  }

  /**
   * Gives the perspective camera a view angle of `deg`, standing it nearer or further back so the
   * model at the orbit point keeps its size: a narrower lens flattens the view, a wider one deepens it.
   */
  private setLens(deg: number): void {
    const was = this.persp.fov;
    this.persp.fov = deg;
    this.persp.updateProjectionMatrix();
    if (this.camera !== this.persp) return;
    const target = this.controls.target;
    const dir = this.persp.position.clone().sub(target);
    const ratio = Math.tan(THREE.MathUtils.degToRad(was / 2)) / Math.tan(THREE.MathUtils.degToRad(deg / 2));
    this.persp.position.copy(target).addScaledVector(dir, ratio);
    this.updateClipping();
    this.controls.update();
    this.requestRender();
  }

  /**
   * Two-Point Perspective: orbiting turns the view about the upright only, the camera level with the
   * orbit point, so upright lines stay upright; otherwise it tilts freely.
   */
  private keepLevel(): void {
    const level = this.viz.twoPoint && this.camera === this.persp;
    this.controls.minPolarAngle = level ? Math.PI / 2 : 0;
    this.controls.maxPolarAngle = level ? Math.PI / 2 : Math.PI;
    this.controls.update();
    this.updateClipping();
    this.requestRender();
  }

  /** The orthogonal camera's frustum with the oblique projection's shear, about the orbit point's depth; off, as it is. */
  private shearOblique(): void {
    const o = this.viz.oblique;
    if (!o || this.camera !== this.ortho) return;
    this.ortho.updateProjectionMatrix();
    const d = this.ortho.position.distanceTo(this.controls.target);
    const a = THREE.MathUtils.degToRad(o.angle);
    const kx = o.depth * Math.cos(a);
    const ky = o.depth * Math.sin(a);
    // in the camera's frame (z toward the viewer), what lies beyond the orbit point slides up and right
    const shear = new THREE.Matrix4().set(1, 0, -kx, -kx * d, 0, 1, -ky, -ky * d, 0, 0, 1, 0, 0, 0, 0, 1);
    this.ortho.projectionMatrix.multiply(shear);
    this.ortho.projectionMatrixInverse.copy(this.ortho.projectionMatrix).invert();
  }

  /**
   * View > Rotate 3D View…: turns the view about the orbit point, as if the model turned `aboutX`
   * degrees about the screen's horizontal, `aboutY` about its upright, then `aboutZ` about the
   * drawing's z axis (counter-clockwise, looking down each axis toward the orbit point).
   */
  rotateView(aboutX: number, aboutY: number, aboutZ: number): void {
    const target = this.controls.target;
    const offset = this.camera.position.clone().sub(target);
    this.camera.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).normalize();
    // the model turning one way is the camera turning the other
    offset.applyAxisAngle(right, -THREE.MathUtils.degToRad(aboutX));
    offset.applyAxisAngle(up, -THREE.MathUtils.degToRad(aboutY));
    offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), -THREE.MathUtils.degToRad(aboutZ));
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.controls.update();
    this.updateClipping();
    this.requestRender();
  }

  /** Zooms by `factor` (above 1 nearer) toward the orbit point, as the wheel does at the window's centre. */
  zoomBy(factor: number): void {
    if (this.camera === this.ortho) {
      this.ortho.zoom = THREE.MathUtils.clamp(this.ortho.zoom * factor, this.controls.minZoom, this.controls.maxZoom);
      this.ortho.updateProjectionMatrix();
    } else {
      const target = this.controls.target;
      const offset = this.camera.position.clone().sub(target);
      const distance = THREE.MathUtils.clamp(offset.length() / factor, this.controls.minDistance, this.controls.maxDistance);
      this.camera.position.copy(target).addScaledVector(offset.normalize(), distance);
    }
    this.controls.update();
    this.updateClipping();
    this.requestRender();
  }

  /** Switches between the perspective and the orthogonal camera, keeping the view's direction and size. */
  private setProjection(p: Viz3D["projection"]): void {
    const to = p === "orthogonal" ? this.ortho : this.persp;
    const from = this.camera;
    if (to === from) return;
    const target = this.controls.target;
    const dir = from.position.clone().sub(target);
    const tan = Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    if (to === this.ortho) {
      // the height the perspective camera sees at the target
      this.orthoHalf = Math.max(dir.length() * tan, 1);
      this.ortho.zoom = 1;
      this.ortho.position.copy(from.position);
    } else {
      // stand back as far as the perspective camera needs to see as much
      const half = this.orthoHalf / this.ortho.zoom;
      this.persp.position.copy(target).addScaledVector(dir.normalize(), half / tan);
    }
    this.camera = to;
    this.controls.object = to;
    this.resize();
    this.updateClipping();
    this.controls.update();
  }

  /** The insets to keep clear, or none when the palettes would leave too little of a narrow canvas. */
  private clearInsets(w: number): { left: number; right: number } {
    const { left, right } = this.insets;
    return left + right < w * 0.6 ? { left, right } : { left: 0, right: 0 };
  }

  /** Draws at the next animation frame, once however many changes asked for it. */
  private requestRender(): void {
    if (!this.shown || this.frameId !== 0) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = 0;
      this.draw();
    });
  }

  /** Draws the view: the model, then (unless `selection` is false: a capture) the selection's highlight over it. */
  private draw(selection = true): void {
    if (!this.renderer || !this.shown) return;
    this.shearOblique();
    this.renderer.setClearColor(this.background());
    this.placeSun();
    for (const fn of this.beforeRender) fn();
    if (this.hook && isRealistic(this.mode)) {
      // a picture still refining asks for the next frame itself
      if (this.hook.draw(this.mode, this.renderer, this.camera)) this.requestRender();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    if (selection) this.drawSelection(this.renderer);
    if (this.pictureWaits) {
      // the render feature drew this frame because it is further along: the panes try again
      this.pictureWaits = false;
      this.lookSerial++;
    }
    for (const fn of this.afterRender) fn();
  }

  /** The Render palette's settings changed: the view draws again, and the panes' pictures with it. */
  restyled(): void {
    this.lookSerial++;
    if (!this.shown) for (const fn of this.picturesStale) fn();
    this.requestRender();
  }

  // ---- for features (ext.on3d): collaborators' cursors, the sun study, exports ----

  /** Called before each frame is drawn (features place their own objects in threeScene here). */
  readonly beforeRender = new Set<() => void>();

  /** Called after each frame is drawn (the view panes draw their pictures again when the model has changed). */
  readonly afterRender = new Set<() => void>();

  /**
   * Called while the view is hidden when pictures drawn from it would come out differently now (the
   * render feature has the scene ready, or the Render palette's settings changed): the floating view
   * panes draw theirs again, there being no frame of the view's own to follow.
   */
  readonly picturesStale = new Set<() => void>();

  /** The three.js scene the model is in (world millimetres, z up). */
  get threeScene(): THREE.Scene {
    return this.scene;
  }

  get activeCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return this.camera;
  }

  /** The point the camera orbits. */
  get orbitTarget(): THREE.Vector3 {
    return this.controls.target;
  }

  get domElement(): HTMLCanvasElement {
    return this.canvas;
  }

  get glRenderer(): THREE.WebGLRenderer | null {
    return this.renderer;
  }

  /** Draws at the next animation frame. */
  redraw(): void {
    // hidden, a picture drawn Shaded while the render feature got ready: it can be Realistic now
    if (!this.shown && this.pictureWaits) {
      this.pictureWaits = false;
      for (const fn of this.picturesStale) fn();
    }
    this.requestRender();
  }

  /**
   * Adds geometry a feature shows with the model (Site Context's buildings and terrain): it is
   * shown while its design layer is, and counts like the model when framing, for the clip planes
   * and for the "No 3D objects" message.
   */
  addContent(obj: THREE.Object3D, layer: string): void {
    this.content.set(obj, { layer, box: new THREE.Box3().setFromObject(obj) });
    this.scene.add(obj);
    this.updateClipping();
    this.applyVisibility();
  }

  removeContent(obj: THREE.Object3D): void {
    if (!this.content.delete(obj)) return;
    obj.removeFromParent();
    this.updateClipping();
    this.applyVisibility();
  }

  /** Draws now, so the canvas can be read straight after (image and video capture): the model without the selection's highlight, which the next frame puts back. */
  renderNow(): void {
    this.draw(false);
    if (this.selected.size > 0) this.requestRender();
  }

  /** Puts the camera at `position` looking at `target` (following a collaborator's view). */
  lookFrom(position: THREE.Vector3Like, target: THREE.Vector3Like): void {
    this.camera.position.set(position.x, position.y, position.z);
    this.controls.target.set(target.x, target.y, target.z);
    this.controls.update();
    this.requestRender();
  }

  /** Calls `fn` whenever the user moves the camera; returns a function that stops it. */
  onCameraChange(fn: () => void): () => void {
    this.controls.addEventListener("change", fn);
    return () => this.controls.removeEventListener("change", fn);
  }

  /** Where the pointer of `e` meets the model, or null over empty space. */
  pointAt(e: MouseEvent): THREE.Vector3 | null {
    return this.hitAt(e)?.point ?? null;
  }

  /** The face under the pointer of `e`: where it meets the model and the face's normal, toward the viewer. */
  faceAt(e: MouseEvent): FaceHit | null {
    const hit = this.hitAt(e);
    if (!hit?.face) return null;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    const eye = this.camera === this.persp ? this.camera.position.clone().sub(hit.point) : new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 2);
    if (n.dot(eye) < 0) n.negate();
    return { point: [hit.point.x, hit.point.y, hit.point.z], normal: [n.x, n.y, n.z], objectId: this.objectOfHit(hit) };
  }

  /** The object a face under the pointer belongs to. */
  private objectOfHit(hit: THREE.Intersection): string | null {
    const group = this.faceByMesh.get(hit.object);
    if (!hit.face || !group) return null;
    // the face's first vertex is 3 x its triangle number (see build)
    const run = findRun(group.runs, Math.floor(hit.face.a / 3));
    return run ? (this.objectIds[run.obj] ?? null) : null;
  }

  /** Draws line segments (6 numbers each, world mm) over the model: what a tool has chosen, and fainter what it could; null takes them away. */
  setHighlightLines(chosen: ArrayLike<number> | null, others?: ArrayLike<number>, coloured?: readonly { readonly segments: ArrayLike<number>; readonly color: number }[]): void {
    for (const lines of this.highlightLines) {
      lines.removeFromParent();
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    }
    this.highlightLines = [];
    const add = (segments: ArrayLike<number> | null | undefined, color: number, order: number): void => {
      if (!segments?.length) return;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(segments), 3));
      const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true }));
      lines.renderOrder = order;
      this.scene.add(lines);
      this.highlightLines.push(lines);
    };
    add(others, PLANE_GRID_COLOR, 9);
    add(chosen, HIGHLIGHT_LINE_COLOR, 10);
    for (const c of coloured ?? []) add(c.segments, c.color, 11);
    this.requestRender();
  }

  /** The objects selected, with the objects inside them (ids of top-level objects and of objects in groups): drawn over the model in the selection's colour. */
  setSelected(ids: ReadonlySet<string>): void {
    this.selected = ids;
    this.selectionStale = true;
    this.requestRender();
  }

  /** Gathers the selected objects' visible triangles and edge segments into the highlight's geometry. */
  private buildSelection(): void {
    this.selectionStale = false;
    const ids = this.selected;
    const chosen = new Uint8Array(this.objectIds.length);
    for (let o = 0; o < chosen.length && ids.size > 0; o++) chosen[o] = this.objectVisible[o] === 1 && ids.has(this.objectIds[o]) ? 1 : 0;
    const parts = this.partIds.map((id) => ids.has(id));
    const picked = (run: Run): boolean => this.objectVisible[run.obj] === 1 && (chosen[run.obj] === 1 || (run.part >= 0 && parts[run.part]));
    // the picked runs' items (9 floats a triangle, 6 a segment), copied out of each merged array; none past the cap
    const gather = (sets: readonly (readonly [readonly Run[], Float32Array])[], width: number): Float32Array => {
      if (ids.size === 0) return EMPTY;
      let count = 0;
      for (const [runs] of sets) for (const run of runs) if (picked(run)) count += run.end - run.start;
      if (count === 0 || count > SELECTION_CAP) return EMPTY;
      const out = new Float32Array(count * width);
      let at = 0;
      for (const [runs, xyz] of sets) {
        for (const run of runs) {
          if (!picked(run)) continue;
          out.set(xyz.subarray(run.start * width, run.end * width), at);
          at += (run.end - run.start) * width;
        }
      }
      return out;
    };
    const faces = gather(this.faces.map((g) => [g.runs, g.mesh.geometry.getAttribute("position").array as Float32Array] as const), 9);
    const edges = gather(this.edges.map((e) => [e.runs, e.lines.geometry.getAttribute("position").array as Float32Array] as const), 6);
    this.selectionHasFaces = faces.length > 0;
    this.selectionHasEdges = edges.length > 0;
    this.selectionTint.geometry.dispose();
    this.selectionTint.geometry = pointsGeometry(faces);
    // the faint edges share the edges' geometry, so it is disposed once
    this.selectionEdges.geometry.dispose();
    this.selectionEdges.geometry = this.selectionHidden.geometry = pointsGeometry(edges);
  }

  /**
   * Draws the selection's highlight over the frame just drawn: its edges in the selection's colour,
   * fainter where faces hide them, and its faces tinted where faces are drawn. Over a Realistic or
   * Path Traced picture, whose depths are the render feature's own, its edges alone, all of them.
   */
  private drawSelection(renderer: THREE.WebGLRenderer): void {
    if (this.selectionStale) this.buildSelection();
    if (!this.selectionHasFaces && !this.selectionHasEdges) return;
    const rendered = this.hook !== null && isRealistic(this.mode);
    this.selectionTint.visible = this.selectionHasFaces && !rendered && this.mode !== "wireframe";
    this.selectionHidden.visible = this.selectionHasEdges && !rendered;
    this.selectionEdges.visible = this.selectionHasEdges;
    this.selectionLines.depthTest = !rendered;
    for (const m of [this.selectionFaces, this.selectionThrough, this.selectionLines]) m.color.set(ACCENT);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(this.selectionScene, this.camera);
    renderer.autoClear = autoClear;
  }

  /** Where the pointer of `e` meets the level plane at height `z`; null when it looks away from that plane. */
  pointAtHeight(e: MouseEvent, z: number): Vec3 | null {
    this.hitAt(e);
    const { origin, direction } = this.raycaster.ray;
    if (Math.abs(direction.z) < 1e-9) return null;
    const t = (z - origin.z) / direction.z;
    if (t <= 0) return null;
    return [origin.x + t * direction.x, origin.y + t * direction.y, z];
  }

  /** Where the pointer of `e` meets a plane; null when it runs along the plane or away from it. */
  pointOnPlane(e: MouseEvent, point: Vec3, normal: Vec3): Vec3 | null {
    this.aimRay(e);
    const { origin, direction } = this.raycaster.ray;
    const across = direction.x * normal[0] + direction.y * normal[1] + direction.z * normal[2];
    if (Math.abs(across) < 1e-9) return null;
    const t = ((point[0] - origin.x) * normal[0] + (point[1] - origin.y) * normal[1] + (point[2] - origin.z) * normal[2]) / across;
    if (t <= 0) return null;
    return [origin.x + t * direction.x, origin.y + t * direction.y, origin.z + t * direction.z];
  }

  /** How far along a line (`along` of length 1) the pointer of `e` comes nearest it; null when the line runs straight at the viewer. */
  alongLine(e: MouseEvent, point: Vec3, along: Vec3): number | null {
    this.aimRay(e);
    const { origin, direction } = this.raycaster.ray;
    const w: Vec3 = [origin.x - point[0], origin.y - point[1], origin.z - point[2]];
    const b = direction.x * along[0] + direction.y * along[1] + direction.z * along[2];
    const across = 1 - b * b;
    if (across < 1e-4) return null;
    const onRay = direction.x * w[0] + direction.y * w[1] + direction.z * w[2];
    const onLine = along[0] * w[0] + along[1] * w[1] + along[2] * w[2];
    return (onLine - b * onRay) / across;
  }

  /** Where a model point falls on the page, in CSS pixels; null behind the viewer. */
  screenOf(p: Vec3): { x: number; y: number } | null {
    this.camera.updateMatrixWorld();
    const q = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera);
    if (q.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return { x: rect.left + ((q.x + 1) / 2) * rect.width, y: rect.top + ((1 - q.y) / 2) * rect.height };
  }

  /**
   * Draws a grid on `plane` (the working plane) over the visible model, its lines a round number
   * of millimetres apart, with its x axis red and its y axis green from its origin; null takes it away.
   */
  setPlaneGrid(plane: PlaneFrame | null): void {
    if (this.planeGrid) {
      this.planeGrid.removeFromParent();
      this.planeGrid.traverse((o) => {
        if (o instanceof THREE.LineSegments || o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.planeGrid = null;
    }
    if (plane) {
      const x = new THREE.Vector3(...plane.x).normalize();
      const y = new THREE.Vector3(...plane.y).normalize();
      const n = new THREE.Vector3().crossVectors(x, y).normalize();
      const origin = new THREE.Vector3(...plane.origin);
      // as wide as the visible model, about 20 cells across, the cell 1, 2 or 5 times a power of ten
      const span = Math.max(this.visibleBox().getSize(new THREE.Vector3()).length(), 1000);
      const raw = span / 20;
      const ten = 10 ** Math.floor(Math.log10(raw));
      const step = [1, 2, 5, 10].map((k) => k * ten).find((v) => v >= raw) ?? 10 * ten;
      const cells = 2 * Math.ceil(span / step / 2);
      const grid = new THREE.GridHelper(cells * step, cells, PLANE_GRID_COLOR, PLANE_GRID_COLOR);
      const gridMaterial = grid.material as THREE.LineBasicMaterial;
      gridMaterial.transparent = true;
      gridMaterial.opacity = 0.35;
      gridMaterial.depthWrite = false;
      const axis = (dir: THREE.Vector3, color: number): THREE.Line =>
        new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir.clone().multiplyScalar(step * 3)]), new THREE.LineBasicMaterial({ color }));
      const group = new THREE.Group();
      // the grid lies in its own x-z plane: x along the plane's x, its y up the normal, z against the plane's y
      grid.matrixAutoUpdate = false;
      grid.matrix.makeBasis(x, n, y.clone().negate()).setPosition(origin);
      const axes = new THREE.Group();
      axes.position.copy(origin);
      axes.add(axis(x, PLANE_X_COLOR), axis(y, PLANE_Y_COLOR));
      group.add(grid, axes);
      this.scene.add(group);
      this.planeGrid = group;
    }
    this.requestRender();
  }

  /** Frames the visible model looking along `toward` (from the model to the viewer): square on to a plane with that normal. */
  lookAlong(toward: Vec3): void {
    const dir = new THREE.Vector3(...toward);
    if (!(dir.lengthSq() > 0)) return;
    dir.normalize();
    // straight down (or up) leans a hair toward the front, as Top does, so orbiting keeps its bearings
    if (Math.abs(dir.z) > 0.999999) dir.y -= 0.001;
    this.frameView(dir);
  }

  /**
   * The sun on the camera side, so the faces the user looks at are lit, or where the Heliodon puts
   * it (no sun below the horizon). A shadow-casting sun's shadow camera takes in the visible model.
   */
  private placeSun(): void {
    const box = this.visibleBox();
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 500);
    if (this.ground.visible) {
      // well past where the shadows reach, a hair under the model's lowest point
      this.ground.position.set(centre.x, centre.y, box.min.z - radius * 1e-4);
      this.ground.scale.set(radius * 20, radius * 20, 1);
    }
    if (this.viz.sun === "heliodon") {
      const place = sunPlace(this.viz);
      this.sun.position.set(place.dir.x, place.dir.y, place.dir.z).multiplyScalar(radius * 2).add(centre);
      this.sun.target.position.copy(centre);
      this.sun.intensity = place.altitude > 0 ? SUN_INTENSITY : 0;
    } else if (this.viz.sun === "off") {
      this.sun.position.copy(this.camera.position);
      this.sun.target.position.copy(this.controls.target);
      this.sun.intensity = 0;
    } else {
      this.sun.position.copy(this.camera.position);
      this.sun.target.position.copy(this.controls.target);
      this.sun.intensity = SUN_INTENSITY;
    }
    if (!this.sun.castShadow) return;
    const reach = (radius + this.sun.target.position.distanceTo(centre)) * 1.1;
    const d = this.sun.position.distanceTo(this.sun.target.position);
    const cam = this.sun.shadow.camera;
    cam.left = -reach;
    cam.right = reach;
    cam.top = reach;
    cam.bottom = -reach;
    cam.near = Math.max(1, d - reach);
    cam.far = d + reach;
    cam.updateProjectionMatrix();
    // about a texel and a half along the normal, against shadow acne
    this.sun.shadow.normalBias = (reach * 3) / this.sun.shadow.mapSize.x;
  }

  /** The nearest face under the pointer that the clip cube leaves, or null. */
  private hitAt(e: MouseEvent): THREE.Intersection | null {
    this.aimRay(e);
    // faces are tested even in wireframe, where they are not drawn
    const hits = this.raycaster.intersectObjects(this.faces.map((g) => g.mesh), false);
    const clipped = this.clipHelper.visible;
    return hits.find((h) => !clipped || this.clipBox.containsPoint(h.point)) ?? null;
  }

  /** Points the raycaster along the pointer of `e`. */
  private aimRay(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.camera.updateMatrixWorld();
    this.shearOblique();
    this.raycaster.setFromCamera(this.pointer, this.camera);
    if (this.viz.oblique && this.camera === this.ortho) {
      // an oblique view's rays run slantwise: from the near plane to the far one under the pointer
      const near = new THREE.Vector3(this.pointer.x, this.pointer.y, -1).unproject(this.camera);
      const far = new THREE.Vector3(this.pointer.x, this.pointer.y, 1).unproject(this.camera);
      this.raycaster.ray.set(near, far.sub(near).normalize());
    }
  }

  /**
   * Walkthrough: W/S or Up/Down move along the view, level; A/D or Left/Right step aside; Q/E go
   * down and up; Shift goes four times as far. Returns whether the key was one of them.
   */
  private walk(e: KeyboardEvent): boolean {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const step = (this.modelRadius() / 40) * (e.shiftKey ? 4 : 1);
    const ahead = this.controls.target.clone().sub(this.camera.position).setZ(0);
    if (ahead.lengthSq() === 0) ahead.set(0, 1, 0);
    ahead.normalize();
    const side = new THREE.Vector3(ahead.y, -ahead.x, 0);
    const up = new THREE.Vector3(0, 0, 1);
    const moves: Record<string, THREE.Vector3> = {
      w: ahead,
      arrowup: ahead,
      s: ahead.clone().negate(),
      arrowdown: ahead.clone().negate(),
      d: side,
      arrowright: side,
      a: side.clone().negate(),
      arrowleft: side.clone().negate(),
      e: up,
      q: up.clone().negate(),
    };
    const move = moves[e.key.toLowerCase()];
    if (!move) return false;
    const by = move.clone().multiplyScalar(step);
    this.camera.position.add(by);
    this.controls.target.add(by);
    this.controls.update();
    this.requestRender();
    return true;
  }

  private pick(e: PointerEvent): void {
    if (this.onFacePick) {
      this.onFacePick(this.faceAt(e), e.shiftKey, e);
      return;
    }
    const hit = this.hitAt(e);
    this.onPick?.(hit ? this.objectOfHit(hit) : null, e.shiftKey);
  }

  /**
   * A pointer lifted or was cancelled. A press that stayed one pointer and moved no further than a
   * click (or a tap, for a finger) picks; a finger's second tap close to its first orbits about the
   * point as a double-click does. Two fingers tapped together do neither.
   */
  private release(e: PointerEvent, cancelled: boolean): void {
    const press = this.press;
    this.down.delete(e.pointerId);
    if (this.down.size === 0) this.press = null;
    if (this.steer?.id === e.pointerId) this.steer = null;
    if (!press || cancelled || press.id !== e.pointerId || press.more) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > (press.touch ? TAP_SLOP : CLICK_SLOP)) return;
    // Flyover's Interactive Origin: a click sets the centre the view turns about
    if (this.nav === "origin") {
      this.orbitAbout(e);
      return;
    }
    this.pick(e);
    if (!press.touch) return;
    const now = performance.now();
    const prev = this.lastTap;
    if (prev && now - prev.at <= DOUBLE_TAP_MS && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) <= DOUBLE_TAP_PX) {
      this.lastTap = null;
      this.orbitAbout(e);
    } else {
      this.lastTap = { x: e.clientX, y: e.clientY, at: now };
    }
  }

  /**
   * What a left drag does from now on (Navigation); `sensitivity` scales how far a drag turns the
   * view. The middle button still zooms and the right pans, whatever the left does.
   */
  setNavigation(nav: Navigation, sensitivity = 1): void {
    this.nav = nav;
    this.steer = null;
    const left = nav === "orbit" || nav === "origin" ? THREE.MOUSE.ROTATE : nav === "pan" ? THREE.MOUSE.PAN : null;
    this.controls.mouseButtons = { LEFT: left, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.rotateSpeed = sensitivity;
  }

  /**
   * Turns the view about the middle of the faces of objects `ids`, or of the visible model when none
   * of them has faces (Flyover's Object Center).
   */
  orbitAboutObjects(ids: ReadonlySet<string>): void {
    const box = this.objectsBox(ids);
    if (box.isEmpty()) box.copy(this.visibleBox());
    if (box.isEmpty()) return;
    box.getCenter(this.controls.target);
    this.controls.update();
    this.requestRender();
  }

  /** Frames objects `ids` from the current direction (Fit to Objects), or the visible model when none of them is drawn. */
  fitObjects(ids: ReadonlySet<string>): void {
    const box = this.objectsBox(ids);
    const dir = this.camera.position.clone().sub(this.controls.target);
    this.frameView(dir.lengthSq() > 0 ? dir : new THREE.Vector3(...VIEW_DIRS.iso), box.isEmpty() ? undefined : box);
  }

  /** The box round the faces of objects `ids`, or null when none is drawn (Create Animation's centre). */
  boundsOf(ids: ReadonlySet<string>): { readonly min: Vec3; readonly max: Vec3 } | null {
    const box = this.objectsBox(ids);
    return box.isEmpty() ? null : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  }

  /** The box round each of objects `ids` that is drawn, in one pass over the faces (a box per object, as Compare outlines changes). */
  boundsEach(ids: ReadonlySet<string>): Map<string, { readonly min: Vec3; readonly max: Vec3 }> {
    const boxes = new Map<string, THREE.Box3>();
    const p = new THREE.Vector3();
    if (ids.size) {
      for (const g of this.faces) {
        const pos = g.mesh.geometry.getAttribute("position");
        for (const run of g.runs) {
          const id = this.objectIds[run.obj];
          if (!ids.has(id)) continue;
          let box = boxes.get(id);
          if (!box) boxes.set(id, (box = new THREE.Box3()));
          for (let i = run.start * 3; i < run.end * 3; i++) box.expandByPoint(p.fromBufferAttribute(pos, i));
        }
      }
    }
    const out = new Map<string, { readonly min: Vec3; readonly max: Vec3 }>();
    for (const [id, box] of boxes) out.set(id, { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] });
    return out;
  }

  /** The box round the faces of objects `ids` (empty when none is drawn). */
  private objectsBox(ids: ReadonlySet<string>): THREE.Box3 {
    const box = new THREE.Box3();
    const p = new THREE.Vector3();
    if (!ids.size) return box;
    for (const g of this.faces) {
      const pos = g.mesh.geometry.getAttribute("position");
      // a triangle's first vertex is 3 x its number (see build)
      for (const run of g.runs) if (ids.has(this.objectIds[run.obj])) for (let i = run.start * 3; i < run.end * 3; i++) box.expandByPoint(p.fromBufferAttribute(pos, i));
    }
    return box;
  }

  /**
   * Puts the eye `height` above the plane at `z`, looking level the way it looks now (Walkthrough's
   * Viewer Height).
   */
  standAt(z: number, height: number): void {
    const eye = this.camera.position;
    const ahead = this.controls.target.clone().sub(eye).setZ(0);
    if (ahead.lengthSq() === 0) ahead.set(0, 1, 0);
    ahead.setLength(Math.max(this.controls.target.distanceTo(eye), 1));
    eye.z = z + height;
    this.controls.target.copy(eye).add(ahead);
    this.controls.update();
    this.requestRender();
  }

  /**
   * A steered drag moved `dx`, `dy` CSS px: walking forward (up the screen) and turning, looking
   * round, riding up and down, or moving along the sightline.
   */
  private steerBy(dx: number, dy: number): void {
    const eye = this.camera.position;
    const target = this.controls.target;
    const step = this.modelRadius() / STEER_PX;
    const turn = (axis: THREE.Vector3, angle: number): void => {
      target.sub(eye).applyAxisAngle(axis, angle).add(eye);
    };
    const up = new THREE.Vector3(0, 0, 1);
    if (this.nav === "walk") {
      const ahead = target.clone().sub(eye).setZ(0);
      if (ahead.lengthSq() > 0) {
        const by = ahead.normalize().multiplyScalar(-dy * step);
        eye.add(by);
        target.add(by);
      }
      turn(up, -dx * TURN_PER_PX);
    } else if (this.nav === "look") {
      turn(up, -dx * TURN_PER_PX);
      // tilting no further than straight up or down
      const sight = target.clone().sub(eye);
      const pitch = Math.asin(THREE.MathUtils.clamp(sight.z / sight.length(), -1, 1));
      const tilt = THREE.MathUtils.clamp(pitch - dy * TURN_PER_PX, -MAX_PITCH, MAX_PITCH) - pitch;
      const side = new THREE.Vector3().crossVectors(sight, up);
      if (side.lengthSq() > 0) turn(side.normalize(), tilt);
    } else if (this.nav === "elevator") {
      eye.z -= dy * step;
      target.z -= dy * step;
    } else if (this.nav === "move") {
      const sight = target.clone().sub(eye).normalize().multiplyScalar(-dy * step);
      eye.add(sight);
      target.add(sight);
    }
    this.controls.update();
    this.requestRender();
  }

  /** Makes the point under the pointer the centre the view orbits about; nothing happens over empty space. */
  private orbitAbout(e: MouseEvent): void {
    const hit = this.hitAt(e);
    if (!hit) return;
    this.controls.target.copy(hit.point);
    this.controls.update();
    this.requestRender();
  }

  /**
   * Lights the model with the light objects that are on, on visible layers: directional ones, then
   * the ones nearest the point the view looks at, MAX_LAMPS in all (see nearestLamps). While the
   * sun casts shadows, so do the first of them of each kind, SHADOW_LAMPS.
   */
  private applyLights(): void {
    this.applyBeams();
    const target = this.controls.target;
    const shown = this.viz.lights ? nearestLamps(this.lights.filter((l) => l.on && l.brightness > 0 && this.isLayerVisible(l.layerId)), target) : [];
    const left = { ...SHADOW_LAMPS };
    const shadows = new Set(this.viz.shadows ? shown.filter((l) => left[l.kind]-- > 0) : []);
    const gain = this.viz.sun === "off" ? NIGHT_LAMP_GAIN : 1;
    const ids = `${gain} ${shown.map((l) => (shadows.has(l) ? `${l.id}+shadow` : l.id)).join(" ")}`;
    if (ids === this.lampIds && shown.length === this.lamps.children.filter((c) => c instanceof THREE.Light).length) return;
    this.lampIds = ids;
    for (const l of [...this.lamps.children]) {
      this.lamps.remove(l);
      if (l instanceof THREE.Light) l.dispose();
    }
    const box = shadows.size ? this.visibleBox() : null;
    for (const l of shown) {
      const parts = lamp(l, gain);
      const light = parts[0];
      if (box && shadows.has(l) && (light instanceof THREE.SpotLight || light instanceof THREE.PointLight || light instanceof THREE.DirectionalLight)) {
        lampShadow(light, box, target, (base) => this.shadowMap(base));
      }
      this.lamps.add(...parts);
    }
    this.requestRender();
  }

  /** What the view is drawn on: paper for Sketch, night with the sun off, else a light grey. */
  private background(): number {
    return this.mode === "sketch" ? PAPER : this.viz.sun === "off" ? NIGHT_BACKGROUND : BACKGROUND;
  }

  /** Draws every spot that is on as a beam while there's haze (Viz3D.haze), not only the MAX_LAMPS that light the model. */
  private applyBeams(): void {
    const gain = this.viz.sun === "off" ? NIGHT_LAMP_GAIN : 1;
    const haze = this.viz.lights ? this.viz.haze : 0;
    const spots = haze > 0 ? this.lights.filter((l) => l.kind === "spot" && l.on && l.brightness > 0 && this.isLayerVisible(l.layerId)) : [];
    const key = `${haze} ${gain} ${spots.map((l) => l.id).join(" ")}`;
    if (key === this.beamKey && this.lights === this.beamLights) return;
    this.beamKey = key;
    this.beamLights = this.lights;
    disposeBeams(this.beams);
    if (spots.length) {
      const box = this.visibleBox();
      const beams = spots.map((l) => ({
        at: new THREE.Vector3(...l.position),
        aim: new THREE.Vector3(...l.direction).normalize(),
        spread: l.spread,
        beam: l.beam,
        color: l.color,
        strength: SUN_INTENSITY * l.brightness * gain * VIEW_BEAMS,
      }));
      // each beam stops at the first thing its axis meets: the deck, not the ground under it
      const reaches = surfaceReaches(
        beams.map((b) => ({ at: b.at.toArray(), aim: b.aim.toArray(), far: boxReach(b.at, b.aim, box) })),
        this.faces.map((f) => f.mesh.geometry),
      );
      this.beams.add(...beamGroup(beams.map((b, i) => ({ ...b, reach: reaches[i] })), box, 0.001, haze).children);
    }
    this.requestRender();
  }

  /** Once the view settles, lights the model with the light objects nearest where it now looks. */
  private queueLamps(): void {
    if (!this.viz.lights || this.lights.length <= MAX_LAMPS) return;
    clearTimeout(this.lampTimer);
    this.lampTimer = window.setTimeout(() => this.applyLights(), LAMP_SETTLE_MS);
  }

  private isLayerVisible(layer: string): boolean {
    return this.visibleLayers === null || this.visibleLayers.has(layer);
  }

  /** Points the camera at the visible geometry from `dir`, sized to fit whatever the window's shape. */
  private frameView(dir: THREE.Vector3, fitted?: THREE.Box3): void {
    this.framed = true;
    // the projection's lens again, after looking through a camera
    if (this.persp.fov !== this.viz.lens) {
      this.persp.fov = this.viz.lens;
      this.persp.updateProjectionMatrix();
    }
    this.updateClipping();
    const box = fitted ?? this.visibleBox();
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 500);
    const halfV = THREE.MathUtils.degToRad(this.viz.lens / 2);
    // fit the width the palettes leave clear
    const w = this.host.clientWidth;
    const clear = this.clearInsets(w);
    const share = w > 0 ? Math.max(0.2, (w - clear.left - clear.right) / w) : 1;
    const halfH = Math.atan(Math.tan(halfV) * this.aspect * share);
    const distance = (radius / Math.sin(Math.min(halfV, halfH))) * 1.1;
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir.normalize(), distance);
    if (this.camera === this.ortho) {
      // as much as the perspective camera would show at the centre
      this.orthoHalf = distance * Math.tan(halfV);
      this.ortho.zoom = 1;
      this.setOrthoFrustum();
      this.ortho.updateProjectionMatrix();
    }
    this.controls.update();
    this.requestRender();
  }

  /** Box of the visible layers' geometry; the whole model when none is visible; a 5 m cube when empty. */
  private visibleBox(): THREE.Box3 {
    const box = new THREE.Box3();
    for (const [layer, layerBox] of this.layerBoxes) {
      if (this.isLayerVisible(layer)) box.union(layerBox);
    }
    for (const c of this.content.values()) {
      if (this.isLayerVisible(c.layer)) box.union(c.box);
    }
    if (box.isEmpty()) box.copy(this.wholeBox());
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(5000, 5000, 5000));
    return box;
  }

  /** Box of the model and the features' content, visible or not. */
  private wholeBox(): THREE.Box3 {
    const box = this.modelBox.clone();
    for (const c of this.content.values()) box.union(c.box);
    return box;
  }

  private modelRadius(): number {
    const box = this.wholeBox();
    if (box.isEmpty()) return 2500;
    return Math.max(box.getSize(new THREE.Vector3()).length() / 2, 500);
  }

  /** Clip planes and dolly limits from the whole model's size, so the depth buffer stays precise. */
  private updateClipping(): void {
    const radius = this.modelRadius();
    for (const cam of [this.persp, this.ortho]) {
      cam.near = Math.max(radius / 300, 1);
      cam.far = radius * 100;
      cam.updateProjectionMatrix();
    }
    this.controls.minDistance = this.persp.near;
    this.controls.maxDistance = this.persp.far / 2;
  }

  /** Empties the scene and frees its GPU memory and textures. */
  private clearModel(): void {
    this.serial++;
    for (const g of this.faces) {
      this.scene.remove(g.mesh);
      g.mesh.geometry.dispose();
      g.shaded.dispose();
      g.textured?.dispose();
      g.plain?.dispose();
    }
    for (const e of this.edges) {
      this.scene.remove(e.lines);
      if (e.dashed) this.scene.remove(e.dashed);
      for (const l of e.sketch ?? []) this.scene.remove(l);
      e.lines.geometry.dispose();
    }
    for (const tex of this.textures.values()) releaseTexture(tex);
    for (const tex of this.masks.values()) releaseTexture(tex);
    this.masks.clear();
    this.faces = [];
    this.edges = [];
    this.faceByMesh.clear();
    this.textures.clear();
    this.loading.clear();
    this.objectIds = [];
    this.partIds = [];
    this.objectLayer = [];
    this.objectVisible = new Uint8Array(0);
    this.layerBoxes.clear();
    this.modelBox.makeEmpty();
  }

  /** Merges the meshes into one geometry per colour, opacity and texture, and one edge set per colour. */
  private build(meshes: readonly Mesh3D[]): void {
    const faceBuilds = new Map<string, FaceBuild>();
    const edgeBuilds = new Map<string, EdgeBuild>();
    // pass 1: count what each merged array needs, so each is allocated once
    for (const m of meshes) {
      const tris = Math.floor(m.triangles.length / 9);
      if (tris > 0) {
        const { key, opacity, texture } = this.faceKey(m);
        let fb = faceBuilds.get(key);
        if (!fb) {
          fb = {
            color: m.color,
            opacity,
            recessed: m.recessed === true,
            texture,
            imageSize: this.imageSizeOf(texture) ?? DEFAULT_IMAGE_MM,
            tris: 0,
            fill: 0,
            positions: EMPTY,
            uvs: null,
            runs: [],
          };
          faceBuilds.set(key, fb);
        }
        fb.tris += tris;
      }
      const segs = Math.floor(m.edges.length / 6);
      if (segs > 0) {
        let eb = edgeBuilds.get(m.color);
        if (!eb) {
          eb = { segs: 0, fill: 0, positions: EMPTY, runs: [] };
          edgeBuilds.set(m.color, eb);
        }
        eb.segs += segs;
      }
    }
    for (const fb of faceBuilds.values()) {
      fb.positions = new Float32Array(fb.tris * 9);
      if (this.imageSizeOf(fb.texture) !== null) fb.uvs = new Float32Array(fb.tris * 6);
    }
    for (const eb of edgeBuilds.values()) eb.positions = new Float32Array(eb.segs * 6);

    // pass 2: copy the geometry in, recording which object (and which object inside a group) each run belongs to
    const objects = new Map<string, number>();
    const parts = new Map<string, number>();
    for (const m of meshes) {
      const tris = Math.floor(m.triangles.length / 9);
      const segs = Math.floor(m.edges.length / 6);
      if (tris === 0 && segs === 0) continue;
      const obj = this.objectOf(m, objects);
      const part = this.partOf(m, parts);
      if (tris > 0) {
        const fb = faceBuilds.get(this.faceKey(m).key)!;
        const src = m.triangles.subarray(0, tris * 9);
        const t0 = fb.fill;
        fb.positions.set(src, t0 * 9);
        if (fb.uvs && m.uvs?.length === tris * 6) ownUvs(m.uvs, fb.uvs.subarray(t0 * 6, (t0 + tris) * 6));
        else if (fb.uvs) boxUvs(src, fb.uvs.subarray(t0 * 6, (t0 + tris) * 6), fb.imageSize);
        fb.fill += tris;
        fb.runs.push({ start: t0, end: fb.fill, obj, part });
        this.extendBounds(m.layerId, src);
      }
      if (segs > 0) {
        const eb = edgeBuilds.get(m.color)!;
        const src = m.edges.subarray(0, segs * 6);
        const s0 = eb.fill;
        eb.positions.set(src, s0 * 6);
        eb.fill += segs;
        eb.runs.push({ start: s0, end: eb.fill, obj, part });
        this.extendBounds(m.layerId, src);
      }
    }

    this.objectVisible = new Uint8Array(this.objectIds.length);
    for (const fb of faceBuilds.values()) this.addFaces(fb);
    for (const eb of edgeBuilds.values()) this.addEdges(eb);
    for (const box of this.layerBoxes.values()) this.modelBox.union(box);
  }

  private addFaces(fb: FaceBuild): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(fb.positions, 3));
    if (fb.uvs) geometry.setAttribute("uv", new THREE.BufferAttribute(fb.uvs, 2));
    const index = new THREE.BufferAttribute(new Uint32Array(fb.tris * 3), 1);
    geometry.setIndex(index);
    const shaded = faceMaterial(fb.color, fb.opacity, fb.recessed);
    const textured = fb.texture >= 0 ? faceMaterial(fb.color, fb.opacity, fb.recessed) : null;
    if (this.viz.shadows) this.giveNormals(geometry);
    const mesh = new THREE.Mesh(geometry, shaded);
    // glass lets the sun through
    mesh.castShadow = fb.opacity >= 0.95;
    mesh.receiveShadow = true;
    const cutout = textured !== null && this.resourceByIndex.get(fb.texture)?.mask !== undefined;
    const group: FaceGroup = { mesh, index, runs: fb.runs, texture: fb.texture, recessed: fb.recessed, cutout, shaded, textured, plain: null };
    this.scene.add(mesh);
    this.faces.push(group);
    this.faceByMesh.set(mesh, group);
  }

  /** Normals for shadows, made the first time a sun casts them on these faces. */
  private giveNormals(geometry: THREE.BufferGeometry): void {
    if (geometry.getAttribute("normal")) return;
    geometry.setAttribute("normal", faceNormals(geometry.getAttribute("position").array as Float32Array));
  }

  private addEdges(eb: EdgeBuild): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(eb.positions, 3));
    const index = new THREE.BufferAttribute(new Uint32Array(eb.segs * 2), 1);
    geometry.setIndex(index);
    const lines = new THREE.LineSegments(geometry, this.edgeMaterial);
    this.scene.add(lines);
    this.edges.push({ lines, index, runs: eb.runs, dashed: null, sketch: null });
  }

  /** Merge key of a mesh: colour, opacity and the texture when it has an image or a preview to take a colour from. */
  private faceKey(m: Mesh3D): { key: string; opacity: number; texture: number } {
    const opacity = Math.min(1, Math.max(0, m.opacity));
    const res = this.resourceByIndex.get(m.texture);
    const texture = res?.image?.length || res?.preview?.length ? m.texture : -1;
    return { key: `${m.color}|${opacity}|${texture}|${m.recessed ? "r" : ""}`, opacity, texture };
  }

  /** Image size in mm of a texture that has an image, or null. */
  private imageSizeOf(index: number): number | null {
    const res = this.resourceByIndex.get(index);
    if (!res?.image || res.image.length === 0) return null;
    return res.imageSize && res.imageSize > 0 ? res.imageSize : DEFAULT_IMAGE_MM;
  }

  /** Index of the object a mesh belongs to, numbering new objects as they come. */
  private objectOf(m: Mesh3D, objects: Map<string, number>): number {
    let obj = objects.get(m.objectId);
    if (obj === undefined) {
      obj = this.objectIds.length;
      objects.set(m.objectId, obj);
      this.objectIds.push(m.objectId);
      this.objectLayer.push(m.layerId);
    }
    return obj;
  }

  /** Index of the object inside a top-level group a mesh belongs to (Mesh3D.partId), numbering new ones as they come; -1 for none. */
  private partOf(m: Mesh3D, parts: Map<string, number>): number {
    if (m.partId === undefined) return -1;
    let part = parts.get(m.partId);
    if (part === undefined) {
      part = this.partIds.length;
      parts.set(m.partId, part);
      this.partIds.push(m.partId);
    }
    return part;
  }

  /** Grows the bounding box of a layer by the points of `xyz` (3 floats per point). */
  private extendBounds(layer: string, xyz: Float32Array): void {
    if (xyz.length < 3) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    let z1 = -Infinity;
    for (let i = 0; i + 2 < xyz.length; i += 3) {
      const x = xyz[i];
      const y = xyz[i + 1];
      const z = xyz[i + 2];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    let box = this.layerBoxes.get(layer);
    if (!box) {
      box = new THREE.Box3();
      this.layerBoxes.set(layer, box);
    }
    box.expandByPoint(new THREE.Vector3(x0, y0, z0));
    box.expandByPoint(new THREE.Vector3(x1, y1, z1));
  }

  /** Rewrites every index buffer to the objects on visible layers and sets the draw ranges. */
  /** The light objects' shadows are drawn again at the next frame: what the model shows has changed. */
  private staleShadows(): void {
    for (const c of this.lamps.children) if (c instanceof THREE.Light && c.castShadow && c.shadow) c.shadow.needsUpdate = true;
  }

  private applyVisibility(): void {
    this.modelSerial++;
    this.selectionStale = true;
    for (let o = 0; o < this.objectLayer.length; o++) {
      this.objectVisible[o] = this.isLayerVisible(this.objectLayer[o]) ? 1 : 0;
    }
    let items = 0;
    for (const g of this.faces) {
      const n = fillIndex(g.runs, g.index, 3, this.objectVisible);
      g.mesh.geometry.setDrawRange(0, n);
      items += n / 3;
    }
    for (const e of this.edges) {
      const n = fillIndex(e.runs, e.index, 2, this.objectVisible);
      e.lines.geometry.setDrawRange(0, n);
      items += n / 2;
    }
    for (const [obj, c] of this.content) {
      obj.visible = this.isLayerVisible(c.layer);
      if (obj.visible) items++;
    }
    this.empty.hidden = items > 0;
    this.staleShadows();
    this.requestRender();
  }

  /** Puts each face group in the material of the mode, shows or hides the faces, the dashed hidden edges and the sketch strokes. */
  private applyMode(): void {
    const sketch = this.mode === "sketch";
    const lines = this.mode === "hidden" || this.mode === "dashed";
    // Shaded and Textured, and the realistic modes, which draw as Shaded without their renderer
    const shaded = !sketch && !lines && this.mode !== "wireframe";
    const o = this.viz.shaded;
    for (const g of this.faces) {
      const k = g.recessed ? 1 : 0;
      // cut-out textures (plants, image props) keep their pictures, as a white card they would be wrong
      const textured = g.cutout || (shaded && (this.mode === "textured" || o.textures) && o.colors);
      g.mesh.material = sketch
        ? this.paperFaces[k]
        : lines
          ? this.hiddenFaces[k]
          : textured && g.textured?.userData.ready
            ? g.textured
            : o.colors
              ? g.shaded
              : this.plainOf(g);
      g.mesh.visible = this.mode !== "wireframe";
      g.mesh.receiveShadow = !o.groundOnly;
    }
    this.ground.visible = shaded && o.groundOnly && this.viz.shadows;
    for (const e of this.edges) {
      if (sketch && !e.sketch) {
        // the same geometry again, so the same draw range
        e.sketch = this.sketchMaterials.map((m) => {
          const l = new THREE.LineSegments(e.lines.geometry, m);
          l.renderOrder = 1;
          this.scene.add(l);
          return l;
        });
      }
      for (const l of e.sketch ?? []) l.visible = sketch;
      e.lines.visible = !sketch && (o.edges || !shaded);
      if (this.mode === "dashed" && !e.dashed) {
        // the same geometry, so the same draw range; dashes need the distance along the edges
        e.dashed = new THREE.LineSegments(e.lines.geometry, this.dashedMaterial);
        e.lines.geometry.setAttribute("lineDistance", lineDistances(e.lines.geometry.getAttribute("position").array));
        e.dashed.renderOrder = 1;
        this.scene.add(e.dashed);
      }
      if (e.dashed) e.dashed.visible = this.mode === "dashed";
    }
    this.staleShadows();
  }

  /** Every material the model and the selection's highlight are drawn with, for the clip planes. */
  private materials(): THREE.Material[] {
    const out: THREE.Material[] = [...this.hiddenFaces, ...this.paperFaces, ...this.sketchMaterials, this.edgeMaterial, this.dashedMaterial, this.selectionFaces, this.selectionThrough, this.selectionLines];
    for (const g of this.faces) {
      out.push(g.shaded);
      if (g.textured) out.push(g.textured);
      if (g.plain) out.push(g.plain);
    }
    return out;
  }

  /** Cuts the model to the clip cube (fractions of its box along each axis), with the cube's outline shown, or uncuts it. */
  private applyClip(): void {
    const c = this.viz.clip;
    const on = c.on && !this.modelBox.isEmpty();
    if (on) {
      const { min, max } = this.modelBox;
      const at = (lo: number, hi: number, f: number) => lo + (hi - lo) * f;
      const x0 = at(min.x, max.x, Math.min(c.x[0], c.x[1]));
      const x1 = at(min.x, max.x, Math.max(c.x[0], c.x[1]));
      const y0 = at(min.y, max.y, Math.min(c.y[0], c.y[1]));
      const y1 = at(min.y, max.y, Math.max(c.y[0], c.y[1]));
      const z0 = at(min.z, max.z, Math.min(c.z[0], c.z[1]));
      const z1 = at(min.z, max.z, Math.max(c.z[0], c.z[1]));
      // a plane keeps what lies on the side its normal points to
      this.clipPlanes[0].set(new THREE.Vector3(1, 0, 0), -x0);
      this.clipPlanes[1].set(new THREE.Vector3(-1, 0, 0), x1);
      this.clipPlanes[2].set(new THREE.Vector3(0, 1, 0), -y0);
      this.clipPlanes[3].set(new THREE.Vector3(0, -1, 0), y1);
      this.clipPlanes[4].set(new THREE.Vector3(0, 0, 1), -z0);
      this.clipPlanes[5].set(new THREE.Vector3(0, 0, -1), z1);
      this.clipBox.set(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    }
    this.clipHelper.visible = on;
    const planes = on ? this.clipPlanes : null;
    for (const m of this.materials()) {
      if ((m.clippingPlanes ?? null) === planes) continue;
      m.clippingPlanes = planes;
      m.needsUpdate = true;
    }
    // the clip cube's planes move without a new set of them
    this.staleShadows();
  }

  /** A decoded image as a texture that repeats across faces. */
  private mapTexture(bitmap: ImageBitmap, colorSpace: THREE.ColorSpace): THREE.Texture {
    const tex = new THREE.Texture(bitmap);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = colorSpace;
    tex.anisotropy = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
    tex.needsUpdate = true;
    return tex;
  }

  /** Gives the faces of a texture without an image the average colour of its preview. */
  private loadPreviewColour(idx: number, preview: Uint8Array, mime: string): void {
    const serial = this.serial;
    this.loading.add(idx);
    const done = createImageBitmap(new Blob([new Uint8Array(preview)], { type: mime })).then(
      (bitmap) => {
        const colour = serial === this.serial ? averageColour(bitmap) : null;
        bitmap.close();
        if (serial !== this.serial) return;
        this.loading.delete(idx);
        if (!colour) return;
        for (const f of this.faces) {
          if (f.texture === idx && f.textured) {
            f.textured.color.copy(colour);
            f.textured.userData.ready = true;
            f.textured.needsUpdate = true;
          }
        }
        this.textureSerial++;
        this.applyMode();
        this.requestRender();
      },
      () => {
        if (serial === this.serial) this.loading.delete(idx);
      },
    );
    this.track(idx, done);
  }

  /**
   * Decodes the images of the textured groups (in Textured, and Shaded with textures; else in Shaded,
   * the cut-out ones'), each
   * with its mask; each map appears once its image is ready. A texture without an image (a
   * procedural shader such as a metal) shows the average colour of its preview instead.
   */
  private loadTextures(all = false): void {
    if (!all && this.mode !== "textured" && this.mode !== "shaded") return;
    const every = all || this.mode === "textured" || this.viz.shaded.textures;
    const serial = this.serial;
    for (const g of this.faces) {
      const idx = g.texture;
      if (!every && !g.cutout) continue;
      if (idx < 0 || !g.textured || g.textured.userData.ready || this.textures.has(idx) || this.loading.has(idx)) continue;
      const res = this.resourceByIndex.get(idx);
      if (!res) continue;
      if (!res.image?.length) {
        if (res.preview?.length) this.loadPreviewColour(idx, res.preview, res.previewMime);
        continue;
      }
      this.loading.add(idx);
      const decode = (bytes: Uint8Array, mime: string | undefined) => createImageBitmap(new Blob([new Uint8Array(bytes)], { type: mime ?? "" }));
      const done = Promise.all([decode(res.image, res.imageMime), res.mask?.length ? decode(res.mask, res.maskMime) : null]).then(
        ([bitmap, maskBitmap]) => {
          if (serial !== this.serial) {
            bitmap.close();
            maskBitmap?.close();
            return;
          }
          this.loading.delete(idx);
          const tex = this.mapTexture(bitmap, THREE.SRGBColorSpace);
          this.textures.set(idx, tex);
          const mask = maskBitmap ? this.mapTexture(maskBitmap, THREE.NoColorSpace) : null;
          if (mask) this.masks.set(idx, mask);
          // the image shows as it is, so the material colour goes to white; a mask cuts it out
          for (const f of this.faces) {
            if (f.texture === idx && f.textured) {
              f.textured.map = tex;
              f.textured.color.set(0xffffff);
              if (mask) {
                f.textured.alphaMap = mask;
                f.textured.alphaTest = CUTOUT_ALPHA;
              }
              f.textured.userData.ready = true;
              f.textured.needsUpdate = true;
            }
          }
          this.textureSerial++;
          this.applyMode();
          this.requestRender();
        },
        () => {
          // an image that does not decode leaves its faces in their colour
          if (serial === this.serial) this.loading.delete(idx);
        },
      );
      this.track(idx, done);
    }
  }

  /** Keeps a texture's decode for ensureTextures until it settles. */
  private track(idx: number, done: Promise<void>): void {
    const settled = done.finally(() => {
      if (this.decoding.get(idx) === settled) this.decoding.delete(idx);
    });
    this.decoding.set(idx, settled);
  }
}

/**
 * Texture coordinates an object gives itself (fractions of the image, v up) for the texture: the
 * image bitmaps aren't flipped, so their first row, the image's top, is at v = 0.
 */
function ownUvs(uvs: Float32Array, out: Float32Array): void {
  for (let i = 0; i + 1 < uvs.length; i += 2) {
    out[i] = uvs[i];
    out[i + 1] = 1 - uvs[i + 1];
  }
}

/** Average colour of the middle of an image (where a texture preview shows its swatch), or null. */
function averageColour(bitmap: ImageBitmap): THREE.Color | null {
  const size = 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { width: w, height: h } = bitmap;
  ctx.drawImage(bitmap, w * 0.3, h * 0.3, w * 0.4, h * 0.4, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    r += px[i];
    g += px[i + 1];
    b += px[i + 2];
    n++;
  }
  return n ? new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace) : null;
}

/**
 * Each triangle's normal on its three corners, a byte per component. Flat shading has no use for
 * them, but a receiving face looks its shadow up a little along its normal, and without one that
 * lookup comes to nothing.
 */
function faceNormals(positions: Float32Array): THREE.BufferAttribute {
  const out = new Int8Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ux = positions[i + 3] - positions[i], uy = positions[i + 4] - positions[i + 1], uz = positions[i + 5] - positions[i + 2];
    const vx = positions[i + 6] - positions[i], vy = positions[i + 7] - positions[i + 1], vz = positions[i + 8] - positions[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    // a sliver gets straight up rather than nothing
    const [x, y, z] = len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
    for (let k = 0; k < 9; k += 3) {
      out[i + k] = Math.round(x * 127);
      out[i + k + 1] = Math.round(y * 127);
      out[i + k + 2] = Math.round(z * 127);
    }
  }
  return new THREE.BufferAttribute(out, 3, true);
}

/**
 * Lit, double-sided faces with flat normals. The polygon offset keeps the edge lines on top; a
 * recessed face (a wall's) sits a little further back, so a face lying on it (a door frame) wins.
 */
/** A light object as three.js lights it: the light, and the target a spot or directional one aims at. */
/**
 * The light objects to light the view with: every directional one, then the nearest to `target` of
 * each other kind, MAX_LAMPS in all. How many of each kind there are is set by the lights, not by
 * where the view looks (each kind has its share of the places by how many of it there are), so
 * moving the view never changes it: three.js compiles every material's shader again for another
 * count of lights of a kind, seconds in a large model.
 */
function nearestLamps(lights: readonly Light3D[], target: THREE.Vector3): Light3D[] {
  if (lights.length <= MAX_LAMPS) return [...lights];
  const byKind = new Map<Light3D["kind"], Light3D[]>();
  for (const l of lights) {
    const list = byKind.get(l.kind);
    if (list) list.push(l);
    else byKind.set(l.kind, [l]);
  }
  const out = (byKind.get("directional") ?? []).slice(0, MAX_LAMPS);
  const kinds = [...byKind].filter(([kind]) => kind !== "directional").map(([, list]) => list);
  const places = MAX_LAMPS - out.length;
  const others = kinds.reduce((n, list) => n + list.length, 0);
  // shares by the largest remainder: whole places first, then one each to the largest fractions
  const exact = kinds.map((list) => (places * list.length) / Math.max(1, others));
  const counts = exact.map(Math.floor);
  let left = places - counts.reduce((a, b) => a + b, 0);
  for (const i of exact.map((_, i) => i).sort((a, b) => exact[b] - counts[b] - (exact[a] - counts[a]))) {
    if (left-- <= 0) break;
    counts[i]++;
  }
  kinds.forEach((list, i) => {
    const near = list.map((l) => ({ l, d: target.distanceToSquared(new THREE.Vector3(...l.position)) })).sort((a, b) => a.d - b.d);
    out.push(...near.slice(0, counts[i]).map((x) => x.l));
  });
  return out;
}

function lamp(l: Light3D, gain: number): THREE.Object3D[] {
  const color = new THREE.Color(l.color);
  const at = new THREE.Vector3(...l.position);
  const aim = new THREE.Vector3(...l.direction);
  if (l.kind === "point") {
    const light = new THREE.PointLight(color, LAMP_CANDELA * l.brightness * gain, 0, 2);
    light.position.copy(at);
    return [light];
  }
  const light =
    l.kind === "spot"
      ? new THREE.SpotLight(color, LAMP_CANDELA * l.brightness * gain, 0, Math.min(l.spread / 2, Math.PI / 2), l.spread > 0 ? 1 - l.beam / l.spread : 0, 2)
      : new THREE.DirectionalLight(color, SUN_INTENSITY * l.brightness);
  // a directional light shines the same way everywhere: from anywhere back along its direction
  if (l.kind === "spot") light.position.copy(at);
  else light.position.copy(aim).negate();
  light.target.position.copy(light.position).add(aim);
  return [light, light.target];
}

/**
 * Lets a light object cast shadows on `box`, the visible model. A directional one shines the same way
 * from anywhere, so it stands back beyond the model with its shadow camera round it, as the sun does;
 * a spot's or point light's camera reaches from the lamp to the far side of it, its shadows sharpest
 * where the view looks, `look`. They are drawn once, and again when what the model shows changes
 * (staleShadows), not as the view moves.
 */
function lampShadow(light: THREE.SpotLight | THREE.PointLight | THREE.DirectionalLight, box: THREE.Box3, look: THREE.Vector3, mapSize: (base: number) => number): void {
  const shadow = light.shadow;
  light.castShadow = true;
  shadow.autoUpdate = false;
  shadow.needsUpdate = true;
  shadow.bias = -0.0003;
  if (light instanceof THREE.DirectionalLight) {
    const centre = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 500);
    const aim = light.target.position.clone().sub(light.position).normalize();
    light.position.copy(centre).addScaledVector(aim, -2 * radius);
    light.target.position.copy(centre);
    const reach = radius * 1.1;
    const cam = light.shadow.camera;
    cam.left = -reach;
    cam.right = reach;
    cam.top = reach;
    cam.bottom = -reach;
    cam.near = 2 * radius - reach;
    cam.far = 2 * radius + reach;
    cam.updateProjectionMatrix();
    const size = mapSize(LAMP_SHADOW_MAP);
    shadow.mapSize.set(size, size);
    // about a texel and a half along the normal, against shadow acne
    shadow.normalBias = (reach * 3) / size;
    return;
  }
  const at = light.position;
  let far = 0;
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) far = Math.max(far, at.distanceTo(new THREE.Vector3(x, y, z)));
  }
  const map = mapSize(light instanceof THREE.PointLight ? POINT_SHADOW_MAP : LAMP_SHADOW_MAP);
  shadow.mapSize.set(map, map);
  // a point light's six cameras each look 45° either way
  let half = Math.PI / 4;
  if (light instanceof THREE.SpotLight) {
    light.shadow.focus = Math.min(1, SPOT_SHADOW_HALF_ANGLE / Math.max(light.angle, 1e-6));
    half = light.angle * light.shadow.focus;
  }
  shadow.camera.far = far * 1.05 + 1;
  shadow.camera.near = Math.max(10, shadow.camera.far / 2000);
  // about a texel and a half along the normal where the view looks (a metre off at least), against shadow acne
  shadow.normalBias = (1.5 * 2 * Math.max(1000, at.distanceTo(look)) * Math.tan(half)) / map;
}

function faceMaterial(color: string, opacity: number, recessed: boolean): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    side: THREE.DoubleSide,
    flatShading: true,
    polygonOffset: true,
    polygonOffsetFactor: recessed ? 2 : 1,
    polygonOffsetUnits: recessed ? 4 : 1,
  });
}

/** An unlit white (or `color`) face for the hidden-line modes, set back as faceMaterial sets its faces. */
function hiddenMaterial(recessed: boolean, color = 0xffffff): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: recessed ? 2 : 1,
    polygonOffsetUnits: recessed ? 4 : 1,
  });
}

/**
 * Three's dashed line shader stepping through a dash style's dashes and gaps (`dashes`, `dashCount`
 * of them, alternating) instead of one dash and one gap; as it was when its test isn't found.
 */
function dashedShader(fragment: string): string {
  const test = /if \( mod\( vLineDistance, totalSize \) > dashSize \) \{\s*discard;\s*\}/;
  if (!test.test(fragment)) return fragment;
  return fragment.replace("uniform float dashSize;", `uniform float dashSize;\nuniform float dashes[ ${MAX_DASHES} ];\nuniform int dashCount;`).replace(
    test,
    `float along = mod( vLineDistance, totalSize );
	for ( int i = 0; i < ${MAX_DASHES}; i ++ ) {
		if ( i >= dashCount ) break;
		if ( along < dashes[ i ] ) {
			if ( i % 2 == 1 ) discard;
			break;
		}
		along -= dashes[ i ];
	}`,
  );
}

/**
 * One pass of Sketch's pencil: the edge lines with each end moved on screen by up to `px` CSS px,
 * in a direction hashed from where it is in the model and the pass, so a corner's two edges keep
 * meeting, a stroke stays put as the view turns, and the passes differ. `userData.px` is a CSS
 * pixel in clip space, which the view sets as it resizes.
 */
function sketchMaterial(px: number, pass: number): THREE.LineBasicMaterial {
  const m = new THREE.LineBasicMaterial({ color: PENCIL, transparent: true, opacity: 0.8 });
  const pixel = new THREE.Vector2(0.002, 0.002);
  m.userData.px = pixel;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.sketchPx = { value: pixel };
    shader.uniforms.sketchWobble = { value: px };
    shader.uniforms.sketchPass = { value: pass * 17.31 + 3.7 };
    shader.vertexShader = shader.vertexShader
      .replace(
        "void main() {",
        `uniform vec2 sketchPx;
uniform float sketchWobble;
uniform float sketchPass;
vec2 sketchHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973) + sketchPass);
  p += dot(p, p.yxz + 33.33);
  return fract((p.xx + p.yz) * p.zy) * 2.0 - 1.0;
}
void main() {`,
      )
      .replace("#include <project_vertex>", "#include <project_vertex>\n\tgl_Position.xy += sketchHash(position * 0.37) * sketchWobble * sketchPx * gl_Position.w;");
  };
  return m;
}

/** Points (3 floats each) as a geometry to draw, as triangles or as line segments. */
function pointsGeometry(xyz: Float32Array): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(xyz, 3));
  return geometry;
}

/** Writes the vertices of the runs whose object is visible into `index`; returns how many were written. */
function fillIndex(runs: readonly Run[], index: THREE.BufferAttribute, width: number, visible: Uint8Array): number {
  const array = index.array as Uint32Array;
  let n = 0;
  for (const run of runs) {
    if (visible[run.obj] === 0) continue;
    const end = run.end * width;
    for (let v = run.start * width; v < end; v++) array[n++] = v;
  }
  index.needsUpdate = true;
  return n;
}

/**
 * The distance along the edges at each end of each segment (two points each), for the dashes: on
 * from the segment before where it starts at that one's end (a curve's pieces), else from 0.
 * three's own (computeLineDistances) leaves indexed segments without them, so they drew solid.
 */
function lineDistances(p: ArrayLike<number>): THREE.BufferAttribute {
  const n = Math.floor(p.length / 6) * 2;
  const d = new Float32Array(p.length / 3);
  for (let v = 0; v < n; v += 2) {
    const a = v * 3;
    const joined = v > 0 && p[a] === p[a - 3] && p[a + 1] === p[a - 2] && p[a + 2] === p[a - 1];
    d[v] = joined ? d[v - 1] : 0;
    d[v + 1] = d[v] + Math.hypot(p[a + 3] - p[a], p[a + 4] - p[a + 1], p[a + 5] - p[a + 2]);
  }
  return new THREE.BufferAttribute(d, 1);
}

/** The run that holds item `item` (a triangle or segment number), or null. Runs are sorted by start. */
function findRun(runs: readonly Run[], item: number): Run | null {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const run = runs[mid];
    if (item < run.start) hi = mid - 1;
    else if (item >= run.end) lo = mid + 1;
    else return run;
  }
  return null;
}

/**
 * Texture coordinates by box projection: each triangle is projected along its
 * dominant normal axis, and u/v are the other two world coordinates over the image size.
 * `tris` holds 9 floats per triangle, `out` gets 6.
 */
function boxUvs(tris: Float32Array, out: Float32Array, size: number): void {
  for (let t = 0, o = 0; t < tris.length; t += 9, o += 6) {
    const ux = tris[t + 3] - tris[t];
    const uy = tris[t + 4] - tris[t + 1];
    const uz = tris[t + 5] - tris[t + 2];
    const vx = tris[t + 6] - tris[t];
    const vy = tris[t + 7] - tris[t + 1];
    const vz = tris[t + 8] - tris[t + 2];
    const nx = Math.abs(uy * vz - uz * vy);
    const ny = Math.abs(uz * vx - ux * vz);
    const nz = Math.abs(ux * vy - uy * vx);
    let iu = 0; // dominant z: x and y
    let iv = 1;
    if (nx >= ny && nx >= nz) {
      iu = 1; // dominant x: y and z
      iv = 2;
    } else if (ny >= nz) {
      iu = 0; // dominant y: x and z
      iv = 2;
    }
    for (let k = 0; k < 3; k++) {
      out[o + 2 * k] = tris[t + 3 * k + iu] / size;
      out[o + 2 * k + 1] = tris[t + 3 * k + iv] / size;
    }
  }
}

function releaseTexture(tex: THREE.Texture): void {
  if (tex.image instanceof ImageBitmap) tex.image.close();
  tex.dispose();
}
