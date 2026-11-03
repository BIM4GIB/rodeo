// The screenshot a bug report can carry: the editor's window as the user sees it, drawn from the
// page itself (modern-screenshot, loaded the first time it is needed), so no permission prompt.
// Whatever `leaveOut` names (the report's own dialog) is left out. The 3D view keeps no picture
// between frames, so it is drawn once more and read straight after, and the copy is given that.
// If the page can't be drawn, the 2D or 3D view on its own is taken instead.

import { appContext } from "../../app/ext.ts";
import { store } from "../../app/state.ts";

/** the picture's longest side, px */
const MAX_SIDE = 2400;
const QUALITY = 0.82;

export async function captureWorkspace(leaveOut: (el: Element) => boolean): Promise<Blob | null> {
  const ctx = appContext();
  const view3d = store.view3d ? ctx?.view3d() : null;
  const gl = view3d?.domElement ?? null;
  if (gl && view3d) {
    view3d.renderNow();
    // read in the same task as the draw; the copy asks the canvas for its picture later
    const shot = gl.toDataURL("image/png");
    gl.toDataURL = () => shot;
  }
  try {
    const { domToBlob } = await import("modern-screenshot");
    const scale = Math.min(window.devicePixelRatio || 1, MAX_SIDE / Math.max(window.innerWidth, window.innerHeight));
    return await domToBlob(document.body, {
      type: "image/jpeg",
      quality: QUALITY,
      scale,
      font: false,
      timeout: 5000,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      filter: (node) => !(node instanceof Element && leaveOut(node)),
    });
  } catch (err) {
    console.warn("openvwx: the window could not be drawn for a screenshot", err);
    // drawn again so the copy, made in this task, has a picture to take
    view3d?.renderNow();
    return viewOnly(gl ?? ctx?.canvas ?? null);
  } finally {
    if (gl) delete (gl as { toDataURL?: unknown }).toDataURL;
  }
}

/** The drawing's view on its own, scaled to fit. */
function viewOnly(canvas: HTMLCanvasElement | null): Promise<Blob | null> {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return Promise.resolve(null);
  const k = Math.min(1, MAX_SIDE / Math.max(canvas.width, canvas.height));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(canvas.width * k));
  out.height = Math.max(1, Math.round(canvas.height * k));
  const g = out.getContext("2d");
  if (!g) return Promise.resolve(null);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise((resolve) => out.toBlob(resolve, "image/jpeg", QUALITY));
}
