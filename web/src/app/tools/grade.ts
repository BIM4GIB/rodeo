// Site Planning's Grade tool: two clicks and Grade Settings make a grade object; Edit Elevation changes one by a
// click at its end; Update brings them all up to date; Preferences holds what they share (grade.ts).

import type { Pt } from "../../core/index.ts";
import { editElevationAt, gradePreferences, placeGrade, updateGrades } from "../grade.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";
import { TwoPointTool, type Part } from "./detailing.ts";

const MODES = [
  { id: "standard", label: "Standard Insertion", key: "1" },
  { id: "edit", label: "Edit Elevation", key: "2" },
  { id: "update", label: "Update", key: "3" },
] as const;

export class GradeTool extends TwoPointTool {
  readonly id = "grade";
  readonly cursor = "crosshair";
  protected readonly label = "Grade";
  private mode: "standard" | "edit" = "standard";

  modes(): readonly ToolModes[] {
    return [{ label: "Grade", options: MODES.map((m) => ({ id: m.id, label: m.label, key: m.key })), active: this.mode }];
  }

  setMode(id: string): void {
    if (id === "update") {
      updateGrades();
      return;
    }
    if (id === "standard" || id === "edit") {
      this.mode = id;
      this.cancel();
    }
  }

  hint(): string {
    return this.mode === "edit" ? "Click at the start or end of a grade" : `Grade: ${super.hint()}`;
  }

  async preferences(): Promise<void> {
    await gradePreferences();
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (mode) {
      this.setMode(mode);
      return true;
    }
    return super.key(e);
  }

  down(p: PointerInfo): void {
    if (this.mode === "edit") {
      void editElevationAt(p.pos, 8 / this.env.view.scale).then((found) => {
        if (!found) toast("Click at the start or end of a grade object.", "info");
      });
      return;
    }
    super.down(p);
  }

  protected shapes(a: Pt, b: Pt): Part[] | null {
    return Math.hypot(b.x - a.x, b.y - a.y) > 0 ? [{ kind: "line", a, b } as Part] : null;
  }

  protected add(_pieces: readonly (readonly Part[])[], a: Pt, b: Pt): void {
    const layerId = store.activeLayerId;
    if (layerId) void placeGrade(layerId, a, b);
  }
}
