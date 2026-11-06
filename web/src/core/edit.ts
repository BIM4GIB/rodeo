// EditSession: every mutating call builds a Plan against the current record
// list, applies it in one pass and records the changed span for undo.
//
// Structural rules for new records (see FORMAT.md, "Rebuilding the tree"):
//   * a child stores its parent's save-time address at +0x26; all children of
//     one parent share it. New containers get fresh, unused addresses.
//   * +0x10 is non-zero exactly when a record has attached aux records; clones
//     get fresh unique values there.
//   * objects are inserted before their container's terminator, with next != 0.
//   * every cloned record gets a new GUID.

import { ATTR_END, BLACK, BY_CLASS, BY_CLASS_BITS, BY_CLASS_KEYS, CLASS_TEXT_STYLE, CLASS_TEXTURE, WHITE, addTableColors, byClassGroup, readAttrs, writeAttrs, writeClassAttrs, writeLineType } from "./attrs.ts";
import { concat, encodeUtf16, f64, i16, i32, setF64, setI16, setI32, setU16, setU32, setU64, u16, u32, u64 } from "./bytes.ts";
import { symbolDefinitionTemplate, symbolLibraryTemplate, builtinTemplates, imageTexture, shaderFormatList, extrudeShell as builtinExtrudeShell, meshShell as builtinMeshShell, pluginTemplate, poly3dHead as builtinPoly3dHead, WALL_SHELL_LENGTH, plainWall, wallShell, viewportShell as builtinViewportShell, recordFormatTemplate, type Template } from "./builtins.ts";
import {
  FILL_MAPPING,
  LOCUS,
  LOCUS3D,
  LOCUS3D_LENGTH,
  LOCUS_LENGTH,
  MOVABLE,
  MOVABLE_3D,
  OWN_FRAME,
  SYMBOL_MATRIX,
  PLUGIN,
  ROUNDED_RECT,
  TRANSLATABLE,
  TYPE_OF_KIND,
  childrenMoveWith,
  applyAffine,
  bareFrame,
  bodyPlanBox,
  fitPlanBoxes,
  reheightRecord,
  reshapeRecord,
  transformBareSolid,
  extrudeScale,
  keepsFrame,
  BODY_IN_PARENT,
  TURNABLE,
  IDENTITY,
  isIdentity,
  moveBodyPoints,
  placeScaledExtrude,
  placeScaledSweep,
  encodeText,
  encodeTextStyle,
  readBBox,
  readText,
  transformRecord,
  translateRecord,
  turnBodyPoints,
  turnFrame3D,
  turnInstance3D,
  turnPoint3D,
  turnPoints3D,
  type Turn3D,
  unturnFrame,
  unturnInstance,
  writeBBox,
  readInstanceMatrix,
  readInstancePlacement,
  instanceScale,
  readPluginMatrix,
  liftRecord,
  PLUGIN_MATRIX,
  SLAB,
  transformFillMapping,
  writeFillMapping,
  writeGeometry,
  writePlacement,
} from "./encode.ts";
import {
  LIGHT,
  TEXT_STYLE_BY_CLASS,
  VIEWPORT,
  VIEWPORT_BOX,
  VIEWPORT_ROTATION,
  VIEWPORT_SHIFT,
  bboxOfPoints,
  decodeShape,
  onViewportSheet,
  staleRectBounds,
  textFaceAt,
  textStyleAt,
  VIEWPORT_ENTRY_FLAGS,
  WALL,
  WALL_HEIGHTS,
  readWall,
  readTextFrame,
  textCorners,
  VIEWPORT_ENTRY_NAME,
  VIEWPORT_ENTRY_VISIBILITY,
  viewportEntryAt,
  viewportListAt,
  viewportLists,
  viewportIsPlan,
  viewportScale,
  viewportScaleAt,
} from "./geometry.ts";
import {
  CLASS_VIS,
  LAYER_SCALE,
  MAX_PAGE_INCHES,
  LAYER_STORY,
  LAYER_VIS,
  Model,
  VIS_CODE,
  auxCount,
  guidOf,
  isDesignLayerViewport,
  layerElevationAt,
  layerElevationOf,
  layerKindAt,
  layerNameAt,
  layerPageAt,
  CAMERA_PLUGIN,
  MATERIAL_AT,
  MATERIAL_TYPES,
  objectChildren,
  objectWalk,
  readStr,
  shapeOf,
  subtreeEnd,
  upsideDownText,
  viewportRotation,
} from "./model.ts";
import { FONT_LIST, isNarrowFont, readFontList, withFont } from "./fonts.ts";
import { LINE_MARKERS, MARKED_TYPES, NEW_MARKERS, readMarkers, writeMarkers } from "./markers.ts";
import { writeLayerView } from "./layerView.ts";
import { writeNameTable } from "./names.ts";
import { RECORD, RECORD_FORMAT, encodeFormat, encodePluginFormat, encodeRecord, readFormat, readValues, recordFormat, writeValue, type FormatDef } from "./params.ts";
import { NEXT_MARK, Rec, newGuid } from "./records.ts";
import { DATABASE_BLOCK, WORKSHEET_IMAGE, newWorksheetRecord, readWorksheetImage, writeWorksheetCell } from "./worksheet.ts";
import earcut from "earcut";
import { contourAt, type Axis } from "./contours.ts";
import { SIMPLIFIABLE, simplifiedRecord } from "./simplify.ts";
import { SOURCE_TOLERANCE, type SourcePoly, sourceDataProblems } from "./sourceData.ts";
import { intersectMeshes, MAX_CSG_TRIANGLES, subtractMeshes } from "./csg.ts";
import { facesOf } from "./faces3d.ts";
import { deviceLightValues, isLightingDevice, readDeviceLight } from "./lightingDevice.ts";
import { isPathGroup, isProfileGroup, objectTriangles, writeLight } from "./model3d.ts";
import { meshTriangleCount, simplifiedMesh } from "./meshSimplify.ts";
import { OVERALL, TAKES_TEXTURE, holdsParts, isTextureDict, newTextureDict, newUvMapDict, newUvTextureDict, partLike, readTextureParts, tailValues, textureDict, writeTexturePart } from "./texmap.ts";
import { RESOURCE_TYPES, TEXT_STYLE_TYPE, newGradient, newTextStyle, previewSize, readTextStyle, writeGradient, writeHatch, writePreview, writeTextStyle } from "./resources.ts";
import { DROP_SHADOW, NEW_SHADOW, SHADOW_BYTES, readDropShadow, writeDropShadow } from "./shadow.ts";
import { isStory, isStoryList, newStory, readStory, writeStory } from "./stories.ts";
import { applyRuns, transformRuns, type Splice } from "./splice.ts";
import { unitsPatch } from "./settings.ts";
import { HELIODON, HELIODON_INPUTS, heliodonFields, heliodonLight, readHeliodonSun } from "./sun.ts";
import type {
  Affine,
  Arrange,
  Attributes,
  BBox,
  ByClassGroup,
  ChangeEvent,
  ChangeKind,
  ClipboardData,
  DropShadow,
  EditSession,
  FillMapping,
  GradientStop,
  HatchFill,
  HelixOptions,
  LayerView,
  LightChange,
  LineMarker,
  MeshElement,
  MeshModel,
  MeshNode,
  MeshSymbolSpec,
  NewShape,
  NewViewport,
  NewWorksheet,
  PageSize,
  PlainWallSpec,
  Pt,
  PurgeKind,
  Purgeable,
  RecordValue,
  RecordField,
  RecordFieldSpec,
  Rename,
  SectionCut,
  SimplifyBy,
  SourceDataReport,
  SpliceOp,
  SpliceRun,
  StoryLevelSpec,
  TextStyle,
  TextStyleDef,
  TextStyleSpec,
  TextureData,
  ImageTextureSpec,
  TexturePart,
  TexturePartChange,
  Vec3,
  Visibility,
  PluginFieldSpec,
  PluginKind,
  SlabTemplate,
  HeliodonSun,
  LinearDimensionInfo,
  WallInsertKind,
  WallJoin,
  WallTemplate,
} from "./types.ts";
import { anyHeld, expandRecords } from "./held.ts";
import { wallProfile } from "./wallProfile.ts";

interface Step {
  start: number;
  removed: Uint8Array[];
  added: Uint8Array[];
  kind: ChangeKind;
  ids: string[];
  /** header bytes at `at` the step changed from `before` to `after` (document settings) */
  header?: { at: number; before: Uint8Array; after: Uint8Array };
}

/** Whether two header patches change any of the same bytes. */
function headersOverlap(a: { at: number; bytes: Uint8Array }, b: { at: number; after: Uint8Array }): boolean {
  return a.at < b.at + b.after.length && b.at < a.at + a.bytes.length;
}

/** Changes against the current record list, applied in one pass. */
class Plan {
  private replaced = new Map<number, Uint8Array>();
  private removed = new Set<number>();
  private inserts = new Map<number, Uint8Array[]>();
  /** a symbol definition's contents changed, so every instance draws differently */
  symbolsChanged = false;

  constructor(private readonly datas: Uint8Array[]) {}

  cur(i: number): Uint8Array {
    return this.replaced.get(i) ?? this.datas[i];
  }

  /** Writable copy of record i (copied once per plan). */
  mut(i: number): Uint8Array {
    let d = this.replaced.get(i);
    if (!d) {
      d = this.datas[i].slice();
      this.replaced.set(i, d);
    }
    return d;
  }

  set(i: number, d: Uint8Array): void {
    this.replaced.set(i, d);
  }

  remove(from: number, to: number): void {
    for (let i = from; i <= to; i++) this.removed.add(i);
  }

  isRemoved(i: number): boolean {
    return this.removed.has(i);
  }

  /** Insert before original index `at` (datas.length appends). */
  insert(at: number, recs: Uint8Array[]): void {
    const list = this.inserts.get(at) ?? [];
    // one at a time: a spread of an import's records can be too many arguments
    for (const d of recs) list.push(d);
    this.inserts.set(at, list);
  }

  build(): Uint8Array[] {
    const out: Uint8Array[] = [];
    for (let i = 0; i <= this.datas.length; i++) {
      const ins = this.inserts.get(i);
      if (ins) for (const d of ins) out.push(d);
      if (i < this.datas.length && !this.removed.has(i)) out.push(this.cur(i));
    }
    return out;
  }
}

/** `list` with the `count` items from `start` replaced by `items`; no spread, as a step can span most of a drawing. */
function spliced<T>(list: readonly T[], start: number, count: number, items: readonly T[]): T[] {
  return list.slice(0, start).concat(items, list.slice(start + count));
}

function packStr(s: string): Uint8Array {
  const body = encodeUtf16(s);
  const head = new Uint8Array(4);
  setU32(head, 0, body.length);
  return concat([head, body]);
}

function setOwner(d: Uint8Array, v: bigint): void {
  setU64(d, 0x26, v);
}

function setNext(d: Uint8Array, v: boolean): void {
  setU64(d, 0x08, v ? NEXT_MARK : 0n);
}

function translation(dx: number, dy: number): Affine {
  return { a: 1, b: 0, c: 0, d: 1, e: dx, f: dy };
}

const HATCH = 66;
const GRADIENT = 120;
const LINE_TYPE = 96;
const TEXTURE = 97;
const PREVIEW = 119;
// Wall, slab and roof components: a type-69 aux record, u16 count at +0x50, then 0x126-byte blocks
// (FORMAT.md §4.2), whose fills are at +0xf4 and +0xf8 (998 of 998 fill resources found in the
// 2023 demo's components sit there). Where their pens keep a line type isn't known (no component
// in the demos uses one), so any 4 bytes of a block count.
const COMPONENTS = 69;
const COMPONENT_COUNT = 0x50;
const COMPONENT_BLOCKS = 0x52;
const COMPONENT_SIZE = 0x126;
const COMPONENT_FILLS = [0xf4, 0xf8];
const COMPONENT_PENS = Array.from({ length: COMPONENT_SIZE - 3 }, (_, i) => i);

/**
 * A locus record for files that have none to copy: every one in the demos has the same header
 * flags and attribute block, and one has no aux records, so nothing else is needed. Its GUID is a
 * placeholder that instantiate() replaces, and addObjects writes its class and point.
 */
function blankLocus(): Template {
  const d = new Uint8Array(LOCUS_LENGTH);
  setU64(d, 0, BigInt(LOCUS_LENGTH));
  d[0x19] = LOCUS;
  d[0x1f] = 0x40;
  d[0x38] = 1;
  d.set([2, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0x64, 0x64], 0x50);
  return { recs: [d], parent: [-1] };
}

function hasGuid(d: Uint8Array): boolean {
  for (let i = 0x38; i < 0x48; i++) if (d[i] !== 0) return true;
  return false;
}

function templateOf(rec: Rec, skip?: (r: Rec, depth: number) => boolean): Template {
  const t: Template = { recs: [], parent: [] };
  const visit = (r: Rec, parent: number, depth: number) => {
    const me = t.recs.length;
    t.recs.push(r.data);
    t.parent.push(parent);
    for (const c of r.children) if (!skip?.(c, depth + 1)) visit(c, me, depth + 1);
  };
  visit(rec, -1, 0);
  return t;
}

/** True when two boxes are the same to within a millionth of their size. */
function sameBox(a: BBox | null, b: BBox | null): boolean {
  if (!a || !b) return false;
  const tol = 1e-6 * Math.max(1, a.x1 - a.x0, a.y1 - a.y0, b.x1 - b.x0, b.y1 - b.y0);
  return Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.y0 - b.y0) <= tol && Math.abs(a.x1 - b.x1) <= tol && Math.abs(a.y1 - b.y1) <= tol;
}

/** A text character: what may run on from either end of a name inside a longer string. */
function textUnit(d: Uint8Array, at: number): boolean {
  if (at < 0 || at + 1 >= d.length) return false;
  const c = d[at] | (d[at + 1] << 8);
  return (c >= 0x20 && c < 0x7f) || (c >= 0xc0 && c < 0x250);
}

/** True when `d` holds the UTF-16 text `text` as a whole string, not as part of a longer one. */
function holdsText(d: Uint8Array, text: Uint8Array): boolean {
  if (text.length === 0) return false;
  for (let at = d.indexOf(text[0]); at >= 0 && at + text.length <= d.length; at = d.indexOf(text[0], at + 1)) {
    let k = 1;
    while (k < text.length && d[at + k] === text[k]) k++;
    if (k === text.length && !textUnit(d, at - 2) && !textUnit(d, at + text.length)) return true;
  }
  return false;
}

/** Header bytes that say what an object is and how it draws (flags, class, by-class flags); the rest is bookkeeping. */
const CONTENT_HEAD = [0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25];

/** A hash of what `rec` and everything in it are, leaving out ids, addresses and names. */
function contentHash(rec: Rec): number {
  let h = 0x811c9dc5;
  const mix = (v: number): void => {
    h = Math.imul(h ^ v, 0x01000193);
  };
  for (const r of rec.walk()) {
    const d = r.data;
    mix(r.type);
    mix(d.length);
    for (const o of CONTENT_HEAD) mix(d[o]);
    for (let i = 0x50; i < d.length; i++) mix(d[i]);
  }
  return h >>> 0;
}

/** True when `a` and `b` are the same object byte for byte, apart from ids, addresses and names. */
function sameContent(a: Rec, b: Rec): boolean {
  const x = [...a.walk()];
  const y = [...b.walk()];
  if (x.length !== y.length) return false;
  return x.every((r, i) => {
    const d = r.data;
    const e = y[i].data;
    if (r.type !== y[i].type || d.length !== e.length) return false;
    if (CONTENT_HEAD.some((o) => d[o] !== e[o])) return false;
    for (let k = 0x50; k < d.length; k++) if (d[k] !== e[k]) return false;
    return true;
  });
}

/** Resources that may hold a class's index in their body: styles and materials. */
const STYLE_TYPES = new Set([...RESOURCE_TYPES].filter(([, kind]) => kind.endsWith("-style") || kind === "material").map(([type]) => type));

const NONE_CLASS = "None";
const SYMBOL_INSTANCE = 15;

/** Generic solids: copied as they are inside a solid's own frame, where they need no moving. */
const GENERIC_SOLID = 113;
/** a mesh's face: its attributes and the numbers of the mesh's points round it */
const MESH_FACE = 41;
/**
 * A record with the faces it has when it's a mesh: every face carries its mesh's class and
 * attributes, each drawing with its own, and they all share one id (a zero GUID), so they can
 * only be reached through their mesh.
 */
function withFaces(r: Rec): Rec[] {
  return r.type === MESH ? [r, ...r.children.filter((c) => c.type === MESH_FACE)] : [r];
}
/** Objects the clipboard carries as they are inside a 3D object (see childrenMoveWith). */
const CARRIED: ReadonlySet<number> = new Set([...MOVABLE, GENERIC_SOLID, MESH_FACE]);
/**
 * What Duplicate copies, and the clipboard within one drawing: shapes, and walls, slabs, plug-in
 * objects and lights. Another drawing takes MOVABLE objects with CARRIED ones in their frames only.
 */
const COPIED: ReadonlySet<number> = new Set([...MOVABLE, ...TURNABLE, LIGHT]);
/** What a symbol holds: shapes, plug-in objects and lights (walls and slabs not yet). */
const SYMBOL_PARTS: ReadonlySet<number> = new Set([...MOVABLE, PLUGIN, LIGHT]);

/**
 * The records a move changes. A viewport's drawing is placed through the viewport's own shift, a
 * plug-in's through its matrix, and an extrude's profile or a solid's operands through the
 * object's own frame, so what is inside them stays as it is.
 */
function* movedWalk(rec: Rec): Generator<Rec> {
  yield rec;
  if (!childrenMoveWith(rec.type)) return;
  for (const c of objectChildren(rec)) yield* movedWalk(c);
}

/** What a wall a new wall copies may draw itself with in plan: lines, polygons, loci and polylines. */
const WALL_DRAWING: ReadonlySet<number> = new Set([2, 5, 17, 21]);
/** how far a square-ended wall's points may lie from the cross lines through its ends (mm) */
const WALL_END_TOLERANCE = 1;

/**
 * Where a wall's faces lie across its line (left of it positive) when a copy stretched along a
 * new line stays true, else null: it is drawn only with lines, polygons, polylines and loci, has
 * nothing set in it (doors, windows, symbols), and its drawing and 3D all lie on the cross lines
 * through its ends (square ends: no joins or caps that stretching would pull out of shape).
 */
function stretchableWall(doc: Model, r: Rec): [number, number] | null {
  const w = readWall(r.data);
  if (!w) return null;
  const length = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
  if (!(length > 1)) return null;
  const ux = (w.end.x - w.start.x) / length;
  const uy = (w.end.y - w.start.y) / length;
  let lo = Infinity;
  let hi = -Infinity;
  let square = true;
  const at = (x: number, y: number): void => {
    const along = (x - w.start.x) * ux + (y - w.start.y) * uy;
    if (Math.abs(along) > WALL_END_TOLERANCE && Math.abs(along - length) > WALL_END_TOLERANCE) square = false;
    const across = (y - w.start.y) * ux - (x - w.start.x) * uy;
    lo = Math.min(lo, across);
    hi = Math.max(hi, across);
  };
  for (const c of objectChildren(r)) {
    if (c.type === 11) continue;
    // a solid addition stretches only bare (transformBareSolid)
    if (c.type === SOLID && !objectChildren(c).length && bareFrame(c.data)) continue;
    if (!WALL_DRAWING.has(c.type)) return null;
    for (const p of shapeOf(c)?.points ?? []) at(p.x, p.y);
  }
  // the plan first: it rules out most walls without building their 3D
  if (!square || !(hi > lo)) return null;
  let drawn = false;
  for (const { triangles: t } of objectTriangles(doc, r)) {
    for (let i = 0; i + 2 < t.length; i += 3) at(t[i], t[i + 1]);
    drawn ||= t.length > 0;
  }
  return square && drawn ? [lo, hi] : null;
}

/** a tee needs the new wall to cross the one it meets at least this steeply (sine of the angle) */
const MIN_TEE_SINE = Math.sin((15 * Math.PI) / 180);

/** A wall's control line and how far its plan drawing reaches across it, left of it positive; null for one with no length. */
const PLAIN_WALL = "plain-wall:";

/** The sizes a drawing with no styled walls can start a wall in, not copied from anything: inches or millimetres, a storey high. */
function plainWalls(units: string | undefined): WallTemplate[] {
  const imperial = /feet|foot|inch|yard|mile/i.test(units ?? "");
  const height = imperial ? 2438.4 : 2700;
  const sizes = imperial ? [4, 6, 8, 12].map((inches) => inches * 25.4) : [100, 150, 200, 300];
  return sizes.map((thickness) => ({ id: `${PLAIN_WALL}${thickness}:${height}`, style: null, thickness, height, faces: [-thickness / 2, thickness / 2] }));
}

/** A plain wall's plan drawing and group, in its class. */
function classPlainWall(copies: readonly Uint8Array[], cls: number): void {
  for (const part of copies) if (part[0x19] === 5 || part[0x19] === 11) setU32(part, 0x20, cls);
}

function plainWallSize(id: string): { thickness: number; height: number } | null {
  if (!id.startsWith(PLAIN_WALL)) return null;
  const [thickness, height] = id.slice(PLAIN_WALL.length).split(":").map(Number);
  return thickness > 0 && height > 0 ? { thickness, height } : null;
}

function wallPlan(r: Rec): { start: Pt; end: Pt; u: Pt; length: number; lo: number; hi: number } | null {
  const w = readWall(r.data);
  if (!w) return null;
  const length = pointGap(w.start, w.end);
  if (!(length > 1)) return null;
  const u = unitVec(w.start, w.end);
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of objectChildren(r)) {
    if (!WALL_DRAWING.has(c.type)) continue;
    for (const q of shapeOf(c)?.points ?? []) {
      const across = (q.y - w.start.y) * u.x - (q.x - w.start.x) * u.y;
      lo = Math.min(lo, across);
      hi = Math.max(hi, across);
    }
  }
  // a wall drawn with nothing in plan is taken to be centred on its line
  if (!(hi > lo)) [lo, hi] = [-w.thickness / 2, w.thickness / 2];
  return { start: w.start, end: w.end, u, length, lo, hi };
}

/**
 * Plug-ins the Plug-in Insertion tool doesn't place: tags and section lines belong to what they
 * mark, cameras and Heliodons have tools of their own, and site models and viewports draw others.
 */
const NOT_INSERTED: ReadonlySet<string> = new Set([
  "Data Tag",
  CAMERA_PLUGIN,
  HELIODON,
  "DTM6",
  "Site Modifiers",
  "SiteModelOpacityContainer",
  "Section Line2",
  "Interior Elevation2",
  "NNA_DesignLayerViewport",
]);

/** how far a slab's 3D may lie past its outline and still be copied (mm) */
const SLAB_EDGE_TOLERANCE = 0.5;
/** What a slab a new slab copies may hold: polygons, polylines, lines, loci, groups and slab pieces (and bare solid additions). */
const SLAB_PARTS: ReadonlySet<number> = new Set([2, 5, 11, 17, 21, 71]);

/**
 * The rectangle a slab plug-in's outline makes in its own frame (a corner and the two sides from
 * it) when a copy stretched onto a new rectangle stays true, else null: a "Slab" plug-in on a frame
 * that only turns, its outline (its first polygon or polyline) a rectangle, holding only lines,
 * polygons, polylines, loci, groups, slab pieces and solid additions with bare frames, and its 3D
 * within the outline in plan (an edge standing out past it would stretch with it).
 */
function stretchableSlab(doc: Model, r: Rec): { corner: Pt; u: Pt; v: Pt } | null {
  if (doc.pluginName(r) !== "Slab" || r.data.length < PLUGIN_MATRIX + 96 || !keepsFrame(readPluginMatrix(r.data))) return null;
  for (const o of objectWalk(r)) {
    if (o === r) continue;
    if (o.type === SOLID ? objectChildren(o).length || !bareFrame(o.data) : !SLAB_PARTS.has(o.type)) return null;
  }
  const outline = objectChildren(r).find((c) => c.type === 5 || c.type === 21);
  let pts = outline ? (shapeOf(outline)?.points ?? []) : [];
  if (pts.length === 5 && pointGap(pts[0], pts[4]) < 1e-6) pts = pts.slice(0, 4);
  if (pts.length !== 4) return null;
  const u = { x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y };
  const v = { x: pts[3].x - pts[0].x, y: pts[3].y - pts[0].y };
  const lu = Math.hypot(u.x, u.y);
  const lv = Math.hypot(v.x, v.y);
  if (!(lu > 1 && lv > 1) || Math.abs(u.x * v.x + u.y * v.y) > 1e-6 * lu * lv) return null;
  // the fourth corner closes it
  if (pointGap({ x: pts[0].x + u.x + v.x, y: pts[0].y + u.y + v.y }, pts[2]) > 1e-6 * Math.max(lu, lv)) return null;
  // the 3D, placed, against the outline placed alike
  const m = readPluginMatrix(r.data);
  const o = applyAffine(m, pts[0]);
  const du = { x: (m.a * u.x + m.c * u.y) / lu, y: (m.b * u.x + m.d * u.y) / lu };
  const dv = { x: (m.a * v.x + m.c * v.y) / lv, y: (m.b * v.x + m.d * v.y) / lv };
  let drawn = false;
  for (const { triangles: t } of objectTriangles(doc, r)) {
    for (let i = 0; i + 2 < t.length; i += 3) {
      const along = (t[i] - o.x) * du.x + (t[i + 1] - o.y) * du.y;
      const across = (t[i] - o.x) * dv.x + (t[i + 1] - o.y) * dv.y;
      if (along < -SLAB_EDGE_TOLERANCE || along > lu + SLAB_EDGE_TOLERANCE || across < -SLAB_EDGE_TOLERANCE || across > lv + SLAB_EDGE_TOLERANCE) return null;
      drawn = true;
    }
  }
  return drawn ? { corner: pts[0], u, v } : null;
}

/** True when Duplicate could copy `r`: everything that moves with it moves or turns. */
/** True for a plug-in object or symbol set in a wall (a door, a window): it lies in the wall's opening. */
function isWallInsert(r: Rec): boolean {
  return (r.type === PLUGIN || r.type === SYMBOL_INSTANCE) && r.parent?.type === WALL;
}

function copyable(r: Rec): boolean {
  for (const o of movedWalk(r)) if (!COPIED.has(o.type)) return false;
  return true;
}

/** the sharpest corner walls are mitred at: past it the cut would run far beyond the corner */
const MAX_MITRE_TURN = (150 * Math.PI) / 180;
/** a wall's point belongs to an end when it lies within this many times the wall's reach across its line of it (a tee's cut reaches 1 / tan 15°) */
const WALL_END_REACH = 4;
/** how far past a door's or window's drawing its opening in the wall may reach (a trim: the demos' reach 59 mm at most) */
const OPENING_TRIM = 60;
/** how much of a wall's end stays beside a door or window placed in it, at least (mm) */
const OPENING_CLEAR = 2 * WALL_END_TOLERANCE;
/** What a door's or window's plan drawing is made of: lines, rectangles, polygons, arcs, rounded rectangles, loci and polylines. */
const PLAN_DRAWING: ReadonlySet<number> = new Set([2, 3, 5, 6, 13, LOCUS, 21]);
/** where along a wall something lies, for which end it moves with: one end's, or between them */
type Side = "start" | "between" | "end";
/** a wall's control line: its start and end, (y, x) each */
const WALL_LINE = 0x9e;

function unitVec(a: Pt, b: Pt): Pt {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

function pointGap(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** a wall's two ends */
const WALL_ENDS = ["start", "end"] as const;
type WallEnd = (typeof WALL_ENDS)[number];
/** a wall's control line */
type WallLine = { start: Pt; end: Pt };
/** a wall's end cut straight across: its points lie along the line from the end by k times how far they lie across it, and m */
type WallCut = { k: number; m: number };
/** a cut square across the line */
const SQUARE_CUT: WallCut = { k: 0, m: 0 };

/** The cut a wall's points at `end` lie on (a least-squares line, every point within WALL_END_TOLERANCE of it), else null. */
function wallEndCut(g: { length: number; points: Pt[]; along: (q: Pt) => number; across: (q: Pt) => number; pointSide: (a: number) => Side }, end: WallEnd): WallCut | null {
  const e0 = end === "start" ? 0 : g.length;
  const at = g.points.filter((q) => g.pointSide(g.along(q)) === end).map((q) => ({ a: g.along(q) - e0, c: g.across(q) }));
  const n = at.length;
  const sc = at.reduce((m, q) => m + q.c, 0);
  const sa = at.reduce((m, q) => m + q.a, 0);
  const det = n * at.reduce((m, q) => m + q.c * q.c, 0) - sc * sc;
  if (n < 2 || !(Math.abs(det) > 1e-9)) return null;
  const k = (n * at.reduce((m, q) => m + q.c * q.a, 0) - sc * sa) / det;
  const m = (sa - k * sc) / n;
  return at.every((q) => Math.abs(q.a - k * q.c - m) <= WALL_END_TOLERANCE) ? { k, m } : null;
}

/**
 * The cuts that mitre a corner where wall `a` (its line `la`) comes in at its end `ea` and wall `b`
 * goes out from its end `eb`: both along the line through where their left faces cross and where
 * their right faces cross (the bisector of the turn, when the lines lie alike in both), in each
 * wall's terms. Square, as joinWalls leaves it, for a straight run, a turn past MAX_MITRE_TURN, or
 * a cut reaching past a wall's middle.
 */
function mitreCuts(a: { lo: number; hi: number }, la: WallLine, ea: WallEnd, b: { lo: number; hi: number }, lb: WallLine, eb: WallEnd): [WallCut, WallCut] {
  const square: [WallCut, WallCut] = [SQUARE_CUT, SQUARE_CUT];
  const ua = unitVec(la.start, la.end);
  const ub = unitVec(lb.start, lb.end);
  const ta = ea === "end" ? ua : { x: -ua.x, y: -ua.y };
  const tb = eb === "start" ? ub : { x: -ub.x, y: -ub.y };
  const turn = Math.atan2(ta.x * tb.y - ta.y * tb.x, ta.x * tb.x + ta.y * tb.y);
  if (Math.abs(turn) > MAX_MITRE_TURN || Math.abs(Math.sin(turn)) < 1e-9) return square;
  // a face: the line so far across a wall's line (left of it positive)
  const face = (l: WallLine, u: Pt, c: number) => ({ p: { x: l.start.x - u.y * c, y: l.start.y + u.x * c }, d: u });
  const meet = (f: ReturnType<typeof face>, g: ReturnType<typeof face>): Pt => {
    const t = ((g.p.x - f.p.x) * g.d.y - (g.p.y - f.p.y) * g.d.x) / (f.d.x * g.d.y - f.d.y * g.d.x);
    return { x: f.p.x + f.d.x * t, y: f.p.y + f.d.y * t };
  };
  // left of the way through the corner: across a wall walked along its line, against it when walked back
  const [aLeft, aRight] = ea === "end" ? [a.hi, a.lo] : [a.lo, a.hi];
  const [bLeft, bRight] = eb === "start" ? [b.hi, b.lo] : [b.lo, b.hi];
  const P = meet(face(la, ua, aLeft), face(lb, ub, bLeft));
  const Q = meet(face(la, ua, aRight), face(lb, ub, bRight));
  const cutOf = (l: WallLine, u: Pt, e: WallEnd): WallCut | null => {
    const along = (q: Pt): number => (q.x - l.start.x) * u.x + (q.y - l.start.y) * u.y;
    const across = (q: Pt): number => (q.y - l.start.y) * u.x - (q.x - l.start.x) * u.y;
    const length = pointGap(l.start, l.end);
    const dc = across(Q) - across(P);
    if (!(Math.abs(dc) > 1e-9)) return null;
    const k = (along(Q) - along(P)) / dc;
    const m = along(P) - (e === "start" ? 0 : length) - k * across(P);
    // the cut stays within its half of the wall
    return [across(P), across(Q)].every((c) => Math.abs(k * c + m) < length / 2) ? { k, m } : null;
  };
  const ca = cutOf(la, ua, ea);
  const cb = cutOf(lb, ub, eb);
  return ca && cb ? [ca, cb] : square;
}

/** The map that lays the line s0-e0 onto s-e: stretched along it, as it is across it. */
function stretchOnto(s0: Pt, e0: Pt, s: Pt, e: Pt): Affine {
  const l0 = Math.hypot(e0.x - s0.x, e0.y - s0.y);
  const l = Math.hypot(e.x - s.x, e.y - s.y);
  const u0 = { x: (e0.x - s0.x) / l0, y: (e0.y - s0.y) / l0 };
  const u = { x: (e.x - s.x) / l, y: (e.y - s.y) / l };
  const k = l / l0;
  // k·u·u0ᵀ along the line, n·n0ᵀ across it (n the left-hand normal)
  const a = k * u.x * u0.x + u.y * u0.y;
  const c = k * u.x * u0.y - u.y * u0.x;
  const b = k * u.y * u0.x - u.x * u0.y;
  const d = k * u.y * u0.y + u.x * u0.x;
  return { a, b, c, d, e: s.x - (a * s0.x + c * s0.y), f: s.y - (b * s0.x + d * s0.y) };
}

const DIMENSION = 63;
/** A dimension record keeps its measured points at these offsets, (y, x) each */
const DIM_A = 0x9e;
const DIM_B = 0xae;
/** how far its dimension line lies from the first point, along the left-hand normal of its direction */
const DIM_OFFSET = 0xbe;
/** the way its dimension line runs, a unit vector (y, x) */
const DIM_DIR = 0xc6;
const DIM_LENGTH = 848;
/** how far a dimension's drawing may stray from what its fields say and still be copied (mm) */
const DIM_TOLERANCE = 0.05;

/** A linear dimension as its record and drawing lay it out (linearDimension). */
interface LinearDimension {
  /** the measured points, the second further along `u` than the first */
  a: Pt;
  b: Pt;
  /** the way the dimension line runs, and how far it lies from `a` along (-u.y, u.x) */
  u: Pt;
  offset: number;
  /** extension lines start `gap` off the points and run `over` past the dimension line, which runs `ext` past them */
  gap: number;
  over: number;
  ext: number;
  /** the value it shows */
  text: Rec;
}

/**
 * The drawing a linear dimension has for its fields: an extension line from each point (gap off
 * it, on the side the dimension line is, to `over` past that line), the dimension line's runs past
 * the extension lines, and the dimension line itself, in the order Vectorworks keeps them.
 */
function dimensionLines(a: Pt, b: Pt, u: Pt, offset: number, gap: number, over: number, ext: number): [Pt, Pt][] {
  const n = { x: -u.y, y: u.x };
  const along = (p: Pt, d: Pt, k: number): Pt => ({ x: p.x + d.x * k, y: p.y + d.y * k });
  const foot = (p: Pt): Pt => along(a, u, (p.x - a.x) * u.x + (p.y - a.y) * u.y);
  const fa = along(foot(a), n, offset);
  const fb = along(foot(b), n, offset);
  const extension = (p: Pt, f: Pt): [Pt, Pt] => {
    // a point on the dimension line gets its extension line on the negative side
    const side = (f.x - p.x) * n.x + (f.y - p.y) * n.y > 0 ? 1 : -1;
    return [along(p, n, side * gap), along(f, n, side * over)];
  };
  return [extension(a, fa), extension(b, fb), [along(fa, u, -ext), fa], [fb, along(fb, u, ext)], [fa, fb]];
}

/**
 * `r` read as a plain linear dimension a new one can copy, else null: a dimension record holding
 * only its own data, five lines (only the dimension line marked) and a group of one text, its
 * drawing where its fields put it (dimensionLines): none with extension lines dragged off their
 * points, chains' shared lines or record data attached.
 */
function linearDimension(r: Rec): LinearDimension | null {
  if (r.type !== DIMENSION || r.data.length !== DIM_LENGTH) return null;
  const ownData = (o: Rec): boolean => o.children.slice(0, auxCount(o)).every((c) => c.type === AUX_RECORD);
  if (!ownData(r)) return null;
  const kids = objectChildren(r);
  if (kids.length !== 6 || kids.slice(0, 5).some((k) => k.type !== 2 || auxCount(k) !== (k === kids[4] ? 1 : 0))) return null;
  const group = kids[5];
  const inGroup = group.type === 11 ? objectChildren(group) : [];
  if (inGroup.length !== 1 || inGroup[0].type !== 10 || !ownData(group) || auxCount(inGroup[0])) return null;
  const d = r.data;
  const a = { x: f64(d, DIM_A + 8), y: f64(d, DIM_A) };
  const b = { x: f64(d, DIM_B + 8), y: f64(d, DIM_B) };
  const u = { x: f64(d, DIM_DIR + 8), y: f64(d, DIM_DIR) };
  const offset = f64(d, DIM_OFFSET);
  if (![a.x, a.y, b.x, b.y, u.x, u.y, offset].every(Number.isFinite) || Math.abs(Math.hypot(u.x, u.y) - 1) > 1e-9) return null;
  if (!((b.x - a.x) * u.x + (b.y - a.y) * u.y > DIM_TOLERANCE)) return null;
  const drawn = kids.slice(0, 5).map((k) => shapeOf(k)?.points ?? []);
  if (drawn.some((q) => q.length !== 2)) return null;
  // the spacing, from the first extension line and the first run past it
  const n = { x: -u.y, y: u.x };
  const side = offset > 0 ? 1 : -1;
  const gap = side * ((drawn[0][0].x - a.x) * n.x + (drawn[0][0].y - a.y) * n.y);
  const over = side * ((drawn[0][1].x - a.x) * n.x + (drawn[0][1].y - a.y) * n.y) - side * offset;
  const ext = pointGap(drawn[2][0], drawn[2][1]);
  const want = dimensionLines(a, b, u, offset, gap, over, ext);
  if (want.some(([p, q], i) => pointGap(p, drawn[i][0]) > DIM_TOLERANCE || pointGap(q, drawn[i][1]) > DIM_TOLERANCE)) return null;
  return { a, b, u, offset, gap, over, ext, text: inGroup[0] };
}

/** The angle text along direction `u` reads at, degrees in (-90, 90]: left to right, or upwards. */
function readableAngle(u: Pt): number {
  const deg = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  return deg > 90 ? deg - 180 : deg <= -90 ? deg + 180 : deg;
}

export class Session implements EditSession {
  readonly doc: Model;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private savedTop: Step | null = null;
  private listeners = new Set<(e: ChangeEvent) => void>();
  private templates = new Map<number, Template>();
  /** an aux record's header per type, as the file has one (null: it has none) */
  private auxHeaders = new Map<number, Uint8Array | null>();
  private nextAddr = 0n;
  private nextName = 0;
  /** this open drawing as clipboard data names it (ClipboardData.drawing) */
  private readonly drawing = newGuid();
  /** textures and record formats by name, for the record list they were read from (textureLookup) */
  private named: { recs: readonly Rec[]; textures: Map<number, Rec>; formats: Map<string, Rec> } | null = null;
  /** set while batch() runs: commits apply at once and are recorded as one step at the end */
  private batching: { kinds: Set<ChangeKind>; ids: string[] } | null = null;
  /** changes applyRemote made within remoteBatch, rebuilt and told once it ends */
  private remoteHeld: { kinds: Set<ChangeKind>; ids: string[]; unnamed: boolean } | null = null;
  private stepListeners = new Set<(op: SpliceOp) => void>();
  private layerGuard: ((layerIds: readonly string[]) => string | null) | null = null;
  /** the plug-in objects a new one can copy, for the record list they were found in */
  private plugKinds: { recs: readonly Rec[]; list: PluginKind[] } | null = null;
  /** the slabs a new slab can copy, for the record list they were found in */
  private slabKinds: { recs: readonly Rec[]; list: SlabTemplate[] } | null = null;
  /** the linear dimension a new one copies (dimensionTemplate), for the record list it was found in */
  private dimKind: { recs: readonly Rec[]; id: string | null } | null = null;
  /** the walls a new wall can copy, for the record list they were found in */
  private wallKinds: { recs: readonly Rec[]; list: WallTemplate[] } | null = null;
  /** the doors and windows a new one can copy, for the record list they were found in */
  private insertKinds: { recs: readonly Rec[]; list: WallInsertKind[] } | null = null;

  constructor(doc: Model) {
    this.doc = doc;
    this.reseat();
    this.harvestTemplates();
  }

  /**
   * Moves fresh names and addresses past every one the records use. Addresses start at a random
   * block above them, so collaborators adding containers at the same moment don't pick the same one.
   */
  private reseat(): void {
    let maxName = 0;
    let maxAddr = 0n;
    for (const r of this.doc.recs) {
      maxName = Math.max(maxName, r.nameIndex);
      const o = r.owner;
      const p = u64(r.data, 0x10);
      if (o > maxAddr && o < 0x7f00_0000_0000n) maxAddr = o;
      if (p > maxAddr && p < 0x7f00_0000_0000n) maxAddr = p;
    }
    for (const k of this.doc.names.keys()) maxName = Math.max(maxName, k);
    this.nextName = Math.max(this.nextName, maxName + 1);
    if (this.nextAddr > maxAddr) return;
    // fresh addresses start above everything saved, 16-byte aligned like heap pointers
    const spread = BigInt(Math.floor(Math.random() * 0x10000)) << 16n;
    this.nextAddr = (((maxAddr >> 4n) + 0x1000n) << 4n) + spread;
  }

  // ---- state ------------------------------------------------------------------

  get dirty(): boolean {
    return (this.undoStack.at(-1) ?? null) !== this.savedTop;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const top = this.undoStack.at(-1);
    if (!top) return;
    this.guardSplice(top.start, top.start + top.added.length, top.removed.length);
    const s = this.undoStack.pop()!;
    this.doc.datas = spliced(this.doc.datas, s.start, s.added.length, s.removed);
    if (s.header) this.doc.patchHeader(s.header.at, s.header.before);
    this.doc.rebuild();
    this.redoStack.push(s);
    const header = s.header && { at: s.header.at, bytes: s.header.before, before: s.header.after };
    this.announce({ start: s.start, del: s.added.length, add: s.removed, removed: s.added, kind: s.kind, ids: s.ids, header });
    this.emit(s.kind, s.ids, "undo");
  }

  redo(): void {
    const top = this.redoStack.at(-1);
    if (!top) return;
    this.guardSplice(top.start, top.start + top.removed.length, top.added.length);
    const s = this.redoStack.pop()!;
    this.doc.datas = spliced(this.doc.datas, s.start, s.removed.length, s.added);
    if (s.header) this.doc.patchHeader(s.header.at, s.header.after);
    this.doc.rebuild();
    this.undoStack.push(s);
    const header = s.header && { at: s.header.at, bytes: s.header.after, before: s.header.before };
    this.announce({ start: s.start, del: s.removed.length, add: s.added, removed: s.removed, kind: s.kind, ids: s.ids, header });
    this.emit(s.kind, s.ids, "redo");
  }

  setLayerGuard(guard: ((layerIds: readonly string[]) => string | null) | null): void {
    this.layerGuard = guard;
  }

  /** Throws the layer guard's refusal of changing the drawing from `before` (the drawing as it is now) to `after`. */
  private guardChange(before: readonly Uint8Array[], after: readonly Uint8Array[]): void {
    if (!this.layerGuard) return;
    let s = 0;
    while (s < before.length && s < after.length && before[s] === after[s]) s++;
    let eb = before.length;
    let ea = after.length;
    while (eb > s && ea > s && before[eb - 1] === after[ea - 1]) {
      eb--;
      ea--;
    }
    if (s === eb && s === ea) return;
    this.guardSplice(s, eb, ea - s);
  }

  /** Throws the layer guard's refusal of replacing the records [start, end) of the drawing as it is now with `added` others. */
  private guardSplice(start: number, end: number, added: number): void {
    const guard = this.layerGuard;
    if (!guard) return;
    const layers = new Set(this.doc.layerRecs);
    const layerOf = (r: Rec | undefined): Rec | null => {
      for (let x = r ?? null; x; x = x.parent) if (layers.has(x)) return x;
      return null;
    };
    const touched = new Set<Rec>();
    // a layer's own record (its settings), or what it holds
    for (let i = start; i < end; i++) {
      const l = layerOf(this.doc.recs[i]);
      if (l) touched.add(l);
    }
    // records put in go into the list the record now at `start` is in (a layer's terminator when they
    // go at its end); before a layer's own record they go between layers, into none
    const at = this.doc.recs[start];
    if (added > 0 && at && !layers.has(at)) {
      const l = layerOf(at);
      if (l) touched.add(l);
    }
    if (!touched.size) return;
    const why = guard([...touched].map(guidOf));
    if (why) throw new Error(why);
  }

  onStep(listener: (op: SpliceOp) => void): () => void {
    this.stepListeners.add(listener);
    return () => this.stepListeners.delete(listener);
  }

  records(): readonly Uint8Array[] {
    return this.doc.datas;
  }

  private announce(op: SpliceOp): void {
    for (const l of [...this.stepListeners]) l(op);
  }

  applyRemote(op: SpliceOp): void {
    const runs: SpliceRun[] = op.more ? [op, ...op.more] : [op];
    this.doc.datas = applyRuns(this.doc.datas, runs);
    if (op.header) this.doc.patchHeader(op.header.at, op.header.bytes);
    const held = this.remoteHeld;
    if (!held) this.doc.rebuild();
    // undo still turns back this session's own steps, rebased past the change; a step it touched,
    // and every step before that, can no longer be undone
    let r: Splice[] = runs.map((x) => ({ start: x.start, del: x.del, add: x.add.length }));
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      const s = this.undoStack[i];
      const back: Splice[] = [{ start: s.start, del: s.added.length, add: s.removed.length }];
      const moved = transformRuns(back, r, false);
      const before = transformRuns(r, back, true);
      if (!moved || !before || (op.header && s.header && headersOverlap(op.header, s.header))) {
        this.undoStack.splice(0, i + 1);
        break;
      }
      s.start = moved[0].start;
      r = before;
    }
    this.redoStack = [];
    if (held) {
      held.kinds.add(op.kind);
      if (op.kind === "objects" && op.ids.length) for (const id of op.ids) held.ids.push(id);
      else held.unnamed = true;
      return;
    }
    this.reseat();
    this.emit(op.kind, op.ids, "remote");
  }

  remoteBatch<T>(fn: () => T): T {
    if (this.remoteHeld) return fn();
    const held = { kinds: new Set<ChangeKind>(), ids: [] as string[], unnamed: false };
    this.remoteHeld = held;
    try {
      return fn();
    } finally {
      this.remoteHeld = null;
      if (held.kinds.size) {
        this.doc.rebuild();
        this.reseat();
        const objects = held.kinds.size === 1 && held.kinds.has("objects") && !held.unnamed;
        this.emit(objects ? "objects" : "all", objects ? held.ids : [], "remote");
      }
    }
  }

  onChange(listener: (e: ChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  markSaved(): void {
    this.savedTop = this.undoStack.at(-1) ?? null;
    this.emit("all", []);
  }

  private emit(kind: ChangeKind, ids: string[], origin?: ChangeEvent["origin"]): void {
    const e: ChangeEvent = origin ? { kind, ids, origin } : { kind, ids };
    for (const l of [...this.listeners]) l(e);
  }

  private plan(): Plan {
    return new Plan(this.doc.datas);
  }

  private commit(plan: Plan, kind: ChangeKind, ids: string[] = []): void {
    // an edit inside a definition redraws its instances everywhere
    if (kind === "objects" && (plan.symbolsChanged || ids.some((id) => this.insideSymbol(id)))) kind = "all";
    const after = plan.build();
    this.guardChange(this.doc.datas, after);
    if (this.batching) {
      const before = this.doc.datas;
      if (after.length === before.length && after.every((d, i) => d === before[i])) return;
      this.doc.datas = after;
      this.doc.rebuild();
      this.batching.kinds.add(kind);
      this.batching.ids.push(...ids);
      return;
    }
    if (this.record(this.doc.datas, after, kind, ids)) {
      this.doc.datas = after;
      this.doc.rebuild();
      this.announceTop();
      this.emit(kind, ids);
    }
  }

  /** Tells step listeners about the step just recorded, once the document holds it. */
  private announceTop(): void {
    const s = this.undoStack.at(-1);
    const header = s?.header && { at: s.header.at, bytes: s.header.after, before: s.header.before };
    if (s) this.announce({ start: s.start, del: s.removed.length, add: s.added, removed: s.removed, kind: s.kind, ids: s.ids, header });
  }

  /** Push the undo step that turns `before` into `after`; false when nothing changed. */
  private record(before: Uint8Array[], after: Uint8Array[], kind: ChangeKind, ids: string[]): boolean {
    let s = 0;
    while (s < before.length && s < after.length && before[s] === after[s]) s++;
    let eb = before.length;
    let ea = after.length;
    while (eb > s && ea > s && before[eb - 1] === after[ea - 1]) {
      eb--;
      ea--;
    }
    if (s === eb && s === ea) return false;
    this.undoStack.push({ start: s, removed: before.slice(s, eb), added: after.slice(s, ea), kind, ids });
    this.redoStack = [];
    return true;
  }

  batch<T>(fn: () => T): T {
    if (this.batching) return fn();
    const before = this.doc.datas;
    const acc = { kinds: new Set<ChangeKind>(), ids: [] as string[] };
    this.batching = acc;
    let out: T;
    try {
      out = fn();
    } catch (err) {
      this.batching = null;
      if (this.doc.datas !== before) {
        this.doc.datas = before;
        this.doc.rebuild();
        this.emit("all", []);
      }
      throw err;
    }
    this.batching = null;
    const kind: ChangeKind = acc.kinds.size === 1 ? [...acc.kinds][0] : "all";
    if (this.record(before, this.doc.datas, kind, acc.ids)) {
      this.announceTop();
      this.emit(kind, acc.ids);
    }
    return out;
  }

  followOn<T>(fn: () => T): T {
    const top = this.undoStack.at(-1);
    if (!top || top.header || this.batching) return this.batch(fn);
    const before = spliced(this.doc.datas, top.start, top.added.length, top.removed);
    const out = this.batch(fn);
    const joined = this.undoStack.at(-1);
    if (joined && joined !== top && !joined.header) {
      this.undoStack.splice(-2, 2);
      this.record(before, this.doc.datas, top.kind === joined.kind ? top.kind : "all", [...top.ids, ...joined.ids]);
    }
    return out;
  }

  get undoDepth(): number {
    return this.undoStack.length;
  }

  joinSince(depth: number): void {
    if (this.batching || depth < 0 || this.undoStack.length - depth < 2) return;
    const steps = this.undoStack.slice(depth);
    if (steps.some((s) => s.header)) return;
    // the records as they were before the first of the steps: each turned back, newest first
    let before: Uint8Array[] = this.doc.datas;
    for (let i = steps.length - 1; i >= 0; i--) before = spliced(before, steps[i].start, steps[i].added.length, steps[i].removed);
    // peers and step listeners already have each step; only this session's undo changes, as in followOn
    this.undoStack.splice(depth);
    const kind = steps.every((s) => s.kind === steps[0].kind) ? steps[0].kind : "all";
    this.record(before, this.doc.datas, kind, steps.flatMap((s) => s.ids));
  }

  // ---- document settings ---------------------------------------------------------

  setUnits(name: string): void {
    if (this.batching) throw new Error("units can't change inside a batch");
    const { at, bytes } = unitsPatch(this.doc.header, name);
    const now = this.doc.header.subarray(at, at + bytes.length);
    if (now.every((b, i) => b === bytes[i])) return;
    const before = this.doc.patchHeader(at, bytes);
    // a step of no records: the header alone changes, and lengths show in the new unit everywhere
    this.undoStack.push({ start: 0, removed: [], added: [], kind: "all", ids: [], header: { at, before, after: bytes } });
    this.redoStack = [];
    this.announceTop();
    this.emit("all", []);
  }

  // ---- allocation ---------------------------------------------------------------

  private freshAddr(): bigint {
    const a = this.nextAddr;
    this.nextAddr += 0x40n;
    return a;
  }

  /**
   * Name indices for objects made in one step, unique against the drawing's names, its layers' and
   * each other ("Chair", then "Chair 2", "Chair 3"…); `write` puts the new ones in the name table.
   * No name (0) for an empty one, or once the table has no free index left.
   */
  private newNames(): { index(name: string | undefined): number; write(p: Plan): void } {
    const names = new Map(this.doc.names);
    const taken = new Set([...names.values(), ...this.doc.layerRecs.map((l) => this.doc.layerName(l))]);
    let added = false;
    return {
      index: (name) => {
        const base = name?.trim();
        if (!base || this.nextName > 0xffff) return 0;
        let free = base;
        for (let n = 2; taken.has(free); n++) free = `${base} ${n}`;
        taken.add(free);
        const index = this.freshName();
        names.set(index, free);
        added = true;
        return index;
      },
      write: (p) => {
        if (added) this.writeNames(p, names);
      },
    };
  }

  private freshName(): number {
    if (this.nextName > 0xffff) throw new Error("no free name indices left in this document");
    return this.nextName++;
  }

  /** Copies of a template with new GUIDs, addresses and aux pointers.
   *  The root gets `owner` and next != 0. */
  private instantiate(t: Template, owner: bigint): Uint8Array[] {
    const addr = new Map<number, bigint>();
    return t.recs.map((src, i) => {
      const d = src.slice();
      const p = t.parent[i];
      if (p < 0) {
        setOwner(d, owner);
        setNext(d, true);
      } else {
        let a = addr.get(p);
        if (a === undefined) {
          a = this.freshAddr();
          addr.set(p, a);
        }
        setOwner(d, a);
      }
      if (u64(d, 0x10) !== 0n) setU64(d, 0x10, this.freshAddr());
      if (hasGuid(d)) recOfData(d).guid = newGuid();
      return d;
    });
  }

  // ---- templates for new objects ----------------------------------------------------

  private harvestTemplates(): void {
    const want = new Set([...Object.values(TYPE_OF_KIND), SYMBOL_INSTANCE]);
    const score = (r: Rec): number => {
      const d = r.data;
      let s = 0;
      if (r.nameIndex !== 0) s += 4;
      if (r.type === 2 && (u16(d, 0x5a) !== 257 || d[0x50] !== 0)) s += 1; // prefer plain black solid lines
      if (r.type === 10) {
        const n = u16(d, 0xf6);
        const left = f64(d, 0x70);
        const top = f64(d, 0x68);
        if (f64(d, 0xb0) !== left || f64(d, 0xa8) !== top) s += 2; // prefer top-left justified
        if (d.length - 10 * n - 0x132 > 10) s += 1;
      }
      // a light a plug-in places (a Heliodon's sun) is less like the lamps a person places than a fixture's
      if (r.type === LIGHT) for (let p = r.parent; p; p = p.parent) if (p.type === PLUGIN) s += 2;
      return s;
    };
    const best = new Map<number, { rec: Rec; score: number }>();
    const consider = (r: Rec, penalty: number) => {
      if (!want.has(r.type)) return;
      const sc = score(r) + penalty;
      const cur = best.get(r.type);
      if (!cur || sc < cur.score) best.set(r.type, { rec: r, score: sc });
    };
    // objects on layers first, then anything else (e.g. inside symbol definitions)
    for (const layer of this.doc.layerRecs) for (const r of objectWalk(layer)) consider(r, 0);
    for (const r of this.doc.recs) if (r.parent && r.parent.type !== 31) consider(r, 100);
    for (const [type, { rec }] of best) this.templates.set(type, templateOf(rec));
    if (!this.templates.has(LOCUS)) this.templates.set(LOCUS, blankLocus());
    for (const [type, t] of builtinTemplates()) if (want.has(type) && !this.templates.has(type)) this.templates.set(type, t);
  }

  private template(type: number): Template {
    const t = this.templates.get(type);
    if (!t) throw new Error(`this file has no ${typeLabel(type)} to copy settings from yet`);
    return t;
  }

  // ---- lookups ------------------------------------------------------------------

  private layer(id: string): Rec {
    const r = this.doc.layerRec(id);
    if (!r) throw new Error(`no layer with id ${id}`);
    return r;
  }

  private viewport(id: string): Rec {
    const r = this.object(id);
    if (r.type !== VIEWPORT || viewportScaleAt(r.data) === null) throw new Error(`${r.typeName} is not a viewport`);
    return r;
  }

  private object(id: string): Rec {
    if (id.includes("/")) throw new Error("objects inside a symbol can't be edited here; edit the symbol instance instead");
    const r = this.doc.rec(id);
    if (!r || r.type === 31) throw new Error(`no object with id ${id}`);
    return r;
  }

  /**
   * Selected records with descendants of other selected records removed. A door, window or symbol
   * set in a wall among them throws unless `inserts` lets it through: it only slides along its wall
   * (moveObjects), as Rodeo can't cut or close its opening.
   */
  private topmost(ids: string[], inserts = false): Rec[] {
    const recs = [...new Set(ids)].map((id) => this.object(id));
    const set = new Set(recs);
    const top = recs.filter((r) => {
      for (let p = r.parent; p; p = p.parent) if (set.has(p)) return false;
      return true;
    });
    if (!inserts && top.some(isWallInsert)) throw new Error("a door or window set in a wall only slides along it yet: Rodeo can't cut or close its opening");
    return top;
  }

  /**
   * Re-fit the cached bounds of every group above the given records, deepest
   * first, from the plan's current child buffers. Groups store the union of
   * their children's 2D bounds at +0x68 (top, left, bottom, right) and, when
   * set, the same box at +0x9c as (x1, y1, z, x0, y0, z).
   * `added` lists new children per parent that the plan inserts.
   */
  private refitGroups(p: Plan, recs: Iterable<Rec>, added = new Map<Rec, Uint8Array[]>(), refitted = new Set<Rec>()): void {
    const list = [...recs];
    const groups = new Set<Rec>();
    const climb = (g: Rec | null) => {
      for (; g && g.type === 11; g = g.parent) groups.add(g);
    };
    for (const r of list) climb(r.parent);
    for (const g of added.keys()) climb(g);
    const depth = (r: Rec) => {
      let n = 0;
      for (let q = r.parent; q; q = q.parent) n++;
      return n;
    };
    const order = [...groups].filter((g) => !p.isRemoved(g.index)).sort((a, b) => depth(b) - depth(a));
    for (const g of order) {
      const datas = objectChildren(g)
        .filter((c) => !p.isRemoved(c.index))
        .map((c) => p.cur(c.index));
      for (const d of added.get(g) ?? []) datas.push(d);
      let box: BBox | null = null;
      for (const d of datas) box = unionBox(box, readBBox(d));
      const cur = p.cur(g.index);
      const next = cur.slice();
      writeGroupBox(next, box);
      if (next.subarray(0x68, 0xc4).every((v, i) => cur[0x68 + i] === v)) continue;
      p.set(g.index, next);
    }
    // a symbol definition's bounds, and its instances', follow what it holds
    const defs = new Set<Rec>();
    const inDef = (r: Rec | null): void => {
      for (; r; r = r.parent) {
        if (r.type === 16) {
          defs.add(r);
          return;
        }
      }
    };
    for (const r of list) inDef(r.parent);
    for (const g of added.keys()) inDef(g);
    for (const d of defs) {
      if (refitted.has(d) || p.isRemoved(d.index)) continue;
      refitted.add(d);
      this.refitSymbol(p, d, added.get(d) ?? [], refitted);
    }
  }

  /**
   * Fits a definition's bounds to what it holds, and each instance's to its placement of them.
   * Only bounds that matched the contents before the edit are rewritten: one definition in the
   * sample keeps its bounds at a hundredth of its contents', a convention not understood yet.
   */
  private refitSymbol(p: Plan, def: Rec, added: readonly Uint8Array[], refitted: Set<Rec>): void {
    p.symbolsChanged = true;
    let was: BBox | null = null;
    let box: BBox | null = null;
    for (const c of objectChildren(def)) {
      was = unionBox(was, readBBox(c.data));
      if (!p.isRemoved(c.index)) box = unionBox(box, readBBox(p.cur(c.index)));
    }
    for (const d of added) box = unionBox(box, readBBox(d));
    // an emptied definition keeps the bounds it had
    if (!box || !was) return;
    const placedBy = (m: Affine, b: BBox): BBox | null =>
      bboxOfPoints(
        [
          { x: b.x0, y: b.y0 },
          { x: b.x1, y: b.y0 },
          { x: b.x1, y: b.y1 },
          { x: b.x0, y: b.y1 },
        ].map((c) => applyAffine(m, c)),
      );
    if (sameBox(readBBox(def.data), was)) {
      const next = p.cur(def.index).slice();
      writeBBox(next, box);
      p.set(def.index, next);
    }
    const instances = this.doc.recs.filter(
      (r) => r.type === SYMBOL_INSTANCE && u16(r.data, 0x8e) === def.nameIndex && !p.isRemoved(r.index),
    );
    const moved: Rec[] = [];
    for (const inst of instances) {
      const d = p.cur(inst.index).slice();
      const m = readInstanceMatrix(d);
      const placed = placedBy(m, box);
      if (!placed || !sameBox(readBBox(inst.data), placedBy(m, was))) continue;
      writeBBox(d, placed);
      p.set(inst.index, d);
      moved.push(inst);
    }
    if (moved.length) this.refitGroups(p, moved, new Map(), refitted);
  }

  /** True when the object `id` is inside a symbol definition. */
  private insideSymbol(id: string): boolean {
    for (let r = this.doc.rec(id); r; r = r.parent) if (r.type === 16) return true;
    return false;
  }

  /** A layer, or the symbol definition or viewport annotations open for editing, that new objects can go into. */
  private container(id: string): Rec {
    const r = this.doc.layerRec(id) ?? this.doc.openSymbolRec(id) ?? this.doc.openAnnotationsRec(id);
    if (!r) throw new Error(`no layer with id ${id}`);
    return r;
  }

  /** True when definition `index` holds an instance of `target`, directly or through other definitions. */
  private holdsSymbol(index: number, target: number, seen = new Set<number>()): boolean {
    const def = this.doc.symbols.get(index);
    if (!def || seen.has(index)) return false;
    seen.add(index);
    for (const r of def.walk()) {
      if (r.type !== SYMBOL_INSTANCE) continue;
      const inner = u16(r.data, 0x8e);
      if (inner === target || this.holdsSymbol(inner, target, seen)) return true;
    }
    return false;
  }

  /** Owner value for new children of `parent`, and where to insert them. */
  private slot(parent: Rec): { owner: bigint; at: number } {
    const ch = parent.children;
    if (!ch.length) throw new Error(`${parent.typeName} has no child list`);
    const last = ch[ch.length - 1];
    return { owner: ch[0].owner, at: last.type === 0 ? last.index : subtreeEnd(parent) + 1 };
  }

  private checkName(name: string, ignoreLayer?: Rec, ignoreIndex?: number): void {
    if (!name.trim()) throw new Error("name cannot be empty");
    for (const l of this.doc.layerRecs) {
      if (l !== ignoreLayer && this.doc.layerName(l) === name) throw new Error(`"${name}" is already a layer name`);
    }
    for (const [i, n] of this.doc.names) {
      if (i !== ignoreIndex && n === name) throw new Error(`"${name}" is already used in this document`);
    }
  }

  private noneClass(): number {
    const i = this.doc.classIndexByName(NONE_CLASS);
    if (i === null) throw new Error('document has no "None" class');
    return i;
  }

  // ---- layers -------------------------------------------------------------------

  createLayer(name: string, kind: "design" | "sheet" = "design", scale?: number): string {
    this.checkName(name);
    const layers = this.doc.layerRecs;
    if (!layers.length) throw new Error("document has no layer to copy settings from");
    const want = kind === "sheet" ? 2 : 1;
    const tpl =
      [...layers].filter((l) => l.data[layerKindAt(l.data)] === want).sort((a, b) => a.children.length - b.children.length)[0] ??
      layers[0];
    // the layer, its aux records and its terminator; no objects
    const k = auxCount(tpl);
    const keep = new Set(tpl.children.slice(0, k));
    const term = tpl.children.at(-1);
    if (term?.type !== 0) throw new Error("template layer has no terminator");
    keep.add(term);
    const t = templateOf(tpl, (r, depth) => depth === 1 && !keep.has(r));
    const recs = this.instantiate(t, tpl.owner);
    let d = recs[0];
    const at = layerNameAt(d);
    const [, off] = readStr(d, at);
    const [, end] = readStr(d, off);
    const kindAt = layerKindAt(d);
    d = concat([d.subarray(0, at), packStr(name), packStr(""), d.subarray(end)]);
    setU64(d, 0, BigInt(d.length));
    setU16(d, 0x1a, this.freshName());
    d[kindAt] = want;
    setI16(d, LAYER_VIS, 0);
    if (want === 1) {
      // a new design layer is at ground level on no story, not where the one copied is
      setU16(d, LAYER_STORY, 0);
      setF64(d, layerElevationAt(d), 0);
    }
    setF64(d, LAYER_SCALE, scale && scale > 0 ? scale : kind === "sheet" ? 1 : f64(tpl.data, LAYER_SCALE));
    recs[0] = d;
    const p = this.plan();
    p.insert(subtreeEnd(layers[layers.length - 1]) + 1, recs);
    const id = recOfData(d).guid;
    this.commit(p, "layers", [id]);
    return id;
  }

  duplicateLayer(layerId: string, name: string): string {
    this.checkName(name);
    const src = this.layer(layerId);
    return this.batch(() => {
      // the layer with its aux records and terminator, as createLayer copies one, then its objects pasted
      const k = auxCount(src);
      const keep = new Set(src.children.slice(0, k));
      const term = src.children.at(-1);
      if (term?.type !== 0) throw new Error("layer has no terminator");
      keep.add(term);
      const recs = this.instantiate(templateOf(src, (r, depth) => depth === 1 && !keep.has(r)), src.owner);
      let d = recs[0];
      const at = layerNameAt(d);
      const [, off] = readStr(d, at);
      const [title, end] = readStr(d, off);
      d = concat([d.subarray(0, at), packStr(name), packStr(title), d.subarray(end)]);
      setU64(d, 0, BigInt(d.length));
      setU16(d, 0x1a, this.freshName());
      // a story's levels each name one layer: the copy is on none, at the elevation it had (which is absolute)
      if (d[layerKindAt(d)] === 1) setU16(d, LAYER_STORY, 0);
      recs[0] = d;
      const p = this.plan();
      p.insert(subtreeEnd(src) + 1, recs);
      const id = recOfData(d).guid;
      this.commit(p, "layers", [id]);
      const objects = objectChildren(this.layer(layerId));
      if (objects.length) this.pasteObjects(id, this.clipboardOf(objects));
      return id;
    });
  }

  deleteLayer(layerId: string): void {
    const l = this.layer(layerId);
    if (this.doc.layerRecs.length < 2) throw new Error("a document needs at least one layer");
    const isSheet = (r: Rec): boolean => r.data[layerKindAt(r.data)] === 2;
    if (!isSheet(l) && this.doc.layerRecs.filter((r) => !isSheet(r)).length < 2) {
      throw new Error("a document needs at least one design layer");
    }
    const p = this.plan();
    p.remove(l.index, subtreeEnd(l));
    if (!isSheet(l)) this.renameStoryLevels(p, new Map([[this.doc.layerName(l), ""]]));
    this.commit(p, "all", [layerId]);
  }

  renameLayer(layerId: string, name: string, title?: string): void {
    const l = this.layer(layerId);
    const oldName = this.doc.layerName(l);
    if (name !== oldName) this.checkName(name, l);
    const d = this.layerRenamed(l, name, title);
    if (!d) return;
    const p = this.plan();
    p.set(l.index, d);
    // a story's levels name the design layers at them
    if (name !== oldName && l.data[layerKindAt(l.data)] !== 2) this.renameStoryLevels(p, new Map([[oldName, name]]));
    this.commit(p, "layers", [layerId]);
  }

  /** A layer record with its name, and a sheet layer's title (kept when undefined); null when neither changes. */
  private layerRenamed(l: Rec, name: string, title?: string): Uint8Array | null {
    const at = layerNameAt(l.data);
    const [oldName, off] = readStr(l.data, at);
    const [oldTitle, end] = readStr(l.data, off);
    const t = title ?? oldTitle;
    if (!name.trim()) throw new Error("name cannot be empty");
    if (l.data[layerKindAt(l.data)] !== 2 && t) throw new Error("design layers have no title");
    if (name === oldName && t === oldTitle) return null;
    const d = concat([l.data.subarray(0, at), packStr(name), packStr(t), l.data.subarray(end)]);
    setU64(d, 0, BigInt(d.length));
    return d;
  }

  /** Each story level at a design layer named by a key of `layers` is at its value instead ("" for none). */
  private renameStoryLevels(p: Plan, layers: ReadonlyMap<string, string>): void {
    for (const r of this.doc.recs) {
      if (!isStory(r) || !readStory(r.data)?.levels.some((l) => layers.has(l.layer))) continue;
      p.set(r.index, writeStory(p.cur(r.index), { layers }));
    }
  }

  setLayerView(layerId: string, view: LayerView): void {
    const l = this.layer(layerId);
    if (l.data[layerKindAt(l.data)] === 2) throw new Error("a sheet layer is always seen in Top/Plan");
    const data = writeLayerView(l.data, view);
    if (data.every((b, i) => b === l.data[i])) return;
    const p = this.plan();
    p.set(l.index, data);
    this.commit(p, "layers", [layerId]);
  }

  setSheetPage(layerId: string, page: PageSize): void {
    const l = this.layer(layerId);
    if (l.data[layerKindAt(l.data)] !== 2) throw new Error("only a sheet layer has a page of its own");
    const w = page.width / 25.4;
    const h = page.height / 25.4;
    const fits = (v: number) => v > 0 && v <= MAX_PAGE_INCHES;
    if (!fits(w) || !fits(h)) throw new Error(`a page side takes a length above 0, up to ${MAX_PAGE_INCHES.toLocaleString("en")} inches`);
    const at = layerPageAt(l.data);
    if (at + 16 > l.data.length) throw new Error("this sheet layer's record holds no page");
    if (f64(l.data, at) === w && f64(l.data, at + 8) === h) return;
    const p = this.plan();
    const d = p.mut(l.index);
    setF64(d, at, w);
    setF64(d, at + 8, h);
    this.commit(p, "layers", [layerId]);
  }

  setLayerVisibility(layerId: string, v: Visibility): void {
    visibilityCode(v);
    const l = this.layer(layerId);
    const p = this.plan();
    setI16(p.mut(l.index), LAYER_VIS, visibilityCode(v));
    this.commit(p, "layers", [layerId]);
  }

  setLayerScale(layerId: string, scale: number): void {
    if (!(scale > 0) || !Number.isFinite(scale)) throw new Error("scale must be a positive number");
    const l = this.layer(layerId);
    const p = this.plan();
    setF64(p.mut(l.index), LAYER_SCALE, scale);
    this.commit(p, "layers", [layerId]);
  }

  setLayerElevation(layerId: string, elevation: number): void {
    if (!Number.isFinite(elevation)) throw new Error("elevation must be a number");
    const l = this.layer(layerId);
    if (l.data[layerKindAt(l.data)] === 2) throw new Error("sheet layers have no elevation");
    const at = layerElevationAt(l.data);
    const was = f64(l.data, at);
    if (was === elevation) return;
    const p = this.plan();
    setF64(p.mut(l.index), at, elevation);
    this.liftLayer(p, l, elevation - (Number.isFinite(was) ? was : 0));
    this.commit(p, "all", [layerId]);
  }

  setLayerStory(layerId: string, story: number): void {
    const l = this.layer(layerId);
    if (l.data[layerKindAt(l.data)] === 2) throw new Error("sheet layers aren't on stories");
    if (story !== 0 && !this.doc.storyRec(story)) throw new Error(`no story #${story}`);
    const old = u16(l.data, LAYER_STORY);
    if (old === story) return;
    const p = this.plan();
    setU16(p.mut(l.index), LAYER_STORY, story);
    // a level of the story it leaves is at no layer
    const from = old ? this.doc.storyRec(old) : null;
    const name = this.doc.layerName(l);
    if (from && readStory(from.data)?.levels.some((v) => v.layer === name)) p.set(from.index, writeStory(from.data, { layers: new Map([[name, ""]]) }));
    this.commit(p, "layers", [layerId]);
  }

  reorderLayers(layerIds: string[]): void {
    const layers = this.doc.layerRecs;
    const ordered = layerIds.map((id) => this.layer(id));
    if (ordered.length !== layers.length || new Set(ordered).size !== layers.length) {
      throw new Error("reorder must list every layer exactly once");
    }
    const first = layers[0].index;
    const last = subtreeEnd(layers[layers.length - 1]);
    const block: Uint8Array[] = [];
    for (const l of ordered) for (let i = l.index; i <= subtreeEnd(l); i++) block.push(this.doc.datas[i]);
    if (block.length !== last - first + 1) throw new Error("layers are not stored contiguously");
    const p = this.plan();
    p.remove(first, last);
    p.insert(last + 1, block);
    this.commit(p, "layers", layerIds);
  }

  // ---- stories ----------------------------------------------------------------------

  private story(index: number): Rec {
    const r = this.doc.storyRec(index);
    if (!r) throw new Error(`no story #${index}`);
    return r;
  }

  createStory(name: string, suffix: string, elevation: number): number {
    if (!Number.isFinite(elevation)) throw new Error("elevation must be a number");
    this.checkName(name);
    const list = this.doc.recs.find((r) => isStoryList(r));
    if (!list) throw new Error("this drawing has no story list");
    const first = list.children[0] ?? null;
    if (first && !isStory(first)) throw new Error("this drawing's story list holds something else");
    const d = newStory((first ?? list).data, suffix, elevation);
    const index = this.freshName();
    setU16(d, 0x1a, index);
    setU64(d, 0x10, 0n);
    recOfData(d).guid = newGuid();
    const p = this.plan();
    if (first) {
      // before the first, so the list's end stays where it is
      setOwner(d, first.owner);
      setNext(d, true);
      p.insert(first.index, [d]);
    } else {
      // the list's first: a new owner right after it opens the list (records.ts)
      const addr = this.freshAddr();
      setU64(p.mut(list.index), 0x10, addr);
      setOwner(d, addr);
      setNext(d, false);
      p.insert(list.index + 1, [d]);
    }
    const names = new Map(this.doc.names);
    names.set(index, name);
    this.writeNames(p, names);
    this.commit(p, "layers", []);
    return index;
  }

  renameStory(index: number, name: string): void {
    this.story(index);
    const old = this.doc.names.get(index);
    if (old === name) return;
    this.checkName(name, undefined, index);
    // data visualisations test a story by its name
    if (old !== undefined) this.refuseNamed(old, "renaming");
    const names = new Map(this.doc.names);
    names.set(index, name);
    const p = this.plan();
    this.writeNames(p, names);
    this.commit(p, "layers", []);
  }

  editStory(index: number, change: { suffix?: string; elevation?: number; levels?: readonly StoryLevelSpec[] }): void {
    const rec = this.story(index);
    const story = readStory(rec.data);
    if (!story) throw new Error(`story "${this.doc.names.get(index) ?? index}" can't be read`);
    if (change.elevation !== undefined && !Number.isFinite(change.elevation)) throw new Error("elevation must be a number");
    const on = this.doc.layerRecs.filter((l) => l.data[layerKindAt(l.data)] !== 2 && u16(l.data, LAYER_STORY) === index);
    if (change.levels) this.checkLevels(change.levels, story.levels.length, new Set(on.map((l) => this.doc.layerName(l))));
    const d = writeStory(rec.data, change);
    if (d === rec.data) return;
    const p = this.plan();
    p.set(rec.index, d);
    // the design layers on it keep their elevations above it, and those at a level are at its elevation
    const base = change.elevation ?? story.elevation;
    const by = base - story.elevation;
    const at = new Map((change.levels ?? []).filter((v) => v.layer).map((v) => [v.layer, base + v.elevation]));
    let moved = false;
    for (const l of on) {
      const off = layerElevationAt(l.data);
      const was = f64(l.data, off);
      const z = at.get(this.doc.layerName(l)) ?? was + by;
      if (z === was) continue;
      setF64(p.mut(l.index), off, z);
      this.liftLayer(p, l, z - (Number.isFinite(was) ? was : 0));
      moved = true;
    }
    this.commit(p, moved ? "all" : "layers", []);
  }

  /** Refuses levels that aren't a story's: each named, by a type no other has, at a finite elevation, at one of its layers no other names. */
  private checkLevels(levels: readonly StoryLevelSpec[], had: number, layers: ReadonlySet<string>): void {
    const types = new Set<string>();
    const named = new Set<string>();
    const from = new Set<number>();
    for (const v of levels) {
      if (!v.type.trim()) throw new Error("a level needs a level type");
      if (types.has(v.type)) throw new Error(`the story has two "${v.type}" levels`);
      types.add(v.type);
      if (!Number.isFinite(v.elevation)) throw new Error(`the elevation of "${v.type}" must be a number`);
      if (v.layer) {
        if (!layers.has(v.layer)) throw new Error(`"${v.layer}" isn't a design layer on this story`);
        if (named.has(v.layer)) throw new Error(`"${v.layer}" is at two levels`);
        named.add(v.layer);
      }
      if (v.from !== undefined) {
        if (!Number.isInteger(v.from) || v.from < 0 || v.from >= had || from.has(v.from)) throw new Error(`the story has no level #${v.from} to keep`);
        from.add(v.from);
      }
    }
  }

  deleteStory(index: number): void {
    const rec = this.story(index);
    const name = this.doc.names.get(index);
    if (name !== undefined) this.refuseNamed(name, "deleting");
    const p = this.plan();
    for (const l of this.doc.layerRecs) if (u16(l.data, LAYER_STORY) === index) setU16(p.mut(l.index), LAYER_STORY, 0);
    // a story list left empty has no address, as one never filled has none
    if (rec.parent && rec.parent.children.length === 1) setU64(p.mut(rec.parent.index), 0x10, 0n);
    this.removeResource(p, rec, index);
    this.commit(p, "layers", []);
  }

  // ---- classes ----------------------------------------------------------------------

  private writeNames(p: Plan, names: Map<number, string>): void {
    const nt = this.doc.nameTable;
    if (!nt) throw new Error("document has no name table");
    const tmp = new Rec(p.cur(nt.index).slice());
    writeNameTable(tmp, names);
    p.set(nt.index, tmp.data);
  }

  createClass(name: string): number {
    this.checkName(name);
    const list = this.doc.classList;
    const none = this.doc.classRecs.get(this.noneClass());
    const tpl = [...this.doc.classRecs.values()].filter((c) => c !== none).at(-1) ?? none;
    if (!list || !tpl) throw new Error("document has no class list");
    const index = this.freshName();
    const [d] = this.instantiate(templateOf(tpl), tpl.owner);
    setU16(d, 0x1a, index);
    setI16(d, CLASS_VIS, 0);
    const names = new Map(this.doc.names);
    names.set(index, name);
    const p = this.plan();
    this.writeNames(p, names);
    p.insert(tpl.index, [d]); // before the template: keeps any next=0 list end in place
    this.commit(p, "classes", []);
    return index;
  }

  duplicateClass(index: number, name: string): number {
    this.checkName(name);
    const src = this.doc.classRecs.get(index);
    if (!src) throw new Error(`no class #${index}`);
    const fresh = this.freshName();
    const [d] = this.instantiate(templateOf(src), src.owner);
    setU16(d, 0x1a, fresh);
    const names = new Map(this.doc.names);
    names.set(fresh, name);
    const p = this.plan();
    this.writeNames(p, names);
    p.insert(src.index, [d]); // before the one copied, as createClass puts a new class
    this.commit(p, "classes", []);
    return fresh;
  }

  renameClass(index: number, name: string): void {
    if (!this.doc.classRecs.has(index)) throw new Error(`no class #${index}`);
    if (index === this.noneClass()) throw new Error('the "None" class can\'t be renamed');
    if (this.doc.names.get(index) === name) return;
    this.checkName(name, undefined, index);
    const names = new Map(this.doc.names);
    names.set(index, name);
    const p = this.plan();
    this.writeNames(p, names);
    this.commit(p, "classes", []);
  }

  /** Deletes a class, what was in it going to `into` (None if not given). */
  deleteClass(index: number, into?: number): void {
    const rec = this.doc.classRecs.get(index);
    if (!rec) throw new Error(`no class #${index}`);
    const none = this.noneClass();
    if (index === none) throw new Error('the "None" class can\'t be deleted');
    if (into !== undefined && (into === index || !this.doc.classRecs.has(into))) throw new Error(`no class #${into} to merge into`);
    const p = this.plan();
    for (const r of this.doc.recs) {
      if (r !== rec && r.type !== 55 && r.classIndex === index) setU32(p.mut(r.index), 0x20, into ?? none);
    }
    p.remove(rec.index, subtreeEnd(rec));
    const names = new Map(this.doc.names);
    names.delete(index);
    this.writeNames(p, names);
    this.commit(p, "all", []);
  }

  setClassVisibility(index: number, v: Visibility): void {
    visibilityCode(v);
    const rec = this.doc.classRecs.get(index);
    if (!rec) throw new Error(`no class #${index}`);
    const p = this.plan();
    setI16(p.mut(rec.index), CLASS_VIS, visibilityCode(v));
    this.commit(p, "classes", []);
  }

  setClassAttributes(index: number, attrs: Partial<Attributes>): void {
    const rec = this.doc.classRecs.get(index);
    if (!rec) throw new Error(`no class #${index}`);
    if (Object.values(attrs).every((v) => v === undefined)) return;
    const p = this.plan();
    writeClassAttrs(p.mut(rec.index), attrs);
    // every object taking these from the class draws anew
    this.commit(p, "objects", []);
  }

  setClassTexture(index: number, texture: number): void {
    const rec = this.doc.classRecs.get(index);
    if (!rec) throw new Error(`no class #${index}`);
    if (rec.data.length < CLASS_TEXTURE + 4) throw new Error("this class's record has no texture field");
    if (texture !== 0 && !this.doc.recs.some((r) => r.type === TEXTURE && r.nameIndex === texture)) throw new Error(`no texture #${texture}`);
    if (i32(rec.data, CLASS_TEXTURE) === texture) return;
    const p = this.plan();
    setI32(p.mut(rec.index), CLASS_TEXTURE, texture);
    this.commit(p, "objects", []);
  }

  setObjectTexture(id: string, part: number, change: TexturePartChange): void {
    const r = this.object(id);
    const t = change.texture;
    if (t !== undefined && (!Number.isInteger(t) || t < -1 || (t > 0 && !this.textureLookup().textures.has(t)))) throw new Error(`no texture #${t}`);
    for (const v of [change.offsetU, change.offsetV, change.scaleU, change.scaleV, change.rotation]) {
      if (v !== undefined && !Number.isFinite(v)) throw new Error("texture placement takes finite numbers");
    }
    if (change.scaleU === 0 || change.scaleV === 0) throw new Error("a texture's scale can't be 0");
    const dict = textureDict(r);
    const p = this.plan();
    if (dict && holdsParts(dict.data)) {
      if (!writeTexturePart(p.mut(dict.index), part, change)) throw new Error(`this object has no texture part ${part}`);
    } else {
      if (part !== OVERALL) throw new Error("an object without texture parts takes a texture on the whole object");
      if (!dict && !TAKES_TEXTURE.has(r.type)) throw new Error(`${typeLabel(r.type)} objects don't take a texture here`);
      // a new part starts mapped as the drawing's objects of its type mostly are
      const counts = new Map<string, number>();
      for (const o of this.doc.recs) {
        if (o.type !== r.type) continue;
        const like = textureDict(o);
        const l = like && partLike(like.data);
        if (l) counts.set(`${l.flag} ${l.mapping}`, (counts.get(`${l.flag} ${l.mapping}`) ?? 0) + 1);
      }
      const [flag, mapping] = ([...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "77 0").split(" ").map(Number);
      const body = newTextureDict([{ part: OVERALL, texture: t ?? -1, flag, mapping }], dict ? tailValues(dict.data) : [0]);
      if (dict) {
        const d = new Uint8Array(0x50 + body.length);
        d.set(p.cur(dict.index).subarray(0, 0x50));
        d.set(body, 0x50);
        writeTexturePart(d, OVERALL, change);
        p.set(dict.index, d);
      } else {
        const d = this.newAux(76, body);
        writeTexturePart(d, OVERALL, change);
        this.addAux(p, r, d, DROP_SHADOW);
      }
    }
    this.commit(p, "objects", [id]);
  }

  setLight(id: string, change: LightChange): void {
    const device = this.lightingDevice(id);
    if (device) return this.setDeviceLight(device, change);
    const r = this.object(id);
    if (r.type !== LIGHT) throw new Error("that object isn't a light");
    if (this.doc.lights3d().some((l) => l.id === id && l.placedBy === "plugin")) throw new Error("a plug-in redraws its lights from its parameters");
    const p = this.plan();
    // written into a copy first: a value the light can't take leaves the drawing as it was
    const d = p.cur(r.index).slice();
    // its height is above its layer (Light3D.own), stored with the layer's elevation in it
    const at = change.position;
    const ground = layerElevationOf(r);
    writeLight(d, at?.length === 3 && ground ? { ...change, position: [at[0], at[1], at[2] + ground] } : change);
    p.set(r.index, d);
    // a group's box takes in where it went
    if (change.position) this.refitGroups(p, [r]);
    this.commit(p, "objects", [id]);
  }

  /** The lighting device whose light (Light3D.device) has the id `id`, or that has it itself; null for any other. */
  private lightingDevice(id: string): Rec | null {
    const isDevice = (r: Rec): boolean => r.type === PLUGIN && isLightingDevice(this.doc.pluginName(r));
    const own = this.doc.rec(id);
    if (own && isDevice(own)) return own;
    const light = this.doc.lights3d().find((l) => l.device && l.id === id);
    const top = light && this.doc.rec(light.objectId);
    if (!top) return null;
    // the device holding the light, the top-level object or one in a group of it
    const find = (r: Rec, device: Rec | null): Rec | null => {
      for (const c of r.children) {
        if (guidOf(c) === id) return device;
        const found = c.children.length ? find(c, isDevice(c) ? c : device) : null;
        if (found) return found;
      }
      return null;
    };
    return find(top, isDevice(top) ? top : null);
  }

  /**
   * A lighting device's light changed through its parameters (lightingDevice.ts): `change.direction`
   * is in the drawing's frame, as Light3D.direction, and is turned into the device's pan and tilt.
   */
  private setDeviceLight(device: Rec, change: LightChange): void {
    if (change.kind !== undefined && change.kind !== "spot") throw new Error("a lighting device's light is a spot");
    if (change.position) throw new Error("a lighting device's light shines from its fixture: move the device to move it");
    const params = this.pluginParams(device);
    if (!params) throw new Error("this lighting device has no parameters");
    const p = this.plan();
    let d = p.cur(params.rec.index);
    const now = readDeviceLight(readValues(d, params.fmt) ?? []);
    const direction = change.direction ? ownDirection(device.data, change.direction) : undefined;
    const values = deviceLightValues(now, { on: change.on, color: change.color, brightness: change.brightness, spread: change.spread, beam: change.beam, direction });
    const held = new Set(params.fmt.fields.map((f) => f.name));
    for (const [name, value] of Object.entries(values)) if (held.has(name)) d = writeValue(d, params.fmt, name, value);
    p.set(params.rec.index, d);
    this.commit(p, "objects", [guidOf(device)]);
  }

  /** A Renderworks camera's parameter record and its format (FORMAT.md §7), or null for any other object. */
  private cameraParams(r: Rec): { rec: Rec; fmt: FormatDef } | null {
    return this.doc.pluginName(r) === CAMERA_PLUGIN ? this.pluginParams(r) : null;
  }

  heliodonTemplate(): string | null {
    const layers = new Set(this.doc.layers().flatMap((l) => (l.kind === "design" ? [this.doc.layerRec(l.id)] : [])));
    const r = this.doc.recs.find((x) => x.type === PLUGIN && !!x.parent && layers.has(x.parent) && this.doc.pluginName(x) === HELIODON && copyable(x) && !!this.doc.heliodon(guidOf(x)));
    return r ? guidOf(r) : null;
  }

  setHeliodonSun(id: string, sun: Pick<HeliodonSun, "latitude" | "month" | "day" | "hour">): void {
    const r = this.object(id);
    const params = this.doc.pluginName(r) === HELIODON ? this.pluginParams(r) : null;
    if (!params) throw new Error("that object isn't a Heliodon");
    const { latitude, month, day, hour } = sun;
    if (!(Math.abs(latitude) <= 90)) throw new Error("a latitude is -90° to 90°");
    if (!(Number.isInteger(month) && month >= 1 && month <= 12)) throw new Error("a month is 1 to 12");
    const days = new Date(Date.UTC(2025, month, 0)).getUTCDate();
    if (!(Number.isInteger(day) && day >= 1 && day <= days)) throw new Error(`that month has days 1 to ${days}`);
    if (!(hour >= 0 && hour < 24)) throw new Error("a time is 0:00 to 23:59");
    const p = this.plan();
    this.writeSun(p, r, params, sun);
    this.commit(p, "objects", [id]);
  }

  setHeliodonPlace(id: string, place: { longitude?: number; daylightSaving?: boolean }): void {
    const r = this.object(id);
    const params = this.doc.pluginName(r) === HELIODON ? this.pluginParams(r) : null;
    if (!params) throw new Error("that object isn't a Heliodon");
    const { longitude, daylightSaving } = place;
    if (longitude !== undefined && !(Math.abs(longitude) <= 180)) throw new Error("a longitude is -180° to 180°");
    const p = this.plan();
    const was = p.cur(params.rec.index);
    let d = was;
    if (longitude !== undefined) d = writeValue(writeValue(d, params.fmt, "__Longitude", Math.abs(longitude)), params.fmt, "__EastWest", longitude < 0 ? "W" : "E");
    if (daylightSaving !== undefined) d = writeValue(d, params.fmt, "DaylightSavings", daylightSaving);
    p.set(params.rec.index, d);
    this.writeSun(p, r, params, undefined, was);
    this.commit(p, "objects", [id]);
  }

  /**
   * Works a Heliodon's sun out again: from `sun`, else from its parameters as the plan has them. Its
   * parameters that show the sun are rewritten, its lights turned to shine from it and its label's
   * time and date (as `was`, its parameters before an edit to them, had them) printed again.
   * Parameters that say no date or time leave it as it was.
   */
  private writeSun(p: Plan, r: Rec, params: { rec: Rec; fmt: FormatDef }, sun?: Pick<HeliodonSun, "latitude" | "month" | "day" | "hour">, was?: Uint8Array): void {
    let d = p.cur(params.rec.index);
    const fields = (data: Uint8Array) => new Map((readValues(data, params.fmt) ?? []).map((f) => [f.name, f.value] as const));
    const now = fields(d);
    const next = sun ?? readHeliodonSun(now);
    if (!next) return;
    for (const [name, value] of Object.entries(heliodonFields(now, next))) if (now.has(name)) d = writeValue(d, params.fmt, name, value);
    p.set(params.rec.index, d);
    const after = fields(d);
    const placed = readHeliodonSun(after);
    if (!placed) return;
    const direction = heliodonLight(placed);
    // its label prints its time, a city and its date: "16:30", "Dover", "21. June"
    const label = (f: ReadonlyMap<string, unknown>): { time: string; date: string } => ({ time: String(f.get("Time") ?? ""), date: `${f.get("Day")}. ${f.get("Month")}` });
    const printed = label(was ? fields(was) : now);
    const is = label(after);
    const relabelled: Rec[] = [];
    for (const o of objectWalk(r)) {
      if (o.type === LIGHT) {
        const light = p.cur(o.index).slice();
        writeLight(light, { direction });
        p.set(o.index, light);
      } else if (o.type === 10 && (printed.time !== is.time || printed.date !== is.date)) {
        const lines = readText(p.cur(o.index)).split(/\r\n|\r|\n/);
        if (lines.length < 2 || lines[0] !== printed.time || lines.at(-1) !== printed.date) continue;
        p.set(o.index, encodeText(p.cur(o.index), [is.time, ...lines.slice(1, -1), is.date].join("\r")));
        relabelled.push(o);
      }
    }
    // groups in its drawing fit their texts again; its own box isn't its drawing's (none, in newer
    // files), so it stays as it was
    if (relabelled.length) this.refitGroups(p, relabelled);
  }

  /** A plug-in's parameter record and its format, or null for an object without one. */
  private pluginParams(r: Rec): { rec: Rec; fmt: FormatDef } | null {
    for (const c of r.children) {
      const fmt = c.type === RECORD ? this.doc.formatDef(recordFormat(c.data)) : undefined;
      if (fmt?.parametric) return { rec: c, fmt };
    }
    return null;
  }

  /**
   * Writes the named numbers of a camera's parameters through `next`, which gets each one as it was
   * (one the record doesn't hold as a number is left out).
   */
  private writeCameraParams(p: Plan, cam: { rec: Rec; fmt: FormatDef }, next: (get: (name: string) => number | null) => Record<string, number>): void {
    let d = p.cur(cam.rec.index);
    const fields = readValues(d, cam.fmt) ?? [];
    const get = (name: string): number | null => {
      const v = fields.find((f) => f.name === name)?.value;
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    for (const [name, value] of Object.entries(next(get))) if (get(name) !== null) d = writeValue(d, cam.fmt, name, value);
    p.set(cam.rec.index, d);
  }

  /**
   * A camera's eye and look-to point go with it when it moves, turns or mirrors (through m in plan,
   * raised by dz); its heights above its matrix (CameraZPos, LookToZPos) stay.
   */
  private carryCamera(p: Plan, r: Rec, m: Affine, dz = 0): void {
    const cam = this.cameraParams(r);
    if (!cam || (isIdentity(m) && dz === 0)) return;
    this.writeCameraParams(p, cam, (get) => cameraPointsThrough(get, m, dz));
  }

  addCamera(layerId: string, eye: Vec3, target: Vec3, classIndex?: number): string {
    const tpl = this.cameraTemplate();
    if (!tpl) throw new Error("this drawing has no Renderworks camera to copy settings from");
    if (![...eye, ...target].every(Number.isFinite)) throw new Error("a camera's eye and look-to point are finite numbers");
    if (!(Math.hypot(target[0] - eye[0], target[1] - eye[1]) > 1)) throw new Error("a camera can't look straight up or down");
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    const taken = new Set(this.doc.cameras().map((c) => c.name));
    let n = this.doc.cameras().length + 1;
    while (taken.has(`Camera ${n}`)) n++;
    const name = `Camera ${n}`;
    return this.batch(() => {
      const { owner, at } = this.slot(layer);
      const copies = this.instantiate(templateOf(tpl), owner);
      const d = copies[0];
      setU16(d, 0x1a, 0);
      setU32(d, 0x20, cls);
      // it stands on the layer, at its elevation: its height above it is all in its parameters (CameraZPos)
      if (d.length >= PLUGIN_MATRIX + 96) setF64(d, PLUGIN_MATRIX + 88, layerElevationOf(layer));
      const cam = this.cameraParams(tpl);
      // the copies follow the template's records in pre-order (templateOf)
      const i = cam ? [...tpl.walk()].indexOf(cam.rec) : -1;
      if (cam && i >= 0) {
        const fmt = cam.fmt;
        let q = copies[i];
        for (const [field, value] of [["Name", name], ["__PrevName", name], ["__Active", false]] as const) {
          if (fmt.fields.some((f) => f.name === field)) q = writeValue(q, fmt, field, value);
        }
        copies[i] = q;
      }
      const p = this.plan();
      p.insert(at, copies);
      this.refitGroups(p, [], new Map([[layer, [d]]]));
      const id = recOfData(d).guid;
      this.commit(p, "objects", [id]);
      this.setCameraView(id, eye, target);
      return id;
    });
  }

  canAddCamera(): boolean {
    return this.cameraTemplate() !== null;
  }

  /** A camera of the drawing's to copy: one on a design layer before one in a sheet viewport. */
  private cameraTemplate(): Rec | null {
    const placed = this.doc.cameras();
    const pick = placed.find((c) => !c.viewportId) ?? placed[0];
    return pick ? this.doc.rec(pick.id) : null;
  }

  wallTemplates(): WallTemplate[] {
    if (this.wallKinds?.recs !== this.doc.recs) this.wallKinds = { recs: this.doc.recs, list: this.findWallTemplates() };
    return this.wallKinds.list;
  }

  private findWallTemplates(): WallTemplate[] {
    const kinds = new Map<string, WallTemplate>();
    const layers = new Set(this.doc.layers().flatMap((l) => (l.kind === "design" ? [this.doc.layerRec(l.id)] : [])));
    for (const r of this.doc.recs) {
      if (r.type !== WALL || !r.parent || !layers.has(r.parent)) continue;
      const id = guidOf(r);
      const w = this.doc.wall(id);
      if (!w) continue;
      const height = w.top - w.bottom;
      const key = `${w.style}|${w.thickness.toFixed(2)}|${height.toFixed(2)}`;
      if (kinds.has(key)) continue;
      const faces = stretchableWall(this.doc, r);
      if (faces) kinds.set(key, { id, style: w.style, thickness: w.thickness, height, faces });
    }
    // styled walls by name, then unstyled ones, each thinnest first
    const found = [...kinds.values()].sort((x, y) => (x.style ?? "\uffff").localeCompare(y.style ?? "\uffff") || x.thickness - y.thickness || x.height - y.height);
    // a drawing with no styled walls can also start the plain sizes, after any it has to copy
    if (found.some((k) => k.style !== null)) return found;
    return [...found, ...plainWalls(this.doc.info.units).filter((k) => !found.some((f) => Math.abs(f.thickness - k.thickness) < 0.01 && Math.abs(f.height - k.height) < 0.01))];
  }

  pluginKinds(): PluginKind[] {
    if (this.plugKinds?.recs !== this.doc.recs) this.plugKinds = { recs: this.doc.recs, list: this.findPluginKinds() };
    return this.plugKinds.list;
  }

  private findPluginKinds(): PluginKind[] {
    const kinds = new Map<string, PluginKind>();
    const layers = new Set(this.doc.layers().flatMap((l) => (l.kind === "design" ? [this.doc.layerRec(l.id)] : [])));
    for (const r of this.doc.recs) {
      if (r.type !== PLUGIN || !r.parent || !layers.has(r.parent)) continue;
      const name = this.doc.pluginName(r);
      if (!name || NOT_INSERTED.has(name)) continue;
      const known = kinds.get(name);
      if (known) {
        known.count++;
        continue;
      }
      if (!copyable(r) || r.data.length < PLUGIN_MATRIX + 96) continue;
      const m = readPluginMatrix(r.data);
      let box: BBox | null = null;
      for (const c of objectChildren(r)) box = unionBox(box, readBBox(c.data));
      if (!box) continue;
      const corners = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
      const outline = corners.map((q) => ({ x: m.a * q.x + m.c * q.y, y: m.b * q.x + m.d * q.y }));
      kinds.set(name, { id: guidOf(r), name, count: 1, angle: (Math.atan2(m.b, m.a) * 180) / Math.PI, outline });
    }
    return [...kinds.values()].sort((x, y) => x.name.localeCompare(y.name));
  }

  insertPlugin(source: string, layerId: string, at: Pt, angle?: number): string {
    const src = this.object(source);
    if (src.type !== PLUGIN || !copyable(src) || src.data.length < PLUGIN_MATRIX + 96) throw new Error("that object can't be copied as a plug-in object");
    if (![at.x, at.y, angle ?? 0].every(Number.isFinite)) throw new Error("a plug-in object's place and turn are finite numbers");
    const m0 = readPluginMatrix(src.data);
    const turn = angle === undefined ? 0 : ((angle - (Math.atan2(m0.b, m0.a) * 180) / Math.PI) * Math.PI) / 180;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    // turned about its insertion point, then set down at `at`
    const m: Affine = { a: cos, b: sin, c: -sin, d: cos, e: at.x - (cos * m0.e - sin * m0.f), f: at.y - (sin * m0.e + cos * m0.f) };
    const layer = this.container(layerId);
    return this.batch(() => {
      const { owner, at: slot } = this.slot(layer);
      const copies = this.instantiate(templateOf(src), owner);
      // object names are unique: copies are unnamed
      const objects = new Set(objectWalk(src));
      [...src.walk()].forEach((o, i) => {
        if (objects.has(o)) setU16(copies[i], 0x1a, 0);
      });
      const p = this.plan();
      p.insert(slot, copies);
      this.refitGroups(p, [], new Map([[layer, [copies[0]]]]));
      const id = recOfData(copies[0]).guid;
      this.commit(p, "objects", [id]);
      const q = this.plan();
      const placed = this.object(id);
      this.transformTrees(q, [placed], m);
      // as high above this layer as the source is above its own
      this.lift(q, placed, layerElevationOf(layer) - layerElevationOf(src));
      this.commit(q, "objects", [id]);
      return id;
    });
  }

  addPluginObject(layerId: string, name: string, fields: readonly PluginFieldSpec[], values: Readonly<Record<string, RecordValue>>, at: Pt, angle: number, classIndex?: number): string {
    if (![at.x, at.y, angle].every(Number.isFinite)) throw new Error("a plug-in object's place and turn are finite numbers");
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    return this.batch(() => {
      const format = this.pluginFormat(name, fields);
      const fmt = this.doc.formatDef(format)!;
      const defaults = this.doc.recs.find((r) => r.type === RECORD_FORMAT && r.nameIndex === format)?.children.find((c) => c.type === RECORD);
      const was = defaults ? readValues(defaults.data, fmt) : null;
      if (!defaults || !was) throw new Error(`the plug-in format "${name}" has no default values Rodeo can read`);
      const { owner, at: slot } = this.slot(layer);
      const [d, term] = this.instantiate(pluginTemplate(), owner);
      setU32(d, 0x20, cls);
      const t = (angle * Math.PI) / 180;
      const z = layerElevationOf(layer);
      [Math.cos(t), Math.sin(t), 0, -Math.sin(t), Math.cos(t), 0, 0, 0, 1, at.x, at.y, z].forEach((v, i) => setF64(d, PLUGIN_MATRIX + 8 * i, v));
      const p = this.plan();
      p.insert(slot, [d, term]);
      const id = recOfData(d).guid;
      this.commit(p, "objects", [id]);
      // its parameters: the format's defaults, with the values given
      const q = this.plan();
      const body = encodeRecord(defaults.data, fmt, fmt.fields.map((f, i) => (Object.hasOwn(values, f.name) ? values[f.name] : was[i].value))).subarray(0x50);
      this.addAux(q, this.object(id), this.newAux(RECORD, body));
      this.commit(q, "objects", [id]);
      return id;
    });
  }

  /** The plug-in format named `name`, made from `fields` in the class list when the drawing has none; one of Rodeo's own made before some of `fields` existed gains them. */
  private pluginFormat(name: string, fields: readonly PluginFieldSpec[]): number {
    for (const [index, n] of this.doc.names)
      if (n === name && this.doc.formatDef(index)?.parametric) {
        this.growPluginFormat(index, name, fields);
        return index;
      }
    this.checkName(name);
    // first in the class list, so its end stays as it is
    const first = this.doc.classList?.children[0];
    if (!first) throw new Error("this drawing has no class list to keep a plug-in format in");
    const [f, r] = this.instantiate(recordFormatTemplate(), first.owner);
    const fresh = this.freshName();
    const data = encodePluginFormat(f, fields);
    setU16(data, 0x1a, fresh);
    const defaults = encodeRecord(r, readFormat(data), fields.map((x) => x.value));
    setU16(defaults, 0x50, fresh);
    const names = new Map(this.doc.names);
    names.set(fresh, name);
    const p = this.plan();
    this.writeNames(p, names);
    p.insert(first.index, [data, defaults]);
    this.commit(p, "all", []);
    return fresh;
  }

  /** Gives the drawing's plug-in format `name`, one of Rodeo's own, the fields of `fields` it lacks, as a new object of it would; nothing when the drawing hasn't the format. */
  growPluginFields(name: string, fields: readonly PluginFieldSpec[]): void {
    for (const [index, n] of this.doc.names) if (n === name && this.doc.formatDef(index)?.parametric) return this.batch(() => this.growPluginFormat(index, name, fields));
  }

  /**
   * Adds the fields of `fields` that a plug-in format of Rodeo's own (its name starting "Rodeo ") lacks
   * after the ones it has, so a drawing made by an older Rodeo takes a plug-in's new parameters: its
   * objects keep their values and take the new fields' given values. Another's format, or one with a
   * field or record Rodeo can't read, is left as it is.
   */
  private growPluginFormat(format: number, name: string, fields: readonly PluginFieldSpec[]): void {
    if (!name.startsWith("Rodeo ")) return;
    const rec = this.doc.recs.find((r) => r.type === RECORD_FORMAT && r.nameIndex === format);
    const old = this.doc.formatDef(format);
    if (!rec || !old || old.fields.some((f) => !f.kind)) return;
    const missing = fields.filter((f) => !old.fields.some((g) => g.name === f.name));
    if (!missing.length) return;
    const defaults = rec.children.find((c) => c.type === RECORD);
    const was = defaults ? readValues(defaults.data, old) : null;
    if (!defaults || !was) return;
    const records = this.doc.recs.filter((r) => r.type === RECORD && recordFormat(r.data) === format);
    const kept = records.map((r) => readValues(r.data, old));
    if (kept.some((v) => !v)) return;
    const specs: PluginFieldSpec[] = [...old.fields.map((f, i) => ({ name: f.name, type: f.type, value: was[i].value })), ...missing];
    const data = encodePluginFormat(rec.data, specs);
    const fmt = readFormat(data);
    const from = specs.map((_, i) => (i < old.fields.length ? i : -1));
    const p = this.plan();
    p.set(rec.index, data);
    records.forEach((r, k) => p.set(r.index, encodeRecord(r.data, fmt, [...kept[k]!.map((v) => v.value), ...missing.map((f) => f.value)], old, from)));
    this.commit(p, "all", []);
  }

  pluginAngle(id: string): number {
    const r = this.object(id);
    if (r.type !== PLUGIN) throw new Error(`${r.typeName} is not a plug-in object`);
    const m = readPluginMatrix(r.data);
    return (Math.atan2(m.b, m.a) * 180) / Math.PI;
  }

  /** Puts `ids` in as the plug-in's drawing, keeping the first `keep` objects of the one it has. */
  setPluginDrawing(id: string, ids: readonly string[], keep = 0): void {
    const r = this.object(id);
    if (r.type !== PLUGIN) throw new Error(`${r.typeName} is not a plug-in object`);
    const term = r.children.at(-1);
    if (!term || term.type !== 0) throw new Error("this plug-in object has no list to hold a drawing");
    const recs = this.topmost([...ids]).sort((a, b) => a.index - b.index);
    for (const o of recs) {
      if (o === r || o.parent?.type !== 31) throw new Error("a plug-in's drawing is made of objects at the top level of a layer");
      for (const x of movedWalk(o)) if (!SYMBOL_PARTS.has(x.type)) throw new Error(`${typeLabel(x.type)} objects can't go into a plug-in object yet`);
    }
    const m = readPluginMatrix(r.data);
    const p = this.plan();
    const placed = (b: BBox): BBox | null => bboxOfPoints([{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }].map((q) => applyAffine(m, q)));
    let box: BBox | null = null;
    // its old drawing: the objects in its list, after its aux records, but for the path and profile
    // groups Vectorworks draws it from, which stay
    let kept = 0;
    for (const c of r.children.slice(auxCount(r))) {
      if (c.type === 0) continue;
      if (isPathGroup(c) || isProfileGroup(c)) continue;
      if (kept++ >= keep) {
        p.remove(c.index, subtreeEnd(c));
        continue;
      }
      const b = readBBox(c.data);
      if (b) box = unionBox(box, placed(b));
    }
    const moved: Uint8Array[] = [];
    for (const o of recs) {
      const end = subtreeEnd(o);
      const root = p.cur(o.index).slice();
      setOwner(root, term.owner);
      setNext(root, true);
      moved.push(root);
      for (let i = o.index + 1; i <= end; i++) moved.push(p.cur(i));
      p.remove(o.index, end);
      const b = readBBox(root);
      if (b) box = unionBox(box, placed(b));
    }
    p.insert(term.index, moved);
    const d = p.cur(r.index).slice();
    if (box) writeBBox(d, box);
    else [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE].forEach((v, i) => setF64(d, 0x68 + 8 * i, v));
    p.set(r.index, d);
    this.refitGroups(p, [r]);
    this.commit(p, "objects", [id, ...recs.map((o) => o.guid)]);
  }

  slabTemplates(): SlabTemplate[] {
    if (this.slabKinds?.recs !== this.doc.recs) this.slabKinds = { recs: this.doc.recs, list: this.findSlabTemplates() };
    return this.slabKinds.list;
  }

  private findSlabTemplates(): SlabTemplate[] {
    const kinds = new Map<string, SlabTemplate>();
    const layers = new Set(this.doc.layers().flatMap((l) => (l.kind === "design" ? [this.doc.layerRec(l.id)] : [])));
    for (const r of this.doc.recs) {
      if (r.type !== PLUGIN || !r.parent || !layers.has(r.parent) || !stretchableSlab(this.doc, r)) continue;
      const id = guidOf(r);
      const field = this.doc.records(id).find((x) => x.parametric)?.fields.find((f) => f.name === "Style");
      const style = typeof field?.value === "number" ? (this.doc.names.get(field.value) ?? null) : null;
      let lo = Infinity;
      let hi = -Infinity;
      for (const { triangles: t } of objectTriangles(this.doc, r)) {
        for (let i = 2; i < t.length; i += 3) {
          lo = Math.min(lo, t[i]);
          hi = Math.max(hi, t[i]);
        }
      }
      if (!(hi > lo)) continue;
      const key = `${style}|${(hi - lo).toFixed(2)}`;
      if (!kinds.has(key)) kinds.set(key, { id, style, thickness: hi - lo });
    }
    return [...kinds.values()].sort((x, y) => (x.style ?? "\uffff").localeCompare(y.style ?? "\uffff") || x.thickness - y.thickness);
  }

  addSlab(layerId: string, a: Pt, b: Pt, template: string, classIndex?: number): string {
    const src = this.object(template);
    const rect = src.type === PLUGIN ? stretchableSlab(this.doc, src) : null;
    if (!rect) throw new Error("a new slab copies a slab plug-in with a rectangular outline and nothing else set in it");
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) throw new Error("a slab's corners are finite numbers");
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const y1 = Math.max(a.y, b.y);
    if (!(x1 - x0 > 1 && y1 - y0 > 1)) throw new Error("a slab's rectangle has no area");
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    // the template's rectangle in plan: its corner and sides
    const m0 = readPluginMatrix(src.data);
    const w0 = Math.hypot(rect.u.x, rect.u.y);
    const h0 = Math.hypot(rect.v.x, rect.v.y);
    const lin = (q: Pt): Pt => ({ x: m0.a * q.x + m0.c * q.y, y: m0.b * q.x + m0.d * q.y });
    const c = applyAffine(m0, rect.corner);
    const u0 = lin({ x: rect.u.x / w0, y: rect.u.y / w0 });
    const v0 = lin({ x: rect.v.x / h0, y: rect.v.y / h0 });
    // the new sides: the axis nearest the template's first side, and the one square to it on the same hand
    const hand = Math.sign(u0.x * v0.y - u0.y * v0.x) || 1;
    const U = Math.abs(u0.x) >= Math.abs(u0.y) ? { x: Math.sign(u0.x) || 1, y: 0 } : { x: 0, y: Math.sign(u0.y) };
    const V = { x: -U.y * hand, y: U.x * hand };
    const C = { x: U.x + V.x > 0 ? x0 : x1, y: U.y + V.y > 0 ? y0 : y1 };
    const width = Math.abs(U.x) * (x1 - x0) + Math.abs(U.y) * (y1 - y0);
    const height = Math.abs(V.x) * (x1 - x0) + Math.abs(V.y) * (y1 - y0);
    // R turns and moves the whole onto the rectangle; K stretches its parts in its own frame, along
    // its outline's sides about its corner
    const ra = U.x * u0.x + V.x * v0.x;
    const rb = U.y * u0.x + V.y * v0.x;
    const rc = U.x * u0.y + V.x * v0.y;
    const rd = U.y * u0.y + V.y * v0.y;
    const turn: Affine = { a: ra, b: rb, c: rc, d: rd, e: C.x - (ra * c.x + rc * c.y), f: C.y - (rb * c.x + rd * c.y) };
    const ou = { x: rect.u.x / w0, y: rect.u.y / w0 };
    const ov = { x: rect.v.x / h0, y: rect.v.y / h0 };
    const sx = width / w0;
    const sy = height / h0;
    const ka = sx * ou.x * ou.x + sy * ov.x * ov.x;
    const kb = sx * ou.y * ou.x + sy * ov.y * ov.x;
    const kc = sx * ou.x * ou.y + sy * ov.x * ov.y;
    const kd = sx * ou.y * ou.y + sy * ov.y * ov.y;
    const o = rect.corner;
    const stretch: Affine = { a: ka, b: kb, c: kc, d: kd, e: o.x - (ka * o.x + kc * o.y), f: o.y - (kb * o.x + kd * o.y) };
    return this.batch(() => {
      const { owner, at } = this.slot(layer);
      const copies = this.instantiate(templateOf(src), owner);
      // object names are unique: copies are unnamed
      const objects = new Set(objectWalk(src));
      [...src.walk()].forEach((r, i) => {
        if (objects.has(r)) setU16(copies[i], 0x1a, 0);
      });
      setU32(copies[0], 0x20, cls);
      const p = this.plan();
      p.insert(at, copies);
      this.refitGroups(p, [], new Map([[layer, [copies[0]]]]));
      const id = recOfData(copies[0]).guid;
      this.commit(p, "objects", [id]);
      const q = this.plan();
      const slab = this.object(id);
      this.transformTrees(q, objectChildren(slab), stretch, true);
      const placed = transformRecord(q.cur(slab.index), PLUGIN, turn);
      if (!placed) throw new Error("this slab's record is too short to place");
      // its box is its parts' as its matrix now places them
      const m = readPluginMatrix(placed);
      let box: BBox | null = null;
      for (const part of objectChildren(slab)) {
        const pb = readBBox(q.cur(part.index));
        if (pb) box = unionBox(box, bboxOfPoints([{ x: pb.x0, y: pb.y0 }, { x: pb.x1, y: pb.y0 }, { x: pb.x0, y: pb.y1 }, { x: pb.x1, y: pb.y1 }].map((pt) => applyAffine(m, pt))));
      }
      if (box) writeBBox(placed, box);
      q.set(slab.index, placed);
      // as high above this layer as the template is above its own
      this.lift(q, slab, layerElevationOf(layer) - layerElevationOf(src));
      this.commit(q, "objects", [id]);
      return id;
    });
  }

  dimensionTemplate(): string | null {
    if (this.dimKind?.recs !== this.doc.recs) this.dimKind = { recs: this.doc.recs, id: this.findDimensionTemplate() };
    return this.dimKind.id;
  }

  private findDimensionTemplate(): string | null {
    const layers = new Set(this.doc.layers().flatMap((l) => (l.kind === "design" ? [this.doc.layerRec(l.id)] : [])));
    // the first of the text size most share, on design layers if any are there (else in annotations
    // and plug-ins): the drawing's usual dimension standard
    const bySize = new Map<string, { id: string; count: number; onDesign: boolean }>();
    for (const r of this.doc.recs) {
      if (r.type !== DIMENSION) continue;
      const dim = linearDimension(r);
      const id = dim ? guidOf(r) : "";
      if (!dim || this.doc.rec(id) !== r) continue;
      const onDesign = !!r.parent && layers.has(r.parent);
      const key = `${onDesign} ${readTextFrame(dim.text.data, readText(dim.text.data)).size.toFixed(3)}`;
      const known = bySize.get(key);
      if (known) known.count++;
      else bySize.set(key, { id, count: 1, onDesign });
    }
    let best: { id: string; count: number; onDesign: boolean } | null = null;
    for (const k of bySize.values()) {
      if (!best || (k.onDesign !== best.onDesign ? k.onDesign : k.count > best.count)) best = k;
    }
    return best?.id ?? null;
  }

  addDimension(layerId: string, a: Pt, b: Pt, at: Pt, u: Pt, value: string, template: string, classIndex?: number): string {
    const src = this.object(template);
    const dim = linearDimension(src);
    if (!dim) throw new Error("a new dimension copies a linear dimension drawn only with its lines and value");
    if (![a.x, a.y, b.x, b.y, at.x, at.y, u.x, u.y].every(Number.isFinite)) throw new Error("a dimension's points are finite numbers");
    const len = Math.hypot(u.x, u.y);
    if (!(len > 0)) throw new Error("a dimension's direction has no length");
    const dir = { x: u.x / len, y: u.y / len };
    // the second point lies further along the line than the first, as Vectorworks keeps them
    if ((b.x - a.x) * dir.x + (b.y - a.y) * dir.y < 0) [a, b] = [b, a];
    if (!((b.x - a.x) * dir.x + (b.y - a.y) * dir.y > DIM_TOLERANCE)) throw new Error("a dimension measures some length");
    const offset = (at.x - a.x) * -dir.y + (at.y - a.y) * dir.x;
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    return this.batch(() => {
      const { owner, at: slot } = this.slot(layer);
      const copies = this.instantiate(templateOf(src), owner);
      // object names are unique: copies are unnamed
      const objects = new Set(objectWalk(src));
      [...src.walk()].forEach((r, i) => {
        if (objects.has(r)) setU16(copies[i], 0x1a, 0);
      });
      setU32(copies[0], 0x20, cls);
      const p = this.plan();
      p.insert(slot, copies);
      this.refitGroups(p, [], new Map([[layer, [copies[0]]]]));
      const id = recOfData(copies[0]).guid;
      this.commit(p, "objects", [id]);
      const q = this.plan();
      this.layDimension(q, this.object(id), { a, b, u: dir, offset }, value, dim);
      this.commit(q, "objects", [id]);
      return id;
    });
  }

  linearDimension(id: string): LinearDimensionInfo | null {
    const r = this.doc.rec(id);
    const dim = r ? linearDimension(r) : null;
    if (!dim) return null;
    const length = (dim.b.x - dim.a.x) * dim.u.x + (dim.b.y - dim.a.y) * dim.u.y;
    return { a: dim.a, b: dim.b, u: dim.u, offset: dim.offset, length, value: readText(dim.text.data) };
  }

  setLinearDimension(id: string, change: Partial<Pick<LinearDimensionInfo, "a" | "b" | "u" | "offset" | "value">>): void {
    const r = this.object(id);
    const dim = linearDimension(r);
    if (!dim) throw new Error("only a linear dimension drawn with its lines and value can be changed");
    let a = change.a ?? dim.a;
    let b = change.b ?? dim.b;
    const u = change.u ?? dim.u;
    if (![a.x, a.y, b.x, b.y, u.x, u.y, change.offset ?? 0].every(Number.isFinite)) throw new Error("a dimension's points are finite numbers");
    const len = Math.hypot(u.x, u.y);
    if (!(len > 0)) throw new Error("a dimension's direction has no length");
    const dir = { x: u.x / len, y: u.y / len };
    const value = change.value ?? readText(dim.text.data);
    if (!value.trim()) throw new Error("a dimension shows a value");
    // a point on the dimension line: as far from the first point as asked, else as far as it was when
    // it turns, else where the line was
    const off = change.offset ?? (change.u ? dim.offset : null);
    const at =
      off !== null
        ? { x: a.x - dir.y * off, y: a.y + dir.x * off }
        : { x: dim.a.x - dim.u.y * dim.offset, y: dim.a.y + dim.u.x * dim.offset };
    if ((b.x - a.x) * dir.x + (b.y - a.y) * dir.y < 0) [a, b] = [b, a];
    if (!((b.x - a.x) * dir.x + (b.y - a.y) * dir.y > DIM_TOLERANCE)) throw new Error("a dimension measures some length");
    const offset = (at.x - a.x) * -dir.y + (at.y - a.y) * dir.x;
    const p = this.plan();
    this.layDimension(p, r, { a, b, u: dir, offset }, value, dim);
    this.refitGroups(p, [r]);
    this.commit(p, "objects", [id]);
  }

  /**
   * Draws linear dimension `r` (one copied from a linear dimension) for its new fields: its lines
   * spaced as `style`'s are, its value the size `style`'s is with its middle where `style`'s is from
   * the middle of its dimension line (in the frame the value reads in), then its fields and its box.
   */
  private layDimension(q: Plan, r: Rec, at: { a: Pt; b: Pt; u: Pt; offset: number }, value: string, style: LinearDimension): void {
    const { a, b, u, offset } = at;
    const lines = dimensionLines(a, b, u, offset, style.gap, style.over, style.ext);
    const mid = ([p, e]: [Pt, Pt]): Pt => ({ x: (p.x + e.x) / 2, y: (p.y + e.y) / 2 });
    const textMid = (d: Uint8Array): Pt => {
      const c = textCorners(readTextFrame(d, readText(d)));
      return mid([c[0], c[2]]);
    };
    const f0 = readTextFrame(style.text.data, readText(style.text.data));
    const c0 = textMid(style.text.data);
    const m0 = mid(dimensionLines(style.a, style.b, style.u, style.offset, style.gap, style.over, style.ext)[4]);
    const along = (c0.x - m0.x) * f0.u.x + (c0.y - m0.y) * f0.u.y;
    const across = (c0.x - m0.x) * -f0.u.y + (c0.y - m0.y) * f0.u.x;
    const angle = readableAngle(u);
    const rad = (angle * Math.PI) / 180;
    const m1 = mid(lines[4]);
    const centre = { x: m1.x + Math.cos(rad) * along - Math.sin(rad) * across, y: m1.y + Math.sin(rad) * along + Math.cos(rad) * across };
    const kids = objectChildren(r);
    lines.forEach(([s, e], i) => q.set(kids[i].index, writeGeometry(q.cur(kids[i].index), { kind: "line", a: s, b: e })));
    const text = objectChildren(kids[5])[0];
    const cur = q.cur(text.index);
    const shown = readText(cur);
    const f1 = readTextFrame(cur, shown);
    if (shown === value && f1.size === f0.size) {
      // the same value keeps its own characters' widths: turned and moved so its middle is on `centre`
      const c1 = textMid(cur);
      const t = rad - Math.atan2(f1.u.y, f1.u.x);
      const [cos, sin] = [Math.cos(t), Math.sin(t)];
      const m = { a: cos, b: sin, c: -sin, d: cos, e: centre.x - (cos * c1.x - sin * c1.y), f: centre.y - (sin * c1.x + cos * c1.y) };
      q.set(text.index, transformRecord(cur, 10, m) ?? cur);
    } else {
      // laid out once to learn the value's size, then set down so its middle is on `centre`
      const laid = writeGeometry(cur, { kind: "text", at: { x: 0, y: 0 }, text: value, height: f0.size, angle });
      const c1 = textMid(laid);
      q.set(text.index, writeGeometry(laid, { kind: "text", at: { x: centre.x - c1.x, y: centre.y - c1.y }, text: value, height: f0.size, angle }));
    }
    this.refitGroups(q, [text]);
    const d = q.cur(r.index).slice();
    setF64(d, DIM_A, a.y);
    setF64(d, DIM_A + 8, a.x);
    setF64(d, DIM_B, b.y);
    setF64(d, DIM_B + 8, b.x);
    setF64(d, DIM_OFFSET, offset);
    setF64(d, DIM_DIR, u.y);
    setF64(d, DIM_DIR + 8, u.x);
    // its box holds its drawing and the points it measures
    let box: BBox | null = bboxOfPoints([a, b]);
    for (const k of kids) box = unionBox(box, readBBox(q.cur(k.index)));
    if (box) writeBBox(d, box);
    q.set(r.index, d);
  }

  wallJoinAt(layerId: string, at: Pt, reach: number): WallJoin | null {
    if (![at.x, at.y, reach].every(Number.isFinite)) return null;
    const found: { join: WallJoin; gap: number }[] = [];
    const consider = (join: WallJoin, gap: number): void => void found.push({ join, gap });
    for (const r of objectChildren(this.container(layerId))) {
      const plan = r.type === WALL ? wallPlan(r) : null;
      if (!plan) continue;
      const id = guidOf(r);
      const along = (at.x - plan.start.x) * plan.u.x + (at.y - plan.start.y) * plan.u.y;
      const across = (at.y - plan.start.y) * plan.u.x - (at.x - plan.start.x) * plan.u.y;
      // how far outside its faces the point lies (0 between them)
      const out = Math.max(plan.lo - across, across - plan.hi, 0);
      const width = plan.hi - plan.lo;
      let corner = false;
      for (const [end, inward] of [["start", along], ["end", plan.length - along]] as const) {
        const gap = pointGap(at, plan[end]);
        if (gap <= reach || (out === 0 && inward >= -reach && inward <= width)) {
          consider({ id, kind: "corner", at: plan[end] }, gap);
          corner = true;
        }
      }
      if (!corner && along > 0 && along < plan.length && out <= reach) {
        // a point just outside its faces moves onto the nearer one
        const shift = Math.min(Math.max(across, plan.lo), plan.hi) - across;
        consider({ id, kind: "tee", at: { x: at.x - plan.u.y * shift, y: at.y + plan.u.x * shift } }, out);
      }
    }
    // the nearest: a corner by the gap to the wall's end, a tee by how far outside the wall's faces
    return found.reduce<{ join: WallJoin; gap: number } | null>((b, f) => (!b || f.gap < b.gap ? f : b), null)?.join ?? null;
  }

  addWall(layerId: string, start: Pt, end: Pt, template: string, classIndex?: number, joins: { before?: string; after?: string } = {}): string {
    const plain = plainWallSize(template);
    const tpl = plain ? null : this.object(template);
    if (tpl && (tpl.type !== WALL || !stretchableWall(this.doc, tpl))) throw new Error("a new wall copies a straight wall with square ends and nothing set in it");
    if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new Error("a wall's ends are finite numbers");
    if (!(Math.hypot(end.x - start.x, end.y - start.y) > 1)) throw new Error("a wall's ends are the same point");
    const shell = plain ? this.plainWallShell(plain.thickness, plain.height) : templateOf(tpl!);
    const w = readWall(shell.recs[0])!;
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    // a wall joined at a point: at its end there (a corner), or along its side (a tee)
    const meets = (id: string | undefined, at: Pt): { wall: Rec; end: "start" | "end" | null } | null => {
      if (!id) return null;
      const r = this.object(id);
      const plan = r.type === WALL ? wallPlan(r) : null;
      if (!plan) throw new Error("only a straight wall can be joined");
      for (const e of ["start", "end"] as const) if (pointGap(plan[e], at) <= 1e-6) return { wall: r, end: e };
      const along = (at.x - plan.start.x) * plan.u.x + (at.y - plan.start.y) * plan.u.y;
      const across = (at.y - plan.start.y) * plan.u.x - (at.x - plan.start.x) * plan.u.y;
      const width = plan.hi - plan.lo;
      if (!(along > 0 && along < plan.length && across >= plan.lo - width && across <= plan.hi + width)) throw new Error("that wall doesn't meet the new one there");
      return { wall: r, end: null };
    };
    const before = meets(joins.before, start);
    const after = meets(joins.after, end);
    // a tee runs the new wall only to the face of the wall it meets nearer its other end, cut along that face
    const dir = unitVec(start, end);
    const length = pointGap(start, end);
    const tee = (other: Rec, atEnd: boolean): { t: number; k: number } => {
      const plan = wallPlan(other)!;
      const nf = { x: -plan.u.y, y: plan.u.x };
      const a0 = (start.x - plan.start.x) * nf.x + (start.y - plan.start.y) * nf.y;
      const a1 = dir.x * nf.x + dir.y * nf.y;
      if (Math.abs(a1) < MIN_TEE_SINE) throw new Error("a wall meeting another's side runs into it at 15° or more");
      const faces = [(plan.lo - a0) / a1, (plan.hi - a0) / a1];
      const t = atEnd ? Math.min(...faces) : Math.max(...faces);
      if (!(atEnd ? t > 1 : t < length - 1)) throw new Error("a wall meeting another's side starts outside it");
      // a point across the new wall's line moves along it so it lies on the face
      return { t, k: -(-dir.y * nf.x + dir.x * nf.y) / a1 };
    };
    const head = before && !before.end ? tee(before.wall, false) : null;
    const tail = after && !after.end ? tee(after.wall, true) : null;
    const from = head ? { x: start.x + dir.x * head.t, y: start.y + dir.y * head.t } : start;
    const to = tail ? { x: start.x + dir.x * tail.t, y: start.y + dir.y * tail.t } : end;
    if (!(pointGap(from, to) > 1)) throw new Error("a wall between two others' faces has no length");
    return this.batch(() => {
      const { owner, at } = this.slot(layer);
      const copies = this.instantiate(shell, owner);
      const d = copies[0];
      setU16(d, 0x1a, 0);
      setU32(d, 0x20, cls);
      if (plain) classPlainWall(copies, cls);
      const p = this.plan();
      p.insert(at, copies);
      this.refitGroups(p, [], new Map([[layer, [d]]]));
      const id = recOfData(d).guid;
      this.commit(p, "objects", [id]);
      // then laid from the template's line onto the new one: stretched along it, as it is across it
      const q = this.plan();
      const wall = this.object(id);
      this.transformTrees(q, [wall], stretchOnto(w.start, w.end, from, to), true);
      // as high above this layer as the template is above its own
      this.lift(q, wall, layerElevationOf(layer) - (tpl ? layerElevationOf(tpl) : 0));
      if (before?.end) this.joinWalls(q, before.wall, before.end, wall, "start");
      if (after?.end) this.joinWalls(q, wall, "end", after.wall, after.end);
      if (head) this.cutWallEnd(q, wall, "start", head.k);
      if (tail) this.cutWallEnd(q, wall, "end", tail.k);
      this.commit(q, "objects", [id, ...[before, after].flatMap((j) => (j?.end ? [guidOf(j.wall)] : []))]);
      return id;
    });
  }

  addPlainWalls(layerId: string, walls: readonly PlainWallSpec[]): string[] {
    const layer = this.container(layerId);
    const none = this.noneClass();
    const lift = layerElevationOf(layer);
    const polygon = builtinTemplates().get(5)!.recs[0];
    const { owner, at } = this.slot(layer);
    const block: Uint8Array[] = [];
    const made: Uint8Array[] = [];
    const ids = walls.map((w) => {
      const cls = w.classIndex ?? none;
      if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
      const length = pointGap(w.start, w.end);
      const height = w.top - w.bottom;
      const half = w.thickness / 2;
      if (![w.start.x, w.start.y, w.end.x, w.end.y, w.bottom, w.top, w.thickness].every(Number.isFinite) || !(length > 1 && height > 0 && half > 0)) return "";
      const profile = wallProfile(length, height, w.openings ?? []);
      if (!profile) return "";
      const u = { x: (w.end.x - w.start.x) / length, y: (w.end.y - w.start.y) / length };
      // along its line from its start, across it (left positive): where that is in plan
      const place = (along: number, across: number): Pt => ({ x: w.start.x + u.x * along - u.y * across, y: w.start.y + u.y * along + u.x * across });
      const foot = w.bottom + lift;
      const plans = profile.plan.map(([a0, a1]) => {
        const plan = writeGeometry(polygon, { kind: "polygon", points: [place(a0, -half), place(a1, -half), place(a1, half), place(a0, half)], closed: true });
        writeAttrs(plan, { fillPattern: 1, fillFore: 256, fillBack: 256 });
        return plan;
      });
      // each ring of its elevation on both faces, and an edge through it at each corner
      const corner = (p: Pt, across: number): [number, number, number] => {
        const q = place(p.x, across);
        return [q.x, q.y, foot + p.y];
      };
      const edges: [[number, number, number], [number, number, number]][] = [];
      for (const ring of profile.rings)
        ring.forEach((p, i) => {
          const q = ring[(i + 1) % ring.length];
          edges.push([corner(p, -half), corner(q, -half)], [corner(p, half), corner(q, half)], [corner(p, -half), corner(p, half)]);
        });
      const ends = [place(0, -half), place(length, -half), place(length, half), place(0, half)];
      const plan = { x0: Math.min(...ends.map((e) => e.x)), y0: Math.min(...ends.map((e) => e.y)), x1: Math.max(...ends.map((e) => e.x)), y1: Math.max(...ends.map((e) => e.y)) };
      const recs = this.instantiate(plainWall(w.start, w.end, w.thickness, foot, w.top + lift, plans, edges, [plan.x0, plan.y0, foot, plan.x1, plan.y1, foot + height]), owner);
      const d = recs[0];
      setU32(d, 0x20, cls);
      classPlainWall(recs, cls);
      writeBBox(d, plan);
      for (const r of recs) block.push(r);
      made.push(d);
      return recOfData(d).guid;
    });
    if (!made.length) return ids;
    const p = this.plan();
    p.insert(at, block);
    this.refitGroups(p, [], new Map([[layer, made]]));
    this.commit(
      p,
      "objects",
      ids.filter((id) => id),
    );
    return ids;
  }

  /** A plain wall to place, its plan drawing written here since a polygon's geometry is the session's to encode. */
  private plainWallShell(thickness: number, height: number): Template {
    const half = thickness / 2;
    const plan = writeGeometry(builtinTemplates().get(5)!.recs[0], {
      kind: "polygon",
      points: [
        { x: 0, y: -half },
        { x: WALL_SHELL_LENGTH, y: -half },
        { x: WALL_SHELL_LENGTH, y: half },
        { x: 0, y: half },
      ],
      closed: true,
    });
    writeAttrs(plan, { fillPattern: 1, fillFore: 256, fillBack: 256 });
    return wallShell(thickness, height, plan);
  }

  objectsFromShapes(ids: readonly string[], kind: "wall" | "slab", template: string, classIndex?: number, removeShapes = false): string[] {
    if (!ids.length) throw new Error("select the shapes to make objects from");
    const shapes = ids.map((id) => {
      const o = this.doc.object(id);
      const r = this.object(id);
      const s = o?.shape;
      if (!o || !s || r.type === ROUNDED_RECT || !["line", "rect", "polygon", "polyline"].includes(s.kind)) {
        throw new Error("objects are made from lines, rectangles, polygons and polylines");
      }
      if (s.kind === "polyline" && s.vertices?.some((v) => v.kind !== "corner")) throw new Error("a polyline with curves can't be made into straight walls or a slab");
      const pts = s.kind === "polyline" && s.vertices ? s.vertices.map((v) => v.p) : s.points;
      // corners closer than a wall's shortest length merge into the one before
      const corners: Pt[] = [];
      for (const q of pts) if (!corners.length || pointGap(corners[corners.length - 1], q) > 1) corners.push(q);
      const closed = s.closed && corners.length >= 3;
      if (closed && pointGap(corners[0], corners[corners.length - 1]) <= 1) corners.pop();
      if (corners.length < 2) throw new Error("a shape with no length makes no objects");
      return { layerId: o.layerId, corners, closed: closed && corners.length >= 3 };
    });
    return this.batch(() => {
      const made: string[] = [];
      for (const { layerId, corners, closed } of shapes) {
        if (kind === "slab") {
          const box = bboxOfPoints(corners)!;
          const near = (v: number, a: number, b: number): boolean => Math.abs(v - a) <= 1e-6 * (1 + Math.abs(a)) || Math.abs(v - b) <= 1e-6 * (1 + Math.abs(b));
          const square = closed && corners.length === 4 && corners.every((q) => near(q.x, box.x0, box.x1) && near(q.y, box.y0, box.y1));
          if (!square) throw new Error("a slab is made from a rectangle square to x and y");
          made.push(this.addSlab(layerId, { x: box.x0, y: box.y0 }, { x: box.x1, y: box.y1 }, template, classIndex));
          continue;
        }
        // one wall per side, each joined to the one before; a closed shape's last to its first too
        const walls: string[] = [];
        const sides = closed ? corners.length : corners.length - 1;
        for (let i = 0; i < sides; i++) {
          const joins = { before: walls[walls.length - 1], after: closed && i === sides - 1 ? walls[0] : undefined };
          walls.push(this.addWall(layerId, corners[i], corners[(i + 1) % corners.length], template, classIndex, joins));
        }
        made.push(...walls);
      }
      if (removeShapes) this.deleteObjects([...ids]);
      return made;
    });
  }

  /**
   * Mitres the corner where wall `a` comes in at its end `endA` and wall `b` goes out from its end
   * `endB`, each cut along the bisector of the turn: a point at that end moves along its wall by its
   * distance across the line times tan(turn / 2), shortening the inside of the corner and
   * lengthening the outside (walking a wall the other way turns both its along and its across, so
   * the factor doesn't depend on which of its ends meets the corner). The corner is left square when
   * it turns more than MAX_MITRE_TURN, when either end isn't square (joined already), or when the
   * cut would reach past a wall's middle.
   */
  private joinWalls(p: Plan, a: Rec, endA: "start" | "end", b: Rec, endB: "start" | "end"): void {
    const la = readWall(p.cur(a.index));
    const lb = readWall(p.cur(b.index));
    if (!la || !lb) return;
    const ua = endA === "end" ? unitVec(la.start, la.end) : unitVec(la.end, la.start);
    const ub = endB === "start" ? unitVec(lb.start, lb.end) : unitVec(lb.end, lb.start);
    const turn = Math.atan2(ua.x * ub.y - ua.y * ub.x, ua.x * ub.x + ua.y * ub.y);
    if (Math.abs(turn) > MAX_MITRE_TURN) return;
    const tau = Math.tan(turn / 2);
    if (Math.abs(tau) < 1e-12) return;
    const ends = [this.wallEnd(p, a, endA), this.wallEnd(p, b, endB)];
    if (!ends.every((e) => e && e.square && e.reach * Math.abs(tau) < e.length / 2)) return;
    this.mitreWall(p, a, endA, -tau);
    this.mitreWall(p, b, endB, tau);
  }

  /** Cuts a wall's square `end` at slant `k` (mitreWall's), unless the cut would reach past its middle. */
  private cutWallEnd(p: Plan, wall: Rec, end: "start" | "end", k: number): void {
    const e = this.wallEnd(p, wall, end);
    if (e?.square && e.reach * Math.abs(k) < e.length / 2) this.mitreWall(p, wall, end, k);
  }

  /** How far a wall's points reach across its line, its length, and whether its points at `end` lie square across it. */
  private wallEnd(p: Plan, wall: Rec, end: "start" | "end"): { reach: number; length: number; square: boolean } | null {
    const line = readWall(p.cur(wall.index));
    if (!line) return null;
    const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    const u = unitVec(line.start, line.end);
    let reach = 0;
    let square = true;
    const probe = (q: Pt): Pt => {
      const along = (q.x - line.start.x) * u.x + (q.y - line.start.y) * u.y;
      reach = Math.max(reach, Math.abs((q.y - line.start.y) * u.x - (q.x - line.start.x) * u.y));
      if ((end === "end") === along > length / 2 && Math.abs(along - (end === "end" ? length : 0)) > WALL_END_TOLERANCE) square = false;
      return q;
    };
    for (const o of wall.walk()) {
      if (o === wall) continue;
      // anything else set in it (a door, a window) can't be cut with it
      if (o.type === PLUGIN || o.type === SYMBOL_INSTANCE) return null;
      reshapeRecord(p.cur(o.index), o.type, probe);
    }
    return { reach, length, square };
  }

  /**
   * Moves each point at a wall's `end` along it by `k` times its distance across the line (left of
   * it positive), its drawing and its bodies alike, and fits the boxes of what holds them.
   */
  private mitreWall(p: Plan, wall: Rec, end: "start" | "end", k: number): void {
    const line = readWall(p.cur(wall.index))!;
    const length = Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
    const u = unitVec(line.start, line.end);
    const cut = (q: Pt): Pt => {
      const along = (q.x - line.start.x) * u.x + (q.y - line.start.y) * u.y;
      if ((end === "end") !== along > length / 2) return q;
      const shift = k * ((q.y - line.start.y) * u.x - (q.x - line.start.x) * u.y);
      return { x: q.x + u.x * shift, y: q.y + u.y * shift };
    };
    let box: BBox | null = null;
    for (const o of wall.walk()) {
      if (o === wall) continue;
      const d = reshapeRecord(p.cur(o.index), o.type, cut);
      if (!d) continue;
      p.set(o.index, d);
      box = unionBox(box, o.type === BODY ? bodyPlanBox(d) : readBBox(d));
    }
    // a group of bodies and a bare solid addition take their bodies' plan box
    for (const o of wall.walk()) {
      if (o.type !== 11 && o.type !== SOLID) continue;
      let fit: BBox | null = null;
      for (const c of o.walk()) if (c.type === BODY) fit = unionBox(fit, bodyPlanBox(p.cur(c.index)));
      if (!fit) continue;
      const d = p.cur(o.index).slice();
      fitPlanBoxes(d, fit);
      p.set(o.index, d);
    }
    // the wall's own box grows to hold the cut (a 2026 wall's is unbounded, and stays so)
    const own = readBBox(p.cur(wall.index));
    if (own && box) {
      const d = p.cur(wall.index).slice();
      writeBBox(d, unionBox(own, box)!);
      p.set(wall.index, d);
    }
  }

  setWallLine(id: string, start: Pt, end: Pt): void {
    const r = this.object(id);
    const line = r.type === WALL ? readWall(r.data) : null;
    if (!line) throw new Error("that object isn't a wall");
    if (![start.x, start.y, end.x, end.y].every(Number.isFinite)) throw new Error("a wall's ends are finite numbers");
    if (!(pointGap(start, end) > 1)) throw new Error("a wall's ends are the same point");
    const p = this.plan();
    const to = { start, end };
    if (pointGap(start, line.start) === 0 && pointGap(end, line.end) === 0) return this.placeWall(p, r, to, {});
    const follow = this.wallFollowers(p, [r]);
    this.placeWall(p, r, to, {});
    const followed = follow();
    this.commit(p, "objects", [id, ...followed.filter((w) => w !== r).map(guidOf)]);
  }

  joinWallPair(first: string, second: string, kind: "L" | "T" | "X" | "no-trim", picks: { first?: Pt; second?: Pt } = {}): void {
    const a = this.object(first);
    const b = this.object(second);
    if (a === b) throw new Error("a wall can't be joined to itself");
    const la = a.type === WALL ? wallPlan(a) : null;
    const lb = b.type === WALL ? wallPlan(b) : null;
    if (!la || !lb) throw new Error("only straight walls can be joined");
    if (a.parent !== b.parent) throw new Error("walls on different layers or in different groups can't be joined");
    // where the lines cross, as far along each from its start
    const sin = la.u.x * lb.u.y - la.u.y * lb.u.x;
    if (Math.abs(sin) < 1e-9) throw new Error("those walls run side by side and never meet");
    const ta = ((lb.start.x - la.start.x) * lb.u.y - (lb.start.y - la.start.y) * lb.u.x) / sin;
    const tb = ((lb.start.x - la.start.x) * la.u.y - (lb.start.y - la.start.y) * la.u.x) / sin;
    // the end that goes: past an end, that one; across the wall, the one away from the part clicked (else the shorter part's)
    const going = (l: typeof la, t: number, pick: Pt | undefined): WallEnd => {
      if (t <= 0 || t >= l.length || !pick) return t <= l.length / 2 ? "start" : "end";
      return (pick.x - l.start.x) * l.u.x + (pick.y - l.start.y) * l.u.y < t ? "end" : "start";
    };
    if (kind === "no-trim") {
      // nothing is cut back: a wall running past the crossing stays whole and the other runs into its side
      const past = (l: typeof la, t: number): boolean => t > WALL_END_TOLERANCE && t < l.length - WALL_END_TOLERANCE;
      if (past(la, ta) && past(lb, tb)) throw new Error("those walls cross already: there is nothing to join without trimming");
      if (past(la, ta)) return this.joinWallPair(second, first, "T");
      if (past(lb, tb)) return this.joinWallPair(first, second, "T");
      return this.joinWallPair(first, second, "L");
    }
    const p = this.plan();
    if (kind === "X") {
      // across each other between their ends: the first breaks where they cross, each part running to the second's face
      const inside = (l: typeof la, t: number): boolean => t > WALL_END_TOLERANCE && t < l.length - WALL_END_TOLERANCE;
      if (!inside(la, ta) || !inside(lb, tb)) throw new Error("those walls don't cross: join them at a corner (L) or a tee (T)");
      if (Math.abs(sin) < MIN_TEE_SINE) throw new Error("walls crossing in an X cross at 15° or more");
      this.batch(() => {
        const rest = this.object(this.splitWall(first, { x: la.start.x + la.u.x * ta, y: la.start.y + la.u.y * ta }));
        // the split rebuilt the first wall's records
        const p = this.plan();
        this.teeWall(p, this.object(first), "end", this.object(second));
        this.teeWall(p, rest, "start", this.object(second));
        this.commit(p, "objects", [first, guidOf(rest)]);
      });
      return;
    }
    const ea = going(la, ta, picks.first);
    if (this.wallEndMeets(a, ea, b)) throw new Error("that end of the first wall meets another wall already");
    if (kind === "L") {
      const eb = going(lb, tb, picks.second);
      if (this.wallEndMeets(b, eb, a)) throw new Error("that end of the second wall meets another wall already");
      const at = { x: la.start.x + la.u.x * ta, y: la.start.y + la.u.y * ta };
      const na: WallLine = { start: la.start, end: la.end, [ea]: at };
      const nb: WallLine = { start: lb.start, end: lb.end, [eb]: at };
      if (!(pointGap(na.start, na.end) > 1 && pointGap(nb.start, nb.end) > 1)) throw new Error("that would leave nothing of a wall");
      // a comes in at its end, b goes out from its own
      const [ca, cb] = mitreCuts(this.wallLayout(p, a), na, ea, this.wallLayout(p, b), nb, eb);
      this.placeWall(p, a, na, { [ea]: ca });
      this.placeWall(p, b, nb, { [eb]: cb });
      this.commit(p, "objects", [first, second]);
      return;
    }
    this.teeWall(p, a, ea, b);
    this.commit(p, "objects", [first]);
  }

  /**
   * A tee in the plan: wall `a`'s end `ea` runs to `b`'s face toward a's other end, between b's
   * ends, cut along it; b stays as it is. Throws where they can't meet so.
   */
  private teeWall(p: Plan, a: Rec, ea: WallEnd, b: Rec): void {
    const la = wallPlan(a)!;
    const lb = wallPlan(b)!;
    if (Math.abs(la.u.x * lb.u.y - la.u.y * lb.u.x) < MIN_TEE_SINE) throw new Error("a wall meeting another's side runs into it at 15° or more");
    const nf = { x: -lb.u.y, y: lb.u.x };
    const across = (q: Pt): number => (q.x - lb.start.x) * nf.x + (q.y - lb.start.y) * nf.y;
    const rest = across(ea === "start" ? la.end : la.start);
    if (rest >= lb.lo && rest <= lb.hi) throw new Error("the first wall's other end lies within the second wall");
    const face = rest > lb.hi ? lb.hi : lb.lo;
    const dot = la.u.x * nf.x + la.u.y * nf.y;
    const t = (face - across(la.start)) / dot;
    const at = { x: la.start.x + la.u.x * t, y: la.start.y + la.u.y * t };
    const along = (at.x - lb.start.x) * lb.u.x + (at.y - lb.start.y) * lb.u.y;
    if (!(along > WALL_END_TOLERANCE && along < lb.length - WALL_END_TOLERANCE)) throw new Error("the first wall would meet the second past its end: join them at a corner (L)");
    const na: WallLine = { start: la.start, end: la.end, [ea]: at };
    if (!(pointGap(na.start, na.end) > 1)) throw new Error("that would leave nothing of the first wall");
    // its points there lie on the face: along it by how far they lie across it, as the Wall tool cuts a tee
    this.placeWall(p, a, na, { [ea]: { k: -(-la.u.y * nf.x + la.u.x * nf.y) / dot, m: 0 } });
  }

  splitWall(id: string, at: Pt): string {
    const r = this.object(id);
    const line = r.type === WALL ? wallPlan(r) : null;
    if (!line || !r.parent) throw new Error("only straight walls can be split");
    const p0 = this.plan();
    const g = this.wallLayout(p0, r);
    if (g.spans.length) throw new Error("a wall with doors, windows or symbols set in it can't be split yet");
    if (g.points.some((q) => g.pointSide(g.along(q)) === "between")) throw new Error("a wall drawn with more than its two ends (a notch, a pier) can't be split yet");
    const t = g.along(at);
    if (!(t > WALL_END_TOLERANCE && t < g.length - WALL_END_TOLERANCE)) throw new Error("split a wall between its ends");
    // a wall meeting its side there would meet neither part
    for (const tee of this.wallTees(p0, r)) {
      const m = this.wallLayout(p0, tee.wall);
      const a = m.points.filter((q) => m.pointSide(m.along(q)) === tee.end).map(g.along);
      if (t > Math.min(...a) - WALL_END_TOLERANCE && t < Math.max(...a) + WALL_END_TOLERANCE) throw new Error("another wall meets this one there: split it to one side of the joint");
    }
    const x = { x: line.start.x + line.u.x * t, y: line.start.y + line.u.y * t };
    return this.batch(() => {
      // a copy in its place in the list, unnamed (names are unique), takes the part past the point
      const p = this.plan();
      const copies = this.instantiate(templateOf(r), r.owner);
      const objects = new Set(objectWalk(r));
      [...r.walk()].forEach((o, i) => objects.has(o) && setU16(copies[i], 0x1a, 0));
      p.insert(subtreeEnd(r) + 1, copies);
      this.refitGroups(p, [], new Map([[r.parent!, [copies[0]]]]));
      const nid = recOfData(copies[0]).guid;
      this.commit(p, "objects", [nid]);
      // each part's end there square across the line, whatever shape the end it comes from had
      const q = this.plan();
      this.placeWall(q, r, { start: line.start, end: x }, { end: (o) => g.length - g.along(o) });
      this.placeWall(q, this.object(nid), { start: x, end: line.end }, { start: (o) => -g.along(o) });
      this.commit(q, "objects", [id, nid]);
      return nid;
    });
  }

  /** True when a wall other than `other` meets `wall`'s `end`: its end there, or its side (a tee). */
  private wallEndMeets(wall: Rec, end: WallEnd, other: Rec): boolean {
    const at = readWall(wall.data)![end];
    return objectChildren(wall.parent!).some((o) => {
      const l = o !== wall && o !== other && o.type === WALL ? wallPlan(o) : null;
      if (!l) return false;
      if (pointGap(l.start, at) <= WALL_END_TOLERANCE || pointGap(l.end, at) <= WALL_END_TOLERANCE) return true;
      const along = (at.x - l.start.x) * l.u.x + (at.y - l.start.y) * l.u.y;
      const across = (at.y - l.start.y) * l.u.x - (at.x - l.start.x) * l.u.y;
      return along > WALL_END_TOLERANCE && along < l.length - WALL_END_TOLERANCE && across >= l.lo - WALL_END_TOLERANCE && across <= l.hi + WALL_END_TOLERANCE;
    });
  }

  /**
   * True when a wall beside `w`, not one of `skip`, has its control line's ends where w's are and
   * the same top and bottom: a copy on it, not a wall stacked on it (the demos stack 29, none alike).
   */
  private wallTwin(p: Plan, w: Rec, skip: ReadonlySet<Rec>): boolean {
    const d = p.cur(w.index);
    const a = readWall(d);
    if (!a || !w.parent || d.length < WALL_HEIGHTS[1] + 8) return false;
    return w.parent.children.some((o) => {
      if (o === w || o.type !== WALL || skip.has(o)) return false;
      const e = p.cur(o.index);
      const b = readWall(e);
      if (!b || e.length < WALL_HEIGHTS[1] + 8) return false;
      const at = (x: Pt, y: Pt): boolean => pointGap(x, y) <= WALL_END_TOLERANCE;
      const level = WALL_HEIGHTS.slice(0, 2).every((h) => Math.abs(f64(d, h) - f64(e, h)) <= WALL_END_TOLERANCE);
      return level && ((at(a.start, b.start) && at(a.end, b.end)) || (at(a.start, b.end) && at(a.end, b.start)));
    });
  }

  /**
   * Called before `walls` move in the plan, notes the walls mitred to them (wallCorner's) at ends
   * of walls not among them, the walls meeting those ends otherwise (wallEndJoins': at the same
   * point, or butted), and the walls meeting the side of one that moves or follows (wallTees');
   * the function it returns, called once they have moved, has those walls follow (an end met
   * otherwise goes where the end went, or as it went when butted, keeping its cut):
   * each mitred one's end goes where the moved wall's end went, and every such corner, and the far
   * corners of the walls that followed, is mitred again (mitreCuts), a wall across a far corner
   * cut anew where it stays; then each point at a teeing wall's end slides along its line to lie as
   * deep behind the met wall's face toward it as it lay behind the face it met (the other face, when
   * a mirror or a turn has swapped them), its line's end with them. Returns the walls it changed.
   * Throws when one can't follow. A mirror swaps a wall's ends (transformRecord): `mirrored` says
   * the end that was a moved wall's start is its end now.
   */
  private wallFollowers(p: Plan, walls: readonly Rec[], mirrored = false): () => Rec[] {
    const moving = new Set(walls);
    // a wall lying on one that stays (a copy made in place) can't tell its joins from that one's: it takes none along
    const carrying = walls.filter((w) => !this.wallTwin(p, w, moving));
    const joins = carrying.flatMap((w) => WALL_ENDS.map((e) => ({ w, e, c: this.wallCorner(p, w, e) })));
    const following = new Set(joins.flatMap(({ c }) => (c && !moving.has(c.wall) ? [c.wall] : [])));
    // the walls meeting their ends otherwise: at the same point, or butted into the end
    const meets = carrying.flatMap((w) => {
      const was = readWall(p.cur(w.index))!;
      return WALL_ENDS.flatMap((e) => this.wallEndJoins(p, w, e).filter((j) => !moving.has(j.wall) && !following.has(j.wall)).map((j) => ({ ...j, w, e, before: was })));
    });
    for (const m of meets) following.add(m.wall);
    const tees = [...carrying, ...following].flatMap((met) => {
      const was = readWall(p.cur(met.index))!;
      return this.wallTees(p, met)
        .filter((t) => !moving.has(t.wall) && !following.has(t.wall))
        .map((t) => ({ ...t, met, was }));
    });
    return () => {
      const lines = new Map<Rec, WallLine>();
      const line = (w: Rec): WallLine => lines.get(w) ?? readWall(p.cur(w.index))!;
      const corners: { w: Rec; e: WallEnd; c: { wall: Rec; end: WallEnd } }[] = [];
      for (const { w, e: was, c } of joins) {
        if (!c || moving.has(c.wall)) continue;
        const e = mirrored ? (was === "start" ? "end" : "start") : was;
        lines.set(c.wall, { ...line(c.wall), [c.end]: readWall(p.cur(w.index))![e] });
        corners.push({ w, e, c });
      }
      // an end at the moved end's point goes where it went, one butted into it as the end went
      // (turned with it, and across it the other way when mirrored); each keeps its cut
      for (const { w, e: was, wall, end, butt, before: from } of meets) {
        const e = mirrored ? (was === "start" ? "end" : "start") : was;
        const now = readWall(p.cur(w.index))!;
        let at = now[e];
        if (butt) {
          const u0 = unitVec(from.start, from.end);
          const u1 = unitVec(now.start, now.end);
          const q = line(wall)[end];
          const a = (q.x - from[was].x) * u0.x + (q.y - from[was].y) * u0.y;
          const c = (q.y - from[was].y) * u0.x - (q.x - from[was].x) * u0.y;
          const k = mirrored ? -1 : 1;
          at = { x: at.x + a * k * u1.x - c * u1.y, y: at.y + a * k * u1.y + c * u1.x };
        }
        lines.set(wall, { ...line(wall), [end]: at });
      }
      for (const f of [...lines.keys()]) {
        for (const e of WALL_ENDS) {
          const c = this.wallCorner(p, f, e);
          if (c && !moving.has(c.wall)) corners.push({ w: f, e, c });
        }
      }
      const cuts = new Map<Rec, Partial<Record<WallEnd, WallCut>>>();
      for (const { w, e, c } of corners) {
        const [ca, cb] = mitreCuts(this.wallLayout(p, w), line(w), e, this.wallLayout(p, c.wall), line(c.wall), c.end);
        cuts.set(w, { ...cuts.get(w), [e]: ca });
        cuts.set(c.wall, { ...cuts.get(c.wall), [c.end]: cb });
      }
      const changed = [...new Set([...lines.keys(), ...cuts.keys()])];
      for (const w of changed) {
        try {
          this.placeWall(p, w, line(w), cuts.get(w) ?? {});
        } catch (e) {
          if (moving.has(w)) throw e;
          throw new Error(`a wall joined to it can't follow: ${(e as Error).message}`);
        }
      }
      return [...new Set([...changed, ...this.slideTees(p, tees)])];
    };
  }

  /**
   * Has each wall of `tees` whose end met the side of wall `met` (wallTees' tee, `met`'s line then
   * `was`) follow it: each point at its end slides along its line to lie as deep behind `met`'s face
   * toward it now as it lay behind the face it met (the other face, when a mirror or a turn has
   * swapped them), `depth` times as deep when given, its line's end with them. Returns the walls it
   * changed; throws when one can't.
   */
  private slideTees(p: Plan, tees: readonly { wall: Rec; end: WallEnd; face: number; side: 1 | -1; met: Rec; was: WallLine; depth?: number }[]): Rec[] {
    const teed = new Map<Rec, { to: WallLine; slides: Partial<Record<WallEnd, (q: Pt) => number>> }>();
    const faces = new Map<Rec, { lo: number; hi: number }>();
    for (const t of tees) {
      const now = readWall(p.cur(t.met.index))!;
      const own = teed.get(t.wall)?.to ?? readWall(p.cur(t.wall.index))!;
      const u = unitVec(own.start, own.end);
      const across = (l: WallLine, q: Pt): number => {
        const v = unitVec(l.start, l.end);
        return (q.y - l.start.y) * v.x - (q.x - l.start.x) * v.y;
      };
      const v = unitVec(now.start, now.end);
      const sin = v.x * u.y - v.y * u.x;
      // the met wall's face toward the rest of it now
      if (!faces.has(t.met)) faces.set(t.met, this.wallLayout(p, t.met));
      const { lo, hi } = faces.get(t.met)!;
      const rest = across(now, own[t.end === "start" ? "end" : "start"]);
      if (rest <= hi && rest >= lo) throw new Error("a wall meeting its side can't follow: the wall it meets would come down on it");
      const [face, side] = rest > hi ? [hi, 1] : [lo, -1];
      // how far across the met wall's line a point goes to lie as deep behind that face as it did (times depth)
      const gap = (q: Pt): number => face - side * t.side * (t.face - across(t.was, q)) * (t.depth ?? 1) - across(now, q);
      const slide = (q: Pt): number => gap(q) / sin;
      const at = own[t.end];
      if ([at, { x: at.x + u.x, y: at.y + u.y }, { x: at.x - u.y, y: at.y + u.x }].every((q) => Math.abs(gap(q)) < 1e-9)) continue;
      if (Math.abs(sin) < MIN_TEE_SINE) throw new Error("a wall meeting its side can't follow: they would meet at under 15°");
      const by = slide(at);
      const entry = teed.get(t.wall) ?? { to: own, slides: {} };
      entry.to = { ...entry.to, [t.end]: { x: at.x + u.x * by, y: at.y + u.y * by } };
      entry.slides[t.end] = (q) => slide(q) - by;
      teed.set(t.wall, entry);
    }
    for (const [w, { to, slides }] of teed) {
      try {
        this.placeWall(p, w, to, slides);
      } catch (e) {
        throw new Error(`a wall meeting its side can't follow: ${(e as Error).message}`);
      }
    }
    return [...teed.keys()];
  }

  /**
   * How a wall lies, read from the plan: its line, its parts and what is set in it, how far its
   * points reach across the line and its faces (the least and most of it), and which end each
   * point and each door or window goes with. An end holds what lies within reach of it, and what
   * is set in the wall wholly there (an end cap); the rest (doors and windows, their openings,
   * breaks) lies between. An end's reach stops short of a door or window across it. Throws as
   * wallParts does.
   */
  private wallLayout(p: Plan, r: Rec) {
    const line = readWall(p.cur(r.index));
    if (!line) throw new Error("that object isn't a wall");
    const { parts, inserts } = this.wallParts(r);
    const length = pointGap(line.start, line.end);
    const u = unitVec(line.start, line.end);
    const along = (q: Pt): number => (q.x - line.start.x) * u.x + (q.y - line.start.y) * u.y;
    const across = (q: Pt): number => (q.y - line.start.y) * u.x - (q.x - line.start.x) * u.y;
    const points: Pt[] = [];
    for (const o of parts) reshapeRecord(p.cur(o.index), o.type, (q) => (points.push(q), q));
    const reach = points.reduce((m, q) => Math.max(m, Math.abs(across(q))), 0);
    const lo = points.reduce((m, q) => Math.min(m, across(q)), 0);
    const hi = points.reduce((m, q) => Math.max(m, across(q)), 0);
    const zone = reach * WALL_END_REACH + WALL_END_TOLERANCE;
    const spans = inserts.map((o) => {
      const a = this.insertCorners(p, o).map(along);
      return { o, a0: Math.min(...a), a1: Math.max(...a) };
    });
    const side = (a0: number, a1: number): Side =>
      (a0 + a1) / 2 <= length / 2 ? (a1 <= zone ? "start" : "between") : a0 >= length - zone ? "end" : "between";
    const between = spans.filter((s) => side(s.a0, s.a1) === "between");
    // a door's opening lies within WALL_END_TOLERANCE of its drawing (the demos' often just that
    // far), and the reach stops a hair past it, so a turn's rounding doesn't move a point across
    const margin = WALL_END_TOLERANCE + 1e-6;
    const startReach = Math.min(zone, ...between.map((s) => s.a0 - margin));
    const endReach = Math.max(length - zone, ...between.map((s) => s.a1 + margin));
    const pointSide = (a: number): Side => (a <= length / 2 ? (a <= startReach ? "start" : "between") : a >= endReach ? "end" : "between");
    return { line, length, u, along, across, parts, points, reach, lo, hi, spans, between, side, pointSide };
  }

  /**
   * Moves a wall's line to `to` in the plan, with its drawing, bodies and what is set in it (as
   * setWallLine says), and gives an end in `cuts` that new cut, its points there moved along the
   * line to it, or slides each of them that much further along it than the end (a function of the
   * point as it lies). Throws as setWallLine does, and for an end to cut anew that isn't cut
   * straight across.
   */
  private placeWall(p: Plan, r: Rec, to: WallLine, cuts: Partial<Record<WallEnd, WallCut | ((q: Pt) => number)>>): void {
    const g = this.wallLayout(p, r);
    const { line, length, u, along, across } = g;
    const { start, end } = to;
    const length1 = pointGap(start, end);
    if (2 * g.reach * WALL_END_REACH >= length1) throw new Error("a wall that short would lose the shape of its ends");
    const same = pointGap(start, line.start) === 0 && pointGap(end, line.end) === 0;
    if (same && !cuts.start && !cuts.end) return;
    const u1 = same ? u : unitVec(start, end);
    // how much further along the line a point at an end goes than the end, to lie on its new cut
    const recut = { start: (_q: Pt) => 0, end: (_q: Pt) => 0 };
    for (const e of WALL_ENDS) {
      const want = cuts[e];
      if (!want) continue;
      if (typeof want === "function") {
        recut[e] = want;
        continue;
      }
      const was = wallEndCut(g, e);
      if (!was) throw new Error("that wall's end isn't cut straight across");
      recut[e] = (q) => (want.k - was.k) * across(q) + want.m - was.m;
    }
    const cutAt = (s: Side, q: Pt): number => (s === "between" ? 0 : recut[s](q));
    // what lies between the ends keeps its place from the end that stays put: the end when only
    // the start moves, else the start
    const anchor: Side = pointGap(end, line.end) === 0 ? "end" : "start";
    const endOf = (s: Side): WallEnd => (s === "between" ? anchor : s);
    // each goes with its end, as it lies from that end along and across the line
    const turn = (s: Side): Affine => {
      const [from, at] = endOf(s) === "start" ? [line.start, start] : [line.end, end];
      const cos = same ? 1 : u.x * u1.x + u.y * u1.y;
      const sin = same ? 0 : u.x * u1.y - u.y * u1.x;
      return { a: cos, b: sin, c: -sin, d: cos, e: at.x - cos * from.x + sin * from.y, f: at.y - sin * from.x - cos * from.y };
    };
    const shift = (s: Side): number => (endOf(s) === "start" ? 0 : length1 - length);
    const placed = [
      ...g.points.map((q) => {
        const s = g.pointSide(along(q));
        const a = along(q) + shift(s) + cutAt(s, q);
        return { s, a0: a, a1: a };
      }),
      ...g.spans.map((x) => ({ s: g.side(x.a0, x.a1), a0: x.a0, a1: x.a1 })).map((x) => ({ ...x, a0: x.a0 + shift(x.s), a1: x.a1 + shift(x.s) })),
    ];
    // nor can an end move off a door or window reaching over it
    if (Math.abs(length1 - length) > 1e-9 && g.between.some((x) => (anchor !== "start" && x.a0 < WALL_END_TOLERANCE) || (anchor !== "end" && x.a1 > length - WALL_END_TOLERANCE))) {
      throw new Error("a door or window reaches over that end of the wall");
    }
    // what lies between the ends stays between them, and the ends stay apart
    const reachOf = (s: Side, f: (x: { a0: number; a1: number }) => number, m: (...v: number[]) => number): number => m(...placed.filter((x) => x.s === s).map(f));
    const inner = placed.some((x) => x.s === "between");
    const lo = inner ? reachOf("between", (x) => x.a0, Math.min) : reachOf("end", (x) => x.a0, Math.min);
    const hi = inner ? reachOf("between", (x) => x.a1, Math.max) : reachOf("start", (x) => x.a1, Math.max);
    if (reachOf("start", (x) => x.a1, Math.max) >= lo || reachOf("end", (x) => x.a0, Math.min) <= hi) {
      if (!inner) throw new Error("a wall that short would lose the shape of its ends");
      throw new Error(g.spans.length ? "that would take the wall's end through a door or window set in it" : "that would take the wall's end through its middle");
    }
    const moves = { start: turn("start"), end: turn("end"), between: turn("between") };
    const moved = (q: Pt): Pt => {
      const s = g.pointSide(along(q));
      const m = applyAffine(moves[s], q);
      const c = cutAt(s, q);
      return { x: m.x + u1.x * c, y: m.y + u1.y * c };
    };
    this.reshapeWall(p, r, g.parts, moved);
    for (const x of g.spans) this.transformTrees(p, [x.o], moves[g.side(x.a0, x.a1)]);
    if (same) return;
    const d = p.cur(r.index).slice();
    setF64(d, WALL_LINE, start.y);
    setF64(d, WALL_LINE + 8, start.x);
    setF64(d, WALL_LINE + 16, end.y);
    setF64(d, WALL_LINE + 24, end.x);
    p.set(r.index, d);
    this.refitGroups(p, [r]);
  }

  /**
   * The one other wall whose end meets `wall`'s `end` (within WALL_END_TOLERANCE, beside it on its
   * layer or in its group), when the two are mitred there as mitreCuts cuts them: each end cut
   * straight across along the line through where their faces cross, or square in a straight run.
   * Else null: three walls or more meeting, a tee, ends cut otherwise, or a wall that can't move.
   */
  private wallCorner(p: Plan, wall: Rec, end: WallEnd): { wall: Rec; end: WallEnd } | null {
    const line = readWall(p.cur(wall.index));
    if (!line || !wall.parent) return null;
    const meets: { wall: Rec; end: WallEnd }[] = [];
    for (const o of objectChildren(wall.parent)) {
      const l = o !== wall && o.type === WALL ? readWall(p.cur(o.index)) : null;
      for (const e of l ? WALL_ENDS : []) if (pointGap(l![e], line[end]) <= WALL_END_TOLERANCE) meets.push({ wall: o, end: e });
    }
    if (meets.length !== 1) return null;
    const c = meets[0];
    let a, b;
    try {
      a = this.wallLayout(p, wall);
      b = this.wallLayout(p, c.wall);
    } catch {
      return null;
    }
    const has = [wallEndCut(a, end), wallEndCut(b, c.end)];
    const want = mitreCuts(a, a.line, end, b, b.line, c.end);
    const off = (x: WallCut, y: WallCut, width: number): number => Math.abs(x.k - y.k) * Math.max(width, 1) + Math.abs(x.m - y.m);
    if (!has[0] || !has[1] || off(has[0], want[0], a.hi - a.lo) > WALL_END_TOLERANCE || off(has[1], want[1], b.hi - b.lo) > WALL_END_TOLERANCE) return null;
    return c;
  }

  /**
   * The walls beside `wall` (on its layer or in its group) whose end meets its `end` other than as
   * wallCorner's mitred corner or wallTees' tee, standing at heights it stands at too (a wall
   * stacked on it isn't joined): their line's end at the same point (three walls or more meeting
   * there, or two cut otherwise, as Vectorworks cuts its own corners), or `butt`, within its end
   * (its points within reach of the end and between its faces), there alone.
   */
  private wallEndJoins(p: Plan, wall: Rec, end: WallEnd): { wall: Rec; end: WallEnd; butt: boolean }[] {
    const line = readWall(p.cur(wall.index));
    if (!line || !wall.parent) return [];
    let g;
    try {
      g = this.wallLayout(p, wall);
    } catch {
      return [];
    }
    const corner = this.wallCorner(p, wall, end)?.wall;
    const tees = this.wallTees(p, wall);
    const zone = g.reach * WALL_END_REACH + WALL_END_TOLERANCE;
    const out: { wall: Rec; end: WallEnd; butt: boolean }[] = [];
    for (const o of objectChildren(wall.parent)) {
      const l = o !== wall && o !== corner && o.type === WALL ? readWall(p.cur(o.index)) : null;
      if (!l || Math.min(l.top, line.top) - Math.max(l.bottom, line.bottom) <= WALL_END_TOLERANCE) continue;
      for (const e of WALL_ENDS) {
        const q = l[e];
        if (pointGap(q, line[end]) <= WALL_END_TOLERANCE) {
          out.push({ wall: o, end: e, butt: false });
          continue;
        }
        const a = g.along(q);
        const c = g.across(q);
        const within = end === "start" ? a >= -WALL_END_TOLERANCE && a <= zone : a >= g.length - zone && a <= g.length + WALL_END_TOLERANCE;
        if (!within || c < g.lo - WALL_END_TOLERANCE || c > g.hi + WALL_END_TOLERANCE) continue;
        if (tees.some((t) => t.wall === o && t.end === e) || this.wallCorner(p, o, e)) continue;
        // alone there: no other wall's end at its own
        const shared = objectChildren(wall.parent).some((x) => {
          const m = x !== o && x !== wall && x.type === WALL ? readWall(p.cur(x.index)) : null;
          return !!m && WALL_ENDS.some((f) => pointGap(m[f], q) <= WALL_END_TOLERANCE);
        });
        if (!shared) out.push({ wall: o, end: e, butt: true });
      }
    }
    return out;
  }

  /**
   * The walls whose end meets `wall`'s side, beside it on its layer or in its group: their line
   * ending between its ends and their points there all beside its side, from its face nearer their
   * other end at most to its far face (as the Wall tool cuts a tee along the face, and
   * Vectorworks's run each component to its own depth, the line to the middle), crossing it at
   * MIN_TEE_SINE or more. Corners (wallCorner's) aren't tees. Each with the face it meets: how far
   * across `wall`'s line, and 1 for its left face (the most across), -1 for its right.
   */
  private wallTees(p: Plan, wall: Rec): { wall: Rec; end: WallEnd; face: number; side: 1 | -1 }[] {
    if (!wall.parent) return [];
    let m;
    try {
      m = this.wallLayout(p, wall);
    } catch {
      return [];
    }
    const beside = (q: Pt): boolean => {
      const a = m.along(q);
      const c = m.across(q);
      return a > WALL_END_TOLERANCE && a < m.length - WALL_END_TOLERANCE && c >= m.lo - WALL_END_TOLERANCE && c <= m.hi + WALL_END_TOLERANCE;
    };
    const tees: { wall: Rec; end: WallEnd; face: number; side: 1 | -1 }[] = [];
    for (const o of objectChildren(wall.parent)) {
      const l = o !== wall && o.type === WALL ? readWall(p.cur(o.index)) : null;
      for (const e of l ? WALL_ENDS : []) {
        const rest = m.across(l![e === "start" ? "end" : "start"]);
        const u = unitVec(l!.start, l!.end);
        if (!beside(l![e]) || (rest <= m.hi && rest >= m.lo) || Math.abs(m.u.x * u.y - m.u.y * u.x) < MIN_TEE_SINE) continue;
        let t;
        try {
          t = this.wallLayout(p, o);
        } catch {
          continue;
        }
        const at = t.points.filter((q) => t.pointSide(t.along(q)) === e);
        if (at.length && at.every(beside) && !this.wallCorner(p, o, e)) tees.push({ wall: o, end: e, ...(rest > m.hi ? { face: m.hi, side: 1 as const } : { face: m.lo, side: -1 as const }) });
      }
    }
    return tees;
  }

  setWallHeights(id: string, bottom: number, top: number): void {
    const r = this.object(id);
    const w = r.type === WALL ? readWall(r.data) : null;
    if (!w) throw new Error("that object isn't a wall");
    if (![bottom, top].every(Number.isFinite)) throw new Error("a wall's heights are finite numbers");
    if (!(top - bottom > 1)) throw new Error("a wall's top is above its bottom");
    if (!(w.top - w.bottom > 1)) throw new Error("this wall has no height to stretch");
    const { parts, inserts } = this.wallParts(r);
    // above its layer: stored with the layer's elevation in them
    const ground = layerElevationOf(r);
    bottom += ground;
    top += ground;
    // every height between its bottom and top keeps its share of the way up; with doors or windows
    // set in it, they and their openings keep their height above its bottom, and only its top moves
    const k = (top - bottom) / (w.top - w.bottom);
    const lift = bottom - w.bottom;
    const atTop = (z: number): boolean => z >= w.top - WALL_END_TOLERANCE;
    const f = inserts.length ? (z: number): number => z + (atTop(z) ? top - w.top : lift) : (z: number): number => bottom + (z - w.bottom) * k;
    if (inserts.length) {
      const heights = WALL_HEIGHTS.map((at) => f64(r.data, at));
      if (heights.some((z) => z !== w.top && z !== w.bottom)) throw new Error("a wall sloping over its doors or windows can't change height this way yet");
      let below = w.bottom;
      for (const o of parts) reheightRecord(o.data.slice(), o.type, (z) => (atTop(z) || (below = Math.max(below, z)), z));
      if (below + lift >= top - WALL_END_TOLERANCE) throw new Error("that would bring the wall's top down through a door or window set in it");
    }
    const p = this.plan();
    for (const o of [r, ...parts]) {
      const d = p.cur(o.index).slice();
      if (reheightRecord(d, o.type, f)) p.set(o.index, d);
    }
    if (lift !== 0) for (const o of inserts) this.lift(p, o, lift);
    this.commit(p, "objects", [id]);
  }

  setWallStyle(id: string, template: string): string {
    const r = this.object(id);
    const line = r.type === WALL ? readWall(r.data) : null;
    if (!line || !wallPlan(r) || !r.parent) throw new Error("that object isn't a straight wall");
    const plain = plainWallSize(template);
    const tpl = plain ? null : this.object(template);
    if (tpl && (tpl.type !== WALL || !stretchableWall(this.doc, tpl))) throw new Error("a wall's new style is copied from a straight wall with square ends and nothing set in it");
    if (tpl === r) return id;
    if (this.wallParts(r).inserts.length) throw new Error("a wall with doors, windows or symbols set in it can't change style yet");
    const shell = plain ? this.plainWallShell(plain.thickness, plain.height) : templateOf(tpl!);
    const w = readWall(shell.recs[0])!;
    if (!(w.top - w.bottom > 1)) throw new Error("the wall that style is copied from has no height");
    // how it meets the walls around it, before it goes: mitred at its corners, met on its sides,
    // and its ends cut otherwise (along a face it runs into), which the new wall's keep
    const p0 = this.plan();
    const g = this.wallLayout(p0, r);
    const corners = WALL_ENDS.flatMap((e) => {
      const c = this.wallCorner(p0, r, e);
      return c ? [{ e, c }] : [];
    });
    const tees = this.wallTees(p0, r);
    const ends = { start: wallEndCut(g, "start"), end: wallEndCut(g, "end") };
    return this.batch(() => {
      // a copy of the template, in the wall's place in its list, named and classed as it was
      const p = this.plan();
      const copies = this.instantiate(shell, r.owner);
      const d = copies[0];
      setU16(d, 0x1a, u16(r.data, 0x1a));
      setU32(d, 0x20, u32(r.data, 0x20));
      if (plain) classPlainWall(copies, u32(r.data, 0x20));
      p.insert(subtreeEnd(r) + 1, copies);
      this.refitGroups(p, [], new Map([[r.parent!, [d]]]));
      const nid = recOfData(d).guid;
      this.commit(p, "objects", [nid]);
      const q = this.plan();
      const wall = this.object(nid);
      // laid along the wall's line as the template lies along its own, stretched to the wall's heights
      this.transformTrees(q, [wall], stretchOnto(w.start, w.end, line.start, line.end), true);
      const k = (line.top - line.bottom) / (w.top - w.bottom);
      for (const o of [wall, ...this.wallParts(wall).parts]) {
        const e = q.cur(o.index).slice();
        if (reheightRecord(e, o.type, (z) => line.bottom + (z - w.bottom) * k)) q.set(o.index, e);
      }
      // then the old one goes, and its joins pass to the new
      q.remove(r.index, subtreeEnd(r));
      this.refitGroups(q, [r]);
      const cuts: Partial<Record<WallEnd, WallCut>> = {};
      for (const e of WALL_ENDS) {
        const was = ends[e];
        if (was && (was.k !== 0 || was.m !== 0)) cuts[e] = was;
      }
      const changed: Rec[] = [];
      for (const { e, c } of corners) {
        const [ca, cb] = mitreCuts(this.wallLayout(q, wall), line, e, this.wallLayout(q, c.wall), readWall(q.cur(c.wall.index))!, c.end);
        cuts[e] = ca;
        this.placeWall(q, c.wall, readWall(q.cur(c.wall.index))!, { [c.end]: cb });
        changed.push(c.wall);
      }
      this.placeWall(q, wall, line, cuts);
      // what met its sides goes as far into the new wall, for its width, as it went into the old
      const now = this.wallLayout(q, wall);
      const depth = (now.hi - now.lo) / (g.hi - g.lo);
      changed.push(...this.slideTees(q, tees.map((t) => ({ ...t, met: wall, was: line, depth }))));
      this.commit(q, "objects", [id, nid, ...changed.map(guidOf)]);
      return nid;
    });
  }

  wallInsertKinds(): WallInsertKind[] {
    if (this.insertKinds?.recs !== this.doc.recs) this.insertKinds = { recs: this.doc.recs, list: this.findWallInsertKinds() };
    return this.insertKinds.list;
  }

  private findWallInsertKinds(): WallInsertKind[] {
    const kinds = new Map<string, WallInsertKind>();
    const counts = new Map<string, number>();
    const layers = this.designLayerRecs();
    const p = this.plan();
    for (const r of this.doc.recs) {
      const wall = r.parent;
      if (r.type !== PLUGIN || wall?.type !== WALL || !wall.parent || !layers.has(wall.parent)) continue;
      const name = this.doc.pluginName(r);
      const w = name ? this.doc.wall(guidOf(wall)) : null;
      if (!name || !w) continue;
      const params = this.doc.records(guidOf(r)).find((x) => x.parametric)?.fields.map((f) => f.value) ?? [];
      const key = JSON.stringify([name, params, w.style, w.thickness.toFixed(2)]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      // the first of its kind that can be copied with its opening
      if (kinds.has(key)) continue;
      const src = this.openingSource(p, r, layers);
      if (typeof src === "string") continue;
      kinds.set(key, { id: guidOf(r), name, count: 0, width: src.width, style: w.style, thickness: w.thickness, outline: src.outline });
    }
    for (const [key, k] of kinds) k.count = counts.get(key) ?? 1;
    // by name, then styled walls' by style, then narrowest first
    return [...kinds.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || (a.style ?? "\uffff").localeCompare(b.style ?? "\uffff") || a.thickness - b.thickness || a.width - b.width,
    );
  }

  /** The records of the drawing's design layers. */
  private designLayerRecs(): Set<Rec> {
    return new Set(this.doc.layers().flatMap((l) => (l.kind === "design" ? [this.doc.layerRec(l.id)] : [])).filter((r): r is Rec => r !== null));
  }

  /**
   * What a door or window `o` is copied from with its opening (insertInWall): the straight wall it
   * is set in alone, on a design layer, whose heights don't slope and whose ends are cut straight
   * across, drawn between its ends only with the opening (within OPENING_TRIM of its drawing, clear
   * of the ends). The wall's line and faces, the middle of o's drawing along it, how far the opening
   * reaches (o's drawing and the wall's points between its ends) and how many points lie between,
   * and o's outline about its middle in the wall's terms. Else why not.
   */
  private openingSource(
    p: Plan,
    o: Rec,
    layers: ReadonlySet<Rec>,
  ): { wall: Rec; line: WallLine; length: number; lo: number; hi: number; mid: number; c0: number; c1: number; inner: number; width: number; outline: Pt[] } | string {
    const wall = o.parent;
    if (o.type !== PLUGIN || wall?.type !== WALL) return "that isn't a door or window set in a wall";
    if (!copyable(o) || o.data.length < PLUGIN_MATRIX + 96) return "that door or window can't be copied";
    if (!wall.parent || !layers.has(wall.parent)) return "the wall it is set in isn't on a design layer";
    const w = readWall(p.cur(wall.index));
    if (!w || !wallPlan(wall)) return "the wall it is set in isn't straight";
    if (WALL_HEIGHTS.some((at) => f64(p.cur(wall.index), at) !== w.top && f64(p.cur(wall.index), at) !== w.bottom)) return "the wall it is set in slopes";
    let g;
    try {
      g = this.wallLayout(p, wall);
    } catch (e) {
      return (e as Error).message;
    }
    if (g.spans.length !== 1) return "the wall it is set in holds other doors, windows or symbols";
    const span = g.between[0];
    if (!span) return "it is set at the end of its wall";
    if (!wallEndCut(g, "start") || !wallEndCut(g, "end")) return "the wall it is set in has an end not cut straight across";
    let c0 = span.a0;
    let c1 = span.a1;
    let inner = 0;
    let clear = true;
    for (const q of g.points) {
      const a = g.along(q);
      if (g.pointSide(a) === "between") {
        c0 = Math.min(c0, a);
        c1 = Math.max(c1, a);
        inner++;
      }
    }
    if (c0 < span.a0 - OPENING_TRIM || c1 > span.a1 + OPENING_TRIM) return "the wall it is set in is drawn with more than its ends and the opening";
    for (const q of g.points) {
      const a = g.along(q);
      if (g.pointSide(a) !== "between" && a > c0 - OPENING_CLEAR && a < c1 + OPENING_CLEAR) clear = false;
    }
    if (!clear) return "it lies too near the end of its wall";
    const mid = (span.a0 + span.a1) / 2;
    const outline = this.insertCorners(p, o).map((q) => ({ x: g.along(q) - mid, y: g.across(q) }));
    return { wall, line: w, length: g.length, lo: g.lo, hi: g.hi, mid, c0, c1, inner, width: span.a1 - span.a0, outline };
  }

  insertInWall(source: string, wallId: string, at: Pt): { wall: string; insert: string } {
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error("a door's or window's place is a finite point");
    const o = this.object(source);
    const p0 = this.plan();
    const src = this.openingSource(p0, o, this.designLayerRecs());
    if (typeof src === "string") throw new Error(`that door or window can't be copied with its opening: ${src}`);
    const r = this.object(wallId);
    const line = r.type === WALL ? readWall(r.data) : null;
    if (!line || !wallPlan(r) || !r.parent) throw new Error("a door or window goes in a straight wall");
    const g = this.wallLayout(p0, r);
    if (g.spans.length) throw new Error("a wall with a door, window or symbol set in it can't take another yet");
    if (g.points.some((q) => g.pointSide(g.along(q)) === "between")) throw new Error("a wall drawn with more than its two ends (a joint cleaned up, a notch) can't take a door or window yet");
    const w = this.doc.wall(wallId);
    const w0 = this.doc.wall(guidOf(src.wall));
    if (!w || !w0 || w.style !== w0.style || Math.abs(w.thickness - w0.thickness) > 1e-6) throw new Error("that door or window is set in a wall of another style or thickness");
    if (Math.abs(g.lo - src.lo) > WALL_END_TOLERANCE || Math.abs(g.hi - src.hi) > WALL_END_TOLERANCE) throw new Error("that door or window is set in a wall whose faces lie otherwise about its line");
    if (WALL_HEIGHTS.some((h) => f64(r.data, h) !== line.top && f64(r.data, h) !== line.bottom)) throw new Error("a sloping wall can't take a door or window yet");
    const cuts = { start: wallEndCut(g, "start"), end: wallEndCut(g, "end") };
    if (!cuts.start || !cuts.end) throw new Error("a wall with an end not cut straight across can't take a door or window yet");
    // its middle at `at` along the wall, the opening clear of the ends and of the walls meeting the side
    const t = g.along(at);
    const lo = t - (src.mid - src.c0);
    const hi = t + (src.c1 - src.mid);
    let startMax = -Infinity;
    let endMin = Infinity;
    for (const q of g.points) {
      const a = g.along(q);
      if (g.pointSide(a) === "start") startMax = Math.max(startMax, a);
      else endMin = Math.min(endMin, a);
    }
    if (!(lo > startMax + OPENING_CLEAR && hi < endMin - OPENING_CLEAR)) throw new Error("it doesn't fit there: it would reach the wall's end");
    for (const tee of this.wallTees(p0, r)) {
      const m = this.wallLayout(p0, tee.wall);
      const a = m.points.filter((q) => m.pointSide(m.along(q)) === tee.end).map(g.along);
      if (hi > Math.min(...a) - WALL_END_TOLERANCE && lo < Math.max(...a) + WALL_END_TOLERANCE) throw new Error("another wall meets this one there: place it to one side of the joint");
    }
    const ground = layerElevationOf(r);
    const own = r.children.slice(0, auxCount(r)).filter((c) => c.type === RECORD);
    return this.batch(() => {
      // a copy of the wall the source is set in, in this wall's place in its list, named and classed as it
      const p = this.plan();
      const copies = this.instantiate(templateOf(src.wall), r.owner);
      const objects = new Set(objectWalk(src.wall));
      const walked = [...src.wall.walk()];
      walked.forEach((x, i) => objects.has(x) && setU16(copies[i], 0x1a, 0));
      setU16(copies[0], 0x1a, u16(r.data, 0x1a));
      setU32(copies[0], 0x20, u32(r.data, 0x20));
      p.insert(subtreeEnd(r) + 1, copies);
      this.refitGroups(p, [], new Map([[r.parent!, [copies[0]]]]));
      const nid = recOfData(copies[0]).guid;
      const did = recOfData(copies[walked.indexOf(o)]).guid;
      this.commit(p, "objects", [nid]);
      // laid along this wall's line with the door's middle at t, then its ends moved onto this
      // wall's one at a time (the door stays put while the other end does), cut as this wall's are
      const q = this.plan();
      const wall = this.object(nid);
      const s1 = { x: line.start.x + g.u.x * (t - src.mid), y: line.start.y + g.u.y * (t - src.mid) };
      const e1 = { x: s1.x + g.u.x * src.length, y: s1.y + g.u.y * src.length };
      this.transformTrees(q, [wall], stretchOnto(src.line.start, src.line.end, s1, e1), true);
      this.placeWall(q, wall, { start: line.start, end: readWall(q.cur(wall.index))!.end }, { start: cuts.start! });
      this.placeWall(q, wall, { start: line.start, end: line.end }, { end: cuts.end! });
      // then the old one goes
      q.remove(r.index, subtreeEnd(r));
      this.refitGroups(q, [r]);
      this.commit(q, "objects", [wallId, nid]);
      // its top and bottom this wall's: the door and opening keep their height above the bottom
      this.setWallHeights(nid, line.bottom - ground, line.top - ground);
      this.adoptRecords(this.object(nid), own);
      // what lay between the copy's ends still does, and only that: the opening, clear of the ends
      const after = this.wallLayout(this.plan(), this.object(nid));
      const between = after.points.filter((x) => after.pointSide(after.along(x)) === "between").length;
      if (after.between.length !== 1 || between !== src.inner) throw new Error("it lies too near the wall's end to be placed there yet");
      return { wall: nid, insert: did };
    });
  }

  /**
   * Slides `o`, set in a straight wall, along it by as much of (dx, dy) as runs along the wall's
   * line, with its opening: the wall's points between its ends within OPENING_TRIM of o's drawing
   * go with it. Throws when the opening can't be told apart from the rest (another door or window,
   * or a wall meeting the side, within OPENING_TRIM of it, or o at the wall's end), and when it would
   * reach the wall's end, another door or window, or a wall meeting the side. Run it in a batch: it
   * checks what it made once made, throwing to undo it.
   */
  private slideWallInsert(o: Rec, dx: number, dy: number): void {
    const wall = o.parent!;
    if (!wallPlan(wall)) throw new Error("a door or window slides only along a straight wall yet");
    const p = this.plan();
    const g = this.wallLayout(p, wall);
    const d = dx * g.u.x + dy * g.u.y;
    if (Math.abs(d) < 1e-9) return;
    const span = g.between.find((x) => x.o === o);
    if (!span) throw new Error("a door or window at the end of its wall can't slide along it yet");
    const lo = span.a0 - OPENING_TRIM;
    const hi = span.a1 + OPENING_TRIM;
    if (g.spans.some((x) => x !== span && x.a1 > lo && x.a0 < hi)) throw new Error("another door or window lies too near this one to tell their openings apart");
    const tees = this.wallTees(p, wall).map((t) => {
      const m = this.wallLayout(p, t.wall);
      const a = m.points.filter((q) => m.pointSide(m.along(q)) === t.end).map(g.along);
      return { a0: Math.min(...a), a1: Math.max(...a) };
    });
    if (tees.some((t) => t.a1 > lo && t.a0 < hi)) throw new Error("a wall meets this one too near the door or window to tell its opening apart");
    // the opening, and how far the wall's other points leave it to go either way
    const inOpening = (a: number): boolean => g.pointSide(a) === "between" && a >= lo && a <= hi;
    let c0 = span.a0;
    let c1 = span.a1;
    let behind = -Infinity;
    let ahead = Infinity;
    let inner = 0;
    for (const q of g.points) {
      const a = g.along(q);
      if (inOpening(a)) {
        c0 = Math.min(c0, a);
        c1 = Math.max(c1, a);
        inner++;
      } else if (a >= lo && a <= hi) {
        throw new Error("a door or window this near the wall's end can't slide along it yet");
      } else if (a < span.a0) behind = Math.max(behind, a);
      else ahead = Math.min(ahead, a);
    }
    for (const x of [...g.spans.filter((s) => s !== span), ...tees]) {
      if (x.a1 <= span.a0) behind = Math.max(behind, x.a1);
      else ahead = Math.min(ahead, x.a0);
    }
    if (!(c0 + d > behind + OPENING_CLEAR && c1 + d < ahead - OPENING_CLEAR)) {
      throw new Error("there's no room to slide it that far: it would reach the wall's end, another door or window, or a wall meeting this one");
    }
    const move = { x: g.u.x * d, y: g.u.y * d };
    this.reshapeWall(p, wall, g.parts, (q) => (inOpening(g.along(q)) ? { x: q.x + move.x, y: q.y + move.y } : q));
    this.translate(p, o, move.x, move.y);
    this.refitGroups(p, [o]);
    this.commit(p, "objects", [guidOf(o), guidOf(wall)]);
    // the opening went whole: its points still lie between the ends (none taken for an end's)
    const after = this.wallLayout(this.plan(), this.object(guidOf(wall)));
    const moved = after.between.some((x) => x.o.index === this.object(guidOf(o)).index);
    let left = 0;
    for (const q of after.points) {
      const a = after.along(q);
      if (after.pointSide(a) === "between" && a >= c0 + d - WALL_END_TOLERANCE && a <= c1 + d + WALL_END_TOLERANCE) left++;
    }
    if (!moved || left !== inner) throw new Error("that would take the door or window too near the wall's end");
  }

  /**
   * Gives `r` the attached records `own` (another object's, as they are) in place of its own: a
   * record of a format both have takes own's values, and the formats only one has are added or
   * dropped.
   */
  private adoptRecords(r: Rec, own: readonly Rec[]): void {
    const p = this.plan();
    const mine = r.children.slice(0, auxCount(r)).filter((c) => c.type === RECORD);
    const formats = new Set(own.map((c) => recordFormat(c.data)));
    for (const c of own) {
      const at = mine.find((x) => recordFormat(x.data) === recordFormat(c.data));
      if (at) p.set(at.index, concat([p.cur(at.index).subarray(0, 0x50), c.data.subarray(0x50)]));
      else this.addAux(p, r, this.newAux(RECORD, c.data.subarray(0x50)), DROP_SHADOW);
    }
    this.commit(p, "objects", [guidOf(r)]);
    // one at a time: each drop reads the aux list as the last left it
    for (const c of mine) {
      if (formats.has(recordFormat(c.data))) continue;
      const q = this.plan();
      if (this.dropRecord(q, this.object(guidOf(r)), recordFormat(c.data))) this.commit(q, "objects", [guidOf(r)]);
    }
  }

  /**
   * What a wall holds, below it: its plan drawing (lines, polygons, polylines, loci, on it or in
   * groups), its groups of bodies and its solid additions with their bodies (in the drawing's
   * coordinates, whatever the solid's frame: a move offsets it), and the aux records and list ends
   * among them, which its ends and heights leave as they are; and apart, the doors, windows and
   * other plug-in objects and symbols set in it, which move whole, their drawing in their own
   * frame. Throws for a wall holding anything else.
   */
  private wallParts(r: Rec): { parts: Rec[]; inserts: Rec[] } {
    const parts: Rec[] = [];
    const inserts: Rec[] = [];
    const inside = new Set<Rec>();
    for (const o of r.walk()) {
      if (o === r || inside.has(o)) continue;
      if (o.type === PLUGIN || o.type === SYMBOL_INSTANCE) {
        if (o.parent !== r) throw new Error("a wall holding doors, windows or symbols in its groups can't be changed this way yet");
        inserts.push(o);
        for (const c of o.walk()) inside.add(c);
        continue;
      }
      parts.push(o);
      // its group of bodies and its solid additions' bodies are aux records
      if (o.type === 0 || !o.parent || o.parent.children.indexOf(o) < auxCount(o.parent)) continue;
      const ok =
        o.type === 11 ||
        (WALL_DRAWING.has(o.type) && (o.parent === r || o.parent.type === 11)) ||
        (o.type === SOLID && o.parent === r) ||
        (o.type === BODY && (o.parent.type === 11 || o.parent.type === SOLID));
      if (!ok) throw new Error(`a wall holding ${typeLabel(o.type)} objects can't be changed this way yet`);
    }
    return { parts, inserts };
  }

  /**
   * Where a door, window or other object set in a wall lies in plan: the corners of the box round
   * its plan drawing (a symbol's definition's) through its placement, or its placement alone. Its stored box isn't
   * where it lies (a plug-in's often holds its own frame's), nor are its groups' and 3D objects'
   * (the demos' doors' reach metres past them), and a 3D object's profile is in its own frame.
   */
  private insertCorners(p: Plan, o: Rec): Pt[] {
    const d = p.cur(o.index);
    const m = o.type === PLUGIN ? readPluginMatrix(d) : readInstanceMatrix(d);
    const def = o.type === SYMBOL_INSTANCE ? this.doc.symbols.get(u16(d, 0x8e)) : o;
    const boxes: BBox[] = [];
    const add = (g: Rec): void => {
      for (const c of objectChildren(g)) {
        if (c.type === 11) add(c);
        else if (PLAN_DRAWING.has(c.type)) boxes.push(...[readBBox(p.cur(c.index))].filter((x) => !!x));
      }
    };
    if (def) add(def);
    const b = boxes.reduce<BBox | null>(unionBox, null);
    return b ? [b.x0, b.x1].flatMap((x) => [b.y0, b.y1].map((y) => applyAffine(m, { x, y }))) : [{ x: m.e, y: m.f }];
  }

  /**
   * Moves each point of a wall's drawing and bodies (its parts, apart from what is set in it)
   * through f, and fits the plan boxes of what holds them that were theirs: its groups', its solid
   * additions' and its own. The demos' walls mostly keep others (a 2023 wall's box is never its drawing's, often far off it, and its group's
   * and solid additions' seldom their bodies'; a 2026 wall's is unbounded), left as they were.
   */
  private reshapeWall(p: Plan, wall: Rec, parts: readonly Rec[], f: (q: Pt) => Pt): void {
    const same = (a: BBox | null, b: BBox | null): boolean =>
      !!a && !!b && [a.x0 - b.x0, a.y0 - b.y0, a.x1 - b.x1, a.y1 - b.y1].every((v) => Math.abs(v) <= WALL_END_TOLERANCE);
    // the plan box of the drawing and bodies a group or solid addition holds, however deep
    const held = (o: Rec): BBox | null => {
      let b: BBox | null = null;
      for (const c of o.walk()) {
        if (c.type === BODY) b = unionBox(b, bodyPlanBox(p.cur(c.index)));
        else if (WALL_DRAWING.has(c.type)) b = unionBox(b, readBBox(p.cur(c.index)));
      }
      return b;
    };
    // what fitted what it holds, before that moves
    const fitted = parts.filter((o) => (o.type === 11 || o.type === SOLID) && same(readBBox(p.cur(o.index)), held(o)));
    let was: BBox | null = null;
    let box: BBox | null = null;
    for (const o of parts) {
      const cur = p.cur(o.index);
      const d = reshapeRecord(cur, o.type, f);
      if (!d) continue;
      p.set(o.index, d);
      was = unionBox(was, o.type === BODY ? bodyPlanBox(cur) : readBBox(cur));
      box = unionBox(box, o.type === BODY ? bodyPlanBox(d) : readBBox(d));
    }
    for (const o of fitted) {
      const fit = held(o);
      if (!fit) continue;
      const d = p.cur(o.index).slice();
      fitPlanBoxes(d, fit);
      p.set(o.index, d);
    }
    if (box && same(readBBox(p.cur(wall.index)), was)) {
      const d = p.cur(wall.index).slice();
      writeBBox(d, box);
      p.set(wall.index, d);
    }
  }

  setCameraView(id: string, eye: Vec3, target: Vec3): void {
    const r = this.object(id);
    const cam = this.cameraParams(r);
    if (!cam) throw new Error("that object isn't a Renderworks camera");
    if (![...eye, ...target].every(Number.isFinite)) throw new Error("a camera's eye and look-to point are finite numbers");
    const along = Math.hypot(target[0] - eye[0], target[1] - eye[1]);
    if (!(along > 1)) throw new Error("a camera can't look straight up or down");
    const p = this.plan();
    const d = p.cur(r.index).slice();
    if (d.length < PLUGIN_MATRIX + 96) throw new Error("this camera's record is too short to change");
    // its matrix stands at the eye in plan, turned to the look-to point; its drawing turns with it
    const cos = (target[0] - eye[0]) / along;
    const sin = (target[1] - eye[1]) / along;
    const put = (row: number, col: number, v: number): void => setF64(d, PLUGIN_MATRIX + 24 * row + 8 * col, v);
    put(0, 0, cos);
    put(0, 1, sin);
    put(1, 0, -sin);
    put(1, 1, cos);
    put(3, 0, eye[0]);
    put(3, 1, eye[1]);
    // its plan box is its drawing's, as the matrix now places it
    const m = readPluginMatrix(d);
    let box: BBox | null = null;
    for (const c of objectChildren(r)) {
      const b = readBBox(c.data);
      if (!b) continue;
      for (const pt of [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x0, y: b.y1 }, { x: b.x1, y: b.y1 }]) {
        const q = applyAffine(m, pt);
        box = unionBox(box, { x0: q.x, y0: q.y, x1: q.x, y1: q.y });
      }
    }
    if (box) writeBBox(d, box);
    p.set(r.index, d);
    const z = f64(d, PLUGIN_MATRIX + 88);
    this.writeCameraParams(p, cam, (get) => {
      const before = get("LineLength");
      // the handles along its view lines keep their share of the distance to the look-to point
      const handles = ["ControlPoint01X", "ControlPoint01Y", "ControlPoint02X", "ControlPoint02Y"];
      const scaled = before && before > 0 ? Object.fromEntries(handles.map((n) => [n, ((get(n) ?? 0) * along) / before])) : {};
      return {
        __Point3DCameraX: eye[0],
        __Point3DCameraY: eye[1],
        __Point3DCameraZ: eye[2],
        __Point3DLookToX: target[0],
        __Point3DLookToY: target[1],
        __Point3DLookToZ: target[2],
        CameraZPos: eye[2] - z,
        LookToZPos: target[2] - z,
        LineLength: along,
        ...scaled,
      };
    });
    this.refitGroups(p, [r]);
    this.commit(p, "objects", [id]);
  }

  setClassTextStyle(index: number, style: number): void {
    const rec = this.doc.classRecs.get(index);
    if (!rec) throw new Error(`no class #${index}`);
    if (rec.data.length < CLASS_TEXT_STYLE + 4) throw new Error("this class's record has no text style field");
    if (style !== 0) this.resource(TEXT_STYLE_TYPE, style, "text style");
    if (i32(rec.data, CLASS_TEXT_STYLE) === style) return;
    const p = this.plan();
    setI32(p.mut(rec.index), CLASS_TEXT_STYLE, style);
    this.commit(p, "all", []);
  }

  // ---- objects ------------------------------------------------------------------------

  addObject(layerId: string, shape: NewShape, classIndex?: number, attrs?: Partial<Attributes>): string {
    return this.addObjects(layerId, [shape], classIndex, attrs)[0];
  }

  templateAttributes(kind: NewShape["kind"]): Attributes | null {
    const t = Object.hasOwn(TYPE_OF_KIND, kind) ? this.templates.get(TYPE_OF_KIND[kind]) : undefined;
    return t ? readAttrs(t.recs[0]) : null;
  }

  addObjects(layerId: string, shapes: readonly NewShape[], classIndex?: number, attrs?: Partial<Attributes> | readonly (Partial<Attributes> | undefined)[]): string[] {
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}: classes are numbered as doc.classes() lists them ("None" is #${this.noneClass()})`);
    if (shapes.length === 0) return [];
    for (const shape of shapes) {
      if (!Object.hasOwn(TYPE_OF_KIND, shape?.kind)) {
        throw new Error(`no shape kind "${String(shape?.kind)}": NewShape kinds are ${Object.keys(TYPE_OF_KIND).join(", ")} (a circle is an arc with sweepAngle 360, an ellipse one with radiusY too)`);
      }
    }
    const { owner, at } = this.slot(layer);
    const elevation = layerElevationOf(layer);
    const block: Uint8Array[] = [];
    const roots: Uint8Array[] = [];
    for (const [i, shape] of shapes.entries()) {
      const recs = this.instantiate(this.template(TYPE_OF_KIND[shape.kind]), owner);
      const d = writeGeometry(recs[0], shape);
      // a light's height is above the layer (2D shapes have none)
      liftRecord(d, TYPE_OF_KIND[shape.kind], elevation);
      setU16(d, 0x1a, 0);
      setU32(d, 0x20, cls);
      // one set of attributes for all, or one per shape
      const a = Array.isArray(attrs) ? (attrs as readonly (Partial<Attributes> | undefined)[])[i] : (attrs as Partial<Attributes> | undefined);
      if (a) writeAttrs(d, a);
      recs[0] = d;
      block.push(...recs);
      roots.push(d);
    }
    const p = this.plan();
    p.insert(at, block);
    this.refitGroups(p, [], new Map([[layer, roots]]));
    const ids = roots.map((d) => recOfData(d).guid);
    this.commit(p, "objects", ids);
    return ids;
  }

  canAdd(kind: NewShape["kind"]): boolean {
    return this.templates.has(TYPE_OF_KIND[kind]);
  }

  insertSymbol(layerId: string, symbol: number, at: Pt, classIndex?: number): string {
    const layer = this.container(layerId);
    if (!this.doc.symbols.has(symbol)) throw new Error(`no symbol #${symbol}`);
    if (layer.type === 16 && (layer.nameIndex === symbol || this.holdsSymbol(symbol, layer.nameIndex))) {
      throw new Error("a symbol can't be placed inside itself");
    }
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error("point is not a finite number");
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    const { owner, at: slotAt } = this.slot(layer);
    const recs = this.instantiate(this.template(SYMBOL_INSTANCE), owner);
    const d = recs[0];
    setU16(d, 0x1a, 0);
    setU32(d, 0x20, cls);
    setU16(d, 0x8e, symbol);
    writePlacement(d, at);
    // on the layer, at its elevation
    liftRecord(d, SYMBOL_INSTANCE, layerElevationOf(layer));
    // an instance's bounds are its contents' stored bounds, placed
    let box: BBox | null = null;
    for (const c of objectChildren(this.doc.symbols.get(symbol)!)) box = unionBox(box, readBBox(c.data));
    if (!box) for (const s of this.doc.symbolShapes(symbol)) box = unionBox(box, s.bbox);
    if (box) writeBBox(d, { x0: box.x0 + at.x, y0: box.y0 + at.y, x1: box.x1 + at.x, y1: box.y1 + at.y });
    const p = this.plan();
    p.insert(slotAt, recs);
    this.refitGroups(p, [], new Map([[layer, [d]]]));
    const id = recOfData(d).guid;
    this.commit(p, "objects", [id]);
    return id;
  }

  replaceSymbol(ids: string[], symbol: number): void {
    if (!this.doc.symbols.has(symbol)) throw new Error(`no symbol #${symbol}`);
    let box: BBox | null = null;
    for (const s of this.doc.symbolShapes(symbol)) box = unionBox(box, s.bbox);
    const p = this.plan();
    const recs: Rec[] = [];
    for (const id of new Set(ids)) {
      const r = this.object(id);
      if (r.type !== SYMBOL_INSTANCE) throw new Error(`${r.typeName} is not a symbol`);
      const d = p.mut(r.index);
      setU16(d, 0x8e, symbol);
      // the cached bounds follow the new definition through the instance's placement
      if (box) {
        const m = readInstanceMatrix(d);
        const corners = [
          { x: box.x0, y: box.y0 },
          { x: box.x1, y: box.y0 },
          { x: box.x1, y: box.y1 },
          { x: box.x0, y: box.y1 },
        ].map((q) => applyAffine(m, q));
        writeBBox(d, bboxOfPoints(corners)!);
      }
      recs.push(r);
    }
    this.refitGroups(p, recs);
    this.commit(p, "objects", ids);
  }

  simplifyPolys(ids: readonly string[], by: SimplifyBy, tolerance: number): { objects: number; removed: number } {
    if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("the deviation or distance is a length of 0 or more");
    const recs = this.topmost([...ids], true).filter((r) => SIMPLIFIABLE.has(r.type));
    if (!recs.length) throw new Error("Simplify Polys works on polygons, polylines and 3D polygons");
    const p = this.plan();
    const changed: Rec[] = [];
    let removed = 0;
    for (const r of recs) {
      const s = simplifiedRecord(r, by, tolerance);
      if (!s) continue;
      p.set(r.index, s.data);
      changed.push(r);
      removed += s.removed;
    }
    if (!changed.length) return { objects: 0, removed: 0 };
    this.refitGroups(p, changed);
    this.commit(p, "objects", changed.map((r) => guidOf(r)));
    return { objects: changed.length, removed };
  }

  replaceObjects(ids: string[], shapes: NewShape[]): string[] {
    const recs = this.topmost(ids).sort((a, b) => a.index - b.index);
    if (!recs.length) throw new Error("nothing to replace");
    if (!shapes.length) throw new Error("no shapes to replace them with");
    // one marked object reshaped keeps its arrowheads (which piece of several would take which end isn't clear)
    const markers = recs.length === 1 && shapes.length === 1 && MARKED_TYPES.has(TYPE_OF_KIND[shapes[0].kind]) ? readMarkers(recs[0]) : null;
    if (markers) {
      return this.batch(() => {
        const out = this.replaceShapes(recs, shapes);
        this.setLineMarkers(out, markers);
        return out;
      });
    }
    return this.replaceShapes(recs, shapes);
  }

  private replaceShapes(recs: Rec[], shapes: NewShape[]): string[] {
    const first = recs[0];
    if (!first.parent) throw new Error(`${first.typeName} can't be replaced`);
    const drawable = Object.values(TYPE_OF_KIND).includes(first.type);
    const p = this.plan();
    const block: Uint8Array[] = [];
    const roots: Uint8Array[] = [];
    const out: string[] = [];
    const elevation = layerElevationOf(first);
    shapes.forEach((shape, i) => {
      const made = this.instantiate(this.template(TYPE_OF_KIND[shape.kind]), first.owner);
      const d = writeGeometry(made[0], shape);
      // a light's height is above the layer (2D shapes have none)
      liftRecord(d, TYPE_OF_KIND[shape.kind], elevation);
      setU16(d, 0x1a, 0);
      setU32(d, 0x20, first.classIndex);
      if (drawable) d.set(first.data.subarray(0x50, ATTR_END), 0x50);
      if (i === 0) d.set(first.data.subarray(0x38, 0x48), 0x38); // the first piece is the same object
      if (i === shapes.length - 1 && !first.hasNext) setNext(d, false);
      made[0] = d;
      block.push(...made);
      roots.push(d);
      out.push(recOfData(d).guid);
    });
    for (const r of recs) p.remove(r.index, subtreeEnd(r));
    p.insert(first.index, block);
    this.refitGroups(p, recs, new Map([[first.parent, roots]]));
    this.commit(p, "objects", out);
    return out;
  }

  createSymbol(ids: string[], name: string, insertion?: Pt): string {
    if (!this.doc.recs.some((r) => r.type === 54)) {
      return this.batch(() => {
        this.addSymbolLibrary();
        return this.createSymbol(ids, name, insertion);
      });
    }
    this.checkName(name);
    const recs = this.topmost(ids).sort((a, b) => a.index - b.index);
    if (!recs.length) throw new Error("select the objects to make a symbol from");
    const first = recs[0];
    const parent = first.parent;
    if (!parent || recs.some((r) => r.parent !== parent)) {
      throw new Error("objects for a symbol must be in the same layer or group");
    }
    for (const r of recs) {
      for (const o of movedWalk(r)) {
        if (!SYMBOL_PARTS.has(o.type)) throw new Error(`${typeLabel(o.type)} objects can't go into a symbol yet`);
      }
    }
    let box: BBox | null = null;
    for (const r of recs) box = unionBox(box, this.planBox(r));
    if (!box) throw new Error("these objects have no extent");
    const at = insertion ?? { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    if (!Number.isFinite(at.x) || !Number.isFinite(at.y)) throw new Error("insertion point is not a finite number");

    // new definitions go at the top level of the resource library, cloned from one already there
    const { tpl, sibling } = this.symbolTemplate();
    const shell = this.instantiate(tpl ? this.shellOf(tpl) : symbolDefinitionTemplate(), sibling.owner);
    const def = shell[0];
    const term = shell[shell.length - 1];
    const inner = u64(term, 0x26);
    const index = this.freshName();
    setU16(def, 0x1a, index);
    writeBBox(def, { x0: box.x0 - at.x, y0: box.y0 - at.y, x1: box.x1 - at.x, y1: box.y1 - at.y });

    // the definition holds them at their heights above the layer, and the instance stands at its elevation
    const z = layerElevationOf(parent);
    const p = this.plan();
    const moved: Uint8Array[] = [];
    for (const r of recs) {
      this.translate(p, r, -at.x, -at.y);
      this.lift(p, r, -z);
      const end = subtreeEnd(r);
      const root = p.cur(r.index).slice();
      setOwner(root, inner);
      setNext(root, true);
      moved.push(root);
      for (let i = r.index + 1; i <= end; i++) moved.push(p.cur(i));
      p.remove(r.index, end);
    }
    const names = new Map(this.doc.names);
    names.set(index, name);
    this.writeNames(p, names);
    p.insert(sibling.index, [...shell.slice(0, -1), ...moved, term]);

    // an instance takes the objects' place, on top of where the last one was
    const [inst, ...instAux] = this.instantiate(this.template(SYMBOL_INSTANCE), first.owner);
    setU16(inst, 0x1a, 0);
    const classes = new Set(recs.map((r) => r.classIndex));
    setU32(inst, 0x20, classes.size === 1 ? first.classIndex : this.noneClass());
    setU16(inst, 0x8e, index);
    writePlacement(inst, at);
    liftRecord(inst, SYMBOL_INSTANCE, z);
    writeBBox(inst, box);
    const last = recs[recs.length - 1];
    if (!last.hasNext) setNext(inst, false);
    p.insert(subtreeEnd(last) + 1, [inst, ...instAux]);
    this.refitGroups(p, recs, new Map([[parent, [inst]]]));
    const id = recOfData(inst).guid;
    this.commit(p, "all", [id]);
    return id;
  }

  setFillMapping(id: string, map: FillMapping): void {
    const r = this.object(id);
    const points = [map.origin, map.u, map.v];
    if (!points.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y))) throw new Error("point is not a finite number");
    const p = this.plan();
    const own = r.children.find((c) => c.type === FILL_MAPPING);
    if (own) {
      writeFillMapping(p.mut(own.index), points, map.shape);
    } else {
      // a new mapping goes first among the object's aux records, as the file's own do
      const tpl = this.doc.recs.find((x) => x.type === FILL_MAPPING);
      if (!tpl) throw new Error("this file has no fill mapping to copy yet");
      const first = r.children[0];
      if (!first) throw new Error(`${typeLabel(r.type)} objects can't take a fill mapping yet`);
      const [d] = this.instantiate(templateOf(tpl), first.owner);
      writeFillMapping(d, points, map.shape);
      setNext(d, true);
      p.insert(first.index, [d]);
    }
    this.commit(p, "objects", [id]);
  }

  setWorksheetCell(index: number, row: number, col: number, value: string | number): void {
    const rec = this.doc.worksheets.get(index);
    if (!rec) throw new Error(`no worksheet #${index}`);
    const p = this.plan();
    p.set(rec.index, writeWorksheetCell(p.cur(rec.index), row, col, value));
    // the sheets' worksheet images draw from it
    this.commit(p, "all");
  }

  createWorksheet(sheet: NewWorksheet, from?: number): number {
    const src = from === undefined ? [...this.doc.worksheets.values()].sort((a, b) => a.index - b.index)[0] : this.doc.worksheets.get(from);
    if (!src) throw new Error(from === undefined ? "this drawing has no worksheet to copy settings from yet" : `no worksheet #${from}`);
    this.checkName(sheet.name);
    // its children but the database blocks, which list objects for the source's database rows
    const t = templateOf(src, (r, depth) => depth === 1 && r.type === DATABASE_BLOCK);
    t.recs[0] = newWorksheetRecord(src.data, sheet);
    const copies = this.instantiate(t, src.owner);
    const fresh = this.freshName();
    setU16(copies[0], 0x1a, fresh);
    const names = new Map(this.doc.names);
    names.set(fresh, sheet.name);
    const p = this.plan();
    this.writeNames(p, names);
    // before the original, so the copy is never the last of its list
    p.insert(src.index, copies);
    this.commit(p, "all", []);
    return fresh;
  }

  // ---- resources ----------------------------------------------------------------------

  /** How many records other than the name table hold `name` as text, as plug-ins, worksheets and data visualisations name resources. */
  private namedIn(name: string, own?: Rec): number {
    const text = encodeUtf16(name);
    // the records of `own`'s subtree go with it, so what they say doesn't count
    const [from, to] = own ? [own.index, subtreeEnd(own)] : [-1, -2];
    return this.doc.recs.filter((r) => r.type !== 55 && !(r.index >= from && r.index <= to) && holdsText(r.data, text)).length;
  }

  /** Throws when a record other than the name table (and `own`'s subtree, deleted with it) holds `name` as text. */
  private refuseNamed(name: string, doing: string, own?: Rec): void {
    const n = this.namedIn(name, own);
    if (n === 0) return;
    const what = n === 1 ? "another record names" : `${n} other records name`;
    throw new Error(`${what} "${name}" as text (as plug-in parameters, worksheet formulas and data visualizations name resources), and ${doing} it here wouldn't update ${n === 1 ? "it" : "them"}`);
  }

  renameResource(index: number, name: string): void {
    const old = this.doc.names.get(index);
    const res = this.doc.recs.find((r) => r.nameIndex === index && RESOURCE_TYPES.has(r.type));
    if (old === undefined || !res) throw new Error(`no resource #${index}`);
    if (old === name) return;
    if (res.type === RECORD_FORMAT && readFormat(res.data).parametric) {
      throw new Error(`"${old}" holds a plug-in's parameters and is named after the plug-in, so it can't be renamed`);
    }
    this.checkName(name, undefined, index);
    this.refuseNamed(old, "renaming");
    const names = new Map(this.doc.names);
    names.set(index, name);
    const p = this.plan();
    this.writeNames(p, names);
    this.commit(p, "all", []);
  }

  renameMany(renames: readonly Rename[]): void {
    const names = new Map(this.doc.names);
    const layerNames = new Map(this.doc.layerRecs.map((l) => [l, this.doc.layerName(l)] as const));
    const layers = new Map<Rec, Uint8Array>();
    const levels = new Map<string, string>();
    const changed: string[] = [];
    const ids: string[] = [];
    for (const r of renames) {
      if (!r.name.trim()) throw new Error("name cannot be empty");
      if (r.kind === "layer") {
        const l = this.layer(r.id);
        const d = this.layerRenamed(l, r.name, r.title);
        const old = layerNames.get(l)!;
        if (!d) continue;
        layers.set(l, d);
        ids.push(r.id);
        if (r.name === old) continue;
        layerNames.set(l, r.name);
        changed.push(r.name);
        if (l.data[layerKindAt(l.data)] !== 2) levels.set(old, r.name);
        continue;
      }
      const old = this.doc.names.get(r.index);
      if (r.kind === "class") {
        if (!this.doc.classRecs.has(r.index)) throw new Error(`no class #${r.index}`);
        if (r.index === this.noneClass()) throw new Error('the "None" class can\'t be renamed');
      } else if (r.kind === "story") {
        this.story(r.index);
      } else {
        const res = this.doc.recs.find((x) => x.nameIndex === r.index && RESOURCE_TYPES.has(x.type));
        if (old === undefined || !res) throw new Error(`no resource #${r.index}`);
        if (old !== r.name && res.type === RECORD_FORMAT && readFormat(res.data).parametric) {
          throw new Error(`"${old}" holds a plug-in's parameters and is named after the plug-in, so it can't be renamed`);
        }
      }
      if (old === r.name) continue;
      // data visualisations test a story by its name, and plug-ins and worksheets name resources
      if (old !== undefined && r.kind !== "class") this.refuseNamed(old, "renaming");
      names.set(r.index, r.name);
      changed.push(r.name);
    }
    if (!layers.size && !changed.length) return;
    // names are checked once all are in place, so names can swap or move along a chain
    const uses = new Map<string, number>();
    for (const n of [...names.values(), ...layerNames.values()]) uses.set(n, (uses.get(n) ?? 0) + 1);
    for (const n of changed) if ((uses.get(n) ?? 0) > 1) throw new Error(`"${n}" is already used in this document`);
    const p = this.plan();
    if ([...names].some(([i, n]) => this.doc.names.get(i) !== n)) this.writeNames(p, names);
    for (const [l, d] of layers) p.set(l.index, d);
    if (levels.size) this.renameStoryLevels(p, levels);
    this.commit(p, "all", ids);
  }

  duplicateSymbol(index: number, name: string): number {
    const def = this.doc.symbols.get(index);
    if (!def) throw new Error(`no symbol definition #${index}`);
    this.checkName(name);
    const copies = this.instantiate(templateOf(def), def.owner);
    // object names are unique: the objects inside the copy are unnamed
    const objects = new Set(objectWalk(def));
    let i = 0;
    for (const src of def.walk()) {
      if (src !== def && objects.has(src)) setU16(copies[i], 0x1a, 0);
      i++;
    }
    const fresh = this.freshName();
    setU16(copies[0], 0x1a, fresh);
    const names = new Map(this.doc.names);
    names.set(fresh, name);
    const p = this.plan();
    this.writeNames(p, names);
    // before the original, so the copy is never the last of its list
    p.insert(def.index, copies);
    this.commit(p, "all", []);
    return fresh;
  }

  deleteSymbol(index: number): void {
    const def = this.doc.symbols.get(index);
    if (!def) throw new Error(`no symbol definition #${index}`);
    const name = this.doc.names.get(index) ?? `Symbol ${index}`;
    const placed = this.doc.recs.filter((r) => r.type === SYMBOL_INSTANCE && u16(r.data, 0x8e) === index).length;
    if (placed) throw new Error(`"${name}" is placed ${placed === 1 ? "once" : `${placed} times`}; delete its instances first`);
    this.refuseNamed(name, "deleting");
    const p = this.plan();
    this.removeResource(p, def, index);
    this.commit(p, "all", []);
  }

  // ---- purge --------------------------------------------------------------------------

  purgeable(): Purgeable {
    return { symbols: this.unusedSymbols(), classes: this.unusedClasses(), duplicates: this.coincidentDuplicates() };
  }

  purge(kinds: readonly PurgeKind[]): Purgeable {
    const done: Purgeable = { symbols: [], classes: [], duplicates: [] };
    // a class only purged definitions used is unused once they go: purge until a pass finds nothing
    this.batch(() => {
      for (let pass = 0; pass < 16; pass++) {
        const step = this.purgeOnce(kinds);
        if (!step) break;
        done.symbols.push(...step.symbols);
        done.classes.push(...step.classes);
        done.duplicates.push(...step.duplicates);
      }
    });
    return done;
  }

  /** One pass of purge(); null when it found nothing to remove. */
  private purgeOnce(kinds: readonly PurgeKind[]): Purgeable | null {
    const found = this.purgeable();
    const done: Purgeable = {
      symbols: kinds.includes("symbols") ? found.symbols : [],
      classes: kinds.includes("classes") ? found.classes : [],
      duplicates: kinds.includes("duplicates") ? found.duplicates : [],
    };
    const gone = [
      ...done.symbols.map((i) => this.doc.symbols.get(i)),
      ...done.classes.map((i) => this.doc.classRecs.get(i)),
    ].filter((r): r is Rec => r !== undefined);
    const dupes = this.topmost(done.duplicates);
    if (!gone.length && !dupes.length) return null;
    const p = this.plan();
    const names = new Map(this.doc.names);
    for (const r of gone) {
      p.remove(r.index, subtreeEnd(r));
      names.delete(r.nameIndex);
    }
    // the last of a list hands its end marker to the nearest earlier item that stays
    for (const r of gone) {
      if (r.hasNext) continue;
      const siblings = r.parent?.children ?? [];
      let i = siblings.indexOf(r) - 1;
      while (i >= 0 && p.isRemoved(siblings[i].index)) i--;
      if (i >= 0 && siblings[i].hasNext) setNext(p.mut(siblings[i].index), false);
    }
    for (const r of dupes) p.remove(r.index, subtreeEnd(r));
    this.refitGroups(p, dupes);
    if (gone.length) this.writeNames(p, names);
    this.commit(p, gone.length ? "all" : "objects", done.duplicates);
    return done;
  }

  /** Definitions placed nowhere but inside other unused definitions, that no record names as text. */
  private unusedSymbols(): number[] {
    // the definitions placed inside each definition, and those placed outside any (null)
    const inside = new Map<number | null, Set<number>>();
    for (const r of this.doc.recs) {
      if (r.type !== SYMBOL_INSTANCE) continue;
      let host: number | null = null;
      for (let p = r.parent; p; p = p.parent) {
        if (p.type === 16) {
          host = p.nameIndex;
          break;
        }
      }
      const set = inside.get(host) ?? new Set<number>();
      set.add(u16(r.data, 0x8e));
      inside.set(host, set);
    }
    const used = new Set<number>();
    const queue = [...this.doc.symbols.keys()].filter(
      (i) => inside.get(null)?.has(i) || this.namedIn(this.doc.names.get(i) ?? "") > 0,
    );
    for (let i = queue.pop(); i !== undefined; i = queue.pop()) {
      if (used.has(i)) continue;
      used.add(i);
      for (const j of inside.get(i) ?? []) queue.push(j);
    }
    return [...this.doc.symbols.keys()].filter((i) => !used.has(i));
  }

  /** Classes no record, viewport or style uses and no record names as text, other than "None". */
  private unusedClasses(): number[] {
    const none = this.doc.classIndexByName(NONE_CLASS);
    const used = new Set<number>();
    for (const r of this.doc.recs) {
      if (r.type !== 94 && r.type !== 55) used.add(r.classIndex);
      if (r.type === VIEWPORT) for (const e of viewportLists(r.data)?.classes ?? []) used.add(e.name);
    }
    // where a style keeps a class isn't known: any 16-bit value in one counts as a use
    for (const style of this.doc.recs) {
      if (!STYLE_TYPES.has(style.type)) continue;
      for (const r of style.walk()) for (let o = 0x50; o + 1 < r.data.length; o++) used.add(u16(r.data, o));
    }
    return [...this.doc.classRecs.keys()].filter((i) => i !== none && !used.has(i) && this.namedIn(this.doc.names.get(i) ?? "") === 0);
  }

  /** Unnamed objects identical to an earlier one in the same layer or group; a duplicate group's contents go with it. */
  private coincidentDuplicates(): string[] {
    const out: string[] = [];
    const visit = (container: Rec): void => {
      const seen = new Map<number, Rec[]>();
      for (const c of objectChildren(container)) {
        if (c.nameIndex === 0 && MOVABLE.has(c.type)) {
          const h = contentHash(c);
          const earlier = seen.get(h) ?? [];
          if (earlier.some((e) => sameContent(e, c))) {
            out.push(c.guid);
            continue;
          }
          seen.set(h, [...earlier, c]);
        }
        if (c.type === 11) visit(c);
      }
    };
    for (const layer of this.doc.layerRecs) visit(layer);
    return out;
  }

  deleteObjects(ids: string[]): void {
    const recs = this.topmost(ids);
    if (!recs.length) return;
    const p = this.plan();
    for (const r of recs) p.remove(r.index, subtreeEnd(r));
    this.refitGroups(p, recs);
    this.freeNames(p, recs);
    this.commit(p, "objects", ids);
  }

  /** Names only these subtrees use can be given again: nothing else names itself by them. */
  private freeNames(p: Plan, gone: readonly Rec[]): void {
    const doomed = new Set<Rec>();
    const free = new Set<number>();
    const walk = (r: Rec): void => {
      doomed.add(r);
      if (r.nameIndex) free.add(r.nameIndex);
      r.children.forEach(walk);
    };
    gone.forEach(walk);
    if (!free.size) return;
    for (const r of this.doc.recs) if (!doomed.has(r)) free.delete(r.nameIndex);
    if (!free.size) return;
    const names = new Map(this.doc.names);
    for (const n of free) names.delete(n);
    this.writeNames(p, names);
  }

  /** Translate a subtree into plan buffers (all records in place). */
  private translate(p: Plan, rec: Rec, dx: number, dy: number): void {
    const recs = [...movedWalk(rec)];
    for (const r of recs) {
      if (!TRANSLATABLE.has(r.type)) throw new Error(`moving ${typeLabel(r.type)} objects isn't supported yet`);
    }
    for (const r of recs) {
      translateRecord(p.mut(r.index), r.type, dx, dy);
      this.carry(p, r, translation(dx, dy));
      this.carryCamera(p, r, translation(dx, dy));
      // a viewport's annotations and crop are on the sheet at its scale, apart from its shift
      const s = r.type === VIEWPORT ? viewportScale(r.data) : null;
      if (s !== null) this.translateOnSheet(p, r, dx * s, dy * s);
    }
  }

  /**
   * What goes with an object moved through m in plan and raised by dz: its fill mapping, and a body
   * cached in its parent's coordinates (multiple extrudes and solid additions).
   */
  private carry(p: Plan, r: Rec, m: Affine, dz = 0): void {
    for (const c of r.children) {
      if (c.type === FILL_MAPPING && !isIdentity(m)) transformFillMapping(p.mut(c.index), m);
      else if (c.type === BODY && BODY_IN_PARENT.has(r.type)) moveBodyPoints(p.mut(c.index), m, dz);
    }
  }

  /** Move a viewport's annotations and crop by (dx, dy) in their own units (sheet units times the scale). */
  private translateOnSheet(p: Plan, vp: Rec, dx: number, dy: number): void {
    for (const g of objectChildren(vp)) {
      if (!onViewportSheet(g)) continue;
      for (const r of movedWalk(g)) {
        // attached data has no coordinates: translateRecord leaves it
        translateRecord(p.mut(r.index), r.type, dx, dy);
        for (const c of r.children) if (c.type === FILL_MAPPING) transformFillMapping(p.mut(c.index), translation(dx, dy));
      }
    }
  }

  moveObjects(ids: string[], dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("offset is not a finite number");
    if (dx === 0 && dy === 0) return;
    const all = this.topmost(ids, true);
    const slides = all.filter(isWallInsert);
    if (slides.length) {
      this.batch(() => {
        const rest = all.filter((r) => !isWallInsert(r));
        if (rest.length) this.moveObjects(rest.map(guidOf), dx, dy);
        // each along its wall by as much of the move as runs along it, the one furthest ahead first
        const p0 = this.plan();
        const ahead = (o: Rec): number => this.insertCorners(p0, o).reduce((m, q) => m + q.x * dx + q.y * dy, 0);
        const order = slides.map((o) => this.object(guidOf(o))).map((o) => ({ id: guidOf(o), at: ahead(o) }));
        for (const { id } of order.sort((a, b) => b.at - a.at)) this.slideWallInsert(this.object(id), dx, dy);
      });
      return;
    }
    const recs = all;
    const p = this.plan();
    // the walls mitred to a wall that moves follow it
    const follow = this.wallFollowers(p, recs.filter((r) => r.type === WALL));
    for (const r of recs) this.translate(p, r, dx, dy);
    const followed = follow().filter((w) => !recs.includes(w));
    this.refitGroups(p, [...recs, ...followed]);
    this.commit(p, "objects", [...ids, ...followed.map(guidOf)]);
  }

  moveObjects3D(ids: string[], dx: number, dy: number, dz: number): boolean {
    if (!Number.isFinite(dz)) throw new Error("offset is not a finite number");
    return this.batch(() => {
      this.moveObjects(ids, dx, dy);
      if (dz === 0) return true;
      this.liftObjects(ids, dz);
      return this.topmost(ids).some((r) => r.type === PLUGIN || r.type === LIGHT || this.shows3D(r));
    });
  }

  unrotateObjects3D(ids: string[]): string[] {
    const p = this.plan();
    const done: Rec[] = [];
    // a door or window set in a wall keeps its wall's turn
    for (const r of this.topmost(ids, true).filter((o) => !isWallInsert(o))) {
      const d = p.cur(r.index).slice();
      if (OWN_FRAME.has(r.type)) {
        const move = unturnFrame(d);
        if (!move) continue;
        p.set(r.index, d);
        // multiple extrudes and solids cache their body in the layer's frame: it turns with them
        if (BODY_IN_PARENT.has(r.type)) for (const c of r.children) if (c.type === BODY) turnBodyPoints(p.mut(c.index), move);
      } else if (r.type === SYMBOL_INSTANCE && this.shows3D(r)) {
        if (!unturnInstance(d)) continue;
        // an instance's bounds are its contents' stored bounds, placed (as insertSymbol has them)
        const symbol = u16(d, 0x8e);
        let box: BBox | null = null;
        const def = this.doc.symbols.get(symbol);
        if (def) for (const c of objectChildren(def)) box = unionBox(box, readBBox(c.data));
        if (!box) for (const s of this.doc.symbolShapes(symbol)) box = unionBox(box, s.bbox);
        const { e, f } = readInstanceMatrix(d);
        if (box) writeBBox(d, { x0: box.x0 + e, y0: box.y0 + f, x1: box.x1 + e, y1: box.y1 + f });
        p.set(r.index, d);
      } else continue;
      done.push(r);
    }
    const out = done.map(guidOf);
    if (!done.length) return out;
    this.refitGroups(p, done);
    this.commit(p, "objects", out);
    return out;
  }

  rotateObjects3D(ids: string[], axis: Vec3, deg: number, centre: Vec3): { turned: string[]; left: number } {
    if (![...axis, deg, ...centre].every(Number.isFinite)) throw new Error("the rotation is not a finite number");
    const n = Math.hypot(...axis);
    if (!(n > 0)) throw new Error("the rotation axis has no direction");
    const k = axis.map((v) => v / n);
    const { s, c } = exactSinCos(deg);
    if (s === 0 && c === 1) return { turned: [], left: 0 };
    const recs = this.topmost(ids, true);
    // about the layer's z axis it is a turn in plan, which turns every kind of object
    if (Math.abs(k[0]) < 1e-12 && Math.abs(k[1]) < 1e-12) {
      const t = Math.sign(k[2]) * s;
      const [x, y] = centre;
      this.transformObjects(ids, { a: c, b: t, c: -t, d: c, e: x - c * x + t * y, f: y - t * x - c * y });
      return { turned: recs.map(guidOf), left: 0 };
    }
    const cross = [
      [0, -k[2], k[1]],
      [k[2], 0, -k[0]],
      [-k[1], k[0], 0],
    ];
    const turn: Turn3D = { rows: [0, 1, 2].map((i) => [0, 1, 2].map((j) => (i === j ? c : 0) + s * cross[i][j] + (1 - c) * k[i] * k[j])), centre };
    const p = this.plan();
    const done: Rec[] = [];
    const turned = new Set<Rec>();
    let left = 0;
    const walk = (r: Rec, top: Rec): void => {
      const d = p.cur(r.index).slice();
      if (r.type === 11) {
        for (const o of objectChildren(r)) walk(o, top);
        return;
      }
      if (OWN_FRAME.has(r.type)) {
        const move = turnFrame3D(d, turn);
        if (!move) return void left++;
        p.set(r.index, d);
        // multiple extrudes and solids cache their body in the layer's frame: it turns with them
        if (BODY_IN_PARENT.has(r.type)) for (const b of r.children) if (b.type === BODY) turnBodyPoints(p.mut(b.index), move);
      } else if (r.type === POLY3D || r.type === MESH || r.type === LOCUS3D) {
        if (!turnPoints3D(d, r.type, turn)) return void left++;
        p.set(r.index, d);
      } else if (r.type === SYMBOL_INSTANCE && this.only3D(r)) {
        // its bounds in plan: what it shows in 3D, turned
        let box: BBox | null = null;
        for (const { triangles: t } of objectTriangles(this.doc, r)) {
          for (let i = 0; i + 2 < t.length; i += 3) {
            const [x, y] = turnPoint3D(turn, [t[i], t[i + 1], t[i + 2]]);
            box = unionBox(box, { x0: x, y0: y, x1: x, y1: y });
          }
        }
        if (!turnInstance3D(d, turn)) return void left++;
        if (box) writeBBox(d, box);
        p.set(r.index, d);
      } else return void left++;
      done.push(r);
      turned.add(top);
    };
    // a door or window set in a wall keeps its wall's turn
    for (const r of recs) {
      if (isWallInsert(r)) left++;
      else walk(r, r);
    }
    const out = recs.filter((r) => turned.has(r)).map(guidOf);
    if (!done.length) return { turned: out, left };
    this.refitGroups(p, done);
    this.commit(p, "objects", out);
    return { turned: out, left };
  }

  /** True when an object shows only in 3D: a 3D object, or a group or symbol holding them and nothing else (an empty group draws nothing). */
  private only3D(r: Rec, depth = 0): boolean {
    if (MOVABLE_3D.has(r.type)) return true;
    const def = r.type === SYMBOL_INSTANCE && depth < 12 ? this.doc.symbols.get(u16(r.data, 0x8e)) : undefined;
    const held = (r.type === 11 ? objectChildren(r) : def ? objectChildren(def) : []).filter((c) => c.type !== 11 || objectChildren(c).length);
    return held.length > 0 && held.every((c) => this.only3D(c, depth + 1));
  }

  duplicateObjects(ids: string[], dx: number, dy: number): string[] {
    const recs = this.topmost(ids);
    const p = this.plan();
    const out: string[] = [];
    const added = new Map<Rec, Uint8Array[]>();
    for (const r of recs) {
      const moved = new Set(movedWalk(r));
      for (const o of moved) {
        if (!COPIED.has(o.type)) throw new Error(`duplicating ${typeLabel(o.type)} objects isn't supported yet`);
      }
      const t = templateOf(r);
      const copies = this.instantiate(t, r.owner);
      // translate the copies of object records (same pre-order as templateOf); what a 3D object
      // holds in its own frame is copied as it is
      const objects = new Set(objectWalk(r));
      let i = 0;
      for (const src of r.walk()) {
        if (objects.has(src)) {
          if (moved.has(src)) translateRecord(copies[i], src.type, dx, dy);
          setU16(copies[i], 0x1a, 0); // object names are unique: copies are unnamed
        } else if (src.type === FILL_MAPPING && src.parent && moved.has(src.parent)) {
          transformFillMapping(copies[i], translation(dx, dy));
        } else if (src.type === BODY && src.parent && moved.has(src.parent) && BODY_IN_PARENT.has(src.parent.type)) {
          moveBodyPoints(copies[i], translation(dx, dy));
        } else if (src.type === RECORD && src.parent && moved.has(src.parent)) {
          const cam = this.cameraParams(src.parent);
          if (cam?.rec === src) copies[i] = cameraRecordThrough(copies[i], cam.fmt, translation(dx, dy));
        }
        i++;
      }
      p.insert(subtreeEnd(r) + 1, copies);
      out.push(recOfData(copies[0]).guid);
      if (r.parent) added.set(r.parent, [...(added.get(r.parent) ?? []), copies[0]]);
    }
    this.refitGroups(p, [], added);
    this.commit(p, "objects", out);
    return out;
  }

  setGeometry(id: string, shape: NewShape): void {
    const r = this.object(id);
    if (TYPE_OF_KIND[shape.kind] !== r.type) throw new Error(`can't set ${shape.kind} geometry on a ${r.typeName}`);
    const p = this.plan();
    const d = writeGeometry(r.data, shape);
    // a light's height is above the layer
    liftRecord(d, r.type, layerElevationOf(r));
    p.set(r.index, d);
    this.refitGroups(p, [r]);
    this.commit(p, "objects", [id]);
  }

  setText(id: string, text: string): void {
    const r = this.object(id);
    if (r.type !== 10) throw new Error(`${r.typeName} is not a text object`);
    const p = this.plan();
    p.set(r.index, encodeText(r.data, text));
    this.refitGroups(p, [r]);
    this.commit(p, "objects", [id]);
  }

  setTextStyle(ids: string[], style: TextStyle): void {
    const p = this.plan();
    const recs = [...new Set(ids)].map((id) => this.object(id));
    for (const r of recs) if (r.type !== 10) throw new Error(`${r.typeName} is not a text object`);
    // a text style is named by its name index
    if (style.textStyle && style.textStyle !== TEXT_STYLE_BY_CLASS) this.resource(TEXT_STYLE_TYPE, style.textStyle, "text style");
    const fonts = this.doc.fonts();
    const index = style.font === undefined ? -1 : this.fontIndex(p, style.font);
    for (const r of recs) {
      const was = fonts[shapeOf(r)?.fontIndex ?? -1];
      const face = index >= 0 ? { index, narrow: isNarrowFont(style.font), wasNarrow: isNarrowFont(was) } : undefined;
      p.set(r.index, encodeTextStyle(r.data, style, face));
    }
    this.refitGroups(p, recs);
    this.commit(p, "objects", ids);
  }

  /** A font's place in the font list (a text names its font so); one the list lacks is added to it in `p`. */
  private fontIndex(p: Plan, font: string): number {
    // the list as this step has it, which may already have gained fonts
    const list = this.doc.roots.find((r) => r.type === FONT_LIST);
    const fonts = list ? readFontList(p.cur(list.index)) : this.doc.fonts();
    const at = fonts.indexOf(font);
    if (at >= 0) return at;
    if (!list) throw new Error("this file has no font list to add a font to");
    p.set(list.index, withFont(p.cur(list.index), font));
    return fonts.length;
  }

  setObjectClass(ids: string[], classIndex: number): void {
    if (!this.doc.classRecs.has(classIndex)) throw new Error(`no class #${classIndex}`);
    const p = this.plan();
    for (const id of new Set(ids)) for (const r of withFaces(this.object(id))) setU32(p.mut(r.index), 0x20, classIndex);
    this.commit(p, "objects", ids);
  }

  setObjectName(id: string, name: string): void {
    const r = this.object(id);
    const next = name.trim();
    const at = r.nameIndex;
    const now = at ? (this.doc.names.get(at) ?? "") : "";
    if (next === now) return;
    // an entry another record names itself by too is left alone: this one gets its own
    const shared = at !== 0 && this.doc.recs.some((o) => o !== r && o.nameIndex === at);
    const names = new Map(this.doc.names);
    const p = this.plan();
    if (next === "") {
      if (!shared) names.delete(at);
      setU16(p.mut(r.index), 0x1a, 0);
    } else if (at !== 0 && !shared) {
      this.checkName(next, undefined, at);
      names.set(at, next);
    } else {
      this.checkName(next);
      const index = this.freshName();
      names.set(index, next);
      setU16(p.mut(r.index), 0x1a, index);
    }
    this.writeNames(p, names);
    this.commit(p, "objects", [id]);
  }

  setObjectLayer(ids: string[], layerId: string): void {
    const target = this.layer(layerId);
    const { owner, at } = this.slot(target);
    const p = this.plan();
    const recs = this.topmost(ids);
    for (const r of recs) {
      if (r.parent === target) continue;
      // as high above the new layer as it was above its own
      this.lift(p, r, layerElevationOf(target) - layerElevationOf(r));
      const end = subtreeEnd(r);
      const moved: Uint8Array[] = [];
      for (let i = r.index; i <= end; i++) moved.push(p.cur(i));
      const root = moved[0].slice();
      setOwner(root, owner);
      setNext(root, true);
      moved[0] = root;
      p.remove(r.index, end);
      p.insert(at, moved);
    }
    this.refitGroups(p, recs);
    this.commit(p, "all", ids);
  }

  setRecordField(id: string, format: number, field: string, value: RecordValue): void {
    const r = this.object(id);
    const fmt = this.doc.formatDef(format);
    const rec = r.children.find((c) => c.type === RECORD && recordFormat(c.data) === format);
    if (!fmt || !rec) throw new Error(`${r.typeName} has no record "${this.doc.names.get(format) ?? format}"`);
    const p = this.plan();
    p.set(rec.index, writeValue(rec.data, fmt, field, value));
    // a Heliodon's sun follows its place, date and time
    if (fmt.parametric && HELIODON_INPUTS.has(field) && this.doc.pluginName(r) === HELIODON) this.writeSun(p, r, { rec, fmt }, undefined, rec.data);
    this.commit(p, "objects", [id]);
  }

  setRecordFields(format: number, values: readonly { id: string; fields: Readonly<Record<string, RecordValue>> }[]): void {
    const fmt = this.doc.formatDef(format);
    const name = this.doc.names.get(format) ?? `#${format}`;
    if (!fmt) throw new Error(`"${name}" is not a record format`);
    const p = this.plan();
    const done: string[] = [];
    for (const { id, fields } of values) {
      const r = this.object(id);
      const rec = r.children.find((c) => c.type === RECORD && recordFormat(c.data) === format);
      if (!rec) throw new Error(`${r.typeName} has no record "${name}"`);
      const was = p.cur(rec.index);
      let data = was;
      for (const [field, value] of Object.entries(fields)) data = writeValue(data, fmt, field, value);
      p.set(rec.index, data);
      // a Heliodon's sun follows its place, date and time, as setRecordField has it
      if (fmt.parametric && Object.keys(fields).some((f) => HELIODON_INPUTS.has(f)) && this.doc.pluginName(r) === HELIODON) this.writeSun(p, r, { rec, fmt }, undefined, was);
      done.push(id);
    }
    if (done.length) this.commit(p, "objects", done);
  }

  setSymbolRecordFields(format: number, values: readonly { symbol: number; fields: Readonly<Record<string, RecordValue>> }[]): void {
    const fmt = this.doc.formatDef(format);
    const name = this.doc.names.get(format) ?? `#${format}`;
    if (!fmt || fmt.parametric) throw new Error(`"${name}" is not a data record format`);
    const p = this.plan();
    let changed = false;
    for (const { symbol, fields } of values) {
      const def = this.doc.symbols.get(symbol);
      if (!def) throw new Error(`no symbol definition #${symbol}`);
      const rec = def.children.find((c) => c.type === RECORD && recordFormat(c.data) === format);
      if (!rec) throw new Error(`the symbol "${this.doc.names.get(symbol) ?? symbol}" has no record "${name}"`);
      let data = p.cur(rec.index);
      for (const [field, value] of Object.entries(fields)) data = writeValue(data, fmt, field, value);
      p.set(rec.index, data);
      changed = true;
    }
    if (changed) this.commit(p, "all");
  }

  attachRecord(ids: string[], format: number): void {
    const fmt = this.doc.formatDef(format);
    const name = this.doc.names.get(format) ?? `#${format}`;
    if (!fmt || fmt.parametric) throw new Error(`"${name}" is not a data record format`);
    // a format's own record holds its default values: an attached record starts as a copy of it
    const defaults = this.doc.recs
      .find((r) => r.type === RECORD_FORMAT && r.nameIndex === format)
      ?.children.find((c) => c.type === RECORD);
    if (!defaults) throw new Error(`the record format "${name}" has no default values`);
    const p = this.plan();
    const done: string[] = [];
    for (const id of new Set(ids)) {
      const r = this.object(id);
      if (r.children.some((c) => c.type === RECORD && recordFormat(c.data) === format)) continue;
      // with the other aux records, ahead of a drop shadow, which Vectorworks keeps last
      this.addAux(p, r, this.newAux(RECORD, defaults.data.subarray(0x50)), DROP_SHADOW);
      done.push(id);
    }
    if (done.length) this.commit(p, "objects", done);
  }

  attachRecords(entries: readonly { id: string; format: number; fields: Readonly<Record<string, RecordValue>> }[]): void {
    // each format's definition and the defaults a new record copies, found once
    const formatRecs = new Map<number, Rec>();
    for (const r of this.doc.recs) if (r.type === RECORD_FORMAT && !formatRecs.has(r.nameIndex)) formatRecs.set(r.nameIndex, r);
    const formats = new Map<number, { fmt: FormatDef; defaults: Uint8Array }>();
    const formatOf = (format: number): { fmt: FormatDef; defaults: Uint8Array } => {
      let f = formats.get(format);
      if (f) return f;
      const fmt = this.doc.formatDef(format);
      const name = this.doc.names.get(format) ?? `#${format}`;
      if (!fmt || fmt.parametric) throw new Error(`"${name}" is not a data record format`);
      const defaults = formatRecs.get(format)?.children.find((c) => c.type === RECORD);
      if (!defaults) throw new Error(`the record format "${name}" has no default values`);
      f = { fmt, defaults: defaults.data };
      formats.set(format, f);
      return f;
    };
    // an object's entries together, a format's fields merged
    const byObject = new Map<string, Map<number, Record<string, RecordValue>>>();
    for (const { id, format, fields } of entries) {
      const mine = byObject.get(id) ?? byObject.set(id, new Map()).get(id)!;
      mine.set(format, { ...mine.get(format), ...fields });
    }
    const p = this.plan();
    const done: string[] = [];
    for (const [id, mine] of byObject) {
      const r = this.object(id);
      const fresh: Uint8Array[] = [];
      for (const [format, fields] of mine) {
        const { fmt, defaults } = formatOf(format);
        const had = r.children.find((c) => c.type === RECORD && recordFormat(c.data) === format);
        let data = had ? p.cur(had.index) : this.newAux(RECORD, defaults.subarray(0x50));
        for (const [field, value] of Object.entries(fields)) data = writeValue(data, fmt, field, value);
        if (had) p.set(had.index, data);
        else fresh.push(data);
      }
      // with the other aux records, ahead of a drop shadow, which Vectorworks keeps last
      this.addAuxes(p, r, fresh, DROP_SHADOW);
      done.push(id);
    }
    if (done.length) this.commit(p, "objects", done);
  }

  createRecordFormat(name: string, fields: readonly RecordFieldSpec[]): number {
    if (fields.some((f) => f.from !== undefined)) throw new Error("a new record format has no fields to keep");
    // a data record format with only its defaults under it: other children (a choice list) aren't copied
    const tpl = this.doc.recs.find(
      (r) => r.type === RECORD_FORMAT && !readFormat(r.data).parametric && r.children.length === 1 && r.children[0].type === RECORD,
    );
    // none to copy: a new one, first in the class list so that list's end stays as it is
    const before = tpl ?? this.doc.classList?.children[0];
    if (!before) throw new Error("this drawing has no class list to keep a record format in");
    this.checkName(name);
    const copies = this.instantiate(tpl ? templateOf(tpl) : recordFormatTemplate(), before.owner);
    const fresh = this.freshName();
    copies[0] = encodeFormat(copies[0], fields);
    setU16(copies[0], 0x1a, fresh);
    const fmt = readFormat(copies[0]);
    copies[1] = encodeRecord(copies[1], fmt, fields.map((f) => f.value));
    setU16(copies[1], 0x50, fresh);
    const names = new Map(this.doc.names);
    names.set(fresh, name);
    const p = this.plan();
    this.writeNames(p, names);
    // before the one copied, so the new format is never the last of its list
    p.insert(before.index, copies);
    this.commit(p, "all", []);
    return fresh;
  }

  editRecordFormat(format: number, fields: readonly RecordFieldSpec[]): void {
    const rec = this.doc.recs.find((r) => r.type === RECORD_FORMAT && r.nameIndex === format);
    const name = this.doc.names.get(format) ?? `#${format}`;
    if (!rec) throw new Error(`no record format #${format}`);
    const old = readFormat(rec.data);
    if (old.parametric) throw new Error(`"${name}" holds a plug-in's parameters, which can't be edited as a record format`);
    const data = encodeFormat(rec.data, fields);
    const fmt = readFormat(data);
    const from = fields.map((f) => (f.from === undefined ? -1 : old.fields.findIndex((g) => g.name === f.from)));
    const p = this.plan();
    p.set(rec.index, data);
    const defaults = rec.children.find((c) => c.type === RECORD);
    for (const r of this.doc.recs) {
      if (r.type !== RECORD || recordFormat(r.data) !== format) continue;
      // the format's own record takes the defaults; an object's keeps its values for the kept fields
      const own = r === defaults;
      const values = own ? null : readValues(r.data, old);
      if (!own && !values) throw new Error(`a record of "${name}" doesn't fit its format, so the format can't be changed`);
      p.set(r.index, encodeRecord(r.data, fmt, fields.map((f, i) => (own || from[i] < 0 ? f.value : values![from[i]].value)), old, from));
    }
    this.commit(p, "all", []);
  }

  detachRecord(ids: string[], format: number): void {
    if (this.doc.formatDef(format)?.parametric) throw new Error("a plug-in object's parameters can't be detached");
    const p = this.plan();
    const done: string[] = [];
    for (const id of new Set(ids)) if (this.dropRecord(p, this.object(id), format)) done.push(id);
    if (done.length) this.commit(p, "objects", done);
  }

  /** Removes `r`'s record of `format` from its aux list; false when it has none there. */
  private dropRecord(p: Plan, r: Rec, format: number): boolean {
    const aux = r.children.slice(0, auxCount(r));
    const i = aux.findIndex((c) => c.type === RECORD && recordFormat(c.data) === format);
    if (i < 0) return false;
    p.remove(aux[i].index, subtreeEnd(aux[i]));
    // the aux list ends at its first record without a next mark, and +0x10 is set only while there is one
    if (aux.length === 1) setU64(p.mut(r.index), 0x10, 0n);
    else if (i === aux.length - 1) setNext(p.mut(aux[i - 1].index), false);
    return true;
  }

  /** Removes a resource record from its list, and its name (name index `index`). */
  private removeResource(p: Plan, rec: Rec, index: number): void {
    const siblings = rec.parent?.children ?? [];
    const before = siblings[siblings.indexOf(rec) - 1];
    if (!rec.hasNext && before?.hasNext) setNext(p.mut(before.index), false);
    p.remove(rec.index, subtreeEnd(rec));
    const names = new Map(this.doc.names);
    names.delete(index);
    this.writeNames(p, names);
  }

  deleteRecordFormat(format: number): void {
    const rec = this.doc.recs.find((r) => r.type === RECORD_FORMAT && r.nameIndex === format);
    const name = this.doc.names.get(format) ?? `#${format}`;
    if (!rec) throw new Error(`no record format #${format}`);
    if (readFormat(rec.data).parametric) throw new Error(`"${name}" holds a plug-in's parameters, which go with the plug-in`);
    this.refuseNamed(name, "deleting");
    const defaults = rec.children.find((c) => c.type === RECORD);
    const p = this.plan();
    // its records go from the objects that hold them
    for (const r of this.doc.recs) {
      if (r.type !== RECORD || r === defaults || recordFormat(r.data) !== format) continue;
      if (!r.parent || !this.dropRecord(p, r.parent, format)) throw new Error(`a record of "${name}" isn't held by an object, so the format can't be deleted`);
    }
    this.removeResource(p, rec, format);
    this.commit(p, "all", []);
  }

  /** A data record format's own record, definition and default values; throws for a plug-in's parameters or a field openvwx can't read. */
  private dataFormat(format: number): { name: string; fmt: FormatDef; defaults: RecordField[]; own: Rec } {
    const rec = this.doc.recs.find((r) => r.type === RECORD_FORMAT && r.nameIndex === format);
    const name = this.doc.names.get(format) ?? `#${format}`;
    if (!rec) throw new Error(`no record format #${format}`);
    const fmt = readFormat(rec.data);
    if (fmt.parametric) throw new Error(`"${name}" holds a plug-in's parameters, which go with the plug-in`);
    if (fmt.fields.some((f) => !f.kind)) throw new Error(`"${name}" has a field openvwx can't read`);
    const own = rec.children.find((c) => c.type === RECORD);
    const defaults = own ? readValues(own.data, fmt) : null;
    if (!own || !defaults) throw new Error(`the record format "${name}" has no default values`);
    return { name, fmt, defaults, own };
  }

  /** The records of `format` that objects and symbol definitions hold, each with its holder; the format's own defaults left out. */
  private heldRecords(format: number): { record: Rec; holder: Rec }[] {
    const { name, own } = this.dataFormat(format);
    const out: { record: Rec; holder: Rec }[] = [];
    for (const r of this.doc.recs) {
      if (r.type !== RECORD || r === own || recordFormat(r.data) !== format) continue;
      if (!r.parent) throw new Error(`a record of "${name}" isn't held by an object`);
      out.push({ record: r, holder: r.parent });
    }
    return out;
  }

  /** Moving a pop-up field would leave its list of choices behind, which another format's records can't take yet. */
  private refuseChoices(name: string, fields: readonly RecordField[]): void {
    const choice = fields.find((f) => f.kind === "choice");
    if (choice) throw new Error(`"${name}"'s pop-up field "${choice.name}" can't move to another format yet: its list of choices would stay behind`);
  }

  mergeRecordFormats(from: number, into: number): void {
    if (from === into) throw new Error("a record format can't be merged into itself");
    const src = this.dataFormat(from);
    const dst = this.dataFormat(into);
    this.refuseChoices(src.name, src.defaults);
    this.refuseNamed(src.name, "deleting");
    // a field name the receiving format has already takes "_" in front
    const taken = new Set(dst.defaults.map((f) => f.name));
    const renamed = src.defaults.map((f) => {
      let n = f.name;
      while (taken.has(n)) n = `_${n}`;
      taken.add(n);
      return n;
    });
    this.batch(() => {
      this.editRecordFormat(into, [
        ...dst.defaults.map((f) => ({ name: f.name, kind: f.kind, value: f.value, from: f.name })),
        ...src.defaults.map((f, i) => ({ name: renamed[i], kind: f.kind, value: f.value })),
      ]);
      const merged = this.dataFormat(into);
      const p = this.plan();
      // each holder's values go to its record of `into`, a copy of the defaults where it had none
      for (const { record, holder } of this.heldRecords(from)) {
        const values = readValues(record.data, src.fmt);
        if (!values) throw new Error(`a record of "${src.name}" doesn't fit its format, so it can't be merged`);
        const has = holder.children.find((c) => c.type === RECORD && recordFormat(c.data) === into);
        let d = has ? p.cur(has.index) : merged.own.data;
        values.forEach((v, i) => (d = writeValue(d, merged.fmt, renamed[i], v.value)));
        if (has) p.set(has.index, d);
        else this.addAux(p, holder, this.newAux(RECORD, d.subarray(0x50)), DROP_SHADOW);
      }
      this.commit(p, "all", []);
      this.deleteRecordFormat(from);
    });
  }

  splitRecordFormat(format: number, fields: readonly string[], name: string): number {
    const src = this.dataFormat(format);
    const moving = src.defaults.filter((f) => fields.includes(f.name));
    if (!moving.length) throw new Error("no field to split off");
    if (moving.length === src.defaults.length) throw new Error(`"${src.name}" would be left with no fields`);
    this.refuseChoices(src.name, moving);
    return this.batch(() => {
      const fresh = this.createRecordFormat(
        name,
        moving.map((f) => ({ name: f.name, kind: f.kind, value: f.value })),
      );
      const made = this.dataFormat(fresh);
      const p = this.plan();
      // each holder gains a record of the new format with its values of the fields moved
      for (const { record, holder } of this.heldRecords(format)) {
        const values = readValues(record.data, src.fmt);
        if (!values) throw new Error(`a record of "${src.name}" doesn't fit its format, so it can't be split`);
        let d = made.own.data;
        for (const f of moving) d = writeValue(d, made.fmt, f.name, values.find((v) => v.name === f.name)!.value);
        this.addAux(p, holder, this.newAux(RECORD, d.subarray(0x50)), DROP_SHADOW);
      }
      this.commit(p, "all", []);
      this.editRecordFormat(
        format,
        src.defaults.filter((f) => !fields.includes(f.name)).map((f) => ({ name: f.name, kind: f.kind, value: f.value, from: f.name })),
      );
      return fresh;
    });
  }

  deleteWorksheet(index: number): void {
    const rec = this.doc.worksheets.get(index);
    const name = this.doc.names.get(index) ?? `#${index}`;
    if (!rec) throw new Error(`no worksheet #${index}`);
    const placed = this.doc.recs.filter((r) => r.type === WORKSHEET_IMAGE && readWorksheetImage(r.data)?.worksheet === index).length;
    if (placed) throw new Error(`"${name}" is on ${placed === 1 ? "a sheet" : `sheets ${placed} times`}; delete it there first`);
    // its own cells may hold its name, as a title
    this.refuseNamed(name, "deleting", rec);
    const p = this.plan();
    this.removeResource(p, rec, index);
    this.commit(p, "all", []);
  }

  // ---- textures --------------------------------------------------------------------

  /** The drawing's textures by name index and record formats by name, read again after a change. */
  private textureLookup(): { textures: Map<number, Rec>; formats: Map<string, Rec> } {
    if (this.named?.recs !== this.doc.recs) {
      const textures = new Map<number, Rec>();
      const formats = new Map<string, Rec>();
      for (const r of this.doc.recs) {
        if (r.type === TEXTURE && r.nameIndex) textures.set(r.nameIndex, r);
        else if (r.type === RECORD_FORMAT && r.nameIndex) {
          const name = this.doc.names.get(r.nameIndex);
          if (name !== undefined && !formats.has(name)) formats.set(name, r);
        }
      }
      this.named = { recs: this.doc.recs, textures, formats };
    }
    return this.named;
  }

  copyTexture(index: number): TextureData {
    const { textures, formats } = this.textureLookup();
    const rec = textures.get(index);
    if (!rec) throw new Error(`no texture #${index}`);
    const t = templateOf(rec);
    const used = new Map<string, Rec>();
    const records = [...rec.walk()].map((src, i) => {
      const entry: { data: Uint8Array; parent: number; format?: string } = { data: t.recs[i], parent: t.parent[i] };
      if (src.type === RECORD) {
        const name = this.doc.names.get(recordFormat(src.data));
        const def = name === undefined ? undefined : formats.get(name);
        if (!def || readFormat(def.data).parametric) throw new Error("its shader settings name a record format the file lacks");
        used.set(name!, def);
        entry.format = name;
      }
      return entry;
    });
    const needs = [...used].map(([name, def]) => {
      const f = templateOf(def);
      return { name, list: formatList(def), records: f.recs.map((data, i) => ({ data, parent: f.parent[i] })) };
    });
    return { records, formats: needs };
  }

  textureImportProblem(data: TextureData): string | null {
    try {
      this.textureFormats(readTexture(data));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  importTexture(name: string, data: TextureData, replace?: number): number {
    const tex = readTexture(data);
    const { textures } = this.textureLookup();
    const old = replace === undefined ? null : textures.get(replace);
    if (old === undefined) throw new Error(`no texture #${replace}`);
    if (!old) this.checkName(name);
    const { have, add } = this.textureFormats(tex);
    const p = this.plan();
    const names = new Map(this.doc.names);
    const formats = new Map(have);
    // the record formats it lacks, each before one of the drawing's in the same kind of list, else
    // in a list of their own
    const listed: Template = { recs: [shaderFormatList()], parent: [-1] };
    const inList: { at: number; fresh: number }[] = [];
    // a format's copies take its new name index, and its defaults name it
    const own = (copies: readonly Uint8Array[], fresh: number): void => {
      const was = u16(copies[0], 0x1a);
      setU16(copies[0], 0x1a, fresh);
      for (let i = 1; i < copies.length; i++) if (copies[i][0x19] === RECORD && recordFormat(copies[i]) === was) setU16(copies[i], 0x50, fresh);
    };
    for (const f of add) {
      const at = this.formatSlot(f.list);
      const fresh = this.freshName();
      names.set(fresh, f.name);
      formats.set(f.name, fresh);
      if (at) {
        const copies = this.instantiate(f.recs, at.owner);
        own(copies, fresh);
        p.insert(at.index, copies);
        continue;
      }
      const base = listed.recs.length;
      inList.push({ at: base, fresh });
      f.recs.recs.forEach((d, i) => {
        listed.recs.push(i === 0 ? d.slice() : d);
        listed.parent.push(i === 0 ? 0 : f.recs.parent[i] + base);
      });
    }
    if (inList.length) {
      // each format in the new list but the last has one after it
      inList.forEach(({ at }, k) => setNext(listed.recs[at], k < inList.length - 1));
      const first = this.doc.classList!.children[0];
      const copies = this.instantiate(listed, first.owner);
      inList.forEach(({ at, fresh }, k) => own(copies.slice(at, inList[k + 1]?.at ?? copies.length), fresh));
      p.insert(first.index, copies);
    }
    // in place of the texture it replaces (keeping its name, which classes and objects use), else
    // before one of the drawing's, else among the resources at the top of the class list, else
    // after the lists that start it
    const top = this.doc.classList?.children;
    const at = old ?? textures.values().next().value ?? top?.find((c) => c.type === RECORD_FORMAT || RESOURCE_TYPES.has(c.type)) ?? top?.find((c) => c.type !== AUX_RECORD);
    if (!at) throw new Error("this drawing has no resource list to put a texture in");
    const copies = this.instantiate(tex.recs, at.owner);
    const index = old ? replace! : this.freshName();
    setU16(copies[0], 0x1a, index);
    tex.formatOf.forEach((format, i) => {
      if (format) setU16(copies[i], 0x50, formats.get(format)!);
    });
    if (old) {
      setNext(copies[0], old.hasNext);
      p.remove(old.index, subtreeEnd(old));
    } else names.set(index, name);
    if (!old || add.length) this.writeNames(p, names);
    p.insert(at.index, copies);
    this.commit(p, "all", []);
    return index;
  }

  addImageTexture(name: string, spec: ImageTextureSpec): number {
    const { image, mime, width, height, size, color, previews } = spec;
    if (!(image instanceof Uint8Array) || !image.length || (mime !== "image/png" && mime !== "image/jpeg")) throw new Error("a texture's image is a PNG or JPEG");
    if (!(size > 0) || !Number.isFinite(size)) throw new Error("a texture's image needs a size");
    if (color.length !== 3 || !color.every(Number.isFinite)) throw new Error("a texture's colour is three numbers");
    if (!(previews.large instanceof Uint8Array) || !(previews.small instanceof Uint8Array)) throw new Error("a texture takes two PNG previews");
    return this.importTexture(name, imageTexture({ image, mime, width, height, size, color, previews }));
  }

  /** The drawing's record formats a texture's shaders use (by name, their index), and the ones it lacks; throws when one's fields differ or it has nowhere to go. */
  private textureFormats(tex: TextureRecs): { have: Map<string, number>; add: TextureRecs["formats"] } {
    const { formats } = this.textureLookup();
    const have = new Map<string, number>();
    const add: TextureRecs["formats"] = [];
    for (const f of tex.formats) {
      const own = formats.get(f.name);
      if (own) {
        if (formatSignature(own.data) !== formatSignature(f.recs.recs[0])) throw new Error(`this drawing's "${f.name}" record format has other fields`);
        have.set(f.name, own.nameIndex);
        continue;
      }
      // shader formats can start a list of their own at the top of the class list
      if (!this.formatSlot(f.list) && !(f.list === SHADER_LIST && this.doc.classList?.children.length)) throw new Error(`this drawing has no list to keep its "${f.name}" record format in`);
      this.checkName(f.name);
      add.push(f);
    }
    return { have, add };
  }

  /** A record format of the drawing in the kind of list `list` names (see formatList), for a new one to go before. */
  private formatSlot(list: string): Rec | undefined {
    for (const r of this.textureLookup().formats.values()) if (r.parent && formatList(r) === list) return r;
    return undefined;
  }

  // ---- hatches ---------------------------------------------------------------------

  /** The resource record of `type` with name index `index`; `what` names the kind in the error. */
  private resource(type: number, index: number, what: string): Rec {
    const r = this.doc.recs.find((x) => x.type === type && x.nameIndex === index);
    if (!r) throw new Error(`no ${what} #${index}`);
    return r;
  }

  /**
   * A new resource copied from `tpl`, named `name`, its record made by `write` from the copy's and
   * its previews replaced by `previews` (PNGs by their width). A duplicate (`keepTags`) keeps the
   * tags child; a new one has none. Returns its name index.
   */
  private copyResource(tpl: Rec, name: string, write: (d: Uint8Array, p: Plan) => Uint8Array, previews: ReadonlyMap<number, Uint8Array>, keepTags: boolean): number {
    this.checkName(name);
    const tags = (r: Rec): boolean => r.type === 76 && r.data.length >= 0x54 && String.fromCharCode(...r.data.subarray(0x50, 0x54)) === "SGAT";
    const t = templateOf(tpl, (r, depth) => !keepTags && depth === 1 && tags(r));
    const p = this.plan();
    const copies = this.instantiate(t, tpl.owner);
    const index = this.freshName();
    copies[0] = write(copies[0], p);
    setU16(copies[0], 0x1a, index);
    for (let i = 1; i < copies.length; i++) {
      if (t.parent[i] !== 0 || copies[i][0x19] !== PREVIEW) continue;
      const png = previews.get(previewSize(copies[i])?.width ?? -1);
      if (png) copies[i] = writePreview(copies[i], png);
    }
    const names = new Map(this.doc.names);
    names.set(index, name);
    this.writeNames(p, names);
    // before the one copied, so the new resource is never the last of its list
    p.insert(tpl.index, copies);
    this.commit(p, "all", []);
    return index;
  }

  /** Writes a resource's record and replaces its previews of the widths `previews` has. */
  private rewriteResource(rec: Rec, data: Uint8Array, previews: ReadonlyMap<number, Uint8Array>): void {
    const p = this.plan();
    if (data !== rec.data) p.set(rec.index, data);
    for (const c of rec.children) {
      const png = c.type === PREVIEW ? previews.get(previewSize(c.data)?.width ?? -1) : undefined;
      if (png) p.set(c.index, writePreview(c.data, png));
    }
    // everything drawn with it draws anew
    this.commit(p, "all", []);
  }

  /**
   * Refuses to delete a resource that objects (`at` in their record) or classes (`classAt`) hold as
   * `value`, or wall, slab and roof components (`componentAt` in their blocks) do; or that a style or
   * material might (where they keep their own attributes isn't known, so the value anywhere in one
   * counts, but for their preview images; a material's fill is at +0x52). `doing` says what they do
   * with it.
   */
  private refuseInUse(value: number, bytes: 2 | 4, at: number, classAt: number, componentAt: readonly number[], name: string, doing: string, instead: string): void {
    const read = (d: Uint8Array, o: number): number => (bytes === 2 ? u16(d, o) : i32(d, o));
    const want = bytes === 2 ? value & 0xffff : value;
    let objects = 0;
    for (const root of [...this.doc.layerRecs, ...this.doc.symbols.values()]) {
      for (const r of objectWalk(root)) if (r !== root && r.data.length >= at + bytes && read(r.data, at) === want) objects++;
    }
    const classes = [...this.doc.classRecs.values()].filter((c) => c.data.length >= classAt + bytes && read(c.data, classAt) === want).length;
    let components = 0;
    for (const r of this.doc.recs) {
      if (r.type !== COMPONENTS || r.data.length < COMPONENT_BLOCKS) continue;
      for (let i = 0, n = u16(r.data, COMPONENT_COUNT); i < n; i++) {
        const b = COMPONENT_BLOCKS + i * COMPONENT_SIZE;
        if (b + COMPONENT_SIZE <= r.data.length && componentAt.some((o) => read(r.data, b + o) === want)) components++;
      }
    }
    const uses = [
      objects && `${objects} object${objects === 1 ? "" : "s"}`,
      classes && `${classes} class${classes === 1 ? "" : "es"}`,
      components && `${components} wall, slab or roof component${components === 1 ? "" : "s"}`,
    ].filter(Boolean);
    if (uses.length) throw new Error(`${uses.join(" and ")} ${doing} "${name}"; give them ${instead} first`);
    for (const r of this.doc.recs) {
      if (!STYLE_TYPES.has(r.type)) continue;
      for (const q of r.walk()) {
        if (q.type === COMPONENTS || q.type === PREVIEW) continue;
        for (let o = 0x50; o + bytes <= q.data.length; o++) {
          if (read(q.data, o) === want) throw new Error(`a style or material may use "${name}", so it can't be deleted here`);
        }
      }
    }
    this.refuseNamed(name, "deleting");
  }

  createHatch(name: string, hatch: HatchFill, previews: ReadonlyMap<number, Uint8Array>, like?: number): number {
    const tpl = like === undefined ? this.doc.recs.find((r) => r.type === HATCH && r.nameIndex !== 0) : this.resource(HATCH, like, "hatch");
    if (!tpl) throw new Error("this drawing has no hatch to copy settings from yet");
    return this.copyResource(tpl, name, (d) => writeHatch(d, hatch), previews, like !== undefined);
  }

  editHatch(index: number, hatch: HatchFill, previews: ReadonlyMap<number, Uint8Array>): void {
    const rec = this.resource(HATCH, index, "hatch");
    this.rewriteResource(rec, writeHatch(rec.data, hatch), previews);
  }

  deleteHatch(index: number): void {
    const rec = this.resource(HATCH, index, "hatch");
    this.refuseInUse(-index, 2, 0x64, 0x60, COMPONENT_FILLS, this.doc.names.get(index) ?? `#${index}`, "fill with", "another fill");
    const p = this.plan();
    this.removeResource(p, rec, index);
    this.commit(p, "all", []);
  }

  createGradient(name: string, stops: readonly GradientStop[], previews: ReadonlyMap<number, Uint8Array>, like?: number): number {
    if (like !== undefined) return this.copyResource(this.resource(GRADIENT, like, "gradient"), name, (d) => writeGradient(d, stops), previews, true);
    const gradient = this.doc.recs.find((r) => r.type === GRADIENT && r.nameIndex !== 0);
    if (gradient) return this.copyResource(gradient, name, (d) => writeGradient(d, stops), previews, false);
    // a drawing with none yet: a hatch's header and previews (the same two sizes) around the stops
    const hatch = this.doc.recs.find((r) => r.type === HATCH && r.nameIndex !== 0);
    if (!hatch) throw new Error("this drawing has no gradient or hatch to copy settings from yet");
    return this.copyResource(hatch, name, (d) => newGradient(d, stops), previews, false);
  }

  editGradient(index: number, stops: readonly GradientStop[], previews: ReadonlyMap<number, Uint8Array>): void {
    const rec = this.resource(GRADIENT, index, "gradient");
    this.rewriteResource(rec, writeGradient(rec.data, stops), previews);
  }

  deleteGradient(index: number): void {
    const rec = this.resource(GRADIENT, index, "gradient");
    this.refuseInUse(-index, 2, 0x64, 0x60, COMPONENT_FILLS, this.doc.names.get(index) ?? `#${index}`, "fill with", "another fill");
    const p = this.plan();
    this.removeResource(p, rec, index);
    this.commit(p, "all", []);
  }

  createLineType(name: string, dashes: readonly number[], previews: ReadonlyMap<number, Uint8Array>, like?: number): number {
    const tpl = like === undefined ? this.doc.recs.find((r) => r.type === LINE_TYPE && r.nameIndex !== 0) : this.resource(LINE_TYPE, like, "line type");
    if (!tpl) throw new Error("this drawing has no line type to copy settings from yet");
    return this.copyResource(tpl, name, (d) => writeLineType(d, dashes), previews, like !== undefined);
  }

  editLineType(index: number, dashes: readonly number[], previews: ReadonlyMap<number, Uint8Array>): void {
    const rec = this.resource(LINE_TYPE, index, "line type");
    this.rewriteResource(rec, writeLineType(rec.data, dashes), previews);
  }

  deleteLineType(index: number): void {
    const rec = this.resource(LINE_TYPE, index, "line type");
    this.refuseInUse(-index, 4, 0x50, 0x5a, COMPONENT_PENS, this.doc.names.get(index) ?? `#${index}`, "draw with", "another line style");
    const p = this.plan();
    this.removeResource(p, rec, index);
    this.commit(p, "all", []);
  }

  // ---- text styles -----------------------------------------------------------------

  /** Text records that follow the text style `index`: by name, or as their class's text style. */
  private textsFollowing(index: number): Rec[] {
    const byClass = new Set([...this.doc.classRecs.values()].filter((c) => c.data.length >= CLASS_TEXT_STYLE + 4 && i32(c.data, CLASS_TEXT_STYLE) === index).map((c) => c.nameIndex));
    return this.doc.recs.filter((r) => {
      if (r.type !== 10) return false;
      const style = shapeOf(r)?.textStyle;
      return style === index || (style === TEXT_STYLE_BY_CLASS && byClass.has(r.classIndex));
    });
  }

  private textStyleDef(p: Plan, style: TextStyleSpec): TextStyleDef {
    return { fontIndex: this.fontIndex(p, style.font), points: style.points, hAlign: style.hAlign, vAlign: style.vAlign };
  }

  createTextStyle(name: string, style: TextStyleSpec, previews: ReadonlyMap<number, Uint8Array>, like?: number): number {
    if (like !== undefined) {
      return this.copyResource(this.resource(TEXT_STYLE_TYPE, like, "text style"), name, (d, p) => writeTextStyle(d, this.textStyleDef(p, style)), previews, true);
    }
    const first = this.doc.recs.find((r) => r.type === TEXT_STYLE_TYPE && r.nameIndex !== 0);
    if (first) return this.copyResource(first, name, (d, p) => writeTextStyle(d, this.textStyleDef(p, style)), previews, false);
    // a drawing with none yet: a hatch's or gradient's header and previews (the same two sizes)
    const tpl = this.doc.recs.find((r) => (r.type === HATCH || r.type === GRADIENT) && r.nameIndex !== 0);
    if (!tpl) throw new Error("this drawing has no text style, hatch or gradient to copy settings from yet");
    return this.copyResource(tpl, name, (d, p) => newTextStyle(d, this.textStyleDef(p, style)), previews, false);
  }

  editTextStyle(index: number, style: TextStyleSpec, previews: ReadonlyMap<number, Uint8Array>): void {
    const rec = this.resource(TEXT_STYLE_TYPE, index, "text style");
    const was = readTextStyle(rec.data);
    if (!was) throw new Error("this text style's record can't be read, so it can't be edited here");
    const p = this.plan();
    const def = this.textStyleDef(p, style);
    p.set(rec.index, writeTextStyle(rec.data, def));
    for (const c of rec.children) {
      const png = c.type === PREVIEW ? previews.get(previewSize(c.data)?.width ?? -1) : undefined;
      if (png) p.set(c.index, writePreview(c.data, png));
    }
    // its texts take what changed, and keep what they set apart from the rest
    const fonts = this.doc.fonts();
    const texts = this.textsFollowing(index);
    for (const r of texts) {
      const shape = shapeOf(r);
      const next: TextStyle = {
        ...(def.fontIndex !== was.fontIndex ? { font: style.font } : {}),
        ...(def.points !== was.points && shape?.textSize ? { size: (shape.textSize * def.points) / was.points } : {}),
        ...(def.hAlign !== was.hAlign ? { hAlign: def.hAlign } : {}),
        ...(def.vAlign !== was.vAlign ? { vAlign: def.vAlign } : {}),
      };
      const face = next.font === undefined ? undefined : { index: def.fontIndex, narrow: isNarrowFont(style.font), wasNarrow: isNarrowFont(fonts[shape?.fontIndex ?? -1]) };
      p.set(r.index, encodeTextStyle(r.data, next, face));
    }
    this.refitGroups(p, texts);
    this.commit(p, "all", []);
  }

  deleteTextStyle(index: number): void {
    const rec = this.resource(TEXT_STYLE_TYPE, index, "text style");
    const name = this.doc.names.get(index) ?? `#${index}`;
    const texts = this.doc.recs.filter((r) => r.type === 10 && shapeOf(r)?.textStyle === index).length;
    const classes = [...this.doc.classRecs.values()].filter((c) => c.data.length >= CLASS_TEXT_STYLE + 4 && i32(c.data, CLASS_TEXT_STYLE) === index).length;
    const uses = [texts && `${texts} text${texts === 1 ? "" : "s"}`, classes && `${classes} class${classes === 1 ? "" : "es"}`].filter(Boolean);
    if (uses.length) throw new Error(`${uses.join(" and ")} follow "${name}"; give them another text style first`);
    this.refuseNamed(name, "deleting");
    const p = this.plan();
    this.removeResource(p, rec, index);
    this.commit(p, "all", []);
  }

  setViewportScale(id: string, scale: number): void {
    if (!(scale >= 1e-3 && scale <= 1e6)) throw new Error("scale must be a positive number");
    const r = this.viewport(id);
    const at = viewportScaleAt(r.data)!;
    const p = this.plan();
    const d = p.mut(r.index);
    const old = f64(d, at);
    // the sheet point at the centre keeps showing the same view point: (v + shift) / scale = c
    const [top, left, bottom, right] = [0, 8, 16, 24].map((k) => f64(d, VIEWPORT_BOX + k));
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const k = old / scale;
    setF64(d, VIEWPORT_BOX, cy + (top - cy) * k);
    setF64(d, VIEWPORT_BOX + 8, cx + (left - cx) * k);
    setF64(d, VIEWPORT_BOX + 16, cy + (bottom - cy) * k);
    setF64(d, VIEWPORT_BOX + 24, cx + (right - cx) * k);
    setF64(d, VIEWPORT_SHIFT, f64(d, VIEWPORT_SHIFT) + cx * (scale - old));
    setF64(d, VIEWPORT_SHIFT + 8, f64(d, VIEWPORT_SHIFT + 8) + cy * (scale - old));
    setF64(d, at, scale);
    // annotations keep their place on the drawing: at (a + c(scale - old)) / scale, as the centre stays put
    this.translateOnSheet(p, r, cx * (scale - old), cy * (scale - old));
    // the annotation layer inside carries the scale too, when it was kept in step
    for (const c of r.children) if (c.type === 31 && f64(c.data, LAYER_SCALE) === old) setF64(p.mut(c.index), LAYER_SCALE, scale);
    this.refitGroups(p, [r]);
    this.commit(p, "objects", [id]);
  }

  setViewportBox(id: string, box: BBox): void {
    if (![box.x0, box.y0, box.x1, box.y1].every(Number.isFinite) || box.x1 <= box.x0 || box.y1 <= box.y0) {
      throw new Error("the box must have a positive width and height");
    }
    const r = this.viewport(id);
    const p = this.plan();
    const d = p.mut(r.index);
    setF64(d, VIEWPORT_BOX, box.y1);
    setF64(d, VIEWPORT_BOX + 8, box.x0);
    setF64(d, VIEWPORT_BOX + 16, box.y0);
    setF64(d, VIEWPORT_BOX + 24, box.x1);
    this.refitGroups(p, [r]);
    this.commit(p, "objects", [id]);
  }

  /**
   * What stops Center Drawing on Internal Origin moving the drawing: sheet viewports that look at
   * it from the side or in 3D, and design-layer viewports (how their views would follow the move
   * isn't known), and objects on the design layers that can't be moved yet, by kind. The drawing
   * stays while there are any.
   */
  drawingMoveBlockers(): { views: number; designLayerViewports: number; unmovable: Map<string, number> } {
    let views = 0;
    let designLayerViewports = 0;
    const unmovable = new Map<string, number>();
    for (const l of this.doc.layerRecs) {
      const sheet = l.data[layerKindAt(l.data)] === 2;
      for (const r of objectWalk(l)) {
        if (sheet && r.type === VIEWPORT && viewportScaleAt(r.data) !== null && !viewportIsPlan(r.data)) views++;
        else if (!sheet && isDesignLayerViewport(r)) designLayerViewports++;
      }
      if (sheet) continue;
      for (const o of objectChildren(l)) {
        const stuck = [...movedWalk(o)].find((r) => !TRANSLATABLE.has(r.type));
        if (stuck) unmovable.set(typeLabel(stuck.type), (unmovable.get(typeLabel(stuck.type)) ?? 0) + 1);
      }
    }
    return { views, designLayerViewports, unmovable };
  }

  /**
   * Center Drawing on Internal Origin: every object on the design layers, hidden ones too, moves by
   * (dx, dy), and each sheet's plan viewport goes on showing the same part of the drawing, its view
   * shifted by as much (turned as the viewport turns its plan). One undo step.
   */
  moveDrawing(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("offset is not a finite number");
    const blockers = this.drawingMoveBlockers();
    if (blockers.views || blockers.designLayerViewports) throw new Error("the drawing has viewports whose views can't follow it yet");
    if (blockers.unmovable.size) throw new Error(`moving ${[...blockers.unmovable.keys()].join(", ")} objects isn't supported yet`);
    if (dx === 0 && dy === 0) return;
    const isSheet = (l: Rec): boolean => l.data[layerKindAt(l.data)] === 2;
    this.batch(() => {
      const ids = this.doc.layerRecs.filter((l) => !isSheet(l)).flatMap((l) => objectChildren(l).map(guidOf));
      if (ids.length) this.moveObjects(ids, dx, dy);
      const views = this.doc.layerRecs.filter(isSheet).flatMap((l) => [...objectWalk(l)].filter((r) => r.type === VIEWPORT && viewportScaleAt(r.data) !== null));
      if (!views.length) return;
      const p = this.plan();
      for (const r of views) {
        // the sheet shows (view + shift) / scale, the view being the design turned by the plan's rotation
        const d = p.mut(r.index);
        const m = viewportRotation(d);
        setF64(d, VIEWPORT_SHIFT, f64(d, VIEWPORT_SHIFT) - (m.a * dx + m.c * dy));
        setF64(d, VIEWPORT_SHIFT + 8, f64(d, VIEWPORT_SHIFT + 8) - (m.b * dx + m.d * dy));
      }
      this.commit(p, "objects", views.map(guidOf));
    });
  }

  /**
   * A new plan viewport on a sheet layer: at 1:scale, its box on the sheet showing the design point
   * `at` at its middle, with the design layers and class overrides listed (a layer not listed is
   * hidden in it). Made from a plan viewport of the drawing's, less that one's annotations and crop.
   */
  createViewport(sheetId: string, spec: NewViewport): string {
    const sheet = this.layer(sheetId);
    if (sheet.data[layerKindAt(sheet.data)] !== 2) throw new Error("a viewport goes on a sheet layer");
    const { scale, box, at, layers, classes, classIndex } = spec;
    if (!(scale >= 1e-3 && scale <= 1e6)) throw new Error("scale must be a positive number");
    if (![box.x0, box.y0, box.x1, box.y1, at.x, at.y].every(Number.isFinite) || box.x1 <= box.x0 || box.y1 <= box.y0) {
      throw new Error("the box must have a positive width and height");
    }
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    const entries = [
      ...layers.map((l): [number, Visibility] => {
        const layer = this.layer(l.id);
        if (layer.data[layerKindAt(layer.data)] === 2) throw new Error("a viewport shows design layers, not sheets");
        return [layer.nameIndex, l.visibility];
      }),
      ...classes.map((c): [number, Visibility] => {
        if (!this.doc.classRecs.has(c.index)) throw new Error(`no class #${c.index}`);
        return [c.index, c.visibility];
      }),
    ];
    const shell = this.viewportShell();
    const list = viewportListAt(shell.recs[0])!;
    const d = new Uint8Array(viewportEntryAt(list.at, entries.length));
    d.set(shell.recs[0].subarray(0, list.at));
    setU16(d, list.at + 2, layers.length);
    setU16(d, list.at + 4, classes.length);
    entries.forEach(([name, v], i) => {
      const o = viewportEntryAt(list.at, i);
      setU16(d, o + VIEWPORT_ENTRY_NAME, name);
      setI16(d, o + VIEWPORT_ENTRY_VISIBILITY, visibilityCode(v));
      setU16(d, o + VIEWPORT_ENTRY_FLAGS, 1);
    });
    setU64(d, 0, BigInt(d.length));
    setU16(d, 0x1a, 0);
    setU32(d, 0x20, cls);
    setF64(d, VIEWPORT_BOX, box.y1);
    setF64(d, VIEWPORT_BOX + 8, box.x0);
    setF64(d, VIEWPORT_BOX + 16, box.y0);
    setF64(d, VIEWPORT_BOX + 24, box.x1);
    // unturned, so a view point lands at (p + shift) / scale
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => setF64(d, VIEWPORT_ROTATION + 8 * i, v));
    setF64(d, VIEWPORT_SHIFT, ((box.x0 + box.x1) / 2) * scale - at.x);
    setF64(d, VIEWPORT_SHIFT + 8, ((box.y0 + box.y1) / 2) * scale - at.y);
    const oldScale = f64(d, viewportScaleAt(d)!);
    setF64(d, viewportScaleAt(d)!, scale);
    const recs = shell.recs.map((r, i) => {
      if (i === 0) return d;
      // the annotation layer inside carries the scale too, when it was kept in step
      if (r[0x19] !== 31 || f64(r, LAYER_SCALE) !== oldScale) return r;
      const copy = r.slice();
      setF64(copy, LAYER_SCALE, scale);
      return copy;
    });
    const { owner, at: where } = this.slot(sheet);
    const made = this.instantiate({ recs, parent: shell.parent }, owner);
    const p = this.plan();
    p.insert(where, made);
    this.refitGroups(p, [], new Map([[sheet, [made[0]]]]));
    const id = recOfData(made[0]).guid;
    this.commit(p, "objects", [id]);
    return id;
  }

  /** The records a new viewport is made from: a plan viewport of the drawing's with its annotations and crop taken out, or built-in ones. */
  private viewportShell(): Template {
    const tpl = this.doc.recs.find((r) => r.type === VIEWPORT && viewportScaleAt(r.data) !== null && viewportIsPlan(r.data) && viewportListAt(r.data) !== null);
    if (!tpl) return builtinViewportShell();
    const inside = new Set(tpl.children.filter((c) => c.type === 11).flatMap((g) => objectChildren(g)));
    return templateOf(tpl, (r) => inside.has(r));
  }

  setViewportLayer(id: string, layerId: string, v: Visibility): void {
    const layer = this.layer(layerId);
    if (layer.data[layerKindAt(layer.data)] === 2) throw new Error("a viewport shows design layers, not sheets");
    this.setViewportEntry(id, "layers", layer.nameIndex, v);
  }

  setViewportClass(id: string, classIndex: number, v: Visibility): void {
    if (!this.doc.classRecs.has(classIndex)) throw new Error(`no class #${classIndex}`);
    this.setViewportEntry(id, "classes", classIndex, v);
  }

  /** Set a layer or class entry of a viewport's list, adding it at the end of its part when missing. */
  private setViewportEntry(id: string, part: "layers" | "classes", name: number, v: Visibility): void {
    const r = this.viewport(id);
    const list = viewportListAt(r.data);
    if (!list) throw new Error("this viewport's layer list can't be read");
    const from = part === "layers" ? 0 : list.layers;
    const to = from + list[part];
    const p = this.plan();
    for (let i = from; i < to; i++) {
      const o = viewportEntryAt(list.at, i);
      if (u16(r.data, o + VIEWPORT_ENTRY_NAME) !== name) continue;
      setI16(p.mut(r.index), o + VIEWPORT_ENTRY_VISIBILITY, visibilityCode(v));
      this.commit(p, "objects", [id]);
      return;
    }
    const entry = new Uint8Array(8);
    setU16(entry, VIEWPORT_ENTRY_NAME, name);
    setI16(entry, VIEWPORT_ENTRY_VISIBILITY, visibilityCode(v));
    setU16(entry, VIEWPORT_ENTRY_FLAGS, 1);
    const o = viewportEntryAt(list.at, to);
    const d = concat([r.data.subarray(0, o), entry, r.data.subarray(o)]);
    setU16(d, list.at + (part === "layers" ? 2 : 4), u16(d, list.at + (part === "layers" ? 2 : 4)) + 1);
    setU64(d, 0, BigInt(d.length));
    p.set(r.index, d);
    this.commit(p, "objects", [id]);
  }

  /**
   * Gives the objects these attribute values of their own. A group they took from their class
   * keeps its other fields as drawn (a pen colour set by hand keeps the class's pen background).
   */
  setAttributes(ids: string[], attrs: Partial<Attributes>): void {
    const p = this.plan();
    for (const id of new Set(ids)) {
      for (const r of withFaces(this.object(id))) writeAttrs(p.mut(r.index), { ...this.classGroups(r, Object.keys(attrs) as (keyof Attributes)[]), ...attrs });
    }
    this.commit(p, "objects", ids);
  }

  setLineMarkers(ids: string[], ends: { start?: LineMarker | null; end?: LineMarker | null }): void {
    const p = this.plan();
    for (const id of new Set(ids)) {
      const r = this.object(id);
      if (!MARKED_TYPES.has(r.type)) continue;
      const aux = r.children.find((c) => c.type === LINE_MARKERS);
      if (aux) {
        writeMarkers(p.mut(aux.index), ends);
      } else if (ends.start || ends.end) {
        const d = this.newAux(LINE_MARKERS, NEW_MARKERS);
        writeMarkers(d, ends);
        // ahead of the shadow, where Vectorworks keeps it
        this.addAux(p, r, d, DROP_SHADOW);
      }
    }
    this.commit(p, "objects", ids);
  }

  setDropShadow(ids: string[], shadow: DropShadow | null): void {
    const p = this.plan();
    for (const id of new Set(ids)) {
      const r = this.object(id);
      const aux = r.children.slice(0, auxCount(r)).find((c) => c.type === DROP_SHADOW && c.data.length >= SHADOW_BYTES);
      if (aux) {
        writeDropShadow(p.mut(aux.index), shadow);
      } else if (shadow) {
        const d = this.newAux(DROP_SHADOW, NEW_SHADOW);
        writeDropShadow(d, shadow);
        // last, where Vectorworks keeps it
        this.addAux(p, r, d);
      }
    }
    this.commit(p, "objects", ids);
  }

  /**
   * A new aux record of `type` holding `body`. Its header copies one of that type already in the
   * file, as some of its flag bytes are not understood, else the bytes they all carry.
   */
  private newAux(type: number, body: Uint8Array): Uint8Array {
    const d = new Uint8Array(0x50 + body.length);
    let like = this.auxHeaders.get(type);
    if (like === undefined) {
      like = this.doc.recs.find((r) => r.type === type)?.data.slice(0, 0x50) ?? null;
      this.auxHeaders.set(type, like);
    }
    if (like) {
      d.set(like);
    } else {
      d[0x19] = type;
      d[0x1f] = 0x40;
      d[0x2f] = 0x02;
    }
    setU64(d, 0x10, 0n);
    d.fill(0, 0x48, 0x50);
    d.set(body, 0x50);
    recOfData(d).guid = newGuid();
    return d;
  }

  /**
   * Attaches the aux record `d` to `r`: ahead of its aux record of type `before` when it has one,
   * else last in its aux part (whose last record has next = 0), before any objects it holds.
   */
  private addAux(p: Plan, r: Rec, d: Uint8Array, before?: number): void {
    this.addAuxes(p, r, [d], before);
  }

  /** Attaches the aux records `ds`, in their order, to `r` as addAux attaches one: once per object in a plan. */
  private addAuxes(p: Plan, r: Rec, ds: readonly Uint8Array[], before?: number): void {
    if (!ds.length) return;
    const aux = r.children.slice(0, auxCount(r));
    // +0x10 is non-zero exactly when a record has aux records
    if (u64(p.cur(r.index), 0x10) === 0n) setU64(p.mut(r.index), 0x10, this.freshAddr());
    const ahead = before === undefined ? undefined : aux.find((c) => c.type === before);
    const last = aux.at(-1);
    // the first aux records: of a list of objects alone, or a new list
    const owner = ahead?.owner ?? last?.owner ?? r.children[0]?.owner ?? this.freshAddr();
    for (const d of ds) {
      setOwner(d, owner);
      setNext(d, true);
    }
    if (ahead) {
      p.insert(ahead.index, [...ds]);
      return;
    }
    setNext(ds[ds.length - 1], false);
    if (last) {
      setNext(p.mut(last.index), true);
      p.insert(subtreeEnd(last) + 1, [...ds]);
    } else p.insert(r.index + 1, [...ds]);
  }

  /** Takes an attribute group from the objects' classes, or gives them the values they draw with. */
  setAttributesByClass(ids: string[], group: ByClassGroup, on: boolean): void {
    const p = this.plan();
    for (const id of new Set(ids)) {
      for (const r of withFaces(this.object(id))) {
        if (r.data.length < ATTR_END) continue;
        const d = p.mut(r.index);
        if (on) setU16(d, BY_CLASS, u16(d, BY_CLASS) | BY_CLASS_BITS[group]);
        else writeAttrs(d, this.classGroups(r, BY_CLASS_KEYS[group]));
      }
    }
    this.commit(p, "objects", ids);
  }

  /** The drawn values of the by-class groups these fields belong to. */
  private classGroups(r: Rec, keys: readonly (keyof Attributes)[]): Partial<Attributes> {
    const a = this.doc.attrsOf(r);
    if (!a || r.data.length < ATTR_END) return {};
    const flags = u16(r.data, BY_CLASS);
    const out: Partial<Attributes> = {};
    for (const k of keys) {
      const g = byClassGroup(k);
      if (flags & BY_CLASS_BITS[g]) for (const f of BY_CLASS_KEYS[g]) out[f] = a[f];
    }
    return out;
  }

  transformObjects(ids: string[], m: Affine): void {
    if (![m.a, m.b, m.c, m.d, m.e, m.f].every(Number.isFinite)) throw new Error("transform is not finite");
    const recs = this.topmost(ids);
    const mirrored = m.a * m.d - m.b * m.c < 0;
    for (const r of recs) {
      for (const o of movedWalk(r)) {
        if (TURNABLE.has(o.type)) {
          if (!keepsFrame(m)) throw new Error(`scaling ${typeLabel(o.type)} objects isn't supported yet`);
          // a camera looks one way and a Heliodon's sun shines one way: mirrored, their frames would turn inside out
          const plugin = mirrored && o.type === PLUGIN ? this.doc.pluginName(o) : null;
          if (plugin === CAMERA_PLUGIN || plugin === HELIODON) throw new Error(`mirroring ${plugin === HELIODON ? "Heliodons" : "cameras"} isn't supported yet`);
        } else if (!MOVABLE.has(o.type)) throw new Error(`transforming ${typeLabel(o.type)} objects isn't supported yet`);
      }
    }
    const p = this.plan();
    // the walls joined to a wall that turns or mirrors follow it
    const follow = this.wallFollowers(p, recs.filter((r) => r.type === WALL), mirrored);
    this.transformTrees(p, recs, m);
    const followed = follow().filter((w) => !recs.includes(w));
    this.commit(p, "objects", [...ids, ...followed.map(guidOf)]);
  }

  /**
   * Puts `recs` and what moves with them through m, which the caller has checked they take, and
   * fits their groups. `bareSolids` lets solid additions with nothing in their bare frame (a wall's)
   * take a stretch, which a frame can't.
   */
  private transformTrees(p: Plan, recs: readonly Rec[], m: Affine, bareSolids = false): void {
    const leaves: Rec[] = [];
    const added = new Map<Rec, Uint8Array[]>();
    for (const r of recs) {
      for (const o of movedWalk(r)) {
        if ((o.type === EXTRUDE || o.type === MULTI_EXTRUDE || o.type === SWEEP) && !keepsFrame(m)) {
          this.scaleExtrude(p, o, m);
          leaves.push(o);
          continue;
        }
        const bare = bareSolids && o.type === SOLID && !objectChildren(o).length;
        const next = bare ? transformBareSolid(p.cur(o.index), m) : transformRecord(p.cur(o.index), o.type, m);
        if (next) {
          p.set(o.index, next);
          this.carry(p, o, m);
          this.carryCamera(p, o, m);
          // a body has no plan box to fit its group to: the group's own boxes went through m
          if (o.type === BODY) continue;
        } else if (TURNABLE.has(o.type) || bare) {
          throw new Error(`this ${typeLabel(o.type)}'s record is too short to transform`);
        } else {
          // the shape can't keep its type under m: replace it with a polygon
          const poly = this.asPolygon(o, m);
          p.remove(o.index, subtreeEnd(o));
          p.insert(o.index, poly);
          if (o.parent) added.set(o.parent, [...(added.get(o.parent) ?? []), poly[0]]);
        }
        leaves.push(o);
      }
    }
    this.refitGroups(p, leaves, added);
  }

  /**
   * Scales an extrude or multiple extrude through m, which its frame can't take (frames only
   * turn): its profiles take the scale in its own plane and its heights the part along its axis.
   * Its body would no longer match, so it goes; Vectorworks saves most extrudes without one, and
   * draws a multiple extrude without one as a loft (FORMAT.md §3D).
   */
  private scaleExtrude(p: Plan, o: Rec, m: Affine): void {
    const what = o.type === EXTRUDE ? "extrudes" : o.type === SWEEP ? "sweeps" : "multiple extrudes";
    const scale = extrudeScale(p.cur(o.index), m);
    if (!scale) throw new Error(`scaling ${what} tilted against the scale isn't supported yet`);
    // a sweep stays one when its profile's plane takes the same factor across the axis as its depth
    // does, and none of its height (own y) leaks into it
    const sp = scale.profile;
    const tol = 1e-9 * Math.max(1, Math.abs(sp.a), Math.abs(sp.d), Math.abs(scale.height));
    if (o.type === SWEEP && (Math.abs(sp.b) > tol || Math.abs(sp.c) > tol || !(sp.a > 0) || Math.abs(sp.a - scale.height) > tol)) {
      throw new Error("scaling sweeps other than evenly across their axis isn't supported yet");
    }
    const profiles = objectChildren(o);
    if (!profiles.length) throw new Error(`this ${what.slice(0, -1)} has no profile to scale`);
    let bounds: BBox | null = null;
    let gone = -1; // the end of a subtree replaced whole, by a polygon
    for (const x of profiles.flatMap((r) => [...movedWalk(r)])) {
      if (x.index <= gone) continue;
      if (!MOVABLE.has(x.type)) throw new Error(`scaling ${what} of ${typeLabel(x.type)} objects isn't supported yet`);
      // a rectangle whose bbox is stale starts from its frame
      let src = p.cur(x.index);
      const stale = staleRectBounds(x);
      if (stale) {
        src = src.slice();
        writeBBox(src, stale);
      }
      let d = transformRecord(src, x.type, scale.profile);
      if (d) {
        p.set(x.index, d);
        for (const c of x.children) if (c.type === FILL_MAPPING) transformFillMapping(p.mut(c.index), scale.profile);
      } else {
        const poly = this.asPolygon(x, scale.profile);
        setNext(poly[0], x.hasNext);
        gone = subtreeEnd(x);
        p.remove(x.index, gone);
        p.insert(x.index, poly);
        d = poly[0];
      }
      if (profiles.includes(x)) bounds = unionBox(bounds, readBBox(d));
    }
    if (!bounds) throw new Error(`this ${what.slice(0, -1)}'s profile has no bounds`);
    const aux = o.children.slice(0, auxCount(o));
    const kept = aux.filter((c) => c.type !== BODY);
    for (const c of aux) if (c.type === BODY) p.remove(c.index, subtreeEnd(c));
    // the aux list ends at its first record without a next mark, and +0x10 is set only while there is one
    if (!kept.length) setU64(p.mut(o.index), 0x10, 0n);
    else if (kept.at(-1) !== aux.at(-1)) setNext(p.mut(kept.at(-1)!.index), false);
    if (o.type !== SWEEP) placeScaledExtrude(p.mut(o.index), m, bounds, scale.height);
    else {
      const d = p.mut(o.index);
      placeScaledSweep(d, m, sp.a, sp.d);
      // as bodiless sweeps have it
      setU32(d, SWEEP_REF, 0xffffffff);
    }
  }

  /** Polygon records tracing `rec`'s transformed outline, keeping its id, class and attributes. */
  private asPolygon(rec: Rec, m: Affine): Uint8Array[] {
    const shape = decodeShape(rec);
    if (!shape) throw new Error(`can't transform this ${rec.typeName}`);
    let pts = shape.points;
    let closed = shape.closed;
    if (shape.kind === "arc" && shape.center) {
      const sweep = shape.sweepAngle ?? 360;
      const n = Math.max(8, Math.ceil((Math.abs(sweep) / 360) * 96));
      closed = Math.abs(sweep) >= 360;
      pts = [];
      for (let i = 0; i < (closed ? n : n + 1); i++) {
        const a = (((shape.startAngle ?? 0) + (sweep * i) / n) * Math.PI) / 180;
        pts.push({ x: shape.center.x + (shape.rx ?? 0) * Math.cos(a), y: shape.center.y + (shape.ry ?? 0) * Math.sin(a) });
      }
    }
    const recs = this.instantiate(this.template(5), rec.owner);
    const d = writeGeometry(recs[0], { kind: "polygon", points: pts.map((q) => applyAffine(m, q)), closed });
    d.set(rec.data.subarray(0x38, 0x48), 0x38); // same GUID: it is the same object
    setU16(d, 0x1a, 0);
    setU32(d, 0x20, rec.classIndex);
    d.set(rec.data.subarray(0x50, ATTR_END), 0x50);
    recs[0] = d;
    return recs;
  }

  arrangeObjects(ids: string[], to: Arrange): void {
    const byParent = new Map<Rec, Set<Rec>>();
    for (const r of this.topmost(ids)) {
      if (!r.parent) continue;
      const set = byParent.get(r.parent) ?? new Set<Rec>();
      set.add(r);
      byParent.set(r.parent, set);
    }
    const p = this.plan();
    for (const [parent, sel] of byParent) {
      const kids = objectChildren(parent);
      for (let i = 1; i < kids.length; i++) {
        if (subtreeEnd(kids[i - 1]) + 1 !== kids[i].index) throw new Error(`can't reorder the contents of this ${parent.typeName}`);
      }
      const order = kids.slice();
      const swap = (i: number, j: number) => ([order[i], order[j]] = [order[j], order[i]]);
      if (to === "front") order.sort((a, b) => Number(sel.has(a)) - Number(sel.has(b)));
      else if (to === "back") order.sort((a, b) => Number(sel.has(b)) - Number(sel.has(a)));
      else if (to === "forward") {
        for (let i = order.length - 2; i >= 0; i--) if (sel.has(order[i]) && !sel.has(order[i + 1])) swap(i, i + 1);
      } else {
        for (let i = 1; i < order.length; i++) if (sel.has(order[i]) && !sel.has(order[i - 1])) swap(i, i - 1);
      }
      if (order.every((r, i) => r === kids[i])) continue;
      // the list end marker (next=0) belongs to the position, not the object
      const flags = kids.map((k) => u64(k.data, 0x08));
      const block: Uint8Array[] = [];
      order.forEach((r, i) => {
        let root = p.cur(r.index);
        if (u64(root, 0x08) !== flags[i]) {
          root = root.slice();
          setU64(root, 0x08, flags[i]);
        }
        block.push(root);
        for (let j = r.index + 1; j <= subtreeEnd(r); j++) block.push(p.cur(j));
      });
      const end = subtreeEnd(kids[kids.length - 1]);
      p.remove(kids[0].index, end);
      p.insert(end + 1, block);
    }
    this.commit(p, "objects", ids);
  }

  /** An empty container like `rec`: the record, its aux records and its terminator. */
  private shellOf(rec: Rec): Template {
    const k = auxCount(rec);
    const aux = rec.children.slice(0, k);
    const keep = new Set(aux);
    const term = rec.children.at(-1);
    if (term?.type !== 0) throw new Error(`${rec.typeName} has no terminator`);
    keep.add(term);
    // a symbol definition's groups of geometry among its aux records come without their geometry
    const emptied = new Set(aux.filter((c) => c.type === 11 && objectChildren(c).length));
    const t = templateOf(rec, (r, depth) => (depth === 1 && !keep.has(r)) || (depth === 2 && emptied.has(r.parent!) && r.type !== 0 && objectChildren(r.parent!).includes(r)));
    for (const g of emptied) {
      const d = g.data.slice();
      // no plan drawing and no 3D content, as the empty group every definition keeps has
      writeGroupBox(d, null);
      [-1, -1, -1, 1, 1, 1].forEach((sign, i) => setF64(d, 0x9c + 8 * i, sign * Number.MAX_VALUE));
      t.recs[t.recs.indexOf(g.data)] = d;
    }
    return t;
  }

  /** The symbol definition new ones are cloned from: one at the top of the resource library, best one with no records attached and no geometry kept among its aux records. */
  private symbolTemplate(): { tpl: Rec | null; sibling: Rec } {
    const lib = this.doc.recs.find((r) => r.type === 54);
    const defs = this.doc.recs.filter((r) => r.type === 16);
    if (!lib) throw new Error("this file has no resource library");
    const sibling = lib.children.find((c) => c.type === 16 || c.type === 92) ?? lib.children.at(-1);
    if (!sibling) throw new Error("the resource library has no end");
    if (!defs.length) return { tpl: null, sibling };
    const plain = (d: Rec) => d.children.slice(0, auxCount(d)).every((c) => c.type !== 48 && !(c.type === 11 && objectChildren(c).length));
    const top = defs.filter((d) => d.parent === lib);
    const tpl = top.find(plain) ?? defs.find(plain) ?? top[0] ?? defs[0];
    return { tpl, sibling };
  }

  /** A drawing's first symbol: an empty resource library among the root's document data, before its classes. */
  private addSymbolLibrary(): void {
    const classes = this.doc.recs.find((r) => r.type === 57);
    if (!classes) throw new Error("this file has no class list to put a resource library beside");
    const p = this.plan();
    p.insert(classes.index, this.instantiate(symbolLibraryTemplate(), classes.owner));
    this.commit(p, "all", []);
  }

  private groupShell(): Template {
    let best: Rec | null = null;
    for (const layer of this.doc.layerRecs) {
      for (const r of objectWalk(layer)) {
        // one with a record attached would pass it on to the new group
        if (r.type === 11 && r.children.at(-1)?.type === 0 && (!best || auxCount(r) < auxCount(best)) && !r.children.slice(0, auxCount(r)).some((c) => c.type === RECORD)) best = r;
      }
    }
    if (!best) return builtinTemplates().get(11)!;
    return this.shellOf(best);
  }

  groupObjects(ids: string[]): string {
    const p = this.plan();
    const id = this.groupIn(p, ids);
    this.commit(p, "objects", [id]);
    return id;
  }

  groupEach(sets: readonly string[][]): string[] {
    const p = this.plan();
    // the shell found once: finding it walks the whole drawing
    const shell = sets.length ? this.groupShell() : null;
    const ids = sets.map((ids) => this.groupIn(p, ids, shell!));
    if (ids.length) this.commit(p, "objects", ids);
    return ids;
  }

  /** Groups the objects in plan `p` (groupObjects), returning the group's id. */
  private groupIn(p: Plan, ids: string[], template = this.groupShell()): string {
    const recs = this.topmost(ids).sort((a, b) => a.index - b.index);
    if (!recs.length) throw new Error("nothing to group");
    const parent = recs[0].parent;
    if (!parent || recs.some((r) => r.parent !== parent)) {
      throw new Error("objects to group must be in the same layer or group");
    }
    const shell = this.instantiate(template, recs[0].owner);
    const term = shell[shell.length - 1];
    const inner = u64(term, 0x26);
    const moved: Uint8Array[] = [];
    let box: BBox | null = null;
    for (const r of recs) {
      const end = subtreeEnd(r);
      const root = p.cur(r.index).slice();
      setOwner(root, inner);
      setNext(root, true);
      moved.push(root);
      for (let i = r.index + 1; i <= end; i++) moved.push(p.cur(i));
      box = unionBox(box, readBBox(root));
      p.remove(r.index, end);
    }
    const g = shell[0];
    setU16(g, 0x1a, 0);
    const classes = new Set(recs.map((r) => r.classIndex));
    setU32(g, 0x20, classes.size === 1 ? recs[0].classIndex : this.noneClass());
    writeGroupBox(g, box);
    const last = recs[recs.length - 1];
    if (!last.hasNext) setNext(g, false);
    p.insert(subtreeEnd(last) + 1, [...shell.slice(0, -1), ...moved, term]);
    return recOfData(g).guid;
  }

  ungroupObjects(ids: string[]): string[] {
    const p = this.plan();
    const out: string[] = [];
    const removed: Rec[] = [];
    const added = new Map<Rec, Uint8Array[]>();
    for (const g of this.topmost(ids)) {
      if (g.type !== 11) {
        out.push(g.guid);
        continue;
      }
      const kids = objectChildren(g);
      const moved: Uint8Array[] = [];
      kids.forEach((k, i) => {
        const root = p.cur(k.index).slice();
        setOwner(root, g.owner);
        setNext(root, i < kids.length - 1 || g.hasNext);
        moved.push(root);
        for (let j = k.index + 1; j <= subtreeEnd(k); j++) moved.push(p.cur(j));
        out.push(k.guid);
        if (g.parent) added.set(g.parent, [...(added.get(g.parent) ?? []), root]);
      });
      p.remove(g.index, subtreeEnd(g));
      p.insert(g.index, moved);
      removed.push(g);
    }
    if (!removed.length) return out;
    this.refitGroups(p, removed, added);
    this.commit(p, "objects", out);
    return out;
  }

  copyObjects(ids: string[]): ClipboardData {
    return this.clipboardOf(this.topmost(ids).sort((a, b) => a.index - b.index));
  }

  /** Records (each with what it holds) as clipboard data: their bytes, class names, line types and symbol names. */
  private clipboardOf(recs: readonly Rec[]): ClipboardData {
    const lineTypes = new Map(this.doc.lineTypes().map((t) => [t.style, t.name]));
    const materials = new Set(this.doc.resources().flatMap((x) => (x.kind === "material" ? [x.index] : [])));
    const records: ClipboardRecord[] = [];
    let box: BBox | null = null;
    for (const r of recs) {
      const objects = new Set(objectWalk(r));
      const moved = new Set(movedWalk(r));
      for (const o of objects) {
        if ((moved.has(o) && !COPIED.has(o.type)) || o.data.length < ATTR_END) throw new Error(`copying ${typeLabel(o.type)} objects isn't supported yet`);
        if (moved.has(o) && o.type !== 11) box = unionBox(box, this.planBox(o));
      }
      const t = templateOf(r);
      const base = records.length;
      let i = 0;
      for (const src of r.walk()) {
        // each record's first 8 bytes are its length, as saving writes them
        const d = t.recs[i].slice();
        setU64(d, 0, BigInt(d.length));
        const entry: ClipboardRecord = {
          data: toBase64(d),
          parent: t.parent[i] < 0 ? -1 : base + t.parent[i],
          className: objects.has(src) ? this.doc.className(src.classIndex) || NONE_CLASS : "",
        };
        if (t.parent[i] < 0) entry.elevation = layerElevationOf(r);
        if (objects.has(src)) {
          const style = i32(src.data, 0x50);
          if (style < 0 && lineTypes.has(style)) entry.lineType = lineTypes.get(style);
          if (src.type === 15) entry.symbol = this.doc.names.get(u16(src.data, 0x8e)) ?? "";
          Object.assign(entry, this.namedRefs(src, materials));
        } else if (src.type === RECORD) {
          const format = this.doc.names.get(recordFormat(src.data));
          if (format) entry.format = format;
        } else if (isTextureDict(src)) {
          const names = readTextureParts(src.data).map((x) => (x.texture > 0 ? (this.doc.names.get(x.texture) ?? "") : ""));
          if (names.some(Boolean)) entry.textures = names;
        }
        records.push(entry);
        i++;
      }
    }
    return { format: CLIPBOARD_FORMAT, records, bbox: box, drawing: this.drawing };
  }

  pasteObjects(layerId: string, data: ClipboardData, dx = 0, dy = 0): string[] {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error("offset is not a finite number");
    const into = this.container(layerId);
    return this.batch(() => {
      const ids = this.pasteAt(this.slot(into), data, dx, dy, into);
      // each as high above this layer as it was above the one it was copied from (one pasted
      // before Rodeo noted that is left at the height it had)
      const z = layerElevationOf(into);
      const from = data.records.filter((r) => r.parent === -1).map((r) => r.elevation);
      const by = new Map<number, string[]>();
      ids.forEach((id, i) => {
        const e = from[i];
        if (typeof e === "number" && Number.isFinite(e) && e !== z) by.set(z - e, [...(by.get(z - e) ?? []), id]);
      });
      for (const [dz, lifted] of by) this.liftObjects(lifted, dz);
      return ids;
    });
  }

  /** Clipboard data's objects inserted at `at` among the records `owner` holds, moved by (dx, dy); their ids. */
  /**
   * Pastes at a slot; `into`, the layer or open definition the slot is in, has its bounds refitted.
   * `replace` takes out records in the same step first (a definition's old contents) and names them.
   */
  private pasteAt({ owner, at }: { owner: bigint; at: number }, data: ClipboardData, dx: number, dy: number, into?: Rec, replace?: (p: Plan) => Rec[]): string[] {
    const items = readClipboard(data, this.drawing);
    const here = data.drawing === this.drawing;
    const sheet = into?.type === 31 && into.data[layerKindAt(into.data)] === 2;
    for (const g of items) {
      const type = g.data[0x19];
      if (!g.object || g.held) continue;
      if (into?.type === 16 && !SYMBOL_PARTS.has(type)) throw new Error(`${typeLabel(type)} objects can't go into a symbol yet`);
      if (sheet && (type === WALL || type === SLAB || type === LIGHT)) throw new Error(`${typeLabel(type)} objects go on design layers, not sheets`);
    }
    const none = this.noneClass();
    const styles = new Map(this.doc.lineTypes().map((t) => [t.name, t.style]));
    const symbols = new Map<string, number>();
    for (const [index] of this.doc.symbols) {
      const name = this.doc.names.get(index);
      if (name) symbols.set(name, index);
    }
    // plug-ins' parameter formats among them
    const formats = new Map(this.doc.recs.flatMap((r) => (r.type === RECORD_FORMAT && r.nameIndex ? [[this.doc.names.get(r.nameIndex) ?? "", r.nameIndex] as const] : [])));
    const refs = this.refTables();
    const textures = new Map(this.doc.resources().filter((r) => r.kind === "texture").map((r) => [r.name, r.index]));
    const p = this.plan();
    const removed = replace?.(p) ?? [];
    const out: string[] = [];
    const roots: Uint8Array[] = [];
    for (let start = 0; start < items.length; ) {
      let end = start + 1;
      while (end < items.length && items[end].parent !== -1) end++;
      // an attached record whose format this drawing lacks stays out, with what it holds
      const left = new Set<number>();
      for (let i = start; i < end; i++) {
        const g = items[i];
        if ((g.format !== undefined && !formats.has(g.format)) || left.has(g.parent)) left.add(i);
      }
      const kept = [...Array(end - start).keys()].map((k) => start + k).filter((i) => !left.has(i));
      const position = new Map(kept.map((i, k) => [i, k]));
      const group = kept.map((i) => items[i]);
      const t: Template = { recs: group.map((g) => g.data), parent: group.map((g) => (g.parent < 0 ? -1 : position.get(g.parent)!)) };
      const copies = this.instantiate(t, owner);
      // one left out that ended its object's aux records hands that end to the one before it
      for (const i of left) {
        const g = items[i];
        if (left.has(g.parent) || u64(g.data, 0x08) !== 0n) continue;
        const before = kept.filter((j) => j < i && items[j].parent === g.parent).at(-1);
        if (before !== undefined) setNext(copies[position.get(before)!], false);
      }
      group.forEach((g, i) => {
        if (copies[i][0x19] === FILL_MAPPING && g.parent >= 0 && items[g.parent].object && !items[g.parent].held) {
          transformFillMapping(copies[i], translation(dx, dy));
        }
        if (copies[i][0x19] === BODY && g.parent >= 0 && !items[g.parent].held && BODY_IN_PARENT.has(items[g.parent].data[0x19])) {
          moveBodyPoints(copies[i], translation(dx, dy));
        }
        if (g.format !== undefined) setU16(copies[i], 0x50, formats.get(g.format)!);
        // a camera's eye and look-to point go with it (carryCamera)
        const up = g.parent >= 0 ? items[g.parent] : undefined;
        if (g.format === CAMERA_PLUGIN && up?.object && !up.held && up.data[0x19] === PLUGIN) {
          const fmt = this.doc.formatDef(formats.get(g.format)!);
          if (fmt?.parametric) copies[i] = cameraRecordThrough(copies[i], fmt, translation(dx, dy));
        }
        // a texture this drawing lacks leaves the part without one
        g.textures?.forEach((name, k) => {
          if (name) writeTexturePart(copies[i], readTextureParts(copies[i])[k]?.part ?? -1, { texture: textures.get(name) ?? -1 });
        });
        if (!g.object) return;
        const d = copies[i];
        this.remapRefs(p, d, g, refs);
        if (!g.held) translateRecord(d, d[0x19], dx, dy);
        setU16(d, 0x1a, 0);
        // in the drawing it came from a class still there, or none (a wall's bodies), stays; elsewhere it goes by name
        const cls = u32(d, 0x20);
        if (!(here && (cls === 0 || this.doc.classRecs.has(cls)))) setU32(d, 0x20, this.doc.classIndexByName(g.className) ?? none);
        if (i32(d, 0x50) < 0) setI32(d, 0x50, (g.lineType !== undefined && styles.get(g.lineType)) || 2);
        if (d[0x19] === 15) {
          const sym = symbols.get(g.symbol ?? "");
          if (sym === undefined) throw new Error(`symbol "${g.symbol ?? "?"}" isn't in this document`);
          if (into?.type === 16 && (sym === into.nameIndex || this.holdsSymbol(sym, into.nameIndex))) {
            throw new Error("a symbol can't be placed inside itself");
          }
          setU16(d, 0x8e, sym);
        }
      });
      p.insert(at, copies);
      roots.push(copies[0]);
      out.push(recOfData(copies[0]).guid);
      start = end;
    }
    if (!out.length) return out;
    if (into) this.refitGroups(p, removed, new Map([[into, roots]]));
    this.commit(p, "objects", out);
    return out;
  }

  /**
   * Where an object lies in plan: its saved box, else (2026 files save walls and plug-ins unbounded)
   * the box of what it draws, else a plug-in's insertion point.
   */
  private planBox(r: Rec): BBox | null {
    const saved = readBBox(r.data);
    if (saved) return saved;
    let box: BBox | null = null;
    for (const o of r.walk()) {
      const info = this.doc.object(guidOf(o));
      const b = info?.bounds ?? info?.shape?.bbox;
      if (b && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite)) box = unionBox(box, b);
    }
    if (box || r.type !== PLUGIN || r.data.length < PLUGIN_MATRIX + 96) return box;
    const m = readPluginMatrix(r.data);
    return Number.isFinite(m.e) && Number.isFinite(m.f) ? { x0: m.e, y0: m.f, x1: m.e, y1: m.f } : null;
  }

  /**
   * What an object names by index that another drawing numbers its own way: its colours, fill
   * resource, material (one of `materials`), font and text style.
   */
  private namedRefs(r: Rec, materials: ReadonlySet<number>): { colors?: string[]; fill?: string; material?: string; font?: string; textStyle?: string } {
    const d = r.data;
    if (d.length < ATTR_END) return {};
    const out: { colors?: string[]; fill?: string; material?: string; font?: string; textStyle?: string } = { colors: COLOR_SLOTS.map((o) => this.doc.color(u16(d, o))) };
    const fill = i16(d, FILL_PATTERN);
    const fillName = fill < 0 ? this.doc.names.get(-fill) : undefined;
    if (fillName) out.fill = fillName;
    const material = MATERIAL_TYPES.has(r.type) && d.length >= MATERIAL_AT + 4 ? u32(d, MATERIAL_AT) : 0;
    const materialName = materials.has(material) ? this.doc.names.get(material) : undefined;
    if (materialName) out.material = materialName;
    if (r.type === 10) {
      const font = this.doc.fonts()[u16(d, textFaceAt(d))];
      if (font) out.font = font;
      const at = textStyleAt(d);
      const style = at + 4 <= d.length ? i32(d, at) : 0;
      const styleName = style > 0 ? this.doc.names.get(style) : undefined;
      if (styleName) out.textStyle = styleName;
    }
    return out;
  }

  addColors(css: readonly string[]): number[] {
    const want = css.map((c) => c.toLowerCase());
    const table = this.doc.colors();
    // white and black as 256 and 257, the default fill and pen nearly every object has
    const have = new Map<string, number>();
    for (const c of table) if (c.index === WHITE || c.index === BLACK) have.set(c.css.toLowerCase(), c.index);
    for (const c of table) if (!have.has(c.css.toLowerCase())) have.set(c.css.toLowerCase(), c.index);
    const fresh = [...new Set(want.filter((c) => /^#[0-9a-f]{6}$/.test(c) && !have.has(c)))];
    const rec = fresh.length ? this.doc.roots.find((r) => r.type === AUX_RECORD && addTableColors(r.data, []) !== null) : undefined;
    const added = rec ? addTableColors(rec.data, fresh) : null;
    if (rec && added) {
      const p = this.plan();
      p.set(rec.index, added.data);
      this.commit(p, "objects", []);
      fresh.forEach((c, i) => have.set(c, added.indices[i]));
    }
    // no table to add to: the nearest of the drawing's colours, black when it lists none
    const rgb = (c: string): number[] => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) || 0);
    return want.map((c) => {
      const exact = have.get(c);
      if (exact !== undefined) return exact;
      const [r, g, b] = rgb(c);
      let best = BLACK;
      let d = Infinity;
      for (const t of table) {
        const [r2, g2, b2] = rgb(t.css);
        const e = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
        if (e < d) {
          d = e;
          best = t.index;
        }
      }
      have.set(c, best);
      return best;
    });
  }

  /** This drawing's fill resources, materials and text styles by name, and the colour index for a colour (null without a colour table). */
  private refTables(): { fills: Map<string, number>; materials: Map<string, number>; textStyles: Map<string, number>; color: ((css: string, prefer: number) => number) | null } {
    const resources = this.doc.resources();
    const fills = new Map(resources.filter((r) => FILL_KINDS.has(r.kind)).map((r) => [r.name, r.index]));
    const materials = new Map(resources.filter((r) => r.kind === "material").map((r) => [r.name, r.index]));
    const textStyles = new Map(resources.filter((r) => r.kind === "text-style").map((r) => [r.name, r.index]));
    const table = this.doc.colors();
    if (!table.length) return { fills, materials, textStyles, color: null };
    const byCss = new Map<string, number>();
    for (const c of table) if (!byCss.has(c.css.toLowerCase())) byCss.set(c.css.toLowerCase(), c.index);
    const rgb = (css: string): number[] => [1, 3, 5].map((i) => parseInt(css.slice(i, i + 2), 16));
    const nearest = new Map<string, number>();
    // the index it has when that is the colour here, else one that is, else the nearest
    const color = (css: string, prefer: number): number => {
      const want = css.toLowerCase();
      if (this.doc.color(prefer).toLowerCase() === want) return prefer;
      const same = byCss.get(want) ?? nearest.get(want);
      if (same !== undefined) return same;
      const [r, g, b] = rgb(want);
      let best = Infinity;
      let to = prefer;
      for (const c of table) {
        const [r2, g2, b2] = rgb(c.css);
        const dist = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
        if (dist < best) [best, to] = [dist, c.index];
      }
      nearest.set(want, to);
      return to;
    };
    return { fills, materials, textStyles, color };
  }

  /** Points a pasted object's colours, fill resource, material, font and text style at this drawing's own, matched by value and name. */
  private remapRefs(p: Plan, d: Uint8Array, g: PasteItem, refs: ReturnType<Session["refTables"]>): void {
    if (d.length < ATTR_END) return;
    if (g.colors && refs.color) COLOR_SLOTS.forEach((o, k) => setU16(d, o, refs.color!(g.colors![k], u16(d, o))));
    // a fill resource this drawing lacks becomes a solid fill
    if (g.fill !== undefined && i16(d, FILL_PATTERN) < 0) {
      const index = refs.fills.get(g.fill);
      setI16(d, FILL_PATTERN, index !== undefined ? -index : SOLID_FILL);
    }
    // a material this drawing lacks leaves it without one
    if (g.material !== undefined && MATERIAL_TYPES.has(d[0x19]) && d.length >= MATERIAL_AT + 4) setU32(d, MATERIAL_AT, refs.materials.get(g.material) ?? 0);
    if (d[0x19] !== 10) return;
    if (g.font !== undefined) setU16(d, textFaceAt(d), this.fontIndex(p, g.font));
    const at = textStyleAt(d);
    if (g.textStyle !== undefined && at + 4 <= d.length) setI32(d, at, refs.textStyles.get(g.textStyle) ?? 0);
  }

  copySymbol(index: number): ClipboardData {
    const def = this.doc.symbols.get(index);
    if (!def) throw new Error("no such symbol");
    // without the empty group every definition keeps among its aux records; the new one has its own
    const k = auxCount(def);
    const parts = objectChildren(def).filter((c) => !(c.type === 11 && def.children.indexOf(c) < k && !objectChildren(c).length));
    if (!parts.length) throw new Error("the symbol's definition is empty");
    return this.clipboardOf(parts);
  }

  importSymbol(name: string, data: ClipboardData): number {
    return this.batch(() => this.importSymbolStep(name, data));
  }

  private importSymbolStep(name: string, data: ClipboardData): number {
    this.checkName(name);
    if (!readClipboard(data, this.drawing).length) throw new Error("the symbol is empty");
    // a new definition goes at the top level of the resource library, cloned from one already there
    if (!this.doc.recs.some((r) => r.type === 54)) this.addSymbolLibrary();
    const { tpl, sibling } = this.symbolTemplate();
    const shell = this.instantiate(tpl ? this.shellOf(tpl) : symbolDefinitionTemplate(), sibling.owner);
    const index = this.freshName();
    setU16(shell[0], 0x1a, index);
    writeBBox(shell[0], data.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 });
    const p = this.plan();
    const names = new Map(this.doc.names);
    names.set(index, name);
    this.writeNames(p, names);
    p.insert(sibling.index, shell);
    this.commit(p, "all", []);
    const def = this.doc.symbols.get(index);
    if (!def) throw new Error("the new symbol could not be found");
    this.pasteAt(this.slot(def), data, 0, 0, def);
    return index;
  }

  redefineSymbol(index: number, data: ClipboardData): void {
    const def = this.doc.symbols.get(index);
    if (!def) throw new Error("no such symbol");
    if (!readClipboard(data, this.drawing).length) throw new Error("the symbol is empty");
    const k = auxCount(def);
    // its objects, and the drawing in the groups among its aux records (those groups stay, emptied)
    const groups = def.children.slice(0, k).filter((c) => c.type === 11 && objectChildren(c).length);
    const old = [...def.children.slice(k).filter((c) => c.type !== 0), ...groups.flatMap((g) => objectChildren(g))];
    this.pasteAt(this.slot(def), data, 0, 0, def, (p) => {
      for (const r of old) p.remove(r.index, subtreeEnd(r));
      for (const g of groups) {
        const d = p.mut(g.index);
        [-1, -1, -1, 1, 1, 1].forEach((sign, i) => setF64(d, 0x9c + 8 * i, sign * Number.MAX_VALUE));
      }
      return old;
    });
  }

  /**
   * Convert to Group: each symbol instance becomes a group of copies of its definition's contents,
   * and each plug-in object a group of copies of its drawing, placed as the instance or plug-in
   * places them and where it was in the stacking order. A plug-in's group is drawn as the plug-in
   * was: in its class, with its shadow, its opacity carried into the parts and its text turned
   * past 90° turned half a turn to read the right way up. Returns the groups.
   */
  convertToGroups(ids: string[]): string[] {
    const recs = this.topmost(ids).filter((r) => r.type === 15 || r.type === PLUGIN);
    if (!recs.length) throw new Error("no symbol instances or plug-in objects to convert");
    const out: string[] = [];
    // each step commits, so every object is looked up afresh by its id
    for (const id of recs.map((r) => r.guid)) {
      const rec = this.object(id);
      const plugin = rec.type === PLUGIN;
      const from = plugin ? rec : this.doc.symbols.get(u16(rec.data, 0x8e));
      const parts = from ? objectChildren(from) : [];
      if (!parts.length) throw new Error(plugin ? "the plug-in object draws nothing" : "the symbol's definition is empty");
      // shapes and plug-in objects go through the matrix (what is in their own frames is copied as it is)
      for (const part of parts) {
        for (const o of movedWalk(part)) {
          if (!MOVABLE.has(o.type) && o.type !== PLUGIN) throw new Error(`${plugin ? "plug-in objects" : "symbols"} holding ${typeLabel(o.type)} objects can't be converted yet`);
        }
      }
      if (plugin && rec.children.some((c) => c.type === BODY || (c.type === AUX_RECORD && c.data.length >= 0x54 && String.fromCharCode(...c.data.subarray(0x50, 0x54)) === "pNIT"))) {
        throw new Error("plug-in objects whose 3D is a body or terrain of their own can't be converted yet");
      }
      // the matrix places 3D too: a raise follows, a tilt or a stretch in z can't yet
      const placed = placementIn3D(rec.data, plugin ? PLUGIN_MATRIX : SYMBOL_MATRIX);
      const scaled = !plugin && instanceScale(rec.data).some((k) => k !== 1);
      if ((placed === null || scaled) && parts.some((part) => this.shows3D(part))) {
        throw new Error(`${plugin ? "plug-in objects" : "symbols"} tilted, stretched or scaled in 3D holding 3D objects can't be converted yet`);
      }
      const copies = this.pasteAt({ owner: rec.owner, at: rec.index }, this.clipboardOf(parts), 0, 0);
      this.transformObjects(copies, plugin ? readPluginMatrix(rec.data) : readInstancePlacement(rec.data));
      if (placed) this.liftObjects(copies, placed);
      if (plugin) this.drawAsPlugin(copies, rec);
      const group = this.groupObjects(copies);
      if (plugin) {
        this.setObjectClass([group], rec.classIndex);
        const shadow = readDropShadow(rec);
        if (shadow) this.setDropShadow([group], shadow);
      }
      this.deleteObjects([id]);
      out.push(group);
    }
    return out;
  }

  /** Raises objects by dz (mm) in 3D, with what they hold (see liftRecord). */
  private liftObjects(ids: string[], dz: number): void {
    const p = this.plan();
    for (const r of this.topmost(ids)) this.lift(p, r, dz);
    this.commit(p, "objects", ids);
  }

  /**
   * Raises everything on a design layer by dz (mm) as its elevation moves by it: objects are saved
   * at their heights in the model, the layer's elevation already in them (FORMAT.md §5).
   */
  private liftLayer(p: Plan, layer: Rec, dz: number): void {
    if (dz === 0 || !Number.isFinite(dz)) return;
    for (const r of objectChildren(layer)) this.lift(p, r, dz);
  }

  private lift(p: Plan, r: Rec, dz: number): void {
    if (dz === 0) return;
    for (const o of movedWalk(r)) {
      // a wall's solid additions keep their bare frames, as moves in plan keep them (transformTrees)
      const bare = o.type === SOLID && !objectChildren(o).length && bareFrame(p.cur(o.index));
      liftRecord(p.mut(o.index), o.type, dz, bare);
      this.carry(p, o, IDENTITY, dz);
      this.carryCamera(p, o, IDENTITY, dz);
    }
  }

  /** True when an object, or a symbol or plug-in object inside it, holds 3D objects. */
  private shows3D(r: Rec, depth = 0): boolean {
    for (const o of objectWalk(r)) {
      if (MOVABLE_3D.has(o.type)) return true;
      const def = o.type === 15 && depth < 12 ? this.doc.symbols.get(u16(o.data, 0x8e)) : undefined;
      if (def && objectChildren(def).some((c) => this.shows3D(c, depth + 1))) return true;
    }
    return false;
  }

  /** A 3D polygon's record of the drawing's up to its points, to make new ones with; the built-in one when it has none. */
  private poly3dHead(): Uint8Array {
    const tpl =
      this.doc.recs.find((r) => r.type === POLY3D && r.data.length >= POLY3D_VERTS && r.data[POLY3D_CLOSED] === 1) ??
      this.doc.recs.find((r) => r.type === POLY3D && r.data.length >= POLY3D_VERTS);
    return tpl ? tpl.data.slice(0, POLY3D_VERTS) : builtinPoly3dHead();
  }

  /** New records without children as one object owned by `owner`: alone, or in a group of class `cls` when there are several. */
  private grouped(recs: Uint8Array[], owner: bigint, cls: number): Uint8Array[] {
    if (recs.length === 1) {
      const made = [this.instantiate({ recs, parent: [-1] }, owner)[0]];
      setU32(made[0], 0x20, cls);
      return made;
    }
    const shell = this.instantiate(this.groupShell(), owner);
    const term = shell[shell.length - 1];
    const inner = u64(term, 0x26);
    const g = shell[0];
    setU16(g, 0x1a, 0);
    setU32(g, 0x20, cls);
    let box: BBox | null = null;
    for (const d of recs) box = unionBox(box, readBBox(d));
    writeGroupBox(g, box);
    return [...shell.slice(0, -1), ...recs.map((d) => this.instantiate({ recs: [d], parent: [-1] }, inner)[0]), term];
  }

  convertTo3DPolygons(ids: string[]): string[] {
    const recs = this.topmost(ids);
    if (!recs.length) throw new Error("nothing to convert");
    const head = this.poly3dHead();
    return this.batch(() => {
      const out: string[] = [];
      // each step commits, so every object is looked up afresh by its id
      for (const id of recs.map((r) => r.guid)) {
        const rec = this.object(id);
        if (rec.type === POLY3D) {
          out.push(id);
          continue;
        }
        const polys = objectTriangles(this.doc, rec).flatMap(({ owner, triangles }) => facesOf(triangles).map((f) => poly3dRecord(head, f, owner)));
        // a 2D object stays as it is
        if (!polys.length) continue;
        // in the object's place, in a group of its class when there are several
        const p = this.plan();
        const made = this.grouped(polys, rec.owner, rec.classIndex);
        if (!rec.hasNext) setNext(made[0], false);
        p.remove(rec.index, subtreeEnd(rec));
        p.insert(rec.index, made);
        const top = recOfData(made[0]).guid;
        this.commit(p, "objects", [top]);
        out.push(top);
      }
      if (!out.length) throw new Error("none of these objects shows any 3D faces");
      return out;
    });
  }

  createContours(ids: string[], axis: Axis, start: number, interval: number): string[] {
    if (!(interval > 0) || !Number.isFinite(interval)) throw new Error("the interval must be more than 0");
    if (!Number.isFinite(start)) throw new Error("the first plane must be at a finite place");
    const recs = this.topmost(ids);
    if (!recs.length) throw new Error("nothing to cut");
    const head = this.poly3dHead();
    const p = this.plan();
    const out: string[] = [];
    const added = new Map<Rec, Uint8Array[]>();
    for (const r of recs) {
      const parts = objectTriangles(this.doc, r);
      let lo = Infinity;
      let hi = -Infinity;
      for (const { triangles } of parts) {
        for (let i = axis; i < triangles.length; i += 3) {
          lo = Math.min(lo, triangles[i]);
          hi = Math.max(hi, triangles[i]);
        }
      }
      if (!(lo <= hi)) continue;
      // level planes are at heights above the object's layer
      const from = axis === 2 ? start + layerElevationOf(r) : start;
      const first = Math.ceil((lo - from) / interval);
      const last = Math.floor((hi - from) / interval);
      if (last - first + 1 > MAX_CONTOURS) throw new Error(`that interval cuts an object ${last - first + 1} times; at most ${MAX_CONTOURS} contours are made per object`);
      const polys: Uint8Array[] = [];
      for (let k = first; k <= last; k++) {
        const at = from + k * interval;
        // each part on its own, drawn as it is
        for (const { owner, triangles } of parts) for (const c of contourAt(triangles, axis, at)) polys.push(poly3dRecord(head, c.points, owner, c.closed));
      }
      if (!polys.length) continue;
      // after the object, in a group of its class when there are several
      const made = this.grouped(polys, r.owner, r.classIndex);
      p.insert(subtreeEnd(r) + 1, made);
      out.push(recOfData(made[0]).guid);
      if (r.parent) added.set(r.parent, [...(added.get(r.parent) ?? []), made[0]]);
    }
    if (!out.length) throw new Error("no contour plane cuts these objects");
    this.refitGroups(p, [], added);
    this.commit(p, "objects", out);
    return out;
  }

  sectionCuts(ids: string[], a: Pt, b: Pt): SectionCut[] {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0) || !Number.isFinite(len)) throw new Error("the section line needs a length");
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const out: SectionCut[] = [];
    for (const r of this.topmost(ids)) {
      const parts: SectionCut["parts"][number][] = [];
      for (const { owner, triangles } of objectTriangles(this.doc, r)) {
        // into the plane's frame: along the line from a, across it to the left, up; then cut where across is 0
        const t = new Float64Array(triangles.length);
        for (let i = 0; i + 2 < triangles.length; i += 3) {
          const dx = triangles[i] - a.x;
          const dy = triangles[i + 1] - a.y;
          t[i] = dx * ux + dy * uy;
          t[i + 1] = dy * ux - dx * uy;
          t[i + 2] = triangles[i + 2];
        }
        const chains = contourAt(t, 1, 0).map((c) => {
          const points: Pt[] = [];
          for (let k = 0; k + 2 < c.points.length; k += 3) points.push({ x: c.points[k], y: c.points[k + 2] });
          return { points, closed: c.closed };
        });
        if (chains.length) parts.push({ attrs: this.doc.attrsOf(owner), chains });
      }
      if (parts.length) out.push({ id: r.guid, classIndex: r.classIndex, parts });
    }
    return out;
  }

  cut3DSection(ids: string[], a: Pt, b: Pt, keepLeft: boolean, layerId: string): string[] {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(len > 0) || !Number.isFinite(len)) throw new Error("the section line needs a length");
    const recs = this.topmost(ids);
    if (!recs.length) throw new Error("nothing to cut");
    const layer = this.container(layerId);
    const shell = this.meshShell();
    const frame = { a, ux: (b.x - a.x) / len, uy: (b.y - a.y) / len, side: keepLeft ? 1 : -1 };
    return this.batch(() => {
      const made: { id: string; whole?: TexturePart }[] = [];
      const block: Uint8Array[] = [];
      const roots: Uint8Array[] = [];
      for (const r of recs) {
        const faces = objectTriangles(this.doc, r).flatMap(({ owner, triangles }) =>
          facesOf(keptPart(triangles, frame))
            .flatMap(meshPieces)
            .map((corners) => ({ like: owner.data, corners })),
        );
        if (!faces.length) continue;
        const recsOut = this.instantiate(meshRecords(shell, r.classIndex, r.data, faces), this.slot(layer).owner);
        block.push(...recsOut);
        roots.push(recsOut[0]);
        const dict = textureDict(r);
        const whole = dict ? readTextureParts(dict.data).find((t) => t.part === OVERALL) : undefined;
        made.push({ id: recOfData(recsOut[0]).guid, whole });
      }
      if (!made.length) throw new Error("nothing is left on that side of the line");
      const p = this.plan();
      p.insert(this.slot(layer).at, block);
      this.refitGroups(p, [], new Map([[layer, roots]]));
      this.commit(p, "objects", made.map((m) => m.id));
      // each object's texture on its mesh, as Convert to Mesh puts it
      for (const { id, whole } of made) {
        if (!whole) continue;
        const { texture, offsetU, offsetV, scaleU, scaleV, rotation } = whole;
        this.setObjectTexture(id, OVERALL, scaleU && scaleV ? { texture, offsetU, offsetV, scaleU, scaleV, rotation } : { texture });
      }
      return made.map((m) => m.id);
    });
  }

  convertToMeshes(ids: string[]): string[] {
    const recs = this.topmost(ids);
    if (!recs.length) throw new Error("nothing to convert");
    const shell = this.meshShell();
    return this.batch(() => {
      const out: string[] = [];
      // each step commits, so every object is looked up afresh by its id
      for (const id of recs.map((r) => r.guid)) {
        const rec = this.object(id);
        if (rec.type === MESH) {
          out.push(id);
          continue;
        }
        const faces = objectTriangles(this.doc, rec).flatMap(({ owner, triangles }) => facesOf(triangles).flatMap(meshPieces).map((corners) => ({ owner, corners })));
        // a 2D object stays as it is
        if (!faces.length) continue;
        const dict = textureDict(rec);
        const whole = dict ? readTextureParts(dict.data).find((t) => t.part === OVERALL) : undefined;
        const p = this.plan();
        const made = this.instantiate(
          meshRecords(
            shell,
            rec.classIndex,
            rec.data,
            faces.map(({ owner, corners }) => ({ like: owner.data, corners })),
          ),
          rec.owner,
        );
        if (!rec.hasNext) setNext(made[0], false);
        p.remove(rec.index, subtreeEnd(rec));
        p.insert(rec.index, made);
        const top = recOfData(made[0]).guid;
        this.commit(p, "objects", [top]);
        // the object's texture on the whole mesh, mapped as the drawing's meshes mostly are
        if (whole) {
          const { texture, offsetU, offsetV, scaleU, scaleV, rotation } = whole;
          this.setObjectTexture(top, OVERALL, scaleU && scaleV ? { texture, offsetU, offsetV, scaleU, scaleV, rotation } : { texture });
        }
        out.push(top);
      }
      if (!out.length) throw new Error("none of these objects shows any 3D faces");
      return out;
    });
  }

  /** The meshes among `ids` and inside them: in groups, plug-in objects and the definitions of symbols placed there, each once. */
  private meshesIn(ids: string[]): Rec[] {
    const out = new Set<Rec>();
    const visit = (r: Rec, depth: number): void => {
      for (const o of objectWalk(r)) {
        if (o.type === MESH) out.add(o);
        const def = o.type === SYMBOL_INSTANCE && depth < 12 ? this.doc.symbols.get(u16(o.data, 0x8e)) : undefined;
        if (def) for (const c of objectChildren(def)) visit(c, depth + 1);
      }
    };
    for (const r of this.topmost(ids, true)) visit(r, 0);
    return [...out];
  }

  meshTriangles(ids: string[]): { meshes: number; triangles: number } {
    const meshes = this.meshesIn(ids);
    return { meshes: meshes.length, triangles: meshes.reduce((n, r) => n + meshTriangleCount(r), 0) };
  }

  simplifyMeshes(ids: string[], keep: number, preview = false): { before: number; after: number; simplified: number; same: number; skipped: number } {
    if (!(keep > 0 && keep <= 1)) throw new Error("the quality must be more than 0% and at most 100%");
    const meshes = this.meshesIn(ids);
    if (!meshes.length) throw new Error("there's no mesh among these objects");
    const out = { before: 0, after: 0, simplified: 0, same: 0, skipped: 0 };
    // one plan: the meshes are apart (none holds another), and not every mesh has an id to find it by again
    const p = this.plan();
    for (const rec of meshes) {
      const r = simplifiedMesh(rec, keep, preview);
      if ("same" in r || "skipped" in r) {
        const n = "same" in r ? r.same : r.triangles;
        out.before += n;
        out.after += n;
        if ("same" in r) out.same++;
        else out.skipped++;
        continue;
      }
      out.before += r.before;
      out.after += r.after;
      out.simplified++;
      if (preview) continue;
      p.remove(rec.index, subtreeEnd(rec));
      p.insert(rec.index, r.recs);
      for (let o: Rec | null = rec; o; o = o.parent) if (o.type === 16) p.symbolsChanged = true;
    }
    if (!preview && out.simplified) this.commit(p, "objects", ids);
    return out;
  }

  addMeshes(
    layerId: string,
    parts: readonly (readonly (readonly number[])[])[],
    classIndex?: number | readonly number[],
    attrs?: Partial<Attributes> | readonly (Partial<Attributes> | undefined)[],
    names?: readonly (string | undefined)[],
  ): string[] {
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    for (const c of typeof cls === "number" ? [cls] : cls) if (!this.doc.classRecs.has(c)) throw new Error(`no class #${c}`);
    const { owner, at } = this.slot(layer);
    const naming = this.newNames();
    const { block, roots } = this.meshBlock(this.meshShell(), cls, owner, parts, attrs, layerElevationOf(layer), undefined, names && ((i) => naming.index(names[i])));
    if (!roots.length) throw new Error("none of the parts has a face");
    const p = this.plan();
    p.insert(at, block);
    naming.write(p);
    this.refitGroups(p, [], new Map([[layer, roots]]));
    const ids = roots.map((d) => recOfData(d).guid);
    this.commit(p, "objects", ids);
    return ids;
  }

  add3DLoci(layerId: string, points: readonly (readonly number[])[], classIndex?: number, asGroup = false): string[] {
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    const elevation = layerElevationOf(layer);
    const recs = points.filter((q) => q.length === 3 && q.every(Number.isFinite)).map((q) => locus3dRecord(q[0], q[1], q[2] + elevation, cls));
    if (!recs.length) throw new Error("there's no point to put a 3D locus on");
    const { owner, at } = this.slot(layer);
    const made = asGroup ? [this.grouped(recs, owner, cls)] : recs.map((d) => this.grouped([d], owner, cls));
    const p = this.plan();
    p.insert(at, made.flat());
    const firsts = made.map((m) => m[0]);
    this.refitGroups(p, [], new Map([[layer, firsts]]));
    const ids = firsts.map((d) => recOfData(d).guid);
    this.commit(p, "objects", ids);
    return ids;
  }

  add3DPolygons(layerId: string, polys: readonly { readonly points: readonly number[]; readonly closed: boolean }[], classIndex?: number): string {
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
    const head = this.poly3dHead();
    // the look of a new 3D polygon: the template's own attributes, in the class asked for
    const like = { classIndex: cls, data: head };
    const elevation = layerElevationOf(layer);
    const recs = polys
      .filter((q) => q.points.length >= 6 && q.points.length % 3 === 0 && q.points.every(Number.isFinite))
      .map((q) => poly3dRecord(head, q.points.map((v, i) => (i % 3 === 2 ? v + elevation : v)), like, q.closed));
    if (!recs.length) throw new Error("none of the polygons has two points");
    const { owner, at } = this.slot(layer);
    const made = this.grouped(recs, owner, cls);
    const p = this.plan();
    p.insert(at, made);
    this.refitGroups(p, [], new Map([[layer, [made[0]]]]));
    const id = recOfData(made[0]).guid;
    this.commit(p, "objects", [id]);
    return id;
  }

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
  ): { id: string; count: number } {
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    for (const c of [cls, ...sets.flatMap((set) => set.classes ?? [])]) if (!this.doc.classRecs.has(c)) throw new Error(`no class #${c}`);
    const shell = this.meshShell();
    const groupTpl = this.groupShell();
    const { owner, at } = this.slot(layer);
    const naming = this.newNames();
    // a group's records around its contents, its box theirs and its name the first free one
    const wrap = (shellRecs: Uint8Array[], contents: Uint8Array[], roots: readonly Uint8Array[], name: string): Uint8Array[] => {
      const g = shellRecs[0];
      setU16(g, 0x1a, naming.index(name));
      setU32(g, 0x20, cls);
      writeGroupBox(
        g,
        roots.reduce<BBox | null>((box, r) => unionBox(box, readBBox(r)), null),
      );
      return [...shellRecs.slice(0, -1), ...contents, shellRecs[shellRecs.length - 1]];
    };
    const inner = (shellRecs: Uint8Array[]): bigint => u64(shellRecs[shellRecs.length - 1], 0x26);
    const outer = this.instantiate(groupTpl, owner);
    const made: { recs: Uint8Array[]; root: Uint8Array }[] = [];
    let count = 0;
    for (const set of sets) {
      const g = this.instantiate(groupTpl, inner(outer));
      const names = set.names;
      const { block, roots } = this.meshBlock(shell, set.classes ?? cls, inner(g), set.parts, set.attrs, layerElevationOf(layer), undefined, names && ((i) => naming.index(names[i])));
      if (!roots.length) continue;
      count += roots.length;
      made.push({ recs: wrap(g, block, roots, set.name), root: g[0] });
    }
    if (!made.length) throw new Error("none of the parts has a face");
    let block: Uint8Array[];
    let top: Uint8Array;
    if (made.length === 1) {
      // one set: its group alone, on the layer
      block = made[0].recs;
      top = made[0].root;
      setOwner(top, owner);
    } else {
      block = wrap(
        outer,
        made.flatMap((m) => m.recs),
        made.map((m) => m.root),
        "",
      );
      top = outer[0];
    }
    const p = this.plan();
    p.insert(at, block);
    naming.write(p);
    this.refitGroups(p, [], new Map([[layer, [top]]]));
    const id = recOfData(top).guid;
    this.commit(p, "objects", [id]);
    return { id, count };
  }

  addMeshModel(
    layerId: string,
    model: MeshModel,
    classIndex?: number,
  ): { id: string; meshes: number; instances: number; lines: number; loci: number; flat: number; symbols: number[] } {
    // a drawing's first symbols need a resource library to go in
    if (model.symbols.length && !this.doc.recs.some((r) => r.type === 54)) {
      return this.batch(() => {
        this.addSymbolLibrary();
        return this.addMeshModel(layerId, model, classIndex);
      });
    }
    const layer = this.container(layerId);
    const cls = classIndex ?? this.noneClass();
    const known = (c: number | undefined): void => {
      if (c !== undefined && !this.doc.classRecs.has(c)) throw new Error(`no class #${c}`);
    };
    // every class there, every instance placing a definition made before it, every matrix finite
    const textures = this.textureLookup().textures;
    const check = (n: MeshNode, before: number): void => {
      for (const c of n.classes ?? []) known(c);
      for (const q of [...(n.lines ?? []), ...(n.loci ?? []), ...(n.shapes ?? [])]) known(q.classIndex);
      for (const t of n.textures ?? []) if (t !== undefined && t > 0 && !textures.has(t)) throw new Error(`no texture #${t}`);
      for (const g of n.groups ?? []) {
        known(g.classIndex);
        check(g, before);
      }
      for (const i of n.instances ?? []) {
        if (!Number.isInteger(i.symbol) || i.symbol < 0 || i.symbol >= before) throw new Error(`no symbol #${i.symbol} to place there`);
        if (i.matrix.length !== 12 || !i.matrix.every(Number.isFinite)) throw new Error("an instance's matrix isn't 12 finite numbers");
        known(i.classIndex);
      }
    };
    known(cls);
    model.symbols.forEach((s, k) => check(s.content, k));
    check(model.top, model.symbols.length);

    const shell = this.meshShell();
    const groupTpl = this.groupShell();
    const instTpl = model.symbols.length ? this.template(SYMBOL_INSTANCE) : null;
    const polyHead = this.poly3dHead();
    const names = new Map(this.doc.names);
    const taken = new Set([...names.values(), ...this.doc.layerRecs.map((l) => this.doc.layerName(l))]);
    // a name's index, the first free of `name`, "name 2"…; 0 for none
    const nameOf = (name: string): number => {
      if (!name) return 0;
      let free = name;
      for (let n = 2; taken.has(free); n++) free = `${name} ${n}`;
      taken.add(free);
      const index = this.freshName();
      names.set(index, free);
      return index;
    };
    const inner = (recs: Uint8Array[]): bigint => u64(recs[recs.length - 1], 0x26);
    const planBox = (roots: readonly Uint8Array[]): BBox | null => roots.reduce<BBox | null>((b, r) => unionBox(b, readBBox(r)), null);
    const indexes: number[] = [];
    const boxes: (Box3 | null)[] = [];
    let meshes = 0;
    let instances = 0;
    let lines = 0;
    let loci = 0;
    let flat = 0;
    // a node's records owned by `owner`, its top-level ones, and its 3D box
    const build = (n: MeshNode, owner: bigint, elevation: number): { recs: Uint8Array[]; roots: Uint8Array[]; box: Box3 | null } => {
      const recs: Uint8Array[] = [];
      const roots: Uint8Array[] = [];
      let box: Box3 | null = null;
      if (n.parts?.length) {
        const partNames = n.names;
        const made = this.meshBlock(shell, n.classes ?? cls, owner, n.parts, n.attrs, elevation, n, partNames && ((i) => nameOf(partNames[i] ?? "")));
        // not a spread: a big mesh has more records than a call can take
        for (const r of made.block) recs.push(r);
        roots.push(...made.roots);
        meshes += made.roots.length;
        for (const part of n.parts) for (const f of part) box = growBox3(box, f);
      }
      for (const q of n.lines ?? []) {
        if (q.points.length < 6 || q.points.length % 3 !== 0 || !q.points.every(Number.isFinite)) continue;
        const c = q.classIndex ?? cls;
        const d = this.instantiate({ recs: [poly3dRecord(polyHead, q.points.map((v, i) => (i % 3 === 2 ? v + elevation : v)), { classIndex: c, data: polyHead }, q.closed)], parent: [-1] }, owner)[0];
        recs.push(d);
        roots.push(d);
        lines++;
        box = growBox3(box, q.points);
      }
      for (const q of n.loci ?? []) {
        if (q.at.length !== 3 || !q.at.every(Number.isFinite)) continue;
        const d = this.instantiate({ recs: [locus3dRecord(q.at[0], q.at[1], q.at[2] + elevation, q.classIndex ?? cls)], parent: [-1] }, owner)[0];
        recs.push(d);
        roots.push(d);
        loci++;
        box = growBox3(box, q.at);
      }
      for (const q of n.shapes ?? []) {
        const type = TYPE_OF_KIND[q.shape.kind];
        if (!this.templates.has(type)) continue;
        const made = this.instantiate(this.template(type), owner);
        const d = writeGeometry(made[0], q.shape);
        liftRecord(d, type, elevation);
        setU16(d, 0x1a, 0);
        setU32(d, 0x20, q.classIndex ?? cls);
        if (q.attrs) writeAttrs(d, q.attrs);
        made[0] = d;
        for (const r of made) recs.push(r);
        roots.push(d);
        flat++;
        // flat in plan, at the node's height
        const b = readBBox(d);
        if (b) box = growBox3(box, [b.x0, b.y0, 0, b.x1, b.y1, 0]);
      }
      for (const g of n.groups ?? []) {
        const around = this.instantiate(groupTpl, owner);
        const held = build(g, inner(around), elevation);
        if (!held.roots.length) continue;
        const head = around[0];
        setU16(head, 0x1a, nameOf(g.name));
        setU32(head, 0x20, g.classIndex ?? cls);
        writeGroupBox(head, planBox(held.roots));
        for (const r of around.slice(0, -1)) recs.push(r);
        for (const r of held.recs) recs.push(r);
        recs.push(around[around.length - 1]);
        roots.push(head);
        box = unionBox3(box, held.box);
      }
      for (const i of n.instances ?? []) {
        const made = this.instantiate(instTpl!, owner);
        const d = made[0];
        setU16(d, 0x1a, nameOf(i.name ?? ""));
        setU32(d, 0x20, i.classIndex ?? cls);
        setU16(d, 0x8e, indexes[i.symbol]);
        // at full size, then the whole matrix: turned, mirrored or stretched in 3D as given
        writePlacement(d, { x: 0, y: 0 });
        i.matrix.forEach((v, k) => setF64(d, SYMBOL_MATRIX + 8 * k, v));
        liftRecord(d, SYMBOL_INSTANCE, elevation);
        // its plan bounds: its definition's 3D box, placed
        const placed = placeBox3(boxes[i.symbol], i.matrix);
        if (placed) writeBBox(d, { x0: placed[0], y0: placed[1], x1: placed[3], y1: placed[4] });
        for (const r of made) recs.push(r);
        roots.push(d);
        instances++;
        box = unionBox3(box, placed);
      }
      return { recs, roots, box };
    };

    // the definitions, at the top of the resource library, cloned from one already there
    let defs: { block: Uint8Array[]; at: number } | null = null;
    if (model.symbols.length) {
      const { tpl, sibling } = this.symbolTemplate();
      const defShell = tpl ? this.shellOf(tpl) : symbolDefinitionTemplate();
      const block: Uint8Array[] = [];
      for (const s of model.symbols) {
        const around = this.instantiate(defShell, sibling.owner);
        const index = nameOf(s.name || "Symbol");
        setU16(around[0], 0x1a, index);
        indexes.push(index);
        const held = build(s.content, inner(around), 0);
        writeBBox(around[0], planBox(held.roots) ?? { x0: 0, y0: 0, x1: 0, y1: 0 });
        boxes.push(held.box);
        for (const r of around.slice(0, -1)) block.push(r);
        for (const r of held.recs) block.push(r);
        block.push(around[around.length - 1]);
      }
      defs = { block, at: sibling.index };
    }

    const { owner, at } = this.slot(layer);
    const outer = this.instantiate(groupTpl, owner);
    const top = build(model.top, inner(outer), layerElevationOf(layer));
    if (!top.roots.length) throw new Error("none of the parts has a face or line");
    let block: Uint8Array[];
    let head: Uint8Array;
    if (top.roots.length === 1) {
      // one object: it alone, on the layer
      block = top.recs;
      head = top.roots[0];
      setOwner(head, owner);
    } else {
      head = outer[0];
      setU32(head, 0x20, cls);
      writeGroupBox(head, planBox(top.roots));
      block = outer.slice(0, -1);
      for (const r of top.recs) block.push(r);
      block.push(outer[outer.length - 1]);
    }
    const p = this.plan();
    if (defs) p.insert(defs.at, defs.block);
    p.insert(at, block);
    if (names.size !== this.doc.names.size) this.writeNames(p, names);
    this.refitGroups(p, [], new Map([[layer, [head]]]));
    const id = recOfData(head).guid;
    this.commit(p, "all", [id]);
    return { id, meshes, instances, lines, loci, flat, symbols: indexes };
  }

  addMeshElements(layerId: string, elements: readonly MeshElement[]): string[] {
    const layer = this.container(layerId);
    const none = this.noneClass();
    const shell = this.meshShell();
    // the group shell found once: finding it walks the whole drawing
    const groupTpl = elements.some((e) => "parts" in e && e.parts.length > 1) ? this.groupShell() : null;
    const instTpl = elements.some((e) => "symbol" in e) ? this.template(SYMBOL_INSTANCE) : null;
    // each symbol's 3D box, in its own frame, which its instances' plan boxes are placed from
    const symbolBoxes = new Map<number, Box3 | null>();
    const symbolBox = (symbol: number): Box3 | null => {
      if (!symbolBoxes.has(symbol)) {
        let box: Box3 | null = null;
        for (const c of objectChildren(this.doc.symbols.get(symbol)!)) for (const { triangles } of objectTriangles(this.doc, c)) box = growBox3(box, triangles);
        symbolBoxes.set(symbol, box);
      }
      return symbolBoxes.get(symbol)!;
    };
    const { owner, at } = this.slot(layer);
    const elevation = layerElevationOf(layer);
    const block: Uint8Array[] = [];
    const tops: Uint8Array[] = [];
    const ids = elements.map((e) => {
      const cls = e.classIndex ?? none;
      if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
      if ("symbol" in e) {
        if (!this.doc.symbols.has(e.symbol)) throw new Error(`no symbol #${e.symbol}`);
        if (e.matrix.length !== 12 || !e.matrix.every(Number.isFinite)) throw new Error("an instance's matrix isn't 12 finite numbers");
        const made = this.instantiate(instTpl!, owner);
        const d = made[0];
        setU16(d, 0x1a, 0);
        setU32(d, 0x20, cls);
        setU16(d, 0x8e, e.symbol);
        // at full size, then the whole matrix, as addMeshModel places one
        writePlacement(d, { x: 0, y: 0 });
        e.matrix.forEach((v, k) => setF64(d, SYMBOL_MATRIX + 8 * k, v));
        liftRecord(d, SYMBOL_INSTANCE, elevation);
        const placed = placeBox3(symbolBox(e.symbol), e.matrix);
        if (placed) writeBBox(d, { x0: placed[0], y0: placed[1], x1: placed[3], y1: placed[4] });
        for (const r of made) block.push(r);
        tops.push(d);
        return recOfData(d).guid;
      }
      const g = e.parts.length > 1 && groupTpl ? this.instantiate(groupTpl, owner) : null;
      const term = g?.[g.length - 1];
      const made = this.meshBlock(shell, cls, term ? u64(term, 0x26) : owner, e.parts, e.attrs, elevation);
      if (!made.roots.length) return "";
      let top: Uint8Array;
      if (!g || !term || made.roots.length === 1) {
        // one mesh: itself, on the layer
        top = made.roots[0];
        setOwner(top, owner);
        for (const d of made.block) block.push(d);
      } else {
        top = g[0];
        setU16(top, 0x1a, 0);
        setU32(top, 0x20, cls);
        writeGroupBox(
          top,
          made.roots.reduce<BBox | null>((box, r) => unionBox(box, readBBox(r)), null),
        );
        for (const d of g.slice(0, -1)) block.push(d);
        for (const d of made.block) block.push(d);
        block.push(term);
      }
      tops.push(top);
      return recOfData(top).guid;
    });
    if (!tops.length) throw new Error("none of the elements has a face");
    const p = this.plan();
    p.insert(at, block);
    this.refitGroups(p, [], new Map([[layer, tops]]));
    this.commit(
      p,
      "objects",
      ids.filter((id) => id),
    );
    return ids;
  }

  addMeshSymbols(defs: readonly MeshSymbolSpec[]): number[] {
    if (!defs.length) return [];
    // a drawing's first symbols need a resource library to go in
    if (!this.doc.recs.some((r) => r.type === 54)) {
      return this.batch(() => {
        this.addSymbolLibrary();
        return this.addMeshSymbols(defs);
      });
    }
    const none = this.noneClass();
    const shell = this.meshShell();
    const { tpl, sibling } = this.symbolTemplate();
    const defShell = tpl ? this.shellOf(tpl) : symbolDefinitionTemplate();
    const names = new Map(this.doc.names);
    const taken = new Set([...names.values(), ...this.doc.layerRecs.map((l) => this.doc.layerName(l))]);
    const block: Uint8Array[] = [];
    const indexes = defs.map((def) => {
      const cls = def.classIndex ?? none;
      if (!this.doc.classRecs.has(cls)) throw new Error(`no class #${cls}`);
      const base = def.name.trim() || "Symbol";
      let name = base;
      for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
      const around = this.instantiate(defShell, sibling.owner);
      const made = this.meshBlock(shell, cls, u64(around[around.length - 1], 0x26), def.parts, def.attrs, 0);
      if (!made.roots.length) throw new Error(`symbol ${name} has no face`);
      taken.add(name);
      const index = this.freshName();
      names.set(index, name);
      setU16(around[0], 0x1a, index);
      writeBBox(around[0], made.roots.reduce<BBox | null>((box, r) => unionBox(box, readBBox(r)), null) ?? { x0: 0, y0: 0, x1: 0, y1: 0 });
      for (const r of around.slice(0, -1)) block.push(r);
      for (const r of made.block) block.push(r);
      block.push(around[around.length - 1]);
      return index;
    });
    const p = this.plan();
    p.insert(sibling.index, block);
    this.writeNames(p, names);
    this.commit(p, "all", []);
    return indexes;
  }

  /**
   * Each part as a mesh's records (its look the drawing's mesh's, with the part's attributes over
   * it), in class `cls` (one for all, or one per part), owned by `owner`, its heights above a layer
   * at `elevation`; parts without a face are left out. `nameOf` gives a part's mesh its name index (newNames).
   */
  private meshBlock(
    shell: MeshShell,
    cls: number | readonly number[],
    owner: bigint,
    parts: readonly (readonly (readonly number[])[])[],
    attrs: Partial<Attributes> | readonly (Partial<Attributes> | undefined)[] | undefined,
    elevation: number,
    maps?: Pick<MeshNode, "textures" | "uvs">,
    nameOf?: (part: number) => number,
  ): { block: Uint8Array[]; roots: Uint8Array[] } {
    const block: Uint8Array[] = [];
    const roots: Uint8Array[] = [];
    for (const [i, faces] of parts.entries()) {
      // the drawing's mesh's look, with the part's attributes over it, for the mesh and every face
      const like = shell.head.slice();
      const a = Array.isArray(attrs) ? (attrs as readonly (Partial<Attributes> | undefined)[])[i] : (attrs as Partial<Attributes> | undefined);
      if (a) writeAttrs(like, a);
      const texture = maps?.textures?.[i];
      const uvs = texture !== undefined && texture > 0 ? maps?.uvs?.[i] : undefined;
      const pieces: { like: Uint8Array; corners: number[]; uvs?: number[] }[] = [];
      faces.forEach((f, k) => {
        if (f.length % 3 !== 0 || !f.every(Number.isFinite)) return;
        const at = uvs?.[k];
        const mapped = at && at.length === (2 * f.length) / 3 && at.every(Number.isFinite) ? at : undefined;
        // a piece's corners are some of its face's, each with the face's (u, v) there
        for (const corners of meshPieces([...f])) pieces.push(mapped ? { like, corners, uvs: cornerUvs(f, mapped, corners) } : { like, corners });
      });
      if (!pieces.length) continue;
      const made = this.instantiate(
        meshRecords(
          shell,
          typeof cls === "number" ? cls : cls[i],
          like,
          pieces,
          uvs ? { texture: texture!, aux: (body) => this.newAux(AUX_RECORD, body) } : undefined,
        ),
        owner,
      );
      liftRecord(made[0], MESH, elevation);
      if (nameOf) setU16(made[0], 0x1a, nameOf(i));
      // not a spread: a big mesh has more records than a call can take
      for (const rec of made) block.push(rec);
      roots.push(made[0]);
    }
    return { block, roots };
  }

  canAddMeshes(): boolean {
    try {
      this.meshShell();
      return true;
    } catch {
      return false;
    }
  }

  canCreateSymbols(): boolean {
    try {
      if (this.doc.recs.some((r) => r.type === 54)) this.symbolTemplate();
      else if (!this.doc.recs.some((r) => r.type === 57)) return false;
      this.template(SYMBOL_INSTANCE);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * A mesh of the drawing's to make new ones like: its record up to the vertices, a face's up to its
   * corners, and its terminator; the built-in one when the drawing has none.
   */
  private meshShell(): MeshShell {
    const plainFace = (r: Rec): Rec | undefined => objectChildren(r).find((c) => c.type === MESH_FACE && c.data.length >= FACE_CORNERS && u64(c.data, 0x10) === 0n);
    const tpl = this.doc.recs.find((r) => r.type === MESH && r.data.length >= MESH_VERTS && r.children.at(-1)?.type === 0 && plainFace(r));
    if (!tpl) return builtinMeshShell();
    return { head: tpl.data.slice(0, MESH_VERTS), face: plainFace(tpl)!.data.slice(0, FACE_CORNERS), term: tpl.children.at(-1)!.data.slice() };
  }

  extrudeObjects(ids: string[], height: number): string[] {
    if (!Number.isFinite(height) || height <= 0) throw new Error("the extrusion must be more than 0");
    const recs = this.topmost(ids).filter((r) => extrudable(r));
    if (!recs.length) throw new Error("only rectangles, polygons, polylines, circles and ellipses can be extruded");
    const shell = this.extrudeShell();
    const p = this.plan();
    const out: string[] = [];
    for (const r of recs) {
      const made = this.instantiate(shell, r.owner);
      const d = made[0];
      const term = made[made.length - 1];
      standExtrude(made, r, decodeShape(r)!.bbox!, height);
      // standing on its layer, at its elevation
      liftRecord(d, EXTRUDE, layerElevationOf(r));
      if (!r.hasNext) setNext(d, false);
      const profile = p.cur(r.index).slice();
      setOwner(profile, u64(term, 0x26));
      setNext(profile, true);
      const end = subtreeEnd(r);
      const moved: Uint8Array[] = [profile];
      for (let i = r.index + 1; i <= end; i++) moved.push(p.cur(i));
      p.remove(r.index, end);
      p.insert(r.index, [...made.slice(0, -1), ...moved, term]);
      out.push(recOfData(d).guid);
    }
    this.commit(p, "objects", out);
    return out;
  }

  sweepObjects(ids: string[], arc: number, segment: number): string[] {
    if (!(arc > 0 && arc <= 360)) throw new Error("the arc must be more than 0° and at most 360°");
    if (!(segment > 0 && segment <= 90)) throw new Error("the segment angle must be more than 0° and at most 90°");
    const recs = this.topmost(ids).filter((r) => extrudable(r));
    if (!recs.length) throw new Error("only rectangles, polygons, polylines, circles and ellipses can be swept");
    const shell = this.extrudeShell();
    const p = this.plan();
    const out: string[] = [];
    for (const r of recs) {
      const made = this.instantiate(shell, r.owner);
      // an extrude's records with a sweep's type and its 32 more bytes: angles, and no body (all ones)
      const d = new Uint8Array(SWEEP_HEADER);
      d.set(made[0].subarray(0, SWEEP_HEADER));
      d.fill(0, SWEEP_START);
      made[0] = d;
      setU64(d, 0, BigInt(SWEEP_HEADER));
      d[0x19] = SWEEP;
      setF64(d, SWEEP_SEGMENT, segment);
      setF64(d, SWEEP_ARC, arc);
      setU32(d, SWEEP_REF, 0xffffffff);
      standSweep(made, r, decodeShape(r)!.bbox!, arc);
      liftRecord(d, SWEEP, layerElevationOf(r));
      const term = made[made.length - 1];
      if (!r.hasNext) setNext(d, false);
      const profile = p.cur(r.index).slice();
      setOwner(profile, u64(term, 0x26));
      setNext(profile, true);
      const end = subtreeEnd(r);
      const moved: Uint8Array[] = [profile];
      for (let i = r.index + 1; i <= end; i++) moved.push(p.cur(i));
      p.remove(r.index, end);
      p.insert(r.index, [...made.slice(0, -1), ...moved, term]);
      out.push(recOfData(d).guid);
    }
    this.commit(p, "objects", out);
    return out;
  }

  multiExtrudeObjects(ids: string[], height: number): string {
    if (!Number.isFinite(height) || height <= 0) throw new Error("the extrusion must be more than 0");
    const recs = this.topmost(ids)
      .filter((r) => extrudable(r))
      .sort((a, b) => a.index - b.index);
    if (recs.length < 2) throw new Error("a multiple extrude needs two or more rectangles, polygons, polylines, circles or ellipses");
    const parent = recs[0].parent;
    if (!parent || recs.some((r) => r.parent !== parent)) throw new Error("the profiles must be in the same layer or group");
    // an extrude's records with a multiple extrude's type: in the demos the two headers differ in nothing else
    const made = this.instantiate(this.extrudeShell(), recs[0].owner);
    made[0][0x19] = MULTI_EXTRUDE;
    let box: BBox | null = null;
    for (const r of recs) box = unionBox(box, decodeShape(r)!.bbox!);
    standExtrude(made, recs[0], box!, height);
    liftRecord(made[0], MULTI_EXTRUDE, layerElevationOf(recs[0]));
    // the profiles in stacking order, the backmost at the bottom
    return this.gather(recs, made);
  }

  /**
   * Moves `recs` (siblings, in stacking order) into the new object `made` (header first,
   * terminator last), which takes the frontmost's place; its id.
   */
  private gather(recs: Rec[], made: Uint8Array[]): string {
    const d = made[0];
    const term = made[made.length - 1];
    const p = this.plan();
    const moved: Uint8Array[] = [];
    for (const r of recs) {
      const end = subtreeEnd(r);
      const root = p.cur(r.index).slice();
      setOwner(root, u64(term, 0x26));
      setNext(root, true);
      moved.push(root);
      for (let i = r.index + 1; i <= end; i++) moved.push(p.cur(i));
      p.remove(r.index, end);
    }
    const last = recs[recs.length - 1];
    if (!last.hasNext) setNext(d, false);
    p.insert(subtreeEnd(last) + 1, [...made.slice(0, -1), ...moved, term]);
    const id = recOfData(d).guid;
    this.commit(p, "objects", [id]);
    return id;
  }

  combineSolids(ids: string[], subtract: boolean): string {
    const recs = this.topmost(ids)
      .filter((r) => SOLID_OPERANDS.has(r.type))
      .sort((a, b) => a.index - b.index);
    if (recs.length < 2) throw new Error("this needs two or more extrudes, multiple extrudes, sweeps or solids");
    const parent = recs[0].parent;
    if (!parent || recs.some((r) => r.parent !== parent)) throw new Error("the solids must be in the same layer or group");
    // the bounds of what the 3D view draws of them: all of them, or what is cut from
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const r of subtract ? recs.slice(0, 1) : recs) {
      for (const { triangles: t } of objectTriangles(this.doc, r)) {
        for (let i = 0; i < t.length; i++) [lo[i % 3], hi[i % 3]] = [Math.min(lo[i % 3], t[i]), Math.max(hi[i % 3], t[i])];
      }
    }
    if (!lo.every(Number.isFinite)) throw new Error("these objects show no 3D faces");
    // an extrude's records with a solid's longer header
    const made = this.instantiate(this.extrudeShell(), recs[0].owner);
    const d = new Uint8Array(SOLID_HEADER);
    d.set(made[0]);
    made[0] = d;
    setU64(d, 0, BigInt(SOLID_HEADER));
    d[0x19] = SOLID;
    d[SOLID_FLAG] = 1;
    d[SOLID_KIND] = subtract ? 3 : 1;
    setU32(d, SOLID_REF, 0xffffffff);
    standExtrude(made, recs[0], { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] }, hi[2], lo[2]);
    // the operands in stacking order, the backmost the one cut
    return this.gather(recs, made);
  }

  taperedExtrudeObjects(ids: string[], height: number, taper: number): string[] {
    if (!Number.isFinite(height) || height <= 0) throw new Error("the height must be more than 0");
    if (!Number.isFinite(taper) || Math.abs(taper) >= 90) throw new Error("the taper angle must lie between -90° and 90°");
    const recs = this.topmost(ids).filter((r) => extrudable(r));
    if (!recs.length) throw new Error("only rectangles, polygons, polylines, circles and ellipses can be extruded");
    const shell = this.meshShell();
    // each profile's faces first, so a profile the taper closes up throws before anything changes
    const built = recs.map((r) => {
      const ring = profileRingOf(r);
      if (!ring) throw new Error("one of these shapes has no area to extrude");
      const top = insetRing(ring, height * Math.tan((taper * Math.PI) / 180));
      if (!top) throw new Error(`a ${Math.abs(taper)}° taper ${taper > 0 ? "closes the profile up" : "folds the profile over"} before the top; try a smaller angle or height`);
      const z0 = layerElevationOf(r);
      const z1 = z0 + height;
      const n = ring.length / 2;
      const at = (xy: number[], i: number, z: number): number[] => [xy[2 * (i % n)], xy[2 * (i % n) + 1], z];
      const faces: number[][] = [
        // the bottom facing down, the top up, and a side between each pair of edges
        Array.from({ length: n }, (_, i) => at(ring, n - 1 - i, z0)).flat(),
        Array.from({ length: n }, (_, i) => at(top, i, z1)).flat(),
        ...Array.from({ length: n }, (_, i) => [...at(ring, i, z0), ...at(ring, i + 1, z0), ...at(top, i + 1, z1), ...at(top, i, z1)]),
      ];
      return { r, faces: faces.flatMap(meshPieces) };
    });
    return this.batch(() =>
      built.map(({ r, faces }) => {
        const rec = this.object(r.guid);
        const made = this.instantiate(
          meshRecords(
            shell,
            rec.classIndex,
            rec.data,
            faces.map((corners) => ({ like: rec.data, corners })),
          ),
          rec.owner,
        );
        if (!rec.hasNext) setNext(made[0], false);
        const p = this.plan();
        p.remove(rec.index, subtreeEnd(rec));
        p.insert(rec.index, made);
        const id = recOfData(made[0]).guid;
        this.commit(p, "objects", [id]);
        return id;
      }),
    );
  }

  extrudeAlongPath(profileId: string, pathId: string, scale: number, lockPlane: boolean): string {
    if (!Number.isFinite(scale) || scale <= 0) throw new Error("the scale factor must be more than 0");
    const profile = this.object(profileId);
    const path = this.object(pathId);
    if (profile === path) throw new Error("the profile and the path must be two objects");
    if (profile.parent !== path.parent) throw new Error("the profile and the path must be in the same layer or group");
    const ring = extrudable(profile) ? profileRingOf(profile) : null;
    if (!ring) throw new Error("the profile must be a rectangle, polygon, polyline, circle or ellipse");
    const run = pathPointsOf(path, layerElevationOf(path));
    if (!run) throw new Error("the path must be a line, arc, rectangle, polygon, polyline, circle, ellipse or 3D polygon");
    const faces = sweepFaces(ring, run.points, run.closed, scale, lockPlane);
    if (typeof faces === "string") throw new Error(faces);
    const [back, front] = profile.index < path.index ? [profile, path] : [path, profile];
    const made = this.instantiate(
      meshRecords(
        this.meshShell(),
        profile.classIndex,
        profile.data,
        faces.flatMap(meshPieces).map((corners) => ({ like: profile.data, corners })),
      ),
      front.owner,
    );
    if (!front.hasNext) setNext(made[0], false);
    const p = this.plan();
    for (const r of [back, front]) p.remove(r.index, subtreeEnd(r));
    p.insert(subtreeEnd(front) + 1, made);
    const id = recOfData(made[0]).guid;
    this.commit(p, "objects", [id]);
    return id;
  }

  intersectSolids(ids: string[]): string {
    const recs = this.topmost(ids)
      .filter((r) => SOLID_OPERANDS.has(r.type))
      .sort((a, b) => a.index - b.index);
    if (recs.length < 2) throw new Error("this needs two or more extrudes, multiple extrudes, sweeps or solids");
    const parent = recs[0].parent;
    if (!parent || recs.some((r) => r.parent !== parent)) throw new Error("the solids must be in the same layer or group");
    const meshes = recs.map((r) => this.trianglesOf(r));
    if (meshes.some((m) => !m.length)) throw new Error("one of these objects shows no 3D faces");
    const found = intersectMeshes(meshes);
    if (!found) throw new Error(`these objects have more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces between them, too many to intersect`);
    const faces = facesOf(found.triangles).flatMap(meshPieces);
    if (!faces.length) throw new Error("these objects don't all overlap");
    // a mesh of the volume they share, drawn as the backmost is, in its place among the frontmost's
    const back = recs[0];
    const last = recs[recs.length - 1];
    const made = this.instantiate(
      meshRecords(
        this.meshShell(),
        back.classIndex,
        back.data,
        faces.map((corners) => ({ like: back.data, corners })),
      ),
      back.owner,
    );
    if (!last.hasNext) setNext(made[0], false);
    const p = this.plan();
    for (const r of recs) p.remove(r.index, subtreeEnd(r));
    p.insert(subtreeEnd(last) + 1, made);
    const id = recOfData(made[0]).guid;
    this.commit(p, "objects", [id]);
    return id;
  }

  curvePoints(id: string): { points: number[][]; closed: boolean } | null {
    const r = this.topmost([id])[0];
    return r ? pathPointsOf(r, layerElevationOf(r)) : null;
  }

  /** The record of a solid the 3D Modeling set's edit tools can change: anything the booleans take, or a mesh. */
  private solidRec(id: string): Rec {
    const r = this.topmost([id])[0];
    if (!r || !(SOLID_OPERANDS.has(r.type) || r.type === MESH)) throw new Error("this needs an extrude, multiple extrude, sweep, solid or mesh, not a group or another object");
    return r;
  }

  solidTriangles(id: string): Float64Array {
    const tris = this.trianglesOf(this.solidRec(id));
    if (!tris.length) throw new Error("this object shows no 3D faces");
    return tris;
  }

  faceTriangles(id: string): Float64Array {
    // only read, so a door or window set in a wall is let through
    const r = this.topmost([id], true)[0];
    return r ? this.trianglesOf(r) : new Float64Array();
  }

  replaceSolid(id: string, triangles: ArrayLike<number>): string {
    const r = this.solidRec(id);
    const faces = facesOf(triangles).flatMap(meshPieces);
    if (!faces.length) throw new Error("nothing would be left of this object");
    const made = this.instantiate(
      meshRecords(
        this.meshShell(),
        r.classIndex,
        r.data,
        faces.map((corners) => ({ like: r.data, corners })),
      ),
      r.owner,
    );
    if (!r.hasNext) setNext(made[0], false);
    const p = this.plan();
    p.remove(r.index, subtreeEnd(r));
    p.insert(subtreeEnd(r) + 1, made);
    const madeId = recOfData(made[0]).guid;
    this.commit(p, "objects", [madeId]);
    return madeId;
  }

  createHelixSpiral(ids: string[], o: HelixOptions): string[] {
    if (!(o.value > 0) || !Number.isFinite(o.value)) throw new Error(o.by === "turns" ? "the number of turns must be more than 0" : "the pitch must be more than 0");
    if (!(o.startRadius >= 0 && o.endRadius >= 0) || !(o.startRadius + o.endRadius > 0)) throw new Error("the radii must be 0 or more, and not both 0");
    const head = this.poly3dHead();
    const built = this.topmost(ids).flatMap((r) => {
      const run = pathPointsOf(r, layerElevationOf(r));
      if (!run) return [];
      const { total } = pathFrames(run.points, run.closed, true);
      const turns = o.by === "turns" ? o.value : total / o.value;
      const points = helixPoints(run.points, run.closed, turns, o.startRadius, o.endRadius, o.startAngle, o.reverse);
      if (typeof points === "string") throw new Error(points);
      return [{ id: r.guid, d: poly3dRecord(head, points.flat(), r, false) }];
    });
    if (!built.length) throw new Error("this needs a line, arc, rectangle, polygon, polyline, circle, ellipse or 3D polygon as the path");
    // each in its path's place
    return this.batch(() =>
      built.map(({ id, d }) => {
        const rec = this.object(id);
        const made = this.grouped([d], rec.owner, rec.classIndex);
        if (!rec.hasNext) setNext(made[0], false);
        const p = this.plan();
        p.remove(rec.index, subtreeEnd(rec));
        p.insert(rec.index, made);
        const top = recOfData(made[0]).guid;
        this.commit(p, "objects", [top]);
        return top;
      }),
    );
  }

  polysTo3DSourceData(items: readonly { id: string; elevation: number }[], segment: number, keepOriginals: boolean): string[] {
    if (!(segment >= 0) || !Number.isFinite(segment)) throw new Error("the segmentation length must be 0 or more");
    if (!items.every((it) => Number.isFinite(it.elevation))) throw new Error("each elevation must be a number");
    const head = this.poly3dHead();
    const built = items.flatMap(({ id, elevation }) => {
      const r = this.object(id);
      if (!CONTOUR_TYPES.has(r.type)) return [];
      // at its elevation above the layer
      const run = pathPointsOf(r, layerElevationOf(r) + elevation);
      if (!run) return [];
      const points = segment > 0 && CURVED_CONTOURS.has(r.type) ? segmented(run.points, run.closed, segment, cornersOf(r)) : run.points;
      return [{ id, d: poly3dRecord(head, points.flat(), r, run.closed) }];
    });
    if (!built.length) throw new Error("this needs 2D polygons or polylines (or lines, rectangles, arcs, circles or ellipses)");
    return this.batch(() =>
      built.map(({ id, d }) => {
        const rec = this.object(id);
        const made = this.grouped([d], rec.owner, rec.classIndex);
        const p = this.plan();
        // kept, the original stays in its place with the 3D polygon just behind it; or the 3D polygon takes its place
        if (keepOriginals) setNext(made[0], true);
        else {
          if (!rec.hasNext) setNext(made[0], false);
          p.remove(rec.index, subtreeEnd(rec));
        }
        p.insert(rec.index, made);
        const top = recOfData(made[0]).guid;
        this.commit(p, "objects", [top]);
        return top;
      }),
    );
  }

  wallOpenings(id: string): { a0: number; a1: number }[] {
    const r = this.object(id);
    if (r.type !== WALL || !readWall(r.data)) throw new Error("that object isn't a wall");
    // what's set in it straight in the wall, not in a group inside it
    const inserts = objectChildren(r).filter((o) => o.type === PLUGIN || o.type === SYMBOL_INSTANCE);
    if (!inserts.length) return [];
    const p = this.plan();
    const line = readWall(p.cur(r.index))!;
    const u = unitVec(line.start, line.end);
    return inserts
      .map((o) => {
        const a = this.insertCorners(p, o).map((q) => (q.x - line.start.x) * u.x + (q.y - line.start.y) * u.y);
        return { a0: Math.min(...a), a1: Math.max(...a) };
      })
      .sort((x, y) => x.a0 - y.a0);
  }

  wallFootprints(ids: string[]): Pt[][] {
    const out: Pt[][] = [];
    // walls, and those in groups
    const visit = (r: Rec): void => {
      if (r.type === 11) return objectChildren(r).forEach(visit);
      if (r.type !== WALL) return;
      // its plan drawing's hull: a door's or window's gap filled, its joins' mitres kept
      const hull = convexHull(objectChildren(r).flatMap((c) => (WALL_DRAWING.has(c.type) ? (shapeOf(c)?.points ?? []) : [])));
      if (hull.length >= 3) out.push(hull);
    };
    this.topmost(ids).forEach(visit);
    return out;
  }

  validate3DData(ids: string[]): SourceDataReport {
    const polys: SourcePoly[] = [];
    const repeated: { id: string; count: number }[] = [];
    // 3D polygons, and those in groups (not a plug-in's own)
    const visit = (r: Rec): void => {
      if (r.type === 11) return r.children.forEach(visit);
      if (r.type !== POLY3D) return;
      const d = r.data;
      const n = d.length >= POLY3D_VERTS ? u16(d, POLY3D_COUNT) : 0;
      if (POLY3D_VERTS + 24 * n > d.length) return;
      polys.push({ id: r.guid, points: Array.from({ length: n }, (_, i) => [0, 8, 16].map((k) => f64(d, POLY3D_VERTS + 24 * i + k))), closed: d[POLY3D_CLOSED] !== 0 });
      // counted as Simplify Polys takes them out
      const fewer = simplifiedRecord(r, "distance", SOURCE_TOLERANCE);
      if (fewer?.removed) repeated.push({ id: r.guid, count: fewer.removed });
    };
    this.topmost(ids)
      .sort((a, b) => a.index - b.index)
      .forEach(visit);
    return { ...sourceDataProblems(polys), repeated };
  }

  sectionSolid(baseId: string, cutterId: string, reverse: boolean, retain: boolean): string {
    const base = this.object(baseId);
    const cutter = this.object(cutterId);
    if (base === cutter) throw new Error("the solid and the sectioning object must be two objects");
    if (!SECTIONABLE.has(base.type)) throw new Error("the object to section must be an extrude, multiple extrude, sweep, solid or mesh");
    if (cutter.type !== POLY3D && !SECTIONABLE.has(cutter.type)) throw new Error("the sectioning object must be a 3D polygon, extrude, multiple extrude, sweep, solid or mesh");
    if (base.parent !== cutter.parent) throw new Error("the solid and the sectioning object must be in the same layer or group");
    const solid = this.trianglesOf(base);
    if (!solid.length) throw new Error("the solid shows no 3D faces");
    let found: { triangles: Float64Array } | null;
    if (cutter.type === POLY3D) {
      const run = pathPointsOf(cutter, 0);
      if (!run || run.points.length < 3) throw new Error("the 3D polygon needs three or more points");
      const box = halfSpaceBox(run.points, reverse, solid);
      if (typeof box === "string") throw new Error(box);
      found = subtractMeshes(solid, [box]);
    } else {
      const cut = this.trianglesOf(cutter);
      if (!cut.length) throw new Error("the sectioning object shows no 3D faces");
      found = reverse ? intersectMeshes([solid, cut]) : subtractMeshes(solid, [cut]);
    }
    if (!found) throw new Error(`these objects have more than ${MAX_CSG_TRIANGLES.toLocaleString("en")} faces between them, too many to section`);
    const pieces = facesOf(found.triangles).flatMap(meshPieces);
    if (!pieces.length) throw new Error(reverse && cutter.type !== POLY3D ? "the sectioning object doesn't overlap the solid" : "nothing of the solid would be left");
    // the faces the cut made, off the solid's own, are marked as the sectioning object is drawn
    const eps = 1e-6 * Math.max(1, boxSize(solid));
    const made = this.instantiate(
      meshRecords(
        this.meshShell(),
        base.classIndex,
        base.data,
        pieces.map((corners) => ({ like: onTriangles(centreOf(corners), solid, eps) ? base.data : cutter.data, corners })),
      ),
      base.owner,
    );
    const p = this.plan();
    if (!retain) p.remove(cutter.index, subtreeEnd(cutter));
    // the last of the list hands its end marker to the nearest earlier object that stays
    let last = !base.hasNext;
    if (!retain && !cutter.hasNext) {
      const siblings = cutter.parent?.children ?? [];
      let i = siblings.indexOf(cutter) - 1;
      while (i >= 0 && p.isRemoved(siblings[i].index)) i--;
      if (siblings[i] === base) last = true;
      else if (i >= 0 && siblings[i].hasNext) setNext(p.mut(siblings[i].index), false);
    }
    if (last) setNext(made[0], false);
    p.remove(base.index, subtreeEnd(base));
    p.insert(subtreeEnd(base) + 1, made);
    const id = recOfData(made[0]).guid;
    this.commit(p, "objects", [id]);
    return id;
  }

  /** An object's 3D faces as one list of triangles, x y z for each corner, in the model. */
  private trianglesOf(r: Rec): Float64Array {
    const parts = objectTriangles(this.doc, r).map((m) => m.triangles);
    const all = new Float64Array(parts.reduce((n, t) => n + t.length, 0));
    parts.reduce((at, t) => (all.set(t, at), at + t.length), 0);
    return all;
  }

  /**
   * The records a new extrude is made of, from one in the drawing: its header, its texture
   * dictionaries (TDMD aux records) and its terminator, without its body, profile or other aux
   * records. One saved without a body and holding nothing else is preferred; a drawing with none
   * gets the built-in one.
   */
  private extrudeShell(): Template {
    const tdmd = (c: Rec): boolean => c.type === AUX_RECORD && c.data.length >= 0x54 && String.fromCharCode(...c.data.subarray(0x50, 0x54)) === "TDMD";
    const plain = (r: Rec): boolean => r.children.slice(0, auxCount(r)).every(tdmd);
    const all = this.doc.recs.filter((r) => r.type === EXTRUDE && r.children.at(-1)?.type === 0);
    const bodiless = all.filter((r) => !r.children.some((c) => c.type === BODY));
    const tpl = bodiless.find(plain) ?? all.find(plain) ?? bodiless[0] ?? all[0];
    if (!tpl) return builtinExtrudeShell();
    const keep = new Set([...tpl.children.slice(0, auxCount(tpl)).filter(tdmd), tpl.children.at(-1)!]);
    const t = templateOf(tpl, (r, depth) => depth === 1 && !keep.has(r));
    // the last texture dictionary now ends the aux list
    const aux = t.recs.slice(1, -1).map((d) => d.slice());
    aux.forEach((d, i) => setNext(d, i < aux.length - 1));
    t.recs.splice(1, aux.length, ...aux);
    return t;
  }

  /** Gives copies of a plug-in's drawing what the plug-in gave it when drawn: its opacity, and text that reads the right way up. */
  private drawAsPlugin(ids: string[], plugin: Rec): void {
    const fade = this.doc.attrsOf(plugin);
    const parts = this.topmost(ids).flatMap((r) => [...objectWalk(r)]);
    // found before the opacities commit, which leaves these records behind; ids stay. Text inside
    // a plug-in among them is placed by that one's matrix, which it keeps
    const turns = this.topmost(ids).flatMap((r) => [...movedWalk(r)]).flatMap((r) => {
      const c = upsideDownText(r);
      return c ? [{ id: r.guid, c }] : [];
    });
    if (fade && (fade.fillOpacity < 100 || fade.penOpacity < 100)) {
      // every part in one step: a plug-in can hold hundreds
      const p = this.plan();
      for (const r of parts) {
        const a = this.doc.attrsOf(r);
        if (!a) continue;
        const faded = { fillOpacity: Math.round((a.fillOpacity * fade.fillOpacity) / 100), penOpacity: Math.round((a.penOpacity * fade.penOpacity) / 100) };
        writeAttrs(p.mut(r.index), { ...this.classGroups(r, ["fillOpacity", "penOpacity"]), ...faded });
      }
      this.commit(p, "objects", parts.map((r) => r.guid));
    }
    for (const { id, c } of turns) this.transformObjects([id], { a: -1, b: 0, c: 0, d: -1, e: 2 * c.x, f: 2 * c.y });
  }
}

const CLIPBOARD_FORMAT = "openvwx-objects-1";
/** Most clipboard bytes accepted on paste. */
const MAX_CLIPBOARD_BYTES = 64 << 20;

type ClipboardRecord = { -readonly [K in keyof ClipboardData["records"][number]]: ClipboardData["records"][number][K] };

interface PasteItem {
  data: Uint8Array;
  parent: number;
  object: boolean;
  /** inside a 3D object's own frame: it moves with that object's frame, not by itself */
  held: boolean;
  className: string;
  lineType?: string;
  symbol?: string;
  fill?: string;
  font?: string;
  textStyle?: string;
  material?: string;
  colors?: readonly string[];
  format?: string;
  textures?: readonly string[];
}

/** An object's fill foreground and background and pen foreground and background colour indices (attrs.ts) */
const COLOR_SLOTS = [0x56, 0x58, 0x5a, 0x5c] as const;
/** i16 fill pattern: −n is the fill resource named n */
const FILL_PATTERN = 0x64;
const SOLID_FILL = 1;
const FILL_KINDS: ReadonlySet<string> = new Set(["hatch", "tile", "gradient", "image-fill"]);

/** A 3D box: x0, y0, z0, x1, y1, z1. */
type Box3 = readonly number[];

/** `box` grown to take in flat x, y, z triples. */
function growBox3(box: Box3 | null, xyz: ArrayLike<number>): Box3 | null {
  if (xyz.length < 3) return box;
  const b = box ? [...box] : [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < xyz.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      b[k] = Math.min(b[k], xyz[i + k]);
      b[k + 3] = Math.max(b[k + 3], xyz[i + k]);
    }
  }
  return b;
}

function unionBox3(a: Box3 | null, b: Box3 | null): Box3 | null {
  if (!a || !b) return a ?? b;
  return [0, 1, 2, 3, 4, 5].map((k) => (k < 3 ? Math.min(a[k], b[k]) : Math.max(a[k], b[k])));
}

/** The box round `box`'s corners carried by m (rows: the x, y and z axes' images, then the offset). */
function placeBox3(box: Box3 | null, m: readonly number[]): Box3 | null {
  if (!box) return null;
  const corners: number[] = [];
  for (const x of [box[0], box[3]]) {
    for (const y of [box[1], box[4]]) {
      for (const z of [box[2], box[5]]) corners.push(...[0, 1, 2].map((k) => x * m[k] + y * m[3 + k] + z * m[6 + k] + m[9 + k]));
    }
  }
  return growBox3(null, corners);
}

/**
 * How a symbol instance's or plug-in's 4 × 3 matrix at `at` places what it holds in z: the height
 * it raises it by (0 for none) when it neither tilts nor stretches it, else null.
 */
function placementIn3D(d: Uint8Array, at: number): number | null {
  if (d.length < at + 96) return 0;
  const m = (row: number, col: number): number => f64(d, at + 24 * row + 8 * col);
  const flat = [m(0, 2), m(1, 2), m(2, 0), m(2, 1), m(2, 2) - 1].every((v) => Math.abs(v) <= 1e-12);
  const dz = m(3, 2);
  return flat && Number.isFinite(dz) ? (Math.abs(dz) <= 1e-12 ? 0 : dz) : null;
}

/** A camera's parameter record with its eye and look-to point taken through m in plan (see carryCamera). */
function cameraRecordThrough(d: Uint8Array, fmt: FormatDef, m: Affine): Uint8Array {
  const fields = readValues(d, fmt) ?? [];
  const get = (name: string): number | null => {
    const v = fields.find((f) => f.name === name)?.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  for (const [name, value] of Object.entries(cameraPointsThrough(get, m, 0))) if (get(name) !== null) d = writeValue(d, fmt, name, value);
  return d;
}

/**
 * Decode and check clipboard JSON before any of it reaches the document: it
 * may come from the system clipboard, so every record must be well formed and
 * the parent links must describe a pre-order tree.
 */
function readClipboard(data: ClipboardData, drawing: string): PasteItem[] {
  if (data?.format !== CLIPBOARD_FORMAT || !Array.isArray(data.records)) throw new Error("clipboard holds no openvwx objects");
  // copied from the drawing it goes into, which numbers everything in it the same way
  const here = data.drawing === drawing;
  const items: PasteItem[] = [];
  const stack: number[] = [];
  let total = 0;
  for (const [i, r] of data.records.entries()) {
    if (typeof r?.data !== "string" || typeof r.className !== "string" || !Number.isInteger(r.parent)) {
      throw new Error("clipboard data is damaged");
    }
    const d = fromBase64(r.data);
    total += d.length;
    if (total > MAX_CLIPBOARD_BYTES) throw new Error("clipboard data is too large");
    if (d.length < 0x50 || u64(d, 0) !== BigInt(d.length)) throw new Error("clipboard data is damaged");
    while (stack.length && stack[stack.length - 1] !== r.parent) stack.pop();
    if (r.parent !== -1 && !stack.length) throw new Error("clipboard data is damaged");
    stack.push(i);
    const object = r.className !== "";
    const type = d[0x19];
    const up = r.parent === -1 ? undefined : items[r.parent];
    const held = !!up && (up.held || (up.object && !childrenMoveWith(up.data[0x19])));
    if (object ? !(held || COPIED.has(type)) || d.length < ATTR_END : !here && MOVABLE.has(type)) throw new Error("clipboard data is damaged");
    if (r.parent === -1 && !object) throw new Error("clipboard data is damaged");
    if (object && !here && !(held ? CARRIED : MOVABLE).has(type)) throw new Error(`${typeLabel(type)} objects can't be pasted into another drawing yet`);
    const text = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
    const listed: unknown = r.colors;
    const colors = Array.isArray(listed) && listed.length === COLOR_SLOTS.length && listed.every((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) ? listed : undefined;
    const textures: unknown = r.textures;
    items.push({
      data: d,
      parent: r.parent,
      object,
      held,
      className: r.className,
      lineType: r.lineType,
      symbol: r.symbol,
      fill: text(r.fill),
      font: text(r.font),
      textStyle: text(r.textStyle),
      material: text(r.material),
      colors,
      format: text(r.format),
      textures: Array.isArray(textures) && textures.every((t) => typeof t === "string") && isTextureDict(recOfData(d)) ? textures : undefined,
    });
  }
  return items;
}

const EXTRUDE = 24;
const SWEEP = 34;
const MULTI_EXTRUDE = 38;
const SOLID = 84;
/** What Add Solids and Subtract Solids take. */
const SOLID_OPERANDS = new Set([EXTRUDE, SWEEP, MULTI_EXTRUDE, SOLID]);
/**
 * A solid's header (FORMAT.md §3D): an extrude's 324 bytes and 62 more, all 0 but a 1 at +0x17c,
 * its operation at +0x17d (1 adds, 3 subtracts) and a u32 at +0x17e (all 1s when new).
 */
const SOLID_HEADER = 386;
const SOLID_FLAG = 0x17c;
const SOLID_KIND = 0x17d;
const SOLID_REF = 0x17e;
const BODY = 114;
const AUX_RECORD = 76;
/** the kind of list shader settings' record formats sit in (formatList) */
const SHADER_LIST = "76 TMFH";
/** sin and cos of an angle in degrees, exact at multiples of 90 so right-angle turns stay exact. */
function exactSinCos(deg: number): { s: number; c: number } {
  const r = ((deg % 360) + 360) % 360;
  if (r === 0) return { s: 0, c: 1 };
  if (r === 90) return { s: 1, c: 0 };
  if (r === 180) return { s: 0, c: -1 };
  if (r === 270) return { s: -1, c: 0 };
  return { s: Math.sin((deg * Math.PI) / 180), c: Math.cos((deg * Math.PI) / 180) };
}

/** An extrude's frame (FORMAT.md §7, 3D): three axis rows, then the offset; its 3D box, highs then lows; its material. */
const FRAME_ROWS = 0xcc;
const FRAME_OFFSET = 0x114;
const BOX_3D = 0x9c;
const EXTRUDE_MATERIAL = 0x88;

/**
 * Sets up a new extrude's or solid's records `made` (header first) to stand on its layer from
 * `low` to `height` over `box`, taking `r`'s class, attributes and material and none of the
 * template's textures.
 */
function standExtrude(made: Uint8Array[], r: Rec, box: BBox, height: number, low = 0): void {
  const d = made[0];
  setU16(d, 0x1a, 0);
  setU32(d, 0x20, r.classIndex);
  setU16(d, BY_CLASS, u16(r.data, BY_CLASS));
  d.set(r.data.subarray(0x50, ATTR_END), 0x50);
  setU32(d, EXTRUDE_MATERIAL, r.data.length >= EXTRUDE_MATERIAL + 4 ? u32(r.data, EXTRUDE_MATERIAL) : 0);
  // its own frame is the layer's at 0 (a new extrude is then lifted to its layer's elevation): the
  // profile keeps its coordinates and stands on the ground
  [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => setF64(d, FRAME_ROWS + 8 * i, v));
  [0, 0, 0].forEach((v, i) => setF64(d, FRAME_OFFSET + 8 * i, v));
  [box.x1, box.y1, height, box.x0, box.y0, low].forEach((v, i) => setF64(d, BOX_3D + 8 * i, v));
  writeBBox(d, box);
  for (const aux of made.slice(1, -1)) for (const part of isTextureDict(recOfData(aux)) ? readTextureParts(aux) : []) writeTexturePart(aux, part.part, { texture: -1 });
}

const SWEEP_HEADER = 356;
/** where a sweep's header goes on from an extrude's: start angle or pitch (both 0 in the demos) */
const SWEEP_START = 0x140;
const SWEEP_SEGMENT = 0x148;
const SWEEP_ARC = 0x158;
/** u32: all ones in sweeps without a body */
const SWEEP_REF = 0x160;

/**
 * A new sweep's settings from its profile `r` (as standExtrude's), and its frame: the profile
 * stands up in the plane through the middle of its plan box, its bottom on the layer, so it turns
 * about the upright through its left edge (model3d's sweepGeometry). The 3D box and plan box fit
 * what `arc` degrees of turning sweeps out.
 */
function standSweep(made: Uint8Array[], r: Rec, box: BBox, arc: number): void {
  standExtrude(made, r, box, 0);
  const d = made[0];
  const cy = (box.y0 + box.y1) / 2;
  // own x stays x, own y goes up, own z goes towards −y
  [1, 0, 0, 0, 0, 1, 0, -1, 0].forEach((v, i) => setF64(d, FRAME_ROWS + 8 * i, v));
  [0, cy, -box.y0].forEach((v, i) => setF64(d, FRAME_OFFSET + 8 * i, v));
  // the turn's reach: x0 + dx sin θ and −dx cos θ for dx from 0 to the profile's width
  const reach = box.x1 - box.x0;
  const angles = [0, arc, ...[90, 180, 270].filter((a) => a < arc)].map((a) => (a * Math.PI) / 180);
  const sin = angles.map(Math.sin);
  const cos = angles.map(Math.cos);
  const x0 = box.x0 + reach * Math.min(0, ...sin);
  const x1 = box.x0 + reach * Math.max(0, ...sin);
  const z0 = -reach * Math.max(0, ...cos);
  const z1 = -reach * Math.min(0, ...cos);
  [x1, box.y1, z1, x0, box.y0, z0].forEach((v, i) => setF64(d, BOX_3D + 8 * i, v));
  // in plan: own x is x, own z is cy − z
  writeBBox(d, { x0, y0: cy - z1, x1, y1: cy - z0 });
}

/** A closed 2D shape Model > Extrude takes as a profile: a rectangle, rounded rectangle, polygon, polyline, or a whole circle or ellipse. */
function extrudable(r: Rec): boolean {
  if (r.type !== 3 && r.type !== 13 && r.type !== 5 && r.type !== 21 && r.type !== 6) return false;
  const s = decodeShape(r);
  if (!s?.bbox) return false;
  return r.type === 6 ? Math.abs(s.sweepAngle ?? 0) >= 360 : s.points.length >= 3;
}

const POLY3D = 25;
const POLY3D_CLOSED = 0x8d;
const POLY3D_COUNT = 0xd0;
const POLY3D_VERTS = 0xd2;

/**
 * A 3D polygon round `face` (x, y, z triples), closed unless `closed` is false, with `head`'s settings (a 3D polygon's record
 * up to its points), the class, attributes and by-class flags of `like`, and its plan box at +0x68
 * and 3D box at +0x9c (highs, then lows) fitted.
 */
/** A new 3D locus's record: laid out as the demos' are (FORMAT.md), in the class asked for. */
function locus3dRecord(x: number, y: number, z: number, classIndex: number): Uint8Array {
  const d = new Uint8Array(LOCUS3D_LENGTH);
  setU64(d, 0, BigInt(LOCUS3D_LENGTH));
  d[0x19] = LOCUS3D;
  d[0x1f] = 0x40;
  setU32(d, 0x20, classIndex);
  d[0x38] = 1;
  d.set([2, 0, 0, 0, 2, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0x64, 0x64, 0, 0, 0, 0, 1], 0x50);
  [x, y, z].forEach((v, k) => setF64(d, LOCUS3D_LENGTH - 24 + 8 * k, v));
  return d;
}

function poly3dRecord(head: Uint8Array, face: readonly number[], like: { readonly classIndex: number; readonly data: Uint8Array }, closed = true): Uint8Array {
  const n = face.length / 3;
  const d = new Uint8Array(POLY3D_VERTS + 24 * n);
  d.set(head);
  setU64(d, 0, BigInt(d.length));
  setU64(d, 0x10, 0n);
  setU16(d, 0x1a, 0);
  setU32(d, 0x20, like.classIndex);
  if (like.data.length >= ATTR_END) {
    setU16(d, BY_CLASS, u16(like.data, BY_CLASS));
    d.set(like.data.subarray(0x50, ATTR_END), 0x50);
  }
  d[POLY3D_CLOSED] = closed ? 1 : 0;
  setU16(d, POLY3D_COUNT, n);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = face[3 * i + k];
      setF64(d, POLY3D_VERTS + 24 * i + 8 * k, v);
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
    }
  }
  writeBBox(d, { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] });
  [...hi, ...lo].forEach((v, i) => setF64(d, 0x9c + 8 * i, v));
  return d;
}

/** most contours Create Contours makes through one object */
const MAX_CONTOURS = 1000;

const MESH = 40;
const MESH_COUNT = 0xd0;
const MESH_VERTS = 0xd4;
const MESH_VERT_SIZE = 28;
/** the 4 bytes after each vertex's point, as every vertex of most of the demos' meshes has them */
const MESH_VERT_FLAGS = [0, 1, 0, 0];
const FACE_COUNT = 0xcc;
const FACE_CORNERS = 0xce;
/** 1 in most faces Vectorworks saves, whose plan and 3D boxes are then both left empty */
const FACE_UNBOXED = 0x8d;
/** the most corners a face has in the demos */
const MAX_FACE_CORNERS = 10;
/** What Section Solids cuts, and cuts with besides a 3D polygon: solids and meshes. */
const SECTIONABLE = new Set([EXTRUDE, SWEEP, MULTI_EXTRUDE, SOLID, MESH]);

interface MeshShell {
  head: Uint8Array;
  face: Uint8Array;
  term: Uint8Array;
}

/**
 * A mesh in class `cls`, drawn with the attributes of the record `like` (its data), of `faces`
 * (corners as x, y, z triples round each): one vertex for each distinct corner, numbered from 1,
 * and each face drawn as its own `like`, in the mesh's class as Vectorworks keeps faces. No aux
 * records, but with `map` (every face then giving (u, v) at each corner): texture `map.texture`
 * mapped by UV, a vertex for each distinct corner, (u, v) and face normal, and `map.aux` making
 * the UV map and texture settings records from their bodies.
 */
function meshRecords(
  shell: MeshShell,
  cls: number,
  like: Uint8Array,
  faces: { like: Uint8Array; corners: number[]; uvs?: number[] }[],
  map?: { texture: number; aux: (body: Uint8Array) => Uint8Array },
): Template {
  const look = (d: Uint8Array, from: Uint8Array): void => {
    setU64(d, 0, BigInt(d.length));
    setU64(d, 0x10, 0n);
    setU16(d, 0x1a, 0);
    setU32(d, 0x20, cls);
    if (from.length >= ATTR_END) {
      setU16(d, BY_CLASS, u16(from, BY_CLASS));
      d.set(from.subarray(0x50, ATTR_END), 0x50);
    }
  };
  const numbered = new Map<string, number>();
  const points: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const recs = faces.map(({ like: from, corners, uvs: at }) => {
    const n = corners.length / 3;
    const normal = map ? faceNormal(corners) : null;
    const d = new Uint8Array(FACE_CORNERS + 4 * n);
    d.set(shell.face);
    look(d, from);
    setNext(d, true);
    d[FACE_UNBOXED] = 1;
    [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE].forEach((v, i) => setF64(d, 0x68 + 8 * i, v));
    [-1, -1, -1, 1, 1, 1].forEach((v, i) => setF64(d, 0x9c + 8 * i, v * Number.MAX_VALUE));
    setU16(d, FACE_COUNT, n);
    for (let i = 0; i < n; i++) {
      const p = corners.slice(3 * i, 3 * i + 3);
      const uv = normal ? [at?.[2 * i] ?? 0, at?.[2 * i + 1] ?? 0] : null;
      // a mapped corner is the same vertex only with the same (u, v) and normal
      const key = normal ? `${p.join(",")}|${uv!.join(",")}|${normal.map((x) => x.toFixed(6)).join(",")}` : p.join(",");
      let v = numbered.get(key);
      if (v === undefined) {
        v = points.length / 3 + 1;
        numbered.set(key, v);
        points.push(...p);
        if (normal) {
          normals.push(...normal);
          uvs.push(...uv!);
        }
      }
      setU32(d, FACE_CORNERS + 4 * i, v);
    }
    return d;
  });
  const n = points.length / 3;
  const m = new Uint8Array(MESH_VERTS + MESH_VERT_SIZE * n);
  m.set(shell.head);
  look(m, like);
  setU32(m, MESH_COUNT, n);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = points[3 * i + k];
      setF64(m, MESH_VERTS + MESH_VERT_SIZE * i + 8 * k, v);
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
    }
    m.set(MESH_VERT_FLAGS, MESH_VERTS + MESH_VERT_SIZE * i + 24);
  }
  writeBBox(m, { x0: lo[0], y0: lo[1], x1: hi[0], y1: hi[1] });
  [...hi, ...lo].forEach((v, i) => setF64(m, 0x9c + 8 * i, v));
  // its aux records, the UV map then the texture settings (as the demos' plants keep them), come first in its list
  const aux = map ? [map.aux(newUvMapDict(normals, uvs, recs.length)), map.aux(newUvTextureDict(map.texture))] : [];
  if (aux.length) {
    setU64(m, 0x10, 1n);
    setNext(aux[0], true);
    setNext(aux[1], false);
  }
  return { recs: [m, ...aux, ...recs, shell.term], parent: [-1, ...aux.map(() => 0), ...recs.map(() => 0), 0] };
}

/** A face's unit normal (Newell's method), [0, 0, 1] for one with no area. */
function faceNormal(corners: readonly number[]): number[] {
  const n = corners.length / 3;
  const nrm = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const a = 3 * i;
    const b = 3 * ((i + 1) % n);
    nrm[0] += (corners[a + 1] - corners[b + 1]) * (corners[a + 2] + corners[b + 2]);
    nrm[1] += (corners[a + 2] - corners[b + 2]) * (corners[a] + corners[b]);
    nrm[2] += (corners[a] - corners[b]) * (corners[a + 1] + corners[b + 1]);
  }
  const len = Math.hypot(...nrm);
  return len > 0 ? nrm.map((x) => x / len) : [0, 0, 1];
}

/** (u, v) at each of `piece`'s corners, each one of `face`'s, whose (u, v) are `uvs`. */
function cornerUvs(face: readonly number[], uvs: readonly number[], piece: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < piece.length; i += 3) {
    let k = 0;
    while (k < face.length && (face[k] !== piece[i] || face[k + 1] !== piece[i + 1] || face[k + 2] !== piece[i + 2])) k += 3;
    out.push(uvs[(2 * k) / 3] ?? 0, uvs[(2 * k) / 3 + 1] ?? 0);
  }
  return out;
}

/**
 * A flat face (x, y, z triples round it) as faces a mesh holds: convex, since a mesh's faces are
 * drawn as fans from their first corner, and of at most MAX_FACE_CORNERS corners. A convex face
 * is cut into fans that size; another into triangles, turned as the face is.
 */
/** Cut 3D Section's plane: upright through `a`, along (ux, uy); `side` 1 keeps what lies left of it, -1 what lies right. */
interface SectionFrame {
  a: Pt;
  ux: number;
  uy: number;
  side: number;
}

/** distances (mm) from the section plane this small are on it */
const ON_PLANE = 1e-7;

/** Whether `p` is inside the loop (u, z pairs), by the even-odd rule. */
function insideLoop(p: readonly number[], loop: readonly number[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 2; i < loop.length; j = i, i += 2) {
    const [xi, yi, xj, yj] = [loop[i], loop[i + 1], loop[j], loop[j + 1]];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * The part of `tris` (9 numbers a triangle) on the kept side of the section plane, each triangle
 * crossing it cut there, and the cut closed: where the plane cuts the part, filled (a loop inside
 * another a hole in it, one inside that filled again), facing the side given up.
 */
function keptPart(tris: ArrayLike<number>, f: SectionFrame): number[] {
  const out: number[] = [];
  const across = (i: number): number => (tris[i + 1] - f.a.y) * f.ux - (tris[i] - f.a.x) * f.uy;
  for (let t = 0; t + 8 < tris.length; t += 9) {
    const d = [t, t + 3, t + 6].map((i) => {
      const v = f.side * across(i);
      return Math.abs(v) < ON_PLANE ? 0 : v;
    });
    // one lying in the plane is left to the cut's fill
    if (d.every((v) => v >= 0)) {
      if (d.some((v) => v > 0)) for (let k = 0; k < 9; k++) out.push(tris[t + k]);
      continue;
    }
    if (d.every((v) => v <= 0)) continue;
    // the triangle cut at the plane, turned as it was, then fanned
    const corner = (k: number): number[] => [tris[t + 3 * k], tris[t + 3 * k + 1], tris[t + 3 * k + 2]];
    const poly: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const j = (k + 1) % 3;
      if (d[k] >= 0) poly.push(corner(k));
      if ((d[k] > 0 && d[j] < 0) || (d[k] < 0 && d[j] > 0)) {
        // from the kept end, so the triangle on the edge's other side finds the very same point
        const [kept, gone] = d[k] > 0 ? [k, j] : [j, k];
        const s = d[kept] / (d[kept] - d[gone]);
        const [p, q] = [corner(kept), corner(gone)];
        poly.push([0, 1, 2].map((c) => p[c] + s * (q[c] - p[c])));
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) out.push(...poly[0], ...poly[k], ...poly[k + 1]);
  }
  // the cut: along the line (u), across it (v) and up (z), cut where v is 0
  const frame = new Float64Array(tris.length);
  for (let i = 0; i + 2 < tris.length; i += 3) {
    const dx = tris[i] - f.a.x;
    const dy = tris[i + 1] - f.a.y;
    frame[i] = dx * f.ux + dy * f.uy;
    frame[i + 1] = dy * f.ux - dx * f.uy;
    frame[i + 2] = tris[i + 2];
  }
  const loops = contourAt(frame, 1, 0)
    .filter((c) => c.closed)
    .map((c) => {
      const uz: number[] = [];
      for (let k = 0; k + 2 < c.points.length; k += 3) uz.push(c.points[k], c.points[k + 2]);
      return uz;
    });
  const depth = loops.map((l, i) => loops.filter((m, j) => j !== i && insideLoop([l[0], l[1]], m)).length);
  // seen from the side given up: anticlockwise in (u, z) faces away from the left, so it closes a part kept on the left
  const want = f.side;
  loops.forEach((outer, i) => {
    if (depth[i] % 2) return;
    const holes = loops.filter((h, j) => depth[j] === depth[i] + 1 && insideLoop([h[0], h[1]], outer));
    const flat = [outer, ...holes].flat();
    const starts: number[] = [];
    let at = outer.length / 2;
    for (const h of holes) {
      starts.push(at);
      at += h.length / 2;
    }
    const tri = earcut(flat, starts.length ? starts : null, 2);
    const world = (k: number): number[] => [f.a.x + flat[2 * k] * f.ux, f.a.y + flat[2 * k] * f.uy, flat[2 * k + 1]];
    for (let k = 0; k + 2 < tri.length; k += 3) {
      let [p, q, r] = [tri[k], tri[k + 1], tri[k + 2]];
      const area = (flat[2 * q] - flat[2 * p]) * (flat[2 * r + 1] - flat[2 * p + 1]) - (flat[2 * r] - flat[2 * p]) * (flat[2 * q + 1] - flat[2 * p + 1]);
      if (Math.sign(area) !== want) [q, r] = [r, q];
      out.push(...world(p), ...world(q), ...world(r));
    }
  });
  return out;
}

/** A closed 2D shape's outline as flat xy, wound counter-clockwise, without a repeated closing point; a circle or ellipse in 48 sides. */
function profileRingOf(r: Rec): number[] | null {
  const s = decodeShape(r);
  if (!s) return null;
  const xy: number[] = [];
  if (r.type === 6) {
    if (!s.center || !s.rx || Math.abs(s.sweepAngle ?? 0) < 360) return null;
    for (let i = 0; i < 48; i++) xy.push(s.center.x + s.rx * Math.cos((Math.PI * i) / 24), s.center.y + (s.ry ?? s.rx) * Math.sin((Math.PI * i) / 24));
  } else {
    for (const p of s.points) {
      const n = xy.length;
      if (!n || Math.hypot(xy[n - 2] - p.x, xy[n - 1] - p.y) > 1e-9) xy.push(p.x, p.y);
    }
    while (xy.length > 2 && Math.hypot(xy[0] - xy[xy.length - 2], xy[1] - xy[xy.length - 1]) <= 1e-9) xy.length -= 2;
  }
  if (xy.length < 6 || !xy.every(Number.isFinite)) return null;
  let area = 0;
  for (let i = 0; i < xy.length; i += 2) area += xy[i] * xy[(i + 3) % xy.length] - xy[(i + 2) % xy.length] * xy[i + 1];
  if (!(Math.abs(area) > 1e-9)) return null;
  if (area > 0) return xy;
  const out: number[] = [];
  for (let i = xy.length - 2; i >= 0; i -= 2) out.push(xy[i], xy[i + 1]);
  return out;
}

/**
 * A counter-clockwise ring with each side moved `d` inward (outward when negative), its corners
 * mitred: the top of a tapered extrude. Null when a side turns round or the ring crosses itself.
 */
function insetRing(ring: number[], d: number): number[] | null {
  const n = ring.length / 2;
  const x = (i: number): number => ring[2 * ((i + n) % n)];
  const y = (i: number): number => ring[2 * ((i + n) % n) + 1];
  // each side's inward normal: left of its direction
  const normals = Array.from({ length: n }, (_, i) => {
    const [dx, dy] = [x(i + 1) - x(i), y(i + 1) - y(i)];
    const len = Math.hypot(dx, dy);
    return [-dy / len, dx / len];
  });
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [a, b] = [normals[(i + n - 1) % n], normals[i]];
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    if (k < 1e-9) return null;
    out.push(x(i) + (d * (a[0] + b[0])) / k, y(i) + (d * (a[1] + b[1])) / k);
  }
  // no side turned round, and no two sides crossing
  const ox = (i: number): number => out[2 * ((i + n) % n)];
  const oy = (i: number): number => out[2 * ((i + n) % n) + 1];
  for (let i = 0; i < n; i++) {
    if ((ox(i + 1) - ox(i)) * (x(i + 1) - x(i)) + (oy(i + 1) - oy(i)) * (y(i + 1) - y(i)) <= 0) return null;
  }
  const cross = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [p, q, r, s] = [i, i + 1, j, j + 1];
      const d1 = cross(ox(r), oy(r), ox(s), oy(s), ox(p), oy(p));
      const d2 = cross(ox(r), oy(r), ox(s), oy(s), ox(q), oy(q));
      const d3 = cross(ox(p), oy(p), ox(q), oy(q), ox(r), oy(r));
      const d4 = cross(ox(p), oy(p), ox(q), oy(q), ox(s), oy(s));
      if (d1 * d2 < 0 && d3 * d4 < 0) return null;
    }
  }
  return out;
}

/**
 * A path's points in the model, x y z each, and whether it closes: a line's ends, an arc's or
 * circle's in steps of at most 7.5°, a rectangle's, polygon's or polyline's corners (curves as
 * drawn), each at the layer's elevation `z`, or a 3D polygon's points. Null for anything else.
 */
function pathPointsOf(r: Rec, z: number): { points: number[][]; closed: boolean } | null {
  let points: number[][] = [];
  let closed = false;
  // a one-point path, which nothing that needs a line can take
  if (r.type === LOCUS3D) return r.data.length < LOCUS3D_LENGTH ? null : { points: [[0, 8, 16].map((k) => f64(r.data, LOCUS3D_LENGTH - 24 + k))], closed: false };
  if (r.type === POLY3D) {
    const d = r.data;
    const n = d.length >= POLY3D_VERTS ? u16(d, POLY3D_COUNT) : 0;
    if (POLY3D_VERTS + 24 * n > d.length) return null;
    for (let i = 0; i < n; i++) points.push([0, 8, 16].map((k) => f64(d, POLY3D_VERTS + 24 * i + k)));
    closed = d[POLY3D_CLOSED] !== 0;
  } else {
    const s = decodeShape(r);
    if (!s) return null;
    if (r.type === 6) {
      if (!s.center || !s.rx) return null;
      const sweep = s.sweepAngle ?? 0;
      closed = Math.abs(sweep) >= 360;
      const steps = Math.max(2, Math.ceil(Math.abs(closed ? 360 : sweep) / 7.5));
      for (let i = 0; i < (closed ? steps : steps + 1); i++) {
        const t = (((s.startAngle ?? 0) + ((closed ? 360 * Math.sign(sweep) : sweep) * i) / steps) * Math.PI) / 180;
        points.push([s.center.x + s.rx * Math.cos(t), s.center.y + (s.ry ?? s.rx) * Math.sin(t), z]);
      }
    } else if (r.type === 2 || r.type === 3 || r.type === 13 || r.type === 5 || r.type === 21) {
      points = s.points.map((p) => [p.x, p.y, z]);
      closed = r.type === 3 || r.type === 13 || s.closed === true;
    } else return null;
  }
  // repeated points, and a closing point that repeats the first, dropped
  const same = (a: number[], b: number[]): boolean => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) <= 1e-6;
  points = points.filter((p, i) => p.every(Number.isFinite) && (i === 0 || !same(p, points[i - 1])));
  if (points.length > 2 && same(points[0], points[points.length - 1])) {
    points.pop();
    closed = true;
  }
  return points.length >= 2 ? { points, closed: closed && points.length >= 3 } : null;
}

/** The convex hull of `points`, counter-clockwise, without points in line (Andrew's monotone chain); fewer than 3 points when they have no area. */
function convexHull(points: readonly Pt[]): Pt[] {
  const ps = points.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y)).sort((a, b) => a.x - b.x || a.y - b.y);
  if (ps.length < 3) return [];
  const turn = (o: Pt, a: Pt, b: Pt): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: readonly Pt[]): Pt[] => {
    const h: Pt[] = [];
    for (const q of list) {
      while (h.length >= 2 && turn(h[h.length - 2], h[h.length - 1], q) <= 1e-9) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  const hull = [...half(ps), ...half([...ps].reverse())];
  return hull.length >= 3 ? hull : [];
}

/** the 2D objects 2D Polys to 3D Source Data takes as contours: lines, rectangles, polygons, arcs, ellipses and polylines */
const CONTOUR_TYPES = new Set([2, 3, 5, 6, 13, 21]);
/** of those, the ones with curves a segmentation length applies to */
const CURVED_CONTOURS = new Set([6, 13, 21]);

/** Where a polyline has corners: its corner vertices, which its flattened outline passes through. */
function cornersOf(r: Rec): { x: number; y: number }[] {
  const s = decodeShape(r);
  return r.type === 21 && s?.vertices ? s.vertices.filter((v) => v.kind === "corner").map((v) => v.p) : [];
}

/**
 * A flattened outline with its curves in pieces about `length` long: a point is kept once the
 * outline has run that far since the last one kept, and at every corner and an open run's ends.
 * It only takes points out, so a length shorter than the flattening's own steps leaves it as it is.
 */
function segmented(points: number[][], closed: boolean, length: number, corners: readonly { x: number; y: number }[]): number[][] {
  const corner = (q: number[]): boolean => corners.some((c) => Math.hypot(c.x - q[0], c.y - q[1]) <= 1e-6);
  const out = [points[0]];
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    run += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (run >= length || corner(points[i]) || (!closed && i === points.length - 1)) {
      out.push(points[i]);
      run = 0;
    }
  }
  return out.length >= (closed ? 3 : 2) ? out : points;
}

const sub3 = (a: number[], b: number[]): number[] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: number[], b: number[]): number[] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit3 = (a: number[]): number[] => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
/** `v` turned about unit `axis` by the angle whose cosine and sine are c and s (Rodrigues). */
const turn3 = (v: number[], axis: number[], c: number, s: number): number[] => {
  const k = cross3(axis, v);
  const d = dot3(axis, v) * (1 - c);
  return [0, 1, 2].map((i) => v[i] * c + k[i] * s + axis[i] * d);
};

/** The diagonal of the box round a list of triangles' corners. */
function boxSize(tris: ArrayLike<number>): number {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], tris[i]);
    hi[i % 3] = Math.max(hi[i % 3], tris[i]);
  }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
}

/** The average of a face's corners (x y z triples): inside it when it is convex. */
function centreOf(corners: number[]): number[] {
  const n = corners.length / 3;
  const c = [0, 0, 0];
  for (let i = 0; i < corners.length; i++) c[i % 3] += corners[i] / n;
  return c;
}

/** Whether `p` lies on one of the triangles, within `eps`. */
function onTriangles(p: number[], tris: ArrayLike<number>, eps: number): boolean {
  for (let i = 0; i + 8 < tris.length; i += 9) {
    const a = [tris[i], tris[i + 1], tris[i + 2]];
    const b = [tris[i + 3], tris[i + 4], tris[i + 5]];
    const c = [tris[i + 6], tris[i + 7], tris[i + 8]];
    const n = cross3(sub3(b, a), sub3(c, a));
    const len = Math.hypot(n[0], n[1], n[2]);
    if (!(len > 0) || Math.abs(dot3(sub3(p, a), n)) > eps * len) continue;
    const inside = [
      [a, b],
      [b, c],
      [c, a],
    ].every(([s, e]) => dot3(cross3(sub3(e, s), sub3(p, s)), n) >= -eps * len * Math.hypot(...sub3(e, s)));
    if (inside) return true;
  }
  return false;
}

/** Whether (x, y) is inside the flat ring of [x, y] points, or within `tol` of its edge. */
function insideRing(x: number, y: number, ring: number[][], tol: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const dx = xi - xj;
    const dy = yi - yj;
    const t = Math.max(0, Math.min(1, ((x - xj) * dx + (y - yj) * dy) / (dx * dx + dy * dy || 1)));
    if (Math.hypot(x - xj - t * dx, y - yj - t * dy) <= tol) return true;
    if (yi > y !== yj > y && x < xj + ((y - yj) * dx) / dy) inside = !inside;
  }
  return inside;
}

/**
 * Section Solids' cut by a flat 3D polygon: a box on the side its normal points to (the right-hand
 * rule round its points; the other side when `reverse`) reaching past every corner of `solid`
 * (triangles), as triangles facing out. A message when the polygon isn't flat, doesn't cover the
 * solid seen square to it (Vectorworks has the sectioning surface larger than the solid), or
 * leaves all of it or none.
 */
function halfSpaceBox(poly: number[][], reverse: boolean, solid: ArrayLike<number>): Float64Array | string {
  const nrm = [0, 0, 0];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length];
    nrm[0] += (a[1] - b[1]) * (a[2] + b[2]);
    nrm[1] += (a[2] - b[2]) * (a[0] + b[0]);
    nrm[2] += (a[0] - b[0]) * (a[1] + b[1]);
  });
  if (!(Math.hypot(nrm[0], nrm[1], nrm[2]) > 0)) return "the 3D polygon has no area";
  const n = unit3(reverse ? nrm.map((x) => -x) : nrm);
  const u = unit3(cross3(Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], n));
  const v = cross3(n, u);
  const o = poly[0];
  const size = Math.max(1, boxSize(poly.flat()), boxSize(solid));
  const tol = 1e-6 * size;
  if (poly.some((p) => Math.abs(dot3(sub3(p, o), n)) > tol)) return "the 3D polygon isn't flat";
  const ring = poly.map((p) => [dot3(sub3(p, o), u), dot3(sub3(p, o), v)]);
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < solid.length; i += 3) {
    const q = sub3([solid[i], solid[i + 1], solid[i + 2]], o);
    const at = [dot3(q, u), dot3(q, v), dot3(q, n)];
    if (!insideRing(at[0], at[1], ring, tol)) return "the 3D polygon must be larger than the solid, covering all of it seen square to the polygon";
    at.forEach((x, k) => ((lo[k] = Math.min(lo[k], x)), (hi[k] = Math.max(hi[k], x))));
  }
  if (hi[2] <= tol) return "none of the solid is on the side the 3D polygon cuts away (try Reverse Direction)";
  if (lo[2] >= -tol) return "all of the solid is on the side the 3D polygon cuts away (try Reverse Direction)";
  const m = 0.1 * size;
  const span = [
    [lo[0] - m, hi[0] + m],
    [lo[1] - m, hi[1] + m],
    [0, hi[2] + m],
  ];
  const corner = (i: number, j: number, k: number): number[] => [0, 1, 2].map((c) => o[c] + span[0][i] * u[c] + span[1][j] * v[c] + span[2][k] * n[c]);
  // each side's corners anticlockwise seen from outside
  const sides = [
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  ];
  return Float64Array.from(sides.flatMap((q) => [q[0], q[1], q[2], q[0], q[2], q[3]].flatMap(([i, j, k]) => corner(i, j, k))));
}

/** One run of a path: its direction, and the right and up a profile or coil square to it is set out by. */
interface PathFrames {
  /** how many runs: the points', less one unless the path closes */
  segs: number;
  dirs: number[][];
  frames: { right: number[]; up: number[] }[];
  /** how far along the path each point lies */
  lengths: number[];
  total: number;
}

/**
 * Each run of `path`, looking along it: its right, level (square to the run and the z axis; the
 * run before's when it is upright), and its up. With `lockPlane` every run is set out so; otherwise
 * the first is, and each after it is carried round the bend from the one before, so it may twist.
 */
function pathFrames(path: number[][], closed: boolean, lockPlane: boolean): PathFrames {
  const m = path.length;
  const segs = closed ? m : m - 1;
  const dirs = Array.from({ length: segs }, (_, j) => unit3(sub3(path[(j + 1) % m], path[j])));
  const frames: { right: number[]; up: number[] }[] = [];
  for (let j = 0; j < segs; j++) {
    const t = dirs[j];
    if (lockPlane || j === 0) {
      const flat = cross3(t, [0, 0, 1]);
      const right = Math.hypot(...flat) > 1e-9 ? unit3(flat) : (frames[j - 1]?.right ?? [1, 0, 0]);
      frames.push({ right, up: cross3(right, t) });
      continue;
    }
    // carried round the bend from the segment before
    const prev = frames[j - 1];
    const axis = cross3(dirs[j - 1], t);
    const s = Math.hypot(...axis);
    const c = dot3(dirs[j - 1], t);
    frames.push(s > 1e-12 ? { right: turn3(prev.right, unit3(axis), c, s), up: turn3(prev.up, unit3(axis), c, s) } : prev);
  }
  const lengths = [0];
  for (let i = 1; i < m; i++) lengths.push(lengths[i - 1] + Math.hypot(...sub3(path[i], path[i - 1])));
  const total = lengths[m - 1] + (closed ? Math.hypot(...sub3(path[0], path[m - 1])) : 0);
  return { segs, dirs, frames, lengths, total };
}

/** The normal of the plane that mitres point `i` of a path with runs `dirs`: square to it at an open path's ends. */
function mitreOf(dirs: number[][], closed: boolean, i: number): number[] {
  const segs = dirs.length;
  const inn = closed ? (i + segs - 1) % segs : Math.max(0, i - 1);
  const out = closed ? i % segs : Math.min(segs - 1, i);
  return unit3([dirs[inn][0] + dirs[out][0], dirs[inn][1] + dirs[out][1], dirs[inn][2] + dirs[out][2]]);
}

/** most points a helix-spiral is drawn with */
const MAX_HELIX_POINTS = 20000;
/** points a helix-spiral is drawn with for each turn */
const HELIX_STEPS = 48;

/**
 * The points of a coil round `path`: `turns` turns from `startAngle` (degrees from the right toward
 * up, looking along the path at its start), its radius `r0` at the start and `r1` at the end
 * (linearly along the path), turning clockwise seen looking along the path, or anticlockwise when
 * `reverse`. Each run's circles are square to it, and its stretch of the coil runs between the
 * planes that mitre its ends, so the coil meets itself at each corner. A message when the path turns
 * back too sharply or the coil needs too many points.
 */
function helixPoints(path: number[][], closed: boolean, turns: number, r0: number, r1: number, startAngle: number, reverse: boolean): number[][] | string {
  const m = path.length;
  const { segs, dirs, frames, lengths, total } = pathFrames(path, closed, true);
  const runs = Array.from({ length: segs }, (_, j) => Math.hypot(...sub3(path[(j + 1) % m], path[j])));
  const steps = Math.ceil(turns * HELIX_STEPS);
  const counts = runs.map((len) => Math.max(1, Math.ceil((steps * len) / total)));
  if (counts.reduce((a, b) => a + b, 1) > MAX_HELIX_POINTS) return `that needs more than ${MAX_HELIX_POINTS.toLocaleString("en")} points; try fewer turns`;
  const sign = reverse ? 1 : -1;
  const a0 = (startAngle * Math.PI) / 180;
  const out: number[][] = [];
  for (let j = 0; j < segs; j++) {
    const d = dirs[j];
    const { right, up } = frames[j];
    const [start, end] = [j, (j + 1) % m].map((i) => mitreOf(dirs, closed, i));
    if (!(dot3(d, start) > 0.05 && dot3(d, end) > 0.05)) return "the path turns back on itself too sharply to coil round";
    for (let q = j === 0 ? 0 : 1; q <= counts[j]; q++) {
      const s = lengths[j] + (runs[j] * q) / counts[j];
      const a = a0 + (sign * 2 * Math.PI * turns * s) / total;
      const r = r0 + ((r1 - r0) * s) / total;
      const w = [0, 1, 2].map((k) => r * (Math.cos(a) * right[k] + Math.sin(a) * up[k]));
      // how far along the run this side of the coil starts and ends: at its ends' mitre planes
      const from = -dot3(w, start) / dot3(d, start);
      const to = runs[j] - dot3(w, end) / dot3(d, end);
      const along = from + ((to - from) * q) / counts[j];
      out.push([0, 1, 2].map((k) => path[j][k] + d[k] * along + w[k]));
    }
  }
  return out;
}

/**
 * The faces of `ring` (a counter-clockwise profile, flat xy) swept along `path`: centred on the
 * path, seen looking along it from its start with the profile's x to the right and its y up, cut
 * square at an open path's ends and mitred at each corner, `scale` times as large at the end as
 * at the start (linearly along its length). With `lockPlane` its y stays in the upright plane
 * through the path; otherwise it is carried round each bend, so it may twist. A message when the
 * path folds back on itself.
 */
function sweepFaces(ring: number[], path: number[][], closed: boolean, scale: number, lockPlane: boolean): number[][] | string {
  const m = path.length;
  const { segs, dirs, frames, lengths, total } = pathFrames(path, closed, lockPlane);
  const n = ring.length / 2;
  // the profile's centre: the middle of its box
  const xs = ring.filter((_, i) => i % 2 === 0);
  const ys = ring.filter((_, i) => i % 2 === 1);
  const [cx, cy] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  // vertex i's ring, cut by its mitre plane (square to an open path's ends), in segment j's frame
  const ringAt = (i: number, j: number): number[][] | null => {
    const plane = mitreOf(dirs, closed, i);
    const { right, up } = frames[j];
    const lean = dot3(dirs[j], plane);
    if (!(lean > 0.05)) return null;
    const f = 1 + (scale - 1) * (lengths[i] / total);
    return Array.from({ length: n }, (_, k) => {
      const [u, v] = [(ring[2 * k] - cx) * f, (ring[2 * k + 1] - cy) * f];
      const w = [0, 1, 2].map((q) => u * right[q] + v * up[q]);
      const t = -dot3(w, plane) / lean;
      return [0, 1, 2].map((q) => path[i][q] + w[q] + t * dirs[j][q]);
    });
  };
  const faces: number[][] = [];
  const starts: number[][][] = [];
  const ends: number[][][] = [];
  for (let j = 0; j < segs; j++) {
    const [a, b] = [ringAt(j, j), ringAt((j + 1) % m, j)];
    if (!a || !b) return "the path turns back on itself too sharply to sweep along";
    starts.push(a);
    ends.push(b);
    // each segment keeps its frame along it, so its sides are flat
    for (let k = 0; k < n; k++) faces.push([a[k], b[k], b[(k + 1) % n], a[(k + 1) % n]].flat());
  }
  // where the frames either side of a corner differ (the profile kept upright on a slope, or carried
  // round a closed path back to its start), a band in the mitre plane joins the two rings
  for (let j = closed ? 0 : 1; j < segs; j++) {
    const [a, b] = [ends[(j + segs - 1) % segs], starts[j]];
    if (a.every((p, k) => Math.hypot(...sub3(p, b[k])) <= 1e-6)) continue;
    // in triangles: the rings turned against each other can make a quad cross itself
    for (let k = 0; k < n; k++) faces.push([a[k], b[k], b[(k + 1) % n]].flat(), [a[k], b[(k + 1) % n], a[(k + 1) % n]].flat());
  }
  // an open path's ends: the profile's own winding faces back along the path
  if (!closed) faces.push(starts[0].flat(), [...ends[segs - 1]].reverse().flat());
  // wound to face outward: a negative volume turns every face round
  let volume = 0;
  for (const f of faces) {
    for (let i = 3; i + 5 < f.length; i += 3) {
      const [a, b, c] = [f.slice(0, 3), f.slice(i, i + 3), f.slice(i + 3, i + 6)];
      volume += dot3(a, cross3(b, c));
    }
  }
  if (volume < 0) {
    return faces.map((f) => {
      const out: number[] = [];
      for (let i = f.length - 3; i >= 0; i -= 3) out.push(f[i], f[i + 1], f[i + 2]);
      return out;
    });
  }
  return faces;
}

function meshPieces(face: number[]): number[][] {
  const n = face.length / 3;
  if (n < 3) return [];
  const at = (i: number): number[] => face.slice(3 * (i % n), 3 * (i % n) + 3);
  // the face's normal (Newell's method)
  const nrm = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const [a, b] = [at(i), at(i + 1)];
    nrm[0] += (a[1] - b[1]) * (a[2] + b[2]);
    nrm[1] += (a[2] - b[2]) * (a[0] + b[0]);
    nrm[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  if (!(Math.hypot(...nrm) > 0)) return [];
  const turn = (a: number[], b: number[], c: number[]): number => {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
    const t = (u[1] * v[2] - u[2] * v[1]) * nrm[0] + (u[2] * v[0] - u[0] * v[2]) * nrm[1] + (u[0] * v[1] - u[1] * v[0]) * nrm[2];
    return t / (Math.hypot(...nrm) * Math.max(Math.hypot(...u) * Math.hypot(...v), 1e-300));
  };
  let convex = true;
  for (let i = 0; i < n && convex; i++) convex = turn(at(i), at(i + 1), at(i + 2)) >= -1e-9;
  if (convex) {
    const out: number[][] = [];
    for (let s = 1; s < n - 1; ) {
      const e = Math.min(s + MAX_FACE_CORNERS - 2, n - 1);
      const piece = [...at(0)];
      for (let i = s; i <= e; i++) piece.push(...at(i));
      out.push(piece);
      s = e;
    }
    return out;
  }
  // flattened along the normal's largest part
  const drop = nrm.map(Math.abs).indexOf(Math.max(...nrm.map(Math.abs)));
  const flat: number[] = [];
  for (let i = 0; i < n; i++) flat.push(...at(i).filter((_, k) => k !== drop));
  const tris = earcut(flat);
  const out: number[][] = [];
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const [a, b, c] = [at(tris[t]), at(tris[t + 1]), at(tris[t + 2])];
    out.push(turn(a, b, c) >= 0 ? [...a, ...b, ...c] : [...a, ...c, ...b]);
  }
  return out;
}

/** A texture's records as importTexture takes them, checked. */
interface TextureRecs {
  recs: Template;
  /** each record's record format by name (a shader's settings), else undefined */
  formatOf: (string | undefined)[];
  /** those record formats, each with the kind of list it sits in */
  formats: { name: string; list: string; recs: Template }[];
}

/** The kind of list a record format sits in: the list's type, with its tag for a type-76 list. */
function formatList(r: Rec): string {
  const p = r.parent;
  if (!p) return "";
  return p.type === 76 && p.data.length >= 0x54 ? `76 ${String.fromCharCode(...p.data.subarray(0x50, 0x54))}` : String(p.type);
}

/**
 * A record format's kind and fields (the type and place of each), to compare two by. Field names are
 * left out: records hold values by place, and one file's shader formats can carry another
 * language's names for the same fields.
 */
function formatSignature(d: Uint8Array): string {
  const f = readFormat(d);
  return JSON.stringify([f.parametric, f.fields.map((x) => [x.type, x.off])]);
}

/** Records in pre-order (bytes and parent position) as a template, the first of type `root`. */
function readTree(list: TextureData["records"], root: number): Template {
  const damaged = (): Error => new Error("texture data is damaged");
  if (!list.length) throw damaged();
  const t: Template = { recs: [], parent: [] };
  const stack: number[] = [];
  for (const [i, { data: d, parent }] of list.entries()) {
    if (!(d instanceof Uint8Array) || d.length < 0x50 || u64(d, 0) !== BigInt(d.length) || (i === 0) !== (parent === -1)) throw damaged();
    while (stack.length && stack[stack.length - 1] !== parent) stack.pop();
    if (i > 0 && !stack.length) throw damaged();
    stack.push(i);
    t.recs.push(d);
    t.parent.push(parent);
  }
  if (t.recs[0][0x19] !== root) throw damaged();
  return t;
}

function readTexture(data: TextureData): TextureRecs {
  const recs = readTree(data.records, TEXTURE);
  const formats = data.formats.map((f) => ({ name: f.name, list: f.list, recs: readTree(f.records, RECORD_FORMAT) }));
  const formatOf = data.records.map((r) => r.format);
  for (const [i, f] of formatOf.entries()) {
    if (f !== undefined && (recs.recs[i][0x19] !== RECORD || !formats.some((x) => x.name === f))) throw new Error("texture data is damaged");
  }
  return { recs, formatOf, formats };
}

/** The copied records that can hold a part left in a file (held.ts): bodies and pictures, by their type, read from the start of each. */
function mayHold(data: ClipboardData): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const r of data.records) {
    const type = fromBase64(r.data.slice(0, 36))[0x19];
    if (type === 114 || type === 14) out.push(fromBase64(r.data));
  }
  return out;
}

/** Whether a copy holds parts left in a file (held.ts), which other windows can't read. */
export function clipboardHolds(data: ClipboardData): boolean {
  return anyHeld(mayHold(data));
}

/** A copy with the held parts in it put back (held.ts), for a copy that leaves this window. */
export async function expandClipboard(data: ClipboardData): Promise<ClipboardData> {
  const records = data.records.map((r) => fromBase64(r.data));
  if (!anyHeld(records)) return data;
  const full = await expandRecords(records);
  return { ...data, records: data.records.map((r, i) => (full[i] === records[i] ? r : { ...r, data: toBase64(full[i]) })) };
}

function toBase64(d: Uint8Array): string {
  let s = "";
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode(...d.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(s: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(s);
  } catch {
    throw new Error("clipboard data is damaged");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function unionBox(a: BBox | null, b: BBox | null): BBox | null {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

/**
 * Write a group's cached bounds: +0x68 (top, left, bottom, right), ±DBL_MAX
 * when empty, and the 3D box at +0x9c (x1, y1, z, x0, y0, z) when the group
 * keeps one.
 */
function writeGroupBox(d: Uint8Array, box: BBox | null): void {
  const want = box ? [box.y1, box.x0, box.y0, box.x1] : [-Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE];
  want.forEach((v, i) => setF64(d, 0x68 + 8 * i, v));
  if (box && Math.abs(f64(d, 0x9c)) < 1e300) {
    setF64(d, 0x9c, box.x1);
    setF64(d, 0xa4, box.y1);
    setF64(d, 0xb4, box.x0);
    setF64(d, 0xbc, box.y0);
  }
}


/** A camera's eye and look-to parameters (`get` reads them) through m in plan and raised by dz. */
function cameraPointsThrough(get: (name: string) => number | null, m: Affine, dz: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const point of ["__Point3DCamera", "__Point3DLookTo"]) {
    const x = get(point + "X");
    const y = get(point + "Y");
    const z = get(point + "Z");
    if (x !== null && y !== null) {
      const q = applyAffine(m, { x, y });
      out[point + "X"] = q.x;
      out[point + "Y"] = q.y;
    }
    if (z !== null && dz !== 0) out[point + "Z"] = z + dz;
  }
  return out;
}

function recOfData(d: Uint8Array): Rec {
  return new Rec(d);
}

function typeLabel(type: number): string {
  const names: Record<number, string> = {
    2: "line",
    3: "rectangle",
    5: "polygon",
    6: "arc",
    10: "text",
    11: "group",
    13: "rounded rectangle",
    14: "image",
    15: "symbol",
    9: "3D locus",
    17: "locus",
    21: "polyline",
    24: "extrude",
    25: "3D polygon",
    34: "sweep",
    38: "multiple extrude",
    40: "mesh",
    63: "dimension",
    68: "wall",
    71: "slab",
    81: "light",
    84: "solid",
    86: "plug-in",
    113: "generic solid",
    114: "3D body",
    122: "viewport",
    18: "worksheet",
  };
  return names[type] ?? `type-${type}`;
}

/** `dir` in the drawing's frame as a plug-in object's own (its matrix's turn undone); throws when it has none or `dir` is 0. */
function ownDirection(d: Uint8Array, dir: Vec3): Vec3 {
  if (!(dir.length === 3 && dir.every(Number.isFinite) && Math.hypot(...dir) > 0)) throw new Error("a light's direction is three numbers, not all 0");
  if (d.length < PLUGIN_MATRIX + 72) return [dir[0], dir[1], dir[2]];
  // the rows are where the object's own x, y and z go: world = x row0 + y row1 + z row2
  const m = Array.from({ length: 9 }, (_, i) => f64(d, PLUGIN_MATRIX + 8 * i));
  const [a, b, c, e, f, g, h, i, j] = m;
  const det = a * (f * j - g * i) - b * (e * j - g * h) + c * (e * i - f * h);
  if (!(Math.abs(det) > 1e-12)) throw new Error("this object's placement can't be turned back");
  // the inverse of the matrix with those rows as its columns
  const inv = [(f * j - g * i) / det, (c * i - b * j) / det, (b * g - c * f) / det, (g * h - e * j) / det, (a * j - c * h) / det, (c * e - a * g) / det, (e * i - f * h) / det, (b * h - a * i) / det, (a * f - b * e) / det];
  // that matrix maps own (x, y, z) to world through columns, so its inverse maps world back
  return [
    inv[0] * dir[0] + inv[3] * dir[1] + inv[6] * dir[2],
    inv[1] * dir[0] + inv[4] * dir[1] + inv[7] * dir[2],
    inv[2] * dir[0] + inv[5] * dir[1] + inv[8] * dir[2],
  ];
}

/** A visibility's code as stored, or an error naming the ones there are. */
function visibilityCode(v: Visibility): number {
  const code = (VIS_CODE as Record<string, number | undefined>)[v];
  if (code === undefined) throw new Error(`no visibility "${String(v)}": it is "visible", "hidden" or "grayed"`);
  return code;
}
