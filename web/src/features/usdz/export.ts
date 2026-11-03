// File > Export > Export USDZ (AR)… and Export glTF (AR)…: the options dialog (design layers, scale,
// centring), then the model (model.ts) written by three.js's USDZ or glTF exporter and downloaded.
// The exporters load when an export runs, so the editor's start-up does not wait for them.

import { downloadBlob } from "../../app/fileio.ts";
import { h, nextPaint } from "../../app/dom.ts";
import { withoutHidden } from "../../app/hiddenObjects.ts";
import { showDialog } from "../../app/menubar.ts";
import { showLoading } from "../../app/loading.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import type { LayerInfo } from "../../core/index.ts";
import { buildScene, layerStats, TRIANGLE_WARNING, unionOf, type LayerStats, type ModelOptions } from "./model.ts";
import "./usdz.css";

export type Format = "usdz" | "gltf";

/** The scales the dialog offers, as the denominator of 1:n. */
const SCALES = [1, 50, 100, 200, 500] as const;
const CUSTOM = "custom";
const MAX_SCALE = 100_000;

/** Exports the drawing's design layers in `format`: asks the options, then writes and downloads the file. */
export async function exportModel(format: Format): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = withoutHidden(session.doc);
  const meshes = doc.model3d();
  const stats = layerStats(meshes);
  const layers = doc.layers().filter((l) => l.kind === "design");
  if (stats.size === 0) {
    toast("There is no 3D geometry on the design layers to export.", "info");
    return;
  }
  const options = await askOptions(format, layers, stats);
  if (!options) return;

  await nextPaint();
  const dismiss = showLoading(format === "usdz" ? "Building the USDZ model…" : "Building the glTF model…");
  try {
    const { scene } = await buildScene(meshes, doc.resources(), options);
    const base = store.fileName.replace(/\.vwx$/i, "");
    if (format === "usdz") {
      const { USDZExporter } = await import("three/examples/jsm/exporters/USDZExporter.js");
      const bytes = await new USDZExporter().parseAsync(scene, { maxTextureSize: 1024 });
      downloadBlob(`${base}.usdz`, new Blob([new Uint8Array(bytes)], { type: "model/vnd.usdz+zip" }));
      toast("Open the .usdz on an iPhone or iPad to place the model on a table with AR Quick Look.", "info");
    } else {
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
      downloadBlob(`${base}.glb`, new Blob([glb as ArrayBuffer], { type: "model/gltf-binary" }));
    }
  } catch (err) {
    toast(`The export failed: ${errorMessage(err)}`);
  } finally {
    dismiss();
  }
}

/** The dialog: the design layers (the visible ones ticked), the scale and the centring. Resolves with the options, or null. */
function askOptions(format: Format, layers: readonly LayerInfo[], stats: ReadonlyMap<string, LayerStats>): Promise<ModelOptions | null> {
  const boxes = new Map<string, HTMLInputElement>();

  const scale = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select usdz-scale", attrs: { "aria-label": "Scale" } },
    ...SCALES.map((n) => h("option", { text: `1:${n}`, value: String(n) })),
    h("option", { text: "Custom", value: CUSTOM }),
  );
  scale.value = "50";
  const custom = h("input", {
    cls: "menu-dialog-input usdz-custom",
    attrs: { type: "number", min: "1", max: String(MAX_SCALE), step: "1", "aria-label": "Custom scale, 1 to the number", placeholder: "1:…" },
  });
  custom.hidden = true;

  /** the scale's denominator, or null when the custom one is not a whole number in range */
  const denominator = (): number | null => {
    if (scale.value !== CUSTOM) return Number(scale.value);
    const n = Number(custom.value);
    return custom.value.trim() !== "" && Number.isInteger(n) && n >= 1 && n <= MAX_SCALE ? n : null;
  };

  const summary = h("p", { cls: "usdz-summary" });
  const warn = h("p", { cls: "usdz-warn", text: "More than 2 million triangles: the file will be large and slow to open in AR." });
  const centre = h("input", { attrs: { type: "checkbox" }, checked: true });

  /** the stats of the ticked layers that have geometry */
  const picked = (): LayerStats[] => {
    const out: LayerStats[] = [];
    for (const [id, box] of boxes) {
      const s = stats.get(id);
      if (box.checked && s) out.push(s);
    }
    return out;
  };

  const update = (): void => {
    custom.hidden = scale.value !== CUSTOM;
    const chosen = picked();
    const triangles = chosen.reduce((n, s) => n + s.triangles, 0);
    const parts = [`${triangles.toLocaleString()} triangles`];
    const box = unionOf(chosen);
    const d = denominator();
    if (box && d !== null) {
      // metres at this scale: 1 mm of the drawing is 0.001 / d m
      const size = [0, 1, 2].map((k) => ((box.max[k] - box.min[k]) * 0.001) / d);
      parts.push(`${sizeText(size)} at 1:${d}`);
    }
    summary.textContent = parts.join(" · ");
    warn.hidden = triangles <= TRIANGLE_WARNING;
  };

  const rows = layers.map((layer) => {
    const s = stats.get(layer.id);
    const box = h("input", { attrs: { type: "checkbox" }, checked: layer.visibility !== "hidden" && s !== undefined, disabled: s === undefined });
    boxes.set(layer.id, box);
    box.addEventListener("change", update);
    const meta = s ? `${s.triangles.toLocaleString()} triangles` : "no 3D geometry";
    const state = layer.visibility === "visible" ? "" : ` · ${layer.visibility}`;
    return h(
      "label",
      { cls: "usdz-layer" },
      box,
      h("span", { cls: "usdz-layer-name", text: layer.name || "(unnamed)" }),
      h("span", { cls: "usdz-layer-meta", text: meta + state }),
    );
  });

  scale.addEventListener("change", update);
  custom.addEventListener("input", update);
  update();

  const hint = format === "usdz" ? "Opens with AR Quick Look on an iPhone or iPad." : "One binary glTF file (.glb) for 3D viewers and tools.";
  const body: Node[] = [
    h("p", { cls: "usdz-hint", text: hint }),
    h("div", { cls: "usdz-heading", text: "Design layers" }),
    h("div", { cls: "usdz-layers", attrs: { role: "group", "aria-label": "Design layers" } }, ...rows),
    h(
      "label",
      { cls: "menu-dialog-field" },
      h("span", { cls: "menu-dialog-label", text: "Scale (real size ÷ n)" }),
      h("span", { cls: "usdz-scale-row" }, scale, custom),
    ),
    h("label", { cls: "menu-dialog-check" }, centre, h("span", { text: "Centre on the origin and drop to the ground" })),
    summary,
    warn,
  ];

  return showDialog<ModelOptions>({
    title: format === "usdz" ? "Export USDZ (AR)" : "Export glTF (AR)",
    okLabel: "Export",
    cls: "usdz-dialog",
    body,
    check: () => {
      const ids = new Set<string>();
      for (const [id, box] of boxes) if (box.checked && stats.has(id)) ids.add(id);
      if (ids.size === 0) return { error: "Choose at least one layer with 3D geometry." };
      const d = denominator();
      if (d === null) return { error: `The custom scale must be a whole number from 1 to ${MAX_SCALE}.`, focus: custom };
      return { value: { layers: ids, scale: d, centre: centre.checked } };
    },
  });
}

/** "1.20 × 0.80 × 0.45 m", or in millimetres when every side is under a metre. */
function sizeText(sizeM: number[]): string {
  const metres = Math.max(...sizeM) >= 1;
  const parts = sizeM.map((d) => (metres ? d.toFixed(2) : String(Math.round(d * 1000))));
  return `${parts.join(" × ")} ${metres ? "m" : "mm"}`;
}
