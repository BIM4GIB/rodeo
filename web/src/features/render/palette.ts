// The Render palette (loaded with the editor): how the realistic views are drawn. At the top, the
// Realistic and Path Traced modes and Render Image; below, the sky, sun, light objects, camera, fog,
// each material's finish, the lighting effects, the lens, the colour (with its looks), the clay and
// outline styles, and the quality. The settings belong to the drawing on this machine
// (settings.ts). No three.js here: the renderers load when first used.

import "./render.css";
import type { CameraInfo } from "../../core/index.ts";
import { h } from "../../app/dom.ts";
import { appContext } from "../../app/ext.ts";
import { dayLabel, hourLabel } from "../../app/heliodon.ts";
import { reportFailure } from "../../app/reports.ts";
import { setViz, store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { RealisticMode } from "../../app/view3d.ts";
import { materialList, onMaterials, onStatus, renderStatus, type MaterialItem } from "./bridge.ts";
import {
  LOOKS,
  PRESET_LABELS,
  lookOf,
  onRender,
  patchRender,
  renderSettings,
  resetRender,
  setMaterial,
  setRender,
  withLook,
  type MaterialOverride,
  type MaterialPresetId,
  type RenderSettings,
  type SkyKind,
  type ToneMap,
} from "./settings.ts";

const MODES: readonly (readonly [RealisticMode, string])[] = [
  ["realistic", "Realistic"],
  ["pathtraced", "Path Traced"],
];
const SKY_OPTIONS: readonly (readonly [SkyKind, string])[] = [
  ["physical", "Physical sky"],
  ["gradient", "Gradient"],
  ["color", "Solid colour"],
  ["studio", "Studio"],
];
const TONE_OPTIONS: readonly (readonly [ToneMap, string])[] = [
  ["agx", "AgX"],
  ["aces", "ACES Filmic"],
  ["neutral", "Neutral"],
];
const F_OPTIONS: readonly (readonly [number, string])[] = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16, 22].map((f): [number, string] => [f, `f/${f}`]);
const SAMPLE_OPTIONS: readonly (readonly [number, string])[] = [
  [64, "64"],
  [128, "128"],
  [256, "256"],
  [512, "512"],
  [1024, "1024"],
  [100000, "Unlimited"],
];
/** the Look drop-down's entry while the effects match none of the looks */
const CUSTOM_LOOK = "custom";
const LOOK_OPTIONS: readonly (readonly [string, string])[] = [...LOOKS.map((l): [string, string] => [l.id, l.label]), [CUSTOM_LOOK, "Custom"]];
/** the materials list gets a search box above this many */
const SEARCH_ABOVE = 8;
const PRESET_IDS = Object.keys(PRESET_LABELS) as MaterialPresetId[];

/** One material's row in the list, and how it shows the settings. */
interface MaterialRow {
  readonly label: string;
  readonly el: HTMLElement;
  update(s: RenderSettings): void;
}

interface Slider {
  readonly el: HTMLElement;
  readonly input: HTMLInputElement;
  readonly readout: HTMLElement;
}

interface NumberField {
  readonly input: HTMLInputElement;
  /** shows the setting's value */
  set(v: number): void;
}

interface Check {
  readonly row: HTMLElement;
  readonly box: HTMLInputElement;
}

// ---- helpers (the Visualization palette's shapes) ------------------------------

function section(title: string, ...children: Node[]): HTMLElement {
  return h("section", { cls: "info-section" }, h("h3", { text: title }), ...children);
}

/** A labelled control in a section: its label sits beside it. */
function field(label: string, control: Node): HTMLElement {
  return h("label", { cls: "field" }, h("span", { cls: "field-label", text: label }), control);
}

/** A material's finish field: its label, then the slider or colour. */
function line(label: string, control: Node): HTMLElement {
  return h("div", { cls: "render-line" }, h("span", { cls: "field-label", text: label }), control);
}

function check(label: string, onChange: (on: boolean) => void): Check {
  const box = h("input", { attrs: { type: "checkbox" } });
  box.addEventListener("change", () => onChange(box.checked));
  return { row: h("label", { cls: "class-style-item render-check" }, box, h("span", { text: label })), box };
}

/** A slider with its readout beside it; `onInput` runs as it moves. */
function slider(label: string, min: number, max: number, step: number, onInput: (v: number) => void): Slider {
  const input = h("input", { cls: "attr-range", attrs: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label } });
  const readout = h("span", { cls: "render-readout" });
  input.addEventListener("input", () => onInput(Number(input.value)));
  return { el: h("div", { cls: "attr-opacity" }, input, readout), input, readout };
}

/** Shows a slider at `value`, its readout reading `text`. */
function setSlider(s: Slider, value: number, text: string): void {
  s.input.value = String(value);
  s.readout.textContent = text;
}

/** A finish's slider: the value it holds, or "Preset" (the slider at `fallback`) while the preset gives it. */
function setFinish(s: Slider, value: number | undefined, fallback: number, text: (v: number) => string): void {
  setSlider(s, value ?? fallback, value === undefined ? "Preset" : text(value));
}

/** A number box: it takes Enter or leaving it, clamps to min..max, and anything that is not a number shows the setting again. */
function numberField(label: string, min: number, max: number, onChange: (n: number) => void): NumberField {
  const input = h("input", { cls: "num", attrs: { type: "number", min: String(min), max: String(max), step: "any", "aria-label": label } });
  let shown = "";
  input.addEventListener("change", () => {
    const n = Number(input.value);
    if (input.value.trim() !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    // the setting's value: onChange has just changed it, and the palette's sync has set `shown`
    input.value = shown;
  });
  return {
    input,
    set(v: number): void {
      shown = String(v);
      input.value = shown;
    },
  };
}

/** A colour input; the settings keep CSS colours, read here as #rrggbb. */
function colour(label: string, onInput: (css: string) => void): HTMLInputElement {
  const input = h("input", { cls: "info-colour", attrs: { type: "color", "aria-label": label } });
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

/** A drop-down of `options` (value, text); `onPick` gets the value chosen. */
function dropdown<T extends string | number>(label: string, options: readonly (readonly [T, string])[], onPick: (v: T) => void): HTMLSelectElement {
  const el = h("select", { cls: "select", attrs: { "aria-label": label } }, ...options.map(([v, text]) => h("option", { text, attrs: { value: String(v) } })));
  el.addEventListener("change", () => {
    const picked = options.find(([v]) => String(v) === el.value);
    if (picked) onPick(picked[0]);
  });
  return el;
}

/** A CSS colour as the #rrggbb a colour input takes; `fallback` for anything else. */
function hexOf(css: string, fallback = "#000000"): string {
  return /^#[0-9a-f]{6}$/i.test(css) ? css.toLowerCase() : fallback;
}

const toPct = (v: number): number => Math.round(v * 100);
const pct = (v: number): string => `${toPct(v)} %`;
const signedPct = (v: number): string => `${v > 0 ? "+" : ""}${toPct(v)} %`;
/** Exposure as "+0.5 EV". */
const evText = (v: number): string => `${v > 0 ? "+" : ""}${v.toFixed(1)} EV`;

/** Shows the 3D view if it is hidden, then draws it in `mode`, as View > Rendering does. */
async function showMode(mode: RealisticMode): Promise<void> {
  const app = appContext();
  if (!app) return;
  await app.show3d();
  app.setRenderMode(mode);
}

/** Shows the 3D view through `c`: its eye, target and lens, in its projection. */
async function lookThrough(c: CameraInfo): Promise<void> {
  const view = await appContext()?.show3d();
  if (!view) return;
  const projection = c.perspective ? "perspective" : "orthogonal";
  if (store.viz3d.projection !== projection) setViz({ projection });
  if (c.perspective) view.lookThrough(c.eye, c.target, c.viewAngle, c.aspect);
  else view.lookAs({ toward: [c.eye[0] - c.target[0], c.eye[1] - c.target[1], c.eye[2] - c.target[2]], at: c.target, perspective: false });
}

/** Where a camera sits: its layer, or the viewport and sheet it belongs to. */
function cameraPlace(c: CameraInfo): string {
  const doc = store.session?.doc;
  const layer = doc?.layers().find((l) => l.id === c.layerId)?.name ?? "";
  if (!c.viewportId) return layer;
  const vp = doc?.viewport(c.viewportId)?.name;
  return vp ? `${vp} · ${layer}` : `A viewport on ${layer}`;
}

function cameraRow(c: CameraInfo): HTMLElement {
  const row = h(
    "div",
    { cls: "row", attrs: { role: "button", tabindex: "0" }, title: "Look through this camera in the 3D view" },
    h("div", { cls: "names" }, h("div", { cls: "name", text: c.name }), h("div", { cls: "sub", text: cameraPlace(c) })),
    h("span", { cls: "badge", text: c.perspective ? `${Math.round(c.viewAngle)}°` : "Ortho" }),
  );
  row.addEventListener("click", () => void lookThrough(c));
  row.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    void lookThrough(c);
  });
  return row;
}

/** Changes some of a material's finish, keeping the rest of its override (or "auto" when it has none). */
function editMaterial(key: string, change: Partial<MaterialOverride>): void {
  const current: MaterialOverride = renderSettings().materials[key] ?? { preset: "auto" };
  setMaterial(key, { ...current, ...change });
}

/** A material's swatch: its texture's preview (its blob URL goes in `urls`, to revoke later), else its colour. */
function swatchOf(item: MaterialItem, urls: string[]): HTMLElement {
  const preview = item.preview;
  if (!preview) {
    const dot = h("span", { cls: "render-swatch", attrs: { "aria-hidden": "true" } });
    dot.style.background = item.color;
    return dot;
  }
  const url = URL.createObjectURL(new Blob([new Uint8Array(preview.bytes)], { type: preview.mime }));
  urls.push(url);
  return h("img", { cls: "render-swatch", attrs: { src: url, alt: "" } });
}

/** One material: its swatch, name and finish in a row; a click opens its sliders, tint and reset under it. */
function materialRow(item: MaterialItem, swatch: HTMLElement, expanded: Set<string>): MaterialRow {
  const key = item.key;
  const options = PRESET_IDS.map((id): [MaterialPresetId, string] => [id, id === "auto" ? `Auto (${PRESET_LABELS[item.guess]})` : PRESET_LABELS[id]]);
  const preset = dropdown(`Finish of ${item.label}`, options, (id) => editMaterial(key, { preset: id }));
  preset.classList.add("render-preset");
  // the drop-down's own clicks and keys pick a finish; they do not open the row
  preset.addEventListener("click", (e) => e.stopPropagation());
  preset.addEventListener("keydown", (e) => e.stopPropagation());

  const isOpen = expanded.has(key);
  const head = h(
    "div",
    {
      cls: "row render-material-head",
      title: `${item.label}: ${item.count} face group${item.count === 1 ? "" : "s"}`,
      attrs: { role: "button", tabindex: "0", "aria-expanded": String(isOpen) },
    },
    swatch,
    h("div", { cls: "names" }, h("div", { cls: "name", text: item.label })),
    preset,
  );

  const roughness = slider("Roughness", 0, 1, 0.01, (n) => editMaterial(key, { roughness: n }));
  const metalness = slider("Metalness", 0, 1, 0.01, (n) => editMaterial(key, { metalness: n }));
  const transmission = slider("Transmission", 0, 1, 0.01, (n) => editMaterial(key, { transmission: n }));
  const emissive = slider("Emissive", 0, 10, 0.1, (n) => editMaterial(key, { emissive: n }));
  const tint = colour(`Tint of ${item.label}`, (c) => editMaterial(key, { tint: c }));
  const clearTint = h("button", { cls: "btn small", text: "Clear", title: "Take the tint away", attrs: { type: "button" } });
  clearTint.addEventListener("click", () => editMaterial(key, { tint: undefined }));
  const reset = h("button", { cls: "btn small", text: "Reset", title: "Back to the preset's finish", attrs: { type: "button" } });
  reset.addEventListener("click", () => setMaterial(key, null));
  const detail = h(
    "div",
    { cls: "render-material-detail", hidden: !isOpen },
    line("Roughness", roughness.el),
    line("Metalness", metalness.el),
    line("Transmission", transmission.el),
    line("Emissive", emissive.el),
    line("Tint", h("div", { cls: "render-tint" }, tint, clearTint)),
    h("div", { cls: "row-end" }, reset),
  );

  const toggle = (): void => {
    const now = !expanded.has(key);
    if (now) expanded.add(key);
    else expanded.delete(key);
    detail.hidden = !now;
    head.setAttribute("aria-expanded", String(now));
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    toggle();
  });

  const update = (s: RenderSettings): void => {
    const m: MaterialOverride | undefined = s.materials[key];
    preset.value = m?.preset ?? "auto";
    setFinish(roughness, m?.roughness, 0.5, pct);
    setFinish(metalness, m?.metalness, 0, pct);
    setFinish(transmission, m?.transmission, 0, pct);
    setFinish(emissive, m?.emissive, 0, (v) => v.toFixed(1));
    tint.value = hexOf(m?.tint ?? item.color, "#ffffff");
    clearTint.disabled = m?.tint === undefined;
    reset.disabled = m === undefined;
  };

  return { label: item.label, el: h("div", { cls: "render-material" }, head, detail), update };
}

// ---- the palette ---------------------------------------------------------------

/** The Render palette's body, for the dock: the controls, kept in step with the settings and the drawing. */
export function renderPalette(): HTMLElement {
  // head: the mode the 3D view draws in, a line on how far it has come, and the still image
  const modes = MODES.map(([mode, text]) => {
    const btn = h("button", { cls: "seg-btn", text, attrs: { type: "button" } });
    btn.addEventListener("click", () => {
      btn.blur();
      void showMode(mode);
    });
    return { mode, btn };
  });
  const status = h("p", { cls: "muted render-status" });
  const showStatus = (text: string): void => {
    status.textContent = text;
    status.hidden = text === "";
  };
  const still = h("button", { cls: "btn primary render-go", text: "Render Image…", attrs: { type: "button" } });
  still.addEventListener("click", () => {
    void import("./finalRender.ts")
      .then((m) => m.renderImageDialog())
      .catch((err: unknown) => {
        toast(`Render: ${errorMessage(err)}`);
        reportFailure("render", err, { step: "loading the render code" });
      });
  });
  const head = h(
    "section",
    { cls: "info-section" },
    h("div", { cls: "seg render-seg", attrs: { role: "group", "aria-label": "Rendering" } }, ...modes.map((m) => m.btn)),
    status,
    still,
  );

  // environment
  const sky = dropdown("Sky", SKY_OPTIONS, (k) => patchRender("environment", { sky: k }));
  const haze = slider("Haze", 2, 10, 0.1, (n) => patchRender("environment", { turbidity: n }));
  const zenith = colour("Zenith", (c) => patchRender("environment", { zenith: c }));
  const horizon = colour("Horizon", (c) => patchRender("environment", { horizon: c }));
  const groundSky = colour("Ground colour", (c) => patchRender("environment", { ground: c }));
  const solid = colour("Colour", (c) => patchRender("environment", { zenith: c }));
  const skyStrength = slider("Intensity", 0, 300, 1, (n) => patchRender("environment", { intensity: n / 100 }));
  const behind = check("Show the sky behind the model", (on) => patchRender("environment", { visible: on }));
  const plane = check("Ground plane", (on) => patchRender("environment", { groundPlane: on }));
  plane.row.title = "A plane under a model that stands on level ground; a sloping site model is its own ground";
  const planeColour = colour("Plane colour", (c) => patchRender("environment", { groundColor: c }));
  const planeGloss = slider("Gloss", 0, 100, 1, (n) => patchRender("environment", { groundGloss: n / 100 }));
  planeGloss.el.title = "Matte to a mirror: a polished floor or a wet street";
  const hazeField = field("Haze", haze.el);
  const zenithField = field("Zenith", zenith);
  const horizonField = field("Horizon", horizon);
  const groundSkyField = field("Ground colour", groundSky);
  const solidField = field("Colour", solid);
  const planeColourField = field("Plane colour", planeColour);
  const planeGlossField = field("Gloss", planeGloss.el);
  const environment = section(
    "Environment",
    field("Sky", sky),
    hazeField,
    zenithField,
    horizonField,
    groundSkyField,
    solidField,
    field("Intensity", skyStrength.el),
    behind.row,
    plane.row,
    planeColourField,
    planeGlossField,
  );

  // sun: the Heliodon places it by the date and solar time, as the Visualization palette's does
  const sunOn = check("Sunlight", (on) => patchRender("sun", { on }));
  const day = slider("Date", 1, 365, 1, (n) => setViz({ dayOfYear: n }));
  const hour = slider("Solar time", 0, 24, 0.25, (n) => setViz({ hour: n }));
  const sunStrength = slider("Intensity", 0, 300, 1, (n) => patchRender("sun", { intensity: n / 100 }));
  const sunSoft = slider("Softness", 0, 100, 1, (n) => patchRender("sun", { softness: n / 100 }));
  const sun = section(
    "Sun",
    sunOn.row,
    field("Date", day.el),
    field("Solar time", hour.el),
    field("Intensity", sunStrength.el),
    field("Softness", sunSoft.el),
    h("p", { cls: "muted render-note", text: "The sun stands where the Heliodon places it (Visualization palette)." }),
  );

  // light objects
  const lampsOn = check("Light objects", (on) => patchRender("lights", { on }));
  const lampStrength = slider("Intensity", 0, 500, 1, (n) => patchRender("lights", { intensity: n / 100 }));
  const lampHaze = slider("Haze", 0, 100, 1, (n) => patchRender("lights", { haze: n / 100 }));
  lampHaze.el.title = "Haze in the air: the spots show as beams (Realistic)";
  const lights = section("Lights", lampsOn.row, field("Intensity", lampStrength.el), field("Haze", lampHaze.el));

  // camera: the lens, then the drawing's Renderworks cameras to look through
  const twoPoint = check("Two-point perspective", (on) => patchRender("camera", { twoPoint: on }));
  const dof = check("Depth of field", (on) => patchRender("camera", { dof: on }));
  const fStop = dropdown("f-stop", F_OPTIONS, (f) => patchRender("camera", { fStop: f }));
  const blurScale = slider("Blur strength", 1, 20, 1, (n) => patchRender("camera", { blurScale: n }));
  blurScale.el.title = "×1 blurs as a real lens at the f-stop; more for the blur a real lens shows only up close";
  const blurScaleField = field("Strength", blurScale.el);
  const focus = numberField("Focus (m)", 0, 100000, (n) => patchRender("camera", { focus: n }));
  const fStopField = field("f-stop", fStop);
  const focusField = field("Focus (m)", focus.input);
  const focusNote = h("p", { cls: "muted render-note", text: "0: the point the view orbits." });
  const cameraNote = h("p", { cls: "muted render-note", text: "Click a Renderworks camera to look through it in the 3D view." });
  const cameraBox = h("div", { cls: "list render-list" });
  const listCameras = (): void => {
    const found = store.session?.doc.cameras() ?? [];
    cameraNote.hidden = found.length === 0;
    cameraBox.hidden = found.length === 0;
    cameraBox.replaceChildren(...found.map(cameraRow));
  };
  const camera = section(
    "Camera",
    twoPoint.row,
    h("p", { cls: "muted render-note", text: "Keeps vertical lines vertical." }),
    dof.row,
    fStopField,
    blurScaleField,
    focusField,
    focusNote,
    cameraNote,
    cameraBox,
  );

  // fog
  const fogOn = check("Fog", (on) => patchRender("fog", { on }));
  const fogColour = colour("Colour", (c) => patchRender("fog", { color: c }));
  const visibility = numberField("Visibility (m)", 5, 20000, (n) => patchRender("fog", { distance: n }));
  const fogHeight = numberField("Height (m)", 0, 500, (n) => patchRender("fog", { height: n }));
  const fogBase = numberField("Base (m)", 0, 1000, (n) => patchRender("fog", { base: n }));
  const glow = slider("Glow", 0, 100, 1, (n) => patchRender("fog", { glow: n / 100 }));
  const fogParts: HTMLElement[] = [
    field("Colour", fogColour),
    field("Visibility (m)", visibility.input),
    field("Height (m)", fogHeight.input),
    field("Base (m)", fogBase.input),
    field("Glow", glow.el),
    h("p", { cls: "muted render-note", text: "Height 0: the same fog at every height. Base: metres above the lowest point, where fog is thickest." }),
  ];
  const fog = section("Fog", fogOn.row, ...fogParts);

  // materials: one row each, opened for its sliders
  const search = h("input", { cls: "search render-search", attrs: { type: "search", placeholder: "Search materials", "aria-label": "Search materials" } });
  const materialsNone = h("p", { cls: "muted render-note", text: "Materials appear once the 3D view draws in Realistic or Path Traced." });
  const materialsBox = h("div", { cls: "list render-list" });
  const materials = section("Materials", search, materialsNone, materialsBox);
  const expanded = new Set<string>();
  let previews: string[] = [];
  let rows: MaterialRow[] = [];
  let query = "";
  const filterMaterials = (): void => {
    for (const r of rows) r.el.hidden = !r.label.toLowerCase().includes(query);
  };
  const refreshMaterials = (): void => {
    for (const url of previews) URL.revokeObjectURL(url);
    previews = [];
    const items = materialList();
    rows = items.map((item) => materialRow(item, swatchOf(item, previews), expanded));
    materialsBox.replaceChildren(...rows.map((r) => r.el));
    search.hidden = items.length <= SEARCH_ABOVE;
    materialsNone.hidden = items.length > 0;
    filterMaterials();
    const s = renderSettings();
    for (const r of rows) r.update(s);
  };
  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    filterMaterials();
  });

  // lighting effects: what Realistic adds to its light (the path tracer finds the shading and reflections itself)
  const ao = slider("Ambient occlusion", 0, 100, 1, (n) => patchRender("effects", { ao: n / 100 }));
  const reflections = slider("Reflections", 0, 100, 1, (n) => patchRender("effects", { reflections: n / 100 }));
  const bloom = slider("Bloom", 0, 100, 1, (n) => patchRender("effects", { bloom: n / 100 }));
  const threshold = slider("Bloom threshold", 0, 400, 5, (n) => patchRender("effects", { bloomThreshold: n / 100 }));
  const bloomSize = slider("Bloom size", 0, 100, 1, (n) => patchRender("effects", { bloomSize: n / 100 }));
  const threshField = field("Threshold", threshold.el);
  const bloomSizeField = field("Size", bloomSize.el);
  const lighting = section(
    "Lighting Effects",
    field("Ambient occlusion", ao.el),
    field("Reflections", reflections.el),
    h("p", { cls: "muted render-note", text: "Shiny faces mirror the model in Realistic; Path Traced finds both itself." }),
    field("Bloom", bloom.el),
    threshField,
    bloomSizeField,
  );

  // lens
  const vignette = slider("Vignette", 0, 100, 1, (n) => patchRender("effects", { vignette: n / 100 }));
  const aberration = slider("Chromatic aberration", 0, 100, 1, (n) => patchRender("effects", { aberration: n / 100 }));
  const grain = slider("Film grain", 0, 100, 1, (n) => patchRender("effects", { grain: n / 100 }));
  const sharpen = slider("Sharpen", 0, 100, 1, (n) => patchRender("effects", { sharpen: n / 100 }));
  const lens = section("Lens", field("Vignette", vignette.el), field("Fringing", aberration.el), field("Grain", grain.el), field("Sharpen", sharpen.el));

  // colour: a look sets the grading and the lens at once; the sliders fine-tune it
  const look = dropdown("Look", LOOK_OPTIONS, (id) => {
    const picked = LOOKS.find((l) => l.id === id);
    if (picked) setRender({ effects: withLook(renderSettings().effects, picked) });
  });
  const exposure = slider("Exposure", -4, 8, 0.1, (n) => setRender({ exposure: n }));
  const tone = dropdown("Tone", TONE_OPTIONS, (t) => setRender({ toneMap: t }));
  const temperature = slider("Temperature", -100, 100, 1, (n) => patchRender("effects", { temperature: n / 100 }));
  const tint = slider("Tint", -100, 100, 1, (n) => patchRender("effects", { tint: n / 100 }));
  const contrast = slider("Contrast", -100, 100, 1, (n) => patchRender("effects", { contrast: n / 100 }));
  const highlights = slider("Highlights", -100, 100, 1, (n) => patchRender("effects", { highlights: n / 100 }));
  const shadows = slider("Shadows", -100, 100, 1, (n) => patchRender("effects", { shadows: n / 100 }));
  const saturation = slider("Saturation", -100, 100, 1, (n) => patchRender("effects", { saturation: n / 100 }));
  const colourSection = section(
    "Colour",
    field("Look", look),
    field("Exposure", exposure.el),
    field("Tone", tone),
    field("Temperature", temperature.el),
    field("Tint", tint.el),
    field("Contrast", contrast.el),
    field("Highlights", highlights.el),
    field("Shadows", shadows.el),
    field("Saturation", saturation.el),
  );

  // style: the clay model and ink outlines
  const clayOn = check("Clay model", (on) => patchRender("clay", { on }));
  clayOn.row.title = "Every face in one matte colour; glass stays clear";
  const clayColour = colour("Clay colour", (c) => patchRender("clay", { color: c }));
  const clayColourField = field("Clay colour", clayColour);
  const outlines = slider("Outlines", 0, 100, 1, (n) => patchRender("effects", { outlines: n / 100 }));
  const outlineColour = colour("Line colour", (c) => patchRender("effects", { outlineColor: c }));
  const outlineColourField = field("Line colour", outlineColour);
  const style = section("Style", clayOn.row, clayColourField, field("Outlines", outlines.el), outlineColourField);

  // quality
  const samples = dropdown("Preview samples", SAMPLE_OPTIONS, (n) => patchRender("quality", { previewSamples: n }));
  const bounces = slider("Bounces", 2, 12, 1, (n) => patchRender("quality", { bounces: n }));
  const denoise = check("Denoise", (on) => patchRender("quality", { denoise: on }));
  const resetAll = h("button", { cls: "btn small", text: "Reset all settings", title: "Back to the defaults, materials included", attrs: { type: "button" } });
  resetAll.addEventListener("click", () => resetRender());
  const quality = section("Quality", field("Preview samples", samples), field("Bounces", bounces.el), denoise.row, h("div", { cls: "row-end" }, resetAll));

  // keeps every control in step with the settings, the drawing's view and its time
  const sync = (): void => {
    const s = renderSettings();
    const mode = appContext()?.renderMode();
    for (const { mode: m, btn } of modes) {
      const on = store.view3d && mode === m;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", String(on));
    }

    const e = s.environment;
    sky.value = e.sky;
    hazeField.hidden = e.sky !== "physical";
    for (const el of [zenithField, horizonField, groundSkyField]) el.hidden = e.sky !== "gradient";
    solidField.hidden = e.sky !== "color";
    setSlider(haze, e.turbidity, e.turbidity.toFixed(1));
    zenith.value = hexOf(e.zenith);
    solid.value = hexOf(e.zenith);
    horizon.value = hexOf(e.horizon);
    groundSky.value = hexOf(e.ground);
    setSlider(skyStrength, toPct(e.intensity), pct(e.intensity));
    behind.box.checked = e.visible;
    plane.box.checked = e.groundPlane;
    planeColourField.hidden = !e.groundPlane;
    planeColour.value = hexOf(e.groundColor);
    planeGlossField.hidden = !e.groundPlane;
    setSlider(planeGloss, toPct(e.groundGloss), pct(e.groundGloss));

    const sn = s.sun;
    sunOn.box.checked = sn.on;
    sunStrength.input.disabled = !sn.on;
    sunSoft.input.disabled = !sn.on;
    const vz = store.viz3d;
    setSlider(day, vz.dayOfYear, dayLabel(vz.dayOfYear));
    setSlider(hour, vz.hour, hourLabel(vz.hour));
    setSlider(sunStrength, toPct(sn.intensity), pct(sn.intensity));
    setSlider(sunSoft, toPct(sn.softness), pct(sn.softness));

    lampsOn.box.checked = s.lights.on;
    lampStrength.input.disabled = !s.lights.on;
    setSlider(lampStrength, toPct(s.lights.intensity), pct(s.lights.intensity));
    lampHaze.input.disabled = !s.lights.on;
    setSlider(lampHaze, toPct(s.lights.haze), pct(s.lights.haze));

    const c = s.camera;
    twoPoint.box.checked = c.twoPoint;
    dof.box.checked = c.dof;
    fStopField.hidden = !c.dof;
    blurScaleField.hidden = !c.dof;
    setSlider(blurScale, c.blurScale, `×${c.blurScale}`);
    focusField.hidden = !c.dof;
    focusNote.hidden = !c.dof;
    fStop.value = String(c.fStop);
    focus.set(c.focus);

    const f = s.fog;
    fogOn.box.checked = f.on;
    for (const el of fogParts) el.hidden = !f.on;
    fogColour.value = hexOf(f.color);
    visibility.set(f.distance);
    fogHeight.set(f.height);
    fogBase.set(f.base);
    setSlider(glow, toPct(f.glow), pct(f.glow));

    const ef = s.effects;
    setSlider(ao, toPct(ef.ao), pct(ef.ao));
    setSlider(reflections, toPct(ef.reflections), pct(ef.reflections));
    setSlider(bloom, toPct(ef.bloom), pct(ef.bloom));
    threshField.hidden = ef.bloom <= 0;
    bloomSizeField.hidden = ef.bloom <= 0;
    setSlider(threshold, toPct(ef.bloomThreshold), ef.bloomThreshold.toFixed(2));
    setSlider(bloomSize, toPct(ef.bloomSize), pct(ef.bloomSize));

    setSlider(vignette, toPct(ef.vignette), pct(ef.vignette));
    setSlider(aberration, toPct(ef.aberration), pct(ef.aberration));
    setSlider(grain, toPct(ef.grain), pct(ef.grain));
    setSlider(sharpen, toPct(ef.sharpen), pct(ef.sharpen));

    look.value = lookOf(ef)?.id ?? CUSTOM_LOOK;
    setSlider(exposure, s.exposure, evText(s.exposure));
    tone.value = s.toneMap;
    setSlider(temperature, toPct(ef.temperature), signedPct(ef.temperature));
    setSlider(tint, toPct(ef.tint), signedPct(ef.tint));
    setSlider(contrast, toPct(ef.contrast), signedPct(ef.contrast));
    setSlider(highlights, toPct(ef.highlights), signedPct(ef.highlights));
    setSlider(shadows, toPct(ef.shadows), signedPct(ef.shadows));
    setSlider(saturation, toPct(ef.saturation), signedPct(ef.saturation));

    clayOn.box.checked = s.clay.on;
    clayColourField.hidden = !s.clay.on;
    clayColour.value = hexOf(s.clay.color, "#ffffff");
    setSlider(outlines, toPct(ef.outlines), pct(ef.outlines));
    outlineColourField.hidden = ef.outlines <= 0;
    outlineColour.value = hexOf(ef.outlineColor);

    const q = s.quality;
    samples.value = String(q.previewSamples);
    setSlider(bounces, q.bounces, String(q.bounces));
    denoise.box.checked = q.denoise;

    for (const r of rows) r.update(s);
  };

  showStatus(renderStatus());
  onStatus(showStatus);
  onMaterials(refreshMaterials);
  onRender(() => sync());
  store.on(["viz3d", "view3d", "session"], sync);
  store.on("session", listCameras);
  listCameras();
  refreshMaterials();
  sync();

  return h("div", { cls: "info render-palette" }, head, environment, sun, lights, camera, fog, materials, lighting, lens, colourSection, style, quality);
}
