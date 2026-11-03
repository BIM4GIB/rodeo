// ConnectCAD's Create Rack Elevation and Create Equipment Detail View: the racks selected (each row of
// them standing side by side and facing the same way together, rackElevationShapes.ts), or the
// equipment items and rack frames selected, drawn face on as viewports on a sheet layer, one for the
// front (its name ending /F) and one for the rear (/R), side by side on the sheet. Vectorworks makes
// section viewports of the 3D model; Rodeo's viewports draw only plans live, so each view's drawing is
// made into its annotations, as the racks and their equipment are when it's made, and its design
// layers are hidden. On a sheet with something on it already, the new views go to its right.

import type { Attributes, BBox, EditSession, NewShape, Pt } from "../../../core/index.ts";
import { attempt, setActiveLayer, setSelection, zoomToSelection } from "../../../app/commands.ts";
import { firstFree, NEW_SHEET, viewportClasses, viewportNamesTaken } from "../../../app/createViewport.ts";
import { appContext } from "../../../app/ext.ts";
import { colorMatcher } from "../../../app/pdfImport.ts";
import { store } from "../../../app/state.ts";
import { exitSymbol } from "../../../app/symbolEdit.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs } from "../../../app/toolPrefs.ts";
import { equipmentFaces, rackFronts } from "./equipmentItem.ts";
import { rackView } from "./equipmentRack.ts";
import { detailScale, equipmentDetail, rackElevation, rackRows, viewNames, type ElevationPart, type RackElevation } from "./rackElevationShapes.ts";
import type { Mounting } from "./rackShapes.ts";

/** on paper, mm: the margin round each view, the gap between views, and the names' writing at most in a rack elevation and a detail view */
const MARGIN_MM = 10;
const GAP_MM = 10;
const TEXT_MM = 2;
const DETAIL_TEXT_MM = 3.5;

/** each part's fill */
const FILL: Readonly<Record<ElevationPart, string>> = {
  frame: "#b3b3b3",
  rail: "#dcdcdc",
  item: "#ffffff",
  "frame-item": "#f0f0f0",
  module: "#ffffff",
  slot: "#f0f0f0",
  psu: "#c8c8c8",
  ear: "#e6e6e6",
  adapter: "#dde3ea",
};

/** the choices last made, for the next time */
export const elevationSettings = { front: true, rear: true };
export const detailSettings = { front: true, rear: true };

const hexToRgb = (hex: string): { r: number; g: number; b: number } => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });

/** A view drawn: at 1:scale, each group of rectangles and writing, and the box round them. */
interface Drawn {
  readonly scale: number;
  readonly racks: readonly RackElevation[];
  readonly box: BBox;
}

/**
 * A command's dialog and its views: Sheet Layer (Destination), Viewport Name (`oneName` for one
 * group, else `base`) and Views to Create; then for each group a front and/or rear view drawn by
 * `draw`, named from the name given (each group's `label` after it when there's more than one), on
 * the sheet in one undo step, selected and shown.
 */
async function faceViews<T>(title: string, groups: readonly T[], label: (g: T) => string, oneName: string, base: string, settings: { front: boolean; rear: boolean }, note: string | undefined, draw: (s: EditSession, g: T, side: Mounting) => Drawn): Promise<void> {
  const s = store.session;
  if (!s) return;
  const sheets = s.doc.layers().filter((l) => l.kind === "sheet");
  const v = await toolPrefs(
    title,
    [
      { kind: "choice", key: "sheet", label: "Sheet Layer (Destination)", value: NEW_SHEET, options: [...sheets.map((l) => ({ value: l.id, label: l.name })), { value: NEW_SHEET, label: "New Sheet Layer" }] },
      { kind: "text", key: "name", label: "Viewport Name", value: groups.length === 1 ? oneName : base },
      { kind: "heading", key: "views", label: "Views to Create" },
      { kind: "check", key: "front", label: "Front (/F after its name)", value: settings.front },
      { kind: "check", key: "rear", label: "Rear (/R after its name)", value: settings.rear },
    ],
    note,
  );
  if (!v || store.session !== s) return;
  settings.front = v.flag("front");
  settings.rear = v.flag("rear");
  const sides: Mounting[] = [...(v.flag("front") ? (["Front"] as const) : []), ...(v.flag("rear") ? (["Rear"] as const) : [])];
  if (!sides.length) {
    toast(`${title}: pick Front, Rear or both.`, "info");
    return;
  }
  const name = v.choice("name").trim() || base;
  exitSymbol();
  const r = attempt(title, (session) =>
    session.batch(() => {
      const sheetId = v.choice("sheet") === NEW_SHEET ? session.createLayer(firstFree("Sheet", new Set(session.doc.layers().map((l) => l.name))), "sheet") : v.choice("sheet");
      const taken = viewportNamesTaken(session.doc);
      const views = groups.flatMap((g) => {
        const names = viewNames(groups.length === 1 ? name : `${name} ${label(g)}`, sides, taken);
        names.forEach((n) => taken.add(n));
        return sides.map((side, k) => ({ name: names[k], ...draw(session, g, side) }));
      });
      return { sheetId, ids: placeViews(session, sheetId, views), names: views.map((w) => w.name) };
    }),
  );
  if (!r) return;
  if (store.activeLayerId !== r.value.sheetId) setActiveLayer(r.value.sheetId);
  setSelection(r.value.ids);
  const ctx = appContext();
  if (ctx) zoomToSelection(ctx.scene, ctx.view);
  const n = r.value.ids.length;
  toast(`${title}: ${n} viewport${n === 1 ? "" : "s"} made (${r.value.names.join(", ")}).`, "info");
}

/** Stage > ConnectCAD Layout > Create Rack Elevation: front and rear views of the selected racks on a sheet layer, at their layer's scale. */
export async function createRackElevation(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const racks = [...store.selection].flatMap((id) => {
    const r = rackView(s.doc, id);
    return r ? [r] : [];
  });
  if (!racks.length) {
    toast("Create Rack Elevation: select one or more equipment racks first.", "info");
    return;
  }
  const rows = rackRows(racks);
  const byId = new Map(racks.map((r) => [r.id, r]));
  const idsOf = (row: (typeof rows)[number]): string => row.map((p) => byId.get(p.id)!.rackId || "Rack").join(", ");
  const note = rows.length > 1 ? `The racks selected stand in ${rows.length} rows, so each row gets its own views, its racks' IDs after the name.` : undefined;
  await faceViews("Create Rack Elevation", rows, idsOf, idsOf(rows[0]), "Rack Elevation", elevationSettings, note, (session, row, side) => {
    const scale = session.doc.layers().find((l) => l.id === rackView(session.doc, row[0].id)?.layerId)?.scale || 1;
    const drawn = row.flatMap((p) => {
      const rack = rackView(session.doc, p.id);
      return rack ? [{ rackId: rack.rackId, size: rack.size, rails: rack.rails, offset: p.offset, pieces: rackFronts(session, p.id, side) }] : [];
    });
    return { scale, ...rackElevation(drawn, side, TEXT_MM * scale) };
  });
}

/** Stage > ConnectCAD Layout > Create Equipment Detail View: front and rear views of the selected equipment items and rack frames on a sheet layer, each at a scale it fits. */
export async function createEquipmentDetailView(): Promise<void> {
  const s = store.session;
  if (!s) return;
  const items = [...store.selection].flatMap((id) => {
    const f = equipmentFaces(s, id, "Front");
    return f ? [{ id, name: f.name }] : [];
  });
  if (!items.length) {
    toast("Create Equipment Detail View: select one or more equipment items or rack frames first.", "info");
    return;
  }
  const note = items.length > 1 ? "Each piece of equipment gets its own views, its name after the name." : undefined;
  await faceViews("Create Equipment Detail View", items, (i) => i.name || "Equipment", `Equipment Detail ${items[0].name}`.trim(), "Equipment Detail", detailSettings, note, (session, item, side) => {
    const faces = equipmentFaces(session, item.id, side) ?? { name: item.name, pieces: [] };
    const front = equipmentFaces(session, item.id, "Front")?.pieces ?? [];
    // both sides at the scale the front fits
    const width = Math.max(0, ...front.map((p) => p.x1 - p.x0));
    const height = Math.max(0, ...front.map((p) => p.z1 - p.z0));
    const scale = detailScale(width, height);
    return { scale, ...equipmentDetail(faces.name, faces.pieces, DETAIL_TEXT_MM * scale) };
  });
}

/** The right edge of what's on a sheet already, or null when it's empty. */
function sheetRight(s: EditSession, sheetId: string): number | null {
  let right = -Infinity;
  for (const o of s.doc.objects(sheetId)) {
    const b = o.parentId === null ? (s.doc.viewport(o.id)?.box ?? o.bounds) : undefined;
    if (b) right = Math.max(right, b.x1);
  }
  return Number.isFinite(right) ? right : null;
}

/** Each view as a viewport on the sheet, left to right (round its middle, or right of what's on it already), its drawing in its annotations, as part of a batch; the viewports. */
function placeViews(s: EditSession, sheetId: string, views: readonly (Drawn & { name: string })[]): string[] {
  const match = colorMatcher();
  const ink = (hex: string): number => match(hexToRgb(hex));
  const black = ink("#000000");
  const sized = views.map((d) => ({ ...d, width: (d.box.x1 - d.box.x0) / d.scale + 2 * MARGIN_MM, height: (d.box.y1 - d.box.y0) / d.scale + 2 * MARGIN_MM }));
  const total = sized.reduce((t, d) => t + d.width, 0) + GAP_MM * (sized.length - 1);
  const right = sheetRight(s, sheetId);
  let left = right === null ? -total / 2 : right + GAP_MM;
  return sized.map((d) => {
    const box = { x0: left, y0: -d.height / 2, x1: left + d.width, y1: d.height / 2 };
    left += d.width + GAP_MM;
    const mid = { x: (d.box.x0 + d.box.x1) / 2, y: (d.box.y0 + d.box.y1) / 2 };
    const id = s.createViewport(sheetId, { scale: d.scale, box, at: mid, layers: [], classes: viewportClasses(s.doc), classIndex: store.activeClassIndex });
    s.setObjectName(id, d.name);
    // annotations are at the sheet × the scale
    const centre = { x: ((box.x0 + box.x1) / 2) * d.scale, y: 0 };
    const place = (p: Pt): Pt => ({ x: p.x - mid.x + centre.x, y: p.y - mid.y + centre.y });
    const notes = s.doc.openAnnotations(id);
    if (!notes) throw new Error("The viewport's annotations couldn't be opened.");
    try {
      for (const group of d.racks) {
        const parts: { shape: NewShape; look: Partial<Attributes> }[] = [
          ...group.rects.map((q) => {
            const fill = ink(FILL[q.part]);
            return {
              shape: { kind: "polygon", points: [place({ x: q.x0, y: q.z0 }), place({ x: q.x1, y: q.z0 }), place({ x: q.x1, y: q.z1 }), place({ x: q.x0, y: q.z1 })], closed: true } as NewShape,
              look: { penFore: black, fillPattern: 1, fillFore: fill, fillBack: fill, fillOpacity: 100 },
            };
          }),
          // an empty adapter slot's crossed lines
          ...group.rects.flatMap((q) =>
            q.cross
              ? [
                  [place({ x: q.x0, y: q.z0 }), place({ x: q.x1, y: q.z1 })],
                  [place({ x: q.x0, y: q.z1 }), place({ x: q.x1, y: q.z0 })],
                ].map(([a, b]) => ({ shape: { kind: "line", a, b } as NewShape, look: { penFore: black } }))
              : [],
          ),
          ...group.texts.map((t) => ({ shape: { kind: "text", at: place(t.at), text: t.text, height: t.height, hAlign: 2, vAlign: 3, angle: 0 } as NewShape, look: { penFore: black, fillPattern: 0 } })),
        ];
        const ids = s.addObjects(
          notes,
          parts.map((p) => p.shape),
          store.activeClassIndex,
          parts.map((p) => p.look),
        );
        if (ids.length > 1) s.groupObjects(ids);
      }
    } finally {
      s.doc.openAnnotations(null);
    }
    return id;
  });
}
