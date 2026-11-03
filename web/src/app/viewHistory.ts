// View > Previous View and Next View: back and forward through the views the
// drawing has been shown at, as Vectorworks keeps them. A view counts once it has
// settled (half a second without a change), so a wheel zoom or a pan is one step;
// stepping back and forth adds none, and a new view after stepping back drops the
// ones ahead. Each drawing starts afresh. Plan (2D) views only.

import { glide, stopGlide } from "./glide.ts";
import { store } from "./state.ts";
import type { View } from "./view.ts";

/** how long a view must stay put to count, ms */
const SETTLE_MS = 500;
/** views kept behind the current one */
const MAX_BACK = 50;

interface Shot {
  readonly cx: number;
  readonly cy: number;
  readonly scale: number;
}

let past: Shot[] = [];
let ahead: Shot[] = [];
let current: Shot | null = null;
/** the drawing the history is of */
let of: unknown = null;
let timer: ReturnType<typeof setTimeout> | undefined;
/** set while a step back or forward moves the view, which is not a new view */
let stepping = false;

function shotOf(view: View): Shot {
  return { cx: view.cx, cy: view.cy, scale: view.scale };
}

/** Within a pixel and a hair of zoom: the same view. */
function same(a: Shot, b: Shot): boolean {
  return Math.abs(a.scale / b.scale - 1) < 1e-6 && Math.hypot(a.cx - b.cx, a.cy - b.cy) * a.scale < 1;
}

/** Takes the view as it is now as the current one, if it is new. */
function settle(view: View): void {
  clearTimeout(timer);
  timer = undefined;
  if (of !== store.session) {
    past = [];
    ahead = [];
    current = null;
    of = store.session;
  }
  if (!store.session || store.view3d) return;
  const now = shotOf(view);
  if (current && same(current, now)) return;
  if (current) past.push(current);
  if (past.length > MAX_BACK) past.shift();
  ahead = [];
  current = now;
}

/** Starts keeping the history of `view`. */
export function installViewHistory(view: View): void {
  store.on("view", () => {
    if (stepping) return;
    clearTimeout(timer);
    timer = setTimeout(() => settle(view), SETTLE_MS);
  });
}

function show(view: View, s: Shot): void {
  // the steps of an animated move are no new views either (a move still going ends first, so its end doesn't clear this)
  stopGlide();
  stepping = true;
  glide(view, () => view.setCenterAndScale(s.cx, s.cy, s.scale), () => (stepping = false));
}

export function hasPreviousView(): boolean {
  return !store.view3d && store.session === of && (past.length > 0 || timer !== undefined);
}

export function hasNextView(): boolean {
  return !store.view3d && store.session === of && ahead.length > 0 && timer === undefined;
}

/** Back to the view before this one. */
export function previousView(view: View): void {
  // a view not yet settled counts first, so going back returns to the one before it
  if (timer !== undefined) settle(view);
  const prev = past.pop();
  if (!prev || !current) return;
  ahead.push(current);
  current = prev;
  show(view, prev);
}

/** Forward again to the view Previous View left. */
export function nextView(view: View): void {
  const next = ahead.pop();
  if (!next || !current) return;
  past.push(current);
  current = next;
  show(view, next);
}
