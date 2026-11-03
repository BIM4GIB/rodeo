// Event Design's Create Views (Spotlight > Event in Vectorworks; Stage > Event here): two sheet
// layers that show the event's layout to a client. Plan View holds a plan viewport of the visible
// design layers at the active layer's scale; Rendered View holds a picture of the model from Right
// Isometric in Shaded. Vectorworks makes the second a rendered viewport that Update redraws; Rodeo's
// viewports are plans, so it is a picture taken when the command runs (run it again for a new one),
// and a drawing that holds no picture yet (a new blank one) has none to copy, so it gets Plan View
// alone, as Import Image can't place a picture there either.

import { attempt, setActiveLayer, setSelection, zoomToSelection } from "../../../app/commands.ts";
import { drawnBox, viewportClasses } from "../../../app/createViewport.ts";
import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { canvasBlob } from "../../../export/png.ts";

/** the rendered picture, px */
const PICTURE = { width: 1600, height: 1000 } as const;
/** its width on the sheet, mm */
const PICTURE_MM = 400;

/** `base`, or `base 2`, `base 3`… when a layer has that name. */
function freeName(base: string, taken: Set<string>): string {
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
  taken.add(name);
  return name;
}

/** The model from Right Isometric in Shaded, framed, as PNG bytes; null without a 3D view. */
export async function isometricPicture(): Promise<Uint8Array | null> {
  const ctx = appContext();
  if (!ctx) return null;
  const showing = store.view3d;
  // showing it brings its model up to date with the drawing, as Render Image does
  const view = await ctx.show3d();
  if (!view) return null;
  const { width, height } = PICTURE;
  const canvas = h("canvas", { attrs: { width: String(width), height: String(height) } });
  view.picture(view.presetState("iso", width, height), canvas, { mode: "shaded", projection: "orthogonal" }, PICTURE);
  if (!showing) ctx.show2d();
  return new Uint8Array(await (await canvasBlob(canvas, "image/png")).arrayBuffer());
}

/** Stage > Event > Create Views: the Plan View and Rendered View sheet layers. */
export async function createViews(): Promise<void> {
  const s = store.session;
  const ctx = appContext();
  if (!s || !ctx) return;
  const doc = s.doc;
  const designs = doc.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden");
  const shown = drawnBox(designs.map((l) => l.id));
  if (!designs.length || !shown) {
    toast("Create Views: the design layers show nothing yet. Lay out the event first.", "info");
    return;
  }
  const active = designs.find((l) => l.id === store.activeLayerId) ?? designs[0];
  const scale = active.scale || 1;
  const pictures = s.canAdd("image");
  const bytes = pictures ? await isometricPicture() : null;
  if (store.session !== s) return;
  const [halfW, halfH] = [(shown.x1 - shown.x0) / 2 / scale, (shown.y1 - shown.y0) / 2 / scale];
  const pictureH = (PICTURE_MM * PICTURE.height) / PICTURE.width;
  const r = attempt("Create Views", (session) =>
    session.batch(() => {
      const taken = new Set(doc.layers().map((l) => l.name));
      const plan = session.createLayer(freeName("Plan View", taken), "sheet");
      const viewport = session.createViewport(plan, {
        scale,
        box: { x0: -halfW, y0: -halfH, x1: halfW, y1: halfH },
        at: { x: (shown.x0 + shown.x1) / 2, y: (shown.y0 + shown.y1) / 2 },
        layers: designs.map((l) => ({ id: l.id, visibility: l.visibility })),
        classes: viewportClasses(doc),
        classIndex: store.activeClassIndex,
      });
      if (bytes) {
        const rendered = session.createLayer(freeName("Rendered View", taken), "sheet");
        session.addObject(rendered, { kind: "image", x0: -PICTURE_MM / 2, y0: -pictureH / 2, x1: PICTURE_MM / 2, y1: pictureH / 2, bytes, mime: "image/png", ...PICTURE }, store.activeClassIndex);
      }
      return { plan, viewport };
    }),
  );
  if (!r) return;
  setActiveLayer(r.value.plan);
  setSelection([r.value.viewport]);
  zoomToSelection(ctx.scene, ctx.view);
  toast(
    bytes
      ? "Create Views: Plan View holds a plan viewport of the visible design layers; Rendered View a Shaded picture from Right Isometric, taken now (run Create Views again after changes)."
      : pictures
        ? "Create Views: Plan View made. The 3D view isn't available here, so there's no Rendered View."
        : "Create Views: Plan View made. This drawing holds no picture to copy settings from yet (a new drawing doesn't), so the Rendered View's picture can't be placed in it.",
    "info",
  );
}
