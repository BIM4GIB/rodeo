// The AI mode's card, under the modes while the 3D view draws in AI (panel.ts shows it only then):
// the cost of a picture from the AI credit, the style it paints in, the person's own words, the
// strength, whether it paints each time the view rests, and Open picture and Paint now (aiLive.ts
// paints the view as it is). Its rules sit in lookTab.css. No three.js here.

import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { reportFailure } from "../../../app/reports.ts";
import { errorMessage, toast } from "../../../app/toast.ts";
import { onUser } from "../../../platform/api.ts";
import { onConfig } from "../../account/config.ts";
import { AI_STRENGTHS, AI_STYLES, aiCostLine, aiTerms, readyToPaint } from "../ai.ts";
import { aiLive } from "../bridge.ts";
import { onRender, patchRender, renderSettings } from "../settings.ts";
import "./lookTab.css";
import { button, icon, select, toggle } from "./ui.ts";

const STYLE_OPTIONS: readonly (readonly [string, string])[] = AI_STYLES.map((s): [string, string] => [s.id, s.label]);

function report(err: unknown, step: string): void {
  toast(`Render: ${errorMessage(err)}`);
  reportFailure("render", err, { step });
}

/** Draws the 3D view in AI, as View > Rendering does (panel.ts's showMode, which this card can't import). */
async function drawAi(): Promise<void> {
  const app = appContext();
  if (!app) return;
  await app.show3d();
  app.setRenderMode("ai");
}

/** The AI card: its controls kept in step with the AI settings, the cost line with the credit. */
export function aiCard(): HTMLElement {
  const cost = h("p", { cls: "rs-ai-cost" });

  const style = select("Style", STYLE_OPTIONS, (id) => patchRender("ai", { style: id }));

  const words = h("textarea", {
    cls: "rs-ai-words",
    placeholder: "Oak cladding, a birch grove behind, people on the terrace…",
    attrs: { "aria-label": "Describe it", maxlength: "600", rows: "3" },
  });
  // taken when it is left or Enter is pressed, not at each key: each change paints the view again
  const takeWords = (): void => {
    if (words.value !== renderSettings().ai.words) patchRender("ai", { words: words.value });
  };
  words.addEventListener("change", takeWords);
  words.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      takeWords();
      words.blur();
    }
  });

  const strength = select("Strength", AI_STRENGTHS, (v) => patchRender("ai", { strength: v }), "How far the AI may go from the picture: the building, its openings and the camera always stay");
  const auto = toggle("Paint each time the view rests", (on) => patchRender("ai", { auto: on }));

  const openPicture = button(
    "Open picture",
    () => {
      const p = aiLive()?.picture();
      if (!p) {
        toast("Nothing is painted yet: Paint now first.", "info");
        return;
      }
      void import("../viewer.ts")
        .then((m) => m.showRenderResult([{ blob: p.blob, before: p.before, width: p.width, height: p.height, name: "Current view", engine: "AI", note: p.note, samples: null, seconds: 0 }]))
        .catch((err: unknown) => report(err, "loading the render viewer"));
    },
    { small: true, title: "The latest painting in the render viewer, to compare, save or restyle" },
  );
  const paintNow = button(
    "Paint now",
    () => {
      void (async () => {
        if (appContext()?.renderMode() !== "ai") await drawAi();
        if (await readyToPaint(1)) aiLive()?.paintNow();
      })().catch((err: unknown) => report(err, "painting the view"));
    },
    { primary: true, small: true, icon: "sparkle", title: "Paint the view as it is now" },
  );

  const card = h(
    "div",
    { cls: "rs-ai-card" },
    h("div", { cls: "rs-ai-head" }, icon("sparkle", 14), h("span", { text: "AI render" })),
    cost,
    style.el,
    h("label", { cls: "rs-ai-field" }, h("span", { cls: "rs-label", text: "Describe it" }), words),
    strength.el,
    auto.el,
    h("div", { cls: "rs-ai-actions" }, openPicture, paintNow),
  );

  const sync = (): void => {
    const s = renderSettings();
    style.set(s.ai.style);
    if (document.activeElement !== words) words.value = s.ai.words;
    strength.set(s.ai.strength);
    auto.set(s.ai.auto);
    const terms = aiTerms();
    cost.textContent = terms ? `${aiCostLine(1)} Painted by ${terms.by}: it keeps the building and the camera, and may change small details.` : "";
  };
  onRender(sync);
  onConfig(sync);
  onUser(sync);
  return card;
}
