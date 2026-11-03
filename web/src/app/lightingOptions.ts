// View > Set Lighting Options…, as Vectorworks Fundamentals has it, onto the lighting Rodeo has:
// Indirect Lighting sets the path tracer's bounces (Vectorworks counts the bounces after the first
// hit, so None is direct light only and Normal's 4 bounces are 5 here), Ambient Info sets the
// Shaded view's ambient light (Vectorworks' 35 % being Rodeo's usual), Ambient Occlusion sets the
// Realistic engine's, and Emitter Brightness every light object's strength in Realistic and Path
// Traced renders. Like the Render palette and the Visualization palette, which show the same
// settings, they belong to this machine, not the file, and have no undo. Not here: the ambient
// light's colour, the occlusion's size, white balance for lights' colour temperatures, and
// environment lighting (Realistic and Path Traced are lit by the Render palette's sky).

import { patchRender, renderSettings } from "../features/render/settings.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { setViz, store } from "./state.ts";
import { toast } from "./toast.ts";
import "./lightingOptions.css";

/** Vectorworks' indirect lighting levels: the bounces after the first hit. */
export const INDIRECT: readonly { readonly label: string; readonly bounces: number }[] = [
  { label: "None", bounces: 0 },
  { label: "2 Bounces", bounces: 2 },
  { label: "Exterior, 3 Bounces", bounces: 3 },
  { label: "Normal, 4 Bounces", bounces: 4 },
  { label: "Interior, 16 Bounces", bounces: 16 },
];
/** Vectorworks' default ambient brightness, which Rodeo's usual ambient light (1) stands for */
export const USUAL_AMBIENT = 35;
const DEFAULT_OCCLUSION = 60;

interface Options {
  readonly bounces: number;
  readonly ambient: number | null;
  readonly occlusion: number | null;
  readonly emitter: number;
}

export function field(label: string, control: HTMLElement, unit = ""): HTMLLabelElement {
  return h(
    "label",
    { cls: "menu-dialog-field" },
    h("span", { cls: "menu-dialog-label", text: label }),
    control,
    unit ? h("span", { cls: "menu-dialog-unit", text: unit }) : null,
  );
}

export function group(title: string, ...rows: HTMLElement[]): HTMLElement {
  return h("fieldset", { cls: "lighting-group" }, h("legend", { text: title }), ...rows);
}

export function percent(value: number, label: string): HTMLInputElement {
  return h("input", { cls: "menu-dialog-input", value: String(Math.round(value * 10) / 10), attrs: { type: "number", step: "any", "aria-label": label } });
}

/** A typed percentage from 0 to `max`, or null. */
export function readPercent(input: HTMLInputElement, max: number): number | null {
  const v = Number(input.value);
  return input.value.trim() !== "" && Number.isFinite(v) && v >= 0 && v <= max ? v : null;
}

export async function lightingOptionsDialog(): Promise<void> {
  const render = renderSettings();
  const viz = store.viz3d;
  // the path tracer's bounces count the first hit
  const bounces = Math.max(0, render.quality.bounces - 1);
  const indirect = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": "Indirect Lighting" } },
    ...INDIRECT.map((l) => h("option", { value: String(l.bounces), text: l.label })),
    ...(INDIRECT.some((l) => l.bounces === bounces) ? [] : [h("option", { value: String(bounces), text: `${bounces} Bounces` })]),
  );
  indirect.value = String(bounces);
  const ambientOn = h("input", { checked: viz.ambient > 0, attrs: { type: "checkbox", "aria-label": "Ambient light on" } });
  const ambient = percent(viz.ambient > 0 ? viz.ambient * USUAL_AMBIENT : USUAL_AMBIENT, "Ambient brightness");
  const occlusionOn = h("input", { checked: render.effects.ao > 0, attrs: { type: "checkbox", "aria-label": "Ambient occlusion on" } });
  const occlusion = percent(render.effects.ao > 0 ? render.effects.ao * 100 : DEFAULT_OCCLUSION, "Ambient occlusion strength");
  const emitter = percent(render.lights.intensity * 100, "Emitter brightness");
  const sync = (): void => {
    ambient.disabled = !ambientOn.checked;
    occlusion.disabled = !occlusionOn.checked;
  };
  ambientOn.addEventListener("change", sync);
  occlusionOn.addEventListener("change", sync);
  sync();
  const v = await showDialog<Options>({
    title: "Lighting Options",
    okLabel: "OK",
    body: [
      group("Indirect Lighting", field("Level", indirect), h("p", { cls: "muted", text: "Path Traced: the bounces after light first meets the model." })),
      group(
        "Ambient Info",
        h("label", { cls: "menu-dialog-check" }, ambientOn, "On"),
        field("Brightness", ambient, "%"),
        h("p", { cls: "muted", text: "The Shaded view's ambient light; Realistic and Path Traced take theirs from the sky." }),
      ),
      group("Ambient Occlusion", h("label", { cls: "menu-dialog-check" }, occlusionOn, "On"), field("Strength", occlusion, "%")),
      group("Emitter Options", field("Emitter Brightness", emitter, "%")),
    ],
    check: () => {
      const a = readPercent(ambient, 100);
      if (ambientOn.checked && a === null) return { error: "Brightness: from 0 to 100 %.", focus: ambient };
      const o = readPercent(occlusion, 100);
      if (occlusionOn.checked && o === null) return { error: "Strength: from 0 to 100 %.", focus: occlusion };
      const e = readPercent(emitter, 1000);
      if (e === null) return { error: "Emitter Brightness: from 0 to 1000 %.", focus: emitter };
      return { value: { bounces: Number(indirect.value), ambient: ambientOn.checked ? a : null, occlusion: occlusionOn.checked ? o : null, emitter: e } };
    },
  });
  if (!v) return;
  setViz({ ambient: v.ambient === null ? 0 : v.ambient / USUAL_AMBIENT });
  patchRender("quality", { bounces: v.bounces + 1 });
  patchRender("effects", { ao: v.occlusion === null ? 0 : v.occlusion / 100 });
  patchRender("lights", { intensity: v.emitter / 100 });
  toast("Lighting options set.", "info");
}
