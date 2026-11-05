// Pins for voice commands: a numbered point dropped by a click while the user speaks. A click on
// the 2D drawing is snapped the way the tools snap, and names the object a click there would
// select; a click in the 3D view takes the face it met. This file also says where each pin is on
// the screen now, so the pins follow the drawing as it moves.

import type { AppContext } from "../../app/ext.ts";
import { pickObject } from "../../app/hittest.ts";
import type { SnapKind } from "../../app/snap.ts";
import { store } from "../../app/state.ts";
import { formatLength } from "../../app/units.ts";
import type { FaceHit } from "../../app/view3d.ts";
import type { VwxDocument, ObjectInfo } from "../../core/index.ts";
import { kindName, topLevelId } from "../search/describe.ts";
import type { Pin } from "./command.ts";
import type { UiPin } from "./ui.ts";

// Copied from app/tools.ts (SNAP_LABEL): keep the names the same as the tools show them.
const SNAP_LABEL: Record<SnapKind, string> = {
  end: "Endpoint",
  mid: "Midpoint",
  center: "Center",
  intersection: "Intersection",
  tangent: "Tangent",
  perpendicular: "Perpendicular",
  nearest: "On object",
  align: "Aligned",
  extension: "Extension",
  datum: "Datum offset",
  grid: "Grid",
};

/** What a person calls an object: "Door", "Wall", "Rectangle", "Group". */
export function objectNoun(doc: VwxDocument, o: ObjectInfo): string {
  const plugin = doc.records(o.id).find((r) => r.parametric);
  if (plugin) return plugin.name;
  if (o.kind === "other") {
    const words = o.typeName.replace(/-/g, " ").replace(/3d/gi, "3D");
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return kindName(o);
}

/** What a pin says it is on: the object's noun, its name in quotes and its class, as "Door · A-Door". */
function labelOf(doc: VwxDocument, o: ObjectInfo): string {
  return `${objectNoun(doc, o)}${o.name ? ` "${o.name}"` : ""} · ${o.className}`;
}

/** A pin for a click on the 2D drawing at `screen` (canvas CSS px): snapped as the tools snap, with the object a click would select. */
export function pinAt2d(ctx: AppContext, screen: { x: number; y: number }, n: number): Pin {
  const raw = ctx.view.toWorld(screen.x, screen.y);
  const r = ctx.snap.snap(raw, ctx.view);
  const doc = store.session?.doc ?? null;
  const hit = pickObject(ctx.scene, ctx.view, screen, ctx.scene.pickableLayers(store.activeLayerId));
  const id = hit && doc ? (ctx.scene.pickedUnitOf(hit, store.editGroupId) ?? topLevelId(doc, hit.id)) : null;
  const o = id && doc ? doc.object(id) : undefined;
  return {
    n,
    at: { x: r.pos.x, y: r.pos.y },
    objectId: o ? id : null,
    label: o && doc ? labelOf(doc, o) : "",
    snap: r.kind ? SNAP_LABEL[r.kind] : null,
    in3d: false,
  };
}

/** A pin where a click in the 3D view met the model. */
export function pinAt3d(_ctx: AppContext, hit: FaceHit, n: number): Pin {
  const [x, y, z] = hit.point;
  const doc = store.session?.doc ?? null;
  const id = hit.objectId && doc ? topLevelId(doc, hit.objectId) : null;
  const o = id && doc ? doc.object(id) : undefined;
  return { n, at: { x, y, z }, objectId: o ? id : null, label: o && doc ? labelOf(doc, o) : "", snap: null, in3d: true };
}

/** Where a pin is on the screen now (client px), or null when its view isn't showing or it's behind the camera. */
export function pinClient(ctx: AppContext, pin: Pin): { x: number; y: number } | null {
  if (!pin.in3d) {
    if (store.view3d) return null;
    const rect = ctx.canvas.getBoundingClientRect();
    const s = ctx.view.toScreen(pin.at);
    return { x: rect.left + s.x, y: rect.top + s.y };
  }
  if (!store.view3d) return null;
  return ctx.view3d()?.screenOf([pin.at.x, pin.at.y, pin.at.z ?? 0]) ?? null;
}

/** A pin as the bubble labels it: its number, what is under it, and the snap it took or the point's coordinates. */
export function uiPin(pin: Pin, units: string | undefined): UiPin {
  const detail = pin.snap ?? `x ${formatLength(pin.at.x, units)} · y ${formatLength(pin.at.y, units)}`;
  return { n: pin.n, label: pin.label || "Point", detail };
}
