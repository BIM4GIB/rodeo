// Vectorworks Landmark's plug-in objects in a drawing it saved (plants, existing trees, hardscapes,
// landscape areas, massing models…): Object Info shows each kind's parameters as a landscape architect
// reads them, a group at a time, the rest under Other Parameters. A change is kept in its parameters;
// one that changes what it draws (a tree's canopy, a hardscape's outline) draws it again Rodeo's way,
// as Site Planning's own tools draw, for the kinds that say how (draws, redraw). Until then, and for
// the rest, it shows as Vectorworks drew it, and Reset All Plug-Ins leaves it so.

import type { EditSession, Pt, RecordValue } from "../../core/index.ts";
import { attempt } from "../../app/commands.ts";
import type { PluginDriver, PluginWidget } from "../../app/ext.ts";
import { store } from "../../app/state.ts";
import { errorMessage, toast } from "../../app/toast.ts";
import { frameOf, pathOf, paramsOf, type Params } from "./read.ts";


export interface Group {
  readonly title: string;
  readonly fields: readonly string[];
}

export interface LandmarkKind {
  /** the plug-in, as its parameters' record is named */
  readonly name: string;
  /** what Object Info says over its parameters */
  readonly note: string;
  /** its parameters a group at a time; the rest follow under Other Parameters */
  readonly groups: readonly Group[];
  /** what Landmark's Object Info calls parameters whose names say less */
  readonly labels?: Readonly<Record<string, string>>;
  /** parameters it works out itself (areas, counts): shown, not typed */
  readonly computed?: readonly string[];
  /** popups' choices, as far as Rodeo knows them (what an object holds is offered too) */
  readonly choices?: Readonly<Record<string, readonly string[]>>;
  /** parameters whose change draws it again */
  readonly draws?: readonly string[];
  /** Draws it again from its parameters, as set. */
  redraw?(s: EditSession, p: Params): void;
  /** What follows elsewhere from `values`, now set, which were `before` (a plant's Plant Record). */
  follow?(s: EditSession, before: Params, values: Readonly<Record<string, RecordValue>>): void;
  /** drawn along a path (its path group's): Reshape moves its corners and it is drawn again */
  readonly path?: { readonly closed: boolean };
}

/** Parameters left out of Other Parameters: the handles Landmark drags (ControlPoint01X…) and the internal ones. */
const HIDDEN = /^(controlpoint\d+[xy]|__)/i;




/** Moves a path plug-in's corners to `corners` on the drawing. */
function setPathOf(s: EditSession, id: string, corners: readonly Pt[], closed: boolean): void {
  const pathId = s.doc.pluginPath(id);
  const shape = pathId ? s.doc.object(pathId)?.shape : undefined;
  if (!pathId || !shape || (shape.kind !== "polyline" && shape.kind !== "polygon")) throw new Error("It has no path to reshape.");
  // kept in the plug-in's own frame, as Vectorworks keeps it
  const { toLocal } = frameOf(s.doc, id);
  const points = corners.map(toLocal);
  if (shape.kind === "polygon") s.setGeometry(pathId, { kind: "polygon", points, closed });
  else s.setGeometry(pathId, { kind: "polyline", points, closed, vertices: points.map(() => "corner"), radii: points.map(() => 0) });
}

function layout(kind: LandmarkKind, fields: readonly string[]): PluginWidget[] {
  const have = new Map(fields.map((f): [string, string] => [f.toLowerCase(), f]));
  const out: PluginWidget[] = [];
  const listed = new Set<string>();
  let n = 0;
  for (const group of kind.groups) {
    const rows = group.fields.flatMap((f) => {
      const name = have.get(f.toLowerCase());
      if (!name || listed.has(name)) return [];
      listed.add(name);
      return [{ id: ++n, kind: "param", field: name, label: "", level: 0 } as const];
    });
    if (rows.length) out.push({ id: ++n, kind: "divider", label: group.title, level: 0 }, ...rows);
  }
  const rest = fields.filter((f) => !listed.has(f) && !HIDDEN.test(f));
  if (rest.length) out.push({ id: ++n, kind: "divider", label: "Other Parameters", level: 0 }, ...rest.map((field): PluginWidget => ({ id: ++n, kind: "param", field, label: "", level: 0 })));
  return out;
}

/** The driver Object Info, Reshape and Reset All Plug-Ins use for a Landmark kind. */
export function landmarkDriver(kind: LandmarkKind): PluginDriver {
  const lower = (list: readonly string[] = []): Set<string> => new Set(list.map((f) => f.toLowerCase()));
  const computed = lower(kind.computed);
  const draws = lower(kind.draws);
  const labels = new Map(Object.entries(kind.labels ?? {}).map(([k, v]): [string, string] => [k.toLowerCase(), v]));
  const choices = new Map(Object.entries(kind.choices ?? {}).map(([k, v]): [string, readonly string[]] => [k.toLowerCase(), v]));
  const params = (s: EditSession, id: string): Params => {
    const p = paramsOf(s.doc, id, kind.name);
    if (!p) throw new Error(`That isn't a ${kind.name} object.`);
    return p;
  };
  const write = (s: EditSession, id: string, values: Readonly<Record<string, RecordValue>>): void => {
    const before = params(s, id);
    for (const [field, value] of Object.entries(values)) s.setRecordField(id, before.format, field, value);
    kind.follow?.(s, before, values);
    if (kind.redraw && Object.keys(values).some((f) => draws.has(f.toLowerCase()))) kind.redraw(s, params(s, id));
  };
  return {
    name: kind.name,
    shape: "point",
    builtIn: true,
    note: kind.note,
    resets: false,
    label: (field) => labels.get(field.toLowerCase()),
    readOnly: (field) => computed.has(field.toLowerCase()),
    choices: (field) => choices.get(field.toLowerCase())?.map((value) => ({ value, label: value })),
    place: () => toast(`Rodeo doesn't place Vectorworks' ${kind.name} objects; Site Planning's tools draw their like.`, "info"),
    edit(id, values) {
      attempt(`Edit ${kind.name}`, (s) => s.batch(() => write(s, id, values)));
    },
    async reset(id) {
      const s = store.session;
      if (!s) return "No drawing is open.";
      if (!kind.redraw) return "Vectorworks draws it; Rodeo shows it as saved.";
      try {
        s.batch(() => kind.redraw!(s, params(s, id)));
        return null;
      } catch (err) {
        return errorMessage(err);
      }
    },
    layout: (_ready, rec) => (rec ? layout(kind, rec.fields.map((f) => f.name)) : null),
    widgetStates: () => {},
    press: () => {},
    ...(kind.path && kind.redraw
      ? {
          path(id: string) {
            const doc = store.session?.doc;
            const points = doc ? pathOf(doc, id) : null;
            return points ? { points, closed: kind.path!.closed } : null;
          },
          setPath(s: EditSession, id: string, corners: readonly Pt[]) {
            setPathOf(s, id, corners, kind.path!.closed);
            kind.redraw!(s, params(s, id));
          },
        }
      : {}),
  };
}
