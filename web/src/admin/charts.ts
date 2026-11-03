// The admin page's charts, drawn as SVG at the card's width (and again when it changes): columns
// a day, stacked when there are two series; lines for two amounts of money; and bar lists for
// the breakdowns. Every chart has a hover tooltip, and a table view of the same numbers. Colours
// are the series tokens in admin.css, checked for colour-blind separation on both themes'
// surfaces; text stays in the text tokens.

import { h } from "../app/dom.ts";
import type { Tally } from "../platform/protocol.ts";
import { day } from "./format.ts";

const SVG = "http://www.w3.org/2000/svg";
const HEIGHT = 180;
const LEFT = 40;
const BOTTOM = 22;
const TOP = 8;
/** columns at most this wide; the rest of each day's band is air */
const MAX_BAR = 24;

export interface Series {
  readonly key: string;
  readonly label: string;
  /** a CSS colour, a token ("var(--series-1)") */
  readonly color: string;
}

/** A row a chart draws: its day ("2026-11-03", or a week's first day) and a value per series key. */
export interface Point {
  readonly day: string;
  readonly values: Readonly<Record<string, number>>;
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * A round top for the axis at or above `max`: 1, 2, 2.5 or 5 times a power of ten. Counts get
 * a top whose half is whole too (4 rather than 5, 20 rather than 25).
 */
function niceMax(max: number, whole: boolean): number {
  if (max <= 0) return whole ? 2 : 1;
  if (whole && max <= 10) return Math.max(2, Math.ceil(max / 2) * 2);
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of whole ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p;
  return 10 * p;
}

/** Days into weeks (summed) once there are too many to draw one column each. */
export function byWeek(points: readonly Point[]): Point[] {
  if (points.length <= 92) return [...points];
  const out: Point[] = [];
  for (let i = 0; i < points.length; i += 7) {
    const week = points.slice(i, i + 7);
    const values: Record<string, number> = {};
    for (const p of week) for (const [k, v] of Object.entries(p.values)) values[k] = (values[k] ?? 0) + v;
    out.push({ day: week[0].day, values });
  }
  return out;
}

function legend(series: readonly Series[]): HTMLElement | null {
  if (series.length < 2) return null;
  return h(
    "div",
    { cls: "adm-legend" },
    ...series.map((s) => h("span", { cls: "adm-legend-item" }, h("span", { cls: "adm-swatch", attrs: { style: `background:${s.color}` } }), s.label)),
  );
}

function table(points: readonly Point[], series: readonly Series[], format: (n: number) => string, weekly: boolean): HTMLElement {
  return h(
    "div",
    { cls: "adm-table-wrap" },
    h(
      "table",
      { cls: "adm-table compact" },
      h("thead", {}, h("tr", {}, h("th", { text: weekly ? "Week of" : "Day" }), ...series.map((s) => h("th", { cls: "num", text: s.label })))),
      h(
        "tbody",
        {},
        ...[...points].reverse().map((p) => h("tr", {}, h("td", { text: day(p.day) }), ...series.map((s) => h("td", { cls: "num", text: format(p.values[s.key] ?? 0) })))),
      ),
    ),
  );
}

/** A card with a title, a note, and a chart that a Table button swaps for its numbers. */
export function chartCard(title: string, note: string | null, chart: HTMLElement, tableView: () => HTMLElement): HTMLElement {
  const toggle = h("button", { cls: "adm-btn small ghost", text: "Table", attrs: { type: "button", "aria-pressed": "false" } });
  const body = h("div", { cls: "adm-chart-body" }, chart);
  toggle.addEventListener("click", () => {
    const showTable = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(showTable));
    toggle.textContent = showTable ? "Chart" : "Table";
    body.replaceChildren(showTable ? tableView() : chart);
  });
  return h(
    "section",
    { cls: "adm-card adm-chart-card" },
    h("div", { cls: "adm-card-head" }, h("h3", { cls: "adm-card-title", text: title }), toggle),
    note ? h("p", { cls: "adm-card-note", text: note }) : null,
    body,
  );
}

/** Draws `draw(width)` into a box now and whenever its width changes. */
function responsive(draw: (width: number) => Node[]): HTMLElement {
  const box = h("div", { cls: "adm-chart" });
  let last = 0;
  const paint = (): void => {
    const width = Math.floor(box.clientWidth);
    // not laid out yet, or hidden (the table shown in its place)
    if (width < LEFT + 60 || width === last) return;
    last = width;
    box.replaceChildren(...draw(width));
  };
  new ResizeObserver(paint).observe(box);
  requestAnimationFrame(paint);
  return box;
}

/** The tooltip a chart shows beside the mark under the pointer. */
function tooltip(box: HTMLElement): { show: (x: number, y: number, rows: Node[]) => void; hide: () => void; el: HTMLElement } {
  const el = h("div", { cls: "adm-tip", hidden: true, attrs: { role: "status" } });
  return {
    el,
    show(x, y, rows) {
      el.replaceChildren(...rows);
      el.hidden = false;
      const w = el.offsetWidth;
      const left = Math.min(Math.max(0, x - w / 2), box.clientWidth - w);
      el.style.left = `${left}px`;
      el.style.top = `${Math.max(0, y - el.offsetHeight - 8)}px`;
    },
    hide() {
      el.hidden = true;
    },
  };
}

function tipRows(p: Point, series: readonly Series[], format: (n: number) => string, weekly: boolean, total?: string): Node[] {
  return [
    h("div", { cls: "adm-tip-title", text: weekly ? `Week of ${day(p.day)}` : day(p.day) }),
    ...series.map((s) =>
      h(
        "div",
        { cls: "adm-tip-row" },
        h("span", { cls: "adm-swatch", attrs: { style: `background:${s.color}` } }),
        h("span", { text: s.label }),
        h("span", { cls: "adm-tip-value", text: format(p.values[s.key] ?? 0) }),
      ),
    ),
    ...(total !== undefined ? [h("div", { cls: "adm-tip-row total" }, h("span", { text: "In all" }), h("span", { cls: "adm-tip-value", text: total }))] : []),
  ];
}

/** The y axis: three hairlines with their values, and the days under the plot. */
function axes(g: SVGGElement, width: number, top: number, points: readonly Point[], format: (n: number) => string, bandX: (i: number) => number): void {
  for (const f of [0, 0.5, 1]) {
    const y = TOP + (HEIGHT - TOP - BOTTOM) * (1 - f);
    g.append(svg("line", { x1: LEFT, x2: width, y1: y, y2: y, class: "adm-grid" }));
    const label = svg("text", { x: LEFT - 6, y: y + 4, class: "adm-axis", "text-anchor": "end" });
    label.textContent = format(top * f);
    g.append(label);
  }
  // first, middle and last day
  const picks = points.length > 2 ? [0, Math.floor((points.length - 1) / 2), points.length - 1] : points.map((_, i) => i);
  for (const i of picks) {
    const t = svg("text", { x: bandX(i), y: HEIGHT - 6, class: "adm-axis", "text-anchor": i === 0 && picks.length > 1 ? "start" : i === points.length - 1 && picks.length > 1 ? "end" : "middle" });
    t.textContent = day(points[i].day);
    g.append(t);
  }
}

/** A column a day; with two or more series they stack, a 2px surface gap between their parts. */
export function columnChart(title: string, note: string | null, points: readonly Point[], series: readonly Series[], format: (n: number) => string): HTMLElement {
  const weekly = points.length > 92;
  const rows = byWeek(points);
  let tip: ReturnType<typeof tooltip> | null = null;
  const chart = responsive((width) => {
    const plotW = width - LEFT;
    const plotH = HEIGHT - TOP - BOTTOM;
    const sums = rows.map((p) => series.reduce((s, x) => s + (p.values[x.key] ?? 0), 0));
    const top = niceMax(Math.max(...sums, 0), sums.every(Number.isInteger));
    const band = plotW / Math.max(1, rows.length);
    const bar = Math.max(1, Math.min(MAX_BAR, band - Math.max(2, band * 0.3)));
    const x = (i: number): number => LEFT + band * i + band / 2;
    const root = svg("svg", { width, height: HEIGHT, class: "adm-svg", role: "img", "aria-label": title });
    const g = svg("g");
    axes(g, width, top, rows, format, x);
    const hover = svg("rect", { y: TOP, height: plotH, width: band, class: "adm-hover", visibility: "hidden" });
    g.append(hover);
    rows.forEach((p, i) => {
      let base = HEIGHT - BOTTOM;
      const parts = series.map((s) => ({ s, v: p.values[s.key] ?? 0 })).filter((q) => q.v > 0);
      parts.forEach((q, j) => {
        const full = (q.v / top) * plotH;
        const gap = j > 0 ? 2 : 0;
        const hgt = Math.max(0, full - gap);
        const y = base - full;
        const left = x(i) - bar / 2;
        if (j === parts.length - 1 && hgt > 0) {
          // the data end is rounded, the baseline end square
          const r = Math.min(4, bar / 2, hgt);
          g.append(
            svg("path", {
              d: `M${left},${y + hgt} V${y + r} Q${left},${y} ${left + r},${y} H${left + bar - r} Q${left + bar},${y} ${left + bar},${y + r} V${y + hgt} Z`,
              fill: q.s.color,
            }),
          );
        } else if (hgt > 0) {
          g.append(svg("rect", { x: left, y, width: bar, height: hgt, fill: q.s.color }));
        }
        base = y;
      });
    });
    // one target per band, the full height, bigger than the mark
    const hit = svg("rect", { x: LEFT, y: TOP, width: plotW, height: plotH, fill: "transparent" });
    hit.addEventListener("pointermove", (e) => {
      const i = Math.min(rows.length - 1, Math.max(0, Math.floor((e.offsetX - LEFT) / band)));
      hover.setAttribute("x", String(LEFT + band * i));
      hover.setAttribute("visibility", "visible");
      const total = series.length > 1 ? format(sums[i]) : undefined;
      tip?.show(x(i), HEIGHT - BOTTOM - (sums[i] / top) * plotH, tipRows(rows[i], series, format, weekly, total));
    });
    hit.addEventListener("pointerleave", () => {
      hover.setAttribute("visibility", "hidden");
      tip?.hide();
    });
    g.append(hit);
    root.append(g);
    tip = tooltip(chart);
    return [root, tip.el];
  });
  const body = h("div", {}, legend(series), chart);
  return chartCard(title, note, body, () => table(rows, series, format, weekly));
}

/** Two or three amounts a day as 2px lines with a crosshair, on one axis (same unit). */
export function lineChart(title: string, note: string | null, points: readonly Point[], series: readonly Series[], format: (n: number) => string): HTMLElement {
  const weekly = points.length > 92;
  const rows = byWeek(points);
  let tip: ReturnType<typeof tooltip> | null = null;
  const chart = responsive((width) => {
    const plotW = width - LEFT - 6;
    const plotH = HEIGHT - TOP - BOTTOM;
    const top = niceMax(Math.max(0, ...rows.flatMap((p) => series.map((s) => p.values[s.key] ?? 0))), false);
    const step = rows.length > 1 ? plotW / (rows.length - 1) : 0;
    const x = (i: number): number => LEFT + (rows.length > 1 ? step * i : plotW / 2);
    const y = (v: number): number => HEIGHT - BOTTOM - (v / top) * plotH;
    const root = svg("svg", { width, height: HEIGHT, class: "adm-svg", role: "img", "aria-label": title });
    const g = svg("g");
    axes(g, width, top, rows, format, x);
    const cross = svg("line", { y1: TOP, y2: HEIGHT - BOTTOM, class: "adm-cross", visibility: "hidden" });
    g.append(cross);
    for (const s of series) {
      const d = rows.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.values[s.key] ?? 0)}`).join(" ");
      g.append(svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      const last = rows.length - 1;
      if (last >= 0) g.append(svg("circle", { cx: x(last), cy: y(rows[last].values[s.key] ?? 0), r: 4, fill: s.color, class: "adm-dot" }));
    }
    const dots = series.map((s) => {
      const c = svg("circle", { r: 4, fill: s.color, class: "adm-dot", visibility: "hidden" });
      g.append(c);
      return c;
    });
    const hit = svg("rect", { x: LEFT, y: TOP, width: plotW + 6, height: plotH, fill: "transparent" });
    hit.addEventListener("pointermove", (e) => {
      const i = rows.length > 1 ? Math.min(rows.length - 1, Math.max(0, Math.round((e.offsetX - LEFT) / step))) : 0;
      cross.setAttribute("x1", String(x(i)));
      cross.setAttribute("x2", String(x(i)));
      cross.setAttribute("visibility", "visible");
      series.forEach((s, j) => {
        dots[j].setAttribute("cx", String(x(i)));
        dots[j].setAttribute("cy", String(y(rows[i].values[s.key] ?? 0)));
        dots[j].setAttribute("visibility", "visible");
      });
      const high = Math.max(...series.map((s) => rows[i].values[s.key] ?? 0));
      tip?.show(x(i), y(high), tipRows(rows[i], series, format, weekly));
    });
    hit.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      for (const d of dots) d.setAttribute("visibility", "hidden");
      tip?.hide();
    });
    g.append(hit);
    root.append(g);
    tip = tooltip(chart);
    return [root, tip.el];
  });
  const body = h("div", {}, legend(series), chart);
  return chartCard(title, note, body, () => table(rows, series, format, weekly));
}

/** A breakdown: each label with a bar for its share of the largest, and its count. */
export function barList(title: string, tallies: readonly Tally[], label: (t: Tally) => string = (t) => t.label, empty = "Nothing yet"): HTMLElement {
  const max = Math.max(1, ...tallies.map((t) => t.count));
  const total = tallies.reduce((s, t) => s + t.count, 0);
  return h(
    "section",
    { cls: "adm-card adm-list-card" },
    h("div", { cls: "adm-card-head" }, h("h3", { cls: "adm-card-title", text: title })),
    tallies.length === 0
      ? h("p", { cls: "adm-empty", text: empty })
      : h(
          "ul",
          { cls: "adm-bars" },
          ...tallies.map((t) =>
            h(
              "li",
              { cls: "adm-bar-row", title: `${label(t)}: ${t.count} (${Math.round((t.count / total) * 100)}%)` },
              h("span", { cls: "adm-bar-label", text: label(t) }),
              h("span", { cls: "adm-bar-track" }, h("span", { cls: "adm-bar-fill", attrs: { style: `width:${(t.count / max) * 100}%` } })),
              h("span", { cls: "adm-bar-value", text: String(t.count) }),
            ),
          ),
        ),
  );
}
