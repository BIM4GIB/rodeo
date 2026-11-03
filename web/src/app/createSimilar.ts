// Create Similar Object (Edit menu, and the drawing's right-click menu): Vectorworks' command, which
// readies the tool that draws the selected object with that object's settings, so the next one
// drawn matches it. Its attributes become those of new objects and its class the active class; the
// tool copies the wall, slab, door, window, plug-in object or symbol it is, and takes a light's
// kind. Where the tool can't copy it (a curved wall, say: new walls copy straight ones), it keeps
// the kind it had and says so. Groups, 3D objects and objects no tool draws are refused with a note.

import type { ObjectInfo, VwxDocument } from "../core/index.ts";
import { setActiveClass } from "./commands.ts";
import { appContext } from "./ext.ts";
import { store, type ToolId } from "./state.ts";
import { toast } from "./toast.ts";
import { toolDef } from "./toolbar.ts";

const LINE = 2;
const RECT = 3;
const POLYGON = 5;
const ARC = 6;
const TEXT = 10;
const ROUND_RECT = 13;
const SYMBOL = 15;
const LOCUS = 17;
const POLYLINE = 21;
const DIMENSION = 63;
const WALL = 68;
const SLAB = 71;
const LIGHT = 81;
const PLUGIN = 86;
/** an arc this close to a full turn is a circle or an oval */
const FULL_TURN = 359.999;

/** The one object selected, when there is one. */
function selectedObject(): ObjectInfo | null {
  const doc = store.session?.doc;
  if (!doc || store.selection.size !== 1) return null;
  const [id] = store.selection;
  return doc.object(id);
}

/** The tool that draws objects like `obj`, or null when none does. */
export function toolFor(doc: VwxDocument, obj: ObjectInfo): ToolId | null {
  switch (obj.type) {
    case LINE:
      return "line";
    case RECT:
      return "rect";
    case ROUND_RECT:
      return "roundrect";
    case POLYGON:
      return "polygon";
    case POLYLINE:
      return "polyline";
    case ARC: {
      const s = obj.shape;
      if (Math.abs(s?.sweepAngle ?? 0) < FULL_TURN) return "arc";
      return s?.rx !== undefined && s.ry !== undefined && Math.abs(s.rx - s.ry) > 1e-9 ? "oval" : "circle";
    }
    case TEXT:
      return "text";
    case SYMBOL:
      return obj.symbol === undefined ? null : "symbol";
    case LOCUS:
      return "locus";
    case DIMENSION:
      return "dimension";
    case WALL:
      return "wall";
    case SLAB:
      return "slab";
    case LIGHT:
      return "light";
    case PLUGIN: {
      const name = doc.records(obj.id).find((r) => r.parametric)?.name;
      if (name === "Slab") return "slab";
      const inWall = obj.parentId !== null && doc.object(obj.parentId)?.type === WALL;
      if (inWall && name === "Door") return "door";
      if (inWall && name === "Window") return "window";
      return "plugin";
    }
    default:
      return null;
  }
}

/** True when one object is selected (Create Similar Object says so when no tool draws it). */
export function canCreateSimilar(): boolean {
  return selectedObject() !== null;
}

/** Readies the tool that draws the selected object, with its attributes, class and settings. */
export function createSimilar(): void {
  const doc = store.session?.doc;
  const obj = selectedObject();
  const ctx = appContext();
  if (!doc || !obj || !ctx) return;
  const id = toolFor(doc, obj);
  if (!id) {
    toast(`No tool draws ${obj.kind === "group" ? "groups" : "that kind of object"}, so there is nothing similar to create.`, "info");
    return;
  }
  if (obj.attrs) {
    store.drawAttrs = { ...obj.attrs };
    store.emit("attrs");
  }
  setActiveClass(obj.classIndex);
  const label = toolDef(id)?.label ?? id;
  if (ctx.setToolFrom(id, obj)) toast(`${label} tool ready, drawing like the object selected.`, "info");
  else toast(`${label} tool ready with the object's attributes and class, but it can't copy that object, so it keeps the kind it had.`, "info");
}
