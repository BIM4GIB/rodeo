// AEC > Survey Input > 2D Polys to 3D Source Data…, Vectorworks' command of that name: 2D contours
// (polygons and polylines, or lines, rectangles, arcs, circles and ellipses) made into 3D polygons
// at their elevations, as a site model's source data. Its dialog takes the Start Elevation, the
// Interval between contours and a Segmentation Length for their curves; Set Elevation then steps
// through them from the backmost, each selected in turn with its elevation the last one's plus the
// interval (or the same, with Use same height as prev.), Up and Dn moving it by the interval. Done
// makes the 3D polygons of those set so far, and the originals are deleted or kept as asked, all
// in one undo step (EditSession.polysTo3DSourceData). Create 3D Loci puts a 3D locus at each of those
// polygons' points instead.

import type { EditSession } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { selectedObjects } from "./compose.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** the objects taken as contours: lines, rectangles, polygons, arcs, ellipses and polylines */
const CONTOURS = new Set([2, 3, 5, 6, 13, 21]);

/** the last values (mm) */
const last = { start: 0, interval: 1000, segment: 0 };

/** A length field's value: the exact length it was given while its rounded text stands, so stepping doesn't add up rounding. */
function lengthOf(el: HTMLInputElement, mm: number, units: string | undefined): number | null {
  return el.value === formatLengthValue(mm, units) ? mm : parseLength(el.value, units);
}

/** The selected contours on the edit scope, backmost first. */
function selectedContours(): string[] {
  return selectedObjects()
    .filter((o) => CONTOURS.has(o.type))
    .map((o) => o.id);
}

export function canMakeSourceData(): boolean {
  return selectedContours().length > 0;
}

let lastCreate = "polygons";

/** AEC > Survey Input > 2D Polys to 3D Source Data…: the elevations, then Set Elevation, then the 3D polygons. */
export async function polysTo3DSourceDataDialog(): Promise<void> {
  const s = store.session;
  const ids = selectedContours();
  if (!s || !ids.length) return;
  const units = s.doc.info.units;
  const suffix = lengthSuffix(units);
  const input = (label: string, mm: number): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value: formatLengthValue(mm, units), attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const field = (label: string, el: HTMLElement): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el, suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null);
  const start = input("Start Elevation", last.start);
  const interval = input("Interval", last.interval);
  const segment = input("Segmentation Length", last.segment);
  const create = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Create" } }, h("option", { value: "polygons", text: "Create 3D Polygons" }), h("option", { value: "loci", text: "Create 3D Loci" }));
  create.value = lastCreate;
  const v = await showDialog<typeof last>({
    title: "2D Polys to 3D Source Data",
    okLabel: "OK",
    body: [
      field("Start Elevation", start),
      field("Interval", interval),
      field("Segmentation Length", segment),
      create,
      h("p", {
        cls: "muted",
        text: `Makes 3D polygons of the ${ids.length} selected contour${ids.length === 1 ? "" : "s"}; Set Elevation then steps through them from the backmost. A Segmentation Length of 0 keeps their curves as drawn.`,
      }),
    ],
    check: () => {
      const a = lengthOf(start, last.start, units);
      if (a === null) return { error: "Start Elevation: enter a length.", focus: start };
      const b = lengthOf(interval, last.interval, units);
      if (b === null || !(b > 0)) return { error: "Interval: enter a length more than 0.", focus: interval };
      const c = lengthOf(segment, last.segment, units);
      if (c === null || c < 0) return { error: "Segmentation Length: enter a length of 0 or more.", focus: segment };
      return { value: { start: a, interval: b, segment: c } };
    },
  });
  if (!v) return;
  Object.assign(last, v);
  lastCreate = create.value;
  const before = [...store.selection];
  const set = await setElevations(ids, v.start, v.interval, units);
  const loci = lastCreate === "loci";
  const r = set
    ? attempt("2D Polys to 3D Source Data", (s) =>
        s.batch(() => {
          const polys = s.polysTo3DSourceData(set.items, v.segment, set.keep);
          return loci ? polys.flatMap((id) => locusEachPoint(s, id)) : polys;
        }),
      )
    : null;
  if (!r) return setSelection(before);
  setSelection(r.value);
  const n = r.value.length;
  toast(`Made ${n} ${loci ? (n === 1 ? "3D locus" : "3D loci") : `3D polygon${n === 1 ? "" : "s"}`}${set!.keep ? ", keeping the originals" : ""}.`, "info");
}

/** A 3D polygon replaced by a 3D locus at each of its points, in its class. */
function locusEachPoint(s: EditSession, id: string): string[] {
  const o = s.doc.object(id);
  const curve = s.curvePoints(id);
  if (!o || !curve) return [];
  const base = s.doc.layers().find((l) => l.id === o.layerId)?.elevation ?? 0;
  const ids = s.add3DLoci(o.layerId, curve.points.map((q) => [q[0], q[1], q[2] - base]), o.classIndex);
  s.deleteObjects([id]);
  return ids;
}

interface SetElevations {
  items: { id: string; elevation: number }[];
  keep: boolean;
}

/**
 * Vectorworks' Set Elevation dialog: each contour selected in turn, its elevation typed or moved
 * by the interval with Up and Dn; Next goes on, Done stops (the one shown counted), and then the
 * originals are deleted or kept. It sits in the drawing's corner without dimming it, so the
 * contour shows; the drawing can't be clicked meanwhile. Null when cancelled.
 */
function setElevations(ids: readonly string[], start: number, interval: number, units: string | undefined): Promise<SetElevations | null> {
  return new Promise((resolve) => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items: { id: string; elevation: number }[] = [];
    let i = 0;
    // the length last put in the field
    let shown = 0;
    const suffix = lengthSuffix(units);
    const counter = h("p", { cls: "muted" });
    const elevation = h("input", { cls: "menu-dialog-input", attrs: { type: "text", inputmode: "decimal", "aria-label": "Elevation" } });
    const button = (text: string, primary = false): HTMLButtonElement => h("button", { cls: primary ? "btn primary" : "btn", text, attrs: { type: "button" } });
    const up = button("Up");
    const dn = button("Dn");
    const same = h("input", { attrs: { type: "checkbox", "aria-label": "Use same height as prev." } });
    const error = h("p", { cls: "menu-dialog-error", attrs: { role: "alert" }, hidden: true });
    const cancel = button("Cancel");
    const done = button("Done");
    const next = button("Next", true);
    const keep = button("Keep");
    const del = button("Delete", true);
    const question = h("p", { cls: "menu-dialog-text", hidden: true });
    const steps = h(
      "div",
      {},
      counter,
      h(
        "label",
        { cls: "menu-dialog-field" },
        h("span", { cls: "menu-dialog-label", text: "Elevation" }),
        elevation,
        suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
      ),
      h("div", { cls: "menu-dialog-actions", attrs: { style: "justify-content: flex-start; margin-top: 6px" } }, up, dn),
      h("label", { cls: "menu-dialog-check" }, same, "Use same height as prev."),
    );
    const actions = h("div", { cls: "menu-dialog-actions" }, cancel, done, next, keep, del);
    keep.hidden = del.hidden = true;
    const wrap = document.getElementById("canvas-wrap")?.getBoundingClientRect();
    const narrow = window.innerWidth < 560;
    const place = narrow
      ? "left: 8px; right: 8px; bottom: 8px"
      : `top: ${Math.round((wrap?.top ?? 48) + 56)}px; right: ${Math.round(window.innerWidth - (wrap?.right ?? window.innerWidth) + 12)}px`;
    const form = h(
      "form",
      { cls: "menu-dialog", attrs: { role: "dialog", "aria-modal": "true", "aria-label": "Set Elevation", style: `position: absolute; ${place}` } },
      h("h2", { cls: "menu-dialog-title", text: "Set Elevation" }),
      steps,
      question,
      error,
      actions,
    );
    // fills the window unseen, so the drawing under it can't be clicked meanwhile
    const blocker = h("div", { attrs: { style: "position: fixed; inset: 0; z-index: 40" } }, form);

    const finish = (value: SetElevations | null): void => {
      blocker.remove();
      returnFocus?.focus();
      resolve(value);
    };
    const fail = (text: string): null => {
      error.textContent = text;
      error.hidden = false;
      elevation.focus();
      return null;
    };
    const put = (mm: number): void => {
      shown = mm;
      elevation.value = formatLengthValue(mm, units);
    };
    const read = (): number | null => {
      const e = lengthOf(elevation, shown, units);
      return e === null ? fail("Elevation: enter a length.") : e;
    };
    const show = (): void => {
      error.hidden = true;
      setSelection([ids[i]]);
      counter.textContent = `Contour ${i + 1} of ${ids.length}`;
      const e = i === 0 ? start : items[i - 1].elevation + (same.checked ? 0 : interval);
      put(e);
      next.disabled = i === ids.length - 1;
      elevation.focus();
      elevation.select();
    };
    const step = (by: number): void => {
      const e = read();
      if (e !== null) put(e + by);
    };
    // the one shown, set; then on to the next, or to the question
    const take = (stop: boolean): void => {
      const e = read();
      if (e === null) return;
      items[i] = { id: ids[i], elevation: e };
      if (!stop && i < ids.length - 1) {
        i++;
        return show();
      }
      items.length = i + 1;
      setSelection(items.map((it) => it.id));
      steps.hidden = done.hidden = next.hidden = true;
      question.hidden = keep.hidden = del.hidden = false;
      error.hidden = true;
      const n = items.length;
      question.textContent = `Makes ${n} 3D polygon${n === 1 ? "" : "s"}. Delete the original object${n === 1 ? "" : "s"}?`;
      del.focus();
    };

    up.addEventListener("click", () => step(interval));
    dn.addEventListener("click", () => step(-interval));
    cancel.addEventListener("click", () => finish(null));
    done.addEventListener("click", () => take(true));
    next.addEventListener("click", () => take(false));
    keep.addEventListener("click", () => finish({ items, keep: true }));
    del.addEventListener("click", () => finish({ items, keep: false }));
    elevation.addEventListener("input", () => (error.hidden = true));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!steps.hidden) take(next.disabled);
    });
    // every key stays inside, so the window's shortcuts don't run under it; the arrows are Up and Dn
    blocker.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        finish(null);
      } else if (e.target === elevation && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        e.preventDefault();
        step(e.key === "ArrowUp" ? interval : -interval);
      }
    });
    document.body.append(blocker);
    show();
  });
}
