// File > Export > Export STL…, as Vectorworks' Export STL Options has it: what to export (the
// selected objects on the active layer, all of it when nothing there is selected; the visible
// objects on the active layer; or those on every design layer the 3D view shows) and the file type
// (binary or ASCII). The triangles are the 3D view's, so curved surfaces go as finely as it draws
// them (Vectorworks' Quality setting has no counterpart). Millimetres, z up; see export/stl.ts.

import { exportStlAscii, exportStlBinary, stlMeshes } from "../export/stl.ts";
import type { Mesh3D } from "../core/types.ts";
import { h } from "./dom.ts";
import { downloadBlob } from "./fileio.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { showDialog } from "./menubar.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

type Scope = "selected" | "layer" | "all";
type FileType = "binary" | "ascii";

const SCOPES: readonly { readonly value: Scope; readonly label: string }[] = [
  { value: "selected", label: "Selected objects" },
  { value: "layer", label: "The active layer" },
  { value: "all", label: "All visible layers" },
];

let lastType: FileType = "binary";

/** The selected objects' top-level objects on the active layer (a group's whole, when inside it). */
function selectedTops(): Set<string> {
  const doc = store.session?.doc;
  const out = new Set<string>();
  if (!doc) return out;
  for (const id of store.selection) {
    let o = doc.object(id);
    while (o?.parentId) o = doc.object(o.parentId);
    if (o && o.layerId === store.activeLayerId) out.add(o.id);
  }
  return out;
}

/** The meshes `scope` takes, with what to say when there are none. */
function meshesFor(scope: Scope, layers3d: ReadonlySet<string>): { meshes: Mesh3D[]; none: string } {
  const doc = withoutHidden(store.session!.doc);
  const active = new Set(store.activeLayerId ? [store.activeLayerId] : []);
  if (scope === "all") return { meshes: stlMeshes(doc, layers3d), none: "No 3D objects on the visible design layers." };
  const onLayer = stlMeshes(doc, active);
  if (scope === "layer") return { meshes: onLayer, none: "No 3D objects on the active layer." };
  const tops = selectedTops();
  if (tops.size === 0) return { meshes: onLayer, none: "Nothing is selected, and the active layer has no 3D objects." };
  return { meshes: onLayer.filter((m) => tops.has(m.objectId)), none: "None of the selected objects on the active layer is 3D." };
}

/** File > Export STL…: asks what to export and how, then downloads the .stl. */
export async function exportStlDialog(layers3d: ReadonlySet<string>): Promise<void> {
  const session = store.session;
  if (!session) return;
  const scope = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "Export" } },
    ...SCOPES.map((s) => h("option", { value: s.value, text: s.label })),
  );
  scope.value = selectedTops().size > 0 ? "selected" : "all";
  const type = h(
    "select",
    { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "File type" } },
    h("option", { value: "binary", text: "Binary" }),
    h("option", { value: "ascii", text: "ASCII" }),
  );
  type.value = lastType;
  const v = await showDialog<{ meshes: Mesh3D[]; type: FileType }>({
    title: "Export STL",
    okLabel: "Export",
    body: [
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "Export" }), scope),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "File type" }), type),
      h("p", {
        cls: "muted",
        text: "Selected objects are those on the active layer, or all of it when nothing there is selected. In millimetres, z up, as the 3D view draws the model: curved surfaces go as finely as it shows them. STL keeps no colours or textures.",
      }),
    ],
    check: () => {
      const { meshes, none } = meshesFor(scope.value as Scope, layers3d);
      if (meshes.length === 0) return { error: none, focus: scope };
      lastType = type.value as FileType;
      return { value: { meshes, type: lastType } };
    },
  });
  if (!v || store.session !== session) return;
  const name = store.fileName.replace(/\.(vwx|sta)$/i, "") || "drawing";
  try {
    const blob =
      v.type === "ascii"
        ? new Blob([exportStlAscii(v.meshes, name)], { type: "model/stl" })
        : new Blob([exportStlBinary(v.meshes) as BlobPart], { type: "model/stl" });
    downloadBlob(`${name}.stl`, blob);
  } catch (err) {
    toast(`STL export failed: ${errorMessage(err)}`);
  }
}
