// Render Studio's HUD: laid over the 3D view while Studio is on (state.ts mounts it when Studio comes
// on and takes it off when Studio goes). It draws the frame of what Render takes and darkens the rest
// of the view, with the picture's size and camera named over the frame's top left corner. Across the
// top: the realistic modes, how far the live picture has come, and Done. Along the bottom: the sun,
// the time of day, the date and the shutter (Render, with its other ways under a caret). The root lies
// over the view and passes clicks through, except on its own controls. No three.js here.

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { dayLabel, dayOfYear, hourLabel } from "../../../app/heliodon.ts";
import { menuButton } from "../../../app/menu.ts";
import { setViz, store } from "../../../app/state.ts";
import type { RealisticMode, RenderMode, View3D } from "../../../app/view3d.ts";
import type { CameraInfo } from "../../../core/index.ts";
import { config, onConfig } from "../../account/config.ts";
import { liveProgress, onProgress, onRenderBusy, renderBusy } from "../bridge.ts";
import { onRender, patchRender, renderSettings } from "../settings.ts";
import { ALL, SIZE_PRESETS, STUDIO_FRAME_PAD, chosenCamera, frameRect, onOutput, outputPrefs, ratioLabel, sizeOf, type Prefs } from "./output.ts";
import { moreRenderRows, renderNow, showMode, statusOf } from "./panel.ts";
import { exitStudio } from "./state.ts";
import { chips, icon, segmented } from "./ui.ts";
import "./hud.css";

const MODES: readonly (readonly [RealisticMode, string])[] = [
  ["realistic", "Realistic"],
  ["pathtraced", "Path Traced"],
  ["ai", "AI"],
];

/** the months, by their index (0 for January), named as the system's language shows them */
const MONTH_CHOICES: readonly (readonly [number, string])[] = Array.from({ length: 12 }, (_, m) => [
  m,
  new Date(Date.UTC(2025, m, 1)).toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }),
] as const);

function realisticMode(mode: RenderMode | undefined): mode is RealisticMode {
  return mode === "realistic" || mode === "pathtraced" || mode === "ai";
}

/** The frame's shape, the label's parts, and which of them is a camera's own name (not translated). */
interface Takes {
  readonly aspect: number;
  readonly label: readonly string[];
  readonly named: string | null;
}

function takesOf(prefs: Prefs, cams: readonly CameraInfo[]): Takes {
  const sized = sizeOf(prefs, cams);
  if (!("size" in sized)) return { aspect: 16 / 9, label: ["Size to check"], named: null };
  const { width, height } = sized.size;
  const name = prefs.size === "shape" || prefs.size === "custom" ? "" : SIZE_PRESETS[prefs.size].short;
  const ratio = ratioLabel(width, height);
  // a preset named for its shape ("21:9", "4:5") says the ratio already
  const parts = [name, `${width} × ${height}`, name === ratio ? "" : ratio];
  const cam = chosenCamera(prefs, cams);
  const named = prefs.camera !== ALL && cam ? cam.name.trim() || null : null;
  if (prefs.camera === ALL && cams.length > 0) parts.push(`All ${cams.length} cameras`);
  else if (cam) parts.push(named ?? "Camera");
  return { aspect: width / height, label: parts.filter(Boolean), named };
}

/** The month (0 for January) a day of the year falls in. */
function monthOf(day: number): number {
  let m = 0;
  while (m < 11 && dayOfYear(m + 2, 1) <= day) m++;
  return m;
}

/** Sets a range input's track fill to its value (the kit's sliders do the same). */
function fillOf(input: HTMLInputElement): void {
  const span = Number(input.max) - Number(input.min) || 1;
  const t = (Number(input.value) - Number(input.min)) / span;
  input.style.setProperty("--fill", `${Math.max(0, Math.min(1, t)) * 100}%`);
}

/** A range input that runs `onInput` as it moves; the editor's keys stay out of it. */
function range(label: string, min: number, max: number, step: number, onInput: (n: number) => void): HTMLInputElement {
  const input = h("input", { cls: "rs-range rs-hud-range", attrs: { type: "range", min: String(min), max: String(max), step: String(step), "aria-label": label } });
  input.addEventListener("input", () => {
    fillOf(input);
    onInput(Number(input.value));
  });
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") e.stopPropagation();
  });
  return input;
}

const px = (n: number): string => `${Math.round(n)}px`;

/** Lays the HUD over `view`; returns a function that takes it off. */
export function mountHud(view: View3D): () => void {
  const app = appContext();
  const host = document.getElementById("view3d-host");
  if (!app || !host) return () => undefined;
  let alive = true;
  const offs: (() => void)[] = [];

  // the frame, its corner ticks and its label
  const frame = h(
    "div",
    { cls: "rs-hud-frame" },
    h("span", { cls: "rs-hud-tick rs-hud-tl" }),
    h("span", { cls: "rs-hud-tick rs-hud-tr" }),
    h("span", { cls: "rs-hud-tick rs-hud-bl" }),
    h("span", { cls: "rs-hud-tick rs-hud-br" }),
  );
  const label = h("div", { cls: "rs-hud-label" });

  // the top: the modes, the live picture's status, Done
  const modes = segmented("Rendering", MODES, (mode) => void showMode(mode));
  const statusText = h("span", { cls: "rs-hud-status-text" });
  const meter = h("div", { cls: "rs-hud-meter", attrs: { "aria-hidden": "true" } }, h("span"));
  const status = h(
    "div",
    { cls: "rs-hud-status" },
    h("span", { cls: "rs-hud-dot", attrs: { "aria-hidden": "true" } }),
    h("div", { cls: "rs-hud-status-body" }, statusText, meter),
  );
  const done = h("button", { cls: "rs-hud-done", attrs: { type: "button" }, title: "Leave Render Studio (Esc)", text: "Done" });
  done.addEventListener("click", () => exitStudio());
  const top = h(
    "div",
    { cls: "rs-hud-top" },
    h("div", { cls: "rs-hud-pill rs-hud-modes" }, modes.el, h("span", { cls: "rs-hud-sep", attrs: { "aria-hidden": "true" } }), status),
    done,
  );

  // the bottom: the sun, the time, the date (with its popover), the shutter and its caret
  const sunIcon = icon("sun", 18);
  const moonIcon = icon("moon", 18);
  const sunBtn = h("button", { cls: "rs-hud-tool", attrs: { type: "button", "aria-label": "Sun" }, title: "Turn the sun off" }, sunIcon, moonIcon);
  sunBtn.addEventListener("click", () => patchRender("sun", { on: !renderSettings().sun.on }));

  const hourInput = range("Solar time", 0, 24, 0.25, (n) => setViz({ hour: n }));
  const hourText = h("span", { cls: "rs-hud-readout" });
  const timeWrap = h("div", { cls: "rs-hud-time" }, hourInput, hourText);

  const dateBtn = h("button", { cls: "rs-hud-date", attrs: { type: "button", "aria-haspopup": "dialog", "aria-expanded": "false" }, title: "Date" });
  const dayInput = range("Date", 1, 365, 1, (n) => setViz({ dayOfYear: n }));
  const dayText = h("span", { cls: "rs-hud-readout" });
  const monthPick = chips("Month", MONTH_CHOICES, (m) => setViz({ dayOfYear: dayOfYear(m + 1, 15) }));
  const pop = h(
    "div",
    { cls: "rs-hud-pop", attrs: { role: "dialog", "aria-label": "Date" }, hidden: true },
    monthPick.el,
    h("div", { cls: "rs-hud-pop-day" }, dayInput, dayText),
  );
  const dateWrap = h("div", { cls: "rs-hud-datewrap" }, dateBtn, pop);
  let popOpen = false;
  const outside = (e: Event): void => {
    if (!(e.target instanceof Node) || !dateWrap.contains(e.target)) setPop(false);
  };
  // Esc closes the dates (Studio's own Esc waits while they are open)
  const escape = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    const inside = document.activeElement instanceof Node && dateWrap.contains(document.activeElement);
    setPop(false);
    if (inside) dateBtn.focus();
  };
  const setPop = (open: boolean): void => {
    if (open === popOpen) return;
    popOpen = open;
    pop.hidden = !open;
    dateBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      document.addEventListener("pointerdown", outside, true);
      document.addEventListener("keydown", escape);
    } else {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    }
  };
  dateBtn.addEventListener("click", () => setPop(!popOpen));

  const shutter = h(
    "button",
    { cls: "rs-hud-shutter", attrs: { type: "button", "aria-label": "Render" }, title: "Render (what Output says)" },
    icon("shutter", 22),
    h("span", { cls: "rs-hud-ring", attrs: { "aria-hidden": "true" } }),
  );
  shutter.addEventListener("click", () => renderNow());
  const caret = menuButton(
    h("button", { cls: "rs-hud-caret", attrs: { type: "button", "aria-label": "More ways to render" }, title: "More ways to render" }, icon("caret", 14)),
    moreRenderRows,
  );
  const bar = h(
    "div",
    { cls: "rs-hud-pill rs-hud-bar" },
    sunBtn,
    timeWrap,
    dateWrap,
    h("span", { cls: "rs-hud-sep", attrs: { "aria-hidden": "true" } }),
    h("div", { cls: "rs-hud-shutters" }, shutter, caret),
  );
  const bottom = h("div", { cls: "rs-hud-bottom" }, bar);

  const root = h("div", { cls: "rs-hud", attrs: { role: "group", "aria-label": "Render Studio" } }, frame, label, top, bottom);

  // the drawing's cameras, read when the drawing changes (cameras() walks every record, so not on each slider step)
  let cams: readonly CameraInfo[] = [];
  const readCams = (): void => {
    cams = store.session?.doc.cameras() ?? [];
  };

  // the frame: the rectangle Render takes, from the view's clear middle and the picture's shape
  const layout = (): void => {
    if (!alive) return;
    const shown = takesOf(outputPrefs(), cams);
    const r = frameRect(host.clientWidth, host.clientHeight, view.clearSides, shown.aspect, STUDIO_FRAME_PAD);
    frame.style.left = px(r.x);
    frame.style.top = px(r.y);
    frame.style.width = px(r.width);
    frame.style.height = px(r.height);
    // a part a span, so each is translated on its own ("All 3 cameras")
    const part = (text: string): HTMLElement => h("span", { text, attrs: text === shown.named ? { translate: "no" } : {} });
    label.replaceChildren(...shown.label.flatMap((text, i) => (i ? [h("span", { text: " · ", attrs: { "aria-hidden": "true" } }), part(text)] : [part(text)])));
    label.style.left = px(r.x);
    label.style.top = px(r.y - 6);
  };

  const syncModes = (): void => {
    const mode = app.renderMode();
    const shown = store.view3d && realisticMode(mode) ? mode : null;
    for (const [id, b] of modes.buttons) {
      b.classList.toggle("active", id === shown);
      b.setAttribute("aria-pressed", String(id === shown));
    }
    const ai = modes.buttons.get("ai");
    if (ai) ai.hidden = config()?.image == null;
  };

  const syncStatus = (): void => {
    const st = statusOf(liveProgress());
    statusText.textContent = st.text;
    status.dataset.phase = st.phase;
    meter.hidden = st.fraction === null && !st.busy;
    meter.toggleAttribute("data-indeterminate", st.fraction === null);
    meter.style.setProperty("--progress", `${Math.round((st.fraction ?? 0) * 100)}%`);
  };

  // the sun's switch, and the time, which is greyed while the sun is off
  const syncSun = (): void => {
    const on = renderSettings().sun.on;
    sunBtn.setAttribute("aria-pressed", String(on));
    sunBtn.title = on ? "Turn the sun off" : "Turn the sun on";
    sunIcon.hidden = !on;
    moonIcon.hidden = on;
    hourInput.disabled = !on;
    timeWrap.classList.toggle("is-off", !on);
  };

  const syncTime = (): void => {
    const hour = store.viz3d.hour;
    hourInput.value = String(hour);
    hourInput.setAttribute("aria-valuetext", hourLabel(hour));
    hourText.textContent = hourLabel(hour);
    fillOf(hourInput);
  };

  const syncDate = (): void => {
    const day = store.viz3d.dayOfYear;
    dateBtn.textContent = dayLabel(day);
    dayInput.value = String(day);
    dayInput.setAttribute("aria-valuetext", dayLabel(day));
    dayText.textContent = dayLabel(day);
    fillOf(dayInput);
    monthPick.set(monthOf(day));
  };

  const syncShutter = (): void => {
    shutter.classList.toggle("is-busy", renderBusy());
  };

  const syncAll = (): void => {
    syncModes();
    syncStatus();
    syncSun();
    syncTime();
    syncDate();
    syncShutter();
    layout();
  };

  readCams();
  offs.push(
    store.on("session", () => {
      readCams();
      syncAll();
    }),
    store.on(["viz3d", "view3d"], syncAll),
    onProgress(() => {
      syncModes();
      syncStatus();
    }),
    onRenderBusy(syncShutter),
    onConfig(syncModes),
    onRender(syncSun),
    onOutput(layout),
  );
  const ro = new ResizeObserver(() => layout());
  ro.observe(host);
  window.addEventListener("resize", layout);
  // Palettes.onChange has no way to stop it: `alive` makes it a no-op once the HUD is off
  app.palettes.onChange(layout);

  host.append(root);
  syncAll();

  return () => {
    alive = false;
    setPop(false);
    ro.disconnect();
    window.removeEventListener("resize", layout);
    for (const off of offs) off();
    root.remove();
  };
}
