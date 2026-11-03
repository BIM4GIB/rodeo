// Animated view changes (Edit > Preferences… > Interactive, "Animate view transitions"), as
// Vectorworks animates them: Fit, Zoom to Selection, saved views and Previous/Next View move the
// plan there over the time set, with the motion chosen, rather than jumping. The zoom changes
// evenly in steps of scale, so zooming far in or out doesn't rush at either end; any pan or zoom
// by hand stops a move in progress where it is.

import { prefs, type ViewMotion } from "./prefs.ts";
import { store } from "./state.ts";
import type { View } from "./view.ts";

const EASE: Record<ViewMotion, (t: number) => number> = {
  decelerate: (t) => 1 - (1 - t) ** 3,
  accelerate: (t) => t ** 3,
  smooth: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
  linear: (t) => t,
};

/** the move in progress, cancelled by bumping */
let moving = 0;
/** what to run when the move in progress ends */
let ending: (() => void) | null = null;

function finish(): void {
  const fn = ending;
  ending = null;
  fn?.();
}

/** Stops a move in progress where it is (a pan or zoom by hand takes over). */
export function stopGlide(): void {
  moving++;
  finish();
}

/**
 * Moves `view` to where `change` puts it: over the time Preferences set when view transitions are
 * animated, else at once. Each step redraws ("view"); the last lands exactly where `change` did.
 * `done` runs once the move ends, finished or stopped.
 */
export function glide(view: View, change: () => void, done?: () => void): void {
  stopGlide();
  const id = moving;
  const from = { cx: view.cx, cy: view.cy, scale: view.scale, rotation: view.rotation };
  change();
  const to = { cx: view.cx, cy: view.cy, scale: view.scale, rotation: view.rotation };
  // a plan being rotated turns the short way round
  const turn = Math.atan2(Math.sin(to.rotation - from.rotation), Math.cos(to.rotation - from.rotation));
  const p = prefs();
  const still = Math.abs(to.scale / from.scale - 1) < 1e-6 && Math.hypot(to.cx - from.cx, to.cy - from.cy) * to.scale < 0.5 && turn === 0;
  if (!p.animateViews || p.viewSeconds <= 0 || still || typeof requestAnimationFrame !== "function") {
    store.emit("view");
    done?.();
    return;
  }
  ending = done ?? null;
  const ease = EASE[p.viewMotion];
  const ratio = to.scale / from.scale;
  const start = performance.now();
  const step = (now: number): void => {
    if (id !== moving) return;
    const t = Math.min(1, (now - start) / (p.viewSeconds * 1000));
    if (t >= 1) {
      view.setCenterAndScale(to.cx, to.cy, to.scale);
      view.rotation = to.rotation;
    } else {
      const e = ease(t);
      const scale = from.scale * ratio ** e;
      view.rotation = from.rotation + turn * e;
      // the centre moves in step with the zoom, so the two ends stay put as the view grows or shrinks
      const k = Math.abs(ratio - 1) < 1e-9 ? e : (1 / scale - 1 / from.scale) / (1 / to.scale - 1 / from.scale);
      view.setCenterAndScale(from.cx + (to.cx - from.cx) * k, from.cy + (to.cy - from.cy) * k, scale);
    }
    store.emit("view");
    if (t < 1) requestAnimationFrame(step);
    else finish();
  };
  view.setCenterAndScale(from.cx, from.cy, from.scale);
  view.rotation = from.rotation;
  requestAnimationFrame(step);
}
