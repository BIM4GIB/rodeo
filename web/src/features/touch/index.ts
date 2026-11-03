// touch feature: registers itself with app/ext.ts when imported. Touch and Apple
// Pencil on the 2D drawing, the touch layout (coarse pointers, narrow windows), the
// quick bar that stands in for the keyboard, the Palettes button that opens a phone's palette
// sheet (sheet.ts), and the install pieces: the manifest and icons (public/), the service worker,
// and "Open with openvwx".

import "./touch.css";
import { onReady, registerTopBar } from "../../app/ext.ts";
import { installGestures } from "./gestures.ts";
import { openFromLaunchQueue, registerServiceWorker } from "./install.ts";
import "./keyboard.ts";
import { applyTouchLayout, blockPageZoom, COARSE } from "./layout.ts";
import { mountQuickBar } from "./quickbar.ts";
import { paletteButton } from "./sheet.ts";

onReady((ctx) => {
  applyTouchLayout(ctx);
  installGestures(ctx);
  if (COARSE) mountQuickBar(ctx);
  openFromLaunchQueue(ctx);
});

blockPageZoom();
registerServiceWorker();
registerTopBar(paletteButton, "right");
