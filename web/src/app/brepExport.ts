// File > Export > Export STEP (3D only)… and Export IGES (3D only)…, as Vectorworks' Export Options has
// them: Export Solid as Trimmed Surfaces, then the 3D objects on the design layers the 3D view shows as
// a .stp file (export/step.ts) or an .igs file (export/iges.ts).

import { exportIges } from "../export/iges.ts";
import { exportStep } from "../export/step.ts";
import { modelOf } from "../export/scene3d.ts";
import { nextPaint } from "./dom.ts";
import { appContext } from "./ext.ts";
import { downloadBlob } from "./fileio.ts";
import { withoutHidden } from "./hiddenObjects.ts";
import { showLoading } from "./loading.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

const FORMATS = {
  step: { name: "STEP", ext: "stp", type: "model/step", write: exportStep },
  iges: { name: "IGES", ext: "igs", type: "model/iges", write: exportIges },
} as const;

export async function exportBrepDialog(format: keyof typeof FORMATS): Promise<void> {
  const f = FORMATS[format];
  const session = store.session;
  const ctx = appContext();
  if (!session || !ctx) return;
  let layers = ctx.scene.drawnLayers(store.activeLayerId).filter((l) => l.kind === "design");
  if (!layers.length) layers = ctx.scene.layers().filter((l) => l.kind === "design" && l.visibility !== "hidden");
  const shown = new Set(layers.map((l) => l.id));
  const doc = withoutHidden(session.doc);
  if (!doc.model3d().some((m) => shown.has(m.layerId) && m.triangles.length > 0)) {
    toast("No 3D objects on the visible design layers.", "info");
    return;
  }
  const v = await toolPrefs(
    "Export Options",
    [{ kind: "check", key: "trimmed", label: "Export Solid as Trimmed Surfaces", value: false }],
    "Each object's flat faces as a solid where they close round it, else as surfaces, in millimetres; with Trimmed Surfaces every face is a body of its own. Curved surfaces go flat-faceted, as the 3D view draws them.",
  );
  if (!v || store.session !== session) return;
  const done = showLoading(`Writing the ${f.name} file…`);
  try {
    await nextPaint();
    const name = store.fileName.replace(/\.(vwx|sta)$/i, "") || "drawing";
    const r = f.write(modelOf(doc, shown), v.flag("trimmed"), store.fileName);
    downloadBlob(`${name}.${f.ext}`, new Blob([r.text], { type: f.type }));
    const bodies = [r.solids ? `${r.solids} ${r.solids === 1 ? "solid" : "solids"}` : "", r.surfaces ? `${r.surfaces} ${r.surfaces === 1 ? "surface body" : "surface bodies"}` : ""].filter(Boolean).join(" and ");
    toast(`${f.name} file written: ${bodies}, ${r.faces} faces.`, "info");
  } catch (err) {
    toast(`${f.name} export failed: ${errorMessage(err)}`);
  } finally {
    done();
  }
}
