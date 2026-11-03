// Navigation > Design Layers and Sheet Layers: each kind listed in layers()
// order with visibility cycling, inline rename, drag to reorder, a context menu
// (for a design layer, its story too), and create / delete (and, for design
// layers, scale and elevation) controls.

import type { LayerInfo } from "../../core/index.ts";
import { attempt, setActiveLayer } from "../commands.ts";
import { editInline, h } from "../dom.ts";
import { extensionLayerMarks, extensionLayerRows } from "../ext.ts";
import { openContextMenu, type Row } from "../menu.ts";
import { DISPLAY_MODES } from "../displayModes.ts";
import { confirmDialog } from "../menubar.ts";
import { store, type DisplayMode } from "../state.ts";
import { toast } from "../toast.ts";
import { formatLengthValue, lengthSuffix, parseLength } from "../units.ts";
import { NEXT_VISIBILITY, freeName, visibilityButton, visibilityRows } from "./common.ts";
import { storyRows } from "./stories.ts";

/** layer id being dragged, shared by all rows */
let dragId: string | null = null;

/**
 * "Layer options" / "Class options" row: a select bound to store.layerMode or
 * store.classMode. Changing it stores the mode and emits "display"; the select
 * also follows the store, so a restored saved view updates it.
 */
export function displayOptionsRow(key: "layerMode" | "classMode", noun: "layer" | "class"): HTMLElement {
  const select = h(
    "select",
    { cls: "select", attrs: { "aria-label": `${noun} options`, title: `How other ${noun}s are shown` } },
    ...DISPLAY_MODES.map((m) => h("option", { text: m.label, attrs: { value: m.value } })),
  );
  select.value = store[key];
  select.addEventListener("change", () => {
    store[key] = select.value as DisplayMode;
    store.emit("display");
  });
  store.on("display", () => {
    select.value = store[key];
  });
  const text = noun === "layer" ? "Layer options" : "Class options";
  return h("div", { cls: "toolbar sub display-options" }, h("span", { cls: "muted", text }), select);
}

/** Fills `root` with the list and controls for the layers of one kind. */
export function mountLayers(root: HTMLElement, kind: LayerInfo["kind"]): void {
  const design = kind === "design";
  const btnNew = h("button", {
    cls: "btn",
    text: design ? "+ Design layer" : "+ Sheet layer",
    title: design ? "New design layer (1:50)" : "New sheet layer",
  });
  const btnDelete = h("button", {
    cls: "btn danger",
    text: "Delete",
    title: design ? "Delete the active design layer" : "Delete the active sheet layer",
  });
  const scale = h("input", {
    cls: "num",
    attrs: { type: "number", min: "0.001", step: "any", "aria-label": "Scale of the active design layer" },
  });
  const elevation = h("input", {
    cls: "num",
    attrs: { type: "text", "aria-label": "Elevation of the active design layer", spellcheck: "false" },
  });
  const elevationUnit = h("span", { cls: "muted" });
  const scaleRow = h(
    "div",
    { cls: "toolbar sub" },
    h("span", { cls: "muted", text: "Scale" }),
    h("span", { cls: "scale-field" }, h("span", { text: "1:" }), scale),
    h("span", { cls: "muted", text: "Elevation" }),
    h("span", { cls: "scale-field" }, elevation, elevationUnit),
  );
  const list = h("div", { cls: "list" });
  root.replaceChildren(
    ...(design ? [displayOptionsRow("layerMode", "layer")] : []),
    h("div", { cls: "toolbar" }, btnNew, btnDelete),
    ...(design ? [scaleRow] : []),
    list,
  );

  const render = (): void => {
    const s = store.session;
    const all = s ? s.doc.layers() : [];
    const layers = all.filter((l) => l.kind === kind);
    const active = layers.find((l) => l.id === store.activeLayerId);
    list.replaceChildren(...layers.map((l) => layerRow(l, l.id === active?.id, list, render)));
    if (layers.length === 0) list.append(h("div", { cls: "empty", text: design ? "No design layers" : "No sheet layers" }));
    btnNew.disabled = !s;
    btnDelete.disabled = !active || all.length <= 1;
    scale.disabled = !active;
    scale.value = active && active.kind === "design" ? String(active.scale) : "";
    const units = s?.doc.info.units;
    elevation.disabled = active?.elevation === undefined;
    elevation.value = active?.elevation === undefined ? "" : formatLengthValue(active.elevation, units);
    elevationUnit.textContent = lengthSuffix(units);
  };

  btnNew.addEventListener("click", () => newLayer(kind, list, render));
  btnDelete.addEventListener("click", () => {
    const layer = activeLayer();
    if (layer?.kind === kind) void deleteLayer(layer);
  });
  scale.addEventListener("change", () => {
    const layer = activeLayer();
    if (!layer || layer.kind !== "design") return;
    const v = Number(scale.value);
    if (!(v > 0)) {
      toast("Scale must be a positive number.", "info");
      scale.value = String(layer.scale);
      return;
    }
    attempt("Set scale", (s) => s.setLayerScale(layer.id, v));
  });
  elevation.addEventListener("change", () => {
    const layer = activeLayer();
    if (layer?.elevation === undefined) return;
    const units = store.session?.doc.info.units;
    // left as shown, it keeps its exact value (the field rounds it)
    if (elevation.value === formatLengthValue(layer.elevation, units)) return;
    const z = parseLength(elevation.value, units);
    if (z === null) {
      toast("Elevation takes a length.", "info");
      elevation.value = formatLengthValue(layer.elevation, units);
      return;
    }
    attempt("Set elevation", (s) => s.setLayerElevation(layer.id, z));
  });

  store.on(["session", "layer"], render);
  render();
}

function activeLayer(): LayerInfo | undefined {
  const s = store.session;
  if (!s || !store.activeLayerId) return undefined;
  return s.doc.layers().find((l) => l.id === store.activeLayerId);
}

function layerRow(layer: LayerInfo, active: boolean, list: HTMLElement, render: () => void): HTMLElement {
  const names = h("div", { cls: "names", title: "Double-click to rename" }, h("div", { cls: "name", text: layer.name }));
  if (layer.kind === "sheet") {
    names.append(h("div", { cls: "sub", text: layer.title || "Untitled sheet" }));
  }
  const vis = visibilityButton(layer.visibility, () =>
    attempt("Change visibility", (s) => s.setLayerVisibility(layer.id, NEXT_VISIBILITY[layer.visibility])),
  );
  const badge = h("span", {
    cls: layer.kind === "design" ? "badge" : "badge sheet",
    text: layer.kind === "design" ? `1:${layer.scale}` : "Sheet",
  });
  const count = h("span", { cls: "count", text: String(layer.objectCount), title: "Objects on this layer" });
  // what features say of the layer (who has it checked out, in a shared drawing)
  const marks = extensionLayerMarks(layer.id).map((m) => h("span", { cls: `layer-mark${m.cls ? ` ${m.cls}` : ""}`, html: m.html, title: m.title }));
  const grip = h("span", { cls: "grip", text: "⋮⋮", title: "Drag to reorder" });
  const row = h(
    "div",
    { cls: active ? "row layer-row active" : "row layer-row", draggable: true, attrs: { "data-id": layer.id } },
    grip,
    vis,
    names,
    ...marks,
    badge,
    count,
  );

  row.addEventListener("click", () => setActiveLayer(layer.id));
  names.addEventListener("dblclick", () => editLayer(names, layer, render));
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openContextMenu(layerMenu(layer, names, list, render), e.clientX, e.clientY);
  });

  row.addEventListener("dragstart", (e) => {
    dragId = layer.id;
    e.dataTransfer?.setData("text/plain", layer.id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    row.classList.add("dragging");
  });
  row.addEventListener("dragend", () => {
    dragId = null;
    row.classList.remove("dragging");
    clearDropMarks(row);
  });
  row.addEventListener("dragover", (e) => {
    if (dragId === null || dragId === layer.id) return;
    e.preventDefault();
    const after = isLowerHalf(e, row);
    row.classList.toggle("drop-after", after);
    row.classList.toggle("drop-before", !after);
  });
  row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after"));
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    const from = dragId;
    dragId = null;
    clearDropMarks(row);
    if (from === null || from === layer.id) return;
    reorder(from, layer.id, isLowerHalf(e, row));
  });
  return row;
}

/** A right-click on a layer's row. */
function layerMenu(layer: LayerInfo, names: HTMLElement, list: HTMLElement, render: () => void): Row[] {
  const s = store.session;
  return [
    { label: "Make Active", checked: () => store.activeLayerId === layer.id, run: () => setActiveLayer(layer.id) },
    "-",
    ...visibilityRows(layer.visibility, (v) => attempt("Change visibility", (x) => x.setLayerVisibility(layer.id, v))),
    "-",
    ...(layer.kind === "design" ? ([{ label: "Story", items: () => storyRows(layer) }, "-"] as const) : []),
    { label: "Rename", run: () => editLayer(names, layer, render) },
    { label: layer.kind === "design" ? "New Design Layer" : "New Sheet Layer", run: () => newLayer(layer.kind, list, render) },
    { label: "Duplicate", run: () => duplicateLayer(layer, list, render) },
    { label: "Delete", enabled: () => (s?.doc.layers().length ?? 0) > 1, run: () => void deleteLayer(layer) },
    ...withSeparator(extensionLayerRows(layer.id)),
  ];
}

function withSeparator(rows: Row[]): Row[] {
  return rows.length ? ["-", ...rows] : [];
}

function editLayer(host: HTMLElement, layer: LayerInfo, render: () => void): void {
  const values = layer.kind === "sheet" ? [layer.name, layer.title] : [layer.name];
  editInline(host, values, (vals) => {
    if (vals) {
      const name = vals[0] ?? "";
      if (!name) {
        toast("A layer needs a name.", "info");
      } else if (layer.kind === "sheet") {
        attempt("Rename layer", (s) => s.renameLayer(layer.id, name, vals[1] ?? ""));
      } else {
        attempt("Rename layer", (s) => s.renameLayer(layer.id, name));
      }
    }
    render();
  });
}

function isLowerHalf(e: DragEvent, row: HTMLElement): boolean {
  const r = row.getBoundingClientRect();
  return e.clientY > r.top + r.height / 2;
}

function clearDropMarks(row: HTMLElement): void {
  row.parentElement?.querySelectorAll(".drop-before, .drop-after").forEach((n) => {
    n.classList.remove("drop-before", "drop-after");
  });
}

function reorder(from: string, to: string, after: boolean): void {
  const s = store.session;
  if (!s) return;
  const ids = s.doc
    .layers()
    .map((l) => l.id)
    .filter((id) => id !== from);
  const idx = ids.indexOf(to);
  if (idx < 0) return;
  ids.splice(after ? idx + 1 : idx, 0, from);
  attempt("Reorder layers", (x) => x.reorderLayers(ids));
}

/** Create a layer with a free default name, make it active and start renaming it. */
function newLayer(kind: "design" | "sheet", list: HTMLElement, render: () => void): void {
  const s = store.session;
  if (!s) return;
  const name = freeName(kind === "design" ? "Design Layer" : "Sheet");
  const r = attempt("Create layer", (x) => x.createLayer(name, kind, kind === "design" ? 50 : 1));
  if (!r) return;
  setActiveLayer(r.value);
  renameNew(r.value, list, render);
}

/** Starts editing a layer's name in its row once the list shows it. */
function renameNew(id: string, list: HTMLElement, render: () => void): void {
  requestAnimationFrame(() => {
    const layer = store.session?.doc.layers().find((l) => l.id === id);
    const host = list.querySelector<HTMLElement>(`[data-id="${id}"] .names`);
    if (!layer || !host) return;
    host.scrollIntoView({ block: "nearest" });
    editLayer(host, layer, render);
  });
}

/** A copy of the layer with everything on it, just after it; made active, with its name to edit as a new layer's is. */
function duplicateLayer(layer: LayerInfo, list: HTMLElement, render: () => void): void {
  const r = attempt("Duplicate layer", (x) => x.duplicateLayer(layer.id, freeName(layer.name)));
  if (!r) return;
  setActiveLayer(r.value);
  renameNew(r.value, list, render);
}

async function deleteLayer(layer: LayerInfo): Promise<void> {
  const s = store.session;
  if (!s) return;
  if (s.doc.layers().length <= 1) {
    toast("A drawing needs at least one layer.", "info");
    return;
  }
  if (!(await confirmDialog("Delete layer", `Delete layer "${layer.name}" and everything on it?`, "Delete"))) return;
  attempt("Delete layer", (x) => x.deleteLayer(layer.id));
}
