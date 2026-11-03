// Visibility tool (Basic): Vectorworks' Visibility tool, which shows, grays or hides the class or
// the layer of the object clicked. "Applies to" picks Class (1) or Layer (2); "Visibility" picks
// Show (3), Gray (4) or Hide (5). The class is that of the object under the pointer (its leaf
// object, not its group), on any layer drawn. Option (Alt) click sets every other class, or every
// other design layer, instead: hiding the others leaves the one clicked alone on screen. The
// active layer stays shown, as it is the one drawn into. Each click is one undo step.

import type { ObjectInfo, Visibility } from "../../core/index.ts";
import { attempt } from "../commands.ts";
import { pickObject } from "../hittest.ts";
import type { Scene } from "../scene.ts";
import { store } from "../state.ts";
import { toast } from "../toast.ts";
import { ALT_KEY, BaseTool, modeForKey, type PointerInfo, type ToolModes } from "../tools.ts";

type Target = "class" | "layer";

const TARGETS: readonly { id: Target; label: string }[] = [
  { id: "class", label: "Class" },
  { id: "layer", label: "Layer" },
];
const ACTIONS: readonly { id: Visibility; label: string; verb: string }[] = [
  { id: "visible", label: "Show", verb: "shown" },
  { id: "grayed", label: "Gray", verb: "grayed" },
  { id: "hidden", label: "Hide", verb: "hidden" },
];

/** Layers a click picks from: the active one, then the others drawn, top of the stack first. */
function drawnLayerIds(scene: Scene): string[] {
  const active = store.activeLayerId;
  if (!active) return [];
  if (store.editGroupId) return [active];
  const others = scene
    .drawnLayers(active)
    .filter((l) => l.id !== active)
    .map((l) => l.id)
    .reverse();
  return [active, ...others];
}

export class VisibilityTool extends BaseTool {
  readonly id = "visibility";
  readonly cursor = "pointer";

  private target: Target = "class";
  private action: Visibility = "hidden";

  modes(): readonly ToolModes[] {
    return [
      { label: "Applies to", options: TARGETS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1) })), active: this.target },
      {
        label: "Visibility",
        options: ACTIONS.map((m, i) => ({ id: m.id, label: m.label, key: String(i + 1 + TARGETS.length) })),
        active: this.action,
      },
    ];
  }

  setMode(id: string): void {
    const target = TARGETS.find((m) => m.id === id);
    if (target) this.target = target.id;
    const action = ACTIONS.find((m) => m.id === id);
    if (action) this.action = action.id;
  }

  hint(): string {
    const verb = ACTIONS.find((m) => m.id === this.action)?.label.toLowerCase() ?? "hide";
    return `Click an object to ${verb} its ${this.target} · ${ALT_KEY} every other ${this.target} · 1–2 class or layer · 3–5 show, gray, hide`;
  }

  down(p: PointerInfo): void {
    const { scene, view } = this.env;
    if (!scene.document) return;
    const hit = pickObject(scene, view, p.screen, drawnLayerIds(scene));
    if (!hit) return;
    if (this.target === "class") this.setClass(hit, p.alt);
    else this.setLayer(hit, p.alt);
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  private setClass(hit: ObjectInfo, others: boolean): void {
    const s = store.session;
    if (!s) return;
    const v = this.action;
    const indices = others
      ? s.doc.classes().filter((c) => c.index !== hit.classIndex && c.visibility !== v).map((c) => c.index)
      : [hit.classIndex];
    const name = hit.className || "None";
    if (indices.length === 0) {
      toast(`Every class but "${name}" is ${verbOf(v)} already.`, "info");
      return;
    }
    const done = attempt("Change visibility", (x) => x.batch(() => indices.forEach((i) => x.setClassVisibility(i, v))));
    if (done) toast(others ? `Classes but "${name}" ${verbOf(v)}.` : `Class "${name}" ${verbOf(v)}.`, "info");
  }

  private setLayer(hit: ObjectInfo, others: boolean): void {
    const s = store.session;
    if (!s) return;
    const v = this.action;
    const active = store.activeLayerId;
    const layer = s.doc.layers().find((l) => l.id === hit.layerId);
    if (!layer) return;
    if (!others && v !== "visible" && layer.id === active) {
      toast("The active layer stays shown; make another layer active to hide or gray this one.", "info");
      return;
    }
    const ids = others
      ? s.doc
          .layers()
          .filter((l) => l.kind === "design" && l.id !== layer.id && (v === "visible" || l.id !== active) && l.visibility !== v)
          .map((l) => l.id)
      : [layer.id];
    if (ids.length === 0) {
      toast(`No other layer to make ${verbOf(v)}.`, "info");
      return;
    }
    const done = attempt("Change visibility", (x) => x.batch(() => ids.forEach((id) => x.setLayerVisibility(id, v))));
    if (done) toast(others ? `Layers but "${layer.name}" ${verbOf(v)}.` : `Layer "${layer.name}" ${verbOf(v)}.`, "info");
  }
}

function verbOf(v: Visibility): string {
  return ACTIONS.find((m) => m.id === v)?.verb ?? v;
}
