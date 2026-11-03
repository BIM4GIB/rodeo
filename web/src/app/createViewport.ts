// View > Create Viewport…: a plan viewport on a sheet layer, of the design layers asked for at the
// scale asked for, showing all of what they draw or just a selected closed shape's box. Vectorworks
// starts from the layer's scale and the visibilities in force; so does this. A hidden or grayed class
// stays so in the viewport. Vectorworks' dialog also takes a style, a drawing label and title, and a
// view: Rodeo's viewport is a plan, its name is all it's given, and what it shows is cropped to a box.

import type { BBox, NewViewport, Visibility, VwxDocument } from "../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { appContext } from "./ext.ts";
import { isClosedShape } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

export const NEW_SHEET = "new";
/** paper size of the box when nothing is drawn yet, mm */
const EMPTY_BOX_MM = 200;
const VISIBILITIES: readonly { readonly value: Visibility; readonly label: string }[] = [
  { value: "visible", label: "Visible" },
  { value: "grayed", label: "Gray" },
  { value: "hidden", label: "Hidden" },
];

export const canCreateViewport = (): boolean => !!store.session?.doc.layers().some((l) => l.kind !== "sheet");

/** The selected closed shape's box, when one shape on a design layer is selected. */
function selectedCrop(): BBox | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const obj = doc.object([...store.selection][0]);
  if (!obj?.shape?.bbox || !isClosedShape(obj.shape)) return null;
  return doc.layers().find((l) => l.id === obj.layerId)?.kind === "sheet" ? null : obj.shape.bbox;
}

/** What `ids` draw, together. */
export function drawnBox(ids: readonly string[]): BBox | null {
  const scene = appContext()?.scene;
  if (!scene) return null;
  let box: BBox | null = null;
  for (const id of ids) {
    for (const obj of scene.index(id).objects) {
      const b = obj.shape?.bbox;
      if (!b || !scene.isObjectVisible(obj)) continue;
      box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    }
  }
  return box;
}

/** The first of `base-1`, `base-2`… that isn't in `taken`. */
export function firstFree(base: string, taken: ReadonlySet<string>): string {
  for (let n = 1; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** The names a new viewport can't take: layers', resources' and what's on sheet layers. */
export function viewportNamesTaken(doc: VwxDocument): Set<string> {
  const all = doc.layers();
  return new Set([
    ...all.map((l) => l.name),
    ...doc.resources().map((r) => r.name),
    ...all.filter((l) => l.kind === "sheet").flatMap((l) => doc.objects(l.id).flatMap((o) => (o.parentId === null && o.name ? [o.name] : []))),
  ]);
}

/** A new viewport's classes: None's visibility and every class not visible, as they are. */
export function viewportClasses(doc: VwxDocument): NewViewport["classes"] {
  const none = doc.classes().find((c) => c.name === "None");
  const others = doc.classes().filter((c) => c.visibility !== "visible" && c !== none);
  return [...(none ? [{ index: none.index, visibility: none.visibility }] : []), ...others.map((c) => ({ index: c.index, visibility: c.visibility }))];
}

export async function createViewportDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const doc = session.doc;
  const all = doc.layers();
  const designs = all.filter((l) => l.kind !== "sheet");
  const sheets = all.filter((l) => l.kind === "sheet");
  const active = designs.find((l) => l.id === store.activeLayerId) ?? designs[0];
  if (!active) return;
  const taken = viewportNamesTaken(doc);
  const crop = selectedCrop();
  const v = await toolPrefs("Create Viewport", [
    { kind: "text", key: "name", label: "Viewport Name", value: firstFree("Viewport", taken) },
    {
      kind: "choice",
      key: "sheet",
      label: "Create on Layer",
      value: sheets.find((l) => l.id === store.activeLayerId)?.id ?? sheets[0]?.id ?? NEW_SHEET,
      options: [...sheets.map((l) => ({ value: l.id, label: l.name })), { value: NEW_SHEET, label: "New Sheet Layer" }],
    },
    { kind: "number", key: "scale", label: "Scale 1:", value: active.scale || 1, min: 0.001, max: 1e6 },
    ...(crop ? [{ kind: "check" as const, key: "crop", label: "Use the selected object as the viewport's crop", value: true }] : []),
    ...designs.map((l) => ({
      kind: "choice" as const,
      key: `layer:${l.id}`,
      label: l.name,
      value: l.id === active.id ? "visible" : l.visibility,
      options: VISIBILITIES.map((o) => ({ value: o.value, label: o.label })),
    })),
  ]);
  if (!v) return;
  const scale = v.num("scale");
  const layers = designs.map((l) => ({ id: l.id, visibility: v.choice(`layer:${l.id}`) as Visibility })).filter((l) => l.visibility !== "hidden");
  const shown = crop && v.flag("crop") ? crop : drawnBox(layers.map((l) => l.id));
  const at = shown ? { x: (shown.x0 + shown.x1) / 2, y: (shown.y0 + shown.y1) / 2 } : { x: 0, y: 0 };
  const halfW = shown ? (shown.x1 - shown.x0) / 2 / scale || EMPTY_BOX_MM / 2 : EMPTY_BOX_MM / 2;
  const halfH = shown ? (shown.y1 - shown.y0) / 2 / scale || EMPTY_BOX_MM / 2 : EMPTY_BOX_MM / 2;
  const spec = (): NewViewport => ({
    scale,
    box: { x0: -halfW, y0: -halfH, x1: halfW, y1: halfH },
    at,
    layers,
    classes: viewportClasses(doc),
    classIndex: store.activeClassIndex,
  });
  const chosen = v.choice("sheet");
  const r = attempt("Create Viewport", (s) =>
    s.batch(() => {
      const sheetId = chosen === NEW_SHEET ? s.createLayer(firstFree("Sheet", new Set(all.map((l) => l.name))), "sheet") : chosen;
      const id = s.createViewport(sheetId, spec());
      const name = v.choice("name");
      if (name) s.setObjectName(id, name);
      return { sheetId, id };
    }),
  );
  if (!r) return;
  if (store.activeLayerId !== r.value.sheetId) setActiveLayer(r.value.sheetId);
  setSelection([r.value.id]);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
  toast("Viewport made on its sheet layer.", "info");
}
