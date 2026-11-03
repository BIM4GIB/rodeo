// Stage > Lighting > Light Coverage Map…: the light on a flat plane across the stage from every instrument's
// beam (photometry.ts), painted as a heat map over the drawing until Close. The readout gives the minimum,
// average and maximum in lux and footcandles, the minimum over the average, and a colour ramp. Label Values
// prints lux on a coarse grid. It's an estimate: each type's typical lumens (or the instrument's own), a gel
// counted by its brightness, and no light bounced off the stage and walls. Recomputed when the drawing or
// the levels change.

import { h } from "../../../app/dom.ts";
import { appContext, registerOverlay } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import type { Painter } from "../../../app/tools.ts";
import type { Pt } from "../../../core/index.ts";
import { FOCUS_PLANE_MM, type Fixture } from "../fixture.ts";
import { fixtures } from "../instrument.ts";
import { levelOf, onLevels } from "../levels.ts";
import { fromStage, toStage, type StageFrame } from "../stage.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { coverage, poolOutline, type LuxGrid, type Photometric } from "./photometry.ts";
import { openPanel, type OpenPanel } from "../ui.ts";

/** the heat map's cells across and up the area, and the coarser grid its values are printed on */
const COLS = 96;
const ROWS = 64;
const LABEL_COLS = 12;
const LABEL_ROWS = 8;
const LUX_PER_FOOTCANDLE = 10.764;
/** the colour ramp, from the floor (0, transparent) up to the most lux on the map (1) */
const RAMP: readonly { readonly at: number; readonly rgb: readonly [number, number, number] }[] = [
  { at: 0, rgb: [31, 59, 255] },
  { at: 0.35, rgb: [22, 179, 100] },
  { at: 0.7, rgb: [255, 214, 10] },
  { at: 1, rgb: [255, 59, 31] },
];
/** the share of the most lux over which the floor fades in, and the heat's opacity */
const FADE = 0.05;
const ALPHA = 0.7;

interface Options {
  readonly plane: number;
  /** the whole stage from the pools' extent, else a box of an across and up size from CL and PL */
  readonly whole: boolean;
  readonly across: number;
  readonly up: number;
  readonly labels: boolean;
}

/** The area and its light, ready to paint. */
interface Heat {
  readonly frame: StageFrame;
  /** the area in stage terms: across (a0 to a1) and up (u0 to u1), mm */
  readonly a0: number;
  readonly a1: number;
  readonly u0: number;
  readonly u1: number;
  readonly grid: LuxGrid;
  readonly image: HTMLCanvasElement;
  readonly labels: LuxGrid | null;
  readonly lit: number;
  readonly unfocused: number;
}

interface Session {
  readonly opts: Options;
  readonly panel: OpenPanel;
  readonly body: HTMLElement;
  readonly unsubs: (() => void)[];
  /** a recompute is queued */
  pending: boolean;
  /** the area's heat, or why there's none */
  result: Heat | string;
}

let last: Options = { plane: FOCUS_PLANE_MM, whole: true, across: 12000, up: 8000, labels: false };
let active: Session | null = null;

/** Asks for the plane and the area, then shows the coverage map until Close. */
export async function openCoverageMap(): Promise<void> {
  if (!store.session) {
    toast("Open a drawing first.", "info");
    return;
  }
  // the window it replaces would sit over the dialog
  active?.panel.close();
  const v = await toolPrefs(
    "Light Coverage Map",
    [
      { kind: "length", key: "plane", label: "Plane Height", value: last.plane, zero: true },
      {
        kind: "choice",
        key: "area",
        label: "Area",
        value: last.whole ? "whole" : "box",
        options: [
          { value: "whole", label: "Whole Stage (the pools' extent)" },
          { value: "box", label: "Across and Up sizes" },
        ],
      },
      { kind: "length", key: "across", label: "Across (centred on CL)", value: last.across },
      { kind: "length", key: "up", label: "Up from PL (negative for downstage)", value: last.up, signed: true },
      { kind: "check", key: "labels", label: "Label Values", value: last.labels },
    ],
    "Shows the light on a flat plane across the stage from every instrument's beam, as a heat map over the drawing. " +
      "It's an estimate: each type's typical lumens (or the instrument's own figures) are used, a gel counts by its brightness, " +
      "and light bounced off the stage and walls is left out.",
  );
  if (!v) return;
  last = { plane: v.num("plane"), whole: v.choice("area") === "whole", across: v.num("across"), up: v.num("up"), labels: v.flag("labels") };
  show(last);
}

function show(o: Options): void {
  const body = h("div", { cls: "beam-cov" });
  const panel = openPanel({
    key: "beam-coverage",
    title: "Light Coverage",
    body,
    width: 340,
    height: 480,
    anchor: "side",
    actions: [{ label: "Close", run: () => panel.close() }],
    onClose: () => finish(),
  });
  const session: Session = { opts: o, panel, body, unsubs: [], pending: false, result: "" };
  active = session;
  session.unsubs.push(onLevels(() => schedule(session)), store.on("session", () => schedule(session)));
  refresh(session);
}

/** Recomputes after the drawing's own change listeners have run, so the instruments read are current. */
function schedule(s: Session): void {
  if (s.pending || active !== s) return;
  s.pending = true;
  queueMicrotask(() => {
    s.pending = false;
    if (active === s) refresh(s);
  });
}

function refresh(s: Session): void {
  if (!store.session) {
    s.panel.close();
    return;
  }
  s.result = compute(s.opts);
  paintReadout(s);
  appContext()?.requestDraw();
}

function finish(): void {
  const s = active;
  if (!s) return;
  active = null;
  for (const u of s.unsubs) u();
  appContext()?.requestDraw();
}

/** An instrument's photometrics in stage terms (across, up as x and y), which the light is worked out in. */
function inStage(f: Fixture, frame: StageFrame): Photometric {
  const at = toStage(frame, f.at);
  const focus = f.focus ? toStage(frame, f.focus) : null;
  return {
    at: { x: at.across, y: at.up },
    heightMm: f.heightMm,
    focus: f.focus && focus ? { x: focus.across, y: focus.up, z: f.focus.z } : null,
    beamDeg: f.beamDeg,
    fieldDeg: f.fieldDeg,
    lumens: f.lumens,
    channel: f.channel,
    color: f.color,
  };
}

/** The extent, stage terms, of every instrument's beam (its half-peak pool) on the plane: the field's faint tail would stretch the map well past the stage. */
function poolExtent(photo: readonly Photometric[], plane: number): { a0: number; a1: number; u0: number; u1: number } | null {
  let a0 = Infinity;
  let a1 = -Infinity;
  let u0 = Infinity;
  let u1 = -Infinity;
  for (const p of photo) {
    for (const q of poolOutline(p, plane, p.beamDeg)) {
      a0 = Math.min(a0, q.x);
      a1 = Math.max(a1, q.x);
      u0 = Math.min(u0, q.y);
      u1 = Math.max(u1, q.y);
    }
  }
  return Number.isFinite(a0) ? { a0, a1, u0, u1 } : null;
}

function compute(o: Options): Heat | string {
  if (!store.session) return "No drawing is open.";
  const list = fixtures();
  if (list.length === 0) return "There are no lighting instruments in this drawing yet.";
  const frame = stageFrame();
  const photo = list.map((f) => inStage(f, frame));
  const box = o.whole
    ? poolExtent(photo, o.plane)
    : { a0: -o.across / 2, a1: o.across / 2, u0: Math.min(0, o.up), u1: Math.max(0, o.up) };
  if (!box || box.a1 - box.a0 < 1 || box.u1 - box.u0 < 1) return "The area has no size. Give it an across and an up size.";
  const rect = { x0: box.a0, y0: box.u0, x1: box.a1, y1: box.u1 };
  const grid = coverage(photo, levelOf, rect, COLS, ROWS, o.plane);
  const labels = o.labels ? coverage(photo, levelOf, rect, LABEL_COLS, LABEL_ROWS, o.plane) : null;
  return {
    frame,
    ...box,
    grid,
    image: paint(grid),
    labels,
    lit: list.length,
    unfocused: list.filter((f) => !f.focus).length,
  };
}

/** The ramp's colour at t, 0 to 1. */
function rampAt(t: number): [number, number, number] {
  for (let i = 1; i < RAMP.length; i++) {
    const hi = RAMP[i];
    if (t <= hi.at) {
      const lo = RAMP[i - 1];
      const k = (t - lo.at) / (hi.at - lo.at);
      return [lo.rgb[0] + (hi.rgb[0] - lo.rgb[0]) * k, lo.rgb[1] + (hi.rgb[1] - lo.rgb[1]) * k, lo.rgb[2] + (hi.rgb[2] - lo.rgb[2]) * k];
    }
  }
  return [...RAMP[RAMP.length - 1].rgb];
}

/** The grid as an image, one pixel a cell: row 0 at the area's downstage edge, as the grid has it. */
function paint(grid: LuxGrid): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = grid.cols;
  canvas.height = grid.rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const img = ctx.createImageData(grid.cols, grid.rows);
  const top = grid.stats.max;
  for (let i = 0; i < grid.lux.length; i++) {
    const t = top > 0 ? grid.lux[i] / top : 0;
    const [r, g, b] = rampAt(t);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = t > 0 ? Math.round(255 * ALPHA * Math.min(1, t / FADE)) : 0;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** The ramp as a CSS gradient for the legend. */
function rampCss(): string {
  const [first, ...rest] = RAMP;
  const [r, g, b] = first.rgb;
  const stops = [
    `rgba(${r}, ${g}, ${b}, 0) 0%`,
    `rgba(${r}, ${g}, ${b}, ${ALPHA}) ${FADE * 100}%`,
    ...rest.map((s) => `rgb(${s.rgb.join(", ")}) ${s.at * 100}%`),
  ];
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

const lux = (v: number): string => (v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString());
const footcandles = (v: number): string => {
  const fc = v / LUX_PER_FOOTCANDLE;
  return fc < 100 ? fc.toFixed(1) : Math.round(fc).toLocaleString();
};
const luxShort = (v: number): string => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)));

function paintReadout(s: Session): void {
  const r = s.result;
  if (typeof r === "string") {
    s.body.replaceChildren(h("p", { cls: "beam-cov-note", text: r }));
    return;
  }
  const { stats } = r.grid;
  const plane = s.opts.plane;
  const across = lengthText(r.a1 - r.a0);
  const up = lengthText(r.u1 - r.u0);
  const unfocused = r.unfocused > 0 ? ` ${r.unfocused} with no focus are aimed straight down.` : "";
  const bar = h("div", { cls: "beam-ramp" });
  bar.style.background = rampCss();
  s.body.replaceChildren(
    h("p", { cls: "beam-cov-note", text: `On the plane at ${lengthText(plane)}, over ${across} across and ${up} up, from ${r.lit} instruments.${unfocused}` }),
    h(
      "dl",
      { cls: "beam-cov-stats" },
      h("dt", { text: "Minimum" }),
      h("dd", { text: `${lux(stats.min)} lx · ${footcandles(stats.min)} fc` }),
      h("dt", { text: "Average" }),
      h("dd", { text: `${lux(stats.avg)} lx · ${footcandles(stats.avg)} fc` }),
      h("dt", { text: "Maximum" }),
      h("dd", { text: `${lux(stats.max)} lx · ${footcandles(stats.max)} fc` }),
      h("dt", { text: "Uniformity (min / avg)" }),
      h("dd", { text: stats.avg > 0 ? stats.uniformity.toFixed(2) : "No light" }),
    ),
    h("div", { cls: "beam-ramp-title", text: "Lux on the plane" }),
    bar,
    h("div", { cls: "beam-ramp-scale" }, h("span", { text: "0" }), h("span", { text: `${lux(stats.max)} lx` })),
    h("p", {
      cls: "beam-cov-note",
      text:
        "An estimate. It uses each type's typical lumens, or the instrument's own figures, and a gel's brightness. " +
        "Light bounced off the stage and walls is left out, as is any loss from the lamp's age.",
    }),
  );
}

/** The heat map and its value labels, over the drawing while the window is open. */
function drawMap(p: Painter): void {
  const s = active;
  if (!s || typeof s.result === "string") return;
  const r = s.result;
  const { ctx } = p;
  const du = (r.a1 - r.a0) / COLS;
  const dv = (r.u1 - r.u0) / ROWS;
  // image pixels to screen: an affine map of the grid through the stage frame
  const screen = (px: number, py: number): Pt => p.toScreen(fromStage(r.frame, { across: r.a0 + px * du, up: r.u0 + py * dv }));
  const o = screen(0, 0);
  const ex = screen(1, 0);
  const ey = screen(0, 1);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.transform(ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y);
  ctx.drawImage(r.image, 0, 0);
  ctx.restore();

  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(30, 30, 30, 0.6)";
  ctx.beginPath();
  [screen(0, 0), screen(COLS, 0), screen(COLS, ROWS), screen(0, ROWS)].forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
  ctx.closePath();
  ctx.stroke();
  ctx.restore();

  if (!r.labels) return;
  const lw = (r.a1 - r.a0) / LABEL_COLS;
  const lh = (r.u1 - r.u0) / LABEL_ROWS;
  ctx.save();
  ctx.font = "600 11px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillStyle = "#111";
  for (let row = 0; row < LABEL_ROWS; row++) {
    for (let col = 0; col < LABEL_COLS; col++) {
      const q = p.toScreen(fromStage(r.frame, { across: r.a0 + (col + 0.5) * lw, up: r.u0 + (row + 0.5) * lh }));
      const text = luxShort(r.labels.lux[row * LABEL_COLS + col]);
      ctx.strokeText(text, q.x, q.y);
      ctx.fillText(text, q.x, q.y);
    }
  }
  ctx.restore();
}

registerOverlay(drawMap);
