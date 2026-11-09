// The 3D view's AI mode (live.ts draws it): the Realistic picture while the view moves; once it has
// rested a moment on a view it has no painting of, that picture goes to the server's image model
// (ai.ts) and the painting fades in over it, framed to the model's nearest aspect (the rest of the
// view stays Realistic). A move hides it at once; the last few paintings are kept by view, so going
// back to one shows it again without painting. Auto paints at each rest, up to AUTO_LIMIT pictures
// a session before it pauses; Paint now (the palette, through bridge.ts) paints the view as it is.
// Loaded with live.ts, with three.js.

import * as THREE from "three";
import { currentUser } from "../../platform/api.ts";
import { errorMessage } from "../../app/toast.ts";
import { creditTerms, formatCredit } from "../account/credit.ts";
import { AI_STYLES, AiFailure, aspectOf, paintPicture } from "./ai.ts";
import { publishAiLive, publishStatus, type AiPicture } from "./bridge.ts";
import type { RenderSettings } from "./settings.ts";

/** how long the view rests before it is painted */
export const REST_MS = 1200;
const FADE_MS = 450;
/** paintings Auto makes in a session before it pauses (Paint now goes on) */
const AUTO_LIMIT = 30;
/** paintings kept, the latest views' */
const KEEP = 8;
/** the longest side of the picture sent */
const SEND_SIDE = 1536;
/** after the provider says it is busy, the time before Auto tries the same view again */
const BUSY_MS = 20_000;

/** The part of the view a painting covers, as fractions of its width and height from the top left. */
interface Crop {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface Painting {
  /** the view it was painted from: the camera, the size, the scene and the settings */
  readonly key: string;
  readonly texture: THREE.Texture;
  readonly crop: Crop;
  readonly picture: AiPicture;
  /** when it first showed, for its fade; 0 before */
  shownAt: number;
}

export class AiLive {
  private readonly redraw: () => void;
  private kept: Painting[] = [];
  /** the painting under way, for the view of `key` */
  private pending: { readonly key: string; readonly stop: AbortController } | null = null;
  /** the view last sent, so a refusal isn't asked again at once */
  private asked = "";
  /** Paint now: the next frame is painted whatever Auto says */
  private now = false;
  private paused = false;
  private failure: string | null = null;
  private autoCount = 0;
  private pictures = 0;
  private spent = 0;
  private restTimer = 0;
  private quad: { readonly scene: THREE.Scene; readonly camera: THREE.OrthographicCamera; readonly mesh: THREE.Mesh; readonly material: THREE.MeshBasicMaterial } | null = null;
  /** the latest painting shown, for Open picture */
  private latest: Painting | null = null;

  constructor(redraw: () => void) {
    this.redraw = redraw;
    publishAiLive({
      paintNow: () => {
        this.now = true;
        this.paused = false;
        this.failure = null;
        this.redraw();
      },
      picture: () => this.latest?.picture ?? null,
    });
  }

  /**
   * After live.ts has drawn the Realistic picture for the view of `key`, which has rested `restedMs`:
   * lays its painting over it, or sends it to be painted. True asks for another frame (a fade).
   */
  draw(renderer: THREE.WebGLRenderer, key: string, restedMs: number, settings: RenderSettings): boolean {
    // a painting of another view is no use any more
    if (this.pending && this.pending.key !== key) this.stop();
    // Paint now while this view is being painted already: that painting is the one asked for
    if (this.now && this.pending) this.now = false;
    const shown = this.kept.find((p) => p.key === key) ?? null;
    if (shown && !this.now) {
      const now = performance.now();
      if (shown.shownAt === 0) shown.shownAt = now;
      const opacity = Math.min(1, (now - shown.shownAt) / FADE_MS);
      this.lay(renderer, shown, opacity);
      this.latest = shown;
      this.status("shown");
      return opacity < 1;
    }
    if (this.now || (restedMs >= REST_MS && settings.ai.auto && !this.paused && this.asked !== key && this.pending === null)) {
      const manual = this.now;
      this.now = false;
      this.start(renderer, key, settings, manual);
    } else if (restedMs < REST_MS) {
      // the view moved: once it has rested, the next frame is painted
      window.clearTimeout(this.restTimer);
      this.restTimer = window.setTimeout(this.redraw, REST_MS - restedMs + 20);
    }
    this.status(this.pending ? "painting" : restedMs < REST_MS ? "moving" : "resting");
    return false;
  }

  /** Another mode draws: a painting under way stops (what is kept stays for coming back). */
  idle(): void {
    this.stop();
    window.clearTimeout(this.restTimer);
  }

  dispose(): void {
    this.idle();
    for (const p of this.kept) p.texture.dispose();
    this.kept = [];
    this.quad?.material.dispose();
    this.quad?.mesh.geometry.dispose();
    publishAiLive(null);
  }

  private stop(): void {
    this.pending?.stop.abort();
    this.pending = null;
  }

  /** Sends the frame just drawn to be painted. */
  private start(renderer: THREE.WebGLRenderer, key: string, settings: RenderSettings, manual: boolean): void {
    if (!manual && this.autoCount >= AUTO_LIMIT) {
      this.paused = true;
      return;
    }
    this.asked = key;
    if (!currentUser()) {
      this.failure = "Sign in to paint the view: Paint now";
      return;
    }
    // read from the canvas now, while it holds this frame
    const { canvas, crop } = grab(renderer.domElement);
    const stop = new AbortController();
    this.pending = { key, stop };
    this.failure = null;
    if (!manual) this.autoCount++;
    const style = settings.ai.style;
    void (async () => {
      try {
        const before = await new Promise<Blob>((done, fail) => canvas.toBlob((b) => (b ? done(b) : fail(new Error("the view couldn't be read"))), "image/png"));
        const painted = await paintPicture(before, { style, words: settings.ai.words, strength: settings.ai.strength, live: true, signal: stop.signal });
        const bitmap = await createImageBitmap(painted.blob, { imageOrientation: "flipY" });
        if (stop.signal.aborted) {
          bitmap.close();
          return;
        }
        const texture = new THREE.Texture(bitmap);
        texture.flipY = false;
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        const picture: AiPicture = { blob: painted.blob, before, width: bitmap.width, height: bitmap.height, note: AI_STYLES.find((s) => s.id === style)?.label ?? "" };
        this.keep({ key, texture, crop, picture, shownAt: 0 });
        this.pictures++;
        this.spent += painted.charged ?? 0;
      } catch (err) {
        if (stop.signal.aborted) return;
        this.failure = err instanceof AiFailure ? err.message : `Couldn't paint the view: ${errorMessage(err)}`;
        // signing in and credit need the person: Auto waits for Paint now
        if (err instanceof AiFailure && (err.kind === "signin" || err.kind === "credit")) this.paused = true;
        if (err instanceof AiFailure && err.kind === "busy") {
          window.setTimeout(() => {
            if (this.asked !== key) return;
            this.asked = "";
            this.redraw();
          }, BUSY_MS);
        }
      } finally {
        if (this.pending?.stop === stop) this.pending = null;
        this.redraw();
      }
    })();
  }

  private keep(p: Painting): void {
    this.kept = [p, ...this.kept.filter((k) => k.key !== p.key)];
    for (const old of this.kept.splice(KEEP)) old.texture.dispose();
  }

  /** Lays `p` over the frame at `opacity`, in the part of the view it was painted from. */
  private lay(renderer: THREE.WebGLRenderer, p: Painting, opacity: number): void {
    if (!this.quad) {
      const material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
      const scene = new THREE.Scene();
      scene.add(mesh);
      // x right and y up across the view, 0 to 1
      this.quad = { scene, camera: new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1), mesh, material };
    }
    const { scene, camera, mesh, material } = this.quad;
    if (material.map !== p.texture) {
      material.map = p.texture;
      material.needsUpdate = true;
    }
    material.opacity = opacity;
    mesh.scale.set(p.crop.w, p.crop.h, 1);
    mesh.position.set(p.crop.x + p.crop.w / 2, 1 - (p.crop.y + p.crop.h / 2), 0);
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    renderer.autoClear = autoClear;
  }

  /** The palette's line under the modes. */
  private status(state: "shown" | "painting" | "moving" | "resting"): void {
    if (state === "painting") return publishStatus("AI · painting the view…");
    if (state === "shown") return publishStatus(`AI · ${this.tally()}`);
    if (this.failure) return publishStatus(`AI · ${this.failure}`);
    if (this.paused && this.autoCount >= AUTO_LIMIT) return publishStatus(`AI · paused after ${AUTO_LIMIT} pictures: Paint now goes on`);
    if (state === "moving") return publishStatus("AI · paints when the view rests");
    publishStatus(this.pictures ? `AI · ${this.tally()} · Paint now for this view` : "AI · Paint now to paint this view");
  }

  /** "3 pictures · £0.12 this session" */
  private tally(): string {
    const credit = creditTerms();
    const cost = this.spent > 0 && credit ? ` · ${formatCredit(this.spent, credit.currency)} this session` : "";
    return `${this.pictures} ${this.pictures === 1 ? "picture" : "pictures"}${cost}`;
  }
}

/**
 * The view's canvas as it is this frame, cropped to the image models' nearest aspect about its
 * middle and no more than SEND_SIDE px a side, and the part of the view that is.
 */
function grab(source: HTMLCanvasElement): { canvas: HTMLCanvasElement; crop: Crop } {
  const W = source.width;
  const H = source.height;
  const [aw, ah] = aspectOf(W, H).split(":").map(Number);
  const ratio = aw / ah;
  const cw = W / H > ratio ? H * ratio : W;
  const ch = W / H > ratio ? H : W / ratio;
  const cx = (W - cw) / 2;
  const cy = (H - ch) / 2;
  const scale = Math.min(1, SEND_SIDE / Math.max(cw, ch));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cw * scale));
  canvas.height = Math.max(1, Math.round(ch * scale));
  canvas.getContext("2d")?.drawImage(source, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  return { canvas, crop: { x: cx / W, y: cy / H, w: cw / W, h: ch / H } };
}
