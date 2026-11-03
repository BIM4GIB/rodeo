// Event Design's Create Room (Spotlight > Event in Vectorworks; Stage > Event here): the selected
// closed shape as a room's inside, with walls round it (their inner faces on its edge, mitred at the
// corners) and a floor under it all. The walls are plain walls the thickness and height asked, or
// copies of one of the drawing's walls (the Wall tool's styles) raised to the height. The floor is
// its outline in plan and its 3D, grouped as a hybrid shows, its top at the layer's elevation:
// Vectorworks' is a slab object, and Rodeo lays slabs only on rectangles copied from one the
// drawing has.

import type { EditSession, Pt } from "../../../core/index.ts";
import { attempt, setEditGroup } from "../../../app/commands.ts";
import { offsetPolyline } from "../../../app/geom.ts";
import { prism } from "../../../app/solids3d.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import type { Part } from "../../../app/tools/detailing.ts";
import { wallLabel } from "../../../app/tools/wall.ts";
import { formatLength } from "../../../app/units.ts";
import { addPiece, byClass, imperial, lookAttrs, lookFields, lookFrom, selectedShapes, type Look } from "./eventStage.ts";
import { roomRing } from "./stageLayout.ts";

const PLAIN = "plain";

interface RoomSettings {
  readonly height: number;
  /** a wall template's id, or PLAIN */
  readonly style: string;
  readonly thickness: number;
  readonly walls: Look;
  readonly floorThickness: number;
  readonly floor: Look;
  readonly deleteShape: boolean;
}

let last: RoomSettings | null = null;

/** 10' walls 6" thick on a 6" floor in feet and inches, else 3 m walls 150 thick on a 150 floor. */
function first(): RoomSettings {
  const ft = imperial();
  const look = (fill: string): Look => ({ classIndex: store.activeClassIndex, fill, pen: "#000000", texture: -1 });
  return { height: ft ? 3048 : 3000, style: PLAIN, thickness: ft ? 152.4 : 150, walls: look("#e6e6e6"), floorThickness: ft ? 152.4 : 150, floor: look("#d9cbb0"), deleteShape: false };
}

/** A floor: its outline in plan and its 3D from `z0` to `z1`, grouped in the look. */
function floorPiece(s: EditSession, layerId: string, outline: Pt[], z0: number, z1: number, look: Look): string {
  const part: Part = byClass(look) ? { shape: { kind: "polygon", points: outline, closed: true }, classIndex: look.classIndex, byClass: true } : { shape: { kind: "polygon", points: outline, closed: true }, classIndex: look.classIndex, attrs: lookAttrs(look) };
  return addPiece(s, layerId, [part], prism([outline], z0, z1), look);
}

/** Stage > Event > Create Room…: the dialog, then walls round each selected closed shape and a floor under it. */
export async function createRoom(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const shapes = selectedShapes();
  if (!shapes.length) {
    toast("Create Room: select a closed shape (a rectangle, polygon or closed polyline) the size of the room's inside.", "info");
    return;
  }
  const units = s.doc.info.units;
  const templates = s.wallTemplates();
  const d = last && (last.style === PLAIN || templates.some((k) => k.id === last!.style)) ? last : first();
  const v = await toolPrefs(
    "Create Room",
    [
      { kind: "heading", key: "walls", label: "Walls" },
      { kind: "length", key: "height", label: "Height", value: d.height },
      { kind: "choice", key: "style", label: "Style", value: d.style, options: [{ value: PLAIN, label: "Plain (the Thickness below)" }, ...templates.map((k) => ({ value: k.id, label: wallLabel(k, units) }))], wide: true },
      { kind: "length", key: "thickness", label: "Thickness (Plain)", value: d.thickness },
      // a wall's texture is its style's
      ...lookFields(d.walls, "w").filter((f) => f.key !== "wtexture"),
      { kind: "heading", key: "floor", label: "Floor" },
      { kind: "length", key: "floorThickness", label: "Thickness", value: d.floorThickness },
      ...lookFields(d.floor, "f"),
      { kind: "check", key: "deleteShape", label: "Delete the shape after", value: d.deleteShape },
    ],
    "The shape is the room's inside: the walls stand round it, their inner faces on its edge, mitred at the corners, and the floor runs under them, its top at the layer's elevation. Plain walls are the Thickness asked; a style copies one of the drawing's walls (its thickness, components and look), raised to the Height.",
  );
  if (!v || store.session !== s) return;
  const set: RoomSettings = {
    height: v.num("height"),
    style: v.choice("style"),
    thickness: v.num("thickness"),
    walls: lookFrom(v, "w"),
    floorThickness: v.num("floorThickness"),
    floor: lookFrom(v, "f"),
    deleteShape: v.flag("deleteShape"),
  };
  last = set;
  const template = templates.find((k) => k.id === set.style) ?? { id: `plain-wall:${set.thickness}:${set.height}`, style: null, thickness: set.thickness, height: set.height, faces: [-set.thickness / 2, set.thickness / 2] as [number, number] };
  const thickness = template.thickness;
  const rooms = shapes.map((shape) => {
    const ring = roomRing(shape.outline, thickness);
    // a style's control line lies where its left face (the inside, round a counter-clockwise ring) falls on the edge
    const control = ring ? offsetPolyline(ring.inside, true, -template.faces[1]) : null;
    return { shape, ring, control };
  });
  if (rooms.some((r) => !r.ring || !r.control || r.control.length !== r.ring.inside.length)) {
    toast(`Create Room: the walls, ${formatLength(thickness, units)} thick, can't go round that shape: a side is too short or turns back on itself.`, "info");
    return;
  }
  const r = attempt("Create Room", (session) =>
    session.batch(() => {
      const made: string[] = [];
      for (const { shape, ring, control } of rooms) {
        made.push(floorPiece(session, shape.layerId, ring!.outside, -set.floorThickness, 0, set.floor));
        // walls along the control lines, each mitred to the one before, the last to the first too
        const line = control!;
        const walls: string[] = [];
        line.forEach((a, i) => {
          const b = line[(i + 1) % line.length];
          const joins = i === 0 ? {} : i === line.length - 1 ? { before: walls[i - 1], after: walls[0] } : { before: walls[i - 1] };
          const id = session.addWall(shape.layerId, a, b, template.id, set.walls.classIndex, joins);
          if (Math.abs(template.height - set.height) > 0.01) session.setWallHeights(id, 0, set.height);
          if (!byClass(set.walls)) session.setAttributes([id], lookAttrs(set.walls));
          walls.push(id);
        });
        made.push(...walls);
      }
      if (set.deleteShape) session.deleteObjects(shapes.map((sh) => sh.id));
      return made;
    }),
  );
  if (!r) return;
  setEditGroup(null, r.value);
  toast(`Create Room: walls ${formatLength(set.height, units)} high and ${formatLength(thickness, units)} thick${templates.some((k) => k.id === set.style && k.style !== null) ? `, copies of ${wallLabel(template, units)}` : ""}, round ${shapes.length === 1 ? "the shape" : `${shapes.length} shapes`}, on a floor ${formatLength(set.floorThickness, units)} thick.`, "info");
}
