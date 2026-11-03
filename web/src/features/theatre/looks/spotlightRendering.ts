// Stage > Visualization > Set Spotlight Rendering Options…, as Spotlight has it: the lighting and rendering
// settings for a lit stage in one dialog, onto what Rodeo has. Lighting Device Options: Cast shadows (the
// first lights near where the view looks cast them, with the sun's) and Lit fog (haze, with how thick, so the
// lights' beams show in the air in the 3D view and in renders); Background (the renders' sky); Indirect
// Lighting (the path tracer's bounces), Ambient Light On and Brightness, and Emitter Brightness, as View > Set
// Lighting Options has them. Like that dialog and the Render and Visualization palettes, which show the same
// settings, they belong to this machine rather than the file, and have no undo. Not here: soft shadows, the
// lights' distance falloff (Rodeo's fall off as the inverse square), the ambient light's colour and the white
// colour temperature.

import { h } from "../../../app/dom.ts";
import { field, group, INDIRECT, percent, readPercent, USUAL_AMBIENT } from "../../../app/lightingOptions.ts";
import { showDialog } from "../../../app/menubar.ts";
import { setViz, store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { patchRender, renderSettings, type SkyKind } from "../../render/settings.ts";

/** the haze Lit fog turns on at, when there was none */
const LIT_FOG_HAZE = 35;

const SKIES: readonly (readonly [SkyKind, string])[] = [
  ["physical", "Physical Sky"],
  ["gradient", "Gradient"],
  ["color", "Solid Color"],
  ["studio", "Studio"],
];

interface Options {
  readonly shadows: boolean;
  /** haze, percent; null for no lit fog */
  readonly haze: number | null;
  readonly sky: SkyKind;
  readonly bounces: number;
  /** ambient brightness, percent; null for off */
  readonly ambient: number | null;
  readonly emitter: number;
}

const check = (label: string, on: boolean): HTMLInputElement => h("input", { checked: on, attrs: { type: "checkbox", "aria-label": label } }) as HTMLInputElement;
const select = (label: string, options: readonly (readonly [string, string])[], value: string): HTMLSelectElement => {
  const el = h("select", { cls: "menu-dialog-input menu-dialog-select", attrs: { "aria-label": label } }, ...options.map(([v, t]) => h("option", { value: v, text: t }))) as HTMLSelectElement;
  el.value = value;
  return el;
};

/** Stage > Visualization > Set Spotlight Rendering Options…. */
export async function spotlightRenderingOptions(): Promise<void> {
  const render = renderSettings();
  const viz = store.viz3d;
  const shadows = check("Cast shadows", viz.shadows);
  const hazeNow = Math.max(viz.haze, render.lights.haze);
  const fog = check("Lit fog", hazeNow > 0);
  const haze = percent(hazeNow > 0 ? hazeNow * 100 : LIT_FOG_HAZE, "Haze");
  const sky = select("Background", SKIES, render.environment.sky);
  const bounces = Math.max(0, render.quality.bounces - 1);
  const indirect = select("Indirect Lighting", [...INDIRECT.map((l): [string, string] => [String(l.bounces), l.label]), ...(INDIRECT.some((l) => l.bounces === bounces) ? [] : [[String(bounces), `${bounces} Bounces`] as [string, string]])], String(bounces));
  const ambientOn = check("Ambient light on", viz.ambient > 0);
  const ambient = percent(viz.ambient > 0 ? viz.ambient * USUAL_AMBIENT : USUAL_AMBIENT, "Ambient brightness");
  const emitter = percent(render.lights.intensity * 100, "Emitter brightness");
  const sync = (): void => {
    haze.disabled = !fog.checked;
    ambient.disabled = !ambientOn.checked;
  };
  fog.addEventListener("change", sync);
  ambientOn.addEventListener("change", sync);
  sync();
  const v = await showDialog<Options>({
    title: "Spotlight Rendering Options",
    okLabel: "OK",
    body: [
      group(
        "Lighting Device Options",
        h("label", { cls: "menu-dialog-check" }, shadows, "Cast shadows"),
        h("label", { cls: "menu-dialog-check" }, fog, "Lit fog"),
        field("Haze", haze, "%"),
        h("p", { cls: "muted", text: "Lit fog shows the lights' beams in haze, in the 3D view and in Realistic renders. Shadows come from the sun and the lights nearest where the view looks." }),
      ),
      group("Background", field("Sky", sky)),
      group("Indirect Lighting", field("Level", indirect)),
      group("Ambient Light", h("label", { cls: "menu-dialog-check" }, ambientOn, "On"), field("Brightness", ambient, "%")),
      group("Emitter Options", field("Emitter Brightness", emitter, "%")),
      h("p", { cls: "muted", text: "These apply to every lighting device and layer, and are kept on this machine, as View > Set Lighting Options and the Render palette keep them." }),
    ],
    check: () => {
      const hz = readPercent(haze, 100);
      if (fog.checked && (hz === null || hz === 0)) return { error: "Haze: from 1 to 100 %.", focus: haze };
      const a = readPercent(ambient, 100);
      if (ambientOn.checked && a === null) return { error: "Brightness: from 0 to 100 %.", focus: ambient };
      const e = readPercent(emitter, 1000);
      if (e === null) return { error: "Emitter Brightness: from 0 to 1000 %.", focus: emitter };
      return {
        value: { shadows: shadows.checked, haze: fog.checked ? hz : null, sky: sky.value as SkyKind, bounces: Number(indirect.value), ambient: ambientOn.checked ? a : null, emitter: e },
      };
    },
  });
  if (!v) return;
  const hazeOf = v.haze === null ? 0 : v.haze / 100;
  setViz({ shadows: v.shadows, haze: hazeOf, ambient: v.ambient === null ? 0 : v.ambient / USUAL_AMBIENT });
  patchRender("lights", { haze: hazeOf, intensity: v.emitter / 100 });
  patchRender("environment", { sky: v.sky });
  patchRender("quality", { bounces: v.bounces + 1 });
  toast("Spotlight rendering options set.", "info");
}
