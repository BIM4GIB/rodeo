// AEC > Pillar: a closed 2D shape stood up to a height, or an open one stood up as a flat screen (a
// movie screen, a room divider), as Vectorworks' Pillar command makes them. Vectorworks' pillar is a
// plug-in object that walls join to; Rodeo's is a plain object named Pillar: an extrude, or a mesh
// for a screen.

import type { ObjectInfo } from "../core/index.ts";
import { attempt, setSelection } from "./commands.ts";
import { isDerivedId } from "./scene.ts";
import { isClosedShape, outlineOf } from "./shapes.ts";
import { store } from "./state.ts";
import { toast } from "./toast.ts";
import { toolPrefs } from "./toolPrefs.ts";

/** Lines, rectangles, polygons, arcs, ovals and polylines. */
const PILLAR_TYPES: ReadonlySet<number> = new Set([2, 3, 5, 6, 13, 21]);

/** the last height asked for, mm: eight feet at first */
let lastHeight = 2438.4;

function selectedShapes(): ObjectInfo[] {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId || store.selection.size === 0) return [];
  const scope = store.editGroupId;
  return (
    s.doc
      .objects(layerId)
      .filter((o) => store.selection.has(o.id) && PILLAR_TYPES.has(o.type) && o.shape && o.parentId === scope && !isDerivedId(o.id))
      // a screen is made on the layer, which would take it out of the group being edited
      .filter((o) => scope === null || isClosedShape(o.shape!))
  );
}

export const canMakePillar = (): boolean => selectedShapes().length > 0;

/** A strip of upright quads along `points`, from z 0 up to `height`, as one mesh's faces. */
export function screenFaces(points: readonly { readonly x: number; readonly y: number }[], height: number): number[][] {
  return points.slice(1).map((b, i) => {
    const a = points[i];
    return [a.x, a.y, 0, b.x, b.y, 0, b.x, b.y, height, a.x, a.y, height];
  });
}

/** AEC > Pillar…: asks for the height and stands each selected shape up to it. */
export async function pillarDialog(): Promise<void> {
  const shapes = selectedShapes();
  const layerId = store.activeLayerId;
  if (!shapes.length || !layerId) return;
  const v = await toolPrefs("Pillar Preferences", [{ kind: "length", key: "height", label: "Height", value: lastHeight }]);
  if (!v) return;
  const height = (lastHeight = v.num("height"));
  const r = attempt("Pillar", (s) =>
    s.batch(() =>
      shapes.map((o) => {
        const id = standUp(o, layerId, height);
        namePillar(id);
        return id;
      }),
    ),
  );
  if (!r) return;
  setSelection(r.value);
  toast(`${r.value.length} ${r.value.length === 1 ? "pillar" : "pillars"} made.`, "info");
}

/** Names it Pillar, or Pillar-2 and on: a drawing's names are all different, and only the session knows them all. */
function namePillar(id: string): void {
  for (let n = 1; ; n++) {
    try {
      store.session!.setObjectName(id, n === 1 ? "Pillar" : `Pillar-${n}`);
      return;
    } catch (e) {
      if (n === 10000) throw e;
    }
  }
}

function standUp(o: ObjectInfo, layerId: string, height: number): string {
  const s = store.session!;
  const shape = o.shape!;
  if (isClosedShape(shape)) return s.extrudeObjects([o.id], height)[0];
  const points = outlineOf(shape, shape.bbox ?? null);
  if (points.length < 2) throw new Error("that shape has no length to stand up");
  const [id] = s.addMeshes(layerId, [screenFaces(points, height)], o.classIndex, o.attrs ?? undefined);
  s.deleteObjects([o.id]);
  return id;
}
