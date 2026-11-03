// AEC > Terrain > Zone of Visual Influence: what can be seen from a point above a site model, worked out over the
// surface and drawn as dark ground (the sums are in siteGrading.ts).

import type { Pt } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { h } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showDialog } from "./menubar.ts";
import { hiddenFaces, hiddenOutlines, viewField } from "./siteGrading.ts";
import { modelsIn, nearColour, pen, terrainOf, uniqueName, type Model } from "./siteModel.ts";
import { boxOf, heightRange } from "./siteModelShapes.ts";
import { layerScaleOf } from "./spaces.ts";
import { store, type ToolId } from "./state.ts";
import { toast } from "./toast.ts";
import { formatLength, formatLengthValue, parseLength } from "./units.ts";

const EYE_LEVEL = 1524;
const POINT = 25.4 / 72;
const DARK = "#1b1f2a";

let job: { readonly model: string; readonly height: number } | null = null;
let back: ToolId = "select";

export const canAnalyseView = (): boolean => {
  const doc = store.session?.doc;
  return !!doc && modelsIn(doc).length > 0;
};

const labelOf = (m: Model, i: number): string => store.session?.doc.object(m.id)?.name || `Site Model ${i + 1}`;

export async function zoneOfVisualInfluenceDialog(): Promise<void> {
  const doc = store.session?.doc;
  const ctx = appContext();
  if (!doc || !ctx) return;
  const models = modelsIn(doc);
  if (!models.length) {
    toast("There's no site model to analyze.", "error");
    return;
  }
  const units = doc.info.units;
  const chosen = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Select Site Model" } }, ...models.map((m, i) => h("option", { text: labelOf(m, i), attrs: { value: m.id } })));
  chosen.value = models.find((m) => store.selection.has(m.id))?.id ?? models[0].id;
  const height = h("input", { cls: "menu-dialog-input", value: formatLengthValue(EYE_LEVEL, units), attrs: { "aria-label": "View height above Site Model" } });
  const row = (label: string, el: HTMLElement): HTMLElement => h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), el);
  const asked = await showDialog<{ model: string; height: number }>({
    title: "Zone of Visual Influence",
    okLabel: "OK",
    body: [row("Select Site Model", chosen), row("View height above Site Model", height)],
    check: () => {
      const v = parseLength(height.value, units);
      return v === null || v < 0 ? { error: "Type a height of zero or more.", focus: height } : { value: { model: chosen.value, height: v } };
    },
  });
  if (!asked) return;
  if (ctx.controller.activeId !== "visualzone") back = ctx.controller.activeId;
  job = asked;
  ctx.show2d();
  ctx.setTool("visualzone");
}

export const viewJob = (): typeof job => job;

export function endViewJob(): void {
  job = null;
  appContext()?.setTool(back);
}

const jobModel = (): Model | null => {
  const doc = store.session?.doc;
  return (doc && job && modelsIn(doc).find((m) => m.id === job?.model)) || null;
};

/** Whether this point is on the site model the analysis is for. */
export function onJobModel(p: Pt): boolean {
  const m = jobModel();
  return !!m && terrainOf(m).proposedAt(p.x, p.y) !== null;
}

/** The analysis from this point, drawn on the model's layer as a group: dark ground in plan and in 3D, and the point. */
export function analyseViewFrom(p: Pt): void {
  const m = jobModel();
  const asked = job;
  if (!m || !asked) return endViewJob();
  const terrain = terrainOf(m);
  const field = viewField(terrain.proposedAt, boxOf(terrain.proposed), p, asked.height);
  if (!field) {
    toast("Click on the site model.", "error");
    return;
  }
  const scale = layerScaleOf(m.layerId);
  const range = heightRange(terrain.proposed);
  const r = attempt("Zone of Visual Influence", (s) =>
    s.batch(() => {
      const colour = nearColour(s.doc);
      const dark = colour(DARK);
      const cls = store.activeClassIndex;
      const look = { ...store.drawAttrs, fillPattern: 1, fillFore: dark, fillBack: dark, fillOpacity: 60, lineStyle: 0 };
      const size = 3 * scale;
      const red = colour("#d0342c");
      const ground = terrain.proposedAt(p.x, p.y) ?? 0;
      const label = `View ${formatLength(asked.height, s.doc.info.units)}`;
      const plan = s.addObjects(m.layerId, hiddenOutlines(field).map((points) => ({ kind: "polygon", points, closed: true })), cls, look);
      const mark = s.addObjects(
        m.layerId,
        [
          { kind: "arc", center: p, radius: size, startAngle: 0, sweepAngle: 360 },
          { kind: "line", a: { x: p.x - size * 1.5, y: p.y }, b: { x: p.x + size * 1.5, y: p.y } },
          { kind: "line", a: { x: p.x, y: p.y - size * 1.5 }, b: { x: p.x, y: p.y + size * 1.5 } },
        ] as never[],
        cls,
        pen(red, 7),
      );
      const text = s.addObject(m.layerId, { kind: "text", at: { x: p.x + size * 1.8, y: p.y + size * 1.2 }, text: label, height: 8 * POINT * scale, hAlign: 1, vAlign: 3 } as never, cls, { fillPattern: 0, penFore: red });
      const lift = Math.max((range.max - range.min) / 100, 5);
      const faces = hiddenFaces(field, 2, lift);
      const mesh = faces.length ? s.addMeshes(m.layerId, [faces], cls, look) : [];
      const eye = s.add3DLoci(m.layerId, [[p.x, p.y, ground + asked.height]], cls);
      const group = s.groupObjects([...plan, ...mesh, ...mark, text, ...eye]);
      s.setObjectName(group, uniqueName(s.doc, "Zone of Visual Influence"));
      return group;
    }),
  );
  job = null;
  appContext()?.setTool(back);
  if (!r) return;
  setSelection([r.value]);
  appContext()?.requestDraw();
  const total = field.seen + field.hidden;
  toast(field.hidden ? `${Math.round((field.hidden / total) * 100)}% of the site can't be seen from there: the dark ground.` : "All of the site can be seen from there.", "info");
}
