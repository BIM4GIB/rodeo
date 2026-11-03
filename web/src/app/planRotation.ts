// View > Rotate Plan, Vectorworks' Rotated Top/Plan: the design layers turned on screen to match a
// drawing angle, nothing in the drawing moved. Two clicks (tools/rotatePlan.ts) make the line between
// them level, or an angle typed in the View bar turns the plan about the drawing's origin. A rotated
// plan's grid, rulers, Shift steps and snapping lie along the screen, from the pivot; Top/Plan goes
// back to the unrotated plan, and Rotated Top/Plan (⌘5) back and forth. Each open drawing keeps its
// own rotation for as long as it is open (where a file keeps one isn't known); sheet layers and
// symbols being edited show unrotated.

import type { Pt } from "../core/index.ts";
import { appContext } from "./ext.ts";
import { setAngleBase } from "./geom.ts";
import { glide } from "./glide.ts";
import { store, type ToolId } from "./state.ts";
import { toast } from "./toast.ts";
import type { View } from "./view.ts";

interface Turn {
  /** radians counter-clockwise */
  readonly rotation: number;
  readonly pivot: Pt;
}

interface PlanState {
  /** what the plan shows: null when it isn't rotated */
  shown: Turn | null;
  /** the last rotation, for Rotated Top/Plan */
  last: Turn | null;
}

const ORIGIN: Pt = { x: 0, y: 0 };
/** a rotation this small (radians) is no rotation */
const LEVEL = 1e-9;

const states = new WeakMap<object, PlanState>();
/** the tool before the Rotate Plan command took over */
let back: ToolId = "select";

function state(): PlanState | null {
  const s = store.session;
  if (!s) return null;
  let st = states.get(s);
  if (!st) {
    st = { shown: null, last: null };
    states.set(s, st);
  }
  return st;
}

/** `rad` in (-π, π]. */
function wrap(rad: number): number {
  const r = rad % (2 * Math.PI);
  return r > Math.PI ? r - 2 * Math.PI : r <= -Math.PI ? r + 2 * Math.PI : r;
}

/** Whether the active layer can show rotated: a design layer, not a symbol being edited. */
function rotatable(): boolean {
  const ctx = appContext();
  const layer = store.activeLayerId && ctx ? ctx.scene.layer(store.activeLayerId) : undefined;
  return layer?.kind === "design" && !store.symbolEdit;
}

export function canRotatePlan(): boolean {
  return store.session !== null && rotatable();
}

/** The plan's rotation as the View bar shows it, degrees counter-clockwise; 0 when it isn't rotated. */
export function planRotationDegrees(): number {
  const r = state()?.shown?.rotation ?? 0;
  return (r * 180) / Math.PI;
}

export function planRotated(): boolean {
  return state()?.shown != null;
}

/** Whether Rotated Top/Plan has a rotation to go back to. */
export function hasPlanRotation(): boolean {
  return state()?.last != null;
}

/** Puts `turn` on `view` at once, the view's centre staying where it is. */
function put(view: View, turn: Turn | null): void {
  view.rotation = turn?.rotation ?? 0;
  view.pivot = turn?.pivot ?? ORIGIN;
  setAngleBase(-view.rotation);
}

/**
 * Makes the view show what the front drawing's active layer should: called when a drawing comes to
 * the front or the active layer changes. Returns whether that turned it.
 */
export function syncPlanRotation(view: View): boolean {
  const turn = rotatable() ? (state()?.shown ?? null) : null;
  const rotation = turn?.rotation ?? 0;
  if (view.rotation === rotation && (!turn || view.pivot === turn.pivot)) return false;
  put(view, turn);
  return true;
}

/** Turns the plan to `turn` (null: unrotated), moving there as view changes do, the world point `about` staying where it shows. */
function rotateTo(view: View, turn: Turn | null, about: Pt | null): void {
  const st = state();
  if (!st) return;
  const at = about ?? { x: view.cx, y: view.cy };
  const screen = view.toScreen(at);
  st.shown = turn;
  if (turn) st.last = turn;
  const rotation = turn?.rotation ?? 0;
  glide(
    view,
    () => {
      put(view, turn);
      view.keepAt(at, screen.x, screen.y);
    },
    // stopped on the way by a pan or a zoom, it still ends at the rotation asked for
    () => {
      if (view.rotation === rotation) return;
      view.rotation = rotation;
      store.emit("view");
    },
  );
  appContext()?.requestDraw();
}

/** View > Rotate Plan: takes up the tool's two clicks. */
export function startRotatePlan(): void {
  const ctx = appContext();
  if (!ctx || !canRotatePlan()) return;
  if (ctx.controller.activeId !== "rotateplan") back = ctx.controller.activeId;
  ctx.show2d();
  ctx.setTool("rotateplan");
}

/** Ends the command, giving back the tool before it. */
export function endRotatePlan(): void {
  appContext()?.setTool(back);
}

/** The two clicks' end: the line from `centre` to `along` comes to point right across the screen. */
export function rotatePlanAlong(centre: Pt, along: Pt): void {
  const ctx = appContext();
  if (!ctx) return;
  const rotation = wrap(-Math.atan2(along.y - centre.y, along.x - centre.x));
  rotateTo(ctx.view, Math.abs(rotation) <= LEVEL ? null : { rotation, pivot: centre }, centre);
}

/** The View bar's Rotate Plan angle: degrees counter-clockwise, about the drawing's origin; 0 unrotates. */
export function setPlanRotationDegrees(deg: number): void {
  const ctx = appContext();
  if (!ctx || !canRotatePlan()) return;
  const rotation = wrap((deg * Math.PI) / 180);
  ctx.show2d();
  rotateTo(ctx.view, Math.abs(rotation) <= LEVEL ? null : { rotation, pivot: ORIGIN }, null);
}

/** Top/Plan: the 2D plan, unrotated. */
export function unrotatedPlan(): void {
  const ctx = appContext();
  if (!ctx) return;
  ctx.show2d();
  if (planRotated()) rotateTo(ctx.view, null, null);
}

/** Rotated Top/Plan: the 2D plan at its last rotation. */
export function rotatedPlan(): void {
  const ctx = appContext();
  const last = state()?.last;
  if (!ctx || !last || !canRotatePlan()) return;
  ctx.show2d();
  if (!planRotated()) rotateTo(ctx.view, last, null);
}

/** ⌘5: from the 3D view to the plan as it was; in the plan, between rotated and unrotated. */
export function toggleRotatedPlan(): void {
  const ctx = appContext();
  if (!ctx) return;
  if (store.view3d) {
    ctx.show2d();
    return;
  }
  if (planRotated()) unrotatedPlan();
  else if (hasPlanRotation()) rotatedPlan();
  else toast("The plan hasn't been rotated: use View > Rotate Plan.", "info");
}
