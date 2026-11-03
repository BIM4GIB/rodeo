// The Building Shell's Chain Extrude: select the profile shapes, then click a path. The back shape runs
// along the path with mitred corners, and those in front of it repeat along it, given a thickness. It's a
// plug-in object, so Object Info changes its parameters and redraws it, and Draw New Path gives it another
// path; Vectorworks also has the path reshaped and the profile edited in place. The drawing's plan lines
// and meshes come from chainExtrudeShapes.ts. The shapes selected stay where they are.

import { attempt, setEditGroup } from "../commands.ts";
import { chainPath, chainPlan, chainSections, chainSolids, type ChainDatum, type ChainOptions, type ChainProfile } from "../chainExtrudeShapes.ts";
import { appContext, registerPluginDrivers, type PluginDriver, type PluginWidget } from "../ext.ts";
import { isDerivedId } from "../scene.ts";
import { store } from "../state.ts";
import { errorMessage, toast } from "../toast.ts";
import { toolPrefs } from "../toolPrefs.ts";
import type { Attributes, EditSession, NewShape, ObjectInfo, PluginFieldSpec, Pt, RecordValue } from "../../core/index.ts";
import { addPart, type Part } from "./detailing.ts";
import { PathTool } from "./paths.ts";

export const CHAIN_EXTRUDE = "Chain Extrude";

const BOOL = 2;
const TEXT = 4;
const DIMENSION = 7;
const POPUP = 8;

const FIELD = {
  draw3d: "Draw 3D",
  flip: "Flip",
  center: "Center Ribs",
  corner: "Corner Ribs",
  datum: "Vertical Datum",
  thickness: "Thickness",
  spacing: "Spacing",
  elevation: "Elevation",
  /** the path in the object's own frame, the profile and the shapes' attributes, as JSON */
  data: "Chain Data",
} as const;

const DATUMS: readonly (readonly [ChainDatum, string])[] = [
  ["top", "Top"],
  ["bottom", "Bottom"],
];

/** what the tool places next */
const settings = {
  draw3d: true,
  flip: false,
  center: true,
  corner: true,
  datum: "top" as ChainDatum,
  thickness: 50.8,
  spacing: 609.6,
  elevation: 0,
};

/** What the object keeps of how it was made. */
interface ChainData {
  readonly path: readonly Pt[];
  readonly closed: boolean;
  readonly profile: ChainProfile;
  readonly continuousAttrs?: Partial<Attributes>;
  readonly repeatingAttrs?: Partial<Attributes>;
}

type ProfileChoice = Pick<ChainData, "profile" | "continuousAttrs" | "repeatingAttrs">;

/** the last profile used, for the next path while nothing new is selected */
let lastProfile: ProfileChoice | null = null;
/** the object whose path is being drawn again */
let redrawing: string | null = null;

const NEEDS_PROFILE = "Select the profile first: a closed polygon or polyline to run along the path, another in front of it to repeat, and if you like a locus for the reference point.";

/** The profile in the selection; null when nothing that could be one is selected, a string when what's selected won't do. */
function selectedProfile(): ProfileChoice | string | null {
  const s = store.session;
  const layer = store.activeLayerId;
  if (!s || !layer) return null;
  const picked = s.doc.objects(layer).filter((o) => store.selection.has(o.id) && o.parentId === store.editGroupId && !isDerivedId(o.id));
  const loci = picked.filter((o) => o.shape?.kind === "locus");
  const ring = (o: ObjectInfo): Pt[] | null => {
    if (o.shape?.kind === "locus") return null;
    const found = s.curvePoints(o.id);
    return found && found.points.length >= 3 ? found.points.map((p) => ({ x: p[0], y: p[1] })) : null;
  };
  const shapes = picked.flatMap((o) => {
    const points = ring(o);
    return points ? [{ o, points }] : [];
  });
  if (!shapes.length) return loci.length ? NEEDS_PROFILE : null;
  if (shapes.length + loci.length !== picked.length) return "The profile can only be polygons, polylines and a locus.";
  if (shapes.length > 3) return "The profile can be at most three shapes.";
  if (loci.length > 1 || (loci.length && shapes.length > 2)) return "The profile can be at most two shapes and one locus.";
  const at = loci[0]?.shape?.points[0] ?? null;
  return {
    profile: { continuous: shapes[0].points, repeating: shapes.slice(1).map((x) => x.points), locus: at },
    continuousAttrs: shapes[0].o.attrs ?? undefined,
    repeatingAttrs: shapes[1]?.o.attrs ?? undefined,
  };
}

/** What the next path runs: the selection, or the last profile used. */
function currentProfile(): ProfileChoice | string {
  const found = selectedProfile();
  return found ?? lastProfile ?? NEEDS_PROFILE;
}

const fields = (data: ChainData): PluginFieldSpec[] => [
  { name: FIELD.draw3d, type: BOOL, value: settings.draw3d },
  { name: FIELD.flip, type: BOOL, value: settings.flip },
  { name: FIELD.center, type: BOOL, value: settings.center },
  { name: FIELD.corner, type: BOOL, value: settings.corner },
  { name: FIELD.datum, type: POPUP, value: DATUMS.find(([k]) => k === settings.datum)![1] },
  { name: FIELD.thickness, type: DIMENSION, value: settings.thickness },
  { name: FIELD.spacing, type: DIMENSION, value: settings.spacing },
  { name: FIELD.elevation, type: DIMENSION, value: settings.elevation },
  { name: FIELD.data, type: TEXT, value: JSON.stringify(data) },
];

function recordOf(s: EditSession, id: string): { format: number; value(field: string): RecordValue | undefined } {
  const rec = s.doc.records(id).find((r) => r.parametric && r.name === CHAIN_EXTRUDE);
  if (!rec) throw new Error("That isn't a chain extrude.");
  return { format: rec.format, value: (field) => rec.fields.find((f) => f.name === field)?.value };
}

/** The drawing's parts for plan, in the frame the points are in: dashed ribs if the drawing has a dashed line. */
function planParts(data: Pick<ChainData, "path" | "closed" | "profile">, o: ChainOptions, dashed: number | undefined, attrs?: Partial<Attributes>): Part[] | string {
  const path = chainPath(data.path, data.closed, o.flip);
  if (typeof path === "string") return path;
  const plan = chainPlan(path, chainSections(data.profile, o.datum), o);
  const line = (points: Pt[]): NewShape => ({ kind: "polyline", points, closed: false });
  const unfilled = { ...attrs, fillPattern: 0 };
  return [
    ...plan.lines.map((points): Part => ({ shape: line(points), attrs: unfilled })),
    ...plan.ribs.map((points): Part => ({ shape: line(points), attrs: { ...unfilled, ...(dashed === undefined ? {} : { lineStyle: dashed }) } })),
  ];
}

function drawInto(s: EditSession, id: string): void {
  const obj = s.doc.object(id);
  const rec = recordOf(s, id);
  if (!obj) throw new Error("That isn't a chain extrude.");
  const data = JSON.parse(String(rec.value(FIELD.data) ?? "null")) as ChainData | null;
  if (!data) throw new Error("This chain extrude has lost its profile: draw it again.");
  const o: ChainOptions = {
    flip: rec.value(FIELD.flip) === true,
    centerRibs: rec.value(FIELD.center) === true,
    cornerRibs: rec.value(FIELD.corner) === true,
    datum: DATUMS.find(([, label]) => label === rec.value(FIELD.datum))?.[0] ?? "top",
    thickness: Number(rec.value(FIELD.thickness)),
    spacing: Number(rec.value(FIELD.spacing)),
    elevation: Number(rec.value(FIELD.elevation)) || 0,
  };
  const path = chainPath(data.path, data.closed, o.flip);
  if (typeof path === "string") throw new Error(path);
  const sections = chainSections(data.profile, o.datum);
  const solids = chainSolids(path, sections, o);
  if (typeof solids === "string") throw new Error(solids);
  const dashed = s.doc.lineTypes().find((t) => t.dashes.length > 0)?.style;
  const parts = planParts(data, o, dashed, data.continuousAttrs);
  if (typeof parts === "string") throw new Error(parts);
  const ids = parts.map((part) => addPart(s, obj.layerId, part));
  if (rec.value(FIELD.draw3d) === true) {
    // addMeshes lifts them by the layer's elevation, and a plug-in object's drawing is lifted by it again when shown
    const base = s.doc.layers().find((l) => l.id === obj.layerId)?.elevation ?? 0;
    const meshOf = (tris: readonly number[], attrs: Partial<Attributes> | undefined): void => {
      const faces: number[][] = [];
      for (let i = 0; i + 8 < tris.length; i += 9) faces.push(tris.slice(i, i + 9).map((v, k) => (k % 3 === 2 ? v - base : v)));
      if (faces.length) ids.push(...s.addMeshes(obj.layerId, [faces], obj.classIndex, attrs));
    };
    meshOf(solids.continuous, data.continuousAttrs);
    meshOf(solids.ribs, data.repeatingAttrs ?? data.continuousAttrs);
  }
  s.setPluginDrawing(id, ids);
}

/** Places a chain extrude along `points` (in the drawing) and selects it. */
function placeChain(layerId: string, points: readonly Pt[], closed: boolean, choice: ProfileChoice): void {
  const at = points[0];
  const r = attempt(CHAIN_EXTRUDE, (s) =>
    s.batch(() => {
      const data: ChainData = { ...choice, path: points.map((p) => ({ x: p.x - at.x, y: p.y - at.y })), closed };
      const specs = fields(data);
      const id = s.addPluginObject(layerId, CHAIN_EXTRUDE, specs, Object.fromEntries(specs.map((f) => [f.name, f.value])), at, 0, store.activeClassIndex);
      drawInto(s, id);
      return id;
    }),
  );
  if (r) {
    lastProfile = choice;
    setEditGroup(null, [r.value]);
  }
}

function edit(id: string, label: string, values: Readonly<Record<string, RecordValue>>): void {
  attempt(label, (s) =>
    s.batch(() => {
      const rec = recordOf(s, id);
      for (const [field, value] of Object.entries(values)) s.setRecordField(id, rec.format, field, value);
      drawInto(s, id);
    }),
  );
}

/** Gives the object being redrawn the path clicked. */
function newPath(id: string, points: readonly Pt[], closed: boolean): void {
  const s = store.session;
  const obj = s?.doc.object(id);
  if (!s || !obj?.insertion) return;
  const { insertion } = obj;
  const old = JSON.parse(String(recordOf(s, id).value(FIELD.data))) as ChainData;
  const turn = (-s.pluginAngle(id) * Math.PI) / 180;
  const path = points.map((p) => {
    const [dx, dy] = [p.x - insertion.x, p.y - insertion.y];
    return { x: dx * Math.cos(turn) - dy * Math.sin(turn), y: dx * Math.sin(turn) + dy * Math.cos(turn) };
  });
  edit(id, "Draw New Path", { [FIELD.data]: JSON.stringify({ ...old, path, closed }) });
  setEditGroup(null, [id]);
}

const param = (id: number, field: string): PluginWidget => ({ id, kind: "param", field, label: "", level: 0 });
const NEW_PATH = 20;
const WIDGETS: readonly PluginWidget[] = [
  param(1, FIELD.draw3d),
  param(2, FIELD.flip),
  param(3, FIELD.center),
  param(4, FIELD.corner),
  param(5, FIELD.datum),
  param(6, FIELD.thickness),
  param(7, FIELD.spacing),
  param(8, FIELD.elevation),
  { id: NEW_PATH, kind: "button", label: "Draw New Path", level: 0 },
];

const driver: PluginDriver = {
  name: CHAIN_EXTRUDE,
  shape: "point",
  builtIn: true,
  label: () => undefined,
  readOnly: () => false,
  choices: (field) => (field === FIELD.datum ? DATUMS.map(([, label]) => ({ value: label, label })) : undefined),
  place: () => toast(NEEDS_PROFILE, "info"),
  edit: (id, values) => edit(id, "Edit Chain Extrude", values),
  async reset(id) {
    const s = store.session;
    if (!s) return "No drawing is open.";
    try {
      s.batch(() => drawInto(s, id));
      return null;
    } catch (err) {
      return errorMessage(err);
    }
  },
  layout: () => WIDGETS,
  widgetStates: () => {},
  press(id, widget) {
    if (widget !== NEW_PATH) return;
    redrawing = id;
    appContext()?.controller.setTool("chainextrude");
    toast("Click the new path's corners.", "info");
  },
};
registerPluginDrivers(() => [driver]);

export class ChainExtrudeTool extends PathTool {
  readonly id = "chainextrude";
  protected readonly label = CHAIN_EXTRUDE;

  protected startHint(): string {
    if (redrawing) return "Click the first corner of the chain extrude's new path";
    const found = currentProfile();
    return typeof found === "string" ? found : "Click the first corner of the path, going clockwise for the outside of a building";
  }

  /** the path's drawing as it grows: a chain extrude places itself, so nothing's added from here */
  protected parts(): string {
    return "";
  }

  protected override previewParts(points: Pt[], closed: boolean): Part[] | string {
    const found = currentProfile();
    if (redrawing || typeof found === "string") return "";
    const { flip, center: centerRibs, corner: cornerRibs, datum, thickness, spacing, elevation } = settings;
    return planParts({ profile: found.profile, path: points, closed }, { flip, centerRibs, cornerRibs, datum, thickness, spacing, elevation }, undefined);
  }

  protected override finish(points: Pt[], closed: boolean): void {
    if (redrawing) {
      const id = redrawing;
      redrawing = null;
      newPath(id, points, closed);
      return;
    }
    const layer = store.activeLayerId;
    const found = currentProfile();
    if (typeof found === "string") toast(found, "info");
    else if (layer) placeChain(layer, points, closed, found);
  }

  override cancel(): void {
    super.cancel();
    redrawing = null;
  }

  async preferences(): Promise<void> {
    const s = settings;
    const v = await toolPrefs(
      "Chain Extrude Preferences",
      [
        { kind: "check", key: "draw3d", label: "Draw 3D", value: s.draw3d },
        { kind: "check", key: "flip", label: "Flip", value: s.flip },
        { kind: "check", key: "center", label: "Center Ribs", value: s.center },
        { kind: "check", key: "corner", label: "Corner Ribs", value: s.corner },
        { kind: "choice", key: "datum", label: "Vertical Datum", value: s.datum, options: DATUMS.map(([value, label]) => ({ value, label })) },
        { kind: "length", key: "thickness", label: "Thickness", value: s.thickness },
        { kind: "length", key: "spacing", label: "Spacing", value: s.spacing },
        { kind: "length", key: "elevation", label: "Elevation", value: s.elevation },
      ],
      "The back shape runs along the path and those in front repeat, with the path at the top or bottom right of the back shape's box, or at a locus in the profile. The shape's left side goes to the left of the way the path is walked; Flip turns it to the right.",
    );
    if (!v) return;
    s.draw3d = v.flag("draw3d");
    s.flip = v.flag("flip");
    s.center = v.flag("center");
    s.corner = v.flag("corner");
    s.datum = v.choice("datum") as ChainDatum;
    s.thickness = v.num("thickness");
    s.spacing = v.num("spacing");
    s.elevation = v.num("elevation");
  }
}
