// File > Export > Render Image…: asks the camera, size, engine and quality, then makes each picture
// (the 3D view's current view, or a Renderworks camera's; each camera for All cameras) in a canvas of
// its own. Fast uses the Realistic engine; Photoreal the path tracer, a few samples per slice so the
// progress window stays live. Cancel discards the job; Finish now keeps the picture in hand and stops.
// An engine of engines.ts (AI, or a plug-in's) takes the built-in engine's picture, or the model and
// its camera, and makes the pictures from it: its fields show under the Engine, and the viewer shows
// what it made beside the picture it started from. Batch render jobs and Export HDRI keep to the two
// built-in engines. The pictures open in the render viewer (viewer.ts). Batch render jobs (batch.ts) are edited in
// its dialog and made by its makePictures. File > Export > Export HDRI… asks the same without the
// format or the cloud and saves each picture as a Radiance HDR file, linear and unclipped (hdr.ts).
// This file loads with the renderers, not the editor.

import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { downloadBlob } from "../../app/fileio.ts";
import { sunPlace } from "../../app/heliodon.ts";
import { withoutHidden } from "../../app/hiddenObjects.ts";
import { showDialog, type DialogCheck } from "../../app/menubar.ts";
import { store } from "../../app/state.ts";
import { note, reportFailure } from "../../app/reports.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { View3D } from "../../app/view3d.ts";
import type { CameraInfo } from "../../core/index.ts";
import { shotOfCamera, shotOfView, type Shot } from "./camera.ts";
import { EngineRefusal, optionValues, renderEngines, type EngineOutput, type OptionValues, type RenderEngine } from "./engines.ts";
import { engineFields, type EngineFields } from "./engineFields.ts";
import { prepareLibrary } from "./library.ts";
import { buildScene, type RenderScene } from "./sceneBuilder.ts";
import { renderSettings, type RenderSettings } from "./settings.ts";
import { currentUser } from "../../platform/api.ts";
import type { RenderTerms } from "../../platform/protocol.ts";
import { config } from "../account/config.ts";
import { formatCredit, creditTerms } from "../account/credit.ts";
import { requireSignIn } from "../account/signin.ts";
import { zipFiles } from "../../export/zip.ts";
import { showProgress } from "./progress.ts";
import { renderStill, type Engine, type Format, type Job, type StillBox } from "./still.ts";
import { showRenderResult, type RenderResult } from "./viewer.ts";
import "./finalRender.css";

type Quality = "draft" | "good" | "high" | "best";
/** this computer's GPU, or the server's cloud renders (cloud.ts) */
type Where = "local" | "cloud";
type SizePreset = "hd" | "qhd" | "uhd" | "dci" | "square" | "a4";
type SizeId = SizePreset | "shape" | "custom";

/** The choices kept between renders (localStorage), and with each batch render job (batch.ts). */
export interface Prefs {
  /** VIEW, ALL, or CAMERA_PREFIX and a camera's id */
  readonly camera: string;
  readonly size: SizeId;
  readonly width: number;
  readonly height: number;
  readonly engine: Engine;
  readonly quality: Quality;
  /** minutes a picture may take, 0 for no limit */
  readonly minutes: number;
  readonly denoise: boolean;
  readonly format: Format;
  readonly where: Where;
  /** "" for the built-in engine alone, else the id of the engine of engines.ts that makes the pictures */
  readonly via: string;
  /** each such engine's fields as last chosen, by its id */
  readonly options: Readonly<Record<string, OptionValues>>;
}

/** One picture to make: null camera is the 3D view's current view, or `shot` when there is one. */
export interface ShotPlan {
  readonly label: string;
  readonly camera: CameraInfo | null;
  /** a view kept from before (a batch render job's) */
  readonly shot?: Shot;
}

/** What the dialog resolves with. */
export interface Plan {
  /** a batch render job's name */
  readonly name?: string;
  readonly shots: readonly ShotPlan[];
  readonly width: number;
  readonly height: number;
  readonly engine: Engine;
  /** samples a Photoreal picture takes */
  readonly samples: number;
  readonly minutes: number;
  readonly denoise: boolean;
  readonly format: Format;
  /** where a Photoreal job runs (a Fast one always runs here) */
  readonly where: Where;
  /** the engine of engines.ts that makes the pictures from the built-in one's (or from the model), with its fields' values */
  readonly via: { readonly engine: RenderEngine; readonly options: OptionValues } | null;
  readonly prefs: Prefs;
}

interface Size {
  readonly width: number;
  readonly height: number;
}

type SizeCheck = { readonly size: Size } | { readonly error: string; readonly focus?: HTMLElement };

const PREFS_KEY = "openvwx.renderImage.v1";
/** Export HDRI's choices, kept apart from Render Image's */
const HDR_PREFS_KEY = "openvwx.exportHdri.v1";
const VIEW = "view";
const ALL = "all";
const CAMERA_PREFIX = "camera:";
const MIN_SIDE = 16;
const MAX_SIDE = 8192;
const SHAPE_WIDTH = 3840;
const MAX_MINUTES = 600;
/** The most pixels an HDR file's picture takes: it is drawn in 32-bit floats, 16 bytes a pixel on the graphics card */
const MAX_HDR_PIXELS = 4096 * 4096;
const SELECT_CLS = "menu-dialog-input menu-dialog-select render-select";

const PRESETS: Readonly<Record<SizePreset, { readonly label: string; readonly width: number; readonly height: number }>> = {
  hd: { label: "HD 1920 × 1080", width: 1920, height: 1080 },
  qhd: { label: "QHD 2560 × 1440", width: 2560, height: 1440 },
  uhd: { label: "4K UHD 3840 × 2160", width: 3840, height: 2160 },
  dci: { label: "4K DCI 4096 × 2160", width: 4096, height: 2160 },
  square: { label: "Square 2160 × 2160", width: 2160, height: 2160 },
  a4: { label: "A4 at 300 dpi 3508 × 2480", width: 3508, height: 2480 },
};
const PRESET_IDS: readonly SizePreset[] = ["hd", "qhd", "uhd", "dci", "square", "a4"];
const SIZE_IDS: readonly SizeId[] = [...PRESET_IDS, "shape", "custom"];
const ENGINE_IDS: readonly Engine[] = ["realistic", "pathtraced"];
const ENGINE_LABELS: Readonly<Record<Engine, string>> = {
  realistic: "Fast — Realistic",
  pathtraced: "Photoreal — Path traced",
};
const QUALITY_IDS: readonly Quality[] = ["draft", "good", "high", "best"];
const QUALITY: Readonly<Record<Quality, { readonly label: string; readonly samples: number }>> = {
  draft: { label: "Draft — 64 samples", samples: 64 },
  good: { label: "Good — 256 samples", samples: 256 },
  high: { label: "High — 1024 samples", samples: 1024 },
  best: { label: "Best — 4096 samples", samples: 4096 },
};
const FORMAT_IDS: readonly Format[] = ["png", "jpeg"];
const WHERE_IDS: readonly Where[] = ["local", "cloud"];
const FORMAT_LABELS: Readonly<Record<Format, string>> = { png: "PNG", jpeg: "JPEG (92 %)", hdr: "Radiance HDR" };

/** File > Export > Render Image…: asks what to render, makes the pictures and opens them in the render viewer. */
export async function renderImageDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const plan = await askRender(session.doc.cameras(), cloudTerms());
  if (!plan) return;
  savePrefs(plan.prefs);
  // the engine's own checks before anything is drawn: signing in, enough credit
  if (plan.via?.engine.prepare && !(await plan.via.engine.prepare(plan.via.options, plan.shots.length))) return;
  if (plan.where === "cloud") await runCloud(plan);
  else await runJob(plan);
}

/**
 * File > Export > Export HDRI…: Render Image's camera, size, engine and quality, then each picture made
 * here and saved as a Radiance HDR file (several cameras' in one zip). The picture is linear, after the
 * fog, exposure and white balance and before tone mapping and grading.
 */
export async function exportHdriDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const plan = await askRender(session.doc.cameras(), null, undefined, true);
  if (!plan) return;
  savePrefs(plan.prefs, HDR_PREFS_KEY);
  const job: Job = { cancelled: false, finishNow: false };
  const box = showProgress({
    title: "Export HDRI",
    finishable: plan.engine === "pathtraced",
    onFinish: () => (job.finishNow = true),
    onCancel: () => (job.cancelled = true),
  });
  const results: RenderResult[] = [];
  try {
    await makePictures(plan, job, box, results);
  } catch (err) {
    toast(`Export HDRI failed: ${errorMessage(err)}`);
  } finally {
    box.close();
  }
  if (job.cancelled || !results.length) return;
  const stem = fileSafe((store.fileName || "Untitled").replace(/\.vwx$/i, ""));
  if (results.length === 1) {
    downloadBlob(`${stem}.hdr`, results[0].blob);
  } else {
    const files: [string, Uint8Array][] = [];
    for (const r of results) files.push([`${stem} ${fileSafe(r.name)}.hdr`, new Uint8Array(await r.blob.arrayBuffer())]);
    downloadBlob(`${stem} HDRI.zip`, new Blob([zipFiles(files, true) as BlobPart], { type: "application/zip" }));
  }
  toast(`Exported ${results.length === 1 ? "the HDR picture" : `${results.length} HDR pictures`} (${plan.width} × ${plan.height} px).`, "info");
}

/** A name a file can take on every system. */
function fileSafe(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").trim() || "Picture";
}

/**
 * The server's cloud renders, when this user could pay for one: credit is on sale, or they have
 * some already (a grant, while the server doesn't sell it).
 */
function cloudTerms(): RenderTerms | null {
  const terms = config()?.render ?? null;
  if (!terms) return null;
  return creditTerms()?.sold || (currentUser()?.aiCredit ?? 0) > 0 ? terms : null;
}

/** One picture renderPicture makes. */
export interface PictureSpec {
  /** a Renderworks camera's id, or null for the 3D view as it looks now */
  readonly cameraId: string | null;
  readonly width: number;
  readonly height: number;
  readonly engine: "realistic" | "pathtraced";
  /** samples a path-traced picture takes */
  readonly samples: number;
  /** minutes it may take, 0 for no limit */
  readonly minutes: number;
  readonly format: "png" | "jpeg";
  /** stops it: the picture so far is kept */
  readonly signal?: AbortSignal;
  readonly onProgress?: (text: string, fraction: number | null) => void;
}

/**
 * Makes one picture as Render Image does, without its dialog or windows (the Agents panel's
 * renders), with the Render palette's settings. Null when there is no 3D view or no picture was
 * made; throws for a camera the drawing doesn't have or a size out of range.
 */
export async function renderPicture(spec: PictureSpec): Promise<RenderResult | null> {
  const session = store.session;
  if (!session) throw new Error("no drawing is open");
  const camera = spec.cameraId === null ? null : (session.doc.cameras().find((c) => c.id === spec.cameraId) ?? null);
  if (spec.cameraId !== null && !camera) throw new Error(`the drawing has no camera ${spec.cameraId}`);
  if (![spec.width, spec.height].every((v) => Number.isInteger(v) && v >= MIN_SIDE && v <= MAX_SIDE)) {
    throw new Error(`a picture is ${MIN_SIDE} to ${MAX_SIDE} px a side`);
  }
  const plan: Plan = {
    shots: [{ label: camera ? camera.name || "Camera" : "Current view", camera }],
    width: spec.width,
    height: spec.height,
    engine: spec.engine,
    samples: Math.max(1, Math.round(spec.samples)),
    minutes: Math.max(0, spec.minutes),
    denoise: renderSettings().quality.denoise,
    format: spec.format,
    where: "local",
    via: null,
    prefs: {
      camera: VIEW,
      size: "custom",
      width: spec.width,
      height: spec.height,
      engine: spec.engine,
      quality: "draft",
      minutes: spec.minutes,
      denoise: true,
      format: spec.format,
      where: "local",
      via: "",
      options: {},
    },
  };
  const job: Job = { cancelled: false, finishNow: false };
  // stopping keeps the picture in hand, as Finish now does
  spec.signal?.addEventListener("abort", () => (job.finishNow = true), { once: true });
  const box: StillBox = {
    label: (text) => spec.onProgress?.(text, null),
    bar: () => {},
    picture: () => {},
  };
  const results: RenderResult[] = [];
  await makePictures(plan, job, box, results);
  return results[0] ?? null;
}

/** The dialog as a batch render job's editor (batch.ts): its title and button, and the job's name. */
export interface JobForm {
  readonly title: string;
  readonly okLabel: string;
  readonly name: string;
  readonly start: Prefs;
  /** the other jobs' names, which this one may not take */
  readonly taken: ReadonlySet<string>;
}

/**
 * The dialog: the camera, size, engine and quality, and where a Photoreal picture is made when the
 * server has cloud renders; with `form`, a batch render job's name too. Resolves with the plan, or
 * null when cancelled.
 */
export function askRender(cams: readonly CameraInfo[], cloud: RenderTerms | null, form?: JobForm, hdr = false): Promise<Plan | null> {
  const start = form?.start ?? readPrefs(defaultPrefs(), hdr ? HDR_PREFS_KEY : PREFS_KEY);
  const nameInput = h("input", { cls: "menu-dialog-input", value: form?.name ?? "", attrs: { type: "text", "aria-label": "Name" } });
  const singleCamera = (value: string): CameraInfo | null => cams.find((c) => CAMERA_PREFIX + c.id === value) ?? null;

  const cameraSel = h(
    "select",
    { cls: SELECT_CLS, attrs: { "aria-label": "Camera" } },
    h("option", { text: "Current view", value: VIEW }),
    ...cams.map((c, i) => h("option", { text: cameraLabel(c, i), value: CAMERA_PREFIX + c.id })),
    ...(cams.length > 1 ? [h("option", { text: "All cameras", value: ALL })] : []),
  );
  cameraSel.value = start.camera;
  if (cameraSel.selectedIndex < 0) cameraSel.value = VIEW;

  // the shape of one camera is offered only when one camera is chosen
  const sizeSel = h("select", { cls: SELECT_CLS, attrs: { "aria-label": "Size" } });
  const fillSizes = (keep: string): void => {
    const ids: SizeId[] = [...PRESET_IDS];
    if (singleCamera(cameraSel.value)) ids.push("shape");
    ids.push("custom");
    sizeSel.replaceChildren(...ids.map((id) => h("option", { text: sizeLabel(id), value: id })));
    sizeSel.value = keep;
    if (sizeSel.selectedIndex < 0) sizeSel.value = "uhd";
  };
  fillSizes(start.size);

  const dimension = (value: number, label: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value: String(value), attrs: { type: "number", step: "any", "aria-label": label } });
  const width = dimension(start.width, "Width in pixels");
  const height = dimension(start.height, "Height in pixels");
  const hint = h("p", { cls: "render-hint" });

  // the engines of engines.ts after the built-in ones, for a Render Image of its own
  const extra = form || hdr ? [] : renderEngines();
  const engineSel = h(
    "select",
    { cls: SELECT_CLS, attrs: { "aria-label": "Engine" } },
    ...ENGINE_IDS.map((id) => h("option", { text: ENGINE_LABELS[id], value: id })),
    ...extra.map((e) => {
      const why = e.unavailable();
      return h("option", { text: why ? `${e.label} (${why})` : e.label, value: e.id, disabled: why !== null });
    }),
  );
  engineSel.value = extra.some((e) => e.id === start.via && e.unavailable() === null) ? start.via : start.engine;
  const chosenVia = (): RenderEngine | null => extra.find((e) => e.id === engineSel.value) ?? null;
  // what a picture-taking engine starts from: a built-in engine's picture
  const baseSel = h(
    "select",
    { cls: SELECT_CLS, attrs: { "aria-label": "Start from" } },
    ...ENGINE_IDS.map((id) => h("option", { text: ENGINE_LABELS[id], value: id })),
  );
  baseSel.value = start.engine;
  const baseRow = field("Start from", baseSel);
  const fieldsBy = new Map<string, EngineFields>(extra.map((e) => [e.id, engineFields(e, optionValues(e, start.options[e.id]), () => update())]));
  const engineRows = [...fieldsBy.values()].flatMap((f) => f.rows);
  const describe = h("p", { cls: "render-hint render-engine-note" });
  const qualitySel = h(
    "select",
    { cls: SELECT_CLS, attrs: { "aria-label": "Quality" } },
    ...QUALITY_IDS.map((id) => h("option", { text: QUALITY[id].label, value: id })),
  );
  qualitySel.value = start.quality;
  const minutes = h("input", {
    cls: "menu-dialog-input",
    value: String(start.minutes),
    title: "0 for no limit",
    attrs: { type: "number", step: "any", "aria-label": "Stop after, in minutes" },
  });
  const denoise = h("input", { attrs: { type: "checkbox" }, checked: start.denoise });
  const formatSel = h(
    "select",
    { cls: SELECT_CLS, attrs: { "aria-label": "Format" } },
    ...FORMAT_IDS.map((id) => h("option", { text: FORMAT_LABELS[id], value: id })),
  );
  formatSel.value = start.format;
  const whereSel = h(
    "select",
    { cls: SELECT_CLS, attrs: { "aria-label": "Render on" } },
    h("option", { text: "This computer", value: "local" }),
    h("option", { text: cloud ? `Cloud GPU (${cloud.gpu})` : "Cloud GPU", value: "cloud" }),
  );
  whereSel.value = cloud ? start.where : "local";
  const whereHint = h("p", { cls: "render-hint", text: cloud ? cloudPrice(cloud) : "" });
  const whereRows = cloud ? [field("Render on", whereSel), whereHint] : [];
  const formatRow = field("Format", formatSel);

  const customRows = [field("Width", width, "px"), field("Height", height, "px")];
  const pathRows = [
    field("Quality", qualitySel),
    field("Stop after (0 for no limit)", minutes, "min"),
    h("label", { cls: "menu-dialog-check" }, denoise, "Denoise"),
  ];

  const sizeCheck = (): SizeCheck => {
    const id = pick<SizeId>(sizeSel.value, SIZE_IDS, "uhd");
    if (id === "custom") {
      const w = Number(width.value);
      const hgt = Number(height.value);
      if (!isSide(w)) return { error: `Width: a whole number of pixels from ${MIN_SIDE} to ${MAX_SIDE}.`, focus: width };
      if (!isSide(hgt)) return { error: `Height: a whole number of pixels from ${MIN_SIDE} to ${MAX_SIDE}.`, focus: height };
      return { size: { width: w, height: hgt } };
    }
    if (id === "shape") {
      const cam = singleCamera(cameraSel.value);
      const aspect = cam ? cam.aspect : 0;
      if (!(aspect > 0 && Number.isFinite(aspect))) return { error: "This camera has no shape to match: choose another size.", focus: sizeSel };
      const hgt = Math.max(2, Math.round(SHAPE_WIDTH / aspect / 2) * 2);
      if (!isSide(hgt)) {
        return { error: `The camera's shape at 4K is ${hgt} px high, outside ${MIN_SIDE} to ${MAX_SIDE} px: choose another size.`, focus: sizeSel };
      }
      return { size: { width: SHAPE_WIDTH, height: hgt } };
    }
    return { size: { width: PRESETS[id].width, height: PRESETS[id].height } };
  };

  /** the pictures the job makes before an engine's variations: one a camera */
  const shotCount = (): number => (cameraSel.value === ALL ? cams.length : 1);
  /** a path-traced picture is drawn: the built-in engine's, or the one an engine starts from */
  const tracing = (): boolean => {
    const via = chosenVia();
    return via ? via.takes === "picture" && baseSel.value === "pathtraced" : engineSel.value === "pathtraced";
  };

  const update = (): void => {
    const via = chosenVia();
    const path = tracing();
    baseRow.hidden = via?.takes !== "picture";
    for (const row of pathRows) row.hidden = !path;
    for (const row of whereRows) row.hidden = !path || via !== null;
    whereHint.hidden = !path || via !== null || whereSel.value !== "cloud";
    formatRow.hidden = via !== null;
    for (const [id, f] of fieldsBy) f.show(via?.id === id);
    const said = via ? (via.describe?.(fieldsBy.get(via.id)?.values() ?? {}, shotCount()) ?? "") : "";
    describe.textContent = said;
    describe.hidden = said === "";
    for (const row of customRows) row.hidden = sizeSel.value !== "custom";
    const size = sizeCheck();
    const fitted = "size" in size && via?.maxSide ? fit(size.size, via.maxSide) : null;
    hint.textContent =
      "size" in size
        ? `${size.size.width} × ${size.size.height} px · ${megapixels(size.size.width, size.size.height)} megapixels` +
          (fitted && fitted.width < size.size.width ? ` · drawn at ${fitted.width} × ${fitted.height} px for ${via?.short ?? "the engine"}` : "")
        : "";
  };

  cameraSel.addEventListener("change", () => {
    fillSizes(sizeSel.value);
    update();
  });
  const live: readonly HTMLElement[] = [sizeSel, engineSel, baseSel, width, height, minutes, whereSel];
  for (const el of live) {
    el.addEventListener("input", update);
    el.addEventListener("change", update);
  }
  update();

  const check = (): DialogCheck<Plan> => {
    const name = nameInput.value.trim();
    if (form && !name) return { error: "Name the job.", focus: nameInput };
    if (form?.taken.has(name)) return { error: `There is a job named “${name}” already.`, focus: nameInput };
    const size = sizeCheck();
    if (!("size" in size)) return size;
    if (hdr && size.size.width * size.size.height > MAX_HDR_PIXELS) {
      return { error: `An HDR picture is at most ${megapixels(4096, 4096)} megapixels (4096 × 4096): choose a smaller size.`, focus: sizeSel };
    }
    const via = chosenVia();
    const why = via?.unavailable() ?? null;
    if (why) return { error: why, focus: engineSel };
    const path = tracing();
    const mins = Number(minutes.value);
    const minutesOk = minutes.value.trim() !== "" && mins >= 0 && mins <= MAX_MINUTES;
    if (path && !minutesOk) return { error: `Stop after: from 0 to ${MAX_MINUTES} minutes (0 for no limit).`, focus: minutes };

    const engine = via ? pick<Engine>(baseSel.value, ENGINE_IDS, "realistic") : pick<Engine>(engineSel.value, ENGINE_IDS, "pathtraced");
    const options: Record<string, OptionValues> = { ...start.options };
    for (const [id, f] of fieldsBy) options[id] = f.values();
    const quality = pick<Quality>(qualitySel.value, QUALITY_IDS, "good");
    const format: Format = hdr ? "hdr" : pick<Format>(formatSel.value, FORMAT_IDS, "png");
    const where = cloud ? pick<Where>(whereSel.value, WHERE_IDS, "local") : start.where;
    const camera = cameraSel.value;
    const chosen = singleCamera(camera);
    const shots: ShotPlan[] =
      camera === ALL
        ? cams.map((c, i) => ({ label: cameraLabel(c, i), camera: c }))
        : chosen
          ? [{ label: cameraLabel(chosen, cams.indexOf(chosen)), camera: chosen }]
          : [{ label: "Current view", camera: null }];
    const typedWidth = Number(width.value);
    const typedHeight = Number(height.value);
    const prefs: Prefs = {
      camera,
      size: pick<SizeId>(sizeSel.value, SIZE_IDS, "uhd"),
      width: isSide(typedWidth) ? typedWidth : start.width,
      height: isSide(typedHeight) ? typedHeight : start.height,
      engine,
      quality,
      minutes: minutesOk ? mins : start.minutes,
      denoise: denoise.checked,
      format,
      where,
      via: via?.id ?? "",
      options,
    };
    return {
      value: {
        ...(form ? { name } : {}),
        shots,
        width: size.size.width,
        height: size.size.height,
        engine,
        samples: QUALITY[quality].samples,
        minutes: minutesOk ? mins : 0,
        denoise: denoise.checked,
        format,
        where: engine === "pathtraced" && cloud && !via ? where : "local",
        via: via ? { engine: via, options: options[via.id] } : null,
        prefs,
      },
    };
  };

  return showDialog<Plan>({
    title: form?.title ?? (hdr ? "Export HDRI" : "Render Image"),
    okLabel: form?.okLabel ?? (hdr ? "Export" : "Render"),
    cls: "render-dialog",
    body: [
      ...(form ? [field("Name", nameInput)] : []),
      field("Camera", cameraSel),
      field("Size", sizeSel),
      ...customRows,
      hint,
      field("Engine", engineSel),
      baseRow,
      ...engineRows,
      describe,
      ...pathRows,
      ...whereRows,
      ...(hdr ? [] : [formatRow]),
    ],
    check,
  });
}

/** Runs the job under its progress window, then opens the pictures made (none when cancelled). */
async function runJob(plan: Plan): Promise<void> {
  const job: Job = { cancelled: false, finishNow: false };
  const box = showProgress({
    finishable: plan.engine === "pathtraced",
    onFinish: () => (job.finishNow = true),
    onCancel: () => (job.cancelled = true),
  });
  const results: RenderResult[] = [];
  try {
    await makePictures(plan, job, box, results);
  } catch (err) {
    // an engine's own refusal (signing in, credit, its provider's no) is said, not reported
    if (err instanceof EngineRefusal) {
      toast(err.message);
    } else {
      toast(`Render failed: ${errorMessage(err)}`);
      reportFailure("render", err, { ...planDetails(plan), made: results.length });
    }
  } finally {
    box.close();
  }
  if (!job.cancelled && results.length > 0) showRenderResult(results);
}

/** A render's settings as an error report carries them. */
export function planDetails(plan: Plan): Record<string, string | number | boolean> {
  return {
    engine: plan.engine,
    size: `${plan.width}×${plan.height}`,
    samples: plan.samples,
    shots: plan.shots.length,
    minutes: plan.minutes,
    denoise: plan.denoise,
    format: plan.format,
    where: plan.where,
    via: plan.via?.engine.id ?? "",
  };
}

/** Sends the job to the server's cloud GPU (cloud.ts), once the user is signed in. */
async function runCloud(plan: Plan): Promise<void> {
  if (!(await requireSignIn("Sign in to render in the cloud: it's paid for from your credit."))) return;
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view) {
    toast("The 3D view is not available here, so there is nothing to render.");
    return;
  }
  await view.ensureTextures();
  const { runCloudJob } = await import("./cloud.ts");
  await runCloudJob(view, {
    name: store.fileName || "Untitled",
    still: { width: plan.width, height: plan.height, engine: plan.engine, samples: plan.samples, minutes: plan.minutes, format: plan.format },
    settings: jobSettings(plan),
    viz: store.viz3d,
    shots: plan.shots.map((target) => ({ label: target.label, shot: shotFor(view, target) })),
  });
}

/** "About £0.04 a minute of GPU time, from your credit": a cloud render's price, as the user pays it. */
function cloudPrice(t: RenderTerms): string {
  const credit = creditTerms();
  const perMinute = currentUser()?.plan === "supporter" ? t.plusPerMinute : t.perMinute;
  if (perMinute === null || !credit) return `Free on this server, up to ${t.maxMinutes} minutes a render.`;
  return `About ${formatCredit(perMinute, credit.currency)} a minute of GPU time, from your credit. Usually several times quicker than a laptop.`;
}

/** Makes the pictures in turn into `results`. Cancel stops at once; Finish now stops after the picture in hand. */
export async function makePictures(plan: Plan, job: Job, box: StillBox, results: RenderResult[]): Promise<void> {
  const ctx = appContext();
  const view = ctx ? await ctx.show3d() : null;
  if (!view) {
    toast("The 3D view is not available here, so there is nothing to render.");
    reportFailure("render", new Error("The 3D view is not available"), planDetails(plan));
    return;
  }
  if (job.cancelled) return;
  note(`render: ${plan.engine} ${plan.width}×${plan.height}, ${plan.samples} samples, ${plan.shots.length} shot(s)`);
  await view.ensureTextures();
  if (job.cancelled) return;

  const settings = jobSettings(plan);
  await prepareLibrary(settings);
  if (job.cancelled) return;
  const via = plan.via;
  // the model as glTF, made once for an engine that takes the scene
  let glb: Promise<Uint8Array> | null = null;
  const sceneOf = (): Promise<Uint8Array> => (glb ??= sceneGlb(view));
  // one scene for every picture of the job: it is built once, from the first picture that fits
  let scene: RenderScene | null = null;
  try {
    for (const [i, target] of plan.shots.entries()) {
      if (job.cancelled || (results.length > 0 && job.finishNow)) return;
      const prefix = plan.shots.length > 1 ? `Shot ${i + 1} of ${plan.shots.length} · ` : "";
      const started = performance.now();
      if (via?.engine.takes === "scene") {
        const outputs = await runEngine(via, { plan, shot: shotFor(view, target), name: target.label, picture: null, scene: sceneOf, job, box, prefix });
        for (const o of outputs) results.push(await engineResult(o, via.engine, target.label, null, started));
        continue;
      }
      if (!scene) {
        const started = performance.now();
        scene = buildScene({ faces: view.modelFaces(), content: view.visibleContent(), lights: view.visibleLights() }, settings, store.viz3d);
        note(`render: scene built in ${Math.round(performance.now() - started)} ms`);
      }
      // an engine that paints the picture gets it at its own size
      const drawn = via?.engine.maxSide ? { ...plan, ...fit(plan, via.engine.maxSide) } : plan;
      const shot = shotFor(view, target);
      const still = await renderStill(scene, shot, drawn, settings, job, box, { prefix, laterShots: plan.shots.length - i - 1 });
      if (!still) return;
      if (!via) {
        results.push({ ...still, width: drawn.width, height: drawn.height, name: target.label, engine: plan.engine === "realistic" ? "Realistic" : "Path traced" });
        continue;
      }
      if (job.cancelled) return;
      const outputs = await runEngine(via, { plan: drawn, shot, name: target.label, picture: still.blob, scene: sceneOf, job, box, prefix });
      for (const o of outputs) results.push(await engineResult(o, via.engine, target.label, still.blob, started));
    }
  } finally {
    scene?.dispose();
  }
}

/** What runEngine hands an engine for one shot. */
interface EngineShot {
  readonly plan: Pick<Plan, "width" | "height">;
  readonly shot: Shot;
  readonly name: string;
  readonly picture: Blob | null;
  readonly scene: () => Promise<Uint8Array>;
  readonly job: Job;
  readonly box: StillBox;
  readonly prefix: string;
}

/** Has `via`'s engine make one shot's pictures; Cancel stops it (none then). */
async function runEngine(via: NonNullable<Plan["via"]>, s: EngineShot): Promise<readonly EngineOutput[]> {
  const stop = new AbortController();
  // the progress window's Cancel sets job.cancelled: the engine's request stops with it
  const watch = window.setInterval(() => s.job.cancelled && stop.abort(), 200);
  s.box.bar(null);
  try {
    return await via.engine.render({
      width: s.plan.width,
      height: s.plan.height,
      name: s.name,
      camera: { eye: s.shot.eye, target: s.shot.target, perspective: s.shot.perspective, fov: s.shot.fov, halfHeight: s.shot.halfHeight },
      sun: sunToward(),
      options: via.options,
      picture: s.picture,
      scene: s.scene,
      signal: stop.signal,
      progress: (text, fraction) => {
        s.box.label(s.prefix + text);
        s.box.bar(fraction);
      },
    });
  } catch (err) {
    if (stop.signal.aborted) return [];
    throw err;
  } finally {
    window.clearInterval(watch);
  }
}

/** A picture an engine made, as the viewer shows it: its size read from the picture itself. */
async function engineResult(o: EngineOutput, engine: RenderEngine, name: string, before: Blob | null, started: number): Promise<RenderResult> {
  let width = 0;
  let height = 0;
  try {
    const bitmap = await createImageBitmap(o.blob);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  } catch {
    // not a picture this browser decodes: the viewer says so when it shows it
  }
  return { blob: o.blob, width, height, name, engine: engine.short, samples: null, seconds: (performance.now() - started) / 1000, ...(o.note ? { note: o.note } : {}), ...(before ? { before } : {}) };
}

/** Toward the sun (world, z up), as the Realistic and path-traced pictures place it; null with the sun off or down. */
function sunToward(): [number, number, number] | null {
  // where the Realistic and path-traced pictures have it: the Heliodon's, whenever the Render palette's sun is on
  if (!renderSettings().sun.on) return null;
  const place = sunPlace(store.viz3d);
  return place.altitude > 0 ? [place.dir.x, place.dir.y, place.dir.z] : null;
}

/** The design layers the 3D view shows, as binary glTF, without hidden objects. */
async function sceneGlb(view: View3D): Promise<Uint8Array> {
  const session = store.session;
  if (!session) throw new Error("no drawing is open");
  const doc = withoutHidden(session.doc);
  const layers = view.shownLayers ?? new Set(doc.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden").map((l) => l.id));
  const { exportGlb } = await import("../../export/model3d.ts");
  return new Uint8Array(await exportGlb(doc, layers));
}

/** `size` shrunk to fit `side` px on its longer side, its shape kept, in whole pixels (never larger). */
function fit(size: Size, side: number): Size {
  const scale = Math.min(1, side / Math.max(size.width, size.height));
  return { width: Math.max(MIN_SIDE, Math.round(size.width * scale)), height: Math.max(MIN_SIDE, Math.round(size.height * scale)) };
}

/** The render settings for this job: the palette's, with the dialog's denoise and sample count. */
function jobSettings(plan: Plan): RenderSettings {
  const base = renderSettings();
  return { ...base, quality: { ...base.quality, previewSamples: plan.samples, denoise: plan.denoise } };
}

function shotFor(view: View3D, target: ShotPlan): Shot {
  if (target.shot) return target.shot;
  return target.camera ? shotOfCamera(target.camera) : shotOfView(view.activeCamera, view.orbitTarget);
}

function field(label: string, control: HTMLElement, unit = ""): HTMLLabelElement {
  return h(
    "label",
    { cls: "menu-dialog-field" },
    h("span", { cls: "menu-dialog-label", text: label }),
    control,
    unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null,
  );
}

function sizeLabel(id: SizeId): string {
  if (id === "shape") return "Camera's shape at 4K";
  if (id === "custom") return "Custom";
  return PRESETS[id].label;
}

/** A camera's name in the lists, or "Camera n" when it has none. */
export function cameraLabel(c: CameraInfo, index: number): string {
  return c.name.trim() || `Camera ${index + 1}`;
}

/** A picture side the dialog and the job accept: a whole number of pixels. */
function isSide(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_SIDE && v <= MAX_SIDE;
}

/** Megapixels of a picture, to one decimal place (two below a tenth). */
function megapixels(width: number, height: number): string {
  const mp = (width * height) / 1e6;
  return mp < 0.1 ? mp.toFixed(2) : mp.toFixed(1);
}

function pick<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.find((o) => o === value) ?? fallback;
}

/** The choices Render Image starts with: the last render's. */
export function lastPrefs(): Prefs {
  return readPrefs(defaultPrefs());
}

function defaultPrefs(): Prefs {
  return {
    camera: VIEW,
    size: "uhd",
    width: 1920,
    height: 1080,
    engine: "pathtraced",
    quality: "good",
    minutes: 0,
    denoise: renderSettings().quality.denoise,
    format: "png",
    where: "local",
    via: "",
    options: {},
  };
}

/** The choices kept from the last render, over `defaults`; anything unreadable or out of range falls back. */
function readPrefs(defaults: Prefs, key = PREFS_KEY): Prefs {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    // storage blocked or not JSON: the defaults
  }
  return prefsFrom(parsed, defaults);
}

/** Choices as read back from storage, over `defaults`; anything unreadable or out of range falls back. */
export function prefsFrom(parsed: unknown, defaults: Prefs = defaultPrefs()): Prefs {
  const raw: Record<string, unknown> = typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  return {
    camera: typeof raw.camera === "string" ? raw.camera : defaults.camera,
    size: pick<SizeId>(raw.size, SIZE_IDS, defaults.size),
    width: isSide(raw.width) ? raw.width : defaults.width,
    height: isSide(raw.height) ? raw.height : defaults.height,
    engine: pick<Engine>(raw.engine, ENGINE_IDS, defaults.engine),
    quality: pick<Quality>(raw.quality, QUALITY_IDS, defaults.quality),
    minutes: typeof raw.minutes === "number" && raw.minutes >= 0 && raw.minutes <= MAX_MINUTES ? raw.minutes : defaults.minutes,
    denoise: typeof raw.denoise === "boolean" ? raw.denoise : defaults.denoise,
    format: pick<Format>(raw.format, FORMAT_IDS, defaults.format),
    where: pick<Where>(raw.where, WHERE_IDS, defaults.where),
    via: typeof raw.via === "string" ? raw.via : defaults.via,
    options: optionsFrom(raw.options) ?? defaults.options,
  };
}

/** Engines' kept fields: an object of objects (each engine checks its own values when it reads them). */
function optionsFrom(v: unknown): Record<string, OptionValues> | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const out: Record<string, OptionValues> = {};
  for (const [id, values] of Object.entries(v)) if (typeof values === "object" && values !== null && !Array.isArray(values)) out[id] = values as OptionValues;
  return out;
}

function savePrefs(prefs: Prefs, key = PREFS_KEY): void {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // private windows and full storage: the choices last this session
  }
}
