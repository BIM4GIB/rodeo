// The Shaft tool's Configuration dialog, after Vectorworks' Shaft Configuration: a preview of the
// shaft with the current segment in red, < Add / Delete / Add > and < Previous / Next > to build
// and walk the segments, the segment's type and length, and its Dimensions, Keyway, Groove and
// Wrench Flats tabs (the last three for straight segments); then how the whole shaft is drawn: its
// threads, centre line and centre drills. Special Threads' choices (custom, Acme, bearing lock
// nut) sit in Thread Type rather than a second dialog.

import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";
import { LOCK_NUTS } from "./bearingShapes.ts";
import { WOODRUFF_KEYS } from "./keyShapes.ts";
import { CENTRE_DRILLS, INCH_THREADS, MAX_SEGMENTS, METRIC_THREADS, shaftDrawing, type EndStyle, type MeasureFrom, type SegmentType, type Shaft, type ThreadDisplay } from "./shaftShapes.ts";
import type { Pt } from "../core/index.ts";
import "./shaftDialog.css";

export type ThreadType = "inch" | "metric" | "custom" | "acme" | "locknut";

export interface EndConfig {
  diameter: number;
  style: EndStyle;
  chamferLength: number;
  chamferAngle: number;
  filletRadius: number;
}

export interface SegmentConfig {
  type: SegmentType;
  length: number;
  left: EndConfig;
  right: EndConfig;
  thread: {
    type: ThreadType;
    inch: string;
    metric: string;
    leftHand: boolean;
    outside: number;
    pitch: number;
    angle: number;
    flatTop: number;
    flatBottom: number;
    starts: number;
    acmeOutside: number;
    acmePitch: number;
    acmeAngle: number;
    locknut: string;
    relief: "none" | "left" | "right";
  };
  keyway: {
    on: boolean;
    from: MeasureFrom;
    distance: number;
    standard: "imperial" | "metric";
    position: "front" | "top" | "bottom" | "back";
    kind: "parallel" | "woodruff";
    shape: "square" | "rectangular";
    length: number;
    woodruff: string;
  };
  groove: { on: boolean; from: MeasureFrom; distance: number; type: "round" | "rectangular" | "v"; width: number; depth: number };
  flats: { on: boolean; from: MeasureFrom; distance: number; type: "single" | "double"; length: number; across: number };
}

export interface ShaftConfig {
  segments: SegmentConfig[];
  threads: ThreadDisplay;
  centreLine: boolean;
  drill: { on: boolean; style: "plain" | "bell"; size: number; ends: "left" | "right" | "both" };
}

const end = (diameter: number, style: EndStyle = "plain"): EndConfig => ({ diameter, style, chamferLength: 1, chamferAngle: 45, filletRadius: 1 });

/** A plain straight segment `length` long and `diameter` across. */
export function newSegment(diameter: number, length: number): SegmentConfig {
  return {
    type: "straight",
    length,
    left: end(diameter),
    right: end(diameter),
    thread: {
      type: "metric",
      inch: INCH_THREADS[6].name,
      metric: METRIC_THREADS.find((t) => t.name === "M24 × 3")!.name,
      leftHand: false,
      outside: 24,
      pitch: 3,
      angle: 60,
      flatTop: 0.125,
      flatBottom: 0.25,
      starts: 1,
      acmeOutside: 24,
      acmePitch: 5,
      acmeAngle: 29,
      locknut: LOCK_NUTS[4].id,
      relief: "none",
    },
    keyway: { on: false, from: "left", distance: 5, standard: "metric", position: "front", kind: "parallel", shape: "rectangular", length: 25, woodruff: WOODRUFF_KEYS[8].id },
    groove: { on: false, from: "left", distance: 5, type: "round", width: 3, depth: 1.5 },
    flats: { on: false, from: "left", distance: 5, type: "double", length: 10, across: diameter * 0.8 },
  };
}

/** A three-segment shaft: a keyed journal, a shoulder, and a threaded end. */
export function defaultShaftConfig(): ShaftConfig {
  const journal = newSegment(25, 60);
  journal.left.style = "chamfer";
  journal.right.style = "fillet";
  journal.keyway.on = true;
  journal.keyway.distance = 10;
  const shoulder = newSegment(35, 30);
  const thread = newSegment(24, 30);
  thread.type = "threaded";
  thread.right.style = "chamfer";
  thread.right.chamferLength = 2;
  return { segments: [journal, shoulder, thread], threads: "iso", centreLine: true, drill: { on: false, style: "plain", size: 3, ends: "both" } };
}

const SEGMENT_TYPES = [
  { value: "straight", label: "Straight" },
  { value: "tapered", label: "Tapered" },
  { value: "threaded", label: "Threaded" },
];
const END_STYLES = [
  { value: "plain", label: "Plain" },
  { value: "chamfer", label: "Chamfer" },
  { value: "flare", label: "Flare" },
  { value: "fillet", label: "Fillet" },
  { value: "radius", label: "Radius" },
];
const THREAD_TYPES = [
  { value: "inch", label: "Inch Series" },
  { value: "metric", label: "Metric Series" },
  { value: "custom", label: "Custom Threads" },
  { value: "acme", label: "Acme Threads" },
  { value: "locknut", label: "Bearing Locknut Threads" },
];
const FROM = [
  { value: "left", label: "Left End" },
  { value: "right", label: "Right End" },
];
export const THREAD_DISPLAYS = [
  { value: "asme", label: "Simplified (ASME)" },
  { value: "iso", label: "Simplified (ISO)" },
  { value: "schematic", label: "Schematic" },
  { value: "detailed", label: "Detailed" },
];
const TABS = ["Dimensions", "Keyway", "Groove", "Wrench Flats"] as const;
type Tab = (typeof TABS)[number];

/** Opens the Shaft Configuration dialog on a copy of `start`; resolves to the edited configuration, or null when cancelled. */
export async function shaftConfigDialog(start: ShaftConfig, toShaft: (c: ShaftConfig) => Shaft | string): Promise<ShaftConfig | null> {
  const config: ShaftConfig = structuredClone(start);
  const units = store.session?.doc.info.units;
  let current = 0;
  let tab: Tab = "Dimensions";
  // inputs whose text isn't a value, and why
  const invalid = new Map<HTMLElement, string>();

  const preview = h("div", { cls: "shaft-preview", attrs: { "aria-label": "Shaft preview" } });
  const problem = h("p", { cls: "shaft-problem", attrs: { role: "status" } });
  const nav = h("div", { cls: "shaft-nav" });
  const head = h("div", { cls: "shaft-head" });
  const tabs = h("div", { cls: "seg shaft-tabs", attrs: { role: "tablist" } });
  const panel = h("div", { cls: "shaft-panel" });
  const whole = h("div", { cls: "shaft-whole" });

  const seg = (): SegmentConfig => config.segments[current];

  const update = (): void => {
    const shaft = toShaft(config);
    problem.textContent = typeof shaft === "string" ? `This doesn't make a shaft: ${shaft}.` : "";
    if (typeof shaft !== "string") preview.replaceChildren(previewSvg(shaft, current));
  };

  // ---- controls -----------------------------------------------------------
  const field = (label: string, input: HTMLElement, unit = ""): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), input, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  const length = (label: string, aria: string, get: () => number, set: (v: number) => void, opts: { zero?: boolean; disabled?: boolean; rerender?: boolean } = {}): HTMLElement => {
    const input = h("input", { cls: "menu-dialog-input", value: formatLengthValue(get(), units), disabled: opts.disabled, attrs: { type: "text", inputmode: "decimal", "aria-label": aria } });
    input.addEventListener("change", () => {
      const mm = parseLength(input.value, units);
      if (mm !== null && (mm > 0 || (opts.zero && mm === 0))) {
        invalid.delete(input);
        input.classList.remove("invalid");
        set(mm);
        if (opts.rerender) render();
        else update();
      } else {
        invalid.set(input, `${aria}: enter a length ${opts.zero ? "of 0 or more" : "greater than 0"}.`);
        input.classList.add("invalid");
      }
    });
    return field(label, input, lengthSuffix(units));
  };
  const number = (label: string, aria: string, get: () => number, set: (v: number) => void, min: number, max: number, unit: string, opts: { integer?: boolean; disabled?: boolean } = {}): HTMLElement => {
    const input = h("input", { cls: "menu-dialog-input", value: String(get()), disabled: opts.disabled, attrs: { type: "text", inputmode: "decimal", "aria-label": aria } });
    input.addEventListener("change", () => {
      const n = Number(input.value.trim().replace(",", "."));
      if (input.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max && (!opts.integer || Number.isInteger(n))) {
        invalid.delete(input);
        input.classList.remove("invalid");
        set(n);
        update();
      } else {
        invalid.set(input, `${aria}: enter ${opts.integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
        input.classList.add("invalid");
      }
    });
    return field(label, input, unit);
  };
  const choice = <T extends string>(label: string, aria: string, options: readonly { value: string; label: string }[], get: () => T, set: (v: T) => void, opts: { rerender?: boolean; disabled?: boolean } = {}): HTMLElement => {
    const select = h("select", { cls: "menu-dialog-input menu-dialog-select", disabled: opts.disabled, attrs: { "aria-label": aria } }, ...options.map((o) => h("option", { value: o.value, text: o.label })));
    select.value = get();
    select.addEventListener("change", () => {
      set(select.value as T);
      if (opts.rerender) render();
      else update();
    });
    return field(label, select);
  };
  const check = (label: string, get: () => boolean, set: (v: boolean) => void): HTMLElement => {
    const input = h("input", { checked: get(), attrs: { type: "checkbox" } });
    input.addEventListener("change", () => {
      set(input.checked);
      render();
    });
    return h("label", { cls: "menu-dialog-check" }, input, label);
  };
  const button = (text: string, onClick: () => void, disabled = false): HTMLButtonElement => {
    const b = h("button", { cls: "btn small", text, disabled, attrs: { type: "button" } });
    b.addEventListener("click", onClick);
    return b;
  };
  const group = (title: string, ...rows: HTMLElement[]): HTMLElement => h("fieldset", { cls: "shaft-group" }, h("legend", { text: title }), ...rows);

  // ---- the segment's tabs -------------------------------------------------
  const endGroup = (side: "left" | "right"): HTMLElement => {
    const s = seg();
    const e = s[side];
    const name = side === "left" ? "Left End" : "Right End";
    const bevel = e.style === "chamfer" || e.style === "flare";
    const round = e.style === "fillet" || e.style === "radius";
    const sameAsLeft = side === "right" && s.type === "straight";
    return group(
      name,
      length("Diameter:", `${name} Diameter`, () => (sameAsLeft ? s.left.diameter : e.diameter), (v) => (e.diameter = v), { disabled: sameAsLeft, rerender: side === "left" && s.type === "straight" }),
      choice("Style:", `${name} Style`, END_STYLES, () => e.style, (v) => (e.style = v), { rerender: true }),
      length("Chamfer Length:", `${name} Chamfer Length`, () => e.chamferLength, (v) => (e.chamferLength = v), { disabled: !bevel }),
      number("Chamfer Angle:", `${name} Chamfer Angle`, () => e.chamferAngle, (v) => (e.chamferAngle = v), 0.1, 89.9, "°", { disabled: !bevel }),
      length("Fillet Radius:", `${name} Fillet Radius`, () => e.filletRadius, (v) => (e.filletRadius = v), { disabled: !round }),
    );
  };
  const threadEnd = (side: "left" | "right"): HTMLElement[] => {
    const e = seg()[side];
    const name = side === "left" ? "Left End" : "Right End";
    const chamfered = e.style === "chamfer";
    return [
      choice(`${name}:`, name, [{ value: "plain", label: "Plain" }, { value: "chamfer", label: "Chamfered" }], () => (chamfered ? "chamfer" : "plain"), (v) => (e.style = v), { rerender: true }),
      length("Chamfer Length:", `${name} Chamfer Length`, () => e.chamferLength, (v) => (e.chamferLength = v), { disabled: !chamfered }),
      number("Chamfer Angle:", `${name} Chamfer Angle`, () => e.chamferAngle, (v) => (e.chamferAngle = v), 0.1, 89.9, "°", { disabled: !chamfered }),
    ];
  };
  const threads = (): HTMLElement => {
    const t = seg().thread;
    const rows: HTMLElement[] = [
      choice("Thread Type:", "Thread Type", THREAD_TYPES, () => t.type, (v) => (t.type = v), { rerender: true }),
      choice("Inch Sizes:", "Inch Sizes", INCH_THREADS.map((s) => ({ value: s.name, label: s.name })), () => t.inch, (v) => (t.inch = v), { disabled: t.type !== "inch" }),
      choice("Metric Sizes:", "Metric Sizes", METRIC_THREADS.map((s) => ({ value: s.name, label: s.name })), () => t.metric, (v) => (t.metric = v), { disabled: t.type !== "metric" }),
      choice("Thread Spiral:", "Thread Spiral", [{ value: "right", label: "Right Hand" }, { value: "left", label: "Left Hand" }], () => (t.leftHand ? "left" : "right"), (v) => (t.leftHand = v === "left")),
    ];
    if (t.type === "custom") {
      rows.push(
        length("Outside Diameter:", "Outside Diameter", () => t.outside, (v) => (t.outside = v)),
        length("Pitch:", "Pitch", () => t.pitch, (v) => (t.pitch = v)),
        number("Included Angle:", "Included Angle", () => t.angle, (v) => (t.angle = v), 1, 179, "°"),
        number("Flatness (Top):", "Flatness (Top)", () => t.flatTop, (v) => (t.flatTop = v), 0, 0.99, "× pitch"),
        number("Flatness (Bottom):", "Flatness (Bottom)", () => t.flatBottom, (v) => (t.flatBottom = v), 0, 0.99, "× pitch"),
        number("Number of Starts:", "Number of Starts", () => t.starts, (v) => (t.starts = v), 1, 8, "", { integer: true }),
      );
    }
    if (t.type === "acme") {
      rows.push(
        length("Outside Diameter:", "Outside Diameter", () => t.acmeOutside, (v) => (t.acmeOutside = v)),
        length("Pitch:", "Pitch", () => t.acmePitch, (v) => (t.acmePitch = v)),
        choice("Included Angle:", "Included Angle", [{ value: "29", label: "29-deg (Standard)" }, { value: "30", label: "30-deg (Metric Trapezoidal)" }], () => String(t.acmeAngle), (v) => (t.acmeAngle = Number(v))),
      );
    }
    if (t.type === "locknut") {
      rows.push(
        choice("Locknut Number:", "Locknut Number", LOCK_NUTS.map((n) => ({ value: n.id, label: `${n.id} (M${n.thread} × ${n.pitch})` })), () => t.locknut, (v) => (t.locknut = v)),
        choice("Thread Relief:", "Thread Relief", [{ value: "none", label: "None" }, { value: "left", label: "Left" }, { value: "right", label: "Right" }], () => t.relief, (v) => (t.relief = v)),
      );
    }
    return h("div", { cls: "shaft-cols" }, group("Threads", ...rows), group("Ends", ...threadEnd("left"), ...threadEnd("right")));
  };
  const keyway = (): HTMLElement[] => {
    const k = seg().keyway;
    const rows = [check("Add Keyway", () => k.on, (v) => (k.on = v))];
    if (!k.on) return rows;
    const sizes = WOODRUFF_KEYS.filter((w) => w.metric === (k.standard === "metric"));
    if (!sizes.some((w) => w.id === k.woodruff)) k.woodruff = sizes[0].id;
    rows.push(
      h(
        "div",
        { cls: "shaft-cols" },
        h(
          "div",
          {},
          choice("Measure From:", "Measure From", FROM, () => k.from, (v) => (k.from = v)),
          length("Distance:", "Distance", () => k.distance, (v) => (k.distance = v), { zero: true }),
          choice("Keyway:", "Keyway Type", [{ value: "parallel", label: "Rectangular Keyway" }, { value: "woodruff", label: "Woodruff Keyway" }], () => k.kind, (v) => (k.kind = v), { rerender: true }),
        ),
        h(
          "div",
          {},
          choice("Key Standard:", "Key Standard", [{ value: "imperial", label: "Imperial" }, { value: "metric", label: "Metric" }], () => k.standard, (v) => (k.standard = v), { rerender: true }),
          choice("Position:", "Position", [{ value: "front", label: "Front" }, { value: "top", label: "Top" }, { value: "bottom", label: "Bottom" }, { value: "back", label: "Back" }], () => k.position, (v) => (k.position = v)),
        ),
      ),
      k.kind === "parallel"
        ? group(
            "Rectangular Keyway",
            choice("Size:", "Keyway Size", [{ value: "square", label: "Standard Square Keyway" }, { value: "rectangular", label: "Standard Rectangular Keyway" }], () => k.shape, (v) => (k.shape = v)),
            length("Length:", "Keyway Length", () => k.length, (v) => (k.length = v)),
          )
        : group("Woodruff Keyway", choice("Nom. Size:", "Nom. Size", sizes.map((w) => ({ value: w.id, label: w.label })), () => k.woodruff, (v) => (k.woodruff = v))),
    );
    return rows;
  };
  const groove = (): HTMLElement[] => {
    const g = seg().groove;
    const rows = [check("Add Groove", () => g.on, (v) => (g.on = v))];
    if (!g.on) return rows;
    rows.push(
      choice("Measure From:", "Measure From", FROM, () => g.from, (v) => (g.from = v)),
      length("Distance:", "Distance", () => g.distance, (v) => (g.distance = v), { zero: true }),
      choice("Type:", "Groove Type", [{ value: "round", label: "Round Groove" }, { value: "rectangular", label: "Rectangular Groove" }, { value: "v", label: "V-Groove" }], () => g.type, (v) => (g.type = v)),
      length("Width:", "Groove Width", () => g.width, (v) => (g.width = v)),
      length("Depth:", "Groove Depth", () => g.depth, (v) => (g.depth = v)),
    );
    return rows;
  };
  const flats = (): HTMLElement[] => {
    const f = seg().flats;
    const rows = [check("Add Wrench Flats", () => f.on, (v) => (f.on = v))];
    if (!f.on) return rows;
    rows.push(
      choice("Measure From:", "Measure From", FROM, () => f.from, (v) => (f.from = v)),
      length("Distance:", "Distance", () => f.distance, (v) => (f.distance = v), { zero: true }),
      choice("Type:", "Wrench Flats Type", [{ value: "single", label: "Single" }, { value: "double", label: "Double" }], () => f.type, (v) => (f.type = v)),
      length("Length:", "Wrench Flats Length", () => f.length, (v) => (f.length = v)),
      length("Width Across Flats:", "Width Across Flats", () => f.across, (v) => (f.across = v)),
    );
    return rows;
  };

  // ---- the whole dialog ---------------------------------------------------
  const render = (): void => {
    invalid.clear();
    const s = seg();
    if (s.type !== "straight" && tab !== "Dimensions") tab = "Dimensions";
    const count = config.segments.length;
    const add = (at: number): void => {
      const from = seg();
      const next = newSegment(from.type === "threaded" ? from.thread.outside : from.left.diameter, from.length);
      config.segments.splice(at, 0, next);
      current = at;
      render();
    };
    nav.replaceChildren(
      button("< Add", () => add(current), count >= MAX_SEGMENTS),
      button("Delete", () => {
        config.segments.splice(current, 1);
        current = Math.min(current, config.segments.length - 1);
        render();
      }, count <= 1),
      button("Add >", () => add(current + 1), count >= MAX_SEGMENTS),
      h("span", { cls: "shaft-gap" }),
      button("< Previous", () => {
        current--;
        render();
      }, current === 0),
      h("span", { cls: "shaft-count", text: `Segment ${current + 1} of ${count}` }),
      button("Next >", () => {
        current++;
        render();
      }, current >= count - 1),
    );
    head.replaceChildren(
      choice("Segment Type:", "Segment Type", SEGMENT_TYPES, () => s.type, (v) => {
        if (v !== "straight") s.keyway.on = s.groove.on = s.flats.on = false;
        if (v === "threaded" && s.left.style !== "chamfer") s.left.style = "plain";
        if (v === "threaded" && s.right.style !== "chamfer") s.right.style = "plain";
        s.type = v;
      }, { rerender: true }),
      length("Segment Length:", "Segment Length", () => s.length, (v) => (s.length = v)),
    );
    tabs.replaceChildren(
      ...TABS.map((t) => {
        const b = h("button", { cls: `seg-btn${t === tab ? " active" : ""}`, text: t, disabled: t !== "Dimensions" && s.type !== "straight", attrs: { type: "button", role: "tab", "aria-selected": String(t === tab) } });
        b.addEventListener("click", () => {
          tab = t;
          render();
        });
        return b;
      }),
    );
    if (tab === "Dimensions") panel.replaceChildren(s.type === "threaded" ? threads() : h("div", { cls: "shaft-cols" }, endGroup("left"), endGroup("right")));
    else panel.replaceChildren(...(tab === "Keyway" ? keyway() : tab === "Groove" ? groove() : flats()));
    const d = config.drill;
    whole.replaceChildren(
      h(
        "div",
        { cls: "shaft-cols" },
        h(
          "div",
          {},
          choice("Show Threads As:", "Show Threads As", THREAD_DISPLAYS, () => config.threads, (v) => (config.threads = v)),
          check("Show Center Line", () => config.centreLine, (v) => (config.centreLine = v)),
          check("Add Center Drill", () => d.on, (v) => (d.on = v)),
        ),
        d.on
          ? h(
              "div",
              {},
              choice("Center Drill:", "Center Drill", [{ value: "plain", label: "Plain" }, { value: "bell", label: "Bell" }], () => d.style, (v) => (d.style = v)),
              choice("Size:", "Center Drill Size", CENTRE_DRILLS.map((c, i) => ({ value: String(i), label: `${c.pilot} mm (DIN 332)` })), () => String(d.size), (v) => (d.size = Number(v))),
              choice("Ends:", "Center Drill Ends", [{ value: "left", label: "Left" }, { value: "right", label: "Right" }, { value: "both", label: "Both" }], () => d.ends, (v) => (d.ends = v)),
            )
          : h("div", {}),
      ),
    );
    update();
  };
  render();

  return showDialog<ShaftConfig>({
    title: "Shaft Configuration",
    okLabel: "OK",
    cls: "shaft-dialog",
    body: [preview, problem, nav, head, tabs, panel, whole],
    check: () => {
      const [input, message] = invalid.entries().next().value ?? [];
      if (input && message) return { error: message, focus: input };
      const shaft = toShaft(config);
      if (typeof shaft === "string") return { error: `This doesn't make a shaft: ${shaft}.` };
      return { value: config };
    },
  });
}

/** The shaft drawn small, the `current` segment in red. */
function previewSvg(shaft: Shaft, current: number): SVGSVGElement {
  const d = shaftDrawing(shaft, null);
  const all = [...d.outlines, ...d.lines, ...d.hidden].flat();
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const pad = 2;
  const x0 = Math.min(...xs) - pad;
  const x1 = Math.max(...xs) + pad;
  const y0 = Math.min(...ys) - pad;
  const y1 = Math.max(...ys) + pad;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `${x0} ${-y1} ${x1 - x0} ${y1 - y0}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const pathOf = (pts: readonly Pt[], closed: boolean): string => `M${pts.map((p) => `${p.x},${-p.y}`).join("L")}${closed ? "Z" : ""}`;
  const paths = (g: SVGGElement): void => {
    for (const [list, closed, cls] of [[d.outlines, true, ""], [d.lines, false, ""], [d.hidden, false, "hidden"]] as const) {
      for (const pts of list) {
        const p = document.createElementNS(ns, "path");
        p.setAttribute("d", pathOf(pts, closed));
        if (cls) p.setAttribute("class", cls);
        g.append(p);
      }
    }
  };
  const all1 = document.createElementNS(ns, "g");
  paths(all1);
  // the current segment again in red, cut to its length
  let from = 0;
  for (let i = 0; i < current; i++) from += shaft.segments[i].length;
  const clip = document.createElementNS(ns, "clipPath");
  clip.id = "shaft-current";
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", String(from));
  rect.setAttribute("y", String(-y1));
  rect.setAttribute("width", String(shaft.segments[current]?.length ?? 0));
  rect.setAttribute("height", String(y1 - y0));
  clip.append(rect);
  const red = document.createElementNS(ns, "g");
  red.setAttribute("class", "current");
  red.setAttribute("clip-path", "url(#shaft-current)");
  paths(red);
  svg.append(clip, all1, red);
  return svg;
}
