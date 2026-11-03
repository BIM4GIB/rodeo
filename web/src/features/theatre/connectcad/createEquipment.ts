// ConnectCAD Layout > Create Equipment: equipment (equipmentItem.ts) on the active layer for each
// device name on the chosen layers that has none yet, linked to its devices and placed where the
// device's Location says: at its Rack U in its rack (stacked below the rack when that's taken or it
// has no unit), round the inside of its layout room's walls, or, with no location, round the drawing
// (rack equipment down its left, the rest along its top). Locations the drawing hasn't are listed
// first, to create the equipment anyway, round the drawing, or leave those devices out.

import "./connectcad.css";
import type { BBox, EditSession } from "../../../core/index.ts";
import { attempt, setSelection } from "../../../app/commands.ts";
import { h } from "../../../app/dom.ts";
import { appContext } from "../../../app/ext.ts";
import { showDialog } from "../../../app/menubar.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { addEquipmentFor, belowRack, equipmentSize, itemNames, unitsFree } from "./equipmentItem.ts";
import { rackNamed, rackPlace } from "./equipmentRack.ts";
import { layoutRooms } from "./layoutRoom.ts";
import { roundDrawing, roundRoom } from "./layoutShapes.ts";
import { mountFace } from "./rackShapes.ts";
import { devicesOn, plainDevice, type Device } from "./schematic.ts";

/** between pieces of equipment, and off the drawing, mm */
const GAP = 100;

/** A device name to make equipment for, and where its device asks for it, with what of that the drawing hasn't. */
interface Wanted {
  readonly name: string;
  readonly room: string;
  readonly rack: string;
  readonly u: number | null;
  readonly missing: { readonly room: boolean; readonly rack: boolean; readonly u: boolean };
}

const lost = (w: Wanted): boolean => w.missing.room || w.missing.rack || w.missing.u;

/** Where the devices of the chosen layers ask for equipment, a name once, those with equipment already left out. */
function wantedOf(s: EditSession, devices: readonly Device[]): Wanted[] {
  const have = itemNames(s.doc);
  const rooms = layoutRooms(s.doc);
  const seen = new Set<string>();
  const out: Wanted[] = [];
  for (const d of devices) {
    const name = d.name.trim();
    if (!name || have.has(name) || seen.has(name)) continue;
    seen.add(name);
    const room = String(d.rec.value("Room") ?? "").trim();
    const rack = String(d.rec.value("Rack") ?? "").trim();
    const text = String(d.rec.value("Rack U") ?? "").trim();
    const u = text && Number.isFinite(Number(text)) ? Math.round(Number(text)) : null;
    const rackObj = rack ? rackNamed(s.doc, rack) : null;
    const place = rackObj ? rackPlace(s.doc, rackObj) : null;
    const units = place ? mountFace(place.size, "Front").units : 0;
    out.push({
      name,
      room,
      rack,
      u,
      missing: {
        room: !rack && !!room && !rooms.some((r) => r.id && (r.id === room || room.split(".").pop() === r.id)),
        rack: !!rack && !rackObj,
        u: !!place && u !== null && (u < 1 || u > units),
      },
    });
  }
  return out;
}

/** The bounds of what's drawn on the design layers, or a point at the origin for an empty drawing. */
function drawingBox(s: EditSession): BBox {
  const scene = appContext()?.scene;
  let box: BBox | null = null;
  for (const l of s.doc.layers()) {
    if (l.kind !== "design" || !scene) continue;
    for (const e of scene.topLevelEntries(l.id, null)) {
      const b = e.bbox;
      if (b) box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
    }
  }
  return box ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
}

/** The Create Equipment dialog: the layers whose devices count, and whether only the selected ones do. */
function chooseLayers(byLayer: ReadonlyMap<string, readonly Device[]>, anySelected: boolean): Promise<{ layers: string[]; selectedOnly: boolean } | null> {
  const s = store.session!;
  const names = new Map(s.doc.layers().map((l) => [l.id, l.name]));
  const boxes = [...byLayer].map(([layerId, devices]) => {
    const box = h("input", { attrs: { type: "checkbox", "aria-label": `Use ${names.get(layerId) ?? ""}` } }) as HTMLInputElement;
    box.checked = true;
    return { layerId, box, row: h("tr", {}, h("td", { cls: "ccad-centre" }, box), h("td", { text: names.get(layerId) ?? "" }), h("td", { text: String(devices.length) })) };
  });
  const selectedOnly = h("input", { attrs: { type: "checkbox", "aria-label": "Selected devices only" } }) as HTMLInputElement;
  selectedOnly.checked = anySelected;
  const button = (text: string, on: boolean): HTMLButtonElement => {
    const el = h("button", { cls: "btn", text, attrs: { type: "button" } });
    el.addEventListener("click", () => {
      for (const b of boxes) b.box.checked = on;
    });
    return el;
  };
  return showDialog<{ layers: string[]; selectedOnly: boolean }>({
    title: "Create Equipment",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, h("th", { text: "Use" }), h("th", { text: "Layer" }), h("th", { text: "Devices" }))), h("tbody", {}, ...boxes.map((b) => b.row)))),
      h("div", { cls: "ccad-actions" }, button("Select All Layers", true), button("Deselect All Layers", false)),
      h("label", { cls: "menu-dialog-check" }, selectedOnly, h("span", { text: "Selected devices only" })),
      h("p", { cls: "muted", text: "Equipment goes on the active layer, one for each device name that has none yet, linked to its devices. A device's Room, Rack and Rack U place it: at its unit in its rack (below the rack when that's taken or it has no unit), round the walls of its layout room, or, with none, round the drawing: rack equipment down the left, the rest along the top." }),
    ],
    check: () => {
      const layers = boxes.filter((b) => b.box.checked).map((b) => b.layerId);
      if (!layers.length) return { error: "Choose a layer with devices.", focus: boxes[0]?.box };
      return { value: { layers, selectedOnly: selectedOnly.checked } };
    },
  });
}

/** The Missing Locations dialog: whether to make equipment for the devices whose locations the drawing hasn't (round the drawing), or leave them out. */
function missingLocations(wanted: readonly Wanted[]): Promise<boolean | null> {
  const cell = (text: string, missing: boolean) => h("td", { cls: missing ? "ccad-missing" : "", text });
  const rows = wanted.filter(lost).map((w) => h("tr", {}, h("td", { text: w.name }), cell(w.room, w.missing.room), cell(w.rack, w.missing.rack), cell(w.u === null ? "" : String(w.u), w.missing.u)));
  const choice = h("select", { cls: "menu-dialog-input menu-dialog-select wide", attrs: { "aria-label": "These devices" } }, h("option", { value: "create", text: "Create Anyway, round the drawing" }), h("option", { value: "skip", text: "Leave them out" })) as HTMLSelectElement;
  return showDialog<boolean>({
    title: "Missing Locations",
    okLabel: "OK",
    cls: "ccad-dialog",
    body: [
      h("p", { cls: "muted", text: "These devices ask for locations the drawing hasn't (in red): no layout room, rack or rack unit of that name." }),
      h("div", { cls: "ccad-scroll" }, h("table", { cls: "ccad-table" }, h("thead", {}, h("tr", {}, h("th", { text: "Device" }), h("th", { text: "Room" }), h("th", { text: "Rack" }), h("th", { text: "Rack U" }))), h("tbody", {}, ...rows))),
      h("label", { cls: "menu-dialog-field" }, h("span", { cls: "menu-dialog-label", text: "These devices" }), choice),
    ],
    check: () => ({ value: choice.value === "create" }),
  });
}

/** Makes the equipment, in the session's open batch: what was made, and how many went in racks, rooms and round the drawing. */
function makeEquipment(s: EditSession, layerId: string, wanted: readonly Wanted[], box: BBox): { made: string[]; racked: number; roomed: number; around: number } {
  const made: string[] = [];
  const rooms = layoutRooms(s.doc);
  const inRooms = new Map<string, Wanted[]>();
  const around: Wanted[] = [];
  let racked = 0;
  for (const w of wanted) {
    const rack = !lost(w) && w.rack ? rackNamed(s.doc, w.rack) : null;
    if (rack) {
      const size = equipmentSize(s, w.name);
      const u = w.u !== null && w.u >= 1 && unitsFree(s.doc, w.rack, w.u, size.units, size.rackWidth) ? w.u : belowRack(s.doc, w.rack);
      made.push(addEquipmentFor(s, layerId, w.name, { x: 0, y: 0 }, 0, rack, u));
      racked++;
    } else if (!lost(w) && w.room) {
      const room = rooms.find((r) => r.id && (r.id === w.room || w.room.split(".").pop() === r.id))!;
      inRooms.set(room.objectId, [...(inRooms.get(room.objectId) ?? []), w]);
    } else around.push(w);
  }
  let roomed = 0;
  for (const [objectId, list] of inRooms) {
    const ring = rooms.find((r) => r.objectId === objectId)!.ring;
    const spots = roundRoom(ring, list.map((w) => equipmentSize(s, w.name)), GAP);
    list.forEach((w, k) => made.push(addEquipmentFor(s, layerId, w.name, spots[k].at, spots[k].angle, null, 0)));
    roomed += list.length;
  }
  const sizes = around.map((w) => equipmentSize(s, w.name));
  const spots = roundDrawing(box, sizes.map((z) => ({ ...z, rack: z.rackWidth !== "Non-rack" })), GAP);
  around.forEach((w, k) => made.push(addEquipmentFor(s, layerId, w.name, spots[k].at, spots[k].angle, null, 0, w.missing.rack ? w.rack : "")));
  return { made, racked, roomed, around: around.length };
}

/** Create Equipment: equipment for the chosen layers' devices that have none, selected. */
export async function createEquipment(): Promise<void> {
  const s = store.session;
  const layerId = store.activeLayerId;
  if (!s || !layerId) return;
  const devices = devicesOn(s).filter((d) => plainDevice(s, d.rec.id));
  if (!devices.length) {
    toast("Create Equipment: the drawing has no devices.", "info");
    return;
  }
  const byLayer = new Map<string, Device[]>();
  for (const d of devices) byLayer.set(d.rec.layerId, [...(byLayer.get(d.rec.layerId) ?? []), d]);
  const chosen = await chooseLayers(byLayer, devices.some((d) => store.selection.has(d.rec.id)));
  if (!chosen || store.session !== s) return;
  const from = devices.filter((d) => chosen.layers.includes(d.rec.layerId) && (!chosen.selectedOnly || store.selection.has(d.rec.id)));
  let wanted = wantedOf(s, from);
  if (!wanted.length) {
    toast(from.some((d) => d.name.trim()) ? "Create Equipment: every device there has its equipment already." : "Create Equipment: the devices there have no names.", "info");
    return;
  }
  let skipped = 0;
  if (wanted.some(lost)) {
    const anyway = await missingLocations(wanted);
    if (anyway === null || store.session !== s) return;
    if (!anyway) {
      skipped = wanted.filter(lost).length;
      wanted = wanted.filter((w) => !lost(w));
    }
  }
  const left = skipped ? `; ${skipped} device${skipped === 1 ? "" : "s"} left out for missing locations` : "";
  if (!wanted.length) {
    toast(`Create Equipment: none made${left}.`, "info");
    return;
  }
  const box = drawingBox(s);
  const r = attempt("Create Equipment", (session) => session.batch(() => makeEquipment(session, layerId, wanted, box)));
  if (!r) return;
  setSelection(r.value.made);
  const where = [r.value.racked && `${r.value.racked} in racks`, r.value.roomed && `${r.value.roomed} in rooms`, r.value.around && `${r.value.around} round the drawing`].filter(Boolean).join(", ");
  toast(`Create Equipment: ${r.value.made.length} made (${where})${left}.`, "info");
}
