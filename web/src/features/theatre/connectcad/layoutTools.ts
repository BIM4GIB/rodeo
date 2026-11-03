// The ConnectCAD Layout tool set's own tools: Layout Room, an outline (a rectangle or a polygon) made
// a layout room (layoutRoom.ts), Equipment Rack 3D, two clicks for a rack (equipmentRack.ts),
// Equipment Item, a click for equipment in a rack or on its own, Rack Frame, a click for a frame
// modular equipment goes into (equipmentItem.ts), Adapter Slot, a click on equipment for its adapter
// slots (adapterSlots.ts), and Make Rack Equipment Worksheet, a click for a rack's contents worksheet
// (rackWorksheet.ts).

import type { Pt, VwxDocument } from "../../../core/index.ts";
import { store } from "../../../app/state.ts";
import { toast } from "../../../app/toast.ts";
import { toolPrefs, type PrefField } from "../../../app/toolPrefs.ts";
import { BaseTool, modeForKey, strokeScreen, withPreview, type Painter, type PointerInfo, type ToolModes } from "../../../app/tools.ts";
import { OutlineTool } from "../../../app/tools/planning.ts";
import { adapterSlotSettings, editAdapterSlots } from "./adapterSlots.ts";
import { SLOT_MODES, type SlotMode } from "./adapterSlotShapes.ts";
import { equipmentAt, frameSettings, itemPreview, itemSettings, placeEquipmentItem, placeRackFrame, RACK_WIDTHS, type RackWidth } from "./equipmentItem.ts";
import { newRackSize, placeEquipmentRack, rackSettings } from "./equipmentRack.ts";
import { layoutRoomSettings, placeLayoutRoom } from "./layoutRoom.ts";
import { makeRackWorksheet } from "./rackWorksheet.ts";
import { FRAME_TYPES, MOUNTINGS, PSU_SIDES, RACK_OPENINGS, RACK_STYLES, rackOverall, SLOT_DIRECTIONS, type FrameType, type Mounting, type PsuSide, type RackStyle, type SlotDirection } from "./rackShapes.ts";

export class LayoutRoomTool extends OutlineTool {
  readonly id = "cclayoutroom";
  protected readonly modeLabel = "Layout Room";

  async preferences(): Promise<void> {
    const k = layoutRoomSettings;
    const v = await toolPrefs(
      "Layout Room Preferences",
      [
        { kind: "text", key: "id", label: "Room ID", value: k.id },
        { kind: "length", key: "height", label: "Height", value: k.height, zero: true },
        { kind: "check", key: "flat", label: "2D only", value: k.flat },
      ],
      "A layout room holds equipment racks: a rack placed inside it takes its Room ID, and rooms inside rooms join their IDs with dots, the outer first (MAIN.AV1). A new room's ID is numbered on when another room has it. Unless it's 2D only, a room shows its walls up to its Height in 3D.",
    );
    if (!v) return;
    k.id = v.choice("id");
    k.height = v.num("height");
    k.flat = v.flag("flat");
  }

  protected made(corners: Pt[]): void {
    const layerId = store.activeLayerId;
    if (layerId) placeLayoutRoom(layerId, corners);
  }
}

/** The Equipment Rack 3D tool: a click for the middle of a rack's front, a click toward where it faces. */
export class EquipmentRackTool extends BaseTool {
  readonly id = "ccrack";
  readonly cursor = "crosshair";
  private at: Pt | null = null;
  private pointer: Pt | null = null;
  /** the drawing whose racks the Preferences were last asked for */
  private asked: VwxDocument | null = null;

  async preferences(): Promise<void> {
    await this.ask();
  }

  /** The Preferences dialog: whether it was OKed. */
  private async ask(): Promise<boolean> {
    const k = rackSettings;
    const choice = (key: string, label: string, value: string, options: readonly string[]): PrefField => ({ kind: "choice", key, label, value, options: options.map((o) => ({ value: o, label: o })) });
    const v = await toolPrefs(
      "Equipment Rack 3D Preferences",
      [
        { kind: "text", key: "id", label: "Rack ID", value: k.id },
        { kind: "text", key: "make", label: "Make", value: k.make },
        { kind: "text", key: "model", label: "Model", value: k.model },
        choice("opening", "Rack Opening", k.opening, RACK_OPENINGS.map((o) => o.label)),
        { kind: "number", key: "units", label: "Height", value: k.units, min: 1, max: 100, integer: true, unit: "RU" },
        { kind: "length", key: "depth", label: "Depth", value: k.depth },
        choice("style", "Rack Style", k.style, RACK_STYLES),
        { kind: "number", key: "weight", label: "Weight of Rack (kg)", value: k.rackWeight, min: 0, max: 100000 },
        { kind: "check", key: "rails", label: "Draw Rails", value: k.rails },
        { kind: "check", key: "sidePanels", label: "Draw Side Panels", value: k.sidePanels },
        { kind: "check", key: "frontDoor", label: "Draw Front Door", value: k.frontDoor },
        { kind: "check", key: "rearDoor", label: "Draw Rear Door", value: k.rearDoor },
      ],
      "Click where the middle of the rack's front goes, then click toward where it faces. Equipment and devices whose Rack is its Rack ID count in its power and total weight, and it takes the Room ID of the layout room it stands in. A new rack's ID is numbered on when another rack has it. Its frame and a custom opening are set in its Object Info.",
    );
    if (!v) return false;
    k.id = v.choice("id");
    k.make = v.choice("make");
    k.model = v.choice("model");
    k.opening = v.choice("opening");
    k.units = v.num("units");
    k.depth = v.num("depth");
    k.style = v.choice("style") as RackStyle;
    k.rackWeight = v.num("weight");
    k.rails = v.flag("rails");
    k.sidePanels = v.flag("sidePanels");
    k.frontDoor = v.flag("frontDoor");
    k.rearDoor = v.flag("rearDoor");
    this.asked = store.session?.doc ?? null;
    return true;
  }

  hint(): string {
    return this.at ? "Click toward where the rack faces · Esc cancels" : "Click where the middle of the rack's front goes";
  }

  snapFrom(): Pt | null {
    return this.at;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  /** degrees the rack turns so its front faces from the first click toward `p` */
  private angle(p: Pt): number {
    const a = this.at;
    if (!a || Math.hypot(p.x - a.x, p.y - a.y) < 1e-6) return 0;
    return (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI + 90;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (!layerId) return;
    if (!this.at) {
      this.at = p.pos;
      return;
    }
    const at = this.at;
    const angle = this.angle(p.pos);
    this.at = null;
    void this.place(layerId, at, angle);
  }

  private async place(layerId: string, at: Pt, angle: number): Promise<void> {
    const session = store.session;
    if (!session) return;
    // the Preferences the first time it's used in a drawing
    if (this.asked !== session.doc && (!(await this.ask()) || store.session !== session)) return;
    placeEquipmentRack(layerId, at, angle);
  }

  cancel(): void {
    this.at = null;
  }

  key(e: KeyboardEvent): boolean {
    if (e.key !== "Escape" || !this.at) return false;
    this.at = null;
    return true;
  }

  overlay(g: Painter): void {
    const at = this.at ?? this.pointer;
    if (!at) return;
    const { width, depth } = rackOverall(newRackSize());
    const t = (this.at && this.pointer ? this.angle(this.pointer) : 0) * (Math.PI / 180);
    const turn = (q: Pt): Pt => ({ x: at.x + q.x * Math.cos(t) - q.y * Math.sin(t), y: at.y + q.x * Math.sin(t) + q.y * Math.cos(t) });
    withPreview(g, () => {
      strokeScreen(
        g,
        [
          { x: -width / 2, y: 0 },
          { x: width / 2, y: 0 },
          { x: width / 2, y: depth },
          { x: -width / 2, y: depth },
        ].map(turn),
        true,
      );
      if (this.at && this.pointer) strokeScreen(g, [this.at, this.pointer], false);
    });
  }
}

/** The Equipment Item tool: a click over a rack puts equipment in it at the first free unit from the top, anywhere else stands it alone, its front's middle at the click. */
export class EquipmentItemTool extends BaseTool {
  readonly id = "ccequip";
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;
  /** the drawing whose equipment the Preferences were last asked for */
  private asked: VwxDocument | null = null;

  async preferences(): Promise<void> {
    await this.ask();
  }

  /** The Preferences dialog: whether it was OKed. */
  private async ask(): Promise<boolean> {
    const k = itemSettings;
    const choice = (key: string, label: string, value: string, options: readonly string[]): PrefField => ({ kind: "choice", key, label, value, options: options.map((o) => ({ value: o, label: o })) });
    const v = await toolPrefs(
      "Equipment Item Preferences",
      [
        { kind: "text", key: "name", label: "Name", value: k.name },
        { kind: "check", key: "link", label: "Link device name", value: k.link },
        { kind: "text", key: "make", label: "Make", value: k.make },
        { kind: "text", key: "model", label: "Model", value: k.model },
        { kind: "length", key: "height", label: "Height", value: k.height },
        { kind: "length", key: "width", label: "Width", value: k.width },
        { kind: "length", key: "depth", label: "Depth", value: k.depth },
        { kind: "number", key: "power", label: "Power (W)", value: k.power, min: 0, max: 1000000 },
        { kind: "number", key: "weight", label: "Weight (kg)", value: k.weight, min: 0, max: 100000 },
        { kind: "number", key: "ru", label: "Height RU", value: k.ru, min: 1, max: 100, integer: true, unit: "RU" },
        choice("rackWidth", "Rack Width", k.rackWidth, RACK_WIDTHS),
        choice("mounting", "Mounting", k.mounting, MOUNTINGS),
        { kind: "length", key: "mountDepth", label: "Mounting Depth", value: k.mountDepth, zero: true },
        { kind: "check", key: "showText", label: "Show text", value: k.showText },
        { kind: "check", key: "modular", label: "Modular", value: k.modular },
        { kind: "number", key: "slots", label: "Number of Slots", value: k.slots, min: 1, max: 100, integer: true },
      ],
      "Click over an equipment rack to put equipment in it at the first free unit from the top, on its front or rear, or anywhere else for equipment on its own. Full and Half equipment is as wide as the rack's opening or half of it; Modular equipment goes into the first rack frame there with that many slots free. Named after a device on the schematic, with Link device name, it takes the device's make and model and keeps the device's physical and location data. A new item's name is numbered on when other equipment has it.",
    );
    if (!v) return false;
    k.name = v.choice("name");
    k.link = v.flag("link");
    k.make = v.choice("make");
    k.model = v.choice("model");
    k.height = v.num("height");
    k.width = v.num("width");
    k.depth = v.num("depth");
    k.power = v.num("power");
    k.weight = v.num("weight");
    k.ru = v.num("ru");
    k.rackWidth = v.choice("rackWidth") as RackWidth;
    k.mounting = v.choice("mounting") as Mounting;
    k.mountDepth = v.num("mountDepth");
    k.showText = v.flag("showText");
    k.modular = v.flag("modular");
    k.slots = v.num("slots");
    this.asked = store.session?.doc ?? null;
    return true;
  }

  hint(): string {
    return "Click over a rack to put equipment in it, or anywhere for equipment on its own";
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (layerId) void this.place(layerId, p.pos);
  }

  private async place(layerId: string, at: Pt): Promise<void> {
    const session = store.session;
    if (!session) return;
    // the Preferences the first time it's used in a drawing
    if (this.asked !== session.doc && (!(await this.ask()) || store.session !== session)) return;
    placeEquipmentItem(layerId, at);
  }

  overlay(g: Painter): void {
    const doc = store.session?.doc;
    if (!this.pointer || !doc) return;
    const outline = itemPreview(doc, this.pointer);
    withPreview(g, () => strokeScreen(g, outline, true));
  }
}

const SIDE_MODES = MOUNTINGS.map((m) => ({ id: m, label: m }));

/** The Adapter Slot tool: a click on an equipment item opens its front or rear, to place adapter slots in it (adapterSlots.ts). */
export class AdapterSlotTool extends BaseTool {
  readonly id = "ccadapterslot";
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;

  modes(): readonly ToolModes[] {
    return [
      { label: "Placement", options: SLOT_MODES, active: adapterSlotSettings.mode },
      { label: "Location", options: SIDE_MODES, active: adapterSlotSettings.side },
    ];
  }

  setMode(id: string): void {
    if (SLOT_MODES.some((m) => m.id === id)) adapterSlotSettings.mode = id as SlotMode;
    else if (MOUNTINGS.includes(id as Mounting)) adapterSlotSettings.side = id as Mounting;
  }

  key(e: KeyboardEvent): boolean {
    const mode = modeForKey(e, this.modes());
    if (!mode) return false;
    this.setMode(mode);
    return true;
  }

  async preferences(): Promise<void> {
    const k = adapterSlotSettings;
    const v = await toolPrefs(
      "Adapter Slot Preferences",
      [
        { kind: "text", key: "socket", label: "Socket", value: k.socket },
        { kind: "length", key: "width", label: "Width", value: k.width },
        { kind: "length", key: "height", label: "Height", value: k.height },
      ],
      "Adapter slots model equipment made of a main unit and plug-in modules. Click an equipment item to open its front or rear and place slots on it: one a click, or in Linear Array and Rectangular Array a row or a block between two clicks. A slot named as a socket of the device of the equipment's name stands for it and shows the adapter on it; the Socket here names slots of equipment with no such device, numbered on along an array.",
    );
    if (!v) return;
    k.socket = v.choice("socket").trim() || "SLOT1";
    k.width = v.num("width");
    k.height = v.num("height");
  }

  hint(): string {
    return `Click an equipment item to place adapter slots on its ${adapterSlotSettings.side === "Rear" ? "rear" : "front"}`;
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const doc = store.session?.doc;
    if (!doc) return;
    const hit = equipmentAt(doc, p.pos);
    if (!hit) toast("Adapter Slot: click an equipment item.", "info");
    else if (hit.frame) toast("Adapter Slot: a rack frame takes modular equipment in its slots; adapter slots go in equipment items.", "info");
    else void editAdapterSlots(hit.id);
  }

  overlay(g: Painter): void {
    const doc = store.session?.doc;
    const hit = this.pointer && doc ? equipmentAt(doc, this.pointer) : null;
    if (hit && !hit.frame) withPreview(g, () => strokeScreen(g, hit.ring, true));
  }
}

/** The Rack Frame tool: a click over a rack puts a frame in it at the first free unit from the top, anywhere else stands it alone. */
export class RackFrameTool extends BaseTool {
  readonly id = "ccrackframe";
  readonly cursor = "crosshair";
  private pointer: Pt | null = null;
  /** the drawing whose frames the Preferences were last asked for */
  private asked: VwxDocument | null = null;

  async preferences(): Promise<void> {
    await this.ask();
  }

  /** The Preferences dialog: whether it was OKed. */
  private async ask(): Promise<boolean> {
    const k = frameSettings;
    const choice = (key: string, label: string, value: string, options: readonly string[]): PrefField => ({ kind: "choice", key, label, value, options: options.map((o) => ({ value: o, label: o })) });
    const v = await toolPrefs(
      "Rack Frame Preferences",
      [
        { kind: "text", key: "name", label: "Name", value: k.name },
        { kind: "check", key: "link", label: "Link device name", value: k.link },
        { kind: "text", key: "make", label: "Make", value: k.make },
        { kind: "text", key: "model", label: "Model", value: k.model },
        choice("type", "Type", k.type, FRAME_TYPES),
        choice("mounting", "Mounting", k.mounting, MOUNTINGS),
        { kind: "number", key: "ru", label: "Height RU", value: k.ru, min: 1, max: 100, integer: true, unit: "RU" },
        { kind: "length", key: "depth", label: "Depth", value: k.depth },
        { kind: "number", key: "power", label: "Power (W)", value: k.power, min: 0, max: 1000000 },
        { kind: "number", key: "weight", label: "Weight (kg)", value: k.weight, min: 0, max: 100000 },
        { kind: "number", key: "across", label: "Slots H", value: k.across, min: 1, max: 100, integer: true },
        { kind: "number", key: "up", label: "Slots V", value: k.up, min: 1, max: 100, integer: true },
        choice("direction", "Slot Direction", k.direction, SLOT_DIRECTIONS),
        { kind: "number", key: "psus", label: "Power Supplies", value: k.psus, min: 0, max: 8, integer: true },
        choice("psuSide", "PSU Location", k.psuSide, PSU_SIDES),
        { kind: "number", key: "psuSize", label: "PSU Size", value: k.psuSize, min: 1, max: 100, unit: "%" },
        { kind: "check", key: "door", label: "Front Door", value: k.door },
      ],
      "Click over an equipment rack to put a frame in it at the first free unit from the top, on its front or rear, or anywhere else for one on its own. Its slots are numbered from the top left; modular equipment goes into a frame's first free slots, a run of them going across or down by Slot Direction. Power supplies take the left or right of each row, each PSU Size percent of a slot's width.",
    );
    if (!v) return false;
    k.name = v.choice("name");
    k.link = v.flag("link");
    k.make = v.choice("make");
    k.model = v.choice("model");
    k.type = v.choice("type") as FrameType;
    k.mounting = v.choice("mounting") as Mounting;
    k.ru = v.num("ru");
    k.depth = v.num("depth");
    k.power = v.num("power");
    k.weight = v.num("weight");
    k.across = v.num("across");
    k.up = v.num("up");
    k.direction = v.choice("direction") as SlotDirection;
    k.psus = v.num("psus");
    k.psuSide = v.choice("psuSide") as PsuSide;
    k.psuSize = v.num("psuSize");
    k.door = v.flag("door");
    this.asked = store.session?.doc ?? null;
    return true;
  }

  hint(): string {
    return "Click over a rack to put a frame in it, or anywhere for a frame on its own";
  }

  move(p: PointerInfo): void {
    this.pointer = p.pos;
  }

  down(p: PointerInfo): void {
    if (p.button !== 0) return;
    const layerId = store.activeLayerId;
    if (layerId) void this.place(layerId, p.pos);
  }

  private async place(layerId: string, at: Pt): Promise<void> {
    const session = store.session;
    if (!session) return;
    // the Preferences the first time it's used in a drawing
    if (this.asked !== session.doc && (!(await this.ask()) || store.session !== session)) return;
    placeRackFrame(layerId, at);
  }

  overlay(g: Painter): void {
    const doc = store.session?.doc;
    if (!this.pointer || !doc) return;
    const outline = itemPreview(doc, this.pointer, true);
    withPreview(g, () => strokeScreen(g, outline, true));
  }
}

/** The Make Rack Equipment Worksheet tool: a click (over the rack, to choose it first) for a rack's contents worksheet. */
export class RackWorksheetTool extends BaseTool {
  readonly id = "ccrackws";
  readonly cursor = "crosshair";

  hint(): string {
    return "Click to make a worksheet of a rack's equipment, over the rack to choose it";
  }

  down(p: PointerInfo): void {
    if (p.button === 0) void makeRackWorksheet(p.pos);
  }
}
