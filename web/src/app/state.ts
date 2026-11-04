// Global UI state. One store for the whole editor; panels and tools read it
// directly and call emit() after mutating it. Session data itself lives in
// store.session (the core's EditSession) and is never copied here.

import type { Attributes, DropShadow, EditSession, LayerInfo, LineMarker, Pt } from "../core/index.ts";
import { DEFAULT_VIZ, type Viz3D } from "./heliodon.ts";

export type ToolId =
  | "select"
  | "reshape"
  | "pan"
  | "line"
  | "rect"
  | "circle"
  | "arc"
  | "quarterarc"
  | "polygon"
  | "triangle"
  | "polyline"
  | "text"
  | "rotate"
  | "mirror"
  | "symbol"
  | "locus"
  | "light"
  | "camera"
  | "flyover"
  | "translateview"
  | "walkthrough"
  | "heliodon"
  | "wall"
  | "walljoin"
  | "door"
  | "window"
  | "slab"
  | "plugin"
  | "eyedropper"
  | "attrmap"
  | "visibility"
  | "selectsimilar"
  | "measure"
  | "dimtape"
  | "protractor"
  | "section2d"
  | "offset"
  | "fillet"
  | "trim"
  | "split"
  | "connect"
  | "dimension"
  | "arclength"
  | "slopedim"
  | "fcf"
  | "gdtnote"
  | "weldfilletaws"
  | "weldfilletiso"
  | "weldflangeaws"
  | "weldflangeiso"
  | "weldgrooveaws"
  | "weldgrooveiso"
  | "weldmiscaws"
  | "weldmisciso"
  | "weldslotplugaws"
  | "weldslotplugiso"
  | "spurgear"
  | "spurgear3d"
  | "gearrack"
  | "gearrack3d"
  | "sprocket"
  | "sprocket3d"
  | "chainlinear"
  | "chainlinear3d"
  | "chaincircular"
  | "chaincircular3d"
  | "ballbearing"
  | "ballbearing3d"
  | "rollerbearing"
  | "rollerbearing3d"
  | "needlebearing"
  | "needlebearing3d"
  | "taperedbearing"
  | "taperedbearing3d"
  | "thrustbearing"
  | "thrustbearing3d"
  | "locknut"
  | "locknut3d"
  | "pillowblock"
  | "pillowblock3d"
  | "offsetlink"
  | "offsetlink3d"
  | "bevelgear"
  | "bevelgear3d"
  | "worm"
  | "worm3d"
  | "wormgear"
  | "wormgear3d"
  | "shaft"
  | "shaft3d"
  | "clevisinch"
  | "clevisinch3d"
  | "clevismetric"
  | "clevismetric3d"
  | "clevisdin"
  | "clevisdin3d"
  | "cotterpin"
  | "cotterpin3d"
  | "dowelpin"
  | "dowelpin3d"
  | "parallelpin"
  | "parallelpin3d"
  | "taperpininch"
  | "taperpininch3d"
  | "taperpindin"
  | "taperpindin3d"
  | "rivetlarge"
  | "rivetlarge3d"
  | "rivetsmall"
  | "rivetsmall3d"
  | "rivetdin"
  | "rivetdin3d"
  | "rivettubular"
  | "rivettubular3d"
  | "acornnut"
  | "acornnut3d"
  | "hexcapnut"
  | "hexcapnut3d"
  | "knurleddin"
  | "knurleddin3d"
  | "knurledinch"
  | "knurledinch3d"
  | "wingdin"
  | "wingdin3d"
  | "winga"
  | "winga3d"
  | "wingb"
  | "wingb3d"
  | "wingc"
  | "wingc3d"
  | "wingd"
  | "wingd3d"
  | "ringasme"
  | "ringasme3d"
  | "ringdin"
  | "ringdin3d"
  | "washerdin"
  | "washerdin3d"
  | "eyebolt"
  | "eyebolt3d"
  | "swingbolt"
  | "swingbolt3d"
  | "swingeyebolt"
  | "swingeyebolt3d"
  | "tbolt"
  | "tbolt3d"
  | "ubolt"
  | "ubolt3d"
  | "jbolt"
  | "jbolt3d"
  | "thumbscrew"
  | "thumbscrew3d"
  | "fastener"
  | "flanged2"
  | "flanged23d"
  | "flanged4"
  | "flanged43d"
  | "pulley"
  | "pulley3d"
  | "key"
  | "key3d"
  | "woodruffkey"
  | "woodruffkey3d"
  | "compspring1"
  | "compspring13d"
  | "compspring2"
  | "compspring23d"
  | "conicalspring"
  | "conicalspring3d"
  | "diespring"
  | "diespring3d"
  | "extspringfront"
  | "extspring3d"
  | "extspringend"
  | "torsionfront"
  | "torsion3d"
  | "torsionend"
  | "belleville"
  | "belleville3d"
  | "callout"
  | "leadersimple"
  | "leaderline"
  | "hyperlink"
  | "cloud"
  | "breakline"
  | "insulation"
  | "repunit"
  | "steel"
  | "steel3d"
  | "lumber"
  | "linearmaterial"
  | "framing"
  | "structmember"
  | "tbborder"
  | "lightdevice"
  | "hangingposition"
  | "lightaccessory"
  | "ganging"
  | "stageorigin"
  | "focusinstrument"
  | "spikemark"
  | "distributor"
  | "eleccomponent"
  | "bulbflat"
  | "shaftbreak"
  | "shaftbreak2"
  | "bolt"
  | "weld"
  | "screw"
  | "nail"
  | "anchor"
  | "tablechairs"
  | "desk"
  | "shelving"
  | "clothesrod"
  | "bathshower"
  | "grabbars"
  | "fireplace"
  | "toiletstall"
  | "ceilinggrid"
  | "cabinet"
  | "customcab"
  | "countertop"
  | "compsink"
  | "railing"
  | "chainextrude"
  | "seating"
  | "space"
  | "spacelink"
  | "adjacencymatrix"
  | "adjacencyscore"
  | "stackingdiagram"
  | "hardscape"
  | "landscape"
  | "hedgerow"
  | "sitemodifier"
  | "grade"
  | "existingtree"
  | "propline"
  | "parking"
  | "parkingspaces"
  | "stake"
  | "fence"
  | "curb"
  | "roadstraight"
  | "roadcurved"
  | "roadtee"
  | "roadpoly"
  | "parkingarea"
  | "parkingpath"
  | "stagedeck"
  | "stageplug"
  | "stagesteps"
  | "stageramp"
  | "ropestanchion"
  | "softgoods"
  | "television"
  | "videoscreen"
  | "blendedscreen"
  | "ledscreen"
  | "speaker"
  | "speakerarray"
  | "rackruler"
  | "receptacle"
  | "switch"
  | "commdevice"
  | "pipingrun"
  | "hvacduct"
  | "hvacelbow"
  | "hvacflex"
  | "hvacvertical"
  | "hvactransition"
  | "hvacsplitter"
  | "hvacdamper"
  | "hvacdiffuser"
  | "hvacoutlet"
  | "greatcircle"
  | "graticule"
  | "surveypoint"
  | "gisstake"
  | "incandescent"
  | "trussstraight"
  | "trusscurved"
  | "lightingpipe"
  | "pipeladder"
  | "rigpoint"
  | "hoist"
  | "hoistorigin"
  | "bridle"
  | "mothergrid"
  | "riggingload"
  | "cablepath"
  | "cable"
  | "hopover"
  | "focuspoint"
  | "photometer"
  | "videocamera"
  | "ccdevice"
  | "ccdevicebuilder"
  | "ccsocket"
  | "ccsocketloop"
  | "ccexternal"
  | "ccda"
  | "cctermpanel"
  | "ccjack"
  | "cclinkedjack"
  | "ccconnectorpanel"
  | "ccadapter"
  | "ccreroute"
  | "ccterminator"
  | "ccconnect"
  | "cclegend"
  | "cclayoutroom"
  | "ccrack"
  | "ccequip"
  | "ccrackframe"
  | "ccadapterslot"
  | "ccrackws"
  | "ccpanelconnector"
  | "cclabelcolor"
  | "cclabelqr"
  | "cccableroute"
  | "ccdroppoint"
  | "cceditcabling"
  | "photogrid"
  | "equipmentkey"
  | "focusalongpath"
  | "chamferedge"
  | "filletedge"
  | "shellsolid"
  | "taperface"
  | "pushpull"
  | "offsetedge"
  | "deform"
  | "loftsurface"
  | "alignplane"
  | "poly3d"
  | "locus3d"
  | "extract"
  | "project"
  | "analysis"
  | "aligndistribute"
  | "outlet"
  | "irrpipe"
  | "valve"
  | "poc"
  | "controller"
  | "syscomponent"
  | "dripoutlet"
  | "designzone"
  | "hydrozone"
  | "column"
  | "stair"
  | "elevator"
  | "escalator"
  | "pilaster"
  | "ramp"
  | "simplestair"
  | "plant"
  | "secmarker"
  | "secline"
  | "intelev"
  | "detailcallout"
  | "drawlabel"
  | "refmarker"
  | "gridline"
  | "redline"
  | "generalnotes"
  | "benchmark"
  | "northarrow"
  | "scalebar"
  | "datatag"
  | "legend"
  | "symmetry"
  | "centermark"
  | "drilledhole"
  | "drilledhole3d"
  | "tappedmm"
  | "tappedmm3d"
  | "tappedin"
  | "tappedin3d"
  | "slot"
  | "holepattern"
  | "screwthread"
  | "keyway"
  | "carriagebolt"
  | "carriagebolt3d"
  | "lagscrew"
  | "lagscrew3d"
  | "boltnutinch"
  | "boltnutmm"
  | "woodscrew"
  | "woodscrew3d"
  | "sheetmetalscrew"
  | "sheetmetalscrew3d"
  | "stipple"
  | "chamfer"
  | "doubleline"
  | "dlpolygon"
  | "regpoly"
  | "freehand"
  | "oval"
  | "roundrect"
  | "spiral"
  | "moveby"
  | "clip"
  | "shear"
  | "fpresize"
  | "zoom"
  | "extrect"
  | "extpoly"
  | "sphere"
  | "hemisphere"
  | "cone"
  | "hatch"
  | "dividing"
  | "alignleaders"
  | "rotate3dcentre"
  | "roofaxis"
  | "placeat"
  | "adddims"
  | "visualzone"
  | "sitesculpt"
  | "sitecontour"
  | "sitelabels"
  | "spotnumber"
  | "massingmodel"
  | "rotateplan";

/**
 * How layers or classes other than the active one are shown (Vectorworks'
 * Layer Options / Class Options): only the active one; others grayed, not
 * snapped to (Gray Others) or snapped to (Gray/Snap Others); others shown, not
 * snapped to (Show Others), snapped to (Show/Snap Others) or snapped to and
 * editable (Show/Snap/Modify Others).
 */
export type DisplayMode = "active-only" | "gray-others" | "gray-snap-others" | "show-others" | "show-snap-others" | "modify-others";

/** Gray Others and Gray/Snap Others: what isn't active is drawn grayed. */
export function graysOthers(mode: DisplayMode): boolean {
  return mode === "gray-others" || mode === "gray-snap-others";
}

/** The options with Snap in them: the pointer snaps to what isn't active. */
export function snapsToOthers(mode: DisplayMode): boolean {
  return mode === "gray-snap-others" || mode === "show-snap-others" || mode === "modify-others";
}

export type Topic =
  | "session" // document opened/changed/saved (dirty flag may have moved)
  | "file" // file name or file handle changed
  | "selection"
  | "layer" // active layer changed
  | "class" // active class changed
  | "tool"
  | "snap" // snap or grid toggles changed
  | "cursor"
  | "datum" // the SmartCursor datum was set, moved or released
  | "hint"
  | "modes" // the active tool's mode or preferences changed
  | "view" // zoom or fit changed
  | "display" // layer/class display modes or saved views changed
  | "attrs" // attributes for new objects changed
  | "symbol" // symbol chosen for placement changed
  | "view3d" // the 3D view was shown or hidden
  | "viz3d"; // the 3D view's projection, lighting or clip cube changed

type Listener = () => void;

const GRID_KEY = "openvwx.grid";
const ZOOM_LINES_KEY = "openvwx.zoomLineThickness";
const SNAP_KINDS_KEY = "openvwx.snapKinds";
const SNAP_SETTINGS_KEY = "openvwx.snapSettings.v1";

/** How snapping reaches: its radius on screen, the grid's spacing, and the Smart Point Settings. */
export interface SnapSettings {
  /** how near (CSS px) the cursor must come to an object's point to snap to it */
  readonly radiusPx: number;
  /** a fixed grid spacing in mm, or null for one that follows the zoom */
  readonly gridSpacing: number | null;
  /** Acquire smart point if mouse stops for this many seconds */
  readonly acquireSec: number;
  /** Set datum if mouse stops for this many seconds; null when only G sets one */
  readonly datumSec: number | null;
  /** Use datum offset: the points this far (mm) from the datum along its extensions snap; null for none */
  readonly datumOffset: number | null;
}

export const DEFAULT_SNAP_SETTINGS: SnapSettings = { radiusPx: 8, gridSpacing: null, acquireSec: 0.35, datumSec: null, datumOffset: null };

/** Saved snap settings; the defaults for anything missing or unreadable. */
function loadSnapSettings(): SnapSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SNAP_SETTINGS_KEY) ?? "null") as Partial<SnapSettings> | null;
    const r = saved?.radiusPx;
    const g = saved?.gridSpacing;
    const a = saved?.acquireSec;
    const d = saved?.datumSec;
    const o = saved?.datumOffset;
    return {
      radiusPx: typeof r === "number" && r > 0 ? r : DEFAULT_SNAP_SETTINGS.radiusPx,
      gridSpacing: typeof g === "number" && g > 0 ? g : null,
      acquireSec: typeof a === "number" && a > 0 ? a : DEFAULT_SNAP_SETTINGS.acquireSec,
      datumSec: typeof d === "number" && d > 0 ? d : null,
      datumOffset: typeof o === "number" && o > 0 ? o : null,
    };
  } catch {
    return DEFAULT_SNAP_SETTINGS;
  }
}

/** The object snaps the Snapping palette turns on and off one by one. */
export type ObjectSnapKind = "end" | "mid" | "center" | "intersection" | "nearest" | "tangent" | "smart";
export const OBJECT_SNAP_KINDS: readonly ObjectSnapKind[] = ["end", "mid", "center", "intersection", "nearest", "tangent", "smart"];

/** Saved object snap kinds; every kind on when nothing is stored or storage throws. */
function loadSnapKinds(): Record<ObjectSnapKind, boolean> {
  const kinds = Object.fromEntries(OBJECT_SNAP_KINDS.map((k) => [k, true])) as Record<ObjectSnapKind, boolean>;
  try {
    const saved = JSON.parse(localStorage.getItem(SNAP_KINDS_KEY) ?? "null") as Record<string, unknown> | null;
    for (const k of OBJECT_SNAP_KINDS) if (typeof saved?.[k] === "boolean") kinds[k] = saved[k] as boolean;
  } catch {
    // unreadable or blocked storage: every kind on
  }
  return kinds;
}

/** Saved grid toggles; the defaults when nothing is stored or storage throws. */
function loadGrid(): { show: boolean; snap: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(GRID_KEY) ?? "null") as { show?: unknown; snap?: unknown } | null;
    return {
      show: typeof saved?.show === "boolean" ? saved.show : true,
      snap: typeof saved?.snap === "boolean" ? saved.snap : false,
    };
  } catch {
    return { show: true, snap: false };
  }
}

function saveGrid(): void {
  try {
    localStorage.setItem(GRID_KEY, JSON.stringify({ show: store.showGrid, snap: store.snapGrid }));
  } catch {
    // storage can be full or blocked; the toggles still work for this session
  }
}

/** The line markers and drop shadow new objects are drawn with (the Attributes palette's New objects). */
export interface DrawEffects {
  readonly start?: LineMarker;
  readonly end?: LineMarker;
  readonly shadow?: DropShadow;
}

/** Changes the 3D view's projection, lighting or clip cube (the Visualization palette). */
export function setViz(patch: Partial<Viz3D>): void {
  store.viz3d = { ...store.viz3d, ...patch };
  store.emit("viz3d");
}

/**
 * A symbol definition, or a sheet viewport's annotations, open for editing: its contents are drawn
 * and edited as the layer `layer`.
 */
export interface SymbolEdit {
  /** the definition's name index; -1 for viewport annotations */
  readonly index: number;
  /** the viewport whose annotations are open (Edit Annotations), drawn under them */
  readonly viewport?: string;
  /** the stand-in layer, whose id is the definition's */
  readonly layer: LayerInfo;
  /** the layer, view and group to go back to */
  readonly from: { readonly layerId: string | null; readonly cx: number; readonly cy: number; readonly scale: number };
}

class Store {
  session: EditSession | null = null;
  fileName = "";
  /** File System Access handle of the opened file, if the browser gave one. */
  handle: FileSystemFileHandle | null = null;
  /** size of the file as it was opened, in bytes */
  fileSize = 0;
  /** true once the user agreed to overwrite the opened file in this session */
  overwriteConfirmed = false;
  activeLayerId: string | null = null;
  activeClassIndex = 0;
  /** selected object ids on the active layer: top-level objects, or children of editGroupId */
  selection: ReadonlySet<string> = new Set<string>();
  /** group being edited in place (double-click a group), or null; on the active layer */
  editGroupId: string | null = null;
  /** the symbol definition being edited (Modify > Edit Symbol), which stands in for the active layer */
  symbolEdit: SymbolEdit | null = null;
  /** the vertex Object Info is showing for the selected polygon or polyline, marked on its grips */
  editVertex: { readonly id: string; readonly index: number } | null = null;
  /** what a click of the Selection tool would select, outlined faintly (Preferences > Interactive, pre-selection) */
  preselect: string | null = null;
  tool: ToolId = "select";
  snapObjects = true;
  /** which object snaps apply while snapObjects is on (the Snapping palette) */
  snapKinds: Record<ObjectSnapKind, boolean> = loadSnapKinds();
  /** snap radius and grid spacing (the Snapping palette's settings) */
  snapSettings: SnapSettings = loadSnapSettings();
  /** layer options: how layers other than the active one are shown */
  layerMode: DisplayMode = "modify-others";
  /** class options: how classes other than the active class are shown */
  classMode: DisplayMode = "modify-others";
  /** attributes applied to newly drawn objects (empty = copy the template's) */
  drawAttrs: Partial<Attributes> = {};
  /** line markers (lines, polygons, polylines and arcs) and drop shadow given to newly drawn objects */
  drawEffects: DrawEffects = {};
  /** symbol definition (name index) the symbol tool places, chosen in Resources */
  activeSymbol: number | null = null;
  /** grid lines are drawn on the canvas */
  showGrid = true;
  /** the cursor snaps to the grid (independent of showGrid) */
  snapGrid = false;
  /**
   * View > Zoom Line Thickness: line weights are drawn at their size on paper, so zooming in
   * thickens them as it does the drawing; off, a weight keeps its width on screen at any zoom
   */
  zoomLineThickness = loadZoomLines();
  /** the 3D view is shown over the drawing */
  view3d = false;
  /** how the 3D view is looked at and lit (the Visualization palette) */
  viz3d: Viz3D = DEFAULT_VIZ;
  hint = "";
  /** last pointer position in document units (snapped) */
  cursor: Pt | null = null;
  /**
   * The SmartCursor datum (G over the drawing, as Vectorworks has it): a point taken as the origin
   * while it is set, so the data bar's and the status bar's X and Y are measured from it, and the
   * cursor lines up with it as with a smart point. Null when there is none.
   */
  datum: Pt | null = null;

  private readonly listeners = new Map<Topic, Set<Listener>>();

  constructor() {
    const grid = loadGrid();
    this.showGrid = grid.show;
    this.snapGrid = grid.snap;
  }

  on(topics: Topic | readonly Topic[], fn: Listener): () => void {
    const list: readonly Topic[] = typeof topics === "string" ? [topics] : topics;
    for (const t of list) {
      let set = this.listeners.get(t);
      if (!set) {
        set = new Set<Listener>();
        this.listeners.set(t, set);
      }
      set.add(fn);
    }
    return () => {
      for (const t of list) this.listeners.get(t)?.delete(fn);
    };
  }

  /** Calls each listener once, even when several of the topics match it. */
  emit(...topics: Topic[]): void {
    const fns = new Set<Listener>();
    for (const t of topics) for (const fn of this.listeners.get(t) ?? []) fns.add(fn);
    for (const fn of fns) fn();
  }

  setHint(text: string): void {
    if (text === this.hint) return;
    this.hint = text;
    this.emit("hint");
  }
}

export const store = new Store();

/**
 * Sets the grid toggles, saves them and emits "snap" (the canvas and the status
 * bar both listen). Pass only the fields that change, e.g. setGrid({ show: !store.showGrid }).
 */
export function setGrid(next: { show?: boolean; snap?: boolean }): void {
  const show = next.show ?? store.showGrid;
  const snap = next.snap ?? store.snapGrid;
  if (show === store.showGrid && snap === store.snapGrid) return;
  store.showGrid = show;
  store.snapGrid = snap;
  saveGrid();
  store.emit("snap");
}

function loadZoomLines(): boolean {
  try {
    return localStorage.getItem(ZOOM_LINES_KEY) === "1";
  } catch {
    return false;
  }
}

/** Turns View > Zoom Line Thickness on or off, keeps the choice in this browser and redraws. */
export function setZoomLineThickness(on: boolean): void {
  if (store.zoomLineThickness === on) return;
  store.zoomLineThickness = on;
  try {
    localStorage.setItem(ZOOM_LINES_KEY, on ? "1" : "0");
  } catch {
    // storage can be full or blocked; the choice lasts for this visit
  }
  store.emit("display");
}

/** Sets the snap radius and grid spacing, saves them and emits "snap". */
export function setSnapSettings(next: SnapSettings): void {
  store.snapSettings = next;
  try {
    localStorage.setItem(SNAP_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: the settings last for this visit
  }
  store.emit("snap");
}

/** Turns one kind of object snap on or off, saves the choice and emits "snap". */
export function setSnapKind(kind: ObjectSnapKind, on: boolean): void {
  if (store.snapKinds[kind] === on) return;
  store.snapKinds = { ...store.snapKinds, [kind]: on };
  try {
    localStorage.setItem(SNAP_KINDS_KEY, JSON.stringify(store.snapKinds));
  } catch {
    // storage blocked: the choice lasts for this visit
  }
  store.emit("snap");
}

/** The layer `id` names: a layer of the open drawing, or the symbol being edited, which stands in for one. */
export function layerInfo(id: string | null): LayerInfo | undefined {
  if (!id) return undefined;
  if (store.symbolEdit?.layer.id === id) return store.symbolEdit.layer;
  return store.session?.doc.layers().find((l) => l.id === id);
}
