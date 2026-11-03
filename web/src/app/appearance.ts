// Edit > Preferences… > Appearance, Vectorworks' Interactive Appearance Settings: the colours of the
// selection (its outline, handles and the tools' previews), the pre-selection highlight, the snap
// indicators and the cursor aids. The canvas draws with renderer.ts's live colours; the crosshairs
// and the cursor boxes (crosshair.ts) take theirs from CSS variables.

import { onPrefs, prefs } from "./prefs.ts";
import { setInteractiveColors } from "./renderer.ts";
import { store } from "./state.ts";

function apply(): void {
  const p = prefs();
  setInteractiveColors({ selection: p.selectionColor, preselect: p.preselectColor, snap: p.snapColor });
  const root = document.documentElement.style;
  root.setProperty("--snap-color", p.snapColor);
  // no cursor colour: the crosshairs follow the canvas, dark on white and light on black
  if (p.cursorColor) root.setProperty("--cursor-color", p.cursorColor);
  else root.removeProperty("--cursor-color");
}

/** Applies the colours now, and again whenever Preferences change them. */
export function installAppearance(): void {
  apply();
  onPrefs(() => {
    apply();
    store.emit("view");
  });
}
