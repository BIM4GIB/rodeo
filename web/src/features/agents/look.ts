// How the agents see the drawing: the plan drawn offscreen at a chosen size and place (the
// user's own view isn't moved), the 3D view from a direction, an eye or a camera, and renders
// through File > Export > Render Image's engines. Pictures come back as JPEG data URLs small
// enough to send to a model, with what they show, so the model can measure from them.

import * as THREE from "three";
import type { AppContext } from "../../app/ext.ts";
import { Renderer } from "../../app/renderer.ts";
import { setViz, store, type DisplayMode } from "../../app/state.ts";
import type { ToolOverlay } from "../../app/tools.ts";
import { View } from "../../app/view.ts";
import type { RenderMode, ViewPreset } from "../../app/view3d.ts";
import type { BBox, Vec3 } from "../../core/index.ts";
import type { Mesh3D } from "../../core/types.ts";
import { boundsOfAll } from "../plugins/dispatch.ts";
import { checkSolids } from "./check3d.ts";

export interface Picture {
  /** a JPEG data URL, at most `max` px a side */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** what it shows, for the model */
  readonly caption: string;
  /** the full picture, when it is larger than what the model is sent (renders) */
  readonly full?: Blob;
}

const NO_TOOLS: ToolOverlay = { moveDelta: () => null, fillPreview: () => null, drawOverlay: () => {} };
const NONE: ReadonlySet<string> = new Set<string>();
/** the longest side of a picture sent to a model */
export const MODEL_SIDE = 1280;
const JPEG = 0.86;

function round(v: number): number {
  return Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 100) / 100;
}

/** A canvas's picture scaled to fit `max` px, as a JPEG data URL. */
export function canvasPicture(source: HTMLCanvasElement | HTMLImageElement | ImageBitmap, w: number, h: number, max = MODEL_SIDE): { url: string; width: number; height: number } {
  const k = Math.min(1, max / Math.max(w, h));
  const W = Math.max(1, Math.round(w * k));
  const H = Math.max(1, Math.round(h * k));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, H);
  g.imageSmoothingQuality = "high";
  g.drawImage(source, 0, 0, W, H);
  return { url: c.toDataURL("image/jpeg", JPEG), width: W, height: H };
}

/** A picture (a render's blob, an attachment) scaled for a model. */
export async function blobPicture(blob: Blob, max = MODEL_SIDE): Promise<{ url: string; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  try {
    return canvasPicture(bmp, bmp.width, bmp.height, max);
  } finally {
    bmp.close();
  }
}

export interface PlanLook {
  /** world box to show (mm); the drawing's extent, or the user's view, when left out */
  readonly box?: BBox;
  /** objects to fit (their bounds); wins over box */
  readonly ids?: readonly string[];
  /** "view": what the user sees now; "extent": everything drawn; the default is extent */
  readonly frame?: "view" | "extent";
  /** a layer to draw on its own, else the layers the editor draws now */
  readonly layerId?: string;
  /** picture size in px (its longest side, default 1280) */
  readonly size?: number;
  /** draw the selection highlighted, as the editor does */
  readonly showSelection?: boolean;
}

/** The plan drawn offscreen as the editor draws it, at `look`'s place. */
export function lookPlan(ctx: AppContext, look: PlanLook): Picture {
  const s = store;
  if (!s.session) throw new Error("no drawing is open");
  const scene = ctx.scene;
  const layerId = look.layerId ?? null;
  if (layerId && !scene.layer(layerId)) throw new Error(`no layer has the id ${layerId}`);
  const active = layerId ?? s.activeLayerId;
  let box: BBox | null = null;
  if (look.ids?.length) {
    box = boundsOfAll(s.session.doc, look.ids);
    if (!box) throw new Error("none of those objects has a place in the plan");
  } else if (look.box) {
    box = look.box;
  } else if (look.frame === "view") {
    box = ctx.view.visibleRect();
  } else {
    box = scene.drawnBounds(active) ?? ctx.view.visibleRect();
  }
  if (![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite)) throw new Error("the box isn't finite");
  const bw = Math.max(box.x1 - box.x0, 1e-6);
  const bh = Math.max(box.y1 - box.y0, 1e-6);
  const side = Math.min(2048, Math.max(256, Math.round(look.size ?? MODEL_SIDE)));
  const W = bw >= bh ? side : Math.max(64, Math.round((side * bw) / bh));
  const H = bw >= bh ? Math.max(64, Math.round((side * bh) / bw)) : side;
  const canvas = document.createElement("canvas");
  const view = new View();
  const renderer = new Renderer(canvas, view, scene, NO_TOOLS);
  const saved = { activeLayerId: s.activeLayerId, layerMode: s.layerMode, selection: s.selection, preselect: s.preselect, editVertex: s.editVertex, showGrid: s.showGrid };
  const pad = look.ids?.length ? 0.08 : 0.02;
  try {
    if (layerId) {
      s.activeLayerId = layerId;
      s.layerMode = "active-only" satisfies DisplayMode;
    }
    if (!look.showSelection) s.selection = NONE;
    s.preselect = null;
    s.editVertex = null;
    s.showGrid = false;
    view.setSize(W, H);
    view.fit(box, pad);
    renderer.renderNow(W, H, 1);
  } finally {
    Object.assign(s, saved);
  }
  const shown = view.visibleRect();
  const pic = canvasPicture(canvas, W, H, side);
  const mmPerPx = (shown.x1 - shown.x0) / W;
  const layer = layerId ? scene.layer(layerId)?.name : null;
  return {
    ...pic,
    caption:
      `Plan${layer ? ` of layer "${layer}"` : ""}, ${W}×${H} px: x ${round(shown.x0)} to ${round(shown.x1)}, y ${round(shown.y0)} to ${round(shown.y1)} ` +
      `(world mm; x right, y up; 1 px ≈ ${round(mmPerPx)} mm).`,
  };
}

export interface ModelLook {
  readonly preset?: ViewPreset;
  readonly eye?: Vec3;
  readonly target?: Vec3;
  /** a Renderworks camera's id: look through it */
  readonly cameraId?: string;
  /** the perspective's view angle, degrees from the picture's top to its bottom */
  readonly lens?: number;
  readonly mode?: RenderMode;
  readonly size?: number;
  /** each solid's holes filled magenta and their rims drawn magenta */
  readonly holes?: boolean;
}

const wait = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

/** what look_3d's holes fills each hole and draws its rim in */
const HOLE_COLOR = 0xff1493;

/**
 * Each layer's holes (check3d.ts) as magenta patches, fanned from the middle of each rim to its
 * edges, and the rims as magenta lines, to show in the 3D view with that layer.
 */
function holePatches(meshes: readonly Mesh3D[]): { layer: string; obj: THREE.Group; holes: number }[] {
  const byLayer = new Map<string, Mesh3D[]>();
  for (const m of meshes) {
    const list = byLayer.get(m.layerId);
    if (list) list.push(m);
    else byLayer.set(m.layerId, [m]);
  }
  const out: { layer: string; obj: THREE.Group; holes: number }[] = [];
  for (const [layer, list] of byLayer) {
    const fan: number[] = [];
    const rims: number[] = [];
    let holes = 0;
    for (const { closure } of checkSolids(list).solids) {
      for (const h of closure.holes) {
        holes++;
        const r = h.rim;
        const c = [0, 0, 0];
        for (let i = 0; i < r.length; i += 3) for (let k = 0; k < 3; k++) c[k] += r[i + k] / (r.length / 3);
        for (let i = 0; i < r.length; i += 6) fan.push(c[0], c[1], c[2], r[i], r[i + 1], r[i + 2], r[i + 3], r[i + 4], r[i + 5]);
        rims.push(...r);
      }
    }
    if (!holes) continue;
    const obj = new THREE.Group();
    const faces = new THREE.BufferGeometry();
    faces.setAttribute("position", new THREE.Float32BufferAttribute(fan, 3));
    // drawn a little in front, over any face lying in the same plane
    obj.add(new THREE.Mesh(faces, new THREE.MeshBasicMaterial({ color: HOLE_COLOR, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    const lines = new THREE.BufferGeometry();
    lines.setAttribute("position", new THREE.Float32BufferAttribute(rims, 3));
    obj.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: HOLE_COLOR })));
    out.push({ layer, obj, holes });
  }
  return out;
}

/** The 3D view, shown and pointed as `look` says, as a picture. The user sees it move. */
export async function lookModel(ctx: AppContext, look: ModelLook): Promise<Picture> {
  const s = store.session;
  if (!s) throw new Error("no drawing is open");
  const view = await ctx.show3d();
  if (!view) throw new Error("the 3D view isn't available in this browser (no WebGL)");
  if (look.mode && look.mode !== ctx.renderMode()) ctx.setRenderMode(look.mode);
  // the realistic engines draw only the model, without the patches
  if (look.holes && (ctx.renderMode() === "realistic" || ctx.renderMode() === "pathtraced")) ctx.setRenderMode("shaded");
  // an eye's distance means nothing to an orthographic view (a layer's saved view is often one), and a
  // camera is looked through in perspective: from an eye or a camera, the view is a perspective
  if ((look.cameraId || (look.eye && look.target)) && store.viz3d.projection !== "perspective") setViz({ projection: "perspective" });
  if (look.lens !== undefined && Number.isFinite(look.lens)) setViz({ lens: Math.min(120, Math.max(5, look.lens)) });
  if (look.cameraId) {
    const cam = s.doc.cameras().find((c) => c.id === look.cameraId);
    if (!cam) throw new Error(`the drawing has no camera ${look.cameraId}`);
    view.lookThrough(cam.eye, cam.target, cam.viewAngle, cam.aspect);
  } else if (look.eye && look.target) {
    view.lookFrom({ x: look.eye[0], y: look.eye[1], z: look.eye[2] }, { x: look.target[0], y: look.target[1], z: look.target[2] });
  } else if (look.preset) {
    view.setView(look.preset);
  }
  await view.ensureTextures();
  // the realistic modes load their engine with their first frame, and the path tracer adds samples frame by frame
  const realistic = ctx.renderMode() === "realistic" || ctx.renderMode() === "pathtraced";
  const patches = look.holes ? holePatches(s.doc.model3d()) : [];
  for (const p of patches) view.addContent(p.obj, p.layer);
  let pic: { url: string; width: number; height: number };
  try {
    view.renderNow();
    if (realistic) {
      for (let i = 0; i < 12; i++) {
        await wait(150);
        view.renderNow();
      }
    }
    const canvas = view.domElement;
    view.renderNow();
    pic = canvasPicture(canvas, canvas.width, canvas.height, Math.min(2048, Math.max(256, look.size ?? MODEL_SIDE)));
  } finally {
    for (const p of patches) {
      view.removeContent(p.obj);
      p.obj.traverse((o) => {
        if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
    if (patches.length) view.renderNow();
  }
  const cam = view.activeCamera;
  const target = view.orbitTarget;
  const v = (x: number, y: number, z: number): string => `[${round(x)}, ${round(y)}, ${round(z)}]`;
  return {
    ...pic,
    caption:
      `3D view (${ctx.renderMode()}, ${projectionNote()}), eye ${v(cam.position.x, cam.position.y, cam.position.z)} looking at ${v(target.x, target.y, target.z)} (world mm, z up).` +
      (look.holes ? holesNote(patches.reduce((n, p) => n + p.holes, 0)) : ""),
  };
}

/** The 3D view's projection as a caption says it: a perspective's lens, or why an eye's distance doesn't show. */
function projectionNote(): string {
  const v = store.viz3d;
  return v.projection === "perspective" ? `perspective, ${round(v.lens)}° lens` : `${v.projection}: moving the eye nearer doesn't enlarge it; give an eye and target for a perspective`;
}

const holesNote = (n: number): string =>
  n ? ` ${n} hole${n === 1 ? " is" : "s are"} filled magenta, ${n === 1 ? "its rim" : "their rims"} drawn magenta (where the model has holes, wherever this view is pointed).` : " No solid has a hole.";

export interface RenderLook {
  readonly cameraId?: string;
  readonly preset?: ViewPreset;
  readonly eye?: Vec3;
  readonly target?: Vec3;
  readonly lens?: number;
  readonly width: number;
  readonly height: number;
  readonly engine: "realistic" | "pathtraced";
  readonly samples: number;
  readonly minutes: number;
  readonly signal: AbortSignal;
  readonly progress: (text: string) => void;
}

/** A finished render (Render Image's engines and the Render palette's settings), with a copy small enough for a model. */
export async function renderLook(ctx: AppContext, look: RenderLook): Promise<Picture> {
  if (!look.cameraId && (look.preset || (look.eye && look.target) || look.lens !== undefined)) await lookModel(ctx, { preset: look.preset, eye: look.eye, target: look.target, lens: look.lens });
  // shown already or not, show3d gives the view the edits made so far
  else await ctx.show3d();
  const { renderPicture } = await import("../render/finalRender.ts");
  const result = await renderPicture({
    cameraId: look.cameraId ?? null,
    width: look.width,
    height: look.height,
    engine: look.engine,
    samples: look.samples,
    minutes: look.minutes,
    format: "png",
    signal: look.signal,
    onProgress: (text) => look.progress(text),
  });
  if (!result) throw new Error("no picture was made (the 3D view may not be available here)");
  const pic = await blobPicture(result.blob);
  return {
    ...pic,
    full: result.blob,
    caption: `${result.engine} render of ${result.name}, ${result.width}×${result.height} px${result.samples ? `, ${result.samples} samples` : ""}, ${Math.round(result.seconds)} s.`,
  };
}
