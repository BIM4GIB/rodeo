// Extension seams for the platform features (accounts, cloud files, live
// collaboration, crit mode, site context, plug-ins, ...). Each feature is its
// own module under src/features/ that registers here when it is imported
// (features/index.ts imports them all before the app starts); the editor calls
// these hooks at fixed points, so a feature never edits the editor's files.

import type { BBox, ChangeEvent, EditSession, ObjectInfo, Pt, RecordValue, VwxDocument } from "../core/index.ts";
import type { Palettes, PaletteSpec } from "./dock.ts";
import type { Row } from "./menu.ts";
import type { Scene } from "./scene.ts";
import type { SiteModifier } from "./siteModelShapes.ts";
import type { Snapper } from "./snap.ts";
import type { ToolId } from "./state.ts";
import type { Painter, ToolController } from "./tools.ts";
import type { View } from "./view.ts";
import type { RenderMode, View3D } from "./view3d.ts";

/** Where the open drawing came from, and where File > Save sends it. */
export interface DocumentSource {
  /** e.g. "local", "cloud", "share", "gdrive", "onedrive" */
  readonly kind: string;
  /** shown beside the file name ("Cloud", "OneDrive"); none for a file on disk */
  readonly label?: string;
  /** an id the feature that opened it understands (a cloud file id, a drive item id) */
  readonly id?: string;
  /** writes the drawing back; File > Save calls this instead of writing to disk */
  save?(bytes: Uint8Array): Promise<void>;
  /** view only: the editor refuses edits (a share link, a viewer or reviewer in a shared drawing) */
  readonly readOnly?: boolean;
}

/** A file the user opened or imported, as the editor tells of it once it has come in or failed to. */
export interface FileIn {
  /** the file as the user gave it (not the drawing it became) */
  readonly file: Blob | Uint8Array;
  readonly name: string;
  /** what went wrong, as the user was told; null when it came in */
  readonly error: string | null;
}

export interface OpenOptions {
  readonly source?: DocumentSource;
  /** in place of the drawing in front (the same drawing moved, as Save to Cloud does), not in a tab of its own */
  readonly replace?: boolean;
}

/**
 * An open drawing as work that goes on while another tab is in front holds on to it (an agent's
 * run): its session, and the active layer, selection and plan view it keeps, which are the
 * window's while it is in front and its tab's while it is behind.
 */
export interface DrawingRef {
  readonly session: EditSession;
  readonly source: DocumentSource | null;
  /** its file name, as its tab shows it */
  name(): string;
  /** whether it is still open in a tab */
  isOpen(): boolean;
  /** whether it is the drawing the window shows */
  isShown(): boolean;
  /** brings its tab to the front, unless the drawing in front can't be left now (the user is told why) */
  show(): void;
  activeLayerId(): string | null;
  setActiveLayer(id: string): void;
  activeClassIndex(): number | null;
  selection(): ReadonlySet<string>;
  setSelection(ids: Iterable<string>): void;
  /** the group being edited: only ever one in front */
  editGroupId(): string | null;
  /** the world box the plan shows of it, the window's or the one its tab keeps */
  visibleRect(): BBox;
  /** fits `box` in its plan view (the window's when in front) */
  zoomTo(box: BBox): void;
  /** the scene that draws it: the window's while it is in front, else one of its own */
  scene(): Scene;
}

/** A feature's mark on a drawing's tab (an agent at work in it): an icon or a word, with its tooltip. */
export interface TabMark {
  readonly html: string;
  readonly title: string;
  readonly cls?: string;
}

/** What features can reach of the running editor, from onReady on. */
export interface AppContext {
  readonly scene: Scene;
  readonly view: View;
  readonly palettes: Palettes;
  readonly controller: ToolController;
  /** the snapping the tools use (pins and picks snap the same way) */
  readonly snap: Snapper;
  /** the 2D drawing's canvas */
  readonly canvas: HTMLCanvasElement;
  requestDraw(): void;
  /**
   * Opens a drawing from its bytes, or from a file read a slice at a time as it opens, in a tab of
   * its own; one from the same source (kind and id) as an open tab takes that tab's place, after
   * asking about its unsaved changes.
   */
  openDocument(data: Uint8Array | Blob, name: string, options?: OpenOptions): Promise<void>;
  /** Opens or imports a file as dropping it on the window does: any format Rodeo reads, by its name's extension. */
  openFile(file: File): Promise<void>;
  /** The open drawing as .vwx bytes, or null with none open. */
  documentBytes(): Promise<Uint8Array | null>;
  fit(): void;
  /** The 3D view, created and shown when it isn't yet (null if WebGL is unavailable). */
  show3d(): Promise<View3D | null>;
  /** The 3D view if it has been created. */
  view3d(): View3D | null;
  /** Back to the 2D drawing from the 3D view (nothing when it shows already). */
  show2d(): void;
  /** How the 3D view draws the model (View > Rendering), and setting it as that menu does. */
  renderMode(): RenderMode;
  setRenderMode(mode: RenderMode): void;
  setTool(id: ToolId): void;
  /** Create Similar Object: makes `id` the tool, with the settings `obj` was drawn with; false when it can't copy `obj` */
  setToolFrom(id: ToolId, obj: ObjectInfo): boolean;
  save(): Promise<void>;
  /** The drawing in front, or null with none open. */
  frontDrawing(): DrawingRef | null;
  /** Every open drawing, in the order of their tabs. */
  drawings(): readonly DrawingRef[];
}

type MenuRows = () => readonly Row[];

/** Where registerMenu puts a feature's rows. */
export interface MenuPlacement {
  /** the label of a row in that menu (or submenu): the rows go straight after it, with no separator */
  readonly after?: string;
}

/** A feature's rows for one menu or submenu, as registerMenu took them. */
export interface ExtensionMenu {
  /** "File", or a submenu path such as "File › Export" */
  readonly title: string;
  readonly rows: MenuRows;
  readonly after?: string;
}

/** A feature's say on a layer in the Navigation palette's Layers list: a mark beside its name, and rows for its right-click menu. */
export interface LayerExtension {
  /** a short mark beside the layer's name (an icon or a word, with its tooltip), or null for none */
  mark?(layerId: string): { readonly html: string; readonly title: string; readonly cls?: string } | null;
  /** rows for the layer's right-click menu, after the list's own */
  rows?(layerId: string): readonly Row[];
}

/**
 * A kind of plug-in object a feature can draw from its parameters (an installed Vectorworks plug-in),
 * known by the name of its parameters' record format. The Plug-in Insertion tool offers it, and
 * Object Info edits of such an object go to it so that it is drawn again.
 */
export interface PluginDriver {
  readonly name: string;
  /** how the tool places one: a click (and a drag to turn it), a drag along it, or a drag across it */
  readonly shape: "point" | "linear" | "rect";
  /** drawn by Rodeo itself, placed by a tool of its own, so Plug-in Insertion doesn't offer it */
  readonly builtIn?: boolean;
  /** what Object Info calls a parameter (its display name), or undefined for its field name */
  label(field: string): string | undefined;
  /** whether a parameter is only shown (static text the script sets) */
  readOnly(field: string): boolean;
  /** a popup's or radio button's choices: the value kept and the name shown; undefined for other fields */
  choices(field: string): readonly { readonly value: string; readonly label: string }[] | undefined;
  /**
   * Places a new one on `layerId` with its origin at `at`, turned `angle` degrees; `size` is a drag's
   * length (linear) or width and height (rect), in mm, or null for a click.
   */
  place(layerId: string, at: Pt, angle: number, size: { readonly width: number; readonly height: number } | null): void;
  /** Sets fields of the object `id` (as its record holds them) and draws it again, as one undo step. */
  edit(id: string, values: Readonly<Record<string, RecordValue>>): void;
  /** Draws the object `id` again from its parameters, as one undo step: null when done, else why it failed (nothing shown). */
  reset(id: string): Promise<string | null>;
  /**
   * The plug-in's own Object Info layout, or null to list its fields as they are. Undefined until it is
   * known (its script runs to set it up), and `ready` is called then.
   */
  layout(ready: () => void): readonly PluginWidget[] | null | undefined;
  /**
   * Which widgets of object `id`'s layout are greyed or hidden. `apply` gets what is known now, if
   * anything, and then what the plug-in's script says for the object's values, when that differs.
   */
  widgetStates(id: string, apply: (states: PluginWidgetStates) => void): void;
  /** A button of the layout clicked on object `id`: the script runs for it and draws the object again with what it set. */
  press(id: string, widget: number): void;
  /** A double-click on object `id`, for those with a settings dialog. */
  open?(id: string): void;
  /** Its corners on the drawing, for those the Reshape tool can move. */
  path?(id: string): { readonly points: readonly Pt[]; readonly closed: boolean } | null;
  /** New corners from the Reshape tool, as part of its undo step. */
  setPath?(s: EditSession, id: string, corners: readonly Pt[]): void;
  /**
   * The HopOver tool on object `id` near `at` (a circuit hopping one that crosses it), its hop `radius`
   * and side: the hop's arc (null when the click takes one off) and the crossing, for the preview, and
   * its making as one undo step; or why not.
   */
  hopOver?(id: string, at: Pt, radius: number, down: boolean): PluginHop;
}

/** What a HopOver click on a plug-in object would do (PluginDriver.hopOver). */
export interface PluginHop {
  readonly arc: readonly Pt[] | null;
  readonly at: Pt | null;
  /** why nothing happens, or "" */
  readonly reason: string;
  apply(): void;
}

/** A row of a plug-in object's own Object Info layout (PluginDriver.layout). */
export interface PluginWidget {
  /** the plug-in's number for it, which its states and a button's click use */
  readonly id: number;
  /** a parameter's control, a button, a divider (with an optional title) or a line of text */
  readonly kind: "param" | "button" | "divider" | "text";
  /** the parameter a "param" row shows */
  readonly field?: string;
  /** its text: for a "param" row, a name over the parameter's own when not empty */
  readonly label: string;
  /** how many steps it is indented */
  readonly level: number;
}

/** The widgets a plug-in greys or hides, by id; those missing are enabled and shown. */
export type PluginWidgetStates = ReadonlyMap<number, { readonly enabled: boolean; readonly visible: boolean }>;

/** The start screen's places for features' blocks: the header's end, beside Open file, under Recent, and the footer. */
export type WelcomeSlot = "head" | "open" | "main" | "foot";

/** A drawing a feature lists on the start screen's Recent list, beside those opened from this computer. */
export interface RecentFile {
  readonly name: string;
  /** when it was last opened or changed, ms since the epoch (the list is newest first) */
  readonly at: number;
  /** a 16 px line icon, as SVG markup */
  readonly icon: string;
  open(): void;
}

/** Shows a feature's drawings on the Recent list, in place of those it showed before. */
export type ShowRecent = (files: readonly RecentFile[]) => void;

const menus: ExtensionMenu[] = [];
const palettes: PaletteSpec[] = [];
const overlays: ((p: Painter) => void)[] = [];
const view3dHooks: ((v: View3D) => void)[] = [];
const welcome: { build: () => HTMLElement; slot: WelcomeSlot }[] = [];
const recentSources: ((show: ShowRecent) => void)[] = [];
const topBar: { build: () => HTMLElement; side: "left" | "right" }[] = [];
const ready: ((ctx: AppContext) => void)[] = [];
const docHooks: ((session: EditSession | null, source: DocumentSource | null) => void)[] = [];
const fileHooks: ((f: FileIn) => void)[] = [];
const leaveGuards: (() => string | null)[] = [];
const urlHandlers: { param: string; run: (value: string, params: URLSearchParams, ctx: AppContext) => void }[] = [];
const layerExtensions: LayerExtension[] = [];
const contextRows: ((under: string | null) => readonly Row[])[] = [];
const driverSources: (() => readonly PluginDriver[])[] = [];
const tabMarks: ((d: DrawingRef) => TabMark | null)[] = [];
const closeGuards: ((d: DrawingRef) => string | null)[] = [];
const behindGuards: ((d: DrawingRef) => string | null)[] = [];
const closeHooks: ((d: DrawingRef, next: DrawingRef | null) => void)[] = [];
let tabsRedraw: () => void = () => undefined;
let wantedDriver: string | null = null;

let ctx: AppContext | null = null;
let source: DocumentSource | null = null;

/**
 * Adds rows to a menu by its title ("File", "Edit", "View", "Window", "Help", ...); a new title
 * makes a new menu. A submenu path ("File › Export") adds them to that submenu. The rows go at
 * the end after a separator, or straight after the row labelled `placement.after` when it is
 * there.
 */
export function registerMenu(title: string, rows: MenuRows, placement: MenuPlacement = {}): void {
  menus.push({ title, rows, after: placement.after });
}

/** Adds a palette; Window lists it, and it starts where `spec.side` says (hidden if `spec.hidden`). */
export function registerPalette(spec: PaletteSpec): void {
  palettes.push(spec);
}

/** Draws over the 2D drawing after the tool's overlay, in CSS-pixel space (p.toScreen maps world points). */
export function registerOverlay(draw: (p: Painter) => void): void {
  overlays.push(draw);
}

/** Called once the 3D view exists (it is made the first time it is shown). */
export function on3d(fn: (v: View3D) => void): void {
  view3dHooks.push(fn);
}

/** Adds a block to the start screen: at the header's end ("head"), beside Open file ("open"), under Recent ("main") or in the footer ("foot"). */
export function registerWelcome(build: () => HTMLElement, slot: WelcomeSlot = "main"): void {
  welcome.push({ build, slot });
}

/** Lists a feature's drawings on the start screen's Recent list: `watch` gets the function that shows them, to call whenever they change. */
export function registerRecentFiles(watch: (show: ShowRecent) => void): void {
  recentSources.push(watch);
}

/** Adds an element to the top bar, at the start of its left or right end. */
export function registerTopBar(build: () => HTMLElement, side: "left" | "right" = "right"): void {
  topBar.push({ build, side });
}

const fileBadges: (() => HTMLElement)[] = [];

/** Adds a small element beside the open drawing's name in the top bar (a branch's name); the feature shows and hides it. */
export function registerFileBadge(build: () => HTMLElement): void {
  fileBadges.push(build);
}

/** Called once the editor is running, with what features can reach of it. */
export function onReady(fn: (ctx: AppContext) => void): void {
  if (ctx) fn(ctx);
  else ready.push(fn);
}

/** Called after a drawing is opened or brought to the front from its tab (or the last closed: null), with where it came from. */
export function onDocument(fn: (session: EditSession | null, source: DocumentSource | null) => void): void {
  docHooks.push(fn);
}

/**
 * Called when a file the user gave (dropped, File > Open, File > Import, Open Recent) has been
 * opened or imported, into the drawing in front, or could not be.
 */
export function onFileIn(fn: (f: FileIn) => void): void {
  fileHooks.push(fn);
}

/**
 * Refuses bringing another drawing to the front while `guard` gives a reason, which the user is
 * told (live collaboration's changes still on their way, say).
 */
export function registerLeaveGuard(guard: () => string | null): void {
  leaveGuards.push(guard);
}

/** Why the drawing in front can't be left for another tab now, or null when it can. */
export function leaveRefusal(): string | null {
  for (const guard of leaveGuards) {
    const why = guard();
    if (why) return why;
  }
  return null;
}

/** Adds a mark to each drawing's tab, where `mark` gives one; redrawTabs has the strip ask again. */
export function registerTabMark(mark: (d: DrawingRef) => TabMark | null): void {
  tabMarks.push(mark);
}

export function extensionTabMarks(d: DrawingRef): TabMark[] {
  return tabMarks.flatMap((mark) => mark(d) ?? []);
}

/** Has the tab strip drawn again: a feature's marks have changed. */
export function redrawTabs(): void {
  tabsRedraw();
}

export function setTabsRedraw(fn: () => void): void {
  tabsRedraw = fn;
}

/**
 * Asks before a drawing's tab closes while `guard` gives a reason (an agent at work in it): the user
 * is asked whether to close it all the same.
 */
export function registerCloseGuard(guard: (d: DrawingRef) => string | null): void {
  closeGuards.push(guard);
}

/** Why closing `d` needs asking about first, or null when it doesn't. */
export function closeQuestion(d: DrawingRef): string | null {
  for (const guard of closeGuards) {
    const why = guard(d);
    if (why) return why;
  }
  return null;
}

/**
 * Keeps edits to a drawing behind other tabs waiting until it is in front while `guard` gives a
 * reason (a live cloud drawing, whose changes go out through a session only the front one is in).
 */
export function registerBehindGuard(guard: (d: DrawingRef) => string | null): void {
  behindGuards.push(guard);
}

/** Why `d` can't be edited while it is behind, or null when it can. */
export function behindRefusal(d: DrawingRef): string | null {
  for (const guard of behindGuards) {
    const why = guard(d);
    if (why) return why;
  }
  return null;
}

/** Hears of a drawing's tab closing, or of the drawing being opened again in its place (`next`: a revert, a reload). */
export function onDrawingClosed(fn: (d: DrawingRef, next: DrawingRef | null) => void): void {
  closeHooks.push(fn);
}

export function drawingClosed(d: DrawingRef, next: DrawingRef | null): void {
  for (const fn of closeHooks) fn(d, next);
}

/** Adds a mark and right-click rows to each layer in the Layers list (it redraws on the store's "layer" event). */
export function registerLayerExtension(ext: LayerExtension): void {
  layerExtensions.push(ext);
}

/** Adds rows to the drawing's right-click menu: `rows` is given the object under the pointer (null over empty space) and gives the feature's rows for it, shown with the object's own commands. */
export function registerContextRows(rows: (under: string | null) => readonly Row[]): void {
  contextRows.push(rows);
}

/** Adds plug-in kinds the feature draws: `drivers` gives them as they are now (installed ones come and go). */
export function registerPluginDrivers(drivers: () => readonly PluginDriver[]): void {
  driverSources.push(drivers);
}

/** Runs `run` at start-up when the page's URL has ?param=value (share links, invites, checkout returns). */
export function registerUrlHandler(param: string, run: (value: string, params: URLSearchParams, ctx: AppContext) => void): void {
  urlHandlers.push({ param, run });
}

/** The running editor (null before it has started). */
export function appContext(): AppContext | null {
  return ctx;
}

/** Where the open drawing came from (null for a file on disk, or with none open). */
export function documentSource(): DocumentSource | null {
  return source;
}

// ---- called by the editor ------------------------------------------------------

/** A file the user gave has come in (`error` null), into the drawing in front, or could not be read. */
export function fileIn(file: Blob | Uint8Array, name: string, error: string | null = null): void {
  for (const fn of fileHooks) fn({ file, name, error });
}

export function extensionMenus(): readonly ExtensionMenu[] {
  return menus;
}

export function extensionPalettes(): readonly PaletteSpec[] {
  return palettes;
}

export function extensionLayerMarks(layerId: string): { readonly html: string; readonly title: string; readonly cls?: string }[] {
  return layerExtensions.flatMap((e) => {
    const m = e.mark?.(layerId);
    return m ? [m] : [];
  });
}

/** Makes the Plug-in Insertion tool place the plug-in `name` next (a feature's menu row picks it, then picks the tool). */
export function preferPluginDriver(name: string): void {
  wantedDriver = name;
}

/** The plug-in a feature asked the Plug-in Insertion tool to place, once. */
export function takePreferredDriver(): string | null {
  const name = wantedDriver;
  wantedDriver = null;
  return name;
}

export function pluginDrivers(): readonly PluginDriver[] {
  return driverSources.flatMap((d) => [...d()]);
}

/** The driver for plug-in objects whose parameters' format is named `name`, if a feature has one. */
export function pluginDriver(name: string): PluginDriver | undefined {
  return pluginDrivers().find((d) => d.name === name);
}

const editFollowers: ((session: EditSession) => void)[] = [];
let followQueued = false;
let following = false;

/**
 * Has `follow` called after each new edit (not an undo, a redo or someone else's change), once what made the
 * edit has finished, to keep what's drawn from other objects up with them; it edits in session.followOn so
 * that undo turns both back together.
 */
export function followEdits(follow: (session: EditSession) => void): void {
  editFollowers.push(follow);
}

type ModifierSource = (doc: VwxDocument, modelLayer: string, scope: string) => SiteModifier[];
const modifierSources: ModifierSource[] = [];

/** Plug-ins that say how they go on the ground themselves: Send to Surface asks them first. Heights are above the object's layer. */
export type SurfaceSender = (s: EditSession, o: ObjectInfo, height: (x: number, y: number) => number | null) => boolean;
const surfaceSenders: SurfaceSender[] = [];
export function registerSurfaceSender(fn: SurfaceSender): void {
  surfaceSenders.push(fn);
}
export const sentToSurface: SurfaceSender = (s, o, height) => surfaceSenders.some((fn) => fn(s, o, height));

/** An object a feature lets AEC > Create Objects from Shapes make on each closed shape: its name in the Object type list, what its Style says, and the making, as part of a batch (its id). */
export interface ShapeObjectMaker {
  readonly label: string;
  readonly style: string;
  make(s: EditSession, layerId: string, ring: readonly Pt[]): string;
}
const shapeMakers: ShapeObjectMaker[] = [];
export function registerShapeObject(maker: ShapeObjectMaker): void {
  shapeMakers.push(maker);
}
export const shapeObjectMakers = (): readonly ShapeObjectMaker[] => shapeMakers;

/** Other objects that act as site modifiers (the Grade tool's, when asked to). */
export const registerModifierSource = (source: ModifierSource): void => {
  modifierSources.push(source);
};

export const otherSiteModifiers = (doc: VwxDocument, modelLayer: string, scope: string): SiteModifier[] => modifierSources.flatMap((source) => source(doc, modelLayer, scope));

const siteFollowers: ((s: EditSession) => void)[] = [];

/** What runs once a site model has been updated, in the same batch: objects reading their heights from it. */
export const afterSiteUpdate = (follow: (s: EditSession) => void): void => {
  siteFollowers.push(follow);
};

export const siteModelsUpdated = (s: EditSession): void => {
  for (const follow of siteFollowers) follow(s);
};

/** Tells the followers of an edit to the open drawing, if it's still the open one by the time the edit has finished. */
export function editMade(session: EditSession, e: ChangeEvent, stillOpen: () => boolean): void {
  if (e.origin || following || followQueued || !editFollowers.length) return;
  followQueued = true;
  queueMicrotask(() => {
    followQueued = false;
    if (!stillOpen()) return;
    following = true;
    try {
      for (const follow of editFollowers) follow(session);
    } catch (err) {
      // what can't keep up stays as it was drawn: a layer checked out to someone else, say
      console.warn(err);
    } finally {
      following = false;
    }
  });
}

export function extensionLayerRows(layerId: string): Row[] {
  return layerExtensions.flatMap((e) => [...(e.rows?.(layerId) ?? [])]);
}

export function extensionContextRows(under: string | null): Row[] {
  return contextRows.flatMap((rows) => [...rows(under)]);
}

export function drawExtensionOverlays(p: Painter): void {
  for (const draw of overlays) {
    p.ctx.save();
    try {
      draw(p);
    } catch (err) {
      console.error("openvwx: overlay failed", err);
    }
    p.ctx.restore();
  }
}

export function view3dCreated(v: View3D): void {
  for (const fn of view3dHooks) fn(v);
}

export function mountExtensionChrome(
  welcomeSlots: Record<WelcomeSlot, HTMLElement>,
  recentSource: () => ShowRecent,
  topbarLeft: HTMLElement,
  topbarRight: HTMLElement,
): void {
  for (const { build, slot } of welcome) welcomeSlots[slot].append(build());
  for (const watch of recentSources) watch(recentSource());
  for (const { build, side } of topBar) {
    const host = side === "left" ? topbarLeft : topbarRight;
    host.prepend(build());
  }
  const info = topbarLeft.querySelector(".file-info");
  for (const build of fileBadges) info?.append(build());
}

export function appStarted(context: AppContext): void {
  ctx = context;
  for (const fn of ready.splice(0)) fn(context);
  const params = new URLSearchParams(location.search);
  for (const h of urlHandlers) {
    const value = params.get(h.param);
    if (value !== null) h.run(value, params, context);
  }
}

export function documentChanged(session: EditSession | null, next: DocumentSource | null): void {
  source = next;
  for (const fn of docHooks) fn(session, next);
}

const READS = new Set(["applyRemote", "doc", "dirty", "canUndo", "canRedo", "onChange", "onStep", "markSaved", "canAdd", "canAddMeshes", "copyObjects", "setLayerGuard"]);

/** A session whose edits do nothing (with a note saying so), for drawings opened view only. */
export function readOnlySession(session: EditSession, refused: () => void): EditSession {
  return new Proxy(session, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop !== "string" || READS.has(prop) || typeof value !== "function") {
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      }
      return (): unknown => {
        refused();
        return prop === "batch" || prop.endsWith("Objects") || prop === "ungroupObjects" ? [] : "";
      };
    },
  });
}
