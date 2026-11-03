// Modify > Simplify Mesh…, as Vectorworks has it: the selected meshes, and those inside selected
// groups, plug-in objects (an IFC entity's) and symbols, drawn with fewer faces. Quality sets
// about how many faces each keeps (lower takes more away, flat parts first; borders, creases and
// where differently drawn faces meet keep their shape). Preview works out how many faces the
// meshes would have; it doesn't show them changed. Faces are counted as triangles (a face of four
// corners is two), and every face left is one. One undo step.

import { attempt } from "./commands.ts";
import { h } from "./dom.ts";
import { showDialog } from "./menubar.ts";
import { isDerivedId } from "./scene.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";

const LABEL = "Simplify Mesh";
/** the Quality last chosen, in percent */
let lastQuality = 50;

/** The selected objects of the edit scope Simplify Mesh looks in. */
function selectedIds(): string[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || !store.selection.size) return [];
  const scope = store.editGroupId;
  return s.doc
    .objects(layerId)
    .filter((o) => store.selection.has(o.id) && o.parentId === scope && !isDerivedId(o.id))
    .map((o) => o.id);
}

function meshesSelected(): { meshes: number; triangles: number } {
  const ids = selectedIds();
  if (!ids.length || !store.session) return { meshes: 0, triangles: 0 };
  try {
    return store.session.meshTriangles(ids);
  } catch {
    return { meshes: 0, triangles: 0 };
  }
}

export function canSimplifyMesh(): boolean {
  return meshesSelected().meshes > 0;
}

const faces = (n: number): string => n.toLocaleString("en-US");

export async function simplifyMeshDialog(): Promise<void> {
  const ids = selectedIds();
  const found = meshesSelected();
  if (!found.meshes || !store.session) {
    toast("Select a mesh, or a group, symbol or plug-in object holding meshes, to simplify.", "info");
    return;
  }
  const quality = h("input", { cls: "prefs-range", attrs: { type: "range", min: "1", max: "100", step: "1", "aria-label": "Quality" } });
  quality.value = String(lastQuality);
  const readout = h("span", { cls: "prefs-readout" });
  const simplified = h("span", { cls: "prefs-readout", attrs: { "aria-label": "Simplified number of faces", style: "width: auto" } });
  const sync = (): void => {
    readout.textContent = `${quality.value}%`;
    simplified.textContent = "–";
  };
  quality.addEventListener("input", sync);
  sync();
  const preview = h("button", { cls: "btn", text: "Preview", attrs: { type: "button" } });
  preview.addEventListener("click", () => {
    try {
      const r = store.session?.simplifyMeshes(ids, Number(quality.value) / 100, true);
      if (r) simplified.textContent = faces(r.after);
    } catch (err) {
      simplified.textContent = errorMessage(err);
    }
  });
  // a label only round the slider: one round the Preview button would press it from its text
  const row = (tag: "label" | "div", label: string, ...control: Node[]): HTMLElement =>
    h(tag, { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: label }), ...control);
  const keep = await showDialog<number>({
    title: LABEL,
    okLabel: "OK",
    body: [
      row("label", "Quality", quality, readout),
      row("div", "Original number of faces", h("span", { cls: "prefs-readout", text: faces(found.triangles), attrs: { "aria-label": "Original number of faces", style: "width: auto" } })),
      row("div", "Simplified number of faces", simplified, preview),
      h("p", {
        cls: "muted",
        text:
          `${found.meshes === 1 ? "1 mesh" : `${found.meshes} meshes`}. Lower quality takes more faces away, flat parts first; borders, creases and where faces drawn differently meet keep their shape. ` +
          "Faces are counted as triangles (a face of four corners is two), and every face left is one.",
      }),
    ],
    check: () => ({ value: Number(quality.value) }),
  });
  if (keep === null) return;
  lastQuality = keep;
  const r = attempt(LABEL, (s) => s.simplifyMeshes(ids, keep / 100));
  if (!r) return;
  const { before, after, simplified: done, same, skipped } = r.value;
  const left = [
    same ? `${same === 1 ? "1 mesh" : `${same} meshes`} had nothing to take away` : "",
    skipped ? `${skipped === 1 ? "1 mesh" : `${skipped} meshes`} Rodeo can't read whole (or whose UV map it doesn't know) stayed as ${skipped === 1 ? "it was" : "they were"}` : "",
  ].filter(Boolean);
  toast(
    done
      ? `Simplified ${done === 1 ? "1 mesh" : `${done} meshes`}: ${faces(before)} faces down to ${faces(after)}.${left.length ? ` ${left.join("; ")}.` : ""}`
      : `No mesh was simplified: ${left.join("; ") || "nothing to take away"}.`,
    "info",
  );
}
