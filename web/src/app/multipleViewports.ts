// View > Create Multiple Viewports…: the 3D model's Front, Top, Right, Left, Bottom and Back views
// and an isometric, any of them, each a viewport at one scale, laid out by first or third angle
// projection (orthoViews.ts) and centred on a sheet layer: the active one when it's a sheet, else a
// new one. As Vectorworks does with no viewport style, the views are hidden-line, of the layers and
// classes visible now; Rodeo draws them into each viewport's annotations as the model stands when
// they're made (sectionCut.ts, as the section viewports are), not kept up to date. Vectorworks also
// takes a viewport style, which Rodeo doesn't have.

import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { firstFree, viewportNamesTaken } from "./createViewport.ts";
import { nextPaint } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showLoading } from "./loading.ts";
import { layOut, ORTHO_VIEWS, orthoFrame, seenBox, viewName, type Method, type OrthoView } from "./orthoViews.ts";
import { sectionView, type SectionDrawing } from "./sectionCut.ts";
import { addSectionViewport, sectionHalves, sectionMeshes } from "./sectionViewport.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import { millimetresPerUnit } from "./units.ts";

const LABEL = "Create Multiple Viewports";
/** between the viewports on the sheet, mm */
const GAP_MM = 20;
/** inches, feet, yards and miles: the units third angle projection is the default for */
const IMPERIAL_MM = new Set([25.4, 304.8, 914.4, 1609344]);

export async function createMultipleViewportsDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = session.doc;
  const all = doc.layers();
  const active = all.find((l) => l.id === store.activeLayerId);
  const design = active?.kind === "design" ? active : all.find((l) => l.kind === "design" && l.visibility !== "hidden");
  const meshes = sectionMeshes();
  if (!meshes.length) {
    toast("Nothing on the visible design layers is drawn in 3D.", "info");
    return;
  }
  const third = IMPERIAL_MM.has(millimetresPerUnit(doc.info.units));
  const on = (view: OrthoView): boolean => view === "front" || view === "top" || view === (third ? "right" : "left");
  const v = await toolPrefs(
    LABEL,
    [
      { kind: "number", key: "scale", label: "Viewport Scale 1:", value: design?.scale || 1, min: 0.001, max: 1e6 },
      {
        kind: "choice",
        key: "method",
        label: "Method",
        wide: true,
        value: third ? "third" : "first",
        options: [
          { value: "first", label: "First angle projection" },
          { value: "third", label: "Third angle projection" },
        ],
      },
      { kind: "heading", key: "views", label: "Views" },
      ...ORTHO_VIEWS.map((view) => ({ kind: "check" as const, key: view, label: view === "iso" ? "Isometric" : viewName(view, "first"), value: on(view) })),
    ],
    `The visible design layers' 3D objects, their classes shown, as hidden-line views, laid out round Front and centred on ${active?.kind === "sheet" ? `the sheet layer ${active.name}` : "a new sheet layer"}. The isometric is Right Isometric in third angle projection and Left Isometric in first. They're drawn into the viewports' annotations as the model is now; they aren't kept up to date.`,
  );
  if (!v || store.session !== session) return;
  const views = ORTHO_VIEWS.filter((view) => v.flag(view));
  if (!views.length) {
    toast("Choose at least one view.", "info");
    return;
  }
  const method = v.choice("method") as Method;
  const scale = v.num("scale");
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i + 2 < m.triangles.length; i += 3)
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], m.triangles[i + k]);
        hi[k] = Math.max(hi[k], m.triangles[i + k]);
      }
  const done = showLoading("Drawing the views…");
  const drawn: { view: OrthoView; drawing: SectionDrawing & { box: NonNullable<SectionDrawing["box"]> }; halfW: number; halfH: number }[] = [];
  try {
    await nextPaint();
    for (const view of views) {
      const d = sectionView(meshes, orthoFrame(view, method, lo, hi));
      if (!d.box) continue;
      // square-on views take the model's whole box, so those sharing an axis with Front line up with it
      const box = view === "iso" ? d.box : seenBox(view, method, lo, hi);
      drawn.push({ view, drawing: { ...d, box }, ...sectionHalves(box, scale) });
    }
  } catch (err) {
    toast(`The views couldn't be drawn: ${errorMessage(err)}`);
    return;
  } finally {
    done();
  }
  if (!drawn.length || store.session !== session) return;
  const spots = layOut(drawn, method, GAP_MM);
  const taken = viewportNamesTaken(doc);
  const made = attempt(LABEL, (s) =>
    s.batch(() => {
      const sheetId = active?.kind === "sheet" ? active.id : s.createLayer(firstFree("Sheet", new Set(all.map((l) => l.name))), "sheet");
      const ids = drawn.map(({ view, drawing }) => {
        const base = viewName(view, method);
        const name = taken.has(base) ? firstFree(base, taken) : base;
        taken.add(name);
        const box = drawing.box;
        const at = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
        return addSectionViewport(s, sheetId, { drawing, scale, mid: spots.get(view) ?? { x: 0, y: 0 }, at, name, label: null });
      });
      return { sheetId, ids };
    }),
  );
  if (!made) return;
  if (store.activeLayerId !== made.value.sheetId) setActiveLayer(made.value.sheetId);
  setSelection(made.value.ids);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
  const n = made.value.ids.length;
  toast(`${n} ${n === 1 ? "viewport" : "viewports"} made by ${method} angle projection.`, "info");
}
