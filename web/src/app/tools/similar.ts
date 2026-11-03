// Select Similar tool (Basic): Vectorworks' tool, which selects the objects like the one clicked, as
// Select Similar Preferences (the mode bar's preferences) says they must match. Select any Object
// (1) picks among the edit scope's objects: the active layer's, or the group's being edited; Current
// Selection (2) picks among the objects selected before the click, keeping only those like it.
// Shift adds what it picks to the selection.

import { setSelection } from "../commands.ts";
import { pickObject } from "../hittest.ts";
import { hasCriteria, similarKey, similarPrefsDialog, similarScope } from "../selectSimilar.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";

type Mode = "any" | "selection";

const MODES: readonly { id: Mode; label: string }[] = [
  { id: "any", label: "Select any Object" },
  { id: "selection", label: "Current Selection" },
];

export class SelectSimilarTool extends BaseTool {
  readonly id = "selectsimilar";
  readonly cursor = "pointer";

  private mode: Mode = "any";

  modes(): readonly ToolModes[] {
    return [{ options: MODES.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.mode }];
  }

  setMode(id: string): void {
    const m = MODES.find((x) => x.id === id);
    if (m) this.mode = m.id;
  }

  hint(): string {
    const where = this.mode === "any" ? "every object like it" : "the selected objects like it";
    return `Click an object to select ${where} · Shift adds to the selection · 1 any object, 2 current selection · preferences set what must match`;
  }

  async preferences(): Promise<void> {
    await similarPrefsDialog();
  }

  down(p: PointerInfo): void {
    const { scene, view } = this.env;
    const doc = store.session?.doc;
    const layerId = store.activeLayerId;
    if (!doc || !layerId || !hasCriteria()) return;
    const hit = pickObject(scene, view, p.screen, [layerId]);
    const unit = hit ? scene.pickedUnitOf(hit, store.editGroupId) : null;
    const obj = unit ? doc.object(unit) : null;
    if (!obj) return;
    const before = new Set(store.selection);
    if (this.mode === "selection" && before.size === 0) {
      toast("Select the objects to choose from first; Current Selection picks among them.", "info");
      return;
    }
    const key = similarKey(doc, obj);
    const pool = similarScope(doc).filter((o) => this.mode === "any" || before.has(o.id));
    const like = pool.filter((o) => similarKey(doc, o) === key).map((o) => o.id);
    const next = p.shift ? new Set([...before, ...like]) : new Set(like);
    setSelection(next);
    toast(`Selected ${like.length} ${like.length === 1 ? "object" : "objects"} like the one clicked${p.shift ? `, ${next.size} in all` : ""}.`, "info");
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }
}
