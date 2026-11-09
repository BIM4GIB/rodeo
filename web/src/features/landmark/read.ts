// Reading Vectorworks Landmark's objects: their parameters, frame, path, fill and where a plant's
// plants stand. Kept apart from the page so schedules run in a check (landmark.check.ts).

import type { Attributes, Pt, RecordValue, VwxDocument } from "../../core/index.ts";
import { signedArea } from "./shapes.ts";

/** Landmark's plug-ins, as their parameters' records are named */
export const EXISTING_TREE = "Existing Tree";
export const PLANT = "Plant";
export const LAUBWERK = "Laubwerk Plant";
export const HARDSCAPE = "Hardscape";
export const LANDSCAPE_AREA = "Landscape Area";
export const MASSING = "Massing Model";
/** the data record a plant schedule reads */
export const PLANT_RECORD = "Plant Record";

const SYMBOL = 15;

/** A Landmark object's parameters, read by name in any case. */
export interface Params {
  readonly id: string;
  readonly layerId: string;
  readonly format: number;
  value(field: string): RecordValue | undefined;
  num(field: string): number;
  text(field: string): string;
  /** a check box, or a popup Landmark keeps as "TRUE" or "False" */
  flag(field: string): boolean;
}

export function paramsOf(doc: VwxDocument, id: string, name: string): Params | null {
  const rec = doc.records(id).find((r) => r.parametric && r.name === name);
  const layerId = doc.object(id)?.layerId;
  if (!rec || !layerId) return null;
  const byName = new Map(rec.fields.map((f): [string, RecordValue] => [f.name.toLowerCase(), f.value]));
  const value = (field: string): RecordValue | undefined => byName.get(field.toLowerCase());
  return {
    id,
    layerId,
    format: rec.format,
    value,
    num: (field) => Number(value(field)) || 0,
    text: (field) => String(value(field) ?? ""),
    flag: (field) => {
      const v = value(field);
      return v === true || (typeof v === "string" && v.toLowerCase() === "true");
    },
  };
}

/** A plug-in object's frame: its insertion point and turn. */
export function frameOf(doc: VwxDocument, id: string): { toWorld(q: Pt): Pt; toLocal(q: Pt): Pt; turn: number } {
  const o = doc.object(id);
  const at = o?.insertion ?? { x: 0, y: 0 };
  const turn = ((o?.turned ?? 0) * Math.PI) / 180;
  const [c, n] = [Math.cos(turn), Math.sin(turn)];
  return {
    toWorld: (q) => ({ x: at.x + q.x * c - q.y * n, y: at.y + q.x * n + q.y * c }),
    toLocal: (q) => ({ x: (q.x - at.x) * c + (q.y - at.y) * n, y: -(q.x - at.x) * n + (q.y - at.y) * c }),
    turn,
  };
}

/** A path plug-in's corners on the drawing, without a repeated last one; null when it has no path. */
export function pathOf(doc: VwxDocument, id: string): Pt[] | null {
  const pathId = doc.pluginPath(id);
  const shape = pathId ? doc.object(pathId)?.shape : undefined;
  if (!shape || (shape.kind !== "polyline" && shape.kind !== "polygon")) return null;
  const points = [...shape.points];
  const [first, last] = [points[0], points[points.length - 1]];
  if (points.length > 1 && Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) points.pop();
  return points;
}

/**
 * The look of the biggest filled shape it draws in plan (a hardscape's paving, a tree's canopy), which
 * what Rodeo draws of it again takes; null when it has none.
 */
export function fillOf(doc: VwxDocument, id: string): Attributes | null {
  const layerId = doc.object(id)?.layerId;
  if (!layerId) return null;
  const inside = new Set([id]);
  let best: { area: number; attrs: Attributes } | null = null;
  for (const o of doc.objects(layerId)) {
    if (!o.parentId || !inside.has(o.parentId)) continue;
    inside.add(o.id);
    const s = o.shape;
    if ((s?.kind !== "polygon" && s?.kind !== "polyline") || !s.points || !o.attrs || o.attrs.fillPattern === 0) continue;
    const area = Math.abs(signedArea(s.points));
    if (!best || area > best.area) best = { area, attrs: o.attrs };
  }
  return best?.attrs ?? null;
}

/** Where its plants stand, in its own frame: its symbols, or the trunks Rodeo drew; its origin when it has neither. */
export function plantSpots(p: Params, doc: VwxDocument): Pt[] {
  const { toLocal } = frameOf(doc, p.id);
  const spots: Pt[] = [];
  for (const o of doc.objects(p.layerId)) {
    if (o.parentId !== p.id) continue;
    if (o.type === SYMBOL && o.insertion) spots.push(toLocal(o.insertion));
    else if (o.shape?.kind === "arc" && o.shape.center && Math.abs(o.shape.sweepAngle ?? 0) >= 360) spots.push(toLocal(o.shape.center));
  }
  return spots.length ? spots : [{ x: 0, y: 0 }];
}

/** mm² in each of Landmark's area units */
const AREA_UNITS: readonly (readonly [RegExp, number])[] = [
  [/acre/i, 4046856422.4],
  [/hectare/i, 1e10],
  [/yard/i, 836127.36],
  [/f(oo|ee)t|ft/i, 92903.04],
  [/inch|in\b/i, 645.16],
  [/centim/i, 100],
  [/millim/i, 1],
  [/met(er|re)|m\b/i, 1e6],
];

export const areaUnit = (text: string): number => AREA_UNITS.find(([re]) => re.test(text))?.[1] ?? 1e6;
