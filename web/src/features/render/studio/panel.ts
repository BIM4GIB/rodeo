// The Render palette (loaded with the editor), the one place every render setting lives, docked or in
// Render Studio. At the top the 3D view's realistic modes (Realistic, Path Traced and, where the
// server paints AI renders, AI), Render Studio's switch and how far the live picture has come; the AI
// mode's card under them while it draws; then five tabs: Scene (sky, sun, light objects, fog), Camera
// (shots, lens, depth of field), Materials, Look (looks, colour, effects, style) and Output (what
// Render makes); at the foot what Render makes and Render itself, with batch jobs, panoramas, HDRI
// and animations a click away. The tabs are built when first shown. No three.js here.

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import type { Row } from "../../../app/menu.ts";
import { menuButton } from "../../../app/menu.ts";
import { reportFailure } from "../../../app/reports.ts";
import { store } from "../../../app/state.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import type { RealisticMode } from "../../../app/view3d.ts";
import { config, onConfig } from "../../account/config.ts";
import { liveProgress, onProgress, onRenderBusy, renderBusy, type LiveProgress } from "../bridge.ts";
import { renderEngines } from "../engines.ts";
import { resetRender } from "../settings.ts";
import { aiCard } from "./aiCard.ts";
import { cameraTab } from "./cameraTab.ts";
import { lookTab } from "./lookTab.ts";
import { materialsTab } from "./materialsTab.ts";
import { outputTab } from "./outputTab.ts";
import { ALL, CAMERA_PREFIX, QUALITY, SIZE_PRESETS, onOutput, outputPrefs, sizeOf, type Prefs } from "./output.ts";
import { sceneTab } from "./sceneTab.ts";
import { STUDIO_TABS, onStudio, setStudioTab, studioOn, studioTab, toggleStudio, type StudioTab } from "./state.ts";
import { button, icon, segmented, type IconName } from "./ui.ts";

const MODES: readonly (readonly [RealisticMode, string])[] = [
  ["realistic", "Realistic"],
  ["pathtraced", "Path Traced"],
  ["ai", "AI"],
];

const TABS: Readonly<Record<StudioTab, { readonly label: string; readonly icon: IconName; readonly build: () => HTMLElement }>> = {
  scene: { label: "Scene", icon: "scene", build: sceneTab },
  camera: { label: "Camera", icon: "camera", build: cameraTab },
  materials: { label: "Materials", icon: "materials", build: materialsTab },
  look: { label: "Look", icon: "look", build: lookTab },
  output: { label: "Output", icon: "output", build: outputTab },
};

function report(err: unknown, step: string): void {
  toast(`Render: ${errorMessage(err)}`);
  reportFailure("render", err, { step });
}

/** Shows the 3D view if it is hidden, then draws it in `mode`, as View > Rendering does. */
export async function showMode(mode: RealisticMode): Promise<void> {
  const app = appContext();
  if (!app) return;
  await app.show3d();
  app.setRenderMode(mode);
}

/** Render: Render's choices made into pictures (finalRender.ts renderOutput). */
export function renderNow(): void {
  import("../finalRender.ts")
    .then((m) => m.renderOutput())
    .catch((err: unknown) => report(err, "loading the render code"));
}

/** The rows under Render's arrow: the other ways to make pictures. */
export function moreRenderRows(): Row[] {
  const hasDoc = (): boolean => store.session !== null;
  const load = <T>(spec: Promise<T>, run: (m: T) => unknown, step: string): void => {
    spec.then(run).catch((err: unknown) => report(err, step));
  };
  return [
    { label: "Render", run: renderNow, enabled: hasDoc },
    "-",
    { label: "Save as Batch Render Job…", enabled: hasDoc, run: () => load(import("../batch.ts"), (m) => m.createBatchJobDialog(), "loading batch renders") },
    { label: "Start Batch Render…", enabled: hasDoc, run: () => load(import("../batch.ts"), (m) => m.startBatchRenderDialog(), "loading batch renders") },
    "-",
    { label: "Export Panorama…", enabled: hasDoc, run: () => load(import("../panorama.ts"), (m) => m.exportPanoramaDialog(), "loading panoramas") },
    { label: "Export HDRI…", enabled: hasDoc, run: () => load(import("../finalRender.ts"), (m) => m.exportHdriDialog(), "loading the render code") },
    {
      label: "Create Animation",
      enabled: hasDoc,
      items: [
        { label: "Create Orbit Path…", run: () => load(import("../movie.ts"), (m) => m.createAnimation("orbit"), "loading animations") },
        { label: "Create Walkthrough Path from Saved Views…", run: () => load(import("../movie.ts"), (m) => m.createAnimation("views"), "loading animations") },
      ],
    },
    ...(config()?.render ? (["-", { label: "Cloud Renders…", run: () => load(import("../cloud.ts"), (m) => m.openCloudRenders(), "loading cloud renders") }] as Row[]) : []),
    "-",
    { label: "Reset Render Settings", enabled: hasDoc, run: () => resetRender() },
  ];
}

/**
 * What Render makes, in parts shown with dots between: "Current view", "4K 3840 × 2160", "Photoreal",
 * "Good". `named`: the first part is a camera's own name, not translated.
 */
export function outputSummary(p: Prefs): { readonly parts: string[]; readonly named: boolean } {
  const cams = store.session?.doc.cameras() ?? [];
  const cam = cams.find((c) => CAMERA_PREFIX + c.id === p.camera);
  const shots = p.camera === ALL && cams.length > 0 ? `All ${cams.length} cameras` : cam ? cam.name.trim() || "Camera" : "Current view";
  const sized = sizeOf(p, cams);
  const size = "size" in sized ? `${p.size in SIZE_PRESETS ? `${SIZE_PRESETS[p.size as keyof typeof SIZE_PRESETS].short} ` : ""}${sized.size.width} × ${sized.size.height}` : "Size to check";
  const via = p.via ? renderEngines().find((e) => e.id === p.via) : undefined;
  const engine = via ? [via.short] : p.engine === "pathtraced" ? ["Photoreal", QUALITY[p.quality].short] : ["Fast"];
  return { parts: [shots, size, ...engine], named: p.camera !== ALL && cam !== undefined && cam.name.trim() !== "" };
}

/** The status line's words for the live picture, and the bar's fill (null: no bar). */
/** The live picture's words, its phase and the bar's fill (null: no fill to show). */
export interface LiveStatus {
  readonly text: string;
  readonly phase: string;
  readonly fraction: number | null;
  readonly busy: boolean;
}

/** How far the live picture has come, in words (the palette's head and the HUD say the same). */
export function statusOf(p: LiveProgress): LiveStatus {
  const mode = appContext()?.renderMode();
  if (!store.session) return { text: "Open a drawing to render it.", phase: "idle", fraction: null, busy: false };
  if (!store.view3d || (mode !== "realistic" && mode !== "pathtraced" && mode !== "ai")) {
    return { text: "The 3D view isn't rendering: pick a mode.", phase: "idle", fraction: null, busy: false };
  }
  if (p.phase === "paused" || (mode === "pathtraced" && renderBusy())) return { text: "Paused while Render makes pictures", phase: "paused", fraction: null, busy: false };
  if (p.phase === "preparing") return { text: "Preparing the scene…", phase: "preparing", fraction: null, busy: true };
  if (mode === "realistic") return { text: p.phase === "moving" ? "Realistic · moving" : "Realistic · live", phase: "done", fraction: null, busy: false };
  if (mode === "ai") return { text: "AI · paints the view once it rests", phase: "done", fraction: null, busy: false };
  const gpu = p.engine === "webgpu" ? " · WebGPU" : "";
  if (p.phase === "moving") return { text: `Path traced · moving${gpu}`, phase: "moving", fraction: null, busy: true };
  const unlimited = p.target >= 100000;
  if (p.phase === "refining") {
    return { text: `Path traced · ${p.samples} of ${unlimited ? "∞" : p.target} samples${gpu}`, phase: "refining", fraction: unlimited ? null : p.samples / Math.max(1, p.target), busy: true };
  }
  return { text: `Path traced · ${p.samples} samples · done${gpu}`, phase: "done", fraction: 1, busy: false };
}

/** The Render palette's body, for the dock. */
export function renderPanel(): HTMLElement {
  // head: the modes, Render Studio's switch, the live picture's progress
  const modes = segmented("Rendering", MODES, (mode) => void showMode(mode));
  const studioBtn = button("Render Studio", () => toggleStudio(), { iconOnly: true, icon: "focus" });
  studioBtn.classList.add("rs-studio-btn");
  const statusText = h("span", { cls: "rs-status-text" });
  const status = h("div", { cls: "rs-status", attrs: { role: "status" } }, h("span", { cls: "rs-status-dot" }), statusText);
  const meterFill = h("span");
  const meter = h("div", { cls: "rs-meter", attrs: { "aria-hidden": "true" } }, meterFill);
  const head = h("div", { cls: "rs-head" }, h("div", { cls: "rs-head-top" }, modes.el, studioBtn), status, meter);

  // the AI mode's card, while the view draws in AI
  const ai = h("div", { cls: "rs-ai" }, aiCard());

  // the tabs, each built when first shown
  const panes = new Map<StudioTab, HTMLElement>();
  const tabButtons = new Map<StudioTab, HTMLButtonElement>();
  const body = h("div", { cls: "rs-body" });
  const tabBar = h("div", { cls: "rs-tabs", attrs: { role: "tablist", "aria-label": "Render settings" } });
  for (const id of STUDIO_TABS) {
    const t = TABS[id];
    const b = h("button", { cls: "rs-tab", attrs: { type: "button", role: "tab", "aria-selected": "false", id: `rs-tab-${id}` } }, icon(t.icon, 18), h("span", { text: t.label, attrs: { "data-i18n": `Render › ${t.label}` } }));
    b.addEventListener("click", () => setStudioTab(id));
    b.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const i = STUDIO_TABS.indexOf(id);
      const next = STUDIO_TABS[(i + (e.key === "ArrowRight" ? 1 : STUDIO_TABS.length - 1)) % STUDIO_TABS.length];
      setStudioTab(next);
      tabButtons.get(next)?.focus();
    });
    tabButtons.set(id, b);
    tabBar.append(b);
  }
  const showTab = (): void => {
    const current = studioTab();
    for (const [id, b] of tabButtons) {
      b.setAttribute("aria-selected", String(id === current));
      b.tabIndex = id === current ? 0 : -1;
    }
    let pane = panes.get(current);
    if (!pane) {
      try {
        pane = h("div", { cls: "rs-pane", attrs: { role: "tabpanel", "aria-labelledby": `rs-tab-${current}` } }, TABS[current].build());
      } catch (err) {
        report(err, `building the ${current} tab`);
        pane = h("div", { cls: "rs-pane" });
      }
      panes.set(current, pane);
      body.append(pane);
    }
    for (const [id, p] of panes) p.hidden = id !== current;
  };

  // foot: what Render makes (a click shows Output), and Render with its other ways under the arrow
  const summaryText = h("span", { cls: "rs-summary-text" });
  const summary = h("button", { cls: "rs-summary", attrs: { type: "button" }, title: "What Render makes: change it in Output" }, icon("output", 14), summaryText);
  summary.addEventListener("click", () => setStudioTab("output"));
  const go = button("Render", () => renderNow(), { primary: true, icon: "shutter" });
  go.classList.add("rs-go-main");
  const more = menuButton(button("More ways to render", () => undefined, { primary: true, iconOnly: true, icon: "caret" }), moreRenderRows);
  more.classList.add("rs-go-more");
  const foot = h("div", { cls: "rs-foot" }, summary, h("div", { cls: "rs-go" }, go, more));

  const panel = h("div", { cls: "rs-panel" }, head, ai, tabBar, body, foot);

  const syncHead = (): void => {
    const mode = appContext()?.renderMode();
    const offersAi = config()?.image != null;
    const shown = store.view3d && (mode === "realistic" || mode === "pathtraced" || mode === "ai") ? mode : null;
    modes.set(shown ?? ("" as RealisticMode));
    const aiBtn = modes.buttons.get("ai");
    if (aiBtn) aiBtn.hidden = !offersAi;
    ai.hidden = !(offersAi && shown === "ai");
    const on = studioOn();
    studioBtn.setAttribute("aria-pressed", String(on));
    studioBtn.title = on ? "Leave Render Studio (Esc)" : "Render Studio: the 3D view and these settings alone, with the frame Render takes";
    studioBtn.classList.toggle("active", on);
    const st = statusOf(liveProgress());
    statusText.textContent = st.text;
    status.dataset.phase = st.phase;
    meter.hidden = st.fraction === null && !st.busy;
    if (st.fraction === null) meter.setAttribute("data-indeterminate", "");
    else meter.removeAttribute("data-indeterminate");
    meter.style.setProperty("--progress", `${Math.round((st.fraction ?? 0) * 100)}%`);
    go.disabled = store.session === null;
    more.disabled = store.session === null;
  };
  const syncFoot = (): void => {
    // a part a span, so each is translated on its own
    const { parts, named } = outputSummary(outputPrefs());
    const part = (text: string, i: number): HTMLElement => h("span", { text, attrs: i === 0 && named ? { translate: "no" } : {} });
    summaryText.replaceChildren(...parts.flatMap((text, i) => (i ? [h("span", { text: " · ", attrs: { "aria-hidden": "true" } }), part(text, i)] : [part(text, i)])));
  };

  onProgress(syncHead);
  onRenderBusy(syncHead);
  onConfig(syncHead);
  onStudio(() => {
    syncHead();
    showTab();
  });
  onOutput(syncFoot);
  store.on(["view3d", "session", "viz3d"], () => {
    syncHead();
    syncFoot();
  });
  syncHead();
  syncFoot();
  showTab();
  return panel;
}
