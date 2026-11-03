// Stage > Lighting > Wash Planner…: asks for an area, a pipe and an instrument type, plans an even wash across
// the area (washPlan.ts) and shows it: a mini plan of the pools and units, how many and how far apart, the
// light predicted on the focus plane, the power and weight, and any warnings. Place puts the units on the
// active layer in one step, numbered from the first unit and channel, each focused on its point.

import { attempt } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs, type PrefField } from "../../../app/toolPrefs.ts";
import { aimTo, DEFAULT_HEIGHT_MM, DEFAULT_TYPE, FIXTURE_TYPES, fixtureType, FOCUS_PLANE_MM } from "../fixture.ts";
import { placeInstrument } from "../instrument.ts";
import { fromStage } from "../stage.ts";
import { lengthText, stageFrame } from "../stageTool.ts";
import { openPanel, noteLine, type OpenPanel } from "../ui.ts";
import { paintOf } from "./pools.ts";
import { poolOutline, type Photometric } from "./photometry.ts";
import { planWash, type WashPlan, type WashSpec } from "./washPlan.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const NOTE =
  "Plans an even wash of one type of instrument across an area from one pipe: focus points in rows, each unit aimed straight on, " +
  "or with McCandless half from each side at about 45°. Light is predicted from each type's typical lumens, so it's an estimate. " +
  "Place adds the units to the active layer with their numbers, channels and focus.";

let last: WashSpec = {
  typeKey: "fresnel1k",
  width: 12000,
  depth: 3000,
  upFront: 0,
  hangUp: 8000,
  heightMm: DEFAULT_HEIGHT_MM,
  planeMm: FOCUS_PLANE_MM,
  overlap: 0.35,
  color: "",
  color2: "",
  position: "",
  purpose: "Wash",
  startUnit: 1,
  startChannel: 1,
  oneChannelPerCell: true,
  mccandless: false,
};
let shown: OpenPanel | null = null;

/** Asks for the wash, plans it and shows the plan (Place adds it to the drawing). */
export async function openWashPlanner(): Promise<void> {
  if (!store.session) {
    toast("Open a drawing first.", "info");
    return;
  }
  // the plan it replaces would sit over the dialog
  shown?.close();
  const fields: readonly PrefField[] = [
    { kind: "choice", key: "type", label: "Instrument", value: last.typeKey, options: FIXTURE_TYPES.map((t) => ({ value: t.key, label: t.label })) },
    { kind: "length", key: "width", label: "Area Across", value: last.width },
    { kind: "length", key: "depth", label: "Area Up", value: last.depth },
    { kind: "length", key: "upFront", label: "Downstage Edge (up from PL)", value: last.upFront, signed: true },
    { kind: "length", key: "hangUp", label: "Pipe (up from PL)", value: last.hangUp, signed: true },
    { kind: "length", key: "height", label: "Lens Height", value: last.heightMm },
    { kind: "length", key: "plane", label: "Focus Height", value: last.planeMm, zero: true },
    { kind: "number", key: "overlap", label: "Overlap (0 to 0.8)", value: last.overlap, min: 0, max: 0.8 },
    { kind: "text", key: "color", label: "Colour 1", value: last.color },
    { kind: "check", key: "mcc", label: "Two-colour McCandless", value: last.mccandless },
    { kind: "text", key: "color2", label: "Colour 2 (McCandless)", value: last.color2 },
    { kind: "text", key: "position", label: "Position", value: last.position },
    { kind: "text", key: "purpose", label: "Purpose", value: last.purpose },
    { kind: "number", key: "unit", label: "First Unit Number", value: last.startUnit, min: 1, max: 9999, integer: true },
    { kind: "number", key: "channel", label: "First Channel", value: last.startChannel, min: 1, max: 9999, integer: true },
    { kind: "check", key: "perCell", label: "One Channel per Focus Point", value: last.oneChannelPerCell },
  ];
  const v = await toolPrefs("Wash Planner", fields, NOTE);
  if (!v) return;
  last = {
    typeKey: v.choice("type"),
    width: v.num("width"),
    depth: v.num("depth"),
    upFront: v.num("upFront"),
    hangUp: v.num("hangUp"),
    heightMm: v.num("height"),
    planeMm: v.num("plane"),
    overlap: v.num("overlap"),
    color: v.choice("color"),
    color2: v.choice("color2"),
    position: v.choice("position"),
    purpose: v.choice("purpose"),
    startUnit: v.num("unit"),
    startChannel: v.num("channel"),
    oneChannelPerCell: v.flag("perCell"),
    mccandless: v.flag("mcc"),
  };
  const plan = planWash(last);
  if (plan.count === 0) {
    toast(plan.warnings[0] ?? "Nothing to plan.", "info");
    return;
  }
  showPlan(last, plan);
}

/** The wash's numbers in words, for the window's top. */
function summary(spec: WashSpec, plan: WashPlan): HTMLElement[] {
  const type = fixtureType(spec.typeKey) ?? fixtureType(DEFAULT_TYPE)!;
  const depthText = plan.rows > 1 ? ` by ${plan.rows} deep` : "";
  const pair = spec.mccandless ? ", two units per focus point, half from each side" : "";
  const pipe = `${lengthText(Math.abs(spec.hangUp))} ${spec.hangUp >= 0 ? "upstage" : "downstage"} of PL`;
  const predicted = plan.predicted;
  const light = predicted
    ? `Predicted on the focus plane across the area: ${Math.round(predicted.min).toLocaleString()} lx at the least, ` +
      `${Math.round(predicted.avg).toLocaleString()} lx on average, uniformity (min / avg) ${predicted.uniformity.toFixed(2)}.`
    : "";
  const parts: (HTMLElement | null)[] = [
    h("p", { cls: "beam-wash-head", text: `${plan.count} × ${type.label}: ${plan.cols} across${depthText}${pair}.` }),
    h(
      "dl",
      { cls: "beam-wash-stats" },
      h("dt", { text: "Spacing" }),
      h("dd", { text: `${lengthText(plan.spacing.across)} across, ${lengthText(plan.spacing.up)} up` }),
      h("dt", { text: "Pipe" }),
      h("dd", { text: `${pipe}, lens ${lengthText(spec.heightMm)} up, focus at ${lengthText(spec.planeMm)}` }),
      h("dt", { text: "Power" }),
      h("dd", { text: `${(plan.watts / 1000).toFixed(2)} kW` }),
      h("dt", { text: "Weight" }),
      h("dd", { text: `${plan.weightKg.toFixed(1)} kg` }),
    ),
    light ? h("p", { cls: "beam-wash-note", text: light }) : null,
  ];
  return parts.filter((x): x is HTMLElement => x !== null);
}

const svgEl = (tag: string, attrs: Record<string, string | number>, text?: string): SVGElement => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
};

/** The plan seen from above, stage left to the right and upstage at the top: the area, the pipe, each pool and unit. */
function miniPlan(spec: WashSpec, plan: WashPlan): HTMLElement {
  const type = fixtureType(spec.typeKey) ?? fixtureType(DEFAULT_TYPE)!;
  const areaTop = spec.upFront + spec.depth;
  const pools = plan.fixtures.map((f) => {
    const photo: Photometric = {
      at: { x: f.across, y: f.hangUp },
      heightMm: spec.heightMm,
      focus: { x: f.focus.across, y: f.focus.up, z: spec.planeMm },
      beamDeg: type.beamDeg,
      fieldDeg: type.fieldDeg,
      lumens: type.lumens,
      channel: "",
      color: f.color,
    };
    return { f, pts: poolOutline(photo, spec.planeMm, type.fieldDeg, 48) };
  });
  // the plan's own y runs down the page, so upstage is -up
  const xs = [-spec.width / 2, spec.width / 2];
  const ups = [spec.upFront, areaTop, spec.hangUp];
  for (const p of pools) {
    for (const q of p.pts) {
      xs.push(q.x);
      ups.push(q.y);
    }
  }
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const u0 = Math.min(...ups);
  const u1 = Math.max(...ups);
  const span = Math.max(x1 - x0, u1 - u0);
  const pad = span * 0.06;
  const unit = span / 220;
  const svg = svgEl("svg", {
    viewBox: `${x0 - pad} ${-u1 - pad} ${x1 - x0 + 2 * pad} ${u1 - u0 + 2 * pad}`,
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": `Plan of ${plan.count} instruments`,
  });
  svg.append(
    svgEl("rect", { x: -spec.width / 2, y: -areaTop, width: spec.width, height: spec.depth, class: "beam-plan-area" }),
    svgEl("line", { x1: 0, y1: -u1, x2: 0, y2: -u0, class: "beam-plan-axis" }),
    svgEl("line", { x1: x0, y1: 0, x2: x1, y2: 0, class: "beam-plan-axis" }),
    svgEl("line", { x1: x0, y1: -spec.hangUp, x2: x1, y2: -spec.hangUp, class: "beam-plan-pipe" }),
    svgEl("text", { x: 0, y: -u1, dy: unit * 8, "font-size": unit * 9, "text-anchor": "middle", class: "beam-plan-label" }, "CL"),
    svgEl("text", { x: x1, y: 0, dx: -unit * 2, dy: -unit, "font-size": unit * 9, "text-anchor": "end", class: "beam-plan-label" }, "PL"),
    svgEl("text", { x: x0, y: -spec.hangUp, dx: unit * 2, dy: -unit, "font-size": unit * 9, class: "beam-plan-label" }, "Pipe"),
  );
  for (const { f, pts } of pools) {
    const [r, g, b] = paintOf(f.color);
    svg.append(
      svgEl("polygon", {
        points: pts.map((q) => `${q.x},${-q.y}`).join(" "),
        fill: `rgb(${r}, ${g}, ${b})`,
        "fill-opacity": 0.3,
        stroke: `rgb(${r}, ${g}, ${b})`,
        class: "beam-plan-pool",
      }),
    );
  }
  for (const { f } of pools) {
    svg.append(
      svgEl("rect", { x: f.across - unit * 1.2, y: -spec.hangUp - unit * 1.2, width: unit * 2.4, height: unit * 2.4, class: "beam-plan-unit" }),
      svgEl("circle", { cx: f.focus.across, cy: -f.focus.up, r: unit * 1.1, class: "beam-plan-focus" }),
    );
  }
  return h("div", { cls: "beam-plan" }, svg);
}

function showPlan(spec: WashSpec, plan: WashPlan): void {
  const body = h("div", { cls: "beam-wash" }, ...summary(spec, plan), miniPlan(spec, plan), ...plan.warnings.map((w) => noteLine(w, "th-warn")));
  body.append(noteLine("Predicted light uses each type's typical lumens and leaves out bounce. Check the real figures before you hang it."));
  const panel: OpenPanel = openPanel({
    key: "beam-wash",
    title: "Wash Plan",
    body,
    width: 640,
    height: 640,
    actions: [
      { label: "Close", run: () => panel.close() },
      {
        label: `Place ${plan.count}`,
        primary: true,
        run: () => {
          panel.close();
          place(spec, plan);
        },
      },
    ],
    onClose: () => {
      if (shown === panel) shown = null;
    },
  });
  shown = panel;
}

/** Adds the planned units to the active layer in one undo step, numbered and focused as the plan says. */
function place(spec: WashSpec, plan: WashPlan): void {
  const layerId = store.activeLayerId;
  if (!layerId) {
    toast("Make a design layer active to place the instruments.", "info");
    return;
  }
  const frame = stageFrame();
  const done = attempt("Place Wash", (s) =>
    s.batch(() => {
      plan.fixtures.forEach((f, i) => {
        const at = fromStage(frame, { across: f.across, up: f.hangUp });
        const aimAt = fromStage(frame, f.focus);
        placeInstrument(s, layerId, at, spec.typeKey, {
          position: spec.position,
          unit: String(spec.startUnit + i),
          channel: String(spec.startChannel + (spec.oneChannelPerCell ? f.cell : i)),
          color: f.color,
          purpose: spec.purpose,
          heightMm: spec.heightMm,
          focus: { x: aimAt.x, y: aimAt.y, z: spec.planeMm },
          aimDeg: aimTo(at, aimAt),
        });
      });
      return plan.count;
    }),
  );
  if (done) toast(`Placed ${plan.count} instruments on the active layer.`, "info");
}
