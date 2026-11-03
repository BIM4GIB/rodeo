// Looks, beams and the gel matrix, in the Stage menu's Lighting section: the show's named looks (a crossfade
// through them, and a USITT cue list) in the Looks palette; the focused instruments' beams in the 3D view; Dark
// Stage, the view and renders lit at night so the lights show (render/darkStage.ts); and what scenic paint looks
// like under each gel. looksPalette.ts, beams3d.ts and gelMatrixPanel.ts hold the parts. Its Visualization
// section has Spotlight's Animate Scenes…, Manage Scenes… and Set Spotlight Rendering Options… (animateScenes.ts,
// manageScenes.ts, spotlightRendering.ts).

import { appContext, on3d, registerPalette } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { darkStageOn, setDarkStage } from "../../render/darkStage.ts";
import { addStageRows } from "../registry.ts";
import { beams3dCreated, beamsShown, toggleBeams } from "./beams3d.ts";
import { openGelMatrix } from "./gelMatrixPanel.ts";
import { LOOKS_PALETTE, looksPaletteBody } from "./looksPalette.ts";
import { animateScenes } from "./animateScenes.ts";
import { manageScenes } from "./manageScenes.ts";
import { spotlightRenderingOptions } from "./spotlightRendering.ts";
import "./looks.css";

/** three channel sliders, each with its knob */
const LOOKS_ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2.2" fill="currentColor"/><circle cx="15" cy="12" r="2.2" fill="currentColor"/><circle cx="8" cy="18" r="2.2" fill="currentColor"/></svg>';

registerPalette({ id: LOOKS_PALETTE, title: "Looks", side: "right", icon: LOOKS_ICON, hidden: true, body: looksPaletteBody() });

addStageRows("Lighting", () => [
  { label: "Looks", checked: () => appContext()?.palettes.isShown(LOOKS_PALETTE) ?? false, run: () => appContext()?.palettes.toggle(LOOKS_PALETTE) },
  { label: "Show Beams in 3D", checked: beamsShown, run: () => void toggleBeams() },
  { label: "Dark Stage", checked: darkStageOn, run: () => setDarkStage(!darkStageOn()) },
  { label: "Gel and Paint Matrix…", run: openGelMatrix },
]);

addStageRows("Visualization", () => [
  { label: "Animate Scenes…", enabled: () => store.session !== null, run: () => void animateScenes() },
  { label: "Manage Scenes…", enabled: () => store.session !== null, run: () => void manageScenes() },
  { label: "Set Spotlight Rendering Options…", run: () => void spotlightRenderingOptions() },
]);

on3d(beams3dCreated);
