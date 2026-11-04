// Navigation > Views: named snapshots of the drawing view (centre and scale),
// the active layer and class, the layer and class options and, when the entry's
// "Visibility" box is ticked, the visibility of every layer and class. A view saved
// while the 3D view shows keeps its camera too, and opens in 3D; one saved in 2D
// opens in 2D. Saved per file name in localStorage.

import type { ClassInfo, EditSession, LayerInfo, Vec3, Visibility } from "../../core/index.ts";
import { paperScale, type PdfView } from "../../export/pdf.ts";
import { attempt, setActiveClass, setActiveLayer } from "../commands.ts";
import { editInline, h } from "../dom.ts";
import { appContext } from "../ext.ts";
import { glide } from "../glide.ts";
import { graysOthers, setViz, store, type DisplayMode } from "../state.ts";
import { toast } from "../toast.ts";
import type { View } from "../view.ts";
import { DISPLAY_MODES } from "../displayModes.ts";

const STORAGE_PREFIX = "openvwx.views.";
/** how long a single click waits for a second one (a double-click renames instead of opening) */
const DOUBLE_CLICK_WAIT_MS = 250;

interface SavedView {
  name: string;
  cx: number;
  cy: number;
  scale: number;
  activeLayerId: string | null;
  activeClassIndex: number;
  layerMode: DisplayMode;
  classMode: DisplayMode;
  /** the "Visibility" box: layer and class visibility is restored with this view */
  restoreVisibility: boolean;
  /** visibility of each layer at save time, by layer id */
  layers: Record<string, Visibility>;
  /** visibility of each class at save time, by class index */
  classes: Record<string, Visibility>;
  /** the 3D view's camera, for a view saved while it showed */
  camera?: SavedCamera;
}

interface SavedCamera {
  readonly position: Vec3;
  readonly target: Vec3;
  /** the angle up the view, degrees */
  readonly fov: number;
  /** the orthogonal view's half height, mm */
  readonly half: number;
  readonly projection: "perspective" | "orthogonal";
  /** the 3D view's width over its height */
  readonly aspect: number;
}

/** A saved view's camera as a walkthrough takes it: eye, look-to point and angle across. */
export interface ViewCamera {
  readonly name: string;
  readonly eye: Vec3;
  readonly target: Vec3;
  /** degrees */
  readonly angle: number;
}

function parseCamera(raw: unknown): SavedCamera | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  const vec = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
  const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
  if (!vec(r.position) || !vec(r.target) || !positive(r.fov) || !positive(r.half) || !positive(r.aspect)) return undefined;
  if (r.projection !== "perspective" && r.projection !== "orthogonal") return undefined;
  return { position: r.position, target: r.target, fov: r.fov, half: r.half, projection: r.projection, aspect: r.aspect };
}

function modeLabel(mode: DisplayMode): string {
  return DISPLAY_MODES.find((m) => m.value === mode)?.label ?? mode;
}

function modesText(v: SavedView): string {
  return `${v.camera ? "3D · " : ""}Layers: ${modeLabel(v.layerMode)} · Classes: ${modeLabel(v.classMode)}`;
}

/**
 * What opening `v` would show, as a page: the layers and classes the canvas would draw (by the
 * rules scene.ts draws by, with the view's display options, active layer and class, and its
 * visibility when its box is ticked) and the area a canvas of `canvas`'s size shows around its centre.
 */
function pageOf(v: SavedView, layers: readonly LayerInfo[], classes: readonly ClassInfo[], canvas: View): PdfView {
  const layerVis = (l: LayerInfo): Visibility => (v.restoreVisibility ? (v.layers[l.id] ?? l.visibility) : l.visibility);
  const active = layers.find((l) => l.id === v.activeLayerId) ?? layers.find((l) => l.id === store.activeLayerId) ?? layers[0];
  const drawn = !active
    ? []
    : active.kind === "sheet" || v.layerMode === "active-only"
      ? [active]
      : layers.filter((l) => l.kind === "design" && (l === active || layerVis(l) !== "hidden"));
  const activeClass = classes.some((c) => c.index === v.activeClassIndex) ? v.activeClassIndex : store.activeClassIndex;
  const classVis = (c: ClassInfo): Visibility => {
    const own = v.restoreVisibility ? (v.classes[String(c.index)] ?? c.visibility) : c.visibility;
    if (own === "hidden" || c.index === activeClass) return own;
    if (v.classMode === "active-only") return "hidden";
    if (graysOthers(v.classMode)) return "grayed";
    return own;
  };
  const halfW = canvas.width / 2 / v.scale;
  const halfH = canvas.height / 2 / v.scale;
  return {
    layers: drawn.map((l) => ({ id: l.id, ghosted: l !== active && (graysOthers(v.layerMode) || layerVis(l) === "grayed") })),
    classes: new Map(classes.map((c) => [c.index, classVis(c)])),
    box: { x0: v.cx - halfW, y0: v.cy - halfH, x1: v.cx + halfW, y1: v.cy + halfH },
    scale: active ? paperScale(active) : 1,
  };
}

function isMode(v: unknown): v is DisplayMode {
  return DISPLAY_MODES.some((m) => m.value === v);
}

function isVisibility(v: unknown): v is Visibility {
  return v === "visible" || v === "hidden" || v === "grayed";
}

function visibilityMap(raw: unknown): Record<string, Visibility> {
  const out: Record<string, Visibility> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [key, v] of Object.entries(raw)) {
    if (isVisibility(v)) out[key] = v;
  }
  return out;
}

/** A stored view, or null when the stored data is malformed. */
function parseView(raw: unknown): SavedView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (typeof r.name !== "string" || !finite(r.cx) || !finite(r.cy)) return null;
  if (!finite(r.scale) || r.scale <= 0 || !finite(r.activeClassIndex)) return null;
  if (!isMode(r.layerMode) || !isMode(r.classMode)) return null;
  return {
    name: r.name,
    cx: r.cx,
    cy: r.cy,
    scale: r.scale,
    activeLayerId: typeof r.activeLayerId === "string" ? r.activeLayerId : null,
    activeClassIndex: r.activeClassIndex,
    layerMode: r.layerMode,
    classMode: r.classMode,
    restoreVisibility: r.restoreVisibility === true,
    layers: visibilityMap(r.layers),
    classes: visibilityMap(r.classes),
    camera: parseCamera(r.camera),
  };
}

/** Views saved for a file name; empty when nothing is stored or storage throws. */
function loadViews(fileName: string): SavedView[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + fileName) ?? "[]");
    if (!Array.isArray(data)) return [];
    return data.map(parseView).filter((v): v is SavedView => v !== null);
  } catch {
    return [];
  }
}

function storeViews(fileName: string, views: readonly SavedView[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + fileName, JSON.stringify(views));
  } catch {
    // storage full or blocked: the views then last for this session only
  }
}

/** A saved view as the Organization dialog lists and edits it. */
export interface SavedViewEntry {
  readonly name: string;
  /** the "Visibility" box */
  readonly restoreVisibility: boolean;
  /** "Layers: … · Classes: …", the display options it restores */
  readonly modes: string;
}

/** The open drawing's saved views, as the View bar's Saved Views pop-up lists them. */
export interface SavedViews {
  names(): string[];
  open(index: number): void;
  /** saves the current view under the next free "View n" name */
  saveCurrent(): void;
  entries(): SavedViewEntry[];
  /** keeps the views at `keep`'s indexes into entries(), in its order, named and boxed as it says; index -1 saves the current view there */
  rewrite(keep: readonly { readonly index: number; readonly name: string; readonly restoreVisibility: boolean }[]): void;
  /** each view as File > Publish draws it: what opening it would show on the canvas at its present size */
  pages(): { name: string; view: PdfView }[];
  /** the views saved in the 3D view in perspective, with their cameras, in their order */
  cameras(): ViewCamera[];
}

/** the Navigation palette's saved views, once it is mounted */
let mounted: SavedViews | null = null;

/** The open drawing's saved views, or null before the Navigation palette is mounted. */
export function savedViews(): SavedViews | null {
  return mounted;
}

export function mountViews(root: HTMLElement, view: View): SavedViews {
  /** the document session the list was loaded for */
  let loadedFor: EditSession | null = null;
  /** file name the list is stored under, or "" with no drawing open; null before the first sync */
  let loaded: string | null = null;
  let views: SavedView[] = [];

  const btnAdd = h("button", { cls: "btn", text: "+ Save view", title: "Save current view" });
  const nameInput = h("input", { cls: "search", attrs: { type: "text", "aria-label": "Name of the new view" } });
  const btnOk = h("button", { cls: "btn", text: "Save" });
  const btnCancel = h("button", { cls: "btn", text: "Cancel" });
  const addRow = h("div", { cls: "toolbar sub view-add", hidden: true }, nameInput, btnOk, btnCancel);
  const list = h("div", { cls: "list" });
  root.replaceChildren(h("div", { cls: "toolbar" }, btnAdd), addRow, list);

  const persist = (): void => {
    if (loaded) storeViews(loaded, views);
  };

  /** "View 1", "View 2", ...: the first number not already in use. */
  const defaultName = (): string => {
    const taken = new Set(views.map((v) => v.name));
    let n = 1;
    while (taken.has(`View ${n}`)) n++;
    return `View ${n}`;
  };

  /** The 3D view's camera, when it shows. */
  const camera = (): SavedCamera | undefined => {
    const v3 = store.view3d ? appContext()?.view3d() : null;
    if (!v3) return undefined;
    const c = v3.cameraState();
    const el = v3.domElement;
    return { position: c.position, target: c.target, fov: c.fov, half: c.half, projection: store.viz3d.projection, aspect: (el.clientWidth || 4) / (el.clientHeight || 3) };
  };

  /** Snapshot of the current view centre and scale, active layer and class, display options and visibility, and the 3D view's camera when it shows. */
  const capture = (name: string): SavedView => {
    const doc = store.session?.doc;
    const layers = doc?.layers() ?? [];
    const classes = doc?.classes() ?? [];
    return {
      camera: camera(),
      name,
      cx: view.cx,
      cy: view.cy,
      scale: view.scale,
      activeLayerId: store.activeLayerId,
      activeClassIndex: store.activeClassIndex,
      layerMode: store.layerMode,
      classMode: store.classMode,
      restoreVisibility: false,
      layers: Object.fromEntries(layers.map((l): [string, Visibility] => [l.id, l.visibility])),
      classes: Object.fromEntries(classes.map((c): [string, Visibility] => [String(c.index), c.visibility])),
    };
  };

  const closeAdd = (): void => {
    addRow.hidden = true;
  };

  const openAdd = (): void => {
    nameInput.value = defaultName();
    addRow.hidden = false;
    nameInput.focus();
    nameInput.select();
  };

  const commitAdd = (): void => {
    const name = nameInput.value.trim() || defaultName();
    views.push(capture(name));
    persist();
    closeAdd();
    render();
  };

  /** Opens a view: centre and scale, active layer and class, display options, then visibility when ticked; in 3D through its camera, when it has one. */
  const restore = (v: SavedView): void => {
    const doc = store.session?.doc;
    if (!doc) return;
    const layers = doc.layers();
    const classes = doc.classes();
    const ctx = appContext();
    const cam = v.camera;
    if (cam) {
      void ctx?.show3d().then((v3) => {
        if (!v3) return;
        if (store.viz3d.projection !== cam.projection) setViz({ projection: cam.projection });
        v3.setCameraState({ position: cam.position, target: cam.target, zoom: 1, half: cam.half, fov: cam.fov });
      });
    } else if (store.view3d) ctx?.show2d();
    glide(view, () => view.setCenterAndScale(v.cx, v.cy, v.scale));
    store.layerMode = v.layerMode;
    store.classMode = v.classMode;
    if (v.activeLayerId && layers.some((l) => l.id === v.activeLayerId)) setActiveLayer(v.activeLayerId);
    if (classes.some((c) => c.index === v.activeClassIndex)) setActiveClass(v.activeClassIndex);
    if (v.restoreVisibility) {
      // each change is its own undo step, so only the entries that differ are written
      for (const l of layers) {
        const want = v.layers[l.id];
        if (want !== undefined && want !== l.visibility) {
          attempt("Restore visibility", (s) => s.setLayerVisibility(l.id, want));
        }
      }
      for (const c of classes) {
        const want = v.classes[String(c.index)];
        if (want !== undefined && want !== c.visibility) {
          attempt("Restore visibility", (s) => s.setClassVisibility(c.index, want));
        }
      }
    }
    store.emit("view", "display");
  };

  const rename = (v: SavedView, host: HTMLElement): void => {
    editInline(host, [v.name], (vals) => {
      if (vals) {
        const name = vals[0] ?? "";
        if (name) {
          v.name = name;
          persist();
        } else {
          toast("A view needs a name.", "info");
        }
      }
      render();
    });
  };

  const viewRow = (v: SavedView): HTMLElement => {
    const nameText = h("div", { cls: "name", text: v.name, title: "Double-click to rename" });
    const modes = h("div", { cls: "sub", text: modesText(v) });
    const names = h("div", { cls: "names" }, nameText, modes);
    const visBox = h("input", { checked: v.restoreVisibility, attrs: { type: "checkbox", "aria-label": `Restore visibility with ${v.name}` } });
    visBox.addEventListener("change", () => {
      v.restoreVisibility = visBox.checked;
      persist();
    });
    const visLabel = h(
      "label",
      { cls: "view-vis", title: "Restore layer and class visibility" },
      visBox,
      "Visibility",
    );
    const del = h("button", { cls: "icon-btn view-del", text: "×", title: "Delete this view", attrs: { "aria-label": `Delete ${v.name}` } });
    const row = h("div", { cls: "row view-row", title: "Click to open this view" }, names, visLabel, del);

    // a double-click renames, so a single click waits briefly before the view opens
    let openLater = 0;
    row.addEventListener("click", (e) => {
      // the checkbox, delete button and rename field handle their own clicks
      if (e.target instanceof Element && e.target.closest("input, label, button")) return;
      window.clearTimeout(openLater);
      openLater = window.setTimeout(() => restore(v), DOUBLE_CLICK_WAIT_MS);
    });
    nameText.addEventListener("dblclick", () => {
      window.clearTimeout(openLater);
      rename(v, nameText);
    });
    del.addEventListener("click", () => {
      views = views.filter((x) => x !== v);
      persist();
      render();
    });
    return row;
  };

  function render(): void {
    const hasDrawing = store.session !== null;
    btnAdd.disabled = !hasDrawing;
    if (!hasDrawing) {
      list.replaceChildren(h("div", { cls: "empty", text: "No drawing open" }));
    } else if (views.length === 0) {
      list.replaceChildren(h("div", { cls: "empty", text: "No saved views" }));
    } else {
      list.replaceChildren(...views.map(viewRow));
    }
  }

  /**
   * Follows the open drawing. A newly opened drawing loads the list saved under
   * its file name. Save As of the open drawing moves the list to the new name.
   * Saving under the same name changes nothing.
   */
  const sync = (): void => {
    const session = store.session;
    const name = session ? store.fileName : "";
    if (session === loadedFor && name === loaded) return;
    if (session && session === loadedFor) {
      loaded = name;
      persist();
    } else {
      loadedFor = session;
      loaded = name;
      views = name ? loadViews(name) : [];
      closeAdd();
    }
    render();
  };

  btnAdd.addEventListener("click", openAdd);
  btnOk.addEventListener("click", commitAdd);
  btnCancel.addEventListener("click", closeAdd);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitAdd();
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeAdd();
    }
  });

  store.on(["session", "file"], sync);
  sync();

  mounted = {
    names: () => views.map((v) => v.name),
    open: (index) => {
      const v = views[index];
      if (v) restore(v);
    },
    saveCurrent: () => {
      if (!store.session) return;
      views.push(capture(defaultName()));
      persist();
      render();
    },
    entries: () => views.map((v) => ({ name: v.name, restoreVisibility: v.restoreVisibility, modes: modesText(v) })),
    pages: () => {
      const doc = store.session?.doc;
      return doc ? views.map((v) => ({ name: v.name, view: pageOf(v, doc.layers(), doc.classes(), view) })) : [];
    },
    cameras: () =>
      views.flatMap((v) => {
        const c = v.camera;
        if (c?.projection !== "perspective") return [];
        const across = (2 * Math.atan(Math.tan((c.fov * Math.PI) / 360) * c.aspect) * 180) / Math.PI;
        return [{ name: v.name, eye: c.position, target: c.target, angle: across }];
      }),
    rewrite: (keep) => {
      views = keep
        .filter((k) => k.index < 0 || views[k.index] !== undefined)
        .map((k) => ({ ...(k.index < 0 ? capture(k.name) : views[k.index]), name: k.name, restoreVisibility: k.restoreVisibility }));
      persist();
      render();
    },
  };
  return mounted;
}
