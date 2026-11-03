// Site model contour editing, from AEC > Terrain's Edit Existing Contours and Edit Proposed Contours. Pick Contour makes
// an editable copy of the contour clicked, for Reshape or a move; the Site Model Contour mode draws a new one, at a
// locked elevation or at the height of the ground where it starts. Each is a site modifier with its record's Elevation,
// taken in when the site model is updated, and the ground goes back when it's deleted.

import type { Pt } from "../../core/index.ts";
import { attempt, setSelection } from "../commands.ts";
import { addSurfaceEdit, modifierObject, setSiteEditOnExisting, siteEditOnExisting, siteEditSurface, siteContourAt } from "../siteModel.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import { appContext } from "../ext.ts";
import { modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import { OutlineTool } from "./planning.ts";

const SURFACES = [
  { id: "existing", label: "Existing Contours" },
  { id: "proposed", label: "Proposed Contours" },
];
const ACTIONS = [
  { id: "pick", label: "Pick Contour", key: "1" },
  { id: "draw", label: "Site Model Contour", key: "2" },
];
const LOCK = [
  { id: "locked", label: "Lock Elevation" },
  { id: "ground", label: "Elevation from Click" },
];

/** How close to a contour a click counts, px. */
const PICK_PX = 10;

export class SiteContourTool extends OutlineTool {
  readonly id = "sitecontour";
  protected readonly modeLabel = "Outline";
  private drawing = false;
  private locked = false;
  private elevation = 0;

  constructor(env: ConstructorParameters<typeof OutlineTool>[0]) {
    super(env);
    super.setMode("polygon");
  }

  modes(): readonly ToolModes[] {
    const groups: ToolModes[] = [
      { label: "Surface", options: SURFACES, active: siteEditOnExisting() ? "existing" : "proposed" },
      { label: "Tool", options: ACTIONS, active: this.drawing ? "draw" : "pick" },
    ];
    if (this.drawing) groups.push({ label: "Elevation", options: LOCK, active: this.locked ? "locked" : "ground" });
    return groups;
  }

  setMode(id: string): void {
    if (id === "existing" || id === "proposed") setSiteEditOnExisting(id === "existing");
    else if (id === "pick" || id === "draw") this.drawing = id === "draw";
    else if (id === "locked" || id === "ground") this.locked = id === "locked";
  }

  hint(): string {
    const which = siteEditOnExisting() ? "existing" : "proposed";
    return this.drawing ? `Site Model Contour on the ${which} surface: ${super.hint()}` : `Click a contour of the ${which} surface to edit it · 1–2 mode`;
  }

  async preferences(): Promise<void> {
    const v = await toolPrefs(
      "Site Model Contour Preferences",
      [{ kind: "length", key: "elevation", label: "Elevation", value: this.elevation, zero: true, signed: true }],
      "For Lock Elevation; otherwise a new contour takes the height of the ground where it starts.",
    );
    if (v) this.elevation = v.num("elevation");
  }

  down(p: PointerInfo): void {
    if (this.drawing) {
      super.down(p);
      return;
    }
    const doc = store.session?.doc;
    const on = doc ? siteEditSurface(doc, p.pos) : null;
    const found = on ? siteContourAt(on.model, on.surface, p.pos, PICK_PX / this.env.view.scale) : null;
    if (!on || !found) {
      toast("Click on a contour of the site model.", "error");
      return;
    }
    const r = attempt("Edit Contour", (s) =>
      s.batch(() =>
        modifierObject(s, on.model.layerId, found.points, {
          kind: "contour",
          applyTo: siteEditOnExisting() ? "Existing" : "Proposed",
          elevation: found.level,
          useSurface: false,
          slope: 0,
          direction: 0,
          options: { old: [...found.points] },
        }),
      ),
    );
    if (!r) return;
    setSelection([r.value]);
    appContext()?.setTool("reshape");
    toast("Reshape the contour or move it, then update the site model. Delete it to take the edit back.", "info");
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  protected made(corners: Pt[]): void {
    if (corners.length < 2) return;
    const doc = store.session?.doc;
    const on = doc ? siteEditSurface(doc, corners[0]) ?? siteEditSurface(doc) : null;
    if (!on) {
      toast("Draw it on a site model.", "error");
      return;
    }
    const level = this.locked ? this.elevation : (on.heightAt(corners[0].x, corners[0].y) ?? this.elevation);
    addSurfaceEdit("Site Model Contour", on.model.layerId, corners, { kind: "contour", applyTo: siteEditOnExisting() ? "Existing" : "Proposed", elevation: level, useSurface: false, slope: 0, direction: 0 });
  }
}
