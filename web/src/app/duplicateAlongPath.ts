// Edit > Duplicate Along Path…: copies of the selected objects spaced along a path,
// as the Vectorworks command makes them. The path is one of the selected lines,
// polylines, polygons, rectangles, arcs or circles (the last one selected, or the
// one picked in the dialog); the rest of the selection is copied, the centre of its
// bounds placed on the path at each spot. Spots are a number spread over the path
// (from the start offset to its end, or around a closed path) or a fixed distance
// apart; Tangent to Path turns each copy with the path's direction there. The
// originals and the path stay; the copies are made as one undo step and selected.

import type { Affine, BBox, Pt } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { pathOf } from "./cutting.ts";
import { h } from "./dom.ts";
import { degToRad } from "./geom.ts";
import { showDialog } from "./menubar.ts";
import { MAX_COPIES, spotsAlong, walkOf, type Spacing, type Spot } from "./pathWalk.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

/** Path lengths below this (mm) are no path. */
const MIN_LENGTH = 1e-6;

/** The selected objects that can serve as the path, the last selected first. */
function pathCandidates(): { id: string; label: string }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const counts = new Map<string, number>();
  const out: { id: string; label: string }[] = [];
  for (const id of [...store.selection].reverse()) {
    const o = doc.object(id);
    if (!o?.shape || !pathOf(o.shape)) continue;
    const kind = o.shape.kind === "arc" ? (Math.abs(o.shape.sweepAngle ?? 360) >= 360 ? "Circle" : "Arc") : o.typeName;
    const n = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, n);
    out.push({ id, label: o.name ? `${kind} "${o.name}"` : n > 1 ? `${kind} ${n}` : kind });
  }
  return out;
}

/** True when the selection holds a path and something else to copy along it. */
export function canDuplicateAlongPath(): boolean {
  return store.selection.size >= 2 && pathCandidates().length > 0;
}

/** Opens Duplicate Along Path and makes the copies. */
export async function duplicateAlongPathDialog(scene: Scene): Promise<void> {
  const doc = store.session?.doc;
  const layerId = store.activeLayerId;
  if (!doc || !layerId) return;
  const paths = pathCandidates();
  if (paths.length === 0 || store.selection.size < 2) return;
  const units = doc.info.units;
  const suffix = lengthSuffix(units);
  const input = (label: string, value: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const pathSelect = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Path" } },
    ...paths.map((p) => h("option", { value: p.id, text: p.label })),
  );
  const by = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Place by" } },
    h("option", { value: "number", text: "Number of duplicates" }),
    h("option", { value: "distance", text: "Distance between duplicates" }),
  );
  const count = input("Number of duplicates", "5");
  const distance = input("Distance between duplicates", formatLengthValue(1000, units));
  const offset = input("Start offset", formatLengthValue(0, units));
  const tangent = h("input", { attrs: { type: "checkbox" } });
  const field = (label: string, el: HTMLElement, unit = false): HTMLElement =>
    h(
      "label",
      { cls: "menu-dialog-field" },
      h("span", { cls: "menu-dialog-label", text: label }),
      el,
      unit && suffix ? h("span", { cls: "menu-dialog-unit", text: suffix }) : null,
    );
  const countField = field("Duplicates", count);
  const distanceField = field("Distance", distance, true);
  const sync = (): void => {
    countField.hidden = by.value !== "number";
    distanceField.hidden = by.value !== "distance";
  };
  by.addEventListener("change", sync);
  sync();

  const result = await showDialog<{ path: string; spacing: Spacing; tangent: boolean }>({
    title: "Duplicate Along Path",
    okLabel: "Duplicate",
    body: [
      ...(paths.length > 1 ? [field("Path", pathSelect)] : []),
      field("Place by", by),
      countField,
      distanceField,
      field("Start offset", offset, true),
      h("label", { cls: "menu-dialog-check" }, tangent, "Tangent to path"),
    ],
    check: () => {
      const start = parseLength(offset.value, units);
      if (start === null || start < 0) return { error: "Start offset: enter a length of 0 or more.", focus: offset };
      if (by.value === "number") {
        const n = Number(count.value.trim());
        if (!Number.isInteger(n) || n < 1 || n > MAX_COPIES) return { error: `Duplicates: enter a whole number from 1 to ${MAX_COPIES}.`, focus: count };
        return { value: { path: pathSelect.value, spacing: { by: "number", value: n, offset: start }, tangent: tangent.checked } };
      }
      const d = parseLength(distance.value, units);
      if (d === null || !(d > 0)) return { error: "Distance: enter a length above 0.", focus: distance };
      return { value: { path: pathSelect.value, spacing: { by: "distance", value: d, offset: start }, tangent: tangent.checked } };
    },
  });
  if (!result) return;

  const path = pathOf(doc.object(result.path)!.shape!)!;
  const walk = walkOf(path);
  if (walk.length < MIN_LENGTH) return showError("The path has no length.");
  if (result.spacing.offset > walk.length) return showError("The start offset is past the end of the path.");
  const spots = spotsAlong(walk.length, walk.closed, result.spacing);
  if (spots.length === 0) return showError("No copy fits on the path.");
  if (spots.length > MAX_COPIES) return showError(`That would make more than ${MAX_COPIES} copies.`);
  const ids = [...store.selection].filter((id) => id !== result.path);
  let box: BBox | null = null;
  for (const e of scene.topLevelEntries(layerId, store.editGroupId)) {
    if (!e.bbox || !ids.includes(e.id)) continue;
    box = box ? { x0: Math.min(box.x0, e.bbox.x0), y0: Math.min(box.y0, e.bbox.y0), x1: Math.max(box.x1, e.bbox.x1), y1: Math.max(box.y1, e.bbox.y1) } : e.bbox;
  }
  if (!box) return;
  const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
  const r = attempt("Duplicate along path", (s) =>
    s.batch(() => {
      const made: string[] = [];
      for (const d of spots) {
        const spot = walk.at(d);
        const copies = s.duplicateObjects(ids, 0, 0);
        s.transformObjects(copies, placing(centre, spot, result.tangent));
        made.push(...copies);
      }
      return made;
    }),
  );
  if (r) setSelection(r.value);
}

/** The transform taking `centre` to the spot, turned with the path there when `tangent`. */
function placing(centre: Pt, spot: Spot, tangent: boolean): Affine {
  const a = tangent ? degToRad(spot.angle) : 0;
  const co = Math.cos(a);
  const si = Math.sin(a);
  return {
    a: co,
    b: si,
    c: -si,
    d: co,
    e: spot.p.x - co * centre.x + si * centre.y,
    f: spot.p.y - si * centre.x - co * centre.y,
  };
}

function showError(message: string): void {
  toast(`Duplicate along path: ${message}`);
}
