// Shared contract between the format library (src/core), the editor UI
// (src/app) and exporters (src/export). Coordinates are document units
// (millimetres in VW metric files) with y pointing UP.

import type { VwxSink, WriteOptions, Written } from "./container.ts";

export interface Pt {
  x: number;
  y: number;
}

/** Axis-aligned bounds, x0 <= x1 and y0 <= y1. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * What a viewport crops to on the sheet: a box, and inside it the outline of the viewport's crop
 * object when it has one (a polygon, a rounded rectangle, a rectangle smaller than the box).
 */
export interface Clip extends BBox {
  outline?: readonly Pt[];
}

export type Visibility = "visible" | "hidden" | "grayed";

/**
 * 2D affine transform, same convention as canvas/DOMMatrix:
 * x' = a·x + c·y + e,  y' = b·x + d·y + f.
 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** A document colour, for colour pickers. */
export interface ColorInfo {
  /** value for the colour fields of Attributes */
  index: number;
  /** CSS colour, "#rrggbb" */
  css: string;
  /** colour name from the document, "" when it has none */
  name: string;
}

/**
 * Objects on the clipboard. Plain JSON, so it can travel through the system
 * clipboard and be pasted into another document (classes are matched by name).
 */
export interface ClipboardData {
  readonly format: "openvwx-objects-1";
  /**
   * Copied subtrees in pre-order: record bytes (base64), parent position in
   * this list (-1 = top level) and class name ("" for attached aux records,
   * which are pasted untouched). Line types, symbols, fill resources, fonts,
   * text styles, textures and attached records' formats are matched by name,
   * and colours by their value, so objects keep them in another drawing.
   */
  readonly records: readonly {
    readonly data: string;
    readonly parent: number;
    readonly className: string;
    readonly lineType?: string;
    readonly symbol?: string;
    /** the hatch, tile, gradient or image fill an object's fill names */
    readonly fill?: string;
    /** a text's font */
    readonly font?: string;
    /** the text style a text follows */
    readonly textStyle?: string;
    /** the material a rectangle, arc, polygon, polyline, extrude, 3D polygon, solid or plug-in has */
    readonly material?: string;
    /** an object's fill foreground and background and pen foreground and background colours, as CSS */
    readonly colors?: readonly string[];
    /** an attached record's format */
    readonly format?: string;
    /** a 3D object's texture settings: the texture each part names, "" for none or the class's */
    readonly textures?: readonly string[];
    /**
     * a top-level object's: the elevation of the design layer it was copied from (mm, 0 from a
     * symbol), which its heights include; a paste onto a layer at another elevation keeps its
     * height above its layer
     */
    readonly elevation?: number;
  }[];
  /** bounds of the copied objects */
  readonly bbox: BBox | null;
  /**
   * The open drawing it was copied from, for as long as this editor has it open: walls, slabs,
   * plug-in objects and lights, and what is drawn inside plug-ins, name that drawing's resources
   * in ways not all known yet, so they paste back into it only.
   */
  readonly drawing?: string;
}

/**
 * A texture as it goes from one open drawing to another (Import Resources): its records in
 * pre-order (their bytes, shared with the drawing it came from and not to be changed, and parent
 * position, with a shader's settings naming their record format), and those record formats' own
 * records, each with the kind of list it sits in, to bring along when the other drawing lacks them.
 */
export interface TextureData {
  readonly records: readonly { readonly data: Uint8Array; readonly parent: number; readonly format?: string }[];
  readonly formats: readonly { readonly name: string; readonly list: string; readonly records: readonly { readonly data: Uint8Array; readonly parent: number }[] }[];
}

/** An image to make a texture of (addImageTexture). */
export interface ImageTextureSpec {
  /** a PNG or JPEG */
  readonly image: Uint8Array;
  readonly mime: "image/png" | "image/jpeg";
  /** its size in pixels */
  readonly width: number;
  readonly height: number;
  /** how wide it is in the model, in mm (its height in proportion) */
  readonly size: number;
  /** its average colour, 0–255 a channel, which a plain view shows for it */
  readonly color: readonly [number, number, number];
  /** square PNGs of it, 256 and 64 pixels across, for the resource browser */
  readonly previews: { readonly large: Uint8Array; readonly small: Uint8Array };
}

/** A symbol definition (resource). */
export interface SymbolInfo {
  /** name-table index of the definition (stable id) */
  index: number;
  name: string;
  /** name of the symbol folder it is in, "" at the top level */
  folder: string;
  /** the folders it is in, the outermost first (empty at the top level) */
  folders?: string[];
  /** bounds of its geometry in symbol coordinates (the insertion point is 0,0) */
  bbox: BBox | null;
}

/** Where arrangeObjects moves objects within their container's stacking order. */
export type Arrange = "front" | "back" | "forward" | "backward";

export type ShapeKind = "line" | "rect" | "polygon" | "polyline" | "arc" | "text" | "image" | "locus" | "light";

/** Decoded geometry of one drawable object, in world coordinates. */
export interface Shape {
  kind: ShapeKind;
  /** line: 2 pts; rect: 4 corners (CCW from bottom-left); locus and light: its point; polygon/polyline: vertices
   *  (polyline beziers already flattened to points). Empty for arc/text/image. */
  points: Pt[];
  closed: boolean;
  bbox: BBox | null;
  /** polyline: indices of points whose edge to the next point is hidden (fills still use it) */
  hidden?: number[];
  /** polyline: its vertices as stored, before the curves are flattened into `points`; an arc vertex's radius (0 as large as fits) */
  vertices?: { p: Pt; kind: VertexKind; radius: number }[];
  /** arc */
  center?: Pt;
  rx?: number;
  ry?: number;
  /** math angles in degrees: 0 = +x, counter-clockwise positive */
  startAngle?: number;
  sweepAngle?: number;
  /** text */
  text?: string;
  /** text: its lines as Vectorworks laid them out, when it wrapped them (else split text on CR) */
  lines?: string[];
  /** text: the point the justification is placed at */
  anchor?: Pt;
  /** text: size in world units (point size x 0.3528 mm x layer scale) */
  textSize?: number;
  /** text: baseline angle in degrees, counter-clockwise from +x */
  textAngle?: number;
  /** text: 1 left, 2 centre, 3 right */
  hAlign?: number;
  /** text: 1 top, 2 top baseline, 3 centre, 4 bottom baseline, 5 bottom */
  vAlign?: number;
  /** text: its font, an index into the document's font list (VwxDocument.fonts) */
  fontIndex?: number;
  /** text: the name index of the text style it follows (a "text-style" resource), when it has one; -2 for its class's */
  textStyle?: number;
  /** text: drawn bold, italic or underlined (texts and worksheet cells) */
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /**
   * image: raw PNG/JPEG bytes. A picture left in its file as the drawing opened (heldImage) has
   * them here only while withHeldImages runs; imageBytes() reads them whenever.
   */
  image?: Uint8Array;
  imageMime?: string;
  /** image: a picture left in its file as a big drawing opened (core/held.ts), and whether its white shows as clear */
  heldImage?: { readonly table: number; readonly index: number; readonly length: number; readonly mime: number; readonly clear: boolean };
  /** light: its kind, whether it is on, and where it shines seen from above (shorter the steeper, 0 straight down) */
  light?: { kind: "point" | "directional" | "spot"; on: boolean; aim: Pt };
  /** rounded rectangle (drawn as its outline in `points`): its frame's corners counter-clockwise from its origin, and its corner radii as drawn (each at most half the side) */
  roundRect?: { corners: Pt[]; rx: number; ry: number };
}

/** Pen/fill attributes (raw Vectorworks values; see FORMAT.md). */
/**
 * Attributes an object can take from its class ("Class Style"): the fill (pattern and colours),
 * the pen's line style, its colours, its weight, and the fill and pen opacity.
 */
export type ByClassGroup = "fill" | "lineStyle" | "penColor" | "lineWeight" | "opacity";

export interface Attributes {
  /** i32: 0 = no pen (None), 2 = solid, negative = dash style index */
  lineStyle: number;
  /** line weight, mils (1/1000 inch) */
  lineWeight: number;
  /**
   * fill pattern: 0 = none, 1 = solid (others are raw VW pattern indices). A solid fill shows
   * fillBack, in plan, in 3D and in renders, as Vectorworks draws it: to colour an object, set
   * fillPattern 1 and fillBack and fillFore both to the colour (EditSession.addColors gives its index)
   */
  fillPattern: number;
  /** colour indices into the document palette (see VwxDocument.color()): a pattern's lines */
  fillFore: number;
  /** a solid fill's colour, and a pattern's background */
  fillBack: number;
  penFore: number;
  penBack: number;
  /** 0..100 */
  fillOpacity: number;
  penOpacity: number;
}

/** A worksheet cell as stored: what the Worksheet editor shows and edits. */
export interface SheetCell {
  /** 0-based worksheet row and column */
  row: number;
  col: number;
  kind: "text" | "number" | "formula";
  /** what it shows: its text, or its number or formula result as the cell's format shows it */
  display: string;
  /** a number cell's value, or a formula's cached number; null otherwise */
  value: number | null;
}

/** A worksheet's rows and columns as stored, before database rows are expanded. */
export interface WorksheetContents {
  /** name index of the worksheet */
  index: number;
  name: string;
  cols: number;
  rows: number;
  /** per row: true for a database row (its cells are column formulas over its objects), which isn't edited here */
  database: boolean[];
  cells: SheetCell[];
}

/** A cell of a worksheet made anew (createWorksheet): its value and how it shows. */
export interface NewSheetCell {
  /** a number makes a number cell, a string a text cell */
  value: string | number;
  bold?: boolean;
  align?: "left" | "center" | "right";
  /** a number's format: 0 general, 5 dimension (in the document's units), 11 area */
  format?: number;
  /** decimal places, or for imperial dimensions the power of two of the fraction (4: 1/16") */
  accuracy?: number;
}

/** A worksheet made anew: its columns' widths and its plain rows' cells, null for empty. */
export interface NewWorksheet {
  name: string;
  /** points */
  widths: number[];
  /** points */
  rowHeight: number;
  rows: (NewSheetCell | null)[][];
}

export interface LayerInfo {
  id: string; // stable GUID
  name: string; // design: layer name; sheet: sheet number
  title: string; // sheet title ("" for design layers)
  kind: "design" | "sheet";
  scale: number; // e.g. 50 for 1:50
  visibility: Visibility;
  objectCount: number;
  /** a design layer's elevation, mm */
  elevation?: number;
  /** a design layer's story (its name index), 0 for none */
  story?: number;
  /** a design layer's view as saved with it (Top/Plan or a 3D view) */
  view?: LayerView;
  /** a sheet layer's page (Page Setup), mm, centred on its origin */
  page?: PageSize;
}

/** A page's size, mm. */
export interface PageSize {
  width: number;
  height: number;
}

export type Vec3 = readonly [number, number, number];

/** A design layer's view as Vectorworks saves it with the layer, which it opens the layer in. */
export interface LayerView {
  /** Top/Plan, or a 3D view's projection (oblique ones read as "other") */
  projection: "plan" | "orthogonal" | "perspective" | "other";
  /** Vectorworks' number for the render mode: 0 wireframe, 6 hidden line, 7 dashed hidden line, 11 OpenGL (shaded) */
  renderMode: number;
  /** the screen's right, up and toward-the-viewer directions in the model (x, y and z in Top/Plan) */
  right: Vec3;
  up: Vec3;
  toward: Vec3;
  /** a perspective view's eye, or the point an orthogonal view is centred on, mm */
  at: Vec3;
}

/** A Renderworks camera (Visualization palette, Cameras): where it looks from and to, in the model, mm. */
export interface CameraInfo {
  id: string;
  /** its Name parameter */
  name: string;
  /** the design or sheet layer it is on */
  layerId: string;
  /** the sheet viewport it belongs to, when it is a viewport's camera */
  viewportId?: string;
  eye: Vec3;
  target: Vec3;
  /** the angle its picture spans across, degrees */
  viewAngle: number;
  /** its picture's width over its height */
  aspect: number;
  perspective: boolean;
}

/** A story: a floor of the building, with design layers on it (Organization's Stories tab). */
export interface StoryInfo {
  /** name index */
  index: number;
  name: string;
  /** what its layers' names may start with, e.g. "2" */
  suffix: string;
  /** mm */
  elevation: number;
  /** its levels (finish floor, top of slab, ...): each at an elevation above the story's, maybe naming the design layer there */
  levels: { type: string; elevation: number; layer: string }[];
  /** ids of the design layers on it */
  layers: string[];
}

/** A story's level as editStory sets it; `from` is the place among the story's levels of the one it was (a new one has none). */
export interface StoryLevelSpec {
  type: string;
  /** above the story's, mm */
  elevation: number;
  /** the name of the design layer at it, "" for none; one on the story */
  layer: string;
  from?: number;
}

/** One of renameMany's renames: a class, story or resource by its name index, or a layer by its id (a sheet layer's title too, kept when left out). */
export type Rename =
  | { kind: "class" | "story" | "resource"; index: number; name: string }
  | { kind: "layer"; id: string; name: string; title?: string };

/** What Tools > Utilities > Purge removes. */
export type PurgeKind = "symbols" | "classes" | "duplicates";

/** What Purge finds unused or duplicated. */
export interface Purgeable {
  /** symbol definitions placed nowhere, or only inside other unused ones, that no record names as text */
  symbols: number[];
  /** classes no record, viewport or style uses and no record names as text; never "None" */
  classes: number[];
  /** unnamed objects identical to an earlier one in the same layer or group (which stays), by id */
  duplicates: string[];
}

export interface ClassInfo {
  index: number; // name-table index (stable id)
  name: string;
  visibility: Visibility;
  objectCount: number;
  /** what objects set to take their attributes from the class ("Class Style") draw with; null when the record is too short */
  attrs: Attributes | null;
  /** the RenderWorks texture objects set to "by class" show: a texture's name index, 0 for none */
  texture: number;
  /** the text style texts set to "Class Text Style" follow: a text style's name index, 0 for none */
  textStyle: number;
}

/** Text formatting that setTextStyle can change (see Shape for the values). */
export interface TextStyle {
  size?: number;
  hAlign?: number;
  vAlign?: number;
  angle?: number;
  /** a font's name: one in the document's font list, or one added to it */
  font?: string;
  /**
   * the name index of a text style to follow, 0 for none (the face, size and alignment are set
   * apart), or TEXT_STYLE_BY_CLASS (−2) for the class's text style
   */
  textStyle?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface ObjectInfo {
  id: string; // stable GUID of the record
  type: number; // raw VW object type
  typeName: string;
  kind: ShapeKind | "group" | "symbol" | "other";
  layerId: string;
  /** id of the enclosing group / symbol instance, null if directly on the layer */
  parentId: string | null;
  classIndex: number;
  className: string;
  /** the name it is given (Object Info's Name), when it has one */
  name?: string;
  /** null for containers and undecoded objects */
  shape: Shape | null;
  attrs: Attributes | null;
  /** objects with attributes: the attribute groups they take from their class */
  byClass?: ByClassGroup[];
  /** symbol instance: index of its definition (SymbolInfo.index) */
  symbol?: number;
  /** symbol instance or plug-in object: where its insertion point lies */
  insertion?: Pt;
  /** symbol instance or plug-in object: how far it's turned, degrees */
  turned?: number;
  /** worksheet image: name index of the worksheet it shows (WorksheetContents.index) */
  worksheet?: number;
  /** inside a sheet-layer viewport: what it is cropped to on the sheet (the crop object for the drawing, the box for annotations) */
  clip?: Clip;
  /** the classes of the plug-ins, symbols and viewports it sits in, outermost first */
  inClasses?: readonly number[];
  /** inside a sheet-layer viewport: how much the viewport shrinks its drawing (1/scale), which hatch and tile patterns shrink by too */
  patternScale?: number;
  /** how the object lays its gradient, tile or hatch fill, when it says */
  fillMap?: FillMapping;
  /** part of a 3D solid (an extrude's profile), or a 3D polygon: Top/Plan draws its edges and no fill */
  wireframe?: boolean;
  /** a 3D object: where it lies in plan (from its geometry), as placed, which picking and moving go by */
  bounds?: BBox;
  /** a mesh: the lines Top/Plan draws of it, in pairs of points; it has no shape to edit */
  planLines?: readonly Pt[];
  /** lines, arcs, polygons and polylines: the markers drawn at their first and last points (only those that show) */
  markers?: LineMarkers;
  /** the drop shadow it casts, when it casts one */
  shadow?: DropShadow;
}

/**
 * A drop shadow: a blurred copy of the object, offset and drawn under it. Sizes are paper inches,
 * as line-type dashes are: a layer or viewport at 1:n casts it n times further.
 */
export interface DropShadow {
  blur: number;
  offset: number;
  /** degrees counter-clockwise from +x: the direction the shadow falls */
  angle: number;
  /** colour index */
  color: number;
  /** percent */
  opacity: number;
}

/** How a line marker looks: a filled closed arrowhead, a filled dot or a slash (an architectural tick). */
export type MarkerStyle = "arrow" | "dot" | "slash";

/**
 * A marker at one end of a line, arc, polygon or polyline, drawn in the object's pen colour. Sizes
 * are paper inches, as line-type dashes are: a layer or viewport at 1:n draws it n times larger.
 */
export interface LineMarker {
  style: MarkerStyle;
  /** arrow: its length, tip to base along the line; slash: its whole length, centred on the end; dot: its diameter */
  size: number;
  /** degrees. arrow: each side's angle to the line (its base is 2·size·tan(angle) wide); slash: its turn from the line, counter-clockwise */
  angle: number;
  /** a dot's equals its size; 0 for the others */
  width: number;
}

/** The markers at an object's first point (start) and last point (end). */
export interface LineMarkers {
  start?: LineMarker;
  end?: LineMarker;
}

/**
 * How an object lays its pattern fill, in world coordinates. A linear gradient runs from `origin`
 * to `u`; a radial one is centred on `origin` and reaches `u`. Tiles and hatches are laid from
 * `origin` along the axes to `u` and `v` (25.4 mm each at the pattern's own size).
 */
export interface FillMapping {
  origin: Pt;
  u: Pt;
  v: Pt;
  /** gradient shape: 1 linear, 2 radial */
  shape: number;
}

/**
 * How a polyline vertex bends the outline, as the Polyline tool's modes place them: a corner, a
 * bezier control point, an arc rounding the corner (as large as fits) or a point an arc passes
 * through on its way from the previous vertex to the next.
 */
/** A polyline vertex: a corner, a bezier control point, a rounded corner (arc), a point an arc passes through, or a cubic spline point (one the curve passes through). */
export type VertexKind = "corner" | "bezier" | "arc" | "through" | "cubic";

/** How Simplify Polys takes vertices away: keeping the outline within a deviation, or those near a neighbour. */
export type SimplifyBy = "deviation" | "distance";

/** Geometry for creating objects (no ids, world coordinates). */
/**
 * Create Helix-Spiral's settings: the turns along the path or the pitch (mm between turns), the
 * radius (mm) at the path's start and end (a spiral when they differ), where the coil starts
 * (degrees from the right toward up, looking along the path), and whether it turns anticlockwise
 * seen looking along the path rather than clockwise.
 */
/** AEC > Terrain > Validate 3D Data's findings in a site model's 3D source data (3D polygons). */
export interface SourceDataReport {
  /** how many 3D polygons and points were looked at */
  polygons: number;
  points: number;
  /** each set of polygons with the same points, the first (backmost) the one to keep */
  duplicates: string[][];
  /** polygons with fewer than two different points */
  degenerate: string[];
  /** polygons with points repeated in a row, and how many Simplify Polys would take out */
  repeated: { id: string; count: number }[];
  /** places in plan with points at different heights: the heights, lowest first, and the polygons with them */
  vertical: { x: number; y: number; z: number[]; ids: string[] }[];
  /** points in more than one polygon, or twice in one (not in a row): the polygons with them */
  coincident: { x: number; y: number; z: number; ids: string[] }[];
}

export interface HelixOptions {
  by: "turns" | "pitch";
  value: number;
  startRadius: number;
  endRadius: number;
  startAngle: number;
  reverse: boolean;
}

/** What addObjects draws: a line, rect, roundrect, polygon, polyline, arc (a circle or an ellipse too), text, locus, light or image. */
export type NewShape =
  | { kind: "line"; a: Pt; b: Pt }
  | { kind: "rect"; x0: number; y0: number; x1: number; y1: number }
  /** rx and ry are the corner radii */
  | { kind: "roundrect"; x0: number; y0: number; x1: number; y1: number; rx: number; ry: number }
  | { kind: "polygon"; points: Pt[]; closed: boolean }
  /**
   * smooth makes the vertices between the ends curve control points (a closed one's all of them);
   * otherwise `vertices` gives each point's kind (corner when left out). An open polyline's ends
   * are corners whatever their kind. `hidden` lists the points whose edge to the next is not drawn
   * (as Vectorworks draws hatch strokes); fills still use those edges.
   */
  | { kind: "polyline"; points: Pt[]; closed: boolean; smooth?: boolean; vertices?: VertexKind[]; radii?: number[]; hidden?: number[] }
  /**
   * a circle is an arc with sweepAngle 360 (startAngle 0); radiusY makes it elliptical (radius is
   * then the x radius); angles are then parametric, as QuickDraw measures them
   */
  | { kind: "arc"; center: Pt; radius: number; radiusY?: number; startAngle: number; sweepAngle: number }
  /** hAlign and vAlign (as TextStyle's) and angle (degrees) are set about `at`, which stays its origin */
  | { kind: "text"; at: Pt; text: string; height: number; hAlign?: number; vAlign?: number; angle?: number }
  /** a 2D locus: a reference point that snaps and doesn't print */
  | { kind: "locus"; at: Pt }
  /**
   * a light object at `at`, `z` above its layer, shining along `direction` (straight down when left
   * out); its colour, brightness and a spot's cone are the drawing's own light's it copies
   */
  | { kind: "light"; at: Pt; z: number; light: Light3D["kind"]; direction?: Vec3 }
  /** a PNG or JPEG picture stretched over the rectangle; width and height are its pixels */
  | { kind: "image"; x0: number; y0: number; x1: number; y1: number; bytes: Uint8Array; mime: "image/png" | "image/jpeg"; width: number; height: number };

export interface DocumentInfo {
  fileName: string;
  createdWith: string;
  savedWith: string;
  build: number;
  records: number;
  units: string;
}

export type ChangeKind = "objects" | "layers" | "classes" | "all";

/** `del` records from `start` of the document's record list replaced by `add`. */
export interface SpliceRun {
  start: number;
  del: number;
  add: readonly Uint8Array[];
}

/**
 * One change to the document's record list, as collaboration sends it: `del`
 * records from `start` replaced by `add`, then each of `more` in turn. `removed`
 * holds the records taken out, for changes this session made (not sent: the
 * receiver has them); a session reports its own changes as one run.
 */
export interface SpliceOp extends SpliceRun {
  removed?: readonly Uint8Array[];
  kind: ChangeKind;
  ids: string[];
  /** a change to the file header too (document settings such as units), made with the records */
  header?: HeaderPatch;
  /**
   * further runs, each at the positions the runs before it left and at or after the records the
   * one before it put in (core/splice.ts: in order). A change made far apart (a class at the top of
   * the file and an object at its end) goes as the runs it changed, not one span over everything.
   */
  more?: SpliceRun[];
}

/**
 * Header bytes [at, at + bytes.length) set to `bytes`. `before` holds what they were, for changes
 * this session made (not sent: the receiver has them).
 */
export interface HeaderPatch {
  at: number;
  bytes: Uint8Array;
  before?: Uint8Array;
}

export interface ChangeEvent {
  kind: ChangeKind;
  /** affected object ids when kind === "objects" (may be empty = unknown/all) */
  ids: string[];
  /** set when the change isn't a new edit of this session's */
  origin?: "undo" | "redo" | "remote";
}

/** Read-only view of an open document. */
/** A dash style ("line type" resource) defined in the document. */
export interface LineType {
  /** the Attributes.lineStyle value that selects it (negative) */
  style: number;
  name: string;
  /** alternating dash and gap lengths in paper inches; empty draws solid */
  dashes: number[];
}

/**
 * One piece of 3D geometry for the 3D view, in world millimetres with z up
 * (design layer elevations already applied). An object can give several
 * pieces (one per colour or texture).
 */
/** A light object as the design layers place it (Visualization palette, Lights): in the model's frame, mm. */
export interface Light3D {
  /** the light object itself */
  id: string;
  /** the top-level object on its layer that holds it (the light, or the symbol or plug-in it is in) */
  objectId: string;
  layerId: string;
  classIndex: number;
  /** the name given to it, when it has one */
  name?: string;
  kind: "point" | "directional" | "spot";
  on: boolean;
  position: Vec3;
  /** where a spot or directional light shines, a unit vector */
  direction: Vec3;
  /**
   * its position and direction as its record has them, on its layer (its z above the layer, the
   * record's less the layer's elevation) or in its symbol: what Object Info shows
   */
  own: { position: Vec3; direction: Vec3 };
  /** CSS colour */
  color: string;
  /** 1 = 100 % */
  brightness: number;
  /** a spot's cone, full angles in radians: full brightness within `beam`, falling off to nothing at `spread` */
  spread: number;
  beam: number;
  /**
   * What places it: the drawing (on a layer, or in groups), a symbol (its definition holds it, and is
   * where it changes, in Edit Symbol) or a plug-in (which redraws it from its parameters: it doesn't
   * change on its own)
   */
  placedBy: "drawing" | "symbol" | "plugin";
  /**
   * A Spotlight lighting device (`objectId`) places it. Its light is the device's own: it is on, coloured,
   * bright, spread and aimed as the device's parameters say (Light On, RGBColor, Brightness, Field and Beam
   * Angle, Pan and Tilt), shines from the fixture's lens, and setLight changes those parameters.
   */
  device?: boolean;
}

/** What EditSession.setLight changes of a light object; angles in radians, as Light3D has them. */
export type LightChange = Partial<Pick<Light3D, "on" | "kind" | "color" | "brightness" | "spread" | "beam">> & {
  /** where it is, as Light3D.own has it */
  position?: Vec3;
  /** where a spot or directional light shines, as Light3D.own has it: any length but 0 */
  direction?: Vec3;
};

/** Where Cut 2D Section's plane cuts one object (EditSession.sectionCuts). */
export interface SectionCut {
  /** the object cut */
  id: string;
  classIndex: number;
  /** each part drawn with attributes of its own (the object, or a piece of a symbol or plug-in), and its cut chains */
  parts: { attrs: Attributes | null; chains: { points: Pt[]; closed: boolean }[] }[];
}

export interface Mesh3D {
  /** the top-level object on its layer (what selecting it in 3D picks) */
  objectId: string;
  layerId: string;
  classIndex: number;
  /** shaded faces: 9 floats (three xyz corners) per triangle, counter-clockwise seen from outside */
  triangles: Float32Array;
  /** visible edges: 6 floats (two xyz points) per segment */
  edges: Float32Array;
  /** CSS hex colour for shading */
  color: string;
  /** 0..1 */
  opacity: number;
  /** ResourceInfo.index of the texture applied, or -1 */
  texture: number;
  /**
   * where the texture's image falls, when the object places it itself (a mesh's UV map, a plane
   * mapping): u and v at each corner, 6 floats per triangle, in fractions of the image, v up. Without
   * them the view projects the image along each face's main axis.
   */
  uvs?: Float32Array;
  /** a wall's faces: drawn behind faces lying exactly on them (a door's frame, a cabinet's back) */
  recessed?: boolean;
  /**
   * when objectId is a plain group: the object in it, or in a group in it, that these faces belong
   * to (not a group itself), so 3D exports can write each as an object of its own
   */
  partId?: string;
  /**
   * when the object these faces belong to (objectId, or partId) is a symbol instance: where it
   * places its definition, so 3D exports can write the definition once and place it each time
   */
  instance?: SymbolPlacement;
}

/** A symbol instance as Mesh3D.instance gives it. */
export interface SymbolPlacement {
  /** the instance's id */
  id: string;
  /** its definition (SymbolInfo.index) */
  symbol: number;
  /**
   * 12 numbers placing the definition in the frame of what holds the instance (the drawing, or the
   * definition it is in): the images of the x, y and z axes, then where its origin goes (mm),
   * p' = x·r0 + y·r1 + z·r2 + t
   */
  matrix: readonly number[];
}

/** An object in a symbol definition, as VwxDocument.symbolModel3d names it. */
export interface SymbolMember {
  /** its own name, when it has one */
  name?: string;
  typeName: string;
  className: string;
  /** the group in the definition holding it; null for one the definition holds itself */
  parentId: string | null;
}

/**
 * The design layers' 3D model with its symbols kept, for exports that place them (SketchUp's
 * components): each symbol's faces once, in its own frame, and each top-level object's faces with
 * the symbols it places by their full matrix. Millimetres, z up, as Mesh3D.
 */
export interface ModelTree {
  /** the symbols placed, each placing only ones before it */
  symbols: { name: string; content: ModelTreeNode }[];
  /** the design layers' top-level objects that show anything in 3D, in the drawing's order */
  objects: (ModelTreeNode & { id: string; layerId: string })[];
}

export interface ModelTreeNode {
  pieces: ModelTreePiece[];
  instances: ModelTreeInstance[];
  /** the groups inside it, in its frame */
  groups: ModelTreeGroup[];
}

/** A group inside an object or a symbol. */
export interface ModelTreeGroup extends ModelTreeNode {
  /** the group's id */
  id: string;
  name?: string;
  classIndex: number;
}

/** A symbol placed. */
export interface ModelTreeInstance {
  /** index into ModelTree.symbols */
  symbol: number;
  /** 12 numbers: the images of the x, y and z axes, then where the symbol's origin goes, in the frame of what holds it */
  matrix: number[];
  /** the symbol instance's id */
  id: string;
  name?: string;
  classIndex: number;
}

/** One run of what an object shows, as a Mesh3D's, in the frame of the node holding it. */
export interface ModelTreePiece {
  classIndex: number;
  color: string;
  opacity: number;
  /** ResourceInfo.index of the texture applied, or -1 */
  texture: number;
  /** 9 numbers per triangle, counter-clockwise seen from outside */
  triangles: Float64Array;
  /** u and v at each corner (6 per triangle), when the object places its texture itself */
  uvs?: Float64Array;
  /** the faces the triangles were cut from, where the object keeps them (a mesh's): corners, and with uvs (u, v) at each */
  faces?: { corners: number[]; uvs?: number[] }[];
  /** an open 3D polygon: its points */
  line?: number[];
  /** a 3D locus: where it is */
  point?: number[];
}

export type ResourceKind =
  | "symbol"
  | "texture"
  | "hatch"
  | "tile"
  | "gradient"
  | "image-fill"
  | "material"
  | "line-type"
  | "wall-style"
  | "slab-style"
  | "roof-style"
  | "text-style"
  | "render-style"
  | "background"
  | "worksheet"
  | "record-format";

/** A named resource in the document's resource library. */
export interface ResourceInfo {
  /** name-table index (stable id; negative fill patterns and line styles select it as -index) */
  index: number;
  kind: ResourceKind;
  name: string;
  /** folder path inside the library ("" at the top), parts joined with "/" */
  folder: string;
  /** thumbnail Vectorworks stored with the resource, PNG or JPEG bytes */
  preview: Uint8Array | null;
  previewMime: string;
  /** the sizes in pixels of the previews it keeps (256 and 64 square for a hatch or gradient; 256 square and 128 by 32 for a line type) */
  previewSizes?: { width: number; height: number }[];
  /** textures: the image the shader tiles, when the file embeds one */
  image?: Uint8Array;
  imageMime?: string;
  /** textures: real-world width the image spans, mm (0 when unknown) */
  imageSize?: number;
  /** textures: the image's size in pixels, when its header gives it */
  imagePixels?: { width: number; height: number };
  /** textures: the transparency shader's mask, black where the image is clear */
  mask?: Uint8Array;
  maskMime?: string;
  /** hatches: their line families and colours */
  hatch?: HatchFill;
  /** tiles: the motif and how it repeats */
  tile?: TileFill;
  /** gradients: colour stops, by position */
  gradient?: GradientStop[];
  /** text styles: the face, size and alignment they give text */
  textStyle?: TextStyleDef;
}

/** What a text style sets: a font (its place in the font list), a size in points and the alignment (as Shape's). */
export interface TextStyleDef {
  fontIndex: number;
  points: number;
  hAlign: number;
  vAlign: number;
}

/** A text style as createTextStyle and editTextStyle take it: the font by name (added to the font list when missing). */
export interface TextStyleSpec {
  font: string;
  points: number;
  hAlign: number;
  vAlign: number;
}

/** A tile fill, in mm: `shapes` repeated at every i·u + j·v. */
export interface TileFill {
  u: Pt;
  v: Pt;
  shapes: Shape[];
}

/** A gradient colour stop: `at` from 0 to 1 along the gradient, `color` as #rrggbb. */
export interface GradientStop {
  at: number;
  color: string;
  /** 0 (clear) to 1 */
  opacity: number;
  /** where the blend to the next stop is half way, as a fraction of the gap to it (0.5 is even) */
  midpoint: number;
}

/**
 * A hatch: families of lines over a ground colour, in its own colours (not the object's). Sizes are
 * mm in the world, or on the paper when `page` is set: such a hatch keeps its size on the printed
 * sheet, so a layer or viewport at 1:n draws it n times larger.
 */
export interface HatchFill {
  lines: HatchLine[];
  page: boolean;
  /** colour index of the ground */
  background: number;
}

/**
 * One family of parallel hatch lines, in mm: lines through base + k·offset for
 * every integer k, running along `period`; each period draws its first `dash`
 * fraction (1 = solid).
 */
export interface HatchLine {
  base: Pt;
  period: Pt;
  offset: Pt;
  dash: number;
  /** colour index */
  color: number;
  /** pen weight, mils */
  weight: number;
}

/**
 * A viewport that draws layers live rather than from a cached copy: a plan viewport on a sheet
 * layer, or a design-layer viewport (a plug-in showing layers on a design layer).
 */
export interface ViewportView {
  /** the viewport object */
  id: string;
  /** coordinates of the layers it shows -> its own layer's (the sheet's, for a plan viewport) */
  m: Affine;
  /**
   * its crop on the sheet, which the drawing is cropped to; for a design-layer viewport, the box
   * round what it draws, which nothing is cropped to (`uncropped`)
   */
  clip: Clip;
  /** a design-layer viewport: nothing is cropped to its clip, and its own class can hide it */
  uncropped?: true;
  /** drawing scale (48 for 1:48); a design-layer viewport's is its layer's */
  scale: number;
  /** the layers it shows, in stacking order */
  layers: ViewportLayer[];
  /** class visibility the viewport sets, by class index; classes it does not list keep their own */
  classes: ReadonlyMap<number, Visibility>;
  /** how its data visualisations redraw objects, by object id (absent when it applies none) */
  styles?: ReadonlyMap<string, StyleOverride>;
}

/** A layer a viewport draws. */
export interface ViewportLayer {
  id: string;
  visibility: Visibility;
  /**
   * set on a layer a design-layer viewport shows from one of the viewport's own layers: placed by
   * `m` before the viewport's own m, with that design-layer viewport's class visibility over the
   * viewport's (`classes` holds both)
   */
  via?: { m: Affine; classes: ReadonlyMap<number, Visibility> };
}

/**
 * Fill and pen a data visualisation gives an object in a viewport; what it leaves out stays as the
 * object has it. Patterns and styles take Attributes' values; colours are CSS.
 */
export interface StyleOverride {
  fillPattern?: number;
  fillFore?: string;
  fillBack?: string;
  lineStyle?: number;
  pen?: string;
}

/** How a record field's value is stored and edited. Lengths are mm, areas mm², volumes mm³, angles degrees. */
export type FieldKind =
  | "integer"
  | "boolean"
  | "number"
  | "text"
  | "dimension"
  /** one of a fixed list of strings (a popup or radio buttons in Vectorworks) */
  | "choice"
  /** a class name */
  | "class"
  /** a layer name */
  | "layer"
  | "angle"
  | "area"
  | "volume"
  /** a colour palette index */
  | "color"
  /** a field openvwx can't read (value is "") */
  | "other";

export type RecordValue = number | boolean | string;

export interface RecordField {
  name: string;
  kind: FieldKind;
  value: RecordValue;
}

/** A field as the record format editor sets it: `value` is its default; `from` names the field it was, kept with its values. */
export interface RecordFieldSpec {
  name: string;
  kind: FieldKind;
  value: RecordValue;
  from?: string;
}

/** A parameter of a new plug-in format (addPluginObject): its Vectorworks type code (1 integer, 2 boolean, 3 number, 4 text, 7 dimension, 8 and 9 choices, 10 and 11 x and y coordinates, 14 static text, 18 class...), its name and its default value. */
export interface PluginFieldSpec {
  readonly name: string;
  readonly type: number;
  readonly value: RecordValue;
}

/** One texture part of an object, as Object Info's Render tab shows it. */
export interface TexturePart {
  /** Vectorworks' part id: 3 the whole object; walls, slabs, solids and some plug-ins hold further parts */
  readonly part: number;
  /** a texture's name index, 0 the class's texture, -1 none */
  readonly texture: number;
  /** the mapping method, as Vectorworks numbers it */
  readonly mapping: number;
  /** offset along the texture's width and height, mm */
  readonly offsetU: number;
  readonly offsetV: number;
  /** scale across and up (1 the texture's own size) */
  readonly scaleU: number;
  readonly scaleV: number;
  /** degrees */
  readonly rotation: number;
}

/** What setObjectTexture changes of a part. */
export type TexturePartChange = Partial<Pick<TexturePart, "texture" | "offsetU" | "offsetV" | "scaleU" | "scaleV" | "rotation">>;

/** One container's contents in a model brought in whole (addMeshModel): meshes, groups and placed symbols. */
export interface MeshNode {
  /** meshes, each a list of faces (flat x, y, z triples in mm, as addMeshes takes them) */
  readonly parts?: readonly (readonly (readonly number[])[])[];
  /** each part's attributes */
  readonly attrs?: readonly (Partial<Attributes> | undefined)[];
  /** each part's class */
  readonly classes?: readonly number[];
  /** each part's mesh's name, made unique as addMeshes makes them (none when absent or "") */
  readonly names?: readonly (string | undefined)[];
  /** each part's texture (a texture's name index) where it shows one by `uvs` */
  readonly textures?: readonly (number | undefined)[];
  /**
   * each textured part's place on its texture: for each face, (u, v) for each corner, as
   * fractions of the image across and up from its lower left
   */
  readonly uvs?: readonly (readonly (readonly number[])[] | undefined)[];
  /** groups it holds, each named (none when "") and in a class of its own when given */
  readonly groups?: readonly MeshGroupNode[];
  /** symbols it places */
  readonly instances?: readonly MeshInstance[];
  /** 3D polygons, each through its points (x, y, z triples in mm), closed or open, in a class of its own when given */
  readonly lines?: readonly { readonly points: readonly number[]; readonly closed: boolean; readonly classIndex?: number }[];
  /** 3D loci, each at x, y, z in mm, in a class of its own when given */
  readonly loci?: readonly { readonly at: readonly number[]; readonly classIndex?: number }[];
  /** 2D objects, as addObject makes them, in plan (mm), each with its attributes and in a class of its own when given */
  readonly shapes?: readonly { readonly shape: NewShape; readonly attrs?: Partial<Attributes>; readonly classIndex?: number }[];
}

export interface MeshGroupNode extends MeshNode {
  readonly name: string;
  readonly classIndex?: number;
}

/** A symbol an import makes of meshes (EditSession.addMeshSymbols). */
export interface MeshSymbolSpec {
  name: string;
  /** meshes, each a list of faces in the symbol's own frame (flat x, y, z triples in mm, as addMeshes takes them) */
  parts: readonly (readonly (readonly number[])[])[];
  /** each part's attributes */
  attrs?: readonly (Partial<Attributes> | undefined)[];
  /** its meshes' class, else None */
  classIndex?: number;
}

/** An element of a model import (EditSession.addMeshElements): its own meshes, or a symbol placed. */
export type MeshElement =
  | {
      /** meshes, each a list of faces (flat x, y, z triples in mm, z above the layer) */
      parts: readonly (readonly (readonly number[])[])[];
      attrs?: readonly (Partial<Attributes> | undefined)[];
      classIndex?: number;
    }
  | {
      /** the symbol's index (addMeshSymbols) */
      symbol: number;
      /** how it is placed: the images of its x, y and z axes, then where its origin goes (z above the layer), 12 numbers */
      matrix: readonly number[];
      classIndex?: number;
    };

/** An instance of one of a MeshModel's symbols. */
export interface MeshInstance {
  /** index into MeshModel.symbols; inside a symbol, only one made before it */
  readonly symbol: number;
  /** 12 numbers: the images of the x, y and z axes, then where the symbol's origin goes (mm): p' = x·r0 + y·r1 + z·r2 + t */
  readonly matrix: readonly number[];
  readonly name?: string;
  readonly classIndex?: number;
}

/** A model whose repeated parts are symbols (SketchUp's components), for addMeshModel. */
export interface MeshModel {
  /** the definitions to make, each placing only ones before it */
  readonly symbols: readonly { readonly name: string; readonly content: MeshNode }[];
  /** what goes on the layer */
  readonly top: MeshNode;
}

/** Values an object holds for one record format: a plug-in's parameters, or a record attached to the object. */
export interface ObjectRecord {
  /** name index of the record format (what setRecordField takes) */
  format: number;
  /** the format's name, e.g. "Door" */
  name: string;
  /** a plug-in object's own parameters (Vectorworks redraws the object from them) */
  parametric: boolean;
  fields: RecordField[];
}

/** A wall, as Object Info shows it: its control line (the model's frame, mm), thickness and heights. */
export interface WallInfo {
  start: Pt;
  end: Pt;
  thickness: number;
  /** its top and bottom, z above its layer */
  top: number;
  bottom: number;
  /** the wall style it follows, or null */
  style: string | null;
}

/** A wall a new wall can copy (EditSession.wallTemplates). */
export interface WallTemplate {
  /** the wall copied */
  id: string;
  /** its wall style, or null */
  style: string | null;
  thickness: number;
  /** its top less its bottom */
  height: number;
  /** where its faces lie across its control line, left of it positive: the right face, then the left */
  faces: [number, number];
}

/** A straight wall an import makes whole where it stands (EditSession.addPlainWalls). */
export interface PlainWallSpec {
  /** its control line, which runs down its middle */
  start: Pt;
  end: Pt;
  thickness: number;
  /** its foot and top, z above its layer */
  bottom: number;
  top: number;
  classIndex?: number;
  /** holes through it, each an outline in its elevation: x along its line from `start`, y up from its foot */
  openings?: readonly (readonly Pt[])[];
}

/** A door or window a new one can copy, with its opening in the wall (EditSession.wallInsertKinds). */
export interface WallInsertKind {
  /** the door or window copied */
  id: string;
  /** its plug-in's name ("Door", "Window") */
  name: string;
  /** how many of its kind the drawing's design layers hold in walls: the same plug-in and parameters, in walls of the same style and thickness */
  count: number;
  /** how far its drawing reaches along its wall */
  width: number;
  /** the style and thickness of the wall it is set in: a copy goes only in a wall of these */
  style: string | null;
  thickness: number;
  /** the corners of the box its drawing fills, along its wall's line from its middle and across it (left of the line positive) */
  outline: Pt[];
}

/** Where a new wall would join one already drawn (EditSession.wallJoinAt). */
export interface WallJoin {
  /** the wall joined */
  id: string;
  /** "corner": the new wall meets its end, the two mitred; "tee": it meets its side, and runs to its face */
  kind: "corner" | "tee";
  /** where the new wall's end goes: the joined wall's end for a corner; for a tee the point asked about, moved onto the wall's plan when just outside it */
  at: Pt;
}

/** A Heliodon's sun as its parameters set it (VwxDocument.heliodon). */
/** A linear dimension object (EditSession.linearDimension). */
export interface LinearDimensionInfo {
  /** the points it measures, `b` further along `u` than `a` */
  a: Pt;
  b: Pt;
  /** the way its dimension line runs (a unit vector), and how far that line lies from `a`, to the left of `u` */
  u: Pt;
  offset: number;
  /** the length it measures, along `u` */
  length: number;
  /** the value it shows */
  value: string;
}

export interface HeliodonSun {
  /** degrees, north positive */
  latitude: number;
  /** degrees, east positive */
  longitude: number;
  /** 1 to 12, and the day of the month */
  month: number;
  day: number;
  /** solar time, hours (12 at noon) */
  hour: number;
  /** its time is solar time; else clock time, in its time zone (and daylight saving) */
  solar: boolean;
  /** its time zone as it names it ("GMT -05:00 ..."), "" when it names none */
  zone: string;
  /** its clock is an hour ahead for daylight saving */
  daylightSaving: boolean;
  altitude: number;
  azimuth: number;
  /** sunrise and sunset as it shows them, "4:45" */
  sunrise: string;
  sunset: string;
}

/** A slab a new slab can copy (EditSession.slabTemplates). */
export interface SlabTemplate {
  /** the slab plug-in copied */
  id: string;
  /** its slab style, or null */
  style: string | null;
  /** how deep its 3D runs, top to bottom */
  thickness: number;
}

/** A kind of plug-in object a new one can copy (EditSession.pluginKinds). */
export interface PluginKind {
  /** the plug-in object copied */
  id: string;
  /** its plug-in's name ("StructuralMember", "Laubwerk Plant") */
  name: string;
  /** how many of them the drawing's design layers hold */
  count: number;
  /** its turn, degrees counter-clockwise from x */
  angle: number;
  /** the corners of the box its drawing fills, about its insertion point, as it is turned */
  outline: Pt[];
}

/** A slab or roof face, as Object Info shows it. */
export interface SlabInfo {
  thickness: number;
  /** the slab style it follows, or null */
  style: string | null;
}

/** What createViewport makes: a plan viewport on a sheet layer. */
export interface NewViewport {
  /** drawing scale (48 for 1:48) */
  readonly scale: number;
  /** its box on the sheet, which the drawing is cropped to */
  readonly box: BBox;
  /** the design point at the middle of the box */
  readonly at: Pt;
  /** the design layers it shows; one left out is hidden in it */
  readonly layers: readonly { readonly id: string; readonly visibility: Visibility }[];
  /** the class visibility it sets, None first; a class left out keeps its own */
  readonly classes: readonly { readonly index: number; readonly visibility: Visibility }[];
  /** its class; None when left out */
  readonly classIndex?: number;
}

/** A viewport's settings, as Object Info shows and edits them. */
export interface ViewportInfo {
  id: string;
  /** the name it is given, "" when it has none */
  name: string;
  /** a plan, drawn live from its design layers; else a section, elevation or 3D view, drawn from the copy the file caches */
  plan: boolean;
  /** drawing scale (48 for 1:48) */
  scale: number;
  /** its box on the sheet, which the drawing is cropped to */
  box: BBox;
  /** every design layer, in stacking order, with how this viewport shows it (one it doesn't list is hidden) */
  layers: { id: string; name: string; visibility: Visibility }[];
  /** the classes whose visibility it sets */
  classes: { index: number; visibility: Visibility }[];
}

export interface VwxDocument {
  readonly info: DocumentInfo;
  layers(): LayerInfo[];
  classes(): ClassInfo[];
  /** Drawable objects of a layer (groups expanded; containers listed too, shape=null). */
  objects(layerId: string): ObjectInfo[];
  object(id: string): ObjectInfo | null;
  /**
   * Opens a symbol definition for editing, or closes it (null). While it is open, objects(),
   * object() and the edit methods that take a layer id for new objects treat it as a layer, by
   * the id this returns (null when there is no such definition). Its contents are in symbol
   * coordinates, the insertion point at 0,0.
   */
  openSymbol(index: number | null): string | null;
  /**
   * Opens the annotations of sheet viewport `viewportId` for editing, or closes them (null). While
   * they are open, objects() and object() list them under the id this returns (their group's; null
   * when there is no such viewport), as a layer, and no longer on their sheet, and the edit methods
   * that take a layer id put new objects in them. Their coordinates are the sheet's times the
   * viewport's scale: a plan viewport's design point p is at its view of p plus its shift there.
   */
  openAnnotations(viewportId: string | null): string | null;
  /** CSS colour for a palette index ("#000000" if unknown). */
  color(index: number): string;
  /** Dash styles defined in the document; Attributes.lineStyle < 0 selects one. */
  lineTypes(): LineType[];
  /** Colours defined in the document (the colour table), in index order. */
  colors(): ColorInfo[];
  /** Font names in the document's font list, in the order texts name them (Shape.fontIndex). */
  fonts(): string[];
  /** symbol definitions, sorted by folder and name */
  symbolDefs(): SymbolInfo[];
  /** geometry of a symbol definition in symbol coordinates, for previews */
  symbolShapes(index: number): Shape[];
  /** Every resource in the library (symbols, textures, hatches, styles, ...). */
  resources(): ResourceInfo[];
  /** A worksheet's cells as stored (`index` its name index); null when there's none or it can't be read. */
  worksheetContents(index: number): WorksheetContents | null;
  /**
   * A worksheet's cell texts as it shows on a sheet, row by row: database rows expanded into their
   * subrows as last calculated (their header rows left out), a merged cell's text in its first
   * cell. Null when there's none or it can't be read.
   */
  worksheetRows(index: number): string[][] | null;
  /**
   * Plan viewports on a sheet layer, with the design layers they draw, or the design-layer
   * viewports on a design layer, with the layers they show.
   */
  viewports(layerId: string): ViewportView[];
  /**
   * How data visualisations redraw the drawings a sheet's sections, elevations and details cache
   * (objects of the sheet layer), by object id; null when none applies one.
   */
  viewportStyles(layerId: string): ReadonlyMap<string, StyleOverride> | null;
  /** 3D geometry of the design layers' objects (all layers; the viewer filters by visibility). */
  model3d(): Mesh3D[];
  /** The design layers' 3D model with its symbols kept, each defined once (see ModelTree); built on each call. */
  model3dTree(): ModelTree;
  /**
   * 3D geometry of a symbol definition's contents in its own coordinates (its insertion point at 0),
   * as model3d gives a layer's: each object it holds is a top-level one (objectId), the objects in its
   * groups parts (partId), and a symbol it places carries its placement. `members` names those
   * objects and the groups between, by id. Null when there is no definition `index`.
   */
  symbolModel3d(index: number): { meshes: Mesh3D[]; members: ReadonlyMap<string, SymbolMember> } | null;
  /** Every viewport on a sheet layer, plans, sections and details alike, in stacking order. */
  viewportIds(layerId: string): string[];
  /** Settings of a viewport (null when id isn't a viewport openvwx can read). */
  viewport(id: string): ViewportInfo | null;
  /** A wall's control line, thickness, heights and style (null when id isn't a wall openvwx can read). */
  wall(id: string): WallInfo | null;
  /** A slab's thickness and style (null when id isn't a slab openvwx can read). */
  slab(id: string): SlabInfo | null;
  /** A Heliodon's sun as its parameters set it, or null for any other object (or one whose parameters don't say a date and time). */
  heliodon(id: string): HeliodonSun | null;
  /** Plug-in parameters and attached records of an object, in file order (empty if none). */
  records(id: string): ObjectRecord[];
  /** The data records attached to a symbol definition (by its SymbolInfo.index), which instances placed after start with. */
  symbolRecords(index: number): ObjectRecord[];
  /** An object's texture parts; empty when it has none yet but can take a texture, null when it can't. */
  objectTextures(id: string): TexturePart[] | null;
  /** The stories, the top one first. */
  stories(): StoryInfo[];
  /** The Renderworks cameras placed in the drawing (on layers or in viewports), in file order. */
  cameras(): CameraInfo[];
  /** The light objects the design layers place (in symbols and plug-ins too), a Heliodon's sun left out. */
  lights3d(): Light3D[];
  /** Whether the drawing has the parameters' format of a plug-in of this name: cheap, before looking for its objects. */
  hasPluginFormat(name: string): boolean;
  /** The data record formats objects can have attached (not plug-in parameters), by name. */
  recordFormats(): { format: number; name: string }[];
  /** A data record format's fields with their default values; null for a plug-in's or one that can't be read. */
  recordFormatFields(format: number): RecordField[] | null;
  /** Serialise to .vwx bytes. Throws when parts of it were left in its file as it opened (holdsParts): write() writes those. */
  toBytes(): Uint8Array;
  /** Whether parts of it are still in the file it was opened from, or another (held.ts): only write() can write it out. */
  holdsParts(): boolean;
  /** Writes it out as .vwx to `sink` a slice at a time, held parts and all: the bytes toBytes() gives. */
  write(sink: VwxSink, options?: WriteOptions): Promise<Written>;
}

/** Mutating API with undo/redo. Every method is one undoable step. */
export interface EditSession {
  readonly doc: VwxDocument;
  readonly dirty: boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): void;
  redo(): void;
  /**
   * Runs `fn` as a batch that joins the last step, so that undo turns both back together: for what an edit
   * brings with it, such as a drawing kept up with what it's drawn from. With no step to join it's a batch.
   */
  followOn<T>(fn: () => T): T;
  /** How many steps undo can turn back now: a mark for joinSince. */
  readonly undoDepth: number;
  /**
   * Joins the steps made since undo was `depth` deep into one, so one undo turns them all back (a voice
   * command the agent carried out in several edits). Nothing when there are fewer than two, while a
   * batch runs, or when one of them changed the document's settings.
   */
  joinSince(depth: number): void;
  onChange(listener: (e: ChangeEvent) => void): () => void;
  markSaved(): void;
  /** Called with each change to the record list once it is made (edits, undo, redo); not for applyRemote. */
  onStep(listener: (op: SpliceOp) => void): () => void;
  /** The record list as it stands, for collaboration to read what a change replaces. Never change it or its records. */
  records(): readonly Uint8Array[];
  /**
   * Refuses changes to layers (Project Sharing's checkouts): before a change of this session's
   * (an edit, undo or redo; never applyRemote) takes effect, `guard` is asked with the ids of the
   * layers it touches (what they hold, or their own settings), and an answer that isn't null is
   * thrown as the change's error, leaving the drawing as it was (a batch rolls back). Changes to
   * symbol definitions, resources and document settings touch no layer. null takes it away.
   */
  setLayerGuard(guard: ((layerIds: readonly string[]) => string | null) | null): void;
  /**
   * Applies a change made elsewhere (a collaborator's), all its runs at once. Undo keeps turning
   * back this session's own steps that it doesn't touch; a step it touches, and those before it,
   * can no longer be undone.
   */
  applyRemote(op: SpliceOp): void;
  /**
   * Runs `fn`, whose applyRemote calls change the record list at once (records() shows each) but
   * rebuild the drawing and tell its listeners once, when `fn` returns: collaboration turning back
   * changes of its own, taking someone else's and making its own again costs one rebuild.
   */
  remoteBatch<T>(fn: () => T): T;

  // document settings
  /**
   * Sets the document's length unit (one of LENGTH_UNITS), and the area and volume units that go
   * with it, in the file header. Throws when the file keeps its units where openvwx can't change them.
   */
  setUnits(name: string): void;

  // layers
  createLayer(name: string, kind?: "design" | "sheet", scale?: number): string;
  /**
   * Navigation's Duplicate: a layer named `name` just after `layerId` in the stacking order, with its
   * settings (kind, scale, elevation, view or page, sheet title, visibility, all its record holds)
   * on no story, and a copy of everything on it; one undo step. Its id; throws, changing nothing,
   * when the layer holds an object Rodeo can't copy yet.
   */
  duplicateLayer(layerId: string, name: string): string;
  deleteLayer(layerId: string): void;
  renameLayer(layerId: string, name: string, title?: string): void;
  /** shows, hides or greys a layer: "visible", "hidden" or "grayed" (hide things this way, never by moving them) */
  setLayerVisibility(layerId: string, v: Visibility): void;
  setLayerScale(layerId: string, scale: number): void;
  /** the view a design layer is saved in, which Vectorworks opens it in */
  setLayerView(layerId: string, view: LayerView): void;
  /** a sheet layer's page (Page Setup), mm */
  setSheetPage(layerId: string, page: PageSize): void;
  /** a design layer's elevation, mm */
  setLayerElevation(layerId: string, elevation: number): void;
  /** puts a design layer on a story (name index), or on none (0); a level of the story it leaves no longer names it */
  setLayerStory(layerId: string, story: number): void;
  reorderLayers(layerIds: string[]): void;

  // stories
  /** a new story with no levels; returns its name index */
  createStory(name: string, suffix: string, elevation: number): number;
  renameStory(index: number, name: string): void;
  /** a new elevation moves the design layers on the story by as much */
  /**
   * `levels` replace its levels, in order; a design layer a level names is put at the story's
   * elevation plus the level's
   */
  editStory(index: number, change: { suffix?: string; elevation?: number; levels?: readonly StoryLevelSpec[] }): void;
  /** its design layers stay where they are, on no story */
  deleteStory(index: number): void;

  // hatches
  /**
   * A new hatch copied from hatch `like` (its tags too), or else from the drawing's first without
   * its tags; `previews` (PNGs by their width in pixels) replace the copy's. Returns its name index.
   */
  createHatch(name: string, hatch: HatchFill, previews: ReadonlyMap<number, Uint8Array>, like?: number): number;
  /** a hatch's lines, ground and page sizing; `previews` replace its previews of those widths */
  editHatch(index: number, hatch: HatchFill, previews: ReadonlyMap<number, Uint8Array>): void;
  /** refused while objects, classes or styles fill with it, or another record names it */
  deleteHatch(index: number): void;
  /**
   * A new gradient copied from gradient `like`, or else from the drawing's first gradient, or its
   * first hatch when it has none; `previews` (PNGs by their width) replace the copy's. Returns its
   * name index.
   */
  createGradient(name: string, stops: readonly GradientStop[], previews: ReadonlyMap<number, Uint8Array>, like?: number): number;
  /** a gradient's stops; `previews` replace its previews of those widths */
  editGradient(index: number, stops: readonly GradientStop[], previews: ReadonlyMap<number, Uint8Array>): void;
  /** refused while objects, classes or styles fill with it, or another record names it */
  deleteGradient(index: number): void;
  /**
   * A new line type copied from line type `like`, or else from the drawing's first; `dashes` are
   * its dash and gap lengths in paper inches, and `previews` (PNGs by their width) replace the
   * copy's. Returns its name index.
   */
  createLineType(name: string, dashes: readonly number[], previews: ReadonlyMap<number, Uint8Array>, like?: number): number;
  /** a line type's dash and gap lengths (paper inches); `previews` replace its previews of those widths */
  editLineType(index: number, dashes: readonly number[], previews: ReadonlyMap<number, Uint8Array>): void;
  /** refused while objects, classes or styles draw with it, or another record names it */
  deleteLineType(index: number): void;
  /**
   * A new text style named `name`: a copy of the text style with name index `like` (a duplicate),
   * else of the drawing's first, else built on a hatch's or gradient's header and previews; its
   * previews are replaced by `previews`. Returns its name index.
   */
  createTextStyle(name: string, style: TextStyleSpec, previews: ReadonlyMap<number, Uint8Array>, like?: number): number;
  /**
   * A text style's font, size and alignment; `previews` replace its previews of those widths. The
   * texts that follow it (by name, or as their class's text style) take what changed: the font and
   * alignment as the style has them, their size scaled as the style's is.
   */
  editTextStyle(index: number, style: TextStyleSpec, previews: ReadonlyMap<number, Uint8Array>): void;
  /** refused while texts or classes follow it, or another record names it */
  deleteTextStyle(index: number): void;

  // classes
  createClass(name: string): number;
  /** Navigation's Duplicate: a class named `name` with all of class `index`'s settings; its index */
  duplicateClass(index: number, name: string): number;
  renameClass(index: number, name: string): void;
  /** objects in the class move to "None" */
  deleteClass(index: number, into?: number): void;
  /** shows, hides or greys a class's objects everywhere: "visible", "hidden" or "grayed" */
  setClassVisibility(index: number, v: Visibility): void;
  /** Changes a class's attributes, which the objects taking them from the class (Class Style) draw with. */
  setClassAttributes(index: number, attrs: Partial<Attributes>): void;
  /** the class's RenderWorks texture: a texture resource's name index, 0 for none */
  setClassTexture(index: number, texture: number): void;
  /**
   * Changes one texture part of an object (`part` a TexturePart's id). An object without parts
   * takes a texture on the whole object (part 3), mapped as the drawing's objects of its type
   * mostly are.
   */
  setObjectTexture(id: string, part: number, change: TexturePartChange): void;
  /**
   * Changes a light object: whether it is on, its kind, colour (#rrggbb), brightness (1 = 100 %), a
   * spot's spread and beam (a spread narrowed past the beam takes the beam with it), where it is and
   * where it shines. A light in a symbol changes while its definition is open (openSymbol); one a
   * plug-in places doesn't, except a lighting device's (Light3D.device: `id` is the light's or the
   * device's), whose on, colour, brightness, spread, beam and direction go into the device's parameters;
   * it can't be moved off its fixture or made another kind.
   */
  setLight(id: string, change: LightChange): void;
  /**
   * Points a Renderworks camera from `eye` at `target` (the model's frame, mm, as CameraInfo has
   * them): its matrix stands at the eye turned to the target, and its parameters follow; one undo step.
   * The lines of its plan drawing keep their length until Vectorworks redraws it.
   */
  setCameraView(id: string, eye: Vec3, target: Vec3): void;
  /**
   * Places a Renderworks camera on `layerId` (in class `classIndex`, else None) at `eye` looking at
   * `target`, as setCameraView points one: a copy of one the drawing has (there is no blank one to
   * start from), named "Camera n" after the cameras placed already. One undo step; its id.
   */
  addCamera(layerId: string, eye: Vec3, target: Vec3, classIndex?: number): string;
  /** True when the drawing has a Renderworks camera a new one can copy. */
  canAddCamera(): boolean;
  /**
   * The walls a new wall can copy, one per style, thickness and height: straight walls on design
   * layers with square ends and nothing set in them, so a copy stretched along a new line stays true.
   */
  wallTemplates(): WallTemplate[];
  /**
   * The wall on `layerId` (one directly on it) a new wall's end at `at` would join, else null: one
   * with an end within `reach` of `at`, or with `at` in its plan near an end (a corner), else one
   * with `at` in its plan, or within `reach` of it, between its ends (a tee).
   */
  wallJoinAt(layerId: string, at: Pt, reach: number): WallJoin | null;
  /**
   * Moves a straight wall's ends to `start` and `end`: each point of its plan drawing and 3D near
   * an end goes with that end, as it lay from it along and across the line, so its thickness,
   * components and mitred or cut ends keep their shape (the walls it joined keep theirs). The doors,
   * windows and symbols set in it, their openings and anything else between the ends keep their
   * place from the end that stays put (the start when both move), turning with the wall. Throws
   * for a wall holding other objects, or when an end would pass through a door or window. One undo
   * step.
   */
  setWallLine(id: string, start: Pt, end: Pt): void;
  /**
   * Joins two straight walls already drawn, beside each other on a layer or in a group (the Wall Join
   * tool). `L` takes an end of each to where their lines cross and mitres the corner, as the Wall
   * tool mitres one (square past 150°); `T` runs an end of the first to the face of the second
   * toward the first's other end, cut along it, the second staying as it is; `X`, for walls crossing
   * between their ends, splits the first where they cross (splitWall) and runs each part to the
   * second's face toward it, as a tee; `no-trim` (Modify > Join (No Trim)) cuts nothing back: an L
   * when both stop short of where their lines cross, a tee into the side of one that runs past it,
   * refused when both do. The end that goes is the one past which the lines cross, else the one away
   * from the point `picks` gives on that wall (the click), else the nearer. Doors and windows keep their place as setWallLine keeps them. Throws
   * for walls that never meet, an end another wall meets already, a tee meeting a side at under 15°
   * or past the wall's end, and as setWallLine and splitWall do. One undo step.
   */
  joinWallPair(first: string, second: string, kind: "L" | "T" | "X" | "no-trim", picks?: { first?: Pt; second?: Pt }): void;
  /**
   * Splits a straight wall where `at` lies along its line (the Split tool): the wall keeps the part
   * from its start, and a copy of it, unnamed, takes the rest; each part's end there is square
   * across the line, their other ends as they were, so the corners and tees there go with the part
   * that has them. Returns the copy's id. Throws for a wall with doors, windows or symbols set in
   * it, or drawn with more than its two ends, a point at an end, or one where another wall meets
   * its side. One undo step.
   */
  splitWall(id: string, at: Pt): string;
  /**
   * Gives a wall a new bottom and top (z above its layer): its heights and its 3D stretched between
   * them, each height keeping its share of the way up. With doors or windows set in it, they and
   * their openings keep their height above its bottom and only its top moves, which can't come
   * down through them, nor slope over them. Throws as setWallLine does. One undo step.
   */
  setWallHeights(id: string, bottom: number, top: number): void;
  /**
   * Gives a straight wall the style of the wall `template` names (wallTemplates): in its place a
   * copy of that wall, laid along the same control line as the template lies along its own (its
   * thickness, faces, components, drawing and 3D the template's) and stretched to the wall's own
   * bottom and top, keeping its class, name and place in the stacking order. Its joins pass to the
   * new wall: a wall mitred to one of its ends is mitred again to the new faces, an end cut along
   * another wall's face keeps that cut, and the walls meeting its sides slide along their lines
   * onto its new faces, each point as far into it, for its width, as it went into the old. A wall with doors, windows or symbols set in it is
   * refused, and so is a join that can't follow, saying why. One undo step; the new wall's id.
   */
  setWallStyle(id: string, template: string): string;
  /**
   * The doors and windows a new one can copy (the Door and Window tools), one per plug-in,
   * parameters and wall style and thickness: those set alone in a straight wall on a design layer
   * whose heights don't slope, with each end cut straight across and the wall drawn between its
   * ends only with the opening, which lies within 60 mm of the door's or window's drawing.
   */
  wallInsertKinds(): WallInsertKind[];
  /**
   * Sets a copy of the door or window `source` (wallInsertKinds) in the straight wall `wallId`, its
   * middle at `at` along the wall's line. Rodeo can't cut an opening, so the wall is redrawn as a
   * copy of the one the source is set in, with the source in it: laid along the wall's line with
   * the door where asked, its ends moved onto the wall's and cut as the wall's are, and its top and
   * bottom the wall's (the door keeps its height above the bottom). The wall's class, name and
   * attached records stay its own, and the walls joined to it stay as they are (its faces are where
   * the source wall's lie). Throws for a wall of another style, thickness or faces than the
   * source's, one holding a door, window or symbol already, one drawn with more than its two ends,
   * sloping, or with an end not cut straight, a door that would reach an end or a wall meeting the
   * side, and a top below the opening. One undo step; the new wall's and door's ids.
   */
  insertInWall(source: string, wallId: string, at: Pt): { wall: string; insert: string };
  /**
   * Places a wall on `layerId` (in class `classIndex`, else None) from `start` to `end`: a copy of
   * the wall `template` names (wallTemplates) stretched along the new line, its thickness, heights
   * (above its layer), style and components the template's. `joins.before` and `joins.after` name walls it joins at
   * `start` and at `end`: one with an end there is mitred to meet it along the bisector of the
   * corner (a corner sharper than 150°, a wall too short for the cut, or one joined there already
   * or holding a door or window, stays square); one with the point in its plan between its ends
   * makes a tee, the new wall running only to that wall's near face and cut along it. One undo
   * step; its id.
   */
  addWall(layerId: string, start: Pt, end: Pt, template: string, classIndex?: number, joins?: { before?: string; after?: string }): string;
  /**
   * Model import (a building's walls): each of `walls` made whole where it stands, a plain wall (no
   * style or components, as addWall's "plain-wall:" sizes) in its class (else None), all on
   * `layerId` in one change. Its openings are cut through it: its 3D, cached as edges, has the
   * holes, and its plan drawing, the wall where it stands at 1.2 m above its foot (half its height
   * when lower), is broken by those reaching that high. No door or window is set in it. Each wall's
   * id in their order, "" for one with no length, height or thickness or nothing left once cut.
   */
  addPlainWalls(layerId: string, walls: readonly PlainWallSpec[]): string[];
  /**
   * AEC > Create Objects from Shapes: from each of `ids` (lines, rectangles, polygons and
   * polylines without curves), walls along its sides or a slab over it, copies of `template`
   * (wallTemplates or slabTemplates) on the shape's layer in class `classIndex` (else None). Walls
   * are placed as addWall places them, one per side from corner to corner, each mitred to the one
   * before and a closed shape's last to its first; corners within 1 of the one before merge. A
   * slab covers a rectangle square to x and y, as addSlab does. With `removeShapes` the shapes go
   * too. Anything else selected, or a shape a slab can't cover, is refused. One undo step; the new
   * objects' ids.
   */
  objectsFromShapes(ids: readonly string[], kind: "wall" | "slab", template: string, classIndex?: number, removeShapes?: boolean): string[];
  /**
   * The kinds of plug-in object on the drawing's design layers a new one can copy, one per plug-in,
   * by name: those Duplicate can copy, but for tags, cameras, Heliodons, site models, section
   * lines and viewports, which have tools of their own or belong to other objects.
   */
  pluginKinds(): PluginKind[];
  /**
   * The slabs a new slab can copy, one per style and thickness: slab plug-ins on design layers
   * whose outline is a rectangle, drawn only with polygons, polylines, groups, slab pieces and bare
   * solid additions, so a copy stretched onto a new rectangle stays true.
   */
  slabTemplates(): SlabTemplate[];
  /**
   * Places a slab on `layerId` (in class `classIndex`, else None) over the rectangle with corners
   * `a` and `b`, square to x and y: a copy of the slab `template` names (slabTemplates), its parts
   * stretched along its outline's sides and the whole turned by a quarter turn at most to lie
   * on it. Its style, thickness, heights (above its layer) and components are the template's. One
   * undo step; its id.
   */
  addSlab(layerId: string, a: Pt, b: Pt, template: string, classIndex?: number): string;
  /** A Heliodon on a design layer a new one copies (the Heliodon tool), else null. */
  heliodonTemplate(): string | null;
  /**
   * Sets Heliodon `id`'s sun: its latitude (north positive), date and solar time (hours, 12 at
   * noon; its Time parameter shows clock time when it keeps clock time). The sun's altitude,
   * azimuth, sunrise and sunset it shows are worked out again, and its lights turned to shine
   * from the sun (level when it is below the horizon). Editing those parameters in its record does
   * the same. Its plan drawing (the compass and the data it shows) stays as it was. One undo step.
   */
  setHeliodonSun(id: string, sun: Pick<HeliodonSun, "latitude" | "month" | "day" | "hour">): void;
  /**
   * Sets a Heliodon's longitude (east positive) and whether its clock keeps daylight saving, each
   * when given. Its time stays as it reads it (a clock time then puts the sun elsewhere), and the
   * rest follows as setHeliodonSun's does. One undo step.
   */
  setHeliodonPlace(id: string, place: { longitude?: number; daylightSaving?: boolean }): void;
  /**
   * The linear dimension a new one copies, else null: on a design layer, drawn only with its
   * extension lines, dimension line and one value text where its fields put them, in the text
   * size most such dimensions share.
   */
  dimensionTemplate(): string | null;
  /**
   * Places a linear dimension object on `layerId` (in class `classIndex`, else None) measuring from
   * `a` to `b` along the direction `u` (the points' own for an aligned dimension, x or y for a
   * horizontal or vertical one), its dimension line through `at`, showing `value`: a copy of the
   * dimension `template` names (dimensionTemplate), its lines and value redrawn with its spacing,
   * text and markers. One undo step; its id.
   */
  addDimension(layerId: string, a: Pt, b: Pt, at: Pt, u: Pt, value: string, template: string, classIndex?: number): string;
  /** A linear dimension object as its fields and drawing lay it out, or null for any other object (or one Rodeo can't redraw). */
  linearDimension(id: string): LinearDimensionInfo | null;
  /**
   * Redraws a linear dimension object with new points, direction, offset or value, each when given:
   * its lines spaced, and its value sized and set beside its dimension line, as they were. Without
   * an offset its dimension line stays where it was, or, when it turns, as far from the first point.
   * One undo step.
   */
  setLinearDimension(id: string, change: Partial<Pick<LinearDimensionInfo, "a" | "b" | "u" | "offset" | "value">>): void;
  /**
   * Places a copy of plug-in object `source` (pluginKinds) on `layerId` in its class, its
   * insertion point at `at`, turned to `angle` degrees (else as the source is), as high above the
   * layer as the source is above its own, its parameters and drawing the source's. One undo step; its id.
   */
  insertPlugin(source: string, layerId: string, at: Pt, angle?: number): string;
  /**
   * Places a new plug-in object of the plug-in `name` (a Vectorworks plug-in whose script Rodeo
   * runs) on `layerId`, its insertion point at `at`, turned `angle` degrees, at the layer's
   * elevation, in class `classIndex` (else None). Its parameters are a record of the plug-in's
   * format, made from `fields` when the drawing has none named `name` (a drawing that has one keeps
   * its fields, though one of Rodeo's own, named "Rodeo ...", gains those of `fields` it lacks),
   * holding `values` by field name and the format's defaults for the rest. It draws nothing until
   * setPluginDrawing gives it its drawing. One undo step; its id.
   */
  addPluginObject(layerId: string, name: string, fields: readonly PluginFieldSpec[], values: Readonly<Record<string, RecordValue>>, at: Pt, angle: number, classIndex?: number): string;
  /** Gives the drawing's plug-in format `name`, one of Rodeo's own, the fields of `fields` it lacks, its objects keeping their values and taking the new fields' given ones; nothing when the drawing hasn't the format. */
  growPluginFields(name: string, fields: readonly PluginFieldSpec[]): void;
  /** A plug-in object's turn, degrees counter-clockwise from x. */
  pluginAngle(id: string): number;
  /**
   * Replaces what plug-in object `id` draws with the objects `ids`: objects at the top level of a
   * layer, drawn in the plug-in's own frame (its insertion point at the origin, unturned), as a
   * plug-in's script draws them. They move into it as they are and its old drawing goes (the
   * groups among its aux records stay); its plan box becomes theirs as its matrix places them. One
   * undo step.
   */
  setPluginDrawing(id: string, ids: readonly string[], keep?: number): void;
  /** the text style the class's texts follow as "Class Text Style": a text style's name index, 0 for none */
  setClassTextStyle(index: number, style: number): void;

  // objects
  /** add a shape to a layer; `attrs` overrides the attributes copied from the template */
  addObject(layerId: string, shape: NewShape, classIndex?: number, attrs?: Partial<Attributes>): string;
  /** the attributes a new object of `kind` copies from the template, before addObject's `attrs`; null when the template has none */
  templateAttributes(kind: NewShape["kind"]): Attributes | null;
  /** Adds several shapes at once, in order, as addObject would one by one; returns their ids. `attrs` is for all, or per shape. */
  addObjects(layerId: string, shapes: readonly NewShape[], classIndex?: number, attrs?: Partial<Attributes> | readonly (Partial<Attributes> | undefined)[]): string[];
  /** whether the file has an object of this kind to copy settings from, which addObject needs */
  canAdd(kind: NewShape["kind"]): boolean;
  /** Deletes the objects; a door, window or symbol set in a wall is refused (Rodeo can't close its opening yet). */
  deleteObjects(ids: string[]): void;
  /**
   * Moves the objects by (dx, dy). A door, window or symbol set in a straight wall slides along it
   * by as much of the move as runs along the wall, with its opening (the wall's drawing and 3D
   * within 60 mm of its drawing), refusing what would reach the wall's end, another door or
   * window, or a wall meeting the side, and an opening it can't tell apart from them. One undo step.
   * Other edits of an object set in a wall (turning, deleting, duplicating, grouping...) are refused.
   */
  moveObjects(ids: string[], dx: number, dy: number): void;
  /**
   * Moves objects in plan and raises them by dz (mm) in 3D, as one change: extrudes, solids, 3D
   * polygons, meshes, and symbol instances and plug-ins with their z. 2D objects have no height and
   * move in plan only. Returns false when dz is not 0 and nothing moved shows in 3D.
   */
  moveObjects3D(ids: string[], dx: number, dy: number, dz: number): boolean;
  /**
   * Modify > Unrotate 3D Objects: each extrude, sweep, multiple extrude and solid turned in its
   * own frame (in plan or in 3D) turned back to the layer's axes about the middle of its 3D box,
   * and each symbol instance holding 3D about its insertion point, as one change. Mirrored,
   * stretched and unturned ones, and other objects, are left. Returns the objects it turned.
   */
  unrotateObjects3D(ids: string[]): string[];
  /**
   * Rotate 3D: turns the selected objects by `deg` degrees (counter-clockwise seen from where
   * `axis` points) about the line through `centre` along it. About the layer's z axis it is a
   * turn in plan, which turns every object; about any other the extrudes, sweeps, multiple
   * extrudes, solids, 3D polygons, meshes and symbols holding only 3D turn (those in groups too),
   * and `left` counts the others, which stay as they are. One undo step.
   */
  rotateObjects3D(ids: string[], axis: Vec3, deg: number, centre: Vec3): { turned: string[]; left: number };
  duplicateObjects(ids: string[], dx: number, dy: number): string[];
  /** replace geometry; shape.kind must match the object's kind */
  setGeometry(id: string, shape: NewShape): void;
  setText(id: string, text: string): void;
  /** size, justification or angle of text objects */
  setTextStyle(ids: string[], style: TextStyle): void;
  setObjectClass(ids: string[], classIndex: number): void;
  /** Names an object (a viewport's name too); "" takes its name away. Names are unique in a document. */
  setObjectName(id: string, name: string): void;
  /** Moves objects to design layer `layerId`, each as high above it as it was above its own layer. */
  setObjectLayer(ids: string[], layerId: string): void;
  /** Values set this way are the objects' own: groups they took from their class no longer do. */
  setAttributes(ids: string[], attrs: Partial<Attributes>): void;
  /** Take an attribute group from the objects' classes, or (off) keep what they draw with as their own. */
  setAttributesByClass(ids: string[], group: ByClassGroup, on: boolean): void;
  /**
   * Sets the markers at the first (start) and last (end) points of the lines, arcs, polygons and
   * polylines among `ids`: a marker shows, null hides one, an end left out stays as it is. Other
   * objects are left alone.
   */
  setLineMarkers(ids: string[], ends: { start?: LineMarker | null; end?: LineMarker | null }): void;
  /** Sets the drop shadow the objects cast; null stops it (the settings are kept). */
  setDropShadow(ids: string[], shadow: DropShadow | null): void;
  /**
   * Set one value of an object's record (ObjectRecord.format). The value's type
   * follows the field's kind. Plug-in drawings aren't regenerated: Vectorworks
   * redraws the object from its parameters when it next resets it.
   */
  setRecordField(id: string, format: number, field: string, value: RecordValue): void;
  /**
   * Sets values of several objects' records of one format at once (each object's fields by name): a
   * data record's, or plug-in objects' parameters (ObjectRecord.parametric), as setRecordField would
   * one by one, in one change (Import Shapefile, switching many lighting devices on).
   */
  setRecordFields(format: number, values: readonly { id: string; fields: Readonly<Record<string, RecordValue>> }[]): void;
  /**
   * Sets values of symbol definitions' records of one data record format (each definition by its
   * SymbolInfo.index, its fields by name), in one change (Tools > Records > Change One Field and
   * Change All Fields). Instances already placed keep their own records as they are.
   */
  setSymbolRecordFields(format: number, values: readonly { symbol: number; fields: Readonly<Record<string, RecordValue>> }[]): void;
  /**
   * Makes a data record format named `name` with these fields (no `from`), copying the settings
   * of one the drawing has; returns its name index.
   */
  createRecordFormat(name: string, fields: readonly RecordFieldSpec[]): number;
  /**
   * Sets a data record format's fields: kept ones (`from`) keep their values in every record of
   * the format, new ones start at their defaults there; fields left out go with their values.
   */
  editRecordFormat(format: number, fields: readonly RecordFieldSpec[]): void;
  /** Attaches a record of a data record format, holding its default values, to each object without one. */
  attachRecord(ids: string[], format: number): void;
  /**
   * Model import: records of data record formats with their values, many at once, in one change.
   * Each entry's object gets a record of `format` holding its defaults with `fields` set over them
   * (an object with one already has those fields set); entries for one object and format merge.
   */
  attachRecords(entries: readonly { id: string; format: number; fields: Readonly<Record<string, RecordValue>> }[]): void;
  /** Takes each object's record of a data record format off it. */
  detachRecord(ids: string[], format: number): void;
  /** Change a viewport's scale, keeping its centre on the sheet and the part of the drawing it shows (its box resizes). */
  createViewport(sheetId: string, spec: NewViewport): string;
  setViewportScale(id: string, scale: number): void;
  /** Crop a viewport to a new box on the sheet; the drawing stays where it is. */
  setViewportBox(id: string, box: BBox): void;
  /** What keeps moveDrawing from moving the drawing: sheet viewports looking from the side or in 3D, design-layer viewports, and objects that can't be moved yet (counts by kind). */
  drawingMoveBlockers(): { views: number; designLayerViewports: number; unmovable: Map<string, number> };
  /** Moves every object on the design layers, hidden ones too, by (dx, dy), the sheets' plan viewports following; one undo step. */
  moveDrawing(dx: number, dy: number): void;
  /** How a viewport shows one design layer. */
  setViewportLayer(id: string, layerId: string, v: Visibility): void;
  /** The visibility a viewport gives one class. */
  setViewportClass(id: string, classIndex: number, v: Visibility): void;
  /** rotate / scale / mirror / move objects and everything inside them */
  transformObjects(ids: string[], m: Affine): void;
  /** change stacking order within each object's container */
  arrangeObjects(ids: string[], to: Arrange): void;
  /** group objects that share a container; returns the new group's id */
  groupObjects(ids: string[]): string;
  /** Groups each set of objects as groupObjects would, in one change; returns the groups' ids in order. */
  groupEach(sets: readonly string[][]): string[];
  /** replace groups by their contents; returns the ids of the released objects */
  ungroupObjects(ids: string[]): string[];
  /** copy objects (with their contents) to clipboard data; does not change the document */
  copyObjects(ids: string[]): ClipboardData;
  /** A symbol definition's contents, in its own coordinates, to bring into another drawing (importSymbol) */
  copySymbol(index: number): ClipboardData;
  /** A new symbol definition named `name` holding `data`'s objects as they are (its insertion point at their origin); its name index */
  importSymbol(name: string, data: ClipboardData): number;
  /** The symbol definition `index` made to hold `data`'s objects in place of its own; its instances follow */
  redefineSymbol(index: number, data: ClipboardData): void;
  /** A texture's records and the record formats its shaders use, to bring into another drawing (importTexture) */
  copyTexture(index: number): TextureData;
  /** Why `data` can't come into this drawing (a record format of the same name with other fields, or none here and nowhere to keep one), or null */
  textureImportProblem(data: TextureData): string | null;
  /**
   * A texture holding `data`'s shaders: a new one named `name`, or texture `replace` with its name
   * kept (so classes and objects using it follow). Record formats its shaders use are the drawing's
   * of the same name, brought along where it has none. Its name index.
   */
  importTexture(name: string, data: TextureData, replace?: number): number;
  /**
   * A new texture named `name` showing an image (made as Vectorworks makes one from an image), its
   * shaders' record formats brought along where the drawing has none. Its name index.
   */
  addImageTexture(name: string, spec: ImageTextureSpec): number;
  /** Convert to Group: symbol instances and plug-in objects replaced by groups of their contents (a plug-in's drawing), placed alike; the groups' ids */
  convertToGroups(ids: string[]): string[];
  /**
   * Convert to 3D Polygons: each object replaced by a group of closed 3D polygons, one per flat face
   * it shows in 3D (each face's triangles merged; one with a hole stays as its triangles), drawn
   * as the part each face came from; 3D polygons and 2D objects stay as they are. The ids of the
   * groups (or lone polygons) and of the 3D polygons kept; throws when nothing shows 3D faces.
   */
  convertTo3DPolygons(ids: string[]): string[];
  /**
   * Convert to Mesh: each object replaced by one mesh of the flat faces it shows in 3D (convex, of
   * at most 10 corners each, as the demos' are), sharing their corners, each face drawn as the part
   * it came from; the object's overall texture goes on the mesh. Meshes and 2D objects stay as they
   * are. Settings come from a mesh in the drawing. The meshes' ids (and the meshes kept); throws
   * when nothing shows 3D faces.
   */
  convertToMeshes(ids: string[]): string[];
  /**
   * Simplify Mesh: the meshes among `ids` and inside them (in groups, plug-in objects such as IFC
   * entities, and the definitions of symbols placed among them), each once, and how many
   * triangles they're drawn with (a face of k corners is k − 2).
   */
  meshTriangles(ids: string[]): { meshes: number; triangles: number };
  /**
   * Modify > Simplify Mesh: each of those meshes with about `keep` (more than 0, at most 1) of its
   * triangles, edges collapsed by least change of shape; each keeps its id, name, class,
   * attributes, records and texture (a UV map carried along), its faces becoming triangles drawn as
   * the faces they came from. One change. With `preview`, nothing changes and only the numbers
   * come back. Triangles before and after, and how many meshes were simplified, kept as they were
   * (nothing to take away) or skipped (a mesh or UV map not read whole); throws when there's no
   * mesh.
   */
  simplifyMeshes(ids: string[], keep: number, preview?: boolean): { before: number; after: number; simplified: number; same: number; skipped: number };
  /**
   * File > Import OBJ and glTF: a mesh on `layerId` for each part, of its faces (flat corner lists,
   * x, y, z triples in mm round each, z above the layer; a face that isn't convex or has more than 10 corners is cut
   * as Convert to Mesh cuts one), in class `classIndex` (else None; one for all, or one per part)
   * with `attrs` (one set for all, or one per part) over the look of a mesh in the drawing, whose
   * settings it copies (a built-in one's, solid filled, when the drawing has none). Parts without
   * a face are left out. `names` names each part's mesh, made unique ("Chair 2") as the drawing's
   * names must be. The meshes' ids; throws when no part has a face.
   */
  addMeshes(
    layerId: string,
    parts: readonly (readonly (readonly number[])[])[],
    classIndex?: number | readonly number[],
    attrs?: Partial<Attributes> | readonly (Partial<Attributes> | undefined)[],
    names?: readonly (string | undefined)[],
  ): string[];
  /**
   * 3D polygons on `layerId`, each through its points (x, y, z triples in mm, z above the layer),
   * closed or open (two points make a 3D line), in class `classIndex` (else None), grouped when
   * there are several, with the look of a 3D polygon in the drawing (a built-in one's when it has
   * none). The polygon's or group's id; throws when none has two points.
   */
  /** A 3D locus at each of these points (x, y, z above the layer); their ids, or the one group's when asked for a group. */
  add3DLoci(layerId: string, points: readonly (readonly number[])[], classIndex?: number, asGroup?: boolean): string[];
  add3DPolygons(layerId: string, polys: readonly { readonly points: readonly number[]; readonly closed: boolean }[], classIndex?: number): string;
  /**
   * Model import (IFC storeys): each set's parts as meshes, as addMeshes makes them, in a group of
   * their own named `name` ("name 2" and on when that is taken; none when ""), each mesh named by
   * `names` as addMeshes names them, and the groups in one more group when there are several, as
   * one change. The groups are in class `classIndex` (else None), and so are the meshes, but for a
   * set's `classes`, one per part. The top group's id and how many meshes were made; throws as
   * addMeshes does.
   */
  addMeshGroups(
    layerId: string,
    sets: readonly {
      name: string;
      parts: readonly (readonly (readonly number[])[])[];
      attrs?: readonly (Partial<Attributes> | undefined)[];
      classes?: readonly number[];
      names?: readonly (string | undefined)[];
    }[],
    classIndex?: number,
  ): { id: string; count: number };
  /**
   * Model import with symbols (SketchUp components): `model.symbols` made as symbol definitions at
   * the top of the resource library, each named its `name` ("name 2" and on when that is taken),
   * then `model.top`'s contents on the layer in one group, as one change. A node's parts are
   * meshes, as addMeshes makes them; its groups are groups of their own contents; its instances
   * place the definitions made before it. Inside a definition, heights are its own; on the layer
   * they are above it. A textured part's mesh shows its texture mapped by its faces' (u, v), each
   * vertex keeping one (u, v) and normal (FORMAT.md §7.1). A node's lines are 3D polygons with the
   * look of one in the drawing (a built-in one's when it has none), its loci 3D loci, and its shapes
   * 2D objects as addObject makes them (one the drawing has no template for is left out). Objects
   * are in class `classIndex` (else None) but for their own. The top group's id, how many meshes,
   * instances, 3D polygons, loci and 2D objects were made and the new definitions' indexes, in
   * `model.symbols`' order; throws as addMeshes does, and when a matrix isn't finite.
   */
  addMeshModel(
    layerId: string,
    model: MeshModel,
    classIndex?: number,
  ): { id: string; meshes: number; instances: number; lines: number; loci: number; flat: number; symbols: number[] };
  /**
   * Model import (a building's elements): each element's parts as meshes, as addMeshes makes them,
   * in its class (else None): a mesh alone for an element of one part with a face, a group of its
   * meshes for one of several; or an instance of a symbol (addMeshSymbols) placed by its matrix;
   * all on `layerId` in one change. Each element's id in their order, "" for one with no face;
   * throws when none has a face, and for a symbol the drawing hasn't or a matrix that isn't 12
   * finite numbers.
   */
  addMeshElements(layerId: string, elements: readonly MeshElement[]): string[];
  /**
   * Model import (a building's repeated elements, a family's or type's): each of `defs` as a symbol
   * definition holding its parts as meshes, as addMeshes makes them, in its class (else None), named
   * its name ("name 2" and on when that is taken), at the top of the resource library (made when the
   * drawing has none), all in one change. Their indexes, which addMeshElements places; throws for
   * one with no face.
   */
  addMeshSymbols(defs: readonly MeshSymbolSpec[]): number[];
  /** True when new meshes (addMeshes) can be made: they copy a mesh of the drawing's, else the built-in one (core/builtins.ts). */
  canAddMeshes(): boolean;
  /**
   * The colour index for each "#rrggbb" in `css`, for Attributes' colour fields: a colour of the
   * drawing's that is exactly it, else one added to its colour table (one step), as Vectorworks adds
   * an imported colour. A drawing with no table that can take more gets its nearest colours.
   */
  addColors(css: readonly string[]): number[];
  /** True when the drawing has a symbol definition and instance whose settings createSymbol can copy. */
  canCreateSymbols(): boolean;
  /**
   * Model > Create Contours: each object cut by the planes square to `axis` (0 x, 1 y, 2 z: level
   * with the layer, `start` a height above it) at `start` and every `interval` mm from it. Each cut is a 3D polygon, closed
   * where it meets itself and drawn as the part it cuts; an object's are grouped after it in its
   * class (one alone stays alone). The objects stay. The groups' (or lone polygons') ids; throws
   * when no plane cuts any of them. Settings come from a 3D polygon in the drawing.
   */
  createContours(ids: string[], axis: 0 | 1 | 2, start: number, interval: number): string[];
  /**
   * Model > Cut 2D Section: where the upright plane through `a` and `b` (the line carried on
   * both ways) cuts each object's 3D faces, part by part as each is drawn: x along the line from
   * `a`, y the height (absolute z). Objects the plane misses are left out. Changes nothing.
   */
  sectionCuts(ids: string[], a: Pt, b: Pt): SectionCut[];
  /**
   * Model > Cut 3D Section: what of each object lies on one side of the upright plane through `a`
   * and `b` (the line carried on both ways; left of a → b when `keepLeft`), as a mesh on `layerId`,
   * the cut closed by a face where the plane went through (holes kept): each face drawn as the part
   * it came from, the object's texture on the whole mesh, in its class. The objects stay. One
   * change; the meshes' ids. Throws when nothing is left on that side or the drawing has no mesh
   * to copy settings from.
   */
  cut3DSection(ids: string[], a: Pt, b: Pt, keepLeft: boolean, layerId: string): string[];
  /**
   * Model > Extrude: each rectangle, rounded rectangle, polygon, polyline, circle or ellipse becomes
   * an extrude `height` (mm) tall standing on its layer, holding the shape as its profile and taking
   * its class, attributes and material; other objects stay as they are. A drawing with no extrude
   * of its own to copy settings from gets a built-in one. The extrudes' ids; throws when none of
   * them can be extruded.
   */
  extrudeObjects(ids: string[], height: number): string[];
  /**
   * Model > Tapered Extrude: each rectangle, rounded rectangle, polygon, polyline, circle or ellipse
   * replaced by a mesh `height` (mm) tall standing on its layer, its sides leaning in by `taper`
   * degrees (out when negative), in its class and with its attributes. The meshes' ids; throws when
   * none can be extruded or the taper closes a profile up or folds it over before the top.
   */
  taperedExtrudeObjects(ids: string[], height: number, taper: number): string[];
  /**
   * Model > Sweep: each shape Extrude takes stands up as a profile and turns `arc` degrees (up to
   * 360) about the upright through its left edge, drawn in segments of `segment` degrees. The
   * profile's bottom stands on the layer and its plane runs through the middle of a half sweep.
   * The sweeps' ids; throws as extrudeObjects does.
   */
  sweepObjects(ids: string[], arc: number, segment: number): string[];
  /**
   * Model > Multiple Extrude: one multiple extrude `height` (mm) tall standing on its layer,
   * holding the closed shapes among `ids` as its profiles in stacking order (the backmost at the
   * bottom, the frontmost at the top) and taking the backmost's class, attributes and material.
   * Its id; throws when fewer than two can be profiles or they are not in one layer or group.
   */
  multiExtrudeObjects(ids: string[], height: number): string;
  /**
   * Model > Add Solids (`subtract` false) and Subtract Solids: one solid holding the extrudes,
   * multiple extrudes, sweeps and solids among `ids` as its operands in stacking order, which
   * adds them or takes the later ones from the backmost, taking the backmost's class, attributes
   * and material. Its id; throws when fewer than two qualify or they are not in one layer or group.
   */
  combineSolids(ids: string[], subtract: boolean): string;
  /**
   * Model > Intersect Solids: the extrudes, multiple extrudes, sweeps and solids among `ids`
   * replaced by one mesh of the volume they all enclose, in the backmost's class and with its
   * attributes, where the frontmost was. Its id; throws when fewer than two qualify, they are not
   * in one layer or group, they don't all overlap, or they have more faces than the boolean takes.
   */
  intersectSolids(ids: string[]): string;
  /**
   * The points of curve `id`, x y z in the model, for a line, arc, rectangle, polygon, polyline,
   * circle, ellipse (at its layer's plane) or 3D polygon; null for anything else.
   */
  curvePoints(id: string): { points: number[][]; closed: boolean } | null;
  /**
   * The faces of solid `id` (an extrude, multiple extrude, sweep, solid or mesh) as triangles, x y z
   * for each corner, in the model. Throws for anything else, or when it shows no 3D faces.
   */
  solidTriangles(id: string): Float64Array;
  /** The faces object `id` shows in 3D, whatever it is, as triangles in the model; none when it shows none. */
  faceTriangles(id: string): Float64Array;
  /**
   * Solid `id` replaced where it is by one mesh of these triangles, in its class and with its
   * attributes, for the 3D Modeling set's edit tools. Its id; throws when they make no faces.
   */
  replaceSolid(id: string, triangles: ArrayLike<number>): string;
  /**
   * Model > Extrude Along Path: the closed shape `profileId` (a rectangle, rounded rectangle,
   * polygon, polyline, circle or ellipse) swept along `pathId` (a line, arc, rectangle, polygon,
   * polyline, circle, ellipse or 3D polygon), centred on it and square to it, mitred at its corners,
   * `scale` times as large at its end; with `lockPlane` the profile's up stays upright. Both are
   * replaced by one mesh in the profile's class and with its attributes. Its id; throws when they
   * are no profile and path, or the path folds back too sharply.
   */
  extrudeAlongPath(profileId: string, pathId: string, scale: number, lockPlane: boolean): string;
  /**
   * Model > Section Solids: cuts away the part of `baseId` (an extrude, multiple extrude, sweep,
   * solid or mesh) on the side of the flat 3D polygon `cutterId` its normal points to (the
   * right-hand rule round its points), or, when `cutterId` is a solid or mesh, the part inside it;
   * `reverse` cuts the other side, or keeps only the part inside. The rest becomes a mesh in the
   * base's place, class and attributes, the faces the cut made drawn as the sectioning object is;
   * the sectioning object is kept when `retain`. Its id; throws when they are no solid and
   * sectioning object, a 3D polygon doesn't cover the solid, or nothing would change or be left.
   */
  sectionSolid(baseId: string, cutterId: string, reverse: boolean, retain: boolean): string;
  /**
   * Model > 3D Power Pack > Create Helix-Spiral: each selected line, arc, rectangle, polygon,
   * polyline, circle, ellipse or 3D polygon replaced by an open 3D polygon coiling round it, in its
   * class and with its attributes; the new ids. Throws when none is a path, the settings are out of
   * range, a path turns back too sharply, or a coil would need too many points.
   */
  createHelixSpiral(ids: string[], o: HelixOptions): string[];
  /**
   * AEC > Survey Input > 2D Polys to 3D Source Data: each of `items` (a line, rectangle, polygon,
   * arc, ellipse or polyline) as a 3D polygon at `elevation` above its layer, its curves in pieces
   * about `segment` long (0: as drawn), in its class with its attributes. Kept, an original stays
   * with its 3D polygon just behind it; otherwise the 3D polygon takes its place. One undo step;
   * returns the 3D polygons' ids.
   */
  polysTo3DSourceData(items: readonly { id: string; elevation: number }[], segment: number, keepOriginals: boolean): string[];
  /**
   * AEC > Terrain > Validate 3D Data: the problems in the 3D polygons among `ids` and in groups
   * among them, backmost first. Changes nothing.
   */
  validate3DData(ids: string[]): SourceDataReport;
  /**
   * AEC > Create Polys from Walls: each wall among `ids` (and in groups among them) as the area
   * its plan drawing covers, the convex hull of its lines, polygons and polylines (so a door's or
   * window's gap is filled and its joins' mitres kept), counter-clockwise in the model. Straight
   * walls only; changes nothing.
   */
  wallFootprints(ids: string[]): Pt[][];
  /**
   * Where the doors, windows and symbols set in wall `id` reach along it: each one's drawing's
   * extent along its line, from its start, in order. Changes nothing.
   */
  wallOpenings(id: string): { a0: number; a1: number }[];
  /**
   * insert clipboard objects on a layer, moved by (dx, dy), each as high above it as it was above
   * the layer it was copied from; returns the new top-level ids
   */
  pasteObjects(layerId: string, data: ClipboardData, dx?: number, dy?: number): string[];
  /** place an instance of symbol definition `symbol` with its insertion point at `at`, at the layer's elevation; returns its id */
  insertSymbol(layerId: string, symbol: number, at: Pt, classIndex?: number): string;
  /** make symbol instances show another definition, keeping their placement */
  replaceSymbol(ids: string[], symbol: number): void;
  /**
   * Turn objects into a new symbol definition (top level of the resource
   * library) and put an instance of it where they were. The definition's
   * insertion point is `insertion` (default: the centre of their bounds).
   * The definition holds them at their heights above their layer, and the
   * instance stands at its elevation. Returns the new instance's id.
   */
  createSymbol(ids: string[], name: string, insertion?: Pt): string;
  /**
   * Rename a library resource (ResourceInfo.index). Refused when other records
   * name it as text (plug-in parameters, worksheet formulas, data
   * visualisations), which a rename here would leave pointing at nothing.
   */
  renameResource(index: number, name: string): void;
  /**
   * Renames classes, layers, stories and resources together (Tools > Utilities > Batch Rename), as
   * one change: names are checked once all are in place, so two can swap. Refused as their own
   * renames would be.
   */
  renameMany(renames: readonly Rename[]): void;
  /**
   * Lays an object's hatch, tile or gradient (the Attribute Mapping tool): the origin and the ends
   * of the pattern's two axes in world coordinates, and a gradient's shape (1 linear, 2 radial).
   * An object without a fill mapping gets one, copied from another in the file.
   */
  setFillMapping(id: string, map: FillMapping): void;
  /**
   * Sets a worksheet cell (0-based row and column on a plain row): a number makes a number cell,
   * a string a text cell (empty clears it). Formulas can't be written yet.
   */
  setWorksheetCell(index: number, row: number, col: number, value: string | number): void;
  /**
   * Makes a worksheet of plain rows (Tools > Reports > Create Report), copying the settings Rodeo
   * doesn't know (its window, its defaults) and a plain cell's format from worksheet `from`, or
   * the drawing's first. Throws when the drawing has no worksheet. Returns its name index.
   */
  createWorksheet(sheet: NewWorksheet, from?: number): number;
  /** Copy a symbol definition under a new name, beside it in its folder. Returns the copy's index. */
  duplicateSymbol(index: number, name: string): number;
  /** Delete a symbol definition that is placed nowhere and named by no other record. */
  deleteSymbol(index: number): void;
  /** Deletes a data record format, its records going from the objects that have one. */
  deleteRecordFormat(format: number): void;
  /**
   * Tools > Records > Merge Record Formats: `from`'s fields go to the end of `into`'s (a name `into`
   * has already taking "_" in front), with their defaults; every object or symbol definition with a
   * record of `from` keeps its values in its record of `into` (given one when it had none), and
   * `from` is deleted. One undo step.
   */
  mergeRecordFormats(from: number, into: number): void;
  /**
   * Tools > Records > Split Record Format: the `fields` named go from `format` to a new format
   * `name`, in its order and with their defaults; every object or symbol definition with a record
   * of `format` gains one of the new format holding its values of them. Returns the new format's
   * name index. One undo step.
   */
  splitRecordFormat(format: number, fields: readonly string[], name: string): number;
  /** Deletes a worksheet that isn't placed on a sheet. */
  deleteWorksheet(index: number): void;
  /** What Tools > Utilities > Purge would remove now. */
  purgeable(): Purgeable;
  /** Removes what purgeable() lists of `kinds`, in one undo step; returns what it removed. */
  purge(kinds: readonly PurgeKind[]): Purgeable;
  /**
   * Replace objects with new shapes in one step: the shapes take the first
   * object's place (same layer or group, same stacking), class and
   * attributes, and the first shape keeps its id. One line, arc, polygon or polyline replaced by
   * one such shape keeps its line markers too. Returns the new ids.
   */
  replaceObjects(ids: string[], shapes: NewShape[]): string[];
  /**
   * Modify > Drafting Aids > Simplify Polys: takes corner vertices from the polygons, polylines and
   * 3D polygons of `ids` (others are left out), by maximum deviation (the outline stays within
   * `tolerance` of the one it had: 0 takes collinear vertices) or minimum distance (those at or
   * within `tolerance` of a neighbour go: 0 takes coincident ones). Start and end vertices, a
   * polyline's curve vertices and the corners beside them stay. Each object keeps its id, class,
   * attributes and records; one undo step, none when nothing goes. Returns how many objects
   * changed and how many vertices went.
   */
  simplifyPolys(ids: readonly string[], by: SimplifyBy, tolerance: number): { objects: number; removed: number };
  /**
   * Run several edits as one undo step. Changes are announced once at the end;
   * if `fn` throws, everything it changed is rolled back.
   */
  batch<T>(fn: () => T): T;
}
