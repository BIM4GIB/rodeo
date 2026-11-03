// crit feature: registers itself with app/ext.ts when imported.
//
// Crit mode: on a cloud drawing, others review it with numbered pins, comment
// threads, redlines and voice notes, on an overlay that never changes the
// drawing. The View menu row and the top bar button turn it on; the crit
// palette lists the threads, and the toolbar over the drawing picks Pin,
// Redline or Select.

import "./crit.css";
import { on3d, onDocument, onReady, registerMenu, registerOverlay, registerPalette, registerTopBar } from "../../app/ext.ts";
import { PALETTE_ICON } from "../../app/icons.ts";
import { critPalette } from "./palette.ts";
import { paintCrit, mountPaint } from "./paint.ts";
import { mountCapture } from "./capture.ts";
import { CRIT_PALETTE_ID, documentOpened, toggleCrit } from "./mode.ts";
import { mountToolbar, critTopButton } from "./toolbar.ts";
import { initSync } from "./sync.ts";
import { attach3d } from "./view3d.ts";
import { crit } from "./state.ts";

registerMenu("View", () => [{ label: "Crit Mode", checked: () => crit.active, run: () => toggleCrit() }]);

registerPalette({ id: CRIT_PALETTE_ID, title: "Crit", side: "right", icon: PALETTE_ICON.crit, fill: true, weight: 380, hidden: true, body: critPalette() });

registerTopBar(critTopButton, "right");

registerOverlay(paintCrit);

onReady((ctx) => {
  const frame = ctx.canvas.parentElement;
  if (!frame) return;
  mountPaint(frame);
  mountCapture(frame);
  mountToolbar();
});

onDocument(() => documentOpened());

on3d(attach3d);

initSync();
