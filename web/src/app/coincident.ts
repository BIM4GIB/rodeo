// Select Coincident Objects…, on the drawing's right-click menu over an object as Vectorworks has
// it: the objects a click could pick at that point (a group for what is inside it), topmost first,
// each with its place in the stacking order (1 at the back), kind and name. Rows picked in the list
// are selected on the drawing as they are picked; OK keeps them, Cancel puts back the selection
// before, and a double-click selects the one row and closes. The Coincident Selection key opens it
// too: J held while the Selection tool clicks the drawing.

import { h } from "./dom.ts";
import { pickAllObjects } from "./hittest.ts";
import { showDialog } from "./menubar.ts";
import { setActiveLayer, setSelection } from "./commands.ts";
import type { Scene } from "./scene.ts";
import { store } from "./state.ts";
import type { View } from "./view.ts";
import type { Pt } from "../core/index.ts";

/** What a click at `screen` could select there, topmost first: each object under it as a click picks it, once. */
export function coincidentAt(scene: Scene, view: View, screen: Pt): string[] {
  const active = store.activeLayerId;
  if (!active) return [];
  const scope = store.editGroupId;
  const layers = scope ? [active] : scene.pickableLayers(active);
  const hits = pickAllObjects(scene, view, screen, layers, scope ? (o) => scene.unitOf(o, scope) !== null : undefined);
  const out: string[] = [];
  for (const hit of hits) {
    const unit = scene.pickedUnitOf(hit, scope);
    if (unit !== null && !out.includes(unit)) out.push(unit);
  }
  return out;
}

/** The row for an object: its place among the objects beside it (1 at the back), its kind and its name. */
function rowText(id: string): string {
  const doc = store.session?.doc;
  const o = doc?.object(id);
  if (!doc || !o) return id;
  const siblings = doc.objects(o.layerId).filter((x) => x.parentId === o.parentId);
  const place = siblings.findIndex((x) => x.id === id) + 1;
  return `${place}  ${o.typeName}${o.name ? `  "${o.name}"` : ""}`;
}

/** Selects `ids` (those on the layer of the first, which is made active). */
function select(ids: readonly string[]): void {
  const doc = store.session?.doc;
  const first = ids.length ? doc?.object(ids[0]) : null;
  if (!doc || !first) {
    setSelection([]);
    return;
  }
  if (first.layerId !== store.activeLayerId) setActiveLayer(first.layerId);
  setSelection(ids.filter((id) => doc.object(id)?.layerId === first.layerId));
}

/** Select Coincident Objects…: picks among `ids`, the objects under the pointer, topmost first. */
export async function selectCoincidentDialog(ids: readonly string[]): Promise<void> {
  if (ids.length < 2) return;
  const before = [...store.selection];
  const beforeLayer = store.activeLayerId;
  const list = h(
    "select",
    { cls: "menu-dialog-input coincident-list", attrs: { multiple: "", size: String(Math.min(12, Math.max(4, ids.length))), "aria-label": "Objects" } },
    ...ids.map((id) => h("option", { value: id, text: rowText(id) })),
  );
  const chosen = (): string[] => [...list.selectedOptions].map((o) => o.value);
  // the top one picked to start, as a click there picks it
  list.options[0].selected = true;
  list.addEventListener("change", () => select(chosen()));
  list.addEventListener("dblclick", () => list.form?.requestSubmit());
  const r = await showDialog<string[]>({
    title: "Select",
    okLabel: "OK",
    body: [h("p", { cls: "muted", text: "The objects at that point, topmost first. Those picked are selected." }), list],
    check: () => (chosen().length ? { value: chosen() } : { error: "Pick an object.", focus: list }),
  });
  if (r) {
    select(r);
    return;
  }
  if (beforeLayer && beforeLayer !== store.activeLayerId) setActiveLayer(beforeLayer);
  setSelection(before);
}

/** Whether J, the Coincident Selection key, is held down. */
let held = false;

function typing(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

/**
 * The Coincident Selection key, as Vectorworks keys it: with J held, a click of the Selection tool
 * on the drawing opens Select on the objects under it, or selects the one there is (or none).
 */
export function installCoincidentKey(canvas: HTMLCanvasElement, scene: Scene, view: View): void {
  window.addEventListener("keydown", (e) => {
    if (e.code === "KeyJ" && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)) held = true;
  });
  window.addEventListener("keyup", (e) => {
    if (e.code === "KeyJ") held = false;
  });
  window.addEventListener("blur", () => (held = false));
  // on the canvas's parent, as it captures, so the tool never sees the click
  canvas.parentElement?.addEventListener(
    "pointerdown",
    (e) => {
      if (!held || e.target !== canvas || e.button !== 0 || store.tool !== "select" || store.view3d || !store.session) return;
      e.preventDefault();
      e.stopPropagation();
      const box = canvas.getBoundingClientRect();
      const ids = coincidentAt(scene, view, { x: e.clientX - box.left, y: e.clientY - box.top });
      if (ids.length > 1) void selectCoincidentDialog(ids);
      else select(ids);
    },
    true,
  );
}
