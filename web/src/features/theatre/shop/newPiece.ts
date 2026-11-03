// Stage > Scene Shop > New Flat… and New Platform…: the size, stock and skin in a dialog, then one click places the
// shop drawing: the front and back views (a platform's front and side) with a plan mark when asked, and the cut
// notes under them, all as one named group. The piece is kept in the drawing in that same undo step, so a click
// cancelled with Esc keeps nothing.

import { attempt, setEditGroup } from "../../../app/commands.ts";
import type { Part } from "../../../app/tools/detailing.ts";
import { markerParts } from "../../../app/tools/markers.ts";
import type { MarkerDrawing, MarkerText } from "../../../app/markerShapes.ts";
import { placeAtNextClick } from "../../../app/placeAt.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import type { EditSession, Pt } from "../../../core/index.ts";
import type { ShopPiece } from "../showTypes.ts";
import { lengthText } from "../stageTool.ts";
import { elevation, flatParts, isFlat, moved, noteLines, planMark, platformParts, platformWarnings, STOCK, type FlatSpec, type PlatformSpec, type ShopPart, type ShopSpec } from "./flats.ts";
import { addPieceIn, newPieceId } from "./pieces.ts";

/** A paper label's height, mm, and the gap between a piece's views, on paper. */
const LABEL_PAPER_MM = 3.5;
const GAP_PAPER_MM = 25;

const FLAT_STOCK = [
  { value: "1x3", label: "1x3 (19 x 64 mm)" },
  { value: "1x4", label: "1x4 (19 x 89 mm)" },
  { value: "2x4", label: "2x4 (38 x 89 mm)" },
];
const FRAME_STOCK = [
  { value: "1x4", label: "1x4 (19 x 89 mm)" },
  { value: "2x4", label: "2x4 (38 x 89 mm)" },
];
const LEG_STOCK = [
  { value: "2x4", label: "2x4 (38 x 89 mm)" },
  { value: "4x4", label: "4x4 (89 x 89 mm)" },
];

/** Asks for a flat, then places it. */
export async function newFlat(): Promise<void> {
  const v = await toolPrefs(
    "New Flat",
    [
      { kind: "text", key: "name", label: "Name", value: "Flat" },
      { kind: "length", key: "width", label: "Width", value: 1219 },
      { kind: "length", key: "height", label: "Height", value: 2438 },
      {
        kind: "choice",
        key: "style",
        label: "Style",
        value: "hollywood",
        options: [
          { value: "hollywood", label: "Hollywood (stock on edge)" },
          { value: "broadway", label: "Broadway (stock flat)" },
        ],
      },
      { kind: "choice", key: "stock", label: "Stock", value: "1x3", options: FLAT_STOCK },
      {
        kind: "choice",
        key: "skin",
        label: "Skin",
        value: "lauan",
        options: [
          { value: "lauan", label: "Lauan" },
          { value: "none", label: "None" },
        ],
      },
      { kind: "length", key: "skinThick", label: "Skin Thickness", value: 5 },
      { kind: "length", key: "toggle", label: "Toggles At Most Apart", value: 1219 },
      { kind: "number", key: "count", label: "Number Built", value: 1, min: 1, max: 999, integer: true },
      { kind: "check", key: "plan", label: "Plan Mark", value: true },
    ],
    "A Hollywood flat has its stock on edge with the skin on its face; a Broadway flat has its stock flat, face out. Click where the flat goes: its front and back views and cut notes are drawn there, as one group.",
  );
  if (!v) return;
  const spec: FlatSpec = {
    name: v.choice("name") || "Flat",
    widthMm: v.num("width"),
    heightMm: v.num("height"),
    style: v.choice("style") === "broadway" ? "broadway" : "hollywood",
    stock: STOCK[v.choice("stock")] ?? STOCK["1x3"],
    skin: v.choice("skin") === "none" ? "none" : "lauan",
    skinThickMm: v.num("skinThick"),
    toggleMaxMm: v.num("toggle"),
  };
  const piece: ShopPiece = { id: newPieceId(), kind: "flat", name: spec.name, widthMm: spec.widthMm, heightMm: spec.heightMm, standMm: 0, count: v.num("count") };
  arm("New flat", spec, piece, v.flag("plan"));
}

/** Asks for a platform, then places it. */
export async function newPlatform(): Promise<void> {
  const v = await toolPrefs(
    "New Platform",
    [
      { kind: "text", key: "name", label: "Name", value: "Platform" },
      { kind: "length", key: "width", label: "Width", value: 2438 },
      { kind: "length", key: "depth", label: "Depth", value: 1219 },
      { kind: "length", key: "stand", label: "Height of Top", value: 600 },
      { kind: "choice", key: "frame", label: "Frame Stock", value: "2x4", options: FRAME_STOCK },
      { kind: "choice", key: "legs", label: "Leg Stock", value: "4x4", options: LEG_STOCK },
      { kind: "length", key: "joist", label: "Joists At Most Apart", value: 406 },
      { kind: "length", key: "lid", label: "Lid Thickness", value: 19 },
      {
        kind: "choice",
        key: "legsPer",
        label: "Legs",
        value: "corners",
        options: [
          { value: "corners", label: "At the corners and spans" },
          { value: "grid", label: "On a grid under the joists" },
        ],
      },
      { kind: "number", key: "count", label: "Number Built", value: 1, min: 1, max: 999, integer: true },
      { kind: "check", key: "plan", label: "Plan Mark", value: true },
    ],
    "A platform is a frame of long and end rails with joists, a lid, legs and braces over 600 mm. Click where it goes: its front and side views and cut notes are drawn there, as one group.",
  );
  if (!v) return;
  const spec: PlatformSpec = {
    name: v.choice("name") || "Platform",
    widthMm: v.num("width"),
    depthMm: v.num("depth"),
    standMm: v.num("stand"),
    joistMaxMm: v.num("joist"),
    lidThickMm: v.num("lid"),
    frameStock: STOCK[v.choice("frame")] ?? STOCK["2x4"],
    legStock: STOCK[v.choice("legs")] ?? STOCK["4x4"],
    legsPer: v.choice("legsPer") === "grid" ? "grid" : "corners",
  };
  const piece: ShopPiece = { id: newPieceId(), kind: "platform", name: spec.name, widthMm: spec.widthMm, heightMm: spec.depthMm, standMm: spec.standMm, count: v.num("count") };
  arm("New platform", spec, piece, v.flag("plan"));
}

/** Takes the next click for the drawing of `spec`. */
function arm(what: string, spec: ShopSpec, piece: ShopPiece, plan: boolean): void {
  const placed = placeAtNextClick({ what, place: (at) => placeShop(spec, piece, at, plan) });
  if (!placed) toast("Open a drawing before placing a shop piece.", "info");
}

/** Adds the parts as one group on `layerId`, in the active class and the drawing's attributes, named `name`; its id. */
function addGroup(s: EditSession, layerId: string, parts: readonly Part[], name: string): string {
  const ids = parts.map((part) => {
    const shape = "shape" in part ? part.shape : part;
    const own = "shape" in part ? part : null;
    const attrs = { ...store.drawAttrs, ...own?.attrs };
    return s.addObject(layerId, shape, own?.classIndex ?? store.activeClassIndex, Object.keys(attrs).length === 0 ? undefined : attrs);
  });
  const group = s.groupObjects(ids);
  s.setObjectName(group, name);
  return group;
}

/** The notes under the views: the piece's name, then each part as a line. */
function notesOf(spec: ShopSpec, parts: readonly ShopPart[], at: Pt, labelMm: number): MarkerDrawing {
  const width = lengthText(spec.widthMm);
  const height = lengthText(isFlat(spec) ? spec.heightMm : spec.depthMm);
  const lines = [`${spec.name}: ${width} x ${height}`, ...noteLines(parts, lengthText)];
  const texts: MarkerText[] = lines.map((text, i) => ({ at: { x: at.x, y: at.y - labelMm * 3.2 - i * labelMm * 1.6 }, text, height: labelMm, justify: "left" }));
  return { outlines: [], lines: [], circles: [], filled: [], texts };
}

/** Draws the piece at `at` (its front view's bottom left corner) and keeps it, as one undo step. */
function placeShop(spec: ShopSpec, piece: ShopPiece, at: Pt, plan: boolean): void {
  const layerId = store.activeLayerId;
  const s = store.session;
  if (!s || !layerId) {
    toast("Make a design layer active to place a shop piece.", "info");
    return;
  }
  const scale = s.doc.layers().find((l) => l.id === layerId)?.scale || 1;
  const labelMm = LABEL_PAPER_MM * scale;
  const gap = GAP_PAPER_MM * scale;
  const W = spec.widthMm;
  const views = elevation(spec, labelMm, lengthText);
  const parts = isFlat(spec) ? flatParts(spec) : platformParts(spec);
  const drawings: MarkerDrawing[] = [moved(views.front, at.x, at.y), moved(views.back, at.x + W + gap, at.y)];
  if (plan) drawings.push(moved(planMark(spec, labelMm), at.x + 2 * W + 2 * gap, at.y));
  drawings.push(notesOf(spec, parts, at, labelMm));
  const shapes = drawings.flatMap((d) => markerParts(d));
  const r = attempt(isFlat(spec) ? "New Flat" : "New Platform", (ed) =>
    ed.batch(() => {
      const group = addGroup(ed, layerId, shapes, spec.name);
      addPieceIn(ed, piece, spec);
      return group;
    }),
  );
  if (!r) return;
  setEditGroup(null, [r.value]);
  const warnings = isFlat(spec) ? [] : platformWarnings(spec);
  toast(warnings.length ? `${spec.name} placed. ${warnings.join(" ")}` : `${spec.name} placed. Stage > Scene Shop > Cut List lists its parts.`, "info");
}
