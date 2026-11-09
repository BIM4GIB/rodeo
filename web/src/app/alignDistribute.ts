// Modify > Align > Align/Distribute…, and the Align/Distribute flyout of an object's right-click
// menu, as Vectorworks has them: across the window (horizontally) and up it (vertically), the
// selected objects are aligned by their left, centre or right (top, centre or bottom) or by their
// insertion points (symbols and plug-in objects; others by their centres), or distributed so those
// fall evenly or the gaps between neighbours (Spacing) are equal. A locus in the selection, or the
// object right-clicked, stays put and the others line up with it; else they line up with the
// selection's edge, or its middle for centres and insertion points. Distributing keeps the two
// outermost where they are. Both directions together are one undo step.

import { applyMoves, selectionEntries, type Move } from "./commands.ts";
import { h } from "./dom.ts";
import type { Row } from "./menu.ts";
import { need } from "./menuReasons.ts";
import { showDialog } from "./menubar.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import "./alignDistribute.css";

/** What lines up: the low edge (left, bottom), the centre, the high edge (right, top), the insertion point, or the gaps between. */
export type Measure = "min" | "center" | "max" | "insertion" | "spacing";

export interface AxisPlan {
  readonly how: "align" | "distribute";
  readonly by: Measure;
}

export interface Plan {
  readonly x?: AxisPlan;
  readonly y?: AxisPlan;
}

type Axis = "x" | "y";

/**
 * An object lining up, in the frame it lines up in (a coordinate an axis): its bounds' low and
 * high corners, its insertion point and, for a locus, its point. Align/Distribute 3D lines up
 * objects so too.
 */
export interface Item {
  readonly id: string;
  readonly lo: readonly number[];
  readonly hi: readonly number[];
  readonly insertion: readonly number[] | null;
  readonly locus: readonly number[] | null;
}

function items(scene: Scene): Item[] {
  const doc = store.session?.doc;
  return selectionEntries(scene).map(({ id, box }) => {
    const o = doc?.object(id);
    const locus = o?.shape?.kind === "locus" ? o.shape.points[0] : undefined;
    return {
      id,
      lo: [box.x0, box.y0],
      hi: [box.x1, box.y1],
      insertion: o?.insertion ? [o.insertion.x, o.insertion.y] : null,
      locus: locus ? [locus.x, locus.y] : null,
    };
  });
}

function value(it: Item, axis: number, by: Measure): number {
  if (it.locus) return it.locus[axis];
  if (by === "min") return it.lo[axis];
  if (by === "max") return it.hi[axis];
  // an object without an insertion point (along this axis) goes by its centre
  const at = by === "insertion" ? it.insertion?.[axis] : undefined;
  return at ?? (it.lo[axis] + it.hi[axis]) / 2;
}

/** How far each object moves along `axis` (0 x, 1 y, 2 z) to line up, the one it lines up with left out. */
export function alignAxis(list: readonly Item[], axis: number, by: Measure, reference: string | null): Map<string, number> {
  const loci = list.filter((it) => it.locus);
  const anchor = list.find((it) => it.id === reference) ?? (loci.length === 1 ? loci[0] : null);
  let target: number;
  if (anchor) target = value(anchor, axis, by);
  else if (by === "min") target = Math.min(...list.map((it) => it.lo[axis]));
  else if (by === "max") target = Math.max(...list.map((it) => it.hi[axis]));
  else target = (Math.min(...list.map((it) => it.lo[axis])) + Math.max(...list.map((it) => it.hi[axis]))) / 2;
  const out = new Map<string, number>();
  for (const it of list) if (it !== anchor) out.set(it.id, target - value(it, axis, by));
  return out;
}

/** How far each object moves along `axis` (0 x, 1 y, 2 z) to be spread evenly, the outermost two staying. */
export function distributeAxis(list: readonly Item[], axis: number, by: Measure): Map<string, number> {
  const out = new Map<string, number>();
  if (by === "spacing") {
    const sorted = [...list].sort((p, q) => p.lo[axis] - q.lo[axis]);
    const start = sorted[0].lo[axis];
    let end = -Infinity;
    let sizes = 0;
    for (const it of sorted) {
      end = Math.max(end, it.hi[axis]);
      sizes += it.hi[axis] - it.lo[axis];
    }
    const gap = (end - start - sizes) / (sorted.length - 1);
    let cursor = start;
    for (const it of sorted) {
      out.set(it.id, cursor - it.lo[axis]);
      cursor += it.hi[axis] - it.lo[axis] + gap;
    }
    return out;
  }
  const sorted = [...list].sort((p, q) => value(p, axis, by) - value(q, axis, by));
  const first = value(sorted[0], axis, by);
  const step = (value(sorted[sorted.length - 1], axis, by) - first) / (sorted.length - 1);
  sorted.forEach((it, i) => out.set(it.id, first + i * step - value(it, axis, by)));
  return out;
}

/** Why `plan` can't run on the selection now, or null when it can. */
function refusal(count: number, plan: Plan): string | null {
  const plans = [plan.x, plan.y].filter((p): p is AxisPlan => !!p);
  if (!plans.length) return "Choose a horizontal or vertical alignment.";
  if (plans.some((p) => p.how === "distribute") && count < 3) return "Distributing takes three objects or more.";
  if (count < 2) return "Aligning takes two objects or more.";
  return null;
}

/** Aligns and distributes the selection by `plan`, `reference` (an object right-clicked) staying put; one undo step. */
export function alignDistribute(scene: Scene, plan: Plan, reference: string | null = null): void {
  const list = items(scene);
  const why = refusal(list.length, plan);
  if (why) {
    toast(why, "info");
    return;
  }
  const along = (axis: number, p: AxisPlan | undefined): Map<string, number> =>
    !p ? new Map() : p.how === "align" ? alignAxis(list, axis, p.by, reference) : distributeAxis(list, axis, p.by);
  const dx = along(0, plan.x);
  const dy = along(1, plan.y);
  const moves = list.map((it): Move => ({ id: it.id, dx: dx.get(it.id) ?? 0, dy: dy.get(it.id) ?? 0 }));
  applyMoves("Align/Distribute", moves);
}

/** The Align/Distribute flyout of an object's right-click menu: the usual ones, `reference` staying put, and the dialog. */
export function alignDistributeRows(scene: Scene, reference: string | null): Row[] {
  const two = (): boolean => store.selection.size >= 2;
  const three = (): boolean => store.selection.size >= 3;
  const row = (label: string, plan: Plan, enabled = two): Row => ({ label, why: enabled === three ? need.threeOrMore : need.twoOrMore, enabled, run: () => alignDistribute(scene, plan, reference) });
  return [
    row("Align Left", { x: { how: "align", by: "min" } }),
    row("Align Center", { x: { how: "align", by: "center" } }),
    row("Align Right", { x: { how: "align", by: "max" } }),
    row("Align Top", { y: { how: "align", by: "max" } }),
    row("Align Middle", { y: { how: "align", by: "center" } }),
    row("Align Bottom", { y: { how: "align", by: "min" } }),
    "-",
    row("Distribute Horizontally (Spacing)", { x: { how: "distribute", by: "spacing" } }, three),
    row("Distribute Vertically (Spacing)", { y: { how: "distribute", by: "spacing" } }, three),
    "-",
    row("Align Insertion Point Horizontally", { x: { how: "align", by: "insertion" } }),
    row("Align Insertion Point Vertically", { y: { how: "align", by: "insertion" } }),
    "-",
    { label: "Align/Distribute…", why: need.twoOrMore, enabled: two, run: () => void alignDistributeDialog(scene, reference) },
  ];
}

// ---- the dialog ---------------------------------------------------------------------------------

/** A direction's row as the dialog last had it, kept for the next time. */
export interface AxisSetting {
  on: boolean;
  how: AxisPlan["how"];
  by: Measure;
}

/** the dialog's last settings */
const last: Record<Axis, AxisSetting> = {
  x: { on: true, how: "align", by: "min" },
  y: { on: false, how: "align", by: "max" },
};

const CHOICES: Record<Axis, readonly (readonly [Measure, string])[]> = {
  x: [
    ["min", "Left"],
    ["center", "Center"],
    ["max", "Right"],
    ["insertion", "Insertion Point"],
    ["spacing", "Spacing"],
  ],
  y: [
    ["max", "Top"],
    ["center", "Center"],
    ["min", "Bottom"],
    ["insertion", "Insertion Point"],
    ["spacing", "Spacing"],
  ],
};

/** One direction's row, `name`d: ticked to change it, Align or Distribute, and by which of `choices`; `kept` is updated on OK. */
export function axisRow(
  name: string,
  choices: readonly (readonly [Measure, string])[],
  kept: AxisSetting,
): { el: HTMLElement; plan(): AxisPlan | undefined } {
  const on = h("input", { checked: kept.on, attrs: { type: "checkbox", "aria-label": name } });
  const how = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `${name} criteria` } },
    h("option", { value: "align", text: "Align" }),
    h("option", { value: "distribute", text: "Distribute" }),
  );
  const by = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": `${name} by` } }, ...choices.map(([v, label]) => h("option", { value: v, text: label })));
  how.value = kept.how;
  by.value = kept.by;
  const sync = (): void => {
    // gaps are only evened out, never lined up
    const spacing = by.querySelector<HTMLOptionElement>("option[value=spacing]")!;
    spacing.disabled = how.value === "align";
    if (spacing.disabled && by.value === "spacing") by.value = choices[0][0];
    how.disabled = by.disabled = !on.checked;
  };
  for (const el of [on, how, by]) el.addEventListener("change", sync);
  sync();
  const el = h("div", { cls: "align-axis" }, h("label", { cls: "menu-dialog-check align-axis-name" }, on, name), how, by);
  return {
    el,
    plan: () => {
      kept.on = on.checked;
      kept.how = how.value as AxisPlan["how"];
      kept.by = by.value as Measure;
      return on.checked ? { how: kept.how, by: kept.by } : undefined;
    },
  };
}

/** Modify > Align > Align/Distribute…: each direction's alignment or distribution, run on OK. */
export async function alignDistributeDialog(scene: Scene, reference: string | null = null): Promise<void> {
  const x = axisRow("Horizontal", CHOICES.x, last.x);
  const y = axisRow("Vertical", CHOICES.y, last.y);
  const count = items(scene).length;
  const plan = await showDialog<Plan>({
    title: "Align/Distribute",
    okLabel: "OK",
    cls: "align-dialog",
    body: [
      x.el,
      y.el,
      h("p", {
        cls: "muted",
        text: reference
          ? "The object right-clicked stays put and the others line up with it."
          : "A locus in the selection stays put and the others line up with it. Insertion points are those of symbols and plug-in objects; other objects go by their centres.",
      }),
    ],
    check: () => {
      const p: Plan = { x: x.plan(), y: y.plan() };
      const why = refusal(count, p);
      return why ? { error: why } : { value: p };
    },
  });
  if (plan) alignDistribute(scene, plan, reference);
}
