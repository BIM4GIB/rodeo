// Site Planning's Massing Model tool: an outline, a rectangle or a polygon, and the settings dialog the first time it's
// used in a drawing. What it makes is in massingModel.ts.

import type { Pt, VwxDocument } from "../../core/index.ts";
import { massingDialog, newMassingSettings, placeMassingModel, type MassingSettings } from "../massingModel.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { OutlineTool } from "./planning.ts";

/** the settings last used, for Create Objects from Shapes too */
let settings: MassingSettings = newMassingSettings();
export const massingSettings = (): MassingSettings => settings;

export class MassingModelTool extends OutlineTool {
  readonly id = "massingmodel";
  protected readonly modeLabel = "Outline";
  private asked: VwxDocument | null = null;

  async preferences(): Promise<void> {
    const k = await massingDialog(settings);
    if (!k) return;
    settings = k;
    this.asked = store.session?.doc ?? null;
  }

  protected made(corners: Pt[]): void {
    void this.place(corners);
  }

  private async place(corners: Pt[]): Promise<void> {
    const layerId = store.activeLayerId;
    const session = store.session;
    if (!layerId || !session) return;
    if (corners.length < 3) {
      toast("A massing model takes an outline of three corners or more.", "error");
      return;
    }
    if (this.asked !== session.doc) {
      const k = await massingDialog(settings);
      if (!k || store.session !== session) return;
      settings = k;
      this.asked = session.doc;
    }
    placeMassingModel(layerId, corners, settings);
  }
}
