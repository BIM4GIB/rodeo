// View > Create Interior Elevation Viewport…: up to four elevations of a room's walls, each a section
// viewport (sectionViewport.ts) looking from one side of the room at the wall across from it. The room
// is round an Interior Elevation Marker (Dims/Notes' tool) or a closed shape drawn round it. As
// Vectorworks finds them, each look runs across to the nearest walls either side and from floor to
// ceiling: here the first faces met straight out from the marker's middle, a metre above its layer
// (beyond them, the model's extents); a shape's own sides bound it across instead. A shape gets a
// marker at its middle with the looks' numbers; a marker's numbers start the dialog.

import type { Pt } from "../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "./commands.ts";
import { firstFree, NEW_SHEET, viewportNamesTaken } from "./createViewport.ts";
import { nextPaint } from "./dom.ts";
import { appContext } from "./ext.ts";
import { showLoading } from "./loading.ts";
import { interiorElevation } from "./markerShapes.ts";
import { isClosedShape, outlineOf } from "./shapes.ts";
import { nearestHit, sectionDrawing, type CutMesh } from "./sectionCut.ts";
import { addSectionViewport, nextSpot, sectionHalves, sectionMeshes, type SectionView } from "./sectionViewport.ts";
import { store } from "./state.ts";
import { errorMessage, toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";
import { addPart } from "./tools/detailing.ts";
import { markerParts } from "./tools/markers.ts";

/** the height above the room's layer the walls are looked for at, mm */
const EYE_MM = 1000;
/** past the far wall's face, so it's drawn, mm */
const PAST_MM = 10;
/** an interior elevation marker on paper, mm, as the tool draws it */
const MARKER_MM = 12;
/** between viewports in the row, mm */
const GAP_MM = 20;

type Compass = "North" | "East" | "South" | "West";

/** The room: its middle, the way the marker turns, and how far it reaches each way from its middle along each look when a shape bounds it. */
interface Room {
  readonly layerId: string;
  readonly centre: Pt;
  /** radians: the first look's direction, the others a quarter turn on each, anticlockwise */
  readonly angle: number;
  /** the shape's reach along a direction, when a shape bounds the room */
  readonly reach: ((dir: Pt) => number) | null;
  /** the marker's number by each look, when it's a marker */
  readonly numbers: readonly (string | null)[];
  readonly isShape: boolean;
}

const pick = "Select an Interior Elevation Marker, or a closed shape drawn round the room.";

function roomSource(): Room | string {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return pick;
  const obj = doc.object([...store.selection][0]);
  if (!obj) return pick;
  const layer = doc.layers().find((l) => l.id === obj.layerId);
  if (!layer || layer.kind === "sheet") return "Mark the room on a design layer.";
  const s = obj.shape;
  if (s && s.bbox && isClosedShape(s)) {
    const outline = outlineOf(s, s.bbox);
    const c = { x: (s.bbox.x0 + s.bbox.x1) / 2, y: (s.bbox.y0 + s.bbox.y1) / 2 };
    return { layerId: layer.id, centre: c, angle: 0, reach: (d) => Math.max(0, ...outline.map((p) => (p.x - c.x) * d.x + (p.y - c.y) * d.y)), numbers: [], isShape: true };
  }
  if (obj.kind !== "group") return pick;
  // an Interior Elevation Marker: its circle, its arrows in turn, the numbers by them
  const parts = doc.objects(layer.id).filter((o) => o.parentId === obj.id);
  const circle = parts.find((o) => o.shape?.kind === "arc" && o.shape.center && Math.abs(o.shape.sweepAngle ?? 0) >= 359.9);
  const c = circle?.shape?.center;
  const r = circle?.shape?.rx ?? 0;
  const arrows = parts.filter((o) => o.shape?.kind === "polygon" && o.shape.closed && (o.attrs?.fillPattern ?? 0) !== 0);
  if (!c || !(r > 0) || arrows.length < 4) return pick;
  const tip = (pts: readonly Pt[]): Pt => pts.reduce((a, p) => (Math.hypot(p.x - c.x, p.y - c.y) > Math.hypot(a.x - c.x, a.y - c.y) ? p : a), pts[0]);
  const t0 = tip(arrows[0].shape!.points);
  const angle = Math.atan2(t0.y - c.y, t0.x - c.x);
  const texts = parts.filter((o) => o.shape?.kind === "text" && o.shape.text?.trim());
  const numbers = [0, 1, 2, 3].map((k) => {
    const at = { x: c.x + Math.cos(angle + (k * Math.PI) / 2) * 0.62 * r, y: c.y + Math.sin(angle + (k * Math.PI) / 2) * 0.62 * r };
    const near = texts.find((o) => {
      const p = o.shape!.anchor ?? o.shape!.points[0];
      return p && Math.hypot(p.x - at.x, p.y - at.y) < 0.3 * r;
    });
    return near?.shape?.text?.trim() ?? null;
  });
  return { layerId: layer.id, centre: c, angle, reach: null, numbers, isShape: false };
}

/** A look's compass name: the quarter its direction falls in, as Vectorworks names them. */
function compass(a: number): Compass {
  const deg = (((a * 180) / Math.PI) % 360 + 360) % 360;
  return deg >= 45 && deg < 135 ? "North" : deg >= 135 && deg < 225 ? "West" : deg >= 225 && deg < 315 ? "South" : "East";
}

const ORDER: readonly Compass[] = ["North", "East", "South", "West"];

export async function createInteriorElevationDialog(): Promise<void> {
  const session = store.session;
  if (!session) return;
  const room = roomSource();
  if (typeof room === "string") {
    toast(room, "error");
    return;
  }
  const doc = session.doc;
  const all = doc.layers();
  const sheets = all.filter((l) => l.kind === "sheet");
  const newSheetName = firstFree("Sheet", new Set(all.map((l) => l.name)));
  const taken = viewportNamesTaken(doc);
  const first = sheets.find((l) => l.id === store.activeLayerId) ?? sheets[0];
  const roomLayer = all.find((l) => l.id === room.layerId);
  // the four looks in compass order, each from the marker's arrow that points its way
  const looks = [0, 1, 2, 3]
    .map((k) => ({ k, angle: room.angle + (k * Math.PI) / 2 }))
    .map((l) => ({ ...l, name: compass(l.angle) }))
    .sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  // numbers one past the sheet's viewports, skipping those in use, unless the marker has its own
  let n = (first ? doc.viewports(first.id).length : 0) + 1;
  const nextFree = (): string => {
    while (taken.has(`${n}/${first?.name ?? newSheetName}`)) n++;
    return String(n++);
  };
  const v = await toolPrefs(
    "Create Interior Elevation Viewports",
    [
      { kind: "check", key: "byNumber", label: "Name viewport as Dwg No./Sheet No.", value: true },
      { kind: "text", key: "name", label: "Viewport Name", value: firstFree("Interior Elevation", taken) },
      {
        kind: "choice",
        key: "sheet",
        label: "Create on Layer",
        value: first?.id ?? NEW_SHEET,
        options: [...sheets.map((l) => ({ value: l.id, label: l.name })), { value: NEW_SHEET, label: "New Sheet Layer" }],
      },
      { kind: "heading", key: "drawing", label: "Drawing" },
      ...looks.flatMap((l) => [
        { kind: "check" as const, key: `on${l.k}`, label: l.name, value: true },
        { kind: "text" as const, key: `number${l.k}`, label: `${l.name} Number`, value: room.numbers[l.k] ?? nextFree() },
        { kind: "text" as const, key: `title${l.k}`, label: `${l.name} Title`, value: `${l.name} Elevation` },
      ]),
      { kind: "number", key: "scale", label: "Scale 1:", value: roomLayer?.scale || 1, min: 0.001, max: 1e6 },
      { kind: "check", key: "beyond", label: "Display extents beyond cut plane", value: true },
      { kind: "check", key: "label", label: "Use drawing label", value: true },
    ],
    `Each look runs across the room from wall to wall and floor to ceiling: the nearest faces straight out from the ${room.isShape ? "shape's middle, the shape's sides bounding it across" : "marker's middle"}, ${EYE_MM / 1000} m above its layer, else the model's extents. Each is drawn into its viewport's annotations as the model is now; they aren't kept up to date.`,
  );
  if (!v || store.session !== session) return;
  const chosen = v.choice("sheet");
  const sheetName = chosen === NEW_SHEET ? newSheetName : (sheets.find((l) => l.id === chosen)?.name ?? "");
  const wanted = looks.filter((l) => v.flag(`on${l.k}`)).map((l) => ({ ...l, number: v.choice(`number${l.k}`).trim(), title: v.choice(`title${l.k}`).trim() }));
  if (!wanted.length) {
    toast("Create Interior Elevation Viewports: tick at least one look.", "info");
    return;
  }
  const base = v.choice("name").trim() || "Interior Elevation";
  const named = wanted.map((l) => ({ ...l, viewport: v.flag("byNumber") ? `${l.number}/${sheetName}` : `${base} ${l.name}` }));
  const names = named.map((l) => l.viewport);
  const clash = names.find((name, i) => taken.has(name) || names.indexOf(name) !== i);
  if (clash) {
    toast(`“${clash}” is already a layer's, resource's or viewport's name.`, "error");
    return;
  }
  const scale = v.num("scale");

  const done = showLoading("Cutting the interior elevations…");
  let views: (SectionView & { look: (typeof named)[number] })[];
  try {
    await nextPaint();
    const meshes = sectionMeshes();
    views = cutRoom(meshes, room, roomLayer?.elevation ?? 0, named, v.flag("beyond")).map((c) => ({
      drawing: c.drawing,
      scale,
      mid: { x: 0, y: 0 },
      at: room.centre,
      name: c.look.viewport,
      label: v.flag("label") ? { number: c.look.number, sheet: sheetName, title: c.look.title } : null,
      look: c.look,
    }));
  } catch (err) {
    toast(`The interior elevations couldn't be cut: ${errorMessage(err)}`);
    return;
  } finally {
    done();
  }
  if (!views.length || store.session !== session) {
    if (!views.length) toast("The room has no 3D objects round it on the visible design layers.", "info");
    return;
  }
  // in a row, left to right, right of what the sheet holds already
  const sizes = views.map((w) => sectionHalves(w.drawing.box, scale));
  const start = nextSpot(chosen === NEW_SHEET ? null : chosen, sizes[0].halfW, sizes[0].halfH);
  const top = start.y + sizes[0].halfH;
  let left = start.x - sizes[0].halfW;
  const placed = views.map((w, i) => {
    const mid = { x: left + sizes[i].halfW, y: top - sizes[i].halfH };
    left += 2 * sizes[i].halfW + GAP_MM;
    return { ...w, mid };
  });
  const made = attempt("Create Interior Elevation Viewports", (s) =>
    s.batch(() => {
      const sheetId = chosen === NEW_SHEET ? s.createLayer(newSheetName, "sheet") : chosen;
      const ids = placed.map((w) => addSectionViewport(s, sheetId, w));
      if (room.isShape) {
        // a marker at the shape's middle with each look's number by its arrow
        const numbers = [0, 1, 2, 3].map((k) => placed.find((w) => w.look.k === k)?.look.number ?? "");
        const r = (MARKER_MM / 2) * (roomLayer?.scale || 1);
        const d = interiorElevation(room.centre, room.angle, r, numbers, sheetName);
        if (d) s.groupObjects(markerParts(d).map((p) => addPart(s, room.layerId, p)));
      }
      return { sheetId, ids };
    }),
  );
  if (!made) return;
  if (store.activeLayerId !== made.value.sheetId) setActiveLayer(made.value.sheetId);
  setSelection(made.value.ids);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
  toast(`Interior elevations made: ${placed.map((w) => w.name).join(", ")}.`, "info");
}

/** Each look's elevation of the room: across from wall to wall, floor to ceiling, from the wall behind to just past the one in front. */
function cutRoom<L extends { angle: number }>(meshes: readonly CutMesh[], room: Room, layerZ: number, looks: readonly L[], beyond: boolean): { look: L; drawing: SectionView["drawing"] }[] {
  // the model's extents, for a way with nothing in it
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes)
    for (let i = 0; i + 2 < m.triangles.length; i += 3)
      for (let a = 0; a < 3; a++) {
        lo[a] = Math.min(lo[a], m.triangles[i + a]);
        hi[a] = Math.max(hi[a], m.triangles[i + a]);
      }
  if (!Number.isFinite(lo[0])) return [];
  const z = layerZ + EYE_MM;
  const from = [room.centre.x, room.centre.y, z] as const;
  const toBox = (d: Pt): number => Math.max(...[lo[0], hi[0]].flatMap((x) => [lo[1], hi[1]].map((y) => (x - room.centre.x) * d.x + (y - room.centre.y) * d.y)));
  const reach = (d: Pt): number => room.reach?.(d) ?? nearestHit(meshes, from, [d.x, d.y, 0]) ?? Math.max(toBox(d), 1);
  const floor = nearestHit(meshes, from, [0, 0, -1]);
  const ceiling = nearestHit(meshes, from, [0, 0, 1]);
  const bottom = floor === null ? lo[2] : z - floor;
  const top = ceiling === null ? hi[2] : z + ceiling;
  return looks.flatMap((look) => {
    const d = { x: Math.cos(look.angle), y: Math.sin(look.angle) };
    const r = { x: d.y, y: -d.x };
    const back = reach({ x: -d.x, y: -d.y });
    const front = reach(d);
    const left = reach({ x: -r.x, y: -r.y });
    const right = reach(r);
    // the cut along the wall behind, running left to right as the look sees it
    const behind = { x: room.centre.x - d.x * back, y: room.centre.y - d.y * back };
    const a = { x: behind.x - r.x * left, y: behind.y - r.y * left };
    const b = { x: behind.x + r.x * right, y: behind.y + r.y * right };
    const drawing = sectionDrawing(meshes, { a, b, look: "left", depth: beyond ? back + front + PAST_MM : 0, bottom, top });
    return drawing.box ? [{ look, drawing: { ...drawing, box: drawing.box } }] : [];
  });
}
