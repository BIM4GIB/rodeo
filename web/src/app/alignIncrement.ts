// Modify > Align > Align by Increment…, as Vectorworks has it for light plots: each selected object
// moves to the nearest multiple of Round to the nearest along the axes ticked, by its insertion
// point (symbols and plug-ins, lighting devices among them) or else its centre; Use snap grid takes
// X and Y to the nearest snap grid point instead. Z goes by the middle of what the object shows in
// 3D, above its layer's elevation (Rodeo knows insertion points in plan only), and objects with
// nothing in 3D keep their height. A Shift-click on the command aligns at once with the last
// settings, or shows the dialog, as the dialog's Shift+click says. One undo step.

import { attempt, selectionEntries } from "./commands.ts";
import type { Scene } from "./scene.ts";
import { gridStep } from "./snap.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

/** Moves below this many millimetres are rounding noise and are not applied. */
const MOVE_EPS = 1e-6;

export interface IncrementSettings {
  x: boolean;
  y: boolean;
  z: boolean;
  /** mm */
  step: number;
  grid: boolean;
  /** a Shift-click aligns at once rather than showing the dialog */
  shiftNow: boolean;
}

/** the dialog's last settings, kept for the next time: 6", as a light plot's pipes are marked */
const settings: IncrementSettings = { x: true, y: true, z: false, step: 152.4, grid: false, shiftNow: true };

export const incrementSettings = (): Readonly<IncrementSettings> => settings;

/** whether Shift was down when the command was last chosen, by a click or a key */
let shifted = false;
for (const type of ["pointerdown", "click", "keydown"] as const) {
  window.addEventListener(type, (e) => (shifted = e.shiftKey), true);
}

/** The nearest multiple of `step` to `v`. */
const nearest = (v: number, step: number): number => Math.round(v / step) * step;

/**
 * Each selected object's move, in plan and up, to put its insertion point or centre on the
 * increment (or the snap grid) along the axes `s` ticks.
 */
export function incrementMoves(scene: Scene, s: IncrementSettings, gridSize: number): { id: string; dx: number; dy: number; dz: number }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const items = selectionEntries(scene);
  const plan = s.grid ? gridSize : s.step;
  // the middle of each object's 3D form, from its faces and edges
  const heights = new Map<string, { lo: number; hi: number }>();
  if (s.z) {
    const ids = new Set(items.map((it) => it.id));
    for (const m of doc.model3d()) {
      if (!ids.has(m.objectId)) continue;
      for (const pts of [m.triangles, m.edges]) {
        for (let i = 2; i < pts.length; i += 3) {
          const r = heights.get(m.objectId) ?? { lo: Infinity, hi: -Infinity };
          r.lo = Math.min(r.lo, pts[i]);
          r.hi = Math.max(r.hi, pts[i]);
          heights.set(m.objectId, r);
        }
      }
    }
  }
  const elevation = new Map(doc.layers().map((l) => [l.id, l.elevation ?? 0]));
  return items.map(({ id, box }) => {
    const o = doc.object(id);
    const at = o?.insertion ?? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    const r = heights.get(id);
    const z = r ? (r.lo + r.hi) / 2 - (elevation.get(o?.layerId ?? "") ?? 0) : null;
    return {
      id,
      dx: s.x ? nearest(at.x, plan) - at.x : 0,
      dy: s.y ? nearest(at.y, plan) - at.y : 0,
      dz: s.z && z !== null ? nearest(z, s.step) - z : 0,
    };
  });
}

/** Aligns the selection by `s`, as one undo step. */
export function alignByIncrement(scene: Scene, s: IncrementSettings, gridSize: number): void {
  if (!s.x && !s.y && !s.z) {
    toast("Choose an axis to align along.", "info");
    return;
  }
  const moves = incrementMoves(scene, s, gridSize);
  // the same moves go together
  const groups = new Map<string, { dx: number; dy: number; dz: number; ids: string[] }>();
  for (const m of moves) {
    const [dx, dy, dz] = [m.dx, m.dy, m.dz].map((v) => (Math.abs(v) < MOVE_EPS ? 0 : v));
    if (dx === 0 && dy === 0 && dz === 0) continue;
    const key = `${dx}|${dy}|${dz}`;
    const g = groups.get(key);
    if (g) g.ids.push(m.id);
    else groups.set(key, { dx, dy, dz, ids: [m.id] });
  }
  if (groups.size === 0) {
    toast(moves.length ? "The selection is already on the increment." : "Select the objects to align.", "info");
    return;
  }
  attempt("Align by Increment", (session) =>
    session.batch(() =>
      groups.forEach(({ dx, dy, dz, ids }) => {
        if (dz === 0) session.moveObjects(ids, dx, dy);
        else session.moveObjects3D(ids, dx, dy, dz);
      }),
    ),
  );
}

/** The command: the dialog, or at once with the last settings on a Shift-click when they say so. */
export async function alignByIncrementCommand(scene: Scene, viewScale: number): Promise<void> {
  if (!(shifted && settings.shiftNow)) {
    const v = await toolPrefs(
      "Align by Increment",
      [
        { kind: "heading", key: "axis", label: "Axis" },
        { kind: "check", key: "x", label: "X", value: settings.x },
        { kind: "check", key: "y", label: "Y", value: settings.y },
        { kind: "check", key: "z", label: "Z", value: settings.z },
        { kind: "length", key: "step", label: "Round to the nearest", value: settings.step },
        { kind: "check", key: "grid", label: "Use snap grid", value: settings.grid },
        {
          kind: "choice",
          key: "shift",
          label: "Shift+click",
          wide: true,
          value: settings.shiftNow ? "now" : "dialog",
          options: [
            { value: "now", label: "Align immediately using previous settings" },
            { value: "dialog", label: "Display this dialog box" },
          ],
        },
      ],
      "Objects move by their insertion point, or their centre if they have none. Use snap grid takes X and Y to the grid; Z still rounds to the increment.",
    );
    if (!v) return;
    Object.assign(settings, { x: v.flag("x"), y: v.flag("y"), z: v.flag("z"), step: v.num("step"), grid: v.flag("grid"), shiftNow: v.choice("shift") === "now" });
  }
  alignByIncrement(scene, settings, gridStep(viewScale));
}
