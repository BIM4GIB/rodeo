// Render: the 3D view's Realistic and Path Traced modes (View > Rendering), the Render palette (sky,
// sun, light objects, camera, fog, materials, effects and quality), File > Export > Render
// Image…, which renders the view or the drawing's cameras up to 8K, here or on the server's cloud GPU,
// View > Rendering's batch render jobs (batch.ts), Export HDRI… (the picture linear, as a Radiance .hdr)
// (File › Export › Cloud Renders… lists those), Export Panorama… (panorama.ts) and Model › Create Animation's movies
// (movie.ts). Registered with app/ext.ts when imported;
// three-gpu-pathtracer and the engines load with the first realistic frame or render.

import { appContext, on3d, registerMenu, registerPalette } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { reportFailure } from "../../app/reports.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { RenderHook } from "../../app/view3d.ts";
import { config } from "../account/config.ts";
import { renderPalette } from "./palette.ts";

const PALETTE_ID = "render";

/** a camera's body and lens with a spark: rendering */
const ICON =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M4 8.5a1.5 1.5 0 011.5-1.5h2l1.3-2h4.4l1.3 2h2A1.5 1.5 0 0118 8.5V17a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 014 17z"/>' +
  '<circle cx="11" cy="12.5" r="3"/><path d="M20 3.5v3M18.5 5h3"/></svg>';

function report(err: unknown): void {
  toast(`Render: ${errorMessage(err)}`);
  reportFailure("render", err, { step: "loading the render code" });
}

function renderImage(): void {
  import("./finalRender.ts")
    .then((m) => m.renderImageDialog())
    .catch(report);
}

function exportHdri(): void {
  import("./finalRender.ts")
    .then((m) => m.exportHdriDialog())
    .catch(report);
}

function exportPanorama(): void {
  import("./panorama.ts")
    .then((m) => m.exportPanoramaDialog())
    .catch(report);
}

function batchRender(step: "create" | "start"): void {
  import("./batch.ts")
    .then((m) => (step === "create" ? m.createBatchJobDialog() : m.startBatchRenderDialog()))
    .catch(report);
}

function createAnimation(kind: "orbit" | "spin" | "walkthrough"): void {
  import("./movie.ts")
    .then((m) => m.createAnimation(kind))
    .catch(report);
}

registerPalette({ id: PALETTE_ID, title: "Render", side: "right", icon: ICON, fill: true, weight: 360, hidden: true, body: renderPalette() });

registerMenu("View", () => [
  {
    label: "Render Settings",
    enabled: () => store.session !== null,
    run: () => appContext()?.palettes.show(PALETTE_ID),
  },
]);

// Render Image's choices kept as named jobs, rendered together later (batch.ts)
registerMenu("View › Rendering", () => [
  { label: "Create Batch Render Job…", enabled: () => store.session !== null, run: () => batchRender("create") },
  { label: "Start Batch Render…", enabled: () => store.session !== null, run: () => batchRender("start") },
]);

registerMenu("Model", () => [
  {
    // movies of the 3D view along a path, as Vectorworks' animation paths make them
    label: "Create Animation",
    enabled: () => store.session !== null,
    items: [
      { label: "Create Walkthrough Path from Selection…", enabled: () => store.selection.size === 1, run: () => createAnimation("walkthrough") },
      { label: "Create Orbit Path…", enabled: () => store.session !== null, run: () => createAnimation("orbit") },
      { label: "Create Spin Path…", enabled: () => store.selection.size > 0, run: () => createAnimation("spin") },
    ],
  },
]);

registerMenu("File › Export", () => [
  {
    label: "Render Image…",
    enabled: () => store.session !== null,
    run: renderImage,
  },
  {
    // the 3D view's or a camera's picture, linear, as a Radiance .hdr
    label: "Export HDRI…",
    enabled: () => store.session !== null,
    run: exportHdri,
  },
  {
    // a 360° picture from the 3D view's eye
    label: "Export Panorama…",
    enabled: () => store.session !== null && store.view3d,
    run: exportPanorama,
  },
  ...(config()?.render
    ? [
        {
          label: "Cloud Renders…",
          enabled: () => true,
          run: () => {
            import("./cloud.ts")
              .then((m) => m.openCloudRenders())
              .catch(report);
          },
        },
      ]
    : []),
]);

/** Draws the realistic modes once live.ts has loaded, the view's own picture until then. */
on3d((view) => {
  let live: RenderHook | null = null;
  let loading = false;
  const load = (): void => {
    if (loading) return;
    loading = true;
    import("./live.ts")
      .then((m) => {
        live = new m.LiveRenderer(view);
        view.redraw();
      })
      .catch(report);
  };
  view.setRenderHook({
    draw(mode, renderer, camera) {
      if (live) return live.draw(mode, renderer, camera);
      load();
      renderer.render(view.threeScene, camera);
      return false;
    },
    // a view pane's still picture (View Panes), once live.ts has loaded
    picture(renderer, camera) {
      if (live) return live.picture?.(renderer, camera) ?? false;
      load();
      return false;
    },
    // a Path Traced pane's picture, refined on a renderer of its own; a still one until live.ts has loaded
    tracePane(canvas, camera, width, height) {
      return live?.tracePane?.(canvas, camera, width, height) ?? "unable";
    },
    releasePanes() {
      live?.releasePanes?.();
    },
  });
});
