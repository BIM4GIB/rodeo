// The Output tab of Render Studio: what Render makes, set here with no dialog. The shots (the 3D view's
// current view, one Renderworks camera, or every camera), the picture's size (a preset, the camera's
// shape or a custom size, and the shape an engine draws it at), the engine (Fast, Photoreal, or an
// engine of engines.ts with its own fields and what it starts from), Photoreal's quality and time
// limit, the format, where a Photoreal picture is made (this computer, or the cloud GPU when this user
// can pay for one), and the 3D view's own live quality. Each choice is written with setOutput
// (studio/output.ts) or patchRender (settings.ts), and one sync shows them all again. This does not
// import finalRender.ts (it loads three.js): the cloud's terms and price are read here.

import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import type { CameraInfo } from "../../../core/index.ts";
import { currentUser, onUser } from "../../../platform/api.ts";
import type { RenderTerms } from "../../../platform/protocol.ts";
import { config, onConfig } from "../../account/config.ts";
import { creditTerms, formatCredit } from "../../account/credit.ts";
import { engineFields, type EngineFields } from "../engineFields.ts";
import { onEngines, optionValues, renderEngines, type RenderEngine } from "../engines.ts";
import { webgpuAvailable, webgpuKnown } from "../gpuSupport.ts";
import { DEFAULT_RENDER, onRender, patchRender, renderSettings, type RenderSettings } from "../settings.ts";
import {
  ALL,
  CAMERA_PREFIX,
  FORMAT_IDS,
  FORMAT_LABELS,
  MAX_MINUTES,
  MAX_SIDE,
  MIN_SIDE,
  QUALITY,
  QUALITY_IDS,
  SIZE_PRESET_IDS,
  SIZE_PRESETS,
  VIEW,
  chosenCamera,
  megapixels,
  onOutput,
  outputPrefs,
  ratioLabel,
  setOutput,
  sizeOf,
  type BuiltInEngine,
  type OutputFormat,
  type Prefs,
  type Quality,
  type Size,
  type SizeId,
  type Where,
} from "./output.ts";
import { button, chips, group, note, number, row, segmented, select, slider, toggle, type Choice } from "./ui.ts";
import "./outputTab.css";

type PathTracer = RenderSettings["quality"]["engine"];
type Motion = RenderSettings["quality"]["motion"];

const SAMPLE_OPTIONS: readonly (readonly [number, string])[] = [
  [64, "64"],
  [128, "128"],
  [256, "256"],
  [512, "512"],
  [1024, "1024"],
  [100000, "Unlimited"],
];
const PATH_TRACERS: readonly (readonly [PathTracer, string])[] = [
  ["auto", "Auto"],
  ["webgpu", "WebGPU"],
  ["webgl", "WebGL"],
];
const MOTIONS: readonly (readonly [Motion, string])[] = [
  ["trace", "Path traced"],
  ["raster", "Realistic"],
];
const FAST_NOTE = "Lit like a photograph, in seconds.";
const PHOTOREAL_NOTE = "Light traced as it really falls: the most lifelike, takes longer.";
const LOST_ENGINE = "That render engine isn't available any more: choose another.";
const NO_WEBGPU = "This browser has no WebGPU: the WebGL path tracer draws.";

/** The drawing's Renderworks cameras (none with no drawing open). */
function cameras(): readonly CameraInfo[] {
  return store.session?.doc.cameras() ?? [];
}

/** A camera's name in the lists, or "Camera n" when it has none (finalRender.ts's cameraLabel). */
function cameraName(c: CameraInfo, index: number): string {
  return c.name.trim() || `Camera ${index + 1}`;
}

/** The Shots chip that stands for what Render's shots are (planOf): every camera, one camera, or the current view. */
function shownShot(p: Prefs, cams: readonly CameraInfo[]): string {
  if (p.camera === ALL) return cams.length >= 2 ? ALL : cams.length === 1 ? CAMERA_PREFIX + cams[0].id : VIEW;
  return chosenCamera(p, cams) ? p.camera : VIEW;
}

/** How many pictures a shot makes (one a camera, every camera for All cameras). */
function shotCount(p: Prefs, cams: readonly CameraInfo[]): number {
  return p.camera === ALL && cams.length > 0 ? cams.length : 1;
}

/** `size` shrunk to fit `side` px on its longer side, its shape kept, in whole pixels and never larger: as an engine draws it (finalRender.ts's fit). */
function fitTo(size: Size, side: number): Size {
  const scale = Math.min(1, side / Math.max(size.width, size.height));
  return { width: Math.max(MIN_SIDE, Math.round(size.width * scale)), height: Math.max(MIN_SIDE, Math.round(size.height * scale)) };
}

/** The server's cloud renders, when this user could pay for one: credit is on sale, or they have some already (finalRender.ts's cloudTerms). */
function cloudTerms(): RenderTerms | null {
  const terms = config()?.render ?? null;
  if (!terms) return null;
  return creditTerms()?.sold || (currentUser()?.aiCredit ?? 0) > 0 ? terms : null;
}

/** "About £0.04 a minute of GPU time, from your credit": a cloud render's price, as this user pays it (finalRender.ts's cloudPrice). */
function cloudPrice(t: RenderTerms): string {
  const credit = creditTerms();
  const perMinute = currentUser()?.plan === "supporter" ? t.plusPerMinute : t.perMinute;
  if (perMinute === null || !credit) return `Free on this server, up to ${t.maxMinutes} minutes a render.`;
  return `About ${formatCredit(perMinute, credit.currency)} a minute of GPU time, from your credit. Usually several times quicker than a laptop.`;
}

/** A note's text, or hidden when there is none; `warn` shows it in the warning colour. */
function setNote(el: HTMLElement, text: string, warn: boolean): void {
  el.textContent = text;
  el.hidden = text === "";
  el.classList.toggle("is-warn", warn);
}

/** The Output tab: what Render makes, set here and read back on every change. */
export function outputTab(): HTMLElement {
  // ---- Shots: the 3D view's current view, one camera, or every camera
  const shotsHolder = h("div");
  let shotsSig = "";
  let shotChips: Choice<string> | null = null;
  const pickShot = (camera: string): void => {
    // Camera's shape needs one camera: any other shot takes 4K back
    const oneCamera = chosenCamera({ camera }, cameras()) !== null;
    setOutput(outputPrefs().size === "shape" && !oneCamera ? { camera, size: "uhd" } : { camera });
  };
  const syncShots = (p: Prefs, cams: readonly CameraInfo[]): void => {
    const sig = cams.map((c) => `${c.id}\u0001${c.name}`).join("\u0002");
    if (!shotChips || sig !== shotsSig) {
      shotsSig = sig;
      const options: (readonly [string, string])[] = [[VIEW, "Current view"], ...cams.map((c, i): readonly [string, string] => [CAMERA_PREFIX + c.id, cameraName(c, i)])];
      if (cams.length >= 2) options.push([ALL, "All cameras"]);
      shotChips = chips("Shots", options, pickShot);
      // a camera's name is the drawing's own words: not translated
      for (const c of cams) if (c.name.trim()) shotChips.buttons.get(CAMERA_PREFIX + c.id)?.setAttribute("translate", "no");
      shotsHolder.replaceChildren(shotChips.el);
    }
    shotChips.set(shownShot(p, cams));
  };

  // ---- Size: a preset, the camera's shape, or a custom size
  const sizeChips = chips<SizeId>(
    "Size",
    [...SIZE_PRESET_IDS.map((id): readonly [SizeId, string] => [id, SIZE_PRESETS[id].short]), ["shape", "Camera's shape"], ["custom", "Custom"]],
    (id) => setOutput({ size: id }),
  );
  for (const id of SIZE_PRESET_IDS) {
    const b = sizeChips.buttons.get(id);
    if (b) b.title = SIZE_PRESETS[id].label;
  }
  const shapeChip = sizeChips.buttons.get("shape");
  if (shapeChip) shapeChip.title = "Camera's shape at 4K";
  const width = number("Width", "px", MIN_SIDE, MAX_SIDE, (n) => setOutput({ width: Math.round(n) }));
  const height = number("Height", "px", MIN_SIDE, MAX_SIDE, (n) => setOutput({ height: Math.round(n) }));
  const swap = button(
    "Swap",
    () => {
      const p = outputPrefs();
      setOutput({ width: p.height, height: p.width });
    },
    { small: true, title: "Swap width and height" },
  );
  const swapRow = h("div", { cls: "rs-output-swap" }, swap);
  const sizeLine = note("");
  sizeLine.classList.add("rs-output-size");

  // ---- Engine: Fast, Photoreal, or an engine of engines.ts
  const engineHolder = h("div");
  let engineSig = "";
  let engineChips: Choice<string> | null = null;
  const pickEngine = (id: string): void => {
    if (id === "realistic" || id === "pathtraced") setOutput({ engine: id, via: "" });
    else setOutput({ via: id });
  };
  const engineOptions = (engines: readonly RenderEngine[]): (readonly [string, string])[] => [
    ["realistic", "Fast"],
    ["pathtraced", "Photoreal"],
    ...engines.map((e): readonly [string, string] => [e.id, e.short]),
  ];
  const engineNote = note("");
  engineNote.classList.add("rs-output-engine-note");
  const startFrom = segmented<BuiltInEngine>(
    "Start from",
    [
      ["realistic", "Fast"],
      ["pathtraced", "Photoreal"],
    ],
    (e) => setOutput({ engine: e }),
  );
  const startRow = row("Start from", startFrom.el);
  // an engine's own fields, built for the engine Render uses (kept while it stays the one)
  const fieldsHolder = h("div", { cls: "rs-output-fields" });
  let shownFields: { readonly engine: RenderEngine; readonly fields: EngineFields } | null = null;
  const fieldsOf = (engine: RenderEngine): EngineFields => {
    if (shownFields?.engine === engine) return shownFields.fields;
    const fields: EngineFields = engineFields(engine, optionValues(engine, outputPrefs().options[engine.id]), () =>
      setOutput({ options: { ...outputPrefs().options, [engine.id]: fields.values() } }),
    );
    // the editor's one-key shortcuts stay out of the engine's boxes
    for (const r of fields.rows) r.querySelectorAll<HTMLElement>("input, textarea, select").forEach((c) => c.addEventListener("keydown", (e) => e.stopPropagation()));
    fieldsHolder.replaceChildren(...fields.rows);
    shownFields = { engine, fields };
    return fields;
  };
  const fieldsClear = (): void => {
    shownFields = null;
    fieldsHolder.replaceChildren();
  };
  const syncEngine = (p: Prefs, cams: readonly CameraInfo[]): RenderEngine | null => {
    const engines = renderEngines();
    const sig = engines.map((e) => e.id).join("\u0001");
    if (!engineChips || sig !== engineSig) {
      engineSig = sig;
      engineChips = chips("Engine", engineOptions(engines), pickEngine);
      engineHolder.replaceChildren(engineChips.el);
    }
    const via = p.via ? (engines.find((e) => e.id === p.via) ?? null) : null;
    engineChips.set(via ? via.id : p.engine);
    for (const e of engines) {
      const b = engineChips.buttons.get(e.id);
      const why = e.unavailable();
      if (b) {
        b.disabled = why !== null;
        b.title = why ?? e.label;
      }
    }
    // the note says what the chosen engine does, or why it can't make pictures now
    if (via) {
      const why = via.unavailable();
      const fields = fieldsOf(via);
      setNote(engineNote, why ?? (via.describe ? via.describe(fields.values(), shotCount(p, cams)) : ""), why !== null);
    } else {
      fieldsClear();
      setNote(engineNote, p.via ? LOST_ENGINE : p.engine === "pathtraced" ? PHOTOREAL_NOTE : FAST_NOTE, p.via !== "");
    }
    startRow.hidden = via?.takes !== "picture";
    startFrom.set(p.engine);
    return via;
  };

  // ---- Quality: Photoreal's samples, its time limit and denoise
  const qualityPick = segmented<Quality>(
    "Quality",
    QUALITY_IDS.map((id): readonly [Quality, string] => [id, QUALITY[id].short]),
    (q) => setOutput({ quality: q }),
  );
  const samplesNote = note("");
  const minutes = number("Stop after", "min", 0, MAX_MINUTES, (n) => setOutput({ minutes: n }), "Minutes a picture may take");
  const minutesNote = note("0: no limit");
  const denoise = toggle("Denoise", (on) => setOutput({ denoise: on }));

  // ---- File: the format (not for an engine's own pictures)
  const formatPick = segmented<OutputFormat>(
    "Format",
    FORMAT_IDS.map((id): readonly [OutputFormat, string] => [id, FORMAT_LABELS[id]]),
    (f) => setOutput({ format: f }),
  );

  // ---- Render on: this computer, or the cloud GPU (when this user can pay for one)
  const whereSeg = segmented<Where>(
    "Render on",
    [
      ["local", "This computer"],
      ["cloud", "Cloud GPU"],
    ],
    (w) => setOutput({ where: w }),
  );
  const cloudBtn = whereSeg.buttons.get("cloud");
  const whereNote = note("");

  // ---- Live view: the 3D view's own quality, as the old palette's Quality section
  const liveSamples = select<number>("Preview samples", SAMPLE_OPTIONS, (n) => patchRender("quality", { previewSamples: n }));
  const liveBounces = slider("Bounces", {
    min: 2,
    max: 12,
    step: 1,
    format: (v) => String(v),
    onInput: (n) => patchRender("quality", { bounces: n }),
    reset: DEFAULT_RENDER.quality.bounces,
  });
  const liveDenoise = toggle("Denoise the view", (on) => patchRender("quality", { denoise: on }));
  const liveEngine = select<PathTracer>("Path tracer", PATH_TRACERS, (e) => patchRender("quality", { engine: e }));
  const liveNoWebgpu = note(NO_WEBGPU);
  const liveMotion = select<Motion>("While moving", MOTIONS, (m) => patchRender("quality", { motion: m }));

  // ---- the groups
  const shotsGroup = group("Shots", { key: "output.shots" }, shotsHolder);
  const sizeGroup = group("Size", { key: "output.size" }, sizeChips.el, width.el, height.el, swapRow, sizeLine);
  const engineGroup = group("Engine", { key: "output.engine" }, engineHolder, engineNote, startRow, fieldsHolder);
  const qualityGroup = group("Quality", { key: "output.quality" }, qualityPick.el, samplesNote, minutes.el, minutesNote, denoise.el);
  const fileGroup = group("File", { key: "output.file" }, formatPick.el);
  const whereGroup = group("Render on", { key: "output.where" }, whereSeg.el, whereNote);
  const liveGroup = group(
    "Live view",
    { key: "output.live", folded: true },
    liveSamples.el,
    liveBounces.el,
    liveDenoise.el,
    liveEngine.el,
    liveNoWebgpu,
    liveMotion.el,
  );

  const sync = (): void => {
    const p = outputPrefs();
    const cams = cameras();
    syncShots(p, cams);

    const via = syncEngine(p, cams);
    const tracing = via ? via.takes === "picture" && p.engine === "pathtraced" : p.engine === "pathtraced";
    qualityGroup.el.hidden = !tracing;
    fileGroup.el.hidden = via !== null;
    qualityPick.set(p.quality);
    samplesNote.textContent = `${QUALITY[p.quality].samples} samples a picture`;
    minutes.set(p.minutes);
    denoise.set(p.denoise);
    formatPick.set(p.format);

    // the size: its chips, the custom sides, and the picture's shape (or why it can't be made)
    sizeChips.set(p.size);
    if (shapeChip) shapeChip.hidden = chosenCamera(p, cams) === null;
    const custom = p.size === "custom";
    width.el.hidden = !custom;
    height.el.hidden = !custom;
    swapRow.hidden = !custom;
    width.set(p.width);
    height.set(p.height);
    const sized = sizeOf(p, cams);
    if ("error" in sized) {
      setNote(sizeLine, sized.error, true);
    } else {
      const { width: w, height: hgt } = sized.size;
      const fitted = via?.maxSide ? fitTo(sized.size, via.maxSide) : null;
      const drawn = fitted && via && fitted.width < w ? ` · drawn at ${fitted.width} × ${fitted.height} px for ${via.short}` : "";
      setNote(sizeLine, `${w} × ${hgt} px · ${megapixels(w, hgt)} MP · ${ratioLabel(w, hgt)}${drawn}`, false);
    }

    // Render on: only for a Photoreal picture, when the server sells cloud renders to this user
    const cloud = cloudTerms();
    whereGroup.el.hidden = !(cloud && via === null && p.engine === "pathtraced");
    if (cloud) {
      if (cloudBtn) cloudBtn.textContent = `Cloud GPU (${cloud.gpu})`;
      whereNote.textContent = cloudPrice(cloud);
    }
    whereSeg.set(p.where);

    // the 3D view's own quality
    const q = renderSettings().quality;
    liveSamples.set(q.previewSamples);
    liveBounces.set(q.bounces);
    liveDenoise.set(q.denoise);
    liveEngine.set(q.engine);
    liveMotion.set(q.motion);
    liveNoWebgpu.hidden = webgpuKnown() !== false;
  };

  const root = h("div", { cls: "rs-output" }, shotsGroup.el, sizeGroup.el, engineGroup.el, qualityGroup.el, fileGroup.el, whereGroup.el, liveGroup.el);

  onOutput(sync);
  onEngines(sync);
  onConfig(sync);
  onUser(sync);
  onRender(sync);
  store.on("session", sync);
  // the browser's WebGPU answer lands after the first sync: the note follows it
  void webgpuAvailable().then(sync);
  return root;
}
