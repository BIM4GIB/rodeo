// The Audience tab's charts that charts.ts doesn't draw: a heatmap (a grid of counts shaded from
// empty to the largest, a tooltip under the pointer), a funnel (each step's bar as wide as its
// share of the first) and a cohort table (the share of each sign-up week still in Rodeo, week by
// week). Each sits in chartCard, so it has the same title, note and Table button as the others.

import { h } from "../app/dom.ts";
import type { AdminEngagement } from "../platform/protocol.ts";
import { chartCard } from "./charts.ts";
import { count, day, share } from "./format.ts";

/** a non-empty cell is shaded at least this much, so a small count still shows */
const MIN_SHADE = 10;
/** more columns than this and only every third is labelled */
const LABEL_EVERY_ABOVE = 12;

type Cohort = AdminEngagement["cohorts"][number];

/**
 * A grid of counts (rows by columns), each cell shaded from the surface to the series colour by
 * how large it is against the largest. The cell under the pointer gets a tooltip.
 */
export function heatmap(
  title: string,
  note: string | null,
  grid: readonly (readonly number[])[],
  rowLabels: readonly string[],
  colLabels: readonly string[],
  format: (n: number) => string,
): HTMLElement {
  const max = Math.max(0, ...grid.flat());
  const every = colLabels.length > LABEL_EVERY_ABOVE ? 3 : 1;
  const box = h("div", { cls: "adm-chart2-heat" });
  const tip = h("div", { cls: "adm-tip", hidden: true, attrs: { role: "status" } });

  const showTip = (cell: HTMLElement, r: number, c: number, v: number): void => {
    tip.replaceChildren(h("div", { cls: "adm-tip-title", text: `${rowLabels[r] ?? ""} ${colLabels[c] ?? ""}` }), h("div", { cls: "adm-tip-row", text: format(v) }));
    tip.hidden = false;
    const at = cell.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const x = at.left - b.left + at.width / 2;
    tip.style.left = `${Math.min(Math.max(0, x - tip.offsetWidth / 2), b.width - tip.offsetWidth)}px`;
    tip.style.top = `${Math.max(0, at.top - b.top - tip.offsetHeight - 6)}px`;
  };

  const plot = h("div", { cls: "adm-chart2-grid", attrs: { style: `grid-template-columns: auto repeat(${colLabels.length}, minmax(0, 1fr))` } });
  plot.append(h("span"), ...colLabels.map((c, i) => h("span", { cls: "adm-chart2-col", text: i % every === 0 ? c : "" })));
  grid.forEach((row, r) => {
    plot.append(h("span", { cls: "adm-chart2-row", text: rowLabels[r] ?? "" }));
    row.forEach((v, c) => {
      const pct = v > 0 ? Math.max(MIN_SHADE, (v / max) * 100) : 0;
      const cell = h("span", {
        cls: "adm-chart2-cell",
        attrs: {
          style: `background: color-mix(in srgb, var(--series-1) ${pct.toFixed(1)}%, var(--surface-2))`,
          role: "img",
          "aria-label": `${rowLabels[r] ?? ""} ${colLabels[c] ?? ""}: ${format(v)}`,
        },
      });
      cell.addEventListener("pointerenter", () => showTip(cell, r, c, v));
      cell.addEventListener("pointerleave", () => {
        tip.hidden = true;
      });
      plot.append(cell);
    });
  });

  const scale = h("div", { cls: "adm-chart2-scale" }, h("span", { text: "Fewer" }), h("span", { cls: "adm-chart2-scale-bar" }), h("span", { text: "More" }));
  box.append(plot, tip, scale);

  const tableView = (): HTMLElement =>
    h(
      "div",
      { cls: "adm-table-wrap" },
      h(
        "table",
        { cls: "adm-table compact" },
        h("thead", {}, h("tr", {}, h("th"), ...colLabels.map((c) => h("th", { cls: "num", text: c })))),
        h("tbody", {}, ...grid.map((row, r) => h("tr", {}, h("td", { text: rowLabels[r] ?? "" }), ...row.map((v) => h("td", { cls: "num", text: format(v) }))))),
      ),
    );
  return chartCard(title, note, box, tableView);
}

/**
 * The steps from one thing to the next, as bars: each as wide as its share of the first step,
 * with its count, its share of the step before and of the first.
 */
export function funnel(title: string, note: string | null, steps: AdminEngagement["funnel"], format: (n: number) => string): HTMLElement {
  const first = steps.length ? steps[0].count : 0;
  const list = h(
    "ol",
    { cls: "adm-chart2-funnel" },
    ...steps.map((s, i) => {
      const before = i > 0 ? steps[i - 1].count : 0;
      const width = first > 0 ? Math.min(100, (s.count / first) * 100) : 0;
      return h(
        "li",
        { cls: "adm-chart2-step" },
        h("div", { cls: "adm-chart2-step-head" }, h("span", { cls: "adm-chart2-step-label", text: s.label }), h("span", { cls: "adm-chart2-step-count", text: format(s.count) })),
        h("div", { cls: "adm-chart2-step-track" }, h("span", { cls: "adm-chart2-step-fill", attrs: { style: `width:${width}%` } })),
        i > 0 ? h("p", { cls: "adm-chart2-step-meta", text: `${share(s.count, before)} of the step before · ${share(s.count, first)} of the first` }) : null,
        s.note ? h("p", { cls: "adm-chart2-step-note", text: s.note }) : null,
      );
    }),
  );
  const tableView = (): HTMLElement =>
    h(
      "div",
      { cls: "adm-table-wrap" },
      h(
        "table",
        { cls: "adm-table compact" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", { text: "Step" }), h("th", { cls: "num", text: "Count" }), h("th", { cls: "num", text: "Of the step before" }), h("th", { cls: "num", text: "Of the first" })),
        ),
        h(
          "tbody",
          {},
          ...steps.map((s, i) =>
            h(
              "tr",
              {},
              h("td", { text: s.label }),
              h("td", { cls: "num", text: format(s.count) }),
              h("td", { cls: "num", text: i > 0 ? share(s.count, steps[i - 1].count) : "–" }),
              h("td", { cls: "num", text: share(s.count, first) }),
            ),
          ),
        ),
      ),
    );
  return chartCard(title, note, list, tableView);
}

/** One sign-up week's cells: the share still in Rodeo that week after joining (or the count), empty before it is reached. */
function weekCell(c: Cohort, k: number, shaded: boolean): HTMLElement {
  if (k >= c.weeks.length) return h("td", { cls: "num" });
  const n = c.weeks[k];
  if (!shaded) return h("td", { cls: "num", text: count(n) });
  const pct = c.size > 0 ? (n / c.size) * 100 : 0;
  return h("td", {
    cls: "num adm-chart2-week",
    text: share(n, c.size),
    attrs: { style: `background: color-mix(in srgb, var(--series-2) ${pct.toFixed(1)}%, var(--surface))` },
  });
}

/**
 * Sign-up weeks down the side, the people who joined in each, then Week 0, 1… with the share of
 * the week's people in Rodeo that week, shaded by that share. The table view gives the counts.
 */
export function cohortTable(title: string, note: string | null, cohorts: AdminEngagement["cohorts"]): HTMLElement {
  const width = Math.max(0, ...cohorts.map((c) => c.weeks.length));
  const build = (shaded: boolean): HTMLElement =>
    h(
      "div",
      { cls: "adm-table-wrap adm-chart2-cohort" },
      h(
        "table",
        { cls: "adm-table compact" },
        h(
          "thead",
          {},
          h("tr", {}, h("th", { text: "Joined" }), h("th", { cls: "num", text: "People" }), ...Array.from({ length: width }, (_, k) => h("th", { cls: "num", text: `Week ${k}` }))),
        ),
        h(
          "tbody",
          {},
          ...cohorts.map((c) =>
            h("tr", {}, h("td", { text: day(c.week) }), h("td", { cls: "num", text: count(c.size) }), ...Array.from({ length: width }, (_, k) => weekCell(c, k, shaded))),
          ),
        ),
      ),
    );
  return chartCard(title, note, build(true), () => build(false));
}
