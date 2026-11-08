// Render: the 3D view's Realistic and Path Traced modes (View > Rendering), the Render palette
// (studio/panel.ts: Scene, Camera, Materials, Look and Output tabs, and Render, which renders the view
// or the drawing's cameras up to 8K, here in a queue or on the server's cloud GPU), Render Studio
// (studio/state.ts: the 3D view and the palette alone, with the frame Render takes; the top bar's
// Render and View › Render Studio), File > Export > Render Image… (Studio's Output tab),
// View > Rendering's batch render jobs (batch.ts), Export HDRI… (the picture linear, as a Radiance .hdr)
// (File › Export › Cloud Renders… lists those), Export Panorama… (panorama.ts) and Model › Create Animation's animation
// paths and their movies (movie.ts, animationPathObject.ts). Registered with app/ext.ts when imported;
// three-gpu-pathtracer and the engines load with the first realistic frame or render.

import { h } from "../../app/dom.ts";
import { appContext, on3d, onReady, registerMenu, registerPalette } from "../../app/ext.ts";
import { setRenderModeReason } from "../../app/viewbar.ts";
import { store } from "../../app/state.ts";
import { threeDOnScreen } from "../../app/viewTargets.ts";
import { reportFailure } from "../../app/reports.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { RenderHook } from "../../app/view3d.ts";
import { need, whyIn } from "../../app/menuReasons.ts";
import { config, onConfig } from "../account/config.ts";
import { AI_ENGINE } from "./ai.ts";
import { registerRenderEngine } from "./engines.ts";
import { renderPanel } from "./studio/panel.ts";
import { PALETTE_ID, exitStudio, onStudio, studioOn, toggleStudio } from "./studio/state.ts";
import { icon } from "./studio/ui.ts";
// its Object Info and right-click menu, for animation paths a drawing holds
import "./animationPathObject.ts";

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

function createAnimation(kind: "orbit" | "spin" | "walkthrough" | "views"): void {
  import("./movie.ts")
    .then((m) => m.createAnimation(kind))
    .catch(report);
}

// Render Image's AI engine, while the server paints AI renders (ai.ts)
let dropAi: (() => void) | null = null;
function syncAi(): void {
  const on = config()?.image != null;
  if (on && !dropAi) dropAi = registerRenderEngine(AI_ENGINE);
  else if (!on && dropAi) {
    dropAi();
    dropAi = null;
  }
}
onConfig(syncAi);
setRenderModeReason("ai", () => (config()?.image ? null : config() ? "This server doesn't offer AI renders" : "AI Render needs Rodeo's server"));

registerPalette({ id: PALETTE_ID, title: "Render", side: "right", icon: ICON, fill: true, weight: 360, hidden: true, body: renderPanel() });

registerMenu("View", () => [
  {
    label: "Render Studio",
    enabled: () => store.session !== null,
    checked: studioOn,
    run: toggleStudio,
  },
  {
    label: "Render Settings",
    enabled: () => store.session !== null,
    run: () => appContext()?.palettes.show(PALETTE_ID),
  },
], { after: "Renderworks Style" });

/** The top bar's Render, after 2D, 3D and Split: Render Studio on and off. */
function studioButton(): HTMLButtonElement {
  const btn = h("button", { cls: "rs-topbtn", attrs: { type: "button", id: "btn-render-studio", "aria-pressed": "false" } }, icon("render"), h("span", { text: "Render" }));
  btn.addEventListener("click", () => {
    btn.blur();
    toggleStudio();
  });
  const sync = (): void => {
    const on = studioOn();
    btn.setAttribute("aria-pressed", String(on));
    btn.disabled = store.session === null;
    btn.title = on ? "Leave Render Studio (Esc)" : store.session ? "Render Studio: render the 3D view, with every setting at hand" : "Render Studio: open or start a drawing first";
  };
  onStudio(sync);
  store.on("session", sync);
  sync();
  return btn;
}

onReady((ctx) => {
  // after the 2D / 3D / Split control; those leave Studio, as does closing the Render palette
  const views = document.querySelector("#tb-view > .seg");
  views?.after(studioButton());
  for (const id of ["btn-plan", "btn-split"]) document.getElementById(id)?.addEventListener("click", () => exitStudio());
  ctx.palettes.onChange(() => {
    if (studioOn() && !ctx.palettes.isShown(PALETTE_ID)) exitStudio();
  });
});

// Render Image's choices kept as named jobs, rendered together later (batch.ts)
registerMenu("View › Rendering", () => [
  { label: "Create Batch Render Job…", enabled: () => store.session !== null, run: () => batchRender("create") },
  { label: "Start Batch Render…", enabled: () => store.session !== null, run: () => batchRender("start") },
]);

registerMenu("Model", () => [
  {
    // animation paths to play in the 3D view and make movies of, as Vectorworks makes them
    label: "Create Animation",
    enabled: () => store.session !== null,
    items: [
      { label: "Create Walkthrough Path from Selection", why: whyIn("Select one path first"), enabled: () => store.selection.size === 1, run: () => createAnimation("walkthrough") },
      { label: "Create Walkthrough Path from Saved Views…", enabled: () => store.session !== null, run: () => createAnimation("views") },
      { label: "Create Orbit Path…", enabled: () => store.session !== null, run: () => createAnimation("orbit") },
      { label: "Create Spin Path", why: need.selection, enabled: () => store.selection.size > 0, run: () => createAnimation("spin") },
    ],
  },
]);

registerMenu("File › Export", () => [
  {
    label: "Render Image…",
    why: need.threeD,
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
    why: need.threeD,
    enabled: threeDOnScreen,
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
