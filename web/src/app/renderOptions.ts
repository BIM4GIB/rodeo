// View > Rendering's options for the render modes the 3D view draws itself (also at the foot of the
// View bar's Render mode pop-up, as Vectorworks lists them under Options For Other Render Modes):
// Shaded Options, whether Shaded draws textures and colours, outlines faces with their edges, where
// shadows fall and how sharp they are; Line Render Options, Dashed Hidden Line's dash style and
// shade. They are the 3D view's settings, as the Visualization palette's are (store.viz3d).

import type { ShadowQuality } from "./heliodon.ts";
import { setViz, store } from "./state.ts";
import { toolPrefs } from "./toolPrefs.ts";

const QUALITIES: readonly { readonly value: ShadowQuality; readonly label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "veryHigh", label: "Very High" },
];

export async function shadedOptionsDialog(): Promise<void> {
  const o = store.viz3d.shaded;
  const v = await toolPrefs(
    "Shaded Options",
    [
      { kind: "check", key: "textures", label: "Textures", value: o.textures },
      { kind: "check", key: "colors", label: "Colors", value: o.colors },
      { kind: "check", key: "shadows", label: "Shadows", value: store.viz3d.shadows },
      { kind: "check", key: "groundOnly", label: "On ground only", value: o.groundOnly },
      { kind: "check", key: "edges", label: "Draw edges", value: o.edges },
      { kind: "choice", key: "quality", label: "Shadow quality", value: o.shadowQuality, options: QUALITIES },
    ],
    "For Shaded and Textured (which always draws textures). Without Colors faces are white. Shadows is the Visualization palette's; On ground only casts them on the ground under the model, not on the objects.",
  );
  if (!v) return;
  setViz({
    shadows: v.flag("shadows"),
    shaded: {
      textures: v.flag("textures"),
      colors: v.flag("colors"),
      groundOnly: v.flag("groundOnly"),
      edges: v.flag("edges"),
      shadowQuality: QUALITIES.find((q) => q.value === v.choice("quality"))?.value ?? o.shadowQuality,
    },
  });
}

export async function lineRenderOptionsDialog(): Promise<void> {
  const o = store.viz3d.lineRender;
  const types = store.session?.doc.lineTypes().filter((t) => t.dashes.length > 0) ?? [];
  const v = await toolPrefs(
    "Line Render Options",
    [
      {
        kind: "choice",
        key: "style",
        label: "Dash Style",
        value: types.some((t) => t.style === o.dashStyle) ? String(o.dashStyle) : "0",
        options: [{ value: "0", label: "Default" }, ...types.map((t) => ({ value: String(t.style), label: t.name }))],
      },
      { kind: "number", key: "shade", label: "Dash Shade", value: Math.round(o.dashShade * 100), min: 0, max: 100, unit: "%" },
    ],
    "For Dashed Hidden Line: the hidden edges' dashes (a dash style at the active layer's scale), and their shade from the edges' grey (0 %) to white (100 %).",
  );
  if (!v) return;
  setViz({ lineRender: { dashStyle: Number(v.choice("style")) || 0, dashShade: v.num("shade") / 100 } });
}
