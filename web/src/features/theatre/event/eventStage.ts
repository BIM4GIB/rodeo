// Event Design's Create Stage and Create Stair (Spotlight > Event in Vectorworks; Stage > Event here).
// Create Stage lays the selected closed shape with standard stage decks, the edge's pieces as
// smaller decks or stage plugs (stageLayout.ts), each drawn as the Stage Deck and Stage Plug tools
// draw them with its 3D (a block, or a top on legs) up to the Stage Height, grouped together as a
// hybrid shows. Create Stair asks a width and style, then takes a click where the steps meet the
// stage and a click the way they come down; they fit the stage's top found under them (one built
// in 3D) with risers up to MAX_RISER, else the height given. Vectorworks makes stage deck, plug and
// steps objects; these are plain groups, in a class chosen (that sets their look) or in None with
// the fill, pen and texture set here.

import type { Attributes, EditSession, Pt } from "../../../core/index.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { placed } from "../../../app/detailShapes.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { placeAtNextClick } from "../../../app/placeAt.ts";
import type { Solid } from "../../../app/solids3d.ts";
import { stageDeck, stagePlug, stageSteps, type Legs, type StagePlan, type StageStructure, type StepStructure } from "../../../app/stageShapes.ts";
import { store } from "../../../app/state.ts";
import { closedOutline, hasClosedSelection } from "../../../app/surfaces.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs, type PrefField, type PrefValues } from "../../../app/toolPrefs.ts";
import { placedDrawing } from "../../../app/tools/circulation.ts";
import { addPart, type Part } from "../../../app/tools/detailing.ts";
import { markerParts } from "../../../app/tools/markers.ts";
import { formatLength, millimetresPerUnit } from "../../../app/units.ts";
import { stageTop } from "./lectern.ts";
import { minimizeLegs, pieceSolid, stageLayout, stepsFor, stepsSolid, type StagePiece } from "./stageLayout.ts";

/** setObjectTexture's part for all of an object */
const WHOLE_OBJECT = 3;
/** the UP by steps' arrow, on paper, mm */
const TEXT_MM = 2.5;

const STRUCTURES: readonly { readonly value: StageStructure; readonly label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "border", label: "Border" },
  { value: "deckOnly", label: "Deck Only" },
  { value: "legsBasic", label: "Legs-Basic" },
];
const PROFILES = [
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "octagon", label: "Octagonal" },
] as const;
const STYLES: readonly { readonly value: StepStructure; readonly label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "selfAdjusting", label: "Self-Adjusting" },
  { value: "frame", label: "Frame Free-Standing" },
  { value: "solid", label: "Solid Free-Standing" },
  { value: "open", label: "Open Free-Standing" },
];

/** How the stage or steps look: a class that sets it, or None with the colours and texture given. */
export interface Look {
  readonly classIndex: number;
  readonly fill: string;
  readonly pen: string;
  /** a texture resource's index, or -1 for none */
  readonly texture: number;
}

interface StageSettings extends Look {
  readonly height: number;
  readonly width: number;
  readonly depth: number;
  readonly structure: StageStructure;
  readonly top: number;
  readonly diameter: number;
  readonly profile: Legs["profile"];
  readonly spacing: number;
  readonly minimize: boolean;
  readonly deleteShape: boolean;
}

interface StairSettings extends Look {
  readonly width: number;
  readonly style: StepStructure;
  readonly height: number;
}

export const imperial = (): boolean => {
  const perUnit = millimetresPerUnit(store.session?.doc.info.units);
  return perUnit === 25.4 || perUnit === 304.8;
};

let lastStage: StageSettings | null = null;
let lastStair: StairSettings | null = null;

/** 8' × 4' decks 2' high in inches and feet, else 2 m × 1 m decks 600 high. */
function firstStage(): StageSettings {
  const ft = imperial();
  return {
    height: ft ? 609.6 : 600,
    width: ft ? 2438.4 : 2000,
    depth: ft ? 1219.2 : 1000,
    structure: "simple",
    top: ft ? 19.05 : 20,
    diameter: ft ? 50.8 : 50,
    profile: "round",
    spacing: ft ? 1219.2 : 1000,
    minimize: true,
    deleteShape: false,
    classIndex: store.activeClassIndex,
    fill: "#bfbfbf",
    pen: "#000000",
    texture: -1,
  };
}

/** The look's fields, their keys after `prefix`. */
export function lookFields(look: Look, prefix = ""): PrefField[] {
  const doc = store.session?.doc;
  const classes = (doc?.classes() ?? []).map((c) => ({ value: String(c.index), label: c.name }));
  const textures = (doc?.resources() ?? []).filter((r) => r.kind === "texture").sort((a, b) => a.name.localeCompare(b.name));
  return [
    { kind: "choice", key: `${prefix}class`, label: "Class", value: String(look.classIndex), options: classes, wide: true },
    { kind: "color", key: `${prefix}fill`, label: "Fill Color (None class)", value: look.fill },
    { kind: "color", key: `${prefix}pen`, label: "Pen Color (None class)", value: look.pen },
    { kind: "choice", key: `${prefix}texture`, label: "Texture (None class)", value: String(look.texture), options: [{ value: "-1", label: "None" }, ...textures.map((t) => ({ value: String(t.index), label: t.name }))], wide: true },
  ];
}

export const lookFrom = (v: PrefValues, prefix = ""): Look => ({ classIndex: Number(v.choice(`${prefix}class`)), fill: v.choice(`${prefix}fill`), pen: v.choice(`${prefix}pen`), texture: Number(v.choice(`${prefix}texture`)) });

const rgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** The class sets the look unless it's None. */
export const byClass = (look: Look): boolean => store.session?.doc.classes().find((c) => c.index === look.classIndex)?.name !== "None";

/** The fill and pen a part in None takes. */
export function lookAttrs(look: Look): Partial<Attributes> {
  const match = colorMatcher();
  const fill = match(rgb(look.fill));
  return { penFore: match(rgb(look.pen)), fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: 100 };
}

/** A plan placed where it stands. */
function placePlan(plan: StagePlan, at: Pt, angle: number): StagePlan {
  return { ...placedDrawing(plan, at, angle), hidden: plan.hidden.map((pts) => placed(pts, at, angle)), loci: placed(plan.loci, at, angle), count: plan.count };
}

/**
 * A placed plan's parts in the look: what shows, what's under it dashed (left out in a drawing
 * without a dashed line type), and the loci of a deck-only structure's legs.
 */
function planParts(plan: StagePlan, look: Look): Part[] {
  const dashed = store.session?.doc.lineTypes().find((t) => t.dashes.length > 0);
  const own = byClass(look);
  const attrs = own ? undefined : lookAttrs(look);
  return [
    ...markerParts(plan).map((p): Part =>
      "shape" in p ? { ...p, classIndex: look.classIndex } : own ? { shape: p, classIndex: look.classIndex, byClass: true } : { shape: p, classIndex: look.classIndex, attrs: p.kind === "text" ? undefined : attrs },
    ),
    ...(dashed
      ? plan.hidden.map((pts): Part => ({
          shape: pts.length > 2 ? { kind: "polygon", points: pts, closed: true } : { kind: "polyline", points: pts, closed: false },
          classIndex: look.classIndex,
          attrs: { ...attrs, lineStyle: dashed.style, fillPattern: 0 },
        }))
      : []),
    ...plan.loci.map((at): Part => ({ shape: { kind: "locus", at }, classIndex: look.classIndex })),
  ];
}

/** Adds a piece's parts and its 3D as a group in the look; the group's id. */
export function addPiece(s: EditSession, layerId: string, parts: readonly Part[], solid: Solid, look: Look): string {
  const ids = parts.map((p) => addPart(s, layerId, p));
  const own = byClass(look);
  const [mesh] = s.addMeshes(layerId, [solid], look.classIndex, own ? store.drawAttrs : { ...store.drawAttrs, ...lookAttrs(look) });
  if (own) {
    for (const g of ["fill", "penColor", "lineStyle", "lineWeight", "opacity"] as const) s.setAttributesByClass([mesh], g, true);
    s.setObjectTexture(mesh, WHOLE_OBJECT, { texture: 0 });
  } else if (look.texture > 0) s.setObjectTexture(mesh, WHOLE_OBJECT, { texture: look.texture });
  const group = s.groupObjects([...ids, mesh]);
  s.setObjectClass([group], look.classIndex);
  return group;
}

/** The selected closed shapes on design layers, each to lay with a stage. */
export function selectedShapes(): { id: string; layerId: string; outline: Pt[] }[] {
  const doc = store.session?.doc;
  if (!doc) return [];
  const design = new Set(doc.layers().filter((l) => l.kind === "design").map((l) => l.id));
  return [...store.selection].flatMap((id) => {
    const o = doc.object(id);
    const outline = o?.shape && o.parentId === null && design.has(o.layerId) ? closedOutline(o.shape) : null;
    return o && outline ? [{ id, layerId: o.layerId, outline }] : [];
  });
}

export const canCreateStage = (): boolean => hasClosedSelection(1);

/** Stage > Event > Create Stage…: the dialog, then each selected closed shape laid with decks and plugs. */
export async function createStage(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const shapes = selectedShapes();
  if (!shapes.length) {
    toast("Create Stage: select a closed shape (a rectangle, polygon or closed polyline) the size of the stage.", "info");
    return;
  }
  const d = lastStage ?? firstStage();
  const v = await toolPrefs(
    "Create Stage",
    [
      { kind: "length", key: "height", label: "Stage Height", value: d.height },
      { kind: "length", key: "width", label: "Standard Stage Deck Width", value: d.width },
      { kind: "length", key: "depth", label: "Standard Stage Deck Depth", value: d.depth },
      { kind: "choice", key: "structure", label: "Structure", value: d.structure, options: STRUCTURES },
      { kind: "length", key: "top", label: "Top Thickness", value: d.top },
      { kind: "length", key: "diameter", label: "Leg Diameter", value: d.diameter },
      { kind: "choice", key: "profile", label: "Leg Profile", value: d.profile, options: PROFILES },
      { kind: "length", key: "spacing", label: "Leg Reference Spacing", value: d.spacing },
      { kind: "check", key: "minimize", label: "Minimize Leg Count", value: d.minimize },
      ...lookFields(d),
      { kind: "check", key: "deleteShape", label: "Delete the shape after", value: d.deleteShape },
    ],
    "Standard decks lie on a grid square to the shape's longest side, from a corner of it; where the edge cuts one, what's inside is a smaller deck when it's still a rectangle, else a stage plug. Simple and Border stages stand as blocks in 3D; Deck Only is the top alone (its legs marked by loci); Legs-Basic puts the top on legs, which Minimize Leg Count leaves out where a neighbouring piece's leg stands beside them. Legs out of sight under the top are drawn dashed.",
  );
  if (!v || store.session !== s) return;
  const set: StageSettings = {
    height: v.num("height"),
    width: v.num("width"),
    depth: v.num("depth"),
    structure: STRUCTURES.find((o) => o.value === v.choice("structure"))?.value ?? "simple",
    top: v.num("top"),
    diameter: v.num("diameter"),
    profile: PROFILES.find((o) => o.value === v.choice("profile"))?.value ?? "round",
    spacing: v.num("spacing"),
    minimize: v.flag("minimize"),
    deleteShape: v.flag("deleteShape"),
    ...lookFrom(v),
  };
  lastStage = set;
  const legs: Legs = { structure: set.structure, diameter: set.diameter, profile: set.profile, spacing: set.spacing, hideDeck: false };
  const plain: Legs = { ...legs, structure: "simple" };
  let legless = 0;
  const laid: { layerId: string; source: string; pieces: { plan: StagePlan; outline: Pt[] }[] }[] = [];
  for (const shape of shapes) {
    const pieces = stageLayout(shape.outline, set.width, set.depth);
    if (typeof pieces === "string") {
      toast(`Create Stage: ${pieces}`, "info");
      return;
    }
    const plan = (p: StagePiece, l: Legs): StagePlan | string =>
      p.kind === "deck" ? (() => {
        const deck = stageDeck({ ...l, shape: "rect", width: p.width, depth: p.depth, radius: 0, sweep: 180, rails: [] });
        return typeof deck === "string" ? deck : placePlan(deck, p.at, p.angle);
      })() : stagePlug(p.outline, l);
    let plans = pieces.map((p) => {
      const withLegs = plan(p, legs);
      if (typeof withLegs !== "string") return withLegs;
      // a piece too small for its legs (or too large for so many) goes in without them
      legless++;
      return plan(p, plain) as StagePlan;
    });
    if (set.minimize && (set.structure === "legsBasic" || set.structure === "deckOnly")) plans = minimizeLegs(plans, set.diameter);
    laid.push({ layerId: shape.layerId, source: shape.id, pieces: plans.map((p) => ({ plan: p, outline: p.outlines[0] })) });
  }
  const r = attempt("Create Stage", (session) =>
    session.batch(() => {
      const groups = laid.flatMap(({ layerId, pieces }) => pieces.map(({ plan, outline }) => addPiece(session, layerId, planParts(plan, set), pieceSolid(outline, plan, set.structure, set.height, set.top), set)));
      if (set.deleteShape) session.deleteObjects(laid.map((l) => l.source));
      return groups;
    }),
  );
  if (!r) return;
  setEditGroup(null, r.value);
  const n = r.value.length;
  toast(`Create Stage: ${n} ${n === 1 ? "piece" : "decks and plugs"}, ${formatLength(set.height, s.doc.info.units)} high.${legless ? ` ${legless} too small for legs went in without them.` : ""}`, "info");
}

/** 4' steps in inches and feet, else 1220 wide. */
function firstStair(): StairSettings {
  const ft = imperial();
  return { width: ft ? 1219.2 : 1220, style: "simple", height: lastStage?.height ?? (ft ? 609.6 : 600), classIndex: store.activeClassIndex, fill: "#bfbfbf", pen: "#000000", texture: -1 };
}

/** a tread's depth, mm: 11" in inches and feet */
const treadDepth = (): number => (imperial() ? 279.4 : 280);

/** The steps for a stage `height` high, in the frame stageSteps draws in. */
function stairPlan(set: StairSettings, height: number, textHeight: number): { plan: StagePlan; steps: number; depth: number } | string {
  const steps = stepsFor(height);
  const depth = treadDepth();
  const plan = stageSteps({
    structure: set.style,
    stageHeight: height,
    width: set.width,
    steps,
    topStep: false,
    depth,
    stringerLength: Math.hypot(steps * depth, height),
    stringerWidth: 40,
    stringerType: "inside",
    extraStringers: 0,
    indent: 0,
    left: false,
    right: false,
    extraRails: 0,
    arrow: "up",
    arrowSize: Math.min(set.width / 3, 300),
    textHeight,
  });
  return typeof plan === "string" ? plan : { plan, steps, depth };
}

/** Stage > Event > Create Stair…: the dialog, then a click where the steps meet the stage and a click the way they come down. */
export async function createStair(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s) return;
  const layer = s.doc.layers().find((l) => l.id === layerId);
  if (!layerId || layer?.kind !== "design") {
    toast("Make a design layer active to place stage steps.", "info");
    return;
  }
  const d = lastStair ?? firstStair();
  const v = await toolPrefs(
    "Create Stair",
    [
      { kind: "length", key: "width", label: "Width", value: d.width },
      { kind: "choice", key: "style", label: "Style", value: d.style, options: STYLES, wide: true },
      { kind: "length", key: "height", label: "Stage Height (where no stage is found)", value: d.height },
      ...lookFields(d),
    ],
    `Click where the steps meet the stage's edge, then click the way they come down. They rise to the top of a stage built in 3D under them (as Create Stage builds one), else to the Stage Height here, in risers up to ${formatLength(180, s.doc.info.units)}, each tread ${formatLength(treadDepth(), s.doc.info.units)} deep.`,
  );
  if (!v || store.session !== s) return;
  const set: StairSettings = { width: v.num("width"), style: STYLES.find((o) => o.value === v.choice("style"))?.value ?? "simple", height: v.num("height"), ...lookFrom(v) };
  lastStair = set;
  const textHeight = TEXT_MM * (layer.scale || 1);
  const first = stairPlan(set, set.height, textHeight);
  if (typeof first === "string") {
    toast(`Create Stair: ${first}`, "info");
    return;
  }
  const outline = (at: Pt, angle: number): Part[] => placePlan(first.plan, at, angle).outlines.map((points): Part => ({ kind: "polygon", points, closed: true }));
  const down = -Math.PI / 2;
  placeAtNextClick({
    what: "Stair",
    hint: "Create Stair: click where the steps meet the stage's edge · Esc cancels",
    preview: (at) => outline(at, down),
    place: (at) =>
      void placeAtNextClick({
        what: "Stair",
        hint: "Click the way the steps come down · Shift 15° · Esc cancels",
        from: at,
        preview: (to) => [...outline(at, angleTo(at, to)), { kind: "line", a: at, b: to }],
        place: (to) => placeStair(set, layerId, at, angleTo(at, to), textHeight),
      }),
  });
}

const angleTo = (at: Pt, to: Pt): number => (Math.hypot(to.x - at.x, to.y - at.y) < 1e-9 ? -Math.PI / 2 : Math.atan2(to.y - at.y, to.x - at.x));

/** Places the steps at `at` coming down along `angle`, up to the stage behind them or the height given, and selects them. */
function placeStair(set: StairSettings, layerId: string, at: Pt, angle: number, textHeight: number): void {
  const s = store.session;
  if (!s) return;
  const ground = s.doc.layers().find((l) => l.id === layerId)?.elevation ?? 0;
  // the stage's top just behind the edge clicked
  const behind = { x: at.x - Math.cos(angle) * 50, y: at.y - Math.sin(angle) * 50 };
  const top = stageTop(layerId, behind, ground);
  const found = top !== null && top - ground > 1;
  const height = found ? top - ground : set.height;
  const fitted = stairPlan(set, height, textHeight);
  if (typeof fitted === "string") {
    toast(`Create Stair: ${fitted}`, "info");
    return;
  }
  const r = attempt("Create Stair", (session) => session.batch(() => addPiece(session, layerId, planParts(placePlan(fitted.plan, at, angle), set), stepsSolid(at, angle, set.width, fitted.steps, fitted.depth, false, height), set)));
  if (!r) return;
  setEditGroup(null, [r.value]);
  const units = s.doc.info.units;
  toast(`Create Stair: ${fitted.steps} ${fitted.steps === 1 ? "step" : "steps"} up to ${found ? "the stage" : "the Stage Height"}, ${formatLength(height, units)}.`, "info");
}
