// Model > Extrude Along Path…, Vectorworks' Extrude Along Path dialog: of the two objects selected,
// which is the path (the other is the profile), a uniform scale from the path's start to its end,
// and Lock Profile Plane. The profile is swept centred on the path and square to it, mitred at its
// corners, as one mesh (edit.ts extrudeAlongPath); Vectorworks makes an Extrude Along Path object
// that stays editable, and also offers Exponential Scale and Fix Profile, which Rodeo doesn't.

import { canExtrudeAlongPath, extrudeAlongPathSelection, selectedProfileAndPath, type SweepPart } from "./compose.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { typeLabel } from "./reportRows.ts";

export { canExtrudeAlongPath };

/** the dialog's last settings, kept for the next time */
const last = { scaled: false, factor: 1, lockPlane: true };

/** The likelier path of the two: the one that can't be a profile, else the open one, else the larger. */
function likelyPath([a, b]: [SweepPart, SweepPart]): SweepPart {
  if (!(a.profile && b.path)) return a;
  if (!(b.profile && a.path)) return b;
  if (a.closed !== b.closed) return a.closed ? b : a;
  return a.size >= b.size ? a : b;
}

/** The object's kind, and which of the two it is when both are the same kind. */
function optionText(p: SweepPart, pair: [SweepPart, SweepPart]): string {
  const other = pair[0] === p ? pair[1] : pair[0];
  if (other.typeName !== p.typeName) return typeLabel(p.typeName);
  return `${typeLabel(p.typeName)} (${p.size >= other.size ? "larger" : "smaller"})`;
}

/** Model > Extrude Along Path…: which of the two selected objects is the path, the scale and Lock Profile Plane. */
export async function extrudeAlongPathDialog(): Promise<void> {
  const pair = selectedProfileAndPath();
  if (!pair) return;
  const candidates = pair.filter((p) => p.path && pair.find((q) => q !== p)!.profile);
  const path = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Path object" } },
    ...candidates.map((p) => h("option", { value: p.id, text: optionText(p, pair) })),
  );
  path.value = likelyPath(pair).id;
  const scale = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Scale" } },
    h("option", { value: "none", text: "None" }),
    h("option", { value: "uniform", text: "Uniform Scale" }),
  );
  scale.value = last.scaled ? "uniform" : "none";
  const factor = h("input", { cls: "menu-dialog-input", value: String(last.factor), attrs: { type: "text", inputmode: "decimal", "aria-label": "Scale Factor" } });
  const lock = h("input", { attrs: { type: "checkbox", "aria-label": "Lock Profile Plane" } });
  lock.checked = last.lockPlane;
  const sync = (): void => void (factor.disabled = scale.value !== "uniform");
  scale.addEventListener("input", sync);
  sync();
  const field = (label: string, control: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control);
  const r = await showDialog<{ pathId: string; factor: number }>({
    title: "Extrude Along Path",
    okLabel: "OK",
    body: [
      field("Path object", path),
      field("Scale", scale),
      field("Scale Factor", factor),
      h("label", { cls: "menu-dialog-check" }, lock, "Lock Profile Plane"),
      h("p", {
        cls: "muted",
        text:
          "The profile is centred on the path and square to it: looking along the path from its start, its x to the right and its y up; corners are mitred. " +
          "Uniform Scale grows it evenly to the factor at the path's end. Lock Profile Plane keeps its y upright; unticked, it turns with the path and may twist.",
      }),
    ],
    check: () => {
      if (scale.value !== "uniform") return { value: { pathId: path.value, factor: 1 } };
      const v = Number(factor.value.trim().replace(",", "."));
      return Number.isFinite(v) && v > 0 ? { value: { pathId: path.value, factor: v } } : { error: "Scale Factor: enter a number more than 0.", focus: factor };
    },
  });
  if (r === null) return;
  last.scaled = scale.value === "uniform";
  if (last.scaled) last.factor = r.factor;
  last.lockPlane = lock.checked;
  const profile = pair.find((p) => p.id !== r.pathId)!;
  extrudeAlongPathSelection(profile.id, r.pathId, r.factor, lock.checked);
}
