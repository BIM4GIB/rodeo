// Render Studio: the render workspace. While it is on, the 3D view stands alone in a realistic mode,
// the Render palette stands alone in its dock (Palettes.solo, given back as it was on leaving), and
// the HUD (hud.ts) lies over the view: the modes, how far the picture has come, the frame of what
// Render takes, the time of day and the shutter. Esc, the top bar's Render, 2D or Split, or Done
// leave it. The tab the Render palette shows is kept here too. No three.js here: this loads with the
// editor.

import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { reportFailure } from "../../../app/reports.ts";
import type { RealisticMode, RenderMode, View3D } from "../../../app/view3d.ts";

export type StudioTab = "scene" | "camera" | "materials" | "look" | "output";

export const STUDIO_TABS: readonly StudioTab[] = ["scene", "camera", "materials", "look", "output"];
export const PALETTE_ID = "render";

const TAB_KEY = "openvwx.renderStudio.tab";
const MODE_KEY = "openvwx.renderStudio.mode";

let on = false;
let tab: StudioTab = readTab();
/** the 3D view's mode before Studio, given back on leaving when it wasn't a realistic one */
let modeBefore: RenderMode | null = null;
/** takes the HUD off the view */
let unmountHud: (() => void) | null = null;
const listeners = new Set<() => void>();

function readTab(): StudioTab {
  try {
    const kept = localStorage.getItem(TAB_KEY);
    return STUDIO_TABS.find((t) => t === kept) ?? "scene";
  } catch {
    return "scene";
  }
}

function realistic(mode: RenderMode): mode is RealisticMode {
  return mode === "realistic" || mode === "pathtraced" || mode === "ai";
}

/** The realistic mode Studio last drew in, Realistic at first. */
function lastMode(): RealisticMode {
  try {
    const kept = localStorage.getItem(MODE_KEY);
    return kept === "pathtraced" || kept === "ai" ? kept : "realistic";
  } catch {
    return "realistic";
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** Render Studio is on. */
export function studioOn(): boolean {
  return on;
}

/** Calls `fn` when Studio comes on or goes off, and when the tab changes; returns a function that stops it. */
export function onStudio(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The Render palette's tab. */
export function studioTab(): StudioTab {
  return tab;
}

/** Shows `next` in the Render palette (Studio or not). */
export function setStudioTab(next: StudioTab): void {
  if (next === tab) return;
  tab = next;
  try {
    localStorage.setItem(TAB_KEY, next);
  } catch {
    // private windows: the tab lasts this session
  }
  notify();
}

/** Starts Render Studio (or, when it is on, shows `show`'s tab). */
export async function enterStudio(show?: StudioTab): Promise<void> {
  if (show) setStudioTab(show);
  const app = appContext();
  if (!app || !store.session) return;
  if (on) {
    app.palettes.show(PALETTE_ID);
    return;
  }
  on = true;
  notify();
  let view: View3D | null = null;
  try {
    view = await app.show3dAlone();
  } catch (err) {
    reportFailure("render", err, { step: "showing the 3D view for Render Studio" });
  }
  if (!view) {
    on = false;
    notify();
    toast("Render Studio needs the 3D view, which this browser can't draw.");
    return;
  }
  if (!on) return;
  const mode = app.renderMode();
  modeBefore = realistic(mode) ? null : mode;
  if (!realistic(mode)) app.setRenderMode(lastMode());
  app.palettes.solo(PALETTE_ID);
  document.body.classList.add("render-studio");
  window.addEventListener("keydown", onKey, true);
  import("./hud.ts")
    .then((m) => {
      if (on && view && !unmountHud) {
        unmountHud = m.mountHud(view);
        // what lies over the view (the render queue's tray) makes room for the HUD
        notify();
      }
    })
    .catch((err: unknown) => {
      toast(`Render: ${errorMessage(err)}`);
      reportFailure("render", err, { step: "loading Render Studio's HUD" });
    });
  notify();
}

/** Leaves Render Studio: the palettes come back as they were, and the 3D view's mode when it wasn't a realistic one. */
export function exitStudio(): void {
  if (!on) return;
  on = false;
  const app = appContext();
  const mode = app?.renderMode();
  if (mode && realistic(mode)) {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      // private windows: Studio starts in Realistic next time
    }
  }
  unmountHud?.();
  unmountHud = null;
  window.removeEventListener("keydown", onKey, true);
  document.body.classList.remove("render-studio");
  app?.palettes.endSolo();
  if (app && modeBefore && store.view3d && mode && realistic(mode)) app.setRenderMode(modeBefore);
  modeBefore = null;
  notify();
}

export function toggleStudio(): void {
  if (on) exitStudio();
  else void enterStudio();
}

/** Esc leaves Studio, unless a dialog or menu is open or a field has the keys. */
function onKey(e: KeyboardEvent): void {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || t.closest("input, textarea, select"))) return;
  if (document.querySelector(".menu-dialog-backdrop, .render-viewer-backdrop, .lib-pop, .menu-panel:not([hidden]), .rs-hud-pop:not([hidden])")) return;
  // a pick on the model (focus, a material) takes Esc to stop
  if (appContext()?.view3d()?.onFacePick) return;
  e.preventDefault();
  e.stopPropagation();
  exitStudio();
}

// leaves Studio when the 3D view goes (2D), the drawing closes, or the Render palette is closed
store.on(["view3d", "session"], () => {
  if (on && (!store.view3d || !store.session)) exitStudio();
});
