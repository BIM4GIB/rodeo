// File > Import > Import Metafile…: places a Windows enhanced metafile (.emf) on the active layer
// as vector objects, as Import PDF places a page: its line work and fills as lines and polygons in
// the drawing's nearest colours at their line weights, its text as text objects, grouped and
// centred in the view at the picture's size at the chosen scale, in one undo step. The reading is
// in import/emf.ts; pictures, pattern fills and clipping are left out, as the summary says.

import { readEmf } from "../import/emf.ts";
import type { PdfPage } from "../import/pdf.ts";
import { h, nextPaint } from "./dom.ts";
import { fileIn } from "./ext.ts";
import { askPage, layerScale, place, ready } from "./pdfImport.ts";
import type { Scene } from "./scene.ts";
import { errorMessage, toast } from "./toast.ts";
import type { View } from "./view.ts";

/** Whether `name` is a metafile (.emf, or a .wmf, which is refused with a word on why). */
export function isMetafile(name: string): boolean {
  return /\.[ew]mf$/i.test(name);
}

/** File > Import > Import Metafile…: asks for an EMF file and imports it. */
export function importMetafileFile(scene: Scene, view: View): void {
  if (!ready("metafile")) return;
  const input = h("input", { attrs: { type: "file", accept: ".emf,image/emf,image/x-emf" }, hidden: true });
  document.body.append(input);
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (file) void importMetafile(file, scene, view);
  });
  input.addEventListener("cancel", () => input.remove());
  input.click();
}

/** A metafile dropped on the window, or chosen: asks at what scale, then imports it. */
export async function importMetafile(file: File, scene: Scene, view: View): Promise<void> {
  if (!ready("metafile")) return;
  if (/\.wmf$/i.test(file.name)) {
    toast("Import Metafile reads enhanced metafiles (.emf); save the picture as EMF to import it.", "info");
    return;
  }
  let page: PdfPage;
  try {
    page = readEmf(new Uint8Array(await file.arrayBuffer()));
  } catch (err) {
    toast(`Could not read ${file.name}: ${errorMessage(err)}`);
    fileIn(file, file.name, errorMessage(err));
    return;
  }
  const choice = await askPage(1, layerScale(), "Import Metafile", "The picture is placed at its size at this scale, centred in the view, as a group. Pictures, pattern fills and clipping are left out.");
  if (!choice) return;
  await nextPaint();
  place(page, choice, file.name, "Import Metafile", scene, view);
  fileIn(file, file.name);
}
