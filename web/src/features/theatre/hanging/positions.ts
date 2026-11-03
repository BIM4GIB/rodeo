// The hanging positions in the open drawing, read once per change of it, for what places a load to find the
// one it goes on. A device belongs to a position by its Position field holding the name (hangingPosition.ts).

import { appContext } from "../../../app/ext.ts";
import { store } from "../../../app/state.ts";
import type { BBox, EditSession, ObjectInfo, Pt, VwxDocument } from "../../../core/index.ts";
import { NUMBER_DIRECTIONS, positionUnder, type NumberDirection } from "./numbering.ts";

export const HANGING_POSITION = "Hanging Position";

export const FIELD = {
  name: "Position Name",
  location: "Location",
  show: "Show Name",
  trim: "Trim Height",
  start: "Starting Number",
  step: "Increment",
  direction: "Numbering Direction",
  symbol: "Symbol Name",
  labelX: "Label Location X",
  labelY: "Label Location Y",
  weight: "Total Hung Weight",
} as const;

/** a load placed this near a position's box goes on it, mm */
export const ATTACH_MM = 150;

export interface HangingPosition {
  readonly id: string;
  readonly layerId: string;
  readonly name: string;
  readonly trim: number;
  readonly start: number;
  readonly step: number;
  readonly direction: NumberDirection;
  /** what it covers in plan */
  readonly box: BBox;
}

/** What a top-level object and all it holds cover in plan, or null when it isn't drawn. */
export function boxOf(o: ObjectInfo): BBox | null {
  return appContext()?.scene.topLevelEntries(o.layerId, null).find((e) => e.id === o.id)?.bbox ?? null;
}

function read(doc: VwxDocument): HangingPosition[] {
  const out: HangingPosition[] = [];
  for (const layer of doc.layers()) {
    if (layer.kind === "sheet") continue;
    for (const o of doc.objects(layer.id)) {
      if (!o.insertion) continue;
      const rec = doc.records(o.id).find((r) => r.parametric && r.name === HANGING_POSITION);
      const box = rec && boxOf(o);
      if (!rec || !box) continue;
      const value = (field: string): unknown => rec.fields.find((f) => f.name === field)?.value;
      const direction = NUMBER_DIRECTIONS.find((d) => d === value(FIELD.direction)) ?? NUMBER_DIRECTIONS[0];
      const step = Number(value(FIELD.step));
      out.push({
        id: o.id,
        layerId: layer.id,
        name: String(value(FIELD.name) ?? "").trim(),
        trim: Number(value(FIELD.trim)) || 0,
        start: Number(value(FIELD.start)) || 0,
        step: Number.isFinite(step) ? step : 1,
        direction,
        box,
      });
    }
  }
  return out;
}

let memo: { session: EditSession; list: readonly HangingPosition[] } | null = null;
const watched = new WeakSet<EditSession>();

/** Every hanging position in the open drawing. */
export function hangingPositions(): readonly HangingPosition[] {
  const s = store.session;
  if (!s) return [];
  if (memo?.session === s) return memo.list;
  if (!watched.has(s)) {
    watched.add(s);
    s.onChange(() => {
      if (memo?.session === s) memo = null;
    });
  }
  const list = read(s.doc);
  memo = { session: s, list };
  return list;
}

/** The position a load placed at `p` goes on, or null. */
export function positionAt(p: Pt): HangingPosition | null {
  return positionUnder(hangingPositions(), p, ATTACH_MM);
}
