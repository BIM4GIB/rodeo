// The touch layout, chosen at start-up: a finger is the primary pointer (coarse), or
// the window is too narrow for the side panels. The sizes of the controls themselves
// are in touch.css.

import type { AppContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";

/** A finger, not a mouse, is the primary pointer. */
export const COARSE = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

/**
 * Narrower than this, the palettes start put away for the visit, rails and all (the drawing takes the
 * window), and widening past it brings them back; the arrangement saved stays the wider window's. On a
 * phone they are a bottom sheet, which starts closed (dock.ts).
 */
const NARROW_PX = 900;
/** The snap radius (CSS px) for a finger, until the user sets one in the Snapping palette. */
const COARSE_SNAP_PX = 14;
const SNAP_KEY = "openvwx.snapSettings.v1";

function snapSaved(): boolean {
  try {
    return localStorage.getItem(SNAP_KEY) !== null;
  } catch {
    // storage blocked: no saved choice
    return false;
  }
}

/** Palettes start put away in a narrow window, for this visit only; a finger snaps from a wider radius. */
export function applyTouchLayout(ctx: AppContext): void {
  if (window.innerWidth < NARROW_PX) {
    // the docks' rails go too; showing a palette (Window > Palettes) brings them back, or on a phone opens its sheet
    ctx.palettes.awayForVisit();
    // widening past it brings back the arrangement kept from wider windows
    const wide = matchMedia(`(min-width: ${NARROW_PX}px)`);
    const widened = (): void => {
      if (!wide.matches) return;
      wide.removeEventListener("change", widened);
      ctx.palettes.endVisit();
    };
    wide.addEventListener("change", widened);
  }
  if (COARSE && !snapSaved()) {
    store.snapSettings = { ...store.snapSettings, radiusPx: COARSE_SNAP_PX };
    store.emit("snap");
  }
}

/** On a touch screen, pinching the page would zoom the browser rather than the drawing: the page does not zoom. */
export function blockPageZoom(): void {
  if (!COARSE) return;
  for (const type of ["gesturestart", "gesturechange"]) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }
}
