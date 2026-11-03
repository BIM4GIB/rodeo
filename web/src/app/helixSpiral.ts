// Model > 3D Power Pack > Create Helix-Spiral…, Vectorworks' Helix-Spiral Creation dialog: Use Turns
// or Use Pitch, Start and End Radius (a spiral when they differ), Start Angle and Reverse Direction.
// Each selected path becomes a 3D polygon coiling round it (edit.ts createHelixSpiral), where
// Vectorworks makes a helix-spiral object that ungroups to a NURBS curve. Flatten isn't offered:
// where its flat spiral lies isn't documented.

import type { HelixOptions } from "../core/index.ts";
import { canCreateHelixSpiral, createHelixSpiralSelection } from "./compose.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "./units.ts";

export { canCreateHelixSpiral };

/** the dialog's last settings (lengths in mm), kept for the next time */
const last = { by: "turns" as HelixOptions["by"], turns: 5, pitch: 100, startRadius: 50, endRadius: 50, startAngle: 0, reverse: false };

/** Model > 3D Power Pack > Create Helix-Spiral…: the coil's settings; coils round each selected path. */
export async function helixSpiralDialog(): Promise<void> {
  const units = store.session?.doc.info.units;
  const suffix = lengthSuffix(units);
  const input = (label: string, value: string): HTMLInputElement =>
    h("input", { cls: "menu-dialog-input", value, attrs: { type: "text", inputmode: "decimal", "aria-label": label } });
  const field = (label: string, control: HTMLInputElement, unit: string): HTMLElement =>
    h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), control, unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null);
  const radio = (by: HelixOptions["by"]): HTMLInputElement => h("input", { checked: last.by === by, attrs: { type: "radio", name: "helix-by", value: by } });
  const [byTurns, byPitch] = [radio("turns"), radio("pitch")];
  const turns = input("Turns", String(last.turns));
  const pitch = input("Pitch", formatLengthValue(last.pitch, units));
  const startRadius = input("Start Radius", formatLengthValue(last.startRadius, units));
  const endRadius = input("End Radius", formatLengthValue(last.endRadius, units));
  const startAngle = input("Start Angle", String(last.startAngle));
  const reverse = h("input", { checked: last.reverse, attrs: { type: "checkbox", "aria-label": "Reverse Direction" } });
  const sync = (): void => {
    turns.disabled = !byTurns.checked;
    pitch.disabled = !byPitch.checked;
  };
  for (const r of [byTurns, byPitch]) r.addEventListener("change", sync);
  sync();
  const length = (el: HTMLInputElement, label: string): number | { error: string; focus: HTMLElement } => {
    const mm = parseLength(el.value, units);
    return mm === null || mm < 0 ? { error: `${label}: enter a length of 0 or more.`, focus: el } : mm;
  };
  const r = await showDialog<HelixOptions>({
    title: "Helix-Spiral Creation",
    okLabel: "OK",
    body: [
      h("label", { cls: "menu-dialog-check" }, byTurns, "Use Turns"),
      field("Turns", turns, ""),
      h("label", { cls: "menu-dialog-check" }, byPitch, "Use Pitch"),
      field("Pitch", pitch, suffix),
      field("Start Radius", startRadius, suffix),
      field("End Radius", endRadius, suffix),
      field("Start Angle", startAngle, "°"),
      h("label", { cls: "menu-dialog-check" }, reverse, "Reverse Direction"),
      h("p", {
        cls: "muted",
        text:
          "Each selected line, arc, rectangle, polygon, polyline, circle or 3D polygon becomes a 3D polygon coiling round it, square to it, from the Start Radius at its start to the End Radius at its end. " +
          "The Start Angle runs from the path's right toward up, looking along it; the coil turns clockwise seen that way, anticlockwise reversed.",
      }),
    ],
    check: () => {
      const by = byTurns.checked ? "turns" : "pitch";
      const value = by === "turns" ? Number(turns.value.trim().replace(",", ".")) : parseLength(pitch.value, units);
      if (value === null || !Number.isFinite(value) || value <= 0)
        return by === "turns" ? { error: "Turns: enter a number more than 0.", focus: turns } : { error: "Pitch: enter a length more than 0.", focus: pitch };
      const r0 = length(startRadius, "Start Radius");
      if (typeof r0 !== "number") return r0;
      const r1 = length(endRadius, "End Radius");
      if (typeof r1 !== "number") return r1;
      if (r0 + r1 === 0) return { error: "Start Radius and End Radius can't both be 0.", focus: startRadius };
      const a = Number(startAngle.value.trim().replace(",", ".").replace(/°$/, ""));
      if (!Number.isFinite(a)) return { error: "Start Angle: enter an angle.", focus: startAngle };
      return { value: { by, value, startRadius: r0, endRadius: r1, startAngle: a, reverse: reverse.checked } };
    },
  });
  if (r === null) return;
  last.by = r.by;
  last[r.by] = r.value;
  Object.assign(last, { startRadius: r.startRadius, endRadius: r.endRadius, startAngle: r.startAngle, reverse: r.reverse });
  createHelixSpiralSelection(r);
}
